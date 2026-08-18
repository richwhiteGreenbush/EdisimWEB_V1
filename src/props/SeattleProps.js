import * as THREE from 'three';
import {
  standard, mesh, group, relief, seededRandom, randomIn,
} from '../PropKit.js';
import {
  solidLoft, grooveAt, sweepProfile, extrudeOutline, revolve, solidSurface,
  chain, spike, dome, ball, tube, mergeParts, tintGeometry, weather, smoothNoise3,
  roundedOutline, lensOutline, ringPts, put, placed, smoothed,
} from './LoftKit.js';

// Seattle Center -- the 74-acre campus left behind by the 1962 Century 21 Exposition, with
// the three things everybody actually goes for: the Space Needle, the International
// Fountain and the Monorail.
//
// THE ONE DECISION THAT SHAPES THIS FILE: this is a world about a SKYLINE, which no other
// world here is. Every previous world is objects standing on a floor that you walk between;
// this one is dominated by a single 151ft object seen from 220ft away, which means the
// budget goes somewhere different. Detail that lives in a surface -- grain, weathering,
// tooling marks -- is invisible at that range and buys nothing. What reads is SILHOUETTE
// and PROFILE: the wasp waist of the tripod, the exact flare of the saucer's underside, the
// step of the halo. So the Needle spends its triangles on a 120-sided saucer and a
// nine-station leg loft, and almost none on texture.
//
// The corollary is that the small things have to earn their place at walking distance
// instead. The fountain, the science centre's exhibits and the planting are all things a
// student stands next to, and those are where the surface detail goes.
//
// SCALE. Nothing here is full size and it could not be: WORLD_BOUND_RADIUS is 195ft, and
// the real campus is 1,800ft across with a 605ft tower in it. The Needle is built at 1/4
// (151ft), the fountain at 1/3, the science centre's arches at 1/2.4, and the monorail at
// close to full size because a train is the one thing whose scale a student already knows.
// Every placard states the real figure, so the reduction teaches rather than misleads --
// the same contract Egypt, the Colosseum and the Taj hold to.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// THE 1962 COLOURS ARE A REAL, NAMED, TEACHABLE PALETTE, which is exactly the kind this
// project keeps looking for -- Egypt's six mineral pigments, Fantastic Voyage's per-system
// accents. The Century 21 Exposition painted the Space Needle in four: Astronaut White for
// the core, Orbital Olive for the legs, Re-entry Red for the halo and Galaxy Gold for the
// roof. The tower has been repainted many times since and is essentially white today, but
// the roof went back to Galaxy Gold for the 50th anniversary in 2012 and stayed -- so the
// model is painted as it is NOW, with the gold roof, and the placard names all four.
const CENTURY = {
  astronautWhite: 0xeceae3,
  astronautShade: 0xd8d5cc,
  orbitalOlive: 0x8e8b5e,
  reentryRed: 0xb4402e,
  galaxyGold: 0xd6a343,
  goldDeep: 0xb8862d,
};

// Structure and paving. Seattle Center is a concrete campus and concrete is never one
// colour: precast panels, poured-in-place, exposed aggregate and asphalt all read
// differently, and using one grey for all of them is what makes a plaza look like a car
// park.
const CONCRETE = {
  precast: 0xd5d1c6,
  precastShade: 0xbdb8ab,
  poured: 0xa9a69c,
  aggregate: 0x9a978c,
  kerb: 0xc2beb2,
  asphalt: 0x565452,
  basin: 0xcfd3cd,
};

const STEEL = {
  galv: 0x9aa0a4,
  dark: 0x4e5459,
  bright: 0xc3c9cd,
  glassBlue: 0x3f5f70,
  glassPale: 0x6f95a6,
};

// MoPOP is sheet metal in six anodised colours and it is the single most colourful object
// on the campus. Gehry's building is the reason this palette is worth widening at all --
// nothing else here would justify a magenta.
const GEHRY = {
  gold: 0xc9962f,
  silver: 0xb9c2c8,
  purple: 0x6c4c86,
  red: 0xa8332f,
  skyBlue: 0x4f86a8,
  copper: 0x8f5a34,
};

// Chihuly glass. These are the actual hues of the Glasshouse sculpture and the Sun --
// saturated, warm and lit from within, which is what glass does and paint does not. They
// are carried on a slightly EMISSIVE material rather than a transparent one: a see-through
// surface loses most of its apparent colour (the lesson from Fantastic Voyage's lungs), and
// transparency is the most expensive thing on an integrated GPU.
const GLASS = {
  amber: 0xe8a021, saffron: 0xf0c032, vermilion: 0xd8442a, rose: 0xd4487e,
  cobalt: 0x2f5fbe, jade: 0x2f9c78, chartreuse: 0xa8cc39, violet: 0x7a45b0,
};

// Pacific Northwest planting. The rhododendron is Washington's state flower and the
// campus is full of them; the rest is what actually grows here.
const PLANT = {
  // LIGHTER THAN A PHOTOGRAPH OF FOLIAGE LOOKS. A fir's needles are dark, but a fir's
  // CANOPY is not: most of what you see is light scattering off thousands of needle tips.
  // Painted at the needle's own value the tree renders as a black cut-out against a bright
  // sky -- the Ellis Island steamship trap with the sign reversed, and it cost this world
  // four trees that read as television aerials.
  firDark: 0x3c6242, firMid: 0x4e7c4c, firPale: 0x6d9a58,
  cedarBark: 0x6b4a35, trunk: 0x5d4a3a, trunkPale: 0x7a6552,
  mapleRed: 0xa8322b, mapleFlame: 0xd05a25, mapleAmber: 0xd98f2c,
  cherryBlossom: 0xf2c2d4, cherryDeep: 0xdd97b4,
  lawn: 0x4f7f3c, leaf: 0x3f6b34, leafPale: 0x6d9a4a,
  rhodoRose: 0xd2447c, rhodoMagenta: 0xa8348c, rhodoWhite: 0xf0e6ee,
  rhodoCoral: 0xe8663f, rhodoLilac: 0x9a6fc4,
  dahliaGold: 0xf0a92c, dahliaScarlet: 0xd2302c, dahliaPlum: 0x8c3560,
  bark: 0x4a3d33,
};

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// A ring of circular stations for a loft that is a surface of revolution but needs a WARP.
// `revolve` cannot take one -- it interpolates a fixed profile -- so anything whose radius
// has to be modulated round the axis (the Needle's saucer ribs, the fountain dome's nozzle
// field, MoPOP's shingle courses) is built as a solidLoft on the 'y' axis instead, with the
// profile's r fed into all three lateral channels and round held at 1.
function lathe(profile) {
  return profile.map(([r, y]) => ({ d: y, w: r, up: r, dn: r, round: 1 }));
}

// `revolve` DECIDES ITS WINDING FROM THE PROFILE'S DIRECTION, and a profile written the way
// anybody writes one -- from the bottom up -- comes out INSIDE OUT.
//
// Measured rather than reasoned about: a [[3,0],[3,2]] cylinder returns a mean radial
// normal dot of -0.999, and reversing the same two points returns +0.999. Under a
// FrontSide material that does not look like a missing surface, it looks like a DARK one --
// you are seeing the far inner wall lit by its own inverted normals. The International
// Fountain's grass amphitheatre rendered as a black ring 72ft across before this was found,
// and it read as a shadow problem rather than as a winding one.
//
// So nothing in this file calls `revolve` directly. `lathed` takes the profile in the
// natural bottom-to-top order and reverses it.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// EXTRUDEOUTLINE IS CENTRED ON ITS OWN DEPTH -- it runs from -depth/2 to +depth/2, never
// from 0. That is exactly right for a moulding, a picture frame or a rubbing strake, which
// is what it was written for, and it is a trap for anything authored from the ground up:
// the first pass of this file put the science pavilion's floor 7.8ft underground, the
// Armory's 9.5ft under, and every one of the science centre's arcade columns half buried.
// Nothing errors and nothing looks obviously broken -- the buildings simply come out
// squat, which reads as a proportion mistake rather than as an offset one.
//
// So neither of these takes a raw extrusion. `upright` stands a prism ON the ground from
// an outline read in plan; `slab` lays one flat with its TOP at the height given.
function upright(list, colour, outline, height, { at = [0, 0, 0], rotY = 0, tint = null } = {}) {
  put(list, extrudeOutline(outline, height), colour,
    [at[0], at[1] + height / 2, at[2]], [-Math.PI / 2, rotY, 0], tint ? { tint } : null);
}

function slab(list, colour, { halfW, halfD, thick, at, ease = 0.6, rotY = 0 }) {
  put(list, extrudeOutline(roundedOutline(halfW, halfD, ease, 3), thick), colour,
    [at[0], at[1] - thick / 2, at[2]], [Math.PI / 2, rotY, 0]);
}

// ---------------------------------------------------------------------------
// THE SPACE NEEDLE
// ---------------------------------------------------------------------------

