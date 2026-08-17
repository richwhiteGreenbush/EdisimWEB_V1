import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergedMesh,
  canvasTexture,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Space Station Survival" -- a construction deck in low Mars orbit.
//
// COLOUR IS THE BRIEF, and in a world made of white hardware against a black sky that has
// to be worked at rather than assumed. Three things carry it:
//
//   1. MARS ITSELF, filling a third of the view. It is the only large warm thing here and
//      everything else is judged against it.
//   2. The `station` theme's hemisphere fill is warm ORANGE-BROWN rather than sky blue,
//      because the light bouncing onto this hardware is planetshine off a red planet. That
//      one number is what stops the white modules looking like a shop display.
//   3. Every module carries a COLOUR-CODED band -- and that is not decoration, it is how a
//      real station is laid out: the colour tells you what a module is for before you can
//      read the stencil on it. Bays are marked in the same colours on the deck.
//
// Hardware here is deliberately NOT shiny. metalness sits at 0.35-0.45 throughout because
// there is no environment map anywhere in this app, and metalness up near 0.9 renders
// BLACK -- the trap every chrome bumper in CityProps fell into. Real spacecraft are mostly
// matte white blanket and foil anyway.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const HULL = 0xdfe3e8;          // white thermal blanket
const HULL_SHADE = 0xb4bac2;
const HULL_DARK = 0x6e757e;
const TRUSS = 0x9aa2ab;
const GOLD_FOIL = 0xd9a648;     // MLI foil -- the one genuinely gold thing on a spacecraft
const SOLAR_BLUE = 0x2b4f8a;
const SOLAR_CELL = 0x3f6fb0;
const RADIATOR = 0xeef1f4;
const GLASS_DARK = 0x1b2733;

// Module colour codes. Used on the module bands AND on the deck bay markings, which is
// what makes the deck readable as a plan rather than as painted stripes.
export const BAY_COLORS = {
  habitat: 0x3f8fd9,
  lab: 0x4fbf7a,
  power: 0xf2b134,
  store: 0xe0553f,
  dock: 0x9a6fd9,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ball(radius, detail = 12) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A ring of bolts/fittings round a cylinder -- the detail that reads as "engineered" at a
// distance and costs almost nothing.
function boltRing(parts, { radius, y, count = 16, size = 0.12, color = HULL_DARK }) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    parts.push({ geometry: ball(size, 5), position: [Math.cos(a) * radius, y, Math.sin(a) * radius], color });
  }
}

// A hatch: a recessed ring with a wheel. Every pressurised module has several and they are
// most of what makes one read as something people go inside.
function hatch(parts, { x, y, z, radius, rotY = 0, color = HULL_SHADE }) {
  const ring = new THREE.TorusGeometry(radius, radius * 0.16, 8, 20);
  ring.rotateY(rotY + Math.PI / 2);
  ring.translate(x, y, z);
  parts.push({ geometry: ring, color });
  const plate = new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 0.25, 18);
  plate.rotateZ(Math.PI / 2);
  plate.rotateY(rotY);
  plate.translate(x, y, z);
  parts.push({ geometry: plate, color: HULL_DARK });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.12, radius * 0.9, 0.12);
    spoke.rotateX(a);
    spoke.rotateZ(Math.PI / 2);
    spoke.rotateY(rotY);
    spoke.translate(x, y, z);
    parts.push({ geometry: spoke, color: 0xc8ced6 });
  }
}

// ---------------------------------------------------------------------------
// 1. Pressurised modules
// ---------------------------------------------------------------------------

