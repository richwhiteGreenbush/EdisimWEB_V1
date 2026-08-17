import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergeColored,
  mergedMesh,
  canvasTexture,
  signPanel,
  seededRandom,
  randomIn,
  relief,
  wrapText,
} from '../PropKit.js';

// "The Constellations" -- a night observing field, and the sky over it.
//
// Everything in this file hangs off ONE shared data table, `CONSTELLATIONS` below, which
// holds the real relative positions, magnitudes and spectral classes of the stars in eight
// figures. That table is used four separate ways -- as a walk-up interpretive board, as a
// giant pattern hung in the actual sky, as the map printed on a planisphere wheel, and as
// the source of every star's colour and size -- and it being ONE table is the whole reason
// they agree with each other. Orion on the board is the same Orion overhead, with
// Betelgeuse the same red in both.
//
// TWO THINGS ABOUT THIS WORLD ARE UNLIKE EVERY OTHER WORLD HERE, and nearly every odd
// choice below follows from one of them.
//
//  1. IT IS DARK. The sun is a moon: a weak, cool directional light. So a prop cannot rely
//     on being LIT to be seen -- an unlit sign at night is a black rectangle. Every surface
//     that carries information in this file is either emissive or `MeshBasicMaterial`,
//     which is unlit by definition and therefore renders at full brightness at midnight.
//  2. STARS ARE NOT OBJECTS, THEY ARE LIGHT. A star drawn as a shaded sphere reads as a
//     ball-bearing, because a sphere lit from one side has a dark limb and a star has no
//     dark side. Every star here is a `MeshBasicMaterial` core -- flat, unshaded, full
//     brightness -- inside a larger additive halo, which is what actually makes it read as
//     a point of light rather than as a bead. `fog: false` on both, or the far end of the
//     sky fades to the fog colour and the constellations dissolve into the murk.
//
// House rules from PropKit.js otherwise apply: feet at scale 1, origin at BASE CENTRE for
// anything that stands on the ground, fresh materials per call, seededRandom never
// Math.random. The sky props (`sky-constellation`, `moon-in-sky`, `milky-way`, `meteor`,
// `sky-star`) are the documented exception to the base-centre rule -- they are centred on
// their own origin and the layout hands them an `absoluteY`, because a thing hanging in the
// sky has nothing to do with the height of the ground under it.

// Spectral class -> colour. This is the real sequence, and it is worth getting right
// because it is the one fact about star colour a student is being asked to take away:
// blue-white is HOTTEST and red is coolest, which is the opposite of the way a tap is
// labelled. The M entry is pushed toward orange rather than a literal deep red -- a real
// M-class supergiant is far less saturated than the word "red" suggests, and at these
// sizes a saturated red core reads as a warning light.
const STAR_COLORS = {
  O: 0x9cb4ff,
  B: 0xb2c8ff,
  A: 0xd6e3ff,
  F: 0xfbf8ff,
  G: 0xfff6e6,
  K: 0xffd49c,
  M: 0xffa063,
};

// The faint blue of a chart's join lines. It is deliberately a DIM SOLID colour rather than a
// bright one at half opacity: the two look identical against a dark sky, and every join line
// in this world would otherwise be a transparent draw call -- twelve of them across the eight
// boards and four sky figures, for nothing. Transparency is fill-rate cost on the integrated
// GPUs this app targets, and the star halos are where it is worth spending.
const SKY_LINE = 0x2f4468;
const IRON = 0x2f3238;
const BRASS = 0xd0a044;
const BRASS_DARK = 0x8d6a26;
const STONE = 0x7d7869;

// ---------------------------------------------------------------------------
// The star table
// ---------------------------------------------------------------------------

