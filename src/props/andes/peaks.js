import * as THREE from 'three';
import { standard, mesh, group, mergedMesh, relief, canvasTexture, seededRandom, randomIn } from '../../PropKit.js';
import { smoothNoise3 } from '../LoftKit.js';

// Machu Picchu's horizon: Huayna Picchu and the two ridge peaks behind it.
//
// These are the HERO of this world and the only thing in it that is never approached.
// Every one of them is read from 170-300ft away (the student stands at z=128, the peaks
// sit at z=-168, x=152 and x=-168), which decides the entire budget: what survives that
// distance is SILHOUETTE, the pattern of light and shade a spur field throws, and COLOUR.
// Surface grain does not -- a bump tile's cell is well under a pixel out there.
//
// So the triangles go into one thing: a real height field with spurs, gullies, cliff
// bands and a talus apron, sampled finely enough that a ridge is a ridge. The previous
// build was a 16 x 26 lathe with two sine terms going ROUND the mountain rather than DOWN
// it, and it read as a smooth spoil heap, which is what a surface of revolution always
// reads as. Note also that the world's fog runs 70/520, so a peak at 300ft arrives about
// half-way faded into a pale blue sky: every contrast here has to be pitched to survive
// being halved, which is why the palette below is as wide as it is.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Andean granite is NOT grey. It is warm buff and pink-grey on a fresh face, dark
// grey-green where lichen has taken a ledge, near-black in a gully that never dries, and
// rust-and-ochre where iron has run down a cliff. A near-monochrome mountain is most of
// what made the old one read as a spoil heap; halved by fog, a single grey is a smudge.
// CALIBRATED AGAINST THE RENDER, not picked on a colour wheel. The first pass authored
// this rock from 0xa89a84 up to 0xc0b6a6 -- perfectly reasonable granite values in a
// swatch, and under this world's 2.75 sun plus a 1.5 hemisphere they CLIP: the hero peak
// rendered as a white chalk spike, with the fog washing what contrast survived toward sky
// blue. Same trap VolcanoProps hit with marble, and the exact inverse of the one Ellis
// Island hit painting a black hull under a bright sky.
const PK_BUFF = 0x6b6355;
const PK_PINK = 0x6e5f57;
const PK_PALE = 0x8a8275; // a fresh, sun-facing vertical face
const PK_LICHEN = 0x4e5546; // dark grey-green, and it only ever grows on a ledge
const PK_WET = 0x2b2e2b; // the bottom of a gully, permanently damp
const PK_RUST = 0x6d4a28;
const PK_TALUS = 0x7f7668;
const PK_TALUS_DARK = 0x5a5449;
// Cloud forest, which is a deep BLUE-green. A yellow-green here reads as a golf course
// pinned to a mountain.
const PK_FOREST = 0x2f4432;
const PK_FOREST_LIT = 0x44603f;
const PK_SNOW = 0xeaf0f4;

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

// A smooth 1-D noise that WRAPS at 2*PI, so anything built from it is periodic round the
// mountain by construction. Evenly-spaced spurs read as a fluted column -- this is what
// breaks the spacing without putting a seam down one bearing.
function pk_wrapNoise(seed, cells) {
  const rng = seededRandom(Math.round(seed) >>> 0);
  const v = new Float32Array(cells);
  for (let i = 0; i < cells; i++) v[i] = rng();
  return (a) => {
    const x = (a / (Math.PI * 2)) * cells;
    const i0 = Math.floor(x);
    const f = x - i0;
    const s = f * f * (3 - 2 * f);
    const p = ((i0 % cells) + cells) % cells;
    const q = (p + 1) % cells;
    return v[p] + (v[q] - v[p]) * s;
  };
}

// Ridged noise, k lobes per revolution. `1 - |cos|` puts a CUSP at every minimum and a
// smooth crown at every maximum, which is the right way round: a gully is a sharp V and a
// spur crest is rounded. |cos| is sign-blind, so this is 2*PI-periodic for any integer k.
function pk_ridge(a, k, phase) {
  return 1 - Math.abs(Math.cos(k * 0.5 * a + phase));
}

