// The Hall of Light's numbers: every bench's geometry, every refractive index, and the exact answer
// for every beam. Pure arithmetic, no three.js, so the layout, the programs, the boards, the lesson
// cards and tools/check-hall-of-light.mjs all read the one table (the CONSTELLATIONS rule).
//
// A BENCH is a tall black board standing upright like a giant ray diagram. Its coordinates are
// (u, y): u along the board, 0 at its centre, increasing to the right of a student facing it; y is
// height above the ground. Every beam travels in that vertical plane, RAY_Z in front of the board.
//
// Each beam is a program. It keeps its own position in two variables, x (along) and y (up), measured
// from where it started, and is TOLD where the surfaces are. That is the honest version: a program
// cannot see the glass, so the green blocks at the top of each one say where it is.
//
// The tracers here step exactly as the programs do (a straight segment, cut into `steps` equal moves),
// so the program and the model agree to rounding, and the check tool holds them to that.

export const RAD = Math.PI / 180;
const sind = (a) => Math.sin(a * RAD);
const cosd = (a) => Math.cos(a * RAD);
const tand = (a) => Math.tan(a * RAD);
const asind = (t) => Math.asin(t) / RAD;
const atand = (t) => Math.atan(t) / RAD;

// Refractive indices, for yellow light (the sodium D line, 589 nm) unless a colour says otherwise.
// Water, acrylic (PMMA), crown glass and diamond are the values every school table uses.
export const INDEX = {
  air: 1,
  water: 1.333,
  acrylic: 1.49,
  glass: 1.52,
  diamond: 2.417,
};

// The prism is DENSE FLINT GLASS (Schott SF11), because in ordinary crown glass red and violet come
// out only 1.4 degrees apart, which over a few feet is narrower than the 3-inch marker line. SF11's
// Sellmeier coefficients reproduce its published n_d = 1.78472 at 587.6 nm and n_C = 1.77596 at
// 656.3 nm (refractiveindex.info, Schott data sheet).
const SF11 = { B: [1.73759695, 0.313747346, 1.89878101], C: [0.013188707, 0.0623068142, 155.23629] };
export function flintIndex(nm) {
  const L = (nm / 1000) ** 2;
  return Math.sqrt(1 + SF11.B.reduce((sum, b, i) => sum + (b * L) / (L - SF11.C[i]), 0));
}

// Six colours, each a real wavelength. `n` is rounded to three places, which is what the program's
// green block carries, and the tracer uses the same rounded number so the two agree exactly.
export const SPECTRUM = [
  { name: 'red', nm: 690, hex: '#e8372c' },
  { name: 'orange', nm: 615, hex: '#f2861c' },
  { name: 'yellow', nm: 580, hex: '#f4d21f' },
  { name: 'green', nm: 530, hex: '#2fb44a' },
  { name: 'blue', nm: 470, hex: '#2c74e6' },
  { name: 'violet', nm: 405, hex: '#8b45e0' },
].map((c) => ({ ...c, n: Math.round(flintIndex(c.nm) * 1000) / 1000 }));

export const CRITICAL = Object.fromEntries(
  ['water', 'acrylic', 'glass', 'diamond'].map((k) => [k, asind(1 / INDEX[k])]),
);

// Equal moves a segment is cut into, so the light can be watched travelling and still lands EXACTLY
// on the surface (a fixed step would overshoot by up to a step: Newton's Midway's drop tower did).
export const STEPS = 30;

// Light is slowed down, and the boards say by how much. A 30 ft beam takes about 3 seconds to draw;
// real light crosses 30 ft (9.14 m) in about 30 nanoseconds.
export const LIGHT = {
  metresPerSecond: 299792458,
  hallFeet: 30,
  get hallNanoseconds() { return (this.hallFeet * 0.3048) / this.metresPerSecond * 1e9; },
  slowdown: 1e8,
  waterSpeedKmPerS() { return this.metresPerSecond / INDEX.water / 1000; },
};

export const BENCH = {
  width: 28,
  height: 11,
  lift: 0.35, // the board's bottom edge above the ground
  thick: 0.5,
  rayZ: 0.95, // where the beams travel, in front of the board's face
};

// ---------------------------------------------------------------------------
// A segment, stepped the way the programs step it
// ---------------------------------------------------------------------------

function segment(from, angle, dist) {
  return [from[0] + dist * cosd(angle), from[1] + dist * sind(angle)];
}

// --- 1. The Mirror -----------------------------------------------------------
// A laser aimed down at a mirror lying flat. Angle in = angle out, so the beam bounces up to a screen.
export const MIRROR = {
  laser: [-12.5, 5.4],
  angle: -25,
  mirrorY: 1.6,
  mirrorFrom: -11.5,
  mirrorTo: 7,
  screenU: 9, // the screen's near face
  screenTop: 10.6,
  boardTop: 11.0,
  tries: [-15, -20, -25, -30, -35],
};

