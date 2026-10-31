import * as THREE from 'three';
import { standard, mesh, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, roundedOutline, smoothNoise3 } from '../../props/LoftKit.js';
import {
  lin, mix, clamp01, sstep, alongMatrix, outward, tube, lathe, tintVertices, ellipsoidP, curveP, Sculpt, polygonize, fieldD, fieldNormal, grainBump,
} from '../ModelKit.js';

// The Model Database's third maths family: a level-4 Sierpinski tetrahedron, a Galton board, a
// fraction wall, and (filed here because it is a counted, laid-out thing) an ant colony cut in half.
//
// THE RULE OF THIS FILE, inherited from MathModels.js: NOTHING A STUDENT COUNTS OR READS IS DRAWN BY
// HAND. Each model starts from a small pure function that computes it, the builder draws what that
// function returned, and MATH3_LAYOUTS exports them so the arithmetic can be checked without looking.
// A number printed on a board is read off the same data the balls and blocks were placed from.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Private solids and printing
// ---------------------------------------------------------------------------

// A closed flat-capped prism from a counter-clockwise outline in XY, from z0 to z1. Caps and sides own
// their vertices, so a flat face shades flat. UVs are in feet, which is what a grain tile wants.
function prism(outline, z0, z1) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let area = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) area += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  const pts = area < 0 ? [...outline].reverse() : outline;
  const n = pts.length;
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [z, front] of [[z1, true], [z0, false]]) {
    const start = positions.length / 3;
    for (const [x, y] of pts) { positions.push(x, y, z); uvs.push(x, y); }
    for (const [a, b, c] of faces) {
      if (front) indices.push(start + a, start + b, start + c);
      else indices.push(start + a, start + c, start + b);
    }
  }
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const step = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const at = positions.length / 3;
    positions.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
    uvs.push(run, 0, run + step, 0, run + step, z1 - z0, run, z1 - z0);
    indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
    run += step;
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A rectangle prism, the easy case.
const slab = (x0, y0, x1, y1, z0, z1) => prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);

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
  g.applyMatrix4(m);
  g.computeVertexNormals();
  return outward(g);
}

// Near-white timber grain. A map multiplies the vertex colour, so one tile serves every wood here.
function grainMap(seed, repeatU = 0.22, repeatV = 0.7) {
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

// Writes `text` at the largest size up to `size` that fits `maxWidth`: a line that runs off its plaque
// clipped mid-word is the project's most repeated bug.
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

// A flat rectangle on the plane z, facing +Z, whose UVs are one rectangle of an atlas in canvas pixels.
function atlasQuad(x0, y0, x1, y1, z, rect, atlasW, atlasH) {
  const [px, py, pw, ph] = rect;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const u0 = px / atlasW; const u1 = (px + pw) / atlasW;
  const v0 = 1 - (py + ph) / atlasH; const v1 = 1 - py / atlasH;
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

// ---------------------------------------------------------------------------
// Sierpinski pyramid
// ---------------------------------------------------------------------------

export function sierpinskiLayout(level = 4, edge = 8) {
  const R = edge / Math.sqrt(3); // base circumradius
  const height = edge * Math.sqrt(2 / 3);
  // Corner 0 is the apex, then front-left, front-right and back. A flat edge faces the student, so
  // the front face is the classic triangle of triangles.
  const corners = [
    [0, height, 0],
    [-edge / 2, 0, R / 2],
    [edge / 2, 0, R / 2],
    [0, 0, -R],
  ];
  const out = [];
  const walk = (verts, path) => {
    if (path.length === level) { out.push({ verts, path }); return; }
    for (let c = 0; c < 4; c++) {
      const child = verts.map((p) => [(p[0] + verts[c][0]) / 2, (p[1] + verts[c][1]) / 2, (p[2] + verts[c][2]) / 2]);
      walk(child, [...path, c]);
    }
  };
  walk(corners, []);
  return { tetrahedra: out, edge, height, corners, smallEdge: edge / 2 ** level, count: 4 ** level };
}

const TETRA_HUE = [0xf7b52a, 0xe8403a, 0x2a7fe0, 0x35b56a];
const TETRA_SHADE = [1.28, 1.02, 0.8, 0.62];

function buildSierpinski() {
  const group = new THREE.Group();
  const baseTop = 0.42;
  const layout = sierpinskiLayout(4, 8);

  // Every small tetrahedron, four faces, its own vertices: flat shaded and a separate solid.
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const hue = TETRA_HUE.map(lin);
  for (const { verts, path } of layout.tetrahedra) {
    const shade = TETRA_SHADE[path[1]] * (1 + (path[2] === 0 ? 0.1 : path[2] === 3 ? -0.08 : 0));
    const c = hue[path[0]].map((v) => Math.min(1, v * shade + (shade > 1.1 ? 0.04 : 0)));
    const centre = [0, 1, 2].map((a) => (verts[0][a] + verts[1][a] + verts[2][a] + verts[3][a]) / 4);
    for (const [i, j, k] of [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]) {
      const a = V(...verts[i]); const b = V(...verts[j]); const d = V(...verts[k]);
      const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
      const out = a.clone().sub(V(...centre)).dot(n) > 0;
      const tri = out ? [a, b, d] : [a, d, b];
      if (!out) n.negate();
      for (const p of tri) positions.push(p.x, p.y + baseTop, p.z);
      for (let q = 0; q < 3; q++) { normals.push(n.x, n.y, n.z); colors.push(c[0], c[1], c[2]); }
      uvs.push(0.02, 0.02, 0.98, 0.02, 0.5, 0.98);
    }
  }
  const tetra = new THREE.BufferGeometry();
  tetra.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  tetra.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  tetra.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  tetra.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // A near-white face with a dark line round it, so that 256 of them can be told apart and counted.
  const faceMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(25,20,40,0.9)';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(0.02 * w, h - 0.02 * h);
    ctx.lineTo(0.98 * w, h - 0.02 * h);
    ctx.lineTo(0.5 * w, h - 0.98 * h);
    ctx.closePath();
    ctx.stroke();
  });
  group.add(mesh(tetra, standard({ map: faceMap, vertexColors: true, roughness: 0.42, metalness: 0.05 })));

  // The base: the pyramid's own triangle grown by a circle, so that its corners are rounded and each
  // moulding is the same outline at a smaller reach.
  const tri = layout.corners.slice(1);
  const outlineAt = (reach, steps = 7) => {
    const out = [];
    // The corners run front-left, front-right, back, so an edge going (dx, dz) faces (-dz, dx).
    const normalAngle = (a, b) => Math.atan2(b[0] - a[0], -(b[2] - a[2]));
    for (let i = 0; i < 3; i++) {
      const p = tri[i];
      const a0 = normalAngle(tri[(i + 2) % 3], p);
      const a1 = normalAngle(p, tri[(i + 1) % 3]);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      for (let s = 0; s <= steps; s++) {
        const a = a0 + (sweep * s) / steps;
        out.push([p[0] + Math.cos(a) * reach, p[2] + Math.sin(a) * reach]);
      }
    }
    return out;
  };
  const profile = [[0.92, 0], [0.92, 0.17], [0.88, 0.21], [0.84, 0.25], [0.84, 0.33], [0.8, 0.38], [0.72, baseTop]];
  const bp = [];
  const bu = [];
  const bi = [];
  const rings = profile.map(([reach]) => outlineAt(reach));
  for (let r = 0; r < profile.length - 1; r++) {
    const a = bp.length / 3;
    const n = rings[r].length;
    for (let i = 0; i < n; i++) {
      for (const k of [r, r + 1]) {
        const [x, z] = rings[k][i];
        bp.push(x, profile[k][1], z);
        bu.push(x * 0.8 + z * 0.3, profile[k][1] * 2 + i * 0.3);
      }
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      bi.push(a + i * 2, a + j * 2, a + j * 2 + 1, a + i * 2, a + j * 2 + 1, a + i * 2 + 1);
    }
  }
  for (const r of [0, profile.length - 1]) {
    const a = bp.length / 3;
    const y = profile[r][1];
    for (const [x, z] of rings[r]) { bp.push(x, y, z); bu.push(x, z); }
    const c = bp.length / 3;
    bp.push(0, y, 0);
    bu.push(0, 0);
    const n = rings[r].length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      bi.push(c, a + i, a + j);
    }
  }
  const base = new THREE.BufferGeometry();
  base.setIndex(bi);
  base.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  base.setAttribute('uv', new THREE.Float32BufferAttribute(bu, 2));
  fixWinding(base);
  base.computeVertexNormals();
  group.add(mesh(mergeParts([{ geometry: base, color: 0x6a4023 }]), standard({ map: grainMap(5101, 0.5, 0.8), vertexColors: true, roughness: 0.62, metalness: 0 })));

  // The plaque, a brass plate on a walnut wedge in front of the pyramid, tilted up to the reader.
  const plaqueZ = layout.corners[1][2] + 0.5;
  const wedgeH = 0.42;
  const wedgeD = 0.62;
  const wedge = prism([[0, 0], [wedgeD, 0], [wedgeD, 0.06], [0, wedgeH]], -1.6, 1.6);
  // The outline is drawn in (depth, height) and extruded along z, so turn z onto x.
  wedge.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  // Rotating about +Y by -90 degrees sends the outline's x to +z and its extrusion z to +x.
  wedge.translate(0, baseTop, plaqueZ - wedgeD / 2);
  group.children[1].geometry = mergeParts([
    { geometry: group.children[1].geometry, keepColor: true },
    { geometry: wedge, color: 0x4f2f18 },
  ]);
  const tilt = Math.atan2(wedgeH - 0.06, wedgeD);
  const slope = Math.hypot(wedgeD, wedgeH - 0.06);
  const count = layout.count;
  const plaqueMap = canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#d3ad5a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6d5121';
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.fillStyle = '#2a1c08';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, `4 x 4 x 4 x 4 = ${count}`, w / 2, h * 0.4, w - 90, 118);
    fitText(ctx, 'small pyramids, each 1/16 as wide as the whole', w / 2, h * 0.76, w - 110, 46);
  });
  const plateW = 3.0;
  const plateH = plateW / 4;
  const plate = new THREE.PlaneGeometry(plateW, Math.min(plateH, slope - 0.04));
  plate.applyMatrix4(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - tilt) + 0));
  // The wedge's front face runs from (z = front, y = base + 0.06) up to (z = back, y = base + wedgeH).
  plate.translate(0, baseTop + (0.06 + wedgeH) / 2 + 0.004, plaqueZ + 0.004);
  group.add(mesh(plate, standard({ map: plaqueMap, roughness: 0.5, metalness: 0.2 })));
  group.children[2].castShadow = false;
  return group;
}

// Winds every triangle of a geometry outward from its own centroid, for a shape that is convex round
// the axis. A hand-built ring's handedness depends on which way the outline happens to run.
function fixWinding(g) {
  const p = g.attributes.position;
  const idx = g.index;
  const c = V(0, 0, 0);
  for (let i = 0; i < p.count; i++) c.add(V(p.getX(i), p.getY(i), p.getZ(i)));
  c.multiplyScalar(1 / p.count);
  const a = V(0, 0, 0); const b = V(0, 0, 0); const d = V(0, 0, 0);
  for (let t = 0; t < idx.count; t += 3) {
    a.fromBufferAttribute(p, idx.getX(t));
    b.fromBufferAttribute(p, idx.getX(t + 1));
    d.fromBufferAttribute(p, idx.getX(t + 2));
    const n = b.clone().sub(a).cross(d.clone().sub(a));
    if (n.dot(a.clone().sub(c)) < 0) {
      const q = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, q);
    }
  }
}

