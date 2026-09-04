// THE ANIMATION CONTRACT.
//
// A tick should animate the CHILDREN of the object it was handed, never the registered
// root -- because four separate places in this app read the LIVE transform off a
// registered object and write it somewhere permanent:
//
//   BuildGizmo.persist()            re-derives record.transform from the live object3D
//   Duplicator.duplicatePlacedObject()  deliberately reads the live transform for the copy
//   ProgramManager.captureHome()    snapshots the live transform as `go back to start`
//   Primitives.renderModelFromCluster()  reads each piece's live position/rotation/scale
//
// So a cloud that has been bobbing since load gets that mid-air pose baked into IndexedDB
// the moment anybody touches it with the gizmo -- and again on the next refresh, and
// again, so it walks away across sessions. A record's transform is the only truth there
// is, and there is no migration for a world that has already drifted.
//
// Some motion genuinely has to move the root, though: a bob, a drift, a spin, a camera
// ride. Wrapping the whole app in "never touch the root" would rule out most of the point.
// So the contract is the other half of it instead:
//
//   ANYTHING THAT MOVES A REGISTERED ROOT DECLARES A REST POSE FIRST, AND EVERY PLACE
//   THAT PERSISTS A TRANSFORM READS THE REST POSE RATHER THAN THE LIVE ONE.
//
// The rest pose lives on `object3D.userData.restPose` -- on the object rather than in a
// side table, so it cannot be orphaned by a removal path that forgot to clean up, and so
// `disposeObject3D` needs to know nothing about it.
//
// It is deliberately NOT persisted. It is only ever a memory of where a live object was
// standing before something started animating it; the record already holds the durable
// answer, and writing a second copy of the same fact into the world file is how the two
// get to disagree.

function snapshot(object3D) {
  return {
    position: object3D.position.toArray(),
    rotation: [object3D.rotation.x, object3D.rotation.y, object3D.rotation.z],
    scale: object3D.scale.toArray(),
  };
}

// Call before the first frame of any motion that writes the root's position, rotation or
// scale. Idempotent: a second caller joins the motion already in progress rather than
// capturing a rest pose that is itself mid-animation, which is the whole failure this
// exists to prevent (a bob and a pop on the same object, the second one "resting" four
// feet in the air).
export function beginRootMotion(object3D) {
  if (!object3D) return null;
  if (!object3D.userData.restPose) object3D.userData.restPose = snapshot(object3D);
  object3D.userData.rootMotionDepth = (object3D.userData.rootMotionDepth || 0) + 1;
  return object3D.userData.restPose;
}

// Call when a motion finishes. The LAST holder puts the object back where it was and
// drops the rest pose, so a finished animation leaves no trace and the live transform is
// authoritative again. Earlier holders simply decrement -- a spring that ends while a
// forever-bob is still running must not yank the object back to rest.
export function endRootMotion(object3D, { restore = true } = {}) {
  if (!object3D?.userData?.restPose) return;
  object3D.userData.rootMotionDepth = Math.max(0, (object3D.userData.rootMotionDepth || 1) - 1);
  if (object3D.userData.rootMotionDepth > 0) return;
  const rest = object3D.userData.restPose;
  if (restore) {
    object3D.position.fromArray(rest.position);
    object3D.rotation.set(rest.rotation[0], rest.rotation[1], rest.rotation[2]);
    object3D.scale.fromArray(rest.scale);
  }
  delete object3D.userData.restPose;
  delete object3D.userData.rootMotionDepth;
}

export function hasRootMotion(object3D) {
  return Boolean(object3D?.userData?.restPose);
}

// THE ONE FUNCTION EVERY PERSIST PATH CALLS. Returns where this object really lives --
// its rest pose while something is animating it, its live transform otherwise -- in
// exactly the { position, rotation, scale } shape a record's transform already uses.
export function restTransform(object3D) {
  const rest = object3D?.userData?.restPose;
  if (rest) {
    return {
      position: [...rest.position],
      rotation: [...rest.rotation],
      scale: [...rest.scale],
    };
  }
  return snapshot(object3D);
}

// A legitimate edit landed while a motion was running -- the student dragged the object
// with the gizmo, or a program moved it for real. The rest pose is now stale, so the
// caller re-bases it: the motion keeps running, and it keeps running from HERE.
//
// Takes an explicit transform rather than reading the live one, because the caller is
// usually mid-write and the live object is a frame of animation away from the truth.
export function rebaseRestPose(object3D, transform) {
  if (!object3D?.userData?.restPose) return;
  object3D.userData.restPose = {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale],
  };
}

// Applies a rest pose back onto an object without ending the motion -- what a spring
// calls each frame before adding its own offset, so two animations on one object compose
// against a fixed origin instead of each other's output. Without this, a bob and a spin
// integrate one another and the object walks.
export function resetToRest(object3D) {
  const rest = object3D?.userData?.restPose;
  if (!rest) return false;
  object3D.position.fromArray(rest.position);
  object3D.rotation.set(rest.rotation[0], rest.rotation[1], rest.rotation[2]);
  object3D.scale.fromArray(rest.scale);
  return true;
}
