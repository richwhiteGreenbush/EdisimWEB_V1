import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  solidLoft, revolve, extrudeOutline, solidSurface, gearOutline,
  ball, tube, chain, spike, dome, mergeParts, tintGeometry, weather, placed, xformed,
  roundedOutline, ringPts, put, smoothNoise3, smoothed,
} from './LoftKit.js';

// Volcanoes & Rocks -- a cut-away stratovolcano with its plumbing exposed, the lava it is
// making, and the twelve rocks of the rock cycle laid out where a student can walk round
// each one.
//
// THE ONE DECISION THAT SHAPES THIS FILE: a volcano teaches two completely different things
// and only one of them is visible from outside. The cone is a landform -- a silhouette, a
// slope angle, a summit crater. The INTERESTING half is the plumbing: a magma chamber miles
// down, a conduit, dikes and sills prising the layers apart, and the alternating lava and
// ash beds that are the whole reason it is called a STRATOvolcano. None of that survives on
// an intact cone, and making the outside translucent is the trap Fantastic Voyage spent a
// rebuild learning: a see-through surface loses most of its apparent colour and reads as
// glass, not rock. So a quarter is cut out and the cut face is opaque, which is what a real
// museum model does and what a real road cutting looks like.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// THE ROCKS ARE THE PALETTE, and widening it is most of what makes this world legible. A
// volcanic landscape is genuinely near-monochrome -- everything is grey-brown basalt and ash
// -- so if the specimens are painted from the same range as the ground they disappear into
// it. These twelve are the colours the rocks actually are, and between them they cover far
// more of the wheel than a lava field suggests: buff sandstone, cream limestone, white
// marble, pink-speckled granite, green-grey schist.
const ROCK = {
  basalt: 0x3d4147, basaltPale: 0x565c64, basaltWarm: 0x4a3a30,
  scoria: 0x76392a, tephra: 0x7d6a5c, ash: 0x9a9288, tuff: 0xa89a86,
  // THE RED IS IRON, and it is the one colour a volcanic landscape genuinely owns. Basalt is
  // about 10% iron by weight and the moment steam and air get at it while it is still hot it
  // oxidises -- which is why the inside of a cinder cone, the rim of a vent and the top of a
  // cooling flow are brick red while the same rock a foot deeper is grey. So this is not
  // colour added for the sake of it: the red belongs exactly where the heat has been, and
  // painting it there is what tells a student where that was.
  // Muted, and that is the calibration rather than a preference: at full saturation these
  // came out as traffic cones scattered on the plain. Oxidised basalt is a dull brick, not a
  // pigment -- what makes it read as iron is that it is DARKER than the ash around it, not
  // more colourful than everything else in the world.
  rust: 0x7a3c2a, oxide: 0x8f4a30, emberRock: 0x62281c, redAsh: 0x8e5942,
  scoriaDeep: 0x532a1e, cinder: 0x96543a,
  conglomerateMatrix: 0x7e6a54,
  obsidian: 0x1d1e25, obsidianSheen: 0x3b3e50,
  pumice: 0xc6bfae, pumiceDeep: 0x9a9285,
  granite: 0xbdb2a3, graniteFeldspar: 0xc89a86, graniteQuartz: 0xd8d2c4, graniteMica: 0x413c37,
  sandstone: 0xb7935f, sandstoneBand: 0x96744a,
  limestone: 0xcdc6ae, limestoneShade: 0xa1987e,
  shale: 0x565b58, shaleBand: 0x41453f,
  conglomerate: 0xa89680,
  gneiss: 0xb0a79e, gneissBand: 0x5e564f, gneissPink: 0xc8a294,
  marble: 0xd6d0c4, marbleVein: 0x8b8880,
  slate: 0x424954, slateSheen: 0x6a7280,
  schist: 0x6e6a58, schistMica: 0xa89a6c,
};

// Lava, and the whole trick is that it is HOTTEST WHERE IT IS THINNEST AND FRESHEST. A flow
// is a dark crust with incandescent cracks in it, not a river of orange paint: paint the
// whole flow bright and it reads as plastic, paint it dark and it reads as tarmac. The crust
// carries the colour and the cracks carry the heat.
const LAVA = {
  crust: 0x3b322d, crustWarm: 0x53372a,
  cool: 0xb8380f, hot: 0xff7a1e, core: 0xffc861, white: 0xfff0c0,
};

const STEAM = { plume: 0x8f8880, plumePale: 0xb8b2a8, sulphur: 0xd9c463 };

// The cut face's magma and dike colours, as ready-made [r, g, b] triples. They are constants
// rather than THREE.Color lookups because the face's tint runs once per vertex over a
// 58 x 78 grid, twice, and allocating two Colors per vertex to return the same two answers is
// nine thousand throwaway objects per volcano.
const TINT_MAGMA = (() => { const c = new THREE.Color(LAVA.hot); return [c.r, c.g, c.b]; })();
const TINT_DIKE = (() => { const c = new THREE.Color(LAVA.cool); return [c.r, c.g, c.b]; })();

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// `revolve` decides its winding from the profile's direction, and a profile written the way
// anybody writes one -- bottom up -- comes out INSIDE OUT, which under a FrontSide material
// reads as a DARK surface rather than a missing one. Measured in SeattleProps.
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

// mergeParts applies a part's rotation as ONE Euler in XYZ order, composing as Rx*Ry*Rz --
// so a middle Y term lands BEFORE the X term. Anything that must be laid flat and THEN
// turned in plan bakes the pair as a matrix. Measured in RobotProps: the plate's own normal
// falls from 1.000 to 0.697 by 0.8 radians.
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

// A canvas holds sRGB bytes and THREE.Color works in linear, so anything computed as a
// Color and then written into an ImageData has to be converted back -- otherwise every band
// on the cut face comes out about a stop too dark, which on this particular surface reads as
// the strata having failed rather than as an encoding mistake.
// A deterministic 0..1 from an integer, for picking a bed's rock type. Not seededRandom:
// the section texture is painted one texel at a time in no particular order, so a band's
// colour has to be a pure function of its INDEX or neighbouring texels disagree about which
// bed they are in and the section fills with confetti.
function hash1(n) {
  const x = Math.sin(n * 127.1 + 3.7) * 43758.5453;
  return x - Math.floor(x);
}