// Coordinates are in a unit square, x right and y UP, both roughly -1..1, taken off a
// star chart rather than invented -- the shape is the whole point of a constellation, and
// a made-up one teaches a student to recognise something that is not there. `mag` is real
// apparent magnitude (SMALLER IS BRIGHTER, which is why every size calculation below
// subtracts it), `spec` the spectral class initial.
//
// `lines` are index pairs: the join lines every star atlas draws, which are a convention
// and not something in the sky. `cluster` and `nebula` are the deep-sky objects worth
// naming inside a figure; both are drawn as soft glows rather than as points, because
// neither is one.
export const CONSTELLATIONS = {
  ursaMajor: {
    name: 'URSA MAJOR',
    latin: 'The Great Bear',
    season: 'All year, high in the north',
    brightest: 'Alioth · magnitude 1.8',
    note:
      'The seven stars most people call the Big Dipper or the Plough are only the bear’s '
      + 'hindquarters and tail. Follow the two stars at the end of the bowl — Merak and '
      + 'Dubhe — straight up about five bowl-widths and you arrive at Polaris, which sits '
      + 'almost exactly over the North Pole and so never appears to move.',
    stars: [
      { x: -0.88, y: 0.34, mag: 1.86, spec: 'B', label: 'Alkaid' },
      { x: -0.56, y: 0.17, mag: 2.23, spec: 'A', label: 'Mizar' },
      { x: -0.29, y: 0.05, mag: 1.77, spec: 'A', label: 'Alioth' },
      { x: -0.04, y: -0.06, mag: 3.31, spec: 'A', label: 'Megrez' },
      { x: 0.22, y: 0.30, mag: 1.79, spec: 'K', label: 'Dubhe' },
      { x: 0.27, y: -0.20, mag: 2.37, spec: 'A', label: 'Merak' },
      { x: -0.01, y: -0.34, mag: 2.44, spec: 'A', label: 'Phecda' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
    // The pointer. Drawn as a dashed ray leaving the panel, because the thing it points at
    // is not on this board -- which is exactly the lesson.
    pointer: { from: 5, to: 4, label: 'to POLARIS' },
  },

  orion: {
    name: 'ORION',
    latin: 'The Hunter',
    season: 'Winter evenings, due south',
    brightest: 'Rigel · magnitude 0.1',
    note:
      'The easiest constellation in the sky, and the most useful: three stars in a straight '
      + 'row are the belt, and nothing else looks like that. Betelgeuse is a red supergiant '
      + 'so large that if it replaced the Sun it would swallow the orbit of Mars. Rigel is '
      + 'blue-white, far hotter, and about 40,000 times brighter than the Sun.',
    stars: [
      { x: -0.42, y: 0.60, mag: 0.50, spec: 'M', label: 'Betelgeuse' },
      { x: 0.40, y: 0.56, mag: 1.64, spec: 'B', label: 'Bellatrix' },
      { x: -0.22, y: 0.02, mag: 1.70, spec: 'O', label: 'Alnitak' },
      { x: 0.00, y: 0.07, mag: 1.69, spec: 'B', label: 'Alnilam' },
      { x: 0.22, y: 0.11, mag: 2.20, spec: 'O', label: 'Mintaka' },
      { x: -0.38, y: -0.58, mag: 2.06, spec: 'B', label: 'Saiph' },
      { x: 0.45, y: -0.62, mag: 0.13, spec: 'B', label: 'Rigel' },
      { x: 0.02, y: 0.86, mag: 3.39, spec: 'O', label: 'Meissa' },
    ],
    lines: [[0, 2], [2, 3], [3, 4], [4, 1], [2, 5], [4, 6], [0, 7], [1, 7]],
    nebula: { x: -0.02, y: -0.26, r: 0.17, label: 'ORION NEBULA · M42', color: '#7fb2d9' },
  },

  cassiopeia: {
    name: 'CASSIOPEIA',
    latin: 'The Queen',
    season: 'All year, opposite the Dipper',
    brightest: 'Gamma Cassiopeiae · magnitude 2.2',
    note:
      'A W — or an M, depending on the time of night, because the whole northern sky wheels '
      + 'round Polaris once a day and this figure goes with it. Cassiopeia sits on the far '
      + 'side of the pole from the Big Dipper, so when one is high overhead the other is '
      + 'down near the horizon. Between them, they point out Polaris all year round.',
    stars: [
      { x: 0.82, y: 0.30, mag: 2.27, spec: 'F', label: 'Caph' },
      { x: 0.41, y: -0.12, mag: 2.24, spec: 'K', label: 'Schedar' },
      { x: 0.02, y: 0.24, mag: 2.15, spec: 'B', label: 'Gamma Cas' },
      { x: -0.38, y: -0.14, mag: 2.68, spec: 'A', label: 'Ruchbah' },
      { x: -0.78, y: 0.26, mag: 3.35, spec: 'B', label: 'Segin' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },

  cygnus: {
    name: 'CYGNUS',
    latin: 'The Swan',
    season: 'Summer, straight overhead',
    brightest: 'Deneb · magnitude 1.3',
    note:
      'A swan flying down the middle of the Milky Way with its neck stretched out. Its five '
      + 'brightest stars also make the Northern Cross. Deneb is one of the most luminous '
      + 'stars anybody can see with their eyes — around 100,000 Suns — and it looks merely '
      + 'ordinary only because it is some 1,500 light years away.',
    stars: [
      { x: 0.00, y: 0.88, mag: 1.25, spec: 'A', label: 'Deneb' },
      { x: 0.00, y: 0.18, mag: 2.23, spec: 'F', label: 'Sadr' },
      { x: -0.74, y: -0.04, mag: 2.48, spec: 'K', label: 'Gienah' },
      { x: 0.72, y: 0.30, mag: 2.87, spec: 'A', label: 'Delta Cygni' },
      { x: 0.00, y: -0.80, mag: 3.18, spec: 'K', label: 'Albireo' },
    ],
    lines: [[0, 1], [1, 4], [2, 1], [1, 3]],
  },

  scorpius: {
    name: 'SCORPIUS',
    latin: 'The Scorpion',
    season: 'Summer, low in the south',
    brightest: 'Antares · magnitude 1.1',
    note:
      'One of the few constellations that really looks like the animal it is named after — '
      + 'claws at the top, a long curving tail with a sting on the end. Antares means '
      + '"rival of Mars", because both are red and they are often close together in the sky. '
      + 'It is a red supergiant about 700 times the width of the Sun.',
    stars: [
      { x: 0.10, y: 0.30, mag: 1.06, spec: 'M', label: 'Antares' },
      { x: 0.54, y: 0.74, mag: 2.62, spec: 'B', label: 'Graffias' },
      { x: 0.40, y: 0.56, mag: 2.32, spec: 'B', label: 'Dschubba' },
      { x: 0.46, y: 0.34, mag: 2.89, spec: 'B', label: 'Pi Scorpii' },
      { x: 0.20, y: 0.48, mag: 2.90, spec: 'B', label: 'Sigma Scorpii' },
      { x: -0.03, y: 0.14, mag: 2.82, spec: 'B', label: 'Tau Scorpii' },
      { x: -0.12, y: -0.12, mag: 2.29, spec: 'K', label: 'Epsilon Scorpii' },
      { x: -0.17, y: -0.36, mag: 3.00, spec: 'B', label: 'Mu Scorpii' },
      { x: -0.10, y: -0.56, mag: 3.62, spec: 'B', label: 'Zeta Scorpii' },
      { x: 0.13, y: -0.70, mag: 3.33, spec: 'F', label: 'Eta Scorpii' },
      { x: 0.35, y: -0.76, mag: 1.86, spec: 'F', label: 'Sargas' },
      { x: 0.53, y: -0.66, mag: 3.03, spec: 'F', label: 'Iota Scorpii' },
      { x: 0.67, y: -0.50, mag: 1.62, spec: 'B', label: 'Shaula' },
      { x: 0.74, y: -0.40, mag: 2.70, spec: 'B', label: 'Lesath' },
    ],
    lines: [
      [1, 2], [2, 3], [2, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 8],
      [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
    ],
  },

  leo: {
    name: 'LEO',
    latin: 'The Lion',
    season: 'Spring evenings, high south',
    brightest: 'Regulus · magnitude 1.4',
    note:
      'A crouching lion. The backwards question mark on the right is called the Sickle, and '
      + 'the bright dot at the bottom of it is Regulus, sitting almost exactly on the path '
      + 'the Sun takes through the sky. Regulus spins once every sixteen hours — so fast '
      + 'that it is not a ball at all but a squashed egg.',
    stars: [
      { x: 0.46, y: -0.52, mag: 1.36, spec: 'B', label: 'Regulus' },
      { x: 0.44, y: -0.24, mag: 3.48, spec: 'A', label: 'Eta Leonis' },
      { x: 0.37, y: 0.06, mag: 2.01, spec: 'K', label: 'Algieba' },
      { x: 0.29, y: 0.36, mag: 3.44, spec: 'B', label: 'Adhafera' },
      { x: 0.10, y: 0.48, mag: 3.88, spec: 'K', label: 'Rasalas' },
      { x: -0.05, y: 0.31, mag: 2.98, spec: 'A', label: 'Algenubi' },
      { x: -0.36, y: 0.22, mag: 2.56, spec: 'A', label: 'Zosma' },
      { x: -0.31, y: -0.20, mag: 3.32, spec: 'A', label: 'Chertan' },
      { x: -0.82, y: 0.06, mag: 2.14, spec: 'A', label: 'Denebola' },
    ],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [6, 7]],
  },

  taurus: {
    name: 'TAURUS',
    latin: 'The Bull',
    season: 'Winter, above Orion',
    brightest: 'Aldebaran · magnitude 0.9',
    note:
      'A bull charging out of the sky, with only the head and horns drawn. Aldebaran is the '
      + 'orange eye. The tight little knot of stars over its shoulder is the Pleiades — a '
      + 'genuine cluster of hundreds of hot young stars, all born together, and the six or '
      + 'seven you can pick out without a telescope are only the brightest of them.',
    stars: [
      { x: 0.10, y: -0.12, mag: 0.85, spec: 'K', label: 'Aldebaran' },
      { x: 0.31, y: 0.19, mag: 3.53, spec: 'K', label: 'Epsilon Tauri' },
      { x: 0.44, y: 0.06, mag: 3.76, spec: 'K', label: 'Delta Tauri' },
      { x: 0.52, y: -0.13, mag: 3.65, spec: 'G', label: 'Gamma Tauri' },
      { x: 0.36, y: -0.05, mag: 3.40, spec: 'A', label: 'Theta Tauri' },
      { x: -0.44, y: 0.62, mag: 1.65, spec: 'B', label: 'Elnath' },
      { x: -0.54, y: -0.36, mag: 3.00, spec: 'B', label: 'Zeta Tauri' },
      { x: 0.66, y: -0.44, mag: 3.41, spec: 'A', label: 'Lambda Tauri' },
    ],
    lines: [[1, 2], [2, 3], [3, 4], [4, 0], [1, 5], [0, 6], [3, 7]],
    cluster: { x: 0.66, y: 0.52, r: 0.18, label: 'PLEIADES · M45', count: 9 },
  },

  crux: {
    name: 'CRUX',
    latin: 'The Southern Cross',
    season: 'Never — not from North America',
    brightest: 'Acrux · magnitude 0.8',
    note:
      'This one is on the board so you know what you are missing. Crux never rises for most '
      + 'of the northern hemisphere: it belongs to the southern sky, and it is on the flags '
      + 'of Australia, New Zealand and Brazil. Its long axis points towards the south '
      + 'celestial pole — where, unlike the north, there is no bright star to mark the spot.',
    stars: [
      { x: 0.00, y: -0.86, mag: 0.77, spec: 'B', label: 'Acrux' },
      { x: -0.64, y: 0.10, mag: 1.25, spec: 'B', label: 'Mimosa' },
      { x: 0.06, y: 0.80, mag: 1.63, spec: 'M', label: 'Gacrux' },
      { x: 0.58, y: 0.02, mag: 2.79, spec: 'B', label: 'Delta Crucis' },
      { x: 0.19, y: -0.34, mag: 3.59, spec: 'K', label: 'Epsilon Crucis' },
    ],
    lines: [[0, 2], [1, 3]],
  },
};

// ---------------------------------------------------------------------------
// Star geometry -- shared by the boards, the sky patterns and the wheel
// ---------------------------------------------------------------------------

function ball(radius, detail = 10) {
  // Height segments floored at 3, not 5: nearly every sphere in this file is a small star
  // core or a bead, and a floor of 5 quietly triples the triangles on every one of them.
  // Width floored at 6, because at 4 a sphere is SQUARE in cross-section.
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// How big to draw a star of apparent magnitude `mag`, as a fraction of the field's half
// width. Magnitude is a logarithmic scale running BACKWARDS -- mag 0 is about 40 times
// brighter than mag 4 -- so this is a deliberately compressed mapping rather than a
// faithful one: at true brightness ratios Rigel would be a beach ball and Megrez invisible.
function starScale(mag) {
  const rel = THREE.MathUtils.clamp((4.0 - mag) / 3.6, 0.2, 1);
  return 0.022 + 0.052 * Math.pow(rel, 1.2);
}

// The soft bloom every star in this file wears, as one small texture: a hot white centre
// falling away to nothing, plus four faint diffraction spikes.
//
// IT HAS TO BE A TEXTURED QUAD AND NOT A SPHERE, and this was found the hard way. A sphere
// with a `MeshBasicMaterial` is UNLIT, which means every pixel of it is the same colour --
// so it renders as a flat disc with a hard edge, and a bigger translucent sphere around it
// renders as a second hard-edged disc. The result is a coloured button with a ring round it,
// which is what the first version of this world looked like: nothing on the board read as a
// point of light. What the eye actually recognises as a star is the GRADIENT, and the only
// cheap way to get a gradient with no post-processing pipeline is to paint one.
//
// The spikes are worth their four lines. Every photograph of a bright star has them (they are
// a diffraction artefact of the telescope's own support vanes, not anything about the star),
// so they read instantly as "this is a star" even though nothing in the sky has them.
function starGlowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const c = w / 2;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.00, 'rgba(255,255,255,1)');
    grad.addColorStop(0.07, 'rgba(255,255,255,0.98)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.72)');
    grad.addColorStop(0.30, 'rgba(255,255,255,0.26)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.075)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (const angle of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(angle);
      const spike = ctx.createLinearGradient(-c, 0, c, 0);
      spike.addColorStop(0.00, 'rgba(255,255,255,0)');
      spike.addColorStop(0.34, 'rgba(255,255,255,0.10)');
      spike.addColorStop(0.50, 'rgba(255,255,255,0.55)');
      spike.addColorStop(0.66, 'rgba(255,255,255,0.10)');
      spike.addColorStop(1.00, 'rgba(255,255,255,0)');
      ctx.fillStyle = spike;
      ctx.fillRect(-c, -w * 0.014, w, w * 0.028);
      ctx.restore();
    }
  });
}

// One star, as a small unlit core sphere plus a textured additive halo quad, pushed into two
// parallel part lists so a whole figure comes out as exactly two draw calls.
//
// The core stays a real sphere rather than becoming part of the quad: it is what gives a
// board's stars presence as objects standing off the panel's face, catching a different
// highlight as a student walks past. The halo does all the work of making it read as light.
function pushStar(cores, halos, { x, y, z = 0, radius, color, halo = 5.0, detail = 10 }) {
  const core = ball(radius * 0.62, detail);
  core.translate(x, y, z);
  cores.push({ geometry: core, color });

  const size = radius * halo * 2;
  const glow = new THREE.PlaneGeometry(size, size);
  glow.translate(x, y, z + 0.002);
  halos.push({ geometry: glow, color });
}

// A join line between two stars, as a thin flat bar lying in the pattern's own plane.
function pushLine(parts, a, b, { z = 0, thickness, color = SKY_LINE }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return;
  const bar = new THREE.BoxGeometry(length, thickness, thickness * 0.7);
  parts.push({
    geometry: bar,
    color,
    rotation: [0, 0, Math.atan2(dy, dx)],
    position: [(a.x + b.x) / 2, (a.y + b.y) / 2, z],
  });
}

// The two materials every star in this file uses. Both are MeshBasicMaterial and both are
// unlit, which is the entire point: this world's only light is a weak moon, and a star
// that responds to lighting is a pebble.
function coreMaterial() {
  return new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
}

// The halo material carries BOTH a map and vertexColors, which multiplies the two -- normally
// the trap this project warns about, and here it is the whole mechanism. The map is a pure
// WHITE gradient carrying no colour of its own, so it supplies the shape of the bloom while
// each star's vertex colour supplies its hue. One texture and one merged mesh therefore give a
// whole constellation of correctly-coloured stars. Same trick the flower beds use.
function haloMaterial(opacity) {
  return new THREE.MeshBasicMaterial({
    map: starGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

function glowMesh(parts, material, renderOrder = 3) {
  const m = new THREE.Mesh(mergeColored(parts), material);
  m.castShadow = false;
  m.receiveShadow = false;
  m.renderOrder = renderOrder;
  return m;
}

// A soft round patch of light on a canvas -- a nebula, a star cloud, the bloom under a
// bright star. Faded to fully transparent at the rim, so it never has an edge the eye can
// catch and read as an object lying on top of the sky.
function canvasGlow(ctx, x, y, radius, color, alpha, squash = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, squash);
  const grad = ctx.createRadialGradient(0, 0, radius * 0.06, 0, 0, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Background sky for any painted star field: a deep gradient, a dust of faint stars, and
// nothing else. Deliberately NOT flat black -- a flat black rectangle on a night-time
// board reads as a hole cut in the panel, and the real sky is never black either.
function paintNightField(ctx, rect, rng, { density = 190, top = '#0a1430', bottom = '#050a1c' } = {}) {
  const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

  for (let i = 0; i < density; i++) {
    const r = randomIn(rng, 0.5, 1.9);
    const a = randomIn(rng, 0.12, 0.6);
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 7 === 0 ? '#ffd9b0' : '#dfe8ff';
    ctx.beginPath();
    ctx.arc(randomIn(rng, rect.x, rect.x + rect.w), randomIn(rng, rect.y, rect.y + rect.h), r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Maps a figure's unit coordinates into a canvas rect. y flips, because canvas y runs down
// and the sky does not.
function fieldMapper(rect) {
  const unit = Math.min(rect.w, rect.h) / 2;
  return (sx, sy) => [rect.x + rect.w / 2 + sx * unit, rect.y + rect.h / 2 - sy * unit];
}

// ---------------------------------------------------------------------------
// 1. The constellation board -- the walk-up interpretive panel
// ---------------------------------------------------------------------------

// One constellation, presented the way a good observatory presents one: a big dark star
// field with the pattern standing PROUD of it in real glowing spheres, and a column of
// text beside it saying what it is, when to look and what is worth knowing.
//
// The stars are geometry rather than paint, and that is the design. A printed chart is a
// picture of the sky; a board with the stars themselves sitting an inch off its face
// catches the light differently as a student walks past it, throws its own halo, and can
// be read from an angle -- which is the difference between a poster and an exhibit. The
// painted field behind them carries only what geometry cannot: the join lines' shadow, the
// nebulae, the labels and the dust.
export function constellationBoard({
  figure = 'orion',
  width = 10,
  height = 7.2,
  postHeight = 9.4,
  accent = '#6f9bd1',
  seed = 11,
} = {}) {
  const data = CONSTELLATIONS[figure];
  if (!data) throw new Error(`Unknown constellation: "${figure}"`);
  const rng = seededRandom(seed);
  const g = group();

  // --- Frame and posts ----------------------------------------------------
  const iron = standard({ color: IRON, roughness: 0.62, metalness: 0.45, ...relief('metal', { seed: seed + 5, repeat: 3 }) });
  const inset = width / 2 + 0.3;
  g.add(cyl(0.18, 0.24, postHeight, iron, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.18, 0.24, postHeight, iron, inset, postHeight / 2, 0, 12));

  const panelY = postHeight - height / 2 - 0.5;
  g.add(box(width + 0.22, height + 0.22, 0.16, iron, 0, panelY, -0.09));
  // A shallow hood over the top edge. Every real outdoor panel has one, and here it also
  // gives the board a lit top surface against a black sky, which is what stops it reading
  // as a rectangular hole.
  g.add(box(width + 0.5, 0.12, 0.9, iron, 0, panelY + height / 2 + 0.22, 0.3));

  // --- The painted face ---------------------------------------------------
  const CW = 1280;
  const CH = Math.round(CW * (height / width));
  // The star field is a SQUARE region on the left; the text column is the rest. A
  // constellation is roughly as tall as it is wide, so a field stretched to the board's
  // 10:7 shape distorts every pattern on every board -- and a distorted Big Dipper is not
  // a Big Dipper.
  const fieldRect = { x: CW * 0.028, y: CH * 0.185, w: CW * 0.535, h: CH * 0.79 };
  const textX = CW * 0.60;
  const textW = CW * 0.37;

  const texture = canvasTexture(CW, CH, (ctx, w, h) => {
    ctx.fillStyle = '#101826';
    ctx.fillRect(0, 0, w, h);

    // Header band.
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, Math.round(h * 0.15));
    ctx.fillStyle = '#0b1220';
    ctx.font = `bold ${Math.round(h * 0.088)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(data.name, 42, Math.round(h * 0.104));
    ctx.textAlign = 'right';
    ctx.font = `italic ${Math.round(h * 0.052)}px Georgia, "Times New Roman", serif`;
    ctx.fillText(data.latin, w - 42, Math.round(h * 0.100));
    ctx.textAlign = 'left';

    // The sky, and the pattern painted into it. The painted stars sit UNDER the real ones
    // and are drawn a little smaller: they are the chart's record of where each star is,
    // and the glow around them is what the geometry then lands in.
    paintNightField(ctx, fieldRect, rng);
    const at = fieldMapper(fieldRect);
    const unit = Math.min(fieldRect.w, fieldRect.h) / 2;

    // Join lines first, so every star is drawn over its own joins.
    ctx.strokeStyle = 'rgba(126,164,214,0.55)';
    ctx.lineWidth = Math.max(1.6, unit * 0.010);
    for (const [i, j] of data.lines) {
      const [ax, ay] = at(data.stars[i].x, data.stars[i].y);
      const [bx, by] = at(data.stars[j].x, data.stars[j].y);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    if (data.nebula) {
      const [nx, ny] = at(data.nebula.x, data.nebula.y);
      canvasGlow(ctx, nx, ny, unit * data.nebula.r * 2.2, data.nebula.color, 0.5, 0.75);
      canvasGlow(ctx, nx, ny, unit * data.nebula.r, '#ffffff', 0.32, 0.8);
      ctx.fillStyle = 'rgba(190,220,255,0.9)';
      ctx.font = `bold ${Math.round(unit * 0.075)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(data.nebula.label, nx + unit * data.nebula.r * 1.1, ny + unit * 0.10);
    }

    if (data.cluster) {
      const [cx, cy] = at(data.cluster.x, data.cluster.y);
      canvasGlow(ctx, cx, cy, unit * data.cluster.r * 1.9, '#bcd4ff', 0.34);
      ctx.fillStyle = 'rgba(200,224,255,0.9)';
      ctx.font = `bold ${Math.round(unit * 0.072)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(data.cluster.label, cx, cy - unit * data.cluster.r * 1.5);
      ctx.textAlign = 'left';
    }

    // Painted star discs + their bloom, and the star names.
    for (const star of data.stars) {
      const [sx, sy] = at(star.x, star.y);
      const r = unit * starScale(star.mag);
      const hex = `#${new THREE.Color(STAR_COLORS[star.spec] ?? STAR_COLORS.A).getHexString()}`;
      canvasGlow(ctx, sx, sy, r * 5.5, hex, 0.30);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.85, 0, Math.PI * 2);
      ctx.fill();

      // Only the ones worth naming: below about magnitude 3 a board this size turns into a
      // wall of type, and the names a student can actually use are the bright ones.
      if (star.mag < 2.6) {
        ctx.fillStyle = 'rgba(214,230,255,0.86)';
        ctx.font = `${Math.round(unit * 0.068)}px "Helvetica Neue", Arial, sans-serif`;
        ctx.fillText(star.label, sx + r * 1.9 + 4, sy + unit * 0.028);
      }
    }

    // The pointer ray, dashed and running off the edge of the field.
    if (data.pointer) {
      const a = data.stars[data.pointer.from];
      const b = data.stars[data.pointer.to];
      const [ax, ay] = at(a.x, a.y);
      const [bx, by] = at(b.x, b.y);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const reach = unit * 1.25;
      const ex = bx + (dx / len) * reach;
      const ey = by + (dy / len) * reach;
      ctx.save();
      ctx.setLineDash([unit * 0.06, unit * 0.05]);
      ctx.strokeStyle = 'rgba(255,214,120,0.9)';
      ctx.lineWidth = Math.max(1.8, unit * 0.012);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,214,120,0.95)';
      ctx.font = `bold ${Math.round(unit * 0.082)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(data.pointer.label, ex, ey - unit * 0.06);
      ctx.textAlign = 'left';
    }

    ctx.strokeStyle = 'rgba(140,172,214,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(fieldRect.x, fieldRect.y, fieldRect.w, fieldRect.h);

    // --- Text column ------------------------------------------------------
    let y = fieldRect.y + Math.round(h * 0.045);
    const label = (text, color, size, weight = 'bold', family = '"Helvetica Neue", Arial, sans-serif') => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${size}px ${family}`;
      y = wrapText(ctx, text, textX, y, textW, Math.round(size * 1.28));
    };

    label('WHEN TO LOOK', accent, Math.round(h * 0.038));
    y += Math.round(h * 0.004);
    label(data.season, '#e8eefb', Math.round(h * 0.046), 'normal', 'Georgia, "Times New Roman", serif');
    y += Math.round(h * 0.030);

    label('BRIGHTEST STAR', accent, Math.round(h * 0.038));
    y += Math.round(h * 0.004);
    label(data.brightest, '#e8eefb', Math.round(h * 0.046), 'normal', 'Georgia, "Times New Roman", serif');
    y += Math.round(h * 0.030);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(textX, y - Math.round(h * 0.012));
    ctx.lineTo(textX + textW * 0.45, y - Math.round(h * 0.012));
    ctx.stroke();
    y += Math.round(h * 0.014);

    // The note is fitted to the room that is left, the same way cardTexture fits its body:
    // how many lines the season and the star name wrapped to is not something the caller
    // can know, and a paragraph clipped at the bottom edge is worse than one set smaller.
    const room = h - Math.round(h * 0.04) - y;
    let size = Math.round(h * 0.042);
    let lineH = Math.round(size * 1.3);
    for (let i = 0; i < 8; i++) {
      ctx.font = `${size}px Georgia, "Times New Roman", serif`;
      const lines = [];
      let line = '';
      for (const word of data.note.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width > textW && line) {
          lines.push(line);
          line = word;
        } else line = candidate;
      }
      if (line) lines.push(line);
      lineH = Math.round(size * 1.3);
      if (lines.length * lineH <= room || size <= 15) break;
      size -= 2;
    }
    ctx.fillStyle = '#c9d6ec';
    ctx.font = `${size}px Georgia, "Times New Roman", serif`;
    wrapText(ctx, data.note, textX, y + size, textW, lineH);
  });

  // Emissive, using its own artwork as the emissive map -- the same treatment activityBoard
  // gets, and for a stronger version of the same reason. In this world the sun is a moon at
  // barely half normal intensity, so a lit panel is a dim panel, and every one of these is
  // meant to be readable in the dark.
  const face = signPanel(width, height, texture, { emissive: '#ffffff', emissiveIntensity: 0.78 });
  face.position.set(0, panelY, 0.001);
  g.add(face);

  // --- The real stars, standing off the face ------------------------------
  const cores = [];
  const halos = [];
  const lines = [];
  // Field geometry in FEET, derived from the same canvas fractions the paint used, so the
  // spheres land exactly on the discs underneath them.
  const fw = width * (fieldRect.w / CW);
  const fh = height * (fieldRect.h / CH);
  const fx = -width / 2 + width * (fieldRect.x / CW) + fw / 2;
  const fy = height / 2 - height * (fieldRect.y / CH) - fh / 2;
  const unit = Math.min(fw, fh) / 2;
  const PROUD = 0.13;

  const at = (s) => ({ x: fx + s.x * unit, y: fy + s.y * unit });
  for (const [i, j] of data.lines) {
    pushLine(lines, at(data.stars[i]), at(data.stars[j]), { z: PROUD * 0.72, thickness: unit * 0.014 });
  }
  for (const star of data.stars) {
    const p = at(star);
    pushStar(cores, halos, {
      x: p.x,
      y: p.y,
      z: PROUD,
      radius: unit * starScale(star.mag) * 0.9,
      color: STAR_COLORS[star.spec] ?? STAR_COLORS.A,
      halo: 3.8,
    });
  }
  if (data.cluster) {
    // The Pleiades, as the tight knot of small stars it is. Placed on a seeded spiral
    // rather than at random so it is the same knot on every reload.
    for (let i = 0; i < data.cluster.count; i++) {
      const a = i * 2.399;
      const rad = unit * data.cluster.r * 0.75 * Math.sqrt((i + 0.6) / data.cluster.count);
      pushStar(cores, halos, {
        x: fx + (data.cluster.x + Math.cos(a) * rad / unit) * unit,
        y: fy + (data.cluster.y + Math.sin(a) * rad / unit) * unit,
        z: PROUD,
        radius: unit * 0.016,
        color: STAR_COLORS.B,
        halo: 3.6,
        detail: 8,
      });
    }
  }

  const lineMesh = new THREE.Mesh(mergeColored(lines), new THREE.MeshBasicMaterial({
    vertexColors: true, fog: false,
  }));
  lineMesh.castShadow = false;
  lineMesh.receiveShadow = false;
  const stars = glowMesh(cores, coreMaterial(), 3);
  const bloom = glowMesh(halos, haloMaterial(0.9), 4);

  const field = group(lineMesh, stars, bloom);
  field.position.set(0, panelY, 0);
  g.add(field);

  return g;
}

// ---------------------------------------------------------------------------
// 2. The same figure, hung in the actual sky
// ---------------------------------------------------------------------------

// A constellation as it is meant to be met: no board, no frame, just the stars, big, with
// its name written faintly underneath. This is the payoff for the boards -- a student
// reads Orion on a panel at eye height and then finds the same seven stars overhead in the
// same arrangement, because both come out of the same table.
//
// It FLOATS: the layout hands it an absoluteY. And it takes its own `tilt` rather than
// leaving that to the record, because a pattern hung 130ft up and viewed from 250ft away is
// seen at a steep angle, and a flat figure not tipped toward the viewer is a figure
// squashed to a third of its height. A record only carries rotX/rotY, and rotX is applied
// about the WORLD x-axis AFTER the yaw -- so for any figure not facing due Z it would roll
// the pattern instead of tipping it. Tipping belongs in here, where it is applied before
// the yaw.
// `roll` turns the pattern about its own line of sight, and it is not decoration either. A
// constellation's ORIENTATION changes through the night as the sky wheels round the pole, so
// a figure hung at whatever angle the chart happens to draw it is a figure at the wrong angle
// for the position it has been placed in. It matters most for Ursa Major, where the two
// pointer stars have to genuinely line up on wherever this world has hung Polaris -- the
// board next to it promises they do, and a student who checks and finds they do not has been
// taught something false.
//
// The roll is applied to the STARS ONLY, not to the name plate under them: a label rolled
// ninety degrees is a label on its side.
export function skyConstellation({
  figure = 'orion',
  span = 110,
  tilt = 0.5,
  roll = 0,
  label = true,
  opacity = 0.92,
  seed = 21,
} = {}) {
  const data = CONSTELLATIONS[figure];
  if (!data) throw new Error(`Unknown constellation: "${figure}"`);
  const g = group();
  const inner = group();
  const rolled = group();
  rolled.rotation.z = roll;
  inner.add(rolled);
  const unit = span / 2;

  const cores = [];
  const halos = [];
  const lines = [];

  const at = (s) => ({ x: s.x * unit, y: s.y * unit });
  // Dimmer than a board's join lines. On a board they are a printed chart's own drawing and are
  // meant to be followed; up in the sky they are a hint, and anything brighter starts competing
  // with the stars they are joining.
  for (const [i, j] of data.lines) {
    pushLine(lines, at(data.stars[i]), at(data.stars[j]), { z: -0.4, thickness: unit * 0.006, color: 0x1c2942 });
  }
  for (const star of data.stars) {
    const p = at(star);
    pushStar(cores, halos, {
      x: p.x,
      y: p.y,
      radius: unit * starScale(star.mag) * 0.62,
      color: STAR_COLORS[star.spec] ?? STAR_COLORS.A,
      halo: 4.2,
      detail: 12,
    });
  }
  if (data.cluster) {
    for (let i = 0; i < data.cluster.count; i++) {
      const a = i * 2.399;
      const rad = unit * data.cluster.r * 0.7 * Math.sqrt((i + 0.6) / data.cluster.count);
      pushStar(cores, halos, {
        x: (data.cluster.x * unit) + Math.cos(a) * rad,
        y: (data.cluster.y * unit) + Math.sin(a) * rad,
        radius: unit * 0.012,
        color: STAR_COLORS.B,
        halo: 4,
        detail: 8,
      });
    }
  }

  const lineMesh = new THREE.Mesh(mergeColored(lines), new THREE.MeshBasicMaterial({
    vertexColors: true, fog: false,
  }));
  lineMesh.castShadow = false;
  lineMesh.receiveShadow = false;
  rolled.add(lineMesh, glowMesh(cores, coreMaterial(), 3), glowMesh(halos, haloMaterial(opacity), 4));

  if (data.nebula) {
    const rng = seededRandom(seed);
    const neb = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      canvasGlow(ctx, w / 2, h / 2, w * 0.46, data.nebula.color, 0.9, 0.8);
      canvasGlow(ctx, w * 0.47, h * 0.52, w * 0.2, '#ffffff', 0.75);
      for (let i = 0; i < 12; i++) {
        canvasGlow(ctx, randomIn(rng, w * 0.25, w * 0.75), randomIn(rng, h * 0.25, h * 0.75),
          randomIn(rng, w * 0.06, w * 0.18), i % 2 ? '#a8c8f0' : '#e0b0d8', 0.28);
      }
    });
    const size = unit * data.nebula.r * 3.4;
    const nebMesh = mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({
      map: neb, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, toneMapped: false,
    }), data.nebula.x * unit, data.nebula.y * unit, -0.2);
    nebMesh.castShadow = false;
    nebMesh.receiveShadow = false;
    nebMesh.renderOrder = 2;
    rolled.add(nebMesh);
  }

  if (label) {
    const lw = span * 0.5;
    const lh = lw * 0.22;
    const text = canvasTexture(512, 112, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(150,186,236,0.85)';
      ctx.font = 'bold 52px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(data.name, w / 2, 58);
      ctx.fillStyle = 'rgba(150,186,236,0.55)';
      ctx.font = 'italic 34px Georgia, "Times New Roman", serif';
      ctx.fillText(data.latin, w / 2, 98);
    });
    const plate = mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshBasicMaterial({
      map: text, transparent: true, opacity: 0.95, depthWrite: false, fog: false, toneMapped: false,
    }), 0, -unit * 1.06, 0);
    plate.castShadow = false;
    plate.receiveShadow = false;
    plate.renderOrder = 5;
    inner.add(plate);
  }

  inner.rotation.x = tilt;
  g.add(inner);
  return g;
}

