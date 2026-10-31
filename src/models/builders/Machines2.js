import * as THREE from 'three';
import { seededRandom, canvasTexture } from '../../PropKit.js';
import {
  solidLoft, solidSurface, extrudeOutline, revolve, gearOutline, mergeParts, placed, outlineArea, splineAt,
} from '../../props/LoftKit.js';
import {
  tube, lin, clamp01, mix, sstep, outward, alongMatrix, grainBump, tintVertices,
} from '../ModelKit.js';

// The Model Database's second batch of machines: five objects of the age of invention, all mostly
// thin members, and all read from six feet.
//
//   model-t-ford         a 1915 touring car, life size, nose at +Z.
//   penny-farthing       a high-wheel bicycle, life size, front wheel at +Z.
//   montgolfier-balloon  the balloon of 21 November 1783 at TRUE size; the catalogue shows it at 0.25.
//   edison-phonograph    a cylinder phonograph three times life size, front at +Z.
//   watt-steam-engine    a rotative beam engine, with its motion solved from one crank angle.
//
// Feet at scale 1, origin at the base centre, fresh materials per build, seededRandom only.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// A surface of revolution about +Y from `[r, y]` or `[r, y, 'h']` points, either a closed loop or a
// run from axis to axis. The direction is measured rather than remembered, because `revolve` takes
// its winding from it. A point flagged 'h' is doubled, which keeps that edge a hard arris.
function spin(points, { segments = 24, closed = false } = {}) {
  const flat = points.map((p) => [p[0], p[1]]);
  const pts = outlineArea(flat) > 0 ? [...points].reverse() : points;
  const list = closed ? [...pts, pts[0]] : pts;
  const out = [];
  for (const p of list) {
    out.push([p[0], p[1]]);
    if (p[2]) out.push([p[0], p[1]]);
  }
  return dropDegenerate(revolve(out, { segments }));
}

function dropDegenerate(g) {
  const pos = g.attributes.position;
  const old = g.index.array;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < old.length; i += 3) {
    a.fromBufferAttribute(pos, old[i]);
    b.fromBufferAttribute(pos, old[i + 1]);
    c.fromBufferAttribute(pos, old[i + 2]);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(old[i], old[i + 1], old[i + 2]);
  }
  g.setIndex(keep);
  return g;
}

const onZ = (g) => g.rotateX(Math.PI / 2); // a lathe's +Y becomes +Z
const onX = (g, s = 1) => g.rotateZ(-s * Math.PI / 2); // a lathe's +Y becomes s * +X

// A closed ring of round section about +Y.
function ringGeo(R, r, { segments = 48, sides = 10, y = 0, flat = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push([R + Math.cos(a) * r, y + Math.sin(a) * r * flat]);
  }
  return spin(pts, { segments, closed: true });
}

// Geometry authored along +Y, centred on the origin, carried to lie from a to b.
function alongY(geometry, a, b) {
  const A = vec(a);
  const B = vec(b);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  return geometry.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

// A round bar with flat capped ends.
function rod(list, color, a, b, r, { sides = 10, r2 = null } = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  list.push({ geometry: alongY(new THREE.CylinderGeometry(r2 ?? r, r, len, sides), a, b), color });
}

// A round bar on a smooth path, closed at both ends by construction.
function pipe(list, color, points, r, { sides = 8, steps = null, round = 2, section = null, frame = null } = {}) {
  list.push({ geometry: tube(points, r, { sides, steps: steps ?? (points.length - 1) * 5, round, section, frame }), color });
}

function block(list, color, w, h, d, pos, rot = null) {
  list.push({ geometry: new THREE.BoxGeometry(w, h, d), color, position: pos, rotation: rot });
}

function dot(list, color, r, pos, { sides = 8, flat = null, up = null } = {}) {
  const g = new THREE.SphereGeometry(r, sides, Math.max(3, sides >> 1));
  if (flat) g.scale(1, flat, 1);
  if (up) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(up).normalize()));
  list.push({ geometry: g, color, position: pos });
}

// Every shared vertex apart, so each face keeps its own normal: a sawn or cast plate has arrises.
function crisp(g) {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

// A squared bar from a to b, `w` across and `h` along `up`. Its UVs run in tile units with the
// grain along the length, so one tall canvas serves every timber in a model.
function beamGeo(len, w, h, { chamfer = 0, tile = [1, 2], rng = null } = {}) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const outline = c > 0
    ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
    : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const u0 = rng ? rng() : 0;
  const v0 = rng ? rng() : 0;
  const pos = [];
  const nor = [];
  const uvs = [];
  const tri = (a, b, cc, n, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
  };
  const z0 = -len / 2;
  const z1 = len / 2;
  let run = u0 * tile[0];
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = [(by - ay) / seg, -(bx - ax) / seg, 0];
    const ua = run / tile[0];
    const ub = (run + seg) / tile[0];
    const va = v0 + z0 / tile[1];
    const vb = v0 + z1 / tile[1];
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1], n, [ua, va], [ub, va], [ub, vb]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1], n, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  for (let i = 1; i < outline.length - 1; i++) {
    const [ax, ay] = outline[0];
    const [bx, by] = outline[i];
    const [cx, cy] = outline[i + 1];
    const uv = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
    tri([ax, ay, z1], [bx, by, z1], [cx, cy, z1], [0, 0, 1], uv(ax, ay), uv(bx, by), uv(cx, cy));
    tri([ax, ay, z0], [cx, cy, z0], [bx, by, z0], [0, 0, -1], uv(ax, ay), uv(cx, cy), uv(bx, by));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

function fromTo(geometry, a, b, up = null) {
  const A = vec(a);
  const B = vec(b);
  const z = B.clone().sub(A).normalize();
  let ref = up ? vec(up).normalize() : Y_AXIS.clone();
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return geometry.applyMatrix4(m);
}

function bar(list, color, a, b, w, h, opts = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  list.push({ geometry: fromTo(beamGeo(len, w, h, opts), a, b, opts.up), color });
}

// A plate drawn in x,y and extruded along z, centred at z, with hard edges.
function plate(list, color, outline, depth, z = 0) {
  const g = crisp(extrudeOutline(outline, depth));
  g.translate(0, 0, z);
  list.push({ geometry: g, color });
}

// Lathes and lofts lay u round and v along, or the other way about: a grain map's streaks run in v.
function swapUV(g, ku = 1, kv = 1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setXY(i, uv.getY(i) * ku, u * kv);
  }
  return g;
}

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour,
// so one canvas serves every wood in a model.
function grainMaps({ seed = 3, knots = 3, strength = 0.5, width = 256, height = 512, streaks = 150 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(0, 0, width, height);
  const wrapX = (draw) => { for (const dx of [-width, 0, width]) draw(dx); };
  for (let i = 0; i < 26; i++) {
    const x = rng() * width;
    const w = 6 + rng() * 34;
    const shade = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${shade},${shade - 8},${shade - 18},0.42)`;
    wrapX((dx) => ctx.fillRect(x + dx, 0, w, height));
  }
  for (let i = 0; i < streaks; i++) {
    const x = rng() * width;
    const amp = 1 + rng() * 5;
    const cycles = 1 + Math.floor(rng() * 3);
    const phase = rng() * Math.PI * 2;
    const dark = 150 + Math.round(rng() * 70);
    ctx.strokeStyle = `rgba(${dark},${dark - 14},${dark - 30},${0.25 + rng() * 0.5})`;
    ctx.lineWidth = 0.6 + rng() * 1.5;
    wrapX((dx) => {
      ctx.beginPath();
      for (let y = 0; y <= height; y += 16) {
        const px = x + dx + Math.sin((y / height) * Math.PI * 2 * cycles + phase) * amp;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    });
  }
  for (let i = 0; i < knots; i++) {
    const x = 40 + rng() * (width - 80);
    const y = 50 + rng() * (height - 100);
    for (let r = 10; r > 2; r -= 2.4) {
      const dark = 165 + (13 - r) * -2;
      ctx.strokeStyle = `rgba(${dark},${dark - 22},${dark - 44},0.32)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.62, r * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: strength };
}

// Polish without an environment map: metalness above about 0.55 renders black here, so what the sky
// would have reflected goes into the vertex colours instead. `add` is the sky seen in a glossy
// black surface, `gain` lifts what already has colour (brass) on its upward faces.
function sheen(geometry, { add = 0, tint = [0.86, 0.93, 1], gain = 0, band = 0, bandY = 3, bandW = 0.4 } = {}) {
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const C = geometry.attributes.color;
  for (let i = 0; i < P.count; i++) {
    const ny = N.getY(i);
    const sky = 0.5 + 0.5 * ny;
    const s = sky * sky * sky;
    let lift = s * add;
    if (band) {
      const d = (P.getY(i) - bandY) / bandW;
      lift += Math.exp(-d * d) * (1 - Math.abs(ny)) * band;
    }
    const k = 1 + gain * (s - 0.3);
    C.setXYZ(i, C.getX(i) * k + lift * tint[0], C.getY(i) * k + lift * tint[1], C.getZ(i) * k + lift * tint[2]);
  }
  return geometry;
}

