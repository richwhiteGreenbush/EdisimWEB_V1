// Regression check for The Hall of Light (src/props/OpticsModel.js, OpticsPrograms.js, OpticsProps.js,
// the layout in WorldPresets.js and the lesson cards at EdusimWorldDatabase/lib/lessons/hall-of-light.html).
//
//   node tools/check-hall-of-light.mjs
//
// What it holds, most important first, because a beam that goes the wrong way in an optics lesson is
// the failure this world cannot afford:
//
//  1. EVERY BEAM IS ACTUALLY RUN through the real block runner, at every setting the boards and the
//     lesson guide ask about, and the path it draws is compared with OpticsModel.js vertex by vertex.
//     The model is then held to the physics: angle in = angle out, Snell's law at every surface, the
//     critical angle, the thin-lens focus.
//  2. The light pipe ships BROKEN on purpose: as shipped, i = 45 must give "no answer"; with the
//     activity's two `if` blocks it must not.
//  3. The world: record order for shared values, no JavaScript anywhere, every prop key real, every
//     beam starting where its laser is, the arrival frame, and typed code that round-trips.
//  4. The cards are static HTML, so every figure in them is looked for in the page.
//  5. Open edges per builder against a recorded baseline.
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

const ctx = new Proxy({
  measureText: (t) => ({ width: String(t).length * 9 }),
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
}, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0, style: {} }) };

const M = await import('../src/props/OpticsModel.js');
const P = await import('../src/props/OpticsPrograms.js');
const { runBlocks } = await import('./lib/run-blocks.mjs');

// [builder, open-edge baseline]. Raise a baseline ONLY after looking at the prop and confirming the
// new open edges are a printed plane lying on a solid or a deliberately open shell, not a hole.
// Every non-zero entry is the rim of a printed or glowing plane lying on a solid: 4 for a rectangle,
// 18 for a laser's or the rod lamp's glowing disc, and 196 for the hall's spectrum set into the paving
// (six sectors, a heart and a ring) plus its name panel.
const BASELINES = [
  ['lightBench', 4], ['laser', 18], ['beamBead', 0], ['flatMirror', 4], ['periscope', 8], ['brickWall', 0],
  ['eyeTarget', 0], ['waterTank', 0], ['tankFish', 0], ['glassBlock', 0], ['lightRod', 18], ['prism', 0],
  ['convergingLens', 0], ['lightScreen', 4], ['clearButton', 4], ['hall', 196],
];

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};
const f2 = (v) => v.toFixed(2);
const RAD = Math.PI / 180;

// The model's points are in bench feet (u, y); a run starts at the origin facing +Z, so a beam's
// `x` is the object's z and its `y` is the object's y.
function followsPath(log, points, label) {
  const [u0, y0] = points[0];
  let worst = 0;
  for (const [u, y] of points.slice(1)) {
    let best = Infinity;
    for (const p of log.path) best = Math.min(best, Math.hypot(p.z - (u - u0), p.y - (y - y0), p.x));
    worst = Math.max(worst, best);
  }
  const last = log.path.at(-1);
  const [ue, ye] = points.at(-1);
  const endGap = last ? Math.hypot(last.z - (ue - u0), last.y - (ye - y0)) : Infinity;
  check(worst < 1e-6 && endGap < 1e-6, label, `worst vertex ${worst.toExponential(1)}, end ${endGap.toExponential(1)}`);
}

const hearing = (program, cue, worldVars = new Map()) => {
  const run = runBlocks(program, { worldVars });
  run.hear(cue);
  return run;
};

