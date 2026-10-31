import * as THREE from 'three';
import { standard, mesh, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, roundedOutline } from '../../props/LoftKit.js';
import {
  lin, mix, clamp01, sstep, alongMatrix, outward, tube, lathe, tintVertices,
} from '../ModelKit.js';

// The Model Database's fourth maths family: a balance in true level, the four conic sections cut by
// true planes, 1,234 in base ten blocks, a seven-disc Tower of Hanoi and a brass astrolabe.
//
// THE RULE OF THIS FILE, inherited from MathModels.js and Math3.js: NOTHING A STUDENT COUNTS, READS OR
// MEASURES IS DRAWN BY HAND. Each model starts from a small pure function that computes it, the builder
// draws what that function returned, and MATH4_LAYOUTS exports them so the arithmetic can be checked
// without looking.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Private solids and printing
// ---------------------------------------------------------------------------

// Flips any triangle that disagrees with its own vertex normals. A hand-built grid should MEASURE its
// winding rather than assume it, the Turkle Street lesson.
function windToNormals(g) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const idx = g.index.array;
  const a = V(0, 0, 0); const b = V(0, 0, 0); const c = V(0, 0, 0); const e = V(0, 0, 0); const f = V(0, 0, 0);
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t]; const j = idx[t + 1]; const k = idx[t + 2];
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k);
    e.subVectors(b, a); f.subVectors(c, a);
    e.cross(f);
    const dot = e.x * (n.getX(i) + n.getX(j) + n.getX(k)) + e.y * (n.getY(i) + n.getY(j) + n.getY(k)) + e.z * (n.getZ(i) + n.getZ(j) + n.getZ(k));
    if (dot < 0) { idx[t + 1] = k; idx[t + 2] = j; }
  }
  return g;
}

function indexed(positions, normals, uvs, index, colors = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

// A closed flat-capped prism from an outline in XY, from z0 to z1. Caps and sides own their vertices,
// so a flat face shades flat. `holes` are outlines in the same plane.
function prism(outline, z0, z1, holes = []) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let area = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) area += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  const pts = area < 0 ? [...outline].reverse() : outline;
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
  const flat = [...pts, ...holes.flat()];
  for (const [z, front] of [[z1, true], [z0, false]]) {
    const start = positions.length / 3;
    for (const [x, y] of flat) { positions.push(x, y, z); uvs.push(x, y); }
    for (const [a, b, c] of faces) {
      const ax = flat[a][0]; const ay = flat[a][1]; const bx = flat[b][0]; const by = flat[b][1]; const cx = flat[c][0]; const cy = flat[c][1];
      const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
      if (front === ccw) indices.push(start + a, start + b, start + c);
      else indices.push(start + a, start + c, start + b);
    }
  }
  const wall = (loop, outward2) => {
    let run = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];
      const step = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const at = positions.length / 3;
      positions.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
      uvs.push(run, 0, run + step, 0, run + step, z1 - z0, run, z1 - z0);
      if (outward2) indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
      else indices.push(at, at + 2, at + 1, at, at + 3, at + 2);
      run += step;
    }
  };
  wall(pts, true);
  for (const h of holes) {
    let ha = 0;
    for (let i = 0, j = h.length - 1; i < h.length; j = i++) ha += h[j][0] * h[i][1] - h[i][0] * h[j][1];
    wall(h, ha < 0);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

const slab = (x0, y0, x1, y1, z0, z1) => prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);

// A plan outline (x, depth) stood as a prism from y0 to y1. The depth coordinate is world z.
function plate(outline, y0, y1) {
  const g = prism(outline.map(([x, z]) => [x, -z]), y0, y1);
  g.rotateX(-Math.PI / 2);
  return g;
}

// Worked square timber between two points, with chamfered arrises and the grain along its length.
function timber(a, b, w, h, c = 0.03, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const hw = w / 2;
  const hh = h / 2;
  const section = [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]];
  const positions = [];
  const uvs = [];
  const indices = [];
  let run = 0;
  section.forEach((p, i) => {
    const q = section[(i + 1) % section.length];
    const at = positions.length / 3;
    const step = Math.hypot(q[0] - p[0], q[1] - p[1]);
    positions.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], len, p[0], p[1], len);
    uvs.push(0, run, 0, run + step, len, run + step, len, run);
    run += step;
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
  });
  for (const z of [0, len]) {
    const at = positions.length / 3;
    for (const p of section) { positions.push(p[0], p[1], z); uvs.push(p[0], p[1]); }
    for (let i = 1; i < section.length - 1; i++) {
      if (z === 0) indices.push(at, at + i + 1, at + i);
      else indices.push(at, at + i, at + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  const out = outward(g);
  out.applyMatrix4(m);
  return out;
}

// Grain that runs through the solid: a skew projection, so a disc shows long grain on its top and on the
// faces along the grain, and the lines carry on across a cut because they are functions of position.
function woodUV(g, su = 0.26, sv = 0.95, tilt = 0.7) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * su;
    uv[i * 2 + 1] = (p.getZ(i) + p.getY(i) * tilt) * sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// The same idea with the grain running up the solid, for anything turned from vertical stock.
function uprightUV(g, su = 0.3, sv = 0.75) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getY(i) * su;
    uv[i * 2 + 1] = (p.getX(i) + p.getZ(i) * 0.6) * sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Near-white timber grain, multiplied by the vertex colour, so one tile serves every wood in a model.
function grainMap(seed, { lines = 150, strength = 0.26, wander = 6 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f6f1ea';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const y = rng() * h;
      const a = 0.05 + rng() * strength;
      ctx.strokeStyle = rng() < 0.72 ? `rgba(70,42,22,${a})` : `rgba(255,240,214,${a})`;
      ctx.lineWidth = 0.6 + rng() * 2.2;
      const wobble = 1 + rng() * wander;
      const phase = rng() * TAU;
      const waves = 1 + Math.floor(rng() * 2);
      for (const shift of [-h, 0, h]) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const yy = y + shift + Math.sin((x / w) * TAU * waves + phase) * wobble;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Writes `text` at the largest size up to `size` that fits `maxWidth`: a line that runs off its plaque
// clipped mid-word is the project's most repeated bug.
function fitText(ctx, text, x, y, maxWidth, size, family = 'Arial, Helvetica, sans-serif', weight = 'bold') {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  const wide = ctx.measureText(text).width;
  if (wide > maxWidth) {
    px = Math.floor((size * maxWidth) / wide);
    ctx.font = `${weight} ${px}px ${family}`;
  }
  ctx.fillText(text, x, y);
  return px;
}

// A flat printed rectangle anywhere, facing `normal`, with `up` the way its text reads. `rect` is one
// rectangle of an atlas in canvas pixels.
function printedQuad(centre, normal, up, w, h, rect, atlasW, atlasH) {
  const n = V(...normal).normalize();
  const side = V(...up).cross(n).normalize();
  const u = n.clone().cross(side).normalize();
  const c = V(...centre);
  const at = (sx, sy) => c.clone().addScaledVector(side, sx * w * 0.5).addScaledVector(u, sy * h * 0.5);
  const [px, py, pw, ph] = rect;
  const u0 = px / atlasW; const u1 = (px + pw) / atlasW;
  const v0 = 1 - (py + ph) / atlasH; const v1 = 1 - py / atlasH;
  const P = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  const positions = [];
  const normals = [];
  for (const q of P) { positions.push(q.x, q.y, q.z); normals.push(n.x, n.y, n.z); }
  return indexed(positions, normals, [u0, v0, u1, v0, u1, v1, u0, v1], [0, 1, 2, 0, 2, 3]);
}

const flatColor = (g, c) => tintVertices(g, (x, y, z, out) => { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; });

// Polished metal with no environment map: the colour a mirror-bright turned surface would pick up from a
// sky and a floor, written in by which way each vertex faces. Call it on geometry in its final place.
function polish(g, hex, { sky = 1.05, horizon = 1.34, dark = 0.34, ground = 0.74, streak = 0.34, band = 0.14 } = {}) {
  const c = lin(hex);
  const n = g.attributes.normal;
  const arr = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i); const y = n.getY(i); const z = n.getZ(i);
    const up = mix(horizon, sky, Math.pow(Math.max(0, y), 0.8));
    const down = mix(dark, ground, sstep(-y, 0.16, 0.9));
    const k0 = mix(down, up, sstep(y, -0.16, -0.04));
    const side = Math.pow(1 - Math.min(1, Math.abs(y)), 2);
    const yaw = Math.atan2(x, z);
    // A window's bright stripe and the dark stripe beside it, which is most of what says "mirror-polished".
    const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    const glint = 0.62 * Math.exp(-((wrap(yaw + 0.55) / 0.2) ** 2)) - 0.3 * Math.exp(-((wrap(yaw - 0.8) / 0.34) ** 2));
    const k = k0 * (1 + side * (streak * Math.cos(2 * yaw + 0.7) + band * Math.cos(5 * yaw + 2.1) + glint));
    arr[i * 3] = c[0] * k; arr[i * 3 + 1] = c[1] * k; arr[i * 3 + 2] = c[2] * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// The volume of a solid of revolution from its profile (r, y), by Pappus over the closed polygon.
function revolvedVolume(profile) {
  let v = 0;
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[(i + 1) % n];
    v += (y1 - y0) * (r0 * r0 + r0 * r1 + r1 * r1);
  }
  return Math.abs((Math.PI / 3) * v);
}

// A rounded corner for a turned profile, from the end of one straight run to the start of the next.
function arcPts(cr, cy, radius, from, to, steps = 5) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = mix(from, to, i / steps);
    out.push([cr + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return out;
}

// One link of a chain: a stadium-shaped ring of round wire, closed in both directions, long along +Z and
// lying in the XZ plane. Length and width are measured on the wire's centre line.
function chainLink(length, width, wire, { steps = 12, sides = 5 } = {}) {
  const radius = width / 2;
  const straight = Math.max(0, length - width);
  const perimeter = 2 * straight + TAU * radius;
  const path = [];
  for (let k = 0; k < steps; k++) {
    let s = (k / steps) * perimeter;
    if (s < straight) { path.push({ x: radius, z: -straight / 2 + s, nx: 1, nz: 0 }); continue; }
    s -= straight;
    if (s < Math.PI * radius) {
      const a = s / radius;
      path.push({ x: Math.cos(a) * radius, z: straight / 2 + Math.sin(a) * radius, nx: Math.cos(a), nz: Math.sin(a) });
      continue;
    }
    s -= Math.PI * radius;
    if (s < straight) { path.push({ x: -radius, z: straight / 2 - s, nx: -1, nz: 0 }); continue; }
    s -= straight;
    const a = Math.PI + s / radius;
    path.push({ x: Math.cos(a) * radius, z: -straight / 2 + Math.sin(a) * radius, nx: Math.cos(a), nz: Math.sin(a) });
  }
  const positions = []; const normals = []; const uvs = []; const index = [];
  for (let k = 0; k < steps; k++) {
    const q = path[k];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * TAU;
      const cx = Math.cos(a); const sy = Math.sin(a);
      positions.push(q.x + q.nx * cx * wire, sy * wire, q.z + q.nz * cx * wire);
      normals.push(q.nx * cx, sy, q.nz * cx);
      uvs.push(k / steps, j / sides);
    }
  }
  for (let k = 0; k < steps; k++) {
    const k2 = (k + 1) % steps;
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      index.push(k * sides + j, k2 * sides + j, k2 * sides + j2, k * sides + j, k2 * sides + j2, k * sides + j2);
    }
  }
  return windToNormals(indexed(positions, normals, uvs, index));
}

// A torus about the +Y axis at the origin.
function ringY(R, r, segments = 28, sides = 8) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU - Math.PI / 2;
    pts.push([R + Math.cos(a) * r, Math.sin(a) * r]);
  }
  pts.push(pts[0]);
  return lathe(pts, segments);
}

// ---------------------------------------------------------------------------
// Tower of Hanoi
// ---------------------------------------------------------------------------

export function hanoiLayout() {
  const count = 7;
  const thickness = 0.31;
  const rMin = 0.52;
  const rStep = 0.145;
  const baseTop = 0.78;
  const ferrule = 0.03;
  const pegRadius = 0.17;
  const hole = 0.205;
  const pegZ = -0.32;
  const pegX = [-3, 0, 3];
  const discs = [];
  for (let i = 0; i < count; i++) {
    // i = 0 is the bottom and the biggest.
    const size = count - i;
    discs.push({ size, radius: rMin + (size - 1) * rStep, y0: baseTop + ferrule + i * thickness, y1: baseTop + ferrule + (i + 1) * thickness });
  }
  const stackTop = discs[count - 1].y1;
  return {
    count, thickness, rMin, rStep, baseTop, ferrule, pegRadius, hole, pegZ, pegX, discs, stackTop,
    pegTop: stackTop + 0.72,
    moves: 2 ** count - 1,
  };
}

const RAINBOW = [0xd9302b, 0xee7a1c, 0xf2c018, 0x3aa83d, 0x1f7fd0, 0x4a3fb5, 0x8e36a8];

function hanoiDisc(radius, hole, h) {
  const e = Math.min(0.1, h * 0.34);
  const c = 0.02;
  // Bottom up and closed: under the disc, round its rim, over the top, down the hole.
  const profile = [
    [hole + c, 0], [radius - e, 0],
    ...arcPts(radius - e, e, e, -Math.PI / 2, 0, 5).slice(1),
    ...arcPts(radius - e, h - e, e, 0, Math.PI / 2, 5).slice(1),
    [hole + c, h], [hole, h - c], [hole, c], [hole + c, 0],
  ];
  return lathe(profile, 72);
}

