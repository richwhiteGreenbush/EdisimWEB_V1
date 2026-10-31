import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, noise3 } from '../../props/LoftKit.js';
import { ELEMENTS, FAMILIES } from '../../props/AtomModel.js';
import { signedVolume, lathe, tube, outward, alongMatrix, lin } from '../ModelKit.js';

// The Model Database's third science family: the International Space Station, Sputnik 1, a hurricane
// cutaway, the periodic table and Galileo's telescope. Authored in feet, origin at the base centre,
// front toward +Z.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// Printing. Ordinary letters only, measured to fit.
// ---------------------------------------------------------------------------------------------
const FONT = 'Arial, Helvetica, sans-serif';

function fitFont(ctx, text, maxWidth, size, weight = '700', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > maxWidth) { s = (s * maxWidth) / width; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

// ---------------------------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------------------------

// A closed block from a list of triangles written as [x,y,z,u,v] corners, measured outward.
function soupGeometry(pos, uv, crease = 30) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (signedVolume(g) < 0) {
    for (let t = 0; t < pos.length; t += 9) {
      for (let k = 0; k < 3; k++) { const v = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = v; }
    }
    for (let t = 0; t < uv.length; t += 6) {
      for (let k = 0; k < 2; k++) { const v = uv[t + 2 + k]; uv[t + 2 + k] = uv[t + 4 + k]; uv[t + 4 + k] = v; }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  return toCreasedNormals(g, crease * DEG);
}

// A box between two corners, with flat faces and UVs that run along each face's own length in feet.
function block(x0, y0, z0, x1, y1, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

// ===========================================================================================
// THE PERIODIC TABLE
// ===========================================================================================
//
// ELEMENTS in src/props/AtomModel.js is the one table, so the family colours and every position are
// the ones Atom Hall's skyline stands on. Its rows 9 and 10 are the f-block.

const PT = {
  PITCH: 0.84,
  TILE: 0.79,
  DEPTH: 0.1,
  BEVEL: 0.018,
  LEFT: 0.34, // room for the period numbers
  RIGHT: 0.16,
  TOPM: 0.34, // room for the group numbers
  BOTTOM: 0.14,
  FBLOCK_GAP: 0.5,
  FRAME: 0.2,
  LIFT: 0.46, // how far the panel's bottom edge stands off the floor
  PANEL_Z: 0.1, // the printed face
};
PT.W = 18 * PT.PITCH + PT.LEFT + PT.RIGHT;
PT.H = (7 + PT.FBLOCK_GAP + 2) * PT.PITCH + PT.TOPM + PT.BOTTOM;
PT.Y0 = PT.LIFT + PT.FRAME;
PT.YTOP = PT.Y0 + PT.H;

const ptRowIndex = (row) => (row <= 7 ? row - 1 : row - 9 + 7 + PT.FBLOCK_GAP);
const ptX = (column) => -PT.W / 2 + PT.LEFT + (column - 0.5) * PT.PITCH;
const ptY = (rowIndex) => PT.YTOP - PT.TOPM - (rowIndex + 0.5) * PT.PITCH;

const hexBytes = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const shadeHex = (hex, k) => {
  const [r, g, b] = hexBytes(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
// WCAG relative luminance: which of two inks has the better contrast on this colour.
function inkOn(hex) {
  const lum = hexBytes(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 * 0.72 ? '#ffffff' : '#10181f';
}

const PT_ATLAS = { size: 2048, cols: 11, cell: 186 };
function ptCell(index) {
  const c = index % PT_ATLAS.cols;
  const r = Math.floor(index / PT_ATLAS.cols);
  const s = PT_ATLAS.cell;
  return { x: c * s, y: r * s, s };
}

// Each element's tile face. Every tile samples its own cell, so a family colour never bleeds.
function paintElementAtlas(ctx, w, h, list) {
  ctx.fillStyle = '#20242c';
  ctx.fillRect(0, 0, w, h);
  list.forEach((el, i) => {
    const { x, y, s } = ptCell(i);
    const hex = FAMILIES[el.family].color;
    const grad = ctx.createLinearGradient(0, y, 0, y + s);
    grad.addColorStop(0, shadeHex(hex, 1.14));
    grad.addColorStop(1, shadeHex(hex, 0.9));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, s, s);
    const ink = inkOn(hex);
    ctx.fillStyle = ink;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = `700 37px ${FONT}`;
    ctx.fillText(String(el.z), x + 14, y + 44);
    ctx.textAlign = 'center';
    fitFont(ctx, el.symbol, s - 30, 88, '800');
    ctx.fillText(el.symbol, x + s / 2, y + 126);
    fitFont(ctx, el.name, s - 22, 27, '700');
    ctx.fillText(el.name, x + s / 2, y + 165);
  });
}

// What the wall itself says: the title and colour key in the table's own gap, the group and period
// numbers, and the two markers that say where the f-block belongs.
function paintWallFace(ctx, w, h) {
  const px = w / PT.W; // pixels per foot
  const X = (x) => (x + PT.W / 2) * px;
  const Y = (y) => (PT.YTOP - y) * px;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#22344f');
  grad.addColorStop(1, '#172539');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Group numbers stand over the top of each column, period numbers beside each row.
  const topOfColumn = new Array(19).fill(99);
  for (const el of ELEMENTS) if (el.row <= 7) topOfColumn[el.column] = Math.min(topOfColumn[el.column], el.row);
  ctx.fillStyle = '#c9d6e6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${0.2 * px}px ${FONT}`;
  for (let c = 1; c <= 18; c++) {
    const yy = ptY(ptRowIndex(topOfColumn[c])) + PT.PITCH / 2 + 0.135;
    ctx.fillText(String(c), X(ptX(c)), Y(yy));
  }
  ctx.font = `700 ${0.2 * px}px ${FONT}`;
  for (let r = 1; r <= 7; r++) ctx.fillText(String(r), X(-PT.W / 2 + PT.LEFT / 2), Y(ptY(r - 1)));

  // Where the f-block belongs: two ghost cells in column 3.
  const ghost = (rowIndex, text, name) => {
    const cx = X(ptX(3)); const cy = Y(ptY(rowIndex)); const s = PT.TILE * px;
    ctx.setLineDash([9, 7]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8fa3bc';
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    ctx.setLineDash([]);
    ctx.fillStyle = '#d7e1ee';
    fitFont(ctx, text, s - 12, 0.2 * px, '700');
    ctx.fillText(text, cx, cy - s * 0.1);
    fitFont(ctx, name, s - 12, 0.1 * px, '600');
    ctx.fillText(name, cx, cy + s * 0.2);
  };
  ghost(5, '57-71', 'see below');
  ghost(6, '89-103', 'see below');
  // The f-block's own names, in the two empty columns beside it.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e8eef6';
  const fX = X(ptX(3) - PT.PITCH / 2) - 14;
  for (const [row, name, numbers] of [[9, 'Lanthanides', '57 to 71'], [10, 'Actinides', '89 to 103']]) {
    const yy = Y(ptY(ptRowIndex(row)));
    fitFont(ctx, name, PT.PITCH * 1.85 * px, 0.25 * px, '700');
    ctx.fillText(name, fX, yy - 0.09 * px);
    ctx.fillStyle = '#b8c6d8';
    fitFont(ctx, numbers, PT.PITCH * 1.85 * px, 0.17 * px, '600');
    ctx.fillText(numbers, fX, yy + 0.15 * px);
    ctx.fillStyle = '#e8eef6';
  }

  // The gap above the transition metals: title, then the key.
  const gapL = X(ptX(3) - PT.PITCH / 2) + 10;
  const gapR = X(ptX(12) + PT.PITCH / 2) - 10;
  const gapW = gapR - gapL;
  const gapT = Y(ptY(0) + PT.PITCH / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  const title = 'PERIODIC TABLE OF THE ELEMENTS';
  const titleSize = fitFont(ctx, title, gapW, 0.42 * px, '800');
  ctx.fillText(title, (gapL + gapR) / 2, gapT + titleSize * 0.72);
  ctx.fillStyle = '#c9d6e6';
  const sub = 'All 118 known elements, in order of atomic number';
  const subSize = fitFont(ctx, sub, gapW, 0.2 * px, '600');
  ctx.fillText(sub, (gapL + gapR) / 2, gapT + titleSize * 1.34 + subSize * 0.5);

  // The key: three columns, in the order the table reads.
  const keys = Object.keys(FAMILIES);
  const rowsK = 4;
  const colsK = 3;
  const keyT = gapT + titleSize * 1.34 + subSize * 1.55;
  // Stops short of the group numbers standing over the transition metals.
  const keyH = Y(ptY(2) - PT.PITCH / 2 + 0.27) - keyT;
  const rowH = keyH / rowsK;
  const colW = gapW / colsK;
  ctx.textAlign = 'left';
  keys.forEach((key, i) => {
    const cx = gapL + Math.floor(i / rowsK) * colW;
    const cy = keyT + (i % rowsK) * rowH + rowH / 2;
    const chip = Math.min(rowH * 0.72, 0.3 * px);
    ctx.fillStyle = FAMILIES[key].color;
    ctx.fillRect(cx, cy - chip / 2, chip, chip);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e8eef6';
    ctx.strokeRect(cx, cy - chip / 2, chip, chip);
    ctx.fillStyle = '#f2f6fb';
    fitFont(ctx, FAMILIES[key].name, colW - chip - 26, 0.2 * px, '600');
    ctx.fillText(FAMILIES[key].name, cx + chip + 10, cy + 1);
  });
}

// A rounded tile whose face samples one atlas cell. Closed, sunk into the wall behind it.
function ptTile(cx, cy, z0, z1, size, bevel, cell, atlasSize) {
  const half = size / 2;
  const corner = 0.05;
  const STEPS = 3;
  const outline = (inset) => {
    const out = [];
    const h = half - inset;
    const r = Math.max(0.005, corner - inset * 0.5);
    for (const [sx, sy, start] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
      for (let k = 0; k <= STEPS; k++) {
        const a = (start + (k / STEPS) * 90) * DEG;
        out.push([sx * (h - r) + Math.cos(a) * r, sy * (h - r) + Math.sin(a) * r]);
      }
    }
    return out;
  };
  const uvOf = (x, y) => {
    const m = 3; // stay inside the cell by a few pixels, so a mip never reaches the neighbour
    const u = (cell.x + m + (x / size + 0.5) * (cell.s - 2 * m)) / atlasSize;
    const v = 1 - (cell.y + m + (0.5 - y / size) * (cell.s - 2 * m)) / atlasSize;
    return [u, v];
  };
  const outer = outline(0);
  const inner = outline(bevel);
  const n = outer.length;
  const pos = [];
  const uv = [];
  const push = (p, z) => { pos.push(cx + p[0], cy + p[1], z); const t = uvOf(p[0], p[1]); uv.push(t[0], t[1]); };
  const tri = (a, az, b, bz, c, cz) => { push(a, az); push(b, bz); push(c, cz); };
  const zB = z1 - bevel;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Side wall, then bevel, then the face and back as fans from the centre.
    tri(outer[i], z0, outer[j], z0, outer[j], zB);
    tri(outer[i], z0, outer[j], zB, outer[i], zB);
    tri(outer[i], zB, outer[j], zB, inner[j], z1);
    tri(outer[i], zB, inner[j], z1, inner[i], z1);
    tri([0, 0], z1, inner[i], z1, inner[j], z1);
    tri([0, 0], z0, outer[j], z0, outer[i], z0);
  }
  return soupGeometry(pos, uv, 24);
}

// A rectangular moulding, mitred at its corners by construction: every profile point standing `out`
// proud traces a rectangle of its own, so the corners cannot disagree. The profile is a closed loop.
function frameRing(cx, cy, halfW, halfH, profile) {
  const pos = [];
  const uv = [];
  const corner = (k, o, z) => {
    const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]][k % 4];
    return [cx + signs[0] * (halfW + o), cy + signs[1] * (halfH + o), z];
  };
  const P = (p) => { pos.push(p[0], p[1], p[2]); uv.push(0, 0); };
  for (let i = 0; i < profile.length; i++) {
    const a = profile[i];
    const b = profile[(i + 1) % profile.length];
    for (let k = 0; k < 4; k++) {
      const p0 = corner(k, a[0], a[1]); const p1 = corner(k + 1, a[0], a[1]);
      const p2 = corner(k + 1, b[0], b[1]); const p3 = corner(k, b[0], b[1]);
      P(p0); P(p1); P(p2);
      P(p0); P(p2); P(p3);
    }
  }
  return soupGeometry(pos, uv, 28);
}

function buildPeriodicTable() {
  // --- the assertion the card leans on ---
  const list = [...ELEMENTS].sort((a, b) => a.z - b.z);
  if (list.length !== 118) throw new Error(`periodic-table: ${list.length} elements, not 118`);
  const seen = new Set(list.map((e) => e.z));
  for (let z = 1; z <= 118; z++) if (!seen.has(z)) throw new Error(`periodic-table: atomic number ${z} is missing`);
  if (seen.size !== 118) throw new Error('periodic-table: an atomic number appears twice');
  const occupied = new Set();
  for (const el of list) {
    const key = `${el.column},${el.row}`;
    if (occupied.has(key)) throw new Error(`periodic-table: two elements share cell ${key}`);
    occupied.add(key);
  }

  const atlas = canvasTexture(PT_ATLAS.size, PT_ATLAS.size, (ctx, w, h) => paintElementAtlas(ctx, w, h, list));
  atlas.anisotropy = 8;
  const FACE_W = 1536;
  const FACE_H = Math.round((1536 * PT.H) / PT.W);
  const faceMap = canvasTexture(FACE_W, FACE_H, paintWallFace);

  const Z_FACE = PT.PANEL_Z;
  const tiles = [];
  list.forEach((el, i) => {
    const cx = ptX(el.column);
    const cy = ptY(ptRowIndex(el.row));
    tiles.push({
      geometry: ptTile(cx, cy, Z_FACE - 0.03, Z_FACE + PT.DEPTH, PT.TILE, PT.BEVEL, ptCell(i), PT_ATLAS.size),
      keepColor: true,
    });
  });
  if (tiles.length !== 118) throw new Error(`periodic-table: ${tiles.length} tiles, not 118`);

  // The printed face: a thin sheet proud of the panel, closed so it cannot leak.
  const cxP = 0;
  const cyP = PT.Y0 + PT.H / 2;
  const faceGeo = (() => {
    const hw = PT.W / 2; const hh = PT.H / 2;
    const pos = []; const uv = [];
    const put = (x, y, z, u, v) => { pos.push(cxP + x, cyP + y, z); uv.push(u, v); };
    const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) put(...p); };
    const zf = Z_FACE; const zb = Z_FACE - 0.04;
    quad([-hw, -hh, zf, 0, 0], [hw, -hh, zf, 1, 0], [hw, hh, zf, 1, 1], [-hw, hh, zf, 0, 1]);
    quad([-hw, hh, zb, 0, 1], [hw, hh, zb, 1, 1], [hw, -hh, zb, 1, 0], [-hw, -hh, zb, 0, 0]);
    quad([-hw, -hh, zb, 0, 0], [hw, -hh, zb, 1, 0], [hw, -hh, zf, 1, 0], [-hw, -hh, zf, 0, 0]);
    quad([hw, hh, zb, 1, 1], [-hw, hh, zb, 0, 1], [-hw, hh, zf, 0, 1], [hw, hh, zf, 1, 1]);
    quad([hw, -hh, zb, 1, 0], [hw, hh, zb, 1, 1], [hw, hh, zf, 1, 1], [hw, -hh, zf, 1, 0]);
    quad([-hw, hh, zb, 0, 1], [-hw, -hh, zb, 0, 0], [-hw, -hh, zf, 0, 0], [-hw, hh, zf, 0, 1]);
    return soupGeometry(pos, uv, 30);
  })();

  // The carpentry: a mitred walnut frame, a boarded back, and two sled feet with braces.
  const WALNUT = 0x9a6840;
  const WALNUT_D = 0x7c5230;
  const WALNUT_L = 0xb4875a;
  const wood = [];
  const hw = PT.W / 2; const hh = PT.H / 2;
  wood.push({
    geometry: frameRing(cxP, cyP, hw, hh, [
      [0, 0.02], [0, Z_FACE + 0.03], [0.05, Z_FACE + 0.09], [0.09, Z_FACE + 0.15], [0.14, Z_FACE + 0.15], [0.18, Z_FACE + 0.11], [PT.FRAME, Z_FACE + 0.05],
      [PT.FRAME, -0.17], [PT.FRAME - 0.03, -0.2], [0, -0.2],
    ]),
    color: WALNUT,
  });
  // The panel behind the print, as boards you can see from behind.
  const BOARDS = 24;
  for (let i = 0; i < BOARDS; i++) {
    const x0 = -hw + (i / BOARDS) * PT.W;
    const x1 = -hw + ((i + 1) / BOARDS) * PT.W;
    const tone = [WALNUT_L, 0xaa7d52, 0xbb8f62, 0xa67a4e][(i * 7) % 4];
    wood.push({ geometry: block(x0 + 0.008, cyP - hh, -0.13, x1 - 0.008, cyP + hh, Z_FACE - 0.05), color: tone });
  }
  // Solid backing so nothing shows between the boards from the front.
  wood.push({ geometry: block(-hw, cyP - hh, -0.03, hw, cyP + hh, Z_FACE - 0.05), color: 0x2a1c12 });
  // Two rails across the back, and a batten behind each upright.
  for (const y of [cyP - hh * 0.62, cyP + hh * 0.62]) {
    wood.push({ geometry: block(-hw + 0.02, y - 0.17, -0.3, hw - 0.02, y + 0.17, -0.13), color: WALNUT });
  }
  const FEET_X = hw - 1.25;
  for (const sx of [-1, 1]) {
    const x = sx * FEET_X;
    // The sled foot, chamfered at both ends, and running through under the wall.
    const footOutline = [
      [-2.15, 0], [2.15, 0], [2.15, 0.11], [1.65, 0.3], [0.35, 0.36], [-0.5, 0.36], [-1.65, 0.3], [-2.15, 0.11],
    ];
    const pos = []; const uv = [];
    const P = (p) => { pos.push(p[0], p[1], p[2]); uv.push(0, 0); };
    const fw = 0.32;
    const at = (o, s) => [x + s * fw, o[1], o[0]];
    const m = footOutline.length;
    for (let i = 0; i < m; i++) {
      const a = footOutline[i]; const b = footOutline[(i + 1) % m];
      for (const t of [[at(a, -1), at(b, -1), at(b, 1)], [at(a, -1), at(b, 1), at(a, 1)]]) t.forEach(P);
    }
    for (let i = 1; i < m - 1; i++) {
      for (const t of [[at(footOutline[0], 1), at(footOutline[i], 1), at(footOutline[i + 1], 1)], [at(footOutline[0], -1), at(footOutline[i + 1], -1), at(footOutline[i], -1)]]) t.forEach(P);
    }
    wood.push({ geometry: soupGeometry(pos, uv, 30), color: WALNUT_D });
    // The two cheeks that hold the wall. The front one stops at the frame, or it covers the actinides.
    wood.push({ geometry: block(x - 0.3, 0.3, Z_FACE + 0.15, x + 0.3, PT.Y0 + 0.08, Z_FACE + 0.3), color: WALNUT_D });
    wood.push({ geometry: block(x - 0.3, 0.3, -0.38, x + 0.3, 2.9, -0.2), color: WALNUT_D });
    // The rear brace, raked from the end of the foot up the back of the wall.
    const b0 = [x, 0.3, -1.45]; const b1 = [x, 3.6, -0.3];
    const dir = new THREE.Vector3(0, b1[1] - b0[1], b1[2] - b0[2]);
    const len = dir.length();
    const braceGeo = new THREE.BoxGeometry(0.34, 0.24, len);
    braceGeo.translate(0, 0, len / 2);
    braceGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.atan2(-dir.y, dir.z)));
    braceGeo.translate(b0[0], b0[1], b0[2]);
    wood.push({ geometry: braceGeo, color: WALNUT });
  }
  const woodMesh = mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.56, metalness: 0.02 }));
  const faceMesh = mesh(faceGeo, standard({ map: faceMap, roughness: 0.82, metalness: 0, emissive: 0xffffff, emissiveMap: faceMap, emissiveIntensity: 0.1 }));
  const tileMesh = mesh(mergeParts(tiles), standard({ map: atlas, roughness: 0.42, metalness: 0, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.1 }));

  const root = new THREE.Group();
  root.add(woodMesh, faceMesh, tileMesh);
  root.userData.tileCount = tiles.length;
  return root;
}

