import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, relief, mergedMesh,
} from '../PropKit.js';
import {
  extrudeOutline, revolve, ball, tube, mergeParts, tintGeometry, xformed, put,
  roundedOutline, smoothNoise3, smoothed,
} from './LoftKit.js';
import {
  PLAN, pavementPatches, curbRuns, roadHeight, isPan, apronRows, apronHeight, APRON_WING, sinkAt,
} from './turkle/plan.js';

// TURKLE STREET -- the 1400 block of North Turkle Avenue at West 7th Street, Park City,
// Kansas, on a clear afternoon in early October, built from six Street View photographs.
//
// IT IS THE ONLY WORLD IN THIS APP MODELLED ON A REAL ADDRESS, and that changes what the
// props are for. Everywhere else the job is to make a thing READ as what it is -- a T. rex
// that reads as a theropod, a fountain that reads as a fountain -- and the modelling is free
// wherever the reading does not depend on it. Here the reading is not in question: everybody
// knows what a ranch house with a porch looks like. What is in question is whether it is
// THIS ranch house, so the numbers are measured off the photographs and the details that
// carry a particular house are the ones that get built: the cross gable over the left third,
// the flag on its angled bracket, the white cellar bulkhead against the west wall, the
// pumpkin on the step, the brick-edged ring round the hackberry.
//
// This world is also the app's first HiFi-FIRST world. Everything here is the pickable,
// measurable, programmable three.js object; almost all of it is substituted by a native
// Babylon model in `HiFi/src/props/Turkle.js`, which is what is actually drawn. So these
// builders carry the MASSING, the openings and the palette -- correct to the foot, because
// the native has to stand in the same place -- and leave the photographic surfaces to the
// edition that can afford them.
//
// House rules unchanged: feet at scale 1, origin at base centre, facing +Z, fresh materials
// per call, seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette -- read off the photographs, not invented
// ---------------------------------------------------------------------------

export const TS = {
  // Paving. The asphalt is warmer and paler than a city street: this is an old chip-seal
  // surface bleached by twenty Kansas summers, not fresh blacktop.
  asphalt: 0x5a5854,
  asphaltPatch: 0x6b6c6b,
  asphaltSeal: 0x3b3c3e,
  concrete: 0xc2bcad,
  concreteOld: 0xb1aa9b,
  concreteDark: 0x9c9689,

  // The hero house. A soft khaki lap siding with dark chocolate trim -- the single most
  // characteristic thing about this block, and a colour that goes muddy the moment the lawn
  // around it is painted a brighter green than it really is.
  siding: 0xcdb17a,
  sidingShade: 0xb59d72,
  trimDark: 0x4e3a2a,
  trimWhite: 0xf0ebe0,
  doorBrown: 0x4a3226,
  shingle: 0x6f6152,
  shingleDark: 0x5b4f43,
  foundation: 0xafa694,

  // The neighbours, each one a house in the photographs.
  sidingWhite: 0xe9e6dc,
  sidingGreen: 0xbcc6ae,
  sidingBlue: 0x7f9099,
  sidingCream: 0xded4bb,
  sidingTan: 0xcdbc9c,
  roofGrey: 0x6b6d70,
  roofBrown: 0x6a5a49,
  roofRedMetal: 0x8e3a2e,
  garageDoor: 0xe6e2d6,

  // Joinery, glass and metal
  glass: 0x2b3238,
  glassLit: 0xffd48a,
  glassSky: 0x8ea9bb,
  brass: 0xbf9a4e,
  galv: 0xb4b7ba,
  galvDark: 0x8d9194,
  steel: 0x6e7174,

  // Timber
  cedar: 0x9c8467,
  cedarGrey: 0x8b7a63,
  cedarDark: 0x6d5f4c,
  pole: 0x6f6050,
  poleDark: 0x554941,

  // Planting and ground furniture
  leaf: 0x59763a,
  leafDeep: 0x415c2c,
  leafGold: 0xb09433,
  leafTan: 0xa98243,
  needle: 0x3f5a3e,
  trunk: 0x6a5a48,
  bark: 0x51453a,
  mulch: 0x54402f,
  brickEdge: 0x9c5a42,
  pumpkin: 0xd2711f,
  flagRed: 0xaa2a30,
  flagBlue: 0x27356b,
  flagWhite: 0xf2efe6,
};

const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const UP = [0, 1, 0];
const DOWN = [0, -1, 0];
const rnd = (seed) => seededRandom(seed);
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// A rectangle outline with DOUBLED corner points, so an extruded shell's walls do not share
// corner vertices and shade as a pillow. The Neighborhood's `cornerRect`, and the reason is
// the same here: computeVertexNormals averages every face at a vertex.
function cornerRect(halfW, halfH, e = 0.004) {
  return [
    [halfW, -halfH + e], [halfW, halfH - e], [halfW - e, halfH],
    [-halfW + e, halfH], [-halfW, halfH - e], [-halfW, -halfH + e],
    [-halfW + e, -halfH], [halfW - e, -halfH],
  ];
}

// mergeParts composes its Euler as Rx*Ry*Rz, so "turn in plan, then lay flat" cannot be said
// with one Euler at all. Bake the matrix in the order actually wanted.
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

function lathed(profile, opts) { return revolve([...profile].reverse(), opts); }

// A lathe profile that does not start and end ON the axis is an open tube, and the hole is
// at the top of the post where a student looking up sees straight down it.
function closedProfile(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// ---------------------------------------------------------------------------
// Tileable surface canvases -- NEAR-WHITE, multiplied by the material's colour
// ---------------------------------------------------------------------------
//
// The rule The Neighborhood arrived at and this world inherits: SURFACE COURSES ARE TEXTURE,
// never geometry and never a vertex tint. A wall here is an extruded shell with no interior
// vertices, so a per-vertex lap-siding tint has nothing to land on; and as geometry a
// clapboard elevation is a hundred solids apiece. A near-white tile multiplied by the
// material's own colour means ONE lap tile serves the khaki hero, a white neighbour and a
// sage one.
//
// The CANVAS is cached -- it is CPU-side and safe to share -- and the THREE.Texture wrapping
// it is FRESH per call, because disposeObject3D destroys a removed prop's maps outright.

const TILE_CANVAS = new Map();

function tileCanvas(key, px, draw) {
  if (!TILE_CANVAS.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    draw(canvas.getContext('2d'), px);
    TILE_CANVAS.set(key, canvas);
  }
  return TILE_CANVAS.get(key);
}

function grey(ctx, v) {
  const b = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
  ctx.fillStyle = `rgb(${b},${b},${b})`;
}

// Horizontal lap siding at a 4in exposure -- narrower than The Neighborhood's clapboard,
// because this is 1960s aluminium/vinyl lap, which runs tighter and flatter than sawn
// weatherboard. NO vertical joints: the whole read is the shadow line under each butt edge.
function lapCanvas() {
  return tileCanvas('ts-lap', 128, (ctx, px) => {
    const r = rnd(101);
    const rows = 12;                // 12 courses over a 4ft tile = 4in exposure
    const rowPx = px / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rowPx;
      grey(ctx, 0.95 + r() * 0.05);
      ctx.fillRect(0, y, px, rowPx);
      grey(ctx, 0.99);
      ctx.fillRect(0, y + rowPx * 0.18, px, rowPx * 0.3);   // the lit face of the board
      grey(ctx, 0.70);
      ctx.fillRect(0, y + rowPx - 1.4, px, 1.4);            // the shadow under the butt
    }
  });
}

// Three-tab asphalt shingle: courses with staggered tab slots. The slots are what stops a
// roof reading as a painted plane at fifty feet.
function shingleCanvas() {
  return tileCanvas('ts-shingle', 128, (ctx, px) => {
    const r = rnd(113);
    const rows = 8;
    const rowPx = px / rows;
    for (let i = 0; i < rows; i++) {
      const y = i * rowPx;
      grey(ctx, 0.9 + r() * 0.1);
      ctx.fillRect(0, y, px, rowPx);
      // granule speckle, per course so no two courses are the same value
      for (let k = 0; k < 90; k++) { grey(ctx, 0.78 + r() * 0.26); ctx.fillRect(r() * px, y + r() * rowPx, 1.3, 1.3); }
      grey(ctx, 0.62);
      ctx.fillRect(0, y + rowPx - 1.6, px, 1.6);            // the butt shadow
      const off = (i % 2) * (px / 12);
      for (let t = 0; t < 6; t++) { ctx.fillRect(off + (t * px) / 6, y + rowPx * 0.35, 1.5, rowPx * 0.65); }
    }
  });
}

// Standing-seam metal roof: the red one two lots up. Seams every 16in, no courses.
function seamCanvas() {
  return tileCanvas('ts-seam', 128, (ctx, px) => {
    grey(ctx, 0.96); ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < 6; i++) {
      const x = (i * px) / 6;
      grey(ctx, 0.74); ctx.fillRect(x, 0, 2.2, px);
      grey(ctx, 1.0); ctx.fillRect(x + 2.2, 0, 1.6, px);
    }
  });
}

// Sidewalk / driveway concrete: fine aggregate speckle with a broom-finish drag and a
// control joint at the tile edge. The tile is 5ft and the UVs are laid in feet, so joints
// land every five feet by construction -- which is what a drive is actually scored at.
function concreteCanvas() {
  return tileCanvas('ts-concrete', 128, (ctx, px) => {
    const r = rnd(127);
    grey(ctx, 0.95); ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < 1100; i++) { grey(ctx, 0.84 + r() * 0.16); ctx.fillRect(r() * px, r() * px, 1.4, 1.4); }
    // broom finish: faint parallel drag marks across the slab
    for (let i = 0; i < 70; i++) { grey(ctx, 0.9 + r() * 0.08); ctx.fillRect(0, r() * px, px, 0.9); }
    grey(ctx, 0.70); ctx.fillRect(0, 0, px, 2.2); ctx.fillRect(0, 0, 2.2, px);
  });
}

