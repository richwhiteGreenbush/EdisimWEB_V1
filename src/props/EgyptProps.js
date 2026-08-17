import * as THREE from 'three';
import {
  standard, mesh, cyl, group, mergedMesh, relief,
  canvasTexture, signPanel, seededRandom, randomIn, roughenSphere,
} from '../PropKit.js';
import {
  solidLoft, loftSampler, grooveAt, sweepProfile, mouldedRing, extrudeOutline, revolve,
  solidSurface, chain, spike, dome, ball, tube, mergeParts, tintGeometry, weather,
  smoothNoise3, roundedOutline, lensOutline, placed, put, smoothed,
} from './LoftKit.js';

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
// THE REBUILD. Everything here was swept circles, stacked boxes and detail laid on top as
// separate solids. Four things drove the rewrite:
//
//  * A LION IS NOT A SCALED SAUSAGE. The Sphinx's body was one `taperedTube` scaled 1.08
//    across X -- one aspect ratio for the whole animal -- with the haunches as two spheres
//    stuck on the flanks. A recumbent lion is deep and narrow at the chest, enormously wide
//    across the haunches and waisted between them; that is a section that changes SHAPE.
//  * THE WEATHERING BANDS ARE GROOVES, NOT BOXES. They were eight pairs of box beams laid
//    along the flanks at a hand-guessed radius, and the file's own comment records that the
//    first attempt put every one of them INSIDE the body where it contributed nothing. A
//    band cut as a displacement of the body's own surface cannot be in the wrong place and
//    cannot leave a gap.
//  * AN OBELISK IS ITS CARVING. The old one was a four-sided prism with a photograph of
//    glyphs on it: THIRTY-SIX TRIANGLES for the most heavily carved object in Egypt. Sunk
//    relief -- where the cutting is INTO the surface and the sun does the rest -- is what
//    Egyptian carving is, and it is a warp.
//  * EGYPT WAS PAINTED. Every temple, stela and obelisk here was brilliantly polychrome,
//    and the six-colour mineral palette (Egyptian blue, malachite, red and yellow ochre,
//    carbon black, gypsum white) is one a student can actually learn. The first pass was
//    six shades of sand.
//
// House rules: feet at scale 1, origin at base centre, materials fresh per call,
// seededRandom never Math.random, merge everything. See PropKit.js and LoftKit.js.

const GIZA = 1 / 5; // the one scale factor; real feet * GIZA = world feet

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Giza is several different stones and reading them apart is most of what makes it look
// like Giza rather than a sandcastle. The three the first pass had are kept exactly; what
// is added is the RANGE within each, plus the basalt and mudbrick that are genuinely
// present on the plateau, plus the pigments.
const ROCK = {
  casing: 0xe8e0cb,        // Tura limestone, near white and polished -- survives at Khafre's cap
  casingWarm: 0xdcd2b8,
  core: 0xc9b389,          // the yellow-grey local Mokattam rock the bulk is built from
  coreDark: 0xa89370,
  coreLight: 0xd9c49c,
  corePale: 0xdfceaa,
  granite: 0x9a7d72,       // Aswan granite -- grey-pink with dark speckle, NOT terracotta:
  graniteDark: 0x7e6459,   // at full saturation the valley temple looked like a brick shed
  granitePink: 0xa8867a,
  basalt: 0x4a453f,        // the paving of Khufu's mortuary temple is basalt, and it is black
  mudbrick: 0xa9835a,
  alabaster: 0xe6dcc4,
  sand: 0xd6c096,
  sandPale: 0xe0cda6,
  sandDark: 0xbfa87e,
};

// THE EGYPTIAN PIGMENT PALETTE, and it is six colours because that is genuinely how many
// they had. Every one is a mineral a student can be told the source of: Egyptian blue is
// the first synthetic pigment in history, malachite and red/yellow ochre are ground rock,
// carbon black is soot, gypsum white is plaster. Monuments were painted in these and the
// colour survives in sheltered places -- which is exactly why the carvings here are
// polychrome in their recesses and bleached on their exposed faces.
const PIGMENT = {
  blue: 0x2f5f9e,
  green: 0x3f7d5a,
  red: 0xa8422c,
  yellow: 0xd9a63c,
  black: 0x2b2620,
  white: 0xe8e2d2,
  gold: 0xd9b45c,
};

const PALM = {
  trunk: 0x8a7150, trunkDark: 0x6f5a3d,
  frond: 0x5c7a35, frondDark: 0x44602a, frondPale: 0x7b9448, frondDry: 0x9a8a4a,
  date: 0xb5772e, dateDark: 0x8a5320,
};

// ---------------------------------------------------------------------------
// Hieroglyphs
// ---------------------------------------------------------------------------

// A column of glyph-like marks. These are deliberately NOT real hieroglyphs spelling real
// words -- inventing plausible-looking text and presenting it as Egyptian would teach
// something false. They are the SHAPES of the writing system: tall narrow columns, each
// glyph roughly square or half-square, grouped so two small glyphs stack in the space of
// one large one, which is the actual layout rule and the thing that makes a wall read as
// Egyptian from across a courtyard.
function glyphColumn(ctx, x, y, width, height, rng, ink, palette = null) {
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  let cursor = y;
  const cell = width * 0.86;
  // Polychrome: a real painted wall gives each glyph its own colour from the mineral set.
  const pick = () => {
    if (!palette) return ink;
    return palette[Math.floor(rng() * palette.length)];
  };

  while (cursor < y + height - cell * 0.4) {
    const kind = Math.floor(rng() * 7);
    const cx = x + width / 2;
    const colour = pick();
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
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

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// A carved wall face: sun-bleached plaster, ruled columns of glyphs, and a cartouche.
// `cartouche` draws the royal-name oval, which is the one element that says "this names a
// king" rather than "this is decorated".
//
// `paint` turns on the mineral palette. Egyptian monuments were brilliantly polychrome and
// the colour survives wherever the sun and sand have not reached, so a surface that is
// painted in its recesses and bleached on its exposed faces is more accurate than either
// extreme -- and it is far more legible from across a courtyard than monochrome incision.
function hieroglyphTexture({
  seed = 3, columns = 6, cartouche = true, base = '#d8c8a2', ink = '#6b4a2c', paint = true,
} = {}) {
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

    const palette = paint
      ? [hex(PIGMENT.blue), hex(PIGMENT.green), hex(PIGMENT.red), hex(PIGMENT.yellow), hex(PIGMENT.black), ink]
      : null;

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
      glyphColumn(ctx, margin + i * colW + colW * 0.12, top + 10, colW * 0.76, h - margin - top - 16, rng, ink, palette);
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
      glyphColumn(ctx, cx - rx * 0.55, cy - ry * 0.7, rx * 0.5, ry * 1.4, seededRandom(seed + 11), ink, palette);
      glyphColumn(ctx, cx + rx * 0.08, cy - ry * 0.7, rx * 0.5, ry * 1.4, seededRandom(seed + 23), ink, palette);
    }

    // Sun bleaching LAST, and strongest at the top: a monument's exposed upper surfaces
    // lose their paint first, so the colour survives low down and in the shade.
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(226, 212, 178, 0.42)');
    grd.addColorStop(0.6, 'rgba(226, 212, 178, 0.12)');
    grd.addColorStop(1, 'rgba(226, 212, 178, 0.02)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
  });
}

// ---------------------------------------------------------------------------
// Sunk relief -- the warp that makes a carved surface
// ---------------------------------------------------------------------------

