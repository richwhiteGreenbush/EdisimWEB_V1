import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  mergeColored,
  canvasTexture,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  roughenSphere,
  relief,
} from '../PropKit.js';
import { moonRocks } from './MoonProps.js';
import { dustDevil } from './MarsProps.js';

// "Dinosaur Island" -- the very end of the Cretaceous, about 66 million years ago, on
// the kind of warm coastal floodplain the Hell Creek fossil beds record. Everything
// alive here really did share that time and place with Tyrannosaurus, which is the
// quiet lesson underneath the spectacle: the famous dinosaurs of the toy box mostly
// did NOT live together. Stegosaurus was longer dead by then than T. rex is from us.
//
// Sizes are real against the 5ft student. T. rex stands 13ft at the hip and runs 40ft
// nose to tail; Triceratops is 10ft at the shoulder; a Pachycephalosaurus is only
// about head-and-shoulders taller than the student looking at it.

const BONE = 0xe4dcc2;
const TOOTH = 0xf0e9d6;
const EYE = 0x171512;
const CLAW = 0x33302a;

// ---------------------------------------------------------------------------
// Body-building helpers
// ---------------------------------------------------------------------------

// HOW SMOOTH EVERYTHING IS, in one place.
//
// These are the numbers the world was rebuilt around. The animals used to run 2.7k-12.8k
// triangles each -- 34k for all six, which was 8% of this world's geometry while being
// essentially all of its point. Against the i5/i7 target (see CLAUDE.md: ~1.5M triangles,
// under ~1000 draw calls) that was leaving almost everything on the table, and the cost of
// it was visible: faceted flanks, polygonal silhouettes on a 40ft animal, and a hide that
// read as folded paper.
//
// RADIAL SEGMENTS ARE ALSO THE GAP FIX, which is why they lead. A swept tube's rendered
// surface is inset from its nominal radius by cos(PI/n) at the flats -- 2.5% at 14 sides,
// 1.2% at 20, 0.8% at 24. Where a limb plugs into a torso BOTH surfaces retreat by that
// much and, because two tubes' Frenet frames are unrelated, their flats meet at arbitrary
// angles: the worst case is a genuine V-notch you can see daylight through. Every extra
// side closes it further.
// TUNED DOWN from a first pass at 34/22 and 44/26 after measuring. That pass put the world at
// 2.2M triangles a frame against an envelope of about 1.5M, and the honest reading of where it
// went is that tessellation is not what makes these animals better -- the anatomy is. A 30-side
// tube and a 22-side tube are indistinguishable at the ten feet a student stands at, while the
// drumstick thigh, the socketed knee and the gum line are visible from across the clearing. So
// the geometry saved here went into parts, not into sides.
// THE KEY NAMES MATTER: taperedTube takes `tubularSegments` / `radialSegments`, and an earlier
// version of these constants spelled them `tubular` / `radial`. They spread into the options
// object cleanly, three.js ignored them, and every tube in the world quietly fell back to
// taperedTube's own defaults -- so the counts here did nothing at all, and tuning them did
// nothing either. Nothing errors, nothing warns; the only symptom is that the numbers below are
// fiction. Worth remembering for any options object that is spread rather than passed.
//
// RADIAL is the one to spend on and TUBULAR is the one to save on. Radial sides are what close
// the notch where two tubes meet (the inset at the flats is cos(PI/n): 2.5% at 14 sides, 1.2% at
// 20) and they are what stops a limb reading as a prism. Tubular segments only subdivide along
// the length, where a swept tube is already smooth.
const SEG = { tubularSegments: 24, radialSegments: 18 };
const SEG_FINE = { tubularSegments: 30, radialSegments: 20 }; // torsos, necks, skulls
const SEG_SMALL = { tubularSegments: 10, radialSegments: 10 }; // toes, fingers, tooth roots

// One tapered limb/neck/tail/torso segment, ready for mergeColored(). `s` scales the
// whole thing about the animal's origin, which is how a builder offers a size option
// without ever touching Object3D.scale -- WorldStore.applyTransform() REPLACES an
// object's scale from the record, so a builder that scaled its own Group would have
// that silently thrown away on the next reload.
function tube(points, radii, color, s = 1, options) {
  return {
    geometry: taperedTube(
      points.map(([x, y, z]) => [x * s, y * s, z * s]),
      radii.map((r) => r * s),
      { ...SEG, ...options }
    ),
    color,
  };
}

// A CHAIN of tubes with a socket ball at every interior joint and a cap at each open end.
//
// This exists so that an unclosed junction is not something a builder has to remember. Every
// visible hole in this world's first pass was one of three things -- two tubes crossing at a
// joint, a tube stopping in mid-air, or a cone sitting on a curved surface -- and all three
// are avoidable by construction rather than by care. `limb()` takes the nodes of a limb
// (point + radius each) and emits:
//
//   * a tube between every consecutive pair,
//   * a sphere at every INTERIOR node, sized from the fatter of the two tubes that meet
//     there and 8% larger again, which is what swallows both open rings rather than merely
//     landing its own silhouette on theirs,
//   * a sphere at each END node unless the caller says that end tapers to nothing.
//
// The end caps are the half of this that is easy to argue with and should not be: a tube
// closes itself only if its last radius is 0, and a radius of 0 turns the final segment into
// a cone -- right for a tail tip or a frond, wrong for a cut neck, a jaw, a wing finger or a
// toe, where it reads as a blade stuck through the flesh. Anything ending at a real thickness
// gets a ball.
function limb(color, s, nodes, { capStart = true, capEnd = true, options } = {}) {
  const parts = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    // Three control points per segment rather than two: a two-point Catmull-Rom is a
    // straight line, and its radius then interpolates linearly, which loses the swell a real
    // limb has along its length.
    const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    parts.push(tube([a.p, mid, b.p], [a.r, (a.r + b.r) / 2, b.r], color, s, options));
  }
  // Socket size is DERIVED FROM THE BEND, not from the fattest radius nearby, and that
  // correction is worth more than it sounds. Both tubes already have exactly this node's
  // radius here, so all the ball has to swallow is the flats' inset plus the wedge the two
  // end planes leave open on the outside of the bend -- which for an angle phi is a factor of
  // 1/cos(phi/2). Sizing it from the neighbouring radii instead (the first pass) put a
  // 2.4ft ball on a 1.5ft joint and every limb in the world read as a stack of balloons.
  //
  // A straight joint therefore gets 1.02 -- invisible -- and a right-angled knee gets 1.44,
  // which is a knee, and is where the animal has a bulge anyway.
  for (let i = 1; i < nodes.length - 1; i++) {
    const a = nodes[i - 1].p;
    const b = nodes[i].p;
    const c = nodes[i + 1].p;
    const u = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    const v = new THREE.Vector3(c[0] - b[0], c[1] - b[1], c[2] - b[2]).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    parts.push(ball(nodes[i].r * 1.02 / Math.max(0.62, Math.cos(phi / 2)), color, nodes[i].p, s));
  }
  if (capStart && nodes[0].r > 0) parts.push(ball(nodes[0].r * 1.02, color, nodes[0].p, s));
  const last = nodes[nodes.length - 1];
  if (capEnd && last.r > 0) parts.push(ball(last.r * 1.02, color, last.p, s));
  return parts;
}

// Scales a geometry about a chosen point rather than the world origin. Scaling a skull
// in place needs this: a plain geometry.scale() also multiplies its position, so a head
// 14ft up the animal quietly relocates to 17ft when you make it 20% deeper.
function scaleAbout(geometry, [cx, cy, cz], [sx, sy, sz]) {
  geometry.translate(-cx, -cy, -cz);
  geometry.scale(sx, sy, sz);
  geometry.translate(cx, cy, cz);
  return geometry;
}

function blob(radius, color, [x, y, z], s = 1, detail = 16) {
  return {
    geometry: new THREE.SphereGeometry(radius * s, detail, Math.max(8, detail >> 1)),
    position: [x * s, y * s, z * s],
    color,
  };
}

// A round mass. Same thing as blob() and named for what it is at a joint, so a limb reads
// as a chain of bones and balls in the source the way it does in the animal.
function ball(radius, color, position, s = 1, detail = 18) {
  return blob(radius, color, position, s, detail);
}

// A joint mass at a limb root -- hip, shoulder, elbow.
//
// Two tubes meeting at an angle CANNOT close cleanly on their own: each one ends in an
// open ring lying in its own plane, so wherever those planes disagree the surfaces cross
// and leave a notch. Every real solution is the same one -- put a ball in the socket.
// A sphere big enough to swallow both ring ends hides the crossing completely, costs
// a few hundred triangles inside a mesh that is already merged to one draw call, and is
// where the animal actually has a bulge anyway.
//
// Deliberately a touch larger than the thicker of the two tubes: sized to match, its own
// silhouette lands exactly on theirs and the seam simply moves rather than disappearing.
// Prefer limb(), which places these for you at every node of a chain.
function joint(radius, color, position, s = 1) {
  return blob(radius, color, position, s, 20);
}

// A cone standing on the surface it is attached to: teeth, horns, spikes, claws.
//
// ROOTED BY DEFAULT, and that is a gap fix. A cone's base is a flat disc, so a cone stuck
// on anything curved leaves a crescent of daylight along one side of that disc wherever the
// surface falls away faster than the rim does -- which on a jaw, a frill rim or a knobbed
// skull is everywhere. A small ball at the base, three quarters of the cone's own base
// radius, sits inside the parent surface and closes it. It costs ~100 triangles and it is
// the difference between teeth growing out of a gum and teeth balanced on one.
function spike(length, radius, color, [x, y, z], rotation, s = 1, { rooted = true, sides = 12 } = {}) {
  const parts = [{
    geometry: new THREE.ConeGeometry(radius * s, length * s, sides),
    rotation,
    position: [x * s, y * s, z * s],
    color,
  }];
  if (rooted) {
    // Pushed back down the cone's own axis by a third of its length, so the ball straddles
    // the base disc instead of sitting on top of it. rotation is applied before position by
    // mergeColored, so the axis has to be derived the same way.
    const e = new THREE.Euler(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    const axis = new THREE.Vector3(0, 1, 0).applyEuler(e).multiplyScalar(-length * 0.3);
    parts.push(blob(radius * 0.8, color, [x + axis.x, y + axis.y, z + axis.z], s, 12));
  }
  return parts;
}

// A curved horn or claw -- a swept tube that tapers to a point, which a cone cannot do
// because a real horn BENDS. Ends at radius 0 on purpose: a point is what a horn has, and
// it is the one place limb()'s end cap must not apply.
function horn(nodes, color, s = 1) {
  return [
    tube(nodes.map((n) => n.p), nodes.map((n) => n.r), color, s, { tubularSegments: 18, radialSegments: 16 }),
    // The base still gets a ball: the wide end of a horn is an open ring sitting in a skull.
    ball(nodes[0].r * 1.05, color, nodes[0].p, s, 14),
  ];
}

// Every animal is ONE merged, vertex-coloured mesh, SMOOTH-shaded, with its colour varied
// per vertex by where that vertex is on the body.
//
// THREE CHANGES FROM THE FIRST PASS, and they only work together:
//
// 1. SMOOTH SHADING, not flat. Flat shading was doing a real job before -- it read as
//    faceted hide and, more importantly, it hid the seams where a dozen separately-swept
//    tubes intersect. But it also capped how good these could look: it is the low-poly
//    aesthetic, and on a 40ft animal it turns every curve into a run of visible plates.
//    Going smooth is what makes the segment counts above worth paying for, and it is also
//    what makes the gap discipline non-optional -- flat shading was hiding the seams, and
//    smooth shading shows every one of them. Hence limb(), rooted spikes and capped ends.
//
// 2. `hide` relief instead of `soil`. `soil` is clumped grit standing in for skin. `hide` is
//    a wrapped cell pattern -- a mosaic of tubercles with a crease between each pair, which
//    is what reptile skin actually is and what the eye reads at arm's length from a hip.
//
// 3. PER-VERTEX COLOUR FROM POSITION. This is the big one for realism and it is the reason
//    there is no colour map here. mergeColored gives every part ONE flat colour, so hide
//    tone could only change where one solid stopped and the next began -- which is why the
//    countershading used to be a separate pale tube and read as a panel bolted on. A texture
//    map is the obvious fix and is the wrong one: a material carrying both a `map` and
//    `vertexColors` multiplies them, and worse, every part here has its own UV scale (a 20ft
//    tail and a 1ft toe both run u from 0 to 1), so one repeat value cannot be right for
//    both. Shading the merged colour attribute by world position sidesteps all of it: the
//    countershading becomes a smooth gradient up the flank, the dorsal stripe a function of
//    height, and the dappling a smooth 3D wave -- none of them tied to where the solids
//    happen to meet.
//
// `detail` parts (teeth, eyes, claws, horn, bone) are merged in a SECOND batch that the tint
// never touches, because a countershading gradient applied to a tooth is a grubby tooth.
function creature(parts, seed = 3, { tint = null, detail = [] } = {}) {
  let geometry = mergeColored(parts);

  if (tint) {
    const position = geometry.attributes.position;
    const color = geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      c.fromBufferAttribute(color, i);
      tint(c, position.getX(i), position.getY(i), position.getZ(i));
      color.setXYZ(i, c.r, c.g, c.b);
    }
    color.needsUpdate = true;
  }

  if (detail.length) {
    const detailGeometry = mergeColored(detail);
    // mergeGeometries refuses a mix of indexed and non-indexed inputs, and these two batches
    // routinely differ (mergeColored only drops to non-indexed when ITS OWN batch is mixed).
    // Normalising both is cheaper than reasoning about which is which. Normals survive it, so
    // smooth shading is unaffected.
    const a = geometry.index ? geometry.toNonIndexed() : geometry;
    const b = detailGeometry.index ? detailGeometry.toNonIndexed() : detailGeometry;
    const merged = mergeGeometries([a, b], false);
    if (a !== geometry) geometry.dispose();
    if (b !== detailGeometry) detailGeometry.dispose();
    a.dispose();
    b.dispose();
    geometry = merged;
  }

  const m = mesh(geometry, standard({
    vertexColors: true,
    roughness: 0.88,
    side: THREE.DoubleSide, // for the pterosaur's membrane sheets; harmless on the rest
    ...relief('hide', { seed, repeat: 16, strength: 0.62 }),
  }));
  return group(m);
}

// The tint every animal here uses, as one function of position: countershading up the
// flank, a darker back, and a slow dapple over the whole hide.
//
// `low`/`high` are the belly and the spine in the animal's own coordinates, so a 13ft hip
// and a 5ft dome get the same treatment without either of them being special-cased.
function hideTint({ low, high, belly, dapple = 0.055, seed = 1 }) {
  const bellyColor = new THREE.Color(belly);
  return (c, x, y, z) => {
    // Countershading, and the CURVE matters more than the range. A linear fade -- or even a
    // plain smoothstep -- pales the whole flank to halfway, which is what made the first pass
    // read as one washed-out olive animal instead of a dark-backed one. Real countershading
    // keeps the pale confined to the underside and turns over quite sharply along the lower
    // flank, so the smoothstep is raised to a power on top.
    const t = THREE.MathUtils.clamp((y - low) / (high - low), 0, 1);
    const shade = t * t * (3 - 2 * t);
    c.lerp(bellyColor, Math.pow(1 - shade, 1.9) * 0.92);
    // The top third darkens again -- sun-exposed skin on every large animal is darker than
    // its flank, and it is what stops the back reading as the same tone as the shoulder.
    if (shade > 0.62) c.multiplyScalar(1 - (shade - 0.62) * 0.5);
    // Dapple: three waves at unrelated frequencies, sampled in 3D so it never repeats along
    // a limb and never shows a seam where two solids meet.
    const w =
      Math.sin(x * 0.41 + seed) * Math.cos(z * 0.53 - seed * 0.7) +
      Math.sin(y * 0.29 - x * 0.17 + seed * 1.3) * 0.7 +
      Math.cos((x + z) * 0.71 + y * 0.23) * 0.45;
    c.multiplyScalar(1 + (w / 2.15) * dapple);
  };
}

