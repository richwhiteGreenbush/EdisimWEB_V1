import * as THREE from 'three';
import { standard, mesh, canvasTexture, relief, seededRandom } from '../../PropKit.js';
import { mergeParts, roundedOutline } from '../../props/LoftKit.js';
import { lathe, lin, mix, clamp01, sstep, alongMatrix, outward } from '../ModelKit.js';

// The Model Database's Math & Geometry models: the five Platonic solids, the Pythagorean theorem in
// tiles, a chambered nautilus cut in half, and a Mobius strip.
//
// MATHEMATICAL CORRECTNESS IS THE WHOLE POINT OF THIS FILE, so nothing a student is invited to count
// or read is drawn by hand. Each model starts from a small pure function that computes it, the
// builder draws what that function returned, and MATH_LAYOUTS exports the four so that the arithmetic
// can be checked without looking. A label printed on a pedestal reads its numbers off the same data
// the rods and balls were placed from, so the two cannot disagree.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1, a few merged
// meshes each.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Private solids
// ---------------------------------------------------------------------------

function rod(a, b, radius, { sides = 10, radiusB = null } = {}) {
  const from = V(a[0], a[1], a[2]);
  const axis = V(b[0], b[1], b[2]).sub(from);
  const g = new THREE.CylinderGeometry(radiusB ?? radius, radius, axis.length(), sides, 1, false);
  g.translate(0, axis.length() / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(from, q, V(1, 1, 1)));
  return g;
}

function ball(radius, at, detail = 12) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.round(detail * 0.7)));
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A slab with rounded corners, built up a BOTTOM-UP [inset, y] profile: a moulded plinth, a tile, a
// plaque. Each band of the profile and each cap owns its vertices, so a flat top stays flat rather
// than shading like a pillow. UVs are in feet.
function roundedSlab(halfW, halfD, corner, profile, { steps = 5 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringAt = (inset) => roundedOutline(halfW - inset, halfD - inset, Math.max(0.005, corner - inset), steps).map(([x, y]) => [x, -y]);
  const pushRing = (ring, y) => {
    const start = positions.length / 3;
    let run = 0;
    ring.forEach(([x, z], i) => {
      if (i) run += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
      positions.push(x, y, z);
      uvs.push(run, y);
    });
    return start;
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const lo = ringAt(profile[i][0]);
    const hi = ringAt(profile[i + 1][0]);
    const n = lo.length;
    const a = pushRing(lo, profile[i][1]);
    const b = pushRing(hi, profile[i + 1][1]);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      indices.push(a + j, a + j2, b + j2, a + j, b + j2, b + j);
    }
  }
  for (const [index, top] of [[0, false], [profile.length - 1, true]]) {
    const ring = ringAt(profile[index][0]);
    const y = profile[index][1];
    const start = positions.length / 3;
    for (const [x, z] of ring) {
      positions.push(x, y, z);
      uvs.push(x, z);
    }
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    uvs.push(0, 0);
    for (let j = 0; j < ring.length; j++) {
      const j2 = (j + 1) % ring.length;
      if (top) indices.push(centre, start + j, start + j2);
      else indices.push(centre, start + j2, start + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return outward(g);
}

// Worked square timber between two points, with chamfered arrises. UVs run along its length in feet,
// which is the way the grain runs.
function timber(a, b, w, h, c = 0.035) {
  const { m, len } = alongMatrix(a, b);
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
    for (const p of section) {
      positions.push(p[0], p[1], z);
      uvs.push(p[0], p[1]);
    }
    for (let i = 1; i < section.length - 1; i++) {
      if (z === 0) indices.push(at, at + i + 1, at + i);
      else indices.push(at, at + i, at + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.applyMatrix4(m);
  g.computeVertexNormals();
  return outward(g);
}

// A grid of vertices from a function. `fn(i, j)` returns { p, c, uv }. A row repeated at the same
// place creases the surface there, since the zero-area strip between them contributes no normal.
// `facing` is a direction the surface must on the whole face, and the winding is measured against it
// rather than assumed: a hand-built grid's handedness depends on the order of its rows and columns.
function grid(ni, nj, fn, facing) {
  const positions = [];
  const colors = [];
  const uvs = [];
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const { p, c, uv } = fn(i, j);
      positions.push(p[0], p[1], p[2]);
      colors.push(c[0], c[1], c[2]);
      uvs.push(uv[0], uv[1]);
    }
  }
  const stride = nj + 1;
  const indices = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + j + 1;
      const d = i * stride + j + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  let sum = 0;
  const P = positions;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3; const b = indices[t + 1] * 3; const c = indices[t + 2] * 3;
    const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
    sum += (uy * vz - uz * vy) * facing[0] + (uz * vx - ux * vz) * facing[1] + (ux * vy - uy * vx) * facing[2];
  }
  if (sum < 0) {
    for (let t = 0; t < indices.length; t += 3) {
      const b = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// Near-white timber grain. A map multiplies the vertex colour, so one tile serves every wood here,
// and it runs along u, which timber() and roundedSlab() both lay in feet.
function grainMap(seed, repeatU = 0.2, repeatV = 0.5) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4efe8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const y = rng() * h;
      const a = 0.06 + rng() * 0.26;
      ctx.strokeStyle = rng() < 0.7 ? `rgba(70,42,22,${a})` : `rgba(255,236,206,${a})`;
      ctx.lineWidth = 0.6 + rng() * 2.2;
      const wobble = 1.5 + rng() * 6;
      const phase = rng() * Math.PI * 2;
      const waves = 1 + Math.floor(rng() * 2);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) {
        const yy = y + Math.sin((x / w) * Math.PI * 2 * waves + phase) * wobble;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatU, repeatV);
  return texture;
}

// Writes `text` at the largest size up to `size` that fits `maxWidth`. Every bit of printing in this
// file goes through it: a line that runs off its plaque clipped mid-word is the project's most
// repeated bug.
function fitText(ctx, text, x, y, maxWidth, size, family = 'Georgia, "Times New Roman", serif', weight = 'bold') {
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

// A flat plane facing +Z with its UVs set to one rectangle of an atlas, given in canvas pixels.
function atlasPlane(width, height, rect, atlasW, atlasH) {
  const g = new THREE.PlaneGeometry(width, height);
  const uv = g.attributes.uv;
  const [x, y, w, h] = rect;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (x + uv.getX(i) * w) / atlasW, 1 - (y + (1 - uv.getY(i)) * h) / atlasH);
  }
  return g;
}

function plateMatrix(at, tiltBack = 0) {
  return new THREE.Matrix4().compose(V(at[0], at[1], at[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(-tiltBack, 0, 0)), V(1, 1, 1));
}

// ---------------------------------------------------------------------------
// The five Platonic solids
// ---------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

function cartesianVertices(key) {
  const out = [];
  const s = [-1, 1];
  if (key === 'tetrahedron') return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  if (key === 'octahedron') return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  if (key === 'cube' || key === 'dodecahedron') for (const a of s) for (const b of s) for (const c of s) out.push([a, b, c]);
  if (key === 'dodecahedron') {
    for (const a of s) {
      for (const b of s) {
        out.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
      }
    }
  }
  if (key === 'icosahedron') {
    for (const a of s) {
      for (const b of s) {
        out.push([0, a, b * PHI], [a, b * PHI, 0], [a * PHI, 0, b]);
      }
    }
  }
  return out;
}

// Only the vertex list is written down. The faces and the edges are FOUND, as the convex hull: every
// plane through three vertices that has all the others on one side is a face, and an edge is a pair
// of neighbours round a face. So F and E are measured from the solid rather than typed in, which is
// what lets Euler's formula be a check rather than a coincidence between three constants.
export function polyhedronFromVertices(rawVertices, circumradius = 1) {
  const reach = Math.max(...rawVertices.map((v) => Math.hypot(v[0], v[1], v[2])));
  const verts = rawVertices.map((v) => V(v[0], v[1], v[2]).multiplyScalar(circumradius / reach));
  const faces = new Map();
  const n = verts.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        const normal = verts[b].clone().sub(verts[a]).cross(verts[c].clone().sub(verts[a]));
        if (normal.lengthSq() < 1e-9) continue;
        normal.normalize();
        let d = normal.dot(verts[a]);
        if (d < 0) { normal.negate(); d = -d; }
        if (verts.some((v) => normal.dot(v) > d + 1e-6)) continue;
        const key = normal.toArray().map((x) => Math.round(x * 1e5)).join(',');
        if (!faces.has(key)) {
          faces.set(key, { normal, members: verts.map((v, i) => (Math.abs(normal.dot(v) - d) < 1e-6 ? i : -1)).filter((i) => i >= 0) });
        }
      }
    }
  }
  const edges = new Map();
  const faceList = [];
  for (const { normal, members } of faces.values()) {
    const centre = members.reduce((sum, i) => sum.add(verts[i]), V(0, 0, 0)).multiplyScalar(1 / members.length);
    const e1 = verts[members[0]].clone().sub(centre).normalize();
    const e2 = normal.clone().cross(e1);
    const ring = members.map((i) => ({ i, a: Math.atan2(verts[i].clone().sub(centre).dot(e2), verts[i].clone().sub(centre).dot(e1)) })).sort((p, q) => p.a - q.a).map((p) => p.i);
    faceList.push({ normal, centre, ring });
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length];
      edges.set(p < q ? `${p}-${q}` : `${q}-${p}`, p < q ? [p, q] : [q, p]);
    });
  }
  return { vertices: verts, faces: faceList, edges: [...edges.values()], V: verts.length, E: edges.size, F: faceList.length };
}

