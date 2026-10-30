// Regression check for Small Change (src/props/MoneyProps.js, src/props/MoneyModel.js and the
// lesson card at EdusimWorldDatabase/lib/lessons/small-change.html).
//
//   node tools/check-smallchange.mjs
//
// THREE THINGS, and the first two matter more than the models, because a wrong figure in a
// finance lesson is the failure this world cannot afford:
//
//  1. EVERY PROGRAM IS ACTUALLY RUN, against a stub of the JavaScript runtime, and what it says
//     is compared with what MoneyModel.js computes. This is the "every sequence on these boards
//     has been run" rule made mechanical: the debt program is run at all four payments the
//     board lists, and the emergency program with insured both false and true.
//  2. THE LESSON CARD IS STATIC HTML, so nothing else would notice it drifting. Every figure a
//     student or teacher reads there is generated here from the model and looked for in the
//     page's text.
//  3. Open edges per builder against a recorded baseline, as in tools/check-turkle.mjs. Printed
//     faces and the room are planes: they are supposed to be open, and their baselines say so.
import { readFileSync } from 'node:fs';
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

const M = await import('../src/props/MoneyProps.js');
const Model = await import('../src/props/MoneyModel.js');
const { compileJs, JS_RUNTIME_NAMES } = await import('../src/JsProgram.js');
const { buildProp } = await import('../src/props/index.js');
const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

// ---------------------------------------------------------------------------
// 1. Run the programs
// ---------------------------------------------------------------------------

class Stop extends Error {}

// The runtime with the clock taken out: wait() returns at once, forever() makes `passes` trips
// and then stops the script, and every side effect is logged.
async function runProgram(code, { passes = 1, onHats = null } = {}) {
  const { fn, error } = compileJs(code);
  if (error) throw error;
  const log = { says: [], sizes: [], up: 0, forward: 0, hats: [] };
  const api = {
    moveForward: async (ft) => { log.forward += ft; },
    moveUp: async (ft) => { log.up += ft; },
    glide: async () => {}, rotate: async () => {}, goBackToStart: async () => {},
    wait: async () => {},
    repeat: async (n, body) => { for (let i = 0; i < n; i++) await body(); },
    forever: async (body) => { for (let i = 0; i < passes; i++) await body(); throw new Stop(); },
    whenSaid: (text, body) => { log.hats.push({ text, body }); },
    duplicate: async () => {},
    say: async (text) => { log.says.push(String(text)); },
    changeSize: async () => {},
    setSize: async (p) => { log.sizes.push(p); },
    setOpacity: async () => {}, changeColor: async () => {},
    markerColor: async () => {}, markerDown: async () => {}, markerUp: async () => {}, eraseAllMarks: async () => {},
    moveX: async () => {}, moveY: async () => {}, moveZ: async () => {},
  };
  try {
    await fn(...JS_RUNTIME_NAMES.map((name) => api[name]));
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }
  if (onHats) await onHats(log);
  return log;
}

console.log('\nPrograms');
const P = Model.PROGRAMS;
const money = Model.money;

