import * as THREE from 'three';
import { standard, mesh, group, canvasTexture, seededRandom } from '../PropKit.js';
import { extrudeOutline, revolve, ball, mergeParts, put } from './LoftKit.js';
import {
  BENCH, MIRROR, PERISCOPE, TANK, BLOCK, FIBRE, PRISM, LENS, SPECTRUM, prismCorners,
} from './OpticsModel.js';

// The Hall of Light: geometric optics, where every beam is a program drawing its own path with the
// marker. A roofless hall at golden hour holds six light benches, each a tall black board standing
// upright like a giant textbook ray diagram, with the optical parts mounted in front of it.
//
// BENCH FRAME: a part is authored with X along the bench (the board's u), Y up and Z toward the
// student, and the layout places it at (u, y, BENCH.rayZ) in front of its board, turned with the
// board. Everything a beam passes through is centred on that plane, so a 3-inch marker line runs
// through the middle of the glass.
//
// House rules: feet at scale 1, origin at base centre unless a builder says otherwise, fresh materials
// per call, seededRandom never Math.random. See PropKit.js and LoftKit.js.

export const HL = {
  mirror: '#ff5a4a',
  periscope: '#f2a01c',
  water: '#2f9be0',
  pipe: '#38c76a',
  prism: '#a35cf0',
  lens: '#f4d21f',
  hall: '#e9b86a',
};

const COL = {
  board: 0x0e1218,
  frame: 0x2a2f37,
  steel: 0x8b9199,
  steelDark: 0x464c55,
  silver: 0xdfe7ee,
  black: 0x15171b,
  stone: 0xd9c4a0,
  stoneDark: 0xb99f78,
  stoneDeep: 0x9b815c,
  brick: 0xa4563c,
  brickDark: 0x7d3f2c,
  white: 0xf3f1ea,
  water: 0x3c97d6,
  glass: 0xbfe4ef,
  brass: 0xb8913f,
};

const paint = (extra = {}) => standard({ vertexColors: true, roughness: 0.62, metalness: 0.06, ...extra });
const solid = (parts, extra) => mesh(mergeParts(parts), paint(extra));
const box = (parts, w, h, d, color, at, rotation) => put(parts, new THREE.BoxGeometry(w, h, d), color, at, rotation);

// `revolve` winds by the profile's direction, and a profile written bottom-up comes out inside out.
const lathed = (profile, opts) => revolve([...profile].reverse(), opts);

// Glass and water. Transparent, so each is its own mesh, and none casts a shadow: three.js has no
// light transmission, and a glass block that shadowed the board would put a dark slab behind the beam.
function clear(geometry, color, opacity) {
  const m = mesh(geometry, standard({
    color, transparent: true, opacity, roughness: 0.08, metalness: 0.0, depthWrite: false,
    emissive: color, emissiveIntensity: 0.06,
  }));
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = 2;
  return m;
}

// A flat panel carrying a canvas, a hair proud of the solid it is mounted on. Emissive from the same
// canvas, so it stays legible on a board that faces away from the sun.
function printed(w, h, draw, { pixelsPerFoot = 48, glow = 0.35 } = {}) {
  const texture = canvasTexture(Math.max(8, Math.round(w * pixelsPerFoot)), Math.max(8, Math.round(h * pixelsPerFoot)), draw);
  const m = mesh(new THREE.PlaneGeometry(w, h), standard({
    map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: glow, roughness: 0.85,
  }));
  m.castShadow = false;
  return m;
}

const SANS = 'system-ui, "Helvetica Neue", Arial, sans-serif';

function fitText(ctx, text, weight, size, room) {
  ctx.font = `${weight} ${size}px ${SANS}`;
  const width = ctx.measureText(text).width;
  if (width <= room) return size;
  const fitted = Math.floor((size * room) / width);
  ctx.font = `${weight} ${fitted}px ${SANS}`;
  return fitted;
}

// A post from the ground to a height, with a foot, for anything mounted in front of a board.
function post(parts, x, top, { radius = 0.09, foot = 0.5, z = 0, color = COL.steelDark } = {}) {
  if (top <= 0.05) return;
  const g = new THREE.CylinderGeometry(radius, radius, top, 10);
  put(parts, g, color, [x, top / 2, z]);
  box(parts, foot, 0.08, foot, color, [x, 0.04, z]);
}

// ---------------------------------------------------------------------------
// The light bench
// ---------------------------------------------------------------------------

