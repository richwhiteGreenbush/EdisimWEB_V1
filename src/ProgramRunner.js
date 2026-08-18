import * as THREE from 'three';
import { applyColorTint } from './ColorTint.js';
import { applyOpacity } from './Opacity.js';

// The object's own forward direction in world space.
//
// getWorldDirection() returns the object's positive Z axis, and +Z is the forward every
// prop in this project is authored to face -- the same fact browserStation() and the
// layouts' facing() helper rely on. (A Camera is the exception: it looks down its own -Z.
// Nothing programmable here is a camera, so this stays simple.)
const FORWARD = new THREE.Vector3();
function forwardOf(object3D) {
  object3D.updateMatrixWorld();
  return object3D.getWorldDirection(FORWARD);
}

function* runBlock(block, ctx) {
  switch (block.type) {
    case 'wait':
      yield { type: 'wait', seconds: Number(block.params.seconds) || 0 };
      return;

    case 'repeat': {
      const count = Math.max(0, Math.floor(Number(block.params.count) || 0));
      for (let i = 0; i < count; i++) {
        yield* runBlocks(block.children || [], ctx);
      }
      return;
    }

    case 'forever':
      // Unconditionally yields once per pass, even if the children yielded nothing
      // themselves (e.g. an empty body, or a nested "repeat 0 times") -- otherwise a
      // pass that never yields spins this while(true) synchronously and hangs the tab.
      while (true) {
        yield* runBlocks(block.children || [], ctx);
        yield { type: 'tick' };
      }
      return; // unreachable, but keeps this case visually self-contained

    // A HAT. Its children are started by ProgramManager when a matching `say` goes out,
    // never by falling into it from the top of the program -- so running it does nothing.
    // Skipping rather than throwing means a hat left anywhere in a stack is harmless.
    case 'whenSaid':
      return;

    case 'moveForward':
      ctx.object3D.position.addScaledVector(forwardOf(ctx.object3D), Number(block.params.feet) || 0);
      yield { type: 'tick' };
      return;

    case 'moveUp':
      // World Y, not the object's own up. See the note in BlockDefs.js: a lift that
      // tilted with its object would be surprising and useless for the jobs this exists
      // for. Negative goes down.
      ctx.object3D.position.y += Number(block.params.feet) || 0;
      yield { type: 'tick' };
      return;

    case 'glide': {
      // The one block that spans time rather than happening at an instant. It works
      // because this is a generator stepped once per frame: the loop below advances the
      // object a fraction of the way and hands control back, so a 2-second glide is about
      // 120 yields rather than one jump.
      //
      // Interpolated from the REAL clock, not from a frame count. Frame rate is not
      // something a school Chromebook holds steady, and counting frames would make the
      // same program take twice as long on a slow machine.
      const feet = Number(block.params.feet) || 0;
      const seconds = Math.max(0.05, Number(block.params.seconds) || 0);
      const from = ctx.object3D.position.clone();
      const delta = forwardOf(ctx.object3D).clone().multiplyScalar(feet);
      const started = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
        ctx.object3D.position.copy(from).addScaledVector(delta, t);
        yield { type: 'tick' };
        if (t >= 1) break;
      }
      return;
    }

    case 'goHome':
      // `home` is the transform captured when the program was started, handed in by
      // ProgramManager. Optional, like `duplicate`: with nothing wired up this is a no-op
      // rather than an exception that kills the run.
      if (ctx.home) {
        ctx.object3D.position.copy(ctx.home.position);
        ctx.object3D.quaternion.copy(ctx.home.quaternion);
        ctx.object3D.scale.copy(ctx.home.scale);
      }
      yield { type: 'tick' };
      return;

    case 'rotate':
      ctx.object3D.rotation.y += THREE.MathUtils.degToRad(Number(block.params.degrees) || 0);
      yield { type: 'tick' };
      return;

    case 'say':
      // Two effects from one block: it shows a bubble, and it broadcasts. The broadcast is
      // what `when an object says` listens for, and routing both through one callback
      // keeps this module a pure interpreter with no idea that either exists.
      ctx.say?.(String(block.params.text ?? ''));
      yield { type: 'tick' };
      return;

    case 'changeSize': {
      // "by" (not "to") -- multiplicative on the current size, matching Scratch's own
      // "change size by N%" semantics.
      const factor = 1 + (Number(block.params.percent) || 0) / 100;
      if (factor > 0) ctx.object3D.scale.multiplyScalar(factor);
      yield { type: 'tick' };
      return;
    }

    case 'setSize': {
      // Absolute, and measured against the size the object was when its program STARTED,
      // not against its size right now. Against current size this would be identical to
      // `change size by`, and `set size to 50%` in a forever loop would halve the object
      // every frame until it disappeared -- which is precisely the confusion having both
      // blocks is meant to clear up.
      const percent = Number(block.params.percent);
      if (Number.isFinite(percent) && percent > 0 && ctx.home) {
        ctx.object3D.scale.copy(ctx.home.scale).multiplyScalar(percent / 100);
      }
      yield { type: 'tick' };
      return;
    }

    case 'setOpacity':
      applyOpacity(ctx.object3D, Number(block.params.percent));
      yield { type: 'tick' };
      return;

    case 'changeColor':
      applyColorTint(ctx.object3D, block.params.color || '#ffffff');
      yield { type: 'tick' };
      return;

    // The four marker blocks. Every one of them is a callback rather than something this
    // module does itself, for the same reason `say` and `duplicate` are: the runner stays
    // a pure interpreter that knows nothing about the scene it is driving.
    case 'markerColor':
      ctx.markerColor?.(block.params.color || '#3d8bf2');
      yield { type: 'tick' };
      return;

    case 'markerDown':
      ctx.markerDown?.();
      yield { type: 'tick' };
      return;

    case 'markerUp':
      ctx.markerUp?.();
      yield { type: 'tick' };
      return;

    case 'eraseMarks':
      ctx.eraseMarks?.();
      yield { type: 'tick' };
      return;

    // --- Retired, still runnable --------------------------------------------
    // Off the palette but kept here, because a block type is persisted inside every saved
    // program: deleting these cases would turn somebody's working world into a silent
    // no-op. See the note in BlockDefs.js.
    case 'moveX':
      ctx.object3D.position.x += Number(block.params.feet) || 0;
      yield { type: 'tick' };
      return;

    case 'moveY':
      ctx.object3D.position.y += Number(block.params.feet) || 0;
      yield { type: 'tick' };
      return;

    case 'moveZ':
      ctx.object3D.position.z += Number(block.params.feet) || 0;
      yield { type: 'tick' };
      return;

    case 'duplicate':
      // ctx.duplicate is wired up by ProgramManager. It is optional so that this
      // runner stays usable (and testable) with nothing but an object3D, the way
      // every other block here is -- an unwired duplicate is simply a no-op rather
      // than an exception that kills the whole program mid-run.
      ctx.duplicate?.(Number(block.params.offset) || 0);
      yield { type: 'tick' };
      return;

    default:
      return;
  }
}

function* runBlocks(blocks, ctx) {
  for (const block of blocks) {
    yield* runBlock(block, ctx);
  }
}

// Runs a saved program against a live object3D. Generator-based so ProgramManager can
// step it a little at a time (once per animation frame) instead of running it to
// completion synchronously -- required for `forever` to not hang the tab, and it also
// paces movement blocks inside loops to a smooth ~1-step-per-frame cadence.
//
// `effects` carries anything a block needs that is not the object itself -- `duplicate`
// and `say`, which have to reach the registry, the world store and the other objects'
// programs, plus `home`, the transform to return to. Kept as injected values rather than
// imports so this module stays a pure interpreter over one Object3D, with no knowledge of
// how the rest of the app is wired together.
export function runProgram(blocks, object3D, effects = {}) {
  return runBlocks(blocks, { object3D, ...effects });
}

// Runs ONE hat's children -- what ProgramManager spawns when a message arrives.
export function runBranch(blocks, object3D, effects = {}) {
  return runBlocks(blocks, { object3D, ...effects });
}