// A single named star for the sky -- Polaris, Vega, Sirius. Same core-and-halo build as
// every other star here, with an optional name plate under it.
export function skyStar({
  magnitude = 2.0,
  spectral = 'A',
  size = 3.2,
  label = '',
  sub = '',
  tilt = 0.5,
} = {}) {
  const g = group();
  const inner = group();
  const cores = [];
  const halos = [];
  const radius = size * starScale(magnitude) * 6;
  pushStar(cores, halos, { x: 0, y: 0, radius, color: STAR_COLORS[spectral] ?? STAR_COLORS.A, halo: 3.6, detail: 14 });
  inner.add(glowMesh(cores, coreMaterial(), 3), glowMesh(halos, haloMaterial(0.95), 4));

  if (label) {
    const lw = size * 5;
    const text = canvasTexture(512, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,226,160,0.9)';
      ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(label, w / 2, 56);
      if (sub) {
        ctx.fillStyle = 'rgba(226,214,180,0.6)';
        ctx.font = 'italic 32px Georgia, "Times New Roman", serif';
        ctx.fillText(sub, w / 2, 100);
      }
    });
    const plate = mesh(new THREE.PlaneGeometry(lw, lw * 0.25), new THREE.MeshBasicMaterial({
      map: text, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    }), 0, -radius * 4.6, 0);
    plate.castShadow = false;
    plate.receiveShadow = false;
    plate.renderOrder = 5;
    inner.add(plate);
  }

  inner.rotation.x = tilt;
  g.add(inner);
  return g;
}

