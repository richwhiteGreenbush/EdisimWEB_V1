import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom, relief } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, alongMatrix, signedVolume, mix } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's mathematics bench: Pascal's triangle, the unit circle, Archimedes' cone, sphere
// and cylinder, a wheel rolling out pi, and a binary counter. Authored in feet, origin at the base
// centre, front toward +Z. Every printed figure is computed here from the real rule, and the tables
// below are exported so that a script can hold them to it.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// Painting. A canvas holds sRGB bytes, so colours here are written as they should appear.
// ---------------------------------------------------------------------------------------------
function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

function fitted(ctx, text, x, y, maxWidth, size, { weight = '700', align = 'center', base = 'middle', color = null, family = FONT } = {}) {
  fitFont(ctx, text, maxWidth, size, weight, family);
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (color) ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

const dataTexture = (texture) => { texture.colorSpace = THREE.NoColorSpace; return texture; };

function wrapRepeat(texture, rx = 1, ry = 1) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(rx, ry);
  return texture;
}

// Near-white grain running along u, to multiply a timber's vertex colour. Long soft streaks drawn
// with seeded strokes, wrapped so that the tile has no seam. Its u and v are in feet.
function paintWoodGrain(ctx, w, h, seed) {
  const rng = seededRandom(seed);
  ctx.fillStyle = '#efe6d8';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 520; i++) {
    const y = rng() * h;
    const x = rng() * w;
    const len = (0.15 + rng() * 0.5) * w;
    const dark = rng() > 0.35;
    const a = 0.03 + rng() * 0.09;
    ctx.strokeStyle = dark ? `rgba(92,62,36,${a})` : `rgba(255,248,235,${a})`;
    ctx.lineWidth = 0.6 + rng() * 2.4;
    const bend = (rng() - 0.5) * 7;
    for (const ox of [-w, 0, w]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y);
      ctx.bezierCurveTo(x + ox + len * 0.3, y + bend, x + ox + len * 0.7, y - bend, x + ox + len, y);
      ctx.stroke();
    }
  }
}

function woodMaterial(seed, { roughness = 0.6, bumpScale = 0.4, metalness = 0 } = {}) {
  const map = wrapRepeat(canvasTexture(512, 256, (c, w, h) => paintWoodGrain(c, w, h, seed)), 1 / 4, 1 / 1.4);
  return standard({ vertexColors: true, map, roughness, metalness, bumpMap: dataTexture(map.clone()), bumpScale });
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

// Triangles as flat arrays of position and uv (and perhaps colour), measured outward and given
// creased normals, so that a flat stays flat and a turned surface stays smooth.
function soup(pos, uv, crease = 30, col = null) {
  const g = new THREE.BufferGeometry();
  const set = () => {
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  };
  set();
  if (signedVolume(g) < 0) {
    const lists = col ? [[pos, 3], [uv, 2], [col, 3]] : [[pos, 3], [uv, 2]];
    for (const [array, size] of lists) {
      for (let t = 0; t < array.length; t += size * 3) {
        for (let k = 0; k < size; k++) {
          const a = t + size + k; const b = t + size * 2 + k;
          const v = array[a]; array[a] = array[b]; array[b] = v;
        }
      }
    }
    set();
  }
  return toCreasedNormals(g, crease * DEG);
}

function ccwPolygon(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]; const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area >= 0 ? points : [...points].reverse();
}

function capTriangles2D(points) {
  const contour = points.map(([x, y]) => new THREE.Vector2(x, y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  return tris.map(([a, b, c]) => {
    const [ax, ay] = points[a]; const [bx, by] = points[b]; const [cx, cy] = points[c];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0 ? [a, b, c] : [a, c, b];
  });
}

// A closed prism whose section is any simple polygon, running along X from x0 to x1. The section is
// given as [z, y] pairs. UVs are in feet with the grain along u, so a wood map tiles correctly.
function prismX(section, x0, x1, { crease = 25 } = {}) {
  const sec = section;
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  let run = 0;
  for (let i = 0; i < sec.length; i++) {
    const [z0, y0] = sec[i]; const [z1, y1] = sec[(i + 1) % sec.length];
    const l = Math.hypot(z1 - z0, y1 - y0);
    put(x0, y0, z0, x0, run); put(x1, y1, z1, x1, run + l); put(x1, y0, z0, x1, run);
    put(x0, y0, z0, x0, run); put(x0, y1, z1, x0, run + l); put(x1, y1, z1, x1, run + l);
    run += l;
  }
  // The side strips above face outward for a section that runs clockwise in (z, y).
  const ordered = ccwPolygon(sec);
  const clockwise = ordered !== sec;
  const tris = capTriangles2D(ordered);
  for (const [a, b, c] of tris) {
    const A = ordered[a]; const B = ordered[b]; const C = ordered[c];
    // Viewed in (z, y), a counter-clockwise triangle faces -X (z cross y = -x).
    put(x0, A[1], A[0], A[0], A[1]); put(x0, B[1], B[0], B[0], B[1]); put(x0, C[1], C[0], C[0], C[1]);
    put(x1, A[1], A[0], A[0], A[1]); put(x1, C[1], C[0], C[0], C[1]); put(x1, B[1], B[0], B[0], B[1]);
  }
  if (!clockwise) {
    // A counter-clockwise section needs its side strips reversed to match the caps.
    const sideTris = sec.length * 2;
    for (let t = 0; t < sideTris; t++) {
      const o = t * 9; const o2 = t * 6;
      for (let k = 0; k < 3; k++) { const v = pos[o + 3 + k]; pos[o + 3 + k] = pos[o + 6 + k]; pos[o + 6 + k] = v; }
      for (let k = 0; k < 2; k++) { const v = uv[o2 + 2 + k]; uv[o2 + 2 + k] = uv[o2 + 4 + k]; uv[o2 + 4 + k] = v; }
    }
  }
  return soup(pos, uv, crease);
}

// A straight squared bar with chamfered arrises between two points. UVs in feet, grain along u.
function timber(a, b, w, h = w, { up = [0, 1, 0], chamfer = null, seed = 0 } = {}) {
  const { m, len } = alongMatrix(a, b, up);
  const c = chamfer ?? Math.min(w, h) * 0.09;
  const hw = w / 2; const hh = h / 2;
  const sec = [[hw - c, -hh], [hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh]];
  const pos = []; const uv = [];
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u + seed * 0.73, v + seed * 0.37); };
  let per = 0;
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = sec[i]; const [x1, y1] = sec[(i + 1) % 8];
    const l = Math.hypot(x1 - x0, y1 - y0);
    put(x0, y0, 0, 0, per); put(x1, y1, 0, 0, per + l); put(x1, y1, len, len, per + l);
    put(x0, y0, 0, 0, per); put(x1, y1, len, len, per + l); put(x0, y0, len, len, per);
    per += l;
  }
  for (let i = 0; i < 8; i++) {
    const [x0, y0] = sec[i]; const [x1, y1] = sec[(i + 1) % 8];
    put(0, 0, 0, 0.2, 0.2); put(x1, y1, 0, 0.2 + x1 * 0.2, 0.2 + y1); put(x0, y0, 0, 0.2 + x0 * 0.2, 0.2 + y0);
    put(0, 0, len, 0.2, 0.2); put(x0, y0, len, 0.2 + x0 * 0.2, 0.2 + y0); put(x1, y1, len, 0.2 + x1 * 0.2, 0.2 + y1);
  }
  const g = soup(pos, uv, 24);
  g.applyMatrix4(m);
  return g;
}

// A solid of revolution about +Y, bottom-up, axis to axis or closed on itself.
function turned(profile, segments, { crease = 28, uTiles = 1, vScale = 1 } = {}) {
  const n = profile.length;
  const pos = []; const uv = []; const idx = [];
  const ring = segments + 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i];
    if (i) s += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      uv.push((j / segments) * uTiles, s * vScale);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * ring + j; const b = a + 1; const d = a + ring; const c = d + 1;
      if (profile[i][0] > 1e-5) idx.push(a, b, c);
      if (profile[i + 1][0] > 1e-5) idx.push(a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return toCreasedNormals(g, crease * DEG);
}

// The same revolution over part of a turn, closed by its two flat radial faces, which is what a cut
// face is. `poly` is a closed polygon in (radius, y), and a turn runs from a0 to a1, measured from +Z
// toward +X. It is the cut-away's one description: wall, liquid and hoop all go through here, so
// their faces line up by construction.
function wedge(poly, a0, a1, segments = 64, { crease = 28, uvFn = null } = {}) {
  const P = ccwPolygon(poly);
  const pos = []; const uv = [];
  const at = (r, y, a) => [r * Math.sin(a), y, r * Math.cos(a)];
  const tuv = (r, y, a) => (uvFn ? uvFn(r, y, a) : [a * Math.max(r, 0.2), y]);
  const put = (p, q) => { pos.push(p[0], p[1], p[2]); uv.push(q[0], q[1]); };
  const tri = (a, b, c) => { for (const [p, q] of [a, b, c]) put(p, q); };
  const vert = (r, y, a) => [at(r, y, a), tuv(r, y, a)];
  for (let i = 0; i < P.length; i++) {
    const [r0, y0] = P[i]; const [r1, y1] = P[(i + 1) % P.length];
    if (r0 < 1e-5 && r1 < 1e-5) continue;
    for (let j = 0; j < segments; j++) {
      const A0 = mix(a0, a1, j / segments); const A1 = mix(a0, a1, (j + 1) / segments);
      const a = vert(r0, y0, A0); const b = vert(r0, y0, A1); const c = vert(r1, y1, A1); const d = vert(r1, y1, A0);
      if (r0 > 1e-5) tri(a, b, c);
      if (r1 > 1e-5) tri(a, c, d);
    }
  }
  for (const [a, b, c] of capTriangles2D(P)) {
    const [ra, ya] = P[a]; const [rb, yb] = P[b]; const [rc, yc] = P[c];
    tri(vert(ra, ya, a0), vert(rb, yb, a0), vert(rc, yc, a0));
    tri(vert(ra, ya, a1), vert(rc, yc, a1), vert(rb, yb, a1));
  }
  return soup(pos, uv, crease);
}

const rod = (a, b, r, sides = 10, round = 1) => tube([a, b], r, { straight: true, steps: 1, sides, round });

function ball(r, at, detail = 16) {
  const g = new THREE.SphereGeometry(r, detail, Math.max(6, Math.round(detail * 0.66)));
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A flat printed plate, face on +Z, back at z = -depth, centre at the origin. uv rect is [u0,v0,u1,v1].
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  const hw = w / 2; const hh = h / 2;
  const pos = []; const uv = [];
  const rimU = u0 + (u1 - u0) * 0.004; const rimV = v0 + (v1 - v0) * 0.02;
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) put(...p); };
  quad([-hw, -hh, 0, u0, v0], [hw, -hh, 0, u1, v0], [hw, hh, 0, u1, v1], [-hw, hh, 0, u0, v1]);
  quad([-hw, hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV]);
  quad([-hw, -hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [hw, -hh, 0, rimU, rimV], [-hw, -hh, 0, rimU, rimV]);
  quad([hw, hh, -depth, rimU, rimV], [-hw, hh, -depth, rimU, rimV], [-hw, hh, 0, rimU, rimV], [hw, hh, 0, rimU, rimV]);
  quad([hw, -hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, hh, 0, rimU, rimV], [hw, -hh, 0, rimU, rimV]);
  quad([-hw, hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV], [-hw, -hh, 0, rimU, rimV], [-hw, hh, 0, rimU, rimV]);
  return soup(pos, uv, 30);
}

function noShadow(m) { m.castShadow = false; m.receiveShadow = false; return m; }

// A UV rectangle on a canvas w by h from a pixel rectangle, with the canvas's y running down.
const rectUV = (W, H, x, y, w, h) => [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];

// ===========================================================================================
// PASCAL'S TRIANGLE
// ===========================================================================================
//
// The pattern is the point, so the budget goes on seeing it from across a field: odd tiles strong,
// even tiles pale, and the odd ones standing further proud, so that the Sierpinski figure is in the
// relief as well as the colour. The tile is a rounded hexagon, since hexagons in offset rows are
// exactly the arrangement in which each number sits under the two it is the sum of.

export function pascalRows(n = 13) {
  const rows = [[1]];
  for (let r = 1; r < n; r++) {
    const prev = rows[r - 1];
    const row = [1];
    for (let k = 1; k < r; k++) row.push(prev[k - 1] + prev[k]);
    row.push(1);
    rows.push(row);
  }
  return rows;
}

export const PASCAL = {
  ROWS: pascalRows(13),
  SUMS: pascalRows(13).map((row) => row.reduce((a, b) => a + b, 0)),
  PITCH: 0.74,
  SLOPE: 52 * DEG,
  BOARD_W: 11.9,
  BOARD_H: 9.0,
  CENTRE_X: -0.86, // the triangle's axis, left of the board's middle to leave room for the sums
  SUM_X: 4.82,
  LOW_Y: 1.32,
};

function hexOutline(across, cornerR = 0.07, perCorner = 3) {
  const Rc = across / Math.sqrt(3);
  const pts = [];
  for (let c = 0; c < 6; c++) {
    const a = Math.PI / 2 + (c / 6) * TAU;
    // The corner's arc centre sits in along the same bearing, and its arc spans 60 degrees.
    const inR = Rc - cornerR / Math.cos(Math.PI / 6);
    const cx = Math.cos(a) * inR; const cy = Math.sin(a) * inR;
    for (let k = 0; k < perCorner; k++) {
      const b = a - Math.PI / 6 + (k / (perCorner - 1)) * (Math.PI / 3);
      pts.push([cx + Math.cos(b) * cornerR, cy + Math.sin(b) * cornerR]);
    }
  }
  return pts; // counter-clockwise, seen from +Z
}

