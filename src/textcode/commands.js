// The Edusim command table: every block, written at Basic Beginner (level 1) and Basic Pro
// (level 2). This is the ONE place a text form is defined -- the compiler reads `forms` and
// the printer calls `print`, so a line and the block it compiles to cannot drift apart.
//
// Approved design: /Users/richwhite/Desktop/edusim-text-coding-phase1-language.md (copied
// into README.md beside this file). In short:
//   - Beginner reads like the block's own label, word for word.
//   - Pro is Beginner with "quotes" on text, `=` for numbers, symbols in checks and no unit
//     words. Beginner forms (quoted text aside) still work at Pro.
//   - The object running the program is never named: a program belongs to one object.
//
// A form is { p, levels, fixed?, post? }:
//   p       a pattern in VisualHedy's DSL (./patterns.js)
//   levels  where it is accepted; a form from the other level gets a "Change to" card (E119)
//   fixed   params the form itself decides (which comparison, which sum, which world event)
//   post    a last say over the params, or a different block type (see changeVar)
//
// Slot types: num (a number or a name), lit (a number only), name (a name being set),
// text (rest of line at Beginner, "quoted" at Pro), color, ease, object (another object's name).
//
// Block types and their param values are PERSISTED. Nothing here may change what a saved
// block means; it only decides how one is written.

export const COMPARE_WORDS = { '<': 'is less than', '<=': 'is at most', '=': 'is', '>=': 'is at least', '>': 'is more than' };
export const COMPARE_SYMBOLS = { '<': '<', '<=': '<=', '=': '==', '>=': '>=', '>': '>' };

// The six swatches the blocks offer get their own names, plus a few every student expects.
export const COLOR_NAMES = {
  red: '#e0455f', orange: '#f2a541', green: '#3fb37f', blue: '#3d8bf2', purple: '#8a5cf5', white: '#f5f5f5',
  yellow: '#f2c94c', pink: '#f28cb8', black: '#222222', gray: '#8c8c8c', grey: '#8c8c8c', brown: '#8b5a2b',
};

export const EASES = { smoothly: 'smooth', smooth: 'smooth', straight: 'straight', bouncy: 'bouncy', bouncily: 'bouncy' };
export const EASE_WORDS = { smooth: 'smoothly', straight: 'straight', bouncy: 'bouncy' };

// Sums: the block's op value -> how each level writes it (`words` at Beginner, `symbol` at
// Pro), and every spelling either level reads (`pats`).
const SUMS = [
  { op: '+', words: '{a} plus {b}', symbol: '{a} + {b}', pats: ['{a} plus {b}', '{a} + {b}'] },
  { op: '-', words: '{a} minus {b}', symbol: '{a} - {b}', pats: ['{a} minus {b}', '{a} - {b}'] },
  { op: '*', words: '{a} times {b}', symbol: '{a} * {b}', pats: ['{a} times {b}', '{a} * {b}'] },
  { op: '/', words: '{a} divided by {b}', symbol: '{a} / {b}', pats: ['{a} divided by {b}', '{a} / {b}'] },
  { op: '^', words: '{a} to the power of {b}', symbol: '{a} ^ {b}', pats: ['{a} to the power of {b}', '{a} ^ {b}'] },
  { op: 'min', words: 'the smaller of {a} and {b}', symbol: 'smaller of {a} and {b}', pats: ['[the] smaller of {a} and {b}'] },
  { op: 'max', words: 'the larger of {a} and {b}', symbol: 'larger of {a} and {b}', pats: ['[the] larger of {a} and {b}'] },
  { op: 'mod', words: 'the remainder of {a} divided by {b}', symbol: 'remainder of {a} divided by {b}', pats: ['[the] remainder of {a} divided by {b}'] },
];

// Functions: the block's fn value -> the words both levels use. `also` are other spellings.
const FUNCTIONS = [
  { fn: 'sqrt', words: 'square root of' },
  { fn: 'square', words: 'square of' },
  { fn: 'abs', words: 'absolute value of', also: ['absolute of'] },
  { fn: 'round', words: 'rounded value of', also: ['rounded of'] },
  { fn: 'sin', words: 'sin of' },
  { fn: 'cos', words: 'cos of' },
  { fn: 'tan', words: 'tan of' },
  { fn: 'asin', words: 'asin of' },
  { fn: 'acos', words: 'acos of' },
  { fn: 'atan', words: 'atan of' },
];