// A black board ruled in feet, with its number and title in the corner and the station's own normals
// and angles painted on it from the model. Its face is at +thick/2; beams run BENCH.rayZ in front.
//
// `marks` are drawn in bench feet: { kind: 'normal', u, y, angle, length, label } is a dashed line
// through (u, y) at `angle` degrees; { kind: 'dot', u, y, label } a small ring; { kind: 'text', u, y,
// text, size, align } a label. They are for the settings the beams ship with, and the caption says so.
export function lightBench({
  width = BENCH.width, height = BENCH.height, number = 1, title = 'LIGHT BENCH', accent = '#ff5a4a',
  marks = [], caption = '', info = [], infoRight = null,
} = {}) {
  const lift = BENCH.lift;
  const thick = BENCH.thick;
  const parts = [];
  // Frame round the board, and two broad feet so it plainly stands up on its own.
  const fw = 0.22;
  box(parts, width + fw * 2, fw, thick + 0.1, COL.frame, [0, lift + height + fw / 2, 0]);
  box(parts, width + fw * 2, fw, thick + 0.1, COL.frame, [0, lift - fw / 2, 0]);
  box(parts, fw, height + fw * 2, thick + 0.1, COL.frame, [-width / 2 - fw / 2, lift + height / 2, 0]);
  box(parts, fw, height + fw * 2, thick + 0.1, COL.frame, [width / 2 + fw / 2, lift + height / 2, 0]);
  box(parts, width, height, thick, COL.board, [0, lift + height / 2, 0]);
  for (const x of [-width / 2 + 2, width / 2 - 2]) {
    box(parts, 0.7, 0.18, 3.0, COL.frame, [x, 0.09, -0.1]);
    box(parts, 0.4, lift, 0.4, COL.frame, [x, lift / 2, 0]);
  }
  // Ruler ticks along the bottom edge, every foot, so a distance on the board can be read.
  const ppf = 40;
  const face = printed(width, height, (ctx, W, H) => {
    const px = (u) => (u + width / 2) * ppf;
    const py = (y) => H - (y - lift) * ppf;
    ctx.fillStyle = '#0e1218';
    ctx.fillRect(0, 0, W, H);
    // The grid: faint every foot, a little stronger every five.
    for (let u = Math.ceil(-width / 2); u <= width / 2; u++) {
      ctx.strokeStyle = u % 5 === 0 ? 'rgba(170,190,215,0.20)' : 'rgba(150,170,195,0.09)';
      ctx.lineWidth = u % 5 === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(px(u), 0); ctx.lineTo(px(u), H); ctx.stroke();
    }
    for (let y = Math.ceil(lift); y <= lift + height; y++) {
      ctx.strokeStyle = y % 5 === 0 ? 'rgba(170,190,215,0.20)' : 'rgba(150,170,195,0.09)';
      ctx.lineWidth = y % 5 === 0 ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(0, py(y)); ctx.lineTo(W, py(y)); ctx.stroke();
    }
    // Number and title, top left.
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(34, 34, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0e1218';
    ctx.font = `800 28px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 34, 35);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f1e8';
    fitText(ctx, title, 800, 30, W * 0.6);
    ctx.fillText(title, 66, 35);
    if (caption) {
      ctx.fillStyle = 'rgba(230,236,244,0.72)';
      fitText(ctx, caption, 500, 17, W * 0.42);
      ctx.fillText(caption, 66, 64);
    }
    // A few lines of how-to in the top right, which is the part of every bench the beams leave empty.
    if (info.length) {
      ctx.textAlign = 'right';
      info.forEach((line, k) => {
        ctx.fillStyle = k === 0 ? accent : 'rgba(236,240,246,0.9)';
        fitText(ctx, line, k === 0 ? 800 : 600, k === 0 ? 21 : 18, W * 0.4);
        ctx.fillText(line, infoRight == null ? W - 26 : px(infoRight), 34 + k * 25);
      });
      ctx.textAlign = 'left';
    }
    for (const m of marks) {
      if (m.kind === 'normal') {
        const len = m.length ?? 2.4;
        const dx = Math.cos((m.angle * Math.PI) / 180) * len;
        const dy = Math.sin((m.angle * Math.PI) / 180) * len;
        ctx.strokeStyle = 'rgba(235,240,248,0.75)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 9]);
        ctx.beginPath(); ctx.moveTo(px(m.u - dx), py(m.y - dy)); ctx.lineTo(px(m.u + dx), py(m.y + dy)); ctx.stroke();
        ctx.setLineDash([]);
        if (m.label) {
          ctx.fillStyle = 'rgba(235,240,248,0.85)';
          ctx.font = `600 18px ${SANS}`;
          ctx.textAlign = 'left';
          ctx.fillText(m.label, px(m.u + dx) + 6, py(m.y + dy));
        }
      } else if (m.kind === 'arc') {
        // An angle between two directions, both in degrees, centred on (u, y).
        const r = (m.radius ?? 1.3) * ppf;
        ctx.strokeStyle = m.color ?? accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px(m.u), py(m.y), r, -(m.to * Math.PI) / 180, -(m.from * Math.PI) / 180);
        ctx.stroke();
        if (m.label) {
          const mid = ((m.from + m.to) / 2) * (Math.PI / 180);
          ctx.fillStyle = m.color ?? accent;
          ctx.font = `700 20px ${SANS}`;
          ctx.textAlign = 'center';
          ctx.fillText(m.label, px(m.u) + Math.cos(mid) * (r + 22), py(m.y) - Math.sin(mid) * (r + 22));
        }
      } else if (m.kind === 'dot') {
        ctx.strokeStyle = m.color ?? '#f4f1e8';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(px(m.u), py(m.y), 9, 0, Math.PI * 2); ctx.stroke();
        if (m.label) {
          ctx.fillStyle = m.color ?? '#f4f1e8';
          ctx.font = `700 20px ${SANS}`;
          ctx.textAlign = 'left';
          ctx.fillText(m.label, px(m.u) + 14, py(m.y) + (m.below ? 30 : -12));
        }
      } else if (m.kind === 'text') {
        ctx.fillStyle = m.color ?? 'rgba(235,240,248,0.85)';
        ctx.font = `${m.weight ?? 600} ${m.size ?? 18}px ${SANS}`;
        ctx.textAlign = m.align ?? 'left';
        ctx.fillText(m.text, px(m.u), py(m.y));
      }
    }
  }, { pixelsPerFoot: ppf, glow: 0.5 });
  face.position.set(0, lift + height / 2, thick / 2 + 0.01);
  const g = group(solid(parts), face);
  return g;
}

// ---------------------------------------------------------------------------
// Sources and the beam itself
// ---------------------------------------------------------------------------

// A laser on a post. Origin at its APERTURE, which is where its beam starts; `post` is that height
// above the ground. The body is turned to point along `angle`, the beam's own starting direction.
export function laser({ angle = 0, post: height = 4, color = '#ff3b2f', length = 1.7 } = {}) {
  const parts = [];
  const a = (angle * Math.PI) / 180;
  const body = new THREE.CylinderGeometry(0.2, 0.22, length, 16);
  body.rotateZ(Math.PI / 2);
  body.translate(-length / 2 - 0.08, 0, 0);
  body.rotateZ(a);
  parts.push({ geometry: body, color: COL.black });
  const band = new THREE.CylinderGeometry(0.225, 0.225, 0.18, 16);
  band.rotateZ(Math.PI / 2);
  band.translate(-length * 0.7, 0, 0);
  band.rotateZ(a);
  parts.push({ geometry: band, color: new THREE.Color(color).getHex() });
  const nose = new THREE.CylinderGeometry(0.13, 0.2, 0.16, 16);
  nose.rotateZ(-Math.PI / 2);
  nose.translate(-0.08, 0, 0);
  nose.rotateZ(a);
  parts.push({ geometry: nose, color: COL.steel });
  // A yoke from the body down to the post, so the laser is held rather than floating.
  const hold = [-Math.cos(a) * length * 0.55, -Math.sin(a) * length * 0.55];
  box(parts, 0.16, 0.5, 0.16, COL.steelDark, [hold[0], hold[1] - 0.3, 0]);
  const p = [];
  post(p, hold[0], Math.max(0.1, height + hold[1] - 0.5), { radius: 0.1, foot: 0.8 });
  for (const part of p) part.position = [part.position[0], part.position[1] - height, part.position[2]];
  parts.push(...p);
  const lens = mesh(new THREE.CircleGeometry(0.11, 18), standard({ color, emissive: color, emissiveIntensity: 1.2 }));
  lens.rotation.y = Math.PI / 2;
  lens.rotation.order = 'ZYX';
  lens.rotation.z = a;
  lens.position.set(Math.cos(a) * 0.005, Math.sin(a) * 0.005, 0);
  lens.castShadow = false;
  return group(solid(parts, { roughness: 0.45, metalness: 0.2 }), lens);
}

// The beam: a small glowing bead. Its program moves it and its marker draws the line. The marker's
// tip is the object's origin lifted by the tube's radius, so the bead is centred there too.
export function beamBead({ color = '#ff3b2f', radius = 0.17 } = {}) {
  const m = mesh(ball(radius, 16), standard({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.3 }));
  m.position.y = 0.125;
  m.castShadow = false;
  return group(m);
}

// ---------------------------------------------------------------------------
// Mirrors and the periscope
// ---------------------------------------------------------------------------

// The textbook mirror symbol made solid: a silvered top face, and hatching down the front edge that
// marks the back. Metallic mirrors render black here (there is no environment map anywhere in the
// app), so the silver is a pale matte, and the hatching is what says "mirror".
function mirrorPlate(length, thick = 0.26, depth = 1.3) {
  const parts = [];
  box(parts, length, 0.05, depth, COL.silver, [0, -0.025, 0]);
  box(parts, length, thick - 0.05, depth, COL.steelDark, [0, -0.05 - (thick - 0.05) / 2, 0]);
  const plate = solid(parts, { roughness: 0.25, metalness: 0.15 });
  const hatch = printed(length, thick, (ctx, W, H) => {
    ctx.fillStyle = '#dfe7ee';
    ctx.fillRect(0, 0, W, H * 0.2);
    ctx.fillStyle = '#3a4048';
    ctx.fillRect(0, H * 0.2, W, H * 0.8);
    ctx.strokeStyle = '#dfe7ee';
    ctx.lineWidth = 2;
    for (let x = -H; x < W + H; x += 9) {
      ctx.beginPath(); ctx.moveTo(x, H * 0.22); ctx.lineTo(x + H * 0.75, H); ctx.stroke();
    }
  }, { pixelsPerFoot: 64, glow: 0.3 });
  hatch.position.set(0, -thick / 2, depth / 2 + 0.006);
  return group(plate, hatch);
}

// A flat mirror on two legs. Origin at the centre of its reflecting face; `post` is its height.
export function flatMirror({ length = 18.5, post: height = MIRROR.mirrorY } = {}) {
  const legs = [];
  for (const x of [-length / 2 + 1, length / 2 - 1]) {
    post(legs, x, height - 0.26, { radius: 0.1, foot: 0.7 });
  }
  for (const part of legs) part.position = [part.position[0], part.position[1] - height, part.position[2]];
  return group(mirrorPlate(length), solid(legs));
}

// A periscope, cut open down its front so the beam can be seen inside. Origin at the centre of the
// UPPER mirror, which is where the beam turns down; the lower mirror is `drop` below it.
export function periscope({ drop = PERISCOPE.drop, height = PERISCOPE.laser[1], width = 1.5, depth = 1.5 } = {}) {
  const parts = [];
  const wall = 0.16;
  const top = 1.1;
  const bottom = -drop - 1.1;
  const span = top - bottom;
  // The back wall and the two sides, with a hole in the left side at the top and the right at the bottom.
  box(parts, width + wall * 2, span, wall, COL.steelDark, [0, (top + bottom) / 2, -depth / 2]);
  // A side wall with a hole round the beam's height: the light comes in at the top on the left and
  // goes out at the bottom on the right.
  const hole = 0.42;
  const side = (x, at) => {
    box(parts, wall, at - hole - bottom, depth, COL.periscope, [x, (bottom + at - hole) / 2, 0]);
    box(parts, wall, top - at - hole, depth, COL.periscope, [x, (top + at + hole) / 2, 0]);
  };
  side(-width / 2 - wall / 2, 0);
  side(width / 2 + wall / 2, -drop);
  box(parts, width + wall * 2, wall, depth, COL.periscope, [0, top + wall / 2, 0]);
  box(parts, width + wall * 2, wall, depth, COL.periscope, [0, bottom - wall / 2, 0]);
  // The front: only the edges, so it reads as a tube that has been cut open rather than a channel.
  for (const x of [-width / 2 - wall / 2, width / 2 + wall / 2]) box(parts, wall, span, 0.1, COL.steelDark, [x, (top + bottom) / 2, depth / 2]);
  // A stand from the ground.
  const foot = height + bottom - wall;
  if (foot > 0) {
    box(parts, 0.5, foot, 0.5, COL.steelDark, [0, bottom - wall - foot / 2, 0]);
    box(parts, 1.6, 0.1, 1.6, COL.steelDark, [0, -height + 0.05, 0]);
  }
  const g = group(solid(parts, { roughness: 0.55 }));
  // Both mirrors lie at -45 degrees (falling to the right), so flat in turns straight down and back.
  // The silvered face is the side the light arrives from: down-left on the upper mirror, up-right on
  // the lower one. Turning the plate's silvered top to face those ways is 135 and -45 degrees.
  for (const [y, turn] of [[0, (3 * Math.PI) / 4], [-drop, -Math.PI / 4]]) {
    const m = mirrorPlate(width * 1.36, 0.16, depth * 0.9);
    m.rotation.z = turn;
    // The reflecting face passes through the beam's turning point.
    m.position.set(0, y, 0);
    g.add(m);
  }
  return g;
}
COL.periscope = new THREE.Color(HL.periscope).getHex();

// A parapet of brick, to give the periscope something to look over. Origin base centre.
export function brickWall({ width = 1.4, height = PERISCOPE.wall[2], depth = 1.6, seed = 3 } = {}) {
  const parts = [];
  const rand = seededRandom(seed);
  const course = 0.33;
  const rows = Math.round(height / course);
  for (let r = 0; r < rows; r++) {
    const shift = r % 2 ? 0.35 : 0;
    for (let x = -width / 2 - shift; x < width / 2; x += 0.7) {
      const a = Math.max(-width / 2, x);
      const b = Math.min(width / 2, x + 0.7);
      if (b - a < 0.05) continue;
      const tone = new THREE.Color(COL.brick).lerp(new THREE.Color(COL.brickDark), rand() * 0.6);
      box(parts, b - a - 0.03, course - 0.03, depth, tone.getHex(), [(a + b) / 2, r * course + course / 2, 0]);
    }
  }
  box(parts, width + 0.05, rows * course - 0.02, depth - 0.08, 0xcabda6, [0, (rows * course) / 2, 0]);
  box(parts, width + 0.2, 0.14, depth + 0.2, COL.stoneDark, [0, rows * course + 0.07, 0]);
  return group(solid(parts));
}

// The eye at the bottom of the periscope. Origin at the centre of the eye; it looks left, back along
// the beam. `post` is its height.
export function eyeTarget({ post: height = 2.6 } = {}) {
  const parts = [];
  put(parts, ball(0.42, 20), COL.white, [0, 0, 0]);
  // Iris and pupil are closed, flattened balls sunk into the eye, never partial spheres: a partial
  // sphere's rim is a hole wherever it is not buried.
  const iris = ball(0.2, 18);
  iris.scale(0.34, 1, 1);
  iris.translate(-0.375, 0, 0);
  parts.push({ geometry: iris, color: 0x2f7fc8 });
  const pupil = ball(0.1, 14);
  pupil.scale(0.4, 1, 1);
  pupil.translate(-0.43, 0, 0);
  parts.push({ geometry: pupil, color: COL.black });
  const p = [];
  post(p, 0.25, height - 0.3, { radius: 0.08, foot: 0.7 });
  for (const part of p) part.position = [part.position[0], part.position[1] - height, part.position[2]];
  parts.push(...p);
  box(parts, 0.5, 0.08, 0.2, COL.steelDark, [0.12, -0.33, 0]);
  return group(solid(parts, { roughness: 0.35 }));
}

// ---------------------------------------------------------------------------
// Water and glass
// ---------------------------------------------------------------------------

// A glass tank of water on a stand. Origin on the ground under its centre.
export function waterTank({ from = TANK.from, to = TANK.to, floorY = TANK.floorY, surfaceY = TANK.surfaceY, depth = 1.7 } = {}) {
  const length = to - from;
  const parts = [];
  const rim = surfaceY + 0.7;
  const e = 0.09;
  // The frame: four uprights, the rim and the base.
  for (const x of [-length / 2, length / 2]) {
    for (const z of [-depth / 2, depth / 2]) box(parts, e, rim - floorY + e, e, COL.steelDark, [x, (rim + floorY) / 2, z]);
  }
  for (const z of [-depth / 2, depth / 2]) {
    box(parts, length + e, e, e, COL.steelDark, [0, rim, z]);
    box(parts, length + e, e, e, COL.steelDark, [0, floorY - e / 2, z]);
  }
  for (const x of [-length / 2, length / 2]) {
    box(parts, e, e, depth, COL.steelDark, [x, rim, 0]);
    box(parts, e, e, depth, COL.steelDark, [x, floorY - e / 2, 0]);
  }
  // A pale sandy floor inside, so the fish has something to lie on.
  box(parts, length - 0.02, 0.08, depth - 0.02, 0xd8c79e, [0, floorY - 0.04, 0]);
  // The stand.
  box(parts, length * 0.9, 0.16, depth * 0.8, COL.frame, [0, floorY - 0.16, 0]);
  for (const x of [-length * 0.4, length * 0.4]) box(parts, 0.3, floorY - 0.24, depth * 0.6, COL.frame, [x, (floorY - 0.24) / 2, 0]);
  const water = clear(new THREE.BoxGeometry(length - 0.02, surfaceY - floorY, depth - 0.02), COL.water, 0.42);
  water.position.set(0, (surfaceY + floorY) / 2, 0);
  // The surface, drawn as a brighter line so "the light bends HERE" is obvious.
  const line = mesh(new THREE.BoxGeometry(length - 0.02, 0.03, 0.04), standard({ color: 0xbfe9ff, emissive: 0x7cc8f0, emissiveIntensity: 0.6 }));
  line.position.set(0, surfaceY, depth / 2 - 0.02);
  line.castShadow = false;
  return group(solid(parts), water, line);
}

// A fish on the tank floor. Origin under its belly; it faces +X.
export function tankFish({ color = '#f07a2a', size = 1.7 } = {}) {
  const parts = [];
  const c = new THREE.Color(color).getHex();
  const body = ball(0.4, 18);
  body.scale(1.5, 0.75, 0.42);
  body.translate(0, 0.32, 0);
  parts.push({ geometry: body, color: c });
  const tail = new THREE.ConeGeometry(0.3, 0.5, 4);
  tail.scale(1, 1, 0.25);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.78, 0.32, 0);
  parts.push({ geometry: tail, color: c });
  put(parts, ball(0.07, 10), COL.black, [0.38, 0.4, 0.14]);
  put(parts, ball(0.07, 10), COL.black, [0.38, 0.4, -0.14]);
  for (const part of parts) {
    part.geometry = part.geometry.clone().scale(size, size, size);
    if (part.position) part.position = part.position.map((v) => v * size);
  }
  return group(solid(parts, { roughness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0.15 }));
}

// The glass block for the "no answer" activity. Origin on the ground under its centre.
export function glassBlock({ from = BLOCK.from, to = BLOCK.to, bottom = BLOCK.bottom, top = BLOCK.top, depth = 1.6 } = {}) {
  const length = to - from;
  const parts = [];
  box(parts, length + 0.3, 0.14, depth + 0.3, COL.frame, [0, bottom - 0.07, 0]);
  for (const x of [-length * 0.38, length * 0.38]) box(parts, 0.4, bottom - 0.14, depth * 0.6, COL.frame, [x, (bottom - 0.14) / 2, 0]);
  const glass = clear(new THREE.BoxGeometry(length, top - bottom, depth), COL.glass, 0.3);
  glass.position.set(0, (top + bottom) / 2, 0);
  return group(solid(parts), glass);
}

// The acrylic rod. Origin on the ground under its left end, at the rod's own axis height `axisY`.
export function lightRod({ length = FIBRE.length + 0.4, half = FIBRE.half, axisY = FIBRE.start[1], depth = 1.2 } = {}) {
  const parts = [];
  for (const x of [length * 0.18, length * 0.82]) {
    box(parts, 0.3, axisY - half - 0.1, 0.3, COL.frame, [x, (axisY - half - 0.1) / 2, 0]);
    box(parts, 0.9, 0.12, depth + 0.2, COL.frame, [x, axisY - half - 0.06, 0]);
    box(parts, 0.9, 0.1, 0.9, COL.frame, [x, 0.05, 0]);
  }
  // The lamp at the left end, which is where the beam is born.
  box(parts, 0.6, half * 2 + 0.3, depth + 0.1, COL.black, [-0.3, axisY, 0]);
  box(parts, 0.3, 0.2, 0.3, COL.frame, [-0.3, axisY / 2, 0]);
  box(parts, 0.3, axisY - half - 0.15, 0.3, COL.frame, [-0.3, (axisY - half - 0.15) / 2, 0]);
  const rod = clear(new THREE.BoxGeometry(length, half * 2, depth), 0x9fe8c0, 0.32);
  rod.position.set(length / 2, axisY, 0);
  const glow = mesh(new THREE.CircleGeometry(0.16, 18), standard({ color: '#38e06a', emissive: '#38e06a', emissiveIntensity: 1.2 }));
  glow.rotation.y = Math.PI / 2;
  glow.position.set(0.005, axisY, 0);
  glow.castShadow = false;
  return group(solid(parts), rod, glow);
}

// The prism: an equilateral block of dense flint, apex up, on a stand. Origin on the ground under the
// middle of its base.
export function prism({ side = PRISM.side, baseY = PRISM.baseY, depth = 1.5 } = {}) {
  const { left, right, apex } = prismCorners();
  const shift = (side - PRISM.side) / 2;
  const outline = [[left[0] - shift, 0], [right[0] + shift, 0], [apex[0], (apex[1] - baseY) * (side / PRISM.side)]];
  const geometry = extrudeOutline(outline, depth);
  geometry.translate(0, baseY, 0);
  const glass = clear(geometry, 0xd9ccff, 0.34);
  const parts = [];
  box(parts, side + 0.4, 0.16, depth + 0.3, COL.frame, [0, baseY - 0.08, 0]);
  box(parts, 0.5, baseY - 0.16, 0.5, COL.frame, [0, (baseY - 0.16) / 2, 0]);
  box(parts, 1.8, 0.12, 1.8, COL.frame, [0, 0.06, 0]);
  // The edges, drawn so the glass reads as a triangle from across the hall.
  const edge = [];
  const pts = outline.map(([x, y]) => [x, y + baseY]);
  for (let k = 0; k < 3; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % 3];
    for (const z of [-depth / 2, depth / 2]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const g = new THREE.BoxGeometry(len, 0.05, 0.05);
      g.rotateZ(Math.atan2(b[1] - a[1], b[0] - a[0]));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
      edge.push({ geometry: g, color: 0xeee6ff });
    }
  }
  const rim = mesh(mergeParts(edge), standard({ vertexColors: true, emissive: 0x8a7ad0, emissiveIntensity: 0.35, roughness: 0.3 }));
  rim.castShadow = false;
  return group(solid(parts), glass, rim);
}

// A converging lens in a ring holder on a stand, seen in section: its axis runs along the bench, so a
// student facing the board sees the bulging profile every textbook draws. Origin on the ground under
// its centre.
export function convergingLens({ radius = 2.4, thick = 0.75, axisY = LENS.axisY } = {}) {
  const rings = 14;
  const profile = [];
  const bulge = thick / 2;
  // Each face is a shallow sphere cap, thinning to an edge of 0.08 at the rim.
  for (let k = 0; k <= rings; k++) {
    const r = (radius * k) / rings;
    const x = 0.04 + (bulge - 0.04) * (1 - (r / radius) ** 2);
    profile.push([r, x]);
  }
  // Axis to rim on the back face, then rim to axis on the front: a closed profile, written bottom-up.
  const outline = [...profile.map(([r, x]) => [r, -x]), ...[...profile].reverse().map(([r, x]) => [r, x])];
  const geometry = lathed(outline, { segments: 48 });
  geometry.rotateZ(-Math.PI / 2);
  geometry.translate(0, axisY, 0);
  geometry.computeVertexNormals();
  const glass = clear(geometry, 0xd6f3ff, 0.36);
  const parts = [];
  const ring = new THREE.TorusGeometry(radius + 0.06, 0.09, 8, 48);
  ring.rotateY(Math.PI / 2);
  ring.translate(0, axisY, 0);
  parts.push({ geometry: ring, color: COL.brass });
  box(parts, 0.22, axisY - radius - 0.1, 0.22, COL.frame, [0, (axisY - radius - 0.1) / 2, 0]);
  box(parts, 1.4, 0.1, 1.4, COL.frame, [0, 0.05, 0]);
  // The optical axis, a thin rule through the lens, so "height above the middle" means something.
  const axis = new THREE.BoxGeometry(0.02, 0.02, 0.02);
  parts.push({ geometry: axis, color: COL.frame, position: [0, axisY, 0] });
  return group(solid(parts, { roughness: 0.4, metalness: 0.3 }), glass);
}

// A screen that catches the light, ruled in feet above the floor on the face the student sees.
// Origin on the ground at the screen's NEAR face, the face the light arrives at.
export function lightScreen({ top = 10.6, bottom = 0.8, thick = 0.4, depth = 1.7, accent = '#f4d21f' } = {}) {
  const parts = [];
  const h = top - bottom;
  box(parts, thick, h, depth, COL.white, [thick / 2, bottom + h / 2, 0]);
  box(parts, 0.3, bottom, 0.5, COL.frame, [thick / 2, bottom / 2, 0]);
  box(parts, 1.2, 0.1, 1.6, COL.frame, [thick / 2, 0.05, 0]);
  const ruler = printed(thick, h, (ctx, W, H) => {
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(0, 0, W, H);
    const per = H / h;
    for (let y = Math.ceil(bottom * 2) / 2; y <= top; y += 0.5) {
      const py = H - (y - bottom) * per;
      const whole = Math.abs(y - Math.round(y)) < 1e-6;
      ctx.fillStyle = whole ? '#1c2026' : '#6b717a';
      ctx.fillRect(0, py - (whole ? 2 : 1), W * (whole ? 0.55 : 0.3), whole ? 4 : 2);
      if (whole) {
        ctx.font = `700 ${Math.round(W * 0.32)}px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(Math.round(y)), W - 3, py);
      }
    }
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, W, 6);
  }, { pixelsPerFoot: 96, glow: 0.3 });
  ruler.position.set(thick / 2, bottom + h / 2, depth / 2 + 0.006);
  return group(solid(parts), ruler);
}

