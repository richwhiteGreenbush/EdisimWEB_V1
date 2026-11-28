import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, canvasTexture, mesh, standard, relief } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, lathe, lin, mix, clamp01, outward, alongMatrix } from '../ModelKit.js';
import { PALETTE } from '../town/TownKit.js';

// The Build a City kit's works: the pieces that keep a city running rather than housing anybody.
//
//   city-park           exactly 40 x 40, x and z = -20..20: lawn, crossing paths, a plaza with a
//                       drinking fountain, three shade trees, four benches and a playground (slide
//                       and swings) on a rubber safety surface. Its edges are a 10ft grid's.
//   recycling-bins      three 3.5ft wheeled carts side by side: grey TRASH, blue RECYCLE, green
//                       COMPOST, each with its symbol drawn as paths on the lid and the front.
//   solar-panel-array   two rows of 12 panels, 39ft long, tilted 27 degrees to face +Z (the card's
//                       "south"), on steel racks with posts into concrete, and an inverter on a post.
//   water-tower         a 36ft steel tank on four legs, 120ft to the lightning rod, with a balcony,
//                       a caged ladder and OUR TOWN painted on both faces.
//
// Real life size in feet, origin at the base centre, front is +Z, fresh materials per build,
// seededRandom only, one mesh per material.

// ---------------------------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------------------------
function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// A vertical cylinder from y0 to y1.
function cylY(rBot, rTop, y0, y1, x, z, seg = 16) {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, 1);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

// A round rod from a to b, closed at both ends.
function rod(a, b, r, sides = 8) {
  const { m, len } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

// A squared bar from a to b: `w` across, `h` along the up the hint leaves.
function bar(a, b, w, h, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

function ball(c, r, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// A run of rods through a polyline, with a ball at every bend so no corner is left open.
function rodPath(list, pts, r, color, sides = 8) {
  for (let i = 0; i < pts.length - 1; i++) list.push({ geometry: rod(pts[i], pts[i + 1], r, sides), color });
  for (let i = 1; i < pts.length - 1; i++) list.push({ geometry: ball(pts[i], r * 1.02, sides, Math.max(4, sides / 2 + 1)), color });
}

const yawMatrix = (x, y, z, yaw) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1),
);

// UVs in feet from the world position, planar by the face's own normal, so one tile serves a 40ft
// lawn and a 5ft path alike.
function feetUV(g, tile = 1) {
  const P = g.attributes.position; const N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Maps a box's (or any 0..1) UVs into one rectangle of an atlas.
function uvInto(g, r) {
  const U = g.attributes.uv;
  for (let i = 0; i < U.count; i++) U.setXY(i, mix(r.u0, r.u1, U.getX(i)), mix(r.v0, r.v1, U.getY(i)));
  return g;
}

// A pixel rectangle of a canvas as UVs (CanvasTexture flips Y).
const rect = (x, y, w, h, W, H) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });

