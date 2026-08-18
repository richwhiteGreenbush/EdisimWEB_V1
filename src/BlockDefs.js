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
};

// `duplicate` is the one block whose effect is not confined to the object running it,
// so it is the one block a copy must never inherit -- see stripDuplicateBlocks() in
// Duplicator.js. Named here rather than spelled as a literal in three files.
export const DUPLICATE_BLOCK = 'duplicate';

export const BLOCK_DEFS = {
  repeat: {
    category: 'control',
    hasChildren: true,
    label: [{ text: 'repeat' }, { field: 'count' }, { text: 'times' }],
    params: { count: { type: 'number', default: 10, min: 1, step: 1 } },
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
    params: { seconds: { type: 'number', default: 1, min: 0, step: 0.1 } },
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
    params: { feet: { type: 'number', default: 2, step: 0.5 } },
  },
  // The one movement block that is NOT relative to facing, and deliberately so. Up is up
  // whichever way a thing is pointing, and a lift that tilted with its object would be
  // both surprising and useless for the job these are for -- raising a dome onto a
  // building, floating a balloon, dropping rain. A negative number goes down.
  moveUp: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move up by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  glide: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'glide' }, { field: 'feet' }, { text: 'feet over' }, { field: 'seconds' }, { text: 'seconds' }],
    params: {
      feet: { type: 'number', default: 10, step: 1 },
      seconds: { type: 'number', default: 2, min: 0.1, step: 0.1 },
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
    params: { degrees: { type: 'number', default: 15, step: 5 } },
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
    params: { percent: { type: 'number', default: 10, step: 5 } },
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
    params: { percent: { type: 'number', default: 100, min: 1, step: 5 } },
  },
  setOpacity: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'set opacity to' }, { field: 'percent' }, { text: '%' }],
    params: { percent: { type: 'number', default: 100, min: 0, max: 100, step: 5 } },
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
  'repeat', 'forever', 'wait', 'whenSaid', 'duplicate',
  'moveForward', 'moveUp', 'glide', 'rotate', 'goHome',
  'say', 'changeSize', 'setSize', 'setOpacity', 'changeColor',
  'markerColor', 'markerDown', 'markerUp', 'eraseMarks',
];

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
