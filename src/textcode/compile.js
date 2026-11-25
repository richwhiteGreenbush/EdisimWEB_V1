// Text -> blocks, at Basic Beginner (1) or Basic Pro (2).
//
// The output is an ordinary Edusim block tree, built with createBlockInstance() so every param
// comes from the block's own schema. It is what gets saved as `record.program` and what the
// existing ProgramRunner runs, so nothing downstream knows the program was typed.
//
// Never throws. A line that does not compile is left out of the blocks and reported; `ok` is
// false whenever any error was reported, and the editor refuses to save until it is true.
//
// Every diagnostic is { code, severity, line, from, to, title, explain?, fix? } with absolute
// source offsets, and a fix is { label, edits: [{ from, to, insert }] }. The rule, inherited
// from VisualHedy and enforced by tools/check-textcode.mjs: applying a fix must leave a line
// that compiles with no error at the same level.

import { BLOCK_DEFS, createBlockInstance } from '../BlockDefs.js';
import { lexLines, lineTree } from './lexer.js';
import { compilePattern, matchPattern, firstWords } from './patterns.js';
import { suggest, COMMAND_CONFUSIONS } from './didYouMean.js';
import { COMMANDS, COLOR_NAMES, EASES, RESERVED, NAME_RE, isValidName, COMMAND_WORDS, SUGGESTED_WORDS } from './commands.js';
import { printLine, quote } from './print.js';
import { message } from './messages.js';

const SETTERS = new Set(['setVar', 'changeVar', 'calc', 'mathFn', 'randomVar']);
const OBJECT_PROPS = new Set(['size', 'tilt', 'opacity']);
const SUM_OPS = new Set(['+', '-', '*', '/', '^']);
const SUM_WORDS = new Set(['plus', 'minus', 'times', 'divided', 'power']);

// Routing: first word -> the commands whose forms start with it. Assignments (`x = …`) have no
// first word, so they are routed by the `=` in second place instead.
const BY_WORD = new Map();
const ASSIGNMENTS = [];
for (const cmd of COMMANDS) {
  for (const form of cmd.forms) {
    form.compiled = compilePattern(form.p);
    const words = firstWords(form.compiled);
    if (!words.length) {
      if (!ASSIGNMENTS.includes(cmd)) ASSIGNMENTS.push(cmd);
      continue;
    }
    for (const w of words) {
      if (!BY_WORD.has(w)) BY_WORD.set(w, []);
      if (!BY_WORD.get(w).includes(cmd)) BY_WORD.get(w).push(cmd);
    }
  }
}

function lineRange(ln) {
  const toks = ln.tokens;
  return { from: toks[0].from, to: toks[toks.length - 1].to };
}

function isNumberAt(toks, pos) {
  const t = toks[pos];
  if (!t) return 0;
  if (t.type === 'number') return 1;
  if (t.type === 'op' && t.text === '-' && toks[pos + 1]?.type === 'number' && toks[pos + 1].from === t.to) return 2;
  return 0;
}

function numberValue(toks, from, to) {
  if (to - from === 2) return -toks[from + 1].value;
  return toks[from].value;
}

function colorFrom(text) {
  const t = String(text).trim().toLowerCase();
  if (COLOR_NAMES[t]) return COLOR_NAMES[t];
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(t)) return t;
  return null;
}

function makeSlotMatcher(cmd, form, toks, level) {
  return (name, pos) => {
    const type = cmd.slots[name];
    const t = toks[pos];
    switch (type) {
      case 'num': {
        const n = isNumberAt(toks, pos);
        if (n) return pos + n;
        return t.type === 'word' && isValidName(t.text) ? pos + 1 : null;
      }
      case 'lit': {
        const n = isNumberAt(toks, pos);
        return n ? pos + n : null;
      }
      case 'object':
        // A name, or a quoted one: a `tell` block can hold any text until the object picker
        // exists, and the printer quotes what is not a plain name.
        if (t.type === 'string' && !t.unclosed) return pos + 1;
        return t.type === 'word' && NAME_RE.test(t.text) ? pos + 1 : null;
      case 'name':
        // Reserved words still MATCH a name slot when nothing else could be meant, so the
        // compiler can say "that word is taken" (E121) rather than "I don't understand".
        return t.type === 'word' && NAME_RE.test(t.text) ? pos + 1 : null;
      case 'text':
        return t.type === 'string' && !t.unclosed ? pos + 1 : null;
      case 'color':
        if (t.type === 'color' || t.type === 'word') return pos + 1;
        return t.type === 'string' && !t.unclosed ? pos + 1 : null;
      case 'ease':
        return t.type === 'word' && EASES[t.text.toLowerCase()] ? pos + 1 : null;
      default:
        return null;
    }
  };
}

