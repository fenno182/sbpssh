// Turns resolved hosts into the display model: groups (one per source file),
// colours, and short tags inferred from host names.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { expandTilde } from './sshconfig.js';

import { THEMES } from './theme.js';

const ENV_TAGS = { prd: 'prd', prod: 'prd', production: 'prd', tst: 'tst', test: 'tst', dev: 'dev', stg: 'stg', stage: 'stg', staging: 'stg' };
const ROLE_TAGS = { mng: 'mng', mgmt: 'mng', app: 'app', db: 'db', dbase: 'db', dat: 'db', pub: 'pub', web: 'web' };

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

// Tags come from name segments: `shop-prd-mng-01` → prd, mng. Digits are
// split off so `db01` still yields `db` via its `dat` segment... it does
// not, on purpose: only explicit separators count, to avoid false positives.
export function tagsFor(name) {
  const tags = [];
  for (const seg of name.toLowerCase().split(/[-_.]+/)) {
    const t = ENV_TAGS[seg] || ROLE_TAGS[seg];
    if (t && !tags.includes(t)) tags.push(t);
  }
  return tags;
}

function groupNameFor(file, entryFile) {
  if (path.resolve(file) === path.resolve(entryFile)) return 'config';
  return path.basename(file).replace(/\.(conf|config|ssh)$/i, '');
}

function keyExists(identity) {
  try { fs.accessSync(expandTilde(identity)); return true; } catch { return false; }
}

/**
 * @param {{hosts, files}} parsed  result of loadHosts()
 * @param theme  active theme (palette + per-group overrides from config.toml)
 * @returns {{ hosts: DisplayHost[], groups: Group[] }}
 */
export function buildModel(parsed, entryFile = path.join(os.homedir(), '.ssh', 'config'), theme = THEMES.default) {
  const PALETTE = theme.palette;
  const overrides = theme.groupColours ?? {};
  const groupsByFile = new Map();
  const usedColours = new Set();

  // Colours: stable hash of the group name, nudged forward on collision so
  // that groups stay distinct while the set is small.
  const colourFor = (groupName) => {
    if (overrides[groupName]) return overrides[groupName];
    let idx = hashString(groupName) % PALETTE.length;
    for (let i = 0; i < PALETTE.length && usedColours.has(idx); i++) idx = (idx + 1) % PALETTE.length;
    usedColours.add(idx);
    return PALETTE[idx];
  };

  const hosts = parsed.hosts.map(h => {
    let group = groupsByFile.get(h.file);
    if (!group) {
      const name = groupNameFor(h.file, entryFile);
      group = { name, file: h.file, colour: colourFor(name), hosts: [] };
      groupsByFile.set(h.file, group);
    }
    const o = h.options;
    const identity = o.identityfile?.values ?? [];
    const dh = {
      name: h.name,
      group: group.name,
      colour: group.colour,
      file: h.file,
      line: h.line,
      hostname: o.hostname?.value ?? h.name,
      user: o.user?.value ?? null,
      port: o.port?.value ?? '22',
      identityFiles: identity.map(f => ({ path: f, exists: keyExists(f), viaPattern: o.identityfile.viaPattern })),
      proxyJump: o.proxyjump?.value ?? o.proxycommand?.value ?? null,
      forwards: [...(o.localforward?.values ?? []).map(v => `L ${v}`), ...(o.remoteforward?.values ?? []).map(v => `R ${v}`), ...(o.dynamicforward?.values ?? []).map(v => `D ${v}`)],
      tags: tagsFor(h.name),
      options: o,
    };
    group.hosts.push(dh);
    return dh;
  });

  // Keep groups in the order their files were read (i.e. Include order),
  // which for `config.d/*.conf` is alphabetical.
  const groups = [...groupsByFile.values()];
  return { hosts, groups };
}
