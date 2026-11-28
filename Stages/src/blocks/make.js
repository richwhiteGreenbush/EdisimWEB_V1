// Making block instances. Every block in a project is created by `createBlock()` or copied by
// `cloneBlock()`, so every one carries a fresh id and every input its schema's default.
//
// The saved shape of a block, which is PERSISTED and therefore add-only:
//
//   { id, type,
//     inputs:    { NAME: { value, block? } },   value is the literal; block, when present, is a
//                                                reporter dropped into the slot (the literal stays,
//                                                so dragging the reporter out restores it, as in Scratch)
//     substack:  [block, ...],                   the first mouth of a C block
//     substack2: [block, ...] }                  the second mouth (if ... else)
//
// A script is { id, x, y, blocks: [block, ...] }: one stack, placed freely in the workspace.
import { BLOCKS } from './defs.js';

let counter = 0;
export function newId(prefix = 'b') {
  counter = (counter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function createBlock(type, values = {}) {
  const def = BLOCKS.get(type);
  if (!def) throw new Error(`Unknown block type "${type}"`);
  const block = { id: newId(), type, inputs: {} };
  for (const [name, spec] of Object.entries(def.inputs)) {
    block.inputs[name] = { value: spec.value ?? '' };
  }
  for (const [name, v] of Object.entries(values)) {
    if (!(name in def.inputs)) throw new Error(`Block "${type}" has no input "${name}"`);
    if (v && typeof v === 'object' && v.type) block.inputs[name].block = v;
    else block.inputs[name].value = v;
  }
  if (def.shape === 'c' || def.shape === 'c2') block.substack = [];
  if (def.shape === 'c2') block.substack2 = [];
  return block;
}

export function cloneBlock(block) {
  const copy = { id: newId(), type: block.type, inputs: {} };
  for (const [name, input] of Object.entries(block.inputs || {})) {
    copy.inputs[name] = { value: input.value };
    if (input.block) copy.inputs[name].block = cloneBlock(input.block);
  }
  if (block.substack) copy.substack = block.substack.map(cloneBlock);
  if (block.substack2) copy.substack2 = block.substack2.map(cloneBlock);
  return copy;
}

export function cloneScript(script, dx = 0, dy = 0) {
  return { id: newId('s'), x: script.x + dx, y: script.y + dy, blocks: script.blocks.map(cloneBlock) };
}

// Every block in a tree, reporters included, in reading order.
export function* walkBlocks(blocks) {
  for (const block of blocks || []) {
    yield block;
    for (const input of Object.values(block.inputs || {})) {
      if (input.block) yield* walkBlocks([input.block]);
    }
    if (block.substack) yield* walkBlocks(block.substack);
    if (block.substack2) yield* walkBlocks(block.substack2);
  }
}

// --- a small language for writing programs in code (templates, tests) ----------------------
//
//   B('motion_movesteps', { STEPS: 10 })
//   C('control_forever', {}, [ ...body ])
//   C2('control_if_else', { CONDITION: R('sensing_mousedown') }, [ ...then ], [ ...else ])
//   R('operator_add', { NUM1: 1, NUM2: V('score') })
//   V('score')                                  a variable reporter
//   script(x, y, [ ...blocks ])
export const B = (type, values = {}) => createBlock(type, values);
export const R = B;
export function C(type, values = {}, body = []) {
  const block = createBlock(type, values);
  block.substack = body;
  return block;
}
export function C2(type, values = {}, body = [], body2 = []) {
  const block = createBlock(type, values);
  block.substack = body;
  block.substack2 = body2;
  return block;
}
export const V = (name) => createBlock('data_variable', { VARIABLE: name });
export const script = (x, y, blocks) => ({ id: newId('s'), x, y, blocks });
