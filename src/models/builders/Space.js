import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom, randomIn, relief } from '../../PropKit.js';
import {
  ball, extrudeOutline, gearOutline, grooveAt, mergeParts, revolve, roundedOutline,
  smoothNoise3, solidLoft, tube, weldSeam, xformed,
} from '../../props/LoftKit.js';

// The Model Database's Space family: Earth's Layers, the Solar System Orrery, the Apollo Lunar
// Module, a Mars rover, the Saturn V and an Amethyst Geode. Authored in feet, origin at the base
// centre, front toward +Z, with every model one to five merged meshes.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (t) => Math.max(0, Math.min(1, t));

// A solid of revolution from `[radius, y]`, wound outward whichever way the profile was written.
// LoftKit's revolve takes its winding from the profile's direction, so this measures it: closed
// along the axis, a profile that keeps its material on the right of travel is the one revolve
// turns outward. Corners sharper than `crease` degrees stay crisp.
function lathe(profile, { segments = 32, crease = 32 } = {}) {
  let area = 0;
  const closed = [...profile, [0, profile[profile.length - 1][1]], [0, profile[0][1]]];
  for (let i = 0; i < closed.length; i++) {
    const [x1, y1] = closed[i];
    const [x2, y2] = closed[(i + 1) % closed.length];
    area += x1 * y2 - x2 * y1;
  }
  const g = revolve(area > 0 ? [...profile].reverse() : profile, { segments });
  return crease ? toCreasedNormals(g, crease * DEG) : g;
}

// A straight bar between two points, capped both ends. r2 is the radius at b.
function rod(a, b, r, { r2 = r, sides = 10 } = {}) {
  const A = V(...a);
  const d = V(...b).sub(A);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r2, r, len, sides);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A, q, V(1, 1, 1)));
  return g;
}

// A curved swept tube wound outward. LoftKit's tube() is wound inward (see CLAUDE.md), so its
// triangles are reversed here rather than in the shared kit.
function pipe(points, radii, { sides = 10, tubular = null } = {}) {
  const steps = tubular ?? Math.max(6, points.length * 5);
  const g = tube(points, radii, { tubular: steps, sides });
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.computeVertexNormals();
  return weldSeam(g, sides + 1, steps + 1);
}

