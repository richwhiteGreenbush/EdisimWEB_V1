import * as THREE from 'three';
import { seededRandom } from '../../PropKit.js';
import {
  solidLoft, solidSurface, sweepProfile, extrudeOutline, revolve, gearWheel, mergeParts,
  placed, outlineArea, roundedOutline, weldSeam,
} from '../../props/LoftKit.js';

// The Model Database's machines. Three objects a student reads from six feet, and all three are
// mostly THIN MEMBERS, which is the thing every helper below is about:
//
//   steam-locomotive  an American 4-4-0 of the 1860s, half life size.
//   wright-flyer      the 1903 Flyer at true size; the catalogue shows it at 0.6.
//   printing-press    a wooden common press, life size.
//
// House rules are LoftKit's and PropKit's: feet at scale 1, origin at the base centre, +Z forward,
// fresh materials per build, seededRandom only.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A surface of revolution about +Y from `[r, y]` or `[r, y, 'h']` points, which must close: either
// a loop (`closed: true`) or a run that starts and ends on the axis.
//
// `revolve` picks its winding from the profile's direction and comes out inside out if that
// direction is the natural bottom-up one, so the direction is measured here rather than
// remembered. A point flagged 'h' is doubled: the zero-length band between the copies adds nothing
// to computeVertexNormals, so the two sides keep their own normals and the edge stays a hard arris
// instead of being smoothed into a pillow.
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

// Those zero-length bands and the triangles collapsed onto the axis cost real index space and draw
// nothing, so they are taken out once the normals have been computed.
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

function pipe(list, color, points, r, { sides = 7, tubular = null, caps = true } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map(vec));
  list.push({ geometry: new THREE.TubeGeometry(curve, tubular ?? points.length * 4, r, sides, false), color });
  if (caps) {
    for (const p of [points[0], points[points.length - 1]]) {
      list.push({ geometry: new THREE.SphereGeometry(r * 1.03, sides, Math.max(3, sides >> 1)), color, position: p });
    }
  }
}

function block(list, color, w, h, d, pos, rot = null) {
  list.push({ geometry: new THREE.BoxGeometry(w, h, d), color, position: pos, rotation: rot });
}

function dot(list, color, r, pos, { sides = 6, flat = null, up = null } = {}) {
  const g = new THREE.SphereGeometry(r, sides, Math.max(3, sides >> 1));
  if (flat) g.scale(1, flat, 1);
  if (up) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(up).normalize()));
  list.push({ geometry: g, color, position: pos });
}

// A rivet head: a shallow five-sided cone, sunk in up to its rim. A smooth-shaded cone reads as a
// dome at any distance a rivet is readable from, for five triangles rather than twenty.
function rivet(list, color, r, pos, up) {
  const g = new THREE.ConeGeometry(r, r * 0.8, 5, 1, true);
  g.translate(0, r * 0.3, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(up).normalize()));
  list.push({ geometry: g, color, position: pos });
}

// Bakes every shared vertex apart so each face keeps its own normal: a rod or a sawn plate has
// arrises, and smooth shading across them is what makes machined iron read as soap.
function crisp(g) {
  const out = g.index ? g.toNonIndexed() : g;
  out.computeVertexNormals();
  return out;
}