// EGYPTIAN CARVING IS *SUNK* RELIEF (`relief en creux`): the outline is cut down into the
// face and the figure modelled inside that cut, so the surface stays flush and the sun
// alone makes it readable. It is the technique used on everything exposed to the open air,
// for exactly the reason it works here -- raised relief in that light goes flat by noon.
//
// As a warp it is a grid of shallow rectangular pits: cells across, registers up, with a
// deeper channel between the ruled columns. The field is cut only where it crosses zero so
// the cuts are NARROW, which is what a chisel makes, and the frequencies are bounded by the
// loft's sample count.
function sunkRelief({ columns = 2, registers = 9, depth = 1, seed = 1 } = {}) {
  return (t, u, s) => {
    const across = u * columns * 4;
    const along = t * registers;
    // Column rules: continuous vertical channels, the deepest cut on the face.
    const rule = grooveAt(Math.sin(across * Math.PI), 0.22, depth * 1.15);
    // Register lines: continuous horizontal channels between rows of glyphs.
    const reg = grooveAt(Math.sin(along * Math.PI * 2), 0.20, depth * 0.85);
    // The glyphs themselves: a pseudo-random field of blocky pits inside each cell.
    const cellU = Math.floor(across);
    const cellT = Math.floor(along * 2);
    const n = smoothNoise3(cellU * 3.1 + seed, cellT * 2.7, 0.5);
    const fu = Math.sin((across - cellU - 0.5) * Math.PI * 2 * (1 + Math.floor(n * 3)));
    const ft = Math.sin((along * 2 - cellT - 0.5) * Math.PI * 2 * (1 + Math.floor(n * 5) % 3));
    const glyph = grooveAt(Math.max(Math.abs(fu), Math.abs(ft)) - 0.55, 0.30, depth * 0.7);
    return Math.max(rule + reg + glyph, -s.w * 0.16);
  };
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
//    everybody recognises from photographs and it is geology, not damage -- and it is now a
//    GROOVE cut into the body's own surface rather than a beam laid along it.
export function greatSphinx({ seed = 5 } = {}) {
  const parts = [];

  // Authored directly in WORLD feet at 1:5, with the real dimension in the comment. The
  // Sphinx is 240ft long, 66ft tall and 62ft across the paws, so 48 x 13.2 x 12.4 here.
  // THE HEIGHT BUDGET, and getting it wrong is what wrecked the first attempt.
  //
  // The Sphinx is 66ft to the top of the nemes and its BACK is only about 44ft -- so the
  // body occupies two thirds of the height and the head and neck the other third. The first
  // version gave the body a centre line at 6.4 with a half-height of 6.5, putting its back
  // at 13.0 out of a total 13.2: the head then had nowhere to go and sat sunk into the
  // shoulders, which read as a lion with a lump on it rather than as the Sphinx.
  const L = 240 * GIZA;      // 48 -- 240ft nose to tail
  const BACK = 44 * GIZA;    // 8.8 -- top of the back
  const TOP = 66 * GIZA;     // 13.2 -- top of the nemes
  const headY = 10.8;
  const headZ = 9.6;
  const headR = 2.3;         // the head is ~20ft wide, so 4ft here; the nemes widens it

  // --- Bedrock ledge -------------------------------------------------------
  // The Sphinx sits IN the rock, not on it: it is carved from a ridge left standing when
  // the quarry around it was cut away, so the enclosure floor is part of the monument.
  put(parts, solidLoft([
    { d: -L * 0.58, w: 9.0, up: 0.9, dn: 2.4, round: 0.16 },
    { d: -L * 0.20, w: 8.6, up: 0.9, dn: 2.4, round: 0.14 },
    { d: L * 0.30, w: 8.2, up: 0.85, dn: 2.4, round: 0.14 },
    { d: L * 0.58, w: 7.6, up: 0.8, dn: 2.4, round: 0.18 },
  ], {
    sides: 22,
    samples: 18,
    // The quarry face is cut in courses, which is what says "this was dug out".
    warp: (t, u, s) => {
      const up = Math.sin(u * Math.PI * 2);
      const localY = up * (up >= 0 ? s.up : s.dn);
      return grooveAt(Math.sin((localY / 0.9) * Math.PI * 2), 0.4, 0.10);
    },
  }), ROCK.coreDark, [0, 0.5, -L * 0.02]);

  // --- Body ----------------------------------------------------------------
  // ONE lofted solid whose SECTION CHANGES SHAPE. A recumbent lion is broad and low across
  // the haunches, waisted between them, and deep and narrow at the chest -- none of which a
  // swept circle can express, which is why the old body read as a loaf.
  //
  // THE LAST STATION IS TINY, AND THAT IS THE POINT. `solidLoft` always closes both ends
  // with a fan, so a loft that stops at a full-size station ends in a FLAT DISC. The first
  // version ran the body forward to a 3.8ft half-width station and the Sphinx's chest came
  // out as a great vertical plate facing the approach -- the single most visible thing in
  // the world, and unmistakably a mistake rather than a stylisation. Ending small tucks the
  // cap away inside the chest mass that overlaps it.
  const bodyStations = [
    { d: -L * 0.50, w: 2.3, up: 2.3, dn: 2.3, b: 3.1, round: 0.75 },
    { d: -L * 0.42, w: 4.1, up: 3.3, dn: 3.1, b: 3.8, round: 0.55 },
    { d: -L * 0.31, w: 5.2, up: 4.1, dn: 3.6, b: 4.4, round: 0.48 },
    { d: -L * 0.17, w: 4.4, up: 4.2, dn: 3.8, b: 4.6, round: 0.54 },
    { d: 0, w: 4.1, up: 4.3, dn: 3.9, b: 4.6, round: 0.58 },
    { d: L * 0.13, w: 4.1, up: BACK - 4.6, dn: 3.9, b: 4.6, round: 0.60 },
    { d: L * 0.175, w: 3.9, up: 4.1, dn: 3.9, b: 4.5, round: 0.68 },
    // THE END CAP HAS TO FINISH INSIDE THE CHEST, not merely near it.
    //
    // A warped loft's end fan runs from the section's UN-warped centre out to its warped
    // rim, so wherever a warp is running the cap shows as a ring of scalloped wedges. This
    // one ended at L * 0.26 -- z = 12.5 -- while the chest that was supposed to cover it
    // only reaches z = 11.8, so the Sphinx had a stone rosette sitting between its front
    // paws like a scallop shell. Ending at 9.6 puts it a clear two feet inside solid stone.
    { d: L * 0.20, w: 2.0, up: 2.4, dn: 2.3, b: 4.3, round: 0.95 },
  ];

  // THE WEATHERING BANDS, as horizontal grooves in the body's own surface.
  //
  // Deriving the band's height from the SECTION rather than from a guessed radius is the
  // whole trick: `u` runs round the section, so the local height above the centre line is
  // sin(2*pi*u) times the local half-height, and cutting where THAT crosses a spacing grid
  // gives strictly horizontal bands that follow the body wherever it goes. The old version
  // laid box beams along the flank at a hand-fitted radius and the file's own comment
  // records that the first attempt buried every one of them inside the stone.
  //
  // SIX BANDS, NOT THIRTEEN, AND THAT IS A NYQUIST LIMIT RATHER THAN A STYLE CHOICE. The
  // +X flank spans only HALF the section's u range, so at 46 sides just 23 samples cover
  // the body's whole 12ft height: thirteen 0.9ft bands came to under two samples each,
  // which is not a ridge, it is aliasing -- and the body rendered as a featureless bar of
  // soap. Six bands at 72 sides is six samples each, which resolves.
  const bandWarp = (t, u, s) => {
    const up = Math.sin(u * Math.PI * 2);
    const localY = up * (up >= 0 ? s.up : s.dn);
    const spacing = 1.7;
    const jitter = smoothNoise3(localY * 0.5, 0, 0) * 0.4;
    const band = Math.sin((localY / spacing + jitter) * Math.PI * 2);
    // Deepest on the flanks and absent over the back: the strata are cut through by the
    // vertical faces, so the top of the animal has no banding at all.
    const flank = 0.25 + 0.75 * Math.pow(Math.abs(Math.cos(u * Math.PI * 2)), 0.9);
    let d = grooveAt(band, 0.46, 0.62 * flank);
    // Broad erosion hollows along the length -- the flanks are scalloped, not merely ribbed.
    d += grooveAt(Math.sin(t * 7.5 + localY * 0.6), 0.7, 0.34 * flank);
    return Math.max(d, -s.w * 0.22);
  };

  put(parts, solidLoft(bodyStations, { sides: 72, samples: 64, warp: bandWarp }), ROCK.core);

  // --- Haunches ------------------------------------------------------------
  // The rear legs are folded under, so what shows on each flank is the great bulge of the
  // thigh plus a rear paw. Rooted INSIDE the body, not sitting on its surface.
  for (const side of [-1, 1]) {
    put(parts, solidLoft([
      { d: -L * 0.42, w: 1.0, up: 1.2, dn: 1.2, round: 0.8 },
      { d: -L * 0.34, w: 2.0, up: 2.4, dn: 2.3, round: 0.6 },
      { d: -L * 0.25, w: 1.8, up: 2.1, dn: 2.1, round: 0.64 },
      { d: -L * 0.16, w: 0.9, up: 1.2, dn: 1.4, round: 0.8 },
    ], { sides: 20, samples: 16 }), ROCK.core, [side * 3.0, 4.2, 0]);

    // Rear paw, tucked and pointing forward along the flank.
    put(parts, solidLoft([
      { d: -L * 0.19, w: 0.9, up: 0.95, dn: 0.75, round: 0.5 },
      { d: -L * 0.12, w: 1.05, up: 1.0, dn: 0.8, round: 0.42 },
      { d: -L * 0.075, w: 0.9, up: 0.8, dn: 0.75, round: 0.55 },
    ], { sides: 16, samples: 10 }), ROCK.coreLight, [side * 3.9, 1.3, 0]);
  }

  // --- Tail ----------------------------------------------------------------
  // Curled up the right haunch, which is where the real one is. It ends in a tuft, so the
  // sweep is allowed to close to a point.
  put(parts, tube(
    [[0, 4.4, -L * 0.45], [3.2, 3.2, -L * 0.49], [4.6, 2.3, -L * 0.39], [4.4, 1.7, -L * 0.27]],
    [0.8, 0.62, 0.46, 0.05],
    { sides: 12 },
  ), ROCK.core);

  // --- Chest ---------------------------------------------------------------
  // The breast rises almost vertically to the shoulders, which is what gives the Sphinx its
  // upright, seated-forward presence. It OVERLAPS the body's forward end, hiding the loft's
  // end cap inside solid stone.
  put(parts, solidLoft([
    { d: -0.8, w: 3.7, up: 1.9, dn: 2.4, round: 0.42, b: 9.9 },
    { d: 3.4, w: 3.8, up: 2.0, dn: 2.5, round: 0.40, b: 10.0 },
    { d: 6.2, w: 3.5, up: 1.9, dn: 2.4, round: 0.44, b: 10.0 },
    { d: 8.2, w: 2.9, up: 1.7, dn: 2.1, round: 0.54, b: 9.9 },
    { d: 9.4, w: 1.9, up: 1.3, dn: 1.5, round: 0.86, b: 9.6 },
  ], {
    axis: 'y',
    sides: 40,
    samples: 40,
    // THE CHEST NEEDS ITS OWN WARP, and reusing the body's was a real mistake.
    //
    // `bandWarp` recovers the height of a point from sin(2*pi*u) times the section's
    // half-height, which is correct on the body because that loft runs along Z and its
    // `up`/`dn` ARE the vertical. The chest runs along Y, so its `up`/`dn` are DEPTH in Z --
    // and the same expression then produces rings concentric about the vertical axis rather
    // than horizontal bands. The Sphinx's breast came out with a radial fan carved into it,
    // which read unmistakably as a scallop shell.
    //
    // On a vertical loft the height is simply `d`, so the strata are a function of t alone.
    warp: (t, u, s) => {
      const y = -0.8 + t * 10.2;
      const flank = 0.3 + 0.7 * Math.pow(Math.abs(Math.cos(u * Math.PI * 2)), 0.9);
      const jitter = smoothNoise3(y * 0.5, 0, 0) * 0.4;
      return grooveAt(Math.sin((y / 1.7 + jitter) * Math.PI * 2), 0.46, 0.34 * flank);
    },
  }), ROCK.core);

  // --- Forelegs ------------------------------------------------------------
  // These run 50 real feet forward of the chest. Recumbent means the paws are thrown out
  // well ahead of the body; built with the legs under it, the animal reads as a cat loaf.
  const pawZ = L * 0.50;
  for (const side of [-1, 1]) {
    const sx = side * 2.9;
    put(parts, solidLoft([
      { d: 5.6, w: 2.2, up: 2.4, dn: 2.1, round: 0.6, a: sx, b: 2.8 },
      { d: 11.0, w: 1.8, up: 1.9, dn: 1.7, round: 0.5, a: sx * 1.03, b: 2.0 },
      { d: 16.0, w: 1.56, up: 1.5, dn: 1.4, round: 0.42, a: sx * 1.05, b: 1.6 },
      { d: 21.0, w: 1.46, up: 1.3, dn: 1.3, round: 0.36, a: sx * 1.05, b: 1.35 },
      { d: pawZ - 0.4, w: 1.46, up: 1.15, dn: 1.2, round: 0.30, a: sx * 1.05, b: 1.25 },
      { d: pawZ + 1.4, w: 1.2, up: 0.85, dn: 1.0, round: 0.42, a: sx * 1.05, b: 1.1 },
    ], {
      sides: 30,
      samples: 30,
      warp: (t, u, s) => {
        const up = Math.sin(u * Math.PI * 2);
        const localY = up * (up >= 0 ? s.up : s.dn);
        const flank = 0.3 + 0.7 * Math.pow(Math.abs(Math.cos(u * Math.PI * 2)), 0.9);
        return grooveAt(Math.sin((localY / 1.3) * Math.PI * 2), 0.44, 0.20 * flank);
      },
    }), ROCK.core);

    // FOUR TOES, and they have to be clear of the leg's own silhouette or they contribute
    // nothing. They are the detail at a student's own eye height, since the paws are the
    // only part of the whole monument you can stand beside -- so they run forward PAST the
    // leg's end station and sit low, on the ledge.
    for (let t = 0; t < 4; t++) {
      const tx = sx * 1.05 + (t - 1.5) * 0.70;
      put(parts, solidLoft([
        { d: pawZ - 1.2, w: 0.32, up: 0.44, dn: 0.40, round: 0.55 },
        { d: pawZ + 1.6, w: 0.35, up: 0.46, dn: 0.42, round: 0.5 },
        { d: pawZ + 2.9, w: 0.27, up: 0.32, dn: 0.34, round: 0.7 },
      ], { sides: 12, samples: 8 }), ROCK.coreLight, [tx, 0.56, 0]);
    }
  }

  // --- Neck ----------------------------------------------------------------
  // Rooted well down INSIDE the chest rather than on its surface, so the seam where the two
  // solids meet is hidden in stone.
  put(parts, solidLoft([
    { d: 7.6, w: headR * 0.98, up: headR * 0.94, dn: headR * 0.94, round: 0.9, b: headZ - 0.4 },
    { d: headY - headR * 1.3, w: headR * 0.78, up: headR * 0.74, dn: headR * 0.74, round: 1, b: headZ - 0.2 },
    { d: headY - headR * 0.6, w: headR * 0.76, up: headR * 0.72, dn: headR * 0.72, round: 1, b: headZ },
  ], { axis: 'y', sides: 22, samples: 12 }), ROCK.coreLight);

  // --- Head ----------------------------------------------------------------
  // Small against the body -- the head is carved from a harder upper stratum and was
  // reworked, while the body eroded far faster, and sizing it "properly" for the body is
  // the single easiest way to make it look wrong.
  const skull = solidLoft([
    { d: headY - headR * 1.05, w: headR * 0.70, up: headR * 0.68, dn: headR * 0.78, round: 0.86 },
    { d: headY - headR * 0.55, w: headR * 0.86, up: headR * 0.82, dn: headR * 0.90, round: 0.8 },
    { d: headY, w: headR * 0.92, up: headR * 0.86, dn: headR * 0.90, round: 0.82 },
    { d: headY + headR * 0.55, w: headR * 0.88, up: headR * 0.82, dn: headR * 0.86, round: 0.86 },
    { d: headY + headR * 0.98, w: headR * 0.55, up: headR * 0.52, dn: headR * 0.54, round: 1 },
  ], { axis: 'y', sides: 26, samples: 18 });
  skull.translate(0, 0, headZ);
  put(parts, skull, ROCK.coreLight);

  // The face: a shallow mass proud of the skull, narrower than it so the nemes frames it.
  put(parts, solidLoft([
    { d: headY - headR * 0.92, w: headR * 0.48, up: headR * 0.28, dn: headR * 0.32, round: 0.8 },
    { d: headY - headR * 0.42, w: headR * 0.68, up: headR * 0.40, dn: headR * 0.42, round: 0.7 },
    { d: headY + headR * 0.10, w: headR * 0.74, up: headR * 0.44, dn: headR * 0.44, round: 0.72 },
    { d: headY + headR * 0.50, w: headR * 0.62, up: headR * 0.36, dn: headR * 0.38, round: 0.82 },
  ], { axis: 'y', sides: 18, samples: 14 }), ROCK.coreLight, [0, 0, headZ + headR * 0.44]);

  // Brow ridge -- one soft bar across, which is what puts the eyes in shadow at any range.
  dome(parts, ROCK.coreLight, {
    radius: headR * 0.56, height: headR * 0.14,
    at: [0, headY + headR * 0.30, headZ + headR * 0.80], rot: [Math.PI / 2.4, 0, 0], detail: 12, sink: 0.58,
  });
  // Eyes: recessed sockets, no eyeball -- at this size a carved eye IS its own shadow.
  for (const side of [-1, 1]) {
    dome(parts, 0x7e6743, {
      radius: headR * 0.18, height: headR * 0.05,
      at: [side * headR * 0.33, headY + headR * 0.08, headZ + headR * 0.84],
      rot: [Math.PI / 2.2, 0, side * 0.12], detail: 8, sink: 0.86,
    });
  }
  // The nose is BROKEN OFF, and building it broken is the honest choice -- every student has
  // seen the photograph. A stub of bridge, then a flat raw scar where the rest was, and the
  // scar is PALER than the weathered face around it because a fresh fracture in limestone is.
  put(parts, solidLoft([
    { d: headY + headR * 0.22, w: headR * 0.09, up: headR * 0.05, dn: headR * 0.05, round: 0.8 },
    { d: headY + headR * 0.02, w: headR * 0.12, up: headR * 0.07, dn: headR * 0.07, round: 0.8 },
  ], { axis: 'y', sides: 8, samples: 4 }), ROCK.coreLight, [0, 0, headZ + headR * 0.88]);
  put(parts, extrudeOutline(roundedOutline(headR * 0.16, headR * 0.16, headR * 0.05, 2), headR * 0.08),
    ROCK.corePale, [0, headY - headR * 0.20, headZ + headR * 0.88]);

  // Mouth: a wide shallow recess with a full lower lip under it. The Sphinx's mouth is
  // unusually wide and that width is part of why the face is recognisable.
  put(parts, extrudeOutline(lensOutline(headR * 0.32, headR * 0.045, 6), headR * 0.09),
    0x7e6743, [0, headY - headR * 0.48, headZ + headR * 0.82]);
  dome(parts, ROCK.coreLight, {
    radius: headR * 0.28, height: headR * 0.06,
    at: [0, headY - headR * 0.58, headZ + headR * 0.78], rot: [Math.PI / 2.3, 0, 0], detail: 10, sink: 0.62,
  });

  // --- The nemes headcloth -------------------------------------------------
  // The striped royal headcloth, and the whole silhouette. Without it a human-headed lion is
  // a sculpture of a human-headed lion; with it, it is Egyptian and it is royal.
  //
  // THE STRIPES ARE GROOVES IN THE SHELL'S OWN SURFACE. The first pass tried them as stacked
  // colour bands and then abandoned them entirely, because "a band laid on a curved swept
  // surface can only be positioned by re-deriving the sweep" -- which is exactly what a warp
  // does for free. TEN pleats at 72 sides is seven samples each; the first attempt at
  // eighteen was three, and an under-sampled warp does not merely look coarse, it computes
  // garbage normals from near-degenerate quads and renders the whole headcloth dark brown.
  const pleatWarp = (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * 10), 0.30, s.w * 0.13);
  const cap = solidLoft([
    { d: headY - headR * 0.55, w: headR * 1.18, up: headR * 1.10, dn: headR * 1.18, round: 0.72 },
    { d: headY + headR * 0.10, w: headR * 1.22, up: headR * 1.14, dn: headR * 1.20, round: 0.74 },
    { d: headY + headR * 0.70, w: headR * 1.08, up: headR * 1.00, dn: headR * 1.04, round: 0.82 },
    { d: headY + headR * 1.12, w: headR * 0.58, up: headR * 0.54, dn: headR * 0.56, round: 1 },
  ], { axis: 'y', sides: 72, samples: 24, warp: pleatWarp });
  cap.translate(0, 0, headZ - headR * 0.06);
  put(parts, cap, ROCK.corePale);

  // Brow fillet -- the band tying the nemes across the forehead. Without it the shell reads
  // as a swim cap.
  put(parts, revolve([
    [headR * 1.14, 0], [headR * 1.28, headR * 0.06], [headR * 1.30, headR * 0.20],
    [headR * 1.18, headR * 0.26], [headR * 1.14, headR * 0.30],
  ], { segments: 30 }), ROCK.core, [0, headY + headR * 0.34, headZ - headR * 0.06]);

  // Lappets -- ONE broad flat flap each side, falling from the temple onto the chest. They
  // are what makes the head read WIDE, which is the Sphinx's most recognisable quality from
  // the front, and they are the half most people would forget.
  for (const side of [-1, 1]) {
    put(parts, solidLoft([
      { d: headY + headR * 0.40, w: headR * 0.34, up: headR * 0.26, dn: headR * 0.26, round: 0.5, a: side * headR * 0.98, b: headZ + headR * 0.10 },
      { d: headY - headR * 0.30, w: headR * 0.52, up: headR * 0.26, dn: headR * 0.26, round: 0.38, a: side * headR * 1.14, b: headZ + headR * 0.34 },
      { d: headY - headR * 1.10, w: headR * 0.66, up: headR * 0.24, dn: headR * 0.24, round: 0.30, a: side * headR * 1.22, b: headZ + headR * 0.50 },
      { d: headY - headR * 1.80, w: headR * 0.54, up: headR * 0.20, dn: headR * 0.20, round: 0.36, a: side * headR * 1.24, b: headZ + headR * 0.54 },
    ], {
      axis: 'y',
      sides: 30,
      samples: 20,
      warp: (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * 5), 0.30, s.w * 0.20),
    }), ROCK.corePale);
  }

  // The queue -- the plaited tail of the nemes down the back of the neck.
  put(parts, solidLoft([
    { d: headY - headR * 0.20, w: headR * 0.28, up: headR * 0.23, dn: headR * 0.23, round: 0.7, b: headZ - headR * 0.98 },
    { d: headY - headR * 1.05, w: headR * 0.24, up: headR * 0.20, dn: headR * 0.20, round: 0.7, b: headZ - headR * 1.02 },
    { d: headY - headR * 1.80, w: headR * 0.17, up: headR * 0.15, dn: headR * 0.15, round: 0.8, b: headZ - headR * 0.92 },
  ], {
    axis: 'y',
    sides: 20,
    samples: 12,
    warp: (t, u, s) => grooveAt(Math.sin(u * Math.PI * 2 * 4), 0.30, s.w * 0.22),
  }), ROCK.core);

  // The uraeus -- the rearing cobra on the brow. Small, but it is the mark of kingship and
  // its absence is felt even by someone who could not name it.
  dome(parts, ROCK.core, {
    radius: headR * 0.12, height: headR * 0.09,
    at: [0, headY + headR * 0.62, headZ + headR * 0.78], detail: 8, sink: 0.4,
  });
  put(parts, tube([
    [0, headY + headR * 0.42, headZ + headR * 0.84],
    [0, headY + headR * 0.54, headZ + headR * 0.88],
    [0, headY + headR * 0.62, headZ + headR * 0.82],
  ], [headR * 0.05, headR * 0.055, headR * 0.04], { sides: 7 }), ROCK.core);

  // --- Assembly ------------------------------------------------------------
  // Wind-blown sand piles against the lower body and stains it, and the whole monument is
  // bleached on top. As geometry that would be hundreds of solids.
  const geo = mergeParts(parts);
  tintGeometry(geo, (p, c) => {
    const buried = THREE.MathUtils.clamp(1 - p.y / 4.2, 0, 1);
    const mottle = 0.88 + smoothNoise3(p.x * 0.5, p.y * 0.5, p.z * 0.5) * 0.24;
    const k = mottle * (1 - buried * 0.09);
    return [
      c.r * k * (1 + buried * 0.05),
      c.g * k * (1 + buried * 0.01),
      c.b * k * (1 - buried * 0.10),
    ];
  });
  void TOP;
  void BACK;
  return group(mesh(geo, standard({
    vertexColors: true,
    roughness: 0.97,
    ...relief('stone', { seed: seed + 3, repeat: 14, strength: 0.75 }),
  })));
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
// WHAT THE REBUILD ADDS is the RUIN. The old one was 32 clean concentric boxes -- 416
// triangles, and it read as a wedding cake. A real pyramid has: courses that are visibly
// different heights, blocks missing from the arrises so the edges are ragged, a great apron
// of fallen casing and rubble round the base, and a rounded worn summit. None of that is
// expensive; all of it is what makes the thing look four and a half thousand years old.
export function gizaPyramid({
  baseWidth = 756 * GIZA,
  height = 481 * GIZA,
  courses = 34,
  capHeight = 0,
  graniteCourses = 0,
  seed = 9,
  entrance = true,
  rubble = true,
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

    // Courses get thinner toward the top on a real pyramid, and the colour varies course to
    // course because the quarries did.
    const wobble = 1 + (rng() - 0.5) * 0.02;
    const isGranite = i < graniteCourses;
    const shade = isGranite
      ? (i % 2 ? ROCK.granite : ROCK.granitePink)
      : [ROCK.coreDark, ROCK.core, ROCK.corePale, ROCK.coreLight][i % 4];

    // Chamfered rather than square: four and a half thousand years of wind has taken every
    // arris off, and a stack of sharp-edged boxes is the thing that reads as a cake.
    const blockH = courseH * (0.94 + rng() * 0.1);
    put(parts, extrudeOutline(
      roundedOutline((w * wobble) / 2, (w * wobble) / 2, w * 0.012, 1), blockH,
    ), shade, [0, y, 0], [Math.PI / 2, 0, 0]);

    // MISSING BLOCKS along the arrises. A pyramid's corners are its most damaged part --
    // casing was quarried away from the edges first -- so a few notches per course, chosen
    // from the seeded stream, break the silhouette. Without them the outline is four
    // perfectly straight lines and no amount of texture rescues it.
    if (i > 2 && i < courses - 2) {
      const notches = Math.floor(rng() * 3);
      for (let n = 0; n < notches; n++) {
        const face = Math.floor(rng() * 4);
        const a = (face / 4) * Math.PI * 2;
        const along = (rng() - 0.5) * 1.5;
        const nw = w * randomIn(rng, 0.04, 0.09);
        // Set INTO the face: the block sits at the face plane pushed inward by most of its
        // own depth, so what shows is a shadowed gap in the course rather than a lump.
        const inset = w / 2 - nw * 0.34;
        put(parts, new THREE.BoxGeometry(nw, blockH * 0.94, nw),
          0x8a7350,
          [Math.cos(a) * inset - Math.sin(a) * along * w * 0.42,
            y,
            Math.sin(a) * inset + Math.cos(a) * along * w * 0.42],
          [0, -a, 0]);
      }
    }
  }

  // The surviving casing cap: a smooth four-sided pyramid on the top courses. Four radial
  // segments on a CylinderGeometry gives flat faces, rotated 45 degrees to put its corners
  // on the diagonals rather than its faces.
  if (capHeight > 0) {
    const capBase = baseWidth * (capHeight / height) * 1.04;
    const cap = new THREE.CylinderGeometry(0, capBase / 2, capHeight, 4, 1);
    cap.rotateY(Math.PI / 4);
    cap.scale(1.005, 1, 1.005);
    put(parts, cap, ROCK.casing, [0, height - capHeight, 0]);
    // The ragged lower edge of the surviving casing: it did not stop in a straight line.
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = capBase / 2 * (0.98 + rng() * 0.06);
      put(parts, new THREE.BoxGeometry(capBase * 0.09, capHeight * randomIn(rng, 0.03, 0.1), capBase * 0.09),
        rng() > 0.5 ? ROCK.casing : ROCK.casingWarm,
        [Math.cos(a) * r, height - capHeight, Math.sin(a) * r], [0, -a, 0]);
    }
  } else {
    // A pyramid with no casing has a WORN, ROUNDED, BROKEN summit -- the top thirty feet of
    // Khufu are simply gone. A clean point is the giveaway that this is a diagram.
    const topW = baseWidth / courses;
    for (let i = 0; i < 7; i++) {
      const r = topW * randomIn(rng, 0.22, 0.44);
      put(parts, smoothed(roughenSphere(new THREE.IcosahedronGeometry(r, 2), { amount: 0.26, phase: i }), 1e-3),
        [ROCK.core, ROCK.coreDark, ROCK.coreLight][i % 3],
        [randomIn(rng, -topW * 0.55, topW * 0.55),
          height - r * randomIn(rng, 0.1, 0.7),
          randomIn(rng, -topW * 0.55, topW * 0.55)]);
    }
  }

  // The entrance: a dark recess on the north face, offset from centre exactly as Khufu's
  // is. A lintel above and a void behind, because a flat dark rectangle on a stepped wall
  // reads as a painted patch.
  if (entrance) {
    const ey = height * 0.28;
    const ew = baseWidth * 0.045;
    const faceX = (baseWidth * (1 - ey / height)) / 2;
    // The dark void is set BACK into the face, and the relieving gable over it is small.
    //
    // The first version sized the gable slabs off `ew * 1.7` and stood them at `faceX * 1.03`
    // -- proud of the stone -- which on Khufu made two 11ft slabs leaning off the side of
    // the pyramid at 30 degrees. From the spawn they read as dark wedges stuck to the
    // monument, and they were the loudest wrong thing in the world.
    put(parts, new THREE.BoxGeometry(ew * 0.8, ew * 1.1, ew * 0.9), 0x241d15,
      [-baseWidth * 0.03, ey, faceX * 0.94]);
    for (const side of [-1, 1]) {
      put(parts, new THREE.BoxGeometry(ew * 0.22, ew * 0.62, ew * 0.3), ROCK.granite,
        [-baseWidth * 0.03 + side * ew * 0.22, ey + ew * 0.72, faceX * 0.97], [0, 0, side * 0.62]);
    }
  }

  // THE RUBBLE APRON. Every pyramid at Giza stands in a great skirt of its own fallen
  // casing -- at Khufu it is thirty feet deep. Without it the courses meet the sand in a
  // clean line and the pyramid reads as having been PLACED on the desert rather than as
  // having shed itself over four millennia. It is also what hides the bottom course's
  // corners, which is the least convincing part of any stepped stack.
  if (rubble) {
    const skirt = baseWidth * 0.5;
    for (let i = 0; i < 90; i++) {
      const a = rng() * Math.PI * 2;
      // Concentrated at the base and thinning outward.
      const spread = Math.pow(rng(), 1.8);
      const r = skirt * (0.92 + spread * 0.30);
      const s = baseWidth * randomIn(rng, 0.006, 0.022) * (1 - spread * 0.4);
      // Square to the pyramid's own axes, because these are dressed blocks that fell.
      const corner = Math.abs(Math.cos(a * 2));
      put(parts, extrudeOutline(roundedOutline(s, s * randomIn(rng, 0.5, 0.9), s * 0.16, 1), s * randomIn(rng, 0.8, 1.6)),
        [ROCK.casingWarm, ROCK.core, ROCK.coreDark, ROCK.sandDark][i % 4],
        [Math.cos(a) * r, s * randomIn(rng, 0.1, 0.5), Math.sin(a) * r],
        [randomIn(rng, -0.3, 0.3), rng() * Math.PI, randomIn(rng, -0.3, 0.3) + corner * 0.1]);
    }
    // A continuous low bank of sand and chips under the blocks, so they are lying IN a
    // slope rather than scattered on a flat plane.
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const bank = roughenSphere(new THREE.IcosahedronGeometry(baseWidth * 0.10, 2), { amount: 0.2, flatten: 0.16 });
      bank.scale(1.5, 1, 0.8);
      put(parts, bank, i % 2 ? ROCK.sandDark : ROCK.sand,
        [Math.cos(a) * skirt * 1.02, 0, Math.sin(a) * skirt * 1.02], [0, -a, 0]);
    }
  }

  const geo = mergeParts(parts);
  // Wind scour: the windward (north-west) faces are cleaner and paler, the lee faces hold
  // sand. One directional term does what a dozen colours could not.
  tintGeometry(geo, (p, c) => {
    const lee = THREE.MathUtils.clamp(0.5 + (p.x + p.z) / (baseWidth * 1.6), 0, 1);
    const n = smoothNoise3(p.x * 0.06, p.y * 0.06, p.z * 0.06);
    const k = 0.9 + n * 0.2;
    return [c.r * k * (1 + lee * 0.05), c.g * k * (1 + lee * 0.02), c.b * k * (1 - lee * 0.06)];
  });
  return group(mesh(geo, standard({
    vertexColors: true,
    roughness: 0.96,
    ...relief('stone', { seed: seed + 5, repeat: 20, strength: 0.5 }),
  })));
}