// A ring of thicker hide around a swept limb -- the neck folds and the tail banding.
//
// TorusGeometry lies in XY with its hole down Z, so rotateY(PI/2) stands it up around the
// body's own X axis and the rotateZ that follows tilts it to match the local slope of
// whatever it is wrapping. Ungtilted, a ring on a tail that is dropping away reads as a
// collar sliding off the end.
function bandRing(radius, thickness, color, [x, y, z], tilt, s = 1, segments = 22) {
  return {
    geometry: new THREE.TorusGeometry(radius * s, thickness * s, 10, segments),
    rotation: [0, Math.PI / 2, tilt],
    position: [x * s, y * s, z * s],
    color,
  };
}

// A flattened dome sitting ON a surface: an osteoderm, a scute, a bony boss, a knuckle pad.
//
// A sphere, squashed, and pushed far enough INTO the parent that its own equator is buried.
// That last part is the gap rule again: a hemisphere placed exactly on a curved surface
// meets it along a circle that only closes if both curvatures agree, and they never do.
// Sinking it means the join is inside solid geometry where nothing can be seen through it.
function scute(radius, height, color, [x, y, z], rotation, s = 1, detail = 14) {
  const g = new THREE.SphereGeometry(radius * s, detail, Math.max(7, detail >> 1));
  g.scale(1, (height / radius), 1);
  if (rotation) {
    if (rotation[0]) g.rotateX(rotation[0]);
    if (rotation[1]) g.rotateY(rotation[1]);
    if (rotation[2]) g.rotateZ(rotation[2]);
  }
  g.translate(x * s, y * s, z * s);
  return { geometry: g, color };
}

// ---------------------------------------------------------------------------
// Tyrannosaurus rex
// ---------------------------------------------------------------------------

