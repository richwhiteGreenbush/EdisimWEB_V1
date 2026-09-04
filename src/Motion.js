import * as THREE from 'three';
import { beginRootMotion, endRootMotion, resetToRest } from './RootMotion.js';
import { reducedMotion } from './Settings.js';

// ONE spring, one array, one tick.
//
// Half a dozen things in this app are each secretly "add an ease": a glide that lands, a
// piece that pops into existence, the gizmo's handles swelling under a thumb, the detent
// kick, a world that arrives instead of cutting. Written separately you get six easing
// curves that disagree with one another, six places that forget the persistence guard in
// RootMotion.js, and no single place to put the reduced-motion switch. Written once you
// get this file.
//
// Everything here is zero draw calls: it only ever writes transforms that already exist.

export const EASE = {
  linear: (t) => t,
  // The one glide wants. Zero slope at both ends, so a thing arrives and settles.
  smooth: (t) => t * t * (3 - 2 * t),
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  // Overshoots and comes back -- what makes a placed object read as having ARRIVED
  // rather than having been switched on.
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// Nothing one-shot runs longer than this, whatever it asks for. A time box is not
// politeness: an animation that outlives its own guard is an animation that is still
// holding a root motion when the student reaches for the gizmo, and RootMotion's whole
// job is to make that case impossible rather than merely unlikely.
const MAX_ONE_SHOT_MS = 1200;

export class Motion {
  constructor({ registry, programManager, buildGizmo } = {}) {
    this.registry = registry;
    this.programManager = programManager;
    this.buildGizmo = buildGizmo;
    this.runs = [];
  }

  // Injected after construction, for main.js's usual reason: this is built before the
  // gizmo exists, and nothing calls it until a frame has been drawn.
  attach({ registry, programManager, buildGizmo }) {
    if (registry) this.registry = registry;
    if (programManager) this.programManager = programManager;
    if (buildGizmo) this.buildGizmo = buildGizmo;
  }

  // Is somebody else already the authority on this object's transform this frame?
  //
  // A running program is: it is writing position and scale itself, and a spring fighting
  // it produces a stutter that reads as a bug in the program the student just wrote. The
  // gizmo is, more obviously: the object is literally under their thumb.
  //
  // programManager.isRunning(id) has existed since programs shipped and was called by
  // NOTHING in src/ -- it was written for exactly this.
  owned(object3D) {
    const id = object3D?.userData?.placedId;
    if (!id) return false;
    if (this.buildGizmo?.activeId === id) return true;
    if (this.programManager?.isRunning?.(id)) return true;
    return false;
  }

  // Run a one-shot animation over `duration` ms.
  //
  // `apply(eased, object3D, rest)` does the writing. The caller supplies it rather than
  // this file offering a fixed vocabulary of properties, because the interesting
  // animations here are combinations -- a pop is scale AND overshoot, a landing is
  // position AND squash -- and a property-per-key API turns each of those into three runs
  // that have to stay in step.
  //
  // `rest` is the pose the object had before the animation started, so `apply` can always
  // work from a fixed origin instead of integrating its own output.
  play(object3D, { duration = 320, ease = EASE.outQuad, apply, onDone, force = false } = {}) {
    if (!object3D || typeof apply !== 'function') return null;
    if (!force && this.owned(object3D)) return null;

    this.cancel(object3D);

    const rest = beginRootMotion(object3D);
    const run = {
      object3D,
      rest,
      apply,
      onDone,
      ease,
      elapsed: 0,
      duration: Math.max(1, Math.min(duration, MAX_ONE_SHOT_MS)),
    };

    // Reduced motion still ARRIVES -- it just arrives now. Running the final frame and
    // ending immediately means every caller gets the same end state with no branch of
    // its own, which is what stops "reduced motion" quietly meaning "broken".
    if (reducedMotion()) {
      apply(1, object3D, rest);
      endRootMotion(object3D, { restore: false });
      onDone?.();
      return null;
    }

    this.runs.push(run);
    return run;
  }

  cancel(object3D, { restore = false } = {}) {
    const i = this.runs.findIndex((r) => r.object3D === object3D);
    if (i === -1) return;
    const [run] = this.runs.splice(i, 1);
    // Land on the finished state rather than wherever the animation happened to be, or a
    // cancelled pop leaves an object at 40% scale forever.
    if (!restore) run.apply(1, run.object3D, run.rest);
    endRootMotion(run.object3D, { restore });
  }

  tick(dt) {
    if (!this.runs.length) return;
    const ms = dt * 1000;
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const run = this.runs[i];
      // The student grabbed it mid-animation, or pressed play on it. Hand it over: land
      // on the end state and get out of the way.
      if (this.owned(run.object3D)) {
        this.runs.splice(i, 1);
        run.apply(1, run.object3D, run.rest);
        endRootMotion(run.object3D, { restore: false });
        run.onDone?.();
        continue;
      }
      run.elapsed += ms;
      const t = Math.min(1, run.elapsed / run.duration);
      run.apply(run.ease(t), run.object3D, run.rest);
      if (t >= 1) {
        this.runs.splice(i, 1);
        // restore:false -- the animation's own final frame IS the intended pose. A birth
        // pop ends at the object's real scale; restoring would also be correct there and
        // wrong for anything that legitimately ends somewhere new.
        endRootMotion(run.object3D, { restore: false });
        run.onDone?.();
      }
    }
  }

  clear() {
    for (const run of [...this.runs]) this.cancel(run.object3D);
    this.runs.length = 0;
  }
}