const WORLD_EVENTS = [
  { event: 'sunrise', words: 'when the sun comes up' },
  { event: 'noon', words: 'when it is the middle of the day' },
  { event: 'sunset', words: 'when the sun goes down' },
  { event: 'night', words: 'when it gets dark' },
  { event: 'start', words: 'when this world opens' },
];

const BOTH = [1, 2];
const BEGINNER = [1];
const PRO = [2];

const FEET = '[feet | foot | ft]';
const DEGREES = '[degrees | degree]';
const SECONDS = '[second(s)]';
const PERCENT = '[% | percent]';

// `a op b` in a check, one form per comparison at each level.
function compareForms(head) {
  const forms = [];
  for (const [op, words] of Object.entries(COMPARE_WORDS)) forms.push({ p: `${head} {a} ${words} {b}`, levels: BOTH, fixed: { op } });
  for (const [op, sym] of Object.entries(COMPARE_SYMBOLS)) {
    forms.push({ p: `${head} {a} ${sym} {b}`, levels: PRO, fixed: { op } });
  }
  return forms;
}

function printCompare(head, p, L, f) {
  const op = COMPARE_WORDS[p.op] ? p.op : '>';
  const mid = L === 1 ? COMPARE_WORDS[op] : COMPARE_SYMBOLS[op];
  return `${head} ${f.num(p.a)} ${mid} ${f.num(p.b)}`;
}

// A sum written `x = x + b` (or `x = x - 3`) IS "change x by", and Pro writes changeVar that
// way. So it reads back as changeVar: the same arithmetic, which is the documented round trip.
function sumOrChange(params) {
  const same = typeof params.a === 'string' && params.a === params.name;
  if (same && params.op === '+') return { type: 'changeVar', params: { name: params.name, value: params.b } };
  if (same && params.op === '-' && typeof params.b === 'number') {
    return { type: 'changeVar', params: { name: params.name, value: -params.b } };
  }
  return null;
}