// ---------------------------------------------------------------------------------------------
// More solids, shared by the models below
// ---------------------------------------------------------------------------------------------

// A solid of revolution about +Y with UVs under the caller's control, written bottom-up, axis to
// axis. Its corners stay crisp and its seam is welded, because toCreasedNormals joins by position.
function turned(profile, segments, { uTiles = 1, vScale = 1, crease = 28, vFn = null } = {}) {
  const n = profile.length;
  const pos = [];
  const uv = [];
  const idx = [];
  const ring = segments + 1;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const [r, y] = profile[i];
    if (i) s += Math.hypot(r - profile[i - 1][0], y - profile[i - 1][1]);
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * TAU;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      uv.push((j / segments) * uTiles, vFn ? vFn(r, y, s, i) : s * vScale);
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

// A round bar between two points with rounded ends. r may be [r0, r1].
function rod(a, b, r, sides = 8, round = 1) {
  return tube([a, b], r, { straight: true, steps: 1, sides, round });
}

// The matrix that stands a thing authored along +Y at p, pointing along dir.
function standAt(p, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, V(dir[0] ?? dir.x, dir[1] ?? dir.y, dir[2] ?? dir.z).normalize());
  const at = V(p[0] ?? p.x, p[1] ?? p.y, p[2] ?? p.z);
  return new THREE.Matrix4().compose(at, q, V(1, 1, 1));
}

// A printed plate with its face on +Z, its back at z = -depth and its centre at the origin. The rim
// samples one corner of its own rectangle, so the edge is plain and not a squashed copy of the print.
function printedPlate(w, h, depth, [u0, v0, u1, v1]) {
  const hw = w / 2; const hh = h / 2;
  const pos = []; const uv = [];
  const rimU = u0 + 0.002; const rimV = v0 + 0.002;
  const put = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); };
  const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) put(...p); };
  quad([-hw, -hh, 0, u0, v0], [hw, -hh, 0, u1, v0], [hw, hh, 0, u1, v1], [-hw, hh, 0, u0, v1]);
  quad([-hw, hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV]);
  quad([-hw, -hh, -depth, rimU, rimV], [hw, -hh, -depth, rimU, rimV], [hw, -hh, 0, rimU, rimV], [-hw, -hh, 0, rimU, rimV]);
  quad([hw, hh, -depth, rimU, rimV], [-hw, hh, -depth, rimU, rimV], [-hw, hh, 0, rimU, rimV], [hw, hh, 0, rimU, rimV]);
  quad([hw, -hh, -depth, rimU, rimV], [hw, hh, -depth, rimU, rimV], [hw, hh, 0, rimU, rimV], [hw, -hh, 0, rimU, rimV]);
  quad([-hw, hh, -depth, rimU, rimV], [-hw, -hh, -depth, rimU, rimV], [-hw, -hh, 0, rimU, rimV], [-hw, hh, 0, rimU, rimV]);
  return soupGeometry(pos, uv, 30);
}

// A prism whose convex outline is given as [z, y] points, running from x0 to x1. UVs lie along y, so
// a grain map runs up a timber standing on end.
function prismX(outline, x0, x1, { uScale = 0.8, vScale = 0.25 } = {}) {
  const pos = []; const uv = [];
  const P = (x, p) => { pos.push(x, p[1], p[0]); uv.push(p[0] * uScale + x * uScale, p[1] * vScale); };
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const a = outline[i]; const b = outline[(i + 1) % n];
    P(x0, a); P(x0, b); P(x1, b);
    P(x0, a); P(x1, b); P(x1, a);
  }
  let cz = 0; let cy = 0;
  for (const p of outline) { cz += p[0] / n; cy += p[1] / n; }
  const c = [cz, cy];
  for (let i = 0; i < n; i++) {
    const a = outline[i]; const b = outline[(i + 1) % n];
    P(x1, c); P(x1, a); P(x1, b);
    P(x0, c); P(x0, b); P(x0, a);
  }
  return soupGeometry(pos, uv, 32);
}

// ===========================================================================================
// SPUTNIK 1
// ===========================================================================================
//
// There is no environment map anywhere in this app, so a mirror finish has to be painted: every
// vertex takes the colour of whatever it would reflect, by its own normal, sky above a dark horizon
// and warm ground below. A little metalness and a low roughness then put the sun's highlight on top.

const SPUTNIK = {
  R: 2.875, // 5.75ft across: 58cm, three times life
  POLAR: 58 * DEG, // where the mounts stand, measured from the nose
  HALF_ANGLE: 25 * DEG, // the sweep off the body axis, which gives about 35 degrees between a pair
  // 2.4m and 2.9m, three times life, in feet.
  LEN_SHORT: 2.4 * 3 * 3.28084,
  LEN_LONG: 2.9 * 3 * 3.28084,
  CY: 5.55,
};

function polishColor(nx, ny, nz, out, brightness = 1) {
  const az = Math.atan2(nx, nz);
  // A low, broken horizon, so the reflection reads as a place and not as a two-tone ball.
  const hz = 0.02 + 0.03 * Math.sin(az * 2 + 0.7) + 0.012 * Math.sin(az * 5 + 2.1);
  const skyT = Math.min(1, Math.max(0, (ny - hz) / (1 - hz)));
  const groundT = Math.min(1, Math.max(0, (hz - ny) / (1 + hz)));
  const sky = [mix(0.92, 0.2, skyT ** 0.55), mix(0.94, 0.38, skyT ** 0.55), mix(0.96, 0.74, skyT ** 0.55)];
  const ground = [mix(0.07, 0.62, groundT ** 0.7), mix(0.07, 0.55, groundT ** 0.7), mix(0.08, 0.46, groundT ** 0.7)];
  const k = sstep(ny - hz, -0.035, 0.05);
  out[0] = mix(ground[0], sky[0], k) * brightness;
  out[1] = mix(ground[1], sky[1], k) * brightness;
  out[2] = mix(ground[2], sky[2], k) * brightness;
}

function polished(geometry, brightness = 1) {
  const nrm = geometry.attributes.normal;
  const arr = new Float32Array(nrm.count * 3);
  const out = [1, 1, 1];
  for (let i = 0; i < nrm.count; i++) {
    polishColor(nrm.getX(i), nrm.getY(i), nrm.getZ(i), out, brightness);
    arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return { geometry, keepColor: true };
}

function paintSputnikPlate(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#e2c478');
  grad.addColorStop(1, '#b08f45');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#5a431a';
  ctx.lineWidth = 7;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = '#2f230d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'SPUTNIK 1', w - 90, 118, '800');
  ctx.fillText('SPUTNIK 1', w / 2, h * 0.34);
  fitFont(ctx, 'The first artificial satellite. October 4, 1957', w - 90, 50, '600');
  ctx.fillText('The first artificial satellite. October 4, 1957', w / 2, h * 0.67);
  fitFont(ctx, 'Sphere shown three times life size', w - 90, 40, '500');
  ctx.fillText('Sphere shown three times life size', w / 2, h * 0.84);
}

function buildSputnik({ antennaScale = 0.4 } = {}) {
  const { R, POLAR, HALF_ANGLE, CY } = SPUTNIK;
  const nose = V(0, 0, 1);
  const radialAt = (az) => V(Math.cos(az), Math.sin(az), 0);
  const H = 0.42;
  const rodsSpec = [45, 135, 225, 315].map((deg, i) => {
    const az = deg * DEG;
    const e = radialAt(az);
    const u = nose.clone().multiplyScalar(Math.cos(POLAR)).addScaledVector(e, Math.sin(POLAR));
    const Q = u.clone().multiplyScalar(R + H);
    const d = nose.clone().multiplyScalar(-Math.cos(HALF_ANGLE)).addScaledVector(e, Math.sin(HALF_ANGLE));
    // The real pairs were 2.4m and 2.9m. The upper pair is the long one here.
    const L = (i < 2 ? SPUTNIK.LEN_LONG : SPUTNIK.LEN_SHORT) * antennaScale;
    return { u, Q, d, L };
  });
  if (rodsSpec.length !== 4) throw new Error('sputnik-1: exactly four antennas');
  // The rods must leave the sphere rather than pierce it: the closest point of each line to the
  // centre has to stay outside the ball.
  for (const { Q, d } of rodsSpec) {
    const t = Math.max(0, -Q.dot(d));
    if (Q.clone().addScaledVector(d, t).length() <= R + 0.05) throw new Error('sputnik-1: an antenna passes through the sphere');
  }
  // Nose down only as far as the lower pair needs to stay off the floor.
  let tilt = 0;
  const lowest = () => {
    let min = 1e9;
    for (const { Q, d, L } of rodsSpec) {
      const tip = Q.clone().addScaledVector(d, L);
      min = Math.min(min, CY + tip.y * Math.cos(tilt) - tip.z * Math.sin(tilt));
    }
    return min;
  };
  while (lowest() < 1.25 && tilt < 22 * DEG) tilt += 0.25 * DEG;
  let tipZ = 0;
  for (const { Q, d, L } of rodsSpec) {
    const tip = Q.clone().addScaledVector(d, L);
    tipZ = Math.min(tipZ, tip.y * Math.sin(tilt) + tip.z * Math.cos(tilt));
  }
  // The stand stays under the middle of the whole thing, so the long rods balance and the stem rakes.
  const span = R - tipZ;
  const forward = Math.max(0, -(R + tipZ) / 2 - span * 0.16);
  const M = new THREE.Matrix4().makeRotationX(tilt).setPosition(0, CY, forward);

  const silver = [];
  const add = (geometry, brightness = 1) => { geometry.applyMatrix4(M); silver.push(polished(geometry, brightness)); };

  // --- The sphere: two halves let into a raised seam ring ---
  const ROWS = 46;
  const W = 0.1; // half the ring's width
  const GROOVE = 0.03;
  const halfAngle = Math.asin((W + GROOVE) / R);
  const profile = [];
  for (let i = 0; i <= ROWS; i++) {
    const lat = -Math.PI / 2 + (i / ROWS) * (Math.PI / 2 - halfAngle);
    profile.push([R * Math.cos(lat), R * Math.sin(lat)]);
  }
  const rEdge = R * Math.cos(halfAngle);
  profile.push(
    [rEdge - 0.012, -W - GROOVE * 0.5], [rEdge - 0.022, -W - 0.004], [R + 0.03, -W], [R + 0.056, -W + 0.022],
    [R + 0.062, 0],
    [R + 0.056, W - 0.022], [R + 0.03, W], [rEdge - 0.022, W + 0.004], [rEdge - 0.012, W + GROOVE * 0.5],
  );
  for (let i = ROWS; i >= 0; i--) {
    const lat = Math.PI / 2 - (i / ROWS) * (Math.PI / 2 - halfAngle);
    profile.push([R * Math.cos(lat), R * Math.sin(lat)]);
  }
  profile[0][0] = 0;
  profile[profile.length - 1][0] = 0;
  const sphere = turned(profile, 96, { crease: 24 });
  sphere.rotateX(Math.PI / 2); // +Y becomes the nose
  add(sphere);

  // The bolts round the seam.
  const BOLTS = 36;
  for (let i = 0; i < BOLTS; i++) {
    const a = ((i + 0.5) / BOLTS) * TAU;
    const e = radialAt(a);
    const bolt = lathe([[0, -0.03], [0.07, -0.03], [0.07, 0.03], [0.05, 0.05], [0, 0.055]], 6);
    bolt.applyMatrix4(standAt(e.clone().multiplyScalar(R + 0.056), e));
    add(bolt, 0.8);
  }

  // --- The four antennas, on their mounts ---
  for (const { u, Q, d, L } of rodsSpec) {
    const base = u.clone().multiplyScalar(R);
    const boss = lathe([
      [0, -0.2], [0.3, -0.2], [0.3, 0.012], [0.275, 0.045], [0.17, 0.09], [0.115, 0.19], [0.105, 0.3], [0.14, 0.34], [0.14, 0.42], [0.08, H + 0.05], [0, H + 0.05],
    ], 28);
    boss.applyMatrix4(standAt(base, u));
    add(boss);
    // Four set screws round the flange.
    for (let k = 0; k < 4; k++) {
      const side = V().crossVectors(u, nose).normalize().applyAxisAngle(u, (k / 4) * TAU + Math.PI / 4);
      const at = base.clone().addScaledVector(side, 0.225).addScaledVector(u, 0.012);
      const screw = lathe([[0, -0.03], [0.04, -0.03], [0.04, 0.025], [0, 0.035]], 8);
      screw.applyMatrix4(standAt(at, u));
      add(screw, 0.7);
    }
    // The hinge, a ball on the boss, and the sleeve that takes the rod.
    const hinge = new THREE.SphereGeometry(0.155, 20, 14);
    hinge.applyMatrix4(new THREE.Matrix4().makeTranslation(Q.x, Q.y, Q.z));
    add(hinge);
    const toEnd = (t) => Q.clone().addScaledVector(d, t).toArray();
    add(rod(toEnd(-0.02), toEnd(1.4), [0.13, 0.092], 16, 1));
    for (const t of [0.34, 0.5, 0.66]) {
      const ring = lathe([[0.0, -0.035], [0.15, -0.035], [0.158, 0], [0.15, 0.035], [0.0, 0.035]], 16);
      ring.applyMatrix4(standAt(toEnd(t), d));
      add(ring, 0.85);
    }
    const ferrule = lathe([[0, -0.08], [0.11, -0.08], [0.112, 0.05], [0.082, 0.1], [0, 0.1]], 16);
    ferrule.applyMatrix4(standAt(toEnd(1.42), d));
    add(ferrule);
    // The rod itself, tapering a little, thick enough to read from across a room.
    add(rod(toEnd(1.3), toEnd(L), [0.078, 0.046], 12, 2));
    const tip = new THREE.SphereGeometry(0.062, 12, 8);
    const end = Q.clone().addScaledVector(d, L);
    tip.applyMatrix4(new THREE.Matrix4().makeTranslation(end.x, end.y, end.z));
    add(tip);
  }
  // Carry the rods' own check into the world frame: exactly four long ones.
  const silverGeo = mergeParts(silver);

  // --- The stand ---
  const stand = [];
  const STAND_R = 3.1;
  stand.push({
    geometry: lathe([
      [0, 0], [STAND_R, 0], [STAND_R, 0.17], [STAND_R - 0.06, 0.22], [STAND_R - 0.2, 0.25], [STAND_R - 0.32, 0.4], [STAND_R - 0.7, 0.47], [1.1, 0.5], [0.62, 0.58], [0.42, 0.72], [0, 0.72],
    ], 72),
    color: 0x5f3a22,
  });
  const brass = 0xc4a050;
  stand.push({
    geometry: lathe([[0, 0.17], [STAND_R + 0.02, 0.17], [STAND_R + 0.02, 0.215], [STAND_R - 0.05, 0.235], [0, 0.235]], 72),
    color: brass,
  });
  // The stem rakes forward from the stand's centre to the ball's centre, and stops inside the ball.
  const centre = V(0, CY, forward);
  const foot = V(0, 0.5, 0);
  const s = centre.clone().sub(foot).normalize();
  const under = centre.clone().addScaledVector(s, -R);
  const stemTop = under.clone().addScaledVector(s, 0.3);
  const stem = turned([
    [0, 0], [0.34, 0], [0.34, 0.1], [0.24, 0.22], [0.17, 0.5], [0.135, 1.0], [0.13, under.distanceTo(foot) - 0.4], [0.13, stemTop.distanceTo(foot)], [0, stemTop.distanceTo(foot)],
  ], 28);
  stem.applyMatrix4(standAt(foot, s));
  stand.push({ geometry: stem, color: brass });
  // The cup that takes the ball: its lip is sunk, because the sphere falls away from it.
  const cup = lathe([[0, -0.55], [0.17, -0.55], [0.24, -0.34], [0.56, -0.14], [0.62, -0.02], [0.6, 0.05], [0, 0.2]], 40);
  cup.applyMatrix4(standAt(under, s));
  stand.push({ geometry: cup, color: brass });
  // The plate's lectern, sunk into the stand's sloping top.
  const PLATE_W = 2.5; const PLATE_H = 0.72;
  const plateTilt = -62 * DEG;
  const plateM = new THREE.Matrix4().makeRotationX(plateTilt).setPosition(0, 0.68, 2.0);
  const lectern = block(-PLATE_W / 2 - 0.09, -PLATE_H / 2 - 0.09, -0.55, PLATE_W / 2 + 0.09, PLATE_H / 2 + 0.09, -0.02);
  lectern.applyMatrix4(plateM);
  stand.push({ geometry: lectern, color: 0x4d2e1a });
  const standGeo = mergeParts(stand);

  const plateMap = canvasTexture(1024, 296, paintSputnikPlate);
  const plateGeo = printedPlate(PLATE_W, PLATE_H, 0.05, [0, 0, 1, 1]);
  plateGeo.applyMatrix4(plateM);

  const root = new THREE.Group();
  root.add(
    mesh(silverGeo, standard({ vertexColors: true, roughness: 0.2, metalness: 0.3 })),
    mesh(standGeo, standard({ vertexColors: true, roughness: 0.42, metalness: 0.2 })),
    mesh(plateGeo, standard({ map: plateMap, roughness: 0.4, metalness: 0.25, emissive: 0xffffff, emissiveMap: plateMap, emissiveIntensity: 0.08 })),
  );
  root.userData.antennas = rodsSpec.length;
  return root;
}

// ===========================================================================================
// GALILEO'S TELESCOPE
// ===========================================================================================
//
// The tubes are museum pieces and everything a student reads on them is tooling: the leather and its
// gold are one canvas, 290 pixels to the foot, and the map doubles as the bump so the gold stands
// out of the grain. All of it lies along the tube's own axis (tube local +Y while it is being turned).

const GT = {
  ELEV: 25 * DEG,
  PIVOT: [0, 5.72, 0.15],
  Z_EYE: -4.36,
  Z_DRAW: -3.96, // where the draw tube's leather starts
  Z_MOUTH: -1.12, // where the draw tube enters the outer tube
  Z_END: 4.24, // where the outer tube's leather stops
  Z_OBJ: 4.62, // the lens seat
  R_DRAW: 0.205,
  R_OUT0: 0.262,
  R_OUT1: 0.3,
  ATLAS_W: 1024,
  ATLAS_H: 1536,
};
const GOLD = '#e4bd60';
const GOLD_SHADOW = 'rgba(40,12,4,0.85)';

function gilt(ctx, draw) {
  ctx.save();
  ctx.translate(1.1, 1.6);
  ctx.strokeStyle = GOLD_SHADOW; ctx.fillStyle = GOLD_SHADOW;
  draw();
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.fillStyle = GOLD;
  draw();
}

// One stamped flower: four petals round a centre, the commonest binder's tool there was.
function stampFlower(ctx, x, y, s) {
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + Math.PI / 4;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * s * 0.52, y + Math.sin(a) * s * 0.52, s * 0.42, s * 0.2, a, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, s * 0.17, 0, TAU);
  ctx.fill();
}