const SOLID_ROW = [
  { key: 'tetrahedron', name: 'Tetrahedron', color: 0xd8301f, yaw: 0.98 },
  { key: 'cube', name: 'Cube', color: 0xf2ae12, yaw: 0.62 },
  { key: 'octahedron', name: 'Octahedron', color: 0x1f9e46, yaw: 0.61 },
  { key: 'dodecahedron', name: 'Dodecahedron', color: 0x1d62d0, yaw: 0.35 },
  { key: 'icosahedron', name: 'Icosahedron', color: 0x9a2fc0, yaw: 2.0 },
];
const SOLID_R = 1.16; // circumscribed radius: the five are all the same size across their corners
const SOLID_PITCH = 2.45;

// The solids in shelf order, each one standing on a face, placed in the shelf's own feet.
function platonicLayout() {
  const plinthTop = 1.24;
  const blockH = 0.78;
  const pedestalH = 0.62;
  const base = plinthTop + blockH + pedestalH;
  return SOLID_ROW.map((spec, index) => {
    const hull = polyhedronFromVertices(cartesianVertices(spec.key), SOLID_R);
    // Stand it on a face: the face nearest straight down, whichever the hull listed first.
    const down = hull.faces[0];
    const q = new THREE.Quaternion().setFromUnitVectors(down.normal, V(0, -1, 0));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spec.yaw));
    const inradius = down.centre.length();
    const x = (index - (SOLID_ROW.length - 1) / 2) * SOLID_PITCH;
    const centre = V(x, base + 0.012 + inradius, 0);
    const vertices = hull.vertices.map((v) => v.clone().applyQuaternion(q).add(centre));
    const faces = hull.faces.map((f) => ({ ring: f.ring, normal: f.normal.clone().applyQuaternion(q), centre: f.centre.clone().applyQuaternion(q).add(centre) }));
    return { ...spec, x, base, plinthTop, blockH, pedestalH, vertices, faces, edges: hull.edges, V: hull.V, E: hull.E, F: hull.F, inradius };
  });
}

function solidFaces(solid) {
  // Every face owns its vertices and carries one normal, which is what flat-shaded means, and is
  // a fan from its own centre so that a pentagon needs no special case.
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const base = lin(solid.color);
  const rng = seededRandom(solid.V * 31 + solid.F);
  for (const face of solid.faces) {
    const start = positions.length / 3;
    const k = 0.95 + rng() * 0.1;
    positions.push(face.centre.x, face.centre.y, face.centre.z);
    normals.push(face.normal.x, face.normal.y, face.normal.z);
    colors.push(clamp01(base[0] * k * 1.06), clamp01(base[1] * k * 1.06), clamp01(base[2] * k * 1.06));
    for (const i of face.ring) {
      const p = solid.vertices[i];
      positions.push(p.x, p.y, p.z);
      normals.push(face.normal.x, face.normal.y, face.normal.z);
      colors.push(base[0] * k * 0.94, base[1] * k * 0.94, base[2] * k * 0.94);
    }
    const n = face.ring.length;
    for (let j = 0; j < n; j++) indices.push(start, start + 1 + j, start + 1 + (j + 1) % n);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

function platonicLabels(row) {
  const W = 1024;
  const CELL_W = 512;
  const CELL_H = 192;
  const BAND_H = 140;
  const H = CELL_H * 3 + BAND_H;
  const rects = [];
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    row.forEach((solid, i) => {
      const x = (i % 2) * CELL_W;
      const y = Math.floor(i / 2) * CELL_H;
      rects.push([x, y, CELL_W, CELL_H]);
      ctx.strokeStyle = '#3a2a18';
      ctx.lineWidth = 5;
      ctx.strokeRect(x + 10, y + 10, CELL_W - 20, CELL_H - 20);
      ctx.fillStyle = '#20150b';
      fitText(ctx, solid.name, x + CELL_W / 2, y + 56, CELL_W - 56, 70);
      const columns = [['F', solid.F], ['E', solid.E], ['V', solid.V]];
      columns.forEach(([letter, count], c) => {
        const cx = x + CELL_W * (0.19 + c * 0.31);
        ctx.fillStyle = '#7a5a30';
        ctx.font = 'bold 56px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(letter, cx - 8, y + 134);
        ctx.fillStyle = '#20150b';
        ctx.font = 'bold 76px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(String(count), cx + 8, y + 132);
      });
      ctx.textAlign = 'center';
    });
    const by = CELL_H * 3;
    rects.push([0, by, W, BAND_H]);
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = 4;
    ctx.strokeRect(8, by + 8, W - 16, BAND_H - 16);
    ctx.fillStyle = '#20150b';
    fitText(ctx, 'V - E + F = 2', W / 2, by + 56, W - 80, 76);
    ctx.fillStyle = '#5a4020';
    fitText(ctx, 'V corners (vertices)     E edges     F faces', W / 2, by + 110, W - 80, 34, 'Helvetica, Arial, sans-serif', 'normal');
  });
  return { texture, rects, W, H };
}

function platonicSolids() {
  const row = platonicLayout();
  const { plinthTop, blockH, pedestalH } = row[0];
  const wood = [];
  const faces = [];
  const frame = [];
  const printed = [];
  const walnut = 0x8a5a33;
  const walnutDark = 0x6c4426;
  const brass = 0xc79a45;
  const edgeColor = 0x14131a;
  const cornerColor = 0xf3d36a;

  const halfW = (SOLID_PITCH * 4) / 2 + 1.35;
  const halfD = 1.5;
  wood.push({
    geometry: roundedSlab(halfW, halfD, 0.16, [
      [0, 0], [0, 0.1], [0.05, 0.14], [0.09, 0.2], [0.09, 1.02], [0.05, 1.06], [0.01, 1.1], [0, 1.14], [0, 1.2], [0.025, plinthTop],
    ], { steps: 5 }),
    color: walnutDark,
  });
  // A brass line let into the top, which the eye runs along from one solid to the next.
  frame.push({ geometry: roundedSlab(halfW - 0.2, halfD - 0.2, 0.08, [[0.03, plinthTop - 0.01], [0, plinthTop + 0.004]], { steps: 3 }), color: 0x704a2a });

  const labels = platonicLabels(row);
  row.forEach((solid, i) => {
    const y0 = plinthTop;
    // The block: square, because a label has to lie on something flat.
    wood.push({
      geometry: roundedSlab(0.98, 0.62, 0.07, [[0, 0], [0, 0.05], [0.03, 0.08], [0.03, blockH - 0.07], [0, blockH - 0.04], [0, blockH]], { steps: 3 }),
      position: [solid.x, y0, 0],
      color: walnut,
    });
    const top = y0 + blockH;
    // The turned part.
    wood.push({
      geometry: lathe([
        [0, 0], [0.56, 0], [0.56, 0.05], [0.5, 0.08], [0.3, 0.14], [0.2, 0.22], [0.165, 0.32], [0.18, 0.38], [0.26, 0.44], [0.42, 0.5], [0.58, 0.54], [0.62, 0.57], [0.62, pedestalH - 0.02], [0.6, pedestalH], [0, pedestalH],
      ], 64),
      position: [solid.x, top, 0],
      color: walnut,
    });
    frame.push({
      geometry: lathe([[0, 0.3], [0.19, 0.3], [0.205, 0.32], [0.205, 0.37], [0.19, 0.39], [0, 0.39]], 36),
      position: [solid.x, top, 0],
      color: brass,
    });

    faces.push({ geometry: solidFaces(solid), keepColor: true });
    for (const [a, b] of solid.edges) {
      const pa = solid.vertices[a];
      const pb = solid.vertices[b];
      frame.push({ geometry: rod([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], 0.03, { sides: 10 }), color: edgeColor });
    }
    for (const p of solid.vertices) frame.push({ geometry: ball(0.068, [p.x, p.y, p.z], 14), color: cornerColor });

    // The label, on a brass backing a little proud of the block.
    const labelY = y0 + blockH / 2;
    frame.push({ geometry: new THREE.BoxGeometry(1.76, 0.68, 0.03), position: [solid.x, labelY, 0.6 + 0.012], color: brass });
    const face = atlasPlane(1.68, 0.63, labels.rects[i], labels.W, labels.H);
    face.applyMatrix4(plateMatrix([solid.x, labelY, 0.6 + 0.012 + 0.018]));
    printed.push({ geometry: face, color: 0xffffff });
  });

  // Euler's formula on the plinth's own front, where a student reading the five labels finds it.
  const bandY = 0.62;
  const bandZ = halfD - 0.09;
  frame.push({ geometry: new THREE.BoxGeometry(5.28, 0.78, 0.03), position: [0, bandY, bandZ + 0.01], color: brass });
  const band = atlasPlane(5.14, 0.7, labels.rects[row.length], labels.W, labels.H);
  band.applyMatrix4(plateMatrix([0, bandY, bandZ + 0.01 + 0.018]));
  printed.push({ geometry: band, color: 0xffffff });

  const root = new THREE.Group();
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grainMap(11), roughness: 0.48, metalness: 0, ...relief('wood', { seed: 5, repeat: 1, strength: 0.05 }) })));
  root.add(mesh(mergeParts(faces), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  root.add(mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.36, metalness: 0.12 })));
  const labelMesh = mesh(mergeParts(printed), standard({ map: labels.texture, roughness: 0.62, metalness: 0 }));
  labelMesh.castShadow = false;
  root.add(labelMesh);
  return root;
}

