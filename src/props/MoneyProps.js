import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief, wrapLines, taperedTube,
} from '../PropKit.js';
import {
  revolve, solidSurface, extrudeOutline, ball, mergeParts, roundedOutline, put,
} from './LoftKit.js';
import { QUARTER_RADIUS, QUARTER_THICK } from './MoneyModel.js';

// Small Change -- a personal-finance world for high school, played at the scale of a coin.
// The student is shrunk until a quarter is 4.8ft across and is set down on a kitchen table
// covered in the paperwork of a first job: a pay stub, a card, a car key, a phone. Six
// stations, each one a financial model that ships RUNNING as real JavaScript.
//
// SIXTY TIMES is the same ratio A Bug's Life uses, and the same argument: everything here
// is an object a student has handled, so its size is the one thing that does not need a
// placard. A dollar bill is a 31ft rug, a 12-inch ruler a 60ft tower, $100 in quarters a
// 138ft stack -- which is the point of the skyline at the far end of the table.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.
//
// NOTHING HERE IS REAL MONEY OR A REAL BRAND. The coins and the bill are invented: no
// portraits, no treasury seal, no serial number, printed on one side with the word SAMPLE,
// and the phone's offers and its scam text name no real company. A generic bill also
// happens to be easier to read as "a bill" from a coin's height.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const SC = {
  // One accent per STATION, carried by its sign, its boards and its placards -- Fantastic
  // Voyage's one-hue-per-system trick. From across the table a colour is all that resolves.
  earn: '#2f9e5b',
  spend: '#e0812b',
  save: '#1f9d9a',
  credit: '#d3433a',
  risk: '#7a5fd0',
  invest: '#2f6fd6',
};

const COL = {
  nickel: 0xb4b8bc,
  nickelDark: 0x868a8e,
  copper: 0xb0704a,
  paper: 0xf1ede2,
  paperShade: 0xd9d3c4,
  graphite: 0x3a3d42,
  ceramic: 0xe8e2d4,
  ceramicBlue: 0x3f6f9e,
  coffee: 0x3a2214,
  brass: 0xa9894a,
  rubber: 0xc4685a,
  pencil: 0xe0a92e,
  woodPale: 0xd9b98a,
  plastic: 0x23272e,
  plasticLight: 0x3b414b,
  steel: 0x8d9299,
  leaf: 0x79c455,
  leafDark: 0x5aa83f,
  stem: 0x86b257,
  soil: 0x3e2c1f,
  balloon: 0xcf2f2a,
  gold: 0xb8953f,
  green: 0x4f7d57,
};

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// `revolve` decides its winding from the profile's direction, and a profile written the
// way anybody writes one -- bottom up -- comes out INSIDE OUT. Measured in SeattleProps.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON THE AXIS is an open tube.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// Not LoftKit.tube(), which is wound inward (measured, and recorded in CLAUDE.md). Under a
// FrontSide material that reads as a dark surface rather than a missing one.
function tube(points, radii, { tubular = 24, sides = 12 } = {}) {
  return taperedTube(points, radii, { tubularSegments: tubular, radialSegments: sides });
}

const roughMat = (extra = {}) => standard({ vertexColors: true, roughness: 0.75, metalness: 0, ...extra });

// A flat rectangular sheet of paper as a CLOSED thin box, so it has an edge from the side
// and a back from behind rather than vanishing edge-on. `bend(y)` pushes it out of plane
// along its height (a curl), and the groups put the print on the front face only: six
// material slots are what stop the print showing mirrored through the back.
function paperSheet(width, height, thickness, printTexture, { rows = 1, bend = null, paper = COL.paper, emissive = 0.12, printRoughness = 0.85 } = {}) {
  const geometry = threeGroups(new THREE.BoxGeometry(width, height, thickness, 1, rows, 1));
  if (bend) {
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + bend((y + height / 2) / height));
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  const edge = standard({ color: paper, roughness: 0.9 });
  const back = standard({ color: COL.paperShade, roughness: 0.9 });
  const front = standard({
    map: printTexture,
    emissive: 0xffffff,
    emissiveMap: printTexture,
    emissiveIntensity: emissive,
    roughness: printRoughness,
  });
  return mesh(geometry, [edge, front, back]);
}

// BoxGeometry emits one draw group per face, so a sheet with a printed front is six draw calls,
// twelve with the shadow pass, for one rectangle. Its faces are laid out +x -x +y -y +z -z, so
// the four edges are contiguous and this folds them into one: [edges, front, back] is three.
function threeGroups(geometry) {
  const groups = geometry.groups;
  const edgeCount = groups[0].count + groups[1].count + groups[2].count + groups[3].count;
  geometry.clearGroups();
  geometry.addGroup(0, edgeCount, 0);
  geometry.addGroup(edgeCount, groups[4].count, 1);
  geometry.addGroup(edgeCount + groups[4].count, groups[5].count, 2);
  return geometry;
}

// A prop's mesh turned so that a sheet leans back at `lean` radians, with its lower edge on
// the table. Baked as a Group rotation inside the prop: `rotX` on a record fights the
// base-on-ground convention, the mitochondrion's lesson.
function leaning(object3D, lean, baseY = 0) {
  const pivot = group(object3D);
  pivot.rotation.x = -lean;
  pivot.position.y = baseY;
  return pivot;
}

// Draws text scaled down until it fits. The project's most repeated bug is a fixed-size
// line running off its own canvas; every text here goes through this.
function fitText(ctx, text, x, y, maxWidth, font) {
  const measure = (px) => { ctx.font = font(px); return ctx.measureText(text).width; };
  let px = font.size;
  while (px > 10 && measure(px) > maxWidth) px -= 1;
  ctx.font = font(px);
  ctx.fillText(text, x, y);
  return px;
}

