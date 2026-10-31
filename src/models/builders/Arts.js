// Builders for the Model Database's Arts entries: grand piano, violin, djembe, artist's easel.
//
// Every model here is an instrument of something a teacher can check, so the layouts are
// COMPUTED rather than approximated: the piano's 88 keys come from the chromatic scale starting
// on A, its 226 strings from the real single/double/triple stringing, the colour wheel from the
// twelve hues in their traditional order with each complementary pair six steps apart.
//
// The file runs on four private solids, each of which makes one class of gap impossible:
//   plateSolid  a closed plate with real holes and a bevelled edge (earcut caps, so an outline
//               need not be star-shaped: LoftKit's extrudeOutline fans from its centroid)
//   latheUp     a surface of revolution written bottom-up that always faces outward and whose
//               texture does not fold over at the seam (LoftKit's revolve wraps u backwards
//               across its last strip, and turns a bottom-up profile inside out)
//   polyTube    one closed tube through a list of points (LoftKit's tube is wound inward)
//   beam        a rounded bar from point to point with a fixed roll

import * as THREE from 'three';
import {
  mergeParts, solidLoft, sweepProfile, roundedOutline, weldSeam, smoothNoise3, solidSurface, outlineArea, tintGeometry,
} from '../../props/LoftKit.js';
import { seededRandom, canvasTexture, mesh, standard } from '../../PropKit.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ---------------------------------------------------------------------------
// Curves in the plane
// ---------------------------------------------------------------------------

// Catmull-Rom through 2D knots, `per` samples a span, endpoints included.
function spline2(knots, per = 6) {
  const curve = new THREE.CatmullRomCurve3(
    knots.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, 'centripetal',
  );
  const n = (knots.length - 1) * per;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

// Offset vectors for a closed loop: the mitre pointing LEFT of the direction of travel, which is
// into the material for a counter-clockwise outer loop AND for a clockwise hole.
function loopMitres(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    let ax = cx - px; let ay = cy - py;
    let bx = nx - cx; let by = ny - cy;
    const al = Math.hypot(ax, ay) || 1; const bl = Math.hypot(bx, by) || 1;
    ax /= al; ay /= al; bx /= bl; by /= bl;
    let mx = -(ay + by); let my = ax + bx;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-5) { mx = -ay; my = ax; } else { mx /= ml; my /= ml; }
    const cos = Math.max(0.4, mx * -ay + my * ax);
    out.push([mx / cos, my / cos]);
  }
  return out;
}

function offsetLoop(pts, d) {
  const m = loopMitres(pts);
  return pts.map(([x, y], i) => [x + m[i][0] * d, y + m[i][1] * d]);
}

// Rounds the corners of a polygon with little arcs of radius r.
function roundPoly(pts, r, steps = 3) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    const la = Math.hypot(p[0] - c[0], p[1] - c[1]);
    const lb = Math.hypot(q[0] - c[0], q[1] - c[1]);
    const k = Math.min(r, la * 0.45, lb * 0.45);
    const a = [c[0] + (p[0] - c[0]) * (k / la), c[1] + (p[1] - c[1]) * (k / la)];
    const b = [c[0] + (q[0] - c[0]) * (k / lb), c[1] + (q[1] - c[1]) * (k / lb)];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      out.push([
        u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      ]);
    }
  }
  return out;
}

const circlePts = (cx, cy, r, n = 24) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
};

// ---------------------------------------------------------------------------
// plateSolid: a closed plate, with holes, extruded along +Z
// ---------------------------------------------------------------------------