function meshFrom(geometry, params, { shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function groupOf(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// Ford Model T: a 1915 touring car, life size
// ---------------------------------------------------------------------------
//
// 100in wheelbase and 56in track, 30in wheels, about 134in long and 7ft to the top of the hood.
// Left-hand drive, and +X is the car's left because it travels along +Z, so the steering wheel and
// the catalogue's picture are on the same side.
//
// BLACK IS THE ONE COLOUR THAT CANNOT BE LEFT ALONE. A black solid under a hemisphere renders as a
// hole in the picture, so the paint mesh carries a faked sky and a faked horizon line in its vertex
// colours (`sheen`), which is what makes it read as a gloss rather than as a silhouette.

const FORD = {
  black: 0x0b0c0e,
  iron: 0x121315,
  brass: 0xd2a23c,
  brassPale: 0xe8c86a,
  wood: 0x94693a,
  woodDark: 0x6e4220,
  tyre: 0x8f897c,
  rubber: 0x141414,
  leather: 0x2c1d16,
  fabric: 0x35332f,
  strap: 0x6b4a2a,
  lens: 0xd9d4ae,
  core: 0x17120c,
  exhaust: 0x3d3833,
  glass: 0xbcd4dc,
};

const T_WR = 1.25; // tyre outer radius: 30in over the tyre
const T_WX = 2.33; // half the track
const T_FZ = 4.45; // front axle
const T_RZ = T_FZ - 8.33; // rear axle: a 100in wheelbase

// Local +Y is the wheel's outer face, carried out by one rotation per side. Ten spokes in front and
// twelve behind, which is what the wooden-wheeled T ran.
function tWheel(P, x, z, side, spokes, rear) {
  const M = new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2);
  M.setPosition(x, T_WR, z);
  const add = (list, g, color) => list.push({ geometry: g.applyMatrix4(M), color });
  const tr = rear ? 0.146 : 0.125;
  add(P.matte, ringGeo(T_WR - tr, tr, { segments: 48, sides: 9 }), FORD.tyre);
  // The clincher rim, whose beads hook over the tyre.
  const rimIn = T_WR - tr * 2 + 0.03;
  add(P.paint, spin([
    [rimIn - 0.07, -tr * 0.72, 'h'], [rimIn + 0.012, -tr * 0.72], [rimIn + 0.05, -tr * 0.92], [rimIn + 0.06, -tr * 0.74], [rimIn + 0.02, -tr * 0.5],
    [rimIn + 0.02, tr * 0.5], [rimIn + 0.06, tr * 0.74], [rimIn + 0.05, tr * 0.92], [rimIn + 0.012, tr * 0.72], [rimIn - 0.07, tr * 0.72, 'h'],
  ], { segments: 48, closed: true }), FORD.black);
  // The felloe: the bent wooden ring the spokes are tenoned into.
  const fo = rimIn - 0.05;
  const fi = fo - 0.17;
  add(P.wood, swapUV(spin([
    [fi + 0.02, -0.085], [fo, -0.085, 'h'], [fo, 0.085, 'h'], [fi + 0.02, 0.085], [fi, 0.06], [fi, -0.06],
  ], { segments: 48, closed: true }), 1, 7), FORD.wood);
  // Artillery spokes: broad wedges that butt together at the hub and thin to an oval at the felloe.
  const hubR = 0.3;
  const atHub = (hubR * Math.PI) / spokes;
  const spoke = solidLoft([
    { d: hubR - 0.06, w: atHub * 0.98, h: 0.078, round: 0.55 },
    { d: hubR + 0.04, w: atHub * 0.98, h: 0.078, round: 0.55 },
    { d: hubR + 0.14, w: atHub * 0.7, h: 0.07, round: 0.8 },
    { d: (hubR + fi) * 0.55, w: 0.056, h: 0.058, round: 1 },
    { d: fi - 0.04, w: 0.05, h: 0.056, round: 1 },
    { d: fi + 0.06, w: 0.05, h: 0.056, round: 1 },
  ], { sides: 8, samples: 5 });
  swapUV(spoke, 1, 1.2);
  for (let i = 0; i < spokes; i++) {
    add(P.wood, placed(spoke, { rot: [0, ((i + 0.5) / spokes) * Math.PI * 2, 0] }), FORD.wood);
  }
  // Hub: an iron flange each side of the spokes, six bolts through them, and a brass cap.
  add(P.paint, spin([
    [0, -0.13], [0.3, -0.13, 'h'], [hubR + 0.03, -0.1], [hubR + 0.03, -0.085], [0.2, -0.08], [0.2, 0.08], [hubR + 0.03, 0.085], [hubR + 0.03, 0.105], [0.26, 0.13, 'h'], [0.15, 0.14], [0.14, 0.2], [0, 0.2],
  ], { segments: 20 }), FORD.black);
  add(P.metal, spin([
    [0, 0.17], [0.135, 0.17, 'h'], [0.135, 0.22, 'h'], [0.155, 0.22, 'h'], [0.155, 0.25, 'h'], [0.11, 0.26], [0.1, 0.33], [0.065, 0.38], [0, 0.39],
  ], { segments: 14 }), FORD.brass);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    const g = new THREE.CylinderGeometry(0.024, 0.03, 0.05, 5, 1, true);
    g.translate(Math.sin(a) * 0.235, 0.125, Math.cos(a) * 0.235);
    add(P.metal, g, FORD.brassPale);
  }
  if (rear) {
    add(P.paint, spin([[0, -0.42], [0.4, -0.42, 'h'], [0.42, -0.38], [0.42, -0.13], [0, -0.13]], { segments: 18 }), FORD.iron);
  }
}

// A sheet-iron mudguard over a path in z,y running toward +Z, crowned across its width with rolled
// edges, and with real thickness so it never vanishes edge-on.
function fender(list, path, xc, halfW, { crown = 0.09, roll = 0.09, nu = 28 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'catmullrom', 0.5);
  const g = solidSurface({
    nu,
    nv: 8,
    point: (u, v) => {
      const p = curve.getPoint(u);
      const t = curve.getTangent(u);
      const c = 2 * v - 1;
      const drop = crown * c * c + roll * Math.abs(c) ** 6;
      return [xc + c * halfW, p.y - t.z * drop, p.z + t.y * drop];
    },
    thick: () => 0.016,
  });
  list.push({ geometry: g, color: FORD.black });
}

function modelTFord() {
  const rng = seededRandom(1915);
  const P = { paint: [], metal: [], wood: [], matte: [], fabric: [], glass: [] };
  const woodOpts = { tile: [0.9, 1.8], rng };

  // ----- Wheels ---------------------------------------------------------------------------------
  for (const s of [1, -1]) {
    tWheel(P, s * T_WX, T_FZ, s, 10, false);
    tWheel(P, s * T_WX, T_RZ, s, 12, true);
  }

  // ----- Chassis: the visible half of what made it go anywhere ----------------------------------
  const RAIL = 1.92;
  for (const s of [-1, 1]) {
    bar(P.paint, FORD.black, [s * 1.2, RAIL, 4.32], [s * 1.2, RAIL, -5.0], 0.13, 0.34, { chamfer: 0.015 });
  }
  bar(P.paint, FORD.black, [-1.26, 2.1, 4.35], [1.26, 2.1, 4.35], 0.3, 0.26, { chamfer: 0.03 });
  bar(P.paint, FORD.black, [-1.26, 2.28, T_RZ], [1.26, 2.28, T_RZ], 0.3, 0.24, { chamfer: 0.03 });
  bar(P.paint, FORD.black, [-1.26, RAIL, -5.0], [1.26, RAIL, -5.0], 0.14, 0.3, { chamfer: 0.015 });
  bar(P.paint, FORD.black, [-1.26, RAIL, 0.2], [1.26, RAIL, 0.2], 0.14, 0.24, { chamfer: 0.015 });

  // A transverse semi-elliptic spring, one each end of the car: the famous detail, since nearly every
  // other car of the day ran a pair of fore-and-aft springs. Leaves are flat, stacked and shorter
  // toward the top of the stack's centre.
  const transverseSpring = (z, apex, drop, span, leaves) => {
    for (let i = 0; i < leaves; i++) {
      const s = span * (1 - i * (0.72 / leaves));
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const x = -s + (k / 12) * 2 * s;
        pts.push([x, apex - i * 0.034 - drop * (x / span) ** 2, z]);
      }
      pipe(P.paint, FORD.iron, pts, 0.1, {
        sides: 6, steps: 14, round: 0, section: () => [0.15, 1], frame: () => [0, 1, 0],
      });
    }
  };
  transverseSpring(T_FZ, 2.0, 0.5, 1.72, 6);
  transverseSpring(T_RZ, 2.16, 0.55, 1.86, 7);
  // Spring clamp, spring perches and shackles.
  block(P.paint, FORD.iron, 0.24, 0.1, 0.26, [0, 2.04, T_FZ]);
  block(P.paint, FORD.iron, 0.24, 0.1, 0.26, [0, 2.2, T_RZ]);
  for (const s of [-1, 1]) {
    rod(P.paint, FORD.iron, [s * 1.72, 1.5, T_FZ], [s * 1.68, 1.12, T_FZ], 0.05, { sides: 8 });
    rod(P.paint, FORD.iron, [s * 1.86, 1.61, T_RZ], [s * 1.86, 1.28, T_RZ], 0.05, { sides: 8 });
    dot(P.paint, FORD.iron, 0.06, [s * 1.72, 1.5, T_FZ]);
    dot(P.paint, FORD.iron, 0.06, [s * 1.86, 1.61, T_RZ]);
  }
  // Front axle: a forged beam dropping in the middle, with the kingpins at its ends and the wishbone
  // radius rods running back to a ball under the engine.
  pipe(P.paint, FORD.iron, [[-1.98, 1.27, T_FZ], [-1.6, 1.13, T_FZ], [-0.8, 1.06, T_FZ], [0, 1.05, T_FZ], [0.8, 1.06, T_FZ], [1.6, 1.13, T_FZ], [1.98, 1.27, T_FZ]], 0.075, {
    sides: 8, steps: 24, section: () => [1.15, 0.72], frame: () => [0, 1, 0],
  });
  for (const s of [-1, 1]) {
    rod(P.paint, FORD.iron, [s * 1.98, 1.04, T_FZ], [s * 1.98, 1.5, T_FZ], 0.075, { sides: 10 });
    rod(P.paint, FORD.iron, [s * 1.98, T_WR, T_FZ], [s * (T_WX - 0.1), T_WR, T_FZ], 0.085, { sides: 10 });
    rod(P.paint, FORD.iron, [s * 1.45, 1.14, T_FZ], [0, 1.38, 1.5], 0.042, { sides: 8 });
    // Steering arm back to the tie rod.
    rod(P.paint, FORD.iron, [s * 1.98, 1.12, T_FZ], [s * 1.93, 1.14, T_FZ - 0.5], 0.04, { sides: 8 });
    dot(P.paint, FORD.iron, 0.055, [s * 1.93, 1.14, T_FZ - 0.5]);
    rod(P.paint, FORD.iron, [s * 1.98, T_WR, T_RZ], [s * 2.2, T_WR, T_RZ], 0.1, { sides: 10 });
  }
  rod(P.paint, FORD.iron, [-1.93, 1.14, T_FZ - 0.5], [1.93, 1.14, T_FZ - 0.5], 0.032, { sides: 8 });
  dot(P.paint, FORD.iron, 0.085, [0, 1.38, 1.5]);
  // Drag link from the bottom of the steering column to the left steering arm.
  rod(P.paint, FORD.iron, [1.93, 1.14, T_FZ - 0.5], [1.08, 1.6, 1.85], 0.032, { sides: 8 });
  // Rear axle: tubes, a split banjo round the differential, the torque tube running forward.
  rod(P.paint, FORD.iron, [-2.12, T_WR, T_RZ], [2.12, T_WR, T_RZ], 0.11, { sides: 12 });
  P.paint.push({
    geometry: onX(spin([
      [0, -0.46], [0.16, -0.46], [0.27, -0.38], [0.38, -0.16], [0.42, -0.02, 'h'], [0.46, -0.02, 'h'], [0.46, 0.02, 'h'], [0.42, 0.02, 'h'], [0.38, 0.16], [0.27, 0.38], [0.16, 0.46], [0, 0.46],
    ], { segments: 24 })).translate(0, T_WR, T_RZ),
    color: FORD.iron,
  });
  rod(P.paint, FORD.iron, [0, T_WR, T_RZ + 0.25], [0, 1.68, 0.8], 0.1, { sides: 12 });
  for (const s of [-1, 1]) rod(P.paint, FORD.iron, [s * 1.9, T_WR, T_RZ], [0, 1.5, -1.4], 0.04, { sides: 8 });
  // Crankcase and the bulge of the planetary transmission.
  P.paint.push({
    geometry: solidLoft([
      { d: 0.72, w: 0.3, up: 0.3, dn: 0.3, b: 1.76, round: 1 },
      { d: 0.82, w: 0.62, up: 0.56, dn: 0.56, b: 1.86, round: 1 },
      { d: 1.72, w: 0.64, up: 0.56, dn: 0.54, b: 1.86, round: 1 },
      { d: 2.25, w: 0.46, up: 0.5, dn: 0.34, b: 1.86, round: 0.7 },
      { d: 3.9, w: 0.42, up: 0.5, dn: 0.26, b: 1.88, round: 0.5 },
      { d: 4.25, w: 0.36, up: 0.45, dn: 0.2, b: 1.9, round: 0.5 },
    ], { sides: 18, samples: 18 }),
    color: FORD.iron,
  });
  // Exhaust and muffler on the car's right, and the crank that started it.
  P.matte.push({
    geometry: spin([[0, -1.1], [0.18, -1.1], [0.24, -1.0], [0.24, 1.0], [0.18, 1.1], [0, 1.1]], { segments: 16 }).rotateX(Math.PI / 2).translate(-0.82, 1.4, -1.2),
    color: FORD.exhaust,
  });
  pipe(P.matte, FORD.exhaust, [[-0.5, 2.75, 3.1], [-0.72, 2.2, 2.7], [-0.82, 1.6, 1.8], [-0.82, 1.42, -0.1]], 0.06, { sides: 8, steps: 18 });
  pipe(P.matte, FORD.exhaust, [[-0.82, 1.4, -2.2], [-0.82, 1.36, -3.0]], 0.055, { sides: 8, steps: 2, round: 0 });
  rod(P.paint, FORD.iron, [0, 2.12, 4.2], [0, 2.12, 5.02], 0.038, { sides: 8 });
  rod(P.paint, FORD.iron, [0, 2.12, 5.02], [0, 1.72, 5.05], 0.032, { sides: 8 });
  rod(P.wood, FORD.wood, [-0.02, 1.72, 5.05], [-0.34, 1.72, 5.05], 0.042, { sides: 8 });
  dot(P.paint, FORD.iron, 0.05, [0, 2.12, 5.02]);
  dot(P.paint, FORD.iron, 0.05, [0, 1.72, 5.05]);

  // ----- Running boards and mudguards ----------------------------------------------------------
  const BOARD = 1.62;
  const boardF = T_FZ - 2.1;
  const boardR = T_RZ + 1.82;
  for (const s of [-1, 1]) {
    const xc = s * T_WX;
    fender(P.paint, [
      [boardF - 0.25, BOARD + 0.005], [boardF + 0.2, BOARD + 0.02], [T_FZ - 1.62, 1.86], [T_FZ - 1.3, 2.32], [T_FZ - 0.75, 2.66],
      [T_FZ, 2.82], [T_FZ + 0.72, 2.66], [T_FZ + 1.1, 2.3],
    ], xc, 0.41, { nu: 30 });
    fender(P.paint, [
      [T_RZ - 1.62, 1.72], [T_RZ - 1.42, 2.14], [T_RZ - 0.88, 2.62], [T_RZ, 2.84], [T_RZ + 0.86, 2.62],
      [T_RZ + 1.3, 2.14], [T_RZ + 1.6, BOARD + 0.13], [boardR + 0.25, BOARD + 0.005],
    ], xc, 0.41, { nu: 30 });
    // The board itself, an iron tread with raised bars, on three brackets off the frame.
    bar(P.paint, FORD.black, [xc, BOARD - 0.05, boardF + 0.1], [xc, BOARD - 0.05, boardR - 0.1], 0.9, 0.06, { chamfer: 0.02 });
    for (let i = 0; i < 26; i++) {
      const z = boardR + 0.08 + (i / 25) * (boardF - boardR - 0.16);
      bar(P.paint, FORD.iron, [xc - 0.36, BOARD - 0.012, z], [xc + 0.36, BOARD - 0.012, z], 0.04, 0.018);
    }
    for (const z of [boardF - 0.5, (boardF + boardR) / 2, boardR + 0.5]) {
      bar(P.paint, FORD.iron, [s * 1.26, RAIL - 0.08, z], [s * (T_WX + 0.2), BOARD - 0.09, z], 0.14, 0.05, { up: [0, 0, 1] });
    }
    // Splash aprons: without them there is daylight straight through under the body.
    bar(P.paint, FORD.black, [s * 1.62, BOARD + 0.1, boardF], [s * 1.62, BOARD + 0.1, boardR], 0.92, 0.03, { up: [s * 0.3, 1, 0] });
    bar(P.paint, FORD.black, [s * 1.45, 2.26, T_FZ + 0.1], [s * 1.45, 2.26, boardF + 0.1], 1.02, 0.03, { up: [s * 0.42, 1, 0] });
  }

  // ----- Hood and cowl ------------------------------------------------------------------------
  P.paint.push({
    geometry: solidLoft([
      { d: 2.3, w: 1.1, up: 0.98, dn: 0.82, b: 3.16, roundUp: 0.42, roundDn: 0.16 },
      { d: 3.2, w: 1.0, up: 0.95, dn: 0.82, b: 3.14, roundUp: 0.42, roundDn: 0.16 },
      { d: 4.3, w: 0.96, up: 0.9, dn: 0.8, b: 3.12, roundUp: 0.42, roundDn: 0.16 },
    ], { sides: 44, samples: 16 }),
    color: FORD.black,
  });
  // The curved cowl, flowing out of the hood into the shoulders of the body.
  const cowl = solidLoft([
    { d: 0.55, w: 2.04, up: 1.06, dn: 0.98, b: 3.22, roundUp: 0.34, roundDn: 0.24 },
    { d: 0.95, w: 2.02, up: 1.06, dn: 0.98, b: 3.22, roundUp: 0.36, roundDn: 0.24 },
    { d: 1.5, w: 1.72, up: 1.04, dn: 0.94, b: 3.2, roundUp: 0.42, roundDn: 0.22 },
    { d: 2.1, w: 1.27, up: 1.0, dn: 0.86, b: 3.17, roundUp: 0.44, roundDn: 0.18 },
    { d: 2.5, w: 1.1, up: 0.985, dn: 0.82, b: 3.16, roundUp: 0.42, roundDn: 0.16 },
  ], { sides: 48, samples: 24 });
  P.paint.push({ geometry: cowl, color: FORD.black });
  // Hood hinge down the centre, the side catches, and a moulding where the hood meets the cowl.
  pipe(P.paint, FORD.iron, [[0, 4.12, 2.42], [0, 4.09, 3.2], [0, 4.03, 4.3]], 0.032, { sides: 8, steps: 8 });
  for (const s of [-1, 1]) {
    for (const z of [2.95, 3.9]) {
      const hw = z > 3.4 ? 0.985 : 1.025;
      block(P.metal, FORD.brass, 0.05, 0.3, 0.12, [s * hw, 2.62, z]);
      rod(P.metal, FORD.brassPale, [s * (hw - 0.02), 2.78, z], [s * (hw + 0.05), 2.78, z], 0.03, { sides: 8 });
    }
    // Hood shelf: the sill the hood sits on.
    bar(P.paint, FORD.iron, [s * 1.0, 2.36, 4.32], [s * 1.12, 2.36, 2.2], 0.14, 0.06, { chamfer: 0.015 });
  }

  // ----- The body: an open tub with real walls, since a touring car has no closed sides -------------
  const halfW = (z) => {
    if (z > 0.3) return 1.97;
    const t = clamp01((0.3 - z) / 3.4);
    return 1.97 + 0.29 * sstep(t, 0, 1);
  };
  const REARZ = -5.32;
  const ROUND_FROM = -4.0;
  const plan = [];
  const FRONT = 0.72;
  for (let i = 0; i <= 20; i++) { const z = FRONT + (i / 20) * (ROUND_FROM - FRONT); plan.push([halfW(z), z]); }
  const WR0 = halfW(ROUND_FROM);
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * Math.PI;
    const k = 2.6;
    const cx = Math.cos(a);
    const sx = Math.sin(a);
    plan.push([Math.sign(cx) * Math.abs(cx) ** (2 / k) * WR0, ROUND_FROM - Math.abs(sx) ** (2 / k) * (ROUND_FROM - REARZ)]);
  }
  for (let i = 19; i >= 0; i--) { const z = FRONT + (i / 20) * (ROUND_FROM - FRONT); plan.push([-halfW(z), z]); }
  for (let i = 1; i < 8; i++) plan.push([-halfW(FRONT) + (i / 8) * 2 * halfW(FRONT), FRONT]);
  const nPlan = plan.length;
  const planN = plan.map((p, i) => {
    const a = plan[(i + nPlan - 1) % nPlan];
    const b = plan[(i + 1) % nPlan];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    // The walk runs +X side rearward, round the back, -X side forward, so outward is to its left.
    return [-dz / l, dx / l];
  });
  const SILL = 2.28;
  const beltAt = (z) => mix(3.92, 4.16, sstep(z, -0.6, 0.7)) + 0.05 * sstep(-z, 3.2, 5.0);
  // The wall in section as a closed loop of [offset from the plan line, fraction of the height]: it
  // tucks in below to clear the mudguards, swells at the waist, and rolls over at the top.
  const wall = [
    [-0.4, 0], [-0.34, 0.06], [-0.22, 0.14], [-0.12, 0.22], [-0.05, 0.32], [0.0, 0.42], [0.035, 0.52], [0.05, 0.62], [0.05, 0.72], [0.035, 0.82], [0.01, 0.9], [-0.01, 0.95],
    [-0.04, 0.99], [-0.085, 1.01], [-0.13, 1.0], [-0.16, 0.96], [-0.17, 0.9], [-0.18, 0.5], [-0.3, 0.2], [-0.52, 0.02], [-0.52, -0.02], [-0.42, -0.02],
  ];
  const INNER_FROM = 15;
  const tubPos = [];
  const tubCol = [];
  const tubIdx = [];
  const blackC = lin(FORD.black);
  const trimC = lin(0x3d2a20);
  const tubPoint = (i, o, v) => {
    const [x, z] = plan[i];
    const [nx, nz] = planN[i];
    return [x + nx * o, mix(SILL, beltAt(z), v), z + nz * o];
  };
  for (let i = 0; i < nPlan; i++) {
    for (let j = 0; j < wall.length; j++) {
      const q = tubPoint(i, wall[j][0], wall[j][1]);
      tubPos.push(q[0], q[1], q[2]);
      const c = j >= INNER_FROM ? trimC : blackC;
      tubCol.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i < nPlan; i++) {
    const i2 = (i + 1) % nPlan;
    for (let j = 0; j < wall.length; j++) {
      const j2 = (j + 1) % wall.length;
      const a = i * wall.length + j;
      const b = i * wall.length + j2;
      const c = i2 * wall.length + j2;
      const d = i2 * wall.length + j;
      tubIdx.push(a, b, c, a, c, d);
    }
  }
  const tubG = new THREE.BufferGeometry();
  tubG.setAttribute('position', new THREE.Float32BufferAttribute(tubPos, 3));
  tubG.setAttribute('color', new THREE.Float32BufferAttribute(tubCol, 3));
  tubG.setIndex(tubIdx);
  tubG.computeVertexNormals();
  P.paint.push({ geometry: outward(tubG), keepColor: true });
  // The floor, and the seat risers that hide the frame from inside.
  const floor = (z) => {
    const w = z < ROUND_FROM ? 1.7 : halfW(z) - 0.32;
    return w;
  };
  P.matte.push({
    geometry: new THREE.BoxGeometry(floor(0) * 2 + 0.3, 0.1, 5.9),
    color: 0x1c1a18,
    position: [0, SILL + 0.1, -2.05],
  });

  // Door seams and handles. The +X front door is pressed into the body and does not open: the driver
  // got in from the right, past the levers. That is a real Model T oddity, and a student who looks
  // for its handle will not find one.
  const sideAt = (s, z, v, lift = 0.012) => {
    const off = (t) => {
      // The wall's outer profile, read from the same table the wall was built from.
      for (let j = 0; j < INNER_FROM - 1; j++) {
        const a = wall[j];
        const b = wall[j + 1];
        if (t >= a[1] && t <= b[1]) return mix(a[0], b[0], (t - a[1]) / Math.max(1e-4, b[1] - a[1]));
      }
      return 0;
    };
    return [s * (halfW(z) + off(v) + lift), mix(SILL, beltAt(z), v), z];
  };
  const seam = (s, pts) => pipe(P.paint, 0x020202, pts, 0.014, { sides: 4, steps: 7, round: 0 });
  const doorEdge = (s, z, v0, v1) => {
    const pts = [];
    for (let k = 0; k <= 7; k++) pts.push(sideAt(s, z, mix(v0, v1, k / 7)));
    seam(s, pts);
  };
  const doorSill = (s, z0, z1, v) => {
    const pts = [];
    for (let k = 0; k <= 5; k++) pts.push(sideAt(s, mix(z0, z1, k / 5), v));
    seam(s, pts);
  };
  for (const s of [-1, 1]) {
    for (const [z0, z1, handle] of [[0.42, -0.98, s < 0], [-2.2, -3.62, true]]) {
      doorEdge(s, z0, 0.3, 0.97);
      doorEdge(s, z1, 0.3, 0.97);
      doorSill(s, z0, z1, 0.3);
      if (handle) {
        const h = sideAt(s, z1 + 0.14, 0.86, 0.03);
        block(P.metal, FORD.brass, 0.03, 0.09, 0.14, [h[0] - s * 0.015, h[1], h[2] - 0.02]);
        pipe(P.metal, FORD.brassPale, [[h[0], h[1], h[2] - 0.05], [h[0] + s * 0.05, h[1] + 0.01, h[2] + 0.05], [h[0] + s * 0.055, h[1] + 0.01, h[2] + 0.18]], 0.019, { sides: 6, steps: 6 });
      }
      for (const v of [0.46, 0.8]) {
        const h = sideAt(s, z0 + 0.0, v, 0.02);
        rod(P.metal, FORD.brass, [h[0], h[1] - 0.07, h[2]], [h[0], h[1] + 0.07, h[2]], 0.02, { sides: 6 });
      }
    }
  }

  // ----- Inside: pleated seats, dash, wheel and levers ------------------------------------------
  // Upholstery as side-by-side rolls: pleats are what make a seat read as a seat, and at any mesh a
  // student can afford, a tinted solid cannot have them.
  const rolls = (ax, ay, az, bx, by, bz, n, r, width, axis) => {
    // n rolls side by side across `width` along X, each running from a to b.
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + ((i + 0.5) / n) * width;
      const edge = Math.abs((i + 0.5) / n - 0.5) * 2;
      const shrink = 1 - 0.1 * edge ** 3;
      pipe(P.matte, FORD.leather, [
        [x, ay, az * shrink], [x, mix(ay, by, 0.5) + axis, mix(az, bz, 0.5)], [x, by, bz],
      ], (width / n) * 0.62 + r, { sides: 6, steps: 4, round: 1, section: () => [0.8, 1] });
    }
  };
  // Front seat: cushion and back.
  rolls(0, 2.94, -0.32, 0, 2.98, -1.62, 13, 0.0, 3.5, 0.03);
  rolls(0, 3.0, -1.72, 0, 4.42, -1.96, 13, 0.0, 3.5, 0.02);
  // A bench under each cushion, in the body colour.
  block(P.paint, FORD.black, 3.4, 0.6, 1.5, [0, 2.6, -1.0]);
  bar(P.wood, FORD.woodDark, [-1.78, 3.0, -2.0], [1.78, 3.0, -2.0], 0.1, 1.0, woodOpts);
  // Rear seat.
  rolls(0, 2.94, -2.88, 0, 2.98, -4.18, 14, 0.0, 3.9, 0.03);
  rolls(0, 3.0, -4.28, 0, 4.62, -4.62, 14, 0.0, 3.9, 0.02);
  block(P.paint, FORD.black, 3.8, 0.6, 1.5, [0, 2.6, -3.55]);
  block(P.paint, FORD.black, 3.8, 1.4, 0.2, [0, 3.2, -4.72]);
  // Dash: a plain varnished board on the back of the cowl.
  bar(P.wood, FORD.wood, [0, 3.45, 0.54], [0, 3.45, 0.47], 3.7, 1.25, { tile: [1.2, 1.8], rng, up: [0, 1, 0] });
  // Steering wheel on a raked column, its rim wood, its spider brass, on the car's left.
  const WHEEL = [0.84, 4.72, -0.18];
  const colBase = [0.92, 3.1, 1.2];
  const col = alongMatrix(colBase, WHEEL);
  rod(P.paint, FORD.iron, colBase, WHEEL, 0.07, { sides: 12 });
  const wheelM = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, col.dir.clone().negate()));
  wheelM.setPosition(WHEEL[0], WHEEL[1], WHEEL[2]);
  P.wood.push({ geometry: swapUV(ringGeo(0.62, 0.052, { segments: 40, sides: 8 }), 1, 4).applyMatrix4(wheelM), color: FORD.woodDark });
  P.metal.push({ geometry: spin([[0, -0.06], [0.12, -0.06], [0.14, 0], [0.11, 0.06], [0, 0.07]], { segments: 16 }).applyMatrix4(wheelM), color: FORD.brass });
  for (let i = 0; i < 4; i++) {
    const a = ((i + 0.5) / 4) * Math.PI * 2;
    const arm = new THREE.BoxGeometry(0.075, 0.03, 0.56);
    arm.translate(0, 0, 0.3);
    arm.rotateY(a);
    P.paint.push({ geometry: arm.applyMatrix4(wheelM), color: FORD.iron });
  }
  // Spark and throttle levers on a brass quadrant under the wheel.
  P.metal.push({ geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.02, 14).applyMatrix4(wheelM.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.14, 0))), color: FORD.brass });
  // Hand brake and three pedals, all that was needed to drive one.
  pipe(P.paint, FORD.iron, [[1.62, 2.42, -0.15], [1.66, 2.9, -0.02], [1.66, 3.5, 0.2]], 0.032, { sides: 8, steps: 8 });
  dot(P.matte, FORD.rubber, 0.06, [1.66, 3.52, 0.21], { sides: 10 });
  for (let i = 0; i < 3; i++) {
    const x = 0.62 + i * 0.26;
    rod(P.paint, FORD.iron, [x, 2.42, 0.5], [x, 2.74, 0.28], 0.024, { sides: 6 });
    block(P.metal, FORD.brass, 0.17, 0.03, 0.12, [x, 2.75, 0.27], [0.5, 0, 0]);
  }

  // ----- The top, up: fabric over four bows that fan from a bracket on each side --------------------
  const roof = {
    pts: [[1.42, 6.58], [0.75, 6.8], [-0.7, 6.94], [-2.4, 6.92], [-3.85, 6.74], [-4.62, 6.22], [-5.0, 5.2], [-5.14, 4.05]],
    w: [1.98, 2.12, 2.2, 2.23, 2.24, 2.22, 2.12, 1.86],
  };
  const roofCurve = new THREE.CatmullRomCurve3(roof.pts.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'catmullrom', 0.5);
  const roofAt = (u, c, lift = 0) => {
    const p = roofCurve.getPoint(u);
    const t = roofCurve.getTangent(u);
    const w = splineAt(roof.w, u);
    const a = Math.abs(c);
    // The arch across the car, with the sides falling away into a short hem.
    const drop = 0.3 * a ** 2.6 + 0.3 * a ** 14 - lift;
    return [c * w, p.y + t.z * drop, p.z - t.y * drop];
  };
  P.fabric.push({
    geometry: solidSurface({
      nu: 30, nv: 20, point: (u, v) => roofAt(u, 2 * v - 1), thick: () => 0.03,
    }),
    color: FORD.fabric,
  });
  for (const c of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 16; k++) pts.push(roofAt(k / 16, c));
    pipe(P.fabric, 0x1e1d1b, pts, 0.042, { sides: 6, steps: 44 });
  }
  { // Front and rear hems.
    const front = [];
    const rear = [];
    for (let k = 0; k <= 12; k++) { front.push(roofAt(0, -1 + k / 6)); rear.push(roofAt(1, -1 + k / 6)); }
    pipe(P.fabric, 0x1e1d1b, front, 0.045, { sides: 6, steps: 28 });
    pipe(P.fabric, 0x1e1d1b, rear, 0.045, { sides: 6, steps: 28 });
  }
  // The rear curtain's small window: a dark pane in a bound frame, standing proud of the fabric.
  {
    const uW = 0.84;
    const g = solidSurface({
      nu: 6, nv: 12,
      point: (u, v) => {
        return roofAt(uW + (u - 0.5) * 0.09 * Math.sqrt(Math.max(0, 1 - ((v - 0.5) * 2) ** 2)), (v - 0.5) * 0.42, 0.042);
      },
      thick: () => 0.012,
    });
    P.paint.push({ geometry: g, color: 0x05070a });
  }
  // Bows and their common pivot on the body's shoulder.
  const pivotZ = -2.5;
  for (const u of [0.02, 0.26, 0.47, 0.66]) {
    const pts = [];
    for (let k = 0; k <= 16; k++) pts.push(roofAt(u, -1 + k / 8, -0.075));
    pipe(P.wood, FORD.woodDark, pts, 0.042, { sides: 6, steps: 40, section: () => [0.8, 1.25] });
    for (const s of [-1, 1]) {
      const end = roofAt(u, s, -0.075);
      const pivot = [s * (halfW(pivotZ) + 0.07), 3.84, pivotZ];
      rod(P.wood, FORD.woodDark, [end[0], end[1], end[2]], pivot, 0.04, { sides: 8 });
      dot(P.wood, FORD.woodDark, 0.056, [end[0], end[1], end[2]]);
    }
  }
  for (const s of [-1, 1]) {
    const p = [s * (halfW(pivotZ) + 0.09), 3.84, pivotZ];
    rod(P.metal, FORD.brass, [p[0] - s * 0.1, p[1], p[2]], [p[0] + s * 0.06, p[1], p[2]], 0.08, { sides: 12 });
    block(P.paint, FORD.iron, 0.04, 0.5, 0.2, [s * (halfW(pivotZ) + 0.035), 3.62, pivotZ]);
  }
  // Leather straps from the front bow down to the frame horns, which held it taut against the wind.
  for (const s of [-1, 1]) {
    const top = roofAt(0.02, s * 0.72, -0.05);
    const low = [s * 1.26, 2.28, 4.32];
    pipe(P.matte, FORD.strap, [[top[0], top[1], top[2]], [(top[0] + low[0]) / 2 + s * 0.02, (top[1] + low[1]) / 2, (top[2] + low[2]) / 2], low], 0.036, {
      sides: 6, steps: 16, round: 0, section: () => [0.26, 1], frame: () => [0, 0.5, 0.86],
    });
  }

  // ----- Windscreen: flat, upright and split, in a brass frame -----------------------------------
  const WZ = 0.98;
  const WSX = 1.8;
  const wsTop = 6.3;
  const wsBase = 4.14;
  const wsMid = 5.2;
  for (const s of [-1, 1]) rod(P.metal, FORD.brass, [s * WSX, 3.66, WZ], [s * WSX, wsTop, WZ], 0.042, { sides: 10 });
  for (const y of [wsBase, wsMid - 0.03, wsMid + 0.03, wsTop]) {
    rod(P.metal, FORD.brass, [-WSX, y, WZ], [WSX, y, WZ], 0.03, { sides: 8 });
  }
  for (const s of [-1, 1]) {
    dot(P.metal, FORD.brass, 0.062, [s * WSX, wsTop, WZ], { sides: 10 });
    dot(P.metal, FORD.brassPale, 0.066, [s * (WSX + 0.02), wsMid, WZ], { sides: 10 });
    // Brace from the frame down to the cowl.
    rod(P.metal, FORD.brass, [s * WSX, 5.0, WZ], [s * 1.86, 3.74, 0.1], 0.026, { sides: 8 });
    // Strap the top's front bow to the frame.
    const top = roofAt(0.02, s * 0.84, -0.06);
    rod(P.matte, FORD.strap, [s * 1.46, wsTop + 0.01, WZ], [top[0], top[1], top[2]], 0.026, { sides: 6 });
  }
  P.glass.push({ geometry: new THREE.BoxGeometry(2 * WSX - 0.06, wsMid - wsBase - 0.02, 0.018), color: FORD.glass, position: [0, (wsMid + wsBase) / 2 - 0.02, WZ] });
  P.glass.push({ geometry: new THREE.BoxGeometry(2 * WSX - 0.06, wsTop - wsMid - 0.02, 0.018), color: FORD.glass, position: [0, (wsMid + wsTop) / 2 + 0.02, WZ] });

  // ----- The brass: radiator, headlamps, side lamps, tail lamp, horn -------------------------------
  // The radiator's outline is the car's face, swept up into a shallow winged top with a neck between.
  const RZ = 4.42;
  const radOut = [];
  const RW = 1.02;
  const RB = 2.34;
  const RT = 4.32;
  const wings = (x) => RT - 0.2 * (Math.abs(x) / RW) ** 1.4 + 0.1 * Math.exp(-(((Math.abs(x) - 0.34) / 0.2) ** 2)) + 0.05 * Math.exp(-((x / 0.18) ** 2));
  radOut.push([RW - 0.08, RB], [RW - 0.02, RB + 0.1]);
  for (let i = 0; i <= 8; i++) radOut.push([RW + 0.02 * Math.sin((i / 8) * Math.PI), mix(RB + 0.2, RT - 0.42, i / 8)]);
  for (let i = 0; i <= 28; i++) {
    const x = RW - (i / 28) * 2 * RW;
    radOut.push([x, wings(x)]);
  }
  for (let i = 8; i >= 0; i--) radOut.push([-RW - 0.02 * Math.sin((i / 8) * Math.PI), mix(RB + 0.2, RT - 0.42, i / 8)]);
  radOut.push([-RW + 0.02, RB + 0.1], [-RW + 0.08, RB]);
  plate(P.metal, FORD.brass, radOut, 0.3, RZ);
  // Bead round the whole front face.
  {
    const loop = radOut.map((p) => [p[0] * 0.985, 3.3 + (p[1] - 3.3) * 0.985, RZ + 0.155]);
    pipe(P.metal, FORD.brassPale, [...loop, loop[0]], 0.024, { sides: 5, steps: loop.length });
  }
  // The honeycomb core in a recessed look: dark panel a hair proud inside a projecting frame.
  const coreT = 3.68;
  const coreB = 2.5;
  const coreW = 0.82;
  plate(P.paint, FORD.core, [[coreW, coreB], [coreW, coreT], [-coreW, coreT], [-coreW, coreB]], 0.02, RZ + 0.158);
  for (let i = 0; i <= 18; i++) {
    const x = -coreW + (i / 18) * 2 * coreW;
    block(P.metal, 0x9c7a2e, 0.012, coreT - coreB, 0.018, [x, (coreT + coreB) / 2, RZ + 0.17]);
  }
  for (let i = 0; i <= 15; i++) {
    const y = coreB + (i / 15) * (coreT - coreB);
    block(P.metal, 0x9c7a2e, 2 * coreW, 0.012, 0.018, [0, y, RZ + 0.17]);
  }
  for (const [a, b] of [
    [[coreW + 0.03, coreB - 0.03], [coreW + 0.03, coreT + 0.03]],
    [[-coreW - 0.03, coreB - 0.03], [-coreW - 0.03, coreT + 0.03]],
    [[-coreW - 0.03, coreT + 0.03], [coreW + 0.03, coreT + 0.03]],
    [[-coreW - 0.03, coreB - 0.03], [coreW + 0.03, coreB - 0.03]],
  ]) {
    rod(P.metal, FORD.brassPale, [a[0], a[1], RZ + 0.18], [b[0], b[1], RZ + 0.18], 0.04, { sides: 8 });
  }
  // Filler neck and cap.
  P.metal.push({
    geometry: spin([
      [0, 4.26], [0.15, 4.26], [0.11, 4.36], [0.11, 4.4, 'h'], [0.15, 4.4, 'h'], [0.155, 4.45], [0.12, 4.49], [0.03, 4.5], [0, 4.5],
    ], { segments: 16 }).translate(0, 0, RZ + 0.02),
    color: FORD.brass,
  });
  // A lamp lying on +Z: a dome behind, a drum, a rolled rim, and a domed lens set in it.
  const lamp = (x, y, z, R, depth, bracketW) => {
    const seg = R > 0.3 ? 28 : 14;
    const dome = onZ(spin([
      [0, -depth * 0.5], [R * 0.45, -depth * 0.47], [R * 0.82, -depth * 0.32], [R, -depth * 0.05], [R, depth * 0.34, 'h'], [R * 1.07, depth * 0.35, 'h'], [R * 1.1, depth * 0.42], [R * 1.07, depth * 0.5], [R * 0.9, depth * 0.52, 'h'], [0, depth * 0.52],
    ], { segments: seg })).translate(x, y, z);
    P.metal.push({ geometry: dome, color: FORD.brass });
    P.paint.push({
      geometry: onZ(spin([[0, depth * 0.5], [R * 0.92, depth * 0.5], [R * 0.8, depth * 0.57], [R * 0.48, depth * 0.63], [0, depth * 0.65]], { segments: seg })).translate(x, y, z),
      color: FORD.lens,
    });
    // Chimney vent on the crown.
    P.metal.push({
      geometry: spin([[0, R * 0.8], [R * 0.2, R * 0.8], [R * 0.17, R * 1.1], [R * 0.26, R * 1.12], [R * 0.2, R * 1.24], [0, R * 1.3]], { segments: 8 }).translate(x, y, z - depth * 0.1),
      color: FORD.brassPale,
    });
    if (bracketW) {
      for (const s of [-1, 1]) {
        dot(P.metal, FORD.brassPale, 0.055, [x + s * R * 1.0, y, z], { sides: 8 });
        pipe(P.metal, FORD.brass, [[x + s * R, y, z], [x + s * (R + 0.09), y - R * 0.5, z - 0.02], [x + s * bracketW, y - R - 0.25, z - 0.1]], 0.026, { sides: 6, steps: 8 });
      }
    }
  };
  const HX = 0.92;
  const HY = 3.26;
  const HZ = T_FZ + 0.72;
  for (const s of [-1, 1]) {
    lamp(s * HX, HY, HZ, 0.44, 0.62, 0.14);
    rod(P.metal, FORD.brass, [s * HX, HY - 0.72, HZ - 0.1], [s * HX, HY - 0.92, HZ - 0.1], 0.032, { sides: 8 });
    // The iron from the frame horn forward to the lamp tie bar.
    pipe(P.paint, FORD.iron, [[s * 1.2, 2.14, 4.26], [s * 1.12, 2.2, 4.7], [s * HX, HY - 0.92, HZ - 0.1]], 0.04, { sides: 8, steps: 10 });
    // Side lamps on the cowl: oil, and square-shouldered enough to look it.
    const sz = 1.62;
    const sx = 1.72;
    lamp(s * (sx + 0.2), 3.72, sz + 0.04, 0.2, 0.32, 0);
    rod(P.paint, FORD.iron, [s * (sx - 0.08), 3.48, sz], [s * (sx + 0.2), 3.48, sz], 0.022, { sides: 6 });
    rod(P.paint, FORD.iron, [s * (sx + 0.2), 3.48, sz], [s * (sx + 0.2), 3.62, sz + 0.04], 0.022, { sides: 6 });
  }
  rod(P.metal, FORD.brass, [-HX, HY - 0.92, HZ - 0.1], [HX, HY - 0.92, HZ - 0.1], 0.03, { sides: 8 });
  // Tail lamp, on the left rear, red lens.
  lamp(1.25, 2.92, -5.42, 0.17, 0.26, 0);
  P.paint.push({ geometry: new THREE.SphereGeometry(0.15, 12, 8).scale(1, 1, 0.5).rotateY(Math.PI).translate(1.25, 2.92, -5.6), color: 0x9c1a14 });
  rod(P.paint, FORD.iron, [1.25, 2.72, -5.3], [1.25, 2.55, -5.05], 0.03, { sides: 6 });
  block(P.paint, FORD.iron, 0.04, 0.25, 0.25, [1.25, 2.6, -5.15]);
  // The bulb horn, running along the hood from a rubber bulb by the driver's hand.
  pipe(P.metal, FORD.brass, [[1.28, 3.44, 2.05], [1.2, 3.34, 3.0], [1.16, 3.34, 3.8], [1.2, 3.42, 4.5]], 0.028, { sides: 8, steps: 20 });
  P.metal.push({
    geometry: alongY(spin([[0, -0.3], [0.03, -0.3], [0.04, -0.1], [0.08, 0.1], [0.17, 0.26], [0.2, 0.3, 'h'], [0.18, 0.3, 'h'], [0.05, 0.18], [0, 0.16]], { segments: 16 }), [1.2, 3.42, 4.3], [1.25, 3.5, 4.9]),
    color: FORD.brassPale,
  });
  P.matte.push({ geometry: spin([[0, -0.15], [0.07, -0.13], [0.12, -0.03], [0.1, 0.1], [0.04, 0.16], [0.03, 0.24], [0, 0.24]], { segments: 12 }).rotateX(Math.PI / 2 + 0.3).translate(1.28, 3.46, 1.78), color: FORD.rubber });

  // ----- Merge --------------------------------------------------------------------------------
  const paint = sheen(mergeParts(P.paint), { add: 0.075, band: 0.03, bandY: 3.25, bandW: 0.42 });
  const metal = sheen(mergeParts(P.metal), { gain: 0.55 });
  const glass = new THREE.Mesh(
    mergeParts(P.glass),
    new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.2, roughness: 0.08, metalness: 0, depthWrite: false }),
  );
  glass.castShadow = false;
  const bump = grainBump(1915, { size: 256, dots: 2400, min: 0.8, max: 1.8, contrast: 0.42 });
  bump.repeat.set(9, 7);
  return groupOf(
    meshFrom(paint, { roughness: 0.26, metalness: 0 }),
    meshFrom(metal, { roughness: 0.34, metalness: 0.5 }),
    meshFrom(mergeParts(P.wood), { roughness: 0.46, metalness: 0, ...grainMaps({ seed: 15, knots: 0, strength: 0.3, streaks: 120 }) }),
    meshFrom(mergeParts(P.matte), { roughness: 0.88, metalness: 0 }),
    meshFrom(mergeParts(P.fabric), { roughness: 0.92, metalness: 0, bumpMap: bump, bumpScale: 0.6 }),
    glass,
  );
}

