import * as THREE from 'three';
import { seededRandom } from '../../PropKit.js';
import { mergeParts, solidSurface, smoothNoise3, splineAt, weldSeam } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, boxP, ellipsoidP, curveP, outward, mirrorX, lin, mix, clamp01, sstep, alongMatrix,
} from '../ModelKit.js';

// The Model Database's second batch of Artifacts: a medieval trebuchet, the Liberty Bell, a suit of
// 15th-century plate armor, a suit of samurai armor, a cuneiform tablet and an Inca quipu.
//
// Every one of them is READ AT SIX FEET, so the budget goes on what a teacher would point at: the
// cocked arm and the sling, the crack and the inscription, the overlapping lames, the silk lacing,
// the wedge marks, and knots that can really be counted.
//
// House rules are PropKit's: feet at scale 1, origin at the base centre, front toward +Z, fresh
// materials and textures per call, seededRandom only. Canvases are painted forward and never read
// back, because node only has a stub.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

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

function tinted(geometry, color) {
  const c = Array.isArray(color) ? color : lin(color);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// Repaints a geometry from its position and normal. fn(x, y, z, nx, ny, nz, out).
function paintVerts(geometry, fn) {
  const p = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const arr = new Float32Array(p.count * 3);
  const out = [1, 1, 1];
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 1, nrm ? nrm.getZ(i) : 0, out);
    arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// A squared timber, authored along Z: every face flat, end grain darker than the faces, and able to
// taper. UVs are in tile units with the grain along v, so one tall canvas serves every timber.
function beamGeo(len, w, h, { w2 = w, h2 = h, chamfer = 0, tile = [1, 2], color, rng = null, capShade = 0.6, jitter = 0.07 }) {
  const outlineOf = (W, H) => {
    const hw = W / 2; const hh = H / 2;
    const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
    return c > 0
      ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
      : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  };
  const A = outlineOf(w, h);
  const B = outlineOf(w2, h2);
  const u0 = rng ? rng() : 0;
  const v0 = rng ? rng() : 0;
  const k = rng ? 1 + (rng() - 0.5) * jitter * 2 : 1;
  const base = Array.isArray(color) ? color : lin(color);
  const side = [base[0] * k, base[1] * k, base[2] * k];
  const cap = [side[0] * capShade, side[1] * capShade, side[2] * capShade];
  const pos = []; const nor = []; const uvs = []; const col = [];
  const tri = (a, b, cc, n, tone, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
    for (let i = 0; i < 3; i++) col.push(...tone);
  };
  const z0 = -len / 2; const z1 = len / 2;
  let run = u0 * tile[0];
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3();
  for (let i = 0; i < A.length; i++) {
    const j = (i + 1) % A.length;
    const a0 = [A[i][0], A[i][1], z0]; const b0 = [A[j][0], A[j][1], z0];
    const a1 = [B[i][0], B[i][1], z1]; const b1 = [B[j][0], B[j][1], z1];
    const seg = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    e1.set(b0[0] - a0[0], b0[1] - a0[1], 0);
    e2.set(a1[0] - a0[0], a1[1] - a0[1], z1 - z0);
    const nv = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const n = [nv.x, nv.y, nv.z];
    const ua = run / tile[0]; const ub = (run + seg) / tile[0];
    const va = v0 + z0 / tile[1]; const vb = v0 + z1 / tile[1];
    tri(a0, b0, b1, n, side, [ua, va], [ub, va], [ub, vb]);
    tri(a0, b1, a1, n, side, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  const uvAt = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
  for (let i = 1; i < B.length - 1; i++) {
    tri([B[0][0], B[0][1], z1], [B[i][0], B[i][1], z1], [B[i + 1][0], B[i + 1][1], z1], [0, 0, 1], cap, uvAt(B[0][0], B[0][1]), uvAt(B[i][0], B[i][1]), uvAt(B[i + 1][0], B[i + 1][1]));
    tri([A[0][0], A[0][1], z0], [A[i + 1][0], A[i + 1][1], z0], [A[i][0], A[i][1], z0], [0, 0, -1], cap, uvAt(A[0][0], A[0][1]), uvAt(A[i + 1][0], A[i + 1][1]), uvAt(A[i][0], A[i][1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Carries a Z-authored geometry to lie from a to b with its local +Y as close to `up` as it can be.
function fromTo(geometry, a, b, up = null) {
  const A = vec(a); const B = vec(b);
  const z = B.clone().sub(A).normalize();
  let ref = up ? vec(up).normalize() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return geometry.applyMatrix4(m);
}

// A timber from a to b. `w` runs across, `h` runs along `up`.
function timber(list, color, a, b, w, h, opts = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  const g = beamGeo(len, w, h, { color, ...opts });
  list.push({ geometry: fromTo(g, a, b, opts.up), keepColor: true });
}

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour,
// so one canvas serves every timber in a model. Nothing goes much below 165, because a texel of 150
// is 30% of the colour in linear rather than 59%.
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
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: strength };
}

function texOf(canvas, space, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = space;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// A near-white rope tile, one strand-twist long and once round: 2-ply strands running diagonally,
// with fine fibres along each. Painted per texel, and both directions are whole cycles, so it tiles.
function ropeMaps({ size = 96, plies = 2, strength = 1.2 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size * 2);
  const W = size; const H = size * 2;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const phase = (x / W) * plies - (y / H);
      const s = Math.abs(Math.sin(Math.PI * phase * 1));
      const fibre = 0.5 + 0.5 * Math.sin(Math.PI * 2 * ((x / W) * plies * 7 + (y / H) * 3));
      const v = 150 + 92 * Math.sqrt(s) + 12 * fibre * s;
      const i = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, v);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: strength };
}

// A cord or rope: a closed swept solid, wound outward, with u once round and v in twists along its
// length, so a rope tile runs true. `ply` winds real strands into the surface as well, which only
// a thick rope can afford, and it needs about nine rows a twist or it aliases.
function rope(points, r, {
  sides = 7, steps = null, pitch = 0.4, round = 2, ply = 0, plies = 3, straight = false, radius = null,
} = {}) {
  let sample;
  if (straight) {
    const lens = [0];
    for (let i = 1; i < points.length; i++) lens.push(lens[i - 1] + vec(points[i]).distanceTo(vec(points[i - 1])));
    const total = lens[lens.length - 1];
    sample = (t) => {
      const d = t * total;
      let i = 0;
      while (i < points.length - 2 && lens[i + 1] < d) i++;
      const f = (d - lens[i]) / Math.max(1e-6, lens[i + 1] - lens[i]);
      return vec(lerp3(points[i], points[i + 1], f));
    };
  } else {
    const curve = new THREE.CatmullRomCurve3(points.map(vec), false, 'catmullrom', 0.5);
    sample = (t) => curve.getPoint(t);
  }
  const n = steps ?? Math.max(4, (points.length - 1) * 4);
  const C = [];
  for (let i = 0; i <= n; i++) C.push(sample(i / n));
  const T = C.map((p, i) => C[Math.min(n, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize());
  let N = Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const rows = [];
  let s = 0;
  const radOf = (t) => (radius ? radius(t) : r);
  for (let i = 0; i <= n; i++) {
    if (i > 0) s += C[i].distanceTo(C[i - 1]);
    N = N.clone().addScaledVector(T[i], -N.dot(T[i])).normalize();
    const B = new THREE.Vector3().crossVectors(T[i], N).normalize();
    rows.push({ c: C[i], N: N.clone(), B, T: T[i], r: radOf(i / n), s });
  }
  const list = [];
  const first = rows[0];
  if (first.r > 1e-3) {
    for (let a = 1; a <= round; a++) {
      const phi = ((round + 1 - a) / (round + 1)) * (Math.PI / 2);
      list.push({ ...first, c: first.c.clone().addScaledVector(first.T, -Math.sin(phi) * first.r), r: first.r * Math.cos(phi) });
    }
  }
  list.push(...rows);
  const last = rows[n];
  if (last.r > 1e-3) {
    for (let a = 1; a <= round; a++) {
      const phi = (a / (round + 1)) * (Math.PI / 2);
      list.push({ ...last, c: last.c.clone().addScaledVector(last.T, Math.sin(phi) * last.r), r: last.r * Math.cos(phi) });
    }
  }
  const pos = []; const uv = []; const idx = [];
  const ring = sides + 1;
  for (const row of list) {
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const wind = ply ? 1 + ply * Math.cos(plies * a - (row.s / pitch) * Math.PI * 2) : 1;
      const rr = row.r * wind;
      pos.push(
        row.c.x + (row.N.x * Math.cos(a) + row.B.x * Math.sin(a)) * rr,
        row.c.y + (row.N.y * Math.cos(a) + row.B.y * Math.sin(a)) * rr,
        row.c.z + (row.N.z * Math.cos(a) + row.B.z * Math.sin(a)) * rr,
      );
      uv.push(j / sides, row.s / (pitch * 2));
    }
  }
  const R = list.length;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j; const b = i * ring + j + 1; const c = (i + 1) * ring + j + 1; const d = (i + 1) * ring + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const pole0 = pos.length / 3;
  const e0 = list[0].c.clone().addScaledVector(list[0].T, -list[0].r * 0.3);
  pos.push(e0.x, e0.y, e0.z); uv.push(0.5, list[0].s / (pitch * 2));
  const pole1 = pos.length / 3;
  const e1 = list[R - 1].c.clone().addScaledVector(list[R - 1].T, list[R - 1].r * 0.3);
  pos.push(e1.x, e1.y, e1.z); uv.push(0.5, list[R - 1].s / (pitch * 2));
  for (let j = 0; j < sides; j++) {
    idx.push(pole0, j + 1, j);
    idx.push(pole1, (R - 1) * ring + j, (R - 1) * ring + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  weldSeam(g, ring, R);
  return outward(g);
}

// A surface of revolution with a real seam column, so a canvas can run once round it. `rows` are
// [r, y] or [r, y, v]. A repeated row makes a hard edge, since the zero-area quad between the two
// copies contributes no normal. The seam sits at `start`: pass Math.PI to hide it behind the model.
function wrapLathe(rows, { segments = 32, start = 0 } = {}) {
  const ring = segments + 1;
  const pos = []; const uv = []; const idx = [];
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const [r, y, v] = rows[i];
    for (let c = 0; c <= segments; c++) {
      const a = start + (c / segments) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(c / segments, v ?? i / Math.max(1, n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < segments; c++) {
      const a = i * ring + c; const b = i * ring + c + 1; const d = (i + 1) * ring + c; const e = (i + 1) * ring + c + 1;
      idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  weldSeam(g, ring, n);
  return outward(g);
}

// A closed flattened ball whose short axis lies along `normal`, sunk into whatever it sits on: a
// rivet, a boss, a pin.
function stud(at, normal, radius, thickness, detail = 8) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(3, detail >> 1));
  g.scale(1, thickness / radius, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(normal).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(vec(at), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// A round bar from a to b with flat ends.
function rod(a, b, r, { r2 = null, sides = 10 } = {}) {
  const A = vec(a); const B = vec(b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, sides);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// A helix of rope round a straight member between a and b: lashing, woolding, or a coil on a drum.
function coil(a, b, radius, turns, r, { sides = 6, stepsPerTurn = 10, up = [0, 1, 0], squash = 1, pitch = 0.25 } = {}) {
  const { m } = alongMatrix(a, b, up);
  const len = vec(a).distanceTo(vec(b));
  const n = Math.max(8, Math.round(turns * stepsPerTurn));
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = t * turns * Math.PI * 2;
    v.set(Math.cos(ang) * radius, Math.sin(ang) * radius * squash, t * len).applyMatrix4(m);
    pts.push([v.x, v.y, v.z]);
  }
  return rope(pts, r, { sides, steps: n, pitch, round: 1 });
}

// ---------------------------------------------------------------------------
// The Inca quipu
// ---------------------------------------------------------------------------
//
// THE NUMBERS ARE A TABLE AND THE KNOTS ARE COUNTED FROM IT, so nothing can disagree. A cord reads
// three rows: the knots nearest the main cord are hundreds, then tens, then ones, and an empty row
// is a zero, which is real and is how a quipu writes one. The rows line up across the whole
// hanging, because that alignment is how a reader finds their place.
//
// THE LAST CORD OF EACH GROUP IS THE SUM OF THE OTHERS, computed rather than typed. Summary cords
// are a well-attested feature of real khipu (Ascher and Ascher), so a student who adds a group up
// finds the total hanging at the end of it.
//
// ONE SIMPLIFICATION, stated here because a teacher may ask: on a real khipu the ones are usually
// tied as one long knot with that many turns and a one as a figure of eight. Here every digit is
// that many separate knots, so that it can be counted from six feet, as the card asks.

const QP_DYE = {
  red: 0x9e1b20,
  natural: 0xbfa478,
  indigo: 0x1d2d6e,
  ochre: 0xc98a18,
  umber: 0x4b2f1c,
  rose: 0xb8505a,
  sky: 0x4a6fa5,
};

const QP_GROUPS = [
  { cords: [{ value: 352, dye: 'red' }, { value: 124, dye: 'natural' }, { value: 207, dye: 'indigo', sub: { value: 15, dye: 'ochre' } }, { value: 61, dye: 'ochre' }] },
  { cords: [{ value: 135, dye: 'red' }, { value: 48, dye: 'natural', sub: { value: 23, dye: 'rose' } }, { value: 210, dye: 'indigo' }, { value: 13, dye: 'ochre' }] },
  { cords: [{ value: 114, dye: 'red' }, { value: 201, dye: 'natural' }, { value: 52, dye: 'indigo' }] },
];

const QP_ROW = { hundreds: 4.3, tens: 2.98, ones: 1.66 };
const QP_KNOT_GAP = 0.19;
const QP_CORD_R = 0.034;
const QP_MAIN_R = 0.078;
const QP_BAR_Y = 5.58;
const QP_LASH = [-2.98, -1.03, 1.07, 2.98];

// Where the main cord hangs at x: a shallow sag between the lashings that tie it to the bar.
function qpMainY(x) {
  let best = 0;
  for (let i = 0; i < QP_LASH.length - 1; i++) {
    const a = QP_LASH[i]; const b = QP_LASH[i + 1];
    if (x >= a && x <= b) { best = Math.sin((Math.PI * (x - a)) / (b - a)) * 0.075; }
  }
  return QP_BAR_Y - 0.24 - best;
}

// The real overhand knot: a trefoil curve closed on itself round the cord. Its three-fold axis runs
// along the cord, so from the side it shows the crossing strands a tied knot shows.
function qpKnot(center, a, b, r) {
  const pts = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push([
      center[0] + (a * (Math.sin(t) + 2 * Math.sin(2 * t))) / 3,
      center[1] - b * Math.sin(3 * t),
      center[2] + (a * (Math.cos(t) - 2 * Math.cos(2 * t))) / 3,
    ]);
  }
  return rope(pts, r, { sides: 5, steps: 22, pitch: 0.2, round: 0 });
}

function qpTags() {
  const { canvas, ctx } = makeCanvas(512, 512);
  const labels = ['hundreds', 'tens', 'ones'];
  ctx.fillStyle = '#e8dcc0';
  ctx.fillRect(0, 0, 512, 512);
  labels.forEach((word, i) => {
    const y0 = (i * 512) / 3;
    ctx.strokeStyle = '#5a3f24';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, y0 + 10, 492, 512 / 3 - 20);
    let size = 90;
    do {
      ctx.font = `600 ${size}px Georgia, serif`;
      size -= 2;
    } while (ctx.measureText(word).width > 450 && size > 20);
    ctx.fillStyle = '#2d2013';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, 256, y0 + 512 / 6);
  });
  const t = texOf(canvas, THREE.SRGBColorSpace, false);
  return t;
}

function incaQuipu() {
  const rng = seededRandom(14092);
  const wood = [];
  const cords = [];
  const tagParts = [];
  const WOOD = 0x6e4726;
  const WOOD_DK = 0x4f321b;
  const BEAM = { chamfer: 0.035, rng, tile: [1.2, 2.6] };

  // ---- the display frame
  const POST_X = 3.14;
  for (const sx of [-1, 1]) {
    timber(wood, WOOD, [sx * POST_X, 0.2, 0], [sx * POST_X, 5.82, 0], 0.34, 0.34, { ...BEAM, up: [0, 0, 1] });
    // A low pyramid cap, so the post top is a finished thing.
    wood.push({ geometry: tinted(beamGeo(0.14, 0.42, 0.42, { w2: 0.12, h2: 0.12, color: WOOD_DK, tile: [1.2, 2.6] }).rotateX(-Math.PI / 2).translate(sx * POST_X, 5.89, 0), WOOD_DK), keepColor: true });
    timber(wood, WOOD_DK, [sx * POST_X, 0.13, -1.25], [sx * POST_X, 0.13, 1.25], 0.46, 0.26, { ...BEAM });
    // A raking brace each way, housed into the sill and the post.
    for (const sz of [-1, 1]) {
      timber(wood, WOOD, [sx * POST_X, 0.22, sz * 0.92], [sx * POST_X, 1.5, sz * 0.06], 0.2, 0.15, { ...BEAM, up: [1, 0, 0] });
      // Pegs through the foot and head of each brace.
      for (const at of [[sx * POST_X + sx * 0.1, 1.28, sz * 0.2], [sx * POST_X + sx * 0.1, 0.42, sz * 0.74]]) {
        wood.push({ geometry: stud(at, [sx, 0, 0], 0.03, 0.02, 7), color: WOOD_DK });
      }
    }
  }
  // Rail behind the cords' ends, which ties the two feet together.
  timber(wood, WOOD, [-POST_X, 0.4, -0.5], [POST_X, 0.4, -0.5], 0.14, 0.2, { ...BEAM });
  // The bar is a turned pole, running through both posts with a ball at each end.
  {
    const rows = [
      [0, -3.56], [0.05, -3.555], [0.1, -3.52], [0.115, -3.46], [0.09, -3.41], [0.08, -3.38], [0.13, -3.34],
      [0.14, -3.3], [0.14, 3.3], [0.13, 3.34], [0.08, 3.38], [0.09, 3.41], [0.115, 3.46], [0.1, 3.52], [0.05, 3.555], [0, 3.56],
    ];
    const g = wrapLathe(rows, { segments: 18 });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), g.attributes.position.getY(i) / 2.6);
    g.rotateZ(-Math.PI / 2);
    g.translate(0, QP_BAR_Y, 0);
    wood.push({ geometry: tinted(g, 0x7a5029), keepColor: true });
    // Collars where it enters the post.
    for (const sx of [-1, 1]) {
      const c = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16).rotateZ(Math.PI / 2).translate(sx * (POST_X - 0.18), QP_BAR_Y, 0);
      wood.push({ geometry: c, color: 0x8a6a32 });
      const d = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16).rotateZ(Math.PI / 2).translate(sx * (POST_X + 0.18), QP_BAR_Y, 0);
      wood.push({ geometry: d, color: 0x8a6a32 });
    }
  }

  // ---- the main cord: thick enough to have real strands wound into it
  {
    const pts = [];
    const x0 = -3.02; const x1 = 3.02;
    const N = 44;
    for (let i = 0; i <= N; i++) {
      const x = mix(x0, x1, i / N);
      pts.push([x, qpMainY(x), 0]);
    }
    const g = rope(pts, QP_MAIN_R, { sides: 15, steps: 140, pitch: 0.42, ply: 0.1, plies: 3 });
    cords.push({ geometry: tinted(g, 0xa98d5f), keepColor: true });
  }
  // Tied to the bar: a wrap of the same cord round pole and cord together.
  for (const x of QP_LASH) {
    const ym = qpMainY(x);
    const pts = [];
    const turns = 3;
    const N = turns * 14;
    const top = QP_BAR_Y + 0.14 + 0.024;
    const bot = ym - QP_MAIN_R - 0.024;
    const cy = (top + bot) / 2;
    const half = (top - bot) / 2;
    const rz = 0.14 + 0.024;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * turns * Math.PI * 2;
      // A rounded stadium: closer to the circle of the pole at the top and the cord at the bottom.
      const s = Math.sin(t); const c = Math.cos(t);
      const k = Math.pow(Math.abs(s), 0.6) * Math.sign(s);
      pts.push([x + ((i / N) - 0.5) * 0.16, cy + half * k, rz * c * (s < 0 ? 0.68 : 1)]);
    }
    cords.push({ geometry: tinted(rope(pts, 0.024, { sides: 6, steps: N, pitch: 0.12, round: 1 }), 0x8f7650), keepColor: true });
  }
  // The trailing ends of the main cord, each finished with a whipped end and a little tuft.
  for (const [sx, xe] of [[-1, -3.02], [1, 3.02]]) {
    const y0 = qpMainY(xe);
    const pts = [[xe, y0, 0], [xe + sx * 0.04, y0 - 0.05, 0.01], [xe + sx * 0.05, y0 - 0.2, 0.02], [xe + sx * 0.03, y0 - 0.42, 0.01]];
    cords.push({ geometry: tinted(rope(pts, QP_MAIN_R * 0.82, { sides: 10, steps: 12, pitch: 0.42, ply: 0.08 }), 0xa98d5f), keepColor: true });
  }

  // ---- the pendants
  const swayOf = (seed) => {
    const r2 = seededRandom(seed);
    const p1 = r2() * 6.28; const p2 = r2() * 6.28; const a1 = 0.018 + r2() * 0.02; const a2 = 0.012 + r2() * 0.012;
    return (y) => [a1 * Math.sin(y * 1.4 + p1) * sstep(5.2 - y, 0, 0.9), a2 * Math.sin(y * 1.1 + p2) * sstep(5.2 - y, 0, 0.9)];
  };
  const knotsAt = (level, digit) => {
    const out = [];
    for (let i = 0; i < digit; i++) out.push(level + ((digit - 1) / 2 - i) * QP_KNOT_GAP);
    return out;
  };
  const counted = [];

  const hang = (x, value, color, opts = {}) => {
    const { yTop = null, parentZ = 0.105, r = QP_CORD_R, a = 0.085, b = 0.05, seed = 1, endY = 0.7 } = opts;
    const sway = swayOf(seed);
    const lineAt = (y) => { const s = sway(y); return [x + s[0], y, parentZ + s[1]]; };
    const pts = [];
    if (yTop === null) {
      // Round the main cord: it starts buried behind it, climbs over the top and comes down in
      // front. Two tubes that are one cord, and no daylight at the join.
      const ym = qpMainY(x);
      const R = QP_MAIN_R + r * 0.75;
      pts.push([x - 0.02, ym - 0.045, -0.02]);
      pts.push([x - 0.022, ym - 0.02, -R]);
      pts.push([x - 0.015, ym + R * 0.98, -R * 0.15]);
      pts.push([x - 0.004, ym + R * 0.3, R * 0.98]);
      pts.push([x, ym - 0.13, parentZ]);
      for (let y = ym - 0.42; y > endY + 0.12; y -= 0.46) pts.push(lineAt(y));
      pts.push(lineAt(endY));
      // A half-hitch collar beside it.
      cords.push({ geometry: tinted(rope(ringPts3(x + 0.052, ym, QP_MAIN_R + r * 0.55, 12), r * 0.86, { sides: 5, steps: 14, pitch: 0.2, round: 0 }), color), keepColor: true });
    } else {
      // A subsidiary: starts inside its parent and swings out to its own line.
      // It starts in the parent's own centre line, asked for rather than assumed, with a collar of its
      // own cord round the parent at the tie.
      const px = opts.parentLine(yTop + 0.1);
      const tie = opts.parentLine(yTop + 0.03);
      pts.push(px);
      pts.push([tie[0] + (x - tie[0]) * 0.12, yTop + 0.02, tie[2]]);
      pts.push([tie[0] + (x - tie[0]) * 0.5, yTop - 0.09, tie[2] + 0.012]);
      const collar = [];
      for (let i = 0; i <= 10; i++) {
        const ang = (i / 10) * Math.PI * 2;
        collar.push([tie[0] + Math.cos(ang) * (QP_CORD_R + r * 0.6), tie[1] + (i / 10) * 0.02, tie[2] + Math.sin(ang) * (QP_CORD_R + r * 0.6)]);
      }
      cords.push({ geometry: tinted(rope(collar, r * 0.9, { sides: 5, steps: 12, pitch: 0.2, round: 0 }), color), keepColor: true });
      pts.push([x, yTop - 0.3, parentZ]);
      for (let y = yTop - 0.72; y > endY + 0.12; y -= 0.46) pts.push(lineAt(y));
      pts.push(lineAt(endY));
    }
    const steps = Math.max(24, Math.round(pts.length * 3.2));
    const g = rope(pts, r, { sides: 7, steps, pitch: 0.2, round: 0 });
    cords.push({ geometry: tinted(g, color), keepColor: true });

    // The digits. Every knot is placed from the number and counted back out for the check tool.
    const h = Math.floor(value / 100); const t = Math.floor((value % 100) / 10); const o = value % 10;
    const tally = [];
    for (const [level, digit] of [[QP_ROW.hundreds, h], [QP_ROW.tens, t], [QP_ROW.ones, o]]) {
      const ys = knotsAt(level, digit);
      for (const y of ys) {
        const k = qpKnot(lineAt(y), a, b, r * 1.02);
        cords.push({ geometry: tinted(k, color), keepColor: true });
      }
      tally.push(ys.length);
    }

    // A frayed end, nothing like a knot: a few fine strands splaying from the cut.
    const end = lineAt(endY);
    const r3 = seededRandom(seed + 77);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * 6.28 + r3();
      const reach = 0.035 + r3() * 0.03;
      const fall = 0.14 + r3() * 0.1;
      const e = [end[0] + Math.cos(ang) * reach, end[1] - fall, end[2] + Math.sin(ang) * reach];
      cords.push({
        geometry: tinted(rope([[end[0], end[1] + 0.03, end[2]], [end[0] + Math.cos(ang) * reach * 0.4, end[1] - fall * 0.45, end[2] + Math.sin(ang) * reach * 0.4], e], r * 0.42, {
          sides: 4, steps: 5, round: 0, pitch: 0.2, radius: (t2) => r * 0.42 * (1 - t2 * 0.55),
        }), color),
        keepColor: true,
      });
    }
    return { tally, lineAt };
  };

  // Lay the groups out from the left as the student faces it (-X is the left from +Z).
  const SPACING = 0.365;
  const GROUP_GAP = 0.66;
  const flat = [];
  for (const group of QP_GROUPS) {
    const total = group.cords.reduce((sum, c) => sum + c.value, 0);
    flat.push({ list: [...group.cords, { value: total, dye: 'umber', isSum: true }] });
  }
  const totalWidth = flat.reduce((w, g) => w + (g.list.length - 1) * SPACING, 0) + GROUP_GAP * (flat.length - 1);
  let x = -totalWidth / 2;
  let cordIndex = 0;
  flat.forEach((group) => {
    group.list.forEach((cord, i) => {
      const seed = 400 + cordIndex * 37;
      const r4 = seededRandom(seed + 5);
      const endY = 0.62 + r4() * 0.14;
      const { tally, lineAt } = hang(x, cord.value, QP_DYE[cord.dye], { seed, endY });
      counted.push({ index: cordIndex, value: cord.value, dye: cord.dye, isSum: !!cord.isSum, x, knots: tally });
      if (cord.sub) {
        const sx = x + 0.17;
        const { tally: subTally } = hang(sx, cord.sub.value, QP_DYE[cord.sub.dye], {
          yTop: 3.72, parentLine: lineAt, seed: seed + 11, r: QP_CORD_R * 0.72, a: 0.066, b: 0.04, endY: endY + 0.28, parentZ: 0.105,
        });
        counted.push({ index: cordIndex, subsidiary: true, value: cord.sub.value, dye: cord.sub.dye, x: sx, knots: subTally });
      }
      if (i < group.list.length - 1) x += SPACING;
      cordIndex += 1;
    });
    x += GROUP_GAP;
  });

  // ---- three little tags on the left post, level with the rows
  const tagW = 0.86; const tagH = 0.3;
  [QP_ROW.hundreds, QP_ROW.tens, QP_ROW.ones].forEach((y, i) => {
    const g = new THREE.BoxGeometry(tagW, tagH, 0.03);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / 3);
    g.translate(-POST_X - 0.16, y, 0.185);
    tagParts.push({ geometry: g, color: 0xffffff });
    for (const sx of [-1, 1]) wood.push({ geometry: stud([-POST_X - 0.16 + sx * (tagW / 2 - 0.045), y, 0.205], [0, 0, 1], 0.02, 0.014, 6), color: 0x8a6a32 });
  });

  const group = groupOf(
    meshOf(wood, { ...grainMaps({ seed: 21, strength: 0.6 }), roughness: 0.72, metalness: 0 }),
    meshOf(cords, { ...ropeMaps({ size: 64, plies: 2, strength: 1.4 }), roughness: 0.96, metalness: 0 }),
    meshOf(tagParts, { map: qpTags(), roughness: 0.85, metalness: 0 }),
  );
  group.userData.quipu = counted;
  return group;
}

function ringPts3(x, y, R, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([x, y + Math.sin(a) * R, Math.cos(a) * R]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// The cuneiform tablet
// ---------------------------------------------------------------------------
//
// A WEDGE IS A SHAPE PRESSED BY A CUT REED, so it is drawn as one: a triangular head with three
// facets falling to a deep point, then a long thin tail. The map paints each facet by which way it
// faces a light from the upper left, and the bump paints its depth, so it reads as an impression at
// any range. Rows and columns are ruled first and the signs fitted into them. The marks are
// representative: no real text, and no Unicode cuneiform, which a canvas cannot trust anyway.
//
// ONE DESCRIPTION OF THE BREAKS: the solids the sculpt cuts away also decide where no wedge is
// painted, so a mark never ends up smeared across a fracture surface.

const TAB_W = 3.25;
const TAB_H = 4.0;
const TAB_T = 1.02;
const TAB_ROUND = 0.3;
const TAB_LEAN = -0.15;
const TAB_FOOT = 0.96;
const TAB_CANVAS_W = 1024;
const TAB_CANVAS_H = Math.round((TAB_CANVAS_W * TAB_H) / TAB_W);

const tabNoise = (x, y, z, f) => smoothNoise3(x * f + 11.3, y * f + 3.7, z * f + 7.1) - 0.5;

function tabBreaks() {
  const rough = (prim, amp, f) => ({
    box: prim.box.map((v, i) => (i < 3 ? v - amp : v + amp)),
    f: (x, y, z) => prim.f(x, y, z) - amp * (tabNoise(x, y, z, f) * 2 + tabNoise(x, y, z, f * 2.3) * 0.8),
  });
  return [
    // The big loss: the upper right corner, gone along a slanting fracture.
    rough(boxP([1.9, 4.05, 0.08], [0.98, 0.72, 1.0], [0.1, 0.25, 0.68]), 0.1, 2.6),
    // The smaller loss at the lower left, which took the front arris and left the back standing.
    rough(boxP([-1.82, 0.14, 0.52], [0.6, 0.44, 0.52], [-0.28, 0.3, 0.72]), 0.08, 3.1),
    // Knocks along the edges, the handling any old tablet has had.
    rough(ellipsoidP([1.66, 1.5, 0.3], [0.12, 0.3, 0.2]), 0.03, 6),
    rough(ellipsoidP([-1.6, 2.62, 0.34], [0.12, 0.2, 0.2]), 0.03, 6),
    rough(ellipsoidP([-0.72, 4.02, 0.3], [0.3, 0.12, 0.22]), 0.03, 6),
  ];
}

function tabThickness(x, y) {
  const u = x / (TAB_W / 2); const v = (y - TAB_H / 2) / (TAB_H / 2);
  return (TAB_T / 2) * (0.6 + 0.4 * (1 - u * u) * (1 - v * v));
}

function tabBody() {
  const hw = TAB_W / 2 - TAB_ROUND; const hh = TAB_H / 2 - TAB_ROUND; const hz = TAB_T / 2 - TAB_ROUND;
  return {
    box: [-TAB_W / 2, 0, -TAB_T / 2, TAB_W / 2, TAB_H, TAB_T / 2],
    f: (x, y, z) => {
      // A hand-formed slab is never true: its outline wanders and it is not symmetrical front to back.
      const px = x + 0.035 * Math.sin(y * 1.7 + 0.6) + 0.012 * Math.sin(y * 3.7);
      const py = y - TAB_H / 2 + 0.03 * Math.sin(x * 1.5 + 2.1);
      const pz = (z - 0.012 * Math.sin(x * 1.3 + y)) * ((TAB_T / 2) / tabThickness(x, y));
      const dx = Math.abs(px) - hw; const dy = Math.abs(py) - hh; const dz = Math.abs(pz) - hz;
      const ox = Math.max(dx, 0); const oy = Math.max(dy, 0); const oz = Math.max(dz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0) - TAB_ROUND;
    },
  };
}

// One wedge in canvas pixels. Head at (x, y), tail along `angle`. Painted into both the colour and
// the depth canvas, in the same coordinates.
function drawWedge(mc, bc, x, y, angle, head, tail) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  const P = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const A = P(-head * 0.42, -head * 0.62);
  const B = P(-head * 0.42, head * 0.62);
  const D = P(head * 0.12, 0); // the deepest point, where the reed's corner bit in
  const E = P(tail, 0);
  // Which way each facet faces, against a light from the upper left of the canvas.
  const lightOf = (p, q) => {
    const ex = q[0] - p[0]; const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    // The inward normal of the facet's outer edge, which is the direction it slopes down toward.
    const nx = -ey / len; const ny = ex / len;
    return clamp01(0.5 + 0.5 * (nx * -0.6 + ny * -0.8));
  };
  const poly = (ctx, pts) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  // A pressed lip all round it, thrown up by the reed: bright on the side away from the light.
  mc.lineWidth = Math.max(1.6, head * 0.09);
  mc.lineJoin = 'round';
  mc.strokeStyle = 'rgba(255,250,240,0.85)';
  poly(mc, [A, E, B]);
  mc.stroke();
  bc.lineWidth = Math.max(2, head * 0.14);
  bc.lineJoin = 'round';
  bc.strokeStyle = 'rgb(186,186,186)';
  poly(bc, [A, E, B]);
  bc.stroke();

  const facets = [[A, E], [E, B], [B, A]];
  for (const [p, q] of facets) {
    const lit = lightOf(p, q);
    const v = Math.round(92 + 120 * lit);
    mc.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
    poly(mc, [p, q, D]);
    mc.fill();
    // Depth runs from the surface at the outer edge to its bottom at D.
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const grad = bc.createLinearGradient(mid[0], mid[1], D[0], D[1]);
    grad.addColorStop(0, 'rgb(128,128,128)');
    grad.addColorStop(1, 'rgb(22,22,22)');
    bc.fillStyle = grad;
    poly(bc, [p, q, D]);
    bc.fill();
  }
}

// A sign is a small cluster of wedges, drawn from a set of plausible arrangements.
const TAB_SIGNS = [
  // kind, dx, dy, in units of a row height: h a horizontal, v an upright, d a slant down, u a slant
  // up, w the corner mark with no tail.
  { w: 0.72, m: [['h', 0, -0.22], ['h', 0, 0.2], ['v', 0.5, -0.32]] },
  { w: 0.46, m: [['v', 0.1, -0.34], ['v', 0.32, -0.34]] },
  { w: 0.62, m: [['w', 0.05, -0.2], ['w', 0.05, 0.16], ['v', 0.38, -0.34]] },
  { w: 0.78, m: [['d', 0, -0.32], ['h', 0.08, 0.14], ['h', 0.3, -0.12]] },
  { w: 0.86, m: [['h', 0, -0.3], ['h', 0, 0], ['h', 0, 0.3], ['v', 0.6, -0.34]] },
  { w: 0.54, m: [['w', 0.05, 0], ['u', 0.22, 0.28]] },
  { w: 0.74, m: [['v', 0.05, -0.34], ['h', 0.16, 0], ['v', 0.56, -0.34]] },
  { w: 0.92, m: [['h', 0, -0.2], ['d', 0.3, -0.22], ['u', 0.34, 0.26], ['v', 0.72, -0.34]] },
  { w: 0.34, m: [['w', 0.05, -0.14], ['w', 0.05, 0.2]] },
  { w: 0.64, m: [['u', 0, 0.3], ['d', 0, -0.3], ['h', 0.3, 0]] },
  { w: 0.58, m: [['h', 0, 0], ['v', 0.34, -0.34]] },
];

function tabletMaps(breaks) {
  const W = TAB_CANVAS_W; const H = TAB_CANVAS_H;
  const { canvas: mapC, ctx: mc } = makeCanvas(W, H);
  const { canvas: bumpC, ctx: bc } = makeCanvas(W, H);
  const rng = seededRandom(9103);
  mc.fillStyle = '#efe7da';
  mc.fillRect(0, 0, W, H);
  bc.fillStyle = 'rgb(138,138,138)';
  bc.fillRect(0, 0, W, H);
  // Grit and low blotches, so the clay between the marks is not one flat tone.
  for (let i = 0; i < 2600; i++) {
    const x = rng() * W; const y = rng() * H; const r = 0.5 + rng() * 2.2;
    const light = rng() > 0.5;
    const v = light ? 250 : 200 + rng() * 28;
    mc.fillStyle = `rgba(${v},${v - 6},${v - 16},${0.2 + rng() * 0.4})`;
    mc.beginPath(); mc.arc(x, y, r, 0, Math.PI * 2); mc.fill();
    const b = light ? 160 : 112;
    bc.fillStyle = `rgba(${b},${b},${b},0.5)`;
    bc.beginPath(); bc.arc(x, y, r, 0, Math.PI * 2); bc.fill();
  }

  const px = (x) => ((x + TAB_W / 2) / TAB_W) * W;
  const py = (y) => H - (y / TAB_H) * H;
  const toX = (p) => (p / W) * TAB_W - TAB_W / 2;
  const toY = (p) => ((H - p) / H) * TAB_H;

  const blocked = (cx, cy) => {
    const x = toX(cx); const y = toY(cy);
    const z = tabThickness(x, y) - 0.06;
    for (const b of breaks) if (b.f(x, y, z) < 0.05) return true;
    return false;
  };

  // Ruled lines first: drawn by the scribe with a cord or the edge of a reed.
  const left = px(-TAB_W / 2 + 0.3); const right = px(TAB_W / 2 - 0.3);
  const top = py(TAB_H - 0.34); const bottom = py(0.32);
  const ROWS = 11;
  const rowH = (bottom - top) / ROWS;
  const COLS = 3;
  const colW = (right - left) / COLS;
  const rule = (x0, y0, x1, y1) => {
    mc.strokeStyle = 'rgba(112,96,78,0.85)';
    mc.lineWidth = 2.2;
    mc.beginPath(); mc.moveTo(x0, y0); mc.lineTo(x1, y1); mc.stroke();
    mc.strokeStyle = 'rgba(255,250,240,0.7)';
    mc.lineWidth = 1.2;
    mc.beginPath(); mc.moveTo(x0 + 1.4, y0 + 1.4); mc.lineTo(x1 + 1.4, y1 + 1.4); mc.stroke();
    bc.strokeStyle = 'rgb(60,60,60)';
    bc.lineWidth = 3;
    bc.beginPath(); bc.moveTo(x0, y0); bc.lineTo(x1, y1); bc.stroke();
  };
  const segmented = (x0, y0, x1, y1) => {
    // Broken up wherever it would cross a fracture.
    const N = 60;
    let start = null;
    for (let i = 0; i <= N; i++) {
      const x = mix(x0, x1, i / N); const y = mix(y0, y1, i / N);
      const ok = !blocked(x, y);
      if (ok && !start) start = [x, y];
      if ((!ok || i === N) && start) { rule(start[0], start[1], x, y); start = null; }
    }
  };
  for (let r = 0; r <= ROWS; r++) {
    const wob = (r % 3) * 0.7;
    segmented(left, top + r * rowH, right, top + r * rowH + wob);
  }
  for (let c = 1; c < COLS; c++) {
    for (const off of [-3.5, 3.5]) segmented(left + c * colW + off, top, left + c * colW + off, bottom);
  }

  const headOf = rowH * 0.3;
  const kinds = {
    h: { a: 0, tail: 0.74 },
    v: { a: Math.PI / 2, tail: 0.68 },
    d: { a: Math.PI / 4, tail: 0.6 },
    u: { a: -Math.PI / 4, tail: 0.6 },
    w: { a: 0, tail: 0.2 },
  };
  for (let r = 0; r < ROWS; r++) {
    const midY = top + (r + 0.5) * rowH;
    for (let c = 0; c < COLS; c++) {
      let cursor = left + c * colW + rowH * 0.18;
      const end = left + (c + 1) * colW - rowH * 0.18;
      while (cursor < end) {
        const sign = TAB_SIGNS[Math.floor(rng() * TAB_SIGNS.length)];
        const wide = sign.w * rowH;
        if (cursor + wide > end) break;
        const yJit = (rng() - 0.5) * rowH * 0.05;
        for (const [kind, dx, dy] of sign.m) {
          const k = kinds[kind];
          const x = cursor + dx * rowH + headOf * 0.5;
          const y = midY + dy * rowH + yJit;
          if (blocked(x, y)) continue;
          const head = headOf * (0.9 + rng() * 0.22);
          // The scribe's own hand: a slight slant, and no two the same length.
          drawWedge(mc, bc, x, y, k.a + (rng() - 0.5) * 0.09, head, k.tail * rowH * (0.86 + rng() * 0.28));
        }
        cursor += wide + rowH * (0.08 + rng() * 0.12);
      }
    }
  }
  return {
    map: texOf(mapC, THREE.SRGBColorSpace, false),
    bumpMap: texOf(bumpC, THREE.NoColorSpace, false),
  };
}

function cuneiformTablet() {
  const breaks = tabBreaks();
  const CLAY = lin(0x9e6d47);
  const CORE = lin(0x8a6a4e);
  const s = new Sculpt(0.052);
  s.add(tabBody(), CLAY);
  // Dents from the fingers that held it wet, big and shallow.
  for (const [p, r] of [[[-0.55, 0.74, 0.95], [0.62, 0.42, 0.5]], [[0.7, 3.1, -0.95], [0.6, 0.5, 0.52]], [[-0.9, 2.1, -0.94], [0.5, 0.62, 0.5]]]) {
    s.sub(ellipsoidP(p, r), null, { k: 0.2 });
  }
  for (const b of breaks) s.sub(b, CORE, { k: 0.018, ck: 0.05 });

  const g0 = polygonize(s, {
    normalH: 0.5,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // Baked clay: slow drifts of warmer and darker, and it carries the kiln's smoke at one end.
      const a = tabNoise(x, y, z, 0.9); const b = tabNoise(x + 4, y, z, 2.3);
      const k = 1 + a * 0.5 + b * 0.22;
      const smoke = sstep(tabNoise(x + 9, y - 2, z, 0.7), 0.05, 0.3) * 0.34;
      rgb[0] *= k * (1 - smoke); rgb[1] *= k * (1 - smoke * 1.05); rgb[2] *= k * (1 - smoke * 1.1);
    },
  });
  // Per triangle, because the face and the back read the same canvas with u mirrored. A triangle
  // spanning the two lies on the plain margin, where the join cannot be seen.
  const g = g0.toNonIndexed();
  const P = g.attributes.position; const UV = g.attributes.uv;
  for (let t = 0; t < P.count; t += 3) {
    const zc = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const u = (P.getX(i) + TAB_W / 2) / TAB_W;
      UV.setXY(i, zc >= 0 ? u : 1 - u, P.getY(i) / TAB_H);
    }
  }
  // Leaned back on its stand. A proper rotation, so nothing turns inside out.
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(TAB_LEAN));
  g.translate(0, TAB_FOOT, 0);
  const tablet = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, ...tabletMaps(breaks), bumpScale: 2.6, roughness: 0.9, metalness: 0,
  }));
  tablet.castShadow = true;
  tablet.receiveShadow = true;

  // ---- the stand
  const rng = seededRandom(771);
  const wood = [];
  const metal = [];
  const WOOD = 0x5c3a20; const WOOD_DK = 0x3f2715;
  const B = { chamfer: 0.03, rng, tile: [1.2, 2.6] };
  const block = (w, h, d, y0, color = WOOD, opts = {}) => {
    timber(wood, color, [-w / 2, y0 + h / 2, 0], [w / 2, y0 + h / 2, 0], d, h, { ...B, ...opts });
  };
  block(4.0, 0.2, 2.5, 0, WOOD_DK);
  block(3.76, 0.1, 2.26, 0.2, WOOD);
  block(3.4, 0.5, 1.98, 0.3, WOOD);
  block(3.66, 0.1, 2.2, 0.8, WOOD);
  block(3.84, 0.12, 2.36, 0.9, WOOD_DK);
  const TOP = 1.02;
  // Two rails either side of the tablet's foot, which is what is actually holding it.
  const lean = (y, z) => {
    const c = Math.cos(TAB_LEAN); const sn = Math.sin(TAB_LEAN);
    return [y * c - z * sn + TAB_FOOT, y * sn + z * c];
  };
  const footFrontZ = lean(0.42, tabThickness(0, 0.42))[1];
  const footBackZ = lean(0.42, -tabThickness(0, 0.42))[1];
  timber(wood, WOOD, [-1.55, TOP + 0.13, footFrontZ + 0.06], [1.55, TOP + 0.13, footFrontZ + 0.06], 0.2, 0.3, { ...B });
  timber(wood, WOOD, [-1.55, TOP + 0.13, footBackZ - 0.06], [1.55, TOP + 0.13, footBackZ - 0.06], 0.2, 0.3, { ...B });
  // Back struts, leaning with the tablet and sunk a little into its back.
  for (const sx of [-1, 1]) {
    const [y1, z1] = lean(2.3, -tabThickness(sx * 0.72, 2.3) + 0.06);
    timber(wood, WOOD, [sx * 0.72, TOP, footBackZ - 0.42], [sx * 0.72, y1, z1 - 0.1], 0.26, 0.2, { ...B, up: [0, 0, 1] });
    metal.push({ geometry: stud([sx * 0.72, TOP + 0.06, footBackZ - 0.42], [0, 1, 0], 0.17, 0.05, 12), color: 0x9a7a3a });
  }
  timber(wood, WOOD, [-0.96, 2.18, footBackZ - 0.32], [0.96, 2.18, footBackZ - 0.32], 0.18, 0.2, { ...B });
  // Brass caps on the rail ends, and a small plain plate where a museum's label would go.
  for (const sx of [-1, 1]) {
    for (const z of [footFrontZ + 0.06, footBackZ - 0.06]) {
      metal.push({ geometry: stud([sx * 1.55, TOP + 0.13, z], [sx, 0, 0], 0.09, 0.03, 10), color: 0x9a7a3a });
    }
  }
  return groupOf(
    tablet,
    meshOf(wood, { ...grainMaps({ seed: 33, strength: 0.5 }), roughness: 0.55, metalness: 0 }),
    meshOf(metal, { roughness: 0.42, metalness: 0.45 }),
  );
}