// `stack` is a list of [inset, z] rows from the back face to the front face. A positive inset
// pulls the edge into the material, so a bevel is one more row and a moulding a few more; a
// corner sharper than `crease` degrees keeps two columns of vertices and shades hard.
function plateSolid(outerIn, holesIn = [], stack = [[0, 0], [0, 1]], { crease = 34 } = {}) {
  const outer = outlineArea(outerIn) < 0 ? [...outerIn].reverse() : outerIn;
  const holes = holesIn.map((h) => (outlineArea(h) > 0 ? [...h].reverse() : h));
  const positions = [];
  const uvs = [];
  const indices = [];
  const creaseCos = Math.cos(THREE.MathUtils.degToRad(crease));

  const band = (loop) => {
    const n = loop.length;
    const mitres = loopMitres(loop);
    const cols = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
      const p = loop[(i - 1 + n) % n];
      const c = loop[i];
      const q = loop[(i + 1) % n];
      const ax = c[0] - p[0]; const ay = c[1] - p[1];
      const bx = q[0] - c[0]; const by = q[1] - c[1];
      const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
      if (i > 0) run += Math.hypot(ax, ay);
      cols.push({ i, run });
      if (cos < creaseCos) cols.push({ i, run, split: true });
    }
    // Rotate so the list begins just after a split, if it has one, then close it with a copy.
    const base = positions.length / 3;
    const rows = stack.length;
    const m = cols.length;
    for (let r = 0; r < rows; r++) {
      const [inset, z] = stack[r];
      for (let j = 0; j < m; j++) {
        const { i, run: u } = cols[j];
        positions.push(loop[i][0] + mitres[i][0] * inset, loop[i][1] + mitres[i][1] * inset, z);
        uvs.push(u, z);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < m; j++) {
        const k = (j + 1) % m;
        if (cols[k].split && cols[k].i === cols[j].i) continue; // the two copies of one corner
        const a = base + r * m + j;
        const b = base + r * m + k;
        const c = base + (r + 1) * m + k;
        const d = base + (r + 1) * m + j;
        indices.push(a, b, c, a, c, d);
      }
    }
  };
  band(outer);
  for (const h of holes) band(h);

  const cap = (row, up) => {
    const [inset, z] = stack[row];
    const contour = offsetLoop(outer, inset).map(([x, y]) => new THREE.Vector2(x, y));
    const holeLoops = holes.map((h) => offsetLoop(h, inset).map(([x, y]) => new THREE.Vector2(x, y)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holeLoops);
    const all = [...contour, ...holeLoops.flat()];
    const base = positions.length / 3;
    for (const p of all) { positions.push(p.x, p.y, z); uvs.push(p.x, p.y); }
    for (const [a, b, c] of faces) {
      const area = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);
      if ((area > 0) === up) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  };
  cap(0, false);
  cap(stack.length - 1, true);

  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A plate lying flat, written in plan: points are [x, z] in the model's own axes and the stack's
// second column is height y. rotateX(-90) sends (a, b, h) to (a, h, -b), which is why z is negated
// going in, and because it is a true rotation the winding survives.
function planSolid(ptsXZ, holesXZ, stack, options) {
  const flip = (loop) => loop.map(([x, z]) => [x, -z]);
  const g = plateSolid(flip(ptsXZ), holesXZ.map(flip), stack, options);
  g.rotateX(-Math.PI / 2);
  return g;
}

// A plate standing on its side, written in elevation: points are [z, y] and the stack's second
// column is x. rotateY(90) sends (a, b, h) to (h, b, -a).
function sideSolid(ptsZY, stack, options) {
  const g = plateSolid(ptsZY.map(([z, y]) => [-z, y]), [], stack, options);
  g.rotateY(Math.PI / 2);
  return g;
}

const edgeStack = (y0, y1, b = 0.012) => [[b, y0], [0, y0 + b], [0, y1 - b], [b, y1]];

// ---------------------------------------------------------------------------
// latheUp: a surface of revolution, bottom-up, always facing outward
// ---------------------------------------------------------------------------

// `profile` is [r, y] pairs read so that the solid is on your LEFT walking along it (bottom-up on
// an outer wall). Repeat a point to shade a hard edge there. A profile that starts and ends on the
// axis is a closed solid. `arcV` lays v along the profile's arc length, 0..1.
function latheUp(profile, { segments = 32, arcV = false, start = 0, sweep = Math.PI * 2 } = {}) {
  const rows = profile.length;
  const ring = segments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  let total = 0;
  const arc = [0];
  for (let i = 1; i < rows; i++) {
    total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    arc.push(total);
  }
  for (let i = 0; i < rows; i++) {
    const [r, y] = profile[i];
    for (let j = 0; j <= segments; j++) {
      const a = start + (j / segments) * sweep;
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uvs.push(j / segments, arcV ? arc[i] / (total || 1) : i / Math.max(1, rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
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
    for (let j = 0; j <= segments; j++) n.setXYZ(row * ring + j, 0, sign, 0);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Bars and tubes between points
// ---------------------------------------------------------------------------

const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// A capped cylinder from a to b.
function bar(a, b, r1, r2 = r1, sides = 10) {
  const A = v3(a);
  const B = v3(b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r2, r1, dir.length(), sides, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

// A rounded rectangular bar from a to b. `side` says which way its width runs (it is made square
// to the bar's axis), so a leg's flat can be turned to face somewhere on purpose.
function beam(a, b, w, d, { side = [1, 0, 0], r = 0.02, steps = 2 } = {}) {
  const A = v3(a);
  const B = v3(b);
  const axis = B.clone().sub(A);
  const length = axis.length();
  axis.normalize();
  const x = v3(side).addScaledVector(axis, -v3(side).dot(axis)).normalize();
  const y = new THREE.Vector3().crossVectors(axis, x).normalize();
  const outline = roundedOutline(w / 2, d / 2, Math.min(r, w * 0.45, d * 0.45), steps);
  const g = plateSolid(outline, [], [[0.004, 0], [0, 0.004], [0, length - 0.004], [0.004, length]], { crease: 60 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, axis).setPosition(A));
  return g;
}

// One closed tube through a list of points, on parallel-transported frames. `sides` can be as few
// as four, which is what makes two hundred piano strings affordable.
function polyTube(points, r, sides = 5, flat = 1) {
  const pts = points.map(v3);
  const radius = (i) => (Array.isArray(r) ? r[i] : r);
  const positions = [];
  const indices = [];
  let ref = new THREE.Vector3(0, 1, 0);
  const rows = pts.length;
  for (let i = 0; i < rows; i++) {
    const t = new THREE.Vector3();
    if (i < rows - 1) t.add(pts[i + 1].clone().sub(pts[i]).normalize());
    if (i > 0) t.add(pts[i].clone().sub(pts[i - 1]).normalize());
    t.normalize();
    if (Math.abs(t.dot(ref)) > 0.995) ref = new THREE.Vector3(1, 0, 0);
    const b = new THREE.Vector3().crossVectors(t, ref).normalize();
    const n = new THREE.Vector3().crossVectors(b, t).normalize();
    ref = n;
    const rr = radius(i);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a) * rr * flat;
      const s = Math.sin(a) * rr;
      positions.push(pts[i].x + b.x * c + n.x * s, pts[i].y + b.y * c + n.y * s, pts[i].z + b.z * c + n.z * s);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const p = i * sides + j;
      const q = i * sides + k;
      const u = (i + 1) * sides + k;
      const v = (i + 1) * sides + j;
      indices.push(p, u, q, p, v, u);
    }
  }
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j, j + 1);
    const base = (rows - 1) * sides;
    indices.push(base, base + j + 1, base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

// LoftKit's sweepProfile winds its sides INWARD for a counter-clockwise profile, measured: the
// profile turns about -tangent in its (binormal, normal) frame. Every sweep here goes through this,
// which measures the result and turns it the right way out.
const sweep = (points, profile, options) => ensureOutward(sweepProfile(points, profile, options));

// A rope through a list of points, one ring per point, with its normals taken from the frame rather
// than computed and its UV running along its length so a lay can be mapped on to it. Closed, the
// frame's accumulated twist is spread evenly round the loop so the last ring meets the first.
function ropeRun(points, r, { sides = 6, closed = false, uvScale = 5 } = {}) {
  const pts = points.map(v3);
  const n = pts.length;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const frames = [];
  let ref = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const t = next.clone().sub(prev).normalize();
    if (Math.abs(t.dot(ref)) > 0.995) ref = new THREE.Vector3(1, 0, 0).cross(t).normalize();
    const b = new THREE.Vector3().crossVectors(t, ref).normalize();
    const m = new THREE.Vector3().crossVectors(b, t).normalize();
    ref = m;
    frames.push({ b, m, t });
  }
  let twist = 0;
  if (closed) {
    const last = frames[n - 1];
    const first = frames[0];
    const carried = last.m.clone().addScaledVector(first.t, -last.m.dot(first.t)).normalize();
    twist = Math.atan2(carried.dot(first.b), carried.dot(first.m));
  }
  let run = 0;
  const rows = closed ? n + 1 : n;
  for (let i = 0; i < rows; i++) {
    const k = i % n;
    if (i > 0) run += pts[k].distanceTo(pts[(i - 1) % n]);
    const { b, m } = frames[k];
    const off = closed ? (twist * i) / n : 0;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2 + off;
      const c = Math.cos(a);
      const q = Math.sin(a);
      const nx = b.x * c + m.x * q;
      const ny = b.y * c + m.y * q;
      const nz = b.z * c + m.z * q;
      positions.push(pts[k].x + nx * r, pts[k].y + ny * r, pts[k].z + nz * r);
      normals.push(nx, ny, nz);
      uvs.push(run * uvScale, j / sides);
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const d = (i + 1) * ring + j;
      const c = d + 1;
      indices.push(a, c, b, a, d, c);
    }
  }
  if (!closed) {
    for (const [row, flip] of [[0, false], [n - 1, true]]) {
      const base = row * ring;
      for (let j = 1; j < sides - 1; j++) {
        if (flip) indices.push(base, base + j + 1, base + j);
        else indices.push(base, base + j, base + j + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

// A flat colour part with a shading function: tint supplies the colour, because a tint multiplies
// and a merged part with no colour of its own starts from white.
const painted = (geometry, fn, extra = {}) => ({ geometry, keepColor: true, tint: fn, ...extra });
const flat = (geometry, color, extra = {}) => ({ geometry, color, ...extra });

function group(meshes, name) {
  const g = new THREE.Group();
  g.name = name;
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// GRAND PIANO
// ---------------------------------------------------------------------------

// The keyboard, computed. An 88-key piano is the chromatic scale from A0 to C8. Everything about
// the pattern -- 52 white, 36 black, a group of two and a group of three each octave, the lone
// A sharp at the bottom and the bare top C -- falls out of this one table, so the model cannot
// disagree with the fact on its card.
const CHROMATIC_FROM_A = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
// How far a black key sits from the crack between its two white keys, in black-key widths. Real
// keyboards spread each group apart a little, which is why they do not look like a ruler.
const BLACK_SHIFT = { 'C#': -0.2, 'D#': 0.2, 'F#': -0.26, 'G#': 0, 'A#': 0.26 };

export function pianoKeyLayout() {
  const keys = [];
  let white = 0;
  for (let n = 0; n < 88; n++) {
    const name = CHROMATIC_FROM_A[n % 12];
    const black = name.length === 2;
    keys.push({ n: n + 1, name, black, slot: white });
    if (!black) white += 1;
  }
  return keys;
}

const WHITE_W = 0.0771; // 23.5mm, an octave of 165mm
const BLACK_W = 0.046;
const WHITE_COUNT = 52;
const KB_HALF = (WHITE_W * WHITE_COUNT) / 2;

const RIM_LOW = 2.02;
const RIM_HIGH = 3.24;
const PLATE_LOW = 2.86;
const PLATE_TOP = 2.93;
const BOARD_TOP = 2.66;
const CAPO_Z = 2.42;
const TENOR_Y = 2.985;
const BASS_Y = 3.038;

// The case in plan, from the treble front corner back down the bentside's S curve, round the tail
// and up the straight spine. Bass is on the player's left, which is -X.
function pianoPlan() {
  const FRONT = 3.6;
  const bent = spline2([
    [2.575, FRONT], [2.575, 2.7], [2.545, 1.55], [2.28, 0.55], [1.72, -0.25], [0.96, -1.05],
    [0.46, -2.0], [0.12, -3.0], [-0.06, -3.75], [-0.4, -4.27], [-0.92, -4.49], [-1.4, -4.5],
  ], 7).map(([x, z]) => [Math.min(x, 2.575), z]);
  const tail = spline2([[-1.4, -4.5], [-2.2, -4.5], [-2.44, -4.47], [-2.56, -4.34], [-2.575, -4.1]], 4).slice(1);
  return [...bent, ...tail, [-2.575, FRONT]];
}

function buildNoteStrings() {
  const out = [];
  for (let n = 1; n <= 88; n++) out.push({ n, count: n <= 10 ? 1 : n <= 28 ? 2 : 3 });
  return out;
}

const speakingLength = (n) => 0.18 * 1.85 ** ((88 - n) / 12);
const tenorX = (n) => -0.85 + ((n - 29) / 59) * 2.8;
const tenorRearX = (n) => tenorX(n) + 0.05 * speakingLength(n);

function polyInterp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return lerp(y0, y1, (x - x0) / ((x1 - x0) || 1));
    }
  }
  return table[table.length - 1][1];
}

function sheetMusicTexture() {
  return canvasTexture(640, 460, (ctx, w, h) => {
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2b2620';
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillText('Ode to Joy', w / 2, 44);
    ctx.font = 'italic 18px Georgia, serif';
    ctx.fillText('Ludwig van Beethoven', w / 2, 68);
    // The tune itself, four bars a line, written correctly: the last thing a music teacher should
    // find on a piano's desk is a stave of random blobs.
    const lines = [
      [['E', 'E', 'F', 'G'], ['G', 'F', 'E', 'D'], ['C', 'C', 'D', 'E'], ['E.', 'D8', 'D2']],
      [['E', 'E', 'F', 'G'], ['G', 'F', 'E', 'D'], ['C', 'C', 'D', 'E'], ['D.', 'C8', 'C2']],
    ];
    const step = { C: -2, D: -1, E: 0, F: 1, G: 2 }; // half-spaces above the bottom line (E4)
    const gap = 13;
    lines.forEach((bars, li) => {
      const top = 110 + li * 170;
      const bottom = top + gap * 4;
      const left = 44;
      const right = w - 36;
      ctx.strokeStyle = '#2b2620';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(left, top + i * gap);
        ctx.lineTo(right, top + i * gap);
        ctx.stroke();
      }
      // A treble clef drawn as a curve, curling round the G line.
      const gy = top + 3 * gap;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(left + 22, top - 13);
      ctx.bezierCurveTo(left + 32, top + 8, left + 2, gy - 12, left + 6, gy + 6);
      ctx.bezierCurveTo(left + 10, gy + 24, left + 34, gy + 20, left + 30, gy);
      ctx.bezierCurveTo(left + 28, gy - 14, left + 12, gy - 12, left + 13, gy + 2);
      ctx.moveTo(left + 22, top - 13);
      ctx.bezierCurveTo(left + 14, top - 24, left + 12, top + 2, left + 21, top + 34);
      ctx.lineTo(left + 25, bottom + 12);
      ctx.bezierCurveTo(left + 26, bottom + 22, left + 12, bottom + 22, left + 13, bottom + 12);
      ctx.stroke();
      ctx.font = 'bold 20px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('4', left + 52, top + gap * 1.65);
      ctx.fillText('4', left + 52, top + gap * 3.65);
      const barWidth = (right - left - 72) / 4;
      bars.forEach((notes, b) => {
        const bx = left + 72 + b * barWidth;
        const cells = { 3: [0, 0.375, 0.5, 0.75], 4: [0, 0.25, 0.5, 0.75] }[notes.length];
        notes.forEach((raw, i) => {
          const pitch = raw[0];
          const y = bottom - (step[pitch] * gap) / 2;
          const x = bx + 16 + cells[i] * (barWidth - 22);
          const half = raw.endsWith('2');
          ctx.lineWidth = half ? 2 : 1;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-0.34);
          ctx.beginPath();
          ctx.ellipse(0, 0, 7.4, 5, 0, 0, Math.PI * 2);
          if (half) ctx.stroke(); else ctx.fill();
          ctx.restore();
          if (pitch === 'C') { // a ledger line under middle C
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(x - 12, y);
            ctx.lineTo(x + 12, y);
            ctx.stroke();
          }
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(x + 6.6, y - 2);
          ctx.lineTo(x + 6.6, y - 38);
          ctx.stroke();
          if (raw.endsWith('.')) {
            ctx.beginPath();
            ctx.arc(x + 13, y - 3, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          if (raw.endsWith('8')) {
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x + 6.6, y - 38);
            ctx.quadraticCurveTo(x + 18, y - 28, x + 15, y - 16);
            ctx.stroke();
          }
        });
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(bx + barWidth, top);
        ctx.lineTo(bx + barWidth, bottom);
        ctx.stroke();
      });
    });
  });
}

function spruceTexture() {
  const size = 384;
  const canvas = canvasTexture(size, size, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    const d = image.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        // Vertical grain lines, tileable because every frequency is a whole number of cycles.
        const wob = Math.sin(((y / h) * Math.PI * 2) + u * 6) * 0.004;
        const g = 0.5 + 0.5 * Math.sin((u + wob) * Math.PI * 2 * 26);
        const fine = 0.5 + 0.5 * Math.sin((u + wob) * Math.PI * 2 * 71);
        const v = 244 + 8 * (1 - g) - 16 * fine ** 8 - 26 * g ** 22;
        const i = (y * w + x) * 4;
        d[i] = v; d[i + 1] = v - 3; d[i + 2] = v - 8; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  canvas.wrapS = THREE.RepeatWrapping;
  canvas.wrapT = THREE.RepeatWrapping;
  return canvas;
}

export function grandPiano() {
  const lacquer = [];
  const gold = [];
  const wire = [];
  const timber = [];
  const ivory = [];

  const BLACK = lin(0x323236);
  const gloss = (p) => {
    // There is no environment map anywhere in this app, so lacquer has nothing to reflect: only
    // the sun can put a highlight on it. A painted sheen, lighter toward each moulding where the
    // real thing catches the sky, is what keeps a black case from reading as a hole in the world.
    const lift = 0.92 + 0.5 * smooth(2.9, 3.22, p.y) + 0.34 * (1 - smooth(2.02, 2.2, p.y)) + 1.3 * Math.exp(-(((p.y - 2.8) / 0.14) ** 2)) * (1 - smooth(2.3, 3.2, p.z));
    return [BLACK[0] * lift, BLACK[1] * lift, BLACK[2] * lift * 1.03];
  };

  // --- plan ------------------------------------------------------------------------------
  const outer = pianoPlan();
  const inner = offsetLoop(outer.map(([x, z]) => [x, -z]), 0.22).map(([x, z]) => [x, -z]);
  // z of the inner rim as a function of x, for everything that has to stand off the bentside.
  const rimTable = inner
    .filter(([, z]) => z < 3.3)
    .map(([x, z]) => [x, z])
    .sort((a, b) => a[0] - b[0]);
  const rimZ = (x) => polyInterp(rimTable, x);

  // --- the case --------------------------------------------------------------------------
  lacquer.push(painted(planSolid(outer, [inner], [
    [0.014, RIM_LOW], [0, RIM_LOW + 0.014], [0, RIM_LOW + 0.05], [0, 2.55], [0, 2.7], [0, 2.8], [0, 2.9], [0, 3.05], [0, 3.13],
    [-0.012, 3.155], [-0.012, 3.185], [0.006, 3.225], [0.028, RIM_HIGH],
  ]), gloss));
  timber.push(flat(planSolid(offsetLoop(inner.map(([x, z]) => [x, -z]), -0.03).map(([x, z]) => [x, -z]), [], edgeStack(2.05, 2.1, 0.004)), 0x4a3524));

  // Beams radiating under the belly, the way the underside of a real one is braced.
  for (const [a, b] of [
    [[-2.35, 1.95, 2.5], [1.9, 1.95, 2.5]],
    [[-2.2, 1.95, 2.2], [-1.2, 1.95, -3.7]],
    [[0, 1.95, 2.3], [-0.9, 1.95, -3.2]],
    [[1.7, 1.95, 2.3], [0.5, 1.95, -1.1]],
  ]) timber.push(flat(beam(a, b, 0.2, 0.17, { side: [0, 1, 0] }), 0x3a2a1d));

  // The keybed and the rails at the player's knees.
  lacquer.push(painted(planSolid([[-2.57, 4.47], [2.57, 4.47], [2.57, 3.42], [-2.57, 3.42]], [], edgeStack(RIM_LOW + 0.006, 2.33, 0.012)), gloss));
  lacquer.push(painted(sideSolid([[4.5, 2.2], [4.5, 2.37], [4.475, 2.385], [4.43, 2.385], [4.415, 2.36], [4.41, 2.2]],
    [[0, -KB_HALF - 0.02], [0, KB_HALF + 0.02]]), gloss));

  // The arms: an S falling from the rim down to the cheek block beside the lowest key.
  const armProfile = [
    [3.4, 2.04], [4.51, 2.04], [4.51, 2.5],
    ...spline2([[4.505, 2.5], [4.47, 2.62], [4.34, 2.67], [4.15, 2.7], [4.0, 2.82], [3.86, 3.04], [3.72, 3.2], [3.56, 3.244], [3.4, 3.244]], 5),
  ];
  for (const sign of [-1, 1]) {
    // Three thousandths proud of the rim, because two coplanar glossy faces z-fight into a patch of
    // dark speckle exactly where the eye goes: the corner of the case.
    const a = sign < 0 ? -2.578 : KB_HALF + 0.004;
    const b = sign < 0 ? -KB_HALF - 0.004 : 2.578;
    // Its big faces carry vertices only at their outline, so a height-based sheen would smear across
    // them; a flat lift that matches the rim beside it is what hides the join.
    lacquer.push(painted(sideSolid(armProfile, [[0.012, a], [0, a + 0.012], [0, b - 0.012], [0.012, b]]), () => [BLACK[0] * 0.98, BLACK[1] * 0.98, BLACK[2] * 1.01]));
  }

  // The fallboard, curving back from the key tops.
  const fall = [
    ...spline2([[3.945, 2.43], [3.94, 2.6], [3.88, 2.84], [3.76, 3.03], [3.6, 3.17], [3.46, 3.21]], 7),
    [3.42, 2.4], [3.945, 2.4],
  ];
  lacquer.push(painted(sideSolid(fall, [[0, -KB_HALF - 0.012], [0, KB_HALF + 0.012]]), (p) => {
    const k = 0.95 + 0.9 * smooth(3.0, 3.2, p.y);
    return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k];
  }));
  // A thread of brass let into the fallboard, and the red felt where the keys go under it.
  gold.push(flat(sideSolid(circlePts(3.767, 3.03, 0.008, 6), [[0, -0.7], [0, 0.7]]), 0xd8b35a));
  timber.push(flat(sideSolid([[3.955, 2.425], [3.955, 2.47], [3.935, 2.47], [3.935, 2.425]], [[0, -KB_HALF - 0.01], [0, KB_HALF + 0.01]]), 0x6f161b));

  // --- legs, casters, lyre ---------------------------------------------------------------
  const legProfile = (top) => [
    [0, 0.19], [0.085, 0.19], [0.085, 0.3], [0.098, 0.31], [0.098, 0.335],
    ...spline2([[0.09, 0.345], [0.098, 0.6], [0.125, 0.88], [0.15, 1.1], [0.165, 1.28], [0.15, 1.42], [0.128, 1.5]], 4),
    [0.128, 1.5],
    ...spline2([[0.128, 1.5], [0.17, 1.53], [0.182, 1.57], [0.17, 1.61], [0.135, 1.64]], 3),
    [0.135, 1.64],
    ...spline2([[0.135, 1.64], [0.15, 1.71], [0.2, 1.76], [0.235, 1.8]], 3),
    [0.235, 1.8], [0.235, top], [0, top],
  ];
  const brassBelow = 0.338;
  const LEGS = [[-2.2, 3.72], [2.2, 3.72], [-1.5, -3.4]];
  for (const [x, z] of LEGS) {
    const geo = latheUp(legProfile(2.1), { segments: 22 });
    const part = painted(geo, (p) => {
      if (p.y < brassBelow) return lin(0xd2ab55);
      const r = Math.hypot(p.x, p.z);
      const k = 0.85 + 2.2 * smooth(0.13, 0.19, r);
      return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k];
    }, { position: [x, 0, z] });
    lacquer.push(part);
    // The caster: a wheel in a fork, turned a little off straight the way they settle.
    const yaw = x * 0.4;
    const wheel = new THREE.CylinderGeometry(0.095, 0.095, 0.075, 18).rotateZ(Math.PI / 2).translate(0, 0.095, 0).rotateY(yaw).translate(x, 0, z);
    gold.push(flat(wheel, 0xcaa24e));
    for (const s of [-1, 1]) {
      const cx = Math.cos(yaw) * s * 0.06;
      const cz = -Math.sin(yaw) * s * 0.06;
      gold.push(flat(bar([x + cx, 0.095, z + cz], [x + cx * 0.75, 0.24, z + cz * 0.75], 0.022, 0.03, 8), 0xb99346));
    }
    gold.push(flat(new THREE.CylinderGeometry(0.075, 0.09, 0.05, 18).translate(x, 0.215, z), 0xc9a24f));
  }

  // The lyre: two turned posts, a pedal box, three brass pedals and the braces behind it.
  const LY_Z = 3.05;
  const LY_TOP = 2.05;
  for (const x of [-0.27, 0.27]) {
    const post = latheUp([
      [0, 0.5], [0.075, 0.5], [0.075, 0.56],
      ...spline2([[0.05, 0.6], [0.064, 0.85], [0.08, 1.1], [0.064, 1.35], [0.05, 1.7]], 4),
      [0.075, 1.74], [0.075, 1.8], [0.05, 1.82], [0.05, LY_TOP], [0, LY_TOP],
    ], { segments: 16 });
    lacquer.push(painted(post, gloss, { position: [x, 0, LY_Z] }));
  }
  lacquer.push(painted(planSolid(roundPoly([[-0.43, LY_Z + 0.15], [0.43, LY_Z + 0.15], [0.43, LY_Z - 0.15], [-0.43, LY_Z - 0.15]], 0.05), [],
    [[0.014, 0.25], [0, 0.265], [0, 0.49], [0.018, 0.51]]), gloss));
  lacquer.push(painted(planSolid(roundPoly([[-0.4, LY_Z + 0.12], [0.4, LY_Z + 0.12], [0.4, LY_Z - 0.12], [-0.4, LY_Z - 0.12]], 0.05), [], edgeStack(1.78, 2.06, 0.012)), gloss));
  lacquer.push(painted(bar([-0.3, 0.42, LY_Z - 0.08], [-0.42, 2.06, LY_Z - 1.1], 0.03, 0.03, 8), gloss));
  lacquer.push(painted(bar([0.3, 0.42, LY_Z - 0.08], [0.42, 2.06, LY_Z - 1.1], 0.03, 0.03, 8), gloss));
  for (const x of [-0.19, 0, 0.19]) {
    gold.push(painted(solidLoft([
      { d: LY_Z + 0.08, w: 0.024, h: 0.016, b: 0.34, round: 0.8 },
      { d: LY_Z + 0.26, w: 0.026, h: 0.014, b: 0.3, round: 0.8 },
      { d: LY_Z + 0.4, w: 0.05, h: 0.013, b: 0.255, round: 0.6 },
      { d: LY_Z + 0.52, w: 0.075, h: 0.016, b: 0.24, round: 0.45 },
      { d: LY_Z + 0.6, w: 0.06, h: 0.012, b: 0.26, round: 0.6 },
    ], { sides: 12, samples: 10 }), () => lin(0xd6b05a), { position: [x, 0, 0] }));
  }

  // --- soundboard, bridges, felt ---------------------------------------------------------
  const boardGeo = planSolid(offsetLoop(inner.map(([x, z]) => [x, -z]), -0.03).map(([x, z]) => [x, -z]), [], edgeStack(2.58, BOARD_TOP, 0.002));
  { // Grain at about 40 degrees to the spine, as the panel is really laid.
    const uv = boardGeo.attributes.uv;
    const pos = boardGeo.attributes.position;
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    for (let i = 0; i < uv.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      uv.setXY(i, (x * c + z * s) * 0.62, (-x * s + z * c) * 0.1);
    }
  }
  timber.push(painted(boardGeo, (p) => {
    const k = 0.96 + 0.08 * smoothNoise3(p.x * 1.4, 0.2, p.z * 0.9);
    const c = lin(0xd9b27a);
    return [c[0] * k, c[1] * k, c[2] * k];
  }));

  // Tenor and treble: one speaking length per note, shrinking toward the top. The bridge is simply
  // where those lengths end, which is why it curves the way it does.
  const noteList = [];
  for (let n = 29; n <= 88; n++) noteList.push(n);
  const bridgeTable = noteList.map((n) => [tenorRearX(n), CAPO_Z - speakingLength(n)]);
  const bridgeZ = (x) => polyInterp(bridgeTable, x);
  const bridgeLine = noteList.filter((n) => n % 2 === 1 || n === 88).map((n) => [tenorRearX(n), BOARD_TOP - 0.01, CAPO_Z - speakingLength(n)]);
  const barSection = (hw, h) => [[-hw, 0], [hw, 0], [hw, h - 0.015], [hw * 0.6, h], [-hw * 0.6, h], [-hw, h - 0.015]];
  timber.push(flat(sweep(bridgeLine, barSection(0.05, TENOR_Y - 0.004 - (BOARD_TOP - 0.01)), { samples: 80 }), 0xb78a52));

  // Bass: fewer, heavier strings on a bridge of their own, crossing over the tenor at a slant.
  // Laid out per STRING rather than per note, since notes 1-10 carry one and 11-28 carry two.
  const bassMid = (n) => (n <= 10 ? n - 1 : 10 + (n - 11) * 2 + 0.5);
  const bassPinX = (n) => -2.18 + (bassMid(n) / 45) * 1.18;
  const bassRearX = (n) => -1.78 + (bassMid(n) / 45) * 1.56;
  const bassBridgeZ = (x) => rimZ(x) + 0.47;
  const bassHitchZ = (x) => rimZ(x) + 0.22;
  const bassBridge = [];
  for (let n = 1; n <= 28; n += 3) bassBridge.push([bassRearX(n), BOARD_TOP - 0.01, bassBridgeZ(bassRearX(n))]);
  bassBridge.push([bassRearX(28), BOARD_TOP - 0.01, bassBridgeZ(bassRearX(28))]);
  timber.push(flat(sweep(bassBridge, barSection(0.05, BASS_Y - 0.012 - (BOARD_TOP - 0.01)), { samples: 30 }), 0xb78a52));

  // --- the iron frame --------------------------------------------------------------------
  const strutLines = {
    s1: (z) => -1.15 + (2.3 - z) * 0.1,
    s2: (z) => -0.22 + (2.3 - z) * 0.1,
    s3: (z) => 0.5 + (2.3 - z) * 0.08,
    s4: (z) => 1.14 + (2.3 - z) * 0.05,
  };
  const HW = 0.075;
  const hitchFront = (x) => bridgeZ(x) - 0.13;
  const hitchRear = (x) => bridgeZ(x) - 0.33;
  const rearEdge = (x) => rimZ(x) + 0.28 + 0.5 * (1 - smooth(-0.55, -0.1, x));
  const bassBarEdge = (x) => bassBridgeZ(x) + 0.28;

  // A cell of the frame: between two strut lines in x, and between two curves in z.
  const cell = (xLeft, xRight, zFront, zRear, r = 0.07) => {
    const solve = (line, curve) => {
      let x = line(curve(line(0)));
      for (let i = 0; i < 12; i++) x = line(curve(x));
      return x;
    };
    const fl = solve(xLeft, zFront);
    const fr = solve(xRight, zFront);
    const rl = solve(xLeft, zRear);
    const rr = solve(xRight, zRear);
    const sample = (a, b, curve) => {
      const out = [];
      const n = Math.max(3, Math.ceil(Math.abs(b - a) / 0.14));
      for (let i = 0; i <= n; i++) {
        const x = lerp(a, b, i / n);
        out.push([x, curve(x)]);
      }
      return out;
    };
    const poly = [...sample(fl, fr, zFront), ...sample(rr, rl, zRear)];
    return roundPoly(poly.map(([x, z]) => [x, -z]), r, 2).map(([x, z]) => [x, -z]);
  };
  const line = (fn, off) => (z) => fn(z) + off;
  const flatZ = (v) => () => v;
  const holes = [];
  const FRONT_OPEN = 2.3;
  // The bass side: a long window under the crossing strings, split by a cross bar.
  holes.push(cell(() => -2.12, line(strutLines.s1, -HW), flatZ(FRONT_OPEN), flatZ(-0.72)));
  holes.push(cell(() => -2.12, line(strutLines.s1, -HW), flatZ(-0.92), (x) => bassBarEdge(x)));
  // The speaking windows between the capo and the bridge.
  const speaking = (a, b) => cell(a, b, flatZ(FRONT_OPEN), (x) => bridgeZ(x) - 0.075, 0.05);
  holes.push(speaking(line(strutLines.s1, HW), line(strutLines.s2, -HW)));
  holes.push(speaking(line(strutLines.s2, HW), line(strutLines.s3, -HW)));
  holes.push(speaking(line(strutLines.s3, HW), line(strutLines.s4, -HW)));
  // Behind the hitch rail, between it and the rim.
  const behind = (a, b) => cell(a, b, hitchRear, (x) => Math.max(rearEdge(x), x < -0.3 ? bassBarEdge(x) : -99));
  holes.push(behind(line(strutLines.s1, HW), line(strutLines.s2, -HW)));
  holes.push(behind(line(strutLines.s2, HW), line(strutLines.s3, -HW)));
  holes.push(behind(line(strutLines.s3, HW), line(strutLines.s4, -HW)));
  holes.push(cell(line(strutLines.s4, HW), () => 2.1, hitchRear, rearEdge));
  // The narrow slot the bass bridge stands in.
  holes.push(cell(() => -2.08, () => bassRearX(28) + 0.07, (x) => bassBridgeZ(x) + 0.12, (x) => rimZ(x) + 0.3, 0.05));
  // Lightening holes cast in the solid treble corner.
  for (const [x, z, r] of [[1.86, 3.05, 0.11], [1.36, 3.08, 0.09], [0.86, 3.1, 0.09], [0.36, 3.1, 0.09], [-0.14, 3.1, 0.09], [-0.64, 3.1, 0.09], [-1.14, 3.1, 0.09], [-1.64, 3.08, 0.09]]) {
    holes.push(circlePts(x, z, r, 18));
  }

  const plateOuter = offsetLoop(inner.map(([x, z]) => [x, -z]), -0.04).map(([x, z]) => [x, -z]);
  const plateGeo = planSolid(plateOuter, holes, [
    [0.006, PLATE_LOW], [0, PLATE_LOW + 0.006], [0, PLATE_TOP - 0.012], [0.01, PLATE_TOP - 0.002], [0.016, PLATE_TOP],
  ]);
  const GOLD = lin(0xc79f45);
  gold.push(painted(plateGeo, (p) => {
    const n = smoothNoise3(p.x * 2.2, 1.7, p.z * 2.2);
    const k = 0.92 + 0.16 * n;
    return [GOLD[0] * k, GOLD[1] * k, GOLD[2] * k];
  }));

  // Rails the strings bear on, and domed bolts down the struts.
  gold.push(flat(planSolid([[-0.93, CAPO_Z + 0.05], [2.18, CAPO_Z + 0.05], [2.18, CAPO_Z - 0.05], [-0.93, CAPO_Z - 0.05]], [], edgeStack(PLATE_TOP - 0.01, TENOR_Y - 0.003, 0.008)), 0xd2ad58));
  gold.push(flat(planSolid([[-2.26, 2.79], [-0.95, 2.79], [-0.95, 2.69], [-2.26, 2.69]], [], edgeStack(PLATE_TOP - 0.01, BASS_Y - 0.012, 0.008)), 0xd2ad58));
  const boltSpots = [];
  for (const fn of Object.values(strutLines)) {
    for (const z of [2.12, 1.1, 0.1, -0.9]) boltSpots.push([fn(z), z]);
  }
  for (const [x, z] of outer.filter((_, i) => i % 9 === 0)) {
    const inX = x * 0.91;
    boltSpots.push([inX, z * 0.95]);
  }
  for (const [x, z] of boltSpots) {
    if (rimZ(x) > z - 0.1) continue;
    gold.push(flat(new THREE.SphereGeometry(0.038, 8, 4).scale(1, 0.5, 1).translate(x, PLATE_TOP, z), 0x9c7a32));
  }

  // --- strings, computed note by note ----------------------------------------------------
  // 1-10 single copper-wound, 11-28 pairs of wound, 29-88 steel in threes: 226 in all, the real
  // arrangement, and the reason the bass looks heavy and the treble looks like a harp.
  const notes = buildNoteStrings();
  let row = 0;
  const STEEL = 0xd5d9dc;
  const COPPER = 0xa97a4c;
  const COPPER_LOW = 0x96683d;
  let stringCount = 0;
  for (const { n, count } of notes) {
    const bass = n <= 28;
    const spread = bass ? 0.0262 : 0.0112;
    for (let s = 0; s < count; s++) {
      const off = (s - (count - 1) / 2) * spread;
      const r = bass ? (n <= 10 ? lerp(0.0112, 0.0098, (n - 1) / 9) : lerp(0.0094, 0.0066, (n - 11) / 17)) : lerp(0.0064, 0.0044, (n - 29) / 59);
      const color = bass ? (n <= 10 ? COPPER_LOW : COPPER) : STEEL;
      const rowPin = row % 4;
      row += 1;
      const pinZ = 2.68 + rowPin * 0.135 + (n % 2) * 0.0675;
      let pts;
      let pinX;
      let hitch;
      if (bass) {
        const x0 = bassPinX(n) + off;
        const xr = bassRearX(n) + off;
        const zb = bassBridgeZ(bassRearX(n));
        const zh = bassHitchZ(bassRearX(n));
        const dx = (xr - x0) / (2.74 - zb);
        pinX = x0 - dx * (pinZ + 0.1 - 2.74);
        hitch = [xr + dx * (zb - zh), PLATE_TOP + 0.018, zh];
        pts = [[pinX, BASS_Y, pinZ + 0.1], [x0, BASS_Y, 2.74], [xr, BASS_Y, zb], hitch];
      } else {
        const x0 = tenorX(n) + off;
        const xr = tenorRearX(n) + off;
        const L = speakingLength(n);
        const zb = CAPO_Z - L;
        const zh = zb - 0.23;
        const dx = 0.05;
        pinX = x0 - dx * (pinZ - CAPO_Z);
        hitch = [xr + dx * 0.23, PLATE_TOP + 0.018, zh];
        pts = [[pinX, TENOR_Y, pinZ], [x0, TENOR_Y, CAPO_Z], [xr, TENOR_Y, zb], hitch];
      }
      wire.push(flat(polyTube(pts, r, bass ? 7 : 5), color));
      stringCount += 1;
      // A tuning pin and its coil, and a hitch pin at the far end.
      gold.push(flat(new THREE.CylinderGeometry(0.0125, 0.0145, 0.1, 5, 1).translate(pts[0][0], PLATE_TOP + 0.05, pts[0][2]), 0xc4c6c8));
      gold.push(flat(new THREE.CylinderGeometry(0.008, 0.009, 0.05, 4, 1).translate(hitch[0], PLATE_TOP + 0.018, hitch[2]), 0xe3cf8f));
    }
  }
  // Felt woven at the back of the strings, where they must not ring.
  const feltTenor = noteList.filter((n) => n % 3 === 0).map((n) => [tenorRearX(n) + 0.01, PLATE_TOP - 0.002, CAPO_Z - speakingLength(n) - 0.16]);
  timber.push(flat(sweep(feltTenor, [[-0.03, 0], [0.03, 0], [0.03, 0.04], [-0.03, 0.04]], { samples: 50 }), 0x8e1f27));

  // Dampers: a row of little felted blocks on the strings, stopping at note 68. The top of a piano
  // has none, because those strings die away so quickly they do not need them.
  for (let n = 1; n <= 68; n++) {
    const bass = n <= 28;
    let x; let z; let y;
    if (bass) {
      const t = (2.74 - 2.36) / (2.74 - bassBridgeZ(bassRearX(n)));
      x = lerp(bassPinX(n), bassRearX(n), t);
      z = 2.36;
      y = BASS_Y + 0.012;
    } else {
      x = tenorX(n) + 0.05 * (CAPO_Z - 2.16);
      z = 2.16;
      y = TENOR_Y + 0.008;
    }
    const w = n <= 10 ? 0.019 : n <= 28 ? 0.04 : 0.03;
    lacquer.push(flat(new THREE.BoxGeometry(w, 0.07, 0.075).translate(x, y + 0.042, z), 0x3a3836));
    timber.push(flat(new THREE.BoxGeometry(w * 0.94, 0.012, 0.066).translate(x, y + 0.004, z), 0x7a1c22));
  }

  // --- the keyboard ----------------------------------------------------------------------
  const KEY_FRONT = 4.405;
  const KEY_BACK = 3.9;
  const HEAD_BACK = 4.245;
  const KEY_TOP = 2.44;
  const layout = pianoKeyLayout();
  const rng = seededRandom(88);
  const WHITE = lin(0xece4d3);
  const blackCentre = (key) => -KB_HALF + key.slot * WHITE_W + BLACK_SHIFT[key.name] * BLACK_W;
  const gap = 0.0045;
  layout.forEach((key, i) => {
    if (key.black) return;
    const x0 = -KB_HALF + key.slot * WHITE_W + gap;
    const x1 = -KB_HALF + (key.slot + 1) * WHITE_W - gap;
    const prev = layout[i - 1];
    const next = layout[i + 1];
    const stemL = prev?.black ? blackCentre(prev) + BLACK_W / 2 + 0.006 : x0;
    const stemR = next?.black ? blackCentre(next) - BLACK_W / 2 - 0.006 : x1;
    const pts = [
      [x0, KEY_FRONT], [x1, KEY_FRONT], [x1, HEAD_BACK],
      ...(stemR < x1 ? [[stemR, HEAD_BACK]] : []),
      [stemR, KEY_BACK], [stemL, KEY_BACK],
      ...(stemL > x0 ? [[stemL, HEAD_BACK]] : []),
      [x0, HEAD_BACK],
    ].map(([x, z]) => [x, z]);
    const shade = 0.975 + rng() * 0.04;
    ivory.push(flat(planSolid(pts.reverse(), [], [
      [0, 2.3], [0, KEY_TOP - 0.018], [0.0025, KEY_TOP - 0.006], [0.0065, KEY_TOP],
    ], { crease: 30 }), new THREE.Color().setRGB(WHITE[0] * shade, WHITE[1] * shade, WHITE[2] * shade)));
  });
  layout.forEach((key) => {
    if (!key.black) return;
    const x = blackCentre(key);
    const hw = BLACK_W / 2;
    const FRONT = 4.235;
    const top = KEY_TOP + 0.05;
    const geo = solidLoft([
      { d: KEY_BACK, w: hw, up: 0.055, dn: 0.1, b: top - 0.055, roundUp: 0.42, roundDn: 0.3 },
      { d: FRONT - 0.09, w: hw * 0.97, up: 0.055, dn: 0.1, b: top - 0.055, roundUp: 0.42, roundDn: 0.3 },
      { d: FRONT - 0.04, w: hw * 0.96, up: 0.05, dn: 0.1, b: top - 0.06, roundUp: 0.42, roundDn: 0.3 },
      { d: FRONT - 0.012, w: hw * 0.97, up: 0.032, dn: 0.1, b: top - 0.078, roundUp: 0.5, roundDn: 0.3 },
      { d: FRONT, w: hw, up: 0.012, dn: 0.1, b: top - 0.098, roundUp: 0.5, roundDn: 0.3 },
    ], { sides: 10, samples: 6 });
    ivory.push(flat(geo, 0x232326, { position: [x, 0, 0] }));
  });

  // --- the lid ---------------------------------------------------------------------------
  // Two leaves, as a real one has. The front leaf folds back on top of the main one, and both then
  // lift together on hinges along the spine, so the opening faces the treble side and the audience.
  const LID_FOLD = 2.55;
  const lidOutline = [];
  const rightAtFold = 2.575;
  lidOutline.push([rightAtFold, LID_FOLD]);
  for (const [x, z] of outer) if (z < LID_FOLD) lidOutline.push([x, z]);
  lidOutline.push([-2.575, LID_FOLD]);
  const LID_Y = 3.248;
  const LID_T = 0.085;
  const lidStack = [[0.008, LID_Y], [0, LID_Y + 0.008], [0, LID_Y + LID_T - 0.016], [0.012, LID_Y + LID_T]];
  const LID_ANGLE = THREE.MathUtils.degToRad(34);
  const hinge = new THREE.Vector3(-2.575, LID_Y, 0);
  const lidMatrix = new THREE.Matrix4()
    .makeTranslation(hinge.x, hinge.y, 0)
    .multiply(new THREE.Matrix4().makeRotationZ(LID_ANGLE))
    .multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, 0));
  const lifted = (g) => g.applyMatrix4(lidMatrix);
  const lidColor = (p) => {
    const t = smooth(-2.5, 2.4, p.x);
    if (p.y < LID_Y + 0.02) {
      // The underside. It faces the ground, so no sun will ever reach it, and lit honestly it is a
      // black slab. What the real one shows is the gold frame reflected in it, so that is painted.
      return [lerp(0.05, 0.13, t), lerp(0.045, 0.098, t), lerp(0.042, 0.062, t)];
    }
    // Lighter toward the raised edge, the one part of a black lid that sees open sky.
    const k = 1.15 + 0.55 * t;
    return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k * 1.02];
  };
  // Painted flat, THEN lifted: a tint reads the part's own coordinates, and the underside is the
  // one surface that can be picked out by height only while the lid is still level.
  lacquer.push({ geometry: lifted(tintGeometry(planSolid(lidOutline, [], lidStack), lidColor)), keepColor: true });
  const flap = [];
  for (const [x, z] of outer) if (z < LID_FOLD && z > 1.45) flap.push([x, z]);
  flap.unshift([2.575, LID_FOLD]);
  flap.push([-2.575, 1.45], [-2.575, LID_FOLD]);
  const flapGeo = planSolid(flap, [], [[0.008, LID_Y + LID_T + 0.004], [0, LID_Y + LID_T + 0.012], [0, LID_Y + LID_T * 2 - 0.012], [0.012, LID_Y + LID_T * 2 + 0.002]]);
  lacquer.push({
    geometry: lifted(tintGeometry(flapGeo, (p) => {
      const k = 1.25 + 0.5 * smooth(-2.5, 2.4, p.x);
      return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k * 1.02];
    })),
    keepColor: true,
  });
  gold.push(flat(lifted(new THREE.CylinderGeometry(0.014, 0.014, 4.9, 8).rotateZ(Math.PI / 2).translate(0, LID_Y + LID_T + 0.03, LID_FOLD)), 0xc9a24f));
  for (const z of [1.9, -0.7, -3.4]) {
    gold.push(flat(new THREE.CylinderGeometry(0.026, 0.026, 0.36, 10).rotateX(Math.PI / 2).translate(-2.592, LID_Y + 0.006, z), 0xc9a24f));
    gold.push(flat(new THREE.BoxGeometry(0.11, 0.018, 0.34).translate(-2.52, RIM_HIGH + 0.002, z), 0xb9933f));
    gold.push(flat(lifted(new THREE.BoxGeometry(0.11, 0.018, 0.34).translate(-2.52, LID_Y + LID_T + 0.004, z)), 0xb9933f));
  }

  // The prop stick, from a brass cup on the rim to a socket under the lid.
  const propZ = 0.95;
  const propFoot = [2.33, RIM_HIGH + 0.012, propZ];
  const socket = new THREE.Vector3(-2.575 + 4.42, LID_Y - 0.012, propZ).applyMatrix4(lidMatrix);
  const propLen = v3(propFoot).distanceTo(socket);
  const propDir = socket.clone().sub(v3(propFoot)).normalize();
  const propAt = (t) => v3(propFoot).addScaledVector(propDir, t * propLen).toArray();
  lacquer.push(painted(bar(propFoot, socket.toArray(), 0.042, 0.03, 12), (p) => {
    const k = 1.3 + 1.1 * smooth(0, 1, Math.sin(p.x * 3 + p.z * 3) * 0.5 + 0.5);
    return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k];
  }));
  gold.push(flat(new THREE.CylinderGeometry(0.055, 0.065, 0.03, 16).translate(propFoot[0], RIM_HIGH + 0.012, propFoot[2]), 0xc9a24f));
  gold.push(flat(bar(propAt(0.965), propAt(1.0), 0.04, 0.052, 12), 0xc9a24f));
  gold.push(flat(lifted(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 14).translate(-2.575 + 4.42, LID_Y - 0.006, propZ)), 0xb9933f));

  // --- the music desk --------------------------------------------------------------------
  const DESK_Z = 3.24;
  const DESK_TILT = 0.3;
  const deskFrame = new THREE.Matrix4()
    .makeTranslation(0, RIM_HIGH - 0.02, DESK_Z)
    .multiply(new THREE.Matrix4().makeRotationX(-DESK_TILT));
  const deskOutline = [
    [-1.08, 0], [1.08, 0], [1.08, 0.62],
    ...spline2([[1.08, 0.62], [0.72, 0.82], [0.3, 0.92], [0, 0.94], [-0.3, 0.92], [-0.72, 0.82], [-1.08, 0.62]], 5).slice(1),
  ];
  const fret = [];
  for (let i = -5; i <= 5; i++) {
    const x = i * 0.17;
    const top = 0.84 - 0.2 * (i / 5) ** 2;
    fret.push(roundPoly([[x - 0.035, top - 0.16], [x + 0.035, top - 0.16], [x + 0.035, top], [x - 0.035, top]], 0.033, 3));
  }
  const desk = plateSolid(deskOutline, fret, [[0.006, -0.03], [0, -0.024], [0, 0.024], [0.006, 0.03]]);
  lacquer.push(painted(desk.applyMatrix4(deskFrame), (p) => {
    const k = 1.05 + 0.5 * smooth(3.4, 4.2, p.y);
    return [BLACK[0] * k, BLACK[1] * k, BLACK[2] * k];
  }));
  // Its ledge, and the rails it slides on, which bear on the frame rather than float over it.
  const ledge = new THREE.BoxGeometry(2.2, 0.03, 0.12).translate(0, 0.012, 0.075).applyMatrix4(deskFrame);
  lacquer.push(painted(ledge, gloss));
  for (const x of [-1.12, 1.12]) {
    lacquer.push(painted(planSolid([[x - 0.035, 3.44], [x + 0.035, 3.44], [x + 0.035, 2.98], [x - 0.035, 2.98]], [], edgeStack(PLATE_TOP - 0.01, RIM_HIGH + 0.01, 0.008)), gloss));
  }
  const sheet = plateSolid([[-0.5, 0], [0.5, 0], [0.5, 0.72], [-0.5, 0.72]], [], [[0, 0.028], [0, 0.036]], { crease: 30 });
  { // UVs across the page exactly once, on the page's own front.
    const uv = sheet.attributes.uv;
    const pos = sheet.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) + 0.5, pos.getY(i) / 0.72);
  }
  sheet.applyMatrix4(deskFrame);
  sheet.translate(0, 0.012 * Math.cos(DESK_TILT), 0.012 * Math.sin(DESK_TILT));

  const spruce = spruceTexture();
  const group3 = group([
    mesh(mergeParts(lacquer), standard({ vertexColors: true, roughness: 0.17, metalness: 0 })),
    mesh(mergeParts(gold), standard({ vertexColors: true, roughness: 0.4, metalness: 0.45 })),
    mesh(mergeParts(wire), standard({ vertexColors: true, roughness: 0.34, metalness: 0.5 })),
    mesh(mergeParts(timber), standard({ vertexColors: true, roughness: 0.62, metalness: 0, map: spruce, bumpMap: spruce, bumpScale: 0.3 })),
    mesh(mergeParts(ivory), standard({ vertexColors: true, roughness: 0.3, metalness: 0 })),
    mesh(sheet, standard({ map: sheetMusicTexture(), roughness: 0.9, metalness: 0 })),
  ], 'grand-piano');
  group3.userData.stringCount = stringCount;
  return group3;
}

