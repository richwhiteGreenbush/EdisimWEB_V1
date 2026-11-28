// The Text view: every script as lines of text, and lines of text back into scripts.
//
// THE TEXT IS GENERATED FROM THE BLOCK TABLE, so every block has a text form with nothing to keep in
// step: a line is a block's own label with its slots filled in. Indentation (four spaces) and a colon
// show what is inside a loop or an if, the way Python does, which is the bridge to typed code:
//
//     when flag clicked:
//         set score to 0
//         forever:
//             if (key "right arrow" pressed?) then:
//                 point in direction 90
//                 change x by 9
//
// Slots: a number is written bare, text and menu choices in double quotes, and a reporter in round
// brackets: (x position), (pick random 1 to 10), (join "Hi " (answer)). A variable is a reporter too:
// (score). An empty true/false slot is ().
//
// Like the main app's text coding, TEXT COMPILES TO BLOCKS. What is saved, run and shared is always
// the block tree; the text is a way of reading and writing it.
import { BLOCKS, blockDef, labelParts } from '../blocks/defs.js';
import { createBlock } from '../blocks/make.js';

const MENU_TEXT = { _mouse_: 'mouse-pointer', _edge_: 'edge', _random_: 'random position', _myself_: 'myself', _stage_: 'Stage' };
const MENU_VALUE = Object.fromEntries(Object.entries(MENU_TEXT).map(([k, v]) => [v, k]));

// Words a label uses that are written differently in text.
const WORD_TEXT = { '↻': 'right', '↺': 'left' };
const WORD_BACK = { right: '↻', left: '↺' };

// --- printing ---------------------------------------------------------------------------------

function quote(s) {
  return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isNumberText(v) {
  return typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && v.trim() !== '');
}

function slotText(block, name, spec) {
  const input = block.inputs?.[name] || {};
  if (input.block) return `(${expr(input.block)})`;
  if (spec.kind === 'boolean') return '()';
  if (spec.kind === 'number') return isNumberText(input.value) ? String(Number(input.value)) : quote(input.value);
  if (spec.kind === 'menu' || spec.kind === 'variable') return quote(MENU_TEXT[input.value] ?? input.value);
  // A number in a text slot is written bare too: (y position) < -165 reads better than < "-165".
  if (isNumberText(input.value)) return String(Number(input.value));
  return quote(input.value);
}

function labelText(block, which = 'label') {
  const def = blockDef(block.type);
  if (!def) return `unknown block ${quote(block.type)}`;
  if (block.type === 'data_variable') return String(block.inputs.VARIABLE.value);
  const out = [];
  for (const part of labelParts(def, which)) {
    if (part.text != null) {
      for (const w of part.text.trim().split(/\s+/)) if (w) out.push(WORD_TEXT[w] || w);
      continue;
    }
    if (part.input === 'FLAG') { out.push('flag'); continue; }
    out.push(slotText(block, part.input, def.inputs[part.input]));
  }
  return out.join(' ');
}

function expr(block) {
  return labelText(block);
}

function printBlocks(blocks, depth, lines) {
  const pad = '    '.repeat(depth);
  for (const b of blocks) {
    const def = blockDef(b.type);
    if (def?.shape === 'c' || def?.shape === 'c2') {
      lines.push(`${pad}${labelText(b)}:`);
      if (b.substack?.length) printBlocks(b.substack, depth + 1, lines);
      else lines.push(`${pad}    pass`);
      if (def.shape === 'c2') {
        lines.push(`${pad}else:`);
        if (b.substack2?.length) printBlocks(b.substack2, depth + 1, lines);
        else lines.push(`${pad}    pass`);
      }
    } else if (def?.shape === 'hat') {
      lines.push(`${pad}${labelText(b)}:`);
    } else if (def && (def.shape === 'reporter' || def.shape === 'boolean')) {
      lines.push(`${pad}(${labelText(b)})`);
    } else {
      lines.push(`${pad}${labelText(b)}`);
    }
  }
}

