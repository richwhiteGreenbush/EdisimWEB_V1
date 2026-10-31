// Builders for the Model Database's second set of Landmarks: the Eiffel Tower, a stretch of the
// Great Wall, the Leaning Tower of Pisa, Stonehenge as it stands today, and El Castillo. Scale
// models a student walks round at waist-to-head height, so each has to hold up from six feet away
// and from close above.
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import {
  seededRandom, canvasTexture, standard, mesh, group, relief,
} from '../../PropKit.js';
import {
  lin, mix, clamp01, sstep, tintVertices, grainBump, Sculpt, polygonize, ellipsoidP, sphereP, boxP, curveP,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// A monotone cubic through a table of [x, y], so a surveyed profile never overshoots between its
// own stations. A Catmull-Rom here puts a bulge in the tower's leg just above the arch.
function pchip(table) {
  const n = table.length;
  const xs = table.map((r) => r[0]);
  const ys = table.map((r) => r[1]);
  const d = [];
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i += 1) m.push(d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]));
  m.push(d[n - 2]);
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// A triangle soup with FACE normals (or normals handed in) and a colour per corner. Masonry and
// iron both want hard edges, and each block or member carries its own tone. Every polygon MEASURES
// its winding against an outward hint rather than assuming it, the rule Turkle Street paid for.
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }

  get triangles() { return this.p.length / 9; }

  // pts: a convex polygon. col: one colour or one per point. hint: which way is out.
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

  // An eight-cornered solid: bottom four then top four, each counter-clockwise from above.
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

  // A box on the axes.
  box(x0, y0, z0, x1, y1, z1, col, opts) {
    this.hexa(
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
      col,
      opts,
    );
  }

  // A square-section member from a to b. `ref` fixes which way its flats face. Open at both ends,
  // because both ends are buried in whatever it joins: eight triangles a member is what makes a
  // real lattice affordable. Normals come straight from the frame.
  bar(a, b, s, ref, col, s2 = s) {
    const dir = norm(sub(b, a));
    let side = cross(dir, ref);
    if (Math.hypot(side[0], side[1], side[2]) < 1e-5) side = cross(dir, [0.3, 0.2, 0.9]);
    side = norm(side);
    const up = norm(cross(side, dir));
    const corner = (p, w, h) => [p[0] + side[0] * w + up[0] * h, p[1] + side[1] * w + up[1] * h, p[2] + side[2] * w + up[2] * h];
    const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const norms = [up, [-side[0], -side[1], -side[2]], [-up[0], -up[1], -up[2]], side];
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      const q0 = corner(a, signs[i][0] * s, signs[i][1] * s);
      const q1 = corner(a, signs[j][0] * s, signs[j][1] * s);
      const q2 = corner(b, signs[j][0] * s2, signs[j][1] * s2);
      const q3 = corner(b, signs[i][0] * s2, signs[i][1] * s2);
      const nn = norms[i];
      // Corner order chosen so the face looks along nn; measured in face() would cost a cross
      // product per member and there are five thousand of them.
      const list = dot(cross(sub(q1, q0), sub(q3, q0)), nn) > 0 ? [q0, q1, q2, q0, q2, q3] : [q0, q2, q1, q0, q3, q2];
      for (const q of list) {
        this.p.push(q[0], q[1], q[2]);
        this.n.push(nn[0], nn[1], nn[2]);
        this.t.push(0, 0);
        this.c.push(col[0], col[1], col[2]);
      }
    }
  }

  // A turned frustum of `n` flats, the same bar idea for things that are round.
  frustum(c0, y0, c1, y1, r0, r1, n, col, { capTop = true, capBottom = false, smooth = true } = {}) {
    const a0 = [c0[0], y0, c0[1]];
    const a1 = [c1[0], y1, c1[1]];
    const slope = (r0 - r1) / Math.max(1e-4, y1 - y0);
    for (let i = 0; i < n; i += 1) {
      const u0 = (i / n) * Math.PI * 2; const u1 = ((i + 1) / n) * Math.PI * 2;
      const s0 = Math.sin(u0); const k0 = Math.cos(u0); const s1 = Math.sin(u1); const k1 = Math.cos(u1);
      const pts = [
        [a0[0] + s0 * r0, y0, a0[2] + k0 * r0], [a0[0] + s1 * r0, y0, a0[2] + k1 * r0],
        [a1[0] + s1 * r1, y1, a1[2] + k1 * r1], [a1[0] + s0 * r1, y1, a1[2] + k0 * r1],
      ];
      const n0 = norm([s0, slope, k0]); const n1 = norm([s1, slope, k1]);
      const hint = [Math.sin((u0 + u1) / 2), 0.001, Math.cos((u0 + u1) / 2)];
      if (r1 < 1e-5) this.face([pts[0], pts[1], pts[2]], col, hint, smooth ? { normals: [n0, n1, n1] } : {});
      else this.face(pts, col, hint, smooth ? { normals: [n0, n1, n1, n0] } : {});
      if (capTop && r1 > 1e-5) this.face([[a1[0], y1, a1[2]], pts[3], pts[2]], col, [0, 1, 0]);
      if (capBottom && r0 > 1e-5) this.face([[a0[0], y0, a0[2]], pts[0], pts[1]], col, [0, -1, 0]);
    }
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

// A WALL WITH REAL OPENINGS, BUILT VOID FIRST. There is no CSG, so the face is assembled from the
// piers between the openings, the sill under each and the spandrel over each, then every edge of
// every opening gets a reveal running back to a panel. `o` is the wall's bottom-left corner on its
// outer face, `ux` runs along it, `uy` up it and `out` away from it, all unit vectors.
//
// Each opening is { cx, y0, y1, w, arch } in wall feet, where y1 is the spring and `arch` is true
// for a semicircular head. `rim` is a band round the head in another colour, standing `rimOut` proud.
function wallWithOpenings(soup, o, ux, uy, out, width, height, openings, {
  col, depth = 0.3, reveal = null, back = [0.015, 0.014, 0.013], archSegs = 10, rim = 0, rimCol = null, rimOut = 0.012, uvOrigin = null,
} = {}) {
  const P = (x, y, d = 0) => [
    o[0] + ux[0] * x + uy[0] * y + out[0] * d,
    o[1] + ux[1] * x + uy[1] * y + out[1] * d,
    o[2] + ux[2] * x + uy[2] * y + out[2] * d,
  ];
  const uvOf = (x, y) => [x + (uvOrigin ? uvOrigin[0] : 0), y + (uvOrigin ? uvOrigin[1] : 0)];
  const rect = (x0, y0, x1, y1, c = col) => {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    soup.face([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], c, out, {
      uv: [uvOf(x0, y0), uvOf(x1, y0), uvOf(x1, y1), uvOf(x0, y1)],
    });
  };
  const sorted = [...openings].sort((a, b) => a.cx - b.cx);
  let cursor = 0;
  const revealCol = reveal ?? times(col, 0.62);
  for (const op of sorted) {
    const x0 = op.cx - op.w / 2; const x1 = op.cx + op.w / 2;
    const rimW = rim && op.arch ? rim : 0;
    rect(cursor, 0, x0 - rimW, height);
    if (rimW) { rect(x0 - rimW, 0, x0, op.y1); rect(x1, 0, x1 + rimW, op.y1); }
    cursor = x1 + rimW;
    rect(x0, 0, x1, op.y0);
    // The outline of the opening's head, left to right.
    const r = op.w / 2;
    const head = [];
    if (op.arch) {
      for (let i = 0; i <= archSegs; i += 1) {
        const a = Math.PI - (i / archSegs) * Math.PI;
        head.push([op.cx + Math.cos(a) * r, op.y1 + Math.sin(a) * r]);
      }
    } else {
      head.push([x0, op.y1], [x1, op.y1]);
    }
    if (rim && op.arch) {
      const outerHead = head.map(([hx, hy]) => {
        const k = (r + rim) / r;
        return [op.cx + (hx - op.cx) * k, op.y1 + (hy - op.y1) * k];
      });
      for (let i = 0; i < head.length - 1; i += 1) {
        const a = head[i]; const b = head[i + 1]; const c = outerHead[i + 1]; const d = outerHead[i];
        // Ring of dressed stone: stands proud of the wall, so it casts the arch's own shadow.
        soup.face([P(a[0], a[1], rimOut), P(b[0], b[1], rimOut), P(c[0], c[1], rimOut), P(d[0], d[1], rimOut)], rimCol ?? col, out, {
          uv: [uvOf(a[0], a[1]), uvOf(b[0], b[1]), uvOf(c[0], c[1]), uvOf(d[0], d[1])],
        });
        const mid = [(c[0] + d[0]) / 2 - op.cx, (c[1] + d[1]) / 2 - op.y1];
        const hintOut = add(scl(ux, mid[0]), scl(uy, mid[1]));
        soup.face([P(d[0], d[1], 0), P(c[0], c[1], 0), P(c[0], c[1], rimOut), P(d[0], d[1], rimOut)], rimCol ?? col, hintOut);
      }
      // Spandrel from the rim's outer edge up to the wall head.
      for (let i = 0; i < outerHead.length - 1; i += 1) {
        const a = outerHead[i]; const b = outerHead[i + 1];
        soup.face([P(a[0], a[1]), P(b[0], b[1]), P(b[0], height), P(a[0], height)], col, out, {
          uv: [uvOf(a[0], a[1]), uvOf(b[0], b[1]), uvOf(b[0], height), uvOf(a[0], height)],
        });
      }
    } else {
      for (let i = 0; i < head.length - 1; i += 1) {
        const a = head[i]; const b = head[i + 1];
        soup.face([P(a[0], a[1]), P(b[0], b[1]), P(b[0], height), P(a[0], height)], col, out, {
          uv: [uvOf(a[0], a[1]), uvOf(b[0], b[1]), uvOf(b[0], height), uvOf(a[0], height)],
        });
      }
    }
    // The jambs, the head and the sill, running back into the wall.
    const line = [[x0, op.y0], ...head, [x1, op.y0], [x0, op.y0]];
    const cx = op.cx; const cy = (op.y0 + op.y1) / 2;
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]; const b = line[i + 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5) continue;
      const midX = (a[0] + b[0]) / 2 - cx; const midY = (a[1] + b[1]) / 2 - cy;
      // A reveal faces into the opening.
      const inward = norm(add(scl(ux, -midX), scl(uy, -midY)));
      const front = rimW ? rimOut : 0;
      soup.face([P(a[0], a[1], front), P(b[0], b[1], front), P(b[0], b[1], -depth), P(a[0], a[1], -depth)], revealCol, inward);
    }
    // The dark back of the recess, which is what makes it read as a hole.
    const backPts = [[x0, op.y0], ...head.slice(0), [x1, op.y0]].map(([x, y]) => P(x, y, -depth));
    soup.face(backPts, back, out);
  }
  rect(cursor, 0, width, height);
}

// Near-white so it multiplies safely with vertex tone: a stony speckle with a little pitting.
function stoneMaterial(tile, extras = {}) {
  return standard({ vertexColors: true, map: tile, bumpMap: tile, bumpScale: 0.5, roughness: 0.95, metalness: 0, ...extras });
}
function repeatFeet(texture, feet, feetV = feet) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / feet, 1 / feetV);
  return texture;
}

// ---------------------------------------------------------------------------
// The Eiffel Tower, 1/30
// ---------------------------------------------------------------------------

// All heights and half-widths below are the real tower's, in METRES, and M turns them into model
// feet, so a figure here can be checked against a reference. 330m to the antenna tip gives 36.1ft.
const EF_M = 3.28084 / 30;
const EF_LEVELS = { first: 57, second: 115, third: 276, top: 300, tip: 330 };

// Half the tower's width at the outer face of its legs, and the width of one leg. These two tables
// ARE the tower's curve. The base is 125m across its feet, the legs are about 25m square there, and
// the inside faces come together as they rise. Upper stations are my reading of the published
// elevations rather than survey data.
const efOuter = pchip([[0, 62.5], [19, 53.5], [35, 45], [57, 34.5], [80, 27.3], [115, 20.3], [140, 16.3], [170, 13], [200, 10.8], [240, 9.1], [276, 7.9]]);
const efLeg = pchip([[0, 25.4], [19, 22.3], [57, 15.4], [80, 12], [115, 9.3], [140, 7.8], [170, 6.2], [200, 5], [240, 3.9], [276, 3.2]]);

function pavingTile(seed, { cells = 8, base = 232, spread = 20, joint = 'rgba(64,58,50,0.5)' } = {}) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8e4da';
    ctx.fillRect(0, 0, w, h);
    const s = w / cells;
    for (let j = 0; j < cells; j += 1) {
      for (let i = 0; i < cells; i += 1) {
        const v = base + rng() * spread;
        ctx.fillStyle = `rgb(${v},${v * 0.985},${v * 0.95})`;
        ctx.fillRect(i * s, j * s, s, s);
      }
    }
    ctx.fillStyle = joint;
    for (let i = 0; i < cells; i += 1) {
      ctx.fillRect(i * s, 0, 2.4, h);
      ctx.fillRect(0, i * s, w, 2.4);
    }
    for (let i = 0; i < 1600; i += 1) {
      const v = 120 + rng() * 90;
      ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.88},${0.08 + rng() * 0.2})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2.4, 1 + rng() * 2.4);
    }
  });
}