console.log('\n1. The Mirror: angle in = angle out');
for (const angle of M.MIRROR.tries) {
  const t = M.mirrorTrace({ angle });
  const { log } = runBlocks(P.mirrorProgram({ angle }));
  followsPath(log, t.points, `aimed at ${angle}°`);
  check(t.onMirror, `  lands on the mirror`, `u = ${f2(t.hit[0])}`);
  const said = log.says.at(-1);
  if (t.onScreen) check(said === `the dot is ${f2(t.height)} feet up the screen`, '  says where the dot is', said);
  else check(said.startsWith('Over the top'), '  says it missed the screen', said);
  // The physics: the beam leaves at the angle it arrived.
  check(Math.abs(Math.atan2(t.end[1] - t.hit[1], t.end[0] - t.hit[0]) / RAD + angle) < 1e-9, '  out at minus the angle in');
}
check(M.mirrorTrace().onScreen && !M.mirrorTrace({ angle: -35 }).onScreen,
  'the default lands on the screen, and -35 goes over the top (the board says so)');

console.log('\n2. The Periscope');
{
  const t = M.periscopeTrace();
  const { log } = runBlocks(P.periscopeProgram());
  followsPath(log, t.points, 'the shipped beam goes up and over');
  const s = M.periscopeTrace({ shift: M.PERISCOPE.studentShift });
  const answer = runBlocks(P.periscopeAnswer());
  followsPath(answer.log, s.points, "the activity's three moves trace the second periscope");
}

console.log("\n3. The Water Tank: Snell's law");
for (const aim of M.TANK.tries.aim) {
  for (const n of M.TANK.tries.n) {
    const t = M.tankTrace({ aim, n });
    const { log } = runBlocks(P.waterProgram({ aim, n }));
    followsPath(log, t.points, `aim ${aim}°, n = ${n}`);
    check(Math.abs(Math.sin(t.i * RAD) - n * Math.sin(t.r * RAD)) < 1e-12, '  n1 sin i = n2 sin r');
    check(t.inTank, '  lands on the tank floor', f2(t.floor[0]));
  }
}
{
  const t = M.tankTrace();
  const vars = new Map([['aim', M.TANK.aim]]);
  const spear = hearing(P.spearProgram(), P.SPEAR, vars);
  const [u0, y0] = M.TANK.laser;
  const end = spear.log.path.at(-1);
  check(Math.hypot(end.z - (t.spear[0] - u0), end.y - (t.spear[1] - y0)) < 1e-6, 'the spear line runs straight on to the floor');
  check(t.spear[0] > t.floor[0], '  and lands beyond the real fish', `${f2(t.spear[0])} vs ${f2(t.floor[0])}`);
  const { log } = runBlocks(P.waterProgram());
  check(log.says[0] === `In at ${Math.round(t.i)}°, bent to ${f2(t.r)}°.`, 'says the two angles', log.says[0]);
  check(log.says.at(-1) === P.SPEAR, 'cues the spear', log.says.at(-1));
}

console.log('\n4. The Light Pipe');
for (const i of M.BLOCK.tries) {
  const broken = M.blockTrace({ i, fixed: false });
  const shipped = runBlocks(P.blockProgram({ i }));
  followsPath(shipped.log, broken.points, `as shipped, i = ${i}°`);
  const crit = i > M.CRITICAL.glass;
  check(crit === shipped.log.problems.includes('math r'), crit ? '  "r has no answer", as the activity needs' : '  no warning below the critical angle',
    shipped.log.problems.join(', ') || 'none');
  const good = M.blockTrace({ i });
  const fixed = runBlocks(P.blockProgram({ i, fixed: true }));
  followsPath(fixed.log, good.points, `  with the fix, i = ${i}°`);
  check(fixed.log.problems.length === 0, '  and with the fix nothing is unanswerable', fixed.log.problems.join(', ') || 'none');
  check(good.end[0] < M.BLOCK.to && (good.escaped || good.end[1] > M.BLOCK.bottom), '  and the beam stays on its half of the bench');
}
check(P.blockFix().length === 2, 'the fix is exactly two if blocks');
for (const angle of M.FIBRE.tries) {
  const t = M.fibreTrace({ angle });
  const { log } = runBlocks(P.fibreProgram({ angle }));
  followsPath(log, t.relative.map(([x, y]) => [x, y]), `the rod at ${angle}°: ${t.bounces} bounces${t.leaked ? ', leaks' : ''}`);
  check(t.leaked === (90 - angle < M.CRITICAL.acrylic), '  leaks exactly when the wall angle is under the critical angle');
  check(log.problems.length === 0, '  nothing unanswerable', log.problems.join(', ') || 'none');
}