// ---------------------------------------------------------------------------
// The trebuchet
// ---------------------------------------------------------------------------
//
// IT IS COCKED, AND THE GEOMETRY IS WORKED OUT SO THAT IT WOULD FIRE. Everything hangs off one line,
// the arm: P(s) is a point s feet along it from the axle, positive toward the long end. The long end
// is hauled down behind the machine, the counterweight rides high over the +Z end, and the sling lies
// slack in a trough running forward under the axle, with the target out past +Z. The box falls
// between the two A-frames and clears the ground transoms at the bottom of its swing, checked below
// rather than assumed: its lowest point is TB_BOX_LOW.

const TB_AX = [0, 13.4, 1.0];
const TB_TIP_Y = 1.4;
const TB_LONG = 17;
const TB_SHORT = 5.6;
const TB_SIN = (TB_AX[1] - TB_TIP_Y) / TB_LONG;
const TB_COS = Math.sqrt(1 - TB_SIN * TB_SIN);
const tbP = (s, x = 0) => [x, TB_AX[1] - s * TB_SIN, TB_AX[2] - s * TB_COS];
const TB_ARM_UP = [0, TB_COS, -TB_SIN]; // the arm's own "up", square to its length
const TB_HANG = 2;
const TB_BOX_H = 3.8;
const TB_BOX_LOW = TB_AX[1] - TB_SHORT - TB_HANG - TB_BOX_H; // 2.0: over the transoms' 1.45
const TB_FRAME_X = 1.75;
const TB_LEG_FOOT = 6.4;

const tbArmSize = (s) => {
  // Deepest at the axle, tapering hard along the long end, which is what a throwing arm is.
  if (s < 0) return [mix(0.85, 0.8, -s / TB_SHORT), mix(1.05, 0.9, -s / TB_SHORT)];
  const t = s / TB_LONG;
  return [mix(0.85, 0.38, t), mix(1.05, 0.46, t)];
};

