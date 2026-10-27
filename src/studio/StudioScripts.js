import * as THREE from 'three';
import { PRESET_WORLDS } from '../WorldPresets.js';
import { createBlockInstance } from '../BlockDefs.js';
import { createShapeMesh } from '../Primitives.js';
import { PRIMITIVE_SIZE, WORLD_BOUND_RADIUS } from '../config.js';
import { uuid } from '../Uuid.js';
import { ambienceForTheme, styleById } from './StudioAudio.js';
import {
  drawHeadline, drawLowerThird, drawBand, drawStep, drawProgramCard, drawEndCard,
  codeLength, clamp01, smooth, outBack, outCubic, life, BRAND,
} from './StudioOverlay.js';

// The Social Media Studio's DIRECTOR'S NOTES: which worlds it films and from where, the
// models it builds, the programs it writes, and the templates that turn a few choices into
// a timed list of shots ("beats").
//
// A beat is plain data plus five functions, and the Studio calls them in a fixed order:
//
//   setup(S)       once, after the beat's world is built and before its first frame
//   update(S, t)   every frame -- move things (t is seconds into the beat)
//   pose(S, t)     every frame -- where the camera is and what it looks at
//   draw(ctx,L,S,t) every frame -- captions and cards, drawn into the video
//   teardown(S)    once, when the next beat takes over
//
// and `cues`, the sound effects, as times INTO the beat. Cues are fixed when the plan is
// built, from the same timeline functions update() uses, because the soundtrack is
// rendered offline before the first frame exists -- a pop has to be scheduled before the
// shape it belongs to has been made.

// --- formats -----------------------------------------------------------------------------

// fov is VERTICAL, as everywhere in this app. A portrait frame at the app's own 70 is a
// tall narrow slot, so each format picks the field of view that frames a person-height
// subject comfortably at its own aspect.
export const FORMATS = {
  reel: {
    id: 'reel', label: 'Reel / Story', ratio: '9:16', w: 1080, h: 1920, fov: 68, bitrate: 12e6,
    platforms: 'Instagram Reels · Facebook Reels · Stories',
  },
  portrait: {
    id: 'portrait', label: 'Feed portrait', ratio: '4:5', w: 1080, h: 1350, fov: 60, bitrate: 10e6,
    platforms: 'Instagram feed · Facebook feed · LinkedIn',
  },
  square: {
    id: 'square', label: 'Square', ratio: '1:1', w: 1080, h: 1080, fov: 56, bitrate: 9e6,
    platforms: 'LinkedIn · Facebook · Instagram',
  },
  landscape: {
    id: 'landscape', label: 'Landscape', ratio: '16:9', w: 1920, h: 1080, fov: 50, bitrate: 12e6,
    platforms: 'LinkedIn · Facebook · YouTube',
  },
};

// One video for each of the three networks: a Reel for Instagram (and Facebook Reels), the
// 4:5 feed shape Facebook and Instagram both show largest, and a square for LinkedIn.
export const PLATFORM_PACK = ['reel', 'portrait', 'square'];

// --- worlds ------------------------------------------------------------------------------

// The worlds the studio knows how to film. `hero` is a PROP_BUILDERS key -- the camera finds
// that prop in the built world and frames it, rather than trusting coordinates that would
// silently go stale the next time a layout moves something. A world with no hero, or whose
// hero shot is blocked, is filmed from its own arrival frame, which every world in this
// project is composed around.
//
// Every fact is one the world's own notes in CLAUDE.md support. Captions that go out to
// thousands of strangers are the last place to invent a number.
export const STUDIO_WORLDS = [
  {
    key: 'dinosaur', label: 'Dinosaur Island', hero: 'tyrannosaurus', move: 'orbit',
    fact: 'Walk right up to a 41-foot T. rex',
    facts: ['A T. rex, 41 feet from nose to tail', 'Triceratops, Ankylosaurus and more', 'A Cretaceous jungle to explore'],
  },
  {
    key: 'moon', label: 'The Moon', hero: 'lunar-module', move: 'orbit',
    fact: 'Stand at an Apollo landing site',
    facts: ['An Apollo landing site', 'The lander, the rover and the flag', 'Earth hanging in a black sky'],
  },
  {
    key: 'wonderland', label: 'Alice in Wonderland', hero: 'mad-hatter', move: 'orbit',
    fact: 'Join the Mad Hatter’s tea party',
    facts: ['The Mad Hatter’s tea party', 'The Cheshire Cat, fading in and out', 'The White Rabbit, late as ever'],
  },
  {
    key: 'robots', label: 'Robot Challenge World', hero: 'robot', move: 'orbit',
    fact: 'Five robots, five coding challenges',
    facts: ['Five robots, five coding challenges', 'Each pad shows the path its program draws', 'From three blocks to two robots talking'],
  },
  {
    key: 'voyage', label: 'Fantastic Voyage', hero: 'heart-model', move: 'orbit',
    fact: 'Explore the human body',
    facts: ['The human body, organ by organ', 'Every organ cut open to see inside', 'Real sizes on every placard'],
  },
  {
    key: 'volcano', label: 'Volcanoes & Rocks', hero: 'cutaway-volcano', move: 'crane',
    fact: 'Look inside a cut-away volcano',
    facts: ['A volcano, cut open', 'Magma, dikes and a lava lake', 'All twelve rocks of the rock cycle'],
  },
  {
    key: 'egypt', label: 'Ancient Egypt', hero: 'great-sphinx', move: 'push',
    fact: 'Meet the Sphinx and the pyramids',
    facts: ['The Great Sphinx', 'Pyramids, as weathered as the real ones', 'Egypt in its original colours'],
  },
  {
    key: 'butterfly', label: 'The Butterfly Garden', hero: null, move: 'arrival',
    fact: 'A monarch’s whole life cycle',
    facts: ['Butterflies twelve times life size', 'Five species on the wing', 'A monarch’s whole life cycle'],
  },
  {
    key: 'neighborhood', label: 'The Neighborhood', hero: null, move: 'arrival',
    fact: 'A model town with a trolley',
    facts: ['A model town', 'A trolley running down Main Street', 'Cars you can program'],
  },
  {
    key: 'seattle', label: 'Seattle Center', hero: 'space-needle', move: 'crane',
    fact: 'The Space Needle and the monorail',
    facts: ['The Space Needle', 'The monorail, already running', 'Three coding challenges'],
  },
  {
    key: 'mars', label: 'On Mars', hero: 'habitation-dome', move: 'push',
    fact: 'Visit a crewed outpost on Mars',
    facts: ['A crewed outpost on Mars', 'Walk into the habitation dome', 'Rovers, landers and dust devils'],
  },
  {
    key: 'park', label: 'The Park', hero: null, move: 'arrival',
    fact: 'A meadow, a pond and a bandstand',
    facts: ['The world every student starts in', 'A pond with geese to program', 'Secret doors to other worlds'],
  },
  {
    key: 'sea', label: 'Under the Sea', hero: null, move: 'arrival',
    fact: 'A coral reef thirty feet down',
    facts: ['A coral reef thirty feet down', 'Reef sharks overhead', 'An octopus, a moray eel and a sea star'],
  },
  {
    key: 'chalk', label: 'The Land of Chalk Drawings', hero: null, move: 'arrival',
    fact: 'Chalk drawings come to life',
    facts: ['Chalk drawings come to life', 'A rocket that draws a rainbow', 'Draw your own and watch it puff up'],
  },
  {
    key: 'sunflower', label: 'Sunflower', hero: null, move: 'arrival',
    fact: 'A sunflower field, seen by a mouse',
    facts: ['A sunflower field, seen by a mouse', 'Sunflowers fifty feet tall', 'A nest cut open to look inside'],
  },
  {
    key: 'tajmahal', label: 'The Taj Mahal', hero: 'taj-mahal', move: 'push',
    fact: 'Famous landmarks to walk around',
    facts: ['The Taj Mahal', 'Walk all the way round it', 'Every placard gives the real size'],
  },
  {
    key: 'constellations', label: 'The Constellations', hero: null, move: 'arrival',
    fact: 'Learn the real night sky',
    facts: ['The real night sky', 'Orion, overhead in winter', 'Find the North Star'],
  },
];

