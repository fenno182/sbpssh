// Colour themes. Every colour is a chalk/Ink colour name or a hex string.
// `palette` is what groups are coloured with; `tags` colours the prd/tst/… chips.

const base = {
  accent: 'cyan', border: 'gray', borderActive: 'cyan', dim: 'gray',
  fav: 'yellow', marked: 'green', match: 'yellowBright',
  up: 'green', down: 'red', unknown: 'gray',
  tags: { prd: 'red', tst: 'yellow', dev: 'green', stg: 'magenta', mng: 'blue', app: 'cyan', db: 'magenta', pub: 'yellow', web: 'cyan' },
};

export const THEMES = {
  default: {
    ...base,
    palette: ['cyan', 'green', 'yellow', 'magenta', 'blue', 'red', 'cyanBright', 'greenBright', 'yellowBright', 'magentaBright', 'blueBright', 'redBright'],
  },
  catppuccin: {
    ...base, accent: '#89b4fa', border: '#45475a', borderActive: '#89b4fa', dim: '#6c7086',
    fav: '#f9e2af', marked: '#a6e3a1', match: '#f9e2af', up: '#a6e3a1', down: '#f38ba8', unknown: '#6c7086',
    palette: ['#89b4fa', '#a6e3a1', '#f9e2af', '#f5c2e7', '#cba6f7', '#f38ba8', '#94e2d5', '#fab387', '#89dceb', '#eba0ac', '#b4befe', '#74c7ec'],
    tags: { prd: '#f38ba8', tst: '#f9e2af', dev: '#a6e3a1', stg: '#cba6f7', mng: '#89b4fa', app: '#94e2d5', db: '#f5c2e7', pub: '#fab387', web: '#89dceb' },
  },
  dracula: {
    ...base, accent: '#bd93f9', border: '#44475a', borderActive: '#bd93f9', dim: '#6272a4',
    fav: '#f1fa8c', marked: '#50fa7b', match: '#f1fa8c', up: '#50fa7b', down: '#ff5555', unknown: '#6272a4',
    palette: ['#8be9fd', '#50fa7b', '#f1fa8c', '#ff79c6', '#bd93f9', '#ff5555', '#ffb86c', '#8be9fd', '#50fa7b', '#ff79c6', '#bd93f9', '#ffb86c'],
    tags: { prd: '#ff5555', tst: '#f1fa8c', dev: '#50fa7b', stg: '#bd93f9', mng: '#8be9fd', app: '#ff79c6', db: '#ffb86c', pub: '#f1fa8c', web: '#8be9fd' },
  },
  nord: {
    ...base, accent: '#88c0d0', border: '#4c566a', borderActive: '#88c0d0', dim: '#4c566a',
    fav: '#ebcb8b', marked: '#a3be8c', match: '#ebcb8b', up: '#a3be8c', down: '#bf616a', unknown: '#4c566a',
    palette: ['#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead', '#81a1c1', '#bf616a', '#8fbcbb', '#d08770', '#5e81ac', '#a3be8c', '#b48ead', '#88c0d0'],
    tags: { prd: '#bf616a', tst: '#ebcb8b', dev: '#a3be8c', stg: '#b48ead', mng: '#81a1c1', app: '#88c0d0', db: '#d08770', pub: '#ebcb8b', web: '#8fbcbb' },
  },
  gruvbox: {
    ...base, accent: '#fabd2f', border: '#504945', borderActive: '#fabd2f', dim: '#928374',
    fav: '#fabd2f', marked: '#b8bb26', match: '#fabd2f', up: '#b8bb26', down: '#fb4934', unknown: '#928374',
    palette: ['#83a598', '#b8bb26', '#fabd2f', '#d3869b', '#8ec07c', '#fb4934', '#fe8019', '#83a598', '#b8bb26', '#d3869b', '#8ec07c', '#fe8019'],
    tags: { prd: '#fb4934', tst: '#fabd2f', dev: '#b8bb26', stg: '#d3869b', mng: '#83a598', app: '#8ec07c', db: '#d3869b', pub: '#fe8019', web: '#83a598' },
  },
};

export const THEME_NAMES = Object.keys(THEMES);

/** Build the active theme from a name plus user overrides from config.toml. */
export function makeTheme(name, overrides = {}) {
  const t = THEMES[name] ?? THEMES.default;
  return {
    ...t,
    name: THEMES[name] ? name : 'default',
    tags: { ...t.tags, ...(overrides.tags ?? {}) },
    groupColours: overrides.colours ?? {},
  };
}
