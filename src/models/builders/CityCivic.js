// Build a City: the six civic buildings. Fire station, police station, hospital, city hall, public
// library, elementary school.
//
// Each is a real life-size building on the kit's 10ft grid (src/models/town/TownKit.js), origin at
// the base centre, front toward +Z, a foundation running down to y = -0.4. Each is FIVE meshes at
// most (src/models/town/CityCivicKit.js says which), with every window and door built forward of a
// solid wall. Two of them are walked into: the fire station's bays, deep enough to park a 35ft
// engine in, with the crew's kitchen and bunk room behind them; and the library's reading room.
// Their floors are at ground level, because a student walks on the terrain and never on a prop.

import * as THREE from 'three';
import { PALETTE } from '../town/TownKit.js';
import { Kit, GLOW, times, drawUSFlag, drawCityFlag, drawClock, drawBooks } from '../town/CityCivicKit.js';

const CREAM = 0xe6dfcd; // painted block and plaster inside
const DARKSTEEL = 0x55595e;
const BRASS = 0xc9a447;

// ---------------------------------------------------------------------------------------------
// Furniture, shared by the rooms that have it
// ---------------------------------------------------------------------------------------------
function chair(K, x, z, yaw, color = 0x5d6670) {
  K.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z), () => {
    for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) K.box('trim', DARKSTEEL, lx - 0.06, lx + 0.06, 0, 1.5, lz - 0.06, lz + 0.06, { flat: true });
    K.box('trim', color, -0.75, 0.75, 1.5, 1.68, -0.75, 0.75, { flat: true });
    K.box('trim', color, -0.75, 0.75, 1.68, 3.1, -0.78, -0.62, { flat: true });
  });
}

function table(K, x0, x1, z0, z1, top, color = 0x8a6a48, legColor = DARKSTEEL) {
  K.box('trim', color, x0, x1, top - 0.14, top, z0, z1);
  for (const lx of [x0 + 0.35, x1 - 0.35]) for (const lz of [z0 + 0.35, z1 - 0.35]) K.box('trim', legColor, lx - 0.08, lx + 0.08, 0, top - 0.14, lz - 0.08, lz + 0.08, { flat: true });
}

// ---------------------------------------------------------------------------------------------
// FIRE STATION. 40 x 50ft, brick, two 12.5 x 13.5ft bays 38ft deep, a 40ft hose tower.
// ---------------------------------------------------------------------------------------------
function fireStation() {
  const K = new Kit({ seed: 101, wall: 'brick' });
  const BRICK = PALETTE.brickRed; const LIME = PALETTE.limestone; const TRIM = PALETTE.trim;
  const RED = PALETTE.fireRed;
  const DOORS = [[-10.25, 2.25], [5.25, 17.75]];
  const DOOR_H = 13.5; const CEIL = 15.2; const UP = 15.5; const ROOF = 28;

  // --- the apparatus floor and the walls round it ---
  K.box('trim', 0xa9a59c, -18.75, 18.75, -0.4, 0.05, -23.75, 23.75);
  // two leaves: brick outside, painted block inside
  K.box('wall', BRICK, -20, -19.2, -0.4, UP, -25, 15);
  K.box('wall', CREAM, -19.2, -18.75, 0.05, UP, -24.2, 15);
  K.box('wall', BRICK, 19.2, 20, -0.4, UP, -25, 25);
  K.box('wall', CREAM, 18.75, 19.2, 0.05, UP, -24.2, 23.75);
  K.box('wall', BRICK, -19.2, 19.2, -0.4, UP, -25, -24.2);
  K.box('wall', CREAM, -18.75, 18.75, 0.05, UP, -24.2, -23.75);
  // the front: tower, piers and the header over the two bays
  K.box('wall', BRICK, -20, -10.25, -0.4, 38, 15, 25);
  K.box('wall', BRICK, 2.25, 5.25, -0.4, DOOR_H, 23.75, 25);
  K.box('wall', BRICK, 17.75, 19.2, -0.4, DOOR_H, 23.75, 25);
  K.box('wall', BRICK, -10.25, 19.2, DOOR_H, UP, 23.75, 25);
  // the upper storey is solid, and the bays' ceiling is painted under it
  K.box('wall', BRICK, -10.25, 20, UP, ROOF, -25, 25);
  K.box('wall', BRICK, -20, -10.25, UP, ROOF, -25, 15);
  // a ceiling facing away from every light reads black, so it carries a faint glow of its own
  K.glowBox(GLOW.ceiling, -18.75, 18.75, CEIL, UP, -23.75, 23.75);

  // --- the partition at the back of the bays, with a doorway and a pass-through into each room ---
  const PZ0 = -15; const PZ1 = -14.5;
  const holes = [
    { u0: -15.5, u1: -12, y0: 0, y1: 7.4 }, { u0: -9, u1: -2.5, y0: 3.3, y1: 7.0 },
    { u0: 2.5, u1: 9, y0: 3.3, y1: 7.0 }, { u0: 12, u1: 15.5, y0: 0, y1: 7.4 },
  ];
  K.wallWithHoles('wall', CREAM, -18.75, 18.75, 0.05, CEIL, PZ0, PZ1, holes);
  for (const h of holes) {
    // a painted frame round each opening, both faces, and a sill on the pass-throughs
    for (const [za, zb] of [[PZ1, PZ1 + 0.12], [PZ0 - 0.12, PZ0]]) {
      K.box('trim', TRIM, h.u0 - 0.3, h.u0, h.y0 === 0 ? 0.05 : h.y0 - 0.3, h.y1 + 0.3, za, zb, { flat: true });
      K.box('trim', TRIM, h.u1, h.u1 + 0.3, h.y0 === 0 ? 0.05 : h.y0 - 0.3, h.y1 + 0.3, za, zb, { flat: true });
      K.box('trim', TRIM, h.u0 - 0.3, h.u1 + 0.3, h.y1, h.y1 + 0.3, za, zb, { flat: true });
    }
    if (h.y0 > 0) K.box('trim', 0x8a6a48, h.u0 - 0.3, h.u1 + 0.3, h.y0 - 0.12, h.y0, PZ0 - 0.5, PZ1 + 0.5);
  }
  K.box('wall', CREAM, -0.25, 0.25, 0.05, CEIL, -23.75, PZ0);
  K.on('+z', PZ1, () => {
    K.sign('KITCHEN', -13.75, 8.5, 4.2, 0.85, { bg: '#7e1715', fg: '#f5efe0', family: 'Arial, Helvetica, sans-serif', depth: 0.1 });
    K.sign('BUNK ROOM', 13.75, 8.5, 4.8, 0.85, { bg: '#7e1715', fg: '#f5efe0', family: 'Arial, Helvetica, sans-serif', depth: 0.1 });
  });

  // --- the rolled-up doors: the bottom rail shows under the header, the coil sits behind it ---
  for (const [a, b] of DOORS) {
    K.box('trim', RED, a + 0.05, b - 0.05, 12.95, DOOR_H, 23.5, 23.72, { flat: true });
    K.box('trim', 0xeeeeee, a + 0.05, b - 0.05, 13.05, 13.15, 23.72, 23.74, { flat: true });
    K.rod('trim', times(RED, 0.8), [a, 14.3, 22.9], [b, 14.3, 22.9], 0.7, { sides: 14 });
    for (const x of [a - 0.3, b + 0.05]) K.box('trim', DARKSTEEL, x, x + 0.25, 0.05, DOOR_H + 0.3, 23.3, 23.75, { flat: true });
    // yellow lines on the floor to drive in between, and a stop bar
    for (const x of [a + 1.2, b - 1.4]) K.box('trim', PALETTE.laneYellow, x, x + 0.2, 0.05, 0.07, -13.5, 22.5, { flat: true });
    K.box('trim', PALETTE.laneYellow, a + 1.2, b - 1.2, 0.05, 0.07, -13.8, -13.5, { flat: true });
  }
  // strip lights under the ceiling
  for (const x of [-12, -3.6, 11.5]) for (const z of [-6, 8]) K.glowBox(GLOW.cool, x - 0.4, x + 0.4, CEIL - 0.18, CEIL, z - 4, z + 4);

  // --- the crew's gear and the brass pole, along the wall behind the tower ---
  for (let i = 0; i < 6; i++) {
    const z = -11 + i * 3.6;
    K.box('trim', DARKSTEEL, -18.75, -16.6, 0.05, 0.25, z - 1.6, z + 1.6, { flat: true });
    K.box('trim', DARKSTEEL, -18.75, -16.6, 6.4, 6.55, z - 1.6, z + 1.6, { flat: true });
    K.box('trim', DARKSTEEL, -18.75, -16.6, 0.05, 6.55, z + 1.55, z + 1.7, { flat: true });
    K.box('trim', 0xb59a52, -18.5, -17.1, 2.7, 6.0, z - 1.1, z + 1.1); // turnout coat
    K.box('trim', 0xe0c040, -18.45, -17.05, 3.1, 3.3, z - 1.12, z + 1.12, { flat: true }); // reflective band
    K.box('trim', 0xb59a52, -18.5, -17.1, 1.0, 2.6, z - 0.9, z + 0.9); // trousers over the boots
    K.box('trim', 0x1e1e20, -18.4, -17.2, 0.25, 1.1, z - 0.9, z + 0.9, { flat: true }); // boots
    K.ball('trim', i % 3 === 0 ? RED : 0x1e1e20, -17.6, 7.05, z, 0.6, { sy: 0.75 }); // helmet
    K.box('trim', i % 3 === 0 ? RED : 0x1e1e20, -18.2, -17.0, 6.6, 6.7, z - 0.75, z + 0.75, { flat: true }); // its brim
  }
  K.rod('trim', BRASS, [-13.5, 0.05, 11.5], [-13.5, CEIL, 11.5], 0.16, { sides: 12 });
  K.rod('trim', 0x2a2a2a, [-13.5, 0.05, 11.5], [-13.5, 0.4, 11.5], 1.3, { sides: 18 });
  K.rod('trim', 0xbab6aa, [-13.5, CEIL - 0.25, 11.5], [-13.5, CEIL, 11.5], 1.0, { sides: 18 });
  // a hose rack and an extinguisher on the right wall
  K.box('trim', DARKSTEEL, 18.2, 18.75, 4.0, 4.15, -6, 2, { flat: true });
  for (let k = 0; k < 4; k++) K.rod('trim', 0xd8c38a, [18.4, 4.2, -5 + k * 2.2], [18.4, 4.2 + 0.1, -5 + k * 2.2], 0.9, { sides: 16, flat: false });
  K.rod('trim', RED, [18.4, 1.5, 6], [18.4, 3.3, 6], 0.32, { sides: 12 });

  // --- the kitchen ---
  K.box('trim', 0xe9e3d3, -18.75, -6, 0.05, 3.0, -23.75, -21.6, { flat: true });
  for (let x = -18.75 + 1.5; x < -6; x += 1.5) K.box('trim', 0xb8b1a2, x - 0.03, x + 0.03, 0.4, 2.8, -21.62, -21.56, { flat: true });
  K.box('trim', 0x3c3d40, -18.75, -6, 3.0, 3.15, -23.75, -21.45);
  K.box('trim', PALETTE.steel, -12, -10, 3.1, 3.17, -23.3, -21.9, { flat: true });
  K.rod('trim', PALETTE.steel, [-11, 3.15, -23.4], [-11, 4.1, -23.4], 0.06, { sides: 6 });
  K.rod('trim', PALETTE.steel, [-11, 4.1, -23.4], [-11, 4.1, -22.7], 0.06, { sides: 6 });
  // stove: steel front, black top, four burners, an oven window
  K.box('trim', 0xd9dcdf, -17.4, -14.6, 0.05, 3.1, -23.6, -21.5, { flat: true });
  K.box('trim', 0x1d1d1f, -17.4, -14.6, 3.1, 3.2, -23.6, -21.5, { flat: true });
  for (const [bx, bz] of [[-16.7, -22.1], [-15.3, -22.1], [-16.7, -23.0], [-15.3, -23.0]]) K.rod('trim', 0x444444, [bx, 3.2, bz], [bx, 3.24, bz], 0.38, { sides: 12 });
  K.box('glass', 0x18181a, -17.0, -15.0, 1.0, 2.4, -21.5, -21.44);
  K.box('trim', 0x1d1d1f, -17.4, -14.6, 3.2, 5.0, -23.75, -23.55, { flat: true });
  // upper cabinets with door lines
  K.box('trim', 0xe9e3d3, -18.75, -6, 5.2, 7.6, -23.75, -22.55, { flat: true });
  for (let x = -18.75 + 1.6; x < -6; x += 1.6) K.box('trim', 0xb8b1a2, x - 0.03, x + 0.03, 5.3, 7.5, -22.57, -22.5, { flat: true });
  // fridge
  K.box('trim', 0xd9dcdf, -5.4, -2.6, 0.05, 6.4, -23.6, -21.2, { flat: true });
  K.box('trim', 0x9fa3a8, -5.4, -2.6, 4.3, 4.36, -21.22, -21.16, { flat: true });
  K.box('trim', 0x6b6f73, -5.1, -4.95, 2.4, 6.0, -21.2, -21.0, { flat: true });
  // the long table the crew eats at
  table(K, -14.5, -4.5, -20.2, -17.8, 2.55, 0x9a7b55);
  for (const x of [-13, -9.5, -6]) { chair(K, x, -21.0, 0, 0x2f5a8a); chair(K, x, -17.0, Math.PI, 0x2f5a8a); }
  K.rod('trim', 0x2a2a2a, [-9.5, 2.55, -19], [-9.5, 3.4, -19], 0.28, { sides: 10 }); // the coffee pot
  K.glowBox(GLOW.cool, -11, -8, CEIL - 0.18, CEIL, -20.5, -17.5);

  // --- the bunk room ---
  const bunk = (cx) => {
    const x0 = cx - 1.7; const x1 = cx + 1.7; const z0 = -23.6; const z1 = -16.9;
    for (const x of [x0 + 0.08, x1 - 0.08]) for (const z of [z0 + 0.08, z1 - 0.08]) K.rod('trim', 0x3f5a7a, [x, 0.05, z], [x, 6.2, z], 0.09, { sides: 8 });
    for (const y of [1.2, 4.5]) {
      K.box('trim', 0x3f5a7a, x0, x1, y - 0.25, y, z0, z1, { flat: true });
      K.box('trim', 0x2d3f66, x0 + 0.12, x1 - 0.12, y, y + 0.55, z0 + 0.12, z1 - 0.12); // blanket over the mattress
      K.box('trim', 0xf1eee6, x0 + 0.4, x1 - 0.4, y + 0.55, y + 0.85, z0 + 0.25, z0 + 1.35); // pillow
    }
    for (let k = 0; k < 4; k++) K.box('trim', 0x3f5a7a, x1 - 0.05, x1 + 0.05, 1.6 + k * 0.85, 1.7 + k * 0.85, z1 - 1.2, z1 - 0.1, { flat: true });
  };
  bunk(3.4);
  bunk(8.6);
  // lockers on the right wall
  K.box('trim', 0x6f8295, 16.9, 18.75, 0.05, 6.8, -23.6, -16.4, { flat: true });
  for (let z = -23.6 + 1.5; z < -16.4; z += 1.5) K.box('trim', 0x4a5868, 16.86, 16.92, 0.2, 6.6, z - 0.03, z + 0.03, { flat: true });
  for (let z = -23.6 + 0.75; z < -16.4; z += 1.5) for (const y of [5.6, 5.85, 6.1]) K.box('trim', 0x4a5868, 16.86, 16.9, y, y + 0.08, z - 0.35, z + 0.35, { flat: true });
  K.glowBox(GLOW.cool, 7, 10, CEIL - 0.18, CEIL, -21, -18);

  // --- outside: the front ---
  // limestone base course, stopping at the bay openings
  K.box('trim', LIME, -20.15, -10.25, -0.4, 1.3, 25, 25.15);
  K.box('trim', LIME, 2.25, 5.25, -0.4, 1.3, 25, 25.15);
  K.box('trim', LIME, 17.75, 20.15, -0.4, 1.3, 25, 25.15);
  K.box('trim', LIME, 20, 20.15, -0.4, 1.3, -25, 25);
  K.box('trim', LIME, -20.15, -20, -0.4, 1.3, -25, 25);
  K.box('trim', LIME, -20.15, 20.15, -0.4, 1.3, -25.15, -25);
  // stone jambs up both sides of each bay, and a stone band under the sign
  for (const [a, b] of DOORS) {
    K.box('trim', LIME, a - 0.55, a, 1.3, DOOR_H, 25, 25.12);
    K.box('trim', LIME, b, b + 0.55, 1.3, DOOR_H, 25, 25.12);
  }
  K.box('trim', LIME, -10.8, 18.3, DOOR_H - 0.05, DOOR_H + 0.35, 25, 25.22);
  K.on('+z', 25, () => {
    K.sign('FIRE STATION No. 1', 3.75, 14.9, 24, 1.85, { bg: '#7e1715', fg: '#f3d27c', border: '#f3d27c', depth: 0.2, edge: 0x5a1010 });
  });
  K.ring('trim', LIME, 20, 25, UP, UP + 0.55, 0.22);
  // the upper storey's windows, on every side but where the tower stands
  const upper = (side, plane, list) => K.on(side, plane, () => {
    for (const u of list) K.window(u, UP + 2.6, 3.6, 6.4, { cols: 1, rows: 2, keystone: true, sill: LIME, lintel: LIME, frame: TRIM });
  });
  upper('+z', 25, [-4.1, 1.9, 7.9, 13.9]);
  upper('+x', 20, [17.5, 8.5, -0.5, -9.5, -18.5]);
  upper('-x', 20, [-18.5, -9.5, -0.5, 8.5]);
  upper('-z', 25, [-15, -6, 3, 12]);
  // ground-floor windows on the sides and the back, and a back door
  K.on('+x', 20, () => { for (const u of [-9.5, -0.5, 8.5, 17.5]) K.window(u, 4.2, 3.4, 6.2, { cols: 1, rows: 2, sill: LIME, lintel: LIME }); });
  K.on('-x', 20, () => { for (const u of [-18.5, -9.5, -0.5, 8.5]) K.window(u, 4.2, 3.4, 6.2, { cols: 1, rows: 2, sill: LIME, lintel: LIME }); });
  K.on('-z', 25, () => {
    K.window(10, 4.6, 4, 3.4, { cols: 2, rows: 1, sill: LIME, lintel: LIME });
    K.window(-10, 4.6, 4, 3.4, { cols: 2, rows: 1, sill: LIME, lintel: LIME });
    K.door(-3, 0.05, 3.2, 7.2, { color: RED, glassTop: 0.3 });
  });
  // cornice, brick parapet, stone coping, roof
  K.cornice(LIME, 20, 25, ROOF - 0.9, { steps: [[0.3, 0.12], [0.3, 0.3], [0.3, 0.5]] });
  K.ring('wall', BRICK, 20, 25, ROOF, ROOF + 1.4, 0, 1.0);
  K.ring('trim', LIME, 20, 25, ROOF + 1.4, ROOF + 1.7, 0.18, 1.18);
  K.box('trim', PALETTE.roofTar, -19, 19, ROOF - 0.2, ROOF + 0.15, -24, 24);

  // --- the hose tower, 40ft, and the crew's own door at its foot ---
  const TX = -15.125; const TZ = 20; const THX = 4.875; const THZ = 5;
  K.within(new THREE.Matrix4().makeTranslation(TX, 0, TZ), () => {
    // quoins: stone blocks up the two front corners, alternating long and short
    for (let y = 1.3, i = 0; y < 37; y += 1.1, i++) {
      const L = i % 2 ? 1.0 : 1.6;
      K.box('trim', LIME, -THX - 0.1, -THX + L, y, y + 1.0, THZ, THZ + 0.1);
      K.box('trim', LIME, -THX - 0.1, -THX, y, y + 1.0, THZ - L, THZ);
      K.box('trim', LIME, THX - L, THX + 0.05, y, y + 1.0, THZ, THZ + 0.1);
    }
    K.ring('trim', LIME, THX, THZ, 37.0, 37.5, 0.25);
    K.ring('trim', LIME, THX, THZ, 37.5, 38.0, 0.5);
    K.ring('wall', BRICK, THX, THZ, 38, 39.6, 0, 0.8);
    K.ring('trim', LIME, THX, THZ, 39.6, 40, 0.2, 1.0);
    K.box('trim', PALETTE.roofTar, -THX + 0.5, THX - 0.5, 37.8, 38.1, -THZ + 0.5, THZ - 0.5);
  });
  K.on('+z', 25, () => {
    K.door(TX, 0.05, 3.4, 7.6, { color: RED, glassTop: 0.38 });
    K.box('trim', LIME, TX - 2.5, TX + 2.5, 8.1, 8.7, 0, 0.45); // the hood over the door
    K.window(TX, UP + 2.6, 2.6, 6.4, { cols: 1, rows: 2, keystone: true, sill: LIME, lintel: LIME });
    K.window(TX, 29.4, 2.2, 3.4, { cols: 1, rows: 1, sill: LIME, lintel: LIME });
    K.box('trim', 0x2a2a2a, TX - 0.12, TX + 0.12, 8.7, 10.0, 0, 0.6, { flat: true });
    K.ball('glow', 0xffffff, TX, 9.6, 0.75, 0.42, { glow: GLOW.red });
  });
  // tall louvred openings at the top of the tower, where the wet hoses hang
  const louvres = (side, plane, u) => K.on(side, plane, () => {
    K.box('trim', 0x2b2b2e, u - 1.3, u + 1.3, 32.2, 36.6, 0, 0.04, { flat: true });
    for (let y = 32.4; y < 36.4; y += 0.45) K.box('trim', 0x6a6f74, u - 1.3, u + 1.3, y, y + 0.14, 0.02, 0.2, { flat: true });
    K.box('trim', LIME, u - 1.6, u + 1.6, 31.9, 32.2, 0, 0.4);
    K.box('trim', LIME, u - 1.6, u + 1.6, 36.6, 37.0, 0, 0.2);
  });
  louvres('+z', 25, TX);
  louvres('-x', 20, TZ);
  louvres('-z', -15, -TX);
  louvres('+x', -10.25, -TZ);
  K.on('-x', 20, () => K.window(TZ, 29.4, 2.2, 3.4, { cols: 1, rows: 1, sill: LIME, lintel: LIME }));
  return K.finish();
}