// ---------------------------------------------------------------------------
// VIOLIN
// ---------------------------------------------------------------------------

// Authored in millimetres off a Stradivari-pattern body (356mm back, 208/110/168 at the bouts),
// then multiplied by four and turned into feet, so every dimension here can be checked against a
// luthier's drawing. Local frame while building: x across, y from tail to scroll, z out of the belly.
const VK = 4 / 304.8;
const vm = (v) => v * VK;

// Half the body outline, right side, tail to neck. Three separate runs, because a violin's corners
// are real points: splined through, they round off and it becomes a guitar.
function violinHalfOutline() {
  const lower = spline2([
    [0, 0], [26, 1.4], [52, 7], [76, 19], [93, 36], [102.5, 56], [104, 76], [101.5, 98], [94.5, 118], [88.5, 131], [86.6, 141], [90.5, 150.5],
  ], 4);
  const waist = spline2([
    [90.5, 150.5], [79, 152], [67, 160.5], [58.5, 172], [55, 186], [56, 200], [62, 212], [71, 219.5], [80, 224.5],
  ], 4);
  const upper = spline2([
    [80, 224.5], [75.8, 231], [76.4, 240], [81, 254], [84, 272], [83.5, 290], [79, 306], [70, 323], [56, 338], [37, 349.5], [18, 355], [0, 356.5],
  ], 4);
  return [...lower, ...waist.slice(1), ...upper.slice(1)];
}

function violinOutline() {
  const half = violinHalfOutline();
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return bluntTips([...half, ...left], 2.2);
}

// A real corner comes to a small rounded end rather than a needle.
function bluntTips(loop, k) {
  const n = loop.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n];
    const c = loop[i];
    const q = loop[(i + 1) % n];
    const ax = c[0] - p[0]; const ay = c[1] - p[1];
    const bx = q[0] - c[0]; const by = q[1] - c[1];
    const la = Math.hypot(ax, ay); const lb = Math.hypot(bx, by);
    const cos = (ax * bx + ay * by) / ((la * lb) || 1);
    if (cos > 0.5) { out.push(c); continue; }
    const ka = Math.min(k, la * 0.8);
    const kb = Math.min(k, lb * 0.8);
    const a = [c[0] - (ax / la) * ka, c[1] - (ay / la) * ka];
    const b = [c[0] + (bx / lb) * kb, c[1] + (by / lb) * kb];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
    }
  }
  return out;
}

