import * as THREE from 'three';
import { standard, mesh, group, canvasTexture } from '../PropKit.js';
import { revolve, mergeParts, put } from './LoftKit.js';
import { reducedMotion } from '../Settings.js';
import {
  ELEMENTS, FAMILIES, CELL, TREND_EN, TREND_RADIUS, towerHeight, cellOf, MOLECULES, MOLECULE_SCALE, ATOM_STYLE,
  SALT, SALT_SCALE, TANK, GAUGE, RADIUS_PM_PER_FOOT, EN_FEET_PER_UNIT, elementBySymbol,
} from './AtomModel.js';

// Atom Hall -- the periodic table as a skyline you walk through, walk-around molecules, a salt
// crystal you can stand inside, and a tank of particles run by a temperature in block code.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call. Nothing here is
// random, so a world rebuilt from its records is the world the student first saw. See PropKit.js.

export const AH = {
  skyline: '#3d86d6',
  trend: '#6a5ad0',
  molecule: '#d63a30',
  salt: '#2a9f96',
  tank: '#e8892b',
};

const paint = (extra = {}) => standard({ vertexColors: true, roughness: 0.5, metalness: 0.04, ...extra });
const solid = (parts, extra) => mesh(mergeParts(parts), paint(extra));
const lathed = (profile, opts) => revolve([...profile].reverse(), opts);
const UP = new THREE.Vector3(0, 1, 0);

// Scenery a student looks at and never selects. Without a raycast a click falls through to
// whatever is behind it, which is how a particle inside the glass can still be clicked.
function scenery(object3D, { shadows = null } = {}) {
  object3D.traverse((node) => {
    if (!node.isMesh) return;
    node.raycast = () => {};
    if (shadows !== null) {
      node.castShadow = shadows;
      node.receiveShadow = shadows;
    }
  });
  return object3D;
}