// A prism along X from an outline in (z, y), flat on every face, grain along z. For the skids, whose
// ends are cut up like a sledge's, and for the saw-toothed ratchet.
function prismX(outline, x0, x1, color, { tile = [1.2, 2.6], capShade = 0.62 } = {}) {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [a, b] = outline[i]; const [c, d] = outline[(i + 1) % outline.length];
    area += a * d - c * b;
  }
  const pts = area < 0 ? [...outline].reverse() : outline;
  const base = lin(color);
  const cap = base.map((v) => v * capShade);
  const pos = []; const nor = []; const uv = []; const col = []; const idx = [];
  // Seen in (z, y), counter-clockwise; a world +X is out of that plane toward -Z x Y, so the outward
  // normal of an edge is worked out from the 3D cross product directly.
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const [z1, y1] = pts[i]; const [z2, y2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(z2 - z1, y2 - y1) || 1e-6;
    const n = [0, -(z2 - z1) / len, (y2 - y1) / len];
    const b = pos.length / 3;
    pos.push(x0, y1, z1, x1, y1, z1, x1, y2, z2, x0, y2, z2);
    for (let k = 0; k < 4; k++) { nor.push(...n); col.push(...base); }
    uv.push(run / tile[0], z1 / tile[1], (run + Math.abs(x1 - x0)) / tile[0], z1 / tile[1], (run + Math.abs(x1 - x0)) / tile[0], z2 / tile[1], run / tile[0], z2 / tile[1]);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    run += 0.31;
  }
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([a, c]) => new THREE.Vector2(a, c)), []);
  for (const [x, nx] of [[x0, -1], [x1, 1]]) {
    const b = pos.length / 3;
    for (const [z, y] of pts) { pos.push(x, y, z); nor.push(nx, 0, 0); col.push(...cap); uv.push(z / tile[0], y / tile[0]); }
    for (const [p, q, r] of tris) {
      if (nx > 0) idx.push(b + p, b + r, b + q);
      else idx.push(b + p, b + q, b + r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return outward(g);
}

// Rope wound tight round a squared timber: a helix with a rounded-rectangle section, so that it lies
// on the faces instead of bridging the corners of a circle.
function wrapBeam(a, b, w, h, turns, r, { up = [0, 1, 0], sides = 5, perTurn = 14, pitch = 0.2 } = {}) {
  const { m } = alongMatrix(a, b, up);
  const len = vec(a).distanceTo(vec(b));
  const n = Math.max(8, Math.round(turns * perTurn));
  const pts = [];
  const v = new THREE.Vector3();
  const sp = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = t * turns * Math.PI * 2;
    v.set((w / 2 + r * 0.7) * sp(Math.cos(ang), 0.38), (h / 2 + r * 0.7) * sp(Math.sin(ang), 0.38), t * len).applyMatrix4(m);
    pts.push([v.x, v.y, v.z]);
  }
  return rope(pts, r, { sides, steps: n, pitch, round: 1 });
}

// A broken rock, flat-shaded on purpose: a boulder in a crib is all fracture.
function rock(rng, r, at) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const sx = 0.8 + rng() * 0.4; const sy = 0.7 + rng() * 0.35; const sz = 0.8 + rng() * 0.4;
  const seed = rng() * 50;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const k = 1 + (smoothNoise3(x * 1.4 + seed, y * 1.4, z * 1.4) - 0.5) * 0.7;
    p.setXYZ(i, x * k * sx * r + at[0], y * k * sy * r + at[1], z * k * sz * r + at[2]);
  }
  g.computeVertexNormals();
  return g;
}

function trebuchet() {
  const rng = seededRandom(5521);
  const wood = []; const ropes = []; const iron = []; const stone = []; const leather = [];
  const OAK = 0x80603a; const OAK_DK = 0x5f4527; const OAK_LT = 0x93703f;
  const IRON = 0x4d4a47; const HEMP = 0xb39a68;
  const B = { chamfer: 0.05, rng, tile: [1.3, 3.2] };
  const beam = (a, b, w, h, opts = {}, color = OAK) => timber(wood, color, a, b, w, h, { ...B, ...opts });
  const strap = (a, b, w, h, opts = {}) => timber(iron, IRON, a, b, w, h, { capShade: 0.85, jitter: 0, ...opts });
  const rivet = (at, n, r = 0.06) => iron.push({ geometry: tinted(stud(at, n, r, r * 0.55, 7), IRON), keepColor: true });
  const peg = (at, n) => wood.push({ geometry: tinted(stud(at, n, 0.07, 0.035, 7), OAK_DK), keepColor: true });
  const lash = (a, b, w, h, turns, up) => ropes.push({ geometry: tinted(wrapBeam(a, b, w, h, turns, 0.05, { up }), HEMP), keepColor: true });

  // ---- the base: two skids, cut up at the ends like a sledge's so it can be dragged into place
  const SK = (sx) => prismX(
    [[-9.6, 0.5], [-8.7, 0], [8.9, 0], [9.8, 0.5], [9.8, 0.9], [-9.6, 0.9]],
    sx * TB_FRAME_X - 0.48, sx * TB_FRAME_X + 0.48, OAK_DK,
  );
  wood.push({ geometry: SK(-1), keepColor: true }, { geometry: SK(1), keepColor: true });
  const rearZ = TB_AX[2] - TB_LEG_FOOT; const frontZ = TB_AX[2] + TB_LEG_FOOT;
  const TRANSOMS = [[-8.5, 2.75], [rearZ, 5.4], [TB_AX[2] + 0.2, 2.75], [frontZ, 5.4], [9.05, 2.75]];
  for (const [z, half] of TRANSOMS) {
    beam([-half, 1.17, z], [half, 1.17, z], 0.62, 0.56, {}, OAK_DK);
    for (const sx of [-1, 1]) {
      // A pegged half-lap on the skid.
      peg([sx * TB_FRAME_X - 0.16, 1.45, z - 0.14], [0, 1, 0]);
      peg([sx * TB_FRAME_X + 0.16, 1.45, z + 0.14], [0, 1, 0]);
    }
  }
  // Outer rails tie the two long transoms together and carry the raking struts.
  for (const sx of [-1, 1]) {
    beam([sx * 5.05, 1.62, rearZ - 0.5], [sx * 5.05, 1.62, frontZ + 0.5], 0.42, 0.34, {}, OAK);
    for (const z of [rearZ, frontZ]) peg([sx * 5.05, 1.79, z], [0, 1, 0]);
  }

  // ---- the two A-frames
  const legZ = (y, sz) => TB_AX[2] + sz * TB_LEG_FOOT * (1 - (y - 1.0) / (TB_AX[1] - 0.7 - 1.0));
  const APEX_Y = TB_AX[1] - 0.7;
  for (const sx of [-1, 1]) {
    const X = sx * TB_FRAME_X;
    for (const sz of [-1, 1]) {
      beam([X, 1.0, TB_AX[2] + sz * TB_LEG_FOOT], [X, APEX_Y, TB_AX[2]], 0.6, 0.66, { up: [1, 0, 0] });
      // An iron shoe where the leg enters the transom.
      const yS = 2.05;
      strap([X, yS - 0.09, legZ(yS - 0.09, sz)], [X, yS + 0.09, legZ(yS + 0.09, sz)], 0.63, 0.69, { up: [1, 0, 0] });
      rivet([X + sx * 0.33, yS, legZ(yS, sz) - sz * 0.15], [sx, 0, 0]);
      rivet([X + sx * 0.33, yS, legZ(yS, sz) + sz * 0.15], [sx, 0, 0]);
    }
    beam([X, 1.0, TB_AX[2]], [X, APEX_Y - 0.2, TB_AX[2]], 0.56, 0.56, { up: [1, 0, 0] });
    // Two ties across each frame, standing proud on its outer face, pegged and lashed at each leg.
    for (const y of [5.3, 9.1]) {
      const zr = legZ(y, -1) - 0.5; const zf = legZ(y, 1) + 0.5;
      const Xo = X + sx * 0.46;
      beam([Xo, y, zr], [Xo, y, zf], 0.32, 0.5);
      for (const sz of [-1, 1]) {
        const zl = legZ(y, sz);
        // Lashing: a run of rope round the tie, close up against the leg it holds on to.
        lash([Xo, y, zl - sz * 0.42 - 0.26], [Xo, y, zl - sz * 0.42 + 0.26], 0.32, 0.5, 5);
        peg([Xo + sx * 0.16, y + 0.1, zl], [sx, 0, 0]);
        peg([Xo + sx * 0.16, y - 0.1, zl], [sx, 0, 0]);
      }
      peg([Xo + sx * 0.16, y, TB_AX[2]], [sx, 0, 0]);
    }
    // Bearing block on top of the legs: what the axle actually sits in.
    beam([X, APEX_Y + 0.28, TB_AX[2] - 1.0], [X, APEX_Y + 0.28, TB_AX[2] + 1.0], 0.84, 0.72, {}, OAK_DK);
    // The bearing cap, strapped down over the axle with two iron bands and four bolts.
    beam([X, TB_AX[1] + 0.25, TB_AX[2] - 0.55], [X, TB_AX[1] + 0.25, TB_AX[2] + 0.55], 0.84, 0.46, {}, OAK_DK);
    for (const sz of [-1, 1]) {
      const z = TB_AX[2] + sz * 0.42;
      strap([X - 0.44, TB_AX[1] + 0.5, z], [X + 0.44, TB_AX[1] + 0.5, z], 0.12, 0.04);
      for (const s2 of [-1, 1]) {
        strap([X + s2 * 0.43, APEX_Y - 0.1, z], [X + s2 * 0.43, TB_AX[1] + 0.52, z], 0.12, 0.04, { up: [1, 0, 0] });
        rivet([X + s2 * 0.45, TB_AX[1] + 0.25, z], [s2, 0, 0]);
        rivet([X + s2 * 0.45, APEX_Y + 0.28, z], [s2, 0, 0]);
      }
    }
    // Raking struts out to the rails, which is what stops the frames falling over sideways.
    for (const sz of [-1, 1]) {
      const y1 = 8.1;
      const z1 = legZ(y1, sz);
      beam([sx * 5.05, 1.7, TB_AX[2] + sz * TB_LEG_FOOT], [X + sx * 0.28, y1, z1], 0.34, 0.34, { up: [0, 0, 1] });
      lash([X, y1 - 0.3, z1 + sz * 0.164], [X, y1 + 0.3, z1 - sz * 0.164], 0.62, 0.68, 6, [1, 0, 0]);
    }
  }
  // Cross beam low between the rear legs. There is none at the front: the box falls through there.
  {
    const y = 5.0;
    const z = legZ(y, -1);
    beam([-TB_FRAME_X - 0.2, y, z], [TB_FRAME_X + 0.2, y, z], 0.5, 0.56);
    for (const sx of [-1, 1]) peg([sx * (TB_FRAME_X + 0.2), y, z], [sx, 0, 0]);
  }

  // ---- the axle: iron, turning in both bearings and through the arm
  iron.push({ geometry: tinted(rod([-2.75, TB_AX[1], TB_AX[2]], [2.75, TB_AX[1], TB_AX[2]], 0.28, { sides: 18 }), 0x4a4845), keepColor: true });
  for (const sx of [-1, 1]) {
    // A collar outside the bearing, and a through pin to keep it there.
    iron.push({ geometry: tinted(rod([sx * 2.34, TB_AX[1], TB_AX[2]], [sx * 2.46, TB_AX[1], TB_AX[2]], 0.38, { sides: 18 }), IRON), keepColor: true });
    iron.push({ geometry: tinted(rod([sx * 2.62, TB_AX[1] - 0.42, TB_AX[2]], [sx * 2.62, TB_AX[1] + 0.42, TB_AX[2]], 0.05, { sides: 7 }), IRON), keepColor: true });
    iron.push({ geometry: tinted(stud([sx * 2.75, TB_AX[1], TB_AX[2]], [sx, 0, 0], 0.27, 0.05, 14), 0x55524e), keepColor: true });
  }

  // ---- the arm
  {
    const [w0, h0] = tbArmSize(-TB_SHORT); const [w1, h1] = tbArmSize(0); const [w2, h2] = tbArmSize(TB_LONG);
    timber(wood, OAK_LT, tbP(-TB_SHORT), tbP(0), w0, h0, { ...B, w2: w1, h2: h1, up: TB_ARM_UP, jitter: 0 });
    timber(wood, OAK_LT, tbP(0), tbP(TB_LONG), w1, h1, { ...B, w2, h2, up: TB_ARM_UP, jitter: 0 });
    const armBand = (s, len = 0.2) => {
      const [w, h] = tbArmSize(s);
      strap(tbP(s - len / 2), tbP(s + len / 2), w + 0.05, h + 0.05, { up: TB_ARM_UP });
      for (const sx of [-1, 1]) rivet(tbP(s, sx * (w / 2 + 0.03)), [sx, 0, 0], 0.05);
    };
    for (const s of [-5.2, -4.0, -1.1, 1.1, 3.1, 5.3]) armBand(s);
    // Woolding: rope bound hard round the long end, where a throw tries to split it.
    for (const s of [8.0, 10.6, 13.0, 15.4]) {
      const [w, h] = tbArmSize(s);
      ropes.push({ geometry: tinted(wrapBeam(tbP(s - 0.32), tbP(s + 0.32), w, h, 7, 0.05, { up: TB_ARM_UP }), HEMP), keepColor: true });
    }
    // Iron tip with a prong, bent upward, which is what the sling's loose loop slips off to release.
    const tip = tbP(TB_LONG);
    armBand(TB_LONG - 0.16, 0.34);
    const [, tipH] = tbArmSize(TB_LONG);
    const prongBase = lerp3(tip, vec(tip).toArray(), 0);
    const pr1 = [prongBase[0], prongBase[1] + TB_ARM_UP[1] * tipH * 0.1, prongBase[2] + TB_ARM_UP[2] * tipH * 0.1];
    const prong = rope([
      lerp3(pr1, tbP(TB_LONG - 0.3), 1),
      pr1,
      tbP(TB_LONG + 0.5).map((v, i) => v + TB_ARM_UP[i] * 0.1),
      tbP(TB_LONG + 0.9).map((v, i) => v + TB_ARM_UP[i] * 0.34),
    ], 0.06, { sides: 8, steps: 14, pitch: 1, radius: (t) => mix(0.075, 0.03, t), round: 1 });
    iron.push({ geometry: tinted(prong, IRON), keepColor: true });
    // The eye under the tip that the fixed side of the sling is tied to.
    const eye = tbP(TB_LONG - 0.42).map((v, i) => v - TB_ARM_UP[i] * (tipH / 2 + 0.1));
    const eyePts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      eyePts.push([eye[0] + Math.cos(a) * 0.14, eye[1] + Math.sin(a) * 0.14 * TB_ARM_UP[1], eye[2] + Math.sin(a) * 0.14 * TB_ARM_UP[2]]);
    }
    iron.push({ geometry: tinted(rope(eyePts, 0.035, { sides: 6, steps: 16, pitch: 1, round: 0 }), IRON), keepColor: true });

    // ---- the hanger pin and the counterweight
    const pin = tbP(-TB_SHORT + 0.42);
    iron.push({ geometry: tinted(rod([-1.0, pin[1], pin[2]], [1.0, pin[1], pin[2]], 0.13, { sides: 12 }), 0x4a4845), keepColor: true });
    const boxTop = pin[1] - TB_HANG;
    const zc = pin[2];
    const BW = 2.6; const BD = 2.5;
    for (const sx of [-1, 1]) {
      iron.push({ geometry: tinted(stud([sx * 1.0, pin[1], zc], [sx, 0, 0], 0.18, 0.05, 12), IRON), keepColor: true });
      // Each hanger: a timber strapped with iron, gripping the pin at the top and the box at the foot.
      beam([sx * 0.78, pin[1] + 0.24, zc], [sx * 0.78, boxTop - 0.55, zc], 0.3, 0.72, { up: [0, 0, 1], chamfer: 0.04 });
      strap([sx * 0.95, pin[1] + 0.28, zc], [sx * 0.95, boxTop - 0.6, zc], 0.05, 0.18, { up: [0, 0, 1] });
      for (const y of [pin[1] - 0.5, pin[1] - 1.2, boxTop + 0.2, boxTop - 0.4]) rivet([sx * 0.98, y, zc], [sx, 0, 0], 0.055);
    }
    // The crib: four corner posts and heavy planks with gaps, so the stones inside can be seen from
    // the ground. An open box at 15ft is only a box, whatever is in it.
    const y0 = boxTop - TB_BOX_H; const y1 = boxTop;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      beam([sx * (BW / 2 - 0.15), y0, zc + sz * (BD / 2 - 0.15)], [sx * (BW / 2 - 0.15), y1 + 0.1, zc + sz * (BD / 2 - 0.15)], 0.34, 0.34, { up: [0, 0, 1] }, OAK_DK);
    }
    const PLANKS = 6;
    const pitch = (y1 - y0) / PLANKS;
    const plankH = pitch * 0.76;
    for (let i = 0; i < PLANKS; i++) {
      const y = y0 + (i + 0.5) * pitch;
      for (const sz of [-1, 1]) beam([-BW / 2 - 0.02, y, zc + sz * (BD / 2 - 0.02)], [BW / 2 + 0.02, y, zc + sz * (BD / 2 - 0.02)], 0.14, plankH, {}, OAK);
      for (const sx of [-1, 1]) beam([sx * (BW / 2 - 0.02), y, zc - BD / 2 - 0.02], [sx * (BW / 2 - 0.02), y, zc + BD / 2 + 0.02], 0.14, plankH, {}, OAK);
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) rivet([sx * (BW / 2 - 0.15), y, zc + sz * (BD / 2 + 0.05)], [0, 0, sz], 0.05);
    }
    beam([-BW / 2 - 0.04, y0 + 0.14, zc], [BW / 2 + 0.04, y0 + 0.14, zc], BD + 0.08, 0.28, {}, OAK_DK);
    // Iron bands all the way round, top and bottom.
    for (const y of [y1 - 0.08, y0 + 0.3]) {
      for (const sz of [-1, 1]) strap([-BW / 2 - 0.1, y, zc + sz * (BD / 2 + 0.08)], [BW / 2 + 0.1, y, zc + sz * (BD / 2 + 0.08)], 0.04, 0.2);
      for (const sx of [-1, 1]) strap([sx * (BW / 2 + 0.08), y, zc - BD / 2 - 0.1], [sx * (BW / 2 + 0.08), y, zc + BD / 2 + 0.1], 0.04, 0.2);
    }
    // Stones fill it, and what shows between the planks is stone with dark behind it. They rise
    // past the lip, or it reads as empty from above.
    stone.push({ geometry: new THREE.BoxGeometry(BW - 0.75, TB_BOX_H - 0.2, BD - 0.75).translate(0, (y0 + y1) / 2, zc), color: 0x1c1a18 });
    const inside = seededRandom(90);
    for (let i = 0; i < 74; i++) {
      const onTop = i < 30;
      const r = 0.25 + inside() * 0.2;
      let at;
      if (onTop) {
        at = [(inside() - 0.5) * (BW - 0.75), y1 - 0.05 + inside() * 0.2, zc + (inside() - 0.5) * (BD - 0.75)];
      } else {
        const side = Math.floor(inside() * 4);
        const a = (inside() - 0.5) * (BW - 0.6); const b = (inside() - 0.5) * (BD - 0.6);
        const y = y0 + 0.4 + inside() * (TB_BOX_H - 0.6);
        at = side === 0 ? [a, y, zc + BD / 2 - 0.34] : side === 1 ? [a, y, zc - BD / 2 + 0.34] : side === 2 ? [BW / 2 - 0.34, y, zc + b] : [-BW / 2 + 0.34, y, zc + b];
      }
      const shade = 0.75 + inside() * 0.5;
      const c = lin(0x6e6b64).map((v) => v * shade);
      stone.push({ geometry: tinted(rock(inside, r, at), c), keepColor: true });
    }
  }

  // ---- the trough, on the ground, running forward from behind the arm's tip to past the axle
  {
    const z0 = -11.2; const z1 = 3.2;
    beam([0, 0.08, z0], [0, 0.08, z1], 1.5, 0.16, { chamfer: 0.02 }, OAK);
    for (const sx of [-1, 1]) beam([sx * 0.72, 0.27, z0], [sx * 0.72, 0.27, z1], 0.16, 0.26, { chamfer: 0.03 }, OAK_DK);
    for (const z of [-9.4, -6.8, -4.1, 0.4, 2.6]) {
      strap([-0.82, 0.42, z], [0.82, 0.42, z], 0.08, 0.03);
      for (const sx of [-1, 1]) rivet([sx * 0.72, 0.44, z], [0, 1, 0], 0.045);
    }
  }

  // ---- the stone, and the sling that holds it
  const SR = 0.52;
  const ST = [0, 0.16 + SR + 0.03, -2.2];
  {
    const g = new THREE.SphereGeometry(SR, 36, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / SR; const y = p.getY(i) / SR; const z = p.getZ(i) / SR;
      const k = 1 + (smoothNoise3(x * 3 + 4, y * 3, z * 3) - 0.5) * 0.09 + (smoothNoise3(x * 8, y * 8 + 9, z * 8) - 0.5) * 0.03;
      p.setXYZ(i, x * SR * k, y * SR * k, z * SR * k);
    }
    g.computeVertexNormals();
    paintVerts(g, (x, y, z, nx, ny, nz, out) => {
      const n = smoothNoise3(x * 5 + 1, y * 5, z * 5);
      const base = lin(0x78746a);
      for (let i = 0; i < 3; i++) out[i] = base[i] * (0.72 + n * 0.55);
    });
    weldSeam(g, 37, 25);
    g.translate(ST[0], ST[1], ST[2]);
    stone.push({ geometry: g, keepColor: true });

    // The pouch: a leather cradle lying under the stone and up its back. It has real thickness, and
    // sits on a sphere a little bigger than the stone, so it touches everywhere and floats nowhere.
    const PR = SR * 1.05;
    leather.push({
      geometry: outward(solidSurface({
        nu: 16,
        nv: 18,
        point: (u, v) => {
          const az = (u - 0.5) * 1.5;
          const el = mix(-0.42, 1.34, v);
          const dx = Math.sin(az) * Math.cos(el * 0.78);
          const dy = -Math.cos(az) * Math.cos(el) * 0.95;
          const dz = -Math.sin(el);
          return [ST[0] + dx * PR, Math.max(0.19, ST[1] + dy * PR), ST[2] + dz * PR];
        },
        thick: () => 0.018,
      })),
      color: 0x5a3a20,
    });
    // Two ropes from the pouch's back corners to the arm's tip. One ends on the eye and one in a
    // loop over the prong, and they lie slack in the trough between.
    const tipEye = tbP(TB_LONG - 0.42).map((v, i) => v - TB_ARM_UP[i] * (tbArmSize(TB_LONG)[1] / 2 + 0.13));
    const prongAt = tbP(TB_LONG + 0.62).map((v, i) => v + TB_ARM_UP[i] * 0.14);
    for (const [sx, end] of [[-1, tipEye], [1, prongAt]]) {
      const y = 0.3;
      const pts = [
        [sx * 0.34, ST[1] - 0.04, ST[2] - 0.32],
        [sx * 0.3, 0.46, ST[2] - 0.72],
        [sx * 0.2, y, ST[2] - 1.5],
        [sx * 0.24, y, -5.4],
        [sx * 0.16, y, -7.2],
        [sx * 0.26, y, -8.9],
        [sx * 0.14, y + 0.03, -10.2],
        [sx * 0.08, 0.72, -10.85],
        [end[0] + sx * 0.03, end[1] - 0.16, end[2] + 0.04],
        end,
      ];
      ropes.push({ geometry: tinted(rope(pts, 0.062, { sides: 8, steps: 66, pitch: 0.34, ply: 0.09 }), 0xa78a58), keepColor: true });
    }
    // The loose side's loop over the prong.
    const loop = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      loop.push([prongAt[0] + Math.cos(a) * 0.15, prongAt[1] + Math.sin(a) * 0.12 * TB_COS, prongAt[2] - Math.sin(a) * 0.12 * TB_SIN]);
    }
    ropes.push({ geometry: tinted(rope(loop, 0.05, { sides: 6, steps: 18, pitch: 0.3, round: 0 }), 0xa78a58), keepColor: true });
  }

  // ---- the winch, between the skids, that holds the arm down
  {
    const zw = -7.45; const yw = 2.25;
    for (const sx of [-1, 1]) {
      const X = sx * TB_FRAME_X;
      beam([X, 0.9, zw], [X, yw + 0.75, zw], 0.56, 0.56, { up: [0, 0, 1] });
      beam([X, 1.4, zw + 1.0], [X, yw + 0.3, zw + 0.22], 0.3, 0.3, { up: [1, 0, 0] });
      strap([X - 0.3, yw + 0.3, zw], [X + 0.3, yw + 0.3, zw], 0.6, 0.05);
      for (const s2 of [-1, 1]) rivet([X + sx * 0.3, yw + 0.28, zw + s2 * 0.2], [sx, 0, 0], 0.05);
    }
    // The drum, turned, with a coil of rope on it.
    const drum = wrapLathe([[0, -2.72], [0.2, -2.72], [0.2, -2.2], [0.33, -2.1], [0.33, 2.1], [0.2, 2.2], [0.2, 2.72], [0, 2.72]], { segments: 20 });
    {
      const uv = drum.attributes.uv; const yy = drum.attributes.position;
      for (let i = 0; i < uv.count; i++) uv.setY(i, yy.getY(i) / 3.2);
    }
    drum.rotateZ(-Math.PI / 2).translate(0, yw, zw);
    wood.push({ geometry: tinted(drum, OAK_DK), keepColor: true });
    for (const x of [-1.25, 1.25]) iron.push({ geometry: tinted(rod([x - 0.06, yw, zw], [x + 0.06, yw, zw], 0.36, { sides: 18 }), IRON), keepColor: true });
    ropes.push({ geometry: tinted(coil([-1.05, yw, zw], [-0.15, yw, zw], 0.37, 8, 0.05, { sides: 6, stepsPerTurn: 10, up: [0, 1, 0] }), HEMP), keepColor: true });
    ropes.push({ geometry: tinted(coil([0.15, yw, zw], [1.05, yw, zw], 0.37, 8, 0.05, { sides: 6, stepsPerTurn: 10, up: [0, 1, 0] }), HEMP), keepColor: true });
    // A handspike wheel at each end: bars through a hub, the way a windlass is hauled round.
    for (const sx of [-1, 1]) {
      const X = sx * 2.5;
      iron.push({ geometry: tinted(rod([X - 0.18, yw, zw], [X + 0.18, yw, zw], 0.3, { sides: 16 }), IRON), keepColor: true });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI + 0.3;
        const dy = Math.sin(a) * 1.28; const dz = Math.cos(a) * 1.28;
        timber(wood, OAK, [X, yw - dy, zw - dz], [X, yw + dy, zw + dz], 0.14, 0.14, { ...B, up: [1, 0, 0], chamfer: 0.03 });
      }
    }
    // The ratchet and its pawl, which is what keeps a cocked machine cocked.
    const teeth = [];
    const NT = 14;
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * Math.PI * 2;
      teeth.push([zw + Math.cos(a) * 0.56, yw + Math.sin(a) * 0.56]);
      const a2 = ((i + 0.08) / NT) * Math.PI * 2;
      teeth.push([zw + Math.cos(a2) * 0.44, yw + Math.sin(a2) * 0.44]);
    }
    iron.push({ geometry: prismX(teeth, 1.14, 1.3, IRON, { capShade: 0.95 }), keepColor: true });
    const pawlA = [1.22, yw + 0.2, zw + 1.12]; const pawlB = [1.22, yw + 0.5, zw + 0.3];
    strap(pawlA, pawlB, 0.09, 0.12, {});
    iron.push({ geometry: tinted(rod([1.05, pawlA[1], pawlA[2]], [1.4, pawlA[1], pawlA[2]], 0.05, { sides: 8 }), IRON), keepColor: true });
    beam([1.22, 1.3, zw + 1.12], [1.22, pawlA[1] + 0.05, zw + 1.12], 0.2, 0.2, { up: [0, 0, 1] });

    // The haul itself: two parts of rope up to a sling bound round the arm.
    const sHaul = 13.9;
    const [wH, hH] = tbArmSize(sHaul);
    const cH = tbP(sHaul);
    ropes.push({ geometry: tinted(wrapBeam(tbP(sHaul - 0.22), tbP(sHaul + 0.22), wH, hH, 5, 0.062, { up: TB_ARM_UP, sides: 6 }), HEMP), keepColor: true });
    for (const sx of [-1, 1]) {
      const under = [sx * (wH / 2 - 0.02), cH[1] - TB_ARM_UP[1] * hH * 0.44, cH[2] - TB_ARM_UP[2] * hH * 0.44];
      const pts = [
        [sx * 0.65, yw + 0.3, zw - 0.1],
        [sx * 0.6, yw + 0.4, zw - 0.27],
        lerp3([sx * 0.6, yw + 0.4, zw - 0.27], under, 0.5),
        under,
      ];
      ropes.push({ geometry: tinted(rope(pts, 0.07, { sides: 9, steps: 26, pitch: 0.36, ply: 0.09 }), 0xa78a58), keepColor: true });
    }
  }

  return groupOf(
    meshOf(wood, { ...grainMaps({ seed: 57, strength: 0.7 }), roughness: 0.82, metalness: 0 }),
    meshOf(ropes, { ...ropeMaps({ size: 64, plies: 2, strength: 1.2 }), roughness: 0.95, metalness: 0 }),
    meshOf(iron, { roughness: 0.55, metalness: 0.42 }),
    meshOf(stone, { roughness: 0.92, metalness: 0, flatShading: false }),
    meshOf(leather, { roughness: 0.75, metalness: 0 }),
  );
}