// ---------------------------------------------------------------------------
// Penny-farthing: a high-wheeler of about 1880, life size
// ---------------------------------------------------------------------------
//
// Everything here is a thin member, so nothing may stop short: every spoke runs from inside a hub
// flange to inside the rim, computed from the same angle, and each backbone station is read from one
// curve concentric with the big wheel, which is the line that makes the machine elegant.

const PF = {
  enamel: 0x4e0f12,
  nickel: 0xc5cacf,
  steel: 0x8d9398,
  rubber: 0x1b1a19,
  rim: 0x24100f,
  leather: 0x70431f,
  leatherDark: 0x41240f,
  brass: 0xcfa33f,
  grip: 0x33190c,
};

function pfWheel(P, { R, z, tr, spokes, flangeX, flangeR, hubR, spokeR, segments }) {
  const M = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  M.setPosition(0, R, z);
  const add = (list, g, color) => list.push({ geometry: g.applyMatrix4(M), color });
  // A solid rubber tyre seated in a crescent steel rim, which is what rims were before air.
  add(P.matte, ringGeo(R - tr, tr, { segments, sides: 8 }), PF.rubber);
  const seat = R - tr * 1.7;
  const w = tr * 1.1;
  add(P.frame, spin([
    [seat - tr * 0.5, -w * 0.5], [seat - tr * 0.1, -w * 0.95], [seat + tr * 0.25, -w * 1.08], [seat + tr * 0.1, -w * 0.5], [seat, 0],
    [seat + tr * 0.1, w * 0.5], [seat + tr * 0.25, w * 1.08], [seat - tr * 0.1, w * 0.95], [seat - tr * 0.5, w * 0.5], [seat - tr * 0.62, 0],
  ], { segments, closed: true }), PF.rim);
  // Hub: a barrel with a flange each side, and the spokes alternate between them, which is what
  // braces so narrow and tall a wheel against sideways loads.
  add(P.metal, spin([
    [0, -flangeX - 0.06], [hubR * 0.7, -flangeX - 0.06], [hubR * 0.8, -flangeX - 0.03], [flangeR, -flangeX - 0.018, 'h'], [flangeR, -flangeX + 0.018, 'h'], [hubR, -flangeX + 0.05],
    [hubR * 0.86, 0], [hubR, flangeX - 0.05], [flangeR, flangeX - 0.018, 'h'], [flangeR, flangeX + 0.018, 'h'], [hubR * 0.8, flangeX + 0.03], [hubR * 0.7, flangeX + 0.06], [0, flangeX + 0.06],
  ], { segments: 24 }), PF.nickel);
  const rimR = seat - tr * 0.45;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const s = i % 2 ? 1 : -1;
    const y = Math.cos(a);
    const zz = Math.sin(a);
    const from = [s * flangeX, R + y * (flangeR - 0.012), z + zz * (flangeR - 0.012)];
    const to = [0, R + y * (rimR + 0.03), z + zz * (rimR + 0.03)];
    rod(P.metal, PF.nickel, from, to, spokeR, { sides: 5 });
    // The threaded nipple where the spoke enters the rim.
    const nip = [0 + s * flangeX * 0.018, R + y * (rimR - 0.05), z + zz * (rimR - 0.05)];
    rod(P.metal, PF.steel, nip, to, spokeR * 1.7, { sides: 5 });
  }
}