// ---------------------------------------------------------------------------
// 3. The armillary sphere -- the hero
// ---------------------------------------------------------------------------

// A brass armillary sphere on a stone pedestal: the instrument that taught the shape of the
// sky for four hundred years before anybody drew it on paper.
//
// It is the hero of this world for the same reason the carousel is Whimsical World's: the
// one thing a `rotate` block can drive properly is something that turns about the VERTICAL,
// and this turns about the vertical by design -- an armillary is spun to show the sky's
// daily wheel. So the most elaborate model in the world is also the one a student can
// immediately make do something.
//
// WHAT MAKES IT READ AS AN ARMILLARY AND NOT AS A GYROSCOPE, in order of how much each one
// buys: the rings must be at the RIGHT angles to each other (a horizon ring level, a
// meridian ring upright, and the equator inclined by 90 minus the latitude, which is the
// single fact the instrument exists to embody); the ecliptic must be tilted 23.4 degrees
// off the equator and must carry the zodiac, because that band is the only part of the sky
// the Sun ever visits; and there must be a small Earth at the centre, because the whole
// thing is drawn from the point of view of somebody standing on it.
export function armillarySphere({ radius = 4.3, latitude = 39, seed = 33 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const R = radius;
  const CENTRE = R + 5.1; // sphere centre well above a 5ft eye line, so the rings read against the sky
  const TILT = THREE.MathUtils.degToRad(23.44);
  const POLE = THREE.MathUtils.degToRad(latitude);
  const brassParts = [];

  // --- Stone pedestal ------------------------------------------------------
  const stoneParts = [];
  stoneParts.push({ geometry: new THREE.CylinderGeometry(2.5, 2.7, 0.5, 8), position: [0, 0.25, 0], color: 0x6d6a5e });
  stoneParts.push({ geometry: new THREE.CylinderGeometry(2.1, 2.4, 0.34, 8), position: [0, 0.67, 0], color: STONE });
  stoneParts.push({ geometry: new THREE.TorusGeometry(1.95, 0.16, 8, 24), rotation: [Math.PI / 2, 0, 0], position: [0, 0.9, 0], color: 0x8b8677 });
  // A tapered, fluted drum. The flutes are what make three feet of grey cylinder read as
  // carved stone rather than as a bollard, and they cost eight small boxes.
  stoneParts.push({ geometry: new THREE.CylinderGeometry(1.16, 1.42, 3.3, 20), position: [0, 2.6, 0], color: STONE });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const flute = new THREE.CylinderGeometry(0.13, 0.15, 3.1, 6);
    flute.translate(Math.cos(a) * 1.2, 2.6, Math.sin(a) * 1.2);
    stoneParts.push({ geometry: flute, color: 0x67645a });
  }
  stoneParts.push({ geometry: new THREE.CylinderGeometry(1.5, 1.22, 0.3, 20), position: [0, 4.4, 0], color: 0x8b8677 });
  stoneParts.push({ geometry: new THREE.BoxGeometry(2.5, 0.22, 2.5), position: [0, 4.66, 0], color: 0x928d7d });
  g.add(mergedMesh(stoneParts, { roughness: 0.95, ...relief('stone', { seed, repeat: 3 }) }));

  // --- The cradle: three curved brass legs carrying the sphere -------------
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    for (let s = 0; s < 5; s++) {
      const t = s / 4;
      const lean = 1.05 - t * 0.55;
      const seg = new THREE.CylinderGeometry(0.11 - t * 0.02, 0.13 - t * 0.02, 0.42, 8);
      seg.rotateZ(0.34 - t * 0.12);
      seg.translate(Math.cos(a) * lean, 4.9 + t * 1.55, Math.sin(a) * lean);
      seg.rotateY(a);
      brassParts.push({ geometry: seg, color: BRASS_DARK });
    }
  }
  brassParts.push({ geometry: new THREE.CylinderGeometry(0.6, 0.72, 0.3, 16), position: [0, 4.86, 0], color: BRASS_DARK });

  // --- The polar axis ------------------------------------------------------
  // Inclined by the LATITUDE, which is the whole instrument in one line: point a rod at the
  // pole star from wherever you are standing and it makes exactly this angle with the ground.
  const axisLength = R * 2.5;
  const axis = new THREE.CylinderGeometry(0.085, 0.085, axisLength, 12);
  axis.rotateX(Math.PI / 2 - POLE);
  axis.translate(0, CENTRE, 0);
  brassParts.push({ geometry: axis, color: BRASS });
  for (const end of [1, -1]) {
    // Arrow finials on the axis ends -- the north one longer, because it is the one that
    // means something.
    const len = end > 0 ? 0.62 : 0.44;
    const tip = new THREE.ConeGeometry(0.17, len, 12);
    tip.translate(0, (axisLength / 2 + len / 2) * end * (end > 0 ? 1 : 1), 0);
    if (end < 0) tip.rotateX(Math.PI);
    tip.rotateX(Math.PI / 2 - POLE);
    tip.translate(0, CENTRE, 0);
    brassParts.push({ geometry: tip, color: BRASS });
  }

  // --- The rings -----------------------------------------------------------
  // A TorusGeometry lies in its own XY plane with its axis along +Z, so every ring below is
  // described by where that axis has to point: straight up for the horizon, along the polar
  // axis for the equator, and 23.44 degrees off that for the ecliptic.
  const ring = (r, tube, rot, color, segments = 56) => {
    const t = new THREE.TorusGeometry(r, tube, 9, segments);
    if (rot) {
      if (rot[0]) t.rotateX(rot[0]);
      if (rot[1]) t.rotateY(rot[1]);
      if (rot[2]) t.rotateZ(rot[2]);
    }
    t.translate(0, CENTRE, 0);
    brassParts.push({ geometry: t, color });
  };

  // Horizon (level), with a raised outer kerb so it reads as a graduated plate edge-on.
  ring(R * 1.12, 0.10, [Math.PI / 2, 0, 0], BRASS_DARK);
  // Meridian: upright, in the plane containing the polar axis and the vertical.
  ring(R * 1.06, 0.095, [0, Math.PI / 2, 0], BRASS_DARK);
  // Prime vertical: upright and at right angles to the meridian.
  ring(R * 1.04, 0.07, null, BRASS_DARK);
  // Celestial equator: perpendicular to the polar axis.
  //
  // A torus's own axis is +Z, and rotateX(t) swings that axis to (0, -sin t, cos t). The
  // polar axis points north at altitude POLE, i.e. (0, sin POLE, cos POLE) with north as
  // +Z -- so rotateX(-POLE) is what puts a ring's plane square across it. That single line
  // is the instrument: get it wrong and every coordinate on the sphere is wrong together.
  ring(R, 0.085, [-POLE, 0, 0], BRASS);
  // Ecliptic: 23.44 degrees off the equator. The one ring that is not a coordinate grid --
  // it is the Sun's own path, and it is why the zodiac exists.
  ring(R * 0.995, 0.075, [-POLE - TILT, 0, 0], 0xe8c069);
  // Tropics, as small circles on the sphere: radius R*cos(23.44), pushed along the polar
  // axis by R*sin(23.44). These are what a student is looking at when they are told the Sun
  // "reaches the Tropic of Cancer" -- the highest circle it ever gets to.
  const along = (d) => [0, CENTRE + d * Math.sin(POLE), d * Math.cos(POLE)];
  for (const side of [1, -1]) {
    const small = new THREE.TorusGeometry(R * Math.cos(TILT), 0.05, 7, 44);
    small.rotateX(-POLE);
    small.translate(...along(R * Math.sin(TILT) * side));
    brassParts.push({ geometry: small, color: 0xb98f38 });
  }
  // Arctic/antarctic circles, tighter still, in a darker brass so the sphere has depth
  // rather than five identical hoops.
  for (const side of [1, -1]) {
    const polarCircle = new THREE.TorusGeometry(R * Math.sin(TILT), 0.042, 7, 32);
    polarCircle.rotateX(-POLE);
    polarCircle.translate(...along(R * Math.cos(TILT) * side));
    brassParts.push({ geometry: polarCircle, color: 0x8f6c28 });
  }

  // Degree studs round the equator: 24 small beads, one per hour of right ascension. Cheap,
  // and they are what stops a plain torus reading as a bicycle rim.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const stud = ball(i % 6 === 0 ? 0.115 : 0.075, 8);
    stud.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
    stud.rotateX(-POLE);
    stud.translate(0, CENTRE, 0);
    brassParts.push({ geometry: stud, color: i % 6 === 0 ? 0xf0d28c : BRASS });
  }

  g.add(mergedMesh(brassParts, {
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0.78,
    // Brass in a dark world needs help: with one weak moon for a light source a metal
    // surface has almost nothing to reflect, and there is no environment map anywhere in
    // this app. A little self-illumination is what keeps the rings visible as brass rather
    // than as black wire.
    emissive: 0x2a1c06,
    emissiveIntensity: 0.9,
    ...relief('metal', { seed: seed + 3, repeat: 4 }),
  }));

  // --- The zodiac band ----------------------------------------------------
  // An open cylinder wrapped on the ecliptic, carrying the twelve signs. Wrapped texture,
  // so it must tile once round exactly -- twelve equal sectors do that by construction.
  // NAMES, engraved, and NOT the astrological sign characters (U+2648 and up). Those are
  // emoji-presentation codepoints: a browser draws them from a COLOUR emoji font, which ignores
  // fillStyle entirely, so twelve engraved brass sectors came out as twelve purple stickers on
  // the hero model of the world. Anything drawn on a canvas texture in this project has to be
  // ordinary text or drawn geometry.
  const ZODIAC = [
    'ARIES', 'TAURUS', 'GEMINI', 'CANCER', 'LEO', 'VIRGO',
    'LIBRA', 'SCORPIO', 'SAGITTARIUS', 'CAPRICORN', 'AQUARIUS', 'PISCES',
  ];
  const bandTexture = canvasTexture(1536, 128, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#5f4413');
    grad.addColorStop(0.45, '#d4aa52');
    grad.addColorStop(1, '#6b4d16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const step = w / 12;
    ctx.textAlign = 'center';
    for (let i = 0; i < 12; i++) {
      const x = step * (i + 0.5);
      ctx.strokeStyle = 'rgba(52,34,6,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(step * i, 0);
      ctx.lineTo(step * i, h);
      ctx.stroke();
      // Three engraved stars per sector -- a constellation figure at this size is a smudge, and
      // a few dots is what an engraver would actually cut.
      ctx.fillStyle = 'rgba(46,32,7,0.9)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(x + (k - 1) * step * 0.16, 34 + (k % 2) * 12, 5.5 - k, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#2e2007';
      ctx.font = `bold ${ZODIAC[i].length > 8 ? 26 : 34}px Georgia, "Times New Roman", serif`;
      ctx.fillText(ZODIAC[i], x, 96);
    }
    ctx.textAlign = 'left';
  });
  // R * 0.94, NOT R * 0.995. At 0.995 this cylinder is exactly coplanar with the ecliptic
  // torus above -- same radius, same plane -- and the two z-fight along their whole
  // intersection, which renders as a shimmering violet stripe rather than as a band under a
  // ring. Tucking the band inside the ring is also what it looks like on the real instrument:
  // the ring is the structure and the band is the plate it carries.
  const bandGeom = new THREE.CylinderGeometry(R * 0.94, R * 0.94, 0.62, 64, 1, true);
  const band = mesh(bandGeom, standard({
    map: bandTexture,
    side: THREE.DoubleSide,
    roughness: 0.42,
    metalness: 0.6,
    emissive: 0xffffff,
    emissiveMap: bandTexture,
    emissiveIntensity: 0.34,
  }));
  // The band's own axis is Y, not Z, so its angle is the ring's plus a right angle: an
  // Object3D rotated about X by t carries its +Y to (0, cos t, sin t), and the ecliptic pole
  // is the polar axis tipped by 23.44 degrees.
  band.rotation.x = Math.PI / 2 - POLE - TILT;
  band.position.set(0, CENTRE, 0);
  g.add(band);

  // A brass bead riding the ecliptic: the Sun's own place on the band today.
  const sunBead = mesh(ball(0.24, 12), standard({
    color: 0xffd98a, emissive: 0xffb43c, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4,
  }));
  {
    const a = 1.05;
    const v = new THREE.Vector3(Math.cos(a) * R * 0.97, 0, Math.sin(a) * R * 0.97);
    v.applyAxisAngle(new THREE.Vector3(1, 0, 0), band.rotation.x);
    sunBead.position.set(v.x, CENTRE + v.y, v.z);
  }
  sunBead.castShadow = false;
  g.add(sunBead);

  // --- The Earth at the centre --------------------------------------------
  // Geocentric, which is not a mistake: an armillary sphere is drawn from the point of view
  // of somebody standing on the ground, and every coordinate on it -- horizon, meridian,
  // altitude -- is measured from there.
  const earthTexture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1b4a86';
    ctx.fillRect(0, 0, w, h);
    // Continents as soft overlapping blobs. At a ten-inch globe nobody is checking the
    // coastline of Chile; what has to read is "blue with green on it".
    const land = (x, y, rx, ry, color, alpha = 1) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(w * x, h * y, w * rx, h * ry, randomIn(rng, -0.4, 0.4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    for (const [x, y, rx, ry] of [
      [0.20, 0.34, 0.075, 0.19], [0.24, 0.62, 0.045, 0.17],
      [0.50, 0.36, 0.055, 0.13], [0.55, 0.62, 0.06, 0.21],
      [0.74, 0.34, 0.12, 0.17], [0.83, 0.72, 0.045, 0.09],
      [0.10, 0.20, 0.09, 0.07],
    ]) {
      land(x, y, rx, ry, '#3f7a3a');
      land(x + 0.02, y - 0.04, rx * 0.6, ry * 0.5, '#6a8f45', 0.7);
    }
    land(0.5, 0.03, 0.55, 0.05, '#eef3fa');
    land(0.5, 0.97, 0.55, 0.06, '#eef3fa');
    for (let i = 0; i < 16; i++) {
      land(randomIn(rng, 0, 1), randomIn(rng, 0.15, 0.85), randomIn(rng, 0.04, 0.1), randomIn(rng, 0.03, 0.07), '#ffffff', 0.22);
    }
  });
  const earth = mesh(new THREE.SphereGeometry(R * 0.23, 32, 20), standard({
    map: earthTexture, roughness: 0.85, emissive: 0x0a1830, emissiveIntensity: 0.8,
  }), 0, CENTRE, 0);
  earth.rotation.z = 0.41; // the tilt that makes the ecliptic ring mean something
  g.add(earth);

  // --- Cardinal plate on the horizon ring ---------------------------------
  const cardinals = canvasTexture(1024, 64, (ctx, w, h) => {
    ctx.fillStyle = '#5e441a';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    for (let i = 0; i < 72; i++) {
      const x = (i / 72) * w;
      ctx.fillStyle = i % 18 === 0 ? '#ffe8b0' : 'rgba(255,232,176,0.45)';
      ctx.fillRect(x, i % 18 === 0 ? 6 : h * 0.55, 2.5, i % 18 === 0 ? h - 12 : h * 0.3);
    }
    ctx.fillStyle = '#ffeec4';
    ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    ['N', 'E', 'S', 'W'].forEach((c, i) => ctx.fillText(c, w * (i / 4 + 0.125), h * 0.62));
    ctx.textAlign = 'left';
  });
  const horizonBand = mesh(new THREE.CylinderGeometry(R * 1.17, R * 1.17, 0.34, 64, 1, true), standard({
    map: cardinals, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.55,
    emissive: 0xffffff, emissiveMap: cardinals, emissiveIntensity: 0.3,
  }), 0, CENTRE, 0);
  g.add(horizonBand);

  return g;
}

