// Colouring for the text editor. DOM-free: returns an HTML string for the highlight layer that
// sits under the editor's textarea.
//
// A line's command words take the colour of the BLOCK CATEGORY they compile to -- `rotate` is
// motion blue, `say` is look purple, `repeat` is control orange -- the same colours as the
// palette, so a student moving between Blocks and text sees the same thing in both. Names are
// math green, numbers and text have their own colours, and every problem the compiler found is
// underlined in place (red for a problem, amber for a warning).

import { BLOCK_DEFS, CATEGORIES } from '../BlockDefs.js';
import { COMMANDS } from './commands.js';
import { compilePattern, firstWords } from './patterns.js';
import { lexLines } from './lexer.js';

// Every literal word in every pattern: these are command words, not names.
const LITERALS = new Set();
const CATEGORY_BY_FIRST_WORD = new Map();
for (const cmd of COMMANDS) {
  const category = BLOCK_DEFS[cmd.block]?.category ?? 'control';
  for (const form of cmd.forms) {
    const els = compilePattern(form.p);
    const walk = (xs) => {
      for (const e of xs) {
        // Retired forms (`move X by`) and one-letter words (`when I hear`) would paint the
        // commonest names in programs, `x` and `i`, as command words.
        if (e.k === 'lit' && !cmd.retired) e.words.filter((w) => w.length > 1).forEach((w) => LITERALS.add(w));
        else if (e.k === 'opt' || e.k === 'group') e.alts.forEach(walk);
      }
    };
    walk(els);
    for (const w of firstWords(els)) if (!CATEGORY_BY_FIRST_WORD.has(w)) CATEGORY_BY_FIRST_WORD.set(w, category);
  }
}
// `set` starts both look (`set size to`) and math lines; the word itself is coloured by what the
// rest of the line is, below.
const OBJECT_WORDS = new Set(['size', 'tilt', 'opacity']);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lineCategory(ln) {
  const t = ln.tokens;
  if (!t.length) return null;
  if (t[1]?.type === 'op' && t[1].text === '=') return 'math';
  const first = t[0].text.toLowerCase();
  if (first === 'set') {
    const second = t[1]?.text.toLowerCase();
    if (second === 'tilt') return 'motion';
    if (OBJECT_WORDS.has(second)) return 'look';
    return 'math';
  }
  if (first === 'change') return OBJECT_WORDS.has(t[1]?.text.toLowerCase()) || /^colou?r$/i.test(t[1]?.text ?? '') ? 'look' : 'math';
  return CATEGORY_BY_FIRST_WORD.get(first) ?? null;
}

// diagnostics: as compile() returns them. Returns the HTML for the whole source.
// Where a line's free text starts (rest-of-line text at Beginner), as a token index, or -1.
// Words in a student's own text are text, even when one happens to be a command word.
function textStart(ln) {
  const w = ln.tokens.map((t) => (t.type === 'word' ? t.text.toLowerCase() : t.text));
  if (w[0] === 'say') return 1;
  if (w[0] === 'tell') return 2;
  if (w[0] === 'when' && w[1] === 'an' && w[2] === 'object' && w[3] === 'says') return 4;
  if (w[0] === 'when' && w[1] === 'i' && w[2] === 'hear') return 3;
  return -1;
}

// Per character: a token class and an inline style (a command word's category colour).
function classify(src) {
  const cls = new Array(src.length).fill('');
  const style = new Array(src.length).fill('');
  for (const ln of lexLines(src)) {
    const category = lineCategory(ln);
    const color = category ? CATEGORIES[category].fill : null;
    const textFrom = textStart(ln);
    for (const [index, t] of ln.tokens.entries()) {
      let c = '';
      let st = '';
      if (textFrom >= 0 && index >= textFrom) c = t.type === 'string' ? 'tc-s' : 'tc-t';
      else if (t.type === 'string') c = 'tc-s';
      else if (t.type === 'number') c = 'tc-n';
      else if (t.type === 'color') { c = 'tc-col'; st = `border-bottom-color:${t.text}`; }
      else if (t.type === 'op') c = 'tc-o';
      else if (t.type === 'word') {
        const w = t.text.toLowerCase();
        if (LITERALS.has(w) && color) { c = 'tc-k'; st = `color:${color}`; }
        else if (LITERALS.has(w)) c = 'tc-k';
        else c = 'tc-v';
      }
      for (let i = t.from; i < t.to; i++) { cls[i] = c; style[i] = st; }
    }
    if (ln.comment) for (let i = ln.comment.from; i < ln.comment.to; i++) cls[i] = 'tc-c';
  }
  return { cls, style };
}

export function highlight(source, diagnostics = []) {
  const src = String(source ?? '');
  const { cls, style } = classify(src);
  const mark = new Array(src.length).fill('');
  for (const d of diagnostics) {
    const m = d.severity === 'error' ? ' tc-err' : ' tc-warn';
    for (let i = Math.max(0, d.from); i < Math.min(src.length, Math.max(d.to, d.from + 1)); i++) if (mark[i] !== ' tc-err') mark[i] = m;
  }

  let html = '';
  let i = 0;
  while (i < src.length) {
    const key = `${cls[i]}|${style[i]}|${mark[i]}`;
    let j = i + 1;
    while (j < src.length && `${cls[j]}|${style[j]}|${mark[j]}` === key && src[j] !== '\n') j++;
    const text = esc(src.slice(i, j));
    const c = `${cls[i]}${mark[i]}`.trim();
    html += c || style[i] ? `<span${c ? ` class="${c}"` : ''}${style[i] ? ` style="${style[i]}"` : ''}>${text}</span>` : text;
    i = j;
  }
  return html;
}

// The same colours for a canvas: one array of { text, color } runs per line. The code boards in
// the worlds paint with this, so a board and the editor a student types into are one palette.
export const TOKEN_COLORS = {
  'tc-v': '#7fd99a', 'tc-n': '#f7a26c', 'tc-s': '#e6d38a', 'tc-t': '#e6d38a', 'tc-o': '#b8c4ce',
  'tc-c': '#66757f', 'tc-k': '#e8eef4', 'tc-col': '#e8eef4', '': '#e8eef4',
};

export function colorRuns(source) {
  const src = String(source ?? '');
  const { cls, style } = classify(src);
  const lines = [[]];
  let i = 0;
  while (i < src.length) {
    if (src[i] === '\n') {
      lines.push([]);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < src.length && src[j] !== '\n' && cls[j] === cls[i] && style[j] === style[i]) j++;
    const inline = /color:([^;]+)/.exec(style[i])?.[1];
    lines[lines.length - 1].push({ text: src.slice(i, j), color: inline ?? TOKEN_COLORS[cls[i]] ?? TOKEN_COLORS[''] });
    i = j;
  }
  return lines;
}