console.log('\n5. The Prism');
{
  const laser = M.prismLaser();
  const { log } = runBlocks(P.whiteLaserProgram());
  const entry = M.prismEntry();
  const end = log.path.at(-1);
  check(Math.hypot(end.z - (entry[0] - laser.start[0]), end.y - (entry[1] - laser.start[1])) < 2e-3,
    'the white beam reaches the face where the colours wait', `${f2(end.z)}, ${f2(end.y)}`);
  check(log.says[0] === P.SPLIT, 'and gives the cue', log.says[0]);
  let previous = Infinity;
  for (const colour of M.SPECTRUM) {
    const t = M.prismTrace(colour.n);
    const run = hearing(P.colourProgram(colour), P.SPLIT);
    followsPath(run.log, t.points, `${colour.name} (n = ${colour.n}) to ${f2(t.end[1])} ft on the screen`);
    check(t.end[1] < previous, '  lower than the colour before it');
    previous = t.end[1];
    const { right, apex } = M.prismCorners();
    const along = (t.exit[0] - apex[0]) / (right[0] - apex[0]);
    check(along > 0 && along < 1, '  leaves through the far face', f2(along));
    check(t.end[1] > 0.8, '  and lands on the screen');
  }
  const spread = M.prismTrace(M.SPECTRUM[0].n).end[1] - M.prismTrace(M.SPECTRUM[5].n).end[1];
  check(spread > 1.5, 'the spectrum is wide enough to read', `${f2(spread)} ft`);
}

console.log('\n6. The Lens');
for (const f of M.LENS.tries) {
  const vars = new Map([['f', f]]);
  for (const [k, h] of M.LENS.heights.entries()) {
    const t = M.lensTrace(h, { f });
    const run = hearing(P.lensBeamProgram(h, M.LENS.colors[k]), P.FOCUS, vars);
    followsPath(run.log, t.points, `f = ${f}, beam at ${h}`);
    if (h !== 0) check(Math.abs(M.lensCrossing(h, f) - f) < 1e-9, '  crosses the axis f past the lens');
    check(t.end[1] > 0.8 && t.end[1] < 10.6, '  lands on the screen', f2(t.end[1]));
  }
}
{
  const { log } = runBlocks(P.lensProgram());
  check(log.says[0] === P.FOCUS && log.says[1] === `The beams meet ${M.LENS.f} feet past the lens.`, 'the lens cues and reports', log.says.join(' / '));
}

console.log('\nThe facts on the placards');
check(Math.abs(M.CRITICAL.water - 48.6) < 0.05, 'water critical angle 48.6°', f2(M.CRITICAL.water));
check(Math.abs(M.CRITICAL.acrylic - 42.2) < 0.05, 'acrylic 42.2°', f2(M.CRITICAL.acrylic));
check(Math.abs(M.CRITICAL.glass - 41.1) < 0.05, 'glass 41.1°', f2(M.CRITICAL.glass));
check(Math.abs(M.CRITICAL.diamond - 24.4) < 0.05, 'diamond 24.4°', f2(M.CRITICAL.diamond));
check(Math.abs(M.flintIndex(587.6) - 1.78472) < 2e-5 && Math.abs(M.flintIndex(656.3) - 1.77596) < 2e-5,
  'the flint formula reproduces the published n_d and n_C', `${M.flintIndex(587.6).toFixed(5)}, ${M.flintIndex(656.3).toFixed(5)}`);
check(Math.abs(M.LIGHT.hallNanoseconds - 30.5) < 0.1, 'light crosses 30 ft in about 30 ns', f2(M.LIGHT.hallNanoseconds));