function fitFont(ctx, text, maxW, px, family, weight = 'bold') {
  ctx.font = `${weight} ${px}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > maxW) {
    px = Math.max(6, Math.floor((px * maxW) / measured));
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}
const SANS = 'Arial, Helvetica, sans-serif';
const HEAVY = '"Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif';

function tone(hex, k) {
  const c = new THREE.Color(hex);
  c.r *= k; c.g *= k; c.b *= k;
  return c;
}

function meshOf(parts, material, { cast = true, receive = true } = {}) {
  const m = mesh(mergeParts(parts), material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// A closed solid swept along a path lying in an XY plane: `outline` is a closed polygon of
// [across (along +Z), up (the path's own normal)] points. Every triangle is oriented by its known
// outward direction, so a non-convex section (a slide's U) cannot come out inside out.
function sweepXY(pathPts, outline) {
  const n = pathPts.length;
  const m = outline.length;
  let area = 0;
  for (let j = 0; j < m; j++) {
    const [a0, b0] = outline[j]; const [a1, b1] = outline[(j + 1) % m];
    area += a0 * b1 - a1 * b0;
  }
  const ccw = area > 0;
  const Z = new THREE.Vector3(0, 0, 1);
  const up = new THREE.Vector3(0, 1, 0);
  const rings = [];
  const frames = [];
  for (let i = 0; i < n; i++) {
    const T = pathPts[Math.min(n - 1, i + 1)].clone().sub(pathPts[Math.max(0, i - 1)]).normalize();
    const N = up.clone().addScaledVector(T, -up.dot(T)).normalize();
    frames.push({ T, N });
    rings.push(outline.map(([s, t]) => pathPts[i].clone().addScaledVector(Z, s).addScaledVector(N, t)));
  }
  const pos = [];
  const tri = (a, b, c, want) => {
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    if (nrm.dot(want) < 0) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const [s0, t0] = outline[j]; const [s1, t1] = outline[j2];
      const ds = s1 - s0; const dt = t1 - t0;
      const o = ccw ? [dt, -ds] : [-dt, ds];
      const F = frames[i];
      const want = Z.clone().multiplyScalar(o[0]).addScaledVector(F.N, o[1]);
      const a = rings[i][j]; const b = rings[i][j2]; const c = rings[i + 1][j2]; const d = rings[i + 1][j];
      tri(a, b, c, want); tri(a, c, d, want);
    }
  }
  const tris = THREE.ShapeUtils.triangulateShape(outline.map(([s, t]) => new THREE.Vector2(s, t)), []);
  for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
    const want = frames[i].T.clone().multiplyScalar(sign);
    for (const [a, b, c] of tris) tri(rings[i][a], rings[i][b], rings[i][c], want);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A closed loft of rounded rectangles, bottom to top: [{ y, hw, hd, r, cz }]. The caps carry their
// own vertices, so the top and bottom edges stay crisp while the corners round smoothly.
function roundedLoft(sections, k = 4) {
  const ringOf = (s) => {
    const pts = [];
    const cz = s.cz ?? 0;
    const r = Math.min(s.r, s.hw - 1e-3, s.hd - 1e-3);
    const cs = [[s.hw - r, s.hd - r], [-(s.hw - r), s.hd - r], [-(s.hw - r), -(s.hd - r)], [s.hw - r, -(s.hd - r)]];
    for (let c = 0; c < 4; c++) {
      for (let j = 0; j <= k; j++) {
        const a = (c * Math.PI) / 2 + (j / k) * (Math.PI / 2);
        pts.push([cs[c][0] + r * Math.cos(a), s.y, cz + cs[c][1] + r * Math.sin(a)]);
      }
    }
    return pts;
  };
  const rings = sections.map(ringOf);
  const m = rings[0].length;
  const pos = [];
  const index = [];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = i * m + j; const b = i * m + j2; const c = (i + 1) * m + j2; const d = (i + 1) * m + j;
      index.push(a, c, b, a, d, c);
    }
  }
  for (const [ri, top] of [[0, false], [rings.length - 1, true]]) {
    const base = pos.length / 3;
    for (const p of rings[ri]) pos.push(...p);
    const s = sections[ri];
    const centre = pos.length / 3;
    pos.push(0, s.y, s.cz ?? 0);
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      if (top) index.push(centre, base + j2, base + j); else index.push(centre, base + j, base + j2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// ---------------------------------------------------------------------------------------------
// Near-white textures, multiplied by vertex colour
// ---------------------------------------------------------------------------------------------
function wrapDraw(w, h, x, y, r, fn) {
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (x + ox < -r || x + ox > w + r || y + oy < -r || y + oy > h + r) continue;
      fn(x + ox, y + oy);
    }
  }
}

// Mown grass: short blades in every direction, a little darker in drifts, tiling both ways.
function grassMap(seed, size = 256) {
  const rng = seededRandom(seed);
  const t = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#e9eee2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const x = rng() * w; const y = rng() * h; const r = 20 + rng() * 50;
      wrapDraw(w, h, x, y, r, (px, py) => {
        ctx.fillStyle = `rgba(120,140,100,${0.05 + rng() * 0.06})`;
        ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.7, rng() * 3, 0, Math.PI * 2); ctx.fill();
      });
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w; const y = rng() * h; const len = 2 + rng() * 5; const a = rng() * Math.PI * 2;
      const dark = rng() < 0.62;
      ctx.strokeStyle = dark ? `rgba(70,96,52,${0.18 + rng() * 0.3})` : `rgba(255,255,240,${0.25 + rng() * 0.35})`;
      ctx.lineWidth = 0.8 + rng() * 0.9;
      wrapDraw(w, h, x, y, len, (px, py) => {
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke();
      });
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Speckle: concrete aggregate, path grit or rubber crumb, depending on the colour under it.
function speckleMap(seed, size = 256) {
  const rng = seededRandom(seed);
  const t = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#efede8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 10; i++) {
      const x = rng() * w; const y = rng() * h; const r = 30 + rng() * 60;
      wrapDraw(w, h, x, y, r, (px, py) => {
        ctx.fillStyle = `rgba(110,105,95,${0.03 + rng() * 0.04})`;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      });
    }
    for (let i = 0; i < 3200; i++) {
      const x = rng() * w; const y = rng() * h; const r = 0.6 + rng() * 1.5;
      const v = rng();
      ctx.fillStyle = v < 0.6 ? `rgba(80,76,70,${0.15 + rng() * 0.35})` : `rgba(255,255,255,${0.3 + rng() * 0.4})`;
      wrapDraw(w, h, x, y, r, (px, py) => { ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); });
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Leaf clusters: overlapping small leaves with darker gaps, carried as map and bump on the crowns.
function leafMap(seed, size = 256) {
  const rng = seededRandom(seed);
  const t = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#b9c2ad';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const x = rng() * w; const y = rng() * h; const r = 3.5 + rng() * 5; const a = rng() * Math.PI;
      const k = rng();
      const c = k < 0.45 ? `rgba(246,250,236,${0.5 + rng() * 0.4})` : k < 0.8 ? `rgba(214,224,200,${0.6 + rng() * 0.3})` : `rgba(120,138,104,${0.35 + rng() * 0.3})`;
      wrapDraw(w, h, x, y, r * 1.6, (px, py) => {
        ctx.fillStyle = c;
        ctx.beginPath(); ctx.ellipse(px, py, r * 1.6, r * 0.75, a, 0, Math.PI * 2); ctx.fill();
      });
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------------------------------------
// CITY PARK
// ---------------------------------------------------------------------------------------------
const PARK = 20; // half-size: the park is exactly 40 x 40
const LAWN_TOP = 0.25;
const PATH_TOP = 0.28;
const PLAZA_TOP = 0.3;
const RUBBER_TOP = 0.33;
const KERB_TOP = 0.42;
const BASE = -0.4;
const PATH_W = 5;
const PLAZA_R = 5.5;

// Crown lumps: a smooth function of DIRECTION, so every copy of a shared corner moves identically.
function lumps(d, ph) {
  return Math.sin(d.x * 3.1 + ph) * Math.cos(d.z * 2.7 - ph * 0.6) * 0.5
    + Math.sin(d.y * 4.3 + d.x * 2.2 + ph * 1.7) * 0.35
    + Math.cos(d.z * 5.2 - d.y * 1.9 + ph * 0.4) * 0.22
    + Math.sin(d.x * 7.1 - d.z * 6.3 + ph * 2.3) * 0.16;
}

function crownBlob(c, R, squash, detail, rng, base) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position;
  const ph = rng() * 10;
  const d = new THREE.Vector3();
  const col = new Float32Array(P.count * 3);
  const baseC = lin(base);
  for (let i = 0; i < P.count; i++) {
    d.set(P.getX(i), P.getY(i), P.getZ(i)).normalize();
    const k = 1 + lumps(d, ph) * 0.16;
    const x = c[0] + d.x * R * k; const y = c[1] + d.y * R * k * squash; const z = c[2] + d.z * R * k;
    P.setXYZ(i, x, y, z);
    // Darker underneath and deep in the folds: the crown's own shade.
    const shade = 0.62 + 0.38 * clamp01(d.y * 0.5 + 0.55) + lumps(d, ph + 2) * 0.08;
    col[i * 3] = baseC[0] * shade; col[i * 3 + 1] = baseC[1] * shade; col[i * 3 + 2] = baseC[2] * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Smooth normals first, then every triangle takes the leaf map projected along its own dominant
  // axis. The seams this leaves between faces vanish in a texture that is nothing but leaves, and
  // nothing is stretched down the flanks.
  const flat = g.toNonIndexed();
  const Q = flat.attributes.position;
  const uv = new Float32Array(Q.count * 2);
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const e = new THREE.Vector3(); const fn = new THREE.Vector3();
  for (let t = 0; t < Q.count; t += 3) {
    a.fromBufferAttribute(Q, t); b.fromBufferAttribute(Q, t + 1); e.fromBufferAttribute(Q, t + 2);
    fn.subVectors(b, a).cross(e.sub(a));
    const ax = Math.abs(fn.x); const ay = Math.abs(fn.y); const az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const x = Q.getX(t + k); const y = Q.getY(t + k); const z = Q.getZ(t + k);
      const [u, v] = ay >= ax && ay >= az ? [x, z] : ax >= az ? [z, y] : [x, y];
      uv[(t + k) * 2] = u / 2.6; uv[(t + k) * 2 + 1] = v / 2.6;
    }
  }
  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return flat;
}

function shadeTree(wood, leaves, x, z, seed, { height = 1, leaf = PALETTE.leaf } = {}) {
  const rng = seededRandom(seed);
  const s = height;
  const bark = PALETTE.bark;
  wood.push({
    geometry: tube([[x, 0.5, z], [x + 0.1 * s, 3.5 * s, z + 0.05], [x - 0.05, 7.5 * s, z - 0.1], [x + 0.05, 9.6 * s, z]], [0.95, 0.62, 0.52, 0.4], { sides: 12, steps: 10, round: 1 }),
    color: bark,
  });
  // A root flare, sunk into the lawn.
  wood.push({ geometry: lathe([[0, -0.4], [1.25, -0.4], [1.05, LAWN_TOP + 0.05], [0.7, 1.0], [0, 1.2]], 12).translate(x, 0, z), color: tone(bark, 0.92) });
  const branches = 5;
  for (let i = 0; i < branches; i++) {
    const a = (i / branches) * Math.PI * 2 + rng() * 0.8;
    const y0 = (7.2 + rng() * 2) * s;
    const out = 3.2 + rng() * 1.6;
    wood.push({
      geometry: tube([[x, y0, z], [x + Math.cos(a) * out * 0.55, y0 + 1.8, z + Math.sin(a) * out * 0.55], [x + Math.cos(a) * out, y0 + 3.6, z + Math.sin(a) * out]], [0.34, 0.22, 0.12], { sides: 7, steps: 6, round: 1 }),
      color: bark,
    });
  }
  const cy = 14.2 * s;
  leaves.push({ geometry: crownBlob([x, cy, z], 6.2 * s, 0.74, 3, rng, leaf), keepColor: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng() * 0.8;
    const rr = (3.9 + rng() * 0.8) * s;
    const lc = tone(leaf, 0.9 + rng() * 0.2).getHex();
    leaves.push({ geometry: crownBlob([x + Math.cos(a) * rr, cy - 1.6 * s + rng() * 2.6, z + Math.sin(a) * rr], (2.8 + rng() * 0.9) * s, 0.8, 2, rng, lc), keepColor: true });
  }
}

// A park bench facing +Z in its own frame: cast iron ends, wooden slats, 6ft long, seat at 1.5ft.
function bench(wood, iron, M) {
  const W = []; const I = [];
  const IRON = 0x2f3a33;
  const SLAT = 0x8b5e3c;
  for (const x of [-2.75, 2.75]) {
    I.push({ geometry: bar([x, -0.05, 0.72], [x, 2.25, 0.8], 0.16, 0.16, [0, 0, 1]), color: IRON }); // front leg + arm post
    I.push({ geometry: bar([x, -0.05, -0.72], [x, 1.45, -0.78], 0.16, 0.16, [0, 0, 1]), color: IRON }); // back leg
    I.push({ geometry: bar([x, 1.45, -0.78], [x, 3.05, -1.12], 0.16, 0.16, [0, 0, 1]), color: IRON }); // back standard
    I.push({ geometry: bar([x, 1.36, 0.95], [x, 1.36, -0.92], 0.18, 0.14, [0, 1, 0]), color: IRON }); // seat rail
    I.push({ geometry: bar([x, 2.25, 0.98], [x, 2.36, -0.9], 0.22, 0.12, [0, 1, 0]), color: IRON }); // arm rest
    I.push({ geometry: boxAt(0.3, 0.08, 0.34, x, -0.02, 0.72), color: IRON }); // feet
    I.push({ geometry: boxAt(0.3, 0.08, 0.34, x, -0.02, -0.72), color: IRON });
  }
  I.push({ geometry: bar([0, 0.02, 0.6], [0, 1.36, 0.6], 0.14, 0.14, [0, 0, 1]), color: IRON });
  I.push({ geometry: bar([0, 1.36, 0.9], [0, 1.36, -0.85], 0.14, 0.12, [0, 1, 0]), color: IRON });
  // Seat slats, then the back slats following the standard's lean.
  for (const z of [0.72, 0.33, -0.06, -0.45]) W.push({ geometry: boxAt(6.0, 0.11, 0.3, 0, 1.49, z), color: tone(SLAT, 0.92 + ((z * 7) % 0.16)) });
  const lean = Math.atan2(0.34, 1.6);
  for (const [i, t] of [0.22, 0.52, 0.82].entries()) {
    const y = 1.45 + t * 1.6; const z = -0.78 - t * 0.34 + 0.12;
    const g = new THREE.BoxGeometry(6.0, 0.36, 0.11);
    g.rotateX(-lean);
    g.translate(0, y, z);
    W.push({ geometry: g, color: tone(SLAT, 0.95 + i * 0.03) });
  }
  for (const p of W) { p.geometry.applyMatrix4(M); wood.push(p); }
  for (const p of I) { p.geometry.applyMatrix4(M); iron.push(p); }
}

function cityPark() {
  const rng = seededRandom(9101);
  const lawn = []; const hard = []; const wood = []; const leaves = []; const paint = [];

  // The lawn: one slab, foundation to y = -0.4, exactly the 40ft square.
  lawn.push({ geometry: feetUV(boxAt(40, LAWN_TOP - BASE, 40, 0, (LAWN_TOP + BASE) / 2, 0), 4), color: tone(PALETTE.grass, 0.88) });

  // The low kerb round the edge, broken where the paths come in.
  const KERB = PALETTE.kerb;
  const kw = 0.5;
  const gap = PATH_W / 2;
  const kerbRun = (along, fixed, from, to) => {
    const len = to - from; const c = (from + to) / 2;
    const g = along === 'x'
      ? boxAt(len, KERB_TOP - BASE, kw, c, (KERB_TOP + BASE) / 2, fixed)
      : boxAt(kw, KERB_TOP - BASE, len, fixed, (KERB_TOP + BASE) / 2, c);
    hard.push({ geometry: feetUV(g, 3), color: KERB });
  };
  for (const s of [-1, 1]) {
    const f = s * (PARK - kw / 2);
    kerbRun('x', f, -PARK, -gap); kerbRun('x', f, gap, PARK);
    kerbRun('z', f, -PARK + kw, -gap); kerbRun('z', f, gap, PARK - kw);
  }

  // The crossing paths, stopping under the plaza so no two tops are coplanar.
  const PATH = 0xc2b9a6;
  const p0 = 4.8;
  for (const s of [-1, 1]) {
    const c = s * (p0 + PARK) / 2; const len = PARK - p0;
    hard.push({ geometry: feetUV(boxAt(len, PATH_TOP - 0.15, PATH_W, c, (PATH_TOP + 0.15) / 2, 0), 3), color: PATH });
    hard.push({ geometry: feetUV(boxAt(PATH_W, PATH_TOP - 0.15, len, 0, (PATH_TOP + 0.15) / 2, c), 3), color: PATH });
  }
  // The plaza, a paved circle with a darker ring of setts round it.
  hard.push({ geometry: feetUV(cylY(PLAZA_R, PLAZA_R, 0.15, PLAZA_TOP, 0, 0, 48), 3), color: 0xc9c0ae });
  hard.push({ geometry: feetUV(lathe([[0, 0.15], [PLAZA_R + 0.45, 0.15], [PLAZA_R + 0.45, PLAZA_TOP + 0.02], [PLAZA_R - 0.4, PLAZA_TOP + 0.02], [PLAZA_R - 0.4, 0.2], [0, 0.2]], 48), 3), color: 0x9c9384 });

  // The playground's soft rubber surface, its edge a slightly darker border.
  const PG = { x0: 4.2, x1: 19.0, z0: -19.0, z1: -4.2 };
  const RUBBER = 0xa4533c;
  hard.push({ geometry: feetUV(boxAt(PG.x1 - PG.x0, RUBBER_TOP - 0.12, PG.z1 - PG.z0, (PG.x0 + PG.x1) / 2, (RUBBER_TOP + 0.12) / 2, (PG.z0 + PG.z1) / 2), 3), color: RUBBER });
  for (const [w, d, x, z] of [
    [PG.x1 - PG.x0 + 0.5, 0.25, (PG.x0 + PG.x1) / 2, PG.z1 + 0.12], [PG.x1 - PG.x0 + 0.5, 0.25, (PG.x0 + PG.x1) / 2, PG.z0 - 0.12],
    [0.25, PG.z1 - PG.z0, PG.x0 - 0.12, (PG.z0 + PG.z1) / 2], [0.25, PG.z1 - PG.z0, PG.x1 + 0.12, (PG.z0 + PG.z1) / 2],
  ]) hard.push({ geometry: feetUV(boxAt(w, RUBBER_TOP + 0.05 - 0.1, d, x, (RUBBER_TOP + 0.05 + 0.1) / 2, z), 3), color: 0x6f3a2c });

  // Three shade trees in the three lawn quarters the playground leaves.
  shadeTree(wood, leaves, -11.2, 11.0, 9111, { height: 1.0 });
  shadeTree(wood, leaves, 11.5, 11.4, 9112, { height: 0.94, leaf: 0x5a9138 });
  shadeTree(wood, leaves, -11.0, -11.4, 9113, { height: 1.05, leaf: 0x4a8233 });

  // Low flowering shrubs flanking the entrances, each a few overlapping lumps.
  const shrubRng = seededRandom(9114);
  for (const [x, z] of [[-4.9, 17.6], [4.9, 17.6], [-17.6, 4.9], [-17.6, -4.9], [17.6, 4.9], [-4.9, -17.6]]) {
    for (let k = 0; k < 3; k++) {
      const a = shrubRng() * Math.PI * 2;
      const hue = k === 2 ? 0x3f7a35 : 0x4d8a3a;
      leaves.push({ geometry: crownBlob([x + Math.cos(a) * 0.9, LAWN_TOP + 0.9, z + Math.sin(a) * 0.9], 1.25 + shrubRng() * 0.35, 0.78, 2, shrubRng, hue), keepColor: true });
    }
  }

  // Four benches along the paths, under the trees, and one watching the playground.
  bench(wood, paint, yawMatrix(-4.6, LAWN_TOP, 10.5, Math.PI / 2));
  bench(wood, paint, yawMatrix(4.6, LAWN_TOP, 10.5, -Math.PI / 2));
  bench(wood, paint, yawMatrix(-11.0, LAWN_TOP, -4.6, 0));
  bench(wood, paint, yawMatrix(11.0, LAWN_TOP, 4.6, Math.PI));

  // The drinking fountain at the plaza's playground side, with a step for small children.
  const FOUNT = 0x3e6b58;
  const fx = 3.0; const fz = -3.0;
  paint.push({ geometry: lathe([[0, PLAZA_TOP - 0.05], [0.85, PLAZA_TOP - 0.05], [0.85, PLAZA_TOP + 0.2], [0.42, PLAZA_TOP + 0.38], [0.34, 2.25], [0.46, 2.45], [0.92, 2.72], [0.95, 2.95], [0.84, 3.0], [0.62, 2.9], [0, 2.86]], 28).translate(fx, 0, fz), color: FOUNT });
  paint.push({ geometry: rod([fx, 2.84, fz], [fx + 0.25, 3.1, fz + 0.25], 0.07, 8), color: 0xb9bcbe });
  paint.push({ geometry: ball([fx + 0.27, 3.12, fz + 0.27], 0.1, 8, 6), color: 0xb9bcbe });
  paint.push({ geometry: boxAt(0.18, 0.18, 0.12, fx + 0.6, 2.65, fz + 0.6).rotateY(0), color: 0xb9bcbe });
  paint.push({ geometry: boxAt(1.4, 0.6, 0.9, fx + 1.1, PLAZA_TOP + 0.25, fz + 1.1).rotateY(0), color: tone(FOUNT, 0.85) });

  // THE PLAYGROUND
  const POST = 0x2d6a8e; // blue posts
  const RED = 0xc0432e;
  const YELLOW = 0xe1a526;
  const GREEN = 0x3f8a3c;
  // Slide tower: deck at 4ft on four posts, a pyramid roof, guard panels, a ladder on the +Z face.
  const tx = 15.9; const tz = -7.1; const deckY = 4.0; const hw = 1.75;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    paint.push({ geometry: cylY(0.2, 0.2, 0.1, 8.0, tx + sx * hw, tz + sz * hw, 10), color: POST });
    paint.push({ geometry: ball([tx + sx * hw, 8.0, tz + sz * hw], 0.24, 10, 6), color: YELLOW });
  }
  paint.push({ geometry: boxAt(hw * 2 + 0.2, 0.25, hw * 2 + 0.2, tx, deckY, tz), color: GREEN });
  const roof = new THREE.ConeGeometry(2.75, 1.8, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.translate(tx, 8.0 + 0.9, tz);
  paint.push({ geometry: roof, color: RED });
  // Guard panels on the back (-Z) and right (+X) sides; the slide leaves from -X, the ladder at +Z.
  paint.push({ geometry: boxAt(hw * 2 - 0.3, 2.4, 0.12, tx, deckY + 1.4, tz - hw), color: YELLOW });
  paint.push({ geometry: boxAt(0.12, 2.4, hw * 2 - 0.3, tx + hw, deckY + 1.4, tz), color: YELLOW });
  for (const z of [tz + hw - 0.15, tz - hw + 0.15]) paint.push({ geometry: rod([tx - hw, deckY + 2.6, z], [tx - hw + 0.01, deckY + 2.6, z], 0.1, 6), color: POST });
  // Grab rails either side of the slide's entry.
  for (const z of [tz - 1.05, tz + 1.05]) rodPath(paint, [[tx - hw, deckY + 0.1, z], [tx - hw, deckY + 2.4, z]], 0.08, POST, 8);
  // Ladder on the +Z side, leaning out, its feet on the rubber.
  const lz0 = tz + hw; const lz1 = tz + hw + 1.25;
  for (const x of [tx - 0.75, tx + 0.75]) paint.push({ geometry: rod([x, RUBBER_TOP - 0.05, lz1], [x, deckY + 2.2, lz0 - 0.05], 0.09, 8), color: POST });
  for (let i = 1; i <= 3; i++) {
    const y = RUBBER_TOP + i * ((deckY + 0.12 - RUBBER_TOP) / 4); const t = (y - RUBBER_TOP) / (deckY + 2.2 - RUBBER_TOP); const z = mix(lz1, lz0, t);
    paint.push({ geometry: rod([tx - 0.75, y, z], [tx + 0.75, y, z], 0.07, 6), color: YELLOW });
  }
  // The slide: one swept U channel from the deck to a run-out, on two short legs.
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(tx - hw + 0.25, deckY + 0.08, 0), new THREE.Vector3(tx - hw - 1.0, deckY - 0.12, 0),
    new THREE.Vector3(tx - hw - 4.0, deckY - 2.15, 0), new THREE.Vector3(tx - hw - 6.6, 1.25, 0),
    new THREE.Vector3(tx - hw - 7.8, 0.95, 0), new THREE.Vector3(tx - hw - 8.9, 0.92, 0),
  ], false, 'catmullrom', 0.5);
  const chute = sweepXY(curve.getPoints(28), [
    [-1.0, -0.1], [1.0, -0.1], [1.05, 0.0], [1.05, 0.85], [0.9, 0.85], [0.9, 0.06], [-0.9, 0.06], [-0.9, 0.85], [-1.05, 0.85], [-1.05, 0.0],
  ]);
  chute.translate(0, 0, tz);
  paint.push({ geometry: chute, color: YELLOW });
  for (const x of [tx - hw - 8.2, tx - hw - 6.6]) {
    for (const z of [tz - 0.7, tz + 0.7]) paint.push({ geometry: rod([x, RUBBER_TOP - 0.05, z], [x, 1.0, z], 0.08, 8), color: POST });
  }
  // Swing set: an A-frame each end, a beam along X, two belt seats on chains.
  const sz0 = -14.4; const beamY = 8.0; const bx0 = 5.4; const bx1 = 15.8;
  for (const x of [bx0, bx1]) {
    for (const dz of [-3.0, 3.0]) {
      paint.push({ geometry: rod([x, beamY, sz0], [x + (x < 10 ? -0.4 : 0.4), RUBBER_TOP - 0.1, sz0 + dz], 0.17, 10), color: POST });
    }
    paint.push({ geometry: rod([x + (x < 10 ? -0.25 : 0.25), 3.0, sz0 - 1.95], [x + (x < 10 ? -0.25 : 0.25), 3.0, sz0 + 1.95], 0.1, 8), color: POST });
    paint.push({ geometry: ball([x, beamY, sz0], 0.3, 10, 7), color: YELLOW });
  }
  paint.push({ geometry: rod([bx0 - 0.3, beamY, sz0], [bx1 + 0.3, beamY, sz0], 0.2, 12), color: POST });
  for (const [i, x] of [8.0, 13.2].entries()) {
    const seatY = 1.75 + i * 0.05;
    const swing = (i === 0 ? 0.18 : -0.1); // the seats hang a little off plumb, as if just let go
    const sz = sz0 + Math.sin(swing) * (beamY - seatY);
    const sy = beamY - Math.cos(swing) * (beamY - seatY);
    for (const dx of [-0.75, 0.75]) {
      paint.push({ geometry: rod([x + dx, beamY - 0.1, sz0], [x + dx, sy + 0.05, sz], 0.035, 5), color: 0xa8acb0 });
      paint.push({ geometry: boxAt(0.12, 0.22, 0.12, x + dx, beamY - 0.18, sz0), color: 0xa8acb0 });
    }
    const seat = new THREE.BoxGeometry(1.7, 0.12, 0.62);
    seat.rotateX(swing);
    seat.translate(x, sy, sz);
    paint.push({ geometry: seat, color: 0x2a2a2c });
  }

  const group = new THREE.Group();
  const grass = grassMap(9120);
  group.add(meshOf(lawn, standard({ vertexColors: true, map: grass, bumpMap: grass, bumpScale: 0.5, roughness: 0.95, metalness: 0 }), { cast: false }));
  const grit = speckleMap(9121);
  group.add(meshOf(hard, standard({ vertexColors: true, map: grit, bumpMap: grit, bumpScale: 0.4, roughness: 0.92, metalness: 0 })));
  group.add(meshOf(wood, standard({ vertexColors: true, roughness: 0.88, metalness: 0, ...relief('wood', { seed: 9122, repeat: 2 }) })));
  const leafT = leafMap(9123);
  group.add(meshOf(leaves, standard({ vertexColors: true, map: leafT, bumpMap: leafT, bumpScale: 0.9, roughness: 0.9, metalness: 0 })));
  group.add(meshOf(paint, standard({ vertexColors: true, roughness: 0.55, metalness: 0.1 })));
  void rng;
  return group;
}

// ---------------------------------------------------------------------------------------------
// TRASH, RECYCLING AND COMPOST BINS
// ---------------------------------------------------------------------------------------------
const BINS = [
  { key: 'trash', label: 'TRASH', body: 0x666b70, ink: '#4f5458' },
  { key: 'recycle', label: 'RECYCLE', body: 0x2f62a8, ink: '#24508f' },
  { key: 'compost', label: 'COMPOST', body: 0x3c8a3e, ink: '#2e7031' },
];

// The chasing-arrows triangle, drawn as three bent arrows, never the unicode character.
function drawRecycle(ctx, cx, cy, R, lw, color) {
  const V = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  });
  const lerp = (A, B, t) => [mix(A[0], B[0], t), mix(A[1], B[1], t)];
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const side = R * Math.sqrt(3);
  for (let i = 0; i < 3; i++) {
    const A = V[i]; const B = V[(i + 1) % 3]; const C = V[(i + 2) % 3];
    const start = lerp(A, B, 0.56);
    const end = lerp(B, C, 0.2);
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.arcTo(B[0], B[1], end[0], end[1], lw * 1.1);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
    const dx = (C[0] - B[0]) / side; const dy = (C[1] - B[1]) / side;
    const hl = lw * 1.7; const hw = lw * 1.25;
    ctx.beginPath();
    ctx.moveTo(end[0] + dx * hl, end[1] + dy * hl);
    ctx.lineTo(end[0] - dy * hw, end[1] + dx * hw);
    ctx.lineTo(end[0] + dy * hw, end[1] - dx * hw);
    ctx.closePath();
    ctx.fill();
  }
}

// A sprout: two leaves on a curved stem over a mound of soil.
function drawSprout(ctx, cx, cy, s, color) {
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.62);
  ctx.bezierCurveTo(cx - s * 0.05, cy + s * 0.3, cx + s * 0.06, cy + s * 0.05, cx, cy - s * 0.12);
  ctx.stroke();
  const leaf = (bx, by, tx, ty, bulge) => {
    const mx = (bx + tx) / 2; const my = (by + ty) / 2;
    const nx = -(ty - by); const ny = tx - bx;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(mx + nx * bulge, my + ny * bulge, tx, ty);
    ctx.quadraticCurveTo(mx - nx * bulge, my - ny * bulge, bx, by);
    ctx.fill();
  };
  leaf(cx, cy + s * 0.12, cx - s * 0.62, cy - s * 0.22, 0.32);
  leaf(cx, cy - s * 0.08, cx + s * 0.6, cy - s * 0.62, 0.3);
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.7, s * 0.62, s * 0.16, 0, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

// A plain lidded can.
function drawCan(ctx, cx, cy, s, color) {
  ctx.fillStyle = color;
  ctx.fillRect(cx - s * 0.12, cy - s * 0.72, s * 0.24, s * 0.1); // handle
  ctx.fillRect(cx - s * 0.5, cy - s * 0.6, s * 1.0, s * 0.14); // lid
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.42, cy - s * 0.38);
  ctx.lineTo(cx + s * 0.42, cy - s * 0.38);
  ctx.lineTo(cx + s * 0.34, cy + s * 0.68);
  ctx.lineTo(cx - s * 0.34, cy + s * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = s * 0.08; ctx.lineCap = 'round';
  for (const k of [-0.18, 0, 0.18]) {
    ctx.beginPath(); ctx.moveTo(cx + k * s, cy - s * 0.22); ctx.lineTo(cx + k * s * 0.86, cy + s * 0.52); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSymbol(ctx, key, cx, cy, s, color) {
  if (key === 'recycle') drawRecycle(ctx, cx, cy + s * 0.08, s * 0.62, s * 0.17, color);
  else if (key === 'compost') drawSprout(ctx, cx, cy - s * 0.05, s * 0.8, color);
  else drawCan(ctx, cx, cy, s * 0.8, color);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 768 x 512: a column per bin, the front sticker on top and the lid's painted symbol below.
function binAtlas() {
  return canvasTexture(768, 512, (ctx) => {
    BINS.forEach((b, i) => {
      const x0 = i * 256;
      // Front sticker: white with a coloured border, the symbol and the word.
      ctx.fillStyle = `#${new THREE.Color(b.body).getHexString()}`;
      ctx.fillRect(x0, 0, 256, 256);
      ctx.fillStyle = '#f1f1ec';
      roundRect(ctx, x0 + 8, 8, 240, 240, 26); ctx.fill();
      ctx.strokeStyle = b.ink; ctx.lineWidth = 7;
      roundRect(ctx, x0 + 18, 18, 220, 220, 20); ctx.stroke();
      drawSymbol(ctx, b.key, x0 + 128, 100, 118, b.ink);
      ctx.fillStyle = b.ink;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      fitFont(ctx, b.label, 196, 46, HEAVY, 'bold');
      ctx.fillText(b.label, x0 + 128, 202);
      // Lid: only the white symbol, cut out by alphaTest, so the lid's own plastic shows round it.
      ctx.clearRect(x0, 256, 256, 256);
      drawSymbol(ctx, b.key, x0 + 128, 384, 190, '#f2f2ee');
    });
  });
}