// A fleuron pointing up: a stem and two scrolled leaves.
function stampFleuron(ctx, x, y, s) {
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(x, y + s);
  ctx.lineTo(x, y - s * 0.3);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.5);
    ctx.bezierCurveTo(x + side * s * 0.9, y + s * 0.5, x + side * s * 0.9, y - s * 0.4, x + side * s * 0.3, y - s * 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + side * s * 0.3, y - s * 0.25, s * 0.11, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.28, y - s * 0.55, x, y - s * 0.22);
  ctx.quadraticCurveTo(x - s * 0.28, y - s * 0.55, x, y - s);
  ctx.fill();
}

function paintLeather(ctx, x0, w, h, base, seed) {
  const rng = seededRandom(seed);
  ctx.fillStyle = base;
  ctx.fillRect(x0, 0, w, h);
  // Broad staining, wrapped round the tube, then the leather's own pores.
  for (let i = 0; i < 220; i++) {
    const x = rng() * w; const y = rng() * h; const r = 18 + rng() * 60;
    const dark = rng() > 0.45;
    ctx.fillStyle = dark ? `rgba(38,10,4,${0.03 + rng() * 0.05})` : `rgba(190,110,70,${0.02 + rng() * 0.04})`;
    for (const ox of [-w, 0, w]) {
      const cx = x0 + x + ox;
      if (cx + r < x0 || cx - r > x0 + w) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, w, h);
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(cx, y, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  for (let i = 0; i < 5200; i++) {
    const x = x0 + rng() * w; const y = rng() * h;
    ctx.fillStyle = rng() > 0.5 ? 'rgba(30,8,3,0.26)' : 'rgba(215,140,95,0.12)';
    ctx.fillRect(x, y, 1 + rng() * 1.6, 1 + rng() * 1.6);
  }
}

// Bands of tooling run round the tube, so every motif is repeated a whole number of times across the
// canvas's width and the seam cannot show. `y` runs along the tube.
function toolBands(ctx, x0, w, y0, y1, bands) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, y1 - y0);
  ctx.clip();
  const rule = (y, weight) => gilt(ctx, () => ctx.fillRect(x0, y - weight / 2, w, weight));
  const dots = (y, n, r) => gilt(ctx, () => {
    for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(x0 + ((i + 0.5) / n) * w, y, r, 0, TAU); ctx.fill(); }
  });
  let y = y0;
  for (const band of bands) {
    const top = y; const bottom = y + band.h; const mid = (top + bottom) / 2;
    if (band.kind === 'rules') {
      rule(top + 6, 4); rule(top + 14, 2); dots(top + band.h / 2 + 2, band.n ?? 32, 2.6); rule(bottom - 14, 2); rule(bottom - 6, 4);
    } else if (band.kind === 'lattice') {
      const n = band.n; const cw = w / n; const ch = band.h / band.rows;
      gilt(ctx, () => {
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let r = 0; r < band.rows; r++) {
          for (let c = 0; c < n; c++) {
            const x = x0 + c * cw; const yy = top + r * ch;
            ctx.moveTo(x, yy + ch / 2); ctx.lineTo(x + cw / 2, yy); ctx.lineTo(x + cw, yy + ch / 2); ctx.lineTo(x + cw / 2, yy + ch); ctx.closePath();
          }
        }
        ctx.stroke();
        for (let r = 0; r < band.rows; r++) {
          for (let c = 0; c < n; c++) {
            stampFlower(ctx, x0 + (c + 0.5) * cw, top + (r + 0.5) * ch, Math.min(cw, ch) * 0.23);
            ctx.beginPath(); ctx.arc(x0 + c * cw, top + (r + 0.5) * ch, 2.4, 0, TAU); ctx.fill();
          }
        }
      });
    } else if (band.kind === 'vine') {
      const periods = band.n; const pw = w / periods; const amp = band.h * 0.26;
      gilt(ctx, () => {
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i <= w; i += 3) {
          const yy = mid + Math.sin((i / pw) * TAU) * amp;
          if (i === 0) ctx.moveTo(x0 + i, yy); else ctx.lineTo(x0 + i, yy);
        }
        ctx.stroke();
        for (let i = 0; i < periods * 2; i++) {
          const up = i % 2 === 0;
          const px = x0 + (i + 0.5) * (pw / 2);
          const py = mid + (up ? 1 : -1) * amp * 0.12;
          stampFleuron(ctx, px, py + (up ? -band.h * 0.05 : band.h * 0.05), band.h * 0.15);
        }
      });
    } else if (band.kind === 'rosettes') {
      const n = band.n; const cw = w / n;
      gilt(ctx, () => {
        for (let c = 0; c < n; c++) {
          const x = x0 + (c + 0.5) * cw;
          ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.arc(x, mid, band.h * 0.34, 0, TAU); ctx.stroke();
          stampFlower(ctx, x, mid, band.h * 0.2);
          ctx.beginPath(); ctx.arc(x0 + c * cw, mid, 3.2, 0, TAU); ctx.fill();
        }
      });
    } else if (band.kind === 'fleurons') {
      const n = band.n; const cw = w / n;
      gilt(ctx, () => {
        for (let c = 0; c < n; c++) stampFleuron(ctx, x0 + (c + 0.5) * cw, mid, band.h * 0.36);
      });
    }
    y = bottom;
  }
  ctx.restore();
}

function paintGalileoLeather(ctx, w, h) {
  const colW = w / 2;
  paintLeather(ctx, 0, colW, h, '#7c3c21', 1609);
  paintLeather(ctx, colW, colW, h, '#64301d', 1610);
  // The long outer tube: wide panels of diaper and vine between narrow rules, as bound books have.
  const outer = [
    { kind: 'rules', h: 40, n: 28 }, { kind: 'rosettes', h: 74, n: 6 }, { kind: 'rules', h: 40, n: 28 },
    { kind: 'lattice', h: 300, n: 6, rows: 5 },
    { kind: 'rules', h: 40, n: 28 }, { kind: 'vine', h: 110, n: 3 }, { kind: 'rules', h: 40, n: 28 },
    { kind: 'fleurons', h: 96, n: 6 },
    { kind: 'rules', h: 40, n: 28 },
    { kind: 'lattice', h: 300, n: 6, rows: 5 },
    { kind: 'rules', h: 40, n: 28 }, { kind: 'vine', h: 110, n: 3 }, { kind: 'rules', h: 40, n: 28 },
    { kind: 'rosettes', h: 74, n: 6 }, { kind: 'rules', h: 40, n: 28 },
  ];
  const total = outer.reduce((a, b) => a + b.h, 0);
  const scale = h / total;
  toolBands(ctx, 0, colW, 0, h, outer.map((b) => ({ ...b, h: b.h * scale })));
  // The draw tube: plainer, because in use it was handled.
  const inner = [
    { kind: 'rules', h: 40, n: 24 }, { kind: 'vine', h: 104, n: 2 }, { kind: 'rules', h: 40, n: 24 },
    { kind: 'lattice', h: 300, n: 5, rows: 4 },
    { kind: 'rules', h: 40, n: 24 }, { kind: 'fleurons', h: 92, n: 5 }, { kind: 'rules', h: 40, n: 24 },
    { kind: 'lattice', h: 300, n: 5, rows: 4 },
    { kind: 'rules', h: 40, n: 24 },
  ];
  const totalI = inner.reduce((a, b) => a + b.h, 0);
  toolBands(ctx, colW, colW, 0, h, inner.map((b) => ({ ...b, h: (b.h * h) / totalI })));
}

// A pale, near-white grain tile: it multiplies the vertex colour, so one tile serves every wood here.
function woodGrainTile(seed) {
  const rng = seededRandom(seed);
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#efe7da';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const x = rng() * w;
      const a = 0.03 + rng() * 0.09;
      const width = 0.5 + rng() * 2.4;
      const wob = rng() * 3 + 1;
      const phase = rng() * TAU;
      const k = (1 + Math.floor(rng() * 2)) / h * TAU;
      ctx.strokeStyle = `rgba(92,58,30,${a})`;
      ctx.lineWidth = width;
      for (const ox of [-w, 0, w]) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 16) {
          const xx = x + ox + Math.sin(y * k + phase) * wob;
          if (y === 0) ctx.moveTo(xx, y); else ctx.lineTo(xx, y);
        }
        ctx.stroke();
      }
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function paintGalileoPlate(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#e8cc84');
  grad.addColorStop(0.55, '#c9a659');
  grad.addColorStop(1, '#ad8b42');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#573f15';
  ctx.lineWidth = 8;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.fillStyle = '#2d210b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const serif = 'Georgia, "Times New Roman", serif';
  fitFont(ctx, 'After Galileo Galilei', w - 110, 104, '700', serif);
  ctx.fillText('After Galileo Galilei', w / 2, h * 0.36);
  fitFont(ctx, 'Padua, 1609 to 1610. Shown three times life size', w - 110, 58, '500', serif);
  ctx.fillText('Padua, 1609 to 1610. Shown three times life size', w / 2, h * 0.7);
}

