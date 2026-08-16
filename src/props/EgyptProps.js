import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  sphere,
  group,
  mergeColored,
  mergedMesh,
  relief,
  canvasTexture,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  roughenSphere,
} from '../PropKit.js';

// Ancient Egypt -- the Giza plateau: the Great Sphinx, the three pyramids, the valley
// temple, and the desert around them.
//
// SCALE. Giza cannot be built at true size in a world the player is clamped to a 195ft
// radius of: the Great Pyramid alone is 756ft on a side, wider than the whole walkable
// world, and the real monuments stand a quarter-mile apart. Everything here is therefore
// built at ONE consistent 1:5 -- not a per-object fudge -- so every proportion a student
// can compare is true even though no absolute size is. Khafre really is very slightly
// shorter than Khufu but looks taller because it stands on higher ground; Menkaure really
// is less than half their height; the Sphinx really is as long as a pyramid is wide at
// its base. Those relationships survive 1:5 and are the whole point. Every placard states
// the real dimension, the same contract Fantastic Voyage uses for its enlarged organs.
//
// House rules: feet at scale 1, origin at base centre, materials fresh per call,
// seededRandom never Math.random, merge everything. See PropKit.js.

const GIZA = 1 / 5; // the one scale factor; real feet * GIZA = world feet

// Limestone in three states, because Giza is three different stones and reading them
// apart is most of what makes it look like Giza rather than a sandcastle:
//   * Tura casing limestone -- near white, fine, polished; survives only at Khafre's cap.
//   * Core limestone -- the yellow-grey local Mokattam rock the bulk is built from.
//   * Aswan granite -- the stone hauled 500 miles for the valley temple and Menkaure's
//     lower courses. Grey-pink with dark speckle, NOT the terracotta red it is easy to
//     reach for: at full saturation the valley temple came out looking like a brick shed,
//     which is exactly the material it is famous for not being.
const CASING = 0xe8e0cb;
const CORE = 0xc9b389;
const CORE_DARK = 0xa89370;
const GRANITE = 0x9a7d72;
const GRANITE_DARK = 0x7e6459;
const SAND = 0xd6c096;

// ---------------------------------------------------------------------------
// Hieroglyphs
// ---------------------------------------------------------------------------

// A column of glyph-like marks. These are deliberately NOT real hieroglyphs spelling real
// words -- inventing plausible-looking text and presenting it as Egyptian would teach
// something false. They are the SHAPES of the writing system: tall narrow columns, each
// glyph roughly square or half-square, grouped so two small glyphs stack in the space of
// one large one, which is the actual layout rule and the thing that makes a wall read as
// Egyptian from across a courtyard.
function glyphColumn(ctx, x, y, width, height, rng, ink) {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  let cursor = y;
  const cell = width * 0.86;

  while (cursor < y + height - cell * 0.4) {
    const kind = Math.floor(rng() * 7);
    const cx = x + width / 2;
    ctx.lineWidth = Math.max(1.5, width * 0.07);

    if (kind === 0) {
      // Seated figure: a blob and a stroke -- the commonest silhouette on a wall.
      ctx.beginPath();
      ctx.arc(cx, cursor + cell * 0.28, cell * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - cell * 0.06, cursor + cell * 0.4, cell * 0.12, cell * 0.45);
      ctx.fillRect(cx - cell * 0.24, cursor + cell * 0.78, cell * 0.48, cell * 0.09);
      cursor += cell;
    } else if (kind === 1) {
      // Horizontal bird -- wide and short, so it takes a half cell.
      ctx.beginPath();
      ctx.ellipse(cx, cursor + cell * 0.24, cell * 0.34, cell * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - cell * 0.4, cursor + cell * 0.16, cell * 0.14, cell * 0.1);
      cursor += cell * 0.55;
    } else if (kind === 2) {
      // Ankh.
      ctx.beginPath();
      ctx.arc(cx, cursor + cell * 0.22, cell * 0.16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillRect(cx - cell * 0.05, cursor + cell * 0.36, cell * 0.1, cell * 0.46);
      ctx.fillRect(cx - cell * 0.26, cursor + cell * 0.44, cell * 0.52, cell * 0.09);
      cursor += cell;
    } else if (kind === 3) {
      // Water ripple -- three zigzag strokes, one of the few glyphs everyone recognises.
      for (let i = 0; i < 3; i++) {
        const yy = cursor + cell * (0.2 + i * 0.22);
        ctx.beginPath();
        ctx.moveTo(cx - cell * 0.36, yy);
        for (let k = 0; k < 4; k++) {
          ctx.lineTo(cx - cell * 0.36 + ((k + 1) * cell * 0.72) / 4, yy + (k % 2 ? -1 : 1) * cell * 0.05);
        }
        ctx.stroke();
      }
      cursor += cell * 0.85;
    } else if (kind === 4) {
      // Eye of Horus, simplified to its outline plus the tail stroke.
      ctx.beginPath();
      ctx.ellipse(cx, cursor + cell * 0.3, cell * 0.3, cell * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cursor + cell * 0.3, cell * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx + cell * 0.06, cursor + cell * 0.44, cell * 0.08, cell * 0.22);
      cursor += cell * 0.75;
    } else if (kind === 5) {
      // Reed / feather -- a tall thin stroke with a leaf head.
      ctx.beginPath();
      ctx.ellipse(cx, cursor + cell * 0.22, cell * 0.09, cell * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - cell * 0.035, cursor + cell * 0.4, cell * 0.07, cell * 0.45);
      cursor += cell * 0.95;
    } else {
      // Loaf / basket -- a plain half-round, the filler glyph.
      ctx.beginPath();
      ctx.ellipse(cx, cursor + cell * 0.3, cell * 0.3, cell * 0.18, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      cursor += cell * 0.5;
    }
    cursor += cell * 0.12;
  }
}

// A carved wall face: sun-bleached plaster, ruled columns of glyphs, and a cartouche.
// `cartouche` draws the royal-name oval, which is the one element that says "this names a
// king" rather than "this is decorated".
function hieroglyphTexture({ seed = 3, columns = 6, cartouche = true, base = '#d8c8a2', ink = '#6b4a2c' } = {}) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Weathering first, so the glyphs sit ON the stone rather than under a wash.
    for (let i = 0; i < 90; i++) {
      const r = randomIn(rng, 8, 46);
      ctx.fillStyle = `rgba(${140 + rng() * 60 | 0}, ${115 + rng() * 50 | 0}, ${80 + rng() * 40 | 0}, ${0.05 + rng() * 0.09})`;
      ctx.beginPath();
      ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), r, 0, Math.PI * 2);
      ctx.fill();
    }

    const margin = w * 0.05;
    const top = cartouche ? h * 0.28 : margin;
    const colW = (w - margin * 2) / columns;

    // Column dividers -- Egyptian wall text is ruled into columns, and the rules are as
    // characteristic as the glyphs.
    ctx.strokeStyle = 'rgba(107, 74, 44, 0.45)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= columns; i++) {
      const x = margin + i * colW;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, h - margin);
      ctx.stroke();
    }

    for (let i = 0; i < columns; i++) {
      glyphColumn(ctx, margin + i * colW + colW * 0.12, top + 10, colW * 0.76, h - margin - top - 16, rng, ink);
    }

    if (cartouche) {
      // The royal cartouche: an oval of rope with a tie-bar at the bottom, enclosing the
      // name. Drawn large and centred because on a real monument it is the one element
      // sized to be read from a distance.
      const cx = w / 2;
      const cy = h * 0.15;
      const rx = w * 0.3;
      const ry = h * 0.085;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(cx - rx - 6, cy + ry * 0.62);
      ctx.lineTo(cx - rx - 6, cy - ry * 0.62);
      ctx.stroke();
      glyphColumn(ctx, cx - rx * 0.55, cy - ry * 0.7, rx * 0.5, ry * 1.4, seededRandom(seed + 11), ink);
      glyphColumn(ctx, cx + rx * 0.08, cy - ry * 0.7, rx * 0.5, ry * 1.4, seededRandom(seed + 23), ink);
    }
  });
}