function oneBin(plastic, decals, cx, b, i) {
  const BODY = b.body;
  const hdAt = (y) => mix(0.93, 1.13, clamp01((y - 0.25) / 2.8));
  const body = roundedLoft([
    { y: 0.16, hw: 0.76, hd: 0.88, r: 0.2 },
    { y: 0.25, hw: 0.8, hd: 0.93, r: 0.22 },
    { y: 3.05, hw: 0.98, hd: 1.13, r: 0.26 },
    { y: 3.09, hw: 1.03, hd: 1.17, r: 0.28 },
    { y: 3.25, hw: 1.03, hd: 1.17, r: 0.28 },
  ], 4);
  body.translate(cx, 0, 0);
  plastic.push({ geometry: body, color: BODY });
  // Moulded ribs down each side, which is what makes a cart read as a cart and not a box.
  for (const s of [-1, 1]) {
    for (const z of [-0.45, 0.45]) {
      plastic.push({ geometry: bar([cx + s * 0.8, 0.5, z], [cx + s * 0.97, 2.95, z * 1.14], 0.1, 0.1, [0, 0, 1]), color: tone(BODY, 0.92) });
    }
  }
  // The lid, overhanging the front so a hand can lift it, with a grip lip.
  const lid = roundedLoft([
    { y: 3.25, hw: 1.06, hd: 1.2, r: 0.3, cz: 0.04 },
    { y: 3.36, hw: 1.06, hd: 1.2, r: 0.3, cz: 0.04 },
    { y: 3.42, hw: 1.0, hd: 1.14, r: 0.26, cz: 0.04 },
  ], 4);
  lid.translate(cx, 0, 0);
  plastic.push({ geometry: lid, color: BODY });
  plastic.push({ geometry: boxAt(0.9, 0.12, 0.12, cx, 3.22, 1.22), color: tone(BODY, 0.9) });
  // Hinge knuckles and the handle bar at the back.
  plastic.push({ geometry: rod([cx - 0.85, 3.27, -1.2], [cx + 0.85, 3.27, -1.2], 0.08, 10), color: tone(BODY, 0.85) });
  for (const x of [-0.7, 0.7]) plastic.push({ geometry: boxAt(0.14, 0.32, 0.36, cx + x, 3.0, -1.27), color: tone(BODY, 0.95) });
  plastic.push({ geometry: rod([cx - 0.82, 3.02, -1.44], [cx + 0.82, 3.02, -1.44], 0.07, 10), color: tone(BODY, 0.8) });
  for (const x of [-0.82, 0.82]) plastic.push({ geometry: ball([cx + x, 3.02, -1.44], 0.071, 10, 6), color: tone(BODY, 0.8) });
  // Wheels at the back, the axle through a moulded pocket; a front foot holds it level.
  const WR = 0.45;
  const wz = -0.98; const wy = WR - 0.02;
  plastic.push({ geometry: rod([cx - 0.98, wy, wz], [cx + 0.98, wy, wz], 0.06, 8), color: PALETTE.steel });
  plastic.push({ geometry: boxAt(1.6, 0.55, 0.42, cx, 0.5, -0.86), color: tone(BODY, 0.88) });
  for (const s of [-1, 1]) {
    const tyre = new THREE.CylinderGeometry(WR, WR, 0.22, 22, 1);
    tyre.rotateZ(Math.PI / 2); tyre.translate(cx + s * 0.93, wy, wz);
    plastic.push({ geometry: tyre, color: PALETTE.tyre });
    const hub = new THREE.CylinderGeometry(0.25, 0.25, 0.24, 14, 1);
    hub.rotateZ(Math.PI / 2); hub.translate(cx + s * 0.93, wy, wz);
    plastic.push({ geometry: hub, color: tone(BODY, 0.75) });
  }
  plastic.push({ geometry: boxAt(1.3, 0.2, 0.25, cx, 0.09, 0.74), color: tone(BODY, 0.85) });

  // Front sticker, leaning with the tapered front face, a hair proud of it.
  const W = 768; const H = 512;
  const tilt = Math.atan2(1.13 - 0.93, 2.8);
  const fy = 2.05;
  const front = uvInto(new THREE.BoxGeometry(1.32, 1.32, 0.02), rect(i * 256, 0, 256, 256, W, H));
  front.rotateX(tilt);
  front.translate(cx, fy, hdAt(fy) + 0.012);
  decals.push({ geometry: front });
  // Lid symbol, its top toward the hinge so it reads from the front.
  // Only its face carries the symbol; the edges sample a clear corner of the cell, or the symbol's
  // own pixels smeared along them draw a white line across the lid.
  const top = new THREE.BoxGeometry(1.25, 1.25, 0.012);
  const faceR = rect(i * 256, 256, 256, 256, W, H); const clearR = rect(i * 256 + 2, 258, 4, 4, W, H);
  const TU = top.attributes.uv;
  for (let v = 0; v < TU.count; v++) {
    const r = Math.floor(v / 4) === 4 ? faceR : clearR;
    TU.setXY(v, mix(r.u0, r.u1, TU.getX(v)), mix(r.v0, r.v1, TU.getY(v)));
  }
  top.rotateX(-Math.PI / 2);
  top.translate(cx, 3.424, 0.05);
  decals.push({ geometry: top });
}