{
  const pay = Model.paycheck();
  const log = await runProgram(P.paycheck);
  check(log.says.includes(`Take-home pay: $${pay.net.toFixed(2)}`), 'paycheck reaches net pay', log.says.at(-1));
  check(log.says.includes(`FICA takes $${pay.fica.toFixed(2)}`), 'paycheck states FICA', pay.fica.toFixed(2));
  check(Math.abs(log.sizes.at(-1) - (pay.net / pay.gross) * 100) < 1e-6, 'the coin stack ends at net / gross', `${log.sizes.at(-1).toFixed(2)}%`);
}
{
  const { yearly } = Model.subscriptionCost();
  const log = await runProgram(P.subscriptions);
  check(log.says.includes(`Month 12: $${yearly.toFixed(2)}`), 'subscriptions add up to a year', log.says.at(-1));
}
for (const age of [Model.GROW.earlyAge, Model.GROW.lateAge]) {
  const f = Model.growthFactor(Model.GROW.rate, Model.GROW.retireAge - age);
  const log = await runProgram(P.sprout(age));
  check(log.says.includes(`Age 65: $1 is now $${f.toFixed(2)}`), `sprout started at ${age}`, log.says.at(-1));
  check(Math.abs(log.sizes.at(-1) - f * 100) < 1e-6, `sprout ${age} ends at ${f.toFixed(2)}x its size`);
}
{
  const log = await runProgram(P.iceCube);
  const bought = Model.buyingPower();
  check(log.says.some((s) => s.includes(`Year 24: $100 buys $${bought.toFixed(0)} of stuff`)), 'inflation after 24 years', log.says.at(-1));
}
for (const payment of [15, 25, 50]) {
  const code = P.debt.replace('const payment = 15;', `const payment = ${payment};`);
  const expected = Model.payoff({ payment });
  const log = await runProgram(code);
  check(log.says.includes(`Paid off in ${expected.months} months. Total paid: $${expected.paid.toFixed(0)}`),
    `debt at $${payment} a month`, log.says.at(-1));
}
{
  const log = await runProgram(P.debt.replace('const payment = 15;', 'const payment = 10;'));
  check(Model.payoff({ payment: 10 }) === null, 'the model says $10 never pays it off');
  check(log.says.at(-1) === 'Month 60: you still owe $500', '$10 a month is still $500 after five years', log.says.at(-1));
}
{
  const accident = await runProgram(P.accident);
  check(accident.says.includes('accident'), 'the mug says the word the jar listens for');
  const hear = async (code) => {
    const log = await runProgram(code);
    const says = [];
    const hat = log.hats.find((h) => h.text === 'accident');
    check(!!hat, 'the jar has a hat on "accident"');
    // Fire the hat after the main script, on the same stub.
    await runProgram(code, {
      onHats: async (l) => { await l.hats[0].body(); says.push(...l.says); },
    });
    return says;
  };
  const r = Model.insuranceCompare();
  const bare = await hear(P.rainyDay);
  check(bare.includes(`You paid $${Model.RISK.repair}. Left: $${r.leftUninsured}`), 'uninsured accident', bare[0]);
  const covered = await hear(P.rainyDay.replace('const insured = false;', 'const insured = true;'));
  check(covered.includes(`You paid $${Model.RISK.deductible}. Left: $${r.leftInsured}`), 'insured accident', covered[0]);
}
{
  // A market run is random, so what is asserted is what the board claims: the line stays on
  // the paper, and across many runs twenty holdings are steadier and end higher at the median.
  const finals = async (holdings, runs) => {
    const out = [];
    for (let i = 0; i < runs; i++) {
      const log = await runProgram(P.market('#000000', holdings));
      out.push({ value: Number(log.says.at(-1).match(/became \$([\d.]+)/)[1]), forward: log.forward, up: log.up });
    }
    return out.sort((a, b) => a.value - b.value);
  };
  const one = await finals(1, 400);
  const many = await finals(20, 400);
  const median = (a) => a[Math.floor(a.length / 2)].value;
  const spread = (a) => a[Math.floor(a.length * 0.9)].value / a[Math.floor(a.length * 0.1)].value;
  check(Math.abs(one[0].forward - 50) < 1e-6, 'the plot runs exactly 50ft across the sheet', `${one[0].forward}ft`);
  const topFeet = Math.max(...[...one, ...many].map((r) => r.up));
  check(topFeet <= 36, 'no run climbs off the paper', `highest rise ${topFeet.toFixed(1)}ft`);
  check(median(many) > median(one), '20 holdings beat 1 at the median', `$${median(many).toFixed(2)} vs $${median(one).toFixed(2)}`);
  check(spread(many) < spread(one), '20 holdings are steadier', `10th-90th spread x${spread(many).toFixed(1)} vs x${spread(one).toFixed(1)}`);
}
{
  const f = 1.07 ** 10;
  check(Math.abs(f - 2) < 0.04, 'activity 1: ten rounds of 7% about doubles', f.toFixed(3));
}

// ---------------------------------------------------------------------------
// 2. The world builds, and the card says what the model says
// ---------------------------------------------------------------------------

console.log('\nWorld');
const built = buildPresetWorldRecords('smallchange', { groundHeightAt: () => 0 });
const records = built.records;
const props = records.filter((r) => r.kind === 'preset-prop');
check(records.length > 60 && records.length < 120, 'record count', String(records.length));
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
for (const r of records) {
  if (!r.programJs) continue;
  const { error } = compileJs(r.programJs);
  check(!error, `${r.prop} program compiles`, error?.message ?? '');
}

