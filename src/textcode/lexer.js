// FORKED FROM VisualHedy (src/lang/lexer.ts, commit 457a9cb), converted to plain JavaScript.
// See ./README.md for why it is a fork and what differs.
//
// Line-by-line lexer. Each source line becomes a SourceLine with its indent width and its
// tokens (a comment is split off). `lineStream()` turns the lines into an INDENT / DEDENT
// stream. Rest-of-line text is NOT decided here: the lexer always produces words, numbers,
// strings and punctuation with exact offsets, and the parser slices the raw source for a
// text slot, so `don't`, `!` and `?` survive untouched. Never throws.
//
// Edusim differences from VisualHedy's copy:
//  - a `#rrggbb` / `#rgb` colour is a `color` token wherever it appears (VisualHedy only
//    takes it straight after the word `color`), because Edusim writes `change color to #e0455f`;
//  - `^` and `%` are operators, and the block palette's own symbols (× ÷ − ≤ ≥) lex as the
//    keyboard operators they stand for, so a line copied off a block still reads.

export const TAB_WIDTH = 4;

const MULTI_OPS = ['==', '!=', '<=', '>=', '+=', '-=', '*=', '/='];
const SINGLE_OPS = '=<>+-*/%^()[]{},.:;';
// The block palette draws these. Typed or pasted, they mean the keyboard operator.
const OP_ALIASES = new Map([['×', '*'], ['÷', '/'], ['−', '-'], ['≤', '<='], ['≥', '>=']]);

const WORD_START = /[\p{L}_]/u;
const WORD_PART = /[\p{L}\p{N}_]/u;

const isSpace = (ch) => ch === ' ' || ch === ' ';
const isInvisible = (ch) => ch === '﻿' || ch === '​';
// Curly quotes from docs and slides work like straight `"`.
const isQuote = (ch) => ch === '"' || ch === '“' || ch === '”';

// `\n`, `\r\n` and a lone `\r` all end a line.
export function lexLines(source) {
  const src = String(source ?? '');
  const out = [];
  let start = 0;
  let lineNo = 1;
  const re = /\r\n?|\n/g;
  for (;;) {
    re.lastIndex = start;
    const m = re.exec(src);
    const end = m ? m.index : src.length;
    out.push(lexLine(src.slice(start, end), start, lineNo));
    if (!m) break;
    start = m.index + m[0].length;
    lineNo++;
  }
  return out;
}

function lexLine(text, start, line) {
  let indent = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isSpace(ch)) indent++;
    else if (isInvisible(ch)) { /* zero width */ }
    else if (ch === '\t') indent = (Math.floor(indent / TAB_WIDTH) + 1) * TAB_WIDTH;
    else break;
    i++;
  }
  const indentChars = i;
  const tokens = [];
  let comment;
  const mk = (type, from, to, extra) => ({
    type,
    text: text.slice(from, to),
    from: start + from,
    to: start + to,
    line,
    col: from + 1,
    endCol: to + 1,
    ...extra,
  });
  while (i < text.length) {
    const ch = text[i];
    if (isSpace(ch) || isInvisible(ch) || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '#') {
      const hex = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\p{L}\p{N}_])/u.exec(text.slice(i));
      if (hex) {
        tokens.push(mk('color', i, i + hex[0].length));
        i += hex[0].length;
        continue;
      }
      comment = mk('comment', i, text.length);
      break;
    }
    if (isQuote(ch)) {
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\' && j + 1 < text.length && (isQuote(text[j + 1]) || text[j + 1] === '\\')) {
          value += text[j + 1];
          j += 2;
          continue;
        }
        if (isQuote(c)) {
          closed = true;
          j++;
          break;
        }
        value += c;
        j++;
      }
      tokens.push(mk('string', i, j, { value, ...(closed ? {} : { unclosed: true }) }));
      i = j;
      continue;
    }
    if (ch >= '0' && ch <= '9' || (ch === '.' && text[i + 1] >= '0' && text[i + 1] <= '9')) {
      let j = i;
      while (j < text.length && text[j] >= '0' && text[j] <= '9') j++;
      if (text[j] === '.' && j + 1 < text.length && text[j + 1] >= '0' && text[j + 1] <= '9') {
        j++;
        while (j < text.length && text[j] >= '0' && text[j] <= '9') j++;
      }
      tokens.push(mk('number', i, j, { value: Number(text.slice(i, j)) }));
      i = j;
      continue;
    }
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < text.length && WORD_PART.test(text[j])) j++;
      tokens.push(mk('word', i, j));
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) {
      tokens.push(mk('op', i, i + 2));
      i += 2;
      continue;
    }
    if (OP_ALIASES.has(ch)) {
      tokens.push({ ...mk('op', i, i + 1), text: OP_ALIASES.get(ch) });
      i++;
      continue;
    }
    if (SINGLE_OPS.includes(ch)) {
      tokens.push(mk('op', i, i + 1));
      i++;
      continue;
    }
    // Anything else (apostrophes, !, ?, emoji...) is a single "other" token; text keeps it raw.
    const cp = text.codePointAt(i);
    const w = cp > 0xffff ? 2 : 1;
    tokens.push(mk('other', i, i + w));
    i += w;
  }
  return {
    line,
    start,
    end: start + text.length,
    text,
    indent,
    indentChars,
    tokens,
    ...(comment ? { comment } : {}),
    blank: tokens.length === 0,
  };
}

// Lines into a tree: every non-blank line with the lines pushed in under it as `children`.
// A line that dedents to a column no open block uses snaps to the enclosing block and is
// marked `ragged` (VisualHedy's E106). Blank and comment-only lines are skipped here; the
// compiler keeps comment lines separately so a conversion can put them back.
export function lineTree(lines) {
  const root = { line: null, indent: -1, children: [] };
  const stack = [root];
  for (const ln of lines) {
    if (ln.blank) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= ln.indent) stack.pop();
    const parent = stack[stack.length - 1];
    const node = { line: ln, indent: ln.indent, children: [], ragged: false };
    // Ragged: deeper than its parent's column, but shallower than a sibling block already
    // there, i.e. it lines up with nothing.
    const sibling = parent.children[parent.children.length - 1];
    // The top level is checked by the compiler instead (anything not at the left edge there is
    // pushed in for no reason, E105), so a whole program pasted in with a margin reports once.
    if (parent !== root && sibling && ln.indent !== sibling.indent) node.ragged = true;
    parent.children.push(node);
    stack.push(node);
  }
  return root.children;
}