// Try every form of `cmds` that is open at `levels`. First match in table order wins.
function tryForms(cmds, toks, levels) {
  let deepest = null;
  for (const cmd of cmds) {
    for (const form of cmd.forms) {
      if (!form.levels.some((l) => levels.includes(l))) continue;
      const result = matchPattern(form.compiled, { tokens: toks, matchSlot: makeSlotMatcher(cmd, form, toks) });
      if (result.ok) return { cmd, form, caps: result.caps };
      if (!deepest || result.fail.pos > deepest.fail.pos) deepest = { cmd, form, fail: result.fail };
    }
  }
  return { deepest };
}

export function compile(source, level = 1, opts = {}) {
  const src = String(source ?? '');
  const L = level === 2 ? 2 : 1;
  const lines = lexLines(src);
  const diagnostics = [];
  const lineOf = new Map();
  const comments = { before: new Map(), inline: new Map(), end: [] };
  const reads = [];
  const sets = new Set();
  const objectNames = opts.objectNames ? new Set([...opts.objectNames].map((n) => String(n))) : null;

  const diag = (code, severity, line, from, to, params = {}, fix) => {
    const msg = message(code, { level: L, ...params });
    diagnostics.push({ code, severity, line, from, to, title: msg.title, ...(msg.explain ? { explain: msg.explain } : {}), ...(fix ? { fix } : {}) });
  };

  // Comment-only lines, in order, waiting for the next block to attach to.
  const pendingComments = lines.filter((ln) => ln.blank && ln.comment);
  let commentAt = 0;
  const takeCommentsBefore = (lineNo) => {
    const out = [];
    while (commentAt < pendingComments.length && pendingComments[commentAt].line < lineNo) {
      out.push(pendingComments[commentAt].comment.text);
      commentAt++;
    }
    return out;
  };

  // ---- one line -> one block (or a diagnostic) ----------------------------------------------
  const parseLine = (ln) => {
    const toks = ln.tokens;
    const { from, to } = lineRange(ln);
    const unclosed = toks.find((t) => t.type === 'string' && t.unclosed);
    if (unclosed) {
      diag('E111', 'error', ln.line, unclosed.from, unclosed.to, {}, {
        label: 'Add the closing quote', edits: [{ from: unclosed.to, to: unclosed.to, insert: '"' }],
      });
      return null;
    }

    const first = toks[0];
    const word = first.type === 'word' ? first.text.toLowerCase() : '';

    // Things VisualHedy has and Edusim's blocks don't. Said plainly, with what to do instead.
    const notYet = (variant) => { diag('E150', 'error', ln.line, from, to, { variant }); return null; };
    if (word === 'else' || word === 'elif') return notYet('else');
    if (word === 'while') return notYet('while');
    if (word === 'define' || word === 'def' || word === 'function') return notYet('define');
    if (word === 'for') return notYet('for');
    if (toks.some((t) => t.type === 'op' && (t.text === '[' || t.text === ']'))) return notYet('list');
    const isCheck = word === 'if' || (word === 'repeat' && toks[1]?.text.toLowerCase() === 'until');
    if (isCheck) {
      if (toks.some((t) => t.type === 'word' && ['and', 'or'].includes(t.text.toLowerCase()))) return notYet('andor');
      if (toks.some((t) => (t.type === 'word' && t.text.toLowerCase() === 'not') || t.text === '!=')) return notYet('not');
      const eq = toks.find((t) => t.type === 'op' && t.text === '=');
      if (eq) {
        diag('E112', 'error', ln.line, eq.from, eq.to, {}, {
          label: L === 2 ? 'Change `=` to `==`' : 'Change `=` to `is`',
          edits: [{ from: eq.from, to: eq.to, insert: L === 2 ? '==' : 'is' }],
        });
        return null;
      }
    }

    const assignment = toks[1]?.type === 'op' && toks[1].text === '=';
    const cmds = assignment ? ASSIGNMENTS : (BY_WORD.get(word) ?? []);

    // A Pro line written with a single sum too many: say so before the patterns fail on it.
    const setLine = word === 'set' && toks.some((t) => t.type === 'word' && t.text.toLowerCase() === 'to');
    if (assignment || setLine) {
      const body = assignment ? toks.slice(2) : toks.slice(toks.findIndex((t) => t.type === 'word' && t.text.toLowerCase() === 'to') + 1);
      // A `-` with nothing to subtract from (first, or after an operator or a sum word) is a
      // minus sign: `set x to 1 plus -7.5` is one sum.
      const signAt = (i) => i === 0 || body[i - 1].type === 'op' || (body[i - 1].type === 'word' && SUM_WORDS.has(body[i - 1].text.toLowerCase()));
      const ops = body.filter((t, i) => (t.type === 'op' && SUM_OPS.has(t.text) && !(t.text === '-' && signAt(i)))
        || (t.type === 'word' && SUM_WORDS.has(t.text.toLowerCase())));
      if (ops.length > 1) {
        diag('E151', 'error', ln.line, from, to);
        return null;
      }
    }

    if (cmds.length) {
      const here = tryForms(cmds, toks, [L]);
      if (here.cmd) return buildBlock(ln, here, toks);

      // The other level's way of writing it: a "Change to" card whose fix is the same block
      // printed at this level.
      const other = tryForms(cmds, toks, [L === 1 ? 2 : 1]);
      if (other.cmd) {
        const block = buildBlock(ln, other, toks, { quiet: true });
        if (block) {
          const example = printLine(block, L);
          const textSlot = Object.entries(other.cmd.slots).find(([, t]) => t === 'text');
          const code = L === 2 && textSlot ? 'E110' : 'E119';
          diag(code, 'error', ln.line, from, to, { example }, { label: `Change to \`${example}\``, edits: [{ from, to, insert: example }] });
        }
        return null;
      }

      // A name that is two words, or a word Edusim already uses.
      const nameIssue = checkName(ln, toks, assignment);
      if (nameIssue) return null;

      const deep = here.deepest ?? other.deepest;
      const exampleBlock = createBlockInstance(deep.cmd.block);
      for (const [k, v] of Object.entries(deep.form.fixed ?? {})) exampleBlock.params[k] = v;
      const example = printLine(exampleBlock, L);
      const expected = deep.fail.expected;
      const wantsNumber = expected?.k === 'slot' && ['num', 'lit'].includes(deep.cmd.slots[expected.name]);
      const cmdWord = assignment ? '=' : word;
      if (wantsNumber) diag('E107', 'error', ln.line, from, to, { cmd: cmdWord, example });
      else diag('E128', 'error', ln.line, from, to, { cmd: cmdWord, example });
      return null;
    }

    if (checkName(ln, toks, assignment)) return null;

    // An unknown first word.
    const confused = COMMAND_CONFUSIONS.get(word);
    const near = confused ? { best: [confused], fixIt: true } : (word ? suggest(word, SUGGESTED_WORDS) : null);
    const best = near?.best?.length === 1 ? near.best[0] : null;
    // The fix replaces the word, and then finishes the line if that alone would leave it with a
    // problem of its own (`print hello` at Pro needs quotes as well as `say`). Offered only when
    // the finished line compiles, which is the rule every fix keeps.
    let fix;
    if (best && near.fixIt) {
      const { from, to } = lineRange(ln);
      let line = best + src.slice(first.to, to);
      const again = compile(line, L, { objectNames: opts.objectNames, knownNames: [...(opts.knownNames ?? [])] });
      const followUp = again.diagnostics.find((d) => d.severity === 'error');
      if (followUp?.fix) {
        for (const e of [...followUp.fix.edits].sort((a, b) => b.from - a.from)) line = line.slice(0, e.from) + e.insert + line.slice(e.to);
      }
      if (compile(line, L).ok) fix = { label: `Change to \`${line}\``, edits: [{ from, to, insert: line }] };
    }
    diag('E102', 'error', ln.line, first.from, first.to, { name: first.text, suggestion: best ?? undefined }, fix);
    return null;
  };

  // E122 (a name with a space) and E121 (a word Edusim already uses). True when it reported.
  const checkName = (ln, toks, assignment) => {
    const { from, to } = lineRange(ln);
    let nameToks = null;
    if (assignment) nameToks = toks.slice(0, 1);
    else if (toks[1]?.type === 'op' && toks[2]?.type === 'op') nameToks = null;
    else {
      const eqAt = toks.findIndex((t) => t.type === 'op' && t.text === '=');
      if (eqAt > 1 && toks.slice(0, eqAt).every((t) => t.type === 'word')) nameToks = toks.slice(0, eqAt);
      else if (toks[0]?.text.toLowerCase() === 'set') {
        const toAt = toks.findIndex((t, i) => i > 0 && t.type === 'word' && t.text.toLowerCase() === 'to');
        if (toAt > 1 && toks.slice(1, toAt).every((t) => t.type === 'word')) nameToks = toks.slice(1, toAt);
      }
    }
    if (!nameToks?.length) return false;
    if (nameToks.length > 1) {
      const joined = nameToks.map((t) => t.text).join('_');
      if (OBJECT_PROPS.has(nameToks[0].text.toLowerCase())) return false;
      diag('E122', 'error', ln.line, nameToks[0].from, nameToks[nameToks.length - 1].to, { suggestion: joined }, {
        label: `Change to \`${joined}\``,
        edits: [{ from: nameToks[0].from, to: nameToks[nameToks.length - 1].to, insert: joined }],
      });
      return true;
    }
    const nameTok = nameToks[0];
    const lower = nameTok.text.toLowerCase();
    if (!RESERVED.has(lower)) return false;
    if (OBJECT_PROPS.has(lower) && assignment) {
      // `size = 150` at Pro: they meant the object's own size.
      const rest = toks.slice(2);
      const n = isNumberAt(rest, 0);
      const value = n === rest.length && n ? String(numberValue(rest, 0, n)) : null;
      const example = `set ${lower} to ${value ?? '100'}`;
      diag('E121', 'error', ln.line, from, to, { name: nameTok.text, suggestion: example }, value ? { label: `Change to \`${example}\``, edits: [{ from, to, insert: example }] } : undefined);
      return true;
    }
    const suggestion = `my_${lower}`;
    diag('E121', 'error', ln.line, nameTok.from, nameTok.to, { name: nameTok.text, suggestion }, {
      label: `Change to \`${suggestion}\``, edits: [{ from: nameTok.from, to: nameTok.to, insert: suggestion }],
    });
    return true;
  };

  // ---- a match -> a block ------------------------------------------------------------------
  const buildBlock = (ln, match, toks, { quiet = false } = {}) => {
    const { cmd, form, caps } = match;
    const params = { ...(form.fixed ?? {}) };
    let colorProblem = null;
    for (const [slot, cap] of Object.entries(caps)) {
      const type = cmd.slots[slot];
      const t = toks[cap.from];
      if (type === 'num' || type === 'lit') {
        params[slot] = t.type === 'word' ? t.text : numberValue(toks, cap.from, cap.to);
        if (t.type === 'word') reads.push({ name: t.text, line: ln.line, from: t.from, to: t.to });
      } else if (type === 'name' || type === 'object') {
        params[slot] = t.type === 'string' ? t.value : t.text;
      } else if (type === 'text') {
        if (cap.to - cap.from === 1 && t.type === 'string') params[slot] = t.value;
        else params[slot] = src.slice(t.from, toks[cap.to - 1].to);
      } else if (type === 'color') {
        const raw = t.type === 'string' ? t.value : t.text;
        const hex = colorFrom(raw);
        if (hex) params[slot] = hex;
        else colorProblem = { tok: t, raw };
      } else if (type === 'ease') {
        params[slot] = EASES[t.text.toLowerCase()];
      }
    }

    // A reserved word in a name slot: the word is taken (E121).
    for (const [slot, type] of Object.entries(cmd.slots)) {
      if ((type === 'name' || (type === 'object' && toks[caps[slot].from].type === 'word')) && caps[slot] && !isValidName(params[slot])) {
        if (!quiet) checkName(ln, toks, toks[1]?.text === '=') || diag('E121', 'error', ln.line, toks[caps[slot].from].from, toks[caps[slot].from].to, { name: params[slot] });
        return null;
      }
    }
    if (colorProblem) {
      if (quiet) return null;
      const near = suggest(String(colorProblem.raw).toLowerCase(), Object.keys(COLOR_NAMES));
      const best = near?.best?.length === 1 ? near.best[0] : null;
      const insert = best ? (colorProblem.tok.type === 'string' ? quote(best) : best) : null;
      diag('E154', 'error', ln.line, colorProblem.tok.from, colorProblem.tok.to, { name: colorProblem.raw, suggestion: best ?? undefined },
        insert && near.fixIt ? { label: `Change to ${best}`, edits: [{ from: colorProblem.tok.from, to: colorProblem.tok.to, insert }] } : undefined);
      return null;
    }

    let type = cmd.block;
    let finalParams = params;
    const replaced = form.post?.(params);
    if (replaced) {
      type = replaced.type;
      finalParams = replaced.params;
    }
    const block = createBlockInstance(type);
    Object.assign(block.params, finalParams);
    // Only an ease WORD gives a glide an ease; without one it is `straight`, exactly as every
    // glide saved before eases existed. createBlockInstance's default would quietly smooth it.
    if (type === 'glide' && !('ease' in finalParams)) delete block.params.ease;

    if (!quiet) {
      const { from, to } = lineRange(ln);
      if (cmd.retired) diag('W310', 'warning', ln.line, from, to, { cmd: printLine(block, L) });
      if (type === 'tell' && objectNames && !objectNames.has(block.params.object)) {
        const near = suggest(String(block.params.object), objectNames);
        const best = near?.best?.length === 1 ? near.best[0] : null;
        const nameTok = toks[caps.object.from];
        diag('W312', 'warning', ln.line, nameTok.from, nameTok.to, { name: block.params.object, suggestion: best ?? undefined },
          best && near.fixIt ? { label: `Change to \`${best}\``, edits: [{ from: nameTok.from, to: nameTok.to, insert: best }] } : undefined);
      }
      if (SETTERS.has(type) && block.params.name) sets.add(block.params.name);
    }
    return block;
  };

  // ---- the tree -> the block tree -------------------------------------------------------------
  const build = (nodes, depth) => {
    const out = [];
    for (const node of nodes) {
      const ln = node.line;
      if (depth === 0 && node.indent > 0) {
        const { from, to } = lineRange(ln);
        diag('E105', 'error', ln.line, from, to, {}, {
          label: 'Move it to the left edge', edits: [{ from: ln.start, to: ln.start + ln.indentChars, insert: '' }],
        });
        build(node.children, depth + 1);
        continue;
      }
      if (node.ragged) {
        const { from, to } = lineRange(ln);
        diag('E106', 'error', ln.line, from, to);
      }
      const before = takeCommentsBefore(ln.line);
      const block = parseLine(ln);
      if (!block) {
        build(node.children, depth + 1); // still report what is wrong inside it
        continue;
      }
      const def = BLOCK_DEFS[block.type];
      if (def?.hat && depth > 0) {
        const { from, to } = lineRange(ln);
        diag('E152', 'error', ln.line, from, to, {}, { label: 'Move it to the left edge', edits: dedentEdits(node, node.line.indentChars) });
        continue;
      }
      if (before.length) comments.before.set(block.id, before);
      if (ln.comment) comments.inline.set(block.id, ln.comment.text);
      lineOf.set(block.id, ln.line);
      if (def?.hasChildren) {
        block.children = build(node.children, depth + 1);
        if (!node.children.length) {
          const { from, to } = lineRange(ln);
          diag('W311', 'warning', ln.line, from, to, { cmd: printLine(block, L) });
        }
      } else if (node.children.length) {
        const child = node.children[0].line;
        const { from, to } = lineRange(child);
        const amount = child.indentChars - ln.indentChars;
        diag('E105', 'error', child.line, from, to, {}, {
          label: 'Line it up with the line above',
          edits: node.children.flatMap((c) => dedentEdits(c, amount)),
        });
      }
      out.push(block);
    }
    return out;
  };

  const blocks = build(lineTree(lines), 0);
  while (commentAt < pendingComments.length) comments.end.push(pendingComments[commentAt++].comment.text);

  // Names read that nothing in this program sets, and nothing else in the world shares.
  const known = new Set(opts.knownNames ?? []);
  const warned = new Set();
  for (const r of reads) {
    if (sets.has(r.name) || known.has(r.name) || warned.has(r.name)) continue;
    warned.add(r.name);
    diag('W301', 'warning', r.line, r.from, r.to, { name: r.name });
  }

  diagnostics.sort((a, b) => a.from - b.from || (a.severity === 'error' ? -1 : 1));
  return {
    blocks,
    diagnostics,
    ok: !diagnostics.some((d) => d.severity === 'error'),
    lineOf,
    comments,
  };
}

// Edits that remove `amount` leading characters from a line and everything pushed in under it.
function dedentEdits(node, amount) {
  const edits = [];
  const walk = (n) => {
    const ln = n.line;
    const k = Math.min(amount, ln.indentChars);
    if (k > 0) edits.push({ from: ln.start, to: ln.start + k, insert: '' });
    for (const c of n.children) walk(c);
  };
  walk(node);
  return edits;
}

export { COMMAND_WORDS };