const sans = (weight, size) => {
  const f = (px) => `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;
  f.size = size;
  return f;
};
const mono = (weight, size) => {
  const f = (px) => `${weight} ${px}px ui-monospace, Menlo, Consolas, monospace`;
  f.size = size;
  return f;
};

// ---------------------------------------------------------------------------
// THE ROOM -- the walls, the floor and the edge of the table
// ---------------------------------------------------------------------------

// The terrain IS the tabletop: a 400ft square of honey-coloured wood is a 6.7ft kitchen table
// at this scale, which is why this world alone has square edges where every other has fog.
// All of it is unlit and fog-free: it is a backdrop, and a backdrop lit by the same sun as
// the props would have one wall permanently black.
//
// None of it can be picked. It is scenery at the far side of the world, and an empty click
// on the sky opening a Program panel for "the kitchen" would be baffling.
const TABLE_TOP_Y = 0.12;

export function kitchenRoom({ seed = 3 } = {}) {
  const rng = seededRandom(seed);
  const W = 470; // half the room, measured from the middle of the table
  const UP = 400; // table to ceiling: a table is 30in up a 9ft room
  const DOWN = 150; // table to floor

  const wallTexture = (kind) => canvasTexture(2048, 1024, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#f1e6cf');
    sky.addColorStop(1, '#e6d8bb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // The counter line and its backsplash run round the whole room.
    const counterY = h * 0.68;
    ctx.fillStyle = '#d7e0da';
    ctx.fillRect(0, counterY - h * 0.17, w, h * 0.17);
    ctx.strokeStyle = 'rgba(120,135,130,0.35)';
    ctx.lineWidth = 2;
    for (let x = 0; x < w; x += 58) { ctx.beginPath(); ctx.moveTo(x, counterY - h * 0.17); ctx.lineTo(x, counterY); ctx.stroke(); }
    for (let y = counterY - h * 0.17; y < counterY; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.fillStyle = '#6f5a44';
    ctx.fillRect(0, counterY, w, h * 0.022);
    ctx.fillStyle = '#b7c7bd';
    ctx.fillRect(0, counterY + h * 0.022, w, h);
    ctx.strokeStyle = 'rgba(70,85,78,0.55)';
    ctx.lineWidth = 4;
    for (let x = 0; x < w; x += 236) {
      ctx.strokeRect(x + 12, counterY + h * 0.05, 212, h);
      ctx.fillStyle = '#7d6a4e';
      ctx.fillRect(x + 196, counterY + h * 0.08, 10, 44);
    }

    const cabinets = (x0, x1) => {
      ctx.fillStyle = '#c7d4ca';
      ctx.fillRect(x0, h * 0.06, x1 - x0, h * 0.33);
      ctx.strokeStyle = 'rgba(70,85,78,0.55)';
      ctx.lineWidth = 4;
      for (let x = x0; x < x1 - 40; x += 170) ctx.strokeRect(x + 10, h * 0.08, 150, h * 0.29);
    };

    if (kind === 'window') {
      // The window the sun comes through, which is why it is on the wall BEHIND the props'
      // shadows rather than ahead of them: the far wall is what a student faces on arrival.
      cabinets(0, w * 0.3);
      cabinets(w * 0.7, w);
      const wx = w * 0.34; const wy = h * 0.09; const ww = w * 0.32; const wh = h * 0.38;
      const out = ctx.createLinearGradient(0, wy, 0, wy + wh);
      out.addColorStop(0, '#a9d8f2');
      out.addColorStop(0.72, '#e4f3f6');
      out.addColorStop(0.73, '#92b77a');
      out.addColorStop(1, '#7aa066');
      ctx.fillStyle = out;
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = '#f6f2e7';
      ctx.lineWidth = 16;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    } else if (kind === 'fridge') {
      cabinets(0, w * 0.55);
      const fx = w * 0.62; const fw = w * 0.2;
      ctx.fillStyle = '#d6d8d6';
      ctx.fillRect(fx, h * 0.05, fw, h * 0.95);
      ctx.strokeStyle = 'rgba(70,75,80,0.7)';
      ctx.lineWidth = 6;
      ctx.strokeRect(fx, h * 0.05, fw, h * 0.95);
      ctx.beginPath(); ctx.moveTo(fx, h * 0.36); ctx.lineTo(fx + fw, h * 0.36); ctx.stroke();
      ctx.fillStyle = '#8b8f92';
      ctx.fillRect(fx + 22, h * 0.17, 14, h * 0.16);
      ctx.fillRect(fx + 22, h * 0.4, 14, h * 0.2);
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = ['#f3e38a', '#f5b7a8', '#b9dcf2', '#fdfaf3', '#cfe7b8'][i];
        ctx.fillRect(fx + 70 + rng() * (fw - 170), h * (0.1 + rng() * 0.2), 72, 58);
      }
    } else {
      cabinets(w * 0.05, w * 0.95);
    }
  });

  const unlit = (map) => new THREE.MeshBasicMaterial({ map, fog: false, side: THREE.FrontSide });
  const g = group();
  const addWall = (kind, x, z, rotY) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, UP + DOWN), unlit(wallTexture(kind)));
    m.position.set(x, (UP - DOWN) / 2, z);
    m.rotation.y = rotY;
    g.add(m);
  };
  addWall('window', 0, -W, 0);
  addWall('cabinets', 0, W, Math.PI);
  addWall('fridge', -W, 0, Math.PI / 2);
  addWall('cabinets', W, 0, -Math.PI / 2);

  const flat = (size, color, y, rotX) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, fog: false }));
    m.position.y = y;
    m.rotation.x = rotX;
    g.add(m);
  };
  flat(W * 2, 0xf2ecdf, UP, Math.PI / 2); // ceiling
  flat(W * 2, 0xa98f6e, -DOWN, -Math.PI / 2); // floor

  // The table's own edge and its four legs. The terrain plane stops dead at +-200, so what
  // closes it is this band; a student standing at the world bound looks over it at the floor.
  const edge = [];
  const T = 200;
  const edgeColor = 0x7f5a34;
  const thick = 7;
  for (const [x, z, w, d] of [[0, -T - 1, T * 2 + 4, 2], [0, T + 1, T * 2 + 4, 2], [-T - 1, 0, 2, T * 2], [T + 1, 0, 2, T * 2]]) {
    put(edge, new THREE.BoxGeometry(w, thick, d), edgeColor, [x, -thick / 2 + TABLE_TOP_Y, z]);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(edge, new THREE.CylinderGeometry(9, 6, DOWN - thick, 16), 0x6e4d2d, [sx * (T - 22), -thick - (DOWN - thick) / 2, sz * (T - 22)]);
    }
  }
  const edgeMesh = new THREE.Mesh(mergeParts(edge), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  g.add(edgeMesh);

  // Scenery: it casts nothing, receives nothing, and cannot be clicked.
  g.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = false;
      node.receiveShadow = false;
      node.raycast = () => {};
    }
  });

  // THE TABLETOP, a painted sheet over the terrain rather than a photo on it. The app's one
  // wood photograph is a floor of narrow boards, and the terrain's detail map is luminance
  // only, so it came out at this scale as a flat orange plain with no grain to be seen. A
  // table is what a student walks on for the entire world, and what they are standing on is
  // the first thing that says "furniture": eleven 36ft planks, running away from the spawn.
  //
  // TABLE_TOP_Y is a fifth of a foot's worth of depth buffer clear of the terrain at the far
  // side of the table: near 0.1, far 1000 resolves about 0.05ft at 300ft.
  const topTexture = canvasTexture(2048, 2048, (ctx, w, h) => {
    ctx.fillStyle = '#a97f54';
    ctx.fillRect(0, 0, w, h);
    const planks = 11;
    const pw = w / planks;
    for (let p = 0; p < planks; p++) {
      const x0 = p * pw;
      const tone = 0.88 + rng() * 0.2;
      ctx.fillStyle = `rgb(${Math.round(170 * tone)},${Math.round(126 * tone)},${Math.round(84 * tone)})`;
      ctx.fillRect(x0, 0, pw, h);
      // Long wavering grain lines, each one a slow curve down the plank. Wider and fainter
      // lines first, so the fine ones sit on a sense of depth rather than on a flat colour.
      for (let i = 0; i < 70; i++) {
        const gx = x0 + rng() * pw;
        const wander = 6 + rng() * 22;
        const dark = rng() < 0.72;
        ctx.strokeStyle = dark
          ? `rgba(84,54,28,${0.05 + rng() * 0.17})`
          : `rgba(226,190,142,${0.05 + rng() * 0.14})`;
        ctx.lineWidth = 0.8 + rng() * 3.4;
        const a = rng() * 6.28;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        for (let y = 0; y <= h; y += 64) {
          ctx.lineTo(Math.min(x0 + pw, Math.max(x0, gx + Math.sin(y * 0.003 + a) * wander)), y);
        }
        ctx.stroke();
      }
      // One or two cathedral figures per plank: nested arches, the mark of a flat-sawn board.
      for (let k = 0, n = 1 + Math.floor(rng() * 2); k < n; k++) {
        const cx = x0 + pw * (0.35 + rng() * 0.3);
        const cy = rng() * h;
        for (let r = 1; r <= 7; r++) {
          ctx.strokeStyle = `rgba(82,52,28,${0.2 - r * 0.018})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(cx, cy, Math.min(pw * 0.42, r * 8), r * 44, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // The joint between planks.
      ctx.fillStyle = 'rgba(52,32,16,0.55)';
      ctx.fillRect(x0 - 1, 0, 2.5, h);
    }
  });
  topTexture.anisotropy = 16;
  const grain = relief('wood', { seed: 9, repeat: 44 });
  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(T * 2, T * 2),
    standard({ map: topTexture, roughness: 0.48, metalness: 0, ...grain }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = TABLE_TOP_Y;
  top.receiveShadow = true;
  top.castShadow = false;
  top.raycast = () => {};
  g.add(top);
  return g;
}

// ---------------------------------------------------------------------------
// MONEY
// ---------------------------------------------------------------------------

// The face of an invented coin: a ring of stars and a value, in a design that is plainly
// nobody's currency.
function coinFaceTexture(label) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c5c8cb';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7f8387';
    ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.45, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#6d7175';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * w * 0.375, h / 2 + Math.sin(a) * w * 0.375, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4c5054';
    fitText(ctx, label, w / 2, h / 2, w * 0.5, sans(800, 120));
  });
}