// The arching: a height over the plate's edge as a function of position, with the scooped channel
// just inside the purfling and a plateau over the middle. Taken straight from distance to the edge
// it creases along every line equidistant from two edges, so the far field is a blurred copy of it.
function violinArch(outlineMm) {
  const segs = outlineMm.map((p, i) => [p, outlineMm[(i + 1) % outlineMm.length]]);
  const distanceTo = (x, y) => {
    let best = 1e9;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / ((dx * dx + dy * dy) || 1), 0, 1);
      const ex = x - (a[0] + dx * t);
      const ey = y - (a[1] + dy * t);
      const e = ex * ex + ey * ey;
      if (e < best) best = e;
    }
    return Math.sqrt(best);
  };
  const inside = (x, y) => {
    let hit = false;
    for (const [a, b] of segs) {
      if ((a[1] > y) !== (b[1] > y) && x < a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) hit = !hit;
    }
    return hit;
  };
  const shape = (d) => {
    const scoop = d < 13 ? -1.25 * Math.sin((Math.PI * d) / 13) : 0;
    const t = clamp((d - 5) / 46, 0, 1);
    return scoop + 14 * Math.sin((t * Math.PI) / 2) ** 1.5 + 1.6 * smooth(40, 100, d);
  };
  const cell = 5;
  const X0 = -112; const Y0 = -8;
  const nx = Math.ceil(224 / cell) + 1;
  const ny = Math.ceil(372 / cell) + 1;
  const dist = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = X0 + i * cell;
      const y = Y0 + j * cell;
      const d = distanceTo(x, y);
      dist[j * nx + i] = inside(x, y) ? d : -d;
    }
  }
  let height = new Float32Array(nx * ny);
  for (let k = 0; k < height.length; k++) height[k] = shape(Math.max(0, dist[k]));
  for (let pass = 0; pass < 4; pass++) {
    const next = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let b = -1; b <= 1; b++) {
          for (let a = -1; a <= 1; a++) sum += height[clamp(j + b, 0, ny - 1) * nx + clamp(i + a, 0, nx - 1)];
        }
        next[j * nx + i] = sum / 9;
      }
    }
    height = next;
  }
  const bilerp = (field, x, y) => {
    const fx = clamp((x - X0) / cell, 0, nx - 1.001);
    const fy = clamp((y - Y0) / cell, 0, ny - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const a = fx - i;
    const b = fy - j;
    return lerp(
      lerp(field[j * nx + i], field[j * nx + i + 1], a),
      lerp(field[(j + 1) * nx + i], field[(j + 1) * nx + i + 1], a),
      b,
    );
  };
  const heightAt = (x, y) => {
    const d = distanceTo(x, y);
    return lerp(shape(d), bilerp(height, x, y), smooth(3, 10, d));
  };
  return { heightAt, edgeDistance: (x, y) => bilerp(dist, x, y), distanceTo };
}

// Turns a hand-built closed grid the right way out by MEASURING it. Signed volume of a closed
// surface is the one test that does not depend on knowing which way anybody's rows ran.
function ensureOutward(g) {
  const p = g.attributes.position;
  const idx = g.index;
  let volume = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i); const b = idx.getX(i + 1); const c = idx.getX(i + 2);
    const ax = p.getX(a); const ay = p.getY(a); const az = p.getZ(a);
    const bx = p.getX(b); const by = p.getY(b); const bz = p.getZ(b);
    const cx = p.getX(c); const cy = p.getY(c); const cz = p.getZ(c);
    volume += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (volume < 0) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
  return g;
}

const V_EDGE = 19; // mm from the mid-plane to the plate's top edge: 15 of rib, 4 of plate

// One arched plate as a closed solid: edge rounding rows, then rings closing on a point at the
// waist, then a flat cap underneath against the ribs. The outline's corners survive exactly, since
// the rings are that outline drawn in toward a centre from which all of it is visible.
function violinPlate(outlineMm, arch, { side, uOffset }) {
  const CENTRE = [0, 186];
  const base = offsetLoop(outlineMm, 1.4);
  const edgeRows = [
    { loop: offsetLoop(outlineMm, 0.4), z: -3.8 },
    { loop: outlineMm, z: -2.9 },
    { loop: outlineMm, z: -1.2 },
    { loop: offsetLoop(outlineMm, 0.5), z: -0.35 },
  ];
  const fractions = [0, 0.012, 0.024, 0.038, 0.055, 0.075, 0.1, 0.13, 0.17, 0.22, 0.28, 0.35, 0.43, 0.52, 0.62, 0.73, 0.86];
  const m = outlineMm.length;
  const positions = [];
  const uvs = [];
  const indices = [];
  const uvOf = (x, y) => [uOffset + ((x + 110) / 220) * 0.5, (y + 6) / 368];
  const push = (x, y, zmm) => {
    positions.push(vm(x), vm(y), side * vm(V_EDGE + zmm));
    const [u, v] = uvOf(x, y);
    uvs.push(u, v);
  };
  for (const { loop, z } of edgeRows) for (const [x, y] of loop) push(x, y, z);
  for (const s of fractions) {
    for (let j = 0; j < m; j++) {
      const x = lerp(base[j][0], CENTRE[0], s);
      const y = lerp(base[j][1], CENTRE[1], s);
      push(x, y, arch.heightAt(x, y));
    }
  }
  const rows = edgeRows.length + fractions.length;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m;
      indices.push(r * m + j, r * m + k, (r + 1) * m + k, r * m + j, (r + 1) * m + k, (r + 1) * m + j);
    }
  }
  const apex = positions.length / 3;
  push(CENTRE[0], CENTRE[1], arch.heightAt(CENTRE[0], CENTRE[1]));
  for (let j = 0; j < m; j++) indices.push((rows - 1) * m + j, (rows - 1) * m + ((j + 1) % m), apex);
  // The flat underside, against the ribs. Earcut, because this outline is not convex.
  const under = edgeRows[0].loop.map(([x, y]) => new THREE.Vector2(x, y));
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(under, [])) indices.push(a, c, b);
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  ensureOutward(g);
  // The rings fan in from a blunted corner through very thin triangles, and normals averaged from
  // those leave a hairline ray across the varnish, so the arched surface takes its normals from the
  // height function itself. It is a heightfield: the true answer is one finite difference away.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const STEP = 1.5;
  for (let r = edgeRows.length + 1; r < rows; r++) {
    for (let j = 0; j < m; j++) {
      const i = r * m + j;
      const x = pos.getX(i) / VK;
      const y = pos.getY(i) / VK;
      const dx = (arch.heightAt(x + STEP, y) - arch.heightAt(x - STEP, y)) / (2 * STEP);
      const dy = (arch.heightAt(x, y + STEP) - arch.heightAt(x, y - STEP)) / (2 * STEP);
      const len = Math.hypot(dx, dy, 1);
      nor.setXYZ(i, -dx / len, -dy / len, side / len);
    }
  }
  return g;
}

