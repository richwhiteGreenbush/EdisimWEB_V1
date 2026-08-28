import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, relief, mergedMesh,
} from '../PropKit.js';
import {
  solidLoft, revolve, extrudeOutline, sweepProfile, mouldedRing,
  ball, tube, chain, mergeParts, tintGeometry, placed, xformed, smoothed,
  roundedOutline, put, smoothNoise3,
} from './LoftKit.js';

// The Neighborhood -- a mid-century American model town read from its own main street,
// modelled on the miniature neighborhood of a certain television program's opening
// titles: brick school and factory blocks at the back, painted clapboard shops and
// houses down the middle, a street network with a trolley track down Main Street, and
// mid-century cars parked at the curbs. Won't you be my neighbor?
//
// THE THREE HERO FAMILIES ARE THE BUILDINGS, THE STREET AND THE CARS, and one decision
// carries all three: SURFACE COURSES ARE TEXTURE, NEVER GEOMETRY AND NEVER TINT. A
// building's wall is a flat extruded shell with no interior vertices, so a per-vertex
// clapboard tint has nothing to land on (the villi-floor lesson), and courses as
// geometry are thousands of solids per facade (the Greenbush lesson). Every wall and
// roof here instead carries a NEAR-WHITE tileable canvas -- courses, mortar, shingle
// butts as luminance only -- multiplied by the material's own colour, so ONE clapboard
// tile serves a mustard shop, a barn-red block and a white cottage. extrudeOutline lays
// its UVs out in FEET, which is exactly what makes a 0.45ft board course land at 0.45ft
// on every building regardless of size.
//
// Windows are BUILT FORWARD OF A SOLID WALL (the Machu niche / Ellis Registry rule):
// dark pane a hair proud, muntins proud of that, frame and sill projecting furthest.
// Lit panes go to a separate emissive mesh -- in the reference model the big red block
// glows with rows of warm yellow windows, and that glow is most of its identity.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette -- 1968 Americana, named so the world stays one deck of paint chips
// ---------------------------------------------------------------------------

export const NB = {
  // The street
  asphalt: 0x484b50,
  asphaltOld: 0x585b60,
  sidewalk: 0xbdb6a6,
  curb: 0xa9a293,
  dash: 0xe3bc3a,
  line: 0xe9e5da,
  rail: 0x97917f,
  trackway: 0x3f4246,

  // The trolley
  trolleyRed: 0xb03430,
  trolleyDeep: 0x7e2420,
  trolleyGold: 0xe0b054,
  trolleyCream: 0xf0e4c4,
  trolleyRoof: 0x5f2a24,

  // Masonry
  brick: 0x9c4a38,
  brickSchool: 0xa85340,
  brickDeep: 0x7d4234,
  factoryBrick: 0x8f6048,
  stoneBase: 0x9d9788,

  // Clapboard
  clapRed: 0xb23a30,
  clapYellow: 0xdfa83e,
  clapCream: 0xeee2c8,
  clapWhite: 0xf1eddf,
  clapBlue: 0x8093c5,
  clapSage: 0x93aa7c,
  clapGreen: 0x51795b,
  clapGray: 0xb9bdc0,
  clapOrange: 0xd08040,
  barnBrown: 0x7a4c30,

  // Roofs
  roofGray: 0x70747a,
  roofSlate: 0x585e66,
  roofRed: 0xa23a2c,
  roofGreen: 0x4c6851,
  roofBrown: 0x6d4c36,
  roofDark: 0x42444a,
  roofTan: 0xa89478,

  // Trim and joinery
  trim: 0xf3f0e6,
  trimCream: 0xe7ddc2,
  trimDark: 0x4c4438,
  doorRed: 0x8e2f28,
  doorBlue: 0x3c5a8b,
  doorGreen: 0x3e6648,
  brass: 0xc9a24a,

  // Glass
  glass: 0x232a33,
  glassLit: 0xffd987,
  glassSky: 0x8ba4b4,

  // The cars
  carGreen: 0x4b7c4e,
  carBlue: 0x305080,
  carSilver: 0xc3c7ca,
  carRed: 0xa23a30,
  carTan: 0xc2a06c,
  carTeal: 0x4e8a8c,
  carCream: 0xece6d6,
  tyre: 0x24262a,
  chrome: 0xd7dade,

  // Planting and ground furniture
  leaf: 0x4d7d3c,
  leafDeep: 0x3a6330,
  autumn: 0xcf7a2e,
  autumnDeep: 0xa85a22,
  goldLeaf: 0xd6a836,
  conifer: 0x3c5f42,
  coniferDeep: 0x2c4a34,
  trunk: 0x5d4530,
  bark: 0x4c3a2a,
  rock: 0x9b968e,
  rockDeep: 0x6f6a62,
  hydrant: 0xc03a2c,
  mailbox: 0x2c4a78,
  fence: 0xf0ece0,
  soil: 0x6a5238,
};

const col = (hex) => new THREE.Color(hex);
const mixCol = (a, b, t) => col(a).lerp(col(b), t);

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// `revolve` decides its winding from the profile's direction: a bottom-up profile comes
// out inside out and renders DARK, not missing. Everything here lathes through this.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON the axis is an open tube.
function closedProfile(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// mergeParts composes its Euler as Rx*Ry*Rz, so "turn in plan, then lay flat" cannot be
// said with one Euler. Bake the matrix in the order actually wanted (RobotProps' laid).
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

// A plain box geometry. BoxGeometry keeps separate vertices per face, so its corners
// shade flat -- which is exactly what sawn lumber and stamped steel want.
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// A rectangle outline with DOUBLED corner points, so the extruded shell's wall faces do
// not share corner vertices. extrudeOutline's side band shares one vertex per outline
// point, and computeVertexNormals then rounds every corner of the building into a
// pillow edge -- doubling the point (offset by a hair, so no zero-length edge confuses
// the run-length UVs) gives each wall its own corner vertex and a crisp arris.
function cornerRect(halfW, halfH, e = 0.004) {
  return [
    [halfW, -halfH + e], [halfW, halfH - e], [halfW - e, halfH],
    [-halfW + e, halfH], [-halfW, halfH - e], [-halfW, -halfH + e],
    [-halfW + e, -halfH], [halfW - e, -halfH],
  ];
}

// Shrink-to-fit text on a canvas: measured, never guessed.
function fitText(ctx, text, maxWidth, px, font) {
  let size = px;
  for (; size > 8; size -= 1) {
    ctx.font = font.replace('{px}', String(size));
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

// A small canvas-textured plate (a shop sign, a STOP face, a clock dial). A separate
// mesh, because a material cannot carry both a map and vertex colours without
// multiplying them -- the plate always sits proud of a solid backing behind it.
function texPlate(w, h, texW, texH, draw, { rough = 0.72, emissive = 0 } = {}) {
  const texture = canvasTexture(texW, texH, draw);
  const params = { map: texture, roughness: rough };
  if (emissive > 0) {
    params.emissive = new THREE.Color(0xffffff);
    params.emissiveMap = texture;
    params.emissiveIntensity = emissive;
  }
  return mesh(new THREE.PlaneGeometry(w, h), standard(params));
}

// ---------------------------------------------------------------------------
// Tileable surface canvases -- NEAR-WHITE, multiplied by the material's colour
// ---------------------------------------------------------------------------

// The CANVAS is cached (it is CPU-side and safe to share); the THREE.Texture wrapping
// it is FRESH per call, because disposeObject3D destroys a removed prop's maps outright
// -- the same one-level-lower rule SurfaceTextures.js follows for its images.
const TILE_CANVAS = new Map();

function tileCanvas(key, px, draw) {
  if (!TILE_CANVAS.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    draw(canvas.getContext('2d'), px);
    TILE_CANVAS.set(key, canvas);
  }
  return TILE_CANVAS.get(key);
}

const rnd = (seed) => seededRandom(seed);

// Value helper: greyscale fill around a near-white mean.
function grey(ctx, v) {
  const b = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  ctx.fillStyle = `rgb(${b},${b},${b})`;
}

// Horizontal clapboard: courses of `exposure` feet across a `tileFt` tile. Each board a
// slightly different value, a dark shadow line under every butt edge.
function clapboardCanvas() {
  return tileCanvas('clapboard', 128, (ctx, px) => {
    const r = rnd(11);
    const tileFt = 4;
    const exposure = 0.5;
    const rows = Math.round(tileFt / exposure);
    const rowPx = px / rows;
    for (let i = 0; i < rows; i++) {
      grey(ctx, 0.94 + r() * 0.06);
      ctx.fillRect(0, i * rowPx, px, rowPx);
      // NO vertical joints -- they turned every clapboard wall into brick. The whole
      // clapboard read is the shadow under each butt edge and the lit strip below it.
      grey(ctx, 0.55);
      ctx.fillRect(0, (i + 1) * rowPx - 3, px, 3);
      grey(ctx, 1.0);
      ctx.fillRect(0, i * rowPx, px, 1.6);
    }
  });
}

// Running-bond brick: 0.22ft courses over a 2ft tile, per-brick value variation.
function brickCanvas() {
  return tileCanvas('brick', 128, (ctx, px) => {
    const r = rnd(23);
    const rows = 9;
    const rowPx = px / rows;
    const brickW = px / 4;
    grey(ctx, 0.68); // mortar
    ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < rows; i++) {
      const off = (i % 2) * brickW * 0.5;
      for (let j = -1; j < 5; j++) {
        grey(ctx, 0.84 + r() * 0.16);
        ctx.fillRect(((off + j * brickW) % px + px) % px, i * rowPx + 1.2, brickW - 1.6, rowPx - 2.2);
      }
    }
  });
}

// Shingle courses: 0.42ft over a 3.4ft tile, staggered butts with butt shadows.
function shingleCanvas() {
  return tileCanvas('shingle', 128, (ctx, px) => {
    const r = rnd(37);
    const rows = 8;
    const rowPx = px / rows;
    for (let i = 0; i < rows; i++) {
      grey(ctx, 0.9 + r() * 0.1);
      ctx.fillRect(0, i * rowPx, px, rowPx);
      const shift = r() * px;
      const tabs = 7;
      for (let j = 0; j <= tabs; j++) {
        grey(ctx, 0.8 + r() * 0.14);
        ctx.fillRect((shift + (j * px) / tabs) % px, i * rowPx, px / tabs - 1.4, rowPx - 1.6);
      }
      grey(ctx, 0.58);
      ctx.fillRect(0, (i + 1) * rowPx - 2.2, px, 2.2);
    }
  });
}

// Vertical barn boards over a 3ft tile.
function boardsCanvas() {
  return tileCanvas('boards', 128, (ctx, px) => {
    const r = rnd(53);
    const cols = 8;
    const colPx = px / cols;
    for (let i = 0; i < cols; i++) {
      grey(ctx, 0.88 + r() * 0.12);
      ctx.fillRect(i * colPx, 0, colPx, px);
      grey(ctx, 0.6);
      ctx.fillRect((i + 1) * colPx - 1.8, 0, 1.8, px);
      // grain streaks
      grey(ctx, 0.8 + r() * 0.1);
      ctx.fillRect(i * colPx + colPx * 0.3, 0, 1, px);
    }
  });
}

// Sidewalk concrete: fine speckle with an expansion-joint border. The tile is 6ft and
// the UVs are laid in feet, so the joints land every six feet by construction.
function concreteCanvas() {
  return tileCanvas('concrete', 128, (ctx, px) => {
    const r = rnd(67);
    grey(ctx, 0.93);
    ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < 900; i++) {
      grey(ctx, 0.82 + r() * 0.18);
      ctx.fillRect(r() * px, r() * px, 1.4, 1.4);
    }
    grey(ctx, 0.66);
    ctx.fillRect(0, 0, px, 2.4);
    ctx.fillRect(0, 0, 2.4, px);
  });
}

// Asphalt: aggregate speckle plus broad tonal patches. 4ft tile.
function asphaltCanvas() {
  return tileCanvas('asphalt', 128, (ctx, px) => {
    const r = rnd(83);
    grey(ctx, 0.9);
    ctx.fillRect(0, 0, px, px);
    for (let b = 0; b < 7; b++) {
      grey(ctx, 0.84 + r() * 0.1);
      ctx.beginPath();
      ctx.arc(r() * px, r() * px, px * (0.14 + r() * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1300; i++) {
      grey(ctx, 0.78 + r() * 0.26);
      ctx.fillRect(r() * px, r() * px, 1.2, 1.2);
    }
  });
}

const SURFACES = {
  clapboard: { canvas: clapboardCanvas, tileFt: 4 },
  brick: { canvas: brickCanvas, tileFt: 2 },
  shingle: { canvas: shingleCanvas, tileFt: 3.4 },
  boards: { canvas: boardsCanvas, tileFt: 3 },
  concrete: { canvas: concreteCanvas, tileFt: 6 },
  asphalt: { canvas: asphaltCanvas, tileFt: 4 },
};

// A material whose colour is `colour` and whose courses come from a near-white tile.
// The same canvas rides again as the bumpMap, the accepted "its light and dark ARE its
// relief" pattern -- a texture's dispose() is idempotent.
function surfaceMat(kind, colour, { rough = 0.85, bump = 0.5 } = {}) {
  const spec = SURFACES[kind];
  const texture = new THREE.CanvasTexture(spec.canvas());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1 / spec.tileFt, 1 / spec.tileFt);
  return standard({ color: colour, map: texture, bumpMap: texture, bumpScale: bump, roughness: rough });
}

// ---------------------------------------------------------------------------
// Window and door joinery -- appended to a building's part lists
// ---------------------------------------------------------------------------

// A wall FACE the joinery is applied to: axis-aligned, since every building here is
// authored facing +Z. `yaw` turns each authored-facing-+Z part to the face; `at(dx, y)`
// is a point on the face plane, dx feet along the viewer-of-the-face's right from its
// centre -- the same frame windowAt/doorAt measure their own offsets in.
function wallFace(side, halfW, halfD) {
  if (side === 'front') return { yaw: 0, at: (dx, y) => [dx, y, halfD] };
  if (side === 'back') return { yaw: Math.PI, at: (dx, y) => [-dx, y, -halfD] };
  if (side === 'east') return { yaw: Math.PI / 2, at: (dx, y) => [halfW, y, -dx] };
  return { yaw: -Math.PI / 2, at: (dx, y) => [-halfW, y, dx] };
}

// A double-hung window built FORWARD of the wall plane at `at` with outward yaw `yaw`.
// Pane 0.03 proud, muntins 0.055, frame 0.10, sill projecting 0.16. `lit` panes go to
// the emissive list, dark ones to the trim list in glass colour.
function windowAt(trim, glow, at, yaw, {
  w = 2.2, h = 3.4, lit = false, trimCol = NB.trim, glassCol = NB.glass,
  muntinsX = 1, muntinsY = 1, sill = true, shutters = null, frame = 0.1,
} = {}) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // local (dx, dy, out) -> world around `at` turned by yaw
  const p = (dx, dy, out) => [at[0] + dx * c + out * s, at[1] + dy, at[2] - dx * s + out * c];
  const add = (list, colour, geometry, dx, dy, out) => put(list, geometry, colour, p(dx, dy, out), [0, yaw, 0]);

  // pane
  add(lit ? glow : trim, lit ? NB.glassLit : glassCol, boxG(w, h, 0.05), 0, 0, 0.03);
  // muntins
  for (let i = 1; i <= muntinsX; i++) {
    add(trim, trimCol, boxG(0.07, h, 0.04), -w / 2 + (i * w) / (muntinsX + 1), 0, 0.065);
  }
  for (let i = 1; i <= muntinsY; i++) {
    add(trim, trimCol, boxG(w, 0.09, 0.04), 0, -h / 2 + (i * h) / (muntinsY + 1), 0.065);
  }
  // frame: two jambs, head, and a stool rail
  add(trim, trimCol, boxG(0.16, h + 0.28, 0.1), -w / 2 - 0.07, 0, 0.06);
  add(trim, trimCol, boxG(0.16, h + 0.28, 0.1), w / 2 + 0.07, 0, 0.06);
  add(trim, trimCol, boxG(w + 0.44, 0.2, 0.12), 0, h / 2 + 0.12, 0.07);
  if (sill) add(trim, trimCol, boxG(w + 0.5, 0.14, 0.3), 0, -h / 2 - 0.09, 0.12);
  if (shutters) {
    add(trim, shutters, boxG(w * 0.42, h + 0.1, 0.06), -w / 2 - 0.18 - w * 0.21, 0, 0.05);
    add(trim, shutters, boxG(w * 0.42, h + 0.1, 0.06), w / 2 + 0.18 + w * 0.21, 0, 0.05);
  }
}

// A panelled door with frame, brass knob and a step. `lightOver` adds a lit transom.
function doorAt(trim, glow, at, yaw, {
  w = 3.2, h = 6.8, colour = NB.doorRed, trimCol = NB.trim, lightOver = false, step = true,
} = {}) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (dx, dy, out) => [at[0] + dx * c + out * s, at[1] + dy, at[2] - dx * s + out * c];
  const add = (list, colr, geometry, dx, dy, out) => put(list, geometry, colr, p(dx, dy, out), [0, yaw, 0]);

  add(trim, colour, boxG(w, h, 0.14), 0, h / 2, 0.07);
  // two recess panels read as a door rather than a slab
  add(trim, mixCol(colour, 0x000000, 0.25).getHex(), boxG(w * 0.62, h * 0.3, 0.03), 0, h * 0.68, 0.15);
  add(trim, mixCol(colour, 0x000000, 0.25).getHex(), boxG(w * 0.62, h * 0.34, 0.03), 0, h * 0.28, 0.15);
  add(trim, NB.brass, new THREE.SphereGeometry(0.09, 10, 8), w * 0.32, h * 0.52, 0.17);
  add(trim, trimCol, boxG(0.2, h + 0.2, 0.16), -w / 2 - 0.1, (h + 0.2) / 2 - 0.1, 0.08);
  add(trim, trimCol, boxG(0.2, h + 0.2, 0.16), w / 2 + 0.1, (h + 0.2) / 2 - 0.1, 0.08);
  add(trim, trimCol, boxG(w + 0.6, 0.24, 0.18), 0, h + 0.12, 0.09);
  if (lightOver) add(glow, NB.glassLit, boxG(w * 0.7, 0.5, 0.05), 0, h + 0.55, 0.04);
  if (step) add(trim, NB.sidewalk, boxG(w + 1.2, 0.35, 1.4), 0, 0.17, 0.7);
}