function buildHanoi() {
  const L = hanoiLayout();
  const group = new THREE.Group();
  const { baseTop, pegZ } = L;
  const baseFront = 2.18;
  const baseBack = -2.0;
  const baseZ = (baseFront + baseBack) / 2;

  // The discs: one rainbow, polished, with the wood's own figure showing through.
  const discs = [];
  L.discs.forEach((d, i) => {
    const g = hanoiDisc(d.radius, L.hole, L.thickness);
    g.translate(L.pegX[0], d.y0, pegZ);
    woodUV(g, 0.3, 1.25, 0.9);
    // Shifting each disc's grain, so seven discs are not cut from one plank in register.
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) { uv.setX(k, uv.getX(k) + i * 0.37); uv.setY(k, uv.getY(k) + i * 0.61); }
    const c = lin(RAINBOW[i]);
    const nrm = g.attributes.normal;
    tintVertices(g, (x, y, z, out, at) => {
      // A soft sheen where an edge turns to the sky: a lacquered toy, not a painted one.
      const k = 0.92 + 0.2 * Math.max(0, nrm.getY(at)) + 0.08 * (1 - Math.abs(nrm.getY(at)));
      out[0] = Math.min(1, c[0] * k); out[1] = Math.min(1, c[1] * k); out[2] = Math.min(1, c[2] * k);
    });
    discs.push({ geometry: g, keepColor: true });
  });
  group.add(mesh(mergeParts(discs), standard({ map: grainMap(7101, { lines: 190, strength: 0.17, wander: 3 }), vertexColors: true, roughness: 0.3, metalness: 0 })));

  // The wood: a moulded plinth, a sloping lectern for the rule, and three turned pegs.
  const wood = [];
  const walnut = 0x6a3f20;
  const halfW = 4.6;
  const rounded = (inset) => roundedOutline(halfW - inset, (baseFront - baseBack) / 2 - inset, 0.22, 5).map(([x, z]) => [x, z + baseZ]);
  const mould = [[0, 0.0, 0.14], [0.05, 0.14, 0.2], [0.1, 0.2, 0.3]];
  for (const [inset, y0, y1] of mould) wood.push({ geometry: woodUV(plate(rounded(inset), y0, y1), 0.24, 1.1), color: walnut });
  // The deck the pegs stand in, and the sloped lectern that carries the rule in front of it.
  const deckFront = 1.24;
  const deckOutline = roundedOutline(halfW - 0.16, (deckFront - baseBack) / 2 - 0.16, 0.16, 4).map(([x, z]) => [x, z + (deckFront + baseBack) / 2]);
  wood.push({ geometry: woodUV(plate(deckOutline, 0.3, baseTop), 0.24, 1.1), color: 0x7a4a26 });
  const slopeTopZ = deckFront - 0.16;
  const slopeFrontZ = baseFront - 0.12;
  const slopeLow = 0.3;
  // The outline is drawn with x = -z so that the rotation below sends it to world z.
  const wedge = prism([[-slopeFrontZ, slopeLow], [-slopeTopZ, baseTop], [-slopeTopZ + 0.3, baseTop], [-slopeTopZ + 0.3, slopeLow]], -halfW + 0.2, halfW - 0.2);
  wedge.rotateY(Math.PI / 2);
  wood.push({ geometry: woodUV(wedge, 0.24, 1.1), color: 0x7a4a26 });

  // Pegs: plain maple dowels with a domed end, the way a real toy's are.
  L.pegX.forEach((x) => {
    const r = L.pegRadius;
    const y0 = baseTop - 0.04;
    const y1 = L.pegTop;
    const g = lathe([[0, y0], [r, y0], ...arcPts(0, y1 - r, r, 0, Math.PI / 2, 8)], 40);
    g.translate(x, 0, pegZ);
    uprightUV(g);
    wood.push({ geometry: g, color: 0xd9a766 });
  });
  group.add(mesh(mergeParts(wood), standard({ map: grainMap(7102, { lines: 150, strength: 0.3 }), vertexColors: true, roughness: 0.42, metalness: 0 })));

  // Brass: a ferrule round the foot of each peg, and a frame round the printed rule.
  const brassParts = [];
  L.pegX.forEach((x) => {
    const g = lathe([[0, baseTop - 0.01], [L.hole - 0.008, baseTop - 0.01], [L.hole - 0.008, baseTop + L.ferrule - 0.006], [L.hole - 0.016, baseTop + L.ferrule], [0, baseTop + L.ferrule]], 32);
    g.translate(x, 0, pegZ);
    brassParts.push({ geometry: polish(g, 0xc39a45), keepColor: true });
  });

  // The printing. A slope's normal comes from its own rise and run, and the plaque sits a hair above it.
  const run = slopeFrontZ - slopeTopZ;
  const rise = baseTop - slopeLow;
  const slopeLen = Math.hypot(run, rise);
  const n = [0, run / slopeLen, rise / slopeLen];
  const slopeDir = [0, -rise / slopeLen, run / slopeLen]; // down the slope, toward the student
  const mid = [0, (baseTop + slopeLow) / 2, (slopeTopZ + slopeFrontZ) / 2];
  const plaqueW = 8.2;
  const plaqueH = slopeLen - 0.14;
  // The canvas takes the plaque's own aspect, or every letter on it comes out squashed.
  const PW = 2048;
  const PH = Math.round((PW * plaqueH) / plaqueW);
  const atlas = canvasTexture(PW, PH, (ctx, w, h) => {
    ctx.fillStyle = '#efe4c8';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2a1c10';
    const lines = [
      'Move all seven discs to another peg.',
      'Move one disc at a time.',
      'Never put a bigger disc on a smaller one.',
    ];
    lines.forEach((t, i) => fitText(ctx, t, 44, h * (0.2 + i * 0.3), 1120, h * 0.25, 'Georgia, "Times New Roman", serif', 'normal'));
    ctx.fillStyle = '#b08d4e';
    ctx.fillRect(1205, h * 0.1, 5, h * 0.8);
    // 2 to the 7, with a real raised exponent, read off the layout's own count.
    ctx.fillStyle = '#8c1f1a';
    const big = h * 0.42;
    const yy = h * 0.42;
    const x0 = 1250;
    const rest = `- 1 = ${L.moves} moves`;
    const fit = (px) => {
      ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`;
      const a2 = ctx.measureText('2').width; const a3 = ctx.measureText(rest).width;
      ctx.font = `bold ${px * 0.6}px Georgia, "Times New Roman", serif`;
      return a2 + ctx.measureText(String(L.count)).width + a3 + 22;
    };
    const px = fit(big) > 760 ? (big * 760) / fit(big) : big;
    ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`;
    ctx.fillText('2', x0, yy);
    const w2 = ctx.measureText('2').width;
    ctx.font = `bold ${px * 0.6}px Georgia, "Times New Roman", serif`;
    ctx.fillText(String(L.count), x0 + w2 + 2, yy - px * 0.26);
    const w7 = ctx.measureText(String(L.count)).width;
    ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`;
    ctx.fillText(rest, x0 + w2 + w7 + 20, yy);
    ctx.fillStyle = '#2a1c10';
    fitText(ctx, 'the fewest that can possibly do it', x0, h * 0.76, 760, h * 0.2, 'Georgia, "Times New Roman", serif', 'normal');
  });
  const printed = [];
  printed.push(printedQuad([mid[0], mid[1] + n[1] * 0.006, mid[2] + n[2] * 0.006], n, [0, -slopeDir[1], -slopeDir[2]], plaqueW, plaqueH, [0, 0, PW, PH], PW, PH));
  group.add(mesh(mergeParts(printed.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map: atlas, vertexColors: true, roughness: 0.55, metalness: 0 })));

  // The plaque's brass frame: four mitred-looking strips laid on the slope.
  const frame = (a, b) => {
    const g = timber(a, b, 0.05, 0.035, 0.008, n);
    return { geometry: polish(g, 0xc39a45), keepColor: true };
  };
  const hw = plaqueW / 2 + 0.03;
  const hh = plaqueH / 2 + 0.03;
  const corner = (sx, sy) => [sx * hw, mid[1] - sy * hh * slopeDir[1] + n[1] * 0.012, mid[2] - sy * hh * slopeDir[2] + n[2] * 0.012];
  brassParts.push(frame(corner(-1, -1), corner(1, -1)), frame(corner(1, -1), corner(1, 1)), frame(corner(1, 1), corner(-1, 1)), frame(corner(-1, 1), corner(-1, -1)));
  group.add(mesh(mergeParts(brassParts), standard({ vertexColors: true, roughness: 0.34, metalness: 0.4 })));
  return group;
}

// ---------------------------------------------------------------------------
// Base ten blocks
// ---------------------------------------------------------------------------

// A block of unit cubes, each a real chamfered cube, of which only the facets that can be seen are
// emitted. Where two neighbours meet, their chamfers form a true V groove, which is what scores the
// block into units: real light and shade in the score, at about 14 triangles a visible square.
function scoredBlock(nx, ny, nz, u, b, base, { groove = 0.34, arris = 1.12, seed = 1 } = {}) {
  const rng = seededRandom(seed);
  const positions = []; const normals = []; const uvs = []; const colors = []; const index = [];
  let cells = 0;
  let faces = 0;
  const cell = [nx, ny, nz];
  const longest = Math.max(nx, ny, nz);
  const skew = rng() * 10;
  const uvOf = (x, y, z, nrm) => {
    // Grain runs along the block's longest dimension, on whichever face this is.
    const ax = Math.abs(nrm[0]); const ay = Math.abs(nrm[1]);
    const pick = ax >= ay && ax >= Math.abs(nrm[2]) ? [z, y] : ay >= Math.abs(nrm[2]) ? [x, z] : [x, y];
    let along = pick[0]; let across = pick[1];
    if (longest === ny && ay < 0.5) { along = y; across = ax > 0.5 ? z : x; }
    if (longest === nz && ay >= 0.5 && nz > nx) { along = z; across = x; }
    return [along * 0.3 + skew, across * 1.1 + skew * 0.3];
  };
  const emit = (pts, nrm, shade, tone) => {
    const at = positions.length / 3;
    const len = Math.hypot(nrm[0], nrm[1], nrm[2]);
    const n = [nrm[0] / len, nrm[1] / len, nrm[2] / len];
    for (const p of pts) {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      const t = uvOf(p[0], p[1], p[2], n);
      uvs.push(t[0], t[1]);
      colors.push(Math.min(1, base[0] * shade * tone), Math.min(1, base[1] * shade * tone), Math.min(1, base[2] * shade * tone));
    }
    if (pts.length === 3) index.push(at, at + 1, at + 2);
    else index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        cells += 1;
        const ex = [i === 0, i === nx - 1, j === 0, j === ny - 1, k === 0, k === nz - 1];
        if (!ex.some(Boolean)) continue;
        const x0 = i * u; const x1 = x0 + u; const y0 = j * u; const y1 = y0 + u; const z0 = k * u; const z1 = z0 + u;
        const tone = 0.965 + rng() * 0.07;
        const xi = [x0 + b, x1 - b]; const yi = [y0 + b, y1 - b]; const zi = [z0 + b, z1 - b];
        // Flats.
        if (ex[1]) { emit([[x1, yi[0], zi[1]], [x1, yi[0], zi[0]], [x1, yi[1], zi[0]], [x1, yi[1], zi[1]]], [1, 0, 0], 1, tone); faces += 1; }
        if (ex[0]) { emit([[x0, yi[0], zi[0]], [x0, yi[0], zi[1]], [x0, yi[1], zi[1]], [x0, yi[1], zi[0]]], [-1, 0, 0], 1, tone); faces += 1; }
        if (ex[3]) { emit([[xi[0], y1, zi[1]], [xi[1], y1, zi[1]], [xi[1], y1, zi[0]], [xi[0], y1, zi[0]]], [0, 1, 0], 1, tone); faces += 1; }
        if (ex[2]) { emit([[xi[0], y0, zi[0]], [xi[1], y0, zi[0]], [xi[1], y0, zi[1]], [xi[0], y0, zi[1]]], [0, -1, 0], 1, tone); faces += 1; }
        if (ex[5]) { emit([[xi[0], yi[0], z1], [xi[1], yi[0], z1], [xi[1], yi[1], z1], [xi[0], yi[1], z1]], [0, 0, 1], 1, tone); faces += 1; }
        if (ex[4]) { emit([[xi[1], yi[0], z0], [xi[0], yi[0], z0], [xi[0], yi[1], z0], [xi[1], yi[1], z0]], [0, 0, -1], 1, tone); faces += 1; }
        // Chamfers along the twelve edges. Darkened where it is the wall of a score, a little brighter
        // where it is the block's own arris, catching the light.
        const pick = (a, c) => (a && c ? arris : groove);
        for (const sx of [0, 1]) {
          for (const sy of [0, 1]) {
            const eX = ex[sx]; const eY = ex[2 + sy];
            if (eX || eY) {
              const X = sx ? x1 : x0; const Y = sy ? y1 : y0;
              const a = [X, yi[sy], zi[0]]; const c = [xi[sx], Y, zi[0]]; const d = [xi[sx], Y, zi[1]]; const e = [X, yi[sy], zi[1]];
              const nr = [sx ? 1 : -1, sy ? 1 : -1, 0];
              const flip = (sx === sy);
              emit(flip ? [a, c, d, e] : [a, e, d, c], nr, pick(eX, eY), tone);
            }
          }
        }
        for (const sy of [0, 1]) {
          for (const sz of [0, 1]) {
            const eY = ex[2 + sy]; const eZ = ex[4 + sz];
            if (eY || eZ) {
              const Y = sy ? y1 : y0; const Z = sz ? z1 : z0;
              const a = [xi[0], Y, zi[sz]]; const c = [xi[0], yi[sy], Z]; const d = [xi[1], yi[sy], Z]; const e = [xi[1], Y, zi[sz]];
              const nr = [0, sy ? 1 : -1, sz ? 1 : -1];
              const flip = (sy === sz);
              emit(flip ? [a, c, d, e] : [a, e, d, c], nr, pick(eY, eZ), tone);
            }
          }
        }
        for (const sx of [0, 1]) {
          for (const sz of [0, 1]) {
            const eX = ex[sx]; const eZ = ex[4 + sz];
            if (eX || eZ) {
              const X = sx ? x1 : x0; const Z = sz ? z1 : z0;
              const a = [X, yi[0], zi[sz]]; const c = [xi[sx], yi[0], Z]; const d = [xi[sx], yi[1], Z]; const e = [X, yi[1], zi[sz]];
              const nr = [sx ? 1 : -1, 0, sz ? 1 : -1];
              const flip = (sx !== sz);
              emit(flip ? [a, c, d, e] : [a, e, d, c], nr, pick(eX, eZ), tone);
            }
          }
        }
        // The corner triangles, which close the pit where four scores meet.
        for (const sx of [0, 1]) {
          for (const sy of [0, 1]) {
            for (const sz of [0, 1]) {
              if (!(ex[sx] || ex[2 + sy] || ex[4 + sz])) continue;
              const X = sx ? x1 : x0; const Y = sy ? y1 : y0; const Z = sz ? z1 : z0;
              const a = [X, yi[sy], zi[sz]]; const c = [xi[sx], Y, zi[sz]]; const d = [xi[sx], yi[sy], Z];
              const nr = [sx ? 1 : -1, sy ? 1 : -1, sz ? 1 : -1];
              const parity = (sx + sy + sz) % 2 === 1;
              const allOut = ex[sx] && ex[2 + sy] && ex[4 + sz];
              emit(parity ? [a, d, c] : [a, c, d], nr, allOut ? arris : groove, tone);
            }
          }
        }
      }
    }
  }
  const g = windToNormals(indexed(positions, normals, uvs, index, colors));
  return { geometry: g, cells, faces };
}

export function baseTenLayout() {
  const u = 0.35;
  const gap = 0.05;
  const columns = [
    { name: 'THOUSANDS', digit: 1, value: 1000, size: [10, 10, 10], width: 3.74, color: 0x2a78d8, tint: 0xcfe2f7 },
    { name: 'HUNDREDS', digit: 2, value: 100, size: [10, 1, 10], width: 3.74, color: 0x2ea650, tint: 0xd2efd8 },
    { name: 'TENS', digit: 3, value: 10, size: [1, 1, 10], width: 1.3, color: 0xf0921e, tint: 0xfce7c8 },
    { name: 'ONES', digit: 4, value: 1, size: [1, 1, 1], width: 0.86, color: 0xdf3b34, tint: 0xf8d3cf },
  ];
  const matWidth = columns.reduce((s, c) => s + c.width, 0);
  const tableTop = 1.34;
  const matTop = tableTop + 0.022;
  const zoneBack = -2.05; // the back edge of every block lying on the mat
  const zoneFront = zoneBack + 10 * u;
  let x = -matWidth / 2;
  const blocks = [];
  for (const c of columns) {
    c.x0 = x; c.x1 = x + c.width;
    const cx = (c.x0 + c.x1) / 2;
    if (c.name === 'THOUSANDS') {
      blocks.push({ column: c.name, size: c.size, origin: [cx - 5 * u, matTop, zoneBack], upright: false });
    } else if (c.name === 'HUNDREDS') {
      // One lies on the mat and one stands behind it, so both faces of ten-by-ten are in plain view.
      blocks.push({ column: c.name, size: c.size, origin: [cx - 5 * u, matTop, zoneBack], upright: false });
      blocks.push({ column: c.name, size: [10, 10, 1], origin: [cx - 5 * u, matTop, zoneBack - 0.42], upright: true });
    } else if (c.name === 'TENS') {
      for (let i = 0; i < c.digit; i++) blocks.push({ column: c.name, size: c.size, origin: [cx - ((c.digit * u + (c.digit - 1) * gap) / 2) + i * (u + gap), matTop, zoneBack], upright: false });
    } else {
      // Four ones in a square, at the front of their column.
      for (let i = 0; i < c.digit; i++) {
        const ix = i % 2; const iz = Math.floor(i / 2);
        // The rows are a foot apart: from a 5ft eye the front pair would otherwise hide the back pair.
        blocks.push({ column: c.name, size: c.size, origin: [cx - (u + gap / 2) + ix * (u + gap), matTop, zoneFront - u - (1 - iz) * 1.15], upright: false });
      }
    }
    x += c.width;
  }
  const units = (b) => b.size[0] * b.size[1] * b.size[2];
  const total = blocks.reduce((s, b) => s + units(b), 0);
  const number = columns.reduce((s, c) => s + c.digit * c.value, 0);
  return { u, gap, columns, matWidth, tableTop, matTop, zoneBack, zoneFront, blocks, total, number, stripFront: 3.0, stripBack: zoneFront + 0.05, matBack: -2.72 };
}

function buildBaseTen() {
  const L = baseTenLayout();
  if (L.total !== 1234 || L.number !== 1234) throw new Error('base-ten-blocks: the units do not add up to 1234');
  const group = new THREE.Group();
  const chamfer = 0.017;
  const colourOf = Object.fromEntries(L.columns.map((c) => [c.name, c]));

  // Every block, each unit its own chamfered cube. A dark core sits at the depth of the score, so the
  // pit where four scores meet looks into wood and never through the block.
  const parts = [];
  const counted = { thousands: 0, hundreds: 0, tens: 0, ones: 0 };
  L.blocks.forEach((b, i) => {
    const base = lin(colourOf[b.column].color);
    const { geometry, cells } = scoredBlock(b.size[0], b.size[1], b.size[2], L.u, chamfer, base, { seed: 7200 + i });
    counted[b.column.toLowerCase()] += cells;
    const core = new THREE.BoxGeometry(b.size[0] * L.u - chamfer * 2.05, b.size[1] * L.u - chamfer * 2.05, b.size[2] * L.u - chamfer * 2.05);
    core.translate((b.size[0] * L.u) / 2, (b.size[1] * L.u) / 2, (b.size[2] * L.u) / 2);
    const m = new THREE.Matrix4();
    if (b.upright) {
      // The standing flat leans back on its stand, about the bottom of its back face.
      const lean = 7 * DEG;
      m.makeTranslation(b.origin[0], b.origin[1], b.origin[2]);
      m.multiply(new THREE.Matrix4().makeRotationX(-lean));
    } else {
      m.makeTranslation(b.origin[0], b.origin[1], b.origin[2]);
    }
    geometry.applyMatrix4(m);
    core.applyMatrix4(m);
    parts.push({ geometry, keepColor: true });
    const dark = lin(colourOf[b.column].color).map((v) => v * 0.2);
    parts.push({ geometry: flatColor(core, dark), keepColor: true });
  });
  group.userData.unitCounts = counted;
  group.add(mesh(mergeParts(parts), standard({ map: grainMap(7203, { lines: 90, strength: 0.07, wander: 2.5 }), vertexColors: true, roughness: 0.6, metalness: 0 })));

  // The table: top, apron and four tapered legs, in oak.
  const wood = [];
  const halfW = L.matWidth / 2 + 0.2;
  const zF = L.stripFront + 0.16;
  const zB = L.matBack - 0.16;
  const zC = (zF + zB) / 2;
  const top = roundedOutline(halfW, (zF - zB) / 2, 0.08, 3).map(([x, z]) => [x, z + zC]);
  wood.push({ geometry: woodUV(plate(top, L.tableTop - 0.17, L.tableTop), 0.22, 0.9), color: 0xb98a55 });
  const apronTop = L.tableTop - 0.17;
  const apronLow = apronTop - 0.5;
  const inset = 0.13;
  wood.push({ geometry: woodUV(slab(-halfW + inset, apronLow, halfW - inset, apronTop, zF - inset - 0.07, zF - inset), 0.22, 0.9), color: 0x9c7040 });
  wood.push({ geometry: woodUV(slab(-halfW + inset, apronLow, halfW - inset, apronTop, zB + inset, zB + inset + 0.07), 0.22, 0.9), color: 0x9c7040 });
  for (const sx of [-1, 1]) {
    const apron = slab(zB + inset, apronLow, zF - inset, apronTop, -0.035, 0.035);
    apron.rotateY(Math.PI / 2);
    apron.translate(sx * (halfW - inset - 0.035), 0, 0);
    wood.push({ geometry: woodUV(apron, 0.22, 0.9), color: 0x9c7040 });
    for (const z of [zF - inset - 0.16, zB + inset + 0.16]) {
      const x = sx * (halfW - inset - 0.16);
      const leg = timber([x, 0, z], [x, apronTop, z], 0.3, 0.3, 0.03, [0, 0, 1]);
      wood.push({ geometry: uprightUV(leg), color: 0x8e6236 });
    }
  }
  // A stand for the upright flat: a bar along the mat, and two struts holding it from behind.
  const flat = L.blocks.find((b) => b.upright);
  const lean = 7 * DEG;
  const stopZ = flat.origin[2] + L.u + 0.02;
  // Its ledge is thin, so the lying flat in front still lies square on the mat.
  wood.push({ geometry: woodUV(slab(flat.origin[0] - 0.04, L.matTop, flat.origin[0] + 3.54, L.matTop + 0.07, stopZ, stopZ + 0.045), 0.22, 0.9), color: 0x7a5430 });
  for (const sx of [0.5, 3]) {
    const px = flat.origin[0] + sx;
    const backZ = flat.origin[2];
    const yTop = L.matTop + 2.6;
    const zTop = backZ - Math.tan(lean) * 2.6 - 0.03;
    wood.push({ geometry: uprightUV(timber([px, L.matTop, backZ - 0.62 < -2.9 ? -2.84 : backZ - 0.62], [px, yTop, zTop], 0.11, 0.09, 0.015, [0, 0, 1])), color: 0x7a5430 });
  }
  group.add(mesh(mergeParts(wood), standard({ map: grainMap(7204), vertexColors: true, roughness: 0.6, metalness: 0 })));

  // The mat. One printed strip at the front carries every word, at 2048 x 276: the same memory as the
  // 1024 square it replaces, but all of it where a student reads. Behind it each column is a plain tinted
  // cloth, since a block is standing on it.
  const matParts = [];
  for (const c of L.columns) {
    matParts.push({ geometry: plate([[c.x0 + 0.012, L.stripBack], [c.x1 - 0.012, L.stripBack], [c.x1 - 0.012, L.matBack], [c.x0 + 0.012, L.matBack]], L.tableTop, L.matTop - 0.001), color: c.tint });
  }
  const stripDepth = L.stripFront - L.stripBack;
  const AW = 2048;
  const AH = Math.round((AW * stripDepth) / L.matWidth);
  const plaqueH = 96;
  const atlas = canvasTexture(AW, AH + plaqueH, (ctx) => {
    ctx.fillStyle = '#fbf7ee';
    ctx.fillRect(0, 0, AW, AH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ppf = AW / L.matWidth;
    const headH = AH * 0.27;
    L.columns.forEach((c) => {
      const x0 = (c.x0 + L.matWidth / 2) * ppf;
      const x1 = (c.x1 + L.matWidth / 2) * ppf;
      const hex = `#${c.color.toString(16).padStart(6, '0')}`;
      const tint = `#${c.tint.toString(16).padStart(6, '0')}`;
      ctx.fillStyle = tint;
      ctx.fillRect(x0, 0, x1 - x0, AH);
      // The name at the top of its column, next to the blocks, and the digit below it, nearest the reader.
      ctx.fillStyle = hex;
      ctx.fillRect(x0, 0, x1 - x0, headH);
      ctx.fillStyle = '#ffffff';
      fitText(ctx, c.name, (x0 + x1) / 2, headH / 2 + 2, x1 - x0 - 16, headH * 0.78);
      ctx.fillStyle = hex;
      fitText(ctx, String(c.digit), (x0 + x1) / 2, headH + (AH - headH) * 0.52, x1 - x0 - 20, (AH - headH) * 0.98, 'Georgia, "Times New Roman", serif');
      ctx.fillStyle = '#2a2115';
      ctx.fillRect(x1 - 2, 0, 4, AH);
    });
    // The sum, printed on the apron's plaque.
    ctx.fillStyle = '#efe4c8';
    ctx.fillRect(0, AH, AW, plaqueH);
    ctx.fillStyle = '#2a1c10';
    const sum = L.columns.map((c) => (c.digit * c.value).toLocaleString('en-US')).join(' + ');
    fitText(ctx, `${L.number.toLocaleString('en-US')}  =  ${sum}`, AW / 2, AH + plaqueH / 2 + 2, AW - 60, plaqueH * 0.8, 'Georgia, "Times New Roman", serif');
  });
  const stripZ = (L.stripFront + L.stripBack) / 2;
  const printed = [printedQuad([0, L.matTop, stripZ], [0, 1, 0], [0, 0, -1], L.matWidth, stripDepth, [0, 0, AW, AH], AW, AH + plaqueH)];
  // The plaque on the apron; the strip is flipped so that it reads from +Z, with its top edge away.
  const plaqueW = 7.2;
  printed.push(printedQuad([0, (apronLow + apronTop) / 2, zF - inset + 0.012], [0, 0, 1], [0, 1, 0], plaqueW, (plaqueW * plaqueH) / AW, [0, AH, AW, plaqueH], AW, AH + plaqueH));
  group.add(mesh(mergeParts(printed.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map: atlas, vertexColors: true, roughness: 0.74, metalness: 0 })));
  group.add(mesh(mergeParts(matParts), standard({ vertexColors: true, roughness: 0.8, metalness: 0 })));
  return group;
}

