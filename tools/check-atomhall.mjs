// Regression check for Atom Hall (src/props/AtomProps.js, AtomModel.js, AtomPrograms.js and the
// lesson cards at EdusimWorldDatabase/lib/lessons/atom-hall.html).
//
//   node tools/check-atomhall.mjs
//
// A wrong number in a chemistry lesson is the failure this world cannot afford, so:
//
//  1. THE DATA is held to the chemistry: the trends run the way the placards say, every molecule's
//     formula and bond counts add up, and the geometry matches the angle printed beside it.
//  2. EVERY PROGRAM IS ACTUALLY RUN through the real block runner, as a chain: the thermostat shares
//     into the thermometer, the thermometer into a particle. Particles are held inside the glass
//     at every state, and speed is measured off the path they really travel.
//  3. THE SKYLINE is ticked on the numbers the buttons share, and its towers measured.
//  4. NOTHING IN THE WORLD OR ON THE CARDS IS JAVASCRIPT. This world is blocks only, on purpose.
//  5. THE LESSON CARDS ARE STATIC HTML, so every figure a student or teacher reads is generated here
//     from the model and looked for in the page's text.
//  6. Open edges per builder against a recorded baseline.
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeRect() {},
  quadraticCurveTo() {}, bezierCurveTo() {}, arcTo() {}, roundRect() {},
  measureText: (t) => ({ width: String(t).length * 9 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0, style: {} }) };

const Props = await import('../src/props/AtomProps.js');
const M = await import('../src/props/AtomModel.js');
const P = await import('../src/props/AtomPrograms.js');
const { runBlocks } = await import('./lib/run-blocks.mjs');
const { buildProp } = await import('../src/props/index.js');
const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
const el = M.elementBySymbol;

// ---------------------------------------------------------------------------
// 1. The data
// ---------------------------------------------------------------------------
console.log('\nThe table');
check(M.ELEMENTS.length === 118, 'all 118 elements');
check(M.ELEMENTS.every((e, i) => e.z === i + 1), 'in atomic-number order');
{
  const cells = new Set(M.ELEMENTS.map((e) => `${e.column},${e.row}`));
  check(cells.size === 118, 'no two elements share a cell');
  check(M.ELEMENTS.every((e) => M.FAMILIES[e.family]), 'every family has a colour');
  const falling = (symbols, key) => symbols.every((s, i) => i === 0 || el(s)[key] < el(symbols[i - 1])[key]);
  check(falling(['Fr', 'Cs', 'Rb', 'K', 'Na', 'Li'], 'radius'), 'radius grows down column 1');
  check(falling(['I', 'Br', 'Cl', 'F'], 'radius'), 'radius grows down the halogens');
  check(falling(['Li', 'Be', 'B', 'C', 'N', 'O', 'F'], 'radius'), 'radius shrinks across period 2');
  check(falling(['Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl'], 'radius'), 'radius shrinks across period 3');
  check(falling(['F', 'O', 'N', 'C', 'B', 'Be', 'Li'], 'en'), 'electronegativity falls leftward across period 2');
  check(falling(['F', 'Cl', 'Br', 'I'], 'en'), 'electronegativity falls down the halogens');
  const withRadius = M.ELEMENTS.filter((e) => e.radius != null);
  const withEn = M.ELEMENTS.filter((e) => e.en != null);
  check(withRadius.every((e) => e.radius <= el('Fr').radius), 'francium is the largest', `${el('Fr').radius} pm`);
  check(withRadius.every((e) => e.radius >= el('He').radius), 'helium is the smallest', `${el('He').radius} pm`);
  check(withEn.every((e) => e.en <= el('F').en), 'fluorine is the most electronegative', String(el('F').en));
  check(['He', 'Ne', 'Ar', 'Rn'].every((s) => el(s).en == null), 'He, Ne, Ar and Rn have no electronegativity');
  check(M.ELEMENTS.filter((e) => e.z > 96).every((e) => e.radius == null && e.en == null), 'nothing past curium is used');
  check(el('Zr').radius === el('Hf').radius, 'zirconium and hafnium are the odd pair the guide sends students to');
  // A shopfront is 5.2ft tall. A real value below that would vanish inside its own plinth.
  const heights = M.ELEMENTS.flatMap((e) => [M.towerHeight(e, M.TREND_RADIUS), M.towerHeight(e, M.TREND_EN)]).filter((h) => h != null);
  check(Math.min(...heights) > 5.2, 'every real value stands taller than its shopfront', `${Math.min(...heights).toFixed(1)} ft`);
  check(Math.max(...heights) < 66, 'every real value fits inside a built tower', `${Math.max(...heights).toFixed(1)} ft`);
}