// The workhorse: a cylinder with end cones, ribs, hatches, a colour band and a gold-foil
// section. `bay` picks the colour code.
export function stationModule({
  length = 34,
  radius = 6,
  bay = 'habitat',
  windows = true,
  seed = 3,
} = {}) {
  const g = group();
  const parts = [];
  const glass = [];
  const foil = [];
  const band = BAY_COLORS[bay] ?? BAY_COLORS.habitat;
  const barrel = length - radius * 1.6;

  // The module lies along its own +Z, so a layout aims it with an ordinary rotY.
  const shell = new THREE.CylinderGeometry(radius, radius, barrel, 28);
  shell.rotateX(Math.PI / 2);
  shell.translate(0, radius, 0);
  parts.push({ geometry: shell, color: HULL });

  // End cones.
  for (const sz of [1, -1]) {
    const cap = new THREE.ConeGeometry(radius, radius * 0.8, 28);
    cap.rotateX(sz * Math.PI / 2);
    cap.translate(0, radius, sz * (barrel / 2 + radius * 0.4));
    parts.push({ geometry: cap, color: HULL_SHADE });
    // Docking collar on each end.
    const collar = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, radius * 0.3, 18);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, radius, sz * (barrel / 2 + radius * 0.85));
    parts.push({ geometry: collar, color: HULL_DARK });
  }

  // Ribs along the barrel.
  const RIBS = Math.max(3, Math.round(barrel / 6));
  for (let i = 0; i <= RIBS; i++) {
    const z = -barrel / 2 + (i / RIBS) * barrel;
    const rib = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.55, 28);
    rib.rotateX(Math.PI / 2);
    rib.translate(0, radius, z);
    parts.push({ geometry: rib, color: HULL_SHADE });
  }

  // THE COLOUR BAND -- a wide painted stripe round the middle of the module, plus a thinner
  // one near one end so the module has a direction as well as an identity.
  const bandRing = new THREE.CylinderGeometry(radius * 1.03, radius * 1.03, radius * 0.7, 28);
  bandRing.rotateX(Math.PI / 2);
  bandRing.translate(0, radius, -barrel * 0.18);
  parts.push({ geometry: bandRing, color: band });
  const stripe = new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, radius * 0.16, 28);
  stripe.rotateX(Math.PI / 2);
  stripe.translate(0, radius, barrel * 0.34);
  parts.push({ geometry: stripe, color: band });

  // A gold-foil-wrapped section -- the one strongly warm thing on the hardware, and what
  // stops a white cylinder reading as a drainpipe.
  const wrap = new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, barrel * 0.16, 28);
  wrap.rotateX(Math.PI / 2);
  wrap.translate(0, radius, barrel * 0.06);
  foil.push({ geometry: wrap, color: GOLD_FOIL });

  boltRing(parts, { radius: radius * 1.06, y: radius, count: 20, size: 0.13 });

  // Hatches on both flanks.
  for (const sx of [-1, 1]) {
    hatch(parts, { x: sx * radius, y: radius, z: -barrel * 0.3, radius: radius * 0.3, rotY: sx > 0 ? 0 : Math.PI });
  }

  // Windows: a row of small round ports. Dark and slightly lit from inside.
  if (windows) {
    for (let i = 0; i < 5; i++) {
      const z = -barrel * 0.28 + i * barrel * 0.15;
      for (const sx of [-1, 1]) {
        const port = new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, 0.3, 14);
        port.rotateZ(Math.PI / 2);
        port.translate(sx * radius * 0.99, radius + radius * 0.35, z);
        glass.push({ geometry: port, color: 0x8fd0f0 });
        const rim = new THREE.TorusGeometry(radius * 0.17, radius * 0.035, 6, 16);
        rim.rotateY(Math.PI / 2);
        rim.translate(sx * radius * 1.0, radius + radius * 0.35, z);
        parts.push({ geometry: rim, color: HULL_DARK });
      }
    }
  }

  // Handrails -- every external surface of a real station is covered in them, and they are
  // the detail that most says "people work on the outside of this".
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -barrel * 0.34 + i * barrel * 0.22;
      const rail = new THREE.BoxGeometry(0.16, 0.16, barrel * 0.16);
      rail.translate(sx * radius * 1.06, radius - radius * 0.45, z);
      parts.push({ geometry: rail, color: 0xf0d24a });
    }
  }

  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.72, metalness: 0.35,
    ...relief('metal', { seed, repeat: 5, strength: 0.45 }),
  }));
  g.add(mergedMesh(foil, { color: 0xffffff, roughness: 0.28, metalness: 0.55 }));
  g.add(mergedMesh(glass, {
    color: 0xffffff, roughness: 0.15, metalness: 0.2,
    emissive: 0x7fc4e8, emissiveIntensity: 0.6,
  }));
  return g;
}

// The cupola: the seven-window observation dome, and the best thing on the real station.
// Built at higher detail than anything else here because it is the model a student walks
// up to and looks into.
export function stationCupola({ radius = 7, seed = 9 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];

  // Base ring the dome sits on.
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 1.05, radius * 1.15, radius * 0.4, 24), position: [0, radius * 0.2, 0], color: HULL_SHADE });
  boltRing(parts, { radius: radius * 1.1, y: radius * 0.4, count: 24, size: 0.14 });

  // The drum: six trapezoidal side windows in a ring of mullions.
  //
  // THE SOLID WALL IS THE PART THAT MAKES IT A CUPOLA. Built as mullions with panes hung
  // between them and nothing behind, the six dark panes ARE the drum -- it came out as a
  // blue box on a white pedestal, which is a shipping container, not a window module. A
  // cupola is a white pressure vessel that happens to have windows in it, so the wall goes
  // in first and the glass sits proud of it, narrower and shorter than its bay.
  const drumH = radius * 0.85;
  const drumY = radius * 0.4 + drumH / 2;
  const SIDES = 6;
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 0.9, radius * 0.98, drumH, SIDES * 4), position: [0, drumY, 0], color: HULL });
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    const next = ((i + 1) / SIDES) * Math.PI * 2;
    // Mullion between panes.
    const mull = new THREE.BoxGeometry(0.5, drumH * 1.12, 0.9);
    mull.rotateY(-a);
    mull.translate(Math.cos(a) * radius * 0.94, drumY, Math.sin(a) * radius * 0.94);
    parts.push({ geometry: mull, color: HULL_SHADE });
    // Pane, set slightly in.
    const mid = (a + next) / 2;
    const pane = new THREE.BoxGeometry(radius * 0.56, drumH * 0.58, 0.3);
    pane.rotateY(-mid + Math.PI / 2);
    pane.translate(Math.cos(mid) * radius * 0.95, drumY + drumH * 0.04, Math.sin(mid) * radius * 0.95);
    glass.push({ geometry: pane, color: GLASS_DARK });
    // Shutter hinge above each pane -- the cupola's windows have covers, and the hinges
    // are the giveaway detail.
    const hinge = new THREE.BoxGeometry(radius * 0.64, 0.3, 0.5);
    hinge.rotateY(-mid + Math.PI / 2);
    hinge.translate(Math.cos(mid) * radius * 1.0, drumY + drumH * 0.42, Math.sin(mid) * radius * 1.0);
    parts.push({ geometry: hinge, color: HULL_DARK });
  }

  // Top ring + the big round centre window.
  const topY = radius * 0.4 + drumH;
  parts.push({ geometry: new THREE.TorusGeometry(radius * 0.86, radius * 0.1, 8, 26), position: [0, topY, 0], color: HULL_SHADE, rotation: [Math.PI / 2, 0, 0] });
  const domeGlass = new THREE.SphereGeometry(radius * 0.78, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGlass.scale(1, 0.5, 1);
  domeGlass.translate(0, topY, 0);
  glass.push({ geometry: domeGlass, color: GLASS_DARK });
  // Radial mullions across the top window.
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    const bar = new THREE.BoxGeometry(radius * 0.86, 0.26, 0.26);
    bar.rotateY(-a);
    bar.translate(Math.cos(a) * radius * 0.43, topY + radius * 0.2, Math.sin(a) * radius * 0.43);
    parts.push({ geometry: bar, color: HULL_SHADE });
  }
  parts.push({ geometry: ball(radius * 0.16, 12), position: [0, topY + radius * 0.42, 0], color: HULL_SHADE });

  // Handrails round the outside.
  for (let i = 0; i < SIDES; i++) {
    const a = ((i + 0.5) / SIDES) * Math.PI * 2;
    const rail = new THREE.BoxGeometry(radius * 0.5, 0.15, 0.15);
    rail.rotateY(-a + Math.PI / 2);
    rail.translate(Math.cos(a) * radius * 1.08, radius * 0.55, Math.sin(a) * radius * 1.08);
    parts.push({ geometry: rail, color: 0xf0d24a });
  }

  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.68, metalness: 0.4,
    ...relief('metal', { seed, repeat: 4, strength: 0.45 }),
  }));
  g.add(mergedMesh(glass, {
    color: 0xffffff, roughness: 0.08, metalness: 0.3,
    emissive: 0x3f6f9a, emissiveIntensity: 0.35,
  }));
  return g;
}