export const COMMANDS = [
  // ---- Control --------------------------------------------------------------------------
  {
    block: 'repeatUntil',
    slots: { a: 'num', b: 'num' },
    forms: compareForms('repeat until'),
    print: (p, L, f) => printCompare('repeat until', p, L, f),
  },
  {
    block: 'repeat',
    slots: { count: 'num' },
    forms: [{ p: 'repeat {count} [time(s)]', levels: BOTH }],
    print: (p, L, f) => `repeat ${f.num(p.count)} times`,
  },
  { block: 'forever', slots: {}, forms: [{ p: 'forever', levels: BOTH }], print: () => 'forever' },
  {
    block: 'wait',
    slots: { seconds: 'num' },
    forms: [{ p: `wait {seconds} ${SECONDS}`, levels: BOTH }],
    print: (p, L, f) => (L === 1 ? `wait ${f.num(p.seconds)} seconds` : `wait ${f.num(p.seconds)}`),
  },
  {
    block: 'whenSaid',
    slots: { text: 'text' },
    forms: [
      { p: 'when an object says {text...}', levels: BEGINNER },
      { p: 'when i hear {text...}', levels: BEGINNER },
      { p: 'when an object says {text}', levels: PRO },
      { p: 'when i hear {text}', levels: PRO },
    ],
    print: (p, L, f) => `when an object says ${f.text(p.text)}`,
  },
  ...WORLD_EVENTS.map(({ event, words }, i) => ({
    block: 'whenWorld',
    slots: {},
    forms: [{ p: words, levels: BOTH, fixed: { event } }],
    // Only the first entry prints; it covers every event.
    print: i === 0 ? (p) => (WORLD_EVENTS.find((e) => e.event === p.event) ?? WORLD_EVENTS[2]).words : null,
  })),
  {
    block: 'duplicate',
    slots: { offset: 'lit' },
    forms: [{ p: 'duplicate {offset} [ft | feet | foot] [away]', levels: BOTH }],
    print: (p, L, f) => (L === 1 ? `duplicate ${f.num(p.offset)} ft away` : `duplicate ${f.num(p.offset)}`),
  },
  {
    block: 'ifCompare',
    slots: { a: 'num', b: 'num' },
    forms: compareForms('if'),
    print: (p, L, f) => printCompare('if', p, L, f),
  },

  // ---- Motion ---------------------------------------------------------------------------
  {
    block: 'moveBoth',
    slots: { forward: 'num', up: 'num' },
    forms: [{ p: `move forward {forward} ${FEET} and up {up} ${FEET}`, levels: BOTH }],
    print: (p, L, f) => `move forward ${f.num(p.forward)} and up ${f.num(p.up)}${L === 1 ? ' feet' : ''}`,
  },
  {
    block: 'moveForward',
    slots: { feet: 'num' },
    forms: [{ p: `move forward {feet} ${FEET}`, levels: BOTH }],
    print: (p, L, f) => `move forward ${f.num(p.feet)}${L === 1 ? ' feet' : ''}`,
  },
  {
    block: 'moveUp',
    slots: { feet: 'num' },
    forms: [{ p: `move up [by] {feet} ${FEET}`, levels: BOTH }],
    print: (p, L, f) => (L === 1 ? `move up by ${f.num(p.feet)} feet` : `move up ${f.num(p.feet)}`),
  },
  {
    block: 'glide',
    slots: { feet: 'num', seconds: 'num', ease: 'ease' },
    forms: [{ p: `glide {feet} ${FEET} over {seconds} ${SECONDS} [{ease}]`, levels: BOTH }],
    // No ease word means `straight`, which is how every glide saved before eases existed runs,
    // so a block with no `ease` key prints with no word and reads back with no key.
    print: (p, L, f) => {
      const ease = p.ease != null && EASE_WORDS[p.ease] ? ` ${EASE_WORDS[p.ease]}` : '';
      return L === 1
        ? `glide ${f.num(p.feet)} feet over ${f.num(p.seconds)} seconds${ease}`
        : `glide ${f.num(p.feet)} over ${f.num(p.seconds)}${ease}`;
    },
  },
  {
    block: 'rotate',
    slots: { degrees: 'num' },
    forms: [{ p: `rotate {degrees} ${DEGREES}`, levels: BOTH }],
    print: (p, L, f) => `rotate ${f.num(p.degrees)}${L === 1 ? ' degrees' : ''}`,
  },
  {
    block: 'setTilt',
    slots: { degrees: 'num' },
    forms: [{ p: `set tilt to {degrees} ${DEGREES}`, levels: BOTH }],
    print: (p, L, f) => `set tilt to ${f.num(p.degrees)}${L === 1 ? ' degrees' : ''}`,
  },
  { block: 'goHome', slots: {}, forms: [{ p: 'go back to start', levels: BOTH }], print: () => 'go back to start' },
  // Retired: still read and printed, so an old program converts, but never suggested.
  ...['X', 'Y', 'Z'].map((axis) => ({
    block: `move${axis}`,
    retired: true,
    slots: { feet: 'num' },
    forms: [{ p: `move ${axis.toLowerCase()} by {feet} ${FEET}`, levels: BOTH }],
    print: (p, L, f) => `move ${axis} by ${f.num(p.feet)}${L === 1 ? ' feet' : ''}`,
  })),

  // ---- Look -----------------------------------------------------------------------------
  {
    block: 'say',
    slots: { text: 'text' },
    forms: [
      { p: 'say {text...}', levels: BEGINNER },
      { p: 'say {text}', levels: PRO },
    ],
    print: (p, L, f) => `say ${f.text(p.text)}`,
  },
  {
    block: 'tell',
    slots: { object: 'object', text: 'text' },
    forms: [
      { p: 'tell {object} {text...}', levels: BEGINNER },
      { p: 'tell {object} {text}', levels: PRO },
    ],
    print: (p, L, f) => `tell ${f.object(p.object)} ${f.text(p.text)}`,
  },
  {
    block: 'changeSize',
    slots: { percent: 'num' },
    forms: [{ p: `change size by {percent} ${PERCENT}`, levels: BOTH }],
    print: (p, L, f) => `change size by ${f.num(p.percent)}${L === 1 ? '%' : ''}`,
  },
  {
    block: 'setSize',
    slots: { percent: 'num' },
    forms: [{ p: `set size to {percent} ${PERCENT}`, levels: BOTH }],
    print: (p, L, f) => `set size to ${f.num(p.percent)}${L === 1 ? '%' : ''}`,
  },
  {
    block: 'setOpacity',
    slots: { percent: 'num' },
    forms: [{ p: `set opacity to {percent} ${PERCENT}`, levels: BOTH }],
    print: (p, L, f) => `set opacity to ${f.num(p.percent)}${L === 1 ? '%' : ''}`,
  },
  {
    block: 'changeColor',
    slots: { color: 'color' },
    forms: [{ p: 'change (color | colour) to {color}', levels: BOTH }],
    print: (p, L, f) => `change color to ${f.color(p.color)}`,
  },
  {
    block: 'markerColor',
    slots: { color: 'color' },
    forms: [{ p: 'marker (color | colour) [to] {color}', levels: BOTH }],
    print: (p, L, f) => `marker color ${f.color(p.color)}`,
  },
  { block: 'markerDown', slots: {}, forms: [{ p: 'marker down', levels: BOTH }], print: () => 'marker down' },
  { block: 'markerUp', slots: {}, forms: [{ p: 'marker up', levels: BOTH }], print: () => 'marker up' },
  { block: 'eraseMarks', slots: {}, forms: [{ p: 'erase all marks', levels: BOTH }], print: () => 'erase all marks' },

  // ---- Math -----------------------------------------------------------------------------
  // The longer `set x to …` and `x = …` shapes come first, so `set x to 5` is only tried once
  // every sum and function has failed.
  {
    block: 'randomVar',
    slots: { name: 'name', a: 'num', b: 'num' },
    forms: [
      { p: 'set {name} to random {a} to {b}', levels: BOTH },
      { p: '{name} = random {a} to {b}', levels: PRO },
    ],
    print: (p, L, f) => (L === 1
      ? `set ${f.name(p.name)} to random ${f.num(p.a)} to ${f.num(p.b)}`
      : `${f.name(p.name)} = random ${f.num(p.a)} to ${f.num(p.b)}`),
  },
  {
    block: 'mathFn',
    slots: { name: 'name', a: 'num' },
    forms: FUNCTIONS.flatMap(({ fn, words, also = [] }) => [words, ...also].flatMap((w) => [
      { p: `set {name} to [the] ${w} {a}`, levels: BOTH, fixed: { fn } },
      { p: `{name} = [the] ${w} {a}`, levels: PRO, fixed: { fn } },
    ])),
    print: (p, L, f) => {
      const words = (FUNCTIONS.find((x) => x.fn === p.fn) ?? FUNCTIONS[0]).words;
      return L === 1 ? `set ${f.name(p.name)} to ${words} ${f.num(p.a)}` : `${f.name(p.name)} = ${words} ${f.num(p.a)}`;
    },
  },
  {
    block: 'calc',
    slots: { name: 'name', a: 'num', b: 'num' },
    // Beginner also takes the symbols the block itself shows, quietly, and Pro the words.
    forms: SUMS.flatMap(({ op, pats }) => pats.flatMap((pat) => [
      { p: `set {name} to ${pat}`, levels: BOTH, fixed: { op } },
      { p: `{name} = ${pat}`, levels: PRO, fixed: { op }, post: sumOrChange },
    ])),
    print: (p, L, f) => {
      const sum = SUMS.find((s) => s.op === p.op) ?? SUMS[0];
      const body = (L === 1 ? sum.words : sum.symbol).replace('{a}', f.num(p.a)).replace('{b}', f.num(p.b));
      return L === 1 ? `set ${f.name(p.name)} to ${body}` : `${f.name(p.name)} = ${body}`;
    },
  },
  {
    block: 'changeVar',
    slots: { name: 'name', value: 'num' },
    forms: [
      { p: 'change {name} by {value}', levels: BOTH },
      // VisualHedy's Beginner words for the same thing.
      { p: 'add {value} to {name}', levels: BOTH },
      { p: 'take {value} from {name}', levels: BOTH, post: (params) => negate(params) },
    ],
    print: (p, L, f) => {
      if (L === 1) return `change ${f.name(p.name)} by ${f.num(p.value)}`;
      const v = p.value;
      if (typeof v === 'number' && v < 0) return `${f.name(p.name)} = ${f.name(p.name)} - ${f.num(-v)}`;
      if (typeof v === 'string' && /^\s*-\s*\d/.test(v) && Number.isFinite(Number(v)) && Number(v) < 0) {
        return `${f.name(p.name)} = ${f.name(p.name)} - ${f.num(-Number(v))}`;
      }
      return `${f.name(p.name)} = ${f.name(p.name)} + ${f.num(v)}`;
    },
  },
  {
    block: 'setVar',
    slots: { name: 'name', value: 'num' },
    forms: [
      { p: 'set {name} to {value}', levels: BOTH },
      { p: 'remember {name} is {value}', levels: BOTH },
      { p: '{name} = {value}', levels: PRO },
    ],
    print: (p, L, f) => (L === 1 ? `set ${f.name(p.name)} to ${f.num(p.value)}` : `${f.name(p.name)} = ${f.num(p.value)}`),
  },
  {
    block: 'shareVar',
    slots: { name: 'name' },
    forms: [{ p: 'share {name} with every object', levels: BOTH }],
    print: (p, L, f) => `share ${f.name(p.name)} with every object`,
  },
];

