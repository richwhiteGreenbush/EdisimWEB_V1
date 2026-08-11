import * as THREE from 'three';
import { applyColorTint } from './ColorTint.js';

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

    case 'rotate':
      ctx.object3D.rotation.y += THREE.MathUtils.degToRad(Number(block.params.degrees) || 0);
      yield { type: 'tick' };
      return;

    case 'changeSize': {
      // "by" (not "to") -- multiplicative on the current size, matching Scratch's own
      // "change size by N%" semantics rather than the object menu's absolute "resize to N%".
      const factor = 1 + (Number(block.params.percent) || 0) / 100;
      if (factor > 0) ctx.object3D.scale.multiplyScalar(factor);
      yield { type: 'tick' };
      return;
    }

    case 'changeColor':
      applyColorTint(ctx.object3D, block.params.color || '#ffffff');
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
export function runProgram(blocks, object3D) {
  return runBlocks(blocks, { object3D });
}