// A whole target's scripts. A script that starts with a hat has its body indented under it.
export function printScripts(scripts) {
  const lines = [];
  scripts.forEach((s, i) => {
    if (i) lines.push('');
    const [first, ...rest] = s.blocks;
    if (first && blockDef(first.type)?.shape === 'hat') {
      printBlocks([first], 0, lines);
      if (rest.length) printBlocks(rest, 1, lines);
      else lines.push('    pass');
    } else {
      lines.push('script:');
      printBlocks(s.blocks, 1, lines);
    }
  });
  return lines.join('\n');
}

// --- parsing ----------------------------------------------------------------------------------

export class TextError extends Error {
  constructor(line, message) {
    super(`Line ${line}: ${message}`);
    this.line = line;
  }
}

function tokenize(text, line) {
  const toks = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { s += text[i + 1]; i += 2; continue; }
        s += text[i++];
      }
      if (i >= text.length) throw new TextError(line, 'A piece of text in quotes is missing its closing ".');
      i++;
      toks.push({ k: 'str', v: s });
      continue;
    }
    if (c === '(' || c === ')') { toks.push({ k: c }); i++; continue; }
    const m = /^(-?\d+(\.\d+)?(?![\w]))/.exec(text.slice(i));
    if (m) {
      toks.push({ k: 'num', v: m[1] });
      i += m[1].length;
      continue;
    }
    let w = '';
    while (i < text.length && !' \t"()'.includes(text[i])) w += text[i++];
    toks.push({ k: 'word', v: w });
  }
  return toks;
}

// Each block's label as a pattern of words and slots, longest first so "go to x: y:" is tried
// before "go to".
const PATTERNS = [...BLOCKS.values()].filter((d) => d.type !== 'data_variable').map((def) => {
  const parts = [];
  for (const part of labelParts(def)) {
    if (part.text != null) {
      for (const w of part.text.trim().split(/\s+/)) if (w) parts.push({ word: (WORD_TEXT[w] || w).toLowerCase() });
    } else if (part.input === 'FLAG') parts.push({ word: 'flag' });
    else parts.push({ input: part.input, spec: def.inputs[part.input] });
  }
  return { def, parts };
}).sort((a, b) => b.parts.length - a.parts.length
  // Among labels of the same length, the one whose menu has a fixed list is tried first: ("abs" of 9)
  // is maths, and only a choice that is not one of its operators falls through to "x position" of a sprite.
  || staticMenus(b) - staticMenus(a));

function staticMenus(pat) {
  return pat.parts.filter((p) => p.spec?.kind === 'menu' && Array.isArray(p.spec.options)).length;
}

// Reads one value: a number, a quoted string, or a bracketed reporter. Returns [value, next index].
function readValue(toks, i, ctx, line) {
  const t = toks[i];
  if (!t) return null;
  if (t.k === 'num') return [{ value: t.v }, i + 1];
  if (t.k === 'str') return [{ value: t.v }, i + 1];
  if (t.k === '(') {
    let depth = 0;
    let j = i;
    for (; j < toks.length; j++) {
      if (toks[j].k === '(') depth++;
      else if (toks[j].k === ')') { depth--; if (!depth) break; }
    }
    if (depth) throw new TextError(line, 'A ( is missing its ).');
    const inner = toks.slice(i + 1, j);
    if (!inner.length) return [{ empty: true }, j + 1];
    return [{ block: parseReporter(inner, ctx, line) }, j + 1];
  }
  return null;
}