// The plates' painting, belly on the left half of the sheet and back on the right. The purfling,
// three plies inlaid a few millimetres in from the edge, is drawn from the outline itself with
// mitred joins, so it runs out into each corner in the "bee sting" a real one has.
function violinPlateTexture(outlineMm, arch) {
  const W = 1024;
  const H = 856;
  const hw = W / 2;
  const noise = (x, y, s) => smoothNoise3(x * s, y * s, 3.7);
  return canvasTexture(W, H, (ctx) => {
    const image = ctx.createImageData(W, H);
    const d = image.data;
    for (let py = 0; py < H; py++) {
      const y = 362 - (py / H) * 368;
      for (let px = 0; px < W; px++) {
        const back = px >= hw;
        const x = ((back ? px - hw : px) / hw - 0.5) * 220;
        const ax = Math.abs(x);
        const edge = Math.max(0, arch.edgeDistance(x, y));
        let r; let g; let b;
        if (!back) {
          // Spruce under amber varnish: fine straight winter grain, tighter at the centre joint.
          const ph = ax * (0.72 - ax * 0.0022);
          const wig = Math.sin(y * 0.018 + ax * 0.04) * 0.25;
          const g1 = 0.5 + 0.5 * Math.cos((ph + wig) * Math.PI * 2);
          const grain = g1 ** 5;
          const mottle = noise(x, y, 0.035);
          const wear = Math.exp(-(((ax / 62) ** 2) + (((y - 82) / 58) ** 2))) * 0.3;
          const tone = 0.82 + mottle * 0.26 + wear - grain * 0.3;
          r = 186 * tone; g = 106 * tone * (1 + wear * 0.12); b = 43 * tone;
        } else {
          // Book-matched flamed maple: bright and dark bands climbing away from the centre joint.
          const wander = Math.sin(y * 0.021 + 1.2) * 4 + Math.sin(ax * 0.05 + y * 0.012) * 3;
          const t = (y + ax * 0.5 + wander) * 0.72;
          const band = 0.5 + 0.5 * Math.sin(t + Math.sin(t * 0.21) * 1.4);
          const fine = 0.5 + 0.5 * Math.sin(ax * 2.4 + Math.sin(y * 0.05) * 1.1);
          const mottle = noise(x, y, 0.04);
          const tone = 0.72 + band ** 1.4 * 0.36 + fine * 0.04 + mottle * 0.2;
          r = 178 * tone; g = 94 * tone; b = 36 * tone;
        }
        // Varnish pools darker toward the edge, as it does on every old instrument.
        const dark = 0.62 + 0.38 * smooth(1, 30, edge);
        const i = (py * W + px) * 4;
        d[i] = clamp(r * dark, 0, 255);
        d[i + 1] = clamp(g * dark, 0, 255);
        d[i + 2] = clamp(b * dark, 0, 255);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    // A raw offset of a concave curve crosses itself round each corner, so anything that came
    // out closer to the edge than it should be is simply dropped. What is left closes on itself.
    const path = offsetLoop(outlineMm, 4.4).filter(([x, y]) => arch.distanceTo(x, y) > 4.25);
    for (const off of [0, hw]) {
      const trace = () => {
        ctx.beginPath();
        path.forEach(([x, y], i) => {
          const u = off + ((x + 110) / 220) * hw;
          const v = ((362 - y) / 368) * H;
          if (i === 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
        });
        ctx.closePath();
      };
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 10;
      ctx.strokeStyle = '#17100a';
      ctx.lineWidth = 5.2;
      trace();
      ctx.stroke();
      ctx.strokeStyle = '#d9c189';
      ctx.lineWidth = 1.8;
      trace();
      ctx.stroke();
    }
  });
}

// A near-white tile of maple flame for everything but the plates. It multiplies the varnish colour
// each part carries, and every wave in it is a whole number of cycles so that it tiles.
function flameTexture() {
  const S = 320;
  const texture = canvasTexture(S, S, (ctx) => {
    const image = ctx.createImageData(S, S);
    const d = image.data;
    for (let y = 0; y < S; y++) {
      const v = y / S;
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const wave = 0.11 * Math.sin(Math.PI * 2 * (u * 2 + 0.2)) + 0.05 * Math.sin(Math.PI * 2 * (u * 5 + v * 3));
        const band = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (v * 19 + u * 3 + wave * 3));
        const fine = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 48 + v * 3));
        const k = 255 - 40 * band ** 1.4 - 7 * fine ** 3;
        const i = (y * S + x) * 4;
        d[i] = k; d[i + 1] = k; d[i + 2] = k; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function uvPlanar(g, fn) {
  const uv = g.attributes.uv;
  const p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const [a, b] = fn(p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i));
    uv.setXY(i, a, b);
  }
  return g;
}

// The scroll, swept as a real spiral. A section runs round a logarithmic curve from the back of the
// pegbox, up over the top, forward and down, and in to the eye. Each section reaches from this turn
// down to the turn inside it, so the turns are solid against one another, and the width GROWS going
// in, which is what stands the eye proud on each side. The outer face carries the two flutes and the
// central spine, and they die away as the spiral tightens.
const VOLUTE_B = 0.098;
const VOLUTE_TANGENT = -0.25;

function violinScroll(yc, zc, R0, colorAt) {
  const B = VOLUTE_B;
  const PHI0 = -0.85;
  const PHI1 = Math.PI * 2 * 2.7;
  const rho = (phi) => R0 * Math.exp(-B * phi);
  const across = [-1, -0.9, -0.72, -0.5, -0.28, -0.12, 0, 0.12, 0.28, 0.5, 0.72, 0.9, 1];
  const steps = 190;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const ringN = across.length + 6;
  const widthAt = (phi) => {
    const f = clamp((phi - VOLUTE_TANGENT) / (PHI1 - VOLUTE_TANGENT), 0, 1);
    return lerp(11.1, 11.7, smooth(PHI0, VOLUTE_TANGENT, phi)) + 6 * f ** 0.8;
  };
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const phi = lerp(PHI0, PHI1, f);
    const outerR = rho(phi);
    const innerR = phi + Math.PI * 2 <= PHI1 ? rho(phi + Math.PI * 2) * 0.97 : outerR * 0.12;
    const W = widthAt(phi);
    const fade = smooth(VOLUTE_TANGENT, VOLUTE_TANGENT + 0.8, phi) * (1 - smooth(0.42, 0.74, f));
    const fluteDepth = (outerR - innerR) * 0.27 * fade;
    const lip = Math.min(1.1, (outerR - innerR) * 0.2);
    const sn = Math.sin(phi);
    const cs = Math.cos(phi);
    const emit = (x, r, tone) => {
      positions.push(vm(x), vm(yc + r * sn), vm(zc - r * cs));
      uvs.push(0, 0);
      const c = colorAt(tone);
      colors.push(c[0], c[1], c[2]);
    };
    for (const a of across) {
      const abs = Math.abs(a);
      // Spine at the centre, a trough either side of it, a rim, then the chamfer to the side face.
      const trough = Math.sin(clamp(abs / 0.86, 0, 1) * Math.PI);
      const chamfer = abs > 0.9 ? (abs - 0.9) / 0.1 : 0;
      const r = outerR - fluteDepth * trough - chamfer * lip;
      emit(a * W, r, (abs >= 0.9 ? 0.3 : 1) * (1 - 0.26 * trough * fade));
    }
    // Down the side face and into the groove against the next turn in. That groove, painted dark as
    // a real one is shadowed, is the line that makes this read as a spiral rather than a target.
    const nearIn = innerR + Math.min(0.9, (outerR - innerR) * 0.2);
    const nearOut = outerR - lip - Math.min(0.5, (outerR - innerR) * 0.1);
    emit(W, nearOut, 1);
    emit(W, nearIn, 0.92);
    emit(W, innerR, 0.22);
    emit(-W, innerR, 0.22);
    emit(-W, nearIn, 0.92);
    emit(-W, nearOut, 1);
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < ringN; j++) {
      const k = (j + 1) % ringN;
      indices.push(i * ringN + j, i * ringN + k, (i + 1) * ringN + k, i * ringN + j, (i + 1) * ringN + k, (i + 1) * ringN + j);
    }
  }
  for (let j = 1; j < ringN - 1; j++) {
    indices.push(0, j + 1, j);
    indices.push(steps * ringN, steps * ringN + j, steps * ringN + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ensureOutward(g);
  // A scroll is carved from one block, so its figure runs straight through the curves.
  uvPlanar(g, (x, y, z) => [(z + x * 0.7) * 0.6, y * 0.75]);
  return { geometry: g, eyeWidth: widthAt(PHI1), rho };
}

// A dark, thin solid draped on the belly. Every vertex asks the arch where the surface is, so it can
// hug a curve no flat patch could, and it stands one hair proud because there is no CSG to cut with.
function drapedPatch(point, arch, nu, nv, lift = 0.5) {
  return solidSurface({
    nu,
    nv,
    axis: [0, 0, 1],
    point: (u, v) => {
      const [x, y] = point(u, v);
      return [vm(x), vm(y), vm(V_EDGE + arch.heightAt(x, y) + lift)];
    },
    thick: () => vm(0.22),
  });
}

function fHoleParts(sign, arch, color) {
  const parts = [];
  const spine = spline2([[22, 208], [24, 196], [29, 182], [36, 168], [43, 156], [49, 145], [53, 138]], 8);
  const n = spine.length - 1;
  const atSpine = (u) => {
    const f = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    return [lerp(spine[i][0], spine[i + 1][0], t), lerp(spine[i][1], spine[i + 1][1], t)];
  };
  // Half widths each side of the stem. The upper wing flares on the outer side and the lower wing on
  // the inner, and both end in a point against the stem rather than rounding back.
  const outerW = (u) => 0.85 + 1.75 * Math.sin(clamp(u, 0, 1) * Math.PI) ** 0.8 + 2.5 * smooth(0.05, 0.16, u) * (1 - smooth(0.16, 0.4, u));
  const innerW = (u) => 0.85 + 1.75 * Math.sin(clamp(u, 0, 1) * Math.PI) ** 0.8 + 2.7 * smooth(0.62, 0.84, u) * (1 - smooth(0.84, 0.97, u));
  parts.push(drapedPatch((u, v) => {
    const [x, y] = atSpine(u);
    const a = atSpine(u - 0.01);
    const b = atSpine(u + 0.01);
    let nx = -(b[1] - a[1]);
    let ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    const off = lerp(-innerW(u), outerW(u), v);
    // nx,ny points to the inner side going down the f, so the outer width is on the minus side.
    return [sign * (x - nx * off), y - ny * off];
  }, arch, 56, 3));
  // The two round eyes that stop the crack, and the two nicks that mark where the bridge stands.
  for (const [cx, cy, r] of [[22, 208, 3.4], [53.5, 137, 4.6]]) {
    parts.push(drapedPatch((u, v) => {
      const a = u * Math.PI * 2;
      return [sign * (cx + Math.cos(a) * r * v), cy + Math.sin(a) * r * v];
    }, arch, 22, 3));
  }
  const nick = atSpine(0.47);
  parts.push(drapedPatch((u, v) => {
    const taper = 1 - Math.abs(u - 0.5) * 1.5;
    const across = (v - 0.5) * 1.1 * taper;
    return [sign * (nick[0] + (u - 0.5) * 10.5), nick[1] + across];
  }, arch, 8, 2));
  return parts.map((g) => flat(g, color));
}

// The bow, built along +Y with the hair on its +X side, in feet. 730mm of stick at four times life.
function violinBow() {
  const L = vm(730);
  const wood = [];
  const ebony = [];
  const metal = [];
  const SAG = 0.13;
  const HAIR_X = 0.27;
  const stickX = (t) => SAG * Math.sin(Math.PI * t) ** 1.1;
  const stick = [];
  const radii = [];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36;
    stick.push([stickX(t), t * L, 0]);
    radii.push(lerp(0.058, 0.034, t));
  }
  wood.push(flat(polyTube(stick, radii, 10), 0x5f3016));

  // The head: the hatchet shape that makes a modern bow, with a pale tip-plate on its face.
  const head = [
    [-0.036, L - 0.46], [-0.042, L - 0.14], [-0.034, L - 0.03], [0.01, L + 0.05], [0.06, L + 0.03],
    [0.31, L - 0.1], [0.31, L - 0.19], [0.21, L - 0.2], [0.09, L - 0.3], [0.042, L - 0.46],
  ];
  wood.push(flat(plateSolid(head, [], [[0.008, -0.044], [0, -0.036], [0, 0.036], [0.008, 0.044]], { crease: 50 }), 0x5f3016));
  // The tip plate on its slanted face.
  wood.push(flat(plateSolid([
    [0.006, L + 0.056], [0.062, L + 0.038], [0.316, L - 0.098], [0.318, L - 0.128], [0.06, L + 0.004], [0.008, L + 0.022],
  ], [], [[0.004, -0.048], [0, -0.045], [0, 0.045], [0.004, 0.048]], { crease: 50 }), 0xe6dcc6));

  // The frog, ebony, with a silver ferrule where the hair fans out and a pearl eye in its flank.
  const frog = [
    [0.03, 0.18], [0.03, 0.72], [0.21, 0.72], [0.34, 0.68], [0.345, 0.56],
    ...spline2([[0.345, 0.56], [0.27, 0.44], [0.25, 0.32], [0.2, 0.2], [0.13, 0.17]], 3).slice(1),
  ];
  ebony.push(flat(plateSolid(frog, [], [[0.008, -0.075], [0, -0.067], [0, 0.067], [0.008, 0.075]], { crease: 50 }), 0x1c1a19));
  metal.push(flat(plateSolid([[0.16, 0.695], [0.345, 0.655], [0.348, 0.705], [0.16, 0.745]], [], [[0.003, -0.079], [0, -0.076], [0, 0.076], [0.003, 0.079]], { crease: 50 }), 0xd9dadb));
  for (const side of [-1, 1]) {
    ebony.push(flat(new THREE.SphereGeometry(0.045, 14, 8).scale(1, 1, 0.3).translate(0.2, 0.44, side * 0.072), 0xe6dfe9));
  }
  // Lapping, thumb leather and the screw button.
  for (const [t0, t1, r, color] of [[0.076, 0.084, 0.064, 0xc9cacb], [0.084, 0.128, 0.0595, 0x8e9094], [0.128, 0.155, 0.063, 0x4a3425]]) {
    metal.push(flat(polyTube([[stickX(t0), t0 * L, 0], [stickX((t0 + t1) / 2), ((t0 + t1) / 2) * L, 0], [stickX(t1), t1 * L, 0]], r, 12), color));
  }
  ebony.push(flat(latheUp([
    [0, -0.2], [0.05, -0.2], [0.06, -0.17], [0.06, -0.14], [0.05, -0.12], [0.056, -0.09], [0.056, 0], [0, 0.01],
  ], { segments: 14 }), 0x1c1a19));
  metal.push(flat(latheUp([[0.0565, -0.075], [0.0585, -0.075], [0.0585, -0.02], [0.0565, -0.02]], { segments: 14 }).toNonIndexed(), 0xd9dadb));

  // The hair: a flat ribbon, pale, straight and under tension from frog to tip.
  const hair = beam([HAIR_X, 0.7, 0], [HAIR_X, L - 0.16, 0], 0.125, 0.016, { side: [0, 0, 1], r: 0.006, steps: 1 });
  wood.push(flat(hair, 0xd8d2c1));
  return { wood, ebony, metal, length: L };
}

export function violin() {
  const outlineMm = violinOutline();
  const arch = violinArch(outlineMm);

  const plates = [];
  const maple = [];
  const ebony = [];
  const metal = [];
  const stand = [];

  const VARNISH = lin(0xa9591f);
  const varnishAt = (k) => [VARNISH[0] * k, VARNISH[1] * k, VARNISH[2] * k];
  const EBONY = 0x1f1d1c;

  // --- the body --------------------------------------------------------------------------
  plates.push(violinPlate(outlineMm, arch, { side: 1, uOffset: 0 }));
  plates.push(violinPlate(outlineMm, arch, { side: -1, uOffset: 0.5 }));

  const ribLoop = offsetLoop(outlineMm, 2.6).map(([x, y]) => [vm(x), vm(y)]);
  const ribs = plateSolid(ribLoop, [], [[0, vm(-15.6)], [0, vm(-8)], [0, 0], [0, vm(8)], [0, vm(15.6)]], { crease: 40 });
  uvPlanar(ribs, (x, y, z, u) => [z * 0.6 + 0.1, u * 0.62]);
  maple.push(painted(ribs, (p) => {
    const k = 0.92 + 0.2 * Math.cos((p.z / vm(15.6)) * 1.3);
    return varnishAt(k);
  }));

  // --- neck, fingerboard, nut ------------------------------------------------------------
  // The fingerboard's top is one straight line, set by the numbers a maker works to: the board
  // would meet the bridge's position 27mm above the belly's top there.
  const BRIDGE_Y = 161;
  const bellyAtBridge = V_EDGE + arch.heightAt(0, BRIDGE_Y);
  const FB_ROOT = V_EDGE + 13; // top of the board where it crosses the body's edge
  const SLOPE = (bellyAtBridge + 27 - FB_ROOT) / (356 - BRIDGE_Y);
  const fbTop = (y) => FB_ROOT + (356 - y) * SLOPE;
  const NUT_Y = 486;

  const neckSpan = [
    { y: 334, w: 14.8, dn: 52 }, { y: 347, w: 14.8, dn: 50 }, { y: 356, w: 14.5, dn: 34 }, { y: 362, w: 14, dn: 17 },
    { y: 372, w: 13.2, dn: 11.5 }, { y: 420, w: 12, dn: 10 }, { y: NUT_Y, w: 11, dn: 9 }, { y: NUT_Y + 4, w: 11, dn: 9 },
  ];
  const neck = solidLoft(neckSpan.map(({ y, w, dn }) => ({
    d: vm(y), w: vm(w), up: vm(3.5), dn: vm(dn), b: vm(fbTop(y) - 7), roundUp: 0.3, roundDn: 0.95,
  })), { axis: 'y', sides: 22, samples: 44 });
  uvPlanar(neck, (x, y, z) => [x * 0.5 + z * 0.5, y * 0.75]);
  maple.push(painted(neck, () => varnishAt(1.12)));

  const fingerboard = solidLoft([
    { y: 216, w: 21 }, { y: 300, w: 18 }, { y: 400, w: 14.7 }, { y: NUT_Y, w: 12.2 },
  ].map(({ y, w }) => ({
    d: vm(y), w: vm(w), up: vm(3.1), dn: vm(2.6), b: vm(fbTop(y) - 3.1), roundUp: 0.82, roundDn: 0.42,
  })), { axis: 'y', sides: 22, samples: 16 });
  ebony.push(flat(fingerboard, EBONY));
  ebony.push(flat(solidLoft([
    { d: vm(NUT_Y), w: vm(12), up: vm(2.2), dn: vm(2.4), b: vm(fbTop(NUT_Y) - 1.1), round: 0.7 },
    { d: vm(NUT_Y + 5), w: vm(12), up: vm(2.2), dn: vm(2.4), b: vm(fbTop(NUT_Y + 5) - 1.1), round: 0.7 },
  ], { axis: 'y', sides: 16, samples: 2 }), EBONY));

  // --- pegbox and scroll -----------------------------------------------------------------
  // Two cheeks, a back and a real opening, so the strings really do go down into something.
  const PB_LOW = NUT_Y + 3;
  const PB_HIGH = 566;
  const pbTop = (y) => fbTop(y) - 1.5;
  const pbBack = (y) => pbTop(y) - lerp(25, 22, (y - PB_LOW) / (PB_HIGH - PB_LOW));
  const R0 = 24.2;
  const yc = 590 - R0 * Math.exp(-VOLUTE_B * Math.PI * 0.5);
  // Set so the spiral leaves the pegbox's back in a tangent line, with no step at the join.
  const rhoT = R0 * Math.exp(-VOLUTE_B * VOLUTE_TANGENT);
  const yTangent = yc + rhoT * Math.sin(VOLUTE_TANGENT);
  const zc = pbBack(yTangent) + rhoT * Math.cos(VOLUTE_TANGENT);

  const pbWide = () => 11.3;
  for (const side of [-1, 1]) {
    const inner = 8.2;
    const loop = [
      [vm(pbBack(PB_LOW - 8)), vm(PB_LOW - 8)], [vm(pbTop(PB_LOW - 8) - 2), vm(PB_LOW - 8)],
      ...spline2([[pbTop(PB_LOW), PB_LOW], [pbTop(530), 530], [pbTop(556), 556], [pbTop(556) - 6, yc - 8]], 4).map(([z, y]) => [vm(z), vm(y)]),
      [vm(zc - R0 * 0.3), vm(yc + 2)], [vm(pbBack(yTangent)), vm(yTangent)],
    ];
    const a = side < 0 ? -pbWide(530) : inner;
    const b = side < 0 ? -inner : pbWide(530);
    const cheek = sideSolid(loop, [[0.4 * VK, vm(a)], [0, vm(a) + 0.4 * VK], [0, vm(b) - 0.4 * VK], [0.4 * VK, vm(b)]]);
    uvPlanar(cheek, (x, y, z) => [z * 0.6, y * 0.75]);
    maple.push(painted(cheek, () => varnishAt(1.08)));
  }
  const pbFloor = sideSolid([
    [vm(pbBack(PB_LOW - 8)), vm(PB_LOW - 8)], [vm(pbBack(PB_LOW - 8) + 4), vm(PB_LOW - 8)],
    [vm(pbBack(yTangent) + 3.5), vm(yTangent)], [vm(pbBack(yTangent)), vm(yTangent)],
  ], [[0, -vm(10.5)], [0, vm(10.5)]]);
  uvPlanar(pbFloor, (x, y, z) => [x * 0.6, y * 0.75]);
  maple.push(painted(pbFloor, (p) => {
    // The inside of the box is left dark, which is what makes it read as a box.
    const inside = p.z > vm(pbBack(p.y / VK)) + vm(2);
    return inside ? [0.03, 0.016, 0.008] : varnishAt(1);
  }));

  const scroll = violinScroll(yc, zc, R0, (k) => varnishAt(1.1 * k));
  maple.push({ geometry: scroll.geometry, keepColor: true });
  const eyeBoss = (s) => new THREE.SphereGeometry(vm(3.3), 18, 12).scale(0.26, 1, 1).translate(s * vm(scroll.eyeWidth), vm(yc), vm(zc));
  ebony.push(flat(eyeBoss(-1), 0x6d3a17));
  ebony.push(flat(eyeBoss(1), 0x6d3a17));

  // --- pegs ------------------------------------------------------------------------------
  // G low on the left, D above it, A high on the right, E low on the right, seen from the front.
  // Each sits slightly tilted across the box, and a string's coil sits on its shaft inside.
  const PEG = {
    G: { side: -1, y: 509, x: -8.25 }, D: { side: -1, y: 533, x: -2.75 },
    A: { side: 1, y: 533, x: 2.75 }, E: { side: 1, y: 509, x: 8.25 },
  };
  const pegZ = (y) => pbTop(y) - 11;
  for (const { side, y } of Object.values(PEG)) {
    const z = pegZ(y);
    const shaft = bar([vm(-side * 16), vm(y), vm(z)], [vm(side * 14), vm(y), vm(z)], vm(2.4), vm(3.4), 12);
    ebony.push(flat(shaft, EBONY));
    ebony.push(flat(new THREE.SphereGeometry(vm(2.7), 12, 8).translate(vm(-side * 16.5), vm(y), vm(z)), 0x2a2725));
    // The head: turned, then flattened across its width so it can be gripped.
    const head = latheUp([
      [0, 13], [3.1, 13], [4.5, 14.2], [4.6, 15.4], [3.5, 16.8],
      ...spline2([[3.5, 16.8], [5.2, 20], [9.2, 25], [11.2, 31], [10.2, 36.5], [6.5, 40.6], [2.2, 42], [0, 42.2]], 3),
    ].map(([r, a]) => [vm(r), vm(a)]), { segments: 24 });
    head.scale(0.42, 1, 1);
    head.rotateZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
    head.translate(0, vm(y), vm(z));
    ebony.push(flat(head, EBONY));
  }

  // --- belly furniture: bridge, tailpiece, saddle, button, f-holes ----------------------
  ebony.push(...fHoleParts(1, arch, 0x0e0906), ...fHoleParts(-1, arch, 0x0e0906));

  // The bridge. Its feet are cut to the belly's arch at the very place they stand, its top is the
  // curve that lets a bow reach one string at a time, higher on the G side, and the heart and the
  // kidneys are real openings.
  const footBase = (x) => arch.heightAt(x, BRIDGE_Y) - arch.heightAt(0, BRIDGE_Y) - 0.6;
  const bridgeTop = (x) => 32.5 - (x * x) / 92 + (-x / 21) * 1.6;
  const bridgeOutline = [
    [21, footBase(21)], [21.5, footBase(21) + 1.8], [20, 4.2], [16.2, 7.6], [15, 10], [17, 13.5], [18.6, 17.5], [19, 21.5], [21, 26.5],
    ...[20, 16, 12, 8, 4, 0, -4, -8, -12, -16, -20].map((x) => [x, bridgeTop(x)]),
    [-21, 26.5], [-19, 21.5], [-18.6, 17.5], [-17, 13.5], [-15, 10], [-16.2, 7.6], [-20, 4.2], [-21.5, footBase(21) + 1.8], [-21, footBase(21)],
    [-14, footBase(14)], [-8, footBase(8)], [-7, 2.6], [-4, 5.2], [0, 6], [4, 5.2], [7, 2.6], [8, footBase(8)], [14, footBase(14)],
  ];
  const kidney = (s) => {
    const pts = spline2([[s * 8, 7.6], [s * 12.4, 7.4], [s * 14.4, 11.6], [s * 11.6, 15.6], [s * 9.6, 14.4], [s * 11, 11.4], [s * 8, 9.8], [s * 8, 7.6]], 3);
    pts.pop();
    return pts;
  };
  const heart = spline2([[0, 13.4], [3.4, 16.8], [3.8, 20.6], [1.6, 21.8], [0, 20.4], [-1.6, 21.8], [-3.8, 20.6], [-3.4, 16.8], [0, 13.4]], 3);
  heart.pop();
  const bridge = plateSolid(bridgeOutline.map(([x, y]) => [vm(x), vm(y)]), [kidney(1), kidney(-1), heart].map((loop) => loop.map(([x, y]) => [vm(x), vm(y)])),
    [[vm(0.12), -vm(1.15)], [0, -vm(0.95)], [0, vm(0.95)], [vm(0.12), vm(1.15)]], { crease: 60 });
  bridge.rotateX(Math.PI / 2);
  bridge.translate(0, vm(BRIDGE_Y), vm(V_EDGE + arch.heightAt(0, BRIDGE_Y)));
  // Pale, unvarnished maple with its flecked figure.
  stand.push(painted(bridge, (p) => {
    const n = smoothNoise3(p.x * 18, p.y * 6, p.z * 18);
    const k = 0.94 + 0.14 * n;
    const c = lin(0xd8bd8c);
    return [c[0] * k, c[1] * k, c[2] * k];
  }));

  // The tailpiece, narrow at the bottom and wide under the strings, with a raised middle.
  const TAIL_LOW = 20;
  const TAIL_HIGH = 113;
  const tailZ = (y) => lerp(V_EDGE + 21, V_EDGE + 30.5, (y - TAIL_LOW) / (TAIL_HIGH - TAIL_LOW));
  ebony.push(flat(solidLoft([
    { y: TAIL_LOW, w: 9 }, { y: 40, w: 11.5 }, { y: 75, w: 16.5 }, { y: 104, w: 21 }, { y: TAIL_HIGH - 1.5, w: 21.5 }, { y: TAIL_HIGH, w: 20.2 },
  ].map(({ y, w }) => ({
    d: vm(y), w: vm(w), up: vm(3.2), dn: vm(2.6), b: vm(tailZ(y)), roundUp: 0.8, roundDn: 0.5,
  })), { axis: 'y', sides: 20, samples: 16 }), EBONY));
  // The tail-gut, the saddle it runs over, and the end button it hangs from.
  ebony.push(flat(solidLoft([
    { d: vm(-0.6), w: vm(11), up: vm(1.6), dn: vm(1.6), b: vm(V_EDGE + 1.6), round: 0.7 },
    { d: vm(7), w: vm(9.5), up: vm(1.6), dn: vm(2), b: vm(V_EDGE + 1.4), round: 0.7 },
  ], { axis: 'y', sides: 14, samples: 3 }), EBONY));
  const buttonY = -0.6;
  for (const x of [-3.2, 3.2]) {
    ebony.push(flat(polyTube([
      [vm(x), vm(TAIL_LOW + 3), vm(tailZ(TAIL_LOW))], [vm(x), vm(TAIL_LOW - 8), vm(tailZ(TAIL_LOW) - 5)], [vm(x), vm(5), vm(V_EDGE + 4.2)], [vm(x), vm(-1.5), vm(V_EDGE + 2.2)],
      [vm(x * 0.7), vm(buttonY - 4), vm(V_EDGE - 7)], [vm(x * 0.4), vm(buttonY - 5), vm(V_EDGE - 15)],
    ], vm(1.2), 7), 0x2a2522));
  }
  const endButton = latheUp([
    [0, 3], [vm(5), 3], [vm(5), 0], [vm(7), -vm(1)], [vm(7.2), -vm(3)], [vm(5.2), -vm(6)], [vm(5.8), -vm(8)], [vm(3.5), -vm(11.5)], [vm(1.4), -vm(12.2)], [0, -vm(12.3)],
  ].reverse().map(([r, y]) => (y === 3 ? [r, vm(2)] : [r, y])), { segments: 20 });
  ebony.push(flat(endButton, EBONY));

  // --- the strings -----------------------------------------------------------------------
  // Exactly four, each a few pixels wide at six feet, which is far heavier than a real string and
  // has to be: a true 0.3mm E is under a pixel at this distance and the instrument would look unstrung.
  const STRINGS = [
    { name: 'G', bridgeX: -17.1, tailX: -12.6, nutX: -8.25, r: 0.0118, color: 0xb0aa9f, silk: 0x7a2f8f },
    { name: 'D', bridgeX: -5.7, tailX: -4.2, nutX: -2.75, r: 0.0102, color: 0xbfb9ad, silk: 0x2f5fa8 },
    { name: 'A', bridgeX: 5.7, tailX: 4.2, nutX: 2.75, r: 0.009, color: 0xc9c4b8, silk: 0x2f8f4b },
    { name: 'E', bridgeX: 17.1, tailX: 12.6, nutX: 8.25, r: 0.0074, color: 0xdfe2e6, silk: 0xb94a2c },
  ];
  const zBridgeBase = V_EDGE + arch.heightAt(0, BRIDGE_Y);
  for (const { name, bridgeX, tailX, nutX, r, color, silk } of STRINGS) {
    const peg = PEG[name];
    const pz = pegZ(peg.y);
    const nutZ = fbTop(NUT_Y) + 1.7;
    const atBridge = [vm(bridgeX), vm(BRIDGE_Y), vm(zBridgeBase + bridgeTop(bridgeX) + 0.3)];
    const atTail = [vm(tailX), vm(TAIL_HIGH - 6), vm(tailZ(TAIL_HIGH - 6) + 2.9)];
    const atNut = [vm(nutX), vm(NUT_Y + 2.5), vm(nutZ)];
    const atPeg = [vm(peg.x * 0.55), vm(peg.y), vm(pz + 2.2)];
    metal.push(flat(polyTube([atTail, atBridge, atNut, atPeg], r, 8), color));
    // The string's silk at the tailpiece, and its coil round the peg's shaft in the box.
    ebony.push(flat(polyTube([atTail, [lerp(atTail[0], atBridge[0], 0.12), lerp(atTail[1], atBridge[1], 0.12), lerp(atTail[2], atBridge[2], 0.12)]], r * 1.45, 8), silk));
    metal.push(flat(bar([vm(peg.x * 0.55 - 2.4), vm(peg.y), vm(pz)], [vm(peg.x * 0.55 + 2.4), vm(peg.y), vm(pz)], vm(3.5), vm(3.5), 10), color));
  }
  // The E string's fine tuner, a little steel lever on the tailpiece.
  metal.push(flat(new THREE.BoxGeometry(vm(5.4), vm(11), vm(2)).translate(vm(12.6), vm(TAIL_HIGH - 10), vm(tailZ(TAIL_HIGH - 10) + 3.6)), 0xc7c9cc));
  metal.push(flat(new THREE.CylinderGeometry(vm(1.9), vm(1.9), vm(4), 14).rotateX(Math.PI / 2).translate(vm(12.6), vm(TAIL_HIGH - 15), vm(tailZ(TAIL_HIGH - 15) + 5)), 0xd7d9dc));

  // --- onto the stand --------------------------------------------------------------------
  const BASE_TOP = 0.235;
  const FOOT = vm(13.6);
  const RAKE = 0.17;
  const rake = new THREE.Matrix4().makeTranslation(0, BASE_TOP + 0.5 + FOOT * Math.cos(RAKE), 0.34)
    .multiply(new THREE.Matrix4().makeRotationX(-RAKE));
  const onStand = (p) => v3(p).applyMatrix4(rake).toArray();

  // A heavy turned base, so that a 7ft violin plainly could not tip it. Stepped mouldings with
  // hard edges and an inlaid ring: a smooth lathe with soft shading reads as a tray of chocolate.
  const base = latheUp([
    [0, 0], [2.28, 0], [2.28, 0], [2.34, 0.015], [2.34, 0.07], [2.34, 0.07], [2.28, 0.1], [2.2, 0.115], [2.2, 0.115],
    [2.18, 0.145], [2.12, 0.19], [2.04, 0.215], [2.04, 0.215], [2.0, 0.235], [2.0, 0.235], [1.71, 0.235], [1.71, 0.235],
    [1.7, 0.243], [1.7, 0.243], [1.64, 0.243], [1.64, 0.243], [1.63, 0.235], [1.63, 0.235], [0.5, 0.235], [0, 0.235],
  ], { segments: 64 });
  const WALNUT = lin(0x5a3620);
  stand.push(painted(base, (p) => {
    const r = Math.hypot(p.x, p.z);
    if (r > 1.62 && r < 1.71 && p.y > 0.24) return lin(0x9c7c3e);
    const n = smoothNoise3(p.x * 0.8, 0.3, p.z * 3.6) * 0.6 + smoothNoise3(p.x * 2.4, 2.3, p.z * 11) * 0.4;
    const k = 0.74 + 0.56 * n;
    return [WALNUT[0] * k, WALNUT[1] * k, WALNUT[2] * k];
  }));
  const mastBack = -0.62;
  const mastLow = onStand([0, -FOOT - 0.5, mastBack]);
  const mastTop = onStand([0, vm(388), mastBack]);
  mastLow[1] = 0.2;
  const walnutFlat = 0x53321d;
  stand.push(flat(bar(mastLow, mastTop, 0.105, 0.078, 18), walnutFlat));
  const collar = latheUp([[0, 0.2], [0.24, 0.2], [0.24, 0.27], [0.2, 0.3], [0.13, 0.37], [0.112, 0.5], [0.135, 0.56], [0.112, 0.62], [0, 0.63]], { segments: 22 });
  stand.push(flat(collar, walnutFlat, { position: [mastLow[0], 0, mastLow[2]] }));
  stand.push(flat(new THREE.SphereGeometry(0.082, 16, 10).translate(...mastTop), walnutFlat));

  // A padded yoke behind the neck: the neck rests in it and is not held by anything else.
  const yokeY = vm(376);
  const neckBack = vm(fbTop(376) - 7 - 11.5);
  const yokeRoot = onStand([0, yokeY, mastBack]);
  const yokeMid = onStand([0, yokeY, neckBack - 0.2]);
  stand.push(flat(bar(yokeRoot, yokeMid, 0.05, 0.05, 12), walnutFlat));
  stand.push(flat(new THREE.SphereGeometry(0.07, 12, 8).translate(...yokeMid), walnutFlat));
  for (const s of [-1, 1]) {
    const tip = onStand([s * vm(23), yokeY, neckBack + 0.13]);
    stand.push(flat(polyTube([yokeMid, onStand([s * vm(21), yokeY, neckBack - 0.14]), tip], 0.042, 10), walnutFlat));
    stand.push(flat(new THREE.SphereGeometry(0.056, 12, 8).translate(...tip), 0x5e1420));
  }
  const pad = bar(onStand([-vm(21), yokeY, neckBack - 0.075]), onStand([vm(21), yokeY, neckBack - 0.075]), 0.072, 0.072, 12);
  stand.push(flat(pad, 0x5e1420));

  // Two turned posts carry the lower bout on padded rests, either side of the end button.
  for (const sg of [-1, 1]) {
    const rest = onStand([sg * vm(52), vm(8.5) - 0.075, vm(-1)]);
    const post = latheUp([
      [0, BASE_TOP - 0.02], [0.13, BASE_TOP - 0.02], [0.13, BASE_TOP + 0.03], [0.1, BASE_TOP + 0.05], [0.058, BASE_TOP + 0.11],
      [0.05, rest[1] - 0.2], [0.072, rest[1] - 0.15], [0.05, rest[1] - 0.1], [0.05, rest[1] - 0.04], [0, rest[1]],
    ], { segments: 16 });
    stand.push(flat(post, walnutFlat, { position: [rest[0], 0, rest[2]] }));
    stand.push(flat(new THREE.SphereGeometry(0.135, 16, 10).scale(1.25, 0.5, 1.9).translate(rest[0], rest[1], rest[2]), 0x5e1420));
  }

  // --- the bow ---------------------------------------------------------------------------
  // Crossed behind the neck and lying in its own plane, the way the pair is always shown. A bow at
  // four times life is 9.6ft, longer than the violin, so standing upright beside it would make it
  // the taller of the two. It sits in a cup on the base and rests against the mast.
  const bow = violinBow();
  const frogAt = new THREE.Vector3(1.86, BASE_TOP + 0.3, -0.62);
  const tipAt = new THREE.Vector3(-2.75, 0, -1.3);
  tipAt.y = frogAt.y + Math.sqrt(Math.max(1, bow.length ** 2 - frogAt.clone().setY(0).distanceToSquared(tipAt.clone().setY(0))));
  const yAxis = tipAt.clone().sub(frogAt).normalize();
  // Hair on the lower side and turned a little to the student, so the ribbon's flat can be seen.
  const zRef = new THREE.Vector3(0.34, 0, 1).normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zRef).normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const bowMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(frogAt);
  const fromBow = (list, into) => {
    for (const part of list) {
      const g = part.geometry.clone().applyMatrix4(bowMatrix);
      into.push(part.keepColor ? { ...part, geometry: g, tint: undefined, keepColor: true, ...(part.tint ? { geometry: tintGeometry(part.geometry.clone(), part.tint).applyMatrix4(bowMatrix) } : {}) } : { ...part, geometry: g });
    }
  };
  fromBow(bow.wood, stand);
  // A stand-up cup for the frog and a padded peg for the stick where it passes the mast.
  const cupAt = new THREE.Vector3().copy(frogAt).addScaledVector(yAxis, -0.2);
  stand.push(flat(latheUp([
    [0, BASE_TOP - 0.02], [0.2, BASE_TOP - 0.02], [0.2, BASE_TOP + 0.02], [0.14, BASE_TOP + 0.05], [0.1, cupAt.y - 0.09], [0.135, cupAt.y - 0.04], [0.135, cupAt.y], [0.0, cupAt.y + 0.002],
  ], { segments: 18 }), walnutFlat, { position: [cupAt.x, 0, cupAt.z] }));
  // The peg it leans on where it passes the mast.
  const bowAtMast = frogAt.clone().addScaledVector(yAxis, (frogAt.x + 0) / -yAxis.x);
  const pegFrom = onStand([0, vm(300), mastBack]);
  stand.push(flat(bar(pegFrom, [bowAtMast.x, bowAtMast.y, bowAtMast.z + 0.09], 0.04, 0.04, 10), walnutFlat));

  const lacquered = mergeParts(ebony);
  const bowEbony = [];
  const bowMetal = [];
  fromBow(bow.ebony, bowEbony);
  fromBow(bow.metal, bowMetal);

  const plateTexture = violinPlateTexture(outlineMm, arch);
  const flame = flameTexture();
  const bake = (g) => g.applyMatrix4(rake);

  // Stand parts built on the instrument's own axes go through the rake; the rest are already placed.
  const bridgePart = stand.shift();
  const bridgeBaked = tintGeometry(bridgePart.geometry.clone(), bridgePart.tint).applyMatrix4(rake);
  stand.push({ geometry: bridgeBaked, keepColor: true });

  const ebonyAll = mergeParts([
    { geometry: lacquered.applyMatrix4(rake), keepColor: true },
    ...bowEbony,
  ]);
  const metalAll = mergeParts([
    { geometry: mergeParts(metal).applyMatrix4(rake), keepColor: true },
    ...bowMetal,
  ]);

  return group([
    mesh(mergeParts(plates.map((geometry) => ({ geometry, color: 0xffffff }))).applyMatrix4(rake), standard({ map: plateTexture, roughness: 0.3, metalness: 0, vertexColors: false })),
    mesh(bake(mergeParts(maple)), standard({ vertexColors: true, map: flame, roughness: 0.32, metalness: 0 })),
    mesh(ebonyAll, standard({ vertexColors: true, roughness: 0.24, metalness: 0 })),
    mesh(metalAll, standard({ vertexColors: true, roughness: 0.32, metalness: 0.5 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })),
  ], 'violin');
}

