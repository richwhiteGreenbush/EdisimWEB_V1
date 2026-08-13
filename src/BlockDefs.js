// Static metadata for every block type: which category (and color) it belongs to,
// whether it's a C-shaped block that wraps child blocks, and its label + inline params.
// `label` is an ordered list of tokens -- plain strings render as text, { field } tokens
// render as an inline input for that param -- so ProgramEditor can render any block
// generically instead of hand-writing markup per type.

import { PALETTE_SWATCHES } from './config.js';

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
  moveX: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move X by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  moveY: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move Y by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  moveZ: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'move Z by' }, { field: 'feet' }, { text: 'feet' }],
    params: { feet: { type: 'number', default: 1, step: 0.5 } },
  },
  rotate: {
    category: 'motion',
    hasChildren: false,
    label: [{ text: 'rotate' }, { field: 'degrees' }, { text: 'degrees' }],
    params: { degrees: { type: 'number', default: 15, step: 5 } },
  },
  changeSize: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'change size by' }, { field: 'percent' }, { text: '%' }],
    params: { percent: { type: 'number', default: 10, step: 5 } },
  },
  changeColor: {
    category: 'look',
    hasChildren: false,
    label: [{ text: 'change color to' }, { field: 'color' }],
    params: { color: { type: 'color', default: PALETTE_SWATCHES[0] } },
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

export const PALETTE_ORDER = [
  'repeat', 'forever', 'wait', 'duplicate',
  'moveX', 'moveY', 'moveZ', 'rotate',
  'changeSize', 'changeColor',
];

export function createBlockInstance(type) {
  const def = BLOCK_DEFS[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  const params = {};
  for (const [key, schema] of Object.entries(def.params)) {
    params[key] = schema.default;
  }
  const block = { id: crypto.randomUUID(), type, params };
  if (def.hasChildren) block.children = [];
  return block;
}

// Deep-clones a block tree, giving every block a fresh id -- used both to load a
// saved program into an editable working copy and to keep that copy independent of
// whatever's currently saved on the record until the user hits Save.
export function cloneBlockTree(blocks) {
  return blocks.map((block) => {
    const copy = { id: crypto.randomUUID(), type: block.type, params: { ...block.params } };
    if (block.children) copy.children = cloneBlockTree(block.children);
    return copy;
  });
}