// ---------------------------------------------------------------------------
// Galton board
// ---------------------------------------------------------------------------

const choose = (n, k) => {
  let v = 1;
  for (let i = 1; i <= k; i++) v = (v * (n - k + i)) / i;
  return Math.round(v);
};

export function galtonLayout() {
  const ROWS = 10;
  const halfW = 1.75; // the inner walls of the board
  const pitch = (2 * halfW) / (ROWS + 1); // eleven bins exactly fill the width
  const rowH = 0.25;
  const wall = 0.018;
  const r = 0.0495;
  const hexH = r * Math.sqrt(3);
  const floor = 0.36;
  const wallTop = floor + 2.26;
  const lastRow = wallTop + 0.19;
  const firstRow = lastRow + (ROWS - 1) * rowH;

  // Exact binomial counts for 1024 balls, and the 256 this board can afford. A quarter of them is not
  // a whole number everywhere, and the total has to stay 256 with the board left-right symmetric,
  // which forces the middle bin even. This set is the closest that also keeps a ball in each end bin,
  // which is the point of the card's "just one path" question.
  const paths = Array.from({ length: ROWS + 1 }, (_, k) => choose(ROWS, k));
  const counts = [1, 3, 11, 30, 52, 62, 52, 30, 11, 3, 1];

  // Pegs: row i (1-based) has i pegs, one pitch apart, centred. Each is reached by C(i-1, j) paths.
  const pegs = [];
  for (let i = 1; i <= ROWS; i++) {
    for (let j = 0; j < i; j++) {
      pegs.push({ row: i, index: j, x: (j - (i - 1) / 2) * pitch, y: firstRow - (i - 1) * rowH, paths: choose(i - 1, j) });
    }
  }
  const binX = (k) => (k - ROWS / 2) * pitch;
  // Bin walls stand directly under the last row's pegs and at the board's two sides.
  const walls = [];
  for (let k = 0; k <= ROWS + 1; k++) walls.push((k - (ROWS + 1) / 2) * pitch);

  // Balls in hex rows from each bin's floor: rows of 3 then 2 alternating, a ball in a row of 2 sitting
  // in the notch between two below. A last partial row fills from the middle, and a partial row of 2
  // takes the left notch, which still rests on two balls.
  const balls = [];
  const stackTop = [];
  counts.forEach((count, k) => {
    let left = count;
    let row = 0;
    let top = floor;
    while (left > 0) {
      const y = floor + r + row * hexH;
      const wide = row % 2 === 0;
      let xs = wide ? [0, -2 * r, 2 * r] : [-r, r];
      if (wide && left === 2) xs = [-2 * r, 2 * r];
      if (wide && left === 1) xs = [0];
      if (!wide && left === 1) xs = [-r];
      for (const dx of xs) {
        if (left <= 0) break;
        balls.push({ bin: k, x: binX(k) + dx, y });
        left -= 1;
      }
      top = y + r;
      row += 1;
    }
    stackTop.push(top);
  });

  // The funnel and the few balls waiting in it.
  const neck = 0.08;
  const neckY = lastRow + (halfW - neck) * (rowH / (pitch / 2));
  const funnelTop = neckY + 0.42;
  const gateY = neckY - 0.012;
  const waiting = [];
  for (let j = 0; j < 4; j++) {
    const y = gateY + r + j * hexH;
    const reach = neck + (y - neckY);
    for (let n = -8; n <= 8; n++) {
      if ((n + j) % 2 !== 0) continue;
      const x = n * r;
      if (Math.abs(x) + r * Math.SQRT2 <= reach) waiting.push({ x, y });
    }
  }

  // The bell curve printed over the pile: the normal curve with the binomial's own mean and variance,
  // scaled by the height one ball takes up (five balls to every two rows) and lifted by one radius,
  // since a stack of hex rows has half a ball of air under its first row and over its last.
  const total = counts.reduce((a, b) => a + b, 0);
  const sigma = Math.sqrt(ROWS * 0.25);
  const perBall = (2 * hexH) / 5;
  const curveAt = (x) => {
    const b = x / pitch;
    const pdf = Math.exp(-(b * b) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    return floor + r + total * pdf * perBall;
  };

  return {
    ROWS, halfW, pitch, rowH, wall, r, hexH, floor, wallTop, lastRow, firstRow, paths, counts, total, pegs, walls, balls, stackTop, binX, neck, neckY, funnelTop, gateY, waiting, sigma, perBall, curveAt,
  };
}

function buildGalton() {
  const L = galtonLayout();
  const group = new THREE.Group();
  const TILT = THREE.MathUtils.degToRad(7);
  const LIFT = 0.14;
  const SHIFT = 0.34;
  const lean = new THREE.Matrix4().makeTranslation(0, LIFT, SHIFT).multiply(new THREE.Matrix4().makeRotationX(-TILT));
  const leaned = (v, z = 0) => [LIFT + v * Math.cos(TILT) + z * Math.sin(TILT), SHIFT - v * Math.sin(TILT) + z * Math.cos(TILT)];

  const GLASS_Z = 0.125;
  const DEPTH = GLASS_Z - 0.003;
  const RAIL_FRONT = 0.2;
  const BOARD_TOP = L.funnelTop + 0.15;
  const BALL_Z = L.r + 0.007;

  // Wood: rails, back panel, funnel fillers' sides, feet and struts.
  const wood = [];
  const WALNUT = 0x5c371e;
  const FILLER = 0x6d4426;
  wood.push({ geometry: slab(-2, 0, 2, L.floor, -0.1, RAIL_FRONT), color: WALNUT });
  for (const s of [-1, 1]) {
    const a = s < 0 ? -2 : L.halfW;
    wood.push({ geometry: slab(a, L.floor, a + 0.25, BOARD_TOP, -0.1, RAIL_FRONT), color: WALNUT });
  }
  wood.push({ geometry: slab(-L.halfW, L.funnelTop, L.halfW, BOARD_TOP, -0.1, RAIL_FRONT), color: WALNUT });
  wood.push({ geometry: slab(-L.halfW, L.floor, L.halfW, L.funnelTop, -0.09, -0.002), color: 0xa2744a });
  for (const v of [1.6, 3.2, 4.8]) wood.push({ geometry: slab(-L.halfW, v, L.halfW, v + 0.22, -0.13, -0.09), color: 0x7a5230 });
  // The fillers make the triangle: their slanted faces follow the peg rows down to the outer bin
  // walls, and above the neck they turn outward as the funnel.
  const fillerOutline = [[L.neck, L.neckY], [L.halfW, L.lastRow], [L.halfW, L.funnelTop], [L.neck + (L.funnelTop - L.neckY), L.funnelTop]];
  for (const s of [-1, 1]) {
    const outline = fillerOutline.map(([x, y]) => [s * x, y]);
    wood.push({ geometry: prism(outline, 0, DEPTH), color: FILLER });
  }
  const woodGeom = mergeParts(wood);
  woodGeom.applyMatrix4(lean);

  // Feet and struts stand on the ground and hold the lean, so they are placed in world feet.
  const feet = [];
  for (const s of [-1, 1]) {
    const x = s * 1.72;
    feet.push({ geometry: timber([x, 0.08, -1.08], [x, 0.08, 1.08], 0.24, 0.16), color: 0x472a15 });
    const [sy, sz] = leaned(3.5, -0.1);
    feet.push({ geometry: timber([x, 0.12, -0.98], [x, sy, sz - 0.04], 0.16, 0.12), color: 0x472a15 });
  }
  feet.push({ geometry: timber([-1.72, 0.1, -0.72], [1.72, 0.1, -0.72], 0.14, 0.14, 0.03, [0, 0, 1]), color: 0x472a15 });
  group.add(mesh(mergeParts([{ geometry: woodGeom, keepColor: true }, ...feet]), standard({ map: grainMap(5201), vertexColors: true, roughness: 0.6, metalness: 0 })));

  // The printed board: one canvas in board feet, carried by the back panel, the fillers' faces and the
  // bottom rail's face, so that every label lies in the same coordinates as what it labels.
  const PX = 256;
  const toX = (x) => (x + 2) * PX;
  const toY = (v) => (6 - v) * PX;
  const printRng = seededRandom(5203);
  const printed = canvasTexture(1024, 1536, (ctx, w, h) => {
    ctx.fillStyle = '#12304f';
    ctx.fillRect(0, 0, w, h);
    // A faint fall of light down the field.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(60,110,160,0.35)');
    g.addColorStop(1, 'rgba(0,10,30,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // The bins' field is printed a little darker, with a rule every 10 balls' worth of height.
    ctx.fillStyle = 'rgba(6,18,34,0.55)';
    ctx.fillRect(toX(-L.halfW), toY(L.wallTop), L.halfW * 2 * PX, (L.wallTop - L.floor) * PX);
    ctx.strokeStyle = 'rgba(170,205,235,0.22)';
    ctx.lineWidth = 2;
    for (let n = 10; n * L.perBall + L.floor < L.wallTop - 0.02; n += 10) {
      const y = toY(L.floor + L.r + n * L.perBall);
      ctx.beginPath();
      ctx.moveTo(toX(-L.halfW), y);
      ctx.lineTo(toX(L.halfW), y);
      ctx.stroke();
    }

    // Pascal's triangle, one number under each peg: how many paths reach that peg.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bcd6ee';
    ctx.font = 'bold 21px Arial, sans-serif';
    for (const peg of L.pegs) ctx.fillText(String(peg.paths), toX(peg.x), toY(peg.y - 0.135));

    // The fillers: walnut with gilt lettering.
    for (const s of [-1, 1]) {
      ctx.beginPath();
      fillerOutline.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(toX(s * x), toY(y));
        else ctx.lineTo(toX(s * x), toY(y));
      });
      ctx.closePath();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#6e4526';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        const x = printRng() * w;
        ctx.strokeStyle = printRng() < 0.7 ? `rgba(40,20,8,${0.08 + printRng() * 0.2})` : `rgba(240,200,150,${0.04 + printRng() * 0.12})`;
        ctx.lineWidth = 0.6 + printRng() * 2.4;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.bezierCurveTo(x + printRng() * 16 - 8, h * 0.3, x + printRng() * 16 - 8, h * 0.6, x + printRng() * 8 - 4, h);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = '#efd28a';
    ctx.textAlign = 'center';
    const leftC = toX(-1.13);
    const rightC = toX(1.13);
    const wide = 1.08 * PX;
    fitText(ctx, 'GALTON', leftC, toY(5.46), wide, 58);
    fitText(ctx, 'BOARD', leftC, toY(5.2), wide, 58);
    ctx.fillStyle = '#e9d6a8';
    fitText(ctx, 'Left or right,', leftC + 22, toY(4.86), wide * 0.86, 30, 'Arial, sans-serif');
    fitText(ctx, 'ten times over', leftC + 28, toY(4.7), wide * 0.84, 30, 'Arial, sans-serif');
    ctx.fillStyle = '#efd28a';
    fitText(ctx, `${L.ROWS} rows`, rightC, toY(5.46), wide, 50);
    fitText(ctx, `${L.counts.length} bins`, rightC, toY(5.22), wide, 50);
    ctx.fillStyle = '#e9d6a8';
    fitText(ctx, 'Each number', rightC - 22, toY(4.88), wide * 0.86, 30, 'Arial, sans-serif');
    fitText(ctx, 'counts the paths', rightC - 28, toY(4.72), wide * 0.84, 30, 'Arial, sans-serif');
    fitText(ctx, 'to its peg', rightC - 22, toY(4.56), wide * 0.74, 30, 'Arial, sans-serif');

    // The bottom rail: a brass strip reading each bin's paths and balls straight under that bin.
    ctx.fillStyle = '#d3ad5a';
    ctx.fillRect(0, toY(L.floor), w, L.floor * PX);
    ctx.fillStyle = '#6d5121';
    ctx.fillRect(0, toY(L.floor), w, 4);
    ctx.fillStyle = '#2a1c08';
    const pathsY = toY(L.floor * 0.72);
    const ballsY = toY(L.floor * 0.28);
    ctx.textAlign = 'center';
    fitText(ctx, 'paths', 32, pathsY, 56, 24, 'Arial, sans-serif');
    fitText(ctx, 'balls', 32, ballsY, 56, 24, 'Arial, sans-serif');
    ctx.textAlign = 'center';
    L.paths.forEach((value, k) => fitText(ctx, String(value), toX(L.binX(k)), pathsY, L.pitch * PX - 8, 32, 'Arial, sans-serif'));
    L.counts.forEach((value, k) => fitText(ctx, String(value), toX(L.binX(k)), ballsY, L.pitch * PX - 8, 32, 'Arial, sans-serif'));
    fitText(ctx, `= ${L.paths.reduce((a, b) => a + b, 0)}`, w - 32, pathsY, 56, 24, 'Arial, sans-serif');
    fitText(ctx, `= ${L.total}`, w - 32, ballsY, 56, 24, 'Arial, sans-serif');
  });
  const printParts = [
    atlasQuad(-L.halfW, L.floor, L.halfW, L.funnelTop, 0, [toX(-L.halfW), toY(L.funnelTop), L.halfW * 2 * PX, (L.funnelTop - L.floor) * PX], 1024, 1536),
    atlasQuad(-2, 0, 2, L.floor, RAIL_FRONT + 0.002, [0, toY(L.floor), 1024, L.floor * PX], 1024, 1536),
  ];
  // A filler's printed face, cut to its own outline.
  for (const s of [-1, 1]) {
    let tri = fillerOutline.map(([x, y]) => [s * x, y]);
    if (THREE.ShapeUtils.area(tri.map(([x, y]) => new THREE.Vector2(x, y))) < 0) tri = tri.reverse();
    const faces = THREE.ShapeUtils.triangulateShape(tri.map(([x, y]) => new THREE.Vector2(x, y)), []);
    const g = new THREE.BufferGeometry();
    const p = []; const n = []; const u = [];
    for (const [x, y] of tri) { p.push(x, y, DEPTH + 0.001); n.push(0, 0, 1); u.push(toX(x) / 1024, 1 - toY(y) / 1536); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    g.setIndex(faces.flat());
    printParts.push(g);
  }
  const printGeom = mergeParts(printParts.map((geometry) => ({ geometry, color: 0xffffff })));
  printGeom.applyMatrix4(lean);
  group.add(mesh(printGeom, standard({ map: printed, vertexColors: true, roughness: 0.72, metalness: 0 })));

  // Hardware: pegs, bin walls, the gate and every ball.
  const hard = [];
  const GOLD = lin(0xf0b02a);
  const rng = seededRandom(5211);
  const ballBase = new THREE.SphereGeometry(L.r, 12, 7);
  const paintBall = (geometry, jitter) => tintVertices(geometry, (x, y, z, out) => {
    // Polish, faked in the colour since there is no environment map: bright toward the light above
    // the student's shoulder, deep on the side away from it.
    const l = (x * -0.35 + y * 0.72 + z * 0.6) / L.r;
    const k = (0.72 + 0.32 * l) * jitter;
    const spark = sstep(l, 0.82, 0.98) * 0.5;
    out[0] = GOLD[0] * k + spark;
    out[1] = GOLD[1] * k + spark;
    out[2] = GOLD[2] * k + spark;
  });
  const addBall = (x, y) => {
    const g = paintBall(ballBase.clone(), 0.92 + rng() * 0.16);
    g.translate(x, y, BALL_Z);
    hard.push({ geometry: g, keepColor: true });
  };
  for (const b of L.balls) addBall(b.x, b.y);
  for (const b of L.waiting) addBall(b.x, b.y);

  const pegGeom = tube([[0, 0, 0], [0, 0, 0.09], [0, 0, DEPTH - 0.014]], [0.03, 0.03, 0.036], { sides: 9, steps: 2, round: 1 });
  for (const peg of L.pegs) {
    const g = pegGeom.clone();
    g.translate(peg.x, peg.y, 0);
    hard.push({ geometry: g, color: 0xdfe4ea });
  }
  // Inner bin walls, with a rounded top so a ball would roll off rather than perch.
  for (let i = 1; i < L.walls.length - 1; i++) {
    const x = L.walls[i];
    const t = L.wall / 2;
    const top = L.wallTop;
    hard.push({ geometry: prism([[x - t, L.floor], [x + t, L.floor], [x + t, top - 0.01], [x, top], [x - t, top - 0.01]], 0, DEPTH), color: 0xe8d9b0 });
  }
  // The gate that holds the funnel's balls back.
  hard.push({ geometry: tube([[-L.neck - 0.06, L.gateY - 0.012, BALL_Z], [L.neck + 0.06, L.gateY - 0.012, BALL_Z]], 0.012, { sides: 6, steps: 1, round: 1, straight: true }), color: 0xc9a24d });
  const hardGeom = mergeParts(hard);
  hardGeom.applyMatrix4(lean);
  group.add(mesh(hardGeom, standard({ vertexColors: true, roughness: 0.3, metalness: 0.1 })));

  // The glass, with the bell curve printed on it, over the pile.
  const glassW = (L.halfW + 0.02) * 2;
  const glassV0 = L.floor - 0.01;
  const glassV1 = L.funnelTop + 0.02;
  const GW = 704;
  const GH = Math.round((GW * (glassV1 - glassV0)) / glassW);
  const gx = (x) => ((x + glassW / 2) / glassW) * GW;
  const gy = (v) => GH - ((v - glassV0) / (glassV1 - glassV0)) * GH;
  const glassMap = canvasTexture(GW, GH, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(215,235,245,0.05)';
    ctx.fillRect(0, 0, w, h);
    const span = L.halfW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pathCurve = () => {
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) {
        const x = -span + (i / 200) * span * 2;
        const y = gy(L.curveAt(x));
        if (i === 0) ctx.moveTo(gx(x), y);
        else ctx.lineTo(gx(x), y);
      }
    };
    pathCurve();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 12;
    ctx.stroke();
    pathCurve();
    ctx.strokeStyle = '#e3172d';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labelX = gx(1.22);
    ctx.font = 'bold 27px Arial, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(8,20,36,0.9)';
    ctx.fillStyle = '#ff5b6b';
    ctx.strokeText('the bell curve', labelX, gy(1.78));
    ctx.fillText('the bell curve', labelX, gy(1.78));
  });
  glassMap.premultiplyAlpha = false;
  const glass = new THREE.PlaneGeometry(glassW, glassV1 - glassV0);
  glass.translate(0, (glassV0 + glassV1) / 2, GLASS_Z);
  glass.applyMatrix4(lean);
  const pane = mesh(glass, standard({ map: glassMap, transparent: true, roughness: 0.12, metalness: 0, depthWrite: false }));
  pane.castShadow = false;
  pane.receiveShadow = false;
  group.add(pane);
  return group;
}