// ---------------------------------------------------------------------------
// The Great Sphinx
// ---------------------------------------------------------------------------

// 240ft long, 66ft tall, 62ft across the paws -- at 1:5, 48 x 13.2 x 12.4ft here. Carved
// from a single ridge of living bedrock, not built from blocks, which is why it sits in a
// quarried hollow rather than on a platform.
//
// What actually makes it read as the Sphinx, in the order each one buys the most:
//
//  * THE NEMES. The striped royal headcloth is the whole silhouette. Without it a
//    human-headed lion is a sculpture of a human-headed lion; with it, it is Egyptian and
//    it is royal. The lappets -- the two broad flaps falling forward onto the chest -- are
//    the half most people would forget, and they are what makes the head read as WIDE,
//    which is the Sphinx's most recognisable quality from the front.
//  * THE FORELEGS RUN 50 REAL FEET FORWARD. Recumbent means the paws are thrown out well
//    ahead of the chest, not tucked under it. Built with the legs under the body it reads
//    as a cat loaf.
//  * THE HEAD IS FAR TOO SMALL FOR THE BODY, and that is correct -- the head is carved
//    from a harder upper stratum and was reworked; the body has eroded much faster. Sizing
//    the head "properly" for the body is the single easiest way to make it look wrong.
//  * HORIZONTAL WEATHERING BANDS. The body is cut through soft and hard limestone layers
//    that erode at different rates, so the flanks are ribbed in bands. This is the texture
//    everybody recognises from photographs and it is geology, not damage.
//
// Built as vertex-coloured merged geometry: about 26k triangles in three draw calls.
export function greatSphinx({ seed = 5 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  const L = 240 * GIZA; // 48ft, nose to tail
  const bodyTop = 44 * GIZA; // top of the back
  const halfW = 26 * GIZA; // body half-width at the shoulders

  const stone = CORE;
  const stoneDark = CORE_DARK;
  const stoneLight = 0xd9c49c;

  // --- Bedrock ledge -------------------------------------------------------
  // The Sphinx sits IN the rock, not on it. A thin plinth under the body hides the seam
  // where the belly meets the ground and stops the swept tubes showing their undersides.
  parts.push({
    geometry: new THREE.BoxGeometry(halfW * 2.3, 4 * GIZA, L * 1.02),
    color: stoneDark,
    position: [0, 2 * GIZA, -L * 0.06],
  });

  // --- Body ----------------------------------------------------------------
  // One long swept tube from rump to shoulder. The radii are the lion's real profile:
  // heavy haunches, a waisted middle, a deeper chest.
  const bodyCurve = [
    [0, 26 * GIZA, -L * 0.5],
    [0, 34 * GIZA, -L * 0.34],
    [0, 36 * GIZA, -L * 0.12],
    [0, 35 * GIZA, L * 0.06],
    [0, 33 * GIZA, L * 0.2],
  ];
  const bodyRadii = [15 * GIZA, 25 * GIZA, 24 * GIZA, 25 * GIZA, 22 * GIZA];
  const bodyGeo = taperedTube(bodyCurve, bodyRadii, { tubularSegments: 40, radialSegments: 18 });
  // Widen across X and flatten slightly: a lion's ribcage is broader than it is deep, and
  // a circular section reads as a sausage.
  bodyGeo.scale(1.08, 0.98, 1);
  parts.push({ geometry: bodyGeo, color: stone });

  // --- Haunches ------------------------------------------------------------
  // The rear legs are folded under, so what shows is the great bulge of the thigh on each
  // flank plus a rear paw peeping out at the back.
  for (const side of [-1, 1]) {
    const hip = new THREE.SphereGeometry(15 * GIZA, 18, 12);
    hip.scale(0.72, 0.9, 1.35);
    parts.push({ geometry: hip, color: stone, position: [side * halfW * 0.72, 28 * GIZA, -L * 0.33] });

    // Rear paw, tucked and pointing forward along the flank.
    const rearPaw = new THREE.SphereGeometry(7 * GIZA, 14, 10);
    rearPaw.scale(0.8, 0.62, 1.5);
    parts.push({ geometry: rearPaw, color: stoneLight, position: [side * halfW * 0.86, 8 * GIZA, -L * 0.2] });
  }

  // --- Tail ----------------------------------------------------------------
  // Curled up the right haunch, which is where the real one is. Ends in a tuft, so the
  // tube is allowed to close to a point.
  const tail = taperedTube(
    [
      [0, 30 * GIZA, -L * 0.47],
      [halfW * 0.7, 22 * GIZA, -L * 0.5],
      [halfW * 1.05, 16 * GIZA, -L * 0.4],
      [halfW * 1.0, 12 * GIZA, -L * 0.28],
    ],
    [5 * GIZA, 4 * GIZA, 3 * GIZA, 0],
    { tubularSegments: 20, radialSegments: 10 },
  );
  parts.push({ geometry: tail, color: stone });

  // --- Forelegs ------------------------------------------------------------
  // These run 50 real feet forward of the chest. Each is a tapered tube from the shoulder
  // out to the wrist, then a paw block, then four toes. The toes matter more than they
  // should: they are the detail at a student's own eye height, since the paws are the only
  // part of the whole monument you can stand beside.
  const pawZ = L * 0.5;
  for (const side of [-1, 1]) {
    const shoulderX = side * halfW * 0.66;
    const leg = taperedTube(
      [
        [shoulderX, 30 * GIZA, L * 0.1],
        [shoulderX * 1.02, 20 * GIZA, L * 0.22],
        [shoulderX * 1.04, 11 * GIZA, L * 0.34],
        [shoulderX * 1.04, 7 * GIZA, L * 0.44],
      ],
      [13 * GIZA, 10 * GIZA, 8 * GIZA, 7.5 * GIZA],
      { tubularSegments: 22, radialSegments: 14 },
    );
    parts.push({ geometry: leg, color: stone });

    // Paw block.
    parts.push({
      geometry: new THREE.BoxGeometry(15 * GIZA, 13 * GIZA, 20 * GIZA),
      color: stoneLight,
      position: [shoulderX * 1.04, 6.5 * GIZA, pawZ - 8 * GIZA],
    });

    // Four toes, splayed. Rounded ends, because a square toe reads as a brick.
    for (let t = 0; t < 4; t++) {
      const tx = shoulderX * 1.04 + (t - 1.5) * 3.6 * GIZA;
      const toe = new THREE.SphereGeometry(2.1 * GIZA, 10, 8);
      toe.scale(1, 0.85, 2.1);
      parts.push({ geometry: toe, color: stoneLight, position: [tx, 3.4 * GIZA, pawZ + 1.6 * GIZA] });
      parts.push({
        geometry: new THREE.BoxGeometry(3.4 * GIZA, 5 * GIZA, 9 * GIZA),
        color: stoneLight,
        position: [tx, 3.6 * GIZA, pawZ - 3.5 * GIZA],
      });
    }
  }

  // --- Chest and neck ------------------------------------------------------
  // The chest rises almost vertically to the shoulders, which is what gives the Sphinx its
  // upright, seated-forward presence. It is deliberately a little narrower than the first
  // pass so the head above it is not overpowered.
  const chest = new THREE.SphereGeometry(18 * GIZA, 18, 14);
  chest.scale(1.05, 1.25, 0.9);
  parts.push({ geometry: chest, color: stone, position: [0, 30 * GIZA, L * 0.18] });

  // --- Head ----------------------------------------------------------------
  // Small against the body -- see the note above -- but not so small it is lost. The head
  // and its headcloth are about 45% of the monument's total height in reality, and the
  // first pass undersold that badly enough that the head read as a knob.
  //
  // Everything on the face sits INSIDE the nemes envelope. The first pass hung a box for
  // the face and stacked boxes for the stripes, and the result was unmistakably a pile of
  // crates on a neck: any part that protrudes past the headcloth's own silhouette stops
  // reading as a feature of the face and starts reading as an object sitting on it.
  // Three numbers, and getting any of them wrong turns the Sphinx into a snowman:
  //
  //  * headZ must put the head OVER THE CHEST, not behind it. Set back at L*0.15 the head
  //    sat inside the chest's own silhouette and read as a small ball stuck on a big one.
  //  * headY must clear the line of the back. Level with it, the head has no neck to stand
  //    on and the animal looks decapitated-and-replaced.
  //  * headR must be close to the CHEST's radius, not a fraction of it. The Sphinx's head
  //    is famously too small for its body -- but "too small" means about nine tenths of
  //    the chest, not two thirds, and two thirds is what turned it into a doorknob.
  const headY = 61 * GIZA;
  const headZ = L * 0.19;
  const headR = 16 * GIZA;

  // Neck -- deliberately visible, and rooted well down INSIDE the chest rather than on its
  // surface. Two tubes meeting at a seam cannot close on their own (the joint rule in
  // CLAUDE.md); starting this one below the shoulder line hides the seam in solid stone.
  const neckGeo = taperedTube(
    [
      [0, 34 * GIZA, L * 0.175],
      [0, headY - headR * 1.5, headZ - headR * 0.06],
      [0, headY - headR * 0.6, headZ],
    ],
    [headR * 0.92, headR * 0.78, headR * 0.74],
    { tubularSegments: 12, radialSegments: 14 },
  );
  parts.push({ geometry: neckGeo, color: stoneLight });

  // Skull: taller than wide, flattened front-to-back, which is the shape a nemes is cut
  // to sit on.
  const skull = new THREE.SphereGeometry(headR, 22, 18);
  skull.scale(0.94, 1.1, 0.92);
  parts.push({ geometry: skull, color: stoneLight, position: [0, headY, headZ] });

  // Face: a shallow wedge tucked just proud of the skull, narrower than it so the nemes
  // frames it. Cheeks and jaw come from two flattened spheres rather than a slab -- a
  // carved face is a set of soft planes, and a rectangle at this size reads as a signboard.
  const faceMass = new THREE.SphereGeometry(headR * 0.82, 16, 14);
  faceMass.scale(1.0, 1.16, 0.72);
  parts.push({ geometry: faceMass, color: stoneLight, position: [0, headY - headR * 0.16, headZ + headR * 0.42] });

  const jaw = new THREE.SphereGeometry(headR * 0.52, 14, 12);
  jaw.scale(1.0, 0.72, 0.86);
  parts.push({ geometry: jaw, color: stoneLight, position: [0, headY - headR * 0.78, headZ + headR * 0.36] });

  // Brow ridge -- one soft bar across, which is what puts the eyes in shadow.
  const brow = new THREE.SphereGeometry(headR * 0.2, 12, 8);
  brow.scale(3.1, 0.5, 0.8);
  parts.push({ geometry: brow, color: stoneLight, position: [0, headY + headR * 0.3, headZ + headR * 0.86] });

  // Eyes: recessed sockets, no eyeball -- at this size a carved eye IS its own shadow.
  for (const side of [-1, 1]) {
    const socket = new THREE.SphereGeometry(headR * 0.17, 10, 8);
    socket.scale(1.45, 0.85, 0.6);
    parts.push({
      geometry: socket,
      color: 0x7e6743,
      position: [side * headR * 0.35, headY + headR * 0.09, headZ + headR * 0.88],
    });
  }

  // The nose is BROKEN OFF, and building it broken is the honest choice -- every student
  // has seen the photograph. A stub of bridge, then a flat raw scar where the rest was.
  parts.push({
    geometry: new THREE.BoxGeometry(headR * 0.2, headR * 0.24, headR * 0.16),
    color: stoneLight,
    position: [0, headY + headR * 0.02, headZ + headR * 0.9],
  });
  parts.push({
    geometry: new THREE.BoxGeometry(headR * 0.34, headR * 0.34, headR * 0.1),
    color: 0xb5a077, // raw broken stone, lighter than the weathered face around it
    position: [0, headY - headR * 0.24, headZ + headR * 0.9],
  });

  // Mouth: a wide shallow recess with a full lower lip under it. The Sphinx's mouth is
  // unusually wide and that width is part of why the face is recognisable.
  parts.push({
    geometry: new THREE.BoxGeometry(headR * 0.6, headR * 0.07, headR * 0.12),
    color: 0x7e6743,
    position: [0, headY - headR * 0.52, headZ + headR * 0.84],
  });
  const lip = new THREE.SphereGeometry(headR * 0.13, 10, 8);
  lip.scale(2.3, 0.65, 0.6);
  parts.push({ geometry: lip, color: stoneLight, position: [0, headY - headR * 0.62, headZ + headR * 0.8] });

  // --- The nemes headcloth -------------------------------------------------
  // The striped royal headcloth, and the whole silhouette. Three pieces: a shell over the
  // crown, two lappets flaring down onto the chest, and the plaited queue behind.
  //
  // The stripes are GEOMETRY rather than a texture, because this is a merged
  // vertex-coloured mesh and a material carrying both a map and vertexColors multiplies
  // the two (the bear-dens mistake). But they are laid FLUSH on the lappet surface, not
  // stacked as separate solids -- a band that stands proud of its neighbour by its own
  // thickness is a crate, not a pleat.
  const capGeo = new THREE.SphereGeometry(headR * 1.14, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.58);
  capGeo.scale(1.06, 1.02, 1.0);
  parts.push({ geometry: capGeo, color: 0xd8c08e, position: [0, headY + headR * 0.06, headZ - headR * 0.04] });

  // Brow fillet -- the band tying the nemes across the forehead. Without it the shell
  // reads as a swim cap.
  const fillet = new THREE.TorusGeometry(headR * 1.06, headR * 0.1, 8, 24);
  fillet.rotateX(Math.PI / 2);
  fillet.scale(1.06, 1, 1.0);
  parts.push({ geometry: fillet, color: 0xc9ab72, position: [0, headY + headR * 0.46, headZ - headR * 0.04] });

  // Lappets. Each is ONE flared plate swept from the temple down onto the chest, with the
  // stripes painted across it as flush colour bands. Sweeping it means the flare is smooth
  // instead of stepped, which is what the stacked-box version got wrong.
  for (const side of [-1, 1]) {
    const lappet = taperedTube(
      [
        [side * headR * 0.72, headY + headR * 0.34, headZ + headR * 0.14],
        [side * headR * 0.94, headY - headR * 0.45, headZ + headR * 0.34],
        [side * headR * 1.08, headY - headR * 1.25, headZ + headR * 0.5],
        [side * headR * 1.1, headY - headR * 1.85, headZ + headR * 0.52],
      ],
      [headR * 0.22, headR * 0.3, headR * 0.36, headR * 0.33],
      { tubularSegments: 18, radialSegments: 12 },
    );
    // NO geometry.scale() here, and that is the point.
    //
    // `geometry.scale(0.42, 1, 1)` multiplies every COORDINATE, not just the cross-section
    // -- the same trap DinoProps' scaleAbout() exists to work around. The lappet is swept
    // in absolute head coordinates, so scaling it "thinner" also dragged it 58% of the way
    // back toward the centre line, while the stripe bands stayed where they were written.
    // The result was a row of bars sticking straight out through the side of the headcloth.
    //
    // The flap is flattened by its RADII instead (a narrow sweep read as a broad flat flap
    // because it is wide in Z and shallow in X), and the stripes are gone: a band laid on a
    // curved swept surface can only be positioned by re-deriving the sweep, and a smooth
    // lappet plus the cap, fillet and queue already reads unmistakably as a nemes.
    parts.push({ geometry: lappet, color: 0xd8c08e });
  }

  // The queue -- the plaited tail of the nemes down the back of the neck.
  const queue = taperedTube(
    [
      [0, headY - headR * 0.2, headZ - headR * 1.0],
      [0, headY - headR * 1.1, headZ - headR * 1.05],
      [0, headY - headR * 1.9, headZ - headR * 0.95],
    ],
    [headR * 0.3, headR * 0.26, headR * 0.2],
    { tubularSegments: 10, radialSegments: 10 },
  );
  queue.scale(0.8, 1, 0.8);
  parts.push({ geometry: queue, color: 0xc9ab72 });

  // The uraeus -- the rearing cobra on the brow. Small, but it is the mark of kingship and
  // its absence is felt even by someone who could not name it.
  const hood = new THREE.SphereGeometry(headR * 0.12, 10, 8);
  hood.scale(1.4, 1.2, 0.6);
  parts.push({ geometry: hood, color: 0xb08f56, position: [0, headY + headR * 0.66, headZ + headR * 0.76] });
  parts.push({
    geometry: new THREE.BoxGeometry(headR * 0.07, headR * 0.26, headR * 0.09),
    color: 0xb08f56,
    position: [0, headY + headR * 0.5, headZ + headR * 0.82],
  });

  // --- Weathering bands ----------------------------------------------------
  // Horizontal ribs down both flanks where soft strata have cut back between hard ones.
  //
  // These must stand PROUD of the body's own surface. The first pass placed them at
  // halfW * 0.98 while the body tube had already been scaled 1.08 across X, so every band
  // sat several inches INSIDE the flank and contributed exactly nothing -- the body came
  // out as one smooth featureless sausage. The surface here is at halfW * 1.08 at its
  // widest, so the bands ride at 1.06 and step in as the body narrows toward the top.
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const y = (8 + i * 4.0) * GIZA;
    // The flank tucks in above and below the widest point, so the band has to follow it or
    // the top ones float off the back in mid-air.
    const profile = 1.06 - Math.pow(t - 0.42, 2) * 0.9;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(1.6 * GIZA, 2.0 * GIZA, L * (0.6 - i * 0.012)),
        color: i % 2 ? stoneDark : 0xbfa87e,
        position: [side * halfW * profile, y, -L * 0.14],
      });
    }
  }

  return group(
    mesh(mergeColored(parts), standard({
      vertexColors: true,
      roughness: 0.97,
      flatShading: false,
      ...relief('stone', { seed: seed + 3, repeat: 8, strength: 0.75 }),
    })),
  );
}