// ---------------------------------------------------------------------------
// The Liberty Bell
// ---------------------------------------------------------------------------
//
// AT TWICE LIFE SIZE, AS ITS CARD SAYS. The real bell is 3ft lip to crown with a 12ft circumference at
// the lip, so this one is 6.3ft lip to crown, 7.64ft across the lip, and about 9ft to the top of the
// yoke with its stand.
//
// THE INSCRIPTION IS PAINTED ONTO ONE CANVAS THAT RUNS ONCE ROUND THE BELL, with the mesh's seam at
// the back and each letter placed by arc length, so it wraps with no join. Light letters on dark
// bronze, and the same canvas is the bump, so they stand up from the surface.
//
// THE CRACK IS BUILT, BECAUSE THERE IS NO CSG TO CUT ONE. A dark strip lies a hair proud of the
// bronze, between two raised lips that follow the same zig-zag, and it runs over the lip and under
// it, so it reads as a real split. `lbCrackAz` is the one description of its path: the strip, both
// lips and the painted hairline above them all read it.
const LB_LIP = 1.05;
const LB_TOP = 6.32;
const LB_CANVAS_W = 2048;
const LB_CANVAS_H = 1024;
const LB_CRACK_TOP = 3.95; // the wide repair; a hairline carries on above it
const lbTri = (x) => { const f = x - Math.floor(x); return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; };
const lbCrackAz = (y) => -0.2 + 0.045 * Math.sin(y * 0.9 + 0.4) + 0.028 * lbTri(y / 0.62);

function lbSmooth(points, count) {
  const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  return curve.getPoints(count).map((p) => [p.x, p.y]);
}

// The outer profile, from the lip up. Beads are written row by row with doubled rows for hard edges.
function lbOuter() {
  const rows = [];
  rows.push(...lbSmooth([[3.82, 0.26], [3.7, 0.52], [3.46, 0.88], [3.18, 1.3], [2.92, 1.84], [2.72, 2.44], [2.56, 3.12], [2.46, 3.8], [2.42, 4.34]], 34));
  const bead = (y, h, out = 0.05, base = 2.41) => {
    rows.push([base, y], [base, y], [base + out * 0.7, y + 0.01], [base + out, y + h * 0.3], [base + out, y + h * 0.7], [base + out * 0.7, y + h - 0.01], [base, y + h], [base, y + h]);
  };
  bead(4.36, 0.1);
  rows.push([2.4, 4.6]);
  bead(4.99, 0.05, 0.03, 2.4);
  rows.push([2.4, 5.2]);
  bead(5.44, 0.1, 0.05, 2.4);
  rows.push(...lbSmooth([[2.39, 5.56], [2.3, 5.76], [2.12, 5.94], [1.8, 6.08], [1.3, 6.16]], 12));
  rows.push([1.26, 6.17], [1.26, 6.17], [1.22, 6.26], [1.22, 6.26], [1.0, 6.3], [0, LB_TOP]);
  return rows;
}

function lbSurfaceRows() {
  const inner = [
    [0, 5.42], [0.7, 5.41], [1.3, 5.3],
    ...lbSmooth([[1.72, 5.05], [1.96, 4.55], [2.08, 3.8], [2.17, 3.0], [2.34, 2.1], [2.6, 1.3], [2.9, 0.68], [3.22, 0.2]], 16),
    [3.35, 0.03],
  ].map(([r, y]) => [r, y, 0.002]);
  const lip = [[3.55, 0.0], [3.73, 0.05], [3.82, 0.16]].map(([r, y], i) => [r, y, 0.002 + i * 0.008]);
  const outer = lbOuter().map(([r, y]) => [r, y, y / LB_TOP]);
  return [...inner, ...lip, ...outer];
}

function lbMaps() {
  const W = LB_CANVAS_W; const H = LB_CANVAS_H;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1753);
  const pxX = (u) => ((u % 1) + 1) % 1 * W;
  const pxY = (y) => H - (y / LB_TOP) * H;
  const azU = (az) => (az + Math.PI) / (Math.PI * 2);
  const wrap = (draw) => { for (const dx of [-W, 0, W]) draw(dx); };

  // The bronze: dark and brown-grey, mottled, streaked where two centuries of handling and weather
  // have run down it. Kept dark but not black, since the map is the whole colour here.
  ctx.fillStyle = '#54483a';
  ctx.fillRect(0, 0, W, H);
  const blotch = (x, y, r, rgb, a) => {
    wrap((dx) => {
      const g = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + dx, y, r, 0, Math.PI * 2); ctx.fill();
    });
  };
  for (let i = 0; i < 300; i++) {
    const pick = rng();
    blotch(rng() * W, rng() * H, 30 + rng() * 120, pick < 0.45 ? '40,33,25' : pick < 0.8 ? '104,90,68' : '70,90,74', 0.1 + rng() * 0.14);
  }
  for (let i = 0; i < 240; i++) {
    const x = rng() * W; const y = rng() * H * 0.9; const len = 60 + rng() * 260; const w = 2 + rng() * 7;
    const dark = rng() < 0.6;
    wrap((dx) => {
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      const rgb = dark ? '32,26,19' : '118,104,82';
      g.addColorStop(0, `rgba(${rgb},0)`);
      g.addColorStop(0.3, `rgba(${rgb},${dark ? 0.2 : 0.13})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + dx, y, w, len);
    });
  }
  for (let i = 0; i < 2600; i++) {
    const x = rng() * W; const y = rng() * H;
    ctx.fillStyle = rng() < 0.5 ? 'rgba(36,30,22,0.16)' : 'rgba(128,114,90,0.12)';
    ctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 2);
  }
  // Inside the bell is dark.
  ctx.fillStyle = '#17120d';
  ctx.fillRect(0, H - 6, W, 6);
  const shade = ctx.createLinearGradient(0, H - 30, 0, H - 6);
  shade.addColorStop(0, 'rgba(23,18,13,0)');
  shade.addColorStop(1, 'rgba(23,18,13,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, H - 30, W, 24);

  // Raised letters, placed one at a time. Anisotropy is corrected per row, since the canvas has fewer
  // texels per foot round the bell than up it.
  const lettersAt = (text, yMid, capFt, radius, { centreWord = null, centreAz = 0, fill = 0.985, u0 = null } = {}) => {
    const pxPerFtV = H / LB_TOP;
    const pxPerFtH = W / (Math.PI * 2 * radius);
    const size = (capFt * pxPerFtV) / 0.72;
    const stretch = pxPerFtH / pxPerFtV;
    ctx.font = `700 ${size}px "Times New Roman", Times, Georgia, serif`;
    const widths = [...text].map((ch) => ctx.measureText(ch).width * stretch);
    const natural = widths.reduce((a, b) => a + b, 0);
    let extra = 0;
    if (u0 === null) extra = (W * fill - natural) / Math.max(1, text.length - 1);
    // Keep a line that is a little too long legible by narrowing the letters instead of colliding them.
    const squeeze = extra < 0 ? (W * fill) / natural : 1;
    if (extra < 0) extra = 0;
    const adv = widths.map((w) => w * squeeze + extra);
    let start = 0;
    if (centreWord !== null) {
      const at = text.indexOf(centreWord);
      let before = 0;
      for (let i = 0; i < at; i++) before += adv[i];
      let word = 0;
      for (let i = at; i < at + centreWord.length; i++) word += adv[i];
      start = azU(centreAz) * W - before - word / 2;
    } else if (u0 !== null) start = u0 * W;
    let x = start;
    const yy = pxY(yMid);
    const drawAll = (dx, dy, style) => {
      ctx.fillStyle = style;
      let cx = start;
      [...text].forEach((ch, i) => {
        const px = cx + widths[i] * squeeze / 2 + dx;
        for (const off of [-W, 0, W]) {
          ctx.save();
          ctx.translate(px + off, yy + dy);
          ctx.scale(stretch * squeeze, 1);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
        }
        cx += adv[i];
      });
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawAll(2.2, 2.6, 'rgba(24,18,12,0.95)');
    drawAll(-1, -1.2, 'rgba(204,190,150,0.9)');
    drawAll(0, 0, '#a59472');
    return x;
  };
  lettersAt('PROCLAIM LIBERTY THROUGHOUT ALL THE LAND UNTO ALL THE INHABITANTS THEREOF LEV. XXV. V X.', 5.23, 0.27, 2.4, { centreWord: 'LIBERTY', centreAz: 0.16 });
  lettersAt('BY ORDER OF THE ASSEMBLY OF THE PROVINCE OF PENSYLVANIA FOR THE STATE HOUSE IN PHILADA', 4.77, 0.27, 2.41, { centreWord: 'ASSEMBLY', centreAz: 0.16 });
  // The founders' mark on the waist, beside the crack: Pass and Stow recast it in 1753.
  const mark = (text, y) => {
    const pxPerFtV = H / LB_TOP;
    const pxPerFtH = W / (Math.PI * 2 * 2.5);
    const stretch = pxPerFtH / pxPerFtV;
    const size = (0.21 * pxPerFtV) / 0.72;
    ctx.font = `700 ${size}px "Times New Roman", Times, Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = azU(0.42) * W;
    for (const [dx, dy, style] of [[1.8, 2.2, 'rgba(24,18,12,0.95)'], [-0.8, -1, 'rgba(204,190,150,0.85)'], [0, 0, '#a08f6d']]) {
      ctx.save();
      ctx.translate(cx + dx, pxY(y) + dy);
      ctx.scale(stretch, 1);
      ctx.fillStyle = style;
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  };
  mark('PASS AND', 3.92);
  mark('STOW', 3.64);
  mark('PHILADA', 3.36);
  mark('MDCCLIII', 3.08);

  // The hairline above the wide crack, in the same zig-zag, on up through the lettering.
  const path = [];
  for (let y = LB_CRACK_TOP - 0.05; y <= 5.74; y += 0.03) path.push([pxX(azU(lbCrackAz(y))), pxY(y)]);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(14,10,6,0.95)';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  return {
    map: texOf(canvas, THREE.SRGBColorSpace),
    bumpMap: texOf(canvas, THREE.NoColorSpace),
    bumpScale: 3.4,
  };
}

function libertyBell() {
  const rng = seededRandom(1776);
  const bronzeRows = lbSurfaceRows();
  const bell = wrapLathe(bronzeRows, { segments: 132, start: Math.PI });
  bell.translate(0, LB_LIP, 0);
  const bellMesh = new THREE.Mesh(bell, new THREE.MeshStandardMaterial({ ...lbMaps(), roughness: 0.58, metalness: 0.32 }));
  bellMesh.castShadow = true;
  bellMesh.receiveShadow = true;

  // ---- the crack, on the surface of the bell
  const fittings = [];
  const BRONZE_LIP = 0x615241;
  const DARK = 0x0d0a07;
  const outerRows = [[3.35, 0.03], [3.55, 0.0], [3.73, 0.05], [3.82, 0.16], ...lbOuter().filter(([, y]) => y <= LB_CRACK_TOP + 0.2)];
  const rAtY = (y) => {
    for (let i = 3; i < outerRows.length - 1; i++) {
      const [r0, y0] = outerRows[i]; const [r1, y1] = outerRows[i + 1];
      if (y >= y0 && y <= y1 && y1 > y0) return mix(r0, r1, (y - y0) / (y1 - y0));
    }
    return outerRows[outerRows.length - 1][0];
  };
  const stations = [[3.35, 0.03], [3.45, 0.012], [3.55, 0.0], [3.65, 0.016], [3.73, 0.05], [3.79, 0.1], [3.82, 0.16]];
  for (let y = 0.26; y <= LB_CRACK_TOP; y += 0.075) stations.push([rAtY(y), y]);
  const N = stations.length;
  const widthAt = (y) => mix(0.17, 0.07, clamp01(y / LB_CRACK_TOP));
  const framed = stations.map(([r, y], i) => {
    const [r0, y0] = stations[Math.max(0, i - 1)]; const [r1, y1] = stations[Math.min(N - 1, i + 1)];
    const tr = r1 - r0; const ty = y1 - y0; const l = Math.hypot(tr, ty) || 1;
    return { r, y, nr: ty / l, ny: -tr / l };
  });
  const at = (f, side, lift) => {
    const r = f.r + f.nr * lift;
    const y = f.y + f.ny * lift + LB_LIP;
    const az = lbCrackAz(f.y) + (side * widthAt(f.y)) / (2 * f.r);
    return [Math.sin(az) * r, y, Math.cos(az) * r];
  };
  fittings.push({
    geometry: outward(solidSurface({
      nu: 2,
      nv: N - 1,
      point: (u, v) => at(framed[Math.round(v * (N - 1))], (u - 0.5) * 2, 0.012),
      thick: () => 0.006,
    })),
    color: DARK,
  });
  for (const side of [-1, 1]) {
    const pts = framed.map((f) => at(f, side * 1.08, 0.004));
    const lipGeo = rope(pts, 0.032, { sides: 6, steps: (N - 1) * 2, pitch: 1, round: 1 });
    fittings.push({ geometry: lipGeo, color: BRONZE_LIP });
  }
  // The two iron pins set across the crack when it was widened in the 1840s. A little darker than
  // the bell, sitting in the slot.
  for (const yp of [1.55, 2.75]) {
    const f = framed.find((q) => q.y >= yp) ?? framed[N - 1];
    const p = at(f, 0, 0.02);
    fittings.push({ geometry: stud(p, [f.nr * Math.sin(lbCrackAz(f.y)), f.ny, f.nr * Math.cos(lbCrackAz(f.y))], 0.075, 0.04, 10), color: 0x3a3430 });
  }

  // ---- the clapper, hanging inside, where somebody crouching can see it
  const iron = [];
  const IRON = 0x3f3c38;
  iron.push({ geometry: tinted(wrapLathe([[0, 2.02], [0.2, 2.06], [0.4, 2.36], [0.42, 2.62], [0.28, 2.86], [0.12, 3.1], [0.08, 4.6], [0.2, 6.5], [0, 6.56]], { segments: 18 }), IRON), keepColor: true });

  // ---- the yoke: American elm, heavy at the middle and stepped down to the trunnions
  const wood = [];
  const ELM = 0x6d4c2e; const ELM_DK = 0x4e3520; const ELM_LT = 0x7c5a36;
  const B = { chamfer: 0.06, rng, tile: [1.6, 3.6] };
  const YK = LB_LIP + LB_TOP - 0.06; // the yoke's underside, seated on the crown
  const yokeOutline = [
    [-5.2, YK + 0.42], [-4.7, YK + 0.3], [-4.1, YK + 0.16], [-3.1, YK + 0.02], [-1.42, YK], [1.42, YK], [3.1, YK + 0.02], [4.1, YK + 0.16], [4.7, YK + 0.3], [5.2, YK + 0.42],
    [5.2, YK + 1.02], [4.7, YK + 1.08], [4.1, YK + 1.14], [3.1, YK + 1.3], [1.9, YK + 1.56], [1.2, YK + 1.66], [-1.2, YK + 1.66], [-1.9, YK + 1.56], [-3.1, YK + 1.3], [-4.1, YK + 1.14], [-4.7, YK + 1.08], [-5.2, YK + 1.02],
  ];
  wood.push({
    geometry: prismX(yokeOutline.map(([x, y]) => [x, y]), -0.66, 0.66, ELM_LT, { tile: [1.6, 3.6], capShade: 0.7 }).rotateY(Math.PI / 2),
    keepColor: true,
  });
  // A chamfer strip along the top, so its long edge is worked and not a sawn box.
  const yokeTop = (x) => {
    const pts = yokeOutline.slice(10, 22);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
      if ((x <= x0 && x >= x1)) return mix(y0, y1, (x - x0) / (x1 - x0));
    }
    return YK + 1.1;
  };
  const yokeBot = (x) => {
    const pts = yokeOutline.slice(0, 10);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]; const [x1, y1] = pts[i + 1];
      if (x >= x0 && x <= x1) return mix(y0, y1, (x - x0) / (x1 - x0));
    }
    return YK;
  };
  // Iron straps round the yoke, and the long hanging straps with their bolts down to the crown.
  const band = (x, w = 0.22) => {
    const y0 = yokeBot(x) - 0.03; const y1 = yokeTop(x) + 0.03;
    for (const sz of [-1, 1]) iron.push({ geometry: tinted(new THREE.BoxGeometry(w, y1 - y0, 0.05).translate(x, (y0 + y1) / 2, sz * 0.68), IRON), keepColor: true });
    iron.push({ geometry: tinted(new THREE.BoxGeometry(w, 0.05, 1.41).translate(x, y1, 0), IRON), keepColor: true });
    iron.push({ geometry: tinted(new THREE.BoxGeometry(w, 0.05, 1.41).translate(x, y0, 0), IRON), keepColor: true });
    for (const sz of [-1, 1]) for (const yy of [y0 + 0.16, y1 - 0.16]) {
      iron.push({ geometry: tinted(stud([x, yy, sz * 0.71], [0, 0, sz], 0.05, 0.03, 7), 0x57524c), keepColor: true });
    }
  };
  for (const x of [-4.55, -3.3, 3.3, 4.55]) band(x);
  // The crown's iron: four straps from over the top of the yoke, down its faces, bolted to the head.
  for (const x of [-0.82, 0.82]) {
    const y1 = yokeTop(x) + 0.04; const y0 = LB_LIP + 5.92;
    for (const sz of [-1, 1]) {
      iron.push({ geometry: tinted(new THREE.BoxGeometry(0.34, y1 - y0, 0.07).translate(x, (y0 + y1) / 2, sz * 0.71), IRON), keepColor: true });
      for (const y of [y0 + 0.25, y0 + 0.75, y1 - 0.5, y1 - 0.16]) iron.push({ geometry: tinted(stud([x, y, sz * 0.75], [0, 0, sz], 0.07, 0.045, 8), 0x57524c), keepColor: true });
    }
    iron.push({ geometry: tinted(new THREE.BoxGeometry(0.34, 0.07, 1.49).translate(x, y1, 0), IRON), keepColor: true });
    // Feet of the straps, sunk into the shoulder of the bell.
    for (const sz of [-1, 1]) {
      const r = 1.7;
      iron.push({ geometry: tinted(new THREE.BoxGeometry(0.34, 0.1, r - 0.7).translate(x, LB_LIP + 6.02, sz * (0.71 + (r - 0.7) / 2 - 0.05)), IRON), keepColor: true });
      iron.push({ geometry: tinted(stud([x, LB_LIP + 6.09, sz * 1.26], [0, 1, 0], 0.09, 0.06, 8), 0x57524c), keepColor: true });
    }
  }

  // ---- the stand: a heavy timber trestle at each end
  const POST_X = 4.72;
  const TRUN_Y = YK + 0.72;
  for (const sx of [-1, 1]) {
    const X = sx * POST_X;
    timber(wood, ELM_DK, [X, 0.3, -3.2], [X, 0.3, 3.2], 0.82, 0.6, B);
    timber(wood, ELM, [X, 0.55, 0], [X, TRUN_Y - 0.6, 0], 0.86, 0.82, { ...B, up: [0, 0, 1] });
    // The bearing block on the post, with a trunnion in an iron strap.
    timber(wood, ELM_DK, [X, TRUN_Y - 0.72, -0.62], [X, TRUN_Y - 0.72, 0.62], 0.98, 0.3, B);
    for (const sz of [-1, 1]) {
      // Raking struts, the trestle's legs.
      timber(wood, ELM, [X, 0.56, sz * 2.76], [X, 4.6, sz * 0.32], 0.6, 0.56, { ...B, up: [1, 0, 0] });
      wood.push({ geometry: tinted(stud([X + sx * 0.31, 4.3, sz * 0.5], [sx, 0, 0], 0.08, 0.04, 7), ELM_DK), keepColor: true });
      wood.push({ geometry: tinted(stud([X + sx * 0.31, 0.92, sz * 2.48], [sx, 0, 0], 0.08, 0.04, 7), ELM_DK), keepColor: true });
    }
    iron.push({ geometry: tinted(rod([X - sx * 0.1, TRUN_Y, 0], [X + sx * 0.72, TRUN_Y, 0], 0.17, { sides: 14 }), IRON), keepColor: true });
    iron.push({ geometry: tinted(stud([X + sx * 0.72, TRUN_Y, 0], [sx, 0, 0], 0.2, 0.05, 12), 0x57524c), keepColor: true });
  }
  // Rails tying the two trestles together, low enough to clear the lip.
  for (const sz of [-1, 1]) {
    timber(wood, ELM_DK, [-POST_X - 0.1, 0.3, sz * 1.9], [POST_X + 0.1, 0.3, sz * 1.9], 0.6, 0.5, B);
    for (const sx of [-1, 1]) wood.push({ geometry: tinted(stud([sx * POST_X, 0.6, sz * 1.9], [0, 1, 0], 0.08, 0.04, 7), ELM), keepColor: true });
  }

  return groupOf(
    bellMesh,
    meshOf(fittings, { roughness: 0.6, metalness: 0.28 }),
    meshOf(wood, { ...grainMaps({ seed: 44, strength: 0.65 }), roughness: 0.78, metalness: 0 }),
    meshOf(iron, { roughness: 0.58, metalness: 0.42 }),
  );
}