function matchPattern(pat, toks, ctx, line) {
  let i = 0;
  const values = {};
  for (const part of pat.parts) {
    if (part.word) {
      const t = toks[i];
      if (!t || t.k !== 'word' || t.v.toLowerCase() !== part.word) {
        // "change x by -10": a label word may arrive glued to a number by the tokenizer.
        return null;
      }
      i++;
      continue;
    }
    // A choice from a menu is always written in quotes, which is what tells "sqrt" of 9 (maths)
    // from "x position" of "Ball" (another sprite).
    if (part.spec.kind === 'menu' || part.spec.kind === 'variable') {
      const t = toks[i];
      if (!t || t.k !== 'str') return null;
      if (part.spec.kind === 'menu' && Array.isArray(part.spec.options) && !part.spec.options.includes(MENU_VALUE[t.v] ?? t.v)) return null;
      values[part.input] = { value: t.v };
      i++;
      continue;
    }
    const got = readValue(toks, i, ctx, line);
    if (!got) return null;
    values[part.input] = got[0];
    i = got[1];
  }
  if (i !== toks.length) return null;
  return values;
}

function build(def, values, line) {
  const block = createBlock(def.type);
  for (const [name, v] of Object.entries(values)) {
    const spec = def.inputs[name];
    if (v.block) {
      const shape = blockDef(v.block.type)?.shape;
      if (spec.kind === 'menu' || spec.kind === 'variable') throw new TextError(line, `"${name.toLowerCase()}" needs a choice in quotes, not a reporter.`);
      if (spec.kind === 'boolean' && shape !== 'boolean') throw new TextError(line, 'This slot needs a true-or-false block, like (touching "edge" ?) or (score > 10).');
      block.inputs[name].block = v.block;
    } else if (v.empty) {
      if (spec.kind !== 'boolean') block.inputs[name].value = '';
    } else {
      let value = v.value;
      if (spec.kind === 'menu' && MENU_VALUE[value]) value = MENU_VALUE[value];
      if (spec.kind === 'boolean') throw new TextError(line, 'A true-or-false slot needs a block in brackets, like (mouse down?).');
      if (spec.kind === 'number' && value !== '' && !Number.isFinite(Number(value))) {
        block.inputs[name].value = value; // text in a number slot: allowed, as in Scratch
      } else block.inputs[name].value = spec.kind === 'number' && value !== '' ? Number(value) : value;
    }
  }
  return block;
}

function parseReporter(toks, ctx, line) {
  if (toks.length === 1 && (toks[0].k === 'num' || toks[0].k === 'str')) {
    const v = toks[0].k === 'str' ? `"${toks[0].v}"` : toks[0].v;
    throw new TextError(line, `Numbers and words go without brackets: write ${v}, not (${v}). Brackets are for blocks, like (x position) or (mouse down?).`);
  }
  for (const pat of PATTERNS) {
    if (pat.def.shape !== 'reporter' && pat.def.shape !== 'boolean') continue;
    const values = matchPattern(pat, toks, ctx, line);
    if (values) return build(pat.def, values, line);
  }
  const name = toks.map((t) => (t.k === 'str' ? t.v : t.v)).join(' ');
  if (toks.every((t) => t.k === 'word' || t.k === 'num') && ctx.variables.includes(name)) {
    return createBlock('data_variable', { VARIABLE: name });
  }
  throw new TextError(line, `"(${toks.map((t) => (t.k === 'str' ? `"${t.v}"` : t.v || t.k)).join(' ')})" is not a reporter or a variable. ${ctx.variables.length ? `Variables here: ${ctx.variables.join(', ')}.` : ''}`);
}

function parseStatement(text, ctx, line) {
  const toks = tokenize(text, line);
  if (!toks.length) return null;
  for (const pat of PATTERNS) {
    if (pat.def.shape === 'reporter' || pat.def.shape === 'boolean') continue;
    const values = matchPattern(pat, toks, ctx, line);
    if (values) return build(pat.def, values, line);
  }
  // A loose reporter on its own line.
  if (toks[0].k === '(' && toks[toks.length - 1].k === ')') {
    const got = readValue(toks, 0, ctx, line);
    if (got && got[1] === toks.length && got[0].block) return got[0].block;
  }
  const near = suggest(toks);
  throw new TextError(line, `I don't know a block that says "${text.trim()}".${near ? ` Did you mean "${near}"?` : ''}`);
}

