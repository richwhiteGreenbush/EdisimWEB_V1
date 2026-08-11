import { runProgram } from './ProgramRunner.js';

// Tracks one active generator per placed object with a program, and steps each one
// once per frame (or holds it if it's mid-`wait`). Kept separate from PlacedRegistry
// because that's about render/dispose bookkeeping, not program execution.
export class ProgramManager {
  constructor() {
    this.runners = new Map(); // placedId -> { generator, waitUntil }
  }

  start(id, program, object3D) {
    this.stop(id);
    if (!program || !program.length) return;
    this.runners.set(id, { generator: runProgram(program, object3D), waitUntil: 0 });
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