// A fine vertical stripe, wrapped once per reed. A quarter has 119 reeds, which is 1,071
// samples round the rim at nine samples per cycle -- well past what any geometry or tint can
// resolve on a coin the world holds hundreds of, so the milled edge is a bump map or it is
// nothing at all (the most repeated rule in this file's sibling worlds).
function reedTexture() {
  const tex = canvasTexture(16, 4, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#222');
    g.addColorStop(0.5, '#eee');
    g.addColorStop(1, '#222');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(119, 1);
  return tex;
}

// One coin's lathe: flat faces, a raised rim, and a side band. Only the side band keeps its
// `u`, so the reed bump lands on the edge and not as rays across the face.
function coinBody(r, t, segments = 56, simple = false) {
  const rim = r * 0.93;
  const lip = t * 0.08;
  // A stacked coin only ever shows its edge, so it drops the raised rim. Those coins are
  // about 860 of the world's lathes, drawn twice with the shadow pass, and this is where the
  // triangle budget is won or lost.
  const geometry = lathed(closed(simple
    ? [[r, 0], [r, t]]
    : [[rim, 0], [r, lip], [r, t - lip], [rim, t], [rim * 0.97, t - lip * 0.6]]), { segments });
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    if (Math.hypot(pos.getX(i), pos.getZ(i)) < r - 1e-3) uv.setX(i, 0);
  }
  return geometry;
}

function coinMaterial() {
  return standard({
    vertexColors: true, roughness: 0.42, metalness: 0.5,
    bumpMap: reedTexture(), bumpScale: 0.6,
  });
}