// 605ft in reality, built here at 1/4. Four things carry the identification, and they are
// worth listing in the order they matter, because getting any of them wrong leaves a
// generic observation tower:
//
//  1. THE WASP WAIST. The three legs spread to a 120ft tripod at the ground, sweep sharply
//     inward to their narrowest at about two thirds height, and then FLARE BACK OUT to
//     carry the saucer. Miss the flare and the tower reads as a cooling tower; miss the
//     waist and it reads as a pylon.
//  2. THE SAUCER'S UNDERSIDE. It is not a disc -- it is a broad shallow cone with radial
//     ribs, and its widest point is a hard horizontal step (the halo), not a rounded edge.
//  3. THE CORE IS SEPARATE FROM THE LEGS. You can see daylight between them for most of
//     the height. Fill that in and it becomes a chimney.
//  4. THE GOLD ROOF. One warm colour on an otherwise white object, and it is the thing
//     that photographs.
//
// The ribs are a WARP on the saucer's own surface rather than applied fins, which is what
// makes "leave no open spaces" structural here: a displacement of a surface cannot open a
// gap in it. That does bound the rib count -- 12 ribs need about 9 samples each to escape
// aliasing, hence 120 sides.
export function spaceNeedle({ seed = 62 } = {}) {
  const parts = [];
  const glazing = [];

  const DECK = 126; // the observation level's floor, 520ft in reality
  const SPIRE = 151.25; // 605ft
  const LEG_TURNS = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

  // --- the three legs ----------------------------------------------------
  //
  // Authored once curving out along +X and rotated into place, which is the only way the
  // three come out identical. `a` offsets the section's centre along the first lateral
  // axis -- X, for a loft running up 'y' -- so the leg's sweep IS the a channel.
  //
  // The section is a rounded rectangle far wider tangentially (up/dn = Z) than radially
  // (w = X): these legs are blades seen edge-on from outside the tripod and broad from
  // between them, which is what gives the tower a different silhouette from every angle.
  const legStations = [
    { d: -2.5, a: 15.2, w: 1.62, up: 2.85, dn: 2.85, round: 2.0 },
    { d: 8, a: 13.2, w: 1.46, up: 2.6, dn: 2.6, round: 1.95 },
    { d: 26, a: 9.7, w: 1.26, up: 2.24, dn: 2.24, round: 1.9 },
    { d: 48, a: 6.7, w: 1.08, up: 1.92, dn: 1.92, round: 1.85 },
    { d: 70, a: 4.8, w: 0.94, up: 1.68, dn: 1.68, round: 1.8 },
    { d: 90, a: 4.0, w: 0.86, up: 1.52, dn: 1.52, round: 1.75 },
    { d: 106, a: 4.2, w: 0.82, up: 1.45, dn: 1.45, round: 1.75 },
    { d: 117, a: 6.0, w: 0.8, up: 1.42, dn: 1.42, round: 1.75 },
    { d: 125, a: 8.6, w: 0.78, up: 1.4, dn: 1.4, round: 1.75 },
  ];
  const leg = solidLoft(legStations, { sides: 20, samples: 40, axis: 'y' });
  for (const turn of LEG_TURNS) put(parts, leg, CENTURY.astronautWhite, null, [0, turn, 0]);

  // --- the core ----------------------------------------------------------
  //
  // Three grooves running the full height, because the real core carries its elevator
  // tracks on the outside and they are what stop a 130ft white cylinder reading as a pipe.
  // A groove, not applied rails: a modulation of the core's own surface cannot come adrift
  // from it, and at 24 sides three grooves have eight samples each.
  const coreStations = lathe([
    [3.6, -2], [3.5, 6], [3.1, 30], [2.7, 62], [2.35, 96], [2.2, 118], [2.15, 133],
  ]);
  put(parts, solidLoft(coreStations, {
    sides: 24,
    samples: 26,
    axis: 'y',
    warp: (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * 3), 0.5, s.w * 0.22),
  }), CENTURY.astronautShade);

  // Ties from each leg to the core. The real tower has them and without something crossing
  // the gap the three legs and the shaft read as four unrelated poles standing in a bunch.
  for (const turn of LEG_TURNS) {
    for (const [y, inner, outer] of [[62, 2.72, 5.5], [88, 2.4, 4.6], [110, 2.2, 4.6]]) {
      const g = extrudeOutline(roundedOutline(0.34, 0.3, 0.12, 2), outer - inner);
      put(parts, g, CENTURY.astronautShade,
        [Math.cos(turn) * ((inner + outer) / 2), y, Math.sin(turn) * ((inner + outer) / 2)],
        [0, -turn + Math.PI / 2, 0]);
    }
  }

  // --- the base ----------------------------------------------------------
  // Foot pads under each leg, and the low pavilion the lifts run down into.
  for (const turn of LEG_TURNS) {
    put(parts, lathed([[3.4, 0], [3.4, 1.5], [2.6, 2.4], [0, 2.4]], { segments: 14 }),
      CONCRETE.poured, [Math.cos(turn) * 15.2, 0, Math.sin(turn) * 15.2]);
  }
  put(parts, lathed([
    [0, 0], [11.4, 0], [11.4, 6.4], [12.6, 6.9], [12.6, 7.4], [11.0, 7.9], [0, 7.9],
  ], { segments: 40 }), CONCRETE.precast);
  // The pavilion's glazed face, standing a hair proud so it is a wall and not a stripe.
  put(glazing, lathed([[11.5, 1.1], [11.5, 5.9]], { segments: 40 }), STEEL.glassBlue);

  // --- the top house -----------------------------------------------------
  //
  // ONE closed solid of revolution from the underside apex to the roof apex, so there is no
  // seam anywhere on the most-looked-at object in the world. The halo's hard horizontal
  // step at 127.6-130.6 is the profile's own doing; the two glazed bands are a TINT on this
  // same solid rather than separate rings, for the same reason.
  const saucer = lathe([
    [0.001, 119.4], [3.4, 120.2], [6.9, 121.7], [10.6, 123.5], [13.8, 125.3],
    [16.0, 126.6], [17.4, 127.7], [17.55, 129.3], [16.9, 130.5], [15.1, 130.7],
    [14.0, 131.0], [13.65, 131.5], [13.5, 136.2], [12.5, 137.3], [10.1, 138.7],
    [6.8, 140.1], [3.3, 141.0], [0.001, 141.3],
  ]);
  const RIBS = 12;
  const top = solidLoft(saucer, {
    sides: 120,
    samples: 46,
    axis: 'y',
    // Ribs on the underside only, fading out before the halo step -- above it the surface is
    // glazing and roof, neither of which is ribbed.
    //
    // TWO THINGS WERE WRONG HERE AND ONE OF THEM IS A CLASSIC. `THREE.MathUtils.smoothstep`
    // takes (x, min, max), and this was written `smoothstep(0.36, 0.1, t)` -- reading as
    // "from 0.36 down to 0.1 over t", which is not what the function does at all. It returned
    // 1 everywhere below t = 0.36 and then TAILED OFF UPWARD, so the ribs ran over the
    // glazing and the roof instead of stopping at the halo. Nothing errors; the field is
    // simply in the wrong place. The second was amplitude: at half a foot on a 35ft saucer
    // seen from 130ft below, a rib is a fifth of a degree and there is nothing to see.
    warp: (t, u, s) => {
      const under = 1 - THREE.MathUtils.smoothstep(t, 0.06, 0.34);
      if (under <= 0) return 0;
      const field = Math.cos(u * Math.PI * 2 * RIBS);
      return -Math.min(s.w * 0.22, 1.5) * under * (0.5 - field * 0.5);
    },
  });
  put(parts, top, 0xffffff, null, null, {
    // `keepColor` IS NOT OPTIONAL WHEREVER `tint` IS USED, and leaving it off is silent.
    // mergeParts applies the tint and then, unless told otherwise, OVERWRITES the whole
    // colour attribute with the part's flat colour -- so the work is done and thrown away.
    // Every band on this saucer, the train's livery and MoPOP's six colours were all
    // computed correctly and then wiped, and the only symptom was that the most-looked-at
    // object in the world came out uniformly white.
    keepColor: true,
    // WHITE SENTINEL, then the tint supplies every colour. Painted white-then-multiplied is
    // the only way a per-vertex tint can produce a dark glass band on a white body -- a
    // multiply cannot turn a pale colour into a saturated dark one, only into a darker
    // version of itself. Same trick the heart's red/blue convention uses.
    tint: (p) => {
      const y = p.y;
      const c = new THREE.Color(
        y > 136.5 ? CENTURY.galaxyGold
          : y > 131.4 ? STEEL.glassBlue
            : y > 130.4 ? CENTURY.astronautWhite
              : y > 127.5 ? STEEL.glassPale
                : CENTURY.astronautWhite,
      );
      // SHADE THE RIBS AS WELL AS CUTTING THEM. Geometry alone cannot carry them: the
      // underside is nearly horizontal, a warp can only displace radially, and a radial
      // push on a horizontal surface barely changes which way it faces -- so the ribs are
      // there and invisible. Darkening the troughs is what a real rib's own shadow does,
      // and it costs nothing. `u` is recovered from the point's own bearing.
      if (y < 127.4) {
        const u = Math.atan2(p.z, p.x) / (Math.PI * 2);
        const k = 0.80 + 0.20 * (0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 12));
        return [c.r * k, c.g * k, c.b * k];
      }
      return [c.r, c.g, c.b];
    },
  });

  // Mullions on the observation glass, and the halo's rail. Slender members standing proud
  // of a 120-sided surface: the sagitta there is under a hundredth of a foot, so 0.06 of
  // clearance is a hundred times what z-fighting needs.
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    put(parts, extrudeOutline(roundedOutline(0.09, 0.12, 0.05, 1), 4.7), CENTURY.astronautWhite,
      [Math.cos(a) * 13.62, 131.5 + 4.7 / 2, Math.sin(a) * 13.62], [-Math.PI / 2, 0, 0]);
  }
  put(parts, lathed([[16.0, 130.7], [16.0, 133.1], [16.5, 133.1], [16.5, 130.7]], { segments: 60 }),
    CENTURY.astronautShade);
  // The halo's outer face carries the one saturated colour on the tower's body: this is
  // where Re-entry Red actually was in 1962, and a thin band of it is what stops the whole
  // object reading as a white spike.
  // Wider than the first pass's 1.1ft. At 150ft a one-foot band is a third of a degree --
  // three pixels, which is not a colour, it is a hairline. This is the only saturated thing
  // on the tower's body and it has to survive the distance it is actually seen from.
  put(parts, lathed([[17.66, 127.5], [17.66, 129.6]], { segments: 120 }), CENTURY.reentryRed);

  // --- the spire ---------------------------------------------------------
  // Tapering to nothing, which is what a mast does. A tube ending at radius 0 closes itself
  // -- right here, and wrong anywhere the member has a real cut end.
  put(parts, tube([[0, 140.6, 0], [0, 145, 0], [0, 151.25, 0]], [0.62, 0.34, 0.0], { sides: 10 }));
  parts[parts.length - 1].color = CENTURY.astronautShade;
  put(parts, ball(0.42, 8), CENTURY.reentryRed, [0, 149.4, 0]);

  return group(
    mesh(
      weather(mergeParts(parts), { amount: 0.05, scale: 0.02, wash: 0.06, low: 0, fade: 30, seed }),
      standard({ vertexColors: true, roughness: 0.62, metalness: 0.12, ...relief('metal', { seed, repeat: 18, strength: 0.5 }) }),
    ),
    mesh(mergeParts(glazing), standard({ vertexColors: true, roughness: 0.16, metalness: 0.45 })),
  );
}

// ---------------------------------------------------------------------------
// THE INTERNATIONAL FOUNTAIN
// ---------------------------------------------------------------------------