// A docking node: a short sphere-ish hub with ports on every face. This is what makes a
// collection of cylinders read as a STATION rather than as parts on a shelf.
export function dockingNode({ radius = 7, seed = 15 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];

  const hub = ball(radius, 20);
  hub.scale(1, 0.92, 1);
  hub.translate(0, radius, 0);
  parts.push({ geometry: hub, color: HULL });

  // Six ports: four round the equator, one up. Each is a collar with a target ring.
  const PORTS = [
    [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0],
  ];
  for (const [dx, dy, dz] of PORTS) {
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    const collar = new THREE.CylinderGeometry(radius * 0.4, radius * 0.44, radius * 0.5, 18);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    collar.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const at = dir.clone().multiplyScalar(radius * 1.02);
    collar.translate(at.x, radius + at.y, at.z);
    parts.push({ geometry: collar, color: HULL_DARK });

    const target = new THREE.TorusGeometry(radius * 0.3, radius * 0.06, 6, 18);
    target.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir),
    ));
    const at2 = dir.clone().multiplyScalar(radius * 1.28);
    target.translate(at2.x, radius + at2.y, at2.z);
    parts.push({ geometry: target, color: BAY_COLORS.dock });
  }

  // A ring of windows round the equator.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const port = new THREE.CylinderGeometry(radius * 0.11, radius * 0.11, 0.3, 12);
    port.rotateZ(Math.PI / 2);
    port.rotateY(-a);
    port.translate(Math.cos(a) * radius * 0.99, radius + radius * 0.3, Math.sin(a) * radius * 0.99);
    glass.push({ geometry: port, color: 0x8fd0f0 });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.7, metalness: 0.38, ...relief('metal', { seed, repeat: 4, strength: 0.45 }) }));
  g.add(mergedMesh(glass, { color: 0xffffff, roughness: 0.15, emissive: 0x7fc4e8, emissiveIntensity: 0.6 }));
  return g;
}

// ---------------------------------------------------------------------------
// 2. Power and structure
// ---------------------------------------------------------------------------

// A solar array wing: a gimbal, a mast, and two blankets of blue cells. The blue is the
// second-biggest block of colour in the world after Mars.
export function solarArray({ span = 40, width = 11, seed = 21 } = {}) {
  const g = group();
  const parts = [];
  const cells = [];
  const mastH = 7;

  parts.push({ geometry: new THREE.CylinderGeometry(1.5, 1.9, mastH * 0.4, 14), position: [0, mastH * 0.2, 0], color: HULL_DARK });
  parts.push({ geometry: new THREE.CylinderGeometry(0.8, 0.8, mastH, 12), position: [0, mastH * 0.5 + mastH * 0.2, 0], color: TRUSS });
  boltRing(parts, { radius: 1.6, y: mastH * 0.4, count: 12, size: 0.12 });

  const wingY = mastH + 1.6;
  for (const sx of [-1, 1]) {
    // The blanket itself, panelled into cells rather than one blue slab -- the grid is
    // what makes it read as photovoltaic.
    const COLS = 10;
    const ROWS = 3;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cw = (span / 2 - 3) / COLS;
        const ch = width / ROWS;
        const cell = new THREE.BoxGeometry(cw * 0.92, 0.25, ch * 0.9);
        cell.translate(
          sx * (3 + (c + 0.5) * cw),
          wingY,
          -width / 2 + (r + 0.5) * ch,
        );
        cells.push({ geometry: cell, color: (c + r) % 2 ? SOLAR_BLUE : SOLAR_CELL });
      }
    }
    // Spine and end batten.
    parts.push({ geometry: new THREE.BoxGeometry(span / 2 - 2, 0.5, 0.7), position: [sx * (span / 4 + 1), wingY - 0.3, 0], color: TRUSS });
    parts.push({ geometry: new THREE.BoxGeometry(0.6, 0.7, width * 1.02), position: [sx * (span / 2 - 0.3), wingY, 0], color: TRUSS });
    parts.push({ geometry: new THREE.BoxGeometry(0.6, 0.7, width * 1.02), position: [sx * 3, wingY, 0], color: TRUSS });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.6, metalness: 0.45, ...relief('metal', { seed, repeat: 4, strength: 0.4 }) }));
  // The cells get their own material: low roughness and a hint of emissive so they catch
  // the light as a plane rather than disappearing into the black sky edge-on.
  g.add(mergedMesh(cells, {
    color: 0xffffff, roughness: 0.22, metalness: 0.4,
    emissive: 0x102844, emissiveIntensity: 0.4,
  }));
  return g;
}