// ---------------------------------------------------------------------------
// Pyramids
// ---------------------------------------------------------------------------

// One builder for all three, because they ARE the same object at different sizes with
// different survivals of facing -- and building them from one function is what guarantees
// their proportions stay comparable, which is the lesson.
//
// Built as STEPPED COURSES, not as a smooth cone. A pyramid's core is a stack of stone
// courses and the casing that made it smooth is almost entirely gone; the steps are what
// every photograph shows. A four-sided cone reads as a paperweight.
//
// `capHeight` puts the surviving polished casing back on the top, which is Khafre's single
// most recognisable feature and the reason it is the one people photograph.
// `graniteCourses` faces the bottom N courses in Aswan granite, which is Menkaure's.
export function gizaPyramid({
  baseWidth = 756 * GIZA,
  height = 481 * GIZA,
  courses = 34,
  capHeight = 0,
  graniteCourses = 0,
  seed = 9,
  entrance = true,
} = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const courseH = height / courses;

  for (let i = 0; i < courses; i++) {
    const t = i / courses;
    const tNext = (i + 1) / courses;
    // Each course is the pyramid's width at its own TOP, so the block's outer face sits
    // proud of the one above it -- which is what makes a step.
    const w = baseWidth * (1 - tNext) + baseWidth * 0.02;
    const y = t * height + courseH / 2;

    // Courses get thinner toward the top on a real pyramid, and the colour varies course
    // to course because the quarries did. Both are small, and together they are the whole
    // difference between "stacked boxes" and "masonry".
    const wobble = 1 + (rng() - 0.5) * 0.012;
    const isGranite = i < graniteCourses;
    const shade = isGranite ? GRANITE : i % 3 === 0 ? CORE_DARK : i % 3 === 1 ? CORE : 0xd2bc93;

    parts.push({
      geometry: new THREE.BoxGeometry(w * wobble, courseH * 1.02, w * wobble),
      color: shade,
      position: [0, y, 0],
    });
  }

  // The surviving casing cap: a smooth four-sided cone sitting on the top courses. Four
  // radial segments on a CylinderGeometry gives a true pyramid with flat faces, and it has
  // to be rotated 45 degrees to put its corners on the diagonals rather than its faces.
  if (capHeight > 0) {
    const capBase = baseWidth * (capHeight / height) * 1.04;
    const cap = new THREE.CylinderGeometry(0, capBase / 2, capHeight, 4, 1);
    cap.rotateY(Math.PI / 4);
    // A cylinder's "radius" is to its corners, not its faces; scale so the cap's flats sit
    // just outside the step it lands on rather than cutting into it.
    cap.scale(1.005, 1, 1.005);
    parts.push({ geometry: cap, color: CASING, position: [0, height - capHeight, 0] });
  }

  // The entrance: a dark recess on the north face, offset from centre exactly as Khufu's
  // is. Two blocks -- a lintel above and a void behind -- because a flat dark rectangle on
  // a stepped wall reads as a painted patch.
  if (entrance) {
    const ey = height * 0.28;
    const ew = baseWidth * 0.045;
    const faceX = (baseWidth * (1 - ey / height)) / 2;
    parts.push({
      geometry: new THREE.BoxGeometry(ew, ew * 1.5, ew * 1.4),
      color: 0x2b2318,
      position: [-baseWidth * 0.03, ey, faceX * 0.98],
    });
    parts.push({
      geometry: new THREE.BoxGeometry(ew * 1.9, ew * 0.42, ew * 0.7),
      color: GRANITE,
      position: [-baseWidth * 0.03, ey + ew * 0.9, faceX * 1.02],
    });
  }

  return group(
    mesh(mergeColored(parts), standard({
      vertexColors: true,
      roughness: 0.96,
      ...relief('stone', { seed: seed + 5, repeat: 14, strength: 0.5 }),
    })),
  );
}