// A 220ft bowl with a silver dome in the middle, built here at 1/3.
//
// THE BASIN IS SHALLOW ON PURPOSE, and that is a constraint the app imposes rather than a
// simplification. PlayerController walks on the TERRAIN mesh and never on props, so a
// genuinely sunken bowl would be a hole a student walks straight over at grass level,
// looking down at their own feet standing on nothing. What works instead is a broad grass
// berm rising AROUND the basin: the ground the student walks on stays where it is, the
// amphitheatre reads correctly because it is above them, and the water sits just below
// their feet where wading into it looks like wading.
export function internationalFountain({ seed = 62, jets = true } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const water = [];

  const R_BERM = 36;
  const R_RIM = 26.5;

  // The grass amphitheatre. Its inner face is the thing that makes this a bowl.
  //
  // The radii must run MONOTONICALLY INWARD. The first pass had R_BERM-8 (28) followed by
  // R_RIM+3.4 (29.9), which folds the surface back out over itself -- a lathe cannot fault
  // on that, it just builds a crease that faces the wrong way and hides everything inside
  // the ring behind it.
  put(parts, lathed([
    [R_BERM, 0], [R_BERM - 2, 1.8], [R_BERM - 4.5, 3.4], [R_RIM + 3.0, 3.9],
    [R_RIM + 1.8, 3.2], [R_RIM + 0.9, 1.4], [R_RIM + 0.9, 0.55],
  ], { segments: 64 }), PLANT.lawn);

  // The rim walk -- a poured concrete ring, slightly crowned so it drains.
  put(parts, lathed([
    [R_RIM + 1.0, 0.55], [R_RIM + 1.0, 0.72], [R_RIM - 1.6, 0.78], [R_RIM - 3.2, 0.62],
    [R_RIM - 3.2, 0.4],
  ], { segments: 64 }), CONCRETE.kerb);

  // The basin: a shallow dish of pale aggregate, dropping to -2.1 at the middle and rising
  // again to the centre mound. Built as one revolve so the floor and the mound are the same
  // surface and cannot part company.
  put(parts, lathed([
    [R_RIM - 3.2, 0.4], [R_RIM - 5.5, -0.9], [R_RIM - 12, -1.85], [16, -2.1],
    [11.5, -2.0], [9.2, -1.35], [7.6, -0.35], [6.2, 0.35], [4.2, 0.78], [0, 0.95],
  ], { segments: 64 }), CONCRETE.basin);

  // Radial banding on the basin floor. The real one is laid in wedges of different
  // aggregate and it is what gives the bowl a centre to look at when the jets are off.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    if (i % 2) continue;
    const g = extrudeOutline(roundedOutline(0.9, 8.4, 0.4, 2), 0.08);
    put(parts, g, CONCRETE.aggregate,
      [Math.cos(a) * 15.4, -1.86, Math.sin(a) * 15.4], [Math.PI / 2, -a + Math.PI / 2, 0]);
  }

  // --- the dome ----------------------------------------------------------
  //
  // The signature object: a stainless hemisphere studded with nozzles, which everybody
  // describes as looking like a sea urchin or a rivet. The nozzle field is a WARP on the
  // dome's own surface -- a grid of bumps in u and t -- so the studs cannot lift off it, and
  // then the actual nozzle mouths are small rooted cylinders on top of those bumps.
  const NOZ_U = 18;
  const domeStations = lathe([
    [0.001, 5.5], [1.6, 5.42], [3.0, 5.05], [4.2, 4.4], [5.05, 3.5], [5.55, 2.4],
    [5.8, 1.2], [5.85, 0.3], [5.85, 0.0],
  ]);
  // NYQUIST IN THE OTHER DIRECTION. The stud field runs in BOTH t and u, and the first pass
  // sampled 40 rows against 7 bands -- 5.7 samples a cycle, under the nine a ridge needs --
  // so instead of a studded dome it produced beat patterns, and a polished stainless
  // hemisphere rendered as a lumpy white boulder. The u direction was fine at nine samples a
  // stud; it was the rows that were starved.
  put(parts, solidLoft(domeStations, {
    sides: NOZ_U * 9,
    samples: 72,
    axis: 'y',
    warp: (t, u, s) => {
      const ring = Math.cos(u * Math.PI * 2 * NOZ_U) * 0.5 + 0.5;
      const band = Math.cos(t * Math.PI * 2 * 5) * 0.5 + 0.5;
      return Math.min(0.09, s.w * 0.035) * Math.pow(ring * band, 3);
    },
  }), STEEL.bright);

  // The nozzles themselves, on the crown where a student can actually resolve them.
  for (let ring = 0; ring < 4; ring++) {
    const phi = 0.18 + ring * 0.29;
    const count = 6 + ring * 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.4;
      const r = Math.sin(phi) * 5.7;
      const y = Math.cos(phi) * 5.4 + 0.1;
      const dir = new THREE.Vector3(Math.cos(a) * Math.sin(phi), Math.cos(phi), Math.sin(a) * Math.sin(phi));
      const at = [dir.x * 5.6, dir.y * 5.3 + 0.15, dir.z * 5.6];
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const e = new THREE.Euler().setFromQuaternion(q);
      put(parts, new THREE.CylinderGeometry(0.13, 0.17, 0.5, 8), STEEL.dark, at, [e.x, e.y, e.z]);
      void r; void y;
    }
  }
  // The dome sits on a low collar rather than straight on the concrete, which is what stops
  // the join reading as a ball resting on a floor.
  put(parts, lathed([[6.4, 0.5], [6.4, 0.95], [5.4, 1.15], [0, 1.15]], { segments: 40 }), STEEL.galv);

  // --- water -------------------------------------------------------------
  // The pool surface, and the jets. ONE merged translucent mesh for all of it: transparency
  // is a fill-rate cost on integrated graphics and this world can afford exactly one.
  put(water, lathed([[0, -0.28], [8.5, -0.3], [16, -0.34], [R_RIM - 4.2, -0.3]], { segments: 48 }),
    0xbfe0e8);
  if (jets) {
    // A tall central column plus a ring of arcs leaning outward. Real jets reach 120ft; at
    // 1/3 that is 40, and a fountain whose plume is shorter than its own bowl is wide reads
    // as a garden feature rather than as the thing the campus is built around.
    put(water, tube([[0, 5.4, 0], [0, 22, 0], [0, 34, 0], [0, 39.5, 0]],
      [1.5, 0.95, 0.5, 0.06], { sides: 12 }), 0xdff2f7);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      // THE ARCS HAVE TO LAND INSIDE THE BASIN. The first pass sized `reach` freely and
      // the outermost jets came down 46ft from the middle -- ten feet past the grass berm,
      // so the fountain was watering the lawn and its own bounding box was wider than the
      // bowl. The landing radius is 4.6 + reach*1.62, so reach is capped from the rim.
      const reach = 9.5 + (i % 4) * 1.6;
      const peak = 17 + (i % 5) * 3;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      put(water, tube([
        [cx * 4.6, 5.0, cz * 4.6],
        [cx * (4.6 + reach * 0.42), peak * 0.86, cz * (4.6 + reach * 0.42)],
        [cx * (4.6 + reach * 0.86), peak, cz * (4.6 + reach * 0.86)],
        [cx * (4.6 + reach * 1.35), peak * 0.42, cz * (4.6 + reach * 1.35)],
        [cx * (4.6 + reach * 1.62), -0.2, cz * (4.6 + reach * 1.62)],
      ], [0.52, 0.4, 0.3, 0.22, 0.1], { sides: 8 }), 0xe6f5f9);
    }
    // A LAYER OF MIST, not a scatter of balls. At 0.42 of their own radius these stood up
    // as a dozen separate marshmallows lying round the dome; spray is a low continuous sheet
    // that the arcs disappear into, so they are wider, much flatter and nearly on the water.
    for (let i = 0; i < 11; i++) {
      const a = randomIn(rng, 0, Math.PI * 2);
      const r = randomIn(rng, 8, 19);
      const g = ball(randomIn(rng, 2.4, 4.6), 9);
      g.scale(1, 0.17, 1);
      put(water, g, 0xeaf6fa, [Math.cos(a) * r, randomIn(rng, -0.1, 0.5), Math.sin(a) * r]);
    }
  }

  const shell = mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.5, metalness: 0.34, ...relief('stone', { seed, repeat: 22 }) }),
  );
  const pool = mesh(
    mergeParts(water),
    standard({
      vertexColors: true, roughness: 0.12, metalness: 0.1,
      transparent: true, opacity: 0.62, depthWrite: false,
    }),
  );
  pool.castShadow = false;
  return group(shell, pool);
}

// ---------------------------------------------------------------------------
// THE MONORAIL
// ---------------------------------------------------------------------------

// The 1962 Alweg line, still running the original trains. Three props, because they are
// three things a student does different things with: the guideway is scenery, the station
// is a place, and the TRAIN is a programmable object that ships with a program already
// running on it.
//
// A guideway is a single continuous beam and a row of piers. The beam is a `sweepProfile`
// on parallel-transport frames -- not Frenet, which flips through the inflection every
// reverse curve has, and this line is all reverse curves.
export function monorailGuideway({
  seed = 62, path = null, height = 24, colour = CONCRETE.precast,
} = {}) {
  const parts = [];
  const pts = path ?? [[-70, height, -18], [-24, height, -4], [22, height, 6], [66, height, 4], [104, height, -12]];

  // The beam: 2.6ft wide, 3.6ft deep, top corners eased. The real Alweg beam is a
  // prestressed concrete box and its proportions are what make the line recognisable from
  // underneath, which is where most people see it.
  const beam = sweepProfile(pts, roundedOutline(1.3, 1.8, 0.28, 2), { samples: 96, uvScale: 0.25 });
  put(parts, beam, colour);

  // Piers. Rooted 2.5ft BELOW the origin: this campus is nearly flat but not perfectly, and
  // a pier that stops exactly at y=0 stands on a stalk of daylight wherever the terrain
  // dips an inch. Burying the foot costs nothing and cannot fail.
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const PIERS = 6;
  for (let i = 0; i < PIERS; i++) {
    const t = (i + 0.5) / PIERS;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const yaw = Math.atan2(tan.x, tan.z);
    // A tapered column with a flared head, which is what carries the beam without the join
    // reading as a stick pushed into a bar.
    put(parts, solidLoft([
      { d: -2.5, w: 2.2, up: 2.2, dn: 2.2, round: 1.7 },
      { d: 0.9, w: 1.85, up: 1.85, dn: 1.85, round: 1.7 },
      { d: height * 0.55, w: 1.35, up: 1.5, dn: 1.5, round: 1.6 },
      { d: height - 3.4, w: 1.2, up: 1.4, dn: 1.4, round: 1.6 },
      { d: height - 1.9, w: 1.75, up: 2.0, dn: 2.0, round: 1.8 },
      { d: height - 0.4, w: 1.85, up: 2.1, dn: 2.1, round: 1.9 },
    ], { sides: 18, samples: 20, axis: 'y' }), colour, [p.x, 0, p.z], [0, yaw, 0]);
  }

  return group(mesh(
    weather(mergeParts(parts), { amount: 0.12, scale: 0.05, wash: 0.2, low: 0, fade: 22, seed }),
    standard({ vertexColors: true, roughness: 0.82, ...relief('stone', { seed, repeat: 10 }) }),
  ));
}