// ---------------------------------------------------------------------------
// Roof helpers
// ---------------------------------------------------------------------------

// A gable roof as two pitched slabs with real thickness, a ridge cap, and closing
// gable-end soffit boards. Slabs are extrudeOutline (feet UVs, so the shingle courses
// tile true) laid flat then pitched via a baked matrix.
function gableRoof(parts, {
  width, depth, eaveY, ridgeRise, overhang = 0.9, thick = 0.28, ridgeAxis = 'x', colour = 0xffffff,
}) {
  // ridgeAxis 'x': ridge runs along X (gables face +-X). 'z': ridge along Z.
  const span = (ridgeAxis === 'x' ? depth : width) / 2 + overhang;
  const run = (ridgeAxis === 'x' ? width : depth) + overhang * 2;
  const slope = Math.hypot(span, ridgeRise);
  const pitch = Math.atan2(ridgeRise, span);
  const slab = extrudeOutline(cornerRect(run / 2, slope / 2), thick);
  for (const side of [1, -1]) {
    const tip = side > 0 ? pitch : -pitch;
    const yawBase = ridgeAxis === 'x' ? 0 : Math.PI / 2;
    const m = new THREE.Matrix4().makeRotationY(yawBase)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + tip));
    const g = xformed(slab, m);
    const midY = eaveY + ridgeRise / 2 + (thick / 2) / Math.cos(pitch) - 0.02;
    const off = side * (span / 2);
    const pos = ridgeAxis === 'x' ? [0, midY, off] : [off, midY, 0];
    put(parts, g, colour, pos, null, { keepColor: false });
  }
  // ridge cap
  const capLen = run + 0.1;
  const cap = ridgeAxis === 'x' ? boxG(capLen, 0.22, 0.7) : boxG(0.7, 0.22, capLen);
  put(parts, cap, mixCol(colour, 0x000000, 0.2).getHex(), [0, eaveY + ridgeRise + thick / 2 + 0.04, 0]);
  return { pitch, slope };
}

// The triangular gable infill above the eave line on a gable-end wall, as an extruded
// wedge in the wall's own siding (a separate skin part, since the wall shell stops at
// the eave). Authored for gables facing +-X when ridgeAxis is 'x'.
function gableEnd(halfSpan, rise, thick) {
  return extrudeOutline([[-halfSpan, 0], [halfSpan, 0], [0.004, rise], [-0.004, rise]], thick);
}

// A brick chimney with a corbelled cap and dark flue.
function chimney(parts, { at, w = 1.6, d = 1.3, top, colour = NB.brick }) {
  put(parts, boxG(w, top - at[1], d), colour, [at[0], at[1] + (top - at[1]) / 2, at[2]]);
  put(parts, boxG(w + 0.34, 0.5, d + 0.34), mixCol(colour, 0x000000, 0.15).getHex(), [at[0], top + 0.25, at[2]]);
  put(parts, boxG(w * 0.5, 0.34, d * 0.5), 0x2a2422, [at[0], top + 0.55, at[2]]);
}

// ---------------------------------------------------------------------------
// The building shell -- extruded plan, siding texture, its own skin mesh
// ---------------------------------------------------------------------------

// One clapboard/brick wall band from the plan rectangle: an extruded shell stood
// upright, top closed (the cap is the ceiling plane -- invisible under the roof but it
// keeps the solid closed). Returns the MESH, textured in feet.
function wallShell(kind, colour, halfW, halfD, height, { rough, bump } = {}) {
  const g = extrudeOutline(cornerRect(halfW, halfD), height, { capStart: true, capEnd: true });
  g.rotateX(-Math.PI / 2);
  g.translate(0, height / 2, 0);
  return mesh(g, surfaceMat(kind, colour, { rough, bump }));
}

// Assembles the standard four meshes of a building. `skinExtra` merges into the wall
// mesh's geometry family only when it shares the wall material -- gables pass through
// here so the siding courses continue up the peak.
function buildingGroup({ walls, roofParts, trim, glow, extraMeshes = [] }) {
  const g = group();
  for (const w of walls) g.add(w);
  if (roofParts && roofParts.mesh) g.add(roofParts.mesh);
  if (trim && trim.length) {
    g.add(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.78, ...relief('wood', { seed: 9, repeat: 5, strength: 0.35 }) })));
  }
  if (glow && glow.length) {
    const glowMesh = mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.4,
      emissive: new THREE.Color(0xffc86a), emissiveIntensity: 0.85,
    }));
    glowMesh.castShadow = false;
    g.add(glowMesh);
  }
  for (const m of extraMeshes) g.add(m);
  return g;
}

// A roof slab set in shingle texture, merged into one mesh per building.
function roofMesh(parts, colour, kind = 'shingle') {
  const merged = mergeParts(parts.map((p) => ({ ...p, keepColor: false, color: 0xffffff })));
  return mesh(merged, surfaceMat(kind, colour, { rough: 0.9, bump: 0.55 }));
}

// ---------------------------------------------------------------------------
// HOUSES
// ---------------------------------------------------------------------------

// A neighborhood house: one or two storeys of clapboard, a gable roof, a panelled door,
// double-hung windows (optionally shuttered), a chimney and an optional entry porch.
// `ridgeAxis: 'x'` runs the ridge across the front (long eave to the street); 'z' turns
// the gable end to the street, which is the other half of the image's houses.
export function nbHouse({
  seed = 1, width = 18, depth = 14, storeys = 2,
  colour = NB.clapYellow, roofColour = NB.roofRed, trimCol = NB.trim,
  doorCol = NB.doorRed, shutters = null, porch = true, ridgeAxis = 'x',
  ridgeRise = null, chimneyOn = true,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const eaveY = storeys === 1 ? 9 : 16.5;
  const rise = ridgeRise ?? (ridgeAxis === 'x' ? halfD : halfW) * 0.72;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, eaveY);

  // Gable infills in the same siding, so the courses continue up the peak.
  const gableThick = 0.35;
  if (ridgeAxis === 'x') {
    for (const side of [1, -1]) {
      const g = gableEnd(halfD - 0.01, rise, gableThick);
      put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side * Math.PI / 2)),
        0xffffff, [side * (halfW - gableThick / 2), eaveY, 0]);
    }
  } else {
    for (const side of [1, -1]) {
      const g = gableEnd(halfW - 0.01, rise, gableThick);
      put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI)),
        0xffffff, [0, eaveY, side * (halfD - gableThick / 2)]);
    }
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('clapboard', colour));

  gableRoof(roof, { width, depth, eaveY, ridgeRise: rise, colour: 0xffffff, ridgeAxis });

  // Corner boards -- what makes clapboard read as carpentry rather than wallpaper.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      put(trim, boxG(0.34, eaveY, 0.34), trimCol, [sx * (halfW - 0.06), eaveY / 2, sz * (halfD - 0.06)]);
    }
  }

  // Front: door + windows. Two-storey fronts get a matching upper row.
  const F = wallFace('front', halfW, halfD);
  const doorDx = width >= 16 ? -width * 0.24 : 0;
  doorAt(trim, glow, F.at(doorDx, 0), F.yaw, { colour: doorCol, trimCol, lightOver: true });
  const winDx = width >= 16 ? [width * 0.16, width * 0.36] : [width * 0.3];
  for (const dx of winDx) {
    windowAt(trim, glow, F.at(dx, 4.6), F.yaw, { trimCol, shutters, lit: rng() < 0.5 });
  }
  if (storeys === 2) {
    for (const dx of [-width * 0.3, 0, width * 0.3]) {
      windowAt(trim, glow, F.at(dx, 12.6), F.yaw, { trimCol, shutters, lit: rng() < 0.4, h: 3.1 });
    }
  }
  // Sides
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-depth * 0.22, depth * 0.22]) {
      windowAt(trim, glow, S.at(dx, 4.6), S.yaw, { trimCol, shutters, lit: rng() < 0.35, w: 2 });
      if (storeys === 2) windowAt(trim, glow, S.at(dx, 12.6), S.yaw, { trimCol, shutters, lit: rng() < 0.35, w: 2, h: 3 });
    }
  }

  if (porch) {
    const pw = width * 0.46;
    const px = doorDx;
    put(trim, boxG(pw, 0.5, 5), NB.trimCream, [px, 0.25, halfD + 2.5]);
    for (const sx of [-pw / 2 + 0.4, pw / 2 - 0.4]) {
      put(trim, boxG(0.42, 8.2, 0.42), trimCol, [px + sx, 4.4, halfD + 4.4]);
    }
    const porchRoof = extrudeOutline(cornerRect(pw / 2 + 0.5, 2.9), 0.24);
    put(roof, xformed(porchRoof, new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.32)),
      0xffffff, [px, 8.9, halfD + 2.7]);
    put(trim, boxG(pw + 0.8, 0.3, 1.6), NB.sidewalk, [px, 0.15, halfD + 5.6]);
  }

  if (chimneyOn) {
    chimney(trim, {
      at: [halfW * 0.5, eaveY - 2, ridgeAxis === 'x' ? 0 : -halfD * 0.3],
      top: eaveY + rise + 2.4,
    });
  }

  return buildingGroup({
    walls: [wall],
    roofParts: { mesh: roofMesh(roof, roofColour) },
    trim, glow, extraMeshes: [skinExtra],
  });
}