// Straight spans with a socket ball at every interior node and a cap at each open end.
function strut(list, color, nodes, r, { sides = 10, detail = 10, capEnds = true } = {}) {
  for (let i = 0; i < nodes.length - 1; i++) list.push({ geometry: rod(nodes[i], nodes[i + 1], r, { sides }), color });
  for (let i = capEnds ? 0 : 1; i < nodes.length - (capEnds ? 0 : 1); i++) {
    list.push({ geometry: ball(r * 1.08, detail), color, position: nodes[i] });
  }
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

// A flat-faced solid from vertices and polygons. Every face keeps its own vertices so an edge is
// an edge, each polygon is wound by MEASURING it against the solid's centre rather than trusting
// the order it was typed in, and the UVs are laid out in feet on the face's dominant plane so a
// tiling map lands at one size on every panel.
function facetSolid(verts, faces, { colors = null } = {}) {
  const c = V();
  for (const v of verts) c.add(V(...v));
  c.multiplyScalar(1 / verts.length);
  const pos = [];
  const nor = [];
  const uvs = [];
  const col = [];
  faces.forEach((face, fi) => {
    const pts = face.map((i) => V(...verts[i]));
    const n = V();
    const mid = V();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
      mid.add(p);
    }
    mid.multiplyScalar(1 / pts.length);
    n.normalize();
    const ordered = n.dot(mid.clone().sub(c)) < 0 ? pts.reverse() : pts;
    if (n.dot(mid.clone().sub(c)) < 0) n.negate();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const uv = (p) => (ax >= ay && ax >= az ? [p.z, p.y] : ay >= az ? [p.x, p.z] : [p.x, p.y]);
    const tone = colors ? lin(typeof colors === 'function' ? colors(fi, n, mid) : colors[fi]) : null;
    for (let i = 1; i < ordered.length - 1; i++) {
      for (const p of [ordered[0], ordered[i], ordered[i + 1]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        uvs.push(...uv(p));
        if (tone) col.push(...tone);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// A hard-edged hull through matching polygon sections.
function sectionHull(sections, { colors = null, capStart = true, capEnd = true } = {}) {
  const n = sections[0].length;
  const verts = sections.flat();
  const faces = [];
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < n; i++) {
      const a = s * n + i;
      const b = s * n + ((i + 1) % n);
      faces.push([a, b, b + n, a + n]);
    }
  }
  if (capStart) faces.push(Array.from({ length: n }, (_, i) => i));
  if (capEnd) faces.push(Array.from({ length: n }, (_, i) => (sections.length - 1) * n + i));
  return facetSolid(verts, faces, { colors });
}

// A polygon lying on a plane, extruded `proud` out along the plane's normal and `sink` in.
function plateOn(points, normal, { proud = 0.06, sink = 0.05, colors = null } = {}) {
  const n = normal.clone().normalize();
  const low = points.map((p) => V(...p).addScaledVector(n, -sink).toArray());
  const high = points.map((p) => V(...p).addScaledVector(n, proud).toArray());
  const m = points.length;
  const verts = [...low, ...high];
  const faces = [];
  for (let i = 0; i < m; i++) faces.push([i, (i + 1) % m, (i + 1) % m + m, i + m]);
  faces.push(Array.from({ length: m }, (_, i) => i));
  faces.push(Array.from({ length: m }, (_, i) => i + m));
  return facetSolid(verts, faces, { colors });
}

const scaleUV = (g, su, sv) => {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
};

// A model mesh: merged parts under one fresh material.
function partsMesh(parts, params) {
  return mesh(mergeParts(parts), standard({ vertexColors: true, ...params }));
}

// A tiling canvas whose every mark is drawn nine times, so it has no seam.
function wrappedCanvas(size, draw, { repeat = 1, data = false } = {}) {
  const tex = canvasTexture(size, size, (ctx, w, h) => {
    const wrap = (fn) => {
      for (const dx of [-w, 0, w]) {
        for (const dy of [-h, 0, h]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); }
      }
    };
    draw(ctx, w, h, wrap);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  if (data) tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// ===========================================================================================
// A better Earth map than the world props use. Earth.js's outlines are a few dozen points for
// the whole planet, which is right for a globe on a library floor and wrong for one a student
// stands six feet from, where Africa's bulge and India have to be the shapes in the atlas.
// ===========================================================================================

const COAST = [
  // North America, Central America and Baja
  [[-168, 65.5], [-164, 67], [-166, 68.5], [-157, 71], [-141, 70], [-128, 70], [-115, 68], [-108, 68], [-95, 68], [-94, 72], [-85, 69.5], [-81, 68], [-85, 66], [-94, 61], [-93, 58], [-85, 55.5], [-82, 53], [-79, 51], [-79, 55], [-77, 59], [-78, 62], [-70, 61], [-65, 60], [-60, 55], [-56, 52], [-60, 50], [-66, 50], [-65, 48], [-61, 46], [-66, 44], [-70, 43.5], [-70, 41.5], [-74, 40], [-76, 37], [-75.5, 35], [-81, 31.5], [-80, 27], [-80.5, 25], [-82, 27], [-83, 29.5], [-89, 30], [-94, 29.5], [-97, 27.5], [-97.5, 22], [-95, 18.5], [-91, 18.5], [-90.5, 21], [-87, 21.5], [-88, 16], [-84, 15.5], [-83.5, 11], [-81, 9], [-78, 9], [-77.5, 7.5], [-80, 7.5], [-83, 8], [-86, 11], [-91, 14], [-95, 16], [-104, 19], [-106, 23], [-110, 27], [-113, 31], [-114.5, 30], [-110, 23], [-112, 25], [-115, 29], [-118, 34], [-121, 35], [-124, 40], [-124, 46], [-123, 49], [-130, 54], [-133, 57], [-140, 60], [-147, 61], [-152, 59], [-158, 57], [-164, 55], [-158, 58.5], [-162, 60], [-165, 62]],
  [[-85, 22], [-80, 23], [-75, 20.5], [-78, 20], [-82, 22]],
  [[-74, 19.8], [-69, 19.5], [-69, 18.2], [-74, 18.2]],
  [[-80, 73], [-72, 71], [-62, 66], [-66, 62], [-75, 65], [-80, 70]],
  [[-117, 71], [-105, 73], [-102, 69], [-115, 69]],
  [[-90, 76], [-75, 77], [-62, 82], [-75, 83], [-92, 81]],
  // Greenland and Iceland
  [[-73, 78], [-60, 82], [-32, 83.5], [-18, 80], [-22, 72], [-32, 68], [-42, 62], [-44, 60], [-50, 62], [-54, 68], [-58, 75]],
  [[-24, 65.5], [-18, 66.5], [-14, 65], [-18, 63.5], [-22, 64]],
  // South America
  [[-78, 8], [-72, 12], [-66, 10.5], [-60, 8], [-52, 5], [-50, 0], [-44, -2.5], [-37, -5], [-35, -8], [-39, -15], [-41, -22], [-48, -26], [-53, -34], [-58, -35], [-57, -38], [-65, -41], [-66, -45], [-69, -51], [-68, -55], [-72, -53], [-75, -48], [-73, -40], [-71, -30], [-70, -18], [-76, -14], [-81, -5], [-80, 0], [-77, 4]],
  // Africa and Madagascar
  [[-6, 35.7], [3, 37], [10, 37], [11, 33.5], [20, 31], [25, 32], [32, 31], [34, 28], [37, 21], [39, 16], [43, 11.5], [51, 12], [47, 4], [40, -3], [39, -8], [40.5, -15], [35, -20], [35, -24], [32.5, -28], [28, -33], [20, -35], [18, -33], [15, -26], [12, -17], [13.5, -8], [9, -1], [9.5, 4], [4, 6], [-4, 5], [-8, 4.5], [-13, 8.5], [-17, 14.5], [-16.5, 20], [-13, 27], [-10, 30], [-9, 33]],
  [[43, -12], [50, -15], [50, -25], [45, -25], [43, -20]],
  // Eurasia
  [[-9, 37], [-9, 43], [-2, 43.5], [-1, 46], [-4.5, 48.5], [2, 51], [5, 53], [8.5, 54], [8, 57], [10.5, 57.5], [10.5, 54.5], [14, 54], [19, 54.5], [21, 57], [24, 59], [30, 60], [23, 60], [21, 62], [25, 65.5], [22, 65.5], [17, 61], [18, 59], [15, 56], [12.5, 56], [11, 59], [6, 58], [5, 62], [12, 65.5], [17, 69], [25, 71], [31, 70], [41, 67], [35, 64.5], [40, 65], [44, 68], [54, 68.5], [60, 69], [68, 68.5], [72, 73], [80, 73], [88, 75.5], [104, 77.5], [113, 74], [130, 71.5], [140, 73], [160, 70], [170, 70], [180, 68.5], [180, 65], [177, 62.5], [170, 60], [163, 60], [162, 56], [157, 51], [156, 57], [160, 61], [154, 59], [143, 59], [135, 54.5], [141, 53], [140, 48], [133, 43], [128, 39], [129, 35.5], [126, 34.5], [126, 37.5], [125, 40], [121, 39], [118, 38], [122, 37], [120, 34], [122, 30], [120, 26], [117, 23.5], [110, 21], [108, 21.5], [106, 19], [109, 14], [109, 11.5], [105, 9], [103, 11], [100, 13.5], [99.5, 9], [103, 5], [104, 1.5], [101, 3], [98.5, 8], [98, 14], [95, 16], [94, 18.5], [91.5, 22], [88, 21.5], [86, 20], [80, 15.5], [80, 11], [77.5, 8], [75, 12], [73, 18], [72.5, 21], [69, 22.5], [67, 25], [61, 25], [57, 26], [56, 27], [51, 28], [48, 30], [50, 26.5], [52, 24], [56, 25], [59.5, 22.5], [55, 17], [45, 13], [43, 13], [40, 20], [35, 28], [34.5, 31.5], [36, 36], [30, 36.5], [27, 37], [26, 40], [29, 41], [35, 42], [41, 41.5], [38, 45], [33, 45.5], [30, 46], [28, 42], [24, 40.5], [23, 37], [21, 38], [19.5, 42], [14, 45], [12.5, 44], [18, 40], [16, 38], [12, 42], [9, 44], [3, 43], [0, 39], [-2, 36.7], [-5.5, 36]],
  // Islands of Europe and Asia
  [[-5.5, 50], [1, 51], [1.5, 53], [-1.5, 55], [-2, 57.5], [-5, 58.5], [-6, 56], [-3, 54], [-5, 52]],
  [[-10, 52], [-6, 52], [-6, 55], [-10, 54.5]],
  [[130, 33], [135, 34], [140, 35], [141.5, 39], [141, 41], [139.5, 39], [136, 36.5], [131, 34.5]],
  [[140, 42], [145, 43.5], [142, 45.5]],
  [[142, 46], [143.5, 50], [143, 54], [142, 50]],
  [[120, 25], [122, 25], [121, 22]],
  [[120, 18], [122, 18], [124, 13], [126, 7], [122, 7], [120, 13]],
  [[95, 5.5], [104, -2], [106, -6], [101, -3]],
  [[109, 1], [113, 3], [117, 7], [119, 1], [116, -4], [110, -2]],
  [[105, -6.5], [114, -7.5], [114, -8.5], [106, -7.5]],
  [[119, -5], [121, 1], [125, 1.5], [122, -5]],
  [[131, -1], [141, -2.5], [147, -6], [150, -10], [143, -9], [138, -8], [133, -4]],
  [[80, 9.5], [82, 7], [80.5, 6]],
  // Australia, Tasmania and New Zealand
  [[114, -22], [122, -18], [126, -14], [130, -12], [135, -12], [136, -15], [140, -17.5], [142, -11], [145, -15], [149, -21], [153, -26], [153, -31], [150, -37], [146, -39], [141, -38], [136, -35.5], [135, -34], [131, -31.5], [124, -33], [116, -35], [115, -31]],
  [[145, -41], [148, -41], [147, -43.5]],
  [[173, -35], [178, -38], [175, -41.5], [174, -39]],
  [[172, -41], [174, -42], [170, -46.5], [167, -45.5]],
];

// [lon, lat, half-width, half-height, colour, alpha]: soft climate fields painted through the
// land clip. Blobs rather than latitude bands, because the real Sahara is not the real Gobi.
const BIOMES = [
  [10, 22, 42, 11, '#d4b06a', 1], [45, 24, 14, 10, '#d9b56e', 1], [60, 38, 22, 8, '#c2a971', 0.8],
  [100, 42, 22, 7, '#bfa770', 0.8], [133, -25, 16, 9, '#c79a5c', 1], [20, -25, 9, 8, '#bfa365', 0.75],
  [-110, 35, 11, 7, '#bb9e68', 0.75], [-69, -30, 5, 14, '#a8946c', 0.65], [-69, -45, 5, 8, '#b1a077', 0.7],
  [-62, -5, 16, 11, '#2c7038', 0.7], [20, -2, 14, 8, '#2d7238', 0.7], [110, 3, 22, 10, '#2f7039', 0.7],
  [-95, 55, 34, 9, '#335f3c', 0.9], [90, 60, 55, 9, '#355f42', 0.9], [20, 62, 22, 7, '#3b6a44', 0.8],
  [-90, 70, 34, 6, '#8b957f', 0.75], [100, 72, 60, 4, '#98a08c', 0.75], [-85, 38, 14, 8, '#4e8644', 0.8],
  [10, 48, 16, 6, '#5a8d49', 0.8], [80, 25, 10, 7, '#5f8a42', 0.8], [115, 30, 11, 7, '#4d8440', 0.8],
];
const RANGES = [
  [[-140, 62], [-125, 52], [-115, 42], [-108, 34], [-100, 22]],
  [[-76, 6], [-78, -5], [-72, -18], [-70, -32], [-72, -48]],
  [[70, 36], [80, 33], [90, 29], [98, 27]],
  [[5, 46], [12, 47], [18, 46]],
];

// Rounds a hand-plotted ring and then roughens it. Corner-cutting takes the straight ruled edges
// off, and a smooth field of the position wobbles the result, so a coast reads as a coast. A field
// and not a fresh random number, or two neighbouring points would disagree and the line would fray.
function naturalCoast(ring, wobble) {
  let pts = ring;
  for (let pass = 0; pass < 2; pass++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    pts = out;
  }
  return pts.map(([x, y]) => [
    x + (smoothNoise3(x * 0.33, y * 0.33, 1.7) - 0.5) * wobble + (smoothNoise3(x * 0.9, y * 0.9, 4.1) - 0.5) * wobble * 0.5,
    y + (smoothNoise3(x * 0.33, y * 0.33, 8.3) - 0.5) * wobble + (smoothNoise3(x * 0.9, y * 0.9, 6.2) - 0.5) * wobble * 0.5,
  ]);
}

function paintEarthMap(ctx, w, h, { seed = 31415, detail = 1 } = {}) {
  const px = (lon) => ((lon + 180) / 360) * w;
  const py = (lat) => ((90 - lat) / 180) * h;
  const rings = COAST.map((ring) => naturalCoast(ring, ring.length > 8 ? 2.6 : 1.2));
  const trace = () => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
      ctx.closePath();
    }
  };
  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, '#16436f');
  ocean.addColorStop(0.5, '#1a5f9e');
  ocean.addColorStop(1, '#163f68');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // Continental shelf: a wide pale stroke under the land, which is what gives a coastline an edge.
  ctx.lineJoin = 'round';
  trace();
  ctx.strokeStyle = 'rgba(70,150,180,0.3)';
  ctx.lineWidth = w * 0.005;
  ctx.stroke();

  trace();
  ctx.fillStyle = '#4c8440';
  ctx.fill();

  ctx.save();
  trace();
  ctx.clip();
  const rng = seededRandom(seed);
  for (const [lon, lat, hw, hh, color, alpha] of BIOMES) {
    const blobs = detail > 0.6 ? 14 : 5;
    // A radial gradient to nothing, so a climate has no edge. Solid ellipses, however faint, stack
    // up into visible rings.
    for (let i = 0; i < blobs; i++) {
      const r = 0.7 + rng() * 0.6;
      ctx.save();
      ctx.translate(px(lon + (rng() - 0.5) * hw * 1.4), py(lat + (rng() - 0.5) * hh * 1.4));
      ctx.rotate((rng() - 0.5) * 0.6);
      ctx.scale((hw / 360) * w * r, (hh / 180) * h * r);
      const soft = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      soft.addColorStop(0, color);
      soft.addColorStop(0.55, color);
      soft.addColorStop(1, `${color}00`);
      ctx.globalAlpha = alpha * 0.42;
      ctx.fillStyle = soft;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  // Mountains as a scatter of short dark strokes along each range, rather than one painted road.
  for (const range of RANGES) {
    for (let i = 0; i < range.length - 1; i++) {
      for (let k = 0; k < 26; k++) {
        const t = rng();
        const lon = range[i][0] + (range[i + 1][0] - range[i][0]) * t + (rng() - 0.5) * 3;
        const lat = range[i][1] + (range[i + 1][1] - range[i][1]) * t + (rng() - 0.5) * 3;
        ctx.fillStyle = rng() > 0.3 ? 'rgba(104,88,66,0.24)' : 'rgba(226,220,210,0.24)';
        ctx.beginPath();
        ctx.ellipse(px(lon), py(lat), w * 0.002, h * 0.003, rng() * 3, 0, TAU);
        ctx.fill();
      }
    }
  }
  // Greenland's ice sheet and the high Arctic islands.
  ctx.fillStyle = '#eef4f7';
  ctx.beginPath();
  ctx.ellipse(px(-40), py(74), (20 / 360) * w, (13 / 180) * h, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(0, 0, w, py(78));
  ctx.restore();

  // Sea ice and Antarctica, both with torn edges so neither is a ruled line across the map.
  const edge = seededRandom(seed + 9);
  ctx.fillStyle = '#e9f1f6';
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let lon = -180; lon <= 180; lon += 4) {
    const peninsula = Math.exp(-(((lon + 62) / 9) ** 2)) * 8;
    ctx.lineTo(px(lon), py(-70 + peninsula + (edge() - 0.5) * 3 + Math.sin(lon * 0.07) * 2));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let lon = -180; lon <= 180; lon += 5) ctx.lineTo(px(lon), py(81 + Math.sin(lon * 0.05) * 1.5 + Math.sin(lon * 0.17 + 1) * 0.8));
  ctx.lineTo(w, 0);
  ctx.closePath();
  ctx.fill();

  // The Caspian and the Great Lakes, painted back in as water.
  ctx.fillStyle = '#1b5a8f';
  ctx.beginPath();
  ctx.ellipse(px(51), py(42), w * 0.0035, h * 0.022, 0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px(-87), py(44.5), w * 0.0025, h * 0.012, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(px(-82), py(46.5), w * 0.0065, h * 0.0045, -0.2, 0, TAU);
  ctx.fill();
}

// ===========================================================================================
// EARTH'S LAYERS
// ===========================================================================================

// Real radii over the Earth's mean 6,371 km, except the crust. The crust's true 45 miles is 0.7
// of an inch on this globe, so it is drawn at about twice its thickest and the face says so.
const LAYERS = { inner: 1221 / 6371, outer: 3480 / 6371, crust: 0.98 };

function paintSection(ctx, w) {
  const c = w / 2;
  const R = w / 2 - 1;
  const rng = seededRandom(77);
  ctx.fillStyle = '#2c2420';
  ctx.fillRect(0, 0, w, w);
  const disc = (radius, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(c, c, radius, 0, TAU); ctx.fill(); };

  // Crust, in slate over a dark line, then the mantle deepening from orange at the core boundary
  // to red-brown under the crust.
  disc(R, '#5b534d');
  const mantle = ctx.createRadialGradient(c, c, R * LAYERS.outer, c, c, R * LAYERS.crust);
  mantle.addColorStop(0, '#e2601c');
  mantle.addColorStop(0.4, '#c5431d');
  mantle.addColorStop(0.8, '#94301e');
  mantle.addColorStop(1, '#6e2a20');
  disc(R * LAYERS.crust, mantle);

  // Slow convection in the mantle: long curved streaks that circle cells, kept faint.
  ctx.lineCap = 'round';
  for (let i = 0; i < 120; i++) {
    const a = rng() * TAU;
    const r = R * (LAYERS.outer + 0.03 + rng() * (LAYERS.crust - LAYERS.outer - 0.06));
    const span = 0.08 + rng() * 0.22;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(255,170,90,0.13)' : 'rgba(70,16,10,0.2)';
    ctx.lineWidth = 1 + rng() * 2.4;
    ctx.beginPath();
    ctx.arc(c, c, r, a, a + span);
    ctx.stroke();
  }

  // Outer core: liquid metal, so bright and streaming.
  const liquid = ctx.createRadialGradient(c, c, R * LAYERS.inner, c, c, R * LAYERS.outer);
  liquid.addColorStop(0, '#ffc84a');
  liquid.addColorStop(0.65, '#fba32f');
  liquid.addColorStop(1, '#f28422');
  disc(R * LAYERS.outer, liquid);
  for (let i = 0; i < 60; i++) {
    const a = rng() * TAU;
    const r = R * (LAYERS.inner + 0.02 + rng() * (LAYERS.outer - LAYERS.inner - 0.03));
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(255,236,170,0.3)' : 'rgba(205,92,20,0.24)';
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath();
    ctx.arc(c, c, r, a, a + 0.15 + rng() * 0.5);
    ctx.stroke();
  }

  const inner = ctx.createRadialGradient(c, c, 0, c, c, R * LAYERS.inner);
  inner.addColorStop(0, '#fffbe2');
  inner.addColorStop(1, '#ffe690');
  disc(R * LAYERS.inner, inner);

  // Dark boundary lines, so the four layers read as four from across a room.
  ctx.strokeStyle = 'rgba(40,15,8,0.55)';
  ctx.lineWidth = 2.5;
  for (const f of [LAYERS.inner, LAYERS.outer, LAYERS.crust]) {
    ctx.beginPath();
    ctx.arc(c, c, R * f, 0, TAU);
    ctx.stroke();
  }

  // Labels. The sheet is the two cut faces unfolded, so the right half is the right-hand face and
  // the left half the left-hand one, and both read the right way round from inside the wedge.
  //
  // Every line is turned against the globe's tilt: 23.4 degrees about the view axis comes out as
  // 17.6 in the plane of a face opened to 47 degrees, and at that angle the words sit level.
  const LEVEL = -17.6 * DEG;
  const scale = R / 511;
  const X = (d) => c + d * scale;
  const Y = (d) => c + d * scale;
  const label = (text, x, y, maxW, size, color, weight = 'bold') => {
    ctx.save();
    ctx.translate(X(x), Y(y));
    ctx.rotate(LEVEL);
    ctx.fillStyle = color;
    let s = size;
    ctx.font = `${weight} ${s}px "Helvetica Neue", Arial, sans-serif`;
    while (ctx.measureText(text).width > maxW * scale && s > 12) {
      s -= 1;
      ctx.font = `${weight} ${s}px "Helvetica Neue", Arial, sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  const dark = '#2a0e02';
  const pale = '#fff0de';
  const tick = (x1, y1, x2, y2, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(X(x1), Y(y1));
    ctx.lineTo(X(x2), Y(y2));
    ctx.stroke();
  };

  // Right face: the names.
  label('OUTER CORE', 118, -168, 170, 32, dark);
  label('INNER CORE', 192, 18, 150, 28, dark);
  tick(122, 30, 92, 26, dark);
  label('MANTLE', 396, 8, 190, 44, pale);
  label('CRUST', 262, -372, 120, 32, pale);
  tick(305, -388, 352, -366, pale);

  // Left face: what each one is made of and how thick it is. Miles, as on the card.
  label('LIQUID METAL', -112, -178, 170, 26, dark);
  label('1,400 miles thick', -102, -146, 170, 22, dark, 'normal');
  label('SOLID METAL', -190, 30, 150, 24, dark);
  label('760 miles to centre', -182, 58, 150, 18, dark, 'normal');
  tick(-120, 8, -92, 2, dark);
  label('HOT SOLID ROCK', -396, -40, 190, 28, pale);
  label('1,800 miles thick', -386, -4, 190, 22, pale, 'normal');
  label('CRUST: 3 to 45 miles', -262, -372, 190, 21, pale);
  label('Drawn thicker here', -256, -344, 190, 19, pale, 'normal');
  label('so you can see it.', -250, -320, 190, 19, pale, 'normal');
  tick(-340, -398, -366, -352, pale);
}

// The core glows and the rock does not, so the emissive map is the same sheet with everything
// cooler than the outer core blacked out.
function paintSectionGlow(ctx, w) {
  const c = w / 2;
  const R = w / 2 - 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, w);
  const heat = ctx.createRadialGradient(c, c, 0, c, c, R * LAYERS.outer);
  heat.addColorStop(0, '#fff2b8');
  heat.addColorStop(LAYERS.inner / LAYERS.outer, '#ffd46a');
  heat.addColorStop(1, '#d9681a');
  ctx.fillStyle = heat;
  ctx.beginPath();
  ctx.arc(c, c, R * LAYERS.outer, 0, TAU);
  ctx.fill();
  const under = ctx.createRadialGradient(c, c, R * LAYERS.outer, c, c, R * LAYERS.crust);
  under.addColorStop(0, '#5a2008');
  under.addColorStop(1, '#180806');
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = under;
  ctx.beginPath();
  ctx.arc(c, c, R * LAYERS.crust, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function buildEarthLayers() {
  const R = 5;
  const CY = 5.92;
  const ALPHA = 47 * DEG;
  const CENTRE_LON = -170; // the removed wedge is open Pacific, so it takes the fewest continents
  const toWorld = new THREE.Matrix4().compose(
    V(0, CY, 0),
    new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -23.4 * DEG),
    V(1, 1, 1),
  );

  // The planet's surface, everywhere the wedge is not. Normals are the sphere's own.
  const rows = 84;
  const cols = 104;
  const pos = [];
  const nor = [];
  const uvs = [];
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    const lat = -Math.PI / 2 + (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const az = ALPHA + (j / cols) * (TAU - 2 * ALPHA);
      const n = [Math.sin(az) * Math.cos(lat), Math.sin(lat), Math.cos(az) * Math.cos(lat)];
      pos.push(n[0] * R, n[1] * R, n[2] * R);
      nor.push(...n);
      const lon = CENTRE_LON + az / DEG;
      const wrapped = ((lon + 180) % 360 + 360) % 360;
      uvs.push(wrapped / 360, (lat / Math.PI) + 0.5);
    }
  }
  const ring = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const surface = new THREE.BufferGeometry();
  surface.setIndex(idx);
  surface.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  surface.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  surface.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  surface.applyMatrix4(toWorld);

  const earthMap = canvasTexture(2048, 1024, (ctx, w, h) => paintEarthMap(ctx, w, h));
  const globe = mesh(surface, standard({ map: earthMap, roughness: 0.62, metalness: 0 }));

  // The two cut faces are fans, opaque and flat, with a rim that shares every vertex of the
  // surface's own edge so there is no crack to look through. Radial coordinate on the sheet: u
  // runs outward to the right on the right-hand face and to the left on the left-hand one.
  const fpos = [];
  const fnor = [];
  const fuv = [];
  for (const side of [1, -1]) {
    const az = side * ALPHA;
    const e = V(Math.sin(az), 0, Math.cos(az));
    const n = V(-side * Math.cos(az), 0, side * Math.sin(az));
    for (let i = 0; i < rows; i++) {
      const la = -Math.PI / 2 + (i / rows) * Math.PI;
      const lb = -Math.PI / 2 + ((i + 1) / rows) * Math.PI;
      const vert = (lat) => {
        const rho = Math.cos(lat);
        const y = Math.sin(lat);
        return {
          p: e.clone().multiplyScalar(rho * R).add(V(0, y * R, 0)),
          uv: [0.5 + side * rho * 0.5 * (511 / 512), 0.5 + y * 0.5 * (511 / 512)],
        };
      };
      const a = vert(la);
      const b = vert(lb);
      // Which way the rim runs against the normal decides the winding: measured, then stored.
      const cross = a.p.clone().cross(b.p);
      const order = cross.dot(n) > 0 ? [a, b] : [b, a];
      for (const v of [{ p: V(), uv: [0.5, 0.5] }, order[0], order[1]]) {
        fpos.push(v.p.x, v.p.y, v.p.z);
        fnor.push(n.x, n.y, n.z);
        fuv.push(v.uv[0], v.uv[1]);
      }
    }
  }
  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  faces.setAttribute('normal', new THREE.Float32BufferAttribute(fnor, 3));
  faces.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  faces.applyMatrix4(toWorld);
  const sectionMap = canvasTexture(1024, 1024, (ctx, w) => paintSection(ctx, w));
  const glowMap = canvasTexture(512, 512, (ctx, w) => paintSectionGlow(ctx, w));
  const section = mesh(faces, standard({
    map: sectionMap, roughness: 0.88, metalness: 0,
    emissive: 0xffffff, emissiveMap: glowMap, emissiveIntensity: 0.42,
  }));

  // The inner core is a whole ball, not two half-discs: it is the one layer that really is a solid
  // object standing free, and the sphere is what says so.
  const coreBall = ball(R * LAYERS.inner, 40, 28);
  coreBall.applyMatrix4(toWorld);
  const core = mesh(coreBall, standard({
    color: 0xffe08a, roughness: 0.42, metalness: 0.15, emissive: 0xff9a2a, emissiveIntensity: 0.5,
  }));
  // A ball's shadow on the crease behind it pulls it into a teardrop.
  core.castShadow = false;

  // A low turned stand. The bowl is the globe's own radius, so the Earth is seated in it with no
  // gap, and through the wedge it reads as the inside of a cup.
  const cupR = 3.1;
  const cupY = CY - Math.sqrt(R * R - cupR * cupR);
  const bowl = [];
  for (let i = 0; i <= 10; i++) {
    const r = cupR * (1 - i / 10);
    bowl.push([r, CY - Math.sqrt((R - 0.015) ** 2 - r * r)]);
  }
  const standParts = [];
  standParts.push({
    geometry: lathe([
      [0, 0], [3.9, 0], [4.0, 0.08], [4.0, 0.3], [3.86, 0.36], [3.82, 0.46], [3.5, 0.52], [3.42, 0.62], [2.5, 0.68],
      [1.78, 0.8], [1.6, 0.92],
    ], { segments: 72, crease: 28 }),
    color: 0x6a4730,
  });
  standParts.push({
    geometry: lathe([
      [1.72, 0.7], [1.88, 0.78], [1.88, 0.92], [2.3, 1.0], [2.9, 1.14], [cupR + 0.06, cupY - 0.1], [cupR + 0.06, cupY + 0.02],
      ...bowl.map(([r, y]) => [r, y]),
    ], { segments: 72, crease: 26 }),
    color: 0xd2a850,
  });
  standParts.push({ geometry: lathe([[3.92, 0.17], [4.03, 0.17], [4.03, 0.24], [3.92, 0.24]], { segments: 72 }), color: 0xd2a850 });
  const stand = partsMesh(standParts, { roughness: 0.5, metalness: 0.18 });

  const root = new THREE.Group();
  root.add(globe, section, core, stand);
  return root;
}

// ===========================================================================================
// SOLAR SYSTEM ORRERY
// ===========================================================================================

// A gear with its web cut away: toothed rim, spokes and a boss, so a student looks through the
// wheel at the arbors behind it. gearWheel's hub option leaves the face solid, and a solid disc
// reads as a coin with a toothed edge. The rim is one closed ring in the XY plane, thickness on Z.
function spokedGear(radius, teeth, thick, { spokes = 6, rim = 0.2, hub = 0.22 } = {}) {
  const outer = gearOutline(radius, teeth);
  const n = outer.length;
  const inner = radius * (1 - rim) - radius * (4 / teeth);
  const pos = [];
  const idx = [];
  const push = (x, y, z) => { pos.push(x, y, z); return pos.length / 3 - 1; };
  const faces = [thick / 2, -thick / 2];
  // Each surface keeps its own copy of the ring, so the face/side edge stays a hard edge.
  for (const z of faces) {
    const a0 = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const [x, y] = outer[i];
      const a = Math.atan2(y, x);
      push(x, y, z);
      push(Math.cos(a) * inner, Math.sin(a) * inner, z);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const o0 = a0 + i * 2; const i0 = o0 + 1; const o1 = a0 + j * 2; const i1 = o1 + 1;
      if (z > 0) idx.push(o0, o1, i1, o0, i1, i0);
      else idx.push(o0, i1, o1, o0, i0, i1);
    }
  }
  const b0 = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const [x, y] = outer[i];
    push(x, y, thick / 2);
    push(x, y, -thick / 2);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = b0 + i * 2; const l0 = t0 + 1; const t1 = b0 + j * 2; const l1 = t1 + 1;
    idx.push(t0, l0, l1, t0, l1, t1);
  }
  const c0 = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const a = Math.atan2(outer[i][1], outer[i][0]);
    push(Math.cos(a) * inner, Math.sin(a) * inner, thick / 2);
    push(Math.cos(a) * inner, Math.sin(a) * inner, -thick / 2);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const t0 = c0 + i * 2; const l0 = t0 + 1; const t1 = c0 + j * 2; const l1 = t1 + 1;
    idx.push(t0, t1, l1, t0, l1, l0);
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setIndex(idx);
  ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ringGeo.computeVertexNormals();
  const out = [ringGeo];
  const hubR = radius * hub;
  const boss = new THREE.CylinderGeometry(hubR, hubR, thick * 1.5, 18).rotateX(Math.PI / 2);
  out.push(boss);
  for (let s = 0; s < spokes; s++) {
    const a = (s / spokes) * TAU + 0.26;
    const len = inner - hubR * 0.6 + radius * 0.03;
    const bar = box(len, radius * 0.075 + 0.02, thick * 0.7);
    bar.translate(hubR * 0.6 + len / 2, 0, 0);
    bar.rotateZ(a);
    out.push(bar);
  }
  return out;
}

// Lays gear parts flat at a position, turned by `spin` about the vertical.
function layGear(list, color, gear, x, y, z, spin = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationY(spin))
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  for (const g of gear) list.push({ geometry: xformed(g, m), color });
}

const ATLAS_W = 2048;
const ATLAS_H = 1024;
const CELL_W = 512;
const CELL_H = 256;
const PLANET_CELLS = { mercury: 0, venus: 1, earth: 2, mars: 3, jupiter: 4, saturn: 5, uranus: 6, neptune: 7 };

function paintPlanetAtlas(ctx, w, h) {
  const rng = seededRandom(1619);
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, w, h);

  // Horizontal cloud bands: [fraction, colour] stops down one cell, then long wavy streaks over it.
  const banded = (x, y, stops, streaks, streakAlpha) => {
    const g = ctx.createLinearGradient(0, y, 0, y + CELL_H);
    for (const [t, c] of stops) g.addColorStop(t, c);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, CELL_W, CELL_H);
    for (let i = 0; i < streaks; i++) {
      const sy = y + rng() * CELL_H;
      const sx = x + rng() * CELL_W;
      const len = 40 + rng() * 200;
      ctx.strokeStyle = rng() > 0.5 ? `rgba(255,250,235,${streakAlpha})` : `rgba(60,35,20,${streakAlpha})`;
      ctx.lineWidth = 1 + rng() * 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx + len * 0.3, sy + (rng() - 0.5) * 6, sx + len * 0.6, sy + (rng() - 0.5) * 6, Math.min(sx + len, x + CELL_W), sy + (rng() - 0.5) * 4);
      ctx.stroke();
    }
  };
  const cell = (index) => [(index % 4) * CELL_W, Math.floor(index / 4) * CELL_H];

  // Mercury: grey and cratered.
  {
    const [x, y] = cell(PLANET_CELLS.mercury);
    ctx.fillStyle = '#8b8378';
    ctx.fillRect(x, y, CELL_W, CELL_H);
    for (let i = 0; i < 150; i++) {
      const cx = x + rng() * CELL_W;
      const cy = y + rng() * CELL_H;
      const r = 2 + rng() * rng() * 15;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(60,54,48,0.4)' : 'rgba(186,178,164,0.4)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(214,206,190,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // Venus: unbroken pale yellow cloud.
  { const [x, y] = cell(PLANET_CELLS.venus); banded(x, y, [[0, '#d9bf8c'], [0.3, '#ecd6a4'], [0.5, '#e2c68f'], [0.7, '#efdcae'], [1, '#d6bb88']], 90, 0.14); }
  // Earth: the same map the big globe wears.
  {
    const [x, y] = cell(PLANET_CELLS.earth);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, CELL_W, CELL_H);
    ctx.clip();
    ctx.translate(x, y);
    paintEarthMap(ctx, CELL_W, CELL_H, { seed: 271, detail: 0.5 });
    ctx.restore();
  }
  // Mars: rust, dark basalt plains and white polar caps.
  {
    const [x, y] = cell(PLANET_CELLS.mars);
    ctx.fillStyle = '#b5552c';
    ctx.fillRect(x, y, CELL_W, CELL_H);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rng() > 0.55 ? 'rgba(84,40,26,0.3)' : 'rgba(218,136,84,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + rng() * CELL_W, y + 40 + rng() * (CELL_H - 80), 12 + rng() * 50, 5 + rng() * 18, rng(), 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#f2ece4';
    ctx.fillRect(x, y, CELL_W, 18);
    ctx.fillRect(x, y + CELL_H - 12, CELL_W, 12);
  }
  // Jupiter: the strongest bands in the solar system, and the Great Red Spot.
  {
    const [x, y] = cell(PLANET_CELLS.jupiter);
    banded(x, y, [
      [0, '#8c7a64'], [0.1, '#b19c7e'], [0.18, '#d9c7a3'], [0.27, '#93623e'], [0.34, '#a36e45'], [0.4, '#ece0c4'],
      [0.52, '#f2e6cc'], [0.58, '#a4623a'], [0.66, '#8d5733'], [0.72, '#dfcda9'], [0.83, '#b3916b'], [0.91, '#9a8066'], [1, '#7f6f5c'],
    ], 170, 0.2);
    ctx.fillStyle = '#b4482a';
    ctx.beginPath();
    ctx.ellipse(x + 340, y + CELL_H * 0.66, 34, 15, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#e7d3ae';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  // Saturn: the same idea much more gently, in butterscotch.
  { const [x, y] = cell(PLANET_CELLS.saturn); banded(x, y, [[0, '#a48c62'], [0.2, '#cdb684'], [0.35, '#e3cf9f'], [0.48, '#efdeb2'], [0.6, '#d9c290'], [0.78, '#c4ab79'], [1, '#9d865d']], 80, 0.1); }
  // Uranus: nearly featureless pale cyan.
  { const [x, y] = cell(PLANET_CELLS.uranus); banded(x, y, [[0, '#a6dbe0'], [0.5, '#bfeaec'], [1, '#9fd6dc']], 16, 0.05); }
  // Neptune: deep blue with white wisps and the dark spot.
  {
    const [x, y] = cell(PLANET_CELLS.neptune);
    banded(x, y, [[0, '#2546a4'], [0.35, '#2e5cc6'], [0.55, '#3a6fd8'], [0.8, '#2a50b2'], [1, '#1f3c90']], 26, 0.07);
    ctx.fillStyle = 'rgba(20,34,90,0.75)';
    ctx.beginPath();
    ctx.ellipse(x + 180, y + CELL_H * 0.6, 34, 17, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(245,250,255,0.75)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      const sx = x + rng() * CELL_W;
      const sy = y + 50 + rng() * 150;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(Math.min(sx + 18 + rng() * 40, x + CELL_W), sy - 2 + rng() * 4);
      ctx.stroke();
    }
  }

  // Calendar dial, in the cell below the planets: engraved brass with the months round it.
  {
    const size = 512;
    const x0 = 0;
    const y0 = 512;
    ctx.fillStyle = '#d4ab54';
    ctx.fillRect(x0, y0, size, size);
    const c = size / 2;
    const cx = x0 + c;
    const cy = y0 + c;
    ctx.strokeStyle = '#47320f';
    for (const [r, lw] of [[250, 3], [214, 2], [196, 2], [120, 2]]) {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    for (let i = 0; i < 365; i += 5) {
      const a = (i / 365) * TAU;
      const long = i % 30 === 0;
      ctx.lineWidth = long ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 196, cy + Math.sin(a) * 196);
      ctx.lineTo(cx + Math.cos(a) * (long ? 214 : 206), cy + Math.sin(a) * (long ? 214 : 206));
      ctx.stroke();
    }
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    ctx.fillStyle = '#3a2708';
    ctx.font = 'bold 24px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    months.forEach((m, i) => {
      // Counter-clockwise seen from above, the way the planets really go round and the way a positive
      // rotate block turns this model; the feet of the letters toward whoever is reading them.
      const a = -((i + 0.5) / 12) * TAU;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * 232, cy + Math.sin(a) * 232);
      ctx.rotate(a - Math.PI / 2);
      ctx.fillText(m, 0, 0);
      ctx.restore();
    });
  }

  // Saturn's rings, as one radial strip: C ring, B ring, the Cassini Division, A ring.
  {
    const x0 = 512;
    const y0 = 512;
    const W = 1024;
    const H = 64;
    const g = ctx.createLinearGradient(x0, 0, x0 + W, 0);
    g.addColorStop(0, '#6b5f4c');
    g.addColorStop(0.2, '#8a7a5e');
    g.addColorStop(0.24, '#d6c498');
    g.addColorStop(0.55, '#e9d9ae');
    g.addColorStop(0.62, '#d1bd8d');
    g.addColorStop(0.632, '#2a2520');
    g.addColorStop(0.668, '#2a2520');
    g.addColorStop(0.68, '#c7b48a');
    g.addColorStop(0.97, '#b6a57f');
    g.addColorStop(1, '#8f8267');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, W, H);
    for (let i = 0; i < 130; i++) {
      const px = x0 + rng() * W;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,245,220,0.14)' : 'rgba(40,32,20,0.14)';
      ctx.fillRect(px, y0, 1 + rng() * 3, H);
    }
  }

  // The Moon, in the corner cell.
  {
    const x0 = 1536;
    const y0 = 512;
    ctx.fillStyle = '#a9a69f';
    ctx.fillRect(x0, y0, 256, 128);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = rng() > 0.4 ? 'rgba(64,62,60,0.5)' : 'rgba(214,212,206,0.5)';
      ctx.beginPath();
      ctx.arc(x0 + rng() * 256, y0 + rng() * 128, 3 + rng() * 15, 0, TAU);
      ctx.fill();
    }
  }
}

// Remaps a sphere's own 0..1 UVs into one rectangle of the atlas. The half-texel inset stops a mip
// level from reading the next planet.
function atlasUV(geometry, x, y, w, h) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = (x + 2 + uv.getX(i) * (w - 4)) / ATLAS_W;
    const v = 1 - (y + 2 + (1 - uv.getY(i)) * (h - 4)) / ATLAS_H;
    uv.setXY(i, u, v);
  }
  return geometry;
}

function buildOrrery() {
  const brass = [];
  const wood = [];
  const atlas = [];
  const BRASS = 0xcfa64e;
  const BRASS_DARK = 0xa17a30;
  const STEEL = 0x8f8e88;

  // The plinth, turned and moulded, with brass let into it.
  wood.push({
    geometry: lathe([
      [0, 0], [3.55, 0], [3.68, 0.05], [3.72, 0.16], [3.62, 0.24], [3.48, 0.28], [3.45, 0.38], [3.3, 0.46], [3.25, 0.56], [0, 0.56],
    ], { segments: 72, crease: 28 }),
    color: 0x5a3220,
  });
  brass.push({ geometry: lathe([[3.66, 0.235], [3.66, 0.27], [3.5, 0.3], [3.44, 0.3], [3.44, 0.235]], { segments: 72 }), color: BRASS });

  // The movement: two brass plates held apart by turned pillars, with the wheels between them in
  // plain view. Gears are the only part of an orrery that explains how it works.
  const PLATE_LOW = 0.62;
  const PLATE_HIGH = 1.88;
  brass.push({ geometry: lathe([[0, PLATE_LOW - 0.06], [3.1, PLATE_LOW - 0.06], [3.14, PLATE_LOW], [3.1, PLATE_LOW + 0.06], [0, PLATE_LOW + 0.06]], { segments: 72, crease: 28 }), color: BRASS_DARK });
  brass.push({ geometry: lathe([[0, PLATE_HIGH - 0.07], [3.0, PLATE_HIGH - 0.07], [3.06, PLATE_HIGH], [3.0, PLATE_HIGH + 0.07], [0, PLATE_HIGH + 0.07]], { segments: 72, crease: 28 }), color: BRASS });
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * TAU;
    const pillar = lathe([
      [0.13, PLATE_LOW], [0.13, PLATE_LOW + 0.1], [0.075, PLATE_LOW + 0.2], [0.095, PLATE_LOW + 0.5], [0.13, PLATE_LOW + 0.62],
      [0.095, PLATE_LOW + 0.76], [0.075, PLATE_HIGH - 0.2], [0.13, PLATE_HIGH - 0.1], [0.13, PLATE_HIGH],
    ], { segments: 14, crease: 50 });
    brass.push({ geometry: pillar, color: BRASS, position: [Math.sin(a) * 2.78, 0, Math.cos(a) * 2.78] });
  }

  // The gear train. A pinion's tooth has to enter a wheel's gap, so each meshing pair is placed
  // along a wheel tooth's own bearing and the pinion is turned half a pitch from it.
  const WHEEL_R = 2.36;
  const WHEEL_T = 72;
  layGear(brass, BRASS, spokedGear(WHEEL_R, WHEEL_T, 0.12, { spokes: 6, hub: 0.2 }), 0, 1.02, 0, 0);
  layGear(brass, BRASS_DARK, spokedGear(1.42, 44, 0.1, { spokes: 5, hub: 0.3 }), 0, 1.46, 0, 0.3);
  const depth = WHEEL_R * (2.1 / WHEEL_T) * 1.9;
  const stepWheel = TAU / WHEEL_T;
  for (const [k, pinionR, pinionT, y, secondary] of [[9, 0.72, 22, 1.02, true], [27, 0.5, 15, 1.02, false], [45, 0.62, 19, 1.02, true], [63, 0.42, 13, 1.02, false]]) {
    const theta = k * stepWheel;
    const dist = WHEEL_R + pinionR - depth * 0.9;
    // gearOutline measures its teeth from +X in the gear's own plane; layGear's rotateX(-90) takes
    // the outline's +Y to world -Z, so a plane angle t points along (cos t, 0, -sin t).
    const px = Math.cos(theta) * dist;
    const pz = -Math.sin(theta) * dist;
    const stepPinion = TAU / pinionT;
    const spin = (theta + Math.PI) - stepPinion / 2;
    layGear(brass, BRASS_DARK, spokedGear(pinionR, pinionT, 0.15, { spokes: 4, hub: 0.3, rim: 0.3 }), px, y, pz, spin);
    brass.push({ geometry: rod([px, PLATE_LOW, pz], [px, PLATE_HIGH, pz], 0.07, { sides: 12 }), color: STEEL });
    if (secondary) layGear(brass, BRASS, spokedGear(pinionR * 0.74, Math.round(pinionT * 0.74), 0.1, { spokes: 4, hub: 0.3, rim: 0.3 }), px, 1.46, pz, 0.2);
  }

  // A crank, because a real one is driven by hand. It turns the first pinion's arbor.
  {
    const theta = 9 * stepWheel;
    const dist = WHEEL_R + 0.72 - depth * 0.9;
    const px = Math.cos(theta) * dist;
    const pz = -Math.sin(theta) * dist;
    const armEnd = [px + 0.85, 2.3, pz + 0.2];
    brass.push({ geometry: rod([px, PLATE_HIGH, pz], [px, 2.32, pz], 0.075, { sides: 12 }), color: STEEL });
    strut(brass, BRASS, [[px, 2.3, pz], armEnd], 0.06, { sides: 10 });
    brass.push({ geometry: lathe([[0.03, 2.3], [0.1, 2.38], [0.1, 2.62], [0.06, 2.72], [0, 2.74]], { segments: 14, crease: 60 }), color: 0x5a3220, position: [armEnd[0], 0, armEnd[2]] });
  }

  // The dial, on the upper plate, under the arms. Atlas cell, planar.
  {
    const R = 2.98;
    const rIn = 0.72;
    const seg = 84;
    const pos = [];
    const uv = [];
    const idx = [];
    const y = PLATE_HIGH + 0.075;
    const toUV = (x, z) => {
      const px = 256 + (x / 2.98) * 254;
      const py = 256 + (z / 2.98) * 254;
      return [px / ATLAS_W, 1 - (512 + py) / ATLAS_H];
    };
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      for (const r of [R, rIn]) {
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r;
        pos.push(x, y, z);
        uv.push(...toUV(x, z));
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    atlas.push({ geometry: g, color: 0xffffff });
  }

  // Innermost planet highest, outermost lowest: the sleeves nest, so each arm leaves the column
  // from its own collar, and a riser from a lower arm stands outside the reach of every arm above.
  const PLANETS = [
    { key: 'mercury', r: 1.18, arm: 5.42, y: 6.42, az: 205, size: 0.13, seg: 20 },
    { key: 'venus', r: 1.68, arm: 4.96, y: 6.18, az: 300, size: 0.23, seg: 26 },
    { key: 'earth', r: 2.22, arm: 4.5, y: 5.95, az: 28, size: 0.25, seg: 32 },
    { key: 'mars', r: 2.76, arm: 4.04, y: 5.72, az: 130, size: 0.18, seg: 24 },
    { key: 'jupiter', r: 3.42, arm: 3.58, y: 5.5, az: 338, size: 0.56, seg: 44 },
    { key: 'saturn', r: 4.02, arm: 3.12, y: 5.1, az: 72, size: 0.44, seg: 40 },
    { key: 'uranus', r: 4.42, arm: 2.66, y: 4.6, az: 176, size: 0.3, seg: 32 },
    { key: 'neptune', r: 4.76, arm: 2.2, y: 4.2, az: 252, size: 0.28, seg: 32 },
  ];

  // The nested column: stepped collars, one per arm, from a broad foot to a slim neck under the Sun.
  const SUN_Y = 7.2;
  const SUN_R = 0.8;
  // Concentric tubes, as in the real thing: each planet's sleeve stops at its arm's collar and the
  // next one up, a little thinner, runs on out of it.
  const profile = [[0, PLATE_HIGH + 0.05], [0.72, PLATE_HIGH + 0.05], [0.72, PLATE_HIGH + 0.12], [0.6, PLATE_HIGH + 0.16]];
  const hubOf = {};
  PLANETS.slice().reverse().forEach((p, i) => {
    const sleeve = 0.56 - i * 0.052;
    hubOf[p.key] = sleeve + 0.06;
    profile.push([sleeve, p.arm - 0.1], [sleeve + 0.07, p.arm - 0.09], [sleeve + 0.075, p.arm - 0.07], [sleeve + 0.075, p.arm + 0.07], [sleeve + 0.03, p.arm + 0.09], [sleeve - 0.052, p.arm + 0.095]);
  });
  profile.push([0.15, 5.9], [0.13, SUN_Y - SUN_R - 0.2], [0.2, SUN_Y - SUN_R - 0.08], [0.2, SUN_Y - SUN_R + 0.12], [0, SUN_Y - SUN_R + 0.12]);
  brass.push({ geometry: lathe(profile, { segments: 64, crease: 34 }), color: BRASS });

  for (const p of PLANETS) {
    const hub = hubOf[p.key];
    const az = p.az * DEG;
    const ex = Math.sin(az);
    const ez = Math.cos(az);
    // A flat tapered bar in plan, from inside the collar to a round boss under the riser.
    const end = 0.11 + p.size * 0.05;
    const outline = [];
    const rootW = Math.min(0.17, hub * 0.42);
    const startX = hub * 0.5;
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      outline.push([p.r + Math.cos(a) * end, Math.sin(a) * end]);
    }
    outline.push([startX, rootW], [startX, -rootW]);
    const plan = extrudeOutline(outline, 0.1);
    // plan x -> radial, plan y -> tangent, thickness -> world up.
    const armM = new THREE.Matrix4().makeTranslation(0, p.arm, 0)
      .multiply(new THREE.Matrix4().makeRotationY(az - Math.PI / 2))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    brass.push({ geometry: xformed(plan, armM), color: BRASS });

    const px = ex * p.r;
    const pz = ez * p.r;
    // The riser and a small turned bead at each end of it. It stops inside the planet.
    brass.push({ geometry: lathe([[end * 0.9, p.arm - 0.08], [end * 0.9, p.arm + 0.05], [0.06, p.arm + 0.16], [0.042, p.arm + 0.3], [0.036, p.y - p.size * 0.5], [0, p.y]], { segments: 12, crease: 55 }), color: BRASS, position: [px, 0, pz] });
    brass.push({ geometry: lathe([[0, p.y - p.size * 1.16], [0.07, p.y - p.size * 1.16], [0.09, p.y - p.size * 1.06], [0.05, p.y - p.size * 0.9], [0, p.y - p.size * 0.8]], { segments: 12, crease: 55 }), color: BRASS, position: [px, 0, pz] });

    // The planet itself, turned to its own axial tilt.
    const sphere = ball(p.size, p.seg, Math.max(12, Math.round(p.seg * 0.7)));
    const [cx, cy] = [(PLANET_CELLS[p.key] % 4) * CELL_W, Math.floor(PLANET_CELLS[p.key] / 4) * CELL_H];
    atlasUV(sphere, cx, cy, CELL_W, CELL_H);
    const tilt = { mercury: 0.5, venus: 3, earth: 23.4, mars: 25, jupiter: 3, saturn: 26.7, uranus: 98, neptune: 28 }[p.key] * DEG;
    const tiltM = new THREE.Matrix4().makeTranslation(px, p.y, pz)
      .multiply(new THREE.Matrix4().makeRotationY(az))
      .multiply(new THREE.Matrix4().makeRotationX(tilt));
    atlas.push({ geometry: xformed(sphere, tiltM), color: 0xffffff });

    if (p.key === 'saturn' || p.key === 'uranus') {
      // Rings: a thin closed annulus, standing clear of the planet on three fine pins. The real
      // rings touch nothing, but a brass model has to hold them up with something.
      const rIn = p.key === 'saturn' ? p.size * 1.3 : p.size * 1.55;
      const rOut = p.key === 'saturn' ? p.size * 2.3 : p.size * 1.66;
      const seg = p.key === 'saturn' ? 72 : 48;
      const t = p.key === 'saturn' ? 0.012 : 0.008;
      const ringPos = [];
      const ringUv = [];
      const ringIdx = [];
      const uvAt = (f) => (p.key === 'saturn'
        ? [(512 + 2 + f * 1020) / ATLAS_W, 1 - (512 + 32) / ATLAS_H]
        : [(512 + 200) / ATLAS_W, 1 - (512 + 32) / ATLAS_H]);
      const sections = [[rIn, t], [rOut, t], [rOut, -t], [rIn, -t]];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * TAU;
        for (const [r, h] of sections) {
          ringPos.push(Math.sin(a) * r, h, Math.cos(a) * r);
          ringUv.push(...uvAt((r - rIn) / (rOut - rIn)));
        }
      }
      for (let i = 0; i < seg; i++) {
        for (let s = 0; s < 4; s++) {
          const a = i * 4 + s;
          const b = i * 4 + ((s + 1) % 4);
          const c = (i + 1) * 4 + ((s + 1) % 4);
          const d = (i + 1) * 4 + s;
          ringIdx.push(a, d, c, a, c, b);
        }
      }
      const ring = new THREE.BufferGeometry();
      ring.setIndex(ringIdx);
      ring.setAttribute('position', new THREE.Float32BufferAttribute(ringPos, 3));
      ring.setAttribute('uv', new THREE.Float32BufferAttribute(ringUv, 2));
      ring.computeVertexNormals();
      atlas.push({ geometry: xformed(ring, tiltM), color: 0xffffff });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.5;
        const pin = rod([Math.sin(a) * p.size * 0.9, 0, Math.cos(a) * p.size * 0.9], [Math.sin(a) * (rIn + 0.02), 0, Math.cos(a) * (rIn + 0.02)], 0.012, { sides: 6 });
        brass.push({ geometry: xformed(pin, tiltM), color: BRASS });
      }
    }

    if (p.key === 'earth') {
      // The Moon on its own small arm, driven off the Earth's riser.
      const a2 = az + 1.2;
      const armY = p.y - p.size - 0.2;
      const mx = px + Math.sin(a2) * 0.62;
      const mz = pz + Math.cos(a2) * 0.62;
      strut(brass, BRASS, [[px, armY, pz], [mx, armY, mz]], 0.024, { sides: 8, detail: 8 });
      brass.push({ geometry: lathe([[0.035, armY - 0.02], [0.035, armY + 0.02], [0.018, armY + 0.05], [0.016, p.y - 0.12], [0, p.y - 0.06]], { segments: 8, crease: 60 }), color: BRASS, position: [mx, 0, mz] });
      const moon = ball(0.085, 18, 14);
      atlasUV(moon, 1536, 512, 256, 128);
      atlas.push({ geometry: moon, color: 0xffffff, position: [mx, p.y - 0.06, mz] });
      // A little wheel on the Earth's riser: the gear that drives the Moon.
      layGear(brass, BRASS_DARK, spokedGear(0.15, 12, 0.03, { spokes: 3, hub: 0.3, rim: 0.3 }), px, armY - 0.07, pz, 0);
    }
  }

  const root = new THREE.Group();
  root.add(partsMesh(brass, { roughness: 0.34, metalness: 0.46 }));
  root.add(partsMesh(wood, { roughness: 0.46, metalness: 0.02 }));
  const atlasMap = canvasTexture(ATLAS_W, ATLAS_H, paintPlanetAtlas);
  root.add(mesh(mergeParts(atlas), standard({ map: atlasMap, vertexColors: true, roughness: 0.55, metalness: 0 })));

  // The Sun glows and lights nothing: emissive, not a lamp, with a hot granulated surface so it is
  // a body and not a flat yellow disc.
  const sunMap = canvasTexture(512, 256, (ctx, w, h) => {
    const rng = seededRandom(1543);
    ctx.fillStyle = '#f28a12';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,214,90,0.2)' : 'rgba(190,52,6,0.18)';
      ctx.beginPath();
      ctx.arc(rng() * w, rng() * h, 1 + rng() * 3.5, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,226,130,0.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const x = rng() * w;
      const y = 50 + rng() * (h - 100);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 12, y - 16, x + 30, y - 14, x + 42, y + rng() * 6);
      ctx.stroke();
    }
  });
  const sunGeo = ball(SUN_R, 48, 32);
  sunGeo.translate(0, SUN_Y, 0);
  const sun = mesh(sunGeo, standard({ map: sunMap, emissive: 0xffffff, emissiveMap: sunMap, emissiveIntensity: 0.85, roughness: 0.9, metalness: 0 }));
  // A lit body in the middle throws a dark shadow across every arm below it, which a glowing one
  // would not.
  sun.castShadow = false;
  root.add(sun);
  return root;
}

// ===========================================================================================
// APOLLO LUNAR MODULE
// ===========================================================================================

// Near-white foil tile. Multiplied by a vertex colour, one crinkle serves the gold on the descent
// stage, the black insulation over it and the silver on the propellant tanks. It is painted twice
// from one seed, as a colour map and as data for the bump, so the creases that catch the light are
// the same ones that are drawn.
function paintFoil(ctx, w, wrap, { contrast = 1 } = {}) {
  const rng = seededRandom(1969);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, w, w);
  const shapes = [];
  for (let i = 0; i < 150; i++) {
    const x = rng() * w;
    const y = rng() * w;
    const r = 16 + rng() * 60;
    const a = rng() * TAU;
    const pts = [];
    const sides = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < sides; k++) {
      const t = a + (k / sides) * TAU + (rng() - 0.5) * 0.7;
      pts.push([x + Math.cos(t) * r * (0.6 + rng() * 0.5), y + Math.sin(t) * r * (0.6 + rng() * 0.5)]);
    }
    shapes.push({ pts, fill: rng() > 0.45 ? `rgba(255,255,255,${0.4 * contrast})` : `rgba(175,175,175,${0.2 * contrast})` });
  }
  const lines = [];
  for (let i = 0; i < 260; i++) {
    const x = rng() * w;
    const y = rng() * w;
    const a = rng() * TAU;
    const len = 6 + rng() * rng() * 34;
    lines.push({ x, y, ex: x + Math.cos(a) * len, ey: y + Math.sin(a) * len, width: 0.8 + rng() * 1.6 });
  }
  wrap(() => {
    for (const s of shapes) {
      ctx.fillStyle = s.fill;
      ctx.beginPath();
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }
    for (const l of lines) {
      ctx.lineWidth = l.width;
      ctx.strokeStyle = `rgba(130,130,130,${0.5 * contrast})`;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(l.ex, l.ey);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(l.x + 1.2, l.y + 1.2);
      ctx.lineTo(l.ex + 1.2, l.ey + 1.2);
      ctx.stroke();
    }
    // Lines of tape, where one blanket was joined to the next.
    for (const [x0, y0, x1, y1] of [[w * 0.28, 0, w * 0.28, w], [w * 0.74, 0, w * 0.74, w], [0, w * 0.6, w, w * 0.6]]) {
      ctx.strokeStyle = `rgba(120,120,120,${0.5 * contrast})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(250,250,250,0.9)';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
  });
}

// One face of the descent stage's blanket: a grid that bows gently out between its taped edges.
function foilPanel(list, a, b, y0, y1, color, seed, { nu = 18, nv = 12, bow = 0.08, uStart = 0 } = {}) {
  const A = V(a[0], 0, a[1]);
  const B = V(b[0], 0, b[1]);
  const along = B.clone().sub(A);
  const width = along.length();
  const out = V(along.z, 0, -along.x).normalize();
  if (out.dot(A.clone().add(B)) < 0) out.negate();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= nv; j++) {
    const fv = j / nv;
    const y = y0 + (y1 - y0) * fv;
    for (let i = 0; i <= nu; i++) {
      const fu = i / nu;
      const p = A.clone().lerp(B, fu);
      // Zero on every edge, so two panels meet at one line and the corner stays a corner.
      const fade = Math.sin(Math.PI * fu) ** 0.5 * Math.sin(Math.PI * fv) ** 0.5;
      const billow = (smoothNoise3(p.x * 0.42 + seed, y * 0.42, p.z * 0.42) - 0.35) * 1.5
        + (smoothNoise3(p.x * 0.9, y * 0.9 + seed, p.z * 0.9) - 0.5) * 0.5;
      p.addScaledVector(out, billow * bow * fade);
      pos.push(p.x, y, p.z);
      uv.push(uStart + fu * width, y);
    }
  }
  const ring = nu + 1;
  const flip = along.clone().cross(UP).dot(out) < 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const p = j * ring + i;
      const q = p + 1;
      const r = p + ring;
      const s = r + 1;
      if (flip) idx.push(p, s, q, p, r, s);
      else idx.push(p, q, s, p, s, r);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  list.push({ geometry: g, color });
}

// A short bell thruster, built along +Y from its base with the mouth at the top.
function thrusterBell(len, r) {
  return lathe([
    [0, len * 0.72], [r * 0.3, len * 0.72], [r * 0.82, len * 0.98], [r, len],
    [r * 0.98, len * 0.94], [r * 0.56, len * 0.5], [r * 0.32, len * 0.16], [r * 0.34, 0], [0, 0],
  ], { segments: 14, crease: 40 });
}

function buildLunarModule() {
  const foil = [];
  const plates = [];
  const hard = [];
  const glass = [];
  const decal = [];

  const GOLD = 0xe8a92f;
  const AMBER = 0xd99725;
  const BLACK = 0x2f2d2b;
  const SILVER = 0xc7c9cc;
  const CABIN = 0xa3a6a9;
  const CABIN_DARK = 0x74777b;
  const STRUT = 0x9c9b97;
  const DARK = 0x242426;

  // --- Descent stage ------------------------------------------------------------------------
  // Octagonal in plan with four long faces (front, back and sides, where the legs attach) and four
  // short diagonal ones. Everything is wrapped in foil and only the bell and the legs stand out.
  const APO = 6.9; // from the axis to a long face
  const CHAMFER = 2.6;
  const DECK = 10.7;
  const BELLY = 5.0;
  const half = APO - CHAMFER;
  const octagon = [
    [-half, APO], [half, APO], [APO, half], [APO, -half],
    [half, -APO], [-half, -APO], [-APO, -half], [-APO, half],
  ];
  octagon.forEach((p, i) => {
    const q = octagon[(i + 1) % 8];
    const long = i % 2 === 0;
    foilPanel(foil, p, q, BELLY, DECK, long ? GOLD : AMBER, i * 3.7 + 1, { nu: long ? 20 : 9, uStart: i * 7.3 });
  });
  // Deck and belly, each a flat fan.
  const octCap = (y, color) => foil.push({ geometry: facetSolid(octagon.map(([x, z]) => [x, y, z]).concat([[0, y - Math.sign(y - 8) * 0.5, 0]]), [octagon.map((_, i) => i)]), color });
  octCap(DECK, AMBER);
  octCap(BELLY, BLACK);

  // Black insulation wrapped over the upper corners, and the blanket's taped bands.
  for (const i of [1, 3, 5, 7]) {
    const p = octagon[i];
    const q = octagon[(i + 1) % 8];
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    const n = V(mx, 0, mz).normalize();
    const pp = [p[0] * 0.995, DECK - 0.06, p[1] * 0.995];
    const qq = [q[0] * 0.995, DECK - 0.06, q[1] * 0.995];
    const qb = [q[0] * 0.995, DECK - 2.3, q[1] * 0.995];
    const pb = [p[0] * 0.995, DECK - 2.3, p[1] * 0.995];
    foil.push({ geometry: plateOn([pp, qq, qb, pb], n, { proud: 0.13, sink: 0.05 }), color: BLACK });
  }
  // The heat shield under the belly, a shallow skirt of foil closing the gap to the engine.
  foil.push({
    geometry: scaleUV(lathe([[0, BELLY + 0.06], [3.55, BELLY + 0.06], [3.3, BELLY - 0.26], [2.05, BELLY - 0.5], [1.5, BELLY - 0.62], [0, BELLY - 0.62]], { segments: 32, crease: 40 }), 12, 4),
    color: 0x8a8378,
  });

  // The descent engine bell, open at the bottom with a real inner wall.
  const bell = lathe([
    [0, 5.7], [1.05, 5.7], [1.08, 4.75], [1.5, 3.5], [2.08, 2.25], [2.46, 1.62], [2.47, 1.55],
    [2.38, 1.56], [1.98, 2.25], [1.42, 3.5], [0.98, 4.6], [0.55, 4.9], [0, 4.95],
  ], { segments: 40, crease: 38 });
  hard.push({
    geometry: bell,
    keepColor: true,
    tint: (p) => {
      const r = Math.hypot(p.x, p.z);
      const outer = r > 1.08 + (4.75 - p.y) * 0.44 - 0.1;
      if (!outer) return lin(0x201c1a);
      const heat = clamp01((p.y - 1.6) / 3);
      return mix3(lin(0x8f8678), lin(0x5f5048), heat);
    },
  });
  // Stiffening bands on the bell, sunk so they read as part of it.
  for (const y of [2.2, 3.2, 4.1]) {
    const r = 1.08 + (4.75 - y) * 0.44 + (y < 2.6 ? 0.02 : 0);
    hard.push({ geometry: lathe([[r - 0.06, y - 0.05], [r + 0.03, y - 0.05], [r + 0.03, y + 0.05], [r - 0.06, y + 0.05]], { segments: 40 }), color: 0x6d6459 });
  }

  // --- Landing gear -------------------------------------------------------------------------
  // In plan a plus: legs out of the front, back and both sides. Each is authored in a frame of
  // (t: across, y: up, o: outward), so one description serves all four.
  const legs = [[0, 1, true], [1, 0, false], [0, -1, false], [-1, 0, false]];
  const PAD_O = 14.0;
  for (const [ex, ez, front] of legs) {
    const W = (t, y, o) => [ez * t + ex * o, y, -ex * t + ez * o];
    const top = W(0, 9.5, 8.0);
    const pad = W(0, 0.72, PAD_O);
    const J = 0.56;
    const at = (f) => [top[0] + (pad[0] - top[0]) * f, top[1] + (pad[1] - top[1]) * f, top[2] + (pad[2] - top[2]) * f];
    const sleeveEnd = at(0.68);

    // The primary strut: a fat foil-wrapped cylinder with the bare shock-absorber sliding out of it.
    foil.push({ geometry: scaleUV(rod(top, sleeveEnd, 0.44, { sides: 18 }), 2.8, 6.4), color: GOLD });
    foil.push({ geometry: scaleUV(ball(0.46, 16), 2.8, 1.4), color: GOLD, position: top });
    hard.push({ geometry: rod(sleeveEnd, at(0.7), 0.47, { sides: 18 }), color: 0x7f7a70 });
    hard.push({ geometry: rod(at(0.68), pad, 0.27, { sides: 16 }), color: 0xc4c5c6 });

    // The outrigger truss from the deck to the strut's head.
    const head = W(0, 9.75, 7.8);
    for (const t of [-3.4, 3.4]) {
      const root = W(t, 10.15, APO - 0.05);
      foil.push({ geometry: scaleUV(rod(root, head, 0.16, { sides: 10 }), 1, 4), color: GOLD });
      foil.push({ geometry: scaleUV(ball(0.21, 10), 1, 1), color: GOLD, position: root });
    }
    foil.push({ geometry: scaleUV(rod(W(0, 9.5, APO - 0.05), top, 0.2, { sides: 10 }), 1.2, 1.5), color: GOLD });

    // Two secondary struts, from the strut's waist back to the stage's lower corners. These carry
    // side load, and the V they make is what the eye reads as a landing leg.
    const waist = at(J);
    hard.push({ geometry: lathe([[0, -0.32], [0.44, -0.28], [0.52, -0.1], [0.52, 0.1], [0.44, 0.28], [0, 0.32]], { segments: 16, crease: 50 }), color: 0xa58f5f, position: waist });
    for (const t of [-half + 0.1, half - 0.1]) {
      const root = W(t, BELLY + 0.35, APO - 0.04);
      foil.push({ geometry: scaleUV(rod(root, waist, 0.2, { sides: 12 }), 1.4, 6), color: AMBER });
      foil.push({ geometry: scaleUV(ball(0.27, 10), 1, 1), color: AMBER, position: root });
    }
    // The down-lock: the short link straight in from the waist.
    const lockRoot = W(0, BELLY + 0.2, APO - 0.04);
    hard.push({ geometry: rod(lockRoot, waist, 0.11, { sides: 10 }), color: STRUT });
    hard.push({ geometry: ball(0.16, 10), color: STRUT, position: lockRoot });

    // The footpad: a saucer with its pivot sunk in the top.
    const padGeo = lathe([
      [0, 0], [0.82, 0], [1.3, 0.2], [1.55, 0.44], [1.57, 0.52], [1.48, 0.56], [1.0, 0.52], [0.38, 0.62], [0, 0.72],
    ], { segments: 36, crease: 34 });
    foil.push({ geometry: scaleUV(padGeo, 9, 3), color: SILVER, position: [pad[0], 0, pad[2]] });
    hard.push({ geometry: ball(0.36, 14), color: 0x8c8c88, position: [pad[0], 0.72, pad[2]] });

    // A lunar-surface sensing probe under each leg but the front one, bent back by the landing.
    // The front probe was left off so it could not trip a crew on the ladder.
    if (!front) {
      const a = W(0.7, 0.42, PAD_O + 0.6);
      const b = W(1.6, 0.09, PAD_O - 0.6);
      const c = W(3.4, 0.1, PAD_O - 2.4);
      strut(hard, 0xb5b3ad, [a, b, c], 0.035, { sides: 7, detail: 7 });
    }

    if (front) {
      // The ladder rides the front strut, standing proud of it along the outward-up normal.
      const dO = PAD_O - 8.0;
      const dY = 0.72 - 9.5;
      const len = Math.hypot(dO, dY);
      const nO = -dY / len;
      const nY = dO / len;
      const off = 0.62;
      const lad = (f, t) => W(t, 9.5 + dY * f + nY * off, 8.0 + dO * f + nO * off);
      const f0 = -0.1;
      const f1 = 0.78;
      for (const t of [-0.88, 0.88]) {
        hard.push({ geometry: rod(lad(f0, t), lad(f1, t), 0.075, { sides: 10 }), color: 0xd0d1d2 });
        hard.push({ geometry: ball(0.082, 8), color: 0xd0d1d2, position: lad(f1, t) });
        for (const f of [0.08, 0.42, 0.74]) {
          const s = W(t * 0.5, 9.5 + dY * f, 8.0 + dO * f);
          hard.push({ geometry: rod(lad(f, t), s, 0.045, { sides: 7 }), color: 0xa8a9aa });
        }
      }
      const rungs = 9;
      for (let i = 0; i < rungs; i++) {
        const f = f0 + 0.05 + ((f1 - f0 - 0.08) * i) / (rungs - 1);
        hard.push({ geometry: rod(lad(f, -0.88), lad(f, 0.88), 0.055, { sides: 8 }), color: 0xe2e2e2 });
      }

      // The porch, level with the deck, between the hatch and the ladder.
      const PORCH_T = 1.95;
      const PORCH_O = lad(f0, 0)[2] + 0.3;
      plates.push({ geometry: facetSolid([
        [-PORCH_T, DECK + 0.02, APO - 0.2], [PORCH_T, DECK + 0.02, APO - 0.2], [PORCH_T, DECK + 0.02, PORCH_O], [-PORCH_T, DECK + 0.02, PORCH_O],
        [-PORCH_T, DECK + 0.14, APO - 0.2], [PORCH_T, DECK + 0.14, APO - 0.2], [PORCH_T, DECK + 0.14, PORCH_O], [-PORCH_T, DECK + 0.14, PORCH_O],
      ], [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]), color: 0x9fa0a0 });
      // Non-slip ribs on the porch deck, and a railing either side of it.
      for (let i = 0; i < 7; i++) {
        const z = APO + 0.05 + (i / 6) * (PORCH_O - APO - 0.25);
        hard.push({ geometry: box(PORCH_T * 2 - 0.3, 0.05, 0.1), color: 0x5c5c5c, position: [0, DECK + 0.15, z] });
      }
      for (const t of [-1, 1]) {
        const x = t * PORCH_T;
        strut(hard, 0xd8d8d6, [[x, DECK + 0.14, PORCH_O - 0.05], [x, DECK + 3.05, PORCH_O - 1.0], [x * 0.98, DECK + 3.65, 5.3]], 0.05, { sides: 8, detail: 8 });
        hard.push({ geometry: rod([x, DECK + 0.14, PORCH_O - 1.2], [x, DECK + 1.8, PORCH_O - 1.1], 0.04, { sides: 7 }), color: 0xd8d8d6 });
      }
      // The porch's braces back to the stage, so it is holding on to something.
      for (const t of [-1.7, 1.7]) {
        hard.push({ geometry: rod([t, DECK + 0.03, PORCH_O - 0.1], [t * 1.1, DECK - 1.7, APO - 0.02], 0.055, { sides: 8 }), color: STRUT });
      }
    }
  }

  // The equipment stowage bay left of the ladder, and the flag and name right of it.
  foil.push({ geometry: plateOn([[-4.05, 9.8, APO], [-1.45, 9.8, APO], [-1.45, 6.2, APO], [-4.05, 6.2, APO]], V(0, 0, 1), { proud: 0.24, sink: 0.05 }), color: SILVER });
  for (const y of [7.1, 8.1, 9.1]) hard.push({ geometry: box(2.7, 0.09, 0.08), color: 0x5e5a52, position: [-2.75, y, APO + 0.27] });
  for (const x of [-3.7, -1.8]) hard.push({ geometry: box(0.09, 3.7, 0.08), color: 0x5e5a52, position: [x, 8.0, APO + 0.27] });
  const flagPlate = plateOn([[1.45, 9.9, APO], [4.05, 9.9, APO], [4.05, 7.55, APO], [1.45, 7.55, APO]], V(0, 0, 1), { proud: 0.1, sink: 0.05 });
  {
    const uv = flagPlate.attributes.uv;
    const n = flagPlate.attributes.normal;
    const pos = flagPlate.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      if (n.getZ(i) > 0.9) uv.setXY(i, (pos.getX(i) - 1.45) / 2.6, (pos.getY(i) - 7.55) / 2.35);
      else uv.setXY(i, 0.99, 0.99);
    }
  }
  decal.push({ geometry: flagPlate, color: 0xffffff });

  // --- Ascent stage -------------------------------------------------------------------------
  // Everything is flat panels, because it flew only in space and nothing about it had to meet air.
  const Y = (y) => DECK + y;
  const sec = (z, pts) => pts.map(([x, y]) => [x, Y(y), z]);

  // Filler between the stages, dark and set back, so there is no daylight under the cabin.
  hard.push({ geometry: box(5.9, 1.0, 7.4), color: 0x47484b, position: [0, Y(0.42), 0.3] });
  hard.push({ geometry: box(2.4, 1.0, 2.2), color: 0x3a3a3c, position: [0, Y(0.42), 4.0] });

  // The crew compartment: a blunt nose, broad window facets slanting back from it, and the cabin
  // proper. The window facet is between nose and full section, which is what makes the "eyes".
  const NOSE = [[-1.5, 0.5], [1.5, 0.5], [1.85, 2.1], [1.72, 4.55], [1.15, 5.25], [-1.15, 5.25], [-1.72, 4.55], [-1.85, 2.1]];
  const FULL = [[-3.15, 0.2], [3.15, 0.2], [4.35, 1.95], [4.75, 4.55], [3.0, 7.0], [-3.0, 7.0], [-4.75, 4.55], [-4.35, 1.95]];
  const AFTC = [[-3.15, 0.2], [3.15, 0.2], [4.35, 1.95], [4.6, 4.55], [3.0, 6.95], [-3.0, 6.95], [-4.6, 4.55], [-4.35, 1.95]];
  const Z_NOSE = 5.3;
  const Z_FULL = 2.75;
  const Z_AFT = -0.75;
  const cabinColors = (fi, n) => {
    if (n.z > 0.98) return CABIN_DARK;
    if (n.y < -0.5) return DARK;
    if (n.y > 0.5 && n.z > 0.3) return 0x96999c;
    if (n.z > 0.3) return 0x8c8f93;
    return CABIN;
  };
  plates.push({
    geometry: sectionHull([sec(Z_NOSE, NOSE), sec(Z_FULL, FULL), sec(Z_AFT, AFTC)], { colors: cabinColors }),
    keepColor: true,
  });

  // The midsection behind it, lower and narrower, then the aft equipment bay out on its own truss.
  const MID = [[-3.3, 0.5], [3.3, 0.5], [3.7, 1.9], [3.7, 4.6], [2.5, 6.25], [-2.5, 6.25], [-3.7, 4.6], [-3.7, 1.9]];
  plates.push({
    geometry: sectionHull([sec(Z_AFT + 0.02, MID), sec(-3.3, MID)], { colors: (fi, n) => (n.y < -0.5 ? DARK : n.y > 0.5 ? 0x8d9094 : 0x7f8286) }),
    keepColor: true,
  });
  const AFT = [[-2.9, 1.5], [2.9, 1.5], [2.9, 5.2], [-2.9, 5.2]];
  plates.push({
    geometry: sectionHull([sec(-4.35, AFT), sec(-6.3, AFT)], { colors: (fi, n) => (n.z < -0.9 ? 0x2c2c2e : n.y > 0.9 ? 0x505256 : 0x3b3c40) }),
    keepColor: true,
  });
  // The truss carrying the aft bay, with daylight through it.
  for (const x of [-2.5, 2.5]) {
    for (const [y0, y1] of [[1.8, 1.8], [4.9, 4.9], [1.8, 4.9]]) {
      strut(hard, 0x77797c, [[x, Y(y0), -3.25], [x, Y(y1), -4.4]], 0.075, { sides: 8, detail: 8 });
    }
  }
  // Radiator panels on the aft bay's flanks, and a pair of inverter boxes.
  for (const s of [-1, 1]) {
    plates.push({ geometry: plateOn([[s * 2.9, Y(4.9), -4.55], [s * 2.9, Y(4.9), -6.1], [s * 2.9, Y(1.8), -6.1], [s * 2.9, Y(1.8), -4.55]], V(s, 0, 0), { proud: 0.05, sink: 0.05 }), color: 0xd8dade });
  }
  // The aft face: radiator fins and two equipment boxes, so it does not read as a blank slab.
  for (let i = 0; i < 11; i++) hard.push({ geometry: box(0.09, 3.3, 0.18), color: 0x75777a, position: [-2.2 + i * 0.44, Y(3.35), -6.32] });
  plates.push({ geometry: box(2.3, 1.05, 0.5), color: 0xc9cbce, position: [-1.32, Y(4.3), -6.5] });
  plates.push({ geometry: box(2.3, 1.05, 0.5), color: 0xb5b7ba, position: [1.32, Y(2.45), -6.5] });

  // The propellant tanks bulge from the flanks, under foil. They are not the same distance out:
  // oxidiser is the heavier load, so it rides closer to the centre to balance the fuel.
  for (const [x, r] of [[-3.5, 2.35], [3.05, 2.25]]) {
    // A low-sided lathe on its side, with hard panel edges: the blanket over a tank is flat gores
    // laced together, not a smooth ball.
    const prof = [];
    for (let i = 0; i <= 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI;
      prof.push([Math.cos(a) * r, Math.sin(a) * r * 0.86]);
    }
    const tank = lathe(prof, { segments: 14, crease: 14 });
    scaleUV(tank, 14, 6);
    tank.rotateX(Math.PI / 2);
    plates.push({ geometry: tank, color: 0xb9bcc0, position: [x, Y(2.75), -2.05] });
  }
  // A dark thermal panel on each flank, under the thrusters' own exhaust.
  for (const s of [-1, 1]) {
    const q = (y, z) => {
      const k = (y - 1.95) / (4.55 - 1.95);
      return [s * (4.35 + (4.68 - 4.35) * k), Y(y), z];
    };
    const n = V(s * 2.6, -0.33, 0).normalize();
    plates.push({ geometry: plateOn([q(2.3, 2.2), q(2.3, -0.45), q(4.2, -0.45), q(4.2, 2.2)], n, { proud: 0.05, sink: 0.05 }), color: 0x74767a });
  }

  // Top of the cabin: the docking tunnel on the stage's centreline, with the hatch that met the
  // Command Module, then the hump over the ascent engine behind it.
  const TUNNEL_Z = 0.15;
  hard.push({
    geometry: lathe([[0, 6.6], [1.45, 6.6], [1.45, 7.45], [1.62, 7.5], [1.68, 7.72], [1.68, 7.92], [1.4, 8.0], [1.24, 7.86], [1.2, 7.55], [0, 7.5]], { segments: 40, crease: 36 }),
    color: 0x8b8e92,
    position: [0, DECK, TUNNEL_Z],
  });
  hard.push({ geometry: lathe([[0, 7.5], [1.2, 7.5], [1.16, 7.56], [0.1, 7.6], [0, 7.6]], { segments: 32 }), color: 0x3a3a3c, position: [0, DECK, TUNNEL_Z] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    hard.push({ geometry: box(0.1, 0.22, 0.26), color: 0xd8d8d8, position: [Math.sin(a) * 1.5, Y(7.82), TUNNEL_Z + Math.cos(a) * 1.5] });
  }
  hard.push({
    geometry: lathe([[0, 5.6], [1.7, 5.6], [1.75, 6.3], [1.45, 6.8], [0.9, 7.1], [0, 7.2]], { segments: 26, crease: 40 }),
    color: 0x7a7d80,
    position: [0, DECK, -2.6],
  });

  // --- Windows, the part that gives it a face ---------------------------------------------
  // Triangles on the slanted facets, wide at the top and pointing down and in. Dark glass, a hood
  // frame standing proud of it, and the shadow the frame casts is what makes them look recessed.
  for (const s of [-1, 1]) {
    const facet = (fs, ft) => {
      // Bilinear on the facet between nose edge (2->3) and full edge (2->3).
      const a = V(s * 1.85, Y(2.1), Z_NOSE);
      const b = V(s * 1.72, Y(4.55), Z_NOSE);
      const c = V(s * 4.75, Y(4.55), Z_FULL);
      const d = V(s * 4.35, Y(1.95), Z_FULL);
      const low = a.clone().lerp(d, fs);
      const high = b.clone().lerp(c, fs);
      return low.lerp(high, ft);
    };
    const n = facet(1, 0).sub(facet(0, 0)).cross(facet(0, 1).sub(facet(0, 0))).normalize();
    if (n.z < 0) n.negate();
    const tri = [facet(0.14, 0.86), facet(0.84, 0.86), facet(0.22, 0.2)];
    const centre = tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(1 / 3);
    const inset = (f) => tri.map((p) => p.clone().sub(centre).multiplyScalar(f).add(centre));

    // The dark surround: a bigger triangle, flush-ish, on which the pane sits.
    plates.push({ geometry: plateOn(inset(1.16).map((p) => p.toArray()), n, { proud: 0.05, sink: 0.04 }), color: 0x2b2b2d });
    glass.push({ geometry: plateOn(inset(0.86).map((p) => p.toArray()), n, { proud: 0.09, sink: 0.03 }), color: 0x0f1d2a });
    // Hood frame, three bars, proud of the pane.
    const outer = inset(1.08);
    const inner = inset(0.86);
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const low = [outer[i], outer[j], inner[j], inner[i]].map((p) => p.clone().addScaledVector(n, 0.0).toArray());
      const high = [outer[i], outer[j], inner[j], inner[i]].map((p, k) => p.clone().addScaledVector(n, k < 2 ? 0.26 : 0.17).toArray());
      plates.push({ geometry: facetSolid([...low, ...high], [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]), color: 0x9a9da0 });
    }
  }

  // The docking window, in the roof over the commander's station: he looked straight up through it
  // to line up with the Command Module.
  {
    const a = V(1.15, Y(5.25), Z_NOSE);
    const b = V(3.0, Y(7.0), Z_FULL);
    const c = V(-3.0, Y(7.0), Z_FULL);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if (n.y < 0) n.negate();
    const at = (x, f) => V(x, Y(5.25) + 1.75 * f, Z_NOSE + (Z_FULL - Z_NOSE) * f).toArray();
    plates.push({ geometry: plateOn([at(0.5, 0.25), at(1.75, 0.25), at(1.9, 0.72), at(0.55, 0.72)], n, { proud: 0.1, sink: 0.04 }), color: 0x3b3b3d });
    glass.push({ geometry: plateOn([at(0.66, 0.34), at(1.6, 0.34), at(1.7, 0.64), at(0.7, 0.64)], n, { proud: 0.13, sink: 0.04 }), color: 0x0f1d2a });
  }

  // The hatch, in the flat of the nose: square, because a suited astronaut's backpack is square.
  {
    // UVs flattened to one clean point of the panel map, clear of its seam lines: the cabin's seams
    // do not run across a hatch.
    const flatUV = (g) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 1.2, 1.2); return g; };
    const h = flatUV(extrudeOutline(roundedOutline(1.32, 1.34, 0.3, 4), 0.2));
    plates.push({ geometry: h, color: 0xb2b4b6, position: [0, Y(2.12), Z_NOSE] });
    plates.push({ geometry: flatUV(extrudeOutline(roundedOutline(1.05, 1.07, 0.2, 3), 0.3)), color: 0x8f9194, position: [0, Y(2.12), Z_NOSE] });
    // Latch handle, on a pair of stand-offs.
    hard.push({ geometry: rod([0.42, Y(1.72), Z_NOSE + 0.28], [0.42, Y(2.5), Z_NOSE + 0.28], 0.04, { sides: 8 }), color: 0xd8d8d8 });
    for (const y of [1.76, 2.46]) hard.push({ geometry: rod([0.42, Y(y), Z_NOSE + 0.1], [0.42, Y(y), Z_NOSE + 0.29], 0.03, { sides: 6 }), color: 0xd8d8d8 });
    // Hand rails down either side of it.
    for (const s of [-1, 1]) {
      strut(hard, 0xdcdcdc, [[s * 1.55, Y(0.9), Z_NOSE + 0.28], [s * 1.55, Y(3.4), Z_NOSE + 0.28]], 0.04, { sides: 8, detail: 8 });
      for (const y of [1.0, 3.3]) hard.push({ geometry: rod([s * 1.55, Y(y), Z_NOSE - 0.05], [s * 1.55, Y(y), Z_NOSE + 0.28], 0.03, { sides: 6 }), color: 0xdcdcdc });
    }
    // The tracking light above the windows.
    hard.push({ geometry: lathe([[0, 0], [0.24, 0], [0.24, 0.12], [0.16, 0.2], [0, 0.22]], { segments: 14 }), color: 0xe8e8e8, position: [0, Y(4.88), Z_NOSE - 0.02], rotation: [Math.PI / 2, 0, 0] });
  }

  // --- Reaction control thrusters -----------------------------------------------------------
  // Four clusters at the corners on outriggers, each with four small engines at right angles: up,
  // down, and out along each horizontal axis. They are most of what a student will remember.
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const c = sz > 0 ? [sx * 6.15, Y(4.75), 3.4] : [sx * 5.0, Y(4.75), -5.6];
    hard.push({ geometry: box(0.74, 0.74, 0.74), color: 0x4f5154, position: c });
    const root1 = sz > 0 ? [sx * 4.4, Y(4.7), 2.1] : [sx * 2.8, Y(4.6), -4.6];
    const root2 = sz > 0 ? [sx * 4.5, Y(3.0), 2.3] : [sx * 2.8, Y(2.6), -4.9];
    const root3 = sz > 0 ? [sx * 4.5, Y(5.0), 0.2] : [sx * 3.5, Y(4.5), -3.1];
    for (const r of [root1, root2, root3]) strut(hard, 0x8c8e91, [r, c], 0.065, { sides: 8, detail: 8 });
    const dirs = [[0, 1, 0], [0, -1, 0], [sx, 0, 0], [0, 0, sz]];
    for (const d of dirs) {
      const D = V(...d);
      const q = new THREE.Quaternion().setFromUnitVectors(UP, D);
      const m = new THREE.Matrix4().compose(V(...c).addScaledVector(D, 0.3), q, V(1, 1, 1));
      hard.push({ geometry: xformed(thrusterBell(0.86, 0.25), m), color: 0xbdb7a8 });
    }
    // The plume deflector on the deck under each cluster, angled to throw the exhaust away from
    // the foil. It sits on the top of the descent stage, where the jet would otherwise hit it.
    const px = Math.max(-5.7, Math.min(5.7, c[0]));
    const pz = Math.max(-5.7, Math.min(5.7, c[2]));
    const n = V(sx * 0.46, 0.78, sz * 0.4).normalize();
    const uu = V(sz, 0, -sx).normalize();
    const vv = n.clone().cross(uu).normalize();
    const cen = V(px, DECK + 0.55, pz);
    const quad = [[-0.8, -0.5], [0.8, -0.5], [0.8, 0.5], [-0.8, 0.5]].map(([a, b]) => cen.clone().addScaledVector(uu, a).addScaledVector(vv, b).toArray());
    foil.push({ geometry: plateOn(quad, n, { proud: 0.04, sink: 0.04 }), color: GOLD });
    foil.push({ geometry: scaleUV(rod([px, DECK - 0.1, pz], cen.toArray(), 0.12, { sides: 8 }), 1, 1), color: GOLD });
  }

  // --- Antennas ------------------------------------------------------------------------------
  // The rendezvous radar on top of the nose: a 24-inch dish on a two-axis yoke. It tracked the
  // Command Module during the climb back to orbit.
  const dish = (cx, cy, cz, r, tiltX, tiltY, color = 0xe2e2df) => {
    const m = new THREE.Matrix4().makeTranslation(cx, cy, cz)
      .multiply(new THREE.Matrix4().makeRotationY(tiltY))
      .multiply(new THREE.Matrix4().makeRotationX(tiltX));
    const bowl = lathe([
      [0, -0.02], [r * 0.22, -0.01], [r * 0.6, r * 0.16], [r * 0.96, r * 0.42], [r, r * 0.46],
      [r * 0.95, r * 0.47], [r * 0.58, r * 0.22], [r * 0.2, r * 0.06], [0, r * 0.05],
    ], { segments: 28, crease: 40 });
    hard.push({ geometry: xformed(bowl, m), color });
    // Feed on four legs.
    const feedTip = V(0, r * 0.72, 0).applyMatrix4(m).toArray();
    hard.push({ geometry: xformed(ball(r * 0.1, 8), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, r * 0.72, 0))), color: 0x7a7a7a });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const foot = V(Math.sin(a) * r * 0.82, r * 0.34, Math.cos(a) * r * 0.82).applyMatrix4(m).toArray();
      hard.push({ geometry: rod(foot, feedTip, 0.018, { sides: 5 }), color: 0xcfcfcf });
    }
    return V(0, -0.1, 0).applyMatrix4(m);
  };
  {
    const seat = dish(-1.1, Y(7.72), 3.05, 1.0, 0.55, 0.15);
    const foot = [-1.1, Y(6.25), 3.15];
    strut(hard, 0x77797c, [foot, [-1.1, Y(7.0), 3.15], seat.toArray()], 0.11, { sides: 10, detail: 10 });
    hard.push({ geometry: box(1.2, 0.2, 1.2), color: 0x4d4f52, position: foot });
    // The radar's flat electronics drum behind the dish.
    hard.push({ geometry: new THREE.CylinderGeometry(0.3, 0.3, 0.42, 14), color: 0xbfc0c0, position: [-1.1, Y(7.28), 3.08] });
  }
  {
    // The steerable S-band dish, which carried the television picture home, up on its own boom.
    const seat = dish(3.05, Y(7.75), -1.95, 1.05, -0.6, 1.0);
    const foot = [2.2, Y(5.7), -1.6];
    strut(hard, 0x77797c, [foot, [2.75, Y(7.0), -1.8], seat.toArray()], 0.09, { sides: 10, detail: 10 });
  }
  // VHF whip antennas, bent back at the top, and the conical in-flight S-band horns. The tallest
  // whip is the top of the vehicle, at 22 ft 11 in.
  strut(hard, 0xd5d5d5, [[-2.2, Y(5.9), -2.2], [-2.45, Y(9.4), -2.4], [-2.95, Y(12.2), -3.1]], 0.035, { sides: 7, detail: 7 });
  strut(hard, 0xd5d5d5, [[2.0, Y(4.9), -5.4], [2.3, Y(8.0), -5.9], [2.95, Y(9.8), -6.5]], 0.03, { sides: 7, detail: 7 });
  for (const [x, z] of [[1.55, 2.45], [-2.1, -0.4]]) {
    hard.push({ geometry: lathe([[0, 0], [0.34, 0], [0.42, 0.14], [0.2, 0.58], [0, 0.62]], { segments: 12, crease: 40 }), color: 0xd7d4c9, position: [x, Y(6.72), z] });
  }
  // The docking target standing on the roof, for the Command Module pilot to line up on.
  hard.push({ geometry: rod([-2.05, Y(6.72), 1.5], [-2.05, Y(7.75), 1.5], 0.035, { sides: 8 }), color: 0xeeeeee });
  hard.push({ geometry: box(0.62, 0.04, 0.62), color: 0xdddddd, position: [-2.05, Y(7.75), 1.5] });
  hard.push({ geometry: rod([-2.05, Y(7.75), 1.5], [-2.05, Y(8.05), 1.5], 0.03, { sides: 8 }), color: 0x222222 });
  hard.push({ geometry: new THREE.ConeGeometry(0.1, 0.16, 8), color: 0x222222, position: [-2.05, Y(8.1), 1.5] });

  // --- Materials ----------------------------------------------------------------------------
  const FOIL_TILE = 512;
  const foilMap = wrappedCanvas(FOIL_TILE, (ctx, w, h, wrap) => paintFoil(ctx, w, wrap), { repeat: 1 / 6.5 });
  const foilBump = wrappedCanvas(FOIL_TILE, (ctx, w, h, wrap) => paintFoil(ctx, w, wrap, { contrast: 1.2 }), { repeat: 1 / 6.5, data: true });
  const foilMesh = partsMesh(foil, { map: foilMap, bumpMap: foilBump, bumpScale: 1.2, roughness: 0.38, metalness: 0.14 });

  // Panel seams and rivet lines for the cabin, a tile six feet square.
  const panelMap = wrappedCanvas(512, (ctx, w, h, wrap) => {
    const rng = seededRandom(1972);
    ctx.fillStyle = '#efefef';
    ctx.fillRect(0, 0, w, h);
    wrap(() => {
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = rng() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(170,170,170,0.07)';
        ctx.fillRect(rng() * w, rng() * h, 60 + rng() * 160, 40 + rng() * 120);
      }
      ctx.strokeStyle = '#7d7d7d';
      ctx.lineWidth = 1.6;
      for (const y of [0, 170, 342]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (const x of [0, 130, 300, 430]) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      ctx.fillStyle = '#8a8a8a';
      for (const y of [0, 170, 342]) for (let x = 6; x < w; x += 16) { ctx.beginPath(); ctx.arc(x, y + 7, 1.3, 0, TAU); ctx.fill(); }
    });
  }, { repeat: 1 / 6 });
  const platesMesh = partsMesh(plates, { map: panelMap, roughness: 0.56, metalness: 0.28 });

  const hardMesh = partsMesh(hard, { roughness: 0.46, metalness: 0.3 });
  const glassMesh = partsMesh(glass, { roughness: 0.1, metalness: 0.2 });

  // The flag and the country's name on the stage's front, exactly as the crews saw them going down
  // the ladder. Ordinary drawing, no emoji.
  const decalMap = canvasTexture(512, 460, (ctx, w, h) => {
    // The stage's own foil colour as the ground, so this reads as paint on the blanket and not as a
    // card taped to it.
    ctx.fillStyle = '#d9a437';
    ctx.fillRect(0, 0, w, h);
    const fx = 56;
    const fy = 40;
    const fw = w - 112;
    const fh = fw * 0.53;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 ? '#f2f2ee' : '#b22234';
      ctx.fillRect(fx, fy + (i * fh) / 13, fw, fh / 13 + 0.5);
    }
    ctx.fillStyle = '#23305f';
    ctx.fillRect(fx, fy, fw * 0.4, (fh * 7) / 13);
    ctx.fillStyle = '#f5f5f5';
    for (let r = 0; r < 9; r++) {
      const cols = r % 2 ? 5 : 6;
      for (let c = 0; c < cols; c++) {
        const sx = fx + (fw * 0.4 * (c + (r % 2 ? 1 : 0.5))) / 6;
        const sy = fy + ((fh * 7) / 13) * ((r + 0.8) / 10);
        ctx.beginPath();
        ctx.arc(sx, sy, 3.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#16161a';
    let size = 62;
    ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
    while (ctx.measureText('UNITED').width > w - 110 && size > 20) { size -= 2; ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('UNITED', w / 2, fy + fh + 56);
    ctx.fillText('STATES', w / 2, fy + fh + 56 + size * 1.05);
  });
  const decalMesh = partsMesh(decal, { map: decalMap, roughness: 0.65, metalness: 0 });

  const root = new THREE.Group();
  root.add(foilMesh, platesMesh, hardMesh, glassMesh, decalMesh);
  return root;
}

// ===========================================================================================
// MARS ROVER
// ===========================================================================================

// One wheel, with +Y as its outer face, centred on its own axle. Twenty-inch machined aluminium:
// a thin crowned drum with chevron cleats standing on the tread and curved titanium spokes in the
// dished face. The cleats are what a wheel on Mars is recognised by, and they are sunk into the
// drum so none can hang off it.
function roverWheel() {
  const R = 0.86;
  const HW = 0.65;
  const parts = [];
  parts.push({
    geometry: lathe([
      [0, -HW], [0.7, -HW], [R - 0.03, -HW + 0.02], [R, -HW + 0.08], [R, HW - 0.08], [R - 0.02, HW - 0.02], [R - 0.06, HW],
      [R - 0.12, HW], [R - 0.14, HW - 0.14], [0.34, HW - 0.24], [0.26, HW - 0.2], [0.24, HW - 0.04], [0.14, HW + 0.03], [0, HW + 0.05],
    ], { segments: 44, crease: 28 }),
    keepColor: true,
    tint: (p) => {
      const r = Math.hypot(p.x, p.z);
      if (r < 0.34 && p.y > 0) return lin(0x77797c);
      if (p.y > HW - 0.26 && r < R - 0.1) return lin(0x383a3d);
      return lin(0xb9bbbd);
    },
  });
  // Chevrons, two raked bars per cleat, meeting on the tread's centre line. Each bar is bent onto
  // the drum rather than laid across it as a chord: a straight bar on a curve stands off at its far
  // end, and twenty-four of those is a sawtooth round the wheel.
  const COUNT = 24;
  const rake = 34 * DEG;
  for (let i = 0; i < COUNT; i++) {
    const a0 = (i / COUNT) * TAU;
    for (const s of [-1, 1]) {
      const bar = new THREE.BoxGeometry(0.58, 0.07, 0.05, 6, 1, 1);
      bar.translate(0.29, 0, 0);
      const pos = bar.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const z = pos.getZ(k);
        const axial = s * (x * Math.cos(rake) + z * Math.sin(rake));
        const arc = x * Math.sin(rake) - z * Math.cos(rake);
        const r = R + 0.012 + y;
        const a = a0 + arc / R;
        pos.setXYZ(k, Math.sin(a) * r, axial, Math.cos(a) * r);
      }
      // One side of the chevron is a mirror image, so the winding is measured and fixed here.
      const ix = bar.index.array;
      let vol = 0;
      const c = V();
      for (let k = 0; k < pos.count; k++) c.add(V(pos.getX(k), pos.getY(k), pos.getZ(k)));
      c.multiplyScalar(1 / pos.count);
      const pa = V(); const pb = V(); const pc = V();
      for (let k = 0; k < ix.length; k += 3) {
        pa.fromBufferAttribute(pos, ix[k]).sub(c);
        pb.fromBufferAttribute(pos, ix[k + 1]).sub(c);
        pc.fromBufferAttribute(pos, ix[k + 2]).sub(c);
        vol += pa.dot(pb.cross(pc));
      }
      if (vol < 0) for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      bar.computeVertexNormals();
      parts.push({ geometry: bar, color: 0xc4c6c8 });
    }
  }
  // Spokes, curved so they flex over rocks instead of breaking.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const pt = (r, da) => [Math.sin(a + da) * r, HW - 0.15 - (r - 0.26) * 0.03, Math.cos(a + da) * r];
    parts.push({ geometry: pipe([pt(0.25, 0), pt(0.44, 0.2), pt(R - 0.12, 0.26)], [0.03, 0.026, 0.03], { sides: 7, tubular: 9 }), color: 0xd6d7d8 });
  }
  return mergeParts(parts);
}