export function worldDef(key) {
  return STUDIO_WORLDS.find((w) => w.key === key)
    || { key, label: PRESET_WORLDS[key]?.label || key, hero: null, move: 'arrival', fact: '', facts: [] };
}

// The theme a world is built in, for picking its ambience. build() only lists records -- it
// builds no geometry and applies nothing -- so this is cheap and side-effect free.
const themeCache = new Map();
export function themeOf(key) {
  if (!themeCache.has(key)) {
    try {
      themeCache.set(key, PRESET_WORLDS[key]?.build()?.theme || 'default');
    } catch {
      themeCache.set(key, 'default');
    }
  }
  return themeCache.get(key);
}

// --- camera shots --------------------------------------------------------------------------

// How far back to stand to fit a box seen `w` wide and `h` tall, by both half-angles.
function fitBox(S, w, h, fill = 0.88) {
  const v = THREE.MathUtils.degToRad(S.fov) / 2;
  const hh = Math.atan(Math.tan(v) * S.aspect);
  return Math.max(w / 2 / Math.tan(hh * fill), h / 2 / Math.tan(v * fill));
}

// An axis-aligned box seen from bearing `theta`: how wide it looks, and how deep it is.
function extentAt(size, theta) {
  return {
    width: Math.abs(size.x * Math.cos(theta)) + Math.abs(size.z * Math.sin(theta)),
    depth: Math.abs(size.x * Math.sin(theta)) + Math.abs(size.z * Math.cos(theta)),
  };
}

// Distance from a hero's centre that frames it from `theta`: fitted to what is actually
// seen from there, not to a bounding sphere -- a 41ft T. rex seen nose-on is a third of the
// width it is broadside, and sized by its sphere it came out a speck in the middle of a Reel.
//
// On a tall frame a wide hero is allowed to run off both sides, the way anybody filming on a
// phone frames it. Fitted edge to edge, a T. rex in a Reel needs the camera 130ft back --
// through a forest, at which point it is a speck behind the trees anyway.
function heroDistance(S, hero, theta, fill = 0.88) {
  const { width, depth } = extentAt(hero.size, theta);
  const crop = S.aspect < 0.7 ? 0.62 : S.aspect < 0.95 ? 0.8 : 1.05;
  return Math.min(170, fitBox(S, width * crop, hero.size.y * 1.12, fill) + depth / 2);
}

// Mostly linear, eased a little at the start. A shot that eases to a stop at its end looks
// like the camera losing interest; one that keeps travelling into the cut feels alive -- and
// continuing at the same speed past p = 1 lets the end card drift on without a jolt.
function travel(p) {
  if (p <= 1) return p * 0.82 + 0.18 * smooth(p);
  return 1 + (p - 1) * 0.82;
}

function aboveGround(S, v, clearance = 2.2) {
  const g = S.groundAt(v.x, v.z);
  if (v.y < g + clearance) v.y = g + clearance;
  const r = Math.hypot(v.x, v.z);
  if (r > WORLD_BOUND_RADIUS) {
    v.x *= WORLD_BOUND_RADIUS / r;
    v.z *= WORLD_BOUND_RADIUS / r;
  }
  return v;
}

// The world's own composed frame, travelling forward through it.
function arrivalShot(S) {
  const { x, z, yaw } = S.spawn;
  const d = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const eye = S.groundAt(x, z) + 5;
  const from = new THREE.Vector3(x, eye + 2.2, z).addScaledVector(d, -9);
  const to = new THREE.Vector3(x, eye + 0.4, z).addScaledVector(d, 4);
  return {
    kind: 'arrival',
    pose(p) {
      const k = travel(p);
      const pos = from.clone().lerp(to, k);
      aboveGround(S, pos, 3);
      const look = pos.clone().addScaledVector(d, 40);
      look.y = eye - 1.5;
      return { pos, look };
    },
  };
}

function orbitShot(S, hero, dir, theta0 = Math.atan2(S.spawn.x - hero.center.x, S.spawn.z - hero.center.z)) {
  const c = hero.center;
  const R = heroDistance(S, hero, theta0);
  const span = 0.6;
  return {
    kind: 'orbit',
    pose(p) {
      const k = travel(p);
      const th = theta0 + dir * (k - 0.5) * span;
      const pos = new THREE.Vector3(c.x + Math.sin(th) * R, c.y + R * (0.16 + 0.06 * k), c.z + Math.cos(th) * R);
      aboveGround(S, pos);
      return { pos, look: c.clone() };
    },
  };
}

function pushShot(S, hero, dir, theta0 = Math.atan2(S.spawn.x - hero.center.x, S.spawn.z - hero.center.z)) {
  const c = hero.center;
  const th = theta0 + dir * 0.14;
  const R = heroDistance(S, hero, th);
  return {
    kind: 'push',
    pose(p) {
      const k = travel(p);
      const dist = R * (1.35 - 0.4 * k);
      const pos = new THREE.Vector3(c.x + Math.sin(th) * dist, c.y + R * 0.12, c.z + Math.cos(th) * dist);
      aboveGround(S, pos);
      return { pos, look: c.clone() };
    },
  };
}

function craneShot(S, hero, dir, th0 = Math.atan2(S.spawn.x - hero.center.x, S.spawn.z - hero.center.z)) {
  const c = hero.center;
  const R = heroDistance(S, hero, th0);
  const ground = S.groundAt(c.x, c.z);
  return {
    kind: 'crane',
    pose(p) {
      const k = travel(p);
      const th = th0 + dir * 0.12 * k;
      const h = ground + 2.4 + (c.y - ground + R * 0.45) * smooth(Math.min(1, k));
      const pos = new THREE.Vector3(c.x + Math.sin(th) * R, h, c.z + Math.cos(th) * R);
      aboveGround(S, pos);
      const look = c.clone();
      look.y += hero.size.y * (0.08 * k - 0.1);
      return { pos, look };
    },
  };
}

export function makeShot(move, S, hero, dir, theta) {
  if (!hero || move === 'arrival') return arrivalShot(S);
  if (move === 'push') return pushShot(S, hero, dir, theta);
  if (move === 'crane') return craneShot(S, hero, dir, theta);
  return orbitShot(S, hero, dir, theta);
}

// Can this shot see its hero? Five samples along the move; at each, the camera must not be
// standing inside anything, and at least three of five sight lines (centre, top, both sides,
// lower middle) must reach the hero. The OPENING frame must be clear outright -- it is the
// thumbnail, and a feed decides in under a second whether to keep watching.
function shotClear(S, shot, hero) {
  const c = hero.center;
  const s = hero.size;
  const targets = [
    c,
    new THREE.Vector3(c.x, c.y + s.y * 0.3, c.z),
    new THREE.Vector3(c.x, c.y - s.y * 0.2, c.z),
  ];
  let blocked = 0;
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const { pos } = shot.pose(p);
    const side = new THREE.Vector3(pos.z - c.z, 0, c.x - pos.x).normalize().multiplyScalar(Math.max(s.x, s.z) * 0.28);
    const sights = [...targets, c.clone().add(side), c.clone().sub(side)];
    let ok = S.cameraClear(pos, hero.root) && S.lensClear(pos, c, hero.root, p === 0 ? 0 : 1);
    if (ok) {
      let seen = 0;
      for (const tgt of sights) if (S.pathClear(pos, tgt, hero.root)) seen++;
      ok = seen >= 3;
    }
    if (!ok) {
      if (p === 0) return false;
      blocked++;
    }
  }
  return blocked <= 1;
}

// A hero shot only goes out if the camera can actually SEE the hero for most of it. Orbits
// in a populated world pass behind trees and through buildings, and a shot of the back of a
// hedge is worse than the plain arrival frame -- so each candidate is raycast at four
// points and the first one with a clear line wins.
export function pickShot(S, def, index, preferred = null) {
  const dir = index % 2 ? -1 : 1;
  const hero = def.hero ? S.findHero(def.hero) : null;
  if (!hero) return arrivalShot(S);
  const first = preferred || def.move;
  if (first === 'arrival') return arrivalShot(S);
  // The bearing the world's own arrival frame looks at the hero from first, then swung
  // round either way. Each layout is composed so that its hero faces the spawn, so the
  // first is usually right -- the others are for when a tree is in the way.
  const home = Math.atan2(S.spawn.x - hero.center.x, S.spawn.z - hero.center.z);
  const tries = [];
  for (const swing of [0, 0.5, -0.5, 1, -1]) {
    tries.push([first, dir, home + swing]);
    if (first !== 'push') tries.push(['push', dir, home + swing]);
  }
  for (const [move, d, theta] of tries) {
    const shot = makeShot(move, S, hero, d, theta);
    if (shotClear(S, shot, hero)) return shot;
  }
  return arrivalShot(S);
}