// A stack of quarters, drawn from the one measurement that matters: a quarter is 1.75mm
// thick, so the tower's height IS the amount of money. That is what lets four of them stand
// at the far end of the table as an honest bar chart nobody has to be told is a chart.
//
// Every coin is offset a hair so the column is a pile rather than a turned post. Merged into
// one mesh whatever the count, so a $100 tower of 400 coins is one draw call.
export function coinStack({ dollars = 10, seed = 11, radius = QUARTER_RADIUS, thickness = QUARTER_THICK } = {}) {
  const rng = seededRandom(seed);
  const count = Math.round(dollars * 4);
  const parts = [];
  const body = coinBody(radius, thickness, 30, true);
  let wanderX = 0;
  let wanderZ = 0;
  for (let i = 0; i < count; i++) {
    // A random walk pulled back toward the axis: a stack of hundreds that wandered freely
    // would lean out of its own footprint, and this one has to look stable at 138ft.
    wanderX = wanderX * 0.86 + randomIn(rng, -0.05, 0.05);
    wanderZ = wanderZ * 0.86 + randomIn(rng, -0.05, 0.05);
    const shade = randomIn(rng, 0.9, 1.04);
    const tone = new THREE.Color(COL.nickel).multiplyScalar(shade);
    put(parts, body, tone.getHex(), [wanderX, i * thickness, wanderZ], [0, rng() * Math.PI * 2, 0]);
  }
  const stack = mesh(mergeParts(parts), coinMaterial());

  // The top coin is the only face anybody can see, and only from a neighbouring stack, so one
  // canvas on it is all the coin art a tower needs.
  const top = mesh(
    new THREE.CircleGeometry(radius * 0.9, 48),
    standard({ map: coinFaceTexture('25'), roughness: 0.45, metalness: 0.3 }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(wanderX, count * thickness + 0.004, wanderZ);
  return group(stack, top);
}

// A single coin lying on the table, face up -- or standing on its edge when `upright`, which
// is what lets a student see the milling. Scattered near the stations for scale.
export function looseCoin({ label = '25', radius = QUARTER_RADIUS, thickness = QUARTER_THICK, tone = COL.nickel, upright = false } = {}) {
  const parts = [];
  put(parts, coinBody(radius, thickness), tone);
  const coin = mesh(mergeParts(parts), coinMaterial());
  const face = mesh(
    new THREE.CircleGeometry(radius * 0.9, 48),
    standard({ map: coinFaceTexture(label), roughness: 0.45, metalness: 0.3 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = thickness + 0.005;
  const inner = group(coin, face);
  if (!upright) {
    inner.position.y = TABLE_TOP_Y;
    return group(inner);
  }
  inner.rotation.x = Math.PI / 2;
  inner.position.set(0, radius, thickness / 2);
  return group(inner);
}

// A rug-sized bill: invented, single-sided and marked SAMPLE.
export function moneyBill({ value = 1, seed = 5 } = {}) {
  const W = 31;
  const D = 13;
  const T = 0.14;
  const tex = canvasTexture(1536, 644, (ctx, w, h) => {
    ctx.fillStyle = '#dfe7d6';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4a6b52';
    ctx.lineWidth = 16;
    ctx.strokeRect(26, 26, w - 52, h - 52);
    ctx.lineWidth = 3;
    ctx.strokeRect(50, 50, w - 100, h - 100);
    // Engine-turned background: concentric rings, because a bill reads from its linework.
    ctx.strokeStyle = 'rgba(74,107,82,0.28)';
    ctx.lineWidth = 2;
    for (let r = 30; r < 900; r += 12) {
      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
    // The medallion is a sprout -- this world's own symbol -- where a bill carries a portrait.
    ctx.fillStyle = '#c9d6bf';
    ctx.beginPath(); ctx.ellipse(w / 2, h / 2, 190, 215, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3f5f47';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = '#3f5f47';
    ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(w / 2, h / 2 + 130); ctx.bezierCurveTo(w / 2 - 6, h / 2 + 40, w / 2 + 4, h / 2 - 40, w / 2, h / 2 - 60); ctx.stroke();
    ctx.fillStyle = '#3f5f47';
    for (const [sx, y] of [[-1, -60], [1, -14], [-1, 40]]) {
      ctx.beginPath(); ctx.ellipse(w / 2 + sx * 62, h / 2 + y, 62, 26, sx * -0.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#35523c';
    ctx.font = '800 170px Georgia, serif';
    for (const [x, y] of [[170, 150], [w - 170, 150], [170, h - 150], [w - 170, h - 150]]) ctx.fillText(String(value), x, y);
    fitText(ctx, 'SAMPLE NOTE', w / 2, 92, 620, sans(800, 62));
    fitText(ctx, 'SIXTY TIMES LIFE SIZE', w / 2, h - 92, 620, sans(700, 44));
  });
  const m = paperSheet(W, D, T, tex, { paper: 0xc9d2bd, emissive: 0.06 });
  m.rotation.x = -Math.PI / 2;
  m.position.y = T / 2 + 0.02;
  m.rotation.z = (seed % 7) * 0.004;
  m.position.y += TABLE_TOP_Y;
  return group(m);
}

// ---------------------------------------------------------------------------
// THE STATION PROPS
// ---------------------------------------------------------------------------

// A paper's printed rows, used by the pay stub and the receipt alike: label on the left,
// value on the right, each one measured so it cannot run off the sheet.
function printedRows(ctx, rows, { x0, x1, y0, rowH, labelSize, font = mono }) {
  let y = y0;
  for (const row of rows) {
    if (row.rule) {
      ctx.strokeStyle = 'rgba(30,30,30,0.65)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x0, y - rowH * 0.42); ctx.lineTo(x1, y - rowH * 0.42); ctx.stroke();
      y += rowH * 0.32;
    }
    ctx.fillStyle = row.color || '#22252a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitText(ctx, row.label, x0, y, (x1 - x0) * 0.66, font(row.bold ? 800 : 500, labelSize));
    ctx.textAlign = 'right';
    fitText(ctx, row.value ?? '', x1, y, (x1 - x0) * 0.32, font(row.bold ? 800 : 500, labelSize));
    y += rowH;
  }
}

// The pay stub leans back on a stack of envelopes, tipped toward the reader: flat on the
// table it would be seen edge on from a 5ft eye line and not one row could be read.
export function payStub({ rows = [], employer = 'SAMPLE EMPLOYER', period = 'TWO-WEEK PAY PERIOD' } = {}) {
  const W = 26;
  const H = 34;
  const tex = canvasTexture(1024, 1340, (ctx, w, h) => {
    ctx.fillStyle = '#f4f0e5';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f9e5b';
    ctx.fillRect(0, 0, w, 150);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'EARNINGS STATEMENT', w / 2, 74, w - 90, sans(800, 72));
    ctx.fillStyle = '#22252a';
    ctx.textAlign = 'left';
    fitText(ctx, employer, 60, 205, w - 120, mono(700, 40));
    fitText(ctx, period, 60, 256, w - 120, mono(500, 34));
    printedRows(ctx, rows, { x0: 60, x1: w - 60, y0: 340, rowH: 118, labelSize: 50 });
    ctx.fillStyle = '#6a6e73';
    ctx.textAlign = 'center';
    fitText(ctx, 'Income tax rates here are examples. Your W-4 sets your own.', w / 2, h - 44, w - 90, sans(500, 32));
  });
  const LEAN = 0.62;
  const sheet = paperSheet(W, H, 0.12, tex, { rows: 1, emissive: 0.2 });
  sheet.position.y = H / 2;
  const tilted = leaning(sheet, LEAN);

  // The support: a closed wedge of mail. Its top must meet the sheet's back or the sheet
  // reads as floating, so the wedge is cut from the same lean angle.
  const parts = [];
  const rise = H * Math.cos(LEAN) * 0.72;
  const run = rise * Math.tan(LEAN);
  // Ry(90) sends the outline's +x to -z, so these run BEHIND the sheet.
  const wedge = extrudeOutline([[0.1, 0], [run * 1.35, 0], [run * 1.2, rise * 0.4], [run * 0.97, rise * 0.97]], W * 0.8);
  put(parts, wedge, 0xcfc4ae, null, [0, Math.PI / 2, 0]);
  const support = mesh(mergeParts(parts), roughMat());
  return group(tilted, support);
}

// A phone, propped back on its own folding stand. Its screen is the whole exhibit: a
// buy-now-pay-later checkout or a scam text, each one naming no real company.
export function phone({ screen = 'bnpl', lean = 0.2 } = {}) {
  const W = 15;
  const H = 30;
  const D = 1.2;
  const parts = [];
  put(parts, extrudeOutline(roundedOutline(W / 2, H / 2, 2.2, 6), D), COL.plastic);
  // The side rail: a slightly proud band that catches a highlight, which is what stops a
  // phone reading as a black domino.
  put(parts, extrudeOutline(roundedOutline(W / 2 + 0.06, H / 2 + 0.06, 2.24, 6), D * 0.55), COL.plasticLight);
  put(parts, new THREE.CylinderGeometry(1.1, 1.1, 0.3, 24), COL.plasticLight, [W / 2 - 2.6, H / 2 - 2.6, -D / 2 - 0.1], [Math.PI / 2, 0, 0]);
  const body = mesh(mergeParts(parts), roughMat({ roughness: 0.32, metalness: 0.25 }));

  const tex = canvasTexture(900, 1800, (ctx, w, h) => {
    if (screen === 'scam') {
      ctx.fillStyle = '#10141a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8edf2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, 'Messages', w / 2, 88, w - 120, sans(700, 58));
      fitText(ctx, 'Unknown number', w / 2, 158, w - 120, sans(500, 38));
      const bubble = (y, bh, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(50, y, w - 110, bh, 40);
        ctx.fill();
      };
      bubble(240, 690, '#2a3038');
      ctx.fillStyle = '#f2f5f7';
      ctx.textAlign = 'left';
      ctx.font = '500 56px "Helvetica Neue", Arial, sans-serif';
      const lines = wrapLines(ctx, 'URGENT: your account has been locked. Confirm your password and your Social Security number within 1 hour or your money will be lost.', w - 190);
      lines.forEach((line, i) => ctx.fillText(line, 90, 310 + i * 72));
      ctx.fillStyle = '#7fb6ff';
      ctx.fillText('secure-login.example', 90, 310 + lines.length * 72 + 34);
      bubble(980, 330, '#2a3038');
      ctx.fillStyle = '#f2f5f7';
      const second = wrapLines(ctx, 'You also WON a $1,000 gift card! Pay $4.99 shipping to claim it.', w - 190);
      second.forEach((line, i) => ctx.fillText(line, 90, 1050 + i * 72));
      ctx.fillStyle = '#ff7a6b';
      ctx.textAlign = 'center';
      ctx.fillRect(50, 1420, w - 110, 6);
      fitText(ctx, 'This is a fake message.', w / 2, 1500, w - 120, sans(800, 60));
      ctx.fillStyle = '#e8edf2';
      fitText(ctx, 'How many red flags can you count?', w / 2, 1590, w - 120, sans(600, 46));
    } else {
      ctx.fillStyle = '#fbf7ee';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e0812b';
      ctx.fillRect(0, 0, w, 210);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, 'CHECKOUT', w / 2, 110, w - 120, sans(800, 92));
      ctx.fillStyle = '#22252a';
      fitText(ctx, 'Sneakers', w / 2, 310, w - 120, sans(600, 58));
      fitText(ctx, '$100.00', w / 2, 420, w - 120, sans(800, 112));
      ctx.fillStyle = '#e0812b';
      ctx.beginPath(); ctx.roundRect(60, 530, w - 120, 380, 40); ctx.fill();
      ctx.fillStyle = '#ffffff';
      fitText(ctx, 'Or just', w / 2, 610, w - 170, sans(600, 60));
      fitText(ctx, '4 easy payments', w / 2, 710, w - 170, sans(800, 84));
      fitText(ctx, 'of $25.00', w / 2, 820, w - 170, sans(800, 84));
      ctx.fillStyle = '#22252a';
      fitText(ctx, 'No interest! Pay later!', w / 2, 1000, w - 120, sans(700, 60));
      ctx.fillStyle = '#7b7f85';
      ctx.font = '500 34px "Helvetica Neue", Arial, sans-serif';
      const fine = wrapLines(ctx, 'Late fees may apply. A missed payment may be reported to credit bureaus. Payments are taken automatically every two weeks from your account.', w - 150);
      fine.forEach((line, i) => ctx.fillText(line, w / 2, 1120 + i * 46));
      ctx.fillStyle = '#22252a';
      ctx.beginPath(); ctx.roundRect(120, 1500, w - 240, 150, 75); ctx.fill();
      ctx.fillStyle = '#ffffff';
      fitText(ctx, 'Buy now', w / 2, 1578, w - 300, sans(800, 72));
    }
  });
  const glass = mesh(
    new THREE.PlaneGeometry(W - 1.2, H - 1.6),
    standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.3 }),
  );
  glass.position.z = D / 2 + 0.02;

  const handset = group(body, glass);
  handset.position.y = H / 2 + 0.2;
  const tilted = leaning(handset, lean);

  // A folding stand behind it, wide enough to look as if it could hold 30ft of phone.
  const stand = [];
  const topX = H * 0.42 * Math.tan(lean) + 0.7;
  put(stand, extrudeOutline([[0.7, 0], [topX + 7, 0], [topX + 1.4, H * 0.42], [topX, H * 0.42]], 7), COL.steel, null, [0, Math.PI / 2, 0]);
  const support = mesh(mergeParts(stand), roughMat({ roughness: 0.5, metalness: 0.2 }));
  return group(tilted, support);
}

// A curling receipt that grows as the months add up. It stands on its own lower edge, so its
// origin is the base and a uniform `setSize` lengthens it from the table up.
export function longReceipt({ rows = [], title = 'SUBSCRIPTIONS', footer = '' } = {}) {
  const W = 9;
  const H = 26;
  const tex = canvasTexture(620, 1800, (ctx, w, h) => {
    ctx.fillStyle = '#fbf9f2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#22252a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, title, w / 2, 90, w - 70, mono(800, 58));
    ctx.fillRect(40, 140, w - 80, 5);
    printedRows(ctx, rows, { x0: 40, x1: w - 40, y0: 220, rowH: 120, labelSize: 44 });
    ctx.textAlign = 'center';
    ctx.font = '500 36px ui-monospace, Menlo, monospace';
    wrapLines(ctx, footer, w - 80).forEach((line, i) => ctx.fillText(line, w / 2, h - 300 + i * 50));
  });
  const sheet = paperSheet(W, H, 0.09, tex, {
    rows: 26,
    emissive: 0.2,
    // The curl: the base stands straight and the top rolls toward the reader, which is what a
    // thermal receipt does the moment it leaves the printer.
    bend: (t) => 3.2 * t * t * t,
  });
  sheet.position.y = H / 2;
  return group(sheet);
}

// A sprout on a jar lid of soil. It is the compounding exhibit, so it is authored at 1.6ft
// and grows to tens of feet: the leaves have to hold up at twenty-four times this size. Only
// the plant is in this prop; the lid is separate and stays put.
export function moneySprout({ seed = 21 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const H = 1.6;
  const stemPts = [[0, 0, 0], [0.01, H * 0.3, 0.01], [-0.015, H * 0.65, -0.01], [0.01, H, 0.015]];
  put(parts, tube(stemPts, [0.03, 0.024, 0.018, 0.012], { tubular: 30, sides: 12 }), COL.stem);
  put(parts, ball(0.012, 10), COL.stem, stemPts[3]);

  const leaf = (y, azimuth, length, tilt, color) => {
    const width = length * 0.42;
    const c = Math.cos(azimuth);
    const s = Math.sin(azimuth);
    const geometry = solidSurface({
      nu: 12,
      nv: 6,
      point: (u, v) => {
        const along = u * length;
        // A pointed-oval outline, drooping toward its tip.
        const half = width * Math.sin(Math.PI * Math.pow(u, 0.75)) * (v - 0.5);
        const lift = tilt * along - 0.45 * along * along / length;
        const vein = Math.abs(v - 0.5) * 0.08 * width;
        return [c * along - s * half, y + lift + vein, s * along + c * half];
      },
      thick: (u, v) => 0.008 * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + 1e-4,
    });
    put(parts, geometry, color);
  };
  const pairs = 5;
  for (let i = 0; i < pairs; i++) {
    const t = (i + 1) / pairs;
    const y = H * (0.22 + 0.78 * t);
    const length = 0.62 - 0.32 * t + randomIn(rng, -0.02, 0.02);
    const az = i * 1.25 + randomIn(rng, -0.15, 0.15);
    const col = i % 2 ? COL.leaf : COL.leafDark;
    leaf(y, az, length, 0.65, col);
    leaf(y, az + Math.PI, length, 0.65, col);
  }
  const m = mesh(mergeParts(parts), roughMat({ roughness: 0.62 }));
  return group(m);
}

// The jar lid the sprouts stand in: a shallow metal dish of soil. Low, so the plant can start
// small enough to grow, and a real jar lid -- 2in across and a quarter-inch deep -- so it
// holds its scale against the coins beside it.
export function jarLidSoil({ seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  put(parts, lathed(closed([[4.6, 0], [5, 0.05], [5, 1.15], [4.75, 1.2], [4.68, 0.95]]), { segments: 48 }), COL.gold);
  const soil = new THREE.CylinderGeometry(4.7, 4.7, 0.2, 48, 4);
  const pos = soil.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + Math.sin(pos.getX(i) * 1.7 + pos.getZ(i)) * 0.03);
  }
  soil.computeVertexNormals();
  put(parts, soil, COL.soil, [0, 0.95, 0]);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = 1 + rng() * 3.2;
    put(parts, ball(0.1 + rng() * 0.1, 7), 0x57402d, [Math.cos(a) * r, 1.07, Math.sin(a) * r]);
  }
  return group(mesh(mergeParts(parts), roughMat({ metalness: 0.15 })));
}

// A 12-inch ruler standing on end, and it is the world's other hero: at this scale it is
// 60ft of wood, and it carries TWO scales side by side -- real inches on the left, and on the
// right how many times over your money has multiplied. The second column is what makes a
// growing sprout a CHART: a sprout scales in all three directions, so its bulk exaggerates
// the growth, and the only honest reading is its height against this column.
export const RULER_FEET_PER_MULTIPLE = 1.6; // the sprout's own authored height

export function standingRuler({ baseY = 1.05, feetPerMultiple = RULER_FEET_PER_MULTIPLE, money = true } = {}) {
  const W = 5;
  const H = 60;
  const T = 0.7;
  const PX = 4096 / H;
  const tex = canvasTexture(Math.round(W * PX), 4096, (ctx, w, h) => {
    ctx.fillStyle = '#d9b98a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,85,45,0.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 9, h * 0.3, x - 9, h * 0.7, x, h); ctx.stroke();
    }
    ctx.fillStyle = '#2a2622';
    ctx.textBaseline = 'middle';
    // Inches: one inch is exactly five feet at sixty times life size.
    for (let inch = 0; inch <= 96; inch++) {
      const y = h - (inch / 8) * 5 * PX;
      const major = inch % 8 === 0;
      const half = inch % 4 === 0;
      const len = major ? w * 0.26 : half ? w * 0.17 : w * 0.09;
      ctx.fillRect(0, y - (major ? 3 : 1.5), len, major ? 6 : 3);
      if (major && inch > 0 && inch < 96) {
        ctx.textAlign = 'left';
        ctx.font = '700 58px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(String(inch / 8), w * 0.08, y + 42);
      }
    }
    // The money column. Height above the soil line, in multiples of the sprout's own start.
    if (!money) return;
    ctx.fillStyle = '#17693f';
    ctx.fillRect(w * 0.52, 0, 5, h);
    for (let m = 1; m <= 36; m++) {
      const y = h - (baseY + m * feetPerMultiple) * PX;
      if (y < 30) break;
      const labelled = m === 1 || m % 4 === 0;
      ctx.fillRect(w * 0.52, y - 1.5, labelled ? w * 0.14 : w * 0.06, 3);
      if (labelled) {
        ctx.textAlign = 'left';
        ctx.font = '800 54px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`${m}x`, w * 0.69, y);
      }
    }
  });
  const body = threeGroups(new THREE.BoxGeometry(W, H, T));
  const edge = standard({ color: COL.woodPale, roughness: 0.75 });
  const front = standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.14, roughness: 0.7 });
  const ruler = mesh(body, [edge, front, edge]);
  ruler.position.y = H / 2;
  // A foot so it can stand: a clip of steel it would need in real life, too.
  const foot = [];
  put(foot, new THREE.BoxGeometry(W + 3, 0.7, 7), COL.steel, [0, 0.35, 0]);
  put(foot, new THREE.BoxGeometry(W + 0.5, 3, T + 0.5), COL.steel, [0, 1.5, 0]);
  return group(ruler, mesh(mergeParts(foot), roughMat({ metalness: 0.35, roughness: 0.5 })));
}

// An ice cube melting on a saucer: what inflation does to cash in a drawer. Translucent, one
// mesh, front faces only (the lungs' rule about stacked transparency).
export function iceCube({ size = 5 } = {}) {
  const g = new THREE.BoxGeometry(size, size, size, 6, 6, 6);
  const pos = g.attributes.position;
  const half = size / 2;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Round every corner by pulling toward an inner cube and re-projecting: a sharp ice cube
    // reads as a glass paperweight, and a melting one has no corners left.
    const inner = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -half * 0.75, half * 0.75),
      THREE.MathUtils.clamp(v.y, -half * 0.75, half * 0.75),
      THREE.MathUtils.clamp(v.z, -half * 0.75, half * 0.75),
    );
    v.sub(inner).normalize().multiplyScalar(half * 0.25).add(inner);
    pos.setXYZ(i, v.x, v.y + half, v.z);
  }
  g.computeVertexNormals();
  const cube = mesh(g, standard({ color: 0xc7e6f2, transparent: true, opacity: 0.62, roughness: 0.12, metalness: 0 }));
  cube.castShadow = false;
  return group(cube);
}

