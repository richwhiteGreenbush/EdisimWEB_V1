// Runs a shipped block program for real, with the clock taken out: the actual ProgramRunner on an
// actual Object3D, stepped as fast as it will go, with `wait` returning at once and every say
// logged. Used by the world check tools, so "every sequence on these boards has been run" is
// something a tool does rather than something a comment claims.
import * as THREE from 'three';

const { runProgram, runBranch } = await import('../../src/ProgramRunner.js');
const { BLOCK_DEFS } = await import('../../src/BlockDefs.js');
const { blocksToJs, compileJs, buildJsRuntime, JS_RUNTIME_NAMES } = await import('../../src/JsProgram.js');

function homeOf(object3D) {
  return {
    position: object3D.position.clone(),
    quaternion: object3D.quaternion.clone(),
    scale: object3D.scale.clone(),
  };
}

export function runBlocks(program, {
  maxSteps = 200000, stopWhen = null, object3D = new THREE.Object3D(), worldVars = new Map(), vars = new Map(),
} = {}) {
  const log = { says: [], sizes: [], problems: [], steps: 0, path: [] };
  const home = homeOf(object3D);
  const effects = {
    home,
    vars,
    worldVars,
    say: (text) => log.says.push(text),
    onUnknownVariable: (name) => log.problems.push(`unknown ${name}`),
    onMathProblem: (name) => log.problems.push(`math ${name}`),
  };
  const step = (generator) => {
    while (log.steps < maxSteps) {
      const { done } = generator.next();
      if (done) return;
      log.steps++;
      log.sizes.push(object3D.scale.x * 100);
      log.path.push(object3D.position.clone());
      if (stopWhen?.(log, vars)) return;
    }
  };
  const main = program.filter((block) => !BLOCK_DEFS[block.type]?.hat);
  step(runProgram(main, object3D, effects));
  return {
    log,
    object3D,
    vars,
    worldVars,
    // Fires a hat, as ProgramManager.broadcast does when its words go out.
    hear(text) {
      for (const block of program) {
        if (block.type === 'whenSaid' && block.params.text === text) step(runBranch(block.children, object3D, effects));
      }
      return log;
    },
  };
}

// The same program through blocksToJs and the real JavaScript runtime, so a check can say whether
// the two frontends agree. Runs until `says` lines have been said or the frames run out.
export async function runBlocksAsJs(program, { says = Infinity, frames = 200000, object3D = new THREE.Object3D() } = {}) {
  const code = blocksToJs(program);
  const { fn, error } = compileJs(code);
  if (error) throw new Error(`${error.message}\n${code}`);
  const log = { says: [], code };
  const effects = { home: homeOf(object3D), worldVars: new Map(), say: (text) => log.says.push(text) };
  const run = { id: 'check', pending: [], hats: [], ticks: 0, noDuplicate: false };
  const api = buildJsRuntime({ object3D, effects, run });
  let finished = false;
  fn(...JS_RUNTIME_NAMES.map((name) => api[name])).then(() => { finished = true; });
  for (let i = 0; i < frames && !finished && log.says.length < says; i++) {
    const due = run.pending;
    run.pending = [];
    run.ticks += due.length;
    for (const p of due) p.resolve();
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  log.object3D = object3D;
  return log;
}
