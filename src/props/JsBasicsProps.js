import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  revolve, solidLoft, solidSurface, extrudeOutline, ball, mergeParts,
  roundedOutline, ringPts, put, smoothNoise3,
} from './LoftKit.js';

// JavaScript Basics -- the world that teaches the Program panel's JavaScript mode. Every
// machine in it ships RUNNING a JavaScript program a student can open and read, and every
// lesson board displays real, syntax-highlighted code -- the same tokens, in the same
// colours, the in-app editor uses. The hero is the Code Beacon, a lighthouse whose lamp is
// a separate object turning on `forever { rotate }`, which is the first program anybody
// reads here and the dome-and-telescope trick (two objects, one motion) taken to a place
// a student can see from the whole world.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// The world's identity colour is the JavaScript yellow, pulled back from the logo's
// #f7df1e: a near-white albedo CLIPS under a full daylight sun+hemi (the volcano's marble
// lesson), and at full saturation the beacon read as plastic. 0xe3c93a keeps the read.
const INK = {
  yellow: 0xe3c93a, yellowDeep: 0xbfa52c, cream: 0xe8e4d4,
  navy: 0x232b38, navyLight: 0x39445a, steel: 0x5a6273, steelDark: 0x363b47,
  stone: 0xb9b2a2, stoneShade: 0x8f887a,
  glass: 0x9fc4d8,
};

// The editor's own token colours, so the code painted on a lesson board is the code a
// student then sees in the Program panel. Drift between the two would teach a palette
// that does not exist.
const TOKEN_COLORS = {
  keyword: '#c792ea', api: '#82aaff', number: '#f78c6c',
  string: '#c3e88d', comment: '#6b7d8c', plain: '#e8eef4',
};

const KEYWORDS = new Set(['await', 'async', 'const', 'let', 'if', 'else', 'for', 'while', 'return', 'true', 'false']);
const API_NAMES = new Set([
  'moveForward', 'moveUp', 'glide', 'rotate', 'goBackToStart', 'wait', 'repeat', 'forever',
  'whenSaid', 'say', 'changeSize', 'setSize', 'setOpacity', 'changeColor', 'markerColor',
  'markerDown', 'markerUp', 'eraseAllMarks', 'duplicate',
]);

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

// ---------------------------------------------------------------------------
// THE CODE BEACON -- the hero lighthouse
// ---------------------------------------------------------------------------

// The lamp's resting height, shared with beaconLamp() and the layout: the lamp is a
// SEPARATE prop (that is the whole point -- it is the object whose program a student
// reads), so the tower and the lamp have to agree on where the lamp room is without
// either being able to ask the other.
export const BEACON_DECK_Y = 37.2;