console.log('\nThe molecules');
{
  const VALENCE = { H: 1, C: 4, N: 3, O: 2 };
  const formula = (m) => {
    const count = {};
    for (const [element] of m.atoms) count[element] = (count[element] || 0) + 1;
    return count;
  };
  const expected = {
    water: { H: 2, O: 1 }, carbonDioxide: { C: 1, O: 2 }, methane: { C: 1, H: 4 }, ammonia: { N: 1, H: 3 },
    ethanol: { C: 2, H: 6, O: 1 }, benzene: { C: 6, H: 6 }, caffeine: { C: 8, H: 10, N: 4, O: 2 },
  };
  for (const [kind, want] of Object.entries(expected)) {
    const m = M.MOLECULES[kind];
    check(JSON.stringify(formula(m)) === JSON.stringify(Object.fromEntries(Object.keys(formula(m)).map((k) => [k, want[k]]))), `${kind} has the right atoms`, m.formula);
    const bondSum = m.atoms.map(() => 0);
    for (const [a, b, order] of m.bonds) { bondSum[a] += order; bondSum[b] += order; }
    check(m.atoms.every(([element], i) => near(bondSum[i], VALENCE[element])), `${kind}: every atom has its proper number of bonds`);
  }
  const { water, ammonia, methane, carbonDioxide, benzene } = M.MOLECULES;
  check(near(M.angleAt(water, 1, 0, 2), 104.5), 'water is 104.5 degrees');
  check(near(M.angleAt(ammonia, 1, 0, 2), 106.7), 'ammonia is 106.7 degrees');
  check(near(M.angleAt(methane, 1, 0, 2), 109.47, 0.01), 'methane is 109.5 degrees');
  check(near(M.angleAt(carbonDioxide, 1, 0, 2), 180), 'carbon dioxide is straight');
  check(near(M.bondLength(water, 0, 1), 0.958), 'an O-H bond is 0.096 nm', '0.958 A');
  {
    const ring = benzene.bonds.filter(([, , order]) => order === 1.5).map(([a, b]) => M.bondLength(benzene, a, b));
    check(ring.length === 6 && ring.every((d) => near(d, 1.39, 0.012)), "benzene's six ring bonds are all 0.139 nm", ring.map((d) => d.toFixed(3)).join(' '));
  }
  check(Object.values(M.MOLECULES).every((m) => m.atoms.every(([e]) => M.ATOM_STYLE[e])), 'every atom has a colour');
}

console.log('\nThe salt crystal');
{
  const sum = M.SALT.naRadius + M.SALT.clRadius;
  check(near(sum, M.SALT.spacingAngstroms, 0.02), 'in the packed half the ions touch at their true sizes', `${sum.toFixed(2)} vs ${M.SALT.spacingAngstroms} A`);
  check(near(M.SALT.spacingAngstroms * 2, M.SALT.a), 'the spacing is half the unit cell');
  check(M.SALT.clRadius * M.SALT_SCALE * 2 < M.SALT.spacing * Math.SQRT2, 'chlorides do not pass through one another');
  check(M.SALT.spacing > 5, 'a student fits between ions in the open half', `${M.SALT.spacing} ft`);
}

// ---------------------------------------------------------------------------
// 2. The programs, run as the chain they are in the world
// ---------------------------------------------------------------------------
console.log('\nThe tank');
const STATE_NAME = { [M.SOLID]: 'solid', [M.LIQUID]: 'liquid', [M.GAS]: 'gas' };