// The big colonial from the image's right edge: a five-bay symmetric front, three
// dormers in the roof, end chimneys, and shutters on everything.
export function nbColonial({
  seed = 2, width = 26, depth = 16, colour = NB.clapCream, roofColour = NB.roofGray,
  trimCol = NB.trim, shutters = 0x3e5a48, doorCol = NB.doorBlue,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const eaveY = 17;
  const rise = halfD * 0.9;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, eaveY);
  for (const side of [1, -1]) {
    const g = gableEnd(halfD - 0.01, rise, 0.35);
    put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side * Math.PI / 2)),
      0xffffff, [side * (halfW - 0.18), eaveY, 0]);
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('clapboard', colour));
  const { pitch } = gableRoof(roof, { width, depth, eaveY, ridgeRise: rise, colour: 0xffffff, ridgeAxis: 'x' });

  const F = wallFace('front', halfW, halfD);
  doorAt(trim, glow, F.at(0, 0), F.yaw, { colour: doorCol, trimCol, lightOver: true, w: 3.4 });
  // Pilastered entry with a little pediment -- the one formal note a colonial insists on.
  for (const sx of [-2.2, 2.2]) put(trim, boxG(0.5, 8, 0.3), trimCol, F.at(sx, 4).map((v, i) => (i === 2 ? v + 0.12 : v)));
  put(trim, xformed(boxG(5.6, 0.5, 0.5), new THREE.Matrix4()), trimCol, [0, 8.3, halfD + 0.2]);
  for (const dx of [-width * 0.34, -width * 0.17, width * 0.17, width * 0.34]) {
    windowAt(trim, glow, F.at(dx, 4.6), F.yaw, { trimCol, shutters, lit: rng() < 0.45 });
  }
  for (const dx of [-width * 0.34, -width * 0.17, 0, width * 0.17, width * 0.34]) {
    windowAt(trim, glow, F.at(dx, 13), F.yaw, { trimCol, shutters, lit: rng() < 0.35, h: 3.1 });
  }
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const y of [4.6, 13]) windowAt(trim, glow, S.at(0, y), S.yaw, { trimCol, shutters, w: 2, h: 3, lit: rng() < 0.3 });
  }

  // Three roof dormers: a box just proud of the roof plane, its own little gable, a window.
  const dormZ = halfD * 0.32;
  const dormY = eaveY + rise * 0.44;
  for (const dx of [-width * 0.26, 0, width * 0.26]) {
    put(trim, boxG(3.2, 3.4, 3.4), colour, [dx, dormY + 0.4, dormZ + 1.2]);
    const dr = [];
    gableRoof(dr, { width: 3.4, depth: 3.6, eaveY: 0, ridgeRise: 1.5, colour: 0xffffff, ridgeAxis: 'z', overhang: 0.3, thick: 0.2 });
    for (const p of dr) put(roof, p.geometry, 0xffffff, [dx + (p.position?.[0] ?? 0), dormY + 2.1 + (p.position?.[1] ?? 0), dormZ + 1.2 + (p.position?.[2] ?? 0)]);
    windowAt(trim, glow, [dx, dormY + 0.7, dormZ + 2.92], 0, { w: 1.7, h: 2.2, trimCol, lit: rng() < 0.5 });
  }

  for (const sx of [1, -1]) {
    chimney(trim, { at: [sx * (halfW - 1.2), eaveY - 2, 0], top: eaveY + rise + 2.6 });
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) put(trim, boxG(0.34, eaveY, 0.34), trimCol, [sx * (halfW - 0.06), eaveY / 2, sz * (halfD - 0.06)]);
  }

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, roofColour) }, trim, glow, extraMeshes: [skinExtra],
  });
}

// A small white chapel / meeting house: steep gable to the street, tall round-top
// windows, and a square belfry with a little spire.
export function nbChapel({
  seed = 3, width = 16, depth = 24, colour = NB.clapWhite, roofColour = NB.roofSlate,
  trimCol = NB.trim, doorCol = NB.doorRed,
} = {}) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const eaveY = 12;
  const rise = halfW * 0.95;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, eaveY);
  for (const side of [1, -1]) {
    const g = gableEnd(halfW - 0.01, rise, 0.35);
    put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI)),
      0xffffff, [0, eaveY, side * (halfD - 0.18)]);
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('clapboard', colour));
  gableRoof(roof, { width, depth, eaveY, ridgeRise: rise, colour: 0xffffff, ridgeAxis: 'z' });

  const F = wallFace('front', halfW, halfD);
  doorAt(trim, glow, F.at(0, 0), F.yaw, { colour: doorCol, trimCol, w: 3.6, h: 7.2 });
  windowAt(trim, glow, F.at(0, 10.2), F.yaw, { w: 2.4, h: 2.4, trimCol, lit: true, muntinsX: 1, muntinsY: 1 });
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-depth * 0.3, 0, depth * 0.3]) {
      windowAt(trim, glow, S.at(dx, 5.4), S.yaw, { w: 2, h: 5.4, trimCol, lit: true, muntinsY: 2 });
    }
  }

  // Belfry: a white box with louvred openings, a pyramid cap and a finial ball.
  const bx = 0;
  const bz = halfD - 5;
  const baseY = eaveY + rise;
  put(trim, boxG(4.2, 4.6, 4.2), colour, [bx, baseY + 1.8, bz]);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const out = [Math.sin(yaw) * 2.12, 0, Math.cos(yaw) * 2.12];
    put(trim, boxG(1.7, 2.4, 0.12), NB.trimDark, [bx + out[0], baseY + 2.2, bz + out[2]], [0, yaw, 0]);
    for (let i = 0; i < 4; i++) {
      put(trim, boxG(1.7, 0.16, 0.1), colour,
        [bx + out[0] * 1.03, baseY + 1.4 + i * 0.55, bz + out[2] * 1.03], [0, yaw, 0]);
    }
  }
  put(roof, new THREE.ConeGeometry(3.3, 4.4, 4), 0xffffff, [bx, baseY + 6.2, bz], [0, Math.PI / 4, 0]);
  put(trim, new THREE.SphereGeometry(0.28, 10, 8), NB.brass, [bx, baseY + 8.6, bz]);

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, roofColour) }, trim, glow, extraMeshes: [skinExtra],
  });
}

// ---------------------------------------------------------------------------
// SHOPS AND BLOCKS
// ---------------------------------------------------------------------------

// A two-storey Main Street shop: lit display windows either side of a recessed door, a
// painted fascia sign, a striped awning, and living quarters upstairs behind shuttered
// windows. The parapet steps up over a flat roof, which is what separates a shop from
// a house at one glance.
export function nbShop({
  seed = 4, width = 18, depth = 22, colour = NB.clapYellow, trimCol = NB.trim,
  sign = 'MUSIC SHOP', signCol = '#f3ecd8', signFace = '#3a3026',
  awning = null, awningStripe = NB.trim, doorCol = NB.doorGreen, shutters = null,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallH = 20;
  const trim = [];
  const glow = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, wallH);

  // Parapet cap and cornice across the front.
  put(trim, boxG(width + 0.5, 0.5, 0.9), trimCol, [0, wallH + 0.25, halfD - 0.2]);
  put(trim, boxG(width + 0.3, 0.7, 0.7), mixCol(colour, 0x000000, 0.22).getHex(), [0, wallH - 0.35, halfD + 0.18]);
  // Flat roof plate, dark, just below the parapet so the shell reads closed from above.
  put(trim, boxG(width - 0.4, 0.3, depth - 0.4), NB.roofDark, [0, wallH - 0.6, 0]);

  const F = wallFace('front', halfW, halfD);
  // Storefront: bulkhead, two big lit panes, recessed centre door.
  put(trim, boxG(width - 1.2, 1.5, 0.25), mixCol(colour, 0x000000, 0.3).getHex(), F.at(0, 0.75).map((v, i) => (i === 2 ? v + 0.1 : v)));
  for (const sx of [-1, 1]) {
    put(glow, boxG(width * 0.31, 4.6, 0.05), NB.glassLit, F.at(sx * width * 0.24, 4.1).map((v, i) => (i === 2 ? v + 0.06 : v)));
    put(trim, boxG(width * 0.33, 0.18, 0.14), trimCol, F.at(sx * width * 0.24, 6.5).map((v, i) => (i === 2 ? v + 0.08 : v)));
    put(trim, boxG(width * 0.33, 0.18, 0.14), trimCol, F.at(sx * width * 0.24, 1.6).map((v, i) => (i === 2 ? v + 0.08 : v)));
    put(trim, boxG(0.24, 5.2, 0.14), trimCol, F.at(sx * width * 0.4, 4.1).map((v, i) => (i === 2 ? v + 0.08 : v)));
    put(trim, boxG(0.24, 5.2, 0.14), trimCol, F.at(sx * width * 0.075, 4.1).map((v, i) => (i === 2 ? v + 0.08 : v)));
  }
  doorAt(trim, glow, F.at(0, 0), F.yaw, { w: 3, h: 6.6, colour: doorCol, trimCol, step: false });

  // Fascia sign band -- a texPlate on a solid backing.
  put(trim, boxG(width - 0.8, 2.2, 0.3), 0x2c261e, F.at(0, 8.1).map((v, i) => (i === 2 ? v + 0.12 : v)));
  const signPlate = texPlate(width - 1.2, 1.8, 768, 112, (ctx, w, h) => {
    ctx.fillStyle = signFace;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = signCol;
    ctx.lineWidth = 4;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = signCol;
    const px = fitText(ctx, sign, w - 80, 72, `700 {px}px Georgia, serif`);
    ctx.font = `700 ${px}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sign, w / 2, h / 2 + 2);
  });
  signPlate.position.set(0, 8.1, halfD + 0.28);
  const extraMeshes = [signPlate];

  // Awning: a sloped slab with geometric stripes and a scalloped edge bar.
  if (awning) {
    const aw = width - 2;
    const slope = 0.5;
    const awnG = boxG(aw, 0.14, 3.2);
    put(trim, xformed(awnG, new THREE.Matrix4().makeRotationX(slope)), awning, [0, 6.95, halfD + 1.45]);
    const stripes = Math.round(aw / 1.6);
    for (let i = 0; i < stripes; i += 2) {
      const sxp = -aw / 2 + (i + 0.5) * (aw / stripes);
      put(trim, xformed(boxG(aw / stripes, 0.06, 3.1), new THREE.Matrix4().makeRotationX(slope)),
        awningStripe, [sxp, 7.05, halfD + 1.45]);
    }
    put(trim, boxG(aw, 0.5, 0.12), awning, [0, 6.25, halfD + 2.9]);
  }

  // Upstairs windows.
  for (const dx of [-width * 0.26, 0, width * 0.26]) {
    windowAt(trim, glow, F.at(dx, 13.6), F.yaw, { trimCol, shutters, lit: rng() < 0.5, h: 3.2 });
  }
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-depth * 0.25, depth * 0.25]) {
      windowAt(trim, glow, S.at(dx, 13.6), S.yaw, { trimCol, lit: rng() < 0.3, w: 2, h: 3 });
    }
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) put(trim, boxG(0.34, wallH, 0.34), trimCol, [sx * (halfW - 0.06), wallH / 2, sz * (halfD - 0.06)]);
  }

  return buildingGroup({ walls: [wall], roofParts: null, trim, glow, extraMeshes });
}

// A brick block: the four-storey school, the two-storey commercial row -- rows of
// windows over a stone base, under a corbelled cornice. `lit` is the chance a window
// glows; `sign` letters the frieze; `storefronts` turns the ground floor into lit shop
// bays instead of windows.
export function nbBrickBlock({
  seed = 5, width = 34, depth = 26, storeys = 4, colour = NB.brickSchool,
  trimCol = 0xd8cfc0, lit = 0.35, sign = null, storefronts = false, entrance = true,
  parapet = 2, siding = 'brick', floorH = 9.5,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallH = storeys * floorH + 2;
  const trim = [];
  const glow = [];

  const wall = wallShell(siding, colour, halfW, halfD, wallH);

  // Stone base course, cornice, parapet cap.
  put(trim, boxG(width + 0.5, 1.6, depth + 0.5), NB.stoneBase, [0, 0.8, 0]);
  const cornice = mouldedRing(
    [[0.05, -0.9], [0.35, -0.55], [0.42, -0.2], [0.55, 0]],
    halfW, halfD, { closeTop: true, closeBottom: true },
  );
  put(trim, cornice, trimCol, [0, wallH - (parapet > 0 ? parapet : 0), 0]);
  put(trim, boxG(width + 0.4, 0.5, depth + 0.4), trimCol, [0, wallH + 0.22, 0]);
  put(trim, boxG(width - 0.4, 0.3, depth - 0.4), NB.roofDark, [0, wallH - 0.4, 0]);

  // Window grid: front and both sides.
  const cols = Math.max(3, Math.round(width / 7));
  const firstFloor = storefronts || entrance ? 1 : 0;
  for (const side of ['front', 'east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    const span = side === 'front' ? width : depth;
    const n = side === 'front' ? cols : Math.max(2, Math.round(depth / 8));
    for (let f = firstFloor; f < storeys; f++) {
      const y = 2.4 + f * floorH + 2.5;
      for (let i = 0; i < n; i++) {
        const dx = -span / 2 + ((i + 0.5) * span) / n;
        if (side === 'front' && entrance && f === 0 && Math.abs(dx) < 3.4) continue;
        windowAt(trim, glow, S.at(dx, y), S.yaw, {
          w: 2.3, h: 3.9, trimCol, lit: rng() < lit, muntinsX: 1, muntinsY: 1,
        });
      }
    }
  }

  const F = wallFace('front', halfW, halfD);
  if (storefronts) {
    // Ground floor: lit shop bays with dark piers between.
    const bays = 3;
    for (let i = 0; i < bays; i++) {
      const dx = -width / 2 + ((i + 0.5) * width) / bays;
      put(glow, boxG(width / bays - 2.6, 5, 0.05), NB.glassLit, F.at(dx, 4.2).map((v, i2) => (i2 === 2 ? v + 0.06 : v)));
      put(trim, boxG(width / bays - 2.2, 0.9, 0.2), NB.trimDark, F.at(dx, 7.2).map((v, i2) => (i2 === 2 ? v + 0.1 : v)));
      put(trim, boxG(width / bays - 2.4, 1.1, 0.16), mixCol(colour, 0x000000, 0.35).getHex(), F.at(dx, 1).map((v, i2) => (i2 === 2 ? v + 0.08 : v)));
    }
  }
  if (entrance) {
    // A stone surround and stair: what makes a school read as an institution.
    put(trim, boxG(7, 10.4, 0.9), NB.stoneBase, F.at(0, 5.2).map((v, i2) => (i2 === 2 ? v + 0.3 : v)));
    doorAt(trim, glow, F.at(0, 0.9), F.yaw, { w: 4.2, h: 7.4, colour: 0x4a3626, trimCol: NB.stoneBase, lightOver: true, step: false });
    put(trim, boxG(8.4, 0.45, 2.6), NB.stoneBase, F.at(0, 0.68).map((v, i2) => (i2 === 2 ? v + 1.6 : v)));
    put(trim, boxG(9.6, 0.45, 2.2), NB.stoneBase, F.at(0, 0.22).map((v, i2) => (i2 === 2 ? v + 2.6 : v)));
  }
  if (sign) {
    const plate = texPlate(Math.min(width * 0.62, 22), 1.9, 768, 96, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#efe7d2';
      const px = fitText(ctx, sign, w - 40, 78, `700 {px}px Georgia, serif`);
      ctx.font = `700 ${px}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '6px';
      ctx.fillText(sign, w / 2, h / 2 + 2);
    });
    plate.position.set(0, wallH - parapet - 2.6, halfD + 0.1);
    plate.material.transparent = true;
    return buildingGroup({ walls: [wall], roofParts: null, trim, glow, extraMeshes: [plate] });
  }

  return buildingGroup({ walls: [wall], roofParts: null, trim, glow });
}