// A squared timber, authored along Z: 4 or 8 sides, each face flat, end grain darker than the
// faces. The UVs are in tile units with the grain running along the length, so one tall canvas
// serves every timber in a model, and each piece starts somewhere different in it.
function beamGeo(len, w, h, { chamfer = 0, tile = [1, 2], color, rng = null, capShade = 0.6, jitter = 0.07 }) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const outline = c > 0
    ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
    : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const u0 = rng ? rng() : 0;
  const v0 = rng ? rng() : 0;
  const k = rng ? 1 + (rng() - 0.5) * jitter * 2 : 1;
  const base = new THREE.Color(color);
  const side = [base.r * k, base.g * k, base.b * k];
  const cap = [side[0] * capShade, side[1] * capShade, side[2] * capShade];
  const pos = [];
  const nor = [];
  const uvs = [];
  const col = [];
  const tri = (a, b, cc, n, tone, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
    for (let i = 0; i < 3; i++) col.push(...tone);
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
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1], n, side, [ua, va], [ub, va], [ub, vb]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1], n, side, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  for (let i = 1; i < outline.length - 1; i++) {
    const [ax, ay] = outline[0];
    const [bx, by] = outline[i];
    const [cx, cy] = outline[i + 1];
    const uv = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
    tri([ax, ay, z1], [bx, by, z1], [cx, cy, z1], [0, 0, 1], cap, uv(ax, ay), uv(bx, by), uv(cx, cy));
    tri([ax, ay, z0], [cx, cy, z0], [bx, by, z0], [0, 0, -1], cap, uv(ax, ay), uv(cx, cy), uv(bx, by));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Carries a Z-authored geometry to lie from a to b, with its local +Y as close to `up` as the
// direction allows. A proper rotation, so nothing turns inside out.
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

// A squared timber from a to b. `w` runs across, `h` runs along `up`.
function timber(list, color, a, b, w, h, opts = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  const g = beamGeo(len, w, h, { color, ...opts });
  list.push({ geometry: fromTo(g, a, b, opts.up), keepColor: true });
}

// The same for painted iron and other stuff with no grain map; the UVs simply go unused.
function strip(list, color, a, b, w, h, opts = {}) {
  timber(list, color, a, b, w, h, { capShade: 0.85, jitter: 0, ...opts });
}

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour,
// so one canvas serves every wood in a model. A texel of 150 is 30% of the colour in linear, not
// 59%, so nothing here goes much below 165.
function grainMaps({ seed = 3, knots = 3, strength = 0.5, width = 256, height = 512, streaks = 150 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(0, 0, width, height);
  const wrapX = (draw) => { for (const dx of [-width, 0, width]) draw(dx); };
  // Broad colour drift between the fine lines: real board is never one tone across its width.
  for (let i = 0; i < 26; i++) {
    const x = rng() * width;
    const w = 6 + rng() * 34;
    const shade = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${shade},${shade - 8},${shade - 18},0.42)`;
    wrapX((dx) => ctx.fillRect(x + dx, 0, w, height));
  }
  // Each streak wanders by a whole number of cycles down the tile, so the top meets the bottom.
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
  // Knots, kept in from the edges rather than wrapped.
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

function meshOf(parts, params) {
  if (!parts.length) return null;
  const m = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function groupOf(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// Fits a line of text into a width by measuring it, and returns the font size it settled on.
function fitFont(ctx, text, maxWidth, start, family) {
  let size = start;
  for (; size > 8; size -= 2) {
    ctx.font = `${family.replace('%', `${size}px`)}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

// ---------------------------------------------------------------------------
// The locomotive: an American 4-4-0 of the 1860s at half life size
// ---------------------------------------------------------------------------
//
// THE RODS ARE A REAL MECHANISM, solved rather than drawn. A crank pin is placed by its angle, the
// crosshead by the one point on the cylinder's own line that is exactly one main rod away from that
// pin, and the piston rod runs from there into the cylinder -- so the drawing is a true instant of
// the machine and a teacher can trace how the piston turns the wheel. The two sides are quartered
// 90 degrees apart, as they must be, or the engine could stall with both cranks on dead centre.

const LOCO = {
  iron: 0x20262c,
  jacket: 0x2a3a4a,
  black: 0x16181b,
  smoke: 0x2b2d30,
  vermilion: 0xc23a22,
  crimson: 0x8e1f1c,
  gold: 0xd9ae44,
  brass: 0xd6a944,
  brassPale: 0xe6c774,
  steel: 0xa8afb6,
  tire: 0x5d6268,
  oak: 0x9c6b3c,
  varnish: 0xb77a35,
  buff: 0xc9b58a,
  yellow: 0xd9a92f,
};

// `x` is the wheel's centre plane. Everything is authored about a lathe's +Y, which is the wheel's
// OUTER face, and carried out by one rotation per side, so the detail cannot end up facing inboard.
function locoWheel(P, {
  R, flange = 0.06, width = 0.3, spokes = 16, hub = 0.24, x, z, side, segments = 56,
  crank = null, weight = false, centre = LOCO.vermilion, webbed = false,
}) {
  const axleY = R + flange;
  const M = new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2);
  M.setPosition(x, axleY, z);
  const add = (list, geometry, color) => { list.push({ geometry: geometry.applyMatrix4(M), color }); };
  const w = width / 2;
  const rimIn = R * 0.87;

  add(P.paint, spin([
    [rimIn, -w, 'h'], [R + flange, -w, 'h'], [R + flange, -w + 0.05], [R + 0.006, -w + 0.1, 'h'],
    [R, w - 0.02, 'h'], [R - 0.022, w, 'h'], [rimIn, w, 'h'],
  ], { segments, closed: true }), LOCO.tire);
  if (!webbed) add(P.paint, spin([
    [rimIn - 0.12, -w * 0.6, 'h'], [rimIn + 0.02, -w * 0.6, 'h'], [rimIn + 0.02, w * 0.72, 'h'],
    [rimIn - 0.095, w * 0.72], [rimIn - 0.12, w * 0.5, 'h'],
  ], { segments, closed: true }), centre);
  if (!webbed) add(P.metal, spin([
    [rimIn - 0.058, w * 0.7, 'h'], [rimIn - 0.03, w * 0.7, 'h'], [rimIn - 0.03, w * 0.72 + 0.008, 'h'], [rimIn - 0.058, w * 0.72 + 0.008, 'h'],
  ], { segments, closed: true }), LOCO.gold);

  // Hub, sunk through the spoke roots from one side of the wheel to the other.
  const hubSegs = 16;
  add(P.paint, spin([
    [0, -w * 0.85], [hub * 0.9, -w * 0.85, 'h'], [hub, -w * 0.55], [hub, w * 0.25], [hub * 0.86, w * 0.5], [hub * 0.62, w * 0.86, 'h'], [0, w * 0.86],
  ], { segments: hubSegs }), centre);
  add(P.metal, spin([
    [0, w * 0.8], [hub * 0.5, w * 0.8], [hub * 0.5, w * 0.98, 'h'], [hub * 0.3, w * 1.06], [0, w * 1.09],
  ], { segments: 10 }), LOCO.brass);

  // Spokes run radially on local +Z and are turned about the wheel's axis. Oval and flared at both
  // ends, because a real spoke was cast into its hub and its rim, and a parallel rod reads as a
  // bicycle.
  const base = crank ? crank.a : 0;
  const spoke = solidLoft([
    { d: hub * 0.72, w: 0.085 * (R / 1.375 + 0.25), h: 0.07 },
    { d: hub + 0.12, w: 0.054 * (R / 1.375 + 0.25), h: 0.046 },
    { d: rimIn - 0.2, w: 0.05 * (R / 1.375 + 0.25), h: 0.044 },
    { d: rimIn - 0.06, w: 0.08 * (R / 1.375 + 0.25), h: 0.058 },
  ], { sides: 6, samples: 3 });
  for (let i = 0; i < spokes; i++) {
    const a = base + (i / spokes) * Math.PI * 2;
    add(P.paint, placed(spoke, { rot: [0, a, 0] }), centre);
  }
  if (webbed) {
    // A cast plate between hub and rim, for the small tender wheels.
    add(P.paint, spin([
      [hub * 0.8, -w * 0.25, 'h'], [rimIn + 0.01, -w * 0.25, 'h'], [rimIn + 0.01, w * 0.55, 'h'], [rimIn - 0.06, w * 0.55], [(hub + rimIn) * 0.55, w * 0.2], [hub * 0.8, w * 0.42, 'h'],
    ], { segments, closed: true }), centre);
  }

  if (weight) {
    // The counterweight balancing the crank and rods, cast in between the spokes opposite the pin.
    const pts = [];
    const span = 0.78;
    for (let i = 0; i <= 12; i++) {
      const t = base + Math.PI - span + (i / 12) * span * 2;
      pts.push([Math.sin(t) * (rimIn - 0.06), Math.cos(t) * (rimIn - 0.06)]);
    }
    for (let i = 8; i >= 0; i--) {
      const t = base + Math.PI - span * 0.8 + (i / 8) * span * 1.6;
      pts.push([Math.sin(t) * rimIn * 0.56, Math.cos(t) * rimIn * 0.56]);
    }
    add(P.paint, crisp(extrudeOutline(pts, width * 0.46).rotateX(Math.PI / 2)), centre);
  }
  if (crank) {
    // The crank boss is a thick spoke with a round end, and the pin stands out of that.
    const reach = crank.r;
    const arm = solidLoft([
      { d: hub * 0.4, w: 0.17, h: 0.08 },
      { d: reach * 0.6, w: 0.125, h: 0.085 },
      { d: reach + 0.05, w: 0.14, h: 0.09 },
    ], { sides: 12, samples: 6 });
    add(P.paint, placed(arm, { pos: [0, w * 0.5, 0], rot: [0, base, 0] }), centre);
    const px = Math.sin(base) * reach;
    const pz = Math.cos(base) * reach;
    add(P.paint, placed(spin([
      [0, w * 0.2], [0.16, w * 0.2, 'h'], [0.16, w * 0.8], [0.12, w * 0.5 + 0.1, 'h'], [0, w * 0.5 + 0.1],
    ], { segments: 18 }), { pos: [px, 0, pz] }), centre);
    add(P.metal, placed(spin([
      [0, 0.04], [0.058, 0.04, 'h'], [0.058, crank.pinOut, 'h'], [0.082, crank.pinOut, 'h'], [0.082, crank.pinOut + 0.05], [0.05, crank.pinOut + 0.075], [0, crank.pinOut + 0.08],
    ], { segments: 12 }), { pos: [px, 0, pz] }), LOCO.steel);
  }
  return axleY;
}

// A tapered, flat-sided connecting rod from a to b at a fixed x, with its big end and little end
// bosses. Convex, so extrudeOutline's centre fan caps it; the bosses are separate solids that
// overlap the shaft, because a dumbbell outline is not star-shaped about its middle.
function connectingRod(list, boss, x, a, b, hA, hB, thick, rA, rB) {
  const dz = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dz, dy);
  const belly = (hA + hB) * 0.5 * 1.12;
  const pts = [
    [0, -hA], [len * 0.5, -belly], [len, -hB], [len, hB], [len * 0.5, belly], [0, hA],
  ];
  const g = crisp(extrudeOutline(pts, thick));
  const ex = new THREE.Vector3(0, dy / len, dz / len);
  const ey = new THREE.Vector3(0, dz / len, -dy / len);
  if (ey.y < 0) ey.negate();
  const ez = new THREE.Vector3().crossVectors(ex, ey);
  const m = new THREE.Matrix4().makeBasis(ex, ey, ez);
  m.setPosition(x, a[1], a[0]);
  list.push({ geometry: g.applyMatrix4(m), color: LOCO.steel });
  rod(list, LOCO.steel, [x - thick * 0.72, a[1], a[0]], [x + thick * 0.72, a[1], a[0]], rA, { sides: 16 });
  rod(list, LOCO.steel, [x - thick * 0.72, b[1], b[0]], [x + thick * 0.72, b[1], b[0]], rB, { sides: 16 });
  // Bronze bearing brasses let into each end, and an oil cup on top of each, which the fireman
  // filled by hand at every stop.
  for (const [p, r] of [[a, rA], [b, rB]]) {
    rod(boss, LOCO.brass, [x - thick * 0.76, p[1], p[0]], [x + thick * 0.76, p[1], p[0]], r * 0.62, { sides: 12 });
    rod(boss, LOCO.brass, [x, p[1] + r * 0.9, p[0]], [x, p[1] + r + 0.07, p[0]], 0.03, { sides: 6 });
  }
}

function steamLocomotive() {
  const rng = seededRandom(1869);
  const P = { paint: [], metal: [], wood: [], glass: [], sign: [] };
  const woodOpts = { tile: [0.9, 1.8], rng };

  const BY = 3.92; // boiler centre
  const WX = 1.18; // wheel plane: a 4ft 8.5in gauge at half size
  const DR = 1.36; // driver tread radius
  const DF = 0.06;
  const driverY = DR + DF;
  const DZ = [2.95, -1.05]; // driving axles
  const CRANK = 0.5; // a 24in stroke at half size
  const COUPLE_OUT = 0.235; // coupling rod plane, out from the wheel's centre plane
  const MAIN_OUT = 0.345; // main rod plane
  const CYL = { z: 8.85, y: 2.08 };

  // ----- Boiler ------------------------------------------------------------------------------
  // Three diameters along its length: the black smokebox, the coned barrel in blue planished iron,
  // and the raised "wagon top" over the firebox that gives the steam somewhere to collect.
  const boiler = (geometry, color, list = P.paint) => { list.push({ geometry: geometry.translate(0, BY, 0), color }); };
  boiler(onZ(spin([
    [0, 1.1], [1.06, 1.1, 'h'], [1.0, 8.1, 'h'], [0, 8.1],
  ], { segments: 48 })), LOCO.jacket);
  boiler(onZ(spin([
    [0, 7.95], [1.075, 7.95, 'h'], [1.075, 10.32, 'h'], [1.14, 10.32, 'h'], [1.14, 10.46], [1.1, 10.54, 'h'],
    [0.97, 10.54, 'h'], [0.96, 10.6], [0.72, 10.74], [0.34, 10.82], [0, 10.84],
  ], { segments: 48 })), LOCO.smoke);
  for (const [z, half, r] of [
    [1.25, 0.06, 1.067], [2.55, 0.036, 1.058], [4.05, 0.036, 1.045], [5.55, 0.036, 1.03], [7.05, 0.036, 1.015], [7.98, 0.085, 1.09], [10.53, 0.04, 1.135],
  ]) {
    boiler(onZ(spin([
      [r - 0.03, z - half, 'h'], [r + 0.012, z - half], [r + 0.02, z], [r + 0.012, z + half], [r - 0.03, z + half, 'h'],
    ], { segments: 32, closed: true })), LOCO.brass, P.metal);
  }
  P.paint.push({
    geometry: solidLoft([
      { d: -1.58, w: 1.14, up: 1.3, dn: 1.08, b: BY + 0.04, round: 1 },
      { d: -1.55, w: 1.16, up: 1.33, dn: 1.1, b: BY + 0.04, round: 1 },
      { d: 0.32, w: 1.16, up: 1.33, dn: 1.1, b: BY + 0.04, round: 1 },
      { d: 0.95, w: 1.1, up: 1.15, dn: 1.08, b: BY, round: 1 },
      { d: 1.5, w: 1.03, up: 1.03, dn: 1.03, b: BY, round: 1 },
    ], { sides: 48, samples: 12 }),
    color: LOCO.jacket,
  });
  // Band round the firebox crown, following the loft's own section because a lathe could not.
  const fireBand = (d, thick) => solidLoft([
    { d: d - thick, w: 1.165, up: 1.34, dn: 1.1, b: BY + 0.04, round: 1 },
    { d: d - thick + 0.005, w: 1.18, up: 1.355, dn: 1.12, b: BY + 0.04, round: 1 },
    { d: d + thick - 0.005, w: 1.18, up: 1.355, dn: 1.12, b: BY + 0.04, round: 1 },
    { d: d + thick, w: 1.165, up: 1.34, dn: 1.1, b: BY + 0.04, round: 1 },
  ], { sides: 48, samples: 3 });
  P.metal.push({ geometry: fireBand(-0.45, 0.05), color: LOCO.brass });
  // The lower firebox hangs between the axles, inside the frames.
  P.paint.push({
    geometry: solidLoft([
      { d: -0.62, w: 0.84, up: 1.3, dn: 0.72, b: 2.44, round: 0.28 },
      { d: -0.6, w: 0.86, up: 1.3, dn: 0.74, b: 2.44, round: 0.28 },
      { d: 1.6, w: 0.86, up: 1.3, dn: 0.74, b: 2.44, round: 0.28 },
      { d: 1.62, w: 0.84, up: 1.3, dn: 0.72, b: 2.44, round: 0.28 },
    ], { sides: 28, samples: 3 }),
    color: LOCO.iron,
  });
  // Staybolt heads on the firebox flank.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 2; j++) {
        rivet(P.paint, LOCO.iron, 0.03, [s * 0.86, 1.85 + j * 0.26, -0.42 + i * 0.24], [s, 0, 0]);
      }
    }
  }

  // ----- Smokebox door ----------------------------------------------------------------------
  const door = (geometry, color, list) => list.push({ geometry: geometry.translate(0, BY, 0), color });
  door(onZ(spin([
    [0.76, 10.62, 'h'], [0.82, 10.62], [0.84, 10.72], [0.79, 10.77], [0.72, 10.75, 'h'],
  ], { segments: 40, closed: true })), LOCO.brass, P.metal);
  door(onZ(spin([
    [0, 10.8], [0.09, 10.8, 'h'], [0.09, 10.93, 'h'], [0.13, 10.93], [0.13, 10.97], [0, 10.99],
  ], { segments: 14 })), LOCO.brassPale, P.metal);
  // Two strap hinges on the side the door swings from, in polished brass over the ring.
  for (const s of [1, -1]) {
    strip(P.metal, LOCO.brassPale, [-0.98, BY + s * 0.46, 10.68], [-0.42, BY + s * 0.46, 10.8], 0.05, 0.1, { up: [0, 1, 0], chamfer: 0.01 });
    rod(P.metal, LOCO.iron, [-0.99, BY + s * 0.46 - 0.09, 10.66], [-0.99, BY + s * 0.46 + 0.09, 10.66], 0.035, { sides: 8 });
    dot(P.metal, LOCO.iron, 0.022, [-0.62, BY + s * 0.46, 10.79], { sides: 5 });
  }
  // Rivet ring on the smokebox front.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    rivet(P.paint, LOCO.iron, 0.026, [Math.cos(a) * 1.025, BY + Math.sin(a) * 1.025, 10.54], [0, 0, 1]);
  }

  // ----- Stack: the diamond spark arrester of a wood burner -----------------------------------
  // It is shaped like that to catch sparks. Without it, burning cinders from the wood fire set
  // the prairie alight behind the train.
  const SZ = 9.25;
  P.paint.push({
    geometry: spin([
      [0, BY + 0.7], [0.56, BY + 0.7], [0.55, BY + 1.12], [0.42, BY + 1.26], [0.36, BY + 1.45, 'h'],
      [0.34, BY + 1.5], [0.32, 6.0], [0.42, 6.22], [0.92, 6.82], [1.18, 7.2, 'h'], [1.18, 7.3, 'h'],
      [0.95, 7.62], [0.72, 7.92, 'h'], [0.75, 7.93, 'h'], [0.75, 8.0, 'h'], [0.62, 8.02, 'h'], [0.5, 8.1], [0, 8.14],
    ], { segments: 36 }).translate(0, 0, SZ),
    color: LOCO.smoke,
  });
  for (const [y, half, r] of [[5.45, 0.035, 0.34], [7.25, 0.075, 1.19], [7.97, 0.04, 0.76]]) {
    P.metal.push({
      geometry: spin([
        [r - 0.03, y - half, 'h'], [r + 0.015, y - half, 'h'], [r + 0.015, y + half, 'h'], [r - 0.03, y + half, 'h'],
      ], { segments: 40, closed: true }).translate(0, 0, SZ),
      color: LOCO.brass,
    });
  }

  // ----- Domes, bell, whistle, safety valves -------------------------------------------------
  // A dome's skirt runs down below the boiler's crown: nothing is sitting on the curve, it comes
  // out of it. The sand dome and the steam dome are polished brass casings, which is where most of
  // an American engine's colour was.
  const domeAt = (z, r, h, baseY) => {
    P.metal.push({
      geometry: spin([
        [0, baseY - 0.42], [r + 0.34, baseY - 0.42], [r + 0.28, baseY - 0.16], [r + 0.08, baseY + 0.02], [r, baseY + 0.16, 'h'],
        [r + 0.03, baseY + 0.17, 'h'], [r + 0.03, baseY + 0.22, 'h'], [r, baseY + 0.23, 'h'],
        [r, baseY + h * 0.62, 'h'], [r + 0.03, baseY + h * 0.63, 'h'], [r + 0.03, baseY + h * 0.67, 'h'], [r, baseY + h * 0.68],
        [r * 0.95, baseY + h * 0.78], [r * 0.78, baseY + h * 0.9], [r * 0.46, baseY + h * 0.98], [0, baseY + h],
      ], { segments: 24 }).translate(0, 0, z),
      color: LOCO.brass,
    });
  };
  domeAt(5.1, 0.5, 0.92, BY + 0.98);
  domeAt(1.95, 0.56, 1.14, BY + 1.1);
  // Whistle and pop valves stand on the steam dome, because that is where the driest steam is.
  const crownY = BY + 1.1 + 1.14;
  P.metal.push({
    geometry: spin([
      [0, crownY - 0.06], [0.1, crownY - 0.06], [0.08, crownY + 0.14, 'h'], [0.16, crownY + 0.15, 'h'],
      [0.16, crownY + 0.2, 'h'], [0.05, crownY + 0.21], [0.05, crownY + 0.3, 'h'], [0.095, crownY + 0.31, 'h'],
      [0.095, crownY + 0.62], [0.1, crownY + 0.68, 'h'], [0.06, crownY + 0.76], [0, crownY + 0.8],
    ], { segments: 16 }).translate(-0.2, 0, 1.95),
    color: LOCO.brassPale,
  });
  P.metal.push({
    geometry: spin([
      [0, crownY - 0.06], [0.09, crownY - 0.06], [0.07, crownY + 0.16, 'h'], [0.12, crownY + 0.17], [0.12, crownY + 0.28], [0.05, crownY + 0.34], [0, crownY + 0.36],
    ], { segments: 14 }).translate(0.22, 0, 1.95),
    color: LOCO.brassPale,
  });
  // Bell in a forked iron yoke, on a saddle astride the boiler.
  const BELLZ = 6.75;
  const bellY = BY + 1.62;
  P.metal.push({
    geometry: spin([
      [0, bellY + 0.36], [0.09, bellY + 0.36], [0.16, bellY + 0.3], [0.21, bellY + 0.12], [0.25, bellY - 0.08], [0.35, bellY - 0.26],
      [0.38, bellY - 0.32, 'h'], [0.34, bellY - 0.32, 'h'], [0.21, bellY - 0.1], [0, bellY + 0.02],
    ], { segments: 28 }).translate(0, 0, BELLZ),
    color: LOCO.brass,
  });
  for (const s of [-1, 1]) {
    pipe(P.metal, LOCO.iron, [[s * 0.5, BY + 0.9, BELLZ], [s * 0.5, BY + 1.3, BELLZ], [s * 0.44, bellY + 0.16, BELLZ]], 0.04, { sides: 8 });
  }
  rod(P.metal, LOCO.iron, [-0.46, bellY + 0.16, BELLZ], [0.46, bellY + 0.16, BELLZ], 0.03, { sides: 8 });
  P.paint.push({
    geometry: solidLoft([
      { d: BELLZ - 0.14, w: 0.56, up: 0.12, dn: 0.14, b: BY + 0.9, round: 0.7 },
      { d: BELLZ + 0.14, w: 0.56, up: 0.12, dn: 0.14, b: BY + 0.9, round: 0.7 },
    ], { sides: 18, samples: 1 }),
    color: LOCO.iron,
  });
  strip(P.metal, LOCO.iron, [0.46, bellY + 0.16, BELLZ], [0.86, bellY + 0.42, BELLZ], 0.03, 0.03);

  // ----- Handrails and feed pipe --------------------------------------------------------------
  for (const s of [-1, 1]) {
    const hy = BY + 0.42;
    const hx = (z) => s * (z > 8 ? 1.2 : 1.0 + (8 - z) * 0.0085 + 0.2);
    rod(P.metal, LOCO.brassPale, [hx(9.9), hy, 9.9], [hx(-0.7), hy, -0.7], 0.026, { sides: 8 });
    for (const z of [9.6, 7.6, 5.6, 3.6, 1.6, 0.1]) {
      rod(P.metal, LOCO.brass, [s * 0.92, hy - 0.02, z], [hx(z), hy, z], 0.016, { sides: 6 });
      dot(P.metal, LOCO.brass, 0.038, [hx(z), hy, z], { sides: 8 });
    }
    // Feed pipe from the pump to the brass check valve on the barrel.
    pipe(P.metal, LOCO.brass, [[s * 1.0, BY - 0.62, 1.2], [s * 1.01, BY - 0.6, 3.2], [s * 1.0, BY - 0.46, 4.9], [s * 0.96, BY - 0.26, 5.45]], 0.034, { sides: 8, caps: false });
    P.metal.push({
      geometry: onX(spin([
        [0, 0.7], [0.08, 0.7], [0.08, 0.9, 'h'], [0.11, 0.9, 'h'], [0.11, 1.0, 'h'], [0.06, 1.02], [0, 1.06],
      ], { segments: 12 }), s).translate(0, BY - 0.26, 5.45),
      color: LOCO.brassPale,
    });
  }

  // ----- Running boards ----------------------------------------------------------------------
  const RB = 3.02;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = s * (1.02 + i * 0.3);
      timber(P.wood, LOCO.oak, [x, RB, 10.45], [x, RB, -0.72], 0.285, 0.07, woodOpts);
    }
    strip(P.paint, LOCO.crimson, [s * 1.885, RB - 0.09, 10.45], [s * 1.885, RB - 0.09, -0.72], 0.04, 0.24);
    strip(P.metal, LOCO.gold, [s * 1.908, RB - 0.09, 10.4], [s * 1.908, RB - 0.09, -0.68], 0.012, 0.035);
    strip(P.metal, LOCO.brass, [s * 1.885, RB + 0.04, 10.45], [s * 1.885, RB + 0.04, -0.72], 0.06, 0.022);
    // Brackets from the frame out to the running board.
    for (const z of [9.8, 6.0, 4.8, 0.8]) {
      strip(P.paint, LOCO.iron, [s * 0.9, 2.5, z], [s * 1.8, RB - 0.05, z], 0.05, 0.05, { up: [0, 0, 1] });
    }
    // Front step up to the board.
    strip(P.paint, LOCO.iron, [s * 1.82, RB - 0.1, 10.42], [s * 1.82, 2.45, 10.42], 0.05, 0.03);
    block(P.paint, LOCO.iron, 0.3, 0.035, 0.3, [s * 1.82, 2.45, 10.42]);
  }

  // ----- Frames, pedestals, springs ----------------------------------------------------------
  for (const s of [-1, 1]) {
    const fx = s * 0.92;
    strip(P.paint, LOCO.iron, [fx, 2.62, 10.95], [fx, 2.62, -4.2], 0.14, 0.2, { chamfer: 0.02 });
    strip(P.paint, LOCO.iron, [fx, 0.98, 4.1], [fx, 0.98, -2.1], 0.1, 0.1, { chamfer: 0.012 });
    for (const az of DZ) {
      for (const d of [-0.3, 0.3]) {
        strip(P.paint, LOCO.iron, [fx, 2.62, az + d], [fx, 0.98, az + d * 0.8], 0.12, 0.11, { up: [0, 0, 1], chamfer: 0.012 });
      }
      // A bronze axle box between the jaws, and a stack of leaf spring over it.
      block(P.metal, LOCO.brass, 0.15, 0.44, 0.46, [fx, driverY, az]);
      for (let i = 0; i < 5; i++) {
        const half = 0.82 - i * 0.14;
        block(P.paint, LOCO.black, 0.11, 0.035, half * 2, [fx, 2.24 - i * 0.035, az]);
      }
      block(P.metal, LOCO.iron, 0.13, 0.22, 0.14, [fx, 2.16, az]);
      rod(P.paint, LOCO.black, [fx, 1.92, az], [fx, driverY + 0.2, az], 0.04, { sides: 8 });
    }
    strip(P.paint, LOCO.black, [fx, 2.08, DZ[0] - 0.78], [fx, 2.08, DZ[1] + 0.78], 0.09, 0.14, { chamfer: 0.015 });
  }
  for (const az of DZ) {
    rod(P.paint, LOCO.iron, [-WX, driverY, az], [WX, driverY, az], 0.17, { sides: 14 });
  }
  // Ash pan under the firebox.
  block(P.paint, LOCO.black, 1.5, 0.24, 2.0, [0, 1.62, 0.5]);

  // ----- Drivers and rods ---------------------------------------------------------------------
  const line = {
    az: DZ[0],
    ay: driverY,
    dz: CYL.z - DZ[0],
    dy: CYL.y - driverY,
  };
  const lineLen = Math.hypot(line.dz, line.dy);
  line.ux = line.dz / lineLen;
  line.uy = line.dy / lineLen;
  const MAIN_LEN = 3.62;
  for (const [s, phi] of [[1, 0.46], [-1, 0.46 - Math.PI / 2]]) {
    const localA = -s * phi;
    const wx = s * WX;
    for (const az of DZ) {
      locoWheel(P, {
        R: DR, flange: DF, width: 0.32, spokes: 16, hub: 0.27, x: wx, z: az, side: s, segments: 36,
        crank: { a: localA, r: CRANK, pinOut: MAIN_OUT + 0.075 }, weight: true,
      });
    }
    const pinOf = (az) => [az + Math.cos(phi) * CRANK, driverY + Math.sin(phi) * CRANK];
    const coupleX = s * (WX + COUPLE_OUT);
    connectingRod(P.metal, P.metal, coupleX, pinOf(DZ[1]), pinOf(DZ[0]), 0.085, 0.085, 0.075, 0.145, 0.145);
    // The crosshead: the point on the cylinder's line one main rod away from the pin.
    const pin = pinOf(DZ[0]);
    const px = pin[0] - line.az;
    const py = pin[1] - line.ay;
    const along = px * line.ux + py * line.uy;
    const perp2 = px * px + py * py - along * along;
    const reach = along + Math.sqrt(Math.max(0, MAIN_LEN * MAIN_LEN - perp2));
    const head = [line.az + line.ux * reach, line.ay + line.uy * reach];
    const mx = s * (WX + MAIN_OUT);
    connectingRod(P.metal, P.metal, mx, pin, head, 0.085, 0.055, 0.075, 0.15, 0.09);

    // Crosshead sliding between two guide bars, carrying the piston rod into the cylinder.
    const onLine = (t) => [mx, line.ay + line.uy * t, line.az + line.ux * t];
    const gland = lineLen - 0.74;
    const pOff = (t, off) => [mx, line.ay + line.uy * t + line.ux * off, line.az + line.ux * t - line.uy * off];
    for (const off of [0.14, -0.14]) {
      strip(P.metal, LOCO.steel, pOff(MAIN_LEN - CRANK - 0.5, off), pOff(gland + 0.05, off), 0.1, 0.05, { up: [0, 1, 0], chamfer: 0.008 });
    }
    const headLen = 0.24;
    strip(P.metal, LOCO.brass, pOff(reach - headLen, 0), pOff(reach + headLen, 0), 0.12, 0.23, { up: [0, 1, 0], chamfer: 0.02 });
    rod(P.metal, LOCO.steel, onLine(reach), onLine(gland + 0.1), 0.042, { sides: 12 });
    P.metal.push({
      geometry: alongY(spin([
        [0, -0.12], [0.08, -0.12], [0.1, -0.05, 'h'], [0.12, -0.05, 'h'], [0.12, 0.08], [0, 0.08],
      ], { segments: 12 }), onLine(gland - 0.12), onLine(gland + 0.08)),
      color: LOCO.brassPale,
    });
    // The yoke carrying the rear end of the guides out from the frame.
    const yokeT = MAIN_LEN - CRANK - 0.42;
    strip(P.paint, LOCO.iron, [s * 0.88, line.ay + line.uy * yokeT + 0.26, line.az + line.ux * yokeT], [mx + s * 0.05, line.ay + line.uy * yokeT + 0.2, line.az + line.ux * yokeT], 0.12, 0.34, { chamfer: 0.02 });
    strip(P.paint, LOCO.iron, [mx, line.ay + line.uy * yokeT + 0.36, line.az + line.ux * yokeT], [mx, line.ay + line.uy * yokeT - 0.2, line.az + line.ux * yokeT], 0.13, 0.08);

    // Cylinder, in a planished jacket with polished brass heads and bands.
    const cylinderFrom = onLine(lineLen);
    const cylM = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, line.ux, -line.uy),
      new THREE.Vector3(0, line.uy, line.ux),
    );
    cylM.setPosition(cylinderFrom[0], cylinderFrom[1], cylinderFrom[2]);
    const onCyl = (g) => onZ(g).applyMatrix4(cylM);
    P.paint.push({ geometry: onCyl(spin([[0, -0.7], [0.42, -0.7, 'h'], [0.42, 0.7, 'h'], [0, 0.7]], { segments: 28 })), color: LOCO.jacket });
    for (const [t, half] of [[-0.66, 0.06], [0.66, 0.06], [0, 0.03]]) {
      const big = Math.abs(t) > 0.5 ? 0.46 : 0.43;
      P.metal.push({
        geometry: onCyl(spin([[0.4, t - half, 'h'], [big, t - half, 'h'], [big, t + half, 'h'], [0.4, t + half, 'h']], { segments: 24, closed: true })),
        color: LOCO.brass,
      });
    }
    P.metal.push({
      geometry: onCyl(spin([[0, 0.7], [0.46, 0.7, 'h'], [0.46, 0.76, 'h'], [0.3, 0.77, 'h'], [0.27, 0.83], [0.1, 0.85], [0, 0.855]], { segments: 28 })),
      color: LOCO.brassPale,
    });
    P.metal.push({
      geometry: onCyl(spin([[0, -0.82], [0.14, -0.82], [0.3, -0.76, 'h'], [0.46, -0.76, 'h'], [0.46, -0.7], [0, -0.7]], { segments: 28 })),
      color: LOCO.brassPale,
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const t of [0.76, -0.76]) {
        const local = new THREE.Vector3(Math.cos(a) * 0.39, Math.sin(a) * 0.39, t).applyMatrix4(cylM);
        rivet(P.metal, LOCO.iron, 0.024, [local.x, local.y, local.z], [0, line.uy, line.ux]);
      }
    }
    // Steam chest on top of the cylinder, under its brass cover.
    const chest = new THREE.Vector3(0, 0.5, 0).applyMatrix4(cylM);
    block(P.paint, LOCO.crimson, 0.5, 0.3, 1.02, [chest.x, chest.y, chest.z], [-Math.atan2(line.uy, line.ux), 0, 0]);
    block(P.metal, LOCO.brass, 0.58, 0.06, 1.1, [chest.x, chest.y + 0.17, chest.z], [-Math.atan2(line.uy, line.ux), 0, 0]);
    // Steam pipe from the smokebox down to the chest.
    pipe(P.metal, LOCO.brass, [[s * 0.82, BY - 0.25, CYL.z], [s * 1.12, BY - 0.42, CYL.z], [s * 1.38, BY - 0.92, CYL.z], [chest.x, chest.y + 0.05, chest.z]], 0.085, { sides: 10 });
    // Valve rod and rocker.
    const rockZ = line.az + line.ux * yokeT;
    rod(P.metal, LOCO.steel, [chest.x, chest.y - 0.02, chest.z - 0.5], [mx - s * 0.2, chest.y - 0.32, rockZ + 0.05], 0.022, { sides: 8 });
  }
  // Saddle: the casting that holds the cylinders to the frame and the smokebox on top of them.
  P.paint.push({
    geometry: solidLoft([
      { d: CYL.z - 0.74, w: 1.36, up: 0.72, dn: 0.48, b: 2.28, round: 0.32 },
      { d: CYL.z - 0.72, w: 1.4, up: 0.72, dn: 0.5, b: 2.28, round: 0.32 },
      { d: CYL.z + 0.72, w: 1.4, up: 0.72, dn: 0.5, b: 2.28, round: 0.32 },
      { d: CYL.z + 0.74, w: 1.36, up: 0.72, dn: 0.48, b: 2.28, round: 0.32 },
    ], { sides: 28, samples: 3 }),
    color: LOCO.iron,
  });

  // ----- Leading truck -----------------------------------------------------------------------
  // It swivels on a pin, so the long rigid engine can follow a rough curve. That is the American
  // contribution, and it is why these engines stayed on track laid across a frontier in a hurry.
  const LR = 0.62;
  const LF = 0.05;
  const leadY = LR + LF;
  for (const az of [10.02, 7.68]) {
    for (const s of [-1, 1]) {
      locoWheel(P, { R: LR, flange: LF, width: 0.25, spokes: 9, hub: 0.13, x: s * WX, z: az, side: s, segments: 20 });
      block(P.paint, LOCO.iron, 0.14, 0.3, 0.26, [s * 1.42, leadY, az]);
      dot(P.metal, LOCO.brassPale, 0.07, [s * 1.5, leadY, az], { sides: 10, flat: 0.5, up: [s, 0, 0] });
    }
    rod(P.paint, LOCO.iron, [-1.42, leadY, az], [1.42, leadY, az], 0.075, { sides: 12 });
  }
  for (const s of [-1, 1]) {
    const tx = s * 1.42;
    strip(P.paint, LOCO.iron, [tx, leadY + 0.2, 10.2], [tx, leadY + 0.2, 7.5], 0.06, 0.08);
    strip(P.paint, LOCO.iron, [tx, leadY - 0.16, 10.15], [tx, leadY - 0.34, 9.45], 0.06, 0.06);
    strip(P.paint, LOCO.iron, [tx, leadY - 0.34, 9.45], [tx, leadY - 0.34, 8.25], 0.06, 0.06);
    strip(P.paint, LOCO.iron, [tx, leadY - 0.34, 8.25], [tx, leadY - 0.16, 7.55], 0.06, 0.06);
    strip(P.paint, LOCO.iron, [tx, leadY + 0.2, 9.2], [tx, leadY - 0.34, 9.2], 0.05, 0.07);
    strip(P.paint, LOCO.iron, [tx, leadY + 0.2, 8.5], [tx, leadY - 0.34, 8.5], 0.05, 0.07);
    for (let i = 0; i < 4; i++) block(P.paint, LOCO.black, 0.12, 0.03, 0.9 - i * 0.16, [tx, leadY + 0.3 + i * 0.03, 8.85]);
  }
  strip(P.paint, LOCO.iron, [-1.46, leadY + 0.36, 8.85], [1.46, leadY + 0.36, 8.85], 0.3, 0.18, { up: [0, 1, 0], chamfer: 0.03 });
  rod(P.metal, LOCO.iron, [0, leadY + 0.3, 8.85], [0, 2.0, 8.85], 0.11, { sides: 12 });

  // ----- Pilot (the cowcatcher) --------------------------------------------------------------
  const BEAM = 11.05;
  const beamY = 2.18;
  strip(P.paint, LOCO.vermilion, [-1.82, beamY, BEAM], [1.82, beamY, BEAM], 0.34, 0.5, { chamfer: 0.04 });
  strip(P.metal, LOCO.gold, [-1.72, beamY + 0.15, BEAM + 0.172], [1.72, beamY + 0.15, BEAM + 0.172], 0.012, 0.03);
  strip(P.metal, LOCO.gold, [-1.72, beamY - 0.15, BEAM + 0.172], [1.72, beamY - 0.15, BEAM + 0.172], 0.012, 0.03);
  block(P.metal, LOCO.iron, 0.36, 0.26, 0.2, [0, beamY, BEAM + 0.14]);
  rod(P.metal, LOCO.steel, [0, beamY + 0.22, BEAM + 0.22], [0, beamY - 0.2, BEAM + 0.22], 0.03, { sides: 8 });
  const TIP = [0, 0.22, 12.5];
  const BTM = (s) => [s * 1.72, 0.62, BEAM + 0.08];
  for (const s of [-1, 1]) {
    const N = 9;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const b = lerp3(TIP, BTM(s), t * 0.98 + 0.02);
      const top = [s * (0.06 + t * 1.68), beamY - 0.2, BEAM + 0.14];
      const out = [s * 0.55, 0.34, 0.76];
      timber(P.wood, LOCO.vermilion, b, top, 0.125, 0.06, { ...woodOpts, up: out, chamfer: 0.012 });
    }
    // Lower rail of the V, the slats let into it from above.
    timber(P.wood, LOCO.yellow, TIP, BTM(s), 0.16, 0.13, { ...woodOpts, chamfer: 0.02, up: [0, 1, 0] });
    // Iron band tying the slats together, on the inside.
    const m0 = lerp3(TIP, [0, beamY - 0.2, BEAM + 0.14], 0.55);
    const m1 = lerp3(BTM(s), [s * 1.74, beamY - 0.2, BEAM + 0.14], 0.55);
    strip(P.paint, LOCO.iron, [m0[0], m0[1] - 0.055, m0[2] - 0.045], [m1[0], m1[1] - 0.055, m1[2] - 0.045], 0.05, 0.02, { up: [0, 1, 0] });
    strip(P.paint, LOCO.iron, BTM(s), [s * 1.5, 1.55, BEAM], 0.07, 0.07);
  }
  timber(P.wood, LOCO.vermilion, TIP, [0, beamY - 0.18, BEAM + 0.14], 0.18, 0.14, { ...woodOpts, chamfer: 0.03, up: [0, 0.34, 0.9] });
  strip(P.metal, LOCO.brass, [0, 0.2, 12.52], [0, 0.42, 12.34], 0.2, 0.05, { up: [0, 0.6, 0.8] });
  strip(P.paint, LOCO.iron, TIP, [0, 1.3, BEAM - 0.1], 0.08, 0.08);
  // Flag staffs on the bumper, where a road's signal flags were carried.
  for (const s of [-1, 1]) {
    rod(P.metal, LOCO.brass, [s * 1.55, beamY + 0.2, BEAM], [s * 1.55, beamY + 1.05, BEAM], 0.024, { sides: 8 });
    dot(P.metal, LOCO.brass, 0.05, [s * 1.55, beamY + 1.07, BEAM], { sides: 8 });
  }

  // ----- Headlamp -----------------------------------------------------------------------------
  // A kerosene or oil lamp in a big box. Its light came from a polished reflector behind the flame,
  // which is why the box is so deep.
  const LZ = 10.5;
  const LY = BY + 1.72;
  strip(P.paint, LOCO.iron, [0, BY + 0.9, LZ - 0.25], [0, LY - 0.42, LZ - 0.1], 0.5, 0.1, { up: [0, 0, 1] });
  block(P.paint, LOCO.iron, 1.0, 0.05, 1.22, [0, LY - 0.4, LZ - 0.05]);
  for (const s of [-1, 1]) {
    strip(P.paint, LOCO.iron, [s * 0.42, BY + 0.72, LZ - 0.42], [s * 0.42, LY - 0.4, LZ - 0.42], 0.05, 0.06);
    strip(P.paint, LOCO.iron, [s * 0.44, BY + 0.72, LZ + 0.26], [s * 0.42, LY - 0.4, LZ + 0.38], 0.05, 0.05);
  }
  P.paint.push({
    geometry: solidLoft([
      { d: LZ - 0.62, w: 0.42, h: 0.38, b: LY, round: 0.3 },
      { d: LZ - 0.6, w: 0.44, h: 0.4, b: LY, round: 0.3 },
      { d: LZ + 0.38, w: 0.5, h: 0.45, b: LY + 0.01, round: 0.26 },
      { d: LZ + 0.4, w: 0.48, h: 0.43, b: LY + 0.01, round: 0.26 },
    ], { sides: 24, samples: 3 }),
    color: LOCO.crimson,
  });
  // Lamp front: a brass ring holding a domed lens over a bright reflector.
  const lens = (g) => onZ(g).translate(0, LY + 0.01, LZ);
  P.metal.push({ geometry: lens(spin([[0.34, 0.36, 'h'], [0.44, 0.36, 'h'], [0.44, 0.55], [0.41, 0.58, 'h'], [0.37, 0.58], [0.34, 0.5, 'h']], { segments: 28, closed: true })), color: LOCO.brass });
  P.metal.push({ geometry: lens(spin([[0, 0.42], [0.36, 0.42, 'h'], [0.36, 0.5], [0.2, 0.455], [0.06, 0.43], [0, 0.425]], { segments: 28 })), color: 0xf4e7b4 });
  dot(P.metal, 0xfff4c8, 0.075, [0, LY + 0.01, LZ + 0.5], { sides: 12 });
  P.glass.push({ geometry: lens(spin([[0, 0.5], [0.36, 0.5, 'h'], [0.36, 0.54], [0.2, 0.61], [0, 0.63]], { segments: 28 })), color: 0xfff0c2 });
  // Gold lining on the lamp case, and its hood and chimney.
  for (const s of [-1, 1]) {
    for (const [a, b] of [
      [[s * 0.455, LY + 0.27, LZ - 0.4], [s * 0.487, LY + 0.3, LZ + 0.36]],
      [[s * 0.455, LY - 0.27, LZ - 0.4], [s * 0.487, LY - 0.3, LZ + 0.36]],
      [[s * 0.455, LY - 0.27, LZ - 0.4], [s * 0.455, LY + 0.27, LZ - 0.4]],
      [[s * 0.487, LY - 0.3, LZ + 0.36], [s * 0.487, LY + 0.3, LZ + 0.36]],
    ]) strip(P.metal, LOCO.gold, a, b, 0.016, 0.03);
  }
  P.metal.push({
    geometry: spin([
      [0, LY + 0.3], [0.17, LY + 0.3], [0.17, LY + 0.5], [0.09, LY + 0.58], [0.09, LY + 0.72, 'h'], [0.14, LY + 0.72, 'h'], [0.14, LY + 0.76], [0, LY + 0.8],
    ], { segments: 16 }).translate(0, 0, LZ - 0.14),
    color: LOCO.brass,
  });

  // ----- Cab -----------------------------------------------------------------------------------
  // Varnished wood, because iron would have cooked the crew in summer and frozen them in winter.
  const CF = -0.72; // front wall
  const CR = -4.15; // rear post
  const SIDE_END = -3.5; // the side wall stops here, leaving the way in
  const CX = 1.76;
  const FLOOR = 3.02;
  const EAVE = 6.28;
  const WT = 0.075;
  const WIN_B = 4.32;
  const WIN_S = 5.32; // where the window's arch springs
  const WINS = [[-1.42, 0.5], [-2.6, 0.5]]; // z centre, half width
  const arched = (path, zc, half, bottom, spring) => {
    path.moveTo(zc - half, bottom);
    path.lineTo(zc + half, bottom);
    path.lineTo(zc + half, spring);
    path.absarc(zc, spring, half, 0, Math.PI, false);
    path.lineTo(zc - half, bottom);
    return path;
  };
  const sideWall = new THREE.Shape();
  sideWall.moveTo(SIDE_END, FLOOR - 0.1);
  sideWall.lineTo(CF, FLOOR - 0.1);
  sideWall.lineTo(CF, EAVE);
  sideWall.lineTo(SIDE_END, EAVE);
  sideWall.lineTo(SIDE_END, FLOOR - 0.1);
  for (const [zc, half] of WINS) sideWall.holes.push(arched(new THREE.Path(), zc, half, WIN_B, WIN_S));
  const toSide = (g, s) => g.rotateY(-Math.PI / 2).translate(s > 0 ? CX : -CX + WT, 0, 0);
  const uvFeet = (g, su, sv) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / su + 0.13, uv.getY(i) / sv + 0.37);
    return g;
  };
  for (const s of [-1, 1]) {
    const wall = uvFeet(new THREE.ExtrudeGeometry(sideWall, { depth: WT, bevelEnabled: false, curveSegments: 10 }), 0.9, 1.8);
    P.wood.push({ geometry: toSide(wall, s), color: LOCO.crimson });
    // Lower wall in vertical boards with a shadow line between each: real geometry rather than
    // a drawn line, so the joints catch the sun the way boards do.
    const boards = 15;
    const span = CF - SIDE_END;
    const outer = s * (CX + 0.012);
    for (let i = 0; i < boards; i++) {
      const zz = SIDE_END + ((i + 0.5) / boards) * span;
      timber(P.wood, LOCO.crimson, [outer, FLOOR - 0.08, zz], [outer, 4.14, zz], 0.04, span / boards - 0.016, { ...woodOpts, up: [0, 0, 1], jitter: 0.04 });
    }
    // Sill, belt rail and eave.
    timber(P.wood, LOCO.crimson, [s * (CX + 0.02), 4.2, CF + 0.02], [s * (CX + 0.02), 4.2, SIDE_END - 0.02], 0.09, 0.13, { ...woodOpts, chamfer: 0.015 });
    strip(P.metal, LOCO.gold, [s * (CX + 0.067), 4.2, CF], [s * (CX + 0.067), 4.2, SIDE_END], 0.008, 0.03);
    timber(P.wood, LOCO.crimson, [s * (CX + 0.03), FLOOR - 0.13, CF + 0.02], [s * (CX + 0.03), FLOOR - 0.13, CR - 0.02], 0.12, 0.13, { ...woodOpts, chamfer: 0.015 });
    timber(P.wood, LOCO.crimson, [s * (CX + 0.02), EAVE - 0.03, CF + 0.02], [s * (CX + 0.02), EAVE - 0.03, CR - 0.02], 0.1, 0.11, { ...woodOpts, chamfer: 0.015 });
    strip(P.metal, LOCO.gold, [s * (CX + 0.072), EAVE - 0.05, CF], [s * (CX + 0.072), EAVE - 0.05, CR], 0.008, 0.025);
    // The rear post carrying the roof, and the corner post where the wall ends.
    timber(P.wood, LOCO.crimson, [s * (CX - 0.03), FLOOR - 0.15, CR], [s * (CX - 0.03), EAVE, CR], 0.14, 0.14, { ...woodOpts, chamfer: 0.025 });
    timber(P.wood, LOCO.crimson, [s * (CX - 0.03), FLOOR - 0.15, SIDE_END], [s * (CX - 0.03), EAVE, SIDE_END], 0.14, 0.12, { ...woodOpts, chamfer: 0.02 });
    timber(P.wood, LOCO.crimson, [s * (CX - 0.02), FLOOR - 0.15, CF], [s * (CX - 0.02), EAVE, CF], 0.13, 0.13, { ...woodOpts, chamfer: 0.02 });
    // Grab iron at the way in, and two iron steps hanging below it.
    rod(P.metal, LOCO.brass, [s * (CX + 0.08), 3.4, CR + 0.02], [s * (CX + 0.08), 5.1, CR + 0.02], 0.026, { sides: 8 });
    for (const y of [3.4, 5.1]) rod(P.metal, LOCO.brass, [s * (CX + 0.08), y, CR + 0.02], [s * (CX - 0.02), y, CR + 0.02], 0.018, { sides: 6 });
    const stepZ = (SIDE_END + CR) / 2;
    for (const y of [2.1, 1.25]) block(P.paint, LOCO.iron, 0.36, 0.035, 0.52, [s * 1.82, y, stepZ]);
    for (const d of [-0.24, 0.24]) strip(P.paint, LOCO.iron, [s * 1.82, 2.9, stepZ + d], [s * 1.82, 1.23, stepZ + d], 0.035, 0.05);

    // Window sashes: a varnished arched frame through the wall, standing proud on both faces, with
    // a glazing bar across it and a pane held inside the frame.
    for (const [zc, half] of WINS) {
      const sash = arched(new THREE.Shape(), zc, half + 0.05, WIN_B - 0.05, WIN_S);
      sash.holes.push(arched(new THREE.Path(), zc, half - 0.045, WIN_B + 0.045, WIN_S));
      const g = uvFeet(new THREE.ExtrudeGeometry(sash, { depth: WT + 0.05, bevelEnabled: false, curveSegments: 10 }), 0.9, 1.8);
      P.wood.push({ geometry: g.rotateY(-Math.PI / 2).translate(s > 0 ? CX + 0.025 : -CX + WT + 0.025, 0, 0), color: LOCO.varnish });
      const ring = arched(new THREE.Shape(), zc, half + 0.075, WIN_B - 0.075, WIN_S);
      ring.holes.push(arched(new THREE.Path(), zc, half + 0.052, WIN_B - 0.052, WIN_S));
      const gold = new THREE.ExtrudeGeometry(ring, { depth: 0.012, bevelEnabled: false, curveSegments: 10 });
      P.metal.push({ geometry: gold.rotateY(-Math.PI / 2).translate(s > 0 ? CX + 0.012 : -CX - 0.0, 0, 0), color: LOCO.gold });
      const glassShape = arched(new THREE.Shape(), zc, half - 0.02, WIN_B + 0.02, WIN_S);
      const pane = new THREE.ExtrudeGeometry(glassShape, { depth: 0.012, bevelEnabled: false, curveSegments: 12 });
      P.glass.push({ geometry: pane.rotateY(-Math.PI / 2).translate(s > 0 ? CX - WT / 2 : -CX + WT / 2, 0, 0), color: 0xbfd8dc });
      const wx = s * (CX - WT / 2 + 0.012);
      timber(P.wood, LOCO.varnish, [wx, WIN_S, zc - half], [wx, WIN_S, zc + half], 0.04, 0.05, woodOpts);
      timber(P.wood, LOCO.varnish, [wx, WIN_B, zc], [wx, WIN_S + half - 0.02, zc], 0.04, 0.05, { ...woodOpts, up: [0, 0, 1] });
    }
    // Inside: lining on the wall is the same crimson; a seat box for each of the crew.
    timber(P.wood, LOCO.oak, [s * 1.38, FLOOR + 0.42, -2.3], [s * 1.38, FLOOR + 0.42, -3.35], 0.56, 0.8, { ...woodOpts, chamfer: 0.015 });
    strip(P.paint, 0x5b2a24, [s * 1.38, FLOOR + 0.86, -2.3], [s * 1.38, FLOOR + 0.86, -3.35], 0.6, 0.1, { chamfer: 0.04 });
  }
  // Front wall with the firebox coming through it and a narrow window either side.
  const frontWall = new THREE.Shape();
  frontWall.moveTo(-CX, FLOOR - 0.1);
  frontWall.lineTo(CX, FLOOR - 0.1);
  frontWall.lineTo(CX, EAVE);
  frontWall.lineTo(-CX, EAVE);
  frontWall.lineTo(-CX, FLOOR - 0.1);
  const FWIN = [[-1.45, 0.22], [1.45, 0.22]];
  for (const [xc, half] of FWIN) frontWall.holes.push(arched(new THREE.Path(), xc, half, 4.3, 5.35));
  P.wood.push({
    geometry: uvFeet(new THREE.ExtrudeGeometry(frontWall, { depth: WT, bevelEnabled: false, curveSegments: 12 }), 0.9, 1.8).translate(0, 0, CF - WT / 2),
    color: LOCO.crimson,
  });
  for (const [xc, half] of FWIN) {
    const sash = arched(new THREE.Shape(), xc, half + 0.05, 4.25, 5.35);
    sash.holes.push(arched(new THREE.Path(), xc, half - 0.04, 4.34, 5.35));
    P.wood.push({
      geometry: uvFeet(new THREE.ExtrudeGeometry(sash, { depth: WT + 0.05, bevelEnabled: false, curveSegments: 10 }), 0.9, 1.8).translate(0, 0, CF - WT / 2 - 0.025),
      color: LOCO.varnish,
    });
    P.glass.push({
      geometry: new THREE.ExtrudeGeometry(arched(new THREE.Shape(), xc, half - 0.02, 4.32, 5.35), { depth: 0.012, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, CF),
      color: 0xbfd8dc,
    });
  }
  // Floor.
  for (let i = 0; i < 12; i++) {
    const x = -CX + 0.02 + ((i + 0.5) / 12) * (CX * 2 - 0.04);
    timber(P.wood, LOCO.oak, [x, FLOOR - 0.03, CF], [x, FLOOR - 0.03, CR - 0.1], (CX * 2) / 12 - 0.012, 0.06, woodOpts);
  }
  block(P.paint, LOCO.iron, CX * 2 + 0.1, 0.22, 3.7, [0, FLOOR - 0.2, (CF + CR) / 2 - 0.05]);

  // The backhead, which is what the crew looked at all day: the firedoor, the water gauges, the
  // throttle lever and the long reversing lever.
  const BH = -1.58;
  P.metal.push({
    geometry: onZ(spin([[0.2, 0, 'h'], [0.34, 0, 'h'], [0.34, 0.05], [0.3, 0.08, 'h'], [0.2, 0.08, 'h']], { segments: 24, closed: true }))
      .rotateY(Math.PI).translate(0, 3.62, BH),
    color: LOCO.brass,
  });
  P.paint.push({
    geometry: onZ(spin([[0, 0], [0.22, 0, 'h'], [0.22, 0.05], [0, 0.07]], { segments: 20 })).rotateY(Math.PI).translate(0, 3.62, BH),
    color: LOCO.black,
  });
  rod(P.metal, LOCO.brass, [0.22, 3.62, BH - 0.1], [-0.05, 3.62, BH - 0.1], 0.016, { sides: 6 });
  for (const s of [-1, 1]) {
    rod(P.metal, LOCO.brassPale, [s * 0.62, 3.9, BH - 0.06], [s * 0.62, 4.6, BH - 0.06], 0.03, { sides: 8 });
    for (const y of [3.9, 4.6]) {
      rod(P.metal, LOCO.brass, [s * 0.62, y, BH + 0.02], [s * 0.62, y, BH - 0.08], 0.03, { sides: 8 });
    }
    P.metal.push({
      geometry: onZ(spin([[0, -0.03], [0.14, -0.03, 'h'], [0.14, 0.02], [0.1, 0.03, 'h'], [0, 0.035]], { segments: 18 })).rotateY(Math.PI).translate(s * 0.3, 4.72, BH - 0.01),
      color: LOCO.brass,
    });
    P.metal.push({
      geometry: onZ(spin([[0, 0.02], [0.105, 0.02, 'h'], [0.105, 0.03], [0, 0.03]], { segments: 18 })).rotateY(Math.PI).translate(s * 0.3, 4.72, BH - 0.01),
      color: 0xf1ead5,
    });
  }
  strip(P.metal, LOCO.steel, [-0.1, 4.96, BH - 0.05], [-0.8, 4.84, -2.12], 0.05, 0.03, { up: [0, 1, 0] });
  rod(P.metal, LOCO.iron, [-0.1, 4.96, BH + 0.05], [-0.1, 4.96, BH - 0.12], 0.06, { sides: 10 });
  strip(P.metal, LOCO.steel, [-1.05, FLOOR + 0.02, -1.95], [-1.0, 4.82, -2.32], 0.06, 0.04, { up: [0, 0, 1] });
  dot(P.metal, LOCO.steel, 0.07, [-1.0, 4.85, -2.33], { sides: 10 });
  strip(P.paint, LOCO.iron, [-1.2, FLOOR + 0.02, -2.0], [-0.9, FLOOR + 0.02, -2.0], 0.14, 0.05, { up: [0, 1, 0] });

  // Roof: an arched lens in section, with a clerestory that let the heat of the firebox out.
  const roofLoft = (z0, z1, w, up, dn, y) => solidLoft([
    { d: z1 - 0.02, w: w - 0.02, up: up - 0.01, dn, b: y, round: 1 },
    { d: z1, w, up, dn, b: y, round: 1 },
    { d: z0, w, up, dn, b: y, round: 1 },
    { d: z0 + 0.02, w: w - 0.02, up: up - 0.01, dn, b: y, round: 1 },
  ], { sides: 44, samples: 3 });
  const roofZ0 = -0.42;
  const roofZ1 = -4.5;
  P.paint.push({ geometry: roofLoft(roofZ0, roofZ1, 2.08, 0.5, 0.05, EAVE + 0.06), color: LOCO.buff });
  P.paint.push({ geometry: roofLoft(-1.12, -3.75, 0.82, 0.2, 0.34, EAVE + 0.52), color: LOCO.crimson });
  P.paint.push({ geometry: roofLoft(-1.02, -3.85, 0.98, 0.14, 0.03, EAVE + 0.74), color: LOCO.buff });
  for (const s of [-1, 1]) {
    strip(P.metal, LOCO.gold, [s * 0.828, EAVE + 0.55, -1.2], [s * 0.828, EAVE + 0.55, -3.67], 0.008, 0.02);
    for (let i = 0; i < 4; i++) {
      const z = -1.5 - i * 0.62;
      block(P.glass, 0xbfd8dc, 0.02, 0.15, 0.4, [s * 0.815, EAVE + 0.6, z]);
      strip(P.metal, LOCO.varnish, [s * 0.822, EAVE + 0.52, z - 0.21], [s * 0.822, EAVE + 0.68, z - 0.21], 0.02, 0.025, { up: [0, 0, 1] });
      strip(P.metal, LOCO.varnish, [s * 0.822, EAVE + 0.52, z + 0.21], [s * 0.822, EAVE + 0.68, z + 0.21], 0.02, 0.025, { up: [0, 0, 1] });
    }
    // Curved eave bracket under the roof overhang.
    pipe(P.metal, LOCO.gold, [[s * 1.77, EAVE - 0.25, roofZ1 + 0.14], [s * 1.9, EAVE - 0.1, roofZ1 + 0.14], [s * 2.0, EAVE + 0.02, roofZ1 + 0.14]], 0.02, { sides: 6 });
    pipe(P.metal, LOCO.gold, [[s * 1.77, EAVE - 0.25, roofZ0 - 0.14], [s * 1.9, EAVE - 0.1, roofZ0 - 0.14], [s * 2.0, EAVE + 0.02, roofZ0 - 0.14]], 0.02, { sides: 6 });
  }
  // Number plate on the cab side is drawn into the sign atlas, below.

  // ----- Tender ----------------------------------------------------------------------------
  const TZ0 = -4.72;
  const TZ1 = -12.45;
  const TANK0 = -5.45;
  const TX = 1.95;
  const DECK = 2.92;
  const TANKTOP = 4.32;
  const tzc = (TANK0 + TZ1) / 2;
  const thl = (TANK0 - TZ1) / 2;
  const plan = (halfW, halfL, r, y0, y1) => {
    const g = extrudeOutline(roundedOutline(halfW, halfL, r, 5), y1 - y0).rotateX(-Math.PI / 2);
    return g.translate(0, (y0 + y1) / 2, tzc);
  };
  // Underframe of squared oak, with the tank sitting on it.
  for (const x of [-1.72, -0.55, 0.55, 1.72]) {
    timber(P.wood, LOCO.oak, [x, 2.0, TZ0], [x, 2.0, TZ1], 0.2, 0.3, { ...woodOpts, chamfer: 0.02 });
  }
  for (const z of [TZ0 + 0.1, TZ1 + 0.1]) {
    timber(P.wood, LOCO.vermilion, [-TX, 2.05, z], [TX, 2.05, z], 0.24, 0.42, { ...woodOpts, chamfer: 0.03 });
  }
  P.paint.push({ geometry: plan(TX, thl, 0.42, 2.14, TANKTOP - 0.06), color: LOCO.crimson });
  P.paint.push({ geometry: plan(TX + 0.05, thl + 0.05, 0.46, TANKTOP - 0.1, TANKTOP), color: LOCO.crimson });
  P.metal.push({ geometry: plan(TX + 0.075, thl + 0.075, 0.48, TANKTOP - 0.04, TANKTOP - 0.015), color: LOCO.brass });
  P.paint.push({ geometry: plan(TX + 0.03, thl + 0.03, 0.44, 2.14, 2.28), color: LOCO.black });
  // Rows of rivets are what say this is an iron tank and not a wooden box.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 22; i++) {
      const z = TANK0 - 0.3 - (i / 21) * (thl * 2 - 0.75);
      rivet(P.paint, LOCO.crimson, 0.026, [s * TX, 2.38, z], [s, 0, 0]);
      rivet(P.paint, LOCO.crimson, 0.026, [s * TX, TANKTOP - 0.2, z], [s, 0, 0]);
    }
    // Gold-lined panel on each flank.
    const py0 = 2.48;
    const py1 = 3.96;
    const pz0 = TANK0 - 0.5;
    const pz1 = TZ1 + 0.6;
    for (const [a, b] of [
      [[s * (TX + 0.004), py0, pz0], [s * (TX + 0.004), py0, pz1]],
      [[s * (TX + 0.004), py1, pz0], [s * (TX + 0.004), py1, pz1]],
      [[s * (TX + 0.004), py0, pz0], [s * (TX + 0.004), py1, pz0]],
      [[s * (TX + 0.004), py0, pz1], [s * (TX + 0.004), py1, pz1]],
    ]) strip(P.metal, LOCO.gold, a, b, 0.012, 0.04, { up: [s, 0, 0] });
  }
  // The rear of the tank is a big flat face in permanent shade, so it needs a reason to look at it:
  // a lined panel, a ladder up to the water hatch, and the engine's number.
  {
    const rz = TZ1 - 0.052;
    for (const [a, b] of [
      [[-1.5, 2.48, rz], [1.5, 2.48, rz]], [[-1.5, 3.96, rz], [1.5, 3.96, rz]],
      [[-1.5, 2.48, rz], [-1.5, 3.96, rz]], [[1.5, 2.48, rz], [1.5, 3.96, rz]],
    ]) strip(P.metal, LOCO.gold, a, b, 0.04, 0.012, { up: [0, 0, 1] });
    for (let i = 0; i < 15; i++) {
      const x = -1.5 + (i / 14) * 3;
      rivet(P.paint, LOCO.crimson, 0.026, [x, 2.38, TZ1 - 0.05], [0, 0, -1]);
      rivet(P.paint, LOCO.crimson, 0.026, [x, TANKTOP - 0.2, TZ1 - 0.05], [0, 0, -1]);
    }
    for (const x of [0.46, 0.86]) {
      rod(P.metal, LOCO.iron, [x, 1.9, TZ1 - 0.17], [x, TANKTOP + 0.3, TZ1 - 0.17], 0.024, { sides: 6 });
      for (const y of [2.5, TANKTOP - 0.1]) rod(P.metal, LOCO.iron, [x, y, TZ1 - 0.17], [x, y, TZ1 - 0.03], 0.018, { sides: 6 });
    }
    for (let y = 2.1; y < TANKTOP + 0.2; y += 0.34) rod(P.metal, LOCO.iron, [0.46, y, TZ1 - 0.17], [0.86, y, TZ1 - 0.17], 0.017, { sides: 6 });
  }

  // The front deck, the shovelling plate, and the apron that bridges the gap to the engine.
  for (let i = 0; i < 12; i++) {
    const x = -TX + ((i + 0.5) / 12) * TX * 2;
    timber(P.wood, LOCO.oak, [x, DECK, TZ0], [x, DECK, TANK0 + 0.02], (TX * 2) / 12 - 0.01, 0.07, woodOpts);
  }
  block(P.paint, LOCO.iron, TX * 2, 0.7, 0.2, [0, 2.5, TZ0 + 0.08]);
  block(P.metal, LOCO.iron, 1.5, 0.03, 1.0, [0, DECK + 0.05, -4.55]);
  // The drawbar, and the leather feed hose carrying water forward to the engine's pumps.
  rod(P.metal, LOCO.iron, [0, 2.45, CR + 0.1], [0, 2.45, TZ0 + 0.3], 0.09, { sides: 10 });
  rod(P.metal, LOCO.steel, [0, 2.3, CR - 0.05], [0, 2.6, CR - 0.05], 0.05, { sides: 8 });
  rod(P.metal, LOCO.steel, [0, 2.3, TZ0 + 0.1], [0, 2.6, TZ0 + 0.1], 0.05, { sides: 8 });
  for (const s of [-1, 1]) {
    pipe(P.paint, 0x2a2018, [[s * 1.2, 2.15, -5.0], [s * 1.25, 1.75, -4.75], [s * 1.2, 1.82, -4.0], [s * 1.0, 2.3, -3.4]], 0.07, { sides: 8 });
    strip(P.paint, LOCO.iron, [s * 1.95, DECK - 0.1, TZ0 + 0.1], [s * 1.95, 1.3, TZ0 + 0.1], 0.035, 0.05);
    block(P.paint, LOCO.iron, 0.34, 0.035, 0.42, [s * 1.92, 1.32, TZ0 + 0.1]);
    rod(P.metal, LOCO.brass, [s * (TX + 0.06), 3.0, TANK0 + 0.04], [s * (TX + 0.06), TANKTOP - 0.06, TANK0 + 0.04], 0.024, { sides: 8 });
  }

  // Cordwood, stacked across the bunker with its cut ends out. Crews stopped at trackside woodpiles
  // to reload, which is why railroads of this era bought forests along the line.
  const WOOD_Z0 = TANK0 - 0.12;
  const WOOD_Z1 = TZ1 + 1.85;
  const rail = 0.68;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const z = WOOD_Z0 + ((WOOD_Z1 - WOOD_Z0) * i) / 8;
      timber(P.wood, LOCO.crimson, [s * (TX - 0.05), TANKTOP - 0.12, z], [s * (TX - 0.05), TANKTOP + rail, z], 0.09, 0.09, { ...woodOpts, up: [0, 0, 1], chamfer: 0.012 });
    }
    timber(P.wood, LOCO.crimson, [s * (TX - 0.05), TANKTOP + rail - 0.02, WOOD_Z0 + 0.05], [s * (TX - 0.05), TANKTOP + rail - 0.02, WOOD_Z1 - 0.05], 0.09, 0.1, { ...woodOpts, chamfer: 0.012 });
    timber(P.wood, LOCO.crimson, [s * (TX - 0.05), TANKTOP + rail * 0.4, WOOD_Z0 + 0.05], [s * (TX - 0.05), TANKTOP + rail * 0.4, WOOD_Z1 - 0.05], 0.05, 0.09, woodOpts);
  }
  timber(P.wood, LOCO.crimson, [-(TX - 0.05), TANKTOP + rail - 0.02, WOOD_Z1], [TX - 0.05, TANKTOP + rail - 0.02, WOOD_Z1], 0.1, 0.1, woodOpts);
  timber(P.wood, LOCO.crimson, [-(TX - 0.05), TANKTOP + rail * 0.4, WOOD_Z1], [TX - 0.05, TANKTOP + rail * 0.4, WOOD_Z1], 0.09, 0.09, woodOpts);
  const logGeo = (len, r, bark, end, s) => {
    const sides = 7;
    const g = new THREE.CylinderGeometry(r, r * (0.92 + rng() * 0.1), len, sides, 1);
    const col = new Float32Array(g.attributes.position.count * 3);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      // Rotated onto X, a cylinder's -Y end points to s * +X. Only that cut end shows; the buried
      // inner end stays bark, or it draws a pale crescent wherever two logs meet in the stack.
      const isCap = n.getY(i) * -s > 0.8;
      const c = isCap ? end : bark;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const barkTones = [0x5a4230, 0x4c3a2b, 0x6a4d35, 0x736654, 0x584636].map((c) => new THREE.Color(c));
  const endTones = [0xd8b77f, 0xcfa86c, 0xe0c28f, 0xc39a5e].map((c) => new THREE.Color(c));
  const layerTop = [0, 1, 2, 3];
  for (const layer of layerTop) {
    const inset = layer * 0.28;
    const y0 = TANKTOP + 0.15 + layer * 0.27;
    const zA = WOOD_Z0 - 0.12 - inset * 0.7;
    const zB = WOOD_Z1 + 0.12 + inset * 0.7;
    for (let z = zA; z > zB; z -= 0.37 + rng() * 0.05) {
      for (const s of [-1, 1]) {
        const halfX = TX - 0.14 - inset;
        const len = halfX + (rng() - 0.3) * 0.12;
        const r = 0.125 + rng() * 0.06;
        const bark = barkTones[Math.floor(rng() * barkTones.length)];
        const end = endTones[Math.floor(rng() * endTones.length)];
        const g = logGeo(len, r, bark, end, s);
        const xc = s * (halfX / 2 + 0.02 + rng() * 0.02);
        P.wood.push({
          geometry: placed(g, {
            pos: [xc, y0 + (rng() - 0.5) * 0.04, z + (rng() - 0.5) * 0.05],
            rot: [(rng() - 0.5) * 0.08, 0, Math.PI / 2 + (rng() - 0.5) * 0.05],
          }),
          keepColor: true,
        });
      }
    }
  }
  // The water hatch on the rear of the tank.
  P.metal.push({
    geometry: spin([
      [0, TANKTOP - 0.1], [0.52, TANKTOP - 0.1, 'h'], [0.52, TANKTOP + 0.09, 'h'], [0.42, TANKTOP + 0.09, 'h'], [0.42, TANKTOP + 0.14], [0.3, TANKTOP + 0.2], [0.09, TANKTOP + 0.23, 'h'], [0.09, TANKTOP + 0.3], [0, TANKTOP + 0.32],
    ], { segments: 28 }).translate(0, 0, TZ1 + 0.95),
    color: LOCO.brass,
  });
  // Brake wheel, and the rear lantern that marked the tail of an engine running light.
  rod(P.metal, LOCO.iron, [1.25, 1.6, TZ1 + 0.3], [1.25, TANKTOP + 0.9, TZ1 + 0.3], 0.03, { sides: 8 });
  P.metal.push({
    geometry: spin([[0.26, -0.02, 'h'], [0.3, -0.02, 'h'], [0.3, 0.02, 'h'], [0.26, 0.02, 'h']], { segments: 24, closed: true }).translate(1.25, TANKTOP + 0.9, TZ1 + 0.3),
    color: LOCO.iron,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    rod(P.metal, LOCO.iron, [1.25, TANKTOP + 0.9, TZ1 + 0.3], [1.25 + Math.cos(a) * 0.27, TANKTOP + 0.9, TZ1 + 0.3 + Math.sin(a) * 0.27], 0.018, { sides: 6 });
  }
  const tailY = TANKTOP + 0.22;
  strip(P.paint, LOCO.iron, [-1.2, TANKTOP - 0.05, TZ1 + 0.3], [-1.2, tailY - 0.16, TZ1 + 0.3], 0.08, 0.05);
  block(P.paint, LOCO.black, 0.32, 0.4, 0.32, [-1.2, tailY + 0.02, TZ1 + 0.3]);
  P.metal.push({ geometry: onZ(spin([[0, 0.15], [0.12, 0.15, 'h'], [0.12, 0.2], [0, 0.23]], { segments: 14 })).rotateY(Math.PI).translate(-1.2, tailY + 0.02, TZ1 + 0.3), color: 0xd63a22 });
  // Rear coupling.
  block(P.metal, LOCO.iron, 0.34, 0.24, 0.14, [0, 2.1, TZ1 - 0.06]);
  rod(P.metal, LOCO.steel, [0, 1.95, TZ1 - 0.08], [0, 2.3, TZ1 - 0.08], 0.03, { sides: 8 });

  // Two four-wheel trucks under the tender.
  for (const tc of [TANK0 - 0.9, TZ1 + 2.05]) {
    const az = [tc + 1.18, tc - 1.18];
    for (const z of az) {
      for (const s of [-1, 1]) {
        locoWheel(P, { R: 0.62, flange: 0.05, width: 0.25, spokes: 0, hub: 0.14, x: s * WX, z, side: s, segments: 18, webbed: true, centre: LOCO.crimson });
        block(P.paint, LOCO.iron, 0.14, 0.26, 0.24, [s * 1.42, 0.67, z]);
        dot(P.metal, LOCO.brass, 0.065, [s * 1.49, 0.67, z], { sides: 8, flat: 0.5, up: [s, 0, 0] });
      }
      rod(P.paint, LOCO.iron, [-1.42, 0.67, z], [1.42, 0.67, z], 0.07, { sides: 10 });
    }
    for (const s of [-1, 1]) {
      const tx = s * 1.42;
      strip(P.paint, LOCO.iron, [tx, 0.92, tc + 1.4], [tx, 0.92, tc - 1.4], 0.06, 0.08);
      strip(P.paint, LOCO.iron, [tx, 0.5, tc + 1.3], [tx, 0.26, tc + 0.5], 0.06, 0.06);
      strip(P.paint, LOCO.iron, [tx, 0.26, tc + 0.5], [tx, 0.26, tc - 0.5], 0.06, 0.06);
      strip(P.paint, LOCO.iron, [tx, 0.26, tc - 0.5], [tx, 0.5, tc - 1.3], 0.06, 0.06);
      strip(P.paint, LOCO.iron, [tx, 0.92, tc + 0.5], [tx, 0.26, tc + 0.5], 0.05, 0.07);
      strip(P.paint, LOCO.iron, [tx, 0.92, tc - 0.5], [tx, 0.26, tc - 0.5], 0.05, 0.07);
      for (const d of [-0.2, 0.2]) {
        P.paint.push({
          geometry: spin([[0, 0.3], [0.11, 0.3], [0.11, 0.86], [0, 0.86]], { segments: 7 }).translate(tx, 0, tc + d),
          color: LOCO.black,
        });
      }
    }
    timber(P.wood, LOCO.oak, [-1.5, 1.05, tc], [1.5, 1.05, tc], 0.36, 0.26, { ...woodOpts, chamfer: 0.03 });
    timber(P.wood, LOCO.oak, [-1.6, 1.68, tc], [1.6, 1.68, tc], 0.34, 0.42, { ...woodOpts, chamfer: 0.03 });
    rod(P.paint, LOCO.iron, [0, 1.0, tc], [0, 1.85, tc], 0.09, { sides: 10 });
  }

  // ----- Painted lettering ------------------------------------------------------------------
  // Gold on crimson with a dark shadow, the way a signwriter did it. The road's name is invented:
  // no real railroad is being represented, and the catalogue card says it is a type, not one engine.
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 512);
  const goldText = (text, cx, cy, maxW, start) => {
    const size = fitFont(ctx, text, maxW, start, 'bold % Georgia, "Times New Roman", serif');
    ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a0d0a';
    ctx.fillText(text, cx + size * 0.045, cy + size * 0.05);
    ctx.fillStyle = '#efc65a';
    ctx.fillText(text, cx, cy);
  };
  goldText('EDUSIM RAILROAD', 512, 128, 960, 130);
  goldText('No. 7', 256, 384, 440, 170);
  goldText('7', 768, 384, 240, 190);
  const signMap = new THREE.CanvasTexture(canvas);
  signMap.colorSpace = THREE.SRGBColorSpace;
  signMap.anisotropy = 8;
  signMap.needsUpdate = true;
  const signPlane = (w, h, u0, v0, u1, v1) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    return g;
  };
  for (const s of [-1, 1]) {
    // A plane's face looks down +Z; carried to look out along s * +X its reading direction still
    // runs left to right for somebody standing on that side.
    const rot = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    P.sign.push({ geometry: signPlane(5.6, 1.4, 0, 0.5, 1, 1).rotateY(rot).translate(s * (TX + 0.012), 3.22, (TANK0 + TZ1) / 2 + 0.05), color: 0xffffff });
    if (s < 0) P.sign.push({ geometry: signPlane(1.0, 0.5, 0, 0, 0.5, 0.5).rotateY(Math.PI).translate(-0.62, 3.22, TZ1 - 0.06), color: 0xffffff });
    P.sign.push({ geometry: signPlane(1.25, 0.62, 0, 0, 0.5, 0.5).rotateY(rot).translate(s * (CX + 0.04), 3.56, (CF + SIDE_END) / 2), color: 0xffffff });
  }

  const group = groupOf(
    meshOf(P.paint, { roughness: 0.42, metalness: 0.14 }),
    meshOf(P.metal, { roughness: 0.36, metalness: 0.46 }),
    meshOf(P.wood, { roughness: 0.62, metalness: 0, ...grainMaps({ seed: 61, knots: 2, strength: 0.35 }) }),
    meshOf(P.glass, { roughness: 0.12, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false }),
    meshOf(P.sign, { roughness: 0.5, metalness: 0.1, map: signMap, alphaTest: 0.45, side: THREE.DoubleSide }),
  );
  return group;
}