// --- models ------------------------------------------------------------------------------

// A model is built in its own frame -- +Z toward the camera -- and turned to face whichever
// way the camera actually is when it is placed, so the windows and the eyes are always on
// the side being filmed.
export const RECIPES = {
  rocket: {
    label: 'Rocket',
    height: 8.9,
    steps: [
      { label: 'Stretch a cylinder', parts: [{ shape: 'cylinder', color: '#f4f6fb', scale: [1.05, 3, 1.05], pos: [0, 4.3, 0] }] },
      { label: 'Stack a nose cone', parts: [{ shape: 'sphere', color: '#e0455f', scale: [1.05, 1.55, 1.05], pos: [0, 7.3, 0] }] },
      {
        label: 'Turn and place three fins',
        parts: [0, 1, 2].map((i) => {
          const a = Math.PI / 6 + (i * Math.PI * 2) / 3;
          return { shape: 'cube', color: '#e0455f', scale: [0.09, 0.85, 0.6], pos: [Math.sin(a) * 1.55, 0.95, Math.cos(a) * 1.55], rot: [0, a, 0] };
        }),
      },
      { label: 'Add a booster', parts: [{ shape: 'cylinder', color: '#f2a541', scale: [0.75, 0.45, 0.75], pos: [0, 0.85, 0] }] },
      {
        label: 'Two windows',
        parts: [
          { shape: 'sphere', color: '#7ec8ff', scale: [0.42, 0.42, 0.42], pos: [0, 5.7, 0.95] },
          { shape: 'sphere', color: '#7ec8ff', scale: [0.34, 0.34, 0.34], pos: [0, 4.5, 0.98] },
        ],
      },
      { label: 'And a stripe', parts: [{ shape: 'cylinder', color: '#3d8bf2', scale: [1.09, 0.1, 1.09], pos: [0, 6.6, 0] }] },
    ],
  },
  robot: {
    label: 'Robot',
    height: 6.2,
    steps: [
      { label: 'Stretch a cube into a body', parts: [{ shape: 'cube', color: '#3d8bf2', scale: [1.1, 1.0, 0.8], pos: [0, 2.9, 0] }] },
      {
        label: 'Two legs',
        parts: [-1, 1].map((s) => ({ shape: 'cylinder', color: '#8a94a6', scale: [0.32, 0.95, 0.32], pos: [s * 0.55, 0.95, 0] })),
      },
      { label: 'Stack a head', parts: [{ shape: 'cube', color: '#e6ebf2', scale: [0.8, 0.62, 0.7], pos: [0, 4.55, 0] }] },
      {
        label: 'Turn the arms',
        parts: [-1, 1].map((s) => ({ shape: 'cylinder', color: '#8a94a6', scale: [0.26, 0.8, 0.26], pos: [s * 1.42, 2.95, 0], rot: [0, 0, s * 0.2] })),
      },
      {
        label: 'Eyes',
        parts: [-1, 1].map((s) => ({ shape: 'sphere', color: '#1e2a3a', scale: [0.2, 0.2, 0.2], pos: [s * 0.35, 4.65, 0.66] })),
      },
      {
        label: 'An antenna',
        parts: [
          { shape: 'cylinder', color: '#8a94a6', scale: [0.06, 0.35, 0.06], pos: [0, 5.5, 0] },
          { shape: 'sphere', color: '#e0455f', scale: [0.22, 0.22, 0.22], pos: [0, 5.95, 0] },
        ],
      },
    ],
  },
};

function B(type, params = {}, children = null) {
  const block = createBlockInstance(type);
  Object.assign(block.params, params);
  if (children) block.children = children;
  return block;
}

// The demonstration programs. Each has a block version and a JavaScript version that does
// the same thing better -- which is the argument the Code It template makes on screen.
export const DEMOS = {
  rocket: {
    label: 'Rocket draws a spiral',
    recipe: 'rocket',
    blocks: () => [
      B('markerColor', { color: '#ff5a5f' }),
      B('markerDown'),
      B('repeat', { count: 72 }, [B('moveForward', { feet: 1 }), B('moveUp', { feet: 0.4 }), B('rotate', { degrees: 10 })]),
    ],
    js: `// A rainbow spiral: one colour per turn.
const colors = ['#ff5a5f', '#ffb341', '#ffe14d',
                '#3fb37f', '#3d8bf2', '#8a5cf5'];
await markerDown();
for (const color of colors) {
  await markerColor(color);
  await repeat(12, async () => {
    await moveForward(1);
    await moveUp(0.4);
    await rotate(10);
  });
}
`,
    runSeconds: 3.8,
    sfx: 'launch',
  },
  robot: {
    label: 'Robot says hello and dances',
    recipe: 'robot',
    blocks: () => [
      B('say', { text: 'Hello!' }),
      B('repeat', { count: 4 }, [B('moveUp', { feet: 1.5 }), B('wait', { seconds: 0.15 }), B('moveUp', { feet: -1.5 }), B('rotate', { degrees: 90 }), B('wait', { seconds: 0.12 })]),
    ],
    js: `// The same dance, twice as long.
await say('Hello from JavaScript!');
await repeat(8, async () => {
  await moveUp(1.5);
  await wait(0.12);
  await moveUp(-1.5);
  await rotate(45);
});
`,
    runSeconds: 2.4,
    sfx: 'beep',
  },
  star: {
    label: 'Robot draws a star',
    world: 'robots',
    blocks: () => [
      B('markerColor', { color: '#ffc93c' }),
      B('markerDown'),
      B('repeat', { count: 5 }, [B('glide', { feet: 12, seconds: 0.55, ease: 'smooth' }), B('rotate', { degrees: 144 })]),
      B('say', { text: 'A star!' }),
    ],
    js: `// Five colours, one star.
const colors = ['#ff5a5f', '#ffb341', '#ffe14d',
                '#3fb37f', '#3d8bf2'];
await markerDown();
for (const color of colors) {
  await markerColor(color);
  await glide(12, 0.55);
  await rotate(144);
}
await say('A rainbow star!');
`,
    runSeconds: 3.4,
    sfx: 'beep',
  },
};