export function mirrorTrace({ angle = MIRROR.angle } = {}) {
  const m = MIRROR;
  const below = m.mirrorY - m.laser[1];
  const p0 = m.laser;
  const d1 = below / sind(angle);
  const hit = segment(p0, angle, d1);
  const out = -angle;
  const toScreen = (m.screenU - hit[0]) / cosd(out);
  const toTop = (m.boardTop - hit[1]) / sind(out);
  const d2 = Math.min(toScreen, toTop);
  const end = segment(hit, out, d2);
  return {
    points: [p0, hit, end],
    hit,
    end,
    height: end[1],
    onMirror: hit[0] >= m.mirrorFrom && hit[0] <= m.mirrorTo,
    onScreen: toScreen <= toTop && end[1] <= m.screenTop,
    incidence: 90 + angle, // from the normal
  };
}

// --- 2. The Periscope --------------------------------------------------------
// Two mirrors at 45 degrees. A mirror at angle m sends a beam at angle a off at 2m - a. The laser is
// beyond a wall, high up; the eye is low behind it, the way a periscope is used from a trench.
export const PERISCOPE = {
  laser: [-13, 7.3],
  ahead: 4,
  drop: 5.0,
  out: 8,
  mirror: -45,
  wall: [-11.6, -10.2, 6.1], // from u, to u, height
  // The second, empty periscope on the right half, for the student to program.
  studentShift: 14,
};

export function periscopeTrace({ shift = 0 } = {}) {
  const p = PERISCOPE;
  const p0 = [p.laser[0] + shift, p.laser[1]];
  const a = segment(p0, 0, p.ahead);
  const b = segment(a, 2 * p.mirror, p.drop);
  const c = segment(b, 2 * p.mirror - 2 * p.mirror, p.out);
  return { points: [p0, a, b, c], mirrors: [a, b], eye: c };
}

// --- 3. The Water Tank -------------------------------------------------------
// Snell's law at a flat surface: n1 sin i = n2 sin r, with i and r measured from the normal.
export const TANK = {
  laser: [-12.5, 8.6],
  aim: -40,
  surfaceY: 4.2,
  floorY: 0.9,
  from: -10,
  to: 10.5,
  n: INDEX.water,
  tries: { aim: [-30, -40, -50, -60], n: [1, 1.333, 1.49, 2.417] },
};

export function tankTrace({ aim = TANK.aim, n = TANK.n } = {}) {
  const t = TANK;
  const p0 = t.laser;
  const hit = segment(p0, aim, (t.surfaceY - p0[1]) / sind(aim));
  const i = 90 + aim;
  const r = asind(sind(i) / n);
  const bent = r - 90;
  const floor = segment(hit, bent, (t.floorY - hit[1]) / sind(bent));
  // Where the eye thinks the light came from: the in-air line carried straight on.
  const spear = segment(hit, aim, (t.floorY - hit[1]) / sind(aim));
  return { points: [p0, hit, floor], hit, floor, spear, i, r, bent, inTank: floor[0] <= t.to && hit[0] >= t.from };
}

// --- 4. The Light Pipe -------------------------------------------------------
// Left half: a glass block whose beam meets the top face at angle i. Past the critical angle,
// n sin i is more than 1 and asin has no answer: the light cannot get out and reflects instead.
export const BLOCK = {
  start: [-11.5, 2.4],
  top: 5.2,
  bottom: 2.0,
  from: -13.5,
  to: -1.0,
  i: 30,
  n: INDEX.glass,
  out: 2.5,
  tries: [20, 30, 40, 45, 60, 70],
};

// `fixed` is the program after the activity: reflect when there is no answer.
export function blockTrace({ i = BLOCK.i, n = BLOCK.n, fixed = true } = {}) {
  const b = BLOCK;
  const p0 = b.start;
  const up = 90 - i;
  const hit = segment(p0, up, (b.top - p0[1]) / sind(up));
  const t = n * sind(i);
  let angle;
  let escaped;
  if (t <= 1) {
    angle = 90 - asind(t);
    escaped = true;
  } else if (fixed) {
    angle = i - 90;
    escaped = false;
  } else {
    // asin of more than 1 has no answer; the runner uses 0, so the beam goes straight up.
    angle = 90;
    escaped = true;
  }
  const end = segment(hit, angle, b.out);
  return { points: [p0, hit, end], hit, end, t, escaped, noAnswer: t > 1, angle };
}

// Right half: a long acrylic rod. The beam bounces off the walls all the way along, every bounce a
// total internal reflection. Tip it past the critical angle and it leaks at the first wall.
export const FIBRE = {
  start: [0.8, 4.0],
  half: 0.55,
  length: 12.4,
  angle: 18,
  n: INDEX.acrylic,
  steps: 12,
  leakOut: 3,
  tries: [0, 10, 18, 30, 50],
};