// The saucer under it. A separate object, so it does not melt.
export function saucer({ radius = 8 } = {}) {
  const parts = [];
  put(parts, lathed(closed([[radius * 0.45, 0], [radius * 0.55, 0.15], [radius, 1.05], [radius * 0.97, 1.2], [radius * 0.55, 0.5]]), { segments: 56 }), COL.ceramic);
  put(parts, new THREE.CylinderGeometry(radius * 0.54, radius * 0.54, 0.08, 40), 0xbcd2dc, [0, 0.54, 0]);
  return group(mesh(mergeParts(parts), roughMat({ roughness: 0.38 })));
}

// The balloon carrying a card balance. Its volume is a metaphor and its height is the figure:
// it starts 26ft tall at the full balance and scales from the coin it is tied to.
export function debtBalloon({ color = COL.balloon } = {}) {
  const parts = [];
  put(parts, new THREE.CylinderGeometry(1.2, 1.2, 0.2, 24), COL.copper, [0, TABLE_TOP_Y + 0.1, 0]);
  const R = 8;
  const stringTop = 10;
  put(parts, tube([[0, 0.2, 0], [0.3, 3.4, 0.16], [-0.2, 6.8, -0.12], [0, stringTop, 0]], [0.09, 0.09, 0.09, 0.09], { tubular: 22, sides: 6 }), 0xe4ddcc);
  put(parts, ball(0.09, 6), 0xe4ddcc, [0, 0.2, 0]);
  const m0 = mesh(mergeParts(parts), roughMat());

  // A pear profile, narrowing to a knot: a balloon is not a sphere, and a sphere on a string
  // reads as a lollipop.
  const profile = [];
  const yBase = stringTop + 0.3;
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const a = t * Math.PI;
    const r = R * Math.sin(a) * (1 - 0.32 * Math.pow(1 - t, 3));
    const y = yBase + (R * 1.85) * (1 - Math.cos(a)) * 0.5 + R * 0.25 * Math.pow(1 - t, 2) * t;
    profile.push([Math.max(0.02, r), y]);
  }
  const parts2 = [];
  put(parts2, lathed(closed(profile), { segments: 48 }), color);
  put(parts2, new THREE.CylinderGeometry(0.12, 0.6, 0.8, 12), color, [0, yBase - 0.1, 0]);
  const skin = mesh(mergeParts(parts2), roughMat({ roughness: 0.2, metalness: 0.02 }));
  return group(m0, skin);
}