export function codeBeacon({ seed = 7, height = 46 } = {}) {
  const rng = seededRandom(seed);
  const rock = [];
  const trim = [];
  const glassParts = [];
  const H = height; // the masonry top (cornice) -- the roof and finial ride above

  // --- the plinth: two octagonal steps with a real doorway face ------------
  put(rock, extrudeOutline(ringPts(8.6, 8, { start: Math.PI / 8 }), 2.0), INK.stone,
    [0, 1.0, 0], [Math.PI / 2, 0, 0]);
  put(rock, extrudeOutline(ringPts(7.3, 8, { start: Math.PI / 8 }), 1.6), INK.stone,
    [0, 2.8, 0], [Math.PI / 2, 0, 0]);

  // --- the tower: one lathe, spiral daymark painted by the tint ------------
  //
  // A lighthouse's identity is its DAYMARK, and a spiral daymark is a modulation of one
  // surface's colour -- geometry-free, seam-free, and it reads from the far side of the
  // world. The band coordinate mixes angle and height; two starts, well under the 64
  // segments' Nyquist.
  const T0 = 3.6; // tower base y
  const TH = BEACON_DECK_Y - 1.4 - T0; // masonry shaft height, up to the corbel
  // The shaft's own stations, used BOTH to lathe it and to seat anything on its surface
  // -- the volcano's flankFlow lesson: near a tapering surface, a separate guess is
  // either buried or floating.
  const STATIONS = [
    [6.4, T0], [6.1, T0 + 0.8], [5.6, T0 + 1.6],
    [5.05, T0 + TH * 0.35], [4.35, T0 + TH * 0.7], [3.55, T0 + TH],
  ];
  const rAt = (y) => {
    for (let i = 1; i < STATIONS.length; i++) {
      if (y <= STATIONS[i][1]) {
        const [r0, y0] = STATIONS[i - 1];
        const [r1, y1] = STATIONS[i];
        return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      }
    }
    return STATIONS[STATIONS.length - 1][0];
  };
  // The lathe runs over a FINELY RESAMPLED profile, not the six authored stations: the
  // spiral daymark is a per-vertex tint, and with one vertex per storey its diagonal
  // edge smeared across the whole shaft. Twenty-six rows put a row every 1.2ft, which is
  // what makes the band edge an edge.
  const fine = [];
  for (let i = 0; i <= 26; i++) {
    const y = T0 + (TH * i) / 26;
    fine.push([rAt(y), y]);
  }
  const shaft = lathed(closed(fine), { segments: 64 });
  put(rock, shaft, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // Yellow-major: the band threshold is 0.62, not 0.5, because the JS yellow is the
      // world's identity and an even split read black-first from half the compass. Below
      // y = 6 the skirt is solid navy -- a painted base course, which is also what stops
      // the spiral pinching into a smear where the profile flares.
      if (p.y < 6) {
        const c0 = new THREE.Color(INK.navy);
        return [c0.r, c0.g, c0.b];
      }
      const a = Math.atan2(p.x, p.z);
      const band = ((a / (Math.PI * 2) + p.y / 26) % 1 + 1) % 1;
      const n = smoothNoise3(p.x * 0.4, p.y * 0.4, p.z * 0.4);
      const c = new THREE.Color(band < 0.62 ? INK.yellow : INK.navy)
        .lerp(new THREE.Color(0xffffff), n * 0.08);
      return [c.r, c.g, c.b];
    },
  });

  // --- the doorway, built FORWARD of the solid wall ------------------------
  //
  // No CSG: the arch panel sits proud of the plinth face and its frame proud of that,
  // Machu Picchu's niche rule. The door faces +Z, which the layout points at the spawn.
  const doorway = (w, h, d, colour, z) => {
    const arch = [];
    const hw = w / 2;
    arch.push([-hw, 0], [hw, 0], [hw, h - hw]);
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      arch.push([Math.cos(a) * hw, h - hw + Math.sin(a) * hw]);
    }
    put(trim, extrudeOutline(arch, d), colour, [0, 0, z]);
  };
  const doorZ = 7.3 * Math.cos(Math.PI / 8); // the plinth's +Z face
  doorway(3.6, 7.0, 0.5, INK.navy, doorZ + 0.02);
  doorway(4.6, 7.6, 0.6, INK.stoneShade, doorZ + 0.1);
  // A lamp bracket over the door, so the entrance reads at dusk-coloured angles.
  put(trim, ball(0.32, 10), INK.yellow, [0, 8.6, doorZ + 0.4]);

  // --- portholes up the +Z face, each a ring round a sunk navy disc --------
  for (const y of [14, 21, 28]) {
    const r = rAt(y);
    put(trim, new THREE.TorusGeometry(0.62, 0.13, 8, 22), INK.steel, [0, y, r + 0.02]);
    put(trim, new THREE.CylinderGeometry(0.55, 0.55, 0.5, 18), INK.navy,
      [0, y, r - 0.18], [Math.PI / 2, 0, 0]);
  }

  // --- corbel, gallery deck and railing ------------------------------------
  const corbelY = T0 + TH;
  put(rock, lathed(closed([
    [3.55, corbelY], [4.3, corbelY + 0.55], [4.95, corbelY + 1.05], [5.15, corbelY + 1.4],
  ]), { segments: 48 }), INK.stoneShade);
  put(rock, new THREE.CylinderGeometry(5.5, 5.5, 0.5, 48), INK.navy, [0, BEACON_DECK_Y - 0.25, 0]);
  // Sixteen posts and a handrail ring. The rail is a torus at the posts' own radius, so
  // every post meets it by construction.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    put(trim, new THREE.CylinderGeometry(0.07, 0.07, 3.0, 8), INK.steelDark,
      [Math.sin(a) * 5.15, BEACON_DECK_Y + 1.5, Math.cos(a) * 5.15]);
  }
  put(trim, new THREE.TorusGeometry(5.15, 0.09, 8, 40), INK.steelDark,
    [0, BEACON_DECK_Y + 3.0, 0], [Math.PI / 2, 0, 0]);
  put(trim, new THREE.TorusGeometry(5.15, 0.07, 8, 40), INK.steelDark,
    [0, BEACON_DECK_Y + 1.7, 0], [Math.PI / 2, 0, 0]);

  // --- the lamp room: mullions, glazing, cornice, roof ---------------------
  //
  // The glazing is one translucent cylinder with castShadow OFF -- the museum-skylight
  // rule: whether sun reaches the deck inside is decided entirely by what casts.
  const roomBase = BEACON_DECK_Y;
  const roomH = 5.6;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    put(trim, new THREE.CylinderGeometry(0.14, 0.14, roomH, 10), INK.steelDark,
      [Math.sin(a) * 3.1, roomBase + roomH / 2, Math.cos(a) * 3.1]);
  }
  put(glassParts, new THREE.CylinderGeometry(3.0, 3.0, roomH - 0.5, 32, 1, true), INK.glass,
    [0, roomBase + roomH / 2, 0]);
  put(rock, lathed(closed([
    [3.55, roomBase + roomH], [3.7, roomBase + roomH + 0.4], [3.45, roomBase + roomH + 0.7],
  ]), { segments: 40 }), INK.navy);
  // The roof cone, a finial ball and the rod -- closed at the axis, so there is no open
  // ring at the top of the one prop everything else in the world looks up at.
  put(rock, lathed(closed([
    [3.45, roomBase + roomH + 0.7], [2.2, roomBase + roomH + 2.2], [0.6, roomBase + roomH + 3.3],
    [0.22, roomBase + roomH + 3.6],
  ]), { segments: 40 }), INK.navy);
  put(trim, ball(0.42, 14), INK.yellow, [0, roomBase + roomH + 4.0, 0]);
  put(trim, new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8), INK.steelDark,
    [0, roomBase + roomH + 4.9, 0]);

  const rockMesh = mesh(mergeParts(rock), standard({
    vertexColors: true, roughness: 0.88, metalness: 0.04,
    ...relief('stone', { seed, repeat: 10, strength: 0.55 }),
  }));
  const trimMesh = mesh(mergeParts(trim), standard({
    vertexColors: true, roughness: 0.55, metalness: 0.35,
  }));
  const glassMesh = mesh(mergeParts(glassParts), standard({
    vertexColors: true, roughness: 0.18, metalness: 0.1,
    transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false,
  }));
  glassMesh.castShadow = false;
  void rng;
  return group(rockMesh, trimMesh, glassMesh);
}

