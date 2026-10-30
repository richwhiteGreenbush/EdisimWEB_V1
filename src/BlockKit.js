import { BLOCK_DEFS, makeBlock } from './BlockDefs.js';

// Short names for writing a shipped block program in a table, so a world's programs read like
// the stack a student will see when they open one. Every call goes through makeBlock(), so each
// block gets a fresh id and every param its schema asks for. Call a program builder once per
// object: two objects must not share one tree of block ids.

export const setv = (name, value) => makeBlock('setVar', { name, value });
export const change = (name, value) => makeBlock('changeVar', { name, value });
export const calc = (name, a, op, b) => makeBlock('calc', { name, a, op, b });
export const fn = (name, fnName, a) => makeBlock('mathFn', { name, fn: fnName, a });
export const random = (name, a, b) => makeBlock('randomVar', { name, a, b });
export const share = (name) => makeBlock('shareVar', { name });
export const readout = (label, value, unit = '') => makeBlock('sayValue', { label, value, unit });

export const forever = (...children) => makeBlock('forever', {}, children);
export const repeat = (count, ...children) => makeBlock('repeat', { count }, children);
export const until = (a, op, b, ...children) => makeBlock('repeatUntil', { a, op, b }, children);
export const when = (a, op, b, ...children) => makeBlock('ifCompare', { a, op, b }, children);
export const whenSaid = (text, ...children) => makeBlock('whenSaid', { text }, children);
export const wait = (seconds) => makeBlock('wait', { seconds });

export const forward = (feet) => makeBlock('moveForward', { feet });
export const up = (feet) => makeBlock('moveUp', { feet });
export const both = (fwd, rise) => makeBlock('moveBoth', { forward: fwd, up: rise });
export const rotate = (degrees) => makeBlock('rotate', { degrees });
export const tilt = (degrees) => makeBlock('setTilt', { degrees });
export const goHome = () => makeBlock('goHome');

export const say = (text) => makeBlock('say', { text });
export const size = (percent) => makeBlock('setSize', { percent });
export const opacity = (percent) => makeBlock('setOpacity', { percent });
export const color = (hex) => makeBlock('changeColor', { color: hex });
export const markerColor = (hex) => makeBlock('markerColor', { color: hex });
export const markerDown = () => makeBlock('markerDown');
export const markerUp = () => makeBlock('markerUp');

// One line of a stack as it reads in the editor: "set gross to wage × hours".
function blockText(block) {
  const def = BLOCK_DEFS[block.type];
  return def.label.map((token) => {
    if (token.text) return token.text;
    const schema = def.params[token.field];
    const value = block.params[token.field];
    if (schema?.type === 'select') return schema.options.find((o) => o.value === value)?.label ?? value;
    return String(value ?? '');
  }).filter((part) => part !== '').join(' ');
}

// A block tree as the { cat, text, depth } rows an activity board or a block board paints. Taken
// from the real blocks rather than typed again, so a board cannot quote a program differently
// from the one running beside it.
export function programSteps(blocks, depth = 0, out = []) {
  for (const block of blocks || []) {
    out.push({ cat: BLOCK_DEFS[block.type].category, text: blockText(block), depth });
    if (block.children) programSteps(block.children, depth + 1, out);
  }
  return out;
}
