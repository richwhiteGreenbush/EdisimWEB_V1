// Static metadata for every block type: which category (and color) it belongs to,
// whether it's a C-shaped block that wraps child blocks, and its label + inline params.
// `label` is an ordered list of tokens -- plain strings render as text, { field } tokens
// render as an inline input for that param -- so ProgramEditor can render any block
// generically instead of hand-writing markup per type.

import { PALETTE_SWATCHES } from './config.js';

import { uuid } from './Uuid.js';
export const CATEGORIES = {
  control: { name: 'Control', fill: '#ffab19', dark: '#cf8b17' },
  motion: { name: 'Motion', fill: '#4c97ff', dark: '#3373cc' },
  look: { name: 'Look', fill: '#9966ff', dark: '#774dcc' },
  math: { name: 'Math', fill: '#3fae5a', dark: '#2f8a46' },
};

// What a comparison can ask. Shared by `if` and `repeat until`, and the values are persisted.
const COMPARE_OPTIONS = [
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '=', label: '=' },
  { value: '>=', label: '≥' },
  { value: '>', label: '>' },
];

// A variable's name is a word: letters, digits and underscores, starting with a letter. Spaces
// become underscores rather than being refused, because a student typing "top speed" means
// something perfectly clear. Applied as they type, so a name in a saved block is always clean.
export function cleanVariableName(raw) {
  return String(raw ?? '')
    .trimStart()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 16);
}

// True for a param value that names a variable rather than holding a number. Every numeric
// param saved before variables existed is a number, or a numeric string, so it answers false.
export function isVariableRef(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isNaN(Number(value));
}

// Blocks that give a variable its value, in this program.
const SETTERS = new Set(['setVar', 'changeVar', 'calc', 'mathFn', 'randomVar']);

export function variablesIn(blocks, out = new Set()) {
  for (const block of blocks || []) {
    if (SETTERS.has(block.type) && block.params?.name) out.add(block.params.name);
    if (block.children) variablesIn(block.children, out);
  }
  return out;
}

// Every name this program publishes with `share`.
export function sharedVariablesIn(blocks, out = new Set()) {
  for (const block of blocks || []) {
    if (block.type === 'shareVar' && block.params?.name) out.add(block.params.name);
    if (block.children) sharedVariablesIn(block.children, out);
  }
  return out;
}

// `duplicate` is the one block whose effect is not confined to the object running it,
// so it is the one block a copy must never inherit -- see stripDuplicateBlocks() in
// Duplicator.js. Named here rather than spelled as a literal in three files.
export const DUPLICATE_BLOCK = 'duplicate';