function fitText(ctx, text, weight, size, family, room) {
  ctx.font = `${weight} ${size}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width <= room) return size;
  const fitted = Math.max(6, Math.floor(size * room / width));
  ctx.font = `${weight} ${fitted}px ${family}`;
  return fitted;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// A closed round bar between two points. The rotation is baked in, since a merged part only
// carries one Euler.
function stick(parts, a, b, radius, color, sides = 14) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const span = to.clone().sub(from);
  const length = span.length();
  if (length < 1e-4) return;
  const g = new THREE.CylinderGeometry(radius, radius, length, sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, span.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  parts.push({ geometry: g, color });
}

const block = (parts, w, h, d, color, at, rotation = null) => put(parts, new THREE.BoxGeometry(w, h, d), color, at, rotation);

// Words on a solid board, front +Z, with a real back from behind.
function printedBoard(w, h, thick, draw, { pixelsPerFoot = 64, emissive = 0.3, frame = 0x2a2f38 } = {}) {
  const parts = [];
  block(parts, w + 0.3, h + 0.3, thick, frame, [0, 0, 0]);
  const texture = canvasTexture(Math.round(w * pixelsPerFoot), Math.round(h * pixelsPerFoot), draw);
  const face = mesh(
    new THREE.PlaneGeometry(w, h),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: emissive, roughness: 0.85 }),
  );
  face.position.z = thick / 2 + 0.01;
  return group(solid(parts), face);
}

// ---------------------------------------------------------------------------
// The skyline
// ---------------------------------------------------------------------------

const PLINTH = 5.2; // the lit shopfront every tower stands in. No real value is shorter than this.
const PLINTH_HALF = 3.7;
const TOWER_HALF = 3.5;
const CAP_HALF = 3.65;
const FULL = 66; // every tower is built this tall and sunk into the ground to its value
const CAP = 0.5;
const BAND = 2.4;
const HIDDEN = 2; // where a tower with no value stops, inside its plinth
const WINDOW_U = TOWER_HALF * 2 / 3;
const WINDOW_V = 3.4;

class Buffers {
  constructor() {
    this.position = [];
    this.normal = [];
    this.uv = [];
    this.color = [];
    this.index = [];
  }

  // bl is the bottom-left corner as seen from outside, R and U the edges to its right and up. That
  // order is counter-clockwise from outside, and R x U is the outward normal.
  quad(bl, R, U, color, [u0, v0, u1, v1]) {
    const n = new THREE.Vector3(...R).cross(new THREE.Vector3(...U)).normalize();
    const start = this.position.length / 3;
    const corners = [
      [0, 0, u0, v0], [1, 0, u1, v0], [1, 1, u1, v1], [0, 1, u0, v1],
    ];
    for (const [a, b, u, v] of corners) {
      this.position.push(bl[0] + R[0] * a + U[0] * b, bl[1] + R[1] * a + U[1] * b, bl[2] + R[2] * a + U[2] * b);
      this.normal.push(n.x, n.y, n.z);
      this.uv.push(u, v);
      this.color.push(color.r, color.g, color.b);
    }
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }

  // The four walls of a square in plan, each handed its own uv rectangle.
  walls(cx, cz, half, y0, y1, color, uvFor) {
    const w = half * 2;
    const h = y1 - y0;
    this.quad([cx - half, y0, cz + half], [w, 0, 0], [0, h, 0], color, uvFor(w, y0, y1));
    this.quad([cx + half, y0, cz - half], [-w, 0, 0], [0, h, 0], color, uvFor(w, y0, y1));
    this.quad([cx + half, y0, cz + half], [0, 0, -w], [0, h, 0], color, uvFor(w, y0, y1));
    this.quad([cx - half, y0, cz - half], [0, 0, w], [0, h, 0], color, uvFor(w, y0, y1));
  }

  // A closed box: the walls, a lid and a floor.
  box(cx, cz, half, y0, y1, color, uvFor) {
    const w = half * 2;
    this.walls(cx, cz, half, y0, y1, color, uvFor);
    const flat = [0.01, 0.01, 0.01, 0.01];
    this.quad([cx - half, y1, cz + half], [w, 0, 0], [0, 0, -w], color, flat);
    this.quad([cx - half, y0, cz - half], [w, 0, 0], [0, 0, w], color, flat);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.setIndex(this.index);
    return g;
  }
}

// A near-white tile, because `map` multiplies the family colour on every tower: one tile serves
// the whole city. The windows are drawn with a border of wall all round so the seam never shows.
function windowTile() {
  const texture = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9d9d4';
    ctx.fillRect(0, h * 0.04, w, h * 0.06);
    ctx.fillStyle = '#3f4c5c';
    ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.62);
    ctx.fillStyle = '#6d7e91';
    ctx.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.12);
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(w * 0.48, h * 0.2, w * 0.04, h * 0.62);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function valueLabel(value, unit) {
  return value == null ? 'no value' : `${value}${unit}`;
}

// One tile of the table: the shopfront every tower carries on all four sides.
function drawPlate(ctx, x, y, w, h, element) {
  const color = FAMILIES[element.family].color;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(14,18,26,0.34)';
  ctx.fillRect(x + w * 0.5, y, w * 0.5, h);
  ctx.strokeStyle = '#141820';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(h * 0.15)}px ${SANS}`;
  ctx.fillText(String(element.z), x + w * 0.05, y + h * 0.2);
  fitText(ctx, element.symbol, 800, Math.round(h * 0.5), SANS, w * 0.4);
  ctx.fillText(element.symbol, x + w * 0.05, y + h * 0.68);
  fitText(ctx, element.name, 700, Math.round(h * 0.135), SANS, w * 0.42);
  ctx.fillText(element.name, x + w * 0.05, y + h * 0.88);

  const col = x + w * 0.54;
  const room = w * 0.43;
  ctx.fillStyle = '#d8e1ee';
  fitText(ctx, 'RADIUS', 700, Math.round(h * 0.1), SANS, room);
  ctx.fillText('RADIUS', col, y + h * 0.2);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, valueLabel(element.radius, ' pm'), 800, Math.round(h * 0.2), SANS, room);
  ctx.fillText(valueLabel(element.radius, ' pm'), col, y + h * 0.42);
  ctx.fillStyle = '#d8e1ee';
  fitText(ctx, 'ELECTRONEGATIVITY', 700, Math.round(h * 0.1), SANS, room);
  ctx.fillText('ELECTRONEGATIVITY', col, y + h * 0.62);
  ctx.fillStyle = '#ffffff';
  const en = element.en == null ? null : element.en.toFixed(2);
  fitText(ctx, valueLabel(en, ''), 800, Math.round(h * 0.2), SANS, room);
  ctx.fillText(valueLabel(en, ''), col, y + h * 0.84);
}

const ATLAS_COLUMNS = 16;
const ATLAS_ROWS = 8;

function atlasUv(index, inset = 0.002) {
  const column = index % ATLAS_COLUMNS;
  const row = Math.floor(index / ATLAS_COLUMNS);
  return [
    column / ATLAS_COLUMNS + inset,
    1 - (row + 1) / ATLAS_ROWS + inset,
    (column + 1) / ATLAS_COLUMNS - inset,
    1 - row / ATLAS_ROWS - inset,
  ];
}