function buildMarsRover() {
  const body = [];
  const metal = [];
  const dark = [];
  const WHITE = 0xe6e4dd;
  const GREY = 0x8d8f91;
  const TITANIUM = 0xa9abab;
  const JOINT = 0x47494c;
  const GOLD = 0xc9a14a;

  // --- Chassis: the warm electronics box ----------------------------------------------------
  // A long white box with a raked nose. A section with soft corners catches a real highlight along
  // its edge, and the panel joints are grooves in the one surface so they cannot lift off it.
  const BODY_Y = 2.82;
  const chassis = solidLoft([
    { d: -2.75, w: 1.5, up: 0.28, dn: 0.3, b: BODY_Y + 0.1, round: 0.2 },
    { d: -2.62, w: 1.9, up: 0.64, dn: 0.72, b: BODY_Y, round: 0.15 },
    { d: -1, w: 1.92, up: 0.66, dn: 0.74, b: BODY_Y, round: 0.15 },
    { d: 1, w: 1.92, up: 0.66, dn: 0.72, b: BODY_Y, round: 0.15 },
    { d: 2.2, w: 1.84, up: 0.62, dn: 0.62, b: BODY_Y, round: 0.16 },
    { d: 2.72, w: 1.62, up: 0.42, dn: 0.48, b: BODY_Y - 0.02, round: 0.2 },
    { d: 2.86, w: 1.2, up: 0.2, dn: 0.26, b: BODY_Y - 0.02, round: 0.25 },
  ], {
    sides: 44,
    samples: 84,
    warp: (t) => {
      const d = -2.75 + 5.61 * t;
      return grooveAt(d + 1.1, 0.024, 0.025) + grooveAt(d - 0.35, 0.024, 0.025) + grooveAt(d - 1.75, 0.024, 0.025);
    },
  });
  body.push({
    geometry: chassis,
    keepColor: true,
    tint: (p) => {
      if (p.y < BODY_Y - 0.5) return lin(0x77787a);
      return lin(WHITE);
    },
  });

  // Deck plate and instrument mountings. Everything sits in the deck, not on it.
  const DECK_Y = BODY_Y + 0.64;
  body.push({ geometry: box(3.1, 0.1, 4.3), color: 0xc5c3bb, position: [0, DECK_Y, -0.2] });
  for (const [x, z, w, h, d, c] of [
    [-1.05, -1.75, 1.0, 0.34, 1.0, 0xd8d6cf], [1.15, -1.5, 0.9, 0.28, 1.3, 0xbfc0bd], [-1.15, 0.55, 0.8, 0.22, 1.2, 0xcacac4],
    [0.05, 0.55, 0.7, 0.32, 0.9, 0xe0ded7], [0.45, -0.6, 1.0, 0.18, 0.7, 0x9c9e9e], [-0.25, -1.05, 0.5, 0.26, 0.5, 0x8a8c8e],
  ]) {
    body.push({ geometry: box(w, h, d), color: c, position: [x, DECK_Y + h / 2 - 0.02, z] });
  }
  // Grey service panels on the flanks, and a line of louvres, so the sides are not blank white.
  for (const s of [-1, 1]) {
    body.push({ geometry: plateOn([[s * 1.92, BODY_Y + 0.42, -2.3], [s * 1.92, BODY_Y + 0.42, -0.3], [s * 1.92, BODY_Y - 0.38, -0.3], [s * 1.92, BODY_Y - 0.38, -2.3]], V(s, 0, 0), { proud: 0.02, sink: 0.03 }), color: 0xa7a8a6 });
    body.push({ geometry: plateOn([[s * 1.92, BODY_Y + 0.42, 1.4], [s * 1.92, BODY_Y + 0.42, 2.0], [s * 1.92, BODY_Y - 0.38, 2.0], [s * 1.92, BODY_Y - 0.38, 1.4]], V(s, 0, 0), { proud: 0.02, sink: 0.03 }), color: 0xb4b4b0 });
    for (let i = 0; i < 6; i++) {
      dark.push({ geometry: box(0.03, 0.05, 1.55), color: 0x3d3e40, position: [s * 1.945, BODY_Y + 0.3 - i * 0.12, -1.3] });
    }
  }
  // A sundial calibration target on the deck, and the cable run along the edge.
  body.push({ geometry: lathe([[0, 0], [0.34, 0], [0.34, 0.04], [0.26, 0.05], [0.26, 0.13], [0.04, 0.13], [0.04, 0.32], [0, 0.34]], { segments: 18, crease: 40 }), color: 0xd0cdbf, position: [1.05, DECK_Y + 0.02, 0.92] });
  for (const s of [-1, 1]) {
    dark.push({ geometry: pipe([[s * 1.7, DECK_Y + 0.04, -2.2], [s * 1.75, DECK_Y + 0.08, -0.5], [s * 1.7, DECK_Y + 0.08, 1.2], [s * 1.5, DECK_Y + 0.02, 2.2]], [0.035, 0.035, 0.035, 0.035], { sides: 7, tubular: 22 }), color: 0x2b2b2d });
  }

  // Hazard cameras: two stereo pairs low on the nose, and one on the tail.
  for (const [z, sign] of [[2.72, 1], [-2.7, -1]]) {
    for (const x of [-1.15, -0.6, 0.6, 1.15]) {
      const y = BODY_Y - 0.28;
      const m = new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(sign * Math.PI / 2));
      dark.push({ geometry: xformed(lathe([[0, -0.14], [0.11, -0.14], [0.11, 0.08], [0.08, 0.1], [0, 0.11]], { segments: 14, crease: 40 }), m), color: 0x2a2b2e });
    }
  }
  // The sample caching system on the nose: the bit carousel's dome is the big round thing on the
  // front of Perseverance.
  {
    const m = new THREE.Matrix4().makeTranslation(0, BODY_Y + 0.06, 2.72).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.3));
    body.push({ geometry: xformed(lathe([[0, -0.2], [0.72, -0.2], [0.76, 0.04], [0.62, 0.15], [0.3, 0.26], [0, 0.28]], { segments: 34, crease: 30 }), m), color: 0xd4d2ca });
    metal.push({ geometry: xformed(lathe([[0.76, -0.02], [0.8, -0.02], [0.8, 0.06], [0.76, 0.06]], { segments: 34 }), m), color: GOLD });
  }

  // --- Rocker-bogie suspension --------------------------------------------------------------
  // On each side a rocker pivots on the body: its front leg goes to the front wheel, its back leg
  // to the bogie pivot, and the bogie carries the middle and rear wheels. A wheel can climb a rock
  // about its own size with all six still on the ground. Every span is sockets at both ends, so no
  // tube can stop short of the one it meets.
  const WX = 3.55;
  const WR = 0.86;
  const wheelGeo = roverWheel();
  const FZ = 3.55;
  const MZ = -0.05;
  const RZ = -3.45;
  const TUBE = 0.12;
  for (const s of [-1, 1]) {
    const pivot = [s * 2.32, 3.1, 0.75];
    const bogie = [s * 2.72, 2.2, -1.75];
    const front = [s * 3.15, 2.42, FZ];
    const midTop = [s * 2.86, 1.72, MZ];
    const rearTop = [s * 3.15, 2.1, RZ];

    // Differential pivot: a stubby drum from the box out to the rocker.
    metal.push({ geometry: rod([s * 1.7, 3.1, 0.75], pivot, 0.22, { sides: 18 }), color: JOINT });
    metal.push({ geometry: rod([s * 2.2, 3.1, 0.75], [s * 2.5, 3.1, 0.75], 0.3, { sides: 20 }), color: 0x6b6d70 });
    strut(metal, TITANIUM, [pivot, [s * 2.75, 2.82, 2.2], front], TUBE, { sides: 14, detail: 14 });
    strut(metal, TITANIUM, [pivot, [s * 2.55, 2.68, -0.7], bogie], TUBE, { sides: 14, detail: 14 });
    metal.push({ geometry: rod([s * 2.5, 2.2, -1.75], [s * 2.94, 2.2, -1.75], 0.22, { sides: 18 }), color: 0x6b6d70 });
    strut(metal, TITANIUM, [bogie, midTop], TUBE * 0.92, { sides: 14, detail: 14 });
    strut(metal, TITANIUM, [bogie, [s * 2.9, 2.45, -2.6], rearTop], TUBE * 0.92, { sides: 14, detail: 14 });

    // Four corner wheels steer: an actuator barrel directly over the wheel, then a fork arm down
    // the inside to the drive motor. The middle pair drive only and hang straight off the bogie.
    for (const [z, top, steer] of [[FZ, front, true], [MZ, midTop, false], [RZ, rearTop, true]]) {
      const hub = [s * (WX - 0.6), WR, z];
      if (steer) {
        const barrelTop = [s * 3.15, top[1] + 0.26, z];
        const barrelLow = [s * 3.15, top[1] - 0.3, z];
        metal.push({ geometry: rod(barrelLow, barrelTop, 0.2, { sides: 18 }), color: JOINT });
        metal.push({ geometry: lathe([[0, 0], [0.21, 0], [0.21, 0.05], [0.13, 0.1], [0, 0.11]], { segments: 16 }), color: 0x6b6d70, position: barrelTop });
        const fork = [s * 2.72, top[1] - 0.46, z];
        strut(metal, TITANIUM, [barrelLow, fork, [s * 2.66, 1.2, z]], 0.1, { sides: 12, detail: 12, capEnds: true });
        metal.push({ geometry: rod([s * 2.5, WR, z], [s * 2.96, WR, z], 0.2, { sides: 18 }), color: JOINT });
        strut(metal, TITANIUM, [[s * 2.66, 1.2, z], [s * 2.66, WR, z]], 0.1, { sides: 12, detail: 12 });
      } else {
        strut(metal, TITANIUM, [top, [s * 2.76, 1.2, z], [s * 2.76, WR, z]], 0.1, { sides: 12, detail: 12 });
        metal.push({ geometry: rod([s * 2.55, WR, z], [s * 2.96, WR, z], 0.2, { sides: 18 }), color: JOINT });
      }
      // The axle, plugged into the drum's inner face.
      metal.push({ geometry: rod(hub, [s * WX, WR, z], 0.14, { sides: 14 }), color: 0x77797b });

      const m = new THREE.Matrix4().makeTranslation(s * WX, WR, z).multiply(new THREE.Matrix4().makeRotationZ(-s * Math.PI / 2));
      metal.push({ geometry: xformed(wheelGeo, m), keepColor: true });
    }
  }
  // The differential bar over the deck that keeps the rockers opposed, and its links. It is what
  // holds the body at the average of the two sides.
  metal.push({ geometry: rod([-1.55, DECK_Y + 0.12, 1.6], [1.55, DECK_Y + 0.12, 1.6], 0.055, { sides: 10 }), color: 0x6a6c6e });
  metal.push({ geometry: lathe([[0, DECK_Y], [0.16, DECK_Y], [0.16, DECK_Y + 0.14], [0.09, DECK_Y + 0.2], [0, DECK_Y + 0.21]], { segments: 14 }), color: 0x6a6c6e, position: [0, 0, 1.6] });
  for (const s of [-1, 1]) {
    strut(metal, 0x6a6c6e, [[s * 1.55, DECK_Y + 0.12, 1.6], [s * 2.18, 3.25, 1.05], [s * 2.3, 3.12, 0.78]], 0.04, { sides: 8, detail: 8 });
  }

  // --- Remote sensing mast ------------------------------------------------------------------
  const MX = 1.2;
  const MZ_ = 1.85;
  body.push({ geometry: lathe([[0, DECK_Y - 0.05], [0.4, DECK_Y - 0.05], [0.4, DECK_Y + 0.12], [0.26, DECK_Y + 0.22], [0.19, DECK_Y + 0.42], [0, DECK_Y + 0.42]], { segments: 22, crease: 40 }), color: 0xc6c4bd, position: [MX, 0, MZ_] });
  const NECK = 6.08;
  metal.push({ geometry: lathe([[0, DECK_Y + 0.3], [0.15, DECK_Y + 0.3], [0.14, 4.6], [0.125, NECK - 0.12], [0, NECK - 0.12]], { segments: 18, crease: 40 }), color: 0xdedcd5, position: [MX, 0, MZ_] });
  metal.push({ geometry: lathe([[0, NECK - 0.3], [0.22, NECK - 0.3], [0.25, NECK - 0.2], [0.25, NECK + 0.04], [0.2, NECK + 0.12], [0, NECK + 0.12]], { segments: 20, crease: 40 }), color: JOINT, position: [MX, 0, MZ_] });
  const HEAD_Y = 6.82;
  // Elevation yoke, two cheeks up either side of the head and an axle through both.
  for (const s of [-1, 1]) {
    strut(metal, 0xc7c5be, [[MX + s * 0.1, NECK + 0.08, MZ_], [MX + s * 0.62, NECK + 0.22, MZ_], [MX + s * 0.62, HEAD_Y, MZ_]], 0.055, { sides: 10, detail: 10 });
  }
  metal.push({ geometry: rod([MX - 0.68, HEAD_Y, MZ_], [MX + 0.68, HEAD_Y, MZ_], 0.09, { sides: 14 }), color: JOINT });
  // The head: a white block with the big SuperCam eye on top and the two Mastcam-Z eyes below. It
  // is the face of the rover, and every student will look it in the eye.
  const headShell = solidLoft([
    { d: -0.42, w: 0.3, up: 0.18, dn: 0.18, b: HEAD_Y + 0.02, round: 0.3 },
    { d: -0.36, w: 0.52, up: 0.33, dn: 0.32, b: HEAD_Y + 0.02, round: 0.22 },
    { d: 0.28, w: 0.54, up: 0.34, dn: 0.33, b: HEAD_Y + 0.02, round: 0.2 },
    { d: 0.36, w: 0.34, up: 0.2, dn: 0.2, b: HEAD_Y + 0.02, round: 0.3 },
  ], { sides: 28, samples: 14 });
  body.push({ geometry: headShell, color: 0xece9e1, position: [MX, 0, MZ_] });
  const faceZ = MZ_ + 0.31;
  const lens = (x, y, r, depth, tone) => {
    const m = new THREE.Matrix4().makeTranslation(MX + x, y, faceZ).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    dark.push({ geometry: xformed(lathe([[0, -0.08], [r * 1.18, -0.08], [r * 1.18, depth], [r * 1.02, depth + 0.012], [r * 0.82, depth - 0.02], [0, depth - 0.03]], { segments: 22, crease: 40 }), m), color: 0x38393c });
    dark.push({ geometry: xformed(lathe([[0, depth - 0.05], [r * 0.82, depth - 0.05], [r * 0.82, depth - 0.018], [r * 0.3, depth + 0.012], [0, depth + 0.016]], { segments: 20, crease: 60 }), m), color: tone });
  };
  lens(0, HEAD_Y + 0.15, 0.2, 0.17, 0x101826);
  lens(-0.27, HEAD_Y - 0.17, 0.1, 0.13, 0x161f2e);
  lens(0.27, HEAD_Y - 0.17, 0.1, 0.13, 0x161f2e);
  // The navigation cameras either side of the big eye.
  lens(-0.4, HEAD_Y + 0.17, 0.05, 0.08, 0x161f2e);
  lens(0.4, HEAD_Y + 0.17, 0.05, 0.08, 0x161f2e);
  // Wind sensor booms on the mast's own neck.
  for (const s of [-1, 1]) {
    strut(metal, 0x9c9e9f, [[MX, 4.5, MZ_], [MX + s * 0.46, 4.56, MZ_ + 0.1], [MX + s * 0.64, 4.6, MZ_ + 0.1]], 0.022, { sides: 7, detail: 7 });
  }

  // --- The high-gain dish -------------------------------------------------------------------
  // Six-sided, because the real one is. It talks straight to Earth, and the rest of what a rover
  // sends goes up through an orbiter.
  {
    const DX = -1.3;
    const DZ = -0.95;
    const seat = [DX, DECK_Y + 0.72, DZ];
    body.push({ geometry: lathe([[0, DECK_Y - 0.04], [0.25, DECK_Y - 0.04], [0.25, DECK_Y + 0.1], [0.12, DECK_Y + 0.18], [0, DECK_Y + 0.18]], { segments: 14, crease: 40 }), color: 0xbbbab3, position: [DX, 0, DZ] });
    strut(metal, JOINT, [[DX, DECK_Y + 0.1, DZ], [DX, DECK_Y + 0.5, DZ], seat], 0.075, { sides: 10, detail: 10 });
    const m = new THREE.Matrix4().makeTranslation(...seat)
      .multiply(new THREE.Matrix4().makeRotationY(-0.7))
      .multiply(new THREE.Matrix4().makeRotationX(0.78));
    const R = 0.62;
    const dishGeo = lathe([
      [0, 0], [R * 0.3, 0.015], [R * 0.72, 0.06], [R, 0.13], [R * 0.98, 0.17], [R * 0.7, 0.11], [R * 0.3, 0.07], [0, 0.06],
    ], { segments: 6, crease: 28 });
    metal.push({ geometry: xformed(dishGeo, m), color: 0xe4e2db });
    // The feed, on three stays.
    const feed = V(0, 0.52, 0).applyMatrix4(m).toArray();
    metal.push({ geometry: xformed(lathe([[0, 0.05], [0.07, 0.05], [0.09, 0.42], [0.06, 0.52], [0, 0.54]], { segments: 10, crease: 40 }), m), color: 0x77797b });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      metal.push({ geometry: rod(V(Math.sin(a) * 0.45, 0.11, Math.cos(a) * 0.45).applyMatrix4(m).toArray(), feed, 0.012, { sides: 5 }), color: 0xbdbdb8 });
    }
    // The low-gain and UHF antennas, a post and a mushroom.
    metal.push({ geometry: rod([-0.5, DECK_Y, -2.05], [-0.5, DECK_Y + 0.8, -2.05], 0.03, { sides: 8 }), color: 0xbdbdb8 });
    metal.push({ geometry: lathe([[0, 0], [0.11, 0.02], [0.13, 0.08], [0.05, 0.14], [0, 0.15]], { segments: 12, crease: 50 }), color: 0xd8d6cc, position: [-0.5, DECK_Y + 0.78, -2.05] });
    metal.push({ geometry: lathe([[0, DECK_Y - 0.02], [0.2, DECK_Y - 0.02], [0.2, DECK_Y + 0.22], [0.16, DECK_Y + 0.3], [0, DECK_Y + 0.31]], { segments: 14, crease: 40 }), color: 0xc4c2bb, position: [0.9, 0, -2.0] });
  }

  // --- Power: the radioisotope generator on the tail ------------------------------------------
  // Plutonium's decay heat through thermocouples, with no solar panels for dust to bury. Black
  // fins round a drum, carried at a rake clear of the back of the box.
  {
    const P0 = V(0, 2.95, -2.75);
    const axis = V(0, 0.62, -0.78).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, axis);
    const m = new THREE.Matrix4().compose(P0, q, V(1, 1, 1));
    const L = 2.3;
    dark.push({ geometry: xformed(lathe([
      [0, 0.62], [0.42, 0.62], [0.42, 0.72], [0.34, 0.8], [0.34, L - 0.1], [0.42, L - 0.02], [0.42, L + 0.08], [0.36, L + 0.12], [0, L + 0.13],
    ], { segments: 28, crease: 30 }), m), color: 0x55565a });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.39;
      const fin = box(0.46, L - 0.82, 0.05);
      fin.translate(0.46, 0.82 + (L - 0.82) / 2 - 0.02, 0);
      fin.rotateY(a);
      dark.push({ geometry: xformed(fin, m), color: 0x4a4b4f });
    }
    // Two bright bands, and the white-painted cradle and struts holding it to the box.
    for (const f of [1.08, 1.86]) {
      dark.push({ geometry: xformed(lathe([[0.32, f - 0.035], [0.72, f - 0.035], [0.72, f + 0.035], [0.32, f + 0.035]], { segments: 28 }), m), color: 0x8d8f91 });
    }
    const toW = (x, y, z) => V(x, y, z).applyMatrix4(m).toArray();
    for (const s of [-1, 1]) {
      strut(body, 0xdedcd5, [[s * 1.1, 3.2, -2.45], toW(s * 0.33, 0.7, 0)], 0.07, { sides: 10, detail: 10 });
      strut(body, 0xdedcd5, [[s * 1.2, 2.45, -2.45], toW(s * 0.33, 0.9, 0)], 0.07, { sides: 10, detail: 10 });
    }
    body.push({ geometry: rod(toW(0, 0.2, 0), toW(0, 0.7, 0), 0.26, { sides: 18 }), color: 0xcfcdc5 });
  }

  // --- The robotic arm ------------------------------------------------------------------------
  // Seven feet long with five joints. A motor drum at each joint and a thin boom between them, so
  // it reads as a machine's arm and not a garden hose.
  {
    const ARM = 0xd3d1ca;
    const drum = (a, b, r) => dark.push({ geometry: rod(a, b, r, { sides: 18 }), color: JOINT });
    const S0 = [-0.95, BODY_Y + 0.2, 2.72];
    const S1 = [-0.95, BODY_Y + 0.82, 3.12];
    const E = [-1.9, 5.82, 3.35];
    const W = [-0.55, 4.28, 5.05];
    const W2 = [-0.5, 3.86, 5.12];
    // Shoulder azimuth, mounted on the nose.
    body.push({ geometry: box(0.7, 0.5, 0.42), color: 0xc9c7c0, position: [-0.95, BODY_Y + 0.1, 2.66] });
    drum([-0.95, BODY_Y + 0.08, 2.9], [-0.95, BODY_Y + 0.62, 2.98], 0.2);
    metal.push({ geometry: rod(S0, S1, 0.13, { sides: 14 }), color: ARM });
    // Shoulder elevation, a drum across the arm's line.
    drum([-1.25, S1[1], S1[2]], [-0.65, S1[1], S1[2]], 0.21);
    // Upper arm, thickest at the shoulder.
    metal.push({ geometry: rod(S1, E, 0.125, { r2: 0.095, sides: 16 }), color: ARM });
    // Elbow.
    drum([E[0] - 0.24, E[1] - 0.06, E[2] - 0.12], [E[0] + 0.24, E[1] + 0.06, E[2] + 0.12], 0.19);
    metal.push({ geometry: rod(E, W, 0.095, { r2: 0.08, sides: 16 }), color: ARM });
    // Cables ride outside the booms, in gold, loose enough to bend.
    const ca = (a, b, f, x) => [a[0] + (b[0] - a[0]) * f + x, a[1] + (b[1] - a[1]) * f + 0.11, a[2] + (b[2] - a[2]) * f];
    dark.push({ geometry: pipe([ca(S1, E, 0.02, 0.08), ca(S1, E, 0.5, 0.11), ca(S1, E, 0.98, 0.06)], [0.028, 0.028, 0.028], { sides: 7, tubular: 14 }), color: GOLD });
    dark.push({ geometry: pipe([ca(E, W, 0.02, 0.05), ca(E, W, 0.5, 0.1), ca(E, W, 0.98, 0.06)], [0.024, 0.024, 0.024], { sides: 7, tubular: 14 }), color: GOLD });
    // Wrist: two more drums at right angles.
    drum([W[0] - 0.17, W[1], W[2] - 0.05], [W[0] + 0.17, W[1], W[2] + 0.05], 0.14);
    drum(W, W2, 0.13);
    // The turret, a 100-pound cluster of tools round a hub that spins to choose one: the coring
    // drill pointing down, with the two science instruments, the camera and the gas tool.
    const hub = [W2[0], W2[1] - 0.12, W2[2]];
    dark.push({ geometry: ball(0.36, 20), color: 0x5c5e61, position: hub });
    const tool = (dir, len, r, color, tip = null) => {
      const d = V(...dir).normalize();
      const e = V(...hub).addScaledVector(d, len).toArray();
      metal.push({ geometry: rod(hub, e, r, { r2: r * 0.86, sides: 14 }), color });
      metal.push({ geometry: ball(r * 0.88, 12), color, position: e });
      return { e, d };
    };
    // Coring drill: a fat body, a chuck and a spiral bit.
    const drill = tool([0, -1, 0.06], 0.86, 0.2, 0xe0ded6);
    const chuck = V(...drill.e).addScaledVector(drill.d, 0.2).toArray();
    dark.push({ geometry: rod(drill.e, chuck, 0.1, { r2: 0.08, sides: 12 }), color: 0x77797b });
    const bitEnd = V(...chuck).addScaledVector(drill.d, 0.44).toArray();
    dark.push({ geometry: rod(chuck, bitEnd, 0.04, { r2: 0.03, sides: 9 }), color: 0xaeb0b2 });
    // A stabiliser fork either side of the drill, the two prongs it braces against rock with.
    for (const s of [-1, 1]) {
      strut(metal, 0xb6b4ad, [[hub[0] + s * 0.16, hub[1] - 0.66, hub[2]], [hub[0] + s * 0.34, hub[1] - 1.06, hub[2] + 0.06], [hub[0] + s * 0.34, hub[1] - 1.34, hub[2] + 0.06]], 0.024, { sides: 7, detail: 7 });
    }
    const pixl = tool([0.9, -0.15, 0.25], 0.72, 0.19, 0xc7c5bd);
    const sherloc = tool([-0.9, -0.1, 0.3], 0.7, 0.18, 0xb9b7af);
    const gas = tool([0.15, 0.1, 1], 0.62, 0.13, 0xd3d1ca);
    for (const t of [pixl, sherloc, gas]) {
      const m = new THREE.Matrix4().compose(V(...t.e), new THREE.Quaternion().setFromUnitVectors(UP, t.d), V(1, 1, 1));
      dark.push({ geometry: xformed(lathe([[0, 0], [0.11, 0], [0.11, 0.15], [0.08, 0.17], [0, 0.18]], { segments: 12, crease: 40 }), m), color: 0x18202b });
    }
  }

  const root = new THREE.Group();
  root.add(partsMesh(body, { roughness: 0.62, metalness: 0.02 }));
  root.add(partsMesh(metal, { roughness: 0.42, metalness: 0.24 }));
  root.add(partsMesh(dark, { roughness: 0.38, metalness: 0.2 }));
  return root;
}