function reading(temperature, opts = {}) {
  const worldVars = new Map();
  const therm = runBlocks(P.thermostatProgram({ temperature, ...opts }), { worldVars });
  const gauge = runBlocks(P.thermometerProgram(), {
    worldVars,
    maxSteps: 400,
    stopWhen: (log) => log.says.length >= 1,
  });
  return { worldVars, said: gauge.log.says[0], therm, gauge };
}

for (const t of [100, 250, 272, 273, 300, 372, 373, 400, 900]) {
  const { worldVars, said, gauge, therm } = reading(t);
  const speed = M.particleSpeed(t);
  const state = M.stateAt(t);
  check(worldVars.get('state') === state, `${t} K is ${STATE_NAME[state]}`);
  check(near(worldVars.get('speed'), speed), `${t} K moves at the model's speed`, speed.toFixed(2));
  check(said === `${t} K: ${STATE_NAME[state]}. Speed ${speed.toFixed(2)} ft per step.`, `${t} K: the thermometer says it`, said);
  check(!gauge.log.problems.length && !therm.log.problems.length, `${t} K: no warnings`);
  const column = gauge.object3D.position.y;
  check(near(column, (Math.min(t, M.GAUGE.topKelvin) / M.GAUGE.topKelvin) * M.GAUGE.full), `${t} K: the column reads it`, `${column.toFixed(2)} ft`);
}
{
  check(near(M.particleSpeed(400) / M.particleSpeed(100), 2), '4 times hotter is 2 times faster');
  check(near(M.particleSpeed(900) / M.particleSpeed(100), 3), '9 times hotter is 3 times faster');
  const zero = reading(0);
  check(zero.worldVars.get('speed') === 0 && zero.worldVars.get('state') === M.SOLID, 'at 0 K everything stops');
  const below = reading(-50);
  check(below.worldVars.get('temperature') === 0, 'below 0 K the thermostat uses 0');
  check(below.therm.log.says.some((s) => s.includes('colder than 0 K')), 'and says so', below.therm.log.says[0]);
  check(!below.gauge.log.problems.length, 'and nothing has no answer');
  const hot = reading(5000);
  check(near(hot.gauge.object3D.position.y, M.GAUGE.full), 'the column stops at the top of its scale');
  for (const substance of M.SUBSTANCES) {
    const r = reading(300, { melts: substance.melts, boils: substance.boils });
    check(r.worldVars.get('state') === M.stateAt(300, substance), `${substance.name} at 300 K is ${STATE_NAME[r.worldVars.get('state')]}`);
  }
}