// ---------------------------------------------------------------------------
// The Pythagorean theorem, in tiles
// ---------------------------------------------------------------------------

// All in the board's own plane, in feet, with the right angle at the origin. Each square is a list of
// one-foot cells stepped off from the two corners of the side it stands on, so the 25 are rotated by
// nothing but the hypotenuse's own direction: there is no angle in here to get wrong, and the first
// row's cell edges lie on the side by construction.
const TILE_GAP = 0.06;

function squareOnSide(from, to, outwardDir, set) {
  const side = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const e1 = [(to[0] - from[0]) / side, (to[1] - from[1]) / side];
  const e2 = outwardDir;
  const tiles = [];
  const n = Math.round(side);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const at = (u, v) => [from[0] + e1[0] * u + e2[0] * v, from[1] + e1[1] * u + e2[1] * v];
      tiles.push({
        set,
        i,
        j,
        centre: at(i + 0.5, j + 0.5),
        cell: [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)],
        angle: Math.atan2(e2[1], e2[0]),
      });
    }
  }
  return { side, n, tiles, corners: [from, to, [to[0] + e2[0] * side, to[1] + e2[1] * side], [from[0] + e2[0] * side, from[1] + e2[1] * side]], angle: Math.atan2(e2[1], e2[0]) };
}

function pythagorasLayout() {
  const C = [0, 0];
  const A = [4, 0];
  const B = [0, 3];
  const hyp = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const away = [(A[1] - B[1]) / -hyp, (B[0] - A[0]) / -hyp]; // the perpendicular pointing away from C
  const squares = {
    a: squareOnSide(C, B, [-1, 0], 'a'),
    b: squareOnSide(C, A, [0, -1], 'b'),
    c: squareOnSide(A, B, away, 'c'),
  };
  return { C, A, B, squares, gap: TILE_GAP, tiles: [...squares.a.tiles, ...squares.b.tiles, ...squares.c.tiles], matrix: () => boardMatrix() };
}

const BOARD = { x0: -3.55, x1: 7.55, y0: -4.55, y1: 7.55, tilt: THREE.MathUtils.degToRad(32), lift: 1.0, rail: 0.34 };

function boardMatrix() {
  const { x0, x1, y0, y1, tilt, lift, rail } = BOARD;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const half = (y1 - y0) / 2 + rail;
  const yc = lift + half * Math.sin(tilt) + 0.3 * Math.cos(tilt);
  return new THREE.Matrix4().makeTranslation(0, yc, 0)
    .multiply(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - tilt)))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -cy, 0));
}

// A slab authored flat on y, stood on the board with +y as the board's own normal, at a board point.
function onBoard(geometry, x, y, z, angle = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationZ(angle))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  geometry.applyMatrix4(m);
  return geometry;
}

