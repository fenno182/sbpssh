# sbpssh

A colourful, keyboard-driven SSH host picker for the terminal. It reads
`~/.ssh/config`, follows every `Include` (globs and all), and shows each host
grouped by the file it came from — so a layout like

```
~/.ssh/config              # just Include lines
~/.ssh/config.d/*.conf     # one file per client
~/.ssh/config.local/*.conf # machine-local
```

turns into one colour-coded list. Pick a host, hit Enter, and it runs plain
`ssh <alias>` — your agent, keys, known_hosts and everything else behave
exactly as they would from the shell.

```
 ⚡ sbpssh                                  □ tmux  ■ probe  ■ info  42 hosts · 11 files
 🔍 › type to search
╭──────────────────────────────────────────╮╭──────────────────────────────────────────╮
│ ▾ ● acme                    acme.conf  3 ││ acme-tst-mng-01                          │
│ ▸  ● acme-tst-mng-01            tst mng ││ [tst] [mng]                              │
│    ● acme-tst-app-01            tst app ││ ──────────────────────────────────────── │
│    ● acme-tst-pub-01            tst pub ││ HostName     203.0.113.10                │
│ ▾ ● shop                    shop.conf  2 ││ User         admin  via acme-*           │
│    ● shop-prd-mng-01            prd mng ││ Port         22                          │
│    ● shop-prd-pub-01            prd pub ││ IdentityFile ~/.ssh/keys/acme_ed25519 ✔  │
│ ▾ ● widgets              widgets.conf  5 ││ ProxyJump    —                           │
│    ● widgets-app01                   app ││                                          │
│    …                                    ││ Source       ~/.ssh/config.d/acme.conf:1 │
│                                         ││ Last used    2d ago                      │
│                                         ││                                          │
│                                         ││ live ─ 12s ago · 34 ms                   │
│                                         ││ Uptime       up 3 weeks, 2 days          │
│                                         ││ OS           Fedora Linux 40             │
│                                         ││ Load         0.12 0.08 0.01              │
╰──────────────────────────────────────────╯╰──────────────────────────────────────────╯
 ⏎ connect  / search  ! run  s sftp  m mark  c copy  f fav  e edit  Tab flat  ? help  q quit
```

**It never writes to your ssh config.** `e` opens the right file at the right
line in `$EDITOR`; that's as far as editing goes.

---

## Install

### Requirements

- **Node.js ≥ 20** (`node --version`)
- `ssh` (and `sftp`) on your PATH — OpenSSH on Linux/macOS/Windows
- Linux, macOS or Windows (Windows Terminal recommended)
- Optional: **tmux** for tmux mode. Clipboard copy uses wl-copy/xclip/xsel,
  pbcopy or clip.exe, falling back to the terminal's OSC 52 clipboard

### Option A — clone and symlink (recommended)

Keeps the code somewhere you can `git pull`, and puts a `sbpssh` command on
your PATH without needing root.

```bash
git clone https://github.com/fenno182/sbpssh.git ~/projects/sbpssh
cd ~/projects/sbpssh && npm install
mkdir -p ~/.local/bin && ln -s ~/projects/sbpssh/bin/sbpssh.js ~/.local/bin/sbpssh
```

Make sure `~/.local/bin` is on your PATH (most distros do this already;
otherwise add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc).

To update later:

```bash
cd ~/projects/sbpssh && git pull && npm install
```

### Option B — npm global install

Works if your npm global prefix is user-writable (e.g. you use nvm/fnm/volta).

```bash
npm install -g github:fenno182/sbpssh
```

If that fails with `EACCES`, use option A rather than `sudo`.

### Windows (PowerShell)

Works in **Windows Terminal** with PowerShell 7 or 5.1. It uses the built-in
OpenSSH client and reads `C:\Users\<you>\.ssh\config`, Includes and all.

```powershell
winget install OpenJS.NodeJS.LTS Git.Git    # skip whichever you already have
```

Open a new terminal so `node`/`npm` are on the PATH, then:

```powershell
npm install -g github:fenno182/sbpssh
sbpssh
```

Notes:

- If PowerShell refuses to run `sbpssh` with an *execution policy* error, either
  run `sbpssh.cmd` instead, or allow local scripts once:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- Use Windows Terminal rather than the legacy console window — the old
  `conhost` doesn't render the box drawing / colours / mouse properly.