// A radiator: white panels edge-on to the sun. Deliberately the coldest white in the world,
// against the warm planetshine.
export function radiatorPanel({ span = 26, width = 9, panels = 3, seed = 27 } = {}) {
  const g = group();
  const parts = [];
  const mastH = 5;
  parts.push({ geometry: new THREE.CylinderGeometry(0.7, 1.0, mastH, 12), position: [0, mastH / 2, 0], color: TRUSS });
  for (let p = 0; p < panels; p++) {
    const y = mastH + 0.8 + p * 1.6;
    parts.push({ geometry: new THREE.BoxGeometry(span, 0.3, width), position: [0, y, 0], color: RADIATOR });
    // Flow tubes across each panel.
    for (let i = 0; i < 7; i++) {
      parts.push({
        geometry: new THREE.BoxGeometry(span * 0.98, 0.12, 0.18),
        position: [0, y + 0.2, -width / 2 + (i + 0.5) * (width / 7)],
        color: HULL_SHADE,
      });
    }
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.5, metalness: 0.3, ...relief('metal', { seed, repeat: 5, strength: 0.35 }) }));
  return g;
}

// A truss bay: the open lattice spine everything else bolts to.
export function trussSegment({ length = 30, size = 6, bays = 5, seed = 33 } = {}) {
  const g = group();
  const parts = [];
  const h = size;
  const corners = [[-1, 0], [1, 0], [1, 1], [-1, 1]];

  // Four longerons.
  for (const [cx, cy] of corners) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.5, 0.5, length),
      position: [cx * size / 2, cy * h + h * 0.15, 0],
      color: TRUSS,
    });
  }
  // Battens and diagonals per bay.
  for (let b = 0; b <= bays; b++) {
    const z = -length / 2 + (b / bays) * length;
    parts.push({ geometry: new THREE.BoxGeometry(size, 0.4, 0.4), position: [0, h * 0.15, z], color: TRUSS });
    parts.push({ geometry: new THREE.BoxGeometry(size, 0.4, 0.4), position: [0, h + h * 0.15, z], color: TRUSS });
    for (const sx of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(0.4, h, 0.4), position: [sx * size / 2, h * 0.65, z], color: TRUSS });
    }
    if (b < bays) {
      const seg = length / bays;
      for (const sx of [-1, 1]) {
        const d = new THREE.BoxGeometry(0.35, Math.hypot(h, seg), 0.35);
        d.rotateX(Math.atan2(seg, h) * (b % 2 ? 1 : -1));
        d.translate(sx * size / 2, h * 0.65, z + seg / 2);
        parts.push({ geometry: d, color: TRUSS });
      }
    }
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.62, metalness: 0.45, ...relief('metal', { seed, repeat: 4, strength: 0.4 }) }));
  return g;
}

// The robotic arm: seven joints, a latching end effector, and a colour-coded elbow. Posed
// rather than animated -- its joints turn about several different axes and `rotate` only
// drives the vertical one, so animating it would move the whole arm like a signpost.
export function roboticArm({ reach = 34, seed = 39 } = {}) {
  const g = group();
  const parts = [];

  const joint = (at, r, color = 0xf2b134) => {
    parts.push({ geometry: ball(r, 12), position: at, color });
  };
  const boom = (from, to, r, color = HULL) => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const seg = new THREE.CylinderGeometry(r, r, dir.length(), 14);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    seg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    seg.translate(mid.x, mid.y, mid.z);
    parts.push({ geometry: seg, color });
  };

  // A latching base, then shoulder -> elbow -> wrist, folded the way a stowed arm sits.
  parts.push({ geometry: new THREE.CylinderGeometry(2.4, 2.8, 1.6, 16), position: [0, 0.8, 0], color: HULL_DARK });
  const shoulder = [0, 3.2, 0];
  const elbow = [reach * 0.34, reach * 0.42, reach * 0.1];
  const wrist = [reach * 0.62, reach * 0.2, reach * 0.3];
  const tip = [reach * 0.72, reach * 0.06, reach * 0.46];

  joint(shoulder, 1.7);
  boom(shoulder, elbow, 1.1);
  joint(elbow, 1.6);
  boom(elbow, wrist, 1.0);
  joint(wrist, 1.35);
  boom(wrist, tip, 0.8);

  // End effector: a snare ring with three jaws.
  parts.push({ geometry: new THREE.CylinderGeometry(1.2, 1.0, 1.6, 12), position: tip, color: HULL_SHADE });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const jaw = new THREE.BoxGeometry(0.25, 1.4, 0.25);
    jaw.rotateZ(0.35);
    jaw.rotateY(a);
    jaw.translate(tip[0] + Math.cos(a) * 0.9, tip[1] - 0.9, tip[2] + Math.sin(a) * 0.9);
    parts.push({ geometry: jaw, color: 0xf2b134 });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.62, metalness: 0.42, ...relief('metal', { seed, repeat: 4, strength: 0.4 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// 3. Deck and cargo
// ---------------------------------------------------------------------------

// The construction deck: the grated platform the student stands on, with colour-coded bays
// painted on it. The bay markings are the reason this is one texture rather than plain
// plating -- they are how the world tells a student where each build challenge goes.
export function stationDeck({ width = 150, depth = 150, seed = 45 } = {}) {
  const g = group();
  const texture = canvasTexture(1024, 1024, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#454b53';
    ctx.fillRect(0, 0, w, h);

    // Plating: big panels with a slightly varied tone and visible seams.
    const N = 8;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = randomIn(rng, -10, 10) | 0;
        ctx.fillStyle = `rgb(${78 + v},${84 + v},${92 + v})`;
        ctx.fillRect(c * (w / N) + 3, r * (h / N) + 3, w / N - 6, h / N - 6);
      }
    }
    // Anti-skid speckle.
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = `rgba(200,208,216,${randomIn(rng, 0.03, 0.13).toFixed(3)})`;
      ctx.fillRect(randomIn(rng, 0, w), randomIn(rng, 0, h), 2, 2);
    }

    // Hazard border round the whole deck.
    const stripeW = 34;
    for (let i = 0; i < w / stripeW + 8; i++) {
      ctx.save();
      ctx.translate(i * stripeW, 0);
      ctx.rotate(0.5);
      ctx.fillStyle = i % 2 ? '#f2b134' : '#22262b';
      ctx.fillRect(-stripeW, -20, stripeW, 46);
      ctx.fillRect(-stripeW, h - 26, stripeW, 46);
      ctx.restore();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);

  const m = mesh(new THREE.PlaneGeometry(width, depth), standard({
    color: 0xffffff, map: texture, roughness: 0.82, metalness: 0.3,
    ...relief('metal', { seed, repeat: 10, strength: 0.5 }),
  }), 0, 0.06, 0);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  m.castShadow = false;
  g.add(m);
  return g;
}