function buildPascal() {
  const { ROWS, SUMS, PITCH, SLOPE, BOARD_W, BOARD_H, CENTRE_X, SUM_X, LOW_Y } = PASCAL;
  const root = new THREE.Group();
  const ROW_H = (PITCH * Math.sqrt(3)) / 2;

  // Panel coordinates: x across, v up the slope, w out of the face. The panel is authored flat and
  // tipped as a whole, so that nothing has to think about the slope.
  const vAxis = new THREE.Vector3(0, Math.sin(SLOPE), -Math.cos(SLOPE));
  const wAxis = new THREE.Vector3(0, Math.cos(SLOPE), Math.sin(SLOPE));
  const runZ = BOARD_H * Math.cos(SLOPE);
  const panelM = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), vAxis, wAxis);
  panelM.setPosition(0, LOW_Y, runZ / 2);
  const world = (x, v, w) => {
    const p = new THREE.Vector3(x, v, w).applyMatrix4(panelM);
    return [p.x, p.y, p.z];
  };

  // --- Where each row sits on the board ---
  const TOP_ROW_V = BOARD_H - 0.72;
  const rowV = (r) => TOP_ROW_V - r * ROW_H;
  const tileX = (r, k) => CENTRE_X + (k - r / 2) * PITCH;

  // --- The tile atlas: one cell per distinct value, odd values one strong colour, even ones pale ---
  const ODD = '#c8321e'; const EVEN = '#ece3cd';
  const values = [...new Set(ROWS.flat())].sort((a, b) => (a % 2) - (b % 2) || a - b);
  const COLS = 6;
  const CELL = 170;
  const AT = 1024;
  const cellOf = new Map(values.map((v, i) => [v, [i % COLS, Math.floor(i / COLS)]]));
  const tileMap = canvasTexture(AT, AT, (ctx) => {
    ctx.fillStyle = EVEN;
    ctx.fillRect(0, 0, AT, AT);
    for (const v of values) {
      const [cx, cy] = cellOf.get(v);
      const x = cx * CELL; const y = cy * CELL;
      const odd = v % 2 === 1;
      ctx.fillStyle = odd ? ODD : EVEN;
      ctx.fillRect(x, y, CELL, CELL);
      const s = String(v);
      // Digits are as large as the tile allows, and a three-digit one shrinks only as far as it must.
      fitted(ctx, s, x + CELL / 2, y + CELL / 2 + 4, CELL * 0.62, CELL * 0.46, { weight: '700', color: odd ? '#fff6e6' : '#232a36' });
    }
  });
  tileMap.anisotropy = 8;

  // --- The tiles, all one mesh ---
  const across = PITCH - 0.03;
  const outline = hexOutline(across, 0.07, 3);
  const n = outline.length;
  const Rc = across / Math.sqrt(3);
  const rng = seededRandom(1654);
  const tilePos = []; const tileUv = []; const tileCol = [];
  ROWS.forEach((row, r) => row.forEach((value, k) => {
    const x = tileX(r, k); const v = rowV(r);
    const odd = value % 2 === 1;
    const H = odd ? 0.17 : 0.09; // odd tiles stand proud: the figure is in the relief too
    const CH = 0.032; const IN = 0.036;
    const [cx, cy] = cellOf.get(value);
    const u0 = cx * CELL / AT; const v1 = 1 - cy * CELL / AT; const dU = CELL / AT;
    const inner = (Rc - IN) / Rc;
    const uvFace = (px, py) => [u0 + (px / (2 * Rc) + 0.5) * dU, v1 - dU + (py / (2 * Rc) + 0.5) * dU];
    const uvEdge = [u0 + dU * 0.03, v1 - dU * 0.03];
    const k2 = 0.94 + rng() * 0.06;
    const put = (p, q) => {
      const P = new THREE.Vector3(x + p[0], v + p[1], p[2]).applyMatrix4(panelM);
      tilePos.push(P.x, P.y, P.z); tileUv.push(q[0], q[1]); tileCol.push(k2, k2, k2);
    };
    const tri = (a, b, c) => { for (const [p, q] of [a, b, c]) put(p, q); };
    for (let i = 0; i < n; i++) {
      const [ax, ay] = outline[i]; const [bx, by] = outline[(i + 1) % n];
      const ring = (px, py, s, w, face) => [[px * s, py * s, w], face ? uvFace(px * s, py * s) : uvEdge];
      // The face, a fan from the centre.
      tri([[0, 0, H], uvFace(0, 0)], ring(ax, ay, inner, H, true), ring(bx, by, inner, H, true));
      // The chamfer, whose colour is still the tile's.
      tri(ring(ax, ay, inner, H, false), ring(ax, ay, 1, H - CH, false), ring(bx, by, 1, H - CH, false));
      tri(ring(ax, ay, inner, H, false), ring(bx, by, 1, H - CH, false), ring(bx, by, inner, H, false));
      // The side, sunk into the board.
      tri(ring(ax, ay, 1, H - CH, false), ring(ax, ay, 1, -0.03, false), ring(bx, by, 1, -0.03, false));
      tri(ring(ax, ay, 1, H - CH, false), ring(bx, by, 1, -0.03, false), ring(bx, by, 1, H - CH, false));
      // The underside, which closes it.
      tri([[0, 0, -0.03], uvEdge], ring(bx, by, 1, -0.03, false), ring(ax, ay, 1, -0.03, false));
    }
  }));
  const tiles = mesh(soup(tilePos, tileUv, 33, tileCol), standard({ vertexColors: true, map: tileMap, roughness: 0.68, metalness: 0 }));
  root.add(tiles);

  // --- The board, printed: title, rule, legend, leaders and the column of sums ---
  const PPF = 172;
  const BW = Math.round(BOARD_W * PPF); const BH = Math.round(BOARD_H * PPF);
  const X = (x) => (x + BOARD_W / 2) * PPF;
  const Y = (v) => (BOARD_H - v) * PPF;
  const SUM_W = 1.62;
  const boardMap = canvasTexture(BW, BH, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1d3049');
    g.addColorStop(1, '#17263b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r2 = seededRandom(77);
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(${r2() > 0.5 ? '255,255,255' : '0,0,0'},${0.012 + r2() * 0.02})`;
      ctx.fillRect(r2() * w, r2() * h, 1 + r2() * 3, 1 + r2() * 3);
    }
    // The leaders, from the end of each row across to its sum.
    ctx.strokeStyle = 'rgba(214,226,240,0.5)';
    ctx.lineWidth = 3;
    ctx.setLineDash([3, 13]);
    ctx.lineCap = 'round';
    ROWS.forEach((row, r) => {
      const x0 = tileX(r, r) + PITCH / 2 + 0.08;
      ctx.beginPath();
      ctx.moveTo(X(x0), Y(rowV(r)));
      ctx.lineTo(X(SUM_X - SUM_W / 2 - 0.04), Y(rowV(r)));
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // The title, top left, in the room the triangle leaves.
    ctx.fillStyle = '#f4efe2';
    const left = X(-BOARD_W / 2 + 0.42);
    fitted(ctx, 'Pascal’s', left, Y(BOARD_H - 0.72), 3.0 * PPF, 0.62 * PPF, { align: 'left', color: '#f4efe2' });
    fitted(ctx, 'Triangle', left, Y(BOARD_H - 1.36), 3.0 * PPF, 0.62 * PPF, { align: 'left', color: '#f4efe2' });

    // The rule, with a worked sum in the same tiles.
    const ruleV = BOARD_H - 2.1;
    const lines = ['Each number is the', 'sum of the two', 'above it.'];
    lines.forEach((t, i) => fitted(ctx, t, left, Y(ruleV - i * 0.31), 2.2 * PPF, 0.26 * PPF, { weight: '600', align: 'left', color: '#d9e3ef' }));
    fitted(ctx, '3 + 3 = 6', left, Y(ruleV - 1.12), 1.8 * PPF, 0.36 * PPF, { align: 'left', color: '#f2b84b' });

    // The legend, top right, in the room on the other side.
    const legendX = X(CENTRE_X + 1.7);
    const legendTop = BOARD_H - 0.5;
    const swatch = (cx, cy, fill) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + (i / 6) * TAU;
        const px = cx + Math.cos(a) * 0.15 * PPF; const py = cy + Math.sin(a) * 0.15 * PPF;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    swatch(legendX + 0.15 * PPF, Y(legendTop), ODD);
    fitted(ctx, 'odd numbers', legendX + 0.42 * PPF, Y(legendTop), 1.9 * PPF, 0.25 * PPF, { weight: '600', align: 'left', color: '#d9e3ef' });
    swatch(legendX + 0.15 * PPF, Y(legendTop - 0.38), EVEN);
    fitted(ctx, 'even numbers', legendX + 0.42 * PPF, Y(legendTop - 0.38), 1.9 * PPF, 0.25 * PPF, { weight: '600', align: 'left', color: '#d9e3ef' });

    // The column of sums, dark on a pale plate.
    const sx0 = X(SUM_X - SUM_W / 2); const sw = SUM_W * PPF;
    const sTop = Y(BOARD_H - 0.14); const sBot = Y(rowV(12) - 0.36);
    ctx.fillStyle = '#ece4d0';
    ctx.fillRect(sx0, sTop, sw, sBot - sTop);
    fitted(ctx, 'row adds up to', sx0 + sw / 2, Y(BOARD_H - 0.32), sw * 0.9, 0.21 * PPF, { weight: '700', color: '#46505e' });
    SUMS.forEach((sum, r) => {
      fitted(ctx, String(sum), sx0 + sw * 0.5, Y(rowV(r)), sw * 0.82, 0.37 * PPF, { weight: '700', color: '#1e2632' });
    });
  });
  boardMap.anisotropy = 8;

  const printed = [];
  const place = (g, x, v, w) => {
    g.translate(x, v, w);
    g.applyMatrix4(panelM);
    return g;
  };
  const board = printedPlate(BOARD_W, BOARD_H, 0.16, [0, 0, 1, 1]);
  printed.push({ geometry: place(board, 0, BOARD_H / 2, 0), color: 0xffffff });
  // The sums' plate stands proud of the board and prints the same part of the same picture.
  const sV0 = rowV(12) - 0.36; const sV1 = BOARD_H - 0.14;
  const sumsPlate = printedPlate(SUM_W, sV1 - sV0, 0.1, [(SUM_X - SUM_W / 2 + BOARD_W / 2) / BOARD_W, sV0 / BOARD_H, (SUM_X + SUM_W / 2 + BOARD_W / 2) / BOARD_W, sV1 / BOARD_H]);
  printed.push({ geometry: place(sumsPlate, SUM_X, (sV0 + sV1) / 2, 0.07), color: 0xffffff });
  root.add(mesh(mergeParts(printed), standard({ vertexColors: true, map: boardMap, roughness: 0.74, metalness: 0 })));

  // --- The frame and the stand ---
  const wood = [];
  const WALNUT = 0x7a4f30; const DARK = 0x6a452a; const OAK = 0x94683f;
  const F = 0.22; // the frame's width
  const hw = BOARD_W / 2 + F / 2; const FH = BOARD_H + F;
  const frame = (a, b) => timber(world(a[0], a[1], a[2]), world(b[0], b[1], b[2]), F, 0.34, { up: [wAxis.x, wAxis.y, wAxis.z], chamfer: 0.05, seed: a[0] + a[1] });
  wood.push({ geometry: frame([-hw - F / 2, -F / 2, 0], [hw + F / 2, -F / 2, 0]), color: WALNUT });
  wood.push({ geometry: frame([-hw - F / 2, BOARD_H + F / 2, 0], [hw + F / 2, BOARD_H + F / 2, 0]), color: WALNUT });
  wood.push({ geometry: frame([-hw, -F / 2, 0], [-hw, FH, 0]), color: WALNUT });
  wood.push({ geometry: frame([hw, -F / 2, 0], [hw, FH, 0]), color: WALNUT });
  // The back of the board is boarded in timber, for anyone who walks round.
  for (let i = 0; i < 6; i++) {
    const v0 = mix(-0.02, BOARD_H + 0.02, i / 6); const v1 = mix(-0.02, BOARD_H + 0.02, (i + 1) / 6);
    const vm = (v0 + v1) / 2;
    wood.push({ geometry: timber(world(-BOARD_W / 2, vm, -0.2), world(BOARD_W / 2, vm, -0.2), v1 - v0 - 0.01, 0.1, { up: [wAxis.x, wAxis.y, wAxis.z], chamfer: 0.012, seed: i * 2.1 }), color: i % 2 ? OAK : 0x70492b });
  }

  // Three trestles: a sill on the ground, a leg up to the board's foot, and a raking strut from the
  // sill's back end to the board's back. Each is one triangle, which is why it stands.
  const xs = [-BOARD_W / 2 + 0.25, 0, BOARD_W / 2 - 0.25];
  const zFoot = world(0, 0, -0.3)[2];
  const yFoot = world(0, 0, -0.3)[1];
  const zTop = world(0, BOARD_H * 0.92, -0.3)[2];
  const yTop = world(0, BOARD_H * 0.92, -0.3)[1];
  const zBack = zTop - 0.2;
  const zFront = zFoot + 0.45;
  const T = 0.36;
  for (const [i, x] of xs.entries()) {
    wood.push({ geometry: timber([x, T / 2, zFront], [x, T / 2, zBack], T, T, { seed: 3 + i }), color: DARK });
    wood.push({ geometry: timber([x, 0.15, zFoot], [x, yFoot + 0.1, zFoot], T, T, { up: [1, 0, 0], seed: 5 + i }), color: DARK });
    // The upright, from the back of the sill to the back of the board near its top.
    wood.push({ geometry: timber([x, 0.15, zBack + 0.1], [x, yTop, zTop - 0.02], T, T, { up: [1, 0, 0], seed: 7 + i }), color: DARK });
    // A knee brace, from the sill to the middle of the board.
    const mid = world(x, BOARD_H * 0.42, -0.3);
    wood.push({ geometry: timber([x, 0.2, zFoot - 0.2], mid, T * 0.75, T * 0.75, { up: [1, 0, 0], seed: 9 + i }), color: OAK });
  }
  // Rails tying the three together: at the toe, at the back, and a stretcher up the back.
  const railX = BOARD_W / 2 + 0.05;
  wood.push({ geometry: timber([-railX, 0.22, zFront - 0.1], [railX, 0.22, zFront - 0.1], 0.26, 0.26, { seed: 11 }), color: WALNUT });
  wood.push({ geometry: timber([-railX, 0.22, zBack + 0.12], [railX, 0.22, zBack + 0.12], 0.26, 0.26, { seed: 13 }), color: WALNUT });
  root.add(mesh(mergeParts(wood), woodMaterial(1654)));

  // --- Brass bolts where the frame's corners are pinned ---
  const metal = [];
  const bolt = (x, v) => {
    const g = new THREE.SphereGeometry(0.075, 14, 8);
    g.scale(1, 1, 0.55);
    const m = new THREE.Matrix4().copy(panelM).multiply(new THREE.Matrix4().makeTranslation(x, v, 0.17));
    g.applyMatrix4(m);
    return g;
  };
  for (const [x, v] of [[-hw, -F / 2], [hw, -F / 2], [-hw, FH - F / 2], [hw, FH - F / 2], [0, -F / 2], [0, FH - F / 2]]) {
    metal.push({ geometry: bolt(x, v), color: 0xc9a24a });
  }
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.38, metalness: 0.45 })));

  root.rotation.set(0, 0, 0);
  return root;
}

// ===========================================================================================
// THE UNIT CIRCLE
// ===========================================================================================
//
// One rod is the whole idea: level, joining the bead on the circle to the bead on the wave. So the
// wave has to stand on the same vertical scale as the circle, and everything on the board that says
// so (the shared horizontal lines at 1, 0 and -1) runs straight across from one to the other.
//
// Six meshes is the limit and six things have to move or be still on their own: the board and all
// that is fixed; the arm and its bead, which turn as one; the cosine leg; the sine leg; the level
// rod; and the wave's bead. That is why the board's print and its frame share one material: the
// frame's parts have no uv, which lands them on a white strip along the bottom of the canvas.

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// 30 becomes "π/6": computed, so that a label cannot disagree with its own angle.
export function radianLabel(deg) {
  if (deg === 0) return '0';
  const g = gcd(deg, 180);
  const top = deg / g; const bottom = 180 / g;
  return `${top === 1 ? '' : top}π${bottom === 1 ? '' : `/${bottom}`}`;
}

export const UNIT_CIRCLE = {
  R: 2.5,
  CX: -4.2,
  CY: 4.8,
  WAVE_X0: -0.25,
  WAVE_L: 7.4,
  RIG_Z: 0.42,
  BOARD_W: 15.4,
  BOARD_Y0: 1.1,
  BOARD_Y1: 8.5,
  START_DEG: 40,
  TURN_SECONDS: 14,
  ANGLES: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
};

function buildUnitCircle() {
  const { R, CX, CY, WAVE_X0, WAVE_L, RIG_Z: Z, BOARD_W, BOARD_Y0, BOARD_Y1, START_DEG, TURN_SECONDS, ANGLES } = UNIT_CIRCLE;
  const root = new THREE.Group();
  const BOARD_H = BOARD_Y1 - BOARD_Y0;
  const WAVE_END = WAVE_X0 + WAVE_L;
  const waveX = (theta) => WAVE_X0 + (theta / TAU) * WAVE_L;
  const waveY = (theta) => CY + R * Math.sin(theta);

  const COS = '#2fbdea'; const SIN = '#f4502f'; const LEVEL = '#ffd21f';

  // --- The board's print ---
  const W = 3072;
  const PPF = W / BOARD_W;
  const PRINT_H = Math.round(BOARD_H * PPF);
  const STRIP = 84;
  const H = PRINT_H + STRIP;
  const X = (x) => (x + BOARD_W / 2) * PPF;
  const Y = (y) => (BOARD_Y1 - y) * PPF;
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, PRINT_H);
    g.addColorStop(0, '#16345a');
    g.addColorStop(1, '#112a49');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, PRINT_H);

    const line = (x0, y0, x1, y1, width, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(X(x0), Y(y0)); ctx.lineTo(X(x1), Y(y1)); ctx.stroke();
    };
    const FAINT = 'rgba(205,224,245,0.2)'; const MID = 'rgba(205,224,245,0.42)'; const BRIGHT = 'rgba(232,242,252,0.85)';

    // The circle's grid, a half unit to a square.
    for (let k = -2; k <= 2; k++) {
      line(CX + (k * R) / 2, CY - R - 0.12, CX + (k * R) / 2, CY + R + 0.12, 2, FAINT);
    }
    // The levels, which run straight across the circle and the wave: this is the shared scale.
    for (let k = -2; k <= 2; k++) {
      const y = CY + (k * R) / 2;
      line(CX - R - 0.12, y, WAVE_END + 0.1, y, k % 2 === 0 ? 3 : 2, k % 2 === 0 ? MID : FAINT);
    }
    // The wave's own verticals: every 30 degrees faint, every 90 stronger.
    for (let d = 0; d <= 360; d += 30) {
      const x = waveX(d * DEG);
      line(x, CY - R - 0.1, x, CY + R + 0.12, d % 90 === 0 ? 3 : 2, d % 90 === 0 ? MID : FAINT);
    }
    // The axes.
    line(CX - R - 0.2, CY, CX + R + 0.2, CY, 5, BRIGHT);
    line(CX, CY - R - 0.2, CX, CY + R + 0.2, 5, BRIGHT);
    line(WAVE_X0 - 0.05, CY, WAVE_END + 0.12, CY, 5, BRIGHT);
    line(WAVE_X0, CY - R - 0.1, WAVE_X0, CY + R + 0.08, 5, BRIGHT);

    // The circle's marks: every 30 and 45 degree angle, in degrees and in radians.
    for (const deg of ANGLES) {
      const a = deg * DEG;
      line(CX + Math.cos(a) * (R - 0.14), CY + Math.sin(a) * (R - 0.14), CX + Math.cos(a) * (R + 0.14), CY + Math.sin(a) * (R + 0.14), 3, BRIGHT);
      // Wider at the sides than at the top, because the two lines of type are wider than they are tall.
      const rr = R + 0.44 + Math.abs(Math.cos(a)) * 0.2;
      const px = CX + Math.cos(a) * rr; const py = CY + Math.sin(a) * rr;
      fitted(ctx, `${deg}°`, X(px), Y(py + 0.115), 0.8 * PPF, 0.21 * PPF, { color: '#f7f3e4' });
      fitted(ctx, radianLabel(deg), X(px), Y(py - 0.115), 0.8 * PPF, 0.2 * PPF, { weight: '600', color: '#9fd8f4' });
    }
    // The circle's axes, numbered inside the rim where nothing else is.
    const num = (t, x, y) => fitted(ctx, t, X(x), Y(y), 0.5 * PPF, 0.25 * PPF, { color: '#ffffff' });
    num('1', CX + R - 0.2, CY - 0.2);
    num('−1', CX - R + 0.26, CY - 0.2);
    num('1', CX + 0.2, CY + R - 0.24);
    num('−1', CX + 0.26, CY - R + 0.24);
    num('0', CX - 0.26, CY - 0.26);

    // The wave's axes.
    for (const [t, y] of [['1', CY + R], ['0', CY], ['−1', CY - R]]) {
      fitted(ctx, t, X(WAVE_X0 - 0.18), Y(y), 0.5 * PPF, 0.25 * PPF, { align: 'right', color: '#ffffff' });
    }
    for (const d of [0, 90, 180, 270, 360]) {
      const x = waveX(d * DEG);
      const rad = d === 360 ? '2π' : radianLabel(d);
      fitted(ctx, `${d}°`, X(x), Y(CY - R - 0.3), 0.8 * PPF, 0.25 * PPF, { color: '#f7f3e4' });
      fitted(ctx, rad, X(x), Y(CY - R - 0.57), 0.8 * PPF, 0.24 * PPF, { weight: '600', color: '#9fd8f4' });
    }

    // The words.
    fitted(ctx, 'The Unit Circle', X(WAVE_X0 - 0.1), Y(BOARD_Y1 - 0.44), 4.3 * PPF, 0.62 * PPF, { align: 'left', color: '#ffffff' });
    fitted(ctx, 'cos² θ + sin² θ = 1', X(WAVE_X0 - 0.1), Y(BOARD_Y1 - 0.96), 3.4 * PPF, 0.3 * PPF, { weight: '600', align: 'left', color: '#d9e6f4' });
    const key = (color, text, y) => {
      const kx = WAVE_X0 + 4.35;
      ctx.fillStyle = color;
      ctx.fillRect(X(kx), Y(y) - 0.05 * PPF, 0.34 * PPF, 0.1 * PPF);
      fitted(ctx, text, X(kx + 0.44), Y(y), 2.95 * PPF, 0.25 * PPF, { weight: '600', align: 'left', color: '#eef4fa' });
    };
    key(COS, 'cos θ: how far across', BOARD_Y1 - 0.3);
    key(SIN, 'sin θ: how far up', BOARD_Y1 - 0.62);
    key(LEVEL, 'the same height, always', BOARD_Y1 - 0.94);
    fitted(ctx, '(cos θ, sin θ)', X(CX - R - 0.72), Y(BOARD_Y1 - 0.36), 1.9 * PPF, 0.27 * PPF, { align: 'left', color: LEVEL });
    fitted(ctx, 'radius = 1', X(CX - R - 0.72), Y(BOARD_Y0 + 0.34), 1.9 * PPF, 0.25 * PPF, { weight: '600', align: 'left', color: '#d9e6f4' });
    fitted(ctx, 'Heights match the circle. The wave’s length is drawn at half scale.', X(WAVE_X0 + WAVE_L / 2), Y(BOARD_Y0 + 0.16), 7.4 * PPF, 0.21 * PPF, { weight: '500', color: '#c5d6e8' });
  });
  map.anisotropy = 8;

  // --- Everything that does not move, in one mesh ---
  const parts = [];
  const plain = (g) => { g.deleteAttribute('uv'); return g; };
  const add = (g, color) => parts.push({ geometry: plain(g), color });
  const FRAME = 0x566673; const FRAME2 = 0x6c7a86; const BRASS = 0xc9a24a; const IRON = 0x3e4852;

  const board = printedPlate(BOARD_W, BOARD_H, 0.2, [0, STRIP / H, 1, 1]);
  board.translate(0, (BOARD_Y0 + BOARD_Y1) / 2, 0.1);
  parts.push({ geometry: board, color: 0xffffff });

  // The rim, standing on pins off the board, in the same plane as the moving rods.
  const ringProfile = [];
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * TAU;
    ringProfile.push([R - Math.cos(a) * 0.055, Math.sin(a) * 0.055]);
  }
  const ring = turned(ringProfile, 128, { crease: 50 });
  ring.rotateX(Math.PI / 2);
  ring.translate(CX, CY, Z);
  add(ring, 0xe9eef2);
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * (TAU / 8);
    const p = [CX + Math.cos(a) * R, CY + Math.sin(a) * R];
    add(rod([p[0], p[1], 0.08], [p[0], p[1], Z], 0.028, 8), 0x20344c);
  }
  for (const deg of ANGLES) {
    const a = deg * DEG;
    add(rod([CX + Math.cos(a) * (R - 0.11), CY + Math.sin(a) * (R - 0.11), Z], [CX + Math.cos(a) * (R + 0.11), CY + Math.sin(a) * (R + 0.11), Z], 0.026, 6), deg % 90 === 0 ? 0xffffff : 0xcfd8e0);
  }
  // The pivot, a turned brass boss the arm comes out of.
  const hub = turned([[0, 0.06], [0.14, 0.06], [0.14, Z + 0.02], [0.1, Z + 0.09], [0, Z + 0.11]], 28);
  hub.rotateX(Math.PI / 2);
  hub.translate(CX, CY, 0);
  add(hub, BRASS);

  // The wave: a solid tube, on the same kind of pins, from one description of its curve.
  const WN = 72;
  const wavePts = [];
  for (let i = 0; i <= WN; i++) { const th = (i / WN) * TAU; wavePts.push([waveX(th), waveY(th), Z]); }
  add(tube(wavePts, 0.062, { sides: 10, steps: 168, round: 2 }), new THREE.Color(SIN).getHex());
  for (let i = 0; i <= 8; i++) {
    const th = (i / 8) * TAU;
    add(rod([waveX(th), waveY(th), 0.08], [waveX(th), waveY(th), Z], 0.028, 8), 0x20344c);
  }

  // The frame, in painted steel with brass corners, and the stand.
  const F = 0.22;
  const fz = 0.02;
  const fx = BOARD_W / 2 + F / 2;
  const y0 = BOARD_Y0 - F / 2; const y1 = BOARD_Y1 + F / 2;
  const bar = (a, b, w = F, h = 0.42, up = [0, 0, 1]) => timber(a, b, w, h, { up, chamfer: 0.045 });
  add(bar([-fx - F / 2, y0, fz], [fx + F / 2, y0, fz]), FRAME);
  add(bar([-fx - F / 2, y1, fz], [fx + F / 2, y1, fz]), FRAME);
  add(bar([-fx, y0, fz], [-fx, y1, fz]), FRAME);
  add(bar([fx, y0, fz], [fx, y1, fz]), FRAME);
  for (const x of [-fx, fx]) {
    for (const y of [y0, y1]) {
      const g = new THREE.SphereGeometry(0.1, 14, 9);
      g.scale(1, 1, 0.6);
      g.translate(x, y, fz + 0.2);
      add(g, BRASS);
    }
  }
  // The board's back is sheeted in plain painted steel: unlit navy from behind is a black slab.
  add(timber([-BOARD_W / 2, (BOARD_Y0 + BOARD_Y1) / 2, -0.13], [BOARD_W / 2, (BOARD_Y0 + BOARD_Y1) / 2, -0.13], BOARD_H, 0.06, { up: [0, 0, 1], chamfer: 0.01 }), 0x8b98a3);
  // The base: one long moulded section.
  add(prismX([[1.9, 0], [1.9, 0.16], [1.72, 0.26], [1.42, 0.3], [1.2, 0.58], [-1.05, 0.58], [-1.3, 0.3], [-1.75, 0.26], [-1.9, 0.16], [-1.9, 0]], -8.3, 8.3), IRON);
  add(prismX([[1.25, 0.5], [1.25, 0.64], [-1.1, 0.64], [-1.1, 0.5]], -8.0, 8.0), FRAME2);
  // Two posts behind the board, with a raking brace each, and two short feet under it.
  for (const x of [-5.5, 5.5]) {
    add(timber([x, 0.5, -0.28], [x, BOARD_Y1 + 0.1, -0.28], 0.34, 0.3, { up: [0, 0, 1], chamfer: 0.04 }), FRAME);
    add(timber([x, 0.5, -1.25], [x, 5.4, -0.34], 0.2, 0.2, { up: [1, 0, 0], chamfer: 0.03 }), FRAME2);
    add(timber([x, 0.55, 0.02], [x, BOARD_Y0 - 0.1, 0.02], 0.5, 0.36, { up: [0, 0, 1], chamfer: 0.05 }), FRAME2);
    const collar = turned([[0, 0.6], [0.34, 0.6], [0.34, 0.68], [0.26, 0.74], [0, 0.74]], 20);
    collar.translate(x, 0, -1.25);
    add(collar, BRASS);
  }
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, map, roughness: 0.62, metalness: 0.04 })));

  // --- What moves. Rods are unit long and take their length from a scale, never from new vertices ---
  const rig = new THREE.Group();
  root.add(rig);
  const paint = (color, extra = {}) => standard({ color: new THREE.Color(color), roughness: 0.4, metalness: 0.05, emissive: new THREE.Color(color), emissiveIntensity: 0.12, ...extra });
  const rodX = (r) => { const g = new THREE.CylinderGeometry(r, r, 1, 14); g.rotateZ(-Math.PI / 2); g.translate(0.5, 0, 0); return g; };
  const rodY = (r) => { const g = new THREE.CylinderGeometry(r, r, 1, 14); g.translate(0, 0.5, 0); return g; };

  const armParts = [
    { geometry: plain(rodX(0.06).scale(R, 1, 1)), color: 0xe8d9a8 },
    { geometry: plain(ball(0.17, [R, 0, 0], 24)), color: LEVEL },
  ];
  const arm = mesh(mergeParts(armParts), standard({ vertexColors: true, roughness: 0.36, metalness: 0.05, emissive: new THREE.Color(LEVEL), emissiveIntensity: 0.1 }));
  arm.position.set(CX, CY, Z);
  rig.add(arm);

  const COS_R = 0.066;
  const cosLeg = mesh(rodX(COS_R), paint(COS));
  const sinLeg = mesh(rodY(COS_R), paint(SIN));
  const level = mesh(rodX(0.05), paint(LEVEL));
  const bead = mesh(new THREE.SphereGeometry(0.17, 24, 16), paint(LEVEL));
  rig.add(cosLeg, sinLeg, level, bead);

  const pose = (theta) => {
    const c = Math.cos(theta); const s = Math.sin(theta);
    const rimX = CX + R * c; const rimY = CY + R * s;
    arm.rotation.z = theta;
    cosLeg.position.set(CX, CY, Z);
    cosLeg.rotation.z = c >= 0 ? 0 : Math.PI;
    cosLeg.scale.x = Math.max(0.001, Math.abs(R * c) + COS_R);
    sinLeg.position.set(rimX, CY - (s >= 0 ? COS_R : -COS_R), Z);
    sinLeg.rotation.z = s >= 0 ? 0 : Math.PI;
    sinLeg.scale.y = Math.max(0.001, Math.abs(R * s) + COS_R);
    const th = ((theta % TAU) + TAU) % TAU;
    const wx = waveX(th);
    bead.position.set(wx, rimY, Z);
    level.position.set(rimX, rimY, Z);
    level.scale.x = Math.max(0.001, wx - rimX);
  };
  const OMEGA = TAU / TURN_SECONDS;
  let theta = START_DEG * DEG;
  pose(theta);
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      theta = (theta + OMEGA * dt) % TAU;
      pose(theta);
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// CONE, SPHERE AND CYLINDER
// ===========================================================================================
//
// A quarter-and-a-bit of each solid is cut away toward the walk-up, and the cut is opaque: wall and
// liquid come through the same wedge() with the same two angles, so their faces lie in one plane. The
// tubes behind hold the same real volumes, which is why they are as fat as they are: at this radius
// the levels are worked out from the formulas, never picked.

const AV_R = 1.5;
const AV_H = 2 * AV_R;
const AV_TUBE_R = 1.15;
export const VOLUMES = {
  r: AV_R,
  h: AV_H,
  cone: (Math.PI * AV_R * AV_R * AV_H) / 3,
  sphere: (4 * Math.PI * AV_R ** 3) / 3,
  cylinder: Math.PI * AV_R * AV_R * AV_H,
  tubeRadius: AV_TUBE_R,
};
const fillLevel = (volume) => volume / (Math.PI * AV_TUBE_R * AV_TUBE_R);
VOLUMES.levels = { cone: fillLevel(VOLUMES.cone), sphere: fillLevel(VOLUMES.sphere), cylinder: fillLevel(VOLUMES.cylinder) };

function buildArchimedes() {
  const r = AV_R; const h = AV_H; const t = 0.075;
  const root = new THREE.Group();
  const PITCH = 3.78;
  const SOLID_Y = 1.0; const SOLID_Z = 0.4;
  const CUT = 48 * DEG; const A0 = CUT; const A1 = TAU - CUT;
  const SHELF_Y = 2.3; const TUBE_Z = -2.95;
  const BOARD_Z = -4.42; const BOARD_W = 11.7; const BOARD_Y1 = 9.5; const BOARD_H = BOARD_Y1 - SHELF_Y;
  const SHELL = 0xe2dccb; const BRASS = 0xc39a42; const WALNUT = 0x7a4f30; const OAK = 0x94683f;
  const LIQ = { cone: '#f2a31c', sphere: '#d9326f', cylinder: '#0f9fae' };
  const LIQ3 = { cone: 0xf2a31c, sphere: 0xd9326f, cylinder: 0x0f9fae };
  const solids = [
    { key: 'cone', name: 'Cone', x: -PITCH, formula: 'V = 1/3 π r² h', parts: 1 },
    { key: 'sphere', name: 'Sphere', x: 0, formula: 'V = 4/3 π r³', parts: 2 },
    { key: 'cylinder', name: 'Cylinder', x: PITCH, formula: 'V = π r² h', parts: 3 },
  ];

  const hard = [];
  const plain = (g) => { g.deleteAttribute('uv'); return g; };
  const add = (g, color, x = 0, y = 0, z = 0) => { g.translate(x, y, z); hard.push({ geometry: plain(g), color }); };
  const cutSolid = (poly, color, x, segs = 72) => add(wedge(poly, A0, A1, segs), color, x, SOLID_Y, SOLID_Z);

  // --- The cone ---
  {
    const x = -PITCH;
    const k = Math.hypot(h, r) / h;
    const ri0 = r * (1 - t / h) - t * k;
    const ya = h * (1 - (t * k) / r);
    cutSolid([[0, 0], [r, 0], [0, h], [0, ya], [ri0, t], [0, t]], SHELL, x);
    const ri = ri0 - 0.002;
    cutSolid([[0, t + 0.002], [ri, t + 0.002], [0, ya - 0.004]], LIQ3.cone, x);
    cutSolid([[r - 0.02, 0], [r + 0.045, 0], [r + 0.045, 0.14], [r - 0.09, 0.2]], BRASS, x);
  }
  // --- The sphere, in a brass cup that is not cut, so the notch shows what it sits in ---
  {
    const N = 40;
    const outer = []; const inner = [];
    for (let i = 0; i <= N; i++) {
      const a = -Math.PI / 2 + (i / N) * Math.PI;
      outer.push([Math.max(0, r * Math.cos(a)), r + r * Math.sin(a)]);
      inner.push([Math.max(0, (r - t) * Math.cos(a)), r + (r - t) * Math.sin(a)]);
    }
    cutSolid([...outer, ...[...inner].reverse()], SHELL, 0);
    const liquid = inner.map(([ri, yi]) => [Math.max(0, ri - 0.002), yi]);
    cutSolid(liquid, LIQ3.sphere, 0);
    const band = [];
    for (let i = -2; i <= 2; i++) {
      const y = r + (i / 2) * 0.09;
      band.push([Math.sqrt(r * r - (y - r) ** 2) + 0.03, y]);
    }
    cutSolid([[r - 0.04, r - 0.09], ...band, [r - 0.04, r + 0.09]], BRASS, 0, 72);
    add(turned([[0, 0], [1.05, 0], [1.05, 0.05], [0.92, 0.14], [0.74, 0.17], [0.62, 0.17], [0, 0.17]], 48), BRASS, 0, SOLID_Y, SOLID_Z);
  }
  // --- The cylinder ---
  {
    const x = PITCH;
    cutSolid([[0, 0], [r, 0], [r, h], [0, h], [0, h - t], [r - t, h - t], [r - t, t], [0, t]], SHELL, x);
    cutSolid([[0, t + 0.002], [r - t - 0.002, t + 0.002], [r - t - 0.002, h - t - 0.002], [0, h - t - 0.002]], LIQ3.cylinder, x);
    cutSolid([[r - 0.02, 0], [r + 0.045, 0], [r + 0.045, 0.14], [r - 0.02, 0.14]], BRASS, x);
    cutSolid([[r - 0.02, h - 0.14], [r + 0.045, h - 0.14], [r + 0.045, h + 0.01], [r - 0.02, h + 0.01]], BRASS, x);
  }

  // --- The tubes, three identical ones, each holding one solid's real volume ---
  const glassParts = [];
  const hoops = [];
  const RO = AV_TUBE_R + 0.09;
  const FOOT = 0.18;
  const TUBE_B = SHELF_Y + FOOT;
  const TUBE_TOP = TUBE_B + VOLUMES.levels.cylinder + 0.3;
  const part = VOLUMES.levels.cone; // one part, in feet of tube
  for (const s of solids) {
    const level = TUBE_B + VOLUMES.levels[s.key];
    add(turned([[0, 0], [RO + 0.2, 0], [RO + 0.2, 0.08], [RO + 0.12, 0.12], [RO + 0.04, 0.18], [0, 0.18]], 64), BRASS, s.x, SHELF_Y - 0.002, TUBE_Z);
    // The liquid column, its surface a pale disc so the level can be read from above and below.
    const ri = AV_TUBE_R - 0.004;
    add(turned([[0, TUBE_B], [ri, TUBE_B], [ri, level], [0, level]], 64, { crease: 30 }), LIQ3[s.key], s.x, 0, TUBE_Z);
    // The graduations: one hoop for each part, the same on all three.
    for (let k = 1; k <= 3; k++) {
      const y = TUBE_B + k * part;
      const ring = [];
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * TAU;
        ring.push([RO + 0.006 - Math.cos(a) * 0.026, y + Math.sin(a) * 0.026]);
      }
      const hoop = plain(turned(ring, 72, { crease: 60 }));
      hoop.translate(s.x, 0, TUBE_Z);
      hoops.push({ geometry: hoop, color: 0xf4efe0 });
    }
    // These cast nothing: thin rings round a clear tube throw loops across the board behind.
    const rim = plain(turned([[AV_TUBE_R - 0.03, TUBE_TOP - 0.1], [RO + 0.05, TUBE_TOP - 0.1], [RO + 0.05, TUBE_TOP + 0.05], [AV_TUBE_R - 0.03, TUBE_TOP + 0.05], [AV_TUBE_R - 0.03, TUBE_TOP - 0.1]], 64));
    rim.translate(s.x, 0, TUBE_Z);
    hoops.push({ geometry: rim, color: BRASS });
    const wall = turned([[AV_TUBE_R, TUBE_B], [RO, TUBE_B], [RO, TUBE_TOP], [AV_TUBE_R, TUBE_TOP], [AV_TUBE_R, TUBE_B]], 72, { crease: 40 });
    wall.translate(s.x, 0, TUBE_Z);
    glassParts.push({ geometry: plain(wall), color: 0xe4f1f6 });
  }
  root.add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.46, metalness: 0.04 })));
  const glass = noShadow(mesh(mergeParts(glassParts), standard({ vertexColors: true, transparent: true, opacity: 0.2, roughness: 0.12, metalness: 0, depthWrite: false })));
  root.add(glass);
  root.add(noShadow(mesh(mergeParts(hoops), standard({ vertexColors: true, roughness: 0.46, metalness: 0.04 }))));

  // --- The printing: the back board, three graduated scales and three name plates ---
  const BPPF = 2048 / BOARD_W;
  const BH_PX = Math.round(BOARD_H * BPPF);
  const SCALE_W = 0.78; const SCALE_H = TUBE_TOP - TUBE_B + 0.28;
  const SPPF = 170;
  const SW_PX = Math.round(SCALE_W * SPPF); const SH_PX = Math.round(SCALE_H * SPPF);
  const PLATE_W = 3.42; const PLATE_H = 0.94;
  const PPPF = 172;
  const PW_PX = Math.round(PLATE_W * PPPF); const PH_PX = Math.round(PLATE_H * PPPF);
  const CW = 2048 + 8 + 3 * (SW_PX + 8);
  const CH = Math.max(BH_PX, SH_PX) + 8 + PH_PX;
  const scaleRect = (i) => [2056 + i * (SW_PX + 8), 0, SW_PX, SH_PX];
  const plateRect = (i) => [i * (PW_PX + 8), CH - PH_PX, PW_PX, PH_PX];
  const map = canvasTexture(CW, CH, (ctx) => {
    ctx.fillStyle = '#e8e2d2';
    ctx.fillRect(0, 0, CW, CH);
    // The back board.
    const g = ctx.createLinearGradient(0, 0, 0, BH_PX);
    g.addColorStop(0, '#1c3049');
    g.addColorStop(1, '#14233a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 2048, BH_PX);
    const BX = (x) => (x + BOARD_W / 2) * BPPF;
    const BY = (y) => (BOARD_Y1 - y) * BPPF;
    fitted(ctx, '1 : 2 : 3', BX(0), BY(BOARD_Y1 - 0.5), 3.6 * BPPF, 0.86 * BPPF, { color: '#ffffff' });
    fitted(ctx, 'Same width. Same height.', BX(-BOARD_W / 2 + 0.28), BY(BOARD_Y1 - 0.42), 3.5 * BPPF, 0.36 * BPPF, { align: 'left', color: '#f2ece0' });
    // Archimedes' own figure, a sphere in a cylinder, with what he proved about it.
    const ex = BX(BOARD_W / 2 - 3.3); const ey = BY(BOARD_Y1 - 0.53);
    const es = 0.37 * BPPF;
    ctx.strokeStyle = '#e9d9a6'; ctx.lineWidth = 6;
    ctx.strokeRect(ex - es, ey - es, es * 2, es * 2);
    ctx.fillStyle = '#d9326f';
    ctx.beginPath(); ctx.arc(ex, ey, es - 4, 0, TAU); ctx.fill();
    const tx = ex + es + 0.14 * BPPF;
    fitted(ctx, 'A sphere holds 2/3', tx, BY(BOARD_Y1 - 0.26), 2.35 * BPPF, 0.24 * BPPF, { weight: '600', align: 'left', color: '#e6edf4' });
    fitted(ctx, 'of the cylinder', tx, BY(BOARD_Y1 - 0.54), 2.35 * BPPF, 0.24 * BPPF, { weight: '600', align: 'left', color: '#e6edf4' });
    fitted(ctx, 'around it.', tx, BY(BOARD_Y1 - 0.82), 2.35 * BPPF, 0.24 * BPPF, { weight: '600', align: 'left', color: '#e6edf4' });

    // The three graduated scales: identical but for the name at the head.
    solids.forEach((s, i) => {
      const [x0, y0, w, hh] = scaleRect(i);
      ctx.fillStyle = '#ece6d6';
      ctx.fillRect(x0, y0, w, hh);
      const SY = (y) => y0 + (TUBE_TOP + 0.14 - y) * SPPF;
      ctx.fillStyle = '#20262f';
      for (let k = 0; k <= 30; k++) {
        const y = TUBE_B + (k / 10) * part;
        const major = k % 10 === 0; const mid = k % 5 === 0;
        const len = major ? w * 0.42 : mid ? w * 0.28 : w * 0.16;
        ctx.fillRect(x0, SY(y) - (major ? 3 : 1), len, major ? 6 : 2);
      }
      for (let k = 1; k <= 3; k++) {
        const y = TUBE_B + k * part;
        fitted(ctx, String(k), x0 + w * 0.72, SY(y) - 0.02 * SPPF, w * 0.5, 0.34 * SPPF, { color: '#20262f' });
        fitted(ctx, k === 1 ? 'part' : 'parts', x0 + w * 0.72, SY(y) + 0.2 * SPPF, w * 0.54, 0.16 * SPPF, { weight: '600', color: '#3d4652' });
      }
      fitted(ctx, s.name, x0 + w / 2, y0 + 0.14 * SPPF, w * 0.92, 0.2 * SPPF, { color: LIQ[s.key] === '#f2a31c' ? '#b56f00' : LIQ[s.key] });
    });

    // The name plates.
    solids.forEach((s, i) => {
      const [x0, y0, w, hh] = plateRect(i);
      ctx.fillStyle = '#efe9da';
      ctx.fillRect(x0, y0, w, hh);
      ctx.fillStyle = LIQ[s.key];
      ctx.fillRect(x0, y0, 0.16 * PPPF, hh);
      const px = x0 + 0.32 * PPPF;
      fitted(ctx, s.name, px, y0 + hh * 0.3, 1.5 * PPPF, 0.42 * PPPF, { align: 'left', color: '#1e2530' });
      fitted(ctx, s.formula, px, y0 + hh * 0.74, 1.95 * PPPF, 0.32 * PPPF, { weight: '600', align: 'left', color: '#2c3440' });
      fitted(ctx, String(s.parts), x0 + w - 0.62 * PPPF, y0 + hh * 0.38, 0.8 * PPPF, 0.62 * PPPF, { color: '#1e2530' });
      fitted(ctx, s.parts === 1 ? 'part' : 'parts', x0 + w - 0.62 * PPPF, y0 + hh * 0.79, 0.9 * PPPF, 0.25 * PPPF, { weight: '600', color: '#3d4652' });
    });
  });
  map.anisotropy = 8;

  const printed = [];
  const board = printedPlate(BOARD_W, BOARD_H, 0.14, rectUV(CW, CH, 0, 0, 2048, BH_PX));
  board.translate(0, SHELF_Y + BOARD_H / 2, BOARD_Z);
  printed.push({ geometry: board, color: 0xffffff });
  solids.forEach((s, i) => {
    const sc = printedPlate(SCALE_W, SCALE_H, 0.07, rectUV(CW, CH, ...scaleRect(i)));
    sc.translate(s.x + RO + 0.05 + SCALE_W / 2, TUBE_TOP + 0.14 - SCALE_H / 2, TUBE_Z);
    printed.push({ geometry: sc, color: 0xffffff });
  });
  // The sloping front of the plinth carries the name plates.
  const slope = new THREE.Vector3(0, 0.7, -0.85).normalize();
  const normal = new THREE.Vector3(0, 0.85, 0.7).normalize();
  const slopeM = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), slope, normal);
  solids.forEach((s, i) => {
    const pl = printedPlate(PLATE_W, PLATE_H, 0.07, rectUV(CW, CH, ...plateRect(i)));
    pl.applyMatrix4(slopeM);
    pl.translate(s.x, 0.65 + normal.y * 0.05, 2.575 + normal.z * 0.05);
    printed.push({ geometry: pl, color: 0xffffff });
  });
  root.add(mesh(mergeParts(printed), standard({ vertexColors: true, map, roughness: 0.7, metalness: 0 })));

  // --- The plinth, one stepped walnut section, with a moulding along each edge ---
  const wood = [];
  const HW = 5.95;
  const sec = [[3.0, 0], [3.0, 0.3], [2.15, 1.0], [-1.55, 1.0], [-1.55, SHELF_Y], [-4.7, SHELF_Y], [-4.7, 0]];
  wood.push({ geometry: prismX(sec, -HW, HW), color: WALNUT });
  wood.push({ geometry: prismX([[3.08, -0.0], [3.08, 0.14], [3.0, 0.2], [-4.78, 0.2], [-4.86, 0.14], [-4.86, 0]], -HW - 0.08, HW + 0.08), color: 0x5e3b22 });
  wood.push({ geometry: prismX([[2.2, 0.98], [2.2, 1.05], [-1.5, 1.05], [-1.5, 0.98]], -HW - 0.03, HW + 0.03), color: OAK });
  wood.push({ geometry: prismX([[-1.5, SHELF_Y - 0.03], [-1.5, SHELF_Y + 0.05], [-4.5, SHELF_Y + 0.05], [-4.5, SHELF_Y - 0.03]], -HW - 0.03, HW + 0.03), color: OAK });
  // The board's frame.
  const F = 0.16;
  const fz = BOARD_Z - 0.02;
  const fh = BOARD_W / 2 + F / 2;
  const fTop = BOARD_Y1 + F / 2;
  wood.push({ geometry: timber([-fh - F / 2, fTop, fz], [fh + F / 2, fTop, fz], F, 0.3, { up: [0, 0, 1], seed: 2 }), color: WALNUT });
  wood.push({ geometry: timber([-fh, SHELF_Y, fz], [-fh, fTop, fz], F, 0.3, { up: [0, 0, 1], seed: 3 }), color: WALNUT });
  wood.push({ geometry: timber([fh, SHELF_Y, fz], [fh, fTop, fz], F, 0.3, { up: [0, 0, 1], seed: 4 }), color: WALNUT });
  // The board's back, for anyone who walks round.
  wood.push({ geometry: timber([-BOARD_W / 2, (SHELF_Y + BOARD_Y1) / 2, BOARD_Z - 0.2], [BOARD_W / 2, (SHELF_Y + BOARD_Y1) / 2, BOARD_Z - 0.2], BOARD_H, 0.1, { up: [0, 0, 1], chamfer: 0.012, seed: 5 }), color: OAK });
  root.add(mesh(mergeParts(wood), woodMaterial(225)));
  return root;
}

// ===========================================================================================
// ROLLING OUT PI
// ===========================================================================================
//
// The rolling is exact: the wheel's turn is always its distance divided by its radius, and everything
// that moves is read from that one distance. The painted mark starts on the ruler's 0 and comes down
// again on pi. Behind the wheel a strip in the mark's colour is laid along the ruler, which is the
// circumference unrolled, and it ends at the contact point because it has one description.

const PW_R = 1.5;
const PW_D = 2 * PW_R;
export const PI_WHEEL = {
  R: PW_R,
  D: PW_D,
  X0: (-Math.PI * PW_D) / 2, // the 0 on the ruler
  CIRCUMFERENCE: TAU * PW_R,
  TRACK_Y: 2.0,
  ROLL: 9,
  HOLD: 2.5,
  BACK: 9,
  REST: 1.6,
  START_FRACTION: 2 / 3,
};
// Where the wheel has got to, in feet along the ruler, at a time in its cycle.
export function piWheelDistance(tau) {
  const { ROLL, HOLD, BACK, REST, CIRCUMFERENCE } = PI_WHEEL;
  const cycle = ROLL + HOLD + BACK + REST;
  const t = ((tau % cycle) + cycle) % cycle;
  const ease = (u) => u * u * (3 - 2 * u);
  if (t < ROLL) return CIRCUMFERENCE * ease(t / ROLL);
  if (t < ROLL + HOLD) return CIRCUMFERENCE;
  if (t < ROLL + HOLD + BACK) return CIRCUMFERENCE * (1 - ease((t - ROLL - HOLD) / BACK));
  return 0;
}
// The turn is the distance over the radius, the rule for rolling without slipping.
export const piWheelTurn = (distance) => distance / PW_R;

function buildPiWheel() {
  const { R, D, X0, CIRCUMFERENCE, TRACK_Y: Y, ROLL, START_FRACTION } = PI_WHEEL;
  const root = new THREE.Group();
  const MARK = '#ff5a12'; const MARK3 = 0xff5a12;
  const BLUE = '#1f78d0'; const BLUE2 = '#2f93e6'; const BLUE3 = 0x1f78d0;
  const xAt = (d) => X0 + d * D;
  const RULER_L = 11.6; const TRACK_L = 11.7; const CAP_L = 11.3; const CAP_H = 0.66; const CAP_Y = 5.46;
  const RULER_H = 0.86; const TRACK_W = 1.22; const BAR_W = 0.36;

  // --- The printing ---
  const W = 2048;
  const rows = {
    ruler: { y: 0, h: 160 },
    track: { y: 168, h: 214 },
    cap: { y: 390, h: 120 },
    bars: { y: 518, h: 66 },
    flags: { y: 592, h: 78 },
  };
  const H = 678;
  const barPx = 3 * 170;
  const barRect = (i) => [i * (barPx + 4), rows.bars.y, barPx, rows.bars.h];
  const restRect = [3 * (barPx + 4), rows.bars.y, 74, rows.bars.h];
  const flagRect = (i) => [i * 124, rows.flags.y, 116, rows.flags.h];
  const map = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#8b8f92';
    ctx.fillRect(0, 0, W, H);

    // The ruler: boxwood, in units of the wheel's own diameter.
    {
      const { y: y0, h } = rows.ruler;
      const px = W / RULER_L;
      const X = (x) => (x + RULER_L / 2) * px;
      ctx.fillStyle = '#ecdcb0';
      ctx.fillRect(0, y0, W, h);
      ctx.fillStyle = '#2c2418';
      for (let k = 0; k <= 34; k++) {
        const d = k / 10;
        const x = X(xAt(d));
        const major = k % 10 === 0; const mid = k % 5 === 0;
        const len = major ? h * 0.66 : mid ? h * 0.4 : h * 0.24;
        const wd = major ? 7 : mid ? 4 : 3;
        ctx.fillRect(x - wd / 2, y0, wd, len);
      }
      for (let d = 0; d <= 3; d++) {
        fitted(ctx, String(d), X(xAt(d)) + 10, y0 + h * 0.62, 90, 92, { align: 'left', color: '#20190f' });
      }
      fitted(ctx, 'wheel diameters', X(xAt(0.5)), y0 + h * 0.8, 340, 36, { weight: '600', color: '#4a3f2b' });
      const xp = X(xAt(Math.PI));
      ctx.fillStyle = MARK;
      ctx.fillRect(xp - 5, y0, 10, h);
      fitted(ctx, 'π', xp + 14, y0 + h * 0.3, 70, 70, { align: 'left', color: '#d9420a' });
      fitted(ctx, '= 3.14159...', xp + 14, y0 + h * 0.72, 126, 30, { align: 'left', color: '#20190f' });
    }
    // The track: dark, with a line right across at every diameter and a bright one at pi.
    {
      const { y: y0, h } = rows.track;
      const px = W / TRACK_L;
      const X = (x) => (x + TRACK_L / 2) * px;
      ctx.fillStyle = '#3e4750';
      ctx.fillRect(0, y0, W, h);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 6; i++) ctx.fillRect(0, y0 + (i + 0.5) * (h / 6), W, 2);
      for (let d = 0; d <= 3; d++) {
        ctx.fillStyle = '#f2f0e6';
        ctx.fillRect(X(xAt(d)) - 4, y0, 8, h);
      }
      ctx.fillStyle = MARK;
      ctx.fillRect(X(xAt(Math.PI)) - 6, y0, 12, h);
    }
    // The caption rail, which reads at any moment since the wheel can hide only one half.
    {
      const { y: y0, h } = rows.cap;
      const px = W / CAP_L;
      ctx.fillStyle = '#17304e';
      ctx.fillRect(0, y0, W, h);
      fitted(ctx, 'One full turn of the wheel...', W * 0.26, y0 + h / 2, W * 0.44, 0.38 * px, { color: '#ffffff' });
      fitted(ctx, '...rolls out just over 3 diameters: π.', W * 0.74, y0 + h / 2, W * 0.46, 0.38 * px, { color: '#ffd8bf' });
    }
    // The diameter bars, and the little bit left over.
    for (let i = 0; i < 3; i++) {
      const [x, y, w, h] = barRect(i);
      ctx.fillStyle = i % 2 ? BLUE2 : BLUE;
      ctx.fillRect(x, y, w, h);
      fitted(ctx, '1 diameter', x + w / 2, y + h / 2, w * 0.8, 40, { color: '#ffffff' });
    }
    {
      const [x, y, w, h] = restRect;
      ctx.fillStyle = MARK;
      ctx.fillRect(x, y, w, h);
      fitted(ctx, '0.14', x + w / 2, y + h / 2, w * 0.86, 30, { color: '#ffffff' });
    }
    // The two flags.
    {
      const [x, y, w, h] = flagRect(0);
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(x, y, w, h);
      fitted(ctx, '0', x + w / 2, y + h / 2 + 2, w * 0.8, 62, { color: '#1e2530' });
    }
    {
      const [x, y, w, h] = flagRect(1);
      ctx.fillStyle = MARK;
      ctx.fillRect(x, y, w, h);
      fitted(ctx, 'π', x + w / 2, y + h / 2 - 2, w * 0.8, 66, { color: '#ffffff' });
    }
  });
  map.anisotropy = 8;

  const printed = [];
  const flat = (g, x, y, z) => { g.rotateX(-Math.PI / 2); g.translate(x, y, z); return g; };
  // The ruler lies on the bench's sloping front.
  const SLOPE_FROM = [1.86, Y - 0.56]; const SLOPE_TO = [1.02, Y - 0.08];
  const slope = new THREE.Vector3(0, SLOPE_TO[1] - SLOPE_FROM[1], SLOPE_TO[0] - SLOPE_FROM[0]).normalize();
  const normal = new THREE.Vector3(0, -slope.z, slope.y);
  const slopeM = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), slope, normal);
  const ruler = printedPlate(RULER_L, RULER_H, 0.06, rectUV(W, H, 0, rows.ruler.y, W, rows.ruler.h));
  ruler.applyMatrix4(slopeM);
  ruler.translate(0, (SLOPE_FROM[1] + SLOPE_TO[1]) / 2 + normal.y * 0.035, (SLOPE_FROM[0] + SLOPE_TO[0]) / 2 + normal.z * 0.035);
  printed.push({ geometry: ruler, color: 0xffffff });
  printed.push({ geometry: flat(printedPlate(TRACK_L, TRACK_W, 0.06, rectUV(W, H, 0, rows.track.y, W, rows.track.h)), 0, Y, 0), color: 0xffffff });
  const cap = printedPlate(CAP_L, CAP_H, 0.06, rectUV(W, H, 0, rows.cap.y, W, rows.cap.h));
  cap.translate(0, CAP_Y, -0.82);
  printed.push({ geometry: cap, color: 0xffffff });
  // Three diameters laid end to end on the ledge, and the piece that is left over.
  const LEDGE_Z = 0.8; const LEDGE_Y = Y - 0.08;
  for (let i = 0; i < 3; i++) {
    const bar = printedPlate(D - 0.01, BAR_W, 0.11, rectUV(W, H, ...barRect(i)));
    printed.push({ geometry: flat(bar, xAt(i + 0.5), LEDGE_Y + 0.11, LEDGE_Z), color: 0xffffff });
  }
  {
    const rest = (Math.PI - 3) * D;
    const piece = printedPlate(rest - 0.01, BAR_W, 0.11, rectUV(W, H, ...restRect));
    printed.push({ geometry: flat(piece, xAt(3) + rest / 2, LEDGE_Y + 0.11, LEDGE_Z), color: 0xffffff });
  }
  // The flags stand behind the track, at 0 and at pi.
  const FLAG_W = 0.66; const FLAG_H = 0.44; const FLAG_Z = -0.72;
  for (const [i, d] of [[0, 0], [1, Math.PI]]) {
    const f = printedPlate(FLAG_W, FLAG_H, 0.05, rectUV(W, H, ...flagRect(i)));
    f.translate(xAt(d), 2.9, FLAG_Z + 0.04);
    printed.push({ geometry: f, color: 0xffffff });
  }
  root.add(mesh(mergeParts(printed), standard({ vertexColors: true, map, roughness: 0.66, metalness: 0 })));

  // --- The bench ---
  const wood = [];
  const HW = 5.95;
  const WALNUT = 0x7a4f30; const DARK = 0x6a452a; const OAK = 0x94683f;
  const sec = [[1.9, Y - 0.72], [1.9, Y - 0.56], [1.02, Y - 0.08], [0.61, Y - 0.08], [0.61, Y - 0.02], [-0.61, Y - 0.02], [-0.61, Y - 0.12], [-1.16, Y - 0.12], [-1.16, Y - 0.72]];
  wood.push({ geometry: prismX(sec, -HW, HW), color: WALNUT });
  // Two trestles and a stretcher.
  for (const [i, x] of [-4.7, 4.7].entries()) {
    const yTop = Y - 0.72;
    wood.push({ geometry: timber([x, 0.14, 1.75], [x, 0.14, -1.6], 0.34, 0.28, { seed: i }), color: DARK });
    wood.push({ geometry: timber([x, 0.1, 1.05], [x, yTop + 0.02, 0.5], 0.3, 0.3, { up: [1, 0, 0], seed: i + 2 }), color: DARK });
    wood.push({ geometry: timber([x, 0.1, -1.0], [x, yTop + 0.02, -0.5], 0.3, 0.3, { up: [1, 0, 0], seed: i + 4 }), color: DARK });
    wood.push({ geometry: timber([x, yTop - 0.1, 1.55], [x, yTop - 0.1, -1.0], 0.34, 0.2, { seed: i + 6 }), color: OAK });
  }
  wood.push({ geometry: timber([-4.8, 0.72, 0], [4.8, 0.72, 0], 0.3, 0.34, { up: [0, 1, 0], seed: 9 }), color: OAK });
  root.add(mesh(mergeParts(wood), woodMaterial(314)));

  // --- The guide rail that keeps the wheel upright, and what holds it ---
  const metal = [];
  const add = (g, color) => { g.deleteAttribute('uv'); metal.push({ geometry: g, color }); };
  const RAIL_Y = Y + R; const RAIL_Z = -0.92;
  const STEEL = 0x98a2ac; const IRON = 0x47515b; const BRASS = 0xc39a42;
  add(prismX([[RAIL_Z + 0.09, RAIL_Y - 0.14], [RAIL_Z + 0.13, RAIL_Y - 0.1], [RAIL_Z + 0.13, RAIL_Y + 0.1], [RAIL_Z + 0.09, RAIL_Y + 0.14], [RAIL_Z - 0.09, RAIL_Y + 0.14], [RAIL_Z - 0.13, RAIL_Y + 0.1], [RAIL_Z - 0.13, RAIL_Y - 0.1], [RAIL_Z - 0.09, RAIL_Y - 0.14]], -5.85, 5.85), STEEL);
  for (const x of [-5.72, 0, 5.72]) {
    add(timber([x, Y - 0.14, RAIL_Z - 0.08], [x, CAP_Y + 0.4, RAIL_Z - 0.08], 0.26, 0.2, { up: [0, 0, 1], chamfer: 0.03 }), IRON);
    const foot = turned([[0, 0], [0.26, 0], [0.26, 0.06], [0.18, 0.1], [0, 0.1]], 18);
    foot.translate(x, Y - 0.13, RAIL_Z - 0.08);
    add(foot, BRASS);
  }
  // The caption's backing and its frame.
  add(timber([-CAP_L / 2 - 0.04, CAP_Y, -0.93], [CAP_L / 2 + 0.04, CAP_Y, -0.93], CAP_H + 0.08, 0.1, { up: [0, 0, 1], chamfer: 0.02 }), IRON);
  // The two flag posts.
  for (const d of [0, Math.PI]) {
    add(rod([xAt(d), Y - 0.14, FLAG_Z], [xAt(d), 3.1, FLAG_Z], 0.05, 10, 1), d ? MARK3 : 0xe9e4d6);
  }
  root.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.5, metalness: 0.2 })));

  // --- The wheel, authored with its mark straight down, turning about Z ---
  const wheel = [];
  const put = (g, color) => { g.rotateX(Math.PI / 2); g.deleteAttribute('uv'); wheel.push({ geometry: g, color }); };
  const TYRE = 0x2b2d30; const RIM = 0xc9d0d6; const SPOKE = 0xaeb7bf;
  const RT = R - 0.035; // the tyre's body; the lugs carry it out to the true radius
  put(turned([[1.1, -0.3], [1.27, -0.37], [1.4, -0.365], [RT - 0.015, -0.3], [RT, -0.24], [RT, 0.24], [RT - 0.015, 0.3], [1.4, 0.365], [1.27, 0.37], [1.1, 0.3], [1.1, -0.3]], 120, { crease: 40 }), TYRE);
  // The tread: real lugs whose tops lie exactly on the rolling radius.
  const LUGS = 40;
  const MARK_HALF = 8.5 * DEG;
  for (let i = 0; i < LUGS; i++) {
    const a = ((i + 0.5) / LUGS) * TAU;
    const half = (TAU / LUGS) * 0.31;
    if (a - half < MARK_HALF + 0.03 || a + half > TAU - MARK_HALF - 0.03) continue;
    const skew = (i % 2 ? 1 : -1);
    const y0 = skew > 0 ? -0.28 : -0.05; const y1 = skew > 0 ? 0.05 : 0.28;
    put(wedge([[RT - 0.02, y0], [R, y0], [R, y1], [RT - 0.02, y1]], a - half, a + half, 2, { crease: 25 }), 0x34373b);
  }
  put(turned([[1.0, -0.16], [1.04, -0.24], [1.12, -0.31], [1.15, -0.31], [1.15, 0.31], [1.12, 0.31], [1.04, 0.24], [1.0, 0.16], [1.0, -0.16]], 96, { crease: 30 }), RIM);
  // The hub.
  put(turned([[0, -0.4], [0.17, -0.4], [0.2, -0.34], [0.2, -0.22], [0.3, -0.18], [0.3, 0.18], [0.2, 0.22], [0.2, 0.34], [0.15, 0.42], [0, 0.44]], 32, { crease: 35 }), BRASS);
  // The spokes, dished the way a real wheel's are, rooted in the hub and in the rim.
  const SPOKES = 14;
  for (let i = 0; i < SPOKES; i++) {
    const a = ((i + 0.5) / SPOKES) * TAU;
    const z = i % 2 ? 0.14 : -0.14;
    const s = Math.sin(a); const c = -Math.cos(a);
    wheel.push({ geometry: rod([s * 0.22, c * 0.22, z], [s * 1.04, c * 1.04, 0], 0.036, 8, 1), color: SPOKE });
  }
  // The painted mark: a block of the tyre's own section, standing out to the true radius.
  const markPoly = [[0.98, -0.18], [1.1, -0.325], [1.27, -0.385], [1.41, -0.38], [R, -0.31], [R, 0.31], [1.41, 0.38], [1.27, 0.385], [1.1, 0.325], [0.98, 0.18]];
  put(wedge(markPoly, -MARK_HALF, MARK_HALF, 6, { crease: 25 }), MARK3);
  // A diameter of the wheel, across its face, in the same blue as the bars on the ledge.
  {
    const bw = BAR_W * 0.5; const bz0 = 0.4; const bz1 = 0.47;
    const hw = R - 0.01;
    const bar = timber([-hw, 0, (bz0 + bz1) / 2], [hw, 0, (bz0 + bz1) / 2], bw, bz1 - bz0, { up: [0, 0, 1], chamfer: 0.012 });
    bar.deleteAttribute('uv');
    wheel.push({ geometry: bar, color: BLUE3 });
    put(turned([[0, 0.38], [0.2, 0.38], [0.2, 0.5], [0.14, 0.53], [0, 0.54]], 28, { crease: 35 }), BRASS);
  }
  const wheelMesh = mesh(mergeParts(wheel), standard({ vertexColors: true, roughness: 0.62, metalness: 0.06 }));

  // --- What moves ---
  const hub = new THREE.Group();
  root.add(hub);
  hub.add(wheelMesh);
  const slider = [];
  const sl = (g, color) => { g.deleteAttribute('uv'); slider.push({ geometry: g, color }); };
  sl(timber([-0.4, 0, RAIL_Z], [0.4, 0, RAIL_Z], 0.44, 0.5, { up: [0, 0, 1], chamfer: 0.05 }), 0x56616c);
  {
    const ax = turned([[0, -0.1], [0.09, -0.1], [0.09, 0.62], [0, 0.62]], 16);
    ax.rotateX(Math.PI / 2);
    ax.translate(0, 0, RAIL_Z + 0.2);
    sl(ax, 0xb9c2ca);
  }
  hub.add(mesh(mergeParts(slider), standard({ vertexColors: true, roughness: 0.46, metalness: 0.2 })));

  const stripGeo = new THREE.BoxGeometry(1, 0.026, 0.5);
  stripGeo.translate(0.5, 0, 0);
  const strip = mesh(stripGeo, standard({ color: new THREE.Color(MARK), roughness: 0.55, emissive: new THREE.Color(MARK), emissiveIntensity: 0.1 }));
  strip.position.set(X0, Y + 0.002, 0);
  root.add(strip);

  const pose = (s) => {
    hub.position.set(X0 + s, Y + R, 0);
    wheelMesh.rotation.z = -piWheelTurn(s);
    strip.scale.x = Math.max(0.001, s);
  };
  // The first frame is two thirds of the way along. Solved, rather than guessed, from the ease.
  let lo = 0; let hi = 1;
  for (let i = 0; i < 40; i++) {
    const u = (lo + hi) / 2;
    if (u * u * (3 - 2 * u) < START_FRACTION) lo = u; else hi = u;
  }
  let tau = lo * ROLL;
  pose(piWheelDistance(tau));
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      tau += dt;
      pose(piWheelDistance(tau));
    },
    dispose() {},
  };
  return root;
}

// ===========================================================================================
// THE BINARY COUNTER
// ===========================================================================================
//
// Eleven drums and six meshes allowed, so all eleven are ONE mesh. A drum at rest costs nothing; one
// that is turning has its own vertices and normals rewritten about its axle, and only then. The faces
// are painted once on a texture and their UVs never change, because the HiFi edition follows position
// and normal rewrites and does not follow UVs.
//
// Nothing about the count is remembered between frames. Each drum works out its own position from the
// clock alone, so a slow frame cannot lose a carry, and each is simply later than the one to its right.

export const BINARY = {
  PLACES: [128, 64, 32, 16, 8, 4, 2, 1],
  DECIMALS: [100, 10, 1],
  START: 45, // 00101101
  WRAP: 256,
  TICK: 1,
  TURN: 0.55,
  CARRY: 0.14, // how much later each place starts than the one to its right
};
export const bitOf = (n, place) => Math.floor(n / place) % 2;
export const digitOf = (n, place) => Math.floor(n / place) % 10;
export const binaryString = (n) => BINARY.PLACES.map((p) => bitOf(n, p)).join('');

// A little overshoot and settle, as a detent gives a sprung wheel.
function detentEase(u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const c1 = 1.25; const c3 = c1 + 1;
  const v = u - 1;
  return 1 + c3 * v * v * v + c1 * v * v;
}

function buildBinaryCounter() {
  const { PLACES, DECIMALS, START, WRAP, TICK, TURN, CARRY } = BINARY;
  const root = new THREE.Group();
  const A = 4.0; // the axle's height
  const DR = 0.8; // every drum's radius
  const F = 0.92; // the plane of the window frames
  const LIP = 0.56;
  const DESK_Y = A - 1.2;
  const B_PITCH = 0.78; const B_W = 0.68; const D_PITCH = 0.64; const D_W = 0.56;
  const BODY = 4.62;
  const XL = -4.43;
  const bx = (i) => XL + B_PITCH * (i + 0.5);
  const BIN_R = XL + B_PITCH * 8;
  const DEC_L = BIN_R + 0.7;
  const dx = (i) => DEC_L + D_PITCH * (i + 0.5);
  const DEC_R = DEC_L + D_PITCH * 3;

  // --- The drums' faces ---
  const AW = 512; const AH = 2048;
  const BW_PX = 278; const DW_PX = 220; const DX0 = 286;
  const PPF = AH / (TAU * DR);
  const faces = canvasTexture(AW, AH, (ctx) => {
    ctx.fillStyle = '#2b3036';
    ctx.fillRect(0, 0, AW, AH);
    // A binary drum: 0 on one half, dark, and 1 on the other, bright, so that the byte's pattern can
    // be seen from further off than its digits can be read.
    for (const [bit, bg, fg] of [[0, '#22344a', '#e7eef4'], [1, '#f4b41e', '#1c1710']]) {
      const y0 = bit * (AH / 2);
      ctx.fillStyle = bg;
      ctx.fillRect(0, y0, BW_PX, AH / 2);
      ctx.fillStyle = bit ? 'rgba(120,70,0,0.55)' : 'rgba(160,190,220,0.3)';
      ctx.fillRect(0, y0, BW_PX, 6);
      ctx.fillRect(0, y0 + AH / 2 - 6, BW_PX, 6);
      fitted(ctx, String(bit), BW_PX / 2, y0 + AH / 4 + 8, BW_PX * 0.82, 0.86 * PPF, { color: fg });
    }
    // A decimal drum: ten digits round the rim.
    ctx.fillStyle = '#efe8d6';
    ctx.fillRect(DX0, 0, DW_PX, AH);
    for (let d = 0; d < 10; d++) {
      const yc = (d + 0.5) * (AH / 10);
      ctx.fillStyle = 'rgba(90,80,60,0.28)';
      ctx.fillRect(DX0, yc - AH / 20 - 1, DW_PX, 2);
      fitted(ctx, String(d), DX0 + DW_PX / 2, yc + 6, DW_PX * 0.8, 0.46 * PPF, { color: '#1c1a16' });
    }
  });
  faces.anisotropy = 8;

  // --- All eleven drums, as one buffer ---
  const pos = []; const nrm = []; const uvs = []; const idx = [];
  const SEG = 72;
  const CH = 0.028;
  const drums = [];
  const spotU = 508 / AW; const spotV = 0.5;
  const addDrum = (x, width, u0, u1, alphaStart) => {
    const start = pos.length / 3;
    const hw = width / 2;
    const vert = (px, py, pz, nx, ny, nz, u, v) => { pos.push(px, py, pz); nrm.push(nx, ny, nz); uvs.push(u, v); return pos.length / 3 - 1; };
    const point = (a, r) => [-Math.sin(a) * r, Math.cos(a) * r];
    // The face: its u runs across, and its v down the canvas as the angle runs down the front.
    const left = []; const right = [];
    for (let j = 0; j <= SEG; j++) {
      const a = alphaStart + (j / SEG) * TAU;
      const [y, z] = point(a, DR);
      const ny = -Math.sin(a); const nz = Math.cos(a);
      const v = 1 - j / SEG;
      left.push(vert(x - hw + CH, y, z, 0, ny, nz, u0, v));
      right.push(vert(x + hw - CH, y, z, 0, ny, nz, u1, v));
    }
    for (let j = 0; j < SEG; j++) idx.push(left[j], right[j + 1], right[j], left[j], left[j + 1], right[j + 1]);
    // The chamfers and the ends, in plain dark steel.
    for (const side of [-1, 1]) {
      const inner = []; const outer = []; const capRing = [];
      const n = 0.7071;
      for (let j = 0; j <= SEG; j++) {
        const a = alphaStart + (j / SEG) * TAU;
        const [y0, z0] = point(a, DR);
        const [y1, z1] = point(a, DR - CH);
        const ny = -Math.sin(a) * n; const nz = Math.cos(a) * n;
        inner.push(vert(x + side * (hw - CH), y0, z0, side * n, ny, nz, spotU, spotV));
        outer.push(vert(x + side * hw, y1, z1, side * n, ny, nz, spotU, spotV));
        capRing.push(vert(x + side * hw, y1, z1, side, 0, 0, spotU, spotV));
      }
      const centre = vert(x + side * hw, 0, 0, side, 0, 0, spotU, spotV);
      for (let j = 0; j < SEG; j++) {
        if (side > 0) {
          idx.push(inner[j], outer[j + 1], outer[j], inner[j], inner[j + 1], outer[j + 1]);
          idx.push(centre, capRing[j + 1], capRing[j]);
        } else {
          idx.push(inner[j], outer[j], outer[j + 1], inner[j], outer[j + 1], inner[j + 1]);
          idx.push(centre, capRing[j], capRing[j + 1]);
        }
      }
    }
    const count = pos.length / 3 - start;
    return { start, count };
  };
  // Binary drums: digit 0 is centred on the front, and the bright half is the far side.
  PLACES.forEach((place, i) => {
    const r = addDrum(bx(i), B_W, 0, BW_PX / AW, -Math.PI / 2);
    drums.push({ ...r, kind: 'bit', place, order: 7 - i, step: Math.PI, last: 0 });
  });
  // Decimal drums: digit 0 centred on the front, each next digit 36 degrees further down.
  DECIMALS.forEach((place, i) => {
    const r = addDrum(dx(i), D_W, DX0 / AW, (DX0 + DW_PX) / AW, -18 * DEG);
    drums.push({ ...r, kind: 'digit', place, order: 2 - i, step: 36 * DEG, last: 0 });
  });

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(pos), 3);
  const nrmAttr = new THREE.BufferAttribute(new Float32Array(nrm), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  nrmAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(idx);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('normal', nrmAttr);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // The vertices above are measured from each drum's own axle, in y and z.
  const baseP = Float32Array.from(pos);
  const baseN = Float32Array.from(nrm);

  const setDrum = (drum, phi) => {
    const c = Math.cos(phi); const s = Math.sin(phi);
    const P = posAttr.array; const N = nrmAttr.array;
    for (let i = drum.start, e = drum.start + drum.count; i < e; i++) {
      const o = i * 3;
      const y = baseP[o + 1]; const z = baseP[o + 2];
      P[o + 1] = A + y * c + z * s;
      P[o + 2] = z * c - y * s;
      const ny = baseN[o + 1]; const nz = baseN[o + 2];
      N[o + 1] = ny * c + nz * s;
      N[o + 2] = nz * c - ny * s;
    }
    drum.last = phi;
  };

  const wrap = (k) => ((k % WRAP) + WRAP) % WRAP;
  const valueOf = (drum, k) => (drum.kind === 'bit' ? bitOf(wrap(k), drum.place) : digitOf(wrap(k), drum.place));
  const modulus = (drum) => (drum.kind === 'bit' ? 2 : 10);
  // Where one drum should be at a moment in the count: only ever a function of the clock.
  const angleAt = (drum, tau) => {
    const local = tau - drum.order * CARRY;
    const k = Math.floor(local / TICK);
    const now = valueOf(drum, k);
    const before = valueOf(drum, k - 1);
    if (now === before) return now * drum.step;
    const delta = (now - before + modulus(drum)) % modulus(drum);
    return (before + detentEase((local - k * TICK) / TURN) * delta) * drum.step;
  };

  let tau = START * TICK + TURN + 0.2; // the value has settled, and the next tick is still to come
  drums.forEach((drum) => setDrum(drum, angleAt(drum, tau)));
  posAttr.needsUpdate = true; nrmAttr.needsUpdate = true;
  geometry.computeBoundingBox();
  // Drums are round, so this sphere holds at every angle.
  geometry.computeBoundingSphere();
  const drumMesh = mesh(geometry, standard({ map: faces, roughness: 0.48, metalness: 0 }));
  const works = new THREE.Group();
  works.add(drumMesh);
  root.add(works);

  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      tau += dt;
      if (tau >= WRAP * TICK + START * TICK) tau -= WRAP * TICK;
      let moved = false;
      for (const drum of drums) {
        const phi = angleAt(drum, tau);
        if (Math.abs(phi - drum.last) > 1e-5) { setDrum(drum, phi); moved = true; }
      }
      if (moved) { posAttr.needsUpdate = true; nrmAttr.needsUpdate = true; }
    },
    dispose() {},
  };

  // --- The casing ---
  const steel = [];
  const add = (g, color) => { steel.push({ geometry: g, color }); };
  const BODYC = 0x4f6f8a; const BODY2 = 0x445f75; const BRASS = 0xc9a24a; const DARKC = 0x5d7083;
  const lipTheta = Math.asin(LIP / (DR + 0.04));
  const arc = (a0, a1, n) => {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = mix(a0, a1, i / n);
      out.push([Math.cos(a) * (DR + 0.04), A + Math.sin(a) * (DR + 0.04)]);
    }
    return out;
  };
  const crown = (y, z) => [z, A + y];
  const hood = [[F, A + LIP], crown(0.66, F + 0.05), crown(1.24, 0.66), crown(1.34, 0.42), crown(1.38, 0.1), crown(1.38, -0.46), crown(1.1, -1.0), [-1.0, A], ...arc(Math.PI, lipTheta, 22)];
  const sill = [[F, A - LIP], crown(-0.62, F + 0.08), crown(-1.2, F + 0.32), crown(-1.2, -1.0), [-1.0, A], ...arc(Math.PI, TAU - lipTheta, 22)];
  add(prismX(hood, -BODY, BODY, { crease: 35 }), BODYC);
  add(prismX(sill, -BODY, BODY, { crease: 35 }), BODYC);
  // The two end plates, a hair larger than the body so they read as cast ends.
  const outline = [crown(-1.2, F + 0.36), crown(-0.62, F + 0.12), crown(0.66, F + 0.09), crown(1.27, 0.68), crown(1.38, 0.42), crown(1.42, 0.1), crown(1.42, -0.48), crown(1.12, -1.04), crown(-1.2, -1.04)];
  for (const s of [-1, 1]) {
    add(prismX(outline, s > 0 ? BODY : -BODY - 0.1, s > 0 ? BODY + 0.1 : -BODY), BODY2);
    add(prismX(outline.map(([z, y]) => [z - (z > 0 ? 0.05 : -0.05), y + (y > A ? -0.05 : 0.05)]), s > 0 ? BODY + 0.1 : -BODY - 0.13, s > 0 ? BODY + 0.13 : -BODY - 0.1), DARKC);
  }
  // Solid panels wherever there is no window: the two ends, and the gap holding the equals sign.
  const panel = (x0, x1, y0 = A - LIP, y1 = A + LIP, z0 = 0.62, z1 = F - 0.01) => prismX([[z1, y0], [z1, y1], [z0, y1], [z0, y0]], x0, x1);
  add(panel(-BODY, XL), BODY2);
  add(panel(DEC_R, BODY), BODY2);
  add(panel(BIN_R, DEC_L), BODY2);
  // The decimal windows are shorter than the binary ones, so that one digit shows at a time.
  const D_HALF = 0.27;
  add(panel(DEC_L, DEC_R, A + D_HALF, A + LIP, 0.74), BODY2);
  add(panel(DEC_L, DEC_R, A - LIP, A - D_HALF, 0.74), BODY2);

  // Brass window frames: each rail is one chamfered bar, and the corners are pinned.
  const rail = (a, b, w, h = 0.1) => timber(a, b, w, h, { up: [0, 0, 1], chamfer: 0.022 });
  const FZ = F + 0.03;
  add(rail([XL - 0.06, A + LIP + 0.02, FZ], [BIN_R + 0.06, A + LIP + 0.02, FZ], 0.12), BRASS);
  add(rail([XL - 0.06, A - LIP - 0.02, FZ], [BIN_R + 0.06, A - LIP - 0.02, FZ], 0.12), BRASS);
  for (let i = 0; i <= 8; i++) {
    const x = XL + B_PITCH * i;
    add(rail([x, A - LIP, FZ], [x, A + LIP, FZ], 0.11), BRASS);
  }
  add(rail([DEC_L - 0.06, A + D_HALF + 0.05, FZ], [DEC_R + 0.06, A + D_HALF + 0.05, FZ], 0.1), BRASS);
  add(rail([DEC_L - 0.06, A - D_HALF - 0.05, FZ], [DEC_R + 0.06, A - D_HALF - 0.05, FZ], 0.1), BRASS);
  for (let i = 0; i <= 3; i++) {
    const x = DEC_L + D_PITCH * i;
    add(rail([x, A - D_HALF - 0.05, FZ], [x, A + D_HALF + 0.05, FZ], 0.09), BRASS);
  }
  // A hand crank on the right end, since a machine like this had one somewhere.
  {
    const x = BODY + 0.13;
    const boss = turned([[0, -0.02], [0.2, -0.02], [0.2, 0.08], [0.11, 0.14], [0.11, 0.26], [0, 0.26]], 24);
    boss.rotateZ(-Math.PI / 2);
    boss.translate(x, A, -0.1);
    add(boss, BRASS);
    add(timber([x + 0.2, A, -0.1], [x + 0.2, A - 0.72, -0.1], 0.1, 0.09, { chamfer: 0.02, up: [1, 0, 0] }), BRASS);
    add(rod([x + 0.2, A - 0.72, -0.1], [x + 0.46, A - 0.72, -0.1], 0.05, 10, 0), BRASS);
    add(ball(0.095, [x + 0.52, A - 0.72, -0.1], 14), DARKC);
  }
  // A pair of pinned plates on the crown, and the feet the machine sits on.
  for (const [x0, x1] of [[-BODY, BODY]]) {
    add(prismX([[F + 0.42, DESK_Y + 0.03], [F + 0.42, DESK_Y + 0.08], [-1.06, DESK_Y + 0.08], [-1.06, DESK_Y + 0.03]], x0 - 0.12, x1 + 0.12), DARKC);
  }
  // Two brass strips along the crown, a rib along the fascia's head, and rivets round each end plate:
  // the small machined lines that keep a long flat casing from reading as a painted box.
  for (const z of [0.22, -0.32]) {
    add(prismX([[z + 0.05, A + 1.37], [z + 0.05, A + 1.415], [z - 0.05, A + 1.415], [z - 0.05, A + 1.37]], -BODY, BODY), BRASS);
  }
  add(rail([-BODY, A + 1.245, 0.64], [BODY, A + 1.245, 0.64], 0.07, 0.08), BRASS);
  add(rail([-BODY, A - 0.66, F + 0.1], [BODY, A - 0.66, F + 0.1], 0.06, 0.07), BRASS);
  for (const sx of [-1, 1]) {
    const x = sx > 0 ? BODY + 0.135 : -BODY - 0.135;
    for (const [z, dy] of [[1.0, -1.06], [0.0, -1.06], [-0.86, -1.06], [-0.86, 0.0], [-0.86, 0.96], [0.0, 1.24], [0.62, 1.1]]) {
      const g = new THREE.SphereGeometry(0.05, 10, 7);
      g.translate(x, A + dy, z);
      add(g, BRASS);
    }
  }
  // Two access panels on the back, each screwed down at its corners.
  for (const cx of [-2.3, 2.3]) {
    add(timber([cx - 1.9, A + 0.02, -1.01], [cx + 1.9, A + 0.02, -1.01], 1.7, 0.05, { up: [0, 0, 1], chamfer: 0.015 }), DARKC);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const g = new THREE.SphereGeometry(0.05, 10, 7);
        g.translate(cx + sx * 1.78, A + 0.02 + sy * 0.72, -1.04);
        add(g, BRASS);
      }
    }
  }
  // Iron desk ends and a stretcher.
  const legSec = [[1.32, 0], [1.32, 0.12], [0.6, 0.3], [0.42, 1.2], [0.46, 2.3], [1.16, DESK_Y - 0.14], [-1.16, DESK_Y - 0.14], [-0.46, 2.3], [-0.42, 1.2], [-0.6, 0.3], [-1.32, 0.12], [-1.32, 0]];
  for (const x of [-3.95, 3.95]) add(prismX(legSec, x - 0.13, x + 0.13, { crease: 22 }), 0x5a6773);
  add(rod([-3.9, 0.82, 0], [3.9, 0.82, 0], 0.09, 12, 0), BRASS);
  add(rod([-3.9, 1.95, -0.1], [3.9, 1.95, -0.1], 0.06, 12, 0), BRASS);
  const parts = steel.map((p) => { const g = p.geometry; return { geometry: g, color: p.color }; });
  const metalRelief = relief('metal', { seed: 8, repeat: 2, strength: 0.25 });
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.18, ...metalRelief })));

  // --- The desk top ---
  const wood = [
    { geometry: prismX([[1.72, DESK_Y - 0.16], [1.72, DESK_Y - 0.03], [1.66, DESK_Y + 0.01], [-1.42, DESK_Y + 0.01], [-1.48, DESK_Y - 0.03], [-1.48, DESK_Y - 0.16]], -4.95, 4.95), color: 0x7a4f30 },
  ];
  root.add(mesh(mergeParts(wood), woodMaterial(1011)));

  // --- The printing: place values above, the rule below, and the equals sign ---
  const CW = 1800; const CH2 = 500;
  const PX = 200;
  const topH = 0.62; const lowH = 0.5;
  const rects = {
    binTop: [0, 0, 1248, 124], decTop: [1256, 0, 384, 124],
    binLow: [0, 132, 1248, 100], decLow: [1256, 132, 384, 100],
    eq: [0, 240, 124, 216],
  };
  const map = canvasTexture(CW, CH2, (ctx) => {
    ctx.fillStyle = '#ece6d6';
    ctx.fillRect(0, 0, CW, CH2);
    {
      const [x0, y0, w, h] = rects.binTop;
      PLACES.forEach((place, i) => {
        fitted(ctx, String(place), x0 + (i + 0.5) * (w / 8), y0 + h / 2 + 3, w / 8 - 16, 0.44 * PX, { color: '#1c222c' });
      });
      ctx.fillStyle = 'rgba(40,50,60,0.35)';
      for (let i = 1; i < 8; i++) ctx.fillRect(x0 + i * (w / 8) - 1, y0 + 8, 2, h - 16);
    }
    {
      const [x0, y0, w, h] = rects.decTop;
      DECIMALS.forEach((place, i) => {
        fitted(ctx, String(place), x0 + (i + 0.5) * (w / 3), y0 + h / 2 + 3, w / 3 - 14, 0.34 * PX, { color: '#1c222c' });
      });
    }
    {
      const [x0, y0, w, h] = rects.binLow;
      fitted(ctx, 'Each place is worth double the one to its right', x0 + w / 2, y0 + h / 2 + 2, w * 0.94, 0.3 * PX, { weight: '600', color: '#232a34' });
    }
    {
      const [x0, y0, w, h] = rects.decLow;
      fitted(ctx, 'ordinary digits', x0 + w / 2, y0 + h / 2 + 2, w * 0.9, 0.3 * PX, { weight: '600', color: '#232a34' });
    }
    {
      const [x0, y0, w, h] = rects.eq;
      ctx.fillStyle = '#20303d';
      ctx.fillRect(x0, y0, w, h);
      fitted(ctx, '=', x0 + w / 2, y0 + h / 2, w * 0.9, 0.86 * PX, { color: '#f4efe2' });
    }
  });
  map.anisotropy = 8;
  const uvOf = (r) => rectUV(CW, CH2, ...r);
  const printed = [];
  const fascia = (x, w, h, rect, from, to, lift = 0.04) => {
    // A plate laid along a slope in the (z, y) plane.
    const up = new THREE.Vector3(0, to[1] - from[1], to[0] - from[0]).normalize();
    const n = new THREE.Vector3(0, -up.z, up.y);
    if (n.z < 0) n.negate();
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), up, n);
    const g = printedPlate(w, h, 0.06, uvOf(rect));
    g.applyMatrix4(M);
    g.translate(x, (from[1] + to[1]) / 2 + n.y * lift, (from[0] + to[0]) / 2 + n.z * lift);
    printed.push({ geometry: g, color: 0xffffff });
  };
  const hoodA = crown(0.66, F + 0.05); const hoodB = crown(1.24, 0.66);
  const sillA = crown(-1.2, F + 0.32); const sillB = crown(-0.62, F + 0.08);
  const BIN_W = B_PITCH * 8; const DEC_W = D_PITCH * 3;
  fascia((XL + BIN_R) / 2, BIN_W, topH, rects.binTop, hoodA, hoodB);
  fascia((DEC_L + DEC_R) / 2, DEC_W, topH, rects.decTop, hoodA, hoodB);
  fascia((XL + BIN_R) / 2, BIN_W, lowH, rects.binLow, sillA, sillB);
  fascia((DEC_L + DEC_R) / 2, DEC_W, lowH, rects.decLow, sillA, sillB);
  {
    const eq = printedPlate(0.56, 0.96, 0.03, uvOf(rects.eq));
    eq.translate((BIN_R + DEC_L) / 2, A, F + 0.015);
    printed.push({ geometry: eq, color: 0xffffff });
  }
  root.add(mesh(mergeParts(printed), standard({ vertexColors: true, map, roughness: 0.66, metalness: 0 })));
  return root;
}

export const BUILDERS = {
  'binary-counter': () => buildBinaryCounter(),
  'pi-wheel': () => buildPiWheel(),
  'archimedes-volumes': () => buildArchimedes(),
  'pascals-triangle': () => buildPascal(),
  'unit-circle': () => buildUnitCircle(),
};