// The button that clears every beam in the hall. Origin base centre.
export function clearButton({ accent = '#e8372c' } = {}) {
  const parts = [];
  box(parts, 1.4, 3.0, 1.4, COL.frame, [0, 1.5, 0]);
  box(parts, 1.6, 0.14, 1.6, COL.steelDark, [0, 3.07, 0]);
  const cap = lathed([[0, 3.14], [0.55, 3.14], [0.55, 3.3], [0.45, 3.42], [0, 3.46]], { segments: 28 });
  parts.push({ geometry: cap, color: new THREE.Color(accent).getHex() });
  const plate = printed(1.2, 0.8, (ctx, W, H) => {
    ctx.fillStyle = '#15171b';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f4f1e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'CLEAR', 800, Math.round(H * 0.34), W * 0.9);
    ctx.fillText('CLEAR', W / 2, H * 0.36);
    fitText(ctx, 'all the light', 600, Math.round(H * 0.2), W * 0.9);
    ctx.fillText('all the light', W / 2, H * 0.72);
  }, { pixelsPerFoot: 128, glow: 0.4 });
  plate.position.set(0, 2.3, 0.706);
  return group(solid(parts, { roughness: 0.4 }), plate);
}

// ---------------------------------------------------------------------------
// The hall
// ---------------------------------------------------------------------------