// Built in the modern posture: spine roughly horizontal, tail held clear of the ground
// as a counterweight to the head. The upright, tail-dragging "Godzilla" pose museums
// used until the 1970s would have dislocated the animal's hips.
//
// Modelled from a reference illustration, and the things that make it read as a T. rex
// rather than as a generic big lizard are, in order of how much each one buys:
//
//   * THE DRUMSTICK. The femur is twice the thickness of the shin below it and carries a
//     muscle mass the size of the animal's own ribcage. A leg of even thickness is the
//     single loudest thing wrong with a bad theropod, and the old model had one.
//   * A SHORT, THICK, S-CURVED NECK. Five feet, not ten, and creased with folds. A long
//     smooth neck turns the animal into a sauropod with teeth.
//   * A BOXY SKULL that is wide and deep at the back and narrows to the snout, with the
//     bony brow ridges over the eyes and a lower jaw hinged well back under them.
//   * A DEEP, LATERALLY COMPRESSED RIBCAGE that narrows behind the ribs to the hips.
//   * COUNTERSHADING plus a dark dorsal stripe and banded tail, rather than one flat
//     olive from nose to tip.
//
// Everything still merges to ONE vertex-coloured, flat-shaded mesh -- see creature().
export function tyrannosaurus({ scale = 1, back = 0x6b5f3a, belly = 0xc6b487, seed = 3 } = {}) {
  const s = scale;
  const parts = [];   // hide -- the position tint shades all of this
  const detail = [];  // teeth, eyes, claws -- never tinted

  // The other tones are DERIVED from the two the caller can set, so a saved record that
  // passes its own colours still gets a coherent animal rather than a patchwork.
  const dorsal = new THREE.Color(back);
  const hide = dorsal.getHex();
  const flank = dorsal.clone().offsetHSL(0.012, 0.05, 0.075).getHex();
  const band = dorsal.clone().offsetHSL(-0.01, 0.03, -0.075).getHex();
  const snout = dorsal.clone().lerp(new THREE.Color(belly), 0.32).getHex();
  const gum = new THREE.Color(0x6b3f3a).getHex();
  const socketDark = dorsal.clone().offsetHSL(0, -0.05, -0.16).getHex();

  // --- ribcage, shoulders and hips ------------------------------------------------------
  // Deep and narrow, not a barrel: a theropod's ribcage is visibly taller than it is wide,
  // which is what gives the animal its keel-like chest from the front.
  const ribs = tube(
    [[-3.4, 12.5, 0], [-1.2, 12.9, 0], [0.4, 13.1, 0], [2.4, 13.25, 0], [4.2, 13.3, 0],
      [6.0, 13.2, 0], [7.4, 12.9, 0], [9.2, 12.4, 0]],
    [2.5, 2.95, 3.15, 3.22, 3.2, 2.95, 2.7, 2.2],
    hide, s, SEG_FINE
  );
  scaleAbout(ribs.geometry, [3 * s, 13 * s, 0], [1, 1.12, 0.84]);
  parts.push(ribs);

  // The belly's SHAPE -- a wide flattened mass whose axis sits inside the torso, clearing the
  // torso's own underside by a few inches. It began life as a narrow tube slung a foot BELOW
  // the body and read as a plank strapped on: too small to be the body, too separate to be
  // part of it, and leaving a hard step all down the flank. Its COLOUR no longer matters much
  // -- hideTint pales everything at this height -- but the volume still does.
  const bellyMass = tube(
    [[-2.4, 11.6, 0], [0.8, 11.4, 0], [3, 11.4, 0], [5, 11.5, 0], [9, 11.6, 0]],
    [1.8, 2.85, 2.9, 2.8, 1.9],
    belly, s, { tubularSegments: 26, radialSegments: 22 }
  );
  scaleAbout(bellyMass.geometry, [2 * s, 11.5 * s, 0], [1, 0.62, 1]);
  parts.push(bellyMass);

  // Shoulder girdle and the hip block, as masses rather than as the ends of tubes. A big
  // theropod is widest at these two points and the ribcage sweep alone reads as a sausage.
  for (const side of [-1, 1]) {
    const shoulder = blob(2.1, hide, [7.6, 12.4, side * 1.5], s, 18);
    scaleAbout(shoulder.geometry, [0, 0, 0], [1.15, 1.1, 0.7]);
    parts.push(shoulder);
  }
  const hipBlock = blob(2.9, hide, [0.2, 12.3, 0], s, 20);
  scaleAbout(hipBlock.geometry, [0, 0, 0], [1.1, 1.02, 1.02]);
  parts.push(hipBlock);

  // --- neck ------------------------------------------------------------------------------
  // Short, thick and S-curved, rising from the shoulders and levelling off under the head.
  // Five feet, not ten: a long smooth neck turns the animal into a sauropod with teeth.
  parts.push(...limb(hide, s, [
    { p: [8.6, 12.6, 0], r: 2.62 },
    { p: [10.4, 13.4, 0], r: 2.05 },
    { p: [12.0, 14.05, 0], r: 1.74 },
    { p: [13.6, 14.15, 0], r: 1.58 },
  ], { options: SEG_FINE }));
  // Neck folds -- the reference animal's neck is heavily creased, and rings of slightly
  // thicker, slightly darker hide are the whole of it.
  for (const [x, y, r, tilt] of [
    [9.7, 13.05, 2.3, -0.5], [10.6, 13.5, 2.06, -0.42],
    [11.5, 13.95, 1.87, -0.3], [12.5, 14.12, 1.72, -0.14],
  ]) {
    parts.push(bandRing(r, 0.13, band, [x, y, 0], tilt, s, 22));
  }
  // A dewlap under the throat. Every big archosaur has loose skin here and it is the one
  // thing that stops the underside of the neck reading as a pipe.
  const dewlap = tube([[10.0, 11.8, 0], [11.6, 12.2, 0], [13.2, 12.8, 0]], [1.15, 0.95, 0.7], belly, s, { tubularSegments: 16, radialSegments: 18 });
  scaleAbout(dewlap.geometry, [11.6 * s, 12.2 * s, 0], [1, 1.1, 0.72]);
  parts.push(dewlap);

  // --- skull -----------------------------------------------------------------------------
  // Three segments rather than one sweep, because the skull's WIDTH has to change along its
  // length and a single tube can only be scaled once: wide and deep at the back for the jaw
  // muscles and the forward-facing eyes, narrowing hard to the snout.
  const cranium = tube([[13.5, 14.15, 0], [14.3, 14.3, 0], [15.0, 14.35, 0], [16.5, 14.25, 0]], [1.62, 1.74, 1.78, 1.6], snout, s, { tubularSegments: 20, radialSegments: 24 });
  scaleAbout(cranium.geometry, [15 * s, 14.3 * s, 0], [1, 1.14, 1.06]);
  parts.push(cranium);

  const midSnout = tube([[16.3, 14.25, 0], [17.0, 14.24, 0], [17.6, 14.2, 0], [18.6, 14.0, 0]], [1.5, 1.4, 1.28, 1.05], snout, s, { tubularSegments: 18, radialSegments: 22 });
  scaleAbout(midSnout.geometry, [17.5 * s, 14.15 * s, 0], [1, 1.05, 0.78]);
  parts.push(midSnout);

  const tip = tube([[18.4, 14.0, 0], [19.0, 13.95, 0], [19.4, 13.85, 0], [20.1, 13.55, 0]], [1.06, 0.96, 0.86, 0.5], snout, s, { tubularSegments: 16, radialSegments: 20 });
  scaleAbout(tip.geometry, [19.2 * s, 13.85 * s, 0], [1, 1.02, 0.72]);
  parts.push(tip);
  // The snout tip is a cut ring without this -- the one place on the skull a hole would show.
  parts.push(ball(0.5, snout, [20.1, 13.55, 0], s, 14));

  // The antorbital fenestra: the big opening in front of the eye that every theropod skull
  // has. Not a hole here -- a sunken darker panel, which is what it reads as under skin.
  for (const side of [-1, 1]) {
    const fen = scute(0.95, 0.3, socketDark, [17.3, 14.35, side * 1.12], [0, 0, 0.1], s, 12);
    // scaleAbout, NOT geometry.scale. scute() has already translated this to its place on the
    // skull, so a plain scale multiplies that position too -- at 1.5x it threw both panels out
    // to x = 26, six feet in front of the animal's own snout, where they hung in mid-air as a
    // pair of black lenses. Exactly the trap scaleAbout exists for.
    scaleAbout(fen.geometry, [17.3 * s, 14.35 * s, side * 1.12 * s], [1.5, 1, 1]);
    parts.push(fen);
  }

  // Lower jaw, hinged well back under the eye and hanging open.
  //
  // The jaw and its tooth row are swung about the HINGE as one piece rather than each being
  // nudged down by hand. Built closed -- which is what "a lower jaw under the upper one"
  // produces if you are not thinking about it -- the two tooth rows interpenetrate into a
  // single solid saw, and the animal reads as having one welded mouth.
  const HINGE = [14.3, 13.15];
  const GAPE = 0.2; // radians the jaw hangs open
  const swing = ([x, y]) => {
    const dx = x - HINGE[0];
    const dy = y - HINGE[1];
    return [HINGE[0] + dx * Math.cos(GAPE) + dy * Math.sin(GAPE), HINGE[1] - dx * Math.sin(GAPE) + dy * Math.cos(GAPE)];
  };
  const jawLine = [[14.3, 13.15], [15.5, 12.9], [16.6, 12.75], [18.6, 12.6], [19.9, 12.75]].map(swing);
  const jaw = tube(jawLine.map(([x, y]) => [x, y, 0]), [1.15, 1.02, 0.92, 0.62, 0.34], flank, s, { tubularSegments: 20, radialSegments: 20 });
  scaleAbout(jaw.geometry, [jawLine[2][0] * s, jawLine[2][1] * s, 0], [1, 0.92, 0.76]);
  parts.push(jaw);
  parts.push(ball(1.25, flank, [14.4, 13.2, 0], s, 18));
  parts.push(ball(0.34, flank, [jawLine[4][0], jawLine[4][1], 0], s, 12));

  // GUM LINES along both jaws, and they are worth their two tubes. A tooth row rising
  // straight out of a smooth surface reads as pins in a pincushion; a slightly proud, darker
  // ridge with the teeth coming out of IT is a mouth. It is also current science -- the teeth
  // were almost certainly covered by scaly lips rather than bared like a crocodile's.
  for (const side of [-1, 1]) {
    parts.push(tube(
      [[15.0, 13.5, side * 0.95], [16.5, 13.4, side * 0.88], [18.0, 13.3, side * 0.72], [19.6, 13.2, side * 0.45]],
      [0.3, 0.28, 0.24, 0.16], gum, s, { tubularSegments: 14, radialSegments: 12 }
    ));
    const lowerGum = [[15.2, 12.98, side * 0.85], [16.6, 12.9, side * 0.8], [18.2, 12.85, side * 0.62], [19.6, 12.9, side * 0.36]]
      .map(([x, y, z]) => { const [sx, sy] = swing([x, y]); return [sx, sy, z]; });
    parts.push(tube(lowerGum, [0.27, 0.25, 0.21, 0.14], gum, s, { tubularSegments: 14, radialSegments: 12 }));
  }

  // Brow ridges. The bony horn over each eye is one of the most recognisable things on the
  // skull and it costs two squashed spheres.
  for (const side of [-1, 1]) {
    const brow = blob(0.66, snout, [16.55, 15.3, side * 0.95], s, 14);
    scaleAbout(brow.geometry, [0, 0, 0], [1.6, 0.55, 0.9]);
    parts.push(brow);
    // A second, smaller boss behind it -- the postorbital.
    parts.push(scute(0.42, 0.22, snout, [15.5, 15.35, side * 1.0], null, s, 12));
  }

  // Eyes, set forward and under the brows -- T. rex had overlapping fields of view, which is
  // how a hunter judges distance. Three parts each now: a socket, a sclera and a pupil, so
  // the eye has depth instead of being a black dot painted on.
  for (const side of [-1, 1]) {
    parts.push(blob(0.56, socketDark, [16.9, 14.72, side * 1.0], s, 14));
    detail.push(blob(0.34, 0xb9a26a, [17.02, 14.74, side * 1.14], s, 14));
    detail.push(blob(0.17, EYE, [17.12, 14.75, side * 1.24], s, 12));
  }
  // Nostrils, well back from the tip, where they actually sit -- and recessed rather than
  // stuck on, which is what the darker sunken disc is doing.
  for (const side of [-1, 1]) {
    parts.push(scute(0.3, 0.14, socketDark, [18.85, 14.4, side * 0.62], [0, 0, 0.2], s, 12));
  }
  // The ear opening, behind and below the eye.
  for (const side of [-1, 1]) parts.push(scute(0.22, 0.12, socketDark, [15.1, 14.3, side * 1.32], null, s, 10));

  // Teeth, following the real jaw lines rather than a straight row: biggest at the front of
  // the maxilla and shrinking backward. The largest T. rex tooth found is about the size of a
  // banana -- which is exactly the comparison the placard nearby makes.
  for (let i = 0; i < 13; i++) {
    const t = i / 12;
    const x = 15.0 + t * 4.7;
    const halfWidth = 0.9 - t * 0.48;
    const drop = 13.4 - t * 0.26;
    const length = (0.55 + t * 0.55) * (1 - Math.max(0, t - 0.84) * 4);
    for (const side of [-1, 1]) {
      detail.push(...spike(length, 0.15, TOOTH, [x, drop, side * halfWidth], [Math.PI, 0, 0], s, { rooted: false, sides: 10 }));
    }
  }
  // The lower row rides the jaw, so it takes the same swing about the hinge.
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    const halfWidth = 0.8 - t * 0.42;
    const length = (0.44 + t * 0.36) * (1 - Math.max(0, t - 0.82) * 4);
    const [x, y] = swing([15.5 + t * 4.0, 12.9 + t * 0.12]);
    for (const side of [-1, 1]) {
      detail.push(...spike(length, 0.13, TOOTH, [x, y, side * halfWidth], [0, 0, -GAPE], s, { rooted: false, sides: 10 }));
    }
  }

  // --- tail ------------------------------------------------------------------------------
  // Long, deep at the base, tapering to a whip. It is the counterweight, and the base stays
  // THICK for a good six feet before it starts to taper -- it is a muscle anchor, not a whip
  // until much further out.
  const tail = tube(
    [[-3.4, 12.5, 0], [-5.4, 12.6, 0], [-7.5, 12.6, 0], [-9.8, 12.3, 0], [-12, 11.9, 0],
      [-14.2, 11.3, 0], [-16.5, 10.6, 0], [-18.8, 9.95, 0], [-21, 9.3, 0]],
    [2.6, 2.48, 2.3, 1.94, 1.5, 1.1, 0.78, 0.44, 0.1],
    hide, s, { tubularSegments: 40, radialSegments: 22 }
  );
  scaleAbout(tail.geometry, [-10 * s, 12 * s, 0], [1, 1.08, 0.9]);
  parts.push(tail);
  for (const [x, y, r, tilt] of [
    [-5.8, 12.6, 2.2, 0.02], [-9.0, 12.42, 1.78, -0.1], [-12.2, 11.85, 1.3, -0.2],
    [-15.3, 11.02, 0.9, -0.26], [-18.3, 10.12, 0.5, -0.28],
  ]) {
    parts.push(bandRing(r, 0.14, band, [x, y, 0], tilt, s, 20));
  }

  // A ridge of low scutes from the shoulders to halfway down the tail. This is the dorsal
  // stripe made of FORM rather than of colour -- hideTint already darkens the top of the
  // animal, so what was missing was a silhouette down the spine.
  const ridge = [
    [9.2, 14.85], [7.4, 15.6], [5.4, 16.3], [3.4, 16.75], [1.4, 16.7], [-0.6, 16.2],
    [-2.6, 15.6], [-4.6, 15.05], [-6.6, 14.75], [-8.6, 14.3], [-10.6, 13.7], [-12.6, 12.95],
    [-14.6, 12.2],
  ];
  ridge.forEach(([x, y], i) => {
    const t = i / (ridge.length - 1);
    const r = 0.5 - t * 0.3;
    parts.push(scute(r, r * (1.5 - t * 0.5), band, [x, y, 0], null, s, 12));
  });

  // --- legs ------------------------------------------------------------------------------
  // Digitigrade -- the animal walks on its toes, and what looks like a backwards knee
  // halfway up is really its ankle.
  for (const side of [-1, 1]) {
    const z = side * 2.6;

    // Hip, plus the huge caudofemoral muscle behind and below it. That rear bulge is what
    // actually swung a T. rex's leg, and without it the thigh has no visible mass at all:
    // sunk against the belly it hides inside the body's own outline and the animal reads as
    // a barrel on stilts, which is exactly how the first pass came out.
    parts.push(ball(2.75, hide, [0.3, 12.2, z * 0.78], s, 20));
    const haunch = blob(2.4, hide, [-1.0, 10.8, z * 0.95], s, 18);
    scaleAbout(haunch.geometry, [0, 0, 0], [1.1, 1.15, 0.78]);
    parts.push(haunch);

    // FEMUR -> shin -> ankle -> metatarsus, as one chain so every joint is socketed by
    // construction. The femur is the thickest part of the animal after the ribcage and is
    // flattened side-to-side rather than round; it reaches WELL below the belly line, which
    // is the only way the drumstick reads at all.
    const leg = limb(hide, s, [
      { p: [0.1, 12.5, z * 0.8], r: 3.0 },
      { p: [1.3, 10.0, z * 0.98], r: 2.6 },
      { p: [2.3, 7.4, z * 1.02], r: 1.5 },
      { p: [1.0, 5.2, z * 1.05], r: 0.95 },
      { p: [0.0, 3.8, z * 1.05], r: 0.74 },
      { p: [0.8, 2.3, z * 1.05], r: 0.62 },
      { p: [1.5, 1.0, z * 1.05], r: 0.54 },
    ], { options: { tubularSegments: 16, radialSegments: 20 } });
    // Flatten the thigh only -- the first two segments -- about the femur's own axis.
    for (let i = 0; i < 2; i++) scaleAbout(leg[i].geometry, [1.2 * s, 10 * s, z * 0.95 * s], [1, 1, 0.8]);
    parts.push(...leg);

    // Knee cap and a heel pad, both of which a bare chain of tubes has no reason to grow.
    parts.push(scute(0.9, 0.5, hide, [2.9, 7.3, z * 1.02], [0, 0, -0.3], s, 14));
    parts.push(scute(0.75, 0.45, hide, [-0.4, 3.7, z * 1.05], [0, 0, 0.4], s, 14));

    // Three forward toes -- three bones apiece, so they bend -- plus the little reversed
    // hallux, each finished with a claw and each toe sitting on a pad.
    for (const spread of [-0.85, 0, 0.85]) {
      const outward = spread * 1.4;
      const toe = limb(hide, s, [
        { p: [1.5, 0.95, z * 1.05], r: 0.5 },
        { p: [2.4, 0.62, z * 1.05 + outward * 0.5], r: 0.4 },
        { p: [3.2, 0.46, z * 1.05 + outward * 0.85], r: 0.3 },
        { p: [3.8, 0.38, z * 1.05 + outward], r: 0.22 },
      ], { capStart: false, options: SEG_SMALL });
      parts.push(...toe);
      parts.push(scute(0.42, 0.2, hide, [2.6, 0.3, z * 1.05 + outward * 0.55], null, s, 10));
      detail.push(...spike(0.9, 0.18, CLAW, [4.2, 0.34, z * 1.05 + outward * 1.1], [0, 0, -Math.PI / 2 - 0.35], s, { sides: 10 }));
    }
    parts.push(...limb(hide, s, [
      { p: [1.4, 1.05, z * 1.05], r: 0.34 },
      { p: [0.5, 0.5, z * 1.02], r: 0.22 },
    ], { capStart: false, options: SEG_SMALL }));
    detail.push(...spike(0.55, 0.14, CLAW, [0.15, 0.38, z * 1.0], [0, 0, Math.PI / 2 + 0.4], s, { sides: 8 }));

    // The famous arms. Two fingers, and shorter than a human's -- but they could curl about
    // 400 pounds, so "useless" is the one thing they were not.
    parts.push(ball(0.9, hide, [7.9, 11.5, side * 2.1], s, 16));
    parts.push(...limb(hide, s, [
      { p: [8.0, 11.3, side * 2.15], r: 0.68 },
      { p: [9.0, 10.0, side * 2.5], r: 0.46 },
      { p: [10.3, 9.5, side * 2.4], r: 0.32 },
    ], { options: { tubularSegments: 14, radialSegments: 16 } }));
    for (const finger of [-0.26, 0.26]) {
      parts.push(...limb(hide, s, [
        { p: [10.3, 9.5, side * 2.4 + finger], r: 0.21 },
        { p: [10.7, 9.36, side * 2.4 + finger], r: 0.18 },
        { p: [11.1, 9.22, side * 2.4 + finger], r: 0.14 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(...spike(0.9, 0.12, CLAW, [11.6, 9.02, side * 2.4 + finger], [0, 0, -Math.PI / 2 - 0.6], s, { sides: 8 }));
    }
  }

  return creature(parts, seed, {
    detail,
    // low is the underside of the belly, high the top of the dorsal ridge, so the gradient
    // spans the animal rather than an arbitrary slice of it.
    tint: hideTint({ low: 9.6 * s, high: 16.6 * s, belly, dapple: 0.07, seed: 1.4 }),
  });
}

// ---------------------------------------------------------------------------
// Triceratops
// ---------------------------------------------------------------------------

// 10ft at the shoulder, 28ft long, and the skull alone is over 7ft -- one of the
// largest heads any land animal has ever carried.
export function triceratops({ scale = 1, hide = 0x93977a, frill = 0xa07f56, seed = 5 } = {}) {
  const s = scale;
  const parts = [];
  const detail = [];
  const rng = seededRandom(seed);

  const base = new THREE.Color(hide);
  const hideHex = base.getHex();
  const shoulderHex = base.clone().offsetHSL(0.01, 0.03, -0.05).getHex();
  const bellyHex = base.clone().offsetHSL(0.02, -0.04, 0.16).getHex();
  // The frill is SKIN OVER BONE, so its colour sits near the hide rather than away from it.
  // At the first pass's saturated brown, ringed with bone-white spikes, it read as a patch of
  // thatch stuck on the neck instead of as part of the animal.
  const frillBase = new THREE.Color(frill).lerp(base, 0.45);
  const frillHex = frillBase.getHex();
  const frillDark = frillBase.clone().offsetHSL(0, 0.03, -0.1).getHex();
  const fenestra = frillBase.clone().offsetHSL(-0.01, 0.02, -0.16).getHex();

  // --- torso -------------------------------------------------------------------------
  // A ceratopsian is BARREL-shaped, unlike the theropod's keel: wide, deep, and carrying a
  // pronounced hump of neural spines over the shoulders that anchors the muscle holding a
  // 7ft skull up. Without that hump the animal reads as a rhinoceros with a hat on.
  const body = tube(
    [[-8.5, 8.6, 0], [-6, 9.05, 0], [-3.5, 9.3, 0], [-1, 9.45, 0], [1.5, 9.5, 0], [3.8, 9.3, 0], [6, 9.0, 0]],
    [2.3, 3.05, 3.4, 3.5, 3.5, 3.25, 3.0],
    hideHex, s, SEG_FINE
  );
  scaleAbout(body.geometry, [0, 9.2 * s, 0], [1, 1.0, 1.06]);
  parts.push(body);

  const triBelly = tube([[-7, 7.5, 0], [-3, 7.6, 0], [0, 7.7, 0], [3, 7.85, 0], [5.5, 7.9, 0]], [2.4, 2.9, 3.1, 2.9, 2.6], bellyHex, s, { tubularSegments: 28, radialSegments: 22 });
  scaleAbout(triBelly.geometry, [0, 7.7 * s, 0], [1, 0.65, 1]);
  parts.push(triBelly);

  // The shoulder hump.
  const hump = blob(2.6, shoulderHex, [3.4, 10.1, 0], s, 20);
  scaleAbout(hump.geometry, [0, 0, 0], [1.5, 0.7, 1.0]);
  parts.push(hump);
  const hipMass = blob(2.9, hideHex, [-5.0, 9.0, 0], s, 20);
  scaleAbout(hipMass.geometry, [0, 0, 0], [1.05, 0.95, 1.05]);
  parts.push(hipMass);

  // Neck: short, immensely thick, and hidden under the frill.
  parts.push(...limb(hideHex, s, [
    { p: [6, 9.0, 0], r: 2.9 },
    { p: [7.4, 8.85, 0], r: 2.6 },
    { p: [8.4, 8.7, 0], r: 2.3 },
  ], { options: SEG_FINE }));

  // --- skull and beak ----------------------------------------------------------------
  const skull = tube([[8.4, 8.7, 0], [9.8, 8.55, 0], [11, 8.3, 0], [12.4, 7.85, 0], [13.4, 7.45, 0]], [2.15, 1.9, 1.6, 1.1, 0.68], hideHex, s, { tubularSegments: 24, radialSegments: 24 });
  scaleAbout(skull.geometry, [11 * s, 8.3 * s, 0], [1, 1.16, 0.92]);
  parts.push(skull);

  // The rhamphotheca -- a parrot-like SHEAR, not a chewing mouth, and the single most
  // characteristic thing about the front of this animal. Two beaks, upper hooked down over
  // lower, each a swept tube flattened side to side so it has an EDGE rather than a snout.
  const upperBeak = tube([[13.2, 7.6, 0], [13.9, 7.35, 0], [14.5, 6.85, 0], [14.75, 6.35, 0]], [0.72, 0.6, 0.42, 0.1], BONE, s, { tubularSegments: 16, radialSegments: 16 });
  scaleAbout(upperBeak.geometry, [13.9 * s, 7.3 * s, 0], [1, 1, 0.62]);
  parts.push(upperBeak);
  parts.push(ball(0.72, BONE, [13.2, 7.6, 0], s, 14));
  const lowerBeak = tube([[12.9, 6.95, 0], [13.6, 6.8, 0], [14.2, 6.6, 0]], [0.6, 0.45, 0.16], BONE, s, { tubularSegments: 14, radialSegments: 14 });
  scaleAbout(lowerBeak.geometry, [13.4 * s, 6.8 * s, 0], [1, 0.9, 0.58]);
  parts.push(lowerBeak);
  parts.push(ball(0.6, hideHex, [12.85, 6.98, 0], s, 14));

  // --- the frill ---------------------------------------------------------------------
  // A CLOSED LENS, not a cut disc, and that is a gap decision. The obvious build is a partial
  // cylinder -- a fan with flat caps -- but its rim is then three separate surfaces meeting at
  // hard edges, and where that rim passes into the skull the seam is visible from below. A
  // sphere flattened on one axis is closed by construction: there is no rim to fail, and
  // scaling it tall and wide gives the same shield outline.
  // Its PROPORTIONS are the thing to get right and the first pass got them wrong: at 4.35ft of
  // radius stretched 1.16 taller it stood ten feet tall and read as a dorsal sail on a hippo.
  // A real Triceratops frill is about as wide as the skull is long, roughly circular from the
  // front, and it lies BACK over the neck with its top edge not much above the top of the head.
  // So: smaller, unstretched, and tipped back a lot further.
  // BROADER THAN TALL, and topping the animal out near 14ft with its head up. Two failed
  // passes bracket this: 4.35ft stretched 1.16 TALLER stood ten feet high and read as a
  // dorsal sail, and pulling it back to 3.6ft at 45 degrees buried its lower half inside the
  // neck so that only the rim spikes showed and it read as a mane.
  const FR = 3.4;
  const FRILL_C = [7.4, 10.6];
  const FRILL_TILT = -0.52;
  const FY = 0.95; // vertical stretch -- under 1, because a real frill is wider than it is tall
  const FZ = 1.28; // lateral stretch
  const frillShell = blob(FR, frillHex, [0, 0, 0], s, 30);
  scaleAbout(frillShell.geometry, [0, 0, 0], [0.22, FY, FZ]);
  frillShell.geometry.rotateZ(FRILL_TILT);
  frillShell.geometry.translate(FRILL_C[0] * s, FRILL_C[1] * s, 0);
  parts.push(frillShell);

  // Where a point at angle `a` on the frill's rim actually ends up, once the shell's own
  // squash, tilt and offset are applied. The first pass approximated this and every other
  // epoccipital floated clear of the edge it was supposed to be sitting on.
  const rim = (a, out = 1) => {
    const y = Math.cos(a) * FR * FY * out;
    const z = Math.sin(a) * FR * FZ * out;
    return [
      FRILL_C[0] + (-Math.sin(FRILL_TILT) * y),
      FRILL_C[1] + (Math.cos(FRILL_TILT) * y),
      z,
    ];
  };

  // The parietal bar down the middle and the thick rim -- a real frill is a lattice of heavy
  // bone round large openings, and these two are what say so.
  const barA = rim(Math.PI, 0.92);
  const barB = rim(0, 0.92);
  const bar = tube([barA, [FRILL_C[0], FRILL_C[1], 0], barB], [0.5, 0.62, 0.45], frillDark, s, { tubularSegments: 18, radialSegments: 16 });
  scaleAbout(bar.geometry, [FRILL_C[0] * s, FRILL_C[1] * s, 0], [0.7, 1, 1]);
  parts.push(bar);
  // Fenestrae: the two big windows in the frill, as sunken darker panels either side of the bar.
  for (const side of [-1, 1]) {
    const win = blob(1.35, fenestra, [0, 0, 0], s, 18);
    scaleAbout(win.geometry, [0, 0, 0], [0.18, 1.0, 0.66]);
    win.geometry.rotateZ(FRILL_TILT);
    const at = rim(0.62 * side === 0 ? 0 : 0.5, 0.42);
    win.geometry.translate((at[0] + 0.28) * s, at[1] * s, side * 1.55 * s);
    parts.push(win);
  }
  // Epoccipitals -- SCALLOPS, not spikes. A real Triceratops has five to seven low triangular
  // bumps along each side of the rim, fused into it; seventeen bone-white spikes at 0.85ft
  // read as a crown of thorns and were the loudest wrong thing on the animal.
  for (let i = 0; i < 13; i++) {
    const a = -1.36 + (i / 12) * 2.72;
    const p = rim(a, 0.99);
    const w = 0.42 - Math.abs(a) * 0.06;
    parts.push(...spike(w * 1.15, w, frillDark, p, [a, 0, FRILL_TILT], s, { sides: 8 }));
  }

  // --- horns -------------------------------------------------------------------------
  // Brow horns are CURVED -- forward, then up -- and up to 3ft long. A straight cone reads as
  // a spike glued on; the sweep is what makes it grow out of the skull.
  for (const side of [-1, 1]) {
    parts.push(...horn([
      { p: [11.5, 9.6, side * 1.3], r: 0.56 },
      { p: [12.3, 10.9, side * 1.35], r: 0.44 },
      { p: [13.3, 11.9, side * 1.25], r: 0.3 },
      { p: [14.3, 12.5, side * 1.1], r: 0.0 },
    ], BONE, s));
    // Jugal boss -- the cheek horn, small and easily missed, and every good reconstruction
    // has one.
    parts.push(...spike(0.85, 0.36, BONE, [11.6, 7.7, side * 1.55], [0, 0, -0.2, ], s, { sides: 10 }));
  }
  // Nasal horn, short and stout.
  parts.push(...horn([
    { p: [12.8, 8.45, 0], r: 0.5 },
    { p: [13.5, 9.4, 0], r: 0.34 },
    { p: [14.0, 10.15, 0], r: 0.0 },
  ], BONE, s));

  // Eyes, under the brow horns.
  for (const side of [-1, 1]) {
    parts.push(blob(0.4, frillDark, [11.3, 9.15, side * 1.8], s, 14));
    detail.push(blob(0.24, 0x8f7a4c, [11.4, 9.18, side * 1.94], s, 12));
    detail.push(blob(0.12, EYE, [11.46, 9.19, side * 2.02], s, 10));
  }

  // --- legs --------------------------------------------------------------------------
  // Columnar and elephantine. The front pair are shorter, set wider and slightly sprawled --
  // ceratopsian forelimbs are not tucked under the body like the hind pair.
  for (const side of [-1, 1]) {
    parts.push(ball(2.25, hideHex, [4.6, 8.2, side * 2.4], s, 20));
    parts.push(...limb(hideHex, s, [
      { p: [4.6, 8.2, side * 2.6], r: 2.0 },
      { p: [5.0, 5.6, side * 2.95], r: 1.4 },
      { p: [4.9, 3.4, side * 3.1], r: 1.1 },
      { p: [4.6, 1.1, side * 3.1], r: 0.98 },
    ], { options: { tubularSegments: 18, radialSegments: 20 } }));
    // The foot: a broad pad with five short toes, each capped by a hoof.
    const frontPad = blob(1.3, hideHex, [4.6, 0.62, side * 3.1], s, 18);
    scaleAbout(frontPad.geometry, [0, 0, 0], [1.15, 0.55, 1.25]);
    parts.push(frontPad);
    for (let t = 0; t < 5; t++) {
      const spread = (t - 2) * 0.42;
      parts.push(...limb(hideHex, s, [
        { p: [4.9, 0.55, side * 3.1 + spread], r: 0.3 },
        { p: [5.6, 0.4, side * 3.1 + spread * 1.25], r: 0.24 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(scute(0.26, 0.2, BONE, [5.82, 0.34, side * 3.1 + spread * 1.35], [0, 0, -0.5], s, 10));
    }

    parts.push(ball(2.45, hideHex, [-5.2, 8.4, side * 2.5], s, 20));
    parts.push(...limb(hideHex, s, [
      { p: [-5.2, 8.4, side * 2.7], r: 2.2 },
      { p: [-5.7, 5.7, side * 2.9], r: 1.5 },
      { p: [-5.5, 3.3, side * 3.0], r: 1.15 },
      { p: [-5.2, 1.2, side * 3.0], r: 1.0 },
    ], { options: { tubularSegments: 18, radialSegments: 20 } }));
    const rearPad = blob(1.35, hideHex, [-5.2, 0.68, side * 3.0], s, 18);
    scaleAbout(rearPad.geometry, [0, 0, 0], [1.15, 0.55, 1.2]);
    parts.push(rearPad);
    for (let t = 0; t < 4; t++) {
      const spread = (t - 1.5) * 0.48;
      parts.push(...limb(hideHex, s, [
        { p: [-4.9, 0.6, side * 3.0 + spread], r: 0.32 },
        { p: [-4.15, 0.44, side * 3.0 + spread * 1.2], r: 0.25 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(scute(0.27, 0.21, BONE, [-3.9, 0.38, side * 3.0 + spread * 1.3], [0, 0, 0.5], s, 10));
    }
  }

  // --- tail --------------------------------------------------------------------------
  parts.push(...limb(hideHex, s, [
    { p: [-8.5, 8.6, 0], r: 2.25 },
    { p: [-10.2, 8.35, 0], r: 1.7 },
    { p: [-12.0, 7.9, 0], r: 1.1 },
    { p: [-13.6, 7.4, 0], r: 0.6 },
    { p: [-14.8, 6.95, 0], r: 0.0 },
  ], { capEnd: false, options: { tubularSegments: 22, radialSegments: 20 } }));

  // --- hide detail -------------------------------------------------------------------
  // Big polygonal feature scutes, scattered over the flanks and rump. Ceratopsian skin
  // impressions really do show these -- large rosette scales spaced among much finer ones --
  // and they are what stops a wide smooth flank reading as a balloon.
  // ON THE BODY'S OWN SURFACE, worked out from the same control points the torso was swept
  // from. Placed at a guessed lateral offset instead (the first pass) most of them ended up
  // buried inside the barrel, and the handful that did poke out all clustered on the one
  // station where the body happened to be narrow enough -- which read as a rash on the
  // shoulder rather than as scattered scutes.
  const bodyRadiusAt = (x) => {
    const stations = [[-8.5, 2.3], [-6, 3.05], [-3.5, 3.4], [-1, 3.5], [1.5, 3.5], [3.8, 3.25], [6, 3.0]];
    for (let i = 0; i < stations.length - 1; i++) {
      const [x0, r0] = stations[i];
      const [x1, r1] = stations[i + 1];
      if (x >= x0 && x <= x1) return r0 + (r1 - r0) * ((x - x0) / (x1 - x0));
    }
    return 2.3;
  };
  for (let i = 0; i < 44; i++) {
    const x = randomIn(rng, -7.6, 5.2);
    const r0 = bodyRadiusAt(x);
    // An angle round the body axis, kept off the very top and the very bottom.
    const a = randomIn(rng, 0.35, Math.PI - 0.35);
    for (const side of [-1, 1]) {
      const r = randomIn(rng, 0.3, 0.55);
      parts.push(scute(
        r, r * 0.4, shoulderHex,
        [x, 9.2 + Math.cos(a) * r0 * 0.97, side * Math.sin(a) * r0 * 1.03],
        [0, 0, 0], s, 10
      ));
    }
  }

  return creature(parts, seed, {
    detail,
    tint: hideTint({ low: 6.8 * s, high: 10.8 * s, belly: bellyHex, dapple: 0.06, seed: 2.7 }),
  });
}

// ---------------------------------------------------------------------------
// Ankylosaurus
// ---------------------------------------------------------------------------

// A living tank: 20ft long but only 5.5ft tall, so it is one of the few animals here a
// student can look over the top of. The club on the end of the tail was solid bone.
export function ankylosaurus({ scale = 1, hide = 0x847768, armor = 0x9c9280, seed = 7 } = {}) {
  const s = scale;
  const rng = seededRandom(seed);
  const parts = [];
  const detail = [];

  const base = new THREE.Color(hide);
  const hideHex = base.getHex();
  const bellyHex = base.clone().offsetHSL(0.02, -0.05, 0.14).getHex();
  const armorHex = new THREE.Color(armor).getHex();
  const armorDark = new THREE.Color(armor).offsetHSL(0, 0.02, -0.12).getHex();
  const keel = new THREE.Color(armor).offsetHSL(-0.01, 0.05, -0.2).getHex();

  // --- body --------------------------------------------------------------------------
  // Squashed hard and widened. The whole point of this animal is that it is one of the few
  // here a student can see over the top of, so its back has to sit near 5.5ft -- and it is
  // WIDER than it is tall, which is what makes it read as a living paving slab.
  const body = tube(
    [[-6.5, 3.2, 0], [-4.2, 3.5, 0], [-2, 3.6, 0], [0.4, 3.65, 0], [2.5, 3.6, 0], [4.6, 3.4, 0], [6.5, 3.0, 0]],
    [2.2, 2.65, 2.9, 2.95, 2.9, 2.6, 2.0],
    hideHex, s, SEG_FINE
  );
  scaleAbout(body.geometry, [0, 3.3 * s, 0], [1, 0.78, 1.48]);
  parts.push(body);

  const belly = tube([[-5.5, 2.0, 0], [0, 1.9, 0], [5.5, 2.1, 0]], [2.0, 2.5, 1.8], bellyHex, s, { tubularSegments: 24, radialSegments: 20 });
  scaleAbout(belly.geometry, [0, 1.95 * s, 0], [1, 0.42, 1.5]);
  parts.push(belly);

  // --- head --------------------------------------------------------------------------
  // A low wide wedge, almost as broad as it is long, with a squared-off beak. The skull roof
  // was fused armour in life, so it gets its own plates rather than bare hide.
  const head = tube([[6.5, 3.3, 0], [7.6, 3.2, 0], [8.6, 3.1, 0], [9.6, 2.95, 0], [10.4, 2.8, 0]], [2.0, 1.9, 1.7, 1.35, 1.0], hideHex, s, { tubularSegments: 20, radialSegments: 22 });
  scaleAbout(head.geometry, [8.4 * s, 3.1 * s, 0], [1, 0.8, 1.3]);
  parts.push(head);
  parts.push(ball(1.0, hideHex, [10.4, 2.8, 0], s, 16));
  // The beak.
  const beak = blob(1.0, BONE, [10.7, 2.75, 0], s, 16);
  scaleAbout(beak.geometry, [0, 0, 0], [0.62, 0.5, 1.15]);
  parts.push(beak);

  for (const side of [-1, 1]) {
    // Squamosal horn, pointing back and out from the rear corner of the skull, and the
    // quadratojugal boss under it pointing down. Four horns on the head, not two.
    parts.push(...horn([
      { p: [7.1, 3.5, side * 2.15], r: 0.48 },
      { p: [6.5, 3.5, side * 2.75], r: 0.34 },
      { p: [6.0, 3.4, side * 3.2], r: 0.0 },
    ], armorHex, s));
    parts.push(...horn([
      { p: [8.4, 2.5, side * 2.0], r: 0.4 },
      { p: [8.5, 2.0, side * 2.5], r: 0.26 },
      { p: [8.6, 1.75, side * 2.85], r: 0.0 },
    ], armorHex, s));
    // Skull-roof plates and the little armoured eyelid ridge over the eye.
    parts.push(scute(0.55, 0.22, armorHex, [8.0, 3.95, side * 1.1], null, s, 12));
    parts.push(scute(0.42, 0.2, armorHex, [9.1, 3.7, side * 0.9], null, s, 12));
    parts.push(scute(0.34, 0.18, armorHex, [9.4, 3.4, side * 1.5], [0, 0, -0.3], s, 10));
    detail.push(blob(0.2, EYE, [9.5, 3.15, side * 1.62], s, 10));
  }
  parts.push(scute(0.6, 0.24, armorHex, [7.2, 4.0, 0], null, s, 14));

  // --- the carapace ------------------------------------------------------------------
  // OSTEODERMS BY THE HUNDRED, in graded transverse rows, and this is the whole animal.
  // The first pass had nine pairs of cones and read as a hedgehog; what an ankylosaur
  // actually wears is a continuous pavement of low keeled plates, biggest along the flanks,
  // with small ones filling every gap between them. Each one is a flattened dome sunk into
  // the hide -- see scute() on why sinking it is what closes the join.
  // WHERE THE BACK ACTUALLY IS has to be derived from the torso sweep, not guessed. The first
  // pass worked the height out as `3.65 * 0.78 + 3.3 * 0.22` -- a plausible-looking line that is
  // simply not what scaleAbout does to a swept tube -- and put every plate at y = 3.57 when the
  // real back is at 5.87. The whole carapace was buried more than two feet inside the animal,
  // and an ankylosaur with no armour on it is a hippopotamus.
  //
  // So: one function giving the point on the torso's surface at station x and angle theta from
  // straight up, applying the same axis, the same radius interpolation and the same
  // scaleAbout(3.3, [1, 0.78, 1.48]) the body itself got.
  const AXIS_Y = 3.6;
  const SQUASH = 0.78;
  const WIDEN = 1.48;
  const PIVOT = 3.3;
  const torsoRadius = (x) => {
    const st = [[-6.5, 2.2], [-4.2, 2.65], [-2, 2.9], [0.4, 2.95], [2.5, 2.9], [4.6, 2.6], [6.5, 2.0]];
    if (x <= st[0][0]) return st[0][1];
    for (let i = 0; i < st.length - 1; i++) {
      if (x >= st[i][0] && x <= st[i + 1][0]) {
        const f = (x - st[i][0]) / (st[i + 1][0] - st[i][0]);
        return st[i][1] + (st[i + 1][1] - st[i][1]) * f;
      }
    }
    return st[st.length - 1][1];
  };
  const onBack = (x, theta, out = 1) => {
    const r = torsoRadius(x) * out;
    return [
      x,
      PIVOT + (AXIS_Y + Math.cos(theta) * r - PIVOT) * SQUASH,
      Math.sin(theta) * r * WIDEN,
    ];
  };

  const ROWS = 14;
  for (let r = 0; r < ROWS; r++) {
    const t = r / (ROWS - 1);
    const x = -6.6 + t * 12.8;
    const perRow = 7;
    for (let i = 0; i < perRow; i++) {
      // theta runs from one upper flank over the spine to the other.
      const u = (i / (perRow - 1)) * 2 - 1;
      const theta = u * 1.16;
      const p = onBack(x, theta, 0.98);
      const big = 1 - Math.abs(u) * 0.3;
      const rad = randomIn(rng, 0.38, 0.5) * big * (0.85 + Math.sin(t * Math.PI) * 0.3);
      parts.push(scute(rad, rad * randomIn(rng, 0.6, 0.85), r % 2 ? armorHex : armorDark, p, [0, 0, -theta], s, 12));
      // A keel ridge along the biggest plates, standing proud of each one.
      if (Math.abs(u) > 0.25 && Math.abs(u) < 0.88) {
        const q = onBack(x, theta, 1.06);
        parts.push(scute(rad * 0.5, rad * 0.9, keel, q, [0, 0, -theta], s, 10));
      }
    }
    // Small filler scutes offset between the rows, which is what makes it a pavement rather
    // than a polka dot.
    if (r < ROWS - 1) {
      for (let i = 0; i < 4; i++) {
        const theta = ((i / 3) * 2 - 1) * 1.0;
        const p = onBack(x + 0.46, theta, 0.97);
        const rad = randomIn(rng, 0.17, 0.25);
        parts.push(scute(rad, rad * 0.65, armorDark, p, [0, 0, -theta], s, 8));
      }
    }
    // The lateral spike fringe -- these DO stick out sideways, and they are the one place on
    // this animal where a cone is right and a dome is not.
    for (const side of [-1, 1]) {
      const len = randomIn(rng, 0.9, 1.5) * (0.7 + Math.sin(t * Math.PI) * 0.5);
      const root = onBack(x, side * 1.5, 0.99);
      parts.push(...horn([
        { p: [root[0], root[1], root[2] * 0.94], r: 0.36 },
        { p: [root[0] - 0.15, root[1] - 0.15, root[2] + side * len * 0.6], r: 0.21 },
        { p: [root[0] - 0.3, root[1] - 0.3, root[2] + side * len], r: 0.0 },
      ], armorHex, s));
    }
  }

  // --- tail and club -----------------------------------------------------------------
  // The last third of the tail is a HANDLE: the vertebrae are fused and wrapped in bone, so
  // it gets banded rings rather than smooth hide, and the club on the end is three fused
  // knobs rather than one ball.
  parts.push(...limb(hideHex, s, [
    { p: [-6.5, 3.1, 0], r: 2.0 },
    { p: [-8.2, 3.2, 0], r: 1.5 },
    { p: [-9.8, 3.2, 0], r: 1.1 },
    { p: [-11.4, 3.1, 0], r: 0.85 },
    { p: [-12.8, 3.0, 0], r: 0.72 },
  ], { options: { tubularSegments: 24, radialSegments: 20 } }));
  for (let i = 0; i < 6; i++) {
    const x = -9.4 - i * 0.62;
    parts.push(bandRing(0.95 - i * 0.04, 0.13, armorDark, [x, 3.05, 0], 0.02, s, 18));
  }
  const clubKnobs = [[1.5, -14.0, 2.95, 0], [1.15, -13.1, 3.0, 1.05], [1.15, -13.1, 3.0, -1.05], [0.7, -15.0, 2.85, 0]];
  for (const [r, x, y, z] of clubKnobs) {
    const knob = roughenSphere(new THREE.SphereGeometry(r * s, 20, 12), { amount: 0.16, flatten: 0.9, phase: r * 3 });
    knob.translate(x * s, y * s, z * s);
    parts.push({ geometry: knob, color: armorHex });
  }
  for (const side of [-1, 1]) {
    parts.push(...horn([
      { p: [-14.0, 2.95, side * 1.3], r: 0.35 },
      { p: [-14.4, 2.9, side * 1.9], r: 0.2 },
      { p: [-14.7, 2.85, side * 2.35], r: 0.0 },
    ], armorHex, s));
  }

  // --- legs --------------------------------------------------------------------------
  // Four short stumpy pillars with broad splayed feet. The forelimbs are shorter than the
  // hind, which tips the whole animal slightly nose-down.
  for (const side of [-1, 1]) {
    for (const [x, len, rad] of [[4.0, 2.2, 1.4], [-3.8, 2.5, 1.55]]) {
      parts.push(ball(rad * 1.1, hideHex, [x, 3.0, side * 2.4], s, 18));
      parts.push(...limb(hideHex, s, [
        { p: [x, 3.0, side * 2.6], r: rad },
        { p: [x, 3.0 - len * 0.5, side * 2.8], r: rad * 0.82 },
        { p: [x, 3.0 - len, side * 2.9], r: rad * 0.72 },
      ], { options: { tubularSegments: 14, radialSegments: 20 } }));
      const pad = blob(rad * 0.85, hideHex, [x, 3.0 - len - 0.25, side * 2.9], s, 16);
      scaleAbout(pad.geometry, [0, 0, 0], [1.2, 0.55, 1.3]);
      parts.push(pad);
      for (let t = 0; t < 4; t++) {
        const spread = (t - 1.5) * 0.42;
        parts.push(...limb(hideHex, s, [
          { p: [x + 0.2, 3.0 - len - 0.28, side * 2.9 + spread], r: 0.26 },
          { p: [x + 0.85, 3.0 - len - 0.34, side * 2.9 + spread * 1.2], r: 0.2 },
        ], { capStart: false, options: SEG_SMALL }));
        detail.push(scute(0.2, 0.16, BONE, [x + 1.05, 3.0 - len - 0.36, side * 2.9 + spread * 1.3], [0, 0, -0.5], s, 8));
      }
    }
  }

  return creature(parts, seed, {
    detail,
    tint: hideTint({ low: 1.4 * s, high: 4.1 * s, belly: bellyHex, dapple: 0.05, seed: 3.1 }),
  });
}

// ---------------------------------------------------------------------------
// Edmontosaurus
// ---------------------------------------------------------------------------

// The duck-billed plant-eater T. rex actually ate: Edmontosaurus fossils have been
// found with healed T. rex bite marks, which is how we know some of them got away.
// Browsing on all fours here -- these animals could rear up on two legs to run.
export function edmontosaurus({ scale = 1, hide = 0xa89873, stripe = 0x7a6b45, seed = 11 } = {}) {
  const s = scale;
  const rng = seededRandom(seed);
  const parts = [];
  const detail = [];

  const base = new THREE.Color(hide);
  const hideHex = base.getHex();
  const bellyHex = base.clone().offsetHSL(0.02, -0.05, 0.15).getHex();
  const stripeHex = new THREE.Color(stripe).getHex();
  const crestHex = new THREE.Color(0xa8564a).getHex();
  const nailHex = 0x4a4238;

  // --- torso -------------------------------------------------------------------------
  const body = tube(
    [[-7, 9.4, 0], [-4.5, 10.05, 0], [-2, 10.4, 0], [0.5, 10.5, 0], [3, 10.4, 0], [5.4, 10.0, 0], [7.5, 9.4, 0]],
    [2.3, 2.85, 3.1, 3.15, 3.0, 2.6, 2.1],
    hideHex, s, SEG_FINE
  );
  scaleAbout(body.geometry, [0, 10.2 * s, 0], [1, 1.05, 0.92]);
  parts.push(body);

  const edBelly = tube([[-6, 8.6, 0], [-2, 8.7, 0], [0, 8.8, 0], [3, 8.95, 0], [6, 9.0, 0]], [2.1, 2.6, 2.8, 2.6, 2.1], bellyHex, s, { tubularSegments: 26, radialSegments: 20 });
  scaleAbout(edBelly.geometry, [0, 8.8 * s, 0], [1, 0.64, 1]);
  parts.push(edBelly);
  const hipMass = blob(2.9, hideHex, [-4.4, 9.9, 0], s, 20);
  scaleAbout(hipMass.geometry, [0, 0, 0], [1.1, 1.0, 1.0]);
  parts.push(hipMass);

  // --- neck and head -----------------------------------------------------------------
  // Long, low reach down to the bill -- a browser's neck, not a hunter's strike.
  parts.push(...limb(hideHex, s, [
    { p: [7.5, 9.4, 0], r: 2.1 },
    { p: [9.2, 9.3, 0], r: 1.8 },
    { p: [10.7, 9.0, 0], r: 1.55 },
    { p: [12.1, 8.3, 0], r: 1.25 },
    { p: [13.2, 7.6, 0], r: 1.05 },
  ], { options: SEG_FINE }));

  // THE BILL is the animal. Broad, flat and squared off, with a hooked upper edge -- a
  // cropping tool, and nothing else in this world has one. Built as a wide flattened tube
  // with a separate lower jaw, so the mouth is a line rather than a moulded lump.
  const bill = tube([[13.2, 7.6, 0], [14.3, 7.15, 0], [15.4, 6.85, 0], [16.6, 6.7, 0]], [1.05, 0.95, 0.85, 0.62], hideHex, s, { tubularSegments: 20, radialSegments: 22 });
  scaleAbout(bill.geometry, [15.2 * s, 7.0 * s, 0], [1, 0.58, 1.55]);
  parts.push(bill);
  // The horny cropping edge, upper and lower, in beak rather than hide.
  const upperEdge = tube([[15.0, 6.75, 0], [15.9, 6.6, 0], [16.9, 6.55, 0]], [0.55, 0.5, 0.36], BONE, s, { tubularSegments: 14, radialSegments: 16 });
  scaleAbout(upperEdge.geometry, [16 * s, 6.62 * s, 0], [1, 0.4, 1.75]);
  parts.push(upperEdge);
  parts.push(ball(0.36, BONE, [16.9, 6.55, 0], s, 12));
  const lowerJaw = tube([[13.4, 6.85, 0], [14.6, 6.45, 0], [15.8, 6.25, 0], [16.7, 6.25, 0]], [0.85, 0.72, 0.58, 0.4], hideHex, s, { tubularSegments: 16, radialSegments: 18 });
  scaleAbout(lowerJaw.geometry, [15.2 * s, 6.4 * s, 0], [1, 0.55, 1.35]);
  parts.push(lowerJaw);
  parts.push(ball(0.4, hideHex, [16.7, 6.25, 0], s, 12));

  // A soft fleshy comb on the crown. Edmontosaurus regalis was found in 2013 with exactly
  // this preserved -- a cockscomb of skin, not bone -- which is why it is here and why it is
  // a different colour from the hide.
  const comb = blob(1.0, crestHex, [0, 0, 0], s, 18);
  scaleAbout(comb.geometry, [0, 0, 0], [1.25, 0.62, 0.3]);
  comb.geometry.rotateZ(0.22);
  comb.geometry.translate(12.6 * s, 9.2 * s, 0);
  parts.push(comb);

  for (const side of [-1, 1]) {
    parts.push(blob(0.34, stripeHex, [13.2, 8.3, side * 1.05], s, 14));
    detail.push(blob(0.2, 0x9c8850, [13.3, 8.32, side * 1.16], s, 12));
    detail.push(blob(0.1, EYE, [13.36, 8.33, side * 1.24], s, 10));
    // The nostril, big and set well back in a deep basin -- hadrosaurs had huge nasal
    // passages, which is very likely how they made noise.
    parts.push(scute(0.3, 0.14, stripeHex, [14.4, 7.5, side * 0.72], [0, 0, 0.3], s, 12));
  }

  // --- tail --------------------------------------------------------------------------
  // Deep and flattened side to side; it counterbalances the whole front half.
  const tail = tube(
    [[-7, 9.4, 0], [-9.2, 9.35, 0], [-11.5, 9.2, 0], [-13.8, 8.85, 0], [-16, 8.4, 0], [-18, 8.0, 0], [-20, 7.6, 0]],
    [2.3, 2.05, 1.8, 1.4, 1.0, 0.55, 0.12],
    hideHex, s, { tubularSegments: 34, radialSegments: 22 }
  );
  scaleAbout(tail.geometry, [-13 * s, 9 * s, 0], [1, 1.28, 0.7]);
  parts.push(tail);

  // OSSIFIED TENDONS: a lattice of bony rods along the spine over the hips and tail, which is
  // what held that tail out straight. They are one of the most distinctive things in a
  // hadrosaur skeleton and they show as a ridge under the skin.
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = 2.5 - t * 18;
    const y = 11.9 - t * 2.6 + Math.sin(t * 3.1) * 0.16;
    const r = 0.2 - t * 0.1;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(r * s, r * s, 1.5 * s, 8),
        rotation: [0, 0, 1.35],
        position: [x * s, y * s, side * 0.24 * s],
        color: stripeHex,
      });
    }
  }

  // A midline frill of small soft spines from the shoulders to the tail tip -- also from
  // preserved skin, and the reason a hadrosaur silhouette is not a smooth arc.
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = 6 - t * 24;
    const y = 12.05 - Math.pow(Math.abs(t - 0.15) * 1.15, 1.6) * 4.4;
    const h = 0.42 * (1 - t * 0.55);
    parts.push(...spike(h, h * 0.42, stripeHex, [x, y, 0], [0, 0, -0.25], s, { sides: 8 }));
  }

  // --- legs --------------------------------------------------------------------------
  // Browsing on all fours -- these animals could rear up on two legs to run. The hind limb
  // is a pillar with three hoofed toes; the forelimb is much lighter and ends in a MITTEN,
  // the fused hoof-pad hadrosaurs walked on.
  for (const side of [-1, 1]) {
    parts.push(ball(2.3, hideHex, [-3.2, 9.6, side * 2.2], s, 20));
    parts.push(...limb(hideHex, s, [
      { p: [-3.2, 9.6, side * 2.4], r: 2.1 },
      { p: [-3.0, 7.2, side * 2.7], r: 1.55 },
      { p: [-3.2, 5.0, side * 2.8], r: 1.1 },
      { p: [-3.5, 2.6, side * 2.8], r: 0.85 },
      { p: [-3.4, 1.2, side * 2.8], r: 0.8 },
    ], { options: { tubularSegments: 18, radialSegments: 20 } }));
    const rearPad = blob(1.0, hideHex, [-3.3, 0.75, side * 2.8], s, 16);
    scaleAbout(rearPad.geometry, [0, 0, 0], [1.2, 0.6, 1.15]);
    parts.push(rearPad);
    for (const spread of [-0.62, 0, 0.62]) {
      parts.push(...limb(hideHex, s, [
        { p: [-3.1, 0.7, side * 2.8 + spread], r: 0.36 },
        { p: [-2.35, 0.55, side * 2.8 + spread * 1.25], r: 0.28 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(scute(0.3, 0.24, nailHex, [-2.05, 0.48, side * 2.8 + spread * 1.35], [0, 0, 0.5], s, 10));
    }

    parts.push(ball(1.5, hideHex, [5.0, 8.8, side * 2.0], s, 18));
    parts.push(...limb(hideHex, s, [
      { p: [5.0, 8.8, side * 2.2], r: 1.3 },
      { p: [5.7, 6.6, side * 2.4], r: 0.95 },
      { p: [5.5, 4.6, side * 2.5], r: 0.72 },
      { p: [5.2, 2.4, side * 2.5], r: 0.58 },
      { p: [5.2, 1.0, side * 2.5], r: 0.52 },
    ], { options: { tubularSegments: 18, radialSegments: 18 } }));
    // The mitten: one broad fused pad rather than toes.
    const mitten = blob(0.8, hideHex, [5.3, 0.6, side * 2.5], s, 16);
    scaleAbout(mitten.geometry, [0, 0, 0], [1.15, 0.6, 1.05]);
    parts.push(mitten);
    detail.push(scute(0.42, 0.3, nailHex, [5.85, 0.42, side * 2.5], [0, 0, 0.55], s, 12));
  }

  return creature(parts, seed, {
    detail,
    tint: hideTint({ low: 8.0 * s, high: 12.0 * s, belly: bellyHex, dapple: 0.075, seed: 4.3 }),
  });
}

// ---------------------------------------------------------------------------
// Pachycephalosaurus
// ---------------------------------------------------------------------------

// Only about 6ft at the hip, so this one is roughly eye-to-eye with a student -- which
// is exactly why it is worth having. The skull roof is up to 10 INCHES of solid bone.
export function pachycephalosaurus({ scale = 1, hide = 0x9c7c53, dome = 0xd0b98b } = {}) {
  const s = scale;
  const rng = seededRandom(23);
  const parts = [];
  const detail = [];

  const base = new THREE.Color(hide);
  const hideHex = base.getHex();
  const bellyHex = base.clone().offsetHSL(0.02, -0.06, 0.16).getHex();
  const domeHex = new THREE.Color(dome).getHex();
  const domeDark = new THREE.Color(dome).offsetHSL(-0.01, 0.05, -0.14).getHex();

  // --- torso -------------------------------------------------------------------------
  // Only about 6ft at the hip, so this one is roughly eye-to-eye with a student -- which is
  // exactly why it is worth having.
  const body = tube([[-2.5, 5.6, 0], [-1, 5.9, 0], [0.5, 6.0, 0], [2.1, 5.85, 0], [3.5, 5.6, 0]], [1.1, 1.4, 1.5, 1.42, 1.1], hideHex, s, SEG_FINE);
  scaleAbout(body.geometry, [0.5 * s, 5.9 * s, 0], [1, 1.05, 0.94]);
  parts.push(body);
  const belly = tube([[-1.8, 5.1, 0], [0.5, 5.1, 0], [2.8, 5.15, 0]], [0.95, 1.25, 0.95], bellyHex, s, { tubularSegments: 20, radialSegments: 18 });
  scaleAbout(belly.geometry, [0.5 * s, 5.1 * s, 0], [1, 0.62, 1]);
  parts.push(belly);

  // Neck, rising to carry the head above the shoulders.
  parts.push(...limb(hideHex, s, [
    { p: [3.5, 5.6, 0], r: 1.02 },
    { p: [4.4, 6.0, 0], r: 0.9 },
    { p: [5.3, 6.32, 0], r: 0.78 },
    { p: [6.4, 6.48, 0], r: 0.68 },
  ], { options: { tubularSegments: 20, radialSegments: 22 } }));

  // --- the head ----------------------------------------------------------------------
  // The skull roof is up to TEN INCHES of solid bone, and the dome is most of the animal's
  // identity -- so it is built as a mass in its own right rather than as a lump on a snout,
  // and it carries the full ring of knobs a real one has.
  const skull = tube([[6.4, 6.48, 0], [7.3, 6.45, 0], [8.2, 6.28, 0], [9.1, 6.0, 0]], [0.75, 0.68, 0.55, 0.3], hideHex, s, { tubularSegments: 18, radialSegments: 20 });
  scaleAbout(skull.geometry, [7.8 * s, 6.35 * s, 0], [1, 0.92, 0.9]);
  parts.push(skull);
  // The beak.
  const beak = blob(0.34, BONE, [9.25, 5.95, 0], s, 14);
  scaleAbout(beak.geometry, [0, 0, 0], [0.9, 0.7, 0.85]);
  parts.push(beak);

  const domeMass = blob(1.05, domeHex, [0, 0, 0], s, 26);
  scaleAbout(domeMass.geometry, [0, 0, 0], [1.15, 0.95, 1.0]);
  domeMass.geometry.translate(7.25 * s, 7.05 * s, 0);
  parts.push(domeMass);

  // Knobs: a full ring round the back and sides of the dome, plus the two rows of nasal
  // bosses along the snout. On a real skull these are dozens of small tubercles, and it is
  // the ring of them that makes the dome read as bone rather than as a bald patch.
  for (let i = 0; i < 15; i++) {
    const a = -1.5 + (i / 14) * 3.0;
    parts.push(...spike(0.4, 0.17, domeDark,
      [6.35 - Math.abs(Math.sin(a)) * 0.12, 7.05 + Math.cos(a) * 0.92, Math.sin(a) * 1.0],
      [a, 0, 0.55], s, { sides: 8 }));
  }
  for (const side of [-1, 1]) {
    // The two long squamosal spikes at the back corners of the skull.
    parts.push(...horn([
      { p: [6.5, 6.6, side * 0.82], r: 0.24 },
      { p: [6.05, 6.5, side * 1.12], r: 0.15 },
      { p: [5.75, 6.42, side * 1.36], r: 0.0 },
    ], domeDark, s));
    for (let i = 0; i < 4; i++) {
      const r = 0.13 - i * 0.015;
      parts.push(scute(r, r * 0.9, domeDark, [7.9 + i * 0.42, 6.5 - i * 0.1, side * (0.5 - i * 0.06)], null, s, 8));
    }
    parts.push(blob(0.2, domeDark, [8.15, 6.35, side * 0.52], s, 12));
    detail.push(blob(0.12, EYE, [8.22, 6.36, side * 0.6], s, 10));
  }

  // --- tail --------------------------------------------------------------------------
  // Long and held stiffly out: pachycephalosaurs had a basket of interwoven tendons along
  // the tail, so it did not hang.
  parts.push(...limb(hideHex, s, [
    { p: [-2.5, 5.6, 0], r: 1.08 },
    { p: [-4.3, 5.55, 0], r: 0.88 },
    { p: [-6.2, 5.4, 0], r: 0.66 },
    { p: [-8.0, 5.15, 0], r: 0.42 },
    { p: [-9.8, 4.85, 0], r: 0.0 },
  ], { capEnd: false, options: { tubularSegments: 26, radialSegments: 20 } }));
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const x = -2.8 - t * 6.4;
    const r = 0.16 - t * 0.09;
    parts.push(scute(r, r * 1.4, hideHex, [x, 6.3 - t * 0.7, 0], null, s, 8));
  }

  // --- legs --------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    parts.push(ball(1.15, hideHex, [0.2, 5.2, side * 1.05], s, 18));
    parts.push(...limb(hideHex, s, [
      { p: [0.2, 5.2, side * 1.2], r: 1.0 },
      { p: [0.6, 3.4, side * 1.35], r: 0.62 },
      { p: [-0.2, 1.9, side * 1.4], r: 0.4 },
      { p: [0.35, 0.75, side * 1.4], r: 0.3 },
    ], { options: { tubularSegments: 16, radialSegments: 18 } }));
    for (const spread of [-0.28, 0, 0.28]) {
      parts.push(...limb(hideHex, s, [
        { p: [0.4, 0.6, side * 1.4 + spread], r: 0.19 },
        { p: [1.0, 0.4, side * 1.4 + spread * 1.3], r: 0.13 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(...spike(0.3, 0.08, CLAW, [1.22, 0.34, side * 1.4 + spread * 1.4], [0, 0, -Math.PI / 2 - 0.4], s, { sides: 8 }));
    }
    // A real little hand: five short fingers on a light forelimb.
    parts.push(ball(0.42, hideHex, [3.2, 5.2, side * 0.9], s, 14));
    parts.push(...limb(hideHex, s, [
      { p: [3.2, 5.2, side * 1.0], r: 0.35 },
      { p: [4.0, 3.95, side * 1.2], r: 0.24 },
      { p: [4.5, 3.1, side * 1.25], r: 0.19 },
    ], { options: { tubularSegments: 12, radialSegments: 16 } }));
    for (let f = 0; f < 5; f++) {
      const spread = (f - 2) * 0.13;
      parts.push(...limb(hideHex, s, [
        { p: [4.55, 3.0, side * 1.25 + spread], r: 0.1 },
        { p: [4.85, 2.65, side * 1.25 + spread * 1.2], r: 0.07 },
      ], { capStart: false, options: SEG_SMALL }));
    }
    void rng;
  }

  return creature(parts, 23, {
    detail,
    tint: hideTint({ low: 4.6 * s, high: 7.4 * s, belly: bellyHex, dapple: 0.08, seed: 5.1 }),
  });
}

// ---------------------------------------------------------------------------
// Quetzalcoatlus
// ---------------------------------------------------------------------------

// A pterosaur, NOT a dinosaur -- a distinction the placard under it makes, because it
// is the single most common mix-up in the room. Wingspan about 33ft, which is wider
// than a small plane, and it walked on all fours like a giant folded umbrella.
//
// The wing membranes are flat ShapeGeometry sheets: a membrane has no thickness, and
// building one out of tubes would give it the look of a inflatable pool toy.
export function quetzalcoatlus({ scale = 1, hide = 0xd6cfbe, wing = 0x9d8f7a } = {}) {
  const s = scale;
  const parts = [];
  const detail = [];

  const base = new THREE.Color(hide);
  const hideHex = base.getHex();
  const underHex = base.clone().offsetHSL(0.01, -0.03, 0.08).getHex();
  const wingHex = new THREE.Color(wing).getHex();
  const wingDark = new THREE.Color(wing).offsetHSL(0, 0.02, -0.1).getHex();
  const crestHex = new THREE.Color(0xb2543f).getHex();

  // A pterosaur, NOT a dinosaur -- a distinction the placard under it makes, because it is the
  // single most common mix-up in the room. Wingspan about 33ft, which is wider than a small
  // plane, and it walked on all fours like a giant folded umbrella.

  // --- body --------------------------------------------------------------------------
  // Compact and deep-chested: nearly all of a pterosaur's mass is the flight muscle between
  // the shoulders, and the body is short because the neck and the wings are doing the work.
  const body = tube([[-2.2, 0, 0], [-1.0, 0.2, 0], [0, 0.3, 0], [1.2, 0.28, 0], [2.4, 0.1, 0]], [0.9, 1.32, 1.5, 1.35, 1.1], hideHex, s, SEG_FINE);
  scaleAbout(body.geometry, [0, 0.2 * s, 0], [1, 1.0, 0.86]);
  parts.push(body);
  const keel = tube([[-1.4, -0.5, 0], [0.2, -0.55, 0], [1.9, -0.4, 0]], [0.8, 1.0, 0.75], underHex, s, { tubularSegments: 20, radialSegments: 18 });
  scaleAbout(keel.geometry, [0.2 * s, -0.5 * s, 0], [1, 0.7, 0.8]);
  parts.push(keel);

  // --- neck and head -----------------------------------------------------------------
  // An azhdarchid neck is long, THICK and stiff -- the vertebrae are enormous and barely
  // flexed. It is not a swan's neck, and giving it a smooth S-curve is the commonest way to
  // get this animal wrong.
  parts.push(...limb(hideHex, s, [
    { p: [2.4, 0.1, 0], r: 0.95 },
    { p: [3.6, 0.55, 0], r: 0.82 },
    { p: [4.8, 1.0, 0], r: 0.72 },
    { p: [5.8, 1.28, 0], r: 0.62 },
    { p: [6.4, 1.4, 0], r: 0.56 },
  ], { options: SEG_FINE }));

  // The head: a long, straight, TOOTHLESS beak, and it is nearly as long as the neck.
  const skull = tube([[6.4, 1.4, 0], [7.6, 1.42, 0], [8.8, 1.3, 0]], [0.6, 0.5, 0.4], hideHex, s, { tubularSegments: 18, radialSegments: 20 });
  scaleAbout(skull.geometry, [7.6 * s, 1.4 * s, 0], [1, 1.1, 0.85]);
  parts.push(skull);
  const upperBill = tube([[8.6, 1.32, 0], [10.4, 1.1, 0], [12.2, 0.72, 0], [13.4, 0.42, 0]], [0.42, 0.3, 0.18, 0.05], hideHex, s, { tubularSegments: 22, radialSegments: 18 });
  scaleAbout(upperBill.geometry, [10.8 * s, 0.95 * s, 0], [1, 0.9, 0.7]);
  parts.push(upperBill);
  const lowerBill = tube([[8.5, 0.95, 0], [10.3, 0.72, 0], [12.0, 0.4, 0], [13.1, 0.16, 0]], [0.34, 0.24, 0.14, 0.04], underHex, s, { tubularSegments: 20, radialSegments: 16 });
  scaleAbout(lowerBill.geometry, [10.6 * s, 0.6 * s, 0], [1, 0.7, 0.62]);
  parts.push(lowerBill);

  // The crest: a thin blade of bone and keratin standing up off the back of the skull. Built
  // as a flattened lens rather than a triangular prism, so it has a rounded leading edge and
  // no open rim where it enters the head.
  const crest = blob(1.45, crestHex, [0, 0, 0], s, 22);
  scaleAbout(crest.geometry, [0, 0, 0], [1.0, 0.78, 0.085]);
  crest.geometry.rotateZ(0.34);
  crest.geometry.translate(7.4 * s, 2.5 * s, 0);
  parts.push(crest);

  for (const side of [-1, 1]) {
    parts.push(blob(0.24, hideHex, [7.0, 1.7, side * 0.48], s, 12));
    detail.push(blob(0.14, 0xc9b17a, [7.06, 1.72, side * 0.56], s, 10));
    detail.push(blob(0.07, EYE, [7.1, 1.72, side * 0.61], s, 8));
  }

  for (const side of [-1, 1]) {
    // --- the wing skeleton ----------------------------------------------------------
    // Upper arm, forearm, then the single ENORMOUS fourth finger that carries the whole
    // outer wing -- that one bone is what a pterosaur wing is, and it is longer than the rest
    // of the animal put together.
    const spar = [
      { p: [1.4, 0.5, side * 1.0], r: 0.56 },
      { p: [0.9, 0.85, side * 3.2], r: 0.46 },
      { p: [0.4, 1.0, side * 5.5], r: 0.4 },
      { p: [0.75, 1.12, side * 8.0], r: 0.34 },
      { p: [1.0, 1.2, side * 10.5], r: 0.3 },
      { p: [0.2, 1.05, side * 13.5], r: 0.2 },
      { p: [-1.5, 0.8, side * 16.5], r: 0.075 },
    ];
    parts.push(...limb(hideHex, s, spar, { capEnd: false, options: { tubularSegments: 20, radialSegments: 16 } }));
    // The pteroid -- a small forward-pointing strut unique to pterosaurs, which held the
    // leading edge of the inner membrane taut.
    parts.push(...limb(hideHex, s, [
      { p: [1.5, 0.6, side * 1.1], r: 0.16 },
      { p: [2.5, 0.55, side * 1.5], r: 0.08 },
    ], { options: { tubularSegments: 10, radialSegments: 12 } }));
    // Three small clawed fingers at the wrist, which is what it walked on.
    for (let f = 0; f < 3; f++) {
      const zz = side * (5.2 + f * 0.3);
      parts.push(...limb(hideHex, s, [
        { p: [0.5, 0.95, zz], r: 0.13 },
        { p: [1.4, 0.6, zz + side * 0.4], r: 0.09 },
      ], { capStart: false, options: SEG_SMALL }));
      detail.push(...spike(0.5, 0.07, CLAW, [1.85, 0.42, zz + side * 0.55], [0, 0, -Math.PI / 2 - 0.5], s, { sides: 8 }));
    }

    // --- the membrane ---------------------------------------------------------------
    // A CAMBERED SHEET built as a grid, not a flat polygon. This is the biggest single
    // change to this animal: a ShapeGeometry membrane is dead flat, so it reads as a paper
    // cut-out and it goes completely invisible edge-on. A real wing has camber -- it sags
    // between the spar and the trailing edge and curls up at the tip -- and 18 x 6 quads is
    // enough to show it. The surface is closed at every border by construction because it is
    // one continuous grid.
    const NU = 20;
    const NV = 7;
    const positions = [];
    const indices = [];
    const normals = [];
    const uvs = [];
    // The leading edge follows the spar; the trailing edge runs from the hip out to the tip.
    const lead = (u) => {
      const i = Math.min(spar.length - 2, Math.floor(u * (spar.length - 1)));
      const f = u * (spar.length - 1) - i;
      const a = spar[i].p;
      const b = spar[i + 1].p;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    };
    const trail = (u) => [
      -2.6 - u * 1.6 + Math.pow(u, 2.6) * 2.7,
      0.55 - u * 0.05,
      side * (1.6 + u * 15.0),
    ];
    for (let iu = 0; iu <= NU; iu++) {
      const u = iu / NU;
      const L = lead(u);
      const T = trail(u);
      for (let iv = 0; iv <= NV; iv++) {
        const v = iv / NV;
        // Camber: the sheet bows DOWN in the middle of the chord and lifts at the very tip.
        const sag = Math.sin(v * Math.PI) * (0.55 - u * 0.3) * (1 - Math.pow(u, 3));
        const tipLift = Math.pow(u, 4) * 0.9 * Math.sin(v * Math.PI);
        positions.push(
          (L[0] + (T[0] - L[0]) * v) * s,
          (L[1] + (T[1] - L[1]) * v - sag + tipLift) * s,
          (L[2] + (T[2] - L[2]) * v) * s,
        );
        uvs.push(u, v);
        normals.push(0, 1, 0);
      }
    }
    for (let iu = 0; iu < NU; iu++) {
      for (let iv = 0; iv < NV; iv++) {
        const a = iu * (NV + 1) + iv;
        const b = a + NV + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const membrane = new THREE.BufferGeometry();
    membrane.setIndex(indices);
    membrane.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    membrane.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    membrane.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    membrane.computeVertexNormals();
    parts.push({ geometry: membrane, color: wingHex });

    // Actinofibrils: the stiffening fibres fanning through the outer membrane. They are
    // visible in good fossils and they are what stops the wing reading as rubber.
    for (let f = 1; f < 9; f++) {
      const u = 0.18 + (f / 9) * 0.74;
      const L = lead(u);
      const T = trail(u);
      const sag = 0.5 - u * 0.28;
      parts.push(tube(
        [L, [(L[0] + T[0]) / 2, (L[1] + T[1]) / 2 - sag, (L[2] + T[2]) / 2], T],
        [0.055, 0.045, 0.03], wingDark, s, { tubularSegments: 10, radialSegments: 7 }
      ));
    }

    // --- hind limb ------------------------------------------------------------------
    parts.push(...limb(hideHex, s, [
      { p: [-2.0, -0.2, side * 0.9], r: 0.34 },
      { p: [-2.9, -0.9, side * 1.5], r: 0.24 },
      { p: [-3.6, -1.5, side * 1.9], r: 0.18 },
    ], { options: { tubularSegments: 12, radialSegments: 14 } }));
    for (let t = 0; t < 4; t++) {
      const spread = (t - 1.5) * 0.16;
      parts.push(...limb(hideHex, s, [
        { p: [-3.65, -1.55, side * 1.9 + spread], r: 0.1 },
        { p: [-4.2, -1.75, side * 1.95 + spread * 1.3], r: 0.06 },
      ], { capStart: false, options: SEG_SMALL }));
    }
  }

  return creature(parts, 29, {
    detail,
    tint: hideTint({ low: -1.0 * s, high: 2.2 * s, belly: underHex, dapple: 0.05, seed: 6.2 }),
  });
}

// ---------------------------------------------------------------------------
// A nest
// ---------------------------------------------------------------------------

// Dinosaurs built nests, sat on them, and looked after what hatched. That behaviour is
// one of the strongest links between them and the birds outside the window.
export function dinoNest({ radius = 4.5, eggs = 7, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  // Rim of scraped earth and trampled plant matter.
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2;
    parts.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.55, 0.85), 9, 6),
      position: [Math.cos(angle) * radius, randomIn(rng, 0.25, 0.5), Math.sin(angle) * radius],
      color: [0x4b3a26, 0x5c4a30, 0x3f3120][Math.floor(rng() * 3)],
    });
  }
  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 0.95, radius * 1.05, 0.3, 24),
    position: [0, 0.15, 0],
    color: 0x4a3b28,
  });

  const shell = 0xd9cdae;
  for (let i = 0; i < eggs; i++) {
    const angle = (i / eggs) * Math.PI * 2 + 0.4;
    const distance = radius * randomIn(rng, 0.25, 0.6);
    const egg = new THREE.SphereGeometry(0.85, 14, 10);
    egg.scale(1, 1.45, 1);
    parts.push({
      geometry: egg,
      rotation: [randomIn(rng, -0.5, 0.5), 0, randomIn(rng, -0.5, 0.5)],
      position: [Math.cos(angle) * distance, 0.95, Math.sin(angle) * distance],
      color: shell,
    });
  }

  const g = group(mergedMesh(parts, { roughness: 0.95 }));

  // One egg has hatched. The hatchling is a quarter-scale animal, which is a size
  // comparison a student gets instantly by standing next to both.
  const hatchling = tyrannosaurus({ scale: 0.11 });
  hatchling.position.set(radius * 0.15, 0.6, -radius * 0.3);
  hatchling.rotation.y = 2.1;
  g.add(hatchling);

  return g;
}

// ---------------------------------------------------------------------------
// Cretaceous flora
// ---------------------------------------------------------------------------

// One drooping frond, built as a flattened tapered tube so it curves. Shared by the
// tree fern and the cycad.
function frond(length, droop, color, origin, angle, s = 1) {
  const [ox, oy, oz] = origin;
  const points = [];
  const radii = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    points.push([
      ox + Math.cos(angle) * length * t,
      oy + Math.sin(1.1 - t * 1.9) * droop,
      oz + Math.sin(angle) * length * t,
    ]);
    // A generous width that only tapers to a third. The first version narrowed to 15%
    // and every frond in the world read as a black needle rather than as a leaf.
    radii.push(0.95 * (1 - t * 0.68));
  }
  // Deliberately coarse. A frond is a flat blade that gets squashed to 30% thickness
  // two lines below, so radial detail is invisible -- and the ground-fern patches place
  // these by the hundred, where the difference is tens of thousands of triangles.
  // Coarse ON PURPOSE, but not as coarse as it was. A frond is a flat blade squashed to 30%
  // thickness two lines below, so radial detail is nearly invisible -- and the ground-fern
  // patches place these by the hundred. 4 radial sides made the flattened blade a visible
  // diamond in cross-section once smooth shading came in; 6 is round enough and still cheap.
  const geometry = taperedTube(
    points.map(([x, y, z]) => [x * s, y * s, z * s]),
    radii.map((r) => r * s),
    { tubularSegments: 8, radialSegments: 5 }
  );
  // Flattened into a blade. Scaling about the frond's own base keeps it attached to the
  // crown rather than sliding off it.
  scaleAbout(geometry, [ox * s, oy * s, oz * s], [1, 0.3, 1]);
  return { geometry, color };
}

// Tree ferns are the signature plant of this world -- ferns are far older than flowers
// and made up much of the understory a Triceratops would have been eating.
export function treeFern({ height = 14, fronds = 11, seed = 3, leaf = 0x4f7f35 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkColor = 0x5b4a35;

  parts.push({
    geometry: new THREE.CylinderGeometry(0.6, 0.95, height, 10),
    position: [0, height / 2, 0],
    color: trunkColor,
  });
  // Old frond scars spiralling up the trunk -- how a tree fern actually grows.
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const angle = t * 9;
    parts.push({
      geometry: new THREE.ConeGeometry(0.28, 0.5, 10),
      rotation: [0, -angle, -1.2],
      position: [Math.cos(angle) * 0.85, height * (0.15 + t * 0.75), Math.sin(angle) * 0.85],
      color: 0x6b5a41,
    });
  }

  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    const length = height * randomIn(rng, 0.42, 0.6);
    const shade = new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.85, 1.15)).getHex();
    parts.push(frond(length, height * 0.16, shade, [0, height, 0], angle));
  }
  // A tight fiddlehead at the crown -- the new frond, still coiled.
  parts.push({ geometry: new THREE.TorusGeometry(0.55, 0.22, 6, 12), rotation: [0, 0.6, 0], position: [0, height + 0.9, 0], color: leaf });

  return group(mergedMesh(parts, { roughness: 0.9, ...relief('bark', { seed, repeat: 5 }) }));
}

// Cycads look like palms and are not remotely related to them. They were so abundant in
// the Mesozoic that it is sometimes called the Age of Cycads as well as of dinosaurs.
export function cycad({ height = 6, seed = 5, leaf = 0x3f6f30 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const trunk = new THREE.CylinderGeometry(1.1, 1.35, height, 12);
  parts.push({ geometry: trunk, position: [0, height / 2, 0], color: 0x60513a });
  for (let ring = 0; ring < 5; ring++) {
    parts.push({
      geometry: new THREE.TorusGeometry(1.2, 0.16, 5, 14),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, height * (0.12 + ring * 0.18), 0],
      color: 0x6f5f45,
    });
  }

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + rng() * 0.2;
    const shade = new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.85, 1.15)).getHex();
    parts.push(frond(height * randomIn(rng, 0.75, 1.0), height * 0.3, shade, [0, height, 0], angle));
  }

  return group(mergedMesh(parts, { roughness: 0.85, ...relief('bark', { seed, repeat: 4 }) }));
}

