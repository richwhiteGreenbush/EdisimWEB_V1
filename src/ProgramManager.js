import { runProgram, runBranch } from './ProgramRunner.js';

// Tracks the active generators for placed objects with programs, and steps each one once
// per frame (or holds it if it's mid-`wait`). Kept separate from PlacedRegistry because
// that's about render/dispose bookkeeping, not program execution.
//
// **One object can now have SEVERAL scripts running at once**, which is the structural
// change `when an object says` forced. Before it, a program was one stack with one
// generator, so a Map keyed by placed id was enough. A hat block is a second entry point:
// an object can be walking its main program and, at the same time, react to something
// another object said. So runners are keyed by their own token and carry the object id,
// and stop(id) sweeps every runner belonging to that object.
export class ProgramManager {
  constructor() {
    this.runners = new Map(); // runnerKey -> { id, generator, waitUntil }
    this.programs = new Map(); // placedId -> { program, object3D, home }
    this.nextKey = 1;
    this.activeHats = new Set(); // hats currently mid-run, so a message cannot re-enter one

    // Set from main.js once the registry and world store exist. This manager is
    // constructed before both of them (PlacedRegistry takes it as a constructor
    // argument), so these effects are handed over afterwards rather than injected here --
    // they are only ever called from a running program, long past boot.
    this.onDuplicate = null;
    this.onSay = null;
  }

  // The transform to send `go back to start` and `set size to` back to.
  //
  // Captured when the program is STARTED, not when the object was placed. That is the
  // meaning a student expects from "start" -- press play, watch it wander, press play
  // again and it begins from where it now is -- and it is also the only definition that
  // survives an object having been dragged, rendered from primitives or duplicated, none
  // of which write back to the record.
  captureHome(object3D) {
    return {
      position: object3D.position.clone(),
      quaternion: object3D.quaternion.clone(),
      scale: object3D.scale.clone(),
    };
  }

  effectsFor(id, object3D, home) {
    // Each copy is placed one offset FURTHER out than the last, counted per run.
    //
    // Without this, `repeat 3 { duplicate 4 ft }` puts all three copies at the same point
    // 4ft away -- the object never moved between them, so every copy measured from the
    // same origin. A student sees one object and reasonably concludes the block is
    // broken. Stepping the offset turns the same program into a neat row of three.
    let copies = 0;
    return {
      home,
      duplicate: (offset) => this.onDuplicate?.(id, offset * ++copies),
      say: (text) => {
        this.onSay?.(id, object3D, text);
        this.broadcast(text, id);
      },
      // The marker. `this.marker` is assigned by main.js after construction, exactly as
      // `onDuplicate` is and for the same reason: ProgramManager is built at the top of
      // main.js, before the scene the marker draws into exists. Safe, because nothing here
      // runs until a program is actually playing.
      markerColor: (hex) => this.marker?.setColor(id, hex, object3D),
      markerDown: () => this.marker?.down(id, object3D),
      markerUp: () => this.marker?.up(id),
      eraseMarks: () => this.marker?.eraseAll(),
    };
  }

  start(id, program, object3D) {
    this.stop(id);
    if (!program || !program.length) return;

    const home = this.captureHome(object3D);
    this.programs.set(id, { program, object3D, home });

    // Top-level hats are registered, not run. If the program is nothing BUT hats there is
    // no main runner at all -- which is correct: an object whose only script is "when an
    // object says X" should sit still until somebody says X.
    const main = program.filter((block) => block.type !== 'whenSaid');
    if (main.length) {
      this.spawn(id, runProgram(main, object3D, this.effectsFor(id, object3D, home)));
    }
  }

  spawn(id, generator) {
    this.runners.set(`${id}#${this.nextKey++}`, { id, generator, waitUntil: 0 });
  }

  // Every object that owns a matching hat starts a fresh run of that hat's children.
  //
  // `from` is the object that spoke and it is NOT excluded, deliberately: an object
  // answering its own message is a legitimate (and useful) thing to build, and excluding
  // it would be a silent special case a student could not see. What IS guarded is the
  // obvious runaway -- a hat whose body says the very text that triggered it -- which is
  // caught by refusing to re-enter a hat that is already running on the same object.
  broadcast(text, from) {
    const key = String(text ?? '').trim().toLowerCase();
    if (!key) return;

    for (const [id, entry] of this.programs) {
      for (const block of entry.program) {
        if (block.type !== 'whenSaid') continue;
        if (String(block.params?.text ?? '').trim().toLowerCase() !== key) continue;
        if (!block.children?.length) continue;

        const hatKey = `${id}@${block.id}`;
        if (this.activeHats.has(hatKey)) continue;
        this.activeHats.add(hatKey);

        const generator = runBranch(
          block.children,
          entry.object3D,
          this.effectsFor(id, entry.object3D, entry.home),
        );
        const runnerKey = `${id}#${this.nextKey++}`;
        this.runners.set(runnerKey, { id, generator, waitUntil: 0, hatKey });
      }
    }
    void from;
  }

  stop(id) {
    for (const [key, runner] of [...this.runners]) {
      if (runner.id !== id) continue;
      if (runner.hatKey) this.activeHats.delete(runner.hatKey);
      this.runners.delete(key);
    }
    this.programs.delete(id);
  }

  isRunning(id) {
    for (const runner of this.runners.values()) if (runner.id === id) return true;
    return false;
  }

  tick() {
    if (!this.runners.size) return;
    const now = performance.now();
    for (const [key, runner] of [...this.runners]) {
      if (runner.waitUntil > now) continue;

      let result;
      try {
        result = runner.generator.next();
      } catch (err) {
        console.error(`Program for object ${runner.id} raised an error and was stopped:`, err);
        if (runner.hatKey) this.activeHats.delete(runner.hatKey);
        this.runners.delete(key);
        continue;
      }

      if (result.done) {
        if (runner.hatKey) this.activeHats.delete(runner.hatKey);
        this.runners.delete(key);
        continue;
      }

      if (result.value?.type === 'wait') {
        runner.waitUntil = now + Math.max(0, result.value.seconds) * 1000;
      }
    }
  }
}