// ---------------------------------------------------------------------------
// Valley temple
// ---------------------------------------------------------------------------

// Khafre's valley temple, beside the Sphinx: the most austere building in Egypt. Bare
// Aswan granite megaliths, post and lintel, no decoration at all -- which is exactly why it
// is worth building, since every OTHER Egyptian building a student pictures is covered in
// carving. The contrast is the point, and it is why the hieroglyph walls in this world are
// on the stela and the obelisk instead.
//
// The rebuild's whole job is to make the MASONRY read, because that is all this building
// has. Real Khafre valley-temple blocks are colossal, irregular, and fitted with joints you
// could not get a knife into -- so the wall is built block by block from a running bond
// whose courses are different heights, not as five stacked slabs.
export function valleyTemple({ width = 28, depth = 22, height = 11, seed = 17 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // Plinth.
  put(parts, extrudeOutline(roundedOutline((width + 3) / 2, (depth + 3) / 2, 0.4, 1), 1.2),
    ROCK.graniteDark, [0, 0.6, 0], [Math.PI / 2, 0, 0]);

  const wall = 1.8;

  // A coursed megalithic wall. Each course is its own height and each block its own length,
  // with a half-block offset between courses so the vertical joints never line up -- which
  // is the single thing that separates masonry from a grid of boxes.
  const buildWall = (cx, cz, along, len) => {
    let y = 1.2;
    let course = 0;
    while (y < 1.2 + height - 0.2) {
      const ch = Math.min(randomIn(rng, 1.5, 2.6), 1.2 + height - y);
      let s = -len / 2;
      const offset = course % 2 ? 0.5 : 0;
      let first = true;
      while (s < len / 2 - 0.1) {
        let bl = randomIn(rng, 2.6, 5.2);
        if (first && offset) bl *= 0.55;
        first = false;
        bl = Math.min(bl, len / 2 - s);
        const mid = s + bl / 2;
        const tone = [ROCK.granite, ROCK.graniteDark, ROCK.granitePink][Math.floor(rng() * 3)];
        // A hair under full size, so each block keeps a visible joint rather than fusing
        // into its neighbour. The joints are the whole exhibit.
        put(parts, extrudeOutline(
          roundedOutline((bl * 0.985) / 2, (ch * 0.97) / 2, Math.min(bl, ch) * 0.05, 1), wall,
        ), tone,
        along === 'x' ? [cx + mid, y + ch / 2, cz] : [cx, y + ch / 2, cz + mid],
        along === 'x' ? [0, 0, 0] : [0, Math.PI / 2, 0]);
        s += bl;
      }
      y += ch;
      course++;
    }
  };
  buildWall(0, -depth / 2 + wall / 2, 'x', width);
  buildWall(-width / 2 + wall / 2, 0, 'z', depth);
  buildWall(width / 2 - wall / 2, 0, 'z', depth);

  // Square granite piers across the front, with a lintel over them. Square, not round:
  // Egyptian temple piers of this period are monolithic square posts, and a fluted column
  // here would be Greek. Each is ONE stone, so it is one solid with a chamfered arris.
  const bays = 5;
  const pierW = 2.4;
  for (let i = 0; i < bays; i++) {
    const x = -width / 2 + wall + (i + 0.5) * ((width - wall * 2) / bays);
    put(parts, extrudeOutline(roundedOutline(pierW / 2, pierW / 2, pierW * 0.07, 1), height - 1.6),
      i % 2 ? ROCK.granite : ROCK.granitePink,
      [x, 1.2 + (height - 1.6) / 2, depth / 2 - pierW / 2 - 0.4], [Math.PI / 2, 0, 0]);
  }
  // The architrave, as three separate lintel stones rather than one beam -- a 28ft lintel
  // does not exist and the joints between them are visible on the real building.
  for (let i = 0; i < 3; i++) {
    const seg = width / 3;
    put(parts, extrudeOutline(roundedOutline((seg * 0.99) / 2, 0.8, 0.1, 1), pierW * 1.5),
      i % 2 ? ROCK.graniteDark : ROCK.granite,
      [-width / 2 + (i + 0.5) * seg, 1.2 + height - 0.8, depth / 2 - pierW / 2 - 0.4]);
  }

  // Roof slabs, laid as separate beams with gaps -- the temple was roofed in slabs and the
  // gaps between them are what lit the interior. NOT shadow-casting, for the same reason
  // the museum's skylight is not: three.js has no light transmission, so the ONLY thing
  // deciding whether sun reaches the floor is whether something above it casts a shadow.
  const slabs = 6;
  const roof = [];
  for (let i = 0; i < slabs; i++) {
    const z = -depth / 2 + (i + 0.5) * (depth / slabs);
    put(roof, extrudeOutline(roundedOutline(width / 2, 0.55, 0.12, 1), (depth / slabs) * 0.72),
      i % 2 ? ROCK.graniteDark : 0x8d7268, [0, 1.2 + height + 0.55, z]);
  }

  // The alabaster floor, which is the other famous thing about this building: the paving is
  // translucent white calcite against near-black granite walls, and that contrast is the
  // entire interior.
  put(parts, extrudeOutline(roundedOutline(width / 2 - wall, depth / 2 - wall, 0.5, 1), 0.3),
    ROCK.alabaster, [0, 1.35, 0], [Math.PI / 2, 0, 0]);

  const body = mesh(
    weather(mergeParts(parts), { amount: 0.12, scale: 0.14, wash: 0.28, low: 0, fade: height, seed: seed + 2 }),
    standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed: seed + 2, repeat: 9, strength: 0.45 }) }),
  );
  const roofMesh = mesh(mergeParts(roof), standard({ vertexColors: true, roughness: 0.9 }));
  roofMesh.castShadow = false;
  return group(body, roofMesh);
}