function pennyFarthing() {
  const P = { frame: [], metal: [], matte: [], leather: [] };
  const R1 = 2.5;
  const R2 = 0.75;
  const FZ = 0.6;
  const RZ = -2.4;
  const A = [0, R1, FZ];
  const B = [0, R2, RZ];
  pfWheel(P, { R: R1, z: FZ, tr: 0.062, spokes: 64, flangeX: 0.19, flangeR: 0.21, hubR: 0.1, spokeR: 0.013, segments: 96 });
  pfWheel(P, { R: R2, z: RZ, tr: 0.05, spokes: 24, flangeX: 0.075, flangeR: 0.1, hubR: 0.045, spokeR: 0.011, segments: 48 });

  // ----- The steering head, raked back a few degrees, and the fork from it to the axle ----------
  const rake = THREE.MathUtils.degToRad(9);
  const dir = [0, Math.cos(rake), -Math.sin(rake)];
  const out = (k, x = 0) => [x, A[1] + dir[1] * k, A[2] + dir[2] * k];
  const K0 = R1 + 0.2; // the fork crown, just over the tyre
  const K1 = K0 + 0.44; // the top of the head
  P.metal.push({
    geometry: alongY(spin([
      [0, -0.3], [0.1, -0.3], [0.12, -0.26], [0.1, -0.2], [0.082, -0.15], [0.082, 0.12], [0.1, 0.16], [0.118, 0.22], [0.1, 0.27], [0.05, 0.3], [0, 0.3],
    ], { segments: 18 }), out(K0 - 0.02), out(K0 + 0.58)),
    color: PF.enamel,
  });
  P.frame.push({ geometry: new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.8, 1), color: PF.enamel, position: out(K0 + 0.01) });
  for (const s of [-1, 1]) {
    pipe(P.frame, PF.enamel, [out(K0 + 0.04, 0), out(K0 - 0.08, s * 0.13), out(K0 - 0.4, s * 0.2), out(R1 * 0.5, s * 0.29), out(0.04, s * 0.32)], [0.06, 0.05, 0.045, 0.04, 0.036], {
      sides: 8, steps: 26, round: 1, section: () => [1.25, 0.85], frame: () => [0, 0, 1],
    });
    // Bearing case at the bottom of each blade.
    P.metal.push({
      geometry: onX(spin([[0, -0.05], [0.07, -0.05], [0.085, -0.03], [0.085, 0.03], [0.07, 0.05], [0, 0.05]], { segments: 16 })).translate(s * 0.32, R1, FZ),
      color: PF.nickel,
    });
  }

  // ----- The backbone: one curve concentric with the big wheel, tapering all the way --------------
  const bone = (deg, lift = 0) => {
    const t = THREE.MathUtils.degToRad(deg);
    const r = splineAt([2.88, 2.8, 2.77, 2.75, 2.75, 2.75], clamp01((deg - 9) / 87)) + lift;
    return [0, R1 + Math.cos(t) * r, FZ - Math.sin(t) * r];
  };
  const bonePts = [];
  for (let d = 9; d <= 96; d += 6.2) bonePts.push(bone(d));
  bonePts[bonePts.length - 1] = bone(96);
  pipe(P.frame, PF.enamel, bonePts, [0.078, 0.07, 0.062, 0.055, 0.048, 0.04, 0.034], { sides: 12, steps: 56, round: 2 });
  // Nickel ferrules, which break the long line up and show its taper.
  for (const d of [18, 90]) {
    const a = bone(d - 1);
    const b = bone(d + 1);
    rod(P.metal, PF.nickel, a, b, d < 50 ? 0.08 : 0.043, { sides: 14 });
  }
  // The rear fork, from the backbone's end down either side of the small wheel.
  const E = bone(96);
  for (const s of [-1, 1]) {
    pipe(P.frame, PF.enamel, [E, [s * 0.03, mix(E[1], B[1], 0.22), mix(E[2], B[2], 0.2) + 0.015], [s * 0.115, mix(E[1], B[1], 0.62), mix(E[2], B[2], 0.62)], [s * 0.135, B[1], B[2]]], [0.036, 0.03, 0.026, 0.024], {
      sides: 7, steps: 12, round: 1,
    });
    P.metal.push({
      geometry: onX(spin([[0, -0.02], [0.05, -0.02], [0.05, 0.02], [0.035, 0.05], [0, 0.05]], { segments: 12 }), s).translate(s * 0.15, B[1], B[2]),
      color: PF.nickel,
    });
  }

  // ----- Handlebars, grips, brake --------------------------------------------------------------
  const H = out(K1 + 0.08);
  const bars = [];
  for (const [x, dy, dz] of [[-1.08, -0.2, -0.26], [-0.72, -0.1, -0.18], [-0.34, -0.015, -0.05], [0, 0, 0], [0.34, -0.015, -0.05], [0.72, -0.1, -0.18], [1.08, -0.2, -0.26]]) {
    bars.push([x, H[1] + dy, H[2] + dz]);
  }
  pipe(P.metal, PF.nickel, bars, 0.027, { sides: 10, steps: 36, round: 1 });
  rod(P.metal, PF.nickel, out(K1 - 0.14), out(K1 + 0.1), 0.05, { sides: 12 });
  dot(P.metal, PF.nickel, 0.062, H, { sides: 12 });
  for (const s of [-1, 1]) {
    // A pear-shaped grip, turned in rosewood, carried by the bar's own end direction.
    P.leather.push({
      geometry: alongY(spin([[0, -0.2], [0.03, -0.2], [0.04, -0.13], [0.058, -0.02], [0.066, 0.1], [0.056, 0.18], [0, 0.21]], { segments: 14 }),
        [s * 1.0, H[1] - 0.176, H[2] - 0.24], [s * 1.36, H[1] - 0.25, H[2] - 0.32]),
      color: PF.grip,
    });
  }
  // The spoon brake: a lever under the bar, a rod down the head, and a plate that bears on the tyre.
  const spoonDir = THREE.MathUtils.degToRad(3.5);
  const spoon = [0, R1 + Math.cos(spoonDir) * (R1 + 0.045), FZ - Math.sin(spoonDir) * (R1 + 0.045)];
  pipe(P.metal, PF.steel, [[-0.8, H[1] - 0.2, H[2] + 0.02], [-0.5, H[1] - 0.14, H[2] + 0.1], [-0.16, H[1] - 0.1, H[2] + 0.16], [-0.04, H[1] - 0.12, H[2] + 0.18]], 0.018, { sides: 7, steps: 12 });
  rod(P.metal, PF.steel, [-0.5, H[1] - 0.01, H[2] - 0.02], [-0.5, H[1] - 0.14, H[2] + 0.1], 0.016, { sides: 6 });
  pipe(P.metal, PF.steel, [[-0.04, H[1] - 0.12, H[2] + 0.18], [0, H[1] - 0.34, H[2] + 0.17], [0, spoon[1] + 0.2, spoon[2] + 0.01], [0, spoon[1] + 0.01, spoon[2]]], 0.016, { sides: 6, steps: 14 });
  P.metal.push({
    geometry: solidSurface({
      nu: 6, nv: 6,
      point: (u, v) => {
        const a = spoonDir + (u - 0.5) * 0.09;
        const rr = R1 + 0.022 - 0.05 * ((2 * v - 1) ** 2);
        return [(2 * v - 1) * 0.066, R1 + Math.cos(a) * rr, FZ - Math.sin(a) * rr];
      },
      thick: () => 0.008,
    }),
    color: PF.steel,
  });

  // ----- Axle, cranks, pedals: the pedals are fixed to the wheel, so one turn is one wheel round ---
  rod(P.metal, PF.steel, [-0.5, R1, FZ], [0.5, R1, FZ], 0.04, { sides: 12 });
  const crankAngle = THREE.MathUtils.degToRad(35);
  for (const s of [-1, 1]) {
    const a = s > 0 ? crankAngle : crankAngle + Math.PI;
    const dy = -Math.cos(a);
    const dz = Math.sin(a);
    const L = 0.46;
    const root = [s * 0.44, R1, FZ];
    const end = [s * 0.44, R1 + dy * L, FZ + dz * L];
    bar(P.metal, PF.nickel, root, end, 0.03, 0.07, { up: [1, 0, 0], chamfer: 0.008 });
    P.metal.push({ geometry: onX(spin([[0, -0.03], [0.07, -0.03], [0.075, 0.03], [0.05, 0.05], [0, 0.05]], { segments: 14 }), s).translate(root[0], root[1], root[2]), color: PF.nickel });
    P.metal.push({ geometry: onX(spin([[0, -0.025], [0.042, -0.025], [0.042, 0.025], [0, 0.025]], { segments: 10 }), s).translate(end[0], end[1], end[2]), color: PF.nickel });
    // A rubber-block pedal, level, on a spindle out of the crank's end.
    const px = s * (0.44 + 0.04);
    rod(P.metal, PF.steel, [px, end[1], end[2]], [px + s * 0.42, end[1], end[2]], 0.016, { sides: 7 });
    const pc = px + s * 0.22;
    for (const k of [-1, 1]) {
      bar(P.matte, PF.rubber, [pc - s * 0.17, end[1], end[2] + k * 0.055], [pc + s * 0.17, end[1], end[2] + k * 0.055], 0.05, 0.06, { up: [0, 1, 0], chamfer: 0.012 });
    }
    for (const k of [-1, 1]) {
      bar(P.metal, PF.steel, [pc + k * 0.17, end[1], end[2] - 0.095], [pc + k * 0.17, end[1], end[2] + 0.095], 0.02, 0.04, { up: [0, 1, 0] });
    }
  }

  // ----- Saddle: a suspended leather on a long C of spring steel --------------------------------
  const zS0 = FZ - 0.72; // the saddle's nose
  const zS1 = FZ - 1.66; // its cantle
  const yS = 5.52; // the top of the leather
  const clamp = out(K0 + 0.12);
  const tail = bone(44, 0.05);
  const springPts = [
    [0, clamp[1], clamp[2] - 0.06],
    [0, yS - 0.17, FZ - 0.68],
    [0, yS - 0.14, FZ - 1.2],
    [0, yS - 0.17, FZ - 1.68],
    [0, yS - 0.34, FZ - 1.98],
    [tail[0], tail[1] + 0.05, tail[2]],
  ];
  pipe(P.metal, PF.steel, springPts, 0.075, { sides: 8, steps: 34, round: 0, section: () => [0.22, 1], frame: () => [1, 0, 0] });
  // Its clips: a band to the head and a sliding shoe on the backbone behind.
  rod(P.frame, PF.enamel, [0, clamp[1] - 0.02, clamp[2] - 0.08], clamp, 0.05, { sides: 8 });
  dot(P.metal, PF.nickel, 0.09, [tail[0], tail[1] - 0.012, tail[2]], { sides: 12, flat: 0.8 });
  // The leather: broad cantle, long nose, skirted, and domed so the rivets have something to sit on.
  const saddleSt = [
    { d: zS1 - 0.02, w: 0.04, up: 0.02, dn: 0.02, b: yS - 0.12, round: 1 },
    { d: zS1, w: 0.3, up: 0.05, dn: 0.1, b: yS - 0.08, round: 0.9 },
    { d: zS1 + 0.12, w: 0.41, up: 0.075, dn: 0.13, b: yS - 0.07, round: 0.9 },
    { d: zS1 + 0.36, w: 0.36, up: 0.07, dn: 0.15, b: yS - 0.07, round: 1 },
    { d: zS1 + 0.62, w: 0.19, up: 0.05, dn: 0.13, b: yS - 0.075, round: 1 },
    { d: zS0 - 0.08, w: 0.095, up: 0.045, dn: 0.1, b: yS - 0.09, round: 1 },
    { d: zS0, w: 0.07, up: 0.04, dn: 0.08, b: yS - 0.1, round: 1 },
    { d: zS0 + 0.02, w: 0.02, up: 0.01, dn: 0.02, b: yS - 0.1, round: 1 },
  ];
  P.leather.push({ geometry: solidLoft(saddleSt, { sides: 24, samples: 28 }), color: PF.leather });
  // Copper rivets round the cantle and the nose.
  for (let i = 0; i <= 8; i++) {
    const a = -1.25 + (i / 8) * 2.5;
    P.metal.push({
      geometry: new THREE.SphereGeometry(0.019, 6, 4).scale(1, 0.55, 1),
      color: PF.brass,
      position: [Math.sin(a) * 0.33, yS - 0.024 - 0.02 * Math.abs(Math.sin(a)), zS1 + 0.15 - Math.cos(a) * 0.1],
    });
  }
  // A saddle bag strapped behind, the rider's only luggage.
  P.leather.push({
    geometry: solidLoft([
      { d: -0.26, w: 0.02, h: 0.02, b: 0, round: 0.6 },
      { d: -0.24, w: 0.11, h: 0.085, b: 0, round: 0.55 },
      { d: 0.24, w: 0.11, h: 0.085, b: 0, round: 0.55 },
      { d: 0.26, w: 0.02, h: 0.02, b: 0, round: 0.6 },
    ], { sides: 16, samples: 4 }).rotateY(Math.PI / 2).translate(0, yS - 0.33, FZ - 1.74),
    color: PF.leatherDark,
  });

  // ----- The mounting step: one foot on this, a scoot, and up -----------------------------------
  const st = bone(82);
  rod(P.frame, PF.enamel, st, [0.2, st[1] + 0.02, st[2]], 0.025, { sides: 8 });
  dot(P.frame, PF.enamel, 0.05, st, { sides: 8 });
  bar(P.matte, PF.rubber, [0.17, st[1] + 0.04, st[2] - 0.08], [0.17, st[1] + 0.04, st[2] + 0.08], 0.16, 0.035, { up: [0, 1, 0], chamfer: 0.008 });

  return groupOf(
    meshFrom(sheen(mergeParts(P.frame), { add: 0.05, gain: 0.9 }), { roughness: 0.3, metalness: 0 }),
    meshFrom(sheen(mergeParts(P.metal), { gain: 0.4 }), { roughness: 0.3, metalness: 0.45 }),
    meshFrom(mergeParts(P.matte), { roughness: 0.85, metalness: 0 }),
    meshFrom(mergeParts(P.leather), { roughness: 0.62, metalness: 0 }),
  );
}

// ---------------------------------------------------------------------------
// Montgolfier balloon: the balloon of 1783, at TRUE size (the catalogue shows it at 0.25)
// ---------------------------------------------------------------------------
//
// THE MODEL IS CARRIED BY ITS PAINTING, so the painting is drawn in FEET on the surface: each motif
// is placed at a height, and the canvas is scaled there by how many pixels a foot of cloth takes at
// that radius, or every sun near the crown would be stretched sideways into a smear. Every motif is
// drawn three times, a canvas-width apart, so nothing can stop at the seam of the tile.

const BAL = {
  iron: 0x1a1816,
  rope: 0xa98c5e,
  wicker: 0xb98c50,
  plank: 0x7d5a34,
  post: 0x5d4228,
  bag: 0x9c8460,
  blue: '#1b3ca8',
  blueDeep: '#142d82',
  gold: '#efbd3f',
  goldLight: '#ffe391',
  goldDark: '#a26a12',
  red: '#b5201f',
  redDark: '#7a1213',
  cream: '#f4e7c6',
};
const GORES = 24;
const GALLERY_FLOOR = 5.0;
const NECK_RIM = GALLERY_FLOOR + 2.7;

// The meridian from the crown down to the neck's rim: a true dome, a long taper, a short skirt.
function balloonMeridian() {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const phi = (i / 12) * (110 * Math.PI / 180);
    pts.push(new THREE.Vector3(24.5 * Math.sin(phi), 50 + 25 * Math.cos(phi), 0));
  }
  for (const [r, y] of [[20.4, 34.2], [16.7, 27.4], [12.9, 21.4], [9.9, 16.6], [8.35, 13.2], [8.0, 10.2], [8.1, NECK_RIM]]) {
    pts.push(new THREE.Vector3(r, y, 0));
  }
  pts[0].x = 0;
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

