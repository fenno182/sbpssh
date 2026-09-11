// Favourites, recents, marks, command history, folds and UI toggles,
// persisted to ~/.config/sbpssh/state.json.

import fs from 'node:fs';
import path from 'node:path';
import { configDir as dir } from './config.js';

const file = path.join(dir, 'state.json');

export function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { favourites: s.favourites ?? [], recent: s.recent ?? {}, grouped: s.grouped ?? true, folded: s.folded ?? [], marks: s.marks ?? [], commands: s.commands ?? [], prefs: s.prefs ?? {} };
  } catch {
    return { favourites: [], recent: {}, grouped: true, folded: [], marks: [], commands: [], prefs: {} };
  }
}

export function saveState(state) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
  } catch { /* best effort */ }
}

export function toggleFavourite(state, name) {
  const i = state.favourites.indexOf(name);
  if (i >= 0) state.favourites.splice(i, 1); else state.favourites.push(name);
  saveState(state);
  return i < 0;
}

export function touchRecent(state, name) {
  state.recent[name] = new Date().toISOString();
  // keep the list bounded
  const entries = Object.entries(state.recent).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 15);
  state.recent = Object.fromEntries(entries);
  saveState(state);
}

export function relativeTime(iso) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}