// ===========================================================================================
// SATURN V
// ===========================================================================================

// A solid of revolution whose UVs are the cylindrical projection the rocket's paint is drawn in:
// u runs once round with +Z at the middle of the sheet, v is height. A shared seam column would
// smear the last strip of the sheet, so it is duplicated, and toCreasedNormals welds its normals
// by position so nothing shows.
function paintedLathe(profile, height, { segments = 72, crease = 24 } = {}) {
  const n = profile.length;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let c = 0; c <= segments; c++) {
    const a = -Math.PI + (c / segments) * TAU;
    for (const [r, y] of profile) {
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(c / segments, y / height);
    }
  }
  for (let c = 0; c < segments; c++) {
    for (let i = 0; i < n - 1; i++) {
      const p = c * n + i;
      const q = p + 1;
      const s = (c + 1) * n + i + 1;
      const t = (c + 1) * n + i;
      // A profile written bottom-up, as this one is, has to be wound the other way from revolve's.
      idx.push(p, s, q, p, t, s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return toCreasedNormals(g, crease * DEG);
}

// Stations in true feet from the engine exits. These are the real stage lengths: 138 ft for the
// S-IC with its engines, 81.5 for the S-II, 58.6 for the S-IVB.
const SV = {
  H: 363, BASE: 14, THRUST: 33, FUEL: 70, INTERTANK: 88, LOX: 128, S1TOP: 138,
  S2BASE: 156, S2TOP: 219.5, CONE: 238, S4AFT: 248, S4TOP: 278.1, IU: 281.1, SLA: 309.1,
  SM: 324.7, CM: 335.3, R1: 16.5, R3: 10.85, R5: 6.42,
};

function paintSaturnSkin(ctx, w, h) {
  const Y = (y) => (1 - y / SV.H) * h;
  const band = (y0, y1, color) => { ctx.fillStyle = color; ctx.fillRect(0, Y(y1), w, Y(y0) - Y(y1)); };
  // White, not quite pure, since a pure white clips under a bright sun.
  ctx.fillStyle = '#eceae3';
  ctx.fillRect(0, 0, w, h);

  // Roll patterns: black and white panels so the ground cameras could see the rocket turning.
  const stripes = (y0, y1, count, offset = 0, duty = 0.5) => {
    ctx.fillStyle = '#17171a';
    for (let i = -1; i < count + 1; i++) {
      const x = ((i + offset) / count) * w;
      ctx.fillRect(x, Y(y1), (w / count) * duty, Y(y0) - Y(y1));
    }
  };
  // S-IC. Bottom thrust ring in alternating quarters; two broad stripes up the fuel tank, on the
  // flanks so USA has the clear white sides to itself; eight panels round the intertank and four
  // round the skirt at the top.
  stripes(SV.BASE, SV.THRUST, 4, 0.125);
  stripes(SV.THRUST, SV.FUEL, 2, 0.1875, 0.25);
  stripes(SV.FUEL, SV.INTERTANK, 8, 0);
  stripes(SV.LOX, SV.S1TOP, 4, 0.125);
  // S-II: its own interstage carries the panels, and the tank above it is white.
  stripes(SV.S1TOP, SV.S2BASE, 8, 0.5);
  band(SV.S2TOP - 2, SV.S2TOP, '#2e2e31');
  // S-IVB: two black quarters round its aft skirt and down the sides of the tank.
  stripes(SV.CONE, SV.S4AFT, 4, 0.125);
  stripes(SV.S4AFT, SV.S4TOP - 4, 2, 0.1875, 0.125);
  // The Instrument Unit, the guidance ring, and the panel lines of the spacecraft adapter.
  band(SV.S4TOP, SV.IU, '#b9b7ae');
  ctx.strokeStyle = 'rgba(70,70,70,0.65)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const x = ((i + 0.5) / 4) * w;
    ctx.beginPath();
    ctx.moveTo(x, Y(SV.IU));
    ctx.lineTo(x, Y(SV.SLA));
    ctx.stroke();
  }
  // Service Module in silvered paint, with a line of radiator panels, under the white cover over
  // the Command Module.
  band(SV.SLA, SV.SM, '#b6b8ba');
  ctx.fillStyle = 'rgba(70,72,76,0.22)';
  for (let i = 0; i < 24; i++) ctx.fillRect((i / 24) * w, Y(SV.SM - 2), w / 48, Y(SV.SLA + 3) - Y(SV.SM - 2));
  band(SV.SM, SV.CM + 2, '#f0eee8');

  // Station lines, thin rings where one section bolted to the next.
  ctx.fillStyle = 'rgba(30,30,34,0.5)';
  for (const y of [SV.THRUST, SV.FUEL, SV.INTERTANK, SV.LOX, SV.S1TOP, SV.S2BASE, SV.S2TOP, SV.CONE, SV.S4AFT, SV.S4TOP]) ctx.fillRect(0, Y(y) - 1, w, 2);
  ctx.fillStyle = 'rgba(30,30,34,0.22)';
  for (const y of [45, 58, 100, 114, 170, 185, 200, 258, 268]) ctx.fillRect(0, Y(y) - 0.5, w, 1);

  // Stringers on the corrugated sections, drawn into the colour as well as the bump, since they
  // have to show on the black panels and from a long way off.
  const ribs = (y0, y1, count) => {
    for (let i = 0; i < count; i++) {
      const x = (i / count) * w;
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(x, Y(y1), 1.3, Y(y0) - Y(y1));
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + 1.3, Y(y1), 1.3, Y(y0) - Y(y1));
    }
  };
  for (const [a, b, n] of [[SV.BASE, SV.THRUST, 120], [SV.FUEL, SV.INTERTANK, 120], [SV.LOX, SV.S1TOP, 120], [SV.S1TOP, SV.S2BASE, 120], [SV.S2TOP - 8, SV.S2TOP, 120], [SV.S2TOP, SV.CONE, 100], [SV.CONE, SV.S4AFT, 90]]) ribs(a, b, n);

  // The lettering, stacked upright down the white of the upper tank on both sides, and the flag
  // above each. The sheet stretches height and width by different amounts, so everything is drawn
  // through a scale that makes one foot square here.
  const pxPerFtX = w / (TAU * SV.R1);
  const pxPerFtY = h / SV.H;
  for (const u of [0.5, 0]) {
    const cx = u * w;
    const letters = ['U', 'S', 'A'];
    letters.forEach((ch, i) => {
      const yFt = 121 - i * 11.6;
      for (const shift of u === 0 ? [0, w] : [0]) {
        ctx.save();
        ctx.translate(cx + shift, Y(yFt));
        ctx.scale(pxPerFtX, pxPerFtY);
        ctx.fillStyle = '#b02a2c';
        ctx.font = 'bold 13px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Fit by measuring: each letter stays inside ten feet of arc.
        const m = ctx.measureText(ch).width;
        const fit = m > 10 ? 10 / m : 1;
        ctx.scale(fit, 1);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
    });
  }
}

// The bump is drawn apart from the paint, or every black stripe's edge would emboss as a step.
function paintSaturnBump(ctx, w, h) {
  const Y = (y) => (1 - y / SV.H) * h;
  ctx.fillStyle = '#909090';
  ctx.fillRect(0, 0, w, h);
  const ribs = (y0, y1, count) => {
    for (let i = 0; i < count; i++) {
      const x = (i / count) * w;
      const pitch = w / count;
      const g = ctx.createLinearGradient(x, 0, x + pitch, 0);
      g.addColorStop(0, '#3a3a3a');
      g.addColorStop(0.5, '#e0e0e0');
      g.addColorStop(1, '#3a3a3a');
      ctx.fillStyle = g;
      ctx.fillRect(x, Y(y1), pitch, Y(y0) - Y(y1));
    }
  };
  for (const [a, b, n] of [[SV.BASE, SV.THRUST, 120], [SV.FUEL, SV.INTERTANK, 120], [SV.LOX, SV.S1TOP, 120], [SV.S1TOP, SV.S2BASE, 120], [SV.S2TOP - 8, SV.S2TOP, 120], [SV.S2TOP, SV.CONE, 100], [SV.CONE, SV.S4AFT, 90]]) ribs(a, b, n);
  ctx.fillStyle = '#2a2a2a';
  for (const y of [45, 58, 100, 114, 170, 185, 200, 258, 268]) ctx.fillRect(0, Y(y) - 1, w, 2);
}

function f1Bell(parts, x, z) {
  // Twelve feet across the mouth, flared from a throat barely three feet wide, in a real bell curve:
  // fast near the throat and nearly straight at the lip. It is what a student at six feet is
  // standing under, so it gets the hat bands and the fat turbine-exhaust manifold. The inner wall is
  // a second surface, so a look up the bell sees into it and not into nothing.
  const contour = [[6.15, 0], [5.55, 2.5], [4.9, 5], [4.1, 8], [3.1, 11], [2.1, 13.2], [1.75, 15.5]];
  const outerAt = (y) => {
    for (let i = 0; i < contour.length - 1; i++) {
      const [r0, y0] = contour[i];
      const [r1, y1] = contour[i + 1];
      if (y <= y1) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
    }
    return contour[contour.length - 1][0];
  };
  const body = lathe([
    [0, 15.5], [1.75, 15.5], ...contour.slice(0, -1).reverse().map(([r, y]) => [r, y]),
    [5.98, 0.02], [5.4, 2.5], [4.75, 5], [3.95, 8], [2.95, 11], [1.9, 13], [1.2, 13.6], [0, 13.8],
  ], { segments: 44, crease: 34 });
  parts.push({
    geometry: body,
    keepColor: true,
    position: [x, 0, z],
    tint: (p) => {
      const r = Math.hypot(p.x, p.z);
      return r < outerAt(p.y) - 0.09 ? lin(0x1b1918) : lin(0x55534f);
    },
  });
  for (const y of [1.3, 2.9, 4.5, 6.1, 7.6]) {
    const r = outerAt(y);
    parts.push({ geometry: lathe([[r - 0.14, y - 0.16], [r + 0.1, y - 0.11], [r + 0.1, y + 0.11], [r - 0.14, y + 0.16]], { segments: 44 }), color: 0x7a7872, position: [x, 0, z] });
  }
  {
    const r = outerAt(9.4);
    parts.push({ geometry: lathe([[r - 0.2, 8.7], [r + 0.4, 8.75], [r + 0.72, 9.4], [r + 0.4, 10.05], [r - 0.3, 10.15]], { segments: 40, crease: 50 }), color: 0x8c8a84, position: [x, 0, z] });
  }
}

function buildSaturnV() {
  const { BASE, THRUST, FUEL, INTERTANK, LOX, S1TOP, S2BASE, S2TOP, CONE, S4AFT, S4TOP, IU, SLA, SM, CM, R1, R3, R5 } = SV;
  // The whole stack is one profile, because the only thing a round tall object has is its outline.
  // Each station has a proud ring, a real step you can see from the ground.
  const ring = (y, r, proud = 0.3, half = 0.45) => [[r, y - half * 1.3], [r + proud, y - half], [r + proud, y + half], [r, y + half * 1.3]];
  const profile = [
    [0.01, BASE], [R1 - 3, BASE], [R1, BASE + 0.4],
    ...ring(THRUST, R1),
    ...ring(FUEL, R1, 0.25),
    ...ring(INTERTANK, R1, 0.25),
    ...ring(LOX, R1, 0.25),
    ...ring(S1TOP, R1, 0.42),
    ...ring(S2BASE, R1, 0.34),
    [R1, S2TOP - 8], [R1 + 0.16, S2TOP - 7.6], [R1 + 0.16, S2TOP - 0.5], [R1, S2TOP],
    // The conical interstage up to the third stage's much narrower body.
    [R3 + 0.1, CONE - 0.5], [R3 + 0.3, CONE - 0.1], [R3 + 0.3, CONE + 0.4], [R3, CONE + 0.8],
    ...ring(S4AFT, R3, 0.18, 0.35),
    ...ring(S4TOP, R3, 0.2, 0.3),
    [R3 + 0.1, IU], [R3 - 0.02, IU + 0.2],
    // The tapered adapter that carried the Lunar Module, folded away inside it.
    [R5 + 0.1, SLA - 0.2], [R5, SLA],
    [R5 + 0.1, SLA + 0.3], [R5 + 0.1, SM - 0.3], [R5 - 0.15, SM],
    // The cone is the Command Module under the white cover that kept the rocket's exhaust off it.
    [5.1, SM + 2.4], [3.6, SM + 5.4], [2.2, SM + 8.2], [1.3, CM], [0.4, CM + 0.3], [0.01, CM + 0.4],
  ];
  const skinGeo = paintedLathe(profile, SV.H, { segments: 84, crease: 22 });
  const skinMap = canvasTexture(1024, 2048, paintSaturnSkin);
  const skinBump = canvasTexture(512, 1024, paintSaturnBump);
  skinBump.colorSpace = THREE.NoColorSpace;
  const skin = mesh(skinGeo, standard({ map: skinMap, bumpMap: skinBump, bumpScale: 2.5, roughness: 0.55, metalness: 0 }));

  const dark = [];
  const white = [];

  // Four outer F-1s on the 32-foot circle at the diagonals, one in the middle.
  const ENGINE_R = 16;
  const engines = [[0, 0]];
  for (let i = 0; i < 4; i++) {
    const a = ((i + 0.5) / 4) * TAU;
    engines.push([Math.sin(a) * ENGINE_R, Math.cos(a) * ENGINE_R]);
  }
  for (const [x, z] of engines) f1Bell(dark, x, z);
  // The base heat shield, black, closing everything in behind the engines.
  dark.push({ geometry: lathe([[0, BASE - 0.1], [R1 + 0.1, BASE - 0.1], [R1 + 0.1, BASE + 0.1], [0, BASE + 0.1]], { segments: 44 }), color: 0x1e1e20 });

  // Each outer engine sits under a streamlined fairing, and a fin stands on the fairing's back.
  for (let i = 0; i < 4; i++) {
    const a = ((i + 0.5) / 4) * TAU;
    const ex = Math.sin(a);
    const ez = Math.cos(a);
    // The fairing: a cone leaning into the tank, whose tip goes inside it. Sheared in the frame
    // so the tip's axis meets the wall rather than standing clear of it.
    const fair = lathe([[0, 41], [1.1, 40.4], [3.6, 32], [5.7, 24], [7.0, 17], [7.3, 14], [6.6, 13.5], [0, 13.5]], { segments: 40, crease: 40 });
    const pos = fair.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      const inward = clamp01((y - 14) / 27) * 2.2;
      pos.setXYZ(k, pos.getX(k) - ex * inward, y, pos.getZ(k) - ez * inward);
    }
    fair.computeVertexNormals();
    // White outside, black under the skirt, where it faces the engine's own flame.
    white.push({ geometry: fair, position: [ex * 15.2, 0, ez * 15.2], keepColor: true, tint: (p) => (p.y < 14.05 ? lin(0x1e1e20) : lin(0xe9e7e0)) });
    // A retro-rocket pod either side of each fairing.
    const tx = -ez;
    const tz = ex;
    for (const s of [-1, 1]) {
      const px = ex * 19.5 + tx * s * 6;
      const pz = ez * 19.5 + tz * s * 6;
      const pod = lathe([[0, 14.2], [0.9, 14.2], [0.9, 20.5], [0.5, 23], [0, 23.4]], { segments: 14, crease: 40 });
      dark.push({ geometry: pod, position: [px - ex * 0.8, 0, pz - ez * 0.8], color: 0x2c2c2e });
    }
    // The fin: a swept trapezoid with a diamond section, its root buried in the fairing. Black,
    // as the Saturn's fins were.
    const rootIn = 17.5;
    const tipOut = 31.5;
    const FINW = 1.0;
    const P = (o, y, t) => [ex * o + tx * t, y, ez * o + tz * t];
    const fin = facetSolid([
      P(rootIn, 14.5, 0), P(rootIn, 34, 0), P(tipOut, 19, 0), P(tipOut, 14.5, 0),
      P(rootIn + 1.2, 16, FINW), P(rootIn + 1.2, 31, FINW),
      P(rootIn + 1.2, 16, -FINW), P(rootIn + 1.2, 31, -FINW),
    ], [
      [0, 1, 5, 4], [1, 2, 5], [2, 3, 4, 5], [3, 0, 4],
      [0, 1, 7, 6], [1, 2, 7], [2, 3, 6, 7], [3, 0, 6],
    ]);
    dark.push({ geometry: fin, color: 0x202022 });
  }

  // Eight ullage motors round the bottom of the second stage's interstage, and two black
  // attitude-control pods on the third stage's aft skirt.
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * TAU;
    const m = new THREE.Matrix4().makeTranslation(Math.sin(a) * (R1 + 0.2), 0, Math.cos(a) * (R1 + 0.2));
    dark.push({ geometry: xformed(lathe([[0, 141], [0.9, 141], [0.9, 150], [0.4, 152], [0, 152.2]], { segments: 12, crease: 40 }), m), color: 0x4a4a4c });
  }
  for (const s of [-1, 1]) {
    const plate = facetSolid([
      [s * (R3 - 0.4), 240, -3.2], [s * (R3 - 0.4), 240, 3.2], [s * (R3 - 0.4), 247, 2.2], [s * (R3 - 0.4), 247, -2.2],
      [s * (R3 + 1.9), 240.8, -2.3], [s * (R3 + 1.9), 240.8, 2.3], [s * (R3 + 1.9), 245.4, 1.6], [s * (R3 + 1.9), 245.4, -1.6],
    ], [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]);
    dark.push({ geometry: plate, color: 0x202022 });
  }

  // The launch escape tower: a red-orange truss, a thick motor and a small canard nose. It pulled
  // the crew clear in an abort and was thrown away when it was no longer needed.
  const TRUSS = 0xc75a26;
  const trussBase = CM + 0.1;
  const trussTop = 345.5;
  const fourAt = (y, r) => [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * TAU + Math.PI / 4;
    return [Math.sin(a) * r, y, Math.cos(a) * r];
  });
  const lower = fourAt(trussBase, 1.7);
  const upper = fourAt(trussTop, 1.25);
  for (let i = 0; i < 4; i++) {
    dark.push({ geometry: rod(lower[i], upper[i], 0.15, { sides: 8 }), color: TRUSS });
    dark.push({ geometry: rod(lower[i], upper[(i + 1) % 4], 0.09, { sides: 6 }), color: TRUSS });
    dark.push({ geometry: rod(upper[i], upper[(i + 1) % 4], 0.11, { sides: 6 }), color: TRUSS });
    dark.push({ geometry: rod(lower[i], lower[(i + 1) % 4], 0.11, { sides: 6 }), color: TRUSS });
  }
  white.push({
    geometry: lathe([
      [0, trussTop - 0.4], [1.7, trussTop - 0.4], [1.75, trussTop + 0.5], [1.3, trussTop + 1.1], [1.3, 355.4], [1.1, 356], [1.0, 358], [0.68, 360.2], [0.4, 361.8], [0.16, 362.8], [0, 363],
    ], { segments: 28, crease: 30 }),
    keepColor: true,
    tint: (p) => (p.y > 358 ? lin(0x1d1d1f) : p.y > 355.4 ? lin(0xc75a26) : lin(0xebe9e2)),
  });
  // The exhaust nozzles pointing back along the motor, four small canted bells.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const m = new THREE.Matrix4().makeTranslation(Math.sin(a) * 1.15, trussTop + 0.3, Math.cos(a) * 1.15)
      .multiply(new THREE.Matrix4().makeRotationAxis(V(Math.cos(a), 0, -Math.sin(a)), Math.PI - 0.5));
    dark.push({ geometry: xformed(thrusterBell(1.2, 0.5), m), color: 0x46464a });
  }

  const root = new THREE.Group();
  root.add(skin);
  root.add(partsMesh(dark, { roughness: 0.5, metalness: 0.12 }));
  root.add(partsMesh(white, { roughness: 0.55, metalness: 0 }));
  return root;
}