function eiffelTower() {
  const rng = seededRandom(1889);
  const iron = new Soup();
  const stone = new Soup();
  const M = EF_M;

  const PLAZA = 0.2;
  const PIER = 0.42; // top of the masonry the legs stand on
  const yOf = (h) => PIER + h * M;
  const outer = (h) => efOuter(h) * M;
  const legW = (h) => efLeg(h) * M;

  // THE PAINT IS GRADED, and that is true of the real tower: three shades, darkest at the foot and
  // lightest at the top, so that against the sky it reads as one colour from the ground.
  const DARK = lin(0x523b2b);
  const MID = lin(0x6a4e39);
  const PALE = lin(0x80654b);
  const paint = (h, k = 1) => {
    const t = clamp01(h / 276);
    const c = t < 0.4 ? mix3(DARK, MID, t / 0.4) : mix3(MID, PALE, (t - 0.4) / 0.6);
    const j = k * (0.94 + rng() * 0.12);
    return times(c, j);
  };

  // Stations up the structure: a bay is a fixed fraction of the leg's own width, so the panels
  // stay nearly square as the leg shrinks, which is how the real bracing is proportioned.
  const stations = (h0, h1, frac) => {
    const out = [h0];
    let h = h0;
    while (h < h1 - 1e-3) { h += frac * efLeg(h); out.push(Math.min(h, h1)); }
    if (out.length > 2 && out[out.length - 1] - out[out.length - 2] < frac * efLeg(h1) * 0.5) out.splice(out.length - 2, 1);
    return out;
  };

  const SIGNS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

  // One of a leg's four chords. i and j pick its corner, 0 on the tower's outer face and 1 on the
  // leg's inner face.
  const chord = (sx, sz, i, j, h) => {
    const o = outer(h); const w = legW(h);
    return [sx * (o - i * w), yOf(h), sz * (o - j * w)];
  };

  // Lattice in one face of a leg, between its two chords over one bay.
  const faceLattice = (a0, b0, a1, b1, h, { halves = 1, lace, strut, ref }) => {
    const n = halves;
    const at0 = (t) => lerp3(a0, b0, t);
    const at1 = (t) => lerp3(a1, b1, t);
    for (let k = 0; k < n; k += 1) {
      const t0 = k / n; const t1 = (k + 1) / n;
      iron.bar(at0(t0), at1(t1), lace, ref, paint(h, 0.86));
      iron.bar(at0(t1), at1(t0), lace, ref, paint(h, 0.86));
      if (k > 0) iron.bar(at0(t0), at1(t0), lace, ref, paint(h, 0.92));
    }
    iron.bar(a1, b1, strut, ref, paint(h, 0.95));
  };

  // A chord that is itself a little lattice column, four rails and their zigzag. Only near the
  // ground, where a student is looking at it from a few feet away.
  const boxChord = (p0, p1, half0, half1, sx, sz, h, rail, lace, flip) => {
    const off = (p, hw, a, b) => [p[0] + a * hw, p[1], p[2] + b * hw];
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (const [a, b] of corners) iron.bar(off(p0, half0, a, b), off(p1, half1, a, b), rail, [0, 0, 1], paint(h, 1.08));
    // Two of the four sides carry zigzag: the two that face away from the leg's middle.
    const s0 = flip ? 1 : -1;
    iron.bar(off(p0, half0, sx, s0), off(p1, half1, sx, -s0), lace, [sx, 0, 0], paint(h, 0.9));
    iron.bar(off(p0, half0, s0, sz), off(p1, half1, -s0, sz), lace, [0, 0, sz], paint(h, 0.9));
  };

  // --- zone A: the foot of each leg up to the first level -----------------------------------------
  const zoneA = stations(0, EF_LEVELS.first, 0.2);
  const zoneB = stations(EF_LEVELS.first, EF_LEVELS.second, 0.46);
  const zoneC = stations(EF_LEVELS.second, EF_LEVELS.third, 1.75);

  for (const [sx, sz] of SIGNS) {
    // A: double lattice in every face, and every chord a small lattice column of its own.
    for (let s = 0; s < zoneA.length - 1; s += 1) {
      const h0 = zoneA[s]; const h1 = zoneA[s + 1];
      const half0 = legW(h0) * 0.058; const half1 = legW(h1) * 0.058;
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const p0 = chord(sx, sz, i, j, h0); const p1 = chord(sx, sz, i, j, h1);
        boxChord(p0, p1, half0, half1, i === 0 ? sx : -sx, j === 0 ? sz : -sz, h0, 0.017, 0.0095, s % 2 === 0);
        // The zigzag's second run, in the other two sides, is what stops a chord reading as a ladder.
        const f = s % 2 === 0 ? -1 : 1;
        const a = (i === 0 ? sx : -sx); const b = (j === 0 ? sz : -sz);
        iron.bar([p0[0] + a * half0, p0[1], p0[2] - f * half0], [p1[0] + a * half1, p1[1], p1[2] + f * half1], 0.0095, [a, 0, 0], paint(h0, 0.9));
        iron.bar([p0[0] - f * half0, p0[1], p0[2] + b * half0], [p1[0] + f * half1, p1[1], p1[2] + b * half1], 0.0095, [0, 0, b], paint(h0, 0.9));
      }
      const opts = { halves: 2, lace: 0.0135, strut: 0.018 };
      // Outer and inner faces in x, then in z.
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 0, 1, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 0, 1, h1), h0, { ...opts, ref: [1, 0, 0] });
      faceLattice(chord(sx, sz, 1, 0, h0), chord(sx, sz, 1, 1, h0), chord(sx, sz, 1, 0, h1), chord(sx, sz, 1, 1, h1), h0, { ...opts, ref: [1, 0, 0] });
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 1, 0, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 1, 0, h1), h0, { ...opts, ref: [0, 0, 1] });
      faceLattice(chord(sx, sz, 0, 1, h0), chord(sx, sz, 1, 1, h0), chord(sx, sz, 0, 1, h1), chord(sx, sz, 1, 1, h1), h0, { ...opts, ref: [0, 0, 1] });
    }
    // B: single lattice, plain heavy chords, seen from further off.
    for (let s = 0; s < zoneB.length - 1; s += 1) {
      const h0 = zoneB[s]; const h1 = zoneB[s + 1];
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        iron.bar(chord(sx, sz, i, j, h0), chord(sx, sz, i, j, h1), 0.046, [0, 0, 1], paint(h0, 1.06), 0.04);
      }
      const opts = { halves: 1, lace: 0.018, strut: 0.022 };
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 0, 1, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 0, 1, h1), h0, { ...opts, ref: [1, 0, 0] });
      faceLattice(chord(sx, sz, 1, 0, h0), chord(sx, sz, 1, 1, h0), chord(sx, sz, 1, 0, h1), chord(sx, sz, 1, 1, h1), h0, { ...opts, ref: [1, 0, 0] });
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 1, 0, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 1, 0, h1), h0, { ...opts, ref: [0, 0, 1] });
      faceLattice(chord(sx, sz, 0, 1, h0), chord(sx, sz, 1, 1, h0), chord(sx, sz, 0, 1, h1), chord(sx, sz, 1, 1, h1), h0, { ...opts, ref: [0, 0, 1] });
    }
    // C: the upper shaft. Four thin columns braced in single lattice, thick enough to survive the
    // distance they are read from. Density falls by a factor of six against the foot of the leg.
    for (let s = 0; s < zoneC.length - 1; s += 1) {
      const h0 = zoneC[s]; const h1 = zoneC[s + 1];
      for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        iron.bar(chord(sx, sz, i, j, h0), chord(sx, sz, i, j, h1), 0.04, [0, 0, 1], paint(h0, 1.08), 0.034);
      }
      const opts = { halves: 1, lace: 0.021, strut: 0.024 };
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 0, 1, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 0, 1, h1), h0, { ...opts, ref: [1, 0, 0] });
      faceLattice(chord(sx, sz, 0, 0, h0), chord(sx, sz, 1, 0, h0), chord(sx, sz, 0, 0, h1), chord(sx, sz, 1, 0, h1), h0, { ...opts, ref: [0, 0, 1] });
    }
  }

  // Bracing across the four faces of the upper shaft, tying the columns together.
  for (let s = 0; s < zoneC.length - 1; s += 1) {
    const h0 = zoneC[s]; const h1 = zoneC[s + 1];
    for (let q = 0; q < 4; q += 1) {
      const a = (q * Math.PI) / 2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const R = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
      const o0 = outer(h0); const w0 = legW(h0); const o1 = outer(h1); const w1 = legW(h1);
      const y0 = yOf(h0); const y1 = yOf(h1);
      const L0 = R(-(o0 - w0), y0, o0); const r0 = R(o0 - w0, y0, o0);
      const L1 = R(-(o1 - w1), y1, o1); const r1 = R(o1 - w1, y1, o1);
      const ref = R(0, 0, 1);
      iron.bar(L0, r1, 0.021, ref, paint(h0, 0.88));
      iron.bar(r0, L1, 0.021, ref, paint(h0, 0.88));
      iron.bar(L1, r1, 0.024, ref, paint(h1, 0.96));
    }
  }

  // The lift shaft that runs up the middle from the second level to the third.
  for (const dx of [-0.2, 0.2]) {
    iron.bar([dx, yOf(EF_LEVELS.second), -0.2], [dx, yOf(EF_LEVELS.third), -0.2], 0.03, [0, 0, 1], paint(200, 0.85));
    iron.bar([dx, yOf(EF_LEVELS.second), 0.2], [dx, yOf(EF_LEVELS.third), 0.2], 0.03, [0, 0, 1], paint(200, 0.85));
  }

  // --- the four great arches -----------------------------------------------------------------------
  // Semicircles fixed by two facts: the crown meets the underside of the first level's girder, and
  // the springing lands on the inner chord of the leg. That solves to a 31m radius, springing 19m up.
  const ARCH_R = 31; const ARCH_Y = 19; const ARCH_DEPTH = 2.6;
  const ARCH_SEG = 28;
  const GIRDER_BOTTOM = 49.8;
  for (let q = 0; q < 4; q += 1) {
    const a = (q * Math.PI) / 2;
    const ca = Math.cos(a); const sa = Math.sin(a);
    const R = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
    const ref = R(0, 0, 1);
    // A point on the arch: t along the ring, radial out to R + d, across the depth at c. Its plane
    // leans in with the tower's face, so it stays against the leg's outer chords all the way round.
    const pt = (t, d, c) => {
      const rad = ARCH_R + d;
      const hm = ARCH_Y + Math.sin(t) * rad;
      const z = (efOuter(hm) - 0.8 + c) * M;
      return R(Math.cos(t) * rad * M, yOf(hm), z);
    };
    for (let i = 0; i < ARCH_SEG; i += 1) {
      const t0 = (i / ARCH_SEG) * Math.PI; const t1 = ((i + 1) / ARCH_SEG) * Math.PI;
      const hm = ARCH_Y + Math.sin(t0) * ARCH_R;
      const tone = paint(hm, 1.12);
      for (const d of [0, ARCH_DEPTH]) {
        for (const c of [-0.55, 0.55]) iron.bar(pt(t0, d, c), pt(t1, d, c), 0.02, ref, tone);
      }
      // Lacing in the ring's two faces and a tie across its soffit.
      const lc = paint(hm, 0.9);
      for (const c of [-0.55, 0.55]) {
        const z = i % 2 === 0;
        iron.bar(pt(t0, z ? 0 : ARCH_DEPTH, c), pt(t1, z ? ARCH_DEPTH : 0, c), 0.012, ref, lc);
      }
      iron.bar(pt(t0, 0, -0.55), pt(t0, 0, 0.55), 0.012, ref, lc);
    }
    // The spandrels: open lattice from the arch's back up to the girder.
    const BAYS = 14;
    for (let i = 1; i < BAYS; i += 1) {
      const t = ((i - 0.0) / BAYS) * Math.PI;
      const rad = ARCH_R + ARCH_DEPTH;
      const hArch = ARCH_Y + Math.sin(t) * rad;
      if (hArch >= GIRDER_BOTTOM - 1) continue;
      const x = Math.cos(t) * rad;
      const top = R(x * M, yOf(GIRDER_BOTTOM), (efOuter(GIRDER_BOTTOM) - 0.8) * M);
      iron.bar(pt(t, ARCH_DEPTH, 0), top, 0.014, ref, paint(hArch, 0.94));
      const t2 = ((i + (i < BAYS / 2 ? 1 : -1)) / BAYS) * Math.PI;
      iron.bar(pt(t2, ARCH_DEPTH, 0), top, 0.011, ref, paint(hArch, 0.88));
    }
  }

  // --- the levels ----------------------------------------------------------------------------------
  // A girder band: top and bottom rails with lattice between, round a square of half-size `half`.
  const girder = (half, h0, h1, bays, { rail = 0.03, lace = 0.014, arcs = false } = {}) => {
    for (let q = 0; q < 4; q += 1) {
      const a = (q * Math.PI) / 2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const R = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
      const ref = R(0, 0, 1);
      const y0 = yOf(h0); const y1 = yOf(h1);
      iron.bar(R(-half, y0, half), R(half, y0, half), rail, ref, paint(h0, 1.1));
      iron.bar(R(-half, y1, half), R(half, y1, half), rail, ref, paint(h0, 1.1));
      for (let i = 0; i < bays; i += 1) {
        const x0 = -half + (2 * half * i) / bays; const x1 = -half + (2 * half * (i + 1)) / bays;
        iron.bar(R(x0, y0, half), R(x0, y1, half), lace * 1.2, ref, paint(h0, 1));
        if (arcs) {
          // The frieze's little arcade: a round head in each bay, under a top rail.
          const mid = (x0 + x1) / 2; const r = (x1 - x0) / 2; const spring = mix(y0, y1, 0.45);
          for (let k = 0; k < 5; k += 1) {
            const t0 = (k / 5) * Math.PI; const t1 = ((k + 1) / 5) * Math.PI;
            iron.bar(R(mid + Math.cos(t0) * r, spring + Math.sin(t0) * r, half), R(mid + Math.cos(t1) * r, spring + Math.sin(t1) * r, half), lace, ref, paint(h0, 1.04));
          }
        } else {
          iron.bar(R(x0, y0, half), R(x1, y1, half), lace, ref, paint(h0, 0.92));
          iron.bar(R(x1, y0, half), R(x0, y1, half), lace, ref, paint(h0, 0.92));
        }
      }
    }
  };
  // A deck: a flat square annulus with real thickness, and a low rail round its edge.
  const deck = (half, hole, h, thick, posts) => {
    const y = yOf(h);
    const tone = times(MID, 0.8);
    const under = times(DARK, 0.7);
    for (let q = 0; q < 4; q += 1) {
      const a = (q * Math.PI) / 2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const R = (x, yy, z) => [x * ca + z * sa, yy, -x * sa + z * ca];
      const top = [R(-half, y, half), R(half, y, half), R(hole, y, hole), R(-hole, y, hole)];
      iron.face(top, tone, [0, 1, 0]);
      iron.face(top.map((p) => [p[0], p[1] - thick, p[2]]), under, [0, -1, 0]);
      iron.face([R(-half, y, half), R(half, y, half), R(half, y - thick, half), R(-half, y - thick, half)], times(MID, 0.95), R(0, 0, 1));
      iron.face([R(-hole, y, hole), R(hole, y, hole), R(hole, y - thick, hole), R(-hole, y - thick, hole)], under, R(0, 0, -1));
      const ref = R(0, 0, 1);
      iron.bar(R(-half, y + 0.13, half), R(half, y + 0.13, half), 0.011, ref, paint(h, 1.1));
      for (let i = 0; i <= posts; i += 1) {
        const x = -half + (2 * half * i) / posts;
        iron.bar(R(x, y, half), R(x, y + 0.13, half), 0.008, ref, paint(h, 1));
      }
    }
  };

  const BLOCK_WALL = lin(0x6a6f6c);
  const BLOCK_GLASS = lin(0x35464d);
  const BLOCK_ROOF = lin(0x7a6a58);
  // A glazed pavilion on a deck: dark glass, a light frame and a roof, so it reads as occupied.
  const pavilion = (x0, x1, z0, z1, y, ht, q) => {
    const a = (q * Math.PI) / 2;
    const ca = Math.cos(a); const sa = Math.sin(a);
    const R = (x, yy, z) => [x * ca + z * sa, yy, -x * sa + z * ca];
    const b = [R(x0, y, z0), R(x1, y, z0), R(x1, y, z1), R(x0, y, z1)];
    const t = [R(x0, y + ht, z0), R(x1, y + ht, z0), R(x1, y + ht, z1), R(x0, y + ht, z1)];
    iron.hexa(b, t, BLOCK_GLASS, { skipBottom: true, topCol: BLOCK_ROOF });
    // Roof slab overhanging, and mullions standing a hair proud of the outer glass.
    const o = 0.05;
    const rb = [R(x0 - o, y + ht, z0 - o), R(x1 + o, y + ht, z0 - o), R(x1 + o, y + ht, z1 + o), R(x0 - o, y + ht, z1 + o)];
    const rt = rb.map((p) => [p[0], p[1] + 0.05, p[2]]);
    iron.hexa(rb, rt, BLOCK_ROOF);
    const ref = R(0, 0, 1);
    const count = Math.round((x1 - x0) / 0.3);
    for (let i = 0; i <= count; i += 1) {
      const x = mix(x0, x1, i / count);
      iron.bar(R(x, y, z1 + 0.006), R(x, y + ht, z1 + 0.006), 0.009, ref, BLOCK_WALL);
    }
  };

  const O1 = 36.2 * M;
  girder(O1, GIRDER_BOTTOM, EF_LEVELS.first - 0.6, 18, { rail: 0.03, lace: 0.0125, arcs: true });
  girder(O1 - 0.14, GIRDER_BOTTOM, EF_LEVELS.first - 0.6, 12, { rail: 0.024, lace: 0.012 });
  deck(O1 + 0.03, 15 * M, EF_LEVELS.first, 0.08, 22);
  for (let q = 0; q < 4; q += 1) pavilion(-1.5, 1.5, O1 - 1.05, O1 - 0.28, yOf(EF_LEVELS.first), 0.36, q);

  const O2 = 21.6 * M;
  girder(O2, 109.5, EF_LEVELS.second - 0.5, 12, { rail: 0.026, lace: 0.0135, arcs: true });
  deck(O2 + 0.03, 6.2 * M, EF_LEVELS.second, 0.07, 14);
  for (let q = 0; q < 4; q += 1) pavilion(-0.95, 0.95, O2 - 0.62, O2 - 0.2, yOf(EF_LEVELS.second), 0.32, q);

  // Belts where the upper shaft's bracing is gathered.
  for (const h of [160, 200, 240]) {
    girder(outer(h) + 0.01, h, h + 2, 4, { rail: 0.024, lace: 0.012 });
  }

  // --- the top: enclosed gallery, open deck above it, the campanile and the mast -----------------
  const O3 = 9.4 * M;
  const y3 = yOf(EF_LEVELS.third);
  girder(O3 - 0.02, 270.5, EF_LEVELS.third - 0.4, 5, { rail: 0.026, lace: 0.016 });
  for (const [sx, sz] of SIGNS) {
    // Brackets out to the deck from the shaft's corners.
    const foot = chord(sx, sz, 0, 0, 262);
    iron.bar(foot, [sx * O3, yOf(270.5), sz * O3], 0.026, [0, 0, 1], paint(265, 1));
  }
  deck(O3, 0.01, EF_LEVELS.third, 0.06, 6);
  const GALLERY_H = 0.46;
  const gallery = O3 - 0.16;
  iron.box(-gallery, y3, -gallery, gallery, y3 + GALLERY_H, gallery, lin(0x3a4a50), { skipBottom: true, topCol: paint(280, 0.95) });
  for (let q = 0; q < 4; q += 1) {
    const a = (q * Math.PI) / 2;
    const ca = Math.cos(a); const sa = Math.sin(a);
    const R = (x, y, z) => [x * ca + z * sa, y, -x * sa + z * ca];
    for (let i = 0; i <= 5; i += 1) {
      const x = mix(-gallery, gallery, i / 5);
      iron.bar(R(x, y3, gallery + 0.006), R(x, y3 + GALLERY_H, gallery + 0.006), 0.012, R(0, 0, 1), paint(280, 1.2));
    }
  }
  deck(gallery + 0.1, 0.01, 276 + GALLERY_H / M + 0.6, 0.05, 6);
  const yTopDeck = y3 + GALLERY_H + 0.6 * M;
  const hutH = 0.34;
  iron.box(-0.42, yTopDeck, -0.42, 0.42, yTopDeck + hutH, 0.42, paint(290, 0.82), { skipBottom: true, topCol: paint(290, 1) });
  const domeBase = yTopDeck + hutH;
  const lan = (r0, r1, y0, y1, n = 16) => iron.frustum([0, 0], y0, [0, 0], y1, r0, r1, n, paint(295, 1.05), { capTop: false, capBottom: true });
  lan(0.42, 0.3, domeBase, domeBase + 0.18);
  lan(0.3, 0.14, domeBase + 0.18, domeBase + 0.36);
  lan(0.14, 0.07, domeBase + 0.36, domeBase + 0.56);
  const tipY = yOf(EF_LEVELS.tip);
  iron.frustum([0, 0], domeBase + 0.56, [0, 0], domeBase + 0.9, 0.07, 0.05, 10, lin(0xc8c2b6), { capTop: false });
  iron.frustum([0, 0], domeBase + 0.9, [0, 0], tipY - 1.1, 0.05, 0.028, 10, lin(0xd3cdc0), { capTop: false });
  iron.frustum([0, 0], tipY - 1.1, [0, 0], tipY, 0.028, 0.008, 8, lin(0xc24a30), { capTop: true });

  // --- the plaza and the four masonry piers ---------------------------------------------------------
  const PLAZA_HALF = 8.8;
  const EDGE = lin(0xb1a48c);
  const GRAVEL = lin(0xc9b896);
  const PAVE = lin(0xd0c7b2);
  const LAWN = lin(0x5f7e3d);
  const KERB = lin(0xa39a88);
  stone.box(-PLAZA_HALF, 0, -PLAZA_HALF, PLAZA_HALF, PLAZA * 0.7, PLAZA_HALF, EDGE, { skipBottom: true, topCol: KERB });
  const inner = PLAZA_HALF - 0.32;
  stone.box(-inner, PLAZA * 0.7, -inner, inner, PLAZA, inner, EDGE, { skipBottom: true, topCol: GRAVEL });
  // Four lawn panels at the corners and a paved square under the tower, each a thin raised slab, so
  // the plaza's parts meet at real edges instead of a tint a vertex apart. Stopped short of the
  // piers, so the feet stand on paving rather than in grass.
  const paved = 7.05;
  stone.box(-paved, PLAZA, -paved, paved, PLAZA + 0.012, paved, times(PAVE, 0.95), { skipBottom: true, topCol: PAVE });
  for (const [sx, sz] of SIGNS) {
    const lawnFrom = stone.t.length;
    const x0 = sx * (paved + 0.15); const x1 = sx * (inner - 0.1); const z0 = sz * 2.1; const z1 = sz * (inner - 0.1);
    stone.box(Math.min(x0, x1), PLAZA, Math.min(z0, z1), Math.max(x0, x1), PLAZA + 0.04, Math.max(z0, z1), times(LAWN, 0.8), { skipBottom: true, topCol: LAWN });
    const x2 = sx * 2.1; const z2 = sz * (paved + 0.15); const z3 = sz * (inner - 0.1); const x3 = sx * (paved + 0.15);
    stone.box(Math.min(x2, x3), PLAZA, Math.min(z2, z3), Math.max(x2, x3), PLAZA + 0.04, Math.max(z2, z3), times(LAWN, 0.8), { skipBottom: true, topCol: LAWN });
    // One texel inside one paving cell for all the grass, or the tile's joints draw across the lawn.
    for (let i = lawnFrom; i < stone.t.length; i += 1) stone.t[i] = 0.4;
    // The pier: two courses of dressed masonry under each leg, wider than the iron so the foot's
    // whole box-lattice stands clear on it.
    const cx = sx * (outer(0) - legW(0) / 2); const cz = sz * (outer(0) - legW(0) / 2);
    const w = legW(0) / 2 + 0.3;
    const STONE_A = lin(0xbdb4a2); const STONE_B = lin(0xcbc3b1);
    stone.box(cx - w, PLAZA, cz - w, cx + w, 0.3, cz + w, STONE_A, { skipBottom: true, topCol: STONE_B });
    const w2 = w - 0.1;
    stone.box(cx - w2, 0.3, cz - w2, cx + w2, PIER, cz + w2, STONE_B, { skipBottom: true, topCol: times(STONE_B, 1.04) });
  }

  const ironMesh = mesh(iron.geometry(), standard({ vertexColors: true, roughness: 0.66, metalness: 0.12 }));
  const stoneMesh = mesh(stone.geometry(), stoneMaterial(repeatFeet(pavingTile(31), 8), { bumpScale: 0.3 }));
  return group(ironMesh, stoneMesh);
}

// ---------------------------------------------------------------------------
// A stretch of the Great Wall, about 1/8
// ---------------------------------------------------------------------------

// A broken stone as a pure function of direction, so a shared corner moves the same from every
// triangle that owns it. FRACTURE is the support function of a convex polyhedron: the distance to a
// set of cutting planes along d is min(h / (d . n)) over the planes facing that way.
function brokenRock(seed, radii, { detail = 3, cuts = 9, cutDepth = [0.62, 0.92], lobes = 0.16, crease = 34 } = {}) {
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
  const out = toCreasedNormals(g, (crease * Math.PI) / 180);
  const P = out.attributes.position;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i += 1) { uv[i * 2] = P.getX(i) + P.getZ(i) * 0.62; uv[i * 2 + 1] = P.getY(i) + P.getZ(i) * 0.37; }
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Grass as a near-white speckle: blades too fine for any vertex, multiplied by the ground's colour.
function grassTile(seed, size = 512) {
  const rng = seededRandom(seed);
  const tex = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#e4e6d4';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5200; i += 1) {
      const x = rng() * w; const y = rng() * h;
      const v = 150 + rng() * 105;
      ctx.strokeStyle = `rgba(${v * (0.86 + rng() * 0.2)},${v},${v * (0.62 + rng() * 0.2)},${0.3 + rng() * 0.5})`;
      ctx.lineWidth = 0.7 + rng() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rng() - 0.5) * 7, y - 2 - rng() * 7);
      ctx.stroke();
    }
  });
  return tex;
}

function brickTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6e685e';
    ctx.fillRect(0, 0, w, h);
    const courses = 44;
    const ch = h / courses;
    for (let r = 0; r < courses; r += 1) {
      const shift = (r % 2) * 11;
      for (let x = -22; x < w; x += 22) {
        const v = 205 + rng() * 50;
        ctx.fillStyle = `rgb(${v},${v * 0.975},${v * 0.93})`;
        ctx.fillRect(x + shift + 1, r * ch + 1.3, 20.4, ch - 2.6);
        // Wrapped so the tile's own seam is invisible.
        if (x + shift + 22 > w) ctx.fillRect(x + shift + 1 - w, r * ch + 1.3, 20.4, ch - 2.6);
      }
    }
    for (let i = 0; i < 1400; i += 1) {
      const v = 90 + rng() * 100;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.92},${0.1 + rng() * 0.24})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
    }
  });
}

// Long dressed blocks in level courses of slightly different heights.
function ashlarTile(seed, { courses = 16, minLen = 60, spread = 90, joint = 'rgba(58,52,44,0.62)', jointW = 2.4, moss = 0 } = {}) {
  const rng = seededRandom(seed);
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#e6e1d4';
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    const ch = h / courses;
    for (let r = 0; r < courses; r += 1) {
      const rowH = r === courses - 1 ? h - y : ch * (0.84 + rng() * 0.32);
      const offset = rng() * w;
      const seams = [];
      let x = 0;
      while (x < w - minLen * 0.6) {
        const len = Math.min(w - x, minLen + rng() * spread);
        const v = 208 + rng() * 44;
        ctx.fillStyle = `rgb(${v},${v * 0.98},${v * 0.93})`;
        const px = (x + offset) % w;
        ctx.fillRect(px, y, len, rowH);
        if (px + len > w) ctx.fillRect(px - w, y, len, rowH);
        seams.push(px);
        x += len;
      }
      ctx.fillStyle = joint;
      ctx.fillRect(0, y, w, jointW);
      for (const px of seams) ctx.fillRect(px, y, jointW, rowH);
      // Moss lives in the joints, which is where damp and grit collect: a soft green smear along
      // each bed joint, patchy rather than ruled.
      if (moss) {
        for (let k = 0; k < 16; k += 1) {
          const mx = rng() * w; const len = 20 + rng() * 80;
          ctx.fillStyle = `rgba(${96 + rng() * 40},${118 + rng() * 40},${58 + rng() * 26},${moss * (0.3 + rng() * 0.6)})`;
          ctx.fillRect(mx, y - 1, len, 3 + rng() * 5);
          if (mx + len > w) ctx.fillRect(mx - w, y - 1, len, 3 + rng() * 5);
        }
      }
      y += rowH;
    }
    for (let i = 0; i < 4000; i += 1) {
      const v = 110 + rng() * 90;
      ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.86},${0.08 + rng() * 0.22})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
    }
  });
}

function greatWall() {
  const rng = seededRandom(1368);
  const brick = new Soup();
  const stone = new Soup();
  const X_END = 20;

  // The ridge line: two high points with a saddle between, falling away at both ends.
  const crest = pchip([[-21, 0.34], [-18.5, 0.75], [-15.5, 2.8], [-12.6, 5.5], [-11, 6.05], [-9.4, 5.6], [-6, 4.05], [-2, 2.95], [0.4, 2.75], [3.5, 3.15], [7, 4.35], [9.6, 5.2], [11, 5.5], [12.4, 5.05], [15, 3.1], [17.8, 1.15], [21, 0.4]]);
  const wz = (x) => 0.75 * Math.sin(x * 0.17 + 0.5) + 0.35 * Math.sin(x * 0.07 - 1);
  const dwz = (x) => (wz(x + 0.01) - wz(x - 0.01)) / 0.02;
  const frame = (x) => {
    const T = norm([1, 0, dwz(x)]);
    return { T, N: [-T[2], 0, T[0]] };
  };

  const TOWERS = [{ x: -11, hut: true }, { x: 11, hut: false }];
  const TOWER_HALF = 2.12;
  const WALL_H = 2.35; // ground to walkway, 19ft at 1/8; the real thing runs about 20-26ft
  const baseWalk = (x) => crest(x) + WALL_H;
  // The walkway runs level for the last stretch into each tower, because a door has a sill.
  const walk = (x) => {
    let y = baseWalk(x);
    for (const t of TOWERS) {
      const k = 1 - sstep(Math.abs(x - t.x), TOWER_HALF + 0.15, TOWER_HALF + 1.7);
      y = mix(y, baseWalk(t.x), k);
    }
    return y;
  };
  const PARAPET = 0.62;
  const top = (x) => walk(x) + PARAPET;
  const HALF_WALK = 0.92;
  const HALF_OUT = 1.15;
  const BATTER = 0.055;

  // --- the ground ----------------------------------------------------------------------------------
  const ridgeDist = (x, z) => Math.abs(z - wz(x));
  // A jittered grid of rock cells. Each carries its own height and tilt, so a stretch of rock breaks
  // into blocks with cracks between them instead of rolling like a dune: a colour alone on a smooth
  // slope reads as sand, which is what the first pass did.
  const hash2 = (i, j, k) => { const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return v - Math.floor(v); };
  const rockCell = (x, z) => {
    const S = 1.15;
    const gx = x / S; const gz = z / (S * 0.8);
    const ci = Math.floor(gx); const cj = Math.floor(gz);
    let f1 = 1e9; let f2 = 1e9; let id = [0, 0];
    for (let j = cj - 1; j <= cj + 1; j += 1) {
      for (let i = ci - 1; i <= ci + 1; i += 1) {
        const px = i + hash2(i, j, 1); const pz = j + hash2(i, j, 2);
        const d = Math.hypot(gx - px, gz - pz);
        if (d < f1) { f2 = f1; f1 = d; id = [i, j]; } else if (d < f2) f2 = d;
      }
    }
    return { edge: f2 - f1, h: hash2(id[0], id[1], 3), tx: hash2(id[0], id[1], 4) - 0.5, tz: hash2(id[0], id[1], 5) - 0.5 };
  };
  const rockMask = (x, z) => {
    const d = ridgeDist(x, z);
    const n = smoothNoise3(x * 0.34 + 9, 7, z * 0.52) * 0.72 + smoothNoise3(x * 1.1 + 2, 3, z * 1.1) * 0.28;
    return sstep(n, 0.47, 0.57) * sstep(d, 1.55, 2.2) * sstep(Math.min(X_END + 0.9 - Math.abs(x), 5.4 - Math.abs(z)), 0.05, 0.9);
  };
  const groundH = (x, z) => {
    const d = ridgeDist(x, z);
    const k = sstep(d, 1.65, 5.9);
    let h = crest(x) * (1 - k) ** 1.25;
    const off = sstep(d, 1.55, 2.3);
    const edge = sstep(Math.min(X_END + 0.9 - Math.abs(x), 5.4 - Math.abs(z)), 0.05, 1.1);
    h += (smoothNoise3(x * 0.8, 3, z * 0.8) - 0.5) * 0.4 * off * edge;
    h += (smoothNoise3(x * 2.3, 5, z * 2.3) - 0.5) * 0.12 * off * edge;
    const m = rockMask(x, z);
    if (m > 0) {
      const c = rockCell(x, z);
      // Blocks stand proud, each with its own tilt, and drop into a crack at the cell's edge.
      const proud = 0.05 + c.h * 0.26 + c.tx * (x % 1.15) * 0.22 + c.tz * (z % 0.92) * 0.22;
      h += m * (proud - (1 - sstep(c.edge, 0.02, 0.12)) * 0.13);
    }
    return Math.max(0.14, h);
  };

  const NX = 230; const NZ = 60;
  const X0 = -X_END - 0.8; const X1 = X_END + 0.8; const Z0 = -5.3; const Z1 = 5.3;
  const G_POS = []; const G_COL = []; const G_UV = []; const G_IDX = [];
  const GRASS_A = lin(0x46592c); const GRASS_B = lin(0x5d6e34); const GRASS_C = lin(0x7a7a48);
  const ROCK_A = lin(0x646466); const ROCK_B = lin(0x8f8f8e);
  const EARTH = lin(0x7d6c50);
  for (let j = 0; j <= NZ; j += 1) {
    for (let i = 0; i <= NX; i += 1) {
      const x = mix(X0, X1, i / NX); const z = mix(Z0, Z1, j / NZ);
      const y = groundH(x, z);
      G_POS.push(x, y, z);
      G_UV.push(x, z);
      const n1 = smoothNoise3(x * 0.5, 2, z * 0.5);
      const n2 = smoothNoise3(x * 1.4 + 20, 4, z * 1.4);
      let c = mix3(mix3(GRASS_A, GRASS_B, n1), GRASS_C, sstep(n2, 0.55, 0.8) * 0.7);
      const mask = rockMask(x, z);
      if (mask > 0) {
        const cell = rockCell(x, z);
        const rock = times(mix3(ROCK_A, ROCK_B, cell.h), 0.34 + 0.66 * sstep(cell.edge, 0.02, 0.17));
        c = mix3(c, rock, sstep(mask, 0.12, 0.6));
      }
      const d = ridgeDist(x, z);
      c = mix3(c, EARTH, (1 - sstep(d, 1.3, 2.1)) * 0.9);
      G_COL.push(...c);
    }
  }
  const row = NX + 1;
  for (let j = 0; j < NZ; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const a = j * row + i; const b = a + 1; const c = a + row; const d = c + 1;
      G_IDX.push(a, c, b, b, c, d);
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setIndex(G_IDX);
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(G_POS, 3));
  groundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(G_UV, 2));
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(G_COL, 3));
  groundGeo.computeVertexNormals();
  // Crisp arrises on the rock and soft rolls in the grass, from one crease angle.
  const creasedGround = toCreasedNormals(groundGeo, (38 * Math.PI) / 180);
  // The cut sides of the display block, showing the ridge's rock in section.
  const skirt = new Soup();
  const skirtCol = (y) => mix3(lin(0x6d6556), lin(0x8d8471), 0.5 + 0.5 * Math.sin(y * 7));
  const edgeRun = (ax, az, bx, bz, n, hint) => {
    for (let i = 0; i < n; i += 1) {
      const x0 = mix(ax, bx, i / n); const z0 = mix(az, bz, i / n); const x1 = mix(ax, bx, (i + 1) / n); const z1 = mix(az, bz, (i + 1) / n);
      const y0 = groundH(x0, z0); const y1 = groundH(x1, z1);
      skirt.face([[x0, 0, z0], [x1, 0, z1], [x1, y1, z1], [x0, y0, z0]], [skirtCol(0), skirtCol(0), skirtCol(y1), skirtCol(y0)], hint);
    }
  };
  edgeRun(X0, Z1, X1, Z1, NX, [0, 0, 1]);
  edgeRun(X0, Z0, X1, Z0, NX, [0, 0, -1]);
  edgeRun(X1, Z0, X1, Z1, NZ, [1, 0, 0]);
  edgeRun(X0, Z0, X0, Z1, NZ, [-1, 0, 0]);

  const groundParts = [{ geometry: creasedGround, keepColor: true }, { geometry: skirt.geometry(), keepColor: true }];

  // Boulders shouldering out of the slope, sunk well in.
  for (let i = 0; i < 18; i += 1) {
    const x = mix(X0 + 1.4, X1 - 1.4, rng());
    const side = rng() > 0.5 ? 1 : -1;
    const d = 2.1 + rng() * 2.6;
    const z = wz(x) + side * d;
    if (Math.abs(z) > 4.8) continue;
    const r = 0.34 + rng() * 0.62;
    const y = groundH(x, z) + r * 0.08;
    const g = brokenRock(40 + i, [r * (0.9 + rng() * 0.5), r * (0.55 + rng() * 0.3), r * (0.8 + rng() * 0.4)], { detail: 3, cuts: 8 });
    const c1 = lin(0x8b8678); const c2 = lin(0x65615a); const lich = lin(0x8d8f5a);
    const seed = rng() * 20;
    tintVertices(g, (px, py, pz, out) => {
      const n = smoothNoise3(px * 2.4 + seed, py * 2.4, pz * 2.4);
      const c = mix3(mix3(c2, c1, n), lich, sstep(smoothNoise3(px * 5 + seed, py * 5, pz * 5), 0.66, 0.78) * 0.7);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 6.28, (rng() - 0.5) * 0.5));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    groundParts.push({ geometry: g, keepColor: true });
  }

  // Scrub: a few puffs to a bush, on the gentler ground, the mountains' oak and thorn.
  const shrubLeaf = [lin(0x2f4620), lin(0x3f5825), lin(0x53692c)];
  let planted = 0;
  for (let i = 0; i < 120 && planted < 32; i += 1) {
    const x = mix(X0 + 0.8, X1 - 0.8, rng());
    const z = mix(Z0 + 0.5, Z1 - 0.5, rng());
    if (ridgeDist(x, z) < 2.0 || rockMask(x, z) > 0.3) continue;
    if (TOWERS.some((t) => Math.hypot(x - t.x, z - wz(t.x)) < TOWER_HALF + 0.8)) continue;
    const y = groundH(x, z);
    const R = 0.2 + rng() * 0.26;
    const puffs = 3 + Math.floor(rng() * 2);
    const base = shrubLeaf[Math.floor(rng() * 3)];
    planted += 1;
    for (let p = 0; p < puffs; p += 1) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const P = g.attributes.position; const Nn = g.attributes.normal;
      const seed = rng() * 40;
      const rr = R * (0.7 + rng() * 0.5);
      const ox = (rng() - 0.5) * R * 1.3; const oz = (rng() - 0.5) * R * 1.3; const oy = rr * 0.55 + rng() * R * 0.5;
      const col = new Float32Array(P.count * 3);
      for (let v = 0; v < P.count; v += 1) {
        const d = norm([P.getX(v), P.getY(v), P.getZ(v)]);
        // Twigs and clumps of leaf: a rough outline, and the darks going deep between them.
        const leaf = smoothNoise3(d[0] * 3.4 + seed, d[1] * 3.4, d[2] * 3.4);
        const k = 0.82 + leaf * 0.42;
        P.setXYZ(v, x + ox + d[0] * rr * k, y + oy + d[1] * rr * k * 0.82 - rr * 0.1, z + oz + d[2] * rr * k);
        Nn.setXYZ(v, d[0], d[1], d[2]);
        const c = times(base, (0.5 + 0.55 * (d[1] * 0.5 + 0.5)) * (0.55 + leaf * 0.9));
        col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      groundParts.push({ geometry: g, keepColor: true });
    }
  }

  // --- the wall's faces ---------------------------------------------------------------------------
  const STATION = 0.2;
  const STONE_FACE = lin(0xa89f8a);
  const BRICK = lin(0x8f8778);
  const CORE = lin(0x6f6350);
  const tone = (base, x, y, k = 0) => {
    const n = smoothNoise3(x * 0.55 + k, y * 0.6, 3 + k);
    return times(base, 0.84 + n * 0.3);
  };
  const footAt = (x, off) => {
    const { N } = frame(x);
    return groundH(x + N[0] * off, wz(x) + N[2] * off) - 0.6;
  };
  const P3 = (x, off, y) => {
    const { N } = frame(x);
    return [x + N[0] * off, y, wz(x) + N[2] * off];
  };
  const STEPS = Math.round((2 * X_END) / STATION);
  for (let i = 0; i < STEPS; i += 1) {
    const x0 = -X_END + i * STATION; const x1 = x0 + STATION;
    for (const s of [1, -1]) {
      const hint = scl(frame(x0).N, s);
      const offAt = (x, y) => s * (HALF_OUT + BATTER * (top(x) - y));
      const yTop0 = top(x0); const yTop1 = top(x1);
      const yB0 = yTop0 - 1.4; const yB1 = yTop1 - 1.4;
      const f0 = Math.min(footAt(x0, s * 1.5), footAt(x0, s * 1.1)); const f1 = Math.min(footAt(x1, s * 1.5), footAt(x1, s * 1.1));
      // Upper courses of brick.
      brick.face([P3(x0, offAt(x0, yB0), yB0), P3(x1, offAt(x1, yB1), yB1), P3(x1, offAt(x1, yTop1), yTop1), P3(x0, offAt(x0, yTop0), yTop0)],
        [tone(BRICK, x0, yB0), tone(BRICK, x1, yB1), tone(BRICK, x1, yTop1), tone(BRICK, x0, yTop0)], hint,
        { uv: [[x0, yB0], [x1, yB1], [x1, yTop1], [x0, yTop0]] });
      // Lower courses of dressed stone, running down past the ground line so the wall cannot float.
      stone.face([P3(x0, offAt(x0, f0), f0), P3(x1, offAt(x1, f1), f1), P3(x1, offAt(x1, yB1), yB1), P3(x0, offAt(x0, yB0), yB0)],
        [tone(STONE_FACE, x0, f0, 5), tone(STONE_FACE, x1, f1, 5), tone(STONE_FACE, x1, yB1, 5), tone(STONE_FACE, x0, yB0, 5)], hint,
        { uv: [[x0, f0], [x1, f1], [x1, yB1], [x0, yB0]] });
      // Inside face of the parapet: from below the treads up to the coping.
      const iLow0 = walk(x0) - 0.3; const iLow1 = walk(x1) - 0.3;
      brick.face([P3(x0, s * HALF_WALK, iLow0), P3(x1, s * HALF_WALK, iLow1), P3(x1, s * HALF_WALK, yTop1), P3(x0, s * HALF_WALK, yTop0)],
        [tone(BRICK, x0, iLow0, 2), tone(BRICK, x1, iLow1, 2), tone(BRICK, x1, yTop1, 2), tone(BRICK, x0, yTop0, 2)], scl(hint, -1),
        { uv: [[x0, iLow0], [x1, iLow1], [x1, yTop1], [x0, yTop0]] });
      // Coping along the top of the parapet.
      const copeC = times(BRICK, 1.08);
      brick.face([P3(x0, s * HALF_WALK, yTop0), P3(x1, s * HALF_WALK, yTop1), P3(x1, offAt(x1, yTop1), yTop1), P3(x0, offAt(x0, yTop0), yTop0)], copeC, [0, 1, 0]);
    }
  }

  // The cut ends of the stretch, showing what a Ming wall is: a brick and stone skin round a core of
  // rammed earth and rubble.
  for (const [x, sign] of [[-X_END, -1], [X_END, 1]]) {
    const yTop = top(x);
    const f = Math.min(footAt(x, 1.3), footAt(x, -1.3));
    const offT = HALF_OUT; const offB = HALF_OUT + BATTER * (yTop - f);
    const hint = [sign, 0, 0];
    const skin = 0.26;
    stone.face([P3(x, -offB, f), P3(x, -offB + skin, f), P3(x, -offT + skin, yTop), P3(x, -offT, yTop)], STONE_FACE, hint);
    stone.face([P3(x, offB - skin, f), P3(x, offB, f), P3(x, offT, yTop), P3(x, offT - skin, yTop)], STONE_FACE, hint);
    stone.face([P3(x, -offB + skin, f), P3(x, offB - skin, f), P3(x, offT - skin, yTop), P3(x, -offT + skin, yTop)], CORE, hint, { uv: [[0.1, 0.1], [0.1, 0.1], [0.1, 0.1], [0.1, 0.1]] });
  }

  // --- the walkway: a tread and a riser where it climbs, a ramp where it does not ------------------
  const RISER = 0.135;
  const MAX_RUN = 0.62;
  const flag = lin(0x9d9584);
  const flagAlt = lin(0xb0a896);
  const treadCol = () => mix3(flag, flagAlt, rng());
  const WORN = 0.012;
  let tx = -X_END;
  while (tx < X_END - 1e-3) {
    const y0 = walk(tx);
    let tx1 = Math.min(X_END, tx + MAX_RUN);
    let stair = false;
    for (let probe = tx + 0.03; probe <= tx + MAX_RUN; probe += 0.015) {
      if (Math.abs(walk(probe) - y0) >= RISER) { tx1 = probe; stair = true; break; }
    }
    if (tx1 > X_END) tx1 = X_END;
    const y1 = walk(tx1);
    const yA = y0; const yB = stair ? y0 : y1;
    // Three strips across the tread so the middle can be worn lower than the edges.
    const offs = [-HALF_WALK - 0.02, -HALF_WALK * 0.42, HALF_WALK * 0.42, HALF_WALK + 0.02];
    const dip = [0, -WORN, -WORN, 0];
    const col = treadCol();
    for (let k = 0; k < 3; k += 1) {
      stone.face([
        P3(tx, offs[k], yA + dip[k]), P3(tx1, offs[k], yB + dip[k]), P3(tx1, offs[k + 1], yB + dip[k + 1]), P3(tx, offs[k + 1], yA + dip[k + 1]),
      ], col, [0, 1, 0]);
    }
    if (stair) {
      const up = y1 > y0;
      const hint = up ? [-1, 0, 0] : [1, 0, 0];
      const lo = Math.min(y0, y1) - WORN - 0.01; const hi = Math.max(y0, y1);
      const riserC = times(col, 0.72);
      stone.face([P3(tx1, offs[0], lo), P3(tx1, offs[3], lo), P3(tx1, offs[3], hi), P3(tx1, offs[0], hi)], riserC, hint);
    }
    tx = tx1;
  }

  // --- merlons, on both parapets --------------------------------------------------------------------
  const MERLON_STEP = 1.0;
  const nearTower = (x, pad) => TOWERS.some((t) => Math.abs(x - t.x) < TOWER_HALF + pad);
  const HOLE = [0.02, 0.018, 0.016];
  for (const s of [1, -1]) {
    // The enemy side (+Z) stands taller and is pierced with shooting holes.
    const tall = s > 0;
    const H = tall ? 0.5 : 0.32;
    const WIDTH = tall ? 0.56 : 0.48;
    let x = -X_END + 0.36 + (s > 0 ? 0 : 0.22);
    while (x < X_END - 0.3) {
      if (!nearTower(x, 0.45)) {
        const xa = x - WIDTH / 2; const xb = x + WIDTH / 2;
        const inner = s * (HALF_WALK - 0.012); const outerA = s * (HALF_OUT + 0.014); const outerB = outerA;
        const yA = top(xa) - 0.04; const yB = top(xb) - 0.04;
        const bottom = [P3(xa, inner, yA), P3(xb, inner, yB), P3(xb, outerB, yB), P3(xa, outerA, yA)];
        const tops = [P3(xa, inner, yA + 0.04 + H), P3(xb, inner, yB + 0.04 + H), P3(xb, outerB, yB + 0.04 + H), P3(xa, outerA, yA + 0.04 + H)];
        brick.hexa(bottom, tops, tone(BRICK, x, yA, 1), { skipBottom: true, topCol: times(BRICK, 1.12) });
        if (tall) {
          // A dark slit each way through the merlon, a hair proud, framed by its own shadow.
          const ym = yA + 0.04 + H * 0.5; const hw = 0.055; const hh = 0.09;
          const n = scl(frame(x).N, s);
          brick.face([P3(x - hw, outerA + s * 0.004, ym - hh), P3(x + hw, outerA + s * 0.004, ym - hh), P3(x + hw, outerA + s * 0.004, ym + hh), P3(x - hw, outerA + s * 0.004, ym + hh)], HOLE, n);
          brick.face([P3(x - hw, inner - s * 0.004, ym - hh), P3(x + hw, inner - s * 0.004, ym - hh), P3(x + hw, inner - s * 0.004, ym + hh), P3(x - hw, inner - s * 0.004, ym + hh)], HOLE, scl(n, -1));
        }
      }
      x += MERLON_STEP;
    }
  }

  // Stone waterspouts through the inner wall, which real stretches carry to drain the walkway.
  for (let x = -18; x < 19; x += 4.6) {
    if (nearTower(x, 0.5)) continue;
    const y = walk(x) - 0.42;
    stone.bar(P3(x, -HALF_OUT - 0.02, y), P3(x, -HALF_OUT - 0.34, y - 0.03), 0.042, [0, 1, 0], lin(0xb7ae9a));
  }

  // --- the watchtowers ------------------------------------------------------------------------------
  const CHAMBER = 2.3;
  for (const t of TOWERS) {
    const ox = t.x; const oz = wz(t.x);
    const { T, N } = frame(t.x);
    const f = (a, b, y) => [ox + T[0] * a + N[0] * b, y, oz + T[2] * a + N[2] * b];
    const lbox = (soup, a0, a1, b0, b1, y0, y1, col, opts) => soup.hexa(
      [f(a0, b0, y0), f(a1, b0, y0), f(a1, b1, y0), f(a0, b1, y0)],
      [f(a0, b0, y1), f(a1, b0, y1), f(a1, b1, y1), f(a0, b1, y1)],
      col,
      opts,
    );
    const floorY = walk(t.x);
    const H = TOWER_HALF;
    let footY = 1e9;
    for (const [a, b] of [[-H, -H], [H, -H], [H, H], [-H, H], [0, H], [0, -H], [H, 0], [-H, 0]]) {
      const p = f(a, b, 0);
      footY = Math.min(footY, groundH(p[0], p[2]));
    }
    footY -= 0.6;
    // A stone base, flared a little, up to the floor of the chamber.
    const flare = 0.1;
    const stoneC = mix3(STONE_FACE, lin(0xb6ad99), 0.5);
    stone.hexa(
      [f(-H - flare, -H - flare, footY), f(H + flare, -H - flare, footY), f(H + flare, H + flare, footY), f(-H - flare, H + flare, footY)],
      [f(-H, -H, floorY), f(H, -H, floorY), f(H, H, floorY), f(-H, H, floorY)],
      stoneC,
      { skipBottom: true },
    );
    lbox(stone, -H - 0.05, H + 0.05, -H - 0.05, H + 0.05, floorY - 0.02, floorY + 0.09, lin(0xbfb6a2), { skipBottom: false });

    // Four brick walls with their arched openings cut in them for real.
    const faces = [
      { out: N, ux: T, sign: 1, openings: 'side' },
      { out: scl(N, -1), ux: T, sign: -1, openings: 'side' },
      { out: T, ux: N, sign: 1, openings: 'end' },
      { out: scl(T, -1), ux: N, sign: -1, openings: 'end' },
    ];
    const w = 2 * H;
    for (const face of faces) {
      const o = [ox + face.out[0] * H - face.ux[0] * H, floorY + 0.09, oz + face.out[2] * H - face.ux[2] * H];
      const openings = face.openings === 'side'
        ? [0.22, 0.5, 0.78].map((k) => ({ cx: w * k, y0: 0.78, y1: 1.42, w: 0.58, arch: true }))
        : [{ cx: w * 0.5, y0: 0, y1: 1.12, w: 0.92, arch: true }, { cx: w * 0.17, y0: 0.95, y1: 1.46, w: 0.46, arch: true }, { cx: w * 0.83, y0: 0.95, y1: 1.46, w: 0.46, arch: true }];
      wallWithOpenings(brick, o, face.ux, [0, 1, 0], face.out, w, CHAMBER - 0.09, openings, {
        col: BRICK,
        depth: 0.34,
        reveal: times(BRICK, 0.7),
        rim: 0.1,
        rimCol: lin(0xb3aa96),
        uvOrigin: [ox, floorY],
      });
    }
    // The top: a stone cornice, a flat roof, and a crenellated parapet all the way round.
    const yRoof = floorY + CHAMBER;
    lbox(stone, -H - 0.09, H + 0.09, -H - 0.09, H + 0.09, yRoof, yRoof + 0.12, lin(0xbfb6a2), {});
    const P_H = 0.36;
    const yP = yRoof + 0.12;
    const IN = 0.2;
    const bar = (a0, a1, b0, b1) => lbox(brick, a0, a1, b0, b1, yP, yP + P_H, BRICK, { skipBottom: true, topCol: times(BRICK, 1.1) });
    bar(-H, H, H - IN, H); bar(-H, H, -H, -H + IN); bar(H - IN, H, -H + IN, H - IN); bar(-H, -H + IN, -H + IN, H - IN);
    lbox(stone, -H + IN, H - IN, -H + IN, H - IN, yP - 0.01, yP + 0.05, lin(0xa59c8a), { skipBottom: true });
    const merlons = 7;
    const MW = 0.32;
    for (let m = 0; m < merlons; m += 1) {
      const u = -H + MW / 2 + ((2 * H - MW) * m) / (merlons - 1);
      const y0 = yP + P_H - 0.01; const y1 = yP + P_H + 0.38;
      lbox(brick, u - MW / 2, u + MW / 2, H - IN, H, y0, y1, BRICK, { skipBottom: true, topCol: times(BRICK, 1.12) });
      lbox(brick, u - MW / 2, u + MW / 2, -H, -H + IN, y0, y1, BRICK, { skipBottom: true, topCol: times(BRICK, 1.12) });
      if (m > 0 && m < merlons - 1) {
        lbox(brick, H - IN, H, u - MW / 2, u + MW / 2, y0, y1, BRICK, { skipBottom: true, topCol: times(BRICK, 1.12) });
        lbox(brick, -H, -H + IN, u - MW / 2, u + MW / 2, y0, y1, BRICK, { skipBottom: true, topCol: times(BRICK, 1.12) });
      }
    }
    // Some towers carry a small guard hut on the roof; one does here, for the sake of comparison.
    if (t.hut) {
      const hH = 0.62; const hA = 0.72; const hB = 0.52;
      const yBase = yP + 0.05;
      lbox(brick, -hA, hA, -hB, hB, yBase, yBase + hH, times(BRICK, 1.02), { skipBottom: true });
      const r0 = yBase + hH; const r1 = r0 + 0.42; const over = 0.12;
      const roofC = lin(0x5f5a52);
      brick.face([f(-hA - over, -hB - over, r0), f(hA + over, -hB - over, r0), f(hA + over, 0, r1), f(-hA - over, 0, r1)], roofC, [0, 1, -0.3]);
      brick.face([f(-hA - over, hB + over, r0), f(hA + over, hB + over, r0), f(hA + over, 0, r1), f(-hA - over, 0, r1)], roofC, [0, 1, 0.3]);
      brick.face([f(-hA, -hB, r0), f(-hA, hB, r0), f(-hA, 0, r1)], times(BRICK, 0.9), scl(T, -1));
      brick.face([f(hA, -hB, r0), f(hA, hB, r0), f(hA, 0, r1)], times(BRICK, 0.9), T);
      brick.face([f(-0.13, hB + 0.006, yBase), f(0.13, hB + 0.006, yBase), f(0.13, hB + 0.006, yBase + 0.44), f(-0.13, hB + 0.006, yBase + 0.44)], HOLE, N);
    }
  }

  const groundMesh = mesh(mergeParts(groundParts), standard({
    vertexColors: true, map: repeatFeet(grassTile(11), 3.2), roughness: 1, metalness: 0, ...relief('soil', { seed: 53, repeat: 6, strength: 1.2 }),
  }));
  const brickMesh = mesh(brick.geometry(), stoneMaterial(repeatFeet(brickTile(21), 2.2), { bumpScale: 0.35 }));
  const stoneMesh = mesh(stone.geometry(), stoneMaterial(repeatFeet(ashlarTile(13, { courses: 18 }), 4.4), { bumpScale: 0.45 }));
  return group(groundMesh, brickMesh, stoneMesh);
}