function boardPaint() {
  const { x0, x1, y0, y1 } = BOARD;
  const S = 1024;
  const fx = (x) => ((x - x0) / (x1 - x0)) * S;
  const fy = (y) => ((y1 - y) / (y1 - y0)) * S;
  const rng = seededRandom(77);
  return canvasTexture(S, S, (ctx) => {
    ctx.fillStyle = '#26383f';
    ctx.fillRect(0, 0, S, S);
    // Rubbed slate, so that a dark board is a surface rather than a hole.
    for (let i = 0; i < 2200; i++) {
      const v = rng();
      ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.012 + rng() * 0.03})` : `rgba(0,0,0,${0.02 + rng() * 0.05})`;
      const r = 4 + rng() * 26;
      ctx.beginPath();
      ctx.ellipse(rng() * S, rng() * S, r * 2, r * 0.6, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f2ead2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const family = 'Georgia, "Times New Roman", serif';
    fitText(ctx, '3 x 3 = 9', fx(-1.5), fy(3.45), fx(0) - fx(-3), 50, family);
    fitText(ctx, '5 x 5 = 25', fx(-0.75), fy(6.3), fx(1.4) - fx(-2.9), 50, family);
    fitText(ctx, '4 x 4 = 16', fx(5.8), fy(-0.45), fx(7.3) - fx(4.3), 50, family);
  });
}

function trianglePaint(layout) {
  const W = 1024;
  const H = 768;
  const px = W / 4;
  const X = (x) => x * px;
  const Y = (y) => (3 - y) * px;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f5edd6';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#efb9b0';
    ctx.fillRect(X(0), Y(0.62), 0.62 * px, 0.62 * px);
    ctx.fillStyle = '#1b1f28';
    ctx.font = 'bold 170px Helvetica, Arial, sans-serif';
    ctx.fillText('4', X(2.1), Y(0.42));
    ctx.fillText('3', X(0.42), Y(1.42));
    ctx.save();
    // Printed along the hypotenuse, inside it, reading from B down to A.
    const mid = [(layout.A[0] + layout.B[0]) / 2, (layout.A[1] + layout.B[1]) / 2];
    ctx.translate(X(mid[0] - 0.33), Y(mid[1] - 0.44));
    ctx.rotate(Math.atan2(3, 4));
    ctx.fillText('5', 0, 0);
    ctx.restore();
  });
}

function pythagoreanPlaque() {
  const W = 768;
  const H = 384;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#20150b';
    fitText(ctx, '9 + 16 = 25', W / 2, H * 0.36, W - 90, 130, 'Helvetica, Arial, sans-serif');
    ctx.fillStyle = '#5a4020';
    fitText(ctx, '3 x 3  +  4 x 4  =  5 x 5', W / 2, H * 0.72, W - 110, 56, 'Georgia, "Times New Roman", serif', 'normal');
  });
}

function pythagoreanTheorem() {
  const layout = pythagorasLayout();
  const { x0, x1, y0, y1, rail } = BOARD;
  const M = boardMatrix();
  const wood = [];
  const glazed = [];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const toWorld = (x, y, z) => { const v = V(x, y, z).applyMatrix4(M); return [v.x, v.y, v.z]; };

  // Tiles. Each is a real closed slab sized to leave the gap inside its one-foot cell.
  const COLORS = { a: 0x1d84d6, b: 0xf2a516, c: 0xd92f3f };
  const rng = seededRandom(23);
  const half = 0.5 - TILE_GAP / 2;
  const bedTop = 0.03;
  const tileProfile = [[0, 0], [0, 0.1], [0.012, 0.122], [0.036, 0.135]];
  for (const tile of layout.tiles) {
    const k = 0.92 + rng() * 0.14;
    const c = lin(COLORS[tile.set]);
    const g = roundedSlab(half, half, 0.065, tileProfile, { steps: 3 });
    onBoard(g, tile.centre[0], tile.centre[1], bedTop, tile.angle);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { col[i * 3] = c[0] * k; col[i * 3 + 1] = c[1] * k; col[i * 3 + 2] = c[2] * k; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    glazed.push({ geometry: g, keepColor: true });
  }
  // The bed each square is laid on is exactly the square on that side, and it is pale grout, so the
  // gaps read as gaps and the square's true outline meets the triangle's side.
  for (const sq of Object.values(layout.squares)) {
    const mid = [(sq.corners[0][0] + sq.corners[2][0]) / 2, (sq.corners[0][1] + sq.corners[2][1]) / 2];
    const g = new THREE.BoxGeometry(sq.side, bedTop, sq.side);
    g.translate(0, bedTop / 2, 0);
    onBoard(g, mid[0], mid[1], 0, sq.angle);
    glazed.push({ geometry: g, color: 0xd9d3c0 });
  }

  // The triangle, raised: exact outline at its foot, a small chamfer, a printed top. A triangle
  // inset by d is itself scaled about its incentre, and a 3-4-5's incentre is (1,1) with radius 1.
  const H = 0.36;
  const bevel = 0.035;
  const inset = (p, d) => [1 + (p[0] - 1) * (1 - d), 1 + (p[1] - 1) * (1 - d)];
  const corners = [layout.C, layout.A, layout.B];
  const rows = [[0, 0], [0, H - bevel], [bevel, H]];
  const triPositions = [];
  const triIndices = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let e = 0; e < 3; e++) {
      const a = corners[e];
      const b = corners[(e + 1) % 3];
      const pa0 = inset(a, rows[r][0]); const pb0 = inset(b, rows[r][0]);
      const pa1 = inset(a, rows[r + 1][0]); const pb1 = inset(b, rows[r + 1][0]);
      const at = triPositions.length / 3;
      triPositions.push(pa0[0], pa0[1], rows[r][1], pb0[0], pb0[1], rows[r][1], pb1[0], pb1[1], rows[r + 1][1], pa1[0], pa1[1], rows[r + 1][1]);
      triIndices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
  }
  const prism = new THREE.BufferGeometry();
  const top3 = corners.map((p) => inset(p, bevel));
  const capAt = triPositions.length / 3;
  for (const p of top3) triPositions.push(p[0], p[1], H);
  triIndices.push(capAt, capAt + 1, capAt + 2);
  const bottomAt = triPositions.length / 3;
  for (const p of corners) triPositions.push(p[0], p[1], 0);
  triIndices.push(bottomAt, bottomAt + 2, bottomAt + 1);
  prism.setIndex(triIndices);
  prism.setAttribute('position', new THREE.Float32BufferAttribute(triPositions, 3));
  prism.computeVertexNormals();
  glazed.push({ geometry: prism, color: 0x3a4a58 });

  // The printed top, which also carries the numbers, a hair proud of the prism's cap.
  const plate = new THREE.BufferGeometry();
  plate.setAttribute('position', new THREE.Float32BufferAttribute(top3.flatMap((p) => [p[0], p[1], H + 0.004]), 3));
  plate.setAttribute('uv', new THREE.Float32BufferAttribute(top3.flatMap((p) => [p[0] / 4, p[1] / 3]), 2));
  plate.setIndex([0, 1, 2]);
  plate.computeVertexNormals();

  // The right-angle mark stands on the printed top, a real L of a raised bar, and it is the one thing
  // on the triangle in red.
  const markSize = 0.62;
  const barW = 0.08;
  const markZ = H + 0.03;
  const bar = (w, h, x, y) => {
    const g = new THREE.BoxGeometry(w, h, 0.05);
    g.translate(x, y, markZ);
    return { geometry: g, color: 0xc4202e };
  };
  // The two bars run from the two legs and meet: a square with the triangle's own corner.
  const legAt = bevel * 2;
  glazed.push(bar(barW, markSize - legAt + barW / 2, markSize, (markSize + legAt) / 2 + barW / 4));
  glazed.push(bar(markSize - legAt - barW / 2, barW, (markSize + legAt) / 2 - barW / 4, markSize));

  // The plaque, in the empty corner under the hypotenuse's square.
  const plaqueW = 2.86;
  const plaqueH = 1.43;
  const plaqueX = 5.82;
  const plaqueY = -2.55;
  const backing = new THREE.BoxGeometry(plaqueW + 0.14, plaqueH + 0.14, 0.1);
  backing.translate(plaqueX, plaqueY, 0.05);
  glazed.push({ geometry: backing, color: 0xc79a45 });
  const plaque = new THREE.PlaneGeometry(plaqueW, plaqueH);
  plaque.translate(plaqueX, plaqueY, 0.116);

  // The board and its frame. The board's face is at z = 0.
  const board = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  board.translate(cx, cy, 0);
  wood.push({ geometry: new THREE.BoxGeometry(x1 - x0 + 0.1, y1 - y0 + 0.1, 0.24), position: [cx, cy, -0.14], color: 0xb0814f });
  const railW = rail;
  const zRail = 0.04;
  const rails = [
    [[x0 - railW / 2, y0 - railW], [x0 - railW / 2, y1 + railW]],
    [[x1 + railW / 2, y0 - railW], [x1 + railW / 2, y1 + railW]],
    [[x0 - railW, y0 - railW / 2], [x1 + railW, y0 - railW / 2]],
    [[x0 - railW, y1 + railW / 2], [x1 + railW, y1 + railW / 2]],
  ];
  for (const [a, b] of rails) wood.push({ geometry: timber([a[0], a[1], zRail], [b[0], b[1], zRail], railW, 0.5, 0.05), color: 0x8a5a33 });
  // Battens across the back, because this is a side a student walks round to.
  for (const y of [cy - 4, cy, cy + 4]) wood.push({ geometry: timber([x0 + 0.1, y, -0.3], [x1 - 0.1, y, -0.3], 0.5, 0.16, 0.03), color: 0x9a6b3e });

  const boardGroup = mergeParts(glazed);
  boardGroup.applyMatrix4(M);
  const woodBoard = mergeParts(wood);
  woodBoard.applyMatrix4(M);

  // The stand: a trestle at each side, in world feet.
  const trestle = [];
  const underside = (y) => toWorld(0, y, -0.34);
  for (const x of [-4.1, 4.1]) {
    const rel = x + cx;
    const low = underside(y0 + 0.8);
    const high = underside(y1 - 1.2);
    const lowP = toWorld(rel, y0 + 0.8, -0.34);
    const highP = toWorld(rel, y1 - 1.2, -0.34);
    const foot = 0.17;
    trestle.push({ geometry: timber([x, foot, low[2] + 1.4], [x, foot, high[2] - 0.7], 0.42, 0.34, 0.05), color: 0x6c4426 });
    trestle.push({ geometry: timber([x, foot, lowP[2]], [x, lowP[1] + 0.05, lowP[2]], 0.34, 0.34, 0.04), color: 0x8a5a33 });
    trestle.push({ geometry: timber([x, foot, highP[2]], [x, highP[1] + 0.05, highP[2]], 0.34, 0.34, 0.04), color: 0x8a5a33 });
    // A diagonal brace from the foot of the tall post up to the board's middle.
    const midP = toWorld(rel, cy, -0.34);
    trestle.push({ geometry: timber([x, foot + 0.1, highP[2] + 3.0], [x, midP[1] - 0.05, midP[2]], 0.26, 0.26, 0.03), color: 0x7a4e2c });
    trestle.push({ geometry: timber([x, foot + 0.1, highP[2] + 3.0], [x, highP[1] * 0.55, highP[2]], 0.26, 0.26, 0.03), color: 0x7a4e2c });
    // Bolts where the timbers cross.
    for (const y of [highP[1] * 0.55, highP[1] - 0.5]) {
      const bolt = lathe([[0, 0], [0.07, 0], [0.07, 0.03], [0.04, 0.05], [0, 0.05]], 12);
      bolt.rotateZ(x < 0 ? Math.PI / 2 : -Math.PI / 2);
      trestle.push({ geometry: bolt, position: [x + (x < 0 ? -0.17 : 0.17), y, highP[2]], color: 0xc79a45 });
    }
  }
  // A stretcher between the trestles, near the floor.
  const stretch = toWorld(0, y1 - 1.2, -0.34);
  trestle.push({ geometry: timber([-4.1, 1.2, stretch[2]], [4.1, 1.2, stretch[2]], 0.3, 0.3, 0.04), color: 0x7a4e2c });

  const root = new THREE.Group();
  const glazedMesh = mesh(boardGroup, standard({ vertexColors: true, roughness: 0.3, metalness: 0 }));
  root.add(glazedMesh);
  root.add(mesh(mergeParts([{ geometry: woodBoard, keepColor: true }, ...trestle]), standard({ vertexColors: true, map: grainMap(31), roughness: 0.55, metalness: 0, ...relief('wood', { seed: 9, repeat: 1, strength: 0.05 }) })));

  const slate = board.clone();
  slate.applyMatrix4(M);
  const slateMesh = mesh(slate, standard({ map: boardPaint(), roughness: 0.8, metalness: 0 }));
  slateMesh.castShadow = false;
  root.add(slateMesh);
  const plateGeo = plate.clone();
  plateGeo.applyMatrix4(M);
  const plateMesh = mesh(plateGeo, standard({ map: trianglePaint(layout), roughness: 0.5, metalness: 0 }));
  plateMesh.castShadow = false;
  root.add(plateMesh);
  const plaqueGeo = plaque.clone();
  plaqueGeo.applyMatrix4(M);
  const plaqueMesh = mesh(plaqueGeo, standard({ map: pythagoreanPlaque(), roughness: 0.55, metalness: 0 }));
  plaqueMesh.castShadow = false;
  root.add(plaqueMesh);
  return root;
}

// ---------------------------------------------------------------------------
// The chambered nautilus
// ---------------------------------------------------------------------------

// A logarithmic spiral: r(tau) = RE * W^(tau / 2 pi), so that r grows by W every whorl and by the
// same ratio from one chamber to the next. tau is measured back from the aperture (tau = 0) and is
// negative everywhere on the shell. Every dimension below is a fraction of r, so the shape really
// is the same at every size, which is what the model is for.
const NAUT = {
  W: 3,
  RE: 3.9,
  chambers: 30,
  perWhorl: 11,
  bodySpan: 2.3, // radians of open body chamber in front of the last septum
  alpha: THREE.MathUtils.degToRad(27), // the bearing of the aperture, seen from +Z
  depth: 0.39, // half the whorl's width, as a fraction of r
  shoulder: 0.38, // where in the section the whorl is widest
  umbilicus: 0.06,
  wall: 0.02,
  septum: 0.011,
  bow: 0.55,
  lean: 0.3,
  ramp: 0.82,
};
const LOG_W = Math.log(NAUT.W) / (Math.PI * 2);
const naR = (tau) => NAUT.RE * Math.exp(LOG_W * tau);
const CHAMBER_STEP = (Math.PI * 2) / NAUT.perWhorl;
const septumTau = (k) => -NAUT.bodySpan - (NAUT.chambers - k) * CHAMBER_STEP; // k = 0..chambers
// A septum is concave toward the aperture: its ends sweep forward along the walls, and the outer end
// further than the inner one. v runs from the inner wall (0) to the outer (1).
const septumBow = (v) => CHAMBER_STEP * (NAUT.bow * (2 * v - 1) ** 2 + NAUT.lean * (v - 0.5));

// The whorl's half-width at a fraction `rho` of the local radius.
function flank(rho) {
  const { shoulder: c, umbilicus: u, depth } = NAUT;
  if (rho >= c) {
    const t = clamp01((rho - c) / (1 - c));
    return depth * Math.sqrt(Math.max(0, 1 - t * t));
  }
  // Below the shoulder the wall falls toward the umbilicus but never reaches the cut face. It stays
  // deeper than any chamber of an inner whorl at that radius, or it would stand in front of them.
  const t = clamp01((c - rho) / (c - u)) * 0.826;
  return depth * Math.sqrt(Math.max(0, 1 - t * t));
}

// Where the lip of the aperture stands: a ventral sinus (the notch the animal's funnel sits in) and a
// shallower one at the shoulder, with the flanks reaching furthest.
const lipTau = (rho) => -0.26 * sstep(rho, 0.74, 1) - 0.1 * (1 - sstep(rho, 0.14, 0.42));

function nautilusLayout() {
  const { chambers } = NAUT;
  const list = [];
  for (let k = 1; k <= chambers; k++) {
    const t0 = septumTau(k - 1);
    const t1 = septumTau(k);
    // The chamber's outline on the cut face: septum, outer wall, next septum, inner wall.
    const outline = [];
    const N = 24;
    const inner = 1 / (NAUT.W * (1 - NAUT.wall));
    const rhoOf = (v) => mix(inner, 1, v);
    const point = (tau, rho) => {
      const r = naR(tau) * (1 - NAUT.wall) * rho;
      return [r * Math.cos(NAUT.alpha + tau), r * Math.sin(NAUT.alpha + tau)];
    };
    for (let i = 0; i <= N; i++) outline.push(point(t0 + septumBow(i / N), rhoOf(i / N)));
    for (let i = 1; i <= N; i++) outline.push(point(mix(t0, t1, i / N) + septumBow(1), 1));
    for (let i = N - 1; i >= 0; i--) outline.push(point(t1 + septumBow(i / N), rhoOf(i / N)));
    for (let i = N - 1; i > 0; i--) outline.push(point(mix(t0, t1, i / N) + septumBow(0), inner));
    let area = 0;
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % outline.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    list.push({ k, t0, t1, outline, area: Math.abs(area) / 2 });
  }
  return {
    ...NAUT,
    b: LOG_W,
    ratioPerChamber: Math.exp(LOG_W * CHAMBER_STEP),
    chamberCount: list.length,
    chambers: list,
    r: naR,
    apexRadius: naR(septumTau(0)),
    whorls: (septumTau(chambers) - septumTau(0) + NAUT.bodySpan) / (Math.PI * 2),
  };
}

// Frame of the coil on the model: where its axis sits, and the z of the cut face.
function nautilusFrame() {
  let x0 = 1e9; let x1 = -1e9; let y0 = 1e9;
  for (let tau = -7; tau <= 0; tau += 0.01) {
    const r = naR(tau);
    const x = r * Math.cos(NAUT.alpha + tau);
    const y = r * Math.sin(NAUT.alpha + tau);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y);
  }
  const standH = 0.86;
  return { cx: -(x0 + x1) / 2, cy: standH - y0, cz: (NAUT.depth * NAUT.RE) / 2, standH, width: x1 - x0 };
}

function nautilusAtlas() {
  const W = 2048;
  const H = 1024;
  const panel = 0.9;
  const tauMin = -Math.PI * 2 - 1.0;
  const u = (tau) => (tau - tauMin) / -tauMin;
  const v = (rho) => panel * ((rho - NAUT.umbilicus) / (1 - NAUT.umbilicus));
  const rng = seededRandom(1958);
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f6efe0';
    ctx.fillRect(0, 0, W, H);
    // A warm porcelain ground that deepens toward the shoulder.
    const grad = ctx.createLinearGradient(0, H, 0, H * (1 - panel));
    grad.addColorStop(0, '#efdcb8');
    grad.addColorStop(0.5, '#f4e8d0');
    grad.addColorStop(1, '#f3e4c8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, H * (1 - panel), W, H * panel);
    const X = (tau) => u(tau) * W;
    const Y = (rho) => (1 - v(rho)) * H;
    const stripesPerWhorl = 24;
    const step = (Math.PI * 2) / stripesPerWhorl;
    const flames = Math.ceil(-tauMin / step);
    const drawFlame = (tauC, rho0, rho1, width, color, branch, tipped = true) => {
      const n = 22;
      const sweep = 0.34;
      const wig = 0.05 + rng() * 0.05;
      const ph = rng() * 6;
      const left = [];
      const right = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const rho = mix(rho0, rho1, t);
        const s = ((rho - NAUT.umbilicus) / (1 - NAUT.umbilicus));
        const centre = tauC - sweep * s * s + Math.sin(t * 7 + ph) * wig * step * 3 + branch * t * t * step * 0.8;
        // A flame: narrow where it leaves the umbilicus, broad across the flank, with edges that
        // waver. A full-length one runs off the rim rather than coming to a point on the flank.
        const body = tipped ? Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)) ** 0.75 : 0.4 + 0.6 * sstep(t, 0, 0.55);
        const hw = width * step * body * (1 + 0.22 * Math.sin(t * 9 + ph * 2));
        left.push([X(centre - hw), Y(rho)]);
        right.push([X(centre + hw), Y(rho)]);
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (const p of left) ctx.lineTo(p[0], p[1]);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
      ctx.fill();
    };
    for (let i = 0; i < flames; i++) {
      const tau = tauMin + (i + 0.5) * step + (rng() - 0.5) * step * 0.3;
      // The stripes stop before the aperture, as they do on the animal: the youngest part of the
      // body whorl is plain white.
      const strength = sstep(-tau, 0.55, 2.0);
      if (strength < 0.02) continue;
      const full = strength > 0.92;
      const reach = full ? 1.03 : mix(0.3, 0.95, strength);
      const shade = 0.86 + rng() * 0.22;
      const blend = mix(0.25, 1, strength);
      const mixed = (c, base) => Math.round(mix(base, c * shade, blend));
      const col = `rgb(${mixed(196, 240)},${mixed(104, 226)},${mixed(44, 198)})`;
      const core = `rgba(150,70,26,${0.22 * strength})`;
      const wide = 0.2 + rng() * 0.11;
      drawFlame(tau, NAUT.umbilicus + 0.03, reach, wide, col, 0, !full);
      if (strength > 0.5) drawFlame(tau, NAUT.umbilicus + 0.05, reach * 0.95, wide * 0.5, core, 0);
      if (rng() < 0.3 && full) drawFlame(tau, mix(NAUT.umbilicus, reach, 0.5), reach, wide * 0.3, col, rng() < 0.5 ? 1 : -1, false);
    }
    // The top of the atlas stays plain white: every pearl surface on the model samples it, so the
    // one material can carry the painted shell and the vertex-coloured nacre.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H * (1 - panel) * 0.92);
  });
  map.anisotropy = 8;
  return { map, u, v, white: [0.5, 0.975] };
}

function nautilusBump(atlas) {
  const W = 1024;
  const H = 512;
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    const tauMin = -Math.PI * 2 - 1.0;
    for (let tau = tauMin; tau < 0; tau += 0.022) {
      const a = 0.14 + 0.1 * Math.sin(tau * 37);
      ctx.strokeStyle = `rgba(0,0,0,${a})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i <= 18; i++) {
        const rho = mix(NAUT.umbilicus, 1, i / 18);
        const s = i / 18;
        const x = atlas.u(tau - 0.34 * s * s) * W;
        const y = (1 - atlas.v(rho)) * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H * 0.09);
  });
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function nautilusShell() {
  const frame = nautilusFrame();
  const atlas = nautilusAtlas();
  const parts = [];
  const { alpha } = NAUT;
  const pearl = lin(0xeadcc4);
  const deep = lin(0x93705c);
  const wallC = lin(0xf4ecdc);
  const zLift = 0.008;

  const coil = (tau, rho, z) => {
    const r = naR(tau) * rho;
    return [frame.cx + r * Math.cos(alpha + tau), frame.cy + r * Math.sin(alpha + tau), frame.cz + z];
  };
  const white = atlas.white;

  // --- the outer shell, seen from behind: one whorl and a bit of the surface a whorl sweeps -------
  const rows = [];
  {
    const u0 = NAUT.umbilicus;
    const c = NAUT.shoulder;
    const inner = 10;
    const outer = 24;
    for (let i = 0; i <= inner; i++) rows.push(c - (c - u0) * Math.sin(((inner - i) / inner) * (Math.PI / 2)));
    for (let i = 1; i <= outer; i++) rows.push(c + (1 - c) * Math.sin((i / outer) * (Math.PI / 2)));
    rows.push(1 / (NAUT.W * (1 - NAUT.wall)));
    rows.sort((a, b) => a - b);
  }
  const tauStart = -Math.PI * 2 - 1.0;
  const columns = 170;
  // The last row repeats the rim at the height of the cut face, so nothing shows between them.
  const extFn = (i, j) => {
    const onRim = j === rows.length;
    const rho = onRim ? 1 : rows[j];
    const end = lipTau(rho);
    const tau = mix(tauStart, end, i / columns);
    const r = naR(tau);
    const p = coil(tau, rho, onRim ? zLift : -r * flank(rho));
    return { p, c: [1, 1, 1], uv: [atlas.u(tau), atlas.v(rho)] };
  };
  parts.push({ geometry: grid(columns, rows.length, extFn, [0, 0, -1]), keepColor: true });

  // The callus plugging the umbilicus: a low dome, sunk into the funnel the whorls leave.
  {
    // Radius 0.29 and depth 0.32 are the arithmetic that keeps it hidden from the front: no chamber
    // at that radius is deeper than 1.03 times the radius, and every outer whorl's wall there is deeper.
    const R = 0.29;
    const z0 = 0.32;
    const plug = lathe([[0, 0], [R, 0], [R * 0.98, 0.03], [R * 0.7, 0.07], [R * 0.3, 0.1], [0, 0.11]], 36);
    plug.rotateX(-Math.PI / 2); // +y becomes -z, which is out of the back of the shell
    plug.translate(frame.cx, frame.cy, frame.cz - z0);
    const uv = plug.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, atlas.white[0], atlas.white[1]);
    parts.push({ geometry: plug, keepColor: false, color: 0xe8d8b8 });
  }

  // --- the chambers ---------------------------------------------------------------------------------
  // A chamber's section is a crescent, not a cup: the inner wall is the OUTSIDE of the whorl before it,
  // which bulges into the chamber and runs back under the cut face. So each row across the section is
  // one of three things, and every one of them collapses to the cut face as the septum is reached:
  //   prior: on the previous whorl's own flank, which is its true surface at any ramp;
  //   back:  the far wall of this whorl, inside the part of the section the cut face hides;
  //   floor: the far wall again, out to the outer wall, which is what you look at from the front.
  const innerRho = 1 / (NAUT.W * (1 - NAUT.wall));
  const c0 = NAUT.shoulder;
  const HIDDEN_ROWS = [
    { kind: 'prior', q: 1 }, { kind: 'prior', q: 0.97 }, { kind: 'prior', q: 0.88 }, { kind: 'prior', q: 0.72 }, { kind: 'prior', q: 0.5 },
    { kind: 'back', rho: 0.14 }, { kind: 'back', rho: 0.2 }, { kind: 'back', rho: 0.27 }, { kind: 'back', rho: innerRho }, { kind: 'back', rho: c0 },
  ];
  const rowCount = (nv) => HIDDEN_ROWS.length + nv;
  const rowAt = (j, nv) => {
    if (j < HIDDEN_ROWS.length) return { ...HIDDEN_ROWS[j], v: 0 };
    const v = (j - HIDDEN_ROWS.length + 1) / nv;
    return { kind: 'floor', rho: c0 + (1 - c0) * Math.sin(v * (Math.PI / 2)), v };
  };
  const wallScale = 1 - NAUT.wall * 1.5;
  const cupPoint = (tau, row, ramp) => {
    const r = naR(tau);
    if (row.kind === 'prior') {
      const q = mix(1, row.q, ramp);
      return coil(tau, q / NAUT.W, -(r / NAUT.W) * flank(q) * 0.985);
    }
    const s = 1 - NAUT.wall;
    if (row.kind === 'back') {
      const rho = mix(1 / NAUT.W, row.rho * s, ramp);
      const prior = (r / NAUT.W) * flank(rho * NAUT.W) ;
      return coil(tau, rho, -Math.max(ramp * r * flank(row.rho) * wallScale, prior));
    }
    return coil(tau, row.rho * s, -r * flank(row.rho) * wallScale * ramp);
  };
  const nacre = (v, depthFactor, k) => {
    // Nacre is a colour that moves. The phase is measured in the chamber's own units, so that the
    // sheen scales with the shell like everything else.
    const a = v * 4.2 + k * 0.9 + depthFactor * 2.4;
    const base = [
      pearl[0] * (1 + 0.1 * Math.sin(a)),
      pearl[1] * (1 + 0.1 * Math.sin(a + 2.1)),
      pearl[2] * (1 + 0.16 * Math.sin(a + 4.2)),
    ];
    // Deeper is darker: the shell's self-shadow, painted, since the inner chambers are far too small
    // for a shadow map to resolve.
    const shade = mix(1, 0.4, sstep(depthFactor * (1 - v * 0.8), 0.15, 0.95));
    return [mix(deep[0], base[0], shade), mix(deep[1], base[1], shade), mix(deep[2], base[2], shade)];
  };
  const rampOf = (x) => Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)));
  for (let k = 1; k <= NAUT.chambers; k++) {
    const t0 = septumTau(k - 1);
    const t1 = septumTau(k);
    const r = naR(t0);
    const nu = Math.round(mix(6, 24, clamp01(r / 2.4)));
    const nv = Math.round(mix(6, 22, clamp01(r / 2.4)));
    // i: the floor from this septum to the next, then the next septum's wall back up to the cut face.
    const fn = (i, j) => {
      const row = rowAt(j, nv);
      const u = (Math.min(i, nu) / nu) ** 1.5;
      const ramp = i === nu + 2 ? 0 : rampOf(clamp01(u / NAUT.ramp));
      const tau = mix(t0, t1, u) + septumBow(row.v);
      const p = cupPoint(tau, row, ramp);
      return { p, c: nacre(row.v, ramp, k), uv: white };
    };
    parts.push({ geometry: grid(nu + 2, rowCount(nv) - 1, fn, [0, 0, 1]), keepColor: true });
  }

  // The body chamber: open, with no far wall, ending at the lip. Its rows across the section, the
  // lip's and the outer shell's are the same list: three surfaces that meet along one curve have to
  // be sampled at the same points on it, or daylight shows along the join where the lip's sinus bends.
  const LIP_ROWS = 24;
  {
    const t0 = septumTau(NAUT.chambers);
    const nu = 40;
    const nv = LIP_ROWS;
    const fn = (i, j) => {
      const row = rowAt(j, nv);
      const u = (i / nu) ** 1.3;
      const ramp = rampOf(clamp01(u / ((NAUT.ramp * CHAMBER_STEP) / NAUT.bodySpan)));
      const end = lipTau(row.kind === 'prior' ? innerRho : Math.max(row.rho, innerRho));
      const tau = mix(t0 + septumBow(row.v), end, u);
      const p = cupPoint(tau, row, ramp);
      return { p, c: nacre(row.v, ramp * 0.7, NAUT.chambers + 1), uv: white };
    };
    parts.push({ geometry: grid(nu, rowCount(nv) - 1, fn, [0, 0, 1]), keepColor: true });
    // The lip: from the outer surface round to the inner one. Rounded, by a row pushed forward.
    const m = LIP_ROWS + 1;
    const lip = grid(4, m, (i, j) => {
      const rho = j === 0 ? innerRho : c0 + (1 - c0) * Math.sin(((j - 1) / LIP_ROWS) * (Math.PI / 2));
      const end = lipTau(rho);
      const r = naR(end);
      const a = (i / 4) * Math.PI;
      const blend = 0.5 - 0.5 * Math.cos(a);
      const s = mix(1, 1 - NAUT.wall, blend);
      const zk = mix(1, 1 - NAUT.wall * 1.5, blend);
      const tau = end + Math.sin(a) * NAUT.wall * 0.8;
      return { p: coil(tau, rho * s, -r * flank(rho) * zk), c: wallC, uv: white };
    }, [-Math.sin(alpha), Math.cos(alpha), 0]);
    parts.push({ geometry: lip, keepColor: true });
    // The shoulder of the lip, where it comes down onto the whorl before it: a fan closing the
    // aperture's crescent between the wall above and the inner edge.
    const pts = [];
    const fanRows = rows.filter((x) => x <= innerRho + 1e-6);
    for (const rho of fanRows) {
      const end = lipTau(rho);
      pts.push(coil(end, rho, -naR(end) * flank(rho)));
    }
    const hubRho = lipTau(innerRho);
    const hub = coil(hubRho, innerRho * (1 - NAUT.wall), -naR(hubRho) * flank(innerRho) * wallScale);
    const fan = new THREE.BufferGeometry();
    const fanP = [...hub];
    for (const p of pts) fanP.push(p[0], p[1], p[2]);
    const idx = [];
    for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
    fan.setAttribute('position', new THREE.Float32BufferAttribute(fanP, 3));
    fan.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(fanP.length / 3 * 2).fill(0).map((_, q) => (q % 2 ? white[1] : white[0])), 2));
    fan.setIndex(idx);
    fan.computeVertexNormals();
    const facing = V(-Math.sin(alpha), Math.cos(alpha), 0);
    const n0 = fan.attributes.normal;
    if (n0.getX(0) * facing.x + n0.getY(0) * facing.y < 0) {
      for (let i = 0; i < idx.length; i += 3) { const b = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = b; }
      fan.setIndex(idx);
      fan.computeVertexNormals();
    }
    parts.push({ geometry: fan, keepColor: false, color: 0xe9dcc2 });
  }

  // --- the cut face: the wall, the septa, the holes through them ----------------------------------
  // The wall is one continuous spiral ribbon. Its outermost part carries the pigment wherever it
  // has a whorl's painted surface to take it from, so a flame reaches the cut as it would.
  const wallFrom = septumTau(0) - Math.PI * 2;
  const wallTo = lipTau(1);
  const wallSteps = Math.round((wallTo - wallFrom) / 0.022);
  parts.push({
    geometry: grid(wallSteps, 2, (i, j) => {
      const tau = mix(wallFrom, wallTo, i / wallSteps);
      const rho = [1 - NAUT.wall, 1 - NAUT.wall * 0.18, 1][j];
      const painted = j === 2 && tau > tauStart;
      return {
        p: coil(tau, rho, zLift + 0.004),
        c: wallC,
        uv: painted ? [atlas.u(tau), atlas.v(0.995)] : white,
      };
    }, [0, 0, 1]),
    keepColor: true,
  });

  // The apex: the embryonic shell, closing the centre of the coil.
  {
    const steps = 48;
    const P = [frame.cx, frame.cy, frame.cz + zLift];
    const idx = [];
    for (let i = 0; i <= steps; i++) {
      const tau = mix(septumTau(0) - Math.PI * 2, septumTau(0), i / steps);
      const p = coil(tau, 1, zLift);
      P.push(p[0], p[1], p[2]);
      if (i) idx.push(0, i, i + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(P.length / 3 * 2).fill(0).map((_, q) => (q % 2 ? white[1] : white[0])), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push({ geometry: g, keepColor: false, color: 0xd9c4a2 });
  }

  // Septa, each a curved strip that widens where it runs along the wall, and at its middle a hole
  // with the short collar (the septal neck) that points back toward the apex.
  for (let k = 0; k <= NAUT.chambers; k++) {
    const t = septumTau(k);
    const n = Math.round(mix(10, 30, clamp01(naR(t) / 2.4)));
    const point = (v) => {
      const rho = mix(innerRho * 0.985, 1 - NAUT.wall * 0.8, v);
      const tt = t + septumBow(v);
      return coil(tt, rho, zLift);
    };
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(point(i / n));
    const widthAt = (v) => {
      const r = naR(t + septumBow(v));
      const flare = 1 + 0.5 * (1 - sstep(v, 0, 0.08)) - 0.45 * sstep(v, 0.92, 1);
      return Math.max(0.006, NAUT.septum * r) * flare;
    };
    parts.push({
      geometry: grid(n, 1, (i, j) => {
        const p = pts[i];
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(n, i + 1)];
        const dx = b[0] - a[0]; const dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        const w = widthAt(i / n) * (j ? 1 : -1);
        return { p: [p[0] - (dy / len) * w, p[1] + (dx / len) * w, p[2] + 0.001], c: wallC, uv: white };
      }, [0, 0, 1]),
      keepColor: true,
    });
    if (k === 0) continue;
    // The hole.
    const at = point(0.5);
    const r = naR(t);
    const hole = Math.max(0.009, 0.019 * r);
    const collar = hole * 1.4;
    const sides = Math.round(mix(10, 22, clamp01(r / 2.4)));
    const disc = (radius, z, color) => {
      const g = new THREE.CircleGeometry(radius, sides);
      g.translate(at[0], at[1], at[2] + z);
      return { geometry: g, color };
    };
    const c1 = disc(collar, 0.0035, 0xf4ecdc);
    const c2 = disc(hole, 0.0055, 0x241509);
    for (const d of [c1, c2]) {
      const uv = d.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, white[0], white[1]);
      parts.push(d);
    }
  }

  const shell = mergeParts(parts);
  const root = new THREE.Group();
  root.add(mesh(shell, standard({
    vertexColors: true,
    map: atlas.map,
    bumpMap: nautilusBump(atlas),
    bumpScale: 0.6,
    roughness: 0.38,
    metalness: 0,
  })));

  // --- the stand ---------------------------------------------------------------------------------
  const wood = [];
  const brass = [];
  const halfW = 2.05;
  const halfD = 1.25;
  wood.push({
    geometry: roundedSlab(halfW, halfD, 0.55, [[0, 0], [0, 0.08], [0.04, 0.12], [0.08, 0.2], [0.09, 0.27], [0.14, 0.32], [0.16, 0.36]], { steps: 8 }),
    color: 0x6c4426,
  });
  const baseTop = 0.36;
  // Two cradle arms under the keel, and a strut up the back. Each ends in a ball sunk into the
  // shell, at a point asked of the shell's own surface function.
  const seat = (tau, rho) => {
    const r = naR(tau);
    const p = coil(tau, rho, -r * flank(rho));
    return p;
  };
  const seats = [seat(-2.62, 0.93), seat(-1.3, 0.93), seat(-2.05, 0.62)];
  const feet = [[seats[0][0] * 0.82, baseTop - 0.03, 0.05], [seats[1][0] * 0.82, baseTop - 0.03, 0.05], [0, baseTop - 0.03, -0.72]];
  seats.forEach((p, i) => {
    const f = feet[i];
    brass.push({ geometry: rod(f, [p[0], p[1] - (i < 2 ? 0.06 : 0), p[2] - 0.07], 0.05, { sides: 14 }), color: 0xc79a45 });
    // Pushed out of the shell until only its tip touches: the wall here is far thinner than the ball,
    // and a ball sunk any further comes through into the chamber in front of it.
    brass.push({ geometry: ball(0.085, [p[0], p[1] - (i < 2 ? 0.06 : 0), p[2] - 0.07], 16), color: 0xc79a45 });
    brass.push({ geometry: lathe([[0, 0], [0.16, 0], [0.16, 0.03], [0.1, 0.06], [0.07, 0.12], [0, 0.12]], 22), position: [f[0], baseTop - 0.002, f[2]], color: 0xc79a45 });
  });

  const plaqueW = 2.4;
  const plaqueH = 0.44;
  const tilt = 0.5;
  const px = 0;
  const py = baseTop + 0.13;
  const pz = halfD - 0.42;
  const wedge = new THREE.BoxGeometry(plaqueW + 0.12, plaqueH + 0.12, 0.08);
  wedge.applyMatrix4(plateMatrix([px, py, pz], Math.PI / 2 - tilt));
  brass.push({ geometry: wedge, color: 0xc79a45 });
  const label = new THREE.PlaneGeometry(plaqueW, plaqueH);
  const nudge = V(0, Math.sin(Math.PI / 2 - tilt), Math.cos(Math.PI / 2 - tilt)).multiplyScalar(0.046);
  label.applyMatrix4(plateMatrix([px + nudge.x, py + nudge.y, pz + nudge.z], Math.PI / 2 - tilt));
  const labelTex = canvasTexture(960, 176, (ctx, w, h) => {
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = 5;
    ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#20150b';
    fitText(ctx, 'Chambered Nautilus, half section', w / 2, 58, w - 60, 56);
    ctx.fillStyle = '#5a4020';
    fitText(ctx, 'A logarithmic spiral: 3 times wider every full turn', w / 2, 122, w - 60, 40, 'Helvetica, Arial, sans-serif', 'normal');
  });
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grainMap(47), roughness: 0.46, metalness: 0, ...relief('wood', { seed: 3, repeat: 1, strength: 0.05 }) })));
  root.add(mesh(mergeParts(brass), standard({ vertexColors: true, roughness: 0.36, metalness: 0.2 })));
  const labelMesh = mesh(label, standard({ map: labelTex, roughness: 0.6, metalness: 0 }));
  labelMesh.castShadow = false;
  root.add(labelMesh);
  return root;
}