// A credit card, leaning on a small block. Invented, and its number is all zeros.
export function bankCard({ apr = '24% APR', lean = 0.72 } = {}) {
  const W = 17;
  const H = 10.7;
  const tex = canvasTexture(1024, 644, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#7f1f2a');
    g.addColorStop(1, '#2a1a3f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d9b35f';
    ctx.beginPath(); ctx.roundRect(80, 180, 130, 100, 16); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    fitText(ctx, 'SAMPLE CREDIT', 80, 90, w - 160, sans(800, 62));
    fitText(ctx, '0000 0000 0000 0000', 80, 380, w - 160, mono(600, 62));
    fitText(ctx, 'YOUR NAME HERE', 80, 500, 560, mono(500, 42));
    ctx.textAlign = 'right';
    fitText(ctx, apr, w - 80, 500, 300, sans(800, 62));
  });
  const parts = [];
  put(parts, extrudeOutline(roundedOutline(W / 2, H / 2, 0.8, 5), 0.18), 0x4a1c33);
  const body = mesh(mergeParts(parts), roughMat({ roughness: 0.3 }));
  const face = mesh(new THREE.PlaneGeometry(W - 0.5, H - 0.5), standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18, roughness: 0.28 }));
  face.position.z = 0.11;
  const card = group(body, face);
  card.position.y = H / 2;
  const tilted = leaning(card, lean);
  const block = [];
  const rise = H * Math.cos(lean) * 0.8;
  const run = rise * Math.tan(lean);
  // Wholly behind the card's own plane, or its top corner comes through the face.
  put(block, new THREE.BoxGeometry(W * 0.5, rise, run * 0.8), 0x8b6a46, [0, rise / 2, -run * 1.45]);
  return group(tilted, mesh(mergeParts(block), roughMat()));
}

// A car key and fob, lying flat: the 15ft thing that goes with the loan on the board beside it.
export function carKey({ seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // A key is read from its bitting, so the blade is one outline with the cuts in it.
  const cuts = [];
  const L = 10;
  const steps = 9;
  cuts.push([0, -0.55], [L, -0.55], [L + 0.8, 0]);
  for (let i = steps; i >= 0; i--) {
    const x = (i / steps) * L;
    cuts.push([x, 0.55 + (i % 2 ? randomIn(rng, -0.25, -0.05) : randomIn(rng, 0.02, 0.2))]);
  }
  put(parts, extrudeOutline(cuts, 0.22), COL.steel, [2.2, 0.32, 0], [Math.PI / 2, 0, 0]);
  put(parts, extrudeOutline(roundedOutline(2.6, 2.0, 1.1, 6), 0.75), COL.plastic, [0, 0.42, 0], [Math.PI / 2, 0, 0]);
  for (const [x, c] of [[-1.05, 0xc7ccd1], [0, 0xc7ccd1], [1.05, 0xcf4b3f]]) {
    put(parts, new THREE.CylinderGeometry(0.38, 0.42, 0.12, 18), c, [x, 0.84, 0]);
  }
  return group(mesh(mergeParts(parts), roughMat({ roughness: 0.42, metalness: 0.28 })));
}

// A big mug lying on its side, with what it spilled. A mug at sixty times is a building: 20ft
// across and 23ft long. It is a real shell with a real inside, because a student walks to the
// open end and looks in.
export function spilledMug({ seed = 41 } = {}) {
  const parts = [];
  const R = 10;
  const L = 23;
  const wall = 1;
  // A closed profile: out along the base, up the outside, over the lip, down the inside.
  const shell = lathed([
    [0, 0], [R * 0.86, 0], [R, 1.2], [R, L - 0.4], [R - 0.3, L], [R - wall + 0.2, L - 0.1],
    [R - wall, L - 1], [R - wall, 2], [R * 0.75, 1], [0, 1],
  ], { segments: 64 });
  put(parts, shell, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // A blue band round the outside of a cream mug, painted on one solid.
      const c = new THREE.Color(COL.ceramic);
      const r = Math.hypot(p.x, p.z);
      if (r > R - 0.1 && p.y > L * 0.55 && p.y < L * 0.72) c.set(COL.ceramicBlue);
      return [c.r, c.g, c.b];
    },
  });
  // The handle: a swept loop, both ends buried in the wall.
  const handle = [
    [R - 0.4, L * 0.78, 0], [R + 3.2, L * 0.74, 0], [R + 5, L * 0.5, 0],
    [R + 3.4, L * 0.27, 0], [R - 0.4, L * 0.22, 0],
  ];
  put(parts, tube(handle, [1, 1.05, 1.1, 1.05, 1], { tubular: 36, sides: 14 }), COL.ceramic);
  const mug = mesh(mergeParts(parts), roughMat({ roughness: 0.34 }));
  // Lay it down: +Y (the mug's axis) to +Z, resting on its side, with the handle turned to
  // the top so the silhouette says "mug" from a distance. Euler XYZ is Rx*Ry, so the Y turn
  // happens first: it sends the handle from +X to -Z, and the X turn then stands that up.
  mug.rotation.set(Math.PI / 2, Math.PI / 2, 0);
  mug.position.set(0, R, -L * 0.5);

  // The puddle: one irregular closed outline, slightly domed by being thin.
  const rng = seededRandom(seed);
  const outline = [];
  const n = 120;
  const lobes = [1.7, 2.6, 4.1].map((f) => [f, rng() * 6.28]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = 1;
    for (const [f, phase] of lobes) r += Math.sin(a * Math.round(f) + phase) * 0.14;
    outline.push([Math.cos(a) * 19 * r, Math.sin(a) * 15 * r]);
  }
  const pool = [];
  put(pool, extrudeOutline(outline, 0.14), COL.coffee, [0, TABLE_TOP_Y + 0.08, L * 0.5 + 8], [Math.PI / 2, 0, 0]);
  const puddle = mesh(mergeParts(pool), roughMat({ roughness: 0.08, metalness: 0.05 }));
  puddle.castShadow = false;
  return group(mug, puddle);
}