// ---------------------------------------------------------------------------
// The Leaning Tower of Pisa, 1/8
// ---------------------------------------------------------------------------

// A conical band of a turned surface, walked BOTTOM-UP on the outside: a band going outward along
// the underside of a cornice faces down, one coming back inward along its top faces up, and the
// normal comes from that direction of travel, so no band can come out inside out.
function band(soup, r0, y0, r1, y1, seg, col, { col1 = null, smooth = true, a0 = 0, a1 = Math.PI * 2 } = {}) {
  const dr = r1 - r0; const dy = y1 - y0;
  const len = Math.hypot(dr, dy) || 1;
  const nr = dy / len; const ny = -dr / len;
  for (let i = 0; i < seg; i += 1) {
    const u0 = mix(a0, a1, i / seg); const u1 = mix(a0, a1, (i + 1) / seg);
    const s0 = Math.sin(u0); const k0 = Math.cos(u0); const s1 = Math.sin(u1); const k1 = Math.cos(u1);
    const n0 = [s0 * nr, ny, k0 * nr]; const n1 = [s1 * nr, ny, k1 * nr];
    const pts = [[s0 * r0, y0, k0 * r0], [s1 * r0, y0, k1 * r0], [s1 * r1, y1, k1 * r1], [s0 * r1, y1, k0 * r1]];
    const rm = (Math.abs(r0) + Math.abs(r1)) / 2;
    const hint = [(s0 + s1) * nr, ny * 2, (k0 + k1) * nr];
    const c1 = col1 ?? col;
    const uv = [[u0 * rm, y0], [u1 * rm, y0], [u1 * rm, y1], [u0 * rm, y1]];
    const opts = smooth ? { normals: [n0, n1, n1, n0], uv } : { uv };
    if (r0 < 1e-5) soup.face([pts[0], pts[2], pts[3]], [col, c1, c1], hint, smooth ? { normals: [n0, n1, n0], uv: [uv[0], uv[2], uv[3]] } : {});
    else if (r1 < 1e-5) soup.face([pts[0], pts[1], pts[2]], [col, col, c1], hint, smooth ? { normals: [n0, n1, n1], uv: [uv[0], uv[1], uv[2]] } : {});
    else soup.face(pts, [col, col, c1, c1], hint, opts);
  }
}

// One ring of round-headed arches, standing on columns, with a wall from the arch up to `yTop`:
// a gallery's arcade and, with its back against the wall, the ground storey's blind one.
function arcadeRing(soup, {
  count, rOut, rIn, spring, rho, yTop, phase = 0, col, rimCol, soffitCol, K = 8, rim = 0.045,
}) {
  const step = (Math.PI * 2) / count;
  const rM = (rOut + rIn) / 2;
  for (let b = 0; b < count; b += 1) {
    const ac = phase + (b + 0.5) * step;
    const edge = step / 2;
    // The opening's outline left to right, in (angle, height): it starts and finishes at the bay's
    // edge at spring height, over the column's abacus, and rises round the arch between.
    const line = [[ac - edge, spring]];
    for (let i = 0; i <= K; i += 1) {
      const t = Math.PI - (i / K) * Math.PI;
      line.push([ac + (Math.cos(t) * rho) / rM, spring + Math.sin(t) * rho]);
    }
    line.push([ac + edge, spring]);
    const outer = line.map(([a, y], j) => {
      if (j === 0 || j === line.length - 1) return [a, y];
      const t = Math.PI - ((j - 1) / K) * Math.PI;
      return [ac + (Math.cos(t) * (rho + rim)) / rM, spring + Math.sin(t) * (rho + rim)];
    });
    const at = (a, y, r) => [Math.sin(a) * r, y, Math.cos(a) * r];
    for (let j = 0; j < line.length - 1; j += 1) {
      const [a0, y0] = line[j]; const [a1, y1] = line[j + 1];
      const [c0, v0] = outer[j]; const [c1, v1] = outer[j + 1];
      const am = (a0 + a1) / 2;
      const hint = [Math.sin(am), 0, Math.cos(am)];
      const n0 = [Math.sin(a0), 0, Math.cos(a0)]; const n1 = [Math.sin(a1), 0, Math.cos(a1)];
      const flatSpan = j === 0 || j === line.length - 2;
      if (!flatSpan) {
        // The archivolt: a little roll of moulding, which is what draws the arch in shadow.
        const midA0 = (a0 + c0) / 2; const midV0 = (y0 + v0) / 2; const midA1 = (a1 + c1) / 2; const midV1 = (y1 + v1) / 2;
        const lift = rOut + rim * 0.34;
        soup.face([at(a0, y0, rOut), at(a1, y1, rOut), at(midA1, midV1, lift), at(midA0, midV0, lift)], rimCol, hint);
        soup.face([at(midA0, midV0, lift), at(midA1, midV1, lift), at(c1, v1, rOut), at(c0, v0, rOut)], rimCol, hint);
      }
      const uv = [[a0 * rOut, v0], [a1 * rOut, v1], [a1 * rOut, yTop], [a0 * rOut, yTop]];
      soup.face([at(c0, v0, rOut), at(c1, v1, rOut), at(c1, yTop, rOut), at(c0, yTop, rOut)], col, hint, { normals: [n0, n1, n1, n0], uv });
      // The back of the ring, seen from the gallery looking out, and the arch's soffit.
      soup.face([at(a0, y0, rIn), at(a1, y1, rIn), at(a1, yTop, rIn), at(a0, yTop, rIn)], soffitCol, [-hint[0], 0, -hint[2]], { normals: [[-n0[0], 0, -n0[2]], [-n1[0], 0, -n1[2]], [-n1[0], 0, -n1[2]], [-n0[0], 0, -n0[2]]] });
      const mx = ((a0 + a1) / 2 - ac) * rM; const my = (y0 + y1) / 2 - spring;
      const tang = [Math.cos(am), 0, -Math.sin(am)];
      const inward = flatSpan ? [0, -1, 0] : add(scl(tang, -mx), [0, -my, 0]);
      soup.face([at(a0, y0, rOut), at(a1, y1, rOut), at(a1, y1, rIn), at(a0, y0, rIn)], soffitCol, inward);
    }
  }
}

// A column: plinth, attic base, shaft and a capital that flares to carry the arch.
function pisaColumn(soup, a, r, y0, height, radius, n, col, capCol, fine) {
  const cx = Math.sin(a) * r; const cz = Math.cos(a) * r;
  const c = [cx, cz];
  const op = { capTop: false };
  const R = radius;
  if (fine) {
    soup.frustum(c, y0 - 0.04, c, y0 + height * 0.025, R * 1.5, R * 1.5, n, capCol, op);
    soup.frustum(c, y0 + height * 0.025, c, y0 + height * 0.05, R * 1.5, R * 1.08, n, capCol, op);
    soup.frustum(c, y0 + height * 0.05, c, y0 + height * 0.5, R * 1.08, R * 1.0, n, col, op);
    soup.frustum(c, y0 + height * 0.5, c, y0 + height * 0.87, R * 1.0, R * 0.92, n, col, op);
    soup.frustum(c, y0 + height * 0.87, c, y0 + height * 0.95, R * 0.98, R * 1.34, n, capCol, op);
    soup.frustum(c, y0 + height * 0.95, c, y0 + height + 0.01, R * 1.5, R * 1.5, n, capCol, op);
  } else {
    soup.frustum(c, y0 - 0.04, c, y0 + height * 0.04, R * 1.45, R * 1.3, n, capCol, op);
    soup.frustum(c, y0 + height * 0.04, c, y0 + height * 0.88, R * 1.05, R * 0.94, n, col, op);
    soup.frustum(c, y0 + height * 0.88, c, y0 + height + 0.01, R * 1.08, R * 1.5, n, capCol, op);
  }
}

function pisaMarbleTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ebe8df';
    ctx.fillRect(0, 0, w, h);
    // Soft grey veining, wrapped so the tile has no seam.
    for (let i = 0; i < 30; i += 1) {
      const x0 = rng() * w; const y0 = rng() * h;
      ctx.strokeStyle = `rgba(${150 + rng() * 40},${148 + rng() * 40},${140 + rng() * 40},${0.08 + rng() * 0.2})`;
      ctx.lineWidth = 0.8 + rng() * 2;
      for (const [ox, oy] of [[0, 0], [-w, 0], [0, -h], [-w, -h]]) {
        const r2 = seededRandom(i + 11);
        let px = x0 + ox; let py = y0 + oy;
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (let k = 0; k < 9; k += 1) { px += 12 + r2() * 34; py += (r2() - 0.5) * 34; ctx.lineTo(px, py); }
        ctx.stroke();
      }
    }
    for (let i = 0; i < 2200; i += 1) {
      const v = 150 + rng() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.98},${v * 0.92},${0.06 + rng() * 0.18})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2.4, 1 + rng() * 2.4);
    }
  });
}