// ---------------------------------------------------------------------------
// 4. The planisphere -- a star wheel you can watch turning
// ---------------------------------------------------------------------------

// Split into TWO props on purpose, and the split is the teaching point. `skyWheelStand()`
// is the fixed part -- the pedestal, the date scale round the rim and the brass index that
// says "now" -- and `skyWheelDisc()` is the sky itself, which turns. So a student watching
// them sees the one thing a planisphere exists to show: the sky moves and the ground does
// not. It is the same arrangement the observatory dome uses over its fixed drum, for the
// same reason.
export function skyWheelStand({ radius = 4.2, height = 3.3, seed = 51 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(1.5, 1.9, 0.28, 20), position: [0, 0.14, 0], color: 0x33373d });
  parts.push({ geometry: new THREE.CylinderGeometry(0.42, 0.55, height - 0.5, 16), position: [0, (height - 0.5) / 2 + 0.28, 0], color: IRON });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const brace = new THREE.BoxGeometry(0.16, 1.5, 0.5);
    brace.rotateX(0.5);
    brace.translate(Math.cos(a) * 0.75, 0.95, Math.sin(a) * 0.75);
    brace.rotateY(a);
    parts.push({ geometry: brace, color: IRON });
  }
  // The table the disc sits on, a shade smaller than the disc so the rim scale shows.
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 0.82, radius * 0.82, 0.18, 40), position: [0, height - 0.09, 0], color: 0x3c4149 });
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.45, ...relief('metal', { seed, repeat: 3 }) }));

  // The fixed rim: months and dates, because the wheel is set by lining a date up against
  // an hour.
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const rimTexture = canvasTexture(2048, 128, (ctx, w, h) => {
    ctx.fillStyle = '#20252d';
    ctx.fillRect(0, 0, w, h);
    const step = w / 12;
    ctx.textAlign = 'center';
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = '#c8a45a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(step * i, 0);
      ctx.lineTo(step * i, h);
      ctx.stroke();
      for (let d = 1; d < 6; d++) {
        ctx.fillStyle = 'rgba(200,164,90,0.55)';
        ctx.fillRect(step * i + (step / 6) * d, h * 0.6, 2, h * 0.4);
      }
      ctx.fillStyle = '#f0e0bc';
      ctx.font = 'bold 46px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(MONTHS[i], step * (i + 0.5), h * 0.46);
    }
    ctx.textAlign = 'left';
  });
  const rim = mesh(new THREE.CylinderGeometry(radius * 1.06, radius * 1.06, 0.5, 64, 1, true), standard({
    map: rimTexture, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.4,
    emissive: 0xffffff, emissiveMap: rimTexture, emissiveIntensity: 0.42,
  }), 0, height + 0.08, 0);
  g.add(rim);

  // The brass index arm, over the top of where the disc will sit. It points at one date,
  // and it never moves -- which is what makes the disc's turning legible at all.
  const arm = [];
  arm.push({ geometry: new THREE.BoxGeometry(0.3, 0.09, radius * 1.3), position: [0, height + 0.52, radius * 0.5], color: BRASS });
  arm.push({ geometry: new THREE.ConeGeometry(0.24, 0.6, 4), rotation: [Math.PI / 2, 0, 0], position: [0, height + 0.52, radius * 1.18], color: 0xf2d894 });
  arm.push({ geometry: new THREE.CylinderGeometry(0.36, 0.4, 0.32, 16), position: [0, height + 0.46, 0], color: BRASS_DARK });
  const armMesh = mergedMesh(arm, { roughness: 0.35, metalness: 0.75, emissive: 0x2a1c06, emissiveIntensity: 1.0 });
  g.add(armMesh);

  return g;
}