// ===========================================================================================
// AMETHYST GEODE
// ===========================================================================================

function buildAmethystGeode() {
  const rng = seededRandom(2718);
  const C = V(0, 2.9, 0);
  // The opening faces +Z and tips up a little, so a five-foot eye looks into it and not across it.
  const D = V(0, Math.sin(16 * DEG), Math.cos(16 * DEG));
  const E1 = V(1, 0, 0);
  const E2 = D.clone().cross(E1).normalize();
  const dirAt = (theta, phi) => D.clone().multiplyScalar(Math.cos(theta))
    .addScaledVector(E1, Math.sin(theta) * Math.cos(phi))
    .addScaledVector(E2, Math.sin(theta) * Math.sin(phi));

  // The rock is broken, not worn, so its surface is the support function of a jittered polyhedron
  // plus a lobe field: flat fracture faces and blunt arrises. A pure function of direction, so a
  // shared corner lands in one place from every triangle.
  const planes = [];
  const FACETS = 16;
  for (let i = 0; i < FACETS; i++) {
    const yy = 1 - ((i + 0.5) / FACETS) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = i * 2.399963229728653;
    const n = V(Math.cos(a) * rr + (rng() - 0.5) * 0.5, yy + (rng() - 0.5) * 0.5, Math.sin(a) * rr + (rng() - 0.5) * 0.5).normalize();
    planes.push({ n, h: randomIn(rng, 0.8, 1.02) });
  }
  const cavityRadius = (d) => 2.6 * (1 + (smoothNoise3(d.x * 1.6 + 11, d.y * 1.6, d.z * 1.6) - 0.5) * 0.14);
  const rockRadius = (d) => {
    let poly = 1.5;
    for (const pl of planes) {
      const dot = d.dot(pl.n);
      if (dot > 1e-3) poly = Math.min(poly, pl.h / dot);
    }
    const lobe = 1 + (smoothNoise3(d.x * 1.3 + 7, d.y * 1.3, d.z * 1.3) - 0.5) * 0.22;
    const pit = (smoothNoise3(d.x * 7 + 3, d.y * 7, d.z * 7) - 0.5) * 0.06 + (smoothNoise3(d.x * 3.2 + 1, d.y * 3.2, d.z * 3.2) - 0.5) * 0.08;
    // Never thinner than a real shell, or the crystals' feet come out through a fracture flat.
    return Math.max(3.15 * (0.35 + 0.65 * poly) * lobe * (1 + pit), cavityRadius(d) + 0.3);
  };
  const rockPoint = (d) => {
    const p = C.clone().addScaledVector(d, rockRadius(d));
    p.y = Math.max(p.y, -0.03); // the base is flat, where it settled
    return p;
  };
  const cavityPoint = (d) => C.clone().addScaledVector(d, cavityRadius(d));

  // Where it broke: a torn edge running round the opening. Periodic in phi so it closes on itself.
  const p1 = rng() * TAU; const p2 = rng() * TAU; const p3 = rng() * TAU; const p4 = rng() * TAU;
  const rimTheta = (phi) => (46 + 4.5 * Math.sin(phi * 2 + p1) + 3 * Math.sin(phi * 3 + p2) + 2 * Math.sin(phi * 5 + p3)
    + 1.5 * Math.abs(Math.sin(phi * 7 + p4)) + 1 * Math.sin(phi * 13 + p1)) * DEG;
  const lipTheta = (phi) => rimTheta(phi) + (1.5 + 1 * Math.sin(phi * 4 + p2)) * DEG;

  // Outer rock and the cavity's wall are one mesh, wound so the shell is a solid with the hollow
  // subtracted from it. Each is a polar grid hung from its edge round the opening.
  const COLS = 144;
  const grid = (rows, point, { flip = false }) => {
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= COLS; j++) {
        const p = point(i / rows, (j / COLS) * TAU);
        pos.push(p.x, p.y, p.z);
        // Projected on the skew, not wrapped round the opening's axis, or the grain all converges
        // on the back of the rock in a visible star.
        uv.push((p.x * 0.9 + p.z * 0.5) / 2.2, (p.y * 0.9 + p.z * 0.35) / 2.2);
      }
    }
    const ring = COLS + 1;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < COLS; j++) {
        const a = i * ring + j;
        const b = a + 1;
        const c = a + ring;
        const d = c + 1;
        if (flip) idx.push(a, c, d, a, d, b);
        else idx.push(a, d, c, a, b, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  const shellFrom = (phi, f) => rimTheta(phi) + (Math.PI - rimTheta(phi)) * f;
  const outer = grid(54, (f, phi) => rockPoint(dirAt(shellFrom(phi, f), phi)), { flip: true });
  outer.computeVertexNormals();
  const outerCreased = toCreasedNormals(outer, 44 * DEG);
  const liner = (phi, f) => lipTheta(phi) + (Math.PI - lipTheta(phi)) * f;
  const wall = grid(30, (f, phi) => cavityPoint(dirAt(liner(phi, f), phi)), { flip: false });
  wall.computeVertexNormals();

  const ROCK_DARK = lin(0x45423f);
  const ROCK_MID = lin(0x66625d);
  const ROCK_RUST = lin(0x5e4a39);
  const shell = [];
  shell.push({
    geometry: outerCreased,
    keepColor: true,
    tint: (p) => {
      const n1 = smoothNoise3(p.x * 0.8 + 3, p.y * 0.8, p.z * 0.8);
      const n2 = smoothNoise3(p.x * 2.1, p.y * 2.1 + 5, p.z * 2.1);
      let col = mix3(ROCK_DARK, ROCK_MID, clamp01((n1 - 0.3) * 2.4));
      col = mix3(col, ROCK_RUST, clamp01((n2 - 0.6) * 3));
      // Damp earth at the foot.
      const foot = clamp01(1 - p.y / 1.2);
      return [col[0] * (1 - foot * 0.3), col[1] * (1 - foot * 0.32), col[2] * (1 - foot * 0.34)];
    },
  });
  shell.push({
    geometry: wall,
    keepColor: true,
    // Pale chalcedony behind the crystals: it only shows in the gaps and round the edge.
    tint: (p) => {
      const d = p.clone().sub(C).normalize().dot(D);
      const n = smoothNoise3(p.x * 2.4, p.y * 2.4, p.z * 2.4);
      const edge = clamp01((d - 0.1) * 2);
      const gloom = 1 - 0.7 * clamp01(-d);
      const col = mix3(mix3(lin(0x4a3d5e), lin(0x6d5f85), n), lin(0xb7b0c6), edge);
      return [col[0] * gloom, col[1] * gloom, col[2] * gloom];
    },
  });

  // The agate rim, a closed strip from the outer rock to the cavity's wall with the bands in a
  // texture: a band a tenth of an inch wide is far below what a vertex tint could draw.
  const RIM_ROWS = 7;
  const rimPos = [];
  const rimUv = [];
  const rimIdx = [];
  for (let i = 0; i <= RIM_ROWS; i++) {
    const f = i / RIM_ROWS;
    for (let j = 0; j <= COLS; j++) {
      const phi = (j / COLS) * TAU;
      const a = rockPoint(dirAt(rimTheta(phi), phi));
      const b = cavityPoint(dirAt(lipTheta(phi), phi));
      const p = a.clone().lerp(b, f);
      // A broken surface is rough, but it must not move at the two edges it shares.
      const lump = Math.sin(Math.PI * f) * ((smoothNoise3(p.x * 3.4, p.y * 3.4, p.z * 3.4) - 0.5) * 0.16);
      p.addScaledVector(D, lump);
      rimPos.push(p.x, p.y, p.z);
      rimUv.push((j / COLS) * 2, f);
    }
  }
  const rr = COLS + 1;
  for (let i = 0; i < RIM_ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * rr + j;
      const b = a + 1;
      const c = a + rr;
      const d = c + 1;
      rimIdx.push(a, d, c, a, b, d);
    }
  }
  const rimGeo = new THREE.BufferGeometry();
  rimGeo.setIndex(rimIdx);
  rimGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
  rimGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rimUv, 2));
  rimGeo.computeVertexNormals();
  // The strip's far side, buried in the shell, makes the rim a closed ring and not a loose band.
  const backPos = [];
  const backUv = [];
  const backIdx = [];
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= COLS; j++) {
      const phi = (j / COLS) * TAU;
      const a = rockPoint(dirAt(rimTheta(phi), phi));
      const b = cavityPoint(dirAt(lipTheta(phi), phi));
      const apex = a.clone().lerp(b, 0.5).sub(C).multiplyScalar(0.97).add(C).addScaledVector(D, -0.22);
      const p = i === 0 ? b : i === 1 ? apex : a;
      backPos.push(p.x, p.y, p.z);
      backUv.push((j / COLS) * 2, 0.5);
    }
  }
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < COLS; j++) {
      const a = i * rr + j;
      const b = a + 1;
      const c = a + rr;
      const d = c + 1;
      backIdx.push(a, d, c, a, b, d);
    }
  }
  const rimBack = new THREE.BufferGeometry();
  rimBack.setIndex(backIdx);
  rimBack.setAttribute('position', new THREE.Float32BufferAttribute(backPos, 3));
  rimBack.setAttribute('uv', new THREE.Float32BufferAttribute(backUv, 2));
  rimBack.computeVertexNormals();
  const rimMap = canvasTexture(1024, 128, (ctx, w, h) => {
    const r2 = seededRandom(601);
    // Bands run the length of the strip, outer rind at the top of the sheet (v = 0 is bottom) ...
    const stops = [];
    let at = 0;
    while (at < 1) {
      const thick = 0.012 + r2() * r2() * 0.07;
      const pale = r2();
      stops.push({ at, thick, color: pale > 0.62 ? '#efeae2' : pale > 0.3 ? '#a8a4ad' : pale > 0.12 ? '#6d6877' : '#3d3944' });
      at += thick;
    }
    ctx.fillStyle = '#6d6877';
    ctx.fillRect(0, 0, w, h);
    // ... drawn as wavering lines so they follow one another like the bands in a real agate.
    const wob = (x, k) => Math.sin((x / w) * TAU * 3 + k * 0.7) * 3 + Math.sin((x / w) * TAU * 7 + k * 1.1) * 1.5;
    stops.forEach((s, k) => {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = s.at * h + wob(x, k * 0.2);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let x = w; x >= 0; x -= 8) ctx.lineTo(x, (s.at + s.thick) * h + wob(x, k * 0.2));
      ctx.closePath();
      ctx.fill();
    });
    // A rusty rind outermost (v near 0, the sheet's bottom), and the crystal bed's white edge.
    const rind = ctx.createLinearGradient(0, h, 0, h * 0.78);
    rind.addColorStop(0, 'rgba(70,46,30,1)');
    rind.addColorStop(1, 'rgba(70,46,30,0)');
    ctx.fillStyle = rind;
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    const bed = ctx.createLinearGradient(0, 0, 0, h * 0.14);
    bed.addColorStop(0, 'rgba(238,232,244,1)');
    bed.addColorStop(1, 'rgba(238,232,244,0)');
    ctx.fillStyle = bed;
    ctx.fillRect(0, 0, w, h * 0.14);
  });
  rimMap.wrapS = THREE.RepeatWrapping;

  // The crystals. Hexagonal prisms with six-sided points, wider and deeper violet further in, as
  // the card's question asks a student to notice. All of them aim inward at a point near the
  // hollow's centre, with some scatter, because that is the way they grew. Flat-faced by keeping
  // each triangle's own vertices: a crystal is angular, so this is the one surface here with no
  // smoothing at all.
  const cPos = [];
  const cCol = [];
  const tri = (a, b, c, ca, cb, cc) => {
    cPos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    cCol.push(...ca, ...cb, ...cc);
  };
  const PALE = lin(0xd9cdea);
  const MID = lin(0x9a6fd0);
  const DEEP = lin(0x4f1c96);
  const VERY = lin(0x3a0f78);
  const crystal = (base, axis, r, len, depth, roll, gloom) => {
    const u = Math.abs(axis.y) < 0.9 ? UP.clone().cross(axis).normalize() : V(1, 0, 0).cross(axis).normalize();
    const w = axis.clone().cross(u).normalize();
    const ringAt = (dist, radius, twist = 0) => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const a = roll + twist + (k / 6) * TAU;
        out.push(base.clone().addScaledVector(axis, dist).addScaledVector(u, Math.cos(a) * radius).addScaledVector(w, Math.sin(a) * radius));
      }
      return out;
    };
    const shoulder = len * (0.56 + rng() * 0.16);
    const a0 = ringAt(-0.04, r * 1.02);
    const a1 = ringAt(shoulder, r * 0.92);
    // The apex wanders off the axis a little, so the six point faces are not all equal.
    const tip = base.clone().addScaledVector(axis, len)
      .addScaledVector(u, (rng() - 0.5) * r * 0.5)
      .addScaledVector(w, (rng() - 0.5) * r * 0.5);
    // Pale at the foot, deep violet at the point, with each crystal its own shade.
    const shade = (0.82 + rng() * 0.36) * gloom;
    const tone = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
    const footTone = tone(mix3(PALE, mix3(PALE, MID, 0.7), depth), shade * 1.02);
    const midTone = tone(mix3(mix3(PALE, MID, 0.5), mix3(MID, DEEP, 0.65), depth), shade);
    const tipTone = tone(mix3(mix3(MID, DEEP, 0.4), VERY, depth), shade);
    for (let k = 0; k < 6; k++) {
      const n = (k + 1) % 6;
      // Each face a touch brighter or darker, so facets read even in shadow.
      const f = 0.86 + ((k * 2.3 + roll * 5) % 1) * 0.32;
      const fA = tone(footTone, f);
      const fB = tone(midTone, f);
      const fC = tone(tipTone, f);
      tri(a0[k], a0[n], a1[n], fA, fA, fB);
      tri(a0[k], a1[n], a1[k], fA, fB, fB);
      tri(a1[k], a1[n], tip, fB, fB, fC);
    }
    // The buried foot is closed too, so each crystal is a solid.
    for (let k = 1; k < 5; k++) tri(a0[0], a0[k + 1], a0[k], footTone, footTone, footTone);
  };

  const AIM = C.clone().addScaledVector(D, 0.3);
  const COUNT = 1000;
  const RIMWARD = 300;
  for (let i = 0; i < COUNT + RIMWARD; i++) {
    // Even coverage of the part of the sphere the cavity occupies: uniform in cos(theta), spiralled.
    // The last few hundred go back over the band next to the lip, where crystals are at their
    // smallest and a single even spiral would leave bare lining between them.
    const rimward = i >= COUNT;
    const phi = i * 2.399963229728653 + (rng() - 0.5) * 0.15;
    const lip = lipTheta(phi);
    const f = rimward ? (i - COUNT + 0.5) / RIMWARD * 0.26 : (i + 0.5) / COUNT;
    const cosT = Math.cos(lip) + (Math.cos(Math.PI) - Math.cos(lip)) * f;
    const theta = Math.acos(THREE.MathUtils.clamp(cosT + (rng() - 0.5) * 0.008, -1, 1));
    const d = dirAt(theta, phi);
    const base = cavityPoint(d).addScaledVector(d, 0.03);
    // How far from the rim, 0 at the lip and 1 about a third of the way in.
    const inward = clamp01((theta - lip) / (50 * DEG));
    // Light does not reach the back of the hollow. The sun's shadow does some of this and the
    // hemisphere fill undoes it, so the fall into the dark is written into the crystals' colour,
    // and that fall is most of what makes the hollow read as somewhere you could reach into.
    const gloom = 1 - 0.58 * THREE.MathUtils.smoothstep(theta, 88 * DEG, 165 * DEG);
    const big = rng();
    const heavy = big > 0.84 ? 1.55 : big > 0.5 ? 1.08 : 0.74;
    const r = (0.035 + 0.125 * inward) * heavy * (0.85 + rng() * 0.3);
    const len = (0.1 + 0.46 * inward * inward) * heavy * (0.75 + rng() * 0.5);
    const toward = AIM.clone().sub(base).normalize();
    const axis = toward.add(V(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.48)).normalize();
    crystal(base, axis, r, len, inward, rng() * TAU, gloom);
  }
  const crystalGeo = new THREE.BufferGeometry();
  crystalGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPos, 3));
  crystalGeo.setAttribute('color', new THREE.Float32BufferAttribute(cCol, 3));
  crystalGeo.computeVertexNormals();
  const crystalMesh = mesh(crystalGeo, standard({
    vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.02,
    // A violet floor, or the depths of the hollow fall to black where the sun cannot reach.
    emissive: 0x2a0d58, emissiveIntensity: 0.3,
  }));

  const rockMesh = partsMesh(shell, { roughness: 0.92, metalness: 0, ...relief('stone', { seed: 17, repeat: 1, strength: 1.1 }) });
  const rimMesh = mesh(mergeParts([{ geometry: rimGeo }, { geometry: rimBack }]), standard({ map: rimMap, roughness: 0.42, metalness: 0 }));

  const root = new THREE.Group();
  root.add(rockMesh, rimMesh, crystalMesh);
  return root;
}

export const BUILDERS = {
  'earth-layers': () => buildEarthLayers(),
  'solar-system-orrery': () => buildOrrery(),
  'lunar-module': () => buildLunarModule(),
  'mars-rover': () => buildMarsRover(),
  'saturn-v': () => buildSaturnV(),
  'amethyst-geode': () => buildAmethystGeode(),
};
