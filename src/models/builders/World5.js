// Builders for the Model Database's fifth set of world landmarks and arts: Himeji Castle, the Great
// Mosque of Djenne, a kora, a tenor steelpan and a BBb tuba.
//
// A history teacher and a music teacher will use these, so what a student can count is COMPUTED and
// exported rather than drawn by eye:
//   himeji     five outer roofs on the great keep, three smaller keeps, four covered corridors. Every roof
//              is a real loft: concave up the slope, rising at the corners. The stone is one curve.
//   djenne     three towers and eighteen buttresses on the east wall, on a square platform.
//   kora       21 strings, 11 and 10, every one lying in a notch whose position it was computed from.
//   steelpan   the note table walks the cycle of fifths, and `steelpanReport` proves its neighbours.
//   tuba       one path with one radius function. `tubaBoreReport` proves it never steps or narrows.
import * as THREE from 'three';
import { mergeParts, smoothNoise3, weldSeam } from '../../props/LoftKit.js';
import {
  seededRandom, canvasTexture, standard, mesh, group,
} from '../../PropKit.js';
import {
  lin, mix, clamp01, sstep, tintVertices, grainBump, tube, outward,
  Sculpt, polygonize, segsP, onSurface,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function fbm(x, y, z, octaves = 3) {
  let s = 0; let a = 0.5; let f = 1; let t = 0;
  for (let i = 0; i < octaves; i += 1) {
    s += smoothNoise3(x * f, y * f, z * f) * a;
    t += a; a *= 0.5; f *= 2.03;
  }
  return s / t;
}

// A triangle soup with face normals and a colour per corner. Every polygon MEASURES its winding against
// an outward hint rather than assuming it.
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }

  face(pts, col, hint = null, { uv = null } = {}) {
    let P = pts;
    let UV = uv;
    let nrm = norm(cross(sub(P[1], P[0]), sub(P[P.length - 1], P[0])));
    if (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]) < 1e-9) return;
    if (hint && dot(nrm, hint) < 0) {
      P = [...P].reverse();
      if (UV) UV = [...UV].reverse();
      nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const ax = Math.abs(nrm[0]); const ay = Math.abs(nrm[1]); const az = Math.abs(nrm[2]);
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const k of [0, i, i + 1]) {
        const q = P[k];
        this.p.push(q[0], q[1], q[2]);
        this.n.push(nrm[0], nrm[1], nrm[2]);
        if (UV) this.t.push(UV[k][0], UV[k][1]);
        else if (ay > 0.72) this.t.push(q[0], q[2]);
        else if (ax > az) this.t.push(q[2], q[1]);
        else this.t.push(q[0], q[1]);
        this.c.push(col[0], col[1], col[2]);
      }
    }
  }

  // An eight-cornered solid: bottom four then top four, going round.
  hexa(b, t, col, { skipBottom = false, topCol = null } = {}) {
    const c = [0, 0, 0];
    for (const q of [...b, ...t]) { c[0] += q[0] / 8; c[1] += q[1] / 8; c[2] += q[2] / 8; }
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const quad = [b[i], b[j], t[j], t[i]];
      const mid = scl(add(add(quad[0], quad[1]), add(quad[2], quad[3])), 0.25);
      this.face(quad, col, sub(mid, c));
    }
    this.face(t, topCol ?? col, [0, 1, 0]);
    if (!skipBottom) this.face(b, col, [0, -1, 0]);
  }

  box(x0, y0, z0, x1, y1, z1, col, opts) {
    this.hexa(
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
      col,
      opts,
    );
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// Bottom-up [r, y] profile with the solid on your left walking along it. Repeat a point for a hard edge.
function latheUp(profile, { segments = 32, start = 0, sweep = Math.PI * 2 } = {}) {
  const rows = profile.length;
  const ring = segments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  let total = 0;
  const arc = [0];
  for (let i = 1; i < rows; i += 1) {
    total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    arc.push(total);
  }
  for (let i = 0; i < rows; i += 1) {
    const [r, y] = profile[i];
    for (let j = 0; j <= segments; j += 1) {
      const a = start + (j / segments) * sweep;
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uvs.push(j / segments, arc[i] / (total || 1));
    }
  }
  for (let i = 0; i < rows - 1; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * ring + j;
      const b = a + 1;
      const d = (i + 1) * ring + j;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  if (sweep >= Math.PI * 2 - 1e-6) weldSeam(g, ring, rows);
  const n = g.attributes.normal;
  for (const [row, sign] of [[0, -1], [rows - 1, 1]]) {
    if (profile[row][0] > 1e-5) continue;
    for (let j = 0; j <= segments; j += 1) n.setXYZ(row * ring + j, 0, sign, 0);
  }
  return g;
}

// A lathed part turned so its +Y runs along `dir`, seated at p.
function seat(g, p, dir, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(dir).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  g.applyMatrix4(new THREE.Matrix4().compose(v3(p), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// mergeParts reads `color` as a THREE.Color argument, and an array of linear values is not one: it comes
// out white with no error. Everything here carries linear arrays, so they are painted on first.
function mergeLinear(parts) {
  return mergeParts(parts.map((part) => {
    if (!Array.isArray(part.color)) return part;
    const c = part.color;
    return { geometry: tintVertices(part.geometry, (x, y, z, out) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }), keepColor: true };
  }));
}

// A ridge: a tube whose flanks are white-plastered courses and whose crown is dark tile.
function ridgeTube(pts, r, { sides = 5, steps = 4, round = 0, pale = null, dark = null } = {}) {
  const g = tube(pts, r, { sides, steps, round });
  const nrm = g.attributes.normal;
  tintVertices(g, (x, y, z, out, i) => {
    const c = nrm.getY(i) > 0.45 ? dark : pale;
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
  return { geometry: g, keepColor: true };
}

// A straight capped rod from a to b.
function rod(a, b, r, sides = 8, r2 = r) {
  return tube([a, b], [r, r2], { sides, steps: 1, round: 1, straight: true });
}

// Polished metal with no environment map: the room's reflections painted in as vertex colour, from
// each vertex's normal. Bright windows, a dark horizon, a pale lift on the highlights.
function polishGeometry(g, hex, { gain = 1, floor = 0, pale = 0.55 } = {}) {
  const base = Array.isArray(hex) ? hex : lin(hex);
  const nrm = g.attributes.normal;
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const keys = [[-1, 0.5], [-0.5, 0.42], [-0.12, 0.62], [0.1, 1.08], [0.26, 1.6], [0.5, 0.95], [0.82, 1.1], [1, 1.3]];
  for (let i = 0; i < pos.count; i += 1) {
    const ny = nrm.getY(i);
    let k = 1;
    for (let s = 0; s < keys.length - 1; s += 1) {
      if (ny >= keys[s][0] && ny <= keys[s + 1][0]) {
        k = mix(keys[s][1], keys[s + 1][1], (ny - keys[s][0]) / (keys[s + 1][0] - keys[s][0]));
        break;
      }
    }
    const nx = nrm.getX(i); const nz = nrm.getZ(i);
    const w1 = Math.max(0, 0.46 * nx + 0.12 * ny + 0.88 * nz);
    const w2 = Math.max(0, -0.3 * nx + 0.12 * ny - 0.95 * nz);
    const w3 = Math.max(0, -0.62 * nx + 0.78 * nz);
    k += 0.75 * w1 ** 22 + 0.6 * w2 ** 22 - 0.22 * w3 ** 8;
    k = Math.max(floor, k * gain);
    const up = Math.max(0, k - 1) * pale;
    arr[i * 3] = base[0] * k + up;
    arr[i * 3 + 1] = base[1] * k + up;
    arr[i * 3 + 2] = base[2] * k + up;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// A surface with real thickness, on a grid. The top sheet carries every sample; its back is one coarse
// quad unless `back` is set, because the back of a roof slope is never seen. Winding and normals are
// measured against `up`. `rimDv` slides the rim's lower edge down the texture, which is how an eave's
// edge reads the row of round tile ends painted at the foot of the tile map.
function plate(nu, nv, point, thick, {
  up = [0, 1, 0], uv = null, color = null, rimDv = 0, rimColor = null, rims = [1, 1, 1, 1], backDiv = 6, open = false,
} = {}) {
  const at = (i, j) => i + j * (nu + 1);
  const P = [];
  for (let j = 0; j <= nv; j += 1) for (let i = 0; i <= nu; i += 1) P.push(point(i / nu, j / nv));
  const N = new Array(P.length);
  let sum = 0;
  for (let j = 0; j <= nv; j += 1) {
    for (let i = 0; i <= nu; i += 1) {
      const du = sub(P[at(Math.min(nu, i + 1), j)], P[at(Math.max(0, i - 1), j)]);
      const dv = sub(P[at(i, Math.min(nv, j + 1))], P[at(i, Math.max(0, j - 1))]);
      const n = cross(du, dv);
      N[at(i, j)] = n;
      sum += dot(n, up);
    }
  }
  const s = sum >= 0 ? 1 : -1;
  for (let k = 0; k < N.length; k += 1) {
    const n = N[k];
    if (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) < 1e-10) N[k] = norm(up);
    else N[k] = scl(norm(n), s);
  }
  const pos = []; const nrm = []; const uvs = []; const col = []; const idx = [];
  const put = (p, n, w, c) => {
    pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uvs.push(w[0], w[1]); col.push(c[0], c[1], c[2]);
    return pos.length / 3 - 1;
  };
  const uvAt = (p, a, b) => (uv ? uv(p, a, b) : [p[0], p[1]]);
  const colAt = (p, a, b) => (color ? color(p, a, b) : [1, 1, 1]);
  for (let j = 0; j <= nv; j += 1) {
    for (let i = 0; i <= nu; i += 1) {
      const p = P[at(i, j)];
      put(p, N[at(i, j)], uvAt(p, i / nu, j / nv), colAt(p, i / nu, j / nv));
    }
  }
  const quad = (a, b, c, d) => { if (s > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c); };
  for (let j = 0; j < nv; j += 1) for (let i = 0; i < nu; i += 1) quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  if (thick > 0) {
    const low = (k) => sub(P[k], scl(N[k], thick));
    // The rim, in its own vertices so that the edge stays crisp.
    const edges = [
      Array.from({ length: nu + 1 }, (_, i) => [i, 0]),
      Array.from({ length: nv + 1 }, (_, j) => [nu, j]),
      Array.from({ length: nu + 1 }, (_, i) => [nu - i, nv]),
      Array.from({ length: nv + 1 }, (_, j) => [0, nv - j]),
    ];
    const centre = P[at(nu >> 1, nv >> 1)];
    edges.forEach((edgeFull, eIndex) => {
      // A rim nobody sees is one quad: it is only there so that the solid's volume comes out true.
      if (open && !rims[eIndex]) return;
      const edge = rims[eIndex] ? edgeFull : (() => {
        const out = [];
        const steps = eIndex % 2 === 0 ? Math.max(1, Math.ceil(nu / backDiv)) : Math.max(1, Math.ceil(nv / 2));
        for (let m = 0; m <= steps; m += 1) out.push(edgeFull[Math.round((m / steps) * (edgeFull.length - 1))]);
        return out;
      })();
      let prevA = -1; let prevB = -1;
      for (let e = 0; e < edge.length; e += 1) {
        const [i, j] = edge[e];
        const k = at(i, j);
        const p = P[k]; const q = low(k);
        const tangent = norm(sub(P[at(...edge[Math.min(edge.length - 1, e + 1)])], P[at(...edge[Math.max(0, e - 1)])]));
        let side = norm(cross(tangent, N[k]));
        if (dot(side, sub(p, centre)) < 0) side = scl(side, -1);
        const w = uvAt(p, i / nu, j / nv);
        const c = rimColor ? rimColor(p, i / nu, j / nv) : colAt(p, i / nu, j / nv);
        const ia = put(p, side, w, c);
        const ib = put(q, side, [w[0], w[1] - rimDv], c);
        if (prevA >= 0) {
          const pa = v3(pos.slice(prevA * 3, prevA * 3 + 3)); const pb = v3(pos.slice(prevB * 3, prevB * 3 + 3));
          const f = pb.clone().sub(pa).cross(v3(p).sub(pa));
          if (f.dot(v3(side)) >= 0) idx.push(prevA, prevB, ia, ia, prevB, ib);
          else idx.push(prevA, ia, prevB, ia, ib, prevB);
        }
        prevA = ia; prevB = ib;
      }
    });
    // The back: nothing sees it, so it is coarse across the surface, but it must follow the curve up the
    // slope, or on a concave roof the back's chord passes above the front and the solid comes out inverted.
    if (open) { /* nothing sees the back of a roof slope, and on a concave surface a coarse back pokes through */ } else {
    const cu = Math.max(1, Math.ceil(nu / backDiv));
    const cv = backDiv === 1 ? nv : Math.max(1, Math.ceil(nv / 2));
    const base = pos.length / 3;
    for (let r = 0; r <= cv; r += 1) {
      for (let c = 0; c <= cu; c += 1) {
        const k = at(Math.round((c / cu) * nu), Math.round((r / cv) * nv));
        put(low(k), scl(N[k], -1), [0, 0], [0.2, 0.2, 0.2]);
      }
    }
    const atB = (c, r) => base + c + r * (cu + 1);
    for (let r = 0; r < cv; r += 1) for (let c = 0; c < cu; c += 1) quad(atB(c, r), atB(c, r + 1), atB(c + 1, r + 1), atB(c + 1, r));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------------------
// Himeji Castle, about 1/10
// ---------------------------------------------------------------------------

// +Z is SOUTH, the side everybody photographs, and +X is east. The great keep therefore stands to the
// viewer's right with the west small keep on the left and the other two behind, which is the view from
// the Sannomaru lawn. In plan the four keeps are a ring round a small courtyard, linked by four corridors:
// east small keep to the north of the great keep, west small keep to its west, the north-west (Inui) keep
// in the far corner. Figures at 1/10: the great keep's tower stands about 103ft on about 49ft of stone.
// The hill and moat are drawn in closer than life, as the card says.
export const HIMEJI_PLAN = { greatKeepRoofs: 5, smallKeeps: 3, corridors: 4 };

// The concave batter of the stone, ogi-no-kobai, "the slope of a folding fan": shallow at the foot and
// vertical at the top. One curve for every wall on the site. `off` is how far the face stands out from
// the top edge, at v = 0 at the foot and 1 at the top.
const OGI_POWER = 2.2;
const ogiOff = (spread, v) => spread * (1 - v) ** OGI_POWER;

// Distance up the curved face at v, in feet, so that a course of stone keeps its height however the face
// leans. Without it the shallow foot of a wall stretches its stones into planks.
function ogiArc(spread, height, v) {
  let s = 0;
  const N = 12;
  for (let i = 0; i < N; i += 1) {
    const w = ((i + 0.5) / N) * v;
    s += (Math.hypot(height, spread * OGI_POWER * (1 - w) ** (OGI_POWER - 1)) * v) / N;
  }
  return s;
}

// The slope of the wall's face from the vertical at a given height, which is what makes it a fan.
export function himejiStoneReport(spread = 1.25, height = 3) {
  const angle = (v) => (Math.atan((spread * OGI_POWER * (1 - v) ** (OGI_POWER - 1)) / height) * 180) / Math.PI;
  return { footDegreesFromVertical: angle(0), midDegreesFromVertical: angle(0.5), topDegreesFromVertical: angle(1) };
}

const HM = {
  PLASTER: lin(0xf4f2ec),
  PLASTER_SHADE: lin(0xd8d6ce),
  DARK: lin(0x141316),
  BAR: lin(0xc9c6bc),
  TILE: lin(0xc6cbd0),
  RIDGE_DARK: lin(0x34383d),
  RIDGE_PALE: lin(0xc4c3bb),
  STONE: lin(0xbdbab0),
  WOOD: lin(0x4a3a2c),
};

const HM_FACES = {
  S: { L: [1, 0], O: [0, 1], x: true },
  N: { L: [-1, 0], O: [0, -1], x: true },
  E: { L: [0, -1], O: [1, 0], x: false },
  W: { L: [0, 1], O: [-1, 0], x: false },
};
const HM_FACE_LIST = ['S', 'E', 'N', 'W'];

// One tile row is 0.1ft: about a foot on the real roof.
const TILE_U = 0.6; // feet per repeat of the map, six rows
const TILE_V0 = 0.05; // the foot of the map below this is the row of round tile ends

// Grey tile with the white plaster joints between the rows that are Himeji's own. Near white where the
// plaster is, so vertex colour sets that, and the map pulls the tile itself down to dark grey. V is
// clamped, not repeated: v = 0 is the eave and v = 1 the top of the slope.
function hmTileMap() {
  const rng = seededRandom(1609);
  const W = 512; const H = 512;
  const t = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#7c7c7c';
    ctx.fillRect(0, 0, W, H);
    const ROWS = 6; const COURSES = 13;
    const rw = W / ROWS;
    const y0 = H * (1 - TILE_V0);
    for (let r = 0; r < ROWS; r += 1) {
      // The round tile running down the slope: lit along its crown.
      const x = r * rw;
      const g = ctx.createLinearGradient(x, 0, x + rw, 0);
      g.addColorStop(0, 'rgb(44,44,47)'); g.addColorStop(0.14, 'rgb(72,72,76)'); g.addColorStop(0.42, 'rgb(126,126,130)');
      g.addColorStop(0.62, 'rgb(106,106,110)'); g.addColorStop(0.88, 'rgb(60,60,64)'); g.addColorStop(1, 'rgb(42,42,45)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rw, y0);
      // The plaster joint.
      ctx.fillStyle = 'rgb(240,240,236)';
      ctx.fillRect(x + rw - 3, 0, 5, y0);
    }
    // The overlap of each course.
    for (let c = 0; c < COURSES; c += 1) {
      const y = (c / COURSES) * y0;
      for (let r = 0; r < ROWS; r += 1) {
        const jit = (rng() - 0.5) * 5;
        ctx.fillStyle = 'rgba(16,16,18,0.42)';
        ctx.fillRect(r * rw, y + jit, rw - 5, 4);
        ctx.fillStyle = 'rgba(230,230,232,0.1)';
        ctx.fillRect(r * rw, y + jit + 4, rw - 5, 3);
      }
    }
    // Weathering.
    for (let i = 0; i < 900; i += 1) {
      const v = rng() > 0.5 ? 30 : 200;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.04 + rng() * 0.08})`;
      ctx.fillRect(rng() * W, rng() * y0, 2 + rng() * 10, 2 + rng() * 22);
    }
    // The round tile ends along the eave, each a pale ringed disc.
    ctx.fillStyle = 'rgb(66,66,68)';
    ctx.fillRect(0, y0, W, H - y0);
    const rd = (H - y0) * 0.46;
    for (let r = 0; r < ROWS; r += 1) {
      const cx = (r + 0.5) * rw; const cy = y0 + (H - y0) * 0.5;
      ctx.fillStyle = 'rgb(182,182,180)';
      ctx.beginPath(); ctx.arc(cx, cy, rd, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(76,76,78)';
      ctx.beginPath(); ctx.arc(cx, cy, rd * 0.68, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgb(160,160,158)';
      ctx.beginPath(); ctx.arc(cx, cy, rd * 0.24, 0, Math.PI * 2); ctx.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Uchikomi-hagi: dressed but irregular stones in rough courses with dark joints. Near white, repeated.
function hmStoneMap() {
  const rng = seededRandom(1346);
  const W = 512; const H = 512;
  const t = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = 'rgb(66,64,60)';
    ctx.fillRect(0, 0, W, H);
    const ROWS = 14;
    const rh = H / ROWS;
    for (let r = 0; r < ROWS; r += 1) {
      const widths = [];
      let total = 0;
      while (total < W) { const w = 26 + rng() * 52; widths.push(w); total += w; }
      const k = W / total;
      let at = rng() * 30;
      for (const w0 of widths) {
        const w = w0 * k;
        const v = 188 + rng() * 66;
        const y0 = r * rh + 0.8 + rng() * 2; const y1 = (r + 1) * rh - 1 - rng() * 2;
        const tilt = (rng() - 0.5) * 5;
        const tilt2 = (rng() - 0.5) * 5;
        for (const ox of [-W, 0, W]) {
          const X = at + ox;
          const grd = ctx.createLinearGradient(0, y0, 0, y1);
          grd.addColorStop(0, `rgb(${v},${v},${v - 3})`);
          grd.addColorStop(1, `rgb(${v - 20},${v - 20},${v - 23})`);
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.moveTo(X + 1.4 + tilt * 0.4, y0 + tilt); ctx.lineTo(X + w - 1.4 + tilt2 * 0.4, y0 - tilt);
          ctx.lineTo(X + w - 1.1, y1 + tilt2 * 0.5); ctx.lineTo(X + 1.1, y1 - tilt2 * 0.5);
          ctx.closePath(); ctx.fill();
        }
        at += w;
      }
    }
    for (let i = 0; i < 1800; i += 1) {
      const v = rng() > 0.5 ? 255 : 30;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rng() * 0.07})`;
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 3);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hmPlasterMap() {
  const rng = seededRandom(1610);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(250,250,248)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i += 1) {
      const v = 232 + rng() * 22;
      ctx.fillStyle = `rgba(${v},${v},${v - 3},${0.08 + rng() * 0.14})`;
      const x = rng() * w; const y = rng() * h;
      const rw = 8 + rng() * 46; const rh = 8 + rng() * 26;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) ctx.fillRect(x + ox, y + oy, rw, rh);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function hmGrassMap() {
  const rng = seededRandom(1993);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgb(226,226,226)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i += 1) {
      const v = 160 + rng() * 95;
      ctx.fillStyle = `rgba(${v},${v},${v},0.7)`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 2 + rng() * 5);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A hipped skirt of roof: four slopes that meet along their hips. Concave up the slope, and the eave
// rises and sweeps outward toward each corner. This one function is the identification.
function hmTierPoint(K, f, s, v) {
  const F = HM_FACES[f];
  const ha = (F.x ? K.hx : K.hz) + K.over;
  const hd = (F.x ? K.hz : K.hx) + K.over;
  const ta = F.x ? K.tx : K.tz;
  const td = F.x ? K.tz : K.tx;
  const as = Math.abs(s);
  const a = mix(s * (ha + K.push), s * ta, v);
  const d = mix(hd + K.push * as ** 3, td, v);
  const y = mix(K.y + K.lift * as ** 3.2, K.y + K.rise, v ** 1.55);
  return [K.cx + F.L[0] * a + F.O[0] * d, y, K.cz + F.L[1] * a + F.O[1] * d];
}

function hmLateral(K, f, p) {
  const F = HM_FACES[f];
  return (p[0] - K.cx) * F.L[0] + (p[2] - K.cz) * F.L[1];
}

// The shachi, the tiger-headed fish on a ridge's end, its tail in the air, wards off fire by legend.
// `out` is the horizontal direction the ridge runs out along.
function hmShachi(parts, p, out, size) {
  const big = size > 0.5;
  const o = norm([out[0], 0, out[2]]);
  const at = (a, h) => [p[0] + o[0] * a * size, p[1] + h * size, p[2] + o[2] * a * size];
  const side = norm(cross([0, 1, 0], o));
  const c = HM.RIDGE_DARK;
  // Head at the ridge, facing inward along it, body arching up and outward, tail thrown back.
  parts.push({ geometry: tube([at(-0.16, 0.2), at(0.0, 0.1), at(0.17, 0.3), at(0.2, 0.58), at(0.12, 0.8), at(0.03, 0.92)], [0.07, 0.15, 0.16, 0.115, 0.06, 0.018], { sides: big ? 9 : 6, steps: big ? 14 : 7, round: 1 }), color: c });
  // The tail's two flukes and the fins, as flattened solids.
  const blade = (a, b, w, thick = 0.018) => parts.push({
    geometry: plate(5, 2, (u, v) => {
      const q = mix3(a, b, u);
      const k = (v - 0.5) * 2 * w * size * Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1)) ** 0.8;
      return add(q, scl(side, 0)).map((val, i) => val + (i === 1 ? k * 0.35 : o[i] * k));
    }, thick * size, { up: side, backDiv: 1, color: () => c }),
    keepColor: true,
  });
  blade(at(0.03, 0.9), at(-0.2, 1.05), 0.1);
  blade(at(0.03, 0.9), at(0.2, 1.1), 0.1);
  if (big) {
    blade(at(0.2, 0.55), at(0.42, 0.64), 0.06);
    blade(at(0.16, 0.25), at(0.4, 0.2), 0.06);
  }
  // Paired fins standing off the flanks.
  for (const sgn of [-1, 1]) {
    const root = add(at(0.1, 0.24), scl(side, sgn * 0.12 * size));
    parts.push({ geometry: tube([root, add(root, add(scl(side, sgn * 0.14 * size), [0, 0.1 * size, 0]))], [0.05 * size, 0.008 * size], { sides: 5, steps: 1, round: 0, straight: true }), color: c });
    // A pale eye, which is what reads as a face from below.
    const eye = add(at(-0.1, 0.24), scl(side, sgn * 0.085 * size));
    const e = new THREE.SphereGeometry(0.03 * size, 6, 4);
    e.translate(eye[0], eye[1], eye[2]);
    parts.push({ geometry: e, color: HM.RIDGE_PALE });
  }
}

// One keep (or one corridor, which is a keep of one storey). `K.storeys` runs from the bottom; the last
// is roofed with the hip-and-gable, the rest with a skirt.
function hmKeep(O, K) {
  const n = K.storeys.length;
  const tileUv = (Kt, f) => (p, u, v) => [hmLateral(Kt, f, p) / TILE_U, TILE_V0 + (1 - TILE_V0) * v];
  const NU = K.nu ?? 20; const NV = K.nv ?? 6;
  const tileColor = (p) => {
    const k = 0.93 + 0.14 * fbm(p[0] * 0.8 + K.cx, p[1] * 0.8, p[2] * 0.8, 2);
    return times(HM.TILE, k);
  };
  const hipTubes = (Kt, sample) => {
    const pts = [];
    for (let k = 0; k <= 5; k += 1) pts.push(sample(k / 5));
    const r = K.hipR ?? 0.06;
    O.plain.push(ridgeTube(pts.map((q) => [q[0], q[1] + r * 0.7, q[2]]), r, { sides: 5, steps: 4, pale: HM.RIDGE_PALE, dark: HM.RIDGE_DARK }));
    // The end tile, curled up off the eave's corner.
    const tip = pts[0];
    const toward = norm(sub(pts[0], pts[1]));
    const e0 = [tip[0], tip[1] + r * 0.7, tip[2]];
    const e1 = add(e0, add(scl(toward, r * 1.3), [0, r * 1.9, 0]));
    O.plain.push({ geometry: tube([e0, e1], [r * 1.3, r * 0.8], { sides: 5, steps: 1, round: 0, straight: true }), color: HM.RIDGE_DARK });
  };

  for (let i = 0; i < n; i += 1) {
    const st = K.storeys[i];
    const prev = i > 0 ? K.storeys[i - 1] : null;
    const base = prev ? prev.y + 0.32 : K.y0 - 0.02;
    const y1 = st.y + 0.05;
    const taper = st.taper ?? 0.03;
    const box = { cx: K.cx, cz: K.cz, y0: base, y1, hx0: st.hx, hz0: st.hz, hx1: st.hx - taper, hz1: st.hz - taper };
    const q = (x, y, z) => [K.cx + x, y, K.cz + z];
    O.plaster.hexa(
      [q(-box.hx0, base, -box.hz0), q(box.hx0, base, -box.hz0), q(box.hx0, base, box.hz0), q(-box.hx0, base, box.hz0)],
      [q(-box.hx1, y1, -box.hz1), q(box.hx1, y1, -box.hz1), q(box.hx1, y1, box.hz1), q(-box.hx1, y1, box.hz1)],
      HM.PLASTER,
      { skipBottom: true },
    );
    // The band of wall a student can actually see, above whatever roof is below it.
    const visLow = prev ? prev.y + prev.rise + 0.1 : K.y0 + 0.28;
    const visHigh = st.y - 0.1;
    const band = visHigh - visLow;
    if (band > 0.2 && st.win) {
      const wh = Math.min(0.46, band * 0.62);
      const wy0 = visLow + (band - wh) * 0.55;
      for (const f of HM_FACE_LIST) {
        const count = st.win[f] ?? 0;
        if (!count) continue;
        const half = (HM_FACES[f].x ? st.hx : st.hz) - 0.4;
        for (let c = 0; c < count; c += 1) {
          const a = count === 1 ? 0 : mix(-half, half, c / (count - 1));
          hmWindow(O.plaster, box, f, a, wy0, wh, st.winW ?? 0.42);
        }
      }
    }
    // A string course under the eave: a real building's line, and a shadow to read the storey by.
    if (band > 0.12) {
      for (const f of HM_FACE_LIST) {
        const half = (HM_FACES[f].x ? st.hx : st.hz) + 0.005;
        hmWallBox(O.plaster, box, f, -half, half, visHigh - 0.03, visHigh + 0.05, 0, 0.02, HM.PLASTER_SHADE);
      }
    }
    if (i < n - 1) {
      const next = K.storeys[i + 1];
      const Kt = {
        cx: K.cx, cz: K.cz, y: st.y, hx: st.hx, hz: st.hz, over: st.over, rise: st.rise, tx: next.hx - 0.02, tz: next.hz - 0.02, lift: st.lift, push: st.push,
      };
      const thick = K.eaveT ?? 0.085;
      for (const f of HM_FACE_LIST) {
        O.tile.push({
          geometry: plate(NU, NV, (u, v) => hmTierPoint(Kt, f, u * 2 - 1, v), thick, {
            up: [HM_FACES[f].O[0] * 0.5, 1, HM_FACES[f].O[1] * 0.5], uv: tileUv(Kt, f), color: tileColor, rimDv: TILE_V0 * 0.92, rims: [1, 0, 0, 0], open: true,
          }),
          keepColor: true,
        });
        hmSoffit(O, Kt, f, thick);
        hipTubes(Kt, (t) => hmTierPoint(Kt, f, 1, t));
      }
    } else {
      hmTopRoof(O, K, st, { NU, NV, thick: K.eaveT ?? 0.085, tileColor, hipTubes });
    }
    for (const g of st.gables ?? []) {
      const next = K.storeys[i + 1];
      const Kt = {
        cx: K.cx, cz: K.cz, y: st.y, hx: st.hx, hz: st.hz, over: st.over, rise: st.rise, tx: next ? next.hx : st.hx * 0.7, tz: next ? next.hz : st.hz * 0.7, lift: st.lift, push: st.push,
      };
      hmGable(O, Kt, g);
    }
  }
}

function hmSoffit(O, Kt, f, thick) {
  const F = HM_FACES[f];
  const wa = F.x ? Kt.hx : Kt.hz;
  const wd = F.x ? Kt.hz : Kt.hx;
  O.plaster.parts.push({
    geometry: plate(8, 1, (u, v) => {
      const s = u * 2 - 1;
      const e = hmTierPoint(Kt, f, s, 0);
      const pa = (e[0] - Kt.cx) * F.L[0] + (e[2] - Kt.cz) * F.L[1];
      const pd = (e[0] - Kt.cx) * F.O[0] + (e[2] - Kt.cz) * F.O[1];
      const a = mix(pa * 0.998, s * wa, v);
      const d = mix(pd - 0.012, wd - 0.03, v);
      const y = mix(e[1] - thick - 0.005, Kt.y + 0.03, v);
      return [Kt.cx + F.L[0] * a + F.O[0] * d, y, Kt.cz + F.L[1] * a + F.O[1] * d];
    }, 0.02, { up: [0, -1, 0], color: () => HM.PLASTER_SHADE, rims: [0, 0, 0, 0], open: true }),
    keepColor: true,
  });
}

// A point on a storey's wall, which leans with the storey. `p` is how far proud of it.
function hmWallPt(box, f, a, y, p) {
  const F = HM_FACES[f];
  const t = (y - box.y0) / (box.y1 - box.y0);
  const hd = F.x ? mix(box.hz0, box.hz1, t) : mix(box.hx0, box.hx1, t);
  const d = hd + p;
  return [box.cx + F.L[0] * a + F.O[0] * d, y, box.cz + F.L[1] * a + F.O[1] * d];
}

function hmWallBox(soup, box, f, a0, a1, y0, y1, p0, p1, col) {
  soup.hexa(
    [hmWallPt(box, f, a0, y0, p0), hmWallPt(box, f, a1, y0, p0), hmWallPt(box, f, a1, y0, p1), hmWallPt(box, f, a0, y0, p1)],
    [hmWallPt(box, f, a0, y1, p0), hmWallPt(box, f, a1, y1, p0), hmWallPt(box, f, a1, y1, p1), hmWallPt(box, f, a0, y1, p1)],
    col,
    { skipBottom: false },
  );
}

// There is no CSG, so a window is built forward of its wall: dark panel, pale bars, a frame projecting
// furthest. The frame's own shadow is what reads as a recess.
function hmWindow(soup, box, f, a, y0, h, w) {
  const hw = w / 2;
  const F = HM_FACES[f];
  const outN = [F.O[0], 0, F.O[1]];
  const pt = (x, y, p) => hmWallPt(box, f, x, y, p);
  const quad = (x0, x1, y1, y2, p, col) => soup.face([pt(x0, y1, p), pt(x1, y1, p), pt(x1, y2, p), pt(x0, y2, p)], col, outN);
  quad(a - hw, a + hw, y0, y0 + h, 0.012, HM.DARK);
  // The frame: a ring of four fronts, with the faces that show from an angle on its outer and inner edges.
  const FR = 0.045; const P = 0.05;
  const X0 = a - hw - FR; const X1 = a + hw + FR; const Y0 = y0 - FR; const Y1 = y0 + h + FR;
  const x0 = a - hw; const x1 = a + hw; const y1 = y0; const y2 = y0 + h;
  quad(X0, X1, Y0, y1, P, HM.PLASTER);
  quad(X0, X1, y2, Y1, P, HM.PLASTER);
  quad(X0, x0, y1, y2, P, HM.PLASTER);
  quad(x1, X1, y1, y2, P, HM.PLASTER);
  const edge = (A, B, C, D, n) => soup.face([A, B, C, D], HM.PLASTER_SHADE, n);
  const right = [F.L[0], 0, F.L[1]]; const left = [-F.L[0], 0, -F.L[1]];
  edge(pt(X0, Y0, 0), pt(X0, Y1, 0), pt(X0, Y1, P), pt(X0, Y0, P), left);
  edge(pt(X1, Y0, 0), pt(X1, Y1, 0), pt(X1, Y1, P), pt(X1, Y0, P), right);
  edge(pt(X0, Y1, 0), pt(X1, Y1, 0), pt(X1, Y1, P), pt(X0, Y1, P), [0, 1, 0]);
  edge(pt(X0, Y0, 0), pt(X1, Y0, 0), pt(X1, Y0, P), pt(X0, Y0, P), [0, -1, 0]);
  edge(pt(x0, y1, 0), pt(x0, y2, 0), pt(x0, y2, P), pt(x0, y1, P), right);
  edge(pt(x1, y1, 0), pt(x1, y2, 0), pt(x1, y2, P), pt(x1, y1, P), left);
  edge(pt(x0, y1, 0), pt(x1, y1, 0), pt(x1, y1, P), pt(x0, y1, P), [0, 1, 0]);
  edge(pt(x0, y2, 0), pt(x1, y2, 0), pt(x1, y2, P), pt(x0, y2, P), [0, -1, 0]);
  const BARS = 3;
  for (let b = 1; b <= BARS; b += 1) {
    const x = a - hw + (b / (BARS + 1)) * w;
    quad(x - 0.012, x + 0.012, y0, y0 + h, 0.028, HM.BAR);
  }
}

// The hip-and-gable that crowns every keep: hipped below a junction, a true gable above it, with a ridge
// and a shachi at each end. Written so that the long slope and the end slope share their hip exactly.
function hmTopRoof(O, K, st, { NU, NV, thick, tileColor, hipTubes }) {
  const alongX = (st.axis ?? 'x') === 'x';
  const eA = alongX ? [1, 0] : [0, 1];
  const eB = alongX ? [0, 1] : [1, 0];
  const HA = (alongX ? st.hx : st.hz) + st.over;
  const HB = (alongX ? st.hz : st.hx) + st.over;
  const R = st.y + st.rise;
  const vj = st.vj ?? 0.42;
  const ov = st.gableOver ?? 0.18;
  const gx = st.gableAt ?? Math.max(0.2, (alongX ? st.hx : st.hz) - (alongX ? st.hz : st.hx) * 0.62);
  const push = st.push; const lift = st.lift;
  const to = (a, b, y) => [K.cx + eA[0] * a + eB[0] * b, y, K.cz + eA[1] * a + eB[1] * b];
  const eY = (s) => st.y + lift * Math.abs(s) ** 3.2;
  const longY = (s, v) => mix(eY(s), R, v ** 1.55);
  const longA = (s, v) => (v < vj ? s * mix(HA + push, gx + ov, v / vj) : s * (gx + ov));
  const longB = (s, v) => mix(HB + push * Math.abs(s) ** 3, 0, v);
  const bj = longB(1, vj);
  const yj = longY(1, vj);
  const uvLong = (s, v) => [longA(s, v) / TILE_U, TILE_V0 + (1 - TILE_V0) * v];
  for (const side of [1, -1]) {
    O.tile.push({
      geometry: plate(NU, NV + 2, (u, v) => {
        const s = u * 2 - 1;
        return to(longA(s, v), side * longB(s, v), longY(s, v));
      }, thick, {
        up: [eB[0] * side * 0.5, 1, eB[1] * side * 0.5],
        uv: (p, u, v) => uvLong(u * 2 - 1, v),
        color: tileColor,
        rimDv: TILE_V0 * 0.92,
        rims: [1, 0, 0, 0],
        open: true,
      }),
      keepColor: true,
    });
    const Kt = {
      cx: K.cx, cz: K.cz, y: st.y, hx: st.hx, hz: st.hz, over: st.over, rise: st.rise, tx: 0, tz: 0, lift, push,
    };
    // The soffit under this long eave.
    const f = alongX ? (side > 0 ? 'S' : 'N') : (side > 0 ? 'E' : 'W');
    hmSoffit(O, { ...Kt, y: st.y }, f, thick);
  }
  // The two end slopes run on past the junction, under the long slopes and behind the gable's face, so
  // that the two can never show a gap.
  const wMax = (HA + push - (gx - 0.12)) / (HA + push - (gx + ov));
  for (const end of [1, -1]) {
    const endA = (s, w) => mix(HA + push * Math.abs(s) ** 3 * 0 + push, gx + ov, w);
    O.tile.push({
      geometry: plate(Math.round(NU * 0.7), NV, (u, v) => {
        const s = u * 2 - 1;
        const w = v * wMax;
        const b = s * mix(HB + push, bj, w);
        const a = endA(s, w);
        const y = mix(eY(s), yj, Math.min(w, 1.5) ** 1.55);
        return to(end * a, b, y);
      }, thick, {
        up: [eA[0] * end * 0.5, 1, eA[1] * end * 0.5],
        uv: (p, u, v) => {
          const s = u * 2 - 1;
          return [(s * mix(HB + push, bj, v * wMax)) / TILE_U, TILE_V0 + (1 - TILE_V0) * Math.min(1, v * wMax * vj)];
        },
        color: tileColor,
        rimDv: TILE_V0 * 0.92,
        rims: [1, 0, 0, 0],
        open: true,
      }),
      keepColor: true,
    });
    const fe = alongX ? (end > 0 ? 'E' : 'W') : (end > 0 ? 'S' : 'N');
    const Kt = {
      cx: K.cx, cz: K.cz, y: st.y, hx: st.hx, hz: st.hz, over: st.over, rise: st.rise, tx: 0, tz: 0, lift, push,
    };
    hmSoffit(O, Kt, fe, thick);
    // The hips, on the long slope's shared edge.
    for (const side of [1, -1]) {
      hipTubes(null, (t) => {
        const v = t * vj;
        return to(end * longA(1, v), side * longB(1, v), longY(1, v));
      });
    }
    // The gable's white face, its top cut by the roof's own curve.
    const pts = [];
    const M = 12;
    const sAt = gx / (gx + ov);
    for (let m = 0; m <= M; m += 1) {
      const v = mix(vj, 1, m / M);
      pts.push([longB(sAt, v), mix(st.y + lift * sAt ** 3.2, R, v ** 1.55) - 0.03]);
    }
    const yBase = yj - 0.08;
    const face = (b, y) => to(end * gx, b, y);
    const outN = [eA[0] * end, 0, eA[1] * end];
    const c0 = face(0, yBase);
    const ring = [...pts.map(([b, y]) => face(b, y)), ...[...pts].reverse().map(([b, y]) => face(-b, y)).slice(1)];
    for (let m = 0; m < ring.length - 1; m += 1) O.plaster.face([c0, ring[m], ring[m + 1]], HM.PLASTER, outN);
    O.plaster.face([c0, face(bj, yBase), ring[0]], HM.PLASTER, outN);
    O.plaster.face([c0, ring[ring.length - 1], face(-bj, yBase)], HM.PLASTER, outN);
    // Struts on the face: a tie beam and a king post, the timber a white gable keeps in relief.
    const beamY = mix(yBase, R, 0.34);
    const halfAtBeam = (() => { for (const [b, y] of pts) if (y >= beamY) return b; return 0.1; })();
    O.plaster.hexa(
      [to(end * (gx - 0.01), -halfAtBeam, beamY), to(end * (gx - 0.01), halfAtBeam, beamY), to(end * (gx + 0.03), halfAtBeam, beamY), to(end * (gx + 0.03), -halfAtBeam, beamY)],
      [to(end * (gx - 0.01), -halfAtBeam, beamY + 0.05), to(end * (gx - 0.01), halfAtBeam, beamY + 0.05), to(end * (gx + 0.03), halfAtBeam, beamY + 0.05), to(end * (gx + 0.03), -halfAtBeam, beamY + 0.05)],
      HM.PLASTER_SHADE,
    );
    // The bargeboards along both rakes, and a roll of tile on them.
    const edgeAt = end * (gx + ov);
    for (const side of [1, -1]) {
      O.plaster.parts.push({
        geometry: plate(6, 1, (u, v) => {
          const vv = mix(vj, 1, u);
          return to(edgeAt + end * 0.005, side * longB(1, vv), longY(1, vv) - thick * 0.6 - v * 0.13);
        }, 0.05, { up: [eA[0] * end, 0, eA[1] * end], color: () => HM.PLASTER, rims: [1, 0, 1, 0] }),
        keepColor: true,
      });
      const roll = [];
      for (let m = 0; m <= 4; m += 1) {
        const vv = mix(vj, 1, m / 4);
        roll.push(to(edgeAt - end * 0.01, side * longB(1, vv), longY(1, vv) + 0.03));
      }
      O.plain.push({ geometry: tube(roll, 0.035, { sides: 4, steps: 6, round: 0 }), color: HM.RIDGE_DARK });
    }
    // The hanging ornament at the gable's peak.
    const pk = R - 0.14;
    O.plaster.hexa(
      [to(edgeAt + end * 0.03, -0.012, pk - 0.26), to(edgeAt + end * 0.03, 0.012, pk - 0.26), to(edgeAt + end * 0.06, 0.012, pk - 0.26), to(edgeAt + end * 0.06, -0.012, pk - 0.26)],
      [to(edgeAt + end * 0.03, -0.09, pk), to(edgeAt + end * 0.03, 0.09, pk), to(edgeAt + end * 0.06, 0.09, pk), to(edgeAt + end * 0.06, -0.09, pk)],
      HM.PLASTER,
    );
  }
  // The ridge: stacked white-plastered courses under a dark cap, the line at the very top of the keep.
  const rl = gx + ov + 0.03;
  const rh = st.ridgeH ?? 0.1;
  const rr = rh * 0.9;
  const ridgeSeg = (a0, a1, b0, b1, y0, y1, col) => O.plaster.hexa(
    [to(a0, -b0, y0), to(a1, -b0, y0), to(a1, b0, y0), to(a0, b0, y0)],
    [to(a0, -b1, y1), to(a1, -b1, y1), to(a1, b1, y1), to(a0, b1, y1)],
    col,
  );
  ridgeSeg(-rl, rl, rr * 0.95, rr * 0.8, R - rh, R + rh * 0.55, HM.RIDGE_PALE);
  ridgeSeg(-rl, rl, rr * 0.8, rr * 0.7, R + rh * 0.55, R + rh * 0.8, HM.RIDGE_DARK);
  O.plain.push({
    geometry: tube([to(-rl, 0, R + rh * 0.95), to(rl, 0, R + rh * 0.95)], rr * 0.62, { sides: 6, steps: 1, round: 1, straight: true }),
    color: HM.RIDGE_DARK,
  });
  if (st.shachi) {
    for (const end of [1, -1]) {
      hmShachi(O.plain, to(end * (rl - st.shachi * 0.14), 0, R + rh * 0.95), [eA[0] * end, 0, eA[1] * end], st.shachi);
    }
  } else {
    for (const end of [1, -1]) {
      const c = to(end * rl, 0, R + rh * 0.95);
      O.plain.push({ geometry: tube([c, add(c, [eA[0] * end * 0.05, 0.1, eA[1] * end * 0.05])], [rr * 0.95, rr * 0.5], { sides: 6, steps: 1, round: 1, straight: true }), color: HM.RIDGE_DARK });
    }
  }
}

// A dormer gable on a skirt of roof, in its two styles. `chidori` is the triangle, its rakes falling
// concave to the eaves; `kara` is the rolling curved gable, convex at the crown and concave at its ends,
// a single smooth bell. Both go back into the roof far enough to meet it wherever it rises.
function hmGable(O, Kt, g) {
  const F = HM_FACES[g.face];
  const hw = g.W / 2;
  const H = g.H;
  const v0 = g.v0 ?? (g.kind === 'kara' ? 0.04 : 0.26);
  const ha = F.x ? Kt.hz + Kt.over : Kt.hx + Kt.over;
  const td = F.x ? Kt.tz : Kt.tx;
  const dF = mix(ha, td, v0);
  const y0 = mix(Kt.y, Kt.y + Kt.rise, v0 ** 1.55) + (g.kind === 'kara' ? 0.02 : -0.03);
  const dB = td - 0.3;
  const prof = g.kind === 'kara'
    ? (t) => Math.cos((Math.PI / 2) * t) ** 2
    : (t) => (1 - t) ** 1.4 + 0.035 * t ** 5;
  const to = (a, d, y) => [Kt.cx + F.L[0] * (g.a + a) + F.O[0] * d, y, Kt.cz + F.L[1] * (g.a + a) + F.O[1] * d];
  const OV = 0.16;
  const dFront = dF + OV;
  const outN = [F.O[0], 0, F.O[1]];
  const tileC = (p) => times(HM.TILE, 0.94 + 0.12 * fbm(p[0] * 0.8, p[1] * 0.8, p[2] * 0.8, 2));
  const NUP = g.kind === 'kara' ? 18 : 7;
  const thick = 0.07;
  const yOf = (t) => y0 + H * prof(t);
  if (g.kind === 'kara') {
    O.tile.push({
      geometry: plate(NUP, 2, (u, v) => {
        const t = Math.abs(u * 2 - 1);
        return to((u * 2 - 1) * hw, mix(dFront, dB, v), yOf(t));
      }, thick, {
        up: [0, 1, 0],
        uv: (p, u, v) => [mix(dFront, dB, v) / TILE_U, TILE_V0 + (1 - TILE_V0) * (1 - Math.abs(u * 2 - 1))],
        color: tileC,
        rimDv: TILE_V0 * 0.9,
        rims: [1, 0, 0, 0],
        open: true,
      }),
      keepColor: true,
    });
  } else {
    for (const side of [1, -1]) {
      O.tile.push({
        geometry: plate(NUP, 2, (u, v) => to(side * u * hw, mix(dFront, dB, v), yOf(u)), thick, {
          up: [F.L[0] * side * 0.5, 1, F.L[1] * side * 0.5],
          uv: (p, u, v) => [mix(dFront, dB, v) / TILE_U, TILE_V0 + (1 - TILE_V0) * (1 - u)],
          color: tileC,
          rimDv: TILE_V0 * 0.9,
          rims: [1, 0, 0, 0],
          open: true,
        }),
        keepColor: true,
      });
    }
  }
  // The white face, with its top cut by the roof's profile.
  const M = g.kind === 'kara' ? 14 : 8;
  const top = [];
  for (let m = 0; m <= M; m += 1) {
    const t = (m / M) * 2 - 1;
    top.push(to(t * (hw - 0.03), dF, yOf(Math.abs(t)) - 0.05));
  }
  const yLow = y0 - 0.16;
  const c0 = to(0, dF, yLow);
  const bl = to(-(hw - 0.03), dF, yLow); const br = to(hw - 0.03, dF, yLow);
  O.plaster.face([c0, bl, top[0]], HM.PLASTER, outN);
  for (let m = 0; m < M; m += 1) O.plaster.face([c0, top[m], top[m + 1]], HM.PLASTER, outN);
  O.plaster.face([c0, top[M], br], HM.PLASTER, outN);
  // Its sides, back into the roof, so that from the flank it is a solid and not a card.
  if (g.kind !== 'kara') for (let m = 0; m < M; m += 1) {
    const a = top[m]; const b = top[m + 1];
    const a2 = sub(a, scl(outN, dF - dB)); const b2 = sub(b, scl(outN, dF - dB));
    const mid = scl(add(a, b), 0.5);
    O.plaster.face([a, b, b2, a2], HM.PLASTER_SHADE, sub(mid, to(0, dF, yLow)));
  }
  // The bargeboard along the front, standing proud of the face, with its own thickness.
  const BW = g.kind === 'kara' ? 0.16 : 0.13;
  const nb = g.kind === 'kara' ? 14 : 6;
  const board = (side) => O.plaster.parts.push({
    geometry: plate(nb, 1, (u, v) => {
      const s = side === 0 ? u * 2 - 1 : side * u;
      const t = Math.abs(s);
      return to(s * (hw + 0.005), dFront - 0.015, yOf(t) - thick * 0.75 - v * BW);
    }, 0.05, { up: outN, color: () => HM.PLASTER, rims: [1, 0, 1, 0] }),
    keepColor: true,
  });
  if (g.kind === 'kara') board(0); else { board(1); board(-1); }
  // Under the eave of the overhang, a soffit back to the face.
  O.plaster.parts.push({
    geometry: plate(nb, 1, (u, v) => {
      const s = u * 2 - 1;
      return to(s * (hw + 0.005), mix(dFront - 0.06, dF - 0.02, v), yOf(Math.abs(s)) - thick * 0.75 - BW * 0.9);
    }, 0.012, { up: [0, -1, 0], color: () => HM.PLASTER_SHADE, rims: [0, 0, 0, 0], open: true }),
    keepColor: true,
  });
  // A roll of tile along the rake, and the ridge running back into the roof.
  const rollPts = (side) => {
    const out = [];
    const N = g.kind === 'kara' ? 12 : 4;
    for (let m = 0; m <= N; m += 1) {
      const s = side === 0 ? (m / N) * 2 - 1 : side * (m / N);
      out.push(to(s * (hw + 0.012), dFront + 0.004, yOf(Math.abs(s)) + 0.02));
    }
    return out;
  };
  if (g.kind === 'kara') {
    O.plain.push({ geometry: tube(rollPts(0), 0.036, { sides: 5, steps: 14, round: 0 }), color: HM.RIDGE_DARK });
  } else {
    O.plain.push({ geometry: tube(rollPts(1), 0.034, { sides: 4, steps: 5, round: 0 }), color: HM.RIDGE_DARK });
    O.plain.push({ geometry: tube(rollPts(-1), 0.034, { sides: 4, steps: 5, round: 0 }), color: HM.RIDGE_DARK });
    const apex = yOf(0);
    O.plain.push(ridgeTube([to(0, dFront + 0.02, apex + 0.05), to(0, dB, apex + 0.05)], 0.065, { sides: 5, steps: 1, pale: HM.RIDGE_PALE, dark: HM.RIDGE_DARK }));
    // The end tile at the ridge's front.
    const e0 = to(0, dFront + 0.03, apex + 0.05);
    O.plain.push({ geometry: tube([e0, add(e0, [F.O[0] * 0.03, 0.15, F.O[1] * 0.03])], [0.085, 0.05], { sides: 5, steps: 1, round: 0, straight: true }), color: HM.RIDGE_DARK });
  }
  // The pendant ornament at the crown of the board.
  const py = yOf(0) - thick * 0.75 - BW * 0.4;
  O.plaster.hexa(
    [to(-0.012, dFront + 0.002, py - 0.22), to(0.012, dFront + 0.002, py - 0.22), to(0.012, dFront + 0.028, py - 0.22), to(-0.012, dFront + 0.028, py - 0.22)],
    [to(-0.08, dFront + 0.002, py), to(0.08, dFront + 0.002, py), to(0.08, dFront + 0.028, py), to(-0.08, dFront + 0.028, py)],
    g.kind === 'kara' ? HM.RIDGE_DARK : HM.PLASTER,
  );
  // A big gable carries a tie beam and a barred window, as the real ones do.
  if (g.kind === 'chidori' && g.W >= 2.2) {
    const by = y0 + H * 0.22;
    const half = (1 - (0.22) ** (1 / 1.4)) * hw;
    const bw = to(-half, dF - 0.01, by); const be = to(half, dF - 0.01, by);
    const fw = to(-half, dF + 0.025, by); const fe = to(half, dF + 0.025, by);
    const up = (q) => [q[0], q[1] + 0.05, q[2]];
    O.plaster.hexa([bw, be, fe, fw], [up(bw), up(be), up(fe), up(fw)], HM.PLASTER_SHADE);
    const wh = H * 0.22; const wwy = by + 0.08;
    const wbox = { cx: Kt.cx + F.L[0] * g.a, cz: Kt.cz + F.L[1] * g.a, y0: wwy - 1, y1: wwy + 2, hx0: dF, hz0: dF, hx1: dF, hz1: dF };
    if (F.x) { wbox.hz0 = dF; wbox.hz1 = dF; } else { wbox.hx0 = dF; wbox.hx1 = dF; }
    hmWindow(O.plaster, { ...wbox, cx: Kt.cx + F.L[0] * g.a, cz: Kt.cz + F.L[1] * g.a }, g.face, 0, wwy, wh, g.W * 0.16);
  }
}

// A stone foundation on the fan's curve: four faces, a flat top, and long-and-short quoins up each corner.
function hmStoneBase(O, cx, cz, hx, hz, y0, y1, spread, quoins = true) {
  const col = (p) => {
    const n = fbm(p[0] * 0.5 + 3, p[1] * 0.9, p[2] * 0.5, 3);
    const k = 0.78 + 0.42 * n;
    const c = times(HM.STONE, k);
    return mix3(c, times(c, 0.6), (1 - sstep(p[1] - y0, 0, 0.5)) * 0.5);
  };
  for (const f of HM_FACE_LIST) {
    const F = HM_FACES[f];
    const ha = F.x ? hx : hz;
    const hd = F.x ? hz : hx;
    O.stone.push({
      geometry: plate(quoins ? 5 : 3, 9, (u, v) => {
        const s = u * 2 - 1;
        const off = ogiOff(spread, v);
        const a = s * (ha + off);
        const d = hd + off;
        return [cx + F.L[0] * a + F.O[0] * d, mix(y0, y1, v), cz + F.L[1] * a + F.O[1] * d];
      }, 0.1, {
        up: [F.O[0], 0.4, F.O[1]],
        uv: (p, u, v) => [((p[0] - cx) * F.L[0] + (p[2] - cz) * F.L[1]) / 2.4, ogiArc(spread, y1 - y0, v) / 2.4],
        color: col,
        rims: [0, 0, 0, 0],
      }),
      keepColor: true,
    });
  }
  O.stoneSoup.box(cx - hx - 0.01, y1 - 0.1, cz - hz - 0.01, cx + hx + 0.01, y1, cz + hz + 0.01, times(HM.STONE, 0.92));
  if (!quoins) return;
  // The quoins: long and short alternately along each face, standing a hair proud.
  const COURSE = 0.24;
  const courses = Math.floor((y1 - y0) / COURSE);
  const pale = times(HM.STONE, 1.12);
  for (let k = 0; k < courses; k += 1) {
    const ya = y0 + k * COURSE + 0.01; const yb = ya + COURSE - 0.018;
    const va = (ya - y0) / (y1 - y0); const vb = (yb - y0) / (y1 - y0);
    const oa = ogiOff(spread, va) + 0.014; const ob = ogiOff(spread, vb) + 0.014;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const longX = (k + (sx * sz > 0 ? 0 : 1)) % 2 === 0;
      const lx = longX ? 0.62 : 0.3; const lz = longX ? 0.3 : 0.62;
      const lv = (o, y) => {
        const X = hx + o; const Z = hz + o;
        return [[cx + sx * X, y, cz + sz * Z], [cx + sx * (X - lx), y, cz + sz * Z], [cx + sx * (X - lx), y, cz + sz * (Z - lz)], [cx + sx * X, y, cz + sz * (Z - lz)]];
      };
      O.stoneSoup.hexa(lv(oa, ya), lv(ob, yb), pale, { skipBottom: true });
    }
  }
}

// A rectangle with chamfered corners, going round; every wall on the site is drawn from one of these.
function hmPoly(hx, hz, c) {
  return [[hx - c, hz], [hx, hz - c], [hx, -hz + c], [hx - c, -hz], [-hx + c, -hz], [-hx, -hz + c], [-hx, hz - c], [-hx + c, hz]];
}

function hmSiteWall(O, hx, hz, c, y0, y1, spread, { step = 2, facing = 1 } = {}) {
  const P1 = hmPoly(hx, hz, c);
  const P0 = hmPoly(hx + spread, hz + spread, c);
  const off = (v) => ogiOff(spread, v);
  for (let e = 0; e < 8; e += 1) {
    const e2 = (e + 1) % 8;
    const lerpP = (P, Q, t) => [mix(P[0], Q[0], t), mix(P[1], Q[1], t)];
    const len = Math.hypot(P1[e2][0] - P1[e][0], P1[e2][1] - P1[e][1]);
    const out = norm([(P1[e][0] + P1[e2][0]), 0, (P1[e][1] + P1[e2][1])]);
    const n = Math.max(1, Math.round(len / step));
    O.stone.push({
      geometry: plate(n, 9, (u, v) => {
        const w = off(v) / spread;
        const a = lerpP(P1[e], P1[e2], u); const b = lerpP(P0[e], P0[e2], u);
        return [mix(a[0], b[0], w), mix(y0, y1, v), mix(a[1], b[1], w)];
      }, 0.1, {
        up: [out[0] * facing, facing > 0 ? 0.5 : 0, out[2] * facing],
        uv: (p, u, v) => [(u * len) / 2.4, ogiArc(spread, y1 - y0, v) / 2.4],
        color: (p) => {
          const k = 0.8 + 0.4 * fbm(p[0] * 0.45 + 9, p[1] * 0.9, p[2] * 0.45, 3);
          const moss = (1 - sstep(p[1] - y0, 0, 0.55)) * 0.55 * sstep(fbm(p[0] * 0.8, 2, p[2] * 0.8, 2), 0.42, 0.62);
          return mix3(times(HM.STONE, k), lin(0x5f6b3e), moss);
        },
        rims: [0, 0, 0, 0],
      }),
      keepColor: true,
    });
  }
}

// A grass surface between closed polygons, walking inward. Measured so that it faces up.
function hmGround(parts, rows, colour) {
  const first = hmPoly(rows[0].hx, rows[0].hz, rows[0].c);
  const per = [];
  for (let e = 0; e < 8; e += 1) {
    const a = first[e]; const b = first[(e + 1) % 8];
    per.push(Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.8)));
  }
  const cols = per.reduce((s, v) => s + v, 0);
  const pos = []; const col = []; const uv = []; const idx = [];
  for (const row of rows) {
    const P = hmPoly(row.hx, row.hz, row.c);
    for (let e = 0; e < 8; e += 1) {
      const a = P[e]; const b = P[(e + 1) % 8];
      for (let k = 0; k < per[e]; k += 1) {
        const t = k / per[e];
        const x = mix(a[0], b[0], t); const z = mix(a[1], b[1], t);
        const y = row.y + (row.wob ? (fbm(x * 0.5, 3, z * 0.5, 2) - 0.5) * row.wob : 0);
        pos.push(x, y, z);
        const c = colour(x, y, z);
        col.push(c[0], c[1], c[2]);
        uv.push(x * 0.9, z * 0.9);
      }
    }
  }
  for (let r = 0; r < rows.length - 1; r += 1) {
    for (let j = 0; j < cols; j += 1) {
      const j2 = (j + 1) % cols;
      const a = r * cols + j; const b = r * cols + j2; const c = (r + 1) * cols + j2; const d = (r + 1) * cols + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const pt = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const n = cross(sub(pt(idx[1]), pt(idx[0])), sub(pt(idx[2]), pt(idx[0])));
  if (n[1] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  parts.push({ geometry: g, keepColor: true });
}

// A garden pine, clipped into pads, as castle grounds have them.
function hmPine(parts, x, y, z, size, seed) {
  const rng = seededRandom(seed);
  const bark = lin(0x4b3a2c);
  const top = [x + (rng() - 0.5) * size * 0.3, y + size * 0.92, z + (rng() - 0.5) * size * 0.3];
  const mid = [x + (rng() - 0.5) * size * 0.25, y + size * 0.5, z + (rng() - 0.5) * size * 0.25];
  parts.push({ geometry: tube([[x, y - 0.05, z], mid, top], [size * 0.055, size * 0.04, size * 0.02], { sides: 7, steps: 6, round: 0 }), color: bark });
  const pads = 4;
  for (let i = 0; i < pads; i += 1) {
    const t = 0.42 + (i / (pads - 1)) * 0.58;
    const a = rng() * 6.28;
    const out = (1 - t) * size * 0.34 + size * 0.04;
    const cx = mix(x, top[0], t) + Math.sin(a) * out;
    const cz = mix(z, top[2], t) + Math.cos(a) * out;
    const cy = y + t * size * 0.98;
    const rx = size * (0.36 - t * 0.14);
    if (i < pads - 1) parts.push({ geometry: tube([mix3([x, y + t * size * 0.9, z], mid, 0.3), [cx, cy - 0.02, cz]], [size * 0.018, size * 0.01], { sides: 5, steps: 1, round: 0, straight: true }), color: bark });
    const g = new THREE.SphereGeometry(1, 10, 5);
    g.scale(rx, rx * 0.42, rx * (0.8 + rng() * 0.3));
    g.translate(cx, cy, cz);
    const G0 = lin(0x25442a); const G1 = lin(0x4d7337);
    tintVertices(g, (px, py, pz, out2) => {
      const k = clamp01((py - cy) / (rx * 0.42) * 0.5 + 0.5);
      const n = fbm(px * 4, py * 4, pz * 4, 2);
      const c = mix3(G0, G1, k * 0.8 + n * 0.3);
      out2[0] = c[0]; out2[1] = c[1]; out2[2] = c[2];
    });
    parts.push({ geometry: g, keepColor: true });
  }
}

function himejiCastle() {
  const O = {
    tile: [], stone: [], plain: [], grass: [],
    plaster: new Soup(), stoneSoup: new Soup(),
  };
  O.plaster.parts = [];

  // --- the site: a moat, a stone-walled hill, a white wall along its top ------------------------------
  const HILL = { hx: 10.0, hz: 8.5, c: 1.3 };
  const TERRACE_Y = 1.4;
  const FOOT = 0.95;
  const MOAT_W = 1.05;
  const RIM = 0.55;
  const G_A = lin(0x56753a); const G_B = lin(0x7a8f46); const SAND = lin(0xa8997a); const G_MOAT = lin(0x3f5a30);
  const grassCol = (x, y, z) => {
    const n = fbm(x * 0.35 + 4, 1, z * 0.35, 3);
    return mix3(G_A, G_B, sstep(n, 0.36, 0.66));
  };
  const outerX = HILL.hx + FOOT + MOAT_W; const outerZ = HILL.hz + FOOT + MOAT_W;
  hmGround(O.grass, [
    { hx: outerX + RIM, hz: outerZ + RIM, c: HILL.c, y: 0.0 },
    { hx: outerX + RIM - 0.14, hz: outerZ + RIM - 0.14, c: HILL.c, y: 0.46 },
    { hx: outerX + 0.02, hz: outerZ + 0.02, c: HILL.c, y: 0.5 },
  ], grassCol);
  hmGround(O.grass, [
    { hx: outerX + 0.06, hz: outerZ + 0.06, c: HILL.c, y: 0.1 },
    { hx: outerX - MOAT_W * 0.5, hz: outerZ - MOAT_W * 0.5, c: HILL.c, y: 0.07 },
    { hx: HILL.hx + FOOT - 0.06, hz: HILL.hz + FOOT - 0.06, c: HILL.c, y: 0.1 },
  ], (x, y, z) => mix3(G_MOAT, lin(0x8a8560), sstep(fbm(x * 0.7, 2, z * 0.7, 2), 0.4, 0.62) * 0.65));
  // The courtyard and terrace, gravelled round the keeps.
  const onPath = (x, z) => 1 - sstep(Math.abs(x) - 1.0 - (z < 6.5 ? (6.5 - z) * 0.2 : 0), 0, 0.5);
  hmGround(O.grass, [
    { hx: HILL.hx + 0.03, hz: HILL.hz + 0.03, c: HILL.c, y: TERRACE_Y },
    { hx: HILL.hx - 1.2, hz: HILL.hz - 1.2, c: HILL.c, y: TERRACE_Y + 0.02 },
    { hx: HILL.hx - 3.2, hz: HILL.hz - 3.2, c: HILL.c * 0.6, y: TERRACE_Y + 0.02 },
    { hx: 0.4, hz: 0.4, c: 0.1, y: TERRACE_Y + 0.02 },
  ], (x, y, z) => mix3(grassCol(x, y, z), SAND, Math.max(z > 0 ? onPath(x, z) * 0.9 : 0, 0.0)));
  hmSiteWall(O, HILL.hx, HILL.hz, HILL.c, 0.08, TERRACE_Y, FOOT);
  hmSiteWall(O, outerX, outerZ, HILL.c, 0.04, 0.52, 0.0001, { step: 3, facing: -1 });

  // A stone land-bridge over the moat and a flight of steps up to the gate.
  const STONE_TOP = times(HM.STONE, 0.95);
  const CW = 1.15;
  O.stoneSoup.box(-CW, 0.05, HILL.hz + FOOT, CW, 0.5, outerZ + 0.02, STONE_TOP);
  {
    const z0 = HILL.hz + FOOT; const z1 = HILL.hz + 0.02;
    const STEPS = 8;
    for (let s = 0; s < STEPS; s += 1) {
      const y = mix(0.5, TERRACE_Y, (s + 1) / STEPS);
      const za = mix(z0, z1, s / STEPS);
      O.stoneSoup.box(-CW, 0.05, z1 - 0.1, CW, y, za, times(STONE_TOP, 0.94 + (s % 2) * 0.08));
    }
    for (const sgn of [-1, 1]) {
      O.stoneSoup.box(sgn * CW - 0.1, 0.05, z1, sgn * CW + 0.1, TERRACE_Y + 0.12, z0, times(HM.STONE, 0.86));
    }
  }

  // --- the white wall along the top of the hill, with its tile coping and its gun ports -----------------
  const W_H = 0.46;
  const WALLP = hmPoly(HILL.hx - 0.05, HILL.hz - 0.05, HILL.c);
  const GATE = 1.4;
  const portCycle = ['circle', 'triangle', 'square'];
  let portIndex = 0;
  for (let e = 0; e < 8; e += 1) {
    const a0 = WALLP[e]; const b0 = WALLP[(e + 1) % 8];
    // The south run is split for the gate.
    const southRun = a0[1] === b0[1] && a0[1] > 0;
    const segs = southRun ? [[a0, [-GATE, a0[1]]], [[GATE, a0[1]], b0]] : [[a0, b0]];
    for (const [a, b] of segs) {
      const dir = norm([b[0] - a[0], 0, b[1] - a[1]]);
      const out = [-dir[2], 0, dir[0]];
      const sgn = out[0] * (a[0] + b[0]) + out[2] * (a[1] + b[1]) >= 0 ? 1 : -1;
      const nx = out[0] * sgn; const nz = out[2] * sgn;
      const T = 0.11;
      const corner = (q, side, y) => [q[0] + nx * side, y, q[1] + nz * side];
      // Each run reaches a little past its corner, so that the wall and its coping close on the next one.
      const xa = southRun && a[0] === GATE ? [a[0], a[1]] : [a[0] - dir[0] * 0.14, a[1] - dir[2] * 0.14];
      const xb = southRun && b[0] === -GATE ? [b[0], b[1]] : [b[0] + dir[0] * 0.14, b[1] + dir[2] * 0.14];
      O.plaster.hexa(
        [corner(xa, -T, TERRACE_Y - 0.1), corner(xb, -T, TERRACE_Y - 0.1), corner(xb, T, TERRACE_Y - 0.1), corner(xa, T, TERRACE_Y - 0.1)],
        [corner(xa, -T, TERRACE_Y + W_H), corner(xb, -T, TERRACE_Y + W_H), corner(xb, T, TERRACE_Y + W_H), corner(xa, T, TERRACE_Y + W_H)],
        HM.PLASTER,
      );
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const nSeg = Math.max(2, Math.round(len / 1.5));
      for (const side of [1, -1]) {
        O.tile.push({
          geometry: plate(nSeg, 1, (u, v) => {
            const q = [mix(xa[0], xb[0], u), mix(xa[1], xb[1], u)];
            const w = mix(0.26, 0, v);
            const lift = 0.02 * Math.abs(u * 2 - 1) ** 3;
            return [q[0] + nx * side * w, TERRACE_Y + W_H + lift + (1 - (1 - v) ** 1.5) * 0.16, q[1] + nz * side * w];
          }, 0.03, {
            up: [nx * side * 0.5, 1, nz * side * 0.5],
            uv: (p, u, v) => [(u * len) / TILE_U, TILE_V0 + (1 - TILE_V0) * v],
            color: () => HM.TILE,
            rimDv: TILE_V0 * 0.9,
            rims: [1, 0, 0, 0],
            open: true,
          }),
          keepColor: true,
        });
      }
      O.plain.push({ geometry: tube([[xa[0], TERRACE_Y + W_H + 0.18, xa[1]], [xb[0], TERRACE_Y + W_H + 0.18, xb[1]]], 0.035, { sides: 5, steps: 1, round: 1, straight: true }), color: HM.RIDGE_DARK });
      // Ports in three shapes on the outer face: round, triangular and square, as the real walls have.
      const count = Math.floor(len / 0.95);
      for (let k = 0; k < count; k += 1) {
        const t = (k + 0.5) / count;
        const p = [mix(a[0], b[0], t), mix(a[1], b[1], t)];
        const kind = portCycle[portIndex % 3]; portIndex += 1;
        const yc = TERRACE_Y + W_H * 0.55;
        const R = 0.055;
        const pts = [];
        if (kind === 'circle') for (let m = 0; m < 8; m += 1) { const ang = (m / 8) * 6.2832; pts.push([Math.cos(ang) * R, Math.sin(ang) * R]); }
        else if (kind === 'triangle') pts.push([-R * 1.1, -R], [R * 1.1, -R], [0, R * 1.1]);
        else pts.push([-R, -R], [R, -R], [R, R], [-R, R]);
        const to3 = (q) => [p[0] + dir[0] * q[0] + nx * (T + 0.004), yc + q[1], p[1] + dir[2] * q[0] + nz * (T + 0.004)];
        O.plaster.face(pts.map(to3), HM.DARK, [nx, 0, nz]);
      }
    }
  }

  // --- the keeps. Plan positions at 1/10, with the ring round its small courtyard ----------------------
  const STONE_MAIN = TERRACE_Y + 3.0;
  const MX = 3.5; const MZ = 2.9;
  const WX = -6.4; const WZ = 4.0;
  const IX = -5.9; const IZ = -3.4;
  const EX = 2.5; const EZ = -5.0;

  // Five outer roofs. Which gable sits on which roof and face is as near as we could keep it to the real
  // elevations, alternating the triangle and the curve as the south face does; see the report.
  const greatKeep = {
    cx: MX,
    cz: MZ,
    y0: STONE_MAIN,
    storeys: [
      {
        hx: 3.85, hz: 3.0, y: STONE_MAIN + 1.5, over: 0.62, rise: 0.8, lift: 0.27, push: 0.2,
        win: { S: 7, N: 7, E: 5, W: 5 },
        gables: [
          { face: 'S', a: -1.75, kind: 'chidori', W: 1.9, H: 0.86 },
          { face: 'S', a: 1.75, kind: 'chidori', W: 1.9, H: 0.86 },
          { face: 'E', a: 0, kind: 'kara', W: 2.0, H: 0.4 },
          { face: 'W', a: 0, kind: 'kara', W: 2.0, H: 0.4 },
          { face: 'N', a: 0, kind: 'chidori', W: 2.4, H: 0.9 },
        ],
      },
      {
        hx: 3.45, hz: 2.62, y: STONE_MAIN + 3.3, over: 0.6, rise: 0.78, lift: 0.27, push: 0.2,
        win: { S: 6, N: 6, E: 5, W: 5 },
        gables: [
          { face: 'S', a: 0, kind: 'kara', W: 2.7, H: 0.5 },
          { face: 'N', a: 0, kind: 'kara', W: 2.2, H: 0.42 },
          { face: 'E', a: 1.0, kind: 'chidori', W: 1.7, H: 0.8 },
          { face: 'E', a: -1.0, kind: 'chidori', W: 1.7, H: 0.8 },
          { face: 'W', a: 1.0, kind: 'chidori', W: 1.7, H: 0.8 },
          { face: 'W', a: -1.0, kind: 'chidori', W: 1.7, H: 0.8 },
        ],
      },
      {
        hx: 2.92, hz: 2.2, y: STONE_MAIN + 5.05, over: 0.58, rise: 0.76, lift: 0.26, push: 0.19,
        win: { S: 5, N: 5, E: 4, W: 4 },
        gables: [
          { face: 'S', a: -1.15, kind: 'chidori', W: 1.65, H: 0.82 },
          { face: 'S', a: 1.15, kind: 'chidori', W: 1.65, H: 0.82 },
          { face: 'E', a: 0, kind: 'chidori', W: 3.1, H: 1.32, v0: 0.2 },
          { face: 'W', a: 0, kind: 'chidori', W: 3.1, H: 1.32, v0: 0.2 },
          { face: 'N', a: 0, kind: 'chidori', W: 2.2, H: 0.95 },
        ],
      },
      {
        hx: 2.42, hz: 1.82, y: STONE_MAIN + 6.72, over: 0.55, rise: 0.7, lift: 0.25, push: 0.18,
        win: { S: 4, N: 3, E: 3, W: 3 },
        gables: [
          { face: 'S', a: 0, kind: 'chidori', W: 2.5, H: 1.08, v0: 0.2 },
          { face: 'N', a: 0, kind: 'kara', W: 1.9, H: 0.38 },
          { face: 'E', a: 0, kind: 'kara', W: 1.7, H: 0.36 },
          { face: 'W', a: 0, kind: 'kara', W: 1.7, H: 0.36 },
        ],
      },
      {
        hx: 2.06, hz: 1.52, y: STONE_MAIN + 8.3, over: 0.58, rise: 1.5, lift: 0.28, push: 0.2, vj: 0.5,
        win: { S: 4, N: 4, E: 3, W: 3 },
        shachi: 0.62,
        ridgeH: 0.12,
        gableAt: 1.0,
        gables: [
          { face: 'S', a: 0, kind: 'kara', W: 1.65, H: 0.34, v0: 0.03 },
          { face: 'N', a: 0, kind: 'kara', W: 1.65, H: 0.34, v0: 0.03 },
        ],
      },
    ],
  };
  hmStoneBase(O, MX, MZ, 3.9, 3.05, TERRACE_Y, STONE_MAIN, 1.25);
  hmKeep(O, greatKeep);

  // The three small keeps. Each is three outer roofs, on its own lower stone.
  const smallKeep = (cx, cz, hx, hz, H, y0, gableFor, axis = 'x', top = {}) => ({
    cx,
    cz,
    y0,
    nu: 12,
    nv: 4,
    hipR: 0.055,
    eaveT: 0.08,
    storeys: [
      {
        hx, hz, y: y0 + H * 0.3, over: 0.46, rise: 0.56, lift: 0.2, push: 0.15,
        win: { S: 3, N: 3, E: 2, W: 2 }, winW: 0.34,
        gables: gableFor[0],
      },
      {
        hx: hx * 0.82, hz: hz * 0.82, y: y0 + H * 0.58, over: 0.42, rise: 0.5, lift: 0.19, push: 0.14,
        win: { S: 2, N: 2, E: 2, W: 2 }, winW: 0.3,
        gables: gableFor[1],
      },
      {
        hx: hx * 0.64, hz: hz * 0.64, y: y0 + H * 0.8, over: 0.44, rise: H * 0.22 + 0.15, lift: 0.2, push: 0.15, vj: 0.5,
        win: { S: 2, N: 2, E: 2, W: 2 }, winW: 0.28,
        axis,
        shachi: 0.36,
        ridgeH: 0.08,
        gableAt: (axis === 'x' ? hx : hz) * 0.32,
        gables: gableFor[2],
        ...top,
      },
    ],
  });
  const STONE_SMALL = TERRACE_Y + 2.3;
  hmStoneBase(O, WX, WZ, 2.0, 1.7, TERRACE_Y, STONE_SMALL, 0.85);
  hmKeep(O, smallKeep(WX, WZ, 1.95, 1.65, 4.3, STONE_SMALL, [
    [{ face: 'S', a: 0, kind: 'kara', W: 1.5, H: 0.34 }, { face: 'W', a: 0, kind: 'chidori', W: 1.4, H: 0.62 }],
    [{ face: 'S', a: 0, kind: 'chidori', W: 1.3, H: 0.6 }],
    [],
  ]));
  hmStoneBase(O, IX, IZ, 2.25, 1.9, TERRACE_Y, STONE_SMALL, 0.85);
  hmKeep(O, smallKeep(IX, IZ, 2.2, 1.85, 4.9, STONE_SMALL, [
    [{ face: 'W', a: 0, kind: 'chidori', W: 1.6, H: 0.7 }, { face: 'N', a: 0, kind: 'kara', W: 1.5, H: 0.34 }, { face: 'S', a: 0, kind: 'chidori', W: 1.6, H: 0.7 }],
    [{ face: 'S', a: 0, kind: 'kara', W: 1.4, H: 0.32 }, { face: 'W', a: 0, kind: 'kara', W: 1.3, H: 0.3 }],
    [],
  ], 'z'));
  hmStoneBase(O, EX, EZ, 2.0, 1.6, TERRACE_Y, STONE_SMALL, 0.85);
  hmKeep(O, smallKeep(EX, EZ, 1.95, 1.55, 3.9, STONE_SMALL, [
    [{ face: 'E', a: 0, kind: 'chidori', W: 1.4, H: 0.6 }, { face: 'N', a: 0, kind: 'kara', W: 1.5, H: 0.32 }],
    [{ face: 'N', a: 0, kind: 'chidori', W: 1.3, H: 0.56 }],
    [],
  ]));

  // The four covered corridors that close the ring, each a long low white building on its own stone.
  const corridor = (cx, cz, hx, hz, axis) => {
    const y0 = TERRACE_Y + 1.9;
    hmStoneBase(O, cx, cz, hx, hz, TERRACE_Y, y0, 0.5, false);
    hmKeep(O, {
      cx,
      cz,
      y0,
      nu: 8,
      nv: 3,
      hipR: 0.045,
      eaveT: 0.07,
      storeys: [{
        hx: hx - 0.04, hz: hz - 0.04, y: y0 + 0.82, over: 0.34, rise: 0.72, lift: 0.1, push: 0.08, axis,
        win: axis === 'x' ? { S: 3, N: 3 } : { E: 3, W: 3 },
        winW: 0.3,
        ridgeH: 0.06,
        gableAt: (axis === 'x' ? hx : hz) * 0.72,
        gableOver: 0.12,
      }],
    });
  };
  corridor((WX + 2 + MX - 3.9) / 2, 3.1, (MX - 3.9 - (WX + 2)) / 2 + 0.5, 0.85, 'x');
  corridor(WX + 0.1, (IZ + 1.9 + WZ - 1.7) / 2, 0.85, (WZ - 1.7 - (IZ + 1.9)) / 2 + 0.5, 'z');
  corridor((IX + 2.25 + EX - 2) / 2, -4.1, (EX - 2 - (IX + 2.25)) / 2 + 0.5, 0.82, 'x');
  corridor(EX + 0.5, (EZ + 1.6 + MZ - 3.05) / 2, 0.82, (MZ - 3.05 - (EZ + 1.6)) / 2 + 0.5, 'z');

  // A gatehouse over the head of the steps.
  {
    const y0 = TERRACE_Y - 0.02;
    const gz = HILL.hz - 0.05;
    hmKeep(O, {
      cx: 0,
      cz: gz,
      y0,
      nu: 8,
      nv: 3,
      hipR: 0.045,
      eaveT: 0.07,
      storeys: [{ hx: 1.42, hz: 0.42, y: y0 + 1.0, over: 0.36, rise: 0.66, lift: 0.1, push: 0.08, axis: 'x', ridgeH: 0.06, gableAt: 0.95, gableOver: 0.12 }],
    });
    // The doorway, a dark panel in a timber frame.
    O.plaster.box(-0.72, y0 + 0.02, gz + 0.42, 0.72, y0 + 0.82, gz + 0.435, HM.DARK);
    O.plaster.box(-0.72, y0 + 0.02, gz - 0.435, 0.72, y0 + 0.82, gz - 0.42, HM.DARK);
    O.plaster.box(-0.8, y0 + 0.82, gz + 0.415, 0.8, y0 + 0.92, gz + 0.46, HM.WOOD);
    O.plaster.box(-0.8, y0 + 0.02, gz + 0.415, -0.72, y0 + 0.82, gz + 0.46, HM.WOOD);
    O.plaster.box(0.72, y0 + 0.02, gz + 0.415, 0.8, y0 + 0.82, gz + 0.46, HM.WOOD);
  }

  // --- a little green -----------------------------------------------------------------------------------
  const pines = [
    [-8.4, TERRACE_Y, 7.2, 1.7], [8.4, TERRACE_Y, 7.6, 1.9], [-2.8, TERRACE_Y, 7.5, 1.3], [-9.2, TERRACE_Y, -0.8, 1.6],
    [9.1, TERRACE_Y, -3.2, 1.9], [12.3, 0.5, 9.9, 2.1], [-12.2, 0.5, 8.6, 2.2],
  ];
  pines.forEach(([x, y, z, s], i) => hmPine(O.plain, x, y, z, s, 60 + i));

  // --- materials --------------------------------------------------------------------------------------
  const tileMap = hmTileMap();
  const stoneMap = hmStoneMap();
  const plasterMap = hmPlasterMap();
  const grassMap = hmGrassMap();
  const tileMesh = mesh(mergeLinear(O.tile), standard({ vertexColors: true, map: tileMap, bumpMap: tileMap, bumpScale: 0.5, roughness: 0.74, metalness: 0 }));
  const stoneMesh = mesh(mergeLinear([...O.stone, { geometry: O.stoneSoup.geometry(), keepColor: true }]), standard({ vertexColors: true, map: stoneMap, bumpMap: stoneMap, bumpScale: 0.7, roughness: 0.94, metalness: 0 }));
  const plasterMesh = mesh(mergeLinear([{ geometry: O.plaster.geometry(), keepColor: true }, ...O.plaster.parts]), standard({ vertexColors: true, map: plasterMap, emissive: 0x20201d, roughness: 0.88, metalness: 0 }));
  const grassMesh = mesh(mergeLinear(O.grass), standard({ vertexColors: true, map: grassMap, bumpMap: grassMap, bumpScale: 0.4, roughness: 0.96, metalness: 0 }));
  const plainMesh = mesh(mergeLinear(O.plain), standard({ vertexColors: true, roughness: 0.78, metalness: 0 }));
  return group(tileMesh, stoneMesh, plasterMesh, grassMesh, plainMesh);
}

// ---------------------------------------------------------------------------
// The steelpan: a low C tenor, enlarged about 2 times
// ---------------------------------------------------------------------------

// The layout is the fourths-and-fifths tenor that Ellie Mannette's generation settled on: 29 notes,
// three rings, C4 to E6. Each ring walks the cycle of fifths, so stepping to a neighbour is a fifth one
// way and a fourth the other, and a note and its octave lie on one spoke, which is what the player's
// hands learn. Which note a maker puts at the top varies; here C is at the far side and the fifths run
// clockwise as the player looks down. In pan coordinates +Y is the axis and +Z is toward the player.
const CYCLE_OF_FIFTHS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'Ab', 'Eb', 'Bb', 'F'];
const PITCH_CLASS = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const PAN_INNER = ['C', 'D', 'E', 'C#', 'Eb'];
const PAN_R = 1.95; // the bowl's radius at the rim: 23.4in on a real 11.7in-radius pan, doubled
const PAN_DEPTH = 0.92;
const panBowlY = (r) => -PAN_DEPTH * (1 - (r / PAN_R) ** 2);
// Smaller patches play higher notes. Each octave up is 0.625 of the size, the proportion a tenor's
// patches run at, so the same curve serves all three rings.
const panHalfLength = (midi) => 0.33 * 2 ** (-((midi - 60) / 12) * 0.68);

// One entry per note, computed. `spoke` is its place round the cycle.
export const PAN_NOTES = (() => {
  const notes = [];
  const ring = (names, ringName, octave, outerEnd) => {
    for (const name of names) {
      const spoke = CYCLE_OF_FIFTHS.indexOf(name);
      const midi = 12 * (octave + 1) + PITCH_CLASS[name];
      const La = panHalfLength(midi);
      notes.push({ name, octave, label: `${name}${octave}`, ring: ringName, spoke, midi, La, Lb: La * 0.74, r: outerEnd - La, theta: (spoke / 12) * Math.PI * 2 });
    }
  };
  ring(CYCLE_OF_FIFTHS, 'outer', 4, 1.82);
  ring(CYCLE_OF_FIFTHS, 'middle', 5, 1.1);
  ring(PAN_INNER, 'inner', 6, 0.585);
  return notes;
})();

// Walks each ring and proves what the card and the teacher rely on.
export function steelpanReport() {
  const outer = PAN_NOTES.filter((n) => n.ring === 'outer').sort((a, b) => a.spoke - b.spoke);
  const middle = PAN_NOTES.filter((n) => n.ring === 'middle').sort((a, b) => a.spoke - b.spoke);
  const inner = PAN_NOTES.filter((n) => n.ring === 'inner').sort((a, b) => a.spoke - b.spoke);
  const fifths = (list) => list.every((n, i) => (((list[(i + 1) % list.length].midi - n.midi) % 12) + 12) % 12 === 7);
  const octaves = outer.every((n, i) => middle[i].name === n.name && middle[i].midi === n.midi + 12);
  const byPitch = [...PAN_NOTES].sort((a, b) => a.midi - b.midi);
  const shrinks = byPitch.every((n, i) => i === 0 || n.La < byPitch[i - 1].La);
  const unique = new Set(PAN_NOTES.map((n) => n.midi)).size === PAN_NOTES.length;
  // No two patches overlap on the plan: their long-axis circles are tested as ellipses, sampled.
  let minGap = Infinity;
  const pos = (n) => [Math.sin(n.theta) * n.r, -Math.cos(n.theta) * n.r];
  const inside = (n, x, z) => {
    const p = pos(n);
    const eR = [Math.sin(n.theta), -Math.cos(n.theta)];
    const eT = [Math.cos(n.theta), Math.sin(n.theta)];
    const a = (x - p[0]) * eR[0] + (z - p[1]) * eR[1];
    const b = (x - p[0]) * eT[0] + (z - p[1]) * eT[1];
    return (a / n.La) ** 2 + (b / n.Lb) ** 2;
  };
  for (const n of PAN_NOTES) {
    const p = pos(n);
    const eR = [Math.sin(n.theta), -Math.cos(n.theta)];
    const eT = [Math.cos(n.theta), Math.sin(n.theta)];
    for (let k = 0; k < 48; k += 1) {
      const ang = (k / 48) * Math.PI * 2;
      const a = Math.cos(ang) * n.La; const b = Math.sin(ang) * n.Lb;
      const x = p[0] + eR[0] * a + eT[0] * b; const z = p[1] + eR[1] * a + eT[1] * b;
      for (const m of PAN_NOTES) if (m !== n) minGap = Math.min(minGap, Math.sqrt(inside(m, x, z)) - 1);
    }
  }
  return {
    notes: PAN_NOTES.length,
    outer: outer.map((n) => n.label), middle: middle.map((n) => n.label), inner: inner.map((n) => n.label),
    outerIsCycleOfFifths: fifths(outer), middleIsCycleOfFifths: fifths(middle), middleIsOctaveAboveOuter: octaves,
    everyHigherNoteIsSmaller: shrinks, noRepeatedPitch: unique,
    lowest: byPitch[0].label, highest: byPitch[byPitch.length - 1].label,
    largestLengthFt: byPitch[0].La * 2, smallestLengthFt: byPitch[byPitch.length - 1].La * 2,
    patchesClear: minGap > 0, minClearanceInPatchRadii: minGap,
  };
}

const panXZ = (n, a, b) => {
  const eR = [Math.sin(n.theta), -Math.cos(n.theta)];
  const eT = [Math.cos(n.theta), Math.sin(n.theta)];
  return [Math.sin(n.theta) * n.r + eR[0] * a + eT[0] * b, -Math.cos(n.theta) * n.r + eR[1] * a + eT[1] * b];
};

// The playing surface, painted per note from the table. Near-silver with the polish streaks a chromed
// bowl shows, each patch ringed by the dark hammered groove, each carrying its name.
function panSurface(size, RR) {
  const rng = seededRandom(1939);
  const px = (x) => (x / RR) * 0.5 * size + size * 0.5;
  const t = canvasTexture(size, size, (ctx) => {
    const c = size / 2;
    ctx.fillStyle = 'rgb(176,181,189)';
    ctx.fillRect(0, 0, size, size);
    // The room's reflections: bright windows and dark floor, swept round the bowl.
    const cone = ctx.createConicGradient(0.5, c, c);
    const stops = [[0, 214], [0.08, 128], [0.17, 240], [0.27, 108], [0.37, 206], [0.5, 120], [0.61, 250], [0.71, 112], [0.83, 222], [0.92, 118], [1, 214]];
    for (const [p, v] of stops) cone.addColorStop(p, `rgb(${v},${v + 2},${v + 6})`);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = cone;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 1;
    // Darker toward the bottom of the bowl, where it sees only itself.
    const rad = ctx.createRadialGradient(c, c, 0, c, c, c);
    rad.addColorStop(0, 'rgba(84,88,96,1)'); rad.addColorStop(0.1, 'rgba(84,88,96,0.92)'); rad.addColorStop(0.34, 'rgba(84,88,96,0.42)'); rad.addColorStop(0.7, 'rgba(120,124,132,0)'); rad.addColorStop(1, 'rgba(255,255,255,0.4)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, size, size);
    // Hammer work between the notes.
    for (let i = 0; i < 4200; i += 1) {
      const v = rng() > 0.5 ? 255 : 30;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.03 + rng() * 0.06})`;
      const a = rng() * Math.PI * 2; const r = Math.sqrt(rng()) * c;
      ctx.beginPath(); ctx.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 1 + rng() * 3.5, 1 + rng() * 3.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    const pxPerFt = size / (RR * 2);
    for (const n of PAN_NOTES) {
      const [x, z] = panXZ(n, 0, 0);
      const X = px(x); const Y = px(z);
      const rotation = n.theta - Math.PI / 2; // the long axis runs along the spoke
      const A = n.La * pxPerFt; const B = n.Lb * pxPerFt;
      // The groove: a dark trench with a bright lip outside it.
      ctx.lineWidth = Math.max(4, A * 0.055);
      ctx.strokeStyle = 'rgba(244,246,250,0.8)';
      ctx.beginPath(); ctx.ellipse(X, Y, A * 1.12, B * 1.15, rotation, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(5, A * 0.085);
      ctx.strokeStyle = 'rgba(12,14,20,0.94)';
      ctx.beginPath(); ctx.ellipse(X, Y, A * 1.05, B * 1.07, rotation, 0, Math.PI * 2); ctx.stroke();
      // The patch's own sheen: a little brighter than the bowl, and lit on its crown.
      const sheen = ctx.createRadialGradient(X, Y - B * 0.3, 0, X, Y, A);
      sheen.addColorStop(0, 'rgba(255,255,255,0.98)'); sheen.addColorStop(0.5, 'rgba(232,236,242,0.86)'); sheen.addColorStop(1, 'rgba(120,126,136,0.82)');
      ctx.fillStyle = sheen;
      ctx.beginPath(); ctx.ellipse(X, Y, A * 0.99, B * 0.99, rotation, 0, Math.PI * 2); ctx.fill();
      // The name, upright for a player standing at +Z, measured to fit the patch's narrow side.
      let fontPx = Math.round(B * 0.78);
      ctx.font = `700 ${fontPx}px Arial, sans-serif`;
      const w = ctx.measureText(n.label).width;
      if (w > B * 1.5) { fontPx = Math.floor((fontPx * B * 1.5) / w); ctx.font = `700 ${fontPx}px Arial, sans-serif`; }
      ctx.fillStyle = 'rgb(10,14,30)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.label, X, Y);
    }
  });
  return t;
}

// The same patches as heights, so the groove catches the sun as a groove.
function panBump(size, RR) {
  const px = (x) => (x / RR) * 0.5 * size + size * 0.5;
  const rng = seededRandom(1940);
  const t = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i += 1) {
      const v = rng() > 0.5 ? 170 : 90;
      ctx.fillStyle = `rgba(${v},${v},${v},0.34)`;
      ctx.beginPath(); ctx.arc(rng() * size, rng() * size, 1 + rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    const pxPerFt = size / (RR * 2);
    for (const n of PAN_NOTES) {
      const [x, z] = panXZ(n, 0, 0);
      const rotation = n.theta - Math.PI / 2;
      const A = n.La * pxPerFt; const B = n.Lb * pxPerFt;
      ctx.lineWidth = Math.max(4, A * 0.1);
      ctx.strokeStyle = 'rgb(18,18,18)';
      ctx.beginPath(); ctx.ellipse(px(x), px(z), A * 1.05, B * 1.07, rotation, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = Math.max(2, A * 0.05);
      ctx.strokeStyle = 'rgb(208,208,208)';
      ctx.beginPath(); ctx.ellipse(px(x), px(z), A * 1.14, B * 1.17, rotation, 0, Math.PI * 2); ctx.stroke();
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Chrome with no environment map: bands of bright and dark running down a turned surface, because that
// is what a cylinder of mirror shows, and it is all the eye asks of chrome.
function chromeBands(g, { base = 0xdfe3e8, seed = 0.3, lo = 0.2, hi = 1.18 } = {}) {
  const c = lin(base);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 1) {
    const a = Math.atan2(n.getX(i), n.getZ(i));
    const w = 0.5 + 0.5 * Math.sin(a * 3 + seed + 1.3 * Math.sin(a * 2 + seed * 3)) * Math.cos(a * 5 - seed * 2);
    const up = n.getY(i);
    let k = mix(lo, hi, sstep(w, 0.26, 0.72));
    k = mix(k, 1.05, sstep(up, 0.35, 0.9));
    const l = Math.max(0, k - 1) * 0.6;
    arr[i * 3] = c[0] * k + l; arr[i * 3 + 1] = c[1] * k + l; arr[i * 3 + 2] = c[2] * k + l;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function steelpan() {
  const report = steelpanReport();
  if (!report.outerIsCycleOfFifths || !report.middleIsCycleOfFifths || !report.middleIsOctaveAboveOuter || !report.everyHigherNoteIsSmaller || !report.patchesClear) {
    throw new Error(`steelpan layout is wrong: ${JSON.stringify(report)}`);
  }
  const TILT = (22 * Math.PI) / 180;
  const CY = 3.72;
  const pan = new THREE.Matrix4().makeRotationX(TILT).setPosition(0, CY, 0);
  const RR = PAN_R + 0.02;
  const bowlParts = [];
  const chrome = [];
  const dark = [];
  const rubber = [];

  // --- the bowl, one polar grid, its map laid on it in plan -----------------------------------------
  {
    const RINGS = 44; const SECT = 96;
    const pos = []; const uv = []; const idx = [];
    pos.push(0, panBowlY(0), 0); uv.push(0.5, 0.5);
    for (let k = 1; k <= RINGS; k += 1) {
      const r = (k / RINGS) * PAN_R;
      for (let j = 0; j < SECT; j += 1) {
        const a = (j / SECT) * Math.PI * 2;
        const x = Math.sin(a) * r; const z = Math.cos(a) * r;
        pos.push(x, panBowlY(r), z);
        uv.push(x / (2 * RR) + 0.5, 0.5 - z / (2 * RR));
      }
    }
    for (let j = 0; j < SECT; j += 1) idx.push(0, 1 + j, 1 + ((j + 1) % SECT));
    for (let k = 0; k < RINGS - 1; k += 1) {
      for (let j = 0; j < SECT; j += 1) {
        const j2 = (j + 1) % SECT;
        const a = 1 + k * SECT + j; const b = 1 + k * SECT + j2; const c = 1 + (k + 1) * SECT + j2; const d = 1 + (k + 1) * SECT + j;
        idx.push(a, d, c, a, c, b);
      }
    }
    // Under the bowl: a coarse sheet that follows it, closing the solid. Nothing sees it, since the skirt's
    // plug is below, but on a concave bowl a straight cap would lie above the surface and turn it inside out.
    const under = pos.length / 3;
    pos.push(0, panBowlY(0) - 0.03, 0); uv.push(0.5, 0.5);
    const UR = 6; const US = 24;
    for (let k = 1; k <= UR; k += 1) {
      const r = (k / UR) * PAN_R;
      for (let j = 0; j < US; j += 1) {
        const a = (j / US) * Math.PI * 2;
        pos.push(Math.sin(a) * r, panBowlY(r) - 0.03, Math.cos(a) * r); uv.push(0.5, 0.5);
      }
    }
    for (let j = 0; j < US; j += 1) idx.push(under, under + 1 + ((j + 1) % US), under + 1 + j);
    for (let k = 0; k < UR - 1; k += 1) {
      for (let j = 0; j < US; j += 1) {
        const j2 = (j + 1) % US;
        const a = under + 1 + k * US + j; const b = under + 1 + k * US + j2; const c = under + 1 + (k + 1) * US + j2; const d = under + 1 + (k + 1) * US + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    let g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g = tintVertices(g, (x, y, z, out) => { out[0] = 1; out[1] = 1; out[2] = 1; });
    bowlParts.push({ geometry: g, keepColor: true });
  }

  // --- the note patches: real domes, each following the bowl under it --------------------------------
  for (const n of PAN_NOTES) {
    const RHO = [1, 0.92, 0.78, 0.6, 0.4, 0.2];
    const SIDES = n.ring === 'inner' ? 20 : 26;
    const H = n.La * 0.2;
    const pos = []; const uv = []; const idx = [];
    const add3 = (a, b) => {
      const [x, z] = panXZ(n, a, b);
      const rho2 = Math.min(1, (a / n.La) ** 2 + (b / n.Lb) ** 2);
      const r = Math.hypot(x, z);
      const y = panBowlY(r) - 0.012 + (H + 0.012) * (1 - rho2) ** 0.75;
      pos.push(x, y, z);
      uv.push(x / (2 * RR) + 0.5, 0.5 - z / (2 * RR));
    };
    for (const rho of RHO) {
      for (let j = 0; j < SIDES; j += 1) {
        const a = (j / SIDES) * Math.PI * 2;
        add3(Math.cos(a) * rho * n.La, Math.sin(a) * rho * n.Lb);
      }
    }
    const top = pos.length / 3;
    add3(0, 0);
    const bottom = pos.length / 3;
    { const [x, z] = panXZ(n, 0, 0); pos.push(x, panBowlY(Math.hypot(x, z)) - 0.05, z); uv.push(x / (2 * RR) + 0.5, 0.5 - z / (2 * RR)); }
    for (let k = 0; k < RHO.length - 1; k += 1) {
      for (let j = 0; j < SIDES; j += 1) {
        const j2 = (j + 1) % SIDES;
        const a = k * SIDES + j; const b = k * SIDES + j2; const c = (k + 1) * SIDES + j2; const d = (k + 1) * SIDES + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    const lastRow = (RHO.length - 1) * SIDES;
    for (let j = 0; j < SIDES; j += 1) {
      idx.push(lastRow + j, lastRow + ((j + 1) % SIDES), top);
      idx.push(bottom, (j + 1) % SIDES, j);
    }
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const nrm = cross(sub(P(idx[1]), P(idx[0])), sub(P(idx[2]), P(idx[0])));
    if (nrm[1] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    let g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g = tintVertices(g, (x, y, z, out) => { out[0] = 1; out[1] = 1; out[2] = 1; });
    bowlParts.push({ geometry: g, keepColor: true });
  }

  // --- the skirt, rolled rim, and the hoops pressed into a drum's side ------------------------------
  const SK = 1.18;
  {
    const skirt = latheUp([
      [PAN_R - 0.02, -SK + 0.01], [PAN_R + 0.015, -SK], [PAN_R + 0.04, -SK + 0.03], [PAN_R + 0.04, -SK + 0.07], [PAN_R + 0.01, -SK + 0.1],
      [PAN_R, -SK + 0.14], [PAN_R, -0.72], [PAN_R + 0.018, -0.69], [PAN_R + 0.018, -0.63], [PAN_R, -0.6], [PAN_R, -0.2],
      [PAN_R + 0.015, -0.14], [PAN_R + 0.05, -0.08], [PAN_R + 0.06, -0.015], [PAN_R + 0.04, 0.035], [PAN_R + 0.0, 0.052], [PAN_R - 0.04, 0.03], [PAN_R - 0.05, 0.0], [PAN_R - 0.03, -0.022],
    ], { segments: 96 });
    chromeBands(skirt, { seed: 0.7, lo: 0.2, hi: 1.25 });
    chrome.push({ geometry: skirt, keepColor: true });
    // The inside of the drum, closed a little way up: seen from below, it is a dark hollow.
    dark.push({ geometry: latheUp([[0, -SK + 0.2], [PAN_R - 0.025, -SK + 0.2], [PAN_R - 0.025, -SK + 0.22], [0, -PAN_DEPTH - 0.04]], { segments: 48 }), color: lin(0x1b1d21) });
  }

  // --- the stand, in world feet --------------------------------------------------------------------
  const toWorld = (p) => v3(p).applyMatrix4(pan).toArray();
  const POST_TOP = CY - 1.5;
  const STEEL = 0xd8dce2;
  const addChrome = (g, seed) => { chromeBands(g, { base: STEEL, seed, lo: 0.3, hi: 1.2 }); worldChrome.push({ geometry: g, keepColor: true }); };
  const worldChrome = [];
  addChrome(latheUp([[0, 0.18], [0.095, 0.18], [0.095, POST_TOP - 0.12], [0.11, POST_TOP - 0.1], [0.11, POST_TOP], [0, POST_TOP + 0.02]], { segments: 24 }), 1.1);
  addChrome(latheUp([[0, 0.06], [0.16, 0.06], [0.18, 0.1], [0.18, 0.3], [0.13, 0.36], [0.11, 0.44], [0, 0.44]], { segments: 24 }), 2.2);
  for (let i = 0; i < 3; i += 1) {
    const a = ((i + 0.5) / 3) * Math.PI * 2;
    const tip = [Math.sin(a) * 1.5, 0.05, Math.cos(a) * 1.5];
    addChrome(tube([[Math.sin(a) * 0.12, 0.26, Math.cos(a) * 0.12], [Math.sin(a) * 0.8, 0.16, Math.cos(a) * 0.8], tip], [0.055, 0.05, 0.045], { sides: 10, steps: 8, round: 1 }), a);
    dark.push({ geometry: latheUp([[0, 0], [0.09, 0], [0.1, 0.04], [0.075, 0.08], [0, 0.09]], { segments: 12 }).translate(tip[0], 0, tip[2]), color: lin(0x17181a) });
  }
  // A hoop just outside the skirt, tilted with the pan, on three arms from the top of the post.
  const hoopR = PAN_R + 0.1;
  {
    const g = new THREE.TorusGeometry(hoopR, 0.045, 8, 72);
    g.rotateX(Math.PI / 2);
    g.translate(0, -SK * 0.55, 0);
    g.applyMatrix4(pan);
    addChrome(g, 0.4);
  }
  const hub = [0, POST_TOP, 0];
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;
    const onHoop = toWorld([Math.sin(a) * hoopR, -SK * 0.55, Math.cos(a) * hoopR]);
    // Out under the drum and up outside its lip, never through it.
    const under = toWorld([Math.sin(a) * hoopR * 0.6, -SK - 0.14, Math.cos(a) * hoopR * 0.6]);
    const out = toWorld([Math.sin(a) * (hoopR + 0.02), -SK - 0.1, Math.cos(a) * (hoopR + 0.02)]);
    addChrome(tube([hub, under, out, onHoop], [0.05, 0.048, 0.044, 0.04], { sides: 10, steps: 14, round: 1 }), a + 1);
    // The bracket that seats the pan's skirt on the hoop.
    addChrome(rod(onHoop, toWorld([Math.sin(a) * (PAN_R + 0.005), -SK * 0.55, Math.cos(a) * (PAN_R + 0.005)]), 0.04, 8), a + 2);
  }
  // A little rest on the post for the two sticks, swung out to the student's right so it is seen. Authored
  // along +X in its own frame, then turned about the post.
  const REST_Y = 1.62;
  const RX = 1.18;
  const REST_YAW = -0.72;
  const rest = (x, y, z) => {
    const q = new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), REST_YAW);
    return [q.x, q.y, q.z];
  };
  const restRod = (a, b, r) => addChrome(rod(rest(...a), rest(...b), r, 10), a[0] + b[1]);
  addChrome(latheUp([[0, REST_Y - 0.1], [0.125, REST_Y - 0.1], [0.125, REST_Y + 0.1], [0, REST_Y + 0.1]], { segments: 16 }), 0.9);
  restRod([0, REST_Y, 0], [RX, REST_Y, 0], 0.04);
  restRod([RX, REST_Y, -0.34], [RX, REST_Y, 0.34], 0.038);
  // The fork at each end: three tines, with a stick lying between each pair.
  const STICK_Y = REST_Y + 0.13;
  const stickXs = [RX - 0.13, RX + 0.13];
  const forkAt = (z) => {
    restRod([RX - 0.26, REST_Y, z], [RX + 0.26, REST_Y, z], 0.03);
    for (const x of [RX - 0.26, RX, RX + 0.26]) restRod([x, REST_Y, z], [x, STICK_Y + 0.09, z], 0.024);
  };
  forkAt(-0.34); forkAt(0.34);
  // The mallets: an aluminium stick and a rubber head, wrapped, resting across the forks.
  stickXs.forEach((x, i) => {
    const y = STICK_Y;
    const z0 = -0.72 + i * 0.08; const z1 = z0 + 1.42;
    const stick = tube([rest(x, y, z0), rest(x, y, z1)], [0.022, 0.019], { sides: 8, steps: 1, round: 1, straight: true });
    chromeBands(stick, { base: 0xc8ccd2, seed: x, lo: 0.45, hi: 1.1 });
    worldChrome.push({ geometry: stick, keepColor: true });
    const head = latheUp([[0, -0.06], [0.05, -0.05], [0.082, -0.015], [0.095, 0.05], [0.09, 0.11], [0.06, 0.16], [0.028, 0.18], [0, 0.185]], { segments: 18 });
    // Bands of wrapped rubber, which is how a tenor stick's tip is made.
    tintVertices(head, (px, py, pz, out) => {
      const k = 0.82 + 0.28 * Math.sin(py * 90);
      const c = lin(0xd5431f);
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    });
    seat(head, rest(x, y, z1 - 0.02), sub(rest(0, 0, 1), rest(0, 0, 0)));
    rubber.push({ geometry: head, keepColor: true });
  });

  // --- materials ----------------------------------------------------------------------------------
  const SIZE = 1536;
  const surface = panSurface(SIZE, RR);
  const bump = panBump(768, RR);
  const bowl = mergeLinear(bowlParts);
  bowl.applyMatrix4(pan);
  const bowlMesh = mesh(bowl, standard({ vertexColors: true, map: surface, bumpMap: bump, bumpScale: 0.9, roughness: 0.34, metalness: 0.2 }));
  const panChrome = mergeLinear(chrome);
  panChrome.applyMatrix4(pan);
  const chromeMesh = mesh(mergeLinear([{ geometry: panChrome, keepColor: true }, ...worldChrome]), standard({ vertexColors: true, roughness: 0.22, metalness: 0.42 }));
  const panDark = dark.slice(0, 1).map((part) => ({ ...part, geometry: part.geometry.clone().applyMatrix4(pan) }));
  const feet = dark.slice(1);
  const darkMesh = mesh(mergeLinear([...panDark, ...feet]), standard({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
  const rubberMesh = mesh(mergeLinear(rubber), standard({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  return group(bowlMesh, chromeMesh, darkMesh, rubberMesh);
}

// ---------------------------------------------------------------------------
// The tuba: a four-valve BBb, about 2 times life
// ---------------------------------------------------------------------------

// A BBb tuba's tube is about 18 feet, so at 2 times life this path should be about 36: `tubaBoreReport`
// measures it. Seen from +Z, the bell column rises left of centre, the four upright pistons stand in a
// row in front of it on the right, and the two wide wraps run round behind everything. The routing
// follows the logic of a real horn, narrow leadpipe to valves to wraps to bow to bell, without copying
// one maker's bracing. All in feet.
const TUBA_VALVES = [0.44, 0.84, 1.24, 1.64];
const TUBA_VALVE_Y = 3.22;
const TUBA_VALVE_Z = 0.66;
const TUBA_RIM = 1.42;
// Each slide's depth is in the proportion the valves themselves are: second valve shortest (a semitone),
// then first, third and fourth. The real fourth slide would run six feet at this scale, so the lengths are
// proportional in order and not to scale.
const TUBA_SLIDE_DROP = [0.72, 0.38, 1.12, 1.6];

let tubaPathCache = null; // path data only, never geometry or materials
function tubaPath() {
  if (tubaPathCache) return tubaPathCache;
  const pts = [];
  // The mouthpiece's receiver and the leadpipe, running over the valve tops and down to the first valve.
  pts.push([2.42, 4.44, 1.16], [2.0, 4.36, 1.14], [1.45, 4.3, 1.12], [0.85, 4.28, 1.1], [0.32, 4.16, 1.08], [-0.02, 3.86, 1.04], [-0.08, 3.5, 0.96], [0.08, 3.27, 0.8]);
  // Straight through the four pistons.
  for (const x of TUBA_VALVES) pts.push([x, TUBA_VALVE_Y, TUBA_VALVE_Z]);
  // Out of the fourth valve and down round the main tuning slide, then back up behind the valves.
  pts.push([1.98, 3.2, 0.64], [2.16, 2.96, 0.6], [2.2, 2.2, 0.56], [2.18, 1.62, 0.5], [2.16, 1.36, 0.28], [2.18, 1.62, 0.06], [2.22, 2.4, -0.1], [2.24, 3.0, -0.34]);
  // The wraps: a spiral whose centre is behind the valves, widening as the tube does.
  const C = [0.08, 2.84];
  const TH0 = 0.32; const TH1 = Math.PI * 3 - 0.08;
  const N = 26;
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const th = mix(TH0, TH1, t);
    const a = mix(1.98, 2.0, t);
    const b = mix(1.66, 2.02, t);
    const z = -0.76 - 0.46 * sstep(t, 0.3, 0.62);
    // A little squarer than an ellipse, since a tuba's wraps are long straight branches and tight bows.
    const cs = Math.cos(th); const sn = Math.sin(th);
    pts.push([C[0] + Math.sign(cs) * Math.abs(cs) ** 0.78 * a, C[1] + Math.sign(sn) * Math.abs(sn) ** 0.78 * b, z]);
  }
  // The great bow under the horn, then up into the bell.
  pts.push([-2.14, 1.86, -0.96], [-1.86, 1.1, -0.62], [-1.24, 0.72, -0.3], [-0.62, 0.86, -0.08], [-0.36, 1.46, 0], [-0.34, 2.3, 0], [-0.34, 3.2, 0], [-0.34, 4.1, 0], [-0.34, 4.9, 0], [-0.34, 5.92, 0]);
  const curve = new THREE.CatmullRomCurve3(pts.map(v3), false, 'centripetal');
  const FINE = 2400;
  const fine = curve.getSpacedPoints(FINE).map((p) => [p.x, p.y, p.z]);
  const S = [0];
  for (let i = 1; i < fine.length; i += 1) S.push(S[i - 1] + Math.hypot(fine[i][0] - fine[i - 1][0], fine[i][1] - fine[i - 1][1], fine[i][2] - fine[i - 1][2]));
  const L = S[S.length - 1];
  const at = (s) => {
    const f = clamp01(s / L) * FINE;
    const i = Math.min(FINE - 1, Math.floor(f));
    return mix3(fine[i], fine[i + 1], f - i);
  };
  // Transport a frame along the fine path once.
  const frames = [];
  const tan = fine.map((q, i) => norm(sub(fine[Math.min(FINE, i + 1)], fine[Math.max(0, i - 1)])));
  let n = norm(sub([0, 0, 1], scl(tan[0], dot([0, 0, 1], tan[0]))));
  for (let i = 0; i <= FINE; i += 1) {
    n = norm(sub(n, scl(tan[i], dot(n, tan[i]))));
    frames.push(n);
  }
  const frameAt = (s) => {
    const i = Math.min(FINE, Math.round(clamp01(s / L) * FINE));
    const T = tan[i]; const Nn = frames[i];
    return { T, N: Nn, B: cross(T, Nn) };
  };
  // Where each valve's centre falls on the path.
  const sValve = TUBA_VALVES.map((x) => {
    let best = 0; let bd = 1e9;
    for (let i = 0; i <= FINE; i += 1) {
      if (i / FINE > 0.45) break;
      const d = Math.hypot(fine[i][0] - x, fine[i][1] - TUBA_VALVE_Y, fine[i][2] - TUBA_VALVE_Z);
      if (d < bd) { bd = d; best = S[i]; }
    }
    return best;
  });
  tubaPathCache = { fine, S, L, at, frameAt, sValve, FINE };
  return tubaPathCache;
}

// One exponential cone from mouthpiece to bell, plus a flare over the last stretch. It is one function of
// one number, so it cannot step, and it is sampled here anyway.
const TUBA_R0 = 0.04;
const TUBA_GROWTH = 2.36;
const TUBA_FLARE_FROM = 0.885;
function tubaRadiusFn(L) {
  const end = TUBA_R0 * Math.exp(TUBA_GROWTH);
  return (s) => {
    const t = clamp01(s / L);
    const u = clamp01((t - TUBA_FLARE_FROM) / (1 - TUBA_FLARE_FROM));
    return TUBA_R0 * Math.exp(TUBA_GROWTH * t) + (TUBA_RIM - end) * u ** 4.4;
  };
}

export function tubaBoreReport(samples = 4000) {
  const path = tubaPath();
  const r = tubaRadiusFn(path.L);
  let minSlope = Infinity; let maxJump = 0; let prev = null; let narrowing = 0;
  for (let i = 1; i <= samples; i += 1) {
    const a = ((i - 1) / samples) * path.L; const b = (i / samples) * path.L;
    const slope = (r(b) - r(a)) / (b - a);
    if (slope <= 0) narrowing += 1;
    minSlope = Math.min(minSlope, slope);
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(slope - prev));
    prev = slope;
  }
  // No tube passes through another: every pair of samples far enough apart along the path, compared
  // against both radii.
  let minGap = Infinity; let where = null;
  const M = 520;
  const P = [];
  for (let i = 0; i <= M; i += 1) { const s = (i / M) * path.L; P.push({ s, p: path.at(s), r: r(s) }); }
  for (let i = 0; i <= M; i += 1) {
    for (let j = i + 1; j <= M; j += 1) {
      if (P[j].s - P[i].s < (P[i].r + P[j].r) * 2.2 + 0.5) continue;
      const g = Math.hypot(P[i].p[0] - P[j].p[0], P[i].p[1] - P[j].p[1], P[i].p[2] - P[j].p[2]) - P[i].r - P[j].r;
      if (g < minGap) { minGap = g; where = [P[i].s, P[j].s]; }
    }
  }
  return {
    lengthFt: path.L, realLengthFt: path.L / 2, mouthpieceEndDiameterFt: r(0) * 2, valveDiameterFt: r(path.sValve[0]) * 2,
    bowDiameterFt: r(path.L * 0.82) * 2, rimDiameterFt: r(path.L) * 2,
    narrowingSteps: narrowing, minSlope, maxSlopeJump: maxJump, minGapBetweenTubesFt: minGap, gapAtS: where,
  };
}

function tubaEngraving() {
  const W = 1024; const H = 512;
  const t = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const ink = 'rgba(92,52,12,0.86)';
    ctx.strokeStyle = ink; ctx.fillStyle = ink;
    const leaf = (x, y, a, len) => {
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a - 0.5) * len * 0.6, y + Math.sin(a - 0.5) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.5) * len * 0.6, y + Math.sin(a + 0.5) * len * 0.6, x, y);
      ctx.stroke();
    };
    const flower = (cx, cy, R) => {
      ctx.lineWidth = 2.6;
      for (let k = 0; k < 7; k += 1) leaf(cx, cy, (k / 7) * Math.PI * 2, R);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2); ctx.fill();
    };
    // A formal wreath under the rim: one big flower, four smaller, joined by two running scrolls.
    const CX = W * 0.5; const CY = H * 0.36;
    flower(CX, CY, 58); flower(CX - 118, CY + 10, 34); flower(CX + 118, CY + 10, 34); flower(CX - 214, CY + 28, 24); flower(CX + 214, CY + 28, 24);
    for (const sg of [-1, 1]) {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= 60; i += 1) {
        const f = i / 60;
        const x = CX + sg * (40 + f * 250);
        const y = CY + 34 + f * 12 + Math.sin(f * Math.PI * 4) * 14;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let i = 1; i < 12; i += 1) {
        const f = i / 12;
        const x = CX + sg * (40 + f * 250);
        const y = CY + 34 + f * 12 + Math.sin(f * Math.PI * 4) * 14;
        ctx.lineWidth = 1.6;
        leaf(x, y, (i % 2 ? -1 : 1) * (Math.PI / 2 - sg * 0.5), 18 - f * 6);
      }
    }
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(W, 14); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(W, 24); ctx.stroke();
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function tuba() {
  const report = tubaBoreReport(800);
  if (report.narrowingSteps) throw new Error('the tuba narrows somewhere');
  const path = tubaPath();
  const L = path.L;
  const rOf = tubaRadiusFn(L);
  const BRASS = lin(0xe0aa3c);
  const BRASS_HI = lin(0xefc25e);
  const brass = [];
  const soft = [];
  const dark = [];
  const silver = [];
  const shine = (g, c = BRASS, opts = {}) => {
    const uv = new Float32Array(g.attributes.position.count * 2).fill(0.002);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    brass.push({ geometry: polishGeometry(g, c, { pale: 0.5, ...opts }), keepColor: true });
  };

  // --- the horn: one surface from the leadpipe to the rolled rim, and back down inside the bell -------
  const rows = [];
  const pushRow = (s, r, off = 0, inner = false) => rows.push({ s, r, off, inner });
  const STEP_BODY = 0.15;
  let sCur = 0;
  while (sCur < L * TUBA_FLARE_FROM) { pushRow(sCur, rOf(sCur)); sCur += STEP_BODY; }
  const FLARE_ROWS = 46;
  const s0 = sCur;
  for (let i = 0; i <= FLARE_ROWS; i += 1) {
    // Denser toward the rim, where the curve is.
    const s = mix(s0, L, 1 - (1 - i / FLARE_ROWS) ** 1.6);
    pushRow(s, rOf(s));
  }
  const BEAD = 0.04;
  pushRow(L, TUBA_RIM + BEAD * 0.75, 0.012);
  pushRow(L, TUBA_RIM + BEAD, 0.034);
  pushRow(L, TUBA_RIM + BEAD * 0.55, 0.058);
  pushRow(L, TUBA_RIM - 0.008, 0.06);
  pushRow(L, TUBA_RIM - 0.035, 0.03, true);
  const WALL = 0.04;
  for (let i = 1; i <= 26; i += 1) {
    const s = mix(L, s0 - 0.6, (i / 26) ** 1.3);
    pushRow(s, Math.max(0.04, rOf(s) - WALL), 0, true);
  }
  const SIDES = 36;
  const R1 = SIDES + 1;
  const positions = []; const uvs = []; const inside = [];
  const SE = L - 2.6; // the engraved band of the bell
  // Turn the map round the bell so its wreath faces the student, measured off the frame at the rim.
  const engraveTurn = (() => {
    const f = path.frameAt(L);
    return 0.5 - Math.atan2(f.B[2], f.N[2]) / (Math.PI * 2);
  })();
  for (const row of rows) {
    const c0 = path.at(row.s);
    const f = path.frameAt(row.s);
    const c = add(c0, scl(f.T, row.off));
    for (let j = 0; j <= SIDES; j += 1) {
      const a = (j / SIDES) * Math.PI * 2;
      const u = add(scl(f.N, Math.cos(a)), scl(f.B, Math.sin(a)));
      positions.push(c[0] + u[0] * row.r, c[1] + u[1] * row.r, c[2] + u[2] * row.r);
      const eng = !row.inner && row.off === 0 && row.s >= SE;
      uvs.push(j / SIDES + engraveTurn, eng ? 0.01 + 0.98 * ((row.s - SE) / (L - SE)) : 0.002);
      inside.push(row.inner ? 1 : 0);
    }
  }
  const index = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      const a = i * R1 + j; const b = a + 1; const d = (i + 1) * R1 + j; const c = d + 1;
      index.push(a, c, b, a, d, c);
    }
  }
  // Close the two ends, the one in the mouthpiece and the one deep in the throat.
  const tip = positions.length / 3;
  positions.push(...path.at(0)); uvs.push(0, 0.002); inside.push(0);
  for (let j = 0; j < SIDES; j += 1) index.push(tip, j + 1, j);
  const deep = positions.length / 3;
  positions.push(...path.at(rows[rows.length - 1].s)); uvs.push(0, 0.002); inside.push(1);
  const lastBase = (rows.length - 1) * R1;
  for (let j = 0; j < SIDES; j += 1) index.push(deep, lastBase + j, lastBase + j + 1);
  let horn = new THREE.BufferGeometry();
  horn.setIndex(index);
  horn.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  horn.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  horn = outward(horn);
  horn.computeVertexNormals();
  weldSeam(horn, R1, rows.length);
  polishGeometry(horn, BRASS, { pale: 0.5, floor: 0.66 });
  {
    const pos = horn.attributes.position; const col = horn.attributes.color;
    const rim = path.at(L); const rimT = path.frameAt(L).T;
    for (let i = 0; i < pos.count; i += 1) {
      if (!inside[i]) continue;
      const depth = -dot(sub([pos.getX(i), pos.getY(i), pos.getZ(i)], rim), rimT);
      const k = 0.012 + 0.42 * (1 - sstep(depth, 0.02, 1.5)) ** 2;
      col.setXYZ(i, BRASS[0] * k, BRASS[1] * k, BRASS[2] * k);
    }
  }
  const hornPart = { geometry: horn, keepColor: true };

  const collar = (s, wide, proud, c = BRASS_HI) => {
    const f = path.frameAt(s);
    const r = rOf(s);
    const g = latheUp([[0, -wide], [r + proud * 0.5, -wide], [r + proud, -wide * 0.8], [r + proud, wide * 0.8], [r + proud * 0.5, wide], [0, wide]], { segments: 26 });
    seat(g, path.at(s), f.T);
    shine(g, c);
  };
  for (const t of [0.05, 0.27, 0.3, 0.46, 0.66, 0.78, 0.86]) collar(L * t, 0.045 + rOf(L * t) * 0.14, 0.018);

  // --- the valves: four casings standing upright -------------------------------------------------------
  const VR = 0.165;
  const VTOP = TUBA_VALVE_Y + 0.74;
  const VBOT = TUBA_VALVE_Y - 0.68;
  TUBA_VALVES.forEach((x, i) => {
    const z = TUBA_VALVE_Z;
    const g = latheUp([
      [0, VBOT - 0.09], [VR * 0.5, VBOT - 0.09], [VR * 0.92, VBOT - 0.06], [VR + 0.014, VBOT - 0.03], [VR + 0.014, VBOT + 0.03], [VR, VBOT + 0.05],
      [VR, VTOP - 0.05], [VR + 0.02, VTOP - 0.03], [VR + 0.02, VTOP + 0.04], [VR * 0.86, VTOP + 0.075], [VR * 0.5, VTOP + 0.09], [VR * 0.5, VTOP + 0.1], [0, VTOP + 0.1],
    ], { segments: 28 });
    g.translate(x, 0, z);
    shine(g, BRASS);
    // The stem and the finger button.
    const stem = latheUp([[0, VTOP + 0.09], [0.028, VTOP + 0.09], [0.028, VTOP + 0.3], [0, VTOP + 0.3]], { segments: 10 });
    stem.translate(x, 0, z);
    const sg = stem;
    polishGeometry(sg, lin(0xd9dce0), { pale: 0.4 });
    silver.push({ geometry: sg, keepColor: true });
    const btn = latheUp([[0, VTOP + 0.28], [0.1, VTOP + 0.28], [0.115, VTOP + 0.3], [0.115, VTOP + 0.335], [0.1, VTOP + 0.35], [0, VTOP + 0.35]], { segments: 18 });
    btn.translate(x, 0, z);
    shine(btn, BRASS_HI);
    const pearl = latheUp([[0, VTOP + 0.345], [0.085, VTOP + 0.345], [0.085, VTOP + 0.356], [0.05, VTOP + 0.368], [0, VTOP + 0.372]], { segments: 14 });
    pearl.translate(x, 0, z);
    soft.push({ geometry: tintVertices(pearl, (px, py, pz, out) => {
      const w = 0.5 + 0.5 * Math.sin(px * 40 + pz * 31);
      out[0] = 0.84 + w * 0.08; out[1] = 0.82 + (1 - w) * 0.08; out[2] = 0.8 + w * 0.05;
    }), keepColor: true });
    // A slide: down out of the casing's front and back and joined by a U-bend. Its radius is the bore's at
    // this valve, held constant, since a tuning slide is a cylinder.
    const drop = TUBA_SLIDE_DROP[i];
    const r = rOf(path.sValve[i]) * 0.86;
    const yp = TUBA_VALVE_Y - 0.26;
    const yb = yp - 0.2 - drop;
    const sp = 0.25;
    const u = 0.18;
    // The U stands turned from the row, so that both its legs show from the front. `leg` is signed along it.
    const TURN = 0.62;
    const at = (leg, y) => [x + Math.sin(TURN) * leg, y, z + Math.cos(TURN) * leg];
    const P = [
      at(VR * 0.5, yp + 0.02), at(sp * 0.82, yp + 0.02), at(sp, yp - 0.1), at(sp, yp - 0.22), at(sp, yb),
      at(sp * 0.72, yb - u * 0.58), at(0, yb - u), at(-sp * 0.72, yb - u * 0.58), at(-sp, yb), at(-sp, yp - 0.22), at(-sp, yp - 0.1), at(-sp * 0.82, yp + 0.02), at(-VR * 0.5, yp + 0.02),
    ];
    shine(tube(P, r, { sides: 12, steps: 34, round: 1 }), BRASS);
    // A ferrule where each slide leg meets its outer tube, and a brace between the legs.
    for (const leg of [sp, -sp]) {
      const fer = latheUp([[0, -0.05], [r + 0.012, -0.05], [r + 0.022, -0.035], [r + 0.022, 0.035], [r + 0.012, 0.05], [0, 0.05]], { segments: 12 });
      const q = at(leg, yp - 0.3);
      fer.translate(q[0], q[1], q[2]);
      shine(fer, BRASS_HI);
    }
    shine(tube([at(sp, yb + 0.1), at(-sp, yb + 0.1)], 0.016, { sides: 7, steps: 1, round: 1, straight: true }), BRASS);
  });
  // The cross rods tying the casings together at top and bottom.
  for (const y of [VTOP - 0.1, VBOT + 0.12]) {
    shine(tube([[TUBA_VALVES[0], y, TUBA_VALVE_Z - VR * 0.82], [TUBA_VALVES[3], y, TUBA_VALVE_Z - VR * 0.82]], 0.02, { sides: 7, steps: 1, round: 1, straight: true }), BRASS_HI);
  }
  // The finger hook, by the first valve.
  {
    const x = TUBA_VALVES[0] - 0.24;
    const P = [[TUBA_VALVES[0] - VR * 0.8, 3.72, TUBA_VALVE_Z], [x, 3.75, TUBA_VALVE_Z + 0.02], [x - 0.08, 3.85, TUBA_VALVE_Z + 0.06], [x - 0.02, 3.96, TUBA_VALVE_Z + 0.06], [x + 0.08, 3.9, TUBA_VALVE_Z + 0.04]];
    shine(tube(P, 0.018, { sides: 7, steps: 16, round: 1 }), BRASS_HI);
  }

  // --- the braces between the wraps and the bell, found by asking where they come closest ---------------
  const brace = (sA, sB) => {
    const a = path.at(sA); const b = path.at(sB);
    const fA = rOf(sA); const fB = rOf(sB);
    const dir = norm(sub(b, a));
    const A = add(a, scl(dir, fA - 0.012)); const B = sub(b, scl(dir, fB - 0.012));
    shine(tube([A, B], 0.022, { sides: 7, steps: 1, round: 1, straight: true }), BRASS_HI);
    for (const [P, Q] of [[A, dir], [B, scl(dir, -1)]]) {
      const d = latheUp([[0, -0.03], [0.06, -0.03], [0.065, 0], [0.03, 0.03], [0, 0.04]], { segments: 10 });
      seat(d, P, Q);
      shine(d, BRASS_HI);
    }
  };
  const nearest = (sFrom, lo, hi) => {
    let best = lo; let bd = 1e9;
    const p = path.at(sFrom);
    for (let i = 0; i <= 200; i += 1) {
      const s = mix(lo, hi, i / 200);
      const q = path.at(s);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // The stays from the bell column to the wraps are dead level. A stay that climbs leaves the column where
  // the flare is wider, so its root ends up inside the hollow, where it shows from above the rim.
  for (const y of [2.05, 2.85, 3.65]) {
    let sY = L * 0.9; let bestY = 1e9;
    for (let i = 0; i <= 300; i += 1) {
      const q = mix(L * 0.87, L, i / 300);
      const d = Math.abs(path.at(q)[1] - y);
      if (d < bestY) { bestY = d; sY = q; }
    }
    const c = path.at(sY);
    let s2 = -1; let bestH = 1e9;
    for (let i = 0; i <= 1200; i += 1) {
      const q = mix(L * 0.3, L * 0.8, i / 1200);
      const w = path.at(q);
      if (Math.abs(w[1] - y) > 0.03) continue;
      const h = Math.hypot(w[0] - c[0], w[2] - c[2]);
      if (h < bestH) { bestH = h; s2 = q; }
    }
    if (s2 < 0) continue;
    const b = path.at(s2);
    const dir = norm([b[0] - c[0], 0, b[2] - c[2]]);
    const A = add(c, scl(dir, rOf(sY) - 0.012));
    const B = sub(b, scl(dir, rOf(s2) - 0.012));
    shine(tube([A, B], 0.022, { sides: 7, steps: 1, round: 1, straight: true }), BRASS_HI);
    for (const [P, Q] of [[A, dir], [B, scl(dir, -1)]]) {
      const d = latheUp([[0, 0.0], [0.06, 0.0], [0.065, 0.015], [0.03, 0.045], [0, 0.05]], { segments: 10 });
      seat(d, P, Q);
      shine(d, BRASS_HI);
    }
  }
  brace(L * 0.84, nearest(L * 0.84, L * 0.3, L * 0.62));
  brace(path.sValve[3] + 0.22, nearest(path.sValve[3] + 0.22, L * 0.36, L * 0.7));
  // The leadpipe's stay goes down to the valve under it; run to the wraps instead, it passes through the bell.
  {
    const lp = (() => { let best = 0; let bd = 1e9; for (let i = 0; i <= 200; i += 1) { const q = path.at((i / 200) * path.sValve[0]); const d = Math.abs(q[0] - TUBA_VALVES[1]); if (d < bd) { bd = d; best = (i / 200) * path.sValve[0]; } } return path.at(best); })();
    shine(tube([[lp[0], lp[1] - 0.03, lp[2] - 0.03], [TUBA_VALVES[1], VTOP - 0.18, TUBA_VALVE_Z + VR * 0.92]], 0.022, { sides: 7, steps: 1, round: 1, straight: true }), BRASS_HI);
  }

  // --- the mouthpiece, silver, with a dark cup ----------------------------------------------------------
  {
    const f = path.frameAt(0);
    const tipP = path.at(0);
    const back = scl(f.T, -1);
    const g = latheUp([
      [0, -0.1], [0.05, -0.1], [0.055, 0], [0.055, 0.05], [0.058, 0.2], [0.062, 0.36], [0.08, 0.44], [0.12, 0.49], [0.14, 0.53], [0.145, 0.57], [0.135, 0.59],
      [0.105, 0.585], [0.08, 0.53], [0.05, 0.47], [0.012, 0.44], [0, 0.44],
    ], { segments: 28 });
    seat(g, tipP, back);
    polishGeometry(g, lin(0xd9dce0), { pale: 0.4 });
    {
      const pos = g.attributes.position; const col = g.attributes.color;
      for (let i = 0; i < pos.count; i += 1) {
        const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
        const along = dot(sub(p, tipP), back);
        const rad = Math.hypot(...sub(sub(p, tipP), scl(back, along)));
        if (along > 0.44 && rad < 0.105 - (0.59 - along) * 0.4) col.setXYZ(i, 0.03, 0.03, 0.035);
      }
    }
    silver.push({ geometry: g, keepColor: true });
    // Its receiver on the end of the leadpipe.
    const rc = latheUp([[0, -0.2], [0.07, -0.2], [0.08, -0.18], [0.08, 0.02], [0.07, 0.04], [0, 0.04]], { segments: 18 });
    seat(rc, add(tipP, scl(f.T, 0.22)), back);
    shine(rc, BRASS_HI);
  }

  // --- the low stand: three legs, a padded cradle under the bow, a padded fork at the bell column ------
  const steel = 0x1b1c1e;
  const STAND_X = -0.72;
  const sLow = (() => {
    let best = 0; let lowest = 1e9;
    for (let i = 0; i <= 400; i += 1) {
      const s = mix(L * 0.7, L * 0.95, i / 400);
      const y = path.at(s)[1] - rOf(s);
      if (y < lowest) { lowest = y; best = s; }
    }
    return best;
  })();
  const low = path.at(sLow);
  const rLow = rOf(sLow);
  const underY = low[1] - rLow;
  for (let i = 0; i < 3; i += 1) {
    const a = ((i + 0.25) / 3) * Math.PI * 2;
    const tipX = STAND_X + Math.sin(a) * 1.5; const tipZ = Math.cos(a) * 1.5;
    dark.push({ geometry: tube([[STAND_X, 0.2, 0], [mix(STAND_X, tipX, 0.5), 0.13, tipZ * 0.5], [tipX, 0.05, tipZ]], [0.055, 0.05, 0.045], { sides: 8, steps: 8, round: 1 }), color: steel });
    dark.push({ geometry: latheUp([[0, 0], [0.09, 0], [0.095, 0.03], [0.07, 0.07], [0.045, 0.1], [0, 0.1]], { segments: 10 }).translate(tipX, 0, tipZ), color: 0x101010 });
  }
  dark.push({ geometry: latheUp([[0, 0.12], [0.1, 0.12], [0.105, 0.18], [0.09, 0.29], [0, 0.31]], { segments: 14 }).translate(STAND_X, 0, 0), color: steel });
  dark.push({ geometry: tube([[STAND_X, 0.26, 0], [low[0], underY - 0.06, low[2]]], 0.04, { sides: 8, steps: 1, straight: true, round: 1 }), color: steel });
  {
    const pts = [];
    for (let i = 0; i <= 12; i += 1) {
      const ang = -Math.PI * 0.4 + (i / 12) * Math.PI * 0.8;
      const f = path.frameAt(sLow);
      const s = cross(f.T, [0, 1, 0]);
      const side = norm(s);
      const rr = rLow + 0.012;
      pts.push(add(low, add(scl(side, Math.sin(ang) * rr), [0, -Math.cos(ang) * rr, 0])));
    }
    soft.push({ geometry: tube(pts, 0.042, { sides: 8, steps: 18, round: 2 }), color: 0x232325 });
  }
  {
    const sF = L * 0.885;
    const c = path.at(sF);
    const rF = rOf(sF) + 0.03;
    const back = [c[0] - rF * 0.5, c[1], c[2] - rF * 0.87];
    dark.push({ geometry: tube([[STAND_X, 0.26, 0], [mix(STAND_X, back[0], 0.7), mix(0.26, back[1], 0.5), mix(0, back[2], 0.9)], back], 0.04, { sides: 8, steps: 10, round: 1 }), color: steel });
    const pts = [];
    for (let i = 0; i <= 14; i += 1) {
      const ang = (-210 + (i / 14) * 160) * (Math.PI / 180);
      pts.push([c[0] + Math.cos(ang) * rF, c[1], c[2] + Math.sin(ang) * rF]);
    }
    soft.push({ geometry: tube(pts, 0.03, { sides: 8, steps: 22, round: 2 }), color: 0x232325 });
  }

  // --- materials ----------------------------------------------------------------------------------------
  const engraving = tubaEngraving();
  const brassMesh = mesh(mergeLinear([hornPart, ...brass]), standard({ vertexColors: true, map: engraving, bumpMap: engraving, bumpScale: 0.1, roughness: 0.3, metalness: 0.22 }));
  const softMesh = mesh(mergeLinear(soft), standard({ vertexColors: true, roughness: 0.62, metalness: 0 }));
  const silverMesh = mesh(mergeLinear(silver), standard({ vertexColors: true, roughness: 0.24, metalness: 0.3 }));
  const darkMesh = mesh(mergeLinear(dark), standard({ vertexColors: true, roughness: 0.5, metalness: 0.25 }));
  return group(brassMesh, softMesh, silverMesh, darkMesh);
}

// ---------------------------------------------------------------------------
// The kora, about one and a half times life
// ---------------------------------------------------------------------------

// The player holds the neck upright with the skin toward them and sees the strings as two rows, one each
// side of the bridge. So +Z is the player's side and -X is their left. The string layout is arithmetic:
// long strings tie on high up the neck and sit in the bridge's outer notches, short strings tie on low
// and sit in its inner notches, which is the only arrangement in which they do not cross. Tuning differs by
// player and tradition, so no pitches are given here.
const KORA = {
  ZS: 0.22, // the plane of the skin
  GY: 2.08, // the gourd's centre height
  GR: 1.3, // its radius across
  GV: 1.06, // and how much taller than wide
  GD: 1.27, // and how deep behind the skin
  NZ: 0.14, // the neck's axis, just under the skin
  NR: 0.082,
  NECK_LOW: 0.46,
  NECK_TOP: 5.98,
  BY: 2.46, // the bridge's height up the skin
  BH: 1.08, // how far it stands off the skin
  APEX: 0.112, // how far either side of the centre a notch's apex is
  EDGE: 0.152,
  RING: [0, 0.6, 0.38],
  RING_R: 0.115,
  RINGS_LOW: 3.66,
  RINGS_HIGH: 5.66,
};

// Every string, computed. `rank` 0 is the longest. They alternate side by length, which gives the left row
// the eleven and the right row the ten.
export const KORA_STRINGS = (() => {
  const list = [];
  for (let rank = 0; rank < 21; rank += 1) {
    const side = rank % 2 === 0 ? -1 : 1;
    const inRow = Math.floor(rank / 2);
    const pitch = 0.0645;
    const top = KORA.BH - 0.1;
    // The left row's notches and the right's are half a pitch apart, so the two edges stagger.
    const notchZ = top - inRow * pitch - (side > 0 ? pitch * 0.5 : 0);
    const tieY = mix(KORA.RINGS_HIGH, KORA.RINGS_LOW, rank / 20);
    list.push({ rank, side, inRow, notchZ, tieY, r: mix(0.017, 0.0105, rank / 20) });
  }
  return list;
})();

export function koraReport() {
  const left = KORA_STRINGS.filter((s) => s.side < 0);
  const right = KORA_STRINGS.filter((s) => s.side > 0);
  // No string crosses its neighbour in its own row: both ends move the same way.
  const noCross = (row) => row.every((s, i) => i === 0 || (s.notchZ < row[i - 1].notchZ && s.tieY < row[i - 1].tieY));
  const notches = KORA_STRINGS.map((s) => s.side * s.notchZ);
  return {
    strings: KORA_STRINGS.length, left: left.length, right: right.length,
    rowsDoNotCross: noCross(left) && noCross(right),
    everyStringHasItsOwnNotch: new Set(notches).size === KORA_STRINGS.length,
    leatherRings: KORA_STRINGS.length,
  };
}

function koraHideMap() {
  const rng = seededRandom(1721);
  const S = 1024;
  const t = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(214,178,132)';
    ctx.fillRect(0, 0, S, S);
    // A hide's own patches, soft and irregular.
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * S; const y = rng() * S; const r = 24 + rng() * 110;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = rng() > 0.55 ? '120,78,46' : '236,208,168';
      g.addColorStop(0, `rgba(${c},${0.1 + rng() * 0.22})`);
      g.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Pores and fine scratches.
    for (let i = 0; i < 9000; i += 1) {
      const v = rng() > 0.6 ? '84,54,30' : '240,220,186';
      ctx.fillStyle = `rgba(${v},${0.05 + rng() * 0.16})`;
      ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
    }
    // A shadow where the skin was pulled tight over the rim, and the stain of a thousand hands below the bridge.
    const c = S / 2;
    const rad = ctx.createRadialGradient(c, c, c * 0.72, c, c, c);
    rad.addColorStop(0, 'rgba(70,40,18,0)'); rad.addColorStop(1, 'rgba(70,40,18,0.42)');
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, S, S);
  });
  return t;
}

function koraGourdMap() {
  const rng = seededRandom(1722);
  const W = 512; const H = 1024;
  const t = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = 'rgb(238,232,222)';
    ctx.fillRect(0, 0, W, H);
    // Long streaks, pole to rim, the way a dried calabash's skin runs.
    for (let i = 0; i < 300; i += 1) {
      const x = rng() * W;
      const v = 196 + rng() * 59;
      ctx.strokeStyle = `rgba(${v},${v - 6},${v - 16},${0.08 + rng() * 0.2})`;
      ctx.lineWidth = 0.8 + rng() * 5;
      const wob = 3 + rng() * 12; const ph = rng() * 6.28;
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        for (let y = 0; y <= H; y += 48) {
          const px = x + ox + Math.sin((y / H) * 6.28 * 2 + ph) * wob;
          if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }
    // Scorch and flecks.
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * W; const y = rng() * H; const r = 10 + rng() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(120,78,40,${0.05 + rng() * 0.1})`); g.addColorStop(1, 'rgba(120,78,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // A band of burned chevrons near the rim (v = 1 is the top of the canvas), the decoration many gourds carry.
    ctx.strokeStyle = 'rgba(56,30,14,0.82)';
    ctx.lineWidth = 3.2;
    const y0 = 54;
    const N = 28;
    ctx.beginPath(); ctx.moveTo(0, y0 - 16); ctx.lineTo(W, y0 - 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, y0 + 32); ctx.lineTo(W, y0 + 32); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= N; i += 1) { const x = (i / N) * W; const y = y0 + (i % 2 ? 22 : -6); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// A near-white wood figure, multiplied by whatever colour it lies on.
function koraWoodMap() {
  const rng = seededRandom(1723);
  const w = 256; const h = 512;
  const t = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = 'rgb(232,232,232)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 170; i += 1) {
      const x = rng() * w;
      const v = 140 + rng() * 100;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.5})`;
      ctx.lineWidth = 0.6 + rng() * rng() * 6;
      const wob = 2 + rng() * 8; const ph = rng() * 6.28;
      for (const ox of [-w, 0, w]) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 32) {
          const px = x + ox + Math.sin((y / h) * 6.28 * 2 + ph) * wob;
          if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function kora() {
  const report = koraReport();
  if (report.strings !== 21 || report.left !== 11 || report.right !== 10 || !report.rowsDoNotCross || !report.everyStringHasItsOwnNotch) {
    throw new Error(`the kora's strings are wrong: ${JSON.stringify(report)}`);
  }
  const K = KORA;
  const gourd = [];
  const wood = [];
  const plain = [];
  const metal = [];
  const skinParts = [];
  const ORANGE = lin(0xbf6f2a); const DEEP = lin(0x7f4418); const PALE = lin(0xd2914a);
  const WOOD_DARK = lin(0x5a3419); const WOOD_MID = lin(0x7a4a24); const WOOD_STAND = lin(0x6a4326);
  const LEATHER_A = lin(0x6b3f1e); const LEATHER_B = lin(0x53301a); const NYLON = lin(0xeee9db);
  const BRASS = lin(0xd9ac4c);

  // --- the half gourd: a bowl turned round Z, a little taller than it is wide ------------------------
  // `bowl(phi, theta)`: phi from the back pole to the rim, theta round. Everything on it asks this.
  const bowl = (phi, theta) => {
    const r = K.GR * Math.sin(phi) ** 0.92;
    const d = K.GD * Math.cos(phi);
    return [Math.sin(theta) * r, K.GY + Math.cos(theta) * r * K.GV, K.ZS - 0.02 - d];
  };
  {
    const ROWS = 34; const SIDES = 72;
    const pos = []; const uv = []; const idx = [];
    for (let i = 0; i <= ROWS; i += 1) {
      const phi = ((i + 0.02) / ROWS) * (Math.PI / 2);
      for (let j = 0; j <= SIDES; j += 1) {
        const p = bowl(Math.min(phi, Math.PI / 2), (j / SIDES) * Math.PI * 2);
        const lump = 1 + 0.012 * (fbm(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3, 2) - 0.5);
        pos.push(p[0] * lump, K.GY + (p[1] - K.GY) * lump, K.ZS - 0.02 + (p[2] - K.ZS + 0.02) * lump);
        uv.push(j / SIDES, i / ROWS);
      }
    }
    for (let i = 0; i < ROWS; i += 1) {
      for (let j = 0; j < SIDES; j += 1) {
        const a = i * (SIDES + 1) + j; const b = a + 1; const d = (i + 1) * (SIDES + 1) + j; const c = d + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
    // Closed behind the skin, and a pole at the back.
    const pole = pos.length / 3; pos.push(0, K.GY, K.ZS - 0.02 - K.GD); uv.push(0, 0);
    const front = pos.length / 3; pos.push(0, K.GY, K.ZS - 0.02); uv.push(0, 1);
    for (let j = 0; j < SIDES; j += 1) {
      idx.push(pole, j + 1, j);
      idx.push(front, ROWS * (SIDES + 1) + j, ROWS * (SIDES + 1) + j + 1);
    }
    let g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g = outward(g);
    g.computeVertexNormals();
    weldSeam(g, SIDES + 1, ROWS + 1);
    tintVertices(g, (x, y, z, out) => {
      const n = fbm(x * 0.9 + 3, y * 0.9, z * 0.9, 3);
      const c = mix3(mix3(DEEP, ORANGE, sstep(n, 0.28, 0.56)), PALE, sstep(n, 0.58, 0.78) * 0.6);
      const nearRim = sstep(z, K.ZS - 0.42, K.ZS - 0.1);
      const k = 1 - nearRim * 0.14;
      out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    });
    gourd.push({ geometry: g, keepColor: true });
  }

  // --- the cowhide: one surface from the middle, out over the rim and back down the bowl, where it is
  //     tacked. It bulges over the neck under it, as it does. --------------------------------------------
  const HIDE_R = K.GR * 1.015;
  const skinZ = (x, y) => {
    const dx = x / HIDE_R; const dy = (y - K.GY) / (HIDE_R * K.GV);
    const rho2 = Math.min(1, dx * dx + dy * dy);
    const dome = 0.045 * (1 - rho2);
    const along = sstep(y, K.GY - K.GR * K.GV, K.GY - K.GR * K.GV + 0.3) * (1 - sstep(y, K.GY + K.GR * K.GV - 0.3, K.GY + K.GR * K.GV));
    const neck = 0.075 * Math.exp(-((x / 0.14) ** 2)) * along;
    return K.ZS + dome + neck;
  };
  const hideUV = (x, y) => [x / (2.1 * HIDE_R) + 0.5, (y - K.GY) / (2.1 * HIDE_R * K.GV) + 0.5];
  {
    const SECT = 96;
    const rhos = [0, 0.1, 0.2, 0.32, 0.44, 0.56, 0.68, 0.78, 0.86, 0.92, 0.96, 0.985, 1];
    const pos = []; const uv = []; const idx = [];
    for (const rho of rhos) {
      for (let j = 0; j <= SECT; j += 1) {
        const a = (j / SECT) * Math.PI * 2;
        const x = Math.sin(a) * rho * HIDE_R; const y = K.GY + Math.cos(a) * rho * HIDE_R * K.GV;
        pos.push(x, y, skinZ(x, y));
        const w = hideUV(x, y); uv.push(w[0], w[1]);
      }
    }
    // The lap over the rim, with its scalloped lower edge, held down on the bowl.
    const rows = rhos.length;
    const lap = [[1.012, -0.05], [1.01, -0.12], [0.995, -0.2]];
    const LAPS = lap.length;
    for (let m = 0; m < LAPS; m += 1) {
      for (let j = 0; j <= SECT; j += 1) {
        const a = (j / SECT) * Math.PI * 2;
        const scallop = m === LAPS - 1 ? 0.018 * Math.cos(a * 36) : 0;
        const rr = (lap[m][0]) * HIDE_R;
        const x = Math.sin(a) * rr; const y = K.GY + Math.cos(a) * rr * K.GV;
        pos.push(x, y, K.ZS + lap[m][1] + scallop);
        const w = hideUV(Math.sin(a) * HIDE_R * 0.995, K.GY + Math.cos(a) * HIDE_R * 0.995 * K.GV);
        uv.push(w[0], w[1]);
      }
    }
    const total = rows + LAPS;
    for (let i = 0; i < total - 1; i += 1) {
      for (let j = 0; j < SECT; j += 1) {
        const a = i * (SECT + 1) + j; const b = a + 1; const d = (i + 1) * (SECT + 1) + j; const c = d + 1;
        idx.push(a, b, c, a, c, d);
      }
    }
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const probe = (SECT + 1) * 4 * 6;
    const nProbe = cross(sub(P(idx[probe + 1]), P(idx[probe])), sub(P(idx[probe + 2]), P(idx[probe])));
    if (nProbe[2] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    weldSeam(g, SECT + 1, total);
    tintVertices(g, (x, y, z, out) => { out[0] = 1; out[1] = 1; out[2] = 1; });
    skinParts.push({ geometry: g, keepColor: true });
  }

  // Tacks: every one sits on the surface it asks for and is sunk into it.
  const stud = (x, y, z, r, nDir = [0, 0, 1], seg = 9) => {
    const g = latheUp([[0, -0.02], [r * 0.98, -0.02], [r, 0.002], [r * 0.82, r * 0.42], [r * 0.42, r * 0.66], [0, r * 0.72]], { segments: seg });
    seat(g, [x, y, z], nDir);
    polishGeometry(g, BRASS, { pale: 0.5 });
    metal.push({ geometry: g, keepColor: true });
  };
  const ringOfStuds = (rho, count, r, phase = 0) => {
    for (let i = 0; i < count; i += 1) {
      const a = ((i + phase) / count) * Math.PI * 2;
      const x = Math.sin(a) * rho * HIDE_R; const y = K.GY + Math.cos(a) * rho * HIDE_R * K.GV;
      stud(x, y, skinZ(x, y), r);
    }
  };
  ringOfStuds(0.965, 64, 0.03);
  ringOfStuds(0.905, 64, 0.022, 0.5);
  // The decorative studs: a small rosette each side of the skin below the bridge.
  for (const sx of [-1, 1]) {
    const cx = sx * 0.62; const cy = K.GY - 0.52;
    stud(cx, cy, skinZ(cx, cy), 0.036, [0, 0, 1], 11);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const x = cx + Math.cos(a) * 0.12; const y = cy + Math.sin(a) * 0.12;
      stud(x, y, skinZ(x, y), 0.022);
    }
  }
  // The lap's own tacks, on the side of the bowl, at each scallop.
  for (let i = 0; i < 36; i += 1) {
    const a = ((i + 0.5) / 36) * Math.PI * 2;
    const rr = 1.012 * HIDE_R;
    const n = norm([Math.sin(a), Math.cos(a) * 0.96, 0.08]);
    stud(Math.sin(a) * rr, K.GY + Math.cos(a) * rr * K.GV, K.ZS - 0.135, 0.024, n, 7);
  }

  // --- the neck: hardwood from below the gourd to the top, passing through it --------------------------
  const woodPart = (g, c, opts = {}) => { wood.push({ geometry: tintVertices(g, (x, y, z, out) => { const k = opts.flat ? 1 : 0.9 + 0.2 * fbm(x * 3, y * 0.6, z * 3, 2); out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; }), keepColor: true }); };
  {
    const g = latheUp([
      [0, K.NECK_LOW], [K.NR * 0.8, K.NECK_LOW], [K.NR, K.NECK_LOW + 0.06], [K.NR * 1.02, 1.2], [K.NR * 1.02, 3.4], [K.NR * 0.98, 4.6], [K.NR * 0.92, K.NECK_TOP - 0.12], [K.NR * 0.86, K.NECK_TOP - 0.03], [K.NR * 0.5, K.NECK_TOP], [0, K.NECK_TOP],
    ], { segments: 18 });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 0.5, g.attributes.position.getY(i) * 0.45);
    g.translate(0, 0, K.NZ);
    woodPart(g, WOOD_DARK);
  }
  // A leather collar where the neck leaves the top of the gourd.
  const topY = K.GY + K.GR * K.GV * 1.015;
  {
    const g = latheUp([[0, topY - 0.14], [K.NR + 0.05, topY - 0.14], [K.NR + 0.075, topY - 0.08], [K.NR + 0.075, topY + 0.1], [K.NR + 0.045, topY + 0.16], [0, topY + 0.16]], { segments: 16 });
    g.translate(0, 0, K.NZ);
    plain.push({ geometry: g, color: LEATHER_B });
  }

  // --- the leather tuning rings, one per string, and the strings ------------------------------------
  const bridgeZ = (s) => K.ZS + s.notchZ;
  KORA_STRINGS.forEach((s) => {
    const r = K.NR + 0.022;
    const h = 0.042;
    const g = latheUp([[0, s.tieY - h], [r * 0.9, s.tieY - h], [r + 0.012, s.tieY - h * 0.5], [r + 0.014, s.tieY + h * 0.5], [r * 0.9, s.tieY + h], [0, s.tieY + h]], { segments: 12 });
    g.translate(0, 0, K.NZ);
    plain.push({ geometry: g, color: s.rank % 2 ? LEATHER_A : LEATHER_B });
    // From the ring on the neck, over the notch, down to the iron ring.
    const tie = [s.side * (r + 0.006), s.tieY, K.NZ + 0.03];
    const notch = [s.side * (K.APEX + s.r * 0.9), K.BY, bridgeZ(s)];
    const a = (s.rank / 20) * 2.2 - 1.1; // where it meets the ring: spread over the ring's upper arc
    const onRing = [K.RING[0] + Math.sin(s.side * Math.abs(a) * 0.9 + s.side * 0.12) * K.RING_R, K.RING[1] + Math.cos(s.side * Math.abs(a) * 0.9 + s.side * 0.12) * K.RING_R, K.RING[2]];
    plain.push({ geometry: tube([tie, notch], s.r, { sides: 6, steps: 1, round: 0, straight: true }), color: NYLON });
    plain.push({ geometry: tube([notch, onRing], s.r, { sides: 6, steps: 1, round: 0, straight: true }), color: NYLON });
    // The knot at each end.
    const knot = new THREE.SphereGeometry(s.r * 1.9, 6, 4);
    knot.translate(onRing[0], onRing[1], onRing[2]);
    plain.push({ geometry: knot, color: NYLON });
    const knot2 = new THREE.SphereGeometry(s.r * 1.7, 6, 4);
    knot2.translate(tie[0], tie[1], tie[2]);
    plain.push({ geometry: knot2, color: NYLON });
  });

  // --- the bridge: a tall plank with a notch cut for every string, on both its edges -----------------------
  {
    const shape = new THREE.Shape();
    const foot = 0.22;
    const lefts = KORA_STRINGS.filter((s) => s.side < 0).sort((a, b) => a.notchZ - b.notchZ);
    const rights = KORA_STRINGS.filter((s) => s.side > 0).sort((a, b) => b.notchZ - a.notchZ);
    const NOTCH_H = 0.021;
    shape.moveTo(-foot, -0.02);
    shape.lineTo(-K.EDGE - 0.008, 0.11);
    for (const s of lefts) {
      shape.lineTo(-K.EDGE, s.notchZ - NOTCH_H);
      shape.lineTo(-K.APEX, s.notchZ);
      shape.lineTo(-K.EDGE, s.notchZ + NOTCH_H);
    }
    shape.lineTo(-K.EDGE + 0.008, K.BH - 0.03);
    shape.lineTo(-K.EDGE * 0.55, K.BH);
    shape.lineTo(K.EDGE * 0.55, K.BH);
    shape.lineTo(K.EDGE - 0.008, K.BH - 0.03);
    for (const s of rights) {
      shape.lineTo(K.EDGE, s.notchZ + NOTCH_H);
      shape.lineTo(K.APEX, s.notchZ);
      shape.lineTo(K.EDGE, s.notchZ - NOTCH_H);
    }
    shape.lineTo(K.EDGE + 0.008, 0.11);
    shape.lineTo(foot, -0.02);
    shape.closePath();
    const DEPTH = 0.1;
    const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, steps: 1 });
    g.rotateX(Math.PI / 2);
    g.translate(0, K.BY + DEPTH / 2, skinZ(0, K.BY));
    g.computeVertexNormals();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 0.7, uv.getY(i) * 0.7);
    woodPart(g, lin(0xb88a50), { flat: true });
    // The leather pad it stands on.
    const pad = latheUp([[0, -0.01], [0.24, -0.01], [0.255, 0.02], [0.24, 0.04], [0.16, 0.052], [0, 0.056]], { segments: 18 });
    pad.scale(1, 1, 0.46);
    seat(pad, [0, K.BY, skinZ(0, K.BY) - 0.012], [0, 0, 1]);
    plain.push({ geometry: pad, color: LEATHER_B });
  }

  // --- the iron ring at the foot, tied back to the neck's tail by a leather strap --------------------------
  {
    const g = new THREE.TorusGeometry(K.RING_R, 0.017, 8, 28);
    g.translate(K.RING[0], K.RING[1], K.RING[2]);
    polishGeometry(g, lin(0x8f8a82), { pale: 0.4 });
    metal.push({ geometry: g, keepColor: true });
    const low = K.RING[1] - K.RING_R;
    const tail = [0, K.NECK_LOW + 0.1, K.NZ];
    plain.push({ geometry: tube([[0, low + 0.012, K.RING[2]], [0, low - 0.035, K.RING[2] - 0.08], [0, K.NECK_LOW + 0.03, K.NZ + 0.14], [tail[0], tail[1], tail[2] + K.NR * 0.92]], 0.022, { sides: 7, steps: 10, round: 1, section: () => [1, 0.5] }), color: LEATHER_B });
    const wrap = latheUp([[0, K.NECK_LOW + 0.04], [K.NR + 0.022, K.NECK_LOW + 0.04], [K.NR + 0.03, K.NECK_LOW + 0.08], [K.NR + 0.03, K.NECK_LOW + 0.16], [K.NR + 0.022, K.NECK_LOW + 0.2], [0, K.NECK_LOW + 0.2]], { segments: 12 });
    wrap.translate(0, 0, K.NZ);
    plain.push({ geometry: wrap, color: LEATHER_A });
  }

  // --- the two hand posts, up out of the skin either side of the strings ---------------------------------
  for (const sx of [-1, 1]) {
    const base = [sx * 0.56, K.GY + 0.34];
    const root = [base[0], base[1], skinZ(base[0], base[1])];
    const dir = norm([sx * 0.07, 0.95, 0.3]);
    const start = add(root, scl(dir, -0.12));
    const g = latheUp([[0, -0.02], [0.05, -0.02], [0.056, 0.3], [0.05, 0.75], [0.044, 1.16], [0.03, 1.25], [0.012, 1.285], [0, 1.29]], { segments: 14 });
    seat(g, start, dir);
    woodPart(g, WOOD_MID);
    // The binding of hide where it goes in.
    const bind = latheUp([[0, 0.02], [0.084, 0.02], [0.098, 0.05], [0.09, 0.1], [0.066, 0.135], [0, 0.135]], { segments: 14 });
    seat(bind, start, dir);
    plain.push({ geometry: bind, color: LEATHER_B });
    // A wrap of leather for the hand.
    const grip = latheUp([[0, 0.54], [0.056, 0.54], [0.064, 0.56], [0.064, 0.82], [0.054, 0.84], [0, 0.84]], { segments: 14 });
    seat(grip, start, dir);
    plain.push({ geometry: grip, color: LEATHER_A });
  }

  // --- the sound port, cut in the gourd's side: a dark disc inside a raised rim of leather ---------------
  {
    const phi = 1.12; const theta = -0.86;
    const p = bowl(phi, theta);
    const e = 0.01;
    const px = sub(bowl(phi + e, theta), bowl(phi - e, theta));
    const py = sub(bowl(phi, theta + e), bowl(phi, theta - e));
    let n = norm(cross(px, py));
    if (dot(n, sub(p, [0, K.GY, K.ZS])) < 0) n = scl(n, -1);
    const disc = latheUp([[0, -0.03], [0.17, -0.03], [0.17, 0.012], [0, 0.012]], { segments: 18 });
    seat(disc, p, n);
    plain.push({ geometry: disc, color: lin(0x0d0a07) });
    const lip = latheUp([[0.16, -0.03], [0.225, -0.03], [0.232, 0.008], [0.215, 0.034], [0.178, 0.04], [0.158, 0.022], [0.16, -0.03]], { segments: 22 });
    seat(lip, p, n);
    plain.push({ geometry: lip, color: LEATHER_B });
  }

  // --- the low stand: a turned base, and a padded cradle up behind the bowl --------------------------------
  {
    const R = 1.24;
    const g = latheUp([[0, 0], [R, 0], [R, 0.09], [R * 0.985, 0.12], [R * 0.94, 0.14], [R * 0.9, 0.2], [R * 0.84, 0.235], [0, 0.25]], { segments: 56 });
    woodPart(g, WOOD_STAND);
    const STEEL = lin(0x252426);
    const CRADLE_PHI = 0.86;
    const pts = [];
    // Two arms that come up out of the base and follow the bowl's back, sunk a hair into its padding.
    for (const sx of [-1, 1]) {
      const onBowl = (phi) => {
        const q = bowl(phi, Math.PI + sx * 0.62);
        const n = norm(sub(q, [0, K.GY, K.ZS - 0.2]));
        return add(q, scl(n, 0.03));
      };
      const hi = onBowl(CRADLE_PHI);
      const lo = onBowl(1.28);
      const start = [lo[0] * 0.92, 0.2, lo[2] * 0.86 - 0.1];
      plain.push({ geometry: tube([start, mix3(start, lo, 0.6), lo, onBowl(1.08), hi], [0.05, 0.05, 0.045, 0.04, 0.036], { sides: 9, steps: 16, round: 1 }), color: STEEL });
      pts.push(hi);
      const foot = latheUp([[0, 0.2], [0.11, 0.2], [0.115, 0.25], [0.07, 0.3], [0, 0.31]], { segments: 12 });
      foot.translate(start[0], 0, start[2]);
      plain.push({ geometry: foot, color: STEEL });
    }
    // A strap between the two arms, right on the bowl, and a short post to the neck's tail.
    plain.push({ geometry: tube([pts[0], bowl(CRADLE_PHI - 0.1, Math.PI + 0.22), bowl(CRADLE_PHI - 0.12, Math.PI - 0.22), pts[1]].map((q) => add(q, [0, 0, -0.03])), 0.04, { sides: 8, steps: 12, round: 1 }), color: lin(0x38332c) });
    const tailY = K.NECK_LOW;
    plain.push({ geometry: latheUp([[0, 0.22], [0.06, 0.22], [0.05, tailY + 0.02], [0, tailY + 0.02]], { segments: 10 }).translate(0, 0, K.NZ), color: STEEL });
  }

  const gourdMap = koraGourdMap();
  const hideMap = koraHideMap();
  const woodMap = koraWoodMap();
  const hideBump = grainBump(1724, { size: 256, dots: 2600, contrast: 0.35 });
  const gourdMesh = mesh(mergeLinear(gourd), standard({ vertexColors: true, map: gourdMap, bumpMap: gourdMap, bumpScale: 0.12, roughness: 0.5, metalness: 0 }));
  const skinMesh = mesh(mergeLinear(skinParts), standard({ vertexColors: true, map: hideMap, bumpMap: hideBump, bumpScale: 0.25, roughness: 0.8, metalness: 0 }));
  const woodMesh = mesh(mergeLinear(wood), standard({ vertexColors: true, map: woodMap, roughness: 0.55, metalness: 0 }));
  const plainMesh = mesh(mergeLinear(plain), standard({ vertexColors: true, roughness: 0.72, metalness: 0 }));
  const metalMesh = mesh(mergeLinear(metal), standard({ vertexColors: true, roughness: 0.34, metalness: 0.3 }));
  return group(gourdMesh, skinMesh, woodMesh, plainMesh, metalMesh);
}

// ---------------------------------------------------------------------------
// The Great Mosque of Djenne, about 1/10
// ---------------------------------------------------------------------------

// +Z is the east, the qibla wall the town's market square looks up at. At 1/10: a square platform about
// 250ft a side raised about 10ft, with the prayer hall along its east side behind three box towers about
// 52ft tall and a walled courtyard behind that. Published figures for the building vary, so what is held
// to here is the platform, the tower height and the count on the east wall: three towers and eighteen
// buttresses. `DJ_VERTICAL` is the height of everything above the platform relative to true 1/10.
const DJ_VERTICAL = 1;
const DJ = {
  P: 12.5, // half the platform's side
  Y0: 1.0, // its top
  WALL_X: 9.9, // half the width of the building
  FRONT: 8.1, // the east wall's face
  BACK: -8.0,
  HALL_BACK: -0.4,
  WALL_H: 3.35, // to the top of the east wall's parapet
  COURT_H: 2.2,
};
const djY = (h) => DJ.Y0 + h * DJ_VERTICAL;
export const DJENNE_TOWERS = [
  { x: -5.4, hw: 1.22, h: 4.75, cone: 0.72 },
  { x: 0, hw: 1.42, h: 5.25, cone: 0.92 },
  { x: 5.4, hw: 1.22, h: 4.75, cone: 0.72 },
];
// The buttresses stand in the four stretches of wall the towers leave, and only those count: the two corner
// masses are a different thing and are not among the eighteen.
export const DJENNE_BUTTRESSES = (() => {
  const CORNER = DJ.WALL_X - 0.62;
  const stretches = [
    [-CORNER, DJENNE_TOWERS[0].x - DJENNE_TOWERS[0].hw, 4],
    [DJENNE_TOWERS[0].x + DJENNE_TOWERS[0].hw, DJENNE_TOWERS[1].x - DJENNE_TOWERS[1].hw, 5],
    [DJENNE_TOWERS[1].x + DJENNE_TOWERS[1].hw, DJENNE_TOWERS[2].x - DJENNE_TOWERS[2].hw, 5],
    [DJENNE_TOWERS[2].x + DJENNE_TOWERS[2].hw, CORNER, 4],
  ];
  const xs = [];
  for (const [a, b, n] of stretches) for (let i = 0; i < n; i += 1) xs.push(mix(a, b, (i + 0.5) / n));
  return xs;
})();

export function djenneReport() {
  return {
    platformSideFt: DJ.P * 2,
    towers: DJENNE_TOWERS.length,
    buttresses: DJENNE_BUTTRESSES.length,
    tallestTowerRealFt: (DJENNE_TOWERS[1].h * DJ_VERTICAL * 10),
    buildingWidthFt: DJ.WALL_X * 2,
    buildingDepthFt: DJ.FRONT - DJ.BACK,
  };
}

// A tapering rounded block, the shape of everything here. Mud does not hold a sharp edge.
function djBlock(cx, cz, y0, y1, hx0, hz0, hx1, hz1, round = 0.07) {
  const big = Math.max(hx0, hz0, hx1, hz1) + round;
  return {
    box: [cx - big, y0 - round, cz - big, cx + big, y1 + round, cz + big],
    f: (x, y, z) => {
      const t = clamp01((y - y0) / (y1 - y0));
      const dx = Math.abs(x - cx) - (mix(hx0, hx1, t) - round);
      const dz = Math.abs(z - cz) - (mix(hz0, hz1, t) - round);
      const dy = Math.max(y0 - y, y - y1) + round;
      const ox = Math.max(dx, 0); const oy = Math.max(dy, 0); const oz = Math.max(dz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0) - round;
    },
  };
}

// The conical pinnacle: a round-tipped cone, the tip the same mud as the wall.
const djCone = (x, y0, z, r, h) => segsP([[x, y0 - r * 0.4, z], [x, y0 + h - r * 0.22, z]], [r, r * 0.22]);

// Hand-smoothed plaster: faint sweeps of the palm, near white, carrying the grain the vertices cannot.
function djMudMap() {
  const rng = seededRandom(1907);
  const S = 512;
  const t = canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = 'rgb(234,232,228)';
    ctx.fillRect(0, 0, S, S);
    // The palm's sweeps: broad arcs, overlapping.
    for (let i = 0; i < 240; i += 1) {
      const x = rng() * S; const y = rng() * S;
      const r = 26 + rng() * 60;
      const a0 = rng() * 6.28;
      const v = rng() > 0.5 ? 255 : 150 + rng() * 40;
      ctx.strokeStyle = `rgba(${v},${v},${v - 4},${0.05 + rng() * 0.09})`;
      ctx.lineWidth = 8 + rng() * 22;
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, a0, a0 + 0.8 + rng() * 1.1);
          ctx.stroke();
        }
      }
    }
    // Straw and grit in the plaster: real banco is mud mixed with rice husk.
    for (let i = 0; i < 2600; i += 1) {
      const v = rng() > 0.55 ? 90 : 255;
      ctx.strokeStyle = `rgba(${v},${v - 6},${v - 18},${0.06 + rng() * 0.14})`;
      ctx.lineWidth = 0.6 + rng() * 0.9;
      const x = rng() * S; const y = rng() * S; const a = rng() * 6.28; const l = 1.5 + rng() * 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function djenneMosque() {
  const report = djenneReport();
  if (report.towers !== 3 || report.buttresses !== 18) throw new Error(`Djenne's east wall is wrong: ${JSON.stringify(report)}`);
  const MUD = lin(0xa98058); const MUD_PALE = lin(0xbf9c76); const MUD_RED = lin(0x98694a); const MUD_DARK = lin(0x76563a);
  const SAND = lin(0xb29878); const DOOR = lin(0x20150d);
  const mudTint = (x, y, z, nx, ny, nz, out) => {
    const n = fbm(x * 0.42 + 2, y * 0.8, z * 0.42, 3);
    const n2 = fbm(x * 1.3, y * 1.3 + 4, z * 1.3, 2);
    let c = mix3(MUD_RED, MUD, sstep(n, 0.28, 0.56));
    c = mix3(c, MUD_PALE, sstep(n2, 0.5, 0.72) * 0.7);
    // Fresher, paler plaster up high where the rain and the replastering reach; darker at the foot.
    c = mix3(c, MUD_DARK, (1 - sstep(y, DJ.Y0, DJ.Y0 + 0.9)) * 0.45);
    c = mix3(c, MUD_PALE, ny > 0.6 ? 0.35 : 0);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };
  const warp = (amp) => (d, x, y, z) => d + amp * (smoothNoise3(x * 0.72, y * 0.72, z * 0.72) - 0.5) * 2 + amp * 0.42 * (smoothNoise3(x * 1.7 + 5, y * 1.7, z * 1.7) - 0.5) * 2;

  // --- the east wall, its three towers and eighteen buttresses, finely sampled -------------------------
  const F = new Sculpt(0.195);
  const FACE = DJ.FRONT;
  const WALL_TOP = djY(DJ.WALL_H);
  // The wall itself: its top is the parapet of the prayer hall's roof.
  F.add(djBlock(0, FACE - 0.4, DJ.Y0 - 0.2, WALL_TOP, DJ.WALL_X, 0.42, DJ.WALL_X - 0.05, 0.3, 0.09), MUD);
  // A slight foot along the base.
  F.add(djBlock(0, FACE - 0.12, DJ.Y0 - 0.2, DJ.Y0 + 0.28, DJ.WALL_X + 0.1, 0.42, DJ.WALL_X + 0.05, 0.26, 0.1), MUD, { k: 0.1 });
  // The towers: boxes that taper as they rise, standing out from the wall.
  const towerBox = [];
  DJENNE_TOWERS.forEach((T) => {
    const top = djY(T.h);
    const cz = FACE + 0.6;
    const hz = 1.25;
    F.add(djBlock(T.x, cz, DJ.Y0 - 0.2, top, T.hw, hz, T.hw * 0.76, hz * 0.8, 0.11), MUD, { k: 0.14 });
    towerBox.push({ ...T, top, cz, hz });
    // Three ribs up its face: the tower's own buttresses, each carrying its row of beams.
    const zf = cz + hz;
    for (const u of [-0.56, 0, 0.56]) {
      const rx = T.x + u * T.hw;
      F.add(djBlock(rx, zf - 0.08, DJ.Y0 - 0.1, top - 0.18, 0.17, 0.2, 0.13, 0.13, 0.06), MUD, { k: 0.1 });
    }
    // A parapet of small round merlons on its four corners, and the great cone in the middle of its top.
    const tx = T.hw * 0.76 - 0.2; const tz = hz * 0.8 - 0.2;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      F.add(djCone(T.x + sx * tx, top - 0.02, cz + sz * tz, 0.17, 0.5), MUD_PALE, { k: 0.08 });
    }
    F.add(djCone(T.x, top - 0.04, cz, T.hw * 0.46, T.cone), MUD_PALE, { k: 0.14 });
  });
  // The eighteen.
  DJENNE_BUTTRESSES.forEach((x) => {
    F.add(djBlock(x, FACE + 0.04, DJ.Y0 - 0.2, WALL_TOP + 0.2, 0.21, 0.34, 0.15, 0.2, 0.06), MUD, { k: 0.09 });
    F.add(djCone(x, WALL_TOP + 0.18, FACE + 0.04, 0.155, 0.44), MUD_PALE, { k: 0.06 });
  });
  // The corner masses.
  for (const sx of [-1, 1]) {
    const x = sx * DJ.WALL_X;
    F.add(djBlock(x, FACE - 0.15, DJ.Y0 - 0.2, WALL_TOP + 0.36, 0.56, 0.62, 0.4, 0.44, 0.1), MUD, { k: 0.12 });
    F.add(djCone(x, WALL_TOP + 0.34, FACE - 0.15, 0.26, 0.56), MUD_PALE, { k: 0.08 });
  }
  F.map(warp(0.024));
  const fField = F.snapshot();
  const frontG = polygonize(F, { tint: mudTint, uvScale: 0.62 });

  // --- the rest of the building, coarser: hall, courtyard, side and back walls ------------------------
  const B = new Sculpt(0.4);
  const SIDE_H = djY(DJ.WALL_H - 0.2);
  const ROOF_Y = djY(DJ.WALL_H - 0.75);
  const COURT_TOP = djY(DJ.COURT_H);
  const HB = DJ.HALL_BACK;
  // The hall: a great block, its roof sunk inside a parapet.
  B.add(djBlock(0, (HB + FACE - 0.6) / 2, DJ.Y0 - 0.2, SIDE_H, DJ.WALL_X, (FACE - 0.6 - HB) / 2, DJ.WALL_X - 0.05, (FACE - 0.6 - HB) / 2 - 0.03, 0.12), MUD);
  B.sub(djBlock(0, (HB + FACE - 0.6) / 2, ROOF_Y, SIDE_H + 1, DJ.WALL_X - 0.42, (FACE - 0.6 - HB) / 2 - 0.42, DJ.WALL_X - 0.42, (FACE - 0.6 - HB) / 2 - 0.42, 0.1), MUD_PALE, { k: 0.08 });
  // The courtyard's four walls, with deep arcades cut into their inner faces.
  const COURT_CZ = (DJ.BACK + HB) / 2;
  const COURT_HZ = (HB - DJ.BACK) / 2;
  B.add(djBlock(0, COURT_CZ, DJ.Y0 - 0.2, COURT_TOP, DJ.WALL_X, COURT_HZ, DJ.WALL_X - 0.04, COURT_HZ - 0.04, 0.12), MUD, { k: 0.12 });
  const WT = 1.25;
  const courtHX = DJ.WALL_X - WT; const courtHZ = COURT_HZ - 1.0;
  B.sub(djBlock(0, COURT_CZ - 0.05, DJ.Y0 - 0.12, COURT_TOP + 2, courtHX, courtHZ, courtHX + 0.08, courtHZ + 0.08, 0.1), SAND, { k: 0.07 });
  // Arches: rounded recesses, dark at their backs, round three sides of the court.
  const niche = (cx, cz, hx, hz) => {
    B.sub(djBlock(cx, cz, DJ.Y0 + 0.1, COURT_TOP - 0.55, hx, hz, hx * 0.62, hz * 0.62, 0.08), DOOR, { k: 0.04 });
  };
  const NN = 7;
  for (let i = 0; i < NN; i += 1) {
    const z = mix(COURT_CZ - courtHZ + 0.55, COURT_CZ + courtHZ - 0.55, i / (NN - 1));
    for (const sx of [-1, 1]) niche(sx * (courtHX + 0.32), z, 0.34, 0.31);
  }
  for (let i = 0; i < 11; i += 1) {
    const x = mix(-courtHX + 0.6, courtHX - 0.6, i / 10);
    niche(x, COURT_CZ - courtHZ - 0.3, 0.33, 0.34);
    if (i % 2 === 0) niche(x, COURT_CZ + courtHZ + 0.3, 0.33, 0.34);
  }
  // Buttresses round the side and back walls, each with its small pinnacle.
  const sideXs = [];
  for (let i = 0; i < 15; i += 1) sideXs.push(mix(DJ.BACK + 0.8, FACE - 1.0, (i + 0.5) / 15));
  sideXs.forEach((z) => {
    const inHall = z > HB;
    const top = inHall ? SIDE_H : COURT_TOP;
    for (const sx of [-1, 1]) {
      B.add(djBlock(sx * (DJ.WALL_X + 0.02), z, DJ.Y0 - 0.2, top + 0.1, 0.34, 0.3, 0.22, 0.22, 0.09), MUD, { k: 0.12 });
      B.add(djCone(sx * (DJ.WALL_X + 0.02), top + 0.08, z, 0.2, 0.42), MUD_PALE, { k: 0.08 });
    }
  });
  // The west wall, with the two square entrance towers and the door between them.
  for (let i = 0; i < 17; i += 1) {
    const x = mix(-DJ.WALL_X + 0.8, DJ.WALL_X - 0.8, i / 16);
    if (Math.abs(Math.abs(x) - 2.7) < 1.25 || Math.abs(x) < 1.2) continue;
    B.add(djBlock(x, DJ.BACK - 0.02, DJ.Y0 - 0.2, COURT_TOP + 0.1, 0.3, 0.34, 0.22, 0.22, 0.09), MUD, { k: 0.12 });
    B.add(djCone(x, COURT_TOP + 0.08, DJ.BACK - 0.02, 0.2, 0.42), MUD_PALE, { k: 0.08 });
  }
  for (const sx of [-1, 1]) {
    const x = sx * 2.7;
    const top = djY(3.5);
    B.add(djBlock(x, DJ.BACK - 0.1, DJ.Y0 - 0.2, top, 0.95, 0.95, 0.72, 0.72, 0.12), MUD, { k: 0.14 });
    B.add(djCone(x, top - 0.02, DJ.BACK - 0.1, 0.42, 0.72), MUD_PALE, { k: 0.1 });
  }
  B.sub(djBlock(0, DJ.BACK - 0.05, DJ.Y0 + 0.04, DJ.Y0 + 1.5, 0.66, 1.2, 0.4, 1.2, 0.12), DOOR, { k: 0.05 });
  // Doorways along the two sides of the hall.
  for (const z of [1.2, 3.6, 6.0]) {
    for (const sx of [-1, 1]) {
      B.sub(djBlock(sx * (DJ.WALL_X + 0.15), z, DJ.Y0 + 0.04, DJ.Y0 + 1.25, 0.6, 0.33, 0.6, 0.2, 0.08), DOOR, { k: 0.05 });
    }
  }
  B.map(warp(0.03));
  const bField = B.snapshot();
  const bodyG = polygonize(B, { tint: mudTint, uvScale: 0.62 });

  // --- the platform: one soft earth loft, out to its rounded square edge and in over its top -----------
  const PT = new Sculpt(0.185);
  // Six stairways, each cut into the platform's face between two capped cheeks.
  const stairs = [
    { x: -7.4, z: DJ.P, ox: 0, oz: 1 }, { x: 7.4, z: DJ.P, ox: 0, oz: 1 },
    { x: DJ.P, z: 4.5, ox: 1, oz: 0 }, { x: DJ.P, z: -5.0, ox: 1, oz: 0 },
    { x: -DJ.P, z: 4.5, ox: -1, oz: 0 }, { x: -DJ.P, z: -5.0, ox: -1, oz: 0 },
  ];
  const STEPS = 5;
  const RUN = 0.31;
  const HALF = 0.95;
  stairs.forEach((st) => {
    const lat = (u, out) => [st.x + (st.oz ? u : st.ox * out), st.z + (st.oz ? st.oz * out : u)];
    for (let k = 0; k < STEPS; k += 1) {
      const out = 0.06 + (STEPS - k - 0.5) * RUN;
      const y1 = (k + 1) * (DJ.Y0 / STEPS);
      const [cx, cz] = lat(0, out);
      const hx = st.oz ? HALF : RUN * 0.56; const hz = st.oz ? RUN * 0.56 : HALF;
      PT.add(djBlock(cx, cz, -0.1, y1, hx, hz, hx, hz, 0.035), SAND, { k: 0.015 });
    }
    for (const u of [-HALF - 0.22, HALF + 0.22]) {
      const [cx, cz] = lat(u, 0.72);
      const hx = st.oz ? 0.24 : 0.88; const hz = st.oz ? 0.88 : 0.24;
      PT.add(djBlock(cx, cz, -0.1, DJ.Y0 + 0.42, hx, hz, hx * 0.86, hz * 0.92, 0.1), MUD, { k: 0.05 });
      // The pinnacle on each cheek's outer end.
      const [ex, ez] = lat(u, 1.42);
      PT.add(djCone(ex, DJ.Y0 + 0.38, ez, 0.17, 0.46), MUD_PALE, { k: 0.05 });
    }
  });
  PT.map(warp(0.012));
  const stairG = polygonize(PT, { tint: mudTint, uvScale: 0.62 });

  const superR = (a, h) => {
    const s = Math.abs(Math.sin(a)); const c = Math.abs(Math.cos(a));
    return h / (s ** 8 + c ** 8) ** (1 / 8);
  };
  const platRows = [
    { h: DJ.P + 0.46, y: 0.0 }, { h: DJ.P + 0.34, y: 0.3 }, { h: DJ.P + 0.18, y: 0.66 }, { h: DJ.P + 0.04, y: 0.92 },
    { h: DJ.P - 0.12, y: 1.0 }, { h: DJ.P - 0.45, y: 1.02 }, { h: DJ.P - 1.2, y: 1.015 }, { h: DJ.P - 2.2, y: 1.01 }, { h: DJ.P - 3.6, y: 1.01 }, { h: 6, y: 1.01 }, { h: 2.6, y: 1.01 }, { h: 0.2, y: 1.01 },
  ];
  const earth = [];
  {
    const M = 88;
    const pos = []; const col = []; const uv = []; const idx = [];
    for (const row of platRows) {
      for (let j = 0; j < M; j += 1) {
        const a = (j / M) * Math.PI * 2;
        const r = superR(a, row.h);
        const x = Math.sin(a) * r; const z = Math.cos(a) * r;
        const wob = (smoothNoise3(x * 0.5, 2, z * 0.5) - 0.5) * 2;
        const y = row.y + (row.y < 1 ? wob * 0.02 : wob * 0.02);
        const rr = row.y < 0.95 ? 1 + wob * 0.006 : 1;
        pos.push(x * rr, y, z * rr);
        const n = fbm(x * 0.3 + 1, 3, z * 0.3, 3);
        const top = row.y >= 1;
        const c = top ? mix3(SAND, MUD_PALE, sstep(n, 0.36, 0.64) * 0.8) : mix3(MUD_RED, MUD, sstep(n, 0.3, 0.6));
        col.push(c[0], c[1], c[2]);
        uv.push((x + z * 0.62) * 0.62, (y + z * 0.37) * 0.62);
      }
    }
    for (let r = 0; r < platRows.length - 1; r += 1) {
      for (let j = 0; j < M; j += 1) {
        const j2 = (j + 1) % M;
        const a = r * M + j; const b = r * M + j2; const c = (r + 1) * M + j2; const d = (r + 1) * M + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    // Measured: the top faces up.
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const t0 = M * 6 * 5;
    const n0 = cross(sub(P(idx[t0 + 1]), P(idx[t0])), sub(P(idx[t0 + 2]), P(idx[t0])));
    if (n0[1] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    earth.push({ geometry: g, keepColor: true });
  }

  // The low wall round the platform's top, one rounded run between each pair of stairs.
  const runs = [];
  const IN = DJ.P - 0.34;
  const gapFor = (list) => {
    const out = [];
    let prev = -IN;
    for (const g of [...list].sort((a, b) => a - b)) {
      out.push([prev, g - 1.3]);
      prev = g + 1.3;
    }
    out.push([prev, IN]);
    return out;
  };
  for (const [a, b] of gapFor([-7.4, 7.4])) runs.push([[a, IN], [b, IN]]);
  for (const [a, b] of gapFor([4.5, -5.0])) { runs.push([[IN, a], [IN, b]]); runs.push([[-IN, a], [-IN, b]]); }
  runs.push([[-IN, -IN], [IN, -IN]]);
  runs.forEach((run, ri) => {
    const [p0, p1] = run;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = Math.max(3, Math.round(len / 1.1));
    const pts = []; const rad = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const x = mix(p0[0], p1[0], t); const z = mix(p0[1], p1[1], t);
      const w = smoothNoise3(x * 0.6 + ri, 1, z * 0.6);
      pts.push([x, DJ.Y0 + 0.09 + (w - 0.5) * 0.04, z]);
      rad.push(0.175 + (w - 0.5) * 0.04);
    }
    const g = tube(pts, rad, { sides: 8, steps: n * 2, round: 2, section: () => [1.0, 1.55], frame: () => [0, 1, 0] });
    tintVertices(g, (x, y, z, out) => {
      const nn = fbm(x * 0.8, y * 2, z * 0.8, 2);
      const c = mix3(MUD_RED, MUD_PALE, sstep(nn, 0.3, 0.68) * 0.8);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    {
      const pw = g.attributes.position;
      const uvw = new Float32Array(pw.count * 2);
      for (let i = 0; i < pw.count; i += 1) { uvw[i * 2] = (pw.getX(i) + pw.getZ(i) * 0.62) * 0.62; uvw[i * 2 + 1] = (pw.getY(i) + pw.getZ(i) * 0.37) * 0.62; }
      g.setAttribute('uv', new THREE.BufferAttribute(uvw, 2));
    }
    earth.push({ geometry: g, keepColor: true });
  });

  // --- the toron: palm-wood bundles, placed by asking each wall where its surface is, in level rows ------
  const wood = [];
  const rngT = seededRandom(1906);
  const WOOD_A = lin(0x5e4128); const WOOD_B = lin(0x46301c); const WOOD_END = lin(0x8a6c48);
  const toron = (field, x, y, z, ax, az, len) => {
    const p = onSurface(field, [x, y, z], 0, 8);
    // A beam that did not land on a wall is left out, never left hanging in the air.
    if (Math.abs(field.d(p[0], p[1], p[2])) > 0.04) return;
    const dir = norm([ax + (rngT() - 0.5) * 0.09, (rngT() - 0.5) * 0.09 - 0.012, az + (rngT() - 0.5) * 0.09]);
    const a = sub(p, scl(dir, 0.14));
    const L = len * (0.82 + rngT() * 0.34);
    const b = add(p, scl(dir, L));
    const r = 0.055 + rngT() * 0.02;
    const g = tube([a, b], [r, r * 0.74], { sides: 5, steps: 1, round: 0, straight: true });
    const base = mix3(WOOD_A, WOOD_B, rngT());
    // The cut end is paler: it reads as the end of a beam.
    tintVertices(g, (px, py, pz, out) => {
      const along = dot(sub([px, py, pz], a), dir);
      const c = along > 0.14 + L - 0.02 ? WOOD_END : base;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    wood.push({ geometry: g, keepColor: true });
  };
  const LEN = 0.34;
  // On each tower: level rows up its three ribs and across its flanks.
  towerBox.forEach((T) => {
    const rows = Math.round((T.top - DJ.Y0 - 0.5) / 0.62);
    for (let r = 0; r < rows; r += 1) {
      const y = DJ.Y0 + 0.5 + r * 0.62;
      const f = clamp01((y - DJ.Y0) / (T.top - DJ.Y0));
      const wx = mix(T.hw, T.hw * 0.76, f);
      const wz = mix(T.hz, T.hz * 0.8, f);
      for (const u of [-0.56, 0, 0.56]) toron(fField, T.x + u * T.hw, y, T.cz + wz + 0.5, 0, 1, LEN);
      for (const sx of [-1, 1]) {
        for (const v of [-0.35, 0.38]) toron(fField, T.x + sx * (wx - 0.08), y, T.cz + v * wz, sx, 0, LEN); // started just inside, or a beam in the air between a tower and a buttress lands on the buttress's tip
      }
    }
  });
  // On every buttress, and across the wall between them.
  for (let r = 0; r < 5; r += 1) {
    const y = DJ.Y0 + 0.48 + r * 0.62;
    if (y > WALL_TOP - 0.25) break;
    DJENNE_BUTTRESSES.forEach((x) => toron(fField, x, y, FACE + 0.7, 0, 1, LEN));
    for (const sx of [-1, 1]) for (const dz of [-0.25, 0.25]) toron(fField, sx * DJ.WALL_X, y, FACE - 0.15 + dz + 1.0, 0, 1, LEN * 0.9);
  }
  // The side walls, sparser: this building is seen from everywhere.
  for (const z of sideXs) {
    for (const sx of [-1, 1]) {
      const top = z > HB ? SIDE_H : COURT_TOP;
      for (let r = 0; r < 3; r += 1) {
        const y = DJ.Y0 + 0.62 + r * 0.86;
        if (y > top - 0.2) break;
        toron(bField, sx * (DJ.WALL_X + 0.6), y, z, sx, 0, LEN * 0.9);
      }
    }
  }
  for (let i = 0; i < 17; i += 1) {
    const x = mix(-DJ.WALL_X + 0.8, DJ.WALL_X - 0.8, i / 16);
    if (Math.abs(x) < 1.2) continue;
    const onT = Math.abs(Math.abs(x) - 2.7) < 1.25;
    if (onT) continue;
    for (let r = 0; r < 3; r += 1) toron(bField, x, DJ.Y0 + 0.5 + r * 0.72, DJ.BACK - 0.6, 0, -1, LEN * 0.9);
  }
  for (const sx of [-1, 1]) {
    for (let r = 0; r < 5; r += 1) {
      const y = DJ.Y0 + 0.5 + r * 0.62;
      for (const dx of [-0.4, 0.4]) toron(bField, sx * 2.7 + dx, y, DJ.BACK - 1.4, 0, -1, LEN * 0.9);
    }
  }

  // The finial on each tower's cone: an ostrich egg, as the photographs show, seated into the mud's tip.
  const eggs = [];
  towerBox.forEach((T) => {
    const y = T.top - 0.04 + T.cone - 0.07;
    const g = latheUp([[0, -0.1], [0.05, -0.085], [0.088, -0.03], [0.1, 0.05], [0.085, 0.14], [0.05, 0.2], [0, 0.225]], { segments: 14 });
    g.translate(T.x, y, T.cz);
    eggs.push({ geometry: g, color: lin(0xefe9dc) });
  });
  // The roof's clay ventilation lids, in rows on the hall's roof.
  for (let i = 0; i < 7; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const x = mix(-7.6, 7.6, i / 6); const z = mix(1.1, 6.1, j / 2);
      const g = latheUp([[0, ROOF_Y - 0.02], [0.17, ROOF_Y - 0.02], [0.17, ROOF_Y + 0.05], [0.12, ROOF_Y + 0.09], [0, ROOF_Y + 0.1]], { segments: 8 });
      g.translate(x, 0, z);
      eggs.push({ geometry: g, color: lin(0x8f6340) });
    }
  }

  const mudMap = djMudMap();
  const mudBump = grainBump(1908, { size: 256, dots: 2400, min: 1.2, max: 4.2, contrast: 0.42 });
  mudBump.repeat.set(1, 1);
  const mudParams = () => ({ vertexColors: true, map: mudMap, bumpMap: mudBump, bumpScale: 0.38, roughness: 0.95, metalness: 0 });
  const frontMesh = mesh(mergeLinear([{ geometry: frontG, keepColor: true }, { geometry: bodyG, keepColor: true }, { geometry: stairG, keepColor: true }]), standard(mudParams()));
  const earthMesh = mesh(mergeLinear(earth), standard(mudParams()));
  const woodMesh = mesh(mergeLinear(wood), standard({ vertexColors: true, roughness: 0.92, metalness: 0 }));
  const eggMesh = mesh(mergeLinear(eggs), standard({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  return group(frontMesh, earthMesh, woodMesh, eggMesh);
}

export const BUILDERS = {
  'himeji-castle': himejiCastle,
  'djenne-mosque': djenneMosque,
  kora,
  steelpan,
  tuba,
};