// ---------------------------------------------------------------------------
// Plate and lacing: a loft whose section is an ellipse with its own front and back
// ---------------------------------------------------------------------------

const sp = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// One section of a body: {c:[x,y,z], rx, rf, rb, p, ridge, ridgeW, ridgeB}. rx is the half-width, rf
// the reach toward `ref`, and rb the reach away from it. p above 2 squares the section off.
const sec = (c, rx, rf, rb = rf, extra = {}) => ({ c, rx, rf, rb, ...extra });

function secPoint(st, th) {
  const e = 2 / (st.p ?? 2);
  const X = st.rx * sp(Math.cos(th), e);
  const s = Math.sin(th);
  let F = (s >= 0 ? st.rf : st.rb) * sp(s, e);
  const w = st.rx * (st.ridgeW ?? 0.14);
  const q = X / w;
  if (s >= 0 && st.ridge) F += st.ridge * Math.exp(-q * q);
  if (s < 0 && st.ridgeB) F -= st.ridgeB * Math.exp(-q * q);
  return [X, F];
}

// Splines every number in a list of sections, so a body is written as a handful of stations.
function dense(list, n) {
  const pick = (fn) => list.map(fn);
  const cx = pick((s) => s.c[0]); const cy = pick((s) => s.c[1]); const cz = pick((s) => s.c[2]);
  const rx = pick((s) => s.rx); const rf = pick((s) => s.rf); const rb = pick((s) => s.rb);
  const p = pick((s) => s.p ?? 2); const ridge = pick((s) => s.ridge ?? 0); const rw = pick((s) => s.ridgeW ?? 0.14); const rB = pick((s) => s.ridgeB ?? 0);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      c: [splineAt(cx, t), splineAt(cy, t), splineAt(cz, t)],
      rx: Math.max(0.002, splineAt(rx, t)),
      rf: Math.max(0.002, splineAt(rf, t)),
      rb: Math.max(0.002, splineAt(rb, t)),
      p: splineAt(p, t),
      ridge: Math.max(0, splineAt(ridge, t)),
      ridgeW: splineAt(rw, t),
      ridgeB: Math.max(0, splineAt(rB, t)),
    });
  }
  return out;
}