console.log('\nLesson card');
{
  const url = new URL('../EdusimWorldDatabase/lib/lessons/small-change.html', import.meta.url);
  let html = '';
  try { html = readFileSync(url, 'utf8'); } catch { /* reported below */ }
  check(html.length > 0, 'the card exists');
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const pay = Model.paycheck();
  const subs = Model.subscriptionCost();
  const bnpl = Model.buyNowPayLater();
  const plan = Model.budget();
  const early = Model.savedBy({ startAge: 18 });
  const late = Model.savedBy({ startAge: 28 });
  const fees = Model.feeDrag();
  const shortLoan = Model.carLoan(Model.CAR_SHORT);
  const longLoan = Model.carLoan(Model.CAR_LONG);
  const r = Model.insuranceCompare();
  const required = [
    `$${pay.gross.toFixed(2)}`, `$${pay.fica.toFixed(2)}`, `$${pay.net.toFixed(2)}`,
    `$${subs.monthly.toFixed(2)}`, `$${subs.yearly.toFixed(2)}`,
    `$${bnpl.dueEveryTwoWeeks.toFixed(2)}`, `${Math.round(bnpl.shareOfCheck * 100)}%`,
    money(plan.needs), money(plan.wants), money(plan.savings),
    `$${Model.growthFactor(0.07, 47).toFixed(2)}`, `$${Model.growthFactor(0.07, 37).toFixed(2)}`,
    money(early.paidIn), money(early.balance), money(late.paidIn), money(late.balance),
    `$${Model.buyingPower().toFixed(0)}`,
    ...[15, 25, 50].flatMap((payment) => {
      const x = Model.payoff({ payment });
      return [`${x.months} months`, money(x.paid)];
    }),
    money(shortLoan.payment), money(shortLoan.total), money(longLoan.payment), money(longLoan.total),
    `$${r.leftUninsured}`, `$${r.leftInsured}`, money(r.premiumYearly),
    money(fees.noFee), money(fees.withFee), `${Math.round(fees.lostShare * 100)}%`,
  ];
  for (const figure of required) check(text.includes(figure), `card states ${figure}`);
}

// ---------------------------------------------------------------------------
// 3. Open edges
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

// [builder, options, baseline]. Raise a baseline ONLY after looking at the prop and confirming
// the change is a printed plane or a buried rim, not a visible hole. Non-zero entries:
//   * any printed face (phone glass, coin face, card, calculator screen) is a plane on a solid
//   * tube rims buried in something: the sprout's stem in the soil, the balloon's string in its
//     coin and its knot, the mug handle's two ends in the wall
//   * the room is planes by design: nobody can reach them
const CASES = [
  ['kitchenRoom', {}, 28],
  ['coinStack', { dollars: 10 }, 48],
  ['looseCoin', {}, 48],
  ['moneyBill', {}, 0],
  ['payStub', { rows: [] }, 0],
  ['phone', { screen: 'bnpl' }, 4],
  ['phone', { screen: 'scam' }, 4],
  ['longReceipt', { rows: [] }, 0],
  ['moneySprout', {}, 14],
  ['jarLidSoil', {}, 0],
  ['standingRuler', {}, 0],
  ['iceCube', {}, 0],
  ['saucer', {}, 0],
  ['debtBalloon', {}, 12],
  ['bankCard', {}, 4],
  ['carKey', {}, 0],
  ['spilledMug', {}, 28],
  ['rainyDayJar', {}, 8],
  ['jarSavings', {}, 0],
  ['chartPencil', {}, 0],
  ['graphSheet', {}, 0],
  ['calculator', {}, 4],
  ['mailPile', {}, 4],
  ['factBoard', { rows: [] }, 4],
];

console.log('\nprop                 meshes     tris   open  baseline   baseY');
for (const [name, opts, baseline] of CASES) {
  const obj = M[name](opts);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
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
  console.log(`${name.padEnd(20)} ${String(meshCount).padStart(5)} ${String(Math.round(tris)).padStart(8)} ${String(open).padStart(6)} ${String(baseline).padStart(9)} ${box.min.y.toFixed(2).padStart(7)}${bad ? '  REGRESSION' : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