// The block whose label shares the most words with the line, for a helpful message.
function suggest(toks) {
  const words = new Set(toks.filter((t) => t.k === 'word').map((t) => t.v.toLowerCase()));
  let best = null;
  let score = 0;
  for (const pat of PATTERNS) {
    const w = pat.parts.filter((p) => p.word);
    const hit = w.filter((p) => words.has(p.word)).length / Math.max(1, w.length);
    if (hit > score) { score = hit; best = pat; }
  }
  if (!best || score < 0.5) return null;
  return best.parts.map((p) => p.word || (p.spec.kind === 'number' ? '10' : p.spec.kind === 'boolean' ? '()' : '"..."')).join(' ');
}

// A # starts a comment, unless it is inside quotes ("backdrop #" is a menu choice).
function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && quoted) { i++; continue; }
    if (c === '"') quoted = !quoted;
    else if (c === '#' && !quoted && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

// Text back into scripts. ctx: { variables: [names] }. Throws a TextError naming the line.
export function parseScripts(text, ctx) {
  const raw = text.replace(/\r/g, '').split('\n');
  const lines = [];
  raw.forEach((l, i) => {
    const noComment = stripComment(l);
    if (!noComment.trim()) return;
    if (/\t/.test(noComment.match(/^\s*/)[0])) throw new TextError(i + 1, 'Use spaces, not tabs, to indent.');
    const indent = noComment.match(/^ */)[0].length;
    if (indent % 4) throw new TextError(i + 1, 'Indent by 4 spaces for each level.');
    lines.push({ n: i + 1, depth: indent / 4, text: noComment.trim() });
  });
  let at = 0;
  function body(depth) {
    const out = [];
    while (at < lines.length && lines[at].depth >= depth) {
      const L = lines[at];
      if (L.depth > depth) throw new TextError(L.n, 'This line is indented more than the one above it.');
      if (L.text === 'pass') { at++; continue; }
      if (/^else\s*:$/.test(L.text)) return out;
      const colon = L.text.endsWith(':');
      const block = parseStatement(colon ? L.text.slice(0, -1) : L.text, ctx, L.n);
      const def = blockDef(block.type);
      at++;
      if (def.shape === 'c' || def.shape === 'c2') {
        if (!colon) throw new TextError(L.n, `"${L.text}" holds other blocks, so it needs a : at the end and the blocks indented under it.`);
        block.substack = body(depth + 1);
        // "if ... then:" reads the same for if and for if/else; an else: under it decides which.
        const E = lines[at];
        if (E && E.depth === depth && /^else\s*:$/.test(E.text)) {
          if (block.type === 'control_if') { block.type = 'control_if_else'; block.substack2 = []; }
          if (block.type !== 'control_if_else') throw new TextError(E.n, 'An else: belongs under an "if ... then:".');
          at++;
          block.substack2 = body(depth + 1);
        }
      } else if (colon) {
        throw new TextError(L.n, `"${L.text.slice(0, -1)}" does not hold other blocks, so it should not end with a :.`);
      } else if (def.shape === 'hat') {
        throw new TextError(L.n, 'A "when" block starts a script, so it goes at the left with a : after it.');
      }
      out.push(block);
    }
    return out;
  }
  const scripts = [];
  while (at < lines.length) {
    const L = lines[at];
    if (L.depth !== 0) throw new TextError(L.n, 'A script starts at the left edge, with no indent.');
    if (L.text === 'script:') {
      at++;
      scripts.push(body(1));
      continue;
    }
    if (!L.text.endsWith(':')) throw new TextError(L.n, 'A script starts with a "when" line ending in :, or with "script:".');
    const hat = parseStatement(L.text.slice(0, -1), ctx, L.n);
    if (blockDef(hat.type).shape !== 'hat') throw new TextError(L.n, 'A script starts with a "when" line, or with "script:".');
    at++;
    scripts.push([hat, ...body(1)]);
  }
  return scripts;
}