// Builds a primitive mesh exactly the way Create Model does, so the pieces in the video are
// the pieces a student gets.
async function partMesh(part) {
  const mesh = await createShapeMesh({ shape: part.shape, color: part.color });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// The base geometry's own half-height at scale 1, so a piece can be stood ON the ground.
function halfHeight(shape) {
  return shape === 'tetrahedron' ? PRIMITIVE_SIZE * 0.33 : PRIMITIVE_SIZE / 2;
}

// Where to build, and which way the camera films it from.
//
// Near the spawn, which every world keeps clear -- My World's notes say so outright -- but
// not simply straight ahead, filmed down the spawn's own sightline: that looks at whatever
// the world put at the end of it, which in My World is the welcome board, so the first pass
// built a rocket in front of a wall of text. Instead a few candidate spots round the spawn,
// each filmed from several sides, are scored by how much is standing in the background
// behind the model, and the emptiest view wins. The model is turned to face that camera.
function siteFor(S) {
  if (S.shared.site) return S.shared.site;
  const { x, z, yaw } = S.spawn;
  const d = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const side = new THREE.Vector3(-d.z, 0, d.x);
  const spots = [
    new THREE.Vector3(x, 0, z).addScaledVector(d, 8),
    new THREE.Vector3(x, 0, z).addScaledVector(d, -10),
    new THREE.Vector3(x, 0, z).addScaledVector(side, 12),
    new THREE.Vector3(x, 0, z).addScaledVector(side, -12),
  ];
  let best = null;
  spots.forEach((site, si) => {
    site.y = S.groundAt(site.x, site.z);
    const focus = site.clone();
    focus.y += 4;
    if (!S.cameraClear(focus, null)) return;
    for (let k = 0; k < 8; k++) {
      const th = (k / 8) * Math.PI * 2;
      const cam = new THREE.Vector3(site.x + Math.sin(th) * 16, focus.y + 2, site.z + Math.cos(th) * 16);
      if (!S.cameraClear(cam, null) || !S.pathClear(cam, focus, null) || !S.lensClear(cam, focus, null)) continue;
      // Clutter behind the model, plus a small preference for the first (nearest) spot.
      const score = S.clutterBehind(cam, focus, 80) + si * 0.4;
      if (!best || score < best.score) best = { site, yaw: th, score };
    }
  });
  if (!best) {
    const site = spots[0];
    best = { site, yaw: Math.atan2(-d.x, -d.z) };
  }
  S.shared.site = { site: best.site, yaw: best.yaw };
  return S.shared.site;
}

function toWorld(site, yaw, local) {
  const v = new THREE.Vector3(local[0], local[1], local[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return v.add(site);
}

// Registers a finished set of parts as ONE built model, the same record kind Render Model
// writes -- so it can be programmed exactly like a student's own.
function registerModel(S, parts, site, yaw, recipeKey) {
  const group = new THREE.Group();
  group.position.copy(site);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  for (const { mesh } of parts) {
    S.scene.remove(mesh);
    const local = group.worldToLocal(mesh.position.clone());
    mesh.position.copy(local);
    mesh.rotation.y -= yaw;
    group.add(mesh);
  }
  S.scene.add(group);
  const id = uuid();
  const record = {
    id,
    kind: 'built-model',
    createdAt: Date.now(),
    studio: true,
    parts: parts.map(({ part, mesh }) => ({
      shape: part.shape,
      color: part.color,
      fileIndex: null,
      position: mesh.position.toArray(),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.toArray(),
    })),
    files: [],
    transform: { position: group.position.toArray(), rotation: [0, yaw, 0], scale: [1, 1, 1] },
  };
  // Bulk, so the registry does not give it the birth pop: the studio choreographs its own.
  const bulk = S.registry.bulkLoading;
  S.registry.bulkLoading = true;
  S.registry.add(id, group, { record });
  S.registry.bulkLoading = bulk;
  return { id, group, recipeKey, site: site.clone(), yaw, height: RECIPES[recipeKey].height };
}

// A finished model in one go, for a code beat that has no build beat before it.
async function instantModel(S, recipeKey) {
  const recipe = RECIPES[recipeKey];
  const { site, yaw } = siteFor(S);
  const parts = [];
  for (const step of recipe.steps) {
    for (const part of step.parts) {
      const mesh = await partMesh(part);
      mesh.position.copy(toWorld(site, yaw, part.pos));
      mesh.scale.fromArray(part.scale);
      mesh.rotation.set(part.rot?.[0] || 0, (part.rot?.[1] || 0) + yaw, part.rot?.[2] || 0);
      S.scene.add(mesh);
      parts.push({ part, mesh });
    }
  }
  return registerModel(S, parts, site, yaw, recipeKey);
}

// --- the build gizmo, as the studio draws it ---------------------------------------------

// The same blue box, pale corner handles and green lift handle the real BuildGizmo shows
// (its exact colours), drawn around whichever piece is being worked on.
function makeGizmo(scene) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3d8bf2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x3d8bf2, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  edges.renderOrder = 997;
  const frame = new THREE.Group();
  frame.add(box, edges);
  group.add(frame);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: 0x9ecbff, depthTest: false }));
    h.renderOrder = 998;
    corners.push(h);
    group.add(h);
  }
  const lift = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), new THREE.MeshBasicMaterial({ color: 0x3fb37f, depthTest: false }));
  lift.renderOrder = 999;
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]),
    new THREE.LineBasicMaterial({ color: 0x3fb37f, depthTest: false, transparent: true, opacity: 0.8 }),
  );
  stem.renderOrder = 997;
  group.add(lift, stem);
  group.visible = false;
  scene.add(group);

  const tmp = new THREE.Vector3();
  return {
    group,
    // Fit the box to a set of meshes' combined bounds (axis-aligned in the model's frame is
    // close enough here -- pieces are only ever turned about Y while the box is on them).
    fit(meshes, { showLift = false, alpha = 1 } = {}) {
      const bb = new THREE.Box3();
      for (const m of meshes) bb.expandByObject(m);
      if (bb.isEmpty()) { group.visible = false; return; }
      group.visible = alpha > 0.01;
      const size = bb.getSize(new THREE.Vector3()).addScalar(0.12);
      const centre = bb.getCenter(new THREE.Vector3());
      frame.position.copy(centre);
      frame.scale.copy(size);
      let i = 0;
      for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
        corners[i++].position.copy(tmp.set(sx * size.x, sy * size.y, sz * size.z).add(centre));
      }
      lift.visible = showLift;
      stem.visible = showLift;
      lift.position.set(centre.x, bb.max.y + 1.2, centre.z);
      stem.position.set(centre.x, bb.max.y, centre.z);
      stem.scale.set(1, 1.2, 1);
      for (const m of [box, edges, ...corners, lift, stem]) {
        const mat = m.material;
        mat.transparent = true;
        if (mat.userData.base === undefined) mat.userData.base = mat.opacity ?? 1;
        mat.opacity = mat.userData.base * alpha;
      }
    },
    hide() { group.visible = false; },
    dispose() {
      scene.remove(group);
      group.traverse((n) => {
        n.geometry?.dispose?.();
        n.material?.dispose?.();
      });
    },
  };
}

// --- beats -------------------------------------------------------------------------------

function hookBeat({ world, dur, words }) {
  const def = worldDef(world);
  return {
    kind: 'hook',
    label: 'Hook',
    world,
    dur,
    transition: 'cut',
    cues: [{ t: 0.15, sfx: 'whoosh', v: 0.7 }],
    setup(S) { this.shot = pickShot(S, def, 0); },
    pose(S, t) { return this.shot.pose(t / this.dur); },
    draw(ctx, L, S, t) {
      drawHeadline(ctx, L, { text: words.hook, sub: words.sub, t, start: 0.12, end: this.dur - 0.08 });
    },
  };
}

function worldBeat({ world, dur, index, band, bandIn, bandOut, label = true }) {
  const def = worldDef(world);
  return {
    kind: 'world',
    label: def.label,
    world,
    dur,
    transition: 'dissolve',
    cues: [{ t: 0, sfx: 'whoosh', v: 0.55 }],
    setup(S) { this.shot = pickShot(S, def, index); },
    pose(S, t) { return this.shot.pose(t / this.dur); },
    draw(ctx, L, S, t) {
      if (band) {
        const a = Math.min(bandIn ? clamp01(t / 0.35) : 1, bandOut ? clamp01((this.dur - t) / 0.3) : 1);
        drawBand(ctx, L, { text: band, alpha: a });
      }
      if (label) drawLowerThird(ctx, L, { title: def.label, sub: def.fact, t, start: 0.25, end: this.dur - 0.1 });
    },
  };
}

function spotlightBeat({ world, dur, index, fact, move, headline }) {
  const def = worldDef(world);
  return {
    kind: 'world',
    label: `${def.label} ${index + 1}`,
    world,
    dur,
    transition: index === 0 ? 'cut' : 'dissolve',
    cues: index === 0 ? [{ t: 0.15, sfx: 'whoosh', v: 0.7 }] : [{ t: 0, sfx: 'whoosh', v: 0.5 }],
    setup(S) { this.shot = pickShot(S, def, index, move); },
    pose(S, t) { return this.shot.pose(t / this.dur); },
    draw(ctx, L, S, t) {
      if (headline) drawHeadline(ctx, L, { text: headline.text, sub: headline.sub, t, start: 0.12, end: this.dur - 0.08 });
      else if (fact) drawLowerThird(ctx, L, { title: fact, t, start: 0.2, end: this.dur - 0.1 });
    },
  };
}