// A soft max, so the cliff foot meets the talus apron in a crisp break of slope rather
// than a hard crease that catches the light as a black line.
function pk_softMax(a, b, k) {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

const pk_clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const pk_smooth = (x, lo, hi) => {
  const t = pk_clamp((x - lo) / (hi - lo || 1), 0, 1);
  return t * t * (3 - 2 * t);
};

// The whole mountain as one closed-form field. Everything -- spurs, gullies, cliff bands,
// the talus apron, the summit terraces and the zig-zag path -- is a modulation of ONE
// radius function, and that is what makes "leave no open spaces" structural here: a
// displacement of a surface cannot open a gap in it. The first instinct is to lay the
// apron on as a separate cone and the terraces on as separate slabs, and both of those
// are the trap this project has recorded three times: a solid laid on a curved flank
// either floats clear of it or is buried inside it, and which one it does changes with
// the bearing.
function pk_field({ height, baseRadius, sugarloaf, seed, terraces, path, apronTop }) {
  // 0.17, and the profile exponent 1.55 rather than 2.1. At 2.1 the horn is 35% of its
  // base radius at half height and renders as a shark fin; a sugarloaf carries real
  // mass up to the shoulder and only then goes vertical.
  const SUMMIT = 0.17; // the blunt summit knob, as a fraction of baseRadius
  // The rock cone's own base is drawn IN, because the talus apron takes the last of the
  // footprint. Built out to the full baseRadius the apron has nowhere to go and the
  // mountain meets the ground on a hard edge, which is the one thing a real one never does.
  const ROCK_BASE = 0.74;

  const warp = pk_wrapNoise(seed * 7 + 101, 5); // spurs are not evenly spaced
  const bandPhase = pk_wrapNoise(seed * 13 + 211, 11); // nor are cliff bands level rings
  const bandSharp = pk_wrapNoise(seed * 17 + 307, 7); // and some bearings step harder than others
  // ...and on some bearings there is no band at all. Without this every band is a
  // continuous ring and the peak reads as a WEDDING CAKE -- which is what the first
  // render was, and no amount of phase wobble fixes it while every bearing steps.
  const bandAmp = pk_wrapNoise(seed * 19 + 401, 5);
  const fanNoise = pk_wrapNoise(seed * 23 + 409, 9); // the apron's top edge
  const stainN = pk_wrapNoise(seed * 29 + 503, 11);

  // Spur count. Nyquist governs the FINEST octave: at PK_RADIAL samples round the circle
  // the third octave (3 x K1) must still get its nine samples per lobe, which is what caps
  // K1 here. Raising the frequency past that does not give finer ridges, it gives aliasing.
  const K1 = sugarloaf ? 7 : 6;
  // Six bands over 132ft is one break of slope every 22ft, which is what granite of this
  // grain actually does. Twelve narrow ones looked like a wedding cake AND put each
  // transition inside two rows, which is under what the mesh can draw as a step.
  const BANDS = sugarloaf ? 6 : 5;

  const prof = (x) => {
    const xx = pk_clamp(x, 0, 1);
    // Concave for a horn, convex for a rounded ridge. The horn must NOT taper to a point
    // -- a pure (1-t)^2.1 is zero at the top and the last rings collapse into a needle you
    // could thread. It bottoms out at SUMMIT and only the top tenth is domed off.
    return sugarloaf
      ? SUMMIT + (1 - SUMMIT) * (1 - xx) ** 1.55
      : Math.cos((xx * Math.PI) / 2) ** 0.75;
  };
  const domeCap = (x) => (sugarloaf ? (x < 0.9 ? 1 : Math.sin(((1 - x) / 0.1) * (Math.PI / 2))) : 1);

  // The spur/gully field. Three ridged octaves on a warped bearing, whose amplitude GROWS
  // downslope: the summit of a horn is a smooth knob and the flanks are deeply incised,
  // and a constant amplitude gives the exact opposite reading -- a lumpy top on clean sides.
  // Octave 2 and 3 are gated by octave 1, which is what makes a spur BRANCH as it descends
  // instead of the whole mountain simply getting bumpier.
  const spurAt = (t, a) => {
    const aw = a + (warp(a) - 0.5) * ((Math.PI * 2) / K1) * 0.55;
    const o1 = pk_ridge(aw, K1, seed * 0.31);
    const o2 = pk_ridge(aw, K1 * 2, seed * 0.77 + 1.1);
    const o3 = pk_ridge(aw, K1 * 3, seed * 1.19 + 2.3);
    const branch = 0.35 + 0.65 * o1;
    const env1 = 0.14 + 0.86 * (1 - t) ** 1.4;
    const env2 = 0.05 + 0.95 * (1 - t) ** 2.1;
    return (
      0.130 * (o1 - 0.55) * env1
      + 0.075 * (o2 - 0.55) * env2 * branch
      + 0.040 * (o3 - 0.55) * env2 * branch
    );
  };

  return (t, a) => {
    const s = spurAt(t, a);

    // CLIFF BANDS. Granite fails in near-vertical faces separated by ledges; a slope that
    // is smooth the whole way down is a slag heap however it is coloured. The trick is to
    // quantise the height the PROFILE is read at while leaving the height the vertex is
    // PLACED at alone: a band over which the radius barely changes is a vertical face, and
    // the fast run between two bands is the ledge. Sharpness varies per bearing, because a
    // uniform step round the whole mountain is a wedding cake.
    // +/-1.2 bands, not +/-0.45. tb stays continuous in `a` however far this swings
    // (q + fq is continuous across each integer boundary), so a big swing costs no
    // cracks -- it just stops the bands being rings.
    const ph = (bandPhase(a) - 0.5) * 2.4;
    const x = t * BANDS + ph;
    const q = Math.floor(x);
    const f = x - q;
    const sh = 2.0 + bandSharp(a) * 5.0;
    const fq = pk_clamp((f - 0.5) * sh + 0.5, 0, 1);
    // Mixed at 0.58, not 1. Measured: at 0.80 four fifths of the profile's whole run is
    // spent inside the transitions, so the rest of every band is a perfect cylinder and
    // two thirds of the mountain measured past 75 degrees -- a stack of drums, not a
    // horn. At 0.58 the underlying slope still reads and the breaks still break. Faded
    // out under the talus and over the summit knob, neither of which is banded rock.
    // THE BAND MUST DIE MUCH EARLIER ON THE CONCAVE BRANCH.
    //
    // The ridge profile cos(x*pi/2)^0.75 has an UNBOUNDED derivative as x -> 1, so near the
    // summit a small wander in the height the profile is READ at becomes a huge wander in
    // radius -- and the phase swing is +/-1.2 bands, which moves tb by +/-0.24. Measured on
    // the world's own two ridge peaks: in t = [0.80, 0.95) nearly a third of adjacent radial
    // samples stepped FURTHER than the arc between them (worst 3.13ft of radius over 0.19ft
    // of arc), adjacent normals reached 148 degrees apart, and the top of both peaks -- the
    // part standing against open sky, and the only part that is pure silhouette -- came out
    // as a ring of thin radial fins speckled black and white. The snow line sits exactly
    // there, so the aliasing was being painted white.
    //
    // The sugarloaf is unaffected because SUMMIT floors its profile, hence the branch.
    const mix = 0.58 * (0.16 + 0.84 * bandAmp(a))
      * pk_smooth(t, 0.06, 0.20)
      * (1 - pk_smooth(t, sugarloaf ? 0.90 : 0.58, sugarloaf ? 0.99 : 0.84));
    const tb = t + ((q + fq - ph) / BANDS - t) * mix;

    const core = baseRadius * ROCK_BASE * prof(tb) * domeCap(t);
    // Fade the spurs out as the radius collapses into the summit, or the displacement is
    // larger than the mountain left to displace and the knob turns inside out.
    const rock = core + baseRadius * s * pk_clamp(core / (baseRadius * 0.14), 0, 1);

    // TERRACES. Huayna Picchu's are cut high on the sugarloaf and are the detail that makes
    // people name the mountain. They are a modulation of this same surface -- a sawtooth of
    // about a foot and a half -- and they are deliberately FOUR over the window, not eight:
    // at 160 rows over the height four gives each terrace ten rows and eight gives it five,
    // which is under what the mesh can draw as a step and comes out as noise.
    let terr = 0;
    let terrStep = 0;
    if (terraces) {
      const win = pk_smooth(t, 0.58, 0.64) * (1 - pk_smooth(t, 0.84, 0.90));
      // Centred on the +Z face, which is the one the citadel (and the student) looks at.
      const da = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));
      const face = 1 - pk_smooth(Math.abs(da), 0.55, 1.15);
      terr = win * face;
      if (terr > 0) {
        const u = (t - 0.60) * (4 / 0.26);
        terrStep = (0.5 - (u - Math.floor(u))) * 1.7 * terr;
      }
    }

    // THE PATH, zig-zagging up the flank. A bench cut of half a foot plus a colour lift --
    // at 200ft a four-foot path across a 500px mountain is a good sixteen pixels, so it is
    // worth having, and it is worth having as a NOTCH rather than as a laid-on ribbon.
    let pathM = 0;
    if (path) {
      const u = pk_clamp((t - 0.10) / 0.74, 0, 1);
      const zz = u * 5 + 0.25;
      const tri = 2 * Math.abs(zz - Math.floor(zz) - 0.5);
      const aP = Math.PI / 2 + (tri - 0.5) * 1.55;
      const d = Math.atan2(Math.sin(a - aP), Math.cos(a - aP));
      pathM = Math.exp(-((d / 0.085) ** 2)) * pk_smooth(u, 0.02, 0.10) * (1 - pk_smooth(u, 0.90, 1));
    }

    let r = rock + terrStep - pathM * 0.55;

    // THE TALUS APRON. Fallen rock collects at the foot, so the mountain's own footprint is
    // the apron's, not the cliff's. Its top edge is irregular and RISES AT A GULLY MOUTH,
    // because that is where the debris comes from -- a level apron top reads as a plinth.
    // Built as a max against a concave fan curve rather than as a separate cone, so the
    // junction is a break of slope on one surface and can never show daylight.
    const gully = pk_clamp(-s * 7, 0, 1);
    const topT = apronTop * (0.68 + 0.62 * fanNoise(a) + 0.55 * gully);
    let talusK = 0;
    if (t < topT) {
      const apronBase = baseRadius * (0.93 + 0.07 * fanNoise(a));
      // Where the rock is at the apron's top, so the fan lands ON it rather than crossing it.
      const topCore = baseRadius * ROCK_BASE * prof(topT) + baseRadius * spurAt(topT, a);
      const u = t / topT;
      const apron = apronBase + (topCore - apronBase) * u ** 0.75;
      const before = r;
      r = pk_softMax(r, apron, Math.max(0.6, baseRadius * 0.03));
      talusK = pk_clamp((apron - before) / (baseRadius * 0.04) + 0.5, 0, 1) * (1 - u ** 2);
    }

    return {
      r: Math.max(0.15, r),
      gully: s,
      talus: talusK,
      terr,
      path: pathM,
      stain: stainN(a),
    };
  };
}