// The big red four-storey clapboard block whose every window glows warm yellow -- the
// most striking building in the reference model. A shallow gable roof, white floor
// bands, and a corner storefront at the street.
export function nbRedBlock({
  seed = 6, width = 30, depth = 24, storeys = 4, colour = NB.clapRed,
  trimCol = NB.trim, roofColour = NB.roofDark,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const floorH = 8.6;
  const wallH = storeys * floorH + 1.5;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, wallH);
  const rise = halfD * 0.42;
  for (const side of [1, -1]) {
    const g = gableEnd(halfD - 0.01, rise, 0.35);
    put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side * Math.PI / 2)),
      0xffffff, [side * (halfW - 0.18), wallH, 0]);
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('clapboard', colour));
  gableRoof(roof, { width, depth, eaveY: wallH, ridgeRise: rise, colour: 0xffffff, ridgeAxis: 'x', overhang: 1.1 });

  // The lit grid: four floors of six-pane sash, nearly all glowing.
  for (const side of ['front', 'east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    const span = side === 'front' ? width : depth;
    const n = side === 'front' ? 4 : 3;
    for (let f = 0; f < storeys; f++) {
      const y = 1.2 + f * floorH + 4.2;
      for (let i = 0; i < n; i++) {
        const dx = -span / 2 + ((i + 0.5) * span) / n;
        if (side === 'front' && f === 0 && i === 1) continue; // the door bay
        windowAt(trim, glow, S.at(dx, y), S.yaw, {
          w: 2.5, h: 3.9, trimCol, lit: rng() < 0.85, muntinsX: 1, muntinsY: 2,
        });
      }
    }
    // white floor bands between storeys
    for (let f = 1; f < storeys; f++) {
      const bandG = boxG(side === 'front' ? width + 0.2 : 0.24, 0.5, side === 'front' ? 0.24 : depth + 0.2);
      const at = side === 'front' ? [0, 1.2 + f * floorH, halfD + 0.06]
        : [(side === 'east' ? 1 : -1) * (halfW + 0.06), 1.2 + f * floorH, 0];
      put(trim, bandG, trimCol, at);
    }
  }
  const F = wallFace('front', halfW, halfD);
  doorAt(trim, glow, F.at(-width * 0.125, 0), F.yaw, { w: 3.4, h: 7, colour: 0x3a2c22, trimCol, lightOver: true });
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) put(trim, boxG(0.4, wallH, 0.4), trimCol, [sx * (halfW - 0.08), wallH / 2, sz * (halfD - 0.08)]);
  }
  chimney(trim, { at: [-halfW * 0.55, wallH - 2, -halfD * 0.3], top: wallH + rise + 3, colour: NB.brickDeep });

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, roofColour) }, trim, glow, extraMeshes: [skinExtra],
  });
}

// An arched factory window: jambs, a swept arch band, a multi-pane grid, and a lit or
// sky-dark arched pane -- all forward of the solid brick shell.
function archWindow(trim, glow, at, yaw, {
  w = 4.2, h = 7, lit = false, trimCol = 0xd8cfc0, paneCol = NB.glassSky,
} = {}) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const p = (dx, dy, out) => [at[0] + dx * c + out * s, at[1] + dy, at[2] - dx * s + out * c];
  const add = (list, colr, geometry, dx, dy, out, rot = [0, yaw, 0]) => put(list, geometry, colr, p(dx, dy, out), rot);

  const r = w / 2;
  const rectH = h - r;
  // The arched pane: a flat extrusion of the arch outline.
  const outline = [[-r, 0], [r, 0]];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    outline.push([Math.cos(a) * r, rectH + Math.sin(a) * r]);
  }
  const pane = extrudeOutline([[r, 0], ...outline.slice(2), [-r, 0]], 0.06, { uvFeet: false });
  add(lit ? glow : trim, lit ? NB.glassLit : paneCol, laid(pane, yaw, 0), 0, 0, 0.04, null);
  // Muntin grid over the pane.
  for (let i = 1; i < 3; i++) add(trim, trimCol, boxG(0.09, h - 0.4, 0.05), -w / 2 + (i * w) / 3, (h - 0.4) / 2 + 0.1, 0.08);
  for (let i = 1; i < 4; i++) add(trim, trimCol, boxG(w - 0.2, 0.09, 0.05), 0, (i * rectH) / 3.2, 0.08);
  // Jambs and sill.
  add(trim, trimCol, boxG(0.3, rectH, 0.18), -r - 0.1, rectH / 2, 0.07);
  add(trim, trimCol, boxG(0.3, rectH, 0.18), r + 0.1, rectH / 2, 0.07);
  add(trim, NB.stoneBase, boxG(w + 0.7, 0.3, 0.34), 0, -0.15, 0.12);
  // The arch band: a small rect profile swept along the semicircle, capped.
  const arcPts = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    const wp = p(Math.cos(a) * (r + 0.12), rectH + Math.sin(a) * (r + 0.12), 0.07);
    arcPts.push(wp);
  }
  put(trim, sweepProfile(arcPts, [[-0.16, -0.2], [0.16, -0.2], [0.16, 0.2], [-0.16, 0.2]], { samples: 20 }), trimCol);
}

// The trolley barn / factory: the big industrial block at the back of the model. A long
// brick shell with a raised clerestory monitor, rows of arched windows, a great arched
// door the track once ran through, a corbel cornice and a round smokestack.
export function nbFactory({
  seed = 7, width = 46, depth = 30, colour = NB.factoryBrick, trimCol = 0xd6ccb8,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallH = 20;
  const trim = [];
  const glow = [];
  const roof = [];

  const wall = wallShell('brick', colour, halfW, halfD, wallH);
  put(trim, boxG(width + 0.5, 1.8, depth + 0.5), NB.stoneBase, [0, 0.9, 0]);
  put(trim, mouldedRing([[0.05, -0.8], [0.3, -0.45], [0.4, -0.1], [0.5, 0]], halfW, halfD, { closeTop: true, closeBottom: true }), trimCol, [0, wallH, 0]);

  // The clerestory monitor: a raised centre box with a band of lit windows, under its
  // own shallow gable; the main roof slopes up to its sides.
  const monW = width - 10;
  const monD = 9;
  const monH = 5.5;
  const monBase = wallH + 0.4;
  put(trim, boxG(monW, monH, monD), mixCol(colour, 0x000000, 0.12).getHex(), [0, monBase + monH / 2, 0]);
  for (const sz of [1, -1]) {
    for (let i = 0; i < 7; i++) {
      const dx = -monW / 2 + ((i + 0.5) * monW) / 7;
      put(glow, boxG(monW / 7 - 1.4, 2.6, 0.08), NB.glassLit, [dx, monBase + monH * 0.52, sz * (monD / 2 + 0.05)]);
    }
  }
  const monRoof = [];
  gableRoof(monRoof, { width: monW, depth: monD, eaveY: monBase + monH, ridgeRise: 2.2, colour: 0xffffff, ridgeAxis: 'x', overhang: 0.7 });
  for (const p of monRoof) roof.push(p);
  // Main roof: two slabs from the eaves up to the monitor's flanks.
  for (const sz of [1, -1]) {
    const span = halfD - monD / 2 + 1.4;
    const riseTo = monBase + 2.6 - wallH;
    const slope = Math.hypot(span, riseTo);
    const slab = extrudeOutline(cornerRect((width + 1.6) / 2, slope / 2), 0.3);
    const pitch = Math.atan2(riseTo, span);
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2 + (sz > 0 ? pitch : -pitch));
    put(roof, xformed(slab, m), 0xffffff, [0, wallH + riseTo / 2 + 0.1, sz * (monD / 2 + span / 2 - 0.7)]);
  }

  // Arched windows: five across the front flanking the great door, four along each side.
  const F = wallFace('front', halfW, halfD);
  for (const dx of [-18, -10.8, 10.8, 18]) {
    archWindow(trim, glow, F.at(dx, 4.4), F.yaw, { lit: rng() < 0.6, trimCol });
  }
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-10.5, -3.5, 3.5, 10.5]) {
      archWindow(trim, glow, S.at(dx, 4.4), S.yaw, { lit: rng() < 0.5, trimCol, w: 3.8, h: 6.4 });
    }
  }

  // The great arched door: a dark recess, double timber doors ajar, an arch band.
  const dw = 9;
  const rectH = 8.5;
  put(trim, boxG(dw + 1.4, rectH + dw / 2 + 1.2, 0.5), mixCol(colour, 0x000000, 0.2).getHex(), F.at(0, (rectH + dw / 2 + 1.2) / 2).map((v, i) => (i === 2 ? v + 0.12 : v)));
  put(trim, boxG(dw, rectH + 1, 0.2), 0x241e18, F.at(0, (rectH + 1) / 2).map((v, i) => (i === 2 ? v + 0.3 : v)));
  put(trim, boxG(dw / 2 - 0.3, rectH - 0.6, 0.24), 0x54402c, F.at(-dw / 4 - 0.4, (rectH - 0.6) / 2).map((v, i) => (i === 2 ? v + 0.4 : v)), [0, 0.5, 0]);
  put(trim, boxG(dw / 2 - 0.3, rectH - 0.6, 0.24), 0x5c4630, F.at(dw / 4 + 0.1, (rectH - 0.6) / 2).map((v, i) => (i === 2 ? v + 0.42 : v)), [0, -0.28, 0]);
  const doorArc = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    doorArc.push(F.at(Math.cos(a) * (dw / 2 + 0.5), rectH + Math.sin(a) * (dw / 2 + 0.5)).map((v, k) => (k === 2 ? v + 0.14 : v)));
  }
  put(trim, sweepProfile(doorArc, [[-0.3, -0.35], [0.3, -0.35], [0.3, 0.35], [-0.3, 0.35]], { samples: 20 }), trimCol);

  // Round brick smokestack at the back corner, with a banded crown.
  const stackX = -halfW + 4;
  const stackZ = -halfD + 4;
  put(trim, new THREE.CylinderGeometry(1.7, 2.3, 34, 18), NB.brickDeep, [stackX, 17, stackZ]);
  put(trim, new THREE.CylinderGeometry(2.0, 1.75, 2.2, 18), NB.stoneBase, [stackX, 34.5, stackZ]);
  put(trim, new THREE.CylinderGeometry(1.45, 1.45, 0.8, 18), 0x241f1c, [stackX, 35.6, stackZ]);

  // Nameboard over the door.
  const plate = texPlate(16, 1.7, 640, 72, (ctx, w, h) => {
    ctx.fillStyle = '#2c2620';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8dcc0';
    const px = fitText(ctx, 'NEIGHBORHOOD TROLLEY WORKS', w - 40, 44, `700 {px}px Georgia, serif`);
    ctx.font = `700 ${px}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NEIGHBORHOOD TROLLEY WORKS', w / 2, h / 2 + 1);
  });
  plate.position.set(0, rectH + dw / 2 + 2.6, halfD + 0.3);

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, NB.roofGray) }, trim, glow, extraMeshes: [plate],
  });
}

// The town hall: a two-storey brick front with a white clock cupola on a square tower
// -- placed at the head of Main Street, so the cupola terminates the whole vista.
export function nbTowerHall({
  seed = 8, width = 26, depth = 20, colour = NB.brick, trimCol = NB.trim,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallH = 21;
  const trim = [];
  const glow = [];
  const roof = [];

  const wall = wallShell('brick', colour, halfW, halfD, wallH);
  put(trim, boxG(width + 0.5, 1.6, depth + 0.5), NB.stoneBase, [0, 0.8, 0]);
  put(trim, mouldedRing([[0.05, -0.7], [0.3, -0.4], [0.45, 0]], halfW, halfD, { closeTop: true, closeBottom: true }), trimCol, [0, wallH, 0]);
  gableRoof(roof, { width, depth, eaveY: wallH, ridgeRise: 4.5, colour: 0xffffff, ridgeAxis: 'x', overhang: 0.8 });

  const F = wallFace('front', halfW, halfD);
  doorAt(trim, glow, F.at(0, 0.45), F.yaw, { w: 4, h: 7.2, colour: 0x3c3026, trimCol, lightOver: true });
  put(trim, boxG(6.4, 0.4, 2.2), NB.stoneBase, F.at(0, 0.2).map((v, i) => (i === 2 ? v + 1.4 : v)));
  for (const dx of [-width * 0.31, width * 0.31]) {
    windowAt(trim, glow, F.at(dx, 4.8), F.yaw, { trimCol, lit: rng() < 0.5, h: 3.6 });
  }
  for (const dx of [-width * 0.31, 0, width * 0.31]) {
    windowAt(trim, glow, F.at(dx, 14.4), F.yaw, { trimCol, lit: rng() < 0.5, h: 3.4 });
  }
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-depth * 0.22, depth * 0.22]) {
      for (const y of [4.8, 14.4]) windowAt(trim, glow, S.at(dx, y), S.yaw, { trimCol, w: 2.1, h: 3.3, lit: rng() < 0.4 });
    }
  }

  // The tower: brick shaft through the roof, white clock stage, open lantern, dome cap.
  const tw = 7.5;
  put(trim, boxG(tw, 14, tw), colour, [0, wallH + 7 - 1, 0]);
  put(trim, boxG(tw + 0.6, 0.6, tw + 0.6), trimCol, [0, wallH + 12.7, 0]);
  const clockY = wallH + 15.4;
  put(trim, boxG(tw - 0.6, 5, tw - 0.6), 0xf0ead8, [0, clockY, 0]);
  const extraMeshes = [];
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const out = [Math.sin(yaw) * ((tw - 0.6) / 2 + 0.03), 0, Math.cos(yaw) * ((tw - 0.6) / 2 + 0.03)];
    const dial = texPlate(2.6, 2.6, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f6f1e2';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a332a';
      ctx.lineWidth = 4;
      ctx.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * w * 0.36);
        ctx.lineTo(w / 2 + Math.cos(a) * w * 0.42, h / 2 + Math.sin(a) * w * 0.42);
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2, h / 2 - w * 0.3);
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + w * 0.2, h / 2 + w * 0.08);
      ctx.stroke();
    });
    dial.position.set(out[0], clockY + 0.4, out[2]);
    dial.rotation.y = yaw;
    extraMeshes.push(dial);
  }
  // Lantern: eight posts under a dome and finial.
  const lanY = clockY + 2.5;
  put(trim, boxG(tw - 1.2, 0.5, tw - 1.2), trimCol, [0, lanY + 0.25, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(trim, boxG(0.3, 2.6, 0.3), trimCol, [Math.cos(a) * (tw / 2 - 1.3), lanY + 1.8, Math.sin(a) * (tw / 2 - 1.3)]);
  }
  put(trim, lathed(closedProfile([[tw / 2 - 0.7, lanY + 3.1], [tw / 2 - 0.85, lanY + 3.4], [tw / 2 - 1.1, lanY + 4.2], [1.2, lanY + 5.2], [0.28, lanY + 5.9], [0.26, lanY + 6.6]]), { segments: 18 }), 0xe8e2d0);
  put(trim, new THREE.SphereGeometry(0.34, 12, 9), NB.brass, [0, lanY + 6.8, 0]);

  const plate = texPlate(10, 1.4, 512, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#efe7d2';
    const px = fitText(ctx, 'TOWN HALL', w - 60, 46, `700 {px}px Georgia, serif`);
    ctx.font = `700 ${px}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '8px';
    ctx.fillText('TOWN HALL', w / 2, h / 2 + 1);
  });
  plate.material.transparent = true;
  plate.position.set(0, 10.2, halfD + 0.1);
  extraMeshes.push(plate);

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, NB.roofSlate) }, trim, glow, extraMeshes,
  });
}