// ---------------------------------------------------------------------------
// Fraction wall
// ---------------------------------------------------------------------------

export function fractionLayout(whole = 10, gap = 0.04, rowPitch = 0.75) {
  const parts = [1, 2, 3, 4, 5, 6, 8, 10, 12];
  const top = 7.4;
  const rows = parts.map((n, row) => {
    const blocks = [];
    for (let i = 0; i < n; i++) {
      // Edges are exact multiples of whole/n, so 4 twelfths and 1 third end at the same x. The gap is
      // taken from each side of an edge, never from one block's width.
      const left = -whole / 2 + (i * whole) / n;
      const right = -whole / 2 + ((i + 1) * whole) / n;
      blocks.push({ left, right, x0: left + gap / 2, x1: right - gap / 2 });
    }
    return { n, row, y0: top - (row + 1) * rowPitch + gap / 2, y1: top - row * rowPitch - gap / 2, blocks };
  });
  return { whole, gap, rowPitch, top, rows };
}

// A raised block: a rounded rectangle extruded along +Z with a small bevel, in world feet.
function raisedBlock(x0, y0, x1, y1, z0, z1, bevel = 0.05) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  const corner = 0.07;
  const ring = (inset) => {
    const pts = roundedOutline(hw - inset, hh - inset, Math.max(0.012, corner - inset), 3);
    return pts;
  };
  const profile = [[0, z0], [0, z1 - bevel], [bevel * 0.32, z1 - bevel * 0.32], [bevel, z1]];
  const positions = [];
  const indices = [];
  let n = 0;
  profile.forEach(([inset, z]) => {
    const r = ring(inset);
    n = r.length;
    for (const [x, y] of r) positions.push(cx + x, cy + y, z);
  });
  for (let b = 0; b < profile.length - 1; b++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = b * n + i; const c = b * n + j; const d = (b + 1) * n + j; const e = (b + 1) * n + i;
      indices.push(a, c, d, a, d, e);
    }
  }
  // The caps own their vertices so that the face stays flat.
  const top = ring(bevel);
  const capStart = positions.length / 3;
  for (const [x, y] of top) positions.push(cx + x, cy + y, z1);
  const capCentre = positions.length / 3;
  positions.push(cx, cy, z1);
  for (let i = 0; i < top.length; i++) indices.push(capCentre, capStart + i, capStart + ((i + 1) % top.length));
  const backStart = positions.length / 3;
  const back = ring(0);
  for (const [x, y] of back) positions.push(cx + x, cy + y, z0);
  const backCentre = positions.length / 3;
  positions.push(cx, cy, z0);
  for (let i = 0; i < back.length; i++) indices.push(backCentre, backStart + ((i + 1) % back.length), backStart + i);
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return outward(g);
}

const ROW_COLOURS = [0xf2564d, 0xf8963a, 0xf9d032, 0xa5d944, 0x45c97c, 0x2fc6c0, 0x4aa6f2, 0xa58cf5, 0xf28ac6];
const ROW_NAMES = ['one whole', 'halves', 'thirds', 'quarters', 'fifths', 'sixths', 'eighths', 'tenths', 'twelfths'];
const SCALE_MARKS = [[0, '0'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '1']];