// Asphalt: aggregate plus broad tonal patches, and a few darker crack seals. A residential
// street is never one value -- it is a quilt of old patches -- and that variation is most of
// what makes it read as a road rather than as a grey ribbon.
function asphaltCanvas() {
  return tileCanvas('ts-asphalt', 160, (ctx, px) => {
    const r = rnd(139);
    grey(ctx, 0.92); ctx.fillRect(0, 0, px, px);
    for (let b = 0; b < 9; b++) {
      grey(ctx, 0.83 + r() * 0.14);
      ctx.beginPath(); ctx.ellipse(r() * px, r() * px, px * (0.1 + r() * 0.24), px * (0.08 + r() * 0.2), r() * 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 2200; i++) { grey(ctx, 0.76 + r() * 0.3); ctx.fillRect(r() * px, r() * px, 1.2, 1.2); }
    // crack seals: a wandering dark line, drawn twice so the tile has a network rather than
    // a single stripe. Wrapped in both axes so the seam never draws a straight line.
    ctx.lineCap = 'round';
    for (let s = 0; s < 1; s++) {
      grey(ctx, 0.66); ctx.lineWidth = 1.7;
      ctx.beginPath();
      let x = r() * px; let y = 0;
      ctx.moveTo(x, y);
      for (let k = 0; k < 10; k++) { x += (r() - 0.5) * px * 0.22; y += px / 10; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

// Weathered cedar fence boards: vertical grain, silvered, with the odd darker board. The
// picket-to-picket value change is what stops a privacy fence reading as one brown wall.
function cedarCanvas() {
  return tileCanvas('ts-cedar', 128, (ctx, px) => {
    const r = rnd(151);
    const cols = 6;                       // 6 boards over a 3ft tile = 6in pickets
    const colPx = px / cols;
    for (let i = 0; i < cols; i++) {
      const x = i * colPx;
      grey(ctx, 0.82 + r() * 0.18);
      ctx.fillRect(x, 0, colPx, px);
      for (let k = 0; k < 14; k++) { grey(ctx, 0.74 + r() * 0.22); ctx.fillRect(x + r() * colPx, 0, 0.9, px); }
      grey(ctx, 0.55); ctx.fillRect(x + colPx - 1.5, 0, 1.5, px);   // the gap between boards
    }
  });
}

// Painted concrete block foundation: 8x16 courses, struck joints.
function blockCanvas() {
  return tileCanvas('ts-block', 128, (ctx, px) => {
    const r = rnd(163);
    const rows = 3;                        // 3 courses over a 2ft tile = 8in
    const rowPx = px / rows;
    grey(ctx, 0.94); ctx.fillRect(0, 0, px, px);
    for (let i = 0; i < rows; i++) {
      const y = i * rowPx;
      const off = (i % 2) * (px / 3);
      grey(ctx, 0.74); ctx.fillRect(0, y, px, 1.8);
      for (let k = 0; k < 2; k++) ctx.fillRect(off + (k * px) / 1.5, y, 1.8, rowPx);
      for (let k = 0; k < 160; k++) { grey(ctx, 0.88 + r() * 0.12); ctx.fillRect(r() * px, y + r() * rowPx, 1.5, 1.5); }
    }
  });
}

const SURFACES = {
  lap: { canvas: lapCanvas, tileFt: 4 },
  shingle: { canvas: shingleCanvas, tileFt: 3.4 },
  seam: { canvas: seamCanvas, tileFt: 4 },
  concrete: { canvas: concreteCanvas, tileFt: 5 },
  asphalt: { canvas: asphaltCanvas, tileFt: 10 },
  cedar: { canvas: cedarCanvas, tileFt: 3 },
  block: { canvas: blockCanvas, tileFt: 2 },
};

// A material whose colour is `colour` and whose courses come from a near-white tile. The
// same canvas rides again as the bumpMap -- the accepted "its light and dark ARE its relief"
// pattern; a texture's dispose() is idempotent.
function surfaceMat(kind, colour, { rough = 0.88, bump = 0.5, tile } = {}) {
  const spec = SURFACES[kind];
  const texture = new THREE.CanvasTexture(spec.canvas());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const ft = tile ?? spec.tileFt;
  texture.repeat.set(1 / ft, 1 / ft);
  return standard({ color: colour, map: texture, bumpMap: texture, bumpScale: bump, roughness: rough });
}

// ---------------------------------------------------------------------------
// Ground-plane geometry: a grid of points with a height function
// ---------------------------------------------------------------------------

// A paved surface from a grid of [x, z] rows, lifted by `hAt`, closed by a skirt down to
// `base` and a matching bottom. A CLOSED SOLID rather than a sheet, because a sheet's edge
// is a black hairline wherever the ground is a shade lower than the slab -- and the whole
// point of a kerbed street is that the ground is not level with it.
//
// `uvFeet` lays the texture out in world feet, so one asphalt tile is one asphalt tile
// whether it is under the kerb or out in the middle of the junction.
// A GRID'S WINDING DEPENDS ON THE HANDEDNESS OF ITS (ROW, COLUMN) ORDER, and two patches of
// the SAME road can disagree about it. Turkle Avenue's rows run along +x with columns across
// +z; West 7th's run along +z with columns across +x -- the axes swapped, which reverses the
// face normal. Emitted at a fixed index order, 7th Street's carriageway came out with its top
// faces pointing DOWN: culled by a FrontSide material, so the road was simply not there and
// the lawn ran between two kerbs. The HiFi edition never had it because its `tri()` measures
// each triangle and flips it; this is the same idea, and the same reason.
//
// `out` is the direction the face is meant to look. In three (right-handed, y up) a front
// face is counter-clockwise from outside, so the right-hand-rule normal must agree with it --
// which is the OPPOSITE test from Babylon's, where the same geometry is wound the other way.
function pushTri(idx, pos, a, b, c, out) {
  const ax = pos[a * 3]; const ay = pos[a * 3 + 1]; const az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax; const uy = pos[b * 3 + 1] - ay; const uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax; const vy = pos[c * 3 + 1] - ay; const vz = pos[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz2 = ux * vy - uy * vx;
  if (nx * out[0] + ny * out[1] + nz2 * out[2] < 0) idx.push(a, c, b); else idx.push(a, b, c);
}

function gridSolid(rows, hAt, { base = -1.4, filter = null } = {}) {
  const nz = rows.length; const nx = rows[0].length;
  const pos = []; const uv = []; const idx = [];
  const top = []; const bot = [];
  for (let i = 0; i < nz; i++) {
    top.push([]); bot.push([]);
    for (let j = 0; j < nx; j++) {
      const [x, z] = rows[i][j];
      top[i].push(pos.length / 3); pos.push(x, hAt(x, z), z); uv.push(x, z);
      bot[i].push(pos.length / 3); pos.push(x, base, z); uv.push(x, z);
    }
  }
  const quad = (a, b, c, d, out) => { pushTri(idx, pos, a, b, c, out); pushTri(idx, pos, a, c, d, out); };
  const area = (i, j) => {
    const p = rows[i][j]; const q = rows[i][j + 1]; const r = rows[i + 1][j + 1]; const s = rows[i + 1][j];
    return Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (s[0] - p[0]) * (q[1] - p[1]))
      + Math.abs((r[0] - q[0]) * (s[1] - q[1]) - (s[0] - q[0]) * (r[1] - q[1]));
  };
  const live = [];
  for (let i = 0; i < nz - 1; i++) {
    live.push([]);
    for (let j = 0; j < nx - 1; j++) {
      const cx = (rows[i][j][0] + rows[i + 1][j + 1][0]) / 2;
      const cz = (rows[i][j][1] + rows[i + 1][j + 1][1]) / 2;
      const on = area(i, j) > 1e-5 && (!filter || filter(cx, cz));
      live[i].push(on);
      if (!on) continue;                  // a return's flare pinches to nothing at its tangents
      quad(top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j], UP);
      quad(bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1], DOWN);
    }
  }
  // Skirt round the grid's OUTER edge -- wherever the quad just inside it was emitted. The
  // filtered halves (gutter pan and asphalt) are cut from the same grid and abut along a
  // shared edge, so only the grid's own rim ever needs closing; the seam between them is two
  // meshes meeting at identical vertices, which is a join rather than a hole.
  const outOf = (p, q) => {
    const dx = rows[q[0]][q[1]][0] - rows[p[0]][p[1]][0];
    const dz = rows[q[0]][q[1]][1] - rows[p[0]][p[1]][1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l, 0, -dx / l];
  };
  for (let j = 0; j < nx - 1; j++) {
    if (live[0][j]) quad(top[0][j + 1], top[0][j], bot[0][j], bot[0][j + 1], outOf([0, j + 1], [0, j]));
    if (live[nz - 2][j]) quad(top[nz - 1][j], top[nz - 1][j + 1], bot[nz - 1][j + 1], bot[nz - 1][j], outOf([nz - 1, j], [nz - 1, j + 1]));
  }
  for (let i = 0; i < nz - 1; i++) {
    if (live[i][0]) quad(top[i][0], top[i + 1][0], bot[i + 1][0], bot[i][0], outOf([i, 0], [i + 1, 0]));
    if (live[i][nx - 2]) quad(top[i + 1][nx - 1], top[i][nx - 1], bot[i][nx - 1], bot[i + 1][nx - 1], outOf([i + 1, nx - 1], [i, nx - 1]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// THE STREET
// ---------------------------------------------------------------------------

// Turkle Avenue and West 7th, their kerbs, gutters and driveway aprons, as ONE prop.
//
// One prop because the seams between separately-placed segments are exactly where
// z-fighting and hairline gaps live -- The Neighborhood's lesson, and here the seams are
// harder, since a kerb return is a curve and the gutter has to follow it round. All of the
// plan arithmetic lives in `turkle/plan.js`, which the HiFi native reads as well, so the two
// editions cannot disagree about where the kerb is.
//
// THREE MESHES, split by material rather than by place: asphalt, concrete (the gutter pans,
// the kerbs and the aprons) and nothing else. The split is by QUAD, taken from the same grid
// both halves are cut from, so the pan and the asphalt share their vertices and the boundary
// between them is an edge rather than two edges that nearly coincide.
export function tsStreet({ seed = 1, aprons = [], flow = 0.02, squash = 0.55 } = {}) {
  const g = group();
  const patches = pavementPatches();

  // THE TROUGH IS SHALLOWER HERE THAN IN THE HiFi EDITION, and that is not a style choice.
  //
  // A real kerbed street is a CUT: the gutter flowline sits five inches below the lawn behind
  // the kerb. HiFi can cut -- its terrain takes a rectangular carve (see GroundMask's
  // PROP_CARVES) -- but this app's ground is one flat vertex-coloured plane and there is no
  // way to take a slice out of it. Built at the true section, the whole carriageway is under
  // the ground plane and the ground simply draws over it: a street with an invisible road and
  // a kerb standing beside it on the grass.
  //
  // So here the section is re-datumed to put the flowline a quarter of an inch ABOVE the
  // lawn and then flattened to 55%: the kerb stands four inches proud instead of seven and
  // the crown three instead of five. From a 5ft eye line nobody can tell, and the x/z plan --
  // which is what the two editions have to agree about -- is untouched.
  const y = (h) => flow + (h - PLAN.flow) * squash;
  const height = (x, z) => y(roadHeight(x, z));

  const asphaltGeoms = [];
  const concreteGeoms = [];
  for (const patch of patches) {
    asphaltGeoms.push(gridSolid(patch.rows, height, { base: y(PLAN.curbBase), filter: (x, z) => !isPan(x, z) }));
    concreteGeoms.push(gridSolid(patch.rows, height, { base: y(PLAN.curbBase), filter: (x, z) => isPan(x, z) }));
  }

  // The kerb: one closed profile swept along every run the plan hands back. The runs are
  // already cut where a drive crosses, so nothing has to be subtracted here.
  //
  // The profile is written as (distance INTO the road, height). A slight batter on the face
  // is not decoration: a dead-vertical kerb face never catches the sun, so a whole street of
  // them reads as a painted line rather than as six inches of concrete.
  const CURB_PROFILE = [
    [-PLAN.curbBack, y(PLAN.curbTop)],
    [0, y(PLAN.curbTop)],
    [0.05, y(PLAN.flow + 0.02)],
    [0.05, y(PLAN.curbBase)],
    [-PLAN.curbBack, y(PLAN.curbBase)],
  ];
  for (const run of curbRuns(aprons)) concreteGeoms.push(sweepAlong(run, CURB_PROFILE, squash));

  // Driveway aprons, where the kerb has been cut away.
  for (const a of aprons) {
    concreteGeoms.push(gridSolid(apronRows(a), (x, z) => y(apronHeight(x, z, a)), { base: y(PLAN.curbBase) }));
  }

  const asphalt = mergeGeom(asphaltGeoms);
  const concrete = mergeGeom(concreteGeoms);

  // Broad tonal drift on the asphalt, on top of the tile's own patches: a sixty-year-old
  // chip seal is lighter where it is worn to the aggregate in the wheel tracks and darker in
  // the gutter line where the grit collects.
  tintGeometry(asphalt, (p) => {
    const n = 0.5 + 0.5 * Math.sin(p.x * 0.06 + smoothNoise3(p.x * 0.02, 0, p.z * 0.02) * 4);
    const v = 0.86 + n * 0.2;
    return [v, v, v * 0.99];
  });

  const road = mesh(asphalt, surfaceMat('asphalt', TS.asphalt, { rough: 0.94, bump: 0.35 }));
  road.receiveShadow = true;
  road.castShadow = false;
  const kerb = mesh(concrete, surfaceMat('concrete', TS.concreteOld, { rough: 0.9, bump: 0.45 }));
  kerb.receiveShadow = true;
  kerb.castShadow = false;
  g.add(road, kerb);
  g.userData.turkleStreet = true;
  return g;
}

// Sweeps a closed 2D profile (distance-out, height) along a run of `{ x, z, nx, nz }` frames
// and caps both ends. The frames carry their own normal, which is what lets a kerb follow a
// corner return without the profile shearing: a Frenet frame flips through the inflection
// every return has, and a fixed up vector cannot turn a corner at all.
function sweepAlong(run, profile, squash = 1) {
  const n = profile.length;
  const pos = []; const uv = []; const idx = [];
  let along = 0;
  for (let i = 0; i < run.length; i++) {
    const f = run[i];
    if (i > 0) along += Math.hypot(f.x - run[i - 1].x, f.z - run[i - 1].z);
    const sink = sinkAt(f.x, f.z) * squash;
    for (const [d, y] of profile) {
      pos.push(f.x + f.nx * d, y - sink, f.z + f.nz * d);
      uv.push(along, y);
    }
  }
  for (let i = 0; i < run.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = i * n + k; const b = i * n + k2; const c = (i + 1) * n + k2; const d = (i + 1) * n + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  // End caps: a fan from the profile's first point. Every profile swept here is convex.
  const cap = (base, flip) => {
    for (let k = 1; k < n - 1; k++) {
      if (flip) idx.push(base, base + k, base + k + 1);
      else idx.push(base, base + k + 1, base + k);
    }
  };
  cap(0, true);
  cap((run.length - 1) * n, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mergeGeom(list) {
  const live = list.filter((g) => g && g.attributes.position.count > 0);
  return mergeParts(live.map((geometry) => ({ geometry, color: 0xffffff })));
}

// ---------------------------------------------------------------------------
// Flatwork: driveways and walks
// ---------------------------------------------------------------------------

// A concrete driveway, scored into panels. `length` runs back along -Z from `z = 0`, which
// the layout puts at the BACK OF THE APRON -- the street prop owns everything from there
// forward to the gutter, because only it knows where the kerb is.
//
// THE SCORING IS GEOMETRY HERE, not texture, and it is the one place in this world where
// that is the right answer: a control joint is a real 3/8in groove with a real shadow in it,
// the panels either side of it are visibly not quite the same plane, and a driveway
// photographed at this angle is mostly joints. Weeds come up in them, which the photographs
// show clearly and which is why the joints are a separate darker mesh.
export function tsDriveway({
  seed = 2, length = 52, width = 16, thickness = 0.42, panel = 10.5, crown = 0.05, lot = 0.06,
} = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const half = width / 2;

  // The slab. Each panel is lifted by its own hair so the joints read, and the whole drive
  // crowns very slightly to its middle -- a flat drive ponds, and a flat drive also renders
  // as a mirror-smooth grey rectangle, which is the giveaway.
  const rows = [];
  const zs = []; const joints = [];
  const panels = Math.max(1, Math.round(length / panel));
  for (let i = 0; i <= panels; i++) {
    const z = -(length * i) / panels;
    if (i > 0 && i < panels) { zs.push(z + 0.06, z - 0.06); joints.push(z); } else zs.push(z);
  }
  const xs = [];
  for (let i = 0; i <= 10; i++) xs.push(-half + (width * i) / 10);
  for (const z of zs) rows.push(xs.map((x) => [x, z]));
  const lift = new Map();
  let k = 0;
  for (let i = 0; i <= panels; i++) { lift.set(i, (rng() - 0.5) * 0.035); }
  const panelAt = (z) => Math.min(panels - 1, Math.max(0, Math.floor((-z / length) * panels + 0.5001)));
  const hAt = (x, z) => lot + crown * (1 - (Math.abs(x) / half) ** 2) + (lift.get(panelAt(z)) ?? 0);
  const slab = gridSolid(rows, hAt, { base: lot - thickness });
  const slabMesh = mesh(slab, surfaceMat('concrete', TS.concrete, { rough: 0.92, bump: 0.55 }));
  slabMesh.receiveShadow = true; slabMesh.castShadow = false;
  g.add(slabMesh);

  // The joints themselves: a dark sunken strip per score line, plus the tufts that grow in
  // them. A joint drawn only as a texture line has no shadow and reads as a pencil mark.
  const parts = [];
  for (const z of joints) {
    put(parts, boxG(width, 0.1, 0.22), 0x6d6759, [0, lot + 0.01, z]);
    const tufts = 1 + Math.floor(rng() * 3);
    for (let t = 0; t < tufts; t++) {
      const x = (rng() - 0.5) * width * 0.92;
      put(parts, ball(0.16, 5), mix(TS.leafDeep, TS.leafTan, rng() * 0.6), [x, lot + 0.1, z], null, { scale: [1.6, 0.9, 0.5] });
    }
  }
  // A hairline longitudinal joint down the middle, which is what a sixteen-foot drive gets.
  put(parts, boxG(0.18, 0.09, length), 0x6d6759, [0, lot + 0.012, -length / 2]);
  const detail = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.95 }));
  detail.castShadow = false;
  g.add(detail);
  return g;
}

// A concrete walk: the front walk from the porch to the drive, and the public sidewalk
// across the street. Scored every four feet, with the joints as real grooves.
export function tsWalk({ seed = 3, length = 30, width = 3.6, lot = 0.05, thickness = 0.3, panel = 4 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const half = width / 2;
  const zs = []; const joints = [];
  const panels = Math.max(1, Math.round(length / panel));
  for (let i = 0; i <= panels; i++) {
    const z = -(length * i) / panels;
    if (i > 0 && i < panels) { zs.push(z + 0.05, z - 0.05); joints.push(z); } else zs.push(z);
  }
  const rows = zs.map((z) => [[-half, z], [0, z], [half, z]]);
  const tilt = new Map();
  for (let i = 0; i <= panels; i++) tilt.set(i, (rng() - 0.5) * 0.05);
  const panelAt = (z) => Math.min(panels - 1, Math.max(0, Math.floor((-z / length) * panels + 0.5001)));
  const slab = gridSolid(rows, (x, z) => lot + (tilt.get(panelAt(z)) ?? 0) * (x / half), { base: lot - thickness });
  const m = mesh(slab, surfaceMat('concrete', TS.concreteOld, { rough: 0.92, bump: 0.55 }));
  m.receiveShadow = true; m.castShadow = false;
  g.add(m);
  const parts = [];
  for (const z of joints) put(parts, boxG(width, 0.08, 0.16), 0x6d6759, [0, lot + 0.01, z]);
  if (parts.length) { const d = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.95 })); d.castShadow = false; g.add(d); }
  return g;
}

// ---------------------------------------------------------------------------
// Joinery -- windows and doors, built FORWARD of a solid wall
// ---------------------------------------------------------------------------
//
// There is no CSG here, so an opening cannot be cut: a pane laid ON a solid wall is the
// Machu Picchu niche / Ellis Registry Room rule, and what reads as a recess is the frame's
// own shadow. Pane 0.03 proud, muntin 0.07, casing 0.12, sill furthest of all.

function faceFrame(at, yaw) {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  return (dx, dy, out) => [at[0] + dx * c + out * s, at[1] + dy, at[2] - dx * s + out * c];
}

// A window. `lights` is how many vertical panes (1 = a casement, 2 = a slider, 3 = a picture
// window with two flankers -- all three are on the hero's front elevation).
function windowAt(trim, glow, at, yaw, {
  w = 3, h = 3.6, lights = 2, rails = 1, lit = false, trimCol = TS.trimWhite,
  glassCol = TS.glass, sill = true, screen = false,
} = {}) {
  const p = faceFrame(at, yaw);
  const add = (list, colour, geometry, dx, dy, out) => put(list, geometry, colour, p(dx, dy, out), [0, yaw, 0]);
  add(lit ? glow : trim, lit ? TS.glassLit : glassCol, boxG(w, h, 0.05), 0, 0, 0.03);
  // A screen over the lower half is a real thing on these houses and it is what stops a
  // window reading as a mirror: the screened half is matt and a shade darker.
  if (screen) add(trim, mix(glassCol, 0x000000, 0.2), boxG(w - 0.1, h / 2 - 0.06, 0.04), 0, -h / 4, 0.055);
  for (let i = 1; i < lights; i++) add(trim, trimCol, boxG(0.1, h, 0.05), -w / 2 + (i * w) / lights, 0, 0.07);
  for (let i = 1; i <= rails; i++) add(trim, trimCol, boxG(w, 0.1, 0.05), 0, -h / 2 + (i * h) / (rails + 1), 0.07);
  add(trim, trimCol, boxG(0.22, h + 0.34, 0.12), -w / 2 - 0.1, 0, 0.07);
  add(trim, trimCol, boxG(0.22, h + 0.34, 0.12), w / 2 + 0.1, 0, 0.07);
  add(trim, trimCol, boxG(w + 0.54, 0.24, 0.14), 0, h / 2 + 0.16, 0.08);
  if (sill) add(trim, trimCol, boxG(w + 0.62, 0.16, 0.34), 0, -h / 2 - 0.11, 0.14);
}

// The front door: a panelled slab, a brass knob and lock, and the ALUMINIUM STORM DOOR in
// front of it, which is the thing that actually reads at this distance -- a bright frame
// round a dark rectangle, a mid-rail, and a kick panel.
function doorAt(trim, glow, at, yaw, {
  w = 3.2, h = 6.8, colour = TS.doorBrown, trimCol = TS.trimDark, storm = true, lightOver = false,
} = {}) {
  const p = faceFrame(at, yaw);
  const add = (list, colr, geometry, dx, dy, out) => put(list, geometry, colr, p(dx, dy, out), [0, yaw, 0]);
  add(trim, colour, boxG(w, h, 0.16), 0, h / 2, 0.08);
  add(trim, mix(colour, 0x000000, 0.3), boxG(w * 0.66, h * 0.26, 0.03), 0, h * 0.71, 0.17);
  add(trim, mix(colour, 0x000000, 0.3), boxG(w * 0.66, h * 0.34, 0.03), 0, h * 0.3, 0.17);
  add(trim, TS.brass, new THREE.SphereGeometry(0.09, 10, 8), w * 0.33, h * 0.5, 0.2);
  if (storm) {
    add(trim, TS.galv, boxG(w + 0.1, 0.12, 0.09), 0, h - 0.06, 0.24);
    add(trim, TS.galv, boxG(w + 0.1, 0.12, 0.09), 0, h * 0.46, 0.24);
    add(trim, TS.galv, boxG(w + 0.1, 0.12, 0.09), 0, h * 0.2, 0.24);
    for (const sx of [-1, 1]) add(trim, TS.galv, boxG(0.14, h, 0.09), sx * (w / 2 + 0.02), h / 2, 0.24);
    add(glow, TS.glassSky, boxG(w - 0.16, h * 0.5, 0.03), 0, h * 0.72, 0.22);
    add(trim, TS.galv, boxG(0.1, 0.5, 0.1), w * 0.3, h * 0.5, 0.29);
  }
  add(trim, trimCol, boxG(0.24, h + 0.28, 0.2), -w / 2 - 0.14, (h + 0.28) / 2 - 0.14, 0.1);
  add(trim, trimCol, boxG(0.24, h + 0.28, 0.2), w / 2 + 0.14, (h + 0.28) / 2 - 0.14, 0.1);
  add(trim, trimCol, boxG(w + 0.7, 0.26, 0.22), 0, h + 0.14, 0.11);
  if (lightOver) add(glow, TS.glassLit, boxG(w * 0.7, 0.42, 0.04), 0, h + 0.5, 0.05);
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

// A HIP ROOF -- four slopes, no gable ends. This is the shape of nearly every house on this
// block and it is not the same job as a gable: the two end planes are TRIANGLES whose apexes
// land on the ends of a ridge that is `width - depth` long, and the overhang hangs BELOW the
// eave line rather than level with it. Built level with the wall top, an overhang reads as a
// flat brim and the house looks like it is wearing a hat.
function hipRoof(parts, { width, depth, eaveY, rise, overhang = 1.5, thick = 0.34, colour = 0xffffff }) {
  const pitch = Math.atan2(rise, depth / 2);
  const tan = Math.tan(pitch);
  const ridgeHalf = Math.max(0.2, width / 2 - depth / 2);
  const eaveDrop = eaveY - overhang * tan;
  const put4 = (outline, yaw, eave) => {
    const g = extrudeOutline(outline, thick);
    const m = new THREE.Matrix4().makeRotationY(yaw)
      .multiply(new THREE.Matrix4().makeRotationX(pitch - Math.PI / 2));
    const placedG = xformed(g, m);
    const nx = Math.sin(yaw) * Math.sin(pitch);
    const nz = Math.cos(yaw) * Math.sin(pitch);
    put(parts, placedG, colour, [eave[0] - nx * thick * 0.5, eave[1] - Math.cos(pitch) * thick * 0.5, eave[2] - nz * thick * 0.5]);
  };
  const runZ = depth / 2 + overhang;
  const slopeZ = runZ / Math.cos(pitch);
  const halfW = width / 2 + overhang;
  // front and back trapezoids
  const trap = [[-halfW, 0], [halfW, 0], [ridgeHalf, slopeZ], [-ridgeHalf, slopeZ]];
  put4(trap, 0, [0, eaveDrop, runZ]);
  put4(trap, Math.PI, [0, eaveDrop, -runZ]);
  // the two hip ends
  const tri = [[-runZ, 0], [runZ, 0], [0, slopeZ]];
  put4(tri, Math.PI / 2, [halfW, eaveDrop, 0]);
  put4(tri, -Math.PI / 2, [-halfW, eaveDrop, 0]);
  put(parts, boxG(ridgeHalf * 2 + 0.5, 0.2, 0.62), mix(colour, 0x000000, 0.18), [0, eaveY + rise + thick * 0.62, 0]);
  return { pitch, eaveDrop };
}

// A gable roof: two pitched slabs, a ridge cap, and the triangular infill under it. `axis`
// 'x' runs the ridge across the front (long eave to the street), 'z' turns the gable end to
// the street.
function gableRoof(parts, { width, depth, eaveY, rise, overhang = 1.2, thick = 0.3, axis = 'x', colour = 0xffffff }) {
  const span = (axis === 'x' ? depth : width) / 2;
  const pitch = Math.atan2(rise, span);
  const run = span + overhang;
  const slope = run / Math.cos(pitch);
  const len = (axis === 'x' ? width : depth) + overhang * 2;
  const eaveDrop = eaveY - overhang * Math.tan(pitch);
  const slab = extrudeOutline(cornerRect(len / 2, slope / 2), thick);
  for (const side of [1, -1]) {
    const yawBase = axis === 'x' ? 0 : Math.PI / 2;
    const m = new THREE.Matrix4().makeRotationY(yawBase)
      .multiply(new THREE.Matrix4().makeRotationX(side * pitch + Math.PI / 2));
    const g = xformed(slab, m);
    const midY = (eaveDrop + eaveY + rise) / 2 + (thick / 2) / Math.cos(pitch) - 0.02;
    const off = side * (run / 2);
    put(parts, g, colour, axis === 'x' ? [0, midY, off] : [off, midY, 0]);
  }
  const capLen = len + 0.12;
  put(parts, axis === 'x' ? boxG(capLen, 0.2, 0.62) : boxG(0.62, 0.2, capLen),
    mix(colour, 0x000000, 0.18), [0, eaveY + rise + thick * 0.6, 0]);
  return { pitch, eaveDrop };
}

// The wall shell: an extruded plan stood upright, capped top and bottom, textured in feet.
function wallShell(kind, colour, halfW, halfD, height, { rough = 0.88, bump = 0.5, y = 0, tile } = {}) {
  const g = extrudeOutline(cornerRect(halfW, halfD), height, { capStart: true, capEnd: true });
  g.rotateX(-Math.PI / 2);
  g.translate(0, height / 2 + y, 0);
  return mesh(g, surfaceMat(kind, colour, { rough, bump, tile }));
}

function buildingGroup({ shells = [], roofParts, roofColour, roofKind = 'shingle', trim, glow, extras = [] }) {
  const g = group();
  for (const s of shells) { s.castShadow = true; s.receiveShadow = true; g.add(s); }
  if (roofParts && roofParts.length) {
    const merged = mergeParts(roofParts.map((p) => ({ ...p, keepColor: false, color: 0xffffff })));
    const m = mesh(merged, surfaceMat(roofKind, roofColour, { rough: 0.9, bump: 0.6 }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  if (trim && trim.length) {
    const m = mesh(mergeParts(trim), standard({
      vertexColors: true, roughness: 0.74,
      ...relief('wood', { seed: 9, repeat: 6, strength: 0.3 }),
    }));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  if (glow && glow.length) {
    const m = mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.22, metalness: 0.1,
      emissive: new THREE.Color(0xffc98a), emissiveIntensity: 0.28,
    }));
    m.castShadow = false;
    g.add(m);
  }
  for (const e of extras) g.add(e);
  return g;
}

// ---------------------------------------------------------------------------
// THE HERO: 1400 North Turkle Avenue
// ---------------------------------------------------------------------------

// A mid-century Kansas ranch: forty-six feet of khaki lap siding under a shallow hip roof,
// a cross gable over the west third, and a covered porch across the middle with four dark
// posts. Every dimension is scaled off the photographs against the one thing in them of
// known size -- a 6ft 8in front door.
//
// FIVE THINGS CARRY THE LIKENESS, and they are what the budget goes on. In order:
//
//  1. THE ROOF IS A HIP, NOT A GABLE, and the cross gable over the west third is what breaks
//     it. A plain hip is a bungalow and a plain gable is a farmhouse; it is the pair
//     together, with the gable's ridge standing a foot above the hip's, that makes this the
//     kind of house it is.
//  2. THE PORCH IS SHALLOW AND ITS POSTS ARE DARK. Seven feet deep, four slender posts in
//     the trim colour rather than white columns -- against the khaki wall the posts read as
//     four dark verticals, which is most of the front elevation's rhythm.
//  3. THE PICTURE WINDOW. Three lights, eight and a half feet of it, right of the porch and
//     nearly square. It is the only large opening on the house and it is what stops the
//     right-hand third reading as a blank wall.
//  4. THE STORM DOOR. At any distance the door itself is invisible -- what you see is a
//     bright aluminium frame round a dark rectangle. Modelling the panelled door alone and
//     leaving the storm off is the single easiest way to make an American house look
//     European.
//  5. THE FLAG, on its angled bracket between the gable window and the porch. One saturated
//     object on an otherwise quiet elevation, and it is in every photograph.
//
// The porch roof is a SEPARATE SHED at a shallower pitch whose fascia sits at exactly the
// main roof's fascia height. That is what makes the eave line read as one continuous
// straight edge across the whole front, which is what the photographs show, without the main
// hip having to grow a stepped eave over the porch section.
export function tsRanchHouse({
  seed = 11, width = 46, depth = 28, eave = 10.2, rise = 4.4,
  siding = TS.siding, roofColour = TS.shingle, trimCol = TS.trimDark, sashCol = TS.trimWhite,
  doorCol = TS.doorBrown, gableWidth = 14, gableRise = 5.6,
  porchFrom = -9.5, porchTo = 12.5, porchDepth = 7,
  flag = true, cellar = true, lit = 0,
} = {}) {
  const rng = seededRandom(seed);
  const halfW = width / 2; const halfD = depth / 2;
  const FLOOR = 1.35;
  const BLOCK = 1.5;
  const trim = []; const glow = []; const roofParts = [];
  const shells = [];

  // --- shell: painted block foundation, then lap siding -----------------------
  shells.push(wallShell('block', TS.foundation, halfW + 0.18, halfD + 0.18, BLOCK, { rough: 0.93, bump: 0.6 }));
  shells.push(wallShell('lap', siding, halfW, halfD, eave - BLOCK, { y: BLOCK, rough: 0.82, bump: 0.55 }));

  // --- roof: a hip over the whole body, a cross gable over the west third ------
  hipRoof(roofParts, { width, depth, eaveY: eave, rise, overhang: 1.5, colour: roofColour });
  const gx = -halfW + gableWidth / 2;
  const gableParts = [];
  gableRoof(gableParts, { width: gableWidth, depth, eaveY: eave, rise: gableRise, overhang: 1.2, axis: 'z', colour: roofColour });
  for (const p of gableParts) { p.position = [(p.position?.[0] ?? 0) + gx, p.position?.[1] ?? 0, p.position?.[2] ?? 0]; roofParts.push(p); }
  // The gable's two triangular infills, in the wall's own siding -- a separate shell mesh so
  // the lap courses carry on up the peak instead of stopping dead at the eave.
  const gableTri = extrudeOutline([[-gableWidth / 2, 0], [gableWidth / 2, 0], [0.004, gableRise], [-0.004, gableRise]], 0.5);
  const gableSkin = group();
  for (const sz of [1, -1]) {
    const g = xformed(gableTri, new THREE.Matrix4().makeTranslation(gx, eave, sz * (halfD - 0.25)));
    const m = mesh(g, surfaceMat('lap', siding, { rough: 0.82, bump: 0.55 }));
    m.castShadow = true; m.receiveShadow = true;
    gableSkin.add(m);
  }
  // A gable vent, which every one of these has and which is the only thing on that triangle.
  for (const sz of [1, -1]) put(trim, boxG(1.6, 1.1, 0.14), mix(trimCol, 0xffffff, 0.15), [gx, eave + gableRise * 0.5, sz * (halfD + 0.06)]);

  // --- front elevation --------------------------------------------------------
  const front = (dx, y) => [dx, y, halfD];
  windowAt(trim, glow, front(-16.5, FLOOR + 4.6), 0, { w: 3.0, h: 3.6, lights: 2, trimCol: sashCol, screen: true, lit: lit > 0.5 });
  windowAt(trim, glow, front(17.5, FLOOR + 4.7), 0, { w: 8.6, h: 4.2, lights: 3, rails: 0, trimCol: sashCol, lit: lit > 0.2 });
  doorAt(trim, glow, front(-4.0, FLOOR), 0, { w: 3.2, h: 6.7, colour: doorCol, trimCol: sashCol });
  windowAt(trim, glow, front(4.6, FLOOR + 4.3), 0, { w: 4.4, h: 3.2, lights: 2, rails: 0, trimCol: sashCol, screen: true });

  // --- the porch --------------------------------------------------------------
  const pw = porchTo - porchFrom;
  const pcx = (porchFrom + porchTo) / 2;
  const DECK = 1.05;
  const pz = halfD + porchDepth;
  put(trim, boxG(pw + 0.6, DECK, porchDepth + 0.3), TS.concreteOld, [pcx, DECK / 2, halfD + porchDepth / 2 + 0.15]);
  put(trim, boxG(pw + 0.9, 0.16, porchDepth + 0.5), TS.concrete, [pcx, DECK + 0.08, halfD + porchDepth / 2 + 0.15]);
  // two steps, in front of the door only
  for (let i = 0; i < 2; i++) {
    put(trim, boxG(5.2, 0.36, 1.05 - i * 0.05), TS.concreteOld, [-4.0, 0.18 + i * 0.36, pz + 0.5 - i * 0.55]);
  }
  const POST_TOP = eave - 1.05;
  const posts = [porchFrom + 0.5, porchFrom + pw * 0.34, porchFrom + pw * 0.67, porchTo - 0.5];
  for (const x of posts) {
    put(trim, boxG(0.52, POST_TOP - DECK, 0.52), trimCol, [x, DECK + (POST_TOP - DECK) / 2, pz - 0.5]);
    put(trim, boxG(0.72, 0.14, 0.72), trimCol, [x, POST_TOP - 0.07, pz - 0.5]);
    put(trim, boxG(0.7, 0.12, 0.7), mix(trimCol, 0x000000, 0.2), [x, DECK + 0.06, pz - 0.5]);
  }
  put(trim, boxG(pw + 1.1, 0.62, 0.5), trimCol, [pcx, POST_TOP + 0.31, pz - 0.5]);
  // The shed roof over it. Its low edge fascia sits at the MAIN roof's fascia height, which
  // is what makes the eave line read as one straight edge all the way across the front.
  const mainPitch = Math.atan2(rise, halfD);
  const fascia = eave - 1.5 * Math.tan(mainPitch);
  const porchHigh = eave + 0.45;
  const porchSlope = Math.hypot(porchDepth + 1.1, porchHigh - fascia);
  const porchTilt = Math.atan2(porchHigh - fascia, porchDepth + 1.1);
  const slab = extrudeOutline(cornerRect(pw / 2 + 0.9, porchSlope / 2), 0.3);
  put(roofParts, xformed(slab, new THREE.Matrix4().makeRotationX(Math.PI / 2 + porchTilt)),
    roofColour, [pcx, (fascia + porchHigh) / 2 + 0.16, halfD + (porchDepth + 1.1) / 2 - 0.55]);
  put(trim, boxG(pw + 1.9, 0.5, 0.22), trimCol, [pcx, fascia - 0.14, pz + 0.55]);
  // porch ceiling, so the underside is a painted soffit and not the back of a shingle
  put(trim, boxG(pw + 0.7, 0.1, porchDepth + 0.7), mix(sashCol, 0x000000, 0.06), [pcx, fascia - 0.02, halfD + porchDepth / 2]);
  // a wall lamp beside the door
  put(trim, boxG(0.4, 0.2, 0.3), trimCol, [-6.1, FLOOR + 5.4, halfD + 0.16]);
  put(glow, lathed(closedProfile([[0.06, 0], [0.3, 0.2], [0.24, 0.62], [0.1, 0.72]]), { segments: 10 }), 0xfff0cc, [-6.1, FLOOR + 5.2, halfD + 0.34]);

  // --- fascia, gutters and downspouts ----------------------------------------
  // A K-style gutter along both long eaves, and two downspouts. Not decoration: the fascia
  // and gutter are one continuous dark band under the whole roof and they are what separate
  // the roof from the wall at any distance.
  for (const sz of [1, -1]) {
    put(trim, boxG(width + 3.2, 0.42, 0.18), trimCol, [0, fascia - 0.2, sz * (halfD + 1.48)]);
    put(trim, boxG(width + 3.2, 0.34, 0.34), mix(trimCol, 0xffffff, 0.1), [0, fascia - 0.5, sz * (halfD + 1.36)]);
  }
  for (const [sx, sz] of [[-1, 1], [1, -1]]) {
    const x = sx * (halfW - 0.5); const z = sz * (halfD + 0.22);
    put(trim, boxG(0.3, fascia - 0.6, 0.24), mix(trimCol, 0xffffff, 0.1), [x, (fascia - 0.6) / 2, z]);
    put(trim, boxG(0.34, 0.3, 0.9), mix(trimCol, 0xffffff, 0.1), [x, 0.15, z + sz * 0.4]);
  }

  // --- other elevations -------------------------------------------------------
  windowAt(trim, glow, [halfW, FLOOR + 4.6, 4], Math.PI / 2, { w: 2.6, h: 3.4, trimCol: sashCol, screen: true });
  windowAt(trim, glow, [halfW, FLOOR + 4.6, -5.5], Math.PI / 2, { w: 2.6, h: 3.4, trimCol: sashCol, screen: true });
  windowAt(trim, glow, [-halfW, FLOOR + 4.6, -4], -Math.PI / 2, { w: 2.6, h: 3.4, trimCol: sashCol, screen: true });
  windowAt(trim, glow, [-halfW, FLOOR + 4.6, -10], -Math.PI / 2, { w: 2.2, h: 2.4, trimCol: sashCol });
  windowAt(trim, glow, [-8, FLOOR + 4.6, -halfD], Math.PI, { w: 3.2, h: 3.4, trimCol: sashCol, screen: true });
  windowAt(trim, glow, [4, FLOOR + 4.6, -halfD], Math.PI, { w: 3.2, h: 3.4, trimCol: sashCol, screen: true });
  doorAt(trim, glow, [13, FLOOR, -halfD], Math.PI, { w: 3.0, h: 6.7, colour: doorCol, trimCol: sashCol, storm: true });
  put(trim, boxG(4.6, 0.5, 3.4), TS.concreteOld, [13, 0.25, -halfD - 1.7]);

  // --- the chimney ------------------------------------------------------------
  put(trim, boxG(2.0, eave + rise + 1.4, 1.6), TS.foundation, [8, (eave + rise + 1.4) / 2, -3]);
  put(trim, boxG(2.34, 0.4, 1.94), mix(TS.foundation, 0x000000, 0.18), [8, eave + rise + 1.6, -3]);
  put(trim, boxG(0.7, 0.5, 0.5), TS.galvDark, [8, eave + rise + 2.0, -3]);

  // --- the flag ---------------------------------------------------------------
  // A 3x5 on a staff raked out of a wall bracket at about forty degrees, hanging with a fold
  // in it. A flat plate stuck on the wall reads as a poster; the rake and the droop are the
  // whole thing.
  if (flag) {
    const bx = -10.5; const by = FLOOR + 6.3;
    put(trim, boxG(0.34, 0.34, 0.2), trimCol, [bx, by, halfD + 0.1]);
    const staffLen = 5.6; const rake = 0.72;
    const dir = [0, Math.sin(rake), Math.cos(rake)];
    // A plain cylinder on a baked rotation, not a swept tube: `tube` splines its radii and
    // transports a frame, and a two-point path gives it nothing to transport -- the whole
    // merged trim mesh came back NaN and vanished.
    put(trim, new THREE.CylinderGeometry(0.075, 0.09, staffLen, 8),
      mix(TS.brass, 0xffffff, 0.35),
      [bx, by + (dir[1] * staffLen) / 2, halfD + 0.2 + (dir[2] * staffLen) / 2],
      [Math.PI / 2 - rake, 0, 0]);
    put(trim, ball(0.13, 6), mix(TS.brass, 0xffffff, 0.5),
      [bx, by + dir[1] * staffLen, halfD + 0.2 + dir[2] * staffLen]);
    const cloth = [];
    const FW = 3.0; const FH = 1.9;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const along = 1.0 + t * FW;
      const px = bx; const py = by + dir[1] * along - t * t * 0.55; const pz = halfD + 0.2 + dir[2] * along;
      cloth.push([px, py, pz, t]);
    }
    for (let i = 0; i < 10; i++) {
      const [ax, ay, az, t0] = cloth[i]; const [bx2, by2, bz2, t1] = cloth[i + 1];
      const wave = (t) => Math.sin(t * 5.2) * 0.12;
      for (let k = 0; k < 4; k++) {
        const y0 = -FH / 2 + (FH * k) / 4; const y1 = -FH / 2 + (FH * (k + 1)) / 4;
        const colour = t0 < 0.42 && k >= 2 ? TS.flagBlue : (k + Math.floor(t0 * 7)) % 2 ? TS.flagWhite : TS.flagRed;
        const cx = (ax + bx2) / 2 + wave(t0) + (y0 + y1) * 0.04;
        put(trim, boxG(0.07, Math.abs(y1 - y0) + 0.01, Math.hypot(bx2 - ax, by2 - ay, bz2 - az) + 0.02),
          colour, [cx, (ay + by2) / 2 + (y0 + y1) / 2 + FH / 2 - 0.1, (az + bz2) / 2], [rake - 0.32, Math.PI / 2, 0]);
      }
    }
  }

  // --- the cellar bulkhead, against the FRONT wall ----------------------------
  // A white-painted steel basement door leaning against the foundation at the west end of
  // the FRONT elevation -- which is where the photographs put it, and it took three passes
  // to read them right. Against the west wall it is behind the side-yard fence and can never
  // be seen from the street; on the front wall it is the low white wedge that appears at the
  // left of every one of these pictures, and it is the most particular thing on this house
  // after the flag. Nobody models one; everybody in this part of the country has one.
  const extras = [gableSkin];
  if (cellar) {
    const cx = -halfW + 3.6;
    const cz = halfD + 1.55;
    // the two low side walls of the areaway, and the sill it lies on
    for (const sx of [-1, 1]) put(trim, boxG(0.42, 1.55, 3.3), TS.foundation, [cx + sx * 2.1, 0.78, cz]);
    put(trim, boxG(4.6, 0.36, 0.4), TS.foundation, [cx, 0.18, cz + 1.65]);
    // the leaves: two steel doors meeting at a low ridge, leaning back to the wall. A single
    // flat plate here reads as a slab of polystyrene; it is the RIDGE and the two slopes
    // that say "this opens".
    for (const sx of [-1, 1]) {
      put(trim, boxG(2.3, 0.13, 3.5), TS.trimWhite, [cx + sx * 1.05, 1.34 - 0.42, cz], [0.42, 0, 0]);
    }
    put(trim, boxG(0.26, 0.16, 3.6), mix(TS.trimWhite, 0x000000, 0.22), [cx, 1.63, cz - 0.02]);
    put(trim, boxG(4.5, 0.12, 0.3), mix(TS.trimWhite, 0x000000, 0.3), [cx, 0.62, cz + 1.62]);
    put(trim, boxG(0.5, 0.1, 0.2), TS.galvDark, [cx + 1.4, 0.72, cz + 1.6]);
  }

  const g = buildingGroup({ shells, roofParts, roofColour, trim, glow, extras });
  g.userData.turkleHouse = true;
  return g;
}

// ---------------------------------------------------------------------------
// The detached garage
// ---------------------------------------------------------------------------

// Twenty-six by twenty-four, gable end to the drive, one sixteen-foot overhead door. The
// door is the whole object: four rows of stamped panels in near-white, a dark reveal round
// it, and nothing else on that elevation at all.
export function tsGarage({
  seed = 12, width = 26, depth = 24, eave = 9.2, rise = 4.6,
  siding = TS.siding, roofColour = TS.shingle, trimCol = TS.trimDark, doorColour = TS.garageDoor,
  doorWidth = 16, doorHeight = 7.2,
} = {}) {
  const halfW = width / 2; const halfD = depth / 2;
  const trim = []; const glow = []; const roofParts = [];
  const shells = [wallShell('lap', siding, halfW, halfD, eave, { rough: 0.82, bump: 0.55 })];
  put(trim, boxG(width + 0.4, 0.55, depth + 0.4), TS.foundation, [0, 0.27, 0]);

  gableRoof(roofParts, { width, depth, eaveY: eave, rise, overhang: 1.1, axis: 'z', colour: roofColour });
  const tri = extrudeOutline([[-halfW, 0], [halfW, 0], [0.004, rise], [-0.004, rise]], 0.5);
  const skin = group();
  for (const sz of [1, -1]) {
    const m = mesh(xformed(tri, new THREE.Matrix4().makeTranslation(0, eave, sz * (halfD - 0.25))),
      surfaceMat('lap', siding, { rough: 0.82, bump: 0.55 }));
    m.castShadow = true; m.receiveShadow = true;
    skin.add(m);
  }
  for (const sz of [1, -1]) {
    put(trim, boxG(width + 2.4, 0.4, 0.2), trimCol, [0, eave - 0.2, sz * (halfD + 1.02)]);
    put(trim, boxG(0.26, rise + 0.4, 0.3), trimCol, [0, eave + rise / 2, sz * (halfD + 0.4)], [0, 0, 0]);
  }

  // the overhead door: a dark reveal, four rows of stamped panels, a row of lights in the
  // top course, and the track brackets either side
  const dz = halfD + 0.02;
  put(trim, boxG(doorWidth + 0.5, doorHeight + 0.3, 0.2), mix(trimCol, 0x000000, 0.4), [0, doorHeight / 2, dz]);
  for (let r = 0; r < 4; r++) {
    const y = (doorHeight * (r + 0.5)) / 4;
    for (let c = 0; c < 4; c++) {
      const x = -doorWidth / 2 + (doorWidth * (c + 0.5)) / 4;
      put(trim, boxG(doorWidth / 4 - 0.16, doorHeight / 4 - 0.16, 0.12), doorColour, [x, y, dz + 0.16]);
    }
    put(trim, boxG(doorWidth, 0.1, 0.16), mix(doorColour, 0x000000, 0.28), [0, y + doorHeight / 8, dz + 0.14]);
  }
  put(trim, boxG(doorWidth, doorHeight, 0.1), mix(doorColour, 0x000000, 0.12), [0, doorHeight / 2, dz + 0.1]);
  put(trim, boxG(doorWidth + 0.9, 0.3, 0.34), TS.trimWhite, [0, doorHeight + 0.2, dz + 0.1]);
  for (const sx of [-1, 1]) put(trim, boxG(0.34, doorHeight + 0.4, 0.34), TS.trimWhite, [sx * (doorWidth / 2 + 0.34), (doorHeight + 0.4) / 2, dz + 0.1]);
  put(trim, boxG(1.9, 0.5, 0.26), trimCol, [0, doorHeight + 0.9, dz + 0.12]);

  // service door and one window on the drive side
  doorAt(trim, glow, [halfW, 0, -6], Math.PI / 2, { w: 2.9, h: 6.6, colour: siding, trimCol, storm: false });
  windowAt(trim, glow, [halfW, 5.2, 2], Math.PI / 2, { w: 2.4, h: 2.6, lights: 2, trimCol: TS.trimWhite });
  windowAt(trim, glow, [-halfW, 5.2, 0], -Math.PI / 2, { w: 2.4, h: 2.6, lights: 2, trimCol: TS.trimWhite });

  const g = buildingGroup({ shells, roofParts, roofColour, trim, glow, extras: [skin] });
  return g;
}

// ---------------------------------------------------------------------------
// The neighbours
// ---------------------------------------------------------------------------

// One builder for every other house on the block, because they are all the same house: a
// single-storey ranch, thirty to forty-four feet of lap siding, a hip or a low gable, a
// stoop, and an attached garage on about half of them. What varies is colour, which is the
// only thing that distinguishes them from each other in the photographs -- white, sage, a
// blue-grey, a cream one with a red metal roof.
export function tsNeighborHouse({
  seed = 21, width = 38, depth = 26, eave = 9.6, rise = 4.7,
  siding = TS.sidingWhite, roofColour = TS.roofGrey, roofKind = 'shingle',
  trimCol = TS.trimWhite, doorCol = TS.doorBrown, roof = 'hip',
  garage = false, garageWidth = 13, stoop = true, chimney = true, lit = 0,
} = {}) {
  const rng = seededRandom(seed);
  const trim = []; const glow = []; const roofParts = [];
  const shells = [];
  const FLOOR = 1.2;
  const halfD = depth / 2;
  const bodyW = garage ? width - garageWidth : width;
  const halfB = bodyW / 2;
  const bx = garage ? -garageWidth / 2 : 0;

  shells.push(wallShell('block', TS.foundation, halfB + 0.16, halfD + 0.16, 1.3, { rough: 0.93, bump: 0.6, y: 0 }));
  shells.push(wallShell('lap', siding, halfB, halfD, eave - 1.3, { y: 1.3, rough: 0.82, bump: 0.55 }));
  const body = { width: bodyW, depth, eaveY: eave, rise, colour: roofColour };
  if (roof === 'hip') hipRoof(roofParts, { ...body, overhang: 1.4 });
  else {
    gableRoof(roofParts, { ...body, overhang: 1.1, axis: 'x' });
    const tri = extrudeOutline([[-halfD, 0], [halfD, 0], [0.004, rise], [-0.004, rise]], 0.45);
    for (const sx of [1, -1]) {
      put(trim, xformed(tri, new THREE.Matrix4().makeRotationY(Math.PI / 2)), siding, [sx * (halfB - 0.22), eave, 0]);
    }
  }
  for (const p of roofParts) p.position = [(p.position?.[0] ?? 0) + bx, p.position?.[1] ?? 0, p.position?.[2] ?? 0];
  for (const s of shells) s.position.x = bx;

  // front elevation: a door with a stoop, and two or three windows
  const fz = halfD;
  doorAt(trim, glow, [bx + halfB * 0.45, FLOOR, fz], 0, { w: 3.0, h: 6.6, colour: doorCol, trimCol, storm: true });
  if (stoop) {
    put(trim, boxG(5.0, FLOOR, 4.0), TS.concreteOld, [bx + halfB * 0.45, FLOOR / 2, fz + 2.0]);
    put(trim, boxG(5.4, 0.14, 4.4), TS.concrete, [bx + halfB * 0.45, FLOOR + 0.07, fz + 2.0]);
  }
  windowAt(trim, glow, [bx - halfB * 0.45, FLOOR + 4.4, fz], 0, { w: 6.4, h: 3.8, lights: 3, rails: 0, trimCol, lit: lit > 0.3 });
  windowAt(trim, glow, [bx + halfB * 0.02, FLOOR + 4.4, fz], 0, { w: 2.8, h: 3.4, trimCol, screen: true });
  for (const sx of [-1, 1]) windowAt(trim, glow, [bx + sx * halfB, FLOOR + 4.4, -3], sx * Math.PI / 2, { w: 2.6, h: 3.2, trimCol, screen: true });
  for (const z of [-6, 5]) windowAt(trim, glow, [bx - halfB * 0.4, FLOOR + 4.4, -halfD], Math.PI, { w: 2.8, h: 3.2, trimCol, screen: true });
  if (chimney) {
    put(trim, boxG(1.8, eave + rise + 1.2, 1.4), TS.foundation, [bx - halfB * 0.6, (eave + rise + 1.2) / 2, -2]);
    put(trim, boxG(2.1, 0.36, 1.7), mix(TS.foundation, 0x000000, 0.18), [bx - halfB * 0.6, eave + rise + 1.4, -2]);
  }

  // the attached garage: a lower wing with its own roof and a two-car door
  if (garage) {
    const gcx = bodyW / 2 - width / 2 + bodyW / 2 + garageWidth / 2 - bodyW / 2;
    const gx = halfB + bx + garageWidth / 2;
    const gEave = eave - 1.1;
    const gDepth = depth - 3;
    shells.push(wallShell('lap', siding, garageWidth / 2, gDepth / 2, gEave, { rough: 0.82, bump: 0.55 }));
    shells[shells.length - 1].position.set(gx, 0, halfD - gDepth / 2);
    const gp = [];
    if (roof === 'hip') hipRoof(gp, { width: garageWidth, depth: gDepth, eaveY: gEave, rise: rise * 0.7, overhang: 1.2, colour: roofColour });
    else gableRoof(gp, { width: garageWidth, depth: gDepth, eaveY: gEave, rise: rise * 0.7, overhang: 1.0, axis: 'x', colour: roofColour });
    for (const p of gp) { p.position = [(p.position?.[0] ?? 0) + gx, p.position?.[1] ?? 0, (p.position?.[2] ?? 0) + halfD - gDepth / 2]; roofParts.push(p); }
    const dz = halfD + 0.02; const dw = garageWidth - 2.4; const dh = 6.9;
    put(trim, boxG(dw + 0.4, dh + 0.24, 0.18), mix(trimCol, 0x000000, 0.45), [gx, dh / 2, dz]);
    for (let r = 0; r < 4; r++) {
      const y = (dh * (r + 0.5)) / 4;
      for (let c = 0; c < 3; c++) put(trim, boxG(dw / 3 - 0.14, dh / 4 - 0.14, 0.12), TS.garageDoor, [gx - dw / 2 + (dw * (c + 0.5)) / 3, y, dz + 0.15]);
    }
    put(trim, boxG(dw, dh, 0.09), mix(TS.garageDoor, 0x000000, 0.1), [gx, dh / 2, dz + 0.09]);
    put(trim, boxG(dw + 0.8, 0.28, 0.3), trimCol, [gx, dh + 0.18, dz + 0.1]);
  }

  // fascia, all round
  const halfSpanX = (garage ? width : bodyW) / 2;
  for (const sz of [1, -1]) put(trim, boxG((garage ? width : bodyW) + 2.6, 0.36, 0.18), trimCol, [bx + (garage ? garageWidth / 2 : 0), eave - rise * 0.32 - 0.2, sz * (halfD + 1.36)]);

  return buildingGroup({ shells, roofParts, roofColour, roofKind, trim, glow });
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

// A six-foot dog-eared cedar privacy fence, run along its own X. Twenty years of Kansas sun
// has silvered it, and THE BOARD-TO-BOARD VALUE CHANGE IS THE WHOLE READ: a privacy fence
// painted one flat brown is a wall, and what makes it a fence is that no two boards weather
// at the same rate. Each picket is an extruded DOG-EARED outline, because the cut corners
// are the only thing the eye has to count boards by at thirty feet.
export function tsPrivacyFence({
  seed = 31, length = 24, height = 6, picket = 0.48, gap = 0.04, colour = TS.cedar, gate = false,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const pitch = picket + gap;
  const n = Math.max(1, Math.floor(length / pitch));
  const x0 = -(n * pitch - gap) / 2;
  const ear = picket * 0.5;
  const outline = [
    [-picket / 2, 0], [picket / 2, 0], [picket / 2, height - ear],
    [picket / 2 - ear, height], [-picket / 2 + ear, height], [-picket / 2, height - ear],
  ];
  const board = extrudeOutline(outline, 0.07);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * pitch + picket / 2;
    const v = 0.82 + rng() * 0.36;
    const lean = (rng() - 0.5) * 0.012;
    const drop = rng() < 0.08 ? rng() * 0.22 : 0;    // the odd board slipped a little
    put(parts, board, mix(colour, rng() < 0.25 ? TS.cedarDark : TS.cedarGrey, rng() * 0.8),
      [x, -drop, 0], [0, 0, lean], { tint: (p, c) => [c.r * v, c.g * v * 0.99, c.b * v * 0.96] });
  }
  // rails behind, and posts every eight feet
  for (const y of [height * 0.22, height * 0.78]) {
    put(parts, boxG(n * pitch, 0.34, 0.13), TS.cedarGrey, [0, y, -0.1]);
  }
  const postEvery = 8;
  const posts = Math.max(2, Math.round((n * pitch) / postEvery) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -(n * pitch) / 2 + ((n * pitch) * i) / (posts - 1);
    put(parts, boxG(0.36, height + 0.5, 0.36), TS.cedarDark, [x, (height + 0.5) / 2 - 0.25, -0.2]);
    put(parts, lathed(closedProfile([[0.24, 0], [0.26, 0.06], [0.16, 0.2], [0, 0.3]]), { segments: 4 }),
      TS.cedarDark, [x, height + 0.25, -0.2], [0, Math.PI / 4, 0]);
  }
  if (gate) {
    // a gate reads as a gate because of the GAP round it and the diagonal brace, not because
    // it is a different colour
    put(parts, boxG(0.16, height - 0.3, 0.1), TS.cedarDark, [0, (height - 0.3) / 2, 0.06]);
    put(parts, boxG(3.6, 0.28, 0.1), TS.cedarDark, [1.9, height * 0.8, 0.06]);
    put(parts, boxG(4.2, 0.24, 0.1), TS.cedarDark, [1.9, height * 0.45, 0.06], [0, 0, -0.5]);
    put(parts, boxG(0.3, 0.12, 0.26), TS.galvDark, [3.6, height * 0.55, 0.12]);
  }
  const g = group();
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.92,
    ...relief('wood', { seed, repeat: 8, strength: 0.6 }),
  }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// Galvanised chain link, four feet, with a top rail. THE FABRIC IS AN ALPHA-TESTED PLANE and
// has to be: a diamond mesh is ten thousand wires, and at any honest wire gauge it is
// sub-pixel from six feet away. What must be geometry is the FRAME -- terminal posts, line
// posts, the top rail and the tension bands -- because that is the part that catches the sun
// and tells you the fence is there at all.
function chainCanvas() {
  return tileCanvas('ts-chainlink', 128, (ctx, px) => {
    ctx.clearRect(0, 0, px, px);
    ctx.strokeStyle = 'rgba(232,236,240,1)';
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'square';
    const cell = px / 4;
    for (let i = -4; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell + px, px); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * cell, px); ctx.lineTo(i * cell + px, 0); ctx.stroke();
    }
  });
}

export function tsChainFence({
  seed = 32, length = 30, height = 4, colour = TS.galv, gate = false,
} = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const parts = [];
  const postEvery = 10;
  const bays = Math.max(1, Math.round(length / postEvery));
  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + (length * i) / bays;
    const terminal = i === 0 || i === bays;
    const r = terminal ? 0.13 : 0.1;
    put(parts, new THREE.CylinderGeometry(r, r, height + 0.3, 10), terminal ? TS.galvDark : colour, [x, (height + 0.3) / 2 - 0.15, 0]);
    put(parts, lathed(closedProfile([[r + 0.02, 0], [r + 0.02, 0.06], [r * 0.6, 0.14]]), { segments: 10 }), TS.galvDark, [x, height + 0.15, 0]);
    if (terminal) for (const y of [height * 0.28, height * 0.72]) put(parts, new THREE.TorusGeometry(r + 0.03, 0.03, 6, 12), TS.galvDark, [x, y, 0], [0, Math.PI / 2, 0]);
  }
  put(parts, new THREE.CylinderGeometry(0.085, 0.085, length, 10), colour, [0, height - 0.12, 0], [0, 0, Math.PI / 2]);
  // the bottom tension wire, which is what stops the fabric reading as a hanging curtain
  put(parts, new THREE.CylinderGeometry(0.025, 0.025, length, 6), TS.galvDark, [0, 0.22, 0], [0, 0, Math.PI / 2]);
  const frame = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.42, metalness: 0.65 }));
  frame.castShadow = true;
  g.add(frame);

  const tex = new THREE.CanvasTexture(chainCanvas());
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(length / 2, height / 2);
  const fabric = mesh(new THREE.PlaneGeometry(length, height - 0.25), standard({
    map: tex, color: 0xd6dade, transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, roughness: 0.4, metalness: 0.5, depthWrite: true,
  }));
  fabric.position.set(0, (height - 0.25) / 2 + 0.1, 0.02);
  fabric.castShadow = false;
  g.add(fabric);
  return g;
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

// A creosoted wood distribution pole. The wires are the point: three photographs of this
// block are framed by them, and a pole with no span on it reads as a dead tree.
//
// Spans are given in the pole's OWN frame (`dx`, `dz`, `dy`, `sag`), so the layout can put a
// pole down at rotY 0 and say where its wires go without doing any trigonometry. Each span
// is a real CATENARY, not a straight line -- the sag is most of what a power line looks
// like, and two wires sagging by different amounts is most of what a pair of them looks
// like.
export function tsUtilityPole({
  seed = 41, height = 32, crossarm = true, transformer = true, spans = [], drops = [],
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const wires = [];
  put(parts, new THREE.CylinderGeometry(0.42, 0.62, height, 12), TS.pole, [0, height / 2, 0]);
  put(parts, lathed(closedProfile([[0.42, 0], [0.4, 0.1], [0.18, 0.34]]), { segments: 12 }), TS.poleDark, [0, height, 0]);
  // the weathering band: a pole is dark and tarry at the bottom and silvered at the top
  const armY = height - 2.0;
  if (crossarm) {
    put(parts, boxG(8.0, 0.42, 0.34), TS.poleDark, [0, armY, 0]);
    put(parts, boxG(0.3, 1.6, 0.26), TS.poleDark, [0, armY - 0.9, 0.3], [0.6, 0, 0]);
    for (const x of [-3.2, 0, 3.2]) {
      put(parts, new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8), TS.galvDark, [x, armY + 0.6, 0]);
      put(parts, lathed(closedProfile([[0.3, 0], [0.34, 0.1], [0.2, 0.18], [0.3, 0.26], [0.16, 0.42]]), { segments: 12 }),
        0x4a5b52, [x, armY + 0.9, 0]);
    }
  }
  if (transformer) {
    put(parts, new THREE.CylinderGeometry(1.0, 1.0, 3.2, 16), TS.galvDark, [0, height - 8.5, 1.5]);
    put(parts, lathed(closedProfile([[1.0, 0], [1.04, 0.12], [0.6, 0.34], [0.2, 0.4]]), { segments: 16 }), TS.galvDark, [0, height - 6.9, 1.5]);
    put(parts, boxG(0.5, 3.4, 0.3), TS.galvDark, [0, height - 8.5, 0.62]);
    for (const x of [-0.5, 0.5]) put(parts, lathed(closedProfile([[0.18, 0], [0.22, 0.08], [0.12, 0.16], [0.2, 0.24], [0.1, 0.38]]), { segments: 8 }), 0x4a5b52, [x, height - 6.8, 1.5]);
  }
  // the ground wire and the pole steps, which are the only other things on a pole
  put(parts, new THREE.CylinderGeometry(0.035, 0.035, height - 2, 6), TS.galvDark, [0.44, (height - 2) / 2, -0.28]);
  for (let i = 0; i < 6; i++) put(parts, new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), TS.galvDark, [(i % 2 ? 1 : -1) * 0.5, height - 12 + i * 1.8, 0], [0, 0, Math.PI / 2]);

  // A catenary between the pole and a point given in the pole's own frame.
  const catenary = (from, to, sag, radius, colour) => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      pts.push([
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t - Math.sin(Math.PI * t) * sag,
        from[2] + (to[2] - from[2]) * t,
      ]);
    }
    put(wires, tube(pts, pts.map(() => radius), { sides: 5, tubular: 14 }), colour);
  };
  for (const s of spans) {
    const n = s.wires ?? 3;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -3.2 + (6.4 * i) / (n - 1);
      catenary([x, armY + 1.1, 0], [(s.dx ?? 0) + x * 0.6, armY + 1.1 + (s.dy ?? 0), s.dz ?? 0], s.sag ?? 2.2, 0.05, 0x22242a);
    }
    if (s.neutral !== false) catenary([0, height - 10.5, 0], [s.dx ?? 0, height - 10.5 + (s.dy ?? 0), s.dz ?? 0], (s.sag ?? 2.2) * 1.35, 0.055, 0x22242a);
  }
  // service drops to the houses: a twisted triplex, so one fatter wire rather than three
  for (const d of drops) {
    catenary([0.3, height - 11.5, 0.6], [d.dx, height - 11.5 + (d.dy ?? -7), d.dz], d.sag ?? 2.6, 0.085, 0x1b1d22);
  }

  const g = group();
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.9,
    ...relief('bark', { seed, repeat: 7, strength: 0.55 }),
  }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  if (wires.length) {
    const w = mesh(mergeParts(wires), standard({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
    w.castShadow = false;                 // a shadow-mapped wire is a flickering dashed line
    g.add(w);
  }
  return g;
}

function bladeCanvas(text) {
  return canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = '#12542f'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#f2f4ee'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
    ctx.fillStyle = '#f7f9f4';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let size = 76;
    do { ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`; size -= 2; }
    while (ctx.measureText(text).width > 452 && size > 20);
    ctx.fillText(text, 256, 68);
  });
}

// The corner sign: two green blades at right angles on a galvanised U-channel post. The
// blades are set at DIFFERENT heights, which is how a real one is built and is also what
// stops the two of them reading as one plus-shaped object from straight on.
export function tsStreetSign({ top = '7th ST', bottom = 'TURKLE AVE', height = 9, seed = 42 } = {}) {
  const g = group();
  const parts = [];
  put(parts, boxG(0.22, height, 0.16), TS.galvDark, [0, height / 2, 0]);
  for (let i = 0; i < 14; i++) put(parts, boxG(0.1, 0.1, 0.06), 0x33383c, [0, 0.7 + i * 0.6, 0.1]);
  put(parts, boxG(0.42, 0.42, 0.42), TS.galvDark, [0, height - 0.6, 0]);
  const frame = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.6 }));
  frame.castShadow = true;
  g.add(frame);
  const blade = (text, y, yaw) => {
    const tex = bladeCanvas(text);
    const m = mesh(new THREE.PlaneGeometry(4.2, 1.05), standard({
      map: tex, roughness: 0.42,
      emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 0.1,
      side: THREE.DoubleSide,
    }));
    m.position.set(0, y, 0);
    m.rotation.y = yaw;
    m.castShadow = false;
    g.add(m);
  };
  blade(top, height - 0.35, 0);
  blade(bottom, height - 1.5, Math.PI / 2);
  return g;
}

// A US rural mailbox on a cedar post: a half-round tunnel with a flat back, a domed door
// with a latch, and the flag. THE FLAG IS THE OBJECT -- it is the only saturated thing at
// the end of a driveway, and it is in every photograph of this block.
export function tsMailbox({ seed = 43, height = 3.9, colour = TS.steel, flagUp = false } = {}) {
  const parts = [];
  const g = group();
  put(parts, boxG(0.42, height, 0.42), TS.cedarGrey, [0, height / 2, 0]);
  put(parts, boxG(1.9, 0.26, 0.5), TS.cedarGrey, [0, height - 0.13, 0.6]);
  put(parts, boxG(0.4, 0.9, 0.3), TS.cedarGrey, [0, height - 0.5, 0.42], [0.7, 0, 0]);
  // the box: a half cylinder lying along Z with a flat floor and a domed door
  const tunnel = [];
  const R = 0.46; const L = 1.7;
  for (let i = 0; i <= 14; i++) {
    const a = Math.PI * (i / 14);
    tunnel.push([-Math.cos(a) * R, Math.sin(a) * R * 1.05]);
  }
  tunnel.push([R, -0.02], [-R, -0.02]);
  put(parts, extrudeOutline(tunnel, L), colour, [0, height + R * 0.5, 0.5]);
  put(parts, boxG(R * 2 + 0.06, 0.06, L + 0.06), mix(colour, 0x000000, 0.3), [0, height + 0.02, 0.5]);
  put(parts, extrudeOutline(tunnel, 0.07), mix(colour, 0xffffff, 0.12), [0, height + R * 0.5, 0.5 + L / 2 + 0.04]);
  put(parts, new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8), TS.galvDark, [0, height + 0.22, 0.5 + L / 2 + 0.12], [Math.PI / 2, 0, 0]);
  // the flag
  const fy = flagUp ? height + 0.95 : height + 0.32;
  const rot = flagUp ? 0 : -Math.PI / 2;
  put(parts, boxG(0.07, 0.86, 0.07), TS.flagRed, [R + 0.09, fy, 0.5 - L * 0.3], [0, 0, rot]);
  put(parts, boxG(0.06, 0.52, 0.42), TS.flagRed, [R + 0.09 + (flagUp ? 0 : 0.42), fy + (flagUp ? 0.62 : 0), 0.5 - L * 0.3], [0, 0, rot]);
  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.62, metalness: 0.25 }));
  m.castShadow = true;
  g.add(m);
  return g;
}

// The air-conditioning condenser against the house wall: a louvred box on a pad with a fan
// guard on top. Nobody looks at it and every American house has one -- which is exactly why
// leaving it out is noticed without being seen.
export function tsAcUnit({ seed = 44, size = 2.6, height = 2.8 } = {}) {
  const parts = [];
  put(parts, boxG(size + 0.9, 0.35, size + 0.9), TS.concreteOld, [0, 0.17, 0]);
  put(parts, boxG(size, height, size), mix(TS.galv, 0x000000, 0.28), [0, 0.35 + height / 2, 0]);
  for (let i = 0; i < 16; i++) {
    const y = 0.7 + (i * (height - 0.9)) / 16;
    for (const [dx, dz, yaw] of [[0, size / 2 + 0.01, 0], [0, -size / 2 - 0.01, 0], [size / 2 + 0.01, 0, Math.PI / 2], [-size / 2 - 0.01, 0, Math.PI / 2]]) {
      put(parts, boxG(size - 0.2, 0.09, 0.04), mix(TS.galv, 0x000000, 0.1), [dx, y, dz], [0, yaw, 0]);
    }
  }
  put(parts, new THREE.CylinderGeometry(size * 0.46, size * 0.46, 0.12, 20), mix(TS.galv, 0x000000, 0.45), [0, 0.35 + height + 0.06, 0]);
  for (let i = 0; i < 9; i++) put(parts, new THREE.TorusGeometry(size * 0.05 + i * size * 0.045, 0.022, 5, 20), TS.galvDark, [0, 0.35 + height + 0.13, 0], [Math.PI / 2, 0, 0]);
  const g = group();
  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.55, metalness: 0.5 }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// A wheeled refuse cart at the kerb. One of these is in the corner photograph and it is the
// only thing in this world that tells you which day of the week it is.
export function tsTrashCart({ seed = 45, colour = 0x2e5aa0, height = 3.6 } = {}) {
  const parts = [];
  const W = 2.1; const D = 2.5;
  put(parts, extrudeOutline([[-W / 2, 0], [W / 2, 0], [W / 2 + 0.12, height], [-W / 2 - 0.12, height]], D), colour, [0, 0.42 + height / 2 - height / 2, 0]);
  put(parts, boxG(W + 0.34, 0.22, D + 0.3), mix(colour, 0x000000, 0.25), [0, height + 0.5, -0.1], [-0.09, 0, 0]);
  put(parts, boxG(W * 0.6, 0.14, 0.4), mix(colour, 0x000000, 0.4), [0, height + 0.58, D / 2 + 0.1]);
  for (const sx of [-1, 1]) put(parts, new THREE.CylinderGeometry(0.42, 0.42, 0.28, 12), 0x24262a, [sx * (W / 2 + 0.06), 0.42, -D / 2 + 0.5], [0, 0, Math.PI / 2]);
  put(parts, new THREE.CylinderGeometry(0.08, 0.08, W + 0.4, 8), TS.galvDark, [0, 0.42, -D / 2 + 0.5], [0, 0, Math.PI / 2]);
  const g = group();
  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.66 }));
  m.castShadow = true;
  g.add(m);
  g.position.y = 0;
  return g;
}

// A pumpkin on the porch step: eight lobes and a dry curled stem. It is October, and this is
// the one object in this world that says so.
export function tsPumpkin({ seed = 46, radius = 0.55, colour = TS.pumpkin } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const lobes = 9;
  const body = ball(radius, 14);
  tintGeometry(body, () => null);
  put(parts, body, colour, [0, radius * 0.86, 0], null, {
    scale: [1, 0.82, 1],
    tint: (p, c) => {
      const a = Math.atan2(p.z, p.x);
      const rib = 0.86 + 0.14 * Math.abs(Math.cos(a * lobes * 0.5));
      return [c.r * rib, c.g * rib, c.b * rib];
    },
  });
  // The ribs as geometry as well as tint: a pumpkin's silhouette is lumpy, and a tint alone
  // leaves it a sphere from the one angle that matters, which is against the sky.
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    put(parts, ball(radius * 0.42, 9), mix(colour, 0xffffff, 0.08),
      [Math.cos(a) * radius * 0.72, radius * 0.86, Math.sin(a) * radius * 0.72], null, { scale: [0.9, 0.8, 0.9] });
  }
  put(parts, new THREE.CylinderGeometry(0.06, 0.1, 0.42, 7), 0x6c6a34, [0.02, radius * 1.52, 0.01], [0.2, 0, 0.25]);
  const g = group();
  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.55 }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------

const TREE_KINDS = {
  // A common hackberry, which is the tree in these photographs: a short trunk, a broad
  // rounded-to-vase crown twice as wide as it is deep, and enough of it to shade the whole
  // front lawn. It is THE tree of an eastern Kansas town.
  hackberry: { crown: [0.52, 0.34, 0.5], base: 0.34, centre: 0.62, trunk: 0.042, limbs: 7, leaf: TS.leaf, leafAlt: TS.leafDeep, bark: 0x6e6355, wander: 0.1 },
  // American elm: the vase. Narrow at the fork, arching hard outward, a crown like a
  // fountain. Its whole identity is that the limbs leave the trunk at the same height.
  elm: { crown: [0.5, 0.3, 0.48], base: 0.42, centre: 0.7, trunk: 0.04, limbs: 6, leaf: 0x5d7c3c, leafAlt: 0x466030, bark: 0x6a5e50, wander: 0.05, vase: 0.85 },
  // Pin oak: a straight central leader all the way up with short branches off it. Wider at
  // the bottom than the top, which is the opposite of everything else on this street.
  oak: { crown: [0.34, 0.42, 0.33], base: 0.2, centre: 0.55, trunk: 0.05, limbs: 10, leaf: 0x4f6d33, leafAlt: 0x3c5628, bark: 0x5c5148, wander: 0.03, leader: true },
  // A silver maple going gold in the first week of October.
  maple: { crown: [0.46, 0.36, 0.44], base: 0.3, centre: 0.6, trunk: 0.044, limbs: 8, leaf: 0x83913a, leafAlt: TS.leafGold, bark: 0x6b6158, wander: 0.09 },
  autumn: { crown: [0.46, 0.34, 0.44], base: 0.32, centre: 0.6, trunk: 0.042, limbs: 8, leaf: TS.leafGold, leafAlt: TS.leafTan, bark: 0x6b6158, wander: 0.09 },
};

// A street tree. This is the MASSING only: trunk, limbs and a crown of puffs, which is what
// the pickable three.js object has to be for the gizmo to measure and for a click to land on
// something the size of a tree. Its foliage is rebuilt card by card by the HiFi native,
// where a tree this close to the arrival is worth thirty thousand triangles.
export function tsStreetTree({ seed = 51, height = 38, kind = 'hackberry', lean = 0 } = {}) {
  const rng = seededRandom(seed);
  const sp = TREE_KINDS[kind] ?? TREE_KINDS.hackberry;
  const H = height;
  const wood = [];
  const leaves = [];
  const r0 = H * sp.trunk;
  const forkY = H * sp.base;
  const centre = new THREE.Vector3(0, H * sp.centre, 0);
  const cr = [H * sp.crown[0], H * sp.crown[1], H * sp.crown[2]];

  const bend = [(rng() - 0.5) * H * sp.wander + lean * H * 0.05, (rng() - 0.5) * H * sp.wander];
  const trunkTop = sp.leader ? H * 0.92 : forkY;
  const trunkPts = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    trunkPts.push([bend[0] * t * t, -0.5 + (trunkTop + 0.5) * t, bend[1] * t * t]);
  }
  const trunkR = trunkPts.map((_, i) => {
    const t = i / (trunkPts.length - 1);
    return r0 * (1 - t * (sp.leader ? 0.86 : 0.55)) * (1 + Math.exp(-t * 11) * 1.0);
  });
  put(wood, tube(trunkPts, trunkR, { sides: 11 }), sp.bark);

  const tips = [];
  const limbs = sp.limbs;
  for (let i = 0; i < limbs; i++) {
    // An elm forks all its limbs at nearly one height; a pin oak spreads them all the way up
    // its leader. One number, two completely different trees.
    const t = sp.leader ? 0.24 + (i / limbs) * 0.62 + rng() * 0.05 : (sp.vase ? 0.02 : 0.2) * rng();
    const at = new THREE.Vector3(bend[0] * 0.8, forkY + (sp.leader ? (H * 0.9 - forkY) * ((i / limbs) * 0.9) : t * H * 0.3), bend[1] * 0.8);
    const az = (i / limbs) * Math.PI * 2 * 1.618 + rng() * 0.8;
    const rise = sp.leader ? 0.55 + rng() * 0.3 : (sp.vase ? 1.05 + rng() * 0.5 : 0.62 + rng() * 0.5);
    const len = H * (sp.leader ? 0.2 : 0.42) * (0.82 + rng() * 0.36);
    const dir = new THREE.Vector3(Math.cos(az), rise, Math.sin(az)).normalize();
    const end = at.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, len * (sp.vase ? 0.24 : 0.1), 0));
    const mid = at.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, -len * 0.04, 0));
    const pts = [at, at.clone().addScaledVector(dir, len * 0.26), mid, end].map((p) => [p.x, p.y, p.z]);
    const lr = r0 * 0.44;
    put(wood, tube(pts, [lr, lr * 0.8, lr * 0.5, lr * 0.2], { sides: 7 }), sp.bark);
    tips.push(end, mid.clone().lerp(end, 0.6));
    for (let k = 0; k < 2; k++) {
      const a2 = az + (rng() - 0.5) * 2.0;
      const d2 = new THREE.Vector3(Math.cos(a2), 0.5 + rng() * 0.6, Math.sin(a2)).normalize();
      const from = mid.clone().lerp(end, 0.3 + rng() * 0.5);
      const e2 = from.clone().addScaledVector(d2, len * (0.3 + rng() * 0.3));
      put(wood, tube([[from.x, from.y, from.z], [(from.x + e2.x) / 2, (from.y + e2.y) / 2 + 0.3, (from.z + e2.z) / 2], [e2.x, e2.y, e2.z]],
        [lr * 0.4, lr * 0.24, lr * 0.06], { sides: 5 }), sp.bark);
      tips.push(e2);
    }
  }

  // The crown: puffs at the branch tips for structure, and a shell over the crown ellipsoid
  // so the silhouette closes. A crown made ONLY of tip puffs is a bunch of balloons -- the
  // wonder-tree lesson -- so every puff is also pulled toward the crown centre.
  const puff = (p, r) => {
    const pulled = p.clone().lerp(centre, 0.18);
    const shade = 0.82 + rng() * 0.36;
    put(leaves, ball(r, 6), rng() < 0.35 ? sp.leafAlt : sp.leaf, [pulled.x, pulled.y, pulled.z],
      [rng() * 3, rng() * 3, 0], { scale: [1, 0.78, 1], tint: (q, c) => [c.r * shade, c.g * shade, c.b * shade * 0.94] });
  };
  for (const tip of tips) puff(tip, H * 0.085 * (0.8 + rng() * 0.5));
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const u = rng() * 2 - 1;
    const s = Math.sqrt(1 - u * u);
    const d = new THREE.Vector3(Math.cos(a) * s, u < -0.4 ? -u * 0.4 : u, Math.sin(a) * s);
    const c = centre.clone().add(new THREE.Vector3(d.x * cr[0], d.y * cr[1], d.z * cr[2]).multiplyScalar(0.76 + rng() * 0.2));
    if (c.y < forkY + H * 0.05) c.y = forkY + H * 0.05 + rng() * H * 0.04;
    puff(c, H * 0.1 * (0.8 + rng() * 0.45));
  }

  const g = group();
  const w = mesh(mergeParts(wood), standard({
    vertexColors: true, roughness: 0.95,
    ...relief('bark', { seed, repeat: 6, strength: 0.7 }),
  }));
  w.castShadow = true; w.receiveShadow = true;
  const l = mesh(smoothed(mergeParts(leaves), 1e-3), standard({ vertexColors: true, roughness: 0.82 }));
  l.castShadow = true; l.receiveShadow = true;
  g.add(w, l);
  return g;
}

const SHRUB_KINDS = {
  juniper: { colour: 0x47613f, alt: 0x37503a, squash: 0.55, puffs: 9, spread: 1.25 },
  boxwood: { colour: 0x4d6b38, alt: 0x3e5a2e, squash: 0.92, puffs: 8, spread: 1.0 },
  yew: { colour: 0x33502f, alt: 0x27412a, squash: 1.15, puffs: 7, spread: 0.8 },
  spirea: { colour: 0x6f8a3c, alt: 0x8d9a45, squash: 0.85, puffs: 10, spread: 1.1 },
  // The dry ornamental grass by the step, which has gone straw by October.
  grass: { colour: 0xa08a4e, alt: 0xb9a15c, squash: 1.35, puffs: 7, spread: 0.7, blades: true },
};

// A foundation shrub. Merged to ONE mesh, because a front yard has a dozen of them.
export function tsShrub({ seed = 61, radius = 1.6, kind = 'juniper' } = {}) {
  const rng = seededRandom(seed);
  const sp = SHRUB_KINDS[kind] ?? SHRUB_KINDS.boxwood;
  const parts = [];
  const R = radius;
  for (let i = 0; i < sp.puffs; i++) {
    const a = rng() * Math.PI * 2;
    const rr = Math.sqrt(rng()) * R * 0.55 * sp.spread;
    const y = R * sp.squash * (0.4 + rng() * 0.55);
    const s = R * (0.42 + rng() * 0.3);
    const shade = 0.78 + rng() * 0.42;
    put(parts, ball(s, 6), rng() < 0.4 ? sp.alt : sp.colour,
      [Math.cos(a) * rr, y, Math.sin(a) * rr], [rng() * 3, rng() * 3, 0],
      { scale: [1.1 * sp.spread, sp.squash, 1.1 * sp.spread], tint: (p, c) => [c.r * shade, c.g * shade, c.b * shade * 0.95] });
  }
  if (sp.blades) {
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2;
      const h = R * (1.4 + rng() * 1.1);
      put(parts, boxG(0.07, h, 0.02), mix(sp.colour, sp.alt, rng()),
        [Math.cos(a) * R * 0.3, h / 2, Math.sin(a) * R * 0.3], [Math.cos(a) * 0.4, a, Math.sin(a) * 0.4]);
    }
  }
  const g = group();
  const geometry = smoothed(mergeParts(parts), 1e-3);
  // ORIGIN AT THE BASE CENTRE is the house rule, and a bush built out of randomly placed
  // squashed balls does not honour it by construction -- the lowest ball decides where the
  // bottom is. Seat it, or every shrub in the world is planted a foot into the lawn.
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  const m = mesh(geometry, standard({ vertexColors: true, roughness: 0.84 }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// A ring of brick edging round a tree, filled with shredded bark, with the ornaments a
// Kansas front yard actually has in it: a concrete birdbath, a pair of urns, a shepherd's
// hook. All of them are in the corner photograph, and between them they say more about who
// lives here than the house does.
export function tsMulchRing({
  seed = 71, radius = 7, birdbath = true, urns = 2, hook = true, edging = TS.brickEdge,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // the mulch, dished very slightly so its rim reads against the lawn
  const disc = new THREE.CircleGeometry(radius - 0.22, 30);
  disc.rotateX(-Math.PI / 2);
  put(parts, disc, TS.mulch, [0, 0.1, 0], null, {
    tint: (p, c) => { const v = 0.75 + smoothNoise3(p.x * 0.6, 0, p.z * 0.6) * 0.5; return [c.r * v, c.g * v, c.b * v]; },
  });
  // the edging: bricks laid on edge round the ring, each one turned a little
  const n = Math.round((Math.PI * 2 * radius) / 0.72);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.04;
    const rr = radius - 0.12 + (rng() - 0.5) * 0.08;
    put(parts, boxG(0.7, 0.42, 0.34), mix(edging, rng() < 0.3 ? 0x7a4a3a : 0xc08a62, rng() * 0.5),
      [Math.cos(a) * rr, 0.2 + rng() * 0.03, Math.sin(a) * rr], [(rng() - 0.5) * 0.12, -a, (rng() - 0.5) * 0.1]);
  }
  if (birdbath) {
    const bx = radius * 0.5; const bz = -radius * 0.32;
    put(parts, lathed(closedProfile([[0.85, 0], [0.8, 0.14], [0.34, 0.4], [0.26, 1.9], [0.4, 2.1], [1.28, 2.28], [1.34, 2.5], [1.2, 2.56], [1.15, 2.4], [0.3, 2.34]]), { segments: 22 }),
      0xa9a396, [bx, 0.12, bz]);
    put(parts, new THREE.CylinderGeometry(1.1, 1.1, 0.06, 20), 0x51616b, [bx, 2.48, bz]);
  }
  for (let i = 0; i < urns; i++) {
    const a = 2.2 + i * 0.9;
    const ux = Math.cos(a) * radius * 0.62; const uz = Math.sin(a) * radius * 0.62;
    put(parts, lathed(closedProfile([[0.52, 0], [0.5, 0.12], [0.3, 0.2], [0.34, 0.8], [0.56, 1.35], [0.62, 1.5], [0.58, 1.58], [0.4, 1.5]]), { segments: 16 }),
      0x39424a, [ux, 0.12, uz]);
    for (let k = 0; k < 6; k++) {
      const b = rng() * Math.PI * 2;
      put(parts, ball(0.3, 5), mix(0x7c8a3c, 0xb8683c, rng() * 0.7), [ux + Math.cos(b) * 0.3, 1.62 + rng() * 0.2, uz + Math.sin(b) * 0.3], null, { scale: [1.2, 0.7, 1.2] });
    }
  }
  if (hook) {
    const hx = -radius * 0.55; const hz = radius * 0.3;
    put(parts, new THREE.CylinderGeometry(0.05, 0.05, 5.2, 8), 0x2c3034, [hx, 2.6, hz]);
    put(parts, new THREE.TorusGeometry(0.62, 0.05, 6, 14, Math.PI), 0x2c3034, [hx + 0.62, 5.2, hz], [Math.PI / 2, 0, 0]);
    put(parts, lathed(closedProfile([[0.02, 0], [0.34, 0.24], [0.4, 0.62], [0.24, 0.7], [0.1, 0.62]]), { segments: 12 }), 0x7b2c30, [hx + 1.24, 4.5, hz]);
  }
  const g = group();
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.92,
    ...relief('soil', { seed, repeat: 6, strength: 0.5 }),
  }));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

// The planting bed along the front of a house: brick edging, bark mulch, a row of shrubs and
// whatever is still flowering in October. Built as ONE prop so the layout does not have to
// place fourteen objects to get a flower bed.
export function tsFoundationBed({
  seed = 81, width = 22, depth = 4.5, edging = TS.brickEdge, plants = 'mixed',
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const halfW = width / 2; const halfD = depth / 2;
  const bed = extrudeOutline(roundedOutline(halfW, halfD, Math.min(1.2, halfD * 0.5)), 0.3);
  bed.rotateX(-Math.PI / 2);
  put(parts, bed, TS.mulch, [0, 0.16, 0], null, {
    tint: (p, c) => { const v = 0.72 + smoothNoise3(p.x * 0.7, 0, p.z * 0.7) * 0.56; return [c.r * v, c.g * v, c.b * v]; },
  });
  const per = 0.74;
  const n = Math.round((width * 2 + depth * 2) / per);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * (width * 2 + depth * 2);
    let x; let z; let a;
    if (t < width) { x = -halfW + t; z = halfD; a = 0; }
    else if (t < width + depth) { x = halfW; z = halfD - (t - width); a = Math.PI / 2; }
    else if (t < width * 2 + depth) { x = halfW - (t - width - depth); z = -halfD; a = 0; }
    else { x = -halfW; z = -halfD + (t - width * 2 - depth); a = Math.PI / 2; }
    put(parts, boxG(0.68, 0.36, 0.3), mix(edging, rng() < 0.3 ? 0x7a4a3a : 0xc08a62, rng() * 0.5),
      [x, 0.18 + rng() * 0.02, z], [(rng() - 0.5) * 0.1, a + (rng() - 0.5) * 0.09, (rng() - 0.5) * 0.09]);
  }
  const g = group();
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.93,
    ...relief('soil', { seed, repeat: 5, strength: 0.55 }),
  }));
  m.receiveShadow = true;
  g.add(m);
  // The planting itself is separate meshes, so a shrub keeps its own smooth shading.
  const kinds = plants === 'juniper' ? ['juniper'] : plants === 'green' ? ['boxwood', 'yew'] : ['juniper', 'boxwood', 'spirea', 'yew', 'grass'];
  const count = Math.max(2, Math.round(width / 3.4));
  for (let i = 0; i < count; i++) {
    const x = -halfW + 1.4 + ((width - 2.8) * i) / Math.max(1, count - 1);
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const s = tsShrub({ seed: seed * 7 + i, radius: 1.0 + rng() * 0.7, kind });
    s.position.set(x + (rng() - 0.5) * 0.5, 0.3, (rng() - 0.5) * (depth - 2.2));
    g.add(s);
  }
  return g;
}

// Fallen leaves. The trees on this block are shedding in the first week of October and the
// lawn under the big hackberry is half covered in them -- which is a genuinely important
// part of what the photographs look like, and it is free: flat cards lying on the grass,
// merged to one mesh, no alpha and no shadow.
export function tsLeafDrift({ seed = 91, radius = 12, count = 220, colour = TS.leafTan } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const leaf = extrudeOutline([[-0.03, -0.16], [0.24, -0.1], [0.3, 0.02], [0.16, 0.16], [-0.14, 0.12], [-0.22, -0.02]], 0.012);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    // drifted, not scattered: leaves pile toward the edge of a mulch ring and along a kerb
    const rr = radius * (0.25 + 0.75 * Math.sqrt(rng()));
    const shade = 0.6 + rng() * 0.8;
    put(parts, leaf, mix(colour, rng() < 0.35 ? TS.leafGold : 0x7d5a33, rng()),
      [Math.cos(a) * rr, 0.035 + rng() * 0.05, Math.sin(a) * rr],
      [Math.PI / 2 + (rng() - 0.5) * 0.5, rng() * Math.PI * 2, 0],
      { scale: 0.8 + rng() * 0.9, tint: (p, c) => [c.r * shade, c.g * shade, c.b * shade * 0.9] });
  }
  const g = group();
  const m = mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  m.castShadow = false; m.receiveShadow = true;
  g.add(m);
  return g;
}