function balloonCanvas(meridian) {
  const W = 2048;
  const H = 1536;
  const OUTER = 0.93; // the fraction of the sheet that lies on the outside of the balloon
  // An arc-length table, so a height can be turned into a row and a row into a radius.
  const steps = 400;
  const table = meridian.getSpacedPoints(steps);
  const pxPerFoot = (H * OUTER) / meridian.getLength();
  const rowOf = (y) => {
    for (let i = 0; i < steps; i++) {
      if (table[i + 1].y <= y) {
        const t = (table[i].y - y) / Math.max(1e-6, table[i].y - table[i + 1].y);
        return ((i + t) / steps) * H * OUTER;
      }
    }
    return H * OUTER;
  };
  const radiusAt = (y) => {
    for (let i = 0; i < steps; i++) if (table[i + 1].y <= y) return Math.max(0.5, table[i + 1].x);
    return 8;
  };
  const texture = canvasTexture(W, H, (ctx) => {
    const rep = (count, y, phase, fn) => {
      const py = rowOf(y);
      const sx = W / (2 * Math.PI * radiusAt(y));
      for (let i = 0; i < count; i++) {
        for (const dx of [-W, 0, W]) {
          ctx.save();
          ctx.translate(((i + phase) / count) * W + dx, py);
          ctx.scale(sx, pxPerFoot);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          fn(i);
          ctx.restore();
        }
      }
    };

    // The cloth: gores in two close blues, and a dark stitched seam between each pair.
    ctx.fillStyle = BAL.blue;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < GORES; i++) {
      const x = (i / GORES) * W;
      const w = W / GORES;
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, 'rgba(10,20,80,0.32)');
      g.addColorStop(0.16, 'rgba(10,20,80,0)');
      g.addColorStop(0.5, 'rgba(120,160,255,0.08)');
      g.addColorStop(0.84, 'rgba(10,20,80,0)');
      g.addColorStop(1, 'rgba(10,20,80,0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, H);
    }

    const goldFill = () => { ctx.fillStyle = BAL.gold; ctx.strokeStyle = BAL.goldDark; ctx.lineWidth = 0.09; };

    // ----- Motifs, each in feet about its own centre ----------------------------------------------
    const fleur = (k) => {
      ctx.save();
      ctx.scale(k, k);
      goldFill();
      ctx.lineWidth = 0.05;
      // Centre petal.
      ctx.beginPath();
      ctx.moveTo(0, -1.1);
      ctx.bezierCurveTo(0.42, -0.55, 0.32, -0.05, 0.14, 0.2);
      ctx.lineTo(-0.14, 0.2);
      ctx.bezierCurveTo(-0.32, -0.05, -0.42, -0.55, 0, -1.1);
      ctx.fill();
      ctx.stroke();
      for (const s of [-1, 1]) {
        // Side petals curling out and down.
        ctx.beginPath();
        ctx.moveTo(s * 0.13, 0.14);
        ctx.bezierCurveTo(s * 0.2, -0.45, s * 0.62, -0.74, s * 0.86, -0.36);
        ctx.bezierCurveTo(s * 1.0, -0.12, s * 0.8, 0.06, s * 0.64, -0.04);
        ctx.bezierCurveTo(s * 0.72, -0.26, s * 0.5, -0.32, s * 0.42, -0.1);
        ctx.bezierCurveTo(s * 0.38, 0.0, s * 0.36, 0.1, s * 0.4, 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // The foot below the band.
        ctx.beginPath();
        ctx.moveTo(s * 0.06, 0.34);
        ctx.quadraticCurveTo(s * 0.4, 0.46, s * 0.46, 0.8);
        ctx.quadraticCurveTo(s * 0.18, 0.72, 0, 0.78);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // The band that ties the three petals together.
      ctx.fillStyle = BAL.goldLight;
      ctx.beginPath();
      ctx.rect(-0.5, 0.18, 1.0, 0.17);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    // The twelve signs, as pen strokes in a box of -1..1, in the order of the year.
    const ZODIAC = [
      (c) => { c.moveTo(0, 0.85); c.lineTo(0, -0.35); c.moveTo(0, -0.1); c.bezierCurveTo(-0.15, -0.85, -0.85, -0.85, -0.72, -0.28); c.moveTo(0, -0.1); c.bezierCurveTo(0.15, -0.85, 0.85, -0.85, 0.72, -0.28); },
      (c) => { c.moveTo(0.42, 0.34); c.arc(0, 0.34, 0.42, 0, Math.PI * 2); c.moveTo(-0.72, -0.8); c.bezierCurveTo(-0.5, -0.2, 0.5, -0.2, 0.72, -0.8); },
      (c) => { c.moveTo(-0.66, -0.72); c.quadraticCurveTo(0, -0.46, 0.66, -0.72); c.moveTo(-0.66, 0.72); c.quadraticCurveTo(0, 0.46, 0.66, 0.72); c.moveTo(-0.27, -0.58); c.lineTo(-0.27, 0.58); c.moveTo(0.27, -0.58); c.lineTo(0.27, 0.58); },
      (c) => { c.moveTo(-0.42, -0.34); c.arc(-0.42, -0.26, 0.22, 0, Math.PI * 2); c.moveTo(-0.5, -0.48); c.bezierCurveTo(-0.1, -0.78, 0.5, -0.72, 0.76, -0.36); c.moveTo(0.64, 0.26); c.arc(0.42, 0.26, 0.22, 0, Math.PI * 2); c.moveTo(0.5, 0.48); c.bezierCurveTo(0.1, 0.78, -0.5, 0.72, -0.76, 0.36); },
      (c) => { c.moveTo(-0.3, 0.1); c.arc(-0.5, 0.1, 0.2, 0, Math.PI * 2); c.moveTo(-0.34, -0.02); c.bezierCurveTo(-0.7, -0.92, 0.4, -0.98, 0.26, -0.3); c.bezierCurveTo(0.2, 0.05, 0.04, 0.4, 0.2, 0.62); c.quadraticCurveTo(0.42, 0.86, 0.68, 0.56); },
      (c) => { c.moveTo(-0.76, -0.66); c.quadraticCurveTo(-0.5, -0.82, -0.5, -0.4); c.lineTo(-0.5, 0.6); c.moveTo(-0.5, -0.4); c.quadraticCurveTo(-0.2, -0.86, -0.12, -0.4); c.lineTo(-0.12, 0.6); c.moveTo(-0.12, -0.4); c.quadraticCurveTo(0.2, -0.86, 0.26, -0.4); c.lineTo(0.26, 0.42); c.quadraticCurveTo(0.3, 0.76, 0.56, 0.86); c.moveTo(0.26, -0.12); c.bezierCurveTo(0.74, -0.42, 0.82, 0.3, 0.1, 0.66); },
      (c) => { c.moveTo(-0.82, 0.68); c.lineTo(0.82, 0.68); c.moveTo(-0.82, 0.3); c.lineTo(-0.28, 0.3); c.bezierCurveTo(-0.72, -0.6, 0.72, -0.6, 0.28, 0.3); c.lineTo(0.82, 0.3); },
      (c) => { c.moveTo(-0.8, -0.6); c.quadraticCurveTo(-0.5, -0.8, -0.5, -0.4); c.lineTo(-0.5, 0.6); c.moveTo(-0.5, -0.4); c.quadraticCurveTo(-0.2, -0.86, -0.12, -0.4); c.lineTo(-0.12, 0.6); c.moveTo(-0.12, -0.4); c.quadraticCurveTo(0.2, -0.86, 0.26, -0.4); c.lineTo(0.26, 0.42); c.quadraticCurveTo(0.3, 0.72, 0.8, 0.5); c.moveTo(0.58, 0.28); c.lineTo(0.84, 0.48); c.lineTo(0.62, 0.74); },
      (c) => { c.moveTo(-0.72, 0.72); c.lineTo(0.72, -0.72); c.moveTo(0.1, -0.72); c.lineTo(0.72, -0.72); c.lineTo(0.72, -0.1); c.moveTo(-0.5, -0.14); c.lineTo(0.14, 0.5); },
      (c) => { c.moveTo(-0.8, -0.66); c.quadraticCurveTo(-0.42, -0.72, -0.34, -0.2); c.lineTo(-0.28, 0.5); c.moveTo(-0.34, -0.2); c.bezierCurveTo(-0.1, -0.86, 0.2, -0.6, 0.2, -0.16); c.lineTo(0.2, 0.28); c.bezierCurveTo(0.2, 0.74, -0.08, 0.86, -0.26, 0.72); c.moveTo(0.2, 0.16); c.bezierCurveTo(0.5, -0.2, 0.88, 0.1, 0.72, 0.36); c.bezierCurveTo(0.58, 0.62, 0.28, 0.52, 0.2, 0.3); },
      (c) => { for (const y of [-0.28, 0.32]) { c.moveTo(-0.84, y + 0.16); c.lineTo(-0.5, y - 0.2); c.lineTo(-0.2, y + 0.16); c.lineTo(0.12, y - 0.2); c.lineTo(0.42, y + 0.16); c.lineTo(0.84, y - 0.2); } },
      (c) => { c.moveTo(-0.66, -0.76); c.quadraticCurveTo(-0.14, 0, -0.66, 0.76); c.moveTo(0.66, -0.76); c.quadraticCurveTo(0.14, 0, 0.66, 0.76); c.moveTo(-0.72, 0); c.lineTo(0.72, 0); },
    ];
    const medallion = (i) => {
      ctx.fillStyle = BAL.blueDeep;
      ctx.strokeStyle = BAL.gold;
      ctx.lineWidth = 0.42;
      ctx.beginPath();
      ctx.arc(0, 0, 4.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = BAL.goldLight;
      ctx.beginPath();
      ctx.arc(0, 0, 4.15, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        ctx.fillStyle = BAL.goldLight;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 5.15, Math.sin(a) * 5.15, 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.scale(2.9, 2.9);
      ctx.strokeStyle = BAL.gold;
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ZODIAC[i](ctx);
      ctx.stroke();
      ctx.restore();
    };
    const sun = () => {
      const R = 2.3;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const long = k % 2 === 0;
        const L = long ? 5.6 : 4.3;
        const w = long ? 0.42 : 0.28;
        ctx.save();
        ctx.rotate(a);
        ctx.fillStyle = long ? BAL.gold : BAL.goldLight;
        ctx.beginPath();
        ctx.moveTo(-w, -R * 0.92);
        if (long) ctx.bezierCurveTo(-w * 1.4, -R - 1, w * 0.9, -R - 1.8, 0, -L);
        else ctx.lineTo(0, -L);
        if (long) ctx.bezierCurveTo(w * 1.4, -R - 1.8, w * 1.4, -R - 1, w, -R * 0.92);
        else ctx.lineTo(w, -R * 0.92);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = BAL.gold;
      ctx.strokeStyle = BAL.goldDark;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = BAL.goldLight;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.74, 0, Math.PI * 2);
      ctx.stroke();
    };
    // A crowned fleur-de-lys in a laurel wreath, standing in for the king's cipher of the real balloon.
    const crest = () => {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 9; k++) {
          const a = Math.PI / 2 + side * (0.25 + (k / 8) * 2.25);
          ctx.save();
          ctx.translate(Math.cos(a) * 3.9, Math.sin(a) * 3.9);
          ctx.rotate(a + side * 0.75);
          ctx.fillStyle = k % 2 ? BAL.gold : BAL.goldLight;
          ctx.beginPath();
          ctx.ellipse(0, 0, 0.3, 0.72, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      fleur(2.5);
      ctx.fillStyle = BAL.goldLight;
      ctx.strokeStyle = BAL.goldDark;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.moveTo(-1.5, -3.9);
      ctx.lineTo(-1.85, -5.4);
      ctx.lineTo(-0.8, -4.6);
      ctx.lineTo(0, -5.7);
      ctx.lineTo(0.8, -4.6);
      ctx.lineTo(1.85, -5.4);
      ctx.lineTo(1.5, -3.9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    // A swag of crimson cloth between two rosettes, its folds running with its sag, and a tassel.
    const swag = (span, depth) => () => {
      const h = span / 2;
      for (const [k, fill] of [[1, BAL.redDark], [0.94, BAL.red]]) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(-h, 0);
        ctx.quadraticCurveTo(0, depth * 0.72 * k, h, 0);
        ctx.lineTo(h, 0.5);
        ctx.quadraticCurveTo(0, depth * 1.9 * k, -h, 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(70,6,8,0.9)';
      ctx.lineWidth = 0.14;
      for (const f of [0.92, 1.18, 1.46]) {
        ctx.beginPath();
        ctx.moveTo(-h, 0.25);
        ctx.quadraticCurveTo(0, depth * f, h, 0.25);
        ctx.stroke();
      }
      // Gold fringe along the hem, and a rope along the top.
      ctx.strokeStyle = BAL.gold;
      ctx.lineWidth = 0.34;
      ctx.beginPath();
      ctx.moveTo(-h, 0.5);
      ctx.quadraticCurveTo(0, depth * 1.9, h, 0.5);
      ctx.stroke();
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(-h, 0);
      ctx.quadraticCurveTo(0, depth * 0.72, h, 0);
      ctx.stroke();
    };
    const tassel = (len) => () => {
      ctx.fillStyle = BAL.gold;
      ctx.strokeStyle = BAL.goldDark;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, 1.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = BAL.goldLight;
      ctx.beginPath();
      ctx.arc(0, 0, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BAL.gold;
      ctx.beginPath();
      ctx.moveTo(-0.28, 0.9);
      ctx.lineTo(0.28, 0.9);
      ctx.lineTo(0.58, 0.9 + len);
      ctx.lineTo(-0.58, 0.9 + len);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    const border = (y, thick) => {
      const py = rowOf(y);
      const t = thick * pxPerFoot;
      ctx.fillStyle = BAL.gold;
      ctx.fillRect(0, py - t / 2, W, t);
      ctx.fillStyle = BAL.goldDark;
      ctx.fillRect(0, py - t / 2 - 2, W, 2);
      ctx.fillRect(0, py + t / 2, W, 2);
    };
    const beads = (y, count, r) => rep(count, y, 0, () => {
      ctx.fillStyle = BAL.goldLight;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    });

    // ----- The bands, top to bottom ---------------------------------------------------------------
    // The crown: solid gold to a toothed edge, whose rays are the only motif that SHOULD stretch.
    const crownY = rowOf(71.2);
    ctx.fillStyle = '#c98d22';
    ctx.fillRect(0, 0, W, crownY);
    ctx.fillStyle = '#e0a832';
    ctx.fillRect(0, crownY * 0.5, W, crownY * 0.5);
    ctx.fillStyle = BAL.goldDark;
    ctx.fillRect(0, crownY * 0.48, W, 3);
    for (let i = 0; i < 24; i++) {
      const w = W / 24;
      for (const dx of [-W, 0, W]) {
        ctx.fillStyle = '#e0a832';
        ctx.beginPath();
        ctx.moveTo(i * w + dx, crownY - 1);
        ctx.lineTo((i + 0.5) * w + dx, crownY + 40);
        ctx.lineTo((i + 1) * w + dx, crownY - 1);
        ctx.closePath();
        ctx.fill();
      }
    }
    rep(14, 66.6, 0, () => fleur(1.9));
    rep(20, 62.4, 0.5, () => fleur(1.8));
    border(58.9, 0.5);
    beads(58.1, 72, 0.17);
    rep(12, 52.0, 0.5, (i) => medallion(i));
    border(45.4, 0.5);
    beads(44.6, 72, 0.17);
    rep(12, 38.6, 0.25, (i) => (i % 2 === 0 ? sun() : crest()));
    border(31.6, 0.5);
    beads(30.8, 60, 0.15);
    rep(12, 29.4, 0.5, swag(9.1, 6.2));
    rep(12, 29.4, 0, tassel(3.2));
    rep(12, 19.6, 0.5, () => fleur(1.35));
    rep(12, 18.8, 0, () => { ctx.fillStyle = BAL.gold; ctx.beginPath(); ctx.moveTo(0, -1.1); ctx.lineTo(0.5, 0); ctx.lineTo(0, 1.1); ctx.lineTo(-0.5, 0); ctx.closePath(); ctx.fill(); });
    border(14.3, 0.4);
    // The neck: plainer, a deep blue skirt, because it is what the fire scorches.
    const neckTop = rowOf(14.1);
    const outerEnd = H * OUTER;
    ctx.fillStyle = BAL.blueDeep;
    ctx.fillRect(0, neckTop, W, outerEnd - neckTop);
    for (let i = 0; i < GORES; i++) {
      ctx.fillStyle = 'rgba(0,0,30,0.5)';
      ctx.fillRect((i / GORES) * W - 2, neckTop, 4, outerEnd - neckTop);
    }
    border(NECK_RIM + 0.5, 0.75);

    // Gore seams, drawn over the cloth but stopped under the bands by being faint.
    for (let i = 0; i < GORES; i++) {
      const x = (i / GORES) * W;
      ctx.fillStyle = 'rgba(8,14,60,0.4)';
      ctx.fillRect(x - 1, crownY + 40, 2, neckTop - crownY - 40);
    }
    // The inside of the mouth, on the last rows of the sheet: lit by the brazier at its lip and going
    // to black in the dark above it.
    const inner = ctx.createLinearGradient(0, outerEnd, 0, H);
    inner.addColorStop(0, '#ffb45c');
    inner.addColorStop(0.2, '#d8611c');
    inner.addColorStop(0.55, '#5a1d08');
    inner.addColorStop(1, '#0c0402');
    ctx.fillStyle = inner;
    ctx.fillRect(0, outerEnd, W, H - outerEnd);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return { texture, OUTER };
}

function montgolfierBalloon() {
  const meridian = balloonMeridian();
  const { texture, OUTER } = balloonCanvas(meridian);

  // ----- The envelope: one closed solid, with a real mouth that runs back up inside itself --------
  const ROWS_OUT = 74;
  const ROWS_IN = 5;
  const COLS = GORES * 8;
  const insideProfile = [[8.1, NECK_RIM], [7.45, NECK_RIM + 0.15], [6.8, NECK_RIM + 6], [4.8, NECK_RIM + 15], [2.0, NECK_RIM + 24], [0, NECK_RIM + 27]];
  const rowsR = [];
  const rowsY = [];
  const rowsV = [];
  const rowsAmp = [];
  for (let i = 0; i <= ROWS_OUT; i++) {
    const p = meridian.getPointAt(i / ROWS_OUT);
    rowsR.push(i === 0 ? 0 : p.x);
    rowsY.push(p.y);
    rowsV.push((i / ROWS_OUT) * OUTER);
    // Each gore bellies out between its seams, and most where the cloth is under most load.
    rowsAmp.push(0.024 * sstep(i / ROWS_OUT, 0.02, 0.2) * (1 - sstep(i / ROWS_OUT, 0.9, 0.995)));
  }
  for (let i = 1; i < insideProfile.length; i++) {
    rowsR.push(insideProfile[i][0]);
    rowsY.push(insideProfile[i][1]);
    rowsV.push(OUTER + (i / (insideProfile.length - 1)) * (1 - OUTER));
    rowsAmp.push(0);
  }
  const rows = rowsR.length;
  const ring = COLS + 1;
  const pos = new Float32Array(rows * ring * 3);
  const uvs = new Float32Array(rows * ring * 2);
  const seamR = (i, j) => {
    const belly = Math.abs(Math.sin((Math.PI * GORES * j) / COLS)) ** 0.55;
    return rowsR[i] * (1 + rowsAmp[i] * (belly - 0.72));
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j <= COLS; j++) {
      const a = ((j % COLS) / COLS) * Math.PI * 2;
      const r = seamR(i, j);
      const k = (i * ring + j) * 3;
      pos[k] = Math.sin(a) * r;
      pos[k + 1] = rowsY[i];
      pos[k + 2] = Math.cos(a) * r;
      uvs[(i * ring + j) * 2] = j / COLS;
      uvs[(i * ring + j) * 2 + 1] = 1 - rowsV[i];
    }
  }
  // Normals from each vertex's neighbours, wrapping at the seam, so the tile's join cannot crease.
  const nor = new Float32Array(pos.length);
  const at = (i, j) => {
    const jj = ((j % COLS) + COLS) % COLS;
    const k = (THREE.MathUtils.clamp(i, 0, rows - 1) * ring + jj) * 3;
    return new THREE.Vector3(pos[k], pos[k + 1], pos[k + 2]);
  };
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j <= COLS; j++) {
      const du = at(i, j + 1).sub(at(i, j - 1));
      const dv = at(i + 1, j).sub(at(i - 1, j));
      const n = dv.cross(du);
      if (n.lengthSq() < 1e-10) n.set(0, i === 0 ? 1 : -1, 0);
      n.normalize();
      const k = (i * ring + j) * 3;
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
    }
  }
  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = i * ring + j + 1;
      const d = (i + 1) * ring + j + 1;
      if (i > 0) idx.push(a, b, c);
      if (i < rows - 2) idx.push(c, b, d);
    }
  }
  const env = new THREE.BufferGeometry();
  env.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  env.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  env.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  env.setIndex(idx);
  const weave = grainBump(1783, { size: 256, dots: 3000, min: 0.7, max: 1.4, contrast: 0.3 });
  weave.repeat.set(30, 20);
  const envelope = new THREE.Mesh(env, new THREE.MeshStandardMaterial({ map: texture, bumpMap: weave, bumpScale: 0.25, roughness: 0.78, metalness: 0 }));
  envelope.castShadow = true;
  envelope.receiveShadow = true;

  // ----- The gallery: a wicker walkway round the opening, where the two men fed the fire -------------
  const G = { wicker: [], iron: [], coals: [], flame: [] };
  const F = GALLERY_FLOOR;
  const uvRing = (profile, segments, uTiles, vTiles) => {
    const n = profile.length;
    const P2 = [];
    const U = [];
    const I = [];
    for (let c = 0; c <= segments; c++) {
      const a = ((c % segments) / segments) * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        P2.push(Math.sin(a) * profile[i][0], profile[i][1], Math.cos(a) * profile[i][0]);
        U.push((c / segments) * uTiles, (profile[i][1] / 3.3) * vTiles);
      }
    }
    for (let c = 0; c < segments; c++) {
      for (let i = 0; i < n - 1; i++) {
        const a = c * n + i;
        const b = (c + 1) * n + i;
        I.push(a, b, b + 1, a, b + 1, a + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return outward(g);
  };
  // Outer basket wall, closed in section, and the inner one the neck is laced to.
  G.wicker.push({
    geometry: uvRing([[11.3, F], [11.75, F], [11.8, F + 3.7], [11.55, F + 3.8], [11.32, F + 3.7], [11.3, F]], 64, 36, 2.2),
    color: BAL.wicker,
  });
  G.wicker.push({
    geometry: uvRing([[7.5, F], [7.9, F], [8.16, NECK_RIM - 0.05], [8.25, NECK_RIM + 0.5], [7.5, NECK_RIM + 0.25], [7.5, F]], 56, 24, 2.2),
    color: BAL.wicker,
  });
  // The floor, in planks from a solid ring.
  G.iron.push({
    geometry: spin([[7.45, F - 0.32], [11.85, F - 0.32], [11.85, F + 0.14], [7.45, F + 0.14]], { segments: 60, closed: true }),
    color: BAL.plank,
  });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const x0 = Math.sin(a);
    const z0 = Math.cos(a);
    rod(G.iron, 0x3d2916, [x0 * 7.9, F + 0.145, z0 * 7.9], [x0 * 11.3, F + 0.145, z0 * 11.3], 0.018, { sides: 3 });
  }
  // Rail and rope round the top of the basket.
  G.iron.push({ geometry: ringGeo(11.56, 0.17, { segments: 64, sides: 8, y: F + 3.85 }), color: 0x6d4a26 });
  G.iron.push({ geometry: ringGeo(11.8, 0.09, { segments: 64, sides: 6, y: F + 0.3 }), color: 0x6d4a26 });
  // Hanging ropes, one to each seam, from the rail up to a load band on the cloth.
  const loadY = 21.4;
  const loadR = 12.9 * (1 + 0.024 * (0 - 0.72) * 0.9);
  for (let i = 0; i < GORES; i++) {
    const a = (i / GORES) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    rod(G.iron, BAL.rope, [s * 11.55, F + 3.85, c * 11.55], [s * (loadR - 0.02), loadY, c * (loadR - 0.02)], 0.075, { sides: 5 });
    dot(G.iron, 0xb98a2c, 0.2, [s * (loadR + 0.02), loadY, c * (loadR + 0.02)], { sides: 6, flat: 0.8 });
  }

  // ----- The brazier, in the middle of the mouth, hung by chains from the inner wall ---------------
  const By = F + 0.9;
  G.iron.push({ geometry: ringGeo(1.9, 0.09, { segments: 32, sides: 6, y: By + 0.6 }), color: BAL.iron });
  G.iron.push({ geometry: ringGeo(1.5, 0.07, { segments: 28, sides: 6, y: By - 0.2 }), color: BAL.iron });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    pipe(G.iron, BAL.iron, [[s * 1.9, By + 0.6, c * 1.9], [s * 1.55, By - 0.2, c * 1.55], [s * 0.75, By - 0.85, c * 0.75], [0, By - 1.0, 0]], 0.05, { sides: 5, steps: 8, round: 1 });
  }
  const rngCoal = seededRandom(1783);
  for (let i = 0; i < 26; i++) {
    const a = rngCoal() * Math.PI * 2;
    const r = Math.sqrt(rngCoal()) * 1.55;
    const g = new THREE.IcosahedronGeometry(0.28 + rngCoal() * 0.24, 0);
    G.coals.push({ geometry: g, color: i % 3 === 0 ? 0xffc35a : i % 3 === 1 ? 0xff7a1c : 0xd8400c, position: [Math.sin(a) * r, By + 0.42 + rngCoal() * 0.3 - r * 0.1, Math.cos(a) * r] });
  }
  for (let i = 0; i < 4; i++) {
    const a = ((i + 0.5) / 4) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    rod(G.iron, BAL.iron, [s * 1.9, By + 0.6, c * 1.9], [s * 7.65, F + 2.5, c * 7.65], 0.05, { sides: 5 });
  }
  // The fire: two nested shells, added to the picture rather than painted over it, each fading to
  // nothing at its edge in the vertex colours.
  const flameShell = (R, h, y0, c0, c1) => {
    const g = spin([[0, 0], [R * 0.7, h * 0.05], [R, h * 0.2], [R * 0.82, h * 0.42], [R * 0.48, h * 0.68], [R * 0.2, h * 0.88], [0, h]], { segments: 18 });
    g.translate(0, y0, 0);
    const a = lin(c0);
    const b = lin(c1);
    tintVertices(g, (x, y, z, o) => {
      const t = clamp01((y - y0) / h);
      o[0] = mix(a[0], b[0], t); o[1] = mix(a[1], b[1], t); o[2] = mix(a[2], b[2], t);
    });
    G.flame.push({ geometry: g, keepColor: true });
  };
  flameShell(2.4, 11, By + 0.3, 0x3c1a06, 0x060100);
  flameShell(1.5, 8.5, By + 0.4, 0x8c4a14, 0x120400);
  flameShell(0.8, 5.0, By + 0.45, 0xffc870, 0x3a1200);

  // ----- Tethers: she flew free, but was held down until the moment of release ---------------------
  const ANCHORS = 8;
  const ANCHOR_R = 22;
  for (let i = 0; i < ANCHORS; i++) {
    const a = ((i + 0.5) / ANCHORS) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    const low = [s * ANCHOR_R, 1.6, c * ANCHOR_R];
    pipe(G.iron, BAL.rope, [[s * 11.6, F + 3.85, c * 11.6], [s * 16.5, 3.9, c * 16.5], low], 0.11, { sides: 5, steps: 10, round: 0 });
    // A short mooring post with the rope hitched round it, and sandbags piled against its foot.
    G.iron.push({
      geometry: spin([[0, 0], [0.42, 0], [0.36, 0.3], [0.34, 2.0], [0.26, 2.15], [0, 2.2]], { segments: 10 }).translate(low[0], 0, low[2]),
      color: BAL.post,
    });
    G.iron.push({ geometry: ringGeo(0.38, 0.1, { segments: 12, sides: 5, y: 1.6 }).translate(low[0], 0, low[2]), color: BAL.rope });
    for (const [dr, dt, sz] of [[0.95, 0, 1], [-0.1, 0.95, 0.92], [-0.1, -0.95, 0.92], [0.45, 0.3, 0.85]]) {
      const x = low[0] + s * dr + c * dt;
      const z = low[2] + c * dr - s * dt;
      const g = new THREE.SphereGeometry(0.72 * sz, 10, 6).scale(1.15, 0.62, 0.85).rotateY(a + dt);
      G.iron.push({ geometry: g, color: BAL.bag, position: [x, dr === 0.45 ? 1.0 : 0.42, z] });
    }
  }

  const fire = new THREE.Mesh(mergeParts(G.flame), new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fire.castShadow = false;
  const wickerMap = wickerMaps();
  return groupOf(
    envelope,
    meshFrom(mergeParts(G.wicker), { roughness: 0.82, metalness: 0, map: wickerMap.map, bumpMap: wickerMap.bump, bumpScale: 0.7 }),
    meshFrom(mergeParts(G.iron), { roughness: 0.82, metalness: 0 }),
    new THREE.Mesh(mergeParts(G.coals), new THREE.MeshBasicMaterial({ vertexColors: true })),
    fire,
  );
}

// Over and under, in a tile: stakes running up and willow rods weaving across them.
function wickerMaps() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#6e5a3e';
  ctx.fillRect(0, 0, S, S);
  const NX = 8;
  const NY = 8;
  const w = S / NX;
  const h = S / NY;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const over = (i + j) % 2 === 0;
      const x = i * w;
      const y = j * h;
      const g = over ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#9d8a68');
      g.addColorStop(0.5, '#fff7e4');
      g.addColorStop(1, '#9d8a68');
      ctx.fillStyle = g;
      if (over) ctx.fillRect(x - 3, y + 2, w + 6, h - 4);
      else ctx.fillRect(x + 2, y - 3, w - 4, h + 6);
    }
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bump: make(THREE.NoColorSpace) };
}

// ---------------------------------------------------------------------------
// Edison phonograph: a home cylinder machine, three times life size
// ---------------------------------------------------------------------------
//
// THE HORN IS THE IDENTIFICATION, so it is a real curved tube with a wall: one closed surface that
// runs up the outside from the throat to the lip, rolls over, and comes back down the inside. The
// stylus is placed from the cylinder's own numbers so its point lands exactly on the wax, and the
// belt is the true tangent loop between its two pulleys.

const PHO = {
  oak: 0x9a5f28,
  oakDark: 0x6e4119,
  iron: 0x121416,
  brass: 0xd0a23e,
  brassPale: 0xe8c770,
  nickel: 0xbcc2c8,
  steel: 0x7f868c,
  wax: 0xb9975f,
  belt: 0x5a3417,
  lacquer: [0.012, 0.02, 0.032],
  lacquerLift: [0.05, 0.075, 0.1],
  gold: [0.72, 0.46, 0.1],
};

// One closed surface: outside from throat to lip, a rolled rim, then back down inside.
function hornGeo(points, radiusAt, { rows = 40, sides = 64, wall = 0.035, petals = 8 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(vec), false, 'catmullrom', 0.5);
  const frames = [];
  let N = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const T = curve.getTangentAt(t);
    N = N.clone().addScaledVector(T, -N.dot(T)).normalize();
    frames.push({ c: curve.getPointAt(t), T, N, B: new THREE.Vector3().crossVectors(T, N).normalize(), t });
  }
  const rings = [];
  const last = frames[rows];
  // Outside.
  for (const f of frames) rings.push({ f, r: radiusAt(f.t), inner: 0, push: 0 });
  // The lip, rolled over the wall's thickness.
  const rEnd = radiusAt(1);
  for (const [dr, dz] of [[wall * 0.3, wall * 0.5], [-wall * 0.5, wall * 0.75], [-wall * 1.2, wall * 0.5]]) {
    rings.push({ f: last, r: rEnd + dr, inner: 0.5, push: dz });
  }
  // Inside, back toward the throat, stopping short of it and closing to a point in the dark.
  for (let i = rows; i >= 2; i--) {
    const f = frames[i];
    rings.push({ f, r: Math.max(0.012, radiusAt(f.t) - wall), inner: 1, push: 0 });
  }
  const pos = [];
  const col = [];
  const idx = [];
  const P0 = frames[0];
  const brass = lin(PHO.brass);
  for (const ring of rings) {
    const { f, r } = ring;
    const flare = sstep(f.t, 0.5, 0.96);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const wave = Math.cos(petals * a);
      const rr = r * (1 + 0.05 * flare * wave);
      const ca = Math.cos(a) * rr;
      const sa = Math.sin(a) * rr;
      pos.push(
        f.c.x + f.N.x * ca + f.B.x * sa + f.T.x * ring.push,
        f.c.y + f.N.y * ca + f.B.y * sa + f.T.y * ring.push,
        f.c.z + f.N.z * ca + f.B.z * sa + f.T.z * ring.push,
      );
      if (ring.inner > 0.75) {
        // Inside: dark red lacquer going black down the throat, with a gold band just inside the lip.
        const k = sstep(f.t, 0.35, 0.9);
        const crest = flare * Math.max(0, wave) ** 2;
        const gilt = sstep(f.t, 0.968, 0.978) * 0.8;
        col.push(
          mix(mix(0.006, 0.075, k) + 0.03 * crest, PHO.gold[0], gilt),
          mix(mix(0.003, 0.018, k) + 0.012 * crest, PHO.gold[1], gilt),
          mix(mix(0.002, 0.012, k) + 0.008 * crest, PHO.gold[2], gilt),
        );
      } else if (ring.inner > 0) {
        col.push(PHO.gold[0] * 0.8, PHO.gold[1] * 0.8, PHO.gold[2] * 0.8);
      } else {
        const band = sstep(f.t, 0.905, 0.915) * (1 - sstep(f.t, 0.945, 0.955));
        const lip = sstep(f.t, 0.985, 0.995);
        const crest = flare * Math.max(0, wave) ** 2;
        const seam = flare * sstep(-wave, 0.9, 1);
        const c = [
          PHO.lacquer[0] + PHO.lacquerLift[0] * crest,
          PHO.lacquer[1] + PHO.lacquerLift[1] * crest,
          PHO.lacquer[2] + PHO.lacquerLift[2] * crest,
        ];
        const g = clamp01(Math.max(band, lip, seam * 0.6));
        col.push(mix(c[0], PHO.gold[0], g), mix(c[1], PHO.gold[1], g), mix(c[2], PHO.gold[2], g));
      }
    }
  }
  const n = rings.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j;
      const b = i * sides + j2;
      const c = (i + 1) * sides + j2;
      const d = (i + 1) * sides + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  // Close both ends: the throat cap, which the elbow hides, and the blind end inside.
  const pole0 = pos.length / 3;
  pos.push(P0.c.x, P0.c.y, P0.c.z);
  col.push(brass[0], brass[1], brass[2]);
  const inEnd = rings[n - 1].f;
  const pole1 = pos.length / 3;
  pos.push(inEnd.c.x, inEnd.c.y, inEnd.c.z);
  col.push(0.01, 0.006, 0.002);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    idx.push(pole0, j2, j);
    idx.push(pole1, (n - 1) * sides + j, (n - 1) * sides + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

function grooveMaps() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#efe6d8';
  ctx.fillRect(0, 0, 32, 512);
  const count = 128;
  for (let i = 0; i < count; i++) {
    const y = (i / count) * 512;
    ctx.fillStyle = '#6e5a42';
    ctx.fillRect(0, y, 32, 1.5);
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: 0.5 };
}

function edisonPhonograph() {
  const rng = seededRandom(1877);
  const P = { wood: [], iron: [], metal: [], wax: [], decal: [] };
  const woodOpts = { tile: [1.1, 2.2], rng };

  // ----- The oak case: panels, plinth and top rail, with finger joints at the corners ---------------
  const CW = 1.72; // half width
  const CD = 1.2; // half depth
  const CH = 1.14; // to the top of the case
  P.iron.push({ geometry: new THREE.BoxGeometry(CW * 2 - 0.1, CH - 0.1, CD * 2 - 0.1), color: 0x1a120a, position: [0, CH / 2 + 0.02, 0] });
  const ringBars = (y, h, out, color, chamfer) => {
    for (const s of [-1, 1]) {
      bar(P.wood, color, [-CW - out, y, s * (CD + out - 0.04)], [CW + out, y, s * (CD + out - 0.04)], 0.08, h, { ...woodOpts, chamfer });
      bar(P.wood, color, [s * (CW + out - 0.04), y, -CD - out], [s * (CW + out - 0.04), y, CD + out], 0.08, h, { ...woodOpts, chamfer });
    }
  };
  ringBars(0.56, 0.86, 0, PHO.oak, 0);
  ringBars(0.075, 0.15, 0.06, PHO.oakDark, 0.022);
  ringBars(0.17, 0.05, 0.03, PHO.oakDark, 0.012);
  ringBars(1.07, 0.14, 0.045, PHO.oakDark, 0.022);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const y = 0.24 + (i + 0.5) * 0.105;
        const onX = i % 2 === 0;
        block(P.wood, onX ? PHO.oakDark : PHO.oak, onX ? 0.12 : 0.012, 0.105, onX ? 0.012 : 0.12, [sx * (CW - (onX ? 0.06 : -0.002)), y, sz * (CD + (onX ? 0.002 : -0.06))]);
      }
    }
  }

  // ----- The bedplate and its two standards, in black japanned iron -------------------------------
  const BY = 1.2;
  const CY = 1.92; // cylinder axis
  const CZ = 0.28;
  const RODZ = -0.4;
  const RODY = CY + 0.04;
  bar(P.iron, PHO.iron, [-1.56, BY - 0.02, 0], [1.56, BY - 0.02, 0], 2.16, 0.09, { up: [0, 1, 0], chamfer: 0.02 });
  for (const sx of [-1, 1]) {
    const z0 = -0.82;
    const z1 = sx < 0 ? CZ + 0.28 : RODZ + 0.26;
    const top = sx < 0 ? CY + 0.2 : RODY + 0.2;
    const x = sx < 0 ? -1.0 : 0.98;
    const outline = [[z0, BY + 0.02], [z1 + 0.1, BY + 0.02], [z1, BY + 0.2], [z1, top - 0.1], [z1 - 0.1, top], [z0 + 0.28, top], [z0 + 0.1, BY + 0.4]];
    const g = crisp(extrudeOutline(outline, 0.14)).rotateY(-Math.PI / 2);
    g.translate(x, 0, 0);
    P.iron.push({ geometry: outward(g), color: 0x23272b });
  }
  // Fine gold lining on the bedplate: the factory's only decoration on the iron.
  for (const s of [-1, 1]) {
    bar(P.metal, PHO.brass, [-1.48, BY + 0.03, s * 1.0], [1.48, BY + 0.03, s * 1.0], 0.012, 0.006);
    bar(P.metal, PHO.brass, [s * 1.48, BY + 0.03, -1.0], [s * 1.48, BY + 0.03, 1.0], 0.012, 0.006);
  }

  // A speed regulator on the deck, a brass plate, and four screws holding the bed to the case.
  P.metal.push({ geometry: spin([[0, 0], [0.13, 0], [0.13, 0.025], [0.1, 0.04], [0, 0.045]], { segments: 18 }).translate(-0.95, BY + 0.025, 0.74), color: PHO.brass });
  rod(P.metal, PHO.nickel, [-0.95, BY + 0.06, 0.74], [-0.72, BY + 0.085, 0.86], 0.016, { sides: 6 });
  dot(P.metal, PHO.brassPale, 0.028, [-0.72, BY + 0.085, 0.86]);
  block(P.metal, PHO.brass, 0.7, 0.014, 0.2, [0.55, BY + 0.03, 0.82]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      dot(P.metal, PHO.nickel, 0.034, [sx * 1.42, BY + 0.03, sz * 0.94], { sides: 8, flat: 0.5 });
    }
  }

  // ----- Mandrel and the cylinder on it ------------------------------------------------------------
  const R = 0.3;
  const X0 = -0.5;
  const X1 = 0.66;
  // The mandrel: a tapered drum, carried from the left only, so a cylinder can slide on from the right.
  P.iron.push({
    geometry: onX(spin([[0, -1.42], [0.05, -1.42], [0.05, -0.62], [0.14, -0.6], [0.24, -0.58], [0.24, 0.72], [0.2, 0.76], [0.06, 0.78], [0.06, 0.84], [0, 0.86]], { segments: 22 })).translate(0, CY, CZ),
    color: 0x34373a,
  });
  // The wax, built on a grid with its own texture rows, so grooves run round it.
  {
    const profile = [[0.245, X0 - 0.002], [R - 0.012, X0], [R, X0 + 0.014], [R, X1 - 0.014], [R - 0.012, X1], [0.245, X1 + 0.002]];
    const seg = 48;
    const Pp = [];
    const U = [];
    const I = [];
    for (let c = 0; c <= seg; c++) {
      const a = ((c % seg) / seg) * Math.PI * 2;
      for (const [r, x] of profile) {
        Pp.push(x, CY + Math.cos(a) * r, CZ + Math.sin(a) * r);
        U.push(c / seg, ((x - X0) / (X1 - X0)) * 3);
      }
    }
    const n = profile.length;
    for (let c = 0; c < seg; c++) {
      for (let i = 0; i < n - 1; i++) {
        const q = c * n + i;
        const w = (c + 1) * n + i;
        I.push(q, w, w + 1, q, w + 1, q + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    // Which way it winds is measured: the wall has no volume to sign, so test one outer triangle.
    const a0 = new THREE.Vector3().fromArray(Pp, 3 * 2);
    const a1 = new THREE.Vector3().fromArray(Pp, 3 * (n + 2));
    const a2 = new THREE.Vector3().fromArray(Pp, 3 * (n + 3));
    const nrm = a1.clone().sub(a0).cross(a2.clone().sub(a0));
    const radial = new THREE.Vector3(0, a0.y - CY, a0.z - CZ);
    if (nrm.dot(radial) < 0) {
      for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
      g.setIndex(I);
      g.computeVertexNormals();
    }
    P.wax.push({ geometry: g, color: PHO.wax });
  }
  // The rims of the wax where it meets the mandrel.
  for (const x of [X0, X1]) {
    P.iron.push({ geometry: onX(ringGeo(0.243, 0.008, { segments: 32, sides: 5 })).translate(x, CY, CZ), color: 0x34373a });
  }

  // ----- Back rod, feed screw, and the carriage that walks along the groove ------------------------
  rod(P.metal, PHO.nickel, [-1.0, RODY, RODZ], [0.98, RODY, RODZ], 0.042, { sides: 12 });
  const SCREWY = RODY - 0.2;
  {
    const prof = [[0, -0.96]];
    const threads = 30;
    for (let i = 0; i <= threads; i++) {
      const y = -0.95 + (i / threads) * 1.9;
      prof.push([i % 2 ? 0.04 : 0.028, y]);
    }
    prof.push([0, 0.96]);
    P.metal.push({ geometry: onX(spin(prof, { segments: 9 })).translate(0, SCREWY, RODZ), color: PHO.steel });
  }
  const RX = 0.18; // where along the record the needle has got to
  const TIP = [RX, CY + R, CZ]; // the point of the stylus, on top of the wax
  const RH = TIP[1] + 0.2; // reproducer's underside
  const RZ = CZ - 0.02;
  // Carriage: a sleeve on the rod, a half nut on the screw, and an arm to the reproducer.
  P.metal.push({ geometry: onX(spin([[0, -0.16], [0.075, -0.16], [0.085, -0.13], [0.085, 0.13], [0.075, 0.16], [0, 0.16]], { segments: 14 })).translate(RX, RODY, RODZ), color: PHO.brass });
  bar(P.iron, PHO.iron, [RX, RODY - 0.02, RODZ], [RX, SCREWY - 0.02, RODZ], 0.14, 0.05, { up: [0, 0, 1] });
  pipe(P.iron, PHO.iron, [[RX, RODY + 0.05, RODZ + 0.04], [RX, RH + 0.05, RODZ + 0.25], [RX, RH + 0.06, RZ - 0.1]], 0.036, { sides: 8, steps: 12, section: () => [1, 1.3] });
  // The reproducer: a round case holding the diaphragm, and the lever carrying the sapphire.
  P.metal.push({
    geometry: spin([[0, 0], [0.2, 0], [0.235, 0.012, 'h'], [0.235, 0.05, 'h'], [0.205, 0.056], [0.2, 0.1, 'h'], [0.11, 0.115], [0.08, 0.15], [0, 0.16]], { segments: 32 }).translate(RX, RH, RZ),
    color: PHO.nickel,
  });
  P.metal.push({ geometry: ringGeo(0.218, 0.014, { segments: 30, sides: 5, y: 0.058 }).translate(RX, RH, RZ), color: PHO.brassPale });
  P.iron.push({ geometry: spin([[0, -0.015], [0.05, -0.015], [0.055, 0.01], [0, 0.015]], { segments: 10 }).translate(RX, RH, RZ), color: PHO.iron });
  // Lever from a pivot under the case, to a point exactly on the wax. Sunk a hair, as a needle is.
  const LEVER = [RX, RH - 0.03, RZ + 0.13];
  rod(P.metal, PHO.brassPale, [RX, RH + 0.005, RZ], LEVER, 0.014, { sides: 6 });
  rod(P.metal, PHO.brassPale, LEVER, [TIP[0], TIP[1] + 0.05, TIP[2] + 0.02], 0.012, { sides: 6 });
  rod(P.iron, 0x1a0f08, [TIP[0], TIP[1] + 0.05, TIP[2] + 0.02], [TIP[0], TIP[1] - 0.002, TIP[2]], 0.012, { sides: 6, r2: 0.0035 });
  dot(P.metal, PHO.brassPale, 0.022, LEVER, { sides: 6 });

  // ----- The horn: lacquered dark outside, gilded in the mouth, gold band at the lip ------------------
  const hx = RX;
  const hornPts = [
    [hx, RH + 0.16, RZ], [hx, RH + 0.5, RZ - 0.02], [hx - 0.01, 2.95, RZ - 0.2], [hx - 0.04, 3.55, RZ - 0.56],
    [hx - 0.08, 4.14, RZ - 0.62], [hx - 0.11, 4.52, RZ - 0.26], [hx - 0.12, 4.66, RZ + 0.26], [hx - 0.13, 4.72, RZ + 0.86],
  ];
  const hornR = (t) => {
    // An exponential flare, which is what makes a horn work and also what makes it look like one.
    const base = 0.05;
    return base * Math.exp(t * 2.0) + 0.0017 * Math.exp(t * 6.1);
  };
  P.iron.push({ geometry: hornGeo(hornPts, (t) => hornR(t) * (1 + 0.0 * t), { rows: 44, sides: 64, wall: 0.035, petals: 8 }), keepColor: true });
  // A rubber elbow from the reproducer's neck into the throat.
  P.iron.push({ geometry: spin([[0, -0.1], [0.075, -0.1], [0.082, -0.04], [0.078, 0.14], [0.07, 0.2], [0, 0.2]], { segments: 14 }).translate(RX, RH + 0.2, RZ), color: 0x241510 });
  P.metal.push({ geometry: ringGeo(0.078, 0.014, { segments: 16, sides: 5, y: 0.14 }).translate(RX, RH + 0.2, RZ), color: PHO.brass });

  // The crane that takes the horn's weight off the needle: a post, an arm, and a chain to a collar.
  const CRX = -1.38;
  const CRZ = -0.78;
  rod(P.iron, PHO.iron, [CRX, BY, CRZ], [CRX, 4.8, CRZ], 0.045, { sides: 10 });
  P.metal.push({ geometry: spin([[0, 0], [0.12, 0], [0.12, 0.03], [0.07, 0.06], [0.055, 0.12], [0, 0.13]], { segments: 14 }).translate(CRX, BY + 0.02, CRZ), color: PHO.brass });
  // The collar is placed by asking the horn's own curve where it is at this height, and the chain
  // hangs behind the horn, so nothing can come through into the throat.
  const hornCurve = new THREE.CatmullRomCurve3(hornPts.map(vec), false, 'catmullrom', 0.5);
  let tCollar = 0.5;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    if (hornCurve.getPointAt(t).y >= 3.72) { tCollar = t; break; }
  }
  const cp = hornCurve.getPointAt(tCollar);
  const collarR = hornR(tCollar) + 0.012;
  const COLLAR = [cp.x, cp.y, cp.z];
  const chainZ = RZ - 0.98;
  const armEnd = [cp.x, 4.92, chainZ];
  pipe(P.iron, PHO.iron, [[CRX, 4.72, CRZ], [CRX + 0.1, 4.92, CRZ], [mix(CRX, armEnd[0], 0.5), 5.0, mix(CRZ, chainZ, 0.5)], armEnd], 0.032, { sides: 8, steps: 18 });
  dot(P.metal, PHO.brass, 0.05, [CRX, 4.8, CRZ], { sides: 10 });
  P.metal.push({ geometry: ringGeo(collarR, 0.02, { segments: 22, sides: 6 }).translate(COLLAR[0], COLLAR[1], COLLAR[2]), color: PHO.brass });
  rod(P.metal, PHO.brass, [cp.x, cp.y, cp.z - collarR], [cp.x, cp.y + 0.03, chainZ], 0.016, { sides: 6 });
  for (let i = 0; i < 9; i++) {
    const y = mix(armEnd[1] - 0.03, cp.y + 0.04, i / 8);
    const ring = new THREE.TorusGeometry(0.038, 0.009, 5, 8);
    if (i % 2) ring.rotateY(Math.PI / 2);
    P.metal.push({ geometry: ring, color: PHO.nickel, position: [armEnd[0], y, chainZ] });
  }

  // ----- The governor: three brass balls on leaf springs, which fly out and brake the motor -----------
  const GZ = -0.76;
  const GY = 1.64;
  const GX0 = -0.82;
  const GX1 = -0.2;
  rod(P.metal, PHO.steel, [GX0 - 0.42, GY, GZ], [GX1 + 0.15, GY, GZ], 0.022, { sides: 8 });
  for (const x of [GX0 - 0.3, GX1 + 0.13]) {
    bar(P.iron, PHO.iron, [x, BY, GZ], [x, GY + 0.05, GZ], 0.1, 0.09, { up: [1, 0, 0], chamfer: 0.012 });
    P.metal.push({ geometry: onX(ringGeo(0.04, 0.016, { segments: 12, sides: 5 })).translate(x, GY, GZ), color: PHO.brass });
  }
  for (const x of [GX0, GX1]) {
    P.metal.push({ geometry: onX(spin([[0, -0.03], [0.055, -0.03], [0.06, 0], [0.055, 0.03], [0, 0.03]], { segments: 12 })).translate(x, GY, GZ), color: PHO.brass });
  }
  const BALL = 0.095;
  const OUT = 0.27;
  for (let i = 0; i < 3; i++) {
    const a = 0.5 + (i / 3) * Math.PI * 2;
    const dy = Math.cos(a);
    const dz = Math.sin(a);
    const xm = (GX0 + GX1) / 2;
    pipe(P.metal, PHO.steel, [
      [GX0, GY + dy * 0.05, GZ + dz * 0.05], [mix(GX0, xm, 0.5), GY + dy * OUT * 0.7, GZ + dz * OUT * 0.7], [xm, GY + dy * OUT, GZ + dz * OUT],
      [mix(GX1, xm, 0.5), GY + dy * OUT * 0.7, GZ + dz * OUT * 0.7], [GX1, GY + dy * 0.05, GZ + dz * 0.05],
    ], 0.014, { sides: 5, steps: 16, round: 0 });
    dot(P.metal, PHO.brassPale, BALL, [xm, GY + dy * OUT, GZ + dz * OUT], { sides: 16 });
  }
  // The belt, as the true tangent loop between the governor's small pulley and the mandrel's large one.
  const BX = -1.2;
  const Rg = 0.1;
  const Rm = 0.25;
  const pulley = (y, z, r) => P.metal.push({
    geometry: onX(spin([[0, -0.05], [r + 0.012, -0.05], [r + 0.012, -0.036, 'h'], [r - 0.018, 0, 'h'], [r + 0.012, 0.036, 'h'], [r + 0.012, 0.05], [0, 0.05]], { segments: 28 })).translate(BX, y, z),
    color: PHO.brass,
  });
  pulley(GY, GZ, Rg);
  pulley(CY, CZ, Rm);
  {
    // The two outer tangents of two circles, from the angle set by their centres and their radii.
    const dz = CZ - GZ;
    const dy = CY - GY;
    const D = Math.hypot(dz, dy);
    const base = Math.atan2(dy, dz);
    const beta = Math.acos((Rg - Rm) / D);
    const loop = [];
    const beltR = (r) => r - 0.008;
    const arc = (cy, cz, r, a0, a1, n) => {
      for (let i = 0; i <= n; i++) {
        const a = mix(a0, a1, i / n);
        loop.push([BX, cy + Math.sin(a) * beltR(r), cz + Math.cos(a) * beltR(r)]);
      }
    };
    arc(GY, GZ, Rg, base + beta, base + (Math.PI * 2 - beta), 10);
    arc(CY, CZ, Rm, base - beta, base + beta, 18);
    loop.push(loop[0]);
    pipe(P.iron, PHO.belt, loop, 0.018, { sides: 6, steps: 80, round: 0 });
  }

  // ----- The crank and its brass escutcheon, on the right of the case -------------------------------
  const KY = 0.68;
  P.metal.push({ geometry: onX(spin([[0, -0.02], [0.16, -0.02], [0.17, 0.0], [0.16, 0.03], [0.07, 0.05], [0, 0.05]], { segments: 18 })).translate(CW + 0.02, KY, 0), color: PHO.brass });
  rod(P.iron, PHO.iron, [CW, KY, 0], [CW + 0.38, KY, 0], 0.036, { sides: 10 });
  const armA = [CW + 0.38, KY, 0];
  const armB = [CW + 0.38, KY + 0.46, 0.12];
  bar(P.iron, PHO.iron, armA, armB, 0.05, 0.08, { up: [0, 0, 1], chamfer: 0.012 });
  dot(P.iron, PHO.iron, 0.056, armA, { sides: 10 });
  dot(P.iron, PHO.iron, 0.05, armB, { sides: 10 });
  rod(P.iron, PHO.iron, armB, [armB[0] + 0.12, armB[1], armB[2]], 0.024, { sides: 8 });
  P.wood.push({
    geometry: swapUV(onX(spin([[0, -0.02], [0.055, -0.02], [0.075, 0.05], [0.065, 0.14], [0.075, 0.22], [0.05, 0.28], [0, 0.29]], { segments: 14 }))).translate(armB[0] + 0.1, armB[1], armB[2]),
    color: PHO.oakDark,
  });

  // ----- The bentwood lid, standing open behind: a real shell with two end boards --------------------
  const HY = CH + 0.14;
  const HZ = -CD - 0.04;
  const LID_W = CW + 0.03;
  const LID_D = 2 * CD + 0.08;
  const RISE = 1.32;
  const lidAngle = -THREE.MathUtils.degToRad(103);
  const lidM = new THREE.Matrix4().makeTranslation(0, HY, HZ).multiply(new THREE.Matrix4().makeRotationX(lidAngle));
  // In the lid's own frame: its back edge on the hinge, running +Z to its front edge.
  const arch = (u) => {
    const a = Math.PI * u;
    // A superellipse, so the barrel has shoulders rather than being a half pipe.
    const k = 2.7;
    const cx = Math.cos(a);
    const sx = Math.sin(a);
    return [LID_D / 2 - (Math.sign(cx) * Math.abs(cx) ** (2 / k)) * LID_D / 2, Math.abs(sx) ** (2 / k) * RISE];
  };
  const shell = solidSurface({
    nu: 26,
    nv: 3,
    point: (u, v) => {
      const [z, y] = arch(u);
      return [(2 * v - 1) * LID_W, y, z];
    },
    thick: () => 0.03,
  });
  scaleUV(shell, 3.2, 2.2);
  P.wood.push({ geometry: shell.applyMatrix4(lidM), color: PHO.oak });
  for (const s of [-1, 1]) {
    const outline = [];
    for (let i = 0; i <= 18; i++) { const [z, y] = arch(i / 18); outline.push([z, y - 0.012]); }
    const g = crisp(extrudeOutline(outline, 0.06)).rotateY(-Math.PI / 2);
    g.translate(s * (LID_W - 0.03), 0, 0);
    P.wood.push({ geometry: outward(g).applyMatrix4(lidM), color: PHO.oakDark });
  }
  // A band round the skirt of the lid, the strap handle, the hinges, and a brass stay holding it up.
  const lidP = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(lidM).toArray();
  bar(P.wood, PHO.oakDark, lidP(-LID_W, 0.03, LID_D - 0.03), lidP(LID_W, 0.03, LID_D - 0.03), 0.07, 0.1, { ...woodOpts, chamfer: 0.012 });
  bar(P.wood, PHO.oakDark, lidP(-LID_W, 0.03, 0.03), lidP(LID_W, 0.03, 0.03), 0.07, 0.1, { ...woodOpts, chamfer: 0.012 });
  for (const s of [-1, 1]) {
    const x = s * 1.05;
    rod(P.metal, PHO.brass, [x - 0.14, HY, HZ - 0.01], [x + 0.14, HY, HZ - 0.01], 0.026, { sides: 8 });
    block(P.metal, PHO.brass, 0.26, 0.15, 0.012, [x, HY - 0.07, HZ + 0.03]);
  }
  const stayA = [CW - 0.06, CH + 0.08, -0.36];
  const stayB = lidP(LID_W - 0.1, 0.3, LID_D * 0.46);
  rod(P.metal, PHO.brassPale, stayA, stayB, 0.018, { sides: 6 });
  dot(P.metal, PHO.brass, 0.036, stayA);
  dot(P.metal, PHO.brass, 0.036, stayB);
  // The clasp on the case's front that the lid latches to.
  block(P.metal, PHO.brass, 0.2, 0.15, 0.02, [0, CH - 0.03, CD + 0.05]);
  rod(P.metal, PHO.brassPale, [-0.06, CH + 0.05, CD + 0.06], [0.06, CH + 0.05, CD + 0.06], 0.018, { sides: 6 });

  // ----- A maker's transfer on the front, gold leaf on the varnish: alpha-cut, so no box behind it ------
  const decalTex = canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e8bf58';
    ctx.strokeStyle = '#e8bf58';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 150;
    for (; size > 40; size -= 4) {
      ctx.font = `700 ${size}px Georgia, 'Times New Roman', serif`;
      if (ctx.measureText('EDISON').width < w * 0.72) break;
    }
    ctx.fillText('EDISON', w / 2, h * 0.47);
    ctx.lineWidth = 7;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + s * w * 0.38, h * 0.47);
      ctx.bezierCurveTo(w / 2 + s * w * 0.42, h * 0.25, w / 2 + s * w * 0.47, h * 0.3, w / 2 + s * w * 0.46, h * 0.5);
      ctx.bezierCurveTo(w / 2 + s * w * 0.45, h * 0.72, w / 2 + s * w * 0.41, h * 0.72, w / 2 + s * w * 0.4, h * 0.56);
      ctx.stroke();
    }
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.87);
    ctx.lineTo(w * 0.8, h * 0.87);
    ctx.stroke();
  });
  const decal = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.45, 0.002).translate(0, 0.62, CD + 0.009),
    new THREE.MeshStandardMaterial({ map: decalTex, alphaTest: 0.4, roughness: 0.42, metalness: 0 }),
  );
  decal.castShadow = false;
  decal.receiveShadow = true;

  const iron = mergeParts(P.iron);
  sheen(iron, { add: 0.055 });
  return groupOf(
    meshFrom(mergeParts(P.wood), { roughness: 0.4, metalness: 0, ...grainMaps({ seed: 77, knots: 1, strength: 0.32, streaks: 170 }) }),
    meshFrom(iron, { roughness: 0.3, metalness: 0 }),
    meshFrom(sheen(mergeParts(P.metal), { gain: 0.45 }), { roughness: 0.34, metalness: 0.45 }),
    meshFrom(mergeParts(P.wax), { roughness: 0.42, metalness: 0, ...grooveMaps() }),
    decal,
  );
}