// ---------------------------------------------------------------------------
// Balance scale
// ---------------------------------------------------------------------------

// The shape every weight shares, in units of its radius: a plain flat-topped cheese. Because all three
// are one shape at one density, mass goes as the cube of size, and the radii below follow from the masses.
const WEIGHT_SHAPE = [[0, 0], [0.955, 0], [1, 0.045], [1, 0.905], [0.955, 0.95], [0, 0.95]];

export function balanceLayout() {
  const arm = 2.2;
  const beamY = 5.42;
  const pointer = 1.6;
  const panFloor = 1.52;
  const r5 = 0.55;
  let y = panFloor;
  const weights = [5, 2, 1].map((mass) => {
    const radius = r5 * Math.cbrt(mass / 5);
    const profile = WEIGHT_SHAPE.map(([r, h]) => [r * radius, h * radius]);
    const entry = { mass, radius, height: 0.95 * radius, y0: y, profile, volume: revolvedVolume(profile) };
    y += entry.height;
    return entry;
  });
  const totalVolume = weights.reduce((s, w) => s + w.volume, 0);
  const totalMass = weights.reduce((s, w) => s + w.mass, 0);
  return {
    arm, beamY, pointer, panFloor, weights, totalMass, totalVolume,
    // The block is cut to the volume all three weights have together, so it is the same density too.
    cubeEdge: Math.cbrt(totalVolume),
    left: -arm,
    right: arm,
    panRadius: 0.95,
    pointerTip: [0, beamY - pointer],
    scaleStep: 2.4 * DEG,
  };
}

