// Regression check for Newton's Midway (src/props/MidwayProps.js, MidwayModel.js, MidwayPrograms.js
// and the lesson cards at EdusimWorldDatabase/lib/lessons/newtons-midway.html).
//
//   node tools/check-midway.mjs
//
// Three things, and the first two matter most, because a wrong number in a physics lesson is the
// failure this world cannot afford:
//
//  1. EVERY PROGRAM IS ACTUALLY RUN through the real block runner, at every setting the student
//     guide asks about, and what it says is compared with MidwayModel.js. The model is then held
//     to the textbook formula, within the gap a stepped model is expected to have.
//  2. THE CARDS ARE STATIC HTML, so every figure in the answer key is looked for in the page.
//  3. Open edges per builder against a recorded baseline.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

const ctx = new Proxy({
  measureText: (t) => ({ width: String(t).length * 9 }),
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
}, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0, style: {} }) };

const Props = await import('../src/props/MidwayProps.js');
const M = await import('../src/props/MidwayModel.js');
const P = await import('../src/props/MidwayPrograms.js');
const { buildProp } = await import('../src/props/index.js');
const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');
const { runBlocks, runBlocksAsJs } = await import('./lib/run-blocks.mjs');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};
const said = (n) => (log) => log.says.length >= n;
const fx = (v) => v.toFixed(2);
// The world's own values for anything shared, so a program can be run on its own.
const shares = (entries) => new Map(Object.entries(entries));