// A wall lantern in wall coordinates: an iron bracket out of the wall and a glowing glass box.
function lantern(K, u, y, swatch, { size = 0.85, out = 1.15 } = {}) {
  const iron = 0x22252a;
  K.box('trim', iron, u - 0.35, u + 0.35, y - 0.9, y + 0.5, 0, 0.12, { flat: true });
  K.rod('trim', iron, [u, y, 0.05], [u, y, out], 0.07, { sides: 6 });
  K.rod('trim', iron, [u, y - 0.6, 0.05], [u, y, out * 0.7], 0.05, { sides: 6 });
  const h = size * 1.35;
  K.box('trim', iron, u - size * 0.6, u + size * 0.6, y - 0.12, y, out - size * 0.6, out + size * 0.6, { flat: true });
  K.glowBox(swatch, u - size / 2, u + size / 2, y, y + h, out - size / 2, out + size / 2);
  for (const [du, dn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box('trim', iron, u + du * size / 2 - 0.05, u + du * size / 2 + 0.05, y, y + h, out + dn * size / 2 - 0.05, out + dn * size / 2 + 0.05, { flat: true });
  const cap = new THREE.CylinderGeometry(0.05, size * 0.82, size * 0.55, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(u, y + h + size * 0.27, out);
  K.add('trim', cap, iron, { flat: true });
  K.ball('trim', iron, u, y + h + size * 0.6, out, 0.1);
}

// A shrub: a few overlapping green balls.
function shrub(K, x, y, z, r, rng, color = 0x3f7a34) {
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2; const d = r * 0.35;
    K.ball('trim', times(color, 0.85 + rng() * 0.3), x + Math.cos(a) * d, y + r * 0.55 + rng() * r * 0.2, z + Math.sin(a) * d, r * (0.55 + rng() * 0.2), { w: 12, h: 8, flat: false });
  }
}

// ---------------------------------------------------------------------------------------------
// POLICE STATION. A two-storey brick station 50 x 34ft with a paved forecourt, and a 30 x 40ft
// lot beside it for the patrol cars: the whole piece is 80 x 40, centred on the origin.
// ---------------------------------------------------------------------------------------------
function policeStation() {
  const K = new Kit({ seed: 202, wall: 'brick' });
  const rng = K.rng;
  const BRICK = PALETTE.brickBrown; const LIME = PALETTE.limestone; const TRIM = 0x3b3f45;
  const X0 = -40; const X1 = 10; const Z0 = -20; const Z1 = 14; const CX = -15; const CZ = -3; const HW = 25; const HD = 17;
  const F2 = 13; const ROOF = 26;
  const NAVY = '#1d2e4d';

  K.box('wall', BRICK, X0, X1, -0.4, ROOF, Z0, Z1);
  K.within(new THREE.Matrix4().makeTranslation(CX, 0, CZ), () => {
    K.ring('trim', LIME, HW, HD, -0.4, 2.4, 0.15);
    K.ring('trim', LIME, HW, HD, F2 - 0.3, F2 + 0.5, 0.18);
    K.cornice(LIME, HW, HD, ROOF - 1.0, { steps: [[0.3, 0.12], [0.3, 0.3], [0.4, 0.55]] });
    K.ring('wall', BRICK, HW, HD, ROOF, ROOF + 1.3, 0, 1.0);
    K.ring('trim', LIME, HW, HD, ROOF + 1.3, ROOF + 1.65, 0.18, 1.18);
    K.box('trim', PALETTE.roofTar, -HW + 0.8, HW - 0.8, ROOF - 0.2, ROOF + 0.15, -HD + 0.8, HD - 0.8);
    // darker brick quoins standing a little proud at the four corners, long and short in turn
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let y = 2.4, i = 0; y < ROOF - 1.2; y += 1.2, i++) {
        const a = i % 2 ? 1.2 : 2.0; const b = i % 2 ? 2.0 : 1.2;
        K.box('wall', times(BRICK, 0.8), sx * (HW - a), sx * (HW + 0.12), y, y + 1.1, sz * HD, sz * (HD + 0.12));
        K.box('wall', times(BRICK, 0.8), sx * HW, sx * (HW + 0.12), y, y + 1.1, sz * (HD - b), sz * HD);
      }
    }
  });

  const win = (u, y0, w = 3.6, h = 6.4) => K.window(u, y0, w, h, { cols: 2, rows: 2, transom: h * 0.68, sill: LIME, lintel: LIME, frame: 0xe9e6de });
  // --- the front, with its stone entrance ---
  K.on('+z', Z1, () => {
    for (const u of [-34.5, -29, -23.5, -6.5, -1, 4.5]) { win(u, 3.2); win(u, F2 + 3.2); }
    for (const u of [-18.6, -15, -11.4]) win(u, F2 + 3.2, 2.6, 6.4);
    // pilasters and an entablature in limestone, proud of the brick
    for (const [a, b] of [[-21.4, -19.6], [-10.4, -8.6]]) {
      K.box('trim', LIME, a, b, -0.4, 11, 0, 0.55);
      K.box('trim', LIME, a - 0.2, b + 0.2, -0.4, 0.9, 0, 0.75);
      K.box('trim', LIME, a - 0.2, b + 0.2, 10.6, 11.0, 0, 0.7);
    }
    K.box('trim', LIME, -21.8, -8.2, 11.0, 13.1, 0, 0.7);
    K.box('trim', LIME, -22.2, -7.8, 13.1, 13.6, 0, 1.0);
    K.sign('POLICE', -15, 12.05, 9.5, 1.7, { bg: '#d4c8ad', fg: NAVY, n0: 0.7, depth: 0.08, edge: LIME, letter: 1, size: 0.72 });
    // the doors: a pair in bronze-dark aluminium with a transom over them
    K.box('trim', 0x2a2b2e, -18.6, -11.4, 0.05, 10.6, 0, 0.06, { flat: true });
    for (const [a, b] of [[-18.3, -15.05], [-14.95, -11.7]]) {
      K.pane(a + 0.35, b - 0.35, 0.6, 8.2, 0.06, 0.12);
      K.box('trim', TRIM, a, a + 0.35, 0.05, 8.5, 0.06, 0.2, { flat: true });
      K.box('trim', TRIM, b - 0.35, b, 0.05, 8.5, 0.06, 0.2, { flat: true });
      K.box('trim', TRIM, a + 0.35, b - 0.35, 8.2, 8.5, 0.06, 0.2, { flat: true });
      K.box('trim', TRIM, a + 0.35, b - 0.35, 0.05, 0.6, 0.06, 0.2, { flat: true });
      K.rod('trim', 0xb8bcc0, [a < -15 ? b - 0.7 : a + 0.7, 3.0, 0.3], [a < -15 ? b - 0.7 : a + 0.7, 4.8, 0.3], 0.06, { sides: 6 });
    }
    K.pane(-18.3, -11.7, 8.75, 10.3, 0.06, 0.12);
    K.box('trim', TRIM, -18.6, -11.4, 8.5, 8.75, 0.06, 0.2, { flat: true });
    K.box('trim', TRIM, -15.1, -14.9, 8.75, 10.3, 0.06, 0.2, { flat: true });
    // the blue lamps, one each side of the door
    lantern(K, -20.5, 7.2, GLOW.blue, { out: 1.35, size: 1.1 });
    lantern(K, -9.5, 7.2, GLOW.blue, { out: 1.35, size: 1.1 });
    // the station's number plate and a small notice
    K.sign('PRECINCT 1', -15, 15.0, 6, 1.1, { bg: NAVY, fg: '#f0ead8', family: 'Arial, Helvetica, sans-serif', depth: 0.12 });
  });
  // the other three sides
  K.on('-x', 40, () => { for (const u of [-13, -5, 3, 11]) { win(u, 3.2); win(u, F2 + 3.2); } });
  K.on('-z', 20, () => { for (const u of [-6, 0, 6, 24, 30, 36]) { win(u - 0, 3.2); win(u, F2 + 3.2); } K.door(15, 0.05, 3.4, 7.4, { color: 0x34495e, glassTop: 0.32 }); });
  K.on('+x', 10, () => {
    for (const u of [-9, -1, 5]) win(u, 3.2);
    for (const u of [-9, -1, 5, 11]) win(u, F2 + 3.2);
    K.door(11.5, 0.05, 3.4, 7.4, { color: 0x34495e, glassTop: 0.32 });
    K.box('trim', LIME, 9.0, 14.0, 8.0, 8.5, 0, 2.6);
    K.sign('NO PARKING', 11.5, 9.6, 3.8, 0.8, { bg: '#f5f2ea', fg: '#a01818', family: 'Arial, Helvetica, sans-serif', depth: 0.08, n0: 0.1 });
  });

  // --- roof: a radio mast and an air-handling unit ---
  const MX = -27; const MZ = -10;
  for (const [dx, dz] of [[-0.9, -0.6], [0.9, -0.6], [0, 0.9]]) K.rod('trim', 0xc9c9c9, [MX + dx, ROOF, MZ + dz], [MX + dx * 0.2, ROOF + 22, MZ + dz * 0.2], 0.09, { sides: 6 });
  for (let y = ROOF + 2; y < ROOF + 21; y += 2.2) {
    const k = 1 - (y - ROOF) / 22 * 0.8;
    const pts = [[MX - 0.9 * k, MZ - 0.6 * k], [MX + 0.9 * k, MZ - 0.6 * k], [MX, MZ + 0.9 * k]];
    for (let i = 0; i < 3; i++) { const a = pts[i]; const b = pts[(i + 1) % 3]; K.rod('trim', 0xb0b0b0, [a[0], y, a[1]], [b[0], y, b[1]], 0.04, { sides: 4 }); }
  }
  K.ball('glow', 0xffffff, MX, ROOF + 22.2, MZ, 0.25, { glow: GLOW.red });
  K.box('trim', 0xb9bcbf, -6, 3, ROOF, ROOF + 4.2, -14, -6, { flat: true });
  for (let z = -13.5; z < -6.2; z += 0.5) K.box('trim', 0x7d8186, 3, 3.08, ROOF + 0.6, ROOF + 3.6, z, z + 0.25, { flat: true });
  K.rod('trim', 0x3a3a3a, [-1.5, ROOF + 4.2, -10], [-1.5, ROOF + 4.5, -10], 1.4, { sides: 16 });

  // --- the forecourt: paving, two planters, the flagpole ---
  K.box('trim', PALETTE.concrete, X0, X1, -0.4, 0.08, Z1, 20);
  for (let x = X0 + 5; x < X1; x += 5) K.box('trim', times(PALETTE.concrete, 0.82), x - 0.04, x + 0.04, 0.08, 0.09, Z1, 20, { flat: true });
  for (const x of [-27, -3]) {
    K.box('trim', LIME, x - 3, x + 3, 0.08, 1.8, 15.5, 18.5);
    K.box('trim', 0x4a3524, x - 2.7, x + 2.7, 1.8, 1.85, 15.8, 18.2, { flat: true });
    shrub(K, x - 1.3, 1.6, 17, 1.5, rng);
    shrub(K, x + 1.3, 1.6, 17, 1.5, rng);
  }
  K.flagpole(-36, 17.5, 30, drawUSFlag, { yaw: 0 });

  // --- the lot: asphalt, kerbs, three marked bays with wheel stops, a sign and a light ---
  K.box('trim', PALETTE.asphalt, X1, 40, -0.4, 0.06, Z0, 20);
  K.box('trim', PALETTE.kerb, 39.3, 40, 0.06, 0.5, Z0, 20);
  K.box('trim', PALETTE.kerb, X1, 39.3, 0.06, 0.5, Z0, Z0 + 0.7);
  for (const x of [10.9, 20.3, 29.7, 39.1]) K.box('trim', PALETTE.laneWhite, x - 0.17, x + 0.17, 0.06, 0.08, Z0 + 0.7, -1.3, { flat: true });
  for (const x of [15.6, 25.0, 34.4]) {
    K.box('trim', PALETTE.concrete, x - 3, x + 3, 0.06, 0.5, -18.6, -17.9);
    K.box('trim', 0xe2b23a, x - 3, x + 3, 0.42, 0.5, -18.6, -17.9, { flat: true });
  }
  K.rod('trim', 0x6b6f73, [38.4, 0.06, 15.5], [38.4, 7.2, 15.5], 0.1, { sides: 8 });
  K.within(new THREE.Matrix4().makeTranslation(38.4, 0, 15.6), () => {
    K.sign('POLICE VEHICLES ONLY', 0, 6.3, 2.6, 1.5, { bg: '#f5f2ea', fg: NAVY, family: 'Arial, Helvetica, sans-serif', border: NAVY, depth: 0.06 });
  });
  K.rod('trim', 0x5b5f63, [38.8, 0.5, -2], [38.8, 18, -2], 0.22, { r2: 0.14, sides: 10 });
  K.rod('trim', 0x5b5f63, [38.8, 17.8, -2], [34.5, 18.2, -2], 0.1, { sides: 6 });
  K.box('trim', 0x5b5f63, 33.2, 35.4, 17.9, 18.4, -2.6, -1.4, { flat: true });
  K.glowBox(GLOW.white, 33.4, 35.2, 17.82, 17.9, -2.45, -1.55);
  return K.finish();
}