// ---------------------------------------------------------------------------
// The Wright Flyer of 1903, at true size
// ---------------------------------------------------------------------------
//
// THE PROBLEM WITH THIS OBJECT IS THAT IT IS NEARLY NOTHING. Two big pale cloths held apart by a
// web of sticks and wire, every member under an inch thick, and the catalogue shows it at 0.6. So
// the struts are drawn a little fatter than life and the wires much fatter, because a true 1/16in
// wire is under a tenth of a pixel from where a student stands, and a Flyer with no wires is a
// different machine: the wires are what make it a truss. The card should not claim otherwise.
//
// What a teacher can point at, all of it true of the machine: the wings are arched and droop about
// ten inches at the tips; the pilot lies left of the centre line (+X) and the heavier engine right
// (-X), which is why the right wing is four inches longer; the REAR outer bays have no cross wires,
// because those are the bays that twist when the pilot's hip cradle warps the wing; and one of the
// two chains is crossed, so that the propellers turn opposite ways and cancel each other's torque.

const FLYER = {
  muslin: 0xddd3bb,
  spruce: 0xcb9d5e,
  ash: 0xb07f44,
  wire: 0x454b50,
  iron: 0x3a3e42,
  jacket: 0x5a5e60,
  alum: 0xa9abaa,
  case: 0x8f9396,
  paintProp: 0xc2c1b6,
  chain: 0x303337,
  copper: 0xb5703f,
  brass: 0xcda24a,
  leather: 0x5a3a24,
};