function recyclingBins() {
  const plastic = []; const decals = [];
  BINS.forEach((b, i) => oneBin(plastic, decals, (i - 1) * 2.4, b, i));
  const group = new THREE.Group();
  group.add(meshOf(plastic, standard({ vertexColors: true, roughness: 0.6, metalness: 0, ...relief('stone', { seed: 9201, repeat: 1, strength: 0.15 }) })));
  const atlas = binAtlas();
  group.add(meshOf(decals.map((d) => ({ ...d, color: 0xffffff })), standard({ vertexColors: true, map: atlas, alphaTest: 0.5, roughness: 0.6, metalness: 0 })));
  return group;
}

// ---------------------------------------------------------------------------------------------
// SOLAR PANEL ARRAY
// ---------------------------------------------------------------------------------------------
// 512 x 512. Top half: one landscape module, 12 x 6 cells. Then aluminium, backsheet and the
// inverter's label.
const SOLAR_W = 512;
const SOLAR_H = 512;
const R_CELLS = rect(0, 0, 512, 256, SOLAR_W, SOLAR_H);
const R_SILVER = rect(8, 268, 112, 104, SOLAR_W, SOLAR_H);
const R_BACK = rect(136, 268, 112, 104, SOLAR_W, SOLAR_H);
const R_GREY = rect(264, 268, 112, 104, SOLAR_W, SOLAR_H);
const R_BLACK = rect(392, 268, 112, 104, SOLAR_W, SOLAR_H);
const R_LABEL = rect(0, 384, 512, 128, SOLAR_W, SOLAR_H);

