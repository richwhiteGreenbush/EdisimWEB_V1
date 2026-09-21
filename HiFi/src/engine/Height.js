// Ground height, as a pure function of (theme, x, z).
//
// The first half of this file is the main app's terrain, term for term: the same three
// sine products, the same normalising peak, the same smoothstep falloff that is EXACTLY
// zero inside flatRadius. That is not nostalgia. A record's Y in an Edusim world file was
// read off that terrain, so reproducing it is what makes a layout portable -- and keeping
// it analytic (rather than raycasting a mesh, as the three.js app does) means anything can
// ask for a ground height before a single frame has rendered, which is the trap that put a
// 96ft theatre 157ft underground over there.
//
// The second half is what HiFi adds AROUND the walkable ground: a little broad-scale
// variation the original's three sines could not give, optional crater bowls, and the far
// ring of hills that replaces the edge of the world.

import { CLASSIC_EXTENT } from '../config.js';

export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rawNoise(x, z) {
  return (
    Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.038 - 0.6) +
    Math.sin(x * 0.021 - 0.9 + z * 0.017) * 0.6 +
    Math.cos(x * 0.09 + z * 0.07 + 2.3) * 0.25
  );
}
const RAW_NOISE_PEAK = 1.85;

function pockNoise(x, z) {
  return Math.sin(x * 0.32 + 0.4) * Math.cos(z * 0.29 - 1.1) * Math.cos(x * 0.11 + z * 0.13);
}

// The main app's terrainHeightAt, unchanged.
export function classicHeightAt(theme, x, z) {
  const radius = Math.hypot(x, z);
  const falloff = smoothstep(theme.flatRadius, theme.blendRadius, radius);
  if (falloff === 0) return 0;
  const base = (rawNoise(x, z) / RAW_NOISE_PEAK) * theme.amplitude;
  const pocks = theme.pockAmplitude ? pockNoise(x, z) * theme.pockAmplitude : 0;
  return (base + pocks) * falloff;
}

// --- value noise -------------------------------------------------------------------------
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm(x, z, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    // Rotate each octave: axis-aligned octaves stack their lattice lines on top of one
    // another and the result shows a faint grid from the air.
    const nx = x * 0.8 - z * 0.6;
    z = x * 0.6 + z * 0.8;
    x = nx;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// Ridged noise: |noise| folded so the creases become ridgelines. This is what separates a
// mountain from a smooth bump, and it is only ever used on the far ring.
function ridged(x, z, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise(x * freq, z * freq) * 2 - 1);
    n *= n * weight;
    weight = Math.min(1, n * 2);
    sum += n * amp;
    const nx = x * 0.8 - z * 0.6;
    z = x * 0.6 + z * 0.8;
    x = nx;
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

// --- craters (airless worlds) --------------------------------------------------------------
// A fixed, seeded field of impact bowls. Every one sits OUTSIDE the theme's flat zone so the
// landing site stays level, which is also how real landing sites were chosen.
const craterCache = new Map();
function cratersFor(theme) {
  if (craterCache.has(theme)) return craterCache.get(theme);
  const list = [];
  let s = 12345;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  let guard = 0;
  while (list.length < 120 && guard++ < 9000) {
    const big = rand() < 0.12;
    const r = big ? 60 + rand() * 110 : 7 + rand() * rand() * 38;
    // Outside the classic extent only: inside it the ground has to be the main app's, height
    // for height, or every prop a layout stood there is floating or buried.
    const dist = CLASSIC_EXTENT + r * 1.2 + rand() * 2600;
    const a = rand() * Math.PI * 2;
    const cx = Math.cos(a) * dist;
    const cz = Math.sin(a) * dist;
    if (list.some((c) => Math.hypot(c.x - cx, c.z - cz) < (c.r + r) * 0.9)) continue;
    list.push({ x: cx, z: cz, r, depth: r * (0.16 + rand() * 0.08) });
  }
  craterCache.set(theme, list);
  return list;
}

function craterHeight(theme, x, z) {
  let h = 0;
  for (const c of cratersFor(theme)) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r;
    if (d > 1.9) continue;
    // Parabolic bowl inside, a raised rim at d=1, and an ejecta apron that decays outward.
    const bowl = d < 1 ? (d * d - 1) * c.depth : 0;
    const rim = Math.exp(-Math.pow((d - 1) / 0.22, 2)) * c.depth * 0.34;
    const apron = d > 1 ? Math.exp(-(d - 1) * 3.2) * c.depth * 0.12 : 0;
    h += bowl + rim + apron;
  }
  return h;
}

