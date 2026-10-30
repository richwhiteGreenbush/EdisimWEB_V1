// Newton's Midway -- every physics figure in the world, in one place.
//
// The same rule as MoneyModel.js and CONSTELLATIONS: ONE TABLE feeds the boards, the programs
// that ship running, and the check tool, and tools/check-midway.mjs holds the printed lesson card
// to the same numbers, because that page is static HTML and nothing else would notice it drifting.
//
// Pure arithmetic: this file imports nothing and builds no geometry, so it runs in node.
//
// THE SCALE IS 1 WORLD FOOT = 1 METRE, stated on the welcome board and the card, so a student
// types g = 9.8 and reads metres with no conversion in every program. It makes the student a
// five-metre giant, and it is why a 40 m shot fits in one view.
//
// TWO ANSWERS FOR EVERYTHING, and the difference is part of the lesson. The `formula` functions
// are the textbook's. The `run` functions step time exactly as the block programs do, one dt at
// a time, which is what the student actually sees: close to the formula, not equal to it, and
// closer as dt shrinks.

export const G = 9.8;
export const DT = 0.02;
export const MOON_G = 1.62;
export const MARS_G = 3.71;

// One step of semi-implicit Euler is what every program here does: velocity first, then position
// with the new velocity. It is the simplest rule that does not gain energy as it runs.

// --- Station 1: the drop tower ----------------------------------------------
export const DROP = { height: 20 };

export const dropFormula = ({ height = DROP.height, g = G } = {}) => ({
  time: Math.sqrt((2 * height) / g),
  speed: Math.sqrt(2 * g * height),
});

export function dropRun({ height = DROP.height, g = G, dt = DT } = {}) {
  let y = height;
  let v = 0;
  let t = 0;
  while (y > 0) {
    v -= g * dt;
    y += v * dt;
    t += dt;
  }
  return { time: t, speed: -v };
}

// --- Station 2: the cannon --------------------------------------------------
export const CANNON = { speed: 20, angle: 45 };
export const TARGET_RANGE = 30;
const RAD = Math.PI / 180;

export const cannonFormula = ({ speed = CANNON.speed, angle = CANNON.angle, g = G } = {}) => ({
  range: (speed ** 2 * Math.sin(2 * angle * RAD)) / g,
  time: (2 * speed * Math.sin(angle * RAD)) / g,
  top: (speed * Math.sin(angle * RAD)) ** 2 / (2 * g),
});

export function cannonRun({ speed = CANNON.speed, angle = CANNON.angle, g = G, dt = DT } = {}) {
  const vx = speed * Math.cos(angle * RAD);
  let vy = speed * Math.sin(angle * RAD);
  let x = 0;
  let y = 0;
  let t = 0;
  let top = 0;
  do {
    vy -= g * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    top = Math.max(top, y);
  } while (y > 0);
  return { range: x, time: t, top };
}

// The speed that carries a 45 degree shot to the target ring.
export const targetSpeed = (range = TARGET_RANGE, g = G) => Math.sqrt(range * g);

// --- Station 3: the test track ----------------------------------------------
export const TRACK = { length: 40, force: 400, mu: 0.05 };
export const CARTS = [100, 200, 400];

export function trackFormula({ force = TRACK.force, mass, mu = 0, g = G, length = TRACK.length }) {
  const a = (force - mu * mass * g) / mass;
  return { a, time: Math.sqrt((2 * length) / a), speed: Math.sqrt(2 * a * length) };
}

export function trackRun({ force = TRACK.force, mass, mu = 0, g = G, length = TRACK.length, dt = DT }) {
  const a = (force - mu * mass * g) / mass;
  if (a <= 0) return { a, time: null, speed: 0 };
  let x = 0;
  let v = 0;
  let t = 0;
  while (x < length) {
    v += a * dt;
    x += v * dt;
    t += dt;
  }
  return { a, time: t, speed: v };
}

// --- Station 4: the coaster -------------------------------------------------
export const COASTER = { height: 15, slope: 30, mass: 500, mu: 0 };

export const coasterSlopeLength = ({ height = COASTER.height, slope = COASTER.slope } = {}) => height / Math.sin(slope * RAD);