// A painted bay marking: a coloured outline square on the deck with a number. This is what
// each build challenge points at -- "build it in bay 3" only means something if bay 3 is
// somewhere you can stand.
export function deckBay({ size = 20, bay = 'habitat', number = 1, seed = 51 } = {}) {
  const g = group();
  const color = BAY_COLORS[bay] ?? BAY_COLORS.habitat;
  const hex = '#' + color.toString(16).padStart(6, '0');
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = hex;
    ctx.lineWidth = 26;
    ctx.setLineDash([70, 34]);
    ctx.strokeRect(30, 30, w - 60, h - 60);
    ctx.setLineDash([]);
    // Corner brackets, solid.
    ctx.lineWidth = 20;
    const L = 110;
    for (const [cx, cy, sx, sy] of [[30, 30, 1, 1], [w - 30, 30, -1, 1], [30, h - 30, 1, -1], [w - 30, h - 30, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * L, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * L);
      ctx.stroke();
    }
    ctx.fillStyle = hex;
    ctx.font = `bold ${Math.round(w * 0.34)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.55;
    ctx.fillText(String(number), w / 2, h / 2);
  });

  const m = mesh(new THREE.PlaneGeometry(size, size), standard({
    map: texture, color: 0xffffff, transparent: true, roughness: 0.85,
    emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.3,
  }), 0, 0.14, 0);
  m.rotation.x = -Math.PI / 2;
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);
  void seed;
  return g;
}

// A cargo pod: a colour-coded box with foil, stencils and grapple fixtures. Several of
// these scattered on the deck are most of the world's non-Mars colour.
export function cargoPod({ size = 7, bay = 'store', seed = 57 } = {}) {
  const g = group();
  const parts = [];
  const foil = [];
  const color = BAY_COLORS[bay] ?? BAY_COLORS.store;

  parts.push({ geometry: new THREE.BoxGeometry(size, size * 0.85, size * 1.3), position: [0, size * 0.425, 0], color: HULL });
  // Colour band round the middle and a foil-wrapped top.
  parts.push({ geometry: new THREE.BoxGeometry(size * 1.02, size * 0.2, size * 1.32), position: [0, size * 0.5, 0], color });
  foil.push({ geometry: new THREE.BoxGeometry(size * 0.96, size * 0.1, size * 1.26), position: [0, size * 0.86, 0], color: GOLD_FOIL });
  // Ribs.
  for (let i = 0; i < 3; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(size * 1.03, size * 0.06, size * 0.1),
      position: [0, size * (0.16 + i * 0.24), 0],
      color: HULL_SHADE,
    });
  }
  // Grapple fixture on top and corner fittings.
  parts.push({ geometry: new THREE.CylinderGeometry(size * 0.1, size * 0.13, size * 0.16, 10), position: [0, size * 0.94, 0], color: 0xf2b134 });
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push({
      geometry: new THREE.BoxGeometry(size * 0.14, size * 0.14, size * 0.14),
      position: [dx * size * 0.44, size * 0.07, dz * size * 0.6],
      color: HULL_DARK,
    });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.7, metalness: 0.35, ...relief('metal', { seed, repeat: 4, strength: 0.45 }) }));
  g.add(mergedMesh(foil, { color: 0xffffff, roughness: 0.3, metalness: 0.55 }));
  return g;
}

// An EVA suit on a stand -- the one human-scale object out here, and the thing that tells a
// student how big everything else is.
export function evaSuit({ height = 7.2, seed = 63 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];
  const s = height / 7.2;

  // Stand.
  parts.push({ geometry: new THREE.CylinderGeometry(1.5 * s, 1.8 * s, 0.3 * s, 14), position: [0, 0.15 * s, 0], color: HULL_DARK });
  parts.push({ geometry: new THREE.CylinderGeometry(0.25 * s, 0.25 * s, 1.6 * s, 8), position: [0, 0.9 * s, 0], color: TRUSS });

  // Torso -- the hard upper torso is a distinctly boxy barrel, not a cylinder.
  const torso = ball(1.5 * s, 14);
  torso.scale(0.9, 1.0, 0.78);
  torso.translate(0, 3.6 * s, 0);
  parts.push({ geometry: torso, color: HULL });
  // Life-support backpack.
  parts.push({ geometry: new THREE.BoxGeometry(2.3 * s, 2.4 * s, 1.0 * s), position: [0, 3.7 * s, -1.4 * s], color: HULL_SHADE });
  // Legs.
  for (const sx of [-1, 1]) {
    const leg = new THREE.CylinderGeometry(0.5 * s, 0.42 * s, 2.2 * s, 10);
    leg.translate(sx * 0.6 * s, 1.6 * s, 0);
    parts.push({ geometry: leg, color: HULL });
    const boot = ball(0.55 * s, 8);
    boot.scale(1, 0.6, 1.5);
    boot.translate(sx * 0.6 * s, 0.6 * s, 0.3 * s);
    parts.push({ geometry: boot, color: HULL_SHADE });
  }
  // Arms, held out slightly.
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.42 * s, 0.36 * s, 2.4 * s, 10);
    arm.rotateZ(sx * 0.34);
    arm.translate(sx * 1.7 * s, 3.5 * s, 0);
    parts.push({ geometry: arm, color: HULL });
    parts.push({ geometry: ball(0.42 * s, 8), position: [sx * 2.2 * s, 2.4 * s, 0], color: 0xf2b134 });
  }
  // HELMET + GOLD VISOR, and the visor is the whole difference between a spacesuit and a
  // snowman. Two things about it are easy to get wrong and were both wrong here:
  //
  //  - A partial SphereGeometry's phi is measured from -X, not from +Z. Authored around
  //    phi = 0 the visor sat on the suit's LEFT EAR, so every suit in the world presented a
  //    blank white ball to anyone walking up to it. It has to be centred on phi = PI/2.
  //  - It has to be BIGGER than the helmet it covers. At a hair under the helmet radius it
  //    is sealed inside the shell and invisible from every angle -- the same mistake as
  //    putting a window on the inner face of a wall.
  parts.push({ geometry: ball(1.05 * s, 16), position: [0, 5.5 * s, 0], color: HULL });
  const visor = new THREE.SphereGeometry(1.09 * s, 20, 14, Math.PI / 2 - 1.0, 2.0, 0.45, 1.35);
  visor.translate(0, 5.5 * s, 0);
  glass.push({ geometry: visor, color: GOLD_FOIL });
  // Neck ring and helmet light -- the two details that say the helmet comes off.
  parts.push({ geometry: new THREE.TorusGeometry(0.82 * s, 0.14 * s, 8, 20), position: [0, 4.66 * s, 0], rotation: [Math.PI / 2, 0, 0], color: HULL_SHADE });
  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.16 * s, 0.16 * s, 0.4 * s, 8), position: [sx * 0.95 * s, 6.1 * s, 0.3 * s], rotation: [Math.PI / 2, 0, 0], color: 0xf2b134 });
  }

  // Chest control module and coloured ID bands. This world is led by colour and a suit is
  // the one object in it at human scale, so it carries the crew colours rather than being
  // one more white shape among the white hardware.
  parts.push({ geometry: new THREE.BoxGeometry(1.3 * s, 0.8 * s, 0.35 * s), position: [0, 3.5 * s, 1.15 * s], color: HULL_SHADE });
  parts.push({ geometry: new THREE.BoxGeometry(0.9 * s, 0.34 * s, 0.1 * s), position: [0, 3.6 * s, 1.34 * s], color: 0x3f8fd9 });
  for (const sx of [-1, 1]) {
    const band = new THREE.CylinderGeometry(0.45 * s, 0.42 * s, 0.34 * s, 10);
    band.rotateZ(sx * 0.34);
    band.translate(sx * 2.0 * s, 2.86 * s, 0);
    parts.push({ geometry: band, color: 0xe0553f });
  }
  // The red commander stripes on one leg.
  parts.push({ geometry: new THREE.CylinderGeometry(0.52 * s, 0.52 * s, 0.3 * s, 10), position: [-0.6 * s, 2.4 * s, 0], color: 0xe0553f });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.78, metalness: 0.2, ...relief('weave', { seed, repeat: 6, strength: 0.5 }) }));
  g.add(mergedMesh(glass, { color: 0xffffff, roughness: 0.12, metalness: 0.75, emissive: 0x5a3d10, emissiveIntensity: 0.4 }));
  return g;
}

// A high-gain antenna dish on a mount.
export function antennaDish({ radius = 7, seed = 69 } = {}) {
  const g = group();
  const parts = [];
  const mastH = 8;
  parts.push({ geometry: new THREE.CylinderGeometry(1.0, 1.4, mastH, 12), position: [0, mastH / 2, 0], color: TRUSS });
  parts.push({ geometry: ball(1.5, 12), position: [0, mastH, 0], color: HULL_DARK });

  // THE BOWL HAS TO OPEN TOWARD THE WALK-UP, and getting that wrong is the single most
  // repeated modelling mistake in this project -- MarsProps' relay dish made it once and
  // this made it again. A dish tipped the other way shows its convex back, and a smooth
  // white convex back 14ft across is an EGG on a post. It is not a lighting problem and no
  // choice of colour rescues it.
  //
  // Two mechanical traps behind that. `BufferGeometry.rotateX` turns about the geometry's
  // ORIGIN, not about the part, so the cap has to be seated with its vertex already at the
  // origin before it is tipped -- which is what the translate by `sphereR` is for, since a
  // cap is authored around its sphere's pole. And the sweep has to stay shallow: much past
  // 60 degrees the profile becomes a hemisphere and reads as a ball whichever way it points.
  const sweep = Math.PI * 0.28;
  const tilt = 0.85;
  const sphereR = radius / Math.sin(sweep);
  const depth = sphereR * (1 - Math.cos(sweep));
  const axis = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
  const vertex = new THREE.Vector3(0, mastH + 1.5, 0);

  const dish = new THREE.SphereGeometry(sphereR, 30, 15, 0, Math.PI * 2, Math.PI - sweep, sweep);
  dish.translate(0, sphereR, 0);
  dish.rotateX(tilt);
  dish.translate(vertex.x, vertex.y, vertex.z);
  parts.push({ geometry: dish, color: RADIATOR });

  // A rim hoop, which is most of what stops the bowl reading as a plain curved sheet.
  const hoop = new THREE.TorusGeometry(radius, 0.16, 6, 40);
  hoop.rotateX(Math.PI / 2);
  hoop.translate(0, depth, 0);
  hoop.rotateX(tilt);
  hoop.translate(vertex.x, vertex.y, vertex.z);
  parts.push({ geometry: hoop, color: 0xc8ced6 });

  // Feed horn out at the focus, on three struts back to the rim.
  const focus = vertex.clone().add(axis.clone().multiplyScalar(radius * 0.72));
  const horn = new THREE.CylinderGeometry(0.32, 0.5, 1.3, 10);
  const toAxis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  horn.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(toAxis));
  horn.translate(focus.x, focus.y, focus.z);
  parts.push({ geometry: horn, color: HULL_DARK });

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const from = new THREE.Vector3(Math.cos(a) * radius * 0.88, depth, Math.sin(a) * radius * 0.88)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt).add(vertex);
    const dir = focus.clone().sub(from);
    const strut = new THREE.CylinderGeometry(0.11, 0.11, dir.length(), 6);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    strut.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const mid = from.clone().add(focus).multiplyScalar(0.5);
    strut.translate(mid.x, mid.y, mid.z);
    parts.push({ geometry: strut, color: 0xc8ced6 });
  }

  // DoubleSide, and it is the dish that needs it. Turning the bowl to face the walk-up means
  // the surface a student sees is its INSIDE, and the inside of a south cap is its back
  // faces -- culled. Pointed the wrong way it rendered as a solid egg; pointed the right way
  // it rendered as a hoop with three spokes and no dish at all. It is the same rule as a
  // cutaway shell, arrived at from the opposite direction.
  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.6, metalness: 0.42, side: THREE.DoubleSide,
    ...relief('metal', { seed, repeat: 4, strength: 0.4 }),
  }));
  return g;
}

// ---------------------------------------------------------------------------
// 4. Mars
// ---------------------------------------------------------------------------

// The planet, as an enormous sphere sitting mostly BELOW the deck.
//
// This is the animated object in the world: it turns about its own vertical, which is what
// `rotate` drives, and a planet turning slowly under a station is both accurate and the
// single most arresting thing here.
//
// It is placed with `absoluteY` and a large negative y by the layout, so only its upper cap
// is above the deck -- which is what makes it read as a world you are ORBITING rather than
// as a ball parked next to you.
export function marsGlobe({ radius = 150, seed = 75 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  // The surface is a canvas rather than geometry: at this radius the visible curvature is
  // gentle and every feature that matters -- the dark volcanic provinces, the polar cap,
  // the great canyon -- is a MARKING, not a shape.
  //
  // EVERY FEATURE IS A SOFT FILL AND NONE OF THEM IS AN OUTLINE. The first pass drew craters
  // and shield volcanoes as pale stroked circles, which is how a crater is drawn on a
  // diagram and is nothing like how one looks from orbit -- at 340ft of radius they came out
  // as a screenful of soap bubbles floating on the planet. A crater seen from space is a
  // patch of slightly different DUST, so these are filled discs at very low alpha with a
  // brighter half-rim only on the sunward side, and only on the largest few.
  const texture = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#b0592f';
    ctx.fillRect(0, 0, w, h);

    // Soft-edged blob, the one primitive everything below is built from. A radial gradient
    // fading to fully transparent is what keeps a feature from having an edge the eye can
    // catch and read as an object sitting on top of the planet.
    const blob = (x, y, rx, ry, color, alpha, rot = 0) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(1, ry / rx);
      const grad = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
      grad.addColorStop(0, color);
      grad.addColorStop(0.62, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // The dark albedo provinces -- Syrtis Major, Acidalia, Mare Erythraeum. These are the
    // markings that make a red ball recognisable as Mars, so they are placed, not scattered,
    // and they are BIG: the real ones are continent-sized.
    const provinces = [
      [0.63, 0.40, 0.115, 0.20], [0.68, 0.52, 0.07, 0.11],
      [0.26, 0.20, 0.14, 0.11], [0.47, 0.34, 0.08, 0.07],
      [0.82, 0.62, 0.12, 0.12], [0.05, 0.58, 0.10, 0.10],
      [0.50, 0.70, 0.13, 0.09],
    ];
    // Each province is FOUR overlapping blobs, not one. A single soft-edged ellipse is still
    // an ellipse -- it reads as a coin lying on the planet however soft its edge is. Piling
    // a few off-centre copies of different sizes on top of one another is what gives an
    // albedo feature a ragged coastline, which is the whole of what makes it look painted on
    // by geology rather than by a drawing program.
    for (const [px, py, prx, pry] of provinces) {
      const rot = randomIn(rng, 0, Math.PI);
      blob(w * px, h * py, w * prx, h * pry, '#7d3c22', 0.5, rot);
      for (let k = 0; k < 3; k++) {
        blob(w * px + randomIn(rng, -w * prx * 0.7, w * prx * 0.7),
          h * py + randomIn(rng, -h * pry * 0.6, h * pry * 0.6),
          w * prx * randomIn(rng, 0.4, 0.8), h * pry * randomIn(rng, 0.4, 0.8),
          k === 1 ? '#6a3019' : '#7d3c22', randomIn(rng, 0.28, 0.45), randomIn(rng, 0, Math.PI));
      }
    }

    // Pale dust plains between them.
    for (let i = 0; i < 40; i++) {
      blob(randomIn(rng, 0, w), randomIn(rng, h * 0.12, h * 0.88),
        randomIn(rng, w * 0.03, w * 0.09), randomIn(rng, h * 0.04, h * 0.11),
        i % 2 ? '#c98a5c' : '#9c4d28', randomIn(rng, 0.1, 0.24), randomIn(rng, 0, Math.PI));
    }

    // Valles Marineris: a long dark gash a fifth of the way round the planet. It is the one
    // feature a person can name, so it is drawn deliberately rather than left to noise. Two
    // passes -- a wide soft shadow and a narrow dark floor -- because a single stroke of
    // uniform width reads as a drawn line rather than as a canyon.
    // KEEP IT FAINT. Drawn at the width and contrast the feature deserves on a map, it came
    // out as a dark arc across the middle of the face -- and a dark arc under two dark
    // patches is a smile under two eyes. A planet that reads as a face is a worse mistake
    // than a planet with no canyon on it, so this is a thin scar you notice second.
    for (const [width, color, alpha] of [[0.030, '#8a4526', 0.34], [0.011, '#5e2c16', 0.42]]) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = h * width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.22, h * 0.60);
      ctx.bezierCurveTo(w * 0.31, h * 0.545, w * 0.40, h * 0.575, w * 0.49, h * 0.535);
      ctx.stroke();
      ctx.restore();
    }

    // The Tharsis shield volcanoes: pale domes with a dark summit caldera, no rings.
    for (const [vx, vy, vr] of [[0.14, 0.44, 0.055], [0.10, 0.51, 0.042], [0.18, 0.53, 0.042], [0.065, 0.395, 0.034]]) {
      blob(w * vx, h * vy, h * vr * 1.7, h * vr * 1.7, '#cd8f5e', 0.4);
      blob(w * vx, h * vy, h * vr * 0.38, h * vr * 0.38, '#5c2a14', 0.55);
    }

    // Craters, and NOT ONE OF THEM GETS A BRIGHT RIM. A rim is what a crater has when you
    // are near it; from orbit it is a patch of slightly different dust, and a pale ring --
    // or a pale crescent offset inside a dark disc, which was the second attempt -- turns a
    // planet into a sheet of soap bubbles at any radius this globe is ever drawn at. They
    // are dark, they are faint, and they are wider than they are tall so they never quite
    // read as circles.
    for (let i = 0; i < 300; i++) {
      const r = randomIn(rng, 2, h * 0.024);
      blob(randomIn(rng, 0, w), randomIn(rng, h * 0.08, h * 0.92),
        r * randomIn(rng, 1.0, 1.5), r, '#8a4223', randomIn(rng, 0.08, 0.18),
        randomIn(rng, 0, Math.PI));
    }

    // Polar caps. Ragged rather than a clean band -- a straight-edged white stripe across
    // the top of a sphere reads as a hat, and the cap is the single easiest thing to get
    // wrong here because the north pole sits almost exactly at the top of the visible disc.
    for (const north of [true, false]) {
      const edge = north ? h * 0.10 : h * 0.925;
      const dir = north ? 1 : -1;
      ctx.save();
      ctx.fillStyle = 'rgba(238,235,228,0.92)';
      ctx.beginPath();
      ctx.moveTo(0, north ? 0 : h);
      ctx.lineTo(w, north ? 0 : h);
      for (let x = w; x >= 0; x -= w / 48) {
        const wob = Math.sin(x / w * 11) * h * 0.014 + Math.sin(x / w * 27) * h * 0.008;
        ctx.lineTo(x, edge + wob * dir);
      }
      ctx.closePath();
      ctx.fill();
      // A frosted fringe below the hard edge.
      ctx.globalAlpha = 0.3;
      ctx.fillRect(0, north ? edge : edge - h * 0.045, w, h * 0.045);
      ctx.restore();
    }

    // A FINE GRAIN OVER THE WHOLE DISC, and it is not decoration. Everything above is soft
    // gradients, so the planet is one huge smooth ramp -- which is the worst possible input
    // to a JPEG, and the gallery screenshot came back with broad vertical bands across it
    // that are not in the render at all. A pixel of noise gives the encoder something to
    // quantise against, and it reads as dust at the same time.
    {
      const grain = ctx.getImageData(0, 0, w, h);
      const px = grain.data;
      for (let i = 0; i < px.length; i += 4) {
        const n = (rng() - 0.5) * 11;
        px[i] += n; px[i + 1] += n * 0.85; px[i + 2] += n * 0.7;
      }
      ctx.putImageData(grain, 0, 0);
    }

    // Dust storms: two pale swirls, not a band across the equator.
    for (const [sx, sy, sr] of [[0.36, 0.66, 0.13], [0.88, 0.34, 0.10]]) {
      blob(w * sx, h * sy, w * sr, h * sr * 1.5, '#e8c8a8', 0.22);
    }
  });

  const globe = mesh(new THREE.SphereGeometry(radius, 64, 40), standard({
    map: texture,
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    // A little self-illumination so the limb does not go pure black: a planet lit only by
    // one hard sun with no fill has a terminator you cannot see anything past, and this
    // world's job is to have Mars filling the view.
    emissive: 0x2a0f06,
    emissiveIntensity: 0.5,
  }), 0, 0, 0);
  // AXIAL TILT, and it is what makes the polar cap exist as far as a student is concerned.
  // Upright, the north pole sits exactly on the top limb of the disc, so the cap paints a
  // sliver one or two pixels deep and the planet has no cap at all. Mars is really tilted
  // 25 degrees; tipping it toward the deck brings the whole cap onto the face.
  //
  // The spin this world puts on the globe is a `rotate` block, which turns the ROOT about
  // the world's vertical -- so a tilted child precesses rather than spinning on its own
  // axis. At the rate this turns (0.08 degrees written, halved by `forever`'s own yield to
  // 0.04 a frame) one full circuit takes over two minutes, and nobody watching a planet turn
  // is measuring its pole against the stars. The cap is worth far more than the pedantry.
  globe.rotation.x = 0.44;
  globe.rotation.z = 0;
  globe.castShadow = false;
  globe.receiveShadow = false;
  g.add(globe);
  return g;
}

// A small supply crate for scattering -- deck clutter that makes the place look worked in.
export function supplyCrate({ size = 3.4, bay = 'lab', seed = 81 } = {}) {
  const g = group();
  const parts = [];
  const color = BAY_COLORS[bay] ?? BAY_COLORS.lab;
  parts.push({ geometry: new THREE.BoxGeometry(size, size * 0.8, size), position: [0, size * 0.4, 0], color: HULL_SHADE });
  parts.push({ geometry: new THREE.BoxGeometry(size * 1.02, size * 0.14, size * 1.02), position: [0, size * 0.62, 0], color });
  parts.push({ geometry: new THREE.BoxGeometry(size * 0.92, size * 0.08, size * 0.92), position: [0, size * 0.82, 0], color: HULL_DARK });
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.72, metalness: 0.32, ...relief('metal', { seed, repeat: 3, strength: 0.45 }) }));
  return g;
}