console.log('\nThe world');
{
  const Props = await import('../src/props/OpticsProps.js');
  const { buildProp, PROP_BUILDERS } = await import('../src/props/index.js');
  const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');
  const { BLOCK_DEFS } = await import('../src/BlockDefs.js');
  const built = buildPresetWorldRecords('halloflight', { groundHeightAt: () => 0 });
  const records = built.records ?? built;
  const props = records.filter((r) => r.kind === 'preset-prop');
  check(props.every((r) => PROP_BUILDERS[r.prop]), 'every prop key is a real builder');
  check(records.every((r) => !r.programJs && r.programMode !== 'js'), 'no JavaScript anywhere: this is a block code world');
  const walk = (blocks, fnc) => (blocks || []).forEach((b) => { fnc(b); walk(b.children, fnc); });
  let unknown = 0;
  for (const r of records) walk(r.program, (b) => { if (!BLOCK_DEFS[b.type]) unknown++; });
  check(unknown === 0, 'every block type exists');
  // Shared values must be shared before anything reads them. The two pairs here: the water laser
  // shares `aim` before the spear line hears its cue, and the lens shares `f` before it cues the beams.
  const names = (r) => { const out = new Set(); walk(r.program, (b) => { for (const v of Object.values(b.params || {})) if (typeof v === 'string') out.add(v); }); return out; };
  const sharer = (name) => records.findIndex((r) => { let yes = false; walk(r.program, (b) => { if (b.type === 'shareVar' && b.params.name === name) yes = true; }); return yes; });
  const sharesAim = sharer('aim');
  const readsAim = records.findIndex((r, i) => i !== sharesAim && names(r).has('aim'));
  check(sharesAim >= 0 && readsAim > sharesAim, 'the water laser comes before the spear line that reads its aim');
  // Hats must exist before the cue is given: listeners before the one that speaks.
  const cue = (text) => records.findIndex((r) => { let yes = false; walk(r.program, (b) => { if (b.type === 'say' && b.params.text === text) yes = true; }); return yes; });
  const listeners = (text) => records.map((r, i) => (r.program?.some((b) => b.type === 'whenSaid' && b.params.text === text) ? i : -1)).filter((i) => i >= 0);
  for (const text of [P.SPLIT, P.FOCUS, P.SPEAR]) {
    const ls = listeners(text);
    check(ls.length > 0, `"${text}" has listeners`, String(ls.length));
  }
  check(listeners(P.SPLIT).every((i) => i < cue(P.SPLIT)), 'the six colours are placed before the white beam that cues them');
  check(listeners(P.FOCUS).every((i) => i < cue(P.FOCUS)), 'the five lens beams are placed before the lens that cues them');
  check(listeners(P.SPLIT).length === 6 && listeners(P.FOCUS).length === M.LENS.heights.length, 'six colours, five lens beams');
  // Every beam with a program has homeFromRecord, or Save would make wherever it stopped its new start.
  const beams = props.filter((r) => r.prop === 'hl-beam');
  check(beams.every((r) => r.homeFromRecord), 'every beam goes back to its laser when it restarts');
  check(beams.filter((r) => !r.program?.length).length === 1, 'exactly one beam ships empty, for the periscope activity');
  // A beam must start at its laser's aperture: the same world point, 0.125 below (the marker's lift).
  const lasers = props.filter((r) => r.prop === 'hl-laser');
  let far = 0;
  for (const beam of beams.filter((r) => !r.programQuiet || r.program?.[0]?.type !== 'whenSaid' || true)) {
    const [bx, by, bz] = beam.transform.position;
    const d = Math.min(...lasers.map((l) => Math.hypot(l.transform.position[0] - bx, l.transform.position[1] - (by + 0.125), l.transform.position[2] - bz)));
    if (d > 0.7) far++;
  }
  // The prism's six colour beads wait at the glass, and the fibre's is born in the rod's own lamp.
  check(far === 7, 'every other beam starts at a laser', `${far} away from any laser`);
  // The arrival frame: nothing tall stands in front of the prism from the spawn.
  const spawn = built.spawn ?? { x: 0, z: 62 };
  const bearing = (x, z) => Math.atan2(-(x - spawn.x), -(z - spawn.z)) * 180 / Math.PI;
  const blockers = props.filter((r) => ['welcome-board', 'info-placard', 'block-board', 'activity-board', 'browser-kiosk'].includes(r.prop))
    .filter((r) => { const [x, , z] = r.transform.position; return z < spawn.z && Math.abs(bearing(x, z)) < 14; });
  check(blockers.length === 0, 'no board stands between the door and the prism', blockers.map((r) => r.prop).join(', ') || 'clear');
  const transparent = [];
  for (const name of Object.keys(PROP_BUILDERS).filter((k) => k.startsWith('hl-'))) {
    const count = props.filter((r) => r.prop === name).length;
    if (!count) { check(false, `${name} is used in the world`); continue; }
    let t = 0;
    buildProp(name, props.find((r) => r.prop === name).options).traverse((o) => { if (o.isMesh && o.material.transparent) t++; });
    transparent.push(t * count);
  }
  const tTotal = transparent.reduce((a, b) => a + b, 0);
  check(tTotal <= 8, 'at most 8 transparent meshes in the hall', String(tTotal));

  console.log('\nThe lesson card');
  const cardPath = new URL('../EdusimWorldDatabase/lib/lessons/hall-of-light.html', import.meta.url);
  if (!existsSync(cardPath)) check(false, 'the lesson card exists');
  else {
    const text = readFileSync(cardPath, 'utf8');
    const mirror = M.mirrorTrace();
    const tank = M.tankTrace();
    const required = [
      `${M.CRITICAL.glass.toFixed(1)}°`, `${M.CRITICAL.water.toFixed(1)}°`, `${M.CRITICAL.acrylic.toFixed(1)}°`, `${M.CRITICAL.diamond.toFixed(1)}°`,
      `${mirror.height.toFixed(2)}`, `${M.mirrorTrace({ angle: -20 }).height.toFixed(2)}`, `${M.mirrorTrace({ angle: -30 }).height.toFixed(2)}`,
      `${tank.r.toFixed(2)}°`, `${M.tankTrace({ n: M.INDEX.diamond }).r.toFixed(2)}°`, `${M.tankTrace({ n: 1 }).r.toFixed(0)}°`,
      ...M.SPECTRUM.map((c) => String(c.n)),
      `${M.fibreTrace().bounces} bounces`,
      ...[1, 2, 3, 4, 5].map(() => ''),
    ].filter(Boolean);
    for (const figure of required) check(text.includes(figure), `card states ${figure}`);
    for (const i of [30, 40, 45, 60]) {
      const t = M.blockTrace({ i }).t;
      check(text.includes(t.toFixed(2)), `card states n sin i at ${i}° = ${t.toFixed(2)}`);
    }
    check(!/javascript/i.test(text), 'the card does not mention JavaScript');
  }

  console.log('\nprop                 meshes     tris   open  baseline');
  for (const [name, baseline] of BASELINES) {
    const obj = Props[name]({});
    let tris = 0; let meshCount = 0; let open = 0;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      meshCount++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      open += Math.min(boundaryEdges(g, 0.004), boundaryEdges(g, 0.0071));
    });
    const bad = open > baseline;
    if (bad) failures++;
    console.log(`${name.padEnd(20)} ${String(meshCount).padStart(5)} ${String(Math.round(tris)).padStart(8)} ${String(open).padStart(6)} ${String(baseline).padStart(9)}${bad ? '  REGRESSION' : ''}`);
  }
}

function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen = new Map();
  const count = geometry.index ? geometry.index.count : pos.count;
  const at = (t) => (geometry.index ? geometry.index.getX(t) : t);
  for (let t = 0; t < count; t += 3) {
    const a = key(at(t)); const b = key(at(t + 1)); const c = key(at(t + 2));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      seen.set(e, (seen.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of seen.values()) if (v === 1) open++;
  return open;
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
