import * as THREE from 'three';
import {
  standard, mesh, cyl, group, mergedMesh, relief,
  canvasTexture, signPanel, seededRandom, randomIn,
} from '../PropKit.js';
import {
  solidLoft, loftSampler, grooveAt, sweepProfile, mouldedRing, extrudeOutline, revolve,
  solidSurface, chain, spike, dome, ball, tube, mergeParts, tintGeometry, weather,
  smoothNoise3, roundedOutline, lensOutline, ringPts, placed, put, smoothed,
} from './LoftKit.js';

// Ellis Island, 1907 -- the busiest year the station ever had: 1,004,756 people came
// through. The world is the harbour approach, because that is the part of the story that
// is actually about arriving.
//
// The one thing this world must not do is make it look easy or grand. The Main Building is
// handsome and the Registry Room is enormous, but the experience was a queue, a numbered
// tag pinned to your coat, a doctor looking at your eyes for thirty seconds, and a chalk
// letter on your shoulder if something was wrong. The props are built to say that: the
// baggage is the largest single object on the dock, and the inspection line has a rail.
//
// THE REBUILD. Every object here was axis-aligned boxes and constant-radius swept tubes.
// Three things drove the rewrite, and the statue drove all three:
//
//  * DRAPERY IS GROOVES IN ONE SURFACE, NOT RIBS LAID ON A TUBE. Liberty's robe was a
//    tapered tube with fourteen boxes stuck round it as "fold lines". A box on a curved
//    surface has to be sized against a radius it does not own, so they sat either inside
//    the robe (contributing nothing) or proud of it (reading as staves round a barrel).
//    The robe is now ONE lofted solid whose surface is modulated by a fold field -- which
//    cannot open a gap in itself, and which is what drapery physically is.
//  * A HULL IS NOT A SCALED TUBE. The steamship was one `taperedTube` scaled 0.86 in Y, so
//    it had a single aspect ratio from stem to stern. A ship is a fine wedge at the bow,
//    full and flat-floored amidships and a counter at the stern.
//  * A BRICK BOX WITH THREE FLAT BANDS IS A WAREHOUSE. What makes the Main Building
//    Beaux-Arts is its MOULDINGS, and a moulding is a profile mitred round a rectangle.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// WIDENED, and deliberately. The first pass had six colours -- one brick, one limestone,
// one copper, one slate, one timber -- and a harbour built from six colours reads as a
// diorama. Real brick is never one colour because a kiln never fires evenly; real copper
// patina runs through four stages at once; and the single most useful addition is the
// GRANITE, because Liberty's pedestal is pink Stony Creek granite and painting it the same
// grey as the building behind lost the one contrast that separates the statue from the
// skyline.
const BRICK = {
  face: 0xa8593c, dark: 0x8a4630, light: 0xbf6d4a, burnt: 0x6f3626, pale: 0xc98b64,
};
const STONE = {
  limestone: 0xd8cfbc, limestoneWarm: 0xe0d4b8, limestoneCool: 0xc9c4b6,
  granite: 0xb08a7c, graniteDark: 0x8d6c62, graniteGrey: 0x9a938c,
  bluestone: 0x6f757a, concrete: 0xa8a49c,
};
// Copper through its whole weathering range. By 1907 Liberty had been up 21 years and was
// mid-transition -- not the bright penny of 1886 and not the even mint green of today, but
// a patchy brown-green, which is what the placard about the thirty-year change describes.
const COPPER = {
  patina: 0x74b09a, patinaPale: 0x93c4b0, patinaDeep: 0x4f8571,
  bronze: 0x8a7a52, brown: 0x6d5a44, oxide: 0x3f6b5c,
};
const SHIP = {
  hull: 0x24262b, hullSheen: 0x33363d, boot: 0x8a2f24, white: 0xe0dad0,
  whiteBright: 0xf0eae0, buff: 0xc9a45e, funnel: 0xb5562e, funnelTop: 0x1c1c1c,
  rust: 0x7d4a2c, brass: 0xb8975a,
};
const TIMBER = {
  deck: 0x8a7355, plank: 0x6b5842, dark: 0x4a3f31, tar: 0x33302a, oak: 0x7d6a50,
};
const IRON = { cold: 0x3a3f45, dark: 0x24272b, galv: 0x6f757c };
const LEATHER = [0x6b4a2c, 0x4f3a26, 0x8a6a42, 0x3f3128, 0x7d5f3c, 0x5c4636];
const SLATE = 0x4a5058;

// ---------------------------------------------------------------------------
// The Statue of Liberty
// ---------------------------------------------------------------------------