// A two-car Alweg set. Authored facing +Z, like every prop here, so `move forward` drives
// it along its own length.
//
// The body is a LOFTED HULL, not a box. A 1962 Alweg car has no flat panel on it: the
// section is a rounded rectangle at the waist that tucks in hard below the skirt (it has to
// straddle a 2.6ft beam) and rounds off completely into the domed nose. The windows are
// applied to the hull's OWN surface, so the body colour showing between them is the pillar
// and cannot be a hair out of line with the roof it holds up -- the same construction the
// 1949 taxi uses.
export function monorailTrain({ seed = 62, colour = 0xb4302c, cars = 2 } = {}) {
  const parts = [];
  const glass = [];
  const CAR = 31;
  // THE TRAIN'S LOCAL y = 0 IS THE TOP OF THE BEAM, not the ground -- it is placed with an
  // absoluteY at the guideway's own deck height, and nothing about it is grounded. So the
  // skirt runs BELOW zero (it straddles the beam and hides its shoulders) and the guide
  // wheels, which grip the beam's sides rather than resting on anything, sit below that.
  const RAIL = -1.1;

  for (let c = 0; c < cars; c++) {
    const z0 = (c - (cars - 1) / 2) * (CAR + 0.6);
    const nose = c === 0 || c === cars - 1;
    const front = c === cars - 1;

    // Stations along the car. `d` runs along Z; `w` is the half-beam, `up`/`dn` the height
    // above and below the waist line. The skirt's `dn` is deep enough to reach past the
    // beam, which is what makes it straddle rather than sit on top.
    const end = (sign) => (nose && ((sign > 0) === front)
      ? [
        { d: sign * CAR * 0.5, w: 0.55, up: 1.5, dn: 1.4, round: 1.05 },
        { d: sign * CAR * 0.465, w: 1.55, up: 2.5, dn: 2.4, round: 1.2 },
        { d: sign * CAR * 0.42, w: 2.35, up: 3.15, dn: 3.2, round: 1.45 },
      ]
      : [
        { d: sign * CAR * 0.5, w: 2.62, up: 3.35, dn: 3.9, round: 1.9 },
        { d: sign * CAR * 0.44, w: 2.68, up: 3.42, dn: 3.95, round: 1.95 },
      ]);
    const stations = [
      ...end(-1).reverse(),
      { d: -CAR * 0.3, w: 2.72, up: 3.5, dn: 4.0, round: 2.0 },
      { d: 0, w: 2.74, up: 3.52, dn: 4.02, round: 2.05 },
      { d: CAR * 0.3, w: 2.72, up: 3.5, dn: 4.0, round: 2.0 },
      ...end(1),
    ];
    const body = solidLoft(stations, { sides: 30, samples: 54 });
    put(parts, body, 0xffffff, [0, RAIL + 4.1, z0], null, {
      keepColor: true,
      // Alweg livery: a white roof, the car's colour on the flanks, and a dark skirt below
      // the belt. Painted as a tint on ONE hull rather than as three lofts, so the colour
      // changes land on the body's own curvature instead of on seams between solids.
      tint: (p) => {
        const c = new THREE.Color(p.y > 2.35 ? 0xf0efe9 : p.y < -2.5 ? 0x35383c : colour);
        return [c.r, c.g, c.b];
      },
    });

    // The window band, applied to the hull's own surface so it can never float off it.
    for (const side of [-1, 1]) {
      for (let w = 0; w < 6; w++) {
        const z = z0 + (w - 2.5) * 4.1;
        const g = extrudeOutline(roundedOutline(1.55, 1.1, 0.3, 3), 0.16);
        put(glass, g, STEEL.glassBlue, [side * 2.72, RAIL + 5.6, z], [0, side * Math.PI / 2, 0]);
      }
    }
    // The windscreen, on the section's CROWN rather than its flank -- a wrap-around screen
    // is swept by the top of the section as it runs forward, and centred on the equator by
    // mistake it lands down the side of the car among the doors.
    if (nose) {
      const sign = front ? 1 : -1;
      const g = extrudeOutline(roundedOutline(1.9, 1.05, 0.42, 3), 0.18);
      put(glass, g, STEEL.glassBlue, [0, RAIL + 6.4, z0 + sign * CAR * 0.455], [sign * 0.55, 0, 0]);
      put(parts, ball(0.34, 8), 0xf0efe9, [0, RAIL + 7.2, z0 + sign * CAR * 0.42]);
    }

    // The skirt's running gear: the guide wheels that press the beam's sides. Tucked in
    // against the beam and only just clear of the skirt -- at the first pass's radius and
    // offset they hung outboard and below like a pair of landing-gear bogies, which is the
    // one thing a monorail visibly does not have.
    for (const side of [-1, 1]) {
      for (const dz of [-CAR * 0.32, CAR * 0.32]) {
        const g = new THREE.CylinderGeometry(0.88, 0.88, 0.6, 14);
        g.rotateZ(Math.PI / 2);
        put(parts, g, 0x3a3d41, [side * 1.46, RAIL - 0.5, z0 + dz]);
      }
    }
  }

  return group(
    mesh(
      mergeParts(parts),
      standard({ vertexColors: true, roughness: 0.42, metalness: 0.24, ...relief('metal', { seed, repeat: 16 }) }),
    ),
    mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.12, metalness: 0.5 })),
  );
}

// The Seattle Center terminal: a raised platform under a long shed canopy, with the stair
// a student can see the shape of even though they cannot climb it.
export function monorailStation({ seed = 62, length = 46, height = 24 } = {}) {
  const parts = [];
  const glass = [];
  const deck = height - 6.6;

  // Platform deck on a row of piers.
  slab(parts, CONCRETE.precast, { halfW: 7.5, halfD: length / 2, thick: 1.1, at: [0, deck, 0] });
  for (let i = -2; i <= 2; i++) {
    for (const side of [-5.4, 5.4]) {
      put(parts, solidLoft([
        { d: -2, w: 1.25, up: 1.25, dn: 1.25, round: 1.7 },
        { d: deck - 1.2, w: 0.95, up: 0.95, dn: 0.95, round: 1.7 },
      ], { sides: 12, samples: 6, axis: 'y' }), CONCRETE.poured, [side, 0, i * (length / 5)]);
    }
  }
  // Parapet: a solid wall rather than a rail, because a rail at this distance is a row of
  // hairlines that alias into a shimmer.
  for (const side of [-1, 1]) {
    put(parts, extrudeOutline(roundedOutline(0.28, 1.5, 0.12, 2), length),
      CONCRETE.precastShade, [side * 7.2, deck + 1.5, 0], [0, 0, 0]);
  }
  // Canopy: a shallow barrel on slim columns, which is what the real shed is.
  for (let i = -2; i <= 2; i++) {
    for (const side of [-6.2, 6.2]) {
      put(parts, new THREE.CylinderGeometry(0.32, 0.36, 8.4, 10), STEEL.galv,
        [side, deck + 5.3, i * (length / 5)]);
    }
  }
  const canopy = solidSurface({
    nu: 24, nv: 3,
    point: (u, v) => {
      const x = (u - 0.5) * 16.4;
      const z = (v - 0.5) * (length + 3);
      return [x, deck + 9.5 + Math.cos((u - 0.5) * Math.PI) * 1.5 - 1.5, z];
    },
    thick: () => 0.16,
    axis: [0, 1, 0],
  });
  put(parts, canopy, CONCRETE.precast);

  // Stair up from the plaza, built as real treads: a ramp with a texture on it reads as a
  // ramp, and the thing that says "stair" is the shadow line under each nosing.
  for (let s = 0; s < 16; s++) {
    const y = (s + 1) * (deck / 16);
    slab(parts, CONCRETE.poured, {
      halfW: 3.2, halfD: 0.62, thick: y + 0.4,
      at: [0, y, -length / 2 - 1.2 - s * 1.15],
    });
  }
  put(glass, extrudeOutline(roundedOutline(3.4, 3.0, 0.4, 3), 0.2), STEEL.glassPale,
    [0, deck + 4.2, length / 2 - 0.4], [0, 0, 0]);

  return group(
    mesh(
      weather(mergeParts(parts), { amount: 0.1, scale: 0.05, wash: 0.18, low: 0, fade: 16, seed }),
      standard({ vertexColors: true, roughness: 0.78, ...relief('stone', { seed, repeat: 12 }) }),
    ),
    mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.15, metalness: 0.4 })),
  );
}

// ---------------------------------------------------------------------------
// PACIFIC SCIENCE CENTER
// ---------------------------------------------------------------------------

// Minoru Yamasaki's 1962 US Science Pavilion. The five white arches are among the most
// photographed structures in the city, and what makes them work is that they are LACE: each
// is a slender pointed arch whose lower half is filled with a row of smaller pointed
// arches, so the thing is mostly sky.
//
// Built at 1/2.4 -- 46ft against a real 110 -- because the arches have to stand over their
// pools and still leave the Space Needle as the tallest thing on the skyline.
export function scienceArches({ seed = 62, count = 5, height = 46, spacing = 15 } = {}) {
  const parts = [];
  const water = [];
  const rng = seededRandom(seed);

  // One arch, authored about x = 0 and repeated. A pointed arch is two arcs meeting at an
  // apex; sweeping a profile up each side and letting them overlap at the point is what
  // closes the apex without any mitre arithmetic.
  const arch = (cx, tall) => {
    const halfSpan = tall * 0.29;
    for (const side of [-1, 1]) {
      const pts = [];
      const N = 14;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        // A gothic curve: nearly straight for the lower two thirds, then swinging in hard.
        const x = side * halfSpan * (1 - Math.pow(t, 2.6));
        const y = tall * t;
        pts.push([cx + x, y, 0]);
      }
      // The rib is a bundle: three slender members side by side, which is what gives the
      // arches their fluted look and stops a 46ft member reading as a plank.
      for (const off of [-0.62, 0, 0.62]) {
        const w = off === 0 ? 0.42 : 0.3;
        // 24 samples and a 1-step corner, not 44 and 2. These members are seen from 60ft
        // and their whole job is to be SLENDER -- subdividing along a length that is
        // already smooth buys nothing, and at 44x12 the five arches cost 48k triangles,
        // more than the Space Needle.
        const g = sweepProfile(
          pts.map((p) => [p[0], p[1], p[2] + off]),
          roundedOutline(w, 0.52, 0.16, 1),
          { samples: 24, capStart: true, capEnd: true, scale: (t) => 1 - t * 0.32 },
        );
        put(parts, g, CONCRETE.precast);
      }
    }
    // The apex, where the two halves cross. A ball at the crossing is the same socket trick
    // every limb joint in this project uses, and without it the point shows daylight.
    put(parts, ball(0.86, 12), CONCRETE.precast, [cx, tall - 0.5, 0]);
    put(parts, ball(0.72, 12), CONCRETE.precast, [cx, tall - 0.5, 0.62]);
    put(parts, ball(0.72, 12), CONCRETE.precast, [cx, tall - 0.5, -0.62]);

    // The arcade: a row of small pointed arches across the foot, which is the detail that
    // makes the big arch read as Yamasaki rather than as a croquet hoop.
    const bays = 4;
    for (let b = 0; b <= bays; b++) {
      const x = cx + (b / bays - 0.5) * halfSpan * 1.72;
      upright(parts, CONCRETE.precast, roundedOutline(0.22, 0.22, 0.09, 2), tall * 0.3, { at: [x, 0, 0] });
      if (b < bays) {
        const mx = cx + ((b + 0.5) / bays - 0.5) * halfSpan * 1.72;
        const w = (halfSpan * 1.72) / bays / 2;
        const pts = [];
        for (let i = -8; i <= 8; i++) {
          const t = i / 8;
          pts.push([mx + t * w * (1 - Math.abs(t) * 0.06), tall * 0.3 + (1 - t * t) * w * 1.5, 0]);
        }
        put(parts, sweepProfile(pts, roundedOutline(0.2, 0.24, 0.08, 1), { samples: 14 }),
          CONCRETE.precast);
      }
    }
  };

  for (let i = 0; i < count; i++) {
    const cx = (i - (count - 1) / 2) * spacing;
    // Not identical: the real five step in height across the group.
    arch(cx, height * (0.86 + 0.14 * Math.sin((i / Math.max(1, count - 1)) * Math.PI)));
  }

  // The reflecting pools the arches stand in. A hard-edged rectangle of still water is the
  // whole reason the arches read as tall -- it doubles them.
  const halfW = ((count - 1) * spacing) / 2 + spacing * 0.7;
  // A POOL NEEDS A KERB YOU CAN SEE OVER THE TOP OF. At a 0.13ft freeboard the water was
  // sealed inside its own coping and the arches stood on what read as a pale path -- and a
  // reflecting pool is doing half the work of making them look tall.
  slab(parts, CONCRETE.kerb, { halfW: halfW + 1.6, halfD: 12.8, thick: 2.0, at: [0, 1.05, 0], ease: 1.0 });
  slab(parts, CONCRETE.aggregate, { halfW, halfD: 11.2, thick: 1.6, at: [0, 0.2, 0], ease: 0.8 });
  slab(water, 0x9fc8d6, { halfW: halfW - 0.3, halfD: 10.9, thick: 0.08, at: [0, 0.78, 0], ease: 0.8 });
  // A few jets, because the real pools have them and still water at this scale reads as a
  // sheet of grey plastic.
  for (let i = 0; i < 10; i++) {
    const x = randomIn(rng, -halfW + 2, halfW - 2);
    const z = randomIn(rng, -8, 8);
    const h = randomIn(rng, 2.2, 4.6);
    put(water, tube([[x, 0.7, z], [x, 0.7 + h * 0.7, z], [x, 0.7 + h, z]], [0.2, 0.13, 0.02], { sides: 6 }),
      0xdff0f6);
  }

  const solid = mesh(
    weather(mergeParts(parts), { amount: 0.09, scale: 0.06, wash: 0.16, low: 0, fade: 12, seed }),
    standard({ vertexColors: true, roughness: 0.8, ...relief('stone', { seed, repeat: 14 }) }),
  );
  const pool = mesh(mergeParts(water), standard({
    vertexColors: true, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.72, depthWrite: false,
  }));
  pool.castShadow = false;
  return group(solid, pool);
}