- `e` opens files in Notepad unless `$env:EDITOR` is set (e.g. `code -g` or `micro`).
- Settings live in `%APPDATA%\sbpssh\` (`config.toml`, `state.json`).
- tmux mode is inert on Windows; connections run inline.
- Update with `npm update -g sbpssh`.

### Uninstall

```bash
rm ~/.local/bin/sbpssh && rm -rf ~/projects/sbpssh    # option A
npm uninstall -g sbpssh                              # option B
rm -rf ~/.config/sbpssh                              # favourites, state, config
```

---

## User guide

### First run

```bash
sbpssh
```

You'll see every host from `~/.ssh/config` and its `Include`s, grouped by
source file, with a detail pane on the right. Within a few seconds a dot
appears next to each host: **green** = reachable, **red** = not, `◌` = still
checking. Press `?` at any time for the key list.

Useful variants:

```bash
sbpssh odl                 # start with the search box pre-filled
sbpssh --config ~/work/ssh_config   # use a different starting config (passes -F to ssh)
sbpssh --list              # just print host aliases (for scripts / fzf)
sbpssh --json              # resolved hosts as JSON
sbpssh --init-config       # write an example ~/.config/sbpssh/config.toml
```

### Moving around

- `↑` `↓` or `j` `k` move; `PgUp` `PgDn` page; `g` `G` jump to top/bottom.
- `←` `→` (or `h` `l`, or `space`) fold and unfold a group. Folds are remembered.
- `Tab` switches between the grouped view and a flat alphabetical list.
- Mouse works too: click to select, wheel to scroll, click the `▾` on a group
  header (or double-click it) to fold, double-click a host to connect.

### Finding a host

Just start typing — any letter that isn't a command key starts a fuzzy
search across host name, group, hostname and user. Or press `/` first.

- `Esc` clears the search and goes back to the full list.
- `Tab` keeps the filter but returns to normal mode so command keys work.
- `⏎` connects to the highlighted match straight from search mode.

### Connecting

- `⏎` runs `ssh <alias>`. sbpssh gets out of the way, ssh runs exactly as it
  would from your shell, and when you exit you're back on the same row.
- `s` does the same with `sftp`.
- `c` (or `y`) copies `ssh <alias>` to the clipboard.
- `e` opens the config file that defines this host, at that line, in `$EDITOR`.

### Favourites and recents

`f` toggles a favourite (★). Favourites and your five most recent connections
get their own groups at the top of the list, so day-to-day hosts are always
one keypress away.

### Marking several hosts

- `m` marks the current host (✓) and moves down. On a group header it marks
  the whole group — handy for a cluster like `acme-*`.
- `M` marks everything currently visible (or clears all marks if any exist).
- `Esc` clears marks.

Marks feed the command runner and tmux mode below, and are remembered
between runs.

### Running a command on one or many hosts

Press `!`, type a command, hit `⏎`. It runs on the selected host — or on
**every marked host** in turn, each under its own header — then pauses so you
can read the output. `↑` `↓` in the prompt recall previous commands.

```
━━ acme-tst-mng-01 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 22:41:03 up 23 days,  3:12,  0 users,  load average: 0.03, 0.04, 0.00
━━ acme-tst-app-01 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 22:41:04 up 23 days,  3:11,  0 users,  load average: 0.10, 0.06, 0.01

— press enter to return —
```

### tmux mode

If you live in tmux, press `t` (the header shows `■ tmux`). Now:

- `⏎` opens the host in a **new tmux window** and switches to it, leaving
  sbpssh running in its own window as a launcher.
- With several hosts marked, `⏎` opens a window for each and **stays** on
  sbpssh.
- `!` runs the command in a window per host, which stays open until you press
  enter.

Outside tmux the toggle is inert and everything runs inline as normal. The
setting is remembered.

### Reachability and live info

- **Probes** (`p` to toggle): a plain TCP connect to each host's port, refreshed
  every minute. Hosts behind a `ProxyJump` probe the jump host instead. Group
  headers show `3 up · 1 down` in the pane.
- **Live info** (`i` to toggle): when the cursor rests on a *reachable* host
  for about half a second, sbpssh runs one non-interactive ssh command to
  fetch uptime, OS, kernel, load, memory and disk, and shows it in the pane.
  Results are cached for five minutes. It uses `BatchMode` so it can never
  hang on a password prompt — if your key isn't in the agent you'll see
  `✘ Permission denied` and nothing else happens.

  Note this does mean a login appears in the auth log of any host you pause
  on. Turn it off with `i` or `info = false` if you'd rather it didn't.

- `r` reloads the configs and re-probes everything.

### Themes and configuration

`C` cycles through the built-in themes: default, catppuccin, dracula, nord,
gruvbox. For anything more, create a config file:

```bash
sbpssh --init-config     # writes ~/.config/sbpssh/config.toml
```

```toml
theme = "default"        # default | catppuccin | dracula | nord | gruvbox
mouse = true
probes = true            # reachability dots            (toggle with p)
info = true              # live uptime/OS in the pane   (toggle with i)
tmux = false             # connect in new tmux windows  (toggle with t)
probe_timeout_ms = 3000
probe_interval_s = 60