// The turning disc: a real northern-sky map, drawn from the same CONSTELLATIONS table the
// boards use, with Polaris at the centre and the hours round the rim.
export function skyWheelDisc({ radius = 4.2, seed = 52 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  // Which figures go on the wheel, and where. Each is placed at a bearing round the pole
  // and a distance out from it, with its own rotation -- which is genuinely how they sit:
  // everything in the northern sky wheels round Polaris, so a chart of it is polar.
  const PLACED = [
    { figure: 'ursaMajor', angle: 0.55, dist: 0.30, rot: -0.7, scale: 0.30 },
    { figure: 'cassiopeia', angle: 3.55, dist: 0.30, rot: 2.6, scale: 0.26 },
    { figure: 'cygnus', angle: 2.30, dist: 0.55, rot: 1.5, scale: 0.24 },
    { figure: 'leo', angle: 5.60, dist: 0.60, rot: 0.4, scale: 0.24 },
    { figure: 'orion', angle: 4.55, dist: 0.80, rot: 2.9, scale: 0.22 },
    { figure: 'taurus', angle: 4.05, dist: 0.72, rot: 2.4, scale: 0.20 },
  ];

  const S = 1024;
  const texture = canvasTexture(S, S, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.46;

    ctx.fillStyle = '#1a2436';
    ctx.fillRect(0, 0, w, h);
    // Lighter than the boards' star fields, and deliberately: this is a printed card being read
    // by torchlight from four feet above it, not a window on the sky. At the boards' near-black
    // the whole disc read as an empty dark plate with a month scale round it.
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, '#1d2f4e');
    grad.addColorStop(1, '#111c31');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // Background dust.
    for (let i = 0; i < 900; i++) {
      const a = randomIn(rng, 0, Math.PI * 2);
      const d = Math.sqrt(rng()) * R;
      ctx.globalAlpha = randomIn(rng, 0.25, 0.8);
      ctx.fillStyle = i % 9 === 0 ? '#ffd6a8' : '#e6eeff';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, randomIn(rng, 0.7, 2.0), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The Milky Way, as a soft band across the chart.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.9);
    for (let i = -6; i <= 6; i++) {
      canvasGlow(ctx, i * R * 0.14, Math.sin(i * 0.5) * R * 0.1, R * 0.2, '#8fa8d8', 0.09, 0.7);
    }
    ctx.restore();

    // Declination circles, and the hour spokes.
    for (const frac of [0.33, 0.66, 1.0]) {
      ctx.strokeStyle = frac === 1 ? 'rgba(214,178,102,0.95)' : 'rgba(150,180,222,0.42)';
      ctx.lineWidth = frac === 1 ? 4 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, R * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(150,180,222,0.30)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx + Math.cos(a) * R * 0.945, cy + Math.sin(a) * R * 0.945);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = 'rgba(240,224,188,0.85)';
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${i}h`, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';

    // The figures.
    for (const p of PLACED) {
      const data = CONSTELLATIONS[p.figure];
      const px = cx + Math.cos(p.angle) * R * p.dist;
      const py = cy + Math.sin(p.angle) * R * p.dist;
      const unit = R * p.scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(p.rot);

      ctx.strokeStyle = 'rgba(176,206,244,0.8)';
      ctx.lineWidth = 3.0;
      for (const [i, j] of data.lines) {
        ctx.beginPath();
        ctx.moveTo(data.stars[i].x * unit, -data.stars[i].y * unit);
        ctx.lineTo(data.stars[j].x * unit, -data.stars[j].y * unit);
        ctx.stroke();
      }
      for (const star of data.stars) {
        const r = Math.max(2.2, unit * starScale(star.mag) * 1.35);
        const hex = `#${new THREE.Color(STAR_COLORS[star.spec] ?? STAR_COLORS.A).getHexString()}`;
        canvasGlow(ctx, star.x * unit, -star.y * unit, r * 4.5, hex, 0.34);
        ctx.globalAlpha = 1;
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.arc(star.x * unit, -star.y * unit, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Names drawn UPRIGHT, not rotated with the figure -- a chart whose labels have to be
      // read upside down is a chart nobody reads.
      ctx.fillStyle = 'rgba(224,236,255,0.95)';
      ctx.font = 'bold 25px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data.name, px, py + unit * 1.28);
      ctx.textAlign = 'left';
    }

    // Polaris, and the pole.
    canvasGlow(ctx, cx, cy, 34, '#fff2d8', 0.75);
    ctx.fillStyle = '#fff8ec';
    ctx.beginPath();
    ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,226,160,0.95)';
    ctx.font = 'bold 25px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('POLARIS', cx + 16, cy - 12);
    ctx.fillStyle = 'rgba(255,226,160,0.6)';
    ctx.font = 'italic 19px Georgia, "Times New Roman", serif';
    ctx.fillText('the sky turns round here', cx + 16, cy + 14);
  });

  // A disc, not a plane: it is seen edge-on as a student walks past, and a zero-thickness
  // map floating over a table reads as a rendering error.
  const disc = mesh(new THREE.CylinderGeometry(radius, radius, 0.16, 64), standard({
    map: texture,
    roughness: 0.7,
    emissive: 0xffffff,
    emissiveMap: texture,
    // Bright: this is a printed chart being read in the dark, which is exactly what a real
    // planisphere is used for.
    emissiveIntensity: 0.85,
  }));
  disc.material.side = THREE.FrontSide;
  g.add(disc);
  // The rim, so the edge is metal rather than a smear of the map.
  g.add(mergedMesh([
    { geometry: new THREE.CylinderGeometry(radius * 1.012, radius * 1.012, 0.2, 64, 1, true), color: 0x4a4f57 },
  ], { roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
  return g;
}

// ---------------------------------------------------------------------------
// 5. Star colours -- the exhibit that explains everything else on this field
// ---------------------------------------------------------------------------

// Seven glowing globes in a row on a stone bench: the spectral sequence, O through M, with
// each one's real surface temperature and an example star a student can go and find on one
// of the boards.
//
// The sizes are the real relative diameters, compressed. That compression is honest and
// necessary: an O star is over a hundred times the width of an M dwarf, so at true scale
// either the red end is invisible or the blue end is the size of a house.
export function spectralRow({ length = 14, seed = 61 } = {}) {
  const g = group();
  const CLASSES = [
    { c: 'O', temp: '30,000 °C', example: 'Alnitak, in Orion’s belt', rel: 1.00, spec: 'O' },
    { c: 'B', temp: '15,000 °C', example: 'Rigel · Spica · Regulus', rel: 0.72, spec: 'B' },
    { c: 'A', temp: '9,000 °C', example: 'Sirius · Vega · Deneb', rel: 0.50, spec: 'A' },
    { c: 'F', temp: '7,000 °C', example: 'Procyon · Polaris', rel: 0.40, spec: 'F' },
    { c: 'G', temp: '5,500 °C', example: 'THE SUN · Alpha Centauri A', rel: 0.34, spec: 'G' },
    { c: 'K', temp: '4,000 °C', example: 'Aldebaran · Arcturus', rel: 0.29, spec: 'K' },
    { c: 'M', temp: '3,000 °C', example: 'Betelgeuse · Antares · Proxima', rel: 0.23, spec: 'M' },
  ];

  const plinth = [];
  plinth.push({ geometry: new THREE.BoxGeometry(length, 0.5, 2.6), position: [0, 0.25, 0], color: 0x60605a });
  plinth.push({ geometry: new THREE.BoxGeometry(length - 0.7, 0.85, 2.2), position: [0, 0.9, 0], color: STONE });
  plinth.push({ geometry: new THREE.BoxGeometry(length, 0.22, 2.5), position: [0, 1.42, 0], color: 0x8a8578 });
  g.add(mergedMesh(plinth, { roughness: 0.95, ...relief('stone', { seed, repeat: 4 }) }));

  const cores = [];
  const halos = [];
  const stems = [];
  const step = (length - 2.4) / (CLASSES.length - 1);
  const startX = -(length - 2.4) / 2;

  CLASSES.forEach((cl, i) => {
    const x = startX + step * i;
    const r = 0.16 + 0.34 * Math.pow(cl.rel, 0.75);
    const y = 1.53 + 0.55 + r;
    stems.push({ geometry: new THREE.CylinderGeometry(0.055, 0.075, 0.6, 8), position: [x, 1.53 + 0.3, 0], color: BRASS_DARK });
    pushStar(cores, halos, { x, y, radius: r, color: STAR_COLORS[cl.spec], halo: 2.6, detail: 20 });
  });

  g.add(mergedMesh(stems, { roughness: 0.4, metalness: 0.7, emissive: 0x2a1c06, emissiveIntensity: 0.8 }));
  g.add(glowMesh(cores, coreMaterial(), 3));
  g.add(glowMesh(halos, haloMaterial(0.85), 4));

  // The label strip along the front face of the plinth. One canvas for all seven, so the
  // columns line up with the globes above them by construction.
  const strip = canvasTexture(2048, 300, (ctx, w, h) => {
    ctx.fillStyle = '#141a24';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6f9bd1';
    ctx.fillRect(0, 0, w, 62);
    ctx.fillStyle = '#0b1220';
    ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('A STAR’S COLOUR IS ITS TEMPERATURE  ·  BLUE IS HOTTEST, RED IS COOLEST', 24, 46);
    const cell = w / CLASSES.length;
    ctx.textAlign = 'center';
    CLASSES.forEach((cl, i) => {
      const x = cell * (i + 0.5);
      if (i) {
        ctx.strokeStyle = 'rgba(140,172,214,0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cell * i, 74);
        ctx.lineTo(cell * i, h - 12);
        ctx.stroke();
      }
      ctx.fillStyle = `#${new THREE.Color(STAR_COLORS[cl.spec]).getHexString()}`;
      ctx.font = 'bold 84px Georgia, "Times New Roman", serif';
      ctx.fillText(cl.c, x, 168);
      ctx.fillStyle = '#e6edfa';
      ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(cl.temp, x, 216);
      ctx.fillStyle = '#9fb3d2';
      ctx.font = '25px "Helvetica Neue", Arial, sans-serif';
      const words = cl.example.split(' · ');
      words.forEach((word, k) => ctx.fillText(word, x, 254 + k * 28));
    });
    ctx.textAlign = 'left';
  });
  const face = signPanel(length - 0.9, (length - 0.9) * (300 / 2048), strip, { emissive: '#ffffff', emissiveIntensity: 0.8 });
  face.position.set(0, 0.95, 1.13);
  g.add(face);

  return g;
}

// ---------------------------------------------------------------------------
// 6. The Polaris sight
// ---------------------------------------------------------------------------

// A fixed iron sighting tube aimed at the north celestial pole, with the one number that
// makes it work engraved on the post: the pole's height above your horizon IS your
// latitude. Look through it and Polaris is in the middle; that is the whole exhibit.
//
// `altitude` is that angle in degrees, and the layout must aim the prop's +Z at wherever
// this world has hung Polaris -- the two numbers have to agree or the tube points at empty
// sky, which would teach exactly the wrong thing.
export function polarisSight({ altitude = 39, height = 4.4, seed = 71 } = {}) {
  const g = group();
  const parts = [];
  const rad = THREE.MathUtils.degToRad(altitude);

  parts.push({ geometry: new THREE.CylinderGeometry(1.05, 1.2, 0.3, 20), position: [0, 0.15, 0], color: 0x2b2e33 });
  parts.push({ geometry: new THREE.CylinderGeometry(0.26, 0.34, height, 16), position: [0, height / 2 + 0.2, 0], color: IRON });
  // A yoke, so the tube is carried rather than growing out of the post.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.16, 1.0, 0.5),
      position: [side * 0.44, height + 0.55, 0],
      color: 0x3c4149,
    });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(0.5, 0.5, 1.05, 16), rotation: [0, 0, Math.PI / 2], position: [0, height + 0.25, 0], color: 0x3c4149 });

  const TUBE_LEN = 3.4;
  const TUBE_Y = height + 0.95;
  // The tube, tipped up by the altitude and lying along the prop's own +Z.
  const tube = new THREE.CylinderGeometry(0.3, 0.3, TUBE_LEN, 20, 1, true);
  tube.rotateX(Math.PI / 2 - rad);
  tube.translate(0, TUBE_Y, 0);
  parts.push({ geometry: tube, color: 0x22252a });
  // Sight rings at both ends: a wide rear peep and a narrow front ring, which is what makes
  // an iron pipe read as something you aim.
  for (const [t, r] of [[-0.5, 0.42], [0.5, 0.36]]) {
    const ringGeom = new THREE.TorusGeometry(r, 0.055, 7, 20);
    ringGeom.rotateX(-rad);
    ringGeom.translate(0, TUBE_Y + Math.sin(rad) * TUBE_LEN * t, Math.cos(rad) * TUBE_LEN * t);
    parts.push({ geometry: ringGeom, color: BRASS_DARK });
  }
  // Crosshairs in the front ring.
  for (const rot of [0, Math.PI / 2]) {
    const hair = new THREE.CylinderGeometry(0.015, 0.015, 0.68, 5);
    hair.rotateZ(Math.PI / 2 + rot);
    hair.rotateX(-rad);
    hair.translate(0, TUBE_Y + Math.sin(rad) * TUBE_LEN * 0.5, Math.cos(rad) * TUBE_LEN * 0.5);
    parts.push({ geometry: hair, color: BRASS });
  }
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.5, ...relief('metal', { seed, repeat: 3 }) }));

  // The engraved plate on the post.
  const plate = canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#1c2028';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c8a45a';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#ffe2a0';
    ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('SIGHT ON POLARIS', 30, 66);
    ctx.fillStyle = '#dbe5f5';
    ctx.font = '25px Georgia, "Times New Roman", serif';
    wrapText(ctx, 'Look through the tube. The star in the middle is Polaris, and it is the '
      + 'only star that never moves.', 30, 108, w - 60, 32);
    ctx.fillStyle = '#8fb2e0';
    ctx.font = 'bold 27px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(`TUBE ANGLE  ${altitude}°  =  YOUR LATITUDE`, 30, h - 44);
  });
  const faceMesh = signPanel(1.9, 1.19, plate, { emissive: '#ffffff', emissiveIntensity: 0.8 });
  faceMesh.position.set(0, height * 0.62, 0.36);
  faceMesh.rotation.x = -0.24;
  g.add(faceMesh);

  return g;
}