// The lamp -- a SEPARATE object standing on the beacon's deck, because it is the thing
// whose JavaScript a student opens. A Fresnel-ribbed drum with a reflector vane and two
// opposed beam fans, so its rotation is visible from anywhere in the world; the layout
// ships it with `forever { rotate }`.
export function beaconLamp({ seed = 9, beam = 30 } = {}) {
  const metal = [];
  const glow = [];
  const beams = [];

  // Pedestal and drum. The drum's ribs are lathe rings, so the lens reads as a lens.
  put(metal, lathed(closed([
    [1.15, 0], [0.95, 0.25], [0.5, 0.5], [0.42, 1.1], [0.9, 1.3],
  ]), { segments: 26 }), INK.steelDark);
  const profile = [[0.9, 1.3]];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const y = 1.3 + t * 2.2;
    const r = 1.05 + Math.sin(t * Math.PI) * 0.22 + (i % 2 ? 0.07 : 0);
    profile.push([r, y]);
  }
  profile.push([0.55, 3.7]);
  put(glow, lathed(closed(profile), { segments: 30 }), INK.yellow);
  put(metal, lathed(closed([[0.55, 3.7], [0.3, 3.95], [0.12, 4.05]]), { segments: 18 }), INK.steelDark);

  // The reflector vane: an upright plate through the drum, so even the drum's silhouette
  // changes as it turns.
  put(metal, new THREE.BoxGeometry(0.14, 2.0, 1.7), INK.steel, [0, 2.4, 0]);

  // Two opposed beam fans -- horizontal cones, authored along +/-Z. `fog: false`, or the
  // far end of each beam adds the fog colour onto a background that is already the fog
  // colour (Under the Sea's light-shaft rule).
  for (const s of [1, -1]) {
    const cone = new THREE.ConeGeometry(2.6, beam, 14, 1, true);
    cone.rotateX(-s * Math.PI / 2);
    put(beams, cone, 0xfff2b8, [0, 2.4, s * beam / 2]);
  }

  const metalMesh = mesh(mergeParts(metal), standard({
    vertexColors: true, roughness: 0.5, metalness: 0.4,
  }));
  const glowMesh = mesh(mergeParts(glow), standard({
    vertexColors: true, roughness: 0.35, emissive: 0xf5c93c, emissiveIntensity: 1.3,
  }));
  const beamMesh = mesh(mergeParts(beams), standard({
    vertexColors: true, roughness: 1, transparent: true, opacity: 0.16,
    emissive: 0xf5d878, emissiveIntensity: 0.8, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  }));
  beamMesh.castShadow = false;
  beamMesh.receiveShadow = false;
  glowMesh.castShadow = false;
  void seed;
  return group(metalMesh, glowMesh, beamMesh);
}