// Seen across the water from Ellis Island, about half a mile off. She is 305ft to the torch
// including the pedestal, and the proportions are real: a 151ft figure on an 89ft pedestal
// on a 65ft star-shaped foundation, so the FIGURE IS LESS THAN HALF THE TOTAL HEIGHT. That
// ratio is the thing pictures get wrong, and building it right is most of why this reads as
// the real monument rather than as a statuette on a plinth.
//
// What carries the identification, in order of how much each one buys:
//
//  * THE DRAPERY. She is two thirds cloth. Deep vertical folds down the robe, the mantle
//    falling diagonally across the body, and the hem breaking over the feet.
//  * THE STRIDE. Her left foot is back with the heel lifted and she is walking forward out
//    of the broken shackle -- which is the whole meaning of the statue and the thing the
//    placard is about. Built standing square she is a caryatid.
//  * THE RAISED ARM, held up and slightly FORWARD, not vertical.
//  * THE SEVEN-RAY CROWN. The count is the point, so the rays are real tapering spikes.
//  * THE TABLET, tipped back in the crook of the left arm.
export function statueOfLiberty({ scale = 0.42, seed = 11 } = {}) {
  const g = group();
  const S = scale;
  const starH = 20 * S;          // Fort Wood's parapet
  const pedH = 89 * S;
  const figH = 151 * S;
  const rng = seededRandom(seed);

  // --- Fort Wood: an eleven-pointed star fort ------------------------------
  // ONE extruded outline, not eleven rotated boxes. Eleven boxes overlap in the middle in
  // eleven different ways, so every joint between them is a visible crease and the centre
  // is a solid mass of interpenetrating corners; the star's own re-entrant angles never
  // appear at all. An extruded star outline has the re-entrant angles by construction.
  const starPts = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 ? 30 : 46) * S;
    starPts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const fort = [];
  // The rampart, its battered scarp, and the coping course on top.
  const star = extrudeOutline(starPts, starH * 0.86);
  star.rotateX(-Math.PI / 2);
  star.translate(0, starH * 0.43, 0);
  put(fort, star, STONE.graniteGrey);
  const scarp = extrudeOutline(starPts.map(([x, y]) => [x * 1.09, y * 1.09]), starH * 0.3);
  scarp.rotateX(-Math.PI / 2);
  scarp.translate(0, starH * 0.15, 0);
  put(fort, scarp, STONE.bluestone);
  const coping = extrudeOutline(starPts.map(([x, y]) => [x * 1.03, y * 1.03]), starH * 0.1);
  coping.rotateX(-Math.PI / 2);
  coping.translate(0, starH * 0.9, 0);
  put(fort, coping, STONE.concrete);
  g.add(mesh(
    weather(mergeParts(fort), { amount: 0.13, scale: 0.06 / S, wash: 0.3, low: 0, fade: starH, seed: 4 }),
    standard({ vertexColors: true, roughness: 0.95, ...relief('stone', { seed, repeat: 6 }) }),
  ));

  // --- The pedestal -------------------------------------------------------
  // Richard Morris Hunt's design, and it is essentially a stack of MOULDINGS: a battered
  // base, a tall die, a band of forty granite shields, a Doric loggia and a heavy cornice.
  // Built as flat boxes it was a plinth; built as mitred rings it is architecture.
  const ped = [];
  const base = starH * 0.96;
  const halfAt = (y) => {
    // The pedestal batters inward as it rises, which is what stops it reading as a chimney.
    const t = THREE.MathUtils.clamp((y - base) / pedH, 0, 1);
    return (19 - t * 5.5) * S;
  };
  // Battered die, as a loft so the batter is a smooth taper rather than a stack of steps.
  const die = solidLoft([
    { d: base, w: halfAt(base), h: halfAt(base), round: 0.14 },
    { d: base + pedH * 0.5, w: halfAt(base + pedH * 0.5), h: halfAt(base + pedH * 0.5), round: 0.13 },
    { d: base + pedH * 0.86, w: halfAt(base + pedH * 0.86), h: halfAt(base + pedH * 0.86), round: 0.12 },
  ], { axis: 'y', sides: 28, samples: 14, capStart: true, capEnd: true });
  put(ped, die, STONE.granite);

  // Mouldings. A profile point standing `out` proud of every face traces a rectangle of
  // half-size (half + out), so a cornice is a stack of rectangles and the mitre is exact.
  const band = (y, half, profile, colour) => {
    const r = mouldedRing(profile, half, half);
    r.translate(0, y, 0);
    put(ped, r, colour);
  };
  band(base, halfAt(base) + 2.4 * S, [
    [0, 0], [0, 3.4 * S], [-0.9 * S, 4.1 * S], [-1.1 * S, 5.2 * S], [-2.4 * S, 5.9 * S],
  ], STONE.graniteDark);
  band(base + pedH * 0.86, halfAt(base + pedH * 0.86), [
    [0, 0], [1.5 * S, 0.8 * S], [1.9 * S, 2.0 * S], [1.2 * S, 2.6 * S], [1.4 * S, 4.4 * S],
    [2.8 * S, 5.2 * S], [2.9 * S, 6.6 * S], [0.6 * S, 7.4 * S], [0, 7.6 * S],
  ], STONE.graniteDark);

  // The loggia: a Doric colonnade round the top, open, so the sky shows through it. Ten
  // columns a side reads as a building; the real one has a broad opening at each corner.
  const loggiaY = base + pedH * 0.62;
  const loggiaH = pedH * 0.2;
  const lHalf = halfAt(loggiaY) + 2.1 * S;
  for (const axis of [0, 1]) {
    for (const sideSign of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const along = (i / 6 - 0.5) * lHalf * 1.62;
        if (Math.abs(along) > lHalf * 0.72) continue;
        const cx = axis ? along : sideSign * lHalf;
        const cz = axis ? sideSign * lHalf : along;
        const shaft = revolve([
          [1.5 * S, 0], [1.45 * S, loggiaH * 0.06], [1.32 * S, loggiaH * 0.82],
          [1.55 * S, loggiaH * 0.88], [1.6 * S, loggiaH * 0.94], [1.7 * S, loggiaH],
        ], { segments: 12 });
        put(ped, shaft, STONE.granite, [cx, loggiaY, cz]);
      }
    }
  }
  // The forty granite shields under the cornice -- Hunt's one piece of ornament, and the
  // detail that makes the pedestal itself recognisable.
  for (const axis of [0, 1]) {
    for (const sideSign of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const along = (i / 9 - 0.5) * halfAt(base + pedH * 0.8) * 1.68;
        const y = base + pedH * 0.8;
        const cx = axis ? along : sideSign * (halfAt(y) + 0.3 * S);
        const cz = axis ? sideSign * (halfAt(y) + 0.3 * S) : along;
        // LIGHTER than the wall and shallower than instinct says. At graniteDark and half
        // sunk, forty of these read as a row of dark arches under the cornice -- an arcade
        // the building does not have -- rather than as forty carved discs.
        dome(ped, STONE.granite, {
          radius: 1.2 * S, height: 0.42 * S, at: [cx, y, cz], detail: 8, sink: 0.34,
          rot: axis ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2],
        });
      }
    }
  }
  g.add(mesh(
    weather(mergeParts(ped), {
      amount: 0.14, scale: 0.09 / S, wash: 0.34, low: base, fade: pedH * 0.9, seed: 7, warm: 0.4,
    }),
    standard({ vertexColors: true, roughness: 0.92, ...relief('stone', { seed: seed + 1, repeat: 7 }) }),
  ));

  // --- The figure ---------------------------------------------------------
  // THE FIGURE'S OWN PROPORTIONS, and getting these right is worth more than any amount of
  // tessellation. The quoted 151ft is heel to TORCH, not heel to head: she is 111ft to the
  // top of her head and the raised arm adds another 40ft above that. Built with the head at
  // the top of a 151ft figure -- which is what "the statue is 151ft tall" invites -- the
  // head lands 18ft too high, the arm has almost no run above the shoulder, and the torch
  // ends up level with her ear. Every fraction below is measured against the real 151.
  //
  //   0.00 hem   0.30 hips   0.38 waist   0.51 chest   0.56 shoulders
  //   0.59 neck  0.672 head centre   0.735 top of head   0.868 hand   1.00 torch tip
  const F = base + pedH;                       // the statue's own feet
  const at = (f) => F + figH * f;              // fraction of heel-to-torch -> world Y
  const body = [];

  // The robe, as ONE lofted solid from hem to shoulders.
  //
  // The section is a superellipse that is WIDER THAN DEEP throughout and rounder at the
  // hem than at the chest, and its centre line leans: `a` carries the stride's weight onto
  // the right leg and `b` the slight forward set of the upper body. Nothing here can be
  // expressed by scaling a swept circle, which is why the old robe read as a bell.
  const robeStations = [
    { d: at(0.000), w: figH * 0.130, up: figH * 0.116, dn: figH * 0.114, round: 0.86, a: 0, b: figH * 0.005 },
    { d: at(0.040), w: figH * 0.132, up: figH * 0.117, dn: figH * 0.115, round: 0.88, a: -figH * 0.002, b: figH * 0.001 },
    { d: at(0.130), w: figH * 0.126, up: figH * 0.109, dn: figH * 0.107, round: 0.92, a: -figH * 0.005, b: -figH * 0.003 },
    { d: at(0.220), w: figH * 0.117, up: figH * 0.099, dn: figH * 0.098, round: 0.95, a: -figH * 0.006, b: -figH * 0.005 },
    { d: at(0.300), w: figH * 0.110, up: figH * 0.092, dn: figH * 0.091, round: 0.98, a: -figH * 0.005, b: -figH * 0.004 },
    { d: at(0.380), w: figH * 0.100, up: figH * 0.083, dn: figH * 0.084, round: 1.0, a: -figH * 0.003, b: -figH * 0.001 },
    { d: at(0.450), w: figH * 0.101, up: figH * 0.083, dn: figH * 0.085, round: 1.0, a: -figH * 0.001, b: figH * 0.002 },
    { d: at(0.510), w: figH * 0.104, up: figH * 0.082, dn: figH * 0.084, round: 1.05, a: 0, b: figH * 0.004 },
    { d: at(0.560), w: figH * 0.096, up: figH * 0.071, dn: figH * 0.073, round: 1.1, a: 0, b: figH * 0.003 },
    { d: at(0.590), w: figH * 0.068, up: figH * 0.054, dn: figH * 0.055, round: 1.1, a: 0, b: 0 },
  ];

  // The fold field. THREE things about it, and each one was a wrong version first:
  //
  //  * NINE SAMPLES PER FOLD. At `sides: 44` and eleven folds there are four samples per
  //    cycle, which is barely over Nyquist, and instead of drapery it produced a faceted
  //    shimmer that read as a fir cone. 72 sides and 8 folds is 9 per cycle.
  //  * THE FOLDS DRIFT. A fold that runs dead vertical for 75ft is a fluted column, which
  //    is the one thing a robe must not look like -- so the phase shifts slowly with
  //    height and the fold count is not an integer multiple of anything.
  //  * THEY DEEPEN TOWARD THE HEM AND VANISH AT THE SHOULDER, because that is where the
  //    cloth gathers. Constant depth reads as corrugated iron.
  const foldWarp = (t, u, s) => {
    const h = t;                                   // 0 at hem, 1 at shoulders
    // A FOLD RUNS DOWN, and the drift has to be almost nothing.
    //
    // The first version drifted the phase by 0.16*sin(2.1h) + 0.28h, which over the height
    // of the figure walks each fold nearly half way round her -- and the result was
    // unmistakable: a barley-twist column, or a soft-serve ice cream. Cloth hanging under
    // its own weight falls vertically. 0.035 is enough to stop the folds being a machined
    // flute and small enough that no fold visibly leans.
    const drift = h * 0.035;
    // TWO fold families, and the second one is what makes it cloth rather than fluting.
    // Eight deep folds alone is a Doric column; a finer set of secondary creases running at
    // a different count, offset, is what a real drapery cast looks like. 8 and 19 are chosen
    // to share no common factor, so no two folds ever line up down the whole height.
    const field = Math.sin((u + drift) * Math.PI * 2 * 8);
    const fine = Math.sin((u * 19 + 0.37 + h * 0.2) * Math.PI * 2);
    // Deeper at the hem where the cloth gathers, gone by the shoulder.
    const gather = THREE.MathUtils.clamp(1.1 - h * 0.95, 0.10, 1);
    let d = grooveAt(field, 0.30, s.w * 0.20 * gather);
    d += grooveAt(fine, 0.34, s.w * 0.045 * gather);
    // The mantle's edge: ONE deep fold falling from the left shoulder across the body. It is
    // far deeper than its neighbours and it is what makes the drapery read as two garments
    // rather than one sack. It leans, because a mantle edge genuinely does.
    const edge = Math.sin((u - 0.10 - h * 0.16) * Math.PI * 2);
    d += grooveAt(edge, 0.075, s.w * 0.09 * THREE.MathUtils.clamp(h * 1.6, 0, 1));
    // Clamp the total against the local radius. Several independent displacements that each
    // look reasonable can together exceed it, and then the surface passes through its own
    // axis and turns inside out.
    return Math.max(d, -s.w * 0.26);
  };
  const robe = solidLoft(robeStations, { axis: 'y', sides: 72, samples: 78, warp: foldWarp });
  // Painted the patina colour like every other part, NOT a white sentinel. A sentinel is
  // only needed where one solid has to carry two different HUES, because a tint multiplies
  // and cannot turn one colour into another. Everything on this statue is copper, so the
  // tint's job here is variation within one hue -- and a white base would come back out of
  // it very nearly white, which is how the robe first rendered as a marble figure.
  put(body, robe, COPPER.patina);

  // ONE foot, and only the toe of it.
  //
  // The stride is the whole meaning of the figure, but almost none of it is visible: the
  // robe reaches the ground and what actually shows is the toe of the RIGHT foot emerging
  // from under the hem. The first pass modelled two whole feet with two sandal straps each,
  // which at this scale is six pale lumps sitting on the plinth around the hem -- and since
  // they were outside the robe's silhouette they read as debris, not as feet.
  {
    const fx = figH * 0.030;
    const fz = figH * 0.098;
    const toe = solidLoft([
      { d: -figH * 0.030, w: figH * 0.024, up: figH * 0.013, dn: figH * 0.004, round: 0.7 },
      { d: 0, w: figH * 0.023, up: figH * 0.012, dn: figH * 0.004, round: 0.6 },
      { d: figH * 0.018, w: figH * 0.017, up: figH * 0.008, dn: figH * 0.004, round: 0.8 },
      { d: figH * 0.026, w: figH * 0.007, up: figH * 0.004, dn: figH * 0.003, round: 1 },
    ], { axis: 'z', sides: 12, samples: 10 });
    put(body, toe, COPPER.patinaDeep, [fx, at(0.008), fz], [0, 0.10, 0]);
    // One sandal strap across it.
    put(body, tube([
      [fx - figH * 0.020, at(0.010), fz - figH * 0.008],
      [fx, at(0.019), fz - figH * 0.008],
      [fx + figH * 0.020, at(0.010), fz - figH * 0.008],
    ], [figH * 0.0028, figH * 0.0032, figH * 0.0028], { sides: 6 }), COPPER.oxide);
  }

  // --- Neck and head ------------------------------------------------------
  // A SEPARATE loft, and that is deliberate. Threading the neck through the robe's loft
  // means a very narrow station between two wide ones, and a Catmull-Rom through that
  // overshoots on both sides -- the first attempt gave her a pronounced goitre below the
  // jaw and a pinched skull above it.
  // `b` swells the section BACKWARD above the brow, which is the hair. Carried in the loft
  // it cannot cap the skull; laid on as a dome it did exactly that and she wore a helmet.
  const neckHead = solidLoft([
    { d: at(0.588), w: figH * 0.058, up: figH * 0.047, dn: figH * 0.049, round: 1.05, b: 0 },
    { d: at(0.608), w: figH * 0.032, up: figH * 0.030, dn: figH * 0.031, round: 1, b: -figH * 0.004 },
    { d: at(0.626), w: figH * 0.030, up: figH * 0.029, dn: figH * 0.030, round: 1, b: -figH * 0.004 },
    { d: at(0.642), w: figH * 0.036, up: figH * 0.038, dn: figH * 0.040, round: 0.95, b: -figH * 0.002 },
    { d: at(0.664), w: figH * 0.040, up: figH * 0.042, dn: figH * 0.043, round: 0.92, b: -figH * 0.003 },
    { d: at(0.686), w: figH * 0.041, up: figH * 0.044, dn: figH * 0.042, round: 0.94, b: -figH * 0.007 },
    { d: at(0.708), w: figH * 0.038, up: figH * 0.041, dn: figH * 0.038, round: 0.97, b: -figH * 0.009 },
    { d: at(0.724), w: figH * 0.029, up: figH * 0.031, dn: figH * 0.029, round: 1, b: -figH * 0.008 },
    { d: at(0.735), w: figH * 0.015, up: figH * 0.016, dn: figH * 0.015, round: 1, b: -figH * 0.006 },
  ], { axis: 'y', sides: 30, samples: 30 });
  put(body, neckHead, COPPER.patina);
  // The coiled bun at the nape -- low, behind, and sunk well in. It is the one piece of hair
  // worth having as its own solid because it changes the silhouette from the side.
  dome(body, COPPER.patinaDeep, {
    radius: figH * 0.026, height: figH * 0.020,
    at: [0, at(0.646), -figH * 0.036], rot: [Math.PI / 2.4, 0, 0], detail: 10, sink: 0.55,
  });

  // The face -- and the governing fact is HOW FAR AWAY SHE IS.
  //
  // This statue stands about 150ft off across the water at scale 0.5, so her head is six
  // feet tall and subtends roughly two degrees. At that size a modelled eyeball, an ear and
  // a lower lip are each about one screen pixel, and a DARK solid one pixel across does not
  // read as a feature -- it reads as a smudge. The first pass gave her applied domes for
  // brow, lids, sockets, ears, lips and a hair cap, and from the shore the whole face came
  // out as four dark spots under a dark helmet.
  //
  // So the face is the NOSE and the eye SOCKETS and nothing else, all shallow: the nose
  // because a strong straight nose continuous with the brow is the one neoclassical feature
  // that survives distance, and the sockets because at this size an eye IS its own shadow.
  // The hair is not an applied mass at all -- it is in the head loft's own stations above,
  // where it cannot cap the skull the way a dome placed on top of it did.
  const hY = at(0.672);
  const hR = figH * 0.040;
  const nose = solidLoft([
    { d: hY + hR * 0.34, w: hR * 0.085, up: hR * 0.05, dn: hR * 0.06, round: 0.8 },
    { d: hY + hR * 0.02, w: hR * 0.105, up: hR * 0.09, dn: hR * 0.085, round: 0.8 },
    { d: hY - hR * 0.22, w: hR * 0.135, up: hR * 0.10, dn: hR * 0.09, round: 0.9 },
  ], { axis: 'y', sides: 10, samples: 7 });
  nose.translate(0, 0, hR * 0.86);
  put(body, nose, COPPER.patina);
  for (const side of [-1, 1]) {
    // Shallow, small, and sunk deep, so what shows is a shadow and not a bead.
    dome(body, COPPER.oxide, {
      radius: hR * 0.17, height: hR * 0.05,
      at: [side * hR * 0.32, hY + hR * 0.14, hR * 0.84],
      rot: [Math.PI / 2.2, 0, side * 0.16], detail: 7, sink: 0.85,
    });
  }
  // Mouth: one shallow level recess. Liberty's mouth is famously severe, and a severe mouth
  // at this distance is a line.
  put(body, extrudeOutline(lensOutline(hR * 0.26, hR * 0.035, 5), hR * 0.07),
    COPPER.oxide, [0, hY - hR * 0.46, hR * 0.80]);

  // --- The crown ----------------------------------------------------------
  // A diadem band, then SEVEN rays. The count stands for the seven continents and seas and
  // it is the one number on this statue every student is told, so the rays are real
  // tapering spikes that can be counted from the shore.
  const crownY = hY + hR * 0.82;
  const diadem = revolve([
    [hR * 1.02, 0], [hR * 1.14, hR * 0.10], [hR * 1.16, hR * 0.30],
    [hR * 1.06, hR * 0.40], [hR * 1.02, hR * 0.44],
  ], { segments: 26 });
  put(body, diadem, COPPER.patinaPale, [0, crownY, 0]);
  for (let i = 0; i < 7; i++) {
    // Spread over about 200 degrees of the crown, centred on the back, so from the front
    // you see five and the outer two rake away -- which is what the real one does.
    const a = Math.PI + (i / 6 - 0.5) * Math.PI * 1.12;
    const rr = hR * 1.06;
    const len = figH * 0.062;
    const tilt = 0.30;
    const ray = solidLoft([
      { d: 0, w: hR * 0.15, up: hR * 0.055, dn: hR * 0.055, round: 0.7 },
      { d: len * 0.45, w: hR * 0.10, up: hR * 0.040, dn: hR * 0.040, round: 0.8 },
      { d: len, w: hR * 0.008, up: hR * 0.006, dn: hR * 0.006, round: 1 },
    ], { axis: 'y', sides: 10, samples: 8 });
    // A ray leans outward as well as up, so it needs a real compound placement.
    put(body, ray, COPPER.patinaPale,
      [Math.sin(a) * rr, crownY + hR * 0.30, Math.cos(a) * rr],
      [Math.cos(a) * tilt, -a, -Math.sin(a) * tilt]);
  }

  // --- The raised right arm and the torch ---------------------------------
  // Up and slightly FORWARD, with the elbow a little bent. Straight up it reads as a
  // salute; her arm is 42ft of it and the bend is visible from a mile.
  const shoulderR = [figH * 0.072, at(0.552), figH * 0.010];
  chain(body, COPPER.patina, [
    { p: shoulderR, r: figH * 0.030 },
    { p: [figH * 0.100, at(0.660), -figH * 0.004], r: figH * 0.024 },
    { p: [figH * 0.116, at(0.768), -figH * 0.016], r: figH * 0.019 },
    { p: [figH * 0.122, at(0.852), -figH * 0.022], r: figH * 0.017 },
  ], { sides: 14, detail: 12, capStart: false, capEnd: false });
  // NO SLEEVE DOME AT THE SHOULDER, and this is the loudest thing the first pass got wrong.
  //
  // A dark 6ft dome placed at the top of the chest to suggest gathered cloth sits well
  // inside the robe's own 14ft half-width, so it does not read as a sleeve at all -- it
  // bulges through the front of the torso as one dark hemisphere per side, and a pair of
  // dark hemispheres at chest height on a female figure reads as exactly one thing. The
  // shoulder is carried by the robe loft's own stations instead, which is where it belongs.
  //
  // The hand: a fist round the torch handle. Four knuckles read as a hand; a sphere does
  // not, and the hand is 16ft across on the real statue.
  const handAt = [figH * 0.124, at(0.872), -figH * 0.024];
  dome(body, COPPER.patina, { radius: figH * 0.026, height: figH * 0.030, at: handAt, detail: 12, sink: 0.3 });
  for (let k = 0; k < 4; k++) {
    dome(body, COPPER.patina, {
      radius: figH * 0.009, height: figH * 0.010,
      at: [handAt[0] - figH * 0.016, handAt[1] + figH * 0.008, handAt[2] + figH * (k - 1.5) * 0.011],
      detail: 7, sink: 0.35,
    });
  }
  // Torch: the handle, a moulded knop, and the gilded flame. The balcony round the flame is
  // what the 1886 torch actually had -- people stood in it.
  const torchBase = at(0.888);
  put(body, revolve([
    [figH * 0.016, 0], [figH * 0.019, figH * 0.010], [figH * 0.013, figH * 0.016],
    [figH * 0.013, figH * 0.040], [figH * 0.026, figH * 0.050], [figH * 0.034, figH * 0.058],
    [figH * 0.037, figH * 0.070], [figH * 0.030, figH * 0.076],
  ], { segments: 18 }), COPPER.bronze, [figH * 0.126, torchBase, -figH * 0.026]);

  // --- The left arm and the tablet ---------------------------------------
  // The tablet is held against her left side, tipped back, with the forearm across it.
  const tabletAt = [-figH * 0.086, at(0.408), figH * 0.062];
  chain(body, COPPER.patina, [
    { p: [-figH * 0.076, at(0.548), figH * 0.006], r: figH * 0.029 },
    { p: [-figH * 0.096, at(0.478), figH * 0.020], r: figH * 0.024 },
    { p: [-figH * 0.098, at(0.428), figH * 0.046], r: figH * 0.021 },
    { p: [-figH * 0.076, at(0.406), figH * 0.078], r: figH * 0.019 },
  ], { sides: 14, detail: 12, capStart: false });

  // --- The broken shackle at her feet -------------------------------------
  // Almost nobody sees it, because you cannot from the ground -- and that is what the
  // placard is about. The chain has to emerge from UNDER the hem, so its links start
  // inside the robe's own silhouette and walk out past it.
  // SMALL, and mostly under the hem. The first pass made the links figH*0.0125 -- nearly two
  // feet of tube radius -- and ran them out to figH*0.166 clear of the robe, so the great
  // symbol of the statue rendered as a heap of green doughnuts dumped on the plinth. The
  // whole point of the placard is that you CANNOT see this from the ground: it is a detail
  // you are told about, so it has to be present and modest rather than a feature.
  {
    const links = 6;
    for (let i = 0; i < links; i++) {
      const t = i / (links - 1);
      const lx = figH * (0.052 + t * 0.070);
      const lz = figH * (0.052 + t * 0.040);
      const link = new THREE.TorusGeometry(figH * 0.0058, figH * 0.0019, 6, 10);
      put(body, link, i > 2 ? COPPER.oxide : COPPER.patinaDeep,
        [lx, at(0.003) + Math.sin(t * 3) * figH * 0.001, lz],
        [Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0]);
    }
    // The broken end: two open jaws, which is what says BROKEN rather than "a chain lying
    // there".
    for (const j of [-1, 1]) {
      put(body, tube([
        [figH * 0.122, at(0.003), figH * 0.092],
        [figH * 0.130, at(0.006) + j * figH * 0.004, figH * 0.100],
        [figH * 0.135, at(0.004) + j * figH * 0.008, figH * 0.108],
      ], [figH * 0.0026, figH * 0.0022, figH * 0.0016], { sides: 6 }), COPPER.oxide);
    }
  }

  // --- Patina --------------------------------------------------------------
  // The copper is finished with a per-vertex weathering rather than a flat colour, and by
  // 1907 that is historically the right answer: she had been up 21 years and was PATCHY --
  // brown where the rain had not reached and green where it had. Streaked vertically,
  // because that is how water runs off a statue, and lighter in the folds' shadows would be
  // wrong, so the streaks run independently of the geometry.
  const bodyMesh = mesh(
    tintGeometry(mergeParts(body), (p, c) => {
      const streak = smoothNoise3(p.x * 1.6 / S, p.y * 0.16 / S, p.z * 1.6 / S);
      const patch = smoothNoise3(p.x * 0.5 / S + 9, p.y * 0.34 / S, p.z * 0.5 / S + 3);
      // Brown where sheltered, green where washed. The tint MULTIPLIES, so it cannot turn
      // green into brown -- which is exactly why the robe is painted with a white sentinel
      // above and every patina colour is supplied here.
      const green = 0.42 + patch * 0.5 + streak * 0.16;
      const k = 0.86 + streak * 0.2;
      return [
        c.r * k * (1.28 - green * 0.42),
        c.g * k * (0.86 + green * 0.30),
        c.b * k * (0.90 + green * 0.20),
      ];
    }),
    standard({ vertexColors: true, roughness: 0.66, metalness: 0.24, ...relief('metal', { seed: seed + 2, repeat: 9 }) }),
  );
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  g.add(bodyMesh);

  // The tablet carries a real date, so it is its own mesh with a texture. JULY IV MDCCLXXVI.
  {
    const tex = canvasTexture(256, 384, (ctx, w, h) => {
      ctx.fillStyle = '#7fb6a0';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgba(${60 + rng() * 60 | 0},${110 + rng() * 50 | 0},${95 + rng() * 40 | 0},${0.06 + rng() * 0.1})`;
        ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 10, 60), 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(40,80,66,0.6)'; ctx.lineWidth = 6;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.fillStyle = '#2f5c4c';
      ctx.textAlign = 'center';
      ctx.font = 'bold 46px Georgia, serif';
      ctx.fillText('JULY', w / 2, h * 0.44);
      ctx.font = 'bold 40px Georgia, serif';
      ctx.fillText('IV', w / 2, h * 0.55);
      ctx.font = 'bold 34px Georgia, serif';
      ctx.fillText('MDCCLXXVI', w / 2, h * 0.66);
    });
    const slab = extrudeOutline(
      roundedOutline(figH * 0.045, figH * 0.078, figH * 0.006, 2), figH * 0.014,
    );
    const tablet = mesh(slab, standard({ map: tex, roughness: 0.7, metalness: 0.2 }));
    tablet.position.set(tabletAt[0], tabletAt[1], tabletAt[2]);
    tablet.rotation.set(0.30, 0.24, 0.26);
    tablet.castShadow = true;
    g.add(tablet);
  }

  // The flame -- gold leaf, self-lit so it reads at half a mile, and NOT shadow-casting.
  const flame = mesh(
    revolve([
      [figH * 0.026, 0], [figH * 0.030, figH * 0.014], [figH * 0.024, figH * 0.034],
      [figH * 0.014, figH * 0.056], [figH * 0.006, figH * 0.072], [figH * 0.001, figH * 0.084],
    ], { segments: 14 }),
    standard({
      color: 0xf7e3a2, emissive: 0xd9a83c, emissiveIntensity: 1.35, roughness: 0.34, metalness: 0.55,
    }),
    figH * 0.126, torchBase + figH * 0.066, -figH * 0.026,
  );
  flame.castShadow = false;
  g.add(flame);

  return g;
}

// ---------------------------------------------------------------------------
// The Main Building
// ---------------------------------------------------------------------------

// Boring, Tilton and Coolidge, 1900: red brick with limestone trim and four copper-domed
// corner towers. The towers are what make it recognisable from the water, which is the only
// angle most arrivals ever saw it from -- so they are the detail worth spending on.
//
// WHAT MAKES IT NOT A WAREHOUSE is entirely in the horizontal lines: a battered granite
// plinth, a limestone water table, a string course at the first floor, and a deep bracketed
// cornice. The first pass drew three of those as flat boxes 0.8ft proud of the brick, which
// is a stripe, not a moulding -- a moulding is a PROFILE, and a profile mitred round a
// rectangle is what `mouldedRing` is for.
export function ellisMainBuilding({ width = 74, depth = 34, height = 26, seed = 5 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const shell = [];

  // --- Brick body ---------------------------------------------------------
  // ONE lofted box, very slightly battered, rather than nine stacked course boxes. The
  // courses were doing the work of texture and cost nine solids to do it; the brick's
  // colour variation is now a per-vertex tint, which is what brick actually is -- a kiln
  // never fires evenly, and no two bricks in a wall are the same colour.
  const bodyLoftG = solidLoft([
    { d: 0, w: width / 2, h: depth / 2, round: 0.10 },
    { d: height * 0.55, w: width / 2 - 0.14, h: depth / 2 - 0.14, round: 0.09 },
    { d: height, w: width / 2 - 0.26, h: depth / 2 - 0.26, round: 0.09 },
  ], { axis: 'y', sides: 40, samples: 12 });
  put(shell, bodyLoftG, BRICK.face);

  // --- Mouldings ----------------------------------------------------------
  const ring = (y, half, halfD, profile, colour) => {
    const r = mouldedRing(profile, half, halfD);
    r.translate(0, y, 0);
    put(shell, r, colour);
  };
  // Granite plinth with a battered face.
  ring(0, width / 2, depth / 2, [
    [0.9, 0], [1.0, 0.5], [0.62, 2.0], [0.66, 2.4], [0.2, 2.7], [0.24, 3.0], [0, 3.1],
  ], STONE.bluestone);
  // Limestone water table.
  ring(3.1, width / 2, depth / 2, [
    [0, 0], [0.55, 0.22], [0.62, 0.78], [0.34, 1.0], [0.38, 1.5], [0.05, 1.7],
  ], STONE.limestone);
  // First-floor string course.
  ring(height * 0.5, width / 2 - 0.12, depth / 2 - 0.12, [
    [0, 0], [0.42, 0.16], [0.48, 0.62], [0.2, 0.8], [0.24, 1.1], [0.02, 1.25],
  ], STONE.limestoneWarm);
  // The cornice: the building's heaviest line, and it must be a RING and not a slab.
  // A solid box spanning the footprint here is invisible from below and silently caps the
  // whole building -- the museum-skylight trap -- and it also flattens the towers' bases.
  ring(height - 2.6, width / 2 - 0.22, depth / 2 - 0.22, [
    [0, 0], [0.5, 0.3], [0.55, 0.9], [1.3, 1.25], [1.45, 1.9],
    [1.15, 2.15], [1.2, 2.5], [0.5, 2.75], [0.55, 3.1], [0, 3.25],
  ], STONE.limestone);
  // Cornice brackets, which is what gives that shadow line its texture.
  for (const axis of [0, 1]) {
    const span = axis ? depth : width;
    const n = Math.round(span / 3.4);
    for (let i = 0; i < n; i++) {
      const along = (i / (n - 1) - 0.5) * (span - 4);
      for (const sideSign of [-1, 1]) {
        const off = (axis ? width : depth) / 2 - 0.1;
        const bracket = extrudeOutline([
          [0, 0], [1.0, 0.28], [1.05, 1.15], [0, 1.3],
        ], 0.42);
        put(shell, bracket, STONE.limestoneCool,
          axis ? [sideSign * off, height - 2.0, along] : [along, height - 2.0, sideSign * off],
          axis ? [0, sideSign * Math.PI / 2, 0] : [0, sideSign > 0 ? 0 : Math.PI, 0]);
      }
    }
  }
  // Limestone quoins up all four corners -- alternating long and short blocks, which is the
  // detail that says "trim" rather than "paint".
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        const y = 3.4 + i * ((height - 7) / 11);
        const long = i % 2 === 0;
        put(shell, new THREE.BoxGeometry(long ? 3.0 : 1.7, (height - 7) / 11 * 0.9, 1.8),
          i % 2 ? STONE.limestone : STONE.limestoneWarm,
          [sx * (width / 2 - (long ? 1.5 : 0.85) + 0.1), y, sz * (depth / 2 - 0.6)]);
        put(shell, new THREE.BoxGeometry(1.8, (height - 7) / 11 * 0.9, long ? 1.7 : 3.0),
          i % 2 ? STONE.limestoneWarm : STONE.limestone,
          [sx * (width / 2 - 0.6), y, sz * (depth / 2 - (long ? 0.85 : 1.5) + 0.1)]);
      }
    }
  }

  // --- The three great arched windows -------------------------------------
  // The Registry Room's windows, and the building's face. Each is a real RECESS with a
  // reveal, an arched head with voussoirs and a keystone, and glazing set back inside it.
  //
  // A window has to sit on the OUTER face of a wall. This building has no interior -- the
  // walls are one solid loft -- so a pane at the instinctive "inner face" is sealed inside
  // the brick and can never be seen from anywhere a student can stand.
  const glass = [];
  // A WINDOW HAS TO BE BUILT FORWARD OF A SOLID WALL, NOT BEHIND IT.
  //
  // The brick body is ONE lofted solid and this project has no CSG, so there is no opening
  // in it -- which means anything placed at a z inside the wall plane is simply sealed in
  // the brickwork. The first version put the dark reveal 1.35ft back and the glazing 0.5ft
  // back, and BOTH were inside the wall: all three of the Registry Room's great windows
  // rendered as bare brick with a stone frame round nothing at all.
  //
  // The same rule Machu Picchu's niches follow: dark panel a hair PROUD of the wall, glazing
  // proud of that, mullions proud of that, and the architrave projecting furthest of all. It
  // is the frame's own shadow that reads as a recess, not the recess.
  const wallZ = depth / 2;
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * width * 0.265;
    const R = width * 0.082;
    const sillY = height * 0.235;
    const springY = height * 0.60;
    // The dark panel the glazing sits ON, standing a hair proud of the brick.
    put(shell, new THREE.BoxGeometry(R * 2.06, springY - sillY, 0.34), 0x22262c, [x, (sillY + springY) / 2, wallZ + 0.02]);
    put(shell, revolve([[0, 0], [R * 1.03, 0], [R * 1.03, 0.34], [0, 0.34]], { segments: 16, start: -Math.PI / 2, sweep: Math.PI }),
      0x22262c, [x, springY, wallZ - 0.15], [Math.PI / 2, 0, 0]);
    // Architrave: a moulded surround, mitred round the opening's own rectangle.
    // rotateX(+PI/2), NOT -PI/2. mouldedRing is built as a ring in XZ with its profile
    // rising in Y, so it needs standing up to become a window surround. Under +PI/2 the
    // profile's height maps to +Z and the moulding stands PROUD of the wall; under -PI/2 it
    // maps to -Z and the whole architrave is buried inside the brickwork, which presents as
    // "the windows have no surround" with nothing on screen to explain why.
    const arch = mouldedRing([
      [0, 0], [0.42, 0.1], [0.5, 0.5], [0.22, 0.62], [0.26, 0.95], [0, 1.05],
    ], R * 1.12, (springY - sillY) / 2 + 0.4);
    arch.rotateX(Math.PI / 2);
    put(shell, arch, STONE.limestone, [x, (sillY + springY) / 2, wallZ + 0.5], [0, 0, 0]);
    // Voussoirs. A voussoir only lies flush if the ring is a TRUE circle, so the rise is
    // exactly the half-span and each block is rotated by (angle - 90 degrees).
    const vous = 15;
    for (let v = 0; v < vous; v++) {
      const a = Math.PI * (v + 0.5) / vous;
      const isKey = v === (vous - 1) / 2;
      put(shell, new THREE.BoxGeometry(R * 0.30, (Math.PI * R) / vous * 1.12, isKey ? 1.5 : 1.1),
        isKey ? STONE.limestoneWarm : (v % 2 ? STONE.limestone : STONE.limestoneCool),
        [x + Math.cos(a) * R * (isKey ? 1.24 : 1.19), springY + Math.sin(a) * R * (isKey ? 1.24 : 1.19), wallZ + 0.55],
        [0, 0, a - Math.PI / 2]);
    }
    // Sill.
    put(shell, extrudeOutline([[-R * 1.2, 0], [R * 1.2, 0], [R * 1.16, 0.5], [-R * 1.16, 0.5]], 1.6),
      STONE.limestone, [x, sillY - 0.25, wallZ + 0.5]);

    // Glazing: a grid of small panes with real mullions and transoms, set BEHIND the
    // reveal. Glazed as one sheet a 20ft opening reads as a blank dark board; what makes
    // it a window is the divisions.
    const cols = 6;
    const rows = 7;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const px = x - R * 0.94 + (c + 0.5) * (R * 1.88 / cols);
        const py = sillY + 0.3 + (r + 0.5) * ((springY - sillY - 0.6) / rows);
        put(glass, new THREE.BoxGeometry(R * 1.88 / cols * 0.86, (springY - sillY - 0.6) / rows * 0.84, 0.12),
          r > rows - 3 ? 0x9fb4c4 : 0x5c7286, [px, py, wallZ + 0.24]);
      }
    }
    // Fan glazing in the arch head.
    for (let s = 0; s < 7; s++) {
      const a0 = Math.PI * (s + 0.5) / 7;
      put(glass, new THREE.BoxGeometry(R * 0.2, R * 0.9, 0.12), 0x7d94a8,
        [x + Math.cos(a0) * R * 0.5, springY + Math.sin(a0) * R * 0.5, wallZ + 0.24],
        [0, 0, a0 - Math.PI / 2]);
    }
    // Mullions and transoms in front of the glass.
    for (let c = 1; c < cols; c++) {
      put(shell, new THREE.BoxGeometry(0.26, springY - sillY - 0.6, 0.4), STONE.limestoneCool,
        [x - R * 0.94 + c * (R * 1.88 / cols), (sillY + springY) / 2, wallZ + 0.36]);
    }
    for (let r = 1; r < rows; r++) {
      put(shell, new THREE.BoxGeometry(R * 1.9, 0.22, 0.4), STONE.limestoneCool,
        [x, sillY + 0.3 + r * ((springY - sillY - 0.6) / rows), wallZ + 0.36]);
    }
  }

  // --- Entrance -----------------------------------------------------------
  // A triple doorway under a canopy. The doors are dark, divided, and set in a reveal --
  // glazing a whole opening as one sheet is always wrong, and so is a flat black rectangle.
  const doorW = width * 0.055;
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * doorW * 1.35;
    // Same rule as the windows: the dark leaf is a PANEL, and everything that has to be
    // seen sits in front of it.
    put(shell, new THREE.BoxGeometry(doorW, height * 0.20, 0.4), 0x1f1a14, [x, height * 0.10, wallZ + 0.04]);
    put(glass, new THREE.BoxGeometry(doorW * 0.82, height * 0.055, 0.1), 0x4e6478, [x, height * 0.172, wallZ + 0.26]);
    put(shell, new THREE.BoxGeometry(doorW * 0.09, height * 0.20, 0.3), TIMBER.dark, [x, height * 0.10, wallZ + 0.3]);
    put(shell, new THREE.BoxGeometry(doorW, 0.24, 0.34), TIMBER.dark, [x, height * 0.135, wallZ + 0.3]);
  }
  // Canopy: a real glazed marquise on tie rods, which is what the photographs show.
  put(shell, extrudeOutline([
    [-doorW * 2.6, 0], [doorW * 2.6, 0], [doorW * 2.4, 0.55], [-doorW * 2.4, 0.55],
  ], 7.5), STONE.limestoneCool, [0, height * 0.235, wallZ + 3.6], [0.06, 0, 0]);
  for (const sx of [-1, 1]) {
    put(shell, tube([
      [sx * doorW * 2.3, height * 0.235, wallZ + 7.1],
      [sx * doorW * 2.0, height * 0.325, wallZ + 2.2],
      [sx * doorW * 1.9, height * 0.345, wallZ + 0.4],
    ], [0.12, 0.12, 0.12], { sides: 7 }), IRON.dark);
  }
  // Steps up to the door -- and the placard says the doctors watched you climb them.
  for (let s = 0; s < 5; s++) {
    put(shell, new THREE.BoxGeometry(doorW * 5.6 - s * 0.3, 0.42, 1.5),
      s % 2 ? STONE.bluestone : STONE.graniteGrey, [0, 0.21 + s * 0.42, wallZ + 7.4 - s * 1.4]);
  }

  // --- Towers -------------------------------------------------------------
  const towers = [];
  const domes = [];
  const tR = 4.7;
  const tH = height * 1.30;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (width / 2 - tR * 0.52);
      const z = sz * (depth / 2 - tR * 0.52);
      // Battered brick shaft.
      put(towers, solidLoft([
        { d: 0, w: tR, h: tR, round: 0.11 },
        { d: tH * 0.7, w: tR - 0.16, h: tR - 0.16, round: 0.10 },
        { d: tH, w: tR - 0.26, h: tR - 0.26, round: 0.10 },
      ], { axis: 'y', sides: 26, samples: 10 }), BRICK.face, [x, 0, z]);
      // Belvedere: an open arcaded stage under the dome. This is what the towers are FOR
      // and the first pass had them as solid brick to the cap, which is a chimney.
      const belY = tH - 7.2;
      for (const axis2 of [0, 1]) {
        for (const s2 of [-1, 1]) {
          for (let k = -1; k <= 1; k++) {
            const along = k * tR * 0.56;
            const px = axis2 ? along : s2 * tR * 0.86;
            const pz = axis2 ? s2 * tR * 0.86 : along;
            put(towers, new THREE.BoxGeometry(axis2 ? 0.6 : 0.7, 5.0, axis2 ? 0.7 : 0.6),
              STONE.limestone, [x + px, belY + 2.5, z + pz]);
          }
        }
      }
      put(towers, new THREE.BoxGeometry(tR * 1.9, 0.7, tR * 1.9), STONE.limestone, [x, belY, z]);
      // Tower cornice as a ring.
      const tc = mouldedRing([
        [0, 0], [0.55, 0.35], [0.6, 1.0], [0.2, 1.25], [0.24, 1.6], [0, 1.7],
      ], tR * 0.98, tR * 0.98);
      tc.translate(x, tH - 1.9, z);
      put(towers, tc, STONE.limestoneWarm);

      // The dome: a real ogee LATHE, not a scaled hemisphere. Its profile is what makes it
      // read as copper roofing rather than as a ball -- it rises steeply, flattens, and
      // turns up into the lantern.
      const prof = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        prof.push([tR * 1.06 * Math.pow(Math.cos(t * Math.PI / 2), 0.62), tR * 1.28 * Math.pow(Math.sin(t * Math.PI / 2), 0.86)]);
      }
      const domeG = revolve(prof, { segments: 24 });
      put(domes, domeG, COPPER.patina, [x, tH - 0.4, z]);
      // Standing-seam RIBS. A copper dome is sheet metal joined in vertical seams, and the
      // seams are the whole reason it does not read as a smooth green egg.
      for (let r = 0; r < 12; r++) {
        const a = (r / 12) * Math.PI * 2;
        const seam = sweepProfile(
          prof.filter((_, i) => i % 2 === 0).map(([rr, yy]) => [Math.sin(a) * rr, yy, Math.cos(a) * rr]),
          [[0, -0.06], [0.09, 0], [0, 0.06], [-0.09, 0]],
          { samples: 12, capStart: false, capEnd: false },
        );
        put(domes, seam, COPPER.patinaPale, [x, tH - 0.4, z]);
      }
      // Lantern and finial.
      put(domes, revolve([
        [tR * 0.30, 0], [tR * 0.34, 0.4], [tR * 0.30, 0.7],
        [tR * 0.30, 2.6], [tR * 0.38, 2.9], [tR * 0.20, 3.3], [tR * 0.06, 3.9],
      ], { segments: 14 }), COPPER.patinaPale, [x, tH + tR * 1.24 - 0.4, z]);
      spike(domes, COPPER.bronze, { length: 2.6, radius: 0.22, at: [x, tH + tR * 1.24 + 4.9, z], sides: 8 });
    }
  }

  // --- Roof ---------------------------------------------------------------
  // Slate, with the ridge running the long way, plus the three great gables over the
  // Registry Room windows. The gables are what tie the roof to the face below.
  const roof = [];
  // ONE swept gable section along the ridge, not two tipped slabs.
  //
  // A roof's cross-section IS a gable -- up one slope, over the ridge, down the other -- so
  // sweeping that outline along X gives both pitches and the ridge as a single closed solid
  // with no seam to leave open. The first attempt built a slab per side and tipped each
  // about the ridge line, and both came out extending the SAME way in Z: rotating a
  // +Z-extending slab about X tips it, it does not mirror it, so the two pitches lay on top
  // of one another and the whole north side of the building had no roof at all.
  //
  // With up = (0,1,0) a swept profile's x maps to WORLD Z and its y to WORLD Y, which is
  // exactly the frame a roof section wants to be written in.
  {
    const D = depth / 2 + 0.9;
    const rise = depth * 0.30;
    const th = 0.6;
    const gable = sweepProfile(
      [[-width / 2 - 0.9, height + 0.4, 0], [0, height + 0.4, 0], [width / 2 + 0.9, height + 0.4, 0]],
      [[-D, 0], [0, rise], [D, 0], [D, -th], [0, rise - th], [-D, -th]],
      { samples: 4, up: new THREE.Vector3(0, 1, 0) },
    );
    put(roof, gable, SLATE);
    // Slate courses, as shallow grooves rather than stacked boxes: a slate roof reads
    // almost entirely from the shadow line under each course.
    for (let c = 1; c < 9; c++) {
      const t = c / 9;
      for (const side of [-1, 1]) {
        put(roof, new THREE.BoxGeometry(width + 1.6, 0.14, 0.5), c % 2 ? 0x545b64 : 0x424852,
          [0, height + 0.4 + rise * (1 - t) + 0.02, side * D * t], [side * -0.52, 0, 0]);
      }
    }
    // Ridge capping.
    put(roof, sweepProfile(
      [[-width / 2 - 0.9, height + 0.4 + rise, 0], [width / 2 + 0.9, height + 0.4 + rise, 0]],
      [[-0.7, 0], [0, 0.42], [0.7, 0], [0, -0.2]],
      { samples: 2, up: new THREE.Vector3(0, 1, 0) },
    ), COPPER.patinaDeep);
  }
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * width * 0.265;
    const R = width * 0.082;
    // A gable: a pedimented dormer, its face flush with the wall below.
    put(roof, extrudeOutline([
      [-R * 1.3, 0], [R * 1.3, 0], [R * 1.3, 2.2], [0, 5.4], [-R * 1.3, 2.2],
    ], 1.4), BRICK.light, [x, height + 0.4, depth / 2 - 0.6]);
    put(roof, extrudeOutline([
      [-R * 1.45, 0], [R * 1.45, 0], [0, 3.6],
    ], 0.7), STONE.limestone, [x, height + 2.5, depth / 2 + 0.3]);
    put(roof, new THREE.BoxGeometry(R * 1.1, 1.9, 0.5), 0x33404c, [x, height + 1.6, depth / 2 - 0.1]);
  }

  // --- Assembly -----------------------------------------------------------
  // Brick and stone take a per-vertex weathering: coal smoke was universal in 1907 and a
  // harbour building's lower courses are salt-stained. As geometry that would be hundreds
  // of solids per facade; as colour it is free.
  g.add(mesh(
    weather(mergeParts(shell), {
      amount: 0.11, scale: 0.055, wash: 0.30, low: 0, fade: height * 0.7, seed: seed + 3, warm: 0.5,
    }),
    standard({ vertexColors: true, roughness: 0.93, ...relief('stone', { seed, repeat: 10 }) }),
  ));
  g.add(mesh(
    weather(mergeParts(towers), {
      amount: 0.10, scale: 0.05, wash: 0.16, low: 0, fade: tH, seed: seed + 4, warm: 0.5,
    }),
    standard({ vertexColors: true, roughness: 0.93, ...relief('stone', { seed: seed + 1, repeat: 8 }) }),
  ));
  g.add(mesh(
    tintGeometry(mergeParts(domes), (p, c) => {
      const n = smoothNoise3(p.x * 0.5, p.y * 0.28, p.z * 0.5);
      const k = 0.9 + n * 0.22;
      return [c.r * k * 0.98, c.g * k, c.b * k * 0.98];
    }),
    standard({ vertexColors: true, roughness: 0.54, metalness: 0.32, ...relief('metal', { seed: seed + 2, repeat: 5 }) }),
  ));
  g.add(mesh(mergeParts(roof), standard({
    vertexColors: true, roughness: 0.78, ...relief('stone', { seed: seed + 5, repeat: 7 }),
  })));
  // Glass is its own mesh: slightly glossy, and it must NOT take the brick's relief map.
  g.add(mesh(mergeParts(glass), standard({
    vertexColors: true, roughness: 0.22, metalness: 0.16,
  })));

  // Flagpole on the centre of the ridge, because every photograph has one.
  g.add(mesh(
    revolve([[0.34, 0], [0.3, 1.2], [0.16, 16], [0.1, 18]], { segments: 10 }),
    standard({ color: 0xe8e2d4, roughness: 0.7 }),
    0, height + 5.8, 0,
  ));
  return g;
}

// ---------------------------------------------------------------------------
// The harbour
// ---------------------------------------------------------------------------

// An immigrant steamship at the pier: black hull, white upperworks, funnels with the line's
// bands. Third class was below the waterline at the stern, over the propellers -- the
// noisiest, roughest berth on the ship, and where most arrivals travelled.
//
// The hull is ONE lofted solid and its section changes shape the whole way: a fine sharp
// wedge at the stem, hard-chined and flat-floored amidships to carry the cargo, and a
// rounded counter under the stern. `taperedTube` sweeps a circle, so the old hull had one
// aspect ratio from end to end and read as a floating log with a house on it.
export function steamship({ length = 96, seed = 17, funnels = 2 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];
  const rng = seededRandom(seed);
  const beam = length * 0.135;
  const halfL = length / 2;
  const draft = length * 0.052;   // how far the hull sits below the waterline at y = 0
  const freeboard = length * 0.088;

  // Stations run stern (-) to bow (+). `b` is the sheer line: it rises at both ends, and
  // that rise is most of what makes a hull look like a ship rather than a barge.
  const stations = [
    { d: -halfL * 1.00, w: beam * 0.10, up: freeboard * 0.50, dn: draft * 0.20, round: 1.2, b: freeboard * 0.30 },
    { d: -halfL * 0.94, w: beam * 0.34, up: freeboard * 0.62, dn: draft * 0.42, round: 1.4, b: freeboard * 0.22 },
    { d: -halfL * 0.82, w: beam * 0.62, up: freeboard * 0.74, dn: draft * 0.72, round: 1.3, b: freeboard * 0.14 },
    { d: -halfL * 0.60, w: beam * 0.86, up: freeboard * 0.86, dn: draft * 0.94, round: 0.95, b: freeboard * 0.05 },
    { d: -halfL * 0.28, w: beam * 0.98, up: freeboard * 0.94, dn: draft * 1.00, round: 0.66, b: 0 },
    { d: 0, w: beam * 1.00, up: freeboard * 0.96, dn: draft * 1.00, round: 0.58, b: 0 },
    // A FINE ENTRY. At beam*0.80 two thirds of the way to the stem the ship was still 21ft
    // across, so the foredeck stayed nearly full width until it suddenly stopped -- which
    // from the pier read as a broad flat wedge rather than as a bow. A hull's forward
    // waterlines are hollow; these are the numbers that make the entry look like it could
    // cut water.
    { d: halfL * 0.30, w: beam * 0.94, up: freeboard * 0.98, dn: draft * 0.98, round: 0.62, b: freeboard * 0.02 },
    { d: halfL * 0.58, w: beam * 0.68, up: freeboard * 1.04, dn: draft * 0.88, round: 0.80, b: freeboard * 0.10 },
    { d: halfL * 0.80, w: beam * 0.36, up: freeboard * 1.14, dn: draft * 0.66, round: 1.1, b: freeboard * 0.22 },
    { d: halfL * 0.94, w: beam * 0.13, up: freeboard * 1.24, dn: draft * 0.34, round: 1.5, b: freeboard * 0.34 },
    { d: halfL * 1.00, w: beam * 0.03, up: freeboard * 1.28, dn: draft * 0.10, round: 1.8, b: freeboard * 0.40 },
  ];
  const hull = solidLoft(stations, { sides: 34, samples: 56 });
  const sample = loftSampler(stations);
  // The hull is painted by POSITION rather than in pieces: black topsides, a red boot
  // topping at the waterline, and the white sheer strake. Three painted bands on one solid
  // cannot be a hair out of line with each other, which three separate boxes always were.
  // THE PAINT BANDS ARE MEASURED AGAINST THE LOCAL SHEER, NOT AGAINST ABSOLUTE HEIGHT.
  //
  // A hull's sheer line rises 3.5ft toward the bow here, so a white sheer strake defined as
  // "y between 7.0 and 9.0" is in the right place amidships and completely wrong at the
  // ends: at the stem the entire side of the ship sits above 7.0, so the whole bow came out
  // painted white and the black topsides only existed in the middle third. Asking the loft
  // where its own deck edge is at this station -- which is what `tAtD` exists for -- puts
  // every band parallel to the sheer, the way a painter actually works.
  //
  // The waterline is y = 0 because a prop's origin is its base centre and this hull is
  // authored with its draft below that.
  put(parts, tintGeometry(hull, (p) => {
    const s = sample.at(sample.tAtD(p.z));
    const above = p.y - s.b;                       // height above this station's centre line
    const frac = above / s.up;                     // 1.0 at the deck edge
    const lateral = Math.abs(p.x - s.a) / s.w;     // 0 on the centre line, 1 at max beam
    // A LOFT IS A CLOSED SOLID, SO ITS TOP IS THE DECK. A sheer strake defined only by
    // height therefore painted the whole weather deck white as well as the top of the
    // sides -- and at the bow, where the section is narrow and tall, that produced a broad
    // flat white wedge that read as a slab of polystyrene stuck on the front of the ship.
    // The band has to be qualified by how far OUT the point is, not just how high.
    if (frac > 0.86 && lateral < 0.66) {
      const k = 0.9 + smoothNoise3(p.x * 0.8, 0, p.z * 0.8) * 0.2;
      return [0.44 * k, 0.37 * k, 0.27 * k];                        // scrubbed timber deck
    }
    if (above < -s.dn * 0.42) return [0.40, 0.15, 0.11];            // antifouling
    if (p.y < freeboard * 0.10) return [0.52, 0.18, 0.14];          // boot topping at the waterline
    if (frac > 0.80) return [0.84, 0.81, 0.76];                     // white sheer strake
    // UNDER A BRIGHT SKY A DARK SURFACE CANNOT RENDER DARK, so a black hull has to be
    // authored far below its true albedo. This theme carries a 1.45-intensity hemisphere
    // over a 2.2 sun -- a cold clear harbour morning -- and a flat 0.10 grey measured on
    // screen at about 45%: the ship read as battleship grey and no amount of adjusting the
    // paint BANDS touched it, because the bands were never wrong. (The exact inverse of the
    // metalness-0.9-renders-black trap: there, too much specular and no environment to
    // reflect; here, too much ambient for the albedo to survive.)
    const k = 0.88 + smoothNoise3(p.x * 0.4, p.y * 0.6, p.z * 0.16) * 0.3;
    return [0.045 * k, 0.05 * k, 0.062 * k];
  }), 0xffffff, null, null, { keepColor: true });

  // Bulwark rail round the weather deck, following the sheer.
  {
    const railPts = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const d = -halfL * 0.95 + t * (halfL * 1.9);
      const tt = sample.tAtD(d);
      const s = sample.at(tt);
      railPts.push([s.w * 0.99, s.b + s.up * 0.99, d]);
    }
    for (const side of [-1, 1]) {
      put(parts, sweepProfile(railPts.map(([x, y, z]) => [x * side, y, z]),
        [[-0.10, 0], [0.10, 0], [0.10, 0.34], [-0.10, 0.34]], { samples: 30 }), SHIP.white);
    }
  }

  // Portholes, placed by asking the loft where its own surface is at that station rather
  // than by guessing a constant offset -- which is why the old row sank into the bow.
  for (let i = 0; i < 22; i++) {
    const d = -halfL * 0.72 + i * (halfL * 1.44 / 21);
    const t = sample.tAtD(d);
    const s = sample.at(t);
    // 0.58 of the way up the freeboard, measured against the LOCAL deck edge so the row
    // follows the sheer. At 0.34 they sat barely three feet above the waterline, which on a
    // ship with nine feet of freeboard is where the bilge is, not where a cabin is.
    const y = s.b + s.up * 0.58;
    for (const side of [-1, 1]) {
      const u = sample.uAtB(t, y);
      const surf = sample(t, u);
      const px = Math.abs(surf[0]) * side;
      put(parts, new THREE.CylinderGeometry(0.30, 0.30, 0.34, 10), SHIP.brass,
        [px * 0.995, y, d], [0, 0, Math.PI / 2]);
      put(glass, new THREE.CylinderGeometry(0.21, 0.21, 0.40, 8), 0x2f3a44,
        [px * 1.01, y, d], [0, 0, Math.PI / 2]);
    }
  }

  // --- Superstructure -----------------------------------------------------
  // Three tiers, each shorter than the one below, with real deckhouse fronts and window
  // rows. Built as plain boxes the upperworks read as packing cases.
  const deckY = freeboard * 0.98;
  const tiers = [
    { y: deckY, h: length * 0.048, halfW: beam * 0.86, from: -halfL * 0.34, to: halfL * 0.40 },
    { y: deckY + length * 0.048, h: length * 0.044, halfW: beam * 0.70, from: -halfL * 0.26, to: halfL * 0.30 },
    { y: deckY + length * 0.092, h: length * 0.038, halfW: beam * 0.52, from: -halfL * 0.16, to: halfL * 0.16 },
  ];
  for (const [ti, t] of tiers.entries()) {
    const mid = (t.from + t.to) / 2;
    const len = t.to - t.from;
    put(parts, solidLoft([
      { d: t.from, w: t.halfW * 0.86, h: t.h / 2, round: 0.2 },
      { d: t.from + len * 0.12, w: t.halfW, h: t.h / 2, round: 0.14 },
      { d: t.to - len * 0.12, w: t.halfW, h: t.h / 2, round: 0.14 },
      { d: t.to, w: t.halfW * 0.82, h: t.h / 2, round: 0.22 },
    ], { sides: 20, samples: 14 }), ti ? SHIP.whiteBright : SHIP.white, [0, t.y + t.h / 2, 0]);
    // Window rows along both flanks.
    const n = Math.round(len / (length * 0.026));
    for (let i = 0; i < n; i++) {
      const z = t.from + (i + 0.5) * (len / n);
      for (const side of [-1, 1]) {
        put(glass, new THREE.BoxGeometry(0.14, t.h * 0.40, length * 0.016), 0x3d4b58,
          [side * t.halfW * 1.005, t.y + t.h * 0.56, z]);
      }
    }
    // Deck edge, so each tier has a lip rather than a raw corner.
    const edge = mouldedRing([[0, 0], [0.26, 0.1], [0.26, 0.34], [0, 0.42]], t.halfW, len / 2);
    edge.translate(0, t.y + t.h, mid);
    put(parts, edge, SHIP.whiteBright);
  }
  // Bridge, with a full row of windows and the wings projecting past the hull.
  const brY = deckY + length * 0.130;
  put(parts, solidLoft([
    { d: -length * 0.030, w: beam * 0.66, h: length * 0.017, round: 0.2 },
    { d: length * 0.006, w: beam * 0.70, h: length * 0.017, round: 0.16 },
    { d: length * 0.034, w: beam * 0.60, h: length * 0.017, round: 0.4 },
  ], { sides: 18, samples: 10 }), SHIP.whiteBright, [0, brY + length * 0.017, -halfL * 0.14]);
  for (let i = 0; i < 9; i++) {
    const bx = (i / 8 - 0.5) * beam * 1.16;
    put(glass, new THREE.BoxGeometry(beam * 0.12, length * 0.017, 0.16), 0x33414e,
      [bx, brY + length * 0.020, -halfL * 0.14 + length * 0.034]);
  }

  // --- Funnels ------------------------------------------------------------
  // Raked aft, and the rake is the ship's period: a 1900s liner's funnels lean back.
  for (let i = 0; i < funnels; i++) {
    const z = -length * 0.03 + (i - (funnels - 1) / 2) * length * 0.135;
    const fH = length * 0.145;
    const fR = beam * 0.17;
    const funnel = revolve([
      [fR * 1.06, 0], [fR, fH * 0.1], [fR * 0.94, fH * 0.86], [fR * 0.94, fH],
    ], { segments: 20 });
    put(parts, funnel, SHIP.funnel, [0, brY + length * 0.02, z], [-0.13, 0, 0]);
    // The black top band, and a real lip -- a funnel is a tube and you can see into it.
    put(parts, revolve([
      [fR * 0.94, 0], [fR * 0.94, fH * 0.20], [fR * 0.86, fH * 0.20], [fR * 0.86, 0],
    ], { segments: 20 }), SHIP.funnelTop, [0, brY + length * 0.02 + fH * 0.88, z + fH * 0.11], [-0.13, 0, 0]);
    // Steam pipes up the side, which every funnel of this era carries.
    for (const side of [-1, 1]) {
      put(parts, tube([
        [side * fR * 0.9, brY + length * 0.03, z + fH * 0.02],
        [side * fR * 0.95, brY + length * 0.03 + fH * 0.6, z - fH * 0.06],
        [side * fR * 0.9, brY + length * 0.03 + fH * 1.02, z - fH * 0.12],
      ], [0.11, 0.1, 0.1], { sides: 6 }), SHIP.rust);
    }
  }
  // Ventilator cowls -- the mushroom-topped trumpets that say "steamship" more than
  // anything else on the deck.
  for (let i = 0; i < 6; i++) {
    const z = -halfL * 0.30 + i * (halfL * 0.62 / 5);
    const side = i % 2 ? 1 : -1;
    const cowl = revolve([
      [0.22, 0], [0.22, length * 0.028], [0.30, length * 0.032], [0.52, length * 0.036], [0.50, length * 0.030],
    ], { segments: 12 });
    put(parts, cowl, SHIP.buff, [side * beam * 0.62, deckY, z]);
    put(parts, revolve([[0.05, 0], [0.5, 0.04], [0.52, 0.34], [0.2, 0.42]], { segments: 12 }),
      SHIP.buff, [side * beam * 0.62, deckY + length * 0.036, z], [0.9, 0, 0]);
  }

  // --- Masts, derricks and rigging ---------------------------------------
  for (const [mi, z] of [[-halfL * 0.44, 0], [halfL * 0.50, 1]].entries()) {
    void mi;
    const mz = z === 0 ? -halfL * 0.44 : halfL * 0.50;
    const mH = length * 0.28;
    put(parts, revolve([[0.42, 0], [0.34, mH * 0.6], [0.20, mH], [0.14, mH * 1.06]], { segments: 10 }),
      TIMBER.oak, [0, deckY, mz]);
    // Yard.
    put(parts, revolve([[0.20, 0], [0.16, beam * 1.0], [0.09, beam * 1.1]], { segments: 8 }),
      TIMBER.oak, [0, deckY + mH * 0.62, mz], [0, 0, Math.PI / 2]);
    put(parts, revolve([[0.20, 0], [0.16, beam * 1.0], [0.09, beam * 1.1]], { segments: 8 }),
      TIMBER.oak, [0, deckY + mH * 0.62, mz], [0, 0, -Math.PI / 2]);
    // Stays, as real swept lines. A rigged ship without them reads as a toy.
    for (const side of [-1, 1]) {
      put(parts, tube([
        [0, deckY + mH * 0.98, mz],
        [side * beam * 0.6, deckY + mH * 0.5, mz + (z === 0 ? -length * 0.06 : length * 0.06)],
        [side * beam * 0.92, deckY, mz + (z === 0 ? -length * 0.12 : length * 0.12)],
      ], [0.05, 0.05, 0.05], { sides: 5 }), IRON.galv);
    }
    // Cargo derrick, swung out.
    put(parts, tube([
      [0, deckY + mH * 0.2, mz],
      [beam * 0.5, deckY + mH * 0.5, mz + (z === 0 ? length * 0.05 : -length * 0.05)],
      [beam * 0.95, deckY + mH * 0.62, mz + (z === 0 ? length * 0.10 : -length * 0.10)],
    ], [0.2, 0.16, 0.12], { sides: 7 }), TIMBER.oak);
  }

  // --- Ground tackle and boats -------------------------------------------
  // The anchor and its hawse pipe at the bow, and lifeboats in davits along the boat deck.
  for (const side of [-1, 1]) {
    const t = sample.tAtD(halfL * 0.80);
    const s = sample.at(t);
    put(parts, new THREE.CylinderGeometry(0.42, 0.42, 0.5, 10), IRON.dark,
      [side * s.w * 0.94, s.b + s.up * 0.34, halfL * 0.80], [0, 0, Math.PI / 2]);
    // A stock anchor hanging at the hawse.
    put(parts, tube([
      [side * s.w * 1.02, s.b + s.up * 0.28, halfL * 0.78],
      [side * s.w * 1.05, s.b - s.up * 0.30, halfL * 0.76],
    ], [0.14, 0.12], { sides: 6 }), IRON.dark);
    put(parts, tube([
      [side * s.w * 1.05 - side * 0.8, s.b - s.up * 0.10, halfL * 0.76],
      [side * s.w * 1.05, s.b - s.up * 0.34, halfL * 0.76],
      [side * s.w * 1.05 + side * 0.8, s.b - s.up * 0.10, halfL * 0.76],
    ], [0.10, 0.13, 0.10], { sides: 6 }), IRON.dark);
  }
  for (let i = 0; i < 4; i++) {
    const z = -halfL * 0.20 + i * (halfL * 0.44 / 3);
    for (const side of [-1, 1]) {
      const bx = side * beam * 0.58;
      const by = brY - length * 0.005;
      // A boat is a little lofted hull of its own -- a box in a davit is a crate.
      put(parts, solidLoft([
        { d: -length * 0.032, w: 0.06, up: 0.10, dn: 0.05, round: 1.4 },
        { d: -length * 0.018, w: length * 0.011, up: length * 0.008, dn: length * 0.006, round: 0.9 },
        { d: length * 0.018, w: length * 0.011, up: length * 0.008, dn: length * 0.006, round: 0.9 },
        { d: length * 0.032, w: 0.06, up: 0.10, dn: 0.05, round: 1.4 },
      ], { sides: 14, samples: 12 }), SHIP.whiteBright, [bx, by, z]);
      // Davits, curving out over the side.
      for (const e of [-1, 1]) {
        put(parts, tube([
          [bx * 0.86, by - length * 0.012, z + e * length * 0.026],
          [bx * 1.00, by + length * 0.020, z + e * length * 0.026],
          [bx * 1.14, by + length * 0.010, z + e * length * 0.026],
        ], [0.11, 0.09, 0.08], { sides: 6 }), IRON.galv);
      }
    }
  }
  // Deck planking amidships, where a student can actually see it from the pier.
  //
  // A DECK CANNOT BE WIDER THAN THE HULL AT ITS OWN STATION. The first version laid 14
  // planks `beam * 1.7` wide and `halfL * 1.5` LONG -- 23ft by 75ft on a hull whose ends
  // taper to 2.7ft -- so at both ends the deck hung several feet out past the plating and
  // read as one big pale slab bolted to the ship's side, hiding the black topsides
  // completely. Each plank is now clipped to the hull's own half-width along its run, which
  // is exactly what `tAtD` is for.
  const deckFrom = -halfL * 0.62;
  const deckTo = halfL * 0.66;
  for (let i = 0; i < 12; i++) {
    const frac = (i + 0.5) / 12 - 0.5;         // -0.5 .. 0.5 across the beam
    // Find the run of z over which the hull is wide enough to carry this plank.
    let z0 = deckFrom;
    let z1 = deckTo;
    const wideEnough = (z) => {
      const s = sample.at(sample.tAtD(z));
      return s.w * 0.90 >= Math.abs(frac) * beam * 1.62 + beam * 0.06;
    };
    while (z0 < z1 && !wideEnough(z0)) z0 += 0.5;
    while (z1 > z0 && !wideEnough(z1)) z1 -= 0.5;
    if (z1 - z0 < 2) continue;
    put(parts, new THREE.BoxGeometry(beam * 1.62 / 12 * 0.86, 0.12, z1 - z0),
      i % 2 ? TIMBER.deck : TIMBER.plank, [frac * beam * 1.62, deckY + 0.06, (z0 + z1) / 2]);
  }

  // A PAINTED HULL IS NOT METALLIC, and it must not carry a strong relief map.
  //
  // At metalness 0.22 with a `metal` bump at full strength and repeat 12, the black
  // topsides rendered as a pale warm GREY: metalness on a surface with no environment map
  // to reflect turns into a broad specular sheen, and an 8ft-tile bump on a big smooth
  // curved side scatters that sheen across the whole flank. Between them they washed a
  // near-black hull to about 60% grey, and no amount of darkening the vertex colour fixed
  // it because the colour was never the problem.
  //
  // Ship's paint over riveted plate is matte with just enough tooth to catch the light.
  g.add(mesh(
    weather(mergeParts(parts), { amount: 0.09, scale: 0.09, wash: 0.2, low: -draft, fade: freeboard * 3, seed: seed + 6 }),
    standard({
      vertexColors: true, roughness: 0.86, metalness: 0.08,
      ...relief('metal', { seed, repeat: 22, strength: 0.35 }),
    }),
  ));
  g.add(mesh(mergeParts(glass), standard({ vertexColors: true, roughness: 0.2, metalness: 0.25 })));

  // Funnel smoke -- SPRITES, not quads.
  //
  // A moored steamship with dead-cold funnels reads as a hulk, so it is worth the three
  // transparent draws. But a PlaneGeometry has a fixed orientation and these ships are
  // approached from the side, where a plane is edge-on and vanishes; a Sprite billboards to
  // the camera for free, which is the same reason the play icon is one. Deliberately only
  // three per funnel and faint: a ship at the pier has banked fires, not a full head of
  // steam, and turned up far enough to really notice it stops reading as smoke.
  const smokeTex = canvasTexture(128, 128, (ctx, w, h) => {
    const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(72,72,76,0.55)');
    grd.addColorStop(0.5, 'rgba(84,84,88,0.2)');
    grd.addColorStop(1, 'rgba(94,94,98,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  });
  for (let i = 0; i < funnels; i++) {
    const z = -length * 0.03 + (i - (funnels - 1) / 2) * length * 0.135;
    for (let k = 0; k < 3; k++) {
      const size = length * (0.09 + k * 0.05);
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, opacity: 0.42 - k * 0.11, depthWrite: false,
        fog: true, color: 0xffffff,
      }));
      puff.scale.set(size, size, 1);
      puff.position.set(
        randomIn(rng, -1.2, 1.2) - k * 1.1,
        brY + length * (0.19 + k * 0.062),
        z - k * length * 0.042,
      );
      g.add(puff);
    }
  }
  return g;
}

// A timber pier with bollards, fenders and a gangway.
export function ferryPier({ length = 44, width = 16, seed = 23 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const deckY = 3.0;

  // Deck planks, laid ACROSS the pier as real planks with gaps between them.
  const planks = Math.round(length / 1.3);
  for (let i = 0; i < planks; i++) {
    const z = -length / 2 + (i + 0.5) * (length / planks);
    const tone = [TIMBER.deck, TIMBER.plank, TIMBER.oak, 0x5f5040][i % 4];
    put(parts, new THREE.BoxGeometry(width, 0.30, (length / planks) * 0.84), tone,
      [0, deckY, z], [0, 0, (rng() - 0.5) * 0.006]);
  }
  // Stringers and cross beams under the deck -- visible from the water and from the shore
  // end, and without them the deck is a floating plank raft.
  for (const sx of [-1, -0.34, 0.34, 1]) {
    put(parts, new THREE.BoxGeometry(0.7, 0.8, length), TIMBER.dark, [sx * (width / 2 - 0.9), deckY - 0.55, 0]);
  }
  for (let i = 0; i <= 8; i++) {
    put(parts, new THREE.BoxGeometry(width, 0.6, 0.8), TIMBER.dark, [0, deckY - 1.1, -length / 2 + i * (length / 8)]);
  }
  // Piles: raked outward in pairs, cross-braced, with a rough sawn top. A vertical
  // cylinder is a fence post; a raked braced pair is a pier.
  for (let i = 0; i <= 6; i++) {
    const z = -length / 2 + i * (length / 6);
    for (const side of [-1, 1]) {
      const top = [side * (width / 2 - 0.8), deckY - 0.9, z];
      const foot = [side * (width / 2 + 0.9), -2.6, z];
      put(parts, tube([top, [(top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2, z], foot],
        [0.46, 0.52, 0.6], { sides: 10 }), TIMBER.tar);
      // Barnacle/weed band at the waterline, as colour on its own small band.
      put(parts, new THREE.CylinderGeometry(0.62, 0.66, 1.1, 10), 0x4a5240,
        [side * (width / 2 + 0.42), -0.3, z]);
    }
    if (i < 6) {
      for (const side of [-1, 1]) {
        put(parts, new THREE.BoxGeometry(0.3, 0.3, length / 6 * 1.12), TIMBER.plank,
          [side * (width / 2 + 0.3), -0.4, z + length / 12], [0.36 * side, 0, 0]);
      }
    }
  }
  // Fender timbers down both sides -- what a ship actually comes alongside against.
  for (const side of [-1, 1]) {
    put(parts, new THREE.BoxGeometry(0.8, 1.2, length * 0.98), TIMBER.tar,
      [side * (width / 2 + 0.5), deckY - 0.3, 0]);
  }
  // Bollards: cast iron, waisted, with a real mushroom head.
  for (let i = 0; i < 5; i++) {
    const z = -length * 0.38 + i * (length * 0.19);
    put(parts, revolve([
      [0.56, 0], [0.60, 0.22], [0.44, 0.5], [0.40, 1.35], [0.52, 1.6], [0.56, 1.75],
      [0.44, 1.92], [0.2, 2.0],
    ], { segments: 14 }), IRON.dark, [width / 2 - 1.5, deckY + 0.15, z]);
    // A coil of rope on the deck by every other one.
    if (i % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        put(parts, new THREE.TorusGeometry(0.55 + k * 0.16, 0.11, 6, 14), 0x9a8a68,
          [width / 2 - 3.0, deckY + 0.24 + k * 0.02, z], [Math.PI / 2, 0, 0]);
      }
    }
  }
  // Handrail down the shore side, and a mooring cleat or two.
  for (let i = 0; i <= 6; i++) {
    put(parts, new THREE.CylinderGeometry(0.13, 0.15, 3.2, 8), IRON.cold,
      [-width / 2 + 0.9, deckY + 1.6, -length / 2 + i * (length / 6)]);
  }
  for (const y of [3.0, 4.3]) {
    put(parts, new THREE.CylinderGeometry(0.09, 0.09, length * 0.99, 6), IRON.cold,
      [-width / 2 + 0.9, deckY + y - 1.2, 0], [Math.PI / 2, 0, 0]);
  }
  return group(mesh(
    weather(mergeParts(parts), { amount: 0.14, scale: 0.12, wash: 0.42, low: -2.6, fade: 5, seed: seed + 2 }),
    standard({ vertexColors: true, roughness: 0.92, ...relief('wood', { seed, repeat: 8 }) }),
  ));
}

// The baggage. Deliberately the biggest single mass on the dock: what people brought was
// everything they owned, and the photographs of the baggage room are the ones that carry
// the weight of it.
//
// A trunk is defined by its BANDS and its LID, and the lid has to be a real domed lid on a
// real box -- the commonest trunk of 1907 is a barrel-top, and a flat box with a stripe
// round it is a packing crate. Every trunk here is a rounded-outline extrusion so its
// corners are bound rather than sharp.
export function baggagePile({ count = 26, spread = 9, seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const w = randomIn(rng, 1.7, 3.5);
    const h = randomIn(rng, 1.0, 1.9);
    const dp = randomIn(rng, 1.2, 2.1);
    const layer = Math.floor(i / 9);
    const x = randomIn(rng, -spread, spread) * (1 - layer * 0.22);
    const z = randomIn(rng, -spread * 0.6, spread * 0.6) * (1 - layer * 0.22);
    const y = layer * 1.72 + h / 2;
    const rotY = randomIn(rng, -0.5, 0.5);
    const colour = LEATHER[i % LEATHER.length];
    const domed = i % 3 === 0;

    // The body: a rounded-corner box, so the trunk has bound edges.
    put(parts, extrudeOutline(roundedOutline(w / 2, h / 2, Math.min(w, h) * 0.13, 2), dp),
      colour, [x, y, z], [0, rotY, 0]);
    // A barrel top on a third of them.
    if (domed) {
      put(parts, sweepProfile(
        [[0, 0, -dp / 2], [0, 0, 0], [0, 0, dp / 2]],
        [[-w / 2, 0], [w / 2, 0], [w / 2 * 0.86, h * 0.22], [0, h * 0.30], [-w / 2 * 0.86, h * 0.22]],
        { samples: 4 },
      ), colour, [x, y + h / 2, z], [0, rotY, 0]);
    }
    // Straps: two bands right round the trunk, and they must go round the LID as well.
    for (const t of [-0.28, 0.28]) {
      const bandH = domed ? h * 1.02 + h * 0.30 : h * 1.03;
      const bandY = domed ? y + h * 0.15 : y;
      put(parts, extrudeOutline(roundedOutline(w * 0.055, bandH / 2, w * 0.03, 1), dp * 1.04),
        0x2f2419, [x + Math.cos(rotY) * w * t, bandY, z - Math.sin(rotY) * w * t], [0, rotY, 0]);
    }
    // The lid seam, plus corner caps and a lock plate.
    put(parts, extrudeOutline(roundedOutline(w / 2 * 1.02, h * 0.06, w * 0.02, 1), dp * 1.02),
      0x2f2419, [x, y + h * 0.30, z], [0, rotY, 0]);
    put(parts, new THREE.BoxGeometry(w * 0.16, h * 0.14, 0.1), SHIP.brass,
      [x + Math.sin(rotY) * dp * 0.51, y + h * 0.30, z + Math.cos(rotY) * dp * 0.51], [0, rotY, 0]);
    for (const cx of [-1, 1]) {
      for (const cz of [-1, 1]) {
        dome(parts, 0x3f3128, {
          radius: Math.min(w, dp) * 0.11, height: Math.min(w, dp) * 0.06,
          at: [x + cx * w * 0.42 * Math.cos(rotY) + cz * dp * 0.42 * Math.sin(rotY),
            y - h * 0.42,
            z - cx * w * 0.42 * Math.sin(rotY) + cz * dp * 0.42 * Math.cos(rotY)],
          detail: 6, sink: 0.4,
        });
      }
    }
    // A paper label pasted on, which is exactly how a trunk was tracked -- and the
    // placard's point about a person becoming a row in a ledger.
    if (i % 4 === 1) {
      put(parts, new THREE.BoxGeometry(w * 0.34, h * 0.3, 0.06), 0xd8cfb4,
        [x + Math.sin(rotY) * dp * 0.52, y + h * 0.02, z + Math.cos(rotY) * dp * 0.52], [0, rotY, 0]);
    }
    // Bundles tied in cloth, which is what most people actually carried. A knot on top is
    // what makes it a bundle rather than a boulder.
    if (i % 5 === 0) {
      const br = randomIn(rng, 0.7, 1.1);
      const bx = x + randomIn(rng, -1.4, 1.4);
      const bz = z + randomIn(rng, -1, 1);
      const by = y + h * 0.5 + br * 0.5;
      const cloth = [0x8a7a5c, 0x6b6a48, 0x9a8464, 0x7d6a72][i % 4];
      // Grooves in ONE surface, which is what a cloth tied round a bundle actually is --
      // as separate solids the ties either sank in or floated off.
      put(parts, solidLoft([
        { d: -br, w: br * 0.2, h: br * 0.2 },
        { d: -br * 0.5, w: br * 0.94, h: br * 0.9 },
        { d: br * 0.4, w: br * 1.0, h: br * 0.94 },
        { d: br * 0.9, w: br * 0.5, h: br * 0.5 },
      ], {
        axis: 'y', sides: 22, samples: 20,
        warp: (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * 2 + 0.4), 0.24, s.w * 0.13),
      }), cloth, [bx, by, bz], [0, rng() * 3, 0]);
      // The knot.
      for (const k of [-1, 1]) {
        put(parts, new THREE.SphereGeometry(br * 0.16, 8, 6), cloth,
          [bx + k * br * 0.2, by + br * 0.82, bz + k * br * 0.1]);
      }
    }
  }
  return group(mesh(
    weather(mergeParts(parts), { amount: 0.13, scale: 0.2, wash: 0.14, low: 0, fade: 6, seed: seed + 1 }),
    standard({ vertexColors: true, roughness: 0.9, ...relief('weave', { seed: seed + 1, repeat: 6 }) }),
  ));
}

// The inspection line: iron pens with a rail, the doctor's desk and a chalk board. The rail
// is the exhibit -- the Registry Room was divided into iron pens and you queued in one for
// hours.
export function inspectionLine({ length = 26, seed = 31 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // The pens. Real turned newel posts with finials rather than plain cylinders, and three
  // rails including a bottom one -- which is what stops the pen reading as a fence.
  for (const zOff of [0, -7]) {
    const posts = Math.round(length / 3.5);
    for (let i = 0; i <= posts; i++) {
      put(parts, revolve([
        [0.20, 0], [0.22, 0.18], [0.13, 0.36], [0.13, 2.9], [0.19, 3.06],
        [0.13, 3.2], [0.13, 3.34], [0.2, 3.5], [0.1, 3.7],
      ], { segments: 10 }), IRON.cold, [-length / 2 + i * (length / posts), 0, zOff]);
    }
    for (const y of [0.5, 1.5, 2.6, 3.24]) {
      put(parts, new THREE.CylinderGeometry(0.07, 0.07, length, 7), IRON.cold,
        [0, y, zOff], [0, 0, Math.PI / 2]);
    }
    // Vertical balusters between the rails, spaced closely -- an iron pen is a cage.
    const bal = Math.round(length / 0.85);
    for (let i = 0; i < bal; i++) {
      put(parts, new THREE.CylinderGeometry(0.045, 0.045, 2.16, 5), IRON.galv,
        [-length / 2 + (i + 0.5) * (length / bal), 1.58, zOff]);
    }
  }

  // The desk at the head of the line, with a ledger, an inkwell and a chalk box.
  const dx = length / 2 + 3.6;
  put(parts, extrudeOutline(roundedOutline(2.7, 1.3, 0.16, 2), 0.34), TIMBER.oak,
    [dx, 3.0, -3.5], [Math.PI / 2, 0, 0]);
  // Panelled desk ends, not four legs -- a clerk's desk of this period is a box.
  for (const sx of [-1, 1]) {
    put(parts, new THREE.BoxGeometry(0.34, 2.9, 2.3), TIMBER.plank, [dx + sx * 2.4, 1.5, -3.5]);
    put(parts, new THREE.BoxGeometry(0.16, 2.2, 1.9), TIMBER.dark, [dx + sx * 2.2, 1.5, -3.5]);
  }
  put(parts, new THREE.BoxGeometry(4.6, 1.9, 0.2), TIMBER.plank, [dx, 1.9, -4.55]);
  // The ledger, open, with ruled pages.
  put(parts, new THREE.BoxGeometry(2.3, 0.2, 1.6), 0xe4dcc6, [dx, 3.26, -3.5], [0, 0.2, 0]);
  put(parts, new THREE.BoxGeometry(2.4, 0.1, 0.14), 0x6b4a2c, [dx, 3.34, -3.5], [0, 0.2, 0]);
  put(parts, revolve([[0.2, 0], [0.22, 0.3], [0.14, 0.36], [0.13, 0.44]], { segments: 8 }),
    0x2b3138, [dx + 1.5, 3.2, -2.7]);
  // A stool with a turned pedestal.
  put(parts, revolve([
    [0.78, 0], [0.78, 0.18], [0.3, 0.3], [0.22, 1.7], [0.3, 1.9], [0.9, 2.05], [0.9, 2.24],
  ], { segments: 12 }), TIMBER.oak, [dx, 0, -6.2]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put(parts, tube([
      [dx + Math.cos(a) * 0.24, 0.34, -6.2 + Math.sin(a) * 0.24],
      [dx + Math.cos(a) * 0.66, 0.08, -6.2 + Math.sin(a) * 0.66],
    ], [0.1, 0.12], { sides: 5 }), TIMBER.dark);
  }
  // The chalk letters board -- E for eyes, H for heart, X for suspected mental illness.
  // The one object on the dock that carries what the inspection actually did.
  let boardPanel = null;
  let boardFrame = null;
  {
    const boardTex = canvasTexture(512, 320, (ctx, w, h) => {
      ctx.fillStyle = '#2b3029'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(220,225,215,${0.02 + rng() * 0.04})`;
        ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 20, 90), 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#e8ece2';
      ctx.textAlign = 'center';
      ctx.font = 'bold 40px Georgia, serif';
      ctx.fillText('CHALK MARKS', w / 2, 54);
      ctx.font = 'bold 62px Georgia, serif';
      const marks = [['E', 'eyes'], ['H', 'heart'], ['X', 'mind']];
      marks.forEach(([L, word], i) => {
        const cx = w * (0.2 + i * 0.3);
        ctx.font = 'bold 86px Georgia, serif';
        ctx.fillText(L, cx, 170);
        ctx.font = '30px Georgia, serif';
        ctx.fillText(word, cx, 214);
      });
      ctx.font = 'italic 26px Georgia, serif';
      ctx.fillText('a letter on your coat meant a second look', w / 2, 276);
    });
    boardPanel = signPanel(5.4, 3.4, boardTex);
    boardPanel.position.set(dx + 0.6, 5.4, -7.0);
    boardPanel.rotation.y = -0.25;
    const frame = [];
    put(frame, mouldedRing([[0, -1.75], [0.22, -1.72], [0.22, 1.72], [0, 1.75]], 2.76, 0.12), TIMBER.dark);
    for (const sx of [-1, 1]) {
      put(frame, new THREE.CylinderGeometry(0.13, 0.16, 5.4, 8), TIMBER.dark, [sx * 2.4, -3.4, 0]);
    }
    boardFrame = mesh(mergeParts(frame), standard({
      vertexColors: true, roughness: 0.85, ...relief('wood', { seed, repeat: 4 }),
    }));
    boardFrame.position.copy(boardPanel.position);
    boardFrame.rotation.y = -0.25;
  }

  return group(
    mesh(
      weather(mergeParts(parts), { amount: 0.1, scale: 0.14, wash: 0.2, low: 0, fade: 4, seed: seed + 3 }),
      standard({ vertexColors: true, roughness: 0.74, metalness: 0.26, ...relief('metal', { seed, repeat: 7 }) }),
    ),
    boardFrame,
    boardPanel,
  );
}