// ---------------------------------------------------------------------------
// The Mobius strip
// ---------------------------------------------------------------------------

// S runs twice round the loop, 0 to 4 pi, because that is how far you have to walk before you are
// back where you started. The band's width direction w turns through half of S, so S + 2 pi is the
// same place with w and the face normal n both reversed: the far side of the band at that spot, and
// the SAME surface. One grid over (S, across) is therefore the entire outside of the solid, and its
// two long edges are the rim, each meeting the other half way round. There is no seam to hide because
// no two pieces were ever joined.
const MOBIUS = {
  R: 2.92, // the centre circle
  width: 1.6,
  half: 0.07, // half the band's thickness
  columns: 520,
  chevrons: 48,
  stripe: 0.26,
  stem: 1.28,
};
const mobiusCentreY = () => MOBIUS.stem + MOBIUS.half + MOBIUS.R;

function mobiusPoint(S, a, b, out = []) {
  const { R } = MOBIUS;
  const cy = mobiusCentreY();
  const sinS = Math.sin(S);
  const cosS = Math.cos(S);
  // radial, in the plane of the loop, with S = 0 at the top of the loop and S = pi at the bottom.
  const phi = S / 2;
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const rad = R + a * cp - b * sp;
  out[0] = rad * sinS;
  out[1] = cy + rad * cosS;
  out[2] = a * sp + b * cp;
  return out;
}