// A closed solid through a list of sections. Repeating a section gives a hard edge, since the
// zero-area band contributes no normal. `ref` is the direction `rf` reaches toward.
function loft(rows, { sides = 32, ref = [0, 0, 1] } = {}) {
  const pos = []; const idx = [];
  const R = vec(ref).normalize();
  const n = rows.length;
  const cs = rows.map((r) => vec(r.c));
  const a0 = new THREE.Vector3(); const a1 = new THREE.Vector3();
  let lastT = null;
  for (let i = 0; i < n; i++) {
    a0.copy(cs[Math.max(0, i - 1)]); a1.copy(cs[Math.min(n - 1, i + 1)]);
    let t = a1.sub(a0);
    if (t.lengthSq() < 1e-10) t = lastT ? lastT.clone() : new THREE.Vector3(0, -1, 0);
    t = rows[i].n ? vec(rows[i].n) : t.clone();
    t.normalize();
    lastT = t.clone();
    let side = new THREE.Vector3().crossVectors(R, t);
    if (side.lengthSq() < 1e-8) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const up = new THREE.Vector3().crossVectors(t, side).normalize();
    for (let j = 0; j < sides; j++) {
      const [X, F] = secPoint(rows[i], (j / sides) * Math.PI * 2);
      pos.push(cs[i].x + side.x * X + up.x * F, cs[i].y + side.y * X + up.y * F, cs[i].z + side.z * X + up.z * F);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      idx.push(i * sides + j, i * sides + j2, (i + 1) * sides + j2, i * sides + j, (i + 1) * sides + j2, (i + 1) * sides + j);
    }
  }
  const p0 = pos.length / 3; pos.push(cs[0].x, cs[0].y, cs[0].z);
  const p1 = pos.length / 3; pos.push(cs[n - 1].x, cs[n - 1].y, cs[n - 1].z);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    idx.push(p0, j2, j);
    idx.push(p1, (n - 1) * sides + j, (n - 1) * sides + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return outward(g);
}

const scaleSec = (s, k, extra = {}) => ({ ...s, rx: s.rx * k, rf: s.rf * k, rb: s.rb * k, ...extra });
const growSec = (s, d, c = s.c) => ({ ...s, c, rx: s.rx + d, rf: s.rf + d, rb: s.rb + d });

// A lame: one ring of an articulated plate. Its top sinks inside the plate above, and its bottom edge
// is ROLLED, which is the line that makes plate armour read. It goes from section a to section b,
// and the next lame starts inside this one, so there is no way for daylight to show between them.
function lame(a, b, { bead = 0.016, sides = 32, ref = [0, 0, 1], lite = false } = {}) {
  const A = vec(a.c); const B = vec(b.c);
  const dir = B.clone().sub(A).normalize();
  const past = (d) => [b.c[0] + dir.x * d, b.c[1] + dir.y * d, b.c[2] + dir.z * d];
  if (lite) return loft([a, b, growSec(b, bead, past(bead * 0.8)), growSec(b, bead * 0.3, past(bead * 1.7)), scaleSec(b, 0.82, { c: past(bead * 1.7) })], { sides, ref });
  const rows = [
    scaleSec(a, 0.97),
    a,
    b,
    b,
    growSec(b, bead, past(bead * 0.8)),
    growSec(b, bead * 0.3, past(bead * 1.7)),
    growSec(b, bead * 0.3, past(bead * 1.7)),
    scaleSec(b, 0.82, { c: past(bead * 1.7) }),
  ];
  return loft(rows, { sides, ref });
}

// Where a body's surface is, for anything lying on it: a host built from the same dense rows as the
// loft. pt(theta, y, lift) is the point at that bearing and height, carried out along the section's
// normal direction by lift.
function hostOf(rows) {
  const at = (y) => {
    let i = 0;
    const down = rows[0].c[1] > rows[rows.length - 1].c[1];
    while (i < rows.length - 2 && (down ? rows[i + 1].c[1] > y : rows[i + 1].c[1] < y)) i++;
    const a = rows[i]; const b = rows[i + 1];
    const t = clamp01((y - a.c[1]) / ((b.c[1] - a.c[1]) || 1));
    return {
      c: lerp3(a.c, b.c, t), rx: mix(a.rx, b.rx, t), rf: mix(a.rf, b.rf, t), rb: mix(a.rb, b.rb, t), p: mix(a.p ?? 2, b.p ?? 2, t),
      ridge: mix(a.ridge ?? 0, b.ridge ?? 0, t), ridgeW: mix(a.ridgeW ?? 0.14, b.ridgeW ?? 0.14, t), ridgeB: mix(a.ridgeB ?? 0, b.ridgeB ?? 0, t),
    };
  };
  const pt = (th, y, lift = 0) => {
    const s = at(y);
    const [X, F] = secPoint(s, th);
    const e = 0.01;
    const [X2, F2] = secPoint(s, th + e);
    let nx = F2 - F; let nf = -(X2 - X);
    const len = Math.hypot(nx, nf) || 1;
    nx /= len; nf /= len;
    if (nx * X + nf * F < 0) { nx = -nx; nf = -nf; }
    return [s.c[0] + X + nx * lift, y, s.c[2] + F + nf * lift];
  };
  const normal = (th, y) => {
    const p0 = pt(th, y, 0); const p1 = pt(th, y, 0.1);
    return [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  };
  return { at, pt, normal };
}

// A plate lying on a host: rows from yLow to yHigh(theta), its top edge rolled and then diving into
// the host, so it has no rim to leave a gap at. Runs from theta0 to theta1, where the top comes down
// to meet the bottom. For a plackart, a face opening, a pattern of bands.
function hostPatch(host, th0, th1, yLow, yHigh, lift, { nu = 28, roll = 0.012, rows = null, reverse = false } = {}) {
  const profile = rows ?? [[0, 1], [0.4, 1], [0.8, 1], [0.92, 1], [0.955, 1.5], [0.985, 1.25], [1, -1.5]];
  const pos = []; const idx = [];
  const NV = profile.length;
  for (let i = 0; i <= nu; i++) {
    const th = mix(th0, th1, i / nu);
    const top = yHigh(th);
    for (const [v, k] of profile) {
      const y = mix(yLow(th), top, v);
      const liftHere = k > 1 ? lift + (k - 1) * roll * 2 : k * lift;
      const p = host.pt(th, y, liftHere);
      pos.push(p[0], p[1], p[2]);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < NV - 1; j++) {
      const a = i * NV + j; const b = (i + 1) * NV + j; const c = (i + 1) * NV + j + 1; const d = i * NV + j + 1;
      if (reverse) idx.push(a, c, b, a, d, c);
      else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // This one is an open sheet and cannot be measured by volume, so ask one face which way it points.
  const mid = Math.floor(nu / 2) * NV + 1;
  const fa = idx.findIndex((v, k) => k % 6 === 0 && v === mid);
  const v0 = vec([pos[idx[fa] * 3], pos[idx[fa] * 3 + 1], pos[idx[fa] * 3 + 2]]);
  const v1 = vec([pos[idx[fa + 1] * 3], pos[idx[fa + 1] * 3 + 1], pos[idx[fa + 1] * 3 + 2]]);
  const v2 = vec([pos[idx[fa + 2] * 3], pos[idx[fa + 2] * 3 + 1], pos[idx[fa + 2] * 3 + 2]]);
  const fn = v1.clone().sub(v0).cross(v2.clone().sub(v0));
  const thM = mix(th0, th1, 0.5);
  const out = vec(host.normal(thM, mix(yLow(thM), yHigh(thM), 0.4)));
  if (fn.dot(out) < 0) {
    const arr = [];
    for (let k = 0; k < idx.length; k += 3) arr.push(idx[k], idx[k + 2], idx[k + 1]);
    g.setIndex(arr);
  }
  g.computeVertexNormals();
  return g;
}

// A fluted fan: the wing on a couter or poleyn. A closed solid with a real rim, lying on a shallow
// dome, its flutes one term in the surface.
function fanWing(center, normal, upHint, R, { flutes = 5, depth = 0.012, dome = 0.05, thick = 0.012, phase = 0 } = {}) {
  const n = vec(normal).normalize();
  const side = new THREE.Vector3().crossVectors(vec(upHint), n).normalize();
  const up = new THREE.Vector3().crossVectors(n, side).normalize();
  const C = vec(center);
  return outward(solidSurface({
    nu: 30,
    nv: 2,
    closedU: true,
    point: (u, v) => {
      const th = u * Math.PI * 2;
      const scal = 0.92 + 0.11 * Math.cos(2 * th + phase) + 0.04 * Math.cos(flutes * 2 * th) * v;
      const rho = R * v * scal;
      const h = dome * (1 - v * v) + depth * Math.cos(flutes * th) * v * (1 - v) * 3;
      const w = C.clone().addScaledVector(side, Math.cos(th) * rho).addScaledVector(up, Math.sin(th) * rho).addScaledVector(n, h);
      return [w.x, w.y, w.z];
    },
    thick: (u, v) => (v > 0.999 ? thick * 1.6 : thick),
  }));
}

// A polished-steel look without an environment map: the colour itself carries the reflection, bright
// where a surface faces the sky, a dark band at the horizon, warmer below. A metal with no environment
// to reflect renders black above about 0.55, so this is what makes steel read as steel.
function polishSteel(geometry, base = 0x9aa2ab) {
  const c = lin(base);
  return paintVerts(geometry, (x, y, z, nx, ny, nz, out) => {
    const up = ny >= 0 ? Math.pow(ny, 0.8) : 0;
    let k = 0.6 + 0.42 * up;
    // A dark horizon just below level, and warmer ground under that.
    k -= 0.2 * Math.exp(-((ny + 0.32) * (ny + 0.32)) / 0.02);
    if (ny < -0.32) k -= 0.1 * sstep(-ny, 0.32, 0.9);
    // Round a vertical form it is the surroundings that streak: one bright window and one dark wall,
    // which is what makes a polished cylinder read as polished.
    const weight = 1 - Math.abs(ny);
    k += weight * 0.26 * Math.exp(-((nx - 0.42) ** 2) / 0.022);
    k -= weight * 0.2 * Math.exp(-((nx + 0.62) ** 2) / 0.04);
    k += weight * 0.1 * Math.exp(-((nx + 0.12) ** 2) / 0.012);
    const warm = ny < -0.32 ? 0.05 : 0;
    out[0] = c[0] * k * (1 + warm);
    out[1] = c[1] * k;
    out[2] = c[2] * k * (1 - warm);
  });
}

// ---------------------------------------------------------------------------
// The suit of armor: a full harness of about 1450-1480
// ---------------------------------------------------------------------------
//
// NOTHING IS INSIDE IT. Every opening is a dark panel with a rolled rim round it, and the visor stands
// open on the same dark. It is modelled on Italian and Gothic harness of the period rather than on
// any one suit, so it is a type and not a specimen. Latten edging and rivets are a real practice.
//
// LAMES CANNOT SHOW DAYLIGHT BY CONSTRUCTION: each one's top starts inside the bottom of the one above
// it, and the bottoms are closed. Only the right side is built; the left is its mirror image.

function knightArmor() {
  const steel = []; const accent = []; const dark = []; const wood = [];
  let sided = false; // while true, every part is also mirrored across x = 0
  const BRASS = 0xb48a3c; const LEATHER = 0x5a2d18; const RED = 0xa01820; const DARK = 0x0b0a09; const POST = 0x2c2a28;
  const S = (g) => steel.push({ geometry: g, color: 0xffffff, sided });
  const A = (g, color = BRASS) => accent.push({ geometry: g, color, sided });
  const D = (g) => dark.push({ geometry: g, color: DARK, sided });
  const SOLE = 0.4;

  // ---- the torso, as one description used by every plate that lies on it
  const torsoStations = [
    sec([0, 5.03, 0.0], 0.27, 0.25, 0.27),
    sec([0, 4.93, 0.0], 0.47, 0.33, 0.34),
    sec([0, 4.76, 0.01], 0.61, 0.43, 0.39, { ridge: 0.012 }),
    sec([0, 4.52, 0.02], 0.64, 0.5, 0.42, { ridge: 0.028, ridgeB: 0.018 }),
    sec([0, 4.26, 0.03], 0.6, 0.49, 0.38, { ridge: 0.034, ridgeB: 0.02 }),
    sec([0, 4.0, 0.03], 0.52, 0.43, 0.34, { ridge: 0.03, ridgeB: 0.02 }),
    sec([0, 3.82, 0.03], 0.47, 0.38, 0.32, { ridge: 0.02 }),
    sec([0, 3.7, 0.03], 0.48, 0.39, 0.33),
  ];
  const torsoRows = dense(torsoStations, 20);
  S(loft(torsoRows, { sides: 44 }));
  const torso = hostOf(torsoRows);

  // The plackart: a second plate over the belly, rising to a point under the breast, with a rolled top
  // edge, its rivets in brass. The classic silhouette of the period's breastplate.
  const thF = Math.PI / 2;
  const plackTop = (th) => {
    const a = Math.abs(th - thF) / 1.28;
    return 3.74 + 0.86 * Math.pow(clamp01(1 - a), 1.25);
  };
  S(hostPatch(torso, thF - 1.28, thF + 1.28, () => 3.72, plackTop, 0.016, { nu: 44 }));
  for (let i = 1; i < 12; i++) {
    const th = thF - 1.2 + (i / 12) * 2.4;
    const y = plackTop(th) - 0.05;
    if (y < 3.82) continue;
    const p = torso.pt(th, y, 0.016);
    A(stud(p, torso.normal(th, y), 0.016, 0.01, 6));
  }
  // A cusped band at the plackart's point: the small flourish of this kind of breastplate.
  {
    const y = plackTop(thF) + 0.02;
    A(stud(torso.pt(thF, y, 0.03), torso.normal(thF, y), 0.04, 0.018, 10));
  }
  // The side hinges and straps between breast and back: a real suit has a seam here.
  for (const th of [0.08, Math.PI - 0.08]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const y = mix(3.82, 4.82, i / 10); pts.push(torso.pt(th, y, 0.002)); }
    D(rope(pts, 0.009, { sides: 5, steps: 14, pitch: 1, round: 1 }));
    for (const y of [4.1, 4.42]) {
      const q = torso.pt(th, y, 0.01);
      A(rod([q[0], y - 0.05, q[2]], [q[0], y + 0.05, q[2]], 0.02, { sides: 8 }));
      A(stud(q, torso.normal(th, y), 0.04, 0.012, 8), LEATHER);
    }
  }
  // Rivet lines on the neck opening of the breast and the armholes.
  for (let i = 0; i < 14; i++) {
    const th = thF - 1.0 + (i / 13) * 2.0;
    const y = 4.86 - 0.14 * Math.pow(Math.abs(th - thF) / 1.0, 2);
    const p = torso.pt(th, y, 0.002);
    S(stud(p, torso.normal(th, y), 0.012, 0.008, 6));
  }

  // The culet side of the backplate: a plate over the small of the back, the plackart's counterpart,
  // and the rivet line down the spine.
  const backTop = (th) => {
    const a = Math.abs(th + thF) / 1.2;
    return 3.74 + 0.5 * Math.pow(clamp01(1 - a * a), 0.7);
  };
  S(hostPatch(torso, -thF - 1.2, -thF + 1.2, () => 3.72, backTop, 0.014, { nu: 34 }));
  for (let i = 0; i < 6; i++) {
    const y = 4.3 + i * 0.1;
    A(stud(torso.pt(-thF, y, 0.002), torso.normal(-thF, y), 0.014, 0.009, 5));
  }
  // ---- a waist belt, in leather and brass, where a real suit has its waist strap
  {
    const a = growSec(torso.at(3.9), 0.036, [0, 3.92, 0.03]);
    const b = growSec(torso.at(3.82), 0.036, [0, 3.82, 0.03]);
    A(loft([scaleSec(a, 0.98), a, a, b, b, scaleSec(b, 0.98)], { sides: 40 }), LEATHER);
    const front = [0, 3.87, 0.03 + a.rf + 0.05];
    A(new THREE.BoxGeometry(0.09, 0.105, 0.025).translate(front[0], front[1], front[2] - 0.026));
    A(rod([-0.035, 3.87, front[2] - 0.012], [0.035, 3.87, front[2] - 0.012], 0.01, { sides: 6 }), 0x8c6a2a);
  }

  // ---- the fauld: five lames falling from the waist, flaring over the hips
  const FY = [3.72, 3.57, 3.42, 3.27, 3.12, 2.97];
  const fauldSec = (i, sink = 0) => {
    const t = i / 5;
    return sec([0, FY[i] + sink, 0.03 - t * 0.02], mix(0.5, 0.66, t), mix(0.41, 0.47, t), mix(0.35, 0.47, t), { ridge: 0.014 * (1 - t) + 0.008, ridgeB: 0.012 });
  };
  for (let i = 0; i < 5; i++) {
    S(lame(fauldSec(i, 0.04), fauldSec(i + 1), { sides: 30, bead: 0.016 }));
    for (const th of [thF, 0.3, Math.PI - 0.3, -thF]) {
      const s = fauldSec(i + 1, 0.06);
      const [X, F] = secPoint(s, th);
      const nv = [Math.cos(th), 0, Math.sin(th)];
      A(stud([s.c[0] + X * 1.0, s.c[1], s.c[2] + F], nv, 0.019, 0.012, 5));
    }
  }
  D(new THREE.SphereGeometry(1, 20, 14).scale(0.62, 0.42, 0.44).translate(0, 3.05, 0.02));

  // ---- the leg, built once
  sided = true;
  const LX = (y, a, b, ya, yb) => mix(a, b, clamp01((y - ya) / (yb - ya)));
  const legC = (y) => [LX(y, 0.31, 0.35, 3.2, 1.98) + (y < 1.98 ? (1.98 - y) * 0.025 : 0), y, y > 1.98 ? mix(0.07, 0.0, (y - 1.98) / 1.2) : mix(0.07, -0.02, (1.98 - y) / 1.18)];
  // Cuisse
  const cuisseRows = dense([
    sec(legC(3.18), 0.28, 0.3, 0.3),
    sec(legC(2.92), 0.26, 0.285, 0.285, { ridge: 0.016, ridgeW: 0.2 }),
    sec(legC(2.62), 0.23, 0.25, 0.25, { ridge: 0.024, ridgeW: 0.18 }),
    sec(legC(2.38), 0.2, 0.215, 0.215, { ridge: 0.02, ridgeW: 0.18 }),
    sec(legC(2.2), 0.185, 0.195, 0.19, { ridge: 0.012, ridgeW: 0.18 }),
  ], 10);
  S(loft(cuisseRows, { sides: 26 }));
  const cuisse = hostOf(cuisseRows);
  // Hinge and rivets down the outer side of the cuisse.
  for (const y of [2.42, 2.72, 3.02]) {
    const q = cuisse.pt(0.08, y, 0.01);
    A(rod([q[0], y - 0.05, q[2]], [q[0], y + 0.05, q[2]], 0.02, { sides: 8 }));
    A(stud(cuisse.pt(0.26, y + 0.05, 0.002), cuisse.normal(0.26, y), 0.015, 0.01, 6));
    A(stud(cuisse.pt(0.26, y - 0.05, 0.002), cuisse.normal(0.26, y), 0.015, 0.01, 6));
  }
  // Two leather straps behind the thigh, with brass buckles on the outer side.
  for (const y of [2.5, 2.92]) {
    A(hostPatch(cuisse, -thF - 1.45, -thF + 1.45, () => y - 0.035, () => y + 0.035, 0.008, { nu: 14, rows: [[0, 1], [1, 1]] }), LEATHER);
    const b = cuisse.pt(-0.22, y, 0.012);
    A(new THREE.BoxGeometry(0.02, 0.07, 0.05).translate(b[0] + 0.008, b[1], b[2]));
  }

  // Two lames down to the knee, then the poleyn's cup with its fluted wing, then one lame below.
  const legRing = (y, rx, rf, rb = rf, extra = {}) => sec(legC(y), rx, rf, rb, extra);
  S(lame(legRing(2.28, 0.18, 0.19), legRing(2.18, 0.195, 0.21, 0.2, { ridge: 0.012 }), { sides: 22, bead: 0.012 }));
  S(lame(legRing(2.2, 0.185, 0.2, 0.19), legRing(2.09, 0.2, 0.225, 0.195, { ridge: 0.014 }), { sides: 22, bead: 0.012 }));
  const cup = dense([
    legRing(2.12, 0.185, 0.21, 0.17),
    legRing(2.05, 0.205, 0.26, 0.175, { ridge: 0.02, ridgeW: 0.22 }),
    legRing(1.97, 0.215, 0.29, 0.175, { ridge: 0.03, ridgeW: 0.2 }),
    legRing(1.89, 0.205, 0.26, 0.17, { ridge: 0.02, ridgeW: 0.22 }),
    legRing(1.83, 0.18, 0.205, 0.165),
  ], 8);
  S(loft(cup, { sides: 28 }));
  S(lame(legRing(1.86, 0.165, 0.185, 0.16), legRing(1.75, 0.165, 0.185, 0.17, { ridge: 0.01 }), { sides: 22, bead: 0.012 }));
  // The side wing, which covers the back of the knee as it bends.
  const kneeC = legC(1.97);
  S(fanWing([kneeC[0] + 0.19, kneeC[1], kneeC[2] - 0.05], [1, 0, -0.3], [0, 1, 0], 0.2, { flutes: 5 }));
  A(stud([kneeC[0] + 0.245, kneeC[1], kneeC[2] - 0.065], [1, 0, -0.3], 0.03, 0.018, 8));

  // Greave: shin ridge, the swell of the calf, and a flare to take the sabaton.
  const greaveRows = dense([
    sec(legC(1.8), 0.15, 0.165, 0.175, { ridge: 0.008 }),
    sec(legC(1.58), 0.16, 0.16, 0.21, { ridge: 0.016, ridgeW: 0.2 }),
    sec(legC(1.34), 0.145, 0.145, 0.195, { ridge: 0.016, ridgeW: 0.2 }),
    sec(legC(1.1), 0.12, 0.122, 0.14, { ridge: 0.012, ridgeW: 0.2 }),
    sec(legC(0.94), 0.112, 0.118, 0.122, { ridge: 0.008, ridgeW: 0.2 }),
    sec(legC(0.84), 0.13, 0.136, 0.135),
  ], 12);
  S(loft(greaveRows, { sides: 26 }));
  const greave = hostOf(greaveRows);
  {
    const s = greave.at(0.86);
    const edge = growSec(s, 0.012, legC(0.84));
    S(loft([scaleSec(edge, 0.9, { c: legC(0.88) }), growSec(s, 0.012, legC(0.87)), edge, edge, scaleSec(edge, 0.8, { c: legC(0.83) })], { sides: 32 }));
  }
  // The greave's hinge line and buckles.
  {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const y = mix(0.9, 1.74, i / 10); pts.push(greave.pt(0.05, y, 0.002)); }
    D(rope(pts, 0.008, { sides: 5, steps: 14, pitch: 1, round: 1 }));
    for (const y of [1.2, 1.56]) {
      const q = greave.pt(0.05, y, 0.008);
      A(rod([q[0], y - 0.05, q[2]], [q[0], y + 0.05, q[2]], 0.018, { sides: 8 }));
    }
    const qs = greave.pt(Math.PI - 0.1, 1.42, 0.008);
    A(new THREE.BoxGeometry(0.02, 0.06, 0.1).translate(qs[0], 1.42, qs[2]), LEATHER);
  }

  // Sabaton: overlapping lames from the instep to a pointed toe, a heel cup, and a dark sole.
  const foot = [];
  const footYaw = 0.13;
  const FC = (z, y = SOLE + 0.06) => [0, y, z];
  const footSec = (z, w, up, dn = 0.07) => sec(FC(z), w, up, dn, { p: 2.25, ridge: 0.008, ridgeW: 0.16 });
  const instep = [
    [-0.02, 0.17, 0.33], [0.09, 0.178, 0.27], [0.19, 0.188, 0.205], [0.29, 0.198, 0.158], [0.39, 0.202, 0.13], [0.49, 0.196, 0.112], [0.58, 0.178, 0.098],
  ];
  for (let i = 0; i < instep.length - 1; i++) {
    const [z0, w0, h0] = instep[i]; const [z1, w1, h1] = instep[i + 1];
    foot.push(lame(footSec(z0 - 0.025, w0 * 0.98, h0 * 0.98), footSec(z1, w1 + 0.006, h1 + 0.008), { ref: [0, 1, 0], sides: 16, bead: 0.009 }));
  }
  // The toe cap: rounded and only a little drawn out. A long pointed toe is true of some harness and
  // reads here as a drill bit.
  foot.push(loft(dense([
    footSec(0.57, 0.178, 0.096), footSec(0.65, 0.158, 0.09), footSec(0.72, 0.122, 0.08), footSec(0.77, 0.076, 0.062), sec(FC(0.795), 0.016, 0.02, 0.02),
  ], 8), { sides: 22, ref: [0, 1, 0] }));
  // Heel cup.
  foot.push(loft(dense([
    footSec(0.02, 0.17, 0.3), footSec(-0.1, 0.165, 0.27), footSec(-0.2, 0.14, 0.235), footSec(-0.27, 0.095, 0.17), sec(FC(-0.305), 0.03, 0.05, 0.05),
  ], 10), { sides: 26, ref: [0, 1, 0] }));
  // Ankle: a ring rising from the foot up inside the greave's flare.
  const legFoot = legC(0.8);
  const footMat = new THREE.Matrix4().makeRotationY(footYaw).setPosition(legFoot[0], 0, legFoot[2]);
  for (const g of foot) S(g.applyMatrix4(footMat));
  S(lame(sec([legFoot[0], 0.87, legFoot[2]], 0.122, 0.124, 0.124), sec([legFoot[0], 0.66, legFoot[2] + 0.01], 0.165, 0.2, 0.18), { sides: 30, bead: 0.01 }));
  // The sole, and a rowel-less spur strap across the instep in leather.
  const sole = new THREE.SphereGeometry(1, 20, 10).scale(0.19, 0.03, 0.54);
  sole.translate(0, SOLE + 0.018, 0.25);
  sole.applyMatrix4(footMat);
  D(sole);

  // ---- the arm, built once
  const shoulder = [0.72, 4.74, -0.02]; const elbow = [0.87, 3.74, -0.04]; const wrist = [0.89, 2.92, 0.17]; const hand = [0.87, 2.4, 0.28];
  const armAt = (t) => {
    if (t <= 1) return lerp3(shoulder, elbow, t);
    if (t <= 2) return lerp3(elbow, wrist, t - 1);
    return lerp3(wrist, hand, t - 2);
  };
  // The pauldron: a dome over the point of the shoulder, then lames down the arm. It reaches further
  // front and back than sideways, so it wraps the joint, which is the whole purpose of it.
  // Each ring tips outward, so the lames slope down off the shoulder and wrap it, instead of stacking
  // up as a pile of level discs.
  const PN = [0.46, -0.89, 0];
  const PY = [0.0, 0.16, 0.32, 0.47, 0.6];
  const paulRing = (t, grow = 0) => {
    const c = lerp3([0.74, 4.84, -0.02], [0.92, 4.24, -0.03], t);
    const k = 1 - t * 0.6;
    return sec(c, 0.32 * k + grow, 0.38 * k + grow, 0.4 * k + grow, { ridge: 0.01, ridgeW: 0.2, n: PN });
  };
  const paulDome = dense([
    sec([0.645, 5.04, -0.02], 0.05, 0.08, 0.09),
    sec([0.66, 5.0, -0.02], 0.2, 0.25, 0.27),
    sec([0.695, 4.93, -0.02], 0.285, 0.34, 0.36),
    sec([0.74, 4.84, -0.02], 0.325, 0.385, 0.405),
  ], 9).map((r) => ({ ...r, n: PN }));
  // Rolled edge at the bottom of the dome.
  const lastDome = paulDome[paulDome.length - 1];
  const below = (d) => [0.74 + PN[0] * d, 4.84 + PN[1] * d, -0.02];
  S(loft([...paulDome, lastDome, growSec(lastDome, 0.014, below(0.014)), growSec(lastDome, 0.004, below(0.028)), growSec(lastDome, 0.004, below(0.028)), scaleSec(lastDome, 0.8, { c: below(0.028) })], { sides: 32 }));
  for (let i = 0; i < 4; i++) {
    const t0 = PY[i] - 0.015; const t1 = PY[i + 1] + 0.015;
    S(lame(paulRing(t0), paulRing(t1, 0.006), { sides: 24, bead: 0.013 }));
    for (const a of [thF, -thF, 0.02]) {
      const s = paulRing(t1 - 0.05);
      const [X, F] = secPoint(s, a);
      A(stud([s.c[0] + X * 0.89 - PN[0] * 0, s.c[1] + X * 0.46, s.c[2] + F], [Math.cos(a), -0.2, Math.sin(a)], 0.017, 0.011, 5));
    }
  }
  // Upper arm tube, couter and vambrace, all on the arm's own line.
  const armRing = (t, r, extra = {}) => sec(armAt(t), r, r * 1.05, r * 1.05, extra);
  S(loft(dense([armRing(0.2, 0.17), armRing(0.45, 0.155), armRing(0.68, 0.14), armRing(0.86, 0.128)], 8), { sides: 24 }));
  S(lame(armRing(0.8, 0.135), armRing(0.88, 0.145), { sides: 18, bead: 0.01 }));
  S(lame(armRing(0.85, 0.14), armRing(0.93, 0.15), { sides: 18, bead: 0.01 }));
  // The couter's cup reaches out behind the point of the elbow.
  const cupC = armAt(1);
  S(loft(dense([
    sec(armAt(0.92), 0.14, 0.15, 0.17),
    sec(armAt(0.97), 0.155, 0.15, 0.22),
    sec(armAt(1.0), 0.162, 0.15, 0.24, { ridgeB: 0.02, ridgeW: 0.24 }),
    sec(armAt(1.05), 0.152, 0.145, 0.215),
    sec(armAt(1.1), 0.126, 0.125, 0.14),
  ], 7), { sides: 24 }));
  S(lame(armRing(1.07, 0.124), armRing(1.14, 0.134), { sides: 18, bead: 0.01 }));
  S(lame(armRing(1.11, 0.125), armRing(1.19, 0.13), { sides: 18, bead: 0.01 }));
  S(fanWing([cupC[0] + 0.145, cupC[1], cupC[2] - 0.06], [1, 0, -0.45], [0, 1, 0.1], 0.19, { flutes: 5 }));
  A(stud([cupC[0] + 0.2, cupC[1], cupC[2] - 0.085], [1, 0, -0.45], 0.028, 0.018, 8));
  const vambRows = dense([armRing(1.14, 0.122), armRing(1.3, 0.128, { ridge: 0.008 }), armRing(1.55, 0.112, { ridge: 0.01 }), armRing(1.8, 0.09, { ridge: 0.006 }), armRing(1.96, 0.08)], 9);
  S(loft(vambRows, { sides: 24 }));
  // The vambrace's hinge pins and buckle straps.
  for (const t of [1.3, 1.6]) {
    const c = armAt(t);
    const r = mix(0.128, 0.09, (t - 1.3) / 0.5);
    A(rod([c[0] + r + 0.006, c[1] - 0.04, c[2]], [c[0] + r + 0.006, c[1] + 0.04, c[2]], 0.016, { sides: 7 }));
  }

  // The gauntlet: an hourglass cuff with a rolled, brass-edged lip, then lames over the back of the
  // hand, then each finger its own run of small plates. Hand-flat axis: width along z, back toward +x.
  const hRef = [1, 0, 0];
  const handSec = (t, w, b, f, extra = {}) => sec(armAt(t), w, b, f, { p: 2.5, ...extra });
  const cuff = (t) => armRing(t, mix(0.078, 0.15, clamp01((2 - t) / 0.28)));
  S(loft(dense([cuff(1.72), cuff(1.78), cuff(1.86), cuff(1.94), armRing(2.02, 0.078)], 7), { sides: 24 }));
  {
    const edge = cuff(1.72);
    A(loft([scaleSec(edge, 0.95, { c: armAt(1.75) }), growSec(edge, 0.006, armAt(1.735)), growSec(edge, 0.012, armAt(1.72)), growSec(edge, 0.006, armAt(1.705)), scaleSec(edge, 0.9, { c: armAt(1.705) })], { sides: 28 }));
  }
  const handT = [2.0, 2.1, 2.2, 2.3, 2.42];
  const handW = [0.1, 0.118, 0.13, 0.14, 0.142];
  for (let i = 0; i < 4; i++) {
    S(lame(
      handSec(handT[i] - 0.01, handW[i], 0.066, 0.05),
      handSec(handT[i + 1] + 0.02, handW[i + 1], 0.066, 0.05),
      { ref: hRef, sides: 16, bead: 0.007 },
    ));
  }
  D(loft(dense([handSec(2.05, 0.09, 0.05, 0.045), handSec(2.25, 0.13, 0.055, 0.05), handSec(2.44, 0.135, 0.05, 0.045)], 6), { ref: hRef, sides: 18 }));
  // Knuckle plate: the one with the small bosses.
  const K = armAt(2.46);
  for (let f = 0; f < 4; f++) {
    const z = K[2] + (f - 1.5) * 0.069;
    const y = K[1] + (f - 1.5) * -0.008 + 0.01;
    S(stud([K[0] + 0.05, y, z], [1, -0.2, 0], 0.036, 0.024, 6));
    // A finger: dark glove underneath, then four small lapped plates, curling toward the thigh.
    const len = [0.28, 0.32, 0.3, 0.25][f];
    const pts = [
      [K[0] + 0.012, y + 0.012, z],
      [K[0] + 0.006, y - len * 0.35, z + 0.006],
      [K[0] - 0.03, y - len * 0.7, z + 0.012],
      [K[0] - 0.095, y - len, z + 0.015],
    ];
    D(rope(pts, 0.026, { sides: 7, steps: 10, pitch: 1 }));
    const curve = new THREE.CatmullRomCurve3(pts.map(vec));
    const COUNT = 4;
    for (let i = 0; i < COUNT; i++) {
      const a = curve.getPoint(i / COUNT - (i ? 0.03 : 0)); const b = curve.getPoint((i + 1) / COUNT);
      const w = mix(0.034, 0.026, i / (COUNT - 1));
      S(lame(sec([a.x, a.y, a.z], w, w, w * 0.82), sec([b.x, b.y, b.z], w * 1.02, w * 1.06, w * 0.82), { ref: [1, 0, 0], sides: 8, bead: 0.0045, lite: true }));
    }
  }
  // The thumb, set forward of the hand.
  {
    const T0 = armAt(2.18);
    const pts = [[T0[0] - 0.01, T0[1], T0[2] + 0.12], [T0[0] - 0.02, T0[1] - 0.12, T0[2] + 0.18], [T0[0] - 0.05, T0[1] - 0.24, T0[2] + 0.2], [T0[0] - 0.08, T0[1] - 0.33, T0[2] + 0.18]];
    D(rope(pts, 0.03, { sides: 7, steps: 10, pitch: 1 }));
    const curve = new THREE.CatmullRomCurve3(pts.map(vec));
    for (let i = 0; i < 3; i++) {
      const a = curve.getPoint(i / 3 - (i ? 0.03 : 0)); const b = curve.getPoint((i + 1) / 3);
      S(lame(sec([a.x, a.y, a.z], 0.04, 0.04, 0.034), sec([b.x, b.y, b.z], 0.04, 0.042, 0.034), { ref: [1, 0, 0], sides: 8, bead: 0.005, lite: true }));
    }
  }

  // ---- tassets: they lie on the fauld's own ellipse carried on downward, so where one tucks up
  // under the last lame there is nothing for it to cross. Three lames each, ending in a shallow U.
  for (let row = 0; row < 3; row++) {
    const top = 3.03 - row * 0.19;
    const bot = top - 0.25;
    const k = 0.985 + row * 0.004;
    const tSec = sec([0, 0, 0.012], 0.66 * k, 0.47 * k, 0.47 * k);
    const place = (a, y, lift = 0) => {
      const th = thF - 0.72 + a * 0.6;
      const [X, F] = secPoint(tSec, th);
      const n = Math.hypot(Math.cos(th) * 0.47, Math.sin(th) * 0.66) || 1;
      return [X + (Math.cos(th) * 0.47 / n) * lift, y, F + 0.012 + (Math.sin(th) * 0.66 / n) * lift];
    };
    S(outward(solidSurface({
      nu: 16,
      nv: 4,
      point: (u, v) => {
        const a = (u - 0.5) * 2;
        const lowest = bot + a * a * (row === 2 ? 0.14 : 0.03);
        return place(a, mix(top, lowest, v));
      },
      thick: (u, v) => 0.011 + Math.max(sstep(v, 0.8, 1), sstep(Math.abs(u - 0.5) * 2, 0.88, 1)) * 0.009,
    })));
    for (const a of [-0.78, 0, 0.78]) {
      const p = place(a, top - 0.08, 0.012);
      const c = place(a, top - 0.08, 0.1);
      A(stud(p, [c[0] - p[0], 0, c[2] - p[2]], 0.017, 0.011, 5));
    }
  }

  sided = false;

  // ---- the gorget
  S(lame(sec([0, 5.12, 0.01], 0.205, 0.215, 0.225), sec([0, 5.05, 0.01], 0.245, 0.255, 0.27), { sides: 28, bead: 0.012 }));
  S(lame(sec([0, 5.06, 0.01], 0.235, 0.245, 0.26), sec([0, 4.97, 0.01], 0.34, 0.33, 0.35), { sides: 30, bead: 0.014 }));
  S(lame(sec([0, 4.98, 0.01], 0.32, 0.31, 0.33), sec([0, 4.88, 0.015], 0.42, 0.39, 0.41), { sides: 34, bead: 0.014 }));
  // The dark inside of the collar, closing it under the helmet.
  D(new THREE.SphereGeometry(0.2, 14, 8).scale(1, 0.5, 1.05).translate(0, 5.14, 0.01));

  // ---- the helmet: an armet, with its visor standing open on the dark
  const HC = 0.03;
  const helmStations = [
    sec([0, 5.12, HC + 0.01], 0.205, 0.235, 0.24, { ridge: 0.012, ridgeW: 0.14 }),
    sec([0, 5.26, HC], 0.285, 0.33, 0.325, { ridge: 0.016, ridgeW: 0.12 }),
    sec([0, 5.42, HC], 0.315, 0.355, 0.385, { ridge: 0.008, ridgeW: 0.12 }),
    sec([0, 5.58, HC], 0.33, 0.365, 0.41),
    sec([0, 5.74, HC], 0.322, 0.355, 0.405),
    sec([0, 5.86, HC], 0.272, 0.3, 0.34),
    sec([0, 5.94, HC], 0.178, 0.195, 0.222),
    sec([0, 5.985, HC], 0.05, 0.05, 0.058),
  ];
  const helmRows = dense(helmStations, 20);
  S(loft(helmRows, { sides: 40 }));
  const helm = hostOf(helmRows);
  // The comb: a low crest from the brow, over the top, down to the nape. A real solid, rooted inside.
  {
    const front = []; const rear = [];
    for (let i = 0; i <= 14; i++) {
      const y = mix(5.74, 5.97, i / 14);
      const s = helm.at(y);
      front.push([HC + s.rf, y]);
    }
    for (let i = 14; i >= 0; i--) {
      const y = mix(5.34, 5.97, i / 14);
      const s = helm.at(y);
      rear.push([HC - s.rb, y]);
    }
    const profile = [...front, ...rear];
    const outer = profile.map(([z, y]) => {
      const dz = z - HC; const dy = y - 5.55;
      const l = Math.hypot(dz, dy) || 1;
      return [z + (dz / l) * 0.052, y + (dy / l) * 0.052];
    });
    const inner = profile.map(([z, y]) => {
      const dz = z - HC; const dy = y - 5.55;
      const l = Math.hypot(dz, dy) || 1;
      return [z - (dz / l) * 0.03, y - (dy / l) * 0.03];
    });
    S(prismX([...outer, ...inner.reverse()], -0.014, 0.014, 0xffffff, { capShade: 1 }));
  }
  // The face opening: dark, a hair proud, with a rolled rim round it. Nothing behind it.
  const faceHalf = 0.98;
  const faceYL = (th) => 5.34 + 0.08 * Math.pow(Math.abs(th - thF) / faceHalf, 3);
  const faceYH = (th) => 5.72 - 0.2 * Math.pow(Math.abs(th - thF) / faceHalf, 3);
  D(hostPatch(helm, thF - faceHalf, thF + faceHalf, faceYL, faceYH, 0.007, { nu: 26, rows: [[0, 1], [0.5, 1], [1, 1]] }));
  {
    const rim = [];
    const N = 26;
    for (let i = 0; i <= N; i++) { const th = mix(thF - faceHalf, thF + faceHalf, i / N); rim.push(helm.pt(th, faceYH(th), 0.008)); }
    for (let i = N; i >= 0; i--) { const th = mix(thF - faceHalf, thF + faceHalf, i / N); rim.push(helm.pt(th, faceYL(th), 0.008)); }
    rim.push(rim[0]);
    S(rope(rim, 0.017, { sides: 6, steps: 44, pitch: 1, round: 0 }));
    // Latten rivets round the chin of the opening.
    for (let i = 1; i < 10; i++) {
      const th = thF - 0.86 + (i / 10) * 1.72;
      const y = faceYL(th) - 0.04;
      A(stud(helm.pt(th, y, 0.002), helm.normal(th, y), 0.012, 0.008, 6));
    }
  }
  // The cheek hinge pieces meet at the chin: a raised strap down the centre, with the hook that
  // closes them.
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const y = mix(5.14, 5.32, i / 8); pts.push(helm.pt(thF, y, 0.006)); }
    S(rope(pts, 0.012, { sides: 6, steps: 10, pitch: 1 }));
    A(stud(helm.pt(thF, 5.2, 0.012), helm.normal(thF, 5.2), 0.024, 0.014, 8));
  }
  // The rondel at the nape, on a short stalk: the Italian armet's signature.
  {
    const nape = helm.pt(-thF, 5.3, -0.02);
    A(rod(nape, [nape[0], nape[1] - 0.02, nape[2] - 0.12], 0.018, { sides: 7 }), 0x8c6a2a);
    S(fanWing([nape[0], nape[1] - 0.02, nape[2] - 0.11], [0, 0, -1], [0, 1, 0], 0.09, { flutes: 5, dome: 0.018, depth: 0.004, thick: 0.008 }));
  }
  // The visor, built closed and then swung up about the pivots at the temples. It is a shell over the
  // face with a beak at the middle, its sight a dark slit and its breaths a pair of dark rows.
  {
    const PIVOT_Y = 5.62;
    const raise = new THREE.Matrix4()
      .makeTranslation(0, PIVOT_Y, HC)
      .multiply(new THREE.Matrix4().makeRotationX(-1.1))
      .multiply(new THREE.Matrix4().makeTranslation(0, -PIVOT_Y, -HC));
    const vis = (u, v, lift) => {
      const a = (u - 0.5) * 2;
      const th = thF + a * 1.42;
      const yTop = 5.74 - 0.14 * a * a;
      const yBot = 5.18 + 0.27 * a * a;
      const y = mix(yTop, yBot, v);
      const beak = 0.17 * Math.pow(1 - Math.abs(a), 1.25) * Math.pow(Math.sin(Math.PI * clamp01(v * 0.92 + 0.04)), 0.85);
      return helm.pt(th, y, 0.036 + lift + beak);
    };
    const shell = outward(solidSurface({
      nu: 30,
      nv: 15,
      point: (u, v) => vis(u, v, 0),
      thick: (u, v) => {
        const edge = Math.max(sstep(v, 0.93, 1), sstep(1 - v, 0.93, 1), sstep(Math.abs(u - 0.5) * 2, 0.95, 1));
        return 0.012 + edge * 0.007;
      },
    }));
    S(shell.applyMatrix4(raise));
    // The two hinge arms running back to the temples.
    const V = new THREE.Vector3();
    const toWorld = (p) => { V.set(p[0], p[1], p[2]).applyMatrix4(raise); return [V.x, V.y, V.z]; };
    const pivot = (sx) => [sx * 0.33, PIVOT_Y, HC];
    for (const [sx, u0] of [[1, 0.0], [-1, 1.0]]) {
      const start = toWorld(vis(u0, 0.5, 0));
      S(rope([start, lerp3(start, pivot(sx), 0.5), pivot(sx)], 0.035, { sides: 8, steps: 8, pitch: 1, radius: () => 0.028 }));
      A(stud([sx * 0.348, PIVOT_Y, HC], [sx, 0, 0], 0.046, 0.022, 10));
    }
    // The sight: a dark slit across the top third, and breaths below it on the right-hand side.
    for (const lift of [0.016]) {
      const slit = solidSurface({
        nu: 18,
        nv: 2,
        point: (u, v) => toWorld(vis(mix(0.22, 0.78, u), mix(0.25, 0.3, v), lift)),
        thick: () => 0.002,
      });
      D(outward(slit));
    }
    for (let i = 0; i < 7; i++) {
      for (const v of [0.6, 0.68, 0.76]) {
        const p = toWorld(vis(0.58 + i * 0.045, v, 0.015));
        const q = toWorld(vis(0.58 + i * 0.045, v, 0.03));
        D(stud(p, [q[0] - p[0], q[1] - p[1], q[2] - p[2]], 0.011, 0.005, 6));
      }
    }
  }
  // The plume: red, rising from a socket at the back of the skull.
  {
    const base = helm.pt(-thF, 5.82, -0.01);
    A(rod([base[0], base[1] - 0.02, base[2] + 0.03], [base[0], base[1] + 0.14, base[2] - 0.06], 0.04, { r2: 0.05, sides: 10 }));
    // A sculpt, so the strands fuse into one soft mass at the root and only part at the tips. Swept
    // tubes side by side read as the tines of a comb.
    const rngP = seededRandom(1460);
    const plume = new Sculpt(0.04);
    const RED_L = lin(RED); const RED_D = lin(0x7a1016);
    const start = [base[0], base[1] + 0.12, base[2] - 0.05];
    for (let i = 0; i < 7; i++) {
      const sw = (i - 3) * 0.03;
      const fall = 0.42 + rngP() * 0.16;
      const lift = 0.2 + rngP() * 0.05;
      plume.add(curveP([
        start,
        [start[0] + sw * 0.8, start[1] + lift * 0.8, start[2] - 0.03],
        [start[0] + sw * 1.5, start[1] + lift, start[2] - 0.2],
        [start[0] + sw * 2.2, start[1] + lift * 0.62, start[2] - fall],
        [start[0] + sw * 2.5, start[1] - lift * 0.1 - rngP() * 0.1, start[2] - fall - 0.13],
      ], [0.05, 0.075, 0.085, 0.06, 0.014], 18), i % 2 ? RED_L : RED_D, { k: 0.05 });
    }
    const plumeGeo = polygonize(plume, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const k = 0.86 + 0.3 * smoothNoise3(x * 20, y * 8, z * 8);
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      },
    });
    accent.push({ geometry: plumeGeo, keepColor: true, sided: false });
  }

  // ---- the support: an iron post, visible only behind the legs, and the stand
  const STAND_R = 1.34;
  const standUV = (g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6, uv.getY(i) * 0.6); return g; };
  wood.push({ geometry: tinted(standUV(wrapLathe([[0, 0], [STAND_R, 0], [STAND_R, 0.12], [STAND_R - 0.05, 0.14], [STAND_R - 0.05, 0.16], [STAND_R - 0.14, 0.2], [STAND_R - 0.16, 0.34], [STAND_R - 0.22, 0.39], [STAND_R - 0.22, 0.4], [0, 0.4]], { segments: 48 })), 0x57371e), keepColor: true });
  dark.push({ geometry: rod([0, 0.4, -0.3], [0, 3.1, -0.14], 0.06, { sides: 12 }), color: POST });
  dark.push({ geometry: new THREE.CylinderGeometry(0.16, 0.2, 0.06, 18).translate(0, 0.43, -0.3), color: POST });
  dark.push({ geometry: rod([0, 2.94, -0.2], [0.3, 2.97, -0.05], 0.04, { sides: 8 }), color: POST });

  const expand = (list) => {
    const extra = [];
    for (const part of list) if (part.sided) extra.push({ ...part, geometry: mirrorX(part.geometry) });
    return [...list, ...extra];
  };

  const steelGeom = mergeParts(expand(steel));
  polishSteel(steelGeom, 0xa5acb5);
  const steelMesh = new THREE.Mesh(steelGeom, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.42 }));
  steelMesh.castShadow = true;
  steelMesh.receiveShadow = true;
  return groupOf(
    steelMesh,
    meshOf(expand(accent), { roughness: 0.5, metalness: 0.24 }),
    meshOf(expand(dark), { roughness: 0.95, metalness: 0 }),
    meshOf(wood, { ...grainMaps({ seed: 88, strength: 0.4 }), roughness: 0.55, metalness: 0 }),
  );
}