function buildFractionWall() {
  const L = fractionLayout();
  const group = new THREE.Group();
  const HALF = 6;
  const MARGIN_IN = L.whole / 2 + 0.02;
  const MARGIN_OUT = HALF - 0.2;
  const FACE = 0.17;

  // The atlas: nine printed fractions, then the margins' names and sums, the scale and the title. Every
  // fraction cell is black on pure white, multiplied by its row's colour, so the printed patch cannot
  // show against the block round it.
  const ATLAS = 1024;
  const cellW = 204;
  const cellH = 170;
  const fracCell = (i) => [(i % 4) * (cellW + 14) + 8, Math.floor(i / 4) * (cellH + 6) + 8, cellW, cellH];
  const WHITE_SPOT = [(8 + cellW * 3.5 + 42) / ATLAS, 1 - (8 + (cellH + 6) * 2 + cellH / 2) / ATLAS];
  // Each is drawn at the aspect of the plate it lands on, or the lettering comes out squashed.
  const nameCell = (i) => [(i % 6) * 170 + 2, 540 + Math.floor(i / 6) * 74, 166, 70];
  const sumCell = (i) => [(i % 6) * 170 + 2, 700 + Math.floor(i / 6) * 118, 166, 112];
  const atlas = canvasTexture(ATLAS, ATLAS, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    L.rows.forEach(({ n }, i) => {
      const [x, y, cw, ch] = fracCell(i);
      const cx = x + cw / 2;
      ctx.fillStyle = '#141a26';
      if (n === 1) {
        fitText(ctx, '1', cx, y + ch * 0.42, cw - 20, 120, 'Arial, Helvetica, sans-serif');
        fitText(ctx, 'whole', cx, y + ch * 0.84, cw - 24, 44, 'Arial, Helvetica, sans-serif');
      } else {
        fitText(ctx, '1', cx, y + ch * 0.25, cw - 20, 72, 'Arial, Helvetica, sans-serif');
        ctx.fillRect(cx - cw * 0.26, y + ch * 0.48, cw * 0.52, 8);
        fitText(ctx, String(n), cx, y + ch * 0.76, cw - 24, 72, 'Arial, Helvetica, sans-serif');
      }
    });
    L.rows.forEach(({ n }, i) => {
      const [nx, ny, nw, nh] = nameCell(i);
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(nx, ny, nw, nh);
      ctx.fillStyle = '#2a2115';
      fitText(ctx, ROW_NAMES[i], nx + nw / 2, ny + nh / 2 + 2, nw - 12, 42, 'Arial, Helvetica, sans-serif');
      const [sx, sy, sw, sh] = sumCell(i);
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = '#2a2115';
      fitText(ctx, n === 1 ? '1 x 1' : `${n} x 1/${n}`, sx + sw / 2, sy + sh * 0.32, sw - 12, 42, 'Arial, Helvetica, sans-serif');
      fitText(ctx, '= 1', sx + sw / 2, sy + sh * 0.72, sw - 12, 42, 'Arial, Helvetica, sans-serif');
    });
  });

  const blocks = [];
  L.rows.forEach((row, i) => {
    const c = lin(ROW_COLOURS[i]);
    // A row's colour with a slight fall of light down each block: the same function of height on the
    // block and on its printed patch, so the two cannot disagree.
    const shade = (y) => 1.05 - 0.14 * ((row.y1 - y) / (row.y1 - row.y0));
    const tint = (g) => tintVertices(g, (x, y, z, out) => {
      const k = shade(y);
      out[0] = Math.min(1, c[0] * k); out[1] = Math.min(1, c[1] * k); out[2] = Math.min(1, c[2] * k);
    });
    row.blocks.forEach((b) => {
      const g = raisedBlock(b.x0, row.y0, b.x1, row.y1, 0, FACE);
      const uv = new Float32Array(g.attributes.position.count * 2);
      for (let u = 0; u < uv.length; u += 2) { uv[u] = WHITE_SPOT[0]; uv[u + 1] = WHITE_SPOT[1]; }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      blocks.push({ geometry: tint(g), keepColor: true });
      const cx = (b.x0 + b.x1) / 2;
      const cy = (row.y0 + row.y1) / 2;
      const hh = 0.29;
      const hw = hh * (cellW / cellH);
      blocks.push({ geometry: tint(atlasQuad(cx - hw, cy - hh, cx + hw, cy + hh, FACE + 0.006, fracCell(i), ATLAS, ATLAS)), keepColor: true });
    });
    // The margins: what this row is called on the left, and its sum on the right.
    const cy = (row.y0 + row.y1) / 2;
    const plateW = MARGIN_OUT - MARGIN_IN - 0.04;
    const nameH = plateW * (70 / 166);
    const sumH = plateW * (112 / 166);
    blocks.push({ geometry: atlasQuad(-MARGIN_OUT + 0.02, cy - nameH / 2, -MARGIN_IN - 0.02, cy + nameH / 2, 0.012, nameCell(i), ATLAS, ATLAS), color: 0xffffff });
    blocks.push({ geometry: atlasQuad(MARGIN_IN + 0.02, cy - sumH / 2, MARGIN_OUT - 0.02, cy + sumH / 2, 0.012, sumCell(i), ATLAS, ATLAS), color: 0xffffff });
  });
  group.add(mesh(mergeParts(blocks), standard({ map: atlas, vertexColors: true, roughness: 0.46, metalness: 0 })));

  // The frame: posts, beams, a dark back panel that shows in every gap, and the braces behind it.
  const wood = [];
  const WALNUT = 0x5a361c;
  wood.push({ geometry: slab(-HALF + 0.2, L.top - 9 * L.rowPitch, HALF - 0.2, L.top, -0.12, -0.001), color: 0x20242e });
  wood.push({ geometry: slab(-HALF + 0.2, 0.2, HALF - 0.2, L.top - 9 * L.rowPitch, -0.14, 0.22), color: WALNUT });
  wood.push({ geometry: slab(-HALF + 0.2, L.top, HALF - 0.2, 8, -0.14, 0.22), color: WALNUT });
  for (const s of [-1, 1]) {
    const a = s < 0 ? -HALF : HALF - 0.2;
    wood.push({ geometry: slab(a, 0.2, a + 0.2, 8, -0.16, 0.24), color: 0x4a2c16 });
    const x = s * (HALF - 0.1);
    wood.push({ geometry: timber([x, 0.1, -1.5], [x, 0.1, 1.5], 0.3, 0.2), color: 0x3f2512 });
    wood.push({ geometry: timber([x, 0.16, -1.34], [x, 3.6, -0.16], 0.16, 0.14), color: 0x3f2512 });
  }
  // Planks behind the panel, seen from the back.
  for (let i = 0; i < 12; i++) {
    const x0 = -HALF + 0.2 + i * ((2 * HALF - 0.4) / 12);
    const x1 = x0 + (2 * HALF - 0.4) / 12 - 0.015;
    wood.push({ geometry: slab(x0, L.top - 9 * L.rowPitch, x1, L.top, -0.15, -0.12), color: i % 2 ? 0xa8764a : 0x9c6c42 });
  }
  wood.push({ geometry: timber([-HALF + 0.3, 2.2, -0.2], [HALF - 0.3, 2.2, -0.2], 0.3, 0.1, 0.02, [0, 0, 1]), color: 0x7a4e2c });
  wood.push({ geometry: timber([-HALF + 0.3, 5.8, -0.2], [HALF - 0.3, 5.8, -0.2], 0.3, 0.1, 0.02, [0, 0, 1]), color: 0x7a4e2c });
  group.add(mesh(mergeParts(wood), standard({ map: grainMap(5301, 0.3, 0.9), vertexColors: true, roughness: 0.62, metalness: 0 })));

  // The scale along the top and bottom beams: a brass tick at each landmark fraction, exact, and a
  // cream tile naming it. It says what a student's eye is doing: running down one straight line.
  const scaleMap = canvasTexture(1024, 73, (ctx, w, h) => {
    ctx.fillStyle = '#efe6d2';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a2115';
    SCALE_MARKS.forEach(([, text], i) => fitText(ctx, text, (i + 0.5) * (w / SCALE_MARKS.length), h / 2 + 2, w / SCALE_MARKS.length - 14, 60, 'Arial, Helvetica, sans-serif'));
  });
  const scaleParts = [];
  const beamY0 = L.top - 9 * L.rowPitch;
  SCALE_MARKS.forEach(([f], i) => {
    const x = -L.whole / 2 + f * L.whole;
    const cellPx = 1024 / SCALE_MARKS.length;
    scaleParts.push(atlasQuad(x - 0.28, 0.26, x + 0.28, 0.54, 0.226, [i * cellPx, 0, cellPx, 73], 1024, 73));
    // A tick runs up the bottom beam to the wall, and one down the top beam.
    scaleParts.push(atlasQuad(x - 0.012, 0.54, x + 0.012, beamY0, 0.226, [i * cellPx + 2, 2, 1, 1], 1024, 73));
    scaleParts.push(atlasQuad(x - 0.012, L.top, x + 0.012, L.top + 0.14, 0.226, [i * cellPx + 2, 2, 1, 1], 1024, 73));
    scaleParts.push(atlasQuad(x - 0.28, L.top + 0.14, x + 0.28, L.top + 0.42, 0.226, [i * cellPx, 0, cellPx, 73], 1024, 73));
  });
  group.add(mesh(mergeParts(scaleParts.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map: scaleMap, vertexColors: true, roughness: 0.6, metalness: 0 })));
  group.children[2].castShadow = false;
  return group;
}

// ---------------------------------------------------------------------------
// Ant colony: a slice through the ground
// ---------------------------------------------------------------------------
//
// THE SOIL IS ONE SOLID WITH ITS VOIDS TAKEN OUT, AND THE CUT FACE IS A PLATE TRACED OFF THAT SAME
// FIELD: Body2's method, at the scale of a landscape. A chamber's outline on the painting, the rim of
// the hole in the plate and the wall behind it all come from one description, so they cannot disagree,
// and everything inside a void stands on a surface it asked the field for.

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

