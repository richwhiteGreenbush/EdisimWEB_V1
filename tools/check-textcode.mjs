// The regression check for Edusim's text coding (src/textcode/). Read-only; exits 1 on any failure.
//
//   node tools/check-textcode.mjs            everything
//   node tools/check-textcode.mjs --verbose  also list every program it round-tripped
//
// 1. BLOCKS: every block type (retired ones and `tell` included), in many variants, printed at
//    both levels and compiled back, gives the same block with no problems.
// 2. THE CORPUS: every block program in both galleries, seeded and published, printed at
//    Beginner, compiled, converted to Pro and compiled again -- the same blocks every time, AND
//    the same behaviour when both are RUN through the real ProgramRunner (path, sizes, says, and
//    every `when an object says` hat fired).
// 3. EXAMPLES: every example program below compiles at its level with zero problems.
// 4. CARDS: every Problems card fires where it should, as the first card, and its Fix it leaves
//    a line with no error.
// 5. WORDING: every message obeys VisualHedy's rules (15-word titles, no blaming words, no jargon
//    at Beginner).
// 6. ROBUSTNESS: compile never throws, on 3000 random programs.
// 7. THE CARD: docs/guide/text-coding.html matches what tools/build-text-coding-card.mjs makes.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
process.chdir(ROOT);
const { compile, printBlocks, convert } = await import('../src/textcode/index.js');
const { MESSAGES, L1_JARGON } = await import('../src/textcode/messages.js');
const { BLOCK_DEFS, createBlockInstance, isVariableRef } = await import('../src/BlockDefs.js');
const { runBlocks } = await import('./lib/run-blocks.mjs');

const verbose = process.argv.includes('--verbose');
let failures = 0;
const fail = (what, detail) => {
  failures++;
  console.log(`FAIL ${what}${detail ? `\n     ${String(detail).replace(/\n/g, '\n     ')}` : ''}`);
};

// ---- comparing blocks -------------------------------------------------------------------------

// A block as the runner sees it: type and params, no ids. A number blank holding "10" and one
// holding 10 run identically (`val()` is Number(x)), so numeric strings compare as numbers.
function norm(blocks) {
  return (blocks || []).map((b) => {
    let type = b.type;
    let params = { ...(b.params || {}) };
    // The documented round trips: they change the block, not what it does.
    if (type === 'sayValue') {
      const label = String(params.label ?? '').trim();
      const unit = String(params.unit ?? '').trim();
      const head = label ? (label.endsWith('$') ? label : `${label} `) : '';
      const tail = unit ? (/^[%.,;:!?)]/.test(unit) ? unit : ` ${unit}`) : '';
      const value = isVariableRef(params.value) ? `{${String(params.value).trim()}}` : (Number(params.value) || 0).toFixed(2);
      type = 'say';
      params = { text: `${head}${value}${tail}` };
    }
    if (type === 'calc' && params.op === '+' && params.a === params.name && isVariableRef(params.a)) {
      type = 'changeVar';
      params = { name: params.name, value: params.b };
    }
    if (type === 'calc' && params.op === '-' && params.a === params.name && !isVariableRef(params.b)) {
      type = 'changeVar';
      params = { name: params.name, value: -Number(params.b) };
    }
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (typeof v === 'string' && !isVariableRef(v) && BLOCK_DEFS[type]?.params?.[k]?.type === 'number') out[k] = Number(v);
      else if (typeof v === 'string' && isVariableRef(v) && BLOCK_DEFS[type]?.params?.[k]?.type === 'number') out[k] = v.trim();
      else if (typeof v === 'string' && BLOCK_DEFS[type]?.params?.[k]?.type === 'color') out[k] = v.trim().toLowerCase();
      else out[k] = v;
    }
    const def = BLOCK_DEFS[type];
    return { type, params: out, ...(def?.hasChildren ? { children: norm(b.children) } : {}) };
  // A `when` left inside another block never runs, and the printer leaves it out.
  }).filter((b, i, all) => true);
}
function dropNestedHats(blocks, depth = 0) {
  return (blocks || []).filter((b) => !(depth > 0 && BLOCK_DEFS[b.type]?.hat))
    .map((b) => (b.children ? { ...b, children: dropNestedHats(b.children, depth + 1) } : b));
}
const same = (a, b) => JSON.stringify(norm(dropNestedHats(a))) === JSON.stringify(norm(dropNestedHats(b)));