console.log('\nThe programs say what the model says');
{
  for (const [label, opts] of [['Earth', {}], ['Mars', { g: M.MARS_G }], ['Moon', { g: M.MOON_G }], ['10 m', { height: 10 }]]) {
    const run = M.dropRun(opts);
    const { log } = runBlocks(P.dropProgram(opts), { stopWhen: said(2) });
    check(log.says[0] === `fell for ${fx(run.time)} s` && log.says[1] === `hit the bottom at ${fx(run.speed)} m/s`,
      `drop tower, ${label}`, log.says.join(' / '));
    const f = M.dropFormula(opts);
    check(Math.abs(run.time - f.time) < 0.03, `  within a step of the formula`, `${fx(run.time)} vs ${fx(f.time)}`);
  }
}
{
  for (const angle of [15, 30, 45, 60, 75]) {
    const run = M.cannonRun({ angle });
    const { log, object3D } = runBlocks(P.cannonProgram({ angle }));
    check(log.says[0] === `range ${fx(run.range)} m`, `cannon at ${angle} degrees`, log.says[0]);
    check(Math.abs(object3D.position.z - run.range) < 1e-6, '  the ball really travelled that far', fx(object3D.position.z));
    check(Math.abs(object3D.position.y) < 0.5, '  and came down at launch height', fx(object3D.position.y));
    check(Math.abs(run.range - M.cannonFormula({ angle }).range) < 0.4, '  within sight of the formula', fx(M.cannonFormula({ angle }).range));
  }
  const speed = Number(M.targetSpeed().toFixed(2));
  const hit = M.cannonRun({ speed });
  check(Math.abs(hit.range - M.TARGET_RANGE) < 1.8, 'the formula speed lands inside the 30 m ring', `${speed} m/s -> ${fx(hit.range)} m`);
  const coarse = M.cannonRun({ dt: 0.5 });
  check(coarse.range < 38 && coarse.top < 8, 'dt = 0.5 visibly spoils the arc', `${fx(coarse.range)} m, top ${fx(coarse.top)} m`);
}
{
  for (const mass of M.CARTS) {
    for (const mu of [0, M.TRACK.mu]) {
      const run = M.trackRun({ mass, mu });
      const { log } = runBlocks(P.trackProgram({ mass, mu }), { stopWhen: said(2) });
      check(log.says[0] === `time ${fx(run.time)} s` && log.says[1] === `final speed ${fx(run.speed)} m/s`,
        `cart ${mass} kg, mu ${mu}`, log.says.join(' / '));
    }
  }
  const stuck = runBlocks(P.trackProgram({ mass: 100, mu: 0.5 }), { stopWhen: said(1) });
  check(stuck.log.says[0].startsWith('Friction is too strong'), 'too much friction is reported, not run', stuck.log.says[0]);
}
{
  for (const opts of [{}, { mu: 0.05 }, { mu: 0.1 }, { height: 10 }, { mass: 1000 }]) {
    const run = M.coasterRun(opts);
    const { log } = runBlocks(P.coasterProgram(opts), { stopWhen: said(2), worldVars: new Map() });
    check(log.says[0] === `top speed ${fx(run.bottomSpeed)} m/s` && log.says[1] === `climbed back to ${fx(run.climb)} m`,
      `coaster ${JSON.stringify(opts)}`, log.says.join(' / '));
  }
  // The three bars must always add up to the whole: that is the world's claim about energy.
  const worst = { gap: 0 };
  const wv = new Map();
  runBlocks(P.coasterProgram({ mu: 0.05 }), {
    worldVars: wv,
    stopWhen: (l) => {
      if (wv.has('KE') && wv.has('PE') && wv.has('heat') && wv.has('total') && wv.get('heat') > 0) {
        worst.gap = Math.max(worst.gap, Math.abs(wv.get('PE') + wv.get('KE') + wv.get('heat') - wv.get('total')));
      }
      return l.says.length >= 1;
    },
  });
  check(worst.gap < 1e-6, 'height + motion + heat always equals the total', `worst gap ${worst.gap.toExponential(1)} J`);
  check(M.coasterRun({ mass: 1000 }).bottomSpeed === M.coasterRun().bottomSpeed, 'mass really does cancel');
}
{
  for (const opts of [{}, { e: 0 }, { m1: 300 }]) {
    const f = M.bumperFormula(opts);
    const wv = new Map();
    const { log } = runBlocks(P.bumperControlProgram(opts), { worldVars: wv, stopWhen: said(5) });
    check(log.says[1] === `momentum before ${fx(f.before)} kg m/s` && log.says[2] === `momentum after ${fx(f.after)} kg m/s`,
      `scoreboard ${JSON.stringify(opts)}`, log.says.slice(1, 3).join(' / '));
    check(log.says[3] === `car A leaves at ${fx(f.v1)} m/s` && log.says[4] === `car B leaves at ${fx(f.v2)} m/s`, '  and the two speeds', log.says.slice(3).join(' / '));
    check(Math.abs(f.before - f.after) < 1e-9, '  momentum is conserved');
    // Run both cars for real off what the board shared, and check they meet nose to nose.
    const runCar = (program, z, yaw) => {
      const object3D = new THREE.Object3D();
      object3D.position.z = z;
      object3D.rotation.y = yaw;
      const car = runBlocks(program, { worldVars: wv, object3D });
      car.hear('go');
      return car;
    };
    const runA = runCar(P.bumperCarA(), 0, 0);
    const runB = runCar(P.bumperCarB(), M.BUMPER.start, Math.PI);
    const hitA = runA.log.path.find((_, i) => i * 0.02 + 0.02 >= wv.get('tHit'));
    const hitB = runB.log.path.find((_, i) => i * 0.02 + 0.02 >= wv.get('tHit'));
    check(Math.abs(hitB.z - hitA.z - M.BUMPER.carLength) < 0.25, '  the cars meet one car length apart', fx(hitB.z - hitA.z));
  }
}
{
  for (const opts of [{}, { angle: 5 }, { angle: 60 }, { length: 6 }]) {
    const run = M.pendulumRun(opts);
    const { log } = runBlocks(P.pendulumProgram(opts), { stopWhen: said(1) });
    check(log.says[0] === `one full swing: ${fx(run.period)} s`, `pendulum ${JSON.stringify(opts)}`, log.says[0]);
  }
  const small = M.pendulumRun({ angle: 5 }).period;
  check(Math.abs(small - M.pendulumFormula()) < 0.03, 'a small swing agrees with 2 pi root(L/g)', `${fx(small)} vs ${fx(M.pendulumFormula())}`);
  for (const period of [5, 6, 8]) {
    const wv = new Map();
    const { log } = runBlocks(P.swingHubProgram({ period }), { worldVars: wv, stopWhen: said(1) });
    check(log.says[0] === `the chains lean ${fx(M.swingFormula({ period }).angle)} degrees`, `swing ride, period ${period}`, log.says[0]);
  }
}
{
  // The activity boards: the printed stacks, built and run. "Every sequence on these boards has
  // been run" is the rule, and it is only true if something runs them.
  const { setv, calc, until, up, whenSaid, change, forward, say } = await import('../src/BlockKit.js');
  const fall = [
    setv('y', 10), setv('v', 0),
    until('y', '<=', 0, calc('v', 'v', '-', 0.2), calc('dy', 'v', '*', 0.02), calc('y', 'y', '+', 'dy'), up('dy')),
  ];
  const object3D = new THREE.Object3D();
  object3D.position.y = 10;
  runBlocks(fall, { object3D });
  check(Math.abs(object3D.position.y) < 0.4, 'activity 1 lands the ball', `ends at ${fx(object3D.position.y)} ft`);
  const wv = shares({ tHit: 4.8, u1: 4 });
  const third = [whenSaid('go', setv('t', 0), until('t', '>=', 'tHit', calc('dx', 'u1', '*', 0.02), forward('dx'), change('t', 0.02)), say('Bang!'))];
  const car = runBlocks(third, { worldVars: wv });
  car.hear('go');
  check(car.log.says.at(-1) === 'Bang!' && Math.abs(car.object3D.position.z - 19.2) < 0.1, 'activity 3 drives and says Bang!', `${fx(car.object3D.position.z)} ft`);
  check(car.log.problems.length === 0, 'activity 3 reads the shared numbers', car.log.problems.join(', '));
}
{
  // The toggle: every program's JavaScript view has to say what its blocks say.
  const blockSays = runBlocks(P.cannonProgram()).log.says;
  const js = await runBlocksAsJs(P.cannonProgram(), { says: blockSays.length });
  check(js.says.join('|') === blockSays.join('|'), 'the cannon says the same in both views', js.says[0]);
  for (const [name, program] of Object.entries({
    drop: P.dropProgram(), track: P.trackProgram({ mass: 100 }), coaster: P.coasterProgram(), board: P.bumperControlProgram(),
    carA: P.bumperCarA(), pendulum: P.pendulumProgram(), hub: P.swingHubProgram(), chair: P.swingChairProgram(), wheel: P.wheelProgram(),
    bar: P.energyBarProgram({ name: 'KE', fullHeight: Props.ENERGY_FULL }),
  })) {
    const { code } = await runBlocksAsJs(program, { says: 0 });
    check(!code.includes('unknown block'), `${name} translates completely`);
  }
}