function solarAtlas() {
  return canvasTexture(SOLAR_W, SOLAR_H, (ctx) => {
    // The module: aluminium frame edge, white backsheet showing between the cells.
    ctx.fillStyle = '#d9dcdf'; ctx.fillRect(0, 0, 512, 256);
    ctx.fillStyle = '#eef0f2'; ctx.fillRect(5, 5, 502, 246);
    const cols = 12; const rows = 6;
    const cw = (502 - 4) / cols; const ch = (246 - 4) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 7 + c * cw + 1; const y = 7 + r * ch + 1; const w = cw - 2.2; const h = ch - 2.2;
        const k = 0.94 + ((r * 7 + c * 13) % 5) * 0.025;
        const grad = ctx.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, `rgb(${Math.round(42 * k)},${Math.round(62 * k)},${Math.round(112 * k)})`);
        grad.addColorStop(1, `rgb(${Math.round(30 * k)},${Math.round(46 * k)},${Math.round(90 * k)})`);
        ctx.fillStyle = grad;
        // Monocrystalline cells have clipped corners, which leave little white diamonds.
        const cc = w * 0.12;
        ctx.beginPath();
        ctx.moveTo(x + cc, y); ctx.lineTo(x + w - cc, y); ctx.lineTo(x + w, y + cc); ctx.lineTo(x + w, y + h - cc);
        ctx.lineTo(x + w - cc, y + h); ctx.lineTo(x + cc, y + h); ctx.lineTo(x, y + h - cc); ctx.lineTo(x, y + cc);
        ctx.closePath(); ctx.fill();
        // Fine fingers, then three busbars.
        ctx.strokeStyle = 'rgba(170,185,210,0.22)'; ctx.lineWidth = 0.6;
        for (let f = 1; f < 9; f++) { ctx.beginPath(); ctx.moveTo(x + 1, y + (h * f) / 9); ctx.lineTo(x + w - 1, y + (h * f) / 9); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(214,220,228,0.85)'; ctx.lineWidth = 1.3;
        for (const t of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.moveTo(x + w * t, y); ctx.lineTo(x + w * t, y + h); ctx.stroke(); }
      }
    }
    // Plain swatches.
    ctx.fillStyle = '#c7cbcf'; ctx.fillRect(0, 256, 128, 128); // anodised aluminium
    ctx.fillStyle = '#e6e6e2'; ctx.fillRect(128, 256, 128, 128); // white backsheet
    ctx.fillStyle = '#b8bbbd'; ctx.fillRect(256, 256, 128, 128); // inverter grey
    ctx.fillStyle = '#2b2d30'; ctx.fillRect(384, 256, 128, 128); // black junction boxes
    // The inverter's label: a warning bolt, the word, and what it does.
    ctx.fillStyle = '#f2f1ec'; ctx.fillRect(0, 384, 512, 128);
    ctx.strokeStyle = '#2a2f36'; ctx.lineWidth = 4; ctx.strokeRect(6, 390, 500, 116);
    ctx.fillStyle = '#f1c21b';
    ctx.beginPath(); ctx.moveTo(62, 404); ctx.lineTo(110, 490); ctx.lineTo(14, 490); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#222'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.moveTo(68, 424); ctx.lineTo(52, 455); ctx.lineTo(64, 455); ctx.lineTo(55, 482); ctx.lineTo(76, 446); ctx.lineTo(64, 446); ctx.lineTo(72, 424);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#20262d'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    fitFont(ctx, 'INVERTER', 370, 54, HEAVY, 'bold');
    ctx.fillText('INVERTER', 128, 428);
    fitFont(ctx, 'DC IN', 120, 34, SANS, 'bold');
    ctx.fillText('DC IN', 128, 482);
    // An arrow drawn as a path, not a character.
    ctx.beginPath(); ctx.moveTo(250, 476); ctx.lineTo(320, 476); ctx.lineTo(320, 466); ctx.lineTo(342, 482); ctx.lineTo(320, 498); ctx.lineTo(320, 488); ctx.lineTo(250, 488); ctx.closePath(); ctx.fill();
    fitFont(ctx, 'AC OUT', 140, 34, SANS, 'bold');
    ctx.fillText('AC OUT', 354, 482);
  });
}