// A roofless hall of warm sandstone: paved, walled on three sides with piers and a cornice, a low wall
// with a wide entrance at the back, a raised panel carrying the name over the far wall, and a spectrum
// set into the paving at the centre. Origin at the centre of the floor.
export function hall({
  width = 76, depth = 116, wall = 12, title = 'THE HALL OF LIGHT', centre = [0, 0], entrance = 18,
} = {}) {
  const parts = [];
  const hw = width / 2;
  const hd = depth / 2;
  const t = 1.2;
  const rand = seededRandom(11);
  // Paving: big slabs, each its own shade of sandstone, so the floor has scale.
  const slab = 4;
  for (let x = -hw; x < hw - 0.01; x += slab) {
    for (let z = -hd; z < hd - 0.01; z += slab) {
      const tone = new THREE.Color(COL.stone).lerp(new THREE.Color(COL.stoneDark), rand() * 0.5);
      box(parts, slab - 0.06, 0.12, slab - 0.06, tone.getHex(), [x + slab / 2, 0.06, z + slab / 2]);
    }
  }
  box(parts, width, 0.06, depth, COL.stoneDeep, [0, 0.03, 0]);
  // Walls: the far wall (-Z) and both sides, with piers every 12 ft and a cornice.
  const runs = [
    { from: [-hw, -hd], to: [hw, -hd], h: wall },
    { from: [-hw, -hd], to: [-hw, hd], h: wall },
    { from: [hw, -hd], to: [hw, hd], h: wall },
  ];
  for (const r of runs) {
    const len = Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]);
    const along = r.to[0] !== r.from[0];
    const cx = (r.from[0] + r.to[0]) / 2;
    const cz = (r.from[1] + r.to[1]) / 2;
    const out = along ? [0, Math.sign(cz) * t / 2] : [Math.sign(cx) * t / 2, 0];
    const w = along ? len + t * 2 : t;
    const d = along ? t : len;
    box(parts, w, r.h, d, COL.stone, [cx + out[0], r.h / 2, cz + out[1]]);
    box(parts, along ? w + 0.6 : t + 0.6, 0.6, along ? t + 0.6 : len + 0.6, COL.stoneDark, [cx + out[0], r.h + 0.3, cz + out[1]]);
    box(parts, along ? w + 0.3 : t + 0.3, 0.5, along ? t + 0.3 : len + 0.3, COL.stoneDark, [cx + out[0], 0.25, cz + out[1]]);
    const n = Math.round(len / 12);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const px = r.from[0] + (r.to[0] - r.from[0]) * f;
      const pz = r.from[1] + (r.to[1] - r.from[1]) * f;
      const inward = along ? [0, -Math.sign(cz) * 0.35] : [-Math.sign(cx) * 0.35, 0];
      box(parts, along ? 1.6 : 0.7, r.h + 0.4, along ? 0.7 : 1.6, COL.stoneDark, [px + inward[0] + out[0] * 0.2, (r.h + 0.4) / 2, pz + inward[1] + out[1] * 0.2]);
    }
  }
  // The back wall, low, with the entrance in the middle.
  for (const s of [-1, 1]) {
    const a = s * (entrance / 2);
    const b = s * (hw + t);
    const len = Math.abs(b - a);
    box(parts, len, 3.4, t, COL.stone, [(a + b) / 2, 1.7, hd + t / 2]);
    box(parts, len + 0.4, 0.4, t + 0.4, COL.stoneDark, [(a + b) / 2, 3.6, hd + t / 2]);
    box(parts, 2.2, 6.5, 2.2, COL.stoneDark, [a, 3.25, hd + t / 2]);
    box(parts, 2.6, 0.5, 2.6, COL.stoneDeep, [a, 6.75, hd + t / 2]);
  }
  // The raised panel over the far wall, which carries the name.
  const panelW = 46;
  const panelH = 6.5;
  box(parts, panelW + 1.2, panelH + 0.8, t + 0.4, COL.stoneDark, [0, wall + panelH / 2 + 0.4, -hd - t / 2]);
  box(parts, panelW + 2.2, 0.6, t + 1.0, COL.stoneDeep, [0, wall + panelH + 1.0, -hd - t / 2]);
  // The spectrum in the floor: six sectors round a white heart.
  const discR = 7;
  const [ox, oz] = centre;
  for (let k = 0; k < SPECTRUM.length; k++) {
    const a0 = (k / SPECTRUM.length) * Math.PI * 2;
    const g = new THREE.CircleGeometry(discR, 12, a0, (Math.PI * 2) / SPECTRUM.length);
    g.rotateX(-Math.PI / 2);
    g.translate(ox, 0.125, oz);
    parts.push({ geometry: g, color: new THREE.Color(SPECTRUM[k].hex).lerp(new THREE.Color(COL.stone), 0.25).getHex() });
  }
  const heart = new THREE.CircleGeometry(2, 24);
  heart.rotateX(-Math.PI / 2);
  heart.translate(ox, 0.13, oz);
  parts.push({ geometry: heart, color: 0xf6f1e4 });
  const ringG = new THREE.RingGeometry(discR, discR + 0.5, 48);
  ringG.rotateX(-Math.PI / 2);
  ringG.translate(ox, 0.128, oz);
  parts.push({ geometry: ringG, color: COL.stoneDeep });
  const body = solid(parts, { roughness: 0.85 });
  body.castShadow = true;
  body.receiveShadow = true;
  const name = printed(panelW, panelH - 1, (ctx, W, H) => {
    ctx.fillStyle = '#c7ad83';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = fitText(ctx, title, 800, Math.round(H * 0.62), W * 0.92);
    // A spectrum under the letters, the one place the hall is coloured.
    const grad = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
    SPECTRUM.forEach((c, k) => grad.addColorStop(k / (SPECTRUM.length - 1), c.hex));
    ctx.fillStyle = grad;
    ctx.fillRect(W * 0.1, H * 0.82, W * 0.8, H * 0.07);
    ctx.fillStyle = '#3b2c1c';
    ctx.font = `800 ${size}px ${SANS}`;
    ctx.fillText(title, W / 2, H * 0.45);
  }, { pixelsPerFoot: 24, glow: 0.12 });
  name.position.set(0, wall + panelH / 2 + 0.4, -hd + 0.21);
  return group(body, name);
}