// The storeys tilt by slightly different amounts, and that is true of the real tower: the masons
// were already correcting for the lean as they built, making each new storey a little taller on
// its low side, so the finished shaft is faintly banana-shaped. These give 3.97 degrees overall.
const PISA_TILTS = [4.17, 4.15, 4.11, 4.06, 4.01, 3.93, 3.79, 3.47];
const PISA_LEAN_AXIS = new THREE.Vector3(0, 0, -1); // a positive turn about -Z tips +Y toward +X

function leaningTowerOfPisa() {
  const rng = seededRandom(1173);
  const WHITE = lin(0xdad6c9);
  const GREY = lin(0xaaa597);
  const RIM = lin(0xe6e3d8);
  const SHADE = lin(0x8d897c);
  const DARK = [0.02, 0.018, 0.016];
  const BASE_Y = 0.24;

  const marble = (k = 1) => times(WHITE, k * (0.95 + rng() * 0.08));
  const seg = 54;

  // Horizontal courses of white and grey marble on a wall, the tower's banding.
  const stripedWall = (soup, r, y0, y1, courseH, greyEvery, k = 1, segs = 48) => {
    const n = Math.max(1, Math.round((y1 - y0) / courseH));
    for (let i = 0; i < n; i += 1) {
      const a = mix(y0, y1, i / n); const b = mix(y0, y1, (i + 1) / n);
      const c = i % greyEvery === greyEvery - 1 ? times(GREY, k) : marble(k);
      band(soup, r, a, r, b, segs, c);
    }
  };

  // A curved plate lying just proud of a wall: a door, its frame or a lozenge.
  const archPlate = (soup, r, ac, w, y0, ySpring, col, n = 10) => {
    const half = w / 2;
    const headAt = (x) => ySpring + Math.sqrt(Math.max(0, half * half - x * x));
    for (let i = 0; i < n; i += 1) {
      const x0 = -half + (w * i) / n; const x1 = -half + (w * (i + 1)) / n;
      const a0 = ac + x0 / r; const a1 = ac + x1 / r;
      const n0 = [Math.sin(a0), 0, Math.cos(a0)]; const n1 = [Math.sin(a1), 0, Math.cos(a1)];
      soup.face(
        [[n0[0] * r, y0, n0[2] * r], [n1[0] * r, y0, n1[2] * r], [n1[0] * r, headAt(x1), n1[2] * r], [n0[0] * r, headAt(x0), n0[2] * r]],
        col,
        n0,
        { normals: [n0, n1, n1, n0] },
      );
    }
  };
  const lozenge = (soup, r, ac, y, w, h, col) => {
    const P = (x, yy) => { const a = ac + x / r; return [Math.sin(a) * r, yy, Math.cos(a) * r]; };
    soup.face([P(0, y - h), P(w, y), P(0, y + h), P(-w, y)], col, [Math.sin(ac), 0, Math.cos(ac)]);
  };

  // Small blocks carrying the cornice, the corbel table every storey of the real tower has.
  const corbels = (soup, r, y, n, col, phase = 0) => {
    const d = 0.1; const hh = 0.09; const hw = ((Math.PI * 2) / n) * r * 0.26;
    for (let i = 0; i < n; i += 1) {
      const a = phase + ((i + 0.5) / n) * Math.PI * 2;
      const c = [Math.sin(a), 0, Math.cos(a)]; const t = [Math.cos(a), 0, -Math.sin(a)];
      const q = (off, rad, yy) => [t[0] * off + c[0] * rad, yy, t[2] * off + c[2] * rad];
      soup.hexa(
        [q(-hw, r - 0.04, y), q(hw, r - 0.04, y), q(hw, r + d * 0.5, y), q(-hw, r + d * 0.5, y)],
        [q(-hw, r - 0.04, y + hh), q(hw, r - 0.04, y + hh), q(hw, r + d, y + hh), q(-hw, r + d, y + hh)],
        col,
      );
    }
  };

  // The cornice over a storey, walked bottom-up from the wall head to the floor above.
  const cornice = (soup, r, y, rFloor, k, h = 0.24) => {
    const c = marble(k);
    const c2 = times(WHITE, k * 1.03);
    band(soup, r, y, r + 0.05, y, seg, times(c, 0.8));
    band(soup, r + 0.05, y, r + 0.05, y + h * 0.42, seg, c);
    band(soup, r + 0.05, y + h * 0.42, r + 0.15, y + h * 0.62, seg, times(c, 0.9));
    band(soup, r + 0.15, y + h * 0.62, r + 0.17, y + h * 0.82, seg, c2);
    band(soup, r + 0.17, y + h * 0.82, r + 0.13, y + h, seg, c2);
    band(soup, r + 0.13, y + h, rFloor, y + h, seg, times(WHITE, k * 0.86));
  };

  const parts = [];
  const STOREYS = [];

  // --- the ground storey: solid, with fifteen blind arches on engaged columns --------------------
  {
    const soup = new Soup();
    const h = 4.55;
    const COUNT = 15;
    const rWall = 3.08;
    const rArc = 3.18;
    const step = (Math.PI * 2) / COUNT;
    const phase = -step / 2; // a bay centred on +Z, which is where the door goes
    const spring = 2.88;
    const rho = (step / 2) * ((rWall + rArc) / 2) - 0.12;
    const yTop = 4.25;
    // The plinth runs down below the paving, so the raised side of the lean shows stone, not a gap.
    band(soup, 0.01, -0.62, 3.42, -0.62, seg, DARK);
    band(soup, 3.42, -0.62, 3.42, 0.1, seg, times(WHITE, 0.74));
    band(soup, 3.42, 0.1, 3.3, 0.22, seg, times(WHITE, 0.84));
    band(soup, 3.3, 0.22, 3.3, 0.34, seg, marble(0.9));
    band(soup, 3.3, 0.34, rWall, 0.34, seg, marble(0.88));
    stripedWall(soup, rWall, 0.34, yTop, 0.24, 2, 0.9);
    arcadeRing(soup, {
      count: COUNT, rOut: rArc, rIn: rWall - 0.02, spring, rho, yTop, phase, col: marble(0.97), rimCol: times(RIM, 0.98), soffitCol: times(WHITE, 0.74), K: 14, rim: 0.07,
    });
    for (let i = 0; i < COUNT; i += 1) {
      pisaColumn(soup, phase + i * step, rArc - 0.03, 0.34, spring - 0.34, 0.125, 12, marble(0.98), times(RIM, 0.96), true);
      const ac = phase + (i + 0.5) * step;
      // Lozenge inlays in the head of each blind arch; the bay on +Z has the door instead.
      if (i !== 0) {
        for (const [dx, dy] of [[0, 0.28], [-0.3, 0.02], [0.3, 0.02]]) lozenge(soup, rWall + 0.008, ac, spring + dy, 0.11, 0.15, times(GREY, 0.78));
      }
    }
    // The door, deep in its frame, in the bay facing the walk-up.
    archPlate(soup, rWall + 0.02, 0, 1.06, 0.34, 1.96, times(RIM, 0.95));
    archPlate(soup, rWall + 0.04, 0, 0.82, 0.34, 1.9, DARK);
    corbels(soup, rArc + 0.02, yTop - 0.09, 45, marble(0.9));
    cornice(soup, rArc, yTop, 2.2, 0.98, 0.3);
    STOREYS.push({ soup, h });
  }

  // --- six open galleries of thirty columns round a solid core ----------------------------------
  const GALLERIES = 6;
  const GALLERY_COUNT = 30;
  for (let g = 0; g < GALLERIES; g += 1) {
    const soup = new Soup();
    const h = 2.62;
    const rOut = 3.1; const rIn = 2.98; const rCol = 3.04; const rCore = 2.25;
    const step = (Math.PI * 2) / GALLERY_COUNT;
    // Alternate galleries turn half a bay, as nothing in the masonry requires: left in line, the
    // thirty columns stack up in dead-straight ranks and the tower reads as a cage.
    const phase = g % 2 === 0 ? 0 : step / 2;
    const colH = 1.62;
    const rColumn = 0.076;
    const rho = (step / 2) * rCol - rColumn;
    const yTop = 2.38;
    const fine = g < 3;
    const k = 0.98 + g * 0.006;
    // Solid core, a wide striped wall with the gallery's shade on it.
    band(soup, rCore, -0.06, rCore, 0, 48, marble(0.8 * k));
    stripedWall(soup, rCore, 0, yTop + 0.02, 0.2, 2, 0.86 * k);
    // Ceiling.
    band(soup, rCore, yTop, rIn, yTop, 48, times(WHITE, 0.62));
    arcadeRing(soup, {
      count: GALLERY_COUNT, rOut, rIn, spring: colH, rho, yTop, phase, col: marble(k), rimCol: times(RIM, k), soffitCol: times(WHITE, 0.72 * k), K: fine ? 8 : 5, rim: 0.04,
    });
    for (let i = 0; i < GALLERY_COUNT; i += 1) {
      pisaColumn(soup, phase + i * step, rCol, 0, colH, rColumn, fine ? 8 : 6, marble(k), times(RIM, 0.97 * k), fine);
    }
    // Doors from the spiral stair onto the gallery, on the core.
    for (const a of [g * 0.9, g * 0.9 + Math.PI]) {
      archPlate(soup, rCore + 0.016, a, 0.62, 0, 0.92, times(RIM, 0.9));
      archPlate(soup, rCore + 0.032, a, 0.44, 0, 0.88, DARK);
    }
    // The iron rail between the columns, as a modern safety rail.
    for (const y of [0.62]) {
      const r0 = rCol - 0.012; const r1 = rCol + 0.012; const rail = lin(0x3b3a38);
      band(soup, r1, y - 0.012, r1, y + 0.012, 60, rail);
      band(soup, r1, y + 0.012, r0, y + 0.012, 60, rail);
    }
    corbels(soup, rOut, yTop - 0.09, g < 3 ? 42 : 24, marble(0.92 * k), phase);
    const isTop = g === GALLERIES - 1;
    cornice(soup, rOut, yTop, isTop ? 0.01 : rCore, k, 0.24);
    if (isTop) {
      // The terrace round the bell chamber, with a low parapet at its edge.
      const yy = yTop + 0.24;
      band(soup, 3.2, yy, 3.2, yy + 0.3, seg, marble(k));
      band(soup, 3.2, yy + 0.3, 3.08, yy + 0.3, seg, times(RIM, k));
      // Inner face: walked bottom-up on the inside, so inward-facing by the same rule read backward.
      for (let i = 0; i < seg; i += 1) {
        const a0 = (i / seg) * Math.PI * 2; const a1 = ((i + 1) / seg) * Math.PI * 2;
        const P = (a, y) => [Math.sin(a) * 3.08, y, Math.cos(a) * 3.08];
        const am = (a0 + a1) / 2;
        soup.face([P(a0, yy), P(a1, yy), P(a1, yy + 0.3), P(a0, yy + 0.3)], marble(0.84 * k), [-Math.sin(am), 0, -Math.cos(am)]);
      }
    }
    STOREYS.push({ soup, h });
  }

  // --- the bell chamber: narrower, with larger arches, and the bells hanging in them --------------
  {
    const soup = new Soup();
    const h = 2.86;
    const COUNT = 12;
    const rOut = 2.04; const rIn = 1.82; const rCol = 1.93;
    const step = (Math.PI * 2) / COUNT;
    const colH = 1.42;
    const rColumn = 0.1;
    const rho = (step / 2) * rCol - rColumn - 0.012;
    const yTop = 2.32;
    arcadeRing(soup, {
      count: COUNT, rOut, rIn, spring: colH, rho, yTop, col: marble(1), rimCol: times(RIM, 1), soffitCol: times(WHITE, 0.7), K: 12, rim: 0.05,
    });
    for (let i = 0; i < COUNT; i += 1) pisaColumn(soup, i * step, rCol, 0, colH, rColumn, 10, marble(1), times(RIM, 0.98), true);
    // The chamber behind the arches is deliberately dark, so the bells read against it.
    stripedWall(soup, 0.86, 0, yTop, 0.3, 2, 0.5, 24);
    band(soup, 0.86, yTop, rIn, yTop, 36, times(WHITE, 0.5));
    // Seven bells, the tower's real number, one in each of seven arches. Sizes are illustrative.
    const BRONZE = lin(0x6d5a33);
    const BRONZE2 = lin(0x8a7240);
    const BEAM = lin(0x4c3a28);
    const hang = [0, 2, 4, 5, 7, 9, 10];
    const sizes = [0.44, 0.27, 0.32, 0.25, 0.37, 0.28, 0.31];
    hang.forEach((b, i) => {
      const a = (b + 0.5) * step;
      const r = 1.42;
      const cx = Math.sin(a) * r; const cz = Math.cos(a) * r;
      const c = [cx, cz];
      const S = sizes[i];
      const yBeam = colH + rho * 0.55;
      const yB = yBeam - 0.06;
      soup.frustum(c, yB - S * 1.0, c, yB - S * 0.82, S * 0.82, S * 0.56, 12, BRONZE, { capTop: false, capBottom: true });
      soup.frustum(c, yB - S * 0.82, c, yB - S * 0.34, S * 0.56, S * 0.42, 12, BRONZE2, { capTop: false });
      soup.frustum(c, yB - S * 0.34, c, yB - S * 0.06, S * 0.42, S * 0.3, 12, BRONZE2, { capTop: true });
      soup.frustum(c, yB - S * 0.06, c, yBeam, S * 0.12, S * 0.1, 8, BRONZE, { capTop: false });
      // A timber headstock bearing on the arch and on the dark core.
      soup.bar([Math.sin(a) * 0.8, yBeam, Math.cos(a) * 0.8], [Math.sin(a) * rIn, yBeam, Math.cos(a) * rIn], 0.034, [0, 1, 0], BEAM);
    });
    corbels(soup, rOut, yTop - 0.09, 30, marble(0.92));
    // The cornice closes over the chamber, and a shallow roof over that.
    const yC = yTop;
    const c = marble(0.98);
    band(soup, rOut, yC, rOut + 0.04, yC, seg, times(c, 0.8));
    band(soup, rOut + 0.04, yC, rOut + 0.04, yC + 0.1, seg, c);
    band(soup, rOut + 0.04, yC + 0.1, rOut + 0.14, yC + 0.18, seg, times(c, 0.9));
    band(soup, rOut + 0.14, yC + 0.18, rOut + 0.14, yC + 0.26, seg, c);
    band(soup, rOut + 0.14, yC + 0.26, rOut - 0.02, yC + 0.28, seg, times(c, 0.9));
    band(soup, rOut - 0.02, yC + 0.28, rOut - 0.02, yC + 0.46, seg, times(c, 0.94));
    band(soup, rOut - 0.02, yC + 0.46, 0, yC + 0.54, seg, lin(0x8f8778));
    STOREYS.push({ soup, h });
  }

  // Each storey is placed on the one below it, tipped by its own angle about its own base centre.
  let px = 0; let py = BASE_Y;
  STOREYS.forEach((st, i) => {
    const q = new THREE.Quaternion().setFromAxisAngle(PISA_LEAN_AXIS, THREE.MathUtils.degToRad(PISA_TILTS[i]));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(px, py, 0), q, new THREE.Vector3(1, 1, 1));
    const g = st.soup.geometry();
    g.applyMatrix4(m);
    parts.push({ geometry: g, keepColor: true });
    const up = new THREE.Vector3(0, st.h, 0).applyQuaternion(q);
    px += up.x; py += up.y;
  });

  // --- the ground: a level paved ring round the tower and a lawn, so the lean has a datum -------
  const paving = new Soup();
  const lawnParts = new Soup();
  const R_PAVE = 4.75;
  const R_KERB = 4.95;
  const R_LAWN = 9.2;
  const PAVE_C = lin(0xc9c2b1);
  const KERB_C = lin(0xe0dbcd);
  // Walked inward, a level band faces up.
  band(paving, R_PAVE, 0.22, 0.01, 0.22, 96, PAVE_C);
  // Kerb: its inner face looks at the tower, so it is emitted by hand.
  for (let i = 0; i < 96; i += 1) {
    const a0 = (i / 96) * Math.PI * 2; const a1 = ((i + 1) / 96) * Math.PI * 2; const am = (a0 + a1) / 2;
    const P = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    paving.face([P(a0, R_PAVE, 0.22), P(a1, R_PAVE, 0.22), P(a1, R_PAVE, 0.28), P(a0, R_PAVE, 0.28)], times(KERB_C, 0.9), [-Math.sin(am), 0, -Math.cos(am)]);
    paving.face([P(a0, R_PAVE, 0.28), P(a1, R_PAVE, 0.28), P(a1, R_KERB, 0.28), P(a0, R_KERB, 0.28)], KERB_C, [0, 1, 0]);
    paving.face([P(a0, R_KERB, 0.28), P(a1, R_KERB, 0.28), P(a1, R_KERB, 0.16), P(a0, R_KERB, 0.16)], times(KERB_C, 0.92), [Math.sin(am), 0, Math.cos(am)]);
  }
  // A path running out to the rim on +Z, where a visitor would arrive.
  const PATH = 1.15;
  const pathEnd = Math.sqrt(R_LAWN * R_LAWN - PATH * PATH) - 0.02;
  paving.box(-PATH, 0.0, R_KERB - 0.1, PATH, 0.215, pathEnd, times(PAVE_C, 0.92), { topCol: PAVE_C });

  const GR_A = lin(0x48602f); const GR_B = lin(0x5f7538);
  const lawnH = (r) => mix(0.17, 0.05, sstep(r, R_LAWN - 0.5, R_LAWN));
  const lawnRings = [R_KERB - 0.05, 6.2, 7.5, 8.7, R_LAWN];
  const SECT = 96;
  for (let j = 0; j < lawnRings.length - 1; j += 1) {
    for (let i = 0; i < SECT; i += 1) {
      const a0 = (i / SECT) * Math.PI * 2; const a1 = ((i + 1) / SECT) * Math.PI * 2;
      const r0 = lawnRings[j]; const r1 = lawnRings[j + 1];
      const P = (a, r) => [Math.sin(a) * r, lawnH(r), Math.cos(a) * r];
      const C = (p) => mix3(GR_A, GR_B, smoothNoise3(p[0] * 0.6, 3, p[2] * 0.6));
      const q = [P(a0, r0), P(a1, r0), P(a1, r1), P(a0, r1)];
      lawnParts.face(q, q.map(C), [0, 1, 0]);
    }
  }
  for (let i = 0; i < SECT; i += 1) {
    const a0 = (i / SECT) * Math.PI * 2; const a1 = ((i + 1) / SECT) * Math.PI * 2; const am = (a0 + a1) / 2;
    const P = (a, y) => [Math.sin(a) * R_LAWN, y, Math.cos(a) * R_LAWN];
    lawnParts.face([P(a0, 0), P(a1, 0), P(a1, lawnH(R_LAWN)), P(a0, lawnH(R_LAWN))], lin(0x6a5a42), [Math.sin(am), 0, Math.cos(am)]);
  }

  const tower = mesh(mergeParts(parts), standard({
    vertexColors: true, map: repeatFeet(pisaMarbleTile(5), 3.4), bumpMap: repeatFeet(pisaMarbleTile(6), 1.7), bumpScale: 0.15, roughness: 0.74, metalness: 0,
  }));
  const pavingMesh = mesh(paving.geometry(), stoneMaterial(repeatFeet(pavingTile(47, { cells: 8 }), 4), { bumpScale: 0.3 }));
  pavingMesh.castShadow = false;
  const lawn = mesh(lawnParts.geometry(), standard({
    vertexColors: true, map: repeatFeet(grassTile(17), 2.6), roughness: 1, metalness: 0, ...relief('soil', { seed: 29, repeat: 8, strength: 0.8 }),
  }));
  lawn.castShadow = false;
  return group(tower, pavingMesh, lawn);
}

// ---------------------------------------------------------------------------
// Stonehenge as it stands today, about 1/4
// ---------------------------------------------------------------------------