console.log('\nThe world builds');
const built = buildPresetWorldRecords('midway', { groundHeightAt: () => 0 });
const records = built.records;
const props = records.filter((r) => r.kind === 'preset-prop');
check(records.every((r) => !r.programJs && r.programMode !== 'js'), 'no record in this world carries JavaScript');
const running = records.filter((r) => r.program?.length);
check(running.length >= 20, 'the rides ship running block programs', String(running.length));
{
  // Reading before sharing would warn on arrival, and a program's start order is record order.
  const order = (prop) => records.findIndex((r) => r.prop === prop && r.program?.length);
  check(order('mw-test-ball') < order('mw-cannon-barrel'), 'the shot shares its angle before the barrel reads it');
  check(order('mw-coaster-pod') < order('mw-energy-bar'), 'the pod shares its energy before the bars read it');
  check(order('mw-scoreboard') < order('mw-bumper-car'), 'the scoreboard shares before the cars read it');
  check(order('mw-swing-hub') < order('mw-swing-chair'), 'the hub shares before the chairs read it');
}
let triangles = 0;
let meshes = 0;
for (const r of props) {
  const object3D = buildProp(r.prop, r.options);
  object3D.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
}
console.log(`  ${props.length} props, ${meshes} meshes, ${Math.round(triangles).toLocaleString('en-US')} triangles of geometry`);

