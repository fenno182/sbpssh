// User configuration from ~/.config/sbpssh/config.toml (all keys optional).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';

export const configDir = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'sbpssh')
  : path.join(os.homedir(), '.config', 'sbpssh');

export const DEFAULTS = {
  theme: 'default',
  mouse: true,
  probes: true,        // reachability dots (toggle: p)
  info: true,          // live uptime/OS for the selected host (toggle: i)
  tmux: false,         // open connections in new tmux windows (toggle: t)
  probe_timeout_ms: 3000,
  probe_interval_s: 60,
  colours: {},         // per-group colour overrides, e.g. widgets = "#f38ba8"
  tags: {},            // tag colour overrides, e.g. prd = "red"
};

export const EXAMPLE = `# sbpssh configuration — every key is optional
theme = "default"        # default | catppuccin | dracula | nord | gruvbox   (cycle with C)
mouse = true
probes = true            # reachability dots            (toggle with p)
info = true              # live uptime/OS in the pane   (toggle with i)
tmux = false             # connect in new tmux windows  (toggle with t)
probe_timeout_ms = 3000
probe_interval_s = 60

[colours]                # per-group (per-file) colour overrides
# widgets = "#f38ba8"

[tags]                   # tag chip colours
# prd = "red"
`;

export function loadConfig() {
  const file = path.join(configDir, 'config.toml');
  let user = {};
  let error = null;
  try {
    user = parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') error = `config.toml: ${e.message}`;
  }
  return { ...DEFAULTS, ...user, colours: { ...user.colours }, tags: { ...user.tags }, file, error };
}