function buildBalance() {
  const L = balanceLayout();
  // Equal arms and a level beam are the whole model, so a build that loses either must not ship.
  if (Math.abs(L.left + L.right) > 1e-12) throw new Error('balance-scale: the arms are not equal');
  if (Math.abs(L.pointerTip[0]) > 1e-12) throw new Error('balance-scale: the pointer is not at zero');
  const group = new THREE.Group();
  const BRASS = 0xd3a64a;
  const brassParts = [];
  const pushB = (geometry) => brassParts.push({ geometry, color: 0xffffff });
  const { beamY: BY, arm: A } = L;

  // The atlas: the block's question mark, the three weights' numbers, and the pointer's scale.
  const ATLAS_W = 1024;
  const ATLAS_H = 512;
  const CUBE = 0x2467d4;
  const CUBE_CSS = '#2467d4';
  const SPOT = [(900) / ATLAS_W, 1 - 128 / ATLAS_H];
  // Each sits well inside white, or a mip level bleeds its neighbour into the patch's edge as a dark line.
  const labelCell = { 5: [272, 8, 224, 112], 2: [272, 136, 224, 112], 1: [528, 8, 224, 112] };
  const scaleCell = [0, 256, 512, 256];
  const ppf = 512; // scale cell pixels per foot
  const atlas = canvasTexture(ATLAS_W, ATLAS_H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
    ctx.fillStyle = CUBE_CSS;
    ctx.fillRect(0, 0, 256, 256);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 210px Georgia, "Times New Roman", serif';
    ctx.fillText('?', 128, 138);
    for (const w of L.weights) {
      const [x, y, cw, ch] = labelCell[w.mass];
      ctx.fillStyle = '#2b1a08';
      fitText(ctx, `${w.mass} lb`, x + cw / 2, y + ch / 2 + 4, cw - 16, ch * 0.86, 'Georgia, "Times New Roman", serif');
    }
    // The scale, drawn in the same coordinates the plate is cut in: feet from the beam's pivot.
    const [sx, sy, sw, sh] = scaleCell;
    const toX = (dx) => sx + sw / 2 + dx * ppf;
    const toY = (dy) => sy + sh / 2 - (dy + L.pointer) * ppf;
    ctx.fillStyle = '#f4ecd8';
    ctx.fillRect(sx, sy, sw, sh);
    for (let i = -5; i <= 5; i++) {
      const a = i * L.scaleStep;
      const r0 = L.pointer - 0.11;
      const r1 = L.pointer + (i % 5 === 0 ? 0.05 : 0.02);
      ctx.strokeStyle = i === 0 ? '#b3201a' : '#21170c';
      ctx.lineWidth = i === 0 ? 6 : 3.5;
      ctx.beginPath();
      ctx.moveTo(toX(Math.sin(a) * r0), toY(-Math.cos(a) * r0));
      ctx.lineTo(toX(Math.sin(a) * r1), toY(-Math.cos(a) * r1));
      ctx.stroke();
    }
    for (const i of [-5, 0, 5]) {
      const a = i * L.scaleStep;
      const r = L.pointer + 0.115;
      ctx.fillStyle = i === 0 ? '#b3201a' : '#21170c';
      ctx.font = 'bold 46px Arial, Helvetica, sans-serif';
      ctx.fillText(String(Math.abs(i)), toX(Math.sin(a) * r), toY(-Math.cos(a) * r) + 2);
    }
  });
  const uvScale = (dx, dy) => {
    const [sx, sy, sw, sh] = scaleCell;
    return [(sx + sw / 2 + dx * ppf) / ATLAS_W, 1 - (sy + sh / 2 - (dy + L.pointer) * ppf) / ATLAS_H];
  };

  // --- The turned base and the column ------------------------------------------------------------
  const base = lathe([
    [0, 0], [1.25, 0], [1.25, 0.09], [1.215, 0.125], [1.16, 0.14], [1.13, 0.2], [1.03, 0.25], [0.84, 0.31],
    [0.66, 0.38], [0.5, 0.43], [0.42, 0.47], [0.4, 0.52], [0.34, 0.56], [0.3, 0.62], [0, 0.62],
  ], 72);
  woodUV(base, 0.5, 1.5, 0.8);
  const woodParts = [{ geometry: base, color: 0x6a3d1c }];
  group.add(mesh(mergeParts(woodParts), standard({ map: grainMap(7301, { lines: 170, strength: 0.14, wander: 3 }), vertexColors: true, roughness: 0.34, metalness: 0 })));

  pushB(lathe([
    [0, 0.58], [0.27, 0.58], [0.27, 0.65], [0.22, 0.69], [0.16, 0.74], [0.15, 0.79], [0.115, 0.85], [0.1, 1.05], [0.088, 1.7],
    [0.082, 2.62], [0.1, 2.68], [0.135, 2.74], [0.135, 2.79], [0.1, 2.85], [0.082, 2.91], [0.08, 4.6], [0.1, 4.72], [0.135, 4.8],
    [0.135, 4.86], [0.14, 4.92], [0.14, 4.98], [0, 4.98],
  ], 40));

  // The fork: two cheeks, a bridge over them, an acorn on the bridge, and a steel axle the beam rocks on.
  const cheekTop = BY + 0.2;
  for (const s of [-1, 1]) {
    const outline = [[-0.13, 4.96], [0.13, 4.96], [0.1, 5.1], ...arcPts(0, cheekTop - 0.09, 0.09, 0, Math.PI, 8), [-0.1, 5.1]];
    pushB(prism(outline, s > 0 ? 0.095 : -0.14, s > 0 ? 0.14 : -0.095));
  }
  pushB(timber([0, cheekTop, -0.15], [0, cheekTop, 0.15], 0.17, 0.07, 0.022));
  pushB(lathe([[0, cheekTop], [0.075, cheekTop], [0.075, cheekTop + 0.06], [0.04, cheekTop + 0.1], [0.04, cheekTop + 0.14], [0.085, cheekTop + 0.17], [0.095, cheekTop + 0.24], [0.06, cheekTop + 0.32], [0, cheekTop + 0.37]], 24));

  // --- The beam -----------------------------------------------------------------------------------
  // One sweep from the left knife edge to the right, its radii a palindrome, its axis on y = beamY.
  const stations = [-A - 0.03, -A + 0.5, -1.2, -0.5, 0, 0.5, 1.2, A - 0.5, A + 0.03];
  const radii = [0.05, 0.058, 0.07, 0.1, 0.135, 0.1, 0.07, 0.058, 0.05];
  pushB(tube(stations.map((x) => [x, BY, 0]), radii, { sides: 16, steps: 48, round: 3, section: () => [1.3, 0.62] }));
  const boss = lathe([[0, -0.085], [0.15, -0.085], [0.175, -0.06], [0.175, 0.06], [0.15, 0.085], [0, 0.085]], 32);
  boss.rotateX(Math.PI / 2);
  boss.translate(0, BY, 0);
  pushB(boss);
  const axle = lathe([[0, -0.19], [0.042, -0.19], [0.042, 0.19], [0, 0.19]], 16);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, BY, 0);
  pushB(axle);
  // A polished nut on each arm, the balance's fine adjustment, the same on both.
  for (const s of [-1, 1]) {
    const nut = lathe([[0, -0.07], [0.075, -0.07], [0.09, -0.045], [0.09, 0.045], [0.075, 0.07], [0, 0.07]], 18);
    nut.rotateZ(Math.PI / 2);
    nut.translate(s * (A - 0.42), BY, 0);
    pushB(nut);
  }

  // --- What hangs off each end, and the two pans ---------------------------------------------------
  const bellTop = BY - 0.45;
  const bellLow = BY - 0.63;
  const panRim = L.panFloor - 0.03 + 0.2;
  const chain = chainLink(0.17, 0.086, 0.02);
  const bearings = [Math.PI, Math.PI / 3, -Math.PI / 3];
  for (const s of [-1, 1]) {
    const x = s * A;
    // The eye under the end of the beam.
    const eye = ringY(0.058, 0.02, 20, 7);
    eye.rotateX(Math.PI / 2);
    eye.translate(x, BY - 0.075, 0);
    pushB(eye);
    // The stirrup, whose loops pass through that eye and the eye on the crown.
    const { m } = alongMatrix([x, BY - 0.1, 0], [x, bellTop - 0.01, 0]);
    const stirrupLen = BY - 0.1 - (bellTop - 0.01);
    const stirrup = chainLink(stirrupLen + 0.05, 0.09, 0.019, { steps: 16, sides: 6 });
    stirrup.translate(0, 0, stirrupLen / 2);
    stirrup.applyMatrix4(m);
    pushB(stirrup);
    const crownEye = ringY(0.05, 0.018, 18, 7);
    crownEye.rotateX(Math.PI / 2);
    crownEye.translate(x, bellTop + 0.015, 0);
    pushB(crownEye);
    // The crown the three chains spring from.
    const crown = lathe([[0, bellLow], [0.115, bellLow], [0.125, bellLow + 0.02], [0.1, bellLow + 0.07], [0.06, bellTop - 0.04], [0.04, bellTop], [0, bellTop + 0.01]], 24);
    crown.translate(x, 0, 0);
    pushB(crown);
    // The pan: a true shallow dish, flat where anything stands on it, rolled at the rim.
    const y0 = L.panFloor - 0.03;
    const pan = lathe([
      [0, y0 - 0.02], [0.72, y0 - 0.02], [0.84, y0 + 0.03], [0.93, y0 + 0.14], [0.97, y0 + 0.185], [0.965, y0 + 0.22], [0.935, y0 + 0.225],
      [0.905, y0 + 0.17], [0.82, y0 + 0.07], [0.72, y0 + 0.03], [0, y0 + 0.03],
    ], 72);
    pan.translate(x, 0, 0);
    pushB(pan);
    // Three real chains, each link turned a quarter on from the last, from the crown to a lug on the rim.
    for (const b of bearings) {
      const lug = [x + Math.sin(b) * 0.935, panRim + 0.03, Math.cos(b) * 0.935];
      const top = [x + Math.sin(b) * 0.09, bellLow + 0.03, Math.cos(b) * 0.09];
      const ball = lathe(arcPts(0, 0, 0.038, -Math.PI / 2, Math.PI / 2, 5), 12);
      ball.translate(lug[0], lug[1], lug[2]);
      pushB(ball);
      const { m: cm, len } = alongMatrix(top, lug);
      const pitch0 = 0.13;
      const count = Math.round(len / pitch0);
      const pitch = len / count;
      for (let i = 0; i < count; i++) {
        const g = chain.clone();
        g.rotateZ(i % 2 ? Math.PI / 2 : 0);
        g.translate(0, 0, (i + 0.5) * pitch);
        g.applyMatrix4(cm);
        pushB(g);
      }
    }
  }

  // --- The three weights, on the right-hand pan -----------------------------------------------------
  const labelled = [];
  for (const w of L.weights) {
    const g = lathe(w.profile, 64);
    g.translate(A, w.y0, 0);
    pushB(g);
    // The number is printed on the side, back and front, on a band of the weight's own surface.
    const h = w.height * 0.56;
    const arc = h * 2;
    const half = arc / (2 * w.radius);
    const y0 = w.y0 + w.height * 0.2;
    for (const centre of [0, Math.PI]) {
      const positions = []; const normals = []; const uvs = []; const index = [];
      const [cx, cy, cw, ch] = labelCell[w.mass];
      const seg = 18;
      const r = w.radius + 0.004;
      for (let i = 0; i <= seg; i++) {
        const t = centre - half + (2 * half * i) / seg;
        for (const j of [0, 1]) {
          positions.push(A + Math.sin(t) * r, y0 + j * h, Math.cos(t) * r);
          normals.push(Math.sin(t), 0, Math.cos(t));
          uvs.push((cx + (cw * i) / seg) / ATLAS_W, 1 - (cy + ch * (1 - j)) / ATLAS_H);
        }
        if (i < seg) { const a = i * 2; index.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      }
      labelled.push(windToNormals(indexed(positions, normals, uvs, index)));
    }
  }

  // --- The block of unknown mass, on the left-hand pan -------------------------------------------------
  const enamel = [];
  const e = L.cubeEdge;
  const cubeC = lin(CUBE);
  const { geometry: cube } = scoredBlock(1, 1, 1, e, 0.032, cubeC, { groove: 1, arris: 1.25, seed: 7302 });
  cube.translate(-A - e / 2, L.panFloor, -e / 2);
  const spot = (g) => {
    const uv = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < uv.length; i += 2) { uv[i] = SPOT[0]; uv[i + 1] = SPOT[1]; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  enamel.push({ geometry: spot(cube), keepColor: true });
  const qSize = e * 0.86;
  const qc = [-A, L.panFloor + e / 2, 0];
  const qd = e / 2 + 0.003;
  const qr = [0, 0, 256, 256];
  const qPart = (centre, n, up) => ({ geometry: printedQuad(centre, n, up, qSize, qSize, qr, ATLAS_W, ATLAS_H), color: 0xffffff });
  enamel.push(qPart([qc[0], qc[1], qd], [0, 0, 1], [0, 1, 0]));
  enamel.push(qPart([qc[0], qc[1], -qd], [0, 0, -1], [0, 1, 0]));
  enamel.push(qPart([qc[0] + qd, qc[1], 0], [1, 0, 0], [0, 1, 0]));
  enamel.push(qPart([qc[0] - qd, qc[1], 0], [-1, 0, 0], [0, 1, 0]));
  enamel.push(qPart([qc[0], qc[1] + qd, 0], [0, 1, 0], [0, 0, -1]));

  // --- The pointer and its printed scale ---------------------------------------------------------------
  const R0 = L.pointer - 0.19;
  const R1 = L.pointer + 0.2;
  const spread = 15 * DEG;
  const outline = [];
  for (let i = 0; i <= 20; i++) { const a = -spread + (2 * spread * i) / 20; outline.push([Math.sin(a) * R1, BY - Math.cos(a) * R1]); }
  for (let i = 20; i >= 0; i--) { const a = -spread + (2 * spread * i) / 20; outline.push([Math.sin(a) * R0, BY - Math.cos(a) * R0]); }
  pushB(prism(outline, 0.07, 0.122));
  {
    // The enamel face: an annular sector whose texture coordinates are its own position.
    const positions = []; const normals = []; const uvs = []; const index = [];
    const inset = 0.022;
    const seg = 24;
    const lim = spread - inset / L.pointer;
    for (let i = 0; i <= seg; i++) {
      const a = -lim + (2 * lim * i) / seg;
      for (const r of [R0 + inset, R1 - inset]) {
        const dx = Math.sin(a) * r; const dy = -Math.cos(a) * r;
        positions.push(dx, BY + dy, 0.1245);
        normals.push(0, 0, 1);
        const t = uvScale(dx, dy);
        uvs.push(t[0], t[1]);
      }
      if (i < seg) { const b = i * 2; index.push(b, b + 2, b + 3, b, b + 3, b + 1); }
    }
    enamel.push({ geometry: windToNormals(indexed(positions, normals, uvs, index)), color: 0xffffff });
  }
  // The needle: dark blued steel, hanging from the axle in front of the fork and the scale, tip on zero.
  {
    const tipY = L.pointerTip[1];
    const blade = prism([[-0.026, BY - 0.02], [0.026, BY - 0.02], [0.0055, tipY], [-0.0055, tipY]], 0.146, 0.158);
    enamel.push({ geometry: spot(flatColor(blade, lin(0x1b2230))), keepColor: true });
    // rotateX(90) sends +y to +z, so the profile's heights are already distances along the axle.
    const hub = lathe([[0, 0.143], [0.052, 0.143], [0.052, 0.183], [0.03, 0.2], [0, 0.2]], 18);
    hub.rotateX(Math.PI / 2);
    hub.translate(0, BY, 0);
    enamel.push({ geometry: spot(flatColor(hub, lin(0x1b2230))), keepColor: true });
  }

  const brassMerged = mergeParts(brassParts);
  polish(brassMerged, BRASS);
  group.add(mesh(brassMerged, standard({ vertexColors: true, roughness: 0.33, metalness: 0.42 })));
  const labelMerged = mergeParts(labelled.map((geometry) => ({ geometry, color: 0xffffff })));
  polish(labelMerged, BRASS);
  group.add(mesh(labelMerged, standard({ map: atlas, vertexColors: true, roughness: 0.33, metalness: 0.42 })));
  group.children[group.children.length - 1].castShadow = false;
  group.add(mesh(mergeParts(enamel), standard({ map: atlas, vertexColors: true, roughness: 0.42, metalness: 0 })));
  return group;
}

// ---------------------------------------------------------------------------
// Conic sections
// ---------------------------------------------------------------------------
//
// EVERY CURVE HERE IS THE TRUE INTERSECTION OF A PLANE WITH A STRAIGHT LINE. A cone is its generators, a
// point on one is linear in t, and so where a plane cuts one has an exact solution. The side of each cone
// is built only from those generators, clipped at that solution, and the cut face's outline is the same
// list of points. There is no second description of the curve to disagree with the first.

export function conicLayout() {
  const H = 3;
  const R = 1;
  const alpha = Math.atan2(R, H); // half-angle at the apex; R/H = 1/3
  const sideSlope = Math.PI / 2 - alpha; // the side's slope above the base
  const apex = [0, H, 0];
  const point = (phi, t) => [R * t * Math.sin(phi), H * (1 - t), R * t * Math.cos(phi)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const ellipseTilt = 50 * DEG;
  const z1 = 0.35;

  // Each plane is a point and a normal, and the normal points at the part that is removed.
  const planes = {
    circle: { p: [0, 1.1, 0], n: [0, 1, 0], tilt: 0 },
    ellipse: { p: [0, 1.55, 0], n: [0, Math.cos(ellipseTilt), Math.sin(ellipseTilt)], tilt: ellipseTilt },
    // Through the centre of the base, tipped by exactly the angle that makes it parallel to the front side.
    parabola: { p: [0, 0, 0], n: [0, Math.sin(alpha), Math.cos(alpha)], tilt: sideSlope },
    hyperbola: { p: [0, 0, z1], n: [0, 0, 1], tilt: Math.PI / 2 },
  };

  // What of one generator survives, and what is cut away. t = 0 at the apex and 1 at the base.
  const split = (plane, phi) => {
    const P = point(phi, 1);
    const gA = dot(plane.n, [apex[0] - plane.p[0], apex[1] - plane.p[1], apex[2] - plane.p[2]]);
    const gE = dot(plane.n, [P[0] - plane.p[0], P[1] - plane.p[1], P[2] - plane.p[2]]);
    if (gA > 0) {
      if (gE >= -1e-12) return { kept: null, cut: [0, 1], t: null };
      const t = gA / (gA - gE);
      return { kept: [t, 1], cut: [0, t], t };
    }
    if (gE <= 1e-12) return { kept: [0, 1], cut: null, t: null };
    const t = -gA / (gE - gA);
    return { kept: [0, t], cut: [t, 1], t };
  };

  const stations = [];
  const build = (name, plane, phis, isClosed) => {
    const gens = phis.map((phi) => ({ phi, ...split(plane, phi) }));
    const boundary = gens.filter((g) => g.t !== null).map((g) => point(g.phi, g.t));
    stations.push({ name, plane, phis, gens, boundary, closed: isClosed });
  };
  const uniform = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

  // Closed curves: every generator is cut.
  build('circle', planes.circle, uniform(-Math.PI, Math.PI, 144).slice(0, 144), true);
  build('ellipse', planes.ellipse, uniform(-Math.PI, Math.PI, 144).slice(0, 144), true);
  // Parabola: the plane meets the base along a diameter, at phi = +-90 degrees, so those must be samples.
  build('parabola', planes.parabola, [...uniform(Math.PI / 2, (3 * Math.PI) / 2, 96), ...uniform((3 * Math.PI) / 2, (5 * Math.PI) / 2, 96).slice(1, -1)], false);
  // Hyperbola: the plane meets the base along a chord, whose ends must be samples.
  const phiC = Math.acos(z1 / R);
  build('hyperbola', planes.hyperbola, [...uniform(-phiC, phiC, 96), ...uniform(phiC, TAU - phiC, 96).slice(1, -1)], false);
  return { H, R, alpha, sideSlope, apex, z1, phiC, ellipseTilt, stations, point, split };
}

// A sheet of a cone's side between two values of t on each generator, with the cone's own true normals.
// `range(gen)` gives the [t0, t1] to draw, or null. `wrap` joins the last generator to the first.
function coneSheet(L, gens, range, wrap) {
  const positions = []; const normals = []; const uvs = []; const index = [];
  const rows = 3;
  const col = [];
  const ca = Math.cos(L.alpha); const sa = Math.sin(L.alpha);
  for (const g of gens) {
    const r = range(g);
    if (!r) { col.push(-1); continue; }
    const at = positions.length / 3;
    col.push(at);
    for (let j = 0; j < rows; j++) {
      const t = mix(r[0], r[1], j / (rows - 1));
      const P = L.point(g.phi, t);
      positions.push(P[0], P[1], P[2]);
      normals.push(Math.sin(g.phi) * ca, sa, Math.cos(g.phi) * ca);
      uvs.push(0, 0);
    }
  }
  const n = gens.length;
  for (let i = 0; i < n; i++) {
    const a = col[i];
    const b = col[(i + 1) % n];
    if (i === n - 1 && !wrap) break;
    if (a < 0 || b < 0) continue;
    for (let j = 0; j < rows - 1; j++) {
      index.push(a + j, a + j + 1, b + j + 1, a + j, b + j + 1, b + j);
    }
  }
  return windToNormals(indexed(positions, normals, uvs, index));
}

// A flat polygon of a convex loop, with a darker band following its outline, so the exact curve can be
// read as a line. Interior and band are coplanar and share no area, so they cannot fight.
function cutFace(loop, normal, colour, rimColour, band = 0.035) {
  const c = [0, 0, 0];
  for (const p of loop) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
  c[0] /= loop.length; c[1] /= loop.length; c[2] /= loop.length;
  const positions = []; const normals = []; const uvs = []; const index = []; const colors = [];
  const add = (p, col) => { positions.push(p[0], p[1], p[2]); normals.push(normal[0], normal[1], normal[2]); uvs.push(0, 0); colors.push(col[0], col[1], col[2]); };
  const inner = loop.map((p) => {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    const k = Math.min(0.4, band / d);
    return [mix(p[0], c[0], k), mix(p[1], c[1], k), mix(p[2], c[2], k)];
  });
  const n = loop.length;
  add(c, colour);
  for (const p of inner) add(p, colour);
  for (let i = 0; i < n; i++) index.push(0, 1 + i, 1 + ((i + 1) % n));
  const base = positions.length / 3;
  for (const p of inner) add(p, rimColour);
  for (const p of loop) add(p, rimColour);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    index.push(base + i, base + n + i, base + n + j, base + i, base + n + j, base + j);
  }
  return windToNormals(indexed(positions, normals, uvs, index, colors));
}

// A convex loop lying in the plane y = 0, facing down: the bottom of a cone or of a part of one.
function baseFan(loop) {
  const positions = []; const normals = []; const uvs = []; const index = [];
  let cx = 0; let cz = 0;
  for (const p of loop) { cx += p[0]; cz += p[2]; }
  cx /= loop.length; cz /= loop.length;
  positions.push(cx, 0, cz); normals.push(0, -1, 0); uvs.push(0, 0);
  for (const p of loop) { positions.push(p[0], 0, p[2]); normals.push(0, -1, 0); uvs.push(0, 0); }
  const n = loop.length;
  for (let i = 0; i < n; i++) index.push(0, 1 + i, 1 + ((i + 1) % n));
  return windToNormals(indexed(positions, normals, uvs, index));
}

const CONIC_LOOK = {
  circle: { x: -5.05, colour: 0xe5302a, title: 'CIRCLE' },
  ellipse: { x: -2.4, colour: 0xf28a12, title: 'ELLIPSE' },
  parabola: { x: 0.25, colour: 0x1fa648, title: 'PARABOLA' },
  hyperbola: { x: 2.9, colour: 0x2a6ee0, title: 'HYPERBOLA' },
};

function buildConics() {
  const L = conicLayout();
  const group = new THREE.Group();
  const shelfTop = 0.95;
  const plinthH = 0.38;
  const Y0 = shelfTop + plinthH;
  const honey = 0xd9a660;
  const wood = [];
  const capWood = [];
  const faces = [];
  const brass = [];
  const printed = [];
  const degrees = (a) => (a / DEG).toFixed(1).replace(/\.0$/, '');
  const side = degrees(L.sideSlope);

  // The name plates, each of which states the angle of the cut against the angle of the side.
  const CELL_H = 200;
  const lines = {
    circle: `cut at 0 degrees, parallel to the base`,
    ellipse: `cut at ${degrees(L.ellipseTilt)} degrees, less than the side's ${side}`,
    parabola: `cut at ${side} degrees, parallel to the side`,
    hyperbola: `cut at 90 degrees, steeper than the side's ${side}`,
    piece: 'the same hyperbola, on the part cut off',
  };
  const order = ['circle', 'ellipse', 'parabola', 'hyperbola', 'piece'];
  const atlas = canvasTexture(1024, CELL_H * 5, (ctx) => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    order.forEach((key, i) => {
      const y = i * CELL_H;
      ctx.fillStyle = '#f3ead6';
      ctx.fillRect(0, y, 1024, CELL_H);
      const look = CONIC_LOOK[key];
      ctx.fillStyle = look ? `#${look.colour.toString(16).padStart(6, '0')}` : '#3a2a18';
      fitText(ctx, look ? look.title : 'THE PIECE CUT OFF', 512, y + CELL_H * 0.37, 980, CELL_H * 0.56);
      ctx.fillStyle = '#2a1c10';
      fitText(ctx, lines[key], 512, y + CELL_H * 0.8, 980, CELL_H * 0.25, 'Georgia, "Times New Roman", serif', 'normal');
    });
  });

  // Every plinth: a block with a sloped front carrying its name plate.
  const plinth = (cx, halfW, cell, scaleDown = 1) => {
    const backZ = -1.38; const topZ = 1.0; const frontZ = 1.4;
    const outline = [[-frontZ, 0], [-topZ, plinthH], [-backZ, plinthH], [-backZ, 0]];
    const g = prism(outline, -halfW, halfW);
    g.rotateY(Math.PI / 2);
    g.translate(cx, shelfTop, 0);
    wood.push({ geometry: woodUV(g, 0.24, 1), color: 0x6f4526 });
    const run = frontZ - topZ;
    const len = Math.hypot(run, plinthH);
    const n = [0, run / len, plinthH / len];
    const w = (halfW * 2 - 0.1) * scaleDown;
    const h = (w * CELL_H) / 1024;
    const centre = [cx, shelfTop + plinthH / 2 + n[1] * 0.005, (topZ + frontZ) / 2 + n[2] * 0.005];
    printed.push(printedQuad(centre, n, [0, plinthH / len, -run / len], w, h, [0, cell * CELL_H, 1024, CELL_H], 1024, CELL_H * 5));
  };

  // A part of a cone: its side, its cut face and any of its base that shows.
  const part = (station, which, offset, colour) => {
    const look = { rim: lin(colour).map((v) => v * 0.32), face: lin(colour).map((v) => Math.min(1, v * 1.1)) };
    const wrap = station.closed;
    const sheet = coneSheet(L, station.gens, (g) => g[which], wrap || which === 'cut');
    uprightUV(sheet, 0.3, 0.8);
    // A held-up piece throws no shadow: its shadow would fall straight across the face it was cut from.
    const held = which === 'cut' && station.name !== 'hyperbola';
    const woodList = held ? capWood : wood;
    const items = [{ list: woodList, geometry: sheet, color: honey }];
    const inward = which === 'kept' ? 1 : -1;
    const n = station.plane.n.map((v) => v * inward);
    const loop = [...station.boundary];
    const faceG = cutFace(loop, n, look.face, look.rim);
    items.push({ list: held ? capWood : faces, geometry: faceG, keep: true });
    // The bottom: whatever of the rim of the base belongs to this part.
    const rim = station.gens.filter((g) => {
      const r = g[which];
      return r && Math.abs(r[1] - 1) < 1e-9;
    }).map((g) => L.point(g.phi, 1));
    if (rim.length > 2) {
      const fan = baseFan(rim);
      items.push({ list: woodList, geometry: uprightUV(fan, 0.3, 0.8), color: honey });
    }
    for (const item of items) {
      const g = item.geometry;
      if (offset instanceof THREE.Matrix4) g.applyMatrix4(offset);
      else g.translate(offset[0], offset[1], offset[2]);
      item.list.push(item.keep ? { geometry: g, keepColor: true } : { geometry: g, color: item.color });
    }
  };

  const rod = (a, b, r = 0.022) => tube([a, b], r, { straight: true, sides: 10, steps: 1, round: 2 });
  const knuckle = (p, r = 0.04) => {
    const g = lathe(arcPts(0, 0, r, -Math.PI / 2, Math.PI / 2, 6), 14);
    g.translate(p[0], p[1], p[2]);
    return g;
  };

  // A thin post rising behind a cone, with an arm reaching forward into the piece it holds. It stands
  // behind so that nothing crosses the cut face.
  const holder = (x, armY, armZ, postZ = -1.24) => {
    brass.push(rod([x, shelfTop + plinthH - 0.02, postZ], [x, armY, postZ]));
    brass.push(rod([x, armY, postZ], [x, armY, armZ]));
    brass.push(knuckle([x, armY, postZ]));
    const foot = lathe([[0, 0], [0.08, 0], [0.08, 0.03], [0.04, 0.06], [0.03, 0.09], [0, 0.09]], 16);
    foot.translate(x, shelfTop + plinthH, postZ);
    brass.push(foot);
  };

  for (const station of L.stations) {
    const look = CONIC_LOOK[station.name];
    const x = look.x;
    plinth(x, 1.2, order.indexOf(station.name));
    part(station, 'kept', [x, Y0, 0], look.colour);
    if (station.name === 'circle') {
      const lift = 0.72;
      part(station, 'cut', [x, Y0 + lift, 0], look.colour);
      holder(x, Y0 + 1.1 + lift + 0.6, -0.25);
    } else if (station.name === 'ellipse') {
      // Slid up its own plane and lifted a little off it, the way the parabola's piece is.
      const t = L.ellipseTilt;
      const slide = 1.5; const off = 0.12;
      const dy = slide * Math.sin(t) + off * Math.cos(t);
      const dz = -slide * Math.cos(t) + off * Math.sin(t);
      part(station, 'cut', [x, Y0 + dy, dz], look.colour);
      holder(x, Y0 + 2.2 + dy, dz - 0.1, -1.33);
    } else if (station.name === 'parabola') {
      // Slid straight up its own cutting plane, far enough to bare the whole face. The cut stays in one
      // plane, so from the side the slide itself shows the plane running parallel to the side.
      const a = L.alpha;
      const slide = (L.H / 2) / Math.cos(a) + 0.08;
      const dy = slide * Math.cos(a); const dz = -slide * Math.sin(a);
      part(station, 'cut', [x, Y0 + dy, dz], look.colour);
      holder(x, Y0 + dy + 1.0, dz - (L.R / L.H) * 1.0 + 0.16);
      // A coloured line inlaid down the side that the cut runs parallel to.
      const line = tube([[0, 0, L.R + 0.004], [0, L.H - 0.04, 0.0173]], 0.02, { straight: true, sides: 8, steps: 1, round: 1 });
      line.translate(x, Y0 + dy, dz);
      capWood.push({ geometry: flatColor(line, lin(look.colour)), keepColor: true });
    } else {
      // The part cut off stands alongside, turned round to show the same curve.
      const px = 5.1;
      plinth(px, 0.96, order.indexOf('piece'), 1);
      const m = new THREE.Matrix4().makeTranslation(px, Y0, 0.7 + L.z1).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      part(station, 'cut', m, look.colour);
      // The second nappe, whole and clear, with the plane's second branch standing inside it. A hyperbola
      // really is two curves, and this is the other one: the mirror image of the lower in the apex.
      const R = L.R; const H = L.H; const z = L.z1;
      const sMax = Math.acosh(R / z);
      const outline = [];
      for (let i = 0; i <= 64; i++) {
        const s = -sMax + (2 * sMax * i) / 64;
        outline.push([z * Math.sinh(s), H + (z * Math.cosh(s) * H) / R]);
      }
      const branch = prism(outline, z - 0.012, z + 0.012);
      branch.translate(x, Y0, 0);
      faces.push({ geometry: flatColor(branch, lin(look.colour).map((v) => Math.min(1, v * 1.1))), keepColor: true });
      const glass = lathe([[0, H], [R, 2 * H], [0, 2 * H]], 72);
      glass.translate(x, Y0, 0);
      const glassMesh = mesh(mergeParts([{ geometry: glass, color: 0xbfe0ee }]), standard({ vertexColors: true, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false }));
      glassMesh.castShadow = false;
      glassMesh.receiveShadow = false;
      group.add(glassMesh);
      // The rim that holds it, and a wire frame drawn on the cutting plane: one plane, two branches.
      const ring = ringY(R + 0.012, 0.022, 72, 8);
      ring.translate(x, Y0 + 2 * H, 0);
      brass.push(ring);
      const fx = 1.07;
      const top = Y0 + 2 * H + 0.09;
      for (const sx of [-1, 1]) {
        brass.push(rod([x + sx * fx, Y0 - 0.02, z], [x + sx * fx, top, z], 0.02));
        brass.push(knuckle([x + sx * fx, top, z], 0.035));
        const ex = Math.sqrt(R * R - z * z);
        brass.push(rod([x + sx * ex, Y0 + 2 * H, z], [x + sx * fx, Y0 + 2 * H, z], 0.018));
        const foot = lathe([[0, 0], [0.075, 0], [0.075, 0.03], [0.035, 0.06], [0.028, 0.09], [0, 0.09]], 16);
        foot.translate(x + sx * fx, Y0, z);
        brass.push(foot);
      }
      brass.push(rod([x - fx, top, z], [x + fx, top, z], 0.02));
    }
  }

  // The shelf: a walnut top on square legs with a rail under it.
  const halfW = 6.25;
  const zF = 1.6; const zB = -1.62; const zC = (zF + zB) / 2;
  const topOutline = roundedOutline(halfW, (zF - zB) / 2, 0.1, 4).map(([x, z]) => [x, z + zC]);
  wood.push({ geometry: woodUV(plate(topOutline, shelfTop - 0.14, shelfTop), 0.22, 0.9), color: 0x5e3a1e });
  wood.push({ geometry: woodUV(slab(-halfW + 0.14, shelfTop - 0.42, halfW - 0.14, shelfTop - 0.14, zF - 0.2, zF - 0.14), 0.22, 0.9), color: 0x4f3018 });
  wood.push({ geometry: woodUV(slab(-halfW + 0.14, shelfTop - 0.42, halfW - 0.14, shelfTop - 0.14, zB + 0.14, zB + 0.2), 0.22, 0.9), color: 0x4f3018 });
  for (const sx of [-1, 1]) {
    for (const z of [zF - 0.26, zB + 0.26]) {
      const px = sx * (halfW - 0.26);
      wood.push({ geometry: uprightUV(timber([px, 0, z], [px, shelfTop - 0.14, z], 0.26, 0.26, 0.03, [0, 0, 1])), color: 0x4f3018 });
    }
    const px = sx * (halfW - 0.26);
    wood.push({ geometry: woodUV(timber([px, 0.3, zF - 0.26], [px, 0.3, zB + 0.26], 0.14, 0.14, 0.02), 0.22, 0.9), color: 0x4f3018 });
  }

  group.add(mesh(mergeParts(wood), standard({ map: grainMap(7401, { lines: 150, strength: 0.17, wander: 3 }), vertexColors: true, roughness: 0.5, metalness: 0 })));
  const caps = mesh(mergeParts(capWood), standard({ map: grainMap(7402, { lines: 150, strength: 0.17, wander: 3 }), vertexColors: true, roughness: 0.5, metalness: 0 }));
  caps.castShadow = false;
  group.add(caps);
  group.add(mesh(mergeParts(faces), standard({ vertexColors: true, roughness: 0.4, metalness: 0 })));
  const brassMerged = mergeParts(brass.map((geometry) => ({ geometry, color: 0xffffff })));
  polish(brassMerged, 0xcda044);
  group.add(mesh(brassMerged, standard({ vertexColors: true, roughness: 0.35, metalness: 0.4 })));
  const plates = mesh(mergeParts(printed.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map: atlas, vertexColors: true, roughness: 0.7, metalness: 0 }));
  plates.castShadow = false;
  group.add(plates);
  return group;
}