// ---------------------------------------------------------------------------
// The samurai armor: a suit seated on its storage chest, as it is displayed
// ---------------------------------------------------------------------------
//
// EMPTY. The dark under the helmet is only dark, and the mask is an armour piece with no features of
// anyone in it. Modelled on the general type of Edo-period display armour, not on any one suit, and
// the chest's gold badge is an abstract lozenge rather than a real family's crest.
//
// ONE CANVAS LACES THE WHOLE SUIT. It is three bands: a plain row of small plates with near-white
// silk, a bottom row with its cross-knots, and a band of stencilled leather. Plates are near-black and
// silk near-white, and the canvas is MULTIPLIED by vertex colour, so black stays black whatever the
// silk is dyed. The same drawing is the bump, with the cords standing proudest.
//
// A panel is a stack of closed rows on a path, each row's bottom lifted and each row's top tucked,
// so they shingle over one another as laced rows really do and cannot leave a gap.

const SM_A = [0.668, 0.995]; // plain row: its v range in the canvas, bottom then top
const SM_B = [0.338, 0.662]; // bottom row with its cross-knots
const SM_C = [0.006, 0.33]; // stencilled leather

function samuraiMaps() {
  const SIZE = 1024;
  const { canvas: mapC, ctx: mc } = makeCanvas(SIZE, SIZE);
  const { canvas: bumpC, ctx: bc } = makeCanvas(SIZE / 2, SIZE / 2);
  bc.scale(0.5, 0.5);
  const BAND = SIZE / 3;
  mc.fillStyle = '#0a0908'; mc.fillRect(0, 0, SIZE, SIZE);
  bc.fillStyle = 'rgb(70,70,70)'; bc.fillRect(0, 0, SIZE, SIZE);
  const PLATES = 8;
  const PW = SIZE / PLATES;
  const drawRow = (y0, cordFill, knots) => {
    const yTop = y0 + 6;
    const headH = BAND * 0.26;
    for (let i = 0; i < PLATES; i++) {
      const x = i * PW;
      // The lacquered head of a plate: a rounded tab, glossy along its upper edge.
      mc.fillStyle = '#16120f';
      bc.fillStyle = 'rgb(150,150,150)';
      for (const ctx of [mc, bc]) {
        ctx.beginPath();
        ctx.moveTo(x + 3, yTop + headH);
        ctx.lineTo(x + 3, yTop + 16);
        ctx.quadraticCurveTo(x + PW / 2, yTop - 12, x + PW - 3, yTop + 16);
        ctx.lineTo(x + PW - 3, yTop + headH);
        ctx.closePath();
        ctx.fill();
      }
      mc.fillStyle = 'rgba(190,180,170,0.34)';
      mc.fillRect(x + 12, yTop + 11, PW - 24, 6);
      mc.fillStyle = 'rgba(190,180,170,0.1)';
      mc.fillRect(x + 8, yTop + 20, PW - 16, headH * 0.5);
      // Two cords down each plate, from the holes in its head to the row below.
      for (const dx of [PW * 0.27, PW * 0.73]) {
        const cw = PW * 0.34;
        const cx = x + dx - cw / 2;
        const top = yTop + headH * 0.72;
        const bot = y0 + BAND - 4;
        mc.fillStyle = cordFill;
        mc.fillRect(cx, top, cw, bot - top);
        const g = bc.createLinearGradient(cx, 0, cx + cw, 0);
        g.addColorStop(0, 'rgb(120,120,120)');
        g.addColorStop(0.5, 'rgb(250,250,250)');
        g.addColorStop(1, 'rgb(120,120,120)');
        bc.fillStyle = g;
        bc.fillRect(cx, top, cw, bot - top);
        // Braided silk: slanting ticks, dark in the map and low in the bump.
        for (let yy = top; yy < bot; yy += 11) {
          mc.strokeStyle = 'rgba(0,0,0,0.27)';
          mc.lineWidth = 2.2;
          mc.beginPath(); mc.moveTo(cx, yy + 6); mc.lineTo(cx + cw, yy); mc.stroke();
          bc.strokeStyle = 'rgba(40,40,40,0.65)';
          bc.lineWidth = 2.6;
          bc.beginPath(); bc.moveTo(cx, yy + 6); bc.lineTo(cx + cw, yy); bc.stroke();
        }
        // The hole it comes out of, dark, above the cord.
        mc.fillStyle = '#000000';
        mc.beginPath(); mc.ellipse(cx + cw / 2, top - 2, cw * 0.42, 7, 0, 0, Math.PI * 2); mc.fill();
      }
    }
    if (knots) {
      // Hishinui: the white cross-knots along a bottom row, with a red band behind.
      const ky = y0 + BAND * 0.76;
      mc.fillStyle = '#7d1214';
      mc.fillRect(0, ky - 26, SIZE, 52);
      bc.fillStyle = 'rgb(120,120,120)';
      bc.fillRect(0, ky - 26, SIZE, 52);
      for (let i = 0; i < PLATES * 2; i++) {
        const cx = (i + 0.5) * (PW / 2);
        for (const [ctx, stroke, w] of [[mc, '#eee7d6', 8.5], [bc, 'rgb(255,255,255)', 9]]) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = w;
          ctx.beginPath(); ctx.moveTo(cx - 15, ky - 19); ctx.lineTo(cx + 15, ky + 19); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + 15, ky - 19); ctx.lineTo(cx - 15, ky + 19); ctx.stroke();
        }
      }
    }
  };
  drawRow(0, '#f2eee7', false);
  drawRow(BAND, '#b51e20', true);

  // Stencilled deerskin, for the chest panel and the turned-back ears: small repeating lozenges of
  // gold and red on a deep indigo ground. An abstract pattern, as many real ones are.
  const y0 = BAND * 2;
  mc.fillStyle = '#16244f';
  mc.fillRect(0, y0, SIZE, BAND);
  bc.fillStyle = 'rgb(120,120,120)';
  bc.fillRect(0, y0, SIZE, BAND);
  const CELL = SIZE / 8;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 3; j++) {
      for (const off of [0, 0.5]) {
        const cx = (i + off) * CELL; const cy = y0 + (j + off) * CELL * 0.9 + 12;
        if (cy > y0 + BAND - 18 || cy < y0 + 18) continue;
        const dia = (ctx, r, fill) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.75, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.75, cy);
          ctx.closePath();
          ctx.fill();
        };
        dia(mc, 36, off ? '#b51e20' : '#d9a93c');
        dia(mc, 18, '#16244f');
        dia(bc, 36, 'rgb(200,200,200)');
        dia(bc, 18, 'rgb(110,110,110)');
      }
    }
  }
  return { map: texOf(mapC, THREE.SRGBColorSpace), bumpMap: texOf(bumpC, THREE.NoColorSpace), bumpScale: 1.6 };
}

const smV = (band, v) => mix(band[1], band[0], clamp01(v));

// A closed laced row, as a ring round a body. Seam column real, so the canvas runs true.
function ringRow(top, bot, { sides = 40, rep = 8, band = SM_A, bead = 0.012, start = -Math.PI / 2 } = {}) {
  const pos = []; const uv = []; const idx = [];
  const ring = sides + 1;
  const dirY = Math.sign(bot.c[1] - top.c[1]) || -1;
  const stations = [
    [scaleSec(top, 0.96), 0.02],
    [top, 0.02],
    [{ ...bot, rx: bot.rx, rf: bot.rf, rb: bot.rb }, 0.98],
    [growSec(bot, bead, [bot.c[0], bot.c[1] + dirY * bead, bot.c[2]]), 0.99],
    [scaleSec(bot, 0.82, { c: [bot.c[0], bot.c[1] + dirY * bead, bot.c[2]] }), 0.99],
  ];
  stations.forEach(([st, v]) => {
    for (let j = 0; j <= sides; j++) {
      const [X, F] = secPoint(st, start + (j / sides) * Math.PI * 2);
      pos.push(st.c[0] + X, st.c[1], st.c[2] + F);
      uv.push((j / sides) * rep, smV(band, v));
    }
  });
  const n = stations.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j; const b = i * ring + j + 1; const c = (i + 1) * ring + j + 1; const d = (i + 1) * ring + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Open at the top, so its volume cannot say which way round it is. Rows run down and columns run
  // counter-clockwise seen from above, and one face asked directly settles it.
  const face = (k) => vec([pos[idx[k] * 3], pos[idx[k] * 3 + 1], pos[idx[k] * 3 + 2]]);
  const k0 = (Math.floor(sides / 4) * 6) + sides * 6;
  const fn = face(k0 + 1).sub(face(k0)).cross(face(k0 + 2).sub(face(k0)));
  const c0 = face(k0).setY(0).sub(new THREE.Vector3(bot.c[0], 0, bot.c[2]));
  if (fn.dot(c0) < 0) {
    const flip = [];
    for (let k = 0; k < idx.length; k += 3) flip.push(idx[k], idx[k + 2], idx[k + 1]);
    g.setIndex(flip);
  }
  g.computeVertexNormals();
  weldSeam(g, ring, n);
  return g;
}

// A hanging panel of laced rows, down a path. `path` is [out, y] pairs in a vertical plane through
// `origin` facing along `d`. Every row is a closed plate, its top tucked and its bottom lifted.
function lacedPanel(list, path, {
  origin = [0, 0], d = [0, 1], lat = [1, 0], width = () => 0.7, rows = 5, curve = 0.03, shift = () => 0, cord = 0xb51e20, knotRow = true, tile = 0.45, overlap = 0.035, cordOf = null, backing = null,
}) {
  const curve3 = new THREE.CatmullRomCurve3(path.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, 'catmullrom', 0.5);
  const N = 60;
  const P = curve3.getSpacedPoints(N);
  let total = 0;
  for (let i = 0; i < N; i++) total += P[i].distanceTo(P[i + 1]);
  const at = (s) => {
    const f = clamp01(s) * N;
    const i = Math.min(N - 1, Math.floor(f));
    const q = P[i].clone().lerp(P[i + 1], f - i);
    const tang = P[i + 1].clone().sub(P[i]).normalize();
    // The side facing away from the body: the path runs top to bottom, so outward is (-t.y, t.x) or
    // its opposite, whichever has a positive `out`.
    let nA = -tang.y; let nY = tang.x;
    if (nA < 0) { nA = -nA; nY = -nY; }
    return { a: q.x, y: q.y, nA, nY };
  };
  const rowLen = 1 / rows;
  if (backing) {
    // A thin black plate behind the rows, so a guard seen edge-on is one thing rather than a stack.
    backing.push({
      geometry: outward(solidSurface({
        nu: 8,
        nv: 10,
        point: (u, v) => {
          const f = at(v * 0.995);
          const a = (u - 0.5) * 2;
          const off = curve * (1 - a * a) - 0.02;
          const l = a * (width(v) / 2 - 0.005) + shift(v);
          return [origin[0] + d[0] * (f.a + f.nA * off) + lat[0] * l, f.y + f.nY * off, origin[1] + d[1] * (f.a + f.nA * off) + lat[1] * l];
        },
        thick: () => 0.008,
      })),
      color: 0x0c0b0b,
    });
  }
  for (let r = 0; r < rows; r++) {
    const s0 = r === 0 ? 0 : r * rowLen - overlap / total;
    const s1 = (r + 1) * rowLen;
    const isBottom = r === rows - 1;
    const repU = Math.max(1, Math.round((width(mix(s0, s1, 0.5)) / tile) * 2) / 2);
    const g = solidSurface({
      nu: 8,
      nv: 3,
      point: (u, v) => {
        const s = mix(s0, s1, v);
        const f = at(s);
        const a = (u - 0.5) * 2;
        const off = curve * (1 - a * a) + mix(-0.012, 0.016, v);
        const out = f.a + f.nA * off;
        const y = f.y + f.nY * off;
        const l = a * (width(s) / 2) + shift(s);
        return [origin[0] + d[0] * out + lat[0] * l, y, origin[1] + d[1] * out + lat[1] * l];
      },
      thick: () => 0.012,
    });
    const uv = g.attributes.uv;
    const band = isBottom && knotRow ? SM_B : SM_A;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repU, smV(band, uv.getY(i)));
    const out = outward(g);
    const col = isBottom && knotRow ? 0xffffff : (cordOf ? cordOf(r) : cord);
    list.push({ geometry: tinted(out, col), keepColor: true });
  }
}