// The pavilions under the arches: low white buildings whose walls are a screen of narrow
// vertical fins, which is Yamasaki's signature and the reason the World Trade Center's
// facade looked the way it did.
export function sciencePavilion({ seed = 62, width = 54, depth = 26, height = 15 } = {}) {
  const parts = [];
  const glass = [];
  const hw = width / 2;
  const hd = depth / 2;

  // The box, then the fins standing proud of it. A window has to be built FORWARD of a
  // solid wall here -- there is no CSG, so glazing set at or behind the wall plane is
  // sealed inside the concrete and renders as blank stone.
  upright(parts, CONCRETE.precast, roundedOutline(hw, hd, 0.8, 2), height);
  upright(glass, STEEL.glassBlue, roundedOutline(hw + 0.12, hd + 0.12, 0.8, 2), height - 5.2, { at: [0, 2.4, 0] });

  const FINS = Math.round(width / 2.1);
  for (let i = 0; i <= FINS; i++) {
    const x = -hw + (i / FINS) * width;
    for (const side of [-1, 1]) {
      upright(parts, CONCRETE.precast, roundedOutline(0.24, 0.62, 0.1, 2), height + 0.6,
        { at: [x, 0, side * (hd + 0.55)] });
    }
  }
  const FINS_D = Math.round(depth / 2.1);
  for (let i = 0; i <= FINS_D; i++) {
    const z = -hd + (i / FINS_D) * depth;
    for (const side of [-1, 1]) {
      upright(parts, CONCRETE.precast, roundedOutline(0.62, 0.24, 0.1, 2), height + 0.6,
        { at: [side * (hw + 0.55), 0, z] });
    }
  }
  // A deep parapet, which the fins die into so their tops are never open ends.
  upright(parts, CONCRETE.precastShade, roundedOutline(hw + 1.1, hd + 1.1, 0.9, 2), 2.2, { at: [0, height, 0] });
  // The entrance: a recess is impossible in a solid wall, so the doorway is built forward
  // instead -- a dark reveal a hair proud, glazing proud of that, a frame proud of both.
  upright(parts, 0x2c2f31, roundedOutline(4.6, 0.3, 0.12, 2), 9.4, { at: [0, 0, hd + 1.15] });
  upright(glass, STEEL.glassPale, roundedOutline(4.1, 0.2, 0.1, 2), 8.4, { at: [0, 0.2, hd + 1.5] });
  upright(parts, CONCRETE.precast, roundedOutline(5.1, 0.42, 0.16, 2), 0.7, { at: [0, 9.6, hd + 1.5] });

  return group(
    mesh(
      weather(mergeParts(parts), { amount: 0.08, scale: 0.05, wash: 0.16, low: 0, fade: 10, seed }),
      standard({ vertexColors: true, roughness: 0.82, ...relief('stone', { seed, repeat: 16 }) }),
    ),
    mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.14, metalness: 0.42 })),
  );
}

// --- the three programmable exhibits ---------------------------------------
//
// A science centre is a room full of things you are allowed to touch, so the three coding
// challenges in this world target three EXHIBITS rather than three pieces of scenery. Each
// one is built so that the block it teaches has a visible, obviously-correct result: the
// orrery is meant to go round, the rover is meant to drive a square, the rocket is meant to
// go up and come back.

// Exhibit 1 -- an orrery. Teaches `forever` + `rotate`.
export function scienceOrrery({ seed = 62 } = {}) {
  const parts = [];
  const glow = [];
  // A plinth, then the sun on a post, then three arms carrying planets. The arms are at
  // different radii AND different heights so that a single rotation about the vertical
  // reads as three orbits rather than as one turning plate.
  put(parts, lathed([[0, 0], [3.2, 0], [3.2, 2.4], [2.6, 2.9], [0, 2.9]], { segments: 28 }),
    CONCRETE.poured);
  put(parts, new THREE.CylinderGeometry(0.28, 0.36, 4.6, 12), STEEL.galv, [0, 5.2, 0]);
  put(glow, ball(1.35, 16), GLASS.saffron, [0, 8.0, 0]);

  const arms = [
    { r: 3.4, y: 7.2, size: 0.42, colour: GLASS.vermilion, a: 0 },
    { r: 5.2, y: 8.0, size: 0.62, colour: GLASS.cobalt, a: 2.1 },
    { r: 7.0, y: 7.5, size: 0.5, colour: GLASS.jade, a: 4.0 },
  ];
  for (const arm of arms) {
    // Out to the planet, not through the middle. An extrusion is centred on its own
    // length, so an arm placed on the axis reaches only half way and sticks out the same
    // distance on the opposite side -- three arms crossing the hub instead of three orbits.
    const g = extrudeOutline(roundedOutline(0.12, 0.16, 0.06, 2), arm.r);
    put(parts, g, STEEL.bright,
      [Math.cos(arm.a) * arm.r / 2, arm.y, Math.sin(arm.a) * arm.r / 2],
      [0, -arm.a + Math.PI / 2, 0]);
    put(glow, ball(arm.size, 14), arm.colour,
      [Math.cos(arm.a) * arm.r, arm.y, Math.sin(arm.a) * arm.r]);
    // A ring on the plinth marking the orbit, so the shape the program draws is already
    // drawn on the floor before the student writes it.
    put(parts, lathed([[arm.r - 0.09, 0.02], [arm.r + 0.09, 0.02]], { segments: 40 }),
      CONCRETE.aggregate, [0, 2.92, 0]);
  }

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.35 })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.22, metalness: 0.1, emissive: 0xffb43c, emissiveIntensity: 0.22,
    })),
  );
}

// Exhibit 2 -- a Mars rover, facing +Z. Teaches `repeat` + `move forward` + `rotate`, which
// together close a square: 360 divided by the number of sides.
export function scienceRover({ seed = 62 } = {}) {
  const parts = [];
  const glow = [];
  // Chassis as a lofted hull, so the deck edges are formed rather than sawn.
  put(parts, solidLoft([
    { d: -3.1, w: 1.5, up: 0.62, dn: 0.5, round: 1.5 },
    { d: -1.4, w: 1.85, up: 0.78, dn: 0.62, round: 1.9 },
    { d: 1.6, w: 1.85, up: 0.78, dn: 0.62, round: 1.9 },
    { d: 3.2, w: 1.5, up: 0.66, dn: 0.5, round: 1.5 },
  ], { sides: 18, samples: 16 }), 0xd8cfbc, [0, 1.9, 0]);
  // Six wheels on rocker bogies, which is the thing that makes a rover a rover.
  for (const side of [-1, 1]) {
    for (const dz of [-2.4, 0, 2.4]) {
      const g = new THREE.CylinderGeometry(0.86, 0.86, 0.56, 14);
      g.rotateZ(Math.PI / 2);
      put(parts, g, 0x3a3c40, [side * 2.05, 0.86, dz]);
      upright(parts, STEEL.galv, roundedOutline(0.12, 0.12, 0.05, 1), 1.3, { at: [side * 1.9, 0.95, dz] });
    }
  }
  // Mast, camera head and the dish -- and the dish faces FORWARD, because a dish turned
  // away renders as a smooth egg on a post.
  put(parts, new THREE.CylinderGeometry(0.13, 0.16, 2.6, 10), STEEL.bright, [0, 3.9, -1.2]);
  put(parts, extrudeOutline(roundedOutline(0.5, 0.34, 0.14, 2), 0.6), 0xd8cfbc, [0, 5.3, -1.2], [0, 0, 0]);
  put(glow, ball(0.16, 8), GLASS.cobalt, [0.22, 5.35, -0.88]);
  put(glow, ball(0.16, 8), GLASS.cobalt, [-0.22, 5.35, -0.88]);
  // Solar panels, in the deep blue that says photovoltaic.
  for (const side of [-1, 1]) {
    put(parts, extrudeOutline(roundedOutline(1.5, 2.1, 0.16, 2), 0.12), 0x2b3f7a,
      [side * 3.0, 2.72, 0], [-Math.PI / 2, 0, side * 0.14]);
  }
  put(parts, lathed([[0, 0], [1.4, 0], [1.4, 0.22], [0, 0.22]], { segments: 20 }), CONCRETE.aggregate,
    [0, 0, 0]);

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.55, metalness: 0.3 })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.2, emissive: 0x5aa8ff, emissiveIntensity: 0.4,
    })),
  );
}