function linearToSrgb(x) {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

// The cut-away's missing sector, centred on +Z so it opens toward whoever walks up.
//
// `revolve` places a point at angle a at (sin a, cos a), so a = 0 IS +Z. Sweeping from
// +gap/2 round to -gap/2 therefore leaves the bite facing the approach -- and `revolve`
// closes the two radial faces itself for any sweep under a full turn, which is what makes
// the cut a face you can read strata off rather than a hole you can see through.
const CUT_GAP = Math.PI * 0.42;
const CUT_START = CUT_GAP / 2;
const CUT_SWEEP = Math.PI * 2 - CUT_GAP;
const CUT_END = CUT_START + CUT_SWEEP;

// Is this vertex on one of the two cut faces? Both lie exactly at the sweep's end angles,
// which is the one thing that distinguishes them from the cone's weathered outside.
function onCutFace(p) {
  if (Math.abs(p.x) < 1e-4 && Math.abs(p.z) < 1e-4) return true;
  const a = Math.atan2(p.x, p.z);
  // Signed angular difference wrapped to (-pi, pi]. Written out rather than done with a
  // modulo expression: the first pass folded the wrap and the comparison together and got
  // the sense INVERTED, so the strata were painted half a turn away on the BACK of the cone
  // where nothing can see them, and the cut face -- the entire reason the model is cut --
  // got the weathering tint meant for the outside. It rendered as a flat brown notch.
  const near = (t) => {
    let dd = (a - t) % (Math.PI * 2);
    if (dd > Math.PI) dd -= Math.PI * 2;
    if (dd < -Math.PI) dd += Math.PI * 2;
    return Math.abs(dd) < 0.03;
  };
  return near(CUT_START) || near(CUT_END);
}

// WHICH STRATUM DOES THIS POINT BELONG TO?
//
// A stratovolcano grows by draping each eruption over the last, so its layers are nested
// CONES sharing a summit -- on a cut face they read as arcs parallel to the flank, never as
// horizontal bands. A point (r, y) lies on the cone of scale s when r = R s (1 - y/(H s))^p,
// which does not rearrange, so it is solved by bisection: twelve iterations, once per vertex
// at build time, and the layering comes out geometrically correct instead of merely stripey.
//
// Horizontal banding is what you get if you skip this, and it is unmistakably sedimentary --
// exactly the wrong rock story on the one model whose job is to tell the volcanic one.
function strataScale(r, y, R, H, p) {
  if (y >= H) return 1;
  let lo = 0.02;
  let hi = 1.6;
  for (let i = 0; i < 14; i++) {
    const s = (lo + hi) / 2;
    const top = H * s;
    const rs = y >= top ? 0 : R * s * Math.pow(1 - y / top, p);
    if (rs < r) lo = s; else hi = s;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// THE CUT-AWAY VOLCANO
// ---------------------------------------------------------------------------

// A stratovolcano with a quarter taken out of it, so the cut face shows what the outside
// cannot: alternating beds of lava and ash, the magma chamber, the conduit that feeds the
// summit, and the dikes and sills wedging the layers apart.
//
// EVERY PART OF THE PLUMBING IS CUT BY THE SAME PLANE, which is the whole reason this reads
// as one sectioned object rather than as a cone with ornaments inside it. The chamber, the
// conduit, the dikes and the crater bowl are all partial lathes sharing CUT_START and
// CUT_SWEEP, so the section is continuous from the summit to the roots.
export function cutawayVolcano({
  seed = 5, height = 92, radius = 82, layers = 27, craterRadius = 13,
} = {}) {
  const rng = seededRandom(seed);
  const rock = [];
  const glow = [];
  const H = height;
  const R = radius;
  const P = 1.7; // flank concavity: a real stratovolcano steepens toward the summit

  // --- the edifice ---------------------------------------------------------
  //
  // The profile runs from the outer base up the flank, over the crater rim, down the inner
  // wall to the crater floor, and back to the axis -- so the crater is part of the same
  // closed solid rather than a bowl parked on top of a cone.
  const flank = [];
  const rimY = H;
  const rimR = craterRadius + 3.2;
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const y = t * rimY;
    const r = R * Math.pow(1 - y / (H * 1.06), P) + rimR * t * 0.14;
    // A volcano is not a lathe: gullies, a breached flank and old flow levees are what stop
    // it reading as a traffic cone. The wobble is radial and seeded, so the same volcano
    // comes back identically on every reload.
    flank.push([Math.max(rimR + 0.5, r), y]);
  }
  const profile = [...flank];
  profile.push([rimR, rimY]);
  profile.push([craterRadius, rimY - 4.4]);
  profile.push([craterRadius * 0.62, rimY - 9.5]);
  profile.push([0, rimY - 10.2]);

  const edifice = lathed(closed(profile), {
    segments: 78, start: CUT_START, sweep: CUT_SWEEP,
  });
  // Gullies and a rough flank, applied as a displacement of the cone's own surface so it
  // cannot open a gap in it -- and NOT applied to the cut faces, which are a knife cut
  // through the rock and are therefore flat.
  //
  // THE GULLIES HAVE TO BE DEEP, and the first pass's 3.5% was not. A stratovolcano's flank
  // is cut by barrancas that are tens of feet deep -- they are how the ash gets off it -- and
  // without them a lathe of any profile is a traffic cone. Their depth also has to VARY
  // around the cone: an even comb of them is a fluted column, which is the other way to make
  // a smooth object look manufactured.
  {
    const pos = edifice.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 0.4 || onCutFace({ x, z })) continue;
      const a = Math.atan2(x, z);
      const depth = 0.55 + 0.45 * Math.sin(a * 2.3 + 1.1);
      const gully = (Math.sin(a * 11 + Math.sin(a * 3.1) * 1.4) * 0.5 + 0.5) * depth;
      const rough = smoothNoise3(x * 0.035, y * 0.05, z * 0.035) - 0.5;
      const fine = smoothNoise3(x * 0.14, y * 0.16, z * 0.14) - 0.5;
      // Gullies bite hardest at mid-height: they have nothing to cut at the summit and they
      // fan out into the debris apron before they reach the base.
      const bite = Math.sin(THREE.MathUtils.clamp(y / H, 0, 1) * Math.PI) ** 0.7;
      const k = 1 + rough * 0.075 + fine * 0.02 - gully * 0.085 * bite;
      pos.setXYZ(i, x * k, y, z * k);
    }
    pos.needsUpdate = true;
    edifice.computeVertexNormals();
  }
  put(rock, edifice, 0xffffff, null, null, {
    keepColor: true,
    // A STRATOVOLCANO IS DARK. The first pass lerped the flank most of the way to pale ash
    // and the hero rendered as a smooth tan circus tent -- which no amount of gullying would
    // have rescued, because the problem was albedo rather than shape. It is old dark basalt
    // flows, streaked with pale ash where the last fall settled, and RED round the vent,
    // which is where steam and air have been at the rock while it was still hot.
    tint: (p) => {
      const t = THREE.MathUtils.clamp(p.y / H, 0, 1);
      const n = smoothNoise3(p.x * 0.06, p.y * 0.09, p.z * 0.06);
      const m = smoothNoise3(p.x * 0.021 + 11, p.y * 0.03, p.z * 0.021);
      const c = new THREE.Color(ROCK.basaltWarm).lerp(new THREE.Color(ROCK.tephra), n * 0.6);
      c.lerp(new THREE.Color(ROCK.ash),
        THREE.MathUtils.clamp((t - 0.52) * 1.5, 0, 0.62) * (0.35 + m * 0.65));
      c.lerp(new THREE.Color(ROCK.rust),
        THREE.MathUtils.clamp((t - 0.74) * 3.4, 0, 0.7) * (0.45 + n * 0.55));
      return [c.r, c.g, c.b];
    },
  });

  // --- THE PLUMBING, IN PLAN ------------------------------------------------
  //
  // Every structure inside the cone is described ONCE here, as a region of the (radius,
  // height) plane, and then used twice: to build the solid that fills the notch, and to
  // paint that same structure onto the cut face. One description is what makes the section
  // agree with the volume behind it -- with two, a chamber's painted outline and its own
  // wall drift apart and the model stops reading as one cut object.
  //
  // THE CHAMBER SITS IN THE BASE OF THE CONE, which is a deliberate compromise and worth
  // recording. A real magma chamber is a mile or more down; drawn at that depth here it
  // would be entirely below the terrain, where nothing can see it, and the one thing this
  // model exists to show would be a few feet of roof poking up through the ground. Every
  // textbook cutaway makes the same trade, and the placard states the real depth.
  const chamberProfile = [
    [0, -7], [13, -4], [21, 1], [24, 7], [21, 13], [13, 18], [0, 20],
  ];
  const conduitProfile = [
    [2.4, 17], [1.9, H * 0.42], [1.6, H * 0.72], [1.35, rimY - 10.4],
  ];
  //
  // EVERY DIKE HAS TO DIE INSIDE THE ROCK. The first set ran to r = 27 at y = 55, where the
  // flank is only 20 wide, so two of the three came out through the mountain and stood off
  // it as orange spikes. Their far ends are checked against flankAt() below rather than
  // guessed -- a dike that reaches daylight is a fissure eruption, which is a different
  // landform.
  const DIKES = [
    [[7, 16], [17, H * 0.55], 0.75],
    [[8, 11], [31, H * 0.28], 0.6],
  ];
  const SILL = [9, 31, H * 0.235, H * 0.235 + 1.6];

  // Piecewise-linear lookups over a lathe profile, which is all a section outline is.
  const along = (profile, y) => {
    if (y <= profile[0][1]) return profile[0][0];
    for (let i = 1; i < profile.length; i++) {
      if (y <= profile[i][1]) {
        const [r0, y0] = profile[i - 1];
        const [r1, y1] = profile[i];
        return r0 + (r1 - r0) * ((y - y0) / Math.max(1e-6, y1 - y0));
      }
    }
    return profile[profile.length - 1][0];
  };
  const flankAt = (y) => along(flank, y);
  const craterWall = [
    [0, rimY - 10.2], [craterRadius * 0.62, rimY - 9.5], [craterRadius, rimY - 4.4], [rimR, rimY],
  ];
  const innerAt = (y) => (y <= rimY - 10.2 ? 0 : along(craterWall, y));

  const inChamber = (r, y) => y > chamberProfile[0][1] && y < chamberProfile[chamberProfile.length - 1][1]
    && r < along(chamberProfile, y);
  const inConduit = (r, y) => y >= 17 && y <= rimY - 10.2 && r < along(conduitProfile, y);
  const segDist = (r, y, a, b) => {
    const vx = b[0] - a[0]; const vy = b[1] - a[1];
    const wx = r - a[0]; const wy = y - a[1];
    const t = THREE.MathUtils.clamp((wx * vx + wy * vy) / (vx * vx + vy * vy), 0, 1);
    return Math.hypot(wx - vx * t, wy - vy * t);
  };
  const inDike = (r, y) => DIKES.some(([a, b, w]) => segDist(r, y, a, b) < w);
  const inSill = (r, y) => r > SILL[0] && r < SILL[1] && y > SILL[2] && y < SILL[3];
  // HOW DEEP INSIDE THE MELT A POINT IS, 0 at the contact with the country rock and 1 at the
  // core -- and a single function for the chamber, the conduit, the dikes and the sill, so
  // all four are coloured by the same ramp and read as one plumbing system rather than as
  // four unrelated orange shapes.
  //
  // The gradient is the whole thing. Magma chills against the rock it is sitting in, so its
  // margin is darker, stiffer and full of crystals while its middle is incandescent. Painted
  // at one flat bright colour the chamber is a lightbulb in the mountain and the dikes are
  // drinking straws, which is exactly how the first two passes rendered.
  const meltHeat = (r, y) => {
    if (inConduit(r, y)) {
      return 0.62 + 0.38 * (1 - r / Math.max(0.001, along(conduitProfile, y)));
    }
    if (inChamber(r, y)) {
      const rr = Math.max(0.001, along(chamberProfile, y));
      const radial = 1 - r / rr;
      const vert = Math.min((y + 7) / 8, (20 - y) / 8, 1);
      return Math.max(0, Math.min(radial, vert));
    }
    let best = 0;
    for (const [a, b, w] of DIKES) {
      const dd = segDist(r, y, a, b);
      if (dd < w) best = Math.max(best, 0.5 * (1 - dd / w));
    }
    if (inSill(r, y)) {
      const dd = Math.min(y - SILL[2], SILL[3] - y) / ((SILL[3] - SILL[2]) / 2);
      best = Math.max(best, 0.42 * dd);
    }
    return best;
  };
  const inMelt = (r, y) => inConduit(r, y) || inChamber(r, y) || inDike(r, y) || inSill(r, y);

  // --- THE TWO CUT FACES ------------------------------------------------------
  //
  // Three things had to change here and each one hid the next.
  //
  // 1. `revolve` closes a partial sweep with its own radial caps, and those are NOT usable.
  //    It picks each cap's winding assuming the profile runs in its natural direction, and
  //    this profile is REVERSED because that is what makes the outer surface face outward
  //    (measured: +0.701 against -0.701). Reversing fixes the cone and inverts both caps with
  //    it, so the one surface this model exists to show was being back-face culled and the
  //    volcano rendered as a hollow tent.
  //
  // 2. The replacement was built with `extrudeOutline`, which looked right and was still
  //    wrong. AN EXTRUDED OUTLINE HAS NO INTERIOR VERTICES -- it is a fan from the centroid
  //    to the outline points, exactly like a CircleGeometry -- so a per-vertex tint had
  //    nowhere to land, and eleven correctly-computed strata interpolated across four
  //    enormous triangles into a smooth wash. The data was right and there was nothing to
  //    draw it on. Fantastic Voyage's villi floor died the same way.
  //
  // 3. A GRID FIXED THAT AND EXPOSED NYQUIST AGAIN. Eleven nested bands over a 58-column
  //    grid is two or three samples per band near the base, and a per-vertex colour with a
  //    hard threshold cannot do better than the mesh under it: the section came out as a
  //    staircase, which reads as a rendering bug rather than as geology.
  //
  // So the bands are a TEXTURE. The face is a flat plane with known extents, painted per
  // texel by the same region predicates the solids are built from -- razor sharp at any mesh
  // density, and it carries an EMISSIVE MAP as well, which is the only way the chamber and
  // the conduit can glow while the rock around them stays rock (`emissive` is a flat material
  // colour and `vertexColors` does not multiply it).
  const SECTION_PX = 640;
  const sectionMaps = (() => {
    const lit = document.createElement('canvas');
    lit.width = SECTION_PX; lit.height = SECTION_PX;
    const hot = document.createElement('canvas');
    hot.width = SECTION_PX; hot.height = SECTION_PX;
    const litImage = lit.getContext('2d').createImageData(SECTION_PX, SECTION_PX);
    const hotImage = hot.getContext('2d').createImageData(SECTION_PX, SECTION_PX);
    // .data, not the ImageData object: writing indices straight onto the object silently
    // does nothing and putImageData then lays down the all-zero buffer it was created with,
    // which renders as a completely black cut face -- indistinguishable at a glance from
    // inside-out normals, which is what it was first mistaken for.
    const li = litImage.data;
    const hi = hotImage.data;
    const c = new THREE.Color();
    const bandA = new THREE.Color(0x554d45);
    const bandB = new THREE.Color(0x7d7266);
    const paleA = new THREE.Color(0xa29684);
    const parting = new THREE.Color(0xb6aa96);
    const redAsh = new THREE.Color(0x7d4c34);
    const chill = new THREE.Color(ROCK.emberRock);
    const coolMelt = new THREE.Color(LAVA.cool);
    const hotMelt = new THREE.Color(LAVA.hot);
    for (let py = 0; py < SECTION_PX; py++) {
      // Canvas row 0 is the TOP of the sheet, so v runs the other way.
      const v = 1 - (py + 0.5) / SECTION_PX;
      const y = v * rimY;
      const i0 = innerAt(y);
      const o0 = flankAt(y);
      for (let px = 0; px < SECTION_PX; px++) {
        const u = (px + 0.5) / SECTION_PX;
        const r = i0 + u * (o0 - i0);
        const o = (py * SECTION_PX + px) * 4;
        let er = 0; let eg = 0; let eb = 0;
        if (inMelt(r, y)) {
          const n = smoothNoise3(r * 0.3, y * 0.3, 3.5) - 0.5;
          const heat = THREE.MathUtils.clamp(meltHeat(r, y) + n * 0.18, 0, 1);
          c.copy(chill).lerp(coolMelt, THREE.MathUtils.clamp(heat * 2.2, 0, 1))
            .lerp(hotMelt, THREE.MathUtils.clamp((heat - 0.55) * 2.4, 0, 1));
          const k = heat * heat;
          er = Math.round(230 * k); eg = Math.round(92 * k); eb = Math.round(20 * k);
        } else {
          const s0 = strataScale(r, y, R, H * 1.06, P);
          // AN EVEN ALTERNATION OF EQUAL BANDS IS A BEACH UMBRELLA. Real beds differ in
          // thickness by an order of magnitude -- a lava flow is metres, an ash fall can be
          // centimetres -- so the band coordinate is warped before it is quantised, which
          // costs two sines and is the single biggest thing separating this from a stripe.
          const s = s0 + Math.sin(s0 * 13.7) * 0.055 + Math.sin(s0 * 31.1 + 1.7) * 0.022;
          const band = Math.floor(s * layers);
          const frac = s * layers - band;
          const h = hash1(band);
          // THE BEDS ARE PAINTED MUCH LIGHTER THAN THE ROCK ACTUALLY IS, and that is forced
          // rather than chosen. A cut face is a vertical plane facing sideways: the sun never
          // reaches it, so the hemisphere bounce is the entire light it gets. Painted at
          // basalt's honest near-black the strata were eleven distinct colours rendering as
          // one flat black wall. A weathered road cutting is pale anyway.
          //
          // Most of a stratovolcano is lava; the pale ash falls are the punctuation. Weight
          // the draw that way or the section reads as a sandstone cliff.
          if (h < 0.62) c.copy(bandA).lerp(bandB, h * 0.55);
          else if (h < 0.82) c.copy(bandB).lerp(paleA, (h - 0.62) * 2.4);
          else if (h < 0.94) c.copy(redAsh).lerp(bandA, (h - 0.82) * 2);
          else c.copy(paleA).lerp(parting, (h - 0.94) * 8);
          // A thin dark parting at each bed's BASE -- the shadow line under a bed is what the
          // eye counts, the same reason the Colosseum's risers are tinted darker than their
          // own treads.
          if (frac < 0.09) c.lerp(bandA, 0.55);
          // Grain, so no bed is a flat colour. Cheap here because it is per TEXEL: a vertex
          // tint could not resolve it at any mesh density this model can afford.
          const g = 0.9 + smoothNoise3(r * 0.5, y * 0.5, h * 40) * 0.22;
          c.multiplyScalar(g);
        }
        // The canvas is sRGB and THREE.Color is linear-working, so the bytes have to be
        // converted back or every band comes out about a stop too dark.
        li[o] = Math.round(255 * linearToSrgb(c.r));
        li[o + 1] = Math.round(255 * linearToSrgb(c.g));
        li[o + 2] = Math.round(255 * linearToSrgb(c.b));
        li[o + 3] = 255;
        hi[o] = er; hi[o + 1] = eg; hi[o + 2] = eb; hi[o + 3] = 255;
      }
    }
    lit.getContext('2d').putImageData(litImage, 0, 0);
    hot.getContext('2d').putImageData(hotImage, 0, 0);
    const mk = (canvas) => {
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      return t;
    };
    return { map: mk(lit), emissiveMap: mk(hot) };
  })();

  const faces = [];
  const face = solidSurface({
    nu: 64, nv: 80,
    point: (u, v) => {
      const y = v * rimY;
      const i0 = innerAt(y);
      return [i0 + u * (flankAt(y) - i0), y, 0];
    },
    thick: () => 0.34,
  });
  for (const ang of [CUT_START, CUT_END]) {
    // The outline's +X has to end up along the radial direction. `revolve` puts radius at
    // (sin a, cos a) and an Object3D at yaw r maps +X to (cos r, -sin r), so r = a - pi/2.
    put(faces, face, 0xffffff, null, [0, ang - Math.PI / 2, 0]);
  }

  // --- THE PLUMBING AS SOLIDS ------------------------------------------------
  //
  // The same regions again, swept about the axis through the same cut angles, so what fills
  // the notch behind the face agrees with what the face has painted on it.
  const chamber = lathed(closed(chamberProfile), {
    segments: 46, start: CUT_START, sweep: CUT_SWEEP,
  });
  put(glow, chamber, 0xffffff, [0, 0, 0], null, {
    keepColor: true,
    tint: (p) => {
      // Hotter toward the middle of the chamber, cooler and crustier at its roof and walls.
      const d = Math.hypot(p.x, p.z) / 19;
      const c = new THREE.Color(LAVA.core).lerp(new THREE.Color(LAVA.cool), THREE.MathUtils.clamp(d * 1.1, 0, 1));
      return [c.r, c.g, c.b];
    },
  });

  const conduit = lathed(closed(conduitProfile), {
    segments: 30, start: CUT_START, sweep: CUT_SWEEP,
  });
  put(glow, conduit, LAVA.hot);

  // THE DIKES AND THE SILL ARE PAINTED ONLY, and that is not a shortcut. Both are sealed
  // inside the SOLID sector of the cone -- the sweep runs the long way round, so anything at
  // CUT_START + a fraction of a radian is buried in rock -- and nothing can ever see them
  // from any angle a student can stand at. Built as solids they contributed exactly one
  // visible thing, which was two of them coming out through the flank as orange spikes.

  // --- the crater floor and its lava lake -------------------------------------
  put(glow, lathed(closed([[craterRadius * 0.66, 0], [craterRadius * 0.6, 0.6]]), {
    segments: 34, start: CUT_START, sweep: CUT_SWEEP,
  }), 0xffffff, [0, rimY - 10.1, 0], null, {
    keepColor: true,
    tint: (p) => {
      // A lava lake is a dark crust with incandescent cracks between the plates. Painted
      // uniformly bright it reads as a bowl of orange paint.
      const n = smoothNoise3(p.x * 0.34, 0, p.z * 0.34);
      const crack = Math.abs(((n * 6) % 1) - 0.5) < 0.11;
      const c = new THREE.Color(crack ? LAVA.core : LAVA.crustWarm);
      return [c.r, c.g, c.b];
    },
  });

  // Spatter and a fume-stained rim.
  for (let i = 0; i < 14; i++) {
    const a = CUT_START + rng() * CUT_SWEEP;
    const r = craterRadius * randomIn(rng, 0.72, 1.02);
    spike(rock, ROCK.scoria, {
      length: randomIn(rng, 1.4, 3.2), radius: randomIn(rng, 0.5, 1.0),
      at: [Math.sin(a) * r, rimY - randomIn(rng, 1.2, 4.4), Math.cos(a) * r], sides: 6,
    });
  }

  return group(
    mesh(mergeParts(rock), standard({
      vertexColors: true, roughness: 0.95, metalness: 0.03,
      ...relief('stone', { seed, repeat: 22, strength: 1.0 }),
    })),
    // The section, on its own mesh because it is the one surface here painted by a MAP
    // rather than by vertex colours -- and a material cannot carry both without multiplying
    // them together, which is the trap this project has recorded since the bear dens.
    mesh(mergeParts(faces), standard({
      map: sectionMaps.map,
      emissive: 0xffffff,
      emissiveMap: sectionMaps.emissiveMap,
      emissiveIntensity: 1.0,
      roughness: 0.95,
      metalness: 0.0,
    })),
    // The glowing half. `emissive` is a flat material colour and vertexColors does NOT
    // multiply it, so the emissive is a mid orange and the per-vertex colour carries the
    // range from crust to core -- white emissive here would bleach every one of them to the
    // same cream, which is the Seattle Chihuly trap.
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.62, metalness: 0.0,
      emissive: 0xff5a12, emissiveIntensity: 0.95,
    })),
  );
}