// The rainy-day jar: a glass cylinder and, as a SEPARATE prop, the coins in it. The program
// has to shrink the savings without shrinking the jar, which is the observatory's two-objects
// trick again.
export function rainyDayJar({ radius = 7, height = 19, label = 'RAINY DAY' } = {}) {
  // Round from the middle of the underside, up the outside, over the lip and back down to the
  // middle of the inside floor: without those two axis points a jar has no bottom.
  const profile = [
    [0, 0.02], [radius - 0.6, 0.02], [radius, 0.6], [radius, height - 3], [radius * 0.82, height - 1.8],
    [radius * 0.82, height], [radius * 0.76, height], [radius * 0.76, height - 1.6],
    [radius - 0.45, height - 3.1], [radius - 0.45, 1], [radius - 1, 0.7], [0, 0.7],
  ];
  const glass = mesh(
    lathed(profile, { segments: 56 }),
    standard({ color: 0xd2e6ea, transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0, side: THREE.FrontSide, depthWrite: false }),
  );
  glass.castShadow = false;
  const lidParts = [];
  put(lidParts, new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 1.2, 40), COL.brass, [0, height + 0.5, 0]);
  const lid = mesh(mergeParts(lidParts), roughMat({ roughness: 0.4, metalness: 0.4 }));

  const tag = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f7f1df';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7a5fd0';
    ctx.lineWidth = 12;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#332a55';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, label, w / 2, h / 2, w - 60, sans(800, 86));
  });
  const plate = mesh(new THREE.PlaneGeometry(8, 4), standard({ map: tag, roughness: 0.8 }));
  plate.position.set(0, height * 0.72, radius + 0.08);
  return group(glass, lid, plate);
}

// The savings inside the jar: a heap of coins, sized to the jar's floor. Its origin is on the
// floor, so a `setSize` lowers the heap rather than floating it.
export function jarSavings({ seed = 45, heapRadius = 5.4, heapHeight = 9 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const coin = coinBody(QUARTER_RADIUS * 0.5, QUARTER_THICK * 0.9, 16, true);
  const count = 150;
  for (let i = 0; i < count; i++) {
    const h = Math.pow(rng(), 1.4);
    // On the OUTSIDE of the core: buried, a tilted coin shows only the sliver that pokes out,
    // and a heap of slivers reads as a pile of bent ribbons.
    const r = heapRadius * (1 - h * 0.78) * (0.72 + 0.28 * Math.sqrt(rng()));
    const a = rng() * Math.PI * 2;
    const tone = new THREE.Color(rng() < 0.25 ? COL.copper : COL.nickel).multiplyScalar(randomIn(rng, 0.85, 1.05));
    put(parts, coin, tone.getHex(), [Math.cos(a) * r, h * heapHeight, Math.sin(a) * r], [randomIn(rng, -0.4, 0.4), rng() * 6.28, randomIn(rng, -0.4, 0.4)]);
  }
  // A dark core so the gaps between coins are never daylight: a heap is solid from outside.
  const core = lathed(closed([[heapRadius * 0.66, 0], [heapRadius * 0.5, heapHeight * 0.35], [heapRadius * 0.2, heapHeight * 0.8], [0.01, heapHeight * 0.86]]), { segments: 28 });
  put(parts, core, 0x4d4a44);
  return group(mesh(mergeParts(parts), roughMat({ roughness: 0.45, metalness: 0.35 })));
}

// A stubby pencil standing on its point: the thing a marker line comes from. Its origin IS
// the tip, so the marker tube is drawn exactly where the graphite meets the paper.
export function chartPencil({ color = 'yellow' } = {}) {
  const bodyColor = color === 'blue' ? 0x3a6fbf : color === 'red' ? 0xc7382f : COL.pencil;
  const parts = [];
  const R = 1.25;
  const tip = 0.0;
  // Tip and shaved wood: one lathe, tinted by height, so the two meet with no seam at all.
  put(parts, lathed(closed([[0.02, tip], [0.34, 0.9], [R * 0.98, 3.2]]), { segments: 24 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const c = new THREE.Color(p.y < 0.9 ? COL.graphite : COL.woodPale);
      return [c.r, c.g, c.b];
    },
  });
  const hex = new THREE.CylinderGeometry(R, R, 9.4, 6, 1);
  hex.translate(0, 3.2 + 4.7, 0);
  put(parts, hex, bodyColor);
  put(parts, new THREE.CylinderGeometry(R * 1.04, R * 1.04, 1.1, 20), 0xb6babf, [0, 13.15, 0]);
  put(parts, lathed(closed([[R, 13.7], [R, 14.8], [R * 0.72, 15.4]]), { segments: 20 }), COL.rubber);
  return group(mesh(mergeParts(parts), roughMat({ roughness: 0.55 })));
}

// Sheet of graph paper standing on a binder-clip foot. The plot's coordinates are exported,
// because the pencil that draws on it is a separate prop and they must agree on where $1 is
// without being able to ask each other (BEACON_DECK_Y's lesson).
export const GRAPH = {
  W: 58,
  H: 44,
  // In the sheet's own frame: the plot origin (year 0, $0), and the scale of each axis.
  x0: -25,
  y0: 2.5,
  feetPerYear: 1.25,
  feetPerDollar: 1,
  // How far proud of the paper a pencil's tip rides. A 3-inch tube half-buried in the sheet
  // would z-fight along its whole length.
  standoff: 0.42,
  // Where the pencil starts: $1 at year 0.
  startY: 3.5,
};

export function graphSheet({ title = 'WHAT $1 BECOMES IN 40 YEARS', note = '' } = {}) {
  const { W, H, x0, y0, feetPerYear, feetPerDollar } = GRAPH;
  const PXW = 2048;
  const PX = PXW / W;
  const fx = (sheetX) => (sheetX + W / 2) * PX;
  const fy = (sheetY) => (H - sheetY) * PX;
  const tex = canvasTexture(PXW, Math.round(H * PX), (ctx, w, h) => {
    ctx.fillStyle = '#fbfaf3';
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(47,111,214,0.25)';
    for (let x = 0; x <= W; x += 1) { ctx.beginPath(); ctx.moveTo(x * PX, 0); ctx.lineTo(x * PX, h); ctx.stroke(); }
    for (let y = 0; y <= H; y += 1) { ctx.beginPath(); ctx.moveTo(0, y * PX); ctx.lineTo(w, y * PX); ctx.stroke(); }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(47,111,214,0.45)';
    for (let x = 0; x <= W; x += 5) { ctx.beginPath(); ctx.moveTo(x * PX, 0); ctx.lineTo(x * PX, h); ctx.stroke(); }
    for (let y = 0; y <= H; y += 5) { ctx.beginPath(); ctx.moveTo(0, y * PX); ctx.lineTo(w, y * PX); ctx.stroke(); }

    // Axes.
    ctx.strokeStyle = '#22252a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(fx(x0), fy(H - 3));
    ctx.lineTo(fx(x0), fy(y0));
    ctx.lineTo(fx(x0 + 40 * feetPerYear), fy(y0));
    ctx.stroke();
    ctx.fillStyle = '#22252a';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let year = 0; year <= 40; year += 10) {
      fitText(ctx, `${year}`, fx(x0 + year * feetPerYear), fy(y0 - 1.1), 90, sans(700, 40));
    }
    fitText(ctx, 'YEARS', fx(x0 + 20 * feetPerYear), fy(y0 - 1.9), 200, sans(800, 30));
    ctx.textAlign = 'right';
    for (let d = 5; d <= 35; d += 5) {
      fitText(ctx, `$${d}`, fx(x0 - 0.3), fy(y0 + d * feetPerDollar), 90, sans(700, 36));
    }
    ctx.textAlign = 'center';
    fitText(ctx, title, w / 2, fy(H - 1.3), w - 160, sans(800, 68));
    if (note) {
      ctx.fillStyle = '#5b6068';
      fitText(ctx, note, w / 2, fy(H - 3.1), w - 200, sans(500, 34));
    }
  });
  const sheet = paperSheet(W, H, 0.16, tex, { emissive: 0.22 });
  sheet.position.y = H / 2;
  // Two steel feet behind it, closed wedges, set clear of the plot.
  const feet = [];
  for (const sx of [-1, 1]) {
    put(feet, extrudeOutline([[0.1, 0], [16, 0], [1.5, 22], [0.1, 22]], 1.1), COL.steel, [sx * (W * 0.32), 0, 0], [0, Math.PI / 2, 0]);
  }
  put(feet, new THREE.BoxGeometry(W * 0.85, 1.2, 0.8), COL.steel, [0, 0.6, -0.3]);
  return group(sheet, mesh(mergeParts(feet), roughMat({ metalness: 0.3, roughness: 0.5 })));
}