// ---------------------------------------------------------------------------
// Brass astrolabe
// ---------------------------------------------------------------------------
//
// AN ASTROLABE IS A STEREOGRAPHIC PROJECTION IN BRASS, AND THAT IS WHAT IS BUILT. The sky is projected
// from the south celestial pole onto the plane of the equator, the tropic of Capricorn is the edge of the
// instrument, and every circle follows from one number: r = Req tan((90 - dec) / 2). The plate is drawn
// for latitude 38 degrees north (Cordoba, and within a degree of south-central Kansas) and the rete's star
// pointers end at true positions (J2000) of real bright stars. The ornament is geometric and floral, the
// scales are plain ticks with no numerals, and nothing on it is writing. The card says it is representative.

const ASTRO_STARS = [
  // Right ascension in hours, declination in degrees.
  ['Aldebaran', 4.599, 16.51], ['Capella', 5.278, 46.0], ['Rigel', 5.242, -8.2], ['Betelgeuse', 5.919, 7.41],
  ['Sirius', 6.752, -16.72], ['Procyon', 7.655, 5.22], ['Pollux', 7.755, 28.03], ['Regulus', 10.139, 11.97],
  ['Dubhe', 11.062, 61.75], ['Denebola', 11.818, 14.57], ['Spica', 13.42, -11.16], ['Arcturus', 14.261, 19.18],
  ['Alphecca', 15.578, 26.71], ['Rasalhague', 17.582, 12.56], ['Vega', 18.616, 38.78], ['Altair', 19.846, 8.87],
  ['Deneb', 20.69, 45.28], ['Markab', 23.08, 15.21], ['Alpheratz', 0.14, 29.09], ['Hamal', 2.12, 23.46], ['Algol', 3.136, 40.96],
];