// THE WHOLE TABLE IS ONE PROP, four meshes, whatever it costs to model: 118 towers as 118 objects
// would be 236 draw calls and 118 green play icons. It answers the buttons by reading the `trend`
// value they share (the third argument of its tick), and it is scenery: a click on a tower does
// nothing, because Size, Move and Program mean nothing for one tower in a merged city.
//
// A TOWER DOES NOT STRETCH, IT RISES. Every one is built 66ft tall and sunk into the ground until
// the part above it is its value, so the windows and the roof band ride up with it and only the
// vertex positions ever change, which is also the one thing the HiFi bridge syncs. That needs flat
// ground under the whole table, which is why the atomhall theme has an amplitude of 0.
export function skyline() {
  const towers = new Buffers();
  const bands = new Buffers();
  const plinths = new Buffers();
  const plates = new Buffers();
  const ranges = [];
  const tmp = new THREE.Color();

  ELEMENTS.forEach((element, index) => {
    const { x, z } = cellOf(element);
    const family = tmp.set(FAMILIES[element.family].color).clone();
    const cap = family.clone().lerp(new THREE.Color(0xffffff), 0.4);
    const white = new THREE.Color(0xffffff);

    const startT = towers.position.length / 3;
    towers.box(x, z, TOWER_HALF, 0, FULL - CAP, family, (w, y0, y1) => [0, y0 / WINDOW_V, w / WINDOW_U, y1 / WINDOW_V]);
    towers.box(x, z, CAP_HALF, FULL - CAP, FULL, cap, () => [0.01, 0.01, 0.01, 0.01]);
    const endT = towers.position.length / 3;

    const startB = bands.position.length / 3;
    const uv = atlasUv(index);
    bands.walls(x, z, TOWER_HALF + 0.02, FULL - CAP - BAND, FULL - CAP, white, () => uv);
    const endB = bands.position.length / 3;

    const dark = new THREE.Color(0x22262e);
    plinths.box(x, z, PLINTH_HALF, 0, PLINTH, dark, () => [0, 0, 0, 0]);
    plates.walls(x, z, PLINTH_HALF + 0.02, 0.05, PLINTH - 0.05, white, () => uv);

    const height = towerHeight(element, TREND_RADIUS) ?? HIDDEN;
    ranges.push({ element, startT, endT, startB, endB, height, target: height });
  });

  const towerGeometry = towers.geometry();
  const bandGeometry = bands.geometry();
  const towerBase = towerGeometry.attributes.position.array.slice();
  const bandBase = bandGeometry.attributes.position.array.slice();
  towerGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  bandGeometry.attributes.position.setUsage(THREE.DynamicDrawUsage);

  // The buffers hold moving vertices, so bounds worked out from them would be stale the moment a
  // tower rose and the near side of the city would cull away. These hold for every height.
  const bounds = new THREE.Sphere(new THREE.Vector3(0, FULL / 2, 0), Math.hypot(CELL * 9.5, CELL * 5.5, FULL));
  towerGeometry.boundingSphere = bounds;
  bandGeometry.boundingSphere = bounds.clone();

  const place = (range) => {
    const dy = range.height - FULL;
    const write = (attribute, base, from, to) => {
      const array = attribute.array;
      for (let i = from; i < to; i++) array[i * 3 + 1] = base[i * 3 + 1] + dy;
    };
    write(towerGeometry.attributes.position, towerBase, range.startT, range.endT);
    write(bandGeometry.attributes.position, bandBase, range.startB, range.endB);
  };
  ranges.forEach(place);

  const body = mesh(towerGeometry, standard({ map: windowTile(), vertexColors: true, roughness: 0.6, metalness: 0.03 }));
  body.receiveShadow = true;

  const bandTexture = canvasTexture(2048, 352, (ctx, w, h) => {
    const cw = w / ATLAS_COLUMNS;
    const ch = h / ATLAS_ROWS;
    ELEMENTS.forEach((element, index) => {
      const x = (index % ATLAS_COLUMNS) * cw;
      const y = Math.floor(index / ATLAS_COLUMNS) * ch;
      ctx.fillStyle = '#1b2029';
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = FAMILIES[element.family].color;
      ctx.fillRect(x, y + ch - 2, cw, 2);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(ch * 0.78)}px ${SANS}`;
      ctx.fillText(element.symbol, x + cw / 2, y + ch * 0.52);
    });
  });
  const band = mesh(bandGeometry, standard({ map: bandTexture, emissive: 0xffffff, emissiveMap: bandTexture, emissiveIntensity: 0.3, roughness: 0.8 }));
  band.castShadow = false;

  const plinth = mesh(plinths.geometry(), paint({ roughness: 0.75 }));
  plinth.castShadow = false;

  const plateTexture = canvasTexture(3584, 1232, (ctx, w, h) => {
    const cw = w / ATLAS_COLUMNS;
    const ch = h / ATLAS_ROWS;
    ELEMENTS.forEach((element, index) => {
      drawPlate(ctx, (index % ATLAS_COLUMNS) * cw, Math.floor(index / ATLAS_COLUMNS) * ch, cw, ch, element);
    });
  });
  const plate = mesh(plates.geometry(), standard({ map: plateTexture, emissive: 0xffffff, emissiveMap: plateTexture, emissiveIntensity: 0.32, roughness: 0.85 }));
  plate.castShadow = false;

  const g = scenery(group(body, band, plinth, plate));

  let trend = TREND_RADIUS;
  let moving = false;
  g.userData.tick = {
    update(dt, camera, worldVars) {
      const wanted = worldVars?.get('trend') === TREND_EN ? TREND_EN : TREND_RADIUS;
      if (wanted !== trend) {
        trend = wanted;
        moving = true;
        for (const range of ranges) range.target = towerHeight(range.element, trend) ?? HIDDEN;
      }
      if (!moving) return;
      // Exponential, so the tallest moves fastest and they all arrive together. Nothing is written
      // when nothing is moving: a still city uploads no vertices at all.
      const ease = reducedMotion() ? 1 : 1 - Math.exp(-1.7 * dt);
      moving = false;
      for (const range of ranges) {
        const gap = range.target - range.height;
        if (gap === 0) continue;
        range.height = Math.abs(gap) < 0.02 ? range.target : range.height + gap * ease;
        if (range.height !== range.target) moving = true;
        place(range);
      }
      towerGeometry.attributes.position.needsUpdate = true;
      bandGeometry.attributes.position.needsUpdate = true;
    },
  };
  return g;
}

// The streets, with the column and period numbers painted where a student crosses them.
export function tableFloor() {
  const halfX = CELL * 9.6;
  const north = cellOf({ column: 1, row: 1 }).z - CELL;
  const south = cellOf({ column: 1, row: 10 }).z + CELL * 0.7;
  const depth = south - north;
  const width = halfX * 2;
  const texture = canvasTexture(2048, Math.round(2048 * depth / width), (ctx, w, h) => {
    const px = w / width;
    const X = (x) => (x + halfX) * px;
    const Z = (z) => (z - north) * px;
    ctx.fillStyle = '#5b6068';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7a8088';
    ctx.lineWidth = 2;
    for (const element of ELEMENTS) {
      const { x, z } = cellOf(element);
      ctx.strokeRect(X(x - CELL / 2), Z(z - CELL / 2), CELL * px, CELL * px);
    }
    ctx.fillStyle = '#f2f4f7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(6 * px)}px ${SANS}`;
    for (let column = 1; column <= 18; column++) {
      const { x } = cellOf({ column, row: 1 });
      ctx.fillText(String(column), X(x), Z(north + CELL * 0.45));
    }
    ctx.font = `800 ${Math.round(4.6 * px)}px ${SANS}`;
    for (let row = 1; row <= 7; row++) {
      const { z } = cellOf({ column: 1, row });
      ctx.fillText(String(row), X(-halfX + 2.2), Z(z));
      ctx.fillText(String(row), X(halfX - 2.2), Z(z));
    }
  });
  const parts = [];
  block(parts, width, 0.1, depth, 0x3d4148, [0, 0.05, (north + south) / 2]);
  const printed = mesh(new THREE.PlaneGeometry(width, depth), standard({ map: texture, roughness: 0.92 }));
  printed.rotation.x = -Math.PI / 2;
  printed.position.set(0, 0.11, (north + south) / 2);
  printed.castShadow = false;
  const base = solid(parts);
  base.castShadow = false;
  return scenery(group(base, printed));
}

// The hall itself: a ring of columns just inside the world's edge. It gives the fog something to
// fade behind and says where the world stops, in a world with no hills or trees to do either.
export function hallRing({ radius = 188, columns = 72, height = 46 } = {}) {
  const parts = [];
  const stone = 0xd5cdbc;
  const shade = 0xb6ad9a;
  for (let i = 0; i < columns; i++) {
    const a = (i / columns) * Math.PI * 2;
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    put(parts, new THREE.CylinderGeometry(1.5, 1.8, height - 5, 20), stone, [x, 2 + (height - 5) / 2, z]);
    block(parts, 5.2, 2, 5.2, shade, [x, 1, z], [0, a, 0]);
    block(parts, 4.6, 2.4, 4.6, shade, [x, height - 1.8, z], [0, a, 0]);
  }
  const chord = 2 * radius * Math.sin(Math.PI / columns) + 0.7;
  for (let i = 0; i < columns; i++) {
    const a = ((i + 0.5) / columns) * Math.PI * 2;
    const r = radius * Math.cos(Math.PI / columns);
    block(parts, chord, 4, 4.4, stone, [Math.sin(a) * r, height + 1.4, Math.cos(a) * r], [0, a, 0]);
    block(parts, chord + 0.1, 1.1, 5.4, shade, [Math.sin(a) * r, height + 3.9, Math.cos(a) * r], [0, a, 0]);
  }
  const ring = solid(parts, { roughness: 0.85 });
  ring.castShadow = false;
  return scenery(group(ring));
}

// A button on a post. It is a real object with a program a student can open, and the green play
// icon over it is the way to press it.
export function trendButton({ label = 'ATOMIC RADIUS', subtitle = 'Press the green arrow', color = '#3d86d6' } = {}) {
  const parts = [];
  put(parts, lathed([[0, 0], [0.95, 0], [0.95, 0.2], [0.42, 0.36], [0.32, 2], [0.7, 2.2], [0, 2.2]], { segments: 32 }), 0x2a2f38);
  put(parts, lathed([[0, 2.15], [0.8, 2.15], [0.8, 2.35], [0.66, 2.55], [0, 2.63]], { segments: 32 }), new THREE.Color(color).getHex());
  const plate = printedBoard(3.1, 1.3, 0.12, (ctx, w, h) => {
    ctx.fillStyle = '#141923';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h * 0.08);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, label, 800, Math.round(h * 0.34), SANS, w * 0.92);
    ctx.fillText(label, w / 2, h * 0.52);
    ctx.fillStyle = '#c9d2df';
    fitText(ctx, subtitle, 600, Math.round(h * 0.2), SANS, w * 0.92);
    ctx.fillText(subtitle, w / 2, h * 0.82);
  }, { pixelsPerFoot: 96 });
  plate.position.set(0, 1.15, 0.38);
  return group(solid(parts), plate);
}

