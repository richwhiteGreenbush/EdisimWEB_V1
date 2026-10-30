import * as THREE from 'three';
import { EASE } from './Motion.js';

// Named for children rather than for animators: "smoothly" and "bouncy" are words a
// nine-year-old picks out of a list. `straight` is the original linear behaviour and is
// what every block saved before this existed still gets.
const GLIDE_EASES = {
  straight: EASE.linear,
  smooth: EASE.smooth,
  bouncy: EASE.outBack,
};
import { applyColorTint } from './ColorTint.js';
import { applyOpacity } from './Opacity.js';
import { isVariableRef } from './BlockDefs.js';

// Reads a block's numeric param. A plain number is returned as it always was, and a param that
// names a variable is looked up on the object first and among shared values second. `read` can
// return NaN for a missing param, exactly as Number() does, because setSize and setOpacity were
// written against that; `val` is the `Number(x) || 0` nearly every other block has always used.
function read(raw, ctx) {
  if (!isVariableRef(raw)) return Number(raw);
  const name = raw.trim();
  if (ctx.vars?.has(name)) return ctx.vars.get(name);
  if (ctx.worldVars?.has(name)) return ctx.worldVars.get(name);
  ctx.onUnknownVariable?.(name);
  return 0;
}

function val(raw, ctx) {
  return read(raw, ctx) || 0;
}

// Every result is checked here, because NaN or Infinity written into a position does not fail:
// the object's matrix goes bad and it silently vanishes. A student who divides by zero gets a
// message and a zero rather than a missing object.
function setResult(name, value, ctx) {
  if (!name || !ctx.vars) return;
  if (Number.isFinite(value)) {
    ctx.vars.set(name, value);
  } else {
    ctx.vars.set(name, 0);
    ctx.onMathProblem?.(name);
  }
}

const RAD = Math.PI / 180;

const MATH_OPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': (a, b) => a ** b,
  min: (a, b) => Math.min(a, b),
  max: (a, b) => Math.max(a, b),
  mod: (a, b) => a % b,
};

const MATH_FNS = {
  sqrt: (a) => Math.sqrt(a),
  square: (a) => a * a,
  abs: (a) => Math.abs(a),
  round: (a) => Math.round(a),
  sin: (a) => Math.sin(a * RAD),
  cos: (a) => Math.cos(a * RAD),
  tan: (a) => Math.tan(a * RAD),
  asin: (a) => Math.asin(a) / RAD,
  acos: (a) => Math.acos(a) / RAD,
  atan: (a) => Math.atan(a) / RAD,
};

function compare(block, ctx) {
  const a = val(block.params.a, ctx);
  const b = val(block.params.b, ctx);
  switch (block.params.op) {
    case '<': return a < b;
    case '<=': return a <= b;
    // Tolerant, or `if t = 2` is never true for a clock counting up in steps of 0.02.
    case '=': return Math.abs(a - b) < 1e-9;
    case '>=': return a >= b;
    case '>': return a > b;
    default: return false;
  }
}

// A value inside a sentence. Whole numbers stay whole, because "Month 3.00" is nobody's month.
export function formatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// `say` text can carry values: "Month {month}: you owe ${debt}". A {word} that is not a variable
// here is left exactly as written, so every `say` saved before variables existed is unchanged.
function fillText(text, ctx) {
  return text.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name) => {
    if (ctx.vars?.has(name)) return formatValue(ctx.vars.get(name));
    if (ctx.worldVars?.has(name)) return formatValue(ctx.worldVars.get(name));
    return whole;
  });
}

// One pass of a loop body. Math blocks take no frame, so a pass can finish without yielding at
// all, and a loop of those would spin here and hang the tab. So passes that yielded nothing are
// counted, and every SPIN_LIMIT of them the loop hands the frame back. The count is what lets
// `repeat 20 { add up a number }` finish inside one frame while `repeat until` on a condition
// that never comes true still cannot lock up the page.
const SPIN_LIMIT = 2000;
function* runPass(blocks, ctx) {
  let yielded = false;
  for (const step of runBlocks(blocks, ctx)) {
    yielded = true;
    yield step;
  }
  if (yielded) {
    ctx.spins = 0;
  } else {
    ctx.spins = (ctx.spins || 0) + 1;
    if (ctx.spins >= SPIN_LIMIT) {
      ctx.spins = 0;
      yield { type: 'tick' };
    }
  }
}

// The object's own forward direction in world space.
//
// getWorldDirection() returns the object's positive Z axis, and +Z is the forward every
// prop in this project is authored to face -- the same fact browserStation() and the
// layouts' facing() helper rely on. (A Camera is the exception: it looks down its own -Z.
// Nothing programmable here is a camera, so this stays simple.)
const FORWARD = new THREE.Vector3();
// Exported for JsProgram.js, which needs the identical definition of "forward" -- one
// shared vector, so callers that keep the result must clone() it, as glide does.
export function forwardOf(object3D) {
  object3D.updateMatrixWorld();
  return object3D.getWorldDirection(FORWARD);
}