// The build demonstration: a model assembled piece by piece with the build gizmo on each
// piece in turn, then "rendered" into one object.
function buildTimeline(recipe, dur) {
  const intro = 0.25;
  const render = Math.min(1.7, Math.max(0.9, dur * 0.15));
  const span = Math.max(0.5, dur - intro - render);
  const weights = recipe.steps.map((_, i) => (i === 0 ? 2.6 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let at = intro;
  const steps = recipe.steps.map((step, i) => {
    const w = (weights[i] / total) * span;
    const s = { step, start: at, end: at + w, w };
    at += w;
    return s;
  });
  return { steps, renderAt: dur - render, intro };
}

// Fractions of a step's window: drop, stretch, move, settle.
const PHASES = { drop: 0.24, stretch: 0.55, move: 0.9 };

function buildBeat({ world, dur, recipeKey }) {
  const recipe = RECIPES[recipeKey];
  const tl = buildTimeline(recipe, dur);
  const compact = dur < 6;
  const cues = [];
  for (const [i, s] of tl.steps.entries()) {
    cues.push({ t: s.start + 0.02, sfx: 'pop', v: i === 0 ? 1 : 0.8 });
    if (s.w > 0.5) cues.push({ t: s.start + s.w * PHASES.drop, sfx: 'stretch', v: i === 0 ? 1 : 0.6 });
    cues.push({ t: s.start + s.w * 0.88, sfx: 'place', v: 0.8 });
  }
  cues.push({ t: tl.renderAt + 0.05, sfx: 'sparkle' });

  return {
    kind: 'build',
    label: `Build: ${recipe.label}`,
    world,
    dur,
    transition: 'dissolve',
    cues,
    async setup(S) {
      const { site, yaw } = siteFor(S);
      this.site = site;
      this.yaw = yaw;
      // The camera's right, for where fresh pieces land: beside the model, not on it.
      const camSide = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      this.staging = site.clone().addScaledVector(camSide, 4.6);
      this.parts = [];
      for (const s of tl.steps) {
        s.meshes = [];
        for (const [j, part] of s.step.parts.entries()) {
          const mesh = await partMesh(part);
          mesh.visible = false;
          S.scene.add(mesh);
          const stage = this.staging.clone().addScaledVector(camSide, j * 1.6 - (s.step.parts.length - 1) * 0.8);
          stage.y = S.groundAt(stage.x, stage.z);
          const entry = { part, mesh, stage, final: toWorld(site, yaw, part.pos) };
          s.meshes.push(entry);
          this.parts.push(entry);
        }
      }
      this.gizmo = makeGizmo(S.scene);
      this.rendered = false;
      // Orbit round a point between the model and where pieces land, close enough that
      // the model fills the frame -- the whole beat is about watching pieces arrive.
      this.focus = site.clone().addScaledVector(camSide, 2.0);
      this.focus.y += recipe.height * 0.46;
      this.R = fitBox(S, 9.2, recipe.height * 1.15, 0.9);
      this.theta = yaw + 0.22;
    },
    update(S, t) {
      let active = null;
      for (const s of tl.steps) {
        const k = (t - s.start) / s.w;
        for (const e of s.meshes) {
          const { part, mesh, stage, final } = e;
          const fs = part.scale;
          const rot = part.rot || [0, 0, 0];
          if (k < 0) { mesh.visible = false; continue; }
          mesh.visible = true;
          if (this.rendered) continue;
          if (k < PHASES.drop) {
            const a = outBack(k / PHASES.drop);
            mesh.scale.setScalar(Math.max(0.001, a));
            mesh.position.set(stage.x, stage.y + halfHeight(part.shape) * a, stage.z);
            mesh.rotation.set(0, this.yaw, 0);
          } else if (k < PHASES.stretch) {
            const a = smooth((k - PHASES.drop) / (PHASES.stretch - PHASES.drop));
            mesh.scale.set(1 + (fs[0] - 1) * a, 1 + (fs[1] - 1) * a, 1 + (fs[2] - 1) * a);
            mesh.position.set(stage.x, stage.y + halfHeight(part.shape) * mesh.scale.y, stage.z);
            mesh.rotation.set(0, this.yaw, 0);
          } else if (k < PHASES.move) {
            const a = smooth((k - PHASES.stretch) / (PHASES.move - PHASES.stretch));
            mesh.scale.fromArray(fs);
            const from = new THREE.Vector3(stage.x, stage.y + halfHeight(part.shape) * fs[1], stage.z);
            mesh.position.copy(from.lerp(final, a));
            mesh.position.y += Math.sin(Math.PI * a) * 2.4;
            mesh.rotation.set(rot[0] * a, this.yaw + rot[1] * a, rot[2] * a);
          } else {
            const a = clamp01((k - PHASES.move) / (1 - PHASES.move));
            const squash = Math.sin(Math.PI * Math.min(1, a * 1.4)) * 0.06;
            mesh.scale.set(fs[0] * (1 + squash * 0.5), fs[1] * (1 - squash), fs[2] * (1 + squash * 0.5));
            mesh.position.copy(final);
            mesh.rotation.set(rot[0], this.yaw + rot[1], rot[2]);
          }
        }
        if (k >= 0 && k < 1) active = { s, k };
      }

      if (active && !this.rendered) {
        const { s, k } = active;
        const fade = k > PHASES.move ? clamp01(1 - (k - PHASES.move) / 0.08) : clamp01(k / 0.08);
        this.gizmo.fit(s.meshes.map((e) => e.mesh), { showLift: k >= PHASES.stretch, alpha: fade });
      } else {
        this.gizmo.hide();
      }

      // Render Model: every piece flashes, and the lot becomes one object.
      if (t >= tl.renderAt && !this.rendered) {
        for (const e of this.parts) {
          e.mesh.visible = true;
          e.mesh.position.copy(e.final);
          e.mesh.scale.fromArray(e.part.scale);
          const rot = e.part.rot || [0, 0, 0];
          e.mesh.rotation.set(rot[0], this.yaw + rot[1], rot[2]);
        }
        this.gizmo.hide();
        S.shared.model = registerModel(S, this.parts, this.site, this.yaw, recipeKey);
        this.rendered = true;
      }
      if (this.rendered) {
        const k = clamp01((t - tl.renderAt) / 0.6);
        const g = S.shared.model.group;
        g.scale.setScalar(1 + Math.sin(Math.PI * k) * 0.07);
        const glow = (1 - k) * 0.9;
        g.traverse((n) => {
          if (n.isMesh) n.material.emissive?.setRGB(glow, glow * 0.95, glow * 0.8);
        });
      }
    },
    pose(S, t) {
      const k = travel(t / this.dur);
      const th = this.theta - 0.4 * k;
      const pos = new THREE.Vector3(
        this.focus.x + Math.sin(th) * this.R,
        this.focus.y + this.R * 0.14,
        this.focus.z + Math.cos(th) * this.R,
      );
      aboveGround(S, pos);
      return { pos, look: this.focus.clone() };
    },
    draw(ctx, L, S, t) {
      if (compact) {
        drawStep(ctx, L, { n: null, text: 'Build with simple shapes', t, start: 0.1, end: tl.renderAt });
      } else {
        const s0 = tl.steps[0];
        const at = (f) => s0.start + s0.w * f;
        drawStep(ctx, L, { n: 1, text: 'Drop a shape', t, start: s0.start, end: at(PHASES.drop) + 0.05 });
        drawStep(ctx, L, { n: 2, text: 'Stretch it', t, start: at(PHASES.drop) + 0.05, end: at(PHASES.stretch) });
        drawStep(ctx, L, { n: 3, text: 'Stack it', t, start: at(PHASES.stretch), end: s0.end });
        for (const s of tl.steps.slice(1)) {
          drawStep(ctx, L, { n: null, text: s.step.label, t, start: s.start, end: s.end });
        }
      }
      drawStep(ctx, L, { n: compact ? null : 4, text: 'Render it into one model', t, start: tl.renderAt, end: this.dur - 0.05 });
      if (t >= tl.renderAt && S.shared.model) {
        burst(ctx, L, S, S.shared.model.group, t - tl.renderAt);
      }
    },
    teardown() {
      this.gizmo?.dispose();
    },
  };
}

// The first bearing round `centre` from which the camera is clear at every distance and
// height it will use: not standing inside anything, and able to see the centre.
function clearBearing(S, centre, base, radii, heights, ignore) {
  let best = null;
  for (const swing of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.3, -2.3, Math.PI]) {
    let ok = true;
    for (const th of [base + swing, base + swing + 0.25]) {
      for (const R of radii) {
        for (const h of heights) {
          const pos = new THREE.Vector3(centre.x + Math.sin(th) * R, h, centre.z + Math.cos(th) * R);
          aboveGround(S, pos);
          if (!S.cameraClear(pos, ignore) || !S.pathClear(pos, new THREE.Vector3(centre.x, h * 0.5 + centre.y * 0.5, centre.z), ignore)) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // Of the clear bearings, the one with the emptiest background, measured from the
    // furthest the camera will stand -- with a small premium on staying near `base`,
    // which is usually where the shot before this one left off.
    const R = Math.max(...radii);
    const th = base + swing;
    const cam = new THREE.Vector3(centre.x + Math.sin(th) * R, heights[0], centre.z + Math.cos(th) * R);
    const score = S.clutterBehind(cam, new THREE.Vector3(centre.x, heights[0], centre.z), 90) + Math.abs(swing) * 0.6;
    if (!best || score < best.score) best = { th, score };
  }
  return best ? best.th : base;
}

// Twinkles bursting out of a freshly rendered model, drawn in screen space.
function burst(ctx, L, S, object3D, lt) {
  if (lt > 1) return;
  const centre = new THREE.Box3().setFromObject(object3D).getCenter(new THREE.Vector3());
  const p = S.project(centre);
  if (!p) return;
  const { u } = L;
  ctx.save();
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2 + i * 0.37;
    const dist = (40 + (i % 4) * 30) * u * outCubic(lt * 1.3) * 3;
    const a = clamp01(1 - lt) * 0.95;
    const x = p.x + Math.cos(ang) * dist;
    const y = p.y + Math.sin(ang) * dist;
    const r = (10 + (i % 3) * 7) * u * (1 - lt * 0.5);
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 3 === 0 ? BRAND.sun : '#ffffff';
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const aa = (j * Math.PI) / 4;
      const rr = j % 2 === 0 ? r : r * 0.3;
      ctx.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Where a robot's star will be drawn, by stepping the program on paper: a glide is along
// the object's own +Z, a positive rotate adds to rotation.y. The camera frames the result
// before a single line of it exists.
function simulateStar(start, yaw, side = 12) {
  let ry = yaw;
  const p = start.clone();
  const pts = [p.clone()];
  for (let i = 0; i < 5; i++) {
    p.x += Math.sin(ry) * side;
    p.z += Math.cos(ry) * side;
    pts.push(p.clone());
    ry += THREE.MathUtils.degToRad(144);
  }
  const c = new THREE.Vector3();
  for (const q of pts.slice(0, 5)) c.add(q);
  return c.multiplyScalar(1 / 5);
}

function codeTimeline(demo, mode, dur, flipIn) {
  const blocks = demo.blocks();
  const code = demo.js;
  const n = countBlocks(blocks);
  const cardIn = 0.15;
  const flipEnd = flipIn ? cardIn + 0.55 : cardIn;
  let revealStart = flipEnd + 0.3;
  let revealEnd;
  let interval = 0;
  let typeRate = 0;
  if (mode === 'blocks') {
    interval = Math.max(0.12, Math.min(0.45, (dur - demo.runSeconds - 1.1) / n));
    revealEnd = revealStart + interval * n;
  } else {
    const chars = codeLength(code);
    const typeTime = Math.max(0.8, Math.min(chars / 40, dur - demo.runSeconds - 1.3));
    typeRate = chars / typeTime;
    revealEnd = revealStart + typeTime;
  }
  const runAt = Math.min(revealEnd + 0.3, Math.max(revealStart + 0.4, dur - demo.runSeconds - 0.3));
  const cardOut = dur - runAt > demo.runSeconds + 1.5 ? runAt + 2.2 : dur - 0.05;
  return { blocks, code, n, cardIn, flipEnd, revealStart, revealEnd, interval, typeRate, runAt, cardOut };
}

function countBlocks(blocks) {
  let n = 0;
  for (const b of blocks || []) {
    n++;
    if (b.children) n += countBlocks(b.children);
  }
  return n;
}

function codeBeat({ world, dur, demoKey, mode = 'blocks', flipIn = false, caption = '' }) {
  const demo = DEMOS[demoKey];
  const tl = codeTimeline(demo, mode, dur, flipIn);
  const cues = [];
  if (mode === 'blocks') {
    for (let i = 0; i < tl.n; i++) cues.push({ t: tl.revealStart + i * tl.interval, sfx: 'snap', v: 0.85 });
  } else {
    if (flipIn) cues.push({ t: tl.cardIn + 0.1, sfx: 'whoosh', v: 0.4 });
    for (let t = tl.revealStart; t < tl.revealEnd; t += 0.075) cues.push({ t, sfx: 'type', v: 0.7 });
  }
  cues.push({ t: tl.runAt, sfx: 'tap' });
  cues.push({ t: tl.runAt + 0.06, sfx: demo.sfx, v: 0.9 });

  return {
    kind: 'code',
    label: mode === 'js' ? 'JavaScript' : 'Blocks',
    world,
    dur,
    transition: flipIn ? 'cut' : 'dissolve',
    cues,
    async setup(S) {
      this.started = false;
      if (demo.recipe) {
        if (!S.shared.model || S.shared.model.recipeKey !== demo.recipe || !S.shared.model.group.parent) {
          S.shared.model = await instantModel(S, demo.recipe);
        }
        const m = S.shared.model;
        this.target = { id: m.id, object3D: m.group };
        this.home = { pos: m.site.clone(), yaw: m.yaw };
        this.height = m.height;
        this.focus = m.site.clone();
        this.focus.y += m.height * 0.5;
        // A spiral's axis is beside the rocket, not under it: a positive rotate turns LEFT,
        // so a rocket stepping forward and turning circles a point on its own left, 5.7ft
        // out for 1ft steps and 10-degree turns.
        this.axis = demo.recipe === 'rocket'
          ? m.site.clone().add(new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw)).multiplyScalar(5.7))
          : m.site.clone();
        // The bearing is chosen at the WIDEST the camera will ever pull back to. Checked only
        // where it starts, the first pass backed into My World's tutorial board as the
        // spiral climbed, and a board's dark back filling the lens renders as a black frame.
        const Rmax = demo.recipe === 'rocket' ? fitBox(S, 14, 28.8 * 0.85 + 10, 0.9) : fitBox(S, 7 / S.L.span.w, m.height * 1.2 / S.L.span.h, 0.9);
        const Rmin = fitBox(S, 7, m.height * 1.25, 0.9);
        this.theta = clearBearing(S, this.axis, m.yaw + 0.3, [Rmin, Rmax], [this.focus.y + 2, this.focus.y + (demo.recipe === 'rocket' ? 22 : 3)], m.group);
      } else {
        const hero = S.findHero('robot');
        if (!hero) throw new Error('No robot in this world to program.');
        const id = hero.root.userData.placedId;
        S.programManager.stop(id);
        this.target = { id, object3D: hero.root };
        if (!S.shared.starHome || S.shared.starHome.id !== id) {
          S.shared.starHome = { id, pos: hero.root.position.clone(), yaw: hero.root.rotation.y };
        }
        this.home = S.shared.starHome;
        this.focus = simulateStar(this.home.pos, this.home.yaw);
        this.focus.y = S.groundAt(this.focus.x, this.focus.z) + 1.5;
        const R = fitBox(S, 17 / S.L.span.w, 12 / S.L.span.h, 0.9);
        const base = Math.atan2(S.spawn.x - this.focus.x, S.spawn.z - this.focus.z) + 0.15;
        this.theta = clearBearing(S, this.focus, base, [R, R * 0.6], [this.focus.y + 6, this.focus.y + 22], hero.root);
      }
      // Back to where it started, marks wiped, so a second beat on the same object (the
      // JavaScript version after the blocks) begins from a clean page.
      const obj = this.target.object3D;
      S.programManager.stop(this.target.id);
      obj.position.copy(this.home.pos);
      obj.rotation.set(0, this.home.yaw, 0);
      obj.scale.setScalar(1);
      S.markerTrail.eraseAll();
      S.markerTrail.forget?.(this.target.id);
      this.followY = this.focus.y;
    },
    update(S, t) {
      if (!this.started && t >= tl.runAt) {
        this.started = true;
        const { id, object3D } = this.target;
        if (mode === 'js') S.programManager.startJs(id, tl.code, object3D);
        else S.programManager.start(id, tl.blocks, object3D);
      }
    },
    pose(S, t, dt) {
      const step = Math.min(1, (dt || 1 / 60) * 3.2);
      // How much of the frame is ours: while the card is up the subject is framed into the
      // part of the picture the card leaves, and given the whole frame back as it goes.
      const a = life(t, flipIn ? 0 : tl.cardIn, tl.cardOut, 0.45, 0.4).alpha;
      const spanW = 1 + (S.L.span.w - 1) * a;
      const spanH = 1 + (S.L.span.h - 1) * a;
      const th = this.theta + 0.25 * (t / this.dur);

      if (demo.recipe) {
        const obj = this.target.object3D;
        const rise = this.started ? Math.max(0, obj.position.y - this.home.pos.y) : 0;
        const want = this.focus.y + rise * 0.62;
        this.followY += (want - this.followY) * step;
        // Over the first second of the flight the camera's centre moves from the model to
        // the spiral's axis -- eased, where the first pass cut straight across.
        const b = this.started ? smooth((t - tl.runAt) / 1.0) : 0;
        const cx = this.focus.x + (this.axis.x - this.focus.x) * b;
        const cz = this.focus.z + (this.axis.z - this.focus.z) * b;
        const w = demo.recipe === 'rocket' ? 7 + 7 * b : 7;
        const h = Math.max(this.height * 1.2, rise * 0.85 + 10 * b);
        const R = fitBox(S, w / spanW, h / spanH, 0.9);
        const pos = new THREE.Vector3(cx + Math.sin(th) * R, this.followY + R * 0.12, cz + Math.cos(th) * R);
        aboveGround(S, pos);
        return { pos, look: new THREE.Vector3(cx, this.followY, cz) };
      }
      // The star: crane up over it as it is drawn, ending nearly overhead.
      const k = smooth(clamp01((t - tl.runAt + 0.6) / (demo.runSeconds + 0.6)));
      const R = fitBox(S, 17 / spanW, 12 / spanH, 0.9);
      const dist = R * (1 - 0.42 * k);
      const height = this.focus.y + 6 + k * 16;
      const pos = new THREE.Vector3(this.focus.x + Math.sin(th) * dist, height, this.focus.z + Math.cos(th) * dist);
      aboveGround(S, pos);
      return { pos, look: this.focus.clone() };
    },
    // While the card is up the subject is moved out of its way.
    subject(S, L, t) {
      return t >= (flipIn ? 0 : tl.cardIn) && t <= tl.cardOut ? L.subject : null;
    },
    draw(ctx, L, S, t) {
      const running = this.started && S.programManager.isRunning(this.target.id);
      const flip = flipIn ? clamp01((tl.flipEnd - t) / 0.55) * 0.999 : 0;
      const isJs = mode === 'js';
      drawProgramCard(ctx, L, {
        t,
        start: flipIn ? 0 : tl.cardIn,
        end: tl.cardOut,
        blocks: tl.blocks,
        reveal: isJs ? 1e9 : Math.max(0, (t - tl.revealStart) / tl.interval),
        slide: isJs ? 1 : tl.interval / 0.22,
        code: tl.code,
        typed: isJs ? Math.max(0, (t - tl.revealStart) * tl.typeRate) : 0,
        // The flip turns a finished block card over into the JavaScript one.
        flip: isJs ? (flipIn ? 1 - flip : 1) : 0,
        running,
        runPressed: tl.runAt,
      });
      if (caption) {
        drawHeadline(ctx, L, { text: caption, t, start: 0.1, end: Math.min(this.dur - 0.1, tl.revealStart + 2.2), size: L.headlineSize * 0.72, maxLines: 2 });
      }
    },
  };
}

function endBeat({ dur, words, world }) {
  return {
    kind: 'end',
    label: 'End card',
    world,
    dur,
    transition: 'cut',
    cues: [{ t: 0.3, sfx: 'chime', v: 0.9 }],
    endCard: true,
    setup(S) {
      // Keep travelling along whatever the last shot was doing, under the blur.
      this.prev = S.lastPose;
    },
    pose(S, t, dt) {
      if (this.prev) return this.prev(t, dt);
      return null;
    },
    draw(ctx, L, S, t) {
      drawEndCard(ctx, L, { t, start: 0, end: this.dur, words, background: null });
    },
  };
}

// --- templates ---------------------------------------------------------------------------

export const TEMPLATES = [
  { id: 'showcase', label: 'Showcase', hint: 'Worlds, then building, then coding — the whole story in one video' },
  { id: 'tour', label: 'World Tour', hint: 'A quick montage of the worlds you choose' },
  { id: 'build', label: 'Build It', hint: 'A model built piece by piece from shapes, then brought to life' },
  { id: 'code', label: 'Code It', hint: 'A program in blocks, then the same program in real JavaScript' },
  { id: 'spotlight', label: 'Spotlight', hint: 'One world from several angles, with a fact on each shot' },
];

export const LENGTHS = [15, 30, 45, 60];

export const DEFAULT_WORDS = {
  showcase: { hook: 'Build *worlds*. Code *anything*.', sub: 'Free 3D building & coding for K–8', band: 'Explore ready-made worlds' },
  tour: { hook: 'Take your class *anywhere*', sub: 'Free 3D worlds that run in any browser', band: 'Where to next?' },
  build: { hook: 'Build *anything* from simple shapes', sub: 'Stretch it. Stack it. Program it.', band: '' },
  code: { hook: 'Learn to *code* in 3D', sub: 'Blocks first — then real JavaScript', band: '' },
  spotlight: { hook: 'Step inside *{world}*', sub: 'Free, in any browser, no account', band: '' },
};

export const END_WORDS = {
  tagline: 'Free 3D building & coding for every classroom',
  url: 'edusim3dweb.com',
  cta: 'Try it free — no account needed',
  small: 'Runs in the browser · Nothing to install · No ads',
};

// Rounds every beat boundary to the music's own beat grid, so cuts land on the beat.
function quantize(durs, grid) {
  const out = [];
  let acc = 0;
  let prevQ = 0;
  for (const d of durs) {
    acc += d;
    let q = Math.round(acc / grid) * grid;
    if (q - prevQ < 1.2) q = prevQ + Math.ceil(1.2 / grid) * grid;
    out.push(q - prevQ);
    prevQ = q;
  }
  return out;
}

// opts: { template, length, worlds[], spotlightWorld, buildWorld, recipe, demo,
//         words: { hook, sub, band, tagline, url, cta, small }, music, ambience }
export function buildPlan(opts) {
  const L = opts.length;
  const words = { ...END_WORDS, ...opts.words };
  const worlds = (opts.worlds?.length ? opts.worlds : ['dinosaur', 'moon', 'wonderland', 'robots']).filter((k) => PRESET_WORLDS[k]);
  const buildWorld = opts.buildWorld || 'empty';
  const recipeKey = opts.recipe || 'rocket';
  const demoKey = opts.demo || 'rocket';
  const demo = DEMOS[demoKey];
  const codeWorld = demo.world || buildWorld;
  const spec = [];

  if (opts.template === 'tour') {
    const hookW = 3.5;
    const endW = L <= 15 ? 2.5 : 3.5;
    const room = L - hookW - endW;
    const n = Math.max(1, Math.min(worlds.length - 1, Math.floor(room / 2.6)));
    const each = room / n;
    spec.push([hookW, (d) => hookBeat({ world: worlds[0], dur: d, words })]);
    for (let i = 0; i < n; i++) {
      const w = worlds[(i + 1) % worlds.length];
      spec.push([each, (d) => worldBeat({ world: w, dur: d, index: i + 1, band: words.band, bandIn: i === 0, bandOut: i === n - 1 })]);
    }
    spec.push([endW, (d, prev) => endBeat({ dur: d, words, world: prev })]);
  } else if (opts.template === 'build') {
    const table = { 15: [2.5, 7, 3.5, 2], 30: [3, 15, 8, 4], 45: [3, 22, 14, 6], 60: [3.5, 30, 20, 6.5] }[L] || [3, 15, 8, 4];
    spec.push([table[0], (d) => hookBeat({ world: buildWorld, dur: d, words })]);
    spec.push([table[1], (d) => buildBeat({ world: buildWorld, dur: d, recipeKey })]);
    const buildDemo = recipeKey === 'robot' ? 'robot' : 'rocket';
    if (L >= 45) {
      spec.push([table[2] * 0.45, (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'blocks', caption: 'Now *program* it' })]);
      spec.push([table[2] * 0.55, (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'js', flipIn: true, caption: '…or in real *JavaScript*' })]);
    } else {
      spec.push([table[2], (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'blocks', caption: 'Now *program* it' })]);
    }
    spec.push([table[3], (d, prev) => endBeat({ dur: d, words, world: prev })]);
  } else if (opts.template === 'code') {
    const table = { 15: [2.5, 9, 0, 3.5], 30: [3, 12, 11, 4], 45: [3.5, 17, 19, 5.5], 60: [4, 22, 27, 7] }[L] || [3, 12, 11, 4];
    spec.push([table[0], (d) => hookBeat({ world: codeWorld, dur: d, words })]);
    spec.push([table[1], (d) => codeBeat({ world: codeWorld, dur: d, demoKey, mode: 'blocks', caption: 'Snap *blocks* together' })]);
    if (table[2] > 0) spec.push([table[2], (d) => codeBeat({ world: codeWorld, dur: d, demoKey, mode: 'js', flipIn: true, caption: 'Same program, real *JavaScript*' })]);
    spec.push([table[3], (d, prev) => endBeat({ dur: d, words, world: prev })]);
  } else if (opts.template === 'spotlight') {
    const world = opts.spotlightWorld || worlds[0];
    const def = worldDef(world);
    const endW = L <= 15 ? 2.5 : 4;
    const n = Math.max(2, Math.min(5, Math.round((L - endW) / 4)));
    const each = (L - endW) / n;
    const moves = ['arrival', def.move === 'arrival' ? 'orbit' : def.move, 'crane', 'orbit', 'push'];
    const facts = [...(def.facts || []), 'Click anything to program it', 'Build your own models right here'];
    const hook = { text: (words.hook || '').replace('{world}', def.label), sub: words.sub };
    for (let i = 0; i < n; i++) {
      spec.push([each, (d) => spotlightBeat({
        world, dur: d, index: i, move: moves[i % moves.length],
        headline: i === 0 ? hook : null, fact: i === 0 ? null : facts[(i - 1) % facts.length],
      })]);
    }
    spec.push([endW, (d, prev) => endBeat({ dur: d, words, world: prev })]);
  } else {
    // Showcase.
    const table = {
      15: { hook: 3, tour: [2.5], build: 4.5, code: 3, end: 2 },
      30: { hook: 3.5, tour: [3, 3, 3], build: 8, code: 6, end: 3.5 },
      45: { hook: 4, tour: [3, 3, 3, 3], build: 10, code: 13, end: 5 },
      60: { hook: 4, tour: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5], build: 13, code: 16, end: 6 },
    }[L] || { hook: 3.5, tour: [3, 3, 3], build: 8, code: 6, end: 3.5 };
    spec.push([table.hook, (d) => hookBeat({ world: worlds[0], dur: d, words })]);
    const tourWorlds = worlds.slice(1).length ? worlds.slice(1) : worlds;
    const tourN = table.tour.length;
    table.tour.forEach((w, i) => {
      const key = tourWorlds[i % tourWorlds.length];
      spec.push([w, (d) => worldBeat({ world: key, dur: d, index: i + 1, band: words.band, bandIn: i === 0, bandOut: i === tourN - 1 })]);
    });
    spec.push([table.build, (d) => buildBeat({ world: buildWorld, dur: d, recipeKey })]);
    const buildDemo = recipeKey === 'robot' ? 'robot' : 'rocket';
    if (table.code >= 12) {
      spec.push([table.code * 0.45, (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'blocks', caption: 'Program it with *blocks*' })]);
      spec.push([table.code * 0.55, (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'js', flipIn: true, caption: '…or real *JavaScript*' })]);
    } else {
      spec.push([table.code, (d) => codeBeat({ world: buildWorld, dur: d, demoKey: buildDemo, mode: 'blocks', caption: 'Program it with *blocks*' })]);
    }
    spec.push([table.end, (d, prev) => endBeat({ dur: d, words, world: prev })]);
  }

  // Scale to the exact length asked for, then snap the cuts to the music's beat.
  const raw = spec.map(([d]) => d);
  const sum = raw.reduce((a, b) => a + b, 0);
  const scaled = raw.map((d) => (d * L) / sum);
  const grid = opts.music === 'none' || opts.music === 'upload' ? 0.25 : 60 / styleById(opts.music).bpm;
  const durs = quantize(scaled, grid);

  const beats = [];
  let at = 0;
  let prevWorld = null;
  spec.forEach(([, make], i) => {
    const beat = make(durs[i], prevWorld);
    beat.start = at;
    beat.index = i;
    at += beat.dur;
    prevWorld = beat.world;
    beats.push(beat);
  });
  const total = at;
  const endAt = beats.find((b) => b.kind === 'end')?.start ?? total;

  // Cues, made global.
  const cues = [];
  for (const b of beats) for (const c of b.cues || []) cues.push({ ...c, t: b.start + c.t });

  // Ambience: one segment per run of beats in the same world.
  const ambience = [];
  for (const b of beats) {
    const kind = opts.ambience && opts.ambience !== 'auto' ? opts.ambience : ambienceForTheme(themeOf(b.world));
    const last = ambience[ambience.length - 1];
    if (last && last.world === b.world) last.t1 = b.start + b.dur;
    else ambience.push({ world: b.world, kind, t0: b.start, t1: b.start + b.dur });
  }
  // Overlap neighbours slightly so a world change crossfades instead of dipping.
  for (let i = 1; i < ambience.length; i++) {
    ambience[i - 1].t1 = Math.min(total, ambience[i - 1].t1 + 0.4);
    ambience[i].t0 = Math.max(0, ambience[i].t0 - 0.2);
  }

  return { beats, total, endAt, cues, ambience, words };
}

