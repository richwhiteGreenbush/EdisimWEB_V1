import * as THREE from 'three';
import { standard, mesh, group, canvasTexture, seededRandom, randomIn } from '../PropKit.js';
import { extrudeOutline, roundedOutline, revolve, ball, mergeParts, put } from './LoftKit.js';
import { COASTER } from './MidwayModel.js';

// Newton's Midway -- an amusement park where every ride is a working physics model. Six stations,
// each running in block code, on a fairground lit by a bright afternoon.
//
// THE SCALE IS 1 WORLD FOOT = 1 METRE, so the student is a five-metre giant and a 40 m cannon shot
// fits in one view. Every board says so. Sizes here are therefore in the lab's metres.
//
// House rules: feet at scale 1, origin at base centre (the moving parts that pivot deliberately
// keep their origin at the pivot, because that is what `set tilt` turns about), fresh materials per
// call, seededRandom never Math.random. See PropKit.js and LoftKit.js.

export const MW = {
  drop: '#d6453a',
  cannon: '#e08a1e',
  track: '#2f9e5b',
  coaster: '#2f6fd6',
  bumper: '#a24ccf',
  swing: '#d0397f',
};

const COL = {
  red: 0xc9352c,
  redDark: 0x8e241e,
  yellow: 0xe8b52c,
  blue: 0x2b5fb8,
  blueDark: 0x1d3f7c,
  green: 0x2f9e5b,
  cream: 0xeee3c8,
  steel: 0x8b9199,
  steelDark: 0x4c525b,
  rubber: 0x24262b,
  wood: 0x8a6239,
  bore: 0x15161a,
  brass: 0xb8913f,
};

const paint = (extra = {}) => standard({ vertexColors: true, roughness: 0.55, metalness: 0.08, ...extra });
const solid = (parts, extra) => mesh(mergeParts(parts), paint(extra));

// `revolve` winds by the profile's direction, and a profile written bottom-up comes out inside out.
const lathed = (profile, opts) => revolve([...profile].reverse(), opts);

// A lathe profile that does not start and end ON THE AXIS is an open tube.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

const UP = new THREE.Vector3(0, 1, 0);

// A closed round bar between two points, with a ball at each end so joints have no open ring. The
// matrix is baked into the geometry, since a merged part only carries one Euler.
function strut(parts, a, b, radius, color, sides = 10, { balls = true } = {}) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const span = to.clone().sub(from);
  const length = span.length();
  const g = new THREE.CylinderGeometry(radius, radius, length, sides);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, span.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  parts.push({ geometry: g, color });
  if (balls) {
    put(parts, ball(radius * 1.15, sides), color, a);
    put(parts, ball(radius * 1.15, sides), color, b);
  }
}

const block = (parts, w, h, d, color, at) => put(parts, new THREE.BoxGeometry(w, h, d), color, at);

// A rounded slab lying flat, for a seat, a body or a footplate. Plan in x/z, thickness up.
function slab(parts, halfX, halfZ, radius, thick, y, color, at = [0, 0]) {
  const g = extrudeOutline(roundedOutline(halfX, halfZ, radius, 4), thick);
  g.rotateX(-Math.PI / 2);
  g.translate(at[0], y + thick / 2, at[1]);
  parts.push({ geometry: g, color });
}

// Words or numbers on a solid plate: the plate is a box so it has a back from behind, and the print
// sits a hair proud of its face.
function printedPlate(w, h, thick, draw, { pixelsPerFoot = 64, emissive = 0.28, frame = COL.steelDark } = {}) {
  const parts = [];
  block(parts, w + 0.16, h + 0.16, thick, frame, [0, 0, 0]);
  const texture = canvasTexture(Math.round(w * pixelsPerFoot), Math.round(h * pixelsPerFoot), draw);
  const face = mesh(
    new THREE.PlaneGeometry(w, h),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: emissive, roughness: 0.8 }),
  );
  face.position.z = thick / 2 + 0.01;
  return group(solid(parts), face);
}