// ---------------------------------------------------------------------------
// Valley temple
// ---------------------------------------------------------------------------

// Khafre's valley temple, beside the Sphinx: the most austere building in Egypt. Bare
// Aswan granite megaliths, post and lintel, no decoration at all -- which is exactly why
// it is worth building, since every OTHER Egyptian building a student pictures is covered
// in carving. The contrast is the point, and it is why the hieroglyph walls in this world
// are placed on the stela and the obelisk instead.
export function valleyTemple({ width = 28, depth = 22, height = 11, seed = 17 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // Plinth.
  parts.push({ geometry: new THREE.BoxGeometry(width + 3, 1.2, depth + 3), color: 0xa08a6c, position: [0, 0.6, 0] });

  const wall = 1.8;
  const wallY = 1.2 + height / 2;

  // Three solid walls; the fourth (facing +Z, the approach) is the colonnaded front.
  const solid = [
    [0, -depth / 2 + wall / 2, width, wall],
    [-width / 2 + wall / 2, 0, wall, depth],
    [width / 2 - wall / 2, 0, wall, depth],
  ];
  for (const [x, z, w, d] of solid) {
    // Coursed, not one slab: real megalithic walls show their block joints, and a single
    // 28ft box has no scale at all.
    const rows = 5;
    for (let r = 0; r < rows; r++) {
      const rh = height / rows;
      parts.push({
        geometry: new THREE.BoxGeometry(w * (1 + (rng() - 0.5) * 0.006), rh * 0.97, d),
        color: r % 2 ? GRANITE : GRANITE_DARK,
        position: [x, 1.2 + rh * (r + 0.5), z],
      });
    }
  }

  // Square granite piers across the front, with a lintel over them. Square, not round:
  // Egyptian temple piers of this period are monolithic square posts, and a fluted column
  // here would be Greek.
  const bays = 5;
  const pierW = 2.4;
  for (let i = 0; i < bays; i++) {
    const x = -width / 2 + wall + (i + 0.5) * ((width - wall * 2) / bays);
    parts.push({
      geometry: new THREE.BoxGeometry(pierW, height - 1.6, pierW),
      color: GRANITE,
      position: [x, 1.2 + (height - 1.6) / 2, depth / 2 - pierW / 2 - 0.4],
    });
  }
  parts.push({
    geometry: new THREE.BoxGeometry(width, 1.6, pierW * 1.5),
    color: GRANITE_DARK,
    position: [0, 1.2 + height - 0.8, depth / 2 - pierW / 2 - 0.4],
  });

  // Roof slabs, laid as separate beams with gaps -- the temple was roofed in slabs and the
  // gaps between them are what lit the interior. Not shadow-casting, for the same reason
  // the museum's skylight is not: three.js has no light transmission, so the ONLY thing
  // deciding whether sun reaches the floor is whether something above it casts a shadow.
  const slabs = 6;
  const roof = [];
  for (let i = 0; i < slabs; i++) {
    const z = -depth / 2 + (i + 0.5) * (depth / slabs);
    roof.push({
      geometry: new THREE.BoxGeometry(width, 1.1, (depth / slabs) * 0.72),
      color: 0x8d7268,
      position: [0, 1.2 + height + 0.55, z],
    });
  }

  const body = mesh(mergeColored(parts), standard({
    vertexColors: true,
    roughness: 0.9,
    ...relief('stone', { seed: seed + 2, repeat: 6, strength: 0.45 }),
  }));

  const roofMesh = mesh(mergeColored(roof), standard({ vertexColors: true, roughness: 0.9 }));
  roofMesh.castShadow = false;

  return group(body, roofMesh);
}

// ---------------------------------------------------------------------------
// Obelisk, stela, mastaba
// ---------------------------------------------------------------------------

// A monolithic granite obelisk with a pyramidion cap. Real ones are 10:1 tall to wide and
// were capped in electrum to catch the first sun -- so the cap here is a separate, much
// brighter, low-roughness material rather than part of the merge.
export function obelisk({ height = 22, seed = 21 } = {}) {
  const width = height / 10;
  const shaftH = height * 0.9;

  const face = hieroglyphTexture({ seed, columns: 2, cartouche: false, base: '#9c6a52', ink: '#3a2318' });
  const shaft = new THREE.CylinderGeometry(width * 0.72, width, shaftH, 4);
  shaft.rotateY(Math.PI / 4);

  const g = group();
  g.add(mesh(new THREE.BoxGeometry(width * 2.2, 0.9, width * 2.2), standard({ color: 0x9a8464, roughness: 0.95, ...relief('stone', { seed: seed + 1, repeat: 2 }) }), 0, 0.45, 0));
  g.add(mesh(shaft, standard({ map: face, roughness: 0.86, ...relief('stone', { seed: seed + 4, repeat: 3, strength: 0.3 }) }), 0, 0.9 + shaftH / 2, 0));

  const cap = new THREE.CylinderGeometry(0, width * 0.72 * 1.42, height * 0.1, 4);
  cap.rotateY(Math.PI / 4);
  g.add(mesh(cap, standard({ color: 0xf2dfa8, roughness: 0.28, metalness: 0.65, emissive: 0x5a4718, emissiveIntensity: 0.35 }), 0, 0.9 + shaftH + height * 0.05, 0));
  return g;
}

// A free-standing inscribed slab. The Dream Stela stands between the Sphinx's paws and
// this is that object: a round-topped granite slab covered in text.
export function stela({ width = 5, height = 9, seed = 31, text = true } = {}) {
  const g = group();
  const stone = standard({
    map: text ? hieroglyphTexture({ seed, columns: 5, cartouche: true }) : null,
    color: text ? 0xffffff : 0xbda683,
    roughness: 0.9,
    ...relief('stone', { seed: seed + 6, repeat: 3, strength: 0.35 }),
  });

  // Round-topped, which is the actual stela profile: a slab with a disc at its head.
  //
  // A FULL disc, not a half-cylinder cut with thetaLength. A partial CylinderGeometry's
  // sweep starts at an axis that moves as you rotate the geometry into place, so lining
  // its flat edge up with the top of the slab means reasoning about where theta 0 ended
  // up -- and getting it wrong (as the first pass did) leaves the arc visibly off-centre.
  // A full disc whose lower half is simply buried in the slab cannot be misaligned.
  g.add(mesh(new THREE.BoxGeometry(width, height * 0.86, 0.8), stone, 0, height * 0.43, 0));
  const top = new THREE.CylinderGeometry(width / 2, width / 2, 0.8, 24);
  top.rotateX(Math.PI / 2);
  g.add(mesh(top, stone, 0, height * 0.86, 0));

  g.add(mesh(new THREE.BoxGeometry(width * 1.35, 0.7, 2), standard({ color: 0x9a8464, roughness: 0.95, ...relief('stone', { seed: seed + 9, repeat: 2 }) }), 0, 0.35, 0));
  return g;
}

// A mastaba -- the flat-topped, batter-sided mudbrick tomb that predates the pyramids and
// still surrounds them in fields. Cheap, and they are what fills the plateau between
// monuments so it does not read as three objects on an empty plain.
export function mastaba({ width = 14, depth = 9, height = 5, seed = 41 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const t = r / rows;
    // Batter: the walls slope inward, which is the defining profile.
    const w = width * (1 - t * 0.16);
    const d = depth * (1 - t * 0.16);
    parts.push({
      geometry: new THREE.BoxGeometry(w, (height / rows) * 1.02, d),
      color: r % 2 ? 0xa38963 : 0xb59873,
      position: [0, (height / rows) * (r + 0.5), 0],
    });
  }
  // A false door on the long face -- the whole point of a mastaba, and one dark recess is
  // enough to say it.
  parts.push({
    geometry: new THREE.BoxGeometry(width * 0.14, height * 0.5, 0.5),
    color: 0x3a2e1f,
    position: [-width * 0.22, height * 0.25, depth * 0.47],
  });
  // Sand drifted against the base, which is how every one of these actually looks.
  for (let i = 0; i < 10; i++) {
    const drift = new THREE.SphereGeometry(randomIn(rng, 1.2, 2.6), 8, 6);
    drift.scale(1.6, 0.32, 1);
    parts.push({
      geometry: drift,
      color: SAND,
      position: [randomIn(rng, -width * 0.6, width * 0.6), 0.2, (rng() > 0.5 ? 1 : -1) * depth * randomIn(rng, 0.45, 0.6)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.98, ...relief('soil', { seed: seed + 3, repeat: 5, strength: 0.6 }) }));
}

// ---------------------------------------------------------------------------
// Landscape
// ---------------------------------------------------------------------------

// A date palm: bare ringed trunk, no branches, and a crown of pinnate fronds that arch
// over and hang. The rings are the leaf scars, and they are what makes a palm trunk a palm
// trunk rather than a pole.
export function datePalm({ height = 26, seed = 7, dates = true } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkH = height * 0.68;
  const lean = randomIn(rng, -0.09, 0.09);

  // Trunk, curved: a palm almost never grows straight.
  const trunkPts = [];
  const trunkRadii = [];
  const rings = 8;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    trunkPts.push([Math.sin(t * 1.6) * lean * trunkH, t * trunkH, Math.cos(t * 2.1) * lean * trunkH * 0.6]);
    trunkRadii.push(1.15 - t * 0.42);
  }
  parts.push({ geometry: taperedTube(trunkPts, trunkRadii, { tubularSegments: 22, radialSegments: 12 }), color: 0x8a7150 });

  // Leaf-scar rings, stacked up the trunk.
  const topX = Math.sin(1.6) * lean * trunkH;
  const topZ = Math.cos(2.1) * lean * trunkH * 0.6;
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const r = 1.15 - t * 0.42;
    const ring = new THREE.TorusGeometry(r * 0.98, 0.09, 5, 12);
    ring.rotateX(Math.PI / 2);
    parts.push({
      geometry: ring,
      color: 0x6f5a3d,
      position: [Math.sin(t * 1.6) * lean * trunkH, t * trunkH, Math.cos(t * 2.1) * lean * trunkH * 0.6],
    });
  }

  // Crown. Fronds arch: up and out, then over and down. Each is a flattened tube with a
  // NON-ZERO tip -- the same lesson Dinosaur Island's fronds taught, since a frond that
  // narrows to a point reads as a black needle rather than a leaf.
  const fronds = 15;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.2;
    const len = randomIn(rng, 6.5, 9.5);
    const droop = randomIn(rng, 0.5, 1.0);
    const geo = taperedTube(
      [
        [0, 0, 0],
        [Math.cos(a) * len * 0.35, len * 0.3, Math.sin(a) * len * 0.35],
        [Math.cos(a) * len * 0.72, len * 0.34 - droop * 0.6, Math.sin(a) * len * 0.72],
        [Math.cos(a) * len, len * 0.1 - droop * 2.4, Math.sin(a) * len],
      ],
      [0.42, 0.36, 0.26, 0.13],
      { tubularSegments: 14, radialSegments: 5 },
    );
    // Flatten each frond into a blade about its own long axis.
    geo.scale(1, 0.34, 1);
    parts.push({
      geometry: geo,
      color: i % 3 === 0 ? 0x5c7a35 : i % 3 === 1 ? 0x6b8a3c : 0x4e6b2e,
      position: [topX, trunkH, topZ],
    });
  }

  // Date clusters, hanging under the crown.
  if (dates) {
    for (let c = 0; c < 3; c++) {
      const a = (c / 3) * Math.PI * 2 + 0.7;
      for (let d = 0; d < 14; d++) {
        parts.push({
          geometry: new THREE.SphereGeometry(0.2, 6, 4),
          color: 0xb5772e,
          position: [
            topX + Math.cos(a) * (1.4 + (d % 4) * 0.22),
            trunkH - 0.8 - Math.floor(d / 4) * 0.42,
            topZ + Math.sin(a) * (1.4 + (d % 4) * 0.22),
          ],
        });
      }
    }
  }

  return group(mergedMesh(parts, { roughness: 0.92, flatShading: false, ...relief('bark', { seed: seed + 4, repeat: 4, strength: 0.5 }) }));
}