function diff(a, b) {
  const x = JSON.stringify(norm(dropNestedHats(a)), null, 1).split('\n');
  const y = JSON.stringify(norm(dropNestedHats(b)), null, 1).split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `line ${i}: ${x[i]}  !=  ${y[i]}`;
  return '';
}

const errorsIn = (r) => r.diagnostics.filter((d) => d.severity === 'error');
const describe = (r) => r.diagnostics.map((d) => `L${d.line} ${d.code} ${d.title}`).join('\n');

// Names a program reads but does not set are fine when the world shares them, so the corpus
// passes every name set or shared anywhere in the same world as known.
function namesIn(blocks, out = new Set()) {
  for (const b of blocks || []) {
    if (b.params?.name) out.add(String(b.params.name));
    for (const v of Object.values(b.params || {})) if (isVariableRef(v)) out.add(String(v).trim());
    namesIn(b.children, out);
  }
  return out;
}

// Print at 1, compile; convert to 2, compile; and the Pro print of the original must equal the
// converted text (the printer is a fixpoint).
function roundTrip(what, blocks, known) {
  const opts = { knownNames: known };
  const t1 = printBlocks(blocks, 1).text;
  const r1 = compile(t1, 1, opts);
  if (errorsIn(r1).length || r1.diagnostics.some((d) => d.code !== 'W301' && d.code !== 'W311' && d.code !== 'W310')) {
    fail(`${what}: Beginner text has problems`, `${t1}\n${describe(r1)}`);
    return null;
  }
  if (!same(blocks, r1.blocks)) {
    fail(`${what}: Beginner text compiles to different blocks`, `${t1}\n${diff(blocks, r1.blocks)}`);
    return null;
  }
  const conv = convert(t1, 1, 2, opts);
  if (!conv.ok) {
    fail(`${what}: Beginner -> Pro refused`, describe(conv));
    return null;
  }
  const r2 = compile(conv.text, 2, opts);
  if (errorsIn(r2).length) {
    fail(`${what}: Pro text has problems`, `${conv.text}\n${describe(r2)}`);
    return null;
  }
  if (!same(blocks, r2.blocks)) {
    fail(`${what}: Pro text compiles to different blocks`, `${conv.text}\n${diff(blocks, r2.blocks)}`);
    return null;
  }
  const direct = printBlocks(blocks, 2).text;
  if (direct !== conv.text) fail(`${what}: printing at Pro and converting to Pro disagree`, `${direct}\n---\n${conv.text}`);
  const back = convert(conv.text, 2, 1, opts);
  if (!back.ok || back.text !== printBlocks(r2.blocks, 1).text) fail(`${what}: Pro -> Beginner does not come back`);
  return { t1, t2: conv.text, compiled: r2.blocks };
}

// ---- running both ----------------------------------------------------------------------------

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// `glide` reads the real clock, so two runs never time alike. Both runs get the same virtual
// clock instead: 16ms a step, advanced by runBlocks' per-step hook.
function behaviour(blocks, steps) {
  const real = Math.random;
  const realNow = performance.now;
  let clock = 0;
  Math.random = seeded(42);
  performance.now = () => clock;
  try {
    const object3D = new THREE.Object3D();
    const r = runBlocks(blocks, { maxSteps: steps, object3D, stopWhen: () => { clock += 16; return false; } });
    for (const b of blocks) if (b.type === 'whenSaid') r.hear(b.params.text);
    const round = (v) => Math.round(v * 1000) / 1000;
    return {
      // A whole number said through `say a value` shows 3.00 there and 3 after the round trip.
      says: r.log.says.map((s) => s.replace(/\b(\d+)\.00\b/g, '$1')),
      path: r.log.path.filter((_, i) => i % 7 === 0).map((p) => [round(p.x), round(p.y), round(p.z)]),
      sizes: r.log.sizes.filter((_, i) => i % 7 === 0).map(round),
      steps: r.log.steps,
      problems: r.log.problems,
    };
  } finally {
    Math.random = real;
    performance.now = realNow;
  }
}

