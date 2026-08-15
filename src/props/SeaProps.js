import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergeColored,
  mergedMesh,
  canvasTexture,
  taperedTube,
  seededRandom,
  randomIn,
  roughenSphere,
  relief,
} from '../PropKit.js';

// "Under the Sea" -- a tropical coral reef about thirty feet down, modelled from a
// photograph of a reef wall with a shark cruising over it, a moray in a cave mouth, an
// octopus on the rubble and sea stars on the sand.
//
// Sizes are real against the 5ft student, and that is most of the lesson this world
// teaches. A reef looks like a garden in photographs because there is nothing in the
// frame to measure it by; standing in it, an 8ft shark passes overhead at twice your
// height, the moray's head is the size of your own, and the sea stars you have to crouch
// to see are the same animals that fill a postcard.
//
// THE ORGANISING IDEA OF THIS FILE is that under water, colour and light do the work that
// silhouette does on land. Everything below is built cheap in geometry and expensive in
// colour: the corals are spheres, discs and sticks, and what makes them read as coral is
// that no two are the same hue. That is also the honest version of the brief -- a reef
// genuinely is simple shapes in impossible colours.
//
// Three things here are worth reading before editing:
//
//  * A merged, vertex-coloured mesh carrying a near-WHITE patterned `map` is the trick
//    behind the octopus's mottling, the eel's reticulation and the fish stripes. A
//    material with both a map and vertexColors MULTIPLIES them -- normally the trap that
//    turned the bear dens black, and here the entire point: the map carries pattern with
//    no colour of its own, the vertex colour carries the hue, and one texture therefore
//    dresses a dozen differently-coloured animals. See mottleTexture().
//  * seaSolid() bakes a full Matrix4 into a geometry we already own, because mergeColored
//    only applies a Euler rotation and a translation per part. Nearly everything here is a
//    squashed sphere or a blade rolled about its own axis, and a school of eleven fish has
//    to come out as ONE draw call rather than eleven.
//  * Anything transparent is counted. Water is the one environment where a naive build
//    ends up with dozens of transparent draws (every bubble, every shaft, every fin), and
//    transparency has no early-Z and is sorted per object -- which is exactly what a
//    school Chromebook is worst at. Every translucent thing in this file merges into one
//    mesh, and the water surface overhead is deliberately OPAQUE.

// The reef palette, sampled off the reference photograph. These are deliberately more
// saturated than a "realistic" render of them would be: water strips saturation with
// distance, so a coral painted at its true colour arrives on screen as grey mud.
const REEF = {
  sand: 0xd9cfae,
  // The rock tones are all LIGHTER than a photograph of reef limestone suggests, and
  // deliberately. A mound's overhangs and its whole north face are lit by nothing but the
  // ground bounce, so a colour chosen by eye against a lit sample renders as a black slab
  // where it actually matters -- the exact failure the Mars props hit. Pick these against
  // the SHADED face, not the lit one.
  rock: 0xac9d86, // bare reef limestone
  rockDark: 0x877a66,
  rockPink: 0xc09a94, // coralline algae, which crusts everything on a real reef
  rockPurple: 0x9689a2,
  algae: 0x94a066,
  // The coral colours. Named rather than indexed so a layout can ask for a particular
  // look, and so the gardens below can weight them.
  orange: 0xe0752a,
  amber: 0xd9a33a,
  gold: 0xcbb44f,
  cream: 0xd8c8a4,
  pink: 0xe08c9c,
  rose: 0xcf5f78,
  magenta: 0xb44a8e,
  lilac: 0xa48ec4,
  blue: 0x5f92cc,
  skyBlue: 0x7fc0dd,
  teal: 0x49a294,
  green: 0x789a4e,
  red: 0xc4432f,
  white: 0xe6e0d2,
};

// ---------------------------------------------------------------------------
// Shared body-building helpers
// ---------------------------------------------------------------------------

// Pushes one solid into `list` with a full position/rotation/scale/pivot baked into the
// geometry, so a whole school or a whole reef can share a single merge.
//
// mergeColored() applies only an axis-aligned Euler rotation and a translation per part,
// which is not enough for anything in this file: a fish is a swept body squashed
// sideways, an octopus arm's suckers each sit on their own frame, and a starfish arm is
// flattened about its own root. Baking a Matrix4 into a geometry we already own costs
// nothing and buys all of it.
//
// `about` is the point the rotation and scale happen around, and skipping it is the
// classic bug: these bodies are authored in ABSOLUTE animal coordinates, so flattening a
// fish by 0.5 around the default origin does not flatten the fish, it drops it through
// the floor. Solids built at the origin pass `pos` and need no pivot.
function seaSolid(list, geometry, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], about = null } = {}, base = null) {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  let m;
  if (about) {
    m = new THREE.Matrix4()
      .makeTranslation(pos[0] + about[0], pos[1] + about[1], pos[2] + about[2])
      .multiply(local)
      .multiply(new THREE.Matrix4().makeTranslation(-about[0], -about[1], -about[2]));
  } else {
    m = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]).multiply(local);
  }
  geometry.applyMatrix4(base ? base.clone().multiply(m) : m);
  list.push({ geometry, color });
}

// A tapered sweep, at whatever segment counts the caller can get away with. Everything in
// this world is read through 30+ feet of fog-coloured water, where a 22-segment sweep and
// a 12-segment one are the same animal.
function sweep(points, radii, tubular = 14, radial = 10) {
  return taperedTube(points, radii, { tubularSegments: tubular, radialSegments: radial });
}

// A sphere at whatever coarseness the caller asks for.
//
// The height-segment floor is 3, not the 5 it started at, and that one character was worth
// about 60,000 triangles across this world. Nearly everything here is a SMALL sphere -- a
// fish's eye, an anemone's tentacle tip, a sea star's tubercle -- asked for at detail 4 or
// 5, and a floor of 5 quietly made every one of them a 50-triangle ball a few inches
// across. Below about six segments a sphere is a blob whichever way you slice it, so the
// rings are where the saving is.
function ball(radius, detail = 10) {
  return new THREE.SphereGeometry(radius, detail, Math.max(3, detail >> 1));
}

// A short capped cylinder, for the small tubular details (nostrils, suckers, sponge walls).
function stub(radius, height, segments = 6, taper = 0.85) {
  return new THREE.CylinderGeometry(radius, radius * taper, height, segments);
}

// Resizes a finished body by scaling its MERGED geometry, rather than threading a scale
// factor through every coordinate in the builder.
//
// Two reasons it is done here and not on the Group. Object3D.scale is not available:
// WorldStore.applyTransform() REPLACES an object's scale from its record, so a builder
// that scaled its own Group would have that silently discarded on the next reload -- the
// same trap the startup assets' `targetHeight` field exists to work around. And threading
// `s` through the coordinates by hand is how you end up multiplying by it twice, which is
// exactly what happened to the shark's fins the first time round: the sweep helper scaled
// its points AND the placement scaled the result, and an 8.5ft animal grew 8.5ft fins.
//
// Every body in this file is authored with its base at y = 0 and its centre on x = z = 0,
// so a uniform scale about the origin is precisely the right transform.
function sized(meshes, s) {
  if (s !== 1) for (const m of meshes) m.geometry.scale(s, s, s);
  return meshes;
}

// A thin fin blade, extruded from a 2D outline.
//
// Authored in the fin's own plane: +x toward the animal's NOSE, +y out along the span.
// The rotations below move that plane into the animal's frame, and they are baked into
// the geometry (rather than passed as a Euler) because two of them have to happen in a
// known order -- a single Euler cannot express "stand the blade up, THEN lay it flat".
//
// Real fins are genuinely thin, so there is no bevel: at an inch thick the square edge is
// invisible from anywhere a student can stand, and bevelling one costs more triangles
// than the blade itself.
function finBlade(outline, thickness = 0.06, { flat = false } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(-Math.PI / 2); // blade into the YZ plane: local +x -> +Z (nose), thickness -> X
  if (flat) g.rotateZ(-Math.PI / 2); // and again for paired fins: span -> +X (outboard)
  return g;
}