// Wind-blown sand: low drifts. Flattened hard, because a dune as tall as it is wide is a
// hill, and the desert's character is that it is almost flat.
//
// Two things the first pass got wrong, and both generalise to any low ground feature:
//
//  * DETAIL 2 IS NOT ENOUGH ONCE A SHAPE IS SQUASHED. Flattening to 20% multiplies the
//    apparent angle between neighbouring facets by five, so an icosahedron that looks
//    rounded standing up reads as a heap of broken glass lying down. Detail 3 plus a
//    gentler roughen fixes it far better than any amount of colour tuning.
//  * A DRIFT HAS TO BE WIDER THAN IT IS LONG AND OVERLAP ITS NEIGHBOURS. Five separate
//    blobs scattered inside a radius are five objects; a drift is one continuous surface,
//    so they are stretched across the wind and placed close enough to fuse.
export function sandDrift({ size = 14, seed = 13, color = SAND } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r = size * randomIn(rng, 0.34, 0.58);
    const geo = roughenSphere(new THREE.IcosahedronGeometry(r, 3), { amount: 0.13, flatten: 0.17, phase: i * 1.7 });
    // Stretched across X: wind-formed sand is drawn out into long low ridges, never round.
    geo.scale(1.5, 1, 0.75);
    parts.push({
      geometry: geo,
      color: i % 2 ? color : 0xc7b087,
      position: [randomIn(rng, -size * 0.3, size * 0.3), r * 0.02, randomIn(rng, -size * 0.22, size * 0.22)],
    });
  }
  return group(mergedMesh(parts, { roughness: 1, ...relief('soil', { seed: seed + 7, repeat: 6, strength: 0.7 }) }));
}