// --- Motion stickers ------------------------------------------------------------
//
// The other half of this file, and the one a student actually touches: six named
// motions, one tap each, that any object in any world can wear immediately.
//
// A sticker is PERSISTED as `record.motion = { kind, speed }` -- an added field on a
// record, read with `?.`, which is the same discipline programJsAuto and targetHeight
// already follow, so every world file that predates this simply has no such key.
//
// It is deliberately not a program. A program is a thing a student writes and reads; a
// sticker is a property of an object, it survives being duplicated, it costs no blocks,
// and it is the on-ramp for a child who is not going to open the block editor on their
// first afternoon.

export const STICKERS = [
  {
    kind: 'bob', label: 'Bob', hint: 'Floats gently up and down.',
    apply: (o, rest, phase) => {
      o.position.y = rest.position[1] + Math.sin(phase) * 0.5;
    },
  },
  {
    kind: 'spin', label: 'Spin', hint: 'Turns on the spot, forever.',
    // Continuous rather than a sine: a spin that eased back and forth is a sway.
    apply: (o, rest, phase) => {
      o.rotation.y = rest.rotation[1] + phase * 0.5;
    },
  },
  {
    kind: 'sway', label: 'Sway', hint: 'Leans one way and then the other, like a tree.',
    apply: (o, rest, phase) => {
      o.rotation.z = rest.rotation[2] + Math.sin(phase) * 0.09;
      o.rotation.x = rest.rotation[0] + Math.cos(phase * 0.77) * 0.045;
    },
  },
  {
    kind: 'breathe', label: 'Breathe', hint: 'Swells and shrinks, like something alive.',
    apply: (o, rest, phase) => {
      // Anisotropic on purpose: an even pulse reads as a zoom, and a body that breathes
      // gets taller and narrower rather than uniformly bigger.
      const k = Math.sin(phase) * 0.045;
      o.scale.set(rest.scale[0] * (1 - k * 0.5), rest.scale[1] * (1 + k), rest.scale[2] * (1 - k * 0.5));
    },
  },
  {
    kind: 'wobble', label: 'Wobble', hint: 'Jiggles about, never quite still.',
    apply: (o, rest, phase) => {
      // Three frequencies sharing no common factor, so it never visibly repeats -- the
      // same argument the Liberty drapery's fold families make.
      o.position.x = rest.position[0] + Math.sin(phase * 1.7) * 0.16;
      o.position.z = rest.position[2] + Math.sin(phase * 2.3 + 1.1) * 0.16;
      o.rotation.y = rest.rotation[1] + Math.sin(phase * 1.3) * 0.07;
    },
  },
  {
    kind: 'float', label: 'Float', hint: 'Drifts slowly around, like something in water.',
    apply: (o, rest, phase) => {
      // A lissajous rather than a circle: 1:2 traces a figure of eight, which reads as
      // wandering where a circle reads as a fairground ride.
      o.position.x = rest.position[0] + Math.sin(phase) * 1.6;
      o.position.z = rest.position[2] + Math.sin(phase * 2) * 0.8;
      o.position.y = rest.position[1] + Math.sin(phase * 0.7) * 0.35;
      o.rotation.y = rest.rotation[1] + Math.sin(phase * 0.5) * 0.3;
    },
  },
];

export const STICKER_BY_KIND = new Map(STICKERS.map((s) => [s.kind, s]));

