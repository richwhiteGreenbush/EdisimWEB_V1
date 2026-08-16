// Sets how see-through a placed object is, for the `set opacity to N%` block.
//
// Three things make this less trivial than `material.opacity = x`:
//
//  1. **`transparent` has to be switched ON, and left on once it has been.** three.js
//     decides at material level whether a mesh goes in the opaque queue or the transparent
//     one, and a material with `transparent: false` ignores `opacity` completely. So going
//     below 100% must set the flag -- and coming back TO 100% must not simply clear it,
//     because a material that was authored transparent in the first place (the sea's light
//     shafts, the lungs' lobes, a browser panel's glass) would then render as solid and
//     the object would come back looking wrong rather than coming back unchanged.
//
//  2. **The original opacity has to be remembered.** "100%" means "however see-through
//     this was when it was built", not "fully solid". The first pass of this kind of code
//     always writes `opacity = 1`, which quietly turns every translucent prop in the world
//     opaque the moment a student touches the block. The authored value is stashed on the
//     material the first time it is altered, and restored exactly at 100%.
//
//  3. **A prop is many materials.** Nearly everything here is a merged mesh plus a few
//     extras -- and some meshes carry an ARRAY of materials -- so this walks the whole
//     subtree rather than assuming one.
//
// Materials are per-object in this project (PropKit's house rule: never shared between
// builders), so mutating them in place cannot leak into another object.

// Below this, an object that is meant to be "invisible" still swallows clicks and still
// writes depth. Rather than special-case that, opacity is clamped to a floor where the
// object is a faint ghost -- present, obviously altered, and still findable by a student
// who has just made it vanish and wants to undo that.
const MIN_OPACITY = 0.05;

export function applyOpacity(object3D, percent) {
  if (!object3D) return;
  const value = Number(percent);
  if (!Number.isFinite(value)) return;
  const target = Math.max(0, Math.min(100, value)) / 100;

  object3D.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;

      // Stash what this material was authored as, once, the first time it is touched.
      if (material.userData.baseOpacity === undefined) {
        material.userData.baseOpacity = material.opacity ?? 1;
        material.userData.baseTransparent = !!material.transparent;
      }

      if (target >= 1) {
        material.opacity = material.userData.baseOpacity;
        material.transparent = material.userData.baseTransparent;
      } else {
        material.opacity = Math.max(MIN_OPACITY, material.userData.baseOpacity * target);
        material.transparent = true;
        // A half-transparent object that still writes depth hides whatever is behind it,
        // which reads as a hole rather than as glass.
        material.depthWrite = false;
      }
      if (target >= 1) material.depthWrite = material.userData.baseTransparent ? false : true;
      material.needsUpdate = true;
    }
  });
}