// Ginkgo: a living fossil. The tree in a car park today is near-identical to the one a
// Triceratops walked past, which makes it the best "you can go and touch one" prop here.
export function ginkgoTree({ height = 26, seed = 7, leaf = 0x9cbb46 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkColor = 0x6a5540;
  const trunkHeight = height * 0.5;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.028, height * 0.055, trunkHeight, 10), position: [0, trunkHeight / 2, 0], color: trunkColor });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    const lean = randomIn(rng, 0.6, 0.95);
    const limb = height * randomIn(rng, 0.22, 0.32);
    parts.push({
      geometry: new THREE.CylinderGeometry(height * 0.012, height * 0.026, limb, 12),
      rotation: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean],
      position: [Math.cos(angle) * limb * 0.4, trunkHeight + limb * 0.32, Math.sin(angle) * limb * 0.4],
      color: trunkColor,
    });
  }

  // Fan-shaped foliage: wide flat clumps rather than spheres, which is what gives a
  // ginkgo its layered, slightly untidy silhouette.
  const crownY = trunkHeight + height * 0.2;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.8;
    const distance = height * randomIn(rng, 0.1, 0.26);
    const clump = new THREE.IcosahedronGeometry(height * randomIn(rng, 0.11, 0.17), 1);
    clump.scale(1, 0.55, 1);
    parts.push({
      geometry: clump,
      position: [Math.cos(angle) * distance, crownY + randomIn(rng, -0.1, 0.22) * height, Math.sin(angle) * distance],
      color: new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.82, 1.15)).getHex(),
    });
  }

  return group(mergedMesh(parts, { roughness: 0.9, ...relief('bark', { seed, repeat: 5 }) }));
}

