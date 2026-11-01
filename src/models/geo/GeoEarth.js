import { LAND_RINGS, LAKE_RINGS } from './landData.js';
import { mixc, sstep, fbm, shade } from './GeoKit.js';

// The real shape of the world for the globes and maps. Coastlines are Natural Earth's (public
// domain). Everything below them is hand-placed and coarse, and the cards say so: which deserts and
// forests go where, and where the great ranges run, by longitude and latitude in degrees.

// One bit per texel of an equirectangular sheet, filled by even-odd scanlines over the rings. The
// bytes are cached because they are data rather than a GPU resource, and every globe wants them.
const cache = new Map();
function rasterise(rings, w, h) {
  const key = `${rings === LAND_RINGS ? 'land' : 'lake'}:${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const mask = new Uint8Array(w * h);
  const rows = Array.from({ length: h }, () => []);
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ax = ((ring[i * 2] / 10 + 180) / 360) * w; const ay = ((90 - ring[i * 2 + 1] / 10) / 180) * h;
      const bx = ((ring[j * 2] / 10 + 180) / 360) * w; const by = ((90 - ring[j * 2 + 1] / 10) / 180) * h;
      if (ay === by) continue;
      const top = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5));
      const bottom = Math.min(h - 1, Math.floor(Math.max(ay, by) - 0.5));
      for (let y = top; y <= bottom; y += 1) rows[y].push(ax + ((y + 0.5 - ay) / (by - ay)) * (bx - ax));
    }
  }
  for (let y = 0; y < h; y += 1) {
    const xs = rows[y].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.round(xs[k])); const to = Math.min(w, Math.round(xs[k + 1]));
      mask.fill(1, y * w + from, y * w + to);
    }
  }
  cache.set(key, mask);
  return mask;
}

export function landMask(w, h) {
  const land = rasterise(LAND_RINGS, w, h);
  const lakes = rasterise(LAKE_RINGS, w, h);
  const key = `both:${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const out = new Uint8Array(land.length);
  for (let i = 0; i < out.length; i += 1) out[i] = land[i] && !lakes[i] ? 1 : 0;
  cache.set(key, out);
  return out;
}

const ellipse = (lon, lat, [cx, cy, rx, ry]) => {
  let dx = lon - cx;
  if (dx > 180) dx -= 360; else if (dx < -180) dx += 360;
  return Math.hypot(dx / rx, (lat - cy) / ry);
};
const nearest = (lon, lat, list) => {
  let best = 9;
  for (const e of list) best = Math.min(best, ellipse(lon, lat, e));
  return best;
};

const DESERTS = [
  [8, 23, 28, 8.5], [30, 22, 9, 8], [47, 24, 11, 8], [68, 28, 6, 5], [58, 32, 9, 5], [62, 43, 11, 5], [83, 39, 8, 3.5], [103, 42, 14, 5],
  [21, -24, 7, 5], [15, -21, 3, 7], [132, -25, 16, 7.5], [-110, 32, 8, 6], [-117, 40, 4, 5], [-70, -23, 2.5, 7], [-69, -44, 3.5, 7],
];
const JUNGLES = [[-62, -4, 16, 9], [-52, 2, 6, 5], [21, 0, 12, 6.5], [112, 0, 22, 8], [101, 15, 8, 8], [78, 16, 5, 5], [-85, 13, 8, 6], [145, -5, 6, 4], [48, -19, 3, 6]];
const MOUNTAINS = [
  // [lon, lat, half-width in degrees] along each range's spine
  [[-150, 62, 5], [-130, 58, 4], [-118, 50, 4], [-110, 42, 5], [-106, 34, 3.5], [-103, 22, 3], [-92, 15, 2]],
  [[-76, 7, 2.2], [-78, -3, 2.4], [-72, -15, 4], [-68, -24, 3.5], [-70, -36, 2.2], [-73, -48, 1.8]],
  [[70, 37, 3], [78, 34, 4], [86, 29.5, 3.5], [96, 28, 3]],
  [[80, 34, 5], [90, 33, 6], [98, 33, 5]],
  [[6, 45.5, 1.6], [14, 47, 1.8], [24, 46, 1.8]],
  [[59, 67, 1.5], [60, 56, 1.5]],
  [[-7, 31.5, 1.6], [6, 35, 1.5]],
  [[40, 42, 1.4], [48, 41, 1.4], [58, 37, 2]],
  [[38, 12, 3], [37, 0, 2.2], [32, -10, 2]],
  [[148, -37, 2], [152, -28, 1.6]],
  [[132, 33, 1.5], [139, 37, 1.6]],
  [[8, 62, 2.2], [15, 66, 2]],
];
export function mountainAmount(lon, lat) {
  let best = 0;
  for (const range of MOUNTAINS) {
    for (let i = 0; i < range.length - 1; i += 1) {
      const [ax, ay, aw] = range[i]; const [bx, by, bw] = range[i + 1];
      const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy)));
      const d = Math.hypot(lon - ax - dx * t, lat - ay - dy * t) / (aw + (bw - aw) * t);
      if (d < 1) best = Math.max(best, 1 - d);
    }
  }
  return best;
}