// `take 3 from x` is "change x by -3". A name cannot be negated in a block, so `take n from x`
// is the sum `x = x - n` instead.
function negate(params) {
  if (typeof params.value === 'number') return { type: 'changeVar', params: { ...params, value: -params.value } };
  return { type: 'calc', params: { name: params.name, a: params.name, op: '-', b: params.value } };
}

// The entry that prints each block type.
export const PRINTERS = new Map();
for (const cmd of COMMANDS) if (cmd.print && !PRINTERS.has(cmd.block)) PRINTERS.set(cmd.block, cmd);

// Words that cannot be a name, because a line reading them as one would mean something else
// (`set size to 5` is the object's size; `if x is more than 5` must not read `more` as a name).
// Kept as small as that rule allows: every word here is a name some student can no longer use.
// Checked against every program in both galleries; `root` (Atom Hall) is why `square root of`
// reserves only `square`.
export const RESERVED = new Set([
  'size', 'tilt', 'opacity', 'color', 'colour', 'more', 'less', 'least', 'most', 'than', 'until', 'the',
  'random', 'square', 'absolute', 'rounded', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'smaller', 'larger', 'remainder', 'plus', 'minus', 'times', 'to', 'by', 'of', 'and', 'is',
  'feet', 'foot', 'ft', 'degrees', 'degree', 'seconds', 'second', 'percent', 'over', 'away',
  'smoothly', 'smooth', 'straight', 'bouncy', 'bouncily', 'forward', 'up',
  'if', 'repeat', 'forever', 'wait', 'when', 'say', 'tell', 'set', 'change', 'move', 'glide', 'rotate',
  'duplicate', 'marker', 'erase', 'share', 'remember', 'add', 'take', 'go',
  'else', 'elif', 'while', 'for', 'define', 'def', 'or', 'not', 'true', 'false',
]);

export const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isValidName(word) {
  return NAME_RE.test(word) && !RESERVED.has(word.toLowerCase());
}

// The first word of every form, so a line can be routed to the commands it could be.
export const COMMAND_WORDS = new Set([
  'repeat', 'forever', 'wait', 'when', 'duplicate', 'if', 'move', 'glide', 'rotate', 'set', 'go', 'say', 'tell',
  'change', 'marker', 'erase', 'remember', 'add', 'take', 'share',
]);
// What did-you-mean offers for an unknown first word. Retired words are left out on purpose.
export const SUGGESTED_WORDS = [...COMMAND_WORDS].filter((w) => w !== 'remember' && w !== 'add' && w !== 'take');