// Araucaria -- the monkey-puzzle family. Whorls of branches up a straight trunk give
// the Mesozoic skyline its distinctive stepped shape, and they were what the biggest
// long-necked plant-eaters browsed on.
export function araucariaTree({ height = 40, seed = 9, needle = 0x2f5b34 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bare = height * 0.55;

  parts.push(tube(
    [[0, 0, 0], [0, height * 0.3, 0], [0, height * 0.62, 0], [0, height, 0]],
    [height * 0.042, height * 0.03, height * 0.023, height * 0.015],
    0x5a4a38, 1, { tubularSegments: 12, radialSegments: 14 }
  ));

  // Whorls of branches that SWEEP UP at the tips and carry a sleeve of foliage along their
  // whole length. The first pass hung one flattened detail-0 icosahedron off each branch --
  // twelve visible facets apiece -- so a 40ft tree read as a bundle of paper darts, and at
  // detail 0 there is nothing a smooth-shading material can do about it.
  // SIX WHORLS OF SIX, and the count is a budget decision rather than a taste one. The layout
  // plants twenty-eight of these -- they are the canopy, and the most-seen object in the world
  // -- so their per-tree cost is multiplied by 28 against a whole-world envelope of about 1.5M
  // triangles. The first rebuild went to nine whorls of eight with five foliage puffs each and
  // came out at 61k a tree: 1.71M triangles in background conifers, more than everything else
  // in the world put together, with the six animals it is a backdrop for taking up 22% of it.
  // Five by five with three puffs comes to ~10k, which is ~0.27M for the whole forest -- and
  // still eight times the detail the old faceted version had, with a real branch sweep it
  // never had at all. THE ANIMALS ARE WHERE THIS WORLD SPENDS: six of them at 44k-96k each is
  // 370k, and they are what a student came to look at.
  const whorls = 5;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = bare + t * (height - bare) * 0.95;
    const reach = height * 0.2 * (1 - t * 0.7) + height * 0.03;
    const arms = 5;
    for (let i = 0; i < arms; i++) {
      const angle = (i / arms) * Math.PI * 2 + w * 0.42;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      // The branch itself, swept so it leaves the trunk level and lifts at the tip -- the
      // upcurved candelabra branch is the whole silhouette of this tree.
      const nodes = [];
      for (let k = 0; k <= 3; k++) {
        const f = k / 3;
        nodes.push([dx * reach * f, y + Math.pow(f, 2.2) * reach * 0.42 - f * 0.06 * reach, dz * reach * f]);
      }
      parts.push(tube(nodes, [height * 0.012, height * 0.009, height * 0.007, height * 0.005], 0x5a4a38, 1, { tubularSegments: 8, radialSegments: 6 }));
      // Foliage as a sleeve of overlapping scaled spheres along the branch, which is what
      // makes an araucaria branch look like a rope of spiky leaves.
      for (let k = 1; k <= 3; k++) {
        const f = k / 3;
        const rad = reach * (0.17 + f * 0.09) * randomIn(rng, 0.9, 1.15);
        const puff = new THREE.SphereGeometry(rad, 8, 5);
        puff.scale(1, 0.72, 1);
        puff.translate(dx * reach * f, y + Math.pow(f, 2.2) * reach * 0.42 - f * 0.06 * reach, dz * reach * f);
        parts.push({ geometry: puff, color: new THREE.Color(needle).multiplyScalar(randomIn(rng, 0.86, 1.16)).getHex() });
      }
    }
  }
  // The crown: a spire of stacked cones rather than one, so the top of the tree tapers.
  for (let k = 0; k < 3; k++) {
    const f = k / 2;
    parts.push({
      geometry: new THREE.ConeGeometry(height * (0.075 - f * 0.045), height * 0.12, 14),
      position: [0, height * (0.97 + f * 0.075), 0],
      color: needle,
    });
  }

  return group(mergedMesh(parts, { roughness: 0.92, ...relief('bark', { seed, repeat: 6 }) }));
}