// ---------------------------------------------------------------------------
// Obelisk, stela, mastaba
// ---------------------------------------------------------------------------

// A monolithic granite obelisk with a pyramidion cap. Real ones are 10:1 tall to wide and
// were capped in electrum to catch the first sun -- so the cap is a separate, much
// brighter, low-roughness material rather than part of the merge.
//
// THE CARVING IS THE OBJECT. The old obelisk was a four-sided CylinderGeometry with a
// hieroglyph photograph wrapped round it -- 36 triangles for the most heavily carved thing
// in Egypt, and at any distance a smooth prism with a pattern on it reads as a painted
// post. This one is a lofted shaft whose surface carries real SUNK RELIEF: the glyph
// columns are cut INTO the face, so the sun rakes across them and the monument is legible
// as carving rather than as decoration.
export function obelisk({ height = 22, seed = 21, painted = true } = {}) {
  const width = height / 10;
  const shaftH = height * 0.9;
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);

  // Base: two stepped blocks, because an obelisk stands on a plinth and a shaft rising
  // straight out of the sand has nothing to give it scale.
  put(parts, extrudeOutline(roundedOutline(width * 1.25, width * 1.25, width * 0.08, 1), 0.55),
    ROCK.graniteDark, [0, 0.28, 0], [Math.PI / 2, 0, 0]);
  put(parts, extrudeOutline(roundedOutline(width * 1.05, width * 1.05, width * 0.06, 1), 0.5),
    ROCK.granite, [0, 0.8, 0], [Math.PI / 2, 0, 0]);

  // The shaft: a slightly tapering square section with softened arrises, carved on all four
  // faces. `round` near 0.16 is a square with a filleted corner, which is what a dressed
  // granite monolith actually is -- a true sharp edge does not survive in granite either.
  const shaft = solidLoft([
    { d: 1.05, w: width * 0.52, h: width * 0.52, round: 0.15 },
    { d: 1.05 + shaftH * 0.5, w: width * 0.46, h: width * 0.46, round: 0.14 },
    { d: 1.05 + shaftH, w: width * 0.37, h: width * 0.37, round: 0.13 },
  ], {
    axis: 'y',
    sides: 64,
    samples: 72,
    warp: sunkRelief({ columns: 1, registers: 16, depth: width * 0.05, seed }),
  });
  put(parts, shaft, ROCK.granite);

  const shaftMesh = mesh(
    tintGeometry(mergeParts(parts), (p, c) => {
      // Granite's speckle, plus the paint that survives in the CUTS. The relief is sunk, so
      // anything below the nominal surface is sheltered -- which is exactly where real
      // pigment is still found. Recovering "am I in a cut" from the radius is what makes
      // this possible without a second UV set.
      const r = Math.hypot(p.x, p.z);
      const expect = width * (0.52 - (p.y - 1.05) / Math.max(1, shaftH) * 0.15) * 0.86;
      const sunk = THREE.MathUtils.clamp((expect - r) / (width * 0.05), 0, 1);
      const speck = smoothNoise3(p.x * 22, p.y * 22, p.z * 22);
      const k = 0.9 + speck * 0.24;
      if (!painted || sunk < 0.35) return [c.r * k, c.g * k, c.b * k];
      // Ochre and Egyptian blue alternating up the shaft, as the registers would have been.
      const band = Math.floor((p.y - 1.05) / (shaftH / 16));
      const pig = new THREE.Color(band % 2 ? PIGMENT.yellow : PIGMENT.blue);
      const mix = sunk * 0.72;
      return [
        c.r * k * (1 - mix) + pig.r * mix,
        c.g * k * (1 - mix) + pig.g * mix,
        c.b * k * (1 - mix) + pig.b * mix,
      ];
    }),
    standard({ vertexColors: true, roughness: 0.84, ...relief('stone', { seed: seed + 4, repeat: 8, strength: 0.3 }) }),
  );
  g.add(shaftMesh);

  // The pyramidion, sheathed in electrum to catch the first light of the sun -- which is
  // what an obelisk is FOR. Its own material: bright, low roughness, slightly emissive.
  const capBase = width * 0.37 * 1.5;
  const cap = new THREE.CylinderGeometry(0, capBase, height * 0.1, 4);
  cap.rotateY(Math.PI / 4);
  g.add(mesh(cap, standard({
    color: 0xf2dfa8, roughness: 0.24, metalness: 0.7, emissive: 0x5a4718, emissiveIntensity: 0.35,
  }), 0, 1.05 + shaftH + height * 0.05, 0));
  void rng;
  return g;
}

