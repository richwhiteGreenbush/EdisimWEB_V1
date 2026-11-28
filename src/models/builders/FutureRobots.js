import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import { mergeParts, solidLoft, extrudeOutline } from '../../props/LoftKit.js';
import { lathe, tube, outward } from '../ModelKit.js';
import { FUTURE } from '../town/TownKit.js';
import { reducedMotion } from '../../Settings.js';

// Build a Future City: the robots and small flyers.
//
//   helper-robot   a 2ft six-wheeled sidewalk delivery robot, a lidded cargo hatch, a 5ft whip
//                  flag, and a screen face that smiles and BLINKS (its eyes are their own mesh).
//   sweeper-robot  a round orange cleaner 6ft across, two side brushes that SPIN, a clear dome
//                  over a litter bin with litter in it, and a folding grabber arm holding a bottle.
//   hover-scooter  a 5ft glowing deck on three hover pads, no wheels; its card hovers it 1.5ft and
//                  the whole thing BOBS gently on an inner group.
//   cargo-airship  a 90ft rainbow-gored airship, solar panels on its back, a gondola and a slung
//                  cargo pod; its two ducted propellers SPIN. Its card hovers it 40ft.
//
// Real life size in feet, origin at the base centre, front toward +Z. Every lit part is on a
// MeshBasicMaterial glow mesh (no point lights), and each model is at most six meshes. Anything
// that moves is an inner group under a root that never moves, and every motion honours
// reducedMotion() by holding still.

// ---------------------------------------------------------------------------------------------
// Small kit
// ---------------------------------------------------------------------------------------------

const ORANGE = 0xf07a22;
const TYRE = 0x2a2c30;
const RUBBER = 0x34363b;
const DARK = 0x3a3e46;
const SOLAR = 0x2a4b9c;

const clampDt = (dt) => Math.min(Math.max(Number(dt) || 0, 0), 0.1);

function bodyMat() { return standard({ vertexColors: true, roughness: 0.42, metalness: 0.08 }); }
function darkMat() { return standard({ vertexColors: true, roughness: 0.24, metalness: 0.35 }); }
function glowMat() { return new THREE.MeshBasicMaterial({ vertexColors: true }); }

function lists() { return { body: [], dark: [], glow: [] }; }
function add(list, geometry, color, position = null, rotation = null, scale = null) {
  const part = { geometry, color };
  if (position) part.position = position;
  if (rotation) part.rotation = rotation;
  if (scale) part.scale = scale;
  list.push(part);
}
function addM(list, geometry, color, matrix) {
  const g = geometry.clone();
  g.applyMatrix4(matrix);
  list.push({ geometry: g, color });
}
function meshOf(list, material, { shadow = true } = {}) {
  const m = mesh(mergeParts(list), material);
  m.castShadow = shadow;
  return m;
}

// A superellipsoid: a sphere whose coordinates are raised to a power. p = 1 is an ellipsoid,
// p ~ 0.35 a softly rounded box. Welded, so it shades smooth, and closed by construction.
function blob(rx, ry, rz, p = 1, ws = 24, hs = 14) {
  let g = new THREE.SphereGeometry(1, ws, hs);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-5);
  const a = g.attributes.position;
  const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), p);
  for (let i = 0; i < a.count; i++) a.setXYZ(i, f(a.getX(i)) * rx, f(a.getY(i)) * ry, f(a.getZ(i)) * rz);
  g.computeVertexNormals();
  return g;
}

// A cylinder along X (a wheel's axle), Y (default) or Z, closed.
function cyl(r, h, axis = 'y', seg = 20, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return g;
}

// A rod between two points, closed at both ends.
function rod(a, b, r, sides = 8) {
  return tube([a, b], r, { sides, straight: true, steps: 1, round: 1 });
}

// A basis matrix: local x/y/z to the three given world vectors, at a position.
function basis(x, y, z, pos) {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z),
  );
  m.setPosition(pos[0], pos[1], pos[2]);
  return m;
}

// A grid surface whose winding is MEASURED against the normal it is given at a middle cell, so a
// patch can never come out inside out whichever way its (u, v) happens to run.
function gridSurface(nu, nv, pos, nrm) {
  const P = [];
  const N = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      P.push(...pos(i / nu, j / nv));
      N.push(...nrm(i / nu, j / nv));
    }
  }
  const W = nu + 1;
  const ci = Math.floor(nu / 2); const cj = Math.floor(nv / 2);
  const v3 = (k) => new THREE.Vector3(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
  const a0 = v3(cj * W + ci); const b0 = v3(cj * W + ci + 1); const d0 = v3((cj + 1) * W + ci);
  const cross = b0.clone().sub(a0).cross(d0.clone().sub(a0));
  const n0 = new THREE.Vector3(...nrm((ci + 0.5) / nu, (cj + 0.5) / nv));
  const forward = cross.dot(n0) >= 0;
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * W + i; const b = a + 1; const d = a + W; const c = d + 1;
      if (forward) idx.push(a, b, d, b, c, d);
      else idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setIndex(idx);
  return g;
}

// A closed loft along Z from functions of z: half width w(z), height above b(z) up(z), below dn(z).
function loftFn(z0, z1, n, { w, b, up, dn, round = 0.5, roundDn = round, sides = 28 }) {
  const stations = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    // cosine spacing puts more stations at the rounded ends
    const z = z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos(Math.PI * s));
    stations.push({ d: z, w: w(z), b: b(z), up: up(z), dn: dn(z), roundUp: round, roundDn });
  }
  return outward(solidLoft(stations, { sides, samples: n * 2 }));
}