// A near-white tile covering one rib bay, ribs on the tile's edges, with a stitched line either side
// of each rib. The tile stretches a foot of span over six and a half of chord, so a woven pattern
// would smear into bands across the wing; the fabric's character is left to soft blotching.
function fabricMaps(seed = 9) {
  const rng = seededRandom(seed);
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f5f1e8';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const shade = 215 + Math.round(rng() * 25);
    ctx.fillStyle = `rgba(${shade},${shade - 4},${shade - 16},0.1)`;
    ctx.fillRect(rng() * W, rng() * H, 6 + rng() * 26, 10 + rng() * 60);
  }
  // The rib pocket: a soft shadow band centred on the tile's seam, so it wraps.
  for (const x of [0, W]) {
    const g = ctx.createLinearGradient(x - 11, 0, x + 11, 0);
    g.addColorStop(0, 'rgba(165,150,120,0)');
    g.addColorStop(0.5, 'rgba(165,150,120,0.26)');
    g.addColorStop(1, 'rgba(165,150,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 11, 0, 22, H);
    ctx.fillStyle = 'rgba(135,120,92,0.38)';
    for (const dx of [-5, 5]) {
      for (let y = 0; y < H; y += 6) ctx.fillRect(x + dx, y, 1.2, 3);
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
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: 0.14 };
}

function wrightFlyer() {
  const rng = seededRandom(1903);
  const P = { fabric: [], wood: [], metal: [] };
  const woodOpts = { tile: [0.7, 2.6], rng, jitter: 0.09 };

  const LOWER = 2.35;
  const UPPER = LOWER + 6.2;
  const CHORD = 6.5;
  const LE = 3.15;
  const X_RIGHT = -20.33; // the engine side, four inches longer
  const X_LEFT = 20.0;
  const RIBS = 38;
  const F_V = 0.035;
  const R_V = 0.69;

  const tipT = (x) => {
    const span = x < 0 ? -X_RIGHT : X_LEFT;
    return THREE.MathUtils.clamp((Math.abs(x) - (span - 1.7)) / 1.7, 0, 1);
  };
  // The middle surface of a wing, measured: everything that fastens to one asks this where it is.
  const wing = (base, x, v, ribFrac = null) => {
    const t = tipT(x);
    const droop = -0.83 * (x / 20) ** 2;
    const camber = (CHORD / 20) * Math.sin(Math.PI * v ** 0.63);
    const front = LE - 0.5 * t ** 3;
    let back = LE - CHORD + 1.5 * t ** 2.2;
    if (ribFrac !== null) back += 0.075 * Math.sin(Math.PI * ribFrac) ** 2;
    return [x, base + droop + camber * (1 - 0.35 * t), front + (back - front) * v];
  };
  const fabricSurface = (opts, ribs) => {
    const g = solidSurface(opts);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * ribs);
    return g;
  };
  // Rows are packed toward the leading edge, where the section turns fastest.
  const chordOf = (w) => w ** 1.7;
  const wingSurface = (base) => fabricSurface({
    nu: RIBS * 5,
    nv: 11,
    point: (u, w) => {
      const f = u * RIBS;
      return wing(base, X_RIGHT + (X_LEFT - X_RIGHT) * u, chordOf(w), f - Math.floor(f));
    },
    thick: (u, w) => {
      const v = chordOf(w);
      const x = X_RIGHT + (X_LEFT - X_RIGHT) * u;
      const f = u * RIBS;
      const rib = Math.cos(f * Math.PI * 2) * 0.5 + 0.5;
      const end = 1 - tipT(x) ** 5;
      const profile = Math.sqrt(Math.max(0, Math.sin(Math.PI * v ** 0.72)));
      return 0.085 * profile * (0.82 + 0.3 * rib * rib) * end;
    },
  }, RIBS);
  P.fabric.push({ geometry: wingSurface(LOWER), color: FLYER.muslin });
  P.fabric.push({ geometry: wingSurface(UPPER), color: FLYER.muslin });

  // ----- Interplane struts and wires --------------------------------------------------------
  const STATIONS = [1.5, 5.1, 9.6, 14.0, 17.4, 19.75];
  const stationsAll = [...STATIONS.map((x) => -x).reverse(), ...STATIONS];
  const spar = (base, x, v) => wing(base, x, v);
  const fitting = (p, up) => {
    block(P.metal, FLYER.iron, 0.16, 0.05, 0.28, [p[0], p[1] + up * 0.065, p[2]]);
  };
  for (const x of stationsAll) {
    const px = x < 0 ? Math.max(x, X_RIGHT + 0.4) : Math.min(x, X_LEFT - 0.35);
    for (const v of [F_V, R_V]) {
      const a = spar(LOWER, px, v);
      const b = spar(UPPER, px, v);
      timber(P.wood, FLYER.spruce, [a[0], a[1] - 0.02, a[2]], [b[0], b[1] + 0.02, b[2]], 0.09, 0.16, { ...woodOpts, up: [0, 0, 1], chamfer: 0.03 });
      fitting(a, 1);
      fitting(b, -1);
    }
  }
  const wire = (a, b, r = 0.024) => {
    const len = vec(a).distanceTo(vec(b));
    P.metal.push({ geometry: alongY(new THREE.CylinderGeometry(r, r, len, 4, 1, true), a, b), color: FLYER.wire });
  };
  const hoff = (p, up) => [p[0], p[1] + up * 0.09, p[2]];
  for (let i = 0; i < stationsAll.length - 1; i++) {
    const x0 = stationsAll[i];
    const x1 = stationsAll[i + 1];
    const px0 = x0 < 0 ? Math.max(x0, X_RIGHT + 0.4) : Math.min(x0, X_LEFT - 0.35);
    const px1 = x1 < 0 ? Math.max(x1, X_RIGHT + 0.4) : Math.min(x1, X_LEFT - 0.35);
    // The whole front truss is braced. At the rear only the middle is: out here the bays are free
    // to shear, and that shear IS the wing warp, the Wrights' invention for turning an aeroplane.
    const middle = Math.abs(x0) <= 5.2 && Math.abs(x1) <= 5.2;
    const planes = middle ? [F_V, R_V] : [F_V];
    for (const v of planes) {
      const a0 = spar(LOWER, px0, v);
      const a1 = spar(LOWER, px1, v);
      const b0 = spar(UPPER, px0, v);
      const b1 = spar(UPPER, px1, v);
      wire(hoff(a0, 1), hoff(b1, -1));
      wire(hoff(a1, 1), hoff(b0, -1));
    }
  }
  // Fore-and-aft wires down the middle bays, keeping the two spars square to each other.
  for (const x of [-5.1, -1.5, 1.5, 5.1]) {
    for (const [p, q] of [[LOWER, UPPER], [UPPER, LOWER]]) {
      wire(hoff(spar(p, x, F_V), p === LOWER ? 1 : -1), hoff(spar(q, x, R_V), q === LOWER ? 1 : -1));
    }
  }

  // ----- Skids --------------------------------------------------------------------------------
  const SKID = 2.35;
  const skidProfile = [[-0.06, -0.11], [0.06, -0.11], [0.06, 0.11], [-0.06, 0.11]];
  const asGrain = (g, su, sv) => {
    const uv = g.attributes.uv;
    const u0 = rng();
    const v0 = rng();
    for (let i = 0; i < uv.count; i++) {
      const along = uv.getX(i);
      const round = uv.getY(i);
      uv.setXY(i, u0 + round * su, v0 + along * sv);
    }
    return g;
  };
  const skidY0 = 0.11;
  for (const s of [-1, 1]) {
    const g = sweepProfile([
      [s * SKID, skidY0, -3.7], [s * SKID, skidY0, -1], [s * SKID, skidY0, 2], [s * SKID, skidY0 + 0.05, 4.4],
      [s * (SKID - 0.1), 0.42, 6.3], [s * (SKID - 0.3), 1.1, 7.7], [s * (SKID - 0.55), 2.2, 8.75], [s * (SKID - 0.75), 3.0, 9.1],
    ], skidProfile, { samples: 40 });
    P.wood.push({ geometry: crisp(asGrain(g, 0.6, 0.38)), color: FLYER.ash });
    // Uprights and a diagonal from each skid to the lower wing's spars.
    const f = spar(LOWER, s * SKID, F_V);
    const r = spar(LOWER, s * SKID, R_V);
    const fp = [s * SKID, skidY0 + 0.08, f[2]];
    const rp = [s * SKID, skidY0 + 0.08, r[2]];
    timber(P.wood, FLYER.spruce, fp, f, 0.09, 0.14, { ...woodOpts, up: [0, 0, 1], chamfer: 0.025 });
    timber(P.wood, FLYER.spruce, rp, r, 0.09, 0.14, { ...woodOpts, up: [0, 0, 1], chamfer: 0.025 });
    timber(P.wood, FLYER.spruce, [s * SKID, skidY0 + 0.05, -3.25], r, 0.08, 0.1, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    timber(P.wood, FLYER.spruce, [s * SKID, skidY0 + 0.1, 5.6], f, 0.09, 0.12, { ...woodOpts, up: [0, 1, 0], chamfer: 0.025 });
    for (const q of [fp, rp]) block(P.metal, FLYER.iron, 0.16, 0.05, 0.28, [q[0], q[1] + 0.07, q[2]]);
  }
  for (const z of [-3.25, 1.2]) {
    timber(P.wood, FLYER.spruce, [-SKID, skidY0 + 0.05, z], [SKID, skidY0 + 0.05, z], 0.1, 0.09, woodOpts);
  }

  // ----- Forward elevator (the canard) --------------------------------------------------------
  // Two surfaces, flexed together by the pilot's left hand. Out in front because the Wrights had
  // read how Otto Lilienthal died, in a stall a rear elevator could not recover.
  const E_SPAN = 6.35;
  const E_Z = 9.28;
  const E_CHORD = 2.55;
  const E_LOW = 3.1;
  const E_HIGH = E_LOW + 2.0;
  const elevator = (base) => fabricSurface({
    nu: 72,
    nv: 7,
    point: (u, w) => {
      const v = chordOf(w);
      const e = u * 2 - 1;
      const c = E_CHORD * Math.max(0.02, 1 - Math.abs(e) ** 3.2) ** 0.55;
      const sweep = 0.75 * e * e;
      const zLead = E_Z + c * 0.5 - sweep * 0.8;
      return [e * E_SPAN, base + (E_CHORD / 16) * Math.sin(Math.PI * v ** 0.7) - 0.2 * e * e, zLead - c * v];
    },
    thick: (u, w) => {
      const v = chordOf(w);
      const e = Math.abs(u * 2 - 1);
      return 0.052 * Math.sqrt(Math.max(0, Math.sin(Math.PI * v ** 0.72))) * Math.max(0, 1 - e ** 6);
    },
  }, 14);
  P.fabric.push({ geometry: elevator(E_LOW), color: FLYER.muslin });
  P.fabric.push({ geometry: elevator(E_HIGH), color: FLYER.muslin });
  // Its frame: four posts and two lateral bars, holding the two surfaces 2ft apart.
  const eFront = E_Z + 0.75;
  const eBack = E_Z - 0.35;
  const eY = (base, x, z) => {
    const v = (E_Z + E_CHORD / 2 - z) / E_CHORD;
    return base + (E_CHORD / 16) * Math.sin(Math.PI * Math.max(0, v) ** 0.7) - 0.2 * (x / E_SPAN) ** 2;
  };
  for (const x of [-1.6, 1.6]) {
    for (const z of [eFront, eBack]) {
      timber(P.wood, FLYER.spruce, [x, eY(E_LOW, x, z), z], [x, eY(E_HIGH, x, z), z], 0.075, 0.12, { ...woodOpts, up: [0, 0, 1], chamfer: 0.02 });
      block(P.metal, FLYER.iron, 0.13, 0.04, 0.2, [x, eY(E_LOW, x, z) + 0.05, z]);
      block(P.metal, FLYER.iron, 0.13, 0.04, 0.2, [x, eY(E_HIGH, x, z) - 0.05, z]);
    }
  }
  for (const x of [-5.2, -3.4, 3.4, 5.2]) {
    const z = E_Z + 0.1 - 0.15 * (x / E_SPAN) ** 2;
    timber(P.wood, FLYER.spruce, [x, eY(E_LOW, x, z), z], [x, eY(E_HIGH, x, z), z], 0.05, 0.08, { ...woodOpts, up: [0, 0, 1], chamfer: 0.012 });
  }
  // Cross wires, side bays and middle.
  wire([-1.6, E_LOW + 0.12, eBack], [1.6, E_HIGH - 0.02, eBack], 0.02);
  wire([1.6, E_LOW + 0.12, eBack], [-1.6, E_HIGH - 0.02, eBack], 0.02);
  wire([-5.2, E_LOW - 0.02, E_Z], [-1.6, E_HIGH, eBack + 0.2], 0.02);
  wire([5.2, E_LOW - 0.02, E_Z], [1.6, E_HIGH, eBack + 0.2], 0.02);
  wire([-5.2, E_HIGH - 0.06, E_Z], [-1.6, E_LOW + 0.1, eBack + 0.2], 0.02);
  wire([5.2, E_HIGH - 0.06, E_Z], [1.6, E_LOW + 0.1, eBack + 0.2], 0.024);
  // Outriggers from the wings forward to the elevator. They converge, so the whole thing is a
  // truss in side view as well as in plan.
  const hang = E_Z - 0.55;
  for (const s of [-1, 1]) {
    const u = spar(UPPER, s * SKID, F_V);
    const l = spar(LOWER, s * SKID, F_V);
    timber(P.wood, FLYER.spruce, [u[0], u[1] - 0.02, u[2]], [s * 1.6, E_HIGH + 0.02, hang], 0.08, 0.12, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    timber(P.wood, FLYER.spruce, [l[0], l[1] + 0.04, l[2]], [s * 1.6, E_LOW + 0.0, hang], 0.08, 0.12, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    timber(P.wood, FLYER.spruce, [s * 1.6, E_LOW - 0.02, hang], [s * 1.6, E_HIGH + 0.06, hang], 0.075, 0.1, { ...woodOpts, up: [0, 0, 1], chamfer: 0.02 });
    wire([u[0], u[1] - 0.1, u[2]], [s * 1.6, E_LOW, hang], 0.02);
    wire([l[0], l[1] + 0.1, l[2]], [s * 1.6, E_HIGH, hang], 0.02);
    wire([s * 1.95, 2.25, 8.6], [s * 1.6, E_LOW, hang], 0.02);
  }
  timber(P.wood, FLYER.spruce, [-1.6, E_HIGH, hang], [1.6, E_HIGH, hang], 0.08, 0.08, woodOpts);
  timber(P.wood, FLYER.spruce, [-1.6, E_LOW + 0.02, hang], [1.6, E_LOW + 0.02, hang], 0.08, 0.08, woodOpts);

  // ----- Twin rudder --------------------------------------------------------------------------
  // A rounded rectangle from a square grid: the square-to-disc map, blended so the corners only
  // soften rather than the whole plate turning into an egg.
  const RUDDER_X = 0.95;
  const R_TOP = 7.85;
  const R_BOT = 1.85;
  const R_FRONT = -8.65;
  const R_BACK = -10.55;
  const rudder = (x) => {
    const pt = (u, w) => {
      const a = u * 2 - 1;
      const b = w * 2 - 1;
      const k = 0.14;
      const da = a * Math.sqrt(1 - (b * b) / 2);
      const db = b * Math.sqrt(1 - (a * a) / 2);
      return [a * (1 - k) + da * k * 1.15, b * (1 - k) + db * k * 1.15];
    };
    return fabricSurface({
      nu: 36,
      nv: 8,
      point: (u, w) => {
        const [a, b] = pt(u, w);
        return [x, (R_TOP + R_BOT) / 2 + a * (R_TOP - R_BOT) * 0.5, (R_FRONT + R_BACK) / 2 + b * (R_FRONT - R_BACK) * 0.5];
      },
      thick: (u, w) => {
        const ea = Math.abs(u * 2 - 1);
        const eb = Math.abs(w * 2 - 1);
        return 0.045 * Math.sqrt(Math.max(0, 1 - ea ** 8)) * Math.sqrt(Math.max(0, 1 - eb ** 6));
      },
    }, 7);
  };
  P.fabric.push({ geometry: rudder(RUDDER_X), color: FLYER.muslin });
  P.fabric.push({ geometry: rudder(-RUDDER_X), color: FLYER.muslin });
  const RMID = (R_FRONT + R_BACK) / 2;
  const RPOST = R_FRONT + 0.02;
  for (const s of [-1, 1]) {
    const rx = s * RUDDER_X;
    // Each rudder's posts and the two booms bringing them back from the wings.
    // Hinge post along the leading edge. The ribs and the rear post are inside the cloth.
    timber(P.wood, FLYER.spruce, [rx, R_BOT + 0.05, RPOST], [rx, R_TOP - 0.05, RPOST], 0.08, 0.1, { ...woodOpts, up: [0, 0, 1], chamfer: 0.02 });
    const u = spar(UPPER, s * SKID, R_V);
    const l = spar(LOWER, s * SKID, R_V);
    timber(P.wood, FLYER.spruce, [u[0], u[1] - 0.04, u[2]], [rx, R_TOP - 0.28, RPOST], 0.08, 0.11, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    timber(P.wood, FLYER.spruce, [l[0], l[1] + 0.04, l[2]], [rx, R_BOT + 0.28, RPOST], 0.08, 0.11, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    timber(P.wood, FLYER.spruce, [s * SKID, skidY0 + 0.05, -3.45], [rx, R_BOT + 0.28, RPOST], 0.08, 0.09, { ...woodOpts, up: [0, 1, 0], chamfer: 0.02 });
    wire([u[0], u[1] - 0.12, u[2]], [rx, R_BOT + 0.3, RPOST], 0.02);
    wire([l[0], l[1] + 0.12, l[2]], [rx, R_TOP - 0.3, RPOST], 0.02);
    // The control wires from the hip cradle's warping cables run back to the rudder's horns, which
    // is what ties rudder and warp together, the third of the Wrights' three controls.
    wire([1.5, LOWER + 0.5, -1.2], [rx, (R_BOT + R_TOP) / 2 - 1.3, RPOST], 0.016);
  }
  for (const y of [R_BOT + 0.25, R_TOP - 0.25, (R_BOT + R_TOP) / 2]) {
    for (const z of [RPOST, RMID - 0.25]) {
      timber(P.wood, FLYER.spruce, [-RUDDER_X, y, z], [RUDDER_X, y, z], 0.08, 0.06, { ...woodOpts, chamfer: 0.012 });
    }
  }
  wire([-RUDDER_X, R_BOT + 0.25, RPOST], [RUDDER_X, R_TOP - 0.25, RPOST], 0.018);
  wire([RUDDER_X, R_BOT + 0.25, RPOST], [-RUDDER_X, R_TOP - 0.25, RPOST], 0.018);

  // ----- Propellers ---------------------------------------------------------------------------
  // Two 8.5ft pushers behind the wing. The Wrights' great discovery was that a propeller is a wing
  // going round in a circle, so each blade is cambered and twisted, steep at the hub where it
  // travels slowly and flat at the tip where it travels fast. Laminated spruce under aluminium paint.
  const PROP_X = 5.1;
  const PROP_Y = LOWER + 3.3;
  const PROP_Z = -5.05;
  const PROP_R = 4.25;
  const PITCH = 9.6;
  const R_BIG = 0.38; // 23 teeth to the engine's 8: the chains gear the propellers down
  const R_SMALL = 0.15;
  const blade = (hand) => solidSurface({
    nu: 16,
    nv: 6,
    point: (u, v) => {
      const r = 0.18 + (PROP_R - 0.18) * u;
      const taper = Math.min(1, (r - 0.1) / 2.1);
      const tip = 1 - THREE.MathUtils.smoothstep(r, PROP_R - 0.9, PROP_R) ** 3;
      const c = (0.14 + 0.54 * Math.sqrt(taper)) * Math.sqrt(Math.max(0.03, tip));
      const beta = Math.atan2(PITCH, 2 * Math.PI * Math.max(0.5, r));
      const s = (v - 0.42) * c;
      const cam = 0.05 * c * Math.sin(Math.PI * v);
      return [s * Math.cos(beta) * hand - cam * Math.sin(beta) * hand, r, s * Math.sin(beta) + cam * Math.cos(beta)];
    },
    thick: (u, v) => {
      const taper = 0.055 - 0.035 * u;
      return taper * Math.sqrt(Math.max(0, Math.sin(Math.PI * v))) * Math.sqrt(Math.max(0, 1 - u ** 6));
    },
  });
  for (const s of [-1, 1]) {
    const xp = s * PROP_X;
    const lean = s * 0.42 + 0.2;
    for (const b of [0, Math.PI]) {
      P.metal.push({ geometry: placed(blade(s), { rot: [0, 0, lean + b], pos: [xp, PROP_Y, PROP_Z] }), color: FLYER.paintProp });
    }
    P.metal.push({
      geometry: onZ(spin([[0, -0.26], [0.12, -0.26, 'h'], [0.17, -0.18], [0.17, 0.14], [0.1, 0.24, 'h'], [0, 0.24]], { segments: 16 })).translate(xp, PROP_Y, PROP_Z),
      color: FLYER.alum,
    });
    // The long shaft runs forward through the gap between the wings to the chain sprocket, and the
    // braces hold its rear bearing out behind the wing.
    rod(P.metal, FLYER.alum, [xp, PROP_Y, PROP_Z], [xp, PROP_Y, -1.1], 0.05, { sides: 10 });
    const uu = spar(UPPER, xp, R_V);
    const ll = spar(LOWER, xp, R_V);
    const bearing = [xp, PROP_Y, PROP_Z + 0.52];
    timber(P.wood, FLYER.spruce, [uu[0], uu[1] - 0.05, uu[2]], [bearing[0], bearing[1] + 0.05, bearing[2]], 0.09, 0.13, { ...woodOpts, up: [0, 0, 1], chamfer: 0.025 });
    timber(P.wood, FLYER.spruce, [ll[0], ll[1] + 0.05, ll[2]], [bearing[0], bearing[1] - 0.05, bearing[2]], 0.09, 0.13, { ...woodOpts, up: [0, 0, 1], chamfer: 0.025 });
    P.metal.push({ geometry: onZ(spin([[0.07, -0.18, 'h'], [0.14, -0.18, 'h'], [0.14, 0.18, 'h'], [0.07, 0.18, 'h']], { segments: 12, closed: true })).translate(...bearing), color: FLYER.iron });
    // Forward bearing, on the strut at this station.
    const midStrutZ = spar(LOWER, xp, R_V)[2];
    block(P.metal, FLYER.iron, 0.22, 0.22, 0.12, [xp, PROP_Y, midStrutZ]);
    P.metal.push({
      geometry: gearWheel(R_BIG, 23, 0.04, { toothDepth: 0.04, tipRatio: 0.5 }).translate(xp, PROP_Y, -1.55),
      color: FLYER.iron,
    });
    rod(P.metal, FLYER.iron, [xp, PROP_Y, -1.5], [xp, PROP_Y, -1.62], 0.09, { sides: 10 });
  }

  // ----- Engine, on the lower wing to the right of centre --------------------------------------
  // Twelve horsepower from four cylinders in a cast aluminium crankcase, built in six weeks by the
  // brothers' mechanic Charlie Taylor. It lay beside the pilot, not ahead of him, so that a crash
  // would not bring it down on top of him.
  const EX = -1.72;
  const EY = LOWER + 0.82;
  const E_Z0 = 1.15;
  const E_Z1 = -1.05;
  const CH = FLYER.case;
  P.metal.push({
    geometry: solidLoft([
      { d: E_Z1 - 0.02, w: 0.3, up: 0.3, dn: 0.34, a: EX, b: EY, round: 0.55 },
      { d: E_Z1, w: 0.33, up: 0.33, dn: 0.37, a: EX, b: EY, round: 0.55 },
      { d: E_Z0, w: 0.33, up: 0.33, dn: 0.37, a: EX, b: EY, round: 0.55 },
      { d: E_Z0 + 0.02, w: 0.3, up: 0.3, dn: 0.34, a: EX, b: EY, round: 0.55 },
    ], { sides: 20, samples: 3 }),
    color: CH,
  });
  for (const s of [-1, 1]) {
    timber(P.wood, FLYER.ash, [EX + s * 0.34, LOWER + 0.35, E_Z0 + 0.25], [EX + s * 0.34, LOWER + 0.35, E_Z1 - 0.25], 0.14, 0.14, { ...woodOpts, chamfer: 0.02 });
    block(P.metal, CH, 0.15, 0.12, E_Z0 - E_Z1 - 0.1, [EX + s * 0.34, LOWER + 0.5, (E_Z0 + E_Z1) / 2]);
  }
  for (let i = 0; i < 4; i++) {
    const z = E_Z1 + 0.32 + i * 0.52;
    // A water-jacketed cylinder, lying on its side, with its head and valve boss.
    P.metal.push({
      geometry: onX(spin([
        [0, 0.1], [0.24, 0.1, 'h'], [0.24, 0.62, 'h'], [0.26, 0.62, 'h'], [0.26, 0.74, 'h'], [0.2, 0.75], [0.14, 0.82], [0, 0.83],
      ], { segments: 14 }), -1).translate(EX, EY + 0.06, z),
      color: FLYER.jacket,
    });
    rod(P.metal, FLYER.brass, [EX - 0.52, EY + 0.26, z], [EX - 0.52, EY + 0.42, z], 0.035, { sides: 8 });
    rod(P.metal, FLYER.iron, [EX - 0.62, EY - 0.1, z], [EX - 0.62, EY - 0.3, z], 0.05, { sides: 8 });
    rod(P.metal, FLYER.alum, [EX - 0.72, EY + 0.15, z], [EX - 0.72, EY + 0.3, z], 0.022, { sides: 6 });
  }
  rod(P.metal, FLYER.copper, [EX - 0.52, EY + 0.42, E_Z1 + 0.1], [EX - 0.52, EY + 0.42, E_Z1 + 2.05], 0.05, { sides: 10 });
  // Flywheel at the front of the crankshaft, sprockets on its rear.
  P.metal.push({
    geometry: onZ(spin([
      [0, -0.06], [0.1, -0.06, 'h'], [0.1, -0.03, 'h'], [0.5, -0.03, 'h'], [0.5, -0.07, 'h'], [0.62, -0.07, 'h'], [0.62, 0.07, 'h'], [0.5, 0.07, 'h'], [0.5, 0.03, 'h'], [0.1, 0.03, 'h'], [0.1, 0.06], [0, 0.06],
    ], { segments: 32 })).translate(EX, EY, E_Z0 + 0.22),
    color: FLYER.iron,
  });
  rod(P.metal, FLYER.alum, [EX, EY, E_Z1 - 0.8], [EX, EY, E_Z0 + 0.32], 0.05, { sides: 10 });
  P.metal.push({ geometry: gearWheel(R_SMALL, 8, 0.04, { toothDepth: 0.035, tipRatio: 0.5 }).translate(EX, EY, -1.5), color: FLYER.iron });
  P.metal.push({ geometry: gearWheel(R_SMALL, 8, 0.04, { toothDepth: 0.035, tipRatio: 0.5 }).translate(EX, EY, -1.65), color: FLYER.iron });
  // Radiator of thin vertical tubes, in the slipstream on its own strut, and the small fuel can
  // hung high so the petrol could run down to the engine by gravity. There was no pump.
  const RX = -0.92;
  const RZ = 2.3;
  const RY0 = LOWER + 0.72;
  const RY1 = RY0 + 3.6;
  for (let i = 0; i < 10; i++) {
    const x = RX - 0.27 + i * 0.06;
    block(P.metal, 0x8e8879, 0.045, RY1 - RY0, 0.18, [x, (RY0 + RY1) / 2, RZ]);
  }
  block(P.metal, FLYER.copper, 0.68, 0.09, 0.24, [RX, RY0, RZ]);
  block(P.metal, FLYER.copper, 0.68, 0.09, 0.24, [RX, RY1, RZ]);
  const stayLow = spar(LOWER, -0.45, 0.13);
  const stayUp = spar(UPPER, -0.45, 0.13);
  timber(P.wood, FLYER.spruce, stayLow, stayUp, 0.08, 0.12, { ...woodOpts, up: [0, 0, 1], chamfer: 0.02 });
  rod(P.metal, FLYER.iron, [RX, RY0 + 0.6, RZ], [-0.45, RY0 + 0.6, RZ], 0.018, { sides: 6 });
  rod(P.metal, FLYER.iron, [RX, RY1 - 0.4, RZ], [-0.45, RY1 - 0.4, RZ], 0.018, { sides: 6 });
  pipe(P.metal, FLYER.copper, [[RX, RY0 - 0.02, RZ], [RX - 0.1, RY0 - 0.26, RZ - 0.3], [EX - 0.15, EY + 0.45, 1.2], [EX - 0.5, EY + 0.42, 1.0]], 0.035, { sides: 7 });
  pipe(P.metal, FLYER.copper, [[RX + 0.25, RY1, RZ], [RX + 0.55, RY1 - 0.1, RZ - 0.3], [EX + 0.5, EY + 1.1, 0.4], [EX + 0.12, EY + 0.33, 0.2]], 0.03, { sides: 7 });
  const canY = UPPER - 1.25;
  P.metal.push({
    geometry: spin([
      [0, canY - 0.42], [0.09, canY - 0.4], [0.17, canY - 0.26], [0.18, canY + 0.1], [0.14, canY + 0.34], [0.05, canY + 0.42, 'h'], [0, canY + 0.44],
    ], { segments: 14 }).translate(-0.45, 0, 2.9),
    color: FLYER.alum,
  });
  block(P.metal, FLYER.iron, 0.24, 0.03, 0.18, [-0.45, canY + 0.14, 2.82]);
  pipe(P.metal, FLYER.brass, [[-0.45, canY - 0.4, 2.9], [-0.7, canY - 1.5, 2.2], [EX + 0.35, EY + 1.2, 1.1], [EX + 0.2, EY + 0.3, 0.75]], 0.016, { sides: 5, caps: false });

  // ----- The chains, one of them crossed -------------------------------------------------------
  const chainLinks = (a, b) => {
    const A = new THREE.Vector2(a[0], a[1]);
    const B = new THREE.Vector2(b[0], b[1]);
    const len = A.distanceTo(B);
    const n = Math.round(len / 0.21);
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 0.72) / n;
      const p0 = [A.x + (B.x - A.x) * t0, A.y + (B.y - A.y) * t0, a[2]];
      const p1 = [A.x + (B.x - A.x) * t1, A.y + (B.y - A.y) * t1, a[2]];
      strip(P.metal, FLYER.chain, p0, p1, 0.035, 0.05, { up: [0, 0, 1] });
    }
  };
  const chain = (cx, cy, z, crossed) => {
    const A = [cx, cy];
    const B = [EX, EY];
    const d = new THREE.Vector2(B[0] - A[0], B[1] - A[1]);
    const n = new THREE.Vector2(-d.y, d.x).normalize();
    const R1 = R_BIG;
    const R2 = R_SMALL;
    for (const sgn of [1, -1]) {
      const a = [A[0] + n.x * R1 * sgn, A[1] + n.y * R1 * sgn, z];
      const f = crossed ? -1 : 1;
      const b = [B[0] + n.x * R2 * sgn * f, B[1] + n.y * R2 * sgn * f, z];
      chainLinks(a, b);
      // The guide tubes that carry each run, and that keep a crossed chain from fouling itself.
      const t0 = 0.18;
      const t1 = crossed ? 0.78 : 0.82;
      const offs = crossed ? sgn * 0.022 : 0;
      rod(P.metal, FLYER.alum, [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, z + offs], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, z + offs], 0.048, { sides: 8 });
    }
    const wrap = new THREE.TorusGeometry(R1, 0.024, 4, 28);
    P.metal.push({ geometry: wrap.translate(cx, cy, z), color: FLYER.chain });
    P.metal.push({ geometry: new THREE.TorusGeometry(R2, 0.024, 4, 12).translate(EX, EY, z), color: FLYER.chain });
  };
  chain(-PROP_X, PROP_Y, -1.5, false);
  chain(PROP_X, PROP_Y, -1.65, true);
  // A brace from the rear spar to the crankshaft's tail bearing.
  const tail = spar(LOWER, EX, R_V);
  strip(P.metal, FLYER.iron, [EX, EY, -1.42], [EX, EY, E_Z1 - 0.2], 0.1, 0.1);
  strip(P.metal, FLYER.iron, [EX, tail[1], tail[2]], [EX, EY - 0.04, -1.34], 0.05, 0.05, { up: [0, 0, 1] });

  // ----- Pilot's station, to the left of centre -------------------------------------------------
  // The pilot lay on his front, head forward. His hips in this padded cradle slid sideways, which
  // pulled the wires that warped the wings and swung the rudders; his left hand held the elevator
  // lever. There was no seat, and no throttle: the engine ran at one speed.
  const PX = 1.55;
  const py = (z) => wing(LOWER, PX, (LE - z) / CHORD)[1];
  const cradleZ = -0.2;
  const cradleY = py(cradleZ) + 0.2;
  for (const z of [cradleZ + 0.34, cradleZ - 0.34]) {
    timber(P.wood, FLYER.ash, [PX - 0.65, cradleY - 0.15, z], [PX + 0.65, cradleY - 0.15, z], 0.11, 0.08, { ...woodOpts, chamfer: 0.015 });
  }
  for (const s of [-1, 1]) {
    // Slide rails under the cradle, standing on the wing's ribs.
    const rz0 = cradleZ - 0.62;
    const rz1 = cradleZ + 0.62;
    timber(P.wood, FLYER.ash, [PX + s * 0.42, py(rz1) + 0.04, rz1], [PX + s * 0.42, py(rz0) + 0.04, rz0], 0.07, 0.07, { ...woodOpts, chamfer: 0.012 });
    // The cradle's curved sides, sweeping up around the hips.
    pipe(P.wood, FLYER.ash, [
      [PX + s * 0.46, cradleY - 0.12, cradleZ + 0.42], [PX + s * 0.5, cradleY + 0.12, cradleZ + 0.2],
      [PX + s * 0.5, cradleY + 0.16, cradleZ - 0.2], [PX + s * 0.46, cradleY - 0.12, cradleZ - 0.42],
    ], 0.05, { sides: 7, tubular: 12 });
    P.metal.push({
      geometry: spin([[0.03, -0.03, 'h'], [0.05, -0.03, 'h'], [0.05, 0.03, 'h'], [0.03, 0.03, 'h']], { segments: 8, closed: true }).translate(PX + s * 0.46, cradleY - 0.07, cradleZ),
      color: FLYER.iron,
    });
    // The warp wires, from the cradle out to the outer rear strut of each wing.
    const out = spar(UPPER, s * STATIONS[5], R_V);
    const low = spar(LOWER, s * STATIONS[5], R_V);
    wire([PX + s * 0.5, cradleY, cradleZ], [out[0], out[1] - 0.1, out[2]], 0.018);
    wire([PX + s * 0.5, cradleY, cradleZ], [low[0], low[1] + 0.1, low[2]], 0.018);
  }
  P.wood.push({
    geometry: solidLoft([
      { d: cradleZ - 0.3, w: 0.42, up: 0.07, dn: 0.05, a: PX, b: cradleY - 0.06, round: 0.5 },
      { d: cradleZ, w: 0.45, up: 0.05, dn: 0.05, a: PX, b: cradleY - 0.09, round: 0.5 },
      { d: cradleZ + 0.3, w: 0.42, up: 0.07, dn: 0.05, a: PX, b: cradleY - 0.06, round: 0.5 },
    ], { sides: 14, samples: 8 }),
    color: FLYER.leather,
  });
  // Foot rest toward the trailing edge, and the elevator lever at the left hand.
  const footZ = -2.3;
  timber(P.wood, FLYER.ash, [PX - 0.5, py(footZ) + 0.12, footZ], [PX + 0.5, py(footZ) + 0.12, footZ], 0.08, 0.08, { ...woodOpts, chamfer: 0.012 });
  for (const s of [-1, 1]) timber(P.wood, FLYER.ash, [PX + s * 0.42, py(footZ) - 0.01, footZ], [PX + s * 0.42, py(footZ) + 0.14, footZ], 0.06, 0.06, { ...woodOpts, up: [0, 0, 1] });
  const leverZ = 1.55;
  const leverX = PX + 0.62;
  const leverBase = [leverX, py(leverZ) - 0.02, leverZ];
  timber(P.wood, FLYER.ash, leverBase, [leverX, leverBase[1] + 1.25, leverZ - 0.05], 0.06, 0.08, { ...woodOpts, up: [0, 0, 1], chamfer: 0.012 });
  P.wood.push({
    geometry: spin([[0, -0.14], [0.05, -0.12], [0.055, 0.1], [0.04, 0.14], [0, 0.15]], { segments: 8 }).translate(leverX, leverBase[1] + 1.32, leverZ - 0.05),
    color: FLYER.leather,
  });
  rod(P.metal, FLYER.iron, [leverX, leverBase[1] + 0.3, leverZ], [1.6, E_LOW - 0.1, hang], 0.018, { sides: 6 });

  return groupOf(
    meshOf(P.fabric, { roughness: 0.92, metalness: 0, side: THREE.FrontSide, ...fabricMaps(11) }),
    meshOf(P.wood, { roughness: 0.6, metalness: 0, ...grainMaps({ seed: 17, knots: 1, strength: 0.15 }) }),
    meshOf(P.metal, { roughness: 0.42, metalness: 0.32 }),
  );
}

// ---------------------------------------------------------------------------
// The printing press, a wooden common press, life size
// ---------------------------------------------------------------------------
//
// NO PRESS OF GUTENBERG'S SURVIVES and nobody drew one until about 1499, so this is the common press
// those first pictures show, the machine every European printer used for three hundred years. It
// is all worked timber, because the press is a joiner's job adapted from a wine press: square oak,
// mortised and pegged, with the tenons standing proud through the cheeks where the wedges drive.
//
// HOW THE FORME LIES IS NOT A GUESS. The platen is only half the size of the sheet, so the bed is
// pulled in one page, pressed, run in again, pressed again. The two pages therefore lie side by side
// ALONG the rails, each headed toward one cheek. The tympan hinges at the outer end and folds down
// over them, which is why what is printed on its sheet lies at right angles to the machine and is
// the mirror of the type: the map from forme to sheet below is that fold, worked out, not chosen.

const PRESS = {
  oak: 0x846a4c,
  oakDark: 0x66503a,
  oakPale: 0x9c8460,
  peg: 0xc5a06e,
  iron: 0x2a2c2f,
  ironPale: 0x55595d,
  brass: 0xa98d4c,
  stone: 0xb9b4a8,
  chase: 0x3d4043,
  parchment: 0xd9c9a3,
  paper: 0xe9e2cf,
  leather: 0x4a2f1e,
  inked: 0x15130f,
  cord: 0xa98c60,
};

// Genesis in the Latin of the Vulgate, the first words Gutenberg's Bible sets. It is a public text
// and a true one: this is what a student of this press would have seen in that forme.
const VULGATE = 'In principio creavit Deus caelum et terram. Terra autem erat inanis et vacua, et tenebrae erant super faciem abyssi, et spiritus Dei ferebatur super aquas. Dixitque Deus: Fiat lux. Et facta est lux. Et vidit Deus lucem quod esset bona, et divisit lucem a tenebris. Appellavitque lucem diem, et tenebras noctem. Factumque est vespere et mane, dies unus. Dixit quoque Deus: Fiat firmamentum in medio aquarum, et dividat aquas ab aquis. Et fecit Deus firmamentum, divisitque aquas quae erant sub firmamento ab his quae erant super firmamentum. Et factum est ita. Vocavitque Deus firmamentum caelum. Et factum est vespere et mane, dies secundus. Dixit vero Deus: Congregentur aquae quae sub caelo sunt in locum unum, et appareat arida. Et factum est ita. Et vocavit Deus aridam terram, congregationesque aquarum appellavit maria. Et vidit Deus quod esset bonum. Et ait: Germinet terra herbam virentem et facientem semen, et lignum pomiferum faciens fructum iuxta genus suum. Et protulit terra herbam virentem, et facientem semen iuxta genus suum, lignumque faciens fructum, et habens unumquodque sementem secundum speciem suam. Et vidit Deus quod esset bonum. Et factum est vespere et mane, dies tertius. Dixit autem Deus: Fiant luminaria in firmamento caeli, et dividant diem ac noctem, et sint in signa et tempora et dies et annos, ut luceant in firmamento caeli, et illuminent terram. Et factum est ita. Fecitque Deus duo luminaria magna: luminare maius, ut praeesset diei, et luminare minus, ut praeesset nocti, et stellas. Et posuit eas in firmamento caeli, ut lucerent super terram, et praeessent diei ac nocti, et dividerent lucem ac tenebras. Et vidit Deus quod esset bonum. Et factum est vespere et mane, dies quartus. Dixit etiam Deus: Producant aquae reptile animae viventis, et volatile super terram sub firmamento caeli. Creavitque Deus cete grandia, et omnem animam viventem atque motabilem, quam produxerant aquae in species suas, et omne volatile secundum genus suum. Et vidit Deus quod esset bonum. Benedixitque eis, dicens: Crescite, et multiplicamini, et replete aquas maris, avesque multiplicentur super terram. Et factum est vespere et mane, dies quintus. Dixit quoque Deus: Producat terra animam viventem in genere suo, iumenta, et reptilia, et bestias terrae secundum species suas. Factumque est ita. Et fecit Deus bestias terrae iuxta species suas, et iumenta, et omne reptile terrae in genere suo. Et vidit Deus quod esset bonum, et ait: Faciamus hominem ad imaginem et similitudinem nostram.';

// Sets the two pages of a folio forme: two justified columns a page with a large initial, the way
// the 42-line Bible was laid out. `ink` is the type colour; `red` the rubricator's, which only a
// finished sheet has, since a rubricator worked by hand after the press.
function setFolio(ctx, W, H, { ink, red = null }) {
  const family = '"Old English Text MT", "UnifrakturMaguntia", Georgia, "Times New Roman", serif';
  const marginX = W * 0.045;
  const marginY = H * 0.075;
  const gutter = W * 0.05;
  const pageW = (W - marginX * 2 - gutter) / 2;
  const colGap = pageW * 0.05;
  const colW = (pageW - colGap) / 2;
  const lineH = (H - marginY * 2) / 26;
  const size = lineH * 0.8;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${family}`;
  const words = VULGATE.split(' ');
  let w = 0;
  for (let page = 0; page < 2; page++) {
    for (let col = 0; col < 2; col++) {
      const x0 = marginX + page * (pageW + gutter) + col * (colW + colGap);
      let row = 0;
      const initial = page === 0 && col === 0;
      if (initial) {
        ctx.save();
        ctx.font = `${lineH * 3.1}px ${family}`;
        ctx.fillStyle = red ?? ink;
        ctx.fillText('I', x0 + lineH * 0.2, marginY + lineH * 2.75);
        ctx.restore();
      }
      while (row < 26) {
        const indent = initial && row < 3 ? lineH * 1.5 : 0;
        const room = colW - indent;
        const line = [];
        let used = 0;
        const spaceW = ctx.measureText(' ').width;
        for (;;) {
          // The first word's I is the big initial, so the setting begins at its second letter.
          const word = w === 0 ? words[0].slice(1) : words[w % words.length];
          const wordW = ctx.measureText(word).width;
          if (line.length && used + spaceW + wordW > room) break;
          line.push([word, wordW]);
          used += (line.length > 1 ? spaceW : 0) + wordW;
          w += 1;
          if (line.length > 12) break;
        }
        const sum = line.reduce((a, b) => a + b[1], 0);
        const gap = line.length > 1 ? (room - sum) / (line.length - 1) : 0;
        let x = x0 + indent;
        const y = marginY + lineH * (row + 0.82);
        ctx.fillStyle = ink;
        for (const [word, wordW] of line) {
          ctx.fillText(word, x, y);
          x += wordW + gap;
        }
        row += 1;
      }
    }
  }
}

function printedSheetMap() {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#efe7d3';
  ctx.fillRect(0, 0, 1400, 960);
  // The fold between the two pages, and a little foxing on the sheet's edges.
  ctx.fillStyle = 'rgba(120,100,70,0.16)';
  ctx.fillRect(697, 0, 6, 960);
  setFolio(ctx, 1400, 960, { ink: '#1b1712', red: '#a22a1c' });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// The forme: the same setting, mirror reversed, light metal faces on the dark gaps between them.
function formeMaps() {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 960;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#23272b';
  ctx.fillRect(0, 0, 1400, 960);
  // Each line of type is a row of metal bodies, so the rows show between the letters.
  ctx.fillStyle = '#3a4045';
  const rows = 26;
  const lineH = (960 - 960 * 0.15) / rows;
  for (let r = 0; r < rows; r++) ctx.fillRect(0, 960 * 0.075 + r * lineH + lineH * 0.14, 1400, lineH * 0.74);
  ctx.save();
  ctx.translate(1400, 0);
  ctx.scale(-1, 1);
  setFolio(ctx, 1400, 960, { ink: '#d9dde0' });
  ctx.restore();
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: 0.5 };
}

// The press's great wooden screw: a right-handed thread cut into one surface, so a thread cannot
// float off its core. Worked out per vertex as a radius from the helix's phase.
function woodenScrew(rRoot, rCrest, pitch, y0, y1, tile) {
  const sides = 40;
  const perTurn = 20;
  const rows = Math.max(4, Math.round(((y1 - y0) / pitch) * perTurn));
  const ring = sides + 1;
  const pos = [];
  const uvs = [];
  const idx = [];
  const circ = Math.PI * 2 * rRoot;
  for (let i = 0; i <= rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    // The thread runs out at both ends, as a cut thread does.
    const end = Math.min(1, Math.min(y - y0, y1 - y) / (pitch * 0.5));
    for (let j = 0; j <= sides; j++) {
      const t = (j / sides) * Math.PI * 2;
      const frac = t / (Math.PI * 2) - y / pitch;
      const f = frac - Math.floor(frac);
      // A narrow V groove between broad flat crests, cut with a wooden tap, rather than a sine wave,
      // which reads as a turned baluster.
      const prof = THREE.MathUtils.smoothstep(Math.abs(f - 0.5) * 2, 0.12, 0.62);
      const r = rCrest - (rCrest - rRoot) * (1 - prof) * end;
      pos.push(Math.sin(t) * r, y, Math.cos(t) * r);
      uvs.push(((j / sides) * circ) / tile[0], y / tile[1]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + j + 1;
      const d = i * ring + j + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return weldSeam(g, ring, rows + 1);
}

// Points every UV at the sheet's blank margin, so a plain solid can share the printed sheet's material.
function blankUV(g) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.012, 0.012);
  return g;
}

function printingPress() {
  const rng = seededRandom(1455);
  const P = { oak: [], metal: [], paper: [], forme: [] };
  const oakOpts = { tile: [1.2, 2.6], rng, jitter: 0.1 };
  const big = { ...oakOpts, chamfer: 0.035 };
  const med = { ...oakOpts, chamfer: 0.02 };
  const fine = { ...oakOpts, chamfer: 0.01 };
  const OAK = PRESS.oak;
  const DARK = PRESS.oakDark;

  const CX = 1.0; // cheek centre
  const CW = 0.5; // cheek width across the press
  const CD = 0.58; // cheek depth
  const TOP = 6.15;

  // ----- The frame ----------------------------------------------------------------------------
  // A cross beam's tenon comes right through the cheek and stands proud, held by a driven wedge;
  // a peg through the cheek's face locks it too. These are what make it joinery rather than boxes.
  const crossBeam = (y0, y1, depth, color, z = 0, opts = big) => {
    const y = (y0 + y1) / 2;
    const h = y1 - y0;
    timber(P.oak, color, [-CX + CW * 0.48, y, z], [CX - CW * 0.48, y, z], depth, h, opts);
    for (const s of [-1, 1]) {
      const tw = depth * 0.58;
      const th = h * 0.62;
      timber(P.oak, color, [s * (CX - CW * 0.4), y, z], [s * (CX + CW * 0.5 + 0.16), y, z], tw, th, { ...fine, capShade: 0.5 });
      // The wedge through the tenon, on the outside of the cheek.
      timber(P.oak, PRESS.oakPale, [s * (CX + CW * 0.5 + 0.09), y - th * 0.5 - 0.05, z], [s * (CX + CW * 0.5 + 0.09), y + th * 0.5 + 0.05, z], 0.05, tw * 0.5, { ...fine, up: [0, 0, 1] });
      for (const dy of [-th * 0.25, th * 0.25]) {
        const zf = z + CD * 0.5;
        rod(P.metal, PRESS.peg, [s * CX, y + dy, zf - 0.02], [s * CX, y + dy, zf + 0.012], 0.032, { sides: 8 });
        rod(P.metal, PRESS.peg, [s * CX, y + dy, z - CD * 0.5 + 0.02], [s * CX, y + dy, z - CD * 0.5 - 0.012], 0.032, { sides: 8 });
      }
    }
  };
  for (const s of [-1, 1]) {
    // Cheek, sole and the two feet braces that stop it racking.
    timber(P.oak, OAK, [s * CX, 0.3, 0], [s * CX, TOP - 0.25, 0], CW, CD, { ...big, chamfer: 0.045, up: [0, 0, 1] });
    timber(P.oak, DARK, [s * CX, 0.19, 1.55], [s * CX, 0.19, -1.55], CW + 0.1, 0.38, { ...big, chamfer: 0.05 });
    for (const d of [-1, 1]) {
      timber(P.oak, OAK, [s * CX, 0.36, d * 1.24], [s * CX, 1.62, d * CD * 0.42], 0.3, 0.25, { ...med, up: [0, 0.5, d * 0.85] });
      rod(P.metal, PRESS.peg, [s * (CX - 0.17), 1.32, d * 0.42], [s * (CX + 0.17), 1.32, d * 0.42], 0.028, { sides: 7 });
    }
  }
  // The foot stretchers tying the two soles together.
  timber(P.oak, DARK, [-CX - 0.3, 0.2, -1.32], [CX + 0.3, 0.2, -1.32], 0.3, 0.32, big);
  timber(P.oak, DARK, [-CX - 0.3, 0.2, 1.32], [CX + 0.3, 0.2, 1.32], 0.3, 0.32, big);
  // Cap across the top, sitting over the cheeks, with its moulded ends.
  timber(P.oak, DARK, [-1.72, TOP - 0.24, 0], [1.72, TOP - 0.24, 0], 0.72, 0.48, { ...big, chamfer: 0.06 });
  timber(P.oak, OAK, [-1.62, TOP - 0.52, 0], [1.62, TOP - 0.52, 0], 0.62, 0.1, { ...med });
  crossBeam(4.5, 5.2, 0.62, DARK); // the head, which takes all the thrust of the screw
  crossBeam(1.72, 2.2, 0.62, DARK); // the winter, under the rails

  // Iron bands at the ends of the head, because that is where a head splits.
  for (const s of [-1, 1]) {
    const x = s * (CX - CW * 0.5 - 0.12);
    for (const [a, b] of [
      [[x, 4.47, 0.33], [x, 5.23, 0.33]], [[x, 4.47, -0.33], [x, 5.23, -0.33]],
      [[x, 5.23, 0.33], [x, 5.23, -0.33]], [[x, 4.47, 0.33], [x, 4.47, -0.33]],
    ]) strip(P.metal, PRESS.iron, a, b, 0.09, 0.022, { up: Math.abs(a[1] - b[1]) > 0.1 ? [0, 0, a[2] > 0 ? 1 : -1] : [0, a[1] > 4.8 ? 1 : -1, 0] });
    for (const y of [4.62, 5.08]) {
      for (const z of [0.337, -0.337]) dot(P.metal, PRESS.ironPale, 0.025, [x, y, z], { sides: 6 });
    }
  }

  // The till: two planks across the press with the square hose guided in the gap between them.
  const TILL = 3.5;
  for (const z of [-0.36, 0.36]) {
    timber(P.oak, OAK, [-CX + CW * 0.48, TILL, z * 0.72 + (z > 0 ? 0.13 : -0.13)], [CX - CW * 0.48, TILL, z * 0.72 + (z > 0 ? 0.13 : -0.13)], 0.14, 0.16, med);
  }
  for (const s of [-1, 1]) {
    timber(P.oak, OAK, [s * 0.3, TILL, -0.25], [s * 0.3, TILL, 0.25], 0.1, 0.14, med);
    timber(P.oak, OAK, [s * (CX - CW * 0.5 - 0.1), TILL, -0.33], [s * (CX - CW * 0.5 - 0.1), TILL, 0.33], 0.22, 0.14, med);
    for (const z of [-0.39, 0.39]) {
      timber(P.oak, DARK, [s * (CX - 0.2), TILL, z], [s * (CX + CW * 0.5 + 0.12), TILL, z], 0.1, 0.11, { ...fine, capShade: 0.5 });
    }
  }

  // ----- The screw, spindle and bar -----------------------------------------------------------
  const S = (g) => ({ geometry: g, color: PRESS.oakPale });
  P.oak.push(S(woodenScrew(0.165, 0.24, 0.2, 3.98, 4.56, [1.2, 2.6])));
  P.oak.push(S(woodenScrew(0.165, 0.24, 0.2, 5.14, 5.52, [1.2, 2.6])));
  P.oak.push({ geometry: spin([[0, 5.48], [0.22, 5.5], [0.22, 5.62], [0.12, 5.68], [0, 5.68]], { segments: 16 }), color: PRESS.oakPale });
  // Brass nut plate let into the underside of the head.
  P.metal.push({
    geometry: spin([[0.2, 4.44, 'h'], [0.33, 4.44, 'h'], [0.33, 4.52, 'h'], [0.2, 4.52, 'h']], { segments: 24, closed: true }),
    color: PRESS.brass,
  });
  P.metal.push({
    geometry: spin([[0.2, 5.18, 'h'], [0.3, 5.18, 'h'], [0.3, 5.23, 'h'], [0.2, 5.23, 'h']], { segments: 24, closed: true }),
    color: PRESS.brass,
  });
  // The spindle below the thread, with a collar where the bar passes through it.
  const BAR_Y = 3.85;
  P.metal.push({
    geometry: spin([
      [0, 3.12], [0.09, 3.12], [0.09, 3.24, 'h'], [0.15, 3.25], [0.15, 3.66, 'h'], [0.2, 3.67, 'h'], [0.2, 4.0, 'h'], [0.16, 4.04], [0, 4.04],
    ], { segments: 22 }),
    color: PRESS.ironPale,
  });
  const barDir = new THREE.Vector3(Math.cos(0.62), 0.05, Math.sin(0.62)).normalize();
  const barAt = (d) => [barDir.x * d, BAR_Y + barDir.y * d, barDir.z * d];
  rod(P.metal, PRESS.iron, [barDir.x * -0.34, BAR_Y - barDir.y * 0.34, barDir.z * -0.34], barAt(2.2), 0.06, { sides: 12 });
  // The wooden grip on the end of the bar, swelling where the pressman's hands went.
  const grip = spin([
    [0, -0.02], [0.082, -0.02], [0.095, 0.1], [0.12, 0.45], [0.105, 0.86], [0.08, 0.92], [0, 0.94],
  ], { segments: 14 }).translate(0, -0.46, 0);
  P.oak.push({ geometry: alongY(grip, barAt(1.88), barAt(2.8)), color: PRESS.oakPale });
  rod(P.metal, PRESS.iron, barAt(1.8), barAt(1.92), 0.09, { sides: 12 });
  // A rope catch on the cheek, the only thing that stopped a bar flying back into the pressman's
  // chest once the pull was finished.
  P.metal.push({ geometry: new THREE.TorusGeometry(0.11, 0.022, 6, 14).rotateY(Math.PI / 2).translate(CX + CW * 0.5, BAR_Y - 0.02, 0.28), color: PRESS.cord });
  pipe(P.metal, PRESS.cord, [[CX + CW * 0.5, BAR_Y + 0.1, 0.28], [CX + CW * 0.5 + 0.2, BAR_Y + 0.06, 0.72], barAt(1.3)], 0.016, { sides: 5, caps: false });

  // The hose: a square wooden sleeve round the spindle, sliding in the till, so the platen rises and
  // falls without turning however hard the screw above it turns.
  timber(P.oak, PRESS.oakPale, [0, 3.2, 0], [0, 3.78, 0], 0.44, 0.44, { ...med, up: [0, 0, 1] });
  for (const y of [3.28, 3.72]) {
    for (const [a, b, up] of [
      [[-0.235, y, 0.235], [0.235, y, 0.235], [0, 1, 0]], [[-0.235, y, -0.235], [0.235, y, -0.235], [0, 1, 0]],
      [[0.235, y, -0.235], [0.235, y, 0.235], [0, 1, 0]], [[-0.235, y, -0.235], [-0.235, y, 0.235], [0, 1, 0]],
    ]) strip(P.metal, PRESS.iron, a, b, 0.018, 0.04, { up });
  }

  // ----- The platen -------------------------------------------------------------------------
  const PLAT_Y0 = 2.94;
  const PLAT_Y1 = 3.14;
  timber(P.oak, DARK, [-0.56, (PLAT_Y0 + PLAT_Y1) / 2, 0], [0.56, (PLAT_Y0 + PLAT_Y1) / 2, 0], 0.78, PLAT_Y1 - PLAT_Y0, med);
  // The brass stool let in to take the toe of the spindle, and the iron plate under the wood.
  P.metal.push({ geometry: spin([[0, 3.1], [0.2, 3.1], [0.2, 3.16, 'h'], [0.11, 3.17], [0, 3.17]], { segments: 18 }), color: PRESS.brass });
  block(P.metal, PRESS.ironPale, 1.1, 0.03, 0.76, [0, PLAT_Y0 - 0.005, 0]);
  // Four ties from the hose's corners down to the platen's: the platen simply hangs from them.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const a = [sx * 0.22, 3.26, sz * 0.22];
      const b = [sx * 0.46, PLAT_Y1 + 0.005, sz * 0.31];
      rod(P.metal, PRESS.iron, a, b, 0.022, { sides: 6 });
      dot(P.metal, PRESS.iron, 0.04, b, { sides: 7, flat: 0.6 });
      dot(P.metal, PRESS.iron, 0.035, a, { sides: 7 });
    }
  }

  // ----- Rails, and the front stand they run out onto ----------------------------------------
  const RAIL_Y = 2.3;
  const RAIL_END = 3.6;
  for (const s of [-1, 1]) {
    timber(P.oak, DARK, [s * 0.42, RAIL_Y, -1.05], [s * 0.42, RAIL_Y, RAIL_END], 0.2, 0.2, med);
    strip(P.metal, PRESS.ironPale, [s * 0.42, RAIL_Y + 0.105, -1.0], [s * 0.42, RAIL_Y + 0.105, RAIL_END - 0.05], 0.09, 0.012);
    timber(P.oak, OAK, [s * 0.42, 0.24, 3.24], [s * 0.42, RAIL_Y - 0.08, 3.24], 0.26, 0.26, { ...med, up: [0, 0, 1] });
    timber(P.oak, OAK, [s * 0.42, 0.42, 3.72], [s * 0.42, 1.2, 3.32], 0.14, 0.14, { ...fine, up: [0, 0.4, 0.9] });
    timber(P.oak, DARK, [s * 0.42, 0.13, 2.6], [s * 0.42, 0.13, 3.86], 0.28, 0.26, { ...med, chamfer: 0.03 });
    // Rear rail post on the sole stretcher.
    timber(P.oak, OAK, [s * 0.42, 0.34, -0.9], [s * 0.42, RAIL_Y - 0.08, -0.9], 0.18, 0.18, { ...fine, up: [0, 0, 1] });
  }
  timber(P.oak, DARK, [-0.6, 0.18, 3.24], [0.6, 0.18, 3.24], 0.3, 0.3, med);
  timber(P.oak, OAK, [-0.56, RAIL_Y - 0.2, 3.24], [0.56, RAIL_Y - 0.2, 3.24], 0.2, 0.2, med);

  // ----- The carriage ----------------------------------------------------------------------------
  // The coffin is a shallow tray; the bed in it is a slab of stone, dead flat; and on that lies the
  // forme, pulled out here from under the platen so a student can read the type and ink it.
  const CZ0 = 0.72;
  const CZ1 = 3.0;
  const CH = 0.62;
  const BOT = RAIL_Y + 0.105;
  const FORME_Z0 = 1.05;
  const FORME_Z1 = 2.67;
  const FORME_HW = 0.5;
  const czc = (CZ0 + CZ1) / 2;
  timber(P.oak, DARK, [-CH, BOT + 0.06, czc], [CH, BOT + 0.06, czc], CZ1 - CZ0, 0.1, med);
  for (const s of [-1, 1]) {
    timber(P.oak, OAK, [s * (CH - 0.05), BOT + 0.17, CZ0], [s * (CH - 0.05), BOT + 0.17, CZ1], 0.1, 0.22, med);
    strip(P.metal, PRESS.ironPale, [s * 0.42, BOT + 0.006, CZ0 + 0.1], [s * 0.42, BOT + 0.006, CZ1 - 0.1], 0.05, 0.02);
  }
  for (const z of [CZ0 + 0.05, CZ1 - 0.05]) {
    timber(P.oak, OAK, [-CH, BOT + 0.17, z], [CH, BOT + 0.17, z], 0.1, 0.22, med);
  }
  const BED_Y = BOT + 0.19;
  block(P.metal, PRESS.stone, (CH - 0.1) * 2, 0.14, CZ1 - CZ0 - 0.2, [0, BED_Y - 0.07 + 0.0, czc]);
  // The chase: an iron frame locked round the type by wooden wedges and blocks.
  const FTOP = BED_Y + 0.1;
  const FW = FORME_HW;
  const FZM = (FORME_Z0 + FORME_Z1) / 2;
  const FZH = (FORME_Z1 - FORME_Z0) / 2;
  const edge = 0.07;
  for (const [a, b] of [
    [[-FW - edge, FTOP - 0.04, FZM - FZH - edge], [FW + edge, FTOP - 0.04, FZM - FZH - edge]],
    [[-FW - edge, FTOP - 0.04, FZM + FZH + edge], [FW + edge, FTOP - 0.04, FZM + FZH + edge]],
    [[-FW - edge, FTOP - 0.04, FZM - FZH - edge], [-FW - edge, FTOP - 0.04, FZM + FZH + edge]],
    [[FW + edge, FTOP - 0.04, FZM - FZH - edge], [FW + edge, FTOP - 0.04, FZM + FZH + edge]],
  ]) strip(P.metal, PRESS.chase, a, b, 0.05, 0.1);
  // Quoins and furniture in the gap inside the chase. Tapped tight, these hold thousands of loose
  // letters so firmly that the whole page could be lifted as one.
  for (let i = 0; i < 4; i++) {
    const z = FZM - FZH + 0.1 + i * ((FZH * 2 - 0.2) / 3);
    timber(P.oak, PRESS.oakPale, [FW + 0.024, FTOP - 0.05, z - 0.09], [FW + 0.024, FTOP - 0.05, z + 0.09], 0.035, 0.07, fine);
    timber(P.oak, PRESS.oakPale, [-FW - 0.024, FTOP - 0.05, z - 0.09], [-FW - 0.024, FTOP - 0.05, z + 0.09], 0.035, 0.07, fine);
  }
  block(P.metal, PRESS.chase, FW * 2 + 0.02, 0.08, FZH * 2 + 0.02, [0, FTOP - 0.05, FZM]);
  {
    // Facing the reader who stands at +X, with heads toward -X; a mirror image, so it runs right to
    // left. u runs along -Z and v along -X.
    const g = new THREE.PlaneGeometry(FZH * 2, FW * 2);
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0));
    m.setPosition(0, FTOP + 0.004, FZM);
    P.forme.push({ geometry: g.applyMatrix4(m), color: 0xffffff });
  }

  // ----- Tympan, frisket and the printed sheet ---------------------------------------------------
  // The tympan folds down onto the forme from its hinge at the outer end, and the sheet is pinned to
  // the face that closes on the type. Up, it leans on the gallows.
  const HZ = CZ1 + 0.04;
  const HY = BOT + 0.33;
  const LEAN = 0.38;
  const TL = 1.74;
  const THW = 0.58;
  const ex = new THREE.Vector3(1, 0, 0);
  const ey = new THREE.Vector3(0, Math.cos(LEAN), Math.sin(LEAN));
  const ez = new THREE.Vector3().crossVectors(ex, ey);
  const T = (x, y, z = 0) => {
    const v = new THREE.Vector3(0, HY, HZ).addScaledVector(ex, x).addScaledVector(ey, y).addScaledVector(ez, z);
    return [v.x, v.y, v.z];
  };
  const face = [ez.x, ez.y, ez.z];
  const frame = (list, color, hw, len, w, h, at = T, opts = fine) => {
    timber(list, color, at(-hw, 0.04), at(-hw, len), w, h, { ...opts, up: face });
    timber(list, color, at(hw, 0.04), at(hw, len), w, h, { ...opts, up: face });
    timber(list, color, at(-hw - w / 2, len), at(hw + w / 2, len), w, h, { ...opts, up: face });
    timber(list, color, at(-hw - w / 2, 0.04), at(hw + w / 2, 0.04), w, h, { ...opts, up: face });
  };
  frame(P.oak, OAK, THW, TL, 0.1, 0.05);
  // Two layers of stretched parchment. A blanket of them is what evened out the pull.
  timber(P.paper, PRESS.parchment, T(0, 0.07), T(0, TL - 0.03), THW * 2 - 0.02, 0.018, { up: face, capShade: 0.95, tile: [1e6, 1e6] });
  // The hinge straps, in iron, between tympan and coffin end.
  for (const s of [-1, 1]) {
    const hx = s * 0.34;
    rod(P.metal, PRESS.iron, [hx - 0.11, HY, HZ], [hx + 0.11, HY, HZ], 0.032, { sides: 8 });
    strip(P.metal, PRESS.iron, [hx, HY, HZ], T(hx, 0.34, 0.03), 0.09, 0.016, { up: face });
    strip(P.metal, PRESS.iron, [hx, HY + 0.012, HZ], [hx, BOT + 0.28, CZ1 - 0.28], 0.09, 0.016);
    for (const z of [0.12, 0.24]) dot(P.metal, PRESS.ironPale, 0.018, T(hx, z, 0.04), { sides: 5 });
  }
  // The sheet on the press-facing side of the tympan, pinned to the points.
  {
    const SW = 0.97;
    const SL = 1.46;
    const g = new THREE.PlaneGeometry(SL, SW, 8, 6);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (SL / 2);
      const y = pos.getY(i) / (SW / 2);
      pos.setZ(i, 0.018 * (x * x + y * y * 0.4) - 0.002 * Math.sin(x * 9));
    }
    g.computeVertexNormals();
    // Reading direction runs down the tympan, head of the page toward -X, as the fold gives it.
    const m = new THREE.Matrix4().makeBasis(ey.clone().negate(), ex.clone().negate(), ez.clone().negate());
    const c = T(0, 0.07 + (TL - 0.1) / 2, -0.02);
    m.setPosition(c[0], c[1], c[2]);
    P.paper.push({ geometry: g.applyMatrix4(m), color: 0xffffff });
    for (const s of [-1, 1]) {
      const pin = T(s * 0.24, 0.12 + (TL - 0.1) / 2 + (s > 0 ? -0.58 : 0.58), -0.045);
      rod(P.metal, PRESS.iron, [pin[0], pin[1], pin[2]], T(s * 0.24, 0.12 + (TL - 0.1) / 2 + (s > 0 ? -0.58 : 0.58), -0.002), 0.012, { sides: 5 });
    }
  }
  // The frisket: a light iron frame with a paper mask, hinged at the tympan's top and folded back on
  // past it. It came down over the sheet to keep the margins clean.
  const FRISK = 0.42;
  const fy = new THREE.Vector3(0, Math.cos(FRISK), -Math.sin(FRISK));
  const fz = new THREE.Vector3().crossVectors(ex, fy);
  const hinge = new THREE.Vector3(...T(0, TL + 0.03, 0.0));
  const Ff = (x, y, z = 0) => {
    const v = hinge.clone().addScaledVector(ex, x).addScaledVector(fy, y).addScaledVector(fz, z);
    return [v.x, v.y, v.z];
  };
  const fface = [fz.x, fz.y, fz.z];
  const FL = 1.5;
  const FHW = 0.54;
  for (const [a, b] of [
    [Ff(-FHW, 0), Ff(-FHW, FL)], [Ff(FHW, 0), Ff(FHW, FL)], [Ff(-FHW, FL), Ff(FHW, FL)], [Ff(-FHW, 0.03), Ff(FHW, 0.03)],
    [Ff(-FHW, FL * 0.5), Ff(FHW, FL * 0.5)], [Ff(0, 0), Ff(0, FL)],
  ]) strip(P.metal, PRESS.iron, a, b, 0.03, 0.02, { up: fface });
  // The frisket's paper, cut away where the type prints: four strips round each page.
  const fpaper = (x, y, w, l) => {
    const c = Ff(x, y);
    const g = new THREE.BoxGeometry(w, l, 0.006);
    const m = new THREE.Matrix4().makeBasis(ex, fy, fz);
    m.setPosition(c[0], c[1], c[2]);
    P.paper.push({ geometry: blankUV(g).applyMatrix4(m), color: PRESS.parchment });
  };
  fpaper(-FHW + 0.06, FL / 2, 0.12, FL - 0.02);
  fpaper(FHW - 0.06, FL / 2, 0.12, FL - 0.02);
  fpaper(0, 0.07, FHW * 2, 0.14);
  fpaper(0, FL - 0.07, FHW * 2, 0.14);
  fpaper(0, FL / 2, FHW * 2 - 0.2, 0.14);
  for (const s of [-1, 1]) rod(P.metal, PRESS.iron, [s * 0.34 - 0.08, hinge.y, hinge.z], [s * 0.34 + 0.08, hinge.y, hinge.z], 0.022, { sides: 7 });
  // The gallows the tympan leans back on.
  const gallowsAt = T(0, 1.26, 0.06);
  for (const s of [-1, 1]) {
    timber(P.oak, OAK, [s * 0.42, RAIL_Y + 0.05, gallowsAt[2]], [s * 0.42, gallowsAt[1], gallowsAt[2]], 0.09, 0.12, { ...fine, up: [0, 0, 1] });
  }
  timber(P.oak, OAK, [-0.5, gallowsAt[1], gallowsAt[2]], [0.5, gallowsAt[1], gallowsAt[2]], 0.1, 0.09, fine);

  // ----- The rounce ------------------------------------------------------------------------------
  // Crank this and a leather strap wound on its drum draws the carriage in under the platen.
  const RZ = 2.3;
  const RY = RAIL_Y - 0.28;
  rod(P.metal, PRESS.iron, [-1.42, RY, RZ], [0.5, RY, RZ], 0.045, { sides: 10 });
  P.oak.push({ geometry: onX(spin([[0.21, -0.26, 'h'], [0.0, -0.26], [0, 0.26], [0.21, 0.26, 'h']], { segments: 18 })), color: OAK, position: [0, RY, RZ] });
  for (const s of [-1, 1]) {
    block(P.metal, PRESS.iron, 0.07, 0.2, 0.2, [s * 0.42, RY + 0.06, RZ]);
  }
  // Crank wheel: four arms and a turned handle on the student's left of the bed.
  const CRX = -1.28;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const tip = [CRX, RY + Math.sin(a) * 0.5, RZ + Math.cos(a) * 0.5];
    timber(P.oak, OAK, [CRX, RY, RZ], tip, 0.07, 0.07, fine);
    if (i === 1) {
      P.oak.push({
        geometry: alongY(spin([[0, -0.2], [0.04, -0.2], [0.055, -0.05], [0.05, 0.14], [0.04, 0.2], [0, 0.2]], { segments: 10 }), [CRX - 0.42, tip[1], tip[2]], [CRX - 0.02, tip[1], tip[2]]),
        color: PRESS.oakPale,
      });
    }
  }
  P.metal.push({ geometry: onX(spin([[0.1, -0.05, 'h'], [0, -0.05], [0, 0.05], [0.1, 0.05, 'h']], { segments: 12 }), 1).translate(CRX, RY, RZ), color: PRESS.iron });
  // Leather girth from the drum to both ends of the coffin.
  for (const [z0, y0, z1, y1] of [[RZ + 0.2, RY + 0.08, CZ1 - 0.1, BOT - 0.005], [RZ - 0.2, RY + 0.08, CZ0 + 0.1, BOT - 0.005]]) {
    strip(P.metal, PRESS.leather, [0.14, y0, z0], [0.14, y1, z1], 0.12, 0.012);
  }

  // ----- The bank, with the printed heap and the inking gear ------------------------------------
  // The pressman's table. It holds what a press is FOR, in the one place a student can read it.
  const BX = -2.4;
  const BZ = 1.0;
  const BY = 2.76;
  const BW = 0.95;
  const BD = 0.82;
  timber(P.oak, OAK, [BX - BW, BY, BZ - BD * 0.5 - 0.18], [BX + BW, BY, BZ - BD * 0.5 - 0.18], 0.56, 0.1, med);
  timber(P.oak, OAK, [BX - BW, BY, BZ + BD * 0.5 + 0.18], [BX + BW, BY, BZ + BD * 0.5 + 0.18], 0.56, 0.1, med);
  timber(P.oak, OAK, [BX - BW, BY, BZ], [BX + BW, BY, BZ], 0.2, 0.1, med);
  for (const dx of [-BW + 0.1, BW - 0.1]) {
    for (const dz of [-BD + 0.05, BD - 0.05]) {
      timber(P.oak, DARK, [BX + dx, 0, BZ + dz], [BX + dx, BY - 0.04, BZ + dz], 0.2, 0.2, { ...med, up: [0, 0, 1] });
    }
    timber(P.oak, OAK, [BX + dx, 0.6, BZ - BD + 0.05], [BX + dx, 0.6, BZ + BD - 0.05], 0.12, 0.14, fine);
    timber(P.oak, OAK, [BX + dx, BY - 0.2, BZ - BD + 0.05], [BX + dx, BY - 0.2, BZ + BD - 0.05], 0.1, 0.2, fine);
  }
  timber(P.oak, OAK, [BX - BW + 0.1, 0.6, BZ], [BX + BW - 0.1, 0.6, BZ], 0.12, 0.14, fine);
  // A heap of finished sheets, its top one a printed page turned toward the student at the front.
  const heapX = BX + 0.42;
  const heapZ = BZ + 0.08;
  const HEAP_T = 0.16;
  P.paper.push({ geometry: blankUV(new THREE.BoxGeometry(1.0, HEAP_T, 0.7)), color: PRESS.paper, position: [heapX, BY + 0.05 + HEAP_T / 2, heapZ] });
  for (let i = 0; i < 9; i++) {
    const tone = 0xe9e2cf - (i % 3) * 0x0a0a0a;
    P.paper.push({
      geometry: blankUV(new THREE.BoxGeometry(1.0 + (i % 2) * 0.012, 0.012, 0.7 + ((i + 1) % 2) * 0.012)),
      color: tone,
      position: [heapX + (rng() - 0.5) * 0.02, BY + 0.05 + (i + 0.5) * (HEAP_T / 9), heapZ + (rng() - 0.5) * 0.02],
    });
  }
  {
    const g = new THREE.PlaneGeometry(1.02, 0.7, 8, 6);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      pos.setZ(i, 0.004 + 0.012 * Math.max(0, x - 0.2) * Math.max(0, x - 0.2) + 0.004 * y * y);
    }
    g.computeVertexNormals();
    g.rotateX(-Math.PI / 2);
    P.paper.push({ geometry: g.translate(heapX, BY + 0.05 + HEAP_T + 0.002, heapZ), color: 0xffffff });
  }
  // A composing stick, with a line of type half set in it. Every letter of every page was picked
  // out of a case by hand, one sort at a time, and set upside down in this.
  const stickZ = BZ + 0.64;
  const stickX = BX + 0.42;
  const stickY = BY + 0.05;
  strip(P.metal, PRESS.brass, [stickX - 0.42, stickY + 0.012, stickZ], [stickX + 0.42, stickY + 0.012, stickZ], 0.17, 0.016);
  strip(P.metal, PRESS.brass, [stickX - 0.42, stickY + 0.05, stickZ - 0.08], [stickX + 0.42, stickY + 0.05, stickZ - 0.08], 0.012, 0.09);
  strip(P.metal, PRESS.brass, [stickX - 0.41, stickY + 0.05, stickZ], [stickX - 0.41, stickY + 0.05, stickZ + 0.085], 0.02, 0.09);
  strip(P.metal, PRESS.ironPale, [stickX + 0.1, stickY + 0.05, stickZ], [stickX + 0.1, stickY + 0.05, stickZ + 0.085], 0.018, 0.08);
  for (let i = 0; i < 15; i++) {
    const wide = 0.024 + rng() * 0.018;
    const x = stickX - 0.38 + i * 0.032;
    block(P.metal, i % 5 === 4 ? PRESS.iron : PRESS.ironPale, wide, 0.042, 0.13, [x, stickY + 0.05, stickZ + 0.002]);
  }

  // The inking stone with a pool of ink worked out on it.
  const slabX = BX - 0.56;
  const slabZ = BZ + 0.05;
  timber(P.oak, DARK, [slabX - 0.32, BY + 0.09, slabZ], [slabX + 0.32, BY + 0.09, slabZ], 1.0, 0.08, { ...med, chamfer: 0.015 });
  P.metal.push({
    geometry: spin([[0, BY + 0.125], [0.1, BY + 0.125], [0.27, BY + 0.135], [0.22, BY + 0.14], [0, BY + 0.145]], { segments: 20 }).scale(1.1, 1, 1.5).translate(slabX, 0, slabZ - 0.02),
    color: PRESS.inked,
  });
  // The ink balls: a sheepskin pad stuffed with wool, nailed round a wooden cup with a handle. Two
  // were used together, dabbed across each other to even out the ink, then across the type.
  const inkBall = (m) => {
    const head = spin([
      [0, -0.1], [0.14, -0.09], [0.24, -0.04], [0.28, 0.04], [0.27, 0.12, 'h'], [0.25, 0.14, 'h'], [0.25, 0.16, 'h'], [0.22, 0.18, 'h'], [0.2, 0.23], [0.1, 0.27], [0, 0.28],
    ], { segments: 22 });
    const col = new Float32Array(head.attributes.position.count * 3);
    const pos = head.attributes.position;
    const leather = new THREE.Color(PRESS.leather);
    const inked = new THREE.Color(PRESS.inked);
    const cup = new THREE.Color(PRESS.oakPale);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const c = y < 0.03 ? inked : y < 0.15 ? leather : cup;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    head.setAttribute('color', new THREE.BufferAttribute(col, 3));
    P.oak.push({ geometry: head.applyMatrix4(m), keepColor: true });
    const stock = spin([[0, 0.24], [0.1, 0.25], [0.075, 0.42], [0.065, 0.68], [0.078, 0.84], [0.06, 0.92], [0, 0.93]], { segments: 12 });
    P.oak.push({ geometry: stock.applyMatrix4(m), color: PRESS.oakPale });
    // Tacks round the head's rim.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const v = new THREE.Vector3(Math.sin(a) * 0.255, 0.15, Math.cos(a) * 0.255).applyMatrix4(m);
      dot(P.metal, PRESS.ironPale, 0.014, [v.x, v.y, v.z], { sides: 5 });
    }
  };
  // One stands on its face on the stone; the other leans over with its handle on the first.
  inkBall(new THREE.Matrix4().makeTranslation(slabX + 0.03, BY + 0.235, slabZ - 0.14));
  {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.82, 0, 0.57).normalize(), 1.05);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(slabX - 0.02, BY + 0.24, slabZ + 0.36), q, new THREE.Vector3(1, 1, 1));
    inkBall(m);
  }

  // Bake the whole model back so its origin is at the base centre of the footprint.
  const group = groupOf(
    meshOf(P.oak, { roughness: 0.74, metalness: 0, ...grainMaps({ seed: 45, knots: 2, strength: 0.7, streaks: 190 }) }),
    meshOf(P.metal, { roughness: 0.46, metalness: 0.34 }),
    meshOf(P.paper, { roughness: 0.92, metalness: 0, map: printedSheetMap(), side: THREE.DoubleSide }),
    meshOf(P.forme, { roughness: 0.42, metalness: 0.3, side: THREE.DoubleSide, ...formeMaps() }),
  );
  for (const m of group.children) m.geometry.translate(0.3, 0, -1.08);
  return group;
}

export const BUILDERS = {
  'steam-locomotive': steamLocomotive,
  'wright-flyer': wrightFlyer,
  'printing-press': printingPress,
};