// The low modern school: a flat-roofed mid-century block with a white fascia, a ribbon
// of windows, and a glass entry under a thin canopy.
export function nbModernSchool({
  seed = 9, width = 52, depth = 28, colour = NB.brickSchool, name = 'NEIGHBORHOOD SCHOOL',
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallH = 11.5;
  const trim = [];
  const glow = [];

  const wall = wallShell('brick', colour, halfW, halfD, wallH);
  // White fascia band all round -- the one strong horizontal that says 1962.
  put(trim, boxG(width + 0.7, 1.5, depth + 0.7), NB.trim, [0, wallH - 0.55, 0]);
  put(trim, boxG(width - 0.4, 0.3, depth - 0.4), NB.roofDark, [0, wallH + 0.24, 0]);
  put(trim, boxG(width + 0.4, 0.5, depth + 0.4), 0x8a8478, [0, 0.25, 0]);

  // Ribbon windows along the front, sill band beneath.
  const F = wallFace('front', halfW, halfD);
  const ribbonW = width * 0.72;
  const bays = 9;
  for (let i = 0; i < bays; i++) {
    const dx = -ribbonW / 2 + ((i + 0.5) * ribbonW) / bays + width * 0.1;
    put(glow, boxG(ribbonW / bays - 0.5, 3.4, 0.06), rng() < 0.55 ? NB.glassLit : NB.glassSky,
      F.at(dx, 6.6).map((v, k) => (k === 2 ? v + 0.05 : v)));
    put(trim, boxG(0.22, 3.6, 0.12), NB.trim, F.at(dx - (ribbonW / bays) / 2 + 0.12, 6.6).map((v, k) => (k === 2 ? v + 0.07 : v)));
  }
  put(trim, boxG(ribbonW + 0.6, 0.34, 0.2), NB.trim, F.at(width * 0.1, 4.6).map((v, k) => (k === 2 ? v + 0.08 : v)));
  put(trim, boxG(ribbonW + 0.6, 0.34, 0.2), NB.trim, F.at(width * 0.1, 8.5).map((v, k) => (k === 2 ? v + 0.08 : v)));

  // Glass entry at the west end of the front, thin canopy on two posts.
  const ex = -width * 0.36;
  put(glow, boxG(7, 7.6, 0.07), NB.glassLit, F.at(ex, 3.9).map((v, k) => (k === 2 ? v + 0.05 : v)));
  put(trim, boxG(0.3, 7.8, 0.16), NB.trimDark, F.at(ex - 3.4, 4).map((v, k) => (k === 2 ? v + 0.08 : v)));
  put(trim, boxG(0.3, 7.8, 0.16), NB.trimDark, F.at(ex + 3.4, 4).map((v, k) => (k === 2 ? v + 0.08 : v)));
  put(trim, boxG(0.24, 7.6, 0.1), NB.trimDark, F.at(ex - 1.1, 3.9).map((v, k) => (k === 2 ? v + 0.08 : v)));
  put(trim, boxG(2.1, 0.4, 0.1), NB.trimDark, F.at(ex - 2.2, 3.4).map((v, k) => (k === 2 ? v + 0.09 : v)));
  put(trim, boxG(9.5, 0.5, 6.5), NB.trim, [ex, 8.6, halfD + 3]);
  for (const sx of [-3.6, 3.6]) put(trim, boxG(0.34, 8.4, 0.34), NB.trimDark, [ex + sx, 4.2, halfD + 5.4]);
  put(trim, boxG(9, 0.3, 5.4), NB.sidewalk, [ex, 0.15, halfD + 2.8]);

  // Letterboard on the fascia.
  const plate = texPlate(26, 1.25, 1024, 52, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#4c4438';
    const px = fitText(ctx, name, w - 30, 42, `700 {px}px Futura, "Trebuchet MS", sans-serif`);
    ctx.font = `700 ${px}px Futura, "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '10px';
    ctx.fillText(name, w / 2, h / 2 + 1);
  });
  plate.material.transparent = true;
  plate.position.set(width * 0.06, wallH - 0.55, halfD + 0.42);

  return buildingGroup({ walls: [wall], roofParts: null, trim, glow, extraMeshes: [plate] });
}

// The tourist court: a row of little gabled cabins joined shoulder to shoulder, each
// with its own door, window and striped awning, and a MOTEL sign at the office end.
export function nbMotel({
  seed = 10, units = 5, unitW = 9, depth = 12, colour = NB.clapOrange,
  awning = NB.clapCream, roofColour = NB.roofBrown,
} = {}) {
  const rng = seededRandom(seed);
  const width = units * unitW;
  const halfW = width / 2;
  const halfD = depth / 2;
  const eaveY = 8;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('clapboard', colour, halfW, halfD, eaveY);
  // One long roof with a gablet over every unit: main slabs, then unit gables.
  gableRoof(roof, { width, depth, eaveY, ridgeRise: 3.4, colour: 0xffffff, ridgeAxis: 'x', overhang: 0.8 });
  for (const side of [1, -1]) {
    const g = gableEnd(halfD - 0.01, 3.4, 0.35);
    put(skin, xformed(g, new THREE.Matrix4().makeRotationY(side * Math.PI / 2)),
      0xffffff, [side * (halfW - 0.18), eaveY, 0]);
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('clapboard', colour));

  const F = wallFace('front', halfW, halfD);
  for (let i = 0; i < units; i++) {
    const cx = -halfW + (i + 0.5) * unitW;
    doorAt(trim, glow, F.at(cx - 1.9, 0), F.yaw, {
      w: 2.4, h: 6, colour: [NB.doorRed, NB.doorBlue, NB.doorGreen][i % 3], trimCol: NB.trim, step: false,
    });
    windowAt(trim, glow, F.at(cx + 1.7, 3.9), F.yaw, { w: 2.2, h: 2.6, lit: rng() < 0.6, trimCol: NB.trim });
    // striped awning over the window
    put(trim, xformed(boxG(3, 0.12, 1.7), new THREE.Matrix4().makeRotationX(0.5)), awning, [cx + 1.7, 5.9, halfD + 0.75]);
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      put(trim, xformed(boxG(0.6, 0.06, 1.66), new THREE.Matrix4().makeRotationX(0.5)),
        NB.clapRed, [cx + 0.8 + sIdx * 1.8, 5.985, halfD + 0.76]);
    }
    if (i > 0) put(trim, boxG(0.3, eaveY, 0.3), NB.trim, [cx - unitW / 2, eaveY / 2, halfD - 0.12]);
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) put(trim, boxG(0.34, eaveY, 0.34), NB.trim, [sx * (halfW - 0.06), eaveY / 2, sz * (halfD - 0.06)]);
  }

  // The MOTEL sign: a pole at the office end with a vertical lit board.
  const sx2 = halfW + 2.4;
  put(trim, new THREE.CylinderGeometry(0.18, 0.24, 13, 10), NB.trimDark, [sx2, 6.5, halfD - 1]);
  put(trim, boxG(2.6, 7.4, 0.5), 0x30414e, [sx2, 10.2, halfD - 1]);
  const signPlate = texPlate(2.1, 6.9, 96, 320, (ctx, w, h) => {
    ctx.fillStyle = '#30414e';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd987';
    ctx.font = '700 52px Futura, "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letters = 'MOTEL';
    for (let i = 0; i < letters.length; i++) {
      ctx.fillText(letters[i], w / 2, (i + 0.5) * (h / letters.length));
    }
  }, { emissive: 0.75 });
  signPlate.position.set(sx2, 10.2, halfD - 1 + 0.28);

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, roofColour) }, trim, glow, extraMeshes: [skinExtra, signPlate],
  });
}

// The barn: gambrel roof, big white-X sliding door, hayloft door under the peak, and a
// little vented cupola. Vertical board siding.
export function nbBarn({
  seed = 11, width = 22, depth = 26, colour = NB.barnBrown, roofColour = NB.roofTan,
} = {}) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const eaveY = 10;
  const trim = [];
  const glow = [];
  const roof = [];
  const skin = [];

  const wall = wallShell('boards', colour, halfW, halfD, eaveY);

  // Gambrel: two pitches a side. Lower steep, upper shallow; ridge along Z.
  const lowSpan = halfW * 0.55;
  const lowRise = 5.2;
  const upSpan = halfW - lowSpan;
  const upRise = 2.6;
  const ridgeY = eaveY + lowRise + upRise;
  for (const sx of [1, -1]) {
    const lowSlope = Math.hypot(lowSpan, lowRise);
    const lowPitch = Math.atan2(lowRise, lowSpan);
    const low = extrudeOutline(cornerRect((depth + 1.8) / 2, lowSlope / 2), 0.3);
    const m1 = new THREE.Matrix4().makeRotationY(Math.PI / 2)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + (sx > 0 ? lowPitch : -lowPitch)));
    put(roof, xformed(low, m1), 0xffffff,
      [sx * (halfW - lowSpan / 2 + 0.4), eaveY + lowRise / 2 + 0.1, 0]);
    const upSlope = Math.hypot(upSpan, upRise);
    const upPitch = Math.atan2(upRise, upSpan);
    const up = extrudeOutline(cornerRect((depth + 1.8) / 2, upSlope / 2), 0.3);
    const m2 = new THREE.Matrix4().makeRotationY(Math.PI / 2)
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + (sx > 0 ? upPitch : -upPitch)));
    put(roof, xformed(up, m2), 0xffffff, [sx * (upSpan / 2 - 0.1), eaveY + lowRise + upRise / 2 + 0.1, 0]);
  }
  put(roof, boxG(0.7, 0.22, depth + 2), 0xffffff, [0, ridgeY + 0.2, 0]);

  // Gambrel gable-end infills: the pentagon between eave and ridge.
  for (const sz of [1, -1]) {
    const outline = [
      [-halfW, 0], [halfW, 0],
      [halfW - upSpan, lowRise], [0.004, lowRise + upRise],
      [-0.004, lowRise + upRise], [-(halfW - upSpan), lowRise],
    ];
    const g = extrudeOutline(outline.map(([a, b]) => [a * 0.995, b]), 0.35);
    put(skin, xformed(g, new THREE.Matrix4().makeRotationY(sz > 0 ? 0 : Math.PI)),
      0xffffff, [0, eaveY, sz * (halfD - 0.18)]);
  }
  const skinExtra = mesh(mergeParts(skin.map((p) => ({ ...p, color: 0xffffff }))),
    surfaceMat('boards', colour));

  // Big sliding door with the white X brace, on a track.
  const F = wallFace('front', halfW, halfD);
  put(trim, boxG(8.4, 8.6, 0.3), mixCol(colour, 0x000000, 0.18).getHex(), F.at(0, 4.3).map((v, i) => (i === 2 ? v + 0.15 : v)));
  put(trim, boxG(8.8, 0.4, 0.2), NB.trim, F.at(0, 8.9).map((v, i) => (i === 2 ? v + 0.2 : v)));
  for (const rot of [0.55, -0.55]) {
    put(trim, xformed(boxG(0.6, 10.4, 0.1), new THREE.Matrix4().makeRotationZ(rot)), NB.trim,
      F.at(0, 4.3).map((v, i) => (i === 2 ? v + 0.32 : v)));
  }
  put(trim, boxG(8.8, 0.5, 0.14), NB.trim, F.at(0, 0.4).map((v, i) => (i === 2 ? v + 0.3 : v)));
  put(trim, boxG(0.5, 8.6, 0.14), NB.trim, F.at(-4.2, 4.3).map((v, i) => (i === 2 ? v + 0.3 : v)));
  put(trim, boxG(0.5, 8.6, 0.14), NB.trim, F.at(4.2, 4.3).map((v, i) => (i === 2 ? v + 0.3 : v)));
  // Hayloft door under the peak.
  put(trim, boxG(3, 3.4, 0.2), mixCol(colour, 0x000000, 0.3).getHex(), F.at(0, eaveY + 2.2).map((v, i) => (i === 2 ? v + 0.1 : v)));
  put(trim, boxG(3.4, 0.3, 0.16), NB.trim, F.at(0, eaveY + 4.1).map((v, i) => (i === 2 ? v + 0.12 : v)));
  // Windows on the sides.
  for (const side of ['east', 'west']) {
    const S = wallFace(side, halfW, halfD);
    for (const dx of [-depth * 0.28, 0, depth * 0.28]) {
      windowAt(trim, glow, S.at(dx, 4.6), S.yaw, { w: 1.8, h: 2.2, trimCol: NB.trim, lit: false, muntinsY: 1 });
    }
  }
  // Cupola with vents and a little roof.
  put(trim, boxG(2.6, 2.4, 2.6), colour, [0, ridgeY + 1.4, 0]);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    put(trim, boxG(1.2, 1.4, 0.1), 0x2c241c, [Math.sin(yaw) * 1.33, ridgeY + 1.5, Math.cos(yaw) * 1.33], [0, yaw, 0]);
  }
  put(roof, new THREE.ConeGeometry(2.2, 1.8, 4), 0xffffff, [0, ridgeY + 3.5, 0], [0, Math.PI / 4, 0]);

  return buildingGroup({
    walls: [wall], roofParts: { mesh: roofMesh(roof, roofColour) }, trim, glow, extraMeshes: [skinExtra],
  });
}

// ---------------------------------------------------------------------------
// THE STREET -- the whole network as ONE prop
// ---------------------------------------------------------------------------

// The street grid is a single prop: every asphalt slab, sidewalk, curb, painted marking
// and trolley rail in the world, merged to three meshes. One prop, because the seams
// between separately-placed segments are exactly where z-fighting and hairline gaps
// live -- built as one decomposition of non-overlapping rectangles, none of it can
// misalign. The layout in WorldPresets simply places it at the origin.
//
// The decomposition rules (worked out on paper so the tops never overlap):
//  * Asphalt owns the intersections: cross-street slabs stop at Main's kerb line.
//  * N-S sidewalks run THROUGH the corner zones; E-W sidewalk slabs abut the N-S
//    walks' outer edges exactly -- abutment shares an edge, never an area.
//  * Every sidewalk edge that meets asphalt is TUCKED 0.1ft into it, so no vertical
//    face is coplanar with another; equal-height walk slabs abut exactly instead.
//
// Streets, for the layouts and programs that drive on them:
//   Main St   N-S, asphalt x in [-12, 12], z in [-148, 55], trolley track at x = +-2.5
//   Maple St  E-W, z in [-38, -14], x in [-132, 132]
//   Orchard   E-W, z in [-108, -84], x in [-110, 110]
//   Elm St    N-S, x in [-86, -62], z in [-132, -38]
//   Oak St    N-S, x in [62, 86], z in [-132, 8]
export const NB_STREET = {
  asphaltTop: 0.3,
  walkTop: 0.5,
  main: { x: 0, half: 12 },
  maple: { z: -26 },
  orchard: { z: -96 },
  elm: { x: -74 },
  oak: { x: 74 },
};

export function nbStreetGrid() {
  const A = []; // asphalt slabs
  const W = []; // sidewalk slabs
  const M = []; // markings + rails (vertex colour)

  const slabG = (x0, x1, z0, z1, h) => {
    const g = boxG(x1 - x0, h, z1 - z0);
    return { g, at: [(x0 + x1) / 2, h / 2, (z0 + z1) / 2] };
  };
  // Asphalt and concrete carry feet-tiled surface maps; BoxGeometry UVs are per-face
  // 0..1, so these slabs go through extrudeOutline instead -- its caps lay UVs in FEET.
  const feetSlab = (list, x0, x1, z0, z1, h) => {
    const g = extrudeOutline(cornerRect((x1 - x0) / 2, (z1 - z0) / 2), h);
    g.rotateX(-Math.PI / 2);
    put(list, g, 0xffffff, [(x0 + x1) / 2, h / 2, (z0 + z1) / 2]);
  };

  // --- asphalt ---------------------------------------------------------------
  const AS = [
    [-12, 12, -148, 55],      // Main
    [-132, -12, -38, -14],    // Maple W
    [12, 132, -38, -14],      // Maple E
    [-110, -12, -108, -84],   // Orchard W
    [12, 110, -108, -84],     // Orchard E
    [-86, -62, -132, -108],   // Elm N of Orchard
    [-86, -62, -84, -38],     // Elm between
    [62, 86, -132, -108],     // Oak N of Orchard
    [62, 86, -84, -38],       // Oak between
    [62, 86, -14, 8],         // Oak S of Maple
  ];
  for (const [x0, x1, z0, z1] of AS) feetSlab(A, x0, x1, z0, z1, NB_STREET.asphaltTop);

  // --- sidewalks -------------------------------------------------------------
  const WS = [
    // Main, both sides, running through the corners
    [-18, -11.9, -148, -107.9], [-18, -11.9, -84.1, -37.9], [-18, -11.9, -14.1, 55],
    [11.9, 18, -148, -107.9], [11.9, 18, -84.1, -37.9], [11.9, 18, -14.1, 55],
    // Elm, both sides
    [-92, -85.9, -132, -107.9], [-92, -85.9, -84.1, -37.9],
    [-62.1, -56, -132, -107.9], [-62.1, -56, -84.1, -37.9],
    // Oak, both sides
    [56, 62.1, -132, -107.9], [56, 62.1, -84.1, -37.9], [56, 62.1, -14.1, 8],
    [85.9, 92, -132, -107.9], [85.9, 92, -84.1, -37.9], [85.9, 92, -14.1, 8],
    // Maple north / south
    [-132, -92, -44, -37.9], [-56, -18, -44, -37.9], [18, 56, -44, -37.9], [92, 132, -44, -37.9],
    [-132, -18, -14.1, -8], [18, 56, -14.1, -8], [92, 132, -14.1, -8],
    // Orchard north / south
    [-110, -92, -114, -107.9], [-56, -18, -114, -107.9], [18, 56, -114, -107.9], [92, 110, -114, -107.9],
    [-110, -92, -84.1, -78], [-56, -18, -84.1, -78], [18, 56, -84.1, -78], [92, 110, -84.1, -78],
  ];
  for (const [x0, x1, z0, z1] of WS) feetSlab(W, x0, x1, z0, z1, NB_STREET.walkTop);

  // --- painted markings ------------------------------------------------------
  const mark = (x0, x1, z0, z1, colour, top = 0.345) => {
    const { g, at } = slabG(x0, x1, z0, z1, top - 0.29);
    at[1] = top - (top - 0.29) / 2;
    put(M, g, colour, at);
  };
  // Centre dashes on every street except Main (the track lives there instead).
  const dashRunZ = (x, z0, z1) => {
    for (let z = z0; z < z1 - 3; z += 9) mark(x - 0.3, x + 0.3, z, z + 3.4, NB.dash);
  };
  const dashRunX = (z, x0, x1) => {
    for (let x = x0; x < x1 - 3; x += 9) mark(x, x + 3.4, z - 0.3, z + 0.3, NB.dash);
  };
  dashRunX(-26, -128, -94); dashRunX(-26, -54, -18); dashRunX(-26, 18, 54); dashRunX(-26, 94, 128);
  dashRunX(-96, -106, -94); dashRunX(-96, -54, -18); dashRunX(-96, 18, 54); dashRunX(-96, 94, 106);
  dashRunZ(-74, -128, -112); dashRunZ(-74, -80, -46);
  dashRunZ(74, -128, -112); dashRunZ(74, -80, -46); dashRunZ(74, -10, 4);

  // Crosswalks and stop bars at the two Main Street intersections.
  const zebraAcrossMain = (zc) => {
    for (let i = 0; i < 6; i++) {
      const x = -10.5 + i * 3.9;
      mark(x, x + 2.1, zc - 2.6, zc + 2.6, NB.line);
    }
  };
  zebraAcrossMain(-11); zebraAcrossMain(-41); zebraAcrossMain(-81); zebraAcrossMain(-111);
  const zebraAcrossCross = (xc, zc) => {
    for (let i = 0; i < 6; i++) {
      const z = zc - 10.5 + i * 3.9;
      mark(xc - 2.6, xc + 2.6, z, z + 2.1, NB.line);
    }
  };
  zebraAcrossCross(-15, -26); zebraAcrossCross(15, -26);
  zebraAcrossCross(-15, -96); zebraAcrossCross(15, -96);
  // Stop bars where Maple and Orchard meet Main.
  mark(-11.5, -0.5, -19.5, -18, NB.line); mark(0.5, 11.5, -34, -32.5, NB.line);
  mark(-11.5, -0.5, -89.5, -88, NB.line); mark(0.5, 11.5, -104, -102.5, NB.line);

  // --- the trolley track -----------------------------------------------------
  // A darker trackway band down Main with two flush steel rails. The rails ride 0.06
  // proud so a low sun catches them the whole length of the street.
  put(M, boxG(7, 0.33, 186), NB.trackway, [0, 0.165, -47]);
  for (const sx of [-2.5, 2.5]) {
    put(M, boxG(0.38, 0.36, 186), NB.rail, [sx, 0.18, -47]);
  }

  const g = group();
  g.add(mesh(mergeParts(A.map((p) => ({ ...p, color: 0xffffff }))), surfaceMat('asphalt', NB.asphalt, { rough: 0.94, bump: 0.35 })));
  g.add(mesh(mergeParts(W.map((p) => ({ ...p, color: 0xffffff }))), surfaceMat('concrete', NB.sidewalk, { rough: 0.9, bump: 0.4 })));
  g.add(mesh(mergeParts(M), standard({ vertexColors: true, roughness: 0.62, metalness: 0.18 })));
  return g;
}

// ---------------------------------------------------------------------------
// THE TROLLEY
// ---------------------------------------------------------------------------

// The neighborhood trolley: cherry red with gold striping, a cream window band lit warm
// from inside, arched-top windows painted onto the band, a clerestory roof, cowcatchers
// both ends. Authored facing +Z, base on the rails (the layout lifts it 0.36).
export function nbTrolley({ seed = 12, length = 17 } = {}) {
  const trim = [];
  const glow = [];
  const hl = length / 2;

  // Body: one loft, nose to tail, rounded at both ends. Axis 'z'; the section carries
  // the skirt and the tumblehome. Belt at 4.1, cream band to 6.6, roof crown 8.1.
  const body = solidLoft([
    { d: -hl, w: 0.1, up: 2.6, dn: 2.4, a: 0, b: 4.35, round: 0.85 },
    { d: -hl + 1.6, w: 2.9, up: 2.9, dn: 3.1, b: 4.35, roundUp: 0.55, roundDn: 0.4 },
    { d: -hl * 0.45, w: 3.1, up: 3.15, dn: 3.3, b: 4.35, roundUp: 0.5, roundDn: 0.35 },
    { d: 0, w: 3.15, up: 3.2, dn: 3.32, b: 4.35, roundUp: 0.5, roundDn: 0.35 },
    { d: hl * 0.45, w: 3.1, up: 3.15, dn: 3.3, b: 4.35, roundUp: 0.5, roundDn: 0.35 },
    { d: hl - 1.6, w: 2.9, up: 2.9, dn: 3.1, b: 4.35, roundUp: 0.55, roundDn: 0.4 },
    { d: hl, w: 0.1, up: 2.6, dn: 2.4, b: 4.35, round: 0.85 },
  ], { sides: 44, samples: 110 });
  put(trim, body, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // Window band: cream between 4.35 and 6.7, with dark arched window openings.
      if (p.y > 4.3 && p.y < 6.75 && Math.abs(p.z) < hl - 1.1) {
        const bay = 3.1;
        const local = ((p.z % bay) + bay) % bay;
        const cx = bay / 2;
        const dz = Math.abs(local - cx);
        const arch = p.y < 6.15 || (dz < 0.9 && p.y < 6.15 + Math.sqrt(Math.max(0, 0.81 - dz * dz)) * 0.45);
        if (dz < 1.05 && p.y > 4.75 && arch) {
          const c = col(0x2c2117);
          return [c.r, c.g, c.b];
        }
        const c = col(NB.trolleyCream);
        return [c.r, c.g, c.b];
      }
      // Gold beltline and skirt stripes on the red.
      if ((p.y > 4.02 && p.y < 4.3) || (p.y > 1.55 && p.y < 1.8)) {
        const c = col(NB.trolleyGold);
        return [c.r, c.g, c.b];
      }
      if (p.y > 6.9) {
        const c = col(NB.trolleyRoof);
        return [c.r, c.g, c.b];
      }
      const c = col(NB.trolleyRed);
      return [c.r, c.g, c.b];
    },
  });

  // Lit window strip inside the band -- a slightly narrower box glowing through.
  put(glow, boxG(5.6, 1.5, length - 3.4), NB.glassLit, [0, 5.5, 0]);

  // Clerestory: a raised centre roof with tiny lit lights.
  put(trim, boxG(3.4, 0.85, length - 4.6), NB.trolleyRed, [0, 7.95, 0]);
  put(glow, boxG(3.5, 0.4, length - 5.4), NB.glassLit, [0, 7.9, 0]);
  put(trim, boxG(3.9, 0.3, length - 4.2), NB.trolleyRoof, [0, 8.5, 0]);

  // Undercarriage: skirt shadow box, axleboxes, cowcatchers.
  put(trim, boxG(5.2, 1.1, length - 3), 0x241f1c, [0, 0.85, 0]);
  for (const sz of [-hl * 0.52, hl * 0.52]) {
    for (const sx of [-2.6, 2.6]) {
      put(trim, new THREE.CylinderGeometry(0.75, 0.75, 0.4, 14), 0x1c1917, [sx, 0.75, sz], [0, 0, Math.PI / 2]);
    }
  }
  for (const se of [1, -1]) {
    // Cowcatcher: a little slatted wedge.
    for (let i = 0; i < 4; i++) {
      put(trim, boxG(4.6 - i * 0.9, 0.16, 0.16), NB.trolleyGold, [0, 0.35 + i * 0.38, se * (hl - 0.4 + i * 0.28)]);
    }
    // Headlamp and destination board.
    put(trim, new THREE.CylinderGeometry(0.34, 0.34, 0.3, 12), NB.brass, [0, 7.1, se * (hl - 0.7)], [Math.PI / 2, 0, 0]);
    put(glow, new THREE.CylinderGeometry(0.26, 0.26, 0.34, 12), 0xfff2c8, [0, 7.1, se * (hl - 0.68)], [Math.PI / 2, 0, 0]);
  }

  const g = group();
  g.add(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.5, metalness: 0.12 })));
  const glowMesh = mesh(mergeParts(glow), standard({
    vertexColors: true, roughness: 0.4, emissive: new THREE.Color(0xffc86a), emissiveIntensity: 0.9,
  }));
  glowMesh.castShadow = false;
  g.add(glowMesh);

  // Nameboards, both flanks.
  for (const sx of [1, -1]) {
    const board = texPlate(7.5, 0.72, 512, 48, (ctx, w, h) => {
      ctx.fillStyle = '#8e2420';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f2d896';
      const label = 'NEIGHBORHOOD TROLLEY';
      const px = fitText(ctx, label, w - 30, 34, `700 {px}px Georgia, serif`);
      ctx.font = `700 ${px}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, w / 2, h / 2 + 1);
    });
    board.position.set(sx * 3.19, 3.4, 0);
    board.rotation.y = sx * Math.PI / 2;
    g.add(board);
  }
  return g;
}