// A flat plate facing +Z, with a canvas on it, lit by its own emissive copy of the canvas.
function screenMat(tex, intensity = 1) {
  return standard({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.3, metalness: 0 });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrink-to-fit text, never clipped.
function fitText(ctx, text, x, y, maxW, size, weight = '700', family = 'Arial, Helvetica, sans-serif') {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------------------------
// helper-robot
// ---------------------------------------------------------------------------------------------
// 2.4ft long, 1.9ft over the tyres, the lid at 1.85ft and the flag's tip at 5ft. The body is a soft
// teal box on six sun-yellow wheels; the pearl lid is the cargo hatch, split from the body by a dark
// seam with a hinge at the back and a glowing latch strip at the front.

const HR = { len: 1.18, half: 0.84, bodyY: 0.95, bodyH: 0.56, wheelR: 0.36, wheelX: 0.99 };

// One canvas, two jobs: the face in the top 140 rows, the side name plate in the bottom 60.
function helperFace() {
  return canvasTexture(256, 200, (ctx, w, hAll) => {
    const h = 140;
    ctx.fillStyle = '#16244a';
    ctx.fillRect(0, h, w, hAll - h);
    ctx.strokeStyle = '#5cf2ff';
    ctx.lineWidth = 4;
    roundRectPath(ctx, 4, h + 4, w - 8, hAll - h - 8, 12);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'HELPER 07', w / 2, h + 31, w - 36, 36, '800');
    ctx.fillStyle = '#0f1d3f';
    ctx.fillRect(0, 0, w, h);
    // a faint scanline glow so the screen reads as a screen
    ctx.fillStyle = 'rgba(92,242,255,0.07)';
    for (let y = 2; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    ctx.strokeStyle = '#5cf2ff';
    ctx.lineCap = 'round';
    // closed, happy eyes: seen only while the open eyes (their own mesh) blink off
    ctx.lineWidth = 9;
    for (const ex of [77, 179]) {
      ctx.beginPath();
      ctx.arc(ex, 60, 17, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
    // the smile
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.arc(128, 62, 44, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    // cheeks
    ctx.fillStyle = 'rgba(255,92,207,0.75)';
    for (const ex of [44, 212]) {
      ctx.beginPath();
      ctx.ellipse(ex, 90, 17, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function helperRobot() {
  const L = lists();
  const root = new THREE.Group();
  const { len, half, bodyY, bodyH, wheelR, wheelX } = HR;

  // THE BODY: teal, with a coral bumper band low down and a pale belly pan.
  add(L.body, blob(half, bodyH, len, 0.32, 28, 18), FUTURE.teal, [0, bodyY, 0]);
  add(L.body, blob(half + 0.035, 0.07, len + 0.035, 0.3, 28, 6), FUTURE.coral, [0, 0.66, 0]);
  add(L.body, blob(half - 0.08, 0.06, len - 0.1, 0.4, 20, 6), FUTURE.pearl, [0, 0.42, 0]);

  // THE LID (cargo hatch): pearl, domed, a dark seam under it, a hinge at the back.
  add(L.body, blob(half - 0.03, 0.27, len - 0.04, 0.38, 28, 14), FUTURE.white, [0, 1.56, -0.01]);
  add(L.dark, blob(half + 0.012, 0.035, len + 0.012, 0.32, 28, 4), DARK, [0, 1.47, 0]);
  add(L.dark, cyl(0.06, 1.1, 'x', 12), DARK, [0, 1.52, -len + 0.02]);
  // a handle recess on the lid's front edge
  add(L.dark, blob(0.22, 0.04, 0.06, 0.5, 12, 6), DARK, [0, 1.58, len - 0.08]);
  // the latch strip glows lime: green means "ready to open"
  add(L.glow, blob(0.3, 0.025, 0.03, 0.5, 12, 4), FUTURE.glowLime, [0, 1.5, len + 0.015]);
  // a sky-blue lid stripe, end to end over the crown
  add(L.body, blob(0.14, 0.27, len - 0.03, 0.38, 14, 10), FUTURE.sky, [0, 1.565, -0.01]);

  // THE FACE: a dark bezel and a glowing screen on the front.
  add(L.dark, blob(0.6, 0.34, 0.07, 0.4, 20, 10), DARK, [0, 1.02, len - 0.02]);
  const remapV = (g, v0, v1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0)); return g; };
  const faceGeo = remapV(new THREE.PlaneGeometry(1.0, 0.54), 0.3, 1);
  const faceParts = [{ geometry: faceGeo, color: 0xffffff, position: [0, 1.02, len + 0.062] }];
  // name plates on both flanks, readable from each side
  for (const sx of [-1, 1]) {
    faceParts.push({ geometry: remapV(new THREE.PlaneGeometry(1.28, 0.3), 0, 0.3), color: 0xffffff, position: [sx * (half + 0.012), 1.12, -0.08], rotation: [0, sx * Math.PI / 2, 0] });
  }
  const face = mesh(mergeParts(faceParts), screenMat(helperFace(), 1.05));
  face.castShadow = false;
  root.add(face);
  // open eyes, a mesh of their own so they can blink
  const eyeParts = [];
  for (const ex of [-0.2, 0.2]) {
    const e = new THREE.CircleGeometry(1, 20);
    eyeParts.push({ geometry: e, color: FUTURE.glowCyan, position: [ex, 1.095, len + 0.068], scale: [0.085, 0.115, 1] });
    const hi = new THREE.CircleGeometry(1, 12);
    eyeParts.push({ geometry: hi, color: 0xffffff, position: [ex + 0.03, 1.13, len + 0.072], scale: [0.025, 0.03, 1] });
  }
  const eyes = mesh(mergeParts(eyeParts), glowMat());
  eyes.castShadow = false;
  root.add(eyes);

  // headlights and sensors under the face; a red tail light and a reflector at the back
  for (const sx of [-1, 1]) {
    add(L.glow, blob(0.12, 0.06, 0.04, 0.6, 12, 6), 0xfff4d6, [sx * 0.55, 0.6, len + 0.03]);
    add(L.dark, blob(0.05, 0.05, 0.03, 1, 10, 6), DARK, [sx * 0.72, 1.3, len - 0.03]);
    add(L.glow, blob(0.16, 0.05, 0.04, 0.6, 12, 6), 0xff3b4e, [sx * 0.45, 0.95, -len - 0.02]);
  }
  add(L.dark, blob(0.42, 0.05, 0.04, 0.5, 16, 6), DARK, [0, 0.52, len + 0.02]);
  // a glowing cyan ring all round the waist: "I'm on"
  add(L.glow, blob(half + 0.045, 0.022, len + 0.045, 0.3, 28, 4), FUTURE.glowCyan, [0, 0.79, 0]);

  // SIX WHEELS on two rocker bogies, sun-yellow hubs.
  for (const sx of [-1, 1]) {
    add(L.body, blob(0.06, 0.08, 0.95, 0.5, 8, 6), FUTURE.pearl, [sx * (half + 0.03), wheelR - 0.02, 0]);
    for (const wz of [-0.82, 0, 0.82]) {
      const p = [sx * wheelX, wheelR - 0.02, wz];
      add(L.dark, cyl(wheelR, 0.24, 'x', 22), TYRE, p);
      add(L.dark, cyl(wheelR * 0.86, 0.255, 'x', 22), RUBBER, p);
      add(L.body, cyl(0.2, 0.27, 'x', 18), FUTURE.sun, p);
      add(L.body, cyl(0.08, 0.29, 'x', 10), FUTURE.coral, p);
    }
  }

  // THE FLAG: a whip pole from a sprung base at the back corner, an orange pennant and a lit tip.
  const fx = 0.52; const fz = -0.86;
  add(L.dark, blob(0.08, 0.1, 0.08, 1, 10, 6), DARK, [fx, 1.78, fz]);
  add(L.dark, rod([fx, 1.78, fz], [fx, 4.95, fz], 0.022, 6), DARK);
  const pennant = outward(extrudeOutline([[0, 0], [0, 0.62], [-0.95, 0.31]], 0.02, { uvFeet: true }));
  // the pennant is lit, an LED flag, so it reads orange from the shady side too
  add(L.glow, pennant, 0xff7a1a, [fx, 4.26, fz - 0.02], [0, -Math.PI / 2, 0]);
  add(L.glow, outward(extrudeOutline([[-0.12, 0.25], [-0.12, 0.37], [-0.55, 0.31]], 0.03)), 0xffd166, [fx, 4.26, fz - 0.02], [0, -Math.PI / 2, 0]);
  add(L.glow, blob(0.06, 0.06, 0.06, 1, 10, 6), FUTURE.glowGold, [fx, 4.98, fz]);

  root.add(meshOf(L.body, bodyMat()));
  root.add(meshOf(L.dark, darkMat()));
  root.add(meshOf(L.glow, glowMat(), { shadow: false }));

  // THE BLINK. The root never moves; only the open eyes switch off for a moment every few seconds.
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) { eyes.visible = true; return; }
      t = (t + clampDt(dt)) % 4.2;
      // one blink every 4.2 seconds, and now and then a quick double
      eyes.visible = !(t > 3.98 || (t > 3.7 && t < 3.82));
    },
    dispose() {},
  };
  return root;
}

// ---------------------------------------------------------------------------------------------
// sweeper-robot
// ---------------------------------------------------------------------------------------------
// 6ft across and 3.1ft to the top of its dome. An orange drum on a rubber bumper, a glowing cyan
// waistband, two big friendly sensor eyes at the front, a teal litter bin under a clear dome, a
// folding grabber arm holding up a bottle it has just picked up, and two side brushes that spin.

function sideBrush(seed) {
  const parts = [];
  const rnd = seededRandom(seed);
  // the hub
  parts.push({ geometry: lathe([[0, -0.07], [0.22, -0.07], [0.26, 0], [0.2, 0.07], [0, 0.08]], 20), color: FUTURE.violet });
  parts.push({ geometry: blob(0.07, 0.04, 0.07, 1, 10, 6), color: FUTURE.sun, position: [0, 0.08, 0] });
  // six arms, each a fan of five bristle tufts that flare out and droop to the ground
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    for (let s = -2; s <= 2; s++) {
      const aa = a + s * 0.075;
      const len = 0.9 + rnd() * 0.1 - Math.abs(s) * 0.03;
      const tip = [Math.cos(aa) * len, -0.15 - rnd() * 0.02, Math.sin(aa) * len];
      const cone = new THREE.ConeGeometry(0.06, len, 6);
      cone.rotateX(-Math.PI / 2);
      cone.translate(0, 0, len / 2);
      const dir = new THREE.Vector3(...tip).normalize();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir.clone().negate(), new THREE.Vector3(0, 1, 0));
      const g = cone.clone();
      g.applyMatrix4(m);
      parts.push({ geometry: g, color: Math.abs(s) === 1 ? 0xffa53d : FUTURE.sun });
    }
    // the arm itself
    parts.push({ geometry: rod([0, 0, 0], [Math.cos(a) * 0.3, -0.03, Math.sin(a) * 0.3], 0.05, 6), color: FUTURE.violet });
  }
  return mergeParts(parts);
}

function sweeperRobot() {
  const L = lists();
  const root = new THREE.Group();
  const rnd = seededRandom(4471);

  // THE DRUM, bottom up, axis to axis.
  add(L.body, lathe([[0, 0.24], [2.6, 0.24], [2.9, 0.36], [2.99, 0.6], [3.0, 1.0], [2.94, 1.36], [2.72, 1.56], [1.6, 1.63], [0, 1.63]], 64), ORANGE);
  // a ring of running lights round the deck, alternating sky and lime
  for (let k = 0; k < 28; k++) {
    const ang = (k / 28) * Math.PI * 2;
    add(L.glow, blob(0.16, 0.02, 0.05, 0.5, 6, 3), k % 2 ? FUTURE.glowLime : FUTURE.glowCyan, [Math.sin(ang) * 2.4, 1.675, Math.cos(ang) * 2.4], [0, ang, 0]);
  }
  // a pearl top deck ring and a sun-yellow trim lip
  add(L.body, lathe([[0, 1.6], [2.62, 1.6], [2.66, 1.64], [2.6, 1.67], [0, 1.67]], 64), FUTURE.pearl);
  add(L.body, new THREE.TorusGeometry(2.86, 0.05, 5, 60), FUTURE.sun, [0, 1.44, 0], [Math.PI / 2, 0, 0]);
  // the rubber bumper and the glowing waistband
  add(L.dark, new THREE.TorusGeometry(2.98, 0.13, 7, 60), RUBBER, [0, 0.45, 0], [Math.PI / 2, 0, 0]);
  add(L.glow, new THREE.TorusGeometry(3.005, 0.045, 5, 60), FUTURE.glowCyan, [0, 0.82, 0], [Math.PI / 2, 0, 0]);
  // drive wheels, half hidden under the skirt
  for (const sx of [-1, 1]) add(L.dark, cyl(0.3, 0.3, 'x', 18), TYRE, [sx * 1.9, 0.28, 0]);
  add(L.dark, blob(0.22, 0.12, 0.22, 1, 12, 6), TYRE, [0, 0.12, -2.0]);
  add(L.dark, blob(0.22, 0.12, 0.22, 1, 12, 6), TYRE, [0, 0.12, 1.7]);
  // suction mouth under the front, glowing violet
  add(L.glow, blob(1.0, 0.04, 0.16, 0.4, 16, 4), FUTURE.glowPink, [0, 0.23, 2.25]);

  // THE EYES: two round sensor housings with glowing lenses and a white highlight each.
  for (const sx of [-1, 1]) {
    const x = sx * 0.62; const z = Math.sqrt(2.985 * 2.985 - x * x);
    add(L.body, cyl(0.32, 0.24, 'z', 24), FUTURE.white, [x, 1.12, z]);
    add(L.dark, cyl(0.25, 0.04, 'z', 24), DARK, [x, 1.12, z + 0.12]);
    add(L.body, new THREE.TorusGeometry(0.31, 0.045, 6, 24), FUTURE.violet, [x, 1.12, z + 0.12]);
    add(L.glow, blob(0.22, 0.22, 0.06, 1, 18, 10), FUTURE.glowCyan, [x, 1.12, z + 0.13]);
    add(L.glow, blob(0.09, 0.09, 0.04, 1, 10, 6), 0x1b3d73, [x, 1.1, z + 0.185]);
    add(L.glow, blob(0.045, 0.045, 0.02, 1, 8, 4), 0xffffff, [x + 0.07, 1.19, z + 0.21]);
  }
  // a little lime smile of LEDs under the eyes
  for (let k = -3; k <= 3; k++) {
    const a = Math.PI / 2 - k * 0.055;
    const yy = 0.68 + 0.012 * k * k;
    add(L.glow, blob(0.055, 0.035, 0.03, 1, 8, 4), FUTURE.glowLime, [Math.cos(a) * 3.0, yy, Math.sin(a) * 3.0], [0, Math.PI / 2 - a, 0]);
  }

  // THE LITTER BIN: an open teal tub on the deck, with today's litter heaped in it.
  add(L.body, lathe([[0, 1.62], [1.36, 1.62], [1.36, 2.12], [1.26, 2.12], [1.26, 1.72], [0, 1.72]], 48), FUTURE.teal);
  const litterCols = [0xeeeeea, 0xe9d9a8, 0xd94a3a, 0x3d8fd6, 0x5bb54a, 0xf2c13a, 0xc9c2b4];
  for (let i = 0; i < 14; i++) {
    const r = Math.sqrt(rnd()) * 1.0; const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    const y = 1.82 + rnd() * 0.32 * (1 - r * 0.5);
    const kind = i % 3;
    const col = litterCols[Math.floor(rnd() * litterCols.length)];
    if (kind === 0) add(L.body, blob(0.17, 0.15, 0.16, 0.9, 7, 5), col, [x, y, z], [rnd() * 3, rnd() * 3, 0]);
    else if (kind === 1) add(L.body, cyl(0.1, 0.34, 'y', 10), col, [x, y, z], [Math.PI / 2, rnd() * 3, 0]);
    else add(L.body, blob(0.24, 0.03, 0.15, 0.7, 8, 4), col, [x, y + 0.05, z], [0.2, rnd() * 3, 0.15]);
  }
  // a crumpled cup poking up over the rim
  add(L.body, cyl(0.1, 0.4, 'y', 12, 0.15), FUTURE.magenta, [0.4, 2.15, -0.3], [0.3, 0, 0.4]);

  // THE DOME: a closed glass shell (outer and inner surface), seated on a glowing lime ring.
  const shell = [[0, 1.66 + 1.4]];
  for (let i = 8; i >= 0; i--) { const a = (i / 9) * Math.PI / 2; shell.push([Math.cos(a) * 1.44, 1.66 + Math.sin(a) * 1.4]); }
  for (let i = 0; i <= 8; i++) { const a = (i / 9) * Math.PI / 2; shell.push([Math.cos(a) * 1.5, 1.66 + Math.sin(a) * 1.46]); }
  shell.push([0, 1.66 + 1.46]);
  const domeGeo = outward(lathe(shell, 40));
  const dome = mesh(domeGeo, standard({ color: 0xbfe8f2, transparent: true, opacity: 0.22, roughness: 0.06, metalness: 0, depthWrite: false }));
  dome.castShadow = false;
  dome.receiveShadow = false;
  add(L.glow, new THREE.TorusGeometry(1.52, 0.05, 5, 40), FUTURE.glowLime, [0, 1.68, 0], [Math.PI / 2, 0, 0]);
  add(L.dark, new THREE.TorusGeometry(1.5, 0.08, 5, 40), DARK, [0, 1.66, 0], [Math.PI / 2, 0, 0]);
  add(L.dark, blob(0.12, 0.05, 0.12, 1, 10, 6), DARK, [0, 3.12, 0]);

  // A BEACON on a short post at the back: amber means "working".
  add(L.dark, cyl(0.08, 0.4, 'y', 10), DARK, [0, 1.85, -2.2]);
  add(L.glow, blob(0.18, 0.2, 0.18, 1, 14, 8), FUTURE.glowGold, [0, 2.12, -2.2]);
  add(L.body, cyl(0.22, 0.06, 'y', 14), FUTURE.white, [0, 2.0, -2.2]);
  // two antenna whiskers
  for (const sx of [-1, 1]) {
    add(L.dark, rod([sx * 0.55, 1.65, -1.9], [sx * 0.85, 2.55, -2.25], 0.025, 6), DARK);
    add(L.glow, blob(0.06, 0.06, 0.06, 1, 8, 6), FUTURE.glowPink, [sx * 0.85, 2.57, -2.25]);
  }

  // THE GRABBER ARM, folded at the elbow, holding up a green bottle by its neck.
  const sh = [1.62, 1.72, 1.32]; const el = [1.86, 3.0, 2.15]; const wr = [2.12, 2.62, 3.25];
  add(L.dark, cyl(0.26, 0.2, 'y', 18), DARK, [sh[0], 1.68, sh[2]]);
  add(L.body, blob(0.18, 0.18, 0.18, 1, 12, 8), FUTURE.violet, sh);
  add(L.body, rod(sh, el, 0.1, 10), FUTURE.white);
  add(L.body, blob(0.15, 0.15, 0.15, 1, 12, 8), FUTURE.violet, el);
  add(L.body, rod(el, wr, 0.085, 10), FUTURE.white);
  add(L.body, blob(0.13, 0.13, 0.13, 1, 12, 8), FUTURE.violet, wr);
  add(L.glow, new THREE.TorusGeometry(0.1, 0.02, 4, 14), FUTURE.glowCyan, [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2], [0.6, 0, 0]);
  // the bottle, hanging below the wrist
  const bx = wr[0]; const bz = wr[2] + 0.05;
  add(L.body, lathe([[0, 0], [0.16, 0], [0.18, 0.04], [0.18, 0.44], [0.12, 0.56], [0.06, 0.62], [0.06, 0.72], [0, 0.72]], 18), 0x37b866, [bx, 1.68, bz]);
  add(L.body, cyl(0.183, 0.16, 'y', 18), FUTURE.white, [bx, 1.68 + 0.26, bz]);
  add(L.body, cyl(0.07, 0.07, 'y', 12), FUTURE.sky, [bx, 1.68 + 0.74, bz]);
  // two fingers round the neck
  for (const sz of [-1, 1]) {
    const tip = [bx, 2.3, bz + sz * 0.09];
    add(L.dark, rod([wr[0], wr[1] - 0.05, wr[2] + sz * 0.05], [bx, 2.46, bz + sz * 0.13], 0.035, 6), DARK);
    add(L.dark, rod([bx, 2.46, bz + sz * 0.13], tip, 0.033, 6), DARK);
  }

  root.add(meshOf(L.body, bodyMat()));
  root.add(meshOf(L.dark, darkMat()));
  root.add(meshOf(L.glow, glowMat(), { shadow: false }));
  root.add(dome);

  // THE SIDE BRUSHES, under the front corners, turning toward each other to sweep litter inward.
  const brushes = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 1.95, 0.2, 1.88);
    const b = mesh(sideBrush(90 + sx), bodyMat());
    pivot.add(b);
    pivot.userData.spin = sx;
    root.add(pivot);
    brushes.push(pivot);
  }
  root.userData.tick = {
    update(dt) {
      const step = clampDt(dt);
      const speed = reducedMotion() ? 0 : 4.5;
      for (const p of brushes) p.rotation.y = (p.rotation.y + p.userData.spin * speed * step) % (Math.PI * 2);
    },
    dispose() {},
  };
  return root;
}

// ---------------------------------------------------------------------------------------------
// hover-scooter
// ---------------------------------------------------------------------------------------------
// A 5ft violet deck with a glowing pink rim, on three hover pads that glow cyan underneath. The
// stem rises at the front to a 3.4ft handlebar with a small screen facing the rider. The lowest
// point, the bottom of the pads, is at y = 0; the card lifts it 1.5ft.

const SC = { half: 2.5, deckY: 0.74, w: 0.72 };

function scooterScreen() {
  return canvasTexture(256, 160, (ctx, w, h) => {
    ctx.fillStyle = '#101a38';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5cf2ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    fitText(ctx, '12', 92, 98, 120, 84, '800');
    ctx.fillStyle = '#bfe9ff';
    fitText(ctx, 'MPH', 92, 132, 110, 26, '700');
    // battery
    ctx.strokeStyle = '#b6ff5c';
    ctx.lineWidth = 5;
    roundRectPath(ctx, 172, 30, 56, 104, 8);
    ctx.stroke();
    ctx.fillStyle = '#b6ff5c';
    ctx.fillRect(190, 20, 20, 10);
    for (let i = 0; i < 4; i++) ctx.fillRect(181, 112 - i * 24, 38, 17);
    // a hover glyph: three arcs over a line
    ctx.strokeStyle = '#ff5ccf';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(20, 24); ctx.lineTo(60, 24); ctx.stroke();
  });
}

function deckW(z) {
  const e = Math.abs(z) - (SC.half - 0.42);
  if (e <= 0) return SC.w;
  return Math.max(0.12, SC.w * Math.sqrt(Math.max(0, 1 - (e / 0.42) ** 2)));
}

function hoverScooter() {
  const L = lists();
  const root = new THREE.Group();
  const inner = new THREE.Group();
  root.add(inner);
  const { half, deckY } = SC;

  // THE DECK: violet, a rounded slab with tapered ends; a dark grip pad on top; a glowing pink rim.
  add(L.body, loftFn(-half, half, 18, { w: deckW, b: () => deckY, up: () => 0.11, dn: () => 0.13, round: 0.42, sides: 24 }), FUTURE.violet);
  add(L.dark, loftFn(-half + 0.35, half - 0.55, 14, { w: (z) => deckW(z) - 0.1, b: () => deckY + 0.105, up: () => 0.025, dn: () => 0.02, round: 0.3, sides: 16 }), 0x3b3463);
  add(L.glow, loftFn(-half + 0.01, half - 0.01, 18, { w: (z) => deckW(z) + 0.03, b: () => deckY - 0.01, up: () => 0.035, dn: () => 0.035, round: 0.5, sides: 12 }), FUTURE.glowPink);
  // lime chevrons on the grip pad, pointing forward
  for (let k = 0; k < 3; k++) {
    const z = -1.0 + k * 0.55;
    for (const sx of [-1, 1]) {
      add(L.glow, blob(0.2, 0.012, 0.035, 0.5, 8, 4), FUTURE.glowLime, [sx * 0.13, deckY + 0.13, z], [0, sx * 0.65, 0]);
    }
  }
  // an aqua stripe down each flank
  for (const sx of [-1, 1]) add(L.body, blob(0.02, 0.04, 1.6, 0.4, 6, 4), FUTURE.aqua, [sx * (SC.w + 0.012), deckY + 0.06, 0]);

  // THE PADS: three, coral housings, a cyan lens underneath and a cyan ring round each.
  for (const [pz, s] of [[-1.62, 1], [0, 0.78], [1.62, 1]]) {
    // a pearl housing under the deck, a coral collar, and a glowing cyan dome bulging out beneath
    add(L.body, lathe([[0, 0.3], [0.56 * s, 0.3], [0.62 * s, 0.36], [0.62 * s, 0.5], [0.5 * s, deckY - 0.05], [0, deckY - 0.05]], 32), FUTURE.pearl, [0, 0, pz]);
    add(L.body, new THREE.TorusGeometry(0.63 * s, 0.05, 6, 32), FUTURE.coral, [0, 0.43, pz], [Math.PI / 2, 0, 0]);
    add(L.glow, lathe([[0, 0], [0.24 * s, 0.025], [0.42 * s, 0.1], [0.52 * s, 0.2], [0.55 * s, 0.32], [0, 0.32]], 32), FUTURE.glowCyan, [0, 0, pz]);
    add(L.dark, new THREE.TorusGeometry(0.565 * s, 0.035, 5, 32), DARK, [0, 0.31, pz], [Math.PI / 2, 0, 0]);
  }

  // THE STEM AND HANDLEBAR.
  const s0 = [0, deckY + 0.1, half - 0.48]; const s1 = [0, 3.32, half - 0.7];
  add(L.dark, blob(0.2, 0.14, 0.24, 0.6, 14, 8), DARK, [0, deckY + 0.14, half - 0.46]);
  add(L.body, rod(s0, s1, 0.085, 12), FUTURE.white);
  const onStem = (y) => { const f = (y - s0[1]) / (s1[1] - s0[1]); return [0, y, s0[2] + (s1[2] - s0[2]) * f + 0.075]; };
  add(L.glow, rod(onStem(1.3), onStem(2.75), 0.022, 6), FUTURE.glowCyan);
  add(L.dark, blob(0.13, 0.12, 0.13, 1, 12, 8), DARK, s1);
  const barPts = [[-0.95, 3.44, half - 0.72], [-0.45, 3.37, half - 0.7], [0, 3.36, half - 0.7], [0.45, 3.37, half - 0.7], [0.95, 3.44, half - 0.72]];
  add(L.body, tube(barPts, 0.055, { sides: 10, steps: 16, round: 1 }), FUTURE.white);
  for (const sx of [-1, 1]) {
    add(L.dark, rod([sx * 0.6, 3.385, half - 0.705], [sx * 0.93, 3.435, half - 0.72], 0.075, 10), RUBBER);
    add(L.glow, blob(0.08, 0.08, 0.08, 1, 10, 6), FUTURE.glowGold, [sx * 0.97, 3.44, half - 0.72]);
    // brake levers
    add(L.dark, rod([sx * 0.55, 3.39, half - 0.64], [sx * 0.85, 3.4, half - 0.56], 0.02, 6), DARK);
  }
  // headlight on the front of the stem, tail light at the back of the deck
  add(L.glow, blob(0.13, 0.09, 0.05, 0.7, 14, 8), 0xfff6dc, [0, 2.95, half - 0.6]);
  add(L.dark, blob(0.17, 0.13, 0.06, 0.6, 14, 8), DARK, [0, 2.95, half - 0.66]);
  add(L.glow, blob(0.32, 0.05, 0.06, 0.6, 12, 6), 0xff3b4e, [0, deckY + 0.02, -half + 0.03]);

  // THE SCREEN, on the stem below the bar, tilted back toward the rider.
  const n = [0, 0.6, -0.8]; const xr = [-1, 0, 0]; const yu = [0, 0.8, 0.6];
  const sp = [0, 3.12, half - 0.79];
  addM(L.dark, blob(0.29, 0.2, 0.05, 0.4, 16, 8), DARK, basis(xr, yu, n, sp));
  const scr = new THREE.PlaneGeometry(0.48, 0.3);
  scr.applyMatrix4(basis(xr, yu, n, [sp[0] + n[0] * 0.052, sp[1] + n[1] * 0.052, sp[2] + n[2] * 0.052]));
  const screen = mesh(scr, screenMat(scooterScreen(), 1.0));
  screen.castShadow = false;

  inner.add(meshOf(L.body, bodyMat()));
  inner.add(meshOf(L.dark, darkMat()));
  inner.add(meshOf(L.glow, glowMat(), { shadow: false }));
  inner.add(screen);

  // THE BOB: up and down a couple of inches on the inner group, never below its resting height.
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) { inner.position.y = 0; return; }
      t = (t + clampDt(dt)) % (Math.PI * 2 / 2.1);
      inner.position.y = 0.04 * (1 - Math.cos(t * 2.1));
      inner.rotation.z = 0.012 * Math.sin(t * 2.1);
    },
    dispose() {},
  };
  return root;
}