export function astrolabeLayout() {
  const obliquity = 23.44;
  const latitude = 38;
  const rim = { outer: 2.5, inner: 2.12 };
  const Rcap = 2.02;
  const halfTan = (deg) => Math.tan((deg * DEG) / 2);
  const Req = Rcap / halfTan(90 + obliquity);
  const rOfDec = (dec) => Req * halfTan(90 - dec);
  const Rcan = rOfDec(obliquity);
  // A point on the sky at declination dec and hour angle ha (degrees): south is up, west is to the right.
  const project = (dec, ha) => {
    const r = rOfDec(dec);
    return [r * Math.sin(ha * DEG), r * Math.cos(ha * DEG)];
  };
  // A circle of equal altitude on the plate crosses the meridian at two points, and is centred between.
  const almucantar = (alt) => {
    const y1 = Req * halfTan(180 - latitude - alt);
    const y2 = Req * halfTan(alt - latitude);
    return { x: 0, y: (y1 + y2) / 2, r: Math.abs(y1 - y2) / 2 };
  };
  // Every azimuth circle passes through the zenith and the nadir, at its azimuth to the meridian.
  const zenithY = Req * halfTan(90 - latitude);
  const nadirY = -Req * halfTan(90 + latitude);
  const azimuth = (az) => {
    const d = (zenithY - nadirY) / 2;
    const y = (zenithY + nadirY) / 2;
    const x = d / Math.tan(az * DEG);
    return { x, y, r: Math.hypot(x, d) };
  };
  // An unequal hour below the horizon: the night's arc on one parallel, split into twelve.
  const unequalHour = (hour, dec) => {
    const h0 = Math.acos(clamp01Signed(-Math.tan(latitude * DEG) * Math.tan(dec * DEG))) / DEG;
    return project(dec, h0 + (hour / 12) * (360 - 2 * h0));
  };
  // The rete is shown at sidereal time 18h, which puts the ecliptic's offset straight up. Its circle touches
  // Capricorn at the top (RA 18h) and Cancer at the bottom (RA 6h).
  const lst = 18;
  const ecliptic = { x: 0, y: (Rcap - Rcan) / 2, r: (Rcap + Rcan) / 2 };
  const starAt = (ra, dec) => project(dec, (lst - ra) * 15);
  const eclipticPoint = (lon) => {
    const e = obliquity * DEG; const l = lon * DEG;
    const dec = Math.asin(Math.sin(e) * Math.sin(l)) / DEG;
    const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / (15 * DEG);
    return starAt(ra, dec);
  };
  const stars = ASTRO_STARS.map(([name, ra, dec]) => ({ name, ra, dec, at: starAt(ra, dec) }));
  return { obliquity, latitude, rim, Rcap, Req, Rcan, rOfDec, project, almucantar, azimuth, zenithY, nadirY, unequalHour, lst, ecliptic, starAt, eclipticPoint, stars };
}

function clamp01Signed(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }

// Marching squares over f(a, b), negative inside: closed loops with the inside on the left.
function contour(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  const H = (i, j) => (i + j * na) * 2;
  const W = (i, j) => (i + j * na) * 2 + 1;
  const point = (edge) => {
    const horizontal = edge % 2 === 0;
    const at = Math.floor(edge / 2);
    const i = at % na; const j = Math.floor(at / na);
    const p = v[at]; const q = v[horizontal ? at + 1 : at + na];
    const t = p / (p - q);
    return horizontal ? [a0 + (i + t) * cell, b0 + j * cell] : [a0 + i * cell, b0 + (j + t) * cell];
  };
  const next = new Map();
  for (let j = 0; j < nb - 1; j++) {
    for (let i = 0; i < na - 1; i++) {
      const c0 = v[i + j * na]; const c1 = v[i + 1 + j * na]; const c2 = v[i + 1 + (j + 1) * na]; const c3 = v[i + (j + 1) * na];
      const mask = (c0 < 0 ? 1 : 0) | (c1 < 0 ? 2 : 0) | (c2 < 0 ? 4 : 0) | (c3 < 0 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      const e0 = H(i, j); const e1 = W(i + 1, j); const e2 = H(i, j + 1); const e3 = W(i, j);
      const centre = (c0 + c1 + c2 + c3) < 0;
      const link = (p, q) => next.set(p, q);
      switch (mask) {
        case 1: link(e0, e3); break;
        case 2: link(e1, e0); break;
        case 3: link(e1, e3); break;
        case 4: link(e2, e1); break;
        case 5: if (centre) { link(e0, e1); link(e2, e3); } else { link(e0, e3); link(e2, e1); } break;
        case 6: link(e2, e0); break;
        case 7: link(e2, e3); break;
        case 8: link(e3, e2); break;
        case 9: link(e0, e2); break;
        case 10: if (centre) { link(e3, e0); link(e1, e2); } else { link(e1, e0); link(e3, e2); } break;
        case 11: link(e1, e2); break;
        case 12: link(e3, e1); break;
        case 13: link(e0, e1); break;
        case 14: link(e3, e0); break;
        default: break;
      }
    }
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let e = start;
    while (e !== undefined && !used.has(e)) {
      used.add(e);
      loop.push(point(e));
      e = next.get(e);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

const loopArea = (loop) => {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return s / 2;
};

function insideLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i]; const [xj, yj] = loop[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Drops any point the outline does not need, walking forward from the last one kept: straight spokes shed
// nearly everything and curves keep what their sagitta requires.
function simplifyLoop(loop, tolerance) {
  const out = [loop[0]];
  let anchor = 0;
  const n = loop.length;
  const dev = (a, b, c) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    return Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / len;
  };
  for (let i = 2; i <= n; i++) {
    const end = loop[i % n];
    let worst = 0;
    for (let k = anchor + 1; k < i; k++) worst = Math.max(worst, dev(loop[anchor], end, loop[k]));
    if (worst > tolerance || i - anchor > 40) {
      out.push(loop[i - 1]);
      anchor = i - 1;
    }
  }
  return out.length >= 3 ? out : loop;
}

// A pierced plate: real holes, from z0 to z1, with `uv(x, y)` laying its texture. The piercing is real, so
// what is behind it can be seen through it.
function piercedPlate(loops, z0, z1, uv) {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  const positions = []; const normals = []; const uvs = []; const index = [];
  // A hole belongs to the SMALLEST outline round it. An island standing in a hole has holes of its own,
  // which are inside the big outline as well, and handed to both they fill the plate in with wedges.
  const owner = holes.map((h) => {
    let best = null;
    for (const o of outers) if (insideLoop(h[0], o) && (!best || loopArea(o) < loopArea(best))) best = o;
    return best;
  });
  for (const outer of outers) {
    const mine = holes.filter((h, i) => owner[i] === outer);
    const flat = [...outer, ...mine.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), mine.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
    for (const [z, front] of [[z1, true], [z0, false]]) {
      const base = positions.length / 3;
      for (const [x, y] of flat) {
        positions.push(x, y, z);
        normals.push(0, 0, front ? 1 : -1);
        const t = uv(x, y);
        uvs.push(t[0], t[1]);
      }
      for (const [a, b, c] of faces) {
        const ax = flat[a][0]; const ay = flat[a][1]; const bx = flat[b][0]; const by = flat[b][1]; const cx = flat[c][0]; const cy = flat[c][1];
        const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
        if (front === ccw) index.push(base + a, base + b, base + c);
        else index.push(base + a, base + c, base + b);
      }
    }
  }
  // The walls. contour() leaves the inside on the left of every loop, outer or hole, so the outward normal
  // of every edge is its direction turned clockwise.
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[i]; const q = loop[(i + 1) % n];
      const dx = q[0] - p[0]; const dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1e-9;
      const nx = dy / len; const ny = -dx / len;
      const at = positions.length / 3;
      positions.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
      for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);
      const tp = uv(p[0], p[1]); const tq = uv(q[0], q[1]);
      uvs.push(tp[0], tp[1], tq[0], tq[1], tq[0], tq[1], tp[0], tp[1]);
      index.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
  }
  return windToNormals(indexed(positions, normals, uvs, index));
}

// The two-dimensional solids the openwork is made of: each a distance function and its bounds.
const ring2 = (cx, cy, R, w) => ({ box: [cx - R - w, cy - R - w, cx + R + w, cy + R + w], f: (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - R) - w });
const disc2 = (cx, cy, r) => ({ box: [cx - r, cy - r, cx + r, cy + r], f: (x, y) => Math.hypot(x - cx, y - cy) - r });
function capsule2(a, b, r0, r1 = r0) {
  const bx = b[0] - a[0]; const by = b[1] - a[1];
  const bb = bx * bx + by * by || 1e-9;
  const m = Math.max(r0, r1);
  return {
    box: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m],
    f: (x, y) => {
      const ax = x - a[0]; const ay = y - a[1];
      const t = clamp01((ax * bx + ay * by) / bb);
      return Math.hypot(ax - bx * t, ay - by * t) - (r0 + (r1 - r0) * t);
    },
  };
}