// A tileable near-white blotch field, multiplied over a part's vertex colour to give it
// patterned skin.
//
// NEAR-WHITE is the whole contract. `map` x `vertexColors` multiplies, so anything the
// texture darkens is skin the vertex colour then tints; anything it leaves at 1.0 comes
// through as the vertex colour exactly. One texture therefore dresses the tan octopus,
// the yellow moray and the speckled sea cucumber, each keeping its own hue.
//
// Every blotch is drawn nine times, once per wrap offset, because a map that does not
// tile shows its seam as a hard line straight down an animal's flank.
function mottleTexture(seed, { spots = 70, min = 0.022, max = 0.075, floor = 0.42, size = 256, repeat = [3, 2] } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < spots; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = randomIn(rng, min, max) * w;
      const squash = randomIn(rng, 0.6, 1.5);
      const dark = randomIn(rng, floor, Math.min(1, floor + 0.4));
      const value = Math.round(dark * 255);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cx = x + dx * w;
          const cy = y + dy * h;
          if (cx < -r * 2 || cx > w + r * 2 || cy < -r * 2 || cy > h + r * 2) continue;
          // Soft-edged, for the same reason the Mars dust devil's streaks had to be:
          // a hard-edged blotch wrapped onto a curved body reads as a sticker on it.
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * squash);
          grad.addColorStop(0, `rgb(${value},${value},${value})`);
          grad.addColorStop(0.6, `rgba(${value},${value},${value},0.55)`);
          grad.addColorStop(1, `rgba(${value},${value},${value},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r * squash, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return texture;
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 1 -- the reef shark
// ---------------------------------------------------------------------------

// A Caribbean reef shark, 8.5ft nose to tail, cruising.
//
// What makes a shark read as a shark, in the order each one buys the most:
//
//  * THE FIRST DORSAL, and it has to be big. It is the one part of this animal that
//    everybody on earth can draw, and undersizing it turns the whole thing into a large
//    grey fish. Its trailing edge is CONCAVE and it overhangs at the back.
//  * COUNTERSHADING -- grey over a hard-edged white belly. On a real shark that line is
//    startlingly crisp, and softening it loses most of the animal's form.
//  * A HETEROCERCAL TAIL: the upper lobe is much longer than the lower one and swept up.
//    A symmetrical tail is a tuna's, and it is the single fastest way to make this look
//    like a toy.
//  * PECTORALS HELD OUT AND DOWN like wings, not folded back. A shark cannot stop
//    swimming and these are what it flies on, so they are always deployed.
//  * FIVE GILL SLITS, raked forward. Small, dark, and worth far more than they cost.
//
// The origin is the lowest point of the belly, not the body's centre line: a layout
// places this with `y` feet ABOVE the sea floor, and "twelve feet up" should mean twelve
// feet of clear water under the animal.
export function reefShark({ length = 8.5, seed = 5, back = 0x76786f, belly = 0xf8f5ea } = {}) {
  const s = length / 8.5;
  const flank = new THREE.Color(back).offsetHSL(0.005, 0.02, 0.07).getHex();
  const finDark = new THREE.Color(back).offsetHSL(0, 0.01, -0.07).getHex();
  const parts = [];
  // Authored throughout at the nominal 8.5ft and resized once at the end by sized().
  const put = (geometry, color, t) => seaSolid(parts, geometry, color, t);

  // --- body ------------------------------------------------------------------------
  // One sweep from the tail stalk to the snout. A shark is a single fusiform mass with
  // the widest point just behind the pectorals, which is exactly what a taper is for.
  put(sweep(
    [[0, 1.30, -4.30], [0, 1.30, -3.70], [0, 1.28, -2.80], [0, 1.28, -1.60], [0, 1.30, -0.30],
      [0, 1.34, 1.00], [0, 1.36, 2.10], [0, 1.34, 3.10], [0, 1.28, 3.95], [0, 1.24, 4.28]],
    [0.07, 0.14, 0.26, 0.44, 0.58, 0.57, 0.48, 0.33, 0.19, 0.10], 22, 12
  ), back);
  // A rounded snout cap. Reef sharks are blunt in front, and a sweep that runs out to a
  // point gives them a swordfish's bill.
  put(ball(0.14, 8), back, { pos: [0, 1.24, 4.26], scale: [1.1, 0.85, 1.0] });

  // The flank, a shade lighter than the back. Thin sheets rather than a second sweep:
  // this is the transition band between the dark top and the white belly, and on a real
  // shark it is a visible third tone rather than a blend.
  for (const side of [-1, 1]) {
    put(sweep(
      [[side * 0.30, 1.12, -2.60], [side * 0.44, 1.12, -1.20], [side * 0.50, 1.16, 0.20],
        [side * 0.46, 1.22, 1.60], [side * 0.34, 1.24, 2.70]],
      [0.11, 0.16, 0.19, 0.16, 0.10], 10, 8
    ), flank, { scale: [0.45, 1, 1], about: [side * 0.44, 1.18, 0] });
  }

  // The white belly: a WIDE FLATTENED MASS inside the body, not a tube slung below it.
  //
  // Sizing this is subtler than it looks, and the first pass got it wrong in a way worth
  // recording. An ellipse only a couple of inches proud of an 8.5ft body shows as a
  // hairline from below, so the countershading -- which is the second thing anybody
  // recognises a shark by -- simply was not there. What matters is not how far it hangs
  // below but HOW FAR UP THE FLANKS IT COMES: sized so its widest point sits well below
  // the body's own, the white wraps from about 25 degrees under the horizontal all the way
  // round the underside, which is exactly where a real shark's line falls.
  put(sweep(
    [[0, 1.06, -3.00], [0, 1.02, -1.60], [0, 1.02, -0.30], [0, 1.06, 1.20], [0, 1.12, 2.40], [0, 1.14, 3.30]],
    [0.24, 0.40, 0.52, 0.50, 0.39, 0.24], 14, 10
  ), belly, { scale: [1.02, 0.80, 1], about: [0, 1.04, 0] });

  // --- fins ---------------------------------------------------------------------------
  // First dorsal. The apex sits well forward of the free rear tip, and the trailing edge
  // dips BELOW the straight line between them -- that concavity is the shape everybody
  // recognises, and a straight-edged triangle is a dinghy's sail.
  put(finBlade([[0.62, 0.00], [0.10, 0.94], [-0.44, 0.30], [-0.78, 0.02]], 0.07), back,
    { pos: [0, 1.80, 0.30] });
  put(finBlade([[0.24, 0.00], [0.02, 0.28], [-0.20, 0.10], [-0.34, 0.00]], 0.05), finDark,
    { pos: [0, 1.44, -2.65] });
  // Anal fin, mirroring the second dorsal underneath.
  put(finBlade([[0.22, 0.00], [0.00, -0.26], [-0.20, -0.09], [-0.32, 0.00]], 0.05), belly,
    { pos: [0, 0.92, -2.80] });

  // Pectorals, held out and DOWN -- a shark cannot stop swimming, so these are never
  // folded. `flat` lays the blade over so its span runs outboard; the Euler then tilts it
  // down (Z) before sweeping it back (Y), which is the order a three.js XYZ Euler applies
  // them in. The left one is a true MIRROR of the right (a negative X scale with both
  // rotations negated), not a separately-authored fin.
  for (const side of [-1, 1]) {
    put(finBlade([[0.50, 0.00], [0.20, 1.00], [-0.30, 1.12], [-0.66, 0.08]], 0.06, { flat: true }), back,
      { pos: [side * 0.38, 1.14, 1.35], rot: [0, side * 0.30, side * -0.34], scale: [side, 1, 1] });
    // Pelvics, small, well back, and much flatter to the body.
    put(finBlade([[0.26, 0.00], [0.06, 0.40], [-0.20, 0.44], [-0.36, 0.04]], 0.05, { flat: true }), belly,
      { pos: [side * 0.26, 0.82, -1.55], rot: [0, side * 0.22, side * -0.18], scale: [side, 1, 1] });
  }

  // The tail, as two lobes rather than one outline. Built separately the notch between
  // them is exact and each lobe carries its own sweep; built as one polygon the notch has
  // to be guessed and comes out either welded shut or as a slot.
  put(finBlade([[0.34, 0.04], [-0.36, 0.96], [-1.05, 1.68], [-0.62, 0.52], [-0.16, 0.06]], 0.06), back,
    { pos: [0, 1.32, -4.18] });
  put(finBlade([[0.30, -0.04], [-0.18, -0.50], [-0.88, -0.76], [-0.44, -0.30], [-0.12, -0.06]], 0.06), back,
    { pos: [0, 1.28, -4.18] });

  // --- head detail ----------------------------------------------------------------------
  for (const side of [-1, 1]) {
    // Five gill slits, raked forward and down, sitting just proud of the flank.
    for (let i = 0; i < 5; i++) {
      put(new THREE.BoxGeometry(0.03, 0.40, 0.055), 0x4b4d47,
        { pos: [side * (0.455 - i * 0.012), 1.30 - i * 0.015, 2.32 - i * 0.19], rot: [0, 0, side * 0.30] });
    }
    put(ball(0.075, 8), 0x110f0d, { pos: [side * 0.255, 1.47, 3.28], scale: [0.8, 1, 1] });
    // Nostril, a small dark crease under the snout. Two triangles' worth of detail that
    // costs nothing and stops the underside of the head from being a blank cone.
    put(ball(0.05, 6), 0x3b3833, { pos: [side * 0.13, 1.09, 3.92], scale: [1.4, 0.5, 0.8] });
  }
  // The mouth: a dark crescent on the UNDERSIDE, which is where a shark's mouth actually
  // is -- drawn on the front of the snout it becomes a cartoon.
  put(ball(0.30, 10), 0x2a2723, { pos: [0, 1.07, 3.42], scale: [0.92, 0.16, 0.62] });
  put(ball(0.26, 8), 0xd8d2c4, { pos: [0, 1.045, 3.44], scale: [0.86, 0.07, 0.5] });

  return group(...sized([
    mergedMesh(parts, {
      roughness: 0.52,
      flatShading: true,
      side: THREE.DoubleSide, // the fin blades are thin enough to see the back of
      ...relief('weave', { seed, repeat: 22, strength: 0.14 }),
    }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 2 -- the moray eel
// ---------------------------------------------------------------------------

// A moray looking out of its hole, which is the only way anybody ever sees one.
//
// The animal is DELIBERATELY its own object, separate from the cave it lives in. Anything
// a student is invited to click and program has to be a thing they can actually pick --
// built into the rock, "make the eel look around" would have turned the reef instead.
// reefCave() below is the hole; a layout puts the two together.
//
// Everything that makes it a moray:
//
//  * THE OPEN MOUTH, permanently. It is not a threat display -- a moray has no gill covers
//    to pump water with, so it breathes by gaping, and a closed-mouthed moray looks dead.
//    Build it closed and the two tooth rows also interpenetrate into one welded saw, the
//    same trap the T. rex's jaw hit.
//  * A LONG HEAD with a narrow snout and the eye set well back, near the jaw hinge. Eels
//    are all head and neck from the front.
//  * A CONTINUOUS DORSAL RIDGE running from behind the head all the way down. No paired
//    fins anywhere -- a moray has no pectorals at all, and adding them makes a fish.
//  * RETICULATED SKIN. The pattern is the species and it is scaleless and slimy, so the
//    material is much glossier than any other animal here.
export function morayEel({ length = 6, seed = 11, skin = 0xc7a24e, gape = 0.42 } = {}) {
  const s = length / 6;
  const pale = new THREE.Color(skin).offsetHSL(0.01, -0.16, 0.16).getHex();
  const body = [];
  const detail = [];

  // The jaw hinge, and the swing that opens the mouth. Both jaws' tooth rows are swung
  // about it as one piece by a single angle, exactly as the T. rex's are -- which is what
  // stops the two rows from being modelled into each other.
  const HINGE = [0, 2.02, 2.42];
  const swing = ([x, y, z]) => {
    const dy = y - HINGE[1];
    const dz = z - HINGE[2];
    return [x, HINGE[1] + dy * Math.cos(gape) - dz * Math.sin(gape), HINGE[2] + dy * Math.sin(gape) + dz * Math.cos(gape)];
  };

  // --- body ---------------------------------------------------------------------------
  // An S-curve rising out of the rock. The lift matters as much as the curve: a moray
  // holds its head clear of the hole and swings it, and one lying flat is a rope.
  const spine = [
    [-0.85, 0.42, -2.70], [-0.55, 0.50, -1.80], [-0.22, 0.66, -0.90], [0.06, 0.94, 0.00],
    [0.20, 1.32, 0.85], [0.18, 1.68, 1.55], [0.08, 1.92, 2.10],
  ];
  seaSolid(body, sweep(spine, [0.30, 0.42, 0.49, 0.48, 0.43, 0.37, 0.32], 20, 12), skin, {});
  // Laterally compressed toward the tail, which is what an eel is -- round at the head,
  // a ribbon at the back.
  seaSolid(body, sweep(
    [[-0.85, 0.42, -2.70], [-0.60, 0.48, -2.00], [-0.38, 0.55, -1.35]],
    [0.26, 0.34, 0.38], 8, 10
  ), skin, { scale: [0.66, 1.25, 1], about: [-0.6, 0.48, -2.0] });

  // The dorsal ridge: one low crest following the spine. Flattened in X rather than built
  // as a blade, so it follows the body's curve for free.
  seaSolid(body, sweep(
    spine.slice(0, 6).map(([x, y, z]) => [x, y + 0.34, z]).concat([[0.16, 2.12, 1.70]]),
    [0.20, 0.26, 0.28, 0.27, 0.24, 0.20, 0.12], 16, 8
  ), pale, { scale: [0.20, 1, 1], about: [-0.1, 1.0, 0] });

  // --- head ---------------------------------------------------------------------------
  // Three tapering pieces rather than one: a moray's skull is deep and wide at the back
  // for the jaw muscles and narrows to a blade at the snout, and a single sweep cannot
  // change its aspect ratio along its own length.
  seaSolid(body, sweep(
    [[0.08, 1.92, 2.05], [0.06, 2.00, 2.45], [0.02, 2.06, 2.90], [-0.02, 2.08, 3.30], [-0.05, 2.06, 3.62]],
    [0.32, 0.31, 0.27, 0.19, 0.07], 12, 10
  ), skin, { scale: [1, 1.12, 1], about: [0.05, 2.0, 2.4] });

  // The lower jaw, swung open about the hinge as one piece with its teeth.
  seaSolid(body, sweep(
    [swing([0.06, 1.80, 2.20]), swing([0.03, 1.76, 2.62]), swing([0.00, 1.76, 3.05]),
      swing([-0.03, 1.78, 3.42]), swing([-0.05, 1.80, 3.66])],
    [0.26, 0.24, 0.20, 0.14, 0.06], 10, 8
  ), skin, {});

  // The mouth's inside. Without it the gape is a hole straight through the head -- the
  // same lesson as capping a cut vessel in the anatomy world.
  seaSolid(detail, ball(0.24, 8), 0xa4695f, { pos: [0.04, 1.94, 2.55], scale: [0.85, 0.9, 1.5] });

  // Teeth: a row along each jaw, plus the long recurved fangs at the front that a moray
  // actually has. Small, white, and the single most-read detail on the whole animal.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const z = 2.55 + t * 1.0;
      const long = i < 2 ? 1.9 : 1;
      const w = 0.19 - t * 0.11;
      seaSolid(detail, new THREE.ConeGeometry(0.035, 0.16 * long, 5), 0xf2ecdc,
        { pos: [side * w, 1.92 - t * 0.02, z], rot: [0.25, 0, side * 0.16] });
      const [, ly, lz] = swing([0, 1.86, z]);
      seaSolid(detail, new THREE.ConeGeometry(0.032, 0.14 * long, 5), 0xf2ecdc,
        { pos: [side * (w * 0.85), ly, lz], rot: [Math.PI - 0.25 + gape, 0, side * -0.16] });
    }
    // Eye: set BACK by the hinge, small, and pale-ringed. A moray's eye is milky and
    // catches the light, which is most of what gives the face its expression.
    seaSolid(detail, ball(0.085, 8), 0xd8cfae, { pos: [side * 0.235, 2.13, 2.72] });
    seaSolid(detail, ball(0.05, 6), 0x14110d, { pos: [side * 0.275, 2.13, 2.75] });
    // The tubular anterior nostril on the snout tip -- a small thing, and unmistakably eel.
    seaSolid(detail, stub(0.028, 0.11), pale, { pos: [side * 0.075, 2.04, 3.55], rot: [1.25, 0, side * 0.2] });
    // The gill pore, a round dark hole low behind the head. Morays have exactly one.
    seaSolid(detail, ball(0.075, 6), 0x4c3a22, { pos: [side * 0.29, 1.80, 1.62], scale: [0.5, 1, 1] });
  }

  return group(...sized([
    // The map is what makes this a moray and not a yellow tube. Near-white blotches over a
    // yellow-brown vertex colour give the reticulated pattern, and the repeat is high
    // because the animal is 6ft of skin and the texture is 256px.
    mergedMesh(body, {
      roughness: 0.28,
      map: mottleTexture(seed, { spots: 130, min: 0.02, max: 0.055, floor: 0.34, repeat: [7, 4] }),
    }),
    mergedMesh(detail, { roughness: 0.34, flatShading: true }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 3 -- the octopus
// ---------------------------------------------------------------------------

// A common octopus sprawled over the rubble, arms out.
//
// The four things that carry it:
//
//  * THE EYE. It is the whole animal. A big domed lens set high on the side of the head
//    with a HORIZONTAL BAR pupil -- not a round one -- and a gold iris around it. Get that
//    and a lump of clay reads as an octopus; miss it and nothing else rescues it.
//  * ARMS THAT EACH DO SOMETHING DIFFERENT. Eight identical arms radiating evenly is a
//    starfish or a cartoon sun. Real ones sprawl, curl back on themselves, and lift a tip
//    to feel about, and the variety is what makes it look alive rather than dead.
//  * SUCKERS, in two rows, biggest near the body and shrinking to the tip. They are placed
//    from the arm's own curve rather than left to the texture, because the Frenet frame a
//    swept tube uses twists unpredictably along a curling path -- there is no fixed `v` in
//    the UVs that means "underside".
//  * MOTTLED SKIN with the papillae standing up. An octopus's colour is never flat; the
//    texture map over the vertex colour is what supplies that for the price of one canvas.
//
// The mantle is the bulb at the BACK, and getting that backwards is the commonest mistake
// in drawing one: the eyes are not on it, they are on the smaller head in front of it.
export function octopus({ span = 6.5, seed = 17, skin = 0xb08b63 } = {}) {
  const s = span / 6.5;
  const rng = seededRandom(seed);
  const base = new THREE.Color(skin);
  const shade = base.clone().offsetHSL(-0.01, 0.06, -0.11).getHex();
  const pale = base.clone().offsetHSL(0.01, -0.10, 0.14).getHex();
  const skinParts = [];
  const detail = [];

  // --- mantle and head ------------------------------------------------------------------
  // The mantle is the bulb at the BACK. The eyes are NOT on it -- they sit on the smaller
  // head in front, and putting them on the mantle is the single commonest mistake anyone
  // makes drawing one.
  seaSolid(skinParts, ball(0.80, 12), skin, { pos: [0, 1.34, -1.00], scale: [0.92, 0.86, 1.32], rot: [-0.24, 0, 0] });
  seaSolid(skinParts, ball(0.56, 12), skin, { pos: [0, 1.10, 0.06], scale: [1.14, 0.94, 1.0] });
  // The web, a low skirt joining the arm bases. It is what stops eight tubes stuck into a
  // ball from reading as a spider.
  seaSolid(skinParts, ball(0.98, 14), shade, { pos: [0, 0.50, 0.10], scale: [1.0, 0.30, 1.05] });

  // --- eyes ----------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    seaSolid(skinParts, ball(0.31, 10), skin, { pos: [side * 0.40, 1.32, 0.10], scale: [0.9, 0.95, 0.9] });
    // A raised brow papilla over each eye -- octopuses put these up, and it is the
    // difference between a face and a bump.
    seaSolid(skinParts, ball(0.12, 6), shade, { pos: [side * 0.40, 1.52, 0.06], scale: [1.3, 0.7, 1.1] });
    seaSolid(detail, ball(0.24, 10), 0xd8a63c, { pos: [side * 0.53, 1.35, 0.13], scale: [0.85, 0.85, 0.85] });
    // The pupil is a HORIZONTAL BAR, not a dot. It is the one detail that turns a lump of
    // clay into an octopus, and a round pupil loses it completely.
    seaSolid(detail, new THREE.BoxGeometry(0.055, 0.085, 0.37), 0x141110,
      { pos: [side * 0.655, 1.35, 0.13], rot: [0, 0, side * 0.12] });
  }
  // The siphon, tucked under the head on one side. Small, and the only part of an octopus
  // that explains how it moves.
  seaSolid(skinParts, stub(0.13, 0.34, 8), pale, { pos: [0.30, 0.80, 0.44], rot: [1.15, 0, -0.35] });

  // --- arms -----------------------------------------------------------------------------
  // Eight bearings, unevenly spaced on purpose: an octopus is bilateral, so the front pair
  // reach forward and the back pair tuck under the mantle, and an even fan of eight looks
  // like a fairground ride.
  const bearings = [-0.30, 0.30, -0.92, 0.98, -1.72, 1.66, -2.55, 2.62];
  for (let i = 0; i < bearings.length; i++) {
    const a = bearings[i];
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const reach = randomIn(rng, 0.82, 1.12) * 2.75;
    // How far this arm curls its tip up off the sand, and how much it swings sideways.
    // Rolled per arm, and the mix is what reads as "alive" -- three of the eight lifted
    // and the rest flat is roughly what a settled octopus looks like.
    const lift = rng() < 0.4 ? randomIn(rng, 0.55, 1.15) : randomIn(rng, -0.02, 0.16);
    const sway = randomIn(rng, -0.75, 0.75);
    const points = [];
    const radii = [];
    const steps = 5;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const dist = 0.42 + t * reach;
      // The lateral wave grows along the arm, so the curl happens out at the tip where a
      // real one does rather than at the shoulder.
      const bend = Math.sin(t * Math.PI * 0.85) * sway * t;
      const px = dx * dist - dz * bend;
      const pz = dz * dist + dx * bend;
      // Down off the web, along the ground, then up at the tip by `lift`.
      const py = 0.52 - Math.sin(t * Math.PI * 0.55) * 0.34 + Math.pow(t, 2.4) * lift + 0.16;
      points.push([px, Math.max(0.10, py), pz]);
      radii.push(0.235 * (1 - t) ** 0.72 + 0.028);
    }
    seaSolid(skinParts, sweep(points, radii, 12, 8), i % 2 === 0 ? skin : shade, {});

    // Suckers, sampled off the arm's own curve. Two rows, on whichever side of the arm is
    // "down-and-inward" for this arm -- computed here rather than left to the tube's UVs,
    // which twist with the Frenet frame and cannot be relied on to keep a row on one face.
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const count = 9;
    for (let k = 0; k < count; k++) {
      const t = 0.09 + (k / count) * 0.78;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const armR = 0.235 * (1 - t) ** 0.72 + 0.028;
      // Across the arm and along it: one row either side of the arm's underside.
      const across = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const under = new THREE.Vector3().crossVectors(across, tangent).normalize().multiplyScalar(-1);
      for (const row of [-1, 1]) {
        const offset = across.clone().multiplyScalar(row * armR * 0.44).add(under.clone().multiplyScalar(armR * 0.78));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), under);
        const g = new THREE.CylinderGeometry(armR * 0.40, armR * 0.30, armR * 0.30, 6);
        g.applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(p.x + offset.x, p.y + offset.y, p.z + offset.z), q, new THREE.Vector3(1, 1, 1)
        ));
        detail.push({ geometry: g, color: pale });
      }
    }
  }

  return group(...sized([
    mergedMesh(skinParts, {
      roughness: 0.42,
      flatShading: true,
      map: mottleTexture(seed + 3, { spots: 90, min: 0.03, max: 0.09, floor: 0.5, repeat: [4, 3] }),
    }),
    mergedMesh(detail, { roughness: 0.34, flatShading: true }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 4 -- the sea star
// ---------------------------------------------------------------------------

// A five-armed sea star, `size` feet from tip to opposite tip.
//
// Three things make one read correctly, and all three are cheap:
//
//  * THE ARMS TAPER FROM A DISC, they do not radiate from a point. The centre is a real
//    body with its own width, and the arms leave it already thick -- a star drawn as five
//    spokes meeting at a dot is a Christmas decoration.
//  * IT IS FLAT ON THE BOTTOM AND DOMED ON TOP. Flattening the arms about their own root
//    is what makes it lie ON the sand instead of resting on a line.
//  * THE BEADED SKIN. A sea star's surface is covered in hard pale tubercles in rows down
//    each arm, and they catch the light in a way the flat colour cannot. It is the same
//    idea as the goose's feather edging: the pattern is the animal.
export function starfish({ size = 2, color = 0xd4392c, seed = 23, arms = 5 } = {}) {
  const rng = seededRandom(seed);
  const tint = new THREE.Color(color);
  const tip = tint.clone().offsetHSL(0.01, -0.05, 0.10).getHex();
  const bead = tint.clone().offsetHSL(0.005, -0.30, 0.28).getHex();
  const parts = [];
  const R = size / 2;

  // The central disc.
  seaSolid(parts, ball(R * 0.34, 12), color, { pos: [0, R * 0.14, 0], scale: [1, 0.52, 1] });

  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + randomIn(rng, -0.06, 0.06);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const len = R * randomIn(rng, 0.94, 1.04);
    const points = [];
    const radii = [];
    const steps = 4;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const d = R * 0.14 + t * (len - R * 0.14);
      // A slight upward curl at the tip. Real sea stars raise their arm tips when they
      // move, and a perfectly flat one looks pressed rather than placed.
      points.push([dx * d, R * 0.15 + Math.pow(t, 2.6) * R * 0.16, dz * d]);
      radii.push(R * 0.30 * (1 - t * 0.86) + R * 0.022);
    }
    // Flattened about the arm's own mid-height, not about the world origin -- a plain
    // scale would drag the arm down through the sand as well as squashing it.
    seaSolid(parts, sweep(points, radii, 8, 8), color, { scale: [1, 0.5, 1], about: [0, R * 0.15, 0] });
    // A paler tip cap, and the beads: a central row down the arm's ridge with a shorter
    // row either side of it, shrinking outward.
    seaSolid(parts, ball(R * 0.055, 6), tip, { pos: [dx * len, R * 0.15 + Math.pow(1, 2.6) * R * 0.08, dz * len], scale: [1, 0.6, 1] });
    for (let k = 0; k < 7; k++) {
      const t = 0.08 + (k / 7) * 0.86;
      const d = R * 0.14 + t * (len - R * 0.14);
      const armR = R * 0.30 * (1 - t * 0.86) + R * 0.022;
      // The arm was flattened by half about y = R*0.15, so its top surface is only half
      // as far above that line as the sweep radius says. Beads sized off the unflattened
      // radius float in the water above the arm -- the same class of mistake as the T.
      // rex's dorsal stripe sitting on the body axis instead of on the back.
      const ridge = R * 0.15 + (Math.pow(t, 2.6) * R * 0.16) * 0.5 + armR * 0.5;
      for (const row of [-1, 0, 1]) {
        if (row !== 0 && t > 0.6) continue;
        const across = row * armR * 0.55;
        seaSolid(parts, ball(R * (row === 0 ? 0.05 : 0.038), 5), bead, {
          pos: [dx * d - dz * across, ridge - (row === 0 ? 0.01 : armR * 0.18), dz * d + dx * across],
          scale: [1, 0.62, 1],
        });
      }
    }
  }
  // The madreporite: the pale off-centre plate a sea star pumps water in through. One
  // sphere, and it is the detail that tells a student this is an animal and not a shape.
  seaSolid(parts, ball(R * 0.075, 6), bead, { pos: [R * 0.14, R * 0.28, R * 0.10], scale: [1, 0.5, 1] });

  return group(mergedMesh(parts, { roughness: 0.72, flatShading: true, ...relief('stone', { seed, repeat: 5, strength: 0.5 }) }));
}

// ---------------------------------------------------------------------------
// The reef itself -- rock, coral and sponge
// ---------------------------------------------------------------------------

// Every coral below is a sphere, a disc or a stick. That is not a shortcut taken for
// performance; it is what coral actually is. What separates a reef from a pile of rubble
// is that no two colonies next to each other are the same colour, so the budget in this
// half of the file goes almost entirely into hue and almost none into geometry -- which is
// also what the brief asked for, and happens to be exactly what a Chromebook wants.

// A reef mound: the limestone lump everything else grows on.
//
// roughenSphere() displaces by a smooth function of DIRECTION rather than per vertex,
// which is not optional here: IcosahedronGeometry is NON-INDEXED, so every triangle owns
// its own copy of each corner, and per-vertex jitter tears the surface into loose shards.
export function coralBommie({ radius = 6, height = 5, seed = 41, color = REEF.rock } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const tones = [color, REEF.rockDark, REEF.rockPink, REEF.rockPurple, REEF.algae];

  const lumps = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < lumps; i++) {
    const t = i / lumps;
    const a = rng() * Math.PI * 2;
    const d = randomIn(rng, 0, radius * 0.55);
    const r = radius * randomIn(rng, 0.38, 0.62) * (1 - t * 0.3);
    // Subdivision by size, not a flat count. An icosahedron at detail 1 is 80 faces, which
    // on a nine-foot mound is a three-foot facet -- big enough to read as a cut gemstone
    // rather than as rock. Detail 2 is four times the triangles and is only spent on the
    // masses actually big enough to show the difference.
    const g = roughenSphere(new THREE.IcosahedronGeometry(r, r > 3 ? 2 : 1), {
      amount: randomIn(rng, 0.22, 0.38),
      flatten: randomIn(rng, 0.62, 0.9),
      phase: rng() * 6,
    });
    // Sunk well into the sand: a reef mound has no visible bottom edge, and a sphere
    // resting ON the floor reads as a dropped boulder instead of as bedrock.
    seaSolid(parts, g, tones[Math.floor(rng() * tones.length)], {
      pos: [Math.sin(a) * d, height * randomIn(rng, 0.18, 0.62) - r * 0.45, Math.cos(a) * d],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.95, flatShading: true, ...relief('stone', { seed, repeat: 4 }) }));
}

// A reef mound with a hole in it, for the moray to live in. The opening faces +Z.
//
// The DARK INTERIOR BOX behind the mouth is what makes it a cave rather than a doorway.
// There is nothing back there, so without it a student sees straight through to the fogged
// water on the far side and the hole reads as a gap between two rocks -- the same fix a
// 1940's New York shopfront needed behind its glass.
export function reefCave({
  width = 16, height = 10, mouth = 5.5, mouthHeight = 6.5, recess = 5, seed = 43,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const dark = [];
  // No algae green in this tone set, unlike the open bommies'. Every surface framing this
  // hole is either an overhang or faces away from a near-vertical sun, so it is lit by the
  // ground bounce alone -- and the darkest colour in the palette, on the one face nothing
  // else lights, came out as a slab of black hanging over the entrance.
  const tones = [REEF.rock, REEF.rockPink, REEF.rockPurple, REEF.rockDark];
  const hw = mouth / 2;

  const lump = (r, pos, flatten = 0.8) => {
    seaSolid(parts, roughenSphere(new THREE.IcosahedronGeometry(r, r > 3 ? 2 : 1), {
      amount: randomIn(rng, 0.18, 0.32), flatten, phase: rng() * 6,
    }), tones[Math.floor(rng() * tones.length)], { pos });
  };

  // THE RECESS IS BUILT FIRST AND THE ROCK IS BUILT AROUND IT.
  //
  // The first version of this did it the other way -- a heap of boulders with a couple of
  // dark slabs shoved in behind -- and it produced neither a hole nor a cave: the slabs
  // stuck out through the rock as black fins, and the "mouth" was a two-foot slot with a
  // boulder filling it. Starting from the void and enclosing it is the only way to be sure
  // there is actually a way in.
  //
  // Five faces of a box with the front left open. Deliberately not black: a pure black
  // hole in a bright blue world reads as a rendering fault rather than as depth. This is a
  // very dark warm brown, which is what the inside of a reef ledge looks like with a torch
  // on it.
  //
  // THE VOID IS BUILT BIGGER THAN THE OPENING, which is the second thing this got wrong.
  // Sized to match, its four straight edges landed exactly at the gap between the rocks and
  // the cave read as a black RECTANGLE cut into the reef -- geometry, not a hole. Oversized
  // by half again, every edge of it is hidden behind rock and all a student sees is
  // darkness in an irregular gap, which is what a cave mouth looks like.
  const t = 0.4;
  const vw = mouth * 1.6;
  const vh = mouthHeight * 1.4;
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, vh, t), color: 0x1b1712,
    position: [0, vh / 2, -recess] });
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, t, recess), color: 0x231c15,
    position: [0, vh, -recess / 2] });
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, t, recess), color: 0x2c241a,
    position: [0, 0.12, -recess / 2] });
  for (const side of [-1, 1]) {
    dark.push({ geometry: new THREE.BoxGeometry(t, vh, recess), color: 0x231c15,
      position: [side * (vw / 2 + t / 2), vh / 2, -recess / 2] });
  }

  // Now the rock, placed from the recess's own dimensions so it always encloses it. Each
  // flank lump's INNER edge lands a few inches inside the opening, which is what hides the
  // recess box's corners without narrowing the way in.
  const sideR = Math.max(2.6, (width - mouth) * 0.30);
  for (const side of [-1, 1]) {
    lump(sideR, [side * (hw + sideR * 0.95), height * 0.30, 1.1]);
    lump(sideR * 0.86, [side * (hw + sideR * 1.0), height * 0.58, -recess * 0.45]);
    lump(sideR * 0.7, [side * (hw + sideR * 1.35), height * 0.16, -recess * 0.95]);
    // The forward shoulders. Set out at 1.15 rather than the 0.7 this started at: parked
    // closer in they stood squarely in front of the opening from every approach angle and
    // narrowed a five-foot mouth to under three, which turned the cave -- and the animal
    // that is the whole reason for it -- into a slot glimpsed between two boulders.
    lump(sideR * 0.62, [side * (hw + sideR * 1.15), height * 0.12, 2.6], 0.7);
  }
  // The lintel over the mouth, dropped far enough to overlap the top of the recess, and
  // built as three overlapping masses rather than one. A single block wide enough to span
  // the opening presents one huge downward-facing facet, and a facet that size in permanent
  // shade is the most conspicuous surface on the whole prop.
  for (const off of [-1, 0, 1]) {
    lump(width * 0.17, [off * width * 0.15, mouthHeight + width * (0.11 + Math.abs(off) * 0.03), 0.6 - Math.abs(off) * 0.5], 0.62);
  }
  lump(width * 0.22, [0, mouthHeight + width * 0.19, -recess * 0.6], 0.7);
  lump(width * 0.30, [0, height * 0.38, -(recess + width * 0.20)]);
  lump(width * 0.20, [randomIn(rng, -2, 2), height * 0.72, -(recess + width * 0.24)], 0.7);

  return group(
    mergedMesh(parts, { roughness: 0.95, flatShading: true, ...relief('stone', { seed, repeat: 4 }) }),
    mergedMesh(dark, { roughness: 1 })
  );
}

// The workhorse: a scatter of assorted low-poly corals and sponges, merged into ONE mesh.
//
// A reef is not a few big specimens, it is hundreds of small colonies packed shoulder to
// shoulder, and placing those as individual props would cost hundreds of draw calls for
// scenery nobody looks at directly. One garden is one draw call and about 3k triangles.
export function coralGarden({ radius = 7, count = 26, seed = 47, height = 1, palette, mound = 0 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const colors = palette ?? [
    REEF.orange, REEF.amber, REEF.gold, REEF.cream, REEF.pink, REEF.rose, REEF.magenta,
    REEF.lilac, REEF.blue, REEF.skyBlue, REEF.teal, REEF.green, REEF.red,
  ];
  const pick = () => {
    // Hue, saturation and lightness are jittered on top of the palette pick, for the same
    // reason the Park's flowers are: thirteen flat colours across a reef still reads as
    // thirteen kinds of plastic, however many of each there are.
    const c = new THREE.Color(colors[Math.floor(rng() * colors.length)]);
    c.offsetHSL(randomIn(rng, -0.03, 0.03), randomIn(rng, -0.12, 0.08), randomIn(rng, -0.09, 0.09));
    return c.getHex();
  };

  // How high the substrate is at a given distance from the middle.
  //
  // `mound` is what lets a garden be draped OVER a coral-bommie rather than laid on the
  // sand around its foot. Without it the reef came out as bare grey boulders standing in a
  // ring of coral, which is precisely backwards: on a real reef the rock is the skeleton of
  // the coral and there is barely a square inch of it uncovered. The profile is the same
  // squashed-sphere shape the bommies are built from, so a garden given a matching radius
  // and height sits on the rock rather than in it.
  const substrate = (d) => (mound ? mound * Math.pow(Math.max(0, 1 - (d / radius) ** 2), 0.6) : 0);

  // Recursive antler branching, for staghorn and finger corals.
  const branch = (x, y, z, dir, pitch, len, r, depth, color) => {
    if (depth > 3 || len < 0.16) return;
    const x2 = x + Math.sin(dir) * Math.cos(pitch) * len;
    const z2 = z + Math.cos(dir) * Math.cos(pitch) * len;
    const y2 = y + Math.sin(pitch) * len;
    parts.push({
      geometry: sweep([[x, y, z], [(x + x2) / 2, (y + y2) / 2, (z + z2) / 2], [x2, y2, z2]],
        [r, r * 0.86, r * 0.72], 3, 5),
      color,
    });
    const spread = randomIn(rng, 0.4, 0.85);
    for (const turn of [-1, 1]) {
      branch(x2, y2, z2, dir + turn * spread, Math.min(1.45, pitch + randomIn(rng, 0.05, 0.3)),
        len * randomIn(rng, 0.6, 0.82), r * 0.7, depth + 1, color);
    }
  };

  for (let i = 0; i < count; i++) {
    // sqrt for an even areal spread -- a plain uniform radius crowds everything into the
    // middle, which is exactly what a reef does NOT do.
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const y0 = substrate(d);
    // On the flank of a mound, a colony grows outward from the rock rather than straight
    // up. Leaning them by the local slope is what stops a draped garden from looking like
    // a lawn mown over a hill.
    //
    // CAPPED HARD at about 17 degrees, though, and that cap is doing more work than the
    // lean is. Left free to follow the real slope, plates and sponges out on a mound's
    // flank ended up at fifty-odd degrees, and a coloured slab tipped that far stops
    // reading as something growing and starts reading as litter dropped on the rock. Corals
    // do lean, but they always grow back toward the light, so the true angle is much
    // shallower than the rock under them.
    const slope = mound ? Math.min(0.3, (d / radius) * 0.36) : 0;
    const leanX = Math.sin(a) * slope;
    const leanZ = -Math.cos(a) * slope;
    const color = pick();
    const scale = height * randomIn(rng, 0.7, 1.35);
    // Plates and encrusting mats are dropped from a DRAPED garden. Both are essentially
    // flat, so on the flank of a mound they lie against the rock face and read as coloured
    // stickers pasted on it. On open sand, seen from above, they are two of the best shapes
    // here. Same colonies, opposite verdict, purely because of what they are seen against.
    const kinds = mound
      ? ['branch', 'brain', 'knob', 'tube', 'finger', 'knob', 'branch']
      : ['branch', 'plate', 'brain', 'knob', 'tube', 'mat', 'finger'];
    const kind = kinds[Math.floor(rng() * kinds.length)];

    if (kind === 'branch') {
      // Staghorn. Thick, because a thin one reads as a bare dead twig -- which is exactly
      // how the first pass came out, and the fix was girth rather than more branches.
      branch(x, y0 + 0.12 * scale, z, rng() * 6.28, 1.15 - slope * 0.5, randomIn(rng, 0.55, 0.9) * scale, 0.16 * scale, 0, color);
    } else if (kind === 'plate') {
      // Table coral: a thin disc on a short trunk, which is the shape that catches the
      // most light in the least material -- the same reason a tree has a canopy. Tilted
      // hard, because a plate lying dead flat on the sand reads as a dropped paper plate.
      const r = randomIn(rng, 0.7, 1.4) * scale;
      seaSolid(parts, stub(0.15 * scale, 0.55 * scale, 6), color, { pos: [x, y0 + 0.28 * scale, z] });
      seaSolid(parts, new THREE.CylinderGeometry(r, r * 0.8, 0.2 * scale, 9), color, {
        pos: [x, y0 + 0.6 * scale, z],
        rot: [randomIn(rng, -0.16, 0.16) + leanZ, 0, randomIn(rng, -0.16, 0.16) - leanX],
      });
    } else if (kind === 'brain') {
      const r = randomIn(rng, 0.45, 0.95) * scale;
      seaSolid(parts, roughenSphere(new THREE.IcosahedronGeometry(r, 1), { amount: 0.14, flatten: 0.72, phase: rng() * 6 }),
        color, { pos: [x, y0 + r * 0.46, z] });
    } else if (kind === 'knob') {
      const lobes = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < lobes; k++) {
        const r = randomIn(rng, 0.16, 0.34) * scale;
        seaSolid(parts, ball(r, 6), color, {
          pos: [x + randomIn(rng, -0.4, 0.4) * scale, y0 + r * 0.9 + randomIn(rng, 0, 0.5) * scale, z + randomIn(rng, -0.4, 0.4) * scale],
        });
      }
    } else if (kind === 'tube') {
      // Tube sponges, with a dark disc recessed in each mouth. A genuinely open-ended
      // cylinder would need DoubleSide to show its inside, which then costs every other
      // solid in this merge its backface culling.
      const tubes = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < tubes; k++) {
        const h = randomIn(rng, 0.7, 1.7) * scale;
        const r = randomIn(rng, 0.13, 0.22) * scale;
        const ox = x + randomIn(rng, -0.3, 0.3) * scale;
        const oz = z + randomIn(rng, -0.3, 0.3) * scale;
        const lean = [randomIn(rng, -0.2, 0.2) + leanZ, 0, randomIn(rng, -0.2, 0.2) - leanX];
        seaSolid(parts, new THREE.CylinderGeometry(r, r * 1.25, h, 7), color, { pos: [ox, y0 + h / 2, oz], rot: lean });
        seaSolid(parts, new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.05, 7), 0x3a2c26,
          { pos: [ox, y0 + h - 0.04, oz], rot: lean });
      }
    } else if (kind === 'mat') {
      // An encrusting colony: a shallow DOME, not a disc. Built as a flat cylinder it
      // reads as a coloured puddle on the sand rather than as something growing.
      const r = randomIn(rng, 0.5, 1.1) * scale;
      seaSolid(parts, ball(r, 7), color, { pos: [x, y0 + r * 0.1, z], scale: [1, 0.32, 1] });
    } else {
      const fingers = 3 + Math.floor(rng() * 5);
      for (let k = 0; k < fingers; k++) {
        const h = randomIn(rng, 0.5, 1.1) * scale;
        seaSolid(parts, sweep(
          [[0, 0, 0], [randomIn(rng, -0.1, 0.1), h * 0.55, randomIn(rng, -0.1, 0.1)], [randomIn(rng, -0.2, 0.2), h, randomIn(rng, -0.2, 0.2)]],
          [0.14 * scale, 0.11 * scale, 0.07 * scale], 3, 5
        ), color, {
          pos: [x + randomIn(rng, -0.35, 0.35) * scale, y0 + 0.05, z + randomIn(rng, -0.35, 0.35) * scale],
          rot: [leanZ, 0, -leanX],
        });
      }
    }
  }
  return group(mergedMesh(parts, { roughness: 0.82, flatShading: true, ...relief('stone', { seed, repeat: 7, strength: 0.4 }) }));
}

// A big brain coral, as its own specimen.
//
// The maze is a MAP, not geometry -- and a near-white one, so that multiplying it against
// the vertex colour leaves the colony's own hue intact and only darkens the valleys.
// Cutting real grooves into a boulder would multiply its triangle count by twenty for a
// pattern nobody can see the silhouette of anyway.
export function brainCoral({ radius = 2.4, seed = 53, color = REEF.gold } = {}) {
  const rng = seededRandom(seed);
  const geometry = roughenSphere(new THREE.IcosahedronGeometry(radius, 2), { amount: 0.10, flatten: 0.66, phase: 2.2 });
  const maze = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(90,66,40,0.85)';
    ctx.lineCap = 'round';
    // Wandering parallel ridges. Drawn FAT (relative to the 256px sheet) for the reason
    // the Park's flower veins had to be: a 2px line on a colony three feet across lands
    // under one screen pixel and mips away to nothing.
    for (let i = 0; i < 22; i++) {
      ctx.lineWidth = randomIn(rng, 5, 9);
      ctx.beginPath();
      let y = (i / 22) * h + randomIn(rng, -4, 4);
      ctx.moveTo(-10, y);
      for (let x = 0; x <= w + 10; x += 16) {
        y += randomIn(rng, -7, 7);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  maze.wrapS = THREE.RepeatWrapping;
  maze.wrapT = THREE.RepeatWrapping;
  maze.repeat.set(3, 2);
  return group(group(mesh(geometry, standard({
    color, map: maze, bumpMap: maze, bumpScale: 0.6, roughness: 0.9, flatShading: true,
  }), 0, radius * 0.5, 0)));
}

// A gorgonian sea fan: a branching net that grows FLAT, across the current, because it
// feeds by filtering water that passes through it. Which is why one is always broadside to
// the prevailing flow, and why a layout should turn a group of them the same way.
export function seaFan({ width = 5, height = 6, color = REEF.magenta, seed = 59 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const tint = new THREE.Color(color);
  const pale = tint.clone().offsetHSL(0, -0.12, 0.14).getHex();

  // Six levels, and the branches barely thin as they go. A gorgonian is a NET, not a
  // shrub: the first pass ran four levels of rapidly-thinning sticks and came out as a
  // handful of bare dead twigs. Density and even girth are what make it read as a mesh
  // fine enough to strain plankton out of the water, which is what it is for.
  const grow = (x, y, angle, len, r, depth) => {
    if (depth > 5 || len < 0.12) return;
    const x2 = x + Math.sin(angle) * len;
    const y2 = y + Math.cos(angle) * len;
    // A gentle out-of-plane bow, so the fan is a surface and not a decal.
    const z1 = Math.sin(x * 1.3) * 0.16;
    const z2 = Math.sin(x2 * 1.3) * 0.16;
    parts.push({
      geometry: sweep([[x, y, z1], [(x + x2) / 2, (y + y2) / 2, (z1 + z2) / 2], [x2, y2, z2]],
        [r, r * 0.93, r * 0.86], 3, 5),
      color: depth > 3 ? pale : color,
    });
    const spread = randomIn(rng, 0.28, 0.5);
    grow(x2, y2, angle - spread, len * randomIn(rng, 0.70, 0.86), r * 0.86, depth + 1);
    grow(x2, y2, angle + spread, len * randomIn(rng, 0.70, 0.86), r * 0.86, depth + 1);
  };
  grow(0, 0.5, 0, height * 0.26, 0.12, 0);
  // The holdfast: a fan is glued to the rock by a disc, and without one it appears to be
  // balancing on its stem.
  seaSolid(parts, new THREE.CylinderGeometry(0.34, 0.44, 0.24, 8), REEF.rockPink, { pos: [0, 0.11, 0] });
  seaSolid(parts, sweep([[0, 0, 0], [0, 0.3, 0.02], [0, 0.55, 0.03]], [0.14, 0.12, 0.1], 3, 6), color, {});

  const merged = mergeColored(parts);
  // Fitted to the requested envelope after the fact: a recursive shape's final extent is
  // not something the seed lets a caller predict, and a layout asking for a 5ft fan should
  // get one it can place against a 5ft gap.
  merged.computeBoundingBox();
  const size = merged.boundingBox.getSize(new THREE.Vector3());
  merged.scale(width / Math.max(0.1, size.x), height / Math.max(0.1, size.y), 1);
  return group(mesh(merged, standard({ vertexColors: true, roughness: 0.8, flatShading: true, side: THREE.DoubleSide })));
}

// A sea anemone -- the clownfish's house, and the reason those fish are where they are.
//
// The tentacles are the whole prop, and what matters is that there are a LOT of them and
// that they are SLENDER. At sixty, and thick enough to see individually, the crown came out
// as a bunch of orange matchsticks with white beads glued on -- each tentacle read as an
// object rather than the mass reading as an animal. Doubling the count and halving the
// girth costs about the same triangles and is the entire difference.
export function seaAnemone({ radius = 2.6, tentacles = 130, color = REEF.orange, tip = 0xf0d8c0, seed = 61 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const column = new THREE.Color(color).offsetHSL(0.01, -0.2, -0.12).getHex();
  // The tips are a pale peach rather than white. Pure white beads on 130 tentacles are the
  // brightest thing in the frame and the eye reads the crown as the beads, not as tentacles.
  const tipTone = new THREE.Color(tip).lerp(new THREE.Color(color), 0.34).getHex();

  // The column, mostly hidden under the crown. An anemone sits wedged in a crevice with
  // only its disc showing, so this is deliberately short and narrow -- built tall enough to
  // see properly it reads as a plant pot with the anemone standing in it.
  seaSolid(parts, new THREE.CylinderGeometry(radius * 0.42, radius * 0.56, radius * 0.34, 12), column,
    { pos: [0, radius * 0.17, 0] });
  seaSolid(parts, ball(radius * 0.52, 12), color, { pos: [0, radius * 0.42, 0], scale: [1, 0.55, 1] });

  for (let i = 0; i < tentacles; i++) {
    // Golden-angle placement over the disc, so they never fall into visible rings.
    const a = i * 2.399963229728653;
    const d = Math.sqrt((i + 0.5) / tentacles) * radius * 0.62;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const lean = (d / (radius * 0.62)) * randomIn(rng, 0.5, 1.1);
    // A very wide length range, and a sideways drift that grows along each tentacle.
    //
    // Both exist because of the same failure: at a narrow length range, radiating dead
    // straight, 130 tentacles put every white tip on one smooth dome and the animal read as
    // a scrubbing brush. What a real anemone does is wave -- the tips are at every height
    // and every angle at once, and no two neighbours agree. Breaking up the tip surface is
    // the whole trick; the tentacles themselves barely matter.
    const len = radius * randomIn(rng, 0.34, 1.15);
    const dirX = d > 0.01 ? x / d : 0;
    const dirZ = d > 0.01 ? z / d : 1;
    const drift = randomIn(rng, -0.55, 0.55);
    const curl = randomIn(rng, -0.3, 0.55);
    const r0 = radius * randomIn(rng, 0.020, 0.030);
    const base = radius * 0.55;
    const along = (t) => [
      x + dirX * len * lean * t * 0.95 - dirZ * drift * len * t * t,
      base + len * (t * 1.05 - curl * t * t),
      z + dirZ * len * lean * t * 0.95 + dirX * drift * len * t * t,
    ];
    const pts = [[x, base, z], along(0.5), along(0.8), along(1)];
    parts.push({ geometry: sweep(pts, [r0, r0 * 0.92, r0 * 0.78, r0 * 0.52], 4, 5), color });
    // Pale swollen tips. On a real anemone those are the stinging batteries, and they are
    // the single feature that stops the crown reading as a sea urchin.
    // Detail SIX, not the four this had. Four width segments is a square cross-section, so
    // at arm's length every one of the 130 tips read as a small pale CUBE stuck on a stick
    // -- the one place in this file where the sphere-coarseness saving went too far. Six is
    // still only two dozen triangles and it is unmistakably a bead.
    seaSolid(parts, ball(r0 * 1.3, 6), tipTone, { pos: pts[3] });
  }
  return group(mergedMesh(parts, { roughness: 0.62, flatShading: true }));
}

// A cluster of barrel and tube sponges, standing proud of the reef.
export function tubeSponge({ count = 4, height = 3, color = REEF.orange, seed = 67 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const h = height * randomIn(rng, 0.6, 1.15);
    const r = h * randomIn(rng, 0.16, 0.3);
    const a = rng() * Math.PI * 2;
    const d = randomIn(rng, 0, height * 0.4);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const lean = [randomIn(rng, -0.16, 0.16), 0, randomIn(rng, -0.16, 0.16)];
    const tint = new THREE.Color(color).offsetHSL(randomIn(rng, -0.02, 0.02), 0, randomIn(rng, -0.08, 0.08)).getHex();
    seaSolid(parts, new THREE.CylinderGeometry(r, r * 1.3, h, 10), tint, { pos: [x, h / 2, z], rot: lean });
    seaSolid(parts, new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.08, 10), 0x35271f, { pos: [x, h - 0.05, z], rot: lean });
  }
  return group(mergedMesh(parts, { roughness: 0.92, flatShading: true, ...relief('soil', { seed, repeat: 5, strength: 0.55 }) }));
}

// A giant clam, wedged into the reef with its mantle out.
//
// The MANTLE is the animal: an iridescent blue-green frill between the shells, packed with
// the algae the clam farms for food. The shell is just the box it lives in, and building
// only the shell gives you a rock.
export function giantClam({ size = 2.6, seed = 71, mantle = 0x2fa0a8 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const shell = 0xcdbfa2;
  const shellDark = 0xa2947a;
  const gape = 0.52;

  for (const half of [-1, 1]) {
    const g = new THREE.SphereGeometry(size * 0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    seaSolid(parts, g, half > 0 ? shell : shellDark, {
      pos: [0, size * 0.32, 0], rot: [half > 0 ? gape : Math.PI - gape, 0, 0], scale: [1, 0.62, 1.15],
    });
    // The fluted rim -- a clam's edge is a deep zigzag, and it is most of the silhouette.
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.2;
      seaSolid(parts, ball(size * 0.09, 5), half > 0 ? shell : shellDark, {
        pos: [Math.sin(a) * size * 0.48, size * 0.32 + half * size * 0.16, Math.cos(a) * size * 0.5],
        scale: [1, 0.7, 0.6],
      });
    }
  }
  // The mantle: a wavy frill filling the gap, tinted along its length so it shifts colour
  // the way the real thing does.
  //
  // It sits PROUD of the shell rim, not down between the halves. Tucked inside -- which is
  // where it goes if you build it from the shell's own centre -- the clam reads as a plain
  // white boulder with a couple of coloured flecks on it, and the one feature that makes
  // this animal worth a placard is invisible from standing height.
  const tint = new THREE.Color(mantle);
  for (let i = 0; i < 15; i++) {
    const a = (i / 14 - 0.5) * 2.5;
    const c = tint.clone().offsetHSL(randomIn(rng, -0.07, 0.07), randomIn(rng, -0.12, 0.1), randomIn(rng, -0.14, 0.14));
    seaSolid(parts, ball(size * 0.17, 7), c.getHex(), {
      pos: [Math.sin(a) * size * 0.40, size * 0.46 + Math.sin(i * 1.9) * size * 0.08, Math.cos(a) * size * 0.42],
      rot: [0, -a, 0],
      scale: [1.1, 0.8, 0.5],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.55, flatShading: true, ...relief('stone', { seed, repeat: 4, strength: 0.45 }) }));
}

// A long-spined sea urchin. Spines are oriented by quaternion from the body's own surface
// normal, which is the same trick the octopus's suckers use.
export function seaUrchin({ radius = 0.65, spines = 52, seed = 73, color = 0x2b2230 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  seaSolid(parts, ball(radius, 10), color, { pos: [0, radius * 0.85, 0], scale: [1, 0.78, 1] });
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spines; i++) {
    // Uniform over the sphere: sampling cos(phi) avoids the dense clump at the pole that
    // naive uniform-angle sampling gives.
    const theta = rng() * Math.PI * 2;
    const y = rng() * 1.7 - 0.5;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
    const len = radius * randomIn(rng, 1.5, 2.9);
    const g = new THREE.ConeGeometry(radius * 0.055, len, 4);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(dir.x * radius * 0.8, radius * 0.85 + dir.y * radius * 0.7, dir.z * radius * 0.8),
      q, new THREE.Vector3(1, 1, 1)
    ));
    parts.push({ geometry: g, color: rng() < 0.25 ? 0x50435c : color });
  }
  return group(mergedMesh(parts, { roughness: 0.45, flatShading: true }));
}

// A sea cucumber, lying on the sand doing what it does: eating the sand.
export function seaCucumber({ length = 2.4, seed = 79, color = 0x7a5636 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const r = length * 0.16;
  const pts = [];
  const radii = [];
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    pts.push([Math.sin(t * 2.4) * length * 0.08, r * 0.9, (t - 0.5) * length]);
    radii.push(r * (0.55 + Math.sin(t * Math.PI) * 0.55));
  }
  seaSolid(parts, sweep(pts, radii, 12, 9), color, { scale: [1, 0.72, 1], about: [0, r * 0.9, 0] });
  // Papillae -- the soft spikes down its back, which is the whole difference between a
  // sea cucumber and a sausage.
  const pale = new THREE.Color(color).offsetHSL(0.02, -0.14, 0.18).getHex();
  for (let i = 0; i < 26; i++) {
    const t = randomIn(rng, 0.06, 0.94);
    const across = randomIn(rng, -0.7, 0.7);
    const rr = r * (0.55 + Math.sin(t * Math.PI) * 0.55);
    seaSolid(parts, new THREE.ConeGeometry(r * 0.13, r * randomIn(rng, 0.4, 0.75), 5), pale, {
      pos: [Math.sin(t * 2.4) * length * 0.08 + across * rr, r * 0.9 + rr * 0.62, (t - 0.5) * length],
      rot: [randomIn(rng, -0.3, 0.3), 0, across * 0.9],
    });
  }
  return group(mergedMesh(parts, {
    roughness: 0.85, flatShading: true,
    map: mottleTexture(seed, { spots: 60, min: 0.03, max: 0.07, floor: 0.5, repeat: [5, 2] }),
  }));
}

// Seagrass or a stand of kelp, depending on `height`. Blades are flattened sweeps that
// lean off a common bearing, so a bed reads as bending in one current rather than as
// grass on a lawn.
export function seagrassPatch({ radius = 5, count = 60, height = 2.2, seed = 83, color = 0x4e7a3c, drift = 0.5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bearing = randomIn(rng, 0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = height * randomIn(rng, 0.6, 1.4);
    const sway = drift * randomIn(rng, 0.6, 1.4);
    const bx = Math.sin(bearing) * sway * h;
    const bz = Math.cos(bearing) * sway * h;
    const tint = new THREE.Color(color).offsetHSL(randomIn(rng, -0.03, 0.03), randomIn(rng, -0.1, 0.1), randomIn(rng, -0.12, 0.12)).getHex();
    const g = sweep(
      [[x, 0, z], [x + bx * 0.2, h * 0.45, z + bz * 0.2], [x + bx * 0.6, h * 0.8, z + bz * 0.6], [x + bx, h, z + bz]],
      [h * 0.055, h * 0.05, h * 0.038, h * 0.012], 4, 4
    );
    seaSolid(parts, g, tint, { scale: [1, 1, 0.28], about: [x, 0, z], rot: [0, rng() * Math.PI, 0] });
  }
  return group(mergedMesh(parts, { roughness: 0.8, flatShading: true, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

// Species presets. `bands` are z positions in the fish's own unit-length frame.
const FISH = {
  clownfish: { body: 0xe2661d, belly: 0xea9152, fin: 0xdc5a18, trim: 0x17120f, band: 0xf4efe2,
    bands: [0.30, 0.00, -0.28], tail: 'fan', deep: 1.15 },
  tang: { body: 0x2b5cc0, belly: 0x3d72d4, fin: 0x2b5cc0, trim: 0x0e1a33, tailColor: 0xe8c53a,
    bands: [], tail: 'fork', deep: 1.35 },
  anthias: { body: 0xe2685f, belly: 0xf0a892, fin: 0xd8a03c, trim: 0xba4038, bands: [], tail: 'fork', deep: 1.1 },
  yellow: { body: 0xe6bd2b, belly: 0xf2d762, fin: 0xe6bd2b, trim: 0xa8830f, bands: [], tail: 'fan', deep: 1.4 },
  damsel: { body: 0x2ea6c6, belly: 0x63cbdd, fin: 0x2ea6c6, trim: 0x155f78, bands: [], tail: 'fork', deep: 1.15 },
  butterfly: { body: 0xf0e2ae, belly: 0xf8f1d8, fin: 0xe8c53a, trim: 0x2a2520,
    bands: [0.34, -0.12], band: 0x2a2520, tail: 'fan', deep: 1.5 },
};

// The body radius at a point along the fish, so a band can be sized to hug it. Kept as one
// function because the sweep's control points and the bands have to agree exactly -- a
// band sized off the nearest control point rather than the interpolated radius hangs off
// the body like a loose bangle, which is the mistake the stomach's rugae made.
const FISH_SPINE = [
  [-0.42, 0.030], [-0.28, 0.075], [-0.10, 0.145], [0.08, 0.175], [0.24, 0.155], [0.38, 0.095], [0.48, 0.030],
];
function fishRadiusAt(z) {
  for (let i = 0; i < FISH_SPINE.length - 1; i++) {
    const [z0, r0] = FISH_SPINE[i];
    const [z1, r1] = FISH_SPINE[i + 1];
    if (z >= z0 && z <= z1) return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0);
  }
  return 0.03;
}

// One fish, authored at unit length and placed by `base`.
//
// Everything is squashed laterally about the body axis: a reef fish is a plate, and a
// swept tube is as deep as it is wide, which is the same trap the 1940's New York statues
// hit. Left round, every one of these is a sausage.
function fishParts(list, species, { base = null, seed = 1 } = {}) {
  const f = FISH[species] ?? FISH.clownfish;
  const rng = seededRandom(seed);
  const squash = { scale: [0.5, f.deep, 1], about: [0, 0, 0] };

  const body = sweep(FISH_SPINE.map(([z]) => [0, 0, z]), FISH_SPINE.map(([, r]) => r), 10, 8);
  seaSolid(list, body, f.body, squash, base);
  // A pale belly, for the same reason the shark has one: countershading is most of what
  // makes a fish read as three-dimensional under a single overhead sun.
  seaSolid(list, sweep(
    [[0, -0.06, -0.24], [0, -0.09, -0.04], [0, -0.09, 0.16], [0, -0.07, 0.32]],
    [0.05, 0.085, 0.08, 0.05], 5, 6
  ), f.belly, { scale: [0.42, 0.7, 1], about: [0, -0.08, 0] }, base);

  for (const z of f.bands) {
    const r = fishRadiusAt(z);
    // The white bar, with a dark edge either side -- which is what a clownfish's bands
    // actually are, and painting the white alone loses most of the contrast.
    seaSolid(list, ball(1, 8), f.band ?? 0xf4efe2, { pos: [0, 0, z], scale: [r * 0.53, r * f.deep * 1.06, 0.045] }, base);
    for (const edge of [-1, 1]) {
      seaSolid(list, ball(1, 7), f.trim, { pos: [0, 0, z + edge * 0.052], scale: [r * 0.52, r * f.deep * 1.05, 0.016] }, base);
    }
  }

  const tail = f.tail === 'fork'
    ? [[0.02, 0.0], [-0.14, 0.20], [-0.26, 0.26], [-0.18, 0.06], [-0.18, -0.06], [-0.26, -0.26], [-0.14, -0.20]]
    : [[0.02, 0.0], [-0.13, 0.19], [-0.24, 0.15], [-0.24, -0.15], [-0.13, -0.19]];
  seaSolid(list, finBlade(tail, 0.02), f.tailColor ?? f.fin, { pos: [0, 0, -0.42] }, base);
  seaSolid(list, finBlade([[0.20, 0], [0.04, 0.13], [-0.16, 0.10], [-0.24, 0.0]], 0.018), f.fin,
    { pos: [0, 0.15, 0.02] }, base);
  seaSolid(list, finBlade([[0.14, 0], [0.0, -0.11], [-0.14, -0.08], [-0.20, 0.0]], 0.018), f.fin,
    { pos: [0, -0.13, -0.06] }, base);
  for (const side of [-1, 1]) {
    seaSolid(list, finBlade([[0.07, 0], [-0.01, 0.12], [-0.11, 0.09], [-0.13, 0]], 0.016, { flat: true }), f.fin,
      { pos: [side * 0.07, -0.01, 0.16], rot: [0, side * 0.3, side * -0.5], scale: [side, 1, 1] }, base);
    seaSolid(list, ball(0.036, 5), 0xf2ede0, { pos: [side * 0.062, 0.045, 0.345] }, base);
    seaSolid(list, ball(0.024, 4), f.trim, { pos: [side * 0.076, 0.045, 0.352] }, base);
  }
  // A faintly ragged trailing edge -- a couple of extra soft-tissue lumps so a whole shoal
  // is not literally identical fish.
  if (rng() < 0.5) seaSolid(list, ball(0.03, 5), f.fin, { pos: [0, 0.17, -0.22], scale: [0.4, 1, 1.6] }, base);
}

// One placement matrix for a fish, given its position and the bearing it is swimming on.
function fishAt(x, y, z, yaw, pitch, size) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
    new THREE.Vector3(size, size, size)
  );
}

// A shoal, merged into ONE mesh however many fish are in it.
//
// The mesh is what makes this affordable: a reef needs fish everywhere, and eleven fish at
// three draw calls apiece would cost more than the shark, the octopus and the eel put
// together. `length` is the real length of one fish in feet.
//
// The origin sits at the BOTTOM of the shoal's cloud, so a layout's `y` reads as "clear
// water underneath" rather than as "centre height", which is what a person means when they
// say the fish are eight feet up.
export function reefFishSchool({
  species = 'tang', count = 9, length = 0.9, radius = 4, rise = 3.5, seed = 89, heading = 0, scatter = 0.5,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    // Fish in a shoal point roughly the same way, and the small spread is what stops it
    // reading as a rack of identical models: a perfectly aligned school looks stamped,
    // and a randomly aligned one looks like a fish tank after a fight.
    const yaw = heading + randomIn(rng, -scatter, scatter);
    const pitch = randomIn(rng, -0.22, 0.22);
    const size = length * randomIn(rng, 0.82, 1.18);
    fishParts(parts, species, {
      base: fishAt(Math.sin(a) * d, rng() * rise + length * 0.6, Math.cos(a) * d, yaw, pitch, size),
      seed: seed + i * 7,
    });
  }
  return group(mergedMesh(parts, { roughness: 0.35, flatShading: true, side: THREE.DoubleSide }));
}

// Clownfish, which is a different placement problem from a shoal: they never leave their
// anemone, so they hang in a tight ball around one spot at anemone height, most of them
// facing inward toward it.
export function clownfishSchool({ count = 7, radius = 2.4, height = 2.2, seed = 97, length = 0.62 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + randomIn(rng, -0.4, 0.4);
    const d = radius * randomIn(rng, 0.45, 1.0);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    // Facing roughly inward and downward, the way they hover over the tentacles.
    const yaw = Math.atan2(-x, -z) + randomIn(rng, -0.7, 0.7);
    fishParts(parts, 'clownfish', {
      base: fishAt(x, height * randomIn(rng, 0.55, 1.35), z, yaw, randomIn(rng, -0.4, 0.15),
        length * randomIn(rng, 0.78, 1.2)),
      seed: seed + i * 5,
    });
  }
  return group(mergedMesh(parts, { roughness: 0.35, flatShading: true, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------------------
// Being under water
// ---------------------------------------------------------------------------
//
// The four props below carry no information and teach nothing. They are here because
// without them this world is a blue field with fish standing in it: what makes water read
// as WATER is that it is a volume with a lid, that light arrives through that lid in
// visible beams, that things drift in it, and that bubbles go up. Every one of them is
// built to cost almost nothing, because none of them is what a student came to look at.

// The surface, seen from below -- the ceiling of the world.
//
// DELIBERATELY OPAQUE, and that is the interesting decision. The instinct is to make water
// translucent, but from beneath, a wind-rippled surface is a mirror: it reflects the reef
// back down and you cannot see through it except at the very steepest angles. An opaque
// plane is therefore both more accurate AND free, where a transparent one at this size
// would be the single most expensive object in the app.
//
// castShadow is off, or the sun would be sealed out of the entire world. That is the same
// trap the museum's skylight and the library's lantern roof each hit.
export function waterSurface({ size = 360, height = 46, seed = 101, tint = 0x2f8fbe } = {}) {
  const caustics = canvasTexture(512, 512, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    const data = image.data;
    const base = new THREE.Color(tint);
    const lit = new THREE.Color(0xc6e9f8);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Interference of a few wave trains. Every frequency is an INTEGER multiple of
        // 2*PI/size, which is what makes the sheet tile -- a caustic pattern with a visible
        // seam in it draws a straight line across the sky.
        const u = (x / w) * Math.PI * 2;
        const v = (y / h) * Math.PI * 2;
        //
        // Three wave trains combined with MIN, not a weighted sum. The sum gives parallel
        // bands -- the surface came out looking combed -- because the strongest train
        // dominates everywhere. Taking the minimum lights a pixel wherever ANY train is at
        // a node, so the three families of bright lines overlap into the closed cellular
        // web that a real caustic pattern is.
        const a = Math.abs(Math.sin(u * 3 + Math.sin(v * 2) * 1.7));
        const b = Math.abs(Math.sin(v * 3 + Math.sin(u * 2) * 1.7));
        const c = Math.abs(Math.sin((u + v) * 2 + Math.sin((u - v) * 2) * 1.3));
        const ridge = Math.min(a, Math.min(b, c));
        const light = Math.pow(Math.max(0, 1 - ridge), 4.2);
        const i = (y * w + x) * 4;
        data[i] = Math.round((base.r + (lit.r - base.r) * light) * 255);
        data[i + 1] = Math.round((base.g + (lit.g - base.g) * light) * 255);
        data[i + 2] = Math.round((base.b + (lit.b - base.b) * light) * 255);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  caustics.wrapS = THREE.RepeatWrapping;
  caustics.wrapT = THREE.RepeatWrapping;
  // A 360ft sheet at repeat 7 puts the caustic cells about seventeen feet across, which
  // from the sea floor reads as a giant white net stretched over the sky rather than as
  // dancing light. Real cells at this depth are a few feet, so the tile has to be small.
  caustics.repeat.set(18, 18);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    standard({
      map: caustics,
      roughness: 0.42,
      // Self-lit, because the sun is on the far side of it. Without this the ceiling is
      // the one surface in the world the light never reaches, and it renders as a slab of
      // dark grey exactly where the brightest thing in the scene belongs.
      emissive: new THREE.Color(0xffffff),
      emissiveMap: caustics,
      emissiveIntensity: 0.34,
      side: THREE.FrontSide,
    })
  );
  plane.rotation.x = Math.PI / 2; // face DOWN -- a PlaneGeometry looks along its own +Z
  plane.position.y = height;
  plane.castShadow = false;
  plane.receiveShadow = false;
  return group(plane);
}

// Sunbeams coming down through the surface.
//
// AdditiveBlending with `fog: false`, and both halves of that are deliberate. Additive is
// how light reads -- a beam brightens what is behind it rather than tinting it. And fog
// has to be off because three.js fogs a fragment BEFORE it is blended, so a fully-fogged
// additive fragment adds the fog colour on top of a background that is already the fog
// colour, and the far end of every shaft turns into a bright blue wall.
//
// The whole set merges into ONE transparent draw call. Twelve separately-placed shafts at
// two quads each would be the largest block of transparency in the app.
export function lightShafts({ count = 4, height = 44, spread = 22, width = 9, tilt = 0.36, seed = 103, opacity = 0.2 } = {}) {
  const rng = seededRandom(seed);
  const beam = canvasTexture(64, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    // Brightest at the top where it enters the water, gone before it reaches the sand --
    // which is what absorption actually does, and it also means the shafts never have to
    // resolve against the sea floor.
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.14, 'rgba(216,244,255,0.72)');
    grad.addColorStop(0.55, 'rgba(180,226,250,0.30)');
    grad.addColorStop(1, 'rgba(150,205,240,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Soft edges across the beam as well. A hard-edged additive quad reads as a pane of
    // glass standing in the water -- the same lesson as the Mars dust devil's streaks.
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, h);
  });

  // EVERY SHAFT LEANS THE SAME WAY, and it is worth saying why, because the first version
  // gave each one its own bearing and the result was unmistakably a laser show. Sunbeams
  // are PARALLEL -- they all come from the same sun -- and the only reason they appear to
  // fan out is perspective. Randomising the lean throws that away and the eye reads them
  // as independent objects rather than as light.
  //
  // The lean matches this theme's sun at [45, 175, 60]: the horizontal run is 75ft over a
  // 175ft drop, so the top of each shaft is offset toward (0.6, 0.8) in x/z.
  const t = Math.tan(tilt);
  const axis = new THREE.Vector3(0.6 * t, 1, 0.8 * t).normalize();
  const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);

  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * spread;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = height * randomIn(rng, 0.85, 1.1);
    // WIDE. A shaft narrower than it is tall by more than about ten to one stops being a
    // beam of light and becomes a rod of glass falling through the water.
    const w = width * randomIn(rng, 0.7, 1.45);
    // Two crossed quads per shaft, so a beam still reads when a student walks round it.
    // One quad alone vanishes edge-on, which on a moving camera looks like flickering.
    for (const turn of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      g.rotateY(a + turn);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), lean, new THREE.Vector3(1, 1, 1)));
      parts.push({ geometry: g, color: 0xffffff });
    }
  }

  const shafts = new THREE.Mesh(mergeColored(parts), new THREE.MeshBasicMaterial({
    map: beam,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    fog: false,
  }));
  shafts.castShadow = false;
  shafts.receiveShadow = false;
  shafts.renderOrder = 2;
  return group(shafts);
}

// A stream of bubbles rising off the reef -- from a crevice, or from something breathing.
// All of them in one translucent mesh, for the reason at the top of this section.
export function bubbleColumn({ height = 14, count = 28, radius = 1.1, seed = 107 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // Bubbles GROW as they rise -- the water pressure squeezing them drops the whole way
    // up -- and they spread out as they go. Both are free here and both are what makes a
    // column read as rising rather than as a string of beads.
    const r = 0.045 + t * 0.11 + rng() * 0.05;
    const a = rng() * Math.PI * 2;
    const d = radius * t * randomIn(rng, 0.3, 1.2);
    seaSolid(parts, ball(r, 6), 0xdff2fb, {
      pos: [Math.sin(a) * d, 0.3 + t * height + randomIn(rng, -0.4, 0.4), Math.cos(a) * d],
    });
  }
  const bubbles = mergedMesh(parts, {
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    emissive: new THREE.Color(0x9fd8ee),
    emissiveIntensity: 0.35,
  });
  bubbles.castShadow = false;
  return group(bubbles);
}

// Marine snow: the drifting flecks of organic debris that fill any real photograph taken
// under water, and the cheapest immersion in this file by a wide margin.
//
// A THREE.Points cloud, which is ONE draw call for the whole volume. It is also the only
// thing in the app that renders as points rather than triangles, and it needs to be: a
// fleck a couple of inches across is smaller than a triangle is worth.
export function marineSnow({ radius = 46, height = 30, count = 420, seed = 109 } = {}) {
  const rng = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    positions[i * 3] = Math.sin(a) * d;
    positions[i * 3 + 1] = rng() * height + 0.5;
    positions[i * 3 + 2] = Math.cos(a) * d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const snow = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xdfe8e2,
    // sizeAttenuation ON, unlike the starfield's: those are meant to be infinitely far
    // away and these are a few feet from the player's face, so they have to grow as you
    // approach one or the whole cloud reads as dirt on the screen.
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    // Faint on purpose. Marine snow only works subliminally: turned up far enough to
    // actually notice, a cloud of white specks overhead stops reading as debris in the
    // water and starts reading as a starfield, which is the one thing this sky must not be.
    opacity: 0.4,
    depthWrite: false,
    fog: true,
  }));
  return group(snow);
}