// Remaps a box's six faces: +Y (index 2) to `topR`, -Y to `botR`, the rest to `sideR`.
function boxFaces(g, topR, botR, sideR) {
  const U = g.attributes.uv;
  for (let i = 0; i < U.count; i++) {
    const face = Math.floor(i / 4);
    const r = face === 2 ? topR : face === 3 ? botR : sideR;
    U.setXY(i, mix(r.u0, r.u1, U.getX(i)), mix(r.v0, r.v1, U.getY(i)));
  }
  return g;
}

function solarPanelArray() {
  const modules = []; const steel = []; const concrete = [];
  const TH = THREE.MathUtils.degToRad(27);
  const sT = Math.sin(TH); const cT = Math.cos(TH);
  const L = 6.7; // slope length: two landscape modules
  const H0 = 2.4; // front (low) edge height
  const ROW = 39.4;
  const X0 = -1.0; // the rows sit a foot left so the inverter at the right end keeps the piece centred
  const GALV = 0x9aa0a6;
  const MW = 6.5; const MD = 3.3;
  for (const zc of [6.3, -6.3]) {
    const zf = zc + (L / 2) * cT;
    const P = (x, s, n) => [x, H0 + s * sT + n * cT, zf - s * cT + n * sT];
    const N = [0, cT, sT];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 6; c++) {
        const xc = X0 - ROW / 2 + (ROW / 6) * (c + 0.5);
        const sc = 0.05 + MD * (r + 0.5) + 0.04 * r;
        const parts = [
          boxFaces(new THREE.BoxGeometry(MW - 0.04, 0.12, MD - 0.04), R_CELLS, R_BACK, R_SILVER),
          boxFaces(boxAt(MW, 0.16, 0.09, 0, 0.02, MD / 2 - 0.045), R_SILVER, R_SILVER, R_SILVER),
          boxFaces(boxAt(MW, 0.16, 0.09, 0, 0.02, -MD / 2 + 0.045), R_SILVER, R_SILVER, R_SILVER),
          boxFaces(boxAt(0.09, 0.16, MD - 0.18, MW / 2 - 0.045, 0.02, 0), R_SILVER, R_SILVER, R_SILVER),
          boxFaces(boxAt(0.09, 0.16, MD - 0.18, -MW / 2 + 0.045, 0.02, 0), R_SILVER, R_SILVER, R_SILVER),
        ];
        // A junction box on the back of each module.
        parts.push(boxFaces(boxAt(0.6, 0.12, 0.4, 0.8, -0.1, -0.6), R_BLACK, R_BLACK, R_BLACK));
        const at = P(xc, sc, 0.06);
        for (const g of parts) {
          g.rotateX(TH);
          g.translate(at[0], at[1], at[2]);
          modules.push({ geometry: g });
        }
      }
    }
    // Two purlins under the modules, along the whole row.
    for (const s of [1.45, 5.25]) {
      steel.push({ geometry: bar(P(X0 - ROW / 2 + 0.15, s, -0.14), P(X0 + ROW / 2 - 0.15, s, -0.14), 0.3, 0.26, N), color: GALV });
    }
    // Seven supports: a sloped rafter on a short front post and a tall back post, braced.
    for (let k = 0; k < 7; k++) {
      const x = X0 - ROW / 2 + 1.2 + (k * (ROW - 2.4)) / 6;
      steel.push({ geometry: bar(P(x, 0.35, -0.43), P(x, L - 0.35, -0.43), 0.26, 0.32, N), color: tone(GALV, 0.95) });
      const fTop = P(x, 1.0, -0.59); const bTop = P(x, 5.6, -0.59);
      for (const t of [fTop, bTop]) {
        steel.push({ geometry: bar([x, BASE, t[2]], [x, t[1] + 0.05, t[2]], 0.34, 0.24, [0, 0, 1]), color: GALV });
        concrete.push({ geometry: cylY(0.55, 0.5, BASE, 0.25, x, t[2], 14), color: PALETTE.concrete });
        steel.push({ geometry: boxAt(0.7, 0.05, 0.7, x, 0.27, t[2]), color: tone(GALV, 0.85) });
      }
      steel.push({ geometry: bar([x + 0.2, 0.9, bTop[2]], P(x + 0.2, 3.2, -0.6), 0.14, 0.14, [1, 0, 0]), color: tone(GALV, 0.9) });
    }
  }

  // The inverter on its own post at the right end, between the rows, facing +Z.
  const ix = X0 + ROW / 2 + 1.6; const iz = 0.4; const iy = 4.1;
  steel.push({ geometry: bar([ix, BASE, iz - 0.62], [ix, 5.8, iz - 0.62], 0.34, 0.3, [0, 0, 1]), color: GALV });
  concrete.push({ geometry: cylY(0.6, 0.55, BASE, 0.25, ix, iz - 0.62, 14), color: PALETTE.concrete });
  steel.push({ geometry: boxAt(1.6, 0.25, 0.5, ix, iy + 1.3, iz - 0.42), color: GALV });
  steel.push({ geometry: boxAt(1.6, 0.25, 0.5, ix, iy - 1.3, iz - 0.42), color: GALV });
  modules.push({ geometry: boxFaces(boxAt(1.9, 2.5, 0.85, ix, iy, iz), R_GREY, R_GREY, R_GREY) });
  // Its cooling fins and a rain hood.
  for (let k = 0; k < 7; k++) modules.push({ geometry: boxFaces(boxAt(0.05, 1.8, 0.2, ix + 0.98, iy - 0.1, iz - 0.25 + k * 0.1), R_GREY, R_GREY, R_GREY) });
  modules.push({ geometry: boxFaces(boxAt(2.1, 0.1, 1.05, ix, iy + 1.3, iz + 0.08), R_SILVER, R_SILVER, R_SILVER) });
  const label = uvInto(new THREE.BoxGeometry(1.6, 0.4, 0.02), R_LABEL);
  label.translate(ix, iy + 0.55, iz + 0.435);
  modules.push({ geometry: label });
  // A status lamp and the AC disconnect handle.
  modules.push({ geometry: boxFaces(boxAt(0.22, 0.5, 0.12, ix + 0.6, iy - 0.45, iz + 0.47), R_SILVER, R_SILVER, R_SILVER) });
  // Conduits: DC in from each row along a low run, AC out down into the ground.
  const CON = 0x8f9499;
  const cr = 0.09;
  const frontPost = 6.3 + (L / 2) * cT - 1.0 * cT - 0.59 * sT; // z of the front row's front posts
  const backPostZ = -6.3 + (L / 2) * cT - 5.6 * cT - 0.59 * sT;
  const lastX = X0 - ROW / 2 + 1.2 + (ROW - 2.4) + 0.22;
  rodPath(steel, [[ix - 0.6, iy - 1.25, iz], [ix - 0.6, 0.1, iz], [ix - 0.6, 0.1, frontPost], [lastX, 0.1, frontPost], [lastX, 2.2, frontPost]], cr, CON);
  rodPath(steel, [[ix - 0.3, iy - 1.25, iz], [ix - 0.3, 0.1, iz], [ix - 0.3, 0.1, backPostZ], [lastX, 0.1, backPostZ], [lastX, 4.25, backPostZ]], cr, CON);
  rodPath(steel, [[ix + 0.4, iy - 1.25, iz], [ix + 0.4, BASE, iz]], cr * 1.2, 0x5e6266);
  const group = new THREE.Group();
  group.add(meshOf(modules.map((p) => ({ ...p, color: 0xffffff })), standard({ vertexColors: true, map: solarAtlas(), roughness: 0.32, metalness: 0.15 })));
  group.add(meshOf(steel, standard({ vertexColors: true, roughness: 0.5, metalness: 0.35, ...relief('metal', { seed: 9301, repeat: 2 }) })));
  group.add(meshOf(concrete, standard({ vertexColors: true, roughness: 0.95, metalness: 0 })));
  return group;
}