function mobiusLayout() {
  return { ...MOBIUS, point: mobiusPoint, centreY: mobiusCentreY() };
}

function mobiusRows() {
  // Walking across the section: round one rim, over the face, round the other rim. The stripe's two
  // edges are rows of their own, repeated so the colour changes on a line rather than across a quad.
  const { width, half, stripe } = MOBIUS;
  const flat = width / 2 - half;
  const rows = [];
  const capSteps = 5;
  for (let i = 0; i <= capSteps; i++) {
    const t = (i / capSteps) * (Math.PI / 2);
    rows.push({ a: flat + half * Math.cos(t), b: half * Math.sin(t), da: -Math.sin(t), db: Math.cos(t), kind: 'rim' });
  }
  const across = [flat, stripe / 2, stripe / 2, 0, -stripe / 2, -stripe / 2, -flat];
  const kinds = ['face', 'face', 'stripe', 'stripe', 'stripe', 'face', 'face'];
  // A little more mesh over the face, since the colour across it interpolates from these rows.
  across.forEach((a, i) => rows.push({ a, b: half, da: -1, db: 0, kind: kinds[i] }));
  for (let i = 0; i <= capSteps; i++) {
    const t = (i / capSteps) * (Math.PI / 2);
    rows.push({ a: -flat - half * Math.sin(t), b: half * Math.cos(t), da: -Math.cos(t), db: -Math.sin(t), kind: 'rim' });
  }
  return rows;
}