// A free-standing inscribed slab. The Dream Stela stands between the Sphinx's paws and this
// is that object: a round-topped granite slab covered in text.
//
// Carved, not printed: the round-topped face carries a real recessed panel with sunk
// registers, and the lunette at the top holds the winged sun disc that nearly every stela
// of this kind has.
export function stela({ width = 5, height = 9, seed = 31, text = true } = {}) {
  const g = group();
  const parts = [];
  const thick = 0.9;

  // The slab: a round-topped outline extruded, so the head is part of the same stone rather
  // than a disc buried in a box.
  const outline = [];
  outline.push([-width / 2, 0], [width / 2, 0], [width / 2, height * 0.72]);
  for (let i = 1; i < 14; i++) {
    const a = (i / 14) * Math.PI;
    outline.push([Math.cos(a) * width / 2, height * 0.72 + Math.sin(a) * width / 2]);
  }
  outline.push([-width / 2, height * 0.72]);
  put(parts, extrudeOutline(outline, thick), ROCK.granite);

  // The sunk panel: the whole inscribed field is cut a few inches INTO the face, with a
  // raised border round it. That border is what makes a stela read as an inscribed monument
  // rather than as a gravestone.
  put(parts, extrudeOutline(
    roundedOutline(width * 0.40, height * 0.30, width * 0.05, 2), 0.12,
  ), ROCK.graniteDark, [0, height * 0.36, thick / 2 - 0.05]);
  // Register lines across the field.
  for (let i = 1; i < 7; i++) {
    put(parts, new THREE.BoxGeometry(width * 0.80, 0.05, 0.16),
      ROCK.graniteDark, [0, height * 0.08 + i * height * 0.08, thick / 2 - 0.02]);
  }

  const base = mesh(
    weather(mergeParts(parts), { amount: 0.1, scale: 0.3, wash: 0.3, low: 0, fade: height * 0.6, seed }),
    standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed: seed + 6, repeat: 5, strength: 0.35 }) }),
  );
  g.add(base);

  // The inscribed face, as a texture on a panel set just proud of the sunk field. A canvas
  // is the right tool for TEXT -- carving every glyph as geometry would be tens of thousands
  // of triangles for something read from six feet away.
  if (text) {
    const face = mesh(
      new THREE.PlaneGeometry(width * 0.78, height * 0.56),
      standard({
        map: hieroglyphTexture({ seed, columns: 5, cartouche: true, paint: true }),
        roughness: 0.92,
      }),
      0, height * 0.36, thick / 2 + 0.02,
    );
    g.add(face);
  }

  // A plinth.
  const plinth = mesh(
    extrudeOutline(roundedOutline(width * 0.72, 1.2, 0.2, 1), 2.2),
    standard({ color: ROCK.graniteDark, roughness: 0.95, ...relief('stone', { seed: seed + 9, repeat: 3 }) }),
    0, 0.05, 0,
  );
  plinth.rotation.x = Math.PI / 2;
  g.add(plinth);
  return g;
}