// ---------------------------------------------------------------------------
// THE CARS
// ---------------------------------------------------------------------------

// A road wheel: tyre, whitewall, chrome hubcap -- one lathe about Y, tinted by radius
// on the outboard face, then turned outboard. `side` +1 is the car's +X flank.
function carWheel(trim, { at, r = 1.06, width = 0.78, side = 1, whitewall = true }) {
  const prof = closedProfile([
    [r * 0.55, -width / 2], [r * 0.92, -width / 2 + 0.06], [r, -width * 0.18],
    [r, width * 0.18], [r * 0.92, width / 2 - 0.06], [r * 0.62, width / 2],
    [r * 0.6, width / 2 + 0.02], [r * 0.44, width / 2 + 0.1], [r * 0.2, width / 2 + 0.14],
  ]);
  const g = lathed(prof, { segments: 18 });
  const tyre = col(NB.tyre);
  const wall = col(0xf7f4ea);
  const cap = col(0xe9ecef);
  tintGeometry(g, (p) => {
    const rad = Math.hypot(p.x, p.z);
    if (p.y > width / 2 - 0.02 && rad < r * 0.52) return [cap.r, cap.g, cap.b];
    if (whitewall && p.y > width * 0.16 && rad > r * 0.38 && rad < r * 0.85) return [wall.r, wall.g, wall.b];
    return [tyre.r, tyre.g, tyre.b];
  });
  put(trim, xformed(g, new THREE.Matrix4().makeRotationZ(side > 0 ? -Math.PI / 2 : Math.PI / 2)),
    0xffffff, at, null, { keepColor: true });
}