console.log('\nThe lesson cards');
{
  const html = readFileSync(new URL('../EdusimWorldDatabase/lib/lessons/newtons-midway.html', import.meta.url), 'utf8');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  check(!/javascript/i.test(text), 'the cards never mention JavaScript');
  check(html.includes('id="lc-student"') && html.includes('id="lc-teacher"'), 'both cards are there');
  const f2 = fx;
  const drop = M.dropRun();
  const moon = M.dropRun({ g: M.MOON_G });
  const mars = M.dropRun({ g: M.MARS_G });
  const lean = (period) => M.swingFormula({ period }).angle.toFixed(1);
  const required = [
    `${f2(M.dropRun({ height: 10 }).time)} s`, `${f2(M.dropFormula({ height: 10 }).time)} s`,
    `${f2(drop.time)} s`, `${f2(drop.speed)} m/s`, `${f2(mars.time)} s`, `${f2(mars.speed)} m/s`, `${f2(moon.time)} s`, `${f2(moon.speed)} m/s`,
    ...[15, 30, 45, 60, 75].map((angle) => f2(M.cannonRun({ angle }).range)),
    ...[15, 30, 45, 60, 75].map((angle) => f2(M.cannonFormula({ angle }).range)),
    `${f2(M.targetSpeed())} m/s`, `${f2(M.cannonRun({ speed: Number(M.targetSpeed().toFixed(2)) }).range)} m`,
    `${f2(M.cannonRun({ dt: 0.5 }).range)} m`, `${f2(M.cannonRun({ dt: 0.5 }).top)} m`, `${f2(M.cannonRun().top)} m`,
    ...M.CARTS.flatMap((mass) => [`${f2(M.trackRun({ mass }).time)} s`]),
    ...M.CARTS.flatMap((mass) => [f2(M.trackRun({ mass, mu: M.TRACK.mu }).time), f2(M.trackRun({ mass, mu: M.TRACK.mu }).a)]),
    `${f2(M.trackRun({ mass: 100 }).speed)} m/s`, `${(0.5 * 100 * M.G).toFixed(0)} N`,
    `${f2(M.coasterRun().bottomSpeed)} m/s`, `${f2(M.coasterRun().climb)} m`,
    `${f2(M.coasterRun({ mu: 0.05 }).bottomSpeed)} m/s`, `${f2(M.coasterRun({ mu: 0.05 }).climb)} m`,
    `${f2(M.coasterRun({ mu: 0.1 }).bottomSpeed)} m/s`, `${f2(M.coasterRun({ mu: 0.1 }).climb)} m`,
    `${f2(M.coasterRun({ height: 10 }).bottomSpeed)} m/s`, `${f2(M.coasterRun({ height: 10 }).climb)} m`,
    M.coasterRun().total.toLocaleString('en-US'), M.coasterRun({ mass: 1000 }).total.toLocaleString('en-US'),
    `${M.bumperFormula().before} kg m/s`, `${Math.abs(M.bumperFormula().v1).toFixed(2)} m/s`, `${f2(M.bumperFormula().v2)} m/s`,
    `${f2(M.bumperFormula({ e: 0 }).v1)} m/s`, `${M.bumperFormula().keBefore.toLocaleString('en-US')} J`, `${M.bumperFormula({ e: 0 }).keAfter.toFixed(0)} J`,
    `${f2(M.pendulumFormula())} s`, `${f2(M.pendulumRun().period)} s`, `${f2(M.pendulumRun({ angle: 5 }).period)} s`,
    `${f2(M.pendulumRun({ angle: 60 }).period)} s`, `${f2(M.pendulumRun({ length: 6 }).period)} s`, `${f2(M.pendulumFormula({ length: 6 }))} s`,
    `${lean(6)}°`, `${lean(5)}°`, `${lean(8).replace('.0', '')}°`,
  ];
  for (const figure of required) check(text.includes(figure), `card states ${figure}`);
  // The period below which a 14 m chain simply hangs.
  const hang = 2 * Math.PI * Math.sqrt(M.SWING.length / M.G);
  check(text.includes(`about ${hang.toFixed(1)} s`), 'card states when the chains stop leaning', hang.toFixed(1));
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

// [builder, options, baseline]. Raise a baseline ONLY after looking at the prop and confirming the
// change is a printed plane, not a visible hole. Every non-zero entry here is the rim of a printed
// face lying on a solid: 4 edges for a rectangle, and 64 for the bumper arena's round floor.
const CASES = [
  ['rulerWall', {}, 4], ['dropTower', {}, 4], ['dropCar', {}, 0], ['dropPost', {}, 0],
  ['cannonBase', {}, 0], ['cannonBarrel', {}, 0], ['testBall', {}, 0], ['rangeDeck', {}, 4],
  ['testTrack', {}, 4], ['testCart', {}, 4], ['coasterTrack', {}, 0], ['coasterPod', {}, 0],
  ['energyFrame', {}, 4], ['energyBar', {}, 0], ['bumperArena', {}, 64], ['bumperCar', {}, 8],
  ['scoreboard', {}, 4], ['pendulumFrame', {}, 0], ['pendulumArm', {}, 0], ['swingTower', {}, 0],
  ['swingHub', {}, 0], ['swingChair', {}, 0], ['ferrisFrame', {}, 0], ['ferrisWheel', {}, 0],
  ['fairTent', {}, 0], ['bunting', {}, 0], ['midwayPath', {}, 4],
];
console.log('\nprop                 meshes     tris   open  baseline');
for (const [name, opts, baseline] of CASES) {
  const obj = Props[name](opts);
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

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