// A mastaba -- the flat-topped, batter-sided mudbrick tomb that predates the pyramids and
// still surrounds them in fields. Cheap, and they are what fills the plateau between
// monuments so it does not read as three objects on an empty plain.
export function mastaba({ width = 14, depth = 9, height = 5, seed = 41 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // ONE battered solid, not four stacked boxes. The batter -- walls sloping inward -- is
  // the defining profile of the type, and as a loft it is a smooth rake rather than a
  // staircase.
  const body = solidLoft([
    { d: 0, w: width / 2, h: depth / 2, round: 0.10 },
    { d: height * 0.55, w: (width / 2) * 0.92, h: (depth / 2) * 0.92, round: 0.11 },
    { d: height, w: (width / 2) * 0.84, h: (depth / 2) * 0.84, round: 0.13 },
  ], {
    axis: 'y',
    sides: 34,
    samples: 22,
    // Mudbrick courses, as shallow grooves. A mastaba's face is horizontally banded and it
    // is the one thing that gives a plain sloping box its scale.
    warp: (t, u, s) => grooveAt(Math.sin(t * height * 3.4 * Math.PI), 0.28, Math.min(width, depth) * 0.010),
  });
  put(parts, body, ROCK.mudbrick);

  // The FALSE DOOR on the long face -- the whole point of a mastaba: the place the dead
  // person's spirit came and went, and where offerings were left. It is a recessed panel
  // with a series of stepped jambs, not one dark slot.
  {
    const dw = width * 0.16;
    const dh = height * 0.55;
    for (let j = 0; j < 3; j++) {
      const k = 1 - j * 0.26;
      put(parts, new THREE.BoxGeometry(dw * k, dh * k, 0.5 - j * 0.12),
        [ROCK.mudbrick, 0x8a6a48, 0x3a2e1f][j],
        [-width * 0.22, dh * k / 2 + height * 0.04, depth * (0.47 - j * 0.02)]);
    }
    // The lintel and drum roll over it.
    put(parts, new THREE.BoxGeometry(dw * 1.25, height * 0.07, 0.55),
      ROCK.core, [-width * 0.22, dh + height * 0.08, depth * 0.47]);
  }

  // Sand drifted against the base, which is how every one of these actually looks -- and
  // it hides the joint between the batter and the ground, which is the least convincing
  // part of any object standing on a hill.
  for (let i = 0; i < 12; i++) {
    const drift = roughenSphere(new THREE.IcosahedronGeometry(randomIn(rng, 1.3, 2.8), 2), { amount: 0.18, flatten: 0.2 });
    drift.scale(1.7, 0.34, 1);
    put(parts, drift, i % 2 ? ROCK.sand : ROCK.sandDark,
      [randomIn(rng, -width * 0.62, width * 0.62), 0.2, (rng() > 0.5 ? 1 : -1) * depth * randomIn(rng, 0.45, 0.62)],
      [0, randomIn(rng, -0.4, 0.4), 0]);
  }

  return group(mesh(
    weather(mergeParts(parts), { amount: 0.14, scale: 0.22, wash: 0.24, low: 0, fade: height, seed: seed + 3, warm: 0.4 }),
    standard({ vertexColors: true, roughness: 0.98, ...relief('soil', { seed: seed + 3, repeat: 7, strength: 0.6 }) }),
  ));
}

// ---------------------------------------------------------------------------
// Landscape
// ---------------------------------------------------------------------------

// A date palm: bare ringed trunk, no branches, and a crown of pinnate fronds that arch over
// and hang. The rings are the leaf scars, and they are what makes a palm trunk a palm trunk
// rather than a pole.
//
// THE REBUILD gives it real PINNATE fronds. A date palm's leaf is not a blade -- it is a
// midrib carrying a hundred stiff leaflets in two ranks, and that texture is the whole
// character of the tree. The old fronds were flattened tubes: at 5,940 triangles each and
// planted fifteen times they were the single largest cost in this world while reading as
// green paddles. These carry their leaflets as one merged surface per frond and cost about
// twice as much for something that actually looks like a palm.
//
// The leaf scars are GROOVES in the trunk's own surface rather than 15 torus rings laid on
// it -- the same rule as everything else here.
export function datePalm({ height = 26, seed = 7, dates = true } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkH = height * 0.68;
  const lean = randomIn(rng, -0.09, 0.09);

  // Trunk, curved: a palm almost never grows straight.
  const bend = (t) => [Math.sin(t * 1.6) * lean * trunkH, Math.cos(t * 2.1) * lean * trunkH * 0.6];
  const trunkStations = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const [bx, bz] = bend(t);
    trunkStations.push({
      d: t * trunkH,
      w: 1.15 - t * 0.42,
      h: 1.15 - t * 0.42,
      a: bx,
      b: bz,
      round: 0.94,
    });
  }
  put(parts, solidLoft(trunkStations, {
    axis: 'y',
    sides: 20,
    samples: 46,
    // LEAF SCARS as grooves. A date palm's trunk is a spiral of old frond bases, so the
    // scars are not level rings -- they wind. 15 scars over 46 samples is 3 per cycle,
    // under Nyquist, so the spacing is set against the sample count: 11 turns at 46 samples
    // is 4 per cycle, which with a narrow Gaussian still resolves.
    warp: (t, u, s) => {
      const spiral = Math.sin((t * 11 + u * 0.6) * Math.PI * 2);
      return grooveAt(spiral, 0.3, s.w * 0.11);
    },
  }), PALM.trunk);

  const [topX, topZ] = bend(1);

  // Old frond bases still attached below the crown -- the shaggy collar every date palm
  // has, and the thing that makes the top of the trunk read as alive.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng();
    const t = 0.82 + (i % 4) * 0.04;
    const [bx, bz] = bend(t);
    put(parts, extrudeOutline(roundedOutline(0.28, 0.16, 0.06, 1), 0.7), PALM.trunkDark,
      [bx + Math.cos(a) * 0.8, t * trunkH, bz + Math.sin(a) * 0.8], [0.5, -a, 0]);
  }

  // Crown. Each frond is a midrib plus two ranks of leaflets, built as ONE solid surface so
  // it has real thickness and a closed rim -- a flattened tube reads as a paddle and a
  // zero-thickness plane vanishes edge-on.
  const fronds = 17;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.2;
    const len = randomIn(rng, 7.0, 10.0);
    const droop = randomIn(rng, 0.5, 1.1);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // The midrib's own curve: up and out, then over and down.
    const rib = (v) => [
      ca * len * v,
      len * (0.34 * Math.sin(v * 1.5)) - droop * 2.6 * v * v * v,
      sa * len * v,
    ];
    put(parts, tube(
      [rib(0), rib(0.35), rib(0.7), rib(1)],
      [0.24, 0.17, 0.11, 0.05],
      { sides: 6 },
    ), PALM.trunkDark, [topX, trunkH, topZ]);

    // The leaflets, as one closed surface each side of the rib. `u` runs along the frond and
    // `v` across a leaflet, and the leaflet length is a lobed function of u so the surface
    // reads as separate blades rather than as a continuous ribbon.
    const tone = [PALM.frond, PALM.frondDark, PALM.frondPale][i % 3];
    for (const rank of [-1, 1]) {
      const blade = solidSurface({
        nu: 26,
        nv: 3,
        point: (u, v) => {
          const p = rib(0.08 + u * 0.92);
          // Leaflet length peaks in the middle of the frond and shortens at both ends.
          const grow = Math.sin(Math.min(1, u * 1.12) * Math.PI) * 0.86 + 0.14;
          const lobe = 0.62 + 0.38 * Math.abs(Math.sin(u * Math.PI * 13));
          const spanLen = len * 0.20 * grow * lobe;
          // Leaflets stand out and DOWN, at a steeper angle near the tip.
          const drop = -spanLen * v * (0.35 + u * 0.5);
          return [
            p[0] + (-sa * rank) * spanLen * v,
            p[1] + drop,
            p[2] + (ca * rank) * spanLen * v,
          ];
        },
        thick: (u, v) => 0.035 * (1 - v * 0.8) * Math.sin(Math.min(1, u * 1.12) * Math.PI + 0.2),
      });
      put(parts, blade, tone, [topX, trunkH, topZ]);
    }
  }

  // Date clusters, hanging under the crown on a real stalk.
  if (dates) {
    for (let c = 0; c < 3; c++) {
      const a = (c / 3) * Math.PI * 2 + 0.7;
      const bx = topX + Math.cos(a) * 1.5;
      const bz = topZ + Math.sin(a) * 1.5;
      put(parts, tube([
        [topX + Math.cos(a) * 0.5, trunkH, topZ + Math.sin(a) * 0.5],
        [bx, trunkH - 0.6, bz],
        [bx + Math.cos(a) * 0.5, trunkH - 1.8, bz + Math.sin(a) * 0.5],
      ], [0.13, 0.1, 0.07], { sides: 6 }), PALM.trunkDark);
      for (let d = 0; d < 26; d++) {
        const t = d / 26;
        put(parts, ball(0.17, 6), t > 0.5 ? PALM.date : PALM.dateDark, [
          bx + Math.cos(a) * (0.2 + t * 0.7) + Math.cos(d * 2.4) * 0.34,
          trunkH - 0.7 - t * 1.5,
          bz + Math.sin(a) * (0.2 + t * 0.7) + Math.sin(d * 2.4) * 0.34,
        ]);
      }
    }
  }

  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.92, ...relief('bark', { seed: seed + 4, repeat: 6, strength: 0.5 }) }),
  ));
}