// Exhibit 3 -- a sounding rocket on its stand. Teaches `move up by`, `wait` and
// `go back to start`, which is the one block set that needs a vertical target to make sense.
export function scienceRocket({ seed = 62, colour = 0xe8e5dc } = {}) {
  const parts = [];
  const glow = [];
  // The body: one loft from the tail to a real point, so the nose is a nose and not a cap.
  put(parts, solidLoft(lathe([
    [0.001, 15.6], [0.5, 14.4], [0.92, 13.0], [1.18, 11.4], [1.25, 6.0],
    [1.25, 2.2], [1.45, 1.2], [1.5, 0.0],
  ]), { sides: 22, samples: 30, axis: 'y' }), 0xffffff, null, null, {
    keepColor: true,
    // A white rocket with a scarlet band and a black roll pattern: the paint on a sounding
    // rocket is not decoration, it is what lets a tracking camera measure the roll rate.
    tint: (p) => {
      const c = new THREE.Color(
        p.y > 12.4 ? 0xd2302c
          : p.y > 11.2 ? 0xf0eee7
            : p.y > 2.4 && Math.atan2(p.z, p.x) > 0 && p.y < 5.4 ? 0x2c2e30
              : colour,
      );
      return [c.r, c.g, c.b];
    },
  });
  // Fins: closed lens-section solids, never zero-thickness plates.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const g = extrudeOutline(
      [[0, 0], [2.1, -0.2], [2.1, 0.6], [0.1, 2.9], [0, 2.9]].map(([x, y]) => [x, y]), 0.16,
    );
    // -a, NOT pi/2 - a. Which yaw is right depends on WHICH AXIS of the extrusion has to
    // end up radial: the orrery's arm runs along its extrusion (Z), so it takes pi/2 - a,
    // while a fin's span is the outline's own X and takes -a. Getting it wrong does not look
    // like a rotation error -- the fins simply stand tangentially and the rocket reads as
    // having a collar rather than fins.
    put(parts, g, 0xd2302c,
      [Math.cos(a) * 1.35, 0.2, Math.sin(a) * 1.35], [0, -a, 0]);
  }
  put(glow, ball(0.5, 12), GLASS.amber, [0, 0.35, 0]);
  // The stand: a tripod gantry, so the rocket has something to leave behind when it lifts.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    put(parts, tube([
      [Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4],
      [Math.cos(a) * 2.2, 2.4, Math.sin(a) * 2.2],
      [Math.cos(a) * 1.6, 4.2, Math.sin(a) * 1.6],
    ], [0.24, 0.19, 0.15], { sides: 8 }), STEEL.galv);
  }
  put(parts, lathed([[0, 0], [4.2, 0], [4.2, 0.35], [0, 0.35]], { segments: 24 }), CONCRETE.poured);

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.45, metalness: 0.2 })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.25, emissive: 0xff7a1e, emissiveIntensity: 0.4,
    })),
  );
}

// ---------------------------------------------------------------------------
// MoPOP -- the Museum of Pop Culture
// ---------------------------------------------------------------------------

// Frank Gehry's 2000 building, and the most colourful object on the campus by a very wide
// margin: six swelling metal-clad masses in gold, silver, purple, red, sky blue and copper,
// with the monorail running straight through the middle of it.
//
// The skin is 21,000 shingles and the seams between them are visible from across the lawn,
// so the ribbing is a WARP on each blob's own surface rather than applied panels -- the
// same argument as the Needle's saucer, and the reason this reads as sheet metal instead of
// as painted plaster.
export function popMuseum({ seed = 62, scale = 1 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const S = scale;

  // TIGHTER AND TALLER THAN THE FIRST PASS. Spaced 18ft apart at 20ft high these read as six
  // coloured eggs lying separately on the grass; Gehry's masses INTERSECT -- the building is
  // one swelling thing that changes colour, not six things standing near each other. They
  // now overlap by design, and each is a good deal taller than it is wide.
  const blobs = [
    { colour: GEHRY.gold, at: [-20, 0, -1], len: 30, w: 11, h: 27, lean: 0.11, turn: 0.3 },
    { colour: GEHRY.silver, at: [-7, 0, 5], len: 26, w: 12.5, h: 22, lean: -0.09, turn: -0.5 },
    { colour: GEHRY.purple, at: [6, 0, -4], len: 28, w: 10, h: 30, lean: 0.15, turn: 0.15 },
    { colour: GEHRY.red, at: [19, 0, 6], len: 24, w: 10.5, h: 21, lean: -0.13, turn: 0.7 },
    { colour: GEHRY.skyBlue, at: [1, 0, -13], len: 20, w: 8, h: 17, lean: 0.07, turn: -0.2 },
    { colour: GEHRY.copper, at: [30, 0, -3], len: 19, w: 9, h: 24, lean: 0.1, turn: -0.6 },
  ];

  for (const b of blobs) {
    // Each mass is a closed loft whose section swells and shrinks along its length and
    // whose centre line wanders -- which is the whole of what makes a Gehry form. A tube of
    // constant section leaning over is a silo.
    const n = 7;
    const stations = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const bulge = Math.sin(t * Math.PI) * 0.55 + 0.45;
      const wob = smoothNoise3(t * 2.2 + b.at[0] * 0.1, 0, 0) - 0.5;
      stations.push({
        d: t * b.h * S,
        w: b.w * S * bulge * (1 + wob * 0.22),
        up: b.len * 0.5 * S * bulge * (1 + wob * 0.16),
        dn: b.len * 0.5 * S * bulge * (1 - wob * 0.1),
        a: b.lean * t * t * b.h * S * 2.4,
        b: wob * b.len * 0.09 * S,
        // Squarer than an ellipse. At round 1.15 the section is very nearly circular and
        // every mass comes out as a smooth egg; Gehry's have flats, creases and a definite
        // top, and the superellipse exponent is the whole of what separates the two.
        round: 1.5 + t * 0.35,
      });
    }
    // A BACKGROUND PROP'S COST IS MULTIPLIED BY THE NUMBER OF MASSES IN IT. At 22 shingle
    // courses this needed 198 sides to clear Nyquist and came out at 83k triangles for one
    // building nobody walks up to -- the araucaria trap again, and more geometry than the
    // Space Needle. Twelve courses at 108 sides reads identically from the lawn.
    const RIB = 12;
    const g = solidLoft(stations, {
      sides: RIB * 9,
      samples: 26,
      axis: 'y',
      warp: (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * RIB), 0.28, Math.min(0.22, s.w * 0.02)),
    });
    // Anodised metal is never flat: each panel catches the sky differently, and a broad
    // vertical gradient plus a little blotching is what turns one hex code into a skin.
    //
    // The tint has to SUPPLY the colour rather than shade what is already there. With
    // `keepColor` the incoming attribute is white, so multiplying it gives six grey blobs;
    // the base hue is read from the closure instead.
    const base = new THREE.Color(b.colour);
    put(parts, g, b.colour, [b.at[0] * S, -0.7, b.at[2] * S], [0, b.turn, 0], {
      keepColor: true,
      tint: (p) => {
        const k = 0.82 + 0.3 * THREE.MathUtils.clamp(p.y / (b.h * S), 0, 1)
          + 0.12 * (smoothNoise3(p.x * 0.18, p.y * 0.18, p.z * 0.18) - 0.5);
        return [base.r * k, base.g * k, base.b * k];
      },
    });
  }
  // The plinth, so the blobs meet the ground on something rather than growing out of grass.
  upright(parts, CONCRETE.aggregate, roundedOutline(30 * S, 17 * S, 5 * S, 4), 1.5, { at: [4 * S, -0.7, 0] });
  void rng;

  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.34, metalness: 0.52, ...relief('metal', { seed, repeat: 20 }) }),
  ));
}

// ---------------------------------------------------------------------------
// Chihuly Garden and Glass
// ---------------------------------------------------------------------------

// The garden's centrepiece is a 40ft sculpture of hundreds of twisting glass horns in one
// hot colour family, and the Glasshouse hangs a 100ft flower-form from its ceiling.
//
// A NOTE ON EMISSIVE, because it cost every colour in this section.
//
// `emissive` is a FLAT material colour and `vertexColors` does not multiply it -- the vertex
// colour tints the diffuse response only. So `emissive: 0xffffff` on a vertex-coloured mesh
// adds the same white glow to every triangle regardless of its colour, which is precisely a
// wash: the Chihuly tower's amber, vermilion and rose all came out as the same pale
// cream-pink, and the more `emissiveIntensity` was raised to make the glass "glow" the more
// of the glass's colour it destroyed. Where a glow is genuinely wanted the emissive is set
// to a colour from the same family; where it is not, it is simply gone and the saturation
// carries it.
//
// The horns are OPAQUE and NOT transparent. A see-through surface loses
// most of its apparent colour, and this object's entire job is colour; transparency is also
// the most expensive thing this world could spend on, and it has already spent its budget
// on the fountain.
export function chihulyTower({ seed = 62, height = 34, family = 'sun' } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const palettes = {
    sun: [GLASS.amber, GLASS.saffron, GLASS.vermilion, 0xf07a1e],
    sea: [GLASS.cobalt, GLASS.jade, GLASS.chartreuse, 0x36b0c8],
    bloom: [GLASS.rose, GLASS.violet, GLASS.vermilion, GLASS.saffron],
  };
  const colours = palettes[family] ?? palettes.sun;

  // A central mast, then horns radiating from it at every height. Each horn is a curved
  // tube tapering to a point -- radius 0 closes the end, which is right for a drawn glass
  // tip and wrong for anything with a cut mouth.
  put(parts, tube([[0, 0, 0], [0, height * 0.5, 0], [0, height * 0.92, 0]],
    [0.9, 0.55, 0.25], { sides: 10 }), 0x8a6a2c);

  const HORNS = 64;
  for (let i = 0; i < HORNS; i++) {
    const t = i / HORNS;
    const y = 1.6 + Math.pow(t, 0.82) * (height - 4);
    const a = i * 2.399963229728653; // golden angle, so no two horns line up
    // Wider and fatter than the first pass, which produced a narrow upright plume that read
    // as a cypress tree. A Chihuly tower is a THICKET: the horns go out as far as they go
    // up, they vary a great deal in length, and the fat ones near the bottom are what give
    // it a base.
    // Widest in the MIDDLE, not at the foot. A spread that only falls off with height
    // builds a cone, and a cone of coloured blades is a cypress tree; Chihuly's towers swell
    // and then close again, which is why they read as one object rather than as a plant.
    const spread = 0.3 + 0.8 * Math.sin(Math.PI * Math.pow(t, 0.8));
    const reach = randomIn(rng, 4.5, 12.5) * spread;
    const rise = randomIn(rng, 1.0, 8.0);
    const curl = randomIn(rng, 0.5, 1.5);
    const r0 = 1.15 + 0.85 * spread;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    put(parts, tube([
      [0, y, 0],
      [cx * reach * 0.42, y + rise * 0.4, cz * reach * 0.42],
      [cx * reach * 0.82, y + rise * 0.82, cz * reach * 0.82],
      [cx * reach * (0.9 + curl * 0.1), y + rise * 1.15, cz * reach * (0.9 + curl * 0.1)],
    ], [r0 * 0.62, r0 * 0.44, r0 * 0.26, 0], { sides: 6, tubular: 8 }),
    colours[i % colours.length]);
  }
  // A dark basin under it, which is what the real one stands in -- and a bright sculpture
  // needs something dark beneath it or the bottom third disappears into the lawn.
  put(parts, lathed([[0, 0], [7.5, 0], [7.5, 0.9], [6.6, 1.2], [0, 1.2]], { segments: 36 }),
    0x585048);

  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.13, metalness: 0.02 }),
  ));
}

