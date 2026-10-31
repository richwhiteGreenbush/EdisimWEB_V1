// Builders for the Model Database's fourth set of world landmarks and arts: Angkor Wat, Great
// Zimbabwe, a concert marimba, a koto and an alto saxophone.
//
// A music teacher and a history teacher will use these, so what a card or a student can count is
// COMPUTED and exported rather than drawn by eye:
//   marimba    every note from A2 to C7 walked in semitones. 52 bars, 31 naturals and 21 accidentals,
//              each with one tube whose length is the quarter wave of that note's own frequency.
//   koto       13 strings tuned in hirajoshi on D. Each bridge stands where the note's frequency puts
//              it on the string, so the staggered diagonal is arithmetic and nothing was placed.
//   saxophone  one path with one radius function from the neck to the rim, a straight cone and then
//              the flare. `saxBoreReport` proves it never steps or narrows.
//   Angkor Wat exactly five lotus-bud towers, written out as a quincunx.
//   Zimbabwe   the wall's taper and lean are one function of height; `zimbabweWallReport` gives the angle.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeParts, smoothNoise3, weldSeam } from '../../props/LoftKit.js';
import {
  seededRandom, canvasTexture, standard, mesh, group,
} from '../../PropKit.js';
import {
  lin, mix, clamp01, sstep, tintVertices, grainBump, tube, outward,
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

// A triangle soup with face normals (or normals handed in) and a colour per corner. Every polygon
// MEASURES its winding against an outward hint rather than assuming it.
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }

  get triangles() { return this.p.length / 9; }

  face(pts, col, hint = null, { uv = null, normals = null } = {}) {
    let P = pts;
    let C = col.length === 3 && typeof col[0] === 'number' ? null : col;
    const flat = C ? null : col;
    let UV = uv;
    let N = normals;
    let nrm = norm(cross(sub(P[1], P[0]), sub(P[P.length - 1], P[0])));
    if (Math.abs(nrm[0]) + Math.abs(nrm[1]) + Math.abs(nrm[2]) < 1e-9) return;
    if (hint && dot(nrm, hint) < 0) {
      P = [...P].reverse();
      if (C) C = [...C].reverse();
      if (UV) UV = [...UV].reverse();
      if (N) N = [...N].reverse();
      nrm = [-nrm[0], -nrm[1], -nrm[2]];
    }
    const ax = Math.abs(nrm[0]); const ay = Math.abs(nrm[1]); const az = Math.abs(nrm[2]);
    for (let i = 1; i < P.length - 1; i += 1) {
      for (const k of [0, i, i + 1]) {
        const q = P[k];
        this.p.push(q[0], q[1], q[2]);
        if (N) this.n.push(N[k][0], N[k][1], N[k][2]);
        else this.n.push(nrm[0], nrm[1], nrm[2]);
        if (UV) this.t.push(UV[k][0], UV[k][1]);
        else if (ay > 0.72) this.t.push(q[0], q[2]);
        else if (ax > az) this.t.push(q[2], q[1]);
        else this.t.push(q[0], q[1]);
        const c = C ? C[k] : flat;
        this.c.push(c[0], c[1], c[2]);
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

// A worked timber from a to b, chamfered, with its UVs in feet and the grain running along it. `side`
// says which way its width w runs. Closed at both ends.
function soupBeam(soup, a, b, w, d, col, { side = [1, 0, 0], ch = 0.012, uvScale = 1, uvOff = 0 } = {}) {
  const axis = norm(sub(b, a));
  const s0 = sub(side, scl(axis, dot(side, axis)));
  const X = norm(s0);
  const Y = cross(axis, X);
  const hw = w / 2; const hd = d / 2;
  const c = Math.min(ch, hw * 0.45, hd * 0.45);
  const loop = [[hw - c, hd], [hw, hd - c], [hw, -hd + c], [hw - c, -hd], [-hw + c, -hd], [-hw, -hd + c], [-hw, hd - c], [-hw + c, hd]];
  const at = (p, q) => add(add(p, scl(X, q[0])), scl(Y, q[1]));
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  let run = 0;
  for (let i = 0; i < 8; i += 1) {
    const j = (i + 1) % 8;
    const mid = [(loop[i][0] + loop[j][0]) / 2, (loop[i][1] + loop[j][1]) / 2];
    const out = add(scl(X, mid[0]), scl(Y, mid[1]));
    const step = Math.hypot(loop[j][0] - loop[i][0], loop[j][1] - loop[i][1]);
    soup.face([at(a, loop[i]), at(a, loop[j]), at(b, loop[j]), at(b, loop[i])], col, out, {
      uv: [[run * uvScale + uvOff, 0], [(run + step) * uvScale + uvOff, 0], [(run + step) * uvScale + uvOff, L * uvScale], [run * uvScale + uvOff, L * uvScale]],
    });
    run += step;
  }
  const dark = times(col, 0.8);
  soup.face(loop.map((q) => at(a, q)), dark, scl(axis, -1));
  soup.face(loop.map((q) => at(b, q)), dark, axis);
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

// A capped cylinder from a to b.
function bar(a, b, r1, r2 = r1, sides = 10) {
  const A = v3(a);
  const B = v3(b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r2, r1, dir.length(), sides, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// A lathed part turned so its +Y runs along `dir`, seated at p.
function seat(g, p, dir, roll = 0) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3(dir).normalize());
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
  g.applyMatrix4(new THREE.Matrix4().compose(v3(p), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// Polished metal with no environment map: the room's reflections painted in as vertex colour, from
// each vertex's normal. Bright windows, a dark horizon, a pale lift on the highlights.
function polishGeometry(g, hex, { gain = 1, floor = 0, pale = 0.55, ripple = 0 } = {}) {
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
    if (ripple) k *= 1 + ripple * Math.sin(pos.getX(i) * 5.3 + pos.getY(i) * 3.1 + pos.getZ(i) * 2.2) * Math.sin(pos.getX(i) * 1.7 - pos.getY(i) * 2.3 + 0.7);
    const up = Math.max(0, k - 1) * pale;
    arr[i * 3] = base[0] * k + up;
    arr[i * 3 + 1] = base[1] * k + up;
    arr[i * 3 + 2] = base[2] * k + up;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// A near-white wood figure tile: long streaks along V, with the odd dark pore line. Colour comes from
// whatever it multiplies.
function grainTile(seed, { w = 512, h = 1024, low = 150, base = 232, lines = 240 } = {}) {
  const rng = seededRandom(seed);
  const t = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i += 1) {
      const x = rng() * w;
      const v = low + rng() * (base + 20 - low);
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.5})`;
      ctx.lineWidth = 0.6 + rng() * rng() * 7;
      const wob = 2 + rng() * 10; const ph = rng() * 6.28;
      for (const ox of [-w, 0, w]) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 32) {
          const px = x + ox + Math.sin((y / h) * Math.PI * 2 * 2 + ph) * wob;
          if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }
    for (let i = 0; i < 2600; i += 1) {
      const v = 70 + rng() * 70;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.14 + rng() * 0.3})`;
      ctx.fillRect(rng() * w, rng() * h, 0.8 + rng(), 6 + rng() * 26);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// The marimba: A2 to C7, 52 bars
// ---------------------------------------------------------------------------

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => `${PITCH_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
const isNatural = (m) => !PITCH_NAMES[m % 12].includes('#');

const MAR_LOW = 45; // A2
const MAR_HIGH = 96; // C7
const MAR_NAT_TOP = 3.02;
const MAR_ACC_TOP = 3.09; // the back row stands about an inch proud of the front, as a real one does
const MAR_GAP = 0.026;
const MAR_SOUND = 1125; // feet per second, in room air
const MAR_MID = 0.02; // half the gap between the inner ends of the two rows

// Every position on this instrument comes from walking the semitones once. Bars narrow gently toward
// the top. Their length does NOT follow a plain bar's 1/sqrt(f), which would make the bottom bar more
// than four times the top one: a real low bar is undercut deeply, which lowers its pitch without
// lengthening it, so the ratio across this range is nearer 2.8. The exponent below is fitted to that.
const marWidth = (m) => mix(0.265, 0.16, (m - MAR_LOW) / (MAR_HIGH - MAR_LOW));
const marLength = (m) => 1.7 * 2.75 ** (-(m - MAR_LOW) / (MAR_HIGH - MAR_LOW));
const marThick = (m) => mix(0.105, 0.07, (m - MAR_LOW) / (MAR_HIGH - MAR_LOW));

// A stopped pipe resonates at the wavelength over four, less an end correction of 0.6 of its radius at
// the open top. So the tube is not styled: its length is this note's own frequency.
const marTubeRadius = (m) => marWidth(m) * 0.44;
const marTubeLength = (m) => MAR_SOUND / (4 * midiHz(m)) - 0.6 * marTubeRadius(m);

export function marimbaLayout() {
  const bars = [];
  let x = 0;
  for (let m = MAR_LOW; m <= MAR_HIGH; m += 1) {
    if (isNatural(m)) {
      const w = marWidth(m);
      bars.push({ m, name: midiName(m), natural: true, x: x + w / 2, w });
      x += w + MAR_GAP;
    }
  }
  const span = x - MAR_GAP;
  for (const b of bars) b.x -= span / 2;
  const naturals = bars.slice();
  // An accidental stands over the gap between the two naturals it lies between.
  for (let m = MAR_LOW; m <= MAR_HIGH; m += 1) {
    if (isNatural(m)) continue;
    const below = naturals.find((b) => b.m === m - 1);
    const above = naturals.find((b) => b.m === m + 1);
    const cx = (below.x + below.w / 2 + above.x - above.w / 2) / 2;
    bars.push({ m, name: midiName(m), natural: false, x: cx, w: marWidth(m) * 0.93 });
  }
  bars.sort((a, b) => a.m - b.m);
  for (const b of bars) {
    b.hz = midiHz(b.m);
    b.len = marLength(b.m);
    b.thick = marThick(b.m);
    const sign = b.natural ? 1 : -1;
    b.z = sign * (MAR_MID + b.len / 2);
    b.top = b.natural ? MAR_NAT_TOP : MAR_ACC_TOP;
    // A free bar's first mode has its still points 22.4% of the way in from each end.
    b.nodeIn = sign * (MAR_MID + b.len * 0.224);
    b.nodeOut = sign * (MAR_MID + b.len * 0.776);
    b.tubeR = marTubeRadius(b.m);
    b.tubeLen = marTubeLength(b.m);
  }
  return {
    bars,
    span,
    total: bars.length,
    naturals: bars.filter((b) => b.natural).length,
    accidentals: bars.filter((b) => !b.natural).length,
    octaves: (MAR_HIGH - MAR_LOW) / 12,
    tubes: bars.length,
  };
}

function marimba() {
  const layout = marimbaLayout();
  const { bars, span } = layout;
  const rng = seededRandom(1852);
  const wood = new Soup();
  const frame = new Soup();
  const metal = [];
  const dull = [];
  const yarnParts = [];

  // --- the bars: flat on top, arched underneath, with a real thickness -------------------------
  const ROSE = [lin(0x5e2c1e), lin(0x6c3524), lin(0x50261c), lin(0x783f28), lin(0x622d20)];
  const HOLE = [0.012, 0.009, 0.007];
  const STATIONS = 16;
  for (const b of bars) {
    const hw = b.w / 2;
    const ch = 0.012;
    const yT = b.top;
    const base = mix3(ROSE[Math.floor(rng() * ROSE.length)], ROSE[Math.floor(rng() * ROSE.length)], rng());
    const uo = rng() * 7; const vo = rng() * 7;
    const span01 = (m) => (m - MAR_LOW) / (MAR_HIGH - MAR_LOW);
    // The undercut: deepest on the low bars, nearly nothing at the top, spanning the nodes.
    const archDepth = b.thick * mix(0.68, 0.22, span01(b.m));
    const under = (t) => {
      const u = Math.abs(t - 0.5) / 0.3;
      return yT - b.thick + (u < 1 ? archDepth * Math.cos(u * Math.PI * 0.5) ** 2 : 0);
    };
    const zAt = (t) => b.z + (t - 0.5) * b.len;
    const uvOf = (x, z) => [(x + b.x + uo) * 0.9, (z + vo) * 0.32];
    const shade = (t) => times(base, 0.92 + 0.14 * Math.sin(t * Math.PI));
    for (let i = 0; i < STATIONS; i += 1) {
      const t0 = i / STATIONS; const t1 = (i + 1) / STATIONS;
      const z0 = zAt(t0); const z1 = zAt(t1);
      const yb0 = under(t0); const yb1 = under(t1);
      const X0 = b.x - hw; const X1 = b.x + hw;
      const top = [[X0 + ch, yT, z0], [X1 - ch, yT, z0], [X1 - ch, yT, z1], [X0 + ch, yT, z1]];
      wood.face(top, [shade(t0), shade(t0), shade(t1), shade(t1)], [0, 1, 0], { uv: top.map((q) => uvOf(q[0] - b.x, q[2])) });
      const sideCol = times(base, 0.78);
      wood.face([[X1 - ch, yT, z0], [X1, yT - ch, z0], [X1, yT - ch, z1], [X1 - ch, yT, z1]], times(base, 1.08), [1, 1, 0], { uv: [uvOf(hw - ch, z0), uvOf(hw, z0), uvOf(hw, z1), uvOf(hw - ch, z1)] });
      wood.face([[X0 + ch, yT, z0], [X0, yT - ch, z0], [X0, yT - ch, z1], [X0 + ch, yT, z1]], times(base, 1.08), [-1, 1, 0], { uv: [uvOf(-hw + ch, z0), uvOf(-hw, z0), uvOf(-hw, z1), uvOf(-hw + ch, z1)] });
      wood.face([[X1, yT - ch, z0], [X1, yb0, z0], [X1, yb1, z1], [X1, yT - ch, z1]], sideCol, [1, 0, 0], { uv: [uvOf(hw, z0), uvOf(hw + 0.08, z0), uvOf(hw + 0.08, z1), uvOf(hw, z1)] });
      wood.face([[X0, yT - ch, z0], [X0, yb0, z0], [X0, yb1, z1], [X0, yT - ch, z1]], sideCol, [-1, 0, 0], { uv: [uvOf(-hw, z0), uvOf(-hw - 0.08, z0), uvOf(-hw - 0.08, z1), uvOf(-hw, z1)] });
      // The tuned underside carries the file marks of the tuner, a little lighter than the top.
      wood.face([[X0, yb0, z0], [X1, yb0, z0], [X1, yb1, z1], [X0, yb1, z1]], times(base, 0.7), [0, -1, 0], { uv: [uvOf(-hw, z0), uvOf(hw, z0), uvOf(hw, z1), uvOf(-hw, z1)] });
    }
    // The two end grain faces.
    const zs = zAt(0); const ze = zAt(1);
    const endCol = times(base, 0.62);
    const yb = yT - b.thick;
    wood.face([[b.x - hw, yb, zs], [b.x + hw, yb, zs], [b.x + hw, yT - ch, zs], [b.x + hw - ch, yT, zs], [b.x - hw + ch, yT, zs], [b.x - hw, yT - ch, zs]], endCol, [0, 0, -1], { uv: [[0, 0], [0.2, 0], [0.2, 0.04], [0.2, 0.05], [0, 0.05], [0, 0.04]] });
    wood.face([[b.x - hw, yb, ze], [b.x + hw, yb, ze], [b.x + hw, yT - ch, ze], [b.x + hw - ch, yT, ze], [b.x - hw + ch, yT, ze], [b.x - hw, yT - ch, ze]], endCol, [0, 0, 1], { uv: [[0, 0], [0.2, 0], [0.2, 0.04], [0.2, 0.05], [0, 0.05], [0, 0.04]] });
    // Where the cord goes through: a dark hole on each side at each node.
    b.cordY = yT - b.thick * 0.5;
    for (const nz of [b.nodeIn, b.nodeOut]) {
      for (const s of [-1, 1]) {
        const hx = b.x + s * (hw + 0.0015);
        const ring = [];
        for (let k = 0; k < 6; k += 1) {
          const a = (k / 6) * Math.PI * 2;
          ring.push([hx, b.cordY + Math.sin(a) * 0.017, nz + Math.cos(a) * 0.017]);
        }
        frame.face(ring, HOLE, [s, 0, 0], { uv: ring.map(() => [0.01, 0.01]) });
      }
    }
  }

  // --- the cords and the rails under them, one pair per row, following the node lines ------------
  const X_END = span / 2 + 0.2;
  const FRAME_DARK = lin(0x472c1d);
  const FRAME_MID = lin(0x4f3322);
  const rowBars = { nat: bars.filter((b) => b.natural), acc: bars.filter((b) => !b.natural) };
  const CORD = 0xe6dcc0;
  const railLine = (row, key) => {
    const pts = row.map((b) => [b.x, b[key]]);
    const a = pts[0]; const a2 = pts[1]; const y = pts[pts.length - 1]; const y2 = pts[pts.length - 2];
    const slope0 = (a2[1] - a[1]) / (a2[0] - a[0]);
    const slope1 = (y[1] - y2[1]) / (y[0] - y2[0]);
    return [[-X_END, a[1] + slope0 * (-X_END - a[0])], ...pts, [X_END, y[1] + slope1 * (X_END - y[0])]];
  };
  const posts = [];
  for (const row of Object.values(rowBars)) {
    const yTop = row[0].top;
    const railTop = yTop - 0.135;
    for (const key of ['nodeIn', 'nodeOut']) {
      const line = railLine(row, key);
      // The rail: square timber along the polyline, in spans short enough to follow the curve.
      for (let i = 0; i < line.length - 1; i += 1) {
        const A = [line[i][0], railTop - 0.05, line[i][1]];
        const B = [line[i + 1][0], railTop - 0.05, line[i + 1][1]];
        soupBeam(frame, A, B, 0.06, 0.1, FRAME_MID, { side: [0, 0, 1], ch: 0.01, uvOff: i * 0.3 });
      }
      // The cord, threading every bar in its row from end post to end post.
      const pts = [];
      row.forEach((b, i) => {
        if (i === 0) pts.push([-X_END + 0.06, b.cordY, line[0][1] + (b[key] - line[0][1]) * ((-X_END + 0.06 + X_END) / (b.x + X_END))]);
        pts.push([b.x, b.cordY, b[key]]);
        if (i === row.length - 1) pts.push([X_END - 0.06, b.cordY, b[key] + (line[line.length - 1][1] - b[key]) * ((X_END - 0.06 - b.x) / (X_END - b.x))]);
      });
      dull.push({ geometry: tube(pts, 0.0072, { sides: 5, steps: pts.length * 2, round: 0 }), color: CORD });
      // Suspension posts in the gaps: the cord is hooked up onto them, so a bar touches nothing else.
      row.forEach((b, i) => {
        if (i === row.length - 1) return;
        const n = row[i + 1];
        const wide = (n.x - n.w / 2) - (b.x + b.w / 2) > 0.1;
        if (!wide && i % 3 !== 1) return;
        const px = (b.x + b.w / 2 + n.x - n.w / 2) / 2;
        const pz = mix(b[key], n[key], (px - b.x) / (n.x - b.x));
        const py = mix(b.cordY, n.cordY, (px - b.x) / (n.x - b.x));
        posts.push({ p: [px, py, pz], foot: railTop - 0.01 });
      });
      // The end post each cord is tied off on.
      for (const e of [line[0], line[line.length - 1]]) {
        const sx = e === line[0] ? -X_END + 0.06 : X_END - 0.06;
        posts.push({ p: [sx, row[e === line[0] ? 0 : row.length - 1].cordY, e[1]], foot: railTop - 0.01, end: true });
      }
    }
  }
  for (const { p, foot, end } of posts) {
    metal.push({ geometry: polishGeometry(latheUp([[0, foot], [0.016, foot], [0.016, foot + 0.02], [end ? 0.016 : 0.008, foot + 0.03], [end ? 0.014 : 0.008, p[1] + 0.008], [end ? 0.018 : 0.012, p[1] + 0.016], [end ? 0.018 : 0.012, p[1] + 0.026], [0, p[1] + 0.032]], { segments: 8 }).translate(p[0], 0, p[2]), 0x8d8a80), keepColor: true });
  }

  // --- the resonators: one tube per bar, its length this note's quarter wave ----------------------
  const GOLD = 0xb48a3c;
  for (const b of bars) {
    const y1 = b.top - b.thick - 0.055;
    const y0 = y1 - b.tubeLen;
    const r = b.tubeR;
    const wall = 0.011;
    const depth = Math.min(b.tubeLen * 0.8, 0.5);
    const g = latheUp([
      [0, y0], [r * 0.9, y0], [r, y0 + 0.012], [r, mix(y0, y1, 0.5)], [r, y1 - 0.016], [r + 0.005, y1 - 0.008], [r + 0.005, y1 - 0.002], [r, y1],
      [r - wall, y1], [r - wall, y1 - depth * 0.3], [r - wall, y1 - depth], [0, y1 - depth],
    ], { segments: r > 0.09 ? 18 : 14 });
    g.translate(b.x, 0, b.z);
    polishGeometry(g, GOLD, { ripple: 0.05 });
    // Dark inside: a pipe's mouth should read as a mouth when a student looks up under the bar.
    const pos = g.attributes.position; const col = g.attributes.color;
    for (let i = 0; i < pos.count; i += 1) {
      const rr = Math.hypot(pos.getX(i) - b.x, pos.getZ(i) - b.z);
      if (rr < r - wall * 0.5 && pos.getY(i) > y0 + 0.002) {
        const k = 0.02 + 0.32 * sstep(pos.getY(i), y1 - depth, y1);
        col.setXYZ(i, lin(GOLD)[0] * k, lin(GOLD)[1] * k, lin(GOLD)[2] * k);
      }
    }
    metal.push({ geometry: g, keepColor: true });
  }
  // The hanger bar each bank of tubes is riveted to, near the tops, so the tubes are a rack and not a
  // row of things hovering under the bars.
  for (const row of [rowBars.nat, rowBars.acc]) {
    const y = row[0].top - marThick(MAR_LOW) - 0.055 - 0.05;
    const pts = [[-X_END + 0.05, y, row[0].z * 1.05], ...row.map((b) => [b.x, y, b.z]), [X_END - 0.05, y, row[row.length - 1].z * 0.95]];
    metal.push({ geometry: polishGeometry(tube(pts, 0.02, { sides: 6, steps: pts.length * 2, round: 0 }), 0x4b463d), keepColor: true });
  }

  // --- the frame ---------------------------------------------------------------------------------
  const outerZ = (b) => MAR_MID + b.len + 0.14;
  const bassZ = outerZ(bars[0]);
  const trebZ = outerZ(bars[bars.length - 1]);
  const endFrame = (x, halfZ) => {
    const LEG_Z = halfZ - 0.13;
    const TOP = MAR_NAT_TOP - 0.13;
    const LEG_FOOT = 0.27;
    const xx = x;
    // The end board: a dark plank the rails all run into, with a shaped lower edge. Its top stands just
    // below the bars. Built from a closed outline with a real thickness.
    const th = 0.085;
    const n = 20;
    const bottom = (z) => TOP - 0.66 + 0.22 * Math.cos(((z / halfZ) * Math.PI) / 2) ** 2;
    for (let i = 0; i < n; i += 1) {
      const z0 = mix(-halfZ, halfZ, i / n); const z1 = mix(-halfZ, halfZ, (i + 1) / n);
      for (const s of [-1, 1]) {
        const q = [[xx + (s * th) / 2, bottom(z0), z0], [xx + (s * th) / 2, bottom(z1), z1], [xx + (s * th) / 2, TOP, z1], [xx + (s * th) / 2, TOP, z0]];
        frame.face(q, FRAME_DARK, [s, 0, 0], { uv: q.map((c) => [c[2] * 0.4, c[1] * 0.4]) });
      }
      frame.face([[xx - th / 2, bottom(z0), z0], [xx + th / 2, bottom(z0), z0], [xx + th / 2, bottom(z1), z1], [xx - th / 2, bottom(z1), z1]], times(FRAME_DARK, 0.7), [0, -1, 0]);
      frame.face([[xx - th / 2, TOP, z0], [xx + th / 2, TOP, z0], [xx + th / 2, TOP, z1], [xx - th / 2, TOP, z1]], times(FRAME_DARK, 1.2), [0, 1, 0]);
    }
    for (const zs of [-1, 1]) {
      frame.face([[xx - th / 2, bottom(zs * halfZ), zs * halfZ], [xx + th / 2, bottom(zs * halfZ), zs * halfZ], [xx + th / 2, TOP, zs * halfZ], [xx - th / 2, TOP, zs * halfZ]], FRAME_DARK, [0, 0, zs]);
      // A leg: square, tapering toward the floor, running up inside the board.
      const a = [xx, LEG_FOOT, zs * LEG_Z]; const b = [xx, TOP - 0.1, zs * LEG_Z];
      soupBeam(frame, a, b, 0.12, 0.15, FRAME_MID, { side: [1, 0, 0], ch: 0.018, uvOff: zs });
      // A caster: stem, swivel plate, fork and rubber wheel.
      metal.push({ geometry: polishGeometry(latheUp([[0, LEG_FOOT - 0.075], [0.055, LEG_FOOT - 0.075], [0.06, LEG_FOOT - 0.05], [0.03, LEG_FOOT - 0.03], [0.05, LEG_FOOT - 0.015], [0.05, LEG_FOOT + 0.008], [0, LEG_FOOT + 0.008]], { segments: 12 }).translate(xx, 0, zs * LEG_Z), 0x8e8e88), keepColor: true });
      for (const fs of [-1, 1]) metal.push({ geometry: polishGeometry(new THREE.BoxGeometry(0.012, 0.15, 0.07).translate(xx + fs * 0.04, 0.118, zs * LEG_Z + 0.0), 0x7c7c76), keepColor: true });
      const wheel = latheUp([[0, -0.03], [0.05, -0.03], [0.086, -0.022], [0.095, 0], [0.086, 0.022], [0.05, 0.03], [0, 0.03]], { segments: 16 });
      wheel.rotateZ(-Math.PI / 2);
      wheel.translate(xx, 0.095, zs * LEG_Z);
      dull.push({ geometry: wheel, color: 0x1f1f20 });
      metal.push({ geometry: polishGeometry(bar([xx - 0.05, 0.095, zs * LEG_Z], [xx + 0.05, 0.095, zs * LEG_Z], 0.016, 0.016, 8), 0xb9b8b0), keepColor: true });
    }
    // A cross rail low down.
    soupBeam(frame, [xx, 0.62, -LEG_Z], [xx, 0.62, LEG_Z], 0.085, 0.12, FRAME_MID, { side: [1, 0, 0], ch: 0.014 });
  };
  endFrame(-X_END, bassZ);
  endFrame(X_END, trebZ);
  // The stretcher tying the two ends together, in the open slot between the two banks of tubes, and a
  // spine beam high up on the same line.
  soupBeam(frame, [-X_END, 0.62, 0], [X_END, 0.62, 0], 0.13, 0.085, FRAME_MID, { side: [0, 1, 0], ch: 0.014 });
  soupBeam(frame, [-X_END, MAR_NAT_TOP - 0.3, 0], [X_END, MAR_NAT_TOP - 0.3, 0], 0.09, 0.08, FRAME_DARK, { side: [0, 1, 0], ch: 0.012 });

  // --- two pairs of wrapped mallets, resting across the front row ---------------------------------
  const pairs = [
    { x: 0.55, z: 0.42, yaw: 0.12, gap: 0.14, head: 0xa42a2a, shaft: 0xcda66e },
    { x: -1.75, z: 0.62, yaw: -0.2, gap: 0.14, head: 0x24427e, shaft: 0xcda66e },
  ];
  const SHAFT = 1.2;
  for (const pair of pairs) {
    for (const s of [-1, 1]) {
      const dir = [Math.cos(pair.yaw), 0, Math.sin(pair.yaw)];
      const off = [-dir[2] * pair.gap * s, 0, dir[0] * pair.gap * s];
      const R = 0.062; const rS = 0.016;
      const head = [pair.x + off[0] + dir[0] * SHAFT * 0.5, MAR_NAT_TOP + R * 0.86, pair.z + off[2] + dir[2] * SHAFT * 0.5];
      const end = [pair.x + off[0] - dir[0] * SHAFT * 0.5, MAR_NAT_TOP + rS, pair.z + off[2] - dir[2] * SHAFT * 0.5];
      const axis = norm(sub(head, end));
      const shaft = latheUp([[0, 0], [rS * 0.8, 0], [rS, 0.012], [rS, SHAFT * 0.5], [rS * 0.9, SHAFT], [0, SHAFT + 0.01]], { segments: 8 });
      seat(shaft, end, axis);
      dull.push({ geometry: shaft, color: pair.shaft });
      // A round core wound with yarn: a slightly flattened ball, and the winding is the tile.
      const profile = [];
      for (let i = 0; i <= 14; i += 1) {
        const a = -Math.PI / 2 + (i / 14) * Math.PI;
        profile.push([Math.cos(a) * R, Math.sin(a) * R * 0.88]);
      }
      const ball = latheUp(profile, { segments: 20 });
      const uv = ball.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 1.4);
      seat(ball, head, axis);
      yarnParts.push({ geometry: ball, color: pair.head });
    }
  }

  // --- materials -----------------------------------------------------------------------------------
  const barTile = grainTile(19, { low: 120, base: 236, lines: 300 });
  const woodMesh = mesh(wood.geometry(), standard({ vertexColors: true, map: barTile, bumpMap: barTile, bumpScale: 0.25, roughness: 0.42, metalness: 0.02 }));
  const frameTile = grainTile(23, { low: 150, base: 225, lines: 180 });
  frameTile.repeat.set(1.4, 1.4);
  const frameMesh = mesh(frame.geometry(), standard({ vertexColors: true, map: frameTile, roughness: 0.46, metalness: 0.02 }));
  const metalMesh = mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.36, metalness: 0.42 }));
  const dullMesh = mesh(mergeParts(dull), standard({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  const yarnRng = seededRandom(77);
  const yarnTile = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1.8;
    for (let i = -h; i < h * 2; i += 7) {
      const v = 120 + yarnRng() * 90;
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i + 42); ctx.stroke();
    }
  });
  yarnTile.wrapS = THREE.RepeatWrapping;
  yarnTile.wrapT = THREE.RepeatWrapping;
  const yarnMesh = mesh(mergeParts(yarnParts), standard({ vertexColors: true, map: yarnTile, bumpMap: yarnTile, bumpScale: 0.3, roughness: 0.95, metalness: 0 }));
  return group(woodMesh, frameMesh, metalMesh, dullMesh, yarnMesh);
}

// ---------------------------------------------------------------------------
// The koto: thirteen strings, thirteen bridges
// ---------------------------------------------------------------------------

const KOTO_HALF = 3.2; // the body runs 6.4ft, the brief's size; a real one is nearer 6ft
const KOTO_R = KOTO_HALF - 0.35; // the head's fixed bridge, the ryukaku, on the +X end
const KOTO_K = -KOTO_HALF + 0.46; // the tail's fixed bridge, the kumokaku
const KOTO_STRING_R = 0.0058; // about 3.5mm across, twice a real string, so it holds at six feet
const KOTO_BRIDGE_H = 0.178;
const KOTO_END_H = 0.058;
const KOTO_TILT = (7 * Math.PI) / 180;
const KOTO_LIFT = 0.5;

const kotoW = (x) => mix(0.39, 0.41, (x + KOTO_HALF) / (2 * KOTO_HALF));
// The top: domed across, a little crowned along its length, falling away at both ends.
function kotoTop(x, z) {
  const w = kotoW(x);
  const u = clamp01(Math.abs(z) / w);
  const crown = 0.262 - 0.012 * (x / KOTO_HALF) ** 2 - 0.022 * sstep(Math.abs(x), KOTO_HALF - 0.5, KOTO_HALF);
  return 0.125 + (crown - 0.125) * (1 - u ** 2.4) ** 0.62;
}

// Hirajoshi on D, the koto's standard tuning. String 1 is furthest from the player, string 13 nearest,
// and string 1 is NOT the lowest: it is the D that string 5 doubles, which is why one bridge breaks the
// diagonal. All thirteen are taken to be one gauge at one tension, so a string's sounding length goes
// exactly as 1/f, from the head's fixed bridge to its own movable one. Nothing else sets a bridge.
export const KOTO_TUNING = [
  { n: 1, note: 'D4', m: 62 }, { n: 2, note: 'G3', m: 55 }, { n: 3, note: 'A3', m: 57 }, { n: 4, note: 'Bb3', m: 58 },
  { n: 5, note: 'D4', m: 62 }, { n: 6, note: 'Eb4', m: 63 }, { n: 7, note: 'G4', m: 67 }, { n: 8, note: 'A4', m: 69 },
  { n: 9, note: 'Bb4', m: 70 }, { n: 10, note: 'D5', m: 74 }, { n: 11, note: 'Eb5', m: 75 }, { n: 12, note: 'G5', m: 79 },
  { n: 13, note: 'A5', m: 81 },
];

export function kotoLayout() {
  const LOW = 3.92; // the G3's sounding length: about 73% of the distance between the fixed bridges
  const strings = KOTO_TUNING.map((s, i) => {
    const hz = midiHz(s.m);
    const length = LOW * (midiHz(55) / hz);
    const x = KOTO_R - length;
    const zHead = mix(-0.3, 0.3, i / 12);
    const zTail = mix(-0.33, 0.33, i / 12);
    const zAt = (px) => mix(zTail, zHead, (px - KOTO_K) / (KOTO_R - KOTO_K));
    const z = zAt(x);
    const notch = kotoTop(x, z) + KOTO_BRIDGE_H;
    const y = notch + KOTO_STRING_R;
    const yHead = kotoTop(KOTO_R, zHead) + KOTO_END_H + KOTO_STRING_R;
    const yTail = kotoTop(KOTO_K, zTail) + KOTO_END_H + KOTO_STRING_R;
    return { ...s, hz, length, x, z, zHead, zTail, zAt, notch, y, yHead, yTail };
  });
  return { strings, stringCount: strings.length, bridgeCount: strings.length, picks: 3 };
}

// Closed rings of one length, capped on their own duplicated rims so a cap never pillows the sides.
function loftClosed(rings, uvFn, { capStart = true, capEnd = true } = {}) {
  const n = rings[0].length;
  const positions = []; const uvs = []; const index = [];
  rings.forEach((ring, i) => ring.forEach((p, j) => {
    positions.push(p[0], p[1], p[2]);
    const w = uvFn(p, i, j); uvs.push(w[0], w[1]);
  }));
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const k = (j + 1) % n;
      index.push(i * n + j, i * n + k, (i + 1) * n + k, i * n + j, (i + 1) * n + k, (i + 1) * n + j);
    }
  }
  const cap = (ring, flip) => {
    const base = positions.length / 3;
    const c = [0, 0, 0];
    for (const p of ring) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
    positions.push(c[0], c[1], c[2]);
    const wc = uvFn(c, -1, -1); uvs.push(wc[0], wc[1]);
    for (const p of ring) { positions.push(p[0], p[1], p[2]); const w = uvFn(p, -1, -1); uvs.push(w[0], w[1]); }
    for (let j = 0; j < n; j += 1) {
      const k = (j + 1) % n;
      if (flip) index.push(base, base + 1 + j, base + 1 + k); else index.push(base, base + 1 + k, base + 1 + j);
    }
  };
  if (capStart) cap(rings[0], false);
  if (capEnd) cap(rings[rings.length - 1], true);
  let g = new THREE.BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g = outward(g);
  g.computeVertexNormals();
  return g;
}

// One cross-section of the body, and the same one lifted off its surface for a sleeve.
function kotoRing(x, lift = 0) {
  const w = kotoW(x);
  const ring = [];
  const N = 26;
  for (let i = 0; i <= N; i += 1) {
    const a = (i / N) * Math.PI;
    const z = -Math.cos(a) * w;
    ring.push([x, kotoTop(x, z) + lift, z * (1 + lift / w)]);
  }
  const lw = w + lift;
  ring.push([x, 0.07, lw * 0.985], [x, 0.018 - lift, lw * 0.95], [x, -lift, lw * 0.86], [x, -lift, -lw * 0.86], [x, 0.018 - lift, -lw * 0.95], [x, 0.07, -lw * 0.985]);
  return ring;
}

function kotoGrain() {
  const rng = seededRandom(1300);
  // Wider than the usual 1024: the grain is most of what this instrument has to show, over 6.4ft.
  const W = 2048; const H = 512;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#d7bd92';
    ctx.fillRect(0, 0, W, H);
    // Broad slow bands of tone, as a sawn board has.
    for (let i = 0; i < 26; i += 1) {
      const y = rng() * H; const h = 8 + rng() * 40;
      const light = rng() > 0.5;
      ctx.fillStyle = light ? `rgba(236,214,172,${0.15 + rng() * 0.25})` : `rgba(170,132,88,${0.1 + rng() * 0.2})`;
      ctx.fillRect(0, y, W, h);
    }
    // Flat-sawn cathedral figure: nested flames down the middle of the board, the look a fine koto
    // top is chosen for, and straight quarter-sawn lines out toward the edges.
    const flame = (cx, cy, count) => {
      for (let k = 0; k < count; k += 1) {
        const a = 60 + k * (40 + rng() * 9);
        const b = 4 + k * (6.5 + rng() * 1.6);
        ctx.strokeStyle = `rgba(122,84,48,${0.2 + rng() * 0.36})`;
        ctx.lineWidth = 0.7 + rng() * 1.5;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx - a * 0.25, cy);
          ctx.bezierCurveTo(cx + a * 0.1, cy + s * b * 1.1, cx + a * 0.7, cy + s * b * 1.02, cx + a * 1.5, cy + s * b * 1.25);
          ctx.lineTo(W + 30, cy + s * b * 1.35);
          ctx.stroke();
        }
      }
    };
    flame(70, H * 0.5, 9);
    flame(980, H * 0.46, 6);
    for (let y = 0; y < H; y += 2.6 + rng() * 5) {
      const fromCentre = Math.abs(y - H / 2) / (H / 2);
      ctx.strokeStyle = `rgba(118,80,44,${(0.1 + rng() * 0.3) * (0.45 + fromCentre * 0.7)})`;
      ctx.lineWidth = 0.6 + rng() * 1.3;
      ctx.beginPath();
      const ph = rng() * 6.28;
      for (let x = 0; x <= W; x += 40) {
        const py = y + Math.sin(x * 0.003 + ph) * 2.2;
        if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
    // Pores: short dashes along the grain.
    for (let i = 0; i < 9000; i += 1) {
      const v = 90 + rng() * 60;
      ctx.fillStyle = `rgba(${v},${v * 0.78},${v * 0.55},${0.12 + rng() * 0.3})`;
      ctx.fillRect(rng() * W, rng() * H, 3 + rng() * 14, 0.8);
    }
  });
}

// The decorated ends, gold scrollwork on black lacquer in the maki-e manner, with a shell flower at
// the centre of each. Representative: a real koto's ends are each maker's own.
function kotoDeco() {
  const rng = seededRandom(1301);
  const S = 512;
  return canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#1a1010';
    ctx.fillRect(0, 0, S, S);
    const vine = (y0, y1, phase) => {
      const mid = (y0 + y1) / 2; const amp = (y1 - y0) * 0.22;
      ctx.strokeStyle = '#d3a84a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 26; x <= S - 26; x += 4) {
        const y = mid + Math.sin(x * 0.03 + phase) * amp;
        if (x === 26) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let x = 44; x < S - 34; x += 38) {
        const y = mid + Math.sin(x * 0.03 + phase) * amp;
        const up = Math.cos(x * 0.03 + phase + Math.PI / 2) > 0 ? 1 : -1;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 6, y + up * 12, x + 22, y + up * 18, x + 20, y + up * 6);
        ctx.bezierCurveTo(x + 18, y + up * 1, x + 11, y + up * 3, x + 12, y + up * 8);
        ctx.stroke();
        ctx.fillStyle = '#e0bb5e';
        ctx.beginPath();
        ctx.ellipse(x - 5, y - up * 10, 9, 4, up * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const flower = (cx, cy, R) => {
      for (let k = 0; k < 16; k += 1) {
        const a = (k / 16) * Math.PI * 2;
        ctx.fillStyle = k % 2 ? '#efe7d4' : '#d6e2de';
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62, R * 0.42, R * 0.15, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#d3a84a';
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.26, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const [y0, y1, ph] of [[0, S / 2, 0.4], [S / 2, S, 2.1]]) {
      ctx.strokeStyle = '#c39a44';
      ctx.lineWidth = 5;
      ctx.strokeRect(10, y0 + 10, S - 20, y1 - y0 - 20);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(19, y0 + 19, S - 38, y1 - y0 - 38);
      vine(y0 + 26, y1 - 26, ph);
      flower(S / 2, (y0 + y1) / 2, 42);
      flower(S * 0.17, (y0 + y1) / 2 + 14, 21);
      flower(S * 0.83, (y0 + y1) / 2 - 14, 21);
    }
    for (let i = 0; i < 700; i += 1) {
      ctx.fillStyle = `rgba(226,190,106,${0.2 + rng() * 0.5})`;
      ctx.fillRect(rng() * S, rng() * S, 1.2, 1.2);
    }
  });
}

function koto() {
  const { strings } = kotoLayout();
  const T = new THREE.Matrix4().makeRotationX(KOTO_TILT).setPosition(0, KOTO_LIFT, 0);
  const tilted = (g) => g.applyMatrix4(T);
  const ivory = [];
  const line = [];
  const lacquer = [];
  const cloth = [];

  // --- the body: one lofted closed solid, a paulownia log with its grain on the outside -----------
  const rings = [];
  const STATIONS = 66;
  for (let i = 0; i <= STATIONS; i += 1) rings.push(kotoRing(mix(-KOTO_HALF + 0.03, KOTO_HALF - 0.03, i / STATIONS)));
  const body = loftClosed(rings, (p) => [(p[0] + KOTO_HALF) / (2 * KOTO_HALF), 0.5 + p[2] / 0.9]);
  tintVertices(body, (x, y, z, out) => {
    const w = kotoW(x);
    const u = Math.abs(z) / w;
    // The edges of a koto's top are toasted, and the underside is plain.
    const toast = sstep(u, 0.72, 1.0) * 0.26 + (y < 0.12 ? 0.3 : 0);
    const n = 0.95 + (smoothNoise3(x * 0.8, 3, z * 3) - 0.5) * 0.16;
    out[0] = n * (1 - toast * 0.85); out[1] = n * (1 - toast); out[2] = n * (1 - toast * 1.15);
  });
  tilted(body);

  // --- the decorated ends: lacquered sleeves over the log, a step proud of it -----------------------
  const sleeve = (xa, xb, vLow, vHigh) => {
    const list = [];
    const dir = xb > xa ? 1 : -1;
    const LIFT = 0.008;
    list.push(kotoRing(xa, -0.004), kotoRing(xa, LIFT), kotoRing(xa + dir * 0.006, LIFT + 0.002));
    const n = 8;
    for (let i = 1; i <= n; i += 1) list.push(kotoRing(mix(xa, xb - dir * 0.03, i / n), LIFT + 0.002));
    list.push(kotoRing(xb - dir * 0.012, LIFT - 0.006), kotoRing(xb, LIFT - 0.022));
    return loftClosed(list, (p) => [clamp01(0.5 + p[2] / 0.86), mix(vLow, vHigh, clamp01((p[0] - Math.min(xa, xb)) / Math.abs(xb - xa)))]);
  };
  const head = tilted(sleeve(KOTO_HALF - 0.26, KOTO_HALF, 0.5, 1));
  const tail = tilted(sleeve(-KOTO_HALF + 0.36, -KOTO_HALF, 0, 0.5));

  // --- the two fixed bridges, bars of ivory colour that follow the dome across -----------------------
  const fixedBridge = (x, hz) => {
    const list = [];
    const NZ = 26;
    for (let i = 0; i <= NZ; i += 1) {
      const z = mix(-hz, hz, i / NZ);
      const yS = kotoTop(x, z);
      const top = yS + KOTO_END_H;
      const taper = 1 - 0.12 * sstep(Math.abs(z), hz - 0.03, hz);
      const hw = 0.048 * taper;
      list.push([
        [x - hw, yS - 0.012, z], [x + hw, yS - 0.012, z], [x + hw, yS + 0.018, z], [x + hw * 0.7, top - 0.012, z],
        [x + hw * 0.3, top - 0.0015, z], [x, top, z], [x - hw * 0.3, top - 0.0015, z], [x - hw * 0.7, top - 0.012, z], [x - hw, yS + 0.018, z],
      ]);
    }
    return list;
  };
  for (const [x, hz] of [[KOTO_R, 0.355], [KOTO_K, 0.375]]) {
    const g = loftClosed(fixedBridge(x, hz), () => [0, 0]);
    ivory.push({ geometry: tilted(g), color: 0xddd4bd });
  }

  // --- thirteen bridges, one to a string, each standing on the dome where its note puts it ----------
  const HOLE = 0x060505;
  for (const s of strings) {
    const footOuter = 0.086; const footInner = 0.055;
    const yL = kotoTop(s.x, s.z - 0.072) - s.notch - 0.012;
    const yR = kotoTop(s.x, s.z + 0.072) - s.notch - 0.012;
    // Written relative to the notch, as the player would set it. Feet reach down to the dome wherever it
    // lies, so a bridge near the edge has one leg longer than the other, as a real one effectively does.
    const shape = new THREE.Shape();
    shape.moveTo(-footOuter, yL);
    shape.lineTo(-footInner, yL);
    shape.quadraticCurveTo(-0.03, -0.112, 0, -0.1);
    shape.quadraticCurveTo(0.03, -0.112, footInner, yR);
    shape.lineTo(footOuter, yR);
    shape.quadraticCurveTo(0.052, -0.09, 0.024, -0.036);
    shape.lineTo(0.021, 0.008);
    shape.lineTo(0.0085, 0.008);
    shape.lineTo(0, 0);
    shape.lineTo(-0.0085, 0.008);
    shape.lineTo(-0.021, 0.008);
    shape.lineTo(-0.024, -0.036);
    shape.quadraticCurveTo(-0.052, -0.09, -footOuter, yL);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.036, steps: 1, curveSegments: 5, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.0025, bevelSegments: 1 });
    g.deleteAttribute('uv');
    g.translate(0, 0, -0.018);
    g.rotateY(-Math.PI / 2);
    // Local notch to the string's own place on the body.
    g.translate(s.x, s.notch, s.z);
    ivory.push({ geometry: tilted(g), color: 0xece6d6 });

    // --- and its string: tied through the head, over the ryukaku, down into this notch, over the
    // kumokaku, and through the tail. Straight runs under tension, so three segments and no curve.
    const headHole = KOTO_R + 0.16;
    const tailHole = KOTO_K - 0.19;
    const zH = s.zHead; const zT = s.zTail;
    const dive = 0.008;
    const pts = [
      [headHole, kotoTop(headHole, zH) - dive, zH],
      [KOTO_R, s.yHead, zH],
      [s.x, s.y, s.z],
      [KOTO_K, s.yTail, zT],
      [tailHole, kotoTop(tailHole, zT) - dive, zT],
    ];
    for (let i = 0; i < pts.length - 1; i += 1) {
      line.push({ geometry: tilted(bar(pts[i], pts[i + 1], KOTO_STRING_R, KOTO_STRING_R, 6)), color: 0xf0e2b0 });
      // A round at each knuckle, or the strings show a break on the bridges.
      if (i > 0) {
        const ball = new THREE.SphereGeometry(KOTO_STRING_R, 6, 4).translate(pts[i][0], pts[i][1], pts[i][2]);
        line.push({ geometry: tilted(ball), color: 0xf0e2b0 });
      }
    }
    // The dark holes the strings go down, set in the lacquer.
    for (const [hx, hz2] of [[headHole, zH], [tailHole, zT]]) {
      const disc = new THREE.CylinderGeometry(0.017, 0.017, 0.004, 10).translate(hx, kotoTop(hx, hz2) + 0.0105, hz2);
      lacquer.push({ geometry: tilted(disc), color: HOLE });
    }
  }

  // --- two low stands, their tops cut to the angle the instrument lies at ---------------------------
  const BLACK = lin(0x1a1311);
  const GOLD = lin(0xb08a3e);
  const stand = new Soup();
  const yAt = (z) => KOTO_LIFT - z * Math.tan(KOTO_TILT);
  for (const sx of [-1.95, 1.95]) {
    const hx = 0.26; const hz = 0.5;
    const y0 = 0.06; // plate thickness
    const plateB = (x, z) => [x, yAt(z) - y0, z];
    const plateT = (x, z) => [x, yAt(z) + 0.004, z];
    stand.hexa(
      [plateB(sx - hx, -hz), plateB(sx + hx, -hz), plateB(sx + hx, hz), plateB(sx - hx, hz)],
      [plateT(sx - hx, -hz), plateT(sx + hx, -hz), plateT(sx + hx, hz), plateT(sx - hx, hz)],
      BLACK,
      { topCol: times(BLACK, 1.5) },
    );
    // A thin gilt line round the plate's edge.
    stand.hexa(
      [plateB(sx - hx - 0.006, -hz - 0.006), plateB(sx + hx + 0.006, -hz - 0.006), plateB(sx + hx + 0.006, hz + 0.006), plateB(sx - hx - 0.006, hz + 0.006)],
      [[sx - hx - 0.006, yAt(-hz) - y0 + 0.016, -hz - 0.006], [sx + hx + 0.006, yAt(-hz) - y0 + 0.016, -hz - 0.006], [sx + hx + 0.006, yAt(hz) - y0 + 0.016, hz + 0.006], [sx - hx - 0.006, yAt(hz) - y0 + 0.016, hz + 0.006]],
      GOLD,
    );
    for (const lz of [-0.36, 0.36]) {
      const top = yAt(lz) - y0 + 0.01;
      lacquer.push({
        geometry: polishGeometry(latheUp([[0, 0], [0.085, 0], [0.09, 0.02], [0.07, 0.05], [0.045, 0.1], [0.04, top * 0.5], [0.05, top - 0.06], [0.085, top - 0.015], [0.09, top], [0, top]], { segments: 18 }).translate(sx, 0, lz), BLACK, { gain: 1.1, pale: 0.04 }),
        keepColor: true,
      });
    }
    // A runner along the floor tying the two legs.
    stand.box(sx - 0.05, 0, -0.42, sx + 0.05, 0.05, 0.42, times(BLACK, 1.2));
  }

  // --- the three picks, on a small lacquered table by the head, where a player sits ------------------
  const TX = 1.55; const TZ = 1.05; const TH = 0.5;
  stand.box(TX - 0.42, TH - 0.035, TZ - 0.27, TX + 0.42, TH, TZ + 0.27, BLACK, { topCol: times(BLACK, 1.6) });
  for (const [dx, dz] of [[-0.36, -0.21], [0.36, -0.21], [-0.36, 0.21], [0.36, 0.21]]) {
    lacquer.push({ geometry: polishGeometry(latheUp([[0, 0], [0.03, 0], [0.024, 0.04], [0.022, TH - 0.06], [0.04, TH - 0.03], [0, TH - 0.03]], { segments: 10 }).translate(TX + dx, 0, TZ + dz), BLACK, { pale: 0.04 }), keepColor: true });
  }
  const PAD = 0.012;
  cloth.push({ geometry: new THREE.BoxGeometry(0.62, PAD, 0.36).translate(TX, TH + PAD / 2, TZ), color: 0x8c1f22 });
  cloth.push({ geometry: new THREE.BoxGeometry(0.66, PAD * 0.6, 0.4).translate(TX, TH + PAD * 0.3, TZ), color: 0xb08a3e });
  const padTop = TH + PAD;
  const pick = (px, pz, yaw) => {
    // A leather band a fingertip goes through, and the ivory blade set into its front.
    const R = 0.042; const WIDE = 0.05; const WALL = 0.006;
    const band = latheUp([[R, 0], [R, WIDE], [R - WALL, WIDE], [R - WALL, 0], [R, 0]], { segments: 18 });
    band.rotateX(Math.PI / 2); // +Y to +Z
    const dir = [Math.sin(yaw), 0, Math.cos(yaw)];
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(px, padTop + R, pz);
    band.applyMatrix4(m);
    cloth.push({ geometry: band, color: 0xa8743c });
    const start = [px + dir[0] * 0.006, padTop + 0.012, pz + dir[2] * 0.006];
    const end = [px + dir[0] * 0.15, padTop + 0.011, pz + dir[2] * 0.15];
    const blade = tube([start, [mix(start[0], end[0], 0.55), padTop + 0.013, mix(start[2], end[2], 0.55)], end], [0.021, 0.024, 0.009], {
      sides: 12, steps: 10, round: 2, frame: () => [0, 1, 0], section: () => [0.26, 1],
    });
    ivory.push({ geometry: blade, color: 0xeee6d0 });
  };
  pick(TX - 0.2, TZ - 0.06, 0.25);
  pick(TX, TZ - 0.09, -0.1);
  pick(TX + 0.2, TZ - 0.06, -0.35);

  // --- materials -----------------------------------------------------------------------------------
  const grain = kotoGrain();
  grain.wrapS = THREE.RepeatWrapping;
  const bodyMesh = mesh(body, standard({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: 0.3, roughness: 0.62, metalness: 0 }));
  const decoMesh = mesh(mergeParts([{ geometry: head, color: 0xffffff }, { geometry: tail, color: 0xffffff }]), standard({ map: kotoDeco(), vertexColors: true, roughness: 0.32, metalness: 0.12 }));
  const ivoryMesh = mesh(mergeParts(ivory), standard({ vertexColors: true, roughness: 0.42, metalness: 0 }));
  const lineMesh = mesh(mergeParts(line), standard({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  lineMesh.castShadow = true;
  const lacquerMesh = mesh(mergeParts([{ geometry: stand.geometry(), keepColor: true }, ...lacquer, ...cloth]), standard({ vertexColors: true, roughness: 0.38, metalness: 0.02 }));
  return group(bodyMesh, decoMesh, ivoryMesh, lineMesh, lacquerMesh);
}

// ---------------------------------------------------------------------------
// The alto saxophone, about 3 times life
// ---------------------------------------------------------------------------

// Everything here is in the real instrument's INCHES on a path in the XY plane, with the neck toward
// -X and the bell toward +X, and goes into feet by one uniform scale at the end. So +Z sees the J
// side on, which is the player's right, and the stack and the bell's mouth turn to face anyone who
// walks round toward +X.
const SAX_K = 0.235; // feet per inch: 2.82 times life, which makes 6.2ft with the stand
const SAX_BELL_LEAN = (14 * Math.PI) / 180;

// One cone from end to end, a half-angle of 1.53 degrees, and the flare added on top of it only in the
// last stretch of the bell. It is one function of one number, so the tube cannot step: `saxBoreReport`
// samples it anyway.
const SAX_R0 = 0.28;
const SAX_TAPER = 0.0267;
const SAX_RIM = 2.42;

function saxPath() {
  const T = [-2.35, 20.0, 0];
  const B = [-1.95, 3.0, 0];
  const d0 = norm(sub(B, T));
  const pts = [];
  // The neck, built outward from the top of the body and then reversed.
  const neck = [];
  const up = scl(d0, -1);
  for (let i = 0; i <= 3; i += 1) neck.push(add(T, scl(up, (i / 3) * 1.4)));
  const n0 = neck[neck.length - 1];
  const Rn = 2.2;
  const leftUp = [-up[1], up[0], 0]; // turning toward -X
  const cn = add(n0, scl(leftUp, Rn));
  const sweepN = (78 * Math.PI) / 180;
  const ang0 = Math.atan2(n0[1] - cn[1], n0[0] - cn[0]);
  for (let i = 1; i <= 14; i += 1) {
    const a = ang0 + (i / 14) * sweepN;
    neck.push([cn[0] + Math.cos(a) * Rn, cn[1] + Math.sin(a) * Rn, 0]);
  }
  const nEnd = neck[neck.length - 1];
  const dirN = norm(sub(nEnd, neck[neck.length - 2]));
  for (let i = 1; i <= 4; i += 1) neck.push(add(nEnd, scl(dirN, (i / 4) * 3.0)));
  pts.push(...[...neck].reverse());
  const bodyStart = pts.length - 1;
  // The body: straight, which is the whole length of the stack.
  for (let i = 1; i <= 16; i += 1) pts.push(add(T, scl(d0, (i / 16) * Math.hypot(B[0] - T[0], B[1] - T[1]))));
  const bowStart = pts.length - 1;
  // The bow, then the bell, leaning a little out of the plane about the body's own line, which leaves
  // the body straight and the join tangent.
  const R = 2.05;
  const left = [-d0[1], d0[0], 0]; // turning from down toward +X and up
  const c = add(B, scl(left, R));
  const a0 = Math.atan2(B[1] - c[1], B[0] - c[0]);
  const dirEnd = [Math.sin((14 * Math.PI) / 180), Math.cos((14 * Math.PI) / 180), 0];
  const a1Total = Math.atan2(dirEnd[1], dirEnd[0]) - Math.atan2(d0[1], d0[0]);
  const sweep = a1Total < 0 ? a1Total + Math.PI * 2 : a1Total;
  const J = [];
  for (let i = 1; i <= 30; i += 1) {
    const a = a0 + (i / 30) * sweep;
    J.push([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, 0]);
  }
  const bowEndIndex = pts.length + J.length - 1;
  const jEnd = J[J.length - 1];
  const BELL = 11.5;
  for (let i = 1; i <= 46; i += 1) J.push(add(jEnd, scl(dirEnd, (1 - (1 - i / 46) ** 1.5) * BELL)));
  const axis = new THREE.Vector3(d0[0], d0[1], d0[2]);
  for (const q of J) {
    const v = new THREE.Vector3(q[0] - T[0], q[1] - T[1], q[2] - T[2]).applyAxisAngle(axis, SAX_BELL_LEAN);
    pts.push([v.x + T[0], v.y + T[1], v.z + T[2]]);
  }
  // Arc length, tangents and parallel-transported frames.
  const S = [0];
  for (let i = 1; i < pts.length; i += 1) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const tan = pts.map((q, i) => norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)])));
  const frames = [];
  let N = norm(sub([0, 1, 0], scl(tan[0], dot([0, 1, 0], tan[0]))));
  for (let i = 0; i < pts.length; i += 1) {
    N = norm(sub(N, scl(tan[i], dot(N, tan[i]))));
    frames.push({ N, B: cross(tan[i], N) });
  }
  return { pts, S, tan, frames, length: S[S.length - 1], sBody: S[bodyStart], sBow: S[bowStart], sBell: S[bowEndIndex] };
}

function saxRadiusFn(path) {
  const L = path.length;
  const s0 = path.sBell + 1.6; // the flare starts a little way up the bell
  const end = SAX_R0 + SAX_TAPER * L;
  return (s) => {
    const t = clamp01((s - s0) / (L - s0));
    return SAX_R0 + SAX_TAPER * s + (SAX_RIM - end) * t ** 3.4;
  };
}

// Samples the bore from neck to rim. Every step must widen, and the widening itself must not jump,
// which is what a step looks like in numbers.
export function saxBoreReport(samples = 2000) {
  const path = saxPath();
  const r = saxRadiusFn(path);
  let minStep = Infinity; let maxJump = 0; let prev = null;
  for (let i = 1; i <= samples; i += 1) {
    const a = ((i - 1) / samples) * path.length; const b = (i / samples) * path.length;
    const slope = (r(b) - r(a)) / (b - a);
    if (slope < minStep) minStep = slope;
    if (prev !== null) maxJump = Math.max(maxJump, Math.abs(slope - prev));
    prev = slope;
  }
  return {
    lengthInches: path.length, neckEndDiameter: r(0) * 2, bodyTopDiameter: r(path.sBody) * 2, bowStartDiameter: r(path.sBow) * 2, bellStartDiameter: r(path.sBell) * 2, rimDiameter: r(path.length) * 2,
    minSlope: minStep, maxSlopeJump: maxJump, halfAngleDegrees: (Math.atan(SAX_TAPER) * 180) / Math.PI,
  };
}

// Floral bell engraving, the near-white map the lacquer's own colour is multiplied by, drawn as
// hand-cut lines. Representative: every maker has their own pattern.
function saxEngraving() {
  const rng = seededRandom(1846);
  const W = 1024; const H = 512;
  const t = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const ink = (a) => `rgba(74,40,10,${a})`;
    const petal = (cx, cy, a, len, wide) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.bezierCurveTo(cx + Math.cos(a - 0.5) * len * 0.5, cy + Math.sin(a - 0.5) * len * 0.5 - wide * 0.1, cx + Math.cos(a - 0.3) * len, cy + Math.sin(a - 0.3) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.bezierCurveTo(cx + Math.cos(a + 0.3) * len, cy + Math.sin(a + 0.3) * len, cx + Math.cos(a + 0.5) * len * 0.5, cy + Math.sin(a + 0.5) * len * 0.5, cx, cy);
      ctx.stroke();
      // The shading cuts, which are what make an engraved flower look cut rather than outlined.
      for (let k = 1; k <= 3; k += 1) {
        const off = (k - 2) * 0.17;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a + off) * len * 0.22, cy + Math.sin(a + off) * len * 0.22);
        ctx.lineTo(cx + Math.cos(a + off) * len * 0.72, cy + Math.sin(a + off) * len * 0.72);
        ctx.stroke();
      }
    };
    const flower = (cx, cy, R, n = 6) => {
      ctx.strokeStyle = ink(0.92);
      ctx.lineWidth = 2.4;
      for (let k = 0; k < n; k += 1) petal(cx, cy, (k / n) * Math.PI * 2 + 0.3, R, R * 0.6);
      ctx.fillStyle = ink(0.86);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.07, 0, Math.PI * 2); ctx.fill();
    };
    const leaf = (x, y, a, len) => {
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a - 0.5) * len * 0.6, y + Math.sin(a - 0.5) * len * 0.6, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.quadraticCurveTo(x + Math.cos(a + 0.5) * len * 0.6, y + Math.sin(a + 0.5) * len * 0.6, x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len * 0.8, y + Math.sin(a) * len * 0.8);
      ctx.stroke();
    };
    const scroll = (x, y, a0, R, turns, dirn) => {
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      let px = x; let py = y;
      ctx.moveTo(px, py);
      const N = 36;
      for (let i = 1; i <= N; i += 1) {
        const f = i / N;
        const a = a0 + dirn * f * turns * Math.PI * 2;
        const step = (R * (1 - f * 0.86) * turns * Math.PI * 2) / N;
        px += Math.cos(a) * step; py += Math.sin(a) * step;
        ctx.lineTo(px, py);
        if (i % 9 === 4 && f < 0.8) { const s2 = ctx.lineWidth; ctx.stroke(); leaf(px, py, a + dirn * 1.2, 26 * (1 - f * 0.5)); ctx.lineWidth = s2; ctx.beginPath(); ctx.moveTo(px, py); }
      }
      ctx.stroke();
    };
    // The composition sits on the side the card picture and a walking student see.
    const CX = W * 0.36; const CY = H * 0.5;
    ctx.strokeStyle = ink(0.9);
    flower(CX, CY - 8, 62, 7);
    flower(CX + 182, CY - 92, 40);
    flower(CX - 176, CY + 88, 40);
    flower(CX + 150, CY + 112, 30, 5);
    flower(CX - 148, CY - 118, 30, 5);
    ctx.strokeStyle = ink(0.9);
    scroll(CX + 60, CY + 6, -0.5, 66, 0.9, 1);
    scroll(CX - 60, CY - 20, 2.6, 66, 0.9, 1);
    scroll(CX + 30, CY - 66, -1.2, 50, 0.85, -1);
    scroll(CX - 30, CY + 56, 1.9, 50, 0.85, -1);
    scroll(CX + 222, CY - 50, 0.4, 42, 0.9, 1);
    scroll(CX - 216, CY + 46, 3.4, 42, 0.9, 1);
    for (let i = 0; i < 26; i += 1) leaf(CX + (rng() - 0.5) * 520, CY + (rng() - 0.5) * 340, rng() * 6.28, 14 + rng() * 18);
    // A plain cut border along the rim end.
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(W, 12); ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(W, 22); ctx.stroke();
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// The list of padded cups. `at` is inches below the top of the body, or inches up the bell from where
// it leaves the bow; `phi` is degrees round the tube from the bell side toward +Z, the player's right.
// Names and order follow a modern alto; placement round the tube is representative rather than a
// survey of one maker's instrument.
export const SAX_CUPS = [
  { name: 'front F', on: 'body', at: 1.3, phi: 8, R: 0.3 },
  { name: 'palm D', on: 'body', at: 1.5, phi: -62, R: 0.33 },
  { name: 'palm Eb', on: 'body', at: 2.35, phi: -72, R: 0.34 },
  { name: 'palm F', on: 'body', at: 3.25, phi: -60, R: 0.35 },
  { name: 'high C', on: 'body', at: 2.5, phi: 22, R: 0.32 },
  { name: 'bis Bb', on: 'body', at: 3.3, phi: 22, R: 0.32 },
  { name: 'B', on: 'body', at: 4.3, phi: 22, R: 0.43, pearl: true },
  { name: 'A', on: 'body', at: 5.5, phi: 22, R: 0.5, pearl: true },
  { name: 'G', on: 'body', at: 6.8, phi: 22, R: 0.56, pearl: true },
  { name: 'G sharp', on: 'body', at: 8.0, phi: -46, R: 0.6 },
  { name: 'F', on: 'body', at: 8.7, phi: 22, R: 0.68, pearl: true },
  { name: 'E', on: 'body', at: 10.3, phi: 22, R: 0.74, pearl: true },
  { name: 'D', on: 'body', at: 11.95, phi: 22, R: 0.8, pearl: true },
  { name: 'F sharp', on: 'body', at: 7.3, phi: 86, R: 0.56 },
  { name: 'side E', on: 'body', at: 5.2, phi: 108, R: 0.38 },
  { name: 'side C', on: 'body', at: 9.25, phi: 100, R: 0.46 },
  { name: 'side Bb', on: 'body', at: 10.85, phi: 96, R: 0.5 },
  { name: 'low Eb', on: 'body', at: 13.75, phi: 40, R: 0.98 },
  { name: 'low C', on: 'body', at: 15.55, phi: 84, R: 1.12 },
  { name: 'low C sharp', on: 'bell', at: 1.5, phi: -72, R: 1.05 },
  { name: 'low B', on: 'bell', at: 4.6, phi: -76, R: 1.14 },
  { name: 'low Bb', on: 'bell', at: 7.7, phi: -80, R: 1.2 },
];

function saxophone() {
  const path = saxPath();
  const rOf = saxRadiusFn(path);
  const L = path.length;
  const interp = (s) => {
    const S = path.S;
    let i = 0;
    if (s >= L) i = S.length - 2;
    else if (s > 0) { let lo = 0; let hi = S.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; } i = lo; }
    const f = (s - S[i]) / (S[i + 1] - S[i] || 1);
    const c = mix3(path.pts[i], path.pts[i + 1], f);
    const t = norm(mix3(path.tan[i], path.tan[i + 1], clamp01(f)));
    const N0 = mix3(path.frames[i].N, path.frames[i + 1].N, clamp01(f));
    const N = norm(sub(N0, scl(t, dot(N0, t))));
    return { c, t, N, B: cross(t, N) };
  };
  const radial = (f, phi) => {
    const a = (phi * Math.PI) / 180;
    return add(scl(f.N, Math.cos(a)), scl(f.B, Math.sin(a)));
  };
  const slope = (s) => (rOf(s + 0.02) - rOf(s - 0.02)) / 0.04;
  const surf = (s, phi, lift = 0) => {
    const f = interp(s);
    const u = radial(f, phi);
    const r = rOf(s);
    return { p: add(f.c, scl(u, r + lift)), n: norm(sub(u, scl(f.t, slope(s)))), u, r, t: f.t };
  };
  const sOf = (cup) => (cup.on === 'body' ? path.sBody + cup.at : path.sBell + cup.at);

  const BRASS = lin(0xe2ad3e);
  const BRASS_HI = lin(0xefc05a);
  const brass = [];
  const soft = [];
  const black = [];
  // Only the horn itself carries UVs into the engraving; every other part reads one white texel.
  const shine = (g, c = BRASS, opts = {}) => {
    const uv = new Float32Array(g.attributes.position.count * 2).fill(0.002);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    brass.push({ geometry: polishGeometry(g, c, { pale: 0.5, ...opts }), keepColor: true });
  };

  // --- the horn: one surface from the neck's tip to the rolled rim, and back down inside the bell ----
  const SIDES = 36;
  const rows = [];
  const ringRow = (s, r, off = 0, inner = false) => rows.push({ s, r, off, inner });
  ringRow(0, SAX_R0);
  for (const s of path.S) if (s > 0) ringRow(s, rOf(s));
  const BEAD = 0.075;
  ringRow(L, SAX_RIM + BEAD * 0.75, 0.018);
  ringRow(L, SAX_RIM + BEAD, 0.05);
  ringRow(L, SAX_RIM + BEAD * 0.55, 0.095);
  ringRow(L, SAX_RIM - 0.01, 0.1);
  ringRow(L, SAX_RIM - 0.055, 0.06, true);
  const WALL = 0.055;
  for (let i = path.S.length - 2; i >= 0; i -= 1) {
    if (path.S[i] < L - 11) break;
    ringRow(path.S[i], rOf(path.S[i]) - WALL, 0, true);
  }
  const last = rows[rows.length - 1];
  ringRow(last.s, 0.001, 0, true);
  const SE = L - 8.2; // the engraved part of the bell starts here
  const positions = []; const uvs = []; const insideFlags = [];
  for (const row of rows) {
    const f = interp(row.s);
    const c = add(f.c, scl(f.t, row.off));
    for (let j = 0; j <= SIDES; j += 1) {
      const phi = (j / SIDES) * 360;
      const u = radial(f, phi);
      positions.push(c[0] + u[0] * row.r, c[1] + u[1] * row.r, c[2] + u[2] * row.r);
      const eng = !row.inner && row.s >= SE && row.off === 0;
      uvs.push(j / SIDES, eng ? 0.01 + 0.98 * ((row.s - SE) / (L - SE)) : 0.002);
      insideFlags.push(row.inner ? 1 : 0);
    }
  }
  const index = [];
  const R1 = SIDES + 1;
  for (let i = 0; i < rows.length - 1; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      const a = i * R1 + j; const b = a + 1; const d = (i + 1) * R1 + j; const c = d + 1;
      index.push(a, c, b, a, d, c);
    }
  }
  // Close the neck's tip, inside the mouthpiece.
  const tipCentre = positions.length / 3;
  positions.push(...path.pts[0]); uvs.push(0, 0.002); insideFlags.push(0);
  for (let j = 0; j < SIDES; j += 1) index.push(tipCentre, j + 1, j);
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
    // Dark down the throat of the bell, so that it is a hollow mouth and not a dish.
    const rim = interp(L).c; const rimT = interp(L).t;
    for (let i = 0; i < pos.count; i += 1) {
      if (!insideFlags[i]) continue;
      const depth = -dot(sub([pos.getX(i), pos.getY(i), pos.getZ(i)], rim), rimT);
      const k = 0.012 + 0.36 * (1 - sstep(depth, 0.05, 3.2)) ** 2;
      col.setXYZ(i, BRASS[0] * k, BRASS[1] * k, BRASS[2] * k);
    }
  }
  const hornPart = { geometry: horn, keepColor: true };

  // --- the rings where the bow joins, and the neck's socket ------------------------------------------
  const collar = (s, wide, proud, c = BRASS_HI) => {
    const f = interp(s);
    const r = rOf(s);
    const g = latheUp([[0, -wide], [r + proud * 0.5, -wide], [r + proud, -wide * 0.8], [r + proud, wide * 0.8], [r + proud * 0.5, wide], [0, wide]], { segments: 36 });
    seat(g, f.c, f.t);
    shine(g, c);
  };
  collar(path.sBow, 0.1, 0.035);
  collar(path.sBell, 0.1, 0.035);
  collar(path.sBody - 0.05, 0.3, 0.055);
  collar(path.sBody + 0.28, 0.06, 0.09);

  // --- tone holes, pads and cups ---------------------------------------------------------------------
  const PAD_COL = 0xc9a26a;
  const cupTops = {};
  for (const cup of SAX_CUPS) {
    const s = sOf(cup);
    const { p, n, r } = surf(s, cup.phi);
    const Rc = cup.R * 0.86;
    const sag = Rc < r ? r - Math.sqrt(r * r - Rc * Rc) : r;
    // Height is measured at the crown of the tube; at the cup's sides the chimney shows `sag` more.
    const h = 0.06 + cup.R * 0.12 + sag * 0.3;
    const chimney = latheUp([[0, -sag - 0.1], [Rc, -sag - 0.1], [Rc, h - 0.012], [Rc * 0.96, h], [0, h]], { segments: cup.R > 0.6 ? 26 : 18 });
    seat(chimney, p, n);
    shine(chimney, BRASS);
    const pad = latheUp([[0, h - 0.004], [cup.R * 0.95, h - 0.004], [cup.R * 0.96, h + 0.05], [0, h + 0.05]], { segments: cup.R > 0.6 ? 26 : 16 });
    seat(pad, p, n);
    soft.push({ geometry: pad, color: PAD_COL });
    const y0 = h + 0.04;
    const cupG = latheUp([
      [0, y0], [cup.R * 0.95, y0], [cup.R, y0 + 0.012], [cup.R, y0 + 0.06 + cup.R * 0.05], [cup.R * 0.96, y0 + 0.085 + cup.R * 0.06], [cup.R * 0.8, y0 + 0.1 + cup.R * 0.075],
      [cup.R * 0.42, y0 + 0.11 + cup.R * 0.09], [cup.R * 0.24, y0 + 0.115 + cup.R * 0.095], [cup.R * 0.2, y0 + 0.14 + cup.R * 0.1], [0, y0 + 0.15 + cup.R * 0.1],
    ], { segments: cup.R > 0.6 ? 30 : 20 });
    seat(cupG, p, n);
    shine(cupG, BRASS_HI);
    cupTops[cup.name] = { top: add(p, scl(n, y0 + 0.13 + cup.R * 0.1)), n, p };
  }

  // --- rods on their posts --------------------------------------------------------------------------
  const post = (s, phi, h, r0 = 0.085) => {
    const { p, n } = surf(s, phi);
    const g = latheUp([[0, -0.08], [r0 * 1.9, -0.08], [r0 * 1.9, 0.015], [r0 * 1.1, 0.05], [r0 * 0.75, 0.1], [r0 * 0.75, h - 0.1], [r0 * 1.15, h - 0.05], [r0 * 1.2, h], [r0 * 1.15, h + 0.05], [r0 * 0.6, h + 0.09], [0, h + 0.1]], { segments: 10 });
    seat(g, p, n);
    shine(g, BRASS_HI);
  };
  const rodAt = (s, phi, h) => surf(s, phi, h).p;
  const rod = (s0, s1, phi, h, { r = 0.058, postsAt = null } = {}) => {
    const pts = [];
    const n = Math.max(2, Math.round(Math.abs(s1 - s0) / 1.5));
    for (let i = 0; i <= n; i += 1) pts.push(rodAt(mix(s0, s1, i / n), phi, h));
    const g = tube(pts, r, { sides: 7, steps: n * 2, round: 1 });
    shine(g, BRASS);
    for (const ps of postsAt ?? [s0, s1]) post(ps, phi, h);
  };
  const arm = (a, b, r = 0.05) => {
    const g = tube([a, b], r, { sides: 7, steps: 1, round: 1, straight: true });
    shine(g, BRASS);
  };
  const pearlTouch = (p, n, R = 0.27) => {
    const holder = latheUp([[0, -0.06], [R * 0.5, -0.06], [R * 1.12, 0.03], [R * 1.14, 0.08], [R * 1.02, 0.09], [0, 0.09]], { segments: 18 });
    seat(holder, p, n);
    shine(holder, BRASS_HI);
    const pearl = latheUp([[0, 0.06], [R, 0.06], [R * 0.98, 0.09], [R * 0.72, 0.135], [R * 0.3, 0.152], [0, 0.155]], { segments: 18 });
    seat(pearl, p, n);
    tintVertices(pearl, (x, y, z, out) => {
      const w = 0.5 + 0.5 * Math.sin(x * 22 + y * 17 + z * 13);
      out[0] = 0.86 + w * 0.08; out[1] = 0.83 + (1 - w) * 0.08; out[2] = 0.8 + w * 0.06;
    });
    soft.push({ geometry: pearl, keepColor: true });
  };

  const b = path.sBody;
  const STACK_ROD = 68;
  // Upper stack, left hand.
  rod(b + 2.0, b + 7.45, STACK_ROD, 0.42, { postsAt: [b + 2.0, b + 7.45] });
  // Lower stack, right hand.
  rod(b + 8.0, b + 12.65, STACK_ROD, 0.46, { postsAt: [b + 8.0, b + 12.65] });
  for (const name of ['high C', 'bis Bb', 'B', 'A', 'G', 'F', 'E', 'D']) {
    const cup = SAX_CUPS.find((c) => c.name === name);
    const s = sOf(cup);
    const h = s < b + 7.6 ? 0.42 : 0.46;
    const from = rodAt(s, STACK_ROD, h);
    const c = cupTops[name];
    arm(from, c.top, 0.052);
    if (cup.pearl) {
      // The finger's touch stands on its key's arm, beside the cup, the way the fingers fall.
      const touch = rodAt(s, STACK_ROD - 10, 0.82);
      arm(mix3(from, c.top, 0.3), touch, 0.04);
      pearlTouch(touch, surf(s, STACK_ROD - 10).n);
    }
  }
  // The side keys, with their rod further round and three flat paddles for the side of the hand.
  rod(b + 4.6, b + 11.5, 138, 0.3, { postsAt: [b + 4.6, b + 8, b + 11.5] });
  for (const name of ['side E', 'side C', 'side Bb']) {
    const cup = SAX_CUPS.find((c) => c.name === name);
    const s = sOf(cup);
    arm(rodAt(s, 138, 0.3), cupTops[name].top, 0.045);
  }
  [[6.9, 7.4], [8.1, 8.6], [9.3, 9.8]].forEach(([s0, s1]) => {
    const a = rodAt(b + s0, 158, 0.4); const c = rodAt(b + s1, 158, 0.42);
    const g = tube([a, c], 0.1, { sides: 10, steps: 2, round: 2, frame: () => surf(b + s0, 158).n, section: () => [0.34, 1] });
    shine(g, BRASS_HI);
    arm(rodAt(b + s0 + 0.2, 138, 0.3), mix3(a, c, 0.4), 0.038);
  });
  // F sharp and the low keys on the right of the body, with a table of two rollers for the little finger.
  rod(b + 6.9, b + 16.4, 118, 0.42, { postsAt: [b + 6.9, b + 12.6, b + 16.4] });
  arm(rodAt(b + 7.3, 118, 0.42), cupTops['F sharp'].top, 0.05);
  arm(rodAt(b + 15.55, 118, 0.42), cupTops['low C'].top, 0.058);
  arm(rodAt(b + 13.75, 118, 0.42), cupTops['low Eb'].top, 0.058);
  [[12.9, 13.0], [13.45, 13.55]].forEach(([s0, s1]) => {
    const a = rodAt(b + s0, 138, 0.56); const c = rodAt(b + s1, 172, 0.5);
    shine(tube([a, c], 0.12, { sides: 10, steps: 2, round: 2 }), BRASS_HI);
    arm(rodAt(b + s0 + 0.1, 118, 0.42), a, 0.04);
  });
  // Palm keys and front F.
  rod(b + 0.9, b + 3.9, -112, 0.3, { postsAt: [b + 0.9, b + 3.9] });
  for (const name of ['palm D', 'palm Eb', 'palm F']) {
    const cup = SAX_CUPS.find((c) => c.name === name);
    const s = sOf(cup);
    const from = rodAt(s, -112, 0.3);
    arm(from, cupTops[name].top, 0.045);
    const touch = rodAt(s + 0.1, -136, 0.56);
    arm(from, touch, 0.04);
    pearlTouch(touch, surf(s + 0.1, -136).n, 0.2);
  }
  {
    const touch = rodAt(b + 3.0, -14, 0.7);
    arm(cupTops['front F'].top, touch, 0.04);
    pearlTouch(touch, surf(b + 3.0, -14).n, 0.2);
    post(b + 2.2, -14, 0.4);
  }
  // G sharp and the long left-hand rod that takes the little finger's table down to the bell keys.
  rod(b + 7.0, b + 15.2, -92, 0.42, { postsAt: [b + 7.0, b + 11, b + 15.2] });
  arm(rodAt(b + 8.0, -92, 0.42), cupTops['G sharp'].top, 0.05);
  [[6.9, 7.0, -70], [7.45, 7.5, -80], [8.0, 8.05, -90]].forEach(([s0, s1, ph], i) => {
    const a = rodAt(b + s0, ph - 28, 0.56); const c = rodAt(b + s1, ph + 18, 0.52);
    shine(tube([a, c], 0.1, { sides: 10, steps: 2, round: 2 }), BRASS_HI);
    arm(rodAt(b + 7 + 0.1 * i, -92, 0.42), a, 0.038);
  });
  const sb = path.sBell;
  rod(sb + 0.8, sb + 8.5, -128, 0.42, { postsAt: [sb + 0.8, sb + 4.6, sb + 8.5] });
  for (const name of ['low C sharp', 'low B', 'low Bb']) {
    const cup = SAX_CUPS.find((c) => c.name === name);
    arm(rodAt(sOf(cup), -128, 0.42), cupTops[name].top, 0.06);
  }
  // The link across the bow from the body's long rod to the bell's.
  arm(rodAt(b + 15.2, -92, 0.42), rodAt(sb + 0.8, -128, 0.42), 0.05);
  // Wire guards over the two big bell keys and the low C.
  for (const name of ['low B', 'low Bb', 'low C']) {
    const cup = SAX_CUPS.find((c) => c.name === name);
    const s = sOf(cup);
    const span = cup.R * 1.15;
    const pts = [];
    for (let i = 0; i <= 8; i += 1) {
      const f = i / 8;
      const d = -span + 2 * span * f;
      const lift = 0.42 + cup.R * 0.3 + Math.sqrt(Math.max(0, 1 - (d / span) ** 2)) * 0.34;
      pts.push(surf(s + d, cup.phi + (cup.on === 'bell' ? 34 : 32), lift * (0.25 + 0.75 * Math.sqrt(Math.max(0, 1 - (d / span) ** 2)))).p);
    }
    shine(tube(pts, 0.042, { sides: 6, steps: 16, round: 1 }), BRASS_HI);
    for (const e of [-span, span]) post(s + e, cup.phi + 32, 0.05, 0.06);
  }

  // The brace from body to bell, a real plate and strut.
  {
    const y = 9.2;
    const find = (a, c) => { let lo = a; let hi = c; for (let i = 0; i < 40; i += 1) { const m = (lo + hi) / 2; if ((interp(m).c[1] > y) === (interp(a).c[1] > y)) lo = m; else hi = m; } return (lo + hi) / 2; };
    const sA = find(b, path.sBow);
    const sB = find(path.sBell, L);
    const A = surf(sA, -12); const C = surf(sB, -8);
    const g = tube([A.p, mix3(A.p, C.p, 0.5), C.p], [0.12, 0.09, 0.13], { sides: 10, steps: 6, round: 1 });
    shine(g, BRASS_HI);
    for (const e of [A, C]) {
      const foot = latheUp([[0, -0.06], [0.36, -0.06], [0.36, 0.015], [0.2, 0.05], [0.12, 0.08], [0, 0.09]], { segments: 14 });
      seat(foot, e.p, e.n);
      shine(foot, BRASS_HI);
    }
  }
  // Behind the body: the strap ring and the two thumb rests.
  {
    const ring = surf(b + 9.2, 180);
    const torus = new THREE.TorusGeometry(0.26, 0.05, 8, 18);
    torus.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    torus.translate(ring.p[0] + ring.n[0] * 0.28, ring.p[1] + ring.n[1] * 0.28, ring.p[2] + ring.n[2] * 0.28);
    shine(torus, BRASS_HI);
    post(b + 9.2, 180, 0.08, 0.1);
    const hook0 = surf(b + 12.3, 172, 0.02).p;
    const hook1 = surf(b + 12.3, 172, 0.55).p;
    const hook2 = surf(b + 13.0, 172, 0.72).p;
    shine(tube([hook0, hook1, hook2], [0.11, 0.09, 0.07], { sides: 8, steps: 8, round: 2 }), BRASS_HI);
    const rest = surf(b + 6.2, 178, 0.1);
    const pad = latheUp([[0, -0.1], [0.26, -0.1], [0.28, 0], [0.24, 0.1], [0, 0.13]], { segments: 14 });
    seat(pad, rest.p, rest.n);
    black.push({ geometry: pad, color: 0x161412 });
  }

  // --- the neck: octave key and cork --------------------------------------------------------------------
  {
    const OCT_PHI = 0;
    const pip = surf(1.75, OCT_PHI);
    const pipG = latheUp([[0, -0.05], [0.17, -0.05], [0.19, 0.1], [0.17, 0.18], [0, 0.2]], { segments: 12 });
    seat(pipG, pip.p, pip.n);
    shine(pipG, BRASS_HI);
    const pts = [];
    for (let i = 0; i <= 8; i += 1) pts.push(surf(mix(1.75, 7.0, i / 8), OCT_PHI, 0.2 + 0.05 * Math.sin((i / 8) * Math.PI)).p);
    shine(tube(pts, 0.05, { sides: 7, steps: 16, round: 1 }), BRASS);
    const saddleS = 4.2;
    const f = interp(saddleS);
    const r = rOf(saddleS);
    const saddle = latheUp([[0, -0.12], [r + 0.03, -0.12], [r + 0.05, -0.09], [r + 0.05, 0.09], [r + 0.03, 0.12], [0, 0.12]], { segments: 24 });
    seat(saddle, f.c, f.t);
    shine(saddle, BRASS_HI);
    post(saddleS, OCT_PHI, 0.2, 0.07);
    // The tension screw that holds the neck in its socket.
    const scr = surf(path.sBody - 0.05, -90);
    const screw = latheUp([[0, -0.05], [0.1, -0.05], [0.1, 0.22], [0.2, 0.25], [0.2, 0.36], [0.16, 0.4], [0, 0.42]], { segments: 12 });
    seat(screw, scr.p, scr.n);
    shine(screw, BRASS_HI);
    // Octave key on the body, up the back of the neck socket, to meet the neck's lever.
    post(path.sBody + 0.9, 28, 0.3);
    arm(surf(path.sBody + 0.9, 28, 0.3).p, surf(7.0, OCT_PHI, 0.2).p, 0.042);
  }
  // The cork on the neck's tip, showing behind the mouthpiece.
  {
    const f = interp(0.9);
    const r = rOf(0.9);
    const cork = latheUp([[0, -0.95], [r + 0.022, -0.95], [r + 0.022, 0.45], [r * 0.99, 0.5], [0, 0.5]], { segments: 22 });
    seat(cork, f.c, f.t);
    soft.push({ geometry: cork, color: 0xb8976a });
  }

  // --- the mouthpiece, reed and ligature ----------------------------------------------------------------
  const tipF = interp(0);
  const A0 = tipF.c;
  const a = scl(tipF.t, -1); // the axis, from the neck out toward the player
  const uu = norm(sub(tipF.N, scl(a, dot(tipF.N, a))));
  const side = cross(uu, a);
  const MP_LEN = 3.45;
  const MP_FROM = -0.72; // the shank overlaps the cork
  const at3 = (t, x, y) => add(add(add(A0, scl(a, t)), scl(side, x)), scl(uu, y));
  const widthAt = (f) => mix(0.53, 0.37, sstep(f, 0.1, 1)) * (f > 0.985 ? 0.93 : 1);
  const topAt = (f) => mix(0.53, 0.05, sstep(f, 0.16, 1) ** 0.85);
  const tableAt = (f) => mix(0.53, 0.015, sstep(f, 0.2, 1) ** 0.72);
  const mpRings = [];
  const MP_ST = 28;
  for (let i = 0; i <= MP_ST; i += 1) {
    const f = i / MP_ST;
    const t = mix(MP_FROM, MP_FROM + MP_LEN, f);
    const flatten = sstep(f, 0.16, 0.34);
    const w = widthAt(f); const hT = topAt(f); const hB = tableAt(f);
    const ring = [];
    const N = 28;
    for (let j = 0; j < N; j += 1) {
      const ang = (j / N) * Math.PI * 2;
      const c = Math.cos(ang); const sn = Math.sin(ang);
      const y = sn >= 0 ? hT * sn : -hB * Math.abs(sn) ** mix(1, 0.22, flatten);
      ring.push(at3(t, w * c, y));
    }
    mpRings.push(ring);
  }
  const mouth = loftClosed(mpRings, () => [0, 0]);
  polishGeometry(mouth, 0x151311, { pale: 0.16 });
  black.push({ geometry: mouth, keepColor: true });
  // The reed, a real tapered slab on the mouthpiece's flat table.
  {
    const rings = [];
    const REED_ST = 12;
    for (let i = 0; i <= REED_ST; i += 1) {
      const f = mix(0.36, 0.995, i / REED_ST);
      const t = mix(MP_FROM, MP_FROM + MP_LEN, f);
      const y0 = -tableAt(f) + 0.004;
      const thick = mix(0.085, 0.006, sstep(f, 0.55, 0.995));
      const hw = mix(0.3, 0.33, f) * (f > 0.97 ? mix(1, 0.8, (f - 0.97) / 0.025) : 1);
      rings.push([at3(t, -hw, y0), at3(t, hw, y0), at3(t, hw, y0 - thick * 0.75), at3(t, hw * 0.55, y0 - thick), at3(t, -hw * 0.55, y0 - thick), at3(t, -hw, y0 - thick * 0.75)]);
    }
    const reed = loftClosed(rings, () => [0, 0]);
    tintVertices(reed, (x, y, z, out) => {
      const n = 0.86 + 0.2 * smoothNoise3(x * 2, y * 2, z * 14);
      out[0] = 0.72 * n; out[1] = 0.5 * n; out[2] = 0.2 * n;
    });
    soft.push({ geometry: reed, keepColor: true });
  }
  // The ligature: a metal sleeve round mouthpiece and reed together, with its two screws under the reed.
  {
    const rings = [];
    const LF0 = 0.5; const LF1 = 0.66;
    const stations = [[LF0 - 0.002, -0.03], [LF0, 0.022], [LF0 + 0.01, 0.03], [LF1 - 0.01, 0.03], [LF1, 0.022], [LF1 + 0.002, -0.03]];
    for (const [f, off] of stations) {
      const t = mix(MP_FROM, MP_FROM + MP_LEN, f);
      const w = widthAt(f) + off; const hT = topAt(f) + off; const hB = tableAt(f) + 0.085 + off;
      const ring = [];
      const N = 28;
      for (let j = 0; j < N; j += 1) {
        const ang = (j / N) * Math.PI * 2;
        const c = Math.cos(ang); const sn = Math.sin(ang);
        ring.push(at3(t, w * c, sn >= 0 ? hT * sn : -hB * Math.abs(sn) ** 0.4));
      }
      rings.push(ring);
    }
    const lig = loftClosed(rings, () => [0, 0]);
    shine(lig, lin(0xb9b6ac), { pale: 0.3 });
    for (const f of [0.54, 0.62]) {
      const t = mix(MP_FROM, MP_FROM + MP_LEN, f);
      const y = -tableAt(f) - 0.14;
      const x0 = at3(t, -0.3, y); const x1 = at3(t, 0.36, y);
      shine(tube([x0, x1], 0.042, { sides: 8, steps: 1, round: 1, straight: true }), lin(0xc4c1b6));
      const kn = latheUp([[0, -0.02], [0.075, -0.02], [0.08, 0.1], [0.06, 0.13], [0, 0.13]], { segments: 10 });
      seat(kn, x1, side);
      shine(kn, lin(0xc4c1b6));
    }
  }

  // --- everything so far goes from inches into feet, standing on the stand ------------------------------
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity;
  for (let i = 0; i < path.pts.length; i += 1) {
    const s = path.S[i];
    const q = path.pts[i]; const r = rOf(s);
    minX = Math.min(minX, q[0] - r); maxX = Math.max(maxX, q[0] + r); minY = Math.min(minY, q[1] - r);
  }
  const tipX = at3(MP_FROM + MP_LEN, 0, 0)[0];
  minX = Math.min(minX, tipX);
  const STAND_Y = 0.32;
  const OX = (-(minX + maxX) / 2) * SAX_K;
  const OY = STAND_Y - minY * SAX_K;
  const place = new THREE.Matrix4().makeScale(SAX_K, SAX_K, SAX_K).setPosition(OX, OY, 0);
  const toFeet = (p) => [p[0] * SAX_K + OX, p[1] * SAX_K + OY, p[2] * SAX_K];
  const placeAll = (list) => { for (const part of list) part.geometry.applyMatrix4(place); };
  placeAll(brass); placeAll(soft); placeAll(black); hornPart.geometry.applyMatrix4(place);

  // --- the stand, in feet: three legs, a cradle under the bow, a padded fork at the body -----------------
  const steel = 0x1b1c1e;
  const bowBottom = toFeet(interp(path.sBow + (path.sBell - path.sBow) * 0.5).c);
  const hub = [bowBottom[0] * 0.8, 0, 0];
  const stand = [];
  for (let i = 0; i < 3; i += 1) {
    const ang = ((i + 0.25) / 3) * Math.PI * 2;
    const tip = [hub[0] + Math.sin(ang) * 1.45, 0.05, Math.cos(ang) * 1.45];
    stand.push({ geometry: tube([[hub[0], 0.2, 0], [mix(hub[0], tip[0], 0.5), 0.125, tip[2] * 0.5], tip], [0.052, 0.046, 0.04], { sides: 8, steps: 8, round: 1 }), color: steel });
    stand.push({ geometry: latheUp([[0, 0], [0.09, 0], [0.095, 0.03], [0.07, 0.07], [0.045, 0.1], [0, 0.1]], { segments: 10 }).translate(tip[0], 0, tip[2]), color: 0x101010 });
  }
  stand.push({ geometry: latheUp([[0, 0.12], [0.095, 0.12], [0.1, 0.17], [0.09, 0.27], [0, 0.29]], { segments: 14 }).translate(hub[0], 0, 0), color: steel });
  // A padded cup under the bow, its centre on the bow's underside. Its top wraps the tube's lower side.
  {
    const bowP = bowBottom;
    const rB = rOf(path.sBow + (path.sBell - path.sBow) * 0.5) * SAX_K;
    const underY = bowP[1] - rB;
    stand.push({ geometry: tube([[hub[0], 0.25, 0], [bowP[0], underY - 0.03, bowP[2]]], 0.038, { sides: 8, steps: 2, straight: true, round: 1 }), color: steel });
    const pts = [];
    for (let i = 0; i <= 12; i += 1) {
      const ang = -Math.PI * 0.42 + (i / 12) * Math.PI * 0.84;
      pts.push([bowP[0] + Math.sin(ang) * (rB + 0.012) * 0.4, bowP[1] - Math.cos(ang) * (rB + 0.012), bowP[2] + Math.sin(ang) * (rB + 0.012)]);
    }
    stand.push({ geometry: tube(pts, 0.03, { sides: 8, steps: 18, round: 2 }), color: 0x232325 });
  }
  // The padded fork that keeps it upright, from the hub up to the body's back at about its low C.
  {
    const s = path.sBody + 14.6;
    const f = interp(s);
    const r = rOf(s);
    const c = toFeet(f.c);
    const rF = r * SAX_K + 0.03;
    const back = [c[0] - rF - 0.05, c[1], c[2]];
    stand.push({ geometry: tube([[hub[0], 0.25, 0], [mix(hub[0], back[0], 0.9), mix(0.25, back[1], 0.55), 0], back], 0.036, { sides: 8, steps: 10, round: 1 }), color: steel });
    const pts = [];
    for (let i = 0; i <= 14; i += 1) {
      const ang = (-125 + (i / 14) * 250) * (Math.PI / 180);
      pts.push([c[0] - Math.cos(ang) * rF, c[1], c[2] + Math.sin(ang) * rF]);
    }
    stand.push({ geometry: tube(pts, 0.024, { sides: 8, steps: 22, round: 2 }), color: 0x232325 });
  }

  // --- materials ------------------------------------------------------------------------------------------
  const engraving = saxEngraving();
  const brassMesh = mesh(mergeParts([hornPart, ...brass]), standard({ vertexColors: true, map: engraving, bumpMap: engraving, bumpScale: 0.12, roughness: 0.3, metalness: 0.22 }));
  const softMesh = mesh(mergeParts(soft), standard({ vertexColors: true, roughness: 0.62, metalness: 0 }));
  const blackMesh = mesh(mergeParts(black), standard({ vertexColors: true, roughness: 0.3, metalness: 0.05 }));
  const standMesh = mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.5, metalness: 0.25 }));
  return group(brassMesh, softMesh, blackMesh, standMesh);
}

// ---------------------------------------------------------------------------
// Angkor Wat, about 1/20 in height, with the moat and the outer court narrowed
// ---------------------------------------------------------------------------

// The real temple faces WEST, and +Z here is that west front: the long stone causeway crosses the moat
// on +Z, and an earth bank crosses it on -Z, which is the real temple's east side. Heights are at 1/20:
// the central tower is 213ft and comes out 10.7ft. The plan is compressed, by less at the top than at
// the bottom, because the real thing at 1/20 would be 75ft across its moat.
//
// The temple is written out as data: exactly five lotus-bud towers, the quincunx.
const AK_TIER1 = { hx: 7.0, hz: 6.4, y0: 0.2, y1: 0.62 };
const AK_TIER2 = { hx: 4.6, hz: 4.2, y0: 0.62, y1: 1.62 };
const AK_TIER3 = { hx: 3.1, hz: 3.1, y0: 1.62, y1: 3.7 };
const AK_RING = 2.72;
const AK_CORNER = 2.2;
export const ANGKOR_TOWERS = [
  { name: 'central', x: 0, z: 0, half: 0.98, bodyTop: 5.05, top: 10.72, tiers: 9 },
  { name: 'north-east', x: AK_CORNER, z: -AK_CORNER, half: 0.56, bodyTop: 4.62, top: 7.95, tiers: 6 },
  { name: 'south-east', x: -AK_CORNER, z: -AK_CORNER, half: 0.56, bodyTop: 4.62, top: 7.95, tiers: 6 },
  { name: 'south-west', x: -AK_CORNER, z: AK_CORNER, half: 0.56, bodyTop: 4.62, top: 7.95, tiers: 6 },
  { name: 'north-west', x: AK_CORNER, z: AK_CORNER, half: 0.56, bodyTop: 4.62, top: 7.95, tiers: 6 },
];

// A stone tile for a surface a student reads from a few feet: level courses of big blocks with dark
// joints, and damp along the joints. Near-white, so the vertex tint owns the colour.
function akStoneTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#dedad0';
    ctx.fillRect(0, 0, w, h);
    const COURSES = 16;
    let y = 0;
    for (let r = 0; r < COURSES; r += 1) {
      const rowH = r === COURSES - 1 ? h - y : (h / COURSES) * (0.86 + rng() * 0.28);
      const off = rng() * w;
      let x = 0;
      const seams = [];
      while (x < w - 40) {
        const len = Math.min(w - x, 70 + rng() * 110);
        const v = 212 + rng() * 34;
        ctx.fillStyle = `rgb(${v},${v},${v * 0.97})`;
        const px = (x + off) % w;
        ctx.fillRect(px, y, len, rowH);
        if (px + len > w) ctx.fillRect(px - w, y, len, rowH);
        seams.push(px);
        x += len;
      }
      ctx.fillStyle = 'rgba(46,46,36,0.6)';
      ctx.fillRect(0, y, w, 2);
      for (const px of seams) ctx.fillRect(px, y, 1.8, rowH);
      for (let k = 0; k < 10; k += 1) {
        const mx = rng() * w; const len = 16 + rng() * 70;
        ctx.fillStyle = `rgba(${60 + rng() * 40},${84 + rng() * 40},${44 + rng() * 26},${0.2 + rng() * 0.35})`;
        ctx.fillRect(mx, y - 1, len, 2 + rng() * 6);
      }
      y += rowH;
    }
    // Lichen in small round blooms, black and a dull ochre, which is what this stone actually wears.
    for (let i = 0; i < 520; i += 1) {
      const dark = rng() > 0.3;
      const bx = rng() * w; const by = rng() * h; const R = 2 + rng() * 11;
      ctx.fillStyle = dark ? `rgba(40,42,32,${0.03 + rng() * 0.09})` : `rgba(160,146,92,${0.04 + rng() * 0.1})`;
      // An irregular crust of overlapping specks, not a clean disc: discs read as polka dots.
      for (let k = 0; k < 9; k += 1) {
        ctx.beginPath();
        ctx.arc(bx + (rng() - 0.5) * R * 2, by + (rng() - 0.5) * R * 2, 0.6 + rng() * R * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 4000; i += 1) {
      const v = 80 + rng() * 110;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.9},${0.08 + rng() * 0.2})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2.4, 1 + rng() * 2.4);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 0.92, 1 / 0.92);
  return t;
}

// The stone roofs imitate rows of curved tile running down the slope: ribs along V.
function akRoofTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d4d0c6';
    ctx.fillRect(0, 0, w, h);
    const RIBS = 16;
    for (let i = 0; i < RIBS; i += 1) {
      const x = (i / RIBS) * w; const wide = w / RIBS;
      const g = ctx.createLinearGradient(x, 0, x + wide, 0);
      g.addColorStop(0, 'rgb(112,112,100)');
      g.addColorStop(0.35, 'rgb(214,212,202)');
      g.addColorStop(0.7, 'rgb(178,175,165)');
      g.addColorStop(1, 'rgb(96,96,86)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, wide, h);
    }
    // The lap of each course of tile.
    for (let y = 0; y < h; y += h / 8) {
      ctx.fillStyle = 'rgba(30,32,26,0.4)';
      ctx.fillRect(0, y, w, 2.4);
    }
    for (let i = 0; i < 500; i += 1) {
      const dark = rng() > 0.35;
      ctx.fillStyle = dark ? `rgba(30,32,26,${0.08 + rng() * 0.22})` : `rgba(120,136,78,${0.1 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 1 + rng() * rng() * 9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Two strips on one canvas. The top strip is the first gallery's bas-relief: registers of marching
// figures and, through the middle, ranks hauling on a great serpent, after the Churning of the Ocean of
// Milk. It is representative, drawn in the manner of the reliefs and not copied from any panel. The
// lower strip is the balustered false windows of the upper galleries.
function akWallStrips() {
  const rng = seededRandom(1113);
  const W = 1024; const H = 512;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#b9b29e';
    ctx.fillRect(0, 0, W, H);
    // A raised figure: its lit form over a dark offset, which is the whole trick of low relief.
    const form = (draw) => {
      ctx.save();
      ctx.translate(1.6, 1.8);
      ctx.fillStyle = '#3f3b30';
      ctx.strokeStyle = '#3f3b30';
      draw();
      ctx.restore();
      ctx.fillStyle = '#e2dac4';
      ctx.strokeStyle = '#e2dac4';
      draw();
    };
    const figure = (x, y, S, dir, pose) => {
      form(() => {
        ctx.lineCap = 'round';
        ctx.lineWidth = S * 0.11;
        // Legs in a marching stride, a torso, a crowned head in profile, a raised arm with a spear.
        ctx.beginPath();
        ctx.moveTo(x, y - S * 0.46); ctx.lineTo(x + dir * S * 0.2, y);
        ctx.moveTo(x, y - S * 0.46); ctx.lineTo(x - dir * S * 0.16, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - S * 0.11, y - S * 0.5); ctx.lineTo(x + S * 0.11, y - S * 0.5); ctx.lineTo(x + S * 0.07, y - S * 0.8); ctx.lineTo(x - S * 0.07, y - S * 0.8); ctx.closePath();
        ctx.fill();
        ctx.beginPath(); ctx.arc(x + dir * S * 0.02, y - S * 0.9, S * 0.085, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - S * 0.06, y - S * 0.96); ctx.lineTo(x + dir * S * 0.02, y - S * 1.12); ctx.lineTo(x + S * 0.08, y - S * 0.96); ctx.closePath(); ctx.fill();
        ctx.lineWidth = S * 0.075;
        ctx.beginPath();
        ctx.moveTo(x, y - S * 0.76);
        if (pose === 'haul') { ctx.lineTo(x + dir * S * 0.34, y - S * 0.56); } else { ctx.lineTo(x + dir * S * 0.26, y - S * 0.9); }
        ctx.stroke();
        if (pose !== 'haul') {
          ctx.lineWidth = S * 0.03;
          ctx.beginPath(); ctx.moveTo(x + dir * S * 0.24, y - S * 0.42); ctx.lineTo(x + dir * S * 0.3, y - S * 1.28); ctx.stroke();
        }
      });
    };
    const STRIP = H / 2;
    // Top and bottom borders of the panel: a small repeated lotus band.
    for (const y of [0, STRIP - 18]) {
      ctx.fillStyle = '#726c5a';
      ctx.fillRect(0, y, W, 18);
      for (let x = 0; x < W; x += 16) {
        ctx.fillStyle = '#cfc7b0';
        ctx.beginPath(); ctx.ellipse(x + 8, y + 9, 5.5, 7, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // The upper register, an army on the march.
    for (let x = 16; x < W; x += 36) figure(x, 86, 56, 1, 'spear');
    // A parasol over every so often, the rank of a commander.
    for (let x = 88; x < W; x += 252) {
      form(() => {
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x, 26); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(x, 26, 22, 7, 0, Math.PI, 0); ctx.fill();
      });
    }
    // The middle register, ranks hauling a serpent's body from both sides.
    const sy = (x) => 150 + Math.sin((x / W) * Math.PI * 4) * 6;
    for (let x = 18; x < W; x += 34) figure(x, 180, 56, x < W / 2 ? 1 : -1, 'haul');
    form(() => {
      ctx.lineWidth = 11;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) { if (x === 0) ctx.moveTo(x, sy(x)); else ctx.lineTo(x, sy(x)); }
      ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(70,64,50,0.8)';
    ctx.lineWidth = 1;
    for (let x = 4; x < W; x += 7) { ctx.beginPath(); ctx.moveTo(x, sy(x) - 5); ctx.lineTo(x + 3, sy(x) + 5); ctx.stroke(); }
    // The lowest register, the ocean: rows of waves and fish.
    ctx.fillStyle = '#8a8370';
    ctx.fillRect(0, 186, W, 52);
    ctx.strokeStyle = '#e0d8c0';
    ctx.lineWidth = 2;
    for (let row = 0; row < 3; row += 1) {
      for (let x = (row % 2) * 12; x < W; x += 24) {
        ctx.beginPath();
        ctx.arc(x, 200 + row * 13, 10, Math.PI, 0);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 20; i += 1) {
      const x = rng() * W; const y = 196 + rng() * 34;
      ctx.fillStyle = '#e8e0c8';
      ctx.beginPath(); ctx.ellipse(x, y, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x - 13, y - 3); ctx.lineTo(x - 13, y + 3); ctx.closePath(); ctx.fill();
    }
    // --- the false windows ---------------------------------------------------------------------
    const WIN = 128;
    const Y0 = STRIP;
    ctx.fillStyle = '#918d7c';
    ctx.fillRect(0, Y0, W, STRIP);
    for (let i = 0; i < W / WIN; i += 1) {
      const x = i * WIN;
      ctx.fillStyle = '#6a6757';
      ctx.fillRect(x + 12, Y0 + 26, WIN - 24, STRIP - 52);
      ctx.fillStyle = '#100f0b';
      ctx.fillRect(x + 20, Y0 + 36, WIN - 40, STRIP - 72);
      // Seven turned balusters, one bead on another, in front of the dark.
      for (let b = 0; b < 7; b += 1) {
        const bx = x + 26 + b * ((WIN - 52) / 6);
        for (let k = 0; k < 7; k += 1) {
          const by = Y0 + 46 + k * ((STRIP - 92) / 6);
          const rw = k % 2 ? 4.5 : 3;
          ctx.fillStyle = '#928e7d';
          ctx.beginPath(); ctx.ellipse(bx, by, rw, 13, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(40,38,30,0.75)';
          ctx.fillRect(bx + rw * 0.25, by - 13, rw * 0.7, 26);
        }
      }
      ctx.fillStyle = '#a5a190';
      ctx.fillRect(x + 6, Y0 + 14, WIN - 12, 12);
      ctx.fillRect(x + 6, Y0 + STRIP - 26, WIN - 12, 12);
    }
    // Weathering over both: patches of damp, and the black streaks run-off leaves.
    for (let i = 0; i < 180; i += 1) {
      ctx.fillStyle = `rgba(52,56,40,${0.05 + rng() * 0.13})`;
      ctx.beginPath(); ctx.ellipse(rng() * W, rng() * H, 8 + rng() * 40, 4 + rng() * 26, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function angkorWat() {
  const rng = seededRandom(1150);
  const stone = new Soup();
  const roof = new Soup();
  const walls = new Soup();
  const ground = new Soup();
  const plants = [];

  // --- colour ---------------------------------------------------------------------------------------
  const S_A = lin(0x696c60); const S_B = lin(0x7e7f71); const S_DARK = lin(0x4d5145);
  const MOSS = lin(0x566a42); const LICHEN = lin(0x34362d); const OCHRE = lin(0x8f8560);
  const toneInto = (x, y, z, k = 0) => {
    const a = fbm(x * 0.8 + k, y * 0.8, z * 0.8, 3);
    let c = mix3(S_A, S_B, sstep(a, 0.34, 0.66));
    const damp = fbm(x * 1.7 + 11, y * 2.2, z * 1.7 + 4, 2);
    c = mix3(c, S_DARK, sstep(damp, 0.45, 0.68) * 0.6);
    const moss = fbm(x * 1.15 + 20, y * 1.4 + 3, z * 1.15, 3);
    const low = 1 - sstep(y, 0.3, 7) * 0.55;
    c = mix3(c, MOSS, sstep(moss, 0.5, 0.7) * 0.62 * low);
    const black = fbm(x * 3.4, y * 3.4 + 7, z * 3.4, 2);
    c = mix3(c, LICHEN, sstep(black, 0.58, 0.74) * 0.42);
    const och = fbm(x * 4.1 + 40, y * 4.1, z * 4.1 + 9, 2);
    c = mix3(c, OCHRE, sstep(och, 0.64, 0.78) * 0.28);
    return c;
  };
  // Laterite, the iron-rich rust-brown rock of the outer walls, is darker and redder than the sandstone.
  const LATERITE = lin(0x57402f);
  const lateriteInto = (x, y, z) => {
    const c = toneInto(x, y, z, 30);
    return mix3(c, times(LATERITE, 0.8 + 0.4 * fbm(x * 2.5, y * 2.5, z * 2.5, 2)), 0.72);
  };
  const quadT = (soup, pts, hint, opts = {}) => {
    const fn = opts.tone ?? toneInto;
    const cols = pts.map((q) => {
      const c = fn(q[0], q[1], q[2]);
      return opts.k ? times(c, opts.k) : c;
    });
    soup.face(pts, cols, hint, opts.uv ? { uv: opts.uv } : {});
  };

  // A rectangular ring swept round with a mitred profile. Each [offset, y] is a rectangle of half-size
  // (hx + offset, hz + offset), so the corners meet with no arithmetic. The section is walked with the
  // solid on its left: going up on an outside face, inward along a ledge, down an inside face.
  const SIDES = [
    { a: 'x', n: [0, 0, 1] }, { a: 'z', n: [1, 0, 0] }, { a: 'x', n: [0, 0, -1] }, { a: 'z', n: [-1, 0, 0] },
  ];
  const ringProfile = (soup, hx, hz, profile, { sub = 1.5, cx = 0, cz = 0, tone = null, k = 1, roofUV = false } = {}) => {
    let vRun = 0;
    for (let i = 0; i < profile.length - 1; i += 1) {
      const [o0, y0] = profile[i]; const [o1, y1] = profile[i + 1];
      const dO = o1 - o0; const dY = y1 - y0;
      const lenV = Math.hypot(dO, dY);
      if (lenV < 1e-6) continue;
      const no = dY; const ny = -dO;
      for (const side of SIDES) {
        const hA0 = (side.a === 'x' ? hx : hz) + o0; const hA1 = (side.a === 'x' ? hx : hz) + o1;
        const b0 = (side.a === 'x' ? hz : hx) + o0; const b1 = (side.a === 'x' ? hz : hx) + o1;
        const sgn = side.n[0] + side.n[2];
        const n = Math.max(1, Math.round((2 * Math.max(hA0, hA1)) / sub));
        const pos = (t, h, b, y) => {
          const along = mix(-h, h, t);
          return side.a === 'x' ? [cx + along, y, cz + sgn * b] : [cx + sgn * b, y, cz + along];
        };
        const hint = [side.n[0] * no, ny, side.n[2] * no];
        for (let j = 0; j < n; j += 1) {
          const t0 = j / n; const t1 = (j + 1) / n;
          const q = [pos(t0, hA0, b0, y0), pos(t1, hA0, b0, y0), pos(t1, hA1, b1, y1), pos(t0, hA1, b1, y1)];
          const opts = { tone, k };
          if (roofUV) {
            const uAt = (t, h) => mix(-h, h, t) * 1.7;
            opts.uv = [[uAt(t0, hA0), vRun * 2], [uAt(t1, hA0), vRun * 2], [uAt(t1, hA1), (vRun + lenV) * 2], [uAt(t0, hA1), (vRun + lenV) * 2]];
          }
          quadT(soup, q, hint, opts);
        }
      }
      vRun += lenV;
    }
  };
  // A flat pavement between two rectangles, for tint and a floor.
  const floorRing = (hx0, hz0, hx1, hz1, y, { cell = 1.4, tone = null } = {}) => {
    const strip = (x0, z0, x1, z1) => {
      const nx = Math.max(1, Math.round((x1 - x0) / cell)); const nz = Math.max(1, Math.round((z1 - z0) / cell));
      for (let i = 0; i < nx; i += 1) {
        for (let j = 0; j < nz; j += 1) {
          const xa = mix(x0, x1, i / nx); const xb = mix(x0, x1, (i + 1) / nx);
          const za = mix(z0, z1, j / nz); const zb = mix(z0, z1, (j + 1) / nz);
          quadT(stone, [[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]], [0, 1, 0], { tone });
        }
      }
    };
    strip(-hx0, hz1, hx0, hz0);
    strip(-hx0, -hz0, hx0, -hz1);
    strip(-hx0, -hz1, -hx1, hz1);
    strip(hx1, -hz1, hx0, hz1);
  };

  // A square pillar with a capital and a base, spaced by the caller.
  const pillar = (x, z, y0, y1, s = 0.052, plain = false) => {
    const b = (w, ya, yb, wTop = w) => stone.hexa(
      [[x - w, ya, z - w], [x + w, ya, z - w], [x + w, ya, z + w], [x - w, ya, z + w]],
      [[x - wTop, yb, z - wTop], [x + wTop, yb, z - wTop], [x + wTop, yb, z + wTop], [x - wTop, yb, z + wTop]],
      toneInto(x, mix(ya, yb, 0.5), z),
      { skipBottom: true },
    );
    if (plain) { b(s * 1.04, y0, y1, s * 0.94); return; }
    b(s * 1.08, y0, y1 - 0.05, s * 0.92);
    b(s * 0.94, y1 - 0.05, y1, s * 1.36);
  };
  // A pillar every `step` feet round a rectangle, skipping where a pavilion stands.
  const colonnade = (hx, hz, y0, y1, step, s, skip, plain = false) => {
    const run = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.round(L / step);
      for (let i = 0; i <= n; i += 1) {
        const x = mix(ax, bx, i / n); const z = mix(az, bz, i / n);
        if (skip && skip(x, z)) continue;
        pillar(x, z, y0, y1, s, plain);
      }
    };
    run(-hx, hz, hx, hz); run(hx, -hz, -hx, -hz); run(hx, hz - step, hx, -hz + step); run(-hx, -hz + step, -hx, hz - step);
  };
  // A relief or window strip on a wall, facing `out`. `strip` picks the row of the canvas.
  const wallStrip = (ax, az, bx, bz, y0, y1, out, strip, tile) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / 1.2));
    for (let i = 0; i < n; i += 1) {
      const f0 = i / n; const f1 = (i + 1) / n;
      const q = [[mix(ax, bx, f0), y0, mix(az, bz, f0)], [mix(ax, bx, f1), y0, mix(az, bz, f1)], [mix(ax, bx, f1), y1, mix(az, bz, f1)], [mix(ax, bx, f0), y1, mix(az, bz, f0)]];
      const vLow = strip === 'relief' ? 0.5 : 0; const vHigh = strip === 'relief' ? 1 : 0.5;
      const u0 = (f0 * L) / tile; const u1 = (f1 * L) / tile;
      walls.face(q, [times(toneMix(q[0]), 1), times(toneMix(q[1]), 1), times(toneMix(q[2]), 1), times(toneMix(q[3]), 1)], out, { uv: [[u0, vLow], [u1, vLow], [u1, vHigh], [u0, vHigh]] });
    }
  };
  // The strip map supplies the picture, so the tint is near white with only the damp in it.
  const toneMix = (q) => {
    const d = fbm(q[0] * 0.9 + 3, q[1] * 1.1, q[2] * 0.9, 2);
    const k = 0.66 + 0.34 * sstep(d, 0.3, 0.7);
    return [k * 0.9, k * 0.94, k * 0.84];
  };
  const wallRect = (hx, hz, y0, y1, strip, tile, { facing = 1 } = {}) => {
    wallStrip(-hx, hz, hx, hz, y0, y1, [0, 0, facing], strip, tile);
    wallStrip(hx, hz, hx, -hz, y0, y1, [facing, 0, 0], strip, tile);
    wallStrip(hx, -hz, -hx, -hz, y0, y1, [0, 0, -facing], strip, tile);
    wallStrip(-hx, -hz, -hx, hz, y0, y1, [-facing, 0, 0], strip, tile);
  };
  // Stepped stone roof: a section of overlapping tile courses, ridged, swept round a rectangle.
  const vault = (hx, hz, dOut, dIn, yEave, yRidge) => {
    // hx,hz are the ridge line's half-sizes; dOut and dIn how far the eaves reach either side of it.
    const steps = 4;
    const pts = [[dOut + 0.04, yEave - 0.05], [dOut + 0.04, yEave]];
    for (let i = 1; i <= steps; i += 1) {
      const f = i / steps;
      // A curved bow to the slope, as the real vaults have, and a small lap at each course.
      const o = dOut * (1 - f); const y = yEave + (yRidge - yEave) * Math.sin((f * Math.PI) / 2) ** 0.9;
      pts.push([o + dOut * 0.018, y - 0.012], [o, y]);
    }
    for (let i = 1; i <= steps; i += 1) {
      const f = i / steps;
      const o = -dIn * f; const y = yEave + (yRidge - yEave) * Math.sin(((1 - f) * Math.PI) / 2) ** 0.9;
      pts.push([o, y + 0.012], [o - dIn * 0.018, y]);
    }
    pts.push([-dIn - 0.04, yEave], [-dIn - 0.04, yEave - 0.05]);
    ringProfile(roof, hx, hz, pts, { sub: 1.6, roofUV: true });
  };

  // --- the five lotus-bud towers and the pavilions --------------------------------------------------
  // The redented plan: a square with its corners stepped back twice, so that a low sun catches a dozen
  // edges. Seen from any side a tier has many vertical lines where a plain square has two.
  const redent = (h) => {
    const r = h * 0.14;
    const oct = [[h, h * 0.42], [h - r, h * 0.42], [h - r, h * 0.64], [h - 2 * r, h * 0.64], [h - 2 * r, h - 2 * r]];
    const quarter = [...oct, ...oct.slice(0, 4).reverse().map(([a, b]) => [b, a])];
    const out = [];
    for (let q = 0; q < 4; q += 1) {
      const ca = Math.cos((q * Math.PI) / 2); const sa = Math.sin((q * Math.PI) / 2);
      for (const [a, b] of quarter) out.push([a * ca - b * sa, a * sa + b * ca]);
    }
    return out;
  };
  const budRing = (soup, cx, cz, h0, y0, h1, y1, { k = 1, topCap = false, tone = null } = {}) => {
    const A = redent(h0); const B = redent(h1);
    for (let i = 0; i < A.length; i += 1) {
      const j = (i + 1) % A.length;
      const q = [[cx + A[i][0], y0, cz + A[i][1]], [cx + A[j][0], y0, cz + A[j][1]], [cx + B[j][0], y1, cz + B[j][1]], [cx + B[i][0], y1, cz + B[i][1]]];
      const mx = (A[i][0] + A[j][0]) / 2; const mz = (A[i][1] + A[j][1]) / 2;
      const hl = Math.hypot(mx, mz) || 1;
      const dH = h0 - h1; const dY = y1 - y0;
      const hint = [(mx / hl) * dY, dH, (mz / hl) * dY];
      quadT(soup, q, hint, { k, tone });
    }
    if (topCap) {
      soup.face(B.map(([a, b]) => [cx + a, y1, cz + b]), toneInto(cx, y1, cz), [0, 1, 0]);
    }
  };
  // A flame-tipped antefix on a cornice: a small pointed leaf with real thickness, standing on the ledge
  // and leaning a little out. These are what give a tower its bristling, budding outline.
  const antefix = (cx, cz, px, pz, y, hgt) => {
    const dx = px; const dz = pz;
    const l = Math.hypot(dx, dz) || 1;
    const ox = dx / l; const oz = dz / l;
    const sx = -oz; const sz = ox;
    const w = hgt * 0.52; const t = hgt * 0.16;
    const X = cx + px; const Z = cz + pz;
    const base = [
      [X - sx * w - ox * t, y, Z - sz * w - oz * t], [X + sx * w - ox * t, y, Z + sz * w - oz * t],
      [X + sx * w + ox * t, y, Z + sz * w + oz * t], [X - sx * w + ox * t, y, Z - sz * w + oz * t],
    ];
    // It leans in against the tier above, and is rounded in plan, which is what a lotus petal does. A
    // spike leaning out turned the first towers into a crown of thorns.
    const tip = [X - ox * hgt * 0.18, y + hgt, Z - oz * hgt * 0.18];
    const shoulder = (a, b) => [(a[0] + b[0]) / 2 + (tip[0] - a[0]) * 0.22, y + hgt * 0.56, (a[2] + b[2]) / 2 + (tip[2] - a[2]) * 0.22];
    const c0 = toneInto(X, y, Z);
    for (let i = 0; i < 4; i += 1) {
      const a = base[i]; const b = base[(i + 1) % 4];
      const mid = shoulder(a, b);
      const out = [(a[0] + b[0]) / 2 - X, 0.2, (a[2] + b[2]) / 2 - Z];
      stone.face([a, b, mid], c0, out);
      stone.face([a, mid, tip], times(c0, 1.06), out);
      stone.face([b, tip, mid], times(c0, 0.94), out);
    }
  };
  // A tower: a sanctuary body, then corbelled tiers on a convex curve closing to a lotus finial. This
  // curve is the bud: a straight taper reads as a spike, and the first tiers must hardly step in at all.
  const lotusTower = (t, y0) => {
    const { x: cx, z: cz, half, bodyTop, top, tiers } = t;
    const FIN = half * 0.3; // the finial's height
    const budTop = top - FIN;
    budRing(stone, cx, cz, half * 1.07, y0 - 0.2, half * 1.05, y0 + 0.05);
    budRing(stone, cx, cz, half * 1.05, y0 + 0.05, half * 0.98, y0 + 0.11);
    // Pilastered walls.
    budRing(stone, cx, cz, half * 0.98, y0 + 0.11, half * 0.97, bodyTop - 0.14);
    budRing(stone, cx, cz, half * 0.97, bodyTop - 0.14, half * 1.04, bodyTop - 0.06);
    budRing(stone, cx, cz, half * 1.04, bodyTop - 0.06, half * 1.04, bodyTop, { k: 1.08 });
    const heights = [];
    let sum = 0;
    for (let i = 0; i < tiers; i += 1) { const h = 0.885 ** i; heights.push(h); sum += h; }
    const H = budTop - bodyTop;
    const bud = (f) => (1 - f ** 2.4) ** 0.62;
    let y = bodyTop;
    let run = 0;
    for (let i = 0; i < tiers; i += 1) {
      const dy = (heights[i] / sum) * H;
      const f0 = run / sum; const f1 = (run + heights[i]) / sum;
      // The last ring must not close: the finial stands on it.
      const h0 = half * Math.max(0.15, bud(f0) * 0.98); const h1 = half * Math.max(0.15, bud(f1) * 0.98);
      const yA = y; const yC = y + dy * 0.82; const yD = y + dy;
      // A ledge, the tier's wall, its moulding, its cornice.
      const eave = 1.012;
      budRing(stone, cx, cz, h0 * eave, yA, h0 * 0.9, yA + 0.0001);
      budRing(stone, cx, cz, h0 * 0.9, yA, mix(h0, h1, 0.72) * 0.93, yC, { k: 0.86 });
      budRing(stone, cx, cz, mix(h0, h1, 0.72) * 0.93, yC, h1 * eave, yC + (yD - yC) * 0.55, { k: 1.1 });
      budRing(stone, cx, cz, h1 * eave, yC + (yD - yC) * 0.55, h1 * eave, yD, { k: 1.14 });
      // Antefixes: at the four corners and at the middle of each face, seated on the ledge.
      const afH = dy * 0.6;
      const rd = redent(h1);
      for (const idx of [4, 13, 22, 31]) antefix(cx, cz, rd[idx][0], rd[idx][1], yD - 0.003, afH * 0.82);
      for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) antefix(cx, cz, fx * h1, fz * h1, yD - 0.003, afH);
      y = yD;
      run += heights[i];
    }
    // The lotus finial: a stem, a closed bud, its tip, lathed on eight faces.
    const hF = half * 0.13;
    const fin = latheUp([
      [0, budTop - 0.02], [hF * 1.2, budTop - 0.02], [hF * 1.2, budTop + FIN * 0.08], [hF * 0.85, budTop + FIN * 0.18],
      [hF * 1.05, budTop + FIN * 0.3], [hF * 0.92, budTop + FIN * 0.55], [hF * 0.5, budTop + FIN * 0.82], [0, top],
    ], { segments: 8 });
    fin.translate(cx, 0, cz);
    tintVertices(fin, (px, py, pz, out) => { const c = toneInto(px, py, pz); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; });
    extraStone.push(fin);
  };
  const extraStone = [];

  // A door: a dark panel a hair proud, a frame proud of that. There is no opening to cut in a solid wall,
  // and it is the frame's own edge that says hole.
  const DOOR_DARK = [0.012, 0.012, 0.01];
  const doorway = (cx, y0, cz, dx, dz, wide, high) => {
    const sx = -dz; const sz = dx;
    const P = (a, y, out) => [cx + sx * a + dx * out, y, cz + sz * a + dz * out];
    const ON = 0.004;
    stone.face([P(-wide / 2, y0, ON), P(wide / 2, y0, ON), P(wide / 2, y0 + high, ON), P(-wide / 2, y0 + high, ON)], DOOR_DARK, [dx, 0, dz]);
    const f = wide * 0.13;
    const fr = 0.05;
    const frame = (a0, a1, ya, yb) => {
      const q = (o) => [P(a0, ya, o), P(a1, ya, o), P(a1, yb, o), P(a0, yb, o)];
      const col = toneInto(cx + sx * a0, ya, cz + sz * a0);
      stone.face(q(fr), times(col, 1.14), [dx, 0, dz]);
      stone.face([P(a0, ya, 0), P(a0, ya, fr), P(a0, yb, fr), P(a0, yb, 0)], times(col, 0.8), [-sx, 0, -sz]);
      stone.face([P(a1, ya, 0), P(a1, ya, fr), P(a1, yb, fr), P(a1, yb, 0)], times(col, 0.8), [sx, 0, sz]);
      stone.face([P(a0, yb, 0), P(a1, yb, 0), P(a1, yb, fr), P(a0, yb, fr)], times(col, 1.1), [0, 1, 0]);
    };
    frame(-wide / 2 - f, -wide / 2, y0, y0 + high + f);
    frame(wide / 2, wide / 2 + f, y0, y0 + high + f);
    frame(-wide / 2, wide / 2, y0 + high, y0 + high + f);
  };
  // A pediment over a porch: a stepped triangular gable. One closed plate with a frame a touch proud.
  const pediment = (cx, y, cz, dx, dz, wide, high, depth = 0.08) => {
    const sx = -dz; const sz = dx;
    const P = (a, yy, o) => [cx + sx * a + dx * o, yy, cz + sz * a + dz * o];
    const col = toneInto(cx, y, cz);
    const outline = [[-wide / 2, y], [wide / 2, y], [wide * 0.16, y + high * 0.72], [0, y + high], [-wide * 0.16, y + high * 0.72]];
    for (const o of [depth, 0]) stone.face(outline.map(([a, yy]) => P(a, yy, o)), times(col, o ? 1.1 : 0.8), o ? [dx, 0, dz] : [-dx, 0, -dz]);
    for (let i = 0; i < outline.length; i += 1) {
      const a = outline[i]; const b = outline[(i + 1) % outline.length];
      stone.face([P(a[0], a[1], 0), P(b[0], b[1], 0), P(b[0], b[1], depth), P(a[0], a[1], depth)], times(col, 0.92), [Math.sin(0), 0.5, 0]);
    }
    const inner = outline.map(([a, yy]) => [a * 0.68, y + (yy - y) * 0.68 + high * 0.03]);
    stone.face(inner.map(([a, yy]) => P(a, yy, depth + 0.006)), times(col, 0.66), [dx, 0, dz]);
  };
  // A cross-plan pavilion with a truncated stepped tower: the gopuras and corner pavilions. Fewer faces
  // than a bud tower, since there are a couple of dozen of them and they are read from further away.
  const crossRing = (cx, cz, h, armW, y0, y1, h1 = h, armW1 = armW, { k = 1 } = {}) => {
    const cross = (H, W) => [[H, -W], [H, W], [W, W], [W, H], [-W, H], [-W, W], [-H, W], [-H, -W], [-W, -W], [-W, -H], [W, -H], [W, -W]];
    const A = cross(h, armW); const B = cross(h1, armW1);
    for (let i = 0; i < 12; i += 1) {
      const j = (i + 1) % 12;
      const q = [[cx + A[i][0], y0, cz + A[i][1]], [cx + A[j][0], y0, cz + A[j][1]], [cx + B[j][0], y1, cz + B[j][1]], [cx + B[i][0], y1, cz + B[i][1]]];
      const mx = (A[i][0] + A[j][0]) / 2; const mz = (A[i][1] + A[j][1]) / 2;
      // Which way a cross's face looks is the normal of its own edge, not the bearing of its midpoint.
      const ex = A[j][0] - A[i][0]; const ez = A[j][1] - A[i][1];
      let nx = ez; let nz = -ex;
      if (nx * mx + nz * mz < 0 && !(Math.abs(mx) < armW + 1e-6 && Math.abs(mz) < armW + 1e-6)) { nx = -nx; nz = -nz; }
      const l = Math.hypot(nx, nz) || 1;
      quadT(stone, q, [nx / l, (h - h1) * 0.6, nz / l], { k });
    }
    return B;
  };
  const pavilion = (cx, cz, h, y0, height, { tiers = 3, door = [], arm = 0.62 } = {}) => {
    const W = h * arm;
    const bodyH = height * 0.46;
    const yB = y0 + bodyH;
    crossRing(cx, cz, h, W, y0 - 0.03, yB);
    crossRing(cx, cz, h, W, yB, yB + 0.05, h * 1.1, W * 1.1, { k: 1.1 });
    const dy = (height - bodyH - 0.05) / tiers;
    let y = yB + 0.05;
    for (let i = 0; i < tiers; i += 1) {
      const f0 = i / tiers; const f1 = (i + 1) / tiers;
      const h0 = h * mix(1.0, 0.5, f0); const h1 = h * mix(1.0, 0.5, f1);
      crossRing(cx, cz, h0 * 0.95, W * mix(1.0, 0.56, f0) * 0.95, y, y + dy * 0.72, h1 * 0.98, W * mix(1.0, 0.56, f1) * 0.98);
      crossRing(cx, cz, h1 * 0.98, W * mix(1.0, 0.56, f1) * 0.98, y + dy * 0.72, y + dy, h1 * 1.05, W * mix(1.0, 0.56, f1) * 1.05, { k: 1.12 });
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        antefix(cx, cz, ax * h1 * 0.92, az * h1 * 0.92, y + dy - 0.003, dy * 0.56);
      }
      y += dy;
    }
    // The truncated top: the upper tiers have gone from most of these, leaving a flat roof.
    const topW = h * 0.5 * 1.0;
    stone.box(cx - topW * 0.72, y, cz - topW * 0.72, cx + topW * 0.72, y + 0.05, cz + topW * 0.72, toneInto(cx, y, cz));
    for (const [dx, dz] of door) {
      doorway(cx + dx * h, y0 + 0.05, cz + dz * h, dx, dz, h * 0.5, bodyH * 0.66);
      pediment(cx + dx * h, yB + 0.0, cz + dz * h, dx, dz, h * 1.25, bodyH * 0.62);
    }
  };
  // A stair: treads and risers, between two cheek walls. `out` runs away from the building.
  const stair = (cx, cz, dx, dz, a0, y0, a1, y1, halfW, steps) => {
    const sx = -dz; const sz = dx;
    const P = (a, b, y) => [cx + dx * a + sx * b, y, cz + dz * a + sz * b];
    const col = toneInto(cx, mix(y0, y1, 0.5), cz);
    for (let i = 0; i < steps; i += 1) {
      const f0 = i / steps; const f1 = (i + 1) / steps;
      const aA = mix(a0, a1, f0); const aB = mix(a0, a1, f1);
      const yA = mix(y0, y1, f0); const yB = mix(y0, y1, f1);
      stone.face([P(aA, -halfW, yA), P(aA, halfW, yA), P(aA, halfW, yB), P(aA, -halfW, yB)], times(col, 0.74), [dx, 0, dz]);
      stone.face([P(aA, -halfW, yB), P(aA, halfW, yB), P(aB, halfW, yB), P(aB, -halfW, yB)], times(col, 1.12), [0, 1, 0]);
    }
    const CH = Math.abs(y1 - y0) / steps * 1.5 + 0.03;
    const cheekW = Math.max(0.03, halfW * 0.16);
    for (const s of [-1, 1]) {
      const inb = s * halfW; const outb = s * (halfW + cheekW);
      const yb = Math.min(y0, y1) - 0.02;
      const topA0 = P(a0, inb, y0 + CH); const topB0 = P(a0, outb, y0 + CH); const topA1 = P(a1, inb, y1 + CH); const topB1 = P(a1, outb, y1 + CH);
      const c = times(col, 0.96);
      stone.face([P(a0, outb, yb), P(a1, outb, yb), topB1, topB0], c, [sx * s, 0, sz * s]);
      stone.face([P(a0, inb, y0), P(a1, inb, y1), topA1, topA0], c, [-sx * s, 0, -sz * s]);
      stone.face([topA0, topB0, topB1, topA1], times(c, 1.15), [0, 1, 0]);
      stone.face([P(a1, inb, yb), P(a1, outb, yb), topB1, topA1], times(c, 0.84), [dx, 0, dz]);
    }
  };
  const moulded = (rise, drop = 1) => rise.map(([o, y]) => [o * drop, y]);

  // --- the ground: outer bank, island, and an earth crossing on the -Z side ---------------------------
  const GRASS_A = lin(0x4d6432); const GRASS_B = lin(0x5f6f39); const DIRT = lin(0x7f6d4c);
  const groundCol = (x, z) => {
    const n = fbm(x * 0.5 + 3, 2, z * 0.5, 3);
    const n2 = fbm(x * 1.8, 4, z * 1.8 + 8, 2);
    return mix3(mix3(GRASS_A, GRASS_B, sstep(n, 0.35, 0.65)), DIRT, sstep(n2, 0.62, 0.78) * 0.5);
  };
  const OX = 13; const OZ = 14; // the outer edge of the whole base
  const MX = 12.3; const MZ = 13.3; // the moat's outer edge
  const IX = 9.8; const IZ = 10.8; // the island's edge
  const BANK_Y = 0.18;
  const ISLAND_Y = 0.2;
  const gridQuads = (x0, x1, z0, z1, y, cell, skip = null) => {
    const nx = Math.max(1, Math.round((x1 - x0) / cell)); const nz = Math.max(1, Math.round((z1 - z0) / cell));
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nz; j += 1) {
        const xa = mix(x0, x1, i / nx); const xb = mix(x0, x1, (i + 1) / nx);
        const za = mix(z0, z1, j / nz); const zb = mix(z0, z1, (j + 1) / nz);
        if (skip && skip((xa + xb) / 2, (za + zb) / 2)) continue;
        const q = [[xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb]];
        ground.face(q, q.map((c) => groundCol(c[0], c[2])), [0, 1, 0]);
      }
    }
  };
  gridQuads(-OX, OX, MZ, OZ, BANK_Y, 1.1);
  gridQuads(-OX, OX, -OZ, -MZ, BANK_Y, 1.1);
  gridQuads(-OX, -MX, -MZ, MZ, BANK_Y, 1.1);
  gridQuads(MX, OX, -MZ, MZ, BANK_Y, 1.1);
  gridQuads(-IX, IX, -IZ, IZ, ISLAND_Y, 0.82, (x, z) => Math.abs(x) < AK_TIER1.hx - 0.5 && Math.abs(z) < AK_TIER1.hz - 0.5);
  // The earth bank across the east moat: the real temple has one, and only the west has the stone road.
  gridQuads(-0.82, 0.82, -MZ, -IZ, BANK_Y + 0.01, 0.8);
  for (const s of [-1, 1]) {
    ground.face([[s * 0.82, 0.06, -MZ], [s * 0.82, 0.06, -IZ], [s * 0.82, BANK_Y + 0.01, -IZ], [s * 0.82, BANK_Y + 0.01, -MZ]], lin(0x6f6143), [s, 0, 0]);
  }
  // The block's cut edge.
  const SK = lin(0x4f4636);
  ground.face([[-OX, 0, OZ], [OX, 0, OZ], [OX, BANK_Y, OZ], [-OX, BANK_Y, OZ]], SK, [0, 0, 1]);
  ground.face([[-OX, 0, -OZ], [OX, 0, -OZ], [OX, BANK_Y, -OZ], [-OX, BANK_Y, -OZ]], SK, [0, 0, -1]);
  ground.face([[OX, 0, -OZ], [OX, 0, OZ], [OX, BANK_Y, OZ], [OX, BANK_Y, -OZ]], SK, [1, 0, 0]);
  ground.face([[-OX, 0, -OZ], [-OX, 0, OZ], [-OX, BANK_Y, OZ], [-OX, BANK_Y, -OZ]], SK, [-1, 0, 0]);

  // The stepped stone revetments that keep the moat's banks square, as the real ones are.
  const STEPPED_LAT = (x, y, z) => lateriteInto(x, y, z);
  ringProfile(stone, IX, IZ, [[0.34, 0.03], [0.34, 0.1], [0.23, 0.1], [0.23, 0.15], [0.11, 0.15], [0.11, 0.2], [0, 0.2]], { sub: 3, tone: STEPPED_LAT });
  ringProfile(stone, MX, MZ, [[0, BANK_Y], [0, 0.14], [-0.1, 0.14], [-0.1, 0.1], [-0.2, 0.1], [-0.2, 0.03]], { sub: 3, tone: STEPPED_LAT });

  // --- water -----------------------------------------------------------------------------------------
  const WATER_Y = 0.09;
  const water = new Soup();
  const NW = 26;
  const BLUE_A = lin(0x24689f); const BLUE_B = lin(0x2f83b4); const BLUE_C = lin(0x3f97bb);
  const waterRow = (x0, x1, z0, z1) => {
    const nx = Math.max(1, Math.round(((x1 - x0) / (2 * MX)) * NW)); const nz = Math.max(1, Math.round(((z1 - z0) / (2 * MZ)) * NW));
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nz; j += 1) {
        const xa = mix(x0, x1, i / nx); const xb = mix(x0, x1, (i + 1) / nx);
        const za = mix(z0, z1, j / nz); const zb = mix(z0, z1, (j + 1) / nz);
        const q = [[xa, WATER_Y, za], [xb, WATER_Y, za], [xb, WATER_Y, zb], [xa, WATER_Y, zb]];
        const cols = q.map((c) => mix3(mix3(BLUE_A, BLUE_B, fbm(c[0] * 0.3, 1, c[2] * 0.3, 2)), BLUE_C, sstep(fbm(c[0] * 0.9 + 4, 5, c[2] * 0.9, 2), 0.55, 0.7) * 0.5));
        water.face(q, cols, [0, 1, 0], { uv: q.map((c) => [c[0] * 0.5, c[2] * 0.5]) });
      }
    }
  };
  waterRow(-MX, MX, IZ, MZ);
  waterRow(-MX, MX, -MZ, -IZ);
  waterRow(-MX, -IX, -IZ, IZ);
  waterRow(IX, MX, -IZ, IZ);

  // --- the causeway across the moat, on +Z ------------------------------------------------------------
  const CW = 0.62;
  const CY = 0.32;
  const cwyEnd = 13.75;
  stone.box(-CW, 0.02, IZ - 0.1, CW, CY, cwyEnd, toneInto(0, 0.2, 12), {});
  for (let i = 0; i < 6; i += 1) {
    const z0 = IZ + (i / 6) * (cwyEnd - IZ); const z1 = IZ + ((i + 1) / 6) * (cwyEnd - IZ);
    quadT(stone, [[-CW, CY + 0.002, z0], [CW, CY + 0.002, z0], [CW, CY + 0.002, z1], [-CW, CY + 0.002, z1]], [0, 1, 0]);
  }
  // Steps down onto the bank.
  stair(0, 0, 0, 1, cwyEnd, CY, 13.98, BANK_Y, CW * 0.9, 4);
  // A low wall of arches along the sides of the causeway, read from the water.
  for (const s of [-1, 1]) {
    for (let z = IZ + 0.15; z < cwyEnd - 0.2; z += 0.42) {
      const w = 0.13;
      stone.face([[s * (CW + 0.006), WATER_Y, z - w], [s * (CW + 0.006), WATER_Y, z + w], [s * (CW + 0.006), 0.2, z + w * 0.5], [s * (CW + 0.006), 0.2, z - w * 0.5]], DOOR_DARK, [s, 0, 0]);
    }
  }
  // The naga balustrade: a serpent's body as a round rail on short posts, ending in a raised fan of
  // seven hooded heads, the Khmer motif at the temple's entrances.
  const naga = (x, z0, z1, y, dirSign, fan = true) => {
    const railY = y + 0.15;
    const n = Math.round(Math.abs(z1 - z0) / 0.42);
    for (let i = 0; i <= n; i += 1) {
      const z = mix(z0, z1, i / n);
      stone.box(x - 0.028, y - 0.01, z - 0.028, x + 0.028, railY, z + 0.028, toneInto(x, y, z));
    }
    extraStone.push(tintG(bar([x, railY, z0], [x, railY, z1], 0.026, 0.026, 7)));
    if (!fan) return;
    // The fan: exactly seven hooded heads spread from one body, each a flattened neck ending in a
    // rounded head. A single scalloped plate read as a shower head; seven separate shapes read as seven.
    const hub = [x, railY - 0.005, z1 + dirSign * 0.01];
    const H = 7;
    for (let i = 0; i < H; i += 1) {
      const a = (Math.PI * (0.84 - (0.68 * i) / (H - 1)));
      const len = i === 3 ? 0.34 : 0.27 + 0.02 * Math.abs(3 - i);
      const tip = [hub[0] + Math.cos(a) * len * 0.72, hub[1] + Math.sin(a) * len, hub[2] + dirSign * 0.02];
      const mid = [hub[0] + Math.cos(a) * len * 0.42, hub[1] + Math.sin(a) * len * 0.56, hub[2] - dirSign * 0.012];
      const g = tube([hub, mid, tip], [0.02, 0.027, 0.046], { sides: 6, steps: 3, round: 1, frame: () => [0, 0, 1], section: () => [0.55, 1] });
      extraStone.push(tintG(g));
    }
  };
  const tintG = (g) => {
    tintVertices(g, (x, y, z, out) => { const c = toneInto(x, y, z); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; });
    return g;
  };
  for (const s of [-1, 1]) {
    naga(s * (CW - 0.05), IZ + 0.05, cwyEnd - 0.06, CY, 1);
  }

  // --- the outer wall of laterite, with its gates, and the court inside it -----------------------------
  const EW = 9.35; const EZ = 10.35;
  ringProfile(stone, EW, EZ, [[0.03, ISLAND_Y - 0.01], [0.03, 0.26], [0, 0.29], [0, 0.72], [0.035, 0.75], [0.035, 0.79], [-0.11, 0.84], [-0.25, 0.79], [-0.25, 0.75], [-0.215, 0.72], [-0.215, ISLAND_Y - 0.01]], { sub: 1.8, tone: lateriteInto });
  // The west gate is the great one: a long gallery with three towers. The other three are single.
  pavilion(0, EZ - 0.1, 0.92, ISLAND_Y, 1.6, { tiers: 3, door: [[0, 1], [0, -1]] });
  pavilion(-2.7, EZ - 0.1, 0.62, ISLAND_Y, 1.35, { tiers: 2, door: [[0, 1], [0, -1]] });
  pavilion(2.7, EZ - 0.1, 0.62, ISLAND_Y, 1.35, { tiers: 2, door: [[0, 1], [0, -1]] });
  // The gallery that ties them: a roof on two rows of pillars along the wall.
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.75; const x1 = sx * 2.2;
    const zz = EZ - 0.1;
    for (let i = 0; i <= 3; i += 1) {
      const x = mix(x0, x1, i / 3);
      pillar(x, zz + 0.2, ISLAND_Y, 0.82, 0.042);
      pillar(x, zz - 0.2, ISLAND_Y, 0.82, 0.042);
    }
    const a = Math.min(x0, x1); const c = Math.max(x0, x1);
    roof.hexa([[a, 0.82, zz - 0.26], [c, 0.82, zz - 0.26], [c, 0.82, zz + 0.26], [a, 0.82, zz + 0.26]], [[a, 1.1, zz - 0.02], [c, 1.1, zz - 0.02], [c, 1.1, zz + 0.02], [a, 1.1, zz + 0.02]], toneInto(a, 1, zz), {});
    stone.box(a, 0.8, zz - 0.25, c, 0.84, zz + 0.25, toneInto(a, 0.8, zz));
  }
  pavilion(0, -EZ + 0.1, 0.72, ISLAND_Y, 1.4, { tiers: 2, door: [[0, 1], [0, -1]] });
  pavilion(EW - 0.1, 0, 0.62, ISLAND_Y, 1.25, { tiers: 2, door: [[1, 0], [-1, 0]] });
  pavilion(-EW + 0.1, 0, 0.62, ISLAND_Y, 1.25, { tiers: 2, door: [[1, 0], [-1, 0]] });

  // The processional way from the gate to the temple, a raised road with its own naga rail.
  const WAY_Y = 0.36;
  const WW = 0.5;
  const wayZ1 = EZ - 0.8; const wayZ0 = 8.25;
  stone.box(-WW, ISLAND_Y - 0.01, wayZ0, WW, WAY_Y, wayZ1, toneInto(0, 0.3, 9), { skipBottom: true });
  for (let i = 0; i < 3; i += 1) {
    const z0 = mix(wayZ0, wayZ1, i / 3); const z1 = mix(wayZ0, wayZ1, (i + 1) / 3);
    quadT(stone, [[-WW, WAY_Y + 0.002, z0], [WW, WAY_Y + 0.002, z0], [WW, WAY_Y + 0.002, z1], [-WW, WAY_Y + 0.002, z1]], [0, 1, 0]);
  }
  for (const s of [-1, 1]) naga(s * (WW - 0.04), wayZ0 + 0.06, wayZ1 - 0.04, WAY_Y, 1);
  stair(0, 0, 0, 1, wayZ1, WAY_Y, wayZ1 + 0.25, ISLAND_Y, WW * 0.8, 3);
  // Two libraries, and in front of them the two pools that give the famous reflection.
  for (const s of [-1, 1]) {
    const lx = s * 3.25; const lz = 9.0;
    stone.box(lx - 0.68, ISLAND_Y - 0.01, lz - 0.48, lx + 0.68, 0.46, lz + 0.48, toneInto(lx, 0.3, lz), { skipBottom: true });
    pavilion(lx, lz, 0.56, 0.46, 0.98, { tiers: 2, door: [[0, 1], [-s, 0]] });
    stair(lx, lz, 0, 1, 0.48, 0.46, 0.78, ISLAND_Y, 0.2, 4);
    stair(0, lz, -s, 0, -s * lx + 0.68 * 1, 0.46, -s * lx + 0.98, ISLAND_Y, 0.16, 4);
    // The pool: a stepped stone edge and a sheet of water. Its surface is below the lawn.
    const px = s * 4.3; const pz = 7.75; const pw = 1.4; const pd = 0.55;
    ringProfile(stone, pw, pd, [[0.06, ISLAND_Y + 0.02], [0.03, ISLAND_Y + 0.02], [0, ISLAND_Y], [0, ISLAND_Y - 0.03]], { sub: 1, cx: px, cz: pz, tone: STEPPED_LAT });
    const q = [[px - pw, ISLAND_Y + 0.006, pz - pd], [px + pw, ISLAND_Y + 0.006, pz - pd], [px + pw, ISLAND_Y + 0.006, pz + pd], [px - pw, ISLAND_Y + 0.006, pz + pd]];
    water.face(q, BLUE_B, [0, 1, 0], { uv: q.map((c) => [c[0] * 0.5, c[2] * 0.5]) });
  }

  // --- tier one: the first gallery, with its colonnade and its reliefs ----------------------------------
  const T1 = AK_TIER1;
  const FY = T1.y1;
  ringProfile(stone, T1.hx, T1.hz, moulded([
    [0.1, T1.y0 - 0.01], [0.1, T1.y0 + 0.05], [0.04, T1.y0 + 0.07], [0.02, T1.y0 + 0.12], [0.06, T1.y0 + 0.15], [0.06, T1.y0 + 0.18],
    [0, T1.y0 + 0.2], [0, FY - 0.09], [0.05, FY - 0.06], [0.05, FY - 0.02], [0.02, FY], [-0.2, FY],
  ]), { sub: 2.6 });
  // Second-level floor: the first court.
  const WALL_D = 1.32; // the gallery wall's outer face, in from the terrace edge
  floorRing(T1.hx - 0.02, T1.hz - 0.02, T1.hx - WALL_D - 0.02, T1.hz - WALL_D - 0.02, FY, { cell: 1.7 });
  floorRing(T1.hx - WALL_D - 0.1, T1.hz - WALL_D - 0.1, AK_TIER2.hx - 0.02, AK_TIER2.hz - 0.02, FY, { cell: 1.7 });
  // The wall behind the columns carries the reliefs; a plain back on the court side.
  const WA = T1.hx - WALL_D; const WB = T1.hz - WALL_D;
  const G1_TOP = 1.54;
  wallRect(WA, WB, FY, G1_TOP, 'relief', 3.2);
  ringProfile(stone, WA - 0.1, WB - 0.1, [[0.1, G1_TOP], [0.1, G1_TOP + 0.01], [0, G1_TOP + 0.01], [0, FY]], { sub: 1.7, k: 0.9 });
  const onAxisOrCorner = (hx, hz, gap) => (x, z) => {
    const a = Math.abs(x); const c = Math.abs(z);
    return (a < gap && c > hz - 0.01) || (c < gap && a > hx - 0.01) || (a > hx - gap && c > hz - gap);
  };
  const G1_OUT = T1.hx - 0.5; const G1_OUTZ = T1.hz - 0.5;
  colonnade(G1_OUT, G1_OUTZ, FY, G1_TOP - 0.02, 0.46, 0.058, onAxisOrCorner(G1_OUT, G1_OUTZ, 1.0));
  // The architrave, the long lintel the pillars carry.
  ringProfile(stone, G1_OUT, G1_OUTZ, [[0.075, G1_TOP - 0.05], [0.075, G1_TOP + 0.04], [0, G1_TOP + 0.05], [-0.075, G1_TOP + 0.04], [-0.075, G1_TOP - 0.05], [0.075, G1_TOP - 0.05]], { sub: 2.2, k: 1.08 });
  // Low outer half-gallery: short pillars carrying a lean-to.
  const G1E = T1.hx - 0.06; const G1EZ = T1.hz - 0.06;
  colonnade(G1E, G1EZ, FY, 1.1, 0.46, 0.04, onAxisOrCorner(G1E, G1EZ, 1.0), true);
  ringProfile(stone, G1E, G1EZ, [[0.055, 1.08], [0.055, 1.14], [-0.055, 1.14], [-0.055, 1.08], [0.055, 1.08]], { sub: 2.2 });
  ringProfile(roof, G1E, G1EZ, [[0.04, 1.14], [0.04, 1.16], [-0.1, 1.24], [-0.24, 1.33], [-0.44, 1.5]], { sub: 2.2, roofUV: true });
  vault(WA + 0.4, WB + 0.4, 0.34, 0.46, G1_TOP + 0.075, 2.12);

  // Pavilions: a great one on each axis, three on the west front, and one at each corner.
  const PF = T1.hz - 0.62;
  pavilion(0, PF, 1.02, FY, 2.25, { tiers: 3, door: [[0, 1], [0, -1]] });
  pavilion(-2.95, PF, 0.62, FY, 1.75, { tiers: 2, door: [[0, 1], [0, -1]] });
  pavilion(2.95, PF, 0.62, FY, 1.75, { tiers: 2, door: [[0, 1], [0, -1]] });
  pavilion(0, -PF, 0.9, FY, 2.15, { tiers: 3, door: [[0, 1], [0, -1]] });
  const PS = T1.hx - 0.62;
  pavilion(PS, 0, 0.82, FY, 2.05, { tiers: 3, door: [[1, 0], [-1, 0]] });
  pavilion(-PS, 0, 0.82, FY, 2.05, { tiers: 3, door: [[1, 0], [-1, 0]] });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pavilion(sx * PS, sz * PF, 0.78, FY, 1.95, { tiers: 3, door: [[sx, 0], [0, sz]], arm: 0.86 });
  // Steps on the three sides without the cross terrace.
  stair(0, 0, 0, -1, T1.hz + 0.08, FY, T1.hz + 0.6, T1.y0, 0.36, 7);
  stair(0, 0, 1, 0, T1.hx + 0.08, FY, T1.hx + 0.6, T1.y0, 0.36, 7);
  stair(0, 0, -1, 0, T1.hx + 0.08, FY, T1.hx + 0.6, T1.y0, 0.36, 7);
  // The cross-shaped terrace in front of the west entrance, with the naga along its edge, and the steps.
  const TR_Y = 0.55;
  stone.box(-0.8, T1.y0 - 0.01, T1.hz - 0.05, 0.8, TR_Y, wayZ0 + 0.04, toneInto(0, 0.4, 7.2), { skipBottom: true });
  stone.box(-1.75, T1.y0 - 0.01, 7.0, 1.75, TR_Y, 7.72, toneInto(1, 0.4, 7.4), { skipBottom: true });
  for (const [x0, z0, x1, z1] of [[-0.8, 6.4, 0.8, 7.0], [-1.75, 7.0, 1.75, 7.72], [-0.8, 7.72, 0.8, wayZ0]]) {
    quadT(stone, [[x0, TR_Y + 0.002, z0], [x1, TR_Y + 0.002, z0], [x1, TR_Y + 0.002, z1], [x0, TR_Y + 0.002, z1]], [0, 1, 0]);
  }
  stair(0, 0, 0, 1, wayZ0 - 0.02, TR_Y, wayZ0 + 0.0, WAY_Y, WW, 2);
  stair(0, 7.36, 1, 0, 1.75, TR_Y, 2.1, T1.y0, 0.25, 4);
  stair(0, 7.36, -1, 0, 1.75, TR_Y, 2.1, T1.y0, 0.25, 4);
  for (const s of [-1, 1]) naga(s * 0.76, wayZ0 - 0.02, 7.74, TR_Y, 1, false);

  // --- tier two ---------------------------------------------------------------------------------------
  const T2 = AK_TIER2;
  ringProfile(stone, T2.hx, T2.hz, [
    [0.06, T2.y0 - 0.01], [0.06, T2.y0 + 0.07], [0.02, T2.y0 + 0.1], [0, T2.y0 + 0.16], [0.03, T2.y0 + 0.2],
    [0, T2.y0 + 0.24], [0, T2.y1 - 0.14], [0.05, T2.y1 - 0.1], [0.05, T2.y1 - 0.05], [0.03, T2.y1], [-0.12, T2.y1],
  ], { sub: 2.2 });
  const Y2 = T2.y1;
  const G2_TOP = 2.34;
  // The outer wall with its balustered false windows, and a plain inner aisle on pillars.
  ringProfile(stone, T2.hx - 0.12, T2.hz - 0.12, [[0.012, Y2], [0.012, Y2 + 0.08], [0, Y2 + 0.09], [0, G2_TOP - 0.1], [0.012, G2_TOP - 0.09], [0.012, G2_TOP], [-0.16, G2_TOP], [-0.16, Y2]], { sub: 1.7 });
  wallRect(T2.hx - 0.12 + 0.0145, T2.hz - 0.12 + 0.0145, Y2 + 0.1, G2_TOP - 0.1, 'windows', 3);
  const G2I = T2.hx - 0.98; const G2IZ = T2.hz - 0.98;
  colonnade(G2I, G2IZ, Y2, G2_TOP - 0.02, 0.42, 0.05, onAxisOrCorner(G2I, G2IZ, 0.85));
  ringProfile(stone, G2I, G2IZ, [[0.065, G2_TOP - 0.05], [0.065, G2_TOP + 0.03], [-0.065, G2_TOP + 0.03], [-0.065, G2_TOP - 0.05], [0.065, G2_TOP - 0.05]], { sub: 2 });
  vault(T2.hx - 0.54, T2.hz - 0.54, 0.46, 0.46, G2_TOP + 0.02, 2.82);
  floorRing(T2.hx - 0.14, T2.hz - 0.14, AK_TIER3.hx - 0.02, AK_TIER3.hz - 0.02, Y2, { cell: 1.1 });
  const P2 = T2.hz - 0.52; const P2X = T2.hx - 0.52;
  pavilion(0, P2, 0.78, Y2, 2.05, { tiers: 3, door: [[0, 1], [0, -1]] });
  pavilion(0, -P2, 0.78, Y2, 2.05, { tiers: 3, door: [[0, 1], [0, -1]] });
  pavilion(P2X, 0, 0.78, Y2, 2.05, { tiers: 3, door: [[1, 0], [-1, 0]] });
  pavilion(-P2X, 0, 0.78, Y2, 2.05, { tiers: 3, door: [[1, 0], [-1, 0]] });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pavilion(sx * P2X, sz * P2, 0.66, Y2, 2.2, { tiers: 3, door: [[sx, 0], [0, sz]] });
  // Each axis climbs from the first court.
  stair(0, 0, 0, 1, T2.hz + 0.05, Y2, T2.hz + 0.52, FY, 0.34, 10);
  stair(0, 0, 0, -1, T2.hz + 0.05, Y2, T2.hz + 0.52, FY, 0.34, 10);
  stair(0, 0, 1, 0, T2.hx + 0.05, Y2, T2.hx + 0.52, FY, 0.34, 10);
  stair(0, 0, -1, 0, T2.hx + 0.05, Y2, T2.hx + 0.52, FY, 0.34, 10);
  // The cruciform gallery that joins the west entrance to the second tier: pillars and a pitched roof.
  {
    const crossGallery = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / L; const dz = (bz - az) / L;
      const sx = -dz; const sz = dx;
      const n = Math.max(1, Math.round(L / 0.42));
      for (let i = 0; i <= n; i += 1) {
        const px = mix(ax, bx, i / n); const pz = mix(az, bz, i / n);
        for (const s of [-1, 1]) pillar(px + sx * s * 0.26, pz + sz * s * 0.26, FY, 1.22, 0.04);
      }
      const P = (t, off, y) => [ax + dx * t + sx * off, y, az + dz * t + sz * off];
      stone.hexa([P(0, -0.3, 1.2), P(L, -0.3, 1.2), P(L, 0.3, 1.2), P(0, 0.3, 1.2)], [P(0, -0.3, 1.26), P(L, -0.3, 1.26), P(L, 0.3, 1.26), P(0, 0.3, 1.26)], toneInto(ax, 1.2, az));
      roof.face([P(0, -0.33, 1.26), P(L, -0.33, 1.26), P(L, 0, 1.62), P(0, 0, 1.62)], toneInto(ax, 1.4, az), [sx * -1, 0.7, sz * -1], { uv: [[0, 0], [L, 0], [L, 1], [0, 1]] });
      roof.face([P(0, 0.33, 1.26), P(L, 0.33, 1.26), P(L, 0, 1.62), P(0, 0, 1.62)], toneInto(ax, 1.4, az), [sx, 0.7, sz], { uv: [[0, 0], [L, 0], [L, 1], [0, 1]] });
    };
    crossGallery(0, T1.hz - 1.5, 0, T2.hz + 0.55);
    crossGallery(-2.2, 4.95, 2.2, 4.95);
  }

  // --- tier three: the Bakan, a steep stepped mountain carrying the five towers --------------------------
  const T3 = AK_TIER3;
  const Y3 = T3.y1;
  ringProfile(stone, T3.hx, T3.hz, [
    [0.05, T3.y0 - 0.01], [0.05, T3.y0 + 0.08], [0, T3.y0 + 0.12], [-0.02, T3.y0 + 0.5], [0.03, T3.y0 + 0.55], [0.03, T3.y0 + 0.6],
    [-0.14, T3.y0 + 0.62], [-0.16, T3.y0 + 1.1], [-0.11, T3.y0 + 1.15], [-0.11, T3.y0 + 1.2],
    [-0.28, T3.y0 + 1.22], [-0.3, Y3 - 0.1], [-0.25, Y3 - 0.05], [-0.25, Y3], [-0.4, Y3],
  ], { sub: 1.4 });
  floorRing(AK_RING, AK_RING, 0.02, 0.02, Y3, { cell: 1.2 });
  // Three stairs a side, twelve in all, as the real one has; the steepest in the temple.
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (const off of [-1.05, 0, 1.05]) {
      const cx = -dz * off; const cz = dx * off;
      stair(cx, cz, dx, dz, T3.hx - 0.24, Y3 + 0.01, T3.hx + 0.48, T3.y0, off === 0 ? 0.2 : 0.14, 22);
    }
  }
  // The topmost gallery: outer wall with windows, inner pillars, cross galleries to the central tower.
  const G3_TOP = 4.3;
  const R3 = AK_RING;
  ringProfile(stone, R3, R3, [[0.012, Y3], [0.012, Y3 + 0.07], [0, Y3 + 0.08], [0, G3_TOP - 0.08], [0.012, G3_TOP - 0.07], [0.012, G3_TOP], [-0.14, G3_TOP], [-0.14, Y3]], { sub: 1.3 });
  wallRect(R3 + 0.0145, R3 + 0.0145, Y3 + 0.09, G3_TOP - 0.09, 'windows', 2.4);
  const R3I = R3 - 0.62;
  colonnade(R3I, R3I, Y3, G3_TOP - 0.02, 0.36, 0.042, onAxisOrCorner(R3I, R3I, 0.55));
  ringProfile(stone, R3I, R3I, [[0.055, G3_TOP - 0.04], [0.055, G3_TOP + 0.03], [-0.055, G3_TOP + 0.03], [-0.055, G3_TOP - 0.04], [0.055, G3_TOP - 0.04]], { sub: 1.6 });
  vault(R3 - 0.31, R3 - 0.31, 0.3, 0.32, G3_TOP + 0.02, 4.72);
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    pavilion(dx * (R3 - 0.34), dz * (R3 - 0.34), 0.52, Y3, 1.5, { tiers: 3, door: dz ? [[0, dz]] : [[dx, 0]] });
    // The arm from this gate to the central sanctuary.
    const sx = -dz; const sz = dx;
    const a = 0.8; const c = R3 - 0.72;
    const n = Math.round((c - a) / 0.3);
    for (let i = 0; i <= n; i += 1) {
      const t = mix(a, c, i / n);
      for (const s of [-1, 1]) pillar(dx * t + sx * s * 0.2, dz * t + sz * s * 0.2, Y3, 4.2, 0.036);
    }
    const P = (t, off, y) => [dx * t + sx * off, y, dz * t + sz * off];
    stone.hexa([P(a, -0.24, 4.18), P(c, -0.24, 4.18), P(c, 0.24, 4.18), P(a, 0.24, 4.18)], [P(a, -0.24, 4.24), P(c, -0.24, 4.24), P(c, 0.24, 4.24), P(a, 0.24, 4.24)], toneInto(dx * a, 4.2, dz * a));
    roof.face([P(a, -0.27, 4.24), P(c, -0.27, 4.24), P(c, 0, 4.62), P(a, 0, 4.62)], toneInto(dx, 4.4, dz), [-sx, 0.7, -sz], { uv: [[0, 0], [c - a, 0], [c - a, 1], [0, 1]] });
    roof.face([P(a, 0.27, 4.24), P(c, 0.27, 4.24), P(c, 0, 4.62), P(a, 0, 4.62)], toneInto(dx, 4.4, dz), [sx, 0.7, sz], { uv: [[0, 0], [c - a, 0], [c - a, 1], [0, 1]] });
  }

  // --- exactly five towers -------------------------------------------------------------------------------
  for (const t of ANGKOR_TOWERS) {
    lotusTower(t, Y3 + 0.01);
    // Each opens in the directions it has galleries; the central one on all four sides, in porches.
    const dirs = t.name === 'central' ? [[0, 1], [0, -1], [1, 0], [-1, 0]] : [[Math.sign(t.x), 0], [0, Math.sign(t.z)]];
    for (const [dx, dz] of dirs) {
      const h = t.half;
      const big = t.name === 'central';
      const pw = h * 0.62; const po = big ? 0.42 : 0.22; const py = t.bodyTop - Y3;
      const hi = Y3 + py * 0.72;
      const sx = -dz; const sz = dx;
      const P = (a, o, y) => [t.x + sx * a + dx * (h * 0.9 + o), y, t.z + sz * a + dz * (h * 0.9 + o)];
      stone.hexa([P(-pw, -0.1, Y3), P(pw, -0.1, Y3), P(pw, po, Y3), P(-pw, po, Y3)], [P(-pw, -0.1, hi), P(pw, -0.1, hi), P(pw, po, hi), P(-pw, po, hi)], toneInto(t.x, Y3 + 0.3, t.z), { skipBottom: true });
      doorway(P(0, po, 0)[0], Y3 + 0.03, P(0, po, 0)[2], dx, dz, pw * 0.86, (hi - Y3) * 0.72);
      pediment(P(0, po, 0)[0], hi, P(0, po, 0)[2], dx, dz, pw * 2.5, (t.bodyTop - hi) * 0.95, 0.1);
      roof.face([P(-pw * 1.1, -0.1, hi), P(pw * 1.1, -0.1, hi), P(0, po * 0.5, hi + (t.bodyTop - hi) * 0.9), P(0, -0.1, hi + (t.bodyTop - hi) * 0.9)], toneInto(t.x, hi, t.z), [0, 1, 0], { uv: [[0, 0], [1, 0], [0.5, 1], [0.5, 1]] });
    }
  }

  // --- planting ---------------------------------------------------------------------------------------------
  const TRUNK = 0x57473a;
  const FROND = [lin(0x4a7030), lin(0x5b7f37), lin(0x3c6028)];
  const CANOPY = [lin(0x3f6a2c), lin(0x4d7a33), lin(0x35592a)];
  const clearOfBuildings = (x, z) => {
    const ax = Math.abs(x); const az = Math.abs(z);
    if (ax < T1.hx + 1.1 && az < T1.hz + 0.9) return false;
    if (ax > EW - 0.5 || az > EZ - 0.6) return false;
    if (ax < 1.0) return false;
    if (z > 6 && ax < 6) return false;
    return true;
  };
  const sugarPalm = (x, z, H) => {
    const lean = [(rng() - 0.5) * 0.25, (rng() - 0.5) * 0.25];
    const top = [x + lean[0], ISLAND_Y + H, z + lean[1]];
    plants.push({ geometry: tube([[x, ISLAND_Y - 0.03, z], [x + lean[0] * 0.5, ISLAND_Y + H * 0.5, z + lean[1] * 0.5], top], [0.06, 0.042, 0.04], { sides: 6, steps: 4, round: 0 }), color: TRUNK });
    const soup = new Soup();
    const n = 12;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + rng();
      const el = -0.2 + rng() * 1.2;
      const d = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
      const len = 0.38 + rng() * 0.22;
      const s = norm(cross(d, [0, 1, 0]));
      // A fan leaf: a thin rounded wedge.
      const w = len * 0.42;
      const col = FROND[Math.floor(rng() * 3)];
      const up = norm(cross(s, d));
      const a0 = add(top, scl(up, 0.006));
      const f = (t, side) => add(add(add(top, scl(d, len * t)), scl(s, side * w * Math.sin(t * Math.PI * 0.72))), scl([0, -1, 0], t * t * len * 0.28));
      soup.face([a0, f(0.55, 1), f(1, 0.6), f(0.55, 0)], col, up);
      soup.face([a0, f(0.55, 0), f(1, -0.6), f(0.55, -1)], times(col, 0.86), up);
      soup.face([a0, f(0.55, 0), f(1, 0.6), f(0.55, 1)], times(col, 0.9), scl(up, -1));
      soup.face([a0, f(0.55, -1), f(1, -0.6), f(0.55, 0)], times(col, 0.9), scl(up, -1));
    }
    plants.push({ geometry: soup.geometry(), keepColor: true });
  };
  const broadTree = (x, z, H, R) => {
    plants.push({ geometry: tube([[x, ISLAND_Y - 0.03, z], [x + 0.03, ISLAND_Y + H * 0.5, z - 0.02], [x, ISLAND_Y + H * 0.8, z]], [0.1, 0.07, 0.05], { sides: 6, steps: 4, round: 0 }), color: TRUNK });
    const puffs = R > 0.3 ? 7 : 4;
    for (let i = 0; i < puffs; i += 1) {
      const a = (i / puffs) * 6.283 + rng();
      const rr = i === 0 ? 0 : R * 0.55;
      const r = R * (i === 0 ? 0.74 : 0.5 + rng() * 0.16);
      const cx = x + Math.cos(a) * rr; const cz = z + Math.sin(a) * rr; const cy = ISLAND_Y + H * (i === 0 ? 1 : 0.88 + rng() * 0.18);
      const g = new THREE.IcosahedronGeometry(1, 1);
      const P = g.attributes.position; const Nn = g.attributes.normal;
      const col = new Float32Array(P.count * 3);
      const base = CANOPY[Math.floor(rng() * 3)];
      const seed = rng() * 40;
      for (let v = 0; v < P.count; v += 1) {
        const d = norm([P.getX(v), P.getY(v), P.getZ(v)]);
        const leaf = smoothNoise3(d[0] * 3 + seed, d[1] * 3, d[2] * 3);
        const k = 0.85 + leaf * 0.34;
        P.setXYZ(v, cx + d[0] * r * k, cy + d[1] * r * k * 0.82, cz + d[2] * r * k);
        Nn.setXYZ(v, d[0], d[1], d[2]);
        const c = times(base, (0.55 + 0.6 * (d[1] * 0.5 + 0.5)) * (0.65 + leaf * 0.75));
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      plants.push({ geometry: g, keepColor: true });
    }
  };
  let planted = 0;
  let palms = 0;
  for (let i = 0; i < 300 && planted < 24; i += 1) {
    const x = (rng() * 2 - 1) * (EW - 0.5);
    const z = (rng() * 2 - 1) * (EZ - 0.6);
    if (!clearOfBuildings(x, z)) continue;
    planted += 1;
    if (palms < 15 && (planted < 9 ? false : true)) { palms += 1; sugarPalm(x, z, 1.7 + rng() * 1.2); } else broadTree(x, z, 1.05 + rng() * 0.75, 0.42 + rng() * 0.36);
  }
  // A few more out on the bank beyond the moat.
  for (let i = 0; i < 9; i += 1) {
    const side = i % 4;
    const t = (rng() * 2 - 1);
    const x = side < 2 ? t * 12 : (side === 2 ? -1 : 1) * 12.65;
    const z = side < 2 ? (side === 0 ? -1 : 1) * 13.65 : t * 13;
    if (Math.abs(x) < 1.5) continue;
    broadTree(x, z, 0.8 + rng() * 0.6, 0.24 + rng() * 0.12);
  }

  // --- materials -----------------------------------------------------------------------------------------------
  const stoneTile = akStoneTile(11);
  const stoneMesh = mesh(mergeParts([{ geometry: stone.geometry(), keepColor: true }, ...extraStone.map((geometry) => ({ geometry, keepColor: true }))]), standard({ vertexColors: true, map: stoneTile, bumpMap: stoneTile, bumpScale: 0.35, roughness: 0.96, metalness: 0 }));
  const roofTile = akRoofTile(12);
  const roofMesh = mesh(roof.geometry(), standard({ vertexColors: true, map: roofTile, bumpMap: roofTile, bumpScale: 0.4, roughness: 0.96, metalness: 0 }));
  const strips = akWallStrips();
  strips.wrapS = THREE.RepeatWrapping;
  const wallMesh = mesh(walls.geometry(), standard({ vertexColors: true, map: strips, bumpMap: strips, bumpScale: 0.6, emissive: 0x151510, emissiveMap: strips, roughness: 0.95, metalness: 0 }));
  const groundTile = akGrassTile(21);
  const groundMesh = mesh(mergeParts([{ geometry: ground.geometry(), keepColor: true }, ...plants]), standard({ vertexColors: true, map: groundTile, roughness: 1, metalness: 0 }));
  const waterTile = rippleTile(31);
  const waterMesh = mesh(water.geometry(), standard({ vertexColors: true, map: waterTile, roughness: 0.28, metalness: 0.05 }));
  waterMesh.castShadow = false;
  return group(stoneMesh, roofMesh, wallMesh, groundMesh, waterMesh);
}

// Fine wind ripple as a near-white tile, multiplied by the blue a vertex tint gives it.
function rippleTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d2d6da';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2200; i += 1) {
      const x = rng() * w; const y = rng() * h; const len = 6 + rng() * 26;
      const light = rng() > 0.42;
      const v = light ? 245 + rng() * 10 : 150 + rng() * 34;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.22 + rng() * 0.5})`;
      ctx.lineWidth = 0.7 + rng() * 1.5;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(x + ox - len / 2, y + oy);
          ctx.quadraticCurveTo(x + ox, y + oy - 1.8 - rng() * 1.5, x + ox + len / 2, y + oy);
          ctx.stroke();
        }
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Near-white grass and scrub for any ground carried by its vertex colour.
function akGrassTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i += 1) {
      const x = rng() * w; const y = rng() * h;
      const v = 150 + rng() * 105;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.92},${0.2 + rng() * 0.5})`;
      ctx.fillRect(x, y, 1 + rng() * 2.6, 1 + rng() * 2.6);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Great Zimbabwe: the Great Enclosure, 1/12
// ---------------------------------------------------------------------------

// Real figures in feet over 12: the wall stands up to 36ft and is about 17ft thick at its base and 6.5ft
// at its top, the conical tower is about 30ft tall and 18ft across its base. The plan's compass is turned
// so that the students' first view shows both the entrance and the high wall: +Z is about east-north-east
// on the real site, with the high chevron wall to the south-east on the left and the north entrance on
// the right. `ZW_DOOR` is the one deliberate widening: the real openings are a few feet wide and at 1/12
// a student could not see through one, so they are about 11ft here, and the passage about 6ft.
const ZW_SCALE = 12;
const ZW_BASE_T = 17 / ZW_SCALE;
const ZW_TOP_T = 6.5 / ZW_SCALE;
const ZW_MAX_H = 36 / ZW_SCALE;
const ZW_LOW_H = 19 / ZW_SCALE;
const ZW_OUTER_SHARE = 0.68; // how much of the taper is taken by the outer face
const ZW_HIGH_AT = 298; // bearing round the plan, in degrees, of the high wall

const deg = (d) => (d * Math.PI) / 180;
function zwMidRadius(theta) {
  // An oval, a little squarer on one side, as the real plan is.
  const a = 11.3; const b = 9.5;
  const s = Math.sin(theta); const c = Math.cos(theta);
  const r = (a * b) / Math.hypot(b * s, a * c);
  return r + 0.32 * Math.sin(2 * theta + 0.7) * 0.7 + 0.22 * Math.sin(3 * theta - 0.4) + 0.12 * Math.sin(5 * theta + 1.2);
}
const zwMid = (theta) => { const r = zwMidRadius(theta); return [Math.sin(theta) * r, Math.cos(theta) * r]; };
function zwHeight(theta) {
  let d = ((theta * 180) / Math.PI - ZW_HIGH_AT) % 360;
  if (d > 180) d -= 360; if (d < -180) d += 360;
  return ZW_LOW_H + (ZW_MAX_H - ZW_LOW_H) * Math.exp(-((d / 58) ** 2));
}

// The wall's section, stated: how much it tapers and how far it leans, at its highest.
export function zimbabweWallReport() {
  const taper = ZW_BASE_T - ZW_TOP_T;
  const outer = taper * ZW_OUTER_SHARE;
  const inner = taper * (1 - ZW_OUTER_SHARE);
  const lean = (outer - inner) / 2;
  return {
    heightRealFt: ZW_MAX_H * ZW_SCALE,
    baseThickRealFt: ZW_BASE_T * ZW_SCALE,
    topThickRealFt: ZW_TOP_T * ZW_SCALE,
    outerFaceBatterDegrees: (Math.atan(outer / ZW_MAX_H) * 180) / Math.PI,
    innerFaceBatterDegrees: (Math.atan(inner / ZW_MAX_H) * 180) / Math.PI,
    centreLineLeanInwardDegrees: (Math.atan(lean / ZW_MAX_H) * 180) / Math.PI,
  };
}

// Dry-laid granite: long thin courses, set without mortar, with a dark gap at every joint. Near white,
// so the wall's vertex colour carries the stone and this carries the coursing. The joints are the darkest
// thing on the tile and that is the point: there is nothing in them.
function zwCourseTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#17140f';
    ctx.fillRect(0, 0, w, h);
    const COURSES = 34;
    let y = 0;
    for (let r = 0; r < COURSES; r += 1) {
      const rowH = r === COURSES - 1 ? h - y : (h / COURSES) * (0.8 + rng() * 0.4);
      let x = -rng() * 40;
      while (x < w) {
        const len = 34 + rng() * 74;
        const v = 196 + rng() * 54;
        const tint = rng();
        ctx.fillStyle = `rgb(${v},${v * (tint < 0.3 ? 0.96 : 0.985)},${v * (tint < 0.3 ? 0.88 : 0.95)})`;
        // Each block a hair short and a hair low of its cell: that gap is the joint.
        const gapX = 1.6 + rng() * 2; const gapY = 1.8 + rng() * 1.6;
        const top = y + gapY * (rng() * 0.5);
        const hgt = rowH - gapY;
        ctx.fillRect(x, top, len - gapX, hgt);
        if (x + len > w) ctx.fillRect(x - w, top, len - gapX, hgt);
        // A slightly weathered upper arris.
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(x, top, len - gapX, 1.6);
        ctx.fillStyle = 'rgba(30,24,16,0.2)';
        ctx.fillRect(x, top + hgt - 1.4, len - gapX, 1.4);
        x += len;
      }
      y += rowH;
    }
    // Lichen and grit, irregular, over stone and gap alike.
    for (let i = 0; i < 620; i += 1) {
      const bx = rng() * w; const by = rng() * h; const R = 2 + rng() * 14;
      const orange = rng() > 0.62;
      ctx.fillStyle = orange ? `rgba(196,150,62,${0.05 + rng() * 0.1})` : `rgba(32,30,24,${0.03 + rng() * 0.09})`;
      for (let k = 0; k < 8; k += 1) {
        ctx.beginPath();
        ctx.arc(bx + (rng() - 0.5) * R * 2, by + (rng() - 0.5) * R * 2, 0.7 + rng() * R * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (let i = 0; i < 5000; i += 1) {
      const v = 70 + rng() * 130;
      ctx.fillStyle = `rgba(${v},${v * 0.97},${v * 0.88},${0.08 + rng() * 0.18})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// The chevron band: blocks set on the slant, one rank leaning each way, so the joints draw a zigzag,
// with a level course above and below it. At the wall the band is the only ornament on the building.
function zwChevronTile(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(1024, 256, (ctx, w, h) => {
    // The ground of the band is ordinary coursing, the same stone as the wall it sits in.
    ctx.fillStyle = '#14110c';
    ctx.fillRect(0, 0, w, h);
    const COURSES = 8;
    for (let r = 0; r < COURSES; r += 1) {
      const y = (r / COURSES) * h; const rowH = h / COURSES;
      let x = -rng() * 40;
      while (x < w) {
        const len = 36 + rng() * 60;
        const v = 196 + rng() * 50;
        ctx.fillStyle = `rgb(${v},${v * 0.98},${v * 0.92})`;
        ctx.fillRect(x, y + 1.5, len - 3, rowH - 3);
        if (x + len > w) ctx.fillRect(x - w, y + 1.5, len - 3, rowH - 3);
        x += len;
      }
    }
    // Two parallel zigzags of blocks set on the slant. PERIOD divides the width exactly, so it tiles.
    const PERIOD = 128;
    const zig = (y0, y1, phase, wide) => {
      for (let i = -1; i <= w / PERIOD + 1; i += 1) {
        for (const half of [0, 1]) {
          const xa = i * PERIOD + phase + (half * PERIOD) / 2;
          const xb = xa + PERIOD / 2;
          const ya = half ? y0 : y1; const yb = half ? y1 : y0;
          // The dark bed under the rank, then the slanted blocks with a gap between each.
          ctx.strokeStyle = '#100d09';
          ctx.lineWidth = wide + 6;
          ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
          const N = 4;
          for (let k = 0; k < N; k += 1) {
            const f0 = (k + 0.08) / N; const f1 = (k + 0.92) / N;
            const v = 214 + rng() * 34;
            ctx.strokeStyle = `rgb(${v},${v * 0.975},${v * 0.9})`;
            ctx.lineWidth = wide;
            ctx.beginPath();
            ctx.moveTo(mix(xa, xb, f0), mix(ya, yb, f0));
            ctx.lineTo(mix(xa, xb, f1), mix(ya, yb, f1));
            ctx.stroke();
          }
        }
      }
    };
    zig(46, 124, 0, 21);
    zig(136, 214, 0, 21);
    for (let i = 0; i < 2600; i += 1) {
      const v = 60 + rng() * 140;
      ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.86},${0.08 + rng() * 0.2})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2.4, 1 + rng() * 2.4);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function zwRock(seed, radii, { detail = 2, cuts = 8, cutDepth = [0.6, 0.92], lobes = 0.16 } = {}) {
  const rng = seededRandom(seed);
  const planes = [];
  for (let i = 0; i < cuts; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / cuts + (rng() - 0.5) * 0.25;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996 + rng() * 0.7;
    planes.push({ n: norm([Math.cos(a) * r, y, Math.sin(a) * r]), h: mix(cutDepth[0], cutDepth[1], rng()) });
  }
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const off = rng() * 50;
  for (let i = 0; i < pos.count; i += 1) {
    const d = norm([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    let rad = 1.05;
    for (const pl of planes) {
      const k = dot(d, pl.n);
      if (k > 0.05) rad = Math.min(rad, pl.h / k);
    }
    rad *= 1 + (smoothNoise3(d[0] * 1.6 + off, d[1] * 1.6, d[2] * 1.6) - 0.5) * 2 * lobes;
    pos.setXYZ(i, d[0] * rad * radii[0], d[1] * rad * radii[1], d[2] * rad * radii[2]);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const out = toCreasedNormals(g, (34 * Math.PI) / 180);
  const P = out.attributes.position;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i += 1) { uv[i * 2] = (P.getX(i) + P.getZ(i) * 0.62) * 2; uv[i * 2 + 1] = (P.getY(i) + P.getZ(i) * 0.37) * 2; }
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

function greatZimbabwe() {
  const rng = seededRandom(1250);
  const wallGeoms = [];
  const top = new Soup();
  const earth = [];
  const leaves = [];
  const rocks = [];

  // --- the ground -----------------------------------------------------------------------------------
  const zwBaseR = (a) => {
    const ax = 13.0; const az = 11.7;
    const r = (ax * az) / Math.hypot(az * Math.sin(a), ax * Math.cos(a));
    return r + 0.2 * Math.sin(3 * a + 1) + 0.12 * Math.sin(7 * a);
  };
  const groundY = (x, z) => 0.26 + (fbm(x * 0.18 + 3, 1, z * 0.18, 3) - 0.5) * 0.14 + (fbm(x * 0.8, 3, z * 0.8, 2) - 0.5) * 0.03;
  const GOLD_A = lin(0x978649); const GOLD_B = lin(0xb09c58); const OLIVE = lin(0x72763f); const DUST = lin(0x8f7856); const PATH = lin(0x86704f);
  const insideWall = (x, z) => {
    const a = Math.atan2(x, z);
    return Math.hypot(x, z) < zwMidRadius(a);
  };
  const groundColour = (x, z) => {
    const n = fbm(x * 0.35 + 2, 2, z * 0.35, 3);
    const n2 = fbm(x * 1.3, 4, z * 1.3 + 7, 3);
    let c = mix3(GOLD_A, GOLD_B, sstep(n, 0.36, 0.64));
    c = mix3(c, OLIVE, sstep(n2, 0.52, 0.72) * 0.7);
    c = mix3(c, DUST, sstep(fbm(x * 0.6 + 9, 7, z * 0.6, 2), 0.56, 0.74) * 0.6);
    if (insideWall(x, z)) c = mix3(c, DUST, 0.36);
    // A worn path up to the north entrance.
    const door = zwMid(deg(80));
    const along = clamp01(((x - door[0]) * door[0] + (z - door[1]) * door[1]) / (door[0] * door[0] + door[1] * door[1]) / 0.5);
    const px = door[0] * (1 + along * 0.5); const pz = door[1] * (1 + along * 0.5);
    c = mix3(c, PATH, (1 - sstep(Math.hypot(x - px, z - pz), 0.28, 0.7)) * 0.85);
    return c;
  };
  {
    const SECT = 132; const RINGS = 24;
    const pos = []; const col = []; const uv = []; const idx = [];
    const ringR = (k) => (k / RINGS) ** 0.72;
    for (let k = 0; k <= RINGS; k += 1) {
      for (let j = 0; j < SECT; j += 1) {
        const a = (j / SECT) * Math.PI * 2;
        const R = zwBaseR(a) * ringR(k);
        const x = Math.sin(a) * R; const z = Math.cos(a) * R;
        pos.push(x, groundY(x, z), z);
        const c = groundColour(x, z);
        col.push(c[0], c[1], c[2]);
        uv.push(x * 1.5, z * 1.5);
      }
    }
    for (let k = 0; k < RINGS; k += 1) {
      for (let j = 0; j < SECT; j += 1) {
        const j2 = (j + 1) % SECT;
        const a = k * SECT + j; const b = k * SECT + j2; const c = (k + 1) * SECT + j2; const d = (k + 1) * SECT + j;
        idx.push(a, b, c, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // Measured: the face points up or this is flipped.
    const ax = g.attributes.position;
    const probe = SECT * 6 * 5; // a triangle well out from the centre, since the first ring has no area
    const A = v3([ax.getX(idx[probe]), ax.getY(idx[probe]), ax.getZ(idx[probe])]); const B = v3([ax.getX(idx[probe + 1]), ax.getY(idx[probe + 1]), ax.getZ(idx[probe + 1])]); const C = v3([ax.getX(idx[probe + 2]), ax.getY(idx[probe + 2]), ax.getZ(idx[probe + 2])]);
    if (B.clone().sub(A).cross(C.clone().sub(A)).y < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
    g.computeVertexNormals();
    earth.push({ geometry: g, keepColor: true });
    // The base's cut edge, a band of red-brown soil.
    const skirt = new Soup();
    const SOIL = lin(0x6d4f33); const SOIL2 = lin(0x4e3a28);
    for (let j = 0; j < SECT; j += 1) {
      const a0 = (j / SECT) * Math.PI * 2; const a1 = ((j + 1) / SECT) * Math.PI * 2;
      const R0 = zwBaseR(a0); const R1 = zwBaseR(a1);
      const x0 = Math.sin(a0) * R0; const z0 = Math.cos(a0) * R0; const x1 = Math.sin(a1) * R1; const z1 = Math.cos(a1) * R1;
      skirt.face([[x0 * 1.008, 0, z0 * 1.008], [x1 * 1.008, 0, z1 * 1.008], [x1, groundY(x1, z1), z1], [x0, groundY(x0, z0), z0]], [SOIL2, SOIL2, SOIL, SOIL], [Math.sin(a0), 0.2, Math.cos(a0)]);
    }
    earth.push({ geometry: skirt.geometry(), keepColor: true });
  }

  // --- stone colour ---------------------------------------------------------------------------------
  const G_A = lin(0x9b978a); const G_B = lin(0xbab6a6); const G_DARK = lin(0x69655c); const G_WARM = lin(0xad9a7a);
  const graniteInto = (x, y, z, out, topOf = 3) => {
    const a = fbm(x * 0.55 + 2, y * 0.9, z * 0.55, 3);
    let c = mix3(G_A, G_B, sstep(a, 0.36, 0.64));
    c = mix3(c, G_WARM, sstep(fbm(x * 0.9 + 7, y * 0.5, z * 0.9, 2), 0.52, 0.7) * 0.5);
    // Rain has run down from the top of the wall in dark streaks, broken and vertical.
    const streak = fbm(x * 3.1 + z * 2.4, 2.3, z * 3.1 - x * 2.1, 2);
    const fromTop = 1 - sstep(topOf - y, 0, 1.3);
    c = mix3(c, G_DARK, sstep(streak, 0.52, 0.68) * (0.28 + fromTop * 0.45));
    // Damp at the foot.
    c = mix3(c, G_DARK, (1 - sstep(y, 0.2, 0.75)) * 0.45);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  };

  // A dry-stone wall along a midline, as one closed surface: outer face, a round end, inner face, a round
  // end, with the section tapering and leaning as it rises. Its courses are level because its V is world
  // height, whatever the wall is doing. Returns where its faces are, for anything laid on them.
  const dryWall = ({ mid, n, tBase, tTop, height, share = ZW_OUTER_SHARE, rows = 8, flip = 1 }) => {
    const tangent = (t) => {
      const e = 0.5 / n;
      const a = mid(clamp01(t - e)); const b = mid(clamp01(t + e));
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const outDir = (t) => { const T = tangent(t); return [-T[1] * flip, T[0] * flip]; };
    const faces = (t) => {
      const O = outDir(t);
      const base = mid(t);
      const tb = tBase(t); const tt = tTop(t);
      const H = height(t);
      const gy = groundY(base[0], base[1]);
      const fAt = (y) => clamp01((y - gy) / H);
      return {
        O, base, H, gy,
        outerOff: (y) => tb / 2 - (tb - tt) * share * fAt(y),
        innerOff: (y) => tb / 2 - (tb - tt) * (1 - share) * fAt(y),
      };
    };
    const wobble = (x, y, z) => (fbm(x * 1.2, y * 1.4, z * 1.2, 2) - 0.5) * 0.05;
    const END = 6;
    const pos = []; const uv = []; const col = [];
    const cols = 2 * (n + 1) + 2 * (END - 1) + 1;
    const columnPoint = (c, f) => {
      // c is a column index round the loop, f the height fraction.
      const nn = n;
      let t; let kind; let phi = 0;
      if (c <= nn) { t = c / nn; kind = 'out'; } else if (c < nn + END) { t = 1; kind = 'end1'; phi = ((c - nn) / END) * Math.PI; } else if (c <= 2 * nn + END) { t = 1 - (c - nn - END) / nn; kind = 'in'; } else if (c < 2 * nn + 2 * END) { t = 0; kind = 'end0'; phi = ((c - 2 * nn - END) / END) * Math.PI; } else { t = 0; kind = 'out'; }
      const F = faces(t);
      const noise = (fbm(F.base[0] * 2.2 + 11, 4, F.base[1] * 2.2, 2) - 0.5) * 0.09;
      const topY = F.gy + F.H + noise;
      const y = mix(F.gy - 0.14, topY, f);
      const o = F.outerOff(y); const i = F.innerOff(y);
      const T = tangent(t);
      let x; let z;
      if (kind === 'out') { x = F.base[0] + F.O[0] * o; z = F.base[1] + F.O[1] * o; } else if (kind === 'in') { x = F.base[0] - F.O[0] * i; z = F.base[1] - F.O[1] * i; } else {
        const cx = F.base[0] + F.O[0] * (o - i) * 0.5; const cz = F.base[1] + F.O[1] * (o - i) * 0.5;
        const hw = (o + i) / 2;
        const e = kind === 'end1' ? 1 : -1;
        const cp = Math.cos(phi) * (kind === 'end1' ? 1 : -1);
        x = cx + F.O[0] * cp * hw + T[0] * e * Math.sin(phi) * hw;
        z = cz + F.O[1] * cp * hw + T[1] * e * Math.sin(phi) * hw;
      }
      if (f > 0.02) {
        const w = wobble(x, y, z);
        const d = kind === 'in' ? -1 : 1;
        x += F.O[0] * w * d; z += F.O[1] * w * d;
      }
      return { x, y, z, topY };
    };
    const ring = [];
    let run = 0;
    let prev = null;
    for (let c = 0; c < cols; c += 1) {
      const low = columnPoint(c, 0);
      if (prev) run += Math.hypot(low.x - prev.x, low.z - prev.z);
      prev = low;
      ring.push(run);
    }
    const stone = [1, 1, 1];
    const faceRows = rows + 1;
    for (let k = 0; k < faceRows; k += 1) {
      const f = k / rows;
      for (let c = 0; c < cols; c += 1) {
        const p = columnPoint(c, f);
        pos.push(p.x, p.y, p.z);
        // V is world height: every course in the enclosure lies level and at one spacing.
        uv.push(ring[c] / 1.25, p.y / 1.25);
        graniteInto(p.x, p.y, p.z, stone, p.topY);
        col.push(stone[0], stone[1], stone[2]);
      }
    }
    const idx = [];
    for (let k = 0; k < rows; k += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = k * cols + c; const b = a + 1; const d = (k + 1) * cols + c; const e = d + 1;
        idx.push(a, b, e, a, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // Measured: a face on the outer run must point along O.
    {
      const P = g.attributes.position;
      const c = Math.floor(n / 2); const k = Math.floor(rows / 2);
      const a = k * cols + c; const b = a + 1; const e = (k + 1) * cols + c + 1;
      const A = v3([P.getX(a), P.getY(a), P.getZ(a)]); const B = v3([P.getX(b), P.getY(b), P.getZ(b)]); const C = v3([P.getX(e), P.getY(e), P.getZ(e)]);
      const nrm = B.sub(A).cross(C.sub(A));
      const F = faces(c / n);
      if (nrm.x * F.O[0] + nrm.z * F.O[1] < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
    }
    g.computeVertexNormals();
    weldSeam(g, cols, faceRows);
    wallGeoms.push(g);
    // The wall top, a walk of rough stones: paired off between the two faces, with a fan at each end.
    const topColor = (x, z) => { const o = [1, 1, 1]; graniteInto(x, 3, z, o, 3.4); return times(o, 0.9 + fbm(x * 3, 5, z * 3, 2) * 0.32); };
    for (let c = 0; c < n; c += 1) {
      const a0 = columnPoint(c, 1); const a1 = columnPoint(c + 1, 1);
      const b0 = columnPoint(2 * n + END - c, 1); const b1 = columnPoint(2 * n + END - c - 1, 1);
      const q = [[a0.x, a0.y, a0.z], [a1.x, a1.y, a1.z], [b1.x, b1.y, b1.z], [b0.x, b0.y, b0.z]];
      top.face(q, q.map((p) => topColor(p[0], p[2])), [0, 1, 0], { uv: q.map((p) => [(p[0] + p[2]) / 1.25, (p[0] - p[2]) / 1.25]) });
    }
    for (const [from, to] of [[n, n + END], [2 * n + END, 2 * n + 2 * END]]) {
      const q = [];
      for (let c = from; c <= to; c += 1) { const p = columnPoint(c % (cols - 1), 1); q.push([p.x, p.y, p.z]); }
      top.face(q, q.map((p) => topColor(p[0], p[2])), [0, 1, 0], { uv: q.map((p) => [(p[0] + p[2]) / 1.25, (p[0] - p[2]) / 1.25]) });
    }
    return { faces };
  };

  // --- the great wall, broken by its three openings -----------------------------------------------------
  const DOORS = [
    { name: 'north', at: 80, half: 0.52 },
    { name: 'north-west', at: 134, half: 0.46 },
    { name: 'west', at: 196, half: 0.46 },
  ];
  // Half-width of each opening in feet at the mid line: the round end of the wall reaches back into it by
  // half the wall's thickness, so the clear gap at the foot is `half` minus that, doubled.
  const arcBetween = (t0Deg, t1Deg) => {
    const t0 = deg(t0Deg); const t1 = deg(t1Deg);
    const mid = (t) => zwMid(mix(t0, t1, t));
    const span = Math.abs(t1 - t0) * 10.4;
    const n = Math.max(12, Math.round(span / 0.2));
    return dryWall({
      mid, n,
      // The high wall is the thick one.
      tBase: (t) => { const a = mix(t0, t1, t); return mix(0.92, ZW_BASE_T, (zwHeight(a) - ZW_LOW_H) / (ZW_MAX_H - ZW_LOW_H)); },
      tTop: (t) => { const a = mix(t0, t1, t); return mix(0.44, ZW_TOP_T, (zwHeight(a) - ZW_LOW_H) / (ZW_MAX_H - ZW_LOW_H)); },
      height: (t) => zwHeight(mix(t0, t1, t)),
    });
  };
  const doorDeg = (d) => (((d.half + 0.42) / 10.2) * 180) / Math.PI;
  const dA = doorDeg(DOORS[0]); const dB = doorDeg(DOORS[1]); const dC = doorDeg(DOORS[2]);
  arcBetween(DOORS[0].at + dA, DOORS[1].at - dB);
  arcBetween(DOORS[1].at + dB, DOORS[2].at - dC);
  const main = arcBetween(DOORS[2].at + dC, DOORS[0].at - dA + 360);
  const mainT0 = deg(DOORS[2].at + dC); const mainT1 = deg(DOORS[0].at - dA + 360);

  // --- the chevron band, along the top of the high wall only -----------------------------------------------
  const chevron = new Soup();
  {
    const A0 = 262; const A1 = 332;
    const N = 90;
    const BAND_LOW = 0.56; const BAND_HIGH = 0.2; // below the wall's nominal top
    const lift = 0.014;
    let run = 0;
    let prev = null;
    const period = 0.62;
    for (let i = 0; i < N; i += 1) {
      const a0 = deg(mix(A0, A1, i / N)); const a1 = deg(mix(A0, A1, (i + 1) / N));
      const t0 = (a0 - mainT0) / (mainT1 - mainT0); const t1 = (a1 - mainT0) / (mainT1 - mainT0);
      const F0 = main.faces(t0); const F1 = main.faces(t1);
      const y00 = F0.gy + F0.H - BAND_LOW; const y01 = F0.gy + F0.H - BAND_HIGH;
      const y10 = F1.gy + F1.H - BAND_LOW; const y11 = F1.gy + F1.H - BAND_HIGH;
      const p = (F, y) => [F.base[0] + F.O[0] * (F.outerOff(y) + lift), y, F.base[1] + F.O[1] * (F.outerOff(y) + lift)];
      const q = [p(F0, y00), p(F1, y10), p(F1, y11), p(F0, y01)];
      if (!prev) prev = q[0];
      const step = Math.hypot(q[1][0] - q[0][0], q[1][2] - q[0][2]);
      const u0 = run / (period * 8); const u1 = (run + step) / (period * 8);
      const cols = q.map(() => { const o = [1, 1, 1]; graniteInto(q[0][0], y01 - 0.3, q[0][2], o, F0.gy + F0.H); return [Math.min(1, o[0] * 1.2), Math.min(1, o[1] * 1.2), Math.min(1, o[2] * 1.2)]; });
      chevron.face(q, cols, [F0.O[0], 0.1, F0.O[1]], { uv: [[u0, 0], [u1, 0], [u1, 1], [u0, 1]] });
      run += step;
    }
  }

  // --- the parallel passage: a second wall, parallel to the first, from the north entrance to the tower ------
  const PASS = 0.5; // clear width at the foot
  const passageWall = (aFrom, aTo) => {
    const a0 = deg(aFrom); const a1 = deg(aTo);
    const T2B = 0.62; const T2T = 0.34;
    const mid = (t) => {
      const a = mix(a0, a1, t);
      const k = (zwHeight(a) - ZW_LOW_H) / (ZW_MAX_H - ZW_LOW_H);
      const tb = mix(0.92, ZW_BASE_T, k);
      const r = zwMidRadius(a) - tb / 2 - PASS - T2B / 2;
      return [Math.sin(a) * r, Math.cos(a) * r];
    };
    dryWall({
      mid,
      n: Math.max(10, Math.round((Math.abs(a1 - a0) * 9.4) / 0.2)),
      tBase: () => T2B,
      tTop: () => T2T,
      height: (t) => zwHeight(mix(a0, a1, t)) * 0.84,
      share: 0.5,
    });
  };
  passageWall(341, 392);
  passageWall(398, 433);

  // --- the conical tower: solid, as every survey of it has found, with its stepped top ---------------------
  const tA = deg(ZW_HIGH_AT + 6);
  const tR = zwMidRadius(tA) - ZW_BASE_T / 2 - 1.55;
  const TX = Math.sin(tA) * tR; const TZ = Math.cos(tA) * tR;
  const towerProfile = (R, H, topR, steps) => {
    const list = [[0, -0.1], [R * 1.02, -0.1]];
    const body = 0.82;
    const N = 10;
    for (let i = 0; i <= N; i += 1) {
      const f = i / N;
      // A slight swell low down, then the steady batter: it is not a straight cone.
      const r = mix(R, topR, f ** 0.92) + 0.03 * R * Math.sin(f * Math.PI);
      list.push([r, f * H * body]);
    }
    // The stepped top: each course set in from the last, with a level tread.
    const rest = H * (1 - body);
    let r = topR;
    let y = H * body;
    for (let i = 0; i < steps; i += 1) {
      const dr = (topR * 0.44) / steps;
      y += rest / steps * 0.5;
      list.push([r, y]);
      list.push([r, y + 0.004]);
      r -= dr;
      list.push([r, y + 0.006]);
      y += rest / steps * 0.5;
      list.push([r, y]);
    }
    list.push([r * 0.72, y + 0.012]);
    list.push([0, y + 0.03]);
    return list;
  };
  const addTower = (x, z, R, H, topR, steps, seg) => {
    const gy = groundY(x, z);
    const g = latheUp(towerProfile(R, H, topR, steps), { segments: seg });
    const P = g.attributes.position; const UV = g.attributes.uv;
    const col = new Float32Array(P.count * 3);
    const out = [1, 1, 1];
    for (let i = 0; i < P.count; i += 1) {
      const y = P.getY(i) + gy;
      const wx = P.getX(i) + x; const wz = P.getZ(i) + z;
      const u = UV.getX(i);
      // Round at this height, level courses at the wall's spacing.
      UV.setXY(i, (u * Math.PI * 2 * (R * 0.72)) / 1.25, y / 1.25);
      // A little unevenness in the face, so the outline is laid stone and not a turned post.
      const off = (fbm(wx * 1.5, y * 1.6, wz * 1.5, 2) - 0.5) * 0.045;
      const rr = Math.hypot(P.getX(i), P.getZ(i)) || 1;
      if (rr > 0.05) P.setXYZ(i, P.getX(i) * (1 + off / rr), P.getY(i), P.getZ(i) * (1 + off / rr));
      graniteInto(wx, y, wz, out, H + gy);
      col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    weldSeam(g, seg + 1, towerProfile(R, H, topR, steps).length);
    g.translate(x, gy, z);
    wallGeoms.push(g);
  };
  addTower(TX, TZ, 0.78, 2.62, 0.4, 4, 48);
  // The smaller tower beside it, along the wall.
  const t2A = tA + deg(9);
  const t2R = zwMidRadius(t2A) - ZW_BASE_T / 2 - 1.15;
  addTower(Math.sin(t2A) * t2R, Math.cos(t2A) * t2R, 0.36, 1.12, 0.2, 2, 28);

  // --- inner walls: the ring round the towers, and the low walls that divide the interior -----------------
  const arcAround = (cx, cz, rho, phi0, phi1, H, tb = 0.42, tt = 0.26) => {
    const a0 = deg(phi0); const a1 = deg(phi1);
    dryWall({
      mid: (t) => { const a = mix(a0, a1, t); return [cx + Math.sin(a) * rho, cz + Math.cos(a) * rho]; },
      n: Math.max(8, Math.round((Math.abs(a1 - a0) * rho) / 0.2)),
      tBase: () => tb, tTop: () => tt, height: () => H, share: 0.5,
    });
  };
  // Bearing from the tower to the plan's centre.
  const towardCentre = (Math.atan2(-TX, -TZ) * 180) / Math.PI;
  arcAround(TX, TZ, 2.9, towardCentre + 30, towardCentre + 118, 1.3);
  arcAround(TX, TZ, 2.9, towardCentre - 100, towardCentre - 16, 1.3);
  arcAround(-2.2, 1.4, 4.6, 205, 275, 0.98);
  arcAround(1.4, -2.8, 3.9, 120, 215, 0.92);
  arcAround(-4.5, -3.6, 2.6, 25, 130, 0.82);

  // --- the floors of vanished houses: rings of clay where daga huts stood ----------------------------------
  const HUTS = [[-1.0, 3.0, 1.0], [3.2, 0.4, 0.92], [-3.0, -1.0, 1.05], [0.8, -4.9, 0.88], [5.2, -4.2, 0.82], [-6.6, 0.8, 0.9], [-5.7, -5.2, 0.82], [2.4, 4.5, 0.78]];
  const CLAY = lin(0x8f7a56); const CURB = lin(0x7a7263); const BURN = lin(0x5b4b38);
  for (const [hx, hz, hr0] of HUTS) {
    const gy = groundY(hx, hz);
    const hr = hr0 * 0.82;
    const g = latheUp([
      [0, gy - 0.05], [hr * 1.05, gy - 0.05], [hr * 1.03, gy + 0.025], [hr * 0.99, gy + 0.05], [hr * 0.92, gy + 0.052], [hr * 0.88, gy + 0.034], [hr * 0.5, gy + 0.03], [hr * 0.16, gy + 0.03], [hr * 0.12, gy + 0.02], [0, gy + 0.02],
    ], { segments: 26 });
    g.translate(hx, 0, hz);
    tintVertices(g, (x, y, z, out) => {
      const rr = Math.hypot(x - hx, z - hz);
      let c = mix3(CLAY, CURB, sstep(rr, hr * 0.86, hr * 0.9));
      c = mix3(c, BURN, (1 - sstep(rr, hr * 0.08, hr * 0.16)) * 0.7);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    const uv = g.attributes.uv; const P = g.attributes.position;
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, P.getX(i) * 1.5, P.getZ(i) * 1.5);
    earth.push({ geometry: g, keepColor: true });
  }

  // Grass in tufts, thin bent blades as real solids would cost too much, so each is a bent pair of planes
  // whose faces show from both sides by being written both ways round.
  {
    const soup = new Soup();
    const TIP = [lin(0xd9c67a), lin(0xc9b56a), lin(0xbcae68)];
    const ROOT = lin(0x8a7f45);
    let made = 0;
    for (let i = 0; i < 1400 && made < 340; i += 1) {
      const a = rng() * 6.283;
      const r = rng() ** 0.6 * zwBaseR(a) * 0.97;
      const x = Math.sin(a) * r; const z = Math.cos(a) * r;
      if (Math.abs(r - zwMidRadius(a)) < 1.0) continue;
      if (r < zwMidRadius(a) && rng() > 0.35) continue;
      made += 1;
      const y = groundY(x, z) - 0.01;
      const blades = 4;
      for (let b = 0; b < blades; b += 1) {
        const ba = rng() * 6.283;
        const hgt = 0.14 + rng() * 0.16;
        const lean = 0.05 + rng() * 0.09;
        const dx = Math.cos(ba); const dz = Math.sin(ba);
        const w = 0.016 + rng() * 0.012;
        const qx = x + dx * 0.03; const qz = z + dz * 0.03;
        const A = [qx - dz * w, y, qz + dx * w]; const B = [qx + dz * w, y, qz - dx * w];
        const T = [qx + dx * lean, y + hgt, qz + dz * lean];
        const tip = TIP[Math.floor(rng() * 3)];
        soup.face([A, B, T], [ROOT, ROOT, tip], [dx, 0.3, dz]);
        soup.face([A, T, B], [ROOT, tip, ROOT], [-dx, 0.3, -dz]);
      }
    }
    earth.push({ geometry: soup.geometry(), keepColor: true });
  }

  // --- the savanna: granite boulders and flat-topped acacias ------------------------------------------------
  const clearOfWalls = (x, z) => {
    const a = Math.atan2(x, z);
    const r = Math.hypot(x, z);
    const m = zwMidRadius(a);
    return Math.abs(r - m) > 1.6;
  };
  const ROCK_A = lin(0x8d8675); const ROCK_B = lin(0xa9a08c); const ROCK_L = lin(0x8b8350);
  const boulder = (x, z, R, seed) => {
    const g = zwRock(seed, [R * (0.9 + rng() * 0.5), R * (0.55 + rng() * 0.3), R * (0.8 + rng() * 0.4)]);
    const s2 = rng() * 20;
    tintVertices(g, (px, py, pz, out) => {
      const n = smoothNoise3(px * 2.4 + s2, py * 2.4, pz * 2.4);
      const c = mix3(mix3(ROCK_A, ROCK_B, n), ROCK_L, sstep(smoothNoise3(px * 5 + s2, py * 5, pz * 5), 0.64, 0.76) * 0.65);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(x, z) + R * 0.1, z), q, new THREE.Vector3(1, 1, 1)));
    rocks.push({ geometry: g, keepColor: true });
  };
  // A rock pile on the outside, round to the back: the granite these walls were quarried from.
  for (let i = 0; i < 15; i += 1) {
    const a = deg(rng() * 360);
    const r = zwBaseR(a) - 0.5 - rng() * 1.0;
    const x = Math.sin(a) * r; const z = Math.cos(a) * r;
    if (!clearOfWalls(x, z) || (z > 3 && Math.abs(x) < 7)) continue;
    boulder(x, z, 0.26 + rng() * 0.4, 500 + i);
  }
  for (const [x, z, R] of [[-3.8, 3.5, 0.3], [4.8, 1.8, 0.22], [-1.5, -2.6, 0.26], [-7.3, -2.8, 0.26]]) boulder(x, z, R, 600 + Math.round(x * 3));

  const BARK = lin(0x4f3f30); const LEAF = [lin(0x3e4c24), lin(0x4c5a2a), lin(0x364423)];
  const acacia = (x, z, H, spread) => {
    const gy = groundY(x, z);
    const baseA = rng() * 6.28;
    const fork = gy + H * 0.46;
    const bx = x + Math.cos(baseA) * 0.1; const bz = z + Math.sin(baseA) * 0.1;
    const trunk = tube([[x, gy - 0.05, z], [mix(x, bx, 0.6), mix(gy, fork, 0.6), mix(z, bz, 0.6)], [bx, fork, bz]], [0.11, 0.078, 0.066], { sides: 8, steps: 5, round: 1 });
    tintVertices(trunk, (px, py, pz, out) => { const k = 0.8 + 0.4 * smoothNoise3(px * 5, py * 3, pz * 5); out[0] = BARK[0] * k; out[1] = BARK[1] * k; out[2] = BARK[2] * k; });
    earth.push({ geometry: trunk, keepColor: true });
    const crown = gy + H * 0.9;
    const limbs = 5;
    const tips = [];
    for (let i = 0; i < limbs; i += 1) {
      const a = baseA + (i / limbs) * 6.283 + (rng() - 0.5) * 0.5;
      const rr = spread * (0.5 + rng() * 0.3);
      const tip = [bx + Math.cos(a) * rr, crown - rng() * H * 0.05, bz + Math.sin(a) * rr];
      const mid = [bx + Math.cos(a) * rr * 0.42, mix(fork, crown, 0.62), bz + Math.sin(a) * rr * 0.42];
      const limb = tube([[bx, fork - 0.03, bz], mid, tip], [0.058, 0.036, 0.016], { sides: 6, steps: 5, round: 1 });
      tintVertices(limb, (px, py, pz, out) => { const k = 0.8 + 0.4 * smoothNoise3(px * 5, py * 3, pz * 5); out[0] = BARK[0] * k; out[1] = BARK[1] * k; out[2] = BARK[2] * k; });
      earth.push({ geometry: limb, keepColor: true });
      tips.push(tip);
    }
    // The flat umbrella: thin wide puffs, overlapping, their undersides dark and their tops lit.
    const puffs = 9;
    for (let i = 0; i < puffs; i += 1) {
      const a = i === 0 ? 0 : ((i - 1) / (puffs - 1)) * 6.283 + rng() * 0.5;
      const rr = i === 0 ? 0 : spread * (0.42 + rng() * 0.32);
      const cx = bx + Math.cos(a) * rr; const cz = bz + Math.sin(a) * rr; const cy = crown + 0.02 + rng() * 0.06;
      const R = spread * (i === 0 ? 0.62 : 0.32 + rng() * 0.12);
      const g = new THREE.IcosahedronGeometry(1, 2);
      const P = g.attributes.position; const Nn = g.attributes.normal;
      const col = new Float32Array(P.count * 3);
      const seed = rng() * 40;
      const base = LEAF[Math.floor(rng() * 3)];
      for (let v = 0; v < P.count; v += 1) {
        const d = norm([P.getX(v), P.getY(v), P.getZ(v)]);
        const leaf = smoothNoise3(d[0] * 3.4 + seed, d[1] * 3.4, d[2] * 3.4);
        const k = 0.82 + leaf * 0.38;
        P.setXYZ(v, cx + d[0] * R * k, cy + d[1] * R * k * 0.28, cz + d[2] * R * k);
        Nn.setXYZ(v, d[0], d[1], d[2]);
        const c = times(base, (0.4 + 0.72 * (d[1] * 0.5 + 0.5)) * (0.62 + leaf * 0.8));
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      leaves.push({ geometry: g, keepColor: true });
    }
  };
  acacia(9.8, -6.6, 4.4, 1.7);
  acacia(-11.1, -2.2, 3.9, 1.6);
  acacia(-7.6, -7.9, 4.3, 1.85);
  acacia(10.0, 6.3, 3.1, 1.2);
  acacia(-2.5, -3.2, 2.9, 1.2);

  // --- materials ---------------------------------------------------------------------------------------------
  const tile = zwCourseTile(41);
  const wallMesh = mesh(mergeParts([...wallGeoms.map((geometry) => ({ geometry, keepColor: true })), { geometry: top.geometry(), keepColor: true }]), standard({ vertexColors: true, map: tile, bumpMap: tile, bumpScale: 0.5, roughness: 0.96, metalness: 0 }));
  const chevTile = zwChevronTile(42);
  const chevMesh = mesh(chevron.geometry(), standard({ vertexColors: true, map: chevTile, bumpMap: chevTile, bumpScale: 0.6, roughness: 0.96, metalness: 0 }));
  const grass = akGrassTile(43);
  const earthMesh = mesh(mergeParts(earth), standard({ vertexColors: true, map: grass, roughness: 1, metalness: 0 }));
  const leafTile = akGrassTile(45);
  leafTile.repeat.set(5, 3);
  const leafMesh = mesh(mergeParts(leaves), standard({ vertexColors: true, map: leafTile, bumpMap: leafTile, bumpScale: 0.5, roughness: 0.9, metalness: 0 }));
  const rockBump = grainBump(44, { size: 256, dots: 2200, contrast: 0.45 });
  const rockMesh = mesh(mergeParts(rocks), standard({ vertexColors: true, bumpMap: rockBump, bumpScale: 0.4, roughness: 0.94, metalness: 0 }));
  return group(wallMesh, chevMesh, earthMesh, leafMesh, rockMesh);
}

export const BUILDERS = {
  'angkor-wat': angkorWat,
  'great-zimbabwe': greatZimbabwe,
  marimba,
  koto,
  saxophone,
};