// One particle, run against the values the thermometer shares.
function fly(kelvin, home, steps = 12000, change = null) {
  const worldVars = new Map([['speed', M.particleSpeed(kelvin)], ['state', M.stateAt(kelvin)]]);
  const object3D = new THREE.Object3D();
  const run = runBlocks(P.particleProgram(M.particleWalls(home)), {
    object3D,
    worldVars,
    maxSteps: steps,
    stopWhen: change ? (log) => change(log, worldVars) : null,
  });
  return { path: run.log.path, log: run.log, worldVars };
}
{
  const homes = M.particleHomes();
  check(homes.length === 24, '24 particles in the crystal');
  const reach = M.TANK.width / 2;
  for (const home of [homes[0], homes[11], homes[23]]) {
    const inside = (path, top, speed) => path.every((p) => {
      const x = home.x + p.z; // a particle's forward, its +Z, is laid along the tank's width
      const y = home.y + p.y;
      return Math.abs(x) <= reach - M.WALL_MARGIN + speed * 1.5 && y >= M.LATTICE.inset - speed * 1.5 && y <= top + speed * 1.5;
    });
    const liquid = fly(300, home);
    check(inside(liquid.path, M.TANK.surface, M.particleSpeed(300)), 'a liquid particle stays under the surface');
    const gas = fly(900, home);
    check(inside(gas.path, M.TANK.height - M.WALL_MARGIN, M.particleSpeed(900)), 'a gas particle stays in the glass');
    check(Math.max(...gas.path.map((p) => home.y + p.y)) > M.TANK.surface + 1, 'and gets above where the liquid stopped');
    check(!liquid.log.problems.length && !gas.log.problems.length, 'with no warnings');
    const solid = fly(250, home, 4000);
    const worst = Math.max(...solid.path.map((p) => Math.hypot(p.z, p.y)));
    check(worst < M.LATTICE.spacing / 2, 'a solid particle only shakes round its home', `${worst.toFixed(2)} ft`);
  }
  {
    // Speed is measured off the path it really travels: two yields a pass, the move and `forever`.
    const { path } = fly(400, homes[5], 2000);
    const steps = [];
    for (let i = 1; i < path.length; i++) {
      const d = path[i].distanceTo(path[i - 1]);
      if (d > 0) steps.push(d);
    }
    check(steps.length > 500 && steps.every((d) => near(d, M.particleSpeed(400), 1e-9)), 'each move is exactly the shared speed', `${steps[0].toFixed(3)} ft`);
  }
  {
    // Freezing must rebuild the crystal, however far a gas particle had gone.
    let flipped = false;
    const { path } = fly(900, homes[3], 9000, (log, vars) => {
      if (!flipped && log.steps > 4000) {
        flipped = true;
        vars.set('speed', M.particleSpeed(100));
        vars.set('state', M.SOLID);
      }
      return false;
    });
    const end = path.at(-1);
    check(Math.hypot(end.z, end.y) < M.LATTICE.spacing / 2, 'a gas cooled to a solid goes back to its place', `${Math.hypot(end.z, end.y).toFixed(2)} ft from home`);
  }
  {
    // Activity 4, exactly as its board says it. "Every sequence on these boards has been run."
    const worldVars = new Map();
    runBlocks(P.thermostatProgram(), { worldVars });
    const { until, setv, change, share, wait } = await import('../src/BlockKit.js');
    const heater = runBlocks([
      setv('temperature', 200),
      until('temperature', '>=', 500,
        change('temperature', 1),
        share('temperature'),
        wait(0.05)),
    ], { worldVars });
    check(worldVars.get('temperature') === 500 && !heater.log.problems.length, 'the heater on the board climbs to 500 K', String(worldVars.get('temperature')));
    runBlocks(P.thermostatProgram(), { worldVars });
    check(worldVars.get('temperature') === M.THERMOSTAT.temperature, "the thermostat's green arrow takes it back");
  }
  {
    const worldVars = new Map();
    const a = runBlocks(P.radiusButton(), { worldVars });
    check(worldVars.get('trend') === M.TREND_RADIUS && a.log.says.length === 1, 'the radius button shares its trend');
    const b = runBlocks(P.electronegativityButton(), { worldVars });
    check(worldVars.get('trend') === M.TREND_EN && b.log.says.length === 1, 'the electronegativity button shares its trend');
  }
}

// ---------------------------------------------------------------------------
// 3. The skyline, ticked on what the buttons share
// ---------------------------------------------------------------------------
console.log('\nThe skyline');
{
  const city = Props.skyline();
  const tick = city.userData.tick;
  const top = () => {
    const array = city.children[0].geometry.attributes.position.array;
    let max = -Infinity;
    for (let i = 1; i < array.length; i += 3) if (array[i] > max) max = array[i];
    return max;
  };
  const settle = (vars) => { for (let i = 0; i < 1200; i++) tick.update(1 / 60, null, vars); };
  check(near(top(), M.towerHeight(el('Fr'), M.TREND_RADIUS)), 'it opens on atomic radius', `${top().toFixed(1)} ft`);
  const version = city.children[0].geometry.attributes.position.version;
  settle(new Map());
  check(city.children[0].geometry.attributes.position.version === version, 'a still city uploads no vertices');
  settle(new Map([['trend', M.TREND_EN]]));
  check(near(top(), M.towerHeight(el('F'), M.TREND_EN), 0.03), 'a shared trend of 2 makes it electronegativity', `${top().toFixed(1)} ft`);
  settle(new Map([['trend', M.TREND_RADIUS]]));
  check(near(top(), M.towerHeight(el('Fr'), M.TREND_RADIUS), 0.03), 'and 1 brings it back', `${top().toFixed(1)} ft`);
  settle(undefined);
  check(near(top(), M.towerHeight(el('Fr'), M.TREND_RADIUS), 0.03), 'with no shared value it stays on radius');
  let meshes = 0;
  city.traverse((o) => { if (o.isMesh) meshes++; });
  check(meshes === 4, 'the whole table is four meshes', String(meshes));
  check(city.children[0].geometry.attributes.position.usage === THREE.DynamicDrawUsage, 'the HiFi bridge can see its buffer is dynamic');
}