// ---------------------------------------------------------------------------
// 7. Sky atmosphere: the Milky Way, the Moon, a meteor
// ---------------------------------------------------------------------------

// The Milky Way, as three additive quads leaning the same way.
//
// Additive with `fog: false`, and both halves are deliberate for the reason Under the Sea's
// light shafts document: three.js fogs a fragment BEFORE blending it, so a fogged additive
// fragment adds the fog colour onto a background that is already the fog colour and the far
// end turns into a bright wall.
//
// It is a BAND rather than a blob, and it has dust lanes cut through it. The galaxy's dark
// rifts are as recognisable as its glow -- a smooth luminous smear reads as a lens flare.
// `tilt` leans the whole band back over the observer's head, and without it this prop is
// useless: three upright quads hung in the sky are a WALL across the horizon, not a band
// across the sky. The galaxy passes near the zenith from most latitudes, so the band has to
// be closer to a ceiling than to a backdrop.
export function milkyWay({ length = 460, width = 110, tilt = 1.1, opacity = 0.6, seed = 81 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // The glow: overlapping soft patches along the middle, thickening toward one end where
    // the galactic centre is.
    for (let i = 0; i < 90; i++) {
      const t = i / 89;
      const x = t * w;
      const bulge = 0.55 + 0.45 * Math.exp(-Math.pow((t - 0.34) / 0.22, 2));
      const y = h / 2 + Math.sin(t * 5.2) * h * 0.07;
      canvasGlow(ctx, x, y, h * 0.34 * bulge, '#9db4e8', 0.16, 0.62);
      canvasGlow(ctx, x, y, h * 0.17 * bulge, '#cdd9f5', 0.13, 0.5);
    }
    // Star clouds.
    for (let i = 0; i < 26; i++) {
      canvasGlow(ctx, randomIn(rng, 0, w), h / 2 + randomIn(rng, -h * 0.16, h * 0.16),
        randomIn(rng, h * 0.05, h * 0.14), i % 3 ? '#e6ecfb' : '#f6e2c8', randomIn(rng, 0.1, 0.2));
    }
    // Dust lanes, punched out.
    // Dust lanes, punched out. Kept FAINT: at the first pass's strength they read as holes
    // burned in a sheet rather than as dark clouds in front of a glow, which is the difference
    // between the Milky Way and a smoke trail.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 14; i++) {
      const x = randomIn(rng, 0, w);
      const y = h / 2 + randomIn(rng, -h * 0.09, h * 0.09);
      canvasGlow(ctx, x, y, randomIn(rng, h * 0.08, h * 0.22), 'rgba(0,0,0,1)', randomIn(rng, 0.18, 0.34), randomIn(rng, 0.25, 0.45));
    }
    ctx.globalCompositeOperation = 'source-over';
    // Resolved stars on top of the glow.
    for (let i = 0; i < 500; i++) {
      const y = h / 2 + randomIn(rng, -h * 0.4, h * 0.4);
      ctx.globalAlpha = randomIn(rng, 0.15, 0.7);
      ctx.fillStyle = i % 8 === 0 ? '#ffd9b0' : '#e8eeff';
      ctx.beginPath();
      ctx.arc(randomIn(rng, 0, w), y, randomIn(rng, 0.6, 1.7), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Fade the two ENDS of the sheet to nothing. The band has to arrive from below one horizon
    // and leave under the other; a luminous rectangle that simply stops in mid-sky is the one
    // thing that gives it away as three quads.
    ctx.globalCompositeOperation = 'destination-out';
    for (const [x0, x1] of [[0, w * 0.14], [w, w * 0.86]]) {
      const fade = ctx.createLinearGradient(x0, 0, x1, 0);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
    }
    ctx.globalCompositeOperation = 'source-over';
  });

  const g = group();
  const inner = group();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  // Three panels in a shallow arc, so the band bends across the sky instead of hanging there as
  // one flat billboard.
  //
  // EACH PANEL SHOWS ONE THIRD OF THE TEXTURE, not a copy of the whole of it, and that is what
  // fixes the thing that made the first version read as a smoke trail: the sheet is faded to
  // nothing at u = 0 and u = 1, so with three copies every panel ended abruptly at full
  // brightness and the band had two hard diagonal cuts across the sky and a seam at each join.
  // Remapping the UVs puts the fade only where the band actually ends.
  const seg = length / 3;
  for (let i = -1; i <= 1; i++) {
    const plane = new THREE.PlaneGeometry(seg, width);
    const uv = plane.attributes.uv;
    for (let k = 0; k < uv.count; k++) {
      uv.setX(k, (uv.getX(k) + (i + 1)) / 3);
    }
    uv.needsUpdate = true;
    const quad = mesh(plane, material, i * seg * 0.99, -Math.abs(i) * width * 0.16, -Math.abs(i) * seg * 0.13);
    quad.rotation.y = -i * 0.42;
    quad.rotation.z = -i * 0.10;
    quad.castShadow = false;
    quad.receiveShadow = false;
    quad.renderOrder = 1;
    inner.add(quad);
  }
  inner.rotation.x = tilt;
  g.add(inner);
  return g;
}

// A waxing gibbous Moon, big enough to be a thing rather than a dot.
//
// SELF-LIT, not lit by the scene. In this world the directional light IS moonlight, so the
// Moon is the source and cannot be the thing being lit -- and the phase is painted into the
// texture as a terminator, which is the only way to get a phase that does not depend on
// where the layout happens to hang it.
export function moonInSky({ radius = 16, seed = 91 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c9c6bd';
    ctx.fillRect(0, 0, w, h);

    const patch = (x, y, rx, ry, color, alpha, rot = 0) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // The maria, placed rather than scattered -- the dark patches are the whole reason a
    // grey ball is recognisable as the Moon, and everybody has been looking at this exact
    // arrangement their whole life.
    const MARIA = [
      [0.30, 0.28, 0.085, 0.115], [0.40, 0.22, 0.055, 0.070],
      [0.44, 0.38, 0.075, 0.095], [0.36, 0.46, 0.055, 0.060],
      [0.53, 0.30, 0.050, 0.075], [0.25, 0.44, 0.045, 0.055],
      [0.56, 0.47, 0.038, 0.048], [0.20, 0.35, 0.040, 0.052],
    ];
    for (const [mx, my, mrx, mry] of MARIA) {
      for (let k = 0; k < 4; k++) {
        patch(w * mx + randomIn(rng, -w * mrx * 0.5, w * mrx * 0.5),
          h * my + randomIn(rng, -h * mry * 0.4, h * mry * 0.4),
          w * mrx * randomIn(rng, 0.55, 1.0), h * mry * randomIn(rng, 0.6, 1.0),
          k === 0 ? '#8d8a84' : '#918e88', randomIn(rng, 0.5, 0.8), randomIn(rng, 0, Math.PI));
      }
    }

    // Craters. Faint, mostly darker than the ground, with a pale rim on only the biggest
    // few -- the lesson marsGlobe paid for: bright rings everywhere turn a planet into a
    // sheet of soap bubbles.
    for (let i = 0; i < 420; i++) {
      const r = randomIn(rng, 1.5, h * 0.022);
      const x = randomIn(rng, 0, w);
      const y = randomIn(rng, h * 0.05, h * 0.95);
      patch(x, y, r * randomIn(rng, 1, 1.35), r, '#a8a49b', randomIn(rng, 0.2, 0.45));
      if (r > h * 0.014) {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = '#e2ded4';
        ctx.lineWidth = Math.max(1, r * 0.16);
        ctx.beginPath();
        ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Tycho's rays: the one bright feature the Moon really does have, and it is unmistakable.
    const tx = w * 0.35;
    const ty = h * 0.78;
    patch(tx, ty, h * 0.028, h * 0.026, '#eae6dc', 0.85);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.3;
      const len = randomIn(rng, h * 0.08, h * 0.30);
      ctx.save();
      ctx.globalAlpha = randomIn(rng, 0.10, 0.24);
      ctx.strokeStyle = '#f0ece2';
      ctx.lineWidth = randomIn(rng, 1.5, 5);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + Math.cos(a) * len, ty + Math.sin(a) * len * 0.8);
      ctx.stroke();
      ctx.restore();
    }

    // Grain, for the same reason marsGlobe needs it: everything above is smooth gradients,
    // which is the worst possible input to the JPEG a gallery screenshot becomes.
    const grain = ctx.getImageData(0, 0, w, h);
    const px = grain.data;
    for (let i = 0; i < px.length; i += 4) {
      const n = (rng() - 0.5) * 13;
      px[i] += n; px[i + 1] += n; px[i + 2] += n * 0.9;
    }
    ctx.putImageData(grain, 0, 0);

    // Limb darkening, so the disc reads as a sphere rather than as a printed circle.
    const limb = ctx.createLinearGradient(0, 0, 0, h);
    limb.addColorStop(0, 'rgba(10,12,20,0.5)');
    limb.addColorStop(0.2, 'rgba(10,12,20,0)');
    limb.addColorStop(0.8, 'rgba(10,12,20,0)');
    limb.addColorStop(1, 'rgba(10,12,20,0.5)');
    ctx.fillStyle = limb;
    ctx.fillRect(0, 0, w, h);

    // NO TERMINATOR. This Moon is FULL, and that is a decision rather than an omission.
    //
    // A phase was tried twice and both attempts failed for the same underlying reason: a phase
    // is a range of LONGITUDES on the sphere, so which part of it faces the camera depends
    // entirely on where the layout hung the Moon and which way the prop happens to be turned --
    // and every angle that was not the intended one produced a bright ball with a dark bite
    // taken out of its bottom corner. Painting the dark side near-black made it a hole in the
    // sky; erasing its alpha instead made it a hole in the sky wherever the sky was dark, which
    // is most of both these worlds.
    //
    // A full Moon has none of that: it reads correctly from every angle, it is the brightest and
    // best-looking version, and it is astronomically right for both worlds it appears in -- a
    // full Moon rises as the Sun sets, which is exactly the hour the observatory is set at.
  });

  const g = group();
  const moon = mesh(new THREE.SphereGeometry(radius, 48, 32), new THREE.MeshBasicMaterial({
    map: texture, fog: false, toneMapped: false,
  }));
  moon.castShadow = false;
  moon.receiveShadow = false;
  // Turned so the lit limb faces the world's sun direction, and tipped a little so the
  // maria sit on the face rather than round the side.
  moon.rotation.y = -0.5;
  moon.rotation.z = 0.18;
  g.add(moon);
  // No halo shell. A `BackSide` additive sphere was tried for bloom and it renders as a
  // hard-edged ring, for the same reason a MeshBasicMaterial sphere is a flat disc: the material
  // is unlit, so every pixel of the shell is the same value and its silhouette is an edge. The
  // limb darkening painted into the texture is what makes this read as a sphere instead.
  return g;
}