// --- post copy -----------------------------------------------------------------------------

// Captions to paste under the video, one per network, in each one's own register.
export function postCopy(opts, plan) {
  const url = `https://${(plan.words.url || 'edusim3dweb.com').replace(/^https?:\/\//, '').replace(/\/$/, '')}/`;
  const hook = (plan.words.hook || '').replace(/\*/g, '').replace('{world}', worldDef(opts.spotlightWorld || opts.worlds?.[0]).label);
  const worldNames = [...new Set(plan.beats.map((b) => b.world))]
    .filter((k) => k !== 'empty')
    .map((k) => worldDef(k).label);
  const list = worldNames.slice(0, 4).join(', ');
  const what = {
    showcase: 'Explore ready-made worlds, build models out of simple shapes, and program them with blocks or real JavaScript.',
    tour: `Walk into ${list || 'ready-made learning worlds'} — right in the browser.`,
    build: 'Stretch, stack and turn simple shapes into a model, then program it to move.',
    code: 'Start with drag-and-drop blocks, then flip the very same program into real JavaScript.',
    spotlight: `${worldNames[0] || 'This world'} — one of the ready-made worlds in Edusim.`,
  }[opts.template] || '';

  return {
    instagram: [
      `${hook} ✨`,
      '',
      what,
      'Free for every classroom. No account, nothing to install.',
      '',
      'Try it free — link in bio.',
      '',
      '#Edusim #EdTech #STEM #STEAM #CodingForKids #TeachersOfInstagram #3DLearning #ComputerScience',
    ].join('\n'),
    facebook: [
      hook,
      '',
      `${what} Edusim is free, runs in any web browser, and needs no account.`,
      '',
      `Try it with your class: ${url}`,
    ].join('\n'),
    linkedin: [
      hook,
      '',
      `Edusim is a free 3D building-and-coding world for K–8 classrooms. ${what}`,
      '',
      'It runs in any browser — no account, nothing to install, and no student data collected.',
      '',
      `Try it: ${url}`,
      '',
      '#EdTech #K12 #STEMEducation #ComputerScienceEducation #Teachers',
    ].join('\n'),
  };
}