// ---------------------------------------------------------------------------
// 4. The world
// ---------------------------------------------------------------------------
console.log('\nThe world builds');
const built = buildPresetWorldRecords('atomhall', { groundHeightAt: () => 0 });
const records = built.records;
const props = records.filter((r) => r.kind === 'preset-prop');
check(records.every((r) => !r.programJs && r.programMode !== 'js'), 'no record in this world carries JavaScript');
{
  const order = (prop) => records.findIndex((r) => r.prop === prop && r.program?.length);
  check(order('ah-thermostat') < order('ah-thermometer-column'), 'the thermostat shares before the thermometer reads');
  check(order('ah-thermometer-column') < order('ah-particle'), 'the thermometer shares before the particles read');
  const buttons = records.filter((r) => r.prop === 'ah-trend-button');
  check(buttons.length === 4 && buttons.every((r) => r.programIdle && r.program?.length), 'the buttons wait for their green arrow');
  check(records.filter((r) => r.prop === 'ah-particle').every((r) => r.programQuiet && !r.programIdle && r.program?.length), 'the particles run, with no green arrow');
  const burner = records.find((r) => r.prop === 'ah-burner');
  check(burner && !burner.program?.length, 'the burner has no program: writing one is the challenge');
  check(records.filter((r) => r.prop === 'ah-molecule').length === 7, 'seven molecules');
  check(records.filter((r) => r.prop === 'activity-board').length === 4, 'four coding challenges');
  check(records.some((r) => r.kind === 'web-browser' && r.url.includes('atom-hall')), 'the kiosk opens the lesson card');
}
{
  // The floor is the table. Nothing but the table may stand on it, or it is standing in a street.
  const halfX = M.CELL * 9.6;
  const north = M.cellOf({ column: 1, row: 1 }).z - M.CELL;
  const south = M.cellOf({ column: 1, row: 10 }).z + M.CELL * 0.7;
  const inTheCity = records.filter((r) => r.transform && !['ah-hall-ring', 'ah-table-floor', 'ah-skyline'].includes(r.prop)
    && r.kind !== 'world-theme' && r.kind !== 'world-spawn'
    && Math.abs(r.transform.position[0]) < halfX && r.transform.position[2] > north && r.transform.position[2] < south);
  check(inTheCity.length === 0, 'nothing stands in the streets', inTheCity.map((r) => r.prop).join(', '));
  const outside = records.filter((r) => r.transform && r.prop !== 'ah-hall-ring' && Math.hypot(r.transform.position[0], r.transform.position[2]) > 184);
  check(outside.length === 0, 'everything is inside the columns', outside.map((r) => r.prop).join(', '));
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
{
  const seed = new URL('../EdusimWorldDatabase/seed/worlds/atomhall.json', import.meta.url);
  if (existsSync(seed)) {
    const world = JSON.parse(readFileSync(seed, 'utf8'));
    const list = world.records || world.objects || [];
    check(list.length === records.length, 'the seeded world is this world', `${list.length} records`);
    check(list.every((r) => !r.programJs && r.programMode !== 'js'), 'the seeded world carries no JavaScript');
  } else {
    check(false, 'the seeded world has been exported');
  }
}

// ---------------------------------------------------------------------------
// 5. The lesson cards
// ---------------------------------------------------------------------------
console.log('\nThe lesson cards');
{
  const html = readFileSync(new URL('../EdusimWorldDatabase/lib/lessons/atom-hall.html', import.meta.url), 'utf8');
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  check(!/javascript/i.test(text), 'the cards never mention JavaScript');
  check(html.includes('id="lc-student"') && html.includes('id="lc-teacher"'), 'a student guide and a teacher card');
  {
    const student = html.slice(html.indexOf('id="lc-student"'), html.indexOf('id="lc-teacher"'));
    check(!student.includes('class="answers"') && !/\b0\.35\b/.test(student), "the student's copy holds no answers");
    const teacher = html.slice(html.indexOf('id="lc-teacher"'));
    check(teacher.includes('class="answers"') && teacher.includes('class="honest"'), 'the teacher card has the key and the honesty note');
  }
  const f1 = (n) => n.toFixed(1);
  const f2 = (n) => n.toFixed(2);
  const pm = (s) => `${s} ${el(s).radius}`;
  const en = (s) => `${s} ${f2(el(s).en)}`;
  const required = [
    ...['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'B', 'C', 'N', 'O', 'F'].map(pm),
    ...['Li', 'Na', 'K', 'Rb', 'Cs'].map((s) => f1(M.towerHeight(el(s), M.TREND_RADIUS))),
    `${el('Fr').radius} pm`, `${f1(M.towerHeight(el('Fr'), M.TREND_RADIUS))} ft`,
    `${el('Zr').radius} pm`,
    ...['Cs', 'Na', 'H', 'C', 'Cl', 'O', 'F'].map(en),
    `${f1(M.towerHeight(el('F'), M.TREND_EN))} ft`, `${f1(M.towerHeight(el('Cs'), M.TREND_EN))} ft`,
    `C–H ${f2(el('C').en - el('H').en)}`, `O–H ${f2(el('O').en - el('H').en)}`, `Na–Cl ${f2(el('Cl').en - el('Na').en)}`,
    '104.5°', '106.7°', '109.5°', '180°', '0.139 nm',
    `Na+ ${M.SALT.naRadius * 100} pm`, `Cl- ${M.SALT.clRadius * 100} pm`, f2(M.SALT.clRadius / M.SALT.naRadius),
    `${M.SALT.ionsPerEdge ** 3} ions`, `${f1(M.ionsInSaltGrain() / 1e19)} x 10^19`,
    ...[100, 250, 300, 400, 900].map((t) => `${t} K ${['solid', 'liquid', 'gas'][M.stateAt(t) - 1]}, ${t === 100 ? 'speed ' : ''}${f2(M.particleSpeed(t))}`),
    `melts ${M.THERMOSTAT.melts}, boils ${M.THERMOSTAT.boils}`,
    `root × ${M.SPEED_PER_ROOT_KELVIN}`, `${M.GAUGE.topKelvin} K`,
    `${M.RADIUS_PM_PER_FOOT} picometres`, `${M.EN_FEET_PER_UNIT} feet`,
  ];
  for (const figure of required) check(text.includes(figure), `card states ${figure}`);
  for (const s of M.SUBSTANCES) {
    check(html.includes(`<th>${s.name}</th><td>${s.melts}</td><td>${s.boils}</td>`), `the table gives ${s.name} as ${s.melts} and ${s.boils}`);
  }
}

// ---------------------------------------------------------------------------
// 6. Open edges
// ---------------------------------------------------------------------------
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
// change is a printed plane, not a visible hole. Every non-zero entry is a printed face lying on a
// solid (4 edges a rectangle, and the skyline has eight of those per element: a shopfront and a roof
// band on each side) or the two ends of the gold arc, each buried in a ball.
const CASES = [
  ['skyline', {}, 1888], ['tableFloor', {}, 4], ['hallRing', {}, 0], ['trendButton', {}, 4], ['tableMap', {}, 4],
  ['molecule', { kind: 'water' }, 16], ['molecule', { kind: 'carbonDioxide' }, 0], ['molecule', { kind: 'methane' }, 16],
  ['molecule', { kind: 'ammonia' }, 16], ['molecule', { kind: 'ethanol' }, 0], ['molecule', { kind: 'benzene' }, 0],
  ['molecule', { kind: 'caffeine' }, 0], ['saltCrystal', {}, 0], ['tank', {}, 0], ['particle', {}, 0],
  ['thermostat', {}, 4], ['thermometerFrame', {}, 4], ['thermometerColumn', {}, 0], ['burner', {}, 0],
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
  const label = opts.kind ? `${name}:${opts.kind}` : name;
  console.log(`${label.padEnd(24)} ${String(meshCount).padStart(3)} ${String(Math.round(tris)).padStart(8)} ${String(open).padStart(6)} ${String(baseline).padStart(9)}${bad ? '  REGRESSION' : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