function sameBehaviour(what, a, b) {
  const x = behaviour(a, 3000);
  const y = behaviour(b, 3000);
  for (const key of ['says', 'path', 'sizes', 'steps', 'problems']) {
    if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) {
      fail(`${what}: runs differently (${key})`, `${JSON.stringify(x[key]).slice(0, 300)}\n${JSON.stringify(y[key]).slice(0, 300)}`);
      return false;
    }
  }
  return true;
}

// ---- 1. every block --------------------------------------------------------------------------

function variants(type) {
  const def = BLOCK_DEFS[type];
  const base = createBlockInstance(type);
  const out = [base];
  for (const [key, schema] of Object.entries(def.params)) {
    const add = (value) => {
      const b = createBlockInstance(type);
      b.params[key] = value;
      out.push(b);
    };
    if (schema.type === 'number') {
      add(-7.5);
      add(0);
      add('12');
      if (schema.variable) add('speed');
    }
    if (schema.options) for (const o of schema.options) add(o.value);
    if (schema.type === 'text') {
      for (const t of ['Good morning', 'Score: {score}!', "It's 5 o'clock", '', '  spaced  ', 'say "hi"', 'We are #1', 'back\\slash', 'repeat 4 times']) add(t);
    }
    if (schema.type === 'name') add('my_var2');
    if (schema.type === 'color') for (const c of ['#e0455f', '#3D8BF2', '#123456', '#abc']) add(c);
  }
  if (type === 'glide') {
    const b = createBlockInstance('glide');
    delete b.params.ease;
    out.push(b);
  }
  if (def.hasChildren) {
    const b = createBlockInstance(type);
    b.children = [createBlockInstance('rotate'), createBlockInstance('say')];
    out.push(b);
  }
  return out;
}

let blockCount = 0;
for (const type of Object.keys(BLOCK_DEFS)) {
  for (const [i, b] of variants(type).entries()) {
    blockCount++;
    // A hat with nothing in it, at the top level, is still a legal program.
    const program = [b];
    const ok = roundTrip(`block ${type} #${i}`, program, namesIn(program));
    if (ok && verbose) console.log(`  ${type} #${i}: ${ok.t1.trim()}  |  ${ok.t2.trim()}`);
  }
}
console.log(`1. blocks: ${blockCount} variants of ${Object.keys(BLOCK_DEFS).length} block types`);

// ---- 2. the corpus ---------------------------------------------------------------------------

const worldFiles = [
  'EdusimWorldDatabase/seed/worlds', 'EdusimHiFiWorldDatabase/seed/worlds',
  'EdusimWorldDatabase/data/worlds', 'EdusimHiFiWorldDatabase/data/worlds',
].flatMap((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)) : []));

let programs = 0;
let ran = 0;
for (const file of worldFiles) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    continue;
  }
  const records = Array.isArray(data) ? data : (data.records ?? []);
  const known = new Set();
  for (const r of records) if (r.program) namesIn(r.program, known);
  for (const r of records) {
    if (!Array.isArray(r.program) || !r.program.length) continue;
    programs++;
    const what = `${path.basename(file)} ${r.prop ?? r.kind} ${String(r.id).slice(0, 8)}`;
    const result = roundTrip(what, r.program, known);
    if (!result) continue;
    if (sameBehaviour(what, r.program, result.compiled)) ran++;
    if (verbose) console.log(`  ${what}\n${result.t1.replace(/^/gm, '      ')}`);
  }
}
console.log(`2. corpus: ${programs} programs in ${worldFiles.length} world files, ${ran} ran identically`);

// ---- 3. examples -----------------------------------------------------------------------------