// ---------------------------------------------------------------------------
// THE CODE BOARD -- a lesson panel showing real, highlighted JavaScript
// ---------------------------------------------------------------------------

// Draws one line of code with the editor's own token colours. A tiny tokenizer rather
// than an import: JsProgram's highlighter emits HTML for a DOM pane, and this is a
// canvas -- but the colour TABLE above is the shared fact that keeps them one language.
function drawCodeLine(ctx, line, x, y) {
  if (/^\s*\/\//.test(line)) {
    ctx.fillStyle = TOKEN_COLORS.comment;
    ctx.fillText(line, x, y);
    return;
  }
  const re = /('[^']*'?)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$'\d]+)/g;
  let cx = x;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const [text, str, num, ident] = m;
    ctx.fillStyle = str ? TOKEN_COLORS.string
      : num ? TOKEN_COLORS.number
        : ident && KEYWORDS.has(ident) ? TOKEN_COLORS.keyword
          : ident && API_NAMES.has(ident) ? TOKEN_COLORS.api
            : TOKEN_COLORS.plain;
    ctx.fillText(text, cx, y);
    cx += ctx.measureText(text).width;
  }
}

export function codeBoard({
  number = 1, title = 'Lesson', code = '', caption = '', accent = '#e3c93a',
} = {}) {
  const W = 8.6;
  const H = 6.2;
  const LIFT = 2.5;
  const parts = [];

  // Posts OUTSIDE the panel -- the activity boards' lesson: this text is left-aligned,
  // so an inset post stands in front of the first character of every line.
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.16, 0.2, LIFT + H * 0.72, 12), INK.steelDark,
      [sx * (W / 2 + 0.42), (LIFT + H * 0.72) / 2, -0.1]);
  }
  // A solid backing slab: a big flat panel viewed from behind must be a board, not a
  // black hole (the anatomy charts' rule).
  put(parts, extrudeOutline(roundedOutline(W / 2 + 0.22, H / 2 + 0.22, 0.35, 3), 0.34),
    INK.navy, [0, LIFT + H / 2, -0.2]);

  const texture = canvasTexture(1024, Math.round(1024 * H / W), (ctx, w, h) => {
    ctx.fillStyle = '#171c24';
    ctx.fillRect(0, 0, w, h);
    // Window chrome, so the panel reads as "an editor" before a word is legible.
    ctx.fillStyle = '#232b38';
    ctx.fillRect(0, 0, w, h * 0.115);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ['#e0453c', '#f2c14e', '#74c043'][i];
      ctx.beginPath();
      ctx.arc(46 + i * 44, h * 0.058, 13, 0, Math.PI * 2);
      ctx.fill();
    }
    // The lesson number chip and the title.
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(w - 60, h * 0.058, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#171c24';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(number), w - 60, h * 0.058 + 12);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2f5f7';
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.fillText(title, 200, h * 0.072);
    ctx.fillStyle = accent;
    ctx.fillRect(0, h * 0.115, w, 5);

    // The code, sized to fit the longest line -- cardTexture's lesson: a panel whose
    // last characters run off the edge is worse than one set a size smaller.
    const lines = String(code).split('\n');
    const mono = (size) => `500 ${size}px ui-monospace, Menlo, Consolas, monospace`;
    let size = 46;
    ctx.font = mono(size);
    const longest = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    size = Math.min(46, Math.floor(size * (w - 90) / longest));
    ctx.font = mono(size);
    const lineH = size * 1.52;
    let y = h * 0.115 + 5 + lineH * 1.1;
    for (const line of lines) {
      drawCodeLine(ctx, line, 46, y);
      y += lineH;
    }

    if (caption) {
      ctx.fillStyle = '#9fb0bd';
      ctx.font = 'italic 400 30px Georgia, serif';
      ctx.fillText(caption, 46, h - 34);
    }
  });

  // map + emissiveMap are the SAME texture: the face stays legible whatever angle the
  // sun takes, without a light. No vertexColors on this mesh -- map times vertex white
  // would be a no-op, and times anything else would be the bear-dens multiply.
  const face = mesh(
    new THREE.PlaneGeometry(W, H),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.32, roughness: 0.85 }),
  );
  face.position.set(0, LIFT + H / 2, 0.0);

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.7, metalness: 0.25 })),
    face,
  );
}

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

