#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadHosts } from '../src/sshconfig.js';
import { buildModel } from '../src/model.js';
import { loadState, saveState, touchRecent } from '../src/state.js';
import { loadConfig, EXAMPLE, configDir } from '../src/config.js';
import { makeTheme } from '../src/theme.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith('-') && !['--config', '-F'].includes(args[i - 1]));
const defaultConfig = path.join(os.homedir(), '.ssh', 'config');
const configFile = path.resolve(flag('--config') ?? flag('-F') ?? defaultConfig);
// Only pass -F when the user pointed us at a non-default file, so plain runs behave exactly like typing `ssh <alias>`.
const sshArgs = configFile === defaultConfig ? [] : ['-F', configFile];

if (args.includes('--help') || args.includes('-h')) {
  console.log(`sbpssh — a colourful SSH host picker

usage: sbpssh [QUERY] [--config FILE] [--list] [--json] [--init-config]

  QUERY           start with the search box pre-filled
  --config FILE   ssh config to start from (default ~/.ssh/config); Includes are followed
  --list          print host aliases and exit (for scripting)
  --json          print the resolved hosts as JSON and exit
  --init-config   write an example ~/.config/sbpssh/config.toml (themes, toggles, colours)
`);
  process.exit(0);
}

if (args.includes('--init-config')) {
  const file = path.join(configDir, 'config.toml');
  if (fs.existsSync(file)) { console.error(`${file} already exists`); process.exit(1); }
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(file, EXAMPLE);
  console.log(`wrote ${file}`);
  process.exit(0);
}

const config = loadConfig();
const state = loadState();
// Toggles: config.toml gives the defaults, anything flipped in the UI is remembered in state.
const prefs = () => ({ theme: config.theme, probes: config.probes, info: config.info, tmux: config.tmux, ...(state.prefs ?? {}) });

const load = () => {
  const theme = makeTheme(prefs().theme, config);
  const parsed = loadHosts(configFile);
  const errors = [...parsed.errors, ...(config.error ? [config.error] : [])];
  return { model: buildModel(parsed, configFile, theme), errors, theme };
};

if (args.includes('--list') || args.includes('--json')) {
  const { model } = load();
  if (args.includes('--json')) console.log(JSON.stringify(model.hosts.map(({ options, ...h }) => h), null, 2));
  else for (const g of model.groups) for (const h of g.hosts) console.log(h.name);
  process.exit(0);
}

if (!process.stdout.isTTY) {
  console.error('sbpssh needs a terminal (use --list for scripting)');
  process.exit(1);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const run = (cmd, cmdArgs) => {
  process.stdout.write(`\x1b[36m→ ${cmd} ${cmdArgs.join(' ')}\x1b[0m\n`);
  const res = spawnSync(cmd, cmdArgs, { stdio: 'inherit' });
  if (res.error) return { text: `${cmd}: ${res.error.message}`, colour: 'red' };
  if (res.status) return { text: `${cmd} exited with code ${res.status}`, colour: 'red' };
  return null;
};
const pause = () => spawnSync('sh', ['-c', `printf '\\n${dim('— press enter to return —')}'; read _`], { stdio: 'inherit' });

const { runUi } = await import('../src/ui.js');
let selected = null;
let flash = null;
let initialQuery = positional.join(' ');

for (;;) {
  const { model, errors, theme } = load();
  const action = await runUi({ model, state, errors, config, theme, prefs: prefs(), sshArgs, initialSelected: selected, initialFlash: flash, initialQuery });
  initialQuery = '';
  for (const host of action.touched ?? []) touchRecent(state, host.name);
  selected = action.host?.name ?? selected;
  flash = action.flash ?? null;
  if (action.type === 'exit') break;
  if (action.type === 'reload') { flash ??= { text: 'reloaded', colour: 'green' }; continue; }
  const host = action.host;
  if (action.type === 'ssh') { touchRecent(state, host.name); flash = run('ssh', [...sshArgs, host.name]); }
  else if (action.type === 'sftp') { touchRecent(state, host.name); flash = run('sftp', [...sshArgs, host.name]); }
  else if (action.type === 'edit') {
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
    flash = run(editor, [`+${host.line}`, host.file]);
  } else if (action.type === 'run') {
    let failed = 0;
    for (const target of action.hosts) {
      process.stdout.write(`\n\x1b[1;36m━━ ${target.name} \x1b[0;36m${'━'.repeat(Math.max(0, (process.stdout.columns || 80) - target.name.length - 5))}\x1b[0m\n`);
      const res = spawnSync('ssh', [...sshArgs, target.name, action.command], { stdio: 'inherit' });
      if (res.status || res.error) failed++;
    }
    pause();
    flash = failed ? { text: `${failed}/${action.hosts.length} failed`, colour: 'red' } : { text: `ran on ${action.hosts.length} host${action.hosts.length === 1 ? '' : 's'}`, colour: 'green' };
  }
}
saveState(state);