function fitText(ctx, text, weight, size, family, room) {
  ctx.font = `${weight} ${size}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width <= room) return size;
  const fitted = Math.floor(size * room / width);
  ctx.font = `${weight} ${fitted}px ${family}`;
  return fitted;
}

// ---------------------------------------------------------------------------
// The measuring walls
// ---------------------------------------------------------------------------

// A wall ruled in metres, which is what turns a ride into a measurement. Its origin is the ZERO
// mark. `reverse` runs the numbers to the viewer's left, for a track seen from its other side.
export function rulerWall({ length = 60, step = 5, height = 5, reverse = false, accent = '#e08a1e', label = 'metres' } = {}) {
  const dir = reverse ? -1 : 1;
  const parts = [];
  const posts = Math.round(length / 10);
  for (let i = 0; i <= posts; i++) {
    strut(parts, [dir * i * 10, 0, -0.22], [dir * i * 10, height + 0.1, -0.22], 0.14, COL.steelDark, 8);
  }
  block(parts, length + 0.6, height, 0.16, COL.cream, [dir * length / 2, height / 2, -0.12]);

  const texture = canvasTexture(4096, Math.round(4096 * height / length), (ctx, w, h) => {
    ctx.fillStyle = '#f6efdc';
    ctx.fillRect(0, 0, w, h);
    const px = w / length;
    const at = (metres) => (reverse ? w - metres * px : metres * px);
    for (let m = 0; m <= length; m += 1) {
      const major = m % step === 0;
      ctx.fillStyle = major ? '#20242a' : '#7c8087';
      const tick = major ? h * 0.3 : h * 0.1;
      ctx.fillRect(Math.min(w - 6, Math.max(0, at(m) - (major ? 3 : 1))), h - tick, major ? 6 : 2, tick);
      if (major) {
        ctx.fillStyle = accent;
        ctx.font = `800 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
        ctx.textAlign = m === 0 ? (reverse ? 'right' : 'left') : 'center';
        ctx.fillText(String(m), at(m), h * 0.52);
      }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5a5f66';
    ctx.font = `600 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
    ctx.fillText(`${label} (1 foot of this world = 1 metre)`, reverse ? 12 : w * 0.45, h * 0.17);
  });
  const face = mesh(
    new THREE.PlaneGeometry(length, height),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.22, roughness: 0.85 }),
  );
  face.position.set(dir * length / 2, height / 2, -0.03);
  return group(solid(parts), face);
}

// ---------------------------------------------------------------------------
// Station 1: the drop tower
// ---------------------------------------------------------------------------

export function dropTower({ height = 32 } = {}) {
  const parts = [];
  const half = 2.6;
  const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
  for (const [x, z] of corners) strut(parts, [x, 0, z], [x, height, z], 0.32, COL.red, 12);
  // Lattice bracing: two diagonals on each face per bay, the look of a real steel tower.
  const bay = 4;
  for (let y = 0; y + bay <= height; y += bay) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      strut(parts, [ax, y, az], [bx, y + bay, bz], 0.09, COL.cream, 6, { balls: false });
      strut(parts, [bx, y, bz], [ax, y + bay, az], 0.09, COL.cream, 6, { balls: false });
      strut(parts, [ax, y + bay, az], [bx, y + bay, bz], 0.12, COL.red, 6, { balls: false });
    }
  }
  // Guide rails down the front, which the car rides on.
  for (const x of [-1.5, 1.5]) {
    strut(parts, [x, 0, half + 0.5], [x, height, half + 0.5], 0.16, COL.steel, 10);
    for (let y = 2; y < height; y += 4) strut(parts, [x, y, half], [x, y, half + 0.5], 0.1, COL.steelDark, 6, { balls: false });
  }
  // The crown and the footing.
  put(parts, lathed(closed([[4.2, 0], [4.2, 0.5], [3.6, 0.9]]), { segments: 28 }), COL.steelDark);
  put(parts, lathed(closed([[3.2, height - 0.4], [4.6, height + 0.4], [4.6, height + 1.3], [2.6, height + 2.2], [1, height + 3.2]]), { segments: 32 }), COL.red);
  strut(parts, [0, height + 3.1, 0], [0, height + 5.6, 0], 0.1, COL.steelDark, 8);
  put(parts, ball(0.32, 12), COL.yellow, [0, height + 5.8, 0]);

  // A height scale up the front, so the number in the program can be read off the tower.
  const scale = printedPlate(0.9, height, 0.1, (ctx, w, h) => {
    ctx.fillStyle = '#f6efdc';
    ctx.fillRect(0, 0, w, h);
    const px = h / height;
    for (let m = 0; m <= height; m += 1) {
      const major = m % 5 === 0;
      ctx.fillStyle = major ? '#20242a' : '#80848b';
      ctx.fillRect(0, h - m * px - (major ? 2 : 1), major ? w * 0.42 : w * 0.2, major ? 4 : 2);
      if (major && m > 0) {
        ctx.fillStyle = '#b3241c';
        ctx.font = '800 30px system-ui, sans-serif';
        ctx.fillText(String(m), w * 0.47, h - m * px + 11);
      }
    }
  }, { pixelsPerFoot: 64, emissive: 0.25 });
  scale.position.set(half + 0.4, height / 2, half + 0.1);

  return group(solid(parts), scale);
}

export function dropCar() {
  const parts = [];
  // A bench carried on the rails: floor, back, seats and lap bars, one solid piece of colour.
  slab(parts, 2.9, 1.0, 0.35, 0.3, 0, COL.yellow, [0, 0.6]);
  slab(parts, 2.9, 0.2, 0.15, 3.1, 0.3, COL.blue, [0, -0.25]);
  for (const x of [-1.9, 0, 1.9]) {
    slab(parts, 0.72, 0.62, 0.2, 0.5, 0.3, COL.red, [x, 0.5]);
    block(parts, 1.3, 1.7, 0.3, COL.red, [x, 1.55, 0.0]);
    strut(parts, [x - 0.55, 1.5, 0.45], [x - 0.55, 1.5, 1.05], 0.09, COL.steel, 8);
    strut(parts, [x + 0.55, 1.5, 0.45], [x + 0.55, 1.5, 1.05], 0.09, COL.steel, 8);
    strut(parts, [x - 0.55, 1.5, 1.05], [x + 0.55, 1.5, 1.05], 0.09, COL.steel, 8);
  }
  // The shoes that ride the rails, sunk into the back of the bench.
  for (const x of [-1.5, 1.5]) block(parts, 0.7, 2.2, 0.8, COL.steelDark, [x, 1.5, -0.65]);
  return group(solid(parts));
}

// A ball on a bracket, 10 m up, with no program on it: activity 1's blank page.
export function dropPost({ height = 10 } = {}) {
  const parts = [];
  strut(parts, [0, 0, -1.2], [0, height, -1.2], 0.2, COL.steelDark, 10);
  strut(parts, [0, height, -1.2], [0, height, -0.3], 0.12, COL.steelDark, 8);
  put(parts, lathed(closed([[1.1, 0], [1.1, 0.25], [0.3, 0.45]]), { segments: 20 }), COL.steel, [0, 0, -1.2]);
  return group(solid(parts));
}

// ---------------------------------------------------------------------------
// Station 2: the cannon
// ---------------------------------------------------------------------------

export const CANNON_PIVOT_Y = 3;
export const DECK_Y = 2.1;

function spokedWheel(parts, x, z, radius) {
  const rim = new THREE.TorusGeometry(radius, 0.13, 8, 26);
  rim.rotateY(Math.PI / 2);
  rim.translate(x, radius, z);
  parts.push({ geometry: rim, color: COL.redDark });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    strut(parts, [x, radius, z], [x, radius + Math.cos(a) * radius, z + Math.sin(a) * radius], 0.06, COL.yellow, 6, { balls: false });
  }
  const hub = new THREE.CylinderGeometry(0.28, 0.28, 0.4, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(x, radius, z);
  parts.push({ geometry: hub, color: COL.steelDark });
}

// Local +X is down-range. The barrel sits on it at the pivot.
export function cannonBase() {
  const parts = [];
  block(parts, 8.2, 0.5, 5.4, COL.blueDark, [-0.6, 0.25, 0]);
  block(parts, 3.2, 2.1, 0.38, COL.red, [0, 1.55, 1.3]);
  block(parts, 3.2, 2.1, 0.38, COL.red, [0, 1.55, -1.3]);
  spokedWheel(parts, 0, 2.05, 1.55);
  spokedWheel(parts, 0, -2.05, 1.55);
  // Axle through the pivot.
  const axle = new THREE.CylinderGeometry(0.2, 0.2, 4.8, 12);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, CANNON_PIVOT_Y, 0);
  parts.push({ geometry: axle, color: COL.steelDark });
  // Fins of carriage down to the deck.
  for (const z of [-1.3, 1.3]) strut(parts, [-3, 0.55, z], [-0.4, 2.2, z], 0.16, COL.redDark, 8);
  return group(solid(parts));
}

// Origin at the pivot, barrel along +X, so `set tilt to angle` raises it by exactly that angle. The
// muzzle is capped with a dark plate, a solid that reads as the bore: the shot appears through it.
export function cannonBarrel({ length = 8 } = {}) {
  const parts = [];
  // The long straight run is sampled every few inches, because the stripes are a per-vertex tint
  // and a tint can only be as sharp as the mesh under it.
  const run = [];
  for (let y = 0; y < length - 1.6; y += 0.2) run.push([0.98 - (y / (length - 1.6)) * 0.12, y]);
  const profile = closed([
    [0.75, -2.0], [1.05, -1.7], [1.1, -1.2], ...run, [0.86, length - 1.6],
    [0.9, length - 1.3], [0.82, length - 1.05], [0.86, length - 0.25], [1.16, length - 0.08], [1.16, length],
  ]);
  const body = lathed(profile, { segments: 28 });
  // A lathe runs up +Y, and a quarter turn about Z lays that along +X.
  body.rotateZ(-Math.PI / 2);
  parts.push({
    geometry: body,
    color: 0xffffff,
    keepColor: true,
    tint: (p, c) => {
      const band = Math.floor((p.x + 2) / 1.6) % 2 === 0;
      c.setHex(band ? COL.red : COL.cream);
      if (p.x > length - 1.4) c.setHex(COL.yellow);
      return [c.r, c.g, c.b];
    },
  });
  // The dark mouth of the bore, a hair proud of the muzzle face.
  const mouth = new THREE.CylinderGeometry(0.92, 0.92, 0.06, 26);
  mouth.rotateZ(-Math.PI / 2);
  mouth.translate(length + 0.03, 0, 0);
  parts.push({ geometry: mouth, color: COL.bore });
  return group(solid(parts));
}

// The shot: a crash-test ball, quartered black and yellow so its flight can be seen. Origin at its
// centre, because that is the point the marker draws and the point the sums are about.
export function testBall({ radius = 0.9, base = COL.yellow } = {}) {
  const parts = [];
  const g = ball(radius, 28, 18);
  parts.push({
    geometry: g,
    color: 0xffffff,
    keepColor: true,
    tint: (p, c) => {
      const quarter = (p.x > 0) === (p.y > 0);
      c.setHex(quarter ? base : COL.rubber);
      return [c.r, c.g, c.b];
    },
  });
  return group(solid(parts));
}

// The long catching deck the shot lands on, at exactly the height of the muzzle pivot less the
// shot's radius, so "landed" in the program and landed in the world are the same moment. Origin at
// the pivot's foot, deck along local +X. `ring` paints the target circle.
export function rangeDeck({ length = 62, width = 11, ring = 30 } = {}) {
  const parts = [];
  block(parts, length, 0.2, width, COL.steelDark, [length / 2, DECK_Y - 0.12, 0]);
  for (let x = 2; x <= length; x += 10) {
    for (const z of [-width / 2 + 0.5, width / 2 - 0.5]) {
      strut(parts, [x, 0, z], [x, DECK_Y - 0.15, z], 0.17, COL.steel, 8);
    }
  }
  const texture = canvasTexture(4096, Math.round(4096 * width / length), (ctx, w, h) => {
    ctx.fillStyle = '#c8533f';
    ctx.fillRect(0, 0, w, h);
    const px = w / length;
    for (let m = 0; m <= length; m += 1) {
      ctx.fillStyle = m % 5 === 0 ? '#ffffff' : 'rgba(255,255,255,0.28)';
      ctx.fillRect(m * px - (m % 5 === 0 ? 3 : 1), 0, m % 5 === 0 ? 6 : 2, h);
    }
    if (ring) {
      ctx.strokeStyle = '#ffe36b';
      ctx.lineWidth = 12;
      for (const r of [3.4, 1.8]) {
        ctx.beginPath();
        ctx.arc(ring * px, h / 2, r * px, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffe36b';
      ctx.beginPath();
      ctx.arc(ring * px, h / 2, 0.45 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const top = mesh(
    new THREE.PlaneGeometry(length, width),
    standard({ map: texture, roughness: 0.8 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(length / 2, DECK_Y - 0.01, 0);
  return group(solid(parts), top);
}

// ---------------------------------------------------------------------------
// Station 3: the test track
// ---------------------------------------------------------------------------

// Local +Z is down the track from the start line. Three lanes, painted, with a finish line at the
// length every program runs to.
export function testTrack({ length = 40, lanes = 3, laneWidth = 8 } = {}) {
  const parts = [];
  const total = lanes * laneWidth;
  block(parts, total + 1, 0.14, length + 12, 0x4a4d52, [0, 0.07, length / 2 + 1]);
  const texture = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#54575d';
    ctx.fillRect(0, 0, w, h);
    const sx = w / (total + 1);
    const sz = h / (length + 12);
    ctx.fillStyle = '#f4f1e6';
    for (let i = 0; i <= lanes; i++) {
      ctx.fillRect(((i * laneWidth) + 0.5) * sx - 3, 0, 6, h);
    }
    // Start at 5ft in, finish at 5 + length. Laid down flat, the canvas's y runs along local +Z.
    const lineAt = (z) => (z + 5) * sz;
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(0, lineAt(0) - 4, w, 8);
    const checks = 40;
    for (let c = 0; c < checks; c++) {
      for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (c + r) % 2 ? '#111317' : '#f4f1e6';
        ctx.fillRect(c * (w / checks), lineAt(length) + r * (w / checks), w / checks, w / checks);
      }
    }
  });
  const top = mesh(new THREE.PlaneGeometry(total + 1, length + 12), standard({ map: texture, roughness: 0.92 }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 0.15, length / 2 + 1);
  return group(solid(parts), top);
}

// A cart with a thruster on the back. The stack of plates says how much it weighs, in the world
// as well as in its program. Faces +Z.
export function testCart({ plates = 1, body = COL.red, mass = 100 } = {}) {
  const parts = [];
  slab(parts, 1.7, 3.0, 0.7, 0.8, 0.75, body);
  slab(parts, 1.35, 1.4, 0.5, 0.7, 1.55, COL.cream, [0, 1.1]);
  for (const x of [-1.8, 1.8]) {
    for (const z of [-1.9, 1.9]) {
      const wheel = new THREE.CylinderGeometry(0.75, 0.75, 0.5, 18);
      wheel.rotateZ(Math.PI / 2);
      wheel.translate(x, 0.75, z);
      parts.push({ geometry: wheel, color: COL.rubber });
    }
  }
  // Mass plates, on the back half.
  for (let i = 0; i < plates; i++) {
    const plate = new THREE.CylinderGeometry(1.15, 1.15, 0.42, 22);
    plate.translate(0, 1.76 + i * 0.46, -1.0);
    parts.push({ geometry: plate, color: i % 2 ? COL.steel : COL.steelDark });
  }
  strut(parts, [0, 1.55, -1.0], [0, 1.9 + plates * 0.46, -1.0], 0.1, COL.steel, 8);
  // The thruster, its bell facing back.
  const bell = lathed(closed([[0.5, 0], [0.62, 0.3], [0.9, 1.1], [0.95, 1.5]]), { segments: 18 });
  bell.rotateX(-Math.PI / 2);
  bell.translate(0, 1.2, -3.0);
  parts.push({ geometry: bell, color: COL.steelDark });

  const tag = printedPlate(2.1, 0.8, 0.1, (ctx, w, h) => {
    ctx.fillStyle = '#20242a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const size = fitText(ctx, `${mass} kg`, '800', 44, 'system-ui, sans-serif', w - 16);
    ctx.fillText(`${mass} kg`, w / 2, h / 2 + size * 0.36);
  });
  // On the side, because that is the view down the side of the track.
  tag.position.set(-1.76, 1.15, 0.0);
  tag.rotation.y = -Math.PI / 2;
  return group(solid(parts), tag);
}

// ---------------------------------------------------------------------------
// Station 4: the coaster
// ---------------------------------------------------------------------------

export const COASTER_TOP = 18;
export const ENERGY_FULL = 20;
const RAIL_BASE = 1;

// One long V of track, seen side on. Local +X and -X are the two slopes, and the slope is the one
// the program uses, so a car and its rails cannot disagree.
export function coasterTrack({ top = COASTER_TOP, slope = COASTER.slope } = {}) {
  const parts = [];
  const tan = Math.tan((slope * Math.PI) / 180);
  const run = top / tan;
  const railY = (x) => RAIL_BASE + Math.abs(x) * tan;
  for (const side of [-1, 1]) {
    for (const z of [-1.1, 1.1]) {
      strut(parts, [0, railY(0), z], [side * run, railY(side * run), z], 0.17, COL.blue, 10);
    }
    // Ties and trestle bents, stepping up the slope.
    for (let x = 3; x <= run; x += 3) {
      const y = railY(x);
      strut(parts, [side * x, y - 0.16, -1.2], [side * x, y - 0.16, 1.2], 0.09, COL.steelDark, 6, { balls: false });
      if (Math.round(x) % 6 === 0) {
        for (const z of [-1.1, 1.1]) {
          strut(parts, [side * x, y - 0.2, z], [side * x, 0, z * 2.2], 0.14, COL.cream, 8);
        }
        strut(parts, [side * x, y * 0.5, -1.65], [side * x, y * 0.5, 1.65], 0.08, COL.cream, 6, { balls: false });
      }
    }
    // A buffer at the very top of each slope.
    block(parts, 0.5, 1.4, 3, COL.red, [side * (run + 0.4), railY(run) + 0.3, 0]);
  }
  strut(parts, [0, RAIL_BASE - 0.15, -1.2], [0, RAIL_BASE - 0.15, 1.2], 0.1, COL.steelDark, 6, { balls: false });
  return group(solid(parts));
}

// A round pod. It has to be: `set tilt` turns an object about the way it faces, so nothing that
// travels along its own forward can pitch to follow a slope, and a sphere has no front to pitch.
// Origin at the bottom of the ball.
export function coasterPod({ radius = 1.5 } = {}) {
  const parts = [];
  const g = ball(radius, 30, 20);
  g.translate(0, radius, 0);
  parts.push({
    geometry: g,
    color: 0xffffff,
    keepColor: true,
    tint: (p, c) => {
      const y = p.y - radius;
      c.setHex(Math.abs(y) < radius * 0.16 ? COL.yellow : (y > 0 ? COL.blue : COL.red));
      return [c.r, c.g, c.b];
    },
  });
  return group(solid(parts));
}

// Local +Z faces the viewer. The bars stand in the ground and rise out of it, so one of these is
// just a tall box that a program raises by what its share of the energy is worth.
export function energyFrame({ full = ENERGY_FULL, columns = ['Height energy', 'Motion energy', 'Heat'] } = {}) {
  const width = 22;
  const parts = [];
  const board = printedPlate(width, full + 2.6, 0.3, (ctx, w, h) => {
    ctx.fillStyle = '#20262f';
    ctx.fillRect(0, 0, w, h);
    const px = h / (full + 2.6);
    const groundY = h;
    // A rule for every 10% of the world's total.
    for (let i = 0; i <= 10; i++) {
      const y = groundY - (i / 10) * full * px;
      ctx.fillStyle = i % 5 === 0 ? '#c4ccd6' : '#59626e';
      ctx.fillRect(0, y - 1, w, i % 5 === 0 ? 3 : 2);
      if (i % 5 === 0) {
        ctx.fillStyle = '#d9e0e8';
        ctx.font = '600 26px system-ui, sans-serif';
        ctx.fillText(`${i * 10}%`, 8, y - 7);
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    columns.forEach((text, i) => {
      const cx = (w / 3) * (i + 0.5);
      const size = fitText(ctx, text, '700', 46, 'system-ui, sans-serif', w / 3 - 14);
      ctx.fillText(text, cx, 2.1 * px * 0.55 + size * 0.36);
    });
  }, { pixelsPerFoot: 50, emissive: 0.34 });
  board.position.set(0, (full + 2.6) / 2, -0.4);
  for (const x of [-width / 2 - 0.3, width / 2 + 0.3]) strut(parts, [x, 0, -0.5], [x, full + 2.6, -0.5], 0.2, COL.steelDark, 8);
  return group(board, solid(parts));
}

// The bar itself, top at its own origin's height + `full`. Laid out at y = -full, so it starts
// entirely underground.
export function energyBar({ full = ENERGY_FULL, color = 0x2b5fb8 } = {}) {
  const parts = [];
  block(parts, 5, full, 0.9, color, [0, full / 2, 0]);
  return group(solid(parts));
}

// ---------------------------------------------------------------------------
// Station 5: the bumper cars
// ---------------------------------------------------------------------------

export function bumperArena({ radius = 26 } = {}) {
  const parts = [];
  put(parts, lathed(closed([[radius + 0.6, 0], [radius + 0.6, 0.35], [radius, 0.42]]), { segments: 64 }), COL.steelDark);
  const rails = 32;
  for (let i = 0; i < rails; i++) {
    const a = (i / rails) * Math.PI * 2;
    const b = ((i + 1) / rails) * Math.PI * 2;
    const r = radius + 0.2;
    strut(parts, [Math.cos(a) * r, 0.35, Math.sin(a) * r], [Math.cos(a) * r, 2.3, Math.sin(a) * r], 0.09, i % 2 ? COL.yellow : COL.red, 6);
    strut(parts, [Math.cos(a) * r, 2.3, Math.sin(a) * r], [Math.cos(b) * r, 2.3, Math.sin(b) * r], 0.11, COL.steel, 6, { balls: false });
    strut(parts, [Math.cos(a) * r, 1.3, Math.sin(a) * r], [Math.cos(b) * r, 1.3, Math.sin(b) * r], 0.08, COL.steel, 6, { balls: false });
  }
  // The line the two cars run along, painted down the middle of the floor.
  const texture = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#464c55';
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) if ((i + j) % 2) ctx.fillRect(i * (w / 26), j * (h / 26), w / 26, h / 26);
    }
    ctx.fillStyle = '#ffe36b';
    ctx.fillRect(w / 2 - 5, 0, 10, h);
  });
  const floor = mesh(new THREE.CircleGeometry(radius, 64), standard({ map: texture, roughness: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.43;
  return group(solid(parts), floor);
}

// Faces +Z. Rubber skirt all the way round, the one thing that says bumper car.
export function bumperCar({ body = COL.red, letter = 'A', mass = 150 } = {}) {
  const parts = [];
  slab(parts, 2.15, 3.15, 1.2, 0.9, 0.35, COL.rubber);
  slab(parts, 1.85, 2.85, 1.05, 0.95, 1.05, body);
  const bonnet = ball(1.65, 22, 12);
  bonnet.scale(1, 0.42, 1.1);
  bonnet.translate(0, 1.95, 1.25);
  parts.push({ geometry: bonnet, color: body });
  block(parts, 2.5, 1.5, 0.5, body, [0, 2.45, -1.65]);
  slab(parts, 1.05, 0.65, 0.3, 0.45, 1.95, COL.blueDark, [0, -0.85]);
  strut(parts, [0, 1.95, 0.75], [0, 2.75, 0.35], 0.07, COL.steelDark, 8);
  const wheel = new THREE.TorusGeometry(0.42, 0.07, 8, 18);
  wheel.rotateX(Math.PI / 2 - 0.5);
  wheel.translate(0, 2.8, 0.3);
  parts.push({ geometry: wheel, color: COL.rubber });
  // The trolley pole.
  strut(parts, [0, 2.8, -2.0], [0, 6.4, -2.0], 0.08, COL.steelDark, 8);
  put(parts, ball(0.2, 10), COL.yellow, [0, 6.5, -2.0]);

  // A name and a mass on both flanks, since the two cars pass the student going opposite ways.
  const flank = (x, yaw) => {
    const tag = printedPlate(2.3, 1.15, 0.12, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#20242a';
      ctx.textAlign = 'center';
      ctx.font = '800 34px system-ui, sans-serif';
      ctx.fillText(letter, w / 2, 32);
      const size = fitText(ctx, `${mass} kg`, '700', 28, 'system-ui, sans-serif', w - 12);
      ctx.fillText(`${mass} kg`, w / 2, 38 + size);
    }, { pixelsPerFoot: 64, emissive: 0.2 });
    tag.position.set(x, 1.95, -0.5);
    tag.rotation.y = yaw;
    return tag;
  };
  return group(solid(parts), flank(-1.92, -Math.PI / 2), flank(1.92, Math.PI / 2));
}

// The object whose program owns the collision's numbers.
export function scoreboard({ title = 'BUMPER CARS', lines = [], accent = '#a24ccf' } = {}) {
  const W = 11;
  const H = 6.6;
  const LIFT = 3.2;
  const parts = [];
  for (const x of [-W / 2 + 0.6, W / 2 - 0.6]) strut(parts, [x, 0, -0.32], [x, LIFT + H, -0.32], 0.2, COL.steelDark, 8);
  const board = printedPlate(W, H, 0.3, (ctx, w, h) => {
    ctx.fillStyle = '#171b22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.2);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const titleSize = fitText(ctx, title, '800', 62, 'system-ui, sans-serif', w - 40);
    ctx.fillText(title, w / 2, h * 0.1 + titleSize * 0.36);
    ctx.textAlign = 'left';
    const room = w - 60;
    const row = (h * 0.76) / Math.max(1, lines.length);
    let size = Math.min(44, row * 0.72);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    const widest = Math.max(1, ...lines.map((t) => ctx.measureText(t).width));
    if (widest > room) size = Math.floor(size * room / widest);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.fillStyle = '#e8edf2';
    lines.forEach((text, i) => ctx.fillText(text, 30, h * 0.24 + row * (i + 0.65)));
  }, { pixelsPerFoot: 64, emissive: 0.34 });
  board.position.set(0, LIFT + H / 2, 0);
  return group(solid(parts), board);
}

// ---------------------------------------------------------------------------
// Station 6: the pendulum and the swing ride
// ---------------------------------------------------------------------------

export const PENDULUM_PIVOT_Y = 17;

// Local +Z faces the viewer; the arm swings in the x/y plane.
export function pendulumFrame({ pivot = PENDULUM_PIVOT_Y } = {}) {
  const parts = [];
  for (const z of [-5, 5]) {
    strut(parts, [0, pivot, z * 0.9], [-5, 0, z], 0.3, COL.green, 12);
    strut(parts, [0, pivot, z * 0.9], [5, 0, z], 0.3, COL.green, 12);
    strut(parts, [-2.6, pivot * 0.48, z * 0.95], [2.6, pivot * 0.48, z * 0.95], 0.14, COL.cream, 8);
  }
  const axle = new THREE.CylinderGeometry(0.28, 0.28, 10, 14);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, pivot, 0);
  parts.push({ geometry: axle, color: COL.steelDark });
  return group(solid(parts));
}

// Origin at the pivot, hanging straight down at tilt 0. A boat on two arms, so it reads as the ride
// from across the midway. `length` is the distance from the pivot to the boat's centre.
export function pendulumArm({ length = 12 } = {}) {
  const parts = [];
  for (const z of [-3.6, 3.6]) strut(parts, [0, 0, z], [0, -length, z * 0.75], 0.18, COL.steel, 10);
  const hub = new THREE.CylinderGeometry(0.45, 0.45, 8, 14);
  hub.rotateX(Math.PI / 2);
  parts.push({ geometry: hub, color: COL.steelDark });
  const hull = ball(1, 36, 18);
  hull.scale(4.2, 1.5, 3.1);
  hull.translate(0, -length, 0);
  parts.push({
    geometry: hull,
    color: 0xffffff,
    keepColor: true,
    tint: (p, c) => {
      const y = p.y + length;
      c.setHex(y > 0.7 ? COL.yellow : (y > 0.2 ? COL.cream : COL.red));
      return [c.r, c.g, c.b];
    },
  });
  block(parts, 6.4, 0.3, 4.2, COL.wood, [0, -length + 1.25, 0]);
  return group(solid(parts));
}

export function swingTower({ height = 18 } = {}) {
  const parts = [];
  put(parts, lathed(closed([[3.1, 0], [3.1, 0.6], [1.7, 1.4], [1.05, 3.5], [0.75, height - 1.4]]), { segments: 28 }), COL.brass);
  for (let y = 4; y < height - 2; y += 3.2) {
    const band = new THREE.TorusGeometry(0.98 - (y / height) * 0.2, 0.09, 8, 20);
    band.rotateX(Math.PI / 2);
    band.translate(0, y, 0);
    parts.push({ geometry: band, color: COL.red });
  }
  return group(solid(parts));
}

// The turning cap on top of the tower. Its program works out the lean and shares it.
export function swingHub({ radius = 5.2 } = {}) {
  const parts = [];
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    const g = new THREE.ConeGeometry(radius, 2.9, 3, 1, false, (i / stripes) * Math.PI * 2, (Math.PI * 2) / stripes);
    g.translate(0, 1.45, 0);
    parts.push({ geometry: g, color: i % 2 ? COL.red : COL.cream });
  }
  put(parts, lathed(closed([[radius * 0.96, -0.5], [radius, 0.05], [radius * 0.98, 0.2]]), { segments: 40 }), COL.yellow);
  strut(parts, [0, 2.8, 0], [0, 4.6, 0], 0.08, COL.steelDark, 8);
  put(parts, ball(0.3, 12), COL.yellow, [0, 4.75, 0]);
  return group(solid(parts));
}

// Origin at the point it hangs from, hanging straight down at tilt 0.
export function swingChair({ length = 14, color = COL.blue } = {}) {
  const parts = [];
  for (const z of [-0.52, 0.52]) strut(parts, [0, 0, z * 0.2], [0, -length + 0.9, z], 0.05, COL.steelDark, 6);
  slab(parts, 0.72, 0.62, 0.25, 0.22, -length + 0.32, color);
  block(parts, 0.22, 1.05, 1.14, color, [-0.58, -length + 0.92, 0]);
  strut(parts, [0.7, -length + 0.85, -0.52], [0.7, -length + 0.85, 0.52], 0.05, COL.steel, 6);
  return group(solid(parts));
}

// ---------------------------------------------------------------------------
// The wheel at the far end of the midway
// ---------------------------------------------------------------------------

export const WHEEL_HUB_Y = 44;

export function ferrisFrame({ hub = WHEEL_HUB_Y } = {}) {
  const parts = [];
  for (const z of [-5, 5]) {
    strut(parts, [0, hub, z], [-15, 0, z * 1.5], 0.65, COL.steelDark, 14);
    strut(parts, [0, hub, z], [15, 0, z * 1.5], 0.65, COL.steelDark, 14);
    strut(parts, [-7.5, hub * 0.5, z * 1.25], [7.5, hub * 0.5, z * 1.25], 0.3, COL.steel, 10);
  }
  const axle = new THREE.CylinderGeometry(0.9, 0.9, 11, 18);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, hub, 0);
  parts.push({ geometry: axle, color: COL.steel });
  return group(solid(parts));
}

// Origin at the hub, turning about +Z. Its cars are spheres for the same reason the coaster pod is:
// a block program turns the wheel as one object, so a hanging car would go upside down.
export function ferrisWheel({ radius = 38, cars = 14 } = {}) {
  const parts = [];
  const hues = [0xd6453a, 0xe8b52c, 0x2f9e5b, 0x2f6fd6, 0xa24ccf, 0xe0702c, 0xd0397f];
  for (const z of [-2.6, 2.6]) {
    const rim = new THREE.TorusGeometry(radius, 0.42, 10, 96);
    rim.translate(0, 0, z);
    parts.push({ geometry: rim, color: COL.red });
    const inner = new THREE.TorusGeometry(radius * 0.72, 0.22, 8, 72);
    inner.translate(0, 0, z);
    parts.push({ geometry: inner, color: COL.cream });
    for (let i = 0; i < cars * 2; i++) {
      const a = (i / (cars * 2)) * Math.PI * 2;
      strut(parts, [0, 0, z * 1.5], [Math.cos(a) * radius, Math.sin(a) * radius, z], 0.13, COL.cream, 6, { balls: false });
    }
  }
  for (let i = 0; i < cars; i++) {
    const a = (i / cars) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    strut(parts, [x, y, -2.6], [x, y, 2.6], 0.2, COL.steelDark, 8, { balls: false });
    const pod = ball(2.5, 22, 14);
    pod.translate(x, y, 0);
    parts.push({ geometry: pod, color: hues[i % hues.length] });
    const band = new THREE.TorusGeometry(2.55, 0.14, 8, 26);
    band.rotateX(Math.PI / 2);
    band.translate(x, y, 0);
    parts.push({ geometry: band, color: COL.cream });
  }
  const hub = new THREE.CylinderGeometry(2.4, 2.4, 7.6, 22);
  hub.rotateX(Math.PI / 2);
  parts.push({ geometry: hub, color: COL.yellow });
  return group(solid(parts));
}

// ---------------------------------------------------------------------------
// The fairground
// ---------------------------------------------------------------------------

// A striped game tent. The stripes are per-wedge colour on the roof, so it is one merged mesh and
// needs no texture.
export function fairTent({ radius = 8, wall = 6, a = 0xd6453a, b = 0xf2e7cd, flag = 0xe8b52c } = {}) {
  const parts = [];
  const stripes = 16;
  for (let i = 0; i < stripes; i++) {
    const start = (i / stripes) * Math.PI * 2;
    const arc = (Math.PI * 2) / stripes;
    const wallPiece = new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, wall, 4, 1, false, start, arc);
    wallPiece.translate(0, wall / 2, 0);
    parts.push({ geometry: wallPiece, color: i % 2 ? b : a });
    const roof = new THREE.ConeGeometry(radius * 1.12, radius * 0.72, 4, 1, false, start, arc);
    roof.translate(0, wall + radius * 0.36, 0);
    parts.push({ geometry: roof, color: i % 2 ? a : b });
  }
  // Fill the inside of the walls and the eave so a tent has no hollow to see into.
  put(parts, new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, wall + 0.1, 24), 0x26262b, [0, wall / 2, 0]);
  put(parts, new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.14, 32), b, [0, wall + 0.02, 0]);
  const top = wall + radius * 0.72;
  strut(parts, [0, top - 0.4, 0], [0, top + 2.4, 0], 0.08, COL.steelDark, 8);
  const pennant = extrudeOutline([[0, 0.55], [0, -0.55], [1.9, 0]], 0.06);
  pennant.translate(0, top + 1.8, 0);
  parts.push({ geometry: pennant, color: flag });
  return group(solid(parts));
}

// Triangular flags on a line between two poles, a long way apart. Each flag a thin closed solid.
export function bunting({ span = 40, height = 13, flags = 26, seed = 3 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const hues = [0xd6453a, 0xe8b52c, 0x2f9e5b, 0x2f6fd6, 0xa24ccf, 0xf2e7cd];
  for (const x of [-span / 2, span / 2]) {
    strut(parts, [x, 0, 0], [x, height + 1.2, 0], 0.17, COL.steelDark, 8);
    put(parts, ball(0.3, 12), COL.yellow, [x, height + 1.4, 0]);
  }
  const sag = height * 0.12;
  const yAt = (t) => height - sag * 4 * t * (1 - t);
  const segs = 24;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    strut(parts, [-span / 2 + t0 * span, yAt(t0), 0], [-span / 2 + t1 * span, yAt(t1), 0], 0.035, COL.steelDark, 5, { balls: false });
  }
  for (let i = 0; i < flags; i++) {
    const t = (i + 0.5) / flags;
    const pennant = extrudeOutline([[-0.5, 0], [0, -1.1], [0.5, 0]], 0.05);
    pennant.translate(-span / 2 + t * span, yAt(t), 0);
    parts.push({ geometry: pennant, color: hues[Math.floor(randomIn(rng, 0, hues.length)) % hues.length] });
  }
  return group(solid(parts));
}

// The midway itself: one long walk down the middle of the world.
export function midwayPath({ width = 40, length = 360 } = {}) {
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#bda87d';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(11);
    for (let i = 0; i < 1500; i++) {
      const shade = randomIn(rng, 0, 1);
      ctx.fillStyle = shade > 0.5 ? 'rgba(255,245,215,0.07)' : 'rgba(80,60,35,0.07)';
      ctx.beginPath();
      ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 1, 5), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(width / 12, length / 12);
  const parts = [];
  block(parts, width, 0.1, length, 0xb7a277, [0, 0.05, 0]);
  const top = mesh(new THREE.PlaneGeometry(width, length), standard({ map: texture, roughness: 0.95 }));
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.11;
  top.castShadow = false;
  const base = solid(parts);
  base.castShadow = false;
  return group(base, top);
}