[colours]                # per-group (per-file) colour overrides — names or hex
widgets = "#f38ba8"
acme = "cyan"

[tags]                   # tag chip colours
prd = "red"
tst = "yellow"
```

Group names are the file names without `.conf` (`config.d/widgets.conf` →
`widgets`); hosts in the top-level `~/.ssh/config` are the `config` group.

Anything you toggle in the UI (`t` `p` `i` `C`) is remembered in
`~/.config/sbpssh/state.json` and wins over `config.toml`. Favourites, recents,
marks, folds, command history and the grouped/flat choice live there too.
Delete the file to reset everything.

### All keys

| key | action |
| --- | --- |
| `⏎` | connect (on a group header: fold/unfold; with marks in tmux mode: open every marked host) |
| just type, or `/` | fuzzy search — `Esc` clears, `Tab` keeps the filter |
| `!` | run a command on the selected host, or on every marked host — `↑↓` cycles history |
| `m` / `M` | mark host (or whole group) · mark all visible / clear all |
| `↑↓` `j` `k` `PgUp` `PgDn` `g` `G` | move |
| `←` `→` `space` `h` `l` | fold / unfold group |
| `Tab` | grouped ↔ flat list |
| `s` | `sftp` to the host |
| `c` / `y` | copy `ssh <alias>` to the clipboard |
| `f` | toggle favourite |
| `e` | open the config file at this host in `$EDITOR` |
| `t` `p` `i` | toggle tmux mode · reachability probes · live info |
| `C` | cycle colour theme |
| `r` | reload configs and re-probe |
| `?` | help |
| `q` / `Ctrl-C` | quit |

---

## What it understands about ssh_config

- `Include` directives, recursively, with `~` and `*`/`?` globs, relative to `~/.ssh`.
- Wildcard blocks such as `Host acme-*` are **folded into** the concrete hosts
  they match (first value wins, like ssh itself) and are not listed on their
  own. The detail pane shows `via acme-*` next to any value that came from one.
- Multi-pattern `Host a b` lines, `Key=value` syntax, `!negated` patterns,
  accumulating options (`IdentityFile`, `LocalForward`, …).
- `Match` blocks are parsed but not evaluated (they depend on runtime state).
- Tags are inferred from name segments: `prd`/`prod`, `tst`/`test`, `dev`,
  `stg`; `mng`, `app`, `db`/`dbase`/`dat`, `pub`, `web`.
- Whether each `IdentityFile` actually exists on disk (✔ / ✘).

## Troubleshooting

- **`sbpssh: command not found`** — `~/.local/bin` isn't on your PATH, or the
  symlink points at the wrong place (`ls -l ~/.local/bin/sbpssh`).
- **`npm link` fails with EACCES** — your npm prefix is system-wide; use the
  symlink install instead.
- **Every host shows a red dot** — probes are plain TCP connects; a firewall
  or VPN that only allows ssh via a jump host will look "down". Turn probes
  off with `p`, or define the `ProxyJump` in your config so the jump host is
  probed instead.
- **Live info says `Permission denied`** — the host needs a key your agent
  has loaded; `BatchMode` never prompts for passwords.
- **Clicks don't register** — some terminals need mouse reporting enabled;
  keyboard always works. Set `mouse = false` to be able to select text with
  the mouse again.
- **Weird key behaviour** — `SBPSSH_DEBUG=/tmp/keys.log sbpssh` logs every raw
  input chunk; include it in an issue.

## Development

```bash
npm test
```

`src/sshconfig.js` is the parser/resolver, `src/model.js` builds groups, colours
and tags, `src/theme.js` and `src/config.js` handle themes and `config.toml`,
`src/probe.js` does reachability probes and live-info fetches, `src/state.js`
persists favourites and toggles, `src/ui.js` is the Ink UI, and `bin/sbpssh.js`
wires it together (the UI hands back an action, the CLI runs `ssh`, then
re-mounts the UI).