const EXAMPLES = [
  [1, 'Ping (JavaScript Basics)', `when an object says pong
    wait 1.2 seconds
    repeat 12 times
        rotate 30 degrees
    say ping
wait 2 seconds
say ping
`],
  [1, 'Pong (JavaScript Basics)', `when an object says ping
    wait 1.2 seconds
    repeat 12 times
        rotate -30 degrees
    say pong
`],
  [1, 'Beacon lamp', 'forever\n    rotate 2 degrees\n'],
  [1, 'Golden screw', 'forever\n    rotate 1.5 degrees\n'],
  [1, 'Mood stone', `forever
    change color to red
    wait 1 seconds
    change color to yellow
    wait 1 seconds
    change color to blue
    wait 1 seconds
`],
  [2, 'Patrol robot', 'forever\n    glide 8 over 2.5\n    rotate 90\n'],
  [2, 'Falling ball', `speed = 0
height = 20
repeat until height <= 0
    speed = speed - 0.98
    height = height + speed
    move up speed
say "Landed!"
`],
  [1, 'A square, drawn', `# 360 divided by the number of sides
set sides to 4
set turn to 360 divided by sides
marker color blue
marker down
repeat sides times
    move forward 8 feet
    rotate turn degrees
marker up
`],
  [2, 'Night lamp', `when the sun goes down
    set size to 150
    change color to "yellow"
when the sun comes up
    set size to 100
    change color to "white"
`],
  [1, 'A messenger', 'when this world opens\n    wait 3 seconds\n    tell robot2 go\n'],
  [2, 'Dice', `roll = random 1 to 6
roll = rounded value of roll
say "I rolled {roll}"
share roll with every object
`],
  [1, 'VisualHedy words', 'remember score is 0\nadd 5 to score\ntake 1 from score\nsay Score {score}\n'],
];
let exampleCount = 0;
for (const [level, name, src] of EXAMPLES) {
  exampleCount++;
  const r = compile(src, level, { objectNames: ['robot2'] });
  if (r.diagnostics.length) fail(`example "${name}" (level ${level}) has problems`, describe(r));
  const other = convert(src, level, level === 1 ? 2 : 1);
  if (!other.ok) fail(`example "${name}" does not convert`, describe(other));
  else {
    const r2 = compile(other.text, level === 1 ? 2 : 1, { objectNames: ['robot2'] });
    if (errorsIn(r2).length) fail(`example "${name}" converted has problems`, `${other.text}\n${describe(r2)}`);
    if (other.text.split('\n').filter((l) => l.trim().startsWith('#')).length !== src.split('\n').filter((l) => l.trim().startsWith('#')).length) {
      fail(`example "${name}": a comment was lost converting`);
    }
  }
}
console.log(`3. examples: ${exampleCount}`);

// ---- 4. cards --------------------------------------------------------------------------------

const CARDS = [
  ['moev forward 2 feet', 1, 'E102'], ['turn 90 degrees', 1, 'E102'], ['print hello', 2, 'E102'],
  ['rotate 5 degrees\n    move forward 2 feet', 1, 'E105'], ['    rotate 5 degrees', 1, 'E105'],
  ['repeat 2 times\n        rotate 5 degrees\n    rotate 5 degrees', 1, 'E106'],
  ['rotate degrees', 1, 'E107'], ['move forward', 2, 'E107'],
  ['say hello there', 2, 'E110'], ['when an object says go', 2, 'E110'],
  ['say "hello', 1, 'E111'],
  ['if x = 5\n    say "hi"', 2, 'E112'], ['if x = 5\n    say hi', 1, 'E112'],
  ['x = 5', 1, 'E119'], ['if x > 5\n    say hi', 1, 'E119'], ['score = score + 1', 1, 'E119'],
  ['set forward to 5', 1, 'E121'], ['size = 150', 2, 'E121'],
  ['set my score to 5', 1, 'E122'], ['my score = 5', 2, 'E122'],
  ['glide 5 feet under 2 seconds', 1, 'E128'], ['set', 1, 'E128'],
  ['else', 1, 'E150'], ['while x < 5', 2, 'E150'], ['if x > 1 and y > 2', 2, 'E150'], ['define jump', 2, 'E150'],
  ['for i in range 5', 2, 'E150'], ['set x to [1, 2]', 2, 'E150'], ['if x is not 5', 1, 'E150'],
  ['x = a + b * c', 2, 'E151'], ['set x to a plus b times c', 1, 'E151'],
  ['forever\n    when the sun goes down\n        say hi', 1, 'E152'],
  ['change color to purpel', 1, 'E154'], ['marker color "bleu"', 2, 'E154'],
  ['say {nothing}\nrotate missing degrees', 1, 'W301'],
  ['move X by 2 feet', 1, 'W310'],
  ['forever', 1, 'W311'],
  ['tell robto go', 1, 'W312'],
];
const seenCodes = new Set();
for (const [src, level, code] of CARDS) {
  const r = compile(src, level, { objectNames: ['robot', 'robot2'] });
  const first = r.diagnostics[0];
  seenCodes.add(code);
  if (!first || first.code !== code) {
    fail(`card ${code}: ${JSON.stringify(src)} at level ${level} gave ${first ? first.code : 'nothing'}`, describe(r));
    continue;
  }
  if (first.fix) {
    let fixed = src;
    for (const e of [...first.fix.edits].sort((a, b) => b.from - a.from)) fixed = fixed.slice(0, e.from) + e.insert + fixed.slice(e.to);
    const after = compile(fixed, level, { objectNames: ['robot', 'robot2'] });
    const stillThere = after.diagnostics.some((d) => d.line === first.line && d.code === code);
    if (errorsIn(after).length || stillThere) fail(`card ${code}: Fix it on ${JSON.stringify(src)} leaves problems`, `${fixed}\n${describe(after)}`);
  }
}
for (const code of Object.keys(MESSAGES)) if (!seenCodes.has(code)) fail(`card ${code} has a message but no card test`);
console.log(`4. cards: ${CARDS.length} cases over ${seenCodes.size} codes`);