// The printed table, with a marker saying where the student is standing. Without it a table seen
// from one corner is a city, not a periodic table: nobody reads it backwards unaided.
export function tableMap({ here = 'He', title = 'You are at helium', note = '' } = {}) {
  const W = 13.5;
  const H = 8.6;
  // Up on long legs, so a kiosk or a student in front of it hides the posts and not the table.
  const LEG = 5.4;
  const parts = [];
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.2, 0.26, LEG + H * 0.75, 12), 0x363b47, [sx * (W / 2 + 0.5), (LEG + H * 0.75) / 2, -0.12]);
  }
  const board = printedBoard(W, H, 0.34, (ctx, w, h) => {
    ctx.fillStyle = '#10151d';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, title, 800, Math.round(h * 0.075), SANS, w * 0.92);
    ctx.fillText(title, w * 0.03, h * 0.09);
    ctx.fillStyle = '#c9d2df';
    fitText(ctx, note, 500, Math.round(h * 0.036), SANS, w * 0.94);
    ctx.fillText(note, w * 0.03, h * 0.145);

    const left = w * 0.03;
    const top = h * 0.175;
    const cell = (w * 0.94) / 18;
    const cellH = (h * 0.62) / 9.5;
    const spot = ({ column, row }) => ({
      x: left + (column - 1) * cell,
      y: top + ((row >= 9 ? row - 0.5 : row) - 1) * cellH,
    });
    ctx.textAlign = 'center';
    for (const element of ELEMENTS) {
      const { x, y } = spot(element);
      ctx.fillStyle = FAMILIES[element.family].color;
      ctx.fillRect(x + 1, y + 1, cell - 2, cellH - 2);
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(cellH * 0.5)}px ${SANS}`;
      ctx.fillText(element.symbol, x + cell / 2, y + cellH * 0.68);
    }
    const mine = spot(elementBySymbol(here));
    ctx.strokeStyle = '#ffe14d';
    ctx.lineWidth = 8;
    ctx.strokeRect(mine.x - 3, mine.y - 3, cell + 6, cellH + 6);

    const names = Object.values(FAMILIES);
    const legendTop = h * 0.815;
    ctx.textAlign = 'left';
    names.forEach((family, i) => {
      const x = w * 0.03 + (i % 4) * (w * 0.235);
      const y = legendTop + Math.floor(i / 4) * (h * 0.05);
      ctx.fillStyle = family.color;
      ctx.fillRect(x, y, h * 0.032, h * 0.032);
      ctx.fillStyle = '#e8edf4';
      ctx.font = `600 ${Math.round(h * 0.03)}px ${SANS}`;
      ctx.fillText(family.name, x + h * 0.045, y + h * 0.028);
    });
  }, { pixelsPerFoot: 96, emissive: 0.36 });
  board.position.set(0, LEG + H / 2, 0);
  return group(solid(parts), board);
}

// ---------------------------------------------------------------------------
// The molecules
// ---------------------------------------------------------------------------

function perpendicular(bond, ringCentre, at) {
  if (ringCentre) {
    const toward = ringCentre.clone().sub(at);
    const along = bond.clone().multiplyScalar(toward.dot(bond));
    return toward.sub(along).normalize();
  }
  const side = bond.clone().cross(new THREE.Vector3(0, 0, 1));
  if (side.lengthSq() < 1e-6) side.copy(bond).cross(UP);
  return side.normalize();
}

// Ball and stick, on a stand. Bonds are two-tone, half each atom's colour; a double bond is two
// sticks, and benzene's 1.5 is one stick and a thin one on the ring's inside, because all six of
// its bonds are the same length. Atoms and bonds come straight from AtomModel.js, so what a student
// walks round is the geometry on the placard.
export function molecule({ kind = 'water' } = {}) {
  const data = MOLECULES[kind];
  if (!data) throw new Error(`Unknown molecule: ${kind}`);
  const S = MOLECULE_SCALE;
  const raw = data.atoms.map(([element, x, y, z]) => ({ element, at: new THREE.Vector3(x * S, y * S, z * S) }));

  const box = new THREE.Box3();
  for (const atom of raw) box.expandByPoint(atom.at);
  const lift = Math.max(6, 2.6 - box.min.y + ATOM_STYLE.H.ball * S);
  const offset = new THREE.Vector3(-(box.min.x + box.max.x) / 2, lift, -(box.min.z + box.max.z) / 2);
  for (const atom of raw) atom.at.add(offset);
  const centre = raw.reduce((sum, atom) => sum.add(atom.at), new THREE.Vector3()).multiplyScalar(1 / raw.length);

  const parts = [];
  for (const { element, at } of raw) {
    const style = ATOM_STYLE[element];
    put(parts, new THREE.SphereGeometry(style.ball * S, 26, 18), style.color, at.toArray());
  }

  const ring = kind === 'benzene' ? centre : null;
  for (const [a, b, order] of data.bonds) {
    const A = raw[a];
    const B = raw[b];
    const axis = B.at.clone().sub(A.at).normalize();
    const mid = A.at.clone().add(B.at).multiplyScalar(0.5);
    const twoTone = (shift, radius) => {
      const from = A.at.clone().add(shift);
      const to = B.at.clone().add(shift);
      const middle = mid.clone().add(shift);
      stick(parts, from.toArray(), middle.toArray(), radius, ATOM_STYLE[A.element].color);
      stick(parts, middle.toArray(), to.toArray(), radius, ATOM_STYLE[B.element].color);
    };
    if (order === 2) {
      const side = perpendicular(axis, null, A.at).multiplyScalar(0.34);
      twoTone(side, 0.2);
      twoTone(side.clone().multiplyScalar(-1), 0.2);
    } else if (order === 1.5) {
      twoTone(new THREE.Vector3(), 0.28);
      twoTone(perpendicular(axis, ring, mid).multiplyScalar(0.72), 0.12);
    } else {
      twoTone(new THREE.Vector3(), 0.28);
    }
  }

  // Lone pairs. They carry no atom, but they are why water is bent and ammonia a pyramid: a pale
  // solid lobe, because translucent ones would be one more transparent mesh to explain nothing.
  const lobes = [];
  if (kind === 'water') lobes.push(new THREE.Vector3(0, -0.54, 0.84), new THREE.Vector3(0, -0.54, -0.84));
  if (kind === 'ammonia') lobes.push(new THREE.Vector3(0, 1, 0));
  for (const dir of lobes) {
    const g = new THREE.SphereGeometry(1, 22, 16);
    g.scale(0.82, 1.65, 0.82);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
    const at = raw[0].at.clone().addScaledVector(dir, 3.1);
    g.translate(at.x, at.y, at.z);
    parts.push({ geometry: g, color: 0xcbb8ea });
  }

  // The angle the placard names, drawn between the first two bonds that carry one.
  if (data.angle && data.angle < 180) {
    const O = raw[0].at;
    const u = raw[1].at.clone().sub(O).normalize();
    const v = raw[2].at.clone().sub(O).normalize();
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      points.push(O.clone().addScaledVector(u.clone().multiplyScalar(1 - t).addScaledVector(v, t).normalize(), 3));
    }
    const arc = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 28, 0.09, 8, false);
    parts.push({ geometry: arc, color: 0xf1c232 });
    put(parts, new THREE.SphereGeometry(0.13, 10, 8), 0xf1c232, points[0].toArray());
    put(parts, new THREE.SphereGeometry(0.13, 10, 8), 0xf1c232, points[24].toArray());
  }

  // The stand meets the molecule low down and near the axis. Taken to the atom nearest the axis
  // alone, it ran straight up through caffeine's rings to the oxygen at the top.
  let anchor = raw[0];
  let best = Infinity;
  for (const atom of raw) {
    const d = Math.hypot(atom.at.x, atom.at.z) + atom.at.y * 0.6 + (atom.element === 'H' ? 3 : 0);
    if (d < best) { best = d; anchor = atom; }
  }
  stick(parts, [anchor.at.x, 0.6, anchor.at.z], anchor.at.toArray(), 0.2, 0x444a54);
  put(parts, lathed([[0, 0], [3.4, 0], [3.4, 0.35], [2.9, 0.6], [0.5, 0.75], [0, 0.75]], { segments: 40 }), 0x2d323b, [anchor.at.x, 0, anchor.at.z]);

  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.32, metalness: 0.04 }));
  return group(m);
}

// ---------------------------------------------------------------------------
// The salt crystal
// ---------------------------------------------------------------------------

// HALF PACKED AND HALF OPEN, for the reason Fantastic Voyage's organs are half whole and half
// sectioned: a crystal teaches two things that cannot both be seen at once. The packed half has the
// ions touching at their true sizes, which is what is really there. The open half has the same
// positions with the ions shrunk, so the pattern can be seen and a student can walk through it. The
// guide lines are only in the open half and the placard says what they are not: bonds.
export function saltCrystal() {
  const { spacing, ionsPerEdge: n, openRadiusFraction } = SALT;
  const naR = SALT.naRadius * SALT_SCALE;
  const clR = SALT.clRadius * SALT_SCALE;
  const NA = 0x8f5bd6;
  const CL = 0x45b56b;
  const middle = (n - 1) / 2;
  const base = clR + 0.1;
  const at = (i, j, k) => [(i - middle) * spacing, base + j * spacing, (k - middle) * spacing];
  const split = n / 2;

  const parts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const isNa = (i + j + k) % 2 === 0;
        const packed = i < split;
        const radius = (isNa ? naR : clR) * (packed ? 1 : openRadiusFraction);
        const detail = packed ? 22 : 14;
        put(parts, new THREE.SphereGeometry(radius, detail, Math.round(detail * 0.65)), isNa ? NA : CL, at(i, j, k));
        if (packed) continue;
        // Each open ion joins the next one along every axis, and back to the packed half.
        if (i + 1 < n) stick(parts, at(i, j, k), at(i + 1, j, k), 0.09, 0xb9c0c9, 8);
        stick(parts, at(i, j, k), at(i - 1, j, k), 0.09, 0xb9c0c9, 8);
        if (j + 1 < n) stick(parts, at(i, j, k), at(i, j + 1, k), 0.09, 0xb9c0c9, 8);
        if (k + 1 < n) stick(parts, at(i, j, k), at(i, j, k + 1), 0.09, 0xb9c0c9, 8);
      }
    }
  }
  const crystal = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.3, metalness: 0.03 }));
  return group(crystal);
}

// ---------------------------------------------------------------------------
// The states-of-matter tank
// ---------------------------------------------------------------------------

// Everything but the particles: they are separate objects, each running its own program. The whole
// tank is click-through, or the glass would stand between a student and every particle in it.
export function tank() {
  const { width, height, depth, floorY } = TANK;
  const parts = [];
  block(parts, width + 1.6, floorY - 0.15, depth + 1.6, 0x2c3440, [0, (floorY - 0.15) / 2, 0]);
  block(parts, width + 0.3, 0.15, depth + 0.3, 0x4c5563, [0, floorY - 0.075, 0]);
  const top = floorY + height;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      block(parts, 0.3, height + 0.3, 0.3, 0x9aa3af, [sx * (width / 2 + 0.05), floorY + height / 2, sz * (depth / 2 + 0.05)]);
    }
    block(parts, 0.3, 0.3, depth + 0.3, 0x9aa3af, [sx * (width / 2 + 0.05), top + 0.05, 0]);
    block(parts, 0.3, 0.3, depth + 0.3, 0x9aa3af, [sx * (width / 2 + 0.05), floorY + 0.05, 0]);
  }
  for (const sz of [-1, 1]) {
    block(parts, width + 0.3, 0.3, 0.3, 0x9aa3af, [0, top + 0.05, sz * (depth / 2 + 0.05)]);
    block(parts, width + 0.3, 0.3, 0.3, 0x9aa3af, [0, floorY + 0.05, sz * (depth / 2 + 0.05)]);
  }
  const frame = solid(parts);

  const glass = mesh(
    new THREE.BoxGeometry(width, height, depth),
    standard({ color: 0xcfe6f5, transparent: true, opacity: 0.1, roughness: 0.08, metalness: 0, depthWrite: false }),
  );
  glass.position.y = floorY + height / 2;
  glass.castShadow = false;
  glass.receiveShadow = false;
  return scenery(group(frame, glass));
}

// One particle. Its origin is its centre: it is placed in mid-air and never stands on anything.
// It never changes colour, because a particle of water is the same particle in ice and in steam.
export function particle({ color = 0x3d97e0 } = {}) {
  const m = mesh(
    new THREE.SphereGeometry(TANK.particleRadius, 18, 12),
    standard({ color, roughness: 0.3, metalness: 0.02 }),
  );
  m.castShadow = false;
  return group(m);
}

export function thermostat() {
  const parts = [];
  put(parts, lathed([[0, 0], [1.3, 0], [1.3, 0.3], [0.5, 0.5], [0.4, 3.1], [0, 3.1]], { segments: 28 }), 0x2d323b);
  block(parts, 3.6, 2.4, 0.5, 0x2d323b, [0, 4, 0]);
  const plate = printedBoard(3.3, 2.1, 0.1, (ctx, w, h) => {
    ctx.fillStyle = '#151a22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = AH.tank;
    ctx.fillRect(0, 0, w, h * 0.06);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'THERMOSTAT', 800, Math.round(h * 0.2), SANS, w * 0.9);
    ctx.fillText('THERMOSTAT', w / 2, h * 0.32);
    ctx.fillStyle = '#ffcf8a';
    fitText(ctx, 'Click me, press Program', 700, Math.round(h * 0.13), SANS, w * 0.9);
    ctx.fillText('Click me, press Program', w / 2, h * 0.58);
    ctx.fillText('and change temperature', w / 2, h * 0.76);
  }, { pixelsPerFoot: 110 });
  plate.position.set(0, 4, 0.3);
  return group(solid(parts), plate);
}

// The thermometer's board and bulb. The red column is a separate object, because that is the one
// carrying the program, so the board is click-through to it. It stands left of centre, or a hot
// reading covers the labels saying where water melts and boils.
export const THERMOMETER_COLUMN_X = -0.95;
export function thermometerFrame() {
  const { full, topKelvin } = GAUGE;
  const parts = [];
  for (const sx of [-1, 1]) {
    block(parts, 0.3, full + 3, 0.3, 0x363b47, [sx * 2.2, (full + 3) / 2, -0.3]);
  }
  const board = printedBoard(4, full + 1, 0.2, (ctx, w, h) => {
    ctx.fillStyle = '#f5f1e6';
    ctx.fillRect(0, 0, w, h);
    const yOf = (kelvin) => h - (kelvin / topKelvin) * (full / (full + 1)) * h;
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= topKelvin; k += 50) {
      const major = k % 100 === 0;
      ctx.fillStyle = '#20242a';
      ctx.fillRect(w * 0.08, yOf(k) - (major ? 2 : 1), major ? w * 0.4 : w * 0.3, major ? 4 : 2);
      if (major) {
        ctx.textAlign = 'right';
        ctx.font = `800 ${Math.round(w * 0.11)}px ${SANS}`;
        ctx.fillText(`${k} K`, w * 0.96, yOf(k));
      }
    }
    const mark = (kelvin, text, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(w * 0.08, yOf(kelvin) - 3, w * 0.86, 6);
      ctx.textAlign = 'right';
      ctx.font = `700 ${Math.round(w * 0.085)}px ${SANS}`;
      ctx.fillText(text, w * 0.96, yOf(kelvin) - w * 0.07);
    };
    mark(273, 'Water melts', '#2f6fd6');
    mark(373, 'Water boils', '#d6453a');
  }, { pixelsPerFoot: 48 });
  board.position.set(0, (full + 1) / 2, 0);
  put(parts, new THREE.SphereGeometry(0.9, 20, 14), 0xd03a2c, [THERMOMETER_COLUMN_X, 0.8, 0.45]);
  return scenery(group(solid(parts), board));
}

// The column: it stands in the ground and the program raises it to the temperature. The top is the
// reading, so its origin is at its base and it starts sunk by its whole height.
export function thermometerColumn() {
  const parts = [];
  block(parts, 0.8, GAUGE.full, 0.5, 0xd03a2c, [0, GAUGE.full / 2, 0]);
  return group(solid(parts));
}

// Ships with no program at all: writing one is the last challenge.
export function burner() {
  const parts = [];
  block(parts, 3.4, 1.4, 3.4, 0x2d323b, [0, 0.7, 0]);
  for (const r of [0.55, 1.0, 1.45]) {
    const coil = new THREE.TorusGeometry(r, 0.11, 10, 28);
    coil.rotateX(Math.PI / 2);
    put(parts, coil, 0xe0601f, [0, 1.46, 0]);
  }
  return group(solid(parts));
}

export { RADIUS_PM_PER_FOOT, EN_FEET_PER_UNIT };