// The ash and steam column. Additive quads with `fog: false`, all leaning the same way --
// the Under the Sea light-shaft rules, because a plume has exactly the same failure modes.
export function ashPlume({ seed = 9, height = 120, radius = 16, puffs = 34 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < puffs; i++) {
    const t = i / puffs;
    const y = Math.pow(t, 0.78) * height;
    const spread = radius * (0.25 + t * 1.9);
    const lean = t * t * 22;
    const r = ball(spread * randomIn(rng, 0.42, 0.72), 9);
    r.scale(1, randomIn(rng, 0.7, 0.95), 1);
    const c = new THREE.Color(STEAM.plume).lerp(new THREE.Color(STEAM.plumePale), t * 0.8);
    put(parts, r, c.getHex(), [
      randomIn(rng, -spread, spread) * 0.5 + lean,
      y,
      randomIn(rng, -spread, spread) * 0.5,
    ]);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 1, metalness: 0,
    transparent: true, opacity: 0.42, depthWrite: false,
  })));
}

// A COOLING-CONTRACTION CRACK NETWORK, painted as an EMISSIVE MAP.
//
// A lava flow is a dark crust with incandescent cracks in it, and the cracks are the whole
// reason it reads as molten. They cannot be a vertex tint: `emissive` is a flat material
// colour and `vertexColors` does not multiply it (measured on Seattle's Chihuly glass), so a
// tinted crack is painted orange and then lit like any other rock -- which is exactly how
// the first pass rendered, as a dark flow with slightly orange patches. An emissiveMap DOES
// multiply the emissive colour, per texel, so it can light the cracks and leave the plates
// between them completely alone. It is also the only version of this that costs nothing:
// cracks as geometry would be hundreds of solids per flow.
//
// The pattern is Worley F2-F1 on a JITTERED GRID -- the distance between the two nearest
// sites, which is near zero exactly on a cell boundary. That is not a stylistic choice
// either: a crust cracks into polygons because it is contracting as it cools, and the
// boundaries of a random point set are what those polygons are. Only the 3x3 neighbouring
// cells are searched and the indices wrap, so it is fast and it tiles.
//
// THE COOLING GRADIENT IS BAKED INTO THE TEXTURE, along v, because a flow is hottest where
// it left the vent and nearly black at the toe -- and with one flat `emissive` there is no
// other place to put that. It is what stops the far end of a 60ft flow glowing as brightly
// as the crater it came out of.
function crackTexture(seed, {
  size = 384, gu = 9, gv = 16, width = 0.062, fade = true, hot = 1,
} = {}) {
  const rng = seededRandom(seed * 41 + 5);
  const sites = [];
  for (let i = 0; i < gu; i++) {
    sites.push([]);
    for (let j = 0; j < gv; j++) {
      sites[i].push([(i + randomIn(rng, 0.2, 0.8)) / gu, (j + randomIn(rng, 0.2, 0.8)) / gv]);
    }
  }
  const t = canvasTexture(size, size, (ctx) => {
    const img = ctx.createImageData(size, size);
    const px = img.data;
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const ci = Math.floor(u * gu);
        const cj = Math.floor(v * gv);
        let d1 = 9; let d2 = 9;
        for (let oi = -1; oi <= 1; oi++) {
          for (let oj = -1; oj <= 1; oj++) {
            const si = ((ci + oi) % gu + gu) % gu;
            const sj = ((cj + oj) % gv + gv) % gv;
            const s = sites[si][sj];
            // Wrapped separation, so a site one tile over is measured across the seam.
            let dx = s[0] - u; if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
            let dy = s[1] - v; if (dy > 0.5) dy -= 1; if (dy < -0.5) dy += 1;
            const d = Math.hypot(dx * gu, dy * gv);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
          }
        }
        // A crack is a NARROW cut, so the falloff is a smoothstep on the edge distance, not
        // the raw field -- fed in raw the whole plate glows and the flow reads as orange.
        let k = 1 - THREE.MathUtils.smoothstep(d2 - d1, 0, width);
        k *= k;
        if (fade) k *= Math.pow(1 - v, 1.6) * 0.92 + 0.08;
        const c = Math.round(255 * THREE.MathUtils.clamp(k * hot, 0, 1));
        const o = (y * size + x) * 4;
        px[o] = c; px[o + 1] = Math.round(c * 0.52); px[o + 2] = Math.round(c * 0.16); px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A lava flow running down a slope: a ropy crust with glowing cracks, an incandescent
// channel down the middle, and a bulbous toe. ONE ribbon rather than a chain of blobs -- a
// flow is continuous, and a row of separate lumps reads as spilled paint.
//
// PAHOEHOE ROPES ARE WHAT MAKE IT LOOK LIKE LAVA rather than like a dark tube. The skin
// chills first and is then dragged forward by the fluid underneath, so it wrinkles into
// transverse arcs that bow DOWNSTREAM at the middle and lag at the levees. That is one term
// in the surface function -- a displacement of a surface cannot open a gap in it -- and it
// costs nothing but the samples it needs to escape Nyquist.
export function lavaFlow({
  seed = 13, length = 60, width = 7, drop = 26, seg = 26, curve = 0.92,
} = {}) {
  const rng = seededRandom(seed);
  const crust = [];
  const glow = [];
  // `curve` is the exponent of the fall against the horizontal run, and 0.92 is measured off
  // the cone rather than chosen: solving the flank's own profile for the half-way point of a
  // flow from 33ft down to the apron gives 0.908. The first pass used 1.25, which falls
  // SLOWEST at the start -- exactly where a stratovolcano falls fastest -- so every flow left
  // the flank within a few feet and arched over the mountain like a flying buttress.
  const path = (t) => [
    Math.sin(t * 3.1) * width * 0.9 + Math.sin(t * 7.3) * width * 0.3,
    -Math.pow(t, curve) * drop,
    t * length,
  ];
  const ropes = Math.max(6, Math.round(length / 3.4));
  put(crust, solidSurface({
    nu: 22, nv: seg * 4, closedU: true,
    point: (u, v) => {
      const [cx, cy, cz] = path(v);
      const w = width * (0.55 + Math.sin(v * Math.PI) * 0.55) * (1 + Math.sin(v * 9.1) * 0.08);
      const a = u * Math.PI * 2;
      // The arc bows downstream where the flow is fastest -- its middle -- and lags at the
      // edges, which is the direction a real rope wrinkle curves. Only on the upper half:
      // the underside of a flow is smooth, it was never a skin.
      const upper = Math.max(0, Math.sin(a));
      const rope = Math.sin((v * ropes + Math.cos(a) * 0.22) * Math.PI * 2) * 0.085 * w * upper;
      const rr = w + rope;
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * (w * 0.3 + rope) + w * 0.30, cz];
    },
    thick: () => 0.22,
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const cool = THREE.MathUtils.clamp(p.z / length, 0, 1);
      const n = smoothNoise3(p.x * 0.22, p.y * 0.22, p.z * 0.12);
      const c = new THREE.Color(LAVA.crustWarm).lerp(new THREE.Color(LAVA.crust), cool * 0.85)
        .multiplyScalar(0.82 + n * 0.36);
      return [c.r, c.g, c.b];
    },
  });
  // The incandescent channel down the middle, and a glowing toe where it is still advancing.
  const chan = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const [cx, cy, cz] = path(t);
    chan.push([cx, cy + width * 0.34, cz]);
  }
  put(glow, tube(chan, [width * 0.26, width * 0.3, width * 0.12], { sides: 10, tubular: 60 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const cool = THREE.MathUtils.clamp(p.z / length, 0, 1);
      const c = new THREE.Color(LAVA.white).lerp(new THREE.Color(LAVA.cool), cool * 0.9);
      return [c.r, c.g, c.b];
    },
  });
  for (let i = 0; i < 9; i++) {
    const t = randomIn(rng, 0.05, 0.95);
    const [cx, cy, cz] = path(t);
    dome(glow, LAVA.hot, {
      radius: randomIn(rng, 0.5, 1.2), height: randomIn(rng, 0.3, 0.7),
      at: [cx + randomIn(rng, -width, width) * 0.5, cy + width * 0.5, cz], detail: 8,
    });
  }
  const cracks = crackTexture(seed, { gu: 11, gv: Math.max(12, Math.round(length / 2.2)) });
  return group(
    mesh(mergeParts(crust), standard({
      vertexColors: true, roughness: 0.9, metalness: 0.02,
      emissive: 0xffffff, emissiveMap: cracks, emissiveIntensity: 0.95,
      ...relief('stone', { seed, repeat: 12, strength: 0.9 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.5, emissive: 0xff6a16, emissiveIntensity: 1.25,
    })),
  );
}

// A CRATER LAVA LAKE: a crusted pond that the plates are visibly being pulled apart on, with
// spatter cones round the rim where the gas is getting out. The crater was the one part of
// this world with nothing molten actually IN it -- a fountain plays above a hole -- and a
// lake is what a student expects to be looking down into.
export function lavaLake({ seed = 61, radius = 12, seg = 46 } = {}) {
  const rng = seededRandom(seed);
  const crust = [];
  const glow = [];
  // The surface is a shallow dish, so from the crater rim you look across it rather than at
  // its edge -- flat, it disappears the moment your eye drops to grazing.
  put(crust, solidSurface({
    nu: seg, nv: 9, closedU: true,
    point: (u, v) => {
      const a = u * Math.PI * 2;
      const r = radius * v;
      const sag = -0.5 + Math.cos(v * Math.PI * 0.5) * 0.5;
      const ripple = smoothNoise3(Math.cos(a) * r * 0.24, 0, Math.sin(a) * r * 0.24) * 0.5;
      return [Math.cos(a) * r, sag * 1.4 + ripple, Math.sin(a) * r];
    },
    thick: () => 0.3,
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // Hotter toward the middle, where the crust is thinnest and youngest.
      const k = THREE.MathUtils.clamp(1 - Math.hypot(p.x, p.z) / radius, 0, 1);
      const c = new THREE.Color(LAVA.crust).lerp(new THREE.Color(LAVA.crustWarm), k * 0.9);
      return [c.r, c.g, c.b];
    },
  });
  // Spatter cones and a few incandescent upwellings.
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * randomIn(rng, 0.3, 0.86);
    const h = randomIn(rng, 0.7, 2.1);
    put(crust, lathed(closed([
      [h * 0.95, 0], [h * 0.66, h * 0.5], [h * 0.34, h], [h * 0.24, h * 1.15],
    ]), { segments: 14 }), ROCK.emberRock, [Math.cos(a) * r, 0, Math.sin(a) * r]);
    dome(glow, LAVA.core, {
      radius: h * 0.26, height: h * 0.2, at: [Math.cos(a) * r, h * 1.1, Math.sin(a) * r], detail: 8,
    });
  }
  const cracks = crackTexture(seed, { gu: 13, gv: 13, width: 0.15, fade: false });
  return group(
    mesh(mergeParts(crust), standard({
      vertexColors: true, roughness: 0.88, metalness: 0.02,
      emissive: 0xffffff, emissiveMap: cracks, emissiveIntensity: 1.5,
      ...relief('stone', { seed, repeat: 8, strength: 0.8 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.45, emissive: 0xff8228, emissiveIntensity: 1.5,
    })),
  );
}

// A PAHOEHOE SHEET at ground level, which is the only lava in this world a student can walk
// right up to. Everything else is 30 to 90ft up the cone, and a flow read from that distance
// is a shape rather than a surface -- the ropes, the crack network and the glow between the
// plates are all detail that only pays at arm's length.
export function pahoehoeField({ seed = 63, radius = 15, toes = 9 } = {}) {
  const rng = seededRandom(seed);
  const crust = [];
  const glow = [];
  const lobes = [];
  for (let i = 0; i < 7; i++) {
    lobes.push([rng() * Math.PI * 2, randomIn(rng, 0.35, 0.95), randomIn(rng, 0.45, 0.85)]);
  }
  // The outline is a sum of lobes rather than a circle: a sheet flow advances as a cluster
  // of toes budding off one another, so a clean disc of it reads as a puddle of tarmac.
  const edge = (a) => {
    let r = 0.6;
    for (const [pa, pr, pw] of lobes) {
      let d = Math.abs(((a - pa + Math.PI) % (Math.PI * 2)) - Math.PI);
      r += pr * Math.exp(-(d * d) / (2 * pw * pw));
    }
    return radius * THREE.MathUtils.clamp(r / 1.9, 0.28, 1);
  };
  const ropes = 9;
  put(crust, solidSurface({
    nu: 64, nv: 12, closedU: true,
    point: (u, v) => {
      const a = u * Math.PI * 2;
      const r = edge(a) * v;
      const rope = Math.sin((r * 0.5 + Math.cos(a * 3) * 0.3) * Math.PI * 2 * ropes / radius) * 0.14;
      const swell = Math.cos(v * Math.PI * 0.5) * 0.55;
      return [Math.cos(a) * r, swell + rope + 0.25, Math.sin(a) * r];
    },
    thick: () => 0.26,
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const n = smoothNoise3(p.x * 0.3 + seed, p.y, p.z * 0.3);
      const c = new THREE.Color(LAVA.crust).lerp(new THREE.Color(LAVA.crustWarm), n * 0.8);
      return [c.r, c.g, c.b];
    },
  });
  // Budding toes round the margin, each with a glowing split -- a toe inflates until its
  // skin tears, which is where the light gets out.
  for (let i = 0; i < toes; i++) {
    const a = rng() * Math.PI * 2;
    const r = edge(a) * randomIn(rng, 0.86, 1.02);
    const s = randomIn(rng, 0.7, 1.5);
    const g = boulder(s, seed + i * 11, { rough: 0.16, flatten: 0.5, detail: 16, facets: 6, angular: 0.15 });
    put(crust, g, LAVA.crustWarm, [Math.cos(a) * r, s * 0.28, Math.sin(a) * r]);
    dome(glow, LAVA.hot, {
      radius: s * 0.34, height: s * 0.12,
      at: [Math.cos(a) * r * 1.02, s * 0.42, Math.sin(a) * r * 1.02], detail: 8, sink: 0.55,
    });
  }
  const cracks = crackTexture(seed, { gu: 15, gv: 15, width: 0.13, fade: false, hot: 0.85 });
  return group(
    mesh(mergeParts(crust), standard({
      vertexColors: true, roughness: 0.9, metalness: 0.02,
      emissive: 0xffffff, emissiveMap: cracks, emissiveIntensity: 1.05,
      ...relief('stone', { seed, repeat: 10, strength: 0.9 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.5, emissive: 0xff6e18, emissiveIntensity: 1.3,
    })),
  );
}

// A lava fountain: a jet of incandescent clots, which is what a Hawaiian eruption actually
// throws. The clots GROW as they rise and fade as they fall, so the fountain has a shape
// rather than being a column of identical beads.
export function lavaFountain({ seed = 17, height = 26, clots = 26, spread = 5 } = {}) {
  const rng = seededRandom(seed);
  const glow = [];
  const rock = [];
  put(rock, lathed(closed([[spread + 3.4, 0], [spread + 2.2, 1.1], [spread * 0.8, 1.8]]), { segments: 24 }),
    ROCK.scoria);
  for (let i = 0; i < clots; i++) {
    const t = rng();
    const y = Math.sin(t * Math.PI) * height * randomIn(rng, 0.55, 1);
    const out = spread * t * randomIn(rng, 0.4, 1.3);
    const a = rng() * Math.PI * 2;
    const r = ball(randomIn(rng, 0.5, 1.5) * (1 - t * 0.35), 9);
    r.scale(1, randomIn(rng, 1.1, 1.7), 1);
    const c = new THREE.Color(LAVA.white).lerp(new THREE.Color(LAVA.cool), t * 0.85);
    put(glow, r, c.getHex(), [Math.cos(a) * out, y + 1.4, Math.sin(a) * out]);
  }
  return group(
    mesh(mergeParts(rock), standard({
      vertexColors: true, roughness: 0.95, ...relief('stone', { seed, repeat: 8, strength: 0.8 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.45, emissive: 0xff7a22, emissiveIntensity: 1.35,
    })),
  );
}

// A fumarole: a steam vent with sulphur staining round it. Cheap, and three of them are what
// make the ground read as still hot.
export function fumarole({ seed = 19, height = 14, radius = 3 } = {}) {
  const rng = seededRandom(seed);
  const rock = [];
  const steam = [];
  put(rock, lathed(closed([
    [radius + 1.6, 0], [radius + 1.1, 0.7], [radius * 0.7, 1.4], [radius * 0.55, 1.9],
  ]), { segments: 22 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const c = new THREE.Color(ROCK.tuff).lerp(new THREE.Color(STEAM.sulphur),
        THREE.MathUtils.clamp(1.4 - Math.hypot(p.x, p.z) / radius, 0, 0.75));
      return [c.r, c.g, c.b];
    },
  });
  for (let i = 0; i < 12; i++) {
    const t = i / 12;
    const g = ball(radius * (0.35 + t * 1.1) * randomIn(rng, 0.6, 1), 8);
    put(steam, g, STEAM.plumePale, [
      randomIn(rng, -1, 1) * t * radius + t * t * 4, 1.8 + Math.pow(t, 0.8) * height, randomIn(rng, -1, 1) * t * radius,
    ]);
  }
  return group(
    mesh(mergeParts(rock), standard({
      vertexColors: true, roughness: 0.96, ...relief('stone', { seed, repeat: 6, strength: 0.9 }),
    })),
    mesh(mergeParts(steam), standard({
      color: STEAM.plumePale, roughness: 1, transparent: true, opacity: 0.3, depthWrite: false,
    })),
  );
}

// ---------------------------------------------------------------------------
// THE ROCK CYCLE
// ---------------------------------------------------------------------------

// A hand specimen big enough to walk round. Twelve of them, and the whole design problem is
// that a rock is not a shape -- basalt and marble are the same lump. WHAT IDENTIFIES A ROCK
// IS ITS TEXTURE AND ITS STRUCTURE: columnar jointing, conchoidal fracture, vesicles,
// bedding, banding, foliation, a speckle of three minerals. So every kind here gets one
// structural treatment on a shared boulder, and that treatment is the exhibit.
//
// A boulder, and the whole problem is that A ROCK IS NOT A LUMPY SPHERE. The first pass here
// displaced a sphere by smooth noise, which produces a potato: convex in every direction,
// roughly the same size along every axis, and without one flat face or one sharp edge
// anywhere on it. What makes stone read as stone is that IT BROKE. So it carries planar
// fracture faces meeting at arrises, and the mass either side of them is lopsided.
//
// Both come out of a single RADIAL displacement, which is the constraint that governs
// everything here: a shared corner has to move identically from every triangle that owns it
// or the surface tears into loose shards -- the puddingstone outcrops and the reef rocks
// both learned that, and a per-vertex-index jitter is the way to re-earn it.
//
//  * FRACTURE is the SUPPORT FUNCTION of a convex polyhedron. The distance to a set of
//    cutting planes along a direction d is min(h_i / (d . n_i)) over the planes facing that
//    way -- a pure function of DIRECTION, so evaluating it per vertex cuts genuine flats
//    into the sphere with no CSG anywhere and no risk of tearing.
//  * MASS is a low-frequency lobe field plus a per-rock anisotropic scale, because a rock
//    that is 1.2 long, 0.85 wide and 0.95 tall has stopped reading as a ball before any
//    surface detail is applied at all. This is the half that fixes "too symmetrical".
//  * WEATHERING is the original two-octave noise, kept, riding on top of both.
//
// `toCreasedNormals` is what makes it worth doing. It welds normals only where neighbouring
// faces are near coplanar, so the fracture flats stay flat, the arrises stay sharp, and the
// weathered curve between them stays smooth. The alternative -- flat-shading the lot with
// `toNonIndexed` + `computeVertexNormals` -- shows the sphere's own latitude tessellation
// across every rounded part, which is the low-poly look this is trying to get away from.
//
// CREASE IS IN DEGREES AND IS BOUNDED BELOW BY THE TESSELLATION. At `detail` d a smooth
// sphere already turns 360/d per step, so a crease angle under that welds nothing and the
// whole rock flat-shades. 26 degrees is comfortably above the ~16 a detail-22 sphere runs at
// and comfortably below the 40-plus an arris makes.
function boulder(size, seed, {
  rough = 0.22, flatten = 1, detail = 22, angular = 0.62, facets = 9, crease = 26,
} = {}) {
  const rng = seededRandom(Math.round(seed * 97) + 11);

  // The cutting planes. Normals come off a golden-angle spiral WITH jitter rather than being
  // drawn freely: nine free directions reliably leave one whole flank uncut, and an uncut
  // flank is a bare piece of the original sphere -- the exact thing being removed here.
  const planes = [];
  for (let i = 0; i < facets; i++) {
    const yy = 1 - ((i + 0.5) / facets) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = i * 2.399963229728653;
    const n = new THREE.Vector3(
      Math.cos(a) * rr + (rng() - 0.5) * 0.6,
      yy + (rng() - 0.5) * 0.6,
      Math.sin(a) * rr + (rng() - 0.5) * 0.6,
    ).normalize();
    // The SPREAD of offsets is what varies the face sizes. Every plane at one distance gives
    // a regular solid, which is a crystal: it reads as manufactured, not as broken.
    planes.push({ n, h: randomIn(rng, 0.64, 1.04) });
  }

  // The mass, kept near mean 1 so a caller's `size` still means what it says -- specimens are
  // placed at S*0.85 above a plinth top, and an inflated rock hangs off the front of it.
  const sx = randomIn(rng, 0.82, 1.2);
  const sy = randomIn(rng, 0.8, 1.16);
  const sz = randomIn(rng, 0.82, 1.2);
  const lobeSeed = rng() * 40;

  // The displacement, as a pure function of DIRECTION, so it can be evaluated both by the
  // loop below and afterwards by whatever has to be laid ON the finished rock. Placing a
  // vesicle or a pebble at a guessed fraction of `size` is the trap RobotProps' `onShell`
  // exists for: near a surface that is no longer a sphere, a hand-picked radius is either
  // floating clear of the rock or sealed inside it, the two failures look nothing alike,
  // and hunting each one separately is the whole afternoon.
  const surfaceAt = (dir) => {
    const d = dir.clone().normalize();
    let poly = 1.5;
    for (const pl of planes) {
      const dot = d.dot(pl.n);
      if (dot > 1e-3) poly = Math.min(poly, pl.h / dot);
    }
    const lobe = 1 + (smoothNoise3(d.x * 1.15 + lobeSeed, d.y * 1.15, d.z * 1.15) - 0.5) * 0.44;
    const n = smoothNoise3(d.x * 2.6 + seed, d.y * 2.6, d.z * 2.6)
      + smoothNoise3(d.x * 6.4 + seed, d.y * 6.4, d.z * 6.4) * 0.4;
    const wear = 1 + (n - 0.7) * rough;
    // The 1.08 is the cutting's own shrinkage handed back: nine planes at a mean offset of
    // 0.84 take a sphere down to about that, and a specimen sized in feet by its caller
    // should not quietly come out a sixth smaller than asked for.
    const r = size * lobe * wear * (1 - angular + angular * poly) * 1.08;
    return new THREE.Vector3(d.x * r * sx, d.y * r * sy * flatten, d.z * r * sz);
  };

  const g = ball(size, detail);
  const pos = g.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const p = surfaceAt(d);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  const out = toCreasedNormals(g, (crease * Math.PI) / 180);
  out.userData.surfaceAt = surfaceAt;
  return out;
}

// A hexagonal column, which is what basalt does when a thick flow cools slowly and evenly.
function hexColumn(radius, height, twist = 0) {
  const g = extrudeOutline(ringPts(radius, 6, { start: twist }), height);
  return laid(g, 0, -Math.PI / 2);
}

// A near-WHITE grain map, multiplied over each specimen's vertex hue.
//
// This is the flower-bed trick, used deliberately where this file otherwise warns against
// it: a material carrying BOTH a `map` and `vertexColors` multiplies the two, so a map that
// has no colour of its own carries texture at a scale vertices cannot reach while the vertex
// tint goes on carrying the rock's hue and its large-scale structure.
//
// THAT VERTICES CANNOT REACH IT IS THE WHOLE ARGUMENT. At detail 46 a 2.4ft specimen samples
// every 0.16ft and granite's crystals are an inch across; pushing the tint frequency up to
// meet them is the Nyquist trap this project has now hit six times -- under two samples per
// cycle it does not produce crystals, it produces BLUR, which is exactly how the first pass
// rendered. A texel is a hundredth of that spacing.
//
// The dots are drawn NINE TIMES, wrapped by +/- one tile in both axes, because a rock is a
// closed surface and a map with a visible seam draws a straight line down a boulder.
const GRAIN = {
  // dots: fine grain, drawn small and low-contrast. blot: a second, much coarser and much
  // fainter pass -- rock is never evenly speckled, and without it the fine pass alone reads
  // as sandpaper. aniso stretches BOTH passes along one axis, which is the whole difference
  // between a sandstone's bedding grain, a schist's foliation and a granite's even speckle.
  basalt: { dots: 2600, r: [0.7, 1.7], dark: 0.42, light: 0.06, blot: 60, blotR: [8, 22], blotK: 0.1, aniso: 1 },
  obsidian: { dots: 500, r: [1, 3], dark: 0.1, light: 0.14, blot: 40, blotR: [10, 30], blotK: 0.07, aniso: 1 },
  pumice: { dots: 3400, r: [0.9, 2.2], dark: 0.5, light: 0.1, blot: 80, blotR: [6, 18], blotK: 0.12, aniso: 1 },
  granite: { dots: 3000, r: [1.1, 3.0], dark: 0.4, light: 0.34, blot: 46, blotR: [10, 26], blotK: 0.09, aniso: 1 },
  sandstone: { dots: 4200, r: [0.6, 1.4], dark: 0.22, light: 0.18, blot: 40, blotR: [7, 20], blotK: 0.1, aniso: 2.4 },
  limestone: { dots: 1800, r: [0.8, 2.0], dark: 0.16, light: 0.16, blot: 44, blotR: [10, 28], blotK: 0.1, aniso: 1.5 },
  shale: { dots: 2400, r: [0.7, 1.7], dark: 0.26, light: 0.12, blot: 54, blotR: [8, 22], blotK: 0.11, aniso: 4 },
  conglomerate: { dots: 1500, r: [0.8, 2.0], dark: 0.22, light: 0.16, blot: 34, blotR: [9, 24], blotK: 0.09, aniso: 1 },
  gneiss: { dots: 2200, r: [0.9, 2.2], dark: 0.3, light: 0.24, blot: 46, blotR: [8, 22], blotK: 0.11, aniso: 3.2 },
  marble: { dots: 1100, r: [0.8, 2.2], dark: 0.1, light: 0.16, blot: 30, blotR: [12, 32], blotK: 0.07, aniso: 2 },
  slate: { dots: 2000, r: [0.7, 1.7], dark: 0.2, light: 0.14, blot: 44, blotR: [8, 22], blotK: 0.09, aniso: 3.6 },
  schist: { dots: 2000, r: [0.9, 2.2], dark: 0.28, light: 0.5, blot: 44, blotR: [8, 20], blotK: 0.1, aniso: 3 },
};

function grainTexture(kind, seed, size = 384) {
  const g = GRAIN[kind] || GRAIN.granite;
  const rng = seededRandom(seed * 17 + 3);
  const k = size / 256;
  const t = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = '#eceae5';
    ctx.fillRect(0, 0, size, size);
    // The dots are drawn NINE TIMES, wrapped by +/- one tile in both axes, because a rock is
    // a closed surface and a map with a visible seam draws a straight line down a boulder.
    const blob = (x, y, rr, aniso, fill) => {
      ctx.fillStyle = fill;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          ctx.beginPath();
          ctx.ellipse(x + ox * size, y + oy * size, rr * aniso, rr, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    for (let i = 0; i < g.blot; i++) {
      const up = rng() < 0.5;
      const a = g.blotK * randomIn(rng, 0.4, 1);
      blob(rng() * size, rng() * size, randomIn(rng, g.blotR[0], g.blotR[1]) * k, g.aniso,
        up ? `rgba(255,255,255,${a.toFixed(3)})` : `rgba(74,66,58,${a.toFixed(3)})`);
    }
    for (let i = 0; i < g.dots; i++) {
      const up = rng() < 0.45;
      const amt = (up ? g.light : g.dark) * randomIn(rng, 0.3, 1);
      blob(rng() * size, rng() * size, randomIn(rng, g.r[0], g.r[1]) * k, g.aniso,
        up ? `rgba(255,255,255,${amt.toFixed(3)})` : `rgba(58,50,44,${amt.toFixed(3)})`);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2);
  return t;
}

const ROCK_CLASS = {
  basalt: 'igneous', obsidian: 'igneous', pumice: 'igneous', granite: 'igneous',
  sandstone: 'sedimentary', limestone: 'sedimentary', shale: 'sedimentary', conglomerate: 'sedimentary',
  gneiss: 'metamorphic', marble: 'metamorphic', slate: 'metamorphic', schist: 'metamorphic',
};

export const ROCK_CLASS_ACCENT = {
  igneous: '#e0455f', sedimentary: '#f2a541', metamorphic: '#8a5cf5',
};

export function rockSpecimen({ seed = 3, kind = 'granite', size = 2.6 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const shine = [];
  const S = size;

  // A banding tint shared by every foliated and bedded rock. The BAND DIRECTION is the
  // identification: bedding is flat and undisturbed, foliation is tilted and contorted, so
  // the same function with a different normal tells two different geological stories.
  const banded = (a, b, dir, freq, wobble = 0) => (p) => {
    const t = (p.x * dir[0] + p.y * dir[1] + p.z * dir[2]) * freq
      + (wobble ? smoothNoise3(p.x * 0.5, p.y * 0.5, p.z * 0.5) * wobble : 0);
    const c = new THREE.Color(Math.abs((t % 1) - 0.5) < 0.25 ? a : b);
    return [c.r, c.g, c.b];
  };

  if (kind === 'basalt') {
    // COLUMNAR JOINTING, and it is the whole specimen. Basalt as a plain dark lump is
    // indistinguishable from a dozen other rocks; a bundle of hexagons is unmistakable.
    // A COLUMN IS ONLY A COLUMN IF YOU CAN SEE ITS TOP. Ten identical near-black prisms read
    // as a stack of cards; what says "hexagonal jointing" is the polygonal top faces at
    // several different heights, so the heights spread wider than instinct suggests and each
    // column takes its own tone -- a cooling unit's columns weather at different rates.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng() * 0.3;
      const rr = i === 0 ? 0 : S * randomIn(rng, 0.3, 0.66);
      const w = S * randomIn(rng, 0.22, 0.33);
      const h = S * randomIn(rng, 0.75, 1.9);
      const k = randomIn(rng, 0.86, 1.55);
      const c = new THREE.Color(rng() < 0.25 ? ROCK.basaltWarm : ROCK.basalt).multiplyScalar(k);
      put(parts, hexColumn(w, h, rng() * 1.0), c.getHex(),
        [Math.cos(a) * rr, h / 2, Math.sin(a) * rr], [randomIn(rng, -0.06, 0.06), 0, randomIn(rng, -0.06, 0.06)]);
    }
  } else if (kind === 'obsidian') {
    // CONCHOIDAL FRACTURE: volcanic glass breaks in curved shell-shaped scoops with knife
    // edges, so this is the one specimen that is deliberately faceted -- and the only one
    // with a glossy material, because obsidian IS glass.
    const g = ball(S, 10, 6);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const k = 0.72 + smoothNoise3(x * 1.1 + seed, y * 1.1, z * 1.1) * 0.6;
      pos.setXYZ(i, x * k, y * k * 0.9, z * k);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    put(shine, g, ROCK.obsidian, [0, S * 0.82, 0]);
    for (let i = 0; i < 8; i++) {
      const a = rng() * Math.PI * 2;
      dome(shine, ROCK.obsidianSheen, {
        radius: S * randomIn(rng, 0.3, 0.55), height: S * 0.12,
        at: [Math.cos(a) * S * 0.62, S * randomIn(rng, 0.4, 1.3), Math.sin(a) * S * 0.62],
        rot: [randomIn(rng, -1, 1), a, randomIn(rng, -1, 1)], detail: 12, sink: 0.74,
      });
    }
  } else if (kind === 'pumice') {
    // VESICLES -- the gas bubbles that make it float. Sunk dark domes rather than real
    // holes: there is no CSG here, and a closed dome sunk into a surface cannot leave a gap
    // the way a partial sphere would.
    const rock = boulder(S, seed, { rough: 0.3, flatten: 0.86, detail: 46, facets: 13 });
    put(parts, rock, ROCK.pumice, [0, S * 0.8, 0]);
    for (let i = 0; i < 60; i++) {
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const at = rock.userData.surfaceAt(dir);
      dome(parts, ROCK.pumiceDeep, {
        radius: S * randomIn(rng, 0.05, 0.14), height: S * 0.05,
        at: [at.x, at.y + S * 0.8, at.z],
        rot: [Math.atan2(dir.z, dir.y), 0, -Math.atan2(dir.x, dir.y)], detail: 7, sink: 0.9,
      });
    }
  } else if (kind === 'granite') {
    // A SPECKLE OF THREE MINERALS -- pink feldspar, glassy quartz, black mica -- coarse
    // enough to see with the naked eye, which is exactly what "coarse-grained" means and
    // what tells a student it cooled slowly, deep down.
    put(parts, boulder(S, seed, { rough: 0.18, detail: 46, facets: 13 }), 0xffffff, [0, S * 0.85, 0], null, {
      keepColor: true,
      // The frequencies are bounded by the VERTEX spacing, not by how coarse granite is: at
      // detail 46 a 2.4ft specimen samples every 0.16ft, so anything above about 1.5 cycles
      // per foot aliases into blur. The inch-scale crystals come from the grain map instead.
      tint: (p) => {
        const n = smoothNoise3(p.x * 1.35 + seed, p.y * 1.35, p.z * 1.35);
        const m = smoothNoise3(p.x * 2.5, p.y * 2.5 + seed, p.z * 2.5);
        const c = new THREE.Color(
          m > 0.72 ? ROCK.graniteMica : n > 0.58 ? ROCK.graniteFeldspar
            : n < 0.4 ? ROCK.graniteQuartz : ROCK.granite,
        );
        return [c.r, c.g, c.b];
      },
    });
  } else if (kind === 'sandstone') {
    // BEDDING: flat, parallel, undisturbed. Built as real stacked slabs rather than as a
    // tint, because a sedimentary rock's layers are also its weakness -- the beds stand
    // slightly proud of one another where the softer ones have weathered back.
    let y = 0;
    for (let i = 0; i < 7; i++) {
      const h = S * randomIn(rng, 0.16, 0.34);
      const w = S * randomIn(rng, 0.86, 1.05);
      put(parts, boulder(1, seed + i, { rough: 0.12, flatten: 0.28, detail: 26, facets: 7, angular: 0.5 }),
        i % 2 ? ROCK.sandstone : ROCK.sandstoneBand,
        [randomIn(rng, -0.07, 0.07) * S, y + h / 2, randomIn(rng, -0.07, 0.07) * S], null,
        { scale: [w, h * 3.6, w * 0.92] });
      y += h * 0.82;
    }
  } else if (kind === 'limestone') {
    const rockL = boulder(S, seed, { rough: 0.16, flatten: 0.92, detail: 46, facets: 12 });
    put(parts, rockL, 0xffffff, [0, S * 0.82, 0], null, {
      keepColor: true, tint: banded(ROCK.limestone, ROCK.limestoneShade, [0, 1, 0], 0.9, 0.6),
    });
    // A fossil, because that is what makes limestone limestone to a twelve-year-old: an
    // ammonite spiral pressed into the face. AN AMMONITE IS A SPIRAL OF RIBS, and the ribs
    // are what a student recognises -- drawn as twenty-two pale pinheads it read as a smudge.
    // The segments GROW along the spiral, alternate tone so each rib has a shadow line, and
    // sit on the rock's OWN front face rather than on a guessed radius.
    for (let i = 0; i < 30; i++) {
      const t = i / 29;
      const a = t * Math.PI * 3.6;
      const r = S * 0.07 + t * t * S * 0.52;
      const face = rockL.userData.surfaceAt(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.9, S));
      dome(parts, i % 2 ? ROCK.limestoneShade : ROCK.limestone, {
        radius: S * (0.055 + t * 0.14), height: S * 0.055,
        at: [Math.cos(a) * r, S * 0.82 + Math.sin(a) * r * 0.9, face.z * 0.99],
        rot: [Math.PI / 2, 0, 0], detail: 10, sink: 0.42,
      });
    }
  } else if (kind === 'shale') {
    // FISSILE: it splits into sheets you could almost read a book from.
    let y = 0;
    for (let i = 0; i < 18; i++) {
      const h = S * randomIn(rng, 0.05, 0.1);
      const w = S * randomIn(rng, 0.8, 1.06) * (1 - Math.abs(i / 18 - 0.4) * 0.35);
      put(parts, boulder(1, seed + i * 3, { rough: 0.1, flatten: 0.1, detail: 22, facets: 6, angular: 0.85 }),
        i % 3 ? ROCK.shale : ROCK.shaleBand,
        [randomIn(rng, -0.12, 0.12) * S, y + h / 2, randomIn(rng, -0.12, 0.12) * S],
        [randomIn(rng, -0.04, 0.04), rng() * 3, randomIn(rng, -0.04, 0.04)],
        { scale: [w, h * 5.4, w * 0.94] });
      y += h * 0.8;
    }
  } else if (kind === 'conglomerate') {
    // ROUNDED PEBBLES IN A MATRIX -- and rounded is the word doing the work: it says these
    // grains travelled in a river long enough to wear their corners off.
    const rock = boulder(S, seed, { rough: 0.2, detail: 46, facets: 12 });
    put(parts, rock, ROCK.conglomerateMatrix, [0, S * 0.85, 0]);
    // THE CLASTS ARE THE ROCK, so they are sized to be read from across the field rather
    // than sprinkled on: the first pass put thirty pebbles a tenth of the specimen wide on a
    // radius guessed at 0.92, which left most of them inside the matrix and the handful that
    // showed reading as spots. They now sit on the surface the rock actually has, SUNK to
    // three quarters of their own radius, which is what a clast in a matrix looks like -- a
    // pebble sitting fully proud reads as gravel glued to a boulder.
    const pebbleHues = [
      ROCK.tephra, ROCK.sandstone, ROCK.granite, ROCK.tuff, ROCK.ash,
      ROCK.gneiss, ROCK.schist, ROCK.basaltPale, ROCK.sandstoneBand,
    ];
    for (let i = 0; i < 54; i++) {
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const at = rock.userData.surfaceAt(dir);
      const pr = S * randomIn(rng, 0.13, 0.23);
      const g = boulder(pr, seed + 200 + i * 5, {
        rough: 0.14, flatten: randomIn(rng, 0.6, 0.88), detail: 14, facets: 6, angular: 0.18,
      });
      const sink = pr * randomIn(rng, 0.5, 0.78);
      const k = 1 - sink / at.length();
      put(parts, g, pebbleHues[Math.floor(rng() * pebbleHues.length)],
        [at.x * k, at.y * k + S * 0.85, at.z * k], [rng() * 3, rng() * 3, rng() * 3]);
    }
  } else if (kind === 'gneiss') {
    // CONTORTED BANDING. Gneiss is the rock that has been squeezed hardest, and the bands
    // being FOLDED rather than flat is the difference between it and a sandstone.
    put(parts, boulder(S, seed, { rough: 0.18, detail: 46, facets: 13 }), 0xffffff, [0, S * 0.85, 0], null, {
      keepColor: true,
      tint: (p) => {
        const t = (p.y * 1.5 + Math.sin(p.x * 1.1) * 0.9 + smoothNoise3(p.x, p.y, p.z) * 1.4);
        const k = Math.abs((t % 1) - 0.5);
        const c = new THREE.Color(k < 0.16 ? ROCK.gneissBand : k < 0.3 ? ROCK.gneissPink : ROCK.gneiss);
        return [c.r, c.g, c.b];
      },
    });
  } else if (kind === 'marble') {
    put(shine, boulder(S, seed, { rough: 0.14, detail: 46, facets: 11 }), 0xffffff, [0, S * 0.85, 0], null, {
      keepColor: true,
      tint: (p) => {
        const v = smoothNoise3(p.x * 0.9 + seed, p.y * 0.45, p.z * 0.9)
          + smoothNoise3(p.x * 2.1, p.y * 2.1, p.z * 2.1) * 0.3;
        // A vein is a NARROW dark line with a soft halo, not a band: fed straight in as a
        // threshold the pattern reads as camouflage, and at the width that looks safe on
        // paper it disappears under the grain map entirely.
        const e = Math.abs(((v * 2.4) % 1) - 0.5);
        const c = new THREE.Color(ROCK.marble).lerp(new THREE.Color(ROCK.marbleVein),
          THREE.MathUtils.clamp(1 - e / 0.17, 0, 1) * 0.9 + 0.05);
        return [c.r, c.g, c.b];
      },
    });
  } else if (kind === 'slate') {
    // ONE BIG CLEAVAGE FACE. Slate splits along a plane that has nothing to do with its
    // original bedding, which is why it roofs houses -- so the specimen is a stack of very
    // flat plates all tipped the same way.
    for (let i = 0; i < 11; i++) {
      const h = S * 0.07;
      put(parts, boulder(1, seed + i * 5, { rough: 0.08, flatten: 0.09, detail: 22, facets: 6, angular: 0.62 }),
        i % 2 ? ROCK.slate : ROCK.slateSheen,
        [i * S * 0.055, S * 0.16 + i * h * 0.92, i * S * 0.015], [0.04, 0.2, 0.27],
        { scale: [S * 0.95, h * 5.2, S * 0.8] });
    }
  } else if (kind === 'schist') {
    // FOLIATION PLUS MICA. The sparkle is the identification, and it is a scatter of tiny
    // bright plates lying in the foliation rather than a shiny material.
    const rock = boulder(S, seed, { rough: 0.2, flatten: 0.9, detail: 46, facets: 13 });
    put(parts, rock, 0xffffff, [0, S * 0.82, 0], null, {
      keepColor: true, tint: banded(ROCK.schist, ROCK.gneissBand, [0.25, 1, 0], 1.4, 0.8),
    });
    for (let i = 0; i < 44; i++) {
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const at = rock.userData.surfaceAt(dir);
      dome(shine, ROCK.schistMica, {
        radius: S * randomIn(rng, 0.06, 0.13), height: S * 0.02,
        at: [at.x, at.y + S * 0.82, at.z],
        rot: [Math.atan2(dir.z, dir.y), 0, -Math.atan2(dir.x, dir.y)], detail: 6, sink: 0.6,
      });
    }
  }

  const objects = [];
  // ONE grain texture per specimen, shared by both of its meshes and used as its own bump
  // map as well: the speckle and the roughness a rock has are the same thing seen two ways,
  // and a texture's dispose() is idempotent so two material slots pointing at one map is
  // safe. Fresh per call, never cached -- disposeObject3D destroys a removed object's map
  // outright, so a shared tile dies with whichever copy is removed first.
  const grain = grainTexture(kind, seed);
  if (parts.length) {
    objects.push(mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.93, metalness: 0.04,
      map: grain, bumpMap: grain, bumpScale: 0.5,
    })));
  }
  // Obsidian, marble and mica are the three specimens with a real sheen, and they get their
  // own material rather than a shared matte one -- lustre is a diagnostic property, so
  // flattening it would throw away part of what the exhibit teaches.
  if (shine.length) {
    objects.push(mesh(mergeParts(shine), standard({
      vertexColors: true, roughness: kind === 'obsidian' ? 0.24 : 0.32, metalness: kind === 'obsidian' ? 0.04 : 0.12,
      map: grain, bumpMap: grain, bumpScale: kind === 'obsidian' ? 0.08 : 0.3,
    })));
  }
  return group(...objects);
}

export function rockClassOf(kind) {
  return ROCK_CLASS[kind] || 'igneous';
}

// A colonnade of basalt columns -- the Giant's Causeway formation, at landscape scale. The
// same jointing as the hand specimen, which is the point: a student can put the two side by
// side and see that the little one is the big one.
export function basaltColonnade({ seed = 23, radius = 14, height = 26, columns = 54 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < columns; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    // Taller toward the middle, which is what a cooling unit does and what stops the
    // formation reading as a bundle of identical pencils.
    const h = height * (0.42 + 0.58 * Math.pow(1 - r / radius, 0.7)) * randomIn(rng, 0.8, 1.12);
    const w = radius * randomIn(rng, 0.055, 0.085);
    // FIFTY-FOUR COLUMNS IN TWO COLOURS IS FIFTY-FOUR PIPES. What makes a colonnade read as
    // stone is that no two columns weather at the same rate: the tone spread has to be
    // continuous, and a few have to be visibly rustier where water has been running down the
    // joint between them. Same argument as the twelve on the hand specimen, at landscape
    // scale -- and it is free, because the colour is per part in a merge that already exists.
    const k = randomIn(rng, 0.8, 1.45);
    const base = rng() < 0.16 ? ROCK.rust : rng() < 0.3 ? ROCK.basaltWarm : ROCK.basalt;
    const c = new THREE.Color(base).multiplyScalar(k);
    put(parts, hexColumn(w, h, rng() * 1.05), c.getHex(),
      [Math.cos(a) * r, h / 2, Math.sin(a) * r],
      [randomIn(rng, -0.04, 0.04), 0, randomIn(rng, -0.04, 0.04)]);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.94, metalness: 0.04,
    ...relief('stone', { seed, repeat: 14, strength: 1.0 }),
  })));
}

// A scatter of scoria and blocks -- the debris apron every volcano sits in.
export function scoriaField({ seed = 29, radius = 16, blocks = 26 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // A'A BLOCKS ARE THE MOST ANGULAR ROCK THERE IS -- a flow's crust tearing itself apart as
  // it moves, so every piece is a fresh fracture with nothing weathered off it yet. They get
  // the highest `angular` in the file, and the red is the point of the field: the top of a
  // cooling flow oxidises where the steam gets at it, so a scoria apron is brick red shot
  // through with the grey of the pieces that broke off cold.
  const hues = [
    ROCK.scoria, ROCK.oxide, ROCK.rust, ROCK.cinder, ROCK.scoriaDeep,
    ROCK.basalt, ROCK.basaltWarm, ROCK.tephra,
  ];
  for (let i = 0; i < blocks; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const s = randomIn(rng, 0.5, 2.2);
    put(parts, boulder(s, seed + i * 7, {
      rough: 0.3, flatten: randomIn(rng, 0.5, 0.85), detail: 18, facets: 8, angular: 0.86,
    }), hues[Math.floor(rng() * hues.length)],
    [Math.cos(a) * r, s * randomIn(rng, 0.3, 0.55), Math.sin(a) * r],
    [rng() * 3, rng() * 3, rng() * 3], {
      // Oxidation is a SURFACE thing, so it is strongest on the block's upper faces: the
      // side that was facing the sky while the flow was still steaming.
      tint: (q) => {
        const up = THREE.MathUtils.clamp(0.55 + q.y / Math.max(0.3, s), 0, 1);
        const n = smoothNoise3(q.x * 1.4 + i, q.y * 1.4, q.z * 1.4);
        return [1 + up * n * 0.12, 1 - up * n * 0.05, 1 - up * n * 0.1];
      },
    });
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.96, metalness: 0.03,
    ...relief('stone', { seed, repeat: 9, strength: 1.0 }),
  })));
}

// A volcanic bomb: a clot of lava thrown out molten and twisted into a spindle in flight,
// landing hard enough to crack. The TAPERED ENDS are the identification -- a round lump is
// just a boulder.
export function volcanicBomb({ seed = 31, length = 5, girth = 1.6 } = {}) {
  const parts = [];
  const g = solidLoft([
    { d: -length / 2, w: 0.03, up: 0.03, dn: 0.03, round: 1 },
    { d: -length * 0.24, w: girth * 0.66, up: girth * 0.6, dn: girth * 0.6, round: 1 },
    { d: 0, w: girth, up: girth * 0.92, dn: girth * 0.92, round: 1 },
    { d: length * 0.26, w: girth * 0.6, up: girth * 0.55, dn: girth * 0.55, round: 1 },
    { d: length / 2, w: 0.03, up: 0.03, dn: 0.03, round: 1 },
  ], { sides: 26, samples: 40, axis: 'z', warp: (t, u) => Math.sin(u * Math.PI * 2 * 3 + t * 7) * girth * 0.06 });
  put(parts, g, ROCK.scoria, [0, girth * 0.82, 0], [0.12, 0.6, 0.08], {
    tint: (p) => {
      // Bread-crust cracks: the skin chilled in the air while the inside was still
      // expanding, so it split. That is why the surface is crazed and not smooth.
      // The crack has to be a NARROW DARK line with real contrast against the skin, and its
      // frequency is bounded by the loft's sample spacing -- at the 6.4 cycles per foot the
      // first pass used, on a loft sampling every 0.9ft, it produced nothing at all and the
      // bomb rendered as a smooth red egg.
      const n = smoothNoise3(p.x * 0.5 + seed, p.y * 0.5, p.z * 0.28);
      const e = Math.abs(((n * 2.4) % 1) - 0.5);
      const c = new THREE.Color(ROCK.scoria)
        .lerp(new THREE.Color(ROCK.oxide), smoothNoise3(p.x * 0.7, p.y * 0.7 + seed, p.z * 0.5) * 0.7)
        .lerp(new THREE.Color(0x241a16), THREE.MathUtils.clamp(1 - e / 0.13, 0, 1) * 0.85);
      return [c.r, c.g, c.b];
    },
  });
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.95, metalness: 0.03,
    ...relief('stone', { seed, repeat: 6, strength: 1.0 }),
  })));
}