function scaleUV(g, ku, kv) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
  return g;
}

// ---------------------------------------------------------------------------
// Watt beam engine: a rotative engine of the 1780s, a large working-style model
// ---------------------------------------------------------------------------
//
// THE WHOLE MACHINE IS ONE SOLVED INSTANT, drawn from `wattMotion(crank angle)`. The planet wheel is
// placed on its orbit, the beam's end is the one point a connecting rod's length from it and a beam's
// length from the pivot, and everything left of the pivot follows from the beam's angle through
// Watt's parallel motion. So the rods really are one length, and a teacher can trace the drive.
//
// Parallel motion: B1 and B2 are on the beam, D1 and D2 hang from them on equal links, and D1-D2 is
// parallel to the beam. A radius rod from the fixed point F holds D1. With beam arm a to B1, and a
// further b to B2, a radius rod of a*a/b makes the piston end D2 run nearly straight up and down
// (the pantograph with the Watt linkage inside it). The air pump's rod hangs from X, on the back link.

const WATT = {
  green: 0x1e4b30,
  greenDark: 0x143522,
  red: 0xa02a1c,
  iron: 0x1b1d1f,
  brass: 0xd2a43e,
  brassPale: 0xe9ca74,
  copper: 0xb9673a,
  lag: 0x8c5426,
  lagDark: 0x5e3717,
  water: 0x1c4a5c,
  stone: 0xa89c86,
  stoneDark: 0x8d826d,
  belt: 0x4e2e15,
};