// Khufu's solar barque -- a real 143ft cedar ship found sealed in a pit beside the Great
// Pyramid in 1954, in 1,224 pieces, and reassembled. It is the oldest intact large ship in
// the world, and it is here because it is the single most surprising object at Giza.
//
// The hull shape is the lesson: papyriform, meaning a wooden ship built to look like a
// bundle of reeds, with both ends sweeping high out of the water into papyrus-flower
// finials. It has no keel and it is held together with rope, not nails.
export function solarBarque({ length = 28, seed = 27 } = {}) {
  const parts = [];
  const cedar = 0xb98d5a;
  const cedarDark = 0x8d6a41;

  const halfL = length / 2;
  const beam = length * 0.13;

  // Hull: a swept tube, widest amidships, sweeping UP at both ends.
  const hull = taperedTube(
    [
      [0, length * 0.135, -halfL],
      [0, length * 0.042, -halfL * 0.66],
      [0, length * 0.018, -halfL * 0.2],
      [0, length * 0.018, halfL * 0.2],
      [0, length * 0.042, halfL * 0.66],
      [0, length * 0.135, halfL],
    ],
    [beam * 0.1, beam * 0.5, beam * 0.62, beam * 0.62, beam * 0.5, beam * 0.1],
    { tubularSegments: 40, radialSegments: 14 },
  );
  hull.scale(1, 0.72, 1); // a boat is wider than it is deep
  parts.push({ geometry: hull, color: cedar });

  // Papyrus-flower finials at bow and stern -- the detail that makes it Egyptian.
  for (const end of [-1, 1]) {
    const stem = taperedTube(
      [
        [0, length * 0.13, end * halfL],
        [0, length * 0.2, end * halfL * 1.04],
        [0, length * 0.26, end * halfL * 0.99],
      ],
      [beam * 0.1, beam * 0.075, beam * 0.06],
      { tubularSegments: 10, radialSegments: 8 },
    );
    parts.push({ geometry: stem, color: cedarDark });
    const bell = new THREE.CylinderGeometry(beam * 0.28, beam * 0.06, length * 0.055, 12, 1, true);
    parts.push({ geometry: bell, color: cedarDark, position: [0, length * 0.285, end * halfL * 0.985] });
  }

  // Deck planking.
  const planks = 11;
  for (let i = 0; i < planks; i++) {
    const t = (i / (planks - 1)) * 2 - 1;
    parts.push({
      geometry: new THREE.BoxGeometry(beam * 1.18 * (1 - Math.abs(t) * 0.42), 0.14, (length * 0.72) / planks * 0.9),
      color: i % 2 ? cedar : 0xc59a66,
      position: [0, length * 0.05, t * length * 0.34],
    });
  }

  // Deckhouse -- the cabin amidships, with a canopy over it on slim posts.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 0.86, length * 0.075, length * 0.24), color: 0xd9c49a, position: [0, length * 0.088, -length * 0.02] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.07, 0.07, length * 0.1, 6),
        color: cedarDark,
        position: [sx * beam * 0.5, length * 0.16, -length * 0.02 + sz * length * 0.13],
      });
    }
  }
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.2, 0.1, length * 0.32), color: 0xe6d8b8, position: [0, length * 0.212, -length * 0.02] });

  // Steering oars at the stern -- two huge blades on posts, which is how a ship with no
  // rudder is steered.
  for (const side of [-1, 1]) {
    const shaft = taperedTube(
      [
        [side * beam * 0.55, length * 0.11, -halfL * 0.66],
        [side * beam * 0.78, length * 0.03, -halfL * 0.82],
        [side * beam * 0.9, -length * 0.03, -halfL * 0.92],
      ],
      [0.11, 0.1, 0.09],
      { tubularSegments: 8, radialSegments: 6 },
    );
    parts.push({ geometry: shaft, color: cedarDark });
    const blade = new THREE.BoxGeometry(0.1, length * 0.014, length * 0.1);
    parts.push({ geometry: blade, color: cedar, position: [side * beam * 0.92, -length * 0.04, -halfL * 0.95], rotation: [0.4, 0, 0] });
  }

  // Twelve oars along the sides, shipped and resting on the gunwale.
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const z = -length * 0.2 + i * length * 0.075;
      parts.push({
        geometry: new THREE.CylinderGeometry(0.06, 0.06, length * 0.28, 6),
        color: cedarDark,
        position: [side * beam * 0.62, length * 0.075, z],
        rotation: [Math.PI / 2, 0, side * 0.12],
      });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.82, ...relief('wood', { seed: seed + 2, repeat: 5, strength: 0.35 }) }));
}