// ---------------------------------------------------------------------------
// The peaks
// ---------------------------------------------------------------------------

const PK_RADIAL = 256; // samples round the circle -- 9+ per lobe at the finest octave
const PK_RINGS = 160; // rows up the height -- ~0.8ft apart on a 130ft peak, which is what
// lets a cliff band's transition span three rows and read as a ledge rather than a crease
const PK_SKIRT = 5; // feet of vertical skirt below the origin, so uneven terrain cannot
// open a crescent of daylight under a 124ft-wide object. It is capped flat underneath, so
// the peak is a genuinely closed solid: zero boundary edges.

// Huayna Picchu: the peak in every photograph of this place.
//
// What makes it that mountain rather than a cone is that the sides are CONCAVE, sweeping
// out at the bottom and nearly vertical at the top, and that the flanks are cut by spurs
// and gullies running DOWN the fall line. Ridges going round the mountain -- which is what
// a sine term in the bearing gives you -- are corrugation, not erosion.
// A NEAR-WHITE GRANULAR MAP, and it is the answer to a problem a vertex tint cannot solve.
//
// Vegetation painted into the colour attribute can only ever be as fine as the mesh, and
// at ~1.5ft vertex spacing the finest honest patch is about 11ft. Eleven-foot patches of
// green on a grey-brown flank do not read as forest -- they read as CAMOUFLAGE, soft
// blobs with no internal texture, which is exactly how two passes of this rendered.
//
// So the fine detail moves into a texture, which is this project's standing answer (the
// volcano's grain map, the flower beds' veined petals). The tile carries NO colour of its
// own -- it is near-white speckle -- so `map` x `vertexColors` multiplies without staining
// anything: the same grain reads as tree crowns where the tint is green and as rock grit
// where it is granite. Normally that multiply is the trap this codebase warns about; here
// it is the whole point.
//
// Values stay inside 0.72..1.0. Pushed harder the mountain goes muddy in shadow, where a
// 300ft-distant flank has very little light to give up in the first place.
function pk_canopyTexture(seed, uTiles) {
  const rng = seededRandom(seed * 3 + 91);
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbfa';
    ctx.fillRect(0, 0, w, h);
    // Crowns. Drawn NINE TIMES, wrapped by one tile in both axes, because anything that
    // touches an edge has to appear on the opposite one or the seam draws a line straight
    // down the mountain -- the same wrap the volcano's grain map needs.
    const blob = (x, y, r, a, g) => {
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const grad = ctx.createRadialGradient(x + ox * w, y + oy * h, 0, x + ox * w, y + oy * h, r);
          grad.addColorStop(0, `rgba(${g},${g},${g},${a})`);
          grad.addColorStop(1, `rgba(${g},${g},${g},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x + ox * w, y + oy * h, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    for (let i = 0; i < 900; i++) {
      blob(rng() * w, rng() * h, 1.6 + rng() * 3.4, 0.16 + rng() * 0.20, 150 + Math.floor(rng() * 60));
    }
    for (let i = 0; i < 90; i++) {
      blob(rng() * w, rng() * h, 8 + rng() * 16, 0.06 + rng() * 0.08, 165 + Math.floor(rng() * 50));
    }
  });
  // The peak's own UVs run well past 1 in both axes (u tiles round the circle, v repeats
  // every 9ft of height), so without this the whole flank samples one clamped edge texel.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // ITS OWN REPEAT, OR THE TILE IS SMALLER THAN THE MESH AND MIPS TO A FLAT MULTIPLY.
  //
  // The peak's UVs are built for the relief bump (u tiles `uTiles` times round, v every 9ft),
  // and inheriting them put one 256px tile across ~9ft -- a texel of 0.42 INCHES, with the
  // "crowns" at under two inches. Measured, the tile's mean is 0.961 with a standard
  // deviation of 0.024, and at 296ft one texel is 0.077 screen pixels: the GPU mips it
  // straight to its mean, so the whole map was a uniform 4% darkening and none of the
  // camouflage problem it was added to solve was touched.
  //
  // At 6/uTiles the tile spans about 65ft of circumference, which puts the coarse blobs at
  // 2-6ft and the fine ones at 0.4-1.2ft -- crown-sized, and resolvable at 296ft. The 6 is a
  // whole number on purpose: uTiles * repeat.x must stay integral or the wrapped seam column
  // stops landing on an integer u and draws a line down the mountain.
  texture.repeat.set(6 / uTiles, 9 / 60);
  return texture;
}

export function andeanPeak({
  height = 120, baseRadius = 60, sugarloaf = true, snow = false, seed = 29,
  terraces = null, path = null, apronTop = 0.14, vegetation = true,
} = {}) {
  const g = group();
  const wantTerraces = terraces === null ? sugarloaf : terraces;
  const wantPath = path === null ? sugarloaf : path;
  const field = pk_field({
    height, baseRadius, sugarloaf, seed, terraces: wantTerraces, path: wantPath, apronTop,
  });

  const ring = PK_RADIAL + 1; // the seam column is duplicated so u can run 0..1
  const rows = PK_RINGS + 1; // one skirt row, then PK_RINGS rows of terrain
  const vertCount = rows * ring + 2; // + apex + base-cap centre
  const pos = new Float32Array(vertCount * 3);
  const uv = new Float32Array(vertCount * 2);
  const auxT = new Float32Array(vertCount);
  const auxG = new Float32Array(vertCount);
  const auxTal = new Float32Array(vertCount);
  const auxTerr = new Float32Array(vertCount);
  const auxPath = new Float32Array(vertCount);
  const auxStain = new Float32Array(vertCount);

  // UVs carry the bump tile's repeat as a WHOLE number of tiles round the circle, so the
  // seam column lands exactly back on u=0 and the tile does not draw a line down the flank.
  const uTiles = Math.max(8, Math.round((2 * Math.PI * baseRadius) / 9));

  for (let i = 0; i < rows; i++) {
    // Row 0 is the skirt: the same radius as the ground ring, dropped straight down.
    const skirt = i === 0;
    const t = skirt ? 0 : (i - 1) / PK_RINGS;
    const y = skirt ? -PK_SKIRT : height * t;
    for (let j = 0; j <= PK_RADIAL; j++) {
      const a = (j / PK_RADIAL) * Math.PI * 2;
      const f = field(t, a);
      const k = i * ring + j;
      pos[k * 3] = Math.cos(a) * f.r;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = Math.sin(a) * f.r;
      uv[k * 2] = (j / PK_RADIAL) * uTiles;
      uv[k * 2 + 1] = y / 9;
      auxT[k] = t;
      auxG[k] = f.gully;
      auxTal[k] = f.talus;
      auxTerr[k] = f.terr;
      auxPath[k] = f.path;
      auxStain[k] = f.stain;
    }
  }

  // The apex is ONE vertex, not a ring of coincident ones. A degenerate ring computes
  // garbage normals from zero-area triangles and smears them across the neighbours, which
  // is what turns a summit into a smudge of creases.
  const apex = rows * ring;
  pos[apex * 3 + 1] = height;
  auxT[apex] = 1;
  uv[apex * 2 + 1] = height / 9;
  const bottom = apex + 1;
  pos[bottom * 3 + 1] = -PK_SKIRT;

  const idx = [];
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < PK_RADIAL; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const last = (rows - 1) * ring;
  for (let j = 0; j < PK_RADIAL; j++) idx.push(last + j, apex, last + j + 1);
  for (let j = 0; j < PK_RADIAL; j++) idx.push(j + 1, bottom, j); // reversed: this cap faces down

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(idx);
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();

  // The duplicated seam column would otherwise be shaded as two unrelated edges and draw a
  // hard line from the summit to the sand -- visible from across the world.
  const normal = geometry.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i * ring;
    const b = a + PK_RADIAL;
    const nx = (normal.getX(a) + normal.getX(b)) / 2;
    const ny = (normal.getY(a) + normal.getY(b)) / 2;
    const nz = (normal.getZ(a) + normal.getZ(b)) / 2;
    const len = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / len, ny / len, nz / len);
    normal.setXYZ(b, nx / len, ny / len, nz / len);
  }
  normal.needsUpdate = true;

  // -------------------------------------------------------------------------
  // Colour, and this is where most of the realism is
  // -------------------------------------------------------------------------
  //
  // VEGETATION IS ZONED BY ALTITUDE **AND BY SLOPE**, and the slope half is the bigger of
  // the two. Coloured by height alone the green comes out as a level band round the
  // mountain and reads as a knitted hat -- exactly the failure the old code had already
  // recorded for the SNOW line and had not applied to the greenery. This is a cloud
  // forest: the trees are on the ledges and in the gullies and there is nothing at all on
  // the vertical faces, so the tone is driven by the surface's own NORMAL, taken from the
  // geometry rather than guessed from the field.
  // Its own bearing noise: the field's `bandAmp` lives inside pk_field and is not in
  // scope here. A snow line that varies only with the position noise sits at a near
  // constant height and reads as a white beret pulled onto a dome.
  const snowN = pk_wrapNoise(seed * 31 + 601, 5);
  const colors = new Float32Array(vertCount * 3);
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  const cBuff = new THREE.Color(PK_BUFF);
  const cPink = new THREE.Color(PK_PINK);
  const cPale = new THREE.Color(PK_PALE);
  const cLichen = new THREE.Color(PK_LICHEN);
  const cWet = new THREE.Color(PK_WET);
  const cRust = new THREE.Color(PK_RUST);
  const cTalus = new THREE.Color(PK_TALUS);
  const cTalusDark = new THREE.Color(PK_TALUS_DARK);
  const cForest = new THREE.Color(PK_FOREST);
  const cForestLit = new THREE.Color(PK_FOREST_LIT);
  const cSnow = new THREE.Color(PK_SNOW);

  for (let k = 0; k < vertCount; k++) {
    const px = pos[k * 3];
    const py = pos[k * 3 + 1];
    const pz = pos[k * 3 + 2];
    const up = pk_clamp(normal.getY(k), 0, 1);
    const steep = 1 - up;
    const t = auxT[k];
    const gully = pk_clamp(-auxG[k] * 7, 0, 1);
    const tal = auxTal[k];

    // Patch scales are bounded by the mesh, like every other frequency here: vertices sit
    // ~1.5ft apart at the base, so a 6ft patch is four samples and a 3ft one is aliasing.
    const n1 = smoothNoise3(px * 0.055 + seed, py * 0.055, pz * 0.055);
    const n2 = smoothNoise3(px * 0.16 + seed * 3, py * 0.16, pz * 0.16);

    c.copy(cBuff).lerp(cPink, n1);
    c.lerp(cPale, pk_smooth(steep, 0.55, 0.95) * 0.45); // a fresh vertical face is paler
    c.lerp(cLichen, pk_clamp(up * 1.3, 0, 1) * n2 * 0.8); // lichen only ever takes a ledge
    c.lerp(cWet, gully * (0.30 + 0.45 * steep)); // and a gully never dries out
    c.lerp(cRust, pk_smooth(auxStain[k] + n2 * 0.35, 0.72, 1.05) * steep * 0.5); // iron runs down a face

    if (tal > 0.001) {
      tmp.copy(cTalus).lerp(cTalusDark, n2 * 0.8);
      c.lerp(tmp, pk_clamp(tal, 0, 1));
    }

    if (vegetation) {
      // The treeline sits HIGH: this is a cloud forest and the trees run most of the way up
      // Huayna Picchu, which is exactly why the slope gate rather than the altitude gate is
      // what has to do the work. Gated on height alone the green comes out as a level band.
      const tree = 1 - pk_smooth(t, 0.54, 0.93);
      // Cloud forest holds on to astonishing angles -- 70 degrees is still wooded here --
      // so the gate opens early and only shuts on the genuinely vertical bands. What this
      // buys is the banded look the real mountain has: green on every ledge the cliff
      // bands leave, bare granite on the faces between them.
      const holds = pk_smooth(up, 0.0, 0.30);
      // The foot of the mountain is wooded whatever its local slope: a cliff band's own
      // face is vertical, but at 20ft up it is still full of trees growing out of it.
      const foot = 1 - pk_smooth(t, 0.06, 0.34);
      // Gated on slope ALONE the green lands on every ledge and only on the ledges --
      // and since the cliff bands are what make the ledges, the vegetation came out as
      // the same set of rings in green. A patch field breaks the correlation, which is
      // what a real flank has: woodland runs up the gullies and stops in ragged edges,
      // it does not stripe.
      // Frequency matters more than amplitude here. At a 33ft wavelength this field is
      // four blobs from base to summit and reads as CAMOUFLAGE; at ~11ft it is a texture.
      // Vertices sit ~1.5ft apart, so 11ft is about seven samples a cycle -- near the
      // Nyquist floor and deliberately no finer. And it MODULATES rather than masks: what
      // decides where trees are is the structure (gully, ledge, foot), not the noise.
      const patch = smoothNoise3(px * 0.09 + seed * 5, py * 0.06, pz * 0.09);
      let veg = tree * pk_clamp(holds + gully * 0.95 + foot * 0.55, 0, 1) * (0.78 + 0.30 * patch) * (0.80 + 0.32 * n1);
      veg *= 1 - tal * 0.85; // fresh scree is bare
      veg = Math.max(veg, auxTerr[k] * 0.5 * holds); // the summit terraces are grassed
      tmp.copy(cForest).lerp(cForestLit, n2);
      c.lerp(tmp, pk_clamp(veg, 0, 1));
    }

    // A worn switchback seen from 300ft is a TONE, not a stripe. Lerped 0.75 toward the
    // palest rock these read as white ribbons wound round the cone, which is the single
    // thing a path must not look like.
    if (auxPath[k] > 0.02) c.lerp(cPale, pk_clamp(auxPath[k] * 0.16, 0, 1));

    if (snow) {
      // The line follows the ridges and shuns the gullies, and snow does not stick to a
      // vertical face at all -- a level white band is the knitted hat again.
      const line = 0.60 + gully * 0.14 + (n1 - 0.5) * 0.30 + (snowN(Math.atan2(pz, px)) - 0.5) * 0.16;
      c.lerp(cSnow, pk_smooth(t, line, line + 0.26) * pk_smooth(up, 0.12, 0.5));
    }

    colors[k * 3] = c.r;
    colors[k * 3 + 1] = c.g;
    colors[k * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const peak = mesh(geometry, standard({
    vertexColors: true, roughness: 1, map: pk_canopyTexture(seed, uTiles),
    ...relief('stone', { seed, repeat: 1 }),
  }));
  // NO SHADOW CASTING. Every mesh in this app is drawn twice, main pass plus the sun's
  // shadow map, and these three are 247k triangles of the world's 880k. They stand 170-300ft
  // out with the sun high and behind them, so what they would cast falls away from the
  // citadel and off the back of the world: a second full pass over a quarter of the world's
  // geometry for something no student can ever see. They still RECEIVE, which is free.
  peak.castShadow = false;
  g.add(peak);
  return g;
}

// ---------------------------------------------------------------------------
// Cloud
// ---------------------------------------------------------------------------

// Cloud lying in the valley below the ridge -- which is what "cloud forest" means and what
// makes the place look like the place.
//
// Merged squashed spheres, self-lit so it stays bright against a sunlit mountain, NOT
// casting shadows (a 200ft cloud that casts would put the whole world in shade), and
// fogged, because unlike the sea's light shafts this IS an opaque surface and fogging it
// is what keeps the far edge receding. All of that was already right and is unchanged.
//
// What was wrong was the SILHOUETTE: 34 blobs of similar size scattered evenly through a
// box read as one lozenge. Real valley cloud has a FLAT BOTTOM (it forms at the level where
// the air reaches saturation, and that level is a plane) and a billowed top, and it is
// dense in the middle and wispy at the ends. So the blobs are sized by a bell across the
// length, every one of them is seated so its underside sits on y=0, and a low raft layer
// runs the whole length to make that underside continuous. The undersides are also painted
// DARKER than the crowns: a cloud lit from above with a grey base is the single cheapest
// thing that stops it reading as cotton wool.
export function cloudBank({ width = 190, depth = 90, seed = 31, thickness = 1 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bell = (x) => Math.max(0.14, (1 - (2 * x / width) ** 2)) ** 0.6;

  // The raft: wide, very flat, running the length. This is the flat bottom.
  const raftCount = 9;
  for (let i = 0; i < raftCount; i++) {
    const x = (i / (raftCount - 1) - 0.5) * width * 0.94;
    const b = bell(x);
    // Tapered hard against the bell: at a flat 0.55 the end rafts stuck 25ft past the
    // requested width and the bank came out with blunt square ends.
    const r = (depth * 0.42) * (0.25 + 0.8 * b);
    // SphereGeometry, not Icosahedron -- non-indexed geometry is flat-shaded whatever the
    // material says, and a flat-shaded cloud is a pile of grey boulders.
    const blob = new THREE.SphereGeometry(r, 12, 8);
    const sy = randomIn(rng, 0.10, 0.16) * thickness;
    blob.scale(1, sy, 1);
    parts.push({
      geometry: blob,
      color: 0xc6ced8, // the shaded underside
      position: [x, r * sy, randomIn(rng, -depth * 0.10, depth * 0.10)],
    });
  }

  // The billow: puffs sitting ON the raft, biggest in the middle. Their heights are drawn
  // against the bell too, so the crown rises and falls along the bank instead of running
  // flat -- a flat top and a flat bottom together is a slab.
  const puffs = 34;
  for (let i = 0; i < puffs; i++) {
    const x = randomIn(rng, -width / 2, width / 2);
    const b = bell(x);
    const z = randomIn(rng, -depth / 2, depth / 2) * (0.45 + 0.55 * b);
    const r = randomIn(rng, 10, 25) * (0.3 + 0.7 * b);
    const sy = randomIn(rng, 0.22, 0.40) * thickness * (0.55 + 0.45 * b);
    const blob = new THREE.SphereGeometry(r, 12, 8);
    blob.scale(1, sy, 1);
    // Seated so the underside sits ON the raft's plane and never below it -- one puff
    // hanging below the base is all it takes to lose the flat bottom the whole silhouette
    // depends on, and at the wispy ends that is exactly where the small ones landed.
    const y = r * sy * Math.max(1, randomIn(rng, 0.9, 1.5) * (0.5 + 0.5 * b));
    parts.push({
      geometry: blob,
      // Crowns near-white, flanks mid: the ramp is what gives the billow its form.
      color: y > r * sy * 1.1 ? 0xf5f8fb : [0xe3e9ef, 0xd8e0e8][i % 2],
      position: [x, y, z],
    });
  }

  const m = mergedMesh(parts, { roughness: 1, emissive: 0x6d7a86, emissiveIntensity: 0.5 });
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}