// A double-start golden screw on a plinth -- the `forever { rotate }` demonstration. A
// screw was chosen over a vane wheel because a surface of revolution spun about its own
// axis is pixel-identical at every angle (the twister's lesson): a helix has no such
// symmetry, so its turning is unmissable.
export function codeSpinner({ seed = 11, height = 7.4 } = {}) {
  const matte = [];
  const bright = [];
  const T = height - 1.0;

  put(matte, lathed(closed([
    [1.9, 0], [1.75, 0.35], [1.15, 0.6], [1.0, 0.95],
  ]), { segments: 28 }), INK.steelDark);
  put(matte, new THREE.CylinderGeometry(0.2, 0.24, T, 14), INK.steel, [0, 0.95 + T / 2, 0]);

  // Two ribbons, each a closed strip whose inner edge lies AT the pole's radius -- the
  // screw touches its shaft by construction, so there is no gap to close.
  for (const phase of [0, Math.PI]) {
    put(bright, solidSurface({
      nu: 10, nv: 56,
      point: (u, v) => {
        const y = 1.35 + v * (T - 1.0);
        const a = v * Math.PI * 4.4 + phase;
        const r = 0.2 + u * 1.25;
        return [Math.sin(a) * r, y, Math.cos(a) * r];
      },
      thick: () => 0.055,
    }), phase === 0 ? INK.yellow : INK.cream);
  }
  // Collars cap the screw's two open ends against the shaft.
  for (const y of [1.35, 0.35 + T]) {
    put(matte, new THREE.TorusGeometry(0.3, 0.14, 10, 20), INK.steelDark,
      [0, y, 0], [Math.PI / 2, 0, 0]);
  }
  put(bright, ball(0.4, 16), INK.yellow, [0, 0.95 + T + 0.35, 0]);

  void seed;
  return group(
    mesh(mergeParts(matte), standard({ vertexColors: true, roughness: 0.6, metalness: 0.35 })),
    mesh(mergeParts(bright), standard({ vertexColors: true, roughness: 0.35, metalness: 0.25 })),
  );
}