// A cartouche-shaped name plaque on two posts. Used as this world's wayfinding, in place
// of the generic standing sign, because a cartouche IS a nameplate and using the real
// device to label a real monument is a better lesson than a caption.
export function cartouchePlaque({ label = 'GIZA', sub = '', seed = 51 } = {}) {
  const g = group();
  const w = 8;
  const h = 3.4;

  const texture = canvasTexture(1024, 448, (ctx, cw, ch) => {
    ctx.fillStyle = '#d8c8a2';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#6b4a2c';
    ctx.lineWidth = 10;
    // The cartouche outline: a stadium, not an ellipse -- straight sides, round ends.
    const pad = 40;
    const r = (ch - pad * 2) / 2;
    ctx.beginPath();
    ctx.moveTo(pad + r, pad);
    ctx.lineTo(cw - pad - r, pad);
    ctx.arc(cw - pad - r, pad + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(pad + r, ch - pad);
    ctx.arc(pad + r, pad + r, r, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.stroke();
    // The tie-bar at the end, which is what makes it a cartouche rather than an oval.
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(pad - 6, ch * 0.34);
    ctx.lineTo(pad - 6, ch * 0.66);
    ctx.stroke();

    ctx.fillStyle = '#4a3018';
    ctx.textAlign = 'center';
    ctx.font = `bold ${sub ? 96 : 118}px Georgia, serif`;
    ctx.fillText(label, cw / 2, sub ? ch * 0.5 : ch * 0.6);
    if (sub) {
      ctx.font = '40px Georgia, serif';
      ctx.fillStyle = '#6b4a2c';
      ctx.fillText(sub, cw / 2, ch * 0.7);
    }
  });

  const post = standard({ color: 0x9a8464, roughness: 0.95, ...relief('stone', { seed, repeat: 2 }) });
  for (const side of [-1, 1]) g.add(cyl(0.28, 0.34, 4.4, post, side * (w / 2 - 0.5), 2.2, 0, 10));
  const panel = signPanel(w, h, texture);
  panel.position.set(0, 4.4, 0.16);
  g.add(panel);
  return g;
}