function mobiusTile() {
  // One chevron, which repeats a whole number of times along the band. The map is white where the
  // colour goes, because it multiplies the rainbow in the vertex colours.
  const W = 256;
  const H = 512;
  const { width, half, stripe } = MOBIUS;
  const flat = 2 * (width / 2 - half);
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#10182e';
    const lean = W * 0.62;
    for (const off of [-W, 0, W, 2 * W]) {
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(off, H / 2);
        ctx.lineTo(off + W * 0.4, H / 2);
        ctx.lineTo(off + W * 0.4 - lean, H / 2 + (sign * H) / 2);
        ctx.lineTo(off - lean, H / 2 + (sign * H) / 2);
        ctx.closePath();
        ctx.fill();
      }
    }
    // The stripe is white here and takes its cream from the vertex colours. A dark line either side.
    const sh = (stripe / flat) * H;
    ctx.fillStyle = '#10182e';
    ctx.fillRect(0, H / 2 - sh / 2 - 9, W, sh + 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, H / 2 - sh / 2, W, sh);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function mobiusBand() {
  const { columns, chevrons, width, half } = MOBIUS;
  const rows = mobiusRows();
  const ni = columns;
  const nj = rows.length - 1;
  const stride = nj + 1;
  const count = (ni + 1) * stride;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const flat = width / 2 - half;
  const hue = new THREE.Color();
  const rimC = lin(0xf6c21c);
  const stripeC = lin(0xfbf4df);
  const p = [];
  const q = [];
  const eps = 1e-4;
  for (let i = 0; i <= ni; i++) {
    const S = (i / ni) * Math.PI * 4;
    // i = ni is the same place as i = 0, with u a whole number of tiles further on, which the map
    // wraps. It exists only because one vertex cannot carry both ends of a texture coordinate.
    const phi = S / 2;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const sinS = Math.sin(S);
    const cosS = Math.cos(S);
    const radial = [sinS, cosS, 0];
    const axial = [0, 0, 1];
    const w = [radial[0] * cp + axial[0] * sp, radial[1] * cp + axial[1] * sp, radial[2] * cp + axial[2] * sp];
    const n = [-radial[0] * sp + axial[0] * cp, -radial[1] * sp + axial[1] * cp, -radial[2] * sp + axial[2] * cp];
    hue.setHSL((i % ni) / ni, 0.86, 0.5);
    for (let j = 0; j <= nj; j++) {
      const row = rows[j];
      mobiusPoint(S + eps, row.a, row.b, p);
      mobiusPoint(S - eps, row.a, row.b, q);
      const dS = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const dSec = [row.da * w[0] + row.db * n[0], row.da * w[1] + row.db * n[1], row.da * w[2] + row.db * n[2]];
      // section tangent x along-loop tangent, which comes out of the solid.
      const nx = dSec[1] * dS[2] - dSec[2] * dS[1];
      const ny = dSec[2] * dS[0] - dSec[0] * dS[2];
      const nz = dSec[0] * dS[1] - dSec[1] * dS[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      mobiusPoint(S, row.a, row.b, p);
      const at = (i * stride + j) * 3;
      positions[at] = p[0]; positions[at + 1] = p[1]; positions[at + 2] = p[2];
      normals[at] = nx / len; normals[at + 1] = ny / len; normals[at + 2] = nz / len;
      const c = row.kind === 'rim' ? rimC : row.kind === 'stripe' ? stripeC : [hue.r, hue.g, hue.b];
      colors[at] = c[0]; colors[at + 1] = c[1]; colors[at + 2] = c[2];
      const uvAt = (i * stride + j) * 2;
      uvs[uvAt] = (i / ni) * chevrons;
      uvs[uvAt + 1] = row.kind === 'rim' ? 0.5 : clamp01((row.a + flat) / (2 * flat));
    }
  }
  const indices = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + j + 1;
      const d = i * stride + j + 1;
      indices.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

// The clamp the band sits in, at the bottom of the loop, where the band lies flat: a closed sleeve
// round its section, so it holds both of the band's faces at once.
function mobiusClamp() {
  const { width, half } = MOBIUS;
  const span = 0.09;
  const grow = 0.035;
  const rows = 9;
  const secN = 28;
  const hw = width / 2 + grow;
  const hh = half + grow;
  const section = roundedOutline(hw, hh, hh * 0.9, 6).slice(0, secN + 8);
  const n = section.length;
  const positions = [];
  const indices = [];
  for (let r = 0; r <= rows; r++) {
    const S = Math.PI + mix(-span, span, r / rows);
    const out = [];
    for (const [a, b] of section) {
      mobiusPoint(S, a, b, out);
      positions.push(out[0], out[1], out[2]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = r * n + j; const b = r * n + j2; const c = (r + 1) * n + j2; const d = (r + 1) * n + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  for (const [row, flip] of [[0, false], [rows, true]]) {
    const start = positions.length / 3;
    const S = Math.PI + (row ? span : -span);
    const out = [];
    for (const [a, b] of section) {
      mobiusPoint(S, a, b, out);
      positions.push(out[0], out[1], out[2]);
    }
    mobiusPoint(S, 0, 0, out);
    const hub = positions.length / 3;
    positions.push(out[0], out[1], out[2]);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      if (flip) indices.push(hub, start + j, start + j2);
      else indices.push(hub, start + j2, start + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return outward(g);
}

function mobiusStrip() {
  const root = new THREE.Group();
  root.add(mesh(mobiusBand(), standard({ vertexColors: true, map: mobiusTile(), roughness: 0.34, metalness: 0 })));

  const metal = [];
  const wood = [];
  const brass = 0xc79a45;
  metal.push({ geometry: mobiusClamp(), color: brass });
  const stemTop = MOBIUS.stem - 0.02;
  metal.push({
    geometry: lathe([[0, 0.3], [0.2, 0.3], [0.2, 0.34], [0.13, 0.4], [0.085, 0.52], [0.07, 0.8], [0.075, stemTop - 0.22], [0.11, stemTop - 0.12], [0.22, stemTop - 0.03], [0.26, stemTop + 0.02], [0, stemTop + 0.02]], 32),
    color: brass,
  });
  wood.push({
    geometry: lathe([[0, 0], [1.3, 0], [1.3, 0.09], [1.26, 0.13], [1.14, 0.17], [0.9, 0.22], [0.5, 0.28], [0.26, 0.33], [0, 0.34]], 72),
    color: 0x6c4426,
  });
  // A plate on the base, tipped toward a student standing in front of it.
  const plaqueW = 1.3;
  const plaqueH = 0.4;
  const tilt = 0.32;
  const at = [0, 0.27, 0.93];
  const back = new THREE.BoxGeometry(plaqueW + 0.08, plaqueH + 0.08, 0.12);
  back.applyMatrix4(plateMatrix(at, Math.PI / 2 - tilt - 0.2));
  metal.push({ geometry: back, color: brass });
  const normal = V(0, Math.sin(Math.PI / 2 - tilt - 0.2), Math.cos(Math.PI / 2 - tilt - 0.2)).multiplyScalar(0.064);
  const label = new THREE.PlaneGeometry(plaqueW, plaqueH);
  label.applyMatrix4(plateMatrix([at[0] + normal.x, at[1] + normal.y, at[2] + normal.z], Math.PI / 2 - tilt - 0.2));
  const labelTex = canvasTexture(780, 240, (ctx, w, h) => {
    ctx.fillStyle = '#f3ecd9';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a2a18';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#20150b';
    fitText(ctx, 'One side. One edge.', w / 2, 72, w - 60, 72);
    ctx.fillStyle = '#5a4020';
    fitText(ctx, 'Follow the stripe twice round', w / 2, 158, w - 60, 54, 'Helvetica, Arial, sans-serif', 'normal');
  });
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.34, metalness: 0.2 })));
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grainMap(59), roughness: 0.46, metalness: 0, ...relief('wood', { seed: 2, repeat: 1, strength: 0.05 }) })));
  const labelMesh = mesh(label, standard({ map: labelTex, roughness: 0.6, metalness: 0 }));
  labelMesh.castShadow = false;
  root.add(labelMesh);
  return root;
}

export const MATH_LAYOUTS = {
  platonic: platonicLayout,
  pythagoras: pythagorasLayout,
  nautilus: nautilusLayout,
  mobius: mobiusLayout,
};

export const BUILDERS = {
  'platonic-solids': platonicSolids,
  'pythagorean-theorem': pythagoreanTheorem,
  'nautilus-shell': nautilusShell,
  'mobius-strip': mobiusStrip,
};