// The Glasshouse: a curved steel-and-glass canopy over a suspended flower-form.
export function chihulyGlasshouse({ seed = 62, length = 46, width = 26, height = 20 } = {}) {
  const parts = [];
  const glass = [];
  const bloom = [];
  const rng = seededRandom(seed);
  const hl = length / 2;
  const hw = width / 2;

  // The roof is a saddle -- higher at the middle of each long side and swept down at the
  // ends -- which is what the real one is and also the shape that stops a glass canopy
  // reading as a greenhouse.
  const roof = solidSurface({
    nu: 30, nv: 10,
    point: (u, v) => {
      const z = (u - 0.5) * length;
      const x = (v - 0.5) * width;
      const arch = Math.cos((v - 0.5) * Math.PI) * 4.2;
      const sweep = Math.cos((u - 0.5) * Math.PI) * 2.6;
      return [x, height + arch + sweep - 4.2, z];
    },
    thick: () => 0.12,
    axis: [0, 1, 0],
  });
  put(glass, roof, STEEL.glassPale);
  // Ribs, so the canopy has structure rather than being a sheet of blue jelly.
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    const z = (u - 0.5) * length;
    const pts = [];
    for (let j = 0; j <= 10; j++) {
      const v = j / 10;
      const x = (v - 0.5) * width;
      const arch = Math.cos((v - 0.5) * Math.PI) * 4.2;
      const sweep = Math.cos((u - 0.5) * Math.PI) * 2.6;
      pts.push([x, height + arch + sweep - 4.0, z]);
    }
    put(parts, sweepProfile(pts, roundedOutline(0.11, 0.17, 0.05, 1), { samples: 14 }), STEEL.galv);
  }
  // Columns and a low wall.
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const z = (i / 4 - 0.5) * (length - 3);
      put(parts, new THREE.CylinderGeometry(0.34, 0.42, height - 1.6, 12), STEEL.galv,
        [sx * (hw - 0.6), (height - 1.6) / 2, z]);
    }
  }
  upright(parts, CONCRETE.precast, roundedOutline(hw + 0.8, hl + 0.8, 0.6, 3), 1.6, { at: [0, -0.9, 0] });

  // The suspended flower-form: a raft of glass blooms hanging under the roof, in the reds,
  // oranges and yellows the real one uses.
  const hues = [GLASS.vermilion, GLASS.amber, GLASS.saffron, GLASS.rose, 0xf0691e];
  for (let i = 0; i < 54; i++) {
    const z = randomIn(rng, -hl + 4, hl - 4);
    const x = randomIn(rng, -hw + 5, hw - 5);
    const drop = randomIn(rng, 1.5, 5.5);
    const y = height - 3.2 - drop;
    const len = randomIn(rng, 2.2, 5.2);
    const a = randomIn(rng, 0, Math.PI * 2);
    put(bloom, tube([
      [x, y + len, z],
      [x + Math.cos(a) * len * 0.22, y + len * 0.55, z + Math.sin(a) * len * 0.22],
      [x + Math.cos(a) * len * 0.5, y, z + Math.sin(a) * len * 0.5],
    ], [randomIn(rng, 0.28, 0.52), randomIn(rng, 0.2, 0.4), 0], { sides: 6, tubular: 8 }),
    hues[i % hues.length]);
  }

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.4 })),
    mesh(mergeParts(bloom), standard({ vertexColors: true, roughness: 0.13, metalness: 0.02 })),
    (() => {
      const m = mesh(mergeParts(glass), standard({
        vertexColors: true, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.5, depthWrite: false,
      }));
      m.castShadow = false;
      return m;
    })(),
  );
}

// ---------------------------------------------------------------------------
// The Armory
// ---------------------------------------------------------------------------

// The 1939 Food Circus: a long brick hall with an arcaded front, and the one genuinely OLD
// building on a campus that is otherwise all 1962 and later. It is here for contrast --
// without it the whole world is white concrete and coloured metal.
export function armoryHall({ seed = 62, length = 58, depth = 28, height = 19 } = {}) {
  const parts = [];
  const glass = [];
  const hl = length / 2;
  const hd = depth / 2;

  upright(parts, 0x9c5a44, roundedOutline(hl, hd, 1.0, 2), height);
  // A stepped parapet with a pale stone coping -- the detail that dates the building.
  upright(parts, 0x8c5040, roundedOutline(hl + 0.7, hd + 0.7, 1.0, 2), 2.6, { at: [0, height, 0] });
  upright(parts, CONCRETE.kerb, roundedOutline(hl + 1.1, hd + 1.1, 1.1, 2), 0.6, { at: [0, height + 2.6, 0] });

  // The arcade: tall round-headed windows down both long sides, built FORWARD of the wall.
  const BAYS = 7;
  for (let i = 0; i < BAYS; i++) {
    const z = ((i + 0.5) / BAYS - 0.5) * (length - 4);
    for (const side of [-1, 1]) {
      const x = side * (hd + 0.1);
      const pts = [];
      for (let j = 0; j <= 10; j++) {
        const t = j / 10;
        pts.push([Math.cos(Math.PI * t) * 1.9, 11.2 + Math.sin(Math.PI * t) * 1.9, 0]);
      }
      const archG = sweepProfile(pts, roundedOutline(0.34, 0.34, 0.14, 2), { samples: 16 });
      put(glass, extrudeOutline(roundedOutline(1.85, 5.6, 0.5, 3), 0.3), STEEL.glassBlue,
        [x + side * 0.15, 7.6, z], [0, side * Math.PI / 2, 0]);
      put(parts, archG, CONCRETE.kerb, [x + side * 0.34, 0, z], [0, side * Math.PI / 2, 0]);
      put(parts, extrudeOutline(roundedOutline(2.2, 0.3, 0.12, 2), 0.5), CONCRETE.kerb,
        [x + side * 0.4, 1.9, z], [0, side * Math.PI / 2, 0]);
    }
  }
  // The entrance porch on the +Z end.
  upright(parts, 0x8c5040, roundedOutline(5.2, 2.4, 0.5, 3), 12, { at: [0, 0, hl + 2.0] });
  upright(glass, STEEL.glassPale, roundedOutline(3.6, 0.3, 0.2, 2), 8.6, { at: [0, 0.2, hl + 4.5] });
  upright(parts, CONCRETE.kerb, roundedOutline(6.0, 2.9, 0.6, 3), 0.8, { at: [0, 12, hl + 2.0] });

  return group(
    mesh(
      weather(mergeParts(parts), { amount: 0.14, scale: 0.05, wash: 0.24, low: 0, fade: 14, seed }),
      standard({ vertexColors: true, roughness: 0.88, ...relief('stone', { seed, repeat: 20 }) }),
    ),
    mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.16, metalness: 0.4 })),
  );
}

// ---------------------------------------------------------------------------
// Sonic Bloom
// ---------------------------------------------------------------------------

// Dan Corson's 2013 installation on the campus: five 33ft steel flowers painted in
// fluorescent yellows and oranges that hum when you walk under them. They are the single
// best answer this world has to "centre ornaments", because they are exactly that -- a
// piece of public art whose whole job is to be bright.
export function sonicBloom({ seed = 62, count = 3, height = 22 } = {}) {
  const parts = [];
  const petals = [];
  const rng = seededRandom(seed);
  // Corson's flowers are fluorescent -- they are lit from inside at night and they read as
  // pure saturated yellow by day. The first pass sat them at values that came out beige
  // under a bright sky, which for the one object on this campus whose entire job is colour
  // is the whole thing lost.
  const hues = [0xffe81a, 0xffb01a, 0xf5d400, 0xff8c12, 0xd6ee14];

  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.6;
    const r = count === 1 ? 0 : 6.5;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = height * randomIn(rng, 0.82, 1.06);
    const lean = randomIn(rng, 0.1, 0.24);
    const la = randomIn(rng, 0, Math.PI * 2);
    const tipX = bx + Math.cos(la) * h * lean;
    const tipZ = bz + Math.sin(la) * h * lean;

    // The stalk: one curved tapering tube, which is what a stem is. It carries its own
    // thickness the whole way, so the head has something to sit on.
    put(parts, tube([
      [bx, 0, bz],
      [bx + (tipX - bx) * 0.35, h * 0.4, bz + (tipZ - bz) * 0.35],
      [bx + (tipX - bx) * 0.75, h * 0.78, bz + (tipZ - bz) * 0.75],
      [tipX, h, tipZ],
    ], [0.72, 0.5, 0.36, 0.3], { sides: 10 }), PLANT.firMid);

    // The head: a disc of petals round a boss. Each petal is a lens-section solid, never a
    // plate -- a zero-thickness petal vanishes edge-on, which for a flower seen from below
    // is most of the time.
    const PET = 11;
    const colour = hues[i % hues.length];
    for (let p = 0; p < PET; p++) {
      const pa = (p / PET) * Math.PI * 2;
      const len = randomIn(rng, 3.4, 4.6);
      const g = solidSurface({
        nu: 8, nv: 5,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          const t = v;
          const wid = Math.sin(Math.PI * Math.pow(t, 0.65)) * 1.15;
          return [s * wid, -Math.pow(t, 1.7) * 1.1, t * len];
        },
        thick: (u, v) => 0.13 * Math.sin(Math.PI * v) * (1 - Math.abs(u - 0.5) * 1.1),
        axis: [0, 1, 0],
      });
      put(petals, g, colour, [tipX, h, tipZ], [-0.5 + randomIn(rng, -0.1, 0.1), pa, 0]);
    }
    put(petals, (() => { const g = ball(1.15, 14); g.scale(1, 0.6, 1); return g; })(),
      0xff7a10, [tipX, h + 0.1, tipZ]);
    // A collar under the head, so the stalk does not simply stop inside a flower.
    put(parts, lathed([[0.34, -0.6], [0.95, 0.1], [0.6, 0.35]], { segments: 14 }),
      PLANT.firMid, [tipX, h - 0.2, tipZ]);
  }
  put(parts, lathed([[0, 0], [count > 1 ? 9.5 : 2.2, 0], [count > 1 ? 9.5 : 2.2, 0.3], [0, 0.3]],
    { segments: 30 }), CONCRETE.aggregate);

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.6, metalness: 0.3 })),
    mesh(mergeParts(petals), standard({
      vertexColors: true, roughness: 0.4, metalness: 0.04, side: THREE.DoubleSide,
    })),
  );
}

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------