// A faceted near-white gem in a claw collar -- the `changeColor` demonstration. Near
// WHITE deliberately: a colour tint MULTIPLIES, so white is the one base every colour in
// the cycle actually shows on. The facets stay flat because an IcosahedronGeometry is
// non-indexed and computeVertexNormals on a non-indexed geometry can only make face
// normals -- the reef-rock trap, used on purpose for once.
export function moodCrystal({ seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const matte = [];
  const gem = [];

  put(matte, lathed(closed([
    [1.7, 0], [1.55, 0.3], [1.05, 0.55], [0.95, 1.5], [1.25, 1.8], [1.05, 2.0],
  ]), { segments: 26 }), INK.steelDark);
  // Four claws, each rooted inside the collar and leaning onto the gem's own surface.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    put(matte, new THREE.CylinderGeometry(0.09, 0.16, 1.5, 8), INK.steel,
      [Math.sin(a) * 0.85, 2.45, Math.cos(a) * 0.85],
      [Math.cos(a) * -0.4, 0, Math.sin(a) * 0.4]);
  }
  const rock = new THREE.IcosahedronGeometry(1.15, 0);
  rock.scale(1, 1.6, 1);
  rock.rotateY(rng() * 2);
  put(gem, rock, 0xf0f2f6, [0, 3.3, 0]);

  return group(
    mesh(mergeParts(matte), standard({ vertexColors: true, roughness: 0.55, metalness: 0.4 })),
    mesh(mergeParts(gem), standard({
      vertexColors: true, roughness: 0.22, metalness: 0.05,
      emissive: 0x1a1c22, emissiveIntensity: 0.4,
    })),
  );
}

// A toy alphabet block -- the "first `await`" practice object. Big, soft-cornered, with
// its letter proud on all four sides, and nothing else: the one job it has is to be the
// least intimidating thing a student has ever programmed.
export function practiceBlock({ seed = 15, letter = 'J', color = 0xe3c93a, size = 2.7 } = {}) {
  const rng = seededRandom(seed);
  const S = size;
  const parts = [];

  // A soft cube: a vertical loft whose section rounds harder at the top and bottom, so
  // every edge and corner is closed and eased -- a die, not a crate.
  put(parts, solidLoft([
    { d: 0, w: S * 0.44, up: S * 0.44, dn: S * 0.44, round: 0.75 },
    { d: S * 0.1, w: S * 0.5, up: S * 0.5, dn: S * 0.5, round: 0.35 },
    { d: S * 0.9, w: S * 0.5, up: S * 0.5, dn: S * 0.5, round: 0.35 },
    { d: S, w: S * 0.44, up: S * 0.44, dn: S * 0.44, round: 0.75 },
  ], { sides: 30, samples: 10, axis: 'y' }), color);

  const dark = new THREE.Color(color).multiplyScalar(0.55).getHex();
  const tex = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#f4efe2';
    ctx.beginPath();
    ctx.roundRect(14, 14, 228, 228, 34);
    ctx.fill();
    ctx.fillStyle = `#${dark.toString(16).padStart(6, '0')}`;
    ctx.font = '800 150px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 140);
  });
  const plates = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const plate = new THREE.PlaneGeometry(S * 0.62, S * 0.62);
    put(plates, plate, 0xffffff,
      [Math.sin(a) * (S * 0.5 + 0.02), S * 0.5, Math.cos(a) * (S * 0.5 + 0.02)], [0, a, 0]);
  }
  void rng;
  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.65, metalness: 0.02 })),
    mesh(mergeParts(plates), standard({
      vertexColors: true, map: tex, roughness: 0.7,
      transparent: true, alphaTest: 0.05,
    })),
  );
}