function buildGalileoTelescope() {
  const { ELEV, PIVOT, Z_EYE, Z_DRAW, Z_MOUTH, Z_END, Z_OBJ, R_DRAW, R_OUT0, R_OUT1, ATLAS_W, ATLAS_H } = GT;
  // Tube local: a part turned about +Y becomes one lying along +Z, raised about the pivot.
  const axisM = new THREE.Matrix4()
    .makeRotationX(-ELEV)
    .setPosition(PIVOT[0], PIVOT[1], PIVOT[2])
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  const onAxis = (g) => g.applyMatrix4(axisM);

  const leather = [];
  const wood = [];
  const brass = [];
  const lens = [];

  const leatherGeo = (profile, uOffset, yMin, yMax) => {
    const g = turned(profile, 48, { crease: 40, vFn: (r, y) => 1 - (y - yMin) / (yMax - yMin) });
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uOffset + uv.getX(i) * 0.5);
    return g;
  };
  // --- The draw tube and the outer tube, one sliding into the other. The inner one carries on well
  // inside the outer, so pulling them apart would find more of it. ---
  leather.push({ geometry: onAxis(leatherGeo([[0, Z_DRAW], [R_DRAW, Z_DRAW], [R_DRAW, Z_MOUTH + 0.3], [0, Z_MOUTH + 0.3]], 0.5, Z_DRAW, Z_MOUTH + 0.3)), keepColor: false, color: 0xffffff });
  const outerRows = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    outerRows.push([mix(R_OUT0, R_OUT1, t), mix(Z_MOUTH, Z_END, t)]);
  }
  leather.push({ geometry: onAxis(leatherGeo([[0, Z_MOUTH], ...outerRows, [0, Z_END]], 0, Z_MOUTH, Z_END)), keepColor: false, color: 0xffffff });

  const OLIVE = 0xa77a44;
  const BOX = 0xc99d5e;
  const WAL = 0x8a5a33;
  const DARK = 0x6d4426;
  const BRASS = 0xc7a24c;

  // --- The turned wood: the objective cell at the front, the eyepiece at the back, a collar at the
  // mouth where the tubes meet. ---
  const woodTurn = (profile, color, segs = 48) => wood.push({ geometry: onAxis(turned(profile, segs, { uTiles: 2, vScale: 0.7 })), color });
  woodTurn([
    [0, Z_END - 0.1], [R_OUT1 + 0.008, Z_END - 0.1], [R_OUT1 + 0.008, Z_END - 0.02], [R_OUT1 + 0.05, Z_END + 0.03], [R_OUT1 + 0.05, Z_END + 0.11], [R_OUT1 + 0.025, Z_END + 0.15],
    [R_OUT1 + 0.03, Z_END + 0.19], [R_OUT1 + 0.075, Z_END + 0.27], [R_OUT1 + 0.1, Z_END + 0.36], [R_OUT1 + 0.1, Z_END + 0.44], [R_OUT1 + 0.075, Z_END + 0.49],
    [0.3, Z_END + 0.5], [0.268, Z_END + 0.47], [0.255, Z_OBJ + 0.02], [0, Z_OBJ + 0.02],
  ], OLIVE, 64);
  // The mouth collar: its lip closes down on the draw tube.
  woodTurn([
    [0, Z_MOUTH + 0.12], [R_OUT0 + 0.006, Z_MOUTH + 0.12], [R_OUT0 + 0.03, Z_MOUTH + 0.08], [R_OUT0 + 0.03, Z_MOUTH + 0.0], [R_OUT0 + 0.012, Z_MOUTH - 0.03],
    [R_OUT0 + 0.03, Z_MOUTH - 0.07], [R_OUT0 + 0.03, Z_MOUTH - 0.14], [R_DRAW + 0.022, Z_MOUTH - 0.19], [R_DRAW + 0.005, Z_MOUTH - 0.21], [0, Z_MOUTH - 0.21],
  ].reverse().map(([r, y]) => [r, y]), OLIVE, 56);
  // The eyepiece: a collar on the draw tube and a small turned cup, its bore dark.
  woodTurn([
    [0, Z_EYE + 0.02], [0.09, Z_EYE + 0.02], [0.098, Z_EYE], [0.15, Z_EYE - 0.0], [0.168, Z_EYE + 0.03], [0.168, Z_EYE + 0.1], [0.135, Z_EYE + 0.16], [0.12, Z_EYE + 0.22],
    [0.14, Z_EYE + 0.27], [0.2, Z_DRAW - 0.04], [R_DRAW + 0.035, Z_DRAW + 0.02], [R_DRAW + 0.035, Z_DRAW + 0.09], [R_DRAW + 0.012, Z_DRAW + 0.13], [R_DRAW + 0.022, Z_DRAW + 0.17], [R_DRAW + 0.002, Z_DRAW + 0.2], [0, Z_DRAW + 0.2],
  ], BOX, 48);

  // --- Brass: the bands at the two ends of each tube, and the cradle at the balance. ---
  const brassTurn = (profile, segs = 48) => brass.push({ geometry: onAxis(turned(profile, segs, { crease: 30 })), color: BRASS });
  const rOut = (z) => mix(R_OUT0, R_OUT1, (z - Z_MOUTH) / (Z_END - Z_MOUTH));
  const band = (z, half, proud = 0.012) => {
    const r = rOut(z);
    brassTurn([[0, z - half], [r - 0.01, z - half], [r + proud, z - half + 0.012], [r + proud, z + half - 0.012], [r - 0.01, z + half], [0, z + half]]);
  };
  band(Z_END - 0.14, 0.03);
  band(Z_MOUTH + 0.17, 0.03);
  brassTurn([[0, Z_DRAW + 0.2], [R_DRAW + 0.01, Z_DRAW + 0.2], [R_DRAW + 0.014, Z_DRAW + 0.215], [R_DRAW + 0.014, Z_DRAW + 0.25], [R_DRAW + 0.004, Z_DRAW + 0.265], [0, Z_DRAW + 0.265]], 40);
  // The cradle: a broad strap at the pivot, with its raised rims.
  const zP = 0;
  const rP = rOut(zP);
  brassTurn([
    [0, zP - 0.3], [rP - 0.01, zP - 0.3], [rP + 0.03, zP - 0.28], [rP + 0.03, zP - 0.21], [rP + 0.014, zP - 0.19], [rP + 0.014, zP + 0.19], [rP + 0.03, zP + 0.21], [rP + 0.03, zP + 0.28], [rP - 0.01, zP + 0.3], [0, zP + 0.3],
  ], 56);

  // --- The lenses: dark glass, domed, with a painted window on it. ---
  const lensDome = (r, rise, z, up) => {
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push([r * Math.sqrt(1 - t * t), rise * t]);
    }
    prof[0][0] = r;
    prof[prof.length - 1][0] = 0;
    const g = turned([[0, -0.02], [r, -0.02], ...prof], 36, { crease: 40 });
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const up2 = nrm.getX(i) * 0.3 + nrm.getZ(i) * -0.5 + nrm.getY(i) * 0.82;
      const glint = sstep(up2, 0.93, 0.985);
      col[i * 3] = mix(0.05, 0.75, glint); col[i * 3 + 1] = mix(0.09, 0.8, glint); col[i * 3 + 2] = mix(0.15, 0.88, glint);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!up) { g.rotateX(Math.PI); }
    g.translate(0, z, 0);
    return g;
  };
  lens.push({ geometry: onAxis(lensDome(0.255, 0.05, Z_OBJ, true)), keepColor: true });
  lens.push({ geometry: onAxis(lensDome(0.09, 0.012, Z_EYE + 0.02, false)), keepColor: true });

  // --- The fork, which holds the cradle on two trunnions ---
  const [px, py, pz] = PIVOT;
  const ARM_X = rP + 0.16;
  const ARM_W = 0.13;
  const forkBaseY = 4.66;
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? ARM_X : -ARM_X - ARM_W;
    const x1 = x0 + ARM_W;
    const b = 0.28; const t = 0.17;
    wood.push({
      geometry: prismX([
        [pz - b, forkBaseY - 0.02], [pz + b, forkBaseY - 0.02], [pz + b, forkBaseY + 0.1], [pz + b * 0.86, forkBaseY + 0.17], [pz + t * 1.02, py - 0.42],
        ...Array.from({ length: 15 }, (_, k) => { const a = (-40 + (k / 14) * 260) * DEG; return [pz + Math.cos(a) * 0.22, py + Math.sin(a) * 0.22]; }),
        [pz - t * 1.02, py - 0.42], [pz - b * 0.86, forkBaseY + 0.17], [pz - b, forkBaseY + 0.1],
      ], x0, x1),
      color: WAL,
    });
    // The trunnion, from the strap out through the arm, and its capstan on the outside.
    const trun = rod([sx * (rP - 0.02), py, pz], [sx * (ARM_X + ARM_W + 0.07), py, pz], 0.055, 16, 1);
    brass.push({ geometry: trun, color: BRASS });
    const boss = turned([[0, -0.02], [0.14, -0.02], [0.14, 0.03], [0.1, 0.06], [0.0, 0.06]], 24, { crease: 30 });
    boss.applyMatrix4(standAt([sx * (ARM_X + ARM_W), py, pz], [sx, 0, 0]));
    brass.push({ geometry: boss, color: BRASS });
    const inner = turned([[0, -0.02], [0.12, -0.02], [0.12, 0.05], [0, 0.05]], 20, { crease: 30 });
    inner.applyMatrix4(standAt([sx * ARM_X, py, pz], [-sx, 0, 0]));
    brass.push({ geometry: inner, color: BRASS });
  }
  // A locking knob on the +X side, the one a person would turn.
  const knob = turned([[0, 0], [0.05, 0], [0.05, 0.14], [0.1, 0.17], [0.125, 0.22], [0.125, 0.3], [0.095, 0.345], [0, 0.36]], 20, { crease: 35 });
  knob.applyMatrix4(standAt([ARM_X + ARM_W + 0.05, py, pz], [1, 0, 0]));
  brass.push({ geometry: knob, color: BRASS });
  // The yoke that joins the two arms.
  wood.push({
    geometry: prismX([[pz - 0.28, forkBaseY - 0.26], [pz + 0.25, forkBaseY - 0.26], [pz + 0.28, forkBaseY - 0.23], [pz + 0.28, forkBaseY + 0.07], [pz + 0.25, forkBaseY + 0.1], [pz - 0.25, forkBaseY + 0.1], [pz - 0.28, forkBaseY + 0.07], [pz - 0.28, forkBaseY - 0.23]], -ARM_X - ARM_W - 0.02, ARM_X + ARM_W + 0.02),
    color: DARK,
  });

  // --- The column, a turned baluster, on a three-legged stand ---
  const HUB_Y = 3.02;
  const FOOT_R = 2.42;
  const colProfile = [
    [0, HUB_Y + 0.1], [0.28, HUB_Y + 0.1], [0.28, HUB_Y + 0.26], [0.21, HUB_Y + 0.33], [0.145, HUB_Y + 0.42], [0.17, HUB_Y + 0.5],
    [0.25, HUB_Y + 0.68], [0.265, HUB_Y + 0.82], [0.215, HUB_Y + 1.0], [0.135, HUB_Y + 1.16], [0.115, HUB_Y + 1.26], [0.15, HUB_Y + 1.32], [0.15, HUB_Y + 1.4], [0.1, HUB_Y + 1.45], [0.1, forkBaseY - 0.14], [0, forkBaseY - 0.14],
  ];
  wood.push({ geometry: turned(colProfile, 40, { uTiles: 2, vScale: 0.7, crease: 40 }), color: WAL });
  // The turntable, in brass, between column and fork.
  brass.push({ geometry: turned([[0, forkBaseY - 0.3], [0.3, forkBaseY - 0.3], [0.33, forkBaseY - 0.27], [0.33, forkBaseY - 0.22], [0.3, forkBaseY - 0.19], [0, forkBaseY - 0.19]], 40, { crease: 30 }), color: BRASS });
  brass.push({ geometry: turned([[0, HUB_Y + 1.28], [0.165, HUB_Y + 1.28], [0.175, HUB_Y + 1.31], [0.175, HUB_Y + 1.36], [0.165, HUB_Y + 1.39], [0, HUB_Y + 1.39]], 28, { crease: 30 }), color: BRASS });
  // The hub the legs enter.
  wood.push({
    geometry: turned([
      [0, HUB_Y - 0.5], [0.13, HUB_Y - 0.5], [0.24, HUB_Y - 0.42], [0.46, HUB_Y - 0.26], [0.53, HUB_Y - 0.08], [0.53, HUB_Y + 0.02], [0.46, HUB_Y + 0.08], [0.34, HUB_Y + 0.14], [0, HUB_Y + 0.14],
    ], 48, { uTiles: 2, vScale: 0.7, crease: 40 }),
    color: DARK,
  });
  // Three legs, turned like the column and tipped out to the feet.
  const legProfile = (L) => [
    [0, 0], [0.075, 0], [0.09, 0.05], [0.1, 0.22], [0.14, 0.42], [0.15, 0.6], [0.125, 0.82], [0.1, 1.05], [0.13, 1.14], [0.095, 1.24], [0.108, L * 0.58], [0.135, L * 0.74], [0.15, L * 0.84], [0.12, L * 0.92], [0.1, L], [0, L],
  ];
  const stretcherY = 1.18;
  const legBearings = [0, 120, 240].map((d) => d * DEG);
  for (const a of legBearings) {
    const top = V(Math.sin(a) * 0.3, HUB_Y - 0.14, Math.cos(a) * 0.3);
    const bot = V(Math.sin(a) * FOOT_R, 0.03, Math.cos(a) * FOOT_R);
    const dir = top.clone().sub(bot);
    const L = dir.length();
    const leg = turned(legProfile(L), 28, { uTiles: 2, vScale: 0.5, crease: 40 });
    leg.applyMatrix4(standAt(bot, dir));
    wood.push({ geometry: leg, color: WAL });
    // A brass shoe at the bottom, flat on the floor.
    const shoe = turned([[0, -0.03], [0.095, -0.03], [0.115, 0.0], [0.115, 0.12], [0.1, 0.18], [0, 0.18]], 20, { crease: 30 });
    shoe.applyMatrix4(standAt(bot, dir));
    brass.push({ geometry: shoe, color: BRASS });
    // The stretcher from the leg to a boss on the axis.
    const f = (stretcherY - bot.y) / (top.y - bot.y);
    const atLeg = bot.clone().lerp(top, f);
    const out = V(Math.sin(a), 0, Math.cos(a));
    const stretchL = Math.hypot(atLeg.x, atLeg.z);
    const stretcher = turned([
      [0, 0.05], [0.06, 0.05], [0.075, 0.2], [0.05, stretchL * 0.4], [0.082, stretchL * 0.65], [0.058, stretchL * 0.85], [0.07, stretchL - 0.04], [0, stretchL - 0.03],
    ], 16, { uTiles: 1, vScale: 0.5, crease: 40 });
    stretcher.applyMatrix4(standAt([0, stretcherY, 0], out));
    wood.push({ geometry: stretcher, color: DARK });
  }
  wood.push({
    geometry: turned([[0, stretcherY - 0.25], [0.05, stretcherY - 0.25], [0.15, stretcherY - 0.14], [0.19, stretcherY], [0.15, stretcherY + 0.14], [0.05, stretcherY + 0.24], [0, stretcherY + 0.26]], 28, { uTiles: 2, vScale: 0.5, crease: 40 }),
    color: WAL,
  });

  // --- The little brass plate, on the front of the yoke, at about eye height ---
  const PW = 0.96; const PH = 0.29;
  const plateM = new THREE.Matrix4().makeTranslation(0, forkBaseY - 0.08, pz + 0.28 + 0.02);
  const plateMap = canvasTexture(1024, 310, paintGalileoPlate);
  const plateGeo = printedPlate(PW, PH, 0.04, [0, 0, 1, 1]);
  plateGeo.applyMatrix4(plateM);

  const leatherMap = canvasTexture(ATLAS_W, ATLAS_H, paintGalileoLeather);
  const leatherBump = leatherMap.clone();
  leatherBump.colorSpace = THREE.NoColorSpace;
  leatherBump.needsUpdate = true;
  const grain = woodGrainTile(1610);
  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(leather), standard({ map: leatherMap, bumpMap: leatherBump, bumpScale: 0.9, roughness: 0.58, metalness: 0.02 })),
    mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, roughness: 0.46, metalness: 0 })),
    mesh(mergeParts(brass), standard({ vertexColors: true, roughness: 0.34, metalness: 0.48 })),
    mesh(mergeParts(lens), standard({ vertexColors: true, roughness: 0.08, metalness: 0.3 })),
    mesh(plateGeo, standard({ map: plateMap, roughness: 0.38, metalness: 0.3, emissive: 0xffffff, emissiveMap: plateMap, emissiveIntensity: 0.08 })),
  );
  return root;
}

// ===========================================================================================
// THE HURRICANE
// ===========================================================================================
//
// One bearing convention runs the whole model: a = atan2(x, z), which is 0 at +Z and grows toward +X.
// Seen from above (+Y toward the eye, -Z up the page) that is COUNTERCLOCKWISE, because a positive
// turn about +Y carries +Z to +X. Air spirals inward as it turns counterclockwise, so along a rain
// band r has to FALL as a rises: r(a) = r0 exp(-k (a - a0)) with k positive. `hcSpin` is the one place
// that says so, every band and every inflow arrow goes through it, and buildHurricane asserts it.

const HC = {
  RIM: 8.0,
  SEA_R: 7.42,
  SEA_Y: 0.42,
  WEDGE: 50 * DEG, // half the angle removed, centred on +Z
  K: 0.14, // the bands' tightness
  ARMS: 3,
  CLOUD_BASE: 1.02,
};
const hcBearing = (x, z) => Math.atan2(x, z);
const hcPoint = (r, a, y) => [r * Math.sin(a), y, r * Math.cos(a)];
const hcSpin = (r0, a0, a, k = HC.K) => r0 * Math.exp(-k * (a - a0));

// Monotone-ish Hermite through [x, y] keys.
function curveAt(keys, x) {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][1];
  if (x >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (x > keys[i + 1][0]) i++;
  const [x0, y0] = keys[i];
  const [x1, y1] = keys[i + 1];
  const h = x1 - x0;
  const slope = (j) => {
    const a = keys[Math.max(0, j - 1)];
    const b = keys[Math.min(n - 1, j + 1)];
    return (b[1] - a[1]) / (b[0] - a[0]);
  };
  const m0 = slope(i) * h;
  const m1 = slope(i + 1) * h;
  const t = (x - x0) / h;
  const t2 = t * t; const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

// The storm's section, from the eye out. The eyewall leans outward as it climbs (the stadium effect),
// which is why the top of the eye is wider than its bottom.
const HC_R0 = 1.24;
const HC_R1 = 4.72;
const HC_TOP = [
  [HC_R0, 0.74], [1.32, 1.25], [1.45, 2.2], [1.62, 3.3], [1.8, 4.4], [1.98, 5.2], [2.18, 5.72], [2.45, 5.95], [2.8, 5.86], [3.04, 5.3], [3.28, 4.35], [3.52, 3.42], [3.8, 2.72], [4.08, 2.24], [4.36, 1.82], [4.6, 1.38], [HC_R1, 1.0],
];
const hcTopNominal = (r) => curveAt(HC_TOP, r);
const hcBottomNominal = (r) => 0.74 + (r - HC_R0) * 0.08;

// Cauliflower. A cloud's surface is domes pressed together with a crease between each pair, which is
// the distance to the nearest of a set of jittered points (Worley F1), not a wave. 1 on a dome's crown,
// falling to about -1 in the creases.
function hcBillow(x, y, z, size) {
  const gx = x / size; const gy = y / size; const gz = z / size;
  const ix = Math.floor(gx); const iy = Math.floor(gy); const iz = Math.floor(gz);
  let best = 1e9;
  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i; const cy = iy + j; const cz = iz + k;
        const dx = cx + noise3(cx, cy, cz) - gx;
        const dy = cy + noise3(cx + 17.1, cy + 3.3, cz + 9.7) - gy;
        const dz = cz + noise3(cx + 5.3, cy + 29.9, cz + 13.1) - gz;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
    }
  }
  return 1 - 2 * Math.min(1, best / 0.72);
}

// One section of the central mass at bearing a, as a loop: up and over the top from the eye, then back
// along the underside. `crease` comes back per point, since the colour reads it.
function hcSection(a, tops, bottoms) {
  const inner = HC_R0 + 0.04 * Math.sin(a * 3 + 1.1);
  const outer = HC_R1 + 0.3 * Math.cos(HC.ARMS * (a + Math.log(HC_R1) / HC.K));
  const toR = (t) => mix(inner, outer, t);
  const toNom = (t) => mix(HC_R0, HC_R1, t);
  const loop = [];
  for (const t of tops) {
    const r = toR(t);
    const nom = toNom(t);
    const env = sstep(t, 0, 0.05) * (1 - sstep(t, 0.93, 1));
    // Slow height variation round the storm, so the eyewall has towers rather than a level rim.
    const towers = 0.26 * Math.sin(a * 3 + 0.7) + 0.16 * Math.sin(a * 5 + 2.2);
    const towerEnv = Math.exp(-(((nom - 2.55) / 0.6) ** 2));
    // The spiral ridges start in the mass and carry on out as the free bands.
    const psi = a + Math.log(Math.max(r, 0.5)) / HC.K;
    const ridge = 0.24 * Math.cos(HC.ARMS * psi) * sstep(nom, 3.2, 3.9);
    let y = hcTopNominal(nom) + (towers * towerEnv + ridge) * env;
    const dn = (hcTopNominal(nom + 0.03) - hcTopNominal(nom - 0.03)) / 0.06;
    const nl = Math.hypot(dn, 1);
    const nr = -dn / nl; const ny = 1 / nl;
    let rr = r;
    const [px, , pz] = hcPoint(r, a, 0);
    const b1 = hcBillow(px, y, pz, 0.86);
    const b2 = hcBillow(px, y, pz, 0.44);
    const amp = (0.14 * sstep(nom, 1.5, 2.2) + 0.09) * env;
    const d = amp * (b1 * 0.74 + b2 * 0.26);
    rr += nr * d;
    y += ny * d;
    loop.push({ r: rr, y, crease: 0.5 + 0.5 * (b1 * 0.7 + b2 * 0.3), sheet: 0 });
  }
  for (let i = bottoms.length - 2; i >= 1; i--) {
    const t = bottoms[i];
    const r = toR(t);
    loop.push({ r, y: hcBottomNominal(toNom(t)) + 0.03 * Math.sin(a * 4 + t * 9), crease: 0.6, sheet: 1 });
  }
  return { loop, toR, toNom };
}