// A meteor: a bright head with a tapered additive trail behind it.
//
// The trail runs along the prop's own -Z, which matters because this is built to be FLOWN
// by a program: `move forward` and `glide` travel along an object's +Z, so a trail on the
// -Z side is a trail that follows rather than leads.
export function meteor({ length = 26, seed = 101 } = {}) {
  const g = group();
  const trailTexture = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // Bright at the head (right), gone by the tail (left), with a soft vertical falloff so
    // the quad's own edges never show.
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      const a = Math.pow(t, 2.6);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, `rgba(255,${Math.round(238 - 40 * (1 - t))},${Math.round(206 - 90 * (1 - t))},${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 1, h);
    }
  });
  const trailMat = new THREE.MeshBasicMaterial({
    map: trailTexture, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
  });
  // Two crossed quads rather than one, so the streak does not vanish when it is edge-on.
  for (const roll of [0, Math.PI / 2]) {
    const quad = mesh(new THREE.PlaneGeometry(length, length * 0.075), trailMat, 0, 0, -length / 2);
    quad.rotation.y = Math.PI / 2;
    quad.rotation.x = roll;
    quad.castShadow = false;
    quad.receiveShadow = false;
    quad.renderOrder = 3;
    g.add(quad);
  }

  const cores = [];
  const halos = [];
  pushStar(cores, halos, { x: 0, y: 0, z: 0, radius: length * 0.028, color: 0xfff4e0, halo: 3.2, detail: 14 });
  g.add(glowMesh(cores, coreMaterial(), 4), glowMesh(halos, haloMaterial(0.95), 5));
  void seed;
  return g;
}

// ---------------------------------------------------------------------------
// 8. Field furniture
// ---------------------------------------------------------------------------

// The observer's table: a paper chart weighted down at the corners, a red torch, a pair of
// binoculars and a notebook. Small, and entirely about making the field read as a place
// somebody works rather than an exhibition of signs.
export function chartTable({ width = 4.6, seed = 111 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const HEIGHT = 2.9;
  const parts = [];

  // Trestle legs.
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.08, 0.1, HEIGHT * 1.04, 8);
      leg.rotateX(lean * 0.16);
      leg.translate(side * (width / 2 - 0.35), HEIGHT / 2, lean * 0.9);
      parts.push({ geometry: leg, color: 0x4a4136 });
    }
    parts.push({
      geometry: new THREE.BoxGeometry(0.09, 0.09, 1.9),
      position: [side * (width / 2 - 0.35), HEIGHT * 0.42, 0],
      color: 0x4a4136,
    });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.14, 2.6), position: [0, HEIGHT + 0.07, 0], color: 0x6b5334 });
  g.add(mergedMesh(parts, { roughness: 0.85, ...relief('wood', { seed, repeat: 3 }) }));

  // The chart itself: a monthly sky map, lying flat.
  const chart = canvasTexture(768, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f2ead6';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#101a2c';
    ctx.fillRect(28, 66, w - 56, h - 112);
    ctx.fillStyle = '#2a2317';
    ctx.font = 'bold 34px Georgia, "Times New Roman", serif';
    ctx.fillText('TONIGHT’S SKY — LOOKING SOUTH', 30, 48);
    ctx.fillStyle = '#6b5a34';
    ctx.font = 'italic 22px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'right';
    ctx.fillText('9 pm · mid-winter', w - 30, 48);
    ctx.textAlign = 'left';

    const rect = { x: 28, y: 66, w: w - 56, h: h - 112 };
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = randomIn(rng, 0.15, 0.6);
      ctx.fillStyle = '#dde6ff';
      ctx.beginPath();
      ctx.arc(randomIn(rng, rect.x, rect.x + rect.w), randomIn(rng, rect.y, rect.y + rect.h), randomIn(rng, 0.5, 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Orion and Taurus, drawn where they would be at that hour.
    for (const [figure, cx, cy, scale] of [['orion', 0.40, 0.62, 0.30], ['taurus', 0.68, 0.40, 0.24]]) {
      const data = CONSTELLATIONS[figure];
      const unit = rect.h * scale;
      const px = rect.x + rect.w * cx;
      const py = rect.y + rect.h * cy;
      ctx.strokeStyle = 'rgba(150,186,236,0.7)';
      ctx.lineWidth = 2;
      for (const [i, j] of data.lines) {
        ctx.beginPath();
        ctx.moveTo(px + data.stars[i].x * unit, py - data.stars[i].y * unit);
        ctx.lineTo(px + data.stars[j].x * unit, py - data.stars[j].y * unit);
        ctx.stroke();
      }
      for (const star of data.stars) {
        const r = Math.max(1.6, unit * starScale(star.mag) * 1.1);
        ctx.fillStyle = `#${new THREE.Color(STAR_COLORS[star.spec]).getHexString()}`;
        ctx.beginPath();
        ctx.arc(px + star.x * unit, py - star.y * unit, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(210,226,252,0.9)';
      ctx.font = 'bold 20px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(data.name, px, py + unit * 1.2);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#6b5a34';
    ctx.font = '20px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Hold the chart up and turn it until the bottom edge matches the way you are facing.', 30, h - 22);
  });
  const sheet = mesh(new THREE.PlaneGeometry(width * 0.78, width * 0.78 * (512 / 768)), standard({
    map: chart, roughness: 0.95, side: THREE.DoubleSide,
    emissive: 0xffffff, emissiveMap: chart, emissiveIntensity: 0.42,
  }), 0, HEIGHT + 0.15, 0);
  sheet.rotation.x = -Math.PI / 2;
  sheet.rotation.z = 0.06;
  g.add(sheet);

  // A red torch -- the one piece of astronomy equipment nobody expects. Red light does not
  // wreck the dark-adapted eye, so every observer carries one and nobody carries a white one.
  const torch = group();
  const body = cyl(0.11, 0.13, 0.85, standard({ color: 0x2a2d33, roughness: 0.5, metalness: 0.4 }), 0, 0, 0, 12);
  body.rotation.z = Math.PI / 2;
  torch.add(body);
  const lens = mesh(ball(0.12, 10), new THREE.MeshBasicMaterial({ color: 0xff3b2f, fog: false, toneMapped: false }), 0.44, 0, 0);
  lens.castShadow = false;
  torch.add(lens);
  torch.position.set(width * 0.32, HEIGHT + 0.2, -0.75);
  torch.rotation.y = 0.6;
  g.add(torch);

  // Binoculars: the instrument this world should actually be recommending. Two barrels, two
  // eyepieces, a bridge.
  const bino = group();
  const shell = standard({ color: 0x22252b, roughness: 0.55, metalness: 0.3 });
  for (const side of [-1, 1]) {
    const barrel = cyl(0.17, 0.19, 0.7, shell, side * 0.2, 0, 0, 12);
    barrel.rotation.x = Math.PI / 2;
    bino.add(barrel);
    const eye = cyl(0.1, 0.12, 0.22, shell, side * 0.2, 0, -0.44, 10);
    eye.rotation.x = Math.PI / 2;
    bino.add(eye);
    const glass = mesh(new THREE.CircleGeometry(0.15, 14), new THREE.MeshBasicMaterial({
      color: 0x2a4b6b, fog: false, toneMapped: false,
    }), side * 0.2, 0, 0.36);
    glass.castShadow = false;
    bino.add(glass);
  }
  bino.add(box(0.42, 0.16, 0.3, shell, 0, 0, -0.08));
  bino.position.set(-width * 0.3, HEIGHT + 0.28, 0.7);
  bino.rotation.y = -0.4;
  g.add(bino);

  return g;
}

// A red observing lamp. Every light on an observing field is red, and this is the prop that
// says so -- the placard beside it explains why, and the reason (rhodopsin takes half an
// hour to rebuild and red light barely touches it) is a genuinely surprising fact.
export function redLamp({ height = 9, seed = 121 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(0.62, 0.75, 0.35, 16), position: [0, 0.17, 0], color: 0x2b2e33 });
  parts.push({ geometry: new THREE.CylinderGeometry(0.16, 0.24, height, 14), position: [0, height / 2, 0], color: IRON });
  // A deep hood, pointing DOWN. Full cut-off shielding is what an observatory site requires
  // of every light on it, and a hood you can see the shape of is the whole point.
  parts.push({ geometry: new THREE.CylinderGeometry(1.0, 0.5, 0.7, 20, 1, true), position: [0, height + 0.05, 0], color: 0x1f2227 });
  parts.push({ geometry: new THREE.CylinderGeometry(1.02, 1.02, 0.1, 20), position: [0, height + 0.4, 0], color: 0x2b2e33 });
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.45, ...relief('metal', { seed, repeat: 3 }) }));

  const bulb = mesh(ball(0.34, 12), new THREE.MeshBasicMaterial({ color: 0xff3524, fog: false, toneMapped: false }), 0, height - 0.18, 0);
  bulb.castShadow = false;
  g.add(bulb);
  // A real light, deliberately short-range and red. It is the only coloured light source in
  // the world and it is what makes the ground under each lamp read as a pool rather than a
  // painted circle.
  const light = new THREE.PointLight(0xff3a22, 1.5, 22, 2);
  light.position.set(0, height - 0.3, 0);
  light.userData.isLight = true;
  g.add(light);
  return g;
}