// A DRESSED, WEATHERED MEGALITH. A rock is not a lumpy sphere and a sarsen is not a rock: it is a
// pillar somebody dressed with hammerstones, four thousand years ago, and it has been breaking since.
// So: a rounded rectangular section, a taper, long vertical tooling ridges, broad weathering lobes,
// then planes that cut real flats and broken arrises into it, and creased normals so the flats stay
// flat and the fractures stay sharp. Local +Z is the broad face, y runs from -sink to the top.
function megalith(seed, {
  w = 1.75, d = 0.92, h = 3.36, sink = 0.45, taper = 0.1, rows = 12, cols = 26, n = 5, lobes = 0.05, flatTop = true, tilt = [0, 0], broken = false, tooling = 0.02, chips = 5,
} = {}) {
  const rng = seededRandom(seed);
  const off = rng() * 40;
  const positions = [];
  const index = [];
  const cuts = [];
  // Face planes, each a little off true, which is what turns a superellipse into a dressed slab.
  for (const [nx, nz, half] of [[0, 1, d / 2], [0, -1, d / 2], [1, 0, w / 2], [-1, 0, w / 2]]) {
    const l = norm([nx + (rng() - 0.5) * 0.14, (rng() - 0.3) * 0.06, nz + (rng() - 0.5) * 0.14]);
    cuts.push({ n: l, h: half * (0.9 + rng() * 0.07), o: [0, h * 0.4, 0] });
  }
  // Long chamfers where an arris has been knocked off along most of the stone's height. These stay
  // near-vertical on purpose: a plane tilted by even twenty degrees runs on up through the whole
  // stone and shears its head to a point, which turned the first circle into a ring of shark's teeth.
  for (let i = 0; i < 4; i += 1) {
    if (rng() < 0.2) continue;
    const a = Math.PI / 4 + (i * Math.PI) / 2 + (rng() - 0.5) * 0.4;
    const nx = Math.cos(a); const nz = Math.sin(a);
    const support = Math.abs(nx) * (w / 2) + Math.abs(nz) * (d / 2);
    cuts.push({ n: norm([nx, (rng() - 0.5) * 0.1, nz]), h: support * (0.8 + rng() * 0.14), o: [0, h * 0.4, 0] });
  }
  // Spalls: a shallow flake gone from one place on a face or an edge. Each cuts a real flat, but only
  // within its own reach.
  const spalls = [];
  for (let i = 0; i < chips; i += 1) {
    const a = rng() * Math.PI * 2;
    const nn = norm([Math.cos(a), (rng() - 0.3) * 0.7, Math.sin(a)]);
    const y = -sink + 0.2 + rng() * (h + sink - 0.2);
    const onShell = [Math.cos(a) * (w / 2) * 0.86, y, Math.sin(a) * (d / 2) * 0.86];
    spalls.push({ n: nn, c: onShell, depth: 0.025 + rng() * 0.055, reach: 0.22 + rng() * 0.34 });
  }
  const topAt = (x, z) => h + tilt[0] * x + tilt[1] * z;
  const SIDE_ROWS = rows;
  const CAP = 4;
  const surface = (th, v, capT) => {
    const c = Math.cos(th); const sn = Math.sin(th);
    const y = capT === null ? mix(-sink, h + (broken ? 0.1 : 0.04), v) : null;
    const yy = capT === null ? y : h;
    const t = Math.max(0, (yy + sink) / (h + sink));
    let ww = (w / 2) * (1 - taper * t);
    let dd = (d / 2) * (1 - taper * 0.8 * t);
    // A slight belly a third of the way up, the shape most of the real ones have.
    const belly = 1 + 0.03 * Math.sin(Math.min(1, t * 1.4) * Math.PI);
    ww *= belly; dd *= belly;
    const sc = capT === null ? 1 : capT;
    let x = Math.sign(c) * Math.abs(c) ** (2 / n) * ww * sc;
    let z = Math.sign(sn) * Math.abs(sn) ** (2 / n) * dd * sc;
    const out = norm([x / (ww * ww), 0, z / (dd * dd)]);
    let disp = (smoothNoise3(x * 0.55 + off, yy * 0.42, z * 0.55) - 0.5) * lobes * 4;
    disp += (smoothNoise3(x * 1.25 + off, yy * 0.95 + 9, z * 1.25) - 0.5) * lobes * 1.4;
    // Tooling: long ridges running up the stone, a bare handful round the section.
    disp += Math.sin(th * 6 + (smoothNoise3(off, yy * 0.3, 2) - 0.5) * 3 + off) * tooling;
    disp *= sc;
    x += out[0] * disp; z += out[2] * disp;
    let py = yy;
    if (capT !== null) py = topAt(x, z) + (flatTop ? 0 : (1 - sc * sc) * 0.16 + (smoothNoise3(x * 1.3 + off, 4, z * 1.3) - 0.5) * 0.16);
    let P = [x, py, z];
    for (const cut of cuts) {
      const e = dot(sub(P, cut.o), cut.n) - cut.h;
      if (e > 0) P = sub(P, scl(cut.n, e));
    }
    for (const sp of spalls) {
      const dist = Math.hypot(P[0] - sp.c[0], P[1] - sp.c[1], P[2] - sp.c[2]);
      if (dist > sp.reach) continue;
      // The flake's flat floor, feathering out to nothing at the edge of its reach.
      const e = dot(sub(P, sp.c), sp.n) + sp.depth;
      if (e > 0) P = sub(P, scl(sp.n, e * (1 - sstep(dist, sp.reach * 0.7, sp.reach))));
    }
    // Whatever the planes did, nothing stands above the top plane when lintels rest on it.
    const lim = topAt(P[0], P[2]);
    if (P[1] > lim && flatTop) P[1] = lim;
    return P;
  };
  for (let r = 0; r <= SIDE_ROWS; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      const P = surface((k / cols) * Math.PI * 2, r / SIDE_ROWS, null);
      positions.push(P[0], P[1], P[2]);
    }
  }
  for (let r = 0; r < CAP; r += 1) {
    const sc = 1 - (r + 0.25) / (CAP + 0.25);
    for (let k = 0; k < cols; k += 1) {
      const P = surface((k / cols) * Math.PI * 2, 1, sc);
      positions.push(P[0], P[1], P[2]);
    }
  }
  const total = SIDE_ROWS + 1 + CAP;
  for (let r = 0; r < total - 1; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      const k2 = (k + 1) % cols;
      const a = r * cols + k; const b = r * cols + k2; const c = (r + 1) * cols + k2; const e = (r + 1) * cols + k;
      // th runs from +X toward +Z, which viewed from outside is clockwise, so the winding is a, c, b.
      index.push(a, c, b, a, e, c);
    }
  }
  const apex = positions.length / 3;
  const apexY = topAt(0, 0) + (flatTop ? 0 : 0.14);
  positions.push(0, apexY, 0);
  for (let k = 0; k < cols; k += 1) {
    const k2 = (k + 1) % cols;
    index.push(apex, (total - 1) * cols + k2, (total - 1) * cols + k);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return toCreasedNormals(g, (34 * Math.PI) / 180);
}

// A lintel: long along X, with a flat underside at y = 0 so it really beds on what carries it, and
// bowed in plan by `bow`, since the sarsen lintels were cut to the circle's curve.
function lintelSolid(seed, { len = 2.64, thick = 0.9, ht = 0.66, bow = 0, rows = 12, cols = 18 } = {}) {
  const rng = seededRandom(seed);
  const off = rng() * 40;
  const positions = [];
  const index = [];
  const cuts = [];
  for (let i = 0; i < 4; i += 1) {
    const a = rng() * Math.PI * 2;
    cuts.push({ n: norm([(rng() - 0.5) * 0.8, 0.4 + rng() * 0.6, Math.sin(a)]), h: ht * (0.56 + rng() * 0.3) });
  }
  const section = (t, th) => {
    const x = mix(-len / 2, len / 2, t);
    const end = 1 - (Math.abs(t - 0.5) * 2) ** 8 * 0.16;
    const c = Math.cos(th); const sn = Math.sin(th);
    let z = Math.sign(c) * Math.abs(c) ** 0.3 * (thick / 2) * end;
    let y = ht / 2 + Math.sign(sn) * Math.abs(sn) ** 0.3 * (ht / 2) * end;
    const n1 = smoothNoise3(x * 0.7 + off, y * 0.9, z * 0.9) - 0.5;
    z += Math.sign(z || 1) * n1 * 0.09;
    y += n1 * 0.05;
    z -= bow ? (x * x) / (2 * bow) : 0;
    let P = [x, y, z];
    for (const cut of cuts) {
      const centre = [x, ht * 0.4, -(bow ? (x * x) / (2 * bow) : 0)];
      const e = dot(sub(P, centre), cut.n) - cut.h;
      if (e > 0) P = sub(P, scl(cut.n, e));
    }
    P[1] = Math.max(0, P[1]);
    return P;
  };
  for (let r = 0; r <= rows; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      const P = section(r / rows, (k / cols) * Math.PI * 2);
      positions.push(P[0], P[1], P[2]);
    }
  }
  for (let r = 0; r < rows; r += 1) {
    for (let k = 0; k < cols; k += 1) {
      const k2 = (k + 1) % cols;
      const a = r * cols + k; const b = r * cols + k2; const c = (r + 1) * cols + k2; const e = (r + 1) * cols + k;
      index.push(a, c, b, a, e, c);
    }
  }
  // Each end closed by a centre fan.
  const endA = positions.length / 3;
  positions.push(-len / 2 - 0.01, ht / 2, -(bow ? (len * len) / (8 * bow) : 0));
  const endB = positions.length / 3;
  positions.push(len / 2 + 0.01, ht / 2, -(bow ? (len * len) / (8 * bow) : 0));
  for (let k = 0; k < cols; k += 1) {
    const k2 = (k + 1) % cols;
    index.push(endA, k, k2);
    index.push(endB, rows * cols + k2, rows * cols + k);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(index);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return toCreasedNormals(g, (34 * Math.PI) / 180);
}

// Near-white stone grain with tiny pits and the pale rosettes of crustose lichen, multiplied by the
// vertex tone. This is the scale a vertex cannot reach.
function sarsenTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#e6e3da';
    ctx.fillRect(0, 0, w, h);
    const wrapDot = (x, y, r, style) => {
      ctx.fillStyle = style;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    for (let i = 0; i < 160; i += 1) {
      const v = 190 + rng() * 40;
      wrapDot(rng() * w, rng() * h, 18 + rng() * 46, `rgba(${v},${v},${v * 0.96},0.2)`);
    }
    for (let i = 0; i < 9000; i += 1) {
      const v = 80 + rng() * 110;
      wrapDot(rng() * w, rng() * h, 0.5 + rng() * 1.3, `rgba(${v},${v * 0.97},${v * 0.9},${0.1 + rng() * 0.26})`);
    }
    // Lichen: clusters of small rosettes in three colours, near white so they tint rather than paint.
    const LICHEN = ['236,232,150', '250,246,226', '226,236,170', '238,206,132'];
    for (let c = 0; c < 80; c += 1) {
      const cx = rng() * w; const cy = rng() * h; const spread = 14 + rng() * 44;
      const hue = LICHEN[Math.floor(rng() * LICHEN.length)];
      const count = 8 + Math.floor(rng() * 22);
      for (let i = 0; i < count; i += 1) {
        const a = rng() * 6.283; const rr = rng() * spread;
        wrapDot(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2 + rng() * 7, `rgba(${hue},${0.5 + rng() * 0.4})`);
      }
    }
  });
}