// Horsetails. The same plant still grows by ditches today, but in the Cretaceous some
// species reached well over head height.
export function horsetailPatch({ count = 26, radius = 5, height = 7, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const stemHeight = height * randomIn(rng, 0.6, 1.15);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.09, 0.13, stemHeight, 12),
      position: [x, stemHeight / 2, z],
      color: 0x6f9243,
    });
    // Whorls of fine branchlets at each joint -- the giveaway feature of a horsetail.
    const joints = Math.max(2, Math.round(stemHeight / 1.4));
    for (let j = 1; j <= joints; j++) {
      const y = (j / (joints + 1)) * stemHeight;
      const ring = new THREE.ConeGeometry(0.5, 0.7, 6, 1, true);
      parts.push({ geometry: ring, rotation: [Math.PI, 0, 0], position: [x, y, z], color: 0x86a94f });
    }
    parts.push({ geometry: new THREE.ConeGeometry(0.16, 0.6, 10), position: [x, stemHeight + 0.3, z], color: 0xa8b25c });
  }

  return group(mergedMesh(parts, { roughness: 0.9 }));
}

// Low ground ferns, in a merged clump.
export function fernPatch({ count = 14, radius = 5, seed = 13, leaf = 0x3e7331 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const size = randomIn(rng, 1.4, 2.6);
    for (let f = 0; f < 6; f++) {
      const spread = (f / 6) * Math.PI * 2 + rng();
      parts.push(
        frond(size, size * 0.5, new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.8, 1.2)).getHex(), [x, 0.4, z], spread)
      );
    }
  }

  return group(mergedMesh(parts, { roughness: 0.9 }));
}