// The rete: rings computed from the projection, a little tracery, and one flame-shaped pointer per star,
// rooted on whichever part of the frame is nearest and ending exactly on the star.
export function reteLayout(L = astrolabeLayout()) {
  const band = 0.13;
  const E = L.ecliptic;
  const solids = [
    ring2(0, 0, L.Rcap, 0.05), // Capricorn, the outer ring
    ring2(E.x, E.y, E.r - band / 2, band / 2), // the ecliptic band, whose OUTER edge is the true ecliptic
    ring2(0, 0, L.Req, 0.024), // the equator
    disc2(0, 0, 0.17), // the hub
    capsule2([0, -L.Rcap], [0, L.Rcap], 0.027), // the meridian bar
    capsule2([-L.Rcap, 0], [L.Rcap, 0], 0.024), // the bar through the equinoxes
  ];
  // Tracery: three rings in the lower frame, each exactly filling the gap between the equator and the outer
  // ring, so that none can come loose and the rest of the frame stays open for the star pointers.
  const tracery = [];
  const tR = (L.Rcap - L.Req) / 2;
  const tMid = (L.Rcap + L.Req) / 2;
  for (const deg of [0, 50]) {
    const a = deg * DEG;
    tracery.push({ x: Math.sin(a) * tMid, y: -Math.cos(a) * tMid, r: tR });
  }
  for (const t of tracery) {
    solids.push(ring2(t.x, t.y, t.r, 0.02));
    if (t.x) solids.push(ring2(-t.x, t.y, t.r, 0.02));
  }
  // A ring of small lobes round the hub, each resting on a bar.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    solids.push(ring2(Math.cos(a) * 0.31, Math.sin(a) * 0.31, 0.115, 0.016));
  }
  // Where each pointer roots: the nearest of the frame's curves it can reach at a sensible length.
  const anchors = (at) => {
    const [x, y] = at;
    const r = Math.hypot(x, y) || 1e-6;
    const dE = Math.hypot(x - E.x, y - E.y) || 1e-6;
    const out = [
      [(x / r) * L.Rcap, (y / r) * L.Rcap],
      [(x / r) * L.Req, (y / r) * L.Req],
      [E.x + ((x - E.x) / dE) * (E.r - band / 2), E.y + ((y - E.y) / dE) * (E.r - band / 2)],
      [0, y],
      [x, 0],
    ];
    return out.map((p) => ({ p, d: Math.hypot(p[0] - x, p[1] - y) }));
  };
  const pointers = L.stars.map((s, i) => {
    const options = anchors(s.at).filter((o) => o.d > 0.2).sort((a, b) => a.d - b.d);
    const root = options[0].p;
    const tip = s.at;
    const dx = tip[0] - root[0]; const dy = tip[1] - root[1];
    const len = Math.hypot(dx, dy);
    const bow = 0.075 * len * (i % 2 ? 1 : -1);
    const path = [];
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const off = Math.sin(t * Math.PI) * bow * (1 - 0.3 * t);
      path.push([root[0] + dx * t - (dy / len) * off, root[1] + dy * t + (dx / len) * off]);
    }
    const radii = path.map((_, k) => {
      const t = k / n;
      // A flame: full at a third of the way along, drawn out to a fine point on the star.
      return 0.009 + 0.024 * Math.pow(1 - t, 1.1) * (0.7 + 2.2 * t * (1 - t));
    });
    return { name: s.name, tip, root, path, radii, length: len };
  });
  for (const p of pointers) {
    for (let k = 0; k < p.path.length - 1; k++) solids.push(capsule2(p.path[k], p.path[k + 1], p.radii[k], p.radii[k + 1]));
    solids.push(disc2(p.root[0], p.root[1], 0.042));
    // The star itself: a small four-pointed mark centred exactly on the true position.
    const m = 0.062;
    solids.push(capsule2([p.tip[0] - m, p.tip[1]], [p.tip[0], p.tip[1]], 0.003, 0.021), capsule2([p.tip[0], p.tip[1]], [p.tip[0] + m, p.tip[1]], 0.021, 0.003));
    solids.push(capsule2([p.tip[0], p.tip[1] - m], [p.tip[0], p.tip[1]], 0.003, 0.021), capsule2([p.tip[0], p.tip[1]], [p.tip[0], p.tip[1] + m], 0.021, 0.003));
  }
  const hole = 0.055;
  const limit = L.Rcap + 0.05;
  const f = (x, y) => {
    let d = 1e9;
    for (const s of solids) {
      const b = s.box;
      const m = 0.05;
      if (x < b[0] - m || x > b[2] + m || y < b[1] - m || y > b[3] + m) continue;
      const v = s.f(x, y);
      if (v < d) d = v;
    }
    d = Math.max(d, hole - Math.hypot(x, y));
    d = Math.max(d, Math.hypot(x, y) - limit); // nothing passes the outer ring
    return d;
  };
  return { f, solids, pointers, tracery, band, hole };
}

