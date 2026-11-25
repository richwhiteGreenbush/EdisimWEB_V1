// Blocks -> text, at Basic Beginner (1) or Basic Pro (2).
//
// Blocks to text is always possible and never refuses: every block type has a printer in
// ./commands.js. What it cannot carry over exactly is listed in `notes` (the documented round
// trips), and never silently: a `say a value` becomes `say` with `{x}`, a `when` block left
// inside another block (where it never runs) is left out, and a block type this version does
// not know becomes a comment.

import { BLOCK_DEFS, isVariableRef } from '../BlockDefs.js';
import { PRINTERS, COLOR_NAMES, NAME_RE, isValidName } from './commands.js';

export const INDENT = '    ';

// A number blank holds a number or a name. Numbers print the way the student would type them.
function fmtNum(raw) {
  if (isVariableRef(raw)) return String(raw).trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return '0';
  return String(n);
}

// Beginner text runs to the end of the line, so it can only be written bare when nothing in it
// would read as something else: a quote, a `#` (a comment) or a backslash, or space at either end.
function needsQuotes(text) {
  return text === '' || text !== text.trim() || /["“”#\\]/.test(text);
}

export function quote(text) {
  return `"${String(text).replace(/[\\"“”]/g, (c) => `\\${c}`)}"`;
}

function fmtText(raw, level) {
  const text = String(raw ?? '').replace(/[\r\n]+/g, ' ');
  if (level === 2 || needsQuotes(text)) return quote(text);
  return text;
}

const HEX_TO_NAME = new Map();
for (const [name, hex] of Object.entries(COLOR_NAMES)) if (!HEX_TO_NAME.has(hex)) HEX_TO_NAME.set(hex, name);

function fmtColor(raw, level) {
  const hex = String(raw ?? '').trim().toLowerCase();
  const word = HEX_TO_NAME.get(hex) ?? (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(hex) ? hex : '#ffffff');
  return level === 2 ? `"${word}"` : word;
}

function formatters(level) {
  return {
    num: fmtNum,
    name: (raw) => String(raw ?? '').trim(),
    text: (raw) => fmtText(raw, level),
    color: (raw) => fmtColor(raw, level),
    object: (raw) => {
      const name = String(raw ?? '');
      return isValidName(name) ? name : quote(name);
    },
  };
}

// `say a value` -- the runner's own spacing rules, with the value as `{x}` (or the number
// itself, written with the two places the block would have shown).
function sayValueAsSay(p) {
  const label = String(p.label ?? '').trim();
  const unit = String(p.unit ?? '').trim();
  const head = label ? (label.endsWith('$') ? label : `${label} `) : '';
  const tail = unit ? (/^[%.,;:!?)]/.test(unit) ? unit : ` ${unit}`) : '';
  const value = isVariableRef(p.value) ? `{${String(p.value).trim()}}` : (Number(p.value) || 0).toFixed(2);
  return { type: 'say', params: { text: `${head}${value}${tail}` } };
}

// One block's own line (a C-block's header), with no indentation.
export function printLine(block, level) {
  const f = formatters(level);
  let b = block;
  if (b.type === 'sayValue') b = sayValueAsSay(b.params || {});
  const cmd = PRINTERS.get(b.type);
  if (!cmd) return null;
  return cmd.print(b.params || {}, level, f);
}

// opts.comments: { before: Map(blockId -> [text]), inline: Map(blockId -> text), end: [text] },
// as kept by compile(), so converting a program from one level to the other keeps its comments.
export function printBlocks(blocks, level, opts = {}) {
  const lines = [];
  const notes = [];
  const comments = opts.comments;
  const note = (kind, detail) => { if (!notes.some((n) => n.kind === kind)) notes.push({ kind, detail }); };

  const walk = (list, depth) => {
    for (const block of list || []) {
      const def = BLOCK_DEFS[block.type];
      if (def?.hat && depth > 0) {
        note('nested-hat', 'A `when` block inside another block never runs, so it was left out.');
        continue;
      }
      const pad = INDENT.repeat(depth);
      for (const c of comments?.before?.get(block.id) ?? []) lines.push(`${pad}${c}`);
      const text = printLine(block, level);
      if (text == null) {
        note('unknown', `A block this version of Edusim does not know ("${block.type}") is kept only as a comment.`);
        lines.push(`${pad}# (a "${block.type}" block)`);
        continue;
      }
      if (block.type === 'sayValue') note('sayValue', '"Say a value" became `say` with `{name}`. A whole number now shows as 3, not 3.00.');
      for (const key of ['name', 'value', 'a', 'b', 'count', 'feet', 'seconds', 'degrees', 'percent', 'forward', 'up']) {
        const v = block.params?.[key];
        if (typeof v === 'string' && isVariableRef(v) && !NAME_RE.test(v.trim())) {
          note('odd-name', `The name "${v.trim()}" has characters text names can't have.`);
        }
      }
      const inline = comments?.inline?.get(block.id);
      lines.push(`${pad}${text}${inline ? `  ${inline}` : ''}`);
      if (block.children) walk(block.children, depth + 1);
    }
  };
  walk(blocks, 0);
  for (const c of comments?.end ?? []) lines.push(c);
  return { text: lines.length ? `${lines.join('\n')}\n` : '', notes };
}