// Grey at the base, white where the sun reaches, a little darker in every crease between billows.
function hcCloudColor(x, y, z, nx, ny, nz, crease, out) {
  const up = sstep(ny, -0.25, 0.7);
  const high = sstep(y, 1.0, 3.6);
  const t = 0.62 * up + 0.38 * high;
  const c = 0.62 + 0.38 * sstep(crease, 0.05, 0.75);
  out[0] = mix(0.17, 0.82, t) * c;
  out[1] = mix(0.21, 0.84, t) * c;
  out[2] = mix(0.3, 0.88, t) * c;
}

// Indexed grid over (stations x loop), closed round the loop. Wound outward by measurement.
function hcLoft(stations, creases) {
  const S = stations.length;
  const M = stations[0].length;
  const pos = new Float32Array(S * M * 3);
  const uv = new Float32Array(S * M * 2);
  const idx = [];
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < M; j++) {
      const p = stations[i][j];
      const o = i * M + j;
      pos[o * 3] = p[0]; pos[o * 3 + 1] = p[1]; pos[o * 3 + 2] = p[2];
      // Skewed feet, so a wall is not a smear of the same texel.
      uv[o * 2] = (p[0] + p[1] * 0.5) * 0.42;
      uv[o * 2 + 1] = (p[2] + p[1] * 0.7) * 0.42;
    }
  }
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j; const b = i * M + j2; const c = (i + 1) * M + j2; const d = (i + 1) * M + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g = outward(g);
  g.computeVertexNormals();
  const col = new Float32Array(S * M * 3);
  const out = [1, 1, 1];
  const P = g.attributes.position; const N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    hcCloudColor(P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), creases[i], out);
    col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// A flat triangle list facing `normal`, in the plane of a cut face, UV'd by (r, y) onto the section.