function stonehenge() {
  const rng = seededRandom(2500);
  const RING_R = 12.3; // 30m across at 1/4, so 24.6ft
  const RAD = Math.PI / 180;
  const stones = [];

  // --- the ground ----------------------------------------------------------------------------------
  // THE EARTHWORK IS COMPRESSED. In reality the ditch is about 110m across and the Heel Stone stands
  // 78m out, which at 1/4 would be a model 90ft wide and more. They are here, in the right order
  // and on the right bearing, at about a quarter of their true distance from the stones.
  const R_BANK = 13.9; const R_DITCH = 15.15; const R_LIP = 16; const R_EDGE = 18.7;
  const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  const groundAt = (x, z) => {
    const r = Math.hypot(x, z);
    const a = Math.abs(Math.atan2(x, z));
    // The entrance: bank and ditch both stop short of the axis, the one causeway across them.
    const open = sstep(a, 0.13, 0.25);
    let y = 0.22;
    y += 0.2 * bump(r, R_BANK, 0.56) * open;
    y -= 0.16 * bump(r, R_DITCH, 0.48) * open;
    y += 0.05 * bump(r, R_LIP, 0.3) * open;
    // The Avenue's two low banks, leaving the entrance along the axis.
    if (z > 0) {
      const along = sstep(z, R_DITCH - 0.5, R_LIP);
      y += along * 0.075 * (bump(x, 2.25, 0.28) + bump(x, -2.25, 0.28));
    }
    y += (smoothNoise3(x * 0.5 + 4, 2, z * 0.5) - 0.5) * 0.09;
    y += (smoothNoise3(x * 1.6, 7, z * 1.6) - 0.5) * 0.03;
    return Math.max(0.02, y * (1 - sstep(r, R_EDGE - 0.75, R_EDGE)) + 0.02);
  };
  const G_POS = []; const G_COL = []; const G_UV = []; const G_IDX = [];
  const ringsR = [0];
  for (let r = 1.2; r < 13; r += 1.2) ringsR.push(r);
  for (let r = 13; r <= R_EDGE - 0.75; r += 0.26) ringsR.push(r);
  ringsR.push(R_EDGE - 0.5, R_EDGE - 0.25, R_EDGE);
  const SECT = 96;
  const GA = lin(0x47592f); const GB = lin(0x5a6c36); const GC = lin(0x76794a);
  const WORN = lin(0x77754f);
  const CHALK = lin(0x9a9a78);
  for (let j = 0; j < ringsR.length; j += 1) {
    for (let k = 0; k < SECT; k += 1) {
      const a = (k / SECT) * Math.PI * 2;
      const r = ringsR[j];
      const x = Math.sin(a) * r; const z = Math.cos(a) * r;
      G_POS.push(x, groundAt(x, z), z);
      G_UV.push(x, z);
      let c = mix3(mix3(GA, GB, smoothNoise3(x * 0.45, 2, z * 0.45)), GC, sstep(smoothNoise3(x * 1.1 + 5, 6, z * 1.1), 0.56, 0.78) * 0.6);
      // Worn pale inside the circle, where four million visitors a century have walked, and with
      // chalk showing through in the ditch.
      c = mix3(c, WORN, (1 - sstep(r, 8, 12)) * 0.42);
      c = mix3(c, CHALK, bump(r, R_DITCH, 0.3) * sstep(Math.abs(Math.atan2(x, z)), 0.13, 0.25) * 0.28);
      G_COL.push(...c);
    }
  }
  for (let j = 0; j < ringsR.length - 1; j += 1) {
    for (let k = 0; k < SECT; k += 1) {
      const k2 = (k + 1) % SECT;
      const a = j * SECT + k; const b = j * SECT + k2; const c = (j + 1) * SECT + k2; const d = (j + 1) * SECT + k;
      // Sweeping a from +Z toward +X, viewed from above, runs anticlockwise.
      G_IDX.push(a, d, c, a, c, b);
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setIndex(G_IDX);
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(G_POS, 3));
  groundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(G_UV, 2));
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(G_COL, 3));
  groundGeo.computeVertexNormals();

  // --- placing a stone ------------------------------------------------------------------------------
  const SARSEN = { a: lin(0x7e7b71), b: lin(0x9c988c), lich: lin(0xa4a664), pale: lin(0xc2c2b2), foot: lin(0x5a5649) };
  const BLUE = { a: lin(0x747b82), b: lin(0x8f959a), lich: lin(0x9a9d70), pale: lin(0xb4b7b0), foot: lin(0x5a5c56) };
  const ALTAR = { a: lin(0x6f715c), b: lin(0x8b8c72), lich: lin(0x8e9360), pale: lin(0xa8a98f), foot: lin(0x55564a) };
  const addStone = (geometry, matrix, pal = SARSEN) => {
    geometry.applyMatrix4(matrix);
    const seed = rng() * 60;
    const P = geometry.attributes.position;
    const uv = new Float32Array(P.count * 2);
    const col = new Float32Array(P.count * 3);
    // Each triangle takes its grain from the plane it most nearly lies in. One skew projection for a
    // whole stone stretches the lichen into long diagonal streaks on any face that runs along it.
    const nrm = geometry.attributes.normal;
    for (let t = 0; t < P.count; t += 3) {
      const nx = Math.abs(nrm.getX(t) + nrm.getX(t + 1) + nrm.getX(t + 2));
      const ny = Math.abs(nrm.getY(t) + nrm.getY(t + 1) + nrm.getY(t + 2));
      const nz = Math.abs(nrm.getZ(t) + nrm.getZ(t + 1) + nrm.getZ(t + 2));
      for (let v = t; v < t + 3; v += 1) {
        const x = P.getX(v); const y = P.getY(v); const z = P.getZ(v);
        if (ny >= nx && ny >= nz) { uv[v * 2] = x + seed; uv[v * 2 + 1] = z; } else if (nx > nz) { uv[v * 2] = z + seed; uv[v * 2 + 1] = y; } else { uv[v * 2] = x + seed; uv[v * 2 + 1] = y; }
      }
    }
    for (let i = 0; i < P.count; i += 1) {
      // What is buried stops above the catalogue's floor: a leaning stone's foot swings well down.
      if (P.getY(i) < -0.38) P.setY(i, -0.38);
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      let c = mix3(pal.a, pal.b, smoothNoise3(x * 1.1 + seed, y * 1.1, z * 1.1));
      // Lichen as drifts across the stone at a scale the mesh can hold; the rosettes in the map do
      // the rest. It favours the upper parts, where birds perch and rain runs off.
      const lichen = sstep(smoothNoise3(x * 0.85 + seed, y * 0.85 + 3, z * 0.85), 0.5, 0.68);
      c = mix3(c, pal.lich, lichen * 0.42 * sstep(y, 0.5, 2.2));
      c = mix3(c, pal.pale, sstep(smoothNoise3(x * 1.5, y * 1.5 + seed, z * 1.5), 0.62, 0.76) * 0.4);
      const ground = groundAt(x, z);
      c = mix3(c, pal.foot, 1 - sstep(y - ground, 0.0, 0.28));
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    stones.push({ geometry, keepColor: true });
  };
  // Standing: origin at ground level, +Z of the stone looking along `yaw`, leaning by two angles.
  const standM = (x, z, yaw, leanOut = 0, leanSide = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(leanOut, yaw, leanSide, 'YXZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z), z), q, new THREE.Vector3(1, 1, 1));
  };
  // Lying: the stone's length (its local Y) laid out along `yaw`, its base at (x, z).
  const lieM = (x, z, yaw, y, roll = 0, pitch = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + pitch, yaw, 0, 'YXZ'));
    const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll);
    q.multiply(r);
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  };

  // A stone's bearing is measured clockwise from the axis seen from above, as Stonehenge's stones are
  // numbered, and +Z here is the axis's north-east, so clockwise runs toward -X.
  const polar = (bearing, r) => [-Math.sin(bearing * RAD) * r, Math.cos(bearing * RAD) * r];
  const yawOut = (bearing) => { const [x, z] = polar(bearing, 1); return Math.atan2(x, z); };
  const ringBearing = (n) => (n - 0.5) * 12; // stones 30 and 1 flank the axis at 6 degrees either side

  // --- the sarsen circle: thirty uprights once, seventeen standing now ----------------------------
  const STANDING = {
    1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {}, 7: {},
    10: {}, 11: { w: 0.95, h: 2.25, broken: true }, 16: { lean: 0.07, bare: true },
    21: {}, 22: {}, 23: { bare: true },
    27: { bare: true, lean: -0.03 }, 28: { bare: true }, 29: {}, 30: {},
  };
  // Lintels surviving in place, as [from, to].
  const LINTELS = [[29, 30], [30, 1], [1, 2], [4, 5], [5, 6], [6, 7], [21, 22]];
  const tops = {};
  for (const [nStr, opt] of Object.entries(STANDING)) {
    const n = Number(nStr);
    const b = ringBearing(n);
    const [x, z] = polar(b, RING_R);
    const hasLintel = LINTELS.some((l) => l[0] === n || l[1] === n);
    const h = opt.h ?? 3.26 + rng() * 0.2;
    const tilt = hasLintel ? [0, 0] : [(rng() - 0.5) * 0.16, (rng() - 0.5) * 0.12];
    const g = megalith(100 + n, {
      w: opt.w ?? 1.66 + rng() * 0.2, d: 0.84 + rng() * 0.14, h, tilt, flatTop: hasLintel, broken: !!opt.broken, chips: hasLintel ? 4 : 7,
    });
    const m = standM(x, z, yawOut(b), opt.lean ?? 0, (rng() - 0.5) * 0.02);
    tops[n] = { x, z, y: groundAt(x, z) + h, b };
    addStone(g, m);
    if (opt.bare) {
      // A bare upright still shows the tenon its lintel sat on.
      const ten = new THREE.SphereGeometry(0.2, 12, 6);
      ten.scale(1.15, 0.55, 0.9);
      addStone(ten.toNonIndexed(), new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z) + h + tilt[0] * 0, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
    }
  }
  for (const [a, b] of LINTELS) {
    const A = tops[a]; const B = tops[b];
    // Right-handed with +Y up and +Z outward, which forces +X to run anticlockwise, from B back to A.
    // Taken the other way the basis is still valid and the lintel hangs DOWN from the stones' tops,
    // threaded through them at mid-height, which is exactly what the first pass did.
    const ux = norm([A.x - B.x, A.y - B.y, A.z - B.z]);
    const midX = (A.x + B.x) / 2; const midZ = (A.z + B.z) / 2;
    const out = norm([midX, 0, midZ]);
    const uy = norm(cross(out, ux));
    const uz = norm(cross(ux, uy));
    const len = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
    const g = lintelSolid(300 + a, { len: len - 0.03, thick: 0.86, ht: 0.64, bow: RING_R });
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...ux), new THREE.Vector3(...uy), new THREE.Vector3(...uz));
    // Sunk an inch into the stones it rests on: real contact, no daylight, and the seam hidden.
    m.setPosition((A.x + B.x) / 2, (A.y + B.y) / 2 - 0.02, (A.z + B.z) / 2);
    addStone(g, m);
  }
  // Fallen and broken pieces from the circle's lost side. [stone n, how far out it lies from the
  // ring, its yaw offset from radial, length, width].
  const RING_FALLEN = [[8, 0.8, 0.5, 3.0, 1.5], [9, -0.4, -0.9, 2.2, 1.4], [14, 1.0, 0.3, 2.5, 1.6], [15, 0.2, 1.3, 1.6, 1.3], [19, -1.3, 0.1, 3.1, 1.5], [25, 0.6, 1.0, 1.5, 1.2]];
  for (const [n, dr, dy, L, W] of RING_FALLEN) {
    const b = ringBearing(n);
    const [x, z] = polar(b, RING_R + dr);
    const g = megalith(500 + n, { w: W, d: 0.74, h: L, sink: 0, rows: 9, cols: 22, flatTop: false, chips: 7 });
    addStone(g, lieM(x, z, yawOut(b) + dy, groundAt(x, z) + 0.22));
  }
  // Stumps where an upright has broken off near the ground.
  for (const n of [12, 13, 20]) {
    const b = ringBearing(n);
    const [x, z] = polar(b, RING_R);
    addStone(megalith(560 + n, { w: 1.3, d: 0.7, h: 0.55 + rng() * 0.45, sink: 0.25, rows: 5, cols: 18, flatTop: false, broken: true }), standM(x, z, yawOut(b), 0.05, 0.03));
  }
  // Lintels that came down with them.
  for (const [n, dr, dy] of [[15, 1.3, 1.1], [24, -0.9, 0.7]]) {
    const b = ringBearing(n);
    const [x, z] = polar(b, RING_R + dr);
    const g = lintelSolid(600 + n, { len: 2.5, thick: 0.84, ht: 0.62, rows: 8, cols: 14 });
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z) - 0.12, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, yawOut(b) + dy, -0.05, 'YXZ')), new THREE.Vector3(1, 1, 1));
    addStone(g, m);
  }

  // --- the horseshoe of five trilithons, opening to the north-east ----------------------------------
  // Three stand complete. The great one at the apex does NOT: stone 56 stands alone with its tenon
  // showing, and its partner 55 and their lintel lie broken across the Altar Stone. The fifth is a
  // fallen stone and a stump. Rising from about 20ft at the ends to 24ft at the apex, at 1/4.
  const TW = 1.92; const TD = 1.02; const GAP = 0.26;
  const uprightPair = (bearing, r, h, seed) => {
    const [cx, cz] = polar(bearing, r);
    const yaw = yawOut(bearing);
    const tx = Math.cos(yaw); const tz = -Math.sin(yaw);
    const off = TW / 2 + GAP / 2;
    return { cx, cz, yaw, a: [cx - tx * off, cz - tz * off], b: [cx + tx * off, cz + tz * off], h, seed };
  };
  const trilithon = (bearing, r, h, seed) => {
    const t = uprightPair(bearing, r, h, seed);
    const ga = groundAt(t.a[0], t.a[1]); const gb = groundAt(t.b[0], t.b[1]);
    const top = Math.max(ga, gb) + h;
    addStone(megalith(seed, { w: TW, d: TD, h: top - ga, taper: 0.12, rows: 13, cols: 28, sink: 0.42 }), standM(t.a[0], t.a[1], t.yaw));
    addStone(megalith(seed + 1, { w: TW, d: TD, h: top - gb, taper: 0.12, rows: 13, cols: 28, sink: 0.42 }), standM(t.b[0], t.b[1], t.yaw));
    const g = lintelSolid(seed + 2, { len: TW * 2 + GAP + 0.06, thick: TD * 0.9, ht: 0.82, rows: 12, cols: 18 });
    const m = new THREE.Matrix4().compose(new THREE.Vector3(t.cx, top - 0.025, t.cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, t.yaw, 0)), new THREE.Vector3(1, 1, 1));
    addStone(g, m);
  };
  trilithon(62, 7.2, 4.1, 710); // 51-52
  trilithon(120, 7.3, 4.5, 720); // 53-54
  trilithon(-120, 7.3, 4.5, 730); // 57-58

  // The Great Trilithon's survivor. Stone 56 is the tallest standing stone here, at about 22ft.
  const apex = uprightPair(180, 7.5, 5.5, 740);
  const s56 = apex.b[0] > apex.a[0] ? apex.b : apex.a;
  addStone(megalith(741, { w: TW * 1.04, d: TD * 1.06, h: 5.5, taper: 0.12, rows: 16, cols: 28, sink: 0.42, flatTop: true, tilt: [0.02, 0], chips: 6 }), standM(s56[0], s56[1], apex.yaw, 0.012));
  // Its tenon, the knob the lost lintel's socket fitted over, big enough to see from the ground.
  const tenon = new THREE.SphereGeometry(0.3, 16, 8);
  tenon.scale(1.05, 0.62, 0.8);
  addStone(tenon.toNonIndexed(), new THREE.Matrix4().compose(new THREE.Vector3(s56[0], groundAt(s56[0], s56[1]) + 5.48, s56[1]), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));

  // The Altar Stone, the one green sandstone block, lying under what fell on it.
  const [ax, az] = polar(180, 4.7);
  addStone(megalith(750, { w: 0.84, d: 0.48, h: 3.9, sink: 0, rows: 8, cols: 18, taper: 0.03, flatTop: false, chips: 4 }), lieM(ax - 1.95, az, Math.PI / 2 + 0.05, groundAt(ax, az) + 0.1), ALTAR);
  // Stone 55, broken in two across it, and lintel 156 beside them.
  const s55 = apex.b[0] > apex.a[0] ? apex.a : apex.b;
  addStone(megalith(751, { w: TW, d: TD * 0.92, h: 3.3, sink: 0, rows: 11, cols: 26, flatTop: false, chips: 8 }), lieM(s55[0] + 0.1, s55[1] + 0.4, 0.2, groundAt(s55[0], s55[1]) + 0.42, 0.14, -0.05));
  addStone(megalith(752, { w: TW * 0.94, d: TD * 0.86, h: 2.5, sink: 0, rows: 9, cols: 24, flatTop: false, chips: 8 }), lieM(s55[0] + 0.55, s55[1] + 4.3, 0.42, groundAt(s55[0] + 0.5, s55[1] + 4.3) + 0.26, -0.1, 0.05));
  const l156 = lintelSolid(753, { len: 4.1, thick: 0.96, ht: 0.8, rows: 12, cols: 16 });
  addStone(l156, new THREE.Matrix4().compose(new THREE.Vector3(apex.cx + 1.9, groundAt(apex.cx + 1.9, apex.cz + 2.1) - 0.2, apex.cz + 2.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 1.05, 0.03, 'YXZ')), new THREE.Vector3(1, 1, 1)));

  // The fifth trilithon, 59-60: a stump, a stone in two pieces, and its fallen lintel.
  const t5 = uprightPair(-62, 7.2, 4.1, 760);
  addStone(megalith(761, { w: TW * 0.9, d: TD * 0.9, h: 1.5, sink: 0.4, rows: 8, cols: 24, flatTop: false, broken: true, tilt: [0.34, -0.1], chips: 7 }), standM(t5.a[0], t5.a[1], t5.yaw));
  addStone(megalith(762, { w: TW * 0.96, d: TD * 0.92, h: 2.7, sink: 0, rows: 10, cols: 24, flatTop: false, chips: 8 }), lieM(t5.b[0], t5.b[1], t5.yaw + Math.PI + 0.5, groundAt(t5.b[0], t5.b[1]) + 0.34, 0.2));
  addStone(megalith(763, { w: TW * 0.9, d: TD * 0.86, h: 1.9, sink: 0, rows: 8, cols: 22, flatTop: false, chips: 8 }), lieM(t5.b[0] - 2.6, t5.b[1] - 1.0, t5.yaw + Math.PI + 0.95, groundAt(t5.b[0] - 2.6, t5.b[1] - 1) + 0.3));
  const l160 = lintelSolid(764, { len: 3.9, thick: 0.92, ht: 0.78, rows: 10, cols: 14 });
  addStone(l160, new THREE.Matrix4().compose(new THREE.Vector3(t5.cx + 1.8, groundAt(t5.cx + 1.8, t5.cz + 1.5) - 0.2, t5.cz + 1.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, t5.yaw + 0.8, 0.05, 'YXZ')), new THREE.Vector3(1, 1, 1)));

  // --- the bluestones ---------------------------------------------------------------------------------
  // Much smaller, darker and rougher. A ring between the sarsens and the trilithons, of which about
  // half survive, many as stumps; and a horseshoe inside the trilithons, the taller and finer stones.
  for (let i = 0; i < 60; i += 1) {
    if (rng() > 0.46) continue;
    const b = (i + 0.5) * 6 + (rng() - 0.5) * 2;
    const [x, z] = polar(b, 9.5 + (rng() - 0.5) * 0.3);
    const stump = rng() < 0.4;
    const h = stump ? 0.3 + rng() * 0.35 : 1.0 + rng() * 0.75;
    const g = megalith(800 + i, { w: 0.5 + rng() * 0.26, d: 0.34 + rng() * 0.14, h, sink: 0.25, rows: stump ? 4 : 6, cols: 12, flatTop: false, lobes: 0.03, tooling: 0.006, chips: 5, n: 3.4 });
    addStone(g, standM(x, z, yawOut(b) + (rng() - 0.5) * 0.5, (rng() - 0.5) * 0.24, (rng() - 0.5) * 0.2), BLUE);
  }
  // Horseshoe, with the same opening as the trilithons: an arc about a centre behind the middle.
  const HS = 19;
  for (let i = 0; i < HS; i += 1) {
    if (rng() > 0.48) continue;
    const b = 180 + mix(-112, 112, i / (HS - 1));
    const [xr, zr] = polar(b, 4.65);
    const z = zr - 0.75;
    const h = 1.2 + (1 - Math.abs(i - (HS - 1) / 2) / ((HS - 1) / 2)) * 0.85 + rng() * 0.18;
    const g = megalith(860 + i, { w: 0.44 + rng() * 0.12, d: 0.32 + rng() * 0.08, h, sink: 0.25, rows: 7, cols: 12, flatTop: false, lobes: 0.025, tooling: 0.006, taper: 0.24, chips: 4, n: 3.6 });
    addStone(g, standM(xr, z, yawOut(b), (rng() - 0.5) * 0.14, (rng() - 0.5) * 0.1), BLUE);
  }

  // --- the outliers: Heel Stone, Slaughter Stone and two Station Stones -----------------------------
  // The Heel Stone is undressed, a natural boulder, which is why it looks nothing like the others.
  // It stands just to the right of the axis seen from the centre, and it leans toward the circle.
  {
    const [x, z] = [-0.95, 16.5];
    addStone(megalith(900, { w: 2.4, d: 2.0, h: 4.0, sink: 0.42, taper: 0.3, n: 2.4, rows: 14, cols: 26, flatTop: false, lobes: 0.11, tooling: 0.004, chips: 8 }), standM(x, z, 0.3, -27 * RAD));
    // The Slaughter Stone lies flat at the entrance, on the causeway.
    const [sx, sz] = [1.75, 14.55];
    addStone(megalith(901, { w: 1.7, d: 0.7, h: 4.1, sink: 0, rows: 12, cols: 22, flatTop: false, chips: 6 }), lieM(sx, sz, 2.1, groundAt(sx, sz) + 0.18));
    for (const [b, seed] of [[-48, 902], [136, 903]]) {
      const [qx, qz] = polar(b, 13.05);
      addStone(megalith(seed, { w: 0.7, d: 0.42, h: b < 0 ? 0.7 : 1.15, sink: 0.25, rows: 5, cols: 12, flatTop: false, n: 3 }), standM(qx, qz, yawOut(b), 0.08, 0.05));
    }
  }

  // Everything above was laid out with the axis along +Z. Turned now to the compass, so that +Z is true
  // north, the axis runs out at its real bearing of about 49.5 degrees, and the model's front shows
  // the circle with the Heel Stone off to one side rather than standing in front of it.
  const COMPASS = new THREE.Matrix4().makeRotationY(-49.5 * RAD);
  const tile = repeatFeet(sarsenTile(25), 5.2);
  const stoneGeo = mergeParts(stones);
  stoneGeo.applyMatrix4(COMPASS);
  groundGeo.applyMatrix4(COMPASS);
  const stoneMesh = mesh(stoneGeo, stoneMaterial(tile, { bumpScale: 0.6, roughness: 0.97 }));
  const groundMesh = mesh(groundGeo, standard({
    vertexColors: true, map: repeatFeet(grassTile(19), 2.8), roughness: 1, metalness: 0, ...relief('soil', { seed: 61, repeat: 7, strength: 0.9 }),
  }));
  groundMesh.castShadow = false;
  return group(groundMesh, stoneMesh);
}

// ---------------------------------------------------------------------------
// El Castillo, about 1/6
// ---------------------------------------------------------------------------

// A feathered-serpent head: one sculpted surface, the shape a stone carver leaves. Faces +Z, sits on
// y = 0, centred on x = 0. These stand at the foot of the north stairway's balustrades.
function serpentHead(pale, dark) {
  const s = new Sculpt(0.036);
  const stone = lin(pale);
  const shade = lin(dark);
  // A squared plinth the head rests on, flowing out of the balustrade.
  s.add(boxP([0, 0.2, -0.2], [0.46, 0.2, 0.52], null, 0.03), stone);
  // The skull and the great blunt snout.
  s.add(ellipsoidP([0, 0.66, -0.12], [0.46, 0.38, 0.54]), stone, { k: 0.14 });
  s.add(boxP([0, 0.74, 0.36], [0.31, 0.15, 0.3], null, 0.09), stone, { k: 0.12 });
  // The lower jaw, dropped open.
  s.add(boxP([0, 0.32, 0.34], [0.3, 0.06, 0.36], null, 0.05), stone, { k: 0.08 });
  for (const m of [1, -1]) {
    // Brow ridge sweeping back over a deep-set eye, and a curled nostril scroll on the snout.
    s.add(curveP([[m * 0.17, 0.95, 0.36], [m * 0.34, 1.0, 0.1], [m * 0.42, 0.98, -0.2], [m * 0.36, 0.86, -0.5]], [0.05, 0.08, 0.08, 0.04]), stone, { k: 0.06 });
    s.add(curveP([[m * 0.14, 0.86, 0.66], [m * 0.27, 0.92, 0.6], [m * 0.3, 0.84, 0.48], [m * 0.2, 0.8, 0.5]], [0.03, 0.045, 0.045, 0.03]), stone, { k: 0.03 });
    // The plume at the back of the head: stiff feathers carved as raised ribs.
    for (let i = 0; i < 4; i += 1) {
      const z = -0.5 - i * 0.04; const y = 0.42 + i * 0.16;
      s.add(curveP([[m * 0.28, y, z + 0.14], [m * 0.47, y + 0.05, z - 0.08], [m * 0.54, y + 0.12, z - 0.24]], [0.05, 0.05, 0.02]), stone, { k: 0.05 });
    }
  }
  // The mouth: a real void between the jaws, dark at the back of the throat.
  s.sub(boxP([0, 0.5, 0.52], [0.25, 0.09, 0.4], null, 0.05), shade, { k: 0.03, ck: 0.05 });
  for (const m of [1, -1]) {
    // The eye socket and the eye inside it.
    s.sub(sphereP([m * 0.32, 0.86, 0.13], 0.075), shade, { k: 0.02, ck: 0.05 });
    s.add(sphereP([m * 0.3, 0.86, 0.13], 0.052), lin(0x8d8675), { k: 0.002 });
    // The two fangs, curving down from the upper jaw, and a smaller pair rising from the lower.
    s.add(curveP([[m * 0.19, 0.64, 0.6], [m * 0.2, 0.5, 0.62], [m * 0.17, 0.41, 0.58]], [0.05, 0.035, 0.004]), lin(0xb9b19a), { k: 0.012, ck: 0.02 });
    s.add(curveP([[m * 0.2, 0.37, 0.58], [m * 0.19, 0.44, 0.6], [m * 0.17, 0.5, 0.56]], [0.03, 0.02, 0.003]), lin(0xb9b19a), { k: 0.01, ck: 0.02 });
  }
  // The forked tongue, lying on the lower jaw and over its lip.
  for (const m of [1, -1]) {
    s.add(curveP([[0, 0.39, 0.3], [m * 0.02, 0.4, 0.5], [m * 0.08, 0.37, 0.7], [m * 0.14, 0.3, 0.76]], [0.045, 0.04, 0.022, 0.004]), lin(0x7f5642), { k: 0.012, ck: 0.015 });
  }
  const geometry = polygonize(s, {
    uvScale: 1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const n = smoothNoise3(x * 3.2 + 4, y * 3.2, z * 3.2);
      const k = 0.78 + n * 0.34;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      // Grime in what faces down, moss on the plinth's shoulders.
      if (ny < -0.3) { const d = 0.74; rgb[0] *= d; rgb[1] *= d; rgb[2] *= d; }
      const inMouth = y > 0.3 && y < 0.62 && Math.abs(x) < 0.3 && z > 0.05 ? 0 : 1;
      const moss = inMouth * sstep(smoothNoise3(x * 2.4, y * 2.4 + 8, z * 2.4), 0.58, 0.72) * sstep(ny, 0.2, 0.7) * 0.6;
      rgb[0] = mix(rgb[0], 0.18, moss); rgb[1] = mix(rgb[1], 0.25, moss); rgb[2] = mix(rgb[2], 0.1, moss);
    },
  });
  return geometry;
}