const circleCut = (A, ra, B, rb, near) => {
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const d = Math.hypot(dx, dy);
  const t = (ra * ra - rb * rb + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, ra * ra - t * t));
  const mx = A[0] + (dx / d) * t;
  const my = A[1] + (dy / d) * t;
  const c1 = [mx - (dy / d) * h, my + (dx / d) * h];
  const c2 = [mx + (dy / d) * h, my - (dx / d) * h];
  return Math.hypot(c1[0] - near[0], c1[1] - near[1]) < Math.hypot(c2[0] - near[0], c2[1] - near[1]) ? c1 : c2;
};

export function wattMotion(phi) {
  const PV = [0, 14]; // beam pivot
  const L = 8; // pivot to each beam end
  const A = 3.2; // pivot to the back link
  const B = L - A;
  const RADIUS = (A * A) / B;
  const H = 3; // length of the hanging links
  const C = [8, 7.3]; // flywheel shaft
  const RC = 1.6; // orbit of the planet: sun pitch + planet pitch
  const ROD = 6.7; // connecting rod
  const F = [-(A + RADIUS), PV[1] - H]; // the fixed end of the radius rod
  const Q = [C[0] + RC * Math.cos(phi), C[1] + RC * Math.sin(phi)];
  const E = circleCut(PV, L, Q, ROD, [L, PV[1]]);
  const theta = Math.atan2(E[1] - PV[1], E[0] - PV[0]);
  const on = (d) => [PV[0] + d * Math.cos(theta), PV[1] + d * Math.sin(theta)];
  const B1 = on(-A);
  const B2 = on(-L);
  const D1 = circleCut(B1, H, F, RADIUS, [-A, PV[1] - H]);
  const D2 = [D1[0] + (B2[0] - B1[0]), D1[1] + (B2[1] - B1[1])];
  const k = A / L;
  const X = [PV[0] + (D2[0] - PV[0]) * k, PV[1] + (D2[1] - PV[1]) * k];
  return { PV, L, A, B, RADIUS, H, C, RC, ROD, F, Q, E, theta, on, B1, B2, D1, D2, X };
}

// A closed solid of revolution about +Y whose UVs do not wrap backwards across the last strip, and
// whose seam is at the back. Used only where a map has to run round something.
function lathedUV(profile, segments, uTiles, vPerFoot) {
  const n = profile.length;
  const pos = [];
  const uvs = [];
  const idx = [];
  for (let c = 0; c <= segments; c++) {
    const a = Math.PI + ((c % segments) / segments) * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      pos.push(Math.sin(a) * profile[i][0], profile[i][1], Math.cos(a) * profile[i][0]);
      uvs.push((c / segments) * uTiles, profile[i][1] * vPerFoot);
    }
  }
  for (let c = 0; c < segments; c++) {
    for (let i = 0; i < n - 1; i++) {
      const a = c * n + i;
      const b = (c + 1) * n + i;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// A box of dressed stone whose map is laid in FEET from where it stands, so courses line up from one
// block to the next.
function stoneBlock(list, color, w, h, d, cx, cy, cz) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const U = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i);
    const y = P.getY(i);
    const z = P.getZ(i);
    if (Math.abs(N.getY(i)) > 0.5) U.setXY(i, x / 8, z / 8);
    else if (Math.abs(N.getZ(i)) > 0.5) U.setXY(i, x / 8, y / 8);
    else U.setXY(i, z / 8, y / 8);
  }
  list.push({ geometry: g, color });
}