// Magnolia. Flowering plants were brand new in the Cretaceous -- T. rex lived alongside
// the very first flowers, and magnolias are among the oldest kinds still around.
export function magnoliaShrub({ height = 9, seed = 17, leaf = 0x35662e, petal = 0xf4ecdc } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.45, height * 0.45, 16), position: [0, height * 0.22, 0], color: 0x5c4a36 });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + rng() * 0.4;
    const distance = height * randomIn(rng, 0.14, 0.26);
    parts.push({
      geometry: new THREE.IcosahedronGeometry(height * randomIn(rng, 0.16, 0.24), 1),
      position: [Math.cos(angle) * distance, height * randomIn(rng, 0.5, 0.75), Math.sin(angle) * distance],
      color: new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.82, 1.15)).getHex(),
    });
  }
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.7;
    const distance = height * randomIn(rng, 0.16, 0.3);
    const y = height * randomIn(rng, 0.55, 0.9);
    for (let p = 0; p < 5; p++) {
      const petalAngle = (p / 5) * Math.PI * 2;
      const blade = new THREE.SphereGeometry(0.38, 12, 8);
      blade.scale(1, 0.28, 0.6);
      parts.push({
        geometry: blade,
        rotation: [0, petalAngle, 0.5],
        position: [
          Math.cos(angle) * distance + Math.cos(petalAngle) * 0.32,
          y,
          Math.sin(angle) * distance + Math.sin(petalAngle) * 0.32,
        ],
        color: petal,
      });
    }
    parts.push({ geometry: new THREE.SphereGeometry(0.16, 12, 8), position: [Math.cos(angle) * distance, y + 0.1, Math.sin(angle) * distance], color: 0xe0c86a });
  }

  return group(mergedMesh(parts, { roughness: 0.88 }));
}