// ---------------------------------------------------------------------------
// DJEMBE
// ---------------------------------------------------------------------------

// Twice life size. The goblet is one lathe, the wood's carving is a canvas whose every band repeats
// a whole number of times round the drum so that it closes on itself, and the rope is what the
// budget goes on: it is what makes this a djembe rather than any other goblet drum.

// The outside of the drum: radius at a given height, asked of by everything that lies on it.
function djembeProfile() {
  const knots = [
    [0.648, 0.03], [0.665, 0.07], [0.625, 0.15], [0.53, 0.4], [0.425, 0.74], [0.365, 1.02], [0.335, 1.2], [0.352, 1.38],
    [0.46, 1.62], [0.66, 1.98], [0.86, 2.4], [0.98, 2.82], [1.05, 3.24], [1.08, 3.55], [1.075, 3.72], [1.04, 3.82], [1.0, 3.86],
  ];
  const table = spline2(knots, 16).map(([r, y]) => [y, r]);
  // Three ridges cut round the waist, as a real carver leaves them.
  const ridges = [[1.08, 0.024], [1.2, 0.034], [1.32, 0.024], [0.2, 0.016], [0.26, 0.016]];
  return (y) => {
    let r = polyInterp(table, y);
    for (const [at, h] of ridges) r += h * Math.exp(-(((y - at) / 0.022) ** 2));
    return r;
  };
}

