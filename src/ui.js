// The Ink (React for terminals) UI. Written with React.createElement rather
// than JSX so the tool runs straight from source with no build step.
//
// The UI never runs ssh itself for interactive sessions: it hands an action
// back to bin/sbpssh.js (which unmounts us, runs ssh, and mounts us again).
// tmux windows and clipboard copies are quick enough to do in place.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import fuzzysort from 'fuzzysort';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { relativeTime, toggleFavourite, saveState } from './state.js';
import { probeResults, probeAll, infoResults, fetchInfo, INFO_FIELDS } from './probe.js';
import { THEME_NAMES } from './theme.js';

const h = React.createElement;
const T = (props, ...children) => h(Text, props, ...children);

const LABEL_W = 13;
const FAV_GROUP = '★ favourites';
const RECENT_GROUP = '⟲ recent';
const inTmux = () => Boolean(process.env.TMUX);

function truncate(s, w) {
  if (w <= 0) return '';
  return s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s;
}
const pad = (n) => ' '.repeat(Math.max(0, n));
const plural = (n, w, suffix = 's') => `${n} ${w}${n === 1 ? '' : suffix}`;
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function shortPath(p) {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function copyToClipboard(text) {
  try {
    execFileSync('xclip', ['-selection', 'clipboard'], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    return 'xclip';
  } catch { /* fall through */ }
  // OSC 52 — works in most modern terminals, including over ssh/tmux.
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`);
  return 'terminal';
}

/** Open a command in a new tmux window (focus it unless `stay`). Returns an error string or null. */
function tmuxWindow(title, argv, stay = false) {
  const res = spawnSync('tmux', ['new-window', ...(stay ? ['-d'] : []), '-n', title.slice(0, 30), ...argv], { stdio: 'ignore' });
  if (res.error) return res.error.message;
  if (res.status) return `tmux exited with ${res.status}`;
  return null;
}

// ─── rows ────────────────────────────────────────────────────────────────────

function buildRows({ model, query, grouped, folded, favourites, recent }) {
  if (query) {
    const results = fuzzysort.go(query, model.hosts, { keys: ['name', 'group', 'hostname', 'user'], threshold: 0.2, limit: 200 });
    return results.map(r => ({ type: 'host', host: r.obj, hl: r[0]?.indexes ?? [], showGroup: true }));
  }
  if (!grouped) {
    return [...model.hosts].sort((a, b) => a.name.localeCompare(b.name)).map(host => ({ type: 'host', host, showGroup: true }));
  }
  const rows = [];
  const byName = new Map(model.hosts.map(x => [x.name, x]));
  const pushGroup = (key, name, colour, hosts, file, showGroup = false) => {
    if (!hosts.length) return;
    const isFolded = folded.has(key);
    rows.push({ type: 'group', key, name, colour, count: hosts.length, folded: isFolded, file, hosts });
    if (!isFolded) for (const host of hosts) rows.push({ type: 'host', host, groupKey: key, showGroup });
  };
  pushGroup(FAV_GROUP, FAV_GROUP, 'yellow', favourites.map(n => byName.get(n)).filter(Boolean), null, true);
  const recentHosts = Object.entries(recent).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 5).map(([n]) => byName.get(n)).filter(Boolean);
  pushGroup(RECENT_GROUP, RECENT_GROUP, 'gray', recentHosts, null, true);
  for (const g of model.groups) pushGroup(g.name, g.name, g.colour, g.hosts, g.file);
  return rows;
}

// ─── list components ─────────────────────────────────────────────────────────

function Highlighted({ text, indexes = [], selected, theme }) {
  if (!indexes.length) return T({ inverse: selected }, text);
  const set = new Set(indexes);
  const parts = [];
  let buf = '', on = set.has(0);
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== on) { parts.push({ s: buf, on }); buf = ''; on = m; }
    buf += text[i];
  }
  parts.push({ s: buf, on });
  return h(Text, { inverse: selected }, ...parts.map((p, i) =>
    T({ key: i, color: p.on ? theme.match : undefined, bold: p.on, underline: p.on }, p.s)));
}

function Tags({ tags, selected, theme }) {
  return h(Text, { inverse: selected }, ...tags.map((t, i) => T({ key: t, color: theme.tags[t] || theme.dim, bold: true }, (i ? ' ' : '') + t)));
}

const DOTS = { up: '●', down: '●', checking: '◌', skip: '·' };

function ProbeDot({ name, theme, selected }) {
  const r = probeResults.get(name);
  const colour = r?.status === 'up' ? theme.up : r?.status === 'down' ? theme.down : theme.unknown;
  return T({ inverse: selected, color: colour, dimColor: !r || r.status === 'checking' || r.status === 'skip' }, (r ? DOTS[r.status] : ' ') + ' ');
}

function HostRow({ row, selected, width, favourites, marks, probes, theme }) {
  const { host, hl, showGroup } = row;
  const fav = favourites.includes(host.name);
  const marked = marks.has(host.name);
  const flag = marked ? '✓' : fav ? '★' : ' ';
  const prefix = `${selected ? '▸' : ' '}${flag} `;
  const dotW = probes ? 2 : 0;
  const rightBits = [...host.tags];
  const rightStr = rightBits.join(' ') + (showGroup ? `${rightBits.length ? '  ' : ''}● ${host.group}` : '');
  const nameW = Math.max(4, width - prefix.length - dotW - (rightStr ? rightStr.length + 1 : 0));
  const name = truncate(host.name, nameW);
  const gap = width - prefix.length - dotW - name.length - rightStr.length;
  return h(Box, null,
    T({ inverse: selected, color: marked ? theme.marked : fav ? theme.fav : theme.dim }, prefix),
    probes ? h(ProbeDot, { name: host.name, theme, selected }) : null,
    h(Highlighted, { text: name, indexes: hl, selected, theme }),
    T({ inverse: selected }, pad(gap)),
    rightBits.length ? h(Tags, { tags: rightBits, selected, theme }) : null,
    showGroup ? h(Text, { inverse: selected }, T({ dimColor: !selected }, rightBits.length ? '  ' : ''), T({ color: host.colour }, '● '), T({ dimColor: !selected }, host.group)) : null,
  );
}

function GroupRow({ row, selected, width, marks, theme }) {
  const markedCount = row.hosts.filter(x => marks.has(x.name)).length;
  const prefix = `${row.folded ? '▸' : '▾'} ● `;
  const countStr = markedCount ? `${markedCount}✓/${row.count}` : `${row.count}`;
  let rightStr = row.file ? `${path.basename(row.file)}  ${countStr}` : countStr;
  const nameW = Math.max(4, width - prefix.length - 1);
  const name = truncate(row.name, nameW);
  if (prefix.length + name.length + 1 + rightStr.length > width) rightStr = countStr;
  const gap = width - prefix.length - name.length - rightStr.length;
  return h(Box, null,
    T({ inverse: selected, color: row.colour, bold: true }, prefix + name),
    T({ inverse: selected }, pad(gap)),
    T({ inverse: selected, dimColor: true, color: markedCount ? theme.marked : undefined }, rightStr),
  );
}

// ─── detail pane ─────────────────────────────────────────────────────────────

function Field({ label, value, note, colour, width }) {
  const v = value ?? '—';
  const noteStr = note ? `  ${note}` : '';
  const maxV = Math.max(4, width - LABEL_W - noteStr.length);
  return h(Box, null,
    T({ dimColor: true }, label.padEnd(LABEL_W)),
    T({ color: value == null ? 'gray' : colour, dimColor: value == null }, truncate(v, maxV)),
    note ? T({ dimColor: true, italic: true }, noteStr) : null,
  );
}

function GroupDetail({ row, model, width, height, recent }) {
  const group = model.groups.find(g => g.name === row.key);
  const hosts = group?.hosts ?? row.hosts;
  const lines = [
    h(Box, { key: 't' }, T({ bold: true, color: row.colour }, `● ${row.name}`), T({ dimColor: true }, `  ${plural(row.count, 'host')}`)),
    T({ key: 'rule', dimColor: true }, '─'.repeat(Math.max(1, width))),
  ];
  if (group) lines.push(h(Field, { key: 'f', label: 'File', value: shortPath(group.file), colour: row.colour, width }));
  const users = [...new Set(hosts.map(x => x.user).filter(Boolean))];
  const keys = [...new Set(hosts.flatMap(x => x.identityFiles.map(f => f.path)))];
  lines.push(h(Field, { key: 'u', label: 'Users', value: users.join(', ') || null, width }));
  lines.push(h(Field, { key: 'k', label: 'Keys', value: keys.join(', ') || null, width }));
  const up = hosts.filter(x => probeResults.get(x.name)?.status === 'up').length;
  const down = hosts.filter(x => probeResults.get(x.name)?.status === 'down').length;
  if (up || down) lines.push(h(Box, { key: 'r' }, T({ dimColor: true }, 'Reachable'.padEnd(LABEL_W)), T({ color: 'green' }, `${up} up`), down ? T({ color: 'red' }, `  ${down} down`) : null));
  const last = hosts.map(x => recent[x.name]).filter(Boolean).sort().pop();
  lines.push(h(Field, { key: 'l', label: 'Last used', value: relativeTime(last) ?? 'never', width }));
  lines.push(T({ key: 'sp' }, ' '));
  lines.push(T({ key: 'hint', dimColor: true, italic: true }, `${row.folded ? '⏎ / → unfold' : '⏎ / ← fold'}   m mark all   ! run on all`));
  return h(Box, { flexDirection: 'column', paddingX: 1 }, ...lines.slice(0, height));
}

const KNOWN = new Set(['hostname', 'user', 'port', 'identityfile', 'proxyjump', 'proxycommand', 'localforward', 'remoteforward', 'dynamicforward']);
const RAW_KEYS = { forwardagent: 'ForwardAgent', localcommand: 'LocalCommand', permitlocalcommand: 'PermitLocalCommand', requesttty: 'RequestTTY', remotecommand: 'RemoteCommand', stricthostkeychecking: 'StrictHostKeyChecking', userknownhostsfile: 'UserKnownHostsFile', serveraliveinterval: 'ServerAliveInterval', identitiesonly: 'IdentitiesOnly', compression: 'Compression', controlmaster: 'ControlMaster', controlpath: 'ControlPath', controlpersist: 'ControlPersist', setenv: 'SetEnv', sendenv: 'SendEnv', addkeystoagent: 'AddKeysToAgent' };
const rawKeyFor = (host, k) => host.options[k]?.rawKey ?? RAW_KEYS[k] ?? k;
// Options from the implicit top-of-file block (before any Host line) apply to everything; don't repeat them.
const isGlobal = (host, o) => o.file !== host.file && !o.viaPattern;

function LiveInfo({ host, width, probes, theme }) {
  const probe = probeResults.get(host.name);
  const info = infoResults.get(host.name);
  const head = (text, colour) => h(Box, null, T({ dimColor: true }, 'live '), T({ dimColor: true }, '─ '), T({ color: colour, dimColor: !colour, italic: true }, text));
  if (probes && probe?.status === 'down') return [head('host unreachable', theme.down)];
  if (probes && probe?.status === 'checking') return [head('checking reachability…')];
  if (!info) return [head('…')];
  if (info.pending) return [head('fetching…', theme.accent)];
  if (info.error) return [head(`✘ ${truncate(info.error, width - 10)}`, theme.down)];
  const rows = [head(`${relativeTime(new Date(info.at).toISOString())}${probe?.ms != null ? `  ·  ${probe.ms} ms` : ''}`)];
  INFO_FIELDS.forEach((label, i) => {
    const v = info.lines[i];
    if (v) rows.push(h(Field, { key: label, label, value: v, width }));
  });
  return rows;
}

function Detail({ host, width, height, favourites, recent, marks, probes, showInfo, theme }) {
  if (!host) return h(Box, { flexDirection: 'column', paddingX: 1, justifyContent: 'center', alignItems: 'center', height }, T({ dimColor: true }, 'nothing matches'));
  const rows = [];
  rows.push(h(Box, { key: 'title' },
    T({ bold: true, color: host.colour }, truncate(host.name, width - 8)),
    favourites.includes(host.name) ? T({ color: theme.fav }, '  ★') : null,
    marks.has(host.name) ? T({ color: theme.marked }, '  ✓ marked') : null,
  ));
  rows.push(h(Box, { key: 'tags' },
    host.tags.length ? h(Text, null, ...host.tags.map(t => T({ key: t, color: theme.tags[t] || theme.dim, bold: true }, `[${t}] `))) : T({ dimColor: true }, host.group),
  ));
  rows.push(T({ key: 'rule', dimColor: true }, '─'.repeat(Math.max(1, width))));
  const via = (o) => o?.viaPattern ? `via ${o.viaPattern}` : null;
  rows.push(h(Field, { key: 'hn', label: 'HostName', value: host.hostname, note: via(host.options.hostname), width }));
  rows.push(h(Field, { key: 'us', label: 'User', value: host.user, note: via(host.options.user), width }));
  rows.push(h(Field, { key: 'po', label: 'Port', value: host.port, note: via(host.options.port), width }));
  if (host.identityFiles.length) {
    host.identityFiles.forEach((f, i) => rows.push(h(Box, { key: `id${i}` },
      T({ dimColor: true }, (i ? '' : 'IdentityFile').padEnd(LABEL_W)),
      T({}, truncate(f.path, width - LABEL_W - 3 - (f.viaPattern ? f.viaPattern.length + 6 : 0))),
      T({ color: f.exists ? theme.up : theme.down }, f.exists ? ' ✔' : ' ✘'),
      f.viaPattern ? T({ dimColor: true, italic: true }, `  via ${f.viaPattern}`) : null,
    )));
  } else {
    rows.push(h(Field, { key: 'id', label: 'IdentityFile', value: null, note: 'agent / default keys', width }));
  }
  rows.push(h(Field, { key: 'pj', label: 'ProxyJump', value: host.proxyJump, note: via(host.options.proxyjump ?? host.options.proxycommand), colour: 'magenta', width }));
  if (host.forwards.length) rows.push(h(Field, { key: 'fw', label: 'Forwards', value: host.forwards.join(', '), width }));
  const extra = Object.entries(host.options).filter(([k, o]) => !KNOWN.has(k) && o.viaPattern !== '*' && !isGlobal(host, o));
  const shown = extra.slice(0, Math.max(0, height - rows.length - 7));
  if (shown.length) {
    rows.push(T({ key: 'sp0' }, ' '));
    for (const [k, o] of shown) rows.push(h(Field, { key: k, label: rawKeyFor(host, k), value: o.values.join(', '), note: via(o), colour: 'gray', width }));
  }
  rows.push(T({ key: 'sp1' }, ' '));
  rows.push(h(Field, { key: 'src', label: 'Source', value: `${shortPath(host.file)}:${host.line}`, colour: host.colour, width }));
  rows.push(h(Field, { key: 'last', label: 'Last used', value: relativeTime(recent[host.name]) ?? 'never', width }));
  if (showInfo) {
    rows.push(T({ key: 'sp2' }, ' '));
    LiveInfo({ host, width, probes, theme }).forEach((r, i) => rows.push(h(Box, { key: `live${i}` }, r)));
  }
  rows.push(T({ key: 'sp3' }, ' '));
  rows.push(h(Box, { key: 'cmd' }, T({ dimColor: true }, '$ '), T({ bold: true }, `ssh ${host.name}`)));
  return h(Box, { flexDirection: 'column', paddingX: 1 }, ...rows.slice(0, height));
}

function Help({ width, height, theme }) {
  const keys = [
    ['⏎', 'connect · on a group header: fold/unfold · with marks in tmux mode: open all marked'],
    ['just type, /', 'search — Esc clears, Tab keeps the filter'],
    ['!', 'run a command on the selected host, or on every marked host (↑↓ for history)'],
    ['m  M', 'mark host / whole group  ·  mark all visible (or clear all)'],
    ['↑↓ j k  PgUp/Dn  g G', 'move · page · top / bottom'],
    ['← → space h l  Tab', 'fold / unfold group · toggle grouped ↔ flat'],
    ['s  c  f  e', 'sftp · copy ssh command · favourite · edit config file at this host'],
    ['t  p  i  C', 'toggle tmux mode · reachability probes · live info · cycle theme'],
    ['r', 'reload configs and re-probe'],
    ['mouse', 'click selects, double-click connects, wheel scrolls'],
    ['?  q', 'this help · quit'],
  ];
  const lines = [
    T({ key: 'h', bold: true }, 'keys'), T({ key: 's0' }, ' '),
    ...keys.map(([k, d]) => h(Box, { key: k }, T({ color: theme.accent, bold: true }, k.padEnd(22)), h(Text, { wrap: 'truncate' }, truncate(d, width - 28)))),
    T({ key: 's1' }, ' '), T({ key: 'f', dimColor: true }, 'config: ~/.config/sbpssh/config.toml   state: ~/.config/sbpssh/state.json'),
  ];
  return h(Box, { flexDirection: 'column', paddingX: 2 }, ...lines.slice(0, height));
}

// ─── app ─────────────────────────────────────────────────────────────────────

// SGR mouse reports arrive as `[<button;x;yM` (press) / `m` (release); a press and
// release are often coalesced into one chunk, so match globally.
const MOUSE_RE = /\[<(\d+);(\d+);(\d+)([Mm])/g;

function App({ model, state, errors, config, theme, prefs, sshArgs, initialSelected, initialFlash, initialQuery = '', onAction }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [dims, setDims] = useState({ cols: stdout.columns || 80, rows: stdout.rows || 24 });
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState(initialQuery ? 'search' : 'normal'); // normal | search | help | command
  const [grouped, setGrouped] = useState(state.grouped);
  const [folded, setFolded] = useState(new Set(state.folded));
  const [favourites, setFavourites] = useState([...state.favourites]);
  const [marks, setMarks] = useState(new Set(state.marks ?? []));
  const [cursor, setCursor] = useState(0);
  const [offset, setOffset] = useState(0);
  const [flash, setFlash] = useState(initialFlash || null);
  const [toggles, setToggles] = useState({ probes: prefs.probes, info: prefs.info, tmux: prefs.tmux });
  const [cmd, setCmd] = useState('');
  const [histIdx, setHistIdx] = useState(-1);
  const [, setTick] = useState(0);
  const bump = () => setTick(t => t + 1);
  const lastClick = useRef({ row: -1, at: 0 });

  useEffect(() => {
    const onResize = () => setDims({ cols: stdout.columns, rows: stdout.rows });
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  const rows = useMemo(() => buildRows({ model, query, grouped, folded, favourites, recent: state.recent }), [model, query, grouped, folded, favourites]);

  // Put the cursor back on the host we were on before ssh'ing out.
  useEffect(() => {
    const i = initialSelected
      ? rows.findIndex(r => r.type === 'host' && r.host.name === initialSelected)
      : rows.findIndex(r => r.type === 'host');
    if (i >= 0) setCursor(i);
  }, []);

  // Reachability probes: run on mount (stale results only) and every interval.
  useEffect(() => {
    if (!toggles.probes) return;
    const opts = { timeout: config.probe_timeout_ms, maxAge: config.probe_interval_s * 1000, onUpdate: bump };
    probeAll(model.hosts, opts);
    const iv = setInterval(() => probeAll(model.hosts, opts), config.probe_interval_s * 1000);
    return () => clearInterval(iv);
  }, [toggles.probes, model]);

  const total = dims.rows - 1;               // leave one line so Ink never scrolls
  const listH = Math.max(3, total - 5);      // header + search + footer + 2 border lines
  const listW = Math.max(28, Math.min(48, Math.floor(dims.cols * 0.45)));
  const listInner = listW - 4;
  const detailW = dims.cols - listW - 4;

  const cur = Math.min(cursor, Math.max(0, rows.length - 1));
  useEffect(() => {
    if (cur < offset) setOffset(cur);
    else if (cur >= offset + listH) setOffset(cur - listH + 1);
  }, [cur, listH]);

  const selectedRow = rows[cur];
  const selectedHost = selectedRow?.type === 'host' ? selectedRow.host : null;
  const selectedProbe = selectedHost ? probeResults.get(selectedHost.name)?.status : null;

  // Live info: fetch for the selected host after it has rested under the
  // cursor for a moment, and only if it looks reachable.
  useEffect(() => {
    if (!toggles.info || !selectedHost) return;
    if (toggles.probes && selectedProbe !== 'up' && selectedProbe !== 'skip') return;
    const t = setTimeout(() => fetchInfo(selectedHost.name, sshArgs, bump), 600);
    return () => clearTimeout(t);
  }, [selectedHost?.name, toggles.info, toggles.probes, selectedProbe]);

  // ── helpers ──
  const persist = () => saveState(state);
  const move = (d) => setCursor(c => Math.max(0, Math.min(rows.length - 1, Math.min(c, rows.length - 1) + d)));
  const setFold = (key, value) => {
    const next = new Set(folded);
    value ? next.add(key) : next.delete(key);
    setFolded(next);
    state.folded = [...next]; persist();
  };
  const groupKeyAtCursor = () => selectedRow?.type === 'group' ? selectedRow.key : selectedRow?.groupKey;
  const fold = (value) => {
    const key = groupKeyAtCursor();
    if (!key) return;
    if (value && selectedRow.type === 'host') {
      const gi = rows.findIndex(r => r.type === 'group' && r.key === key);
      if (gi >= 0) setCursor(gi);
    }
    setFold(key, value);
  };
  const changeQuery = (q) => { setQuery(q); setCursor(0); setOffset(0); };
  const setMarksPersist = (next) => { setMarks(next); state.marks = [...next]; persist(); };
  const toggle = (name, label) => {
    const next = { ...toggles, [name]: !toggles[name] };
    setToggles(next);
    state.prefs = { ...(state.prefs ?? {}), [name]: next[name] }; persist();
    setFlash({ text: `${label} ${next[name] ? 'on' : 'off'}`, colour: theme.accent });
    return next[name];
  };
  const targets = () => marks.size ? model.hosts.filter(x => marks.has(x.name)) : (selectedHost ? [selectedHost] : []);
  const useTmux = () => toggles.tmux && inTmux();

  // Connect (or sftp) to hosts: in tmux mode open windows here; otherwise
  // hand the first host to the CLI which runs it inline.
  const connect = (kind, hosts) => {
    if (!hosts.length) return;
    if (useTmux()) {
      // One host: jump to its window. Several: open them all behind us and stay here.
      const errs = hosts.map(x => tmuxWindow(`${kind === 'sftp' ? 'sftp:' : ''}${x.name}`, [kind, ...sshArgs, x.name], hosts.length > 1)).filter(Boolean);
      onAction({ type: 'touch', hosts });
      setFlash(errs.length ? { text: errs[0], colour: theme.down } : { text: `opened ${plural(hosts.length, 'tmux window')}`, colour: theme.up });
      return;
    }
    onAction({ type: kind, host: hosts[0] }); exit();
  };

  const runCommand = () => {
    const command = cmd.trim();
    const hosts = targets();
    if (!command || !hosts.length) { setMode('normal'); return; }
    state.commands = [command, ...(state.commands ?? []).filter(c => c !== command)].slice(0, 30); persist();
    setMode('normal'); setCmd(''); setHistIdx(-1);
    if (useTmux()) {
      const errs = hosts.map(x => tmuxWindow(`${x.name}: ${command}`, ['sh', '-c', `ssh ${sshArgs.map(shq).join(' ')} ${shq(x.name)} ${shq(command)}; echo; printf '\\033[2m— press enter to close —\\033[0m'; read _`], hosts.length > 1)).filter(Boolean);
      setFlash(errs.length ? { text: errs[0], colour: theme.down } : { text: `running on ${plural(hosts.length, 'host')} in tmux`, colour: theme.up });
      return;
    }
    onAction({ type: 'run', host: selectedHost, hosts, command }); exit();
  };

  const handleMouse = (m) => {
    const button = Number(m[1]), x = Number(m[2]), y = Number(m[3]), press = m[4] === 'M';
    if (!press) return;
    if (button === 64) return move(-3);          // wheel up
    if (button === 65) return move(3);           // wheel down
    if (button !== 0) return;
    if (mode === 'help') { setMode('normal'); return; }
    if (y === 2) { setMode('search'); return; }
    const listTop = 4;
    if (x <= listW && y >= listTop && y < listTop + listH) {
      const idx = offset + (y - listTop);
      if (idx >= rows.length) return;
      const now = Date.now();
      const dbl = lastClick.current.row === idx && now - lastClick.current.at < 450;
      lastClick.current = { row: idx, at: now };
      setCursor(idx);
      const row = rows[idx];
      if (row.type === 'group') { if (dbl || x <= 5) setFold(row.key, !row.folded); return; }
      if (dbl) connect('ssh', [row.host]);
    }
  };

  // Mouse: Ink drops chunks that carry several escape sequences (a press and
  // release often arrive together), so read them straight from stdin.
  const mouseRef = useRef(handleMouse);
  mouseRef.current = handleMouse;
  useEffect(() => {
    if (!config.mouse) return;
    const onData = (buf) => { for (const m of buf.toString().matchAll(MOUSE_RE)) mouseRef.current(m); };
    process.stdin.on('data', onData);
    return () => process.stdin.off('data', onData);
  }, [config.mouse]);

  useInput((input, key) => {
    if (process.env.SBPSSH_DEBUG) fs.appendFileSync(process.env.SBPSSH_DEBUG, JSON.stringify(input) + '\n');
    if (input.includes('[<')) return; // mouse reports are handled by the raw stdin listener below
    if (key.ctrl && input === 'c') { onAction({ type: 'exit', host: selectedHost }); exit(); return; }
    if (mode === 'help') { setMode('normal'); return; }

    if (mode === 'command') {
      const hist = state.commands ?? [];
      if (key.escape) { setMode('normal'); setCmd(''); setHistIdx(-1); return; }
      if (key.return) return runCommand();
      if (key.upArrow) { const i = Math.min(hist.length - 1, histIdx + 1); if (i >= 0) { setHistIdx(i); setCmd(hist[i]); } return; }
      if (key.downArrow) { const i = histIdx - 1; setHistIdx(i); setCmd(i >= 0 ? hist[i] : ''); return; }
      if (key.backspace || key.delete) return setCmd(cmd.slice(0, -1));
      if (key.ctrl && input === 'u') return setCmd('');
      if (input && !key.ctrl && !key.meta) setCmd(cmd + input);
      return;
    }

    if (key.upArrow || (key.ctrl && input === 'p')) return move(-1);
    if (key.downArrow || (key.ctrl && input === 'n')) return move(1);
    if (key.pageUp) return move(-listH);
    if (key.pageDown) return move(listH);
    if (key.return) {
      if (selectedRow?.type === 'group') return setFold(selectedRow.key, !selectedRow.folded);
      if (marks.size && useTmux()) return connect('ssh', targets());
      return connect('ssh', selectedHost ? [selectedHost] : []);
    }

    if (mode === 'search') {
      if (key.escape) { changeQuery(''); setMode('normal'); return; }
      if (key.tab) { setMode('normal'); return; }
      if (key.backspace || key.delete) return changeQuery(query.slice(0, -1));
      if (key.ctrl && input === 'u') return changeQuery('');
      if (input && !key.ctrl && !key.meta) return changeQuery(query + input);
      return;
    }

    // normal mode
    switch (input) {
      case '/': setMode('search'); return;
      case '!': if (targets().length) { setMode('command'); setHistIdx(-1); } return;
      case 'q': onAction({ type: 'exit', host: selectedHost }); exit(); return;
      case '?': setMode('help'); return;
      case 'j': return move(1);
      case 'k': return move(-1);
      case 'g': return setCursor(0);
      case 'G': return setCursor(rows.length - 1);
      case 'h': return fold(true);
      case 'l': return fold(false);
      case ' ': { const k = groupKeyAtCursor(); if (k) setFold(k, !folded.has(k)); return; }
      case 's': return connect('sftp', selectedHost ? [selectedHost] : []);
      case 'e': if (selectedHost) { onAction({ type: 'edit', host: selectedHost }); exit(); } return;
      case 'r': probeResults.clear(); infoResults.clear(); onAction({ type: 'reload', host: selectedHost }); exit(); return;
      case 't': {
        const on = toggle('tmux', 'tmux mode');
        if (on && !inTmux()) setFlash({ text: 'tmux mode on — but not inside tmux, so connections stay inline', colour: theme.fav });
        return;
      }
      case 'p': toggle('probes', 'reachability probes'); return;
      case 'i': toggle('info', 'live info'); return;
      case 'C': {
        const next = THEME_NAMES[(THEME_NAMES.indexOf(theme.name) + 1) % THEME_NAMES.length];
        state.prefs = { ...(state.prefs ?? {}), theme: next }; persist();
        onAction({ type: 'reload', host: selectedHost, flash: { text: `theme: ${next}`, colour: 'cyan' } }); exit();
        return;
      }
      case 'm': {
        const next = new Set(marks);
        if (selectedRow?.type === 'group') {
          const all = selectedRow.hosts.every(x => next.has(x.name));
          for (const x of selectedRow.hosts) all ? next.delete(x.name) : next.add(x.name);
        } else if (selectedHost) {
          next.has(selectedHost.name) ? next.delete(selectedHost.name) : next.add(selectedHost.name);
          move(1);
        }
        setMarksPersist(next);
        return;
      }
      case 'M': {
        if (marks.size) { setMarksPersist(new Set()); setFlash({ text: 'marks cleared', colour: theme.dim }); return; }
        setMarksPersist(new Set(rows.filter(r => r.type === 'host').map(r => r.host.name)));
        return;
      }
      case 'c': case 'y': {
        if (!selectedHost) return;
        const how = copyToClipboard(`ssh ${selectedHost.name}`);
        setFlash({ text: `copied "ssh ${selectedHost.name}" (${how})`, colour: theme.up });
        return;
      }
      case 'f': {
        if (!selectedHost) return;
        const added = toggleFavourite(state, selectedHost.name);
        setFavourites([...state.favourites]);
        setFlash({ text: `${added ? '★ added' : '☆ removed'} ${selectedHost.name}`, colour: theme.fav });
        return;
      }
    }
    if (key.leftArrow) return fold(true);
    if (key.rightArrow) return fold(false);
    if (key.tab) { const g = !grouped; setGrouped(g); state.grouped = g; persist(); setCursor(0); setOffset(0); return; }
    if (key.escape) {
      if (query) return changeQuery('');
      if (marks.size) return setMarksPersist(new Set());
      return;
    }
    // Typing a letter that isn't a command starts a search — feels natural.
    if (input && !key.ctrl && !key.meta && /^[A-Za-z0-9._ -]+$/.test(input)) { setMode('search'); changeQuery(input.trimStart()); }
  });

  // ── render ──
  const visible = rows.slice(offset, offset + listH);
  const searchActive = mode === 'search';
  const commandActive = mode === 'command';
  const tmuxLive = toggles.tmux && inTmux();
  const indicator = (on, label, warn) => T({ color: on ? (warn ? theme.fav : theme.accent) : undefined, dimColor: !on, bold: on }, `${on ? '■' : '□'} ${label}  `);
  const hints = commandActive
    ? [['⏎', `run on ${plural(targets().length, 'host')}${tmuxLive ? ' (tmux)' : ''}`], ['↑↓', 'history'], ['Esc', 'cancel']]
    : searchActive
      ? [['⏎', 'connect'], ['↑↓', 'move'], ['Tab', 'done'], ['Esc', 'clear']]
      : [['⏎', marks.size && tmuxLive ? `open ${marks.size}` : 'connect'], ['/', 'search'], ['!', 'run'], ['s', 'sftp'], ['m', 'mark'], ['c', 'copy'], ['f', 'fav'], ['e', 'edit'], ['Tab', grouped ? 'flat' : 'groups'], ['?', 'help'], ['q', 'quit']];
  const targetLabel = marks.size ? `${plural(marks.size, 'marked host')}` : (selectedHost?.name ?? '');

  return h(Box, { flexDirection: 'column', width: dims.cols, height: total },
    // header
    h(Box, { paddingX: 1, justifyContent: 'space-between' },
      h(Box, null,
        T({ bold: true, color: theme.accent }, '⚡ sbpssh'),
        errors.length ? T({ color: theme.fav }, `  ⚠ ${plural(errors.length, 'warning')}`) : null,
        marks.size ? T({ color: theme.marked, bold: true }, `  ✓ ${marks.size} marked`) : null,
      ),
      h(Box, null,
        indicator(toggles.tmux, tmuxLive || !toggles.tmux ? 'tmux' : 'tmux (n/a)', toggles.tmux && !inTmux()),
        indicator(toggles.probes, 'probe'), indicator(toggles.info, 'info'),
        T({ dimColor: true }, `${plural(model.hosts.length, 'host')} · ${plural(model.groups.length, 'file')}`),
      ),
    ),
    // search / command bar
    commandActive
      ? h(Box, { paddingX: 1, justifyContent: 'space-between' },
        h(Box, null, T({ color: theme.marked, bold: true }, '! › '), T({}, cmd), T({ inverse: true }, ' ')),
        T({ dimColor: true }, `on ${targetLabel}`))
      : h(Box, { paddingX: 1, justifyContent: 'space-between' },
        h(Box, null,
          T({ color: searchActive ? theme.accent : theme.dim, bold: searchActive }, '🔍 › '),
          T({}, query),
          searchActive ? T({ inverse: true }, ' ') : (query ? T({ dimColor: true }, '  (Esc clears)') : T({ dimColor: true }, 'type to search')),
        ),
        query ? T({ dimColor: true }, plural(rows.length, 'match', 'es')) : null,
      ),
    // body
    mode === 'help'
      ? h(Box, { flexGrow: 1, borderStyle: 'round', borderColor: theme.borderActive }, h(Help, { width: dims.cols - 4, height: listH, theme }))
      : h(Box, { flexGrow: 1, flexDirection: 'row' },
        h(Box, { width: listW, flexDirection: 'column', borderStyle: 'round', borderColor: searchActive ? theme.borderActive : theme.border, paddingX: 1 },
          ...(visible.length ? visible.map((row, i) => row.type === 'group'
            ? h(GroupRow, { key: row.key, row, selected: offset + i === cur, width: listInner, marks, theme })
            : h(HostRow, { key: `${row.groupKey ?? ''}/${row.host.name}`, row, selected: offset + i === cur, width: listInner, favourites, marks, probes: toggles.probes, theme }))
            : [T({ key: 'none', dimColor: true }, 'no matches')]),
        ),
        h(Box, { flexGrow: 1, flexDirection: 'column', borderStyle: 'round', borderColor: theme.border },
          selectedRow?.type === 'group'
            ? h(GroupDetail, { row: selectedRow, model, width: detailW, height: listH, recent: state.recent })
            : h(Detail, { host: selectedHost, width: detailW, height: listH, favourites, recent: state.recent, marks, probes: toggles.probes, showInfo: toggles.info, theme }),
        ),
      ),
    // footer
    h(Box, { paddingX: 1, justifyContent: 'space-between' },
      h(Text, { wrap: 'truncate' }, ...hints.map(([k, d], i) => T({ key: k }, T({ color: theme.accent, bold: true }, k), T({ dimColor: true }, ` ${d}${i < hints.length - 1 ? '  ' : ''}`)))),
      flash ? T({ color: flash.colour, bold: true }, truncate(flash.text, Math.floor(dims.cols / 2))) : (rows.length > listH ? T({ dimColor: true }, `${cur + 1}/${rows.length}`) : null),
    ),
  );
}

/** Mount the UI in the alternate screen; resolves with the chosen action. */
export function runUi(props) {
  return new Promise((resolve) => {
    let action = { type: 'exit' };
    const touched = [];
    const mouse = props.config.mouse ? '\x1b[?1000h\x1b[?1006h' : '';
    process.stdout.write('\x1b[?1049h\x1b[H\x1b[?25l' + mouse);
    const onAction = (a) => { if (a.type === 'touch') touched.push(...a.hosts); else action = a; };
    const instance = render(h(App, { ...props, onAction }), { exitOnCtrlC: false });
    instance.waitUntilExit().then(() => {
      process.stdout.write((mouse ? '\x1b[?1006l\x1b[?1000l' : '') + '\x1b[?25h\x1b[?1049l');
      resolve({ ...action, touched });
    });
  });
}