// Wind-blown sand: low drifts. Flattened hard, because a dune as tall as it is wide is a
// hill, and the desert's character is that it is almost flat.
//
// Two things the first pass got wrong, and both generalise to any low ground feature:
//
//  * DETAIL 2 IS NOT ENOUGH ONCE A SHAPE IS SQUASHED. Flattening to 20% multiplies the
//    apparent angle between neighbouring facets by five, so an icosahedron that looks
//    rounded standing up reads as a heap of broken glass lying down.
//  * A DRIFT HAS TO BE WIDER THAN IT IS LONG AND OVERLAP ITS NEIGHBOURS. Five separate
//    blobs scattered inside a radius are five objects; a drift is one continuous surface.
//
// The rebuild adds the third: SMOOTHING. `computeVertexNormals` on a non-indexed geometry
// can only produce FACE normals, and everything from PolyhedronGeometry is non-indexed --
// so every drift here was flat-shaded whatever the material said, and subdividing only made
// the facets smaller. Welding first is the whole fix.
export function sandDrift({ size = 14, seed = 13, color = ROCK.sand } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const r = size * randomIn(rng, 0.34, 0.58);
    const geo = smoothed(
      roughenSphere(new THREE.IcosahedronGeometry(r, 3), { amount: 0.13, flatten: 0.17, phase: i * 1.7 }),
      1e-3,
    );
    // Stretched across X: wind-formed sand is drawn out into long low ridges, never round.
    geo.scale(1.5, 1, 0.75);
    put(parts, geo, i % 2 ? color : ROCK.sandDark, [
      randomIn(rng, -size * 0.3, size * 0.3), r * 0.02, randomIn(rng, -size * 0.22, size * 0.22),
    ]);
  }
  const geo = mergeParts(parts);
  // Wind ripples, as colour. Real desert sand is corrugated at about a foot's spacing and
  // as geometry that would be thousands of solids per drift.
  tintGeometry(geo, (p, c) => {
    const ripple = 0.94 + Math.sin(p.x * 2.6 + smoothNoise3(p.x * 0.2, 0, p.z * 0.2) * 6) * 0.06;
    return [c.r * ripple, c.g * ripple, c.b * ripple];
  });
  return group(mesh(geo, standard({
    vertexColors: true, roughness: 1, ...relief('soil', { seed: seed + 7, repeat: 8, strength: 0.7 }),
  })));
}

