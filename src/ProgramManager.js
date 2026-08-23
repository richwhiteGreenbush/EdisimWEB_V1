import { runProgram, runBranch } from './ProgramRunner.js';
import { compileJs, buildJsRuntime, JS_RUNTIME_NAMES } from './JsProgram.js';

// Does this record carry anything runnable? The one predicate every "has a program"
// check goes through -- WorldStore.addAndRun, PlayIconManager, ProgramEditor -- so the
// JavaScript mode cannot drift out of one of them. `programMode`, `programJs` and
// `programJsAuto` are PERSISTED fields, exactly like `program`: they ride inside every
// saved record, every exported world file and every copy a student sends a classmate,
// so they are only ever added to, never renamed.
export function recordHasProgram(record) {
  if (!record) return false;
  if (record.programMode === 'js') return !!record.programJs?.trim();
  return !!record.program?.length;
}

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
    // JavaScript runs, keyed like runners. One entry per object in JS mode:
    // { id, pending: [{resolve, at}], hats: [{key, body, running}], ticks, noDuplicate }.
    // `pending` is how the async runtime is paced -- every api action pushes a resolver
    // and tick() below releases the ones whose time has come, once per frame, so a
    // JavaScript program steps at exactly the cadence a block program does.
    this.jsRuns = new Map();
    this.nextKey = 1;
    this.activeHats = new Set(); // hats currently mid-run, so a message cannot re-enter one

    // Where a JavaScript program's runtime errors go. Assigned by main.js (a toast);
    // console.error regardless, matching the block runner's behaviour. Worth surfacing
    // for JS where it is not for blocks because hand-typed code fails in ways blocks
    // cannot -- a misspelled function name is a ReferenceError, and a student who never
    // opens the console would otherwise just see their object stand still.
    this.onScriptError = null;

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

  // The dispatch every caller goes through: run whichever representation the record says
  // is live. Blocks remain the default for every record that has never seen the toggle.
  startFromRecord(id, record, object3D) {
    if (record?.programMode === 'js' && record.programJs?.trim()) {
      this.startJs(id, record.programJs, object3D, { noDuplicate: !!record.programNoDuplicate });
    } else {
      this.start(id, record?.program, object3D);
    }
  }

  reportScriptError(id, err) {
    console.error(`JavaScript program for object ${id} raised an error and was stopped:`, err);
    this.onScriptError?.(id, err);
  }

  startJs(id, code, object3D, { noDuplicate = false } = {}) {
    this.stop(id);
    const { fn, error } = compileJs(code);
    if (error) {
      // A compile error can arrive from a LOADED record, not only from the editor (a
      // world file written by a newer version, or hand-edited): report rather than throw,
      // so one broken program cannot take down a whole world's rehydration.
      this.reportScriptError(id, error);
      return;
    }

    const home = this.captureHome(object3D);
    const effects = this.effectsFor(id, object3D, home);
    const run = { id, pending: [], hats: [], ticks: 0, noDuplicate };
    const key = `${id}#js${this.nextKey++}`;
    this.jsRuns.set(key, run);

    const api = buildJsRuntime({ object3D, effects, run });
    fn(...JS_RUNTIME_NAMES.map((name) => api[name]))
      .then(() => {
        // The main script finished. The run object stays if it registered hats -- an
        // object whose program is nothing but whenSaid() should keep listening, the same
        // as a block program that is nothing but hats.
        if (!run.hats.length) this.jsRuns.delete(key);
      })
      .catch((err) => {
        this.reportScriptError(id, err);
        if (!run.hats.length) this.jsRuns.delete(key);
      });
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

    // JavaScript hats hear the same broadcasts, so a block `say` can start a JS script
    // and a JS say() can start a block hat -- challenge 5's two robots work across the
    // language boundary. Same re-entry guard as activeHats: a hat mid-run is not
    // restarted by its own trigger phrase.
    for (const run of this.jsRuns.values()) {
      for (const hat of run.hats) {
        if (hat.key !== key || hat.running) continue;
        hat.running = true;
        Promise.resolve()
          .then(() => hat.body())
          .catch((err) => this.reportScriptError(run.id, err))
          .finally(() => { hat.running = false; });
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
    // Dropping a JS run's pending resolvers is the whole stop: nothing ever resolves
    // them again, so every await in the user's code simply never returns and the async
    // frames become unreachable -- no flags to poll, nothing to leak.
    for (const [key, run] of [...this.jsRuns]) {
      if (run.id !== id) continue;
      run.pending.length = 0;
      run.hats.length = 0;
      this.jsRuns.delete(key);
    }
    this.programs.delete(id);
  }

  isRunning(id) {
    for (const runner of this.runners.values()) if (runner.id === id) return true;
    for (const run of this.jsRuns.values()) if (run.id === id) return true;
    return false;
  }

  tick() {
    if (!this.runners.size && !this.jsRuns.size) return;
    const now = performance.now();

    // Release every JavaScript await whose time has come. Resolution queues a microtask,
    // so the user code's next step runs after this frame's work -- one action per frame,
    // the block cadence. `ticks` feeds repeat()'s guarantee of a tick per pass.
    for (const run of this.jsRuns.values()) {
      if (!run.pending.length) continue;
      const due = [];
      run.pending = run.pending.filter((p) => (p.at <= now ? (due.push(p), false) : true));
      run.ticks += due.length;
      for (const p of due) p.resolve();
    }

    if (!this.runners.size) return;
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