const isGreenlandBox = (lon, lat) => lon > -74 && lon < -11 && lat > 59.5;
const coldIce = (lon, lat) => lat < -60 || (isGreenlandBox(lon, lat) && lat > 62) || lat > 78;

// A physical map's colours: the ones a satellite photograph would show, simplified.
export function earthColor(lon, lat, land, seedX = 0) {
  const nx = lon * 0.09 + seedX; const ny = lat * 0.09;
  if (!land) {
    const n = fbm(nx * 0.6, ny * 0.6, 3, 21) * 0.5 + 0.5;
    const a = Math.abs(lat);
    const sea = mixc([24, 70, 126], [18, 54, 106], n);
    return mixc(sea, [92, 124, 156], sstep(a, 66, 84) * 0.8);
  }
  if (coldIce(lon, lat)) return mixc([240, 244, 248], [222, 230, 238], fbm(nx * 2, ny * 2, 3, 3) * 0.5 + 0.5);
  const n = fbm(nx, ny, 4, 8);
  const a = Math.abs(lat);
  const desert = 1 - sstep(nearest(lon, lat, DESERTS) + n * 0.35, 0.75, 1.15);
  const jungle = 1 - sstep(nearest(lon, lat, JUNGLES) + n * 0.25, 0.8, 1.25);
  let c = mixc([92, 138, 72], [122, 148, 84], n * 0.5 + 0.5); // temperate farmland and grass
  c = mixc(c, [42, 96, 52], sstep(a, 44, 54) * (1 - sstep(a, 63, 70))); // the northern forests
  c = mixc(c, [138, 136, 112], sstep(a, 64, 71)); // tundra
  c = mixc(c, [28, 92, 44], jungle);
  c = mixc(c, mixc([222, 188, 128], [198, 158, 104], n * 0.5 + 0.5), desert);
  const peak = mountainAmount(lon, lat);
  if (peak > 0) {
    // Broad and soft. Only the Himalaya and Tibet are high enough on a globe this size to show white;
    // anywhere else a white spine reads as a line drawn on the map rather than as high ground.
    const rock = mixc([132, 112, 88], [152, 134, 108], n * 0.5 + 0.5);
    c = mixc(c, rock, sstep(peak, 0, 0.75) * 0.7);
    if (lon > 66 && lon < 104 && lat > 24 && lat < 42) c = mixc(c, [232, 234, 238], sstep(peak, 0.45, 0.95) * 0.8);
  }
  return c;
}

// Greenland and Africa, for the projection model. The land mask decides the coast, so these only
// have to fall in the sea everywhere except where the two neighbours come close.
export function inGreenland(lon, lat) {
  if (!isGreenlandBox(lon, lat)) return false;
  if (lat < 68 && lon > -30) return false;
  const west = lat < 74 ? -58.5 : lat < 76 ? -62 : lat < 79 ? -74 : lat < 81 ? -67 : -62;
  return lon > west;
}
export function inAfrica(lon, lat) {
  if (lat < -36 || lat > 38 || lon < -19 || lon > 52) return false;
  if (lon < -1 && lat > 35.95) return false;
  if (lon >= 12 && lat > 35) return false;
  if (lon >= 19 && lat > 33) return false;
  if (lat > 30) return lon < 32.5;
  if (lat > 12) return lon < 32.5 + (30 - lat) * (10.5 / 18);
  return true;
}

// Köppen's five groups, placed by the same rough rules a textbook map follows. The card says so.
export const CLIMATE_GROUPS = [
  { name: 'Tropical', note: 'hot and wet', color: [36, 128, 74] },
  { name: 'Dry', note: 'little rain', color: [226, 176, 88] },
  { name: 'Temperate', note: 'mild', color: [140, 196, 92] },
  { name: 'Continental', note: 'hot summers, cold winters', color: [64, 140, 176] },
  { name: 'Polar', note: 'cold all year', color: [226, 236, 244] },
];
export function climateZone(lon, lat, wobble = 0) {
  const a = Math.abs(lat) + wobble * 2.5;
  if (lat < -60 || (isGreenlandBox(lon, lat) && lat > 60) || a > 70) return 4;
  if (nearest(lon, lat, DESERTS) + wobble * 0.14 < 1) return 1;
  if (a < 22) return 0;
  if (lat < 0) return 2; // no large land reaches far enough south to go continental
  const westCoast = (lon > -11 && lon < 25 && lat < 58) || (lon > -135 && lon < -120 && lat < 60);
  const eastAsia = lon > 100 && lon < 145 && lat < 36;
  const eastUS = lon > -100 && lon < -70 && lat < 38;
  const med = lat < 45;
  if (westCoast || eastAsia || eastUS || (med && lon > -10 && lon < 45)) return 2;
  return a < 40 ? 2 : 3;
}

export { shade };