// Khufu's solar barque -- a real 143ft cedar ship found sealed in a pit beside the Great
// Pyramid in 1954, in 1,224 pieces, and reassembled. It is the oldest intact large ship in
// the world, and it is here because it is the single most surprising object at Giza.
//
// The hull shape is the lesson: PAPYRIFORM, meaning a wooden ship built to look like a
// bundle of reeds, with both ends sweeping high out of the water into papyrus-flower
// finials. It has no keel and it is held together with rope, not nails.
//
// So the hull is a loft whose section changes from a deep narrow V amidships to a flat
// crescent at the ends, and the ROPE is the thing the model has to show: this ship is
// literally sewn together, and the lashings are cut as grooves in its own planking.
export function solarBarque({ length = 28, seed = 27 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const cedar = 0xb98d5a;
  const cedarDark = 0x8d6a41;
  const cedarPale = 0xd4ab77;

  const halfL = length / 2;
  const beam = length * 0.13;

  // The hull. `b` is the sheer, sweeping high at both ends -- that upturn is the whole
  // silhouette of an Egyptian ship. The section is a deep narrow V amidships (no keel, so
  // the bottom is rounded) flattening toward the ends.
  const stations = [
    { d: -halfL, w: beam * 0.06, up: beam * 0.10, dn: beam * 0.04, round: 1.6, b: length * 0.135 },
    { d: -halfL * 0.86, w: beam * 0.26, up: beam * 0.24, dn: beam * 0.18, round: 1.2, b: length * 0.082 },
    { d: -halfL * 0.62, w: beam * 0.52, up: beam * 0.34, dn: beam * 0.34, round: 0.9, b: length * 0.042 },
    { d: -halfL * 0.28, w: beam * 0.62, up: beam * 0.36, dn: beam * 0.44, round: 0.78, b: length * 0.022 },
    { d: 0, w: beam * 0.64, up: beam * 0.36, dn: beam * 0.46, round: 0.76, b: length * 0.018 },
    { d: halfL * 0.28, w: beam * 0.62, up: beam * 0.36, dn: beam * 0.44, round: 0.78, b: length * 0.022 },
    { d: halfL * 0.62, w: beam * 0.52, up: beam * 0.34, dn: beam * 0.34, round: 0.9, b: length * 0.042 },
    { d: halfL * 0.86, w: beam * 0.26, up: beam * 0.24, dn: beam * 0.18, round: 1.2, b: length * 0.082 },
    { d: halfL, w: beam * 0.06, up: beam * 0.10, dn: beam * 0.04, round: 1.6, b: length * 0.135 },
  ];
  const hull = solidLoft(stations, {
    sides: 30,
    samples: 64,
    // The planking, and the LASHINGS. Khufu's ship is sewn: the planks are tied edge to
    // edge with halfa-grass rope through V-shaped channels, and there is not a nail in it.
    // Long grooves along the hull are the plank seams; the short cross-cuts are the ties.
    warp: (t, u, s) => {
      const up = Math.sin(u * Math.PI * 2);
      const localY = up * (up >= 0 ? s.up : s.dn);
      const seam = grooveAt(Math.sin(localY / (beam * 0.16) * Math.PI * 2), 0.3, beam * 0.02);
      const tie = grooveAt(Math.sin(t * 34 * Math.PI), 0.16, beam * 0.014);
      return seam + tie;
    },
  });
  put(parts, hull, cedar);
  const sample = loftSampler(stations);

  // Papyrus-flower finials at bow and stern -- the detail that makes it Egyptian. A real
  // umbel: a bundle of stems opening into a bell.
  for (const end of [-1, 1]) {
    put(parts, tube([
      [0, length * 0.135, end * halfL],
      [0, length * 0.20, end * halfL * 1.04],
      [0, length * 0.26, end * halfL * 0.99],
    ], [beam * 0.09, beam * 0.07, beam * 0.055], { sides: 8 }), cedarDark);
    // The bell, as a lathe with a real lip so it is a flower and not a funnel.
    put(parts, revolve([
      [beam * 0.05, 0], [beam * 0.10, length * 0.014], [beam * 0.22, length * 0.036],
      [beam * 0.30, length * 0.052], [beam * 0.26, length * 0.056], [beam * 0.14, length * 0.040],
    ], { segments: 14 }), cedarPale, [0, length * 0.262, end * halfL * 0.985]);
  }

  // Deck planking, clipped to the hull's own beam at each station -- the same rule the
  // steamship's deck needed.
  for (let i = 0; i < 9; i++) {
    const frac = (i + 0.5) / 9 - 0.5;
    let z0 = -length * 0.36;
    let z1 = length * 0.36;
    const ok = (z) => sample.at(sample.tAtD(z)).w * 0.94 >= Math.abs(frac) * beam * 1.15 + beam * 0.04;
    while (z0 < z1 && !ok(z0)) z0 += 0.3;
    while (z1 > z0 && !ok(z1)) z1 -= 0.3;
    if (z1 - z0 < 1) continue;
    put(parts, new THREE.BoxGeometry(beam * 1.15 / 9 * 0.9, 0.1, z1 - z0),
      i % 2 ? cedar : cedarPale, [frac * beam * 1.15, length * 0.052, (z0 + z1) / 2]);
  }

  // Deckhouse -- the cabin amidships, with a canopy over it on slim posts. It is a REED
  // structure: a light frame with matting stretched over it, so the roof curves.
  put(parts, extrudeOutline(roundedOutline(beam * 0.42, length * 0.038, beam * 0.06, 2), length * 0.24),
    cedarPale, [0, length * 0.090, -length * 0.02]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(parts, tube([
        [sx * beam * 0.5, length * 0.10, -length * 0.02 + sz * length * 0.13],
        [sx * beam * 0.5, length * 0.20, -length * 0.02 + sz * length * 0.13],
      ], [0.06, 0.05], { sides: 6 }), cedarDark);
    }
  }
  // The canopy: a shallow curved mat, swept so it sags between its posts the way matting
  // actually does.
  put(parts, sweepProfile(
    [[0, length * 0.212, -length * 0.18], [0, length * 0.204, -length * 0.02], [0, length * 0.212, length * 0.14]],
    [[-beam * 0.6, 0], [beam * 0.6, 0], [beam * 0.6, 0.06], [-beam * 0.6, 0.06]],
    { samples: 8, up: new THREE.Vector3(0, 1, 0) },
  ), 0xe6d8b8);

  // Steering oars at the stern -- two huge blades on posts, which is how a ship with no
  // rudder is steered. The blade is a real foil, not a box.
  for (const side of [-1, 1]) {
    put(parts, tube([
      [side * beam * 0.55, length * 0.11, -halfL * 0.66],
      [side * beam * 0.78, length * 0.03, -halfL * 0.82],
      [side * beam * 0.92, -length * 0.03, -halfL * 0.94],
    ], [0.11, 0.1, 0.09], { sides: 8 }), cedarDark);
    put(parts, solidSurface({
      nu: 6,
      nv: 4,
      point: (u, v) => [
        side * beam * (0.90 + v * 0.06),
        -length * (0.015 + u * 0.075),
        -halfL * (0.90 + (v - 0.5) * 0.12) - length * u * 0.02,
      ],
      thick: (u, v) => length * 0.004 * Math.sin(Math.PI * v) * (1 - u * 0.5),
    }), cedar);
  }

  // Twelve oars along the sides, shipped and resting on the gunwale, each with a real blade.
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const z = -length * 0.2 + i * length * 0.075;
      put(parts, tube([
        [side * beam * 0.30, length * 0.078, z - length * 0.13],
        [side * beam * 0.62, length * 0.075, z],
        [side * beam * 0.86, length * 0.070, z + length * 0.13],
      ], [0.05, 0.055, 0.05], { sides: 6 }), cedarDark);
      put(parts, solidSurface({
        nu: 5,
        nv: 3,
        point: (u, v) => [
          side * beam * (0.88 + u * 0.16),
          length * 0.070,
          z + length * (0.13 + u * 0.09) + (v - 0.5) * length * 0.026,
        ],
        thick: (u, v) => length * 0.0022 * Math.sin(Math.PI * v) * Math.sin(Math.PI * Math.min(1, u * 1.3)),
      }), cedarPale);
    }
  }

  const geo = mergeParts(parts);
  tintGeometry(geo, (p, c) => {
    // Cedar's grain runs along the hull, and the ship is 4,600 years old: the wood is dry,
    // silvered on its exposed upper surfaces and darker down in the bilges.
    const grain = 0.93 + smoothNoise3(p.z * 1.4, p.y * 5.0, p.x * 5.0) * 0.14;
    const sun = THREE.MathUtils.clamp(p.y / (length * 0.2), 0, 1);
    const k = grain * (0.94 + sun * 0.12);
    return [c.r * k, c.g * k * (1 - sun * 0.02), c.b * k * (1 - sun * 0.05)];
  });
  void rng;
  return group(mesh(geo, standard({
    vertexColors: true, roughness: 0.88, ...relief('wood', { seed: seed + 2, repeat: 10, strength: 0.35 }),
  })));
}

// A cartouche-shaped name plaque on two posts. Used as this world's wayfinding, in place of
// the generic standing sign, because a cartouche IS a nameplate and using the real device
// to label a real monument is a better lesson than a caption.
export function cartouchePlaque({ label = 'GIZA', sub = '', seed = 51 } = {}) {
  const g = group();
  const w = 8;
  const h = 3.4;

  const texture = canvasTexture(1024, 448, (ctx, cw, ch) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#d8c8a2';
    ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(${150 + rng() * 50 | 0},${125 + rng() * 40 | 0},${88 + rng() * 30 | 0},${0.03 + rng() * 0.06})`;
      ctx.beginPath(); ctx.arc(randomIn(rng, 0, cw), randomIn(rng, 0, ch), randomIn(rng, 12, 70), 0, Math.PI * 2); ctx.fill();
    }
    // The cartouche outline: a stadium, not an ellipse -- straight sides, round ends.
    const pad = 40;
    const r = (ch - pad * 2) / 2;
    const ring = (lw, style) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pad + r, pad);
      ctx.lineTo(cw - pad - r, pad);
      ctx.arc(cw - pad - r, pad + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(pad + r, ch - pad);
      ctx.arc(pad + r, pad + r, r, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.stroke();
    };
    // Painted in Egyptian blue with a gold inner line -- a royal cartouche was gilded.
    ring(14, hex(PIGMENT.blue));
    ring(5, hex(PIGMENT.gold));
    // The tie-bar at the end, which is what makes it a cartouche rather than an oval.
    ctx.strokeStyle = hex(PIGMENT.blue);
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(pad - 6, ch * 0.32);
    ctx.lineTo(pad - 6, ch * 0.68);
    ctx.stroke();

    ctx.fillStyle = '#4a3018';
    ctx.textAlign = 'center';
    // Fit the label rather than trusting it: a long king's name at a fixed size runs off
    // both ends of the oval and is clipped mid-word.
    const inner = cw - pad * 2 - r * 2 - 40;
    let size = sub ? 96 : 118;
    for (let i = 0; i < 20; i++) {
      ctx.font = `bold ${size}px Georgia, serif`;
      if (ctx.measureText(label).width <= inner) break;
      size *= 0.94;
    }
    ctx.fillText(label, cw / 2, sub ? ch * 0.5 : ch * 0.6);
    if (sub) {
      let ss = 40;
      for (let i = 0; i < 20; i++) {
        ctx.font = `${ss}px Georgia, serif`;
        if (ctx.measureText(sub).width <= inner) break;
        ss *= 0.94;
      }
      ctx.fillStyle = '#6b4a2c';
      ctx.fillText(sub, cw / 2, ch * 0.7);
    }
  });

  const post = standard({ color: ROCK.granite, roughness: 0.95, ...relief('stone', { seed, repeat: 2 }) });
  for (const side of [-1, 1]) g.add(cyl(0.28, 0.34, 4.4, post, side * (w / 2 - 0.5), 2.2, 0, 10));
  // A moulded stone frame round the panel, so the sign is a carved tablet and not a poster.
  const frame = mesh(
    mouldedRing([[0, -h / 2 - 0.3], [0.3, -h / 2 - 0.2], [0.34, h / 2 + 0.2], [0, h / 2 + 0.3]], w / 2 + 0.3, 0.16),
    standard({ color: ROCK.granitePink, roughness: 0.92, ...relief('stone', { seed: seed + 2, repeat: 3 }) }),
    0, 4.4, 0,
  );
  g.add(frame);
  const panel = signPanel(w, h, texture);
  panel.position.set(0, 4.4, 0.2);
  g.add(panel);
  return g;
}