// --- the HiFi ground -------------------------------------------------------------------------
export function heightAt(theme, x, z) {
  const radius = Math.hypot(x, z);
  let h = classicHeightAt(theme, x, z);

  if (theme.craters) h += craterHeight(theme, x, z);

  // Carved basins (ponds). The ground is first LEVELLED toward the basin's own rim height
  // over a wide collar, so the water surface meets the bank at one height all the way
  // round, and then the bowl is dug out of that.
  //
  // A CUT can also be a RECTANGLE, and Turkle Street is why. A kerbed street is not a ribbon
  // laid on a lawn -- it is a trough: the gutter flowline sits five inches BELOW the grass
  // behind the kerb and the crown comes back up to nearly meet it. Built without a cut, the
  // whole carriageway is under the terrain and the terrain simply draws over it: the street
  // rendered as a strip of pale gravel with a kerb standing beside it, which looked like a
  // texture bug and was a depth one. A pond's collar-levelling is deliberately skipped here
  // -- a road does not make its surroundings level, it is cut through whatever they are.
  if (theme.carves) {
    for (const c of theme.carves) {
      if (c.r) {
        const d = Math.hypot(x - c.x, z - c.z) / c.r;
        if (d > 1.7) continue;
        const level = classicHeightAt(theme, c.x, c.z);
        h += (level - h) * (1 - smoothstep(1.05, 1.7, d));
        h -= c.depth * (1 - smoothstep(0.35, 1.0, d));
        continue;
      }
      const ca = Math.cos(c.yaw ?? 0); const sa = Math.sin(c.yaw ?? 0);
      const dx = x - c.x; const dz = z - c.z;
      const lx = dx * ca - dz * sa; const lz = dx * sa + dz * ca;
      const qx = Math.abs(lx) - c.w / 2; const qz = Math.abs(lz) - c.d / 2;
      const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
      const feather = c.feather ?? 1.6;
      if (out > feather) continue;
      h -= c.depth * (1 - smoothstep(0, feather, out));
    }
  }

  // Past the main app's old bound the ground opens out into rolling country: the original
  // three sines carry on underneath (so nothing steps at the seam) and a broad fbm swell
  // fades in on top, which is what gives a 640ft world somewhere to walk TO.
  if (theme.outerAmplitude && radius > CLASSIC_EXTENT) {
    const open = smoothstep(CLASSIC_EXTENT, CLASSIC_EXTENT + 260, radius);
    const roll = fbm(x * 0.0061 + 5.2, z * 0.0061 - 2.7, 4) - 0.47;
    const fine = fbm(x * 0.024 + 1.1, z * 0.024 + 8.3, 3) - 0.47;
    h += open * (roll * theme.outerAmplitude * 2.4 + fine * theme.outerAmplitude * 0.22);
  }

  const hills = theme.hills;
  if (hills && radius > CLASSIC_EXTENT) {
    // Two stages. Foothills start right at the world bound so the ground visibly rises
    // where the student can no longer walk -- the bound reads as terrain getting steep
    // rather than as an invisible wall -- and the ridged mountains proper only come in well
    // beyond that, where they are silhouette rather than ground.
    const foot = smoothstep(CLASSIC_EXTENT + 20, CLASSIC_EXTENT + 800, radius);
    const far = smoothstep(CLASSIC_EXTENT + 260, CLASSIC_EXTENT + 4600, radius);
    const swell = fbm(x * 0.0019 + 11.3, z * 0.0019 - 4.1, 4);
    const ridge = ridged(x * 0.00031 + 3.7, z * 0.00031 + 9.2, 6);
    h += foot * swell * hills.height * 0.16;
    h += far * (ridge * 1.35 + swell * 0.2) * hills.height;
  }
  return h;
}