// A conifer whorl: branches sweep UP at the tip, which is the single thing that separates a
// fir from a cone with a texture on it.
function conifer(parts, { height, radius, colour, colourDark, rng, whorls = 9, perWhorl = 7 }) {
  put(parts, solidLoft([
    { d: -1, w: radius * 0.16, up: radius * 0.16, dn: radius * 0.16, round: 1.3 },
    { d: height * 0.3, w: radius * 0.1, up: radius * 0.1, dn: radius * 0.1, round: 1.2 },
    { d: height * 0.98, w: radius * 0.03, up: radius * 0.03, dn: radius * 0.03, round: 1.1 },
  ], { sides: 10, samples: 10, axis: 'y' }), PLANT.cedarBark);

  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = height * (0.16 + t * 0.8);
    const reach = radius * (1 - Math.pow(t, 1.35)) * 0.98 + radius * 0.06;
    for (let b = 0; b < perWhorl; b++) {
      const a = (b / perWhorl) * Math.PI * 2 + w * 0.7;
      const droop = -reach * 0.24 * (1 - t * 0.6);
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      // Each branch is a flattened solid: a bough is a spray, not a rod.
      const g = solidSurface({
        nu: 5, nv: 5,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          const wid = Math.sin(Math.PI * Math.pow(v, 0.6)) * reach * 0.3;
          const dy = droop * v * v + reach * 0.1 * Math.pow(v, 3);
          return [s * wid, dy, v * reach];
        },
        thick: (u, v) => reach * 0.05 * Math.sin(Math.PI * v) * (1 - Math.abs(u - 0.5) * 1.2) + 0.02,
        axis: [0, 1, 0],
      });
      put(parts, g, b % 3 === 0 ? colourDark : (b % 3 === 1 ? colour : PLANT.firPale),
        [cx * reach * 0.06, y, cz * reach * 0.06], [0, Math.atan2(cx, cz), 0]);
    }
  }
  void rng;
}

export function douglasFir({ seed = 62, height = 46, radius = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  conifer(parts, {
    height: height * randomIn(rng, 0.94, 1.06), radius, colour: PLANT.firMid,
    colourDark: PLANT.firDark, rng, whorls: 14, perWhorl: 9,
  });
  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.9, ...relief('bark', { seed, repeat: 8 }) }),
  ));
}

// A broadleaf: crown mass first, then leaf sprays over it. Rows of leaves on a bare frame
// read as bunting on a pole -- the shell supplies the silhouette and the sprays supply the
// texture, and neither does the other's job.
function broadleaf(parts, {
  height, spread, trunkColour, canopy, rng, sprays = 46, lobes = 6,
}) {
  const trunkTop = height * 0.42;
  put(parts, tube([
    [0, -1, 0], [0, trunkTop * 0.45, 0], [0, trunkTop, 0],
  ], [height * 0.045, height * 0.032, height * 0.024], { sides: 10 }), trunkColour);
  // Main limbs, socketed at every node by `chain`, so no junction can be open.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const reach = spread * randomIn(rng, 0.4, 0.6);
    chain(parts, trunkColour, [
      { p: [0, trunkTop - 0.6, 0], r: height * 0.026 },
      { p: [Math.cos(a) * reach * 0.5, trunkTop + height * 0.14, Math.sin(a) * reach * 0.5], r: height * 0.018 },
      { p: [Math.cos(a) * reach, trunkTop + height * 0.24, Math.sin(a) * reach], r: height * 0.009 },
    ], { sides: 8, capStart: false });
  }
  // MANY SMALL SPRAYS, NOT A FEW BIG ONES, and they have to be round.
  //
  // The first pass used 40 spheres of up to 5ft radius at 7 width segments, and a canopy
  // built that way does not read as foliage at all -- it is a heap of faceted boulders the
  // colour of blossom, and at 28ft from the spawn it filled half the arrival frame with
  // them. A crown is a cloud: the individual mass has to be small enough that no single one
  // is legible, and round enough that the ones on the silhouette do not show flats.
  //
  // `smoothed()` is deliberately NOT called here. It exists for PolyhedronGeometry, which is
  // non-indexed and therefore cannot be smooth-shaded; SphereGeometry is already indexed
  // with correct normals, so welding it again is pure cost.
  for (let i = 0; i < sprays; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const r = spread * Math.pow(randomIn(rng, 0.05, 1), 0.5);
    const y = trunkTop + height * randomIn(rng, 0.02, 0.46) - (r / spread) * height * 0.12;
    const size = randomIn(rng, 0.34, 0.62) * spread * 0.3;
    const g = ball(size, lobes);
    g.scale(1, 0.72, 1);
    put(parts, g, canopy[i % canopy.length], [Math.cos(a) * r, y, Math.sin(a) * r]);
  }
}

export function japaneseMaple({ seed = 62, height = 15, spread = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  broadleaf(parts, {
    height, spread, trunkColour: PLANT.bark, rng, sprays: 96, lobes: 10,
    canopy: [PLANT.mapleRed, PLANT.mapleFlame, PLANT.mapleAmber, PLANT.mapleRed, 0x8c2a26, PLANT.mapleFlame],
  });
  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.88, ...relief('bark', { seed, repeat: 7 }) }),
  ));
}

export function floweringCherry({ seed = 62, height = 22, spread = 15 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // Deeper pinks than instinct says, and some green in the mix. A cherry canopy painted in
  // the pale pink of a single petal comes out WHITE at any distance -- a mass of blossom is
  // much deeper than one flower, because most of what you see is the shaded inside of it.
  broadleaf(parts, {
    height, spread, trunkColour: PLANT.trunk, rng, sprays: 110, lobes: 10,
    canopy: [PLANT.cherryBlossom, PLANT.cherryDeep, 0xe07ba4, PLANT.cherryDeep,
      PLANT.cherryBlossom, 0x8fa86a],
  });
  // Fallen petals, which is half of what a cherry in flower looks like.
  for (let i = 0; i < 22; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const r = randomIn(rng, 1, spread * 1.1);
    const g = extrudeOutline(roundedOutline(randomIn(rng, 0.5, 1.3), randomIn(rng, 0.4, 1.0), 0.3, 3), 0.04);
    put(parts, g, i % 3 ? PLANT.cherryBlossom : PLANT.cherryDeep,
      [Math.cos(a) * r, 0.04, Math.sin(a) * r], [Math.PI / 2, randomIn(rng, 0, 3), 0]);
  }
  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.86, ...relief('bark', { seed, repeat: 7 }) }),
  ));
}

// Rhododendrons -- Washington's state flower, and what the campus is actually planted with.
// A rhododendron is a MOUND of dark leathery leaves with trusses of bloom sitting ON TOP of
// it, not a ball of flowers: get that wrong and it is a hydrangea.
export function rhododendronBed({ seed = 62, radius = 8, bushes = 5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bloom = [];
  const hues = [PLANT.rhodoRose, PLANT.rhodoMagenta, PLANT.rhodoWhite, PLANT.rhodoCoral, PLANT.rhodoLilac];

  // The bed itself: a low kerb of dark bark mulch.
  put(parts, lathed([[0, 0], [radius, 0], [radius, 0.42], [radius - 0.7, 0.55], [0, 0.5]],
    { segments: 30 }), 0x4a3a2c);

  for (let i = 0; i < bushes; i++) {
    const a = (i / bushes) * Math.PI * 2 + randomIn(rng, -0.3, 0.3);
    const r = i === 0 ? 0 : radius * randomIn(rng, 0.38, 0.66);
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const size = randomIn(rng, 2.2, 3.6) * (i === 0 ? 1.15 : 1);
    // The leaf mound: several overlapping squashed spheres, smoothed so it is one mass.
    for (let k = 0; k < 5; k++) {
      const ka = randomIn(rng, 0, Math.PI * 2);
      const kr = randomIn(rng, 0, size * 0.45);
      const g = ball(size * randomIn(rng, 0.6, 0.85), 9);
      g.scale(1, 0.78, 1);
      put(parts, g, k % 2 ? PLANT.leaf : 0x35592c,
        [bx + Math.cos(ka) * kr, size * 0.5 + randomIn(rng, -0.2, 0.25), bz + Math.sin(ka) * kr]);
    }
    // Trusses on the crown. A truss is a dome of many small florets, so a slightly
    // flattened ball at a saturated hue is exactly right and costs one part.
    const hue = hues[i % hues.length];
    const TRUSS = 7;
    for (let t = 0; t < TRUSS; t++) {
      const ta = randomIn(rng, 0, Math.PI * 2);
      const tr = randomIn(rng, 0, size * 0.62);
      const g = ball(randomIn(rng, 0.5, 0.82), 8);
      g.scale(1, 0.72, 1);
      put(bloom, g, hue,
        [bx + Math.cos(ta) * tr, size * 0.92 + randomIn(rng, -0.15, 0.3), bz + Math.sin(ta) * tr]);
    }
  }
  // A drift of low colour round the feet -- dahlias, which Seattle grows by the acre.
  const lows = [PLANT.dahliaGold, PLANT.dahliaScarlet, PLANT.dahliaPlum, PLANT.rhodoWhite];
  for (let i = 0; i < 30; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const r = randomIn(rng, radius * 0.45, radius * 0.92);
    const g = ball(randomIn(rng, 0.22, 0.4), 6);
    g.scale(1, 0.7, 1);
    put(bloom, g, lows[i % lows.length],
      [Math.cos(a) * r, randomIn(rng, 0.5, 0.85), Math.sin(a) * r]);
  }

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.92, ...relief('soil', { seed, repeat: 6 }) })),
    mesh(mergeParts(bloom), standard({ vertexColors: true, roughness: 0.68, metalness: 0.02 })),
  );
}

// ---------------------------------------------------------------------------
// Paving
// ---------------------------------------------------------------------------

// The campus is half plaza, and a plaza is not one flat colour: it is banded precast in
// several tones with a joint pattern. Kept to ONE merged mesh, laid flat, and it is what
// stops the middle of this world reading as a lawn with buildings dropped on it.
export function plazaPaving({
  seed = 62, width = 60, depth = 40, tone = 0, bands = 7,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const base = [CONCRETE.precast, CONCRETE.aggregate, CONCRETE.kerb][tone % 3];
  slab(parts, base, { halfW: width / 2, halfD: depth / 2, thick: 0.34, at: [0, 0.17, 0], ease: 1.6 });
  for (let i = 0; i < bands; i++) {
    const z = ((i + 0.5) / bands - 0.5) * depth;
    const w = width / 2 - randomIn(rng, 0.6, 3.2);
    slab(parts, i % 2 ? CONCRETE.precastShade : CONCRETE.poured,
      { halfW: w, halfD: depth / bands * 0.34, thick: 0.06, at: [0, 0.2, z], ease: 0.4 });
  }
  return group(mesh(
    weather(mergeParts(parts), { amount: 0.13, scale: 0.09, wash: 0.1, low: 0, fade: 2, seed }),
    standard({ vertexColors: true, roughness: 0.94, ...relief('stone', { seed, repeat: 16 }) }),
  ));
}
