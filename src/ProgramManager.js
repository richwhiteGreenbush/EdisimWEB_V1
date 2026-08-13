import { runProgram } from './ProgramRunner.js';

// Tracks one active generator per placed object with a program, and steps each one
// once per frame (or holds it if it's mid-`wait`). Kept separate from PlacedRegistry
// because that's about render/dispose bookkeeping, not program execution.
export class ProgramManager {
  constructor() {
    this.runners = new Map(); // placedId -> { generator, waitUntil }
    // Set from main.js once the registry and world store exist. This manager is
    // constructed before both of them (PlacedRegistry takes it as a constructor
    // argument), so the "duplicate" block's effect has to be handed over afterwards
    // rather than injected here -- it is only ever called from a running program, long
    // past boot.
    this.onDuplicate = null;
  }

  start(id, program, object3D) {
    this.stop(id);
    if (!program || !program.length) return;

    // Each copy is placed one offset FURTHER out than the last, counted per run.
    //
    // Without this, `repeat 3 { duplicate 4 ft }` puts all three copies at the same
    // point 4ft away -- the object never moved between them, so every copy measured
    // from the same origin. A student sees one object and reasonably concludes the
    // block is broken. Stepping the offset turns the same program into a neat row of
    // three, which is what "duplicate three times" is expected to look like.
    let copies = 0;
    const effects = { duplicate: (offset) => this.onDuplicate?.(id, offset * ++copies) };

    this.runners.set(id, { generator: runProgram(program, object3D, effects), waitUntil: 0 });
  }

  stop(id) {
    this.runners.delete(id);
  }

  isRunning(id) {
    return this.runners.has(id);
  }

  tick() {
    if (!this.runners.size) return;
    const now = performance.now();
    for (const [id, runner] of this.runners) {
      if (runner.waitUntil > now) continue;

      let result;
      try {
        result = runner.generator.next();
      } catch (err) {
        console.error(`Program for object ${id} raised an error and was stopped:`, err);
        this.runners.delete(id);
        continue;
      }

      if (result.done) {
        this.runners.delete(id);
        continue;
      }

      if (result.value?.type === 'wait') {
        runner.waitUntil = now + Math.max(0, result.value.seconds) * 1000;
      }
    }
  }
}