function samuraiArmor() {
  const laced = []; const lacq = []; const gold = []; const cord = []; const dark = [];
  const BLACK = 0x0c0b0b; const RED_L = 0x8c1518; const GOLD = 0xc99a38; const SILK = 0xb51e20; const INDIGO = 0x1c2a52;
  const BEAM = { chamfer: 0.03, capShade: 1, jitter: 0 };
  const L = (geo, color = BLACK) => lacq.push({ geometry: geo, color });
  const G = (geo, color = GOLD) => gold.push({ geometry: geo, color });
  const C = (geo, color = SILK) => cord.push({ geometry: geo, color });
  const box = (list, color, a, b, w, h, opts = {}) => timber(list, color, a, b, w, h, { ...BEAM, ...opts });

  // ---- the dais
  box(lacq, RED_L, [-1.95, 0.05, 0], [1.95, 0.05, 0], 3.1, 0.1, { chamfer: 0.015 });
  box(lacq, BLACK, [-1.85, 0.16, 0], [1.85, 0.16, 0], 2.9, 0.12, { chamfer: 0.02 });

  // ---- the chest: black lacquer with gilt fittings and a heavy lid
  const HW = 1.18; const HD = 0.92;
  const BY0 = 0.22; const LID0 = 1.4; const LID1 = 1.6;
  box(lacq, BLACK, [-HW + 0.03, (BY0 + LID0) / 2, 0], [HW - 0.03, (BY0 + LID0) / 2, 0], (HD - 0.03) * 2, LID0 - BY0, { chamfer: 0.03 });
  box(lacq, BLACK, [-HW - 0.03, (LID0 + LID1) / 2, 0], [HW + 0.03, (LID0 + LID1) / 2, 0], (HD + 0.03) * 2, LID1 - LID0, { chamfer: 0.04 });
  // Gilt straps at every corner, front and side, each with its rivets.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (HW - 0.03); const z = sz * (HD - 0.03);
    box(gold, GOLD, [x - sx * 0.1, (BY0 + 0.26), z + sz * 0.005], [x - sx * 0.1, LID0 - 0.04, z + sz * 0.005], 0.2, 0.02, { chamfer: 0.004, up: [0, 0, 1] });
    box(gold, GOLD, [x + sx * 0.005, (BY0 + 0.26), z - sz * 0.1], [x + sx * 0.005, LID0 - 0.04, z - sz * 0.1], 0.2, 0.02, { chamfer: 0.004, up: [1, 0, 0] });
    for (const y of [BY0 + 0.3, 0.8, LID0 - 0.1]) {
      G(stud([x - sx * 0.1, y, z + sz * 0.02], [0, 0, sz], 0.03, 0.018, 6));
      G(stud([x + sx * 0.02, y, z - sz * 0.1], [sx, 0, 0], 0.03, 0.018, 6));
    }
  }
  // A band round the foot, and one under the lid.
  for (const y of [BY0 + 0.03, LID0 + 0.02]) {
    const off = y > 1 ? 0.04 : 0;
    box(gold, GOLD, [-HW - off, y, HD + off], [HW + off, y, HD + off], 0.018, 0.05, { chamfer: 0.003 });
    box(gold, GOLD, [-HW - off, y, -HD - off], [HW + off, y, -HD - off], 0.018, 0.05, { chamfer: 0.003 });
    for (const sx of [-1, 1]) box(gold, GOLD, [sx * (HW + off), y, -HD - off], [sx * (HW + off), y, HD + off], 0.018, 0.05, { chamfer: 0.003 });
  }
  // Carrying rings, with red cord through them, on both ends.
  for (const sx of [-1, 1]) {
    const x = sx * (HW + 0.01);
    G(stud([x, 0.92, 0], [sx, 0, 0], 0.15, 0.03, 12));
    const ring = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ring.push([x + sx * 0.05, 0.8 + Math.sin(a) * 0.13, Math.cos(a) * 0.13]);
    }
    G(rope(ring, 0.022, { sides: 6, steps: 18, pitch: 1, round: 0 }));
    C(rope([[x + sx * 0.05, 0.67, 0], [x + sx * 0.1, 0.57, -0.1], [x + sx * 0.09, 0.42, -0.2], [x + sx * 0.07, 0.3, -0.26]], 0.024, { sides: 6, steps: 10, pitch: 0.14 }));
    C(rope([[x + sx * 0.05, 0.67, 0], [x + sx * 0.1, 0.57, 0.1], [x + sx * 0.09, 0.42, 0.2], [x + sx * 0.07, 0.3, 0.26]], 0.024, { sides: 6, steps: 10, pitch: 0.14 }));
  }
  // An abstract gilt lozenge low on the front of the chest, below where the skirt ends.
  {
    const lz = HD + 0.0;
    const diamond = [[0, 0.62], [0.2, 0.46], [0, 0.3], [-0.2, 0.46]];
    const g = prismX(diamond.map(([x, y]) => [x, y]), lz - 0.01, lz + 0.016, GOLD, { capShade: 1 });
    // It is authored along X, so it is carried round to face +Z.
    g.rotateY(-Math.PI / 2);
    g.translate(0, 0, 0);
    gold.push({ geometry: g, keepColor: true });
  }

  // ---- the seat and the do: rows of laced plates round the body
  dark.push({ geometry: new THREE.SphereGeometry(1, 18, 12).scale(0.62, 0.3, 0.5).translate(0, 1.76, 0), color: 0x060505 });
  const P = 2.5;
  const doSec = (y, k = 1) => sec([0, y, 0.0], 0.58 * k, 0.46 * k, 0.42 * k, { p: P });
  const DOY = [1.82, 2.0, 2.18, 2.36, 2.54, 2.72];
  const doK = [1.12, 1.07, 1.05, 1.04, 1.03, 1.0];
  for (let i = 0; i < 5; i++) {
    // From the top down. A row's top sits inside the row above's bottom edge.
    const yTop = DOY[5 - i] + 0.015;
    const yBot = DOY[4 - i];
    const kT = doK[5 - i] * 0.985; const kB = doK[4 - i];
    const bandHere = i === 4 ? SM_B : SM_A;
    const g = ringRow(doSec(yTop, kT), doSec(yBot, kB), { sides: 44, rep: 9, band: bandHere });
    laced.push({ geometry: tinted(g, i === 4 ? 0xffffff : SILK), keepColor: true });
  }

  // The upper body: a lacquered plate with a stencilled-leather panel, and gold at the neck.
  const upperRows = dense([
    sec([0, 2.72, 0], 0.575, 0.455, 0.42, { p: P }),
    sec([0, 2.9, 0], 0.57, 0.45, 0.41, { p: P - 0.1 }),
    sec([0, 3.06, 0], 0.51, 0.4, 0.37, { p: 2.2 }),
    sec([0, 3.18, 0], 0.38, 0.3, 0.29),
    sec([0, 3.26, 0], 0.24, 0.22, 0.22),
  ], 12);
  L(loft(upperRows, { sides: 40 }));
  const upper = hostOf(upperRows);
  {
    const thF = Math.PI / 2;
    const half = 1.1;
    const yH = (th) => 3.08 - 0.3 * ((th - thF) / half) ** 4 - 0.06 * ((th - thF) / half) ** 2;
    const g = hostPatch(upper, thF - half, thF + half, () => 2.76, yH, 0.012, { nu: 18, rows: [[0, 1], [0.5, 1], [0.92, 1], [1, -1]], roll: 0 });
    // Laid out once across the panel: the canvas's lower band.
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) / 0.45) + 0.5;
      uv[i * 2 + 1] = mix(SM_C[0], SM_C[1], clamp01((p.getY(i) - 2.76) / 0.34));
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    laced.push({ geometry: g, color: 0xffffff });
    // A gilt moulding along the panel's top and base.
    const pts = []; const low = [];
    for (let i = 0; i <= 18; i++) {
      const th = mix(thF - half, thF + half, i / 18);
      pts.push(upper.pt(th, yH(th), 0.016));
      low.push(upper.pt(th, 2.77, 0.018));
    }
    G(rope(pts, 0.018, { sides: 6, steps: 26, pitch: 1 }));
    G(rope(low, 0.018, { sides: 6, steps: 26, pitch: 1 }));
    for (const th of [thF - 0.62, thF, thF + 0.62]) {
      const y = yH(th) - 0.045;
      G(stud(upper.pt(th, y, 0.015), upper.normal(th, y), 0.026, 0.015, 10));
    }
  }
  // Shoulder straps: lacquered arcs over the shoulder from breast to back, edged in gold.
  for (const sx of [-1, 1]) {
    const pts = [[sx * 0.44, 3.0, 0.38], [sx * 0.46, 3.17, 0.24], [sx * 0.47, 3.26, 0.0], [sx * 0.46, 3.17, -0.24], [sx * 0.44, 3.0, -0.38]];
    const rows = dense(pts.map((c) => sec(c, 0.11, 0.022, 0.022, { p: 3 })), 12);
    L(loft(rows, { sides: 10, ref: [0, 1, 0.001] }));
    G(stud([sx * 0.44, 3.02, 0.385], [0, 0.4, 1], 0.05, 0.02, 12));
    // Cords from the strap to the top of the shoulder guard.
    C(rope([[sx * 0.54, 3.2, 0.1], [sx * 0.7, 3.27, 0.14], [sx * 0.86, 3.3, 0.18]], 0.022, { sides: 6, steps: 10, pitch: 0.14 }));
    C(rope([[sx * 0.54, 3.2, -0.1], [sx * 0.7, 3.27, -0.14], [sx * 0.86, 3.3, -0.18]], 0.022, { sides: 6, steps: 10, pitch: 0.14 }));
  }
  // The waist: a silk sash, tied at the front.
  {
    const a = doSec(1.98, 1.1);
    const rowsY = [1.94, 2.0];
    for (const y of rowsY) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const [X, F] = secPoint(a, (i / 40) * Math.PI * 2);
        pts.push([X * 1.012, y, F * 1.012]);
      }
      C(rope(pts, 0.024, { sides: 6, steps: 70, pitch: 0.13, round: 0 }), 0xd7a431);
    }
    // The knot and its tails, which hang in front of the skirt.
    C(new THREE.SphereGeometry(0.07, 10, 8).scale(1.2, 0.9, 0.8).translate(0, 1.97, 0.53), 0xd7a431);
    for (const sx of [-1, 1]) {
      C(rope([[sx * 0.02, 1.96, 0.54], [sx * 0.08, 1.82, 0.6], [sx * 0.11, 1.68, 0.71], [sx * 0.13, 1.56, 0.82]], 0.022, { sides: 6, steps: 10, pitch: 0.13 }), 0xd7a431);
    }
  }
  // The agemaki: the great ornamental bow on the back, which ties the shoulder guards.
  {
    const c = [0, 2.92, -0.47];
    C(new THREE.SphereGeometry(0.07, 10, 8).translate(c[0], c[1], c[2]));
    for (const sx of [-1, 1]) {
      C(rope([c, [c[0] + sx * 0.18, c[1] + 0.12, c[2] - 0.03], [c[0] + sx * 0.3, c[1] + 0.02, c[2] - 0.04], [c[0] + sx * 0.17, c[1] - 0.06, c[2] - 0.03], c], 0.03, { sides: 6, steps: 18, pitch: 0.16 }));
      C(rope([c, [c[0] + sx * 0.1, c[1] - 0.18, c[2] - 0.03], [c[0] + sx * 0.18, c[1] - 0.4, c[2] - 0.03]], 0.03, { sides: 6, steps: 10, pitch: 0.16 }));
    }
  }

  // ---- the kusazuri: the skirt, seven panels, over the lid and down the chest's sides
  const panelPath = (edge, y0 = 1.92) => [[0.34, y0], [0.56, 1.75], [edge - 0.26, 1.66], [edge, 1.61], [edge + 0.03, 1.46], [edge + 0.045, 1.2], [edge + 0.05, 0.84]];
  const skirtCord = () => SILK;
  for (const end of [-0.76, 0, 0.76]) {
    lacedPanel(laced, panelPath(HD + 0.06), {
      d: [0, 1], lat: [1, 0],
      width: (s) => mix(0.5, 0.71, sstep(s, 0, 0.45)),
      shift: (s) => end * mix(0.55, 1, sstep(s, 0, 0.4)),
      rows: 5,
      cordOf: skirtCord,
    });
  }
  for (const sx of [-1, 1]) {
    lacedPanel(laced, panelPath(HW + 0.06), {
      d: [sx, 0], lat: [0, 1],
      width: (s) => mix(0.5, 1.15, sstep(s, 0, 0.5)),
      rows: 5,
      cordOf: skirtCord,
    });
  }
  for (const end of [-0.48, 0.48]) {
    lacedPanel(laced, panelPath(HD + 0.06), {
      d: [0, -1], lat: [1, 0],
      width: (s) => mix(0.5, 0.86, sstep(s, 0, 0.45)),
      shift: (s) => end * mix(0.55, 1, sstep(s, 0, 0.4)),
      rows: 5,
      cordOf: skirtCord,
    });
  }

  // ---- the sode: broad shoulder guards, seven rows under a lacquered head plate
  for (const sx of [-1, 1]) {
    const path = [[0.92, 3.3], [1.04, 2.98], [1.11, 2.56], [1.15, 2.1]];
    lacedPanel(laced, path, {
      d: [sx, 0], lat: [0, 1], width: (s) => mix(0.92, 1.02, s), rows: 7, curve: 0.035, cordOf: () => SILK, backing: lacq,
    });
    // The kanmuri-ita: a curved lacquer bar over the top row, with a gilt edge and rivets.
    const top = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10 - 0.5) * 2;
      top.push([sx * (0.925 + 0.045 * (1 - a * a)), 3.33 + 0.03 * (1 - a * a), a * 0.51]);
    }
    L(rope(top, 0.06, { sides: 8, steps: 14, pitch: 1, round: 2 }));
    G(rope(top.map(([x, y, z]) => [x + sx * 0.05, y + 0.02, z]), 0.014, { sides: 5, steps: 14, pitch: 1 }));
    for (const z of [-0.34, 0, 0.34]) G(stud([sx * (0.985 - Math.abs(z) * 0.05), 3.34, z], [sx, 0.3, 0], 0.03, 0.018, 10));
    // Its bottom edge in gilt, so that the guard has a finished line.
    const bottom = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10 - 0.5) * 2;
      bottom.push([sx * (1.165 + 0.03 * (1 - a * a)), 2.1, a * 0.5]);
    }
    G(rope(bottom, 0.012, { sides: 5, steps: 12, pitch: 1 }));
  }

  // ---- the kote: sleeves of dark cloth, iron splints sewn on, ending in a hand guard on the lid
  for (const sx of [-1, 1]) {
    const shoulder = [sx * 0.6, 3.1, 0]; const elbow = [sx * 0.8, 2.42, 0.1]; const wrist = [sx * 0.72, 1.86, 0.62]; const handEnd = [sx * 0.66, 1.72, 0.9];
    const sleeve = [shoulder, lerp3(shoulder, elbow, 0.5), elbow, lerp3(elbow, wrist, 0.5), wrist];
    cord.push({
      geometry: tinted(rope(sleeve, 0.14, { sides: 16, steps: 26, pitch: 0.34, radius: (t) => mix(0.17, 0.09, t) + 0.015 * Math.sin(t * 16) }), INDIGO),
      keepColor: true,
    });
    // Splints along the forearm: long lens plates with a gilt ring between each.
    for (let i = 0; i < 3; i++) {
      const t0 = 0.08 + i * 0.3; const t1 = t0 + 0.26;
      const a = lerp3(elbow, wrist, t0); const b = lerp3(elbow, wrist, t1);
      const rr = mix(0.135, 0.095, (t0 + t1) / 2);
      const out = [sx * 0.75, 0.55, 0.36];
      const offset = (p, k = 1) => [p[0] + out[0] * rr * k, p[1] + out[1] * rr * k, p[2] + out[2] * rr * k];
      lacq.push({ geometry: tinted(rope([offset(a), offset(lerp3(a, b, 0.5), 1.06), offset(b)], 0.035, { sides: 8, steps: 8, pitch: 1, radius: () => 0.033 }), BLACK), keepColor: true });
      G(stud(offset(a, 1.2), out, 0.022, 0.014, 6));
      G(stud(offset(b, 1.2), out, 0.022, 0.014, 6));
    }
    // The upper-arm splints, seen between the sleeve and the guard.
    for (const t of [0.35, 0.62, 0.86]) {
      const p = lerp3(shoulder, elbow, t);
      G(stud([p[0] + sx * 0.1, p[1], p[2] + 0.11], [sx * 0.65, 0, 0.75], 0.05, 0.026, 12));
    }
    // The cuff and the tekko: a dark hand plate lying on the lid, with its gilt rim and a finger guard.
    G(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14).applyMatrix4(alongQuat(wrist, handEnd)));
    const hand = dense([
      sec(wrist, 0.1, 0.07, 0.06, { p: 2.4 }),
      sec(lerp3(wrist, handEnd, 0.5), 0.135, 0.06, 0.05, { p: 2.6 }),
      sec(handEnd, 0.12, 0.05, 0.035, { p: 2.6 }),
      sec(lerp3(wrist, handEnd, 1.2), 0.06, 0.026, 0.02),
    ], 7);
    L(loft(hand, { sides: 14, ref: [0, 1, 0] }));
    G(stud([handEnd[0], handEnd[1] + 0.05, handEnd[2]], [0, 1, 0], 0.03, 0.015, 10));
    // Lacquered finger plates over a dark glove, so that it is a hand guard and not a lump.
    for (let f = 0; f < 4; f++) {
      const off = (f - 1.5) * 0.058;
      const a = [handEnd[0] + off, handEnd[1] + 0.015, handEnd[2] + 0.06];
      const b = [handEnd[0] + off * 1.1, handEnd[1] - 0.012, handEnd[2] + 0.2];
      const e = [handEnd[0] + off * 1.12, handEnd[1] - 0.05, handEnd[2] + 0.28];
      L(rope([a, b, e], 0.024, { sides: 6, steps: 7, pitch: 1 }));
      G(stud([b[0], b[1] + 0.022, b[2]], [0, 1, 0.2], 0.013, 0.009, 6));
    }
  }

  // ---- the suneate: two shin guards standing on the dais at the chest's front corners
  for (const sx of [-1, 1]) {
    const X = sx * 1.52;
    const Z = 0.42;
    const rows = dense([
      sec([X, 0.24, Z], 0.14, 0.13, 0.09),
      sec([X, 0.56, Z], 0.125, 0.125, 0.08),
      sec([X, 0.98, Z], 0.165, 0.16, 0.1),
      sec([X, 1.34, Z], 0.175, 0.165, 0.11),
      sec([X, 1.56, Z], 0.165, 0.14, 0.1),
    ], 12);
    L(loft(rows, { sides: 20 }));
    const host = hostOf(rows);
    // Splints: five long raised plates running the height, side by side, a gilt line between each and
    // a gilt rivet at each end. That is what makes it a shin guard rather than a tall black pot.
    for (let i = -2; i <= 2; i++) {
      const th = Math.PI / 2 + i * 0.52;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const y = mix(0.32, 1.42, k / 6);
        pts.push(host.pt(th, y, 0.006));
      }
      L(rope(pts, 0.05, { sides: 6, steps: 12, pitch: 1, radius: () => 0.034, round: 1 }));
      G(stud(host.pt(th, 0.4, 0.038), host.normal(th, 0.4), 0.014, 0.009, 5));
      G(stud(host.pt(th, 1.38, 0.038), host.normal(th, 1.38), 0.014, 0.009, 5));
      if (i < 2) {
        const th2 = th + 0.26;
        const gl = [];
        for (let k = 0; k <= 5; k++) gl.push(host.pt(th2, mix(0.3, 1.5, k / 5), 0.012));
        G(rope(gl, 0.009, { sides: 4, steps: 6, pitch: 1 }));
      }
    }
    // The silk ties at top and bottom, and a gilt rim.
    for (const y of [0.56, 1.2]) {
      const s0 = host.at(y);
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const [xx, ff] = secPoint(s0, (i / 24) * Math.PI * 2);
        const k = 1 + 0.22 * Math.max(0, Math.sin((i / 24) * Math.PI * 2));
        pts.push([X + xx * 1.1 * (1 + 0.1 * k), y, Z + ff * k * 1.1]);
      }
      C(rope(pts, 0.024, { sides: 6, steps: 34, pitch: 0.13, round: 0 }));
    }
    const rim = growSec(host.at(1.52), 0.02, [X, 1.52, Z]);
    G(loft([scaleSec(rim, 0.9, { c: [X, 1.56, Z] }), rim, growSec(rim, -0.002, [X, 1.48, Z]), scaleSec(rim, 0.9, { c: [X, 1.48, Z] })], { sides: 20 }));
    lacq.push({ geometry: new THREE.SphereGeometry(1, 16, 5).scale(rim.rx * 0.92, 0.016, (rim.rf + rim.rb) * 0.46).translate(X, 1.562, Z + (rim.rf - rim.rb) * 0.46), color: BLACK });
    // A small lacquered foot guard, as they stand on a shelf at the foot of a display.
    L(loft(dense([
      sec([X, 0.27, Z + 0.02], 0.15, 0.1, 0.03), sec([X, 0.27, Z + 0.2], 0.17, 0.11, 0.03), sec([X, 0.27, Z + 0.38], 0.15, 0.07, 0.03), sec([X, 0.27, Z + 0.52], 0.09, 0.04, 0.03),
    ], 6), { sides: 14, ref: [0, 1, 0] }));
  }

  // ---- the neck and the dark inside
  dark.push({ geometry: new THREE.CylinderGeometry(0.17, 0.22, 0.4, 16).translate(0, 3.34, 0), color: 0x060505 });
  dark.push({ geometry: new THREE.SphereGeometry(0.3, 18, 12).scale(0.84, 1.0, 0.94).translate(0, 3.72, 0.0), color: 0x050404 });

  // ---- the menpo: a dark mask from the nose down. Features of no one.
  const menpo = (u, v) => {
    const a = (u - 0.5) * 2;
    const bearing = a * 1.32;
    const y = mix(3.76, 3.4, v);
    const r = mix(0.262, 0.2, v * v) + 0.016;
    const nose = 0.082 * Math.exp(-((a / 0.2) ** 2)) * Math.exp(-(((v - 0.14) / 0.15) ** 2));
    const cheek = 0.022 * Math.exp(-(((Math.abs(a) - 0.62) / 0.22) ** 2)) * Math.exp(-(((v - 0.45) / 0.26) ** 2));
    const chin = 0.036 * Math.exp(-((a / 0.42) ** 2)) * Math.exp(-(((v - 0.85) / 0.17) ** 2));
    const mouth = -0.014 * Math.exp(-((a / 0.34) ** 2)) * Math.exp(-(((v - 0.56) / 0.035) ** 2));
    const rr = r + nose + cheek + chin + mouth;
    return [Math.sin(bearing) * rr * 0.98, y, Math.cos(bearing) * rr * 1.08];
  };
  lacq.push({
    geometry: paintVerts(outward(solidSurface({
      nu: 34,
      nv: 24,
      point: menpo,
      thick: (u, v) => 0.012 + Math.max(sstep(Math.abs(u - 0.5) * 2, 0.92, 1), sstep(1 - v, 0.95, 1)) * 0.007,
    })), (x, y, z, nx, ny, nz, out) => {
      // Dark, with the deep red lacquer that often shows along a mask's raised parts.
      // Black-lacquered iron, deliberately a neutral colour. Painted any warm brown, this shape stops
      // reading as an armour piece and starts reading as somebody's face, in a suit that must be empty.
      const lift = 0.7 + 0.3 * ny;
      const mouth = Math.exp(-(((y - 3.558) / 0.012) ** 2)) * sstep(0.17 - Math.abs(x), 0, 0.05);
      const k = lift * (1 - mouth * 0.85);
      out[0] = 0.04 * k; out[1] = 0.042 * k; out[2] = 0.048 * k;
    }),
    keepColor: true,
  });
  // A gilt rim along its upper edge.
  {
    const pts = [];
    const chin = [];
    for (let i = 0; i <= 20; i++) { pts.push(menpo(i / 20, 0)); chin.push(menpo(i / 20, 1)); }
    G(rope(pts, 0.011, { sides: 5, steps: 26, pitch: 1 }));
    G(rope(chin, 0.011, { sides: 5, steps: 26, pitch: 1 }));
    // The two gilt posts on the cheeks that the helmet's cords are tied round, a mask's own hardware.
    for (const u of [0.2, 0.8]) {
      const p = menpo(u, 0.42);
      const n = [p[0], 0, p[2]];
      G(stud(p, n, 0.03, 0.03, 8));
    }
  }
  // The yodarekake: rows of laced plates protecting the throat, hanging from the chin.
  lacedPanel(laced, [[0.2, 3.46], [0.27, 3.36], [0.33, 3.24], [0.37, 3.1]], {
    d: [0, 1], lat: [1, 0], width: (s) => mix(0.34, 0.52, s), rows: 3, curve: 0.03, cordOf: () => SILK,
  });

  // ---- the kabuto
  const KB0 = 3.98; const KBH = 0.62;
  {
    // Sixteen plates riveted into a ribbed bowl. The ribs are one surface, six samples each.
    const ROWS = 14; const SIDES = 96;
    const pos = []; const idx = [];
    const rAt = (t) => 0.49 * Math.pow(Math.cos(t * Math.PI * 0.46), 0.62) + 0.002;
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      const y = KB0 + KBH * Math.pow(t, 0.92);
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const rib = 1 + (0.03 * (1 - t * 0.6)) * (Math.pow(Math.abs(Math.cos(8 * a)), 0.5) - 0.5);
        const r = rAt(t) * rib;
        pos.push(Math.sin(a) * r, y, Math.cos(a) * r * 1.1);
      }
    }
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < SIDES; j++) {
        const j2 = (j + 1) % SIDES;
        idx.push(i * SIDES + j, i * SIDES + j2, (i + 1) * SIDES + j2, i * SIDES + j, (i + 1) * SIDES + j2, (i + 1) * SIDES + j);
      }
    }
    const pole = pos.length / 3; pos.push(0, KB0 + KBH + 0.02, 0);
    for (let j = 0; j < SIDES; j++) idx.push(pole, ROWS * SIDES + j, ROWS * SIDES + (j + 1) % SIDES);
    const poleB = pos.length / 3; pos.push(0, KB0, 0);
    for (let j = 0; j < SIDES; j++) idx.push(poleB, (j + 1) % SIDES, j);
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    L(outward(g), 0x241f1c);
    // Rows of rivets up the ribs, and the gilt ring round the hole at the crown.
    for (let j = 0; j < 16; j++) {
      const a = ((j + 0.0) / 16) * Math.PI * 2;
      const a2 = a; // a rib's crest
      for (const t of [0.14, 0.42]) {
        const y = KB0 + KBH * Math.pow(t, 0.92);
        const r = rAt(t) * 1.016;
        G(stud([Math.sin(a2) * r, y, Math.cos(a2) * r * 1.1], [Math.sin(a2), 0.35, Math.cos(a2)], 0.022, 0.016, 7));
      }
    }
    G(wrapLathe([[0, KB0 + KBH - 0.02], [0.13, KB0 + KBH - 0.04], [0.14, KB0 + KBH + 0.0], [0.1, KB0 + KBH + 0.035], [0.05, KB0 + KBH + 0.03], [0, KB0 + KBH + 0.01]], { segments: 18 }));
    // The band round the base, gilt along its lower edge.
    const baseRows = [[0.49, KB0 + 0.05], [0.505, KB0 + 0.04], [0.505, KB0 - 0.03], [0.49, KB0 - 0.05]];
    const band = wrapLathe([[0, KB0 + 0.05], ...baseRows, [0, KB0 - 0.05]], { segments: 44 });
    {
      const p = band.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * 1.1);
      band.computeVertexNormals();
    }
    L(band, 0x241f1c);
    const rimPts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      rimPts.push([Math.sin(a) * 0.512, KB0 - 0.035, Math.cos(a) * 0.512 * 1.1]);
    }
    G(rope(rimPts, 0.012, { sides: 5, steps: 60, pitch: 1, round: 0 }));
  }

  // The peak: a broad lacquered plate over the brow, its edge in gilt.
  const peak = (u, v) => {
    const a = (u - 0.5) * 2;
    const b = a * 1.25;
    const rr = mix(0.49, 0.72 - a * a * 0.2, v);
    const y = KB0 + 0.1 - v * 0.16 + (1 - a * a) * v * 0.06;
    return [Math.sin(b) * rr, y, Math.cos(b) * rr * 1.1];
  };
  L(outward(solidSurface({ nu: 24, nv: 3, point: peak, thick: () => 0.012 })));
  {
    const pts = [];
    for (let i = 0; i <= 20; i++) pts.push(peak(i / 20, 1));
    G(rope(pts, 0.013, { sides: 5, steps: 26, pitch: 1 }));
    // Its gilded ridge lines up the front of the bowl, a common decoration.
    for (const off of [-0.13, 0, 0.13]) {
      const up = [];
      for (let i = 0; i <= 5; i++) {
        const t = 0.08 + (i / 5) * 0.42;
        const y = KB0 + KBH * Math.pow(t, 0.92);
        const r = 0.49 * Math.pow(Math.cos(t * Math.PI * 0.46), 0.62) * 1.02;
        up.push([Math.sin(off) * r, y, Math.cos(off) * r * 1.1]);
      }
      G(rope(up, 0.012, { sides: 5, steps: 8, pitch: 1 }));
    }
  }

  // The shikoro: rows that flare widely over the neck and shoulders, gathered round from one side of
  // the face to the other, the top row's ends turned back as gilt-edged ears.
  {
    const ROWS = 5;
    const yAt = (i) => mix(4.0, 3.36, i / ROWS);
    const rAt = (i) => mix(0.47, 0.84, Math.pow(i / ROWS, 1.05));
    const SPAN = 2.05;
    for (let i = 0; i < ROWS; i++) {
      const y0 = yAt(i) + (i ? 0.03 : 0); const y1 = yAt(i + 1);
      const r0 = rAt(i) - (i ? 0.018 : 0); const r1 = rAt(i + 1);
      const g = solidSurface({
        nu: 26,
        nv: 2,
        point: (u, v) => {
          const b = Math.PI + (u - 0.5) * 2 * SPAN;
          const r = mix(r0, r1, v);
          return [Math.sin(b) * r, mix(y0, y1, v), Math.cos(b) * r * 1.06];
        },
        thick: () => 0.013,
      });
      const uv = g.attributes.uv;
      const bottom = i === ROWS - 1;
      const band = bottom ? SM_B : SM_A;
      const rep = Math.max(4, Math.round(((2 * SPAN * (r0 + r1)) / 2 / 0.45) * 0.5) * 2);
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * rep, smV(band, uv.getY(k)));
      laced.push({ geometry: tinted(outward(g), bottom ? 0xffffff : SILK), keepColor: true });
    }
    // The ears: turned back from the front ends, lacquered panels with gold rims.
    const earB = SPAN; // the bearing, from the back, at which the rows end
    for (const sx of [-1, 1]) {
      const b0 = Math.PI - sx * earB; // the row-end bearing on this side
      const ear = (u, v) => {
        // Out from the end of the top rows, flaring forward and away from the face.
        const y = mix(3.98, 3.42, v);
        const r0 = mix(0.47, 0.68, v);
        const start = [Math.sin(b0) * r0, y, Math.cos(b0) * r0 * 1.06];
        const k = u * 0.34 * mix(1, 0.86, v);
        return [start[0] + sx * k * 0.72, y + u * 0.012, start[2] - k * 0.62 + 0.0];
      };
      const g = solidSurface({ nu: 5, nv: 6, point: ear, thick: () => 0.016 });
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 0.75, mix(SM_C[0], SM_C[1], uv.getY(k)));
      laced.push({ geometry: outward(g), color: 0xffffff });
      const edge = [ear(1, 0), ear(1, 0.33), ear(1, 0.66), ear(1, 1), ear(0.5, 1), ear(0, 1)];
      G(rope(edge, 0.016, { sides: 6, steps: 18, pitch: 1 }));
      const top = [ear(0, 0), ear(0.5, 0), ear(1, 0)];
      G(rope(top, 0.016, { sides: 6, steps: 6, pitch: 1 }));
    }
  }

  // The crest: a gilt crescent, a lens in section, on a socket at the front of the bowl. Its bottom
  // sits on the helmet's brow; its horns reach to about 5.5ft.
  {
    const R = 0.74;
    const YC = KB0 + 0.22 + R;
    const Z = 0.585;
    const HORN = 2.05;
    const crescent = (u, v) => {
      const th = (u - 0.5) * 2 * HORN;
      const a = th / HORN;
      const w = 0.27 * Math.pow(1 - a * a, 0.72) + 0.004;
      const rr = R - (v - 0.5) * w - w / 2;
      return [Math.sin(th) * rr, YC - Math.cos(th) * rr, Z - (Math.abs(a) * 0.1)];
    };
    G(outward(solidSurface({
      nu: 42,
      nv: 2,
      point: crescent,
      thick: (u, v) => 0.018 * (1 - ((v - 0.5) * 2) ** 2) + 0.004,
    })), 0xd6aa42);
    G(wrapLathe([[0, 0.0], [0.05, 0.0], [0.05, 0.1], [0.08, 0.13], [0.06, 0.2], [0, 0.22]], { segments: 12 }).translate(0, KB0 + 0.1, 0.54).rotateX(0));
  }

  const lacedMesh = new THREE.Mesh(mergeParts(laced), new THREE.MeshStandardMaterial({ vertexColors: true, ...samuraiMaps(), roughness: 0.34, metalness: 0 }));
  lacedMesh.castShadow = true;
  lacedMesh.receiveShadow = true;
  return groupOf(
    lacedMesh,
    meshOf(lacq, { roughness: 0.2, metalness: 0 }),
    meshOf(gold, { roughness: 0.34, metalness: 0.45 }),
    meshOf(cord, { ...ropeMaps({ size: 48, plies: 2, strength: 1 }), roughness: 0.62, metalness: 0 }),
    meshOf(dark, { roughness: 1, metalness: 0 }),
  );
}

// A matrix laying a Y-authored cylinder along a to b, centred on a.
function alongQuat(a, b) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec(b).sub(vec(a)).normalize());
  return new THREE.Matrix4().compose(vec(a), q, new THREE.Vector3(1, 1, 1));
}

export const BUILDERS = {
  'inca-quipu': incaQuipu,
  'cuneiform-tablet': cuneiformTablet,
  trebuchet,
  'liberty-bell': libertyBell,
  'knight-armor': knightArmor,
  'samurai-armor': samuraiArmor,
};