// ---- 5. wording ------------------------------------------------------------------------------

const BANNED = ['invalid', 'illegal', 'wrong', 'error', ' bad ', 'stupid', 'fail'];
const SAMPLE = { name: 'speed', suggestion: 'rotate', example: 'rotate 15 degrees', cmd: 'rotate' };
let msgCount = 0;
for (const [code, make] of Object.entries(MESSAGES)) {
  const variants = code === 'E150' ? ['else', 'andor', 'not', 'while', 'define', 'list', 'for', undefined] : [undefined];
  for (const level of [1, 2]) {
    for (const variant of variants) {
      for (const params of [SAMPLE, { name: 'speed' }, { name: 'size', suggestion: 'set size to 100' }]) {
        const m = make({ level, variant, ...params });
        msgCount++;
        for (const [part, text] of [['title', m.title], ['explain', m.explain]]) {
          if (!text) continue;
          const words = text.replace(/`/g, ' ').split(/\s+/).filter(Boolean);
          if (part === 'title' && words.length > 15) fail(`${code} title has ${words.length} words`, text);
          const low = ` ${text.toLowerCase()} `;
          for (const b of BANNED) if (low.includes(b)) fail(`${code} ${part} says "${b.trim()}"`, text);
          if (level === 1) {
            const outsideCode = text.replace(/`[^`]*`/g, '').toLowerCase();
            for (const j of L1_JARGON) if (new RegExp(`\\b${j}`).test(outsideCode)) fail(`${code} ${part} says "${j}" at Beginner`, text);
          }
        }
      }
    }
  }
}
console.log(`5. wording: ${msgCount} messages`);

// ---- 6. robustness ---------------------------------------------------------------------------

const PIECES = ['move', 'forward', '10', 'feet', 'rotate', '-', '=', '==', 'if', 'x', 'is', 'more', 'than', '"', 'say',
  'hello', '{', '}', 'repeat', 'times', '\n', '\n    ', '\n        ', '\t', '#', '#fff', 'when', 'the', 'sun', 'goes',
  'down', 'set', 'to', 'plus', '*', '(', ']', '%', 'glide', 'over', 'smoothly', 'tell', 'change', 'color', 'red', '×', '“'];
const rand = seeded(7);
const started = Date.now();
for (let i = 0; i < 3000; i++) {
  const n = 1 + Math.floor(rand() * 30);
  let src = '';
  for (let k = 0; k < n; k++) src += PIECES[Math.floor(rand() * PIECES.length)] + (rand() < 0.7 ? ' ' : '');
  for (const level of [1, 2]) {
    try {
      const r = compile(src, level, { objectNames: ['robot'] });
      printBlocks(r.blocks, level);
    } catch (err) {
      fail(`compile threw on ${JSON.stringify(src)} at level ${level}`, err.stack);
      break;
    }
  }
}
console.log(`6. robustness: 6000 compiles in ${Date.now() - started}ms`);

// ---- 7. the student card ---------------------------------------------------------------------
// docs/guide/text-coding.html is generated from this language; a change here must reach it.
try {
  execFileSync(process.execPath, ['tools/build-text-coding-card.mjs', '--check'], { stdio: 'pipe' });
  console.log('7. the Typing Code card is up to date');
} catch (err) {
  fail('docs/guide/text-coding.html is stale or a sample on it has a problem', String(err.stdout || err.stderr || err.message));
}

if (failures) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log('\nAll text coding checks passed.');