function masonryMaps() {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(1769);
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(0, 0, S, S);
  const COURSES = 6; // an 8ft tile, so a course is 1ft 4in
  const h = S / COURSES;
  for (let j = 0; j < COURSES; j++) {
    const blocks = 3;
    const w = S / blocks;
    const shift = (j % 2) * w * 0.5;
    for (let i = 0; i <= blocks; i++) {
      const x = i * w + shift - w;
      const v = 214 + Math.round(rng() * 38);
      for (const dx of [0, S]) {
        ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        ctx.fillRect(x + dx, j * h, w, h);
        ctx.fillStyle = '#6b6252';
        ctx.fillRect(x + dx, j * h, 3, h);
      }
    }
    ctx.fillStyle = '#6b6252';
    ctx.fillRect(0, j * h, S, 3);
  }
  for (let i = 0; i < 1600; i++) {
    const v = 150 + Math.round(rng() * 90);
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 16},0.3)`;
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 3);
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: 0.8 };
}

function wattSteamEngine() {
  const rng = seededRandom(1788);
  const S = { paint: [], metal: [], wood: [], stone: [] };
  const M = wattMotion(THREE.MathUtils.degToRad(28));
  const { PV, L, C, RC, Q, E, theta, on, B1, B2, D1, D2, X, F } = M;
  const DECK = 1.25;
  const CX = -L; // the cylinder's axis is the parallel motion's design line, x = -L
  const p3 = (p, z = 0) => [p[0], p[1], z];
  const pin = (p, z0, z1, r, color = WATT.brass) => {
    rod(S.metal, color, [p[0], p[1], z0], [p[0], p[1], z1], r, { sides: 12 });
  };
  const flat = { up: [0, 0, 1], chamfer: 0.012 };

  // ----- The stone foundation ---------------------------------------------------------------------
  const XL = -10.6;
  const XR = 13.6;
  const XM = (XL + XR) / 2;
  stoneBlock(S.stone, WATT.stoneDark, XR - XL + 0.5, 0.62, 7.7, XM, 0.31, 0);
  stoneBlock(S.stone, WATT.stone, XR - XL, DECK - 0.62, 7.2, XM, (DECK + 0.62) / 2, 0);
  bar(S.stone, WATT.stoneDark, [XL - 0.06, DECK - 0.03, 3.65], [XR + 0.06, DECK - 0.03, 3.65], 0.12, 0.08);
  bar(S.stone, WATT.stoneDark, [XL - 0.06, DECK - 0.03, -3.65], [XR + 0.06, DECK - 0.03, -3.65], 0.12, 0.08);
  // Pier under the cylinder, and the pier that carries the crankshaft.
  const CYL_BASE = 3.5;
  stoneBlock(S.stone, WATT.stone, 3.5, CYL_BASE - DECK, 3.3, CX, (CYL_BASE + DECK) / 2, 0);
  stoneBlock(S.stone, WATT.stone, 2.6, 5.4, 0.9, C[0], DECK + 2.7, -1.05);

  // ----- The beam, tilted by the solved angle: a fish-bellied iron girder, lined in red -------------
  const beamM = new THREE.Matrix4().makeRotationZ(theta);
  beamM.setPosition(PV[0], PV[1], 0);
  const fishBelly = (k, overhang = 0.42) => {
    const pts = [];
    const end = L + overhang;
    for (let i = 0; i <= 24; i++) {
      const x = end - (i / 24) * 2 * end;
      pts.push([x, k * (0.34 + 0.86 * (1 - (x / end) ** 2))]);
    }
    for (let i = 0; i <= 24; i++) {
      const x = -end + (i / 24) * 2 * end;
      pts.push([x, -k * (0.34 + 0.86 * (1 - (x / end) ** 2))]);
    }
    return pts;
  };
  const beamPart = (list, outline, depth, zoff, color) => {
    const g = crisp(extrudeOutline(outline, depth));
    g.translate(0, 0, zoff);
    list.push({ geometry: g.applyMatrix4(beamM), color });
  };
  beamPart(S.paint, fishBelly(1), 0.5, 0, WATT.green);
  beamPart(S.paint, fishBelly(0.8, 0.0), 0.53, 0, WATT.red);
  beamPart(S.paint, fishBelly(0.66, -0.25), 0.56, 0, WATT.green);
  // A row of rivets along each edge of the girder.
  for (let i = -7; i <= 7; i++) {
    if (i === 0) continue;
    const x = i * 1.04;
    const hd = 0.34 + 0.86 * (1 - (x / (L + 0.42)) ** 2);
    for (const s of [-1, 1]) {
      for (const z of [-0.29, 0.29]) {
        const q = new THREE.Vector3(x, s * hd * 0.9, z).applyMatrix4(beamM);
        dot(S.metal, WATT.brass, 0.042, q.toArray(), { sides: 6 });
      }
    }
  }
  // The trunnion: the great pivot, in brass bearings on top of the frame.
  rod(S.metal, WATT.brass, [PV[0], PV[1], -1.5], [PV[0], PV[1], 1.5], 0.2, { sides: 18 });
  for (const s of [-1, 1]) {
    S.paint.push({ geometry: onZ(spin([[0, -0.05], [0.5, -0.05], [0.56, 0], [0.5, 0.05], [0, 0.05]], { segments: 22 })).translate(PV[0], PV[1], s * 0.3), color: WATT.red });
    S.metal.push({ geometry: onZ(spin([[0, -0.04], [0.22, -0.04], [0.26, 0], [0.22, 0.04], [0, 0.04]], { segments: 14 })).translate(PV[0], PV[1], s * 0.36), color: WATT.brassPale });
  }

  // ----- The frame: two iron A-frames, tied, with the entablature that holds the radius rods ---------
  const FZ = 1.15;
  for (const s of [-1, 1]) {
    const z = s * FZ;
    const legW = 0.34;
    const apex = [PV[0], PV[1] - 0.5, z];
    for (const dx of [-1, 1]) {
      const foot = [dx * 3.1, DECK, z];
      bar(S.paint, WATT.green, foot, apex, legW, 0.3, { up: [0, 0, 1], chamfer: 0.035 });
      S.paint.push({ geometry: new THREE.BoxGeometry(0.9, 0.22, 0.6), color: WATT.greenDark, position: [foot[0], DECK + 0.11, z] });
    }
    // Girders across the legs at two heights, each lined in red.
    for (const [y, half] of [[5.2, 2.25], [9.6, 1.0]]) {
      bar(S.paint, WATT.green, [-half, y, z], [half, y, z], 0.26, 0.24, { up: [0, 0, 1], chamfer: 0.02 });
      bar(S.paint, WATT.red, [-half + 0.1, y, z + s * 0.125], [half - 0.1, y, z + s * 0.125], 0.09, 0.012, { up: [0, 0, 1] });
    }
    // Diagonals between the two girders, which is what stiffens an A-frame against the beam's thrust.
    for (const dx of [-1, 1]) {
      bar(S.paint, WATT.greenDark, [dx * 1.92, 5.2, z], [-dx * 1.0, 9.6, z], 0.15, 0.14, { up: [0, 0, 1], chamfer: 0.015 });
    }
    // The bearing on the apex.
    bar(S.paint, WATT.green, [-0.62, PV[1] - 0.32, z], [0.62, PV[1] - 0.32, z], 0.42, 0.42, { chamfer: 0.04 });
    bar(S.metal, WATT.brass, [-0.42, PV[1] + 0.26, z], [0.42, PV[1] + 0.26, z], 0.42, 0.12, { chamfer: 0.03 });
    S.metal.push({ geometry: onZ(spin([[0, -0.21], [0.3, -0.21], [0.3, 0.21], [0, 0.21]], { segments: 16 })).translate(PV[0], PV[1], z), color: WATT.brass });
    for (const dx of [-0.32, 0.32]) rod(S.metal, WATT.brassPale, [dx, PV[1] - 0.1, z], [dx, PV[1] + 0.36, z], 0.04, { sides: 6 });

    // A classical iron column and an entablature, carrying F, the radius rod's fixed end.
    const colX = F[0];
    const topY = F[1] + 0.35;
    S.paint.push({
      geometry: spin([
        [0, DECK], [0.5, DECK], [0.5, DECK + 0.18, 'h'], [0.36, DECK + 0.26], [0.3, DECK + 0.5], [0.27, (DECK + topY) / 2], [0.23, topY - 0.55], [0.23, topY - 0.36], [0.33, topY - 0.25], [0.46, topY - 0.08, 'h'], [0, topY - 0.08],
      ], { segments: 20 }).translate(colX, 0, z),
      color: WATT.green,
    });
    S.paint.push({ geometry: ringGeo(0.255, 0.035, { segments: 18, sides: 5, y: topY - 0.42 }).translate(colX, 0, z), color: WATT.red });
    S.paint.push({ geometry: ringGeo(0.33, 0.035, { segments: 18, sides: 5, y: DECK + 0.3 }).translate(colX, 0, z), color: WATT.red });
    bar(S.paint, WATT.green, [colX - 0.55, topY, z], [-1.1, topY, z], 0.32, 0.3, { up: [0, 0, 1], chamfer: 0.03 });
    bar(S.paint, WATT.red, [colX - 0.4, topY, z + s * 0.155], [-1.25, topY, z + s * 0.155], 0.09, 0.012, { up: [0, 0, 1] });
    // The bracket out to F.
    bar(S.paint, WATT.greenDark, [colX, topY - 0.12, z], [colX, F[1], s * 0.56], 0.2, 0.2, { chamfer: 0.02 });
  }
  // Ties across the two frames.
  for (const [x, y] of [[0, 5.2], [F[0], 9.75]]) {
    bar(S.paint, WATT.green, [x, y, -FZ], [x, y, FZ], 0.2, 0.2, { chamfer: 0.02 });
  }

  // ----- Parallel motion, read straight off the solved points ---------------------------------------
  for (const s of [-1, 1]) {
    const zLink = s * 0.42;
    const zRad = s * 0.62;
    // Hanging links from the beam to the parallel bar.
    bar(S.paint, WATT.red, p3(B2, zLink), p3(D2, zLink), 0.17, 0.07, flat);
    bar(S.paint, WATT.red, p3(B1, zLink), p3(D1, zLink), 0.17, 0.07, flat);
    // The parallel bar itself, just inside them.
    bar(S.paint, WATT.green, p3(D1, zLink), p3(D2, zLink), 0.16, 0.07, flat);
    // The radius rod from F to D1.
    bar(S.paint, WATT.red, p3(F, zRad), p3(D1, zRad), 0.15, 0.07, flat);
    dot(S.metal, WATT.brass, 0.13, p3(D1, zRad), { sides: 10 });
  }
  for (const [p, r, zz] of [[B1, 0.08, 0.5], [B2, 0.1, 0.5], [D1, 0.08, 0.68], [D2, 0.11, 0.5], [X, 0.06, 0.48]]) pin(p, -zz, zz, r);
  for (const s of [-1, 1]) pin(F, s * 0.56, s * 0.7, 0.1);

  // ----- Cylinder, in mahogany lagging with brass hoops ---------------------------------------------
  const CYL_TOP = 8.4;
  const CR = 1.2;
  S.wood.push({
    geometry: lathedUV([[0, CYL_BASE + 0.18], [CR, CYL_BASE + 0.18], [CR, CYL_TOP - 0.15], [0, CYL_TOP - 0.15]], 56, 4, 0.34),
    color: WATT.lag,
    position: [CX, 0, 0],
  });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    rod(S.paint, 0x3a2110, [CX + Math.sin(a) * (CR + 0.003), CYL_BASE + 0.2, Math.cos(a) * (CR + 0.003)], [CX + Math.sin(a) * (CR + 0.003), CYL_TOP - 0.2, Math.cos(a) * (CR + 0.003)], 0.012, { sides: 3 });
  }
  for (const y of [CYL_BASE + 0.9, (CYL_BASE + CYL_TOP) / 2, CYL_TOP - 0.85]) {
    S.metal.push({ geometry: spin([[CR - 0.02, y - 0.09], [CR + 0.025, y - 0.09], [CR + 0.035, y], [CR + 0.025, y + 0.09], [CR - 0.02, y + 0.09]], { segments: 48, closed: true }).translate(CX, 0, 0), color: WATT.brass });
  }
  // Flanges and the bolted cover, with the stuffing box the piston rod comes through.
  S.paint.push({
    geometry: spin([[0, CYL_BASE - 0.02], [CR + 0.3, CYL_BASE - 0.02], [CR + 0.3, CYL_BASE + 0.14, 'h'], [CR + 0.04, CYL_BASE + 0.2], [0, CYL_BASE + 0.2]], { segments: 48 }).translate(CX, 0, 0),
    color: WATT.green,
  });
  S.paint.push({
    geometry: spin([
      [0, CYL_TOP - 0.22], [CR + 0.04, CYL_TOP - 0.22], [CR + 0.26, CYL_TOP - 0.14, 'h'], [CR + 0.26, CYL_TOP, 'h'], [CR - 0.06, CYL_TOP + 0.03], [0.9, CYL_TOP + 0.18], [0.42, CYL_TOP + 0.3], [0.32, CYL_TOP + 0.36], [0, CYL_TOP + 0.36],
    ], { segments: 48 }).translate(CX, 0, 0),
    color: WATT.green,
  });
  S.metal.push({
    geometry: spin([[0, CYL_TOP + 0.3], [0.28, CYL_TOP + 0.3], [0.28, CYL_TOP + 0.44, 'h'], [0.34, CYL_TOP + 0.44, 'h'], [0.34, CYL_TOP + 0.52, 'h'], [0.19, CYL_TOP + 0.54, 'h'], [0.19, CYL_TOP + 0.72, 'h'], [0.1, CYL_TOP + 0.74], [0, CYL_TOP + 0.74]], { segments: 22 }).translate(CX, 0, 0),
    color: WATT.brass,
  });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    dot(S.metal, WATT.brassPale, 0.06, [CX + Math.sin(a) * (CR + 0.14), CYL_TOP + 0.01, Math.cos(a) * (CR + 0.14)], { sides: 6, flat: 0.6 });
    dot(S.metal, WATT.brassPale, 0.06, [CX + Math.sin(a) * (CR + 0.14), CYL_BASE + 0.15, Math.cos(a) * (CR + 0.14)], { sides: 6, flat: 0.6 });
  }
  // The piston rod: bright steel from D2 straight down through the gland. Its x is D2's own.
  rod(S.metal, 0xcfd3d6, p3(D2, 0), [D2[0], CYL_TOP + 0.5, 0], 0.09, { sides: 14 });
  dot(S.metal, WATT.brass, 0.18, p3(D2, 0), { sides: 12 });

  // Valve chest on the side of the cylinder facing the pivot: an upper and a lower nozzle, with the
  // tube between, and a plug rod from the beam whose tappets worked the valves.
  const VX = CX + CR + 0.34;
  for (const y of [CYL_TOP - 0.55, CYL_BASE + 0.65]) {
    bar(S.paint, WATT.green, [VX - 0.3, y, 0], [VX + 0.2, y, 0], 0.86, 0.72, { up: [0, 1, 0], chamfer: 0.05 });
    S.metal.push({ geometry: onZ(spin([[0, -0.03], [0.22, -0.03], [0.24, 0], [0.2, 0.03], [0, 0.04]], { segments: 14 })).translate(VX, y, 0.44), color: WATT.brass });
  }
  S.metal.push({ geometry: spin([[0, 4.1], [0.22, 4.1], [0.22, 4.25, 'h'], [0.16, 4.25, 'h'], [0.16, 7.7, 'h'], [0.22, 7.7, 'h'], [0.22, 7.85], [0, 7.85]], { segments: 14 }).translate(VX, 0, 0), color: WATT.copper });
  const PLUG = 5.9;
  const plugTop = on(-PLUG);
  const plugLow = 5.35;
  rod(S.metal, WATT.brass, p3(plugTop, 0), [plugTop[0], plugLow, 0], 0.045, { sides: 8 });
  dot(S.metal, WATT.brass, 0.1, p3(plugTop, 0.0), { sides: 8 });
  pin(plugTop, -0.32, 0.32, 0.06);
  bar(S.paint, WATT.greenDark, [plugTop[0], 5.55, 0], [VX + 0.15, 5.55, 0], 0.1, 0.06, { chamfer: 0.012 });
  for (const y of [CYL_TOP - 0.55, CYL_BASE + 0.65]) {
    const pegY = y + 0.5;
    if (pegY < plugLow) continue;
    rod(S.metal, WATT.brass, [plugTop[0], pegY, 0], [VX + 0.1, pegY - 0.25, 0], 0.03, { sides: 6 });
    dot(S.metal, WATT.brassPale, 0.075, [plugTop[0], pegY, 0], { sides: 8 });
  }

  // ----- The separate condenser: Watt's own idea, and what the whole engine exists to show ----------
  // A cold tank, with the condenser and the air pump standing in it, and a pipe from the cylinder.
  const TX0 = -6.05;
  const TX1 = -2.05;
  const TZ = 0.92;
  const TT = 3.3;
  for (const s of [-1, 1]) {
    bar(S.wood, WATT.lagDark, [TX0, (DECK + TT) / 2, s * TZ], [TX1, (DECK + TT) / 2, s * TZ], 0.14, TT - DECK, { tile: [1.2, 2], rng, up: [0, 1, 0] });
    bar(S.wood, WATT.lagDark, [s > 0 ? TX1 : TX0, (DECK + TT) / 2, -TZ - 0.07], [s > 0 ? TX1 : TX0, (DECK + TT) / 2, TZ + 0.07], 0.14, TT - DECK, { tile: [1.2, 2], rng, up: [0, 1, 0] });
  }
  for (const y of [DECK + 0.45, TT - 0.35]) {
    for (const s of [-1, 1]) {
      bar(S.paint, WATT.iron, [TX0 - 0.09, y, s * (TZ + 0.08)], [TX1 + 0.09, y, s * (TZ + 0.08)], 0.03, 0.14);
      bar(S.paint, WATT.iron, [s > 0 ? TX1 + 0.08 : TX0 - 0.08, y, -TZ - 0.09], [s > 0 ? TX1 + 0.08 : TX0 - 0.08, y, TZ + 0.09], 0.03, 0.14);
    }
  }
  S.paint.push({ geometry: new THREE.BoxGeometry(TX1 - TX0, 0.06, 2 * TZ), color: WATT.water, position: [(TX0 + TX1) / 2, TT - 0.2, 0] });
  const CONX = -4.85;
  S.metal.push({
    geometry: spin([[0, DECK], [0.62, DECK], [0.62, 4.5], [0.5, 4.8], [0.25, 4.95], [0, 4.98]], { segments: 26 }).translate(CONX, 0, 0),
    color: WATT.copper,
  });
  S.metal.push({ geometry: ringGeo(0.625, 0.04, { segments: 26, sides: 5, y: 4.2 }).translate(CONX, 0, 0), color: WATT.brass });
  // The eduction pipe: spent steam leaves the cylinder's foot and is condensed here, away from the hot
  // cylinder. That is the patent of 1769 in one length of copper.
  pipe(S.metal, WATT.copper, [[CX + CR + 0.04, 4.1, -0.7], [CX + CR + 0.6, 4.25, -0.72], [CONX - 0.3, 4.72, -0.32], [CONX - 0.05, 4.86, -0.05]], 0.15, { sides: 12, steps: 22, round: 1 });
  // Air pump, whose rod hangs from X on the back link.
  S.metal.push({
    geometry: spin([[0, DECK], [0.5, DECK], [0.5, 5.2], [0.58, 5.2, 'h'], [0.58, 5.32, 'h'], [0.14, 5.36, 'h'], [0.14, 5.52], [0, 5.54]], { segments: 22 }).translate(-M.A, 0, 0),
    color: WATT.brass,
  });
  rod(S.metal, 0xcfd3d6, p3(X, 0), [X[0], 5.45, 0], 0.06, { sides: 10 });
  // Connecting pipe between condenser and air pump, under the water line and above it.
  pipe(S.metal, WATT.copper, [[CONX + 0.55, 3.75, 0], [-4.0, 3.9, 0.02], [-3.65, 3.75, 0]], 0.1, { sides: 8, steps: 8, round: 0 });
  // The steam pipe from the boiler off-stage, through a throttle valve, to the top nozzle.
  const SX = VX + 0.05;
  const SZ = 2.5;
  pipe(S.metal, WATT.copper, [[SX, CYL_TOP - 0.55, 0.3], [SX, CYL_TOP - 0.52, SZ - 0.6], [SX, CYL_TOP - 0.92, SZ], [SX, 6.5, SZ], [SX, DECK + 0.1, SZ]], 0.17, { sides: 12, steps: 28, round: 1 });
  S.metal.push({ geometry: spin([[0, DECK], [0.4, DECK], [0.4, DECK + 0.08, 'h'], [0.2, DECK + 0.14], [0, DECK + 0.14]], { segments: 18 }).translate(SX, 0, SZ), color: WATT.brass });
  const TV = 5.9;
  S.paint.push({
    geometry: spin([[0, TV - 0.42], [0.28, TV - 0.42], [0.28, TV - 0.32, 'h'], [0.2, TV - 0.3], [0.34, TV - 0.1], [0.34, TV + 0.1], [0.2, TV + 0.3], [0.28, TV + 0.32, 'h'], [0.28, TV + 0.42], [0, TV + 0.42]], { segments: 18 }).translate(SX, 0, SZ),
    color: WATT.red,
  });

  // ----- The drive: connecting rod, sun and planet, flywheel ------------------------------------------
  const ROD_Z = 0.42;
  // Beam-end gudgeon, a pin through the beam reaching the rod.
  pin(E, -0.38, ROD_Z + 0.16, 0.13);
  // A tapered rod with its bearing brasses, on the very points the solver found.
  pipe(S.paint, WATT.red, [p3(E, ROD_Z), [mix(E[0], Q[0], 0.33), mix(E[1], Q[1], 0.33), ROD_Z], [mix(E[0], Q[0], 0.66), mix(E[1], Q[1], 0.66), ROD_Z], p3(Q, ROD_Z)], [0.09, 0.16, 0.17, 0.11], { sides: 14, steps: 14, round: 1 });
  S.metal.push({ geometry: onZ(spin([[0, -0.12], [0.2, -0.12], [0.2, 0.12], [0, 0.12]], { segments: 16 })).translate(E[0], E[1], ROD_Z), color: WATT.brass });
  // Sun and planet: the shaft makes two turns for each full up-and-down of the beam, because the
  // planet may not turn. The two are placed so a tooth of one is in the gap of the other at their line of centres.
  const phi = Math.atan2(Q[1] - C[1], Q[0] - C[0]);
  const TEETH = 24;
  const PITCH = RC / 2;
  const DEPTH = 0.17;
  const gearOf = (angle, centre) => {
    const g = crisp(extrudeOutline(gearOutline(PITCH + DEPTH / 2, TEETH, { toothDepth: DEPTH }), 0.46));
    g.rotateZ(angle);
    g.translate(centre[0], centre[1], 0);
    S.metal.push({ geometry: g, color: WATT.brass });
  };
  gearOf(phi, C);
  gearOf(phi + Math.PI + Math.PI / TEETH, Q);
  for (const c of [C, Q]) {
    S.paint.push({ geometry: onZ(spin([[0, -0.3], [0.3, -0.3], [0.34, -0.26], [0.34, 0.26], [0.3, 0.3], [0, 0.3]], { segments: 18 })).translate(c[0], c[1], 0), color: WATT.greenDark });
    S.paint.push({ geometry: onZ(ringGeo(0.5, 0.03, { segments: 22, sides: 5, y: 0.235 })).translate(c[0], c[1], 0), color: WATT.red });
    S.paint.push({ geometry: onZ(ringGeo(0.5, 0.03, { segments: 22, sides: 5, y: -0.235 })).translate(c[0], c[1], 0), color: WATT.red });
  }
  // The planet is fast to the rod and may not turn; a link holds it in mesh.
  bar(S.paint, WATT.green, p3(C, -0.36), p3(Q, -0.36), 0.3, 0.08, flat);
  pin(Q, -0.42, ROD_Z + 0.16, 0.13);
  S.metal.push({ geometry: onZ(spin([[0, -0.12], [0.24, -0.12], [0.24, 0.12], [0, 0.12]], { segments: 16 })).translate(Q[0], Q[1], ROD_Z), color: WATT.brass });
  // The shaft, from behind the flywheel to the belt pulley in front.
  const WHEEL_Z = -2.2;
  rod(S.paint, WATT.iron, [C[0], C[1], WHEEL_Z - 0.62], [C[0], C[1], 1.55], 0.2, { sides: 16 });
  // The flywheel: a heavy rim, eight tapered spokes, and a boss each side.
  const FR = 5.2;
  const rimIn = FR - 0.62;
  S.paint.push({
    geometry: onZ(spin([
      [rimIn, -0.26, 'h'], [rimIn + 0.1, -0.3], [FR - 0.04, -0.3, 'h'], [FR, -0.26], [FR, 0.26], [FR - 0.04, 0.3, 'h'], [rimIn + 0.1, 0.3], [rimIn, 0.26, 'h'],
    ], { segments: 96, closed: true })).translate(C[0], C[1], WHEEL_Z),
    color: WATT.green,
  });
  for (const s of [-1, 1]) {
    S.paint.push({ geometry: onZ(ringGeo(FR - 0.3, 0.026, { segments: 96, sides: 4, y: s * 0.3 })).translate(C[0], C[1], WHEEL_Z), color: WATT.red });
  }
  S.paint.push({
    geometry: onZ(spin([[0, -0.46], [0.42, -0.46], [0.56, -0.34], [0.72, -0.24], [0.72, 0.24], [0.56, 0.34], [0.42, 0.46], [0, 0.46]], { segments: 28 })).translate(C[0], C[1], WHEEL_Z),
    color: WATT.red,
  });
  const spoke = solidLoft([
    { d: 0.5, w: 0.3, h: 0.17, round: 0.7 },
    { d: 1.2, w: 0.23, h: 0.14, round: 0.8 },
    { d: rimIn - 0.3, w: 0.15, h: 0.1, round: 0.8 },
    { d: rimIn + 0.08, w: 0.2, h: 0.12, round: 0.7 },
  ], { sides: 12, samples: 5 });
  for (let i = 0; i < 8; i++) {
    // Authored along +Z; a spin about the shaft, then laid into the wheel's plane by baked matrix.
    const a = phi + (i / 8) * Math.PI * 2;
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(-Math.sin(a), Math.cos(a), 0),
      new THREE.Vector3(Math.cos(a), Math.sin(a), 0),
    );
    // That basis is left-handed if written carelessly, so its determinant is measured.
    const g = spoke.clone();
    if (m.determinant() < 0) m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-Math.sin(a), Math.cos(a), 0), new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
    m.setPosition(C[0], C[1], WHEEL_Z);
    S.paint.push({ geometry: g.applyMatrix4(m), color: WATT.green });
  }
  // Bearings: a brass cap on the stone pier behind, and an iron A-standard in front, whose open legs
  // leave the gears on view.
  const bearing = (z) => {
    S.metal.push({ geometry: onZ(spin([[0, -0.24], [0.34, -0.24], [0.36, -0.2], [0.36, 0.2], [0.34, 0.24], [0, 0.24]], { segments: 18 })).translate(C[0], C[1], z), color: WATT.brass });
    dot(S.metal, WATT.brassPale, 0.09, [C[0], C[1] + 0.42, z], { sides: 8 });
  };
  bearing(-1.05);
  bearing(1.05);
  bar(S.paint, WATT.green, [C[0] - 0.75, C[1] - 0.6, -1.05], [C[0] + 0.75, C[1] - 0.6, -1.05], 0.7, 0.42, { chamfer: 0.04 });
  S.paint.push({ geometry: new THREE.BoxGeometry(0.5, 0.42, 0.42), color: WATT.green, position: [C[0], C[1] - 0.3, -1.05] });
  for (const dx of [-1, 1]) {
    bar(S.paint, WATT.green, [C[0] + dx * 1.75, DECK, 1.05], [C[0] + dx * 0.18, C[1] - 0.25, 1.05], 0.3, 0.26, { up: [0, 0, 1], chamfer: 0.03 });
    S.paint.push({ geometry: new THREE.BoxGeometry(0.8, 0.2, 0.6), color: WATT.greenDark, position: [C[0] + dx * 1.75, DECK + 0.1, 1.05] });
  }
  bar(S.paint, WATT.green, [C[0] - 1.05, 4.0, 1.05], [C[0] + 1.05, 4.0, 1.05], 0.22, 0.2, { up: [0, 0, 1], chamfer: 0.02 });
  bar(S.paint, WATT.greenDark, [C[0] - 0.35, C[1] - 0.25, 1.05], [C[0] + 0.35, C[1] - 0.25, 1.05], 0.3, 0.4, { chamfer: 0.03 });

  // ----- The flying-ball governor: if the engine runs fast the balls fly out and close the throttle ---
  const GX = 4.7;
  const GZ = 2.5;
  const PIVOT = 8.0;
  // Belt from the shaft's pulley down to the countershaft's, as a true tangent loop.
  const BZ = 1.5;
  const Ra = 0.44;
  const Rb = 0.3;
  const LOW = [GX, 3.35];
  const pulleyZ = (c, r) => {
    S.paint.push({
      geometry: onZ(spin([[0, -0.1], [r + 0.012, -0.1], [r, -0.07, 'h'], [r - 0.03, 0, 'h'], [r, 0.07, 'h'], [r + 0.012, 0.1], [0, 0.1]], { segments: 26 })).translate(c[0], c[1], BZ),
      color: WATT.greenDark,
    });
    S.metal.push({ geometry: onZ(spin([[0, 0.08], [0.13, 0.08], [0.13, 0.14, 'h'], [0.09, 0.2], [0, 0.21]], { segments: 12 })).translate(c[0], c[1], BZ), color: WATT.brass });
  };
  pulleyZ(C, Ra);
  pulleyZ(LOW, Rb);
  {
    const dx = C[0] - LOW[0];
    const dy = C[1] - LOW[1];
    const D = Math.hypot(dx, dy);
    const base = Math.atan2(dy, dx);
    const beta = Math.acos((Rb - Ra) / D);
    const loop = [];
    const arc = (c, r, a0, a1, n) => {
      for (let i = 0; i <= n; i++) {
        const a = mix(a0, a1, i / n);
        loop.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, BZ]);
      }
    };
    arc(LOW, Rb - 0.01, base + beta, base + Math.PI * 2 - beta, 8);
    arc(C, Ra - 0.01, base - beta, base + beta, 14);
    loop.push(loop[0]);
    pipe(S.paint, WATT.belt, loop, 0.03, { sides: 6, steps: 60, round: 0, section: () => [0.4, 1.6] });
  }
  // Countershaft on a standard, to a pair of bevels at the foot of the spindle.
  rod(S.paint, WATT.iron, [LOW[0], LOW[1], BZ], [LOW[0], LOW[1], GZ - 0.2], 0.06, { sides: 10 });
  bar(S.paint, WATT.green, [LOW[0], DECK, BZ + 0.34], [LOW[0], LOW[1] + 0.1, BZ + 0.34], 0.2, 0.18, { up: [0, 0, 1], chamfer: 0.02 });
  bar(S.paint, WATT.green, [GX, DECK, GZ], [GX, 2.92, GZ], 0.4, 0.4, { chamfer: 0.04 });
  S.paint.push({ geometry: new THREE.BoxGeometry(1.0, 0.16, 1.0), color: WATT.greenDark, position: [GX, DECK + 0.08, GZ] });
  S.metal.push({ geometry: onZ(spin([[0, -0.1], [0.13, -0.1], [0.28, 0.1], [0, 0.1]], { segments: 18 })).translate(GX, LOW[1], GZ - 0.3), color: WATT.brass });
  S.metal.push({ geometry: spin([[0, -0.1], [0.28, -0.1], [0.13, 0.1], [0, 0.1]], { segments: 18 }).translate(GX, LOW[1] + 0.12, GZ), color: WATT.brass });
  // The spindle, with its head, and the two arms set at the angle the balls have flown to.
  const SPIN_TOP = PIVOT + 0.42;
  rod(S.metal, 0xcfd3d6, [GX, LOW[1] + 0.2, GZ], [GX, SPIN_TOP, GZ], 0.05, { sides: 10 });
  S.metal.push({ geometry: spin([[0, PIVOT - 0.12], [0.1, PIVOT - 0.12], [0.11, PIVOT + 0.3], [0.13, PIVOT + 0.36], [0.08, PIVOT + 0.46], [0, PIVOT + 0.5]], { segments: 12 }).translate(GX, 0, GZ), color: WATT.brass });
  const ARM = 1.72;
  const LEAN = THREE.MathUtils.degToRad(29);
  const SLEEVE = PIVOT - 2 * (ARM * 0.5) * Math.cos(LEAN);
  for (const s of [-1, 1]) {
    const ball = [GX + s * ARM * Math.sin(LEAN), PIVOT - ARM * Math.cos(LEAN), GZ];
    const mid = [GX + (s * ARM * 0.5) * Math.sin(LEAN), PIVOT - (ARM * 0.5) * Math.cos(LEAN), GZ];
    rod(S.metal, WATT.iron, [GX, PIVOT, GZ], ball, 0.042, { sides: 8 });
    dot(S.metal, WATT.brass, 0.38, ball, { sides: 20 });
    rod(S.metal, WATT.iron, mid, [GX, SLEEVE, GZ], 0.03, { sides: 6 });
    dot(S.metal, WATT.iron, 0.05, mid, { sides: 6 });
  }
  dot(S.metal, WATT.iron, 0.07, [GX, PIVOT, GZ], { sides: 8 });
  S.metal.push({ geometry: spin([[0, SLEEVE - 0.24], [0.13, SLEEVE - 0.24], [0.13, SLEEVE - 0.12, 'h'], [0.18, SLEEVE - 0.12, 'h'], [0.18, SLEEVE - 0.04, 'h'], [0.11, SLEEVE - 0.03], [0.1, SLEEVE + 0.1], [0, SLEEVE + 0.1]], { segments: 14 }).translate(GX, 0, GZ), color: WATT.brass });
  // The bell crank that reads the sleeve, and the long rod to the throttle.
  const CRANK_X = GX - 1.0;
  const CRANK_Y = SLEEVE - 0.18;
  bar(S.paint, WATT.green, [CRANK_X, DECK, GZ], [CRANK_X, CRANK_Y - 0.1, GZ], 0.16, 0.16, { chamfer: 0.02 });
  rod(S.metal, WATT.iron, [GX, SLEEVE - 0.08, GZ], [CRANK_X, CRANK_Y, GZ], 0.035, { sides: 6 });
  dot(S.metal, WATT.brass, 0.065, [CRANK_X, CRANK_Y, GZ]);
  rod(S.metal, WATT.iron, [CRANK_X, CRANK_Y, GZ], [SX + 0.42, TV, SZ], 0.035, { sides: 6 });
  dot(S.metal, WATT.brass, 0.06, [SX + 0.42, TV, SZ]);
  rod(S.metal, WATT.iron, [SX + 0.42, TV, SZ], [SX, TV, SZ], 0.03, { sides: 6 });

  const paint = sheen(mergeParts(S.paint), { add: 0.022, gain: 0.5 });
  const shift = (g) => g.translate(-XM, 0, 0);
  return groupOf(
    meshFrom(shift(paint), { roughness: 0.4, metalness: 0 }),
    meshFrom(shift(sheen(mergeParts(S.metal), { gain: 0.5 })), { roughness: 0.34, metalness: 0.45 }),
    meshFrom(shift(mergeParts(S.wood)), { roughness: 0.42, metalness: 0, ...grainMaps({ seed: 1788, knots: 1, strength: 0.28, streaks: 140 }) }),
    meshFrom(shift(mergeParts(S.stone)), { roughness: 0.92, metalness: 0, ...masonryMaps() }),
  );
}

export const BUILDERS = {
  'model-t-ford': modelTFord,
  'penny-farthing': pennyFarthing,
  'montgolfier-balloon': montgolfierBalloon,
  'edison-phonograph': edisonPhonograph,
  'watt-steam-engine': wattSteamEngine,
};