// ---------------------------------------------------------------------------
// The field-science site
// ---------------------------------------------------------------------------

function researchBoardTexture() {
  return canvasTexture(900, 620, (ctx, w, h) => {
    ctx.fillStyle = '#20302a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c8b98d';
    ctx.lineWidth = 7;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    ctx.fillStyle = '#f0e6cd';
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillText('WHO IS RELATED TO WHOM?', 48, 86);

    ctx.strokeStyle = '#8fb98a';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#dfe9d6';
    ctx.font = '25px "Helvetica Neue", Arial, sans-serif';

    // A simple cladogram: the branching diagram palaeontologists actually use.
    const trunkX = 90;
    const rows = [
      ['Triceratops', 190],
      ['Ankylosaurus', 262],
      ['Edmontosaurus', 334],
      ['Pachycephalosaurus', 406],
      ['Tyrannosaurus', 478],
      ['Birds — still here', 550],
    ];
    ctx.beginPath();
    ctx.moveTo(trunkX, 150);
    ctx.lineTo(trunkX, rows[rows.length - 1][1]);
    ctx.stroke();
    for (const [label, y] of rows) {
      ctx.beginPath();
      ctx.moveTo(trunkX, y);
      ctx.lineTo(trunkX + 120 + (y % 40), y);
      ctx.stroke();
      ctx.fillText(label, trunkX + 150 + (y % 40), y + 9);
    }

    ctx.fillStyle = '#c8b98d';
    ctx.font = 'italic 24px Georgia, serif';
    ctx.fillText('Pterosaurs are NOT on this tree. They are cousins, not dinosaurs.', 48, h - 48);
  });
}

// An open-sided field camp: thatch over a frame, a research board, work tables and
// crates. Deliberately at ground level and open on every side, so a student walks
// straight through it -- the player moves on the terrain, never on top of props, so a
// raised platform would only be somewhere they could look at and never stand.
export function fieldCamp({ width = 20, depth = 14, postHeight = 9 } = {}) {
  const g = group();
  const timber = standard({ color: 0x7a5c3a, roughness: 0.92, ...relief('wood', { seed: 73, repeat: 6 }) });
  const dark = standard({ color: 0x4b3a26, roughness: 0.9, ...relief('wood', { seed: 79, repeat: 4 }) });
  const thatch = standard({ color: 0xa88b4e, roughness: 1, ...relief('weave', { seed: 83, repeat: 5 }) });

  const structure = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      structure.push({
        geometry: new THREE.CylinderGeometry(0.34, 0.42, postHeight, 9),
        position: [sx * (width / 2 - 0.6), postHeight / 2, sz * (depth / 2 - 0.6)],
        color: 0x7a5c3a,
      });
    }
  }
  for (const sz of [-1, 1]) {
    structure.push({ geometry: new THREE.BoxGeometry(width, 0.4, 0.4), position: [0, postHeight, sz * (depth / 2 - 0.6)], color: 0x6b502f });
  }
  for (const sx of [-1, 1]) {
    structure.push({ geometry: new THREE.BoxGeometry(0.4, 0.4, depth), position: [sx * (width / 2 - 0.6), postHeight, 0], color: 0x6b502f });
  }
  g.add(mergedMesh(structure, { roughness: 0.92 }));

  // Thatched hip roof. It DOES cast shadow -- that shade is the point of the shelter,
  // and the light orbs hung underneath are what make the interior readable.
  const roof = mesh(new THREE.ConeGeometry(width * 0.78, 4.2, 4), thatch, 0, postHeight + 2.1, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = depth / width;
  g.add(roof);
  g.add(box(width * 1.05, 0.35, depth * 1.05, dark, 0, postHeight + 0.25, 0));

  // Research board on the back edge.
  const boardFrame = box(11, 7, 0.3, timber, 0, 4.6, -depth / 2 + 0.4);
  g.add(boardFrame);
  const board = signPanel(10.2, 6.4, researchBoardTexture());
  board.position.set(0, 4.6, -depth / 2 + 0.58);
  g.add(board);

  // Work tables with trays of finds, and a stack of field crates.
  for (const sx of [-1, 1]) {
    const table = [];
    table.push({ geometry: new THREE.BoxGeometry(7, 0.3, 3), position: [sx * 5.5, 2.9, 2.6], color: 0x8a6a44 });
    for (const lx of [-3, 3]) {
      for (const lz of [-1.2, 1.2]) {
        table.push({ geometry: new THREE.BoxGeometry(0.3, 2.9, 0.3), position: [sx * 5.5 + lx, 1.45, 2.6 + lz], color: 0x6b502f });
      }
    }
    for (let i = 0; i < 3; i++) {
      table.push({ geometry: new THREE.BoxGeometry(1.7, 0.3, 1.2), position: [sx * 5.5 - 2 + i * 2, 3.2, 2.6], color: 0xc9bb96 });
    }
    g.add(mergedMesh(table, { roughness: 0.9 }));
  }

  const crates = [];
  for (const [cx, cy, cz, size] of [
    [-7.5, 1.1, -3.5, 2.2],
    [-7.4, 3.3, -3.4, 2.0],
    [-5.0, 1.0, -4.2, 2.0],
    [7.6, 1.2, -3.8, 2.4],
  ]) {
    crates.push({ geometry: new THREE.BoxGeometry(size, size, size), position: [cx, cy, cz], color: 0x8a6a44 });
    crates.push({ geometry: new THREE.BoxGeometry(size * 1.03, 0.2, size * 1.03), position: [cx, cy + size * 0.35, cz], color: 0x5f4830 });
  }
  g.add(mergedMesh(crates, { roughness: 0.9 }));

  return g;
}

// A dig in progress: a pegged-out grid, a partly-freed skeleton, spoil heaps and tools.
// This is the answer to "how does anyone know any of this", which is the most useful
// thing in the world to leave standing next to a 40ft reconstructed animal.
export function fossilDig({ width = 22, depth = 16, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const g = group();

  // Cut floor, a shade lighter than the surrounding ground so the pit reads as a pit.
  const floor = mesh(
    new THREE.BoxGeometry(width, 0.3, depth),
    standard({ color: 0x8d7a58, roughness: 1 }),
    0,
    0.12,
    0
  );
  floor.castShadow = false;
  g.add(floor);

  // Spoil berm around three sides.
  const berm = [];
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const angle = t * Math.PI * 2;
    const rx = width / 2 + 1.1;
    const rz = depth / 2 + 1.1;
    berm.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.8, 1.4), 7, 5),
      position: [Math.cos(angle) * rx, randomIn(rng, 0.2, 0.55), Math.sin(angle) * rz],
      color: [0x5c4a30, 0x6d5941, 0x4a3b28][Math.floor(rng() * 3)],
    });
  }
  g.add(mergedMesh(berm, { roughness: 1 }));

  // The excavation grid: string lines on pegs. This is really how a site is recorded --
  // every bone's position within its square is written down before anything is lifted.
  const grid = [];
  const cols = 4;
  const rows = 3;
  for (let i = 0; i <= cols; i++) {
    const x = -width / 2 + (i * width) / cols;
    grid.push({ geometry: new THREE.BoxGeometry(0.07, 0.07, depth), position: [x, 1.5, 0], color: 0xe8e2cc });
    for (const sz of [-1, 1]) {
      grid.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 1.9, 10), position: [x, 0.95, (sz * depth) / 2], color: 0x8a6a44 });
    }
  }
  for (let i = 0; i <= rows; i++) {
    const z = -depth / 2 + (i * depth) / rows;
    grid.push({ geometry: new THREE.BoxGeometry(width, 0.07, 0.07), position: [0, 1.5, z], color: 0xe8e2cc });
  }
  g.add(mergedMesh(grid, { roughness: 0.8 }));

  // The skeleton itself, half out of the rock: skull, spine, ribs, a hip and a femur.
  //
  // spineY has to clear the trench floor's top face (0.27) by enough that the RIBS read.
  // At 0.55 the ribs swept down to about floor level and vanished into it, leaving a row
  // of neural spines that looked like a picket fence rather than an animal.
  const bones = [];
  const spineY = 1.0;
  for (let i = 0; i < 16; i++) {
    const x = -7 + i * 0.95;
    bones.push({ geometry: new THREE.BoxGeometry(0.75, 0.6, 0.55), position: [x, spineY, Math.sin(i * 0.4) * 0.5], color: BONE });
    bones.push({ geometry: new THREE.ConeGeometry(0.2, 1.1, 10), position: [x, spineY + 0.75, Math.sin(i * 0.4) * 0.5], color: BONE });
  }
  for (let i = 0; i < 9; i++) {
    const x = -5 + i * 0.9;
    for (const side of [-1, 1]) {
      const rib = taperedTube(
        [
          [x, spineY + 0.2, Math.sin(i * 0.4) * 0.5],
          [x - 0.3, spineY - 0.15, side * (1.7 + Math.sin(i * 0.5) * 0.6)],
          [x - 0.5, spineY - 0.5, side * (2.9 + Math.sin(i * 0.5) * 0.9)],
        ],
        [0.2, 0.17, 0.11],
        { tubularSegments: 8, radialSegments: 5 }
      );
      bones.push({ geometry: rib, color: BONE });
    }
  }
  // Skull, lying on its side at the head of the trench.
  const skull = taperedTube([[8.5, 1.2, 0.4], [10.6, 1.25, 0.2], [12.6, 1.05, -0.1]], [1.1, 0.95, 0.35], { tubularSegments: 12, radialSegments: 7 });
  scaleAbout(skull, [10.6, 1.2, 0.2], [1, 0.85, 1.15]);
  bones.push({ geometry: skull, color: BONE });
  for (let i = 0; i < 7; i++) {
    bones.push({
      geometry: new THREE.ConeGeometry(0.13, 0.6, 9),
      rotation: [0, 0, -1.9],
      position: [9.3 + i * 0.45, 0.75, 0.55],
      color: TOOTH,
    });
  }
  // Hip and a femur pulled slightly out of line, as bones usually are.
  bones.push({ geometry: new THREE.BoxGeometry(2.6, 0.5, 2.2), position: [-8.4, spineY, 0.2], color: BONE });
  const femur = taperedTube([[-8.6, 0.95, 1.8], [-9.9, 1.0, 3.6], [-10.6, 0.95, 5.4]], [0.55, 0.42, 0.6], { tubularSegments: 8, radialSegments: 6 });
  bones.push({ geometry: femur, color: BONE });
  g.add(mergedMesh(bones, { roughness: 0.85 }));

  // Tools left on the edge: brushes, a pick, a bucket, and plaster jackets ready to lift.
  const kit = [];
  kit.push({ geometry: new THREE.CylinderGeometry(0.9, 0.75, 1.5, 12), position: [width / 2 - 2.5, 0.75, depth / 2 - 2], color: 0xb45a3a });
  kit.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 3.2, 10), rotation: [0, 0.4, 1.3], position: [width / 2 - 4.5, 0.5, depth / 2 - 3], color: 0x8a6a44 });
  kit.push({ geometry: new THREE.BoxGeometry(1.1, 0.25, 0.35), rotation: [0, 0.4, 0], position: [width / 2 - 5.6, 0.35, depth / 2 - 3.6], color: 0x53555c });
  for (let i = 0; i < 3; i++) {
    kit.push({
      geometry: new THREE.CylinderGeometry(1.1, 1.2, 0.9, 10),
      rotation: [0, 0, 1.57],
      position: [-width / 2 + 3 + i * 2.6, 0.7, depth / 2 - 2.4],
      color: 0xe6e2d5,
    });
  }
  g.add(mergedMesh(kit, { roughness: 0.9 }));

  return g;
}

// A timber boardwalk segment. Laid end to end by the layout to make a path through the
// undergrowth -- the same navigational job the Park's flagstone runs do.
export function boardwalk({ length = 14, width = 6, seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const planks = Math.round(length / 1.2);
  for (let i = 0; i < planks; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width, 0.22, 1.0),
      rotation: [0, randomIn(rng, -0.02, 0.02), 0],
      position: [0, 0.2, -length / 2 + 0.6 + i * (length / planks)],
      color: new THREE.Color(0x8a6a44).multiplyScalar(randomIn(rng, 0.82, 1.12)).getHex(),
    });
  }
  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.35, 0.3, length), position: [sx * (width / 2 - 0.3), 0.05, 0], color: 0x5f4830 });
  }

  const walk = mergedMesh(parts, { roughness: 0.95, ...relief('wood', { seed, repeat: 6 }) });
  walk.castShadow = false;
  return group(walk);
}

// A three-toed theropod trackway. Real trackways tell you things a skeleton cannot:
// how fast the animal moved, whether it travelled alone, and how it held its feet.
export function dinoTracks({ count = 8, seed = 5, stride = 6, gauge = 2.4 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(128, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(58,44,28,0.62)';
    // Three forward toes and a heel pad.
    for (const [tx, ty, angle] of [
      [64, 44, 0],
      [30, 62, -0.5],
      [98, 62, 0.5],
    ]) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 40, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(64, 112, 30, 30, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  const parts = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    parts.push({
      geometry: new THREE.PlaneGeometry(2.6, 3.2),
      rotation: [-Math.PI / 2, randomIn(rng, -0.12, 0.12), 0],
      position: [(side * gauge) / 2 + randomIn(rng, -0.2, 0.2), 0.06, -i * stride],
      color: 0xffffff,
    });
  }

  // One mesh, and pure-white vertex colours so the map is not multiplied by a tint.
  const trail = mergedMesh(parts, { map: texture, transparent: true, roughness: 1, depthWrite: false });
  trail.castShadow = false;
  trail.receiveShadow = false;
  return group(trail);
}

// ---------------------------------------------------------------------------
// Reused from other worlds, in this island's colours
// ---------------------------------------------------------------------------

// Boulders and a volcanic plume are the same shapes wherever they appear; only the
// palette changes. Same arrangement as the Mars world's craters and rocks.
export function jungleRocks(options = {}) {
  return moonRocks({ colors: [0x5f6355, 0x4c5245, 0x6d7060, 0x3f4438], ...options });
}

export function volcanicSmoke(options = {}) {
  return dustDevil({ height: 70, radius: 11, color: 0x8d8a86, tint: '150,146,140', ...options });
}