const hcSectionUV = (r, y) => [r / 8.2, (y - 0.4) / 5.9];
function hcCutSheet(tris, normal) {
  const pos = []; const uv = [];
  const n = V(...normal);
  const a = V(); const b = V(); const c = V();
  const ab = V(); const ac = V();
  for (const [p, q, s] of tris) {
    a.set(...p.xyz); b.set(...q.xyz); c.set(...s.xyz);
    ab.subVectors(b, a); ac.subVectors(c, a);
    const flip = ab.cross(ac).dot(n) < 0;
    const order = flip ? [p, s, q] : [p, q, s];
    for (const v of order) {
      pos.push(...v.xyz);
      const t = hcSectionUV(v.r, v.y);
      uv.push(t[0], t[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) { nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

// What is inside: the cloud shown in section. A texture, because a tint can only be as detailed as the
// mesh, and a cut face has no interior vertices at all.
function paintHurricaneSection(ctx, w, h) {
  const rng = seededRandom(1900);
  const L = new Float32Array(64 * 64);
  for (let i = 0; i < L.length; i++) L[i] = rng();
  const noise = (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    let fx = x - xi; let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % 64) + 64) % 64; const y0 = ((yi % 64) + 64) % 64;
    const x1 = (x0 + 1) % 64; const y1 = (y0 + 1) % 64;
    const a = L[x0 + y0 * 64]; const b = L[x1 + y0 * 64];
    const c = L[x0 + y1 * 64]; const d = L[x1 + y1 * 64];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let o = 0;
  for (let j = 0; j < h; j++) {
    const y = 0.4 + (1 - j / h) * 5.9;
    for (let i = 0; i < w; i++) {
      const r = (i / w) * 8.2;
      // Convective columns lean with the eyewall.
      const lean = r - (y - 0.8) * 0.22;
      const streak = noise(lean * 5.5, y * 0.8) * 0.6 + noise(lean * 13, y * 1.6) * 0.4;
      const puff = noise(r * 1.6 + 3, y * 1.8) * 0.6 + noise(r * 3.6, y * 3.8 + 2) * 0.4;
      const high = sstep(y, 0.9, 5.0);
      let R = mix(86, 172, high); let G = mix(104, 186, high); let B = mix(136, 212, high);
      const shade = 0.76 + 0.42 * streak + 0.3 * (puff - 0.5);
      R *= shade; G *= shade; B *= shade;
      // The eyewall's rain core, dark and leaning outward with height.
      const wallAt = 1.95 + (y - 0.8) * 0.2;
      const core = Math.exp(-(((r - wallAt) / 0.62) ** 2)) * (1 - sstep(y, 2.6, 5.0));
      R = mix(R, 40, core * 0.8); G = mix(G, 54, core * 0.8); B = mix(B, 88, core * 0.8);
      // The warm, moist air coming in along the sea.
      const warm = (1 - sstep(y, 0.8, 1.7)) * sstep(r, 1.0, 1.5) * (1 - sstep(r, 4.4, 6.5));
      R = mix(R, 250, warm * 0.8); G = mix(G, 150, warm * 0.8); B = mix(B, 70, warm * 0.8);
      d[o++] = Math.min(255, R); d[o++] = Math.min(255, G); d[o++] = Math.min(255, B); d[o++] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function paintHurricaneSea(ctx, w, h) {
  const rng = seededRandom(1780);
  const px = w / (2 * HC.SEA_R + 0.2);
  const cx = w / 2; const cy = h / 2;
  const grad = ctx.createRadialGradient(cx, cy, w * 0.04, cx, cy, w * 0.5);
  grad.addColorStop(0, '#27a9d6');
  grad.addColorStop(0.42, '#1b8fce');
  grad.addColorStop(1, '#1973bb');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const windAt = (x, z) => {
    const a = hcBearing(x, z);
    const tx = Math.cos(a); const tz = -Math.sin(a); // turning counterclockwise
    const rx = -Math.sin(a); const rz = -Math.cos(a); // and drawn inward
    return [tx + rx * 0.34, tz + rz * 0.34];
  };
  // Long swell first, darker, then foam streaks that thicken toward the wall of the storm.
  ctx.lineCap = 'round';
  for (let i = 0; i < 1500; i++) {
    const r = Math.sqrt(rng()) * HC.SEA_R; const a = rng() * TAU;
    const [x, , z] = hcPoint(r, a, 0);
    const [wx, wz] = windAt(x, z);
    const L = (0.3 + rng() * 0.6) * px;
    ctx.strokeStyle = `rgba(10,70,130,${0.12 + rng() * 0.16})`;
    ctx.lineWidth = 1 + rng() * 3;
    ctx.beginPath();
    ctx.moveTo(cx + x * px, cy - z * px);
    ctx.lineTo(cx + (x + wx * L / px) * px, cy - (z + wz * L / px) * px);
    ctx.stroke();
  }
  for (let i = 0; i < 2600; i++) {
    const r = 0.9 + rng() ** 0.7 * (HC.SEA_R - 0.9); const a = rng() * TAU;
    const rough = Math.exp(-(((r - 2.2) / 2.6) ** 2));
    if (rng() > 0.2 + rough * 0.8) continue;
    const [x, , z] = hcPoint(r, a, 0);
    const [wx, wz] = windAt(x, z);
    const L = (0.05 + rng() ** 2 * (0.3 + 0.5 * rough));
    ctx.strokeStyle = `rgba(245,251,255,${0.3 + rng() * 0.6})`;
    ctx.lineWidth = (0.6 + rng() ** 2 * 2.6) * (0.7 + rough * 0.6);
    ctx.beginPath();
    ctx.moveTo(cx + x * px, cy - z * px);
    ctx.quadraticCurveTo(cx + (x + wx * L * 0.6 + wz * 0.02) * px, cy - (z + wz * L * 0.6 - wx * 0.02) * px, cx + (x + wx * L) * px, cy - (z + wz * L) * px);
    ctx.stroke();
    // The little breaking crest at the head of each streak.
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(cx + (x + wx * L) * px, cy - (z + wz * L) * px, ctx.lineWidth * 0.8, 0, TAU);
    ctx.fill();
  }
}

const HC_LABELS = ['EYE', 'EYEWALL', 'WARM OCEAN', 'INFLOW', 'OUTFLOW', 'RAIN BANDS'];
function paintHurricaneLabels(ctx, w, h) {
  const rowH = h / HC_LABELS.length;
  HC_LABELS.forEach((text, i) => {
    const y = i * rowH;
    ctx.fillStyle = '#f7f2e4';
    ctx.fillRect(0, y, w, rowH);
    ctx.strokeStyle = '#1e3a5a';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, y + 10, w - 20, rowH - 20);
    ctx.fillStyle = '#16304e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitFont(ctx, text, w - 70, rowH * 0.56, '800');
    ctx.fillText(text, w / 2, y + rowH * 0.54);
  });
}
const hcLabelUV = (text) => {
  const i = HC_LABELS.indexOf(text);
  const n = HC_LABELS.length;
  return [0.002, 1 - (i + 1) / n + 0.003, 0.998, 1 - i / n - 0.003];
};

// A solid arrow along a curve: a closed tube and a cone seated on its end.
function arrow3D(points, r, { steps = 22, sides = 10, head = 2.6, section = null } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)), false, 'centripetal');
  const L = curve.getLength();
  const headLen = r * head * 2.2;
  const uEnd = 1 - headLen / L;
  const shaft = [];
  for (let i = 0; i <= steps; i++) shaft.push(curve.getPointAt((i / steps) * uEnd).toArray());
  const tubeGeo = tube(shaft, r, { steps, sides, round: 2, section });
  const base = curve.getPointAt(uEnd);
  const tip = curve.getPointAt(1);
  const dir = tip.clone().sub(base).normalize();
  const cone = lathe([[0, -0.05 * headLen], [r * head, -0.05 * headLen], [r * head * 0.96, 0.02 * headLen], [0.001, headLen]], sides + 4);
  cone.applyMatrix4(standAt(base, dir));
  return [tubeGeo, cone];
}

function buildHurricane() {
  const { WEDGE, SEA_R, SEA_Y, RIM } = HC;
  // --- The assertion the card makes. Along a band, turning the way a rises must take you inward. ---
  if (!(hcSpin(6, 0, 0.5) < hcSpin(6, 0, 0))) throw new Error('hurricane-model: the bands would spin clockwise');
  const check = hcPoint(1, 0.1, 0);
  // A small positive step from +Z must move toward +X, which is counterclockwise seen from above.
  if (!(check[0] > 0)) throw new Error('hurricane-model: bearing convention broken');

  const cloudParts = [];
  const cutTris = { plus: [], minus: [] };
  const nPlus = [-Math.cos(WEDGE), 0, Math.sin(WEDGE)]; // the face at a = +WEDGE looks into the gap
  const nMinus = [Math.cos(WEDGE), 0, Math.sin(WEDGE)];

  // --- The central mass: eyewall and dense overcast, all the way round except the wedge ---
  const STATIONS = 116;
  const tops = [];
  const NT = 62;
  for (let i = 0; i <= NT; i++) {
    const u = i / NT;
    tops.push(u < 0.5 ? u * u * 2 * 0.55 + u * 0.3 : u); // packed toward the eye, where the wall is steep
  }
  for (let i = 1; i <= NT; i++) if (tops[i] <= tops[i - 1]) tops[i] = tops[i - 1] + 1e-4;
  const bottoms = [0, 0.1, 0.22, 0.36, 0.52, 0.68, 0.84, 1];
  const span = TAU - 2 * WEDGE;
  const stationPts = [];
  const creases = [];
  for (let s = 0; s <= STATIONS; s++) {
    const a = WEDGE + (s / STATIONS) * span;
    const { loop } = hcSection(a, tops, bottoms);
    stationPts.push(loop.map((p) => hcPoint(p.r, a, p.y)));
    for (const p of loop) creases.push(p.crease);
    if (s === 0 || s === STATIONS) {
      // The cut face: a strip from the top sheet to the underside at the same t.
      const key = s === 0 ? 'plus' : 'minus';
      const topCount = tops.length;
      const bottomAt = (p) => hcBottomNominal(mix(HC_R0, HC_R1, (p.r - loop[0].r) / (loop[topCount - 1].r - loop[0].r)));
      const v = (r, y) => ({ r, y, xyz: hcPoint(r, a, y) });
      for (let i = 0; i < topCount - 1; i++) {
        const p = loop[i]; const q = loop[i + 1];
        const pB = v(p.r, Math.min(p.y, bottomAt(p)));
        const qB = v(q.r, Math.min(q.y, bottomAt(q)));
        const pT = v(p.r, p.y); const qT = v(q.r, q.y);
        cutTris[key].push([pB, qB, qT], [pB, qT, pT]);
      }
    }
  }
  cloudParts.push({ geometry: hcLoft(stationPts, creases), keepColor: true });

  // --- The rain bands, each a swept solid along a true spiral, rooted inside the overcast ---
  const inWedge = (a) => {
    const w = Math.atan2(Math.sin(a), Math.cos(a));
    return Math.abs(w) < WEDGE;
  };
  const armRoots = [];
  const R_ROOT = 3.3;
  const R_TIP = 7.2;
  for (let arm = 0; arm < HC.ARMS; arm++) {
    const aRoot = 0.65 + (arm / HC.ARMS) * TAU;
    const tipScale = [1, 0.97, 0.93][arm];
    const thetaMax = Math.log((R_TIP * tipScale) / R_ROOT) / HC.K;
    armRoots.push({ aRoot, thetaMax });
    // Split the sweep where it crosses the wedge, with stations landing exactly on the cut planes.
    const DT = 0.03;
    const cuts = [0];
    for (let th = 0; th < thetaMax; th += DT) {
      const a0 = aRoot - th; const a1 = aRoot - Math.min(thetaMax, th + DT);
      if (inWedge(a0) !== inWedge(a1)) {
        // Which plane does this step cross?
        for (const plane of [WEDGE, -WEDGE]) {
          for (let wrap = -2; wrap <= 2; wrap++) {
            const target = plane + wrap * TAU;
            if ((a0 - target) * (a1 - target) <= 0) cuts.push(aRoot - target);
          }
        }
      }
    }
    cuts.push(thetaMax);
    cuts.sort((x, y) => x - y);
    for (let c = 0; c < cuts.length - 1; c++) {
      const th0 = cuts[c]; const th1 = cuts[c + 1];
      if (th1 - th0 < 1e-4) continue;
      if (inWedge(aRoot - (th0 + th1) / 2)) continue;
      const count = Math.max(4, Math.round((th1 - th0) / DT));
      const SIDES = 18;
      const stations = [];
      const cr = [];
      let firstLoop = null; let lastLoop = null;
      for (let i = 0; i <= count; i++) {
        const th = th0 + ((th1 - th0) * i) / count;
        const a = aRoot - th;
        const rC = hcSpin(R_ROOT, aRoot, a);
        const u = th / thetaMax;
        const fade = 1 - sstep(u, 0.78, 1);
        const wave = 0.5 + 0.5 * Math.sin(th * 5.3 + arm * 2.1);
        const widthK = (0.34 + 0.2 * u + 0.14 * Math.sin(th * 2.7 + arm) ** 2 + 0.12 * wave) * (0.1 + 0.9 * fade);
        const heightK = (1.12 - 0.46 * u + 0.26 * wave * Math.sin(th * 2.1 + arm * 1.7)) * (0.12 + 0.88 * fade);
        const base = HC.CLOUD_BASE + 0.05 * Math.sin(th * 3 + arm);
        const loop = [];
        for (let j = 0; j < SIDES; j++) {
          const ph = (j / SIDES) * TAU;
          const cp = Math.cos(ph); const sp = Math.sin(ph);
          const rr0 = rC + widthK * cp;
          const yy0 = base + (sp >= 0 ? heightK * Math.abs(sp) ** 0.82 : 0.12 * heightK * sp);
          const [px, , pz] = hcPoint(rr0, a, 0);
          const b = hcBillow(px, yy0, pz, 0.62) * 0.78 + hcBillow(px, yy0, pz, 0.34) * 0.22;
          const amp = (sp > -0.1 ? 0.13 : 0.02) * Math.min(1, heightK + 0.2) * fade + 0.012;
          const rr = rr0 + cp * amp * b * 1.1;
          const yy = yy0 + Math.max(0, sp) * amp * b * 1.2;
          loop.push({ r: rr, y: yy, crease: 0.5 + 0.5 * b, a });
          cr.push(0.5 + 0.5 * b);
        }
        stations.push(loop.map((p) => hcPoint(p.r, a, p.y)));
        if (i === 0) firstLoop = loop;
        if (i === count) lastLoop = loop;
      }
      cloudParts.push({ geometry: hcLoft(stations, cr), keepColor: true });
      // Cap each end: a real cut if it lies on the wedge, otherwise a small plain closure.
      for (const end of [firstLoop, lastLoop]) {
        const a = end[0].a;
        const w = Math.atan2(Math.sin(a), Math.cos(a));
        let cr0 = 0; let cy0 = 0;
        for (const p of end) { cr0 += p.r / end.length; cy0 += p.y / end.length; }
        const v = (r, y) => ({ r, y, xyz: hcPoint(r, a, y) });
        const onPlus = Math.abs(w - WEDGE) < 1e-3;
        const onMinus = Math.abs(w + WEDGE) < 1e-3;
        if (onPlus || onMinus) {
          const list = onPlus ? cutTris.plus : cutTris.minus;
          for (let j = 0; j < end.length; j++) {
            const p = end[j]; const q = end[(j + 1) % end.length];
            list.push([v(cr0, cy0), v(p.r, p.y), v(q.r, q.y)]);
          }
        } else if (end === lastLoop) {
          // The free tip of the band: closed, so there is no hole to look into.
          const dir = [-Math.cos(a), 0, Math.sin(a)];
          const tris = [];
          for (let j = 0; j < end.length; j++) {
            const p = end[j]; const q = end[(j + 1) % end.length];
            tris.push([v(cr0, cy0), v(p.r, p.y), v(q.r, q.y)]);
          }
          const tip = hcCutSheet(tris, dir);
          const col = new Float32Array(tip.attributes.position.count * 3).fill(0.62);
          tip.setAttribute('color', new THREE.BufferAttribute(col, 3));
          cloudParts.push({ geometry: tip, keepColor: true });
        }
      }
    }
  }
  const cloudBump = (() => {
    const rng = seededRandom(77);
    const tex = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#6c6c6c';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1100; i++) {
        const x = rng() * w; const y = rng() * h; const r = 7 + rng() * 26;
        const light = 145 + Math.floor(rng() * 95);
        for (const ox of [-w, 0, w]) {
          for (const oy of [-h, 0, h]) {
            const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
            g.addColorStop(0, `rgba(${light},${light},${light},0.8)`);
            g.addColorStop(1, `rgba(${light},${light},${light},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x + ox, y + oy, r, 0, TAU);
            ctx.fill();
          }
        }
      }
    });
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  })();

  // --- The sea and the plinth ---
  const seaMap = canvasTexture(1024, 1024, paintHurricaneSea);
  const seaUV = (x, z) => [(x + SEA_R + 0.1) / (2 * SEA_R + 0.2), (z + SEA_R + 0.1) / (2 * SEA_R + 0.2)];
  const seaGeo = (() => {
    const RINGS = 30; const SECT = 96;
    const pos = [0, SEA_Y + 0.03, 0];
    const u0 = seaUV(0, 0);
    const uv = [u0[0], u0[1]];
    const idx = [];
    for (let i = 1; i <= RINGS; i++) {
      const r = (i / RINGS) * SEA_R;
      for (let j = 0; j < SECT; j++) {
        const a = (j / SECT) * TAU;
        const [x, , z] = hcPoint(r, a, 0);
        const wave = (i === RINGS ? 0 : 0.016) * (Math.sin(x * 2.1 + z * 1.3) + Math.sin(x * -1.2 + z * 2.7));
        const surge = 0.03 * Math.exp(-((r / 2.4) ** 2));
        pos.push(x, SEA_Y + wave + surge, z);
        const t = seaUV(x, z);
        uv.push(t[0], t[1]);
      }
    }
    for (let j = 0; j < SECT; j++) idx.push(0, 1 + j, 1 + ((j + 1) % SECT));
    for (let i = 0; i < RINGS - 1; i++) {
      for (let j = 0; j < SECT; j++) {
        const j2 = (j + 1) % SECT;
        const a = 1 + i * SECT + j; const b = 1 + i * SECT + j2;
        const c = 1 + (i + 1) * SECT + j2; const d = 1 + (i + 1) * SECT + j;
        idx.push(a, d, c, a, c, b);
      }
    }
    // Close it underneath, flat, so it is a solid.
    const under = pos.length / 3;
    pos.push(0, SEA_Y - 0.2, 0); uv.push(u0[0], u0[1]);
    const rimStart = 1 + (RINGS - 1) * SECT;
    for (let j = 0; j < SECT; j++) {
      const j2 = (j + 1) % SECT;
      idx.push(under, rimStart + j2, rimStart + j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const out = outward(g);
    out.computeVertexNormals();
    return out;
  })();

  const fixed = [];
  const WOOD = 0x3b4d63;
  fixed.push({
    geometry: lathe([
      [0, 0], [RIM, 0], [RIM, 0.2], [RIM - 0.05, 0.25], [RIM - 0.05, 0.42], [RIM - 0.09, 0.47], [SEA_R + 0.02, 0.47], [SEA_R, SEA_Y - 0.02], [0, SEA_Y - 0.25],
    ], 120),
    color: WOOD,
  });
  fixed.push({ geometry: lathe([[0, 0.2], [RIM + 0.015, 0.2], [RIM + 0.015, 0.25], [0, 0.25]], 120), color: 0xc4a050 });

  // --- The arrows. Warm air in along the sea, up the eyewall, cool air out over the top. ---
  const WARM = 0xf0601c;
  const RISE = 0xe23a24;
  const COOL = 0x2670d8;
  const pushArrow = (geos, color) => { for (const g of geos) fixed.push({ geometry: g, color }); };
  // Inflow, lying just over the water in the open wedge: three arrows, each spiralling in as it turns
  // counterclockwise, so they run left to right across the front of the gap.
  const INFLOW_K = 0.44;
  for (const [r0, aFrom, aTo] of [[7.15, -46, 44], [5.55, -46, 44], [4.0, -46, 45]]) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = mix(aFrom, aTo, i / 12) * DEG;
      pts.push(hcPoint(hcSpin(r0, aFrom * DEG, a, INFLOW_K), a, SEA_Y + 0.2));
    }
    if (!(Math.hypot(pts[12][0], pts[12][2]) < Math.hypot(pts[0][0], pts[0][2]))) throw new Error('hurricane-model: inflow arrow runs outward');
    // Counterclockwise from above means the signed area swept about the axis is positive in (z, x).
    const cross = pts[0][2] * pts[12][0] - pts[0][0] * pts[12][2];
    if (!(cross > 0)) throw new Error('hurricane-model: inflow arrow turns clockwise');
    pushArrow(arrow3D(pts, 0.1, { steps: 30, sides: 10 }), WARM);
  }
  // Rising and outflow arrows stand a little proud of each cut face, in that face's own plane.
  const onFace = (a, n, r, y, off = 0.14) => {
    const p = hcPoint(r, a, y);
    return [p[0] + n[0] * off, y, p[2] + n[2] * off];
  };
  for (const [a, n] of [[WEDGE, nPlus], [-WEDGE, nMinus]]) {
    const rise = (list, r0) => pushArrow(arrow3D(list.map(([r, y]) => onFace(a, n, r, y)), r0, { steps: 26, sides: 10 }), RISE);
    rise([[3.4, 0.92], [2.75, 1.02], [2.24, 1.65], [2.06, 2.75], [2.16, 3.9], [2.32, 4.9]], 0.1);
    rise([[4.1, 0.96], [3.6, 1.06], [3.15, 1.5], [2.9, 2.2], [2.76, 3.0]], 0.075);
    // Up and out: what rose in the eyewall leaves above the deck, spreading away from the storm.
    pushArrow(arrow3D([[2.5, 5.5], [3.05, 5.66], [3.9, 5.4], [4.85, 4.9], [5.85, 4.3]].map(([r, y]) => onFace(a, n, r, y)), 0.085, { steps: 24, sides: 10 }), COOL);
  }
  // Outflow over the top of the storm: outward and turning the OTHER way, as it really does aloft.
  const topAt = (r, a) => {
    const { loop } = hcSection(a, tops, bottoms);
    let best = loop[0];
    for (let i = 0; i < tops.length; i++) if (Math.abs(loop[i].r - r) < Math.abs(best.r - r)) best = loop[i];
    return best.y;
  };
  for (const a0 of [110, 180, 250].map((d) => d * DEG)) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const r = mix(2.6, 6.0, t);
      const a = a0 - t * 0.5;
      // Rooted in the crest, a low arc off it, and falling away beyond the wall.
      const crest = topAt(2.6, a0);
      const y = crest - 0.12 + 0.34 * Math.sin(Math.PI * Math.min(1, t * 1.6)) - 1.3 * t * t;
      pts.push(hcPoint(r, a, y));
    }
    pushArrow(arrow3D(pts, 0.085, { steps: 22, sides: 10 }), COOL);
  }
  // Four flat arrows round the rim, the plainest statement on the model of which way it turns.
  for (let k = 0; k < 4; k++) {
    const a0 = 8 + k * 90;
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push(hcPoint((SEA_R + RIM) / 2 - 0.02, (a0 + i * 6.2) * DEG, 0.5));
    pushArrow(arrow3D(pts, 0.1, { steps: 24, sides: 10, head: 2.1, section: () => [0.4, 1] }), 0xf6f0dc);
  }

  // --- Labels ---
  const labels = [];
  const labelMap = canvasTexture(768, 768, paintHurricaneLabels);
  const placeLabel = (text, w, h, pos, normal, tilt = 0) => {
    const g = printedPlate(w, h, 0.05, hcLabelUV(text));
    const n = V(...normal).normalize();
    const side = V().crossVectors(UP, n).normalize();
    const up = V().crossVectors(n, side);
    const m = new THREE.Matrix4().makeBasis(side, up, n);
    if (tilt) m.multiply(new THREE.Matrix4().makeRotationX(tilt));
    m.setPosition(pos[0], pos[1], pos[2]);
    g.applyMatrix4(m);
    labels.push({ geometry: g, keepColor: true });
  };
  const BRASS = 0xbf9c4a;
  // EYE: on a slim stem at the very centre, where the water is calm.
  fixed.push({ geometry: rod([0, SEA_Y - 0.1, 0], [0, 2.72, 0], 0.028, 10, 1), color: BRASS });
  placeLabel('EYE', 1.05, 0.48, [0, 2.98, 0.04], [0, 0, 1]);
  // EYEWALL: on the -X cut face, beside the wall it names.
  placeLabel('EYEWALL', 1.5, 0.42, onFace(-WEDGE, nMinus, 2.62, 3.5, 0.06), nMinus);
  // OUTFLOW, on the +X face under its arrow.
  {
    const at = onFace(WEDGE, nPlus, 5.3, 0, 0.3);
    fixed.push({ geometry: rod([at[0], 3.3, at[2]], [at[0], 4.6, at[2]], 0.024, 8, 1), color: BRASS });
    placeLabel('OUTFLOW', 1.42, 0.4, [at[0], 3.2, at[2] + 0.02], nPlus);
  }
  // WARM OCEAN: a plate leaning back on a stand at the front of the sea.
  const leanSign = (text, w, h, r, a, y, tilt) => {
    const [x, , z] = hcPoint(r, a, 0);
    const n = [Math.sin(a), 0, Math.cos(a)];
    placeLabel(text, w, h, [x, y, z], n, tilt);
    // Two feet down to the water, seated on it.
    const side = V(Math.cos(a), 0, -Math.sin(a));
    for (const s of [-1, 1]) {
      const fx = x + side.x * s * w * 0.32; const fz = z + side.z * s * w * 0.32;
      fixed.push({ geometry: rod([fx - n[0] * 0.12, SEA_Y - 0.05, fz - n[2] * 0.12], [fx - n[0] * 0.1, y + 0.02, fz - n[2] * 0.1], 0.03, 8, 1), color: BRASS });
    }
  };
  leanSign('WARM OCEAN', 2.5, 0.54, 7.0, 0, 0.72, -42 * DEG);
  // INFLOW, by the arrows, and RAIN BANDS on a stem, out beside the band it names.
  {
    const a = -24 * DEG;
    const at = hcPoint(5.72, a, 0);
    fixed.push({ geometry: rod([at[0], SEA_Y - 0.1, at[2]], [at[0], 1.2, at[2]], 0.026, 10, 1), color: BRASS });
    placeLabel('INFLOW', 1.32, 0.38, [at[0], 1.34, at[2] + 0.02], [Math.sin(a), 0, Math.cos(a)]);
  }
  const rainStem = onFace(WEDGE, nPlus, 6.3, 0, 0.62);
  fixed.push({ geometry: rod([rainStem[0], SEA_Y - 0.1, rainStem[2]], [rainStem[0], 2.45, rainStem[2]], 0.026, 10, 1), color: BRASS });
  placeLabel('RAIN BANDS', 1.7, 0.42, [rainStem[0], 2.6, rainStem[2] + 0.02], nPlus);

  // --- Rain: one faint streaked curtain mesh under the eyewall and the bands ---
  const rain = [];
  const rainRibbon = (samples, width) => {
    const pos = []; const uv = [];
    let s = 0;
    const quad = (a, b, c, d, ua, ub) => {
      for (const [p, u, v] of [[a, ua, 1], [b, ub, 1], [c, ub, 0], [a, ua, 1], [c, ub, 0], [d, ua, 0]]) { pos.push(...p); uv.push(u, v); }
    };
    for (let i = 0; i < samples.length - 1; i++) {
      const A = samples[i]; const B = samples[i + 1];
      const step = Math.hypot(B.x - A.x, B.z - A.z);
      const u0 = s * 0.8; s += step; const u1 = s * 0.8;
      const offs = [[-width, -width], [width, width]];
      for (const [wa, wb] of offs) {
        const a0 = [A.x + A.ox * wa, A.top, A.z + A.oz * wa];
        const b0 = [B.x + B.ox * wb, B.top, B.z + B.oz * wb];
        const c0 = [B.x + B.ox * wb, SEA_Y + 0.02, B.z + B.oz * wb];
        const d0 = [A.x + A.ox * wa, SEA_Y + 0.02, A.z + A.oz * wa];
        if (wa > 0) quad(a0, b0, c0, d0, u0, u1); else quad(b0, a0, d0, c0, u1, u0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  // Under the eyewall, all the way round the solid part of the storm.
  {
    const samples = [];
    const COUNT = 60;
    for (let i = 0; i <= COUNT; i++) {
      const a = WEDGE + 0.01 + (i / COUNT) * (span - 0.02);
      const [x, , z] = hcPoint(2.1, a, 0);
      samples.push({ x, z, ox: Math.sin(a), oz: Math.cos(a), top: hcBottomNominal(2.1) + 0.04 });
    }
    rain.push({ geometry: rainRibbon(samples, 0.55), keepColor: false, color: 0xffffff });
  }
  for (const { aRoot, thetaMax } of armRoots) {
    let run = [];
    const flush = () => {
      if (run.length > 3) rain.push({ geometry: rainRibbon(run, 0.26), keepColor: false, color: 0xffffff });
      run = [];
    };
    const COUNT = 46;
    for (let i = 0; i <= COUNT; i++) {
      const th = 0.18 + (i / COUNT) * (thetaMax * 0.8);
      const a = aRoot - th;
      if (inWedge(a)) { flush(); continue; }
      const r = hcSpin(R_ROOT, aRoot, a);
      const [x, , z] = hcPoint(r, a, 0);
      run.push({ x, z, ox: Math.sin(a), oz: Math.cos(a), top: HC.CLOUD_BASE + 0.03 });
    }
    flush();
  }
  const rainMap = (() => {
    const rng = seededRandom(52);
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const x = rng() * w; const a = 0.14 + rng() * 0.32;
        const y0 = rng() * h * 0.4; const y1 = y0 + h * (0.3 + rng() * 0.6);
        ctx.strokeStyle = `rgba(214,224,236,${a})`;
        ctx.lineWidth = 0.8 + rng() * 2.4;
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x - 3, y1); ctx.stroke();
      }
    });
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  })();

  const cutPlus = hcCutSheet(cutTris.plus, nPlus);
  const cutMinus = hcCutSheet(cutTris.minus, nMinus);
  const sectionMap = canvasTexture(1024, 768, paintHurricaneSection);

  const root = new THREE.Group();
  const seaMesh = mesh(seaGeo, standard({ map: seaMap, roughness: 0.34, metalness: 0.02, emissive: 0xffffff, emissiveMap: seaMap, emissiveIntensity: 0.06 }));
  const cloud = mesh(mergeParts(cloudParts), standard({ vertexColors: true, bumpMap: cloudBump, bumpScale: 0.5, roughness: 0.96, metalness: 0, emissive: 0x9aa0aa, emissiveIntensity: 0.22 }));
  const cut = mesh(mergeParts([{ geometry: cutPlus, keepColor: true }, { geometry: cutMinus, keepColor: true }]), standard({ map: sectionMap, roughness: 0.9, metalness: 0, emissive: 0xffffff, emissiveMap: sectionMap, emissiveIntensity: 0.22 }));
  cut.castShadow = false;
  const hardware = mesh(mergeParts(fixed), standard({ vertexColors: true, roughness: 0.46, metalness: 0.06 }));
  const labelMesh = mesh(mergeParts(labels), standard({ map: labelMap, roughness: 0.6, metalness: 0, emissive: 0xffffff, emissiveMap: labelMap, emissiveIntensity: 0.14 }));
  const rainMesh = mesh(mergeParts(rain), standard({ map: rainMap, transparent: true, depthWrite: false, opacity: 0.62, roughness: 1, metalness: 0, color: 0xc6d2e0 }));
  rainMesh.castShadow = false;
  rainMesh.receiveShadow = false;
  root.add(seaMesh, cloud, cut, hardware, labelMesh, rainMesh);
  return root;
}

// ===========================================================================================
// THE INTERNATIONAL SPACE STATION
// ===========================================================================================
//
// Authored at true size, in feet: 356ft across the solar wings. The catalogue shows it at a tenth, so
// everything here is judged at about 200 authored feet, which is 20ft in the world: a truss member
// that was truly a few inches would be less than a pixel, and it is made a foot and a half thick.
//
// Directions, as the station flies. +Z here is forward, the way it travels. Up is away from the Earth.
// The truss runs across, along X. Facing forward with your head up your right hand points at -X, so
// starboard is -X: Columbus and Quest are on that side, Kibo and Tranquility on the +X side.

const ISS = {
  YT: 132, // height of the truss's axis, which leaves the wing tips well clear of the floor
  YM: 132 - 21.5, // height of the modules' axis, under the truss
  ZSHIFT: -34, // the pressurised stack, as measured along itself, moved so that Destiny is over the mount
  ALPHA: 50 * DEG, // how far the outer truss and its wings have turned on the big rotary joints
  HALF: 7.5, // half the truss's square section
  MEMBER: 1.6,
};

function issBeam(a, b, w, h = w) {
  const { m, len } = alongMatrix(a, b, Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]) + Math.abs(b[2] - a[2]) ? [1, 0, 0] : [0, 1, 0]);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

function paintIssCells(ctx, w, h) {
  // Near white: it multiplies each wing's own colour, so gold and blue share one tile.
  const rng = seededRandom(1998);
  ctx.fillStyle = '#fbfbfb';
  ctx.fillRect(0, 0, w, h);
  const N = 16;
  const cw = w / N;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = 214 + Math.floor(rng() * 40);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(c * cw + 1.5, r * cw + 1.5, cw - 3, cw - 3);
      ctx.fillStyle = 'rgba(70,50,30,0.2)';
      ctx.fillRect(c * cw + 1.5, r * cw + cw / 3, cw - 3, 1);
      ctx.fillRect(c * cw + 1.5, r * cw + (2 * cw) / 3, cw - 3, 1);
    }
  }
  // The grid between cells, dark enough to survive being a few pixels at twenty feet.
  ctx.fillStyle = '#4d4034';
  for (let i = 0; i <= N; i++) {
    ctx.fillRect(i * cw - 1.5, 0, 3, h);
    ctx.fillRect(0, i * cw - 1.5, w, 3);
  }
  // A heavier division every four cells: the panel of a real blanket.
  ctx.fillStyle = '#2d2620';
  for (let i = 0; i <= N; i += 4) {
    ctx.fillRect(i * cw - 3.5, 0, 7, h);
    ctx.fillRect(0, i * cw - 3.5, w, 7);
  }
}

function paintIssPanels(ctx, w, h) {
  const rng = seededRandom(2000);
  ctx.fillStyle = '#f1efe9';
  ctx.fillRect(0, 0, w, h);
  // Micrometeoroid shield panels, a few of them replaced or weathered.
  const cols = 3; const rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = 218 + Math.floor(rng() * 34);
      ctx.fillStyle = `rgb(${v},${v - 1},${v - 5})`;
      ctx.fillRect((c * w) / cols + 3, (r * h) / rows + 3, w / cols - 6, h / rows - 6);
    }
  }
  ctx.fillStyle = '#a9a7a1';
  for (let c = 0; c <= cols; c++) ctx.fillRect((c * w) / cols - 3, 0, 6, h);
  for (let r = 0; r <= rows; r++) ctx.fillRect(0, (r * h) / rows - 3, w, 6);
  // Rivet lines.
  ctx.fillStyle = 'rgba(70,70,66,0.55)';
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < 24; k++) {
      ctx.fillRect((k / 24) * w, (r * h) / rows + 14, 3, 3);
      ctx.fillRect((k / 24) * w, ((r + 1) * h) / rows - 16, 3, 3);
    }
  }
  // Handrails, as short dark dashes along the length.
  ctx.fillStyle = 'rgba(120,96,40,0.75)';
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) ctx.fillRect(((c + 0.5) * w) / cols - 2, (r * h) / rows + 30, 5, h / rows - 60);
  }
}

function paintIssPlate(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#26364e');
  grad.addColorStop(1, '#172231');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c7a55a';
  ctx.lineWidth = 7;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#f5f1e4';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'INTERNATIONAL SPACE STATION', w - 80, 70, '800');
  ctx.fillText('INTERNATIONAL SPACE STATION', w / 2, h * 0.38);
  ctx.fillStyle = '#d6dde8';
  fitFont(ctx, 'About 356 feet across. Shown at about 1/10 of life size', w - 80, 38, '600');
  ctx.fillText('About 356 feet across. Shown at about 1/10 of life size', w / 2, h * 0.72);
}

// One blanket of solar cells between x0 and x1, running s0 to s1 along +Z, its cell face up (+Y). A real
// solid, so it does not vanish edge on, and its underside is plain.
function issBlanket(x0, x1, s0, s1, t, front, back) {
  const TILE = 25;
  const pos = []; const uv = []; const col = [];
  const F = lin(front); const B = lin(back);
  const quad = (a, b, c, d, face) => {
    const rgb = face === 'top' ? F : B;
    for (const p of [a, b, c, a, c, d]) {
      pos.push(p[0], p[1], p[2]);
      // Everything but the cell face samples the middle of one cell, not the dark grid between them.
      uv.push(face === 'top' ? p[0] / TILE : 0.031, face === 'top' ? p[2] / TILE : 0.031);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  };
  const y1 = t / 2; const y0 = -t / 2;
  quad([x0, y1, s1], [x1, y1, s1], [x1, y1, s0], [x0, y1, s0], 'top');
  quad([x0, y0, s0], [x1, y0, s0], [x1, y0, s1], [x0, y0, s1], 'under');
  quad([x0, y0, s1], [x1, y0, s1], [x1, y1, s1], [x0, y1, s1], 'side');
  quad([x1, y0, s0], [x0, y0, s0], [x0, y1, s0], [x1, y1, s0], 'side');
  quad([x1, y0, s1], [x1, y0, s0], [x1, y1, s0], [x1, y1, s1], 'side');
  quad([x0, y0, s0], [x0, y0, s1], [x0, y1, s1], [x0, y1, s0], 'side');
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function buildSpaceStation() {
  const { YT, YM, ZSHIFT, ALPHA, HALF, MEMBER } = ISS;
  const struct = []; // everything plain: truss, radiators, joints, arm, mount
  const hull = []; // the pressurised modules, carrying the shield panel map
  const array = []; // the solar blankets, carrying the cell map

  const WHITE = 0xdfe1e3;
  const SILVER = 0xb3b8be;
  const GREY = 0x858b92;
  const DARK = 0x3f454c;
  const GOLD_FOIL = 0xc9a14a;
  const ARRAY_GOLD = 0xe8981c;
  const ARRAY_BACK = 0xd8c9a2;
  const ARRAY_BLUE = 0x2f5fb0;

  // --- The truss. Inner part fixed to the station; each outer part turned on its big rotary joint. ---
  const innerM = new THREE.Matrix4().makeTranslation(0, YT, 0);
  const outerM = new THREE.Matrix4().makeTranslation(0, YT, 0).multiply(new THREE.Matrix4().makeRotationX(ALPHA));

  const add = (list, geometry, color, m = null) => {
    if (m) geometry.applyMatrix4(m);
    list.push({ geometry, color });
  };
  const trussSpan = (x0, x1, m, bays, half = HALF, member = MEMBER) => {
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * half, b * half]);
    for (const [y, z] of corners) add(struct, issBeam([x0, y, z], [x1, y, z], member), WHITE, m);
    for (let b = 0; b <= bays; b++) {
      const x = mix(x0, x1, b / bays);
      for (let c = 0; c < 4; c++) {
        const [y0, z0] = corners[c]; const [y1, z1] = corners[(c + 1) % 4];
        add(struct, issBeam([x, y0, z0], [x, y1, z1], member * 0.8), SILVER, m);
        if (b < bays) {
          const x2 = mix(x0, x1, (b + 1) / bays);
          const flip = (b + c) % 2 === 0;
          add(struct, issBeam(flip ? [x, y0, z0] : [x2, y0, z0], flip ? [x2, y1, z1] : [x, y1, z1], member * 0.62), SILVER, m);
        }
      }
    }
    // A pale spine inside, so the truss has mass from far off and does not dissolve into lines.
    add(struct, block(x0, -half * 0.42, -half * 0.42, x1, half * 0.42, half * 0.42), 0xa4a9af, m);
  };
  const SARJ_X = 74;
  const TRUSS_END = 155;
  trussSpan(-SARJ_X + 4, SARJ_X - 4, innerM, 10);
  for (const sx of [-1, 1]) {
    const x0 = sx * (SARJ_X + 4); const x1 = sx * TRUSS_END;
    trussSpan(x0, x1, outerM, 11);
    // The rotary joint: a big ring, which is the first thing anyone notices about the outer truss.
    const ring = turned([
      [0, -4.5], [HALF + 3.5, -4.5], [HALF + 5.2, -3.6], [HALF + 5.2, -1.5], [HALF + 6.2, -1], [HALF + 6.2, 1], [HALF + 5.2, 1.5], [HALF + 5.2, 3.6], [HALF + 3.5, 4.5], [0, 4.5],
    ], 28, { crease: 28 });
    ring.rotateZ(-Math.PI / 2);
    ring.translate(sx * SARJ_X, 0, 0);
    add(struct, ring, SILVER, innerM);
  }
  // S0: the heavy centre segment, boxed in, that sits on the laboratory.
  add(struct, block(-22, -HALF - 0.4, -HALF - 1, 22, HALF + 0.4, HALF + 1), 0xcfd2d6, innerM);
  for (const x of [-16, -4, 8, 18]) add(struct, block(x - 2.6, HALF + 0.4, -4.5, x + 2.6, HALF + 3.2, 4.5), GREY, innerM);
  // Its front and back carry the same lattice as the rest, standing proud of the box.
  for (const fz of [HALF + 1.4, -HALF - 1.4]) {
    for (let b = 0; b < 3; b++) {
      const x0 = -22 + (b * 44) / 3; const x1 = -22 + ((b + 1) * 44) / 3;
      add(struct, issBeam([x0, -HALF, fz], [x1, HALF, fz], 1.1), SILVER, innerM);
      add(struct, issBeam([x0, HALF, fz], [x1, -HALF, fz], 1.1), SILVER, innerM);
      add(struct, issBeam([x0, -HALF, fz], [x0, HALF, fz], 1.3), GREY, innerM);
    }
  }
  // Struts from the truss to Destiny's roof.
  const destinyZ = 34 + ZSHIFT;
  for (const [sx, dz] of [[-1, -7], [1, -7], [-1, 7], [1, 7]]) {
    add(struct, issBeam([sx * 8, YT - HALF - 0.2, dz], [sx * 4.2, YM + 5.4, destinyZ + dz * 0.9], 1.5), GREY);
  }
  // Stowed equipment along the truss: pallets and boxes in silver and foil.
  for (const [x, up, w, c] of [[-46, 1, 15, GOLD_FOIL], [46, 1, 15, 0xd7d9dc], [-60, -1, 11, 0xd7d9dc], [60, -1, 11, GOLD_FOIL]]) {
    add(struct, block(x - w / 2, up > 0 ? HALF + 0.4 : -HALF - 3.4, -5, x + w / 2, up > 0 ? HALF + 3.4 : -HALF - 0.4, 5), c, innerM);
  }
  // AMS-02, the particle detector, on top of the starboard outer truss: a drum in a frame.
  {
    const x = -96;
    const drum = turned([[0, -4.5], [5, -4.5], [5.4, -4], [5.4, 4], [5, 4.5], [0, 4.5]], 20, { crease: 30 });
    drum.translate(x, HALF + 6, 0);
    add(struct, drum, 0xc6c9cd, outerM);
    add(struct, block(x - 7, HALF + 0.4, -7, x + 7, HALF + 1.8, 7), GREY, outerM);
  }

  // --- The eight wings: four pairs, each pair one mast out each side of the turned truss ---
  const wingCentres = [-159, -110, 110, 159];
  let wingCount = 0;
  const BLANKET_IN = 2.6;
  const BLANKET_OUT = 19;
  const S0 = 11; const S1 = 123;
  for (const xc of wingCentres) {
    for (const dir of [1, -1]) {
      wingCount += 1;
      // A half turn about the vertical swings this wing to the other side of the truss, with its cells
      // still on the same face. It also flips x, which is why the far wing asks for -xc.
      const faceM = dir > 0 ? outerM : outerM.clone().multiply(new THREE.Matrix4().makeRotationY(Math.PI));
      const xLocal = dir > 0 ? xc : -xc;
      for (const [a, b] of [[xLocal - BLANKET_OUT, xLocal - BLANKET_IN], [xLocal + BLANKET_IN, xLocal + BLANKET_OUT]]) {
        const g = issBlanket(a, b, S0, S1, 1.1, ARRAY_GOLD, ARRAY_BACK);
        g.applyMatrix4(faceM);
        array.push({ geometry: g, keepColor: true });
      }
      // The mast: a slim lattice up the middle, its battens showing every eight feet.
      add(struct, block(xLocal - 1.1, -1.1, S0, xLocal + 1.1, 1.1, S1), WHITE, faceM);
      for (let s = S0 + 8; s < S1; s += 8) add(struct, block(xLocal - 1.9, -1.5, s - 0.5, xLocal + 1.9, 1.5, s + 0.5), SILVER, faceM);
      // The box at the root the blankets folded into, and the bar at the tip that keeps them taut.
      add(struct, block(xLocal - BLANKET_OUT - 0.4, -2.4, S0 - 4, xLocal + BLANKET_OUT + 0.4, 2.4, S0 + 0.6), SILVER, faceM);
      add(struct, block(xLocal - BLANKET_OUT - 0.4, -1, S1 - 0.6, xLocal + BLANKET_OUT + 0.4, 1, S1 + 1.1), SILVER, faceM);
      // The arm to the truss.
      add(struct, block(xLocal - 2.2, -2.2, HALF - 0.5, xLocal + 2.2, 2.2, S0 - 3.5), GREY, faceM);
    }
    // The beta gimbal, a short drum on the truss's axis at the wing's centre line.
    const gimbal = turned([[0, -3.6], [HALF + 1.6, -3.6], [HALF + 1.9, -3], [HALF + 1.9, 3], [HALF + 1.6, 3.6], [0, 3.6]], 16, { crease: 40 });
    gimbal.rotateZ(-Math.PI / 2);
    gimbal.translate(xc, 0, 0);
    add(struct, gimbal, GREY, outerM);
  }
  if (wingCount !== 8) throw new Error(`space-station: ${wingCount} solar wings, not 8`);

  // --- The small radiators on the outer truss, which hang off the opposite side from the sun ---
  const panelStrip = (x0, x1, a, b, panels, m, thick = 0.8, color = 0xe8eaec) => {
    // A folding radiator between a and b: panels with slits, zig-zagged a little so each catches light.
    for (let k = 0; k < panels; k++) {
      const t0 = k / panels; const t1 = (k + 0.93) / panels;
      const p = [mix(a[0], b[0], t0), mix(a[1], b[1], t0)];
      const q = [mix(a[0], b[0], t1), mix(a[1], b[1], t1)];
      const wob = k % 2 === 0 ? 0.28 : -0.28;
      const g = new THREE.BoxGeometry(x1 - x0, thick, Math.hypot(q[0] - p[0], q[1] - p[1]));
      const ang = Math.atan2(-(q[0] - p[0]), q[1] - p[1]) + wob * 0.3;
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(ang));
      g.translate((x0 + x1) / 2, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      add(struct, g, k % 2 === 0 ? color : 0xdcdfe2, m);
    }
    // A boom the panels hang from.
    add(struct, issBeam([(x0 + x1) / 2, a[0], a[1]], [(x0 + x1) / 2, b[0], b[1]], 1.1), SILVER, m);
  };
  const pvrDir = [-Math.cos(0.15), -Math.sin(0.15)]; // [y, z] in the turned frame: straight off the back
  for (const xc of [-134.5, -85, 85, 134.5]) {
    panelStrip(xc - 4.6, xc + 4.6, [-HALF, 0], [-HALF + pvrDir[0] * 42, pvrDir[1] * 42], 7, outerM);
  }

  // --- The big main radiators on the fixed truss, three a side, tilted back ---
  const hrsTilt = 26 * DEG;
  for (const sx of [-1, 1]) {
    for (const off of [34, 48, 62]) {
      const x = sx * off;
      panelStrip(x - 5.8, x + 5.8, [-HALF, 0], [-HALF - Math.cos(hrsTilt) * 74, -Math.sin(hrsTilt) * 74], 8, innerM, 0.9);
      const rootJoint = turned([[0, -6.4], [2.6, -6.4], [3.2, -5.6], [3.2, 5.6], [2.6, 6.4], [0, 6.4]], 12, { crease: 40 });
      rootJoint.rotateZ(-Math.PI / 2);
      rootJoint.translate(x, -HALF - 1.2, 0);
      add(struct, rootJoint, GREY, innerM);
    }
  }

  // --- Modules. Each is turned about its own axis, then laid along Z, or across along X, or hung down. ---
  const uvSpec = (r) => ({ uTiles: Math.max(1, Math.round((TAU * r) / 15)), vScale: 1 / 15, crease: 26 });
  const zStack = (profile, color, r = 7, x = 0, y = YM, segments = 40, list = hull) => {
    const g = turned(profile, segments, uvSpec(r));
    g.rotateX(Math.PI / 2);
    g.translate(x, y, ZSHIFT);
    list.push({ geometry: g, color });
  };
  const xStack = (profile, color, r, y, z, sign, segments = 40, list = hull) => {
    const g = turned(profile, segments, uvSpec(r));
    g.rotateZ(sign > 0 ? -Math.PI / 2 : Math.PI / 2);
    g.translate(0, y, z);
    list.push({ geometry: g, color });
  };
  const yStack = (profile, color, r, x, z, y0, up, segments = 40, list = hull) => {
    const g = turned(profile, segments, uvSpec(r));
    if (!up) g.rotateX(Math.PI);
    g.translate(x, y0, z);
    list.push({ geometry: g, color });
  };
  // A cylinder module with shallow dished ends, from a to b.
  const can = (a, b, r) => {
    const d = Math.min(r * 0.22, (b - a) * 0.12);
    return [[0, a], [r * 0.6, a + d * 0.15], [r * 0.9, a + d * 0.55], [r, a + d], [r, b - d], [r * 0.9, b - d * 0.55], [r * 0.6, b - d * 0.15], [0, b]];
  };
  const HULL_WHITE = 0xf0eee8;
  const RU_CREAM = 0xd8cfae;
  const RU_GREEN = 0x9aa582;

  // The Russian end, along the axis, aft to fore.
  zStack([[0, -112], [4.2, -112], [4.5, -110], [4.5, -98], [3.6, -96], [3.6, -93], [4.2, -92], [4.2, -89], [0, -88.5]], RU_GREEN, 4.5); // Progress, docked at the back
  zStack([[0, -88.5], [3, -88.5], [6.2, -87.5], [6.8, -86], [6.8, -67], [5.1, -65], [4.85, -63], [4.85, -53], [5.6, -51], [6.5, -49], [6.2, -46.6], [4.2, -45], [0, -45]], RU_CREAM, 6.8); // Zvezda
  zStack([[0, -45], [4, -45], [4.6, -44], [4.6, -36], [6.75, -33], [6.75, -11], [6, -8.2], [4.3, -5], [4, -4], [0, -4]], RU_CREAM, 6.75); // Zarya
  zStack([[0, -4], [3.6, -4], [4.1, -3.4], [4.1, 0], [4.5, 1], [4.5, 2.4], [0, 2.4]], GREY, 4.2); // the adapter to the US side
  // The US side, and at the front the node the Europeans and the Japanese are bolted to.
  zStack(can(2, 20, 7.2), HULL_WHITE, 7.2); // Unity
  zStack(can(20, 48, 7.2), HULL_WHITE, 7.2); // Destiny
  zStack(can(48, 71, 7.2), HULL_WHITE, 7.2); // Harmony
  zStack([[0, 71], [4.4, 71], [4.4, 74], [3.8, 76], [3.4, 77.4], [0, 77.4]], GREY, 4); // the docking adapter
  // Columbus (starboard, -X) and Kibo (port, +X), from Harmony.
  const harmonyZ = 59.5 + ZSHIFT;
  xStack(can(6.5, 30, 7.3), HULL_WHITE, 7.3, YM, harmonyZ, -1);
  xStack(can(6.5, 44, 7.3), 0xe9e7e0, 7.3, YM, harmonyZ, 1);
  // Kibo's logistics section on its roof, and the exposed porch off its far end.
  yStack(can(7, 20, 4.8), 0xe9e7e0, 4.8, 24, harmonyZ, YM, true);
  add(struct, block(44, YM - 2.2, harmonyZ - 8, 62, YM + 2.2, harmonyZ + 8), 0xbfc3c8);
  for (const [dx, dz] of [[48, -4], [55, 4], [50, 4.5]]) add(struct, block(dx - 2.6, YM + 2.2, harmonyZ + dz - 2.6, dx + 2.6, YM + 6, harmonyZ + dz + 2.6), dx === 55 ? GOLD_FOIL : 0xd4d6d9);
  // Kibo's own small robot arm, reaching out over the porch.
  {
    const a0 = [38, YM + 7, harmonyZ + 3.6]; const a1 = [50, YM + 13, harmonyZ + 7]; const a2 = [60, YM + 8, harmonyZ + 2];
    add(struct, rod(a0, a1, 0.7, 8, 1), 0xf1f1ee);
    add(struct, rod(a1, a2, 0.6, 8, 1), 0xf1f1ee);
    const j = new THREE.SphereGeometry(1, 10, 8);
    j.translate(a1[0], a1[1], a1[2]);
    add(struct, j, DARK);
  }
  // Quest (starboard) and Tranquility (port), from Unity.
  const unityZ = 11 + ZSHIFT;
  xStack(can(6.5, 16, 7), HULL_WHITE, 7, YM, unityZ, -1);
  xStack(can(15.5, 24, 5), 0xe9e7e0, 5, YM, unityZ, -1);
  xStack(can(6.5, 29.5, 7.1), HULL_WHITE, 7.1, YM, unityZ, 1);
  // The storage module on Tranquility's forward side.
  const TQ_X = 17;
  {
    const g = turned(can(5, 24, 7), uvSpec(7));
    g.rotateX(Math.PI / 2);
    g.translate(TQ_X + 5.5, YM, unityZ);
    hull.push({ geometry: g, color: 0xe6e4dd });
  }
  // BEAM, the inflated test module, on Tranquility's end.
  xStack([[0, 29], [3.2, 29], [4.4, 30.5], [4.8, 33], [4.4, 35.8], [3.2, 37.2], [0, 37.2]], 0xcdc5a9, 4.8, YM, unityZ, 1, 24);

  // --- The Cupola, hung under Tranquility and looking at the Earth ---
  {
    const cx = TQ_X - 5.5;
    const yTop = YM - 6.2;
    const rBase = 7.2; // a little bigger than life: at a tenth it would otherwise be a wart
    // Six flat sides from the wide base up to a round top, pointing down.
    const bodyProfile = [[0, 0], [rBase * 0.9, 0], [rBase * 0.94, 0.6], [rBase * 0.94, 1.5], [rBase * 0.88, 2.5], [rBase * 0.62, 6.3], [rBase * 0.56, 7.1], [rBase * 0.5, 7.5], [0, 7.5]];
    const body = turned(bodyProfile, 6, { crease: 22 });
    body.rotateY(Math.PI / 6);
    body.rotateX(Math.PI);
    body.translate(cx, yTop, unityZ);
    add(struct, body, 0xd8dadd);
    // Six trapezoid windows lying on the six faces, and the big round one at the bottom.
    const GLASS = 0x18304e;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + Math.PI / 6 + Math.PI / 6;
      const radial = V(Math.sin(a), 0, Math.cos(a));
      // Down the face: the Cupola narrows toward the Earth, so the face leans inward as it descends.
      const lean = rBase * 0.26 * Math.cos(Math.PI / 6);
      const along = V(-radial.x * lean, -3.8, -radial.z * lean).normalize();
      const apothem = (r) => r * Math.cos(Math.PI / 6);
      const mid = V(cx + radial.x * apothem(rBase * 0.75), yTop - 4.4, unityZ + radial.z * apothem(rBase * 0.75));
      const n = V().crossVectors(V(radial.z, 0, -radial.x), along).normalize();
      if (n.dot(radial) < 0) n.negate();
      const side = V().crossVectors(along, n).normalize();
      // A pale frame with the dark glass let into it, proud of the face: the only way to get a recess.
      const m = new THREE.Matrix4().makeBasis(side, along, n);
      m.setPosition(mid.clone().addScaledVector(n, 0.06));
      const frame = new THREE.BoxGeometry(rBase * 0.58, 3.5, 0.3);
      frame.applyMatrix4(m);
      add(struct, frame, 0xf0f1f2);
      const m2 = new THREE.Matrix4().makeBasis(side, along, n);
      m2.setPosition(mid.clone().addScaledVector(n, 0.2));
      const pane = new THREE.BoxGeometry(rBase * 0.46, 2.7, 0.3);
      pane.applyMatrix4(m2);
      add(struct, pane, GLASS);
    }
    const round = turned([[0, -0.1], [rBase * 0.34, -0.1], [rBase * 0.34, 0.1], [rBase * 0.2, 0.22], [0, 0.26]], 18, { crease: 30 });
    round.rotateX(Math.PI);
    round.translate(cx, yTop - 7.5, unityZ);
    add(struct, round, GLASS);
  }

  // --- Russian modules hung under the stack, and what is docked to them ---
  const zvezdaNodeZ = -49 + ZSHIFT;
  yStack(can(4, 47, 6.75), RU_CREAM, 6.75, 0, zvezdaNodeZ, YM, false); // Nauka, nadir of Zvezda
  // Prichal, the ball on the bottom of Nauka.
  {
    const ball = new THREE.SphereGeometry(5.1, 20, 14);
    ball.translate(0, YM - 49, zvezdaNodeZ);
    hull.push({ geometry: ball, color: RU_CREAM });
  }
  yStack(can(5.5, 20, 4.2), RU_CREAM, 4.2, 0, zvezdaNodeZ, YM, true); // Poisk, on top
  yStack(can(5.5, 26, 3.9), RU_CREAM, 3.9, 0, -25 + ZSHIFT, YM, false); // Rassvet, under Zarya
  // A Soyuz under Rassvet: orbital ball, bell, service drum, and two blue wings.
  {
    const x = 0; const z = -25 + ZSHIFT;
    const top = YM - 26;
    const soyuzGreen = 0x8c9676;
    const ball = new THREE.SphereGeometry(3.6, 18, 12);
    ball.translate(x, top - 3.2, z);
    hull.push({ geometry: ball, color: soyuzGreen });
    yStack([[0, 5.8], [1.8, 5.8], [4, 9], [4.3, 11], [0, 11]], 0x7f7a66, 4, x, z, top, false, 24);
    yStack(can(11, 19, 3.6), soyuzGreen, 3.6, x, z, top, false, 24);
    for (const sx of [-1, 1]) {
      const y = top - 15;
      add(struct, block(Math.min(sx * 3, sx * 5), y - 0.4, z - 0.4, Math.max(sx * 3, sx * 5), y + 0.4, z + 0.4), GREY);
      const wing = issBlanket(0, 12, -2.6, 2.6, 0.5, ARRAY_BLUE, 0x8f9db3);
      wing.rotateX(Math.PI / 2);
      wing.translate(sx > 0 ? 5 : -17, y, z);
      array.push({ geometry: wing, keepColor: true });
    }
  }
  // Zvezda's own solar wings, blue, near its back end.
  {
    const z = -76 + ZSHIFT;
    for (const sx of [-1, 1]) {
      const a = sx > 0 ? 8 : -56; const b = sx > 0 ? 56 : -8;
      const g = issBlanket(a, b, -7, 7, 0.9, ARRAY_BLUE, 0x8f9db3);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(0.14));
      g.translate(0, YM, z);
      array.push({ geometry: g, keepColor: true });
      add(struct, block(sx > 0 ? 6 : -56.6, YM - 0.8, z - 0.8, sx > 0 ? 56.6 : -6, YM + 0.8, z + 0.8), SILVER);
    }
  }

  // Thermal-blanket bands round the Russian hulls, the tell of that end of the station from any side.
  for (const [z0, z1, r, c] of [[-84, -80, 6.92, 0x8d8a78], [-71, -68, 6.92, 0x8d8a78], [-58, -55.5, 5, 0x8d8a78], [-30, -27, 6.88, 0x8d8a78], [-16, -13, 6.88, 0x8d8a78]]) {
    add(struct, (() => {
      const g = turned([[r - 0.6, z0], [r, z0], [r, z1], [r - 0.6, z1]], 40, { crease: 30 });
      g.rotateX(Math.PI / 2);
      g.translate(0, YM, ZSHIFT);
      return g;
    })(), c);
  }
  // Nauka's radiators, folded out each side, and its European arm's base.
  for (const sx of [-1, 1]) {
    const y = YM - 30;
    add(struct, block(sx > 0 ? 6 : -17, y - 7, zvezdaNodeZ - 0.4, sx > 0 ? 17 : -6, y + 7, zvezdaNodeZ + 0.4), 0xe8eaec);
  }

  // --- The docked capsule, at the front: a Crew Dragon, nose to the adapter, its trunk beyond ---
  {
    const z0 = 77.4;
    const shell = [
      [0, z0], [1.7, z0 + 0.05], [2.4, z0 + 0.8], [3.1, z0 + 2.2], [4.2, z0 + 4.4], [5.1, z0 + 7], [5.85, z0 + 9.8], [6, z0 + 11.4], [5.95, z0 + 12.4], [0, z0 + 12.6],
    ];
    zStack(shell, 0xf4f3ef, 6);
    // The dark band of its service section, and the trunk half white and half solar.
    const trunk = turned([[0, z0 + 12.3], [5.96, z0 + 12.3], [5.96, z0 + 21.8], [5.4, z0 + 22.6], [0, z0 + 22.8]], 40, uvSpec(6));
    const pos = trunk.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const dark = pos.getX(i) > 0 ? [0.07, 0.08, 0.1] : [0.8, 0.8, 0.8];
      col[i * 3] = dark[0]; col[i * 3 + 1] = dark[1]; col[i * 3 + 2] = dark[2];
    }
    trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
    trunk.rotateX(Math.PI / 2);
    trunk.translate(0, YM, ZSHIFT);
    hull.push({ geometry: trunk, keepColor: true });
  }

  // --- Canadarm2, on its mobile base on the truss's top ---
  {
    const bx = -12; const by = YT + HALF + 0.4; const bz = 0;
    add(struct, block(bx - 8, by, bz - 8, bx + 8, by + 3, bz + 8), 0xc9ccd0);
    const shoulder = [bx, by + 6, bz];
    const elbow = [bx + 8, by + 25, bz + 19];
    const wrist = [bx + 26, by + 14, bz + 37];
    add(struct, rod([bx, by + 3, bz], shoulder, 1.6, 10, 1), DARK);
    add(struct, rod(shoulder, elbow, 1.15, 10, 1), 0xf1f1ee);
    add(struct, rod(elbow, wrist, 1.15, 10, 1), 0xf1f1ee);
    for (const p of [shoulder, elbow, wrist]) {
      const j = new THREE.SphereGeometry(1.9, 12, 8);
      j.translate(p[0], p[1], p[2]);
      add(struct, j, DARK);
    }
    add(struct, rod(wrist, [wrist[0] + 3, wrist[1] - 4, wrist[2] + 2], 1.05, 8, 1), DARK);
  }

  // --- The tall slim mount, up to a saddle under Destiny ---
  const BASE_R = 30;
  const topY = YM - 7;
  add(struct, lathe([
    [0, 0], [BASE_R, 0], [BASE_R, 2.4], [BASE_R - 0.6, 3.1], [BASE_R - 1.4, 3.6], [BASE_R - 2.4, 4], [10, 4.2], [7, 5.6], [4.4, 11], [0, 11],
  ], 72), 0x384656);
  add(struct, turned([[BASE_R - 0.4, 1.7], [BASE_R + 0.22, 1.7], [BASE_R + 0.22, 2.3], [BASE_R - 0.4, 2.3]], 72, { crease: 30 }), 0xc4a050);
  add(struct, lathe([
    [0, 10], [3.6, 10], [2.8, 16], [2.3, 40], [1.9, topY - 8], [2.2, topY - 6], [2.8, topY - 3], [0, topY - 3],
  ], 24), 0x40505f);
  // The saddle's two arms reach up either side of the laboratory.
  add(struct, lathe([[0, topY - 4], [3.2, topY - 4], [3.6, topY - 2], [4.6, topY - 0.6], [4.8, topY + 0.6], [0, topY + 0.8]], 24), 0x8a7a50);

  // --- The plate, on the base's slope at the front ---
  const PLATE_W = 32; const PLATE_H = 6;
  const plateM = new THREE.Matrix4().makeRotationX(-66 * DEG).setPosition(0, 5.9, BASE_R - 11.5);
  const plateGeo = printedPlate(PLATE_W, PLATE_H, 0.6, [0, 0, 1, 1]);
  plateGeo.applyMatrix4(plateM);
  const backing = block(-PLATE_W / 2 - 0.7, -PLATE_H / 2 - 0.7, -5, PLATE_W / 2 + 0.7, PLATE_H / 2 + 0.7, -0.3);
  backing.applyMatrix4(plateM);
  add(struct, backing, 0xc4a050);

  const cellMap = canvasTexture(512, 512, paintIssCells);
  cellMap.wrapS = THREE.RepeatWrapping;
  cellMap.wrapT = THREE.RepeatWrapping;
  const panelMap = canvasTexture(512, 512, paintIssPanels);
  panelMap.wrapS = THREE.RepeatWrapping;
  panelMap.wrapT = THREE.RepeatWrapping;
  const plateMap = canvasTexture(1024, 192, paintIssPlate);

  const root = new THREE.Group();
  root.add(
    mesh(mergeParts(struct), standard({ vertexColors: true, roughness: 0.5, metalness: 0.12 })),
    mesh(mergeParts(hull), standard({ vertexColors: true, map: panelMap, roughness: 0.55, metalness: 0.05 })),
    mesh(mergeParts(array), standard({ vertexColors: true, map: cellMap, roughness: 0.42, metalness: 0.12, emissive: 0x3a2200, emissiveIntensity: 0.25 })),
    mesh(plateGeo, standard({ map: plateMap, roughness: 0.5, metalness: 0.1, emissive: 0xffffff, emissiveMap: plateMap, emissiveIntensity: 0.1 })),
  );
  root.userData.wings = wingCount;
  return root;
}

export const BUILDERS = {
  'periodic-table': () => buildPeriodicTable(),
  'sputnik-1': (options) => buildSputnik(options),
  'galileo-telescope': () => buildGalileoTelescope(),
  'hurricane-model': () => buildHurricane(),
  'space-station': () => buildSpaceStation(),
};