// ---------------------------------------------------------------------------------------------
// WATER TOWER
// ---------------------------------------------------------------------------------------------
const TANK_R = 18;
const TANK_EQ = 88; // the bottom bowl meets the cylinder here, where the legs and balcony are
const TANK_TOP = 100;

function townNameTexture(text) {
  const t = canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const px = fitFont(ctx, text, w * 0.86, Math.floor(h * 0.86), HEAVY, 'bold');
    ctx.fillText(text, w / 2, h / 2 + px * 0.04);
  });
  t.anisotropy = 8;
  return t;
}

// A band of the tank's own cylinder, a hair proud of it, carrying the lettering. u runs left to
// right as seen from the front, so the words read without mirroring.
function nameBand(r, y0, y1, span, cols = 56) {
  const pos = []; const uv = []; const index = [];
  for (let i = 0; i <= cols; i++) {
    const a = -span / 2 + (i / cols) * span;
    for (const [j, y] of [[0, y0], [1, y1]]) {
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(i / cols, j);
    }
  }
  for (let i = 0; i < cols; i++) {
    const a = i * 2; const b = (i + 1) * 2; const c = b + 1; const d = a + 1;
    index.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function waterTower() {
  const paint = []; const concrete = [];
  const PAINT = 0x9fc0d6;
  const LEG = 0x93b4ca;
  const DARK = 0x6f8797;

  // The tank: an elliptical bowl, a cylinder, an eave lip and a conical roof, one lathe.
  const prof = [[0, TANK_EQ - 10]];
  for (let k = 1; k <= 9; k++) {
    const phi = -Math.PI / 2 + (k / 9) * (Math.PI / 2);
    prof.push([TANK_R * Math.cos(phi), TANK_EQ + 10 * Math.sin(phi)]);
  }
  prof.push([TANK_R, TANK_TOP], [TANK_R + 0.35, TANK_TOP + 0.05], [TANK_R + 0.35, TANK_TOP + 0.45], [TANK_R - 0.1, TANK_TOP + 0.6]);
  prof.push([9, TANK_TOP + 5.4], [1.4, TANK_TOP + 9.6], [1.4, TANK_TOP + 11.0], [1.9, TANK_TOP + 11.2], [1.9, TANK_TOP + 11.6], [0, TANK_TOP + 12.0]);
  paint.push({ geometry: lathe(prof, 64), color: PAINT });
  // The roof's finial: rod and ball, then a lightning spike.
  paint.push({ geometry: cylY(0.18, 0.15, TANK_TOP + 11.9, TANK_TOP + 17.2, 0, 0, 10), color: DARK });
  paint.push({ geometry: ball([0, TANK_TOP + 17.8, 0], 0.85, 16, 10), color: PAINT });
  paint.push({ geometry: cylY(0.06, 0.02, TANK_TOP + 18.4, 120.0, 0, 0, 8), color: 0x7a7d80 });

  // Four legs, battered out to 24ft at the ground, meeting the shell at the balcony and running
  // up its side as column tops. Each stands in a concrete pier.
  const legAz = [0, 1, 2, 3].map((i) => Math.PI / 4 + (i * Math.PI) / 2);
  const LR = 0.95;
  const rAt = (y) => mix(24, TANK_R + LR, (y - BASE) / (TANK_EQ - BASE));
  const legP = (i, y, rOff = 0) => { const r = rAt(y) + rOff; return [Math.sin(legAz[i]) * r, y, Math.cos(legAz[i]) * r]; };
  for (let i = 0; i < 4; i++) {
    const knee = legP(i, TANK_EQ);
    paint.push({ geometry: rod(legP(i, 1.4), knee, LR, 14), color: LEG });
    // A short column top welded to the shell, stopping below the lettering.
    paint.push({ geometry: rod(knee, [knee[0], TANK_EQ + 1.6, knee[2]], LR, 14), color: LEG });
    paint.push({ geometry: ball([knee[0], TANK_EQ + 1.6, knee[2]], LR, 14, 7), color: LEG });
    paint.push({ geometry: ball(knee, LR * 1.01, 14, 7), color: LEG });
    const base = legP(i, 0);
    concrete.push({ geometry: cylY(2.3, 2.0, BASE, 1.5, base[0], base[2], 18), color: PALETTE.concrete });
    paint.push({ geometry: boxAt(2.4, 0.2, 2.4, base[0], 1.55, base[2]).rotateY(0), color: DARK });
    paint.push({ geometry: cylY(LR * 1.35, LR * 1.1, 1.45, 2.4, legP(i, 1.6)[0], legP(i, 1.6)[2], 14), color: DARK });
  }
  // Riser pipe up the middle into the bowl's low point, on its own pier.
  paint.push({ geometry: cylY(2.6, 2.6, 1.2, TANK_EQ - 9.0, 0, 0, 20), color: LEG });
  paint.push({ geometry: cylY(3.0, 3.0, 1.0, 2.6, 0, 0, 20), color: DARK });
  paint.push({ geometry: lathe([[0, TANK_EQ - 12], [3.4, TANK_EQ - 12], [2.6, TANK_EQ - 9.5], [0, TANK_EQ - 9]], 20), color: LEG });
  concrete.push({ geometry: cylY(3.8, 3.6, BASE, 1.2, 0, 0, 20), color: PALETTE.concrete });
  // A valve-vault hatch on the riser at ground level.
  paint.push({ geometry: boxAt(1.8, 3.0, 0.5, 0, 4.2, 2.65), color: DARK });

  // Bracing: struts between the legs at three tiers, and X rods in every bay of every face.
  const tiers = [3.0, 24, 46, 68, TANK_EQ - 1.5];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    for (const y of tiers.slice(1, 4)) {
      paint.push({ geometry: rod(legP(i, y), legP(j, y), 0.42, 10), color: LEG });
    }
    for (let t = 0; t < tiers.length - 1; t++) {
      const y0 = tiers[t] + 0.8; const y1 = tiers[t + 1] - 0.8;
      paint.push({ geometry: rod(legP(i, y0, -0.2), legP(j, y1, -0.2), 0.13, 6), color: DARK });
      paint.push({ geometry: rod(legP(j, y0, -0.2), legP(i, y1, -0.2), 0.13, 6), color: DARK });
    }
  }

  // The balcony round the shell at the equator: deck, toe plate, posts and two rails.
  const DR = 22.2;
  paint.push({ geometry: outward(new THREE.LatheGeometry([new THREE.Vector2(TANK_R - 0.2, TANK_EQ - 0.35), new THREE.Vector2(DR, TANK_EQ - 0.35), new THREE.Vector2(DR, TANK_EQ + 0.5), new THREE.Vector2(DR - 0.12, TANK_EQ + 0.5), new THREE.Vector2(DR - 0.12, TANK_EQ), new THREE.Vector2(TANK_R - 0.2, TANK_EQ), new THREE.Vector2(TANK_R - 0.2, TANK_EQ - 0.35)], 72)), color: tone(LEG, 0.92) });
  const RAIL_R = DR - 0.25;
  for (const y of [TANK_EQ + 1.9, TANK_EQ + 3.6]) {
    const ring = new THREE.TorusGeometry(RAIL_R, 0.09, 5, 72);
    ring.rotateX(Math.PI / 2); ring.translate(0, y, 0);
    paint.push({ geometry: ring, color: LEG });
  }
  const posts = 32;
  for (let k = 0; k < posts; k++) {
    const a = (k / posts) * Math.PI * 2 + Math.PI / posts;
    paint.push({ geometry: cylY(0.08, 0.08, TANK_EQ, TANK_EQ + 3.65, Math.sin(a) * RAIL_R, Math.cos(a) * RAIL_R, 5), color: LEG });
  }
  // Brackets under the deck, from the shell out to the rim.
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const c = Math.sin(a); const s = Math.cos(a);
    paint.push({ geometry: rod([c * (TANK_R - 0.6), TANK_EQ - 2.8, s * (TANK_R - 0.6)], [c * (DR - 0.3), TANK_EQ - 0.4, s * (DR - 0.3)], 0.1, 6), color: DARK });
  }

  // The caged ladder up the front-right leg, from 1ft to the balcony, and on up the shell and roof.
  const li = 0;
  const az = legAz[li];
  const radial = [Math.sin(az), 0, Math.cos(az)];
  const tang = [Math.cos(az), 0, -Math.sin(az)];
  const lad = (y, off, side) => {
    const p = legP(li, y, off);
    return [p[0] + tang[0] * side, p[1], p[2] + tang[2] * side];
  };
  const LOFF = 1.7; // out from the leg's centre line
  const LW = 0.8;
  const ly0 = 1.0; const ly1 = TANK_EQ + 3.6;
  for (const s of [-LW, LW]) paint.push({ geometry: bar(lad(ly0, LOFF, s), lad(ly1, LOFF, s), 0.12, 0.3, radial), color: DARK });
  for (let y = ly0 + 0.9; y < TANK_EQ - 0.2; y += 1.0) paint.push({ geometry: rod(lad(y, LOFF, -LW), lad(y, LOFF, LW), 0.05, 4), color: DARK });
  for (let y = 6; y < TANK_EQ; y += 10) paint.push({ geometry: rod(legP(li, y, LR * 0.6), lad(y, LOFF, 0), 0.08, 5), color: DARK });
  // The safety cage: hoops every 4ft from 9ft up, and three straps tying them together.
  const CAGE = 1.3;
  const cageC = (y) => lad(y, LOFF + 0.45, 0);
  for (let y = 9; y < TANK_EQ - 1; y += 4) {
    const c = cageC(y);
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * Math.PI;
      const rr = CAGE * Math.cos(a); const tt = CAGE * Math.sin(a);
      pts.push([c[0] + radial[0] * rr + tang[0] * tt, y, c[2] + radial[2] * rr + tang[2] * tt]);
    }
    pts[0] = lad(y, LOFF, -LW); pts[10] = lad(y, LOFF, LW);
    paint.push({ geometry: tube(pts, 0.05, { sides: 4, steps: 8, round: 0 }), color: DARK });
  }
  for (const k of [-0.75, 0, 0.75]) {
    const off = (y) => { const c = cageC(y); const a = k * (Math.PI / 2); return [c[0] + radial[0] * CAGE * Math.cos(a) + tang[0] * CAGE * Math.sin(a), y, c[2] + radial[2] * CAGE * Math.cos(a) + tang[2] * CAGE * Math.sin(a)]; };
    paint.push({ geometry: bar(off(9), off(TANK_EQ - 3), 0.05, 0.16, radial), color: DARK });
  }
  // Roof ladder: on the +X side, where the lettering leaves the shell bare, up from the balcony,
  // over the eave and along the cone to the vent, standing a few inches off the roof on clips.
  const rad2 = [1, 0, 0]; const tan2 = [0, 0, -1];
  const rl = (r, y, side) => [rad2[0] * r + tan2[0] * side, y, rad2[2] * r + tan2[2] * side];
  const roofY = (r) => (r >= 9 ? mix(TANK_TOP + 0.6, TANK_TOP + 5.4, (TANK_R - 0.1 - r) / (TANK_R - 0.1 - 9)) : mix(TANK_TOP + 5.4, TANK_TOP + 9.6, (9 - r) / (9 - 1.4)));
  const LIFT = 0.32;
  const roofPts = [[TANK_R + 0.45, TANK_EQ + 0.5], [TANK_R + 0.45, TANK_TOP + 0.95], [TANK_R - 1.2, roofY(TANK_R - 1.2) + LIFT], [9, roofY(9) + LIFT], [3.4, roofY(3.4) + LIFT]];
  for (const s2 of [-0.7, 0.7]) {
    rodPath(paint, roofPts.map(([r, y]) => rl(r, y, s2)), 0.08, DARK, 6);
    for (const r of [15.5, 11, 6]) paint.push({ geometry: rod(rl(r, roofY(r) - 0.2, s2), rl(r, roofY(r) + LIFT, s2), 0.06, 5), color: DARK });
    for (const y of [TANK_EQ + 4, TANK_TOP - 1.5]) paint.push({ geometry: rod(rl(TANK_R - 0.1, y, s2), rl(TANK_R + 0.45, y, s2), 0.06, 5), color: DARK });
  }
  for (let y = TANK_EQ + 1.3; y < TANK_TOP; y += 1) paint.push({ geometry: rod(rl(TANK_R + 0.45, y, -0.7), rl(TANK_R + 0.45, y, 0.7), 0.045, 4), color: DARK });
  for (let r = TANK_R - 2.2; r > 3.6; r -= 1.1) {
    const y = roofY(r) + LIFT;
    paint.push({ geometry: rod(rl(r, y, -0.7), rl(r, y, 0.7), 0.045, 4), color: DARK });
  }
  // A roof hatch beside the ladder's top, sitting into the cone.
  paint.push({ geometry: boxAt(2.0, 0.9, 2.0, 0, 0, 0).translate(4.6, roofY(4.6) + 0.2, 2.0), color: DARK });

  // OUR TOWN, painted on the front and the back of the shell.
  const name = townNameTexture('OUR TOWN');
  const front = nameBand(TANK_R + 0.05, TANK_EQ + 3.9, TANK_EQ + 11.5, THREE.MathUtils.degToRad(150));
  const back = front.clone().rotateY(Math.PI);

  const group = new THREE.Group();
  group.add(meshOf(paint, standard({ vertexColors: true, roughness: 0.52, metalness: 0.2 })));
  group.add(meshOf(concrete, standard({ vertexColors: true, roughness: 0.95, metalness: 0 })));
  const letters = new THREE.Mesh(mergeParts([{ geometry: front, color: 0xffffff }, { geometry: back, color: 0xffffff }]), standard({
    color: 0x1f3a63, map: name, alphaTest: 0.5, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  letters.castShadow = false; letters.receiveShadow = true;
  group.add(letters);
  return group;
}

export const BUILDERS = {
  'city-park': cityPark,
  'recycling-bins': recyclingBins,
  'solar-panel-array': solarPanelArray,
  'water-tower': waterTower,
};