function djembeWoodTexture() {
  const S = 1024;
  const rng = seededRandom(1712);
  const tex = canvasTexture(S, S, (ctx) => {
    const image = ctx.createImageData(S, S);
    const d = image.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        // Grain running up the log. Whole cycles round, so it closes.
        const wob = 0.01 * Math.sin(Math.PI * 2 * (u * 3 + v * 2)) + 0.004 * Math.sin(Math.PI * 2 * (u * 7 + v * 5));
        const g1 = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob) * 40);
        const g2 = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob * 2) * 113);
        const g3 = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob * 0.6) * 271);
        const k = 0.82 + 0.2 * g1 ** 2 + 0.12 * g2 ** 4 + 0.08 * g3 ** 2 - 0.08 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 5 + v)));
        const i = (y * S + x) * 4;
        d[i] = 92 * k; d[i + 1] = 60 * k; d[i + 2] = 37 * k; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    const Y = (ft) => S * (1 - ft / 4); // canvas row for a height on the drum
    const CUT = '#22130a';
    const EDGE = 'rgba(214,160,104,0.8)';
    const ring = (ft, w = 5) => {
      ctx.fillStyle = CUT;
      ctx.fillRect(0, Y(ft) - w / 2, S, w);
      ctx.fillStyle = EDGE;
      ctx.fillRect(0, Y(ft) + w / 2, S, 2);
    };
    // A carved mark is a dark cut with a lit lower edge. Everything is drawn in a whole number of
    // repeats, plus one more copy across the seam.
    const repeatBand = (count, draw) => {
      for (let i = -1; i <= count; i++) draw(((i + 0.5) / count) * S, S / count, i);
    };
    const triangles = (lowFt, highFt, count, up = true) => {
      const a = Y(lowFt);
      const b = Y(highFt);
      repeatBand(count, (cx, w) => {
        const tip = up ? b : a;
        const foot = up ? a : b;
        ctx.fillStyle = CUT;
        ctx.beginPath();
        ctx.moveTo(cx - w * 0.44, foot);
        ctx.lineTo(cx + w * 0.44, foot);
        ctx.lineTo(cx, tip);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = EDGE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx + w * 0.44, foot);
        ctx.lineTo(cx, tip);
        ctx.stroke();
      });
    };
    const diamonds = (lowFt, highFt, count) => {
      const a = Y(lowFt);
      const b = Y(highFt);
      const m = (a + b) / 2;
      repeatBand(count, (cx, w) => {
        ctx.fillStyle = CUT;
        ctx.beginPath();
        ctx.moveTo(cx, a); ctx.lineTo(cx + w * 0.42, m); ctx.lineTo(cx, b); ctx.lineTo(cx - w * 0.42, m);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(150,100,58,1)';
        ctx.beginPath();
        ctx.moveTo(cx, a - (a - m) * 0.45); ctx.lineTo(cx + w * 0.18, m); ctx.lineTo(cx, b + (m - b) * 0.45); ctx.lineTo(cx - w * 0.18, m);
        ctx.closePath();
        ctx.fill();
      });
    };
    const chevrons = (lowFt, highFt, count, lines = 3) => {
      const a = Y(lowFt);
      const b = Y(highFt);
      ctx.strokeStyle = CUT;
      ctx.lineWidth = 5;
      for (let l = 0; l < lines; l++) {
        const top = lerp(a, b, l / lines);
        const h = (b - a) / lines;
        repeatBand(count, (cx, w) => {
          ctx.beginPath();
          ctx.moveTo(cx - w / 2, top);
          ctx.lineTo(cx, top + h * 0.9);
          ctx.lineTo(cx + w / 2, top);
          ctx.stroke();
        });
      }
    };
    // Foot, from the floor up.
    ring(0.075, 6);
    triangles(0.09, 0.19, 28);
    ring(0.2, 5);
    ring(0.26, 5);
    diamonds(0.3, 0.56, 22);
    ring(0.59, 6);
    chevrons(0.63, 0.86, 18, 2);
    ring(0.9, 6);
    // The waist.
    ring(1.03, 5);
    ring(1.37, 5);
    // The lower bowl.
    ring(1.44, 6);
    triangles(1.47, 1.64, 24, false);
    ring(1.66, 5);
    diamonds(1.7, 1.98, 26);
    ring(2.01, 5);
    triangles(2.03, 2.2, 30);
    ring(2.22, 6);
    // Light scatter of knife marks, so the plain wood does not read as a dyed tube.
    for (let i = 0; i < 260; i++) {
      const x = rng() * S;
      const y = rng() * S;
      ctx.fillStyle = 'rgba(20,10,4,0.25)';
      ctx.fillRect(x, y, 1.4, 6 + rng() * 22);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function goatskinTexture() {
  const S = 640;
  return canvasTexture(S, S, (ctx) => {
    const image = ctx.createImageData(S, S);
    const d = image.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const nx = (x / S - 0.5) * 2;
        const ny = (y / S - 0.5) * 2;
        const r = Math.hypot(nx, ny) / 0.98;
        // Where hands land the skin has darkened with years of playing, and darkest of all along
        // the animal's spine, which runs straight across the middle of any goatskin head.
        const worn = Math.exp(-((r / 0.46) ** 2));
        const spine = Math.exp(-((nx / 0.1) ** 2)) * 0.55;
        const mottle = smoothNoise3(nx * 3.1, ny * 3.1, 1.3) * 0.6 + smoothNoise3(nx * 11, ny * 11, 4.1) * 0.4;
        const fleck = smoothNoise3(nx * 90, ny * 90, 7.7);
        const dark = clamp(worn * 0.95 + spine * (1 - r * 0.6) + (mottle - 0.5) * 0.34 + (fleck - 0.5) * 0.09, 0, 1);
        const rim = smooth(0.86, 0.98, r);
        const R = lerp(lerp(236, 136, dark), 158, rim);
        const G = lerp(lerp(218, 94, dark), 112, rim);
        const B = lerp(lerp(182, 54, dark), 72, rim);
        const i = (y * S + x) * 4;
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
}

function ropeTexture() {
  const W = 128;
  const H = 64;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#d9cfb3';
    ctx.fillRect(0, 0, W, H);
    // The lay of a three-strand rope: soft creases running slantwise, each drawn in copies across
    // the edge so that the tile closes on itself in both directions.
    ctx.lineCap = 'butt';
    for (const [style, width, shift] of [['#a4967a', 9, 0], ['rgba(245,238,214,0.75)', 5, W / 8]]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      for (let i = -4; i < 8; i++) {
        const x = (i / 4) * W + shift;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (W / 4) * 3, H);
        ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function djembe() {
  const radius = djembeProfile();
  const ROPE = 0.0235;
  const IRON = 0.033;
  const CROWN_Y = 3.76;
  const LOW_Y = 2.46;
  const crownR = radius(CROWN_Y) + IRON + 0.006;
  const lowR = radius(LOW_Y) + IRON + 0.006;

  // --- the wood --------------------------------------------------------------------------
  const outerRows = [];
  for (let i = 0; i <= 92; i++) {
    const t = i / 92;
    // Rows bunched low on the drum, where the ridges and the foot are.
    const y = lerp(0.03, 3.86, t ** 1.16);
    outerRows.push([radius(y), y]);
  }
  const innerRows = [];
  for (let i = 0; i <= 18; i++) {
    const y = lerp(3.64, 0.02, i / 18);
    innerRows.push([Math.max(0.08, radius(y) - 0.12), y]);
  }
  const body = latheUp([
    [0, 3.64], ...innerRows, [0.56, 0], [0.56, 0], [0.64, 0], [0.64, 0], ...outerRows, [0.92, 3.87], [0, 3.87],
  ], { segments: 72 });
  uvPlanar(body, (x, y, z, u) => [u, y / 4]);

  // --- the skin --------------------------------------------------------------------------
  const skin = latheUp([
    [0, 3.72], [crownR - 0.01, 3.72], [crownR - 0.002, 3.81], [crownR - 0.022, 3.88], [crownR - 0.07, 3.94], [crownR - 0.15, 3.968],
    [0.82, 3.982], [0.6, 3.99], [0.32, 3.997], [0, 4.0],
  ], { segments: 60 });
  uvPlanar(skin, (x, y, z) => [0.5 + x / 2.4, 0.5 + z / 2.4]);

  // --- iron rings ------------------------------------------------------------------------
  const iron = [];
  const hoop = (r, y, tube = IRON) => flat(new THREE.TorusGeometry(r, tube, 8, 80).rotateX(Math.PI / 2).translate(0, y, 0), 0x3b3d40);
  iron.push(hoop(crownR, CROWN_Y));
  iron.push(hoop(crownR + 0.003, CROWN_Y + 0.057, 0.022));
  iron.push(hoop(lowR, LOW_Y));

  // --- the zig-zag -----------------------------------------------------------------------
  // One rope the whole way round: up to the crown ring, over it and back under, down to the bottom
  // ring, under it and back up, thirty times. Every point asks the lathe for the radius at its own
  // height, so the rope lies on the wood wherever it goes.
  //
  // The tuning weave is why a djembe rope makes diamonds. Each horizontal pass pulls pairs of
  // neighbouring legs together, and the next pass pulls the opposite pairs, so a plain zig-zag
  // closes into a lattice. The table below says, at each height, which pair a leg is leaning into.
  const K = 30;
  const DELTA = (Math.PI * 2) / K;
  const TOP = CROWN_Y - 0.075;
  const LOW = LOW_Y + 0.068;
  const NODES = [0, 0.2, 0.5, 0.8, 1];
  const EPS = (ROPE * 1.05) / 0.98;
  const path = [];
  const dense = []; // spans through a loop get extra samples: that is where the curve is tight
  const addLoop = (...points) => { for (const pt of points) { path.push(pt); dense.push(3); } };
  const addLeg = (pt) => { path.push(pt); dense.push(1); };
  const surfaceAt = (theta, y, extra = 0) => {
    const r = radius(y) + ROPE + extra;
    return [Math.sin(theta) * r, y, Math.cos(theta) * r];
  };
  const legTheta = (T, B, side, t) => {
    // T and B are the leg's two ends in angle; `side` is +1 if B is to T's right. At 0.2 and 0.8 a
    // leg leans in over its bottom point with the leg sharing that bottom, at 0.5 over its top point
    // with the leg sharing that top, and each stands one rope-width off the middle of the pair.
    const r = radius(lerp(TOP, LOW, t));
    const eps = EPS / r;
    const key = [T, B - side * eps, T + side * eps, B - side * eps, B];
    let i = 0;
    while (i < NODES.length - 2 && t > NODES[i + 1]) i += 1;
    const f = smooth(NODES[i], NODES[i + 1], t);
    return lerp(key[i], key[i + 1], f);
  };
  const LEG_SAMPLES = 24;
  for (let k = 0; k < K; k++) {
    const T = k * DELTA;
    const B = T + DELTA / 2;
    const T2 = T + DELTA;
    // Over the crown ring.
    addLoop(
      surfaceAt(T - 0.018, TOP),
      [Math.sin(T - 0.012) * (crownR + IRON + ROPE * 0.8), CROWN_Y - 0.01, Math.cos(T - 0.012) * (crownR + IRON + ROPE * 0.8)],
      [Math.sin(T - 0.004) * crownR, CROWN_Y + IRON + ROPE * 0.8, Math.cos(T - 0.004) * crownR],
      [Math.sin(T + 0.004) * (crownR - IRON - ROPE), CROWN_Y - 0.005, Math.cos(T + 0.004) * (crownR - IRON - ROPE)],
      surfaceAt(T + 0.012, CROWN_Y - IRON - ROPE, -ROPE * 0.2),
    );
    // Down a leg to the bottom ring.
    for (let i = 1; i < LEG_SAMPLES; i++) {
      const t = i / LEG_SAMPLES;
      addLeg(surfaceAt(legTheta(T, B, 1, t), lerp(TOP, LOW, t)));
    }
    // Under the bottom ring.
    addLoop(
      surfaceAt(B - 0.012, LOW),
      [Math.sin(B - 0.008) * (lowR + IRON + ROPE * 0.8), LOW_Y + 0.006, Math.cos(B - 0.008) * (lowR + IRON + ROPE * 0.8)],
      [Math.sin(B) * lowR, LOW_Y - IRON - ROPE * 0.8, Math.cos(B) * lowR],
      [Math.sin(B + 0.008) * (lowR + IRON + ROPE * 0.8), LOW_Y + 0.006, Math.cos(B + 0.008) * (lowR + IRON + ROPE * 0.8)],
      surfaceAt(B + 0.012, LOW),
    );
    // And back up the next leg.
    for (let i = LEG_SAMPLES - 1; i >= 1; i--) {
      const t = i / LEG_SAMPLES;
      addLeg(surfaceAt(legTheta(T2, B, -1, t), lerp(TOP, LOW, t)));
    }
  }
  const curve = new THREE.CatmullRomCurve3(path.map(v3), true, 'centripetal');
  const smoothPath = [];
  path.forEach((_, i) => {
    for (let k = 0; k < dense[i]; k++) smoothPath.push(curve.getPoint((i + k / dense[i]) / path.length).toArray());
  });
  const rope = [];
  rope.push(ropeRun(smoothPath, ROPE, { closed: true }));

  // The horizontal passes through the pinches, riding up over each pair and down between.
  for (const t of [0.2, 0.5, 0.8]) {
    const y = lerp(TOP, LOW, t);
    const odd = t === 0.5;
    const pts = [];
    const N = K * 4;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wave = Math.cos(K * (a - (odd ? 0 : DELTA / 2)));
      const r = radius(y) + ROPE + ROPE * (0.95 + 0.85 * wave);
      pts.push([Math.sin(a) * r, y + 0.006 * Math.sin(K * a * 2), Math.cos(a) * r]);
    }
    rope.push(ropeRun(pts, ROPE, { closed: true }));
  }

  // The wrap under the bottom ring: four tight turns of one rope, finishing in a knot and a tail
  // left hanging down the bowl, the way every drummer leaves it for next time.
  const WRAP_TOP = LOW_Y - 0.052;
  const WRAP_PITCH = ROPE * 2.02;
  const wrap = [];
  const TURNS = 4;
  const WRAP_START = 0.6;
  for (let i = 0; i <= TURNS * 48; i++) {
    const a = WRAP_START + (i / 48) * Math.PI * 2;
    const y = WRAP_TOP - (i / 48) * WRAP_PITCH;
    wrap.push(surfaceAt(a, y));
  }
  const endA = WRAP_START + TURNS * Math.PI * 2;
  const endY = WRAP_TOP - TURNS * WRAP_PITCH;
  rope.push(ropeRun(wrap, ROPE));
  const tail = [surfaceAt(endA, endY)];
  const tailY = (i) => endY - 0.05 - i * 0.092;
  for (let i = 0; i < 10; i++) {
    const a = endA + 0.05 * Math.sin(i * 0.9);
    const y = tailY(i);
    // It lies against the bowl until the bowl falls away from it, then it simply hangs.
    const hang = radius(endY) + ROPE - (endY - y) * 0.2;
    const r = Math.max(radius(y) + ROPE * 1.05, hang);
    tail.push([Math.sin(a) * r, y, Math.cos(a) * r]);
  }
  const tailCurve = new THREE.CatmullRomCurve3(tail.map(v3), false, 'centripetal');
  const tailPts = [];
  for (let i = 0; i <= 26; i++) tailPts.push(tailCurve.getPoint(i / 26).toArray());
  rope.push(ropeRun(tailPts, ROPE));
  const knotAt = surfaceAt(endA, endY - 0.01, ROPE * 0.8);
  rope.push(new THREE.SphereGeometry(ROPE * 2.1, 12, 8).translate(...knotAt));
  const tailEnd = tail[tail.length - 1];
  rope.push(new THREE.SphereGeometry(ROPE * 1.25, 10, 6).scale(1, 1.5, 1).translate(tailEnd[0], tailEnd[1] - 0.01, tailEnd[2]));

  const woodMap = djembeWoodTexture();
  return group([
    mesh(body, standard({ map: woodMap, bumpMap: woodMap, bumpScale: 0.9, roughness: 0.5, metalness: 0 })),
    mesh(skin, standard({ map: goatskinTexture(), roughness: 0.68, metalness: 0 })),
    mesh(mergeParts(rope.map((geometry) => ({ geometry, color: 0xffffff }))), (() => {
      const lay = ropeTexture();
      return standard({ map: lay, bumpMap: lay, bumpScale: 0.5, roughness: 0.9, metalness: 0 });
    })()),
    mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.48, metalness: 0.5 })),
  ], 'djembe');
}

// ---------------------------------------------------------------------------
// ARTIST'S EASEL
// ---------------------------------------------------------------------------

// The colour wheel is the point of this model, and its card asks a question about it, so the order
// is a table rather than a drawing. Clockwise from yellow at the top, as in Itten's wheel: the three
// primaries a third of a turn apart, a secondary half way between each pair, a tertiary either side.
// Stepping six places from any colour lands on its complementary, and that is not a coincidence of
// layout but the definition of the arrangement.
export const COLOUR_WHEEL = [
  { name: 'Yellow', hex: '#ffd20a', kind: 'primary', ink: '#3a2c05' },
  { name: 'Yellow-orange', hex: '#ffab08', kind: 'tertiary', ink: '#3a2404' },
  { name: 'Orange', hex: '#f77d0d', kind: 'secondary', ink: '#311703' },
  { name: 'Red-orange', hex: '#e84a14', kind: 'tertiary', ink: '#ffffff' },
  { name: 'Red', hex: '#d5121c', kind: 'primary', ink: '#ffffff' },
  { name: 'Red-violet', hex: '#a3155c', kind: 'tertiary', ink: '#ffffff' },
  { name: 'Violet', hex: '#6a1fa0', kind: 'secondary', ink: '#ffffff' },
  { name: 'Blue-violet', hex: '#3f2ca6', kind: 'tertiary', ink: '#ffffff' },
  { name: 'Blue', hex: '#1250c4', kind: 'primary', ink: '#ffffff' },
  { name: 'Blue-green', hex: '#007f8c', kind: 'tertiary', ink: '#ffffff' },
  { name: 'Green', hex: '#109a3d', kind: 'secondary', ink: '#ffffff' },
  { name: 'Yellow-green', hex: '#94c618', kind: 'tertiary', ink: '#26300a' },
];

function fitFont(ctx, text, maxWidth, start, min, face) {
  let size = start;
  ctx.font = `${face} ${size}px Arial, Helvetica, sans-serif`;
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `${face} ${size}px Arial, Helvetica, sans-serif`;
  }
  return size;
}

function colourWheelTexture() {
  const S = 1024;
  const rng = seededRandom(1919);
  return canvasTexture(S, S, (ctx) => {
    // Primed canvas, off-white with a whisper of brush in it.
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(150,140,120,0.045)';
      ctx.fillRect(rng() * S, rng() * S, 60 + rng() * 180, 1 + rng() * 2.5);
    }
    const cx = S / 2;
    const cy = S / 2 + 16;
    const OUT = 462;
    const IN = 298;
    const STEP = (Math.PI * 2) / 12;
    // Angle 0 is straight up and runs clockwise: canvas y is down, so it is x = sin, y = -cos.
    const at = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
    const arcAngle = (a) => a - Math.PI / 2;
    COLOUR_WHEEL.forEach((c, i) => {
      const a0 = (i - 0.5) * STEP;
      const a1 = (i + 0.5) * STEP;
      ctx.fillStyle = c.hex;
      ctx.beginPath();
      ctx.arc(cx, cy, OUT, arcAngle(a0), arcAngle(a1));
      ctx.arc(cx, cy, IN, arcAngle(a1), arcAngle(a0), true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f3efe4';
      ctx.lineWidth = 5;
      ctx.stroke();
      // Its name, upright on the top half of the wheel and turned to stay upright on the bottom.
      const a = i * STEP;
      const [tx, ty] = at(a, (OUT + IN) / 2);
      const words = c.name.includes('-') ? [`${c.name.split('-')[0]}-`, c.name.split('-')[1]] : [c.name];
      const flip = a > Math.PI / 2 && a < (Math.PI * 3) / 2;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(flip ? a + Math.PI : a);
      ctx.fillStyle = c.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const room = ((OUT + IN) / 2) * STEP * 0.84;
      const size = Math.min(...words.map((w) => fitFont(ctx, w, room, c.kind === 'tertiary' ? 34 : 44, 16, 'bold')));
      ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
      const lead = size * 1.06;
      words.forEach((w, n) => ctx.fillText(w, 0, (n - (words.length - 1) / 2) * lead));
      ctx.restore();
    });
    // The middle: the three primaries in a triangle, and on each side of it the secondary those two
    // primaries make, so the sum is on the canvas as well as the answer.
    const R = 268;
    const corner = (i) => at(i * STEP, R);
    const [Y, Oo, Rr, Vv, Bb, Gg] = [0, 2, 4, 6, 8, 10].map(corner);
    const hex = (i) => COLOUR_WHEEL[i].hex;
    const tri = (a, b, c, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f3efe4';
      ctx.lineWidth = 5;
      ctx.stroke();
    };
    tri(Y, Oo, Rr, hex(2));
    tri(Rr, Vv, Bb, hex(6));
    tri(Bb, Gg, Y, hex(10));
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const centre = [cx, cy];
    const quad = (a, b, c, d, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(c[0], c[1]);
      ctx.lineTo(d[0], d[1]);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#f3efe4';
      ctx.lineWidth = 5;
      ctx.stroke();
    };
    quad(Y, mid(Y, Rr), centre, mid(Bb, Y), hex(0));
    quad(Rr, mid(Rr, Bb), centre, mid(Y, Rr), hex(4));
    quad(Bb, mid(Bb, Y), centre, mid(Rr, Bb), hex(8));
    // Corners: a title, and the one sentence the card's question hangs on.
    ctx.fillStyle = '#35302a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    fitFont(ctx, 'The Colour', 200, 40, 18, 'bold');
    ctx.fillText('The Colour', 26, 58);
    ctx.fillText('Wheel', 26, 100);
    ctx.textAlign = 'right';
    fitFont(ctx, 'are complementary', 196, 26, 14, 'bold');
    // Held above the tray's lip, which hides the canvas's bottom inch from anyone standing.
    ctx.fillText('Colours opposite', S - 26, S - 106);
    ctx.fillText('are complementary', S - 26, S - 74);
  });
}

function woodGrainTile() {
  const S = 256;
  const tex = canvasTexture(S, S, (ctx) => {
    const image = ctx.createImageData(S, S);
    const d = image.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const wob = 0.006 * Math.sin(Math.PI * 2 * (v + u)) + 0.003 * Math.sin(Math.PI * 2 * (v * 3 + u * 2));
        const a = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob) * 17);
        const b = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob * 1.6) * 61);
        const c = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 3 + v));
        const k = 250 - 22 * a ** 6 - 12 * b ** 3 - 6 * c;
        const i = (y * S + x) * 4;
        d[i] = k; d[i + 1] = k; d[i + 2] = k; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.4, 0.28);
  return tex;
}