// A mid-century car. Styles: 'sedan' | 'coupe' | 'wagon' | 'pickup' | 'van'. The body
// is ONE loft two-toned by tint (white sentinel), the greenhouse a second loft whose
// glass, pillars and roof are painted the same way, the wheels lathes. Painted wheel
// arches -- a dark half-disc shadow in the tint -- do the work a cut-out cannot.
export function nbCar({
  seed = 13, style = 'sedan', colour = NB.carGreen, roofColour = null, whitewall = true,
} = {}) {
  const trim = [];
  const glow = [];
  const body = col(colour);
  const roofC = col(roofColour ?? colour);
  const glass = col(0x4a5866);
  const chrome = col(NB.chrome);
  const dark = col(0x1d1f22);

  const van = style === 'van';
  const pickup = style === 'pickup';
  const wagon = style === 'wagon';
  const coupe = style === 'coupe';
  const hl = van ? 8.6 : 7.8;
  const wheelZ = [hl * 0.6, -hl * 0.58];
  const wheelR = 1.06;

  // --- the lower hull --------------------------------------------------------
  let stations;
  if (van) {
    stations = [
      { d: -hl, w: 0.12, up: 2.2, dn: 1.9, b: 3.6, round: 0.5 },
      { d: -hl + 0.7, w: 2.9, up: 2.75, dn: 2.55, b: 3.6, roundUp: 0.35, roundDn: 0.42 },
      { d: hl - 3.6, w: 2.95, up: 2.8, dn: 2.6, b: 3.6, roundUp: 0.35, roundDn: 0.42 },
      { d: hl - 2.2, w: 2.85, up: 1.15, dn: 2.55, b: 3.55, roundUp: 0.5, roundDn: 0.42 },
      { d: hl - 0.5, w: 2.7, up: 0.75, dn: 2.3, a: 0, b: 3.3, roundUp: 0.45, roundDn: 0.42 },
      { d: hl, w: 0.12, up: 0.6, dn: 1.9, b: 3.3, round: 0.5 },
    ];
  } else if (pickup) {
    stations = [
      { d: -hl, w: 0.12, up: 0.9, dn: 0.85, b: 2.45, round: 0.5 },
      { d: -hl + 0.5, w: 2.95, up: 1.15, dn: 1.25, b: 2.45, roundUp: 0.28, roundDn: 0.45 },
      { d: 0.4, w: 2.95, up: 1.15, dn: 1.3, b: 2.45, roundUp: 0.28, roundDn: 0.45 },
      { d: 1.1, w: 2.9, up: 1.3, dn: 1.35, b: 2.4, roundUp: 0.35, roundDn: 0.45 },
      { d: 5.4, w: 2.9, up: 1.15, dn: 1.3, b: 2.35, roundUp: 0.35, roundDn: 0.45 },
      { d: hl - 0.5, w: 2.75, up: 0.95, dn: 1.15, b: 2.35, roundUp: 0.35, roundDn: 0.45 },
      { d: hl, w: 0.12, up: 0.7, dn: 0.7, b: 2.45, round: 0.5 },
    ];
  } else {
    stations = [
      { d: -hl, w: 0.12, up: 0.72, dn: 0.7, b: 2.5, round: 0.55 },
      { d: -hl + 0.5, w: 2.85, up: 0.95, dn: 1.0, b: 2.5, roundUp: 0.32, roundDn: 0.48 },
      { d: -5.0, w: 3.05, up: 1.15, dn: 1.16, b: 2.42, roundUp: 0.34, roundDn: 0.48 },
      { d: -2.0, w: 3.1, up: 1.2, dn: 1.18, b: 2.4, roundUp: 0.36, roundDn: 0.48 },
      { d: 2.2, w: 3.1, up: 1.12, dn: 1.18, b: 2.36, roundUp: 0.36, roundDn: 0.48 },
      { d: 5.2, w: 3.0, up: 1.0, dn: 1.15, b: 2.32, roundUp: 0.34, roundDn: 0.48 },
      { d: hl - 0.5, w: 2.85, up: 0.88, dn: 1.02, b: 2.3, roundUp: 0.32, roundDn: 0.48 },
      { d: hl, w: 0.12, up: 0.62, dn: 0.68, b: 2.4, round: 0.55 },
    ];
  }
  const hull = solidLoft(stations, { sides: 44, samples: van ? 110 : 84 });
  const archAt = (p, wz) => {
    const d = Math.hypot(p.z - wz, (p.y - 1.06) * 1.15);
    return Math.abs(p.x) > 2.2 && p.y < 2.5 && d < wheelR + 0.34;
  };
  put(trim, hull, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      if (archAt(p, wheelZ[0]) || archAt(p, wheelZ[1])) return [dark.r, dark.g, dark.b];
      // rocker shadow
      if (p.y < 1.42) {
        const c = mixCol(colour, 0x000000, 0.2);
        return [c.r, c.g, c.b];
      }
      // chrome side spear
      if (!van && !pickup && Math.abs(p.x) > 2.72 && p.y > 2.82 && p.y < 3.02 && Math.abs(p.z) < hl - 1) {
        return [chrome.r, chrome.g, chrome.b];
      }
      // van windshield painted into the sloped front, plus its side glass line
      if (van && p.z > hl - 2.35 && p.z < hl - 0.6 && p.y > 4.35 && p.y < 5.9) {
        return [glass.r, glass.g, glass.b];
      }
      if (van && Math.abs(p.x) > 2.5 && p.y > 4.4 && p.y < 5.7 && p.z > hl - 4.5 && p.z < hl - 2.7) {
        return [glass.r, glass.g, glass.b];
      }
      if (van && p.y > 6.05) { return [roofC.r, roofC.g, roofC.b]; }
      return [body.r, body.g, body.b];
    },
  });

  // --- the greenhouse (not for the van, whose glass lives in the hull) -------
  if (!van) {
    const cabB = 3.52;
    let cab;
    if (pickup) {
      cab = [
        { d: 0.7, w: 0.1, up: 0.35, dn: 0.3, b: cabB, round: 0.7 },
        { d: 1.0, w: 2.45, up: 1.2, dn: 0.42, b: cabB, roundUp: 0.42, roundDn: 0.8 },
        { d: 3.4, w: 2.5, up: 1.22, dn: 0.45, b: cabB, roundUp: 0.3, roundDn: 0.8 },
        { d: 4.3, w: 2.3, up: 0.85, dn: 0.4, b: cabB, roundUp: 0.5, roundDn: 0.8 },
        { d: 4.9, w: 0.1, up: 0.3, dn: 0.3, b: cabB, round: 0.7 },
      ];
    } else if (wagon) {
      cab = [
        { d: -hl + 1.0, w: 0.1, up: 0.35, dn: 0.3, b: cabB, round: 0.7 },
        { d: -hl + 1.5, w: 2.5, up: 1.22, dn: 0.42, b: cabB, roundUp: 0.42, roundDn: 0.8 },
        { d: 0.8, w: 2.6, up: 1.24, dn: 0.45, b: cabB, roundUp: 0.3, roundDn: 0.8 },
        { d: 1.9, w: 2.45, up: 0.9, dn: 0.4, b: cabB, roundUp: 0.5, roundDn: 0.8 },
        { d: 2.6, w: 0.1, up: 0.32, dn: 0.3, b: cabB, round: 0.7 },
      ];
    } else if (coupe) {
      cab = [
        { d: -4.4, w: 0.1, up: 0.3, dn: 0.25, b: cabB, round: 0.7 },
        { d: -3.6, w: 2.45, up: 0.95, dn: 0.4, b: cabB, roundUp: 0.5, roundDn: 0.8 },
        { d: -1.2, w: 2.6, up: 1.2, dn: 0.45, b: cabB, roundUp: 0.3, roundDn: 0.8 },
        { d: 1.2, w: 2.55, up: 1.18, dn: 0.45, b: cabB, roundUp: 0.3, roundDn: 0.8 },
        { d: 2.1, w: 2.4, up: 0.88, dn: 0.4, b: cabB, roundUp: 0.5, roundDn: 0.8 },
        { d: 2.75, w: 0.1, up: 0.3, dn: 0.3, b: cabB, round: 0.7 },
      ];
    } else {
      cab = [
        { d: -4.9, w: 0.1, up: 0.3, dn: 0.25, b: cabB, round: 0.7 },
        { d: -4.35, w: 2.5, up: 1.08, dn: 0.4, b: cabB, roundUp: 0.48, roundDn: 0.8 },
        { d: -2.0, w: 2.6, up: 1.3, dn: 0.45, b: cabB, roundUp: 0.45, roundDn: 0.8 },
        { d: 1.1, w: 2.6, up: 1.22, dn: 0.45, b: cabB, roundUp: 0.3, roundDn: 0.8 },
        { d: 2.0, w: 2.45, up: 0.9, dn: 0.4, b: cabB, roundUp: 0.5, roundDn: 0.8 },
        { d: 2.65, w: 0.1, up: 0.3, dn: 0.3, b: cabB, round: 0.7 },
      ];
    }
    const cabin = solidLoft(cab, { sides: 36, samples: 110 });
    const cabTail = cab[0].d;
    const cabNose = cab[cab.length - 1].d;
    const pillars = pickup
      ? [[cabNose - 1.1, cabNose - 0.5], [cabTail + 0.3, cabTail + 0.9]]
      : wagon
        ? [[1.4, 2.0], [-1.6, -1.2], [-4.4, -4.0], [cabTail + 0.3, cabTail + 0.9]]
        : [[1.5, 2.1], [-0.9, -0.5], [cabTail + 0.4, cabTail + 1.1]];
    put(trim, cabin, 0xffffff, null, null, {
      keepColor: true,
      tint: (p) => {
        // The loft's closing domes are body-colour cowl and deck, never glass -- glass
        // wrapped over a dome reads as a dark ring around the roof.
        if (p.z > cabNose - 0.22 || p.z < cabTail + 0.35) { return [roofC.r, roofC.g, roofC.b]; }
        if (p.y > 4.62) { return [roofC.r, roofC.g, roofC.b]; }
        if (p.y < 3.66) { return [body.r, body.g, body.b]; }
        for (const [z0, z1] of pillars) {
          if (p.z > z0 && p.z < z1) return [roofC.r, roofC.g, roofC.b];
        }
        return [glass.r, glass.g, glass.b];
      },
    });
  }

  // --- pickup bed / wagon tail details --------------------------------------
  if (pickup) {
    put(trim, boxG(5.4, 0.25, 6.6), mixCol(colour, 0x000000, 0.3).getHex(), [0, 2.7, -3.9]);
    for (const sx of [-2.75, 2.75]) put(trim, boxG(0.22, 1.5, 6.8), body.getHex(), [sx, 3.15, -3.9]);
    put(trim, boxG(5.7, 1.5, 0.24), body.getHex(), [0, 3.15, -7.2]);
    put(trim, boxG(5.4, 0.5, 0.2), mixCol(colour, 0x000000, 0.25).getHex(), [0, 2.9, -0.55]);
  }

  // --- undercarriage, bumpers, lights ---------------------------------------
  put(trim, boxG(4.5, 0.8, hl * 2 - 3.4), 0x1b1d20, [0, 0.85, 0]);
  const bumperG = extrudeOutline(roundedOutline(3.38, 0.36, 0.28, 3), 0.72, { uvFeet: false });
  put(trim, bumperG, NB.chrome, [0, van ? 1.5 : 1.42, hl - 0.15]);
  put(trim, bumperG, NB.chrome, [0, van ? 1.5 : 1.42, -hl + 0.15]);
  if (!van) {
    // grille and headlights
    put(trim, boxG(4.4, 0.7, 0.3), 0x22252a, [0, 2.55, hl - 0.28]);
    for (let i = 0; i < 3; i++) put(trim, boxG(4.3, 0.09, 0.32), NB.chrome, [0, 2.34 + i * 0.21, hl - 0.26]);
    for (const sx of [-2.15, 2.15]) {
      put(trim, new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14), NB.chrome, [sx, 2.85, hl - 0.3], [Math.PI / 2, 0, 0]);
      put(glow, new THREE.CylinderGeometry(0.27, 0.27, 0.3, 14), 0xfff4d0, [sx, 2.85, hl - 0.28], [Math.PI / 2, 0, 0]);
    }
    for (const sx of [-2.3, 2.3]) put(trim, boxG(0.7, 0.3, 0.22), 0xa02020, [sx, 2.7, -hl + 0.3]);
  } else {
    for (const sx of [-1.9, 1.9]) {
      put(trim, new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14), NB.chrome, [sx, 2.6, hl - 0.32], [Math.PI / 2, 0, 0]);
      put(glow, new THREE.CylinderGeometry(0.25, 0.25, 0.3, 14), 0xfff4d0, [sx, 2.6, hl - 0.3], [Math.PI / 2, 0, 0]);
    }
    for (const sx of [-2.1, 2.1]) put(trim, boxG(0.6, 0.34, 0.2), 0xa02020, [sx, 2.6, -hl + 0.24]);
  }

  // --- wheels ---------------------------------------------------------------
  for (const wz of wheelZ) {
    for (const side of [1, -1]) {
      carWheel(trim, { at: [side * 2.62, wheelR, wz], side, whitewall: whitewall && !pickup && !van });
    }
  }

  const g = group();
  g.add(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.42, metalness: 0.22 })));
  if (glow.length) {
    const glowMesh = mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.35, emissive: new THREE.Color(0xfff0c0), emissiveIntensity: 0.35,
    }));
    glowMesh.castShadow = false;
    g.add(glowMesh);
  }
  // The delivery van earns its lettering.
  if (van) {
    for (const sx of [1, -1]) {
      const board = texPlate(6.6, 1.5, 512, 116, (ctx, w, h) => {
        ctx.fillStyle = '#ece6d6';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#8e2420';
        const label = 'SPEEDY DELIVERY';
        const px = fitText(ctx, label, w - 36, 52, `800 {px}px Futura, "Trebuchet MS", sans-serif`);
        ctx.font = `800 ${px}px Futura, "Trebuchet MS", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2 - 12);
        ctx.fillStyle = '#3a3f46';
        ctx.font = '600 26px Georgia, serif';
        ctx.fillText('· PARCELS AND POST ·', w / 2, h / 2 + 32);
      });
      board.position.set(sx * 2.97, 3.9, -0.6);
      board.rotation.y = sx * Math.PI / 2;
      g.add(board);
    }
  }
  return g;
}

// The farm tractor by the barn: big lugged rear wheels, a long nose, a sprung seat and
// an exhaust stack.
export function nbTractor({ seed = 14, colour = 0x3a5a8c } = {}) {
  const trim = [];
  const body = col(colour);
  // rear wheels
  for (const side of [1, -1]) {
    const prof = closedProfile([
      [1.1, -0.42], [1.9, -0.42], [1.9, 0.42], [1.1, 0.42], [0.5, 0.5], [0.2, 0.52],
    ]);
    const g = lathed(prof, { segments: 16 });
    const tyre = col(NB.tyre);
    const hub = col(0xd8d2c0);
    tintGeometry(g, (p) => {
      const rad = Math.hypot(p.x, p.z);
      return rad > 1.05 ? [tyre.r, tyre.g, tyre.b] : [hub.r, hub.g, hub.b];
    });
    put(trim, xformed(g, new THREE.Matrix4().makeRotationZ(side > 0 ? -Math.PI / 2 : Math.PI / 2)),
      0xffffff, [side * 1.9, 1.9, -1.3], null, { keepColor: true });
  }
  for (const side of [1, -1]) {
    carWheel(trim, { at: [side * 1.25, 0.85, 2.6], r: 0.85, width: 0.5, side, whitewall: false });
  }
  // hull: engine cowl loft
  put(trim, solidLoft([
    { d: -2.2, w: 0.9, up: 0.9, dn: 0.8, b: 2.7, round: 0.5 },
    { d: 0.6, w: 0.85, up: 0.85, dn: 0.9, b: 2.7, round: 0.5 },
    { d: 2.4, w: 0.7, up: 0.65, dn: 0.75, b: 2.55, round: 0.5 },
    { d: 3.4, w: 0.1, up: 0.3, dn: 0.4, b: 2.5, round: 0.6 },
  ], { sides: 20, samples: 16 }), colour);
  put(trim, boxG(1.9, 0.8, 2.6), mixCol(colour, 0x000000, 0.25).getHex(), [0, 1.6, -0.6]);
  // fenders over the rear wheels
  for (const side of [1, -1]) {
    put(trim, boxG(0.95, 0.25, 2.6), body.getHex(), [side * 1.9, 3.15, -1.3]);
    put(trim, boxG(0.95, 1.1, 0.25), body.getHex(), [side * 1.9, 2.7, -2.55]);
  }
  // seat, wheel, stack
  put(trim, boxG(1.1, 0.2, 1.1), 0x2c2c30, [0, 2.9, -2.2]);
  put(trim, boxG(0.16, 0.9, 0.16), 0x2c2c30, [0, 2.5, -1.6]);
  put(trim, new THREE.TorusGeometry(0.5, 0.07, 8, 16), 0x1c1e22, [0, 3.35, -1.35], [0.5, 0, 0]);
  put(trim, new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), 0x2c2c30, [0.45, 4.1, 1.4]);
  put(trim, new THREE.CylinderGeometry(0.13, 0.09, 0.3, 8), 0x2c2c30, [0.45, 4.95, 1.4]);
  put(trim, new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10), 0x686258, [0, 3.6, 1]);

  return group(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.55, metalness: 0.2 })));
}

// ---------------------------------------------------------------------------
// PLANTING, THE ROCK HILL, AND STREET FURNITURE
// ---------------------------------------------------------------------------

// A street tree, cheap on purpose: this world plants forty of them, and the araucaria
// lesson says a background prop's cost is multiplied by its placement count. A short
// forked trunk and five overlapping canopy masses pulled toward a bridging centre ball
// (the wonder-tree lesson: separate balls read as balloons), dappled by tint.
// Variants: 'green' | 'autumn' | 'gold'.
export function nbTree({ seed = 15, height = 24, variant = 'green' } = {}) {
  const rng = seededRandom(seed);
  const trunkH = height * 0.42;
  const parts = [];
  const nodes = [
    { p: [0, 0, 0], r: height * 0.045 },
    { p: [rng() * 0.6 - 0.3, trunkH * 0.55, rng() * 0.6 - 0.3], r: height * 0.035 },
    { p: [rng() * 0.9 - 0.45, trunkH, rng() * 0.9 - 0.45], r: height * 0.022 },
  ];
  chain(parts, NB.trunk, nodes, { sides: 9, capStart: false });
  const top = nodes[2].p;
  const limbs = 3;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rng();
    const reach = height * (0.14 + rng() * 0.06);
    chain(parts, NB.trunk, [
      { p: top, r: height * 0.02 },
      { p: [top[0] + Math.cos(a) * reach, top[1] + height * 0.16, top[2] + Math.sin(a) * reach], r: height * 0.009 },
    ], { sides: 7, capStart: false });
  }
  const trunkGeom = mergeParts(parts);

  const [c1, c2] = variant === 'autumn' ? [NB.autumn, NB.autumnDeep]
    : variant === 'gold' ? [NB.goldLeaf, 0xb2842a] : [NB.leaf, NB.leafDeep];
  const puffParts = [];
  const crownY = trunkH + height * 0.26;
  const crownR = height * 0.28;
  put(puffParts, ball(crownR, 16), 0xffffff, [top[0] * 0.5, crownY, top[2] * 0.5], null, { scale: [1.35, 1.0, 1.3] });
  const puffs = 5;
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * Math.PI * 2 + rng() * 0.8;
    const rr = crownR * (0.58 + rng() * 0.2);
    put(puffParts, ball(rr, 14), 0xffffff, [
      top[0] * 0.5 + Math.cos(a) * crownR * 0.6,
      crownY + (rng() - 0.4) * crownR * 0.5,
      top[2] * 0.5 + Math.sin(a) * crownR * 0.58,
    ], null, { scale: [1.08, 0.82, 1.08] });
  }
  const crown = mergeParts(puffParts.map((p) => ({ ...p, color: 0xffffff })));
  const lo = col(c2);
  const hi = col(c1);
  tintGeometry(crown, (p) => {
    const dap = smoothNoise3(p.x * 0.32 + seed, p.y * 0.32, p.z * 0.32);
    const t = THREE.MathUtils.clamp((p.y - trunkH) / (height - trunkH), 0, 1);
    const c = lo.clone().lerp(hi, 0.3 + t * 0.45 + dap * 0.35);
    return [c.r, c.g, c.b];
  });
  const g = group();
  g.add(mesh(trunkGeom, standard({ vertexColors: true, roughness: 0.9, ...relief('bark', { seed, repeat: 3 }) })));
  g.add(mesh(crown, standard({ vertexColors: true, roughness: 0.92, ...relief('weave', { seed: seed + 1, repeat: 8, strength: 0.28 }) })));
  return g;
}

// A conifer: three overlapping foliage cones on a stub trunk. Cheaper still.
export function nbConifer({ seed = 16, height = 20 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  put(parts, new THREE.CylinderGeometry(height * 0.02, height * 0.032, height * 0.22, 8), NB.bark, [0, height * 0.11, 0]);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const r = height * (0.21 - t * 0.065) * (0.94 + rng() * 0.12);
    const coneH = height * 0.42;
    const y = height * (0.14 + t * 0.27);
    put(parts, new THREE.ConeGeometry(r, coneH, 10), 0xffffff, [0, y + coneH / 2, 0], null, {
      keepColor: true,
      tint: (p) => {
        const tt = THREE.MathUtils.clamp((p.y + coneH / 2) / coneH, 0, 1);
        const c = mixCol(NB.coniferDeep, NB.conifer, 0.3 + tt * 0.6 + (rng() - 0.5) * 0.05);
        return [c.r, c.g, c.b];
      },
    });
  }
  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.92, ...relief('weave', { seed, repeat: 4, strength: 0.4 }) })));
}

// A clipped hedge row: three overlapping flattened masses.
export function nbHedge({ seed = 17, length = 10, height = 2.6 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const n = Math.max(2, Math.round(length / 3.4));
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + ((i + 0.5) * length) / n;
    put(parts, ball(2.1 * (0.95 + rng() * 0.1), 12), 0xffffff,
      [x, height * 0.42, 0], null, { scale: [(length / n) * 0.34, height * 0.24, 0.62], keepColor: true,
        tint: (p) => {
          const dap = smoothNoise3(p.x * 0.5 + seed, p.y * 0.5, p.z * 0.5);
          const c = mixCol(NB.leafDeep, NB.leaf, 0.3 + dap * 0.5 + (p.y / (height)) * 0.3);
          return [c.r, c.g, c.b];
        } });
  }
  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.92, ...relief('weave', { seed, repeat: 5, strength: 0.5 }) })));
}

// The bare rock outcrop behind the town -- the one hill in the reference model. A
// noise-displaced sphere (radial displacement by DIRECTION, so shared corners move
// together), sunk to a third of its height, banded by tint.
export function nbRockHill({ seed = 18, width = 60, height = 26 } = {}) {
  const g = new THREE.SphereGeometry(1, 40, 26);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const n = smoothNoise3(v.x * 2.1 + seed, v.y * 2.1, v.z * 2.1) * 0.34
      + smoothNoise3(v.x * 5.2 + seed * 2, v.y * 5.2, v.z * 5.2) * 0.14;
    const r = 1 + (n - 0.24) * 0.85;
    pos.setXYZ(i, v.x * r, v.y * r, v.z * r);
  }
  g.computeVertexNormals();
  g.scale(width / 2, height * 0.72, width * 0.36);
  g.translate(0, height * 0.28, 0);
  const dark = col(NB.rockDeep);
  const light = col(NB.rock);
  tintGeometry(g, (p) => {
    const strata = 0.5 + 0.5 * Math.sin(p.y * 0.9 + smoothNoise3(p.x * 0.2, 0, p.z * 0.2) * 3);
    const dap = smoothNoise3(p.x * 0.3 + seed, p.y * 0.3, p.z * 0.3);
    const c = dark.clone().lerp(light, 0.35 + strata * 0.3 + dap * 0.3);
    return [c.r, c.g, c.b];
  });
  return group(mesh(g, standard({ vertexColors: true, roughness: 0.95, ...relief('stone', { seed, repeat: 7 }) })));
}

// A stop sign: octagon head on a channel post.
export function nbStopSign({ seed = 19 } = {}) {
  const trim = [];
  put(trim, boxG(0.28, 8, 0.18), 0x3c4046, [0, 4, 0]);
  const oct = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    oct.push([Math.cos(a) * 1.25, Math.sin(a) * 1.25]);
  }
  put(trim, extrudeOutline(oct, 0.12, { uvFeet: false }), 0xb02420, [0, 8.6, 0.05]);
  const g = group(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.6, metalness: 0.25 })));
  const face = texPlate(2.3, 2.3, 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f2efe6';
    ctx.font = '800 40px Futura, "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', w / 2, h / 2 + 2);
    ctx.strokeStyle = '#f2efe6';
    ctx.lineWidth = 5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = w / 2 + Math.cos(a) * w * 0.44;
      const y = h / 2 + Math.sin(a) * h * 0.44;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  });
  face.material.transparent = true;
  face.position.set(0, 8.6, 0.13);
  g.add(face);
  return g;
}

// The corner mailbox: a blue rounded-top collection box on four legs.
export function nbMailbox({ seed = 20 } = {}) {
  const trim = [];
  const w = 1.6;
  const outline = roundedOutline(w / 2, 1.05, 0.55, 5);
  const bodyG = extrudeOutline(outline, 1.5, { uvFeet: false });
  put(trim, bodyG, NB.mailbox, [0, 2.5, 0], [0, Math.PI / 2, 0]);
  for (const sx of [-0.55, 0.55]) {
    for (const sz of [-0.5, 0.5]) put(trim, boxG(0.14, 1.5, 0.14), 0x2c3238, [sx, 0.75, sz]);
  }
  put(trim, boxG(w - 0.25, 0.5, 0.06), 0x1e2f52, [0, 3, 0.76]);
  put(trim, boxG(w - 0.5, 0.06, 0.1), 0x8a94a4, [0, 2.72, 0.78]);
  const g = group(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.5, metalness: 0.3 })));
  const label = texPlate(1.3, 0.44, 128, 44, (ctx, w2, h2) => {
    ctx.fillStyle = '#1e2f52';
    ctx.fillRect(0, 0, w2, h2);
    ctx.fillStyle = '#e8e4d8';
    ctx.font = '700 26px Futura, "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('U.S. MAIL', w2 / 2, h2 / 2 + 1);
  });
  label.position.set(0, 2.1, 0.79);
  g.add(label);
  return g;
}

// A white picket fence run, centred on its own length.
export function nbPicketFence({ seed = 21, length = 14 } = {}) {
  const trim = [];
  const posts = Math.max(2, Math.round(length / 7) + 1);
  for (let i = 0; i < posts; i++) {
    put(trim, boxG(0.3, 3.4, 0.3), NB.fence, [-length / 2 + (i * length) / (posts - 1), 1.7, 0]);
  }
  for (const y of [1.2, 2.5]) put(trim, boxG(length, 0.22, 0.14), NB.fence, [0, y, 0]);
  const pickets = Math.round(length / 0.72);
  for (let i = 0; i <= pickets; i++) {
    const x = -length / 2 + (i * length) / pickets;
    put(trim, boxG(0.3, 2.9, 0.1), NB.fence, [x, 1.55, 0.09]);
    put(trim, new THREE.ConeGeometry(0.19, 0.3, 4), NB.fence, [x, 3.12, 0.09], [0, Math.PI / 4, 0]);
  }
  return group(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.8, ...relief('wood', { seed, repeat: 4, strength: 0.3 }) })));
}