// The rock cycle itself, as a wall chart -- and it belongs on a chart rather than in three
// dimensions for the reason Fantastic Voyage's system diagrams do: a cycle is a set of
// RELATIONSHIPS, and no amount of walking round a rock shows you that melting it makes
// magma. The twelve specimens teach what the rocks are; this teaches how they turn into
// one another.
export function rockCycleChart({ seed = 37, width = 20, height = 13 } = {}) {
  const parts = [];
  put(parts, extrudeOutline(roundedOutline(width / 2 + 0.5, height / 2 + 0.5, 0.4, 3), 0.5),
    ROCK.basaltPale, [0, height / 2, 0]);
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.28, 0.34, height * 0.42, 10), ROCK.basalt,
      [sx * (width / 2 - 0.6), height * 0.21 - 0.2, -0.4]);
  }
  const texture = canvasTexture(1400, 910, (ctx, w, h) => {
    ctx.fillStyle = '#1b1a1e';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2efe6';
    ctx.font = 'bold 58px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE ROCK CYCLE', w / 2, 62);

    const node = (x, y, r, fill, title, sub) => {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      ctx.fillStyle = '#14151a';
      ctx.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(title, x, y - 10);
      ctx.font = '26px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(sub, x, y + 28);
    };
    // A CURVED arrow, because the cycle is a loop -- straight lines between four circles
    // read as a flow chart, which is the one thing this diagram must not look like.
    const arc = (x0, y0, x1, y1, bend, label, colour) => {
      const mx = (x0 + x1) / 2 + bend * (y1 - y0) * 0.28;
      const my = (y0 + y1) / 2 - bend * (x1 - x0) * 0.28;
      ctx.strokeStyle = colour; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
      const ax = x1 - mx; const ay = y1 - my; const L = Math.hypot(ax, ay) || 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - (ax / L) * 26 - (ay / L) * 13, y1 - (ay / L) * 26 + (ax / L) * 13);
      ctx.lineTo(x1 - (ax / L) * 26 + (ay / L) * 13, y1 - (ay / L) * 26 - (ax / L) * 13);
      ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
      ctx.fillStyle = '#f2efe6';
      ctx.font = 'bold 27px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(label, mx, my - 6);
    };
    const IG = '#e0455f'; const SED = '#f2a541'; const MET = '#8a5cf5'; const MAG = '#ff7a1e';
    node(340, 300, 108, IG, 'IGNEOUS', 'cooled melt');
    node(1060, 300, 108, SED, 'SEDIMENTARY', 'settled grains');
    node(1060, 690, 108, MET, 'METAMORPHIC', 'cooked & squeezed');
    node(340, 690, 108, MAG, 'MAGMA', 'molten rock');

    arc(448, 300, 952, 300, 1, 'weathering & erosion', '#cfc7b6');
    arc(1060, 408, 1060, 582, 1, 'heat & pressure', '#cfc7b6');
    arc(952, 690, 448, 690, 1, 'melting', '#cfc7b6');
    arc(340, 582, 340, 408, 1, 'cooling', '#cfc7b6');
    arc(420, 380, 980, 620, -0.55, 'burial', '#8f8878');
    ctx.fillStyle = 'rgba(242,239,230,0.72)';
    ctx.font = 'italic 27px Georgia, serif';
    ctx.fillText('Every rock in this world is somewhere on this loop.', w / 2, h - 34);
  });
  const board = mesh(new THREE.PlaneGeometry(width, height),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.16, roughness: 0.7 }));
  board.position.set(0, height / 2, 0.28);
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.9, metalness: 0.05,
    ...relief('stone', { seed, repeat: 6, strength: 0.8 }),
  })), board);
}