function buildAstrolabe() {
  const L = astrolabeLayout();
  const R = reteLayout(L);
  const group = new THREE.Group();
  const { outer: RO, inner: RI } = L.rim;
  const SIZE = 5.4; // the square each face's canvas covers, in feet
  const faceUV = (x, y) => [x / SIZE + 0.5, y / SIZE + 0.5];
  const toPx = (S) => (x) => (x / SIZE + 0.5) * S;
  const toPy = (S) => (y) => (0.5 - y / SIZE) * S;

  // --- The front: the latitude plate, and the mater's rim with its degree scale ---------------------------
  const FS = 2048;
  const fx = toPx(FS); const fy = toPy(FS);
  const fr = FS / SIZE;
  const front = canvasTexture(FS, FS, (ctx) => {
    ctx.fillStyle = '#b48c3e';
    ctx.fillRect(0, 0, FS, FS);
    // Spun polish: a faint sweep of light round the disc.
    const sheen = (r0, r1, a) => {
      const g = ctx.createConicGradient(0.6, fx(0), fy(0));
      for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, i % 2 ? `rgba(255,236,180,${a})` : `rgba(60,36,6,${a * 0.7})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx(0), fy(0), r1 * fr, 0, TAU);
      if (r0 > 0) ctx.arc(fx(0), fy(0), r0 * fr, 0, TAU, true);
      ctx.fill();
    };
    sheen(RI, RO + 0.1, 0.16);
    // The plate, paler than the rim and the rete so that their shapes read against it.
    ctx.fillStyle = '#d6ca9c';
    ctx.beginPath(); ctx.arc(fx(0), fy(0), RI * fr, 0, TAU); ctx.fill();
    sheen(0, RI, 0.12);

    // Engraving: a dark cut with a hairline of light along its lower edge.
    const engrave = (width, draw) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,244,205,0.55)';
      ctx.lineWidth = width;
      ctx.save(); ctx.translate(1.1, 1.3); ctx.beginPath(); draw(); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = '#3a2609';
      ctx.lineWidth = width;
      ctx.beginPath(); draw(); ctx.stroke();
    };
    const circle = (c, w) => engrave(w, () => { ctx.moveTo(fx(c.x + c.r), fy(c.y)); ctx.arc(fx(c.x), fy(c.y), c.r * fr, 0, TAU); });

    ctx.save();
    ctx.beginPath(); ctx.arc(fx(0), fy(0), L.Rcap * fr, 0, TAU); ctx.clip();
    // Altitude circles, every five degrees, heavier at each thirty.
    for (let a = 5; a <= 85; a += 5) circle(L.almucantar(a), a % 30 === 0 ? 4.4 : 2.6);
    // Azimuth arcs above the horizon only.
    const h = L.almucantar(0);
    ctx.save();
    ctx.beginPath(); ctx.arc(fx(h.x), fy(h.y), h.r * fr, 0, TAU); ctx.clip();
    // They stop short of the zenith, as a real plate's do, or they merge into a black blot.
    for (let az = 10; az <= 170; az += 10) {
      if (az === 90) { circle(L.azimuth(90), 3.2); continue; }
      const c = L.azimuth(az);
      circle(c, 2.2);
      circle({ x: -c.x, y: c.y, r: c.r }, 2.2);
    }
    ctx.restore();
    // The horizon, the meridian and the line through the east and west points.
    circle(h, 6);
    engrave(4.5, () => { ctx.moveTo(fx(0), fy(-L.Rcap)); ctx.lineTo(fx(0), fy(L.Rcap)); });
    engrave(3.5, () => { ctx.moveTo(fx(-L.Rcap), fy(0)); ctx.lineTo(fx(L.Rcap), fy(0)); });
    // The unequal hours, in the part of the plate below the horizon.
    for (let hour = 1; hour < 12; hour++) {
      engrave(3, () => {
        for (let k = 0; k <= 24; k++) {
          const dec = -L.obliquity + (2 * L.obliquity * k) / 24;
          const [x, y] = L.unequalHour(hour, dec);
          if (k === 0) ctx.moveTo(fx(x), fy(y));
          else ctx.lineTo(fx(x), fy(y));
        }
      });
    }
    ctx.restore();
    // The three great parallels, on top of everything.
    circle({ x: 0, y: 0, r: L.Rcan }, 5.5);
    circle({ x: 0, y: 0, r: L.Req }, 5.5);
    circle({ x: 0, y: 0, r: L.Rcap }, 6.5);

    // The rim: a true degree scale of plain ticks, with no numerals.
    const rA = 2.46; const rB = 2.33; const rC = 2.24; const rD = 2.17;
    for (const r of [rA, rB, rC, rD]) circle({ x: 0, y: 0, r }, r === rB ? 4 : 3);
    for (let d = 0; d < 360; d++) {
      const a = d * DEG;
      const long = d % 5 === 0;
      const r0 = long ? rB : rB + 0.05;
      engrave(d % 15 === 0 ? 4.6 : long ? 3.4 : 2.1, () => {
        ctx.moveTo(fx(Math.sin(a) * r0), fy(Math.cos(a) * r0));
        ctx.lineTo(fx(Math.sin(a) * rA), fy(Math.cos(a) * rA));
      });
    }
    // Between the two inner lines, a running border: a small eight-petalled rosette at every fifteenth
    // degree and a leaf pair between each. Pattern and nothing else.
    const midR = (rC + rD) / 2 + 0.02;
    const bandH = rC - rD;
    for (let d = 0; d < 360; d += 15) {
      const a = d * DEG;
      const cx = Math.sin(a) * midR; const cy = Math.cos(a) * midR;
      const pr = bandH * 0.24;
      for (let p = 0; p < 8; p++) {
        const b = (p / 8) * TAU;
        ctx.fillStyle = '#3a2609';
        ctx.beginPath();
        ctx.arc(fx(cx + Math.cos(b) * pr), fy(cy + Math.sin(b) * pr), pr * 0.5 * fr, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#ecd590';
      ctx.beginPath(); ctx.arc(fx(cx), fy(cy), pr * 0.5 * fr, 0, TAU); ctx.fill();
      // Two leaves leaning away from the middle of the bay.
      for (const s of [-1, 1]) {
        const am = (d + 7.5 + s * 2.6) * DEG;
        const lx = Math.sin(am) * midR; const ly = Math.cos(am) * midR;
        ctx.save();
        ctx.translate(fx(lx), fy(ly));
        ctx.rotate(am + (s * Math.PI) / 2);
        ctx.fillStyle = '#3a2609';
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.1 * fr * 0.42, bandH * 0.13 * fr, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  });

  // --- The back: the scales an astrolabe carries, in plain ticks, and a geometric medallion -----------------
  const BS = 1024;
  const bx = toPx(BS); const by = toPy(BS);
  const br = BS / SIZE;
  // The back is drawn as seen from behind, so its canvas x runs the other way from the model's.
  const back = canvasTexture(BS, BS, (ctx) => {
    ctx.fillStyle = '#cca85c';
    ctx.fillRect(0, 0, BS, BS);
    const g = ctx.createConicGradient(1.7, bx(0), by(0));
    for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, i % 2 ? 'rgba(255,236,180,0.15)' : 'rgba(60,36,6,0.13)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BS, BS);
    ctx.strokeStyle = '#3a2609';
    const ringLine = (x, y, r, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(bx(x), by(y), r * br, 0, TAU); ctx.stroke(); };
    for (const [r, w] of [[2.46, 2], [2.3, 2.4], [2.14, 1.6], [1.96, 1.6], [1.84, 1.6]]) ringLine(0, 0, r, w);
    // The altitude scale round the rim: a tick a degree.
    for (let d = 0; d < 360; d++) {
      const a = d * DEG;
      const r0 = d % 5 === 0 ? 2.3 : 2.37;
      ctx.lineWidth = d % 15 === 0 ? 2.4 : d % 5 === 0 ? 1.7 : 1;
      ctx.beginPath(); ctx.moveTo(bx(Math.sin(a) * r0), by(Math.cos(a) * r0)); ctx.lineTo(bx(Math.sin(a) * 2.46), by(Math.cos(a) * 2.46)); ctx.stroke();
    }
    // A calendar scale, 365 ticks and twelve long ones, on a ring a little off centre as a real one is.
    const cy = 0.04;
    for (let d = 0; d < 365; d++) {
      const a = (d / 365) * TAU;
      const long = d % 30 === 0;
      const r0 = long ? 1.96 : 2.05;
      ctx.lineWidth = long ? 2 : 0.9;
      ctx.beginPath(); ctx.moveTo(bx(Math.sin(a) * r0), by(Math.cos(a) * r0 + cy)); ctx.lineTo(bx(Math.sin(a) * 2.14), by(Math.cos(a) * 2.14 + cy)); ctx.stroke();
    }
    // A shadow square in the lower half: twelve divisions down each side.
    const s = 1.02;
    const top = -0.14; const left = -s; const size = 2 * s * 0.76;
    ctx.lineWidth = 2.4;
    ctx.strokeRect(bx(left * 0.76), by(top), size * br, size * br);
    ctx.lineWidth = 1;
    for (let i = 1; i < 12; i++) {
      const t = (i / 12) * size;
      ctx.beginPath(); ctx.moveTo(bx(left * 0.76 + t), by(top)); ctx.lineTo(bx(left * 0.76 + t), by(top - size)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx(left * 0.76), by(top - t)); ctx.lineTo(bx(left * 0.76 + size), by(top - t)); ctx.stroke();
    }
    // A twelve-pointed interlaced star above it.
    const cY = 0.92; const r1 = 0.66;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const b = ((i + 5) / 12) * TAU;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx(Math.sin(a) * r1), by(cY + Math.cos(a) * r1));
      ctx.lineTo(bx(Math.sin(b) * r1), by(cY + Math.cos(b) * r1));
      ctx.stroke();
    }
    ringLine(0, cY, r1 + 0.05, 2);
    ringLine(0, cY, 0.2, 1.6);
  });

  // Both faces are plain flat meshes with their texture coordinates taken from position.
  const annulus = (r0, r1, z, segments, facing, uvFn) => {
    const positions = []; const normals = []; const uvs = []; const index = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU;
      for (const r of [r0, r1]) {
        const x = Math.cos(a) * r; const y = Math.sin(a) * r;
        positions.push(x, y, z);
        normals.push(0, 0, facing);
        const t = uvFn(x, y);
        uvs.push(t[0], t[1]);
      }
      const j = (i + 1) % segments;
      index.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
    }
    return windToNormals(indexed(positions, normals, uvs, index));
  };
  const frontFace = [
    annulus(RI + 0.018, RO - 0.022, 0.1015, 160, 1, faceUV),
    annulus(0.001, RI, -0.02, 128, 1, faceUV),
  ];
  // Seen from behind, a canvas drawn left to right must run the opposite way along x.
  const backUV = (x, y) => [-x / SIZE + 0.5, y / SIZE + 0.5];
  const backFace = mergeParts([
    { geometry: annulus(0.001, RO - 0.022, -0.1615, 128, -1, backUV), color: 0xffffff },
    // A hidden skin inside the body makes this one closed sheet rather than a single open face.
    { geometry: annulus(0.001, RO - 0.022, -0.15, 128, 1, backUV), color: 0xffffff },
  ]);

  // --- The solid brass ---------------------------------------------------------------------------------
  const brass = [];
  const pushB = (geometry) => brass.push({ geometry, color: 0xffffff });
  const onZ = (profile, seg = 24) => { const g = lathe(profile, seg); g.rotateX(Math.PI / 2); return g; };

  // The mater: a raised rim round a recess the plate lies in.
  pushB(onZ([
    [0, -0.16], [RO - 0.03, -0.16], [RO, -0.13], [RO, 0.07], [RO - 0.03, 0.1], [RI + 0.02, 0.1], [RI, 0.08], [RI, -0.04], [0, -0.04],
  ], 160));
  // The plate's own edge inside the recess.
  pushB(onZ([[0, -0.04], [RI - 0.002, -0.04], [RI - 0.002, -0.021], [0, -0.021]], 128));

  // The throne: a pierced floral crest, with a thinner layer on its face so the lobes read as carved.
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
  const hyp = Math.hypot;
  const thronePlain = (x0, y) => {
    const x = Math.abs(x0);
    let d = hyp(x, y - 2.62) - 0.26;
    d = smin(d, hyp(x - 0.3, y - 2.56) - 0.19, 0.06);
    d = smin(d, hyp(x - 0.55, y - 2.48) - 0.125, 0.06);
    d = smin(d, hyp(x, y - 2.84) - 0.095, 0.05);
    return Math.max(d, 2.28 - y);
  };
  const thronePierced = (x0, y) => {
    const x = Math.abs(x0);
    let d = thronePlain(x0, y);
    let hole = hyp(x, y - 2.8) - 0.052;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      hole = Math.min(hole, hyp(x0 - Math.cos(a) * 0.145, y - 2.54 - Math.sin(a) * 0.145) - 0.04);
    }
    hole = Math.min(hole, hyp(x - 0.32, y - 2.57) - 0.055, hyp(x - 0.55, y - 2.49) - 0.03);
    d = Math.max(d, -hole);
    return d;
  };
  const throneBox = [-0.75, 2.26, 0.75, 3.0];
  const throneLoops = contour(thronePierced, throneBox, 0.0105).map((l) => simplifyLoop(l, 0.001));
  pushB(piercedPlate(throneLoops, -0.15, 0.092, faceUV));
  const inlayLoops = contour((x, y) => thronePierced(x, y) + 0.028, throneBox, 0.0105).map((l) => simplifyLoop(l, 0.001));
  pushB(piercedPlate(inlayLoops, 0.092, 0.112, faceUV));

  // The shackle through the crest and the ring it carries.
  const shackleY0 = 2.77; const shackleY1 = 3.07;
  const { m: sm } = alongMatrix([0, shackleY0, 0], [0, shackleY1, 0]);
  const shackle = chainLink(shackleY1 - shackleY0, 0.21, 0.026, { steps: 22, sides: 7 });
  shackle.translate(0, 0, (shackleY1 - shackleY0) / 2);
  shackle.applyMatrix4(sm);
  pushB(shackle);
  const ringC = 3.2; const ringR = 0.16;
  const bigRing = ringY(ringR, 0.03, 36, 10);
  bigRing.rotateX(Math.PI / 2);
  bigRing.translate(0, ringC, 0);
  pushB(bigRing);

  // The pin through everything, its washer, and the wedge that holds it: the "horse".
  pushB(onZ([[0, -0.3], [0.042, -0.3], [0.05, -0.27], [0.05, 0.2], [0.042, 0.235], [0, 0.245]], 18));
  pushB(onZ([[0, 0.078], [0.1, 0.078], [0.115, 0.09], [0.11, 0.105], [0.07, 0.118], [0, 0.118]], 28));
  {
    // A wedge with a stylised head at the wide end, drawn flat and passed through the pin.
    const y = 0;
    const outline = [
      [0.36, y + 0.012], [0.36, y - 0.012], [-0.16, y - 0.038], [-0.24, y - 0.042], [-0.3, y - 0.03], [-0.37, y - 0.052], [-0.415, y - 0.04],
      [-0.415, y - 0.008], [-0.37, y + 0.02], [-0.335, y + 0.075], [-0.31, y + 0.05], [-0.28, y + 0.082], [-0.25, y + 0.05], [-0.16, y + 0.038],
    ];
    const wedge = prism(outline, 0.135, 0.178);
    // Set at an angle, so that it reads as its own piece rather than as more of the bar behind it.
    wedge.rotateZ(38 * DEG);
    pushB(wedge);
  }

  // --- The rete -------------------------------------------------------------------------------------------
  const reteLoops = contour(R.f, [-2.1, -2.1, 2.1, 2.1], 0.0135).map((l) => simplifyLoop(l, 0.0016));
  const reteG = piercedPlate(reteLoops, 0.03, 0.085, faceUV);
  group.userData.reteArea = reteLoops.reduce((s, l) => s + loopArea(l), 0);
  group.userData.reteOuters = reteLoops.filter((l) => loopArea(l) > 0).length;
  group.userData.reteHoles = reteLoops.filter((l) => loopArea(l) <= 0).length;
  const RS = 1024;
  const rx = toPx(RS); const ry = toPy(RS);
  const rr = RS / SIZE;
  const reteMap = canvasTexture(RS, RS, (ctx) => {
    ctx.fillStyle = '#f0c552';
    ctx.fillRect(0, 0, RS, RS);
    const g = ctx.createConicGradient(0.2, rx(0), ry(0));
    for (let i = 0; i <= 16; i++) g.addColorStop(i / 16, i % 2 ? 'rgba(255,240,190,0.22)' : 'rgba(90,50,8,0.2)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, RS, RS);
    ctx.strokeStyle = '#4a2f0a';
    const line = (x0, y0, x1, y1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(rx(x0), ry(y0)); ctx.lineTo(rx(x1), ry(y1)); ctx.stroke(); };
    const E = L.ecliptic;
    // The ecliptic band: its scale is the true one, every five degrees of longitude at its projected
    // place, so the marks crowd together on the far side exactly as they do on a real rete.
    for (let lon = 0; lon < 360; lon += 5) {
      const [x, y] = L.eclipticPoint(lon);
      const r = Math.hypot(x, y) || 1;
      const dx = x / r; const dy = y / r;
      const depth = lon % 30 === 0 ? R.band : R.band * 0.4;
      line(x, y, x - dx * depth, y - dy * depth, lon % 30 === 0 ? 2.6 : 1.3);
    }
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(rx(E.x), ry(E.y), (E.r - R.band * 0.4) * rr, 0, TAU); ctx.stroke();
    // A hairline just inside each edge of the outer ring.
    ctx.lineWidth = 1.2;
    for (const r of [L.Rcap - 0.03, L.Rcap + 0.03]) { ctx.beginPath(); ctx.arc(rx(0), ry(0), r * rr, 0, TAU); ctx.stroke(); }
  });

  // --- The alidade, on the back ----------------------------------------------------------------------------
  const alidadeTurn = 38 * DEG;
  {
    const len = 2.42;
    const w0 = 0.13; const w1 = 0.09;
    const outline = [
      [-len, 0], [-len + 0.42, w1], [-0.3, w0], [0.3, w0], [len - 0.42, w1], [len, 0], [len - 0.42, -w1], [0.3, -w0], [-0.3, -w0], [-len + 0.42, -w1],
    ];
    const rule = prism(outline, -0.215, -0.168);
    const hub = onZ([[0, -0.245], [0.11, -0.245], [0.13, -0.225], [0.13, -0.2], [0, -0.2]], 24);
    const spin = new THREE.Matrix4().makeRotationZ(alidadeTurn);
    rule.applyMatrix4(spin);
    hub.applyMatrix4(spin);
    pushB(rule);
    pushB(hub);
    // Two sighting vanes, each a real plate pierced by a real hole, so a line of sight passes through both.
    for (const s of [-1, 1]) {
      const x = s * 1.72;
      const W = 0.1; const H0 = 0.0; const H1 = 0.36;
      const holeC = 0.25;
      const hole = [];
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; hole.push([Math.cos(a) * 0.028, holeC + Math.sin(a) * 0.028]); }
      const vane = prism([[-W, H0], [W, H0], [W, H1 - 0.03], [W - 0.03, H1], [-W + 0.03, H1], [-W, H1 - 0.03]], -0.02, 0.02, [hole]);
      // The plate stands across the rule: its width along local Y, its height backward along -Z.
      const basis = new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, -1), V(-1, 0, 0));
      const m = new THREE.Matrix4().makeTranslation(x, 0, -0.205).multiply(basis);
      vane.applyMatrix4(m);
      vane.applyMatrix4(spin);
      pushB(vane);
    }
  }

  // --- Hang it: everything so far is authored about the disc's centre, and turns on the hook -----------------
  const tilt = 6 * DEG;
  const hookY = 6.06;
  const localPivot = new THREE.Vector3(0, ringC + ringR, 0);
  const place = new THREE.Matrix4()
    .makeTranslation(0, hookY, 0)
    .multiply(new THREE.Matrix4().makeRotationX(-tilt))
    .multiply(new THREE.Matrix4().makeTranslation(-localPivot.x, -localPivot.y, -localPivot.z));
  group.userData.tilt = tilt;
  const placeAll = (g) => { g.applyMatrix4(place); return g; };
  brass.forEach((b) => placeAll(b.geometry));
  frontFace.forEach(placeAll);
  placeAll(backFace);
  placeAll(reteG);
  const at = (x, y, z) => V(x, y, z).applyMatrix4(place);

  // The hook the ring hangs on.
  {
    const wire = 0.024;
    const low = hookY - 0.03 - wire;
    pushB(tube([[0, hookY + 0.32, -0.08], [0, hookY + 0.14, -0.08], [0, low + 0.03, -0.065], [0, low, 0], [0, low + 0.03, 0.065], [0, low + 0.1, 0.085]], wire, { sides: 10, steps: 32, round: 2 }));
  }

  // --- The gallows stand ---------------------------------------------------------------------------------
  const wood = [];
  const walnut = 0x6e4524;
  const dark = 0x573418;
  const armLow = hookY + 0.16;
  const armTop = armLow + 0.24;
  const postZ = -1.2;
  wood.push({ geometry: timber([0, 0.08, -1.85], [0, 0.08, 1.2], 0.3, 0.16, 0.03), color: dark });
  wood.push({ geometry: timber([-1.8, 0.08, postZ], [1.8, 0.08, postZ], 0.3, 0.16, 0.03), color: dark });
  wood.push({ geometry: timber([-1.5, 0.08, 0.95], [1.5, 0.08, 0.95], 0.26, 0.16, 0.03), color: dark });
  wood.push({ geometry: timber([0, 0.1, postZ], [0, armTop + 0.02, postZ], 0.3, 0.3, 0.035, [0, 0, 1]), color: walnut });
  wood.push({ geometry: timber([0, (armLow + armTop) / 2, postZ - 0.2], [0, (armLow + armTop) / 2, 0.24], 0.22, 0.24, 0.03), color: walnut });
  wood.push({ geometry: timber([0, armLow - 0.62, postZ + 0.12], [0, armLow + 0.05, postZ + 0.72], 0.14, 0.12, 0.02), color: dark });
  wood.push({ geometry: timber([0, 0.12, postZ + 0.1], [0, 1.1, postZ - 0], 0.1, 0.1, 0.012), color: dark });
  // Two short braces at the foot of the post.
  wood.push({ geometry: timber([0.7, 0.14, postZ], [0.12, 1.0, postZ], 0.12, 0.1, 0.018, [0, 0, 1]), color: dark });
  wood.push({ geometry: timber([-0.7, 0.14, postZ], [-0.12, 1.0, postZ], 0.12, 0.1, 0.018, [0, 0, 1]), color: dark });
  // The rest that holds the disc's foot forward, which is what makes it tilt rather than hang plumb.
  const contact = at(0, -2.3, -0.16);
  wood.push({ geometry: timber([0, 0.1, contact.z - 0.08], [0, contact.y - 0.015, contact.z - 0.08], 0.34, 0.14, 0.02, [0, 0, 1]), color: walnut });

  const grain = grainMap(7501, { lines: 170, strength: 0.2, wander: 3 });
  grain.repeat.set(0.25, 0.75);
  group.add(mesh(mergeParts(wood), standard({ map: grain, vertexColors: true, roughness: 0.62, metalness: 0 })));
  const brassMerged = mergeParts(brass);
  polish(brassMerged, 0xcfa24a, { horizon: 1.22, sky: 1.1, band: 0.1 });
  group.add(mesh(brassMerged, standard({ vertexColors: true, roughness: 0.36, metalness: 0.42 })));
  front.anisotropy = 8;
  const frontMat = { map: front, bumpMap: front, bumpScale: 0.7, roughness: 0.4, metalness: 0.32 };
  group.add(mesh(mergeParts(frontFace.map((geometry) => ({ geometry, color: 0xffffff }))), standard(frontMat)));
  group.add(mesh(mergeParts([{ geometry: backFace, color: 0xffffff }]), standard({ map: back, bumpMap: back, bumpScale: 0.7, roughness: 0.42, metalness: 0.32 })));
  group.add(mesh(mergeParts([{ geometry: reteG, color: 0xffffff }]), standard({ map: reteMap, roughness: 0.34, metalness: 0.38 })));
  return group;
}

// ---------------------------------------------------------------------------
// The builders the file exports. Each of the others is added below as it is written.
// ---------------------------------------------------------------------------

export const MATH4_LAYOUTS = { hanoiLayout, baseTenLayout, balanceLayout, conicLayout, astrolabeLayout, reteLayout, revolvedVolume };

export const BUILDERS = {
  'balance-scale': () => buildBalance(),
  'brass-astrolabe': () => buildAstrolabe(),
  'conic-sections': () => buildConics(),
  'tower-of-hanoi': () => buildHanoi(),
  'base-ten-blocks': () => buildBaseTen(),
};