// Builds the { update, dispose } tick a sticker needs, or null if the record has none.
//
// Called from WorldStore.addAndRun, which is the single funnel EVERY rehydration path
// goes through -- so a sticker works on all fifteen record kinds, including a balloon a
// student painted thirty seconds ago and an imported model, with no per-kind code.
export function stickerTickFor(record, object3D) {
  const spec = record?.motion;
  const sticker = spec && STICKER_BY_KIND.get(spec.kind);
  if (!sticker) return null;

  const speed = Number.isFinite(spec.speed) ? spec.speed : 1;
  let phase = 0;
  let holding = false;

  return {
    update(dt) {
      // Checked every frame rather than at construction: a student can turn animation off
      // in the middle of a lesson, and the object has to go back to rest when they do.
      if (reducedMotion()) {
        if (holding) {
          endRootMotion(object3D);
          holding = false;
        }
        return;
      }
      if (!holding) {
        beginRootMotion(object3D);
        holding = true;
      }
      const rest = object3D.userData.restPose;
      if (!rest) return;
      // Reset to rest FIRST, every frame. Two stickers -- or a sticker and a spring --
      // on one object otherwise integrate each other's output and the object walks away
      // across the world.
      resetToRest(object3D);
      phase += dt * speed;
      sticker.apply(object3D, rest, phase);
    },
    dispose() {
      if (holding) endRootMotion(object3D);
      holding = false;
    },
  };
}

// Re-applies a record's motion sticker to a LIVE registry item, so choosing one from the
// object menu takes effect immediately instead of on the next reload.
//
// The base tick is kept separate from the sticker on the item, and that separation is the
// whole reason this is safe: the composed tick's dispose() would otherwise tear down an
// animated GIF's canvas timer as well every time a student tried a different sticker.
export function refreshSticker(item, record, object3D) {
  if (!item) return;
  item.stickerTick?.dispose?.();
  item.stickerTick = stickerTickFor(record, object3D) || null;
  item.tick = composeTicks(item.baseTick, item.stickerTick);
}

// A record's own tick and its sticker both have to run. Composed rather than chosen,
// because a GIF that bobs is a perfectly reasonable thing for a student to make.
export function composeTicks(...ticks) {
  const live = ticks.filter(Boolean);
  if (!live.length) return undefined;
  if (live.length === 1) return live[0];
  return {
    update(dt, camera) {
      for (const t of live) t.update?.(dt, camera);
    },
    dispose() {
      for (const t of live) t.dispose?.();
    },
  };
}

// --- Shared one-shot animations -------------------------------------------------

// The birth pop. Hooked into PlacedRegistry.add(), which is a genuine single funnel and
// does not touch the scene -- so one edit covers every call site and every record kind.
export function popIn(motion, object3D) {
  const target = object3D.scale.clone();
  // A zero start makes a degenerate matrix for one frame, which some drivers dislike and
  // which makes any Box3 taken that frame meaningless.
  const start = 0.01;
  return motion.play(object3D, {
    duration: 340,
    ease: EASE.outBack,
    force: true, // a just-placed object cannot be owned by anything yet
    apply: (t, o) => {
      const k = start + (1 - start) * t;
      o.scale.set(target.x * k, target.y * k, target.z * k);
    },
  });
}

// A piece that lands like it weighs something. Ease IN on the fall -- an ease-out reads
// as a lift descending -- then a squash and a settle.
export function dropIn(motion, object3D, height = 3.2) {
  const rest = object3D.position.y;
  const target = object3D.scale.clone();
  return motion.play(object3D, {
    duration: 620,
    ease: EASE.linear,
    force: true,
    apply: (t, o) => {
      const fall = Math.min(1, t / 0.55);
      const land = Math.max(0, (t - 0.55) / 0.45);
      o.position.y = rest + height * (1 - EASE.inQuad(fall));
      if (t <= 0.55) {
        o.scale.copy(target);
      } else {
        // One squash, decaying. Wide and flat at the moment of contact, round again by
        // the end -- the whole of what makes a landing read as mass.
        const k = Math.sin(land * Math.PI) * (1 - land) * 0.34;
        o.scale.set(target.x * (1 + k), target.y * (1 - k), target.z * (1 + k));
      }
    },
  });
}

// A steady pulse for anything that wants to say "I am running" -- the play icon's
// breathing, a beacon. Not a Motion run: it has no end, so it is a value, not an
// animation. One shared phase so six running robots pulse together rather than
// each on its own clock, which reads as six unrelated glitches.
export function runningPulse(nowMs, amount = 0.12) {
  if (reducedMotion()) return 1;
  return 1 + Math.sin(nowMs / 190) * amount;
}

export { THREE };
