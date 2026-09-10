// Minimal ssh_config parser that follows Include directives and remembers
// where every Host block and option came from.
//
// Semantics mirror ssh(1): blocks are scanned in order, the first value seen
// for an option wins, except for a handful of accumulating options. Wildcard
// blocks (e.g. `Host acme-*`) therefore fill in gaps for concrete hosts that
// appear earlier in the file — the usual way a shared User/IdentityFile is
// set once for a whole group of hosts.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Options ssh keeps every value for rather than first-wins.
const MULTI_VALUE = new Set([
  'identityfile', 'certificatefile', 'localforward', 'remoteforward',
  'dynamicforward', 'sendenv', 'setenv', 'canonicaldomains', 'globalknownhostsfile',
  'userknownhostsfile',
]);

export function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Tiny glob → RegExp (supports * and ? like ssh's own pattern matcher).
export function patternToRegExp(pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

export function isWildcard(pattern) {
  return /[*?]/.test(pattern);
}

// Expand a filesystem glob (only the basename may contain wildcards, which
// covers `Include ~/.ssh/config.d/*.conf`). Returns sorted absolute paths.
function expandIncludeGlob(spec, sshDir) {
  let p = expandTilde(spec);
  if (!path.isAbsolute(p)) p = path.join(sshDir, p);
  const dir = path.dirname(p);
  const base = path.basename(p);
  if (!isWildcard(base)) return fs.existsSync(p) ? [p] : [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  const re = patternToRegExp(base);
  return entries.filter(e => re.test(e)).sort().map(e => path.join(dir, e));
}

// Split a config line into keyword + value. Handles `Key value`, `Key=value`
// and `Key = value`. Values keep their internal spacing; quotes are stripped
// only when they wrap the whole value.
function splitLine(line) {
  const m = /^\s*([A-Za-z][A-Za-z0-9]*)\s*(?:=\s*|\s+)(.*?)\s*$/.exec(line);
  if (!m) return null;
  let value = m[2];
  if (/^".*"$/.test(value)) value = value.slice(1, -1);
  return { key: m[1], value };
}

/**
 * Parse an ssh config file (and everything it Includes) into an ordered list
 * of blocks.
 *
 * @returns {{ blocks: Block[], files: string[], errors: string[] }}
 *   Block = { kind: 'host'|'match', patterns: string[], file, line, options: Option[] }
 *   Option = { key (lowercased), rawKey, value, file, line }
 */
export function parseConfig(entryFile = path.join(os.homedir(), '.ssh', 'config')) {
  const sshDir = path.dirname(entryFile);
  const files = [];
  const errors = [];
  const blocks = [];
  // Implicit global block: options that appear before any Host/Match apply to
  // every host, and ssh treats them as if they were in a `Host *` at the top.
  let current = { kind: 'host', patterns: ['*'], file: entryFile, line: 0, options: [], implicit: true };
  blocks.push(current);

  const seen = new Set();
  const visit = (file, depth) => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    if (depth > 16) { errors.push(`${file}: Include nesting too deep`); return; }
    seen.add(abs);
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { errors.push(`${file}: ${e.message}`); return; }
    files.push(abs);

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const stripped = raw.replace(/^\s*#.*$/, '').trimEnd();
      if (!stripped.trim()) continue;
      const kv = splitLine(stripped);
      if (!kv) { errors.push(`${file}:${i + 1}: unparseable line`); continue; }
      const key = kv.key.toLowerCase();
      const line = i + 1;

      if (key === 'host' || key === 'match') {
        current = { kind: key, patterns: kv.value.split(/\s+/).filter(Boolean), file: abs, line, options: [] };
        blocks.push(current);
        continue;
      }
      if (key === 'include') {
        for (const spec of kv.value.split(/\s+/).filter(Boolean)) {
          const matches = expandIncludeGlob(spec, sshDir);
          for (const f of matches) {
            // An Include inside a Host block keeps that block as the context
            // for any option lines the included file starts with; a Host line
            // in the included file simply starts a new block as usual.
            visit(f, depth + 1);
          }
        }
        continue;
      }
      current.options.push({ key, rawKey: kv.key, value: kv.value, file: abs, line });
    }
  };

  visit(entryFile, 0);
  return { blocks, files, errors };
}

function blockMatches(block, name) {
  if (block.kind !== 'host') return false; // Match blocks need runtime info; skip
  let matched = false;
  for (const p of block.patterns) {
    if (p.startsWith('!')) {
      if (patternToRegExp(p.slice(1)).test(name)) return false;
    } else if (patternToRegExp(p).test(name)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * Turn parsed blocks into one resolved record per concrete host alias.
 *
 * @returns {ResolvedHost[]}  { name, file, line, options: { [lowerKey]: { value, values, file, line, viaPattern } } }
 */
export function resolveHosts(blocks) {
  const hosts = [];
  const seenNames = new Set();

  for (const block of blocks) {
    if (block.kind !== 'host' || block.implicit) continue;
    for (const pat of block.patterns) {
      if (isWildcard(pat) || pat.startsWith('!')) continue;
      if (seenNames.has(pat)) continue; // duplicate alias: first declaration is the one ssh uses
      seenNames.add(pat);

      const options = {};
      for (const b of blocks) {
        if (!blockMatches(b, pat)) continue;
        const viaPattern = (b.implicit || b === block) ? null : b.patterns.join(' ');
        for (const o of b.options) {
          if (MULTI_VALUE.has(o.key)) {
            if (!options[o.key]) options[o.key] = { rawKey: o.rawKey, value: o.value, values: [], file: o.file, line: o.line, viaPattern };
            options[o.key].values.push(o.value);
          } else if (!options[o.key]) {
            options[o.key] = { rawKey: o.rawKey, value: o.value, values: [o.value], file: o.file, line: o.line, viaPattern };
          }
        }
      }
      hosts.push({ name: pat, file: block.file, line: block.line, options });
    }
  }
  return hosts;
}

export function loadHosts(entryFile) {
  const parsed = parseConfig(entryFile);
  return { ...parsed, hosts: resolveHosts(parsed.blocks) };
}