// A small street tree: a trunk and a crown of overlapping balls.
function tree(K, x, z, h, rng) {
  K.rod('trim', PALETTE.bark, [x, 0, z], [x, h * 0.55, z], 0.28, { r2: 0.2, sides: 8, flat: false });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng(); const d = i ? h * 0.16 : 0;
    K.ball('trim', times(PALETTE.leaf, 0.85 + rng() * 0.3), x + Math.cos(a) * d, h * (0.66 + rng() * 0.1) + (i ? 0 : h * 0.08), z + Math.sin(a) * d, h * (i ? 0.2 : 0.24), { w: 12, h: 8, flat: false });
  }
}

function bench(K, x, z, yaw) {
  K.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z), () => {
    for (const lx of [-2.2, 2.2]) K.box('trim', 0x2f3236, lx - 0.1, lx + 0.1, 0, 1.5, -0.8, 0.6, { flat: true });
    for (let k = 0; k < 3; k++) K.box('trim', 0x8a6a48, -2.6, 2.6, 1.4, 1.55, -0.75 + k * 0.48, -0.37 + k * 0.48);
    for (let k = 0; k < 2; k++) K.box('trim', 0x8a6a48, -2.6, 2.6, 2.0 + k * 0.5, 2.35 + k * 0.5, -0.82, -0.7);
    K.box('trim', 0x2f3236, -2.3, -2.1, 1.4, 2.9, -0.86, -0.8, { flat: true });
    K.box('trim', 0x2f3236, 2.1, 2.3, 1.4, 2.9, -0.86, -0.8, { flat: true });
  });
}

// A shopfront of glass in wall coordinates: panes between mullions, a transom, a frame.
function storefront(K, u0, u1, y0, y1, { bay = 4, transom = null, frame = 0xb8bcc0 } = {}) {
  K.pane(u0, u1, y0, y1, 0, 0.06);
  const n = Math.max(1, Math.round((u1 - u0) / bay));
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    K.box('trim', frame, u - 0.15, u + 0.15, y0, y1, 0, 0.3, { flat: true });
  }
  K.box('trim', frame, u0 - 0.15, u1 + 0.15, y1 - 0.3, y1, 0, 0.3, { flat: true });
  K.box('trim', frame, u0 - 0.15, u1 + 0.15, y0, y0 + 0.3, 0, 0.3, { flat: true });
  if (transom !== null) K.box('trim', frame, u0, u1, transom - 0.12, transom + 0.12, 0, 0.28, { flat: true });
}

// The hospital H, white on blue, drawn as shapes.
function drawHospitalSign(ctx, x, y, w, h) {
  ctx.fillStyle = '#1f4fa3';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = w * 0.035;
  ctx.strokeRect(x + w * 0.06, y + h * 0.06, w * 0.88, h * 0.88);
  ctx.fillStyle = '#ffffff';
  const s = w * 0.12;
  ctx.fillRect(x + w * 0.3, y + h * 0.22, s, h * 0.56);
  ctx.fillRect(x + w * 0.7 - s, y + h * 0.22, s, h * 0.56);
  ctx.fillRect(x + w * 0.3, y + h * 0.44, w * 0.4, s);
}