// ---------------------------------------------------------------------------------------------
// cargo-airship
// ---------------------------------------------------------------------------------------------
// The envelope is 90ft long and 26ft across, its axis 26ft up. Twelve gores alternate pearl white
// with a rainbow of colours, each gore its own vertex columns so the stripes are razor sharp. Solar
// panels run along the white gore on top, a gondola hangs under the nose, and a sun-yellow cargo
// pod hangs on cables under the belly: its bottom is the model's lowest point, at y = 0.

const AS = { L: 45, R: 13, cy: 26, s0: 0.12 };

function envR(z) {
  const s = THREE.MathUtils.clamp(z / AS.L, -1, 1);
  if (s >= AS.s0) {
    const q = (s - AS.s0) / (1 - AS.s0);
    return AS.R * Math.sqrt(Math.max(0, 1 - q * q));
  }
  const q = (AS.s0 - s) / (1 + AS.s0);
  return AS.R * Math.pow(Math.max(0, 1 - q * q), 0.85);
}
function envDR(z) {
  const e = 0.02;
  const zc = THREE.MathUtils.clamp(z, -AS.L + e, AS.L - e);
  return (envR(zc + e) - envR(zc - e)) / (2 * e);
}
// a point on the envelope at bearing phi (0 = +X, pi/2 = top) and station z, lifted `lift` feet
function envPoint(phi, z, lift = 0) {
  const r = envR(z) + lift;
  return [Math.cos(phi) * r, AS.cy + Math.sin(phi) * r, z];
}
function envNormal(phi, z) {
  if (z <= -AS.L + 1e-4) return [0, 0, -1];
  if (z >= AS.L - 1e-4) return [0, 0, 1];
  const v = new THREE.Vector3(Math.cos(phi), Math.sin(phi), -envDR(z)).normalize();
  return [v.x, v.y, v.z];
}