function elCastillo() {
  const rng = seededRandom(1000);
  const soup = new Soup();
  const LIME = lin(0xc4bda6);
  const LIME_D = lin(0xa39c84);
  const LIME_P = lin(0xd2ccb8);
  const MOSS = lin(0x69713f);

  const GROUND = 0.16;
  const TOP = 12.7; // the platform, 24m up at about 1/6.2
  const TERRACES = 9;
  const HT = (TOP - GROUND) / TERRACES;
  const H0 = 14.6; const H9 = 5.1;
  const DH = (H0 - H9) / TERRACES;
  const RHO = 0.52; // the terraces' famously rounded corners
  const WALL_E = 0.27; const WALL_H = 0.8; const BAND_E = 0.22;
  const STAIR_HALF = 2.2; const BAL_W = 0.56;
  const RUN_FROM = STAIR_HALF + BAL_W - 0.03;

  // THE COUNT THE CARD STANDS ON. Ninety-one steps a side, four sides, and the top platform makes
  // 365. So each stair has 91 treads and 92 risers, the last riser landing on the platform.
  const STEPS = 91;
  const RISER = (TOP - GROUND) / (STEPS + 1);
  const RUN = RISER; // 45 degrees, close to the real stair's pitch
  const FOOT_Z = H9 + STEPS * RUN;

  // Each terrace is cut by the stair into two runs on every side, so eighteen on a side, the eighteen
  // months of the Maya solar year. These panel counts sum to 26 per half side, 52 per side, the number
  // of years in the Calendar Round.
  const PANELS = [5, 4, 4, 3, 3, 2, 2, 2, 1];

  // Eight mirror images of one sector, a stretch of side from the stair to the corner's diagonal.
  const frames = [];
  for (let q = 0; q < 4; q += 1) {
    for (const m of [1, -1]) {
      const a = (q * Math.PI) / 2;
      const ca = Math.cos(a); const sa = Math.sin(a);
      frames.push({
        P: ([x, y, z]) => { const X = x * m; return [X * ca + z * sa, y, -X * sa + z * ca]; },
        D: ([x, y, z]) => { const X = x * m; return [X * ca + z * sa, y, -X * sa + z * ca]; },
      });
    }
  }
  const stoneTone = (base, k = 0.06) => times(base, 1 - k + rng() * 2 * k);

  // Outline of a rounded square of half-size `half` with corner radius `r`, as the points of one
  // sector: straight from x0 to the corner's centre, then three steps round to 45 degrees.
  const ARC = 3;
  const sectorLine = (half, r, x0, straightSteps = 1) => {
    const c = half - r;
    const pts = [];
    for (let i = 0; i <= straightSteps; i += 1) pts.push([mix(x0, c, i / straightSteps), half]);
    for (let i = 1; i <= ARC; i += 1) {
      const t = ((i / ARC) * Math.PI) / 4;
      pts.push([c + Math.sin(t) * r, c + Math.cos(t) * r]);
    }
    return pts;
  };
  const strip = (F, lineA, yA, colA, lineB, yB, colB, hintFn) => {
    for (let i = 0; i < lineA.length - 1; i += 1) {
      const a0 = lineA[i]; const a1 = lineA[i + 1]; const b0 = lineB[i]; const b1 = lineB[i + 1];
      const q = [F.P([a0[0], yA, a0[1]]), F.P([a1[0], yA, a1[1]]), F.P([b1[0], yB, b1[1]]), F.P([b0[0], yB, b0[1]])];
      soup.face(q, [colA, colA, colB, colB], F.D(hintFn(i, a0, a1)));
    }
  };

  for (let k = 0; k < TERRACES; k += 1) {
    const half = H0 - k * DH;
    const y0 = GROUND + k * HT;
    const yW = y0 + WALL_H * HT;
    const y1 = y0 + HT;
    const nextHalf = half - DH;
    const outwardAt = (i, a0, a1) => {
      const mx = (a0[0] + a1[0]) / 2; const mz = (a0[1] + a1[1]) / 2;
      const c = half - RHO;
      return mx <= c ? [0, 0, 1] : norm([mx - c, 0, mz - c]);
    };
    frames.forEach((F) => {
      // The sloped wall's straight run, carrying its real recessed panels.
      const xb = half - RHO;
      const width = xb - RUN_FROM;
      const footP = [RUN_FROM, y0, half]; const topP = [RUN_FROM, yW, half - WALL_E];
      const slopeDir = norm(sub(topP, footP));
      const L = Math.hypot(WALL_E, yW - y0);
      const n = PANELS[k];
      const bay = width / n;
      const wall = stoneTone(LIME, 0.05);
      const openings = [];
      for (let i = 0; i < n; i += 1) openings.push({ cx: (i + 0.5) * bay, y0: L * 0.16, y1: L * 0.88, w: bay * 0.62, arch: false });
      const ux = F.D([1, 0, 0]);
      const uy = F.D(slopeDir);
      const outward = F.D(norm([0, WALL_E, yW - y0]));
      wallWithOpenings(soup, F.P(footP), ux, uy, outward, width, L, openings, {
        col: wall, depth: 0.075, reveal: times(wall, 0.66), back: times(LIME_D, 0.86 + rng() * 0.1), uvOrigin: [rng() * 9, rng() * 9],
      });
      // The rest of the profile, straight and round the corner. The wall only needs its corner here.
      const footLine = sectorLine(half, RHO, xb - 1e-4);
      const topLine = sectorLine(half - WALL_E, RHO - WALL_E, xb - 1e-4);
      strip(F, footLine, y0, times(mix3(wall, MOSS, 0.2), 0.84), topLine, yW, wall, outwardAt);
      // The band: a square-cut moulding standing proud of the wall.
      const bandLine = sectorLine(half - BAND_E, RHO - BAND_E, RUN_FROM);
      const bandBase = sectorLine(half - WALL_E, RHO - WALL_E, RUN_FROM);
      strip(F, bandBase, yW, times(LIME_D, 0.68), bandLine, yW, times(LIME_D, 0.68), () => [0, -1, 0]);
      strip(F, bandLine, yW, stoneTone(LIME_P), bandLine, y1, stoneTone(LIME_P), outwardAt);
      // The ledge, from the band's top back to the foot of the next terrace, broken into lengths so
      // the moss can gather in places rather than as one flat coat.
      const STEPS_L = 6;
      const lineA = sectorLine(half - BAND_E, RHO - BAND_E, RUN_FROM, STEPS_L);
      const lineB = sectorLine(nextHalf, RHO, RUN_FROM, STEPS_L);
      for (let i = 0; i < lineA.length - 1; i += 1) {
        const a0 = lineA[i]; const a1 = lineA[i + 1]; const b0 = lineB[i]; const b1 = lineB[i + 1];
        const ca = mix3(LIME_P, MOSS, rng() * 0.25);
        const cb = mix3(LIME_D, MOSS, 0.2 + rng() * 0.45);
        soup.face([F.P([a0[0], y1, a0[1]]), F.P([a1[0], y1, a1[1]]), F.P([b1[0], y1, b1[1]]), F.P([b0[0], y1, b0[1]])], [ca, ca, cb, cb], [0, 1, 0]);
      }
    });
  }

  // The top platform, closing the pyramid.
  frames.forEach((F) => {
    const line = sectorLine(H9, RHO, 0, 1);
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i]; const b = line[i + 1];
      const c = mix3(LIME, LIME_P, rng());
      soup.face([F.P([0, TOP, 0]), F.P([a[0], TOP, a[1]]), F.P([b[0], TOP, b[1]])], c, [0, 1, 0]);
    }
  });

  // --- four stairways, 91 steps each --------------------------------------------------------------
  const COLS = 7;
  let treadsBuilt = 0;
  const wearAt = (x) => -(1 - (x / STAIR_HALF) ** 2) * 0.014;
  for (let q = 0; q < 4; q += 1) {
    const F = frames[q * 2];
    for (let i = 1; i <= STEPS + 1; i += 1) {
      const zRiser = FOOT_Z - (i - 1) * RUN; // riser i stands here
      const yLow = GROUND + (i - 1) * RISER;
      const yHigh = GROUND + i * RISER;
      const tone = stoneTone(LIME, 0.08);
      const rC = mix3(times(LIME_D, 0.74), MOSS, 0.16 + rng() * 0.2);
      for (let c = 0; c < COLS; c += 1) {
        const x0 = mix(-STAIR_HALF, STAIR_HALF, c / COLS); const x1 = mix(-STAIR_HALF, STAIR_HALF, (c + 1) / COLS);
        const w0 = wearAt(x0); const w1 = wearAt(x1);
        // The riser: from the tread below (or the ground) up to this tread.
        const low0 = i === 1 ? yLow : yLow + w0; const low1 = i === 1 ? yLow : yLow + w1;
        const hi0 = i === STEPS + 1 ? yHigh : yHigh + w0; const hi1 = i === STEPS + 1 ? yHigh : yHigh + w1;
        soup.face([F.P([x0, low0, zRiser]), F.P([x1, low1, zRiser]), F.P([x1, hi1, zRiser]), F.P([x0, hi0, zRiser])], [rC, rC, times(LIME_D, 0.86), times(LIME_D, 0.86)], F.D([0, 0, 1]));
        if (i <= STEPS) {
          const zBack = zRiser - RUN;
          soup.face([F.P([x0, hi0, zRiser]), F.P([x1, hi1, zRiser]), F.P([x1, hi1, zBack]), F.P([x0, hi0, zBack])], tone, [0, 1, 0]);
        }
      }
      if (i <= STEPS) treadsBuilt += 1;
    }
    // The balustrades either side, a sloped solid running the whole height.
    for (const side of [-1, 1]) {
      const xIn = side * STAIR_HALF; const xOut = side * (STAIR_HALF + BAL_W);
      const foot = FOOT_Z + 0.3;
      const rail = 0.28;
      const ridge = (x) => [[x, GROUND, H9 - 0.4], [x, GROUND, foot], [x, GROUND + rail + 0.02, foot], [x, TOP + rail, H9]];
      const c = stoneTone(LIME, 0.04);
      soup.face(ridge(xOut).map((p) => F.P(p)), c, F.D([side, 0, 0]));
      soup.face(ridge(xIn).map((p) => F.P(p)), times(c, 0.9), F.D([-side, 0, 0]));
      soup.face([F.P([xOut, GROUND + rail + 0.02, foot]), F.P([xIn, GROUND + rail + 0.02, foot]), F.P([xIn, TOP + rail, H9]), F.P([xOut, TOP + rail, H9])], times(LIME_P, 0.98), F.D([0, 1, 1]));
      soup.face([F.P([xOut, GROUND, foot]), F.P([xIn, GROUND, foot]), F.P([xIn, GROUND + rail + 0.02, foot]), F.P([xOut, GROUND + rail + 0.02, foot])], c, F.D([0, 0, 1]));
      soup.face([F.P([xOut, TOP, H9]), F.P([xIn, TOP, H9]), F.P([xIn, TOP + rail, H9]), F.P([xOut, TOP + rail, H9])], times(c, 0.86), F.D([0, 0, -1]));
    }
  }
  if (treadsBuilt !== STEPS * 4) throw new Error(`El Castillo must have ${STEPS * 4} treads, built ${treadsBuilt}`);

  // --- the temple on the summit ---------------------------------------------------------------------
  const TH = 3.35;
  const WALL = 1.85;
  const WALLC = lin(0xbdb59d);
  const WOOD = lin(0x46321f);
  const sides = [
    { out: [0, 0, 1], ux: [1, 0, 0] },
    { out: [0, 0, -1], ux: [1, 0, 0] },
    { out: [1, 0, 0], ux: [0, 0, 1] },
    { out: [-1, 0, 0], ux: [0, 0, 1] },
  ];
  const w = TH * 2;
  // The north door is the wide one, divided by two serpent columns. The other three are single.
  sides.forEach((sd, i) => {
    const o = [sd.out[0] * TH - sd.ux[0] * TH, TOP, sd.out[2] * TH - sd.ux[2] * TH];
    const north = i === 0;
    const opening = north
      ? { cx: w / 2, y0: 0, y1: 1.36, w: 3.3, arch: false }
      : { cx: w / 2, y0: 0, y1: 1.3, w: 1.26, arch: false };
    wallWithOpenings(soup, o, sd.ux, [0, 1, 0], sd.out, w, WALL, [opening], {
      col: WALLC, depth: north ? 0.72 : 0.56, reveal: times(WALLC, 0.6), uvOrigin: [i * 3.1, 0],
    });
    // A timber lintel over the door, proud of the reveal: the real ones are carved sapodilla.
    const off = (a, b, yy) => [sd.out[0] * (TH + a) + sd.ux[0] * b, yy, sd.out[2] * (TH + a) + sd.ux[2] * b];
    const half = opening.w / 2 + 0.05;
    const yy0 = TOP + opening.y1 - 0.02; const yy1 = yy0 + 0.17;
    const a0 = -0.04; const a1 = 0.02;
    soup.hexa([off(a0, -half, yy0), off(a1, -half, yy0), off(a1, half, yy0), off(a0, half, yy0)], [off(a0, -half, yy1), off(a1, -half, yy1), off(a1, half, yy1), off(a0, half, yy1)], WOOD);
  });
  // The two serpent columns in the north door, each on a squared base.
  for (const x of [-0.58, 0.58]) {
    const c = [x, TH - 0.36];
    const col = stoneTone(LIME_P, 0.03);
    soup.box(x - 0.24, TOP, TH - 0.6, x + 0.24, TOP + 0.26, TH - 0.12, col);
    soup.frustum(c, TOP + 0.26, c, TOP + 1.12, 0.17, 0.16, 16, col, { capTop: false });
    soup.box(x - 0.24, TOP + 1.12, TH - 0.6, x + 0.24, TOP + 1.38, TH - 0.12, col);
  }
  // Mouldings and a recessed frieze above the walls, and a flat roof crowned with merlons.
  const bandRing = (y0, y1, e, col) => {
    const H = TH + e;
    soup.box(-H, y0, -H, H, y1, H, col, {});
  };
  const yF = TOP + WALL;
  bandRing(yF - 0.02, yF + 0.14, 0.12, lin(0xd0cab5));
  bandRing(yF + 0.14, yF + 0.2, 0.02, times(WALLC, 0.84));
  bandRing(yF + 0.2, yF + 0.74, -0.03, times(WALLC, 0.96));
  // Blocks on the frieze: a rhythm of stepped panels, the temple's carved upper zone, simplified.
  sides.forEach((sd) => {
    const n = 9;
    for (let i = 0; i < n; i += 1) {
      const b = mix(-TH + 0.3, TH - 0.3, i / (n - 1));
      const off = (a, bb, yy) => [sd.out[0] * (TH + a) + sd.ux[0] * bb, yy, sd.out[2] * (TH + a) + sd.ux[2] * bb];
      const big = i % 2 === 0;
      const hw = big ? 0.2 : 0.13; const y0 = yF + 0.26; const y1 = big ? yF + 0.68 : yF + 0.56;
      const a0 = -0.05; const a1 = big ? 0.06 : 0.03;
      soup.hexa([off(a0, b - hw, y0), off(a1, b - hw, y0), off(a1, b + hw, y0), off(a0, b + hw, y0)], [off(a0, b - hw, y1), off(a1, b - hw, y1), off(a1, b + hw, y1), off(a0, b + hw, y1)], big ? lin(0xcdc6b1) : times(WALLC, 0.9));
    }
  });
  bandRing(yF + 0.74, yF + 0.92, 0.13, lin(0xd0cab5));
  const yRoof = yF + 0.92;
  // Merlons along the parapet's four edges: a stepped block, which is what survives on the real one.
  sides.forEach((sd, si) => {
    const n = 7;
    for (let i = 0; i < n; i += 1) {
      if (si >= 2 && (i === 0 || i === n - 1)) continue;
      const b = mix(-TH + 0.1, TH - 0.1, i / (n - 1));
      const off = (a, bb, yy) => [sd.out[0] * (TH + a) + sd.ux[0] * bb, yy, sd.out[2] * (TH + a) + sd.ux[2] * bb];
      const c = stoneTone(LIME_P, 0.05);
      const lower = (hw, y0, y1, a0, a1) => soup.hexa([off(a0, b - hw, y0), off(a1, b - hw, y0), off(a1, b + hw, y0), off(a0, b + hw, y0)], [off(a0, b - hw, y1), off(a1, b - hw, y1), off(a1, b + hw, y1), off(a0, b + hw, y1)], c, { skipBottom: true });
      lower(0.27, yRoof - 0.01, yRoof + 0.2, -0.16, 0.04);
      lower(0.14, yRoof + 0.2, yRoof + 0.42, -0.13, 0.01);
    }
  });

  // --- the serpent heads at the foot of the north stairway (+Z) -------------------------------------
  const heads = [];
  const head = serpentHead(0xa0977f, 0x2a2620);
  // The heads get a material of their own: each is carved from the solid, so the wall tile's joints
  // have no business running across its face.
  for (const m of [1, -1]) {
    const g = head.clone();
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(m * (STAIR_HALF + BAL_W / 2), GROUND - 0.02, FOOT_Z + 0.42));
    heads.push({ geometry: g, keepColor: true });
  }

  // --- the Great Plaza ------------------------------------------------------------------------------
  const PLAZA = 19.6;
  const N = 40;
  const pos = []; const idx = []; const col = []; const uv = [];
  const GA = lin(0x6c7b3e); const GB = lin(0x8b8c50); const BARE = lin(0xa89c78);
  const plazaY = (x, z) => {
    const edge = Math.min(PLAZA - Math.abs(x), PLAZA - Math.abs(z));
    return mix(0.03, GROUND - 0.01, sstep(edge, 0, 0.6));
  };
  for (let j = 0; j <= N; j += 1) {
    for (let i = 0; i <= N; i += 1) {
      const x = mix(-PLAZA, PLAZA, i / N); const z = mix(-PLAZA, PLAZA, j / N);
      pos.push(x, plazaY(x, z), z);
      uv.push(x, z);
      const box = Math.max(Math.abs(x), Math.abs(z));
      const c = mix3(mix3(GA, GB, smoothNoise3(x * 0.3, 2, z * 0.3)), BARE, (1 - sstep(box, H0 + 0.2, H0 + 2.4)) * 0.75);
      col.push(...c);
    }
  }
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const a = j * (N + 1) + i; const b = a + 1; const c = a + N + 1; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const plazaGeo = new THREE.BufferGeometry();
  plazaGeo.setIndex(idx);
  plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  plazaGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  plazaGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  plazaGeo.computeVertexNormals();
  const plazaEdge = new Soup();
  const EARTH = lin(0x6e6048);
  for (const [ax, az, bx, bz, hx, hz] of [[-PLAZA, PLAZA, PLAZA, PLAZA, 0, 1], [-PLAZA, -PLAZA, PLAZA, -PLAZA, 0, -1], [PLAZA, -PLAZA, PLAZA, PLAZA, 1, 0], [-PLAZA, -PLAZA, -PLAZA, PLAZA, -1, 0]]) {
    plazaEdge.face([[ax, 0, az], [bx, 0, bz], [bx, 0.03, bz], [ax, 0.03, az]], EARTH, [hx, 0, hz]);
  }

  const headMesh = mesh(mergeParts(heads), standard({ vertexColors: true, roughness: 0.96, metalness: 0, bumpMap: repeatFeet(grainBump(71), 1.3), bumpScale: 0.5 }));
  const pyramid = mesh(soup.geometry(), stoneMaterial(repeatFeet(ashlarTile(37, { courses: 11, minLen: 70, spread: 110, moss: 0.9, jointW: 3 }), 5.4), { bumpScale: 0.55 }));
  const plaza = mesh(mergeParts([{ geometry: plazaGeo, keepColor: true }, { geometry: plazaEdge.geometry(), keepColor: true }]), standard({
    vertexColors: true, map: repeatFeet(grassTile(23), 3), roughness: 1, metalness: 0, ...relief('soil', { seed: 43, repeat: 10, strength: 0.8 }),
  }));
  plaza.castShadow = false;
  return group(plaza, pyramid, headMesh);
}

// ---------------------------------------------------------------------------

export const BUILDERS = {
  'eiffel-tower': eiffelTower,
  'great-wall': greatWall,
  'leaning-tower-of-pisa': leaningTowerOfPisa,
  stonehenge,
  'el-castillo': elCastillo,
};
