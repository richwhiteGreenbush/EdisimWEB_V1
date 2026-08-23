import { BLOCK_DEFS, DUPLICATE_BLOCK } from './BlockDefs.js';

import { uuid } from './Uuid.js';
// Backs the "duplicate" program block: makes a second, independent copy of a placed
// object, wherever that object currently is.
//
// The copy is made from the object's RECORD, not from its Object3D. Every kind in this
// app already knows how to rebuild itself from a record -- a preset prop from its
// builder name, a balloon from its painted canvas, a browser panel from its URL, an
// imported model from its stored file blobs -- so cloning the record and handing it
// back to WorldStore.rehydrateOne() duplicates all nine kinds with no per-kind code
// here at all. object3D.clone() would do none of that: it would share materials and
// textures with the original (which PlacedRegistry.disposeObject3D would then destroy
// out from under the survivor), and would leave the copy with no record, so it could
// not be saved, reloaded, or edited.

// Hard ceiling on how many objects a world may hold. Duplicate is the only thing in
// the app that can add objects without a human clicking each time, so it is the only
// thing that needs one: `forever { duplicate }` otherwise allocates geometry every
// frame until the tab dies.
export const MAX_WORLD_OBJECTS = 400;

// Strips every `duplicate` block out of a program tree, at any depth.
//
// This is what stops the block being exponential. A copy that inherited an unmodified
// program would itself start duplicating on its own next frame, and each of ITS copies
// after that -- so `forever { duplicate }` would double the world every few frames and
// hit the ceiling above almost instantly, allocating hundreds of models in one burst.
// Removing just this one block leaves the rest of the program intact, so a spinning
// object still produces spinning copies; they simply do not breed.
export function stripDuplicateBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type === DUPLICATE_BLOCK) continue;
    const copy = { id: uuid(), type: block.type, params: { ...block.params } };
    if (BLOCK_DEFS[block.type]?.hasChildren) {
      copy.children = stripDuplicateBlocks(block.children);
      // A loop left holding nothing is dropped rather than carried over. `repeat 4
      // { duplicate }` -- the most obvious program anyone writes with this block --
      // would otherwise hand every copy an empty `repeat`, which does nothing but is
      // still a non-empty program, so each copy would sprout a green play icon
      // advertising a script with no effect.
      if (!copy.children.length) continue;
    }
    out.push(copy);
  }
  return out;
}

// Shallow-clones a record for the copy. `files` entries hold Blobs, which are immutable
// -- the copy shares the same Blob objects rather than re-encoding megabytes of model
// data, and neither record can alter what the other sees.
function cloneRecord(record, transform) {
  const copy = {
    ...record,
    id: uuid(),
    createdAt: Date.now(),
    transform,
  };
  if (record.files) copy.files = record.files.map((file) => ({ ...file }));
  if (record.options) copy.options = { ...record.options };
  if (record.program?.length) {
    copy.program = stripDuplicateBlocks(record.program);
    if (!copy.program.length) delete copy.program;
  }
  // A JavaScript program cannot have its duplicate() stripped out the way a block tree
  // can -- there is no parser here to rewrite it with -- so the copy carries a PERSISTED
  // flag that makes its duplicate() calls no-ops instead. Same rule, other means: the
  // copy keeps the rest of its behaviour (a spinning object still produces spinning
  // copies), it just cannot breed. Copies of copies inherit the flag through the spread.
  if (copy.programMode === 'js' && copy.programJs) copy.programNoDuplicate = true;
  return copy;
}

// Duplicates the placed object `id`, offsetting the copy `offset` feet along +X.
//
// Returns the new record, or null if it could not duplicate (unknown id, or the world
// is already at the ceiling). Rehydration is asynchronous -- some kinds re-fetch or
// re-decode files -- so this returns as soon as the work is scheduled rather than
// making the caller wait; the program runner steps on and the copy appears when it is
// ready, which is a frame or two later at worst.
export function duplicatePlacedObject({ id, offset = 4, registry, worldStore, menu }) {
  const item = registry.get(id);
  if (!item?.record) return null;

  if (registry.count >= MAX_WORLD_OBJECTS) {
    menu?.toast(`That is ${MAX_WORLD_OBJECTS} objects — no room to duplicate any more.`, { tone: 'error' });
    return null;
  }

  // Taken from the LIVE object3D, not from record.transform: a program that has been
  // moving or resizing this object has not written those changes back to the record
  // (persistTransform only runs on an ObjectMenu edit), so the record's transform can
  // be many feet stale and the copy would appear back at the object's starting point.
  const object3D = item.object3D;
  const transform = {
    position: [object3D.position.x + offset, object3D.position.y, object3D.position.z],
    rotation: [object3D.rotation.x, object3D.rotation.y, object3D.rotation.z],
    scale: object3D.scale.toArray(),
  };

  const copy = cloneRecord(item.record, transform);

  worldStore
    .rehydrateOne(copy)
    .then(() => worldStore.saveObject(copy))
    .catch((err) => {
      console.error('Could not duplicate object:', err);
      menu?.toast('Could not duplicate that object.', { tone: 'error' });
    });

  return copy;
}