function cargoSign() {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1b2448';
    roundRectPath(ctx, 0, 0, w, h, 26);
    ctx.fill();
    ctx.strokeStyle = '#5cf2ff';
    ctx.lineWidth = 6;
    roundRectPath(ctx, 6, 6, w - 12, h - 12, 22);
    ctx.stroke();
    // a parcel glyph
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(28, 34, 60, 60);
    ctx.fillStyle = '#1b2448';
    ctx.fillRect(54, 34, 8, 60);
    ctx.fillRect(28, 50, 60, 6);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'CLOUD CARGO', 108, 58, 380, 64, '800');
    ctx.fillStyle = '#b6ff5c';
    fitText(ctx, 'SLOW, QUIET, SUN POWERED', 110, 104, 370, 20, '700');
  });
}

function propeller() {
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const g = blob(0.34, 1.0, 0.07, 0.8, 8, 6);
    g.rotateY(0.45);
    g.translate(0, 1.12, 0);
    g.rotateZ((k / 5) * Math.PI * 2);
    parts.push({ geometry: g, color: FUTURE.white });
    const tip = blob(0.3, 0.22, 0.08, 0.8, 6, 4);
    tip.rotateY(0.45);
    tip.translate(0, 1.95, 0);
    tip.rotateZ((k / 5) * Math.PI * 2);
    parts.push({ geometry: tip, color: FUTURE.coral });
  }
  const spinner = lathe([[0, -0.4], [0.42, -0.4], [0.4, 0.1], [0.25, 0.45], [0, 0.6]], 18);
  spinner.rotateX(Math.PI / 2);
  parts.push({ geometry: spinner, color: FUTURE.sun });
  return mergeParts(parts);
}