export function artistsEasel() {
  const wood = [];
  const cloth = [];
  const metal = [];
  const paint = [];
  const glass = [];

  const BEECH = 0xc08c52;
  const BEECH_DARK = 0xa97540;
  const STEEL = 0x8d9094;
  const RAKE = 0.175;
  const XOFF = -0.42;
  const Z0 = 0.62;
  const cosR = Math.cos(RAKE);
  const sinR = Math.sin(RAKE);
  // The easel leans back 10 degrees, and everything on the mast is authored in the mast's own
  // frame: x across, h up its length, n out of its front. F takes a point out of that frame.
  const F = (x, h, n = 0) => [x + XOFF, h * cosR + n * sinR, Z0 - h * sinR + n * cosR];
  const FM = new THREE.Matrix4().makeRotationX(-RAKE).setPosition(XOFF, 0, Z0);
  const mastSpace = (g) => g.applyMatrix4(FM);

  // --- the frame -------------------------------------------------------------------------
  const MAST_TOP = 6.05;
  wood.push(flat(beam(F(0, 0.36), F(0, MAST_TOP), 0.21, 0.13, { side: [1, 0, 0], r: 0.018 }), BEECH));
  // A rounded cap on the mast.
  wood.push(flat(mastSpace(new THREE.SphereGeometry(0.108, 16, 10).scale(1, 0.34, 0.62).translate(0, MAST_TOP, 0)), BEECH));
  const foot = (s) => F(s * 1.22, 0.04, -0.105);
  const head = (s) => F(s * 0.11, 5.76, -0.105);
  for (const s of [-1, 1]) {
    wood.push(flat(beam(head(s), foot(s), 0.135, 0.085, { side: [1, 0, 0], r: 0.016 }), BEECH_DARK));
  }
  const legX = (h) => lerp(1.22, 0.11, (h - 0.04) / 5.72);
  // Cross rails, each running a little past the leg so that a joint can never show daylight.
  for (const [h, w] of [[0.74, 0.17], [1.62, 0.13], [3.5, 0.1], [5.46, 0.11]]) {
    wood.push(flat(beam(F(-legX(h) - 0.09, h, -0.16), F(legX(h) + 0.09, h, -0.16), w, 0.06, { side: [0, cosR, -sinR], r: 0.012 }), BEECH));
  }
  // The hinge block at the head, and the back leg hanging from it.
  wood.push(flat(mastSpace(new THREE.BoxGeometry(0.34, 0.3, 0.16).translate(0, 5.72, -0.16)), BEECH));
  const backTop = F(0, 5.66, -0.27);
  const backFoot = [XOFF, 0.03, -1.1];
  wood.push(flat(beam(backTop, backFoot, 0.135, 0.09, { side: [1, 0, 0], r: 0.016 }), BEECH_DARK));
  metal.push(flat(mastSpace(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 12).rotateZ(Math.PI / 2).translate(0, 5.68, -0.24)), STEEL));
  for (const s of [-1, 1]) {
    metal.push(flat(mastSpace(new THREE.CylinderGeometry(0.052, 0.052, 0.022, 14).rotateZ(Math.PI / 2).translate(s * 0.225, 5.68, -0.24)), 0x6a6d72));
  }
  // The stay between the back leg and the bottom rail, which is what actually holds it open.
  const stayFront = F(0, 0.74, -0.2);
  const stayT = (1.08 - backTop[1]) / (backFoot[1] - backTop[1]);
  const stayBack = [lerp(backTop[0], backFoot[0], stayT), lerp(backTop[1], backFoot[1], stayT) + 0.0, lerp(backTop[2], backFoot[2], stayT) + 0.03];
  wood.push(flat(beam(stayFront, stayBack, 0.1, 0.05, { side: [1, 0, 0], r: 0.012 }), BEECH));
  metal.push(flat(bar([stayFront[0] - 0.09, stayFront[1], stayFront[2]], [stayFront[0] + 0.09, stayFront[1], stayFront[2]], 0.024, 0.024, 10), STEEL));
  metal.push(flat(bar([stayBack[0] - 0.09, stayBack[1], stayBack[2]], [stayBack[0] + 0.09, stayBack[1], stayBack[2]], 0.024, 0.024, 10), STEEL));

  // --- tray and carriage ------------------------------------------------------------------
  const TRAY_H = 2.3;
  const trayProfile = [
    [-0.11, TRAY_H - 0.1], [0.5, TRAY_H - 0.1], [0.5, TRAY_H + 0.05], [0.44, TRAY_H + 0.05], [0.44, TRAY_H - 0.015], [0.24, TRAY_H - 0.015],
    [0.24, TRAY_H + 0.05], [0.215, TRAY_H + 0.05], [0.215, TRAY_H], [0.072, TRAY_H], [0.072, TRAY_H + 0.05], [-0.11, TRAY_H + 0.05],
  ];
  wood.push(flat(mastSpace(sideSolid(trayProfile, [[0.006, -1.62], [0, -1.614], [0, 1.614], [0.006, 1.62]], { crease: 40 })), BEECH));
  wood.push(flat(beam(F(0, TRAY_H - 0.34), F(0, TRAY_H + 0.12), 0.3, 0.21, { side: [1, 0, 0], r: 0.02 }), BEECH_DARK));
  // The wing bolt behind it that sets the tray's height.
  metal.push(flat(mastSpace(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 10).rotateX(Math.PI / 2).translate(0, TRAY_H - 0.16, -0.2)), STEEL));
  const wing = (h, n) => {
    metal.push(flat(mastSpace(new THREE.CylinderGeometry(0.05, 0.062, 0.05, 12).rotateX(Math.PI / 2).translate(0, h, n)), 0x777a7f));
    metal.push(flat(mastSpace(plateSolid(roundPoly([[-0.16, -0.03], [-0.05, -0.05], [0.05, -0.05], [0.16, -0.03], [0.16, 0.03], [0.05, 0.05], [-0.05, 0.05], [-0.16, 0.03]], 0.025, 2), [], [[0, -0.014], [0, 0.014]], { crease: 50 }).translate(0, h, n - 0.02)), 0x777a7f));
  };
  wing(TRAY_H - 0.16, -0.31);

  // --- the canvas ------------------------------------------------------------------------
  const CW = 2.6;
  const H0 = TRAY_H;
  const H1 = H0 + CW;
  const FACE = 0.215;
  const BACK = 0.072;
  const faceGeo = plateSolid([[-CW / 2, H0], [CW / 2, H0], [CW / 2, H1], [-CW / 2, H1]], [], [[0, FACE - 0.012], [0.004, FACE - 0.002], [0.009, FACE]], { crease: 30 });
  uvPlanar(faceGeo, (x, y) => [x / CW + 0.5, (y - H0) / CW]);
  mastSpace(faceGeo);
  // The stretched fabric edge, with the corner fold showing: real canvas is pulled round the bars.
  const edge = plateSolid([[-CW / 2, H0], [CW / 2, H0], [CW / 2, H1], [-CW / 2, H1]],
    [[[-CW / 2 + 0.03, H0 + 0.03], [CW / 2 - 0.03, H0 + 0.03], [CW / 2 - 0.03, H1 - 0.03], [-CW / 2 + 0.03, H1 - 0.03]]],
    [[0, BACK - 0.012], [0, FACE - 0.004]], { crease: 30 });
  uvPlanar(edge, (x, y, z, u, v) => [u * 2.2, v * 7]);
  cloth.push(painted(mastSpace(edge), () => lin(0xe9e1cd)));
  // Stretcher bars and a brace, seen from the back, with the raw canvas between them.
  const bars = [
    [[-CW / 2 + 0.095, H0 + 0.03], [-CW / 2 + 0.095, H1 - 0.03], 0.13],
    [[CW / 2 - 0.095, H0 + 0.03], [CW / 2 - 0.095, H1 - 0.03], 0.13],
    [[-CW / 2 + 0.03, H0 + 0.095], [CW / 2 - 0.03, H0 + 0.095], 0.13],
    [[-CW / 2 + 0.03, H1 - 0.095], [CW / 2 - 0.03, H1 - 0.095], 0.13],
    [[-CW / 2 + 0.09, (H0 + H1) / 2], [CW / 2 - 0.09, (H0 + H1) / 2], 0.14],
  ];
  for (const [a, b, w] of bars) {
    const horizontal = Math.abs(a[1] - b[1]) < 0.01;
    wood.push(flat(mastSpace(beam([a[0], a[1], (BACK + 0.178) / 2], [b[0], b[1], (BACK + 0.178) / 2], horizontal ? w : w, 0.106, { side: horizontal ? [0, 1, 0] : [1, 0, 0], r: 0.008, steps: 1 })), 0xc9a06c));
  }
  cloth.push(painted(mastSpace(new THREE.BoxGeometry(CW - 0.06, CW - 0.06, 0.02).translate(0, (H0 + H1) / 2, FACE - 0.03)), () => lin(0xd9cdb4)));
  // Staples along the back of the bars, the small truth you only see by walking round.
  for (let i = 0; i < 40; i++) {
    const t = (i + 0.5) / 10;
    const side = Math.floor(t);
    const f = t - side;
    const p = [
      [lerp(-1.22, 1.22, f), H0 + 0.055], [1.255, lerp(H0 + 0.08, H1 - 0.08, f)],
      [lerp(1.22, -1.22, f), H1 - 0.055], [-1.255, lerp(H1 - 0.08, H0 + 0.08, f)],
    ][side];
    const across = side % 2 === 1;
    metal.push(flat(mastSpace(new THREE.BoxGeometry(across ? 0.012 : 0.05, across ? 0.05 : 0.012, 0.008).translate(p[0], p[1], BACK - 0.012)), 0xb6b9bd));
  }

  // --- the clamp -------------------------------------------------------------------------
  const CLAMP = H1 + 0.005;
  wood.push(flat(beam(F(0, CLAMP - 0.02), F(0, CLAMP + 0.36), 0.3, 0.21, { side: [1, 0, 0], r: 0.02 }), BEECH_DARK));
  wood.push(flat(mastSpace(sideSolid([[-0.08, CLAMP + 0.01], [0.27, CLAMP + 0.01], [0.27, CLAMP - 0.1], [0.215 + 0.006, CLAMP - 0.1], [0.215 + 0.006, CLAMP - 0.012], [0.05, CLAMP - 0.012], [0.05, CLAMP + 0.1], [-0.08, CLAMP + 0.1]],
    [[0.006, -0.19], [0, -0.184], [0, 0.184], [0.006, 0.19]], { crease: 40 })), BEECH));
  metal.push(flat(mastSpace(new THREE.CylinderGeometry(0.024, 0.024, 0.3, 10).rotateX(Math.PI / 2).translate(0, CLAMP + 0.2, -0.2)), STEEL));
  wing(CLAMP + 0.2, -0.31);

  // --- the side stool --------------------------------------------------------------------
  const SX = 2.1;
  const SZ = 0.42;
  const SEAT = 1.72;
  const seat = latheUp([
    [0, SEAT - 0.13], [0.62, SEAT - 0.13], [0.72, SEAT - 0.11], [0.79, SEAT - 0.07], [0.795, SEAT - 0.03], [0.77, SEAT - 0.004], [0.745, SEAT], [0.745, SEAT], [0, SEAT],
  ], { segments: 44 });
  uvPlanar(seat, (x, y, z) => [x * 0.7, z * 1.2]);
  wood.push(flat(seat, 0x75482a, { position: [SX, 0, SZ] }));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const ax = Math.sin(a);
    const az = Math.cos(a);
    const top = [SX + ax * 0.44, SEAT - 0.08, SZ + az * 0.44];
    const bot = [SX + ax * 0.74, 0.02, SZ + az * 0.74];
    const legSteps = spline2([[0.03, 0], [0.05, 0.4], [0.062, 0.85], [0.052, 1.3], [0.05, 1.5]], 3).map(([r], k, list) => {
      const t = k / (list.length - 1);
      return { p: [lerp(bot[0], top[0], t), lerp(bot[1], top[1], t), lerp(bot[2], top[2], t)], r };
    });
    wood.push(flat(polyTube(legSteps.map((n) => n.p), legSteps.map((n) => n.r), 12), BEECH_DARK));
    const next = ((i + 1) / 3) * Math.PI * 2 + 0.5;
    const stretcherA = [SX + Math.sin(a) * 0.645, 0.6, SZ + Math.cos(a) * 0.645];
    const stretcherB = [SX + Math.sin(next) * 0.645, 0.6, SZ + Math.cos(next) * 0.645];
    wood.push(flat(bar(stretcherA, stretcherB, 0.03, 0.03, 10), BEECH_DARK));
  }

  // --- the palette, lying on the stool ----------------------------------------------------
  const PY = SEAT + 0.002;
  const PX = SX - 0.1;
  const PZ = SZ + 0.14;
  const pal = (x, z) => {
    // Rotated a little so it does not sit square to the stool.
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    return [PX + x * c + z * s, PZ - x * s + z * c];
  };
  const kidney = spline2([
    [0.74, 0.02], [0.64, 0.3], [0.32, 0.45], [-0.14, 0.47], [-0.54, 0.34], [-0.75, 0.04], [-0.68, -0.25], [-0.36, -0.32],
    [-0.09, -0.2], [0.13, -0.08], [0.4, -0.17], [0.65, -0.17], [0.74, 0.02],
  ], 5);
  kidney.pop();
  const thumb = circlePts(-0.42, 0.02, 0.1, 20);
  const palGeo = planSolid(kidney.map(([x, z]) => pal(x, z)), [thumb.map(([x, z]) => pal(x, z))],
    [[0.008, PY], [0, PY + 0.008], [0, PY + 0.026], [0.012, PY + 0.036]]);
  uvPlanar(palGeo, (x, y, z) => [x * 0.9, z * 2.2]);
  wood.push(flat(palGeo, 0xd2a569));
  const palTop = PY + 0.036;
  const rng = seededRandom(1923);
  const blob = (x, z, r, tall) => {
    const g = new THREE.SphereGeometry(r, 18, 12);
    const p = g.attributes.position;
    const phase = rng() * 10;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / r;
      const nz = p.getZ(i) / r;
      const k = 1 + 0.1 * Math.sin(nx * 3 + phase) * Math.cos(nz * 2.4 - phase) + 0.05 * Math.sin((nx + nz) * 5 + phase);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.scale(1, tall / r, 1);
    const [wx, wz] = pal(x, z);
    g.translate(wx, palTop + tall * 0.45, wz);
    return g;
  };
  // Primaries first, then what they mix to, in the order a painter sets them out round the edge.
  const DAUBS = [
    [0.56, 0.17, 0.095, 0.06, 0xf7c60a], [0.34, 0.31, 0.09, 0.06, 0xee7d12], [0.08, 0.37, 0.095, 0.065, 0xd4181f],
    [-0.18, 0.37, 0.088, 0.058, 0x7a2aa6], [-0.46, 0.27, 0.092, 0.062, 0x1551c0], [-0.64, 0.04, 0.078, 0.052, 0x10903a], [-0.56, -0.19, 0.072, 0.05, 0xf1ece0],
  ];
  for (const [x, z, r, t, color] of DAUBS) paint.push(flat(blob(x, z, r, t), color));
  // Two smears in the middle where two colours are actually being mixed. The blend runs across
  // each smear, because that is the whole lesson of a palette.
  const smear = (x, z, r, tall, a, m, b, seed) => {
    const g = new THREE.SphereGeometry(r, 26, 14);
    g.scale(1.5, 1, 0.82);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / r;
      const nz = p.getZ(i) / r;
      const k = 1 + 0.12 * Math.sin(nx * 5 + seed) * Math.cos(nz * 5 - seed);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    g.scale(1, tall / r, 1);
    // Paint does not mix like light. Halfway from yellow to blue is GREEN, and a straight blend of
    // the two RGB values gives grey lilac, so the middle of the smear is told what it is.
    const ca = lin(a);
    const cm = lin(m);
    const cb = lin(b);
    tintGeometry(g, (q) => {
      const t = smooth(-r * 1.25, r * 1.25, q.x + Math.sin(q.z * 26) * 0.03);
      const [p, w, q2] = t < 0.5 ? [ca, cm, t * 2] : [cm, cb, (t - 0.5) * 2];
      return [lerp(p[0], w[0], q2), lerp(p[1], w[1], q2), lerp(p[2], w[2], q2)];
    });
    const [wx, wz] = pal(x, z);
    g.rotateY(0.5 + seed);
    g.translate(wx, palTop + tall * 0.2, wz);
    return { geometry: g, keepColor: true };
  };
  paint.push(smear(0.32, 0.08, 0.125, 0.02, 0xf7c60a, 0xee7d12, 0xd4181f, 0.3));
  paint.push(smear(-0.1, 0.1, 0.12, 0.018, 0xf7c60a, 0x109a3d, 0x1551c0, 1.1));

  // --- the jar of brushes -----------------------------------------------------------------
  const JX = SX + 0.36;
  const JZ = SZ - 0.4;
  const JAR_R = 0.22;
  const JAR_H = 0.62;
  const jar = latheUp([
    [0, SEAT], [JAR_R - 0.03, SEAT], [JAR_R, SEAT + 0.03], [JAR_R, SEAT + JAR_H - 0.03], [JAR_R + 0.008, SEAT + JAR_H - 0.012], [JAR_R + 0.008, SEAT + JAR_H],
    [JAR_R - 0.016, SEAT + JAR_H], [JAR_R - 0.016, SEAT + 0.05], [JAR_R - 0.05, SEAT + 0.028], [0, SEAT + 0.028],
  ], { segments: 32 });
  glass.push(flat(jar, 0xdfeef2, { position: [JX, 0, JZ] }));
  const water = latheUp([[0, SEAT + 0.03], [JAR_R - 0.05, SEAT + 0.03], [JAR_R - 0.02, SEAT + 0.05], [JAR_R - 0.02, SEAT + 0.34], [0, SEAT + 0.34]], { segments: 26 });
  glass.push(flat(water, 0x8ea59a, { position: [JX, 0, JZ] }));
  const BRUSHES = [
    { a: 0.3, lean: 0.17, len: 1.34, r: 0.021, tip: 0x1551c0, wood: 0x8d5a2c, flat: false },
    { a: 1.5, lean: 0.21, len: 1.2, r: 0.025, tip: 0xd4181f, wood: 0x263f73, flat: true },
    { a: 2.7, lean: 0.14, len: 1.42, r: 0.017, tip: 0xf0c30a, wood: 0x8a2f25, flat: false },
    { a: 3.9, lean: 0.2, len: 1.26, r: 0.029, tip: 0x10903a, wood: 0x2c2a28, flat: true },
    { a: 5.1, lean: 0.18, len: 1.12, r: 0.02, tip: 0x6a2aa6, wood: 0xa97540, flat: false },
  ];
  const brushInto = ({ from, dir, len, r, tip, woodColor, wide }) => {
    const at = (t) => [from[0] + dir.x * t, from[1] + dir.y * t, from[2] + dir.z * t];
    const handleEnd = len * 0.72;
    const rows = [[0, r * 0.5], [len * 0.14, r * 0.85], [len * 0.42, r * 1.14], [handleEnd, r * 0.92]];
    wood.push(flat(polyTube(rows.map(([t]) => at(t)), rows.map(([, q]) => q), 10), woodColor));
    metal.push(flat(bar(at(handleEnd - 0.01), at(handleEnd + 0.1), r * 0.98, r * (wide ? 1.3 : 1.12), 12), 0xc3c5c8));
    const B = len * 0.72 + 0.09;
    const bristle = polyTube(wide
      ? [at(B), at(B + 0.07), at(B + 0.13), at(B + 0.17)]
      : [at(B), at(B + 0.08), at(B + 0.17), at(B + 0.24)],
    wide ? [r * 1.2, r * 1.5, r * 1.5, r * 1.1] : [r * 1.05, r * 1.32, r * 0.86, r * 0.1], 10, wide ? 1.7 : 1);
    cloth.push(painted(bristle, (p) => {
      const t = clamp(((p.x - from[0]) * dir.x + (p.y - from[1]) * dir.y + (p.z - from[2]) * dir.z - B) / (wide ? 0.17 : 0.24), 0, 1);
      const tan = lin(0xcbb48a);
      const c = lin(tip);
      const k = smooth(0.25, 0.75, t);
      return [lerp(tan[0], c[0], k), lerp(tan[1], c[1], k), lerp(tan[2], c[2], k)];
    }));
  };
  for (const b of BRUSHES) {
    const dir = new THREE.Vector3(Math.sin(b.a) * b.lean, 1, Math.cos(b.a) * b.lean).normalize();
    const from = [JX - Math.sin(b.a) * 0.09, SEAT + 0.05, JZ - Math.cos(b.a) * 0.09];
    brushInto({ from, dir, len: b.len, r: b.r, tip: b.tip, woodColor: b.wood, wide: b.flat });
  }
  // One brush laid in the tray, as if somebody had just put it down.
  {
    const from = F(-0.72, TRAY_H - 0.015 + 0.03, 0.34);
    const to = F(0.34, TRAY_H - 0.015 + 0.03, 0.31);
    const dir = v3(to).sub(v3(from)).normalize();
    brushInto({ from, dir, len: 1.1, r: 0.024, tip: 0xd4181f, woodColor: 0x8d5a2c, wide: false });
  }

  // Paint tubes in the tray, primaries, each crimped flat at its tail.
  const TUBES = [[0.46, 0.3, 0xd4181f, 0.05], [0.93, 0.335, 0xf0c30a, -0.1], [0.68, 0.395, 0x1551c0, 0.14]];
  for (const [x, n, color, yaw] of TUBES) {
    const h = TRAY_H - 0.015;
    const L = 0.46;
    const body = latheUp([
      [0, 0], [0.03, 0], [0.042, 0.008], [0.046, 0.02], [0.046, L * 0.3], [0.046, L * 0.55], [0.046, L * 0.8], [0.046, L - 0.02], [0.03, L - 0.006], [0, L],
    ], { segments: 14 });
    const pos = body.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / L;
      const crimp = smooth(0.5, 0.0, t);
      pos.setX(i, pos.getX(i) * (1 + crimp * 0.5));
      pos.setZ(i, pos.getZ(i) * (1 - crimp * 0.86));
    }
    body.computeVertexNormals();
    body.rotateZ(-Math.PI / 2).rotateY(yaw).translate(x, h + 0.044, n);
    metal.push(painted(mastSpace(body), () => lin(0xd5d6d6)));
    const band = latheUp([[0.0475, L * 0.3], [0.0475, L * 0.72]], { segments: 14 }).rotateZ(-Math.PI / 2).rotateY(yaw).translate(x, h + 0.044, n);
    paint.push(flat(mastSpace(band), color));
    const cap = latheUp([[0, L - 0.01], [0.026, L - 0.01], [0.026, L + 0.04], [0, L + 0.04]], { segments: 12 }).rotateZ(-Math.PI / 2).rotateY(yaw).translate(x, h + 0.044, n);
    wood.push(flat(mastSpace(cap), 0x24211e));
  }
  // The row of adjusting holes in the mast, each one a dark stud: there is no CSG to drill them.
  for (let i = 0; i < 16; i++) {
    const h = 0.72 + i * 0.1;
    if (h > TRAY_H - 0.42) continue;
    metal.push(flat(mastSpace(new THREE.SphereGeometry(0.022, 10, 6).scale(1, 1, 0.22).translate(0, h, 0.065)), 0x1f1c18));
  }
  for (let i = 0; i < 4; i++) {
    metal.push(flat(mastSpace(new THREE.SphereGeometry(0.022, 10, 6).scale(1, 1, 0.22).translate(0, H1 + 0.52 + i * 0.1, 0.065)), 0x1f1c18));
  }
  // --- assemble ---------------------------------------------------------------------------
  const grain = woodGrainTile();
  const wheel = colourWheelTexture();
  const weave = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(120,120,120,0.5)';
    for (let i = 0; i < 16; i++) {
      ctx.fillRect(0, (i / 16) * h, w, 2);
      ctx.fillRect((i / 16) * w, 0, 2, h);
    }
  });
  weave.wrapS = THREE.RepeatWrapping;
  weave.wrapT = THREE.RepeatWrapping;
  weave.colorSpace = THREE.NoColorSpace;
  weave.repeat.set(16, 16);
  return group([
    mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, roughness: 0.56, metalness: 0 })),
    // Held a little under full brightness: at full albedo the sun clips the primaries toward white
    // and yellow, the one the card opens with, comes out cream. A small self-lit share keeps the
    // colours true on the shaded side, which matters more here than it would on any other surface.
    mesh(faceGeo, standard({ map: wheel, color: 0xdcdcdc, emissive: 0xffffff, emissiveMap: wheel, emissiveIntensity: 0.09, roughness: 0.9, metalness: 0, bumpMap: weave, bumpScale: 0.2 })),
    mesh(mergeParts(cloth), standard({ vertexColors: true, roughness: 0.92, metalness: 0 })),
    mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.4, metalness: 0.5 })),
    mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.2, metalness: 0 })),
    mesh(mergeParts(glass), standard({
      vertexColors: true, transparent: true, opacity: 0.34, roughness: 0.08, metalness: 0, depthWrite: false,
    })),
  ], 'artists-easel');
}

export const BUILDERS = {
  'grand-piano': grandPiano,
  violin,
  djembe,
  'artists-easel': artistsEasel,
};