// A manifest board: the ship's name, the date, and the numbers. The tag pinned to a coat
// carried the manifest page and line number you were on -- which is how a person became a
// row in a ledger.
export function manifestBoard({ ship = 'SS PRINZESSIN', date = '14 APRIL 1907', souls = '1,806', seed = 37 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const texture = canvasTexture(896, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8dfc8';
    ctx.fillRect(0, 0, w, h);
    // Foxing and damp, because a board that lived on a quay was not clean.
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${150 + rng() * 50 | 0},${125 + rng() * 40 | 0},${88 + rng() * 30 | 0},${0.03 + rng() * 0.07})`;
      ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 12, 70), 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#3a2f22'; ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 2;
    ctx.strokeRect(26, 26, w - 52, h - 52);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a2f22';
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillText('ARRIVING TODAY', w / 2, 76);
    ctx.font = 'bold 62px Georgia, serif';
    ctx.fillText(ship, w / 2, 150);
    ctx.font = '34px Georgia, serif';
    ctx.fillText(date, w / 2, 200);
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.2, 226); ctx.lineTo(w * 0.8, 226); ctx.stroke();
    ctx.font = 'bold 96px Georgia, serif';
    ctx.fillText(souls, w / 2, 330);
    ctx.font = '30px Georgia, serif';
    ctx.fillText('steerage passengers to be inspected', w / 2, 378);
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillStyle = '#5a4a34';
    ctx.fillText('Have your manifest number ready and pinned', w / 2, 440);
  });

  // A real framed board on turned posts, and the frame is a mitred moulding.
  const frame = [];
  put(frame, mouldedRing([
    [0, -2.5], [0.3, -2.45], [0.34, -2.2], [0.16, -2.05],
    [0.16, 2.05], [0.34, 2.2], [0.3, 2.45], [0, 2.5],
  ], 4.4, 0.14), TIMBER.dark);
  put(frame, new THREE.BoxGeometry(8.6, 5.0, 0.16), 0x4a3f31, [0, 0, -0.1]);
  const frameMesh = mesh(mergeParts(frame), standard({
    vertexColors: true, roughness: 0.84, ...relief('wood', { seed: seed + 1, repeat: 4 }),
  }));
  frameMesh.position.y = 6.4;
  g.add(frameMesh);

  const post = standard({ color: 0x4a3f31, roughness: 0.85, ...relief('wood', { seed, repeat: 3 }) });
  for (const side of [-1, 1]) g.add(cyl(0.2, 0.26, 7.4, post, side * 3.6, 3.7, 0, 10));
  // A brace each side, so the board is not a sign floating on two sticks.
  for (const side of [-1, 1]) {
    const brace = mesh(new THREE.BoxGeometry(0.16, 2.4, 0.16), post, side * 3.0, 5.2, 0);
    brace.rotation.z = side * 0.7;
    g.add(brace);
  }
  const panel = signPanel(8.4, 4.8, texture);
  panel.position.set(0, 6.4, 0.16);
  g.add(panel);
  return g;
}