function* runBlock(block, ctx) {
  switch (block.type) {
    case 'wait':
      yield { type: 'wait', seconds: val(block.params.seconds, ctx) };
      return;

    case 'repeat': {
      const count = Math.max(0, Math.floor(val(block.params.count, ctx)));
      for (let i = 0; i < count; i++) {
        yield* runPass(block.children || [], ctx);
      }
      return;
    }

    case 'repeatUntil':
      while (!compare(block, ctx)) {
        yield* runPass(block.children || [], ctx);
      }
      return;

    case 'ifCompare':
      if (compare(block, ctx)) yield* runBlocks(block.children || [], ctx);
      return;

    case 'setVar':
      setResult(block.params.name, val(block.params.value, ctx), ctx);
      return;

    case 'changeVar': {
      const name = block.params.name;
      const now = ctx.vars?.get(name) ?? ctx.worldVars?.get(name) ?? 0;
      setResult(name, now + val(block.params.value, ctx), ctx);
      return;
    }

    case 'calc': {
      const op = MATH_OPS[block.params.op] || MATH_OPS['+'];
      setResult(block.params.name, op(val(block.params.a, ctx), val(block.params.b, ctx)), ctx);
      return;
    }

    case 'mathFn': {
      const fn = MATH_FNS[block.params.fn] || MATH_FNS.sqrt;
      setResult(block.params.name, fn(val(block.params.a, ctx)), ctx);
      return;
    }

    case 'randomVar': {
      const a = val(block.params.a, ctx);
      const b = val(block.params.b, ctx);
      setResult(block.params.name, a + Math.random() * (b - a), ctx);
      return;
    }

    case 'shareVar': {
      const name = block.params.name;
      if (name && ctx.vars?.has(name)) ctx.worldVars?.set(name, ctx.vars.get(name));
      return;
    }

    case 'sayValue': {
      const label = String(block.params.label ?? '').trim();
      const unit = String(block.params.unit ?? '').trim();
      const value = val(block.params.value, ctx).toFixed(2);
      // No space after a dollar sign, or before a unit that is punctuation.
      const head = label ? (label.endsWith('$') ? label : `${label} `) : '';
      const tail = unit ? (/^[%.,;:!?)]/.test(unit) ? unit : ` ${unit}`) : '';
      ctx.say?.(`${head}${value}${tail}`);
      yield { type: 'tick' };
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
      ctx.object3D.position.addScaledVector(forwardOf(ctx.object3D), val(block.params.feet, ctx));
      yield { type: 'tick' };
      return;

    case 'moveBoth':
      ctx.object3D.position.addScaledVector(forwardOf(ctx.object3D), val(block.params.forward, ctx));
      ctx.object3D.position.y += val(block.params.up, ctx);
      yield { type: 'tick' };
      return;

    case 'setTilt':
      ctx.object3D.rotation.z = THREE.MathUtils.degToRad(val(block.params.degrees, ctx));
      yield { type: 'tick' };
      return;

    case 'moveUp':
      // World Y, not the object's own up. See the note in BlockDefs.js: a lift that
      // tilted with its object would be surprising and useless for the jobs this exists
      // for. Negative goes down.
      ctx.object3D.position.y += val(block.params.feet, ctx);
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
      const feet = val(block.params.feet, ctx);
      const seconds = Math.max(0.05, val(block.params.seconds, ctx));
      const from = ctx.object3D.position.clone();
      const delta = forwardOf(ctx.object3D).clone().multiplyScalar(feet);
      const started = performance.now();
      // `?? 'straight'` and not the schema default: a block saved before `ease` existed
      // has no such key, and every one of those has to keep moving exactly as it always
      // has. New blocks get 'smooth' from createBlockInstance instead.
      const shape = GLIDE_EASES[block.params.ease ?? 'straight'] || GLIDE_EASES.straight;
      for (;;) {
        const t = Math.min(1, (performance.now() - started) / (seconds * 1000));
        ctx.object3D.position.copy(from).addScaledVector(delta, shape(t));
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
      ctx.object3D.rotation.y += THREE.MathUtils.degToRad(val(block.params.degrees, ctx));
      yield { type: 'tick' };
      return;

    case 'say':
      // Two effects from one block: it shows a bubble, and it broadcasts. The broadcast is
      // what `when an object says` listens for, and routing both through one callback
      // keeps this module a pure interpreter with no idea that either exists.
      ctx.say?.(fillText(String(block.params.text ?? ''), ctx));
      yield { type: 'tick' };
      return;

    case 'changeSize': {
      // "by" (not "to") -- multiplicative on the current size, matching Scratch's own
      // "change size by N%" semantics.
      const factor = 1 + val(block.params.percent, ctx) / 100;
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
      const percent = read(block.params.percent, ctx);
      if (Number.isFinite(percent) && percent > 0 && ctx.home) {
        ctx.object3D.scale.copy(ctx.home.scale).multiplyScalar(percent / 100);
      }
      yield { type: 'tick' };
      return;
    }

    case 'setOpacity':
      applyOpacity(ctx.object3D, read(block.params.percent, ctx));
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