// Energy bookkeeping, per kilogram times nothing: joules for the car's mass.
export function coasterFormula({ height = COASTER.height, slope = COASTER.slope, mass = COASTER.mass, mu = COASTER.mu, g = G } = {}) {
  const total = mass * g * height;
  const down = coasterSlopeLength({ height, slope });
  const lostOnWay = mu * Math.cos(slope * RAD) * down * mass * g;
  const bottomSpeed = Math.sqrt((2 * (total - lostOnWay)) / mass);
  // On the far slope, height h has cost m g h and friction m g mu cos(slope) h / sin(slope).
  const climb = (height - mu * Math.cos(slope * RAD) * down) / (1 + mu / Math.tan(slope * RAD));
  return { total, bottomSpeed, climb };
}

// Stepped along the track from the car's ENERGY, not from a force: its height says how much
// potential energy it has, and whatever is left of the total is motion.
export function coasterRun({ height = COASTER.height, slope = COASTER.slope, mass = COASTER.mass, mu = COASTER.mu, g = G, dt = DT } = {}) {
  const total = mass * g * height;
  const s = Math.sin(slope * RAD);
  const rub = mu * mass * g * Math.cos(slope * RAD);
  let y = height;
  let heat = 0;
  let side = -1;
  let best = 0;
  // A small push off the top, or a car at rest with no energy in motion never starts.
  let ds = 0.01;
  for (let i = 0; i < 100000; i++) {
    y += side * ds * s;
    heat += rub * ds;
    if (side < 0 && y <= 0) {
      side = 1;
      y = 0;
    }
    const ke = total - mass * g * y - heat;
    if (ke <= 0) break;
    const v = Math.sqrt((2 * ke) / mass);
    best = Math.max(best, v);
    ds = v * dt;
  }
  return { total, bottomSpeed: best, climb: y };
}

// --- Station 5: the bumper cars ---------------------------------------------
export const BUMPER = { m1: 150, m2: 300, u1: 4, u2: 1, e: 1, start: 30, carLength: 6 };

export function bumperFormula({ m1 = BUMPER.m1, m2 = BUMPER.m2, u1 = BUMPER.u1, u2 = BUMPER.u2, e = BUMPER.e } = {}) {
  // u2 is the speed of car B TOWARD car A, so along the axis it is negative.
  const before = m1 * u1 - m2 * u2;
  const closing = u1 + u2;
  const v1 = (before - m2 * e * closing) / (m1 + m2);
  const v2 = (before + m1 * e * closing) / (m1 + m2);
  const after = m1 * v1 + m2 * v2;
  const keBefore = 0.5 * m1 * u1 ** 2 + 0.5 * m2 * u2 ** 2;
  const keAfter = 0.5 * m1 * v1 ** 2 + 0.5 * m2 * v2 ** 2;
  return { before, after, v1, v2, keBefore, keAfter };
}

// --- Station 6: the pendulum and the swing ride -----------------------------
export const PENDULUM = { length: 12, angle: 30, dt: 0.03 };

export const pendulumFormula = ({ length = PENDULUM.length, g = G } = {}) => 2 * Math.PI * Math.sqrt(length / g);

// The time of one full swing, measured the way the program measures it: from one moment the swing
// reverses at the same side to the next. Reported to the program's own dt.
export function pendulumRun({ length = PENDULUM.length, angle = PENDULUM.angle, g = G, dt = PENDULUM.dt } = {}) {
  const pull = (g / length) * 57.3;
  let theta = angle;
  let omega = 0;
  let t = 0;
  let seen = false;
  for (let i = 0; i < 100000; i++) {
    const was = omega;
    omega -= pull * Math.sin(theta * RAD) * dt;
    theta += omega * dt;
    t += dt;
    // The first reversal is half a swing from release, so it starts the clock.
    if (was < 0 && omega >= 0) {
      if (seen) return { period: t };
      seen = true;
      t = 0;
    }
  }
  return { period: null };
}

export const SWING = { length: 14, period: 6 };

export function swingFormula({ length = SWING.length, period = SWING.period, g = G } = {}) {
  const w = (2 * Math.PI) / period;
  const c = Math.min(1, g / (w ** 2 * length));
  const angle = Math.acos(c) / RAD;
  return { angle, radius: length * Math.sin(angle * RAD), speed: w * length * Math.sin(angle * RAD) };
}