function cargoAirship() {
  const L = lists();
  const root = new THREE.Group();
  const { L: HL, cy } = AS;

  // THE ENVELOPE: twelve gores, white centred on top so the solar panels sit on a white stripe.
  const gores = 12; const cols = 4; const rows = 36;
  const rainbow = [FUTURE.coral, FUTURE.sun, FUTURE.lime, FUTURE.aqua, FUTURE.sky, FUTURE.violet];
  const zAt = (v) => -HL * Math.cos(Math.PI * v);
  for (let gi = 0; gi < gores; gi++) {
    const p0 = Math.PI / 2 - Math.PI / gores + (gi * 2 * Math.PI) / gores;
    const p1 = p0 + (2 * Math.PI) / gores;
    const geo = gridSurface(cols, rows,
      (u, v) => envPoint(p0 + (p1 - p0) * u, zAt(v)),
      (u, v) => envNormal(p0 + (p1 - p0) * u, zAt(v)));
    const color = gi % 2 === 0 ? FUTURE.white : rainbow[((gi - 1) / 2) % rainbow.length];
    add(L.body, geo, color);
  }
  // a glowing cyan spine on top, a glowing belly line, nose cap and tail light
  const spine = []; const belly = [];
  for (let i = 0; i <= 24; i++) {
    spine.push(envPoint(Math.PI / 2, -27 + (i / 24) * 52, 0.02));
    belly.push(envPoint(-Math.PI / 2, -33 + (i / 24) * 34, 0.02));
  }
  add(L.glow, tube(spine, 0.16, { sides: 6, steps: 30, round: 1 }), FUTURE.glowCyan);
  add(L.glow, tube(belly, 0.16, { sides: 6, steps: 24, round: 1 }), FUTURE.glowPink);
  add(L.body, blob(1.6, 1.6, 0.9, 1, 14, 8), FUTURE.violet, [0, cy, HL - 0.55]);
  add(L.glow, new THREE.TorusGeometry(1.62, 0.12, 6, 28), FUTURE.glowGold, [0, cy, HL - 0.6]);
  add(L.glow, blob(0.5, 0.5, 0.9, 1, 10, 8), 0xffffff, [0, cy, -HL + 0.2]);

  // THE TAIL FINS, in an X, violet with a lit trailing edge and a nav light at each tip.
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + (k * Math.PI) / 2;
    const outline = [];
    for (let i = 0; i <= 8; i++) { const z = -42.5 + (i / 8) * 17; outline.push([z, envR(z) - 0.8]); }
    outline.push([-27.0, envR(-27.0) + 1.6], [-33, 12.8], [-38.5, 13.5], [-42.0, 13.0], [-43.6, envR(-43.6) + 2.4]);
    const fin = outward(extrudeOutline(outline.reverse(), 0.7));
    const x = [0, 0, 1]; const y = [Math.cos(phi), Math.sin(phi), 0]; const zz = [-Math.sin(phi), Math.cos(phi), 0];
    const m = basis(x, y, zz, [0, cy, 0]);
    addM(L.body, fin, FUTURE.violet, m);
    addM(L.glow, rod([-41.9, 12.98, 0], [-38.5, 13.47, 0], 0.17, 6), FUTURE.glowPink, m);
    addM(L.body, rod([-33.1, 12.75, 0], [-38.4, 13.45, 0], 0.42, 8), FUTURE.sun, m);
    // a nav light at each fin tip: red to port (+X), green to starboard (-X)
    addM(L.glow, blob(0.36, 0.36, 0.36, 1, 8, 5), Math.cos(phi) > 0 ? 0xff4a5a : 0x5cff8a, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(-38.4, 13.75, 0)));
  }

  // SOLAR PANELS: two rows of eleven along the white gore, each tangent to the envelope.
  for (const side of [-1, 1]) {
    const phi = Math.PI / 2 + side * 0.15;
    for (let i = 0; i < 11; i++) {
      const z = -24 + i * 4.5;
      const n = envNormal(phi, z);
      const t = new THREE.Vector3(Math.cos(phi) * envDR(z), Math.sin(phi) * envDR(z), 1).normalize();
      const nv = new THREE.Vector3(...n);
      const s = new THREE.Vector3().crossVectors(nv, t).normalize();
      const p = envPoint(phi, z, -0.05);
      const m = basis([s.x, s.y, s.z], n, [t.x, t.y, t.z], p);
      addM(L.body, new THREE.BoxGeometry(3.0, 0.22, 4.1), FUTURE.pearl, m);
      addM(L.dark, new THREE.BoxGeometry(2.8, 0.12, 3.9), SOLAR, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0.13, 0)));
      addM(L.body, new THREE.BoxGeometry(2.8, 0.13, 0.06), 0xb7c3d6, new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeTranslation(0, 0.135, 0)));
    }
  }

  // THE GONDOLA, under the nose: pearl, a coral keel, a dark window band and a lit strip under it.
  const gz0 = 3; const gz1 = 20;
  const gw = (z) => { const a = THREE.MathUtils.clamp((z - gz0) / (gz1 - gz0), 0, 1); return 3.5 * Math.pow(Math.max(0, 1 - (2 * a - 1) ** 4), 0.32); };
  const gUp = (z) => 0.4 + gw(z) * 0.65;
  const gDn = (z) => 0.25 + gw(z) * 0.6;
  const bandTop = (z) => Math.min(12.75, 11.4 + gUp(z) * 0.8);
  const bandBot = (z) => Math.max(11.55, 11.4 + gUp(z) * 0.05);
  const GS = 18;
  add(L.body, loftFn(gz0, gz1, 12, { w: gw, b: () => 11.4, up: gUp, dn: gDn, round: 0.42, sides: GS }), FUTURE.white);
  add(L.body, loftFn(gz0 + 0.3, gz1 - 0.3, 10, { w: (z) => gw(z) + 0.04, b: (z) => 11.4 - gDn(z) * 0.66, up: (z) => gDn(z) * 0.12, dn: (z) => gDn(z) * 0.39, round: 0.42, sides: GS }), FUTURE.coral);
  add(L.dark, loftFn(gz0 + 2.0, gz1 - 0.5, 12, { w: (z) => gw(z) + 0.06, b: (z) => (bandTop(z) + bandBot(z)) / 2, up: (z) => (bandTop(z) - bandBot(z)) / 2, dn: (z) => (bandTop(z) - bandBot(z)) / 2, round: 0.35, sides: GS }), FUTURE.glass);
  add(L.glow, loftFn(gz0 + 2.2, gz1 - 1.2, 10, { w: (z) => gw(z) + 0.08, b: () => 11.25, up: () => 0.09, dn: () => 0.09, round: 0.5, sides: 12 }), FUTURE.glowCyan);
  // window mullions, as body-colour pillars across the band
  for (let i = 0; i < 6; i++) {
    const z = gz0 + 4 + i * 2.4;
    for (const sx of [-1, 1]) add(L.body, new THREE.BoxGeometry(0.12, 1.3, 0.22), FUTURE.white, [sx * (gw(z) + 0.1), 12.1, z]);
  }

  // THE PROPELLERS: two ducted fans on pylons off the gondola. The blades are their own meshes.
  const props = [];
  for (const sx of [-1, 1]) {
    const c = [sx * 9.6, 10.8, 9.5];
    add(L.body, rod([sx * 3.0, 11.0, 9.5], [sx * 7.0, 10.8, 9.5], 0.42, 10), FUTURE.pearl);
    add(L.body, new THREE.TorusGeometry(2.55, 0.36, 7, 28), FUTURE.coral, c, null, [1, 1, 2.4]);
    add(L.glow, new THREE.TorusGeometry(2.22, 0.07, 4, 28), FUTURE.glowCyan, [c[0], c[1], c[2] + 0.6]);
    add(L.dark, rod([c[0], c[1], c[2] - 1.0], [c[0], c[1], c[2] - 0.2], 0.3, 10), DARK);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      add(L.dark, rod([c[0], c[1], c[2] - 0.7], [c[0] + Math.cos(a) * 2.3, c[1] + Math.sin(a) * 2.3, c[2] - 0.7], 0.07, 6), DARK);
    }
    // nav light on the duct's outer side: red to port (+X), green to starboard (-X)
    add(L.glow, blob(0.3, 0.3, 0.3, 1, 8, 5), sx > 0 ? 0xff4a5a : 0x5cff8a, [c[0] + sx * 2.95, c[1], c[2]]);
    const pivot = new THREE.Group();
    pivot.position.set(c[0], c[1], c[2] + 0.1);
    pivot.add(mesh(propeller(), bodyMat()));
    pivot.userData.spin = sx;
    root.add(pivot);
    props.push(pivot);
  }

  // THE CARGO POD: a sun-yellow container with violet ribs, slung on four cables, lit name boards.
  const pz = -6;
  add(L.body, blob(4.0, 3.0, 8.0, 0.3, 22, 12), FUTURE.sun, [0, 3.0, pz]);
  for (const rz of [-5.7, 5.7]) add(L.body, blob(4.08, 3.08, 0.3, 0.3, 24, 6), FUTURE.violet, [0, 3.0, pz + rz]);
  add(L.dark, blob(2.6, 0.2, 6.4, 0.4, 16, 6), DARK, [0, 6.0, pz]);
  for (const sx of [-1, 1]) {
    for (const dz of [-5.5, 5.5]) {
      const top = envPoint(-Math.PI / 2 + sx * 0.32, pz + dz * 1.1, -0.6);
      add(L.dark, rod([sx * 2.4, 5.9, pz + dz], top, 0.09, 6), DARK);
      add(L.body, blob(0.25, 0.25, 0.25, 1, 6, 4), FUTURE.white, [sx * 2.4, 6.05, pz + dz]);
    }
  }
  // a lit stripe round the pod's base
  add(L.glow, blob(4.03, 0.08, 8.03, 0.3, 28, 4), FUTURE.glowLime, [0, 0.9, pz]);
  // the pod's name boards, one each side, readable from both sides
  const signParts = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.PlaneGeometry(9.0, 2.25);
    g.rotateY(sx * Math.PI / 2);
    g.translate(sx * 4.035, 3.25, pz);
    signParts.push({ geometry: g, color: 0xffffff });
  }
  const sign = mesh(mergeParts(signParts), screenMat(cargoSign(), 1.0));
  sign.castShadow = false;

  root.add(meshOf(L.body, bodyMat()));
  root.add(meshOf(L.dark, darkMat()));
  root.add(meshOf(L.glow, glowMat(), { shadow: false }));
  root.add(sign);

  root.userData.tick = {
    update(dt) {
      const step = clampDt(dt);
      const speed = reducedMotion() ? 0 : 7;
      for (const p of props) p.rotation.z = (p.rotation.z + p.userData.spin * speed * step) % (Math.PI * 2);
    },
    dispose() {},
  };
  return root;
}

export const BUILDERS = {
  'helper-robot': helperRobot,
  'sweeper-robot': sweeperRobot,
  'hover-scooter': hoverScooter,
  'cargo-airship': cargoAirship,
};