// ---------------------------------------------------------------------------------------------
// HOSPITAL. Six floors (78ft to the roof, 80 to the parapet) on a 60 x 50ft plan, behind a 30ft
// forecourt with a drive-under emergency canopy 11ft clear and a separate visitors' entrance.
// The whole piece is 60 x 80, centred on the origin.
// ---------------------------------------------------------------------------------------------
function cityHospital() {
  const K = new Kit({ seed: 303, wall: 'panel' });
  const rng = K.rng;
  const CLAD = 0xdcd8cf; const ACCENT = 0x4f8aa3; const RED = 0xb42c2c; const ALU = 0xb8bcc0;
  const Z0 = -40; const Z1 = 10; const HW = 30; const FL = 13; const ROOF = 78;

  K.box('wall', CLAD, -HW, HW, -0.4, ROOF, Z0, Z1);
  K.within(new THREE.Matrix4().makeTranslation(0, 0, -15), () => {
    K.ring('trim', 0x9a978f, HW, 25, -0.4, 1.6, 0.12);
    K.ring('wall', CLAD, HW, 25, ROOF, ROOF + 2, 0, 0.9);
    K.ring('trim', ACCENT, HW, 25, ROOF - 0.6, ROOF + 0.2, 0.12);
    K.ring('trim', 0xc9c6bd, HW, 25, ROOF + 2, ROOF + 2.3, 0.15, 1.05);
    K.box('trim', PALETTE.roofTar, -HW + 0.8, HW - 0.8, ROOF - 0.2, ROOF + 0.12, -24.2, 24.2);
  });

  // --- window bands: floors 1 to 5 all round, and the ground floor where it is not a lobby ---
  const band = (y, u0, u1) => {
    K.pane(u0, u1, y, y + 6.4, 0, 0.06);
    const n = Math.round((u1 - u0) / 5);
    for (let i = 0; i <= n; i++) { const u = u0 + ((u1 - u0) * i) / n; K.box('trim', ALU, u - 0.14, u + 0.14, y, y + 6.4, 0, 0.22, { flat: true }); }
    K.box('trim', ALU, u0 - 0.14, u1 + 0.14, y + 6.4, y + 6.65, 0, 0.22, { flat: true });
    K.box('trim', CLAD, u0 - 0.3, u1 + 0.3, y - 0.3, y, 0, 0.4); // a ledge under each band
  };
  for (let f = 1; f < 6; f++) {
    const y = f * FL + 3.2;
    K.on('+z', Z1, () => band(y, -28, 28));
    K.on('-z', -Z0, () => band(y, -28, 28));
    K.on('+x', HW, () => band(y, -8, 38));
    K.on('-x', HW, () => band(y, -38, 8));
    // a coloured spandrel stripe under each band, the hospital's own colour
    K.within(new THREE.Matrix4().makeTranslation(0, 0, -15), () => K.ring('trim', ACCENT, HW, 25, f * FL + 1.0, f * FL + 1.7, 0.06, 0.3));
  }
  K.on('+x', HW, () => band(3.2, -8, 38));
  K.on('-x', HW, () => band(3.2, -38, 8));
  K.on('-z', -Z0, () => { band(3.2, -28, 4); K.door(14, 0.08, 6, 8.5, { color: 0x6c737a, leaves: 2, glassTop: 0.5 }); });

  // --- the front at ground level: the visitors' lobby, the emergency doors, and the stair core ---
  K.on('+z', Z1, () => {
    storefront(K, -27, -7, 0.08, 10.6, { bay: 4, transom: 8.4 });
    K.box('trim', 0x5f666d, -19.5, -14.5, 0.08, 8.3, 0.06, 0.1, { flat: true });
    K.pane(-19.4, -17.05, 0.2, 8.1, 0.1, 0.16);
    K.pane(-16.95, -14.6, 0.2, 8.1, 0.1, 0.16);
    storefront(K, 11, 23, 0.08, 9.4, { bay: 3 });
    K.sign('EMERGENCY', 17, 10.15, 8, 1.0, { bg: '#f7f5f0', fg: '#b01e1e', family: 'Arial, Helvetica, sans-serif', depth: 0.12, letter: 1 });
    K.window(3 + 2.6, 3.2, 3.0, 6.0, { cols: 1, rows: 2, sill: CLAD, lintel: null, frame: ALU });
    K.window(-3.2 + 0.0 - 1.6, 3.2, 3.0, 6.0, { cols: 1, rows: 2, sill: CLAD, lintel: null, frame: ALU });
  });
  // the stair and lift core, in the hospital's colour, rising above the roof with the name on it
  K.box('wall', ACCENT, -4.5, 4.5, -0.4, ROOF + 6.5, 3, Z1 + 1.4);
  K.box('trim', 0xc9c6bd, -4.8, 4.8, ROOF + 6.5, ROOF + 6.9, 2.7, Z1 + 1.7);
  K.on('+z', Z1 + 1.4, () => {
    for (let f = 1; f < 6; f++) K.window(0, f * FL + 2.4, 1.8, 8.2, { cols: 1, rows: 1, sill: null, lintel: null, frame: ALU });
    K.sign('HOSPITAL', 0, ROOF + 3.9, 8.2, 2.2, { bg: '#f7f5f0', fg: '#1f4fa3', family: 'Arial, Helvetica, sans-serif', depth: 0.15, letter: 1 });
  });

  // --- the forecourt ---
  K.box('trim', PALETTE.concrete, -HW, HW, -0.4, 0.08, Z1, 40);
  for (let x = -25; x < HW; x += 5) K.box('trim', times(PALETTE.concrete, 0.83), x - 0.04, x + 0.04, 0.08, 0.09, Z1, 40, { flat: true });
  // the ambulance lane: painted where an ambulance stops, running out to the street
  const lane = K.rect(200, 400, (ctx, x, y, w, h) => {
    ctx.fillStyle = '#4a4b4e';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#e2b23a';
    ctx.lineWidth = 8;
    ctx.strokeRect(x + 14, y + 40, w - 28, h * 0.62);
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 14, y + 40, w - 28, h * 0.62); ctx.clip();
    ctx.lineWidth = 6;
    for (let k = -h; k < h; k += 34) { ctx.beginPath(); ctx.moveTo(x, y + 40 + k); ctx.lineTo(x + w, y + 40 + k + w); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = '#4a4b4e';
    ctx.fillRect(x + 30, y + 40 + h * 0.62 * 0.36, w - 60, h * 0.62 * 0.28);
    ctx.fillStyle = '#f2f0ea';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let px = 36;
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    const m = ctx.measureText('AMBULANCE').width;
    if (m > w - 70) { px = Math.floor((px * (w - 70)) / m); ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`; }
    ctx.fillText('AMBULANCE', x + w / 2, y + 40 + h * 0.31);
    // arrows pointing in, toward the doors
    ctx.fillStyle = '#f2f0ea';
    for (const ay of [h * 0.78, h * 0.92]) {
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + ay - 34); ctx.lineTo(x + w / 2 + 26, y + ay - 4); ctx.lineTo(x + w / 2 + 9, y + ay - 4);
      ctx.lineTo(x + w / 2 + 9, y + ay + 22); ctx.lineTo(x + w / 2 - 9, y + ay + 22); ctx.lineTo(x + w / 2 - 9, y + ay - 4); ctx.lineTo(x + w / 2 - 26, y + ay - 4);
      ctx.closePath(); ctx.fill();
    }
  });
  K.decalBox(lane, 8.5, 25.5, 0.08, 0.1, Z1, 40, { face: '+y', edge: 0x4a4b4e });
  // the emergency canopy: 26 x 24ft, 11ft clear underneath, red fascia, lit sign
  const CZ1 = 34;
  K.box('trim', 0xe9e7e2, 4, HW, 11, 12.2, Z1, CZ1);
  K.box('trim', RED, 4, HW, 11.0, 13.8, CZ1, CZ1 + 0.3, { flat: true });
  K.box('trim', RED, 3.7, 4, 11.0, 13.8, Z1, CZ1 + 0.3, { flat: true });
  K.box('trim', RED, HW, HW + 0.3, 11.0, 13.8, Z1, CZ1 + 0.3, { flat: true });
  K.box('trim', 0xc9c6bd, 4, HW, 12.2, 12.5, Z1, CZ1);
  K.within(new THREE.Matrix4().makeTranslation(0, 0, CZ1 + 0.3), () => {
    K.sign('EMERGENCY', 17, 12.45, 15, 2.2, { bg: '#fbfaf6', fg: '#c01a1a', family: 'Arial, Helvetica, sans-serif', depth: 0.12, letter: 1, size: 0.7 });
  });
  for (const x of [7, 27]) {
    K.rod('trim', 0xe9e7e2, [x, 0.08, CZ1 - 1.6], [x, 11, CZ1 - 1.6], 0.75, { sides: 16 });
    K.box('trim', 0x9a978f, x - 1.1, x + 1.1, 0.08, 0.9, CZ1 - 2.7, CZ1 - 0.5);
  }
  for (const z of [16, 24, 31]) K.glowBox(GLOW.cool, 9, 25, 10.86, 11, z - 0.6, z + 0.6);
  K.glowBox(GLOW.red, 4, HW, 10.86, 11.0, CZ1 - 0.25, CZ1);
  // the visitors' canopy over the lobby doors
  K.box('trim', 0xe9e7e2, -25, -9, 11, 11.8, Z1, 17.5);
  K.box('trim', ACCENT, -25.2, -8.8, 11, 12.6, 17.5, 17.8, { flat: true });
  for (const x of [-24.2, -9.8]) K.rod('trim', ALU, [x, 0.08, 16.8], [x, 11, 16.8], 0.25, { sides: 10 });
  K.within(new THREE.Matrix4().makeTranslation(0, 0, 17.8), () => K.sign('MAIN ENTRANCE', -17, 11.8, 9, 1.2, { bg: '#f7f5f0', fg: '#1f4fa3', family: 'Arial, Helvetica, sans-serif', depth: 0.1 }));
  for (const z of [12.5, 15.5]) K.glowBox(GLOW.cool, -21, -13, 10.86, 11, z - 0.4, z + 0.4);
  // planting, benches and the blue H sign by the street
  for (const [x, z] of [[-26.5, 34], [-4, 35]]) {
    K.box('trim', 0x9a978f, x - 2.4, x + 2.4, 0.08, 1.4, z - 2.4, z + 2.4);
    K.box('trim', 0x4a3524, x - 2.1, x + 2.1, 1.4, 1.45, z - 2.1, z + 2.1, { flat: true });
    tree(K, x, z, 14 + rng() * 3, rng);
  }
  bench(K, -20, 22, 0);
  bench(K, -26, 21, Math.PI / 2);
  K.rod('trim', 0x6b6f73, [2.5, 0.08, 38], [2.5, 8.6, 38], 0.1, { sides: 8 });
  const hs = K.rect(160, 160, drawHospitalSign);
  K.decalBox(hs, 1.1, 3.9, 6.0, 8.8, 38.1, 38.2, { edge: 0x1f4fa3 });

  // --- the helipad on the roof ---
  const PX0 = -16; const PX1 = 16; const PZ0 = -36; const PZ1 = -2; const PY = ROOF + 2.4;
  for (let x = PX0 + 2; x < PX1; x += 7) for (let z = PZ0 + 2; z < PZ1; z += 7) K.box('trim', DARKSTEEL, x - 0.4, x + 0.4, ROOF, PY - 0.6, z - 0.4, z + 0.4, { flat: true });
  K.box('trim', DARKSTEEL, PX0, PX1, PY - 0.6, PY - 0.1, PZ0, PZ1, { flat: true });
  const pad = K.rect(256, 256, (ctx, x, y, w, h) => {
    ctx.fillStyle = '#5a5d5a';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f0c63a';
    ctx.lineWidth = w * 0.03;
    ctx.strokeRect(x + w * 0.03, y + h * 0.03, w * 0.94, h * 0.94);
    ctx.strokeStyle = '#f4f3ee';
    ctx.lineWidth = w * 0.045;
    ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f4f3ee';
    const s = w * 0.075; const H = h * 0.36;
    ctx.fillRect(x + w * 0.5 - w * 0.15, y + h / 2 - H / 2, s, H);
    ctx.fillRect(x + w * 0.5 + w * 0.15 - s, y + h / 2 - H / 2, s, H);
    ctx.fillRect(x + w * 0.5 - w * 0.15, y + h / 2 - s / 2, w * 0.3, s);
  });
  K.decalBox(pad, PX0 + 0.3, PX1 - 0.3, PY - 0.1, PY, PZ0 + 0.3, PZ1 - 0.3, { face: '+y', edge: 0x5a5d5a });
  // a low rail round three sides, edge lights, a windsock and a stair down to the roof
  for (let k = 0; k < 4; k++) {
    const lights = k % 2 ? [[PX0, PZ0 + 6], [PX0, PZ0 + 17], [PX0, PZ0 + 28], [PX1, PZ0 + 6], [PX1, PZ0 + 17], [PX1, PZ0 + 28]] : [[PX0 + 6, PZ0], [PX0 + 16, PZ0], [PX0 + 26, PZ0], [PX0 + 6, PZ1], [PX0 + 16, PZ1], [PX0 + 26, PZ1]];
    if (k > 1) break;
    for (const [x, z] of lights) K.glowBox(k ? GLOW.green : GLOW.amber, x - 0.25, x + 0.25, PY, PY + 0.4, z - 0.25, z + 0.25);
  }
  for (const [a, b] of [[[PX0, PZ0], [PX1, PZ0]], [[PX0, PZ0], [PX0, PZ1]], [[PX1, PZ0], [PX1, PZ1]]]) {
    K.rod('trim', 0xe2b23a, [a[0], PY + 1.1, a[1]], [b[0], PY + 1.1, b[1]], 0.06, { sides: 6 });
    const n = 6;
    for (let i = 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n; const z = a[1] + (b[1] - a[1]) * i / n; K.rod('trim', 0xe2b23a, [x, PY - 0.1, z], [x, PY + 1.1, z], 0.05, { sides: 6 }); }
  }
  for (let k = 0; k < 5; k++) K.box('trim', DARKSTEEL, 16.5 + k * 0.0, 20, ROOF + k * 0.48, ROOF + k * 0.48 + 0.12, -6 - k * 0.8, -5.2 - k * 0.8, { flat: true });
  K.rod('trim', 0xd9d9d9, [24, ROOF + 6, -30], [24, ROOF + 7.5, -30], 0.1, { sides: 8 });
  K.within(new THREE.Matrix4().makeRotationY(-0.6).setPosition(24, ROOF + 7.1, -30), () => {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.CylinderGeometry(0.75 - i * 0.12, 0.75 - (i + 1) * 0.12, 1.0, 12, 1, true);
      g.rotateZ(-Math.PI / 2 + 0.25);
      g.translate(0.6 + i * 1.0, -0.15 - i * 0.25, 0);
      const both = new THREE.CylinderGeometry(0.75 - i * 0.12, 0.75 - (i + 1) * 0.12, 1.0, 12);
      both.rotateZ(-Math.PI / 2 + 0.25);
      both.translate(0.6 + i * 1.0, -0.15 - i * 0.25, 0);
      K.add('trim', both, i % 2 ? 0xf4f2ee : 0xf07a1a, { flat: true });
    }
  });
  // air handling on the roof, clear of the pad
  K.box('trim', 0xb9bcbf, 19, 28, ROOF, ROOF + 6, -38, -26, { flat: true });
  for (let z = -37.5; z < -26.2; z += 0.6) K.box('trim', 0x7d8186, 18.92, 19, ROOF + 1, ROOF + 5, z, z + 0.3, { flat: true });
  for (const z of [-34, -30]) K.rod('trim', 0x3a3a3a, [23.5, ROOF + 6, z], [23.5, ROOF + 6.4, z], 1.5, { sides: 16 });
  return K.finish();
}

// A balustrade along a run from a to b (world x/z) at height y: plinth, turned balusters, rail.
function balustrade(K, a, b, y, color, { h = 2.6, step = 0.9 } = {}) {
  const dx = b[0] - a[0]; const dz = b[1] - a[1]; const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(a[0], 0, a[1]);
  K.within(m, () => {
    K.box('trim', color, -0.5, 0.5, y, y + 0.35, 0, len);
    K.box('trim', color, -0.55, 0.55, y + h - 0.35, y + h, 0, len);
    const n = Math.max(2, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const z = (len * (i + 0.5)) / n;
      const prof = [[0, 0], [0.26, 0], [0.26, 0.12], [0.16, 0.28], [0.3, 0.9], [0.14, 1.45], [0.22, 1.6], [0.22, 1.7], [0, 1.7]].map(([r, hh]) => new THREE.Vector2(r, hh * (h - 0.7) / 1.7));
      const g = new THREE.LatheGeometry(prof, 8);
      g.translate(0, y + 0.35, z);
      K.add('trim', g, color);
    }
  });
}

function drawSeal(ctx, x, y, w, h) {
  const cx = x + w / 2; const cy = y + h / 2; const R = w / 2;
  ctx.fillStyle = '#cfc4a8'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#1f3a66'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.96, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#e2b23a'; ctx.lineWidth = R * 0.06;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#e2b23a';
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 - Math.PI / 2;
    const sx = cx + Math.cos(a) * R * 0.72; const sy = cy + Math.sin(a) * R * 0.72;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const aa = -Math.PI / 2 + (k * Math.PI) / 5; const rr = k % 2 ? R * 0.028 : R * 0.07; ctx.lineTo(sx + rr * Math.cos(aa), sy + rr * Math.sin(aa)); }
    ctx.closePath(); ctx.fill();
  }
  // a little civic building in the middle: steps, columns, a pediment
  ctx.fillRect(cx - R * 0.34, cy + R * 0.2, R * 0.68, R * 0.09);
  for (let i = 0; i < 4; i++) ctx.fillRect(cx - R * 0.28 + i * R * 0.17, cy - R * 0.14, R * 0.07, R * 0.34);
  ctx.beginPath(); ctx.moveTo(cx - R * 0.36, cy - R * 0.14); ctx.lineTo(cx + R * 0.36, cy - R * 0.14); ctx.lineTo(cx, cy - R * 0.36); ctx.closePath(); ctx.fill();
}

// ---------------------------------------------------------------------------------------------
// CITY HALL. A stone hall 60ft wide on a rusticated base, a six-column portico over wide steps,
// a clock tower with four faces to 70ft, and two flags. 60 x 60, centred on the origin.
// ---------------------------------------------------------------------------------------------
function cityHall() {
  const K = new Kit({ seed: 404, wall: 'stone' });
  const STONE = 0xd2c7ad; const BASE = 0xb3a88f; const TRIM = 0xe2d9c3; const COPPER = 0x5f9e86; const BRONZE = 0x4d3b2a;
  const HW = 30; const Z0 = -30; const Z1 = 8; const CZ = (Z0 + Z1) / 2; const HD = (Z1 - Z0) / 2;
  const POD = 4.5; const EAVE = 26.5; const COR = 31.2;

  // --- the body ---
  K.box('wall', STONE, -HW, HW, -0.4, COR, Z0, Z1);
  K.within(new THREE.Matrix4().makeTranslation(0, 0, CZ), () => {
    K.ring('wall', BASE, HW, HD, -0.4, POD, 0.35);
    for (let y = 1.1; y < POD; y += 1.1) K.ring('trim', times(BASE, 0.72), HW, HD, y - 0.05, y + 0.05, 0.37, 0.1, { flat: true });
    K.ring('trim', TRIM, HW, HD, POD, POD + 0.5, 0.45);
    K.ring('trim', TRIM, HW, HD, EAVE - 0.2, EAVE + 0.7, 0.12);
    K.ring('trim', TRIM, HW, HD, 29.5, 30.0, 0.25);
    K.cornice(TRIM, HW, HD, 30.0, { steps: [[0.4, 0.45], [0.4, 0.8], [0.4, 1.0]] });
    K.box('trim', PALETTE.roofTar, -HW + 1, HW - 1, COR - 0.1, COR + 0.15, -HD + 1, HD - 1);
    // pilasters at the corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      K.box('trim', TRIM, sx * HW - (sx > 0 ? 2.2 : -0.0), sx * HW + (sx > 0 ? 0.0 : 2.2) * -1 + (sx > 0 ? 0 : 0), POD + 0.5, EAVE - 0.2, sz * HD, sz * (HD + 0.25));
      K.box('trim', TRIM, sx * HW, sx * (HW + 0.25), POD + 0.5, EAVE - 0.2, sz * (HD - 2.2), sz * HD);
    }
  });
  // balustrade round the roof
  const by = COR + 0.0;
  // a balustrade where the street sees it, a plain stone parapet elsewhere
  K.box('trim', TRIM, -HW, -HW + 1.1, by, by + 2.6, Z0, Z1 - 1.2);
  K.box('trim', TRIM, HW - 1.1, HW, by, by + 2.6, Z0, Z1 - 1.2);
  K.box('trim', TRIM, -HW + 1.1, HW - 1.1, by, by + 2.6, Z0, Z0 + 1.1);
  balustrade(K, [-HW + 0.6, Z1 - 0.6], [-15.5, Z1 - 0.6], by, TRIM);
  balustrade(K, [15.5, Z1 - 0.6], [HW - 0.6, Z1 - 0.6], by, TRIM);

  // --- windows all round, with hoods ---
  const tall = (u) => {
    K.window(u, POD + 3.0, 3.6, 8.6, { cols: 2, rows: 3, sill: TRIM, lintel: TRIM, keystone: true, frame: 0xf0ece2, surround: 0.4, surroundColor: TRIM });
    K.box('trim', TRIM, u - 2.6, u + 2.6, POD + 12.4, POD + 12.9, 0, 0.55);
    K.window(u, 17.6, 3.6, 6.6, { cols: 2, rows: 2, sill: TRIM, lintel: TRIM, keystone: true, frame: 0xf0ece2, surround: 0.4, surroundColor: TRIM });
    K.window(u, 1.3, 2.6, 2.1, { cols: 2, rows: 1, sill: null, lintel: null, frame: 0x8a8070 });
  };
  K.on('+z', Z1, () => { for (const u of [-25, -19.5, 19.5, 25]) tall(u); });
  K.on('-z', -Z0, () => { for (const u of [-24, -16, -8, 0, 8, 16, 24]) tall(u); });
  K.on('+x', HW, () => { for (const u of [-4, 3, 10, 17, 24]) tall(u); });
  K.on('-x', HW, () => { for (const u of [-24, -17, -10, -3, 4]) tall(u); });

  // --- the portico: a podium, six columns, an entablature with the name, a pediment ---
  const PX = 15.5; const PZ1 = 18;
  K.box('wall', BASE, -PX, PX, -0.4, POD, Z1, PZ1);
  K.box('trim', TRIM, -PX - 0.3, PX + 0.3, POD - 0.3, POD + 0.1, Z1, PZ1 + 0.3);
  K.box('trim', 0xcfc6b2, -PX + 0.3, PX - 0.3, POD + 0.1, POD + 0.14, Z1, PZ1 - 0.2, { flat: true });
  for (let i = 0; i < 6; i++) K.column(-12.5 + i * 5, POD + 0.1, 16.2, EAVE - POD - 0.1, 1.05, TRIM, { capital: 'ionic' });
  K.box('trim', TRIM, -PX, PX, EAVE, 27.5, Z1, PZ1);
  K.box('trim', STONE, -PX, PX, 27.5, 29.6, Z1, PZ1 - 0.15);
  K.box('trim', TRIM, -PX - 0.25, PX + 0.25, 29.6, COR, Z1, PZ1 + 0.4);
  K.on('+z', PZ1 - 0.15, () => K.sign('CITY HALL', 0, 28.55, 19, 1.9, { bg: '#d6ccb2', fg: '#3b3226', depth: 0.1, edge: STONE, letter: 1, size: 0.8 }));
  // the coffered ceiling of the portico, lit faintly
  K.glowGeom(new THREE.BoxGeometry(2 * PX - 1, 0.1, PZ1 - Z1 - 3.4).translate(0, EAVE - 0.05, Z1 + (PZ1 - Z1 - 3.4) / 2), GLOW.ceiling);
  // pediment: tympanum, raking cornices, the city seal
  const PH = 6.0;
  K.on('+z', 0, () => {
    K.extrude('wall', STONE, [[-PX + 0.6, COR], [PX - 0.6, COR], [0, COR + PH - 0.5]], Z1, PZ1 - 0.3);
  });
  const slope = Math.atan2(PH, PX);
  const rl = Math.hypot(PX + 0.5, PH);
  for (const sx of [-1, 1]) {
    const m = new THREE.Matrix4().makeRotationZ(-sx * slope).setPosition(sx * (PX + 0.5) / 2, COR + PH / 2 + 0.25, (Z1 + PZ1) / 2 + 0.1);
    K.boxAt('trim', TRIM, rl + 0.4, 0.9, PZ1 - Z1 + 0.6, m);
  }
  const seal = K.rect(220, 220, drawSeal);
  K.on('+z', PZ1 - 0.3, () => K.disc(seal, 0, COR + 2.3, 0, 0.18, 1.7, { edge: 0xe2b23a }));

  // --- the doors under the portico, and windows over them ---
  K.on('+z', Z1, () => {
    K.door(0, POD + 0.1, 5.4, 10.5, { color: BRONZE, leaves: 2, glassTop: 0.3, frame: TRIM, handle: BRASS });
    K.box('trim', TRIM, -3.6, 3.6, POD + 11.2, POD + 11.8, 0, 0.6);
    for (const u of [-8, 8]) K.door(u, POD + 0.1, 3.6, 9.0, { color: BRONZE, glassTop: 0.3, frame: TRIM, handle: BRASS });
    for (const u of [-8, 0, 8]) K.window(u, 17.6, 3.4, 6.4, { cols: 2, rows: 2, sill: TRIM, lintel: TRIM, keystone: true, frame: 0xf0ece2 });
  });
  // lamps on the column bases either side of the main door
  for (const x of [-4.8, 4.8]) {
    K.rod('trim', 0x2b2b2b, [x, POD + 0.1, 12], [x, POD + 7.5, 12], 0.12, { sides: 8 });
    K.ball('glow', 0xffffff, x, POD + 8.1, 12, 0.55, { glow: GLOW.warm });
  }

  // --- the steps, with stone cheek walls and lamp standards ---
  const S0 = PZ1; const N = 9; const T = 1.0;
  for (let k = 0; k < N; k++) {
    const top = POD - 0.5 * (k + 1) + 0.0;
    K.box('trim', 0xc9c0ab, -17, 17, -0.4, top + 0.0 + (k === 0 ? 0 : 0), S0 + k * T, S0 + (k + 1) * T);
  }
  for (const sx of [-1, 1]) {
    K.on(sx > 0 ? '+x' : '-x', 17, () => {
      const zz = (z) => (sx > 0 ? -z : z);
      K.extrude('wall', BASE, [[zz(S0), -0.4], [zz(S0 + N * T - 1.2), -0.4], [zz(S0 + N * T - 1.2), 1.6], [zz(S0), POD + 0.9]], 0, 2.4);
    });
    const px = sx * 18.2; const pz = S0 + N * T - 0.6;
    K.box('trim', BASE, px - 1.4, px + 1.4, -0.4, 3.2, pz - 1.4, pz + 1.4);
    K.box('trim', TRIM, px - 1.6, px + 1.6, 3.2, 3.6, pz - 1.6, pz + 1.6);
    K.rod('trim', 0x2b2b2b, [px, 3.6, pz], [px, 9.5, pz], 0.16, { r2: 0.1, sides: 10 });
    for (const [dx, dz] of [[-0.8, 0], [0.8, 0], [0, 0]]) K.ball('glow', 0xffffff, px + dx, 10.1 + (dx === 0 ? 0.6 : 0), pz + dz, 0.45, { glow: GLOW.warm });
    K.rod('trim', 0x2b2b2b, [px - 0.8, 9.6, pz], [px + 0.8, 9.6, pz], 0.06, { sides: 6 });
  }
  // a plaza in front of the steps, and the two flags
  K.box('trim', PALETTE.concrete, -HW, HW, -0.4, 0.06, S0 + N * T, 30);
  K.box('trim', PALETTE.concrete, -HW, -17 - 2.4, -0.4, 0.06, Z1, S0 + N * T);
  K.box('trim', PALETTE.concrete, 17 + 2.4, HW, -0.4, 0.06, Z1, S0 + N * T);
  K.flagpole(-24, 25, 34, drawUSFlag);
  K.flagpole(24, 25, 34, drawCityFlag, { yaw: Math.PI });

  // --- the clock tower, rising to 70ft ---
  const TZ = -9; const TH = 7;
  K.within(new THREE.Matrix4().makeTranslation(0, 0, TZ), () => {
    K.box('wall', STONE, -TH, TH, COR - 1, 46, -TH, TH);
    K.ring('trim', TRIM, TH, TH, COR + 2.6, COR + 3.1, 0.15);
    K.cornice(TRIM, TH, TH, 45.4, { steps: [[0.4, 0.25], [0.4, 0.55], [0.3, 0.8]] });
    // the clock stage, a little narrower, with pilasters at its corners
    const CH = 6.2;
    K.box('wall', STONE, -CH, CH, 46.5, 56.4, -CH, CH);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box('trim', TRIM, sx * CH - 0.9, sx * CH + 0.9, 46.5, 56.4, sz * CH - 0.9, sz * CH + 0.9);
    K.cornice(TRIM, CH, CH, 56.4, { steps: [[0.4, 0.35], [0.4, 0.7], [0.3, 1.0]] });
    // an open drum and a copper dome with a lantern on top
    K.box('trim', TRIM, -4.6, 4.6, 57.5, 58.0, -4.6, 4.6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      K.rod('trim', TRIM, [Math.sin(a) * 3.8, 58, Math.cos(a) * 3.8], [Math.sin(a) * 3.8, 62.2, Math.cos(a) * 3.8], 0.42, { sides: 10, flat: false });
    }
    K.rod('trim', 0x3a3530, [0, 58, 0], [0, 62.2, 0], 2.9, { sides: 16 });
    K.rod('trim', TRIM, [0, 62.2, 0], [0, 62.9, 0], 4.5, { sides: 24, flat: false });
    const dome = [[0, 0], [4.1, 0], [4.0, 0.9], [3.6, 2.2], [2.8, 3.5], [1.7, 4.4], [0.6, 4.85], [0, 4.9]];
    const g = new THREE.LatheGeometry(dome.map(([r, h]) => new THREE.Vector2(r, h)), 24);
    g.translate(0, 62.9, 0);
    K.add('trim', g, COPPER);
    K.rod('trim', TRIM, [0, 67.5, 0], [0, 69.0, 0], 0.55, { sides: 10 });
    K.ball('trim', BRASS, 0, 69.3, 0, 0.35);
    K.rod('trim', BRASS, [0, 69.3, 0], [0, 70.0, 0], 0.06, { sides: 6 });
  });
  const clock = K.rect(256, 256, (ctx, x, y, w, h) => drawClock(ctx, x, y, w, h, { rim: '#3a3226' }));
  K.on('+z', TZ + 6.2, () => K.disc(clock, 0, 51.4, 0, 0.25, 3.3, { edge: 0x3a3226 }));
  K.on('-z', -TZ + 6.2, () => K.disc(clock, 0, 51.4, 0, 0.25, 3.3, { edge: 0x3a3226 }));
  K.on('+x', 6.2, () => K.disc(clock, -TZ, 51.4, 0, 0.25, 3.3, { edge: 0x3a3226 }));
  K.on('-x', 6.2, () => K.disc(clock, TZ, 51.4, 0, 0.25, 3.3, { edge: 0x3a3226 }));
  for (const [side, plane, u] of [['+z', TZ + 6.2, 0], ['-z', -TZ + 6.2, 0], ['+x', 6.2, -TZ], ['-x', 6.2, TZ]]) {
    K.on(side, plane, () => {
      const ring = []; const inner = [];
      for (let i = 0; i <= 32; i++) { const a = (i / 32) * Math.PI * 2; ring.push([u + Math.cos(a) * 3.9, 51.4 + Math.sin(a) * 3.9]); inner.push([u + Math.cos(-a) * 3.3, 51.4 + Math.sin(-a) * 3.3]); }
      K.extrude('trim', TRIM, [...ring, ...inner], 0, 0.35);
      K.window(u, 41, 2.4, 3.2, { cols: 1, rows: 2, sill: TRIM, lintel: TRIM });
    });
  }
  return K.finish();
}

// A bookcase standing on the floor, its front toward local +z, centred on x = 0, back at z = 0.
function bookcase(K, w, h, d, shelves, books, wood = 0x6e4f33) {
  K.box('trim', wood, -w / 2, -w / 2 + 0.15, 0.15, h, 0, d);
  K.box('trim', wood, w / 2 - 0.15, w / 2, 0.15, h, 0, d);
  K.box('trim', wood, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.2, 0, d + 0.12);
  K.box('trim', times(wood, 0.7), -w / 2 + 0.15, w / 2 - 0.15, 0.15, h, 0, 0.08);
  K.box('trim', wood, -w / 2, w / 2, 0.15, 0.55, 0, d);
  const gap = (h - 0.55) / shelves;
  for (let i = 0; i < shelves; i++) {
    const y = 0.55 + i * gap;
    if (i) K.box('trim', wood, -w / 2 + 0.15, w / 2 - 0.15, y - 0.08, y, 0, d);
    const r = books[i % books.length];
    K.decalBox(r, -w / 2 + 0.2, w / 2 - 0.2, y, y + gap * 0.86, 0.1, d - 0.12, { edge: 0x3a2a1d });
  }
}

function bankersLamp(K, x, y, z) {
  K.rod('trim', BRASS, [x, y, z], [x, y + 0.08, z], 0.32, { sides: 12 });
  K.rod('trim', BRASS, [x, y, z], [x, y + 1.05, z], 0.05, { sides: 6 });
  const shade = new THREE.CylinderGeometry(0.2, 0.36, 0.3, 12);
  shade.scale(1.6, 1, 1);
  shade.translate(x, y + 1.15, z + 0.12);
  K.glowGeom(shade, GLOW.shade);
  K.glowBox(GLOW.warm, x - 0.4, x + 0.4, y + 0.98, y + 1.01, z - 0.12, z + 0.36);
}

// ---------------------------------------------------------------------------------------------
// PUBLIC LIBRARY. A limestone library 50 x 34ft, tall arched windows, a columned porch over four
// steps, and a real doorway into a reading room 47 x 30ft with a floor at ground level (three steps
// down from the threshold), bookcases, two reading tables with lamps, a desk and a globe.
// ---------------------------------------------------------------------------------------------
function publicLibrary() {
  const K = new Kit({ seed: 505, wall: 'stone' });
  const STONE = 0xd6cbb1; const BASE = 0xbcb197; const TRIM = 0xe6ddc8; const PLASTER = 0xe7dfcc; const OAK = 0x8a6440; const WOOD = 0x6e4f33;
  const X = 25; const ZB = -20; const ZF = 13.5; const WALLTOP = 22.4; const CEIL = 20.5;
  const DOOR = { u0: -3, u1: 3, y0: 1.2, y1: 10 };

  // --- walls: stone outside, plaster inside ---
  K.wallWithHoles('wall', STONE, -X, X, -0.4, WALLTOP, ZF - 1, ZF, [DOOR]);
  K.wallWithHoles('wall', PLASTER, -X + 1, X - 1, 0.15, CEIL, ZF - 1.5, ZF - 1, [DOOR]);
  K.box('wall', STONE, -X, X, -0.4, WALLTOP, ZB, ZB + 1);
  K.box('wall', PLASTER, -X + 1, X - 1, 0.15, CEIL, ZB + 1, ZB + 1.5);
  for (const sx of [-1, 1]) {
    K.box('wall', STONE, sx * (X - 1), sx * X, -0.4, WALLTOP, ZB + 1, ZF - 1);
    K.box('wall', PLASTER, sx * (X - 1.5), sx * (X - 1), 0.15, CEIL, ZB + 1.5, ZF - 1.5);
  }
  // the room: an oak floor, a dark wainscot, a ceiling with a faint glow, the roof above it
  K.box('trim', OAK, -X + 1, X - 1, -0.4, 0.15, ZB + 1, ZF - 1);
  for (let x = -X + 2.5; x < X - 1; x += 1.5) K.box('trim', times(OAK, 0.8), x - 0.02, x + 0.02, 0.15, 0.16, ZB + 1.5, ZF - 1.5, { flat: true });
  K.within(new THREE.Matrix4().makeTranslation(0, 0, (ZB + ZF) / 2), () => K.ring('trim', WOOD, X - 1.5, (ZF - ZB) / 2 - 1.5, 0.15, 3.4, 0, 0.12, { flat: true, frontGap: [-3, 3] }));
  K.glowBox(GLOW.ceiling, -X + 1, X - 1, CEIL, CEIL + 0.3, ZB + 1, ZF - 1);
  K.box('trim', 0xb3ab98, -X + 1, X - 1, CEIL + 0.3, WALLTOP, ZB + 1, ZF - 1);
  K.box('trim', PALETTE.roofTar, -X + 1, X - 1, WALLTOP, WALLTOP + 0.12, ZB + 1, ZF - 1);
  // the threshold is the wall's own bottom; three steps go down from it into the room
  K.box('trim', 0xc9c0ab, -3.5, 3.5, -0.4, 0.85, ZF - 2.35, ZF - 1.5);
  K.box('trim', 0xc9c0ab, -3.5, 3.5, -0.4, 0.5, ZF - 3.2, ZF - 2.35);
  // both door leaves swung right back against the inside of the wall
  for (const sx of [-1, 1]) {
    K.within(new THREE.Matrix4().makeTranslation(sx * 4.6, 0, ZF - 1.65), () => {
      K.box('trim', 0x5a3c26, -1.5, 1.5, 1.2, 10, -0.15, 0.0, { flat: true });
      K.box('trim', 0x6e4c30, -1.15, 1.15, 1.6, 5.2, -0.2, -0.15, { flat: true });
      K.pane(-1.15, 1.15, 5.8, 9.5, -0.2, -0.15);
    });
  }

  // --- outside: rusticated base, cornice, parapet ---
  const CZ = (ZB + ZF) / 2; const HD = (ZF - ZB) / 2;
  K.box('wall', BASE, -X - 0.25, -8.5, -0.4, 3.2, ZF, ZF + 0.25);
  K.box('wall', BASE, 8.5, X + 0.25, -0.4, 3.2, ZF, ZF + 0.25);
  K.box('wall', BASE, -X - 0.25, X + 0.25, -0.4, 3.2, ZB - 0.25, ZB);
  for (const sx of [-1, 1]) K.box('wall', BASE, sx * X, sx * (X + 0.25), -0.4, 3.2, ZB, ZF);
  for (const y of [1.0, 2.1]) {
    K.box('trim', times(BASE, 0.7), -X - 0.27, -8.5, y - 0.04, y + 0.04, ZF + 0.2, ZF + 0.27, { flat: true });
    K.box('trim', times(BASE, 0.7), 8.5, X + 0.27, y - 0.04, y + 0.04, ZF + 0.2, ZF + 0.27, { flat: true });
  }
  K.within(new THREE.Matrix4().makeTranslation(0, 0, CZ), () => {
    K.ring('trim', TRIM, X, HD, 3.2, 3.7, 0.35, 0.4, { frontGap: [-3.7, 3.7] });
    K.ring('trim', TRIM, X, HD, 19.4, 20.0, 0.12);
    K.ring('trim', STONE, X, HD, 20.0, 21.6, 0.05, 0.5);
    K.cornice(TRIM, X, HD, 21.6, { steps: [[0.35, 0.35], [0.35, 0.7], [0.4, 0.95]] });
    K.ring('wall', STONE, X, HD, 22.7, 24.4, 0, 0.9);
    K.ring('trim', TRIM, X, HD, 24.4, 24.75, 0.15, 1.05);
  });

  // --- tall arched windows, outside and in ---
  const archOut = (u) => K.window(u, 4.4, 4.4, 13.6, { arch: true, cols: 2, rows: 3, sill: TRIM, lintel: TRIM, frame: 0xf0ece2 });
  const archIn = (u) => K.window(u, 4.4, 4.4, 13.6, { arch: true, cols: 2, rows: 3, sill: OAK, lintel: null, frame: 0xf3efe5 });
  K.on('+z', ZF, () => { for (const u of [-19, -12.5, 12.5, 19]) archOut(u); });
  K.on('-z', -(ZF - 1.5), () => { for (const u of [-19, -12.5, 12.5, 19]) archIn(u); });
  K.on('+x', X, () => { for (const u of [-9, -1, 7, 15]) archOut(u); });
  K.on('-x', X, () => { for (const u of [-15, -7, 1, 9]) archOut(u); });
  K.on('-x', -(X - 1.5), () => { for (const u of [-15, -7, 1, 9]) archIn(u); });
  K.on('+x', -(X - 1.5), () => { for (const u of [-9, -1, 7, 15]) archIn(u); });
  K.on('-z', -ZB, () => { for (const u of [-15, -5, 5, 15]) K.window(u, 12, 3.6, 5.2, { cols: 2, rows: 2, sill: TRIM, lintel: TRIM }); });

  // --- the porch: landing, four steps, two columns, entablature with the name, pediment ---
  K.box('wall', BASE, -8.5, 8.5, -0.4, 1.2, ZF, 16.6);
  K.box('trim', TRIM, -8.7, 8.7, 0.95, 1.25, ZF, 16.8);
  for (let k = 0; k < 3; k++) K.box('trim', 0xc9c0ab, -7, 7, -0.4, 0.9 - 0.3 * k, 16.6 + k * 0.85, 16.6 + (k + 1) * 0.85);
  K.box('trim', PALETTE.concrete, -X, X, -0.4, 0.05, 19.15, 20);
  K.box('trim', PALETTE.concrete, -X, -8.5, -0.4, 0.05, ZF + 0.25, 19.15);
  K.box('trim', PALETTE.concrete, 8.5, X, -0.4, 0.05, ZF + 0.25, 19.15);
  for (const sx of [-1, 1]) {
    K.box('wall', BASE, sx * 7, sx * 8.5, -0.4, 2.4, 16.6, 19.3);
    K.box('trim', TRIM, sx * 6.85, sx * 8.65, 2.4, 2.7, 16.45, 19.45);
    K.rod('trim', 0x2b2b2b, [sx * 7.75, 2.7, 18.2], [sx * 7.75, 7.2, 18.2], 0.12, { sides: 8 });
    K.ball('glow', 0xffffff, sx * 7.75, 7.75, 18.2, 0.55, { glow: GLOW.warm, w: 16, h: 12 });
    K.column(sx * 5.2, 1.25, 15.4, 19.0 - 1.25, 0.8, TRIM, { capital: 'ionic' });
  }
  K.box('trim', TRIM, -8.8, 8.8, 19.0, 19.8, ZF, 16.5);
  K.box('trim', STONE, -8.8, 8.8, 19.8, 21.6, ZF, 16.35);
  K.box('trim', TRIM, -9.1, 9.1, 21.6, 22.5, ZF, 16.8);
  K.on('+z', 16.35, () => K.sign('PUBLIC LIBRARY', 0, 20.7, 16, 1.5, { bg: '#d8ceb5', fg: '#3b3226', depth: 0.1, edge: STONE, letter: 1, size: 0.74 }));
  K.on('+z', 0, () => K.extrude('wall', STONE, [[-8.6, 22.5], [8.6, 22.5], [0, 26.3]], ZF, 16.55));
  const sl = Math.atan2(3.8, 8.6); const rl = Math.hypot(9.3, 3.8);
  for (const sx of [-1, 1]) K.boxAt('trim', TRIM, rl, 0.7, 16.8 - ZF + 0.3, new THREE.Matrix4().makeRotationZ(-sx * sl).setPosition(sx * 4.55, 24.55, (ZF + 16.8) / 2 + 0.05));
  K.glowGeom(new THREE.BoxGeometry(16.6, 0.08, 2.8).translate(0, 18.96, ZF + 1.45), GLOW.ceiling);
  // the doorway's stone frame and the fanlight over it
  K.on('+z', ZF, () => {
    K.box('trim', TRIM, -3.7, -3, 1.2, 10.7, 0, 0.35);
    K.box('trim', TRIM, 3, 3.7, 1.2, 10.7, 0, 0.35);
    K.box('trim', TRIM, -3.7, 3.7, 10, 10.7, 0, 0.35);
    K.window(0, 10.7, 6, 3.2, { arch: true, cols: 4, rows: 1, sill: null, lintel: TRIM, frame: 0xf0ece2 });
  });

  // --- the book drop, beside the steps ---
  K.within(new THREE.Matrix4().makeTranslation(11.5, 0, 17.6), () => {
    K.box('trim', PALETTE.concrete, -1.8, 1.8, 0.05, 0.35, -1.6, 1.6);
    K.box('trim', 0x2f5f8a, -1.2, 1.2, 0.35, 3.6, -1.0, 1.0, { flat: true });
    const arc = [];
    for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; arc.push([Math.cos(a) * 1.0, 3.6 + Math.sin(a) * 1.0]); }
    K.on('+x', -1.2, () => K.extrude('trim', 0x2f5f8a, arc, 0, 2.4, { flat: true }));
    K.box('trim', 0x26496b, -1.25, 1.25, 0.35, 0.6, -1.05, 1.05, { flat: true });
    K.box('trim', 0x1b2a38, -0.85, 0.85, 3.05, 3.25, 0.98, 1.06, { flat: true });
    K.box('trim', 0x9aa4ae, -1.0, 1.0, 3.3, 3.45, 0.95, 1.3, { flat: true });
    K.sign('BOOK RETURN', 0, 2.3, 2.0, 0.6, { bg: '#f2efe6', fg: '#1d3550', family: 'Arial, Helvetica, sans-serif', n0: 1.0, depth: 0.06 });
  });

  // --- inside: bookcases, tables, lamps, a desk, a globe ---
  const books = [K.rect(512, 72, drawBooks(11)), K.rect(512, 72, drawBooks(23)), K.rect(512, 72, drawBooks(37))];
  for (let i = 0; i < 5; i++) {
    const x = -20 + i * 10;
    K.within(new THREE.Matrix4().makeTranslation(x, 0, ZB + 1.5), () => bookcase(K, 9.6, 9.5, 1.6, 6, books, WOOD));
  }
  for (const sx of [-1, 1]) for (const z of [-15, -7, 1, 9]) {
    const yaw = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    K.within(new THREE.Matrix4().makeRotationY(yaw).setPosition(sx * (X - 1.5), 0, z), () => bookcase(K, 5.4, 3.9, 1.3, 3, books, WOOD));
  }
  // two long reading tables with chairs and green lamps, on a rug
  K.box('trim', 0x7c2b2b, -14, 14, 0.15, 0.19, -10, 2, { flat: true });
  K.box('trim', 0xc9a25a, -13.6, 13.6, 0.19, 0.2, -9.6, -9.3, { flat: true });
  K.box('trim', 0xc9a25a, -13.6, 13.6, 0.19, 0.2, 1.3, 1.6, { flat: true });
  for (const cx of [-6.5, 6.5]) {
    table(K, cx - 4.5, cx + 4.5, -5.5, -2.3, 2.6, 0x7a5636, 0x5a3c26);
    for (const dx of [-3, 0, 3]) { chair(K, cx + dx, -6.4, 0, 0x6b4a30); chair(K, cx + dx, -1.4, Math.PI, 0x6b4a30); }
    bankersLamp(K, cx - 2.2, 2.6, -3.9);
    bankersLamp(K, cx + 2.2, 2.6, -3.9);
    for (let k = 0; k < 3; k++) K.box('trim', [0x7a2b25, 0x24456b, 0x2f5a37][k], cx - 0.9 + k * 0.6, cx - 0.4 + k * 0.6, 2.6, 2.75, -3.4, -2.7, { flat: true });
  }
  // the circulation desk, with a computer, to the right as you come in
  K.box('trim', WOOD, 10, 19, 0.15, 3.6, 5.5, 7.5);
  K.box('trim', OAK, 9.8, 19.2, 3.6, 3.78, 5.3, 7.9);
  K.box('trim', 0x2a2a2c, 13.5, 15.5, 3.78, 5.2, 5.8, 6.0, { flat: true });
  K.glowBox(GLOW.cool, 13.65, 15.35, 3.95, 5.05, 6.0, 6.03);
  K.box('trim', 0x2a2a2c, 14.3, 14.7, 3.78, 4.0, 5.9, 6.4, { flat: true });
  chair(K, 14.5, 4.4, 0, 0x2f5a8a);
  // a globe on a stand
  K.rod('trim', WOOD, [-16, 0.15, 6.5], [-16, 3.3, 6.5], 0.12, { sides: 8 });
  K.rod('trim', WOOD, [-16, 0.15, 6.5], [-16, 0.35, 6.5], 1.0, { sides: 12 });
  const globe = K.rect(256, 128, (ctx, x, y, w, h) => {
    ctx.fillStyle = '#3f74a8'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8aa65a';
    for (const [ex, ey, rx, ry] of [[0.18, 0.32, 0.07, 0.14], [0.27, 0.66, 0.04, 0.16], [0.5, 0.3, 0.06, 0.08], [0.53, 0.58, 0.06, 0.16], [0.72, 0.32, 0.13, 0.12], [0.83, 0.68, 0.05, 0.05]]) {
      ctx.beginPath(); ctx.ellipse(x + ex * w, y + ey * h, rx * w, ry * h, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
  const gs = new THREE.SphereGeometry(1.1, 20, 14);
  gs.translate(-16, 4.4, 6.5);
  const P = gs.attributes.position; const UV = gs.attributes.uv;
  for (let i = 0; i < UV.count; i++) UV.setXY(i, globe.u0 + (globe.u1 - globe.u0) * UV.getX(i), globe.v0 + (globe.v1 - globe.v0) * UV.getY(i));
  gs.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P.count * 3).fill(1), 3));
  K.parts.sign.push({ geometry: gs, keepColor: true });
  const meridian = new THREE.TorusGeometry(1.25, 0.06, 6, 24);
  meridian.translate(-16, 4.4, 6.5);
  K.add('trim', meridian, BRASS, { flat: true });
  // pendant lights
  for (const x of [-13, 0, 13]) for (const z of [-11, -2]) {
    K.rod('trim', 0x2b2b2b, [x, CEIL, z], [x, 15.6, z], 0.04, { sides: 4 });
    K.ball('glow', 0xffffff, x, 15.2, z, 0.55, { glow: GLOW.warm });
  }
  K.on('-z', -(ZF - 1.5), () => K.sign('QUIET PLEASE', 0, 11.6, 4.2, 0.8, { bg: '#2d4a3a', fg: '#f2ead2', family: 'Arial, Helvetica, sans-serif', depth: 0.06 }));
  return K.finish();
}

// ---------------------------------------------------------------------------------------------
// ELEMENTARY SCHOOL. Two storeys of brick on a 60 x 32ft plan, 30ft to the parapet, rows of big
// classroom windows, an entrance bay with a clock, a canopy over the doors, and a front walk with
// a flagpole and a hopscotch. 60 x 40, centred on the origin.
// ---------------------------------------------------------------------------------------------
function elementarySchool() {
  const K = new Kit({ seed: 606, wall: 'brick' });
  const BRICK = PALETTE.brickRed; const LIME = PALETTE.limestone; const TRIM = 0xf0ece2; const GREEN = 0x2f6b4f;
  const HW = 30; const Z0 = -20; const Z1 = 12; const F2 = 14; const ROOF = 28.4;
  const CZ = (Z0 + Z1) / 2; const HD = (Z1 - Z0) / 2;

  K.box('wall', BRICK, -HW, HW, -0.4, ROOF, Z0, Z1);
  K.within(new THREE.Matrix4().makeTranslation(0, 0, CZ), () => {
    K.ring('trim', LIME, HW, HD, -0.4, 1.6, 0.15);
    K.ring('trim', LIME, HW, HD, F2 - 0.45, F2 + 0.35, 0.16);
    K.ring('wall', times(BRICK, 0.78), HW, HD, ROOF - 2.0, ROOF - 1.4, 0.12); // a soldier course of darker brick
    K.ring('trim', LIME, HW, HD, ROOF - 0.5, ROOF, 0.25);
    K.ring('wall', BRICK, HW, HD, ROOF, ROOF + 1.5, 0, 0.9);
    K.ring('trim', LIME, HW, HD, ROOF + 1.5, ROOF + 1.85, 0.15, 1.05);
    K.box('trim', PALETTE.roofTar, -HW + 0.8, HW - 0.8, ROOF - 0.2, ROOF + 0.12, -HD + 0.8, HD - 0.8);
  });
  // classroom windows: three tall sashes ganged under one stone lintel
  const classroom = (u, y0) => {
    for (const du of [-3.3, 0, 3.3]) K.window(u + du, y0, 3.0, 8.0, { cols: 2, rows: 3, sill: null, lintel: null, frame: TRIM, fw: 0.2 });
    K.box('wall', times(BRICK, 0.9), u - 1.95, u - 1.35, y0, y0 + 8, 0, 0.06);
    K.box('wall', times(BRICK, 0.9), u + 1.35, u + 1.95, y0, y0 + 8, 0, 0.06);
    K.box('trim', LIME, u - 5.4, u + 5.4, y0 - 0.35, y0, 0, 0.45);
    K.box('trim', LIME, u - 5.4, u + 5.4, y0 + 8, y0 + 8.7, 0, 0.22);
  };
  K.on('+z', Z1, () => { for (const u of [-23.5, -13, 13, 23.5]) { classroom(u, 3.0); classroom(u, F2 + 3.0); } });
  K.on('-z', -Z0, () => { for (const u of [-22, -8, 8, 22]) { classroom(u, 3.0); classroom(u, F2 + 3.0); } });
  K.on('+x', HW, () => { classroom(-5, 3.0); classroom(-5, F2 + 3.0); classroom(9, F2 + 3.0); K.door(10, 0.08, 3.4, 7.6, { color: GREEN, glassTop: 0.4 }); });
  K.on('-x', HW, () => { classroom(5, 3.0); classroom(5, F2 + 3.0); classroom(-9, F2 + 3.0); K.door(-10, 0.08, 3.4, 7.6, { color: GREEN, glassTop: 0.4 }); });

  // --- the entrance bay: brick, standing forward and up, with a clock and the name ---
  const BX = 7; const BZ = Z1 + 1.5; const BTOP = ROOF + 3.2;
  K.box('wall', BRICK, -BX, BX, -0.4, BTOP, Z1 - 1, BZ);
  K.box('trim', LIME, -BX - 0.15, BX + 0.15, -0.4, 1.6, Z1, BZ + 0.15);
  K.box('trim', LIME, -BX - 0.15, BX + 0.15, F2 - 0.45, F2 + 0.35, Z1, BZ + 0.16);
  K.box('trim', LIME, -BX - 0.25, BX + 0.25, BTOP, BTOP + 0.4, Z1 - 1, BZ + 0.25);
  // a stepped stone gable on top of the bay
  K.on('+z', 0, () => K.extrude('trim', LIME, [[-4, BTOP + 0.4], [4, BTOP + 0.4], [4, BTOP + 1.1], [2.2, BTOP + 1.1], [2.2, BTOP + 1.7], [-2.2, BTOP + 1.7], [-2.2, BTOP + 1.1], [-4, BTOP + 1.1]], Z1 - 0.6, BZ + 0.1));
  for (const sx of [-1, 1]) for (let y = 1.6, i = 0; y < BTOP - 1; y += 1.15, i++) {
    K.box('trim', LIME, sx * BX - (sx > 0 ? (i % 2 ? 1.0 : 1.6) : -0.12), sx * BX + (sx > 0 ? 0.12 : -(i % 2 ? 1.0 : 1.6)), y, y + 1.05, BZ, BZ + 0.1);
  }
  const clock = K.rect(192, 192, drawClock);
  K.on('+z', BZ, () => {
    // the doors: a pair with a transom and sidelights
    K.box('trim', GREEN, -4.6, 4.6, 0.08, 10.0, 0, 0.08, { flat: true });
    for (const [a, b] of [[-3.4, -0.05], [0.05, 3.4]]) {
      K.box('trim', GREEN, a, b, 0.08, 7.8, 0.08, 0.2, { flat: true });
      K.pane(a + 0.4, b - 0.4, 3.6, 7.4, 0.2, 0.24);
      K.box('trim', times(GREEN, 1.25), a + 0.4, b - 0.4, 0.6, 3.1, 0.2, 0.26, { flat: true });
      K.box('trim', 0xb8bcc0, a + (a < 0 ? 2.4 : 0.4), b - (a < 0 ? 0.4 : 2.4), 3.5, 3.7, 0.2, 0.4, { flat: true });
    }
    K.pane(-3.4, 3.4, 8.1, 9.7, 0.08, 0.14);
    K.box('trim', GREEN, -3.4, 3.4, 7.8, 8.1, 0.08, 0.2, { flat: true });
    for (const u of [-4.2, 4.2]) K.pane(u - 0.4, u + 0.4, 0.6, 9.7, 0.08, 0.14);
    K.sign('ELEMENTARY SCHOOL', 0, 12.4, 12.4, 1.6, { bg: '#d8cdb4', fg: '#2a2f3a', depth: 0.15, letter: 1, size: 0.66, edge: LIME });
    K.window(0, F2 + 3.0, 6.0, 8.0, { cols: 3, rows: 3, sill: LIME, lintel: LIME, keystone: true, frame: TRIM });
    K.disc(clock, 0, 28.7, 0, 0.2, 1.35, { edge: 0x2b2b30 });
    const ring = []; const inner = [];
    for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; ring.push([Math.cos(a) * 1.75, 28.7 + Math.sin(a) * 1.75]); inner.push([Math.cos(-a) * 1.35, 28.7 + Math.sin(-a) * 1.35]); }
    K.extrude('trim', LIME, [...ring, ...inner], 0, 0.3);
  });
  // the canopy over the doors, on two posts
  K.box('trim', 0xe4e0d6, -7.5, 7.5, 10.0, 10.8, BZ, 19.6);
  K.box('trim', GREEN, -7.7, 7.7, 10.0, 11.4, 19.6, 19.85, { flat: true });
  K.box('trim', GREEN, -7.7, -7.5, 10.0, 11.4, BZ, 19.6, { flat: true });
  K.box('trim', GREEN, 7.5, 7.7, 10.0, 11.4, BZ, 19.6, { flat: true });
  for (const x of [-6.6, 6.6]) {
    K.rod('trim', GREEN, [x, 0.08, 18.8], [x, 10.0, 18.8], 0.28, { sides: 10 });
    K.box('trim', LIME, x - 0.6, x + 0.6, 0.08, 0.5, 18.2, 19.4);
  }
  K.glowBox(GLOW.cool, -2.5, 2.5, 9.9, 10.0, 15.5, 17.0);

  // --- the front walk: painted paving with a hopscotch, the flagpole, a bench, a bike rack ---
  const walk = K.rect(1024, 136, (ctx, x, y, w, h) => {
    ctx.fillStyle = '#b4afa5';
    ctx.fillRect(x, y, w, h);
    const rng = K.rng;
    for (let i = 0; i < 2600; i++) { ctx.fillStyle = `rgba(${rng() < 0.5 ? 150 : 205},${rng() < 0.5 ? 146 : 200},${rng() < 0.5 ? 140 : 192},0.35)`; ctx.fillRect(x + rng() * w, y + rng() * h, 1 + rng() * 2, 1 + rng() * 2); }
    ctx.fillStyle = 'rgba(110,106,100,0.8)';
    for (let k = 1; k < 12; k++) ctx.fillRect(x + (k * w) / 12 - 1, y, 2, h);
    ctx.fillRect(x, y + h * 0.5 - 1, w, 2);
    // a chalk hopscotch on the left
    const ftx = w / 60; const fty = h / 8;
    const hx = x + 10.5 * ftx; const sq = 1.5;
    ctx.lineWidth = 3;
    const cells = [[0, 0, '#f4f1e8'], [0, 1, '#ffd36b'], [0, 2, '#f4f1e8'], [-0.5, 3, '#8fd0ff'], [0.5, 3, '#8fd0ff'], [0, 4, '#ff9ab3'], [-0.5, 5, '#b6f08a'], [0.5, 5, '#b6f08a'], [0, 6, '#f4f1e8']];
    ctx.font = `bold ${Math.floor(sq * fty * 0.5)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    cells.forEach(([cx, cy, c], i) => {
      const px = hx + (cy * sq) * ftx * 0.7; const py = y + h - (1 + (cx + 0.5) * sq) * fty * 0.9 - fty * 2.2;
      ctx.strokeStyle = c;
      ctx.strokeRect(px, py, sq * ftx * 0.7, sq * fty * 0.9);
      ctx.fillStyle = c;
      ctx.fillText(String(i + 1), px + sq * ftx * 0.35, py + sq * fty * 0.45);
    });
  });
  K.decalBox(walk, -HW, HW, -0.4, 0.06, Z1, 20, { face: '+y', edge: 0xb4afa5 });
  K.flagpole(17, 17, 30, drawUSFlag);
  K.box('trim', LIME, 15.5, 18.5, 0.06, 0.6, 15.5, 18.5);
  // a bench and a bike rack
  K.within(new THREE.Matrix4().makeTranslation(-13, 0, 17.5), () => {
    for (const lx of [-2.2, 2.2]) K.box('trim', 0x2f3236, lx - 0.1, lx + 0.1, 0.06, 1.5, -0.8, 0.6, { flat: true });
    for (let k = 0; k < 3; k++) K.box('trim', 0x8a6a48, -2.6, 2.6, 1.4, 1.55, -0.75 + k * 0.48, -0.37 + k * 0.48);
    for (let k = 0; k < 2; k++) K.box('trim', 0x8a6a48, -2.6, 2.6, 2.0 + k * 0.5, 2.35 + k * 0.5, -0.82, -0.7);
    K.box('trim', 0x2f3236, -2.3, -2.1, 1.4, 2.9, -0.86, -0.8, { flat: true });
    K.box('trim', 0x2f3236, 2.1, 2.3, 1.4, 2.9, -0.86, -0.8, { flat: true });
  });
  for (let k = 0; k < 5; k++) {
    const x = 22 + k * 1.4;
    const pts = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; pts.push([x, 0.06 + 1.6 + Math.sin(a) * 0.9 - 0.9 * (i === 0 || i === 8 ? 1 : 0), 14.5 + Math.cos(a) * 0.9]); }
    K.rod('trim', 0x9aa0a6, [x, 0.06, 13.6], [x, 1.7, 13.6], 0.06, { sides: 6 });
    K.rod('trim', 0x9aa0a6, [x, 0.06, 15.4], [x, 1.7, 15.4], 0.06, { sides: 6 });
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI - (i / 8) * Math.PI; const a1 = Math.PI - ((i + 1) / 8) * Math.PI;
      K.rod('trim', 0x9aa0a6, [x, 1.7 + Math.sin(a0) * 0.9, 14.5 + Math.cos(a0) * 0.9], [x, 1.7 + Math.sin(a1) * 0.9, 14.5 + Math.cos(a1) * 0.9], 0.06, { sides: 6 });
    }
    void pts;
  }
  // rooftop vents
  for (const x of [-18, 18]) {
    K.box('trim', 0xb9bcbf, x - 2.5, x + 2.5, ROOF, ROOF + 3, -12, -7, { flat: true });
    K.rod('trim', 0x6b6f73, [x, ROOF + 3, -9.5], [x, ROOF + 3.6, -9.5], 1.2, { sides: 14 });
  }
  return K.finish();
}

// ---------------------------------------------------------------------------------------------
function todo() {
  const K = new Kit({ seed: 1 });
  K.box('wall', 0x888888, -10, 10, -0.4, 10, -10, 10);
  return K.finish();
}

export const BUILDERS = {
  'fire-station': fireStation,
  'police-station': policeStation,
  'city-hospital': cityHospital,
  'city-hall': cityHall,
  'public-library': publicLibrary,
  'elementary-school': elementarySchool,
};