// A pocket calculator lying on its back, tipped up a little. Purely for scale and for the
// display, which states the world's one rule of thumb.
export function calculator({ display = '72 / 7 = 10.3 YRS' } = {}) {
  const W = 15;
  const L = 26;
  const parts = [];
  put(parts, extrudeOutline(roundedOutline(W / 2, L / 2, 1.3, 5), 1.4), 0x2f333a);
  const rows = 5;
  const cols = 4;
  const keyColors = [0x5d6470, 0x5d6470, 0x5d6470, 0xd27a2c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const kx = -W / 2 + 2.3 + c * ((W - 4.6) / (cols - 1));
      const ky = -L / 2 + 2.6 + r * 3.1;
      put(parts, extrudeOutline(roundedOutline(1.3, 1.05, 0.35, 3), 0.5), keyColors[c], [kx, ky, 0.85]);
    }
  }
  const body = mesh(mergeParts(parts), roughMat({ roughness: 0.46 }));
  const tex = canvasTexture(900, 260, (ctx, w, h) => {
    ctx.fillStyle = '#b8c6a2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c2316';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    fitText(ctx, display, w - 40, h / 2, w - 70, mono(700, 110));
  });
  const screen = mesh(new THREE.PlaneGeometry(W - 3, 4.4), standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.3 }));
  screen.position.set(0, L / 2 - 4.2, 0.72);
  const device = group(body, screen);
  const tilt = 1.25;
  device.rotation.x = -tilt;
  device.position.y = 0.8 + (L / 2) * Math.cos(tilt);
  const wedge = [];
  put(wedge, new THREE.BoxGeometry(W * 0.7, 6.5, 5), 0x24272c, [0, 3.25, -L * 0.3]);
  return group(device, mesh(mergeParts(wedge), roughMat()));
}

// A slim pile of opened mail: background, and a bit of honesty about what a table like this
// actually has on it.
export function mailPile({ seed = 61, count = 5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const W = 24;
  const D = 11;
  for (let i = 0; i < count; i++) {
    const tone = new THREE.Color(i % 2 ? 0xe9e2d0 : 0xd8cfb9).multiplyScalar(randomIn(rng, 0.94, 1.04));
    put(parts, new THREE.BoxGeometry(W, 0.14, D), tone.getHex(), [randomIn(rng, -1.6, 1.6), TABLE_TOP_Y + 0.08 + i * 0.16, randomIn(rng, -1.4, 1.4)], [0, randomIn(rng, -0.3, 0.3), 0]);
  }
  const pile = mesh(mergeParts(parts), roughMat({ roughness: 0.9 }));
  const y = TABLE_TOP_Y + 0.08 + (count - 1) * 0.16 + 0.08;
  const tex = canvasTexture(1024, 470, (ctx, w, h) => {
    ctx.fillStyle = '#eae3d2';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(120,110,90,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w / 2, h * 0.55); ctx.lineTo(w, 0); ctx.stroke();
    ctx.fillStyle = '#2b2d30';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'STATEMENT ENCLOSED', 70, h * 0.72, w - 140, mono(700, 54));
  });
  const face = mesh(new THREE.PlaneGeometry(W, D), standard({ map: tex, roughness: 0.9 }));
  face.rotation.x = -Math.PI / 2;
  face.position.y = y + 0.01;
  return group(pile, face);
}

// ---------------------------------------------------------------------------
// The data board: comparisons, read from the table
// ---------------------------------------------------------------------------

// A dark board for the tables a student should stand and compare. `rows` are drawn with a
// value column and an optional bar: every number on it comes out of MoneyModel.js, so the
// board can only ever say what the arithmetic says. Fit-to-measure on every string, because
// this is the fifth board in this project and all four before it ran off the edge first.
export function factBoard({
  title = '', eyebrow = '', columns = [], rows = [], note = '', accent = '#2f9e5b',
  width = 10.5, height = 7.4, postHeight = 11,
} = {}) {
  const parts = [];
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.17, 0.22, postHeight, 12), 0x363b47, [sx * (width / 2 + 0.3), postHeight / 2, -0.08]);
  }
  put(parts, extrudeOutline(roundedOutline(width / 2 + 0.2, height / 2 + 0.2, 0.3, 3), 0.28), 0x202733, [0, postHeight - height / 2 - 0.3, -0.18]);

  const tex = canvasTexture(1400, Math.round(1400 * height / width), (ctx, w, h) => {
    ctx.fillStyle = '#18202b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, 14);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const pad = 60;
    ctx.fillStyle = accent;
    fitText(ctx, eyebrow, pad, 66, w - pad * 2, sans(800, 36));
    ctx.fillStyle = '#f6f2e7';
    fitText(ctx, title, pad, 132, w - pad * 2, sans(800, 66));

    const cols = columns.length ? columns : rows[0]?.cells?.map(() => '') ?? [];
    const firstW = 0.42;
    const colX = (i) => {
      if (i === 0) return pad;
      return pad + (w - pad * 2) * (firstW + (1 - firstW) * ((i - 1) / Math.max(1, cols.length - 1)));
    };
    const top = 214;
    const noteRoom = note ? 136 : 40;
    const rowH = Math.min(100, (h - top - noteRoom - 56) / Math.max(1, rows.length));
    ctx.fillStyle = '#9fb0bd';
    cols.forEach((c, i) => {
      ctx.textAlign = 'left';
      const maxW = i === 0 ? (w - pad * 2) * firstW - 20 : (w - pad * 2) * (1 - firstW) / Math.max(1, cols.length - 1) - 14;
      fitText(ctx, c, colX(i), top, maxW, sans(700, 32));
    });
    ctx.strokeStyle = 'rgba(159,176,189,0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pad, top + 28); ctx.lineTo(w - pad, top + 28); ctx.stroke();

    rows.forEach((row, r) => {
      const y = top + 56 + rowH * (r + 0.5);
      if (row.highlight) {
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(pad - 14, y - rowH / 2 + 3, w - pad * 2 + 28, rowH - 6);
      }
      if (row.bar != null) {
        const barX = colX(1);
        const barW = (w - pad - barX) * 0.72;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(barX, y - 20, barW, 40);
        ctx.fillStyle = row.color || accent;
        ctx.fillRect(barX, y - 20, barW * row.bar, 40);
      }
      row.cells.forEach((cell, i) => {
        ctx.fillStyle = row.highlight || i === 0 ? '#f6f2e7' : '#d9e2e8';
        ctx.textAlign = 'left';
        const maxW = i === 0 ? (w - pad * 2) * firstW - 20 : (w - pad * 2) * (1 - firstW) / Math.max(1, cols.length - 1) - 14;
        const x = row.bar != null && i > 0 ? w - pad - 170 : colX(i);
        fitText(ctx, String(cell), x, y, row.bar != null && i > 0 ? 170 : maxW, sans(i === 0 ? 700 : 600, 44));
      });
    });

    if (note) {
      ctx.fillStyle = '#c9d4db';
      ctx.font = 'italic 400 34px Georgia, serif';
      ctx.textAlign = 'left';
      const lines = wrapLines(ctx, note, w - pad * 2);
      const size = lines.length > 2 ? 28 : 34;
      ctx.font = `italic 400 ${size}px Georgia, serif`;
      wrapLines(ctx, note, w - pad * 2).slice(0, 3).forEach((line, i, all) => {
        ctx.fillText(line, pad, h - 26 - (all.length - 1 - i) * (size * 1.25) - 14);
      });
    }
  });
  const face = mesh(
    new THREE.PlaneGeometry(width, height),
    standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.34, roughness: 0.85 }),
  );
  face.position.set(0, postHeight - height / 2 - 0.3, 0);
  return group(mesh(mergeParts(parts), roughMat({ roughness: 0.6, metalness: 0.2 })), face);
}