export function fibreTrace({ angle = FIBRE.angle } = {}) {
  const f = FIBRE;
  const pts = [[0, 0]];
  let x = 0;
  let y = 0;
  let a = angle;
  let bounces = 0;
  let leaked = false;
  for (let guard = 0; guard < 200; guard++) {
    let dist = (f.length - x) / cosd(a);
    if (sind(a) > 0) dist = Math.min(dist, (f.half - y) / sind(a));
    if (sind(a) < 0) dist = Math.min(dist, (-f.half - y) / sind(a));
    x += dist * cosd(a);
    y += dist * sind(a);
    pts.push([x, y]);
    if (x >= f.length - 0.001) break;
    const i = 90 - Math.abs(a);
    const t = f.n * sind(i);
    if (t > 1) {
      a = -a;
      bounces++;
    } else {
      const r = asind(t);
      a = sind(a) > 0 ? 90 - r : r - 90;
      x += f.leakOut * cosd(a);
      y += f.leakOut * sind(a);
      pts.push([x, y]);
      leaked = true;
      break;
    }
  }
  return {
    points: pts.map(([px, py]) => [f.start[0] + px, f.start[1] + py]),
    relative: pts,
    bounces,
    leaked,
  };
}

// --- 5. The Prism ------------------------------------------------------------
// An equilateral prism of dense flint, apex up. Every colour enters the same way and bends by its
// own n, so one white beam leaves as six.
export const PRISM = {
  side: 4.6,
  baseY: 6.6,
  laserU: -8.5,
  screenU: 9.5, // the screen's near face
  intoNormal: -30, // the inward normal of the left face, in degrees from horizontal
  outNormal: 30, // the outward normal of the right face
};

export const prismCorners = () => {
  const p = PRISM;
  const h = (p.side * Math.sqrt(3)) / 2;
  return { left: [-p.side / 2, p.baseY], right: [p.side / 2, p.baseY], apex: [0, p.baseY + h] };
};

// The white beam is aimed for the middle colour's minimum deviation: inside the glass it runs
// parallel to the base, which is the symmetrical path every textbook prism diagram draws.
export function prismAim() {
  const mid = SPECTRUM[2].n;
  return Math.round((asind(mid * sind(30)) + PRISM.intoNormal) * 100) / 100;
}

export function prismEntry() {
  const { left, apex } = prismCorners();
  return [(left[0] + apex[0]) / 2, (left[1] + apex[1]) / 2];
}

export function prismLaser() {
  const entry = prismEntry();
  const a = prismAim();
  const dist = (entry[0] - PRISM.laserU) / cosd(a);
  return { start: [PRISM.laserU, entry[1] - dist * sind(a)], angle: a, dist: Math.round(dist * 1000) / 1000 };
}

// How far the right face is from the entry point, measured along its normal.
export function prismReach() {
  const e = prismEntry();
  const { apex } = prismCorners();
  return (apex[0] - e[0]) * cosd(PRISM.outNormal) + (apex[1] - e[1]) * sind(PRISM.outNormal);
}

export function prismTrace(n, { angle = prismAim(), reach = round3(prismReach()), screen = round3(PRISM.screenU - prismEntry()[0]) } = {}) {
  const p = PRISM;
  const e = prismEntry();
  const r1 = asind(sind(angle - p.intoNormal) / n);
  const a1 = p.intoNormal + r1;
  const d1 = reach / cosd(a1 - p.outNormal);
  const exit = segment(e, a1, d1);
  const r2 = asind(n * sind(a1 - p.outNormal));
  const a2 = p.outNormal + r2;
  const gap = e[0] + screen - exit[0];
  const end = segment(exit, a2, gap / cosd(a2));
  return { points: [e, exit, end], exit, end, inside: a1, out: a2, deviation: angle - a2 };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

// --- 6. The Lens -------------------------------------------------------------
// The thin-lens rule: a ray crossing the lens at height h turns so that tan(out) = tan(in) - h / f.
// Every ray parallel to the axis therefore crosses it at the same point, f past the lens.
export const LENS = {
  u: 0,
  axisY: 5.4,
  start: -13,
  screenU: 11,
  f: 6,
  heights: [1.6, 0.8, 0, -0.8, -1.6],
  colors: ['#e8372c', '#f4d21f', '#ffffff', '#2fb44a', '#2c74e6'],
  tries: [3, 4, 6, 9, 12],
};

export function lensTrace(h, { f = LENS.f } = {}) {
  const l = LENS;
  const p0 = [l.start, l.axisY + h];
  const at = [l.u, l.axisY + h];
  const angle = atand(tand(0) - h / f);
  const end = segment(at, angle, (l.screenU - l.u) / cosd(angle));
  return { points: [p0, at, end], angle, end };
}

// Where a ray crossing the lens at height h meets the axis: f past the lens, whatever h is.
export const lensCrossing = (h, f = LENS.f) => {
  const a = atand(-h / f);
  return LENS.u + (-h) / tand(a);
};