export const BLOCK_DEFS = {
  repeat: {
    category: 'control',
    hasChildren: true,
    label: [{ text: 'repeat' }, { field: 'count' }, { text: 'times' }],
    params: { count: { type: 'number', default: 10, min: 1, step: 1, variable: true } },
  },
  forever: {
    category: 'control',
    hasChildren: true,
    label: [{ text: 'forever' }],
    params: {},
  },
  wait: {
    category: 'control',
    hasChildren: false,
    label: [{ text: 'wait' }, { field: 'seconds' }, { text: 'seconds' }],
    params: { seconds: { type: 'number', default: 1, min: 0, step: 0.1, variable: true } },
  },
  // A HAT block: its children do not run when the program is played, only when some
  // object anywhere in the world runs `say` with matching text. That is why it is filed
  // under Control -- it is not a thing an object does, it is a reason for it to start.
  whenSaid: {
    category: 'control',
    hasChildren: true,
    hat: true,
    label: [{ text: 'when an object says' }, { field: 'text' }],
    params: { text: { type: 'text', default: 'hello' } },
  },

  // WORLD EVENTS. The sky is a thing a program can WAIT FOR, which is the whole argument
  // for having a time of day in a coding app rather than a picture of one -- weather
  // nobody can react to is scenery.
  //
  // It needs almost no machinery: ProgramManager.broadcast() already walks both block
  // hats and JavaScript hats with a re-entry guard, so this is a second hat type matched
  // in the same loop and every JS whenSaid('sunset') hears it too, across the language
  // boundary, for free.
  whenWorld: {
    category: 'control',
    hasChildren: true,
    hat: true,
    label: [{ text: 'when' }, { field: 'event' }],
    params: {
      event: {
        type: 'select',
        default: 'sunset',
        options: [
          { value: 'sunrise', label: 'the sun comes up' },
          { value: 'noon', label: 'it is the middle of the day' },
          { value: 'sunset', label: 'the sun goes down' },
          { value: 'night', label: 'it gets dark' },
          { value: 'start', label: 'this world opens' },
        ],
      },
    },
  },

  // `if` and `repeat until` are what make a variable worth having: a value nothing can ask
  // about is only a label. `repeat until` is what stops a falling object at the ground, and it
  // cannot hang the tab -- see runPass() in ProgramRunner.js.
  ifCompare: {
    category: 'control',
    hasChildren: true,
    label: [{ text: 'if' }, { field: 'a' }, { field: 'op' }, { field: 'b' }],
    params: {
      a: { type: 'number', default: 0, step: 1, variable: true },
      op: { type: 'select', default: '>', options: COMPARE_OPTIONS, compact: true },
      b: { type: 'number', default: 0, step: 1, variable: true },
    },
  },
  repeatUntil: {
    category: 'control',
    hasChildren: true,
    label: [{ text: 'repeat until' }, { field: 'a' }, { field: 'op' }, { field: 'b' }],
    params: {
      a: { type: 'number', default: 0, step: 1, variable: true },
      op: { type: 'select', default: '<=', options: COMPARE_OPTIONS, compact: true },
      b: { type: 'number', default: 0, step: 1, variable: true },
    },
  },

  // --- Motion ---------------------------------------------------------------
  //
  // `moveForward` and `glide` travel along the object's OWN facing, which is the whole
  // reason they replaced move X/Z. World-axis movement meant rotating something never
  // changed where it would then travel, so "drive around in a square" was not writable at
  // all and every patrol in every world had to be an out-and-back with a rotate 180 in
  // the middle. With these, a rotate finally changes what the next move does.
  //
  // `moveUp` is the deliberate exception -- see the note on it below.
  moveForward: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move forward' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 2, step: 0.5, variable: true } },
  },
  // The one movement block that is NOT relative to facing, and deliberately so. Up is up
  // whichever way a thing is pointing, and a lift that tilted with its object would be
  // both surprising and useless for the job these are for -- raising a dome onto a
  // building, floating a balloon, dropping rain. A negative number goes down.
  moveUp: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move up by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5, variable: true } },
  },
  // The one block that spans time -- and therefore the only one that can be given a
  // SHAPE. A glide that starts at full speed and stops dead reads as something being
  // pushed on a trolley; the same ten feet over the same two seconds with an ease on it
  // reads as something that meant to go there.
  //
  // `ease` is a new param on an existing PERSISTED block, which is the whole reason it is
  // a param and not a change of behaviour: createBlockInstance() gives NEW blocks the
  // default below, while every block already saved in IndexedDB, in a downloaded world
  // file, and in the twenty-odd published gallery worlds simply has no such key -- and
  // ProgramRunner reads it as `?? 'straight'`, so all of those move exactly as they do
  // today. Same discipline as programJsAuto and targetHeight.
  glide: {
    category: 'motion',
    hasChildren: false,
    label: [
      { text: 'glide' }, { field: 'feet' }, { text: 'feet over' },
      { field: 'seconds' }, { text: 'seconds' }, { field: 'ease' },
    ],
    params: {
      feet: { type: 'number', default: 10, step: 1, variable: true },
      seconds: { type: 'number', default: 2, min: 0.1, step: 0.1, variable: true },
      ease: {
        type: 'select',
        default: 'smooth',
        options: [
          { value: 'smooth', label: 'smoothly' },
          { value: 'straight', label: 'straight' },
          { value: 'bouncy', label: 'bouncy' },
        ],
      },
    },
  },
  goHome: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'go back to start' }],
    params: {},
  },
  rotate: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'rotate' }, { field: 'degrees' }, { text: 'degrees' }],
    params: { degrees: { type: 'number', default: 15, step: 5, variable: true } },
  },

  // Both directions in ONE tick, and that is its whole reason for existing. The marker samples
  // the object's position once a frame, so `move forward` then `move up` land on different
  // frames and a parabola is drawn as a staircase.
  moveBoth: {
    category: 'motion',
    hasChildren: false,
    label: [
      { text: 'move forward' }, { field: 'forward' }, { text: 'and up' },
      { field: 'up' }, { text: 'feet' },
    ],
    params: {
      forward: { type: 'number', default: 1, step: 0.5, variable: true },
      up: { type: 'number', default: 1, step: 0.5, variable: true },
    },
  },
  // Leans the object about its own forward axis, the way a head tips to one side, which is
  // what lets a program swing anything: a pendulum, a cannon barrel, a seesaw, a big wheel.
  // Absolute rather than "by", because a swing is computed as an angle. Positive leans the top
  // to the left as you look at the object's front. It never changes which way the object faces
  // (three composes rotation.z first), so `rotate` and `move forward` carry on as before.
  setTilt: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'set tilt to' }, { field: 'degrees' }, { text: 'degrees' }],
    params: { degrees: { type: 'number', default: 0, step: 5, variable: true } },
  },

  // --- Look -----------------------------------------------------------------
  say: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'say' }, { field: 'text' }],
    params: { text: { type: 'text', default: 'hello' } },
  },
  changeSize: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'change size by' }, { field: 'percent' }, { text: '%' }],
    params: { percent: { type: 'number', default: 10, step: 5, variable: true } },
  },
  // "to", not "by" -- absolute, and measured against the size the object was when its
  // program started rather than against its current size. Relative to current, `set size
  // to 50%` inside a loop halves it every pass and the object vanishes in a second, which
  // is exactly the confusion that makes an absolute block worth having alongside the
  // relative one.
  setSize: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'set size to' }, { field: 'percent' }, { text: '%' }],
    params: { percent: { type: 'number', default: 100, min: 1, step: 5, variable: true } },
  },
  setOpacity: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'set opacity to' }, { field: 'percent' }, { text: '%' }],
    params: { percent: { type: 'number', default: 100, min: 0, max: 100, step: 5, variable: true } },
  },
  changeColor: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'change color to' }, { field: 'color' }],
    params: { color: { type: 'color', default: PALETTE_SWATCHES[0] } },
  },

  // --- The marker ----------------------------------------------------------
  //
  // An in-world 3D pen: with the marker down, an object leaves a 3-inch coloured tube
  // behind it wherever it goes. Four blocks, filed under Look because a mark is something
  // an object leaves on the world's appearance rather than a thing it does to itself.
  //
  // `eraseMarks` is the odd one out and is the reason the four are worth having together:
  // it clears EVERY mark in the world, not only the ones this object made. That is what
  // the block says and it is what makes it useful -- a student who has scribbled with five
  // robots wants one button, not five.
  markerColor: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'marker color' }, { field: 'color' }],
    params: { color: { type: 'color', default: PALETTE_SWATCHES[3] } },
  },
  markerDown: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'marker down' }],
    params: {},
  },
  markerUp: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'marker up' }],
    params: {},
  },
  eraseMarks: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'erase all marks' }],
    params: {},
  },

  // --- Math ----------------------------------------------------------------
  //
  // Variables, for anything that has to work something out. A variable belongs to the object
  // whose program sets it (hats on that object share it), it starts afresh on every run, and it
  // is not saved. These blocks take NO FRAME: a calculation is not a thing the world can watch,
  // and at one frame a block a six-line step would take a tenth of a second to happen.
  //
  // The `op` and `fn` values are persisted, so they are only ever added to.
  setVar: {
    category: 'math',
    hasChildren: false,
    label: [{ text: 'set' }, { field: 'name' }, { text: 'to' }, { field: 'value' }],
    params: {
      name: { type: 'name', default: 'x' },
      value: { type: 'number', default: 0, step: 1, variable: true },
    },
  },
  changeVar: {
    category: 'math',
    hasChildren: false,
    label: [{ text: 'change' }, { field: 'name' }, { text: 'by' }, { field: 'value' }],
    params: {
      name: { type: 'name', default: 'x' },
      value: { type: 'number', default: 1, step: 1, variable: true },
    },
  },
  calc: {
    category: 'math',
    hasChildren: false,
    label: [
      { text: 'set' }, { field: 'name' }, { text: 'to' },
      { field: 'a' }, { field: 'op' }, { field: 'b' },
    ],
    params: {
      name: { type: 'name', default: 'x' },
      a: { type: 'number', default: 1, step: 1, variable: true },
      op: {
        type: 'select',
        default: '+',
        compact: true,
        options: [
          { value: '+', label: '+' },
          { value: '-', label: '−' },
          { value: '*', label: '×' },
          { value: '/', label: '÷' },
          { value: '^', label: '^' },
          { value: 'min', label: 'min' },
          { value: 'max', label: 'max' },
          { value: 'mod', label: 'mod' },
        ],
      },
      b: { type: 'number', default: 1, step: 1, variable: true },
    },
  },
  mathFn: {
    category: 'math',
    hasChildren: false,
    label: [
      { text: 'set' }, { field: 'name' }, { text: 'to' },
      { field: 'fn' }, { text: 'of' }, { field: 'a' },
    ],
    params: {
      name: { type: 'name', default: 'x' },
      fn: {
        type: 'select',
        default: 'sqrt',
        compact: true,
        options: [
          { value: 'sqrt', label: 'square root' },
          { value: 'square', label: 'square' },
          { value: 'abs', label: 'absolute' },
          { value: 'round', label: 'rounded' },
          { value: 'sin', label: 'sin°' },
          { value: 'cos', label: 'cos°' },
          { value: 'tan', label: 'tan°' },
          { value: 'asin', label: 'asin°' },
          { value: 'acos', label: 'acos°' },
          { value: 'atan', label: 'atan°' },
        ],
      },
      a: { type: 'number', default: 1, step: 1, variable: true },
    },
  },
  randomVar: {
    category: 'math',
    hasChildren: false,
    label: [
      { text: 'set' }, { field: 'name' }, { text: 'to random' },
      { field: 'a' }, { text: 'to' }, { field: 'b' },
    ],
    params: {
      name: { type: 'name', default: 'x' },
      a: { type: 'number', default: 0, step: 1, variable: true },
      b: { type: 'number', default: 1, step: 1, variable: true },
    },
  },
  // A readout: "landed after 2.02 s". `say` can also carry values, written {t} in its text,
  // which is the way to put two of them in one sentence.
  sayValue: {
    category: 'math',
    hasChildren: false,
    label: [{ text: 'say' }, { field: 'label' }, { field: 'value' }, { field: 'unit' }],
    params: {
      label: { type: 'text', default: 'x is', short: true },
      value: { type: 'number', default: 0, step: 1, variable: true },
      unit: { type: 'text', default: 'feet', short: true },
    },
  },
  // Publishes this object's value so every other object can read it by name. A program's own
  // variable of the same name always wins. Shared values last until the world is replaced.
  shareVar: {
    category: 'math',
    hasChildren: false,
    label: [{ text: 'share' }, { field: 'name' }, { text: 'with every object' }],
    params: { name: { type: 'name', default: 'x' } },
  },

  // --- Retired -------------------------------------------------------------
  //
  // Off the palette, still runnable. A block type is PERSISTED inside every saved
  // program -- in IndexedDB, in an exported world file, and in the copy a student sent a
  // classmate -- so deleting these outright would not tidy anything up, it would turn
  // somebody's working program into a silent no-op with no way to see why. They are kept
  // out of PALETTE_ORDER so nobody writes a new one, and kept in the runner so nobody's
  // old one breaks.
  moveX: {
    category: 'motion',
    hasChildren: false,
    retired: true,
    label: [{ text: 'move X by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  moveY: {
    category: 'motion',
    hasChildren: false,
    retired: true,
    label: [{ text: 'move Y by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  moveZ: {
    category: 'motion',
    hasChildren: false,
    retired: true,
    label: [{ text: 'move Z by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  // Filed under Control, not Look: Scratch puts "create clone of" there for the same
  // reason -- it does not change how this object looks, it changes how many there are.
  //
  // The copy is offset rather than dropped in place. Two objects sharing one position
  // is the worst possible outcome for a student: the copy is invisible, and the pair
  // z-fight into a flickering mess that reads as a bug rather than as a second object.
  duplicate: {
    category: 'control',
    hasChildren: false,
    label: [{ text: 'duplicate' }, { field: 'offset' }, { text: 'ft away' }],
    params: { offset: { type: 'number', default: 4, step: 0.5 } },
  },
};

// What the palette offers, in order. Retired types are deliberately absent -- see the
// note on them above.
export const PALETTE_ORDER = [
  'repeat', 'forever', 'wait', 'whenSaid', 'whenWorld', 'duplicate', 'ifCompare', 'repeatUntil',
  'moveForward', 'moveUp', 'moveBoth', 'glide', 'rotate', 'setTilt', 'goHome',
  'say', 'changeSize', 'setSize', 'setOpacity', 'changeColor',
  'markerColor', 'markerDown', 'markerUp', 'eraseMarks',
  'setVar', 'changeVar', 'calc', 'mathFn', 'randomVar', 'sayValue', 'shareVar',
];

// One block for a program shipped on a prop, with every param filled from its schema first.
export function makeBlock(type, params = {}, children) {
  const block = createBlockInstance(type);
  Object.assign(block.params, params);
  if (children) block.children = children;
  return block;
}

export function createBlockInstance(type) {
  const def = BLOCK_DEFS[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  const params = {};
  for (const [key, schema] of Object.entries(def.params)) {
    params[key] = schema.default;
  }
  const block = { id: uuid(), type, params };
  if (def.hasChildren) block.children = [];
  return block;
}

// Deep-clones a block tree, giving every block a fresh id -- used both to load a
// saved program into an editable working copy and to keep that copy independent of
// whatever's currently saved on the record until the user hits Save.
export function cloneBlockTree(blocks) {
  return blocks.map((block) => {
    const copy = { id: uuid(), type: block.type, params: { ...block.params } };
    if (block.children) copy.children = cloneBlockTree(block.children);
    return copy;
  });
}