function platePlane(loops, z, uv) {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  const positions = []; const uvs = []; const normals = []; const index = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => insideLoop(h[0], outer));
    const faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), mine.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
    const base = positions.length / 3;
    for (const [a, b] of [...outer, ...mine.flat()]) {
      positions.push(a, b, z);
      const t = uv(a, b);
      uvs.push(t[0], t[1]);
      normals.push(0, 0, 1);
    }
    for (const [i, j, k] of faces) {
      const ax = positions[(base + i) * 3]; const ay = positions[(base + i) * 3 + 1];
      const bx = positions[(base + j) * 3]; const by = positions[(base + j) * 3 + 1];
      const cx = positions[(base + k) * 3]; const cy = positions[(base + k) * 3 + 1];
      if ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0) index.push(base + i, base + j, base + k);
      else index.push(base + i, base + k, base + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

const ANT_CELL = 0.11;
const ANT_FACE_Z = 1.05;
const ANT_AXIS_Z = ANT_FACE_Z - 0.2; // tunnels run just behind the cut, so each has a floor to stand on
const MOUND = { x: -0.9, z: ANT_AXIS_Z, radius: 2.15, height: 1.2 };

// The ground's height, with the mound and its crater in it.
function antGround(x, z) {
  const base = 5.56 + 0.07 * Math.sin(x * 0.9 + 1) + 0.04 * Math.sin(x * 2.1 + z * 1.3);
  const r = Math.hypot(x - MOUND.x, z - MOUND.z);
  if (r >= MOUND.radius) return base;
  const t = r / MOUND.radius;
  const a = Math.atan2(z - MOUND.z, x - MOUND.x);
  const lump = 1 + 0.05 * Math.sin(a * 5 + 1) + 0.03 * Math.sin(a * 11 + r * 4);
  const dome = MOUND.height * (1 - t * t) ** 1.25 * lump;
  const crater = 0.5 * (1 - sstep(r, 0.2, 0.66));
  return base + dome - crater;
}

// The nest, as data. Every number on the plate, every wall and every ant placement reads this table.
const ANT_CHAMBERS = {
  queen: { x: -0.1, y: 1.55, rx: 1.78, ry: 0.88, rz: 0.92, floor: 1.08 },
  nursery: { x: -2.88, y: 3.08, rx: 1.74, ry: 0.84, rz: 0.92, floor: 2.56, slope: 0.46 },
  food: { x: 2.8, y: 4.28, rx: 1.48, ry: 0.76, rz: 0.88, floor: 3.84 },
  refuse: { x: 3.55, y: 1.38, rx: 1.08, ry: 0.7, rz: 0.82, floor: 1.0 },
};
const ANT_TUNNELS = [
  { name: 'shaft', r: [0.3, 0.38, 0.42, 0.42], pts: [[-0.9, 6.95], [-0.74, 5.95], [-1.02, 5.25], [-0.85, 4.6]] },
  { name: 'toFood', r: 0.41, pts: [[-0.85, 4.6], [0.1, 4.98], [1.0, 4.6], [1.65, 4.38]] },
  { name: 'toNursery', r: 0.41, pts: [[-0.85, 4.6], [-1.72, 4.42], [-2.42, 4.2], [-2.75, 3.72]] },
  { name: 'toQueen', r: 0.41, pts: [[-0.85, 4.6], [-0.52, 3.85], [-0.86, 3.1], [-0.35, 2.2]] },
  { name: 'nurseryQueen', r: 0.4, pts: [[-1.46, 2.8], [-1.5, 2.3], [-1.3, 1.82]] },
  { name: 'queenRefuse', r: 0.4, pts: [[1.45, 1.42], [2.02, 1.8], [2.7, 1.5]] },
  { name: 'foodRefuse', r: 0.4, pts: [[3.42, 3.95], [3.78, 3.12], [3.42, 2.5], [3.58, 1.85]] },
  { name: 'resting', r: 0.38, pts: [[-0.56, 3.72], [0.28, 3.26], [1.12, 3.14]] },
  { name: 'westDrift', r: 0.38, pts: [[-2.4, 4.22], [-3.2, 4.72], [-4.08, 4.62]] },
];

const antFloorAt = (c, z) => c.floor + (c.slope ? Math.max(0, ANT_FACE_Z - z) * c.slope : 0);

// A 3D point along a tunnel, sampled on the same spline the void is swept from.
function tunnelCurve(t) {
  return new THREE.CatmullRomCurve3(t.pts.map(([x, y]) => V(x, y, ANT_AXIS_Z)), false, 'catmullrom', 0.5);
}

function ballGeom(r, c, w, h, rot = null) {
  const g = new THREE.SphereGeometry(1, w, h);
  if (rot === 'z') g.rotateX(Math.PI / 2);
  g.scale(r[0], r[1], r[2]);
  g.translate(c[0], c[1], c[2]);
  return g;
}

const ANT_RUST = { head: 0xb23a16, thorax: 0xd2501d, gaster: 0xa5300f, leg: 0xd96a2a, feeler: 0xf2a356, eye: 0x120806 };
const ANT_DEAD = { head: 0x8a7562, thorax: 0x9a8370, gaster: 0x7a6554, leg: 0xa08c78, feeler: 0xb09c86, eye: 0x241a12 };

// One worker in about 600 triangles: head, thorax and gaster joined by a narrow waist; six legs on the
// thorax only; two ELBOWED antennae, the lightest thing on it, since they carry half the identification.
// Forward is +Z, feet at y = 0. `stride` swaps which tripod of legs is forward, `carry` is held in the jaws.
function antWorker({ stride = 1, carry = null, dead = false } = {}) {
  const p = dead ? ANT_DEAD : ANT_RUST;
  const parts = [];
  const add = (geometry, color) => parts.push({ geometry, color });
  add(ballGeom([0.072, 0.06, 0.078], [0, 0.145, 0.205], 8, 6), p.head);
  add(ballGeom([0.054, 0.058, 0.095], [0, 0.145, 0.07], 7, 5), p.thorax);
  add(ballGeom([0.024, 0.03, 0.026], [0, 0.138, -0.035], 6, 4), p.thorax);
  add(tube([[0, 0.14, 0.0], [0, 0.135, -0.07]], 0.014, { sides: 4, steps: 1, round: 0, straight: true }), p.gaster);
  const gaster = ballGeom([0.09, 0.08, 0.125], [0, 0.135, -0.175], 9, 6, 'z');
  add(gaster, p.gaster);
  for (const s of [-1, 1]) {
    add(ballGeom([0.017, 0.017, 0.017], [s * 0.056, 0.164, 0.228], 5, 3), p.eye);
    // Jaws.
    add(tube([[s * 0.03, 0.125, 0.268], [s * 0.038, 0.118, 0.31], [s * 0.008, 0.116, 0.338]], [0.012, 0.01, 0.003], { sides: 3, steps: 2, round: 0 }), p.head);
    // Scape, elbow, then the funiculus bent sharply forward.
    add(tube([[s * 0.03, 0.178, 0.25], [s * 0.115, 0.226, 0.262]], [0.011, 0.01], { sides: 3, steps: 1, round: 0, straight: true }), p.feeler);
    add(ballGeom([0.014, 0.014, 0.014], [s * 0.115, 0.226, 0.262], 4, 3), p.feeler);
    add(tube([[s * 0.115, 0.226, 0.262], [s * 0.128, 0.2, 0.34], [s * 0.112, 0.152, 0.4]], [0.01, 0.009, 0.004], { sides: 3, steps: 2, round: 0 }), p.feeler);
  }
  [[0.112, 0.07], [0.072, 0], [0.032, -0.085]].forEach(([z0, dz], pair) => {
    for (const s of [-1, 1]) {
      const swing = ((pair % 2 === 0) === (s > 0) ? stride : -stride) * 0.036;
      const foot = z0 + dz * 2.1 + swing;
      const pts = dead
        ? [[s * 0.04, 0.12, z0], [s * 0.1, 0.08, z0 + dz * 0.5], [s * 0.07, 0.03, z0 + dz * 0.9]]
        : [[s * 0.04, 0.122, z0], [s * 0.122, 0.178, z0 + dz * 0.8 + swing * 0.5], [s * 0.19, 0.075, foot - dz * 0.2], [s * 0.235, 0.0, foot]];
      add(tube(pts, dead ? [0.014, 0.011, 0.005] : [0.018, 0.016, 0.011, 0.006], { sides: 3, steps: dead ? 2 : 3, round: 0 }), p.leg);
    }
  });
  if (carry) add(ballGeom(carry.r, [0, 0.13, 0.33 + carry.r[2] * 0.6], 7, 5), carry.color);
  return mergeParts(parts);
}

// The queen: the same animal at about two and a half times the length, with the swollen banded gaster
// that makes her a queen, a heavier thorax, and scars where her wings were.
function antQueen() {
  const parts = [];
  const add = (geometry, color) => parts.push({ geometry, color });
  const HEAD = 0xb53c16;
  const THORAX = 0xc9481a;
  const LEG = 0xd4692b;
  add(ballGeom([0.135, 0.112, 0.15], [0, 0.31, 0.54], 16, 11), HEAD);
  add(ballGeom([0.112, 0.125, 0.225], [0, 0.34, 0.235], 16, 11), THORAX);
  add(ballGeom([0.05, 0.062, 0.05], [0, 0.325, -0.01], 8, 6), THORAX);
  add(tube([[0, 0.325, 0.05], [0, 0.31, -0.08]], 0.028, { sides: 6, steps: 1, round: 0, straight: true }), HEAD);
  // A banded gaster: dark plates with paler membrane between, on rings across the body.
  const gaster = ballGeom([0.21, 0.19, 0.42], [0, 0.285, -0.46], 18, 26, 'z');
  tintVertices(gaster, (x, y, z, out) => {
    const u = (z + 0.88) / 0.84;
    const band = Math.abs(((u * 5) % 1) - 0.5) * 2;
    const k = sstep(band, 0.74, 0.96);
    const dark = lin(0x9a2d0e);
    const pale = lin(0xeab078);
    out[0] = mix(dark[0], pale[0], k); out[1] = mix(dark[1], pale[1], k); out[2] = mix(dark[2], pale[2], k);
  });
  parts.push({ geometry: gaster, keepColor: true });
  for (const s of [-1, 1]) {
    add(ballGeom([0.036, 0.036, 0.036], [s * 0.118, 0.348, 0.59], 7, 5), 0x120806);
    add(ballGeom([0.04, 0.016, 0.03], [s * 0.078, 0.452, 0.285], 7, 4), 0x8f3a14); // where a wing was
    add(tube([[s * 0.06, 0.25, 0.655], [s * 0.078, 0.232, 0.74], [s * 0.015, 0.228, 0.795]], [0.026, 0.021, 0.006], { sides: 5, steps: 3, round: 0 }), HEAD);
    add(tube([[s * 0.07, 0.385, 0.625], [s * 0.26, 0.5, 0.65]], [0.021, 0.018], { sides: 5, steps: 1, round: 0, straight: true }), 0xf2a356);
    add(ballGeom([0.028, 0.028, 0.028], [s * 0.26, 0.5, 0.65], 6, 4), 0xf2a356);
    add(tube([[s * 0.26, 0.5, 0.65], [s * 0.3, 0.44, 0.83], [s * 0.26, 0.33, 0.96]], [0.019, 0.017, 0.007], { sides: 5, steps: 4, round: 0 }), 0xf2a356);
  }
  [[0.33, 0.15], [0.235, 0.0], [0.13, -0.18]].forEach(([z0, dz]) => {
    for (const s of [-1, 1]) {
      const foot = z0 + dz * 2.2;
      add(tube([[s * 0.09, 0.27, z0], [s * 0.28, 0.39, z0 + dz * 0.8], [s * 0.42, 0.16, foot - dz * 0.2], [s * 0.52, 0.0, foot]], [0.04, 0.034, 0.024, 0.012], { sides: 5, steps: 7, round: 0 }), LEG);
    }
  });
  return mergeParts(parts);
}

// Heaps real solids on a floor. Each is offered several spots and goes to whichever lets it fall
// lowest, touching what is already there: a thing dropped on a heap rolls until it settles, and without
// that a pile grows into a spire of balls balanced on balls. `next(i)` returns [x, z, r].
function dropPile(count, floor, next, tries = 10) {
  const placed = [];
  const fall = (x, z, r) => {
    let y = floor + r;
    for (const q of placed) {
      const d = Math.hypot(q.x - x, q.z - z);
      const touch = q.r + r;
      if (d < touch) y = Math.max(y, q.y + Math.sqrt(touch * touch - d * d));
    }
    return y;
  };
  for (let i = 0; i < count; i++) {
    let best = null;
    for (let t = 0; t < tries; t++) {
      const [x, z, r] = next(i);
      const y = fall(x, z, r);
      if (!best || y < best.y) best = { x, y, z, r };
    }
    placed.push(best);
  }
  return placed;
}

export function antLayout() {
  return { chambers: ANT_CHAMBERS, tunnels: ANT_TUNNELS, faceZ: ANT_FACE_Z };
}

function buildAntColony() {
  const group = new THREE.Group();
  const rng = seededRandom(5401);

  // ---- The solid: ground with its top on the height function, and the nest taken out of it.
  const BLOCK = { x: 4.86, y0: 0.22, z0: -1.22 };
  const sculpt = new Sculpt(ANT_CELL);
  sculpt.add({
    box: [-BLOCK.x, BLOCK.y0, BLOCK.z0, BLOCK.x, 7.4, ANT_FACE_Z + 1],
    f: (x, y, z) => Math.max((y - antGround(x, z)) / 1.3, Math.abs(x) - BLOCK.x, BLOCK.y0 - y, BLOCK.z0 - z),
  }, 0x5a3a22);
  const CAVE = lin(0x21130a);
  for (const c of Object.values(ANT_CHAMBERS)) {
    const room = ellipsoidP([c.x, c.y, ANT_AXIS_Z + 0.05], [c.rx, c.ry, c.rz]);
    sculpt.sub(room, CAVE, { k: 0.08 });
    // A chamber has a floor: ants tread one flat, and a nursery cannot lie on a bowl. The floor fills
    // only this room. A slab that reached past it would fill in whichever room lay underneath, and the
    // nursery's did exactly that to the top of the queen's chamber. The nursery's rises to the back,
    // like a bank of seats, so that rows behind rows can be seen.
    sculpt.add({
      box: [c.x - c.rx - 0.2, c.floor - 1.2, ANT_AXIS_Z - c.rz - 0.2, c.x + c.rx + 0.2, c.floor + 0.9, ANT_FACE_Z + 0.4],
      f: (x, y, z) => Math.max((y - antFloorAt(c, z)) / 1.1, room.f(x, y, z) - 0.14),
    }, 0x4e3019, { k: 0.05 });
  }
  for (const t of ANT_TUNNELS) {
    const n = Array.isArray(t.r) ? t.r : t.pts.map(() => t.r);
    sculpt.sub(curveP(t.pts.map(([x, y]) => [x, y, ANT_AXIS_Z]), n, (t.pts.length - 1) * 8), CAVE, { k: 0.14 });
  }
  const field = sculpt.snapshot();
  const ops = field.ops;

  // ---- The plate, traced from that field at the cut plane.
  const sliceAt = (x, y) => fieldD(ops, x, y, ANT_FACE_Z);
  const loops = contour(sliceAt, [-5, 0.1, 5, 7.3], 0.045);
  const FACE_W = 10;
  const FACE_H = 7.16;
  const plate = platePlane(loops, ANT_FACE_Z, (a, b) => [(a + 5) / FACE_W, b / FACE_H]);

  // A coarse read of the same field, so the painting can darken the soil round a void cheaply.
  const halo = (() => {
    const cell = 0.07;
    const na = Math.ceil(FACE_W / cell) + 2;
    const nb = Math.ceil(FACE_H / cell) + 2;
    const v = new Float32Array(na * nb);
    for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = sliceAt(-5 + i * cell, j * cell);
    return { cell, na, nb, v };
  })();

  // ---- The painting, per texel.
  const PX = 1536;
  const PY = Math.round((PX * FACE_H) / FACE_W);
  const soilMap = canvasTexture(PX, PY, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    const data = image.data;
    const noise = seededRandom(5411);
    const N = 128;
    const low = new Float32Array(N * N);
    for (let i = 0; i < low.length; i++) low[i] = noise();
    const fine = new Float32Array(1024);
    for (let i = 0; i < fine.length; i++) fine[i] = noise();
    // Bed boundaries wander a little with x, each on its own wave, and a band is not all one thickness.
    const beds = [
      { depth: 0.52, c: [52, 34, 22], a: 0.07, f: 1.9, p: 0.4 },
      { depth: 1.6, c: [112, 70, 40], a: 0.14, f: 1.1, p: 2.1 },
      { depth: 2.85, c: [162, 100, 52], a: 0.12, f: 0.8, p: 4.4 },
      { depth: 3.75, c: [178, 130, 78], a: 0.09, f: 1.4, p: 0.9 },
      { depth: 99, c: [128, 80, 44], a: 0, f: 0, p: 0 },
    ];
    const xFeet = new Float32Array(w);
    const baseAt = new Float32Array(w);
    const bedEdge = beds.map(() => new Float32Array(w));
    for (let i = 0; i < w; i++) {
      const x = -5 + ((i + 0.5) / w) * FACE_W;
      xFeet[i] = x;
      baseAt[i] = 5.56 + 0.07 * Math.sin(x * 0.9 + 1) + 0.04 * Math.sin(x * 2.1 + ANT_FACE_Z * 1.3);
      beds.forEach((b, k) => { bedEdge[k][i] = b.depth + b.a * Math.sin(x * b.f + b.p) + b.a * 0.45 * Math.sin(x * b.f * 3.1 + b.p * 2); });
    }
    const blotch = (u, v) => {
      const a = (u % N + N) % N; const b = (v % N + N) % N;
      const i0 = Math.floor(a); const j0 = Math.floor(b);
      const i1 = (i0 + 1) % N; const j1 = (j0 + 1) % N;
      const s = a - i0; const t = b - j0;
      const ss = s * s * (3 - 2 * s); const tt = t * t * (3 - 2 * t);
      return (low[i0 + j0 * N] * (1 - ss) + low[i1 + j0 * N] * ss) * (1 - tt) + (low[i0 + j1 * N] * (1 - ss) + low[i1 + j1 * N] * ss) * tt;
    };
    const { cell, na, nb, v } = halo;
    const mound = [186, 146, 100];
    for (let py = 0; py < h; py++) {
      const y = FACE_H * (1 - (py + 0.5) / h);
      for (let px = 0; px < w; px++) {
        const x = xFeet[px];
        const depth = baseAt[px] - y;
        // Which bed, with a soft blend across each boundary.
        let r; let g; let b;
        if (depth < 0) {
          r = mound[0]; g = mound[1]; b = mound[2];
        } else {
          let k = 0;
          while (depth > bedEdge[k][px]) k += 1;
          const c = beds[k].c;
          r = c[0]; g = c[1]; b = c[2];
          const toNext = bedEdge[k][px] - depth;
          if (toNext < 0.09 && k < beds.length - 1) {
            const m = 0.5 * (1 - toNext / 0.09);
            const d = beds[k + 1].c;
            r += (d[0] - r) * m; g += (d[1] - g) * m; b += (d[2] - b) * m;
          }
        }
        // Lamination along the bed, a broad blotch, and grit.
        const lam = Math.sin(y * 21 + 1.6 * Math.sin(x * 1.3) + 0.8 * Math.sin(x * 3.7)) * 0.05 + Math.sin(y * 57 + 2 * Math.sin(x * 2.3)) * 0.03;
        const blot = (blotch(x * 3.1, y * 6.3) - 0.5) * 0.24 + (blotch(x * 11 + 40, y * 17 + 9) - 0.5) * 0.14;
        const grit = (fine[(px * 7 + py * 131 + ((px * py) & 63)) & 1023] - 0.5) * (depth < 0 ? 0.42 : 0.24);
        let light = 1 + lam + blot + grit;
        // Soil packed and stained round every void.
        const gx = Math.min(na - 2, Math.max(0, (x + 5) / cell));
        const gy = Math.min(nb - 2, Math.max(0, y / cell));
        const gi = Math.floor(gx); const gj = Math.floor(gy);
        const fs = gx - gi; const ft = gy - gj;
        const at = gi + gj * na;
        const dist = -((v[at] * (1 - fs) + v[at + 1] * fs) * (1 - ft) + (v[at + na] * (1 - fs) + v[at + na + 1] * fs) * ft);
        if (dist < 0.2) light *= 0.66 + 0.34 * sstep(dist, 0, 0.2);
        // The turf line: grass roots bind the top few inches, dark and greenish.
        if (depth > -0.02 && depth < 0.16 && Math.abs(x - MOUND.x) > 1.5) {
          const t = 1 - sstep(depth, 0.03, 0.16);
          r += (46 - r) * t; g += (64 - g) * t; b += (28 - b) * t;
        }
        const o = (px + py * w) * 4;
        data[o] = Math.min(255, r * light);
        data[o + 1] = Math.min(255, g * light);
        data[o + 2] = Math.min(255, b * light);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const X = (x) => ((x + 5) / FACE_W) * w;
    const Y = (y) => (1 - y / FACE_H) * h;
    const scale = w / FACE_W;
    // Stones, mostly in the deep beds. A stone is only painted where the plate is solid.
    const stones = seededRandom(5421);
    for (let i = 0; i < 320; i++) {
      const x = -4.9 + stones() * 9.8;
      const y = 0.3 + stones() ** 1.6 * 5;
      const r = (0.025 + stones() ** 2.2 * (y < 1.8 ? 0.17 : 0.08)) * scale;
      if (sliceAt(x, y) > -0.1 - r / scale) continue;
      const tone = 90 + stones() * 90;
      const warm = 8 + stones() * 26;
      ctx.save();
      ctx.translate(X(x), Y(y));
      ctx.rotate(stones() * 3);
      ctx.scale(1, 0.62 + stones() * 0.3);
      ctx.fillStyle = 'rgba(25,14,8,0.5)';
      ctx.beginPath();
      ctx.arc(1.5, 2.5, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${tone + warm},${tone + warm * 0.3},${tone - warm * 0.4})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,245,225,0.22)';
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.3, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Grass roots, fine and pale, reaching down from the turf.
    const roots = seededRandom(5431);
    ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      let x = -4.7 + roots() * 9.4;
      if (Math.abs(x - MOUND.x) < 1.7) continue;
      let y = 5.5;
      const len = 3 + Math.floor(roots() * 8);
      ctx.strokeStyle = `rgba(${200 + roots() * 40},${170 + roots() * 40},${120 + roots() * 40},${0.35 + roots() * 0.4})`;
      ctx.lineWidth = 0.8 + roots() * 1.6;
      ctx.beginPath();
      ctx.moveTo(X(x), Y(y));
      for (let k = 0; k < len; k++) {
        x += (roots() - 0.5) * 0.2;
        y -= 0.05 + roots() * 0.11;
        ctx.lineTo(X(x), Y(y));
      }
      ctx.stroke();
    }
    // The names of the rooms. The real chambers are right above them, so each label is the room's job.
    const label = (text, x, y, size = 30) => {
      ctx.font = `bold ${size}px Arial, sans-serif`;
      const wide = ctx.measureText(text).width + 22;
      const high = size + 12;
      const left = X(x) - wide / 2;
      const top = Y(y) - high / 2;
      ctx.fillStyle = 'rgba(30,17,9,0.82)';
      ctx.beginPath();
      ctx.moveTo(left + 8, top);
      ctx.arcTo(left + wide, top, left + wide, top + high, 8);
      ctx.arcTo(left + wide, top + high, left, top + high, 8);
      ctx.arcTo(left, top + high, left, top, 8);
      ctx.arcTo(left, top, left + wide, top, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe9bf';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, X(x), Y(y) + 1);
    };
    label("QUEEN'S CHAMBER", ANT_CHAMBERS.queen.x, ANT_CHAMBERS.queen.floor - 0.27);
    label('NURSERY', ANT_CHAMBERS.nursery.x, ANT_CHAMBERS.nursery.floor - 0.27);
    label('FOOD STORE', ANT_CHAMBERS.food.x - 0.72, ANT_CHAMBERS.food.floor - 0.26);
    label('REFUSE', ANT_CHAMBERS.refuse.x, ANT_CHAMBERS.refuse.floor - 0.26);
    // The sill's brass strip lives on the same canvas, below the plate's lowest visible edge.
    ctx.fillStyle = '#d3ad5a';
    ctx.fillRect(0, Y(0.34), w, h - Y(0.34));
    ctx.fillStyle = '#2a1c08';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'ANT COLONY: a slice through the ground, with the ants about 30 times life size', w / 2, Y(0.205), PX * 0.68 - 40, 34);
  });
  soilMap.colorSpace = THREE.SRGBColorSpace;
  const Y0 = PY * (1 - 0.325 / FACE_H);
  const sillPlate = atlasQuad(-3.4, 0.1, 3.4, 0.34, 1.252, [PX * 0.16, Y0, PX * 0.68, PY * (0.24 / FACE_H)], PX, PY);
  group.add(mesh(mergeParts([{ geometry: plate, color: 0xffffff }, { geometry: sillPlate, color: 0xffffff }]), standard({ map: soilMap, vertexColors: true, roughness: 0.94, metalness: 0 })));

  // ---- The walls of the voids and the top of the ground: the same solid, polygonised, trimmed at the
  // cut plane with its rim pressed onto it, and with the sides nobody can see thrown away.
  const trim = ANT_CELL * 1.6;
  const reach = 200;
  sculpt.sub({
    box: [-reach, -reach, ANT_FACE_Z + trim, reach, reach, ANT_FACE_Z + trim + reach],
    f: (x, y, z) => ANT_FACE_Z + trim - z,
  });
  const GRASS = lin(0x4a8a2c);
  const GRASS2 = lin(0x2f6a21);
  const SPOIL = lin(0xb48a5c);
  const SPOIL2 = lin(0x8c6a42);
  const FLOOR = lin(0x4a2e18);
  const earth = polygonize(sculpt, {
    uvScale: 1.1,
    tint: (x, y, z, nx, ny, nz, c) => {
      const top = antGround(x, z);
      const onTop = y > top - 0.1 && !(Math.hypot(x - MOUND.x, z - MOUND.z) < 0.42 && y < top - 0.05);
      const n = smoothNoise3(x * 2.3, y * 2.3, z * 2.3);
      if (onTop) {
        const r = Math.hypot(x - MOUND.x, z - MOUND.z);
        const spoil = 1 - sstep(r, MOUND.radius * 0.72, MOUND.radius * 0.96);
        const k = clamp01(0.5 + (n - 0.5) * 2.2);
        const g = [mix(GRASS[0], GRASS2[0], k), mix(GRASS[1], GRASS2[1], k), mix(GRASS[2], GRASS2[2], k)];
        const s = [mix(SPOIL[0], SPOIL2[0], k), mix(SPOIL[1], SPOIL2[1], k), mix(SPOIL[2], SPOIL2[2], k)];
        // The mouth of the crater is the dark of the tunnel it leads to.
        const mouth = 1 - sstep(r, 0.28, 0.5);
        for (let i = 0; i < 3; i++) c[i] = mix(mix(g[i], s[i], spoil), CAVE[i], mouth * 0.85);
      } else {
        const floor = sstep(ny, 0.45, 0.85);
        const k = 0.78 + n * 0.44;
        for (let i = 0; i < 3; i++) c[i] = mix(CAVE[i], FLOOR[i], floor) * k;
      }
    },
  });
  {
    const p = earth.attributes.position;
    const idx = earth.index;
    const kept = [];
    const hidden = (i) => Math.abs(p.getX(i)) > BLOCK.x - 0.08 || p.getZ(i) < BLOCK.z0 + 0.08 || p.getY(i) < BLOCK.y0 + 0.08;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t); const b = idx.getX(t + 1); const d = idx.getX(t + 2);
      if (p.getZ(a) >= ANT_FACE_Z && p.getZ(b) >= ANT_FACE_Z && p.getZ(d) >= ANT_FACE_Z) continue;
      if (hidden(a) && hidden(b) && hidden(d)) continue;
      kept.push(a, b, d);
    }
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > ANT_FACE_Z) p.setZ(i, ANT_FACE_Z);
    earth.setIndex(kept);
  }

  // ---- Grass and the grains of the spoil heap, on the top of the same ground.
  const topParts = [{ geometry: earth, keepColor: true }];
  const bladeColors = [0x62ad33, 0x4d9a2b, 0x7cc23f, 0x3f8a2a];
  for (let i = 0; i < 80; i++) {
    const x = -4.55 + rng() * 9.1;
    const z = -1.08 + rng() * 2.04;
    if (Math.hypot(x - MOUND.x, z - MOUND.z) < MOUND.radius * 0.8) { rng(); rng(); continue; }
    const y = antGround(x, z) - 0.03;
    const dir = rng() * Math.PI * 2;
    for (let b = 0; b < 3; b++) {
      const a = dir + (b * Math.PI * 2) / 3 + rng() * 0.5;
      const h = 0.34 + rng() * 0.42;
      const out = 0.1 + rng() * 0.2;
      topParts.push({
        geometry: tube([[x, y, z], [x + Math.cos(a) * out * 0.3, y + h * 0.62, z + Math.sin(a) * out * 0.3], [x + Math.cos(a) * out, y + h, z + Math.sin(a) * out]], [0.03, 0.018, 0.001], { sides: 3, steps: 2, round: 0 }),
        color: bladeColors[Math.floor(rng() * bladeColors.length)],
      });
    }
  }
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.5 + Math.sqrt(rng()) * (MOUND.radius - 0.65);
    const x = MOUND.x + Math.cos(a) * r;
    const z = MOUND.z + Math.sin(a) * r;
    if (z > ANT_FACE_Z - 0.06 || z < BLOCK.z0 + 0.1) continue;
    const grain = 0.03 + rng() * 0.045;
    const y = antGround(x, z) + grain * 0.25;
    const g = new THREE.SphereGeometry(grain, 5, 3);
    g.translate(x, y, z);
    const t = 0.6 + rng() * 0.75;
    const col = new THREE.Color(0xb48a5c).multiplyScalar(t);
    topParts.push({ geometry: g, color: col.getHex() });
  }
  const groundMesh = mesh(mergeParts(topParts), standard({ vertexColors: true, roughness: 0.96, metalness: 0, bumpMap: (() => { const b = grainBump(5441, { size: 256, dots: 1800, min: 1, max: 3.4, contrast: 0.55 }); return b; })(), bumpScale: 0.9 }));
  // Neither the top of the ground nor the plate casts: otherwise the sun never reaches a single room.
  groundMesh.castShadow = false;
  group.add(groundMesh);
  group.children[0].castShadow = false;

  // ---- The frame: cheeks, sill, back boards and feet. No glass, and nothing across the top.
  const wood = [];
  const FRAME = 0x3a2212;
  const FRAME2 = 0x4a2c17;
  const CHEEK_TOP = 5.98;
  for (const s of [-1, 1]) {
    const a = s < 0 ? -5 : 4.72;
    wood.push({ geometry: slab(a, 0.1, a + 0.28, CHEEK_TOP, -1.25, 1.25), color: 0x5a371e });
    wood.push({ geometry: timber([s * 4.84, 0.08, -1.62], [s * 4.84, 0.08, 1.62], 0.34, 0.16), color: 0x2c1a0d });
  }
  wood.push({ geometry: slab(-4.72, 0.1, 4.72, 0.42, 0.8, 1.25), color: FRAME2 });
  wood.push({ geometry: slab(-4.72, 0.1, 4.72, 0.3, -1.25, 0.8), color: FRAME });
  const BOARDS = 9;
  for (let i = 0; i < BOARDS; i++) {
    const x0 = -4.72 + (i * 9.44) / BOARDS;
    const x1 = x0 + 9.44 / BOARDS - 0.014;
    wood.push({ geometry: slab(x0, 0.1, x1, 5.84, -1.25, -1.17), color: i % 2 ? 0x9a6a40 : 0x8d5f38 });
  }
  wood.push({ geometry: slab(-4.72, 0.1, 4.72, 5.84, -1.17, -1.14), color: 0x1c0f07 });
  wood.push({ geometry: slab(-4.72, 5.84, 4.72, CHEEK_TOP, -1.27, -1.15), color: FRAME });
  wood.push({ geometry: timber([-4.7, 3, -1.3], [4.7, 3, -1.3], 0.34, 0.1, 0.02, [0, 0, 1]), color: 0x6b4325 });
  group.add(mesh(mergeParts(wood), standard({ map: grainMap(5451, 0.3, 0.8), vertexColors: true, roughness: 0.66, metalness: 0 })));

  // ---- The colony. Every animal is placed by asking the field where the surface is.
  const life = [];
  const place = (geometry, m) => { const g = geometry.clone(); g.applyMatrix4(m); life.push({ geometry: g, keepColor: true }); };
  const antA = antWorker({ stride: 1 });
  const antB = antWorker({ stride: -1 });
  const counts = { tunnels: 0, surface: 0, attendants: 0, nurses: 0, store: 0, dead: 0 };
  const basis = (p, forward, up, s = 1) => {
    const u = up.clone().normalize();
    const f = forward.clone().addScaledVector(u, -forward.dot(u)).normalize();
    const r = u.clone().cross(f).normalize();
    return new THREE.Matrix4().makeBasis(r.clone().multiplyScalar(s), u.clone().multiplyScalar(s), f.clone().multiplyScalar(s)).setPosition(p);
  };
  // From the tunnel's axis, go down to the floor; on a steep run go back to the rear wall instead, so
  // the ant is seen from above, climbing. Marching outward from the air until it meets soil.
  const onTunnel = (name, t, flip = 1, s = 1, ant = antA) => {
    const tun = ANT_TUNNELS.find((q) => q.name === name);
    const curve = tunnelCurve(tun);
    const a = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const dir = Math.abs(tan.y) > 0.62 ? V(0, -0.02, -1).normalize() : V(0, -1, -0.08).normalize();
    const q = a.clone();
    q.z -= 0.07;
    for (let i = 0; i < 80 && field.d(q.x, q.y, q.z) > 0; i++) q.addScaledVector(dir, 0.02);
    const n = V(...fieldNormal(field, [q.x, q.y + (Math.abs(tan.y) > 0.62 ? 0 : 0.03), q.z + (Math.abs(tan.y) > 0.62 ? 0.03 : 0)]));
    place(ant, basis(q, tan.clone().multiplyScalar(flip), n, s));
    counts.tunnels += 1;
  };
  const tunnelAnts = [
    ['shaft', 0.3, 1, antA], ['shaft', 0.62, -1, antB], ['shaft', 0.86, 1, antA],
    ['toFood', 0.22, 1, antB], ['toFood', 0.52, -1, antA], ['toFood', 0.8, 1, antB],
    ['toNursery', 0.22, 1, antA], ['toNursery', 0.5, -1, antB], ['toNursery', 0.76, 1, antA],
    ['toQueen', 0.2, 1, antB], ['toQueen', 0.5, -1, antA], ['toQueen', 0.8, 1, antB],
    ['nurseryQueen', 0.5, 1, antA],
    ['queenRefuse', 0.5, 1, antB],
    ['foodRefuse', 0.28, 1, antA], ['foodRefuse', 0.66, -1, antB],
    ['resting', 0.42, 1, antA], ['resting', 0.88, -1, antB],
    ['westDrift', 0.55, 1, antB],
  ];
  for (const [name, t, flip, ant] of tunnelAnts) onTunnel(name, t, flip, 1, ant);

  // On the surface, heading home to the crater; one has a seed and one a piece of green leaf.
  const seedCarry = antWorker({ stride: 1, carry: { r: [0.07, 0.05, 0.095], color: 0xd2a65a } });
  const leafCarry = antWorker({ stride: -1, carry: { r: [0.15, 0.022, 0.13], color: 0x58b02f } });
  const surfaceAnts = [
    [-3.6, 0.45, antA], [2.0, 0.55, seedCarry], [0.75, 0.35, leafCarry], [3.3, -0.2, antB], [-2.75, 0.25, antB], [-0.05, 0.62, antA],
  ];
  for (const [x, z, ant] of surfaceAnts) {
    const y = antGround(x, z);
    const n = V(...fieldNormal(field, [x, y, z]));
    const to = V(MOUND.x - x, 0, MOUND.z - z);
    place(ant, basis(V(x, y - 0.005, z), to, n));
    counts.surface += 1;
  }

  // The queen's chamber: the queen broadside to the student, attendants all round her.
  const Q = ANT_CHAMBERS.queen;
  const queen = antQueen();
  place(queen, basis(V(Q.x + 0.04, Q.floor, ANT_AXIS_Z - 0.43), V(1, 0, 0), V(0, 1, 0), 1.14));
  const upY = V(0, 1, 0);
  // Nothing stands between her and the student: attendants at her head and tail, and behind her.
  const tend = [
    [Q.x + 1.42, ANT_AXIS_Z - 0.32, -1, 0.0, antA], // feeding her, face to face
    [Q.x - 1.44, ANT_AXIS_Z - 0.36, 1, 0.0, antB], // at her tail, where the eggs come out
    [Q.x + 1.12, ANT_AXIS_Z - 0.1, -1, -0.35, antB],
    [Q.x - 0.82, ANT_AXIS_Z - 0.13, 0.6, -0.5, antA],
    [Q.x + 1.2, ANT_AXIS_Z - 0.68, -0.8, 0.5, antB],
  ];
  for (const [x, z, fx, fz, ant] of tend) {
    place(ant, basis(V(x, Q.floor, z), V(fx, 0, fz), upY));
    counts.attendants += 1;
  }

  // Eggs just laid behind her, waiting to be carried to the nursery.
  const eggColour = lin(0xfff6e2);
  const eggGeom = (rs) => tintVertices(new THREE.SphereGeometry(1, 7, 5).rotateZ(Math.PI / 2).scale(rs * 1.5, rs, rs), (x, y, z, out) => {
    const k = 0.86 + 0.14 * (y / rs + 1) * 0.5;
    out[0] = eggColour[0] * k; out[1] = eggColour[1] * k; out[2] = eggColour[2] * k;
  });
  const addEgg = (x, y, z, yaw) => {
    const g = eggGeom(0.058);
    g.rotateY(yaw);
    g.translate(x, y + 0.058, z);
    life.push({ geometry: g, keepColor: true });
  };
  for (const [dx, dz] of [[-1.42, 0.08], [-1.28, 0.02], [-1.34, -0.1], [-1.2, 0.12]]) addEgg(Q.x + dx, Q.floor, ANT_AXIS_Z + dz, dx * 3);

  // The nursery in rows, oldest to the right: eggs, larvae, pupae, the order they come in.
  const N = ANT_CHAMBERS.nursery;
  const rowZ = [ANT_AXIS_Z + 0.08, ANT_AXIS_Z - 0.16, ANT_AXIS_Z - 0.4];
  const span = N.rx * 0.76;
  const ex0 = N.x - span;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 6; i++) addEgg(ex0 + 0.03 + i * 0.14 + (row % 2) * 0.07, antFloorAt(N, rowZ[row]), rowZ[row], 0);
  }
  const LARVA = lin(0xfdf1d6);
  const larvaGeom = (flip) => {
    const pts = [];
    for (let a = 0; a <= 6; a++) {
      const t = (a / 6) * Math.PI * 1.3 - 0.5;
      pts.push([flip * Math.cos(t) * 0.11, Math.sin(t) * 0.11, 0]);
    }
    // Pear-shaped and comma-curled, thin at the head end, ringed by alternating the colour of its rows.
    const g = tube(pts, [0.03, 0.044, 0.062, 0.078, 0.086, 0.074, 0.044], { sides: 6, steps: 12, round: 1 });
    return tintVertices(g, (x, y, z, out, i) => {
      const k = Math.floor(i / 6) % 2 ? 0.86 : 1;
      out[0] = LARVA[0] * k; out[1] = LARVA[1] * k; out[2] = LARVA[2] * k * 0.96;
    });
  };
  const lx0 = ex0 + 1.12;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) {
      const g = larvaGeom(i % 2 ? 1 : -1);
      g.rotateX(-0.85);
      g.computeBoundingBox();
      const z = rowZ[row];
      g.translate(lx0 + i * 0.36 + (row % 2) * 0.1, antFloorAt(N, z) - g.boundingBox.min.y - 0.01, z);
      life.push({ geometry: g, keepColor: true });
    }
  }
  const PUPA = lin(0xe6c489);
  const pupaGeom = () => {
    const g = lathe([[0, -0.2], [0.05, -0.185], [0.085, -0.12], [0.1, -0.03], [0.098, 0.05], [0.082, 0.12], [0.05, 0.18], [0, 0.205]], 9);
    g.rotateZ(Math.PI / 2);
    return tintVertices(g, (x, y, z, out) => {
      const band = 0.93 + 0.1 * Math.cos(x * 34);
      out[0] = PUPA[0] * band; out[1] = PUPA[1] * band; out[2] = PUPA[2] * band;
    });
  };
  const px0 = lx0 + 1.2;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 2; i++) {
      const g = pupaGeom();
      const z = rowZ[row];
      g.rotateY(0.1 * (row - 1));
      g.translate(px0 + i * 0.47 + (row % 2) * 0.07, antFloorAt(N, z) + 0.095, z);
      life.push({ geometry: g, keepColor: true });
    }
  }
  const eggCarry = antWorker({ stride: 1, carry: { r: [0.05, 0.05, 0.075], color: 0xfff6e2 } });
  const rampUp = V(0, 1, N.slope).normalize();
  for (const [x, fx, ant] of [[N.x - 0.42, 1, antA], [N.x + 0.42, -1, antB], [N.x + 1.1, -1, eggCarry]]) {
    const z = ANT_AXIS_Z - 0.62;
    place(ant, basis(V(x, antFloorAt(N, z), z), V(fx, 0, 0.3), rampUp));
    counts.nurses += 1;
  }

  // The food store: seeds in a real heap, dropped one at a time.
  const F = ANT_CHAMBERS.food;
  const seedRng = seededRandom(5461);
  const SEED_COUNT = 50;
  const seeds = dropPile(SEED_COUNT, F.floor, (i) => {
    // The reach shrinks as the heap grows, so it comes out a dome.
    const reach = 0.92 * (1 - (i / SEED_COUNT) * 0.7);
    const a = seedRng() * Math.PI * 2;
    const r = Math.sqrt(seedRng()) * reach;
    return [F.x + 0.05 + Math.cos(a) * r, Math.min(ANT_FACE_Z - 0.17, ANT_AXIS_Z - 0.2 + Math.sin(a) * r * 0.46), 0.082 + seedRng() * 0.032];
  });
  const SEEDS = [lin(0xd9a85a), lin(0xc08a3f), lin(0xe8c47c), lin(0x9c6c30)];
  const seedMatrix = new THREE.Matrix4();
  for (const s of seeds) {
    const col = SEEDS[Math.floor(seedRng() * SEEDS.length)];
    const k = 0.9 + seedRng() * 0.2;
    const e = new THREE.Euler(seedRng() * 3, seedRng() * 6, seedRng() * 3);
    const g = new THREE.SphereGeometry(s.r, 7, 5);
    g.scale(1.24, 0.88, 0.88);
    seedMatrix.makeRotationFromEuler(e).setPosition(s.x, s.y - s.r * 0.08, s.z);
    g.applyMatrix4(seedMatrix);
    life.push({
      geometry: tintVertices(g, (x, y, z, out) => { out[0] = col[0] * k; out[1] = col[1] * k; out[2] = col[2] * k; }),
      keepColor: true,
    });
  }
  for (const [x, z, fx, fz, ant] of [[F.x - 1.08, ANT_AXIS_Z - 0.12, 1, 0.1, seedCarry], [F.x + 1.06, ANT_AXIS_Z - 0.3, -1, 0.3, antA]]) {
    place(ant, basis(V(x, F.floor, z), V(fx, 0, fz), upY));
    counts.store += 1;
  }

  // The refuse chamber: the dead and the empty husks, heaped against the far wall.
  const R = ANT_CHAMBERS.refuse;
  // A real heap of crumbled waste first. Whatever lies on it asks its height, so nothing can hang in
  // the air, which a pile of long thin bodies stacked as spheres did.
  const heap = { x: R.x + 0.16, z: ANT_AXIS_Z - 0.26, rx: 0.78, rz: 0.4, h: 0.46 };
  const heapAt = (x, z) => heap.h * Math.sqrt(Math.max(0, 1 - ((x - heap.x) / heap.rx) ** 2 - ((z - heap.z) / heap.rz) ** 2));
  const heapUp = (x, z) => {
    const e = 0.02;
    return V(heapAt(x - e, z) - heapAt(x + e, z), 2 * e, heapAt(x, z - e) - heapAt(x, z + e)).normalize();
  };
  const heapGeom = new THREE.SphereGeometry(1, 20, 12);
  heapGeom.scale(heap.rx, heap.h, heap.rz);
  heapGeom.translate(heap.x, R.floor, heap.z);
  const HEAP = lin(0x5b4530);
  const HEAP2 = lin(0x2f2318);
  tintVertices(heapGeom, (x, y, z, out) => {
    const n = clamp01(0.5 + (smoothNoise3(x * 7, y * 7, z * 7) - 0.5) * 3);
    out[0] = mix(HEAP2[0], HEAP[0], n); out[1] = mix(HEAP2[1], HEAP[1], n); out[2] = mix(HEAP2[2], HEAP[2], n);
  });
  // Matte and crumbly, so it joins the ground's mesh rather than the animals' gloss.
  groundMesh.geometry = mergeParts([{ geometry: groundMesh.geometry, keepColor: true }, { geometry: heapGeom, keepColor: true }]);
  const deadAnt = antWorker({ dead: true });
  const pileRng = seededRandom(5471);
  const taken = [];
  const spot = (minGap) => {
    for (let t = 0; t < 60; t++) {
      const a = pileRng() * Math.PI * 2;
      const r = Math.sqrt(pileRng()) * 0.8;
      const x = heap.x + Math.cos(a) * r * heap.rx;
      const z = heap.z + Math.sin(a) * r * heap.rz;
      if (taken.every((q) => Math.hypot(q[0] - x, (q[1] - z) * 1.6) > minGap)) { taken.push([x, z]); return [x, z]; }
    }
    return [heap.x, heap.z];
  };
  for (let i = 0; i < 6; i++) {
    // On their backs with their legs folded, lying more or less across the student's view.
    const [x, z] = spot(0.34);
    const up = heapUp(x, z);
    const yaw = (i % 2 ? 0 : Math.PI) + (pileRng() - 0.5) * 1.0;
    const down = up.clone().multiplyScalar(-1);
    const p = V(x, R.floor + heapAt(x, z), z).addScaledVector(up, 0.19);
    place(deadAnt, basis(p, V(Math.cos(yaw), 0, Math.sin(yaw) * 0.6), down));
    counts.dead += 1;
  }
  for (let i = 0; i < 9; i++) {
    const [x, z] = spot(0.14);
    const r = 0.07 + pileRng() * 0.03;
    const g = new THREE.SphereGeometry(r, 6, 4);
    g.scale(1.25, 0.6, 0.85);
    g.rotateY(pileRng() * 6.28);
    g.translate(x, R.floor + heapAt(x, z) + r * 0.2, z);
    const col = pileRng() < 0.5 ? lin(0xc29c62) : lin(0x8c7250);
    life.push({ geometry: tintVertices(g, (px, py, pz, out) => { out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; }), keepColor: true });
  }
  const hauler = antWorker({ stride: 1, carry: { r: [0.06, 0.04, 0.09], color: 0xc29c62 } });
  place(hauler, basis(V(R.x - 0.82, R.floor, ANT_AXIS_Z - 0.12), V(1, 0, 0), upY));
  counts.store += 1;

  group.add(mesh(mergeParts(life), standard({ vertexColors: true, roughness: 0.4, metalness: 0.05 })));
  group.userData.antCounts = counts;
  return group;
}

export const MATH3_LAYOUTS = { sierpinskiLayout, galtonLayout, fractionLayout, antLayout, antWorker, antQueen };

export const BUILDERS = {
  'sierpinski-pyramid': buildSierpinski,
  'galton-board': buildGalton,
  'fraction-wall': buildFractionWall,
  'ant-colony': buildAntColony,
};
