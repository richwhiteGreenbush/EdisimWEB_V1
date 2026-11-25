// Autocomplete for the text editor. DOM-free.
//
// Three cases, decided by where the caret is:
//   - the first word of a line: every command, written as a whole working line at the
//     student's level (the palette in words), filtered by what they have typed;
//   - straight after `tell`: the names of the objects in this world;
//   - anywhere else, part-way through a word: the names this program uses, plus the names
//     other objects share.
// Returns null when there is nothing worth showing, so the popup only appears when it helps.

import { PALETTE_ORDER, BLOCK_DEFS, CATEGORIES, createBlockInstance } from '../BlockDefs.js';
import { printLine } from './print.js';

const WORLD_EVENTS = ['sunrise', 'noon', 'sunset', 'night', 'start'];

// One line per palette block (and one per world event), at a level.
export function commandLines(level) {
  const out = [];
  for (const type of PALETTE_ORDER) {
    const def = BLOCK_DEFS[type];
    const events = type === 'whenWorld' ? WORLD_EVENTS : [null];
    for (const event of events) {
      const block = createBlockInstance(type);
      if (event) block.params.event = event;
      const line = printLine(block, level);
      if (line) out.push({ label: line, insert: line, detail: CATEGORIES[def.category].name, category: def.category });
    }
  }
  return out;
}

export function completions(source, caret, level, { objectNames = [], variableNames = [] } = {}) {
  const src = String(source ?? '');
  const lineStart = src.lastIndexOf('\n', caret - 1) + 1;
  const before = src.slice(lineStart, caret);
  // Not inside a comment or an open quote.
  if (before.includes('#') || (before.match(/["“”]/g) || []).length % 2 === 1) return null;
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? '';
  const from = caret - word.length;
  const head = before.slice(0, before.length - word.length);
  const lower = word.toLowerCase();

  if (/^\s*$/.test(head)) {
    if (!word) return null;
    const items = commandLines(level).filter((c) => c.label.toLowerCase().startsWith(lower));
    // Typing the whole of a one-word command (`forever`) needs no popup.
    if (!items.length || (items.length === 1 && items[0].label.toLowerCase() === lower)) return null;
    return { from, to: caret, items: items.slice(0, 8) };
  }

  if (/^\s*tell\s+$/i.test(head)) {
    const items = [...new Set(objectNames)].filter((n) => n.toLowerCase().startsWith(lower) && n !== word)
      .sort((a, b) => a.localeCompare(b)).map((n) => ({ label: n, insert: n, detail: 'object' }));
    return items.length ? { from, to: caret, items: items.slice(0, 8) } : null;
  }

  if (!word) return null;
  const items = [...new Set(variableNames)].filter((n) => n.toLowerCase().startsWith(lower) && n !== word)
    .sort((a, b) => a.localeCompare(b)).map((n) => ({ label: n, insert: n, detail: 'name' }));
  return items.length ? { from, to: caret, items: items.slice(0, 8) } : null;
}
