import * as THREE from 'three';
import {
  standard, mesh, group, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  solidLoft, loftSampler, revolve, extrudeOutline, sweepProfile, solidSurface,
  ball, tube, chain, spike, dome, mergeParts, tintGeometry, placed, xformed,
  lensOutline, put, smoothNoise3, splineAt,
} from './LoftKit.js';

// Sunflower -- a Kansas sunflower field seen by a deer mouse, and the two hero models
// that carry it: the flowers and the mice.
//
// THE SCALE IS INVERTED, the way A Bug's Life inverts it. The student is not a person
// looking at a flower; the student IS the mouse, so the world is grown around a 5ft eye
// height rather than the animals being shrunk to it. One number does most of that work:
//
//   MOUSE_SCALE = 40. A deer mouse is about 3.4in nose to rump, so at 40x it is 11.3ft
//   long and its eye sits about 3.7ft up -- a head shorter than the student, which is
//   what makes the other mice read as PEERS rather than as pets or as monsters.
//
// The flowers are NOT at that scale and could not be. A real sunflower is 8ft, which at
// 40x is 320ft: past the world bound, past the fog, and past the sky -- at which point
// the field stops being a field and becomes a cave (the same arithmetic that stopped A
// Bug's Life using an ant's true 300x). They are built at about 8x instead, so a mature
// stalk is 45-75ft and a head 11-17ft across. Every placard in the layout states the real
// figure, so the compression teaches instead of misleading.
//
// What the two heroes are read from:
//
//   A SUNFLOWER IS ITS HEAD, and a head is three surfaces that are nothing like each
//   other -- a spiral-packed disc, a ring of long veined ray petals, and a collar of
//   green bracts behind them. The disc is the one everybody recognises and the one no
//   amount of geometry can pay for at field counts: it is a canvas painted from the real
//   golden-angle phyllotaxis, carried as `map` AND `bumpMap` on a domed grid.
//
//   A MOUSE IS ITS FACE AND ITS SILHOUETTE: a pointed muzzle, two enormous thin round
//   ears, two black beads standing proud of the fur, a long bicoloured tail, and white
//   feet. Everything is placed by asking a surface where it is (`onShell`, the robot and
//   Wonderland idiom), and the limbs go through `chain`, which sockets every joint by
//   construction.
//
// House rules are PropKit's: feet at scale 1, origin at base centre, every prop faces its
// own +Z, fresh materials per call, seededRandom never Math.random, merge everything.

// ---------------------------------------------------------------------------
// Palette -- vibrant on purpose, and named so the world stays one field
// ---------------------------------------------------------------------------

export const SUN = {
  // The flower
  petal: 0xffc42e,
  petalDeep: 0xef9c12,
  petalTip: 0xffe071,
  petalBack: 0xe8a72a,
  petalOld: 0xd8912c,
  discDark: 0x3c2a16,
  discMid: 0x6d4a1e,
  floret: 0xe8a32c,
  pollen: 0xffd964,
  bract: 0x5f9631,
  bractDeep: 0x3f6f24,
  stem: 0x5d8f2c,
  stemPale: 0x81ad3f,
  stemDry: 0xa8913f,
  leaf: 0x7cc23c,
  leafDeep: 0x5d9a2a,
  leafPale: 0xa0ca50,
  leafDry: 0xb08a34,
  seedDark: 0x2a2018,
  seedPale: 0xd9cbae,
  seedMid: 0x6b5a45,

  // The mouse
  furBack: 0x9c6535,
  furFlank: 0xc08b4a,
  furCheek: 0xd8ab6a,
  furBelly: 0xfaf3e4,
  furFoot: 0xf6e6d6,
  earOuter: 0x8a5f39,
  earInner: 0xd8a291,
  nose: 0xd98a86,
  eye: 0x120d0a,
  whisker: 0xf2ead8,
  tailTop: 0x6d4a30,
  tailPale: 0xe6d7c0,
  claw: 0xe8dcc8,

  // The ground and the nest
  soil: 0x6f5736,
  soilDark: 0x483722,
  soilPale: 0x9c8557,
  root: 0x6b5238,
  nestGrass: 0xc8a959,
  nestGrassDeep: 0x9a7f3c,
  dryGrass: 0xc0a352,
  down: 0xf4eddd,
  stone: 0x9a9184,

  // Prairie colour, for everything that is not a sunflower
  coneflower: 0xd06aa8,
  coneCentre: 0xb4622c,
  susan: 0xf5a623,
  susanCentre: 0x4a3218,
  milkweed: 0xe8722c,
  cornflower: 0x5b7fd4,
  bee: 0xf2c033,
  beeDark: 0x2c2620,
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// `revolve` decides its winding from the profile's direction: a bottom-up profile comes
// out inside out and renders DARK, not missing (the Seattle lesson, relearned in Chalk).
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON the axis is an open tube.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// mergeParts composes its Euler as Rx*Ry*Rz -- Rz first, then Ry, then Rx -- so "nod the
// head, THEN turn it" cannot be said with one Euler. Bake the matrix in the order
// actually wanted (RobotProps' `laid`, WonderProps' `aimRot`, RomeProps' `xformed`).
function aimed(geometry, { yaw = 0, pitch = 0, roll = 0, at = [0, 0, 0] } = {}) {
  const m = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2])
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeRotationX(pitch))
    .multiply(new THREE.Matrix4().makeRotationZ(roll));
  return xformed(geometry, m);
}

// A point on an ellipsoid in a given direction, with that surface's TRUE normal -- the
// gradient, which is NOT the direction wherever the radii differ. Every eye, nostril and
// ear root on the mouse is placed through this rather than by hand.
function onShell(centre, radii, dir) {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const [rx, ry, rz] = radii;
  const k = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
  const p = [centre[0] + d.x * k, centre[1] + d.y * k, centre[2] + d.z * k];
  const n = new THREE.Vector3((d.x * k) / (rx * rx), (d.y * k) / (ry * ry), (d.z * k) / (rz * rz)).normalize();
  return { p, n: [n.x, n.y, n.z] };
}

const off = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];

// A CLOSED flattened ball sunk along a surface's own normal -- eyes, nose, nostrils,
// pollen beads. Closed, never partial: a partial sphere's rim is a hole.
function stud(list, colour, {
  at, normal = [0, 1, 0], radius, rise, wide = 1, long = 1, sink = 0.5, detail = 12, tint = null,
}) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const g = ball(radius, detail);
  g.scale(wide, rise / radius, long);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n),
  );
  m.setPosition(at[0] - n.x * rise * sink, at[1] - n.y * rise * sink, at[2] - n.z * rise * sink);
  const part = { geometry: xformed(g, m), color: colour };
  if (tint) { part.tint = tint; part.keepColor = true; }
  list.push(part);
}

// LoftKit's tintGeometry hands the callback a POSITION and a COLOUR and nothing else, and
// two things in this file need the NORMAL instead: a petal's back face has to be duller
// than its front, and countershading is not a function of height -- it is a function of
// which way a surface faces (the pectoral-fin lesson from Under the Sea, where every
// vertex of a flat fin sits at "belly height" and both fins rendered solid white).
function tintPN(geometry, fn) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  let col = geometry.attributes.color;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    geometry.setAttribute('color', col);
  }
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (nor) n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const out = fn(p, n, c);
    if (out) col.setXYZ(i, out[0], out[1], out[2]);
  }
  col.needsUpdate = true;
  return geometry;
}

// Rewrites a geometry's UVs into one band of a shared atlas (see botanicalCanvas below).
// `vScale` > 1 repeats the band along v, which is how a 60ft stalk gets stem fibre at a
// believable size out of a texture drawn once.
function bandUV(geometry, [u0, u1], { vScale = 1, vOffset = 0, flip = false } = {}) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    const u = flip ? uv.getY(i) : uv.getX(i);
    const v = flip ? uv.getX(i) : uv.getY(i);
    uv.setXY(i, u0 + THREE.MathUtils.clamp(u, 0, 1) * (u1 - u0), v * vScale + vOffset);
  }
  uv.needsUpdate = true;
  return geometry;
}

const col = (hex) => new THREE.Color(hex);
const lerpCol = (a, b, t) => col(a).lerp(col(b), t);

// ---------------------------------------------------------------------------
// Shared canvases
// ---------------------------------------------------------------------------

// THE CANVAS IS CACHED AND THE THREE.Texture IS NOT -- the one-level-lower rule
// SurfaceTextures.js and NeighborhoodProps.js both follow. disposeObject3D() destroys a
// removed prop's maps outright, so one Texture handed to eighty sunflowers dies with the
// first one deleted. Two Textures sharing a Source share the GPU upload instead, and
// three.js refcounts that (WebGLTextures keeps usedTimes per source), so the field costs
// ONE texture upload however many plants stand in it.
const CANVASES = new Map();

function cachedCanvas(key, w, h, draw) {
  if (!CANVASES.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    CANVASES.set(key, canvas);
  }
  return CANVASES.get(key);
}

// A texture over a cached canvas. Fresh Texture, shared Source.
function sharedTexture(canvas, {
  repeat = [1, 1], wrapS = THREE.ClampToEdgeWrapping, wrapT = THREE.RepeatWrapping,
  srgb = true,
} = {}) {
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = wrapS;
  texture.wrapT = wrapT;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;
  return texture;
}

// ONE NEAR-WHITE ATLAS FOR EVERY GREEN AND YELLOW SURFACE IN THE WORLD.
//
// A material carrying both a `map` and `vertexColors` MULTIPLIES them -- normally the bug
// that turned the bear dens black, and used deliberately here exactly as the flower beds
// and the rock specimens use it: the map has no colour of its own, so it carries vein,
// fibre and grain at a scale vertices cannot reach while the vertex tint goes on carrying
// hue. Vein lines as geometry would be fifteen extra solids per leaf on eighty plants.
//
// Four bands in u, because one material means ONE MESH for stalk, leaves, petals and
// bracts together -- four draw calls a plant becomes two.
const BAND = {
  leaf: [0.005, 0.245],
  petal: [0.255, 0.495],
  stem: [0.505, 0.745],
  blank: [0.755, 0.995],
};

function botanicalCanvas() {
  return cachedCanvas('botanical', 1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const band = (key) => [BAND[key][0] * w, BAND[key][1] * w];

    // --- leaf: a midrib with pinnate veins branching forward on both sides -----
    {
      const [x0, x1] = band('leaf');
      const cx = (x0 + x1) / 2;
      const bw = x1 - x0;
      // A broad soft shading first, so the blade is not a flat multiply.
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, 'rgba(150,170,120,0.16)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(150,170,120,0.16)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, 0, bw, h);

      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineCap = 'round';
      // Midrib. DRAWN FAT: a leaf is ~10ft and 30 screen pixels across at walking
      // distance, so a hairline mips straight out of existence (the flower-bed lesson).
      ctx.lineWidth = bw * 0.035;
      ctx.beginPath();
      ctx.moveTo(cx, h);
      ctx.lineTo(cx, 0);
      ctx.stroke();
      ctx.lineWidth = bw * 0.016;
      for (let i = 1; i < 9; i++) {
        const y = h - (i / 9) * h * 0.97;
        const reach = bw * 0.46 * Math.sin((i / 9) * Math.PI * 0.92);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx, y);
          ctx.quadraticCurveTo(cx + s * reach * 0.6, y - h * 0.035, cx + s * reach, y - h * 0.085);
          ctx.stroke();
        }
      }
      // A dark line UNDER each vein is what makes it read as a ridge rather than a
      // scratch, and it survives the mip further down than the white line does.
      ctx.strokeStyle = 'rgba(70,90,50,0.18)';
      ctx.lineWidth = bw * 0.010;
      for (let i = 1; i < 9; i++) {
        const y = h - (i / 9) * h * 0.97 + h * 0.008;
        const reach = bw * 0.46 * Math.sin((i / 9) * Math.PI * 0.92);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx, y);
          ctx.quadraticCurveTo(cx + s * reach * 0.6, y - h * 0.030, cx + s * reach, y - h * 0.078);
          ctx.stroke();
        }
      }
    }

    // --- petal: parallel veins running the length, and a soft central lift ------
    {
      const [x0, x1] = band('petal');
      const bw = x1 - x0;
      const grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, 'rgba(210,175,80,0.20)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(210,175,80,0.20)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, 0, bw, h);
      for (let i = 0; i < 9; i++) {
        const t = (i + 0.5) / 9;
        const x = x0 + t * bw;
        const bow = (t - 0.5) * bw * 0.18;
        ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.85)' : 'rgba(180,140,50,0.30)';
        ctx.lineWidth = bw * (i % 2 ? 0.02 : 0.012);
        ctx.beginPath();
        ctx.moveTo(x - bow, h);
        ctx.quadraticCurveTo(x, h / 2, x + bow * 0.4, 0);
        ctx.stroke();
      }
    }

    // --- stem: bristly vertical fibre, TILEABLE top to bottom -------------------
    {
      const [x0, x1] = band('stem');
      const bw = x1 - x0;
      const rng = seededRandom(31);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, bw, h);
      ctx.clip();
      for (let i = 0; i < 260; i++) {
        const x = x0 + rng() * bw;
        const y = rng() * h;
        const len = randomIn(rng, h * 0.05, h * 0.22);
        const dark = rng() < 0.45;
        ctx.strokeStyle = dark ? `rgba(90,110,60,${0.10 + rng() * 0.16})` : `rgba(255,255,255,${0.25 + rng() * 0.4})`;
        ctx.lineWidth = bw * (0.006 + rng() * 0.012);
        ctx.beginPath();
        // Drawn three times, offset by the tile height, so a stroke crossing the top
        // edge comes back in at the bottom -- a stalk 60ft tall repeats this eighteen
        // times and a seam would draw eighteen rings round it.
        for (const dy of [-h, 0, h]) {
          ctx.moveTo(x, y + dy);
          ctx.lineTo(x + (rng() - 0.5) * bw * 0.04, y + len + dy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  });
}

// The disc: the golden-angle spiral, painted.
//
// 1,200 florets at a real 137.5 degrees, which is the single most recognisable thing
// about a sunflower and the one thing that cannot be paid for in geometry at field
// counts: as solids it is 30k triangles a head, and there are eighty heads.
//
// `stage` decides what the packing is made of -- unopened florets (a bud's tight green
// crown), open florets with pollen (a flower in bloom) or ripe striped SEEDS (a mature
// head, which is what the mice are here for).
function discCanvas(stage) {
  return cachedCanvas(`disc-${stage}`, 768, 768, (ctx, w, h) => {
    const R = w / 2;
    const rng = seededRandom(stage === 'seed' ? 17 : 11);
    const seedHead = stage === 'seed';

    ctx.fillStyle = seedHead ? '#4a3826' : '#4a3318';
    ctx.fillRect(0, 0, w, h);
    // The face is slightly domed and the centre is in its own shade: a flat fill reads
    // as a printed circle rather than as a surface.
    const base = ctx.createRadialGradient(R, R, R * 0.05, R, R, R);
    base.addColorStop(0, seedHead ? 'rgba(30,22,14,0.9)' : 'rgba(44,30,14,0.85)');
    base.addColorStop(0.62, 'rgba(0,0,0,0)');
    base.addColorStop(1, seedHead ? 'rgba(80,60,34,0.35)' : 'rgba(120,84,26,0.45)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const N = seedHead ? 900 : 1250;
    for (let i = N; i > 0; i--) {
      const f = i / N;
      const r = Math.sqrt(f) * R * 0.975;
      const a = i * GOLDEN_ANGLE;
      const x = R + Math.cos(a) * r;
      const y = R + Math.sin(a) * r;
      const t = r / R; // 0 centre, 1 rim
      const size = (seedHead ? 0.030 : 0.024) * R * (0.7 + 0.5 * t);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      if (seedHead) {
        // A RIPE SEED, drawn as a radial ellipse: the packing is what a student is
        // looking at, so the seeds have to lie along the spiral arms, not at random.
        const len = size * 1.9;
        const wide = size * 0.95;
        const tone = 44 + Math.floor(rng() * 40);
        ctx.fillStyle = `rgb(${tone + 14},${tone + 8},${tone})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, len, wide, 0, 0, Math.PI * 2);
        ctx.fill();
        // The pale stripes that make a sunflower seed a sunflower seed.
        ctx.strokeStyle = `rgba(232,221,196,${0.45 + rng() * 0.45})`;
        ctx.lineWidth = Math.max(0.7, wide * 0.22);
        for (const s of [-0.45, 0.1, 0.5]) {
          ctx.beginPath();
          ctx.moveTo(-len * 0.8, wide * s);
          ctx.lineTo(len * 0.75, wide * s * 0.7);
          ctx.stroke();
        }
        // A shadow on the far side of each seed: this is also the bump map.
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.ellipse(len * 0.22, wide * 0.32, len * 0.8, wide * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // A floret. The outer third of a blooming head has OPENED -- five yellow lobes
        // and a ring of pollen -- while everything inside it is still a tight green-brown
        // bud. That moving front is what tells you the flower is alive.
        const open = t > 0.58 + rng() * 0.08;
        if (open) {
          ctx.fillStyle = `rgb(${196 + Math.floor(rng() * 40)},${126 + Math.floor(rng() * 40)},${28 + Math.floor(rng() * 24)})`;
          ctx.beginPath();
          for (let k = 0; k < 5; k++) {
            const ang = (k / 5) * Math.PI * 2;
            ctx.lineTo(Math.cos(ang) * size * 1.25, Math.sin(ang) * size * 1.25);
            ctx.lineTo(Math.cos(ang + Math.PI / 5) * size * 0.5, Math.sin(ang + Math.PI / 5) * size * 0.5);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = `rgba(255,214,${90 + Math.floor(rng() * 60)},${0.75 + rng() * 0.25})`;
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.52, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const g = 60 + Math.floor(rng() * 30) + Math.floor(t * 40);
          ctx.fillStyle = `rgb(${g + 26},${g + 16},${Math.floor(g * 0.55)})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, size * 0.92, size * 0.78, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,240,200,0.20)';
          ctx.beginPath();
          ctx.ellipse(-size * 0.22, -size * 0.22, size * 0.38, size * 0.30, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.beginPath();
        ctx.ellipse(size * 0.3, size * 0.34, size * 0.8, size * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  });
}

// ---------------------------------------------------------------------------
// 1. THE SUNFLOWER
// ---------------------------------------------------------------------------

// `stage` is the whole reason a field reads as a field rather than as one plant stamped
// out eighty times: a real row holds buds, plants just opening, plants in full bloom and
// heavy brown heads nodding at the ground, all at once, and the mice are only interested
// in the last kind.
const STAGE = {
  bud: { petals: 0, nod: -0.22, headScale: 0.42, disc: 'bloom', leafDry: 0 },
  young: { petals: 0.55, nod: -0.34, headScale: 0.62, disc: 'bloom', leafDry: 0 },
  bloom: { petals: 1, nod: 0.14, headScale: 1, disc: 'bloom', leafDry: 0.12 },
  mature: { petals: 0.62, nod: 0.72, headScale: 1.08, disc: 'seed', leafDry: 0.5 },
};

// THREE DETAIL TIERS, and the reason is the araucaria trap written down: a background
// prop's cost is multiplied by its placement count, and this world plants a hundred and
// fifty flowers. `hero` is a plant a mouse walks under and looks up through; `field` is
// the next row over; `far` is the rest of the field, where a head is a coloured disc
// twelve degrees wide and a petal is two pixels. Measured: 23k / 5k / 1.2k triangles.
const LOD = {
  hero: {
    stalkSides: 16, stalkRows: 9, stalkSamples: 26,
    // leafU is ACROSS the blade and leafV is ALONG it, and they are not worth the same.
    // Every cross-blade term -- the cup, the basal lobes, the thickness falloff -- is a
    // quadratic in s, which nine samples resolve exactly as well as twelve; leafV stays at
    // 24 because that is what the seven marginal teeth are sampled by, and they are the
    // whole silhouette of a leaf seen from underneath, which is the only way a mouse ever
    // sees one. Measured: 1.50k -> 1.13k a leaf, 7 leaves a plant, 15 hero plants.
    leafU: 9, leafV: 24, leafScale: 1,
    // Same argument on a ray floret. Along its length it is sin(pi*v^0.62) lifted by one
    // sine and dropped by one quadratic -- all smooth, and the notched tip lands in the
    // last row either way, since the notch only exists for v > 0.93.
    petalU: 5, petalV: 7, petalScale: 1,
    bractRows: 2, bractU: 4, bractV: 6, florets: 40,
    discRings: 12, discSegs: 36, petiole: 8,
  },
  field: {
    stalkSides: 10, stalkRows: 5, stalkSamples: 12,
    leafU: 7, leafV: 12, leafScale: 0.6,
    petalU: 4, petalV: 5, petalScale: 0.75,
    bractRows: 1, bractU: 3, bractV: 3, florets: 0,
    discRings: 6, discSegs: 18, petiole: 5,
  },
  far: {
    stalkSides: 6, stalkRows: 4, stalkSamples: 6,
    leafU: 4, leafV: 6, leafScale: 0.3,
    petalU: 0, petalV: 0, petalScale: 0.5,   // petalU 0 = one extruded star, not N solids
    bractRows: 0, bractU: 0, bractV: 0, florets: 0,
    discRings: 2, discSegs: 12, petiole: 0,
  },
};

// The parts of one plant, unmerged, so a STAND can merge a dozen of them into one mesh
// instead of one mesh each. `sunflower()` below is this plus the two merges.
export function sunflowerParts({
  height = 52,
  headSize = 13,
  stage = 'bloom',
  nod = null,
  headYaw = 0,
  lean = 0.05,
  leaves = 7,
  petals = 34,
  detail = 'hero',
  seed = 3,
} = {}) {
  const rng = seededRandom(seed);
  const cfg = STAGE[stage] || STAGE.bloom;
  const lod = LOD[detail] || LOD.hero;
  const hero = detail === 'hero';
  const plant = [];   // stalk, leaves, petals, bracts: vertex colour x the botanical atlas
  const R = (headSize / 2) * cfg.headScale;      // petal tip radius
  const discR = R * 0.37;                        // the seed disc itself
  const pitch = nod === null ? cfg.nod + (rng() - 0.5) * 0.12 : nod;

  // --- the stalk ------------------------------------------------------------
  //
  // Ribs and bristles live in the BUMP MAP, not in the geometry, and that is Nyquist
  // rather than thrift: a warp field has to stay under about a ninth of the sample count,
  // so six ribs would need fifty-four sides on a stalk a foot thick.
  const bend = pitch > 0.3 ? 0.055 * height : 0.012 * height;
  const stalkStations = [];
  const STALK_ROWS = lod.stalkRows;
  for (let i = 0; i <= STALK_ROWS; i++) {
    const t = i / STALK_ROWS;
    const w = THREE.MathUtils.lerp(height * 0.016, height * 0.0075, Math.pow(t, 0.7));
    stalkStations.push({
      d: t * height,
      w,
      up: w,
      dn: w,
      a: lean * height * t * t,
      // The top hooks FORWARD under the head's weight. A mature head is a pound of seed
      // on a stalk, and the hook is most of why a ripe sunflower looks ripe.
      b: bend * Math.pow(Math.max(0, t - 0.55) / 0.45, 2),
      round: 1,
    });
  }
  const stalk = solidLoft(stalkStations, { sides: lod.stalkSides, samples: lod.stalkSamples, axis: 'y' });
  bandUV(stalk, BAND.stem, { vScale: Math.max(2, Math.round(height / 3.5)), flip: true });
  put(plant, stalk, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // Green at the base going pale toward the head, and dried out on a mature plant.
      const t = THREE.MathUtils.clamp(p.y / height, 0, 1);
      const c = lerpCol(SUN.stem, SUN.stemPale, t * 0.7);
      if (cfg.leafDry > 0.3) c.lerp(col(SUN.stemDry), 0.45 * (0.4 + 0.6 * t));
      const blotch = smoothNoise3(p.x * 0.7, p.y * 0.35, p.z * 0.7);
      c.multiplyScalar(0.88 + 0.22 * blotch);
      return [c.r, c.g, c.b];
    },
  });

  const stalkTop = [stalkStations[STALK_ROWS].a, height, stalkStations[STALK_ROWS].b];

  // --- the leaves -----------------------------------------------------------
  //
  // Alternate up the stalk on the SAME golden angle the disc is packed with -- it is the
  // same plant solving the same problem twice, and a student who has just read the disc
  // placard can walk round the stalk and count it.
  const leafCount = Math.round(leaves * lod.leafScale);
  for (let i = 0; i < leafCount; i++) {
    const t = 0.14 + (i / Math.max(1, leafCount - 0.001)) * 0.56;
    const yy = t * height;
    const az = i * GOLDEN_ANGLE + rng() * 0.2;
    // The BIG leaves are at the BOTTOM of a sunflower and they are the ones that hang;
    // the top of the plant carries small stiff ones. The first pass had it the other way
    // round and the plant read as a palm.
    const L = height * (0.26 - 0.15 * t) * (0.85 + rng() * 0.3);
    const W = L * 0.52;
    const droop = 0.85 - 0.45 * t + rng() * 0.2;
    const dry = cfg.leafDry * (1 - t * 0.6) + (i === 0 ? 0.25 : 0);
    const stalkA = splineAt(stalkStations.map((s) => s.a), t);
    const stalkB = splineAt(stalkStations.map((s) => s.b), t);
    const stalkW = splineAt(stalkStations.map((s) => s.w), t);

    // The blade. `solidSurface` gives it a real closed rim, so edge-on it is a leaf and
    // not a piece of card -- and the thickness goes to zero at the margin and the tip,
    // where a rim would be a visible white edge.
    const nu = lod.leafU;
    const nv = lod.leafV;
    const teeth = 7;
    const blade = solidSurface({
      nu,
      nv,
      point: (u, v) => {
        const s = (u - 0.5) * 2;
        // CORDATE: widest a fifth of the way out, tapering all the way to a point, with
        // the last tenth pulled in hard so the tip is a point and not a paddle. The first
        // pass held full width from 16% to 50% of the length and came out rectangular.
        const swell = Math.pow(THREE.MathUtils.clamp(v / 0.20, 0, 1), 0.62);
        const taper = Math.pow(1 - v, 0.60) / 0.836;
        const point = Math.pow(THREE.MathUtils.clamp((1 - v) / 0.10, 0, 1), 0.45);
        // The serration is on the OUTLINE, which is the only place it can be read from --
        // 7 teeth against 30 rows is four samples each, and more than that is aliasing
        // rather than detail.
        const tooth = 1 + 0.05 * Math.sin(v * Math.PI * 2 * teeth);
        const hw = W * swell * taper * point * tooth;
        // Droop along the length, cup across it, and a slow undulation down the margin --
        // a flat blade reads as a cut-out whatever it is coloured.
        const fall = -droop * L * v * v * 0.55;
        const cup = (s * s) * hw * 0.30 + Math.sin(v * 6.2) * hw * 0.10 * s * s;
        // The two basal lobes of a heart-shaped leaf reach BACK past the petiole.
        const lobe = -L * 0.07 * Math.pow(THREE.MathUtils.clamp(1 - v / 0.14, 0, 1), 1.4) * s * s;
        return [s * hw, fall + cup, v * L + lobe];
      },
      thick: (u, v) => {
        const s = Math.abs((u - 0.5) * 2);
        const midrib = Math.max(0, 1 - s / 0.14) * L * 0.010;
        return L * 0.0035 * Math.max(0, 1 - Math.pow(s, 2.0)) * (1 - Math.pow(v, 3)) + midrib;
      },
    });
    bandUV(blade, BAND.leaf);
    // The colour is painted in the blade's OWN frame -- before it is swung onto the
    // stalk -- so "toward the tip" means along the leaf rather than along the world.
    tintPN(blade, (p, nrm) => {
      const c = lerpCol(SUN.leaf, SUN.leafDeep, THREE.MathUtils.clamp(-p.y / (L * 0.7), 0, 1) * 0.28);
      // A leaf's UNDERSIDE is much paler than its face -- and on a plant whose leaves hang,
      // the underside is half of what a mouse standing under it can see. Which side a
      // vertex is on is a question about its NORMAL; its position cannot answer it.
      if (nrm.y < -0.15) c.lerp(col(SUN.leafPale), 0.45 * Math.min(1, -nrm.y * 1.6));
      if (dry > 0.02) c.lerp(col(SUN.leafDry), dry * (0.35 + 0.65 * THREE.MathUtils.clamp(p.z / L, 0, 1)));
      const n = smoothNoise3(p.x * 0.5 + i, p.y * 0.5, p.z * 0.5);
      c.multiplyScalar(0.92 + 0.16 * n);
      return [c.r, c.g, c.b];
    });
    // Yaw round the stalk, THEN tip the blade out and down -- baked as one matrix,
    // because mergeParts' Euler composes Rx*Ry*Rz and would apply the tip about the
    // world's x axis for every leaf but the one at yaw zero.
    const at = [stalkA + Math.sin(az) * stalkW * 0.8, yy, stalkB + Math.cos(az) * stalkW * 0.8];
    put(plant, aimed(blade, { yaw: az, pitch: -0.30 - 0.35 * rng(), at }), 0xffffff, null, null,
      { keepColor: true });

    // The petiole, from the stalk out to the blade's own base. A far plant has none: it
    // is two feet of tube on a plant 200ft away.
    if (lod.petiole === 0) continue;
    const pr = stalkW * 0.9;
    const reach = W * 0.28;
    const before = plant.length;
    chain(plant, SUN.stemPale, [
      { p: [stalkA + Math.sin(az) * pr * 0.4, yy - L * 0.02, stalkB + Math.cos(az) * pr * 0.4], r: stalkW * 0.28 },
      { p: [stalkA + Math.sin(az) * (pr + reach * 0.6), yy - L * 0.03, stalkB + Math.cos(az) * (pr + reach * 0.6)], r: stalkW * 0.22 },
    ], { sides: lod.petiole, detail: 6 });
    // Anything whose UVs were not authored for a band samples the WHOLE atlas, smearing
    // all four patterns across it. A petiole is stem.
    for (let k = before; k < plant.length; k++) bandUV(plant[k].geometry, BAND.stem, { vScale: 2 });
  }

  // --- the head -------------------------------------------------------------
  //
  // Authored FACING +Z about its own centre and then swung into place as one matrix, so
  // the nod happens about the head's own lateral axis whatever yaw it is given.
  const headParts = [];
  const discParts = [];

  // The receptacle: the green cushion the whole head is built on, bulging BACKWARD.
  //
  // A lathe is built about +Y and the head is authored facing +Z, so the -90 degree tip
  // sends +Y to -Z: the apex has to be the TOP of the profile. Written apex-first it comes
  // out as a green cone standing out of the flower's own face, which is exactly what the
  // first pass rendered -- the disc was not missing, it was behind a dome.
  put(headParts, lathed(closed([
    [discR * 1.02, 0], [discR * 1.00, discR * 0.06], [discR * 0.86, discR * 0.17],
    [discR * 0.54, discR * 0.27], [0, discR * 0.34],
  ]), { segments: hero ? 32 : 14 }), SUN.bract, null, [-Math.PI / 2, 0, 0]);
  bandUV(headParts[headParts.length - 1].geometry, BAND.blank);

  // The disc face: a shallow dome carrying the phyllotaxis canvas as map AND bump. Its
  // own mesh, because a material cannot hold a real colour map and vertex colours without
  // multiplying them.
  {
    const rings = lod.discRings;
    const segs = lod.discSegs;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= rings; i++) {
      const rr = (i / rings) * discR;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        // Convex toward the viewer, with the centre a little proud: a ripe head is a
        // cushion, and a flat disc reads as a printed circle.
        // The rim dips BACK behind the receptacle: left level, the disc's own
        // boundary edge shows as a bright lip wherever the head is seen from the side.
        const edge = i === rings ? -discR * 0.07 : 0;
        const z = discR * 0.16 * (1 - Math.pow(rr / discR, 2)) + discR * 0.02 + edge;
        positions.push(x, y, z);
        uvs.push(0.5 + (x / discR) * 0.5, 0.5 + (y / discR) * 0.5);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const face = new THREE.BufferGeometry();
    face.setIndex(indices);
    face.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    face.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    face.computeVertexNormals();
    discParts.push({ geometry: face, color: 0xffffff });
  }

  // The open florets: a real ring of tubes at the blooming front, because the disc canvas
  // can paint the pattern but not the SILHOUETTE -- and the rim of a head in bloom is
  // visibly fuzzy against the sky.
  if (lod.florets > 0 && cfg.disc === 'bloom') {
    const n = lod.florets;
    const before = headParts.length;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.1;
      const rr = discR * (0.80 + rng() * 0.14);
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      const z = discR * 0.14 + discR * 0.05;
      const len = discR * (0.16 + rng() * 0.07);
      put(headParts, new THREE.CylinderGeometry(discR * 0.030, discR * 0.045, len, 6),
        SUN.floret, [x, y, z + len * 0.4], [Math.PI / 2, 0, 0]);
      put(headParts, ball(discR * 0.045, 6), SUN.pollen, [x, y, z + len * 0.85]);
    }
    for (let k = before; k < headParts.length; k++) bandUV(headParts[k].geometry, BAND.blank);
  }

  // The bracts: two overlapping rows of pointed green scales round the back of the head.
  // They are what a nodding head SHOWS the world, and a head without them is a plate.
  {
    const rows = lod.bractRows;
    for (let row = 0; row < rows; row++) {
      const n = hero ? (row === 0 ? 26 : 20) : 12;
      const rr = discR * (row === 0 ? 1.0 : 0.86);
      const len = discR * (row === 0 ? 0.62 : 0.44) * (stage === 'bud' ? 1.5 : 1);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + row * 0.12 + rng() * 0.05;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        const bw = discR * 0.16;
        const bract = solidSurface({
          nu: lod.bractU,
          nv: lod.bractV,
          point: (u, v) => {
            const s = (u - 0.5) * 2;
            const hw = bw * Math.sin(Math.PI * Math.min(1, 0.25 + v * 0.9)) * (1 - v * 0.55);
            // Curls back and away from the face, which is what a phyllary does.
            const back = -len * v * v * (stage === 'bud' ? 0.15 : 0.55);
            return [s * hw, v * len, back + (s * s) * hw * 0.35];
          },
          thick: (u, v) => bw * 0.16 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - v * 0.8),
        });
        bandUV(bract, BAND.leaf);
        put(headParts, aimed(bract, { roll: a - Math.PI / 2, pitch: 0, at: [x, y, -discR * 0.06] }),
          row === 0 ? SUN.bract : SUN.bractDeep);
      }
    }
  }

  // --- the ray petals -------------------------------------------------------
  //
  // A sunflower's "petals" are ray florets: long, parallel-veined, notched at the tip,
  // and each one twisted a little differently -- a ring of identical petals is a cog.
  if (cfg.petals > 0 && lod.petalU === 0) {
    // THE FAR TIER'S RAY IS ONE EXTRUDED STAR. At 150ft a petal is under a pixel wide and
    // thirty-four lofted solids buy nothing at all; what still reads is the ragged golden
    // disc, and that is an outline.
    const n = Math.max(10, Math.round(petals * cfg.petals * 0.6));
    const outline = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 0.5) / n) * Math.PI * 2;
      const tip = R * (0.88 + rng() * 0.2);
      outline.push([Math.cos(a0) * tip, Math.sin(a0) * tip]);
      outline.push([Math.cos(a1) * discR * 1.05, Math.sin(a1) * discR * 1.05]);
    }
    const ray = extrudeOutline(outline, R * 0.02);
    bandUV(ray, BAND.petal);
    tintPN(ray, (p) => {
      const t = THREE.MathUtils.clamp((Math.hypot(p.x, p.y) - discR) / Math.max(0.01, R - discR), 0, 1);
      const c = lerpCol(SUN.petalDeep, SUN.petal, Math.min(1, t * 1.6));
      if (stage === 'mature') c.lerp(col(SUN.petalOld), 0.5);
      return [c.r, c.g, c.b];
    });
    put(headParts, ray, 0xffffff, null, null, { keepColor: true });
  } else if (cfg.petals > 0) {
    const n = Math.round(petals * cfg.petals * lod.petalScale);
    const ringR = discR * 1.02;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const L = (R - ringR) * (0.86 + rng() * 0.28);
      const W = L * (0.145 + rng() * 0.03);
      const curl = 0.10 + rng() * 0.22 + (stage === 'mature' ? 0.5 : 0);
      const twist = (rng() - 0.5) * 0.5;
      const lift = stage === 'young' ? 0.25 : 0.06;
      const petal = solidSurface({
        nu: lod.petalU,
        nv: lod.petalV,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          // Widest a third of the way out, tapering to a notched tip.
          const shape = Math.sin(Math.PI * Math.pow(THREE.MathUtils.clamp(v * 1.04, 0, 1), 0.62));
          const notch = v > 0.93 ? 1 - Math.abs(Math.sin((v - 0.93) * 30)) * 0.5 : 1;
          const hw = W * shape * notch;
          const x = s * hw;
          const y = ringR + v * L;
          // Out of the disc's plane: lifted at the base, falling away at the tip, cupped
          // across, and twisted about its own length.
          const z = lift * L * Math.sin(v * 2.2) - curl * L * v * v + (s * s) * hw * 0.5;
          const tw = twist * v;
          return [
            x * Math.cos(tw) - z * Math.sin(tw) * 0.3,
            y,
            z * Math.cos(tw) + x * Math.sin(tw) * 0.3,
          ];
        },
        thick: (u, v) => W * 0.055 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2.2)) * (1 - Math.pow(v, 4)),
      });
      bandUV(petal, BAND.petal);
      const front = new THREE.Vector3(0, 0, 1);
      tintPN(petal, (p, nrm) => {
        const t = THREE.MathUtils.clamp((p.y - ringR) / Math.max(0.01, L), 0, 1);
        const c = lerpCol(SUN.petalDeep, SUN.petal, Math.min(1, t * 1.8));
        c.lerp(col(SUN.petalTip), Math.pow(t, 2.4) * 0.5);
        if (stage === 'mature') c.lerp(col(SUN.petalOld), 0.45);
        // The BACK of a petal is duller than its face -- and half the petals on a nodding
        // head show you their backs. Position cannot tell the two apart; the normal can.
        if (nrm.dot(front) < 0) c.lerp(col(SUN.petalBack), 0.55);
        return [c.r, c.g, c.b];
      });
      put(headParts, aimed(petal, { roll: a }), 0xffffff, null, null, { keepColor: true });
    }
  }

  // Swing the whole head onto the top of the stalk.
  //
  // The stalk meets the BACK of the receptacle, not the middle of the disc: offset along
  // the head's own facing, which after the nod is (0, -sin, cos). Placed at the stalk top
  // itself, the stalk runs up through the flower and out of its face.
  const depth = discR * 0.34;
  const headAt = [
    stalkTop[0],
    stalkTop[1] + discR * 0.10 - Math.sin(pitch) * depth,
    stalkTop[2] + Math.cos(pitch) * depth,
  ];
  for (const part of headParts) {
    // BAKE THE PART'S OWN PLACEMENT FIRST. Clearing `position` and `rotation` after
    // swinging the head is how the first pass lost them: the receptacle's -90 degree tip
    // was discarded, so its dome stayed about +Y and rendered as a green lens lying
    // straight across the flower's face, and all forty-six florets collapsed onto the
    // disc's centre point. Neither errors; both simply look like a different model.
    if (part.position || part.rotation) {
      part.geometry = placed(part.geometry, {
        pos: part.position ?? [0, 0, 0],
        rot: part.rotation ?? [0, 0, 0],
      });
      part.position = null;
      part.rotation = null;
    }
    part.geometry = aimed(part.geometry, { yaw: headYaw, pitch, at: headAt });
  }
  for (const part of discParts) {
    part.geometry = aimed(part.geometry, { yaw: headYaw, pitch, at: headAt });
  }
  plant.push(...headParts);
  return { plant, disc: discParts, seedHead: cfg.disc === 'seed' };
}

// The two materials every sunflower in the world shares the SHAPE of: green-and-gold
// vertex colour times the near-white botanical atlas, and the disc's own painted
// phyllotaxis. Built per prop (a removed prop's maps are disposed outright) over cached
// canvases (one GPU upload for the whole field).
function plantMaterial() {
  const atlas = botanicalCanvas();
  return standard({
    vertexColors: true,
    map: sharedTexture(atlas),
    bumpMap: sharedTexture(atlas, { srgb: false }),
    bumpScale: 0.3,
    roughness: 0.78,
  });
}

function discMaterial(seedHead) {
  const face = discCanvas(seedHead ? 'seed' : 'bloom');
  return standard({
    map: sharedTexture(face, { wrapT: THREE.ClampToEdgeWrapping }),
    bumpMap: sharedTexture(face, { wrapT: THREE.ClampToEdgeWrapping, srgb: false }),
    bumpScale: 0.5,
    roughness: 0.88,
  });
}

export function sunflower(options = {}) {
  const { plant, disc, seedHead } = sunflowerParts(options);
  return group(
    mesh(mergeParts(plant), plantMaterial()),
    mesh(mergeParts(disc), discMaterial(seedHead)),
  );
}

// A STAND: several plants merged into three meshes for the whole clump.
//
// This is what makes a field of a hundred and fifty flowers affordable. Draw calls are
// CPU and driver cost and that did not move with the hardware target; a hundred small
// meshes is the wrong answer at any triangle budget. Blooming and seed heads are merged
// separately because their disc canvases differ -- two materials, not one per plant.
export function sunflowerStand({
  count = 5,
  spread = 26,
  height = 46,
  heightVary = 0.3,
  headSize = 12,
  detail = 'far',
  stages = null,
  faceYaw = 0,
  seed = 5,
} = {}) {
  const rng = seededRandom(seed);
  const pick = stages || ['bloom', 'bloom', 'mature', 'young', 'bloom', 'bud'];
  const plant = [];
  const bloomDisc = [];
  const seedDisc = [];
  for (let i = 0; i < count; i++) {
    // A golden-angle scatter rather than free draws: a row of flowers planted at random
    // clumps and leaves holes, and a field is planted in rows for a reason.
    const a = i * GOLDEN_ANGLE;
    const r = spread * Math.sqrt((i + 0.6) / count);
    const x = Math.cos(a) * r + (rng() - 0.5) * spread * 0.18;
    const z = Math.sin(a) * r * 0.75 + (rng() - 0.5) * spread * 0.18;
    const stage = pick[i % pick.length];
    const h = height * (1 - heightVary / 2 + rng() * heightVary);
    const parts = sunflowerParts({
      height: h,
      headSize: headSize * (0.85 + rng() * 0.3),
      stage,
      detail,
      leaves: 6,
      lean: (rng() - 0.5) * 0.1,
      // Every head in the world faces the same way -- east, where the sun is -- and the
      // yaw each stand is planted at has to be undone for that to stay true.
      headYaw: faceYaw + (rng() - 0.5) * 0.5,
      seed: seed + i * 7,
    });
    const at = { pos: [x, 0, z] };
    // `keepColor` IS CARRIED BY THE SPREAD AND MUST NOT BE FORCED ON. This line used to
    // set `keepColor: true` on every part, which is the documented mergeParts trap run
    // BACKWARDS: the rule is that a merge overwrites a part's colour attribute unless
    // keepColor is set, so the reflex is to set it everywhere. But keepColor on a part
    // that has no colour attribute of its own does not preserve its colour -- there is
    // nothing to preserve, and the merge fills white.
    //
    // `sunflowerParts` sets keepColor on exactly the parts it has tinted per vertex (the
    // leaf blades, the ray petals, the far tier's extruded star) and leaves it off the
    // ones that carry a single flat `color`: the RECEPTACLE and the phyllaries. Forced
    // on, those came out pure white -- measured, 56 vertices at 1.00,1.00,1.00 where a
    // standalone plant has them at SUN.bract. The receptacle is the green cushion on the
    // BACK of a head, so the symptom only showed walking south down the field: every
    // flower in every stand presented a white disc instead of a green one, and a field of
    // sunflowers seen from behind read as a field of daisies.
    for (const part of parts.plant) plant.push({ ...part, geometry: placed(part.geometry, at) });
    const into = parts.seedHead ? seedDisc : bloomDisc;
    for (const part of parts.disc) into.push({ ...part, geometry: placed(part.geometry, at) });
  }
  const g = group(mesh(mergeParts(plant), plantMaterial()));
  if (bloomDisc.length) g.add(mesh(mergeParts(bloomDisc), discMaterial(false)));
  if (seedDisc.length) g.add(mesh(mergeParts(seedDisc), discMaterial(true)));
  // A stand is scenery at the back of the field: it RECEIVES the sun and does not cast.
  // The peaks at Machu Picchu made the same trade -- every mesh is drawn twice, and what
  // these would cast falls on flowers nobody is standing under.
  if (detail === 'far') {
    g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }
  return g;
}

// ---------------------------------------------------------------------------
// 2. THE MOUSE
// ---------------------------------------------------------------------------

// A deer mouse (Peromyscus maniculatus) at forty times life size -- which is to say, at
// the size the student is. It is the hardest thing in this world to get right because it
// is read from SIX FEET, the way the robots are: at that range every join, every seam and
// every crescent of daylight between two solids is the only thing you can see.
//
// WHAT MAKES IT READ AS A MOUSE, in the order the identification depends on:
//
//  * THE EARS. Enormous, round, thin, and held up off the skull -- a mouse's ear is a
//    third of its head. Modelled as cupped surfaces with a pink inner face, because a flat
//    disc in body colour reads as a leaf stuck to the head.
//  * THE EYE. A black bead standing PROUD of the fur, not a dot painted on it, with one
//    white highlight. Without the highlight a matte black sphere is a hole in the face.
//  * THE MUZZLE. Long, narrowing, and drooping to a pink nose -- the taper is the whole
//    difference between a mouse and a hamster.
//  * COUNTERSHADING WITH A HARD LINE. Warm brown above, WHITE below, and the boundary is
//    a crisp line along the flank rather than a fade. It is also a function of which way a
//    surface FACES rather than of how high it is (the shark's-fin lesson from Under the
//    Sea), or the tops of the feet come out white and the underside of the tail brown.
//  * THE TAIL, as long as the animal and bicoloured the same way.
//  * THE WHISKERS, which are longer than instinct says: as wide as the body, because that
//    is how a mouse judges a gap in the dark.
//
// IT IS BUILT IN PIECES ON PURPOSE, which is the one place this file departs from the
// house habit of merging everything. Every other animal in this project is a single merged
// mesh and therefore cannot move a limb -- that constraint is exactly why the wind is a
// vertex shader. These mice have to SCURRY: four legs, a head and a tail on their own
// pivots, eight meshes instead of one. Sixteen draws an animal against the four a merged
// one would cost, for the thing the brief actually asked for.
const MOUSE_LEN = 11.3;        // authored nose-to-rump, in feet: a deer mouse at 40x

// The neck, hip, shoulder and tail-base joints, in the authored body frame. Every pivot
// and every limb hangs off these, so the whole animal moves together when one changes.
const JOINT = {
  neck: [0, 2.76, 3.0],
  shoulder: [0.85, 2.12, 1.9],
  hip: [1.08, 2.12, -3.0],
  tail: [0, 2.16, -5.0],
};

function furCanvas() {
  return cachedCanvas('fur', 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(7);
    // Strands running along +x, which is the body loft's own length: fur lies nose to
    // tail, and a tile whose strokes run the other way reads as a knitted jumper.
    for (let i = 0; i < 900; i++) {
      const y = rng() * h;
      const x = rng() * w;
      const len = randomIn(rng, w * 0.05, w * 0.16);
      const lift = (rng() - 0.5) * h * 0.02;
      const dark = rng() < 0.5;
      ctx.strokeStyle = dark ? `rgba(120,100,80,${0.06 + rng() * 0.12})` : `rgba(255,255,255,${0.2 + rng() * 0.45})`;
      ctx.lineWidth = 0.9 + rng() * 1.1;
      ctx.beginPath();
      // Wrapped in both axes: the body is a closed surface and a seam draws a line
      // straight down the animal's flank.
      for (const dx of [-w, 0, w]) {
        for (const dy of [-h, 0, h]) {
          ctx.moveTo(x + dx, y + dy);
          ctx.quadraticCurveTo(x + len * 0.5 + dx, y + lift * 0.5 + dy, x + len + dx, y + lift + dy);
        }
      }
      ctx.stroke();
    }
  });
}

function furMaterial(repeat = [6, 3]) {
  const fur = furCanvas();
  return standard({
    vertexColors: true,
    map: sharedTexture(fur, { repeat, wrapS: THREE.RepeatWrapping }),
    bumpMap: sharedTexture(fur, { repeat, wrapS: THREE.RepeatWrapping, srgb: false }),
    bumpScale: 0.35,
    roughness: 0.92,
    metalness: 0,
  });
}

// THE COUNTERSHADING. `up` is the surface normal's y, and it is what stops a pectoral fin
// -- or here, the top of a foot and the underside of a tail -- taking the wrong tone.
function mouseCoat(p, nrm, { low = 0.5, high = 3.9, seed = 1 } = {}) {
  const t = THREE.MathUtils.clamp((p.y - low) / (high - low), 0, 1);
  // A downward-facing surface reads as lower than it is, an upward-facing one as higher:
  // this is what puts the white on the belly and the brown on the top of the foot.
  const side = THREE.MathUtils.clamp(t + nrm.y * 0.26, 0, 1);
  const c = col(SUN.furBelly);
  // A HARD line along the flank, not a fade -- a deer mouse is crisply two-toned and a
  // soft gradient reads as a field mouse in poor light.
  const up = THREE.MathUtils.smoothstep(side, 0.38, 0.52);
  c.lerp(col(SUN.furFlank), up);
  c.lerp(col(SUN.furBack), THREE.MathUtils.smoothstep(side, 0.60, 0.92));
  // Agouti: every hair is banded, so a real coat is never flat. Fine noise, and a second
  // coarser one so the animal has a shoulder and a rump rather than a paint job.
  const fine = smoothNoise3(p.x * 2.6 + seed, p.y * 2.6, p.z * 2.6);
  const broad = smoothNoise3(p.x * 0.5, p.y * 0.5, p.z * 0.5 + seed);
  c.multiplyScalar(0.9 + 0.14 * fine + 0.08 * broad);
  return [c.r, c.g, c.b];
}

export function fieldMouse({
  length = MOUSE_LEN,
  carry = 'none',
  carrying = false,
  fur = null,
  seed = 11,
  idle = false,
} = {}) {
  const rng = seededRandom(seed);
  const S = length / MOUSE_LEN;
  const body = [];    // the torso: its own mesh, because the head and legs move
  const backTone = fur ? col(fur) : col(SUN.furBack);
  const coat = (p, nrm) => {
    const out = mouseCoat(p, nrm, { seed });
    if (!fur) return out;
    // A recoloured mouse keeps the RELATIONSHIPS -- flank and belly follow the back
    // rather than being three flat colours (the llama's fleece rule).
    const c = new THREE.Color(out[0], out[1], out[2]);
    const shift = backTone.clone().multiply(col(SUN.furBack).clone().convertLinearToSRGB());
    void shift;
    c.lerp(backTone, 0.35);
    return [c.r, c.g, c.b];
  };

  // --- the torso ------------------------------------------------------------
  //
  // A mouse is a loaf: widest at the hips, arched over the shoulder, and its section is
  // rounder on top than underneath. `taperedTube` sweeps a circle and could not say that.
  const torso = solidLoft([
    { d: -5.0, w: 0.75, up: 0.80, dn: 0.70, b: 2.22, round: 1 },
    { d: -4.2, w: 1.55, up: 1.42, dn: 1.26, b: 2.32, round: 1 },
    { d: -2.6, w: 1.74, up: 1.58, dn: 1.38, b: 2.44, roundUp: 1, roundDn: 0.86 },
    { d: -1.0, w: 1.70, up: 1.52, dn: 1.34, b: 2.36, roundUp: 1, roundDn: 0.86 },
    { d: 0.6, w: 1.70, up: 1.48, dn: 1.28, b: 2.38, roundUp: 1, roundDn: 0.88 },
    { d: 2.0, w: 1.36, up: 1.24, dn: 1.06, b: 2.58, round: 1 },
    { d: 3.1, w: 0.94, up: 0.92, dn: 0.80, b: 2.78, round: 1 },
  ], {
    sides: 34,
    samples: 30,
    axis: 'z',
    // Fur is not a smooth surface: a slow lumpiness over the whole body, which the fur
    // map's fine strands then sit on top of.
    warp: (t, u) => (smoothNoise3(Math.cos(u * Math.PI * 2) * 1.7 + 4, Math.sin(u * Math.PI * 2) * 1.7, t * 5) - 0.5) * 0.09,
  });
  tintPN(torso, coat);
  put(body, torso, 0xffffff, null, null, { keepColor: true });

  // The haunches: the one place a mouse has a visible muscle, and the thing that makes a
  // scurrying animal read as pushing off rather than sliding.
  for (const sx of [-1, 1]) {
    const haunch = ball(1.18, 16);
    haunch.scale(0.80, 1.0, 1.30);
    put(body, tintPN(placed(haunch, { pos: [sx * 0.98, 2.24, -2.85] }), coat),
      0xffffff, null, null, { keepColor: true });
  }

  // --- the head, on its own pivot -------------------------------------------
  //
  // Authored about the NECK JOINT at the origin, so the pivot can nod and sniff without
  // any of it sliding out of the neck.
  const head = [];
  const headGloss = [];
  const skull = solidLoft([
    { d: -0.80, w: 0.74, up: 0.68, dn: 0.62, b: 0.10, round: 1 },
    { d: -0.05, w: 1.05, up: 0.96, dn: 0.88, b: 0.20, round: 1 },
    { d: 0.95, w: 0.98, up: 0.86, dn: 0.82, b: 0.16, round: 1 },
    { d: 1.70, w: 0.62, up: 0.52, dn: 0.56, b: -0.10, round: 1 },
    { d: 2.40, w: 0.34, up: 0.29, dn: 0.32, b: -0.36, round: 1 },
    { d: 2.80, w: 0.13, up: 0.11, dn: 0.13, b: -0.50, round: 1 },
  ], {
    sides: 30,
    samples: 26,
    axis: 'z',
    warp: (t, u) => (smoothNoise3(Math.cos(u * Math.PI * 2) * 1.5 + 9, Math.sin(u * Math.PI * 2) * 1.5, t * 6) - 0.5) * 0.05,
  });
  tintPN(skull, (p, nrm) => coat({ x: p.x, y: p.y + JOINT.neck[1], z: p.z }, nrm));
  put(head, skull, 0xffffff, null, null, { keepColor: true });

  // The head's own ellipsoid, for placing everything ON it. A loft has no closed form, so
  // this is the fitted shell every eye, ear and whisker root is asked for.
  const HEAD_C = [0, 0.14, 0.35];
  const HEAD_R = [1.0, 0.92, 1.55];

  // EYES: big, black, and standing proud. Set well round the side of the skull -- a mouse
  // is prey and sees nearly all the way round; eyes on the front of the face make it a
  // predator (the rabbit's rule in WarrenProps).
  for (const sx of [-1, 1]) {
    const e = onShell(HEAD_C, HEAD_R, [sx * 0.86, 0.34, 0.52]);
    // A fur ring first, so the eye sits IN the face rather than on it.
    stud(head, SUN.furCheek, { at: e.p, normal: e.n, radius: 0.46, rise: 0.12, sink: 0.7, detail: 14 });
    stud(headGloss, SUN.eye, { at: off(e.p, e.n, 0.04), normal: e.n, radius: 0.34, rise: 0.30, sink: 0.35, detail: 16 });
    // The catchlight. One small bead, and the difference between an eye and a hole.
    put(headGloss, ball(0.075, 8), 0xffffff,
      off([e.p[0] - sx * 0.06, e.p[1] + 0.13, e.p[2] + 0.06], e.n, 0.30));
  }

  // NOSE and NOSTRILS, on the drooping tip of the muzzle.
  {
    const tip = [0, -0.45, 2.78];
    stud(headGloss, SUN.nose, { at: tip, normal: [0, -0.15, 1], radius: 0.19, rise: 0.15, wide: 1.25, sink: 0.35, detail: 12 });
    for (const sx of [-1, 1]) {
      stud(headGloss, 0x6b4438, {
        at: [sx * 0.08, -0.43, 2.90], normal: [sx * 0.4, 0, 1], radius: 0.05, rise: 0.04, sink: 0.2, detail: 8,
      });
    }
    // The philtrum -- the split in a rodent's upper lip. Tiny, and one of the things that
    // says "rodent" rather than "small mammal".
    chain(head, 0xe8d8c4, [
      { p: [0, -0.55, 2.76], r: 0.030 },
      { p: [0, -0.70, 2.56], r: 0.026 },
    ], { sides: 6, detail: 6 });
  }

  // EARS: the field mark that does the most work. Big thin cups, pink inside, held out and
  // slightly back, and ROUND -- a mouse's ear is very nearly a circle.
  for (const sx of [-1, 1]) {
    const ear = solidSurface({
      nu: 20,
      nv: 7,
      closedU: true,
      point: (u, v) => {
        const a = u * Math.PI * 2;
        // Not a disc: an ear is a little taller than wide and notched where it meets the
        // skull, and it CUPS forward.
        const rr = 1.18 * (1 - 0.13 * Math.cos(a * 2)) * v;
        const x = Math.cos(a) * rr * 0.94;
        const y = Math.sin(a) * rr;
        const cup = 0.46 * (v * v) * (1 + 0.5 * Math.cos(a));
        return [x, y + 0.1, cup];
      },
      thick: (u, v) => 0.055 * (1 - Math.pow(v, 6)) + 0.02,
    });
    tintPN(ear, (p, nrm) => {
      // The INSIDE of the ear is pink and the outside is fur -- which is a question about
      // the normal, not the position: both faces occupy the same place.
      const inner = nrm.z > 0.1;
      const c = col(inner ? SUN.earInner : SUN.earOuter);
      const r = Math.hypot(p.x, p.y - 0.1);
      // Thin skin glows at the rim where the light comes through, and the rim itself is
      // darker where the edge rolls over.
      c.lerp(col(inner ? 0xf0c4b4 : 0x6b4a2c), THREE.MathUtils.smoothstep(r, 0.84, 1.18) * 0.5);
      return [c.r, c.g, c.b];
    });
    // Out to the side and tipped back -- an alert mouse's ears face forward and OUT.
    // Up, out and forward. Set flat against the skull an ear reads as a patch of fur;
    // the whole reason it is the field mark is that it stands clear of the head.
    put(head, aimed(ear, { yaw: sx * 0.95, pitch: -0.10, roll: sx * 0.26, at: [sx * 0.72, 0.88, -0.28] }),
      0xffffff, null, null, { keepColor: true });
  }

  // WHISKERS. Seven a side, as wide as the animal, swept back and fanned in height --
  // built as tubes tapering to a real (small) radius rather than to a point.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const f = i / 6;
      const shell = onShell(HEAD_C, HEAD_R, [sx * 0.9, -0.25 + f * 0.5, 0.9 + f * 0.3]);
      // ROOTED INSIDE THE MUZZLE, not started on it. A tube is a sleeve: its base rim is
      // an open 5-sided ring, and a ring laid exactly on a curved surface leaves both a
      // hole down the middle of the whisker and the crescent of daylight `spike` is
      // rooted to avoid. One whisker's worth is invisible; fourteen round a muzzle the
      // student's own face is four feet from is the loudest thing on the head.
      const root = { p: off(shell.p, shell.n, -0.09), n: shell.n };
      const spread = 2.6 + f * 1.9;
      const rise = -0.5 + f * 1.4;
      put(head, tube([
        root.p,
        [root.p[0] + sx * spread * 0.45, root.p[1] + rise * 0.28, root.p[2] + 0.55],
        [root.p[0] + sx * spread, root.p[1] + rise, root.p[2] + 0.35 - f * 0.9],
      ], [0.038, 0.024, 0.009], { sides: 5, tubular: 7 }), SUN.whisker);
    }
  }

  // --- the four legs, each on its own pivot ---------------------------------
  //
  // `chain` sockets every joint by construction: a tube per span, a ball sized from the
  // BEND at every interior node, and a cap at each open end. The top node is buried inside
  // the body so the shoulder cannot show daylight however far the leg swings.
  const legMesh = (front, sx) => {
    const parts = [];
    const nodes = front
      ? [
        // The top node is INSIDE the chest, so the shoulder cannot show daylight however
        // far the leg swings -- and the elbow sits where the body's own fur covers it.
        { p: [0, 0.45, 0], r: 0.50 },
        { p: [sx * 0.06, -0.50, 0.20], r: 0.32 },
        { p: [sx * 0.02, -1.20, 0.46], r: 0.25 },
        { p: [0, -1.92, 0.62], r: 0.20 },
      ]
      : [
        { p: [0, 0.45, 0], r: 0.74 },
        { p: [sx * 0.10, -0.46, 0.55], r: 0.52 },
        { p: [sx * 0.04, -1.42, -0.26], r: 0.32 },
        { p: [0, -1.95, 0.24], r: 0.25 },
      ];
    chain(parts, SUN.furFlank, nodes, { sides: 12, detail: 12 });
    // THE FOOT. A mouse's hind foot is long and flat on the ground -- it is plantigrade,
    // and a paw standing on its toes turns it into a cat.
    const footLen = front ? 0.62 : 1.15;
    const heel = nodes[nodes.length - 1].p;
    const foot = solidLoft([
      { d: -0.18, w: 0.20, up: 0.16, dn: 0.02, round: 0.8 },
      { d: footLen * 0.45, w: 0.26, up: 0.17, dn: 0.02, round: 0.7 },
      { d: footLen, w: 0.21, up: 0.12, dn: 0.02, round: 0.8 },
    ], { sides: 16, samples: 8, axis: 'z' });
    put(parts, placed(foot, { pos: [heel[0], heel[1] - 0.10, heel[2]] }), SUN.furFoot);
    // Toes, with a claw on each. Four on the front foot, five on the back.
    const toes = front ? 4 : 5;
    for (let i = 0; i < toes; i++) {
      const f = (i / (toes - 1) - 0.5) * 2;
      const tz = heel[2] + footLen + 0.10;
      const tx = heel[0] + f * 0.22;
      chain(parts, SUN.furFoot, [
        { p: [tx * 0.7, heel[1] - 0.06, heel[2] + footLen * 0.7], r: 0.075 },
        { p: [tx, heel[1] - 0.10, tz], r: 0.055 },
      ], { sides: 6, detail: 6 });
      put(parts, ball(0.05, 6), SUN.claw, [tx * 1.05, heel[1] - 0.10, tz + 0.12]);
    }
    for (const part of parts) {
      if (part.tint || part.color === SUN.claw) continue;
      if (part.position || part.rotation) {
        part.geometry = placed(part.geometry, {
          pos: part.position ?? [0, 0, 0], rot: part.rotation ?? [0, 0, 0],
        });
        part.position = null;
        part.rotation = null;
      }
      const g = part.geometry;
      const base = part.color;
      tintPN(g, (p, nrm) => {
        // The leg's own frame is the PIVOT's, so its world height is the pivot's height
        // plus the local one -- without that, every leg comes out belly-white.
        const c = col(base);
        const y = p.y + (front ? JOINT.shoulder[1] : JOINT.hip[1]);
        const shade = mouseCoat({ x: p.x, y, z: p.z }, nrm, { seed, low: 0.15, high: 2.7 });
        return [c.r * 0 + shade[0], c.g * 0 + shade[1], c.b * 0 + shade[2]];
      });
      part.keepColor = true;
    }
    return parts;
  };

  // --- the tail -------------------------------------------------------------
  //
  // As long as the animal, tapering to a real tip, and bicoloured the same way the body is
  // -- dark above, pale below, which on a curving tail is again a question about the
  // normal rather than about height.
  const tailParts = [];
  {
    const tailTube = tube([
      [0, 0, 0], [0, 0.40, -2.2], [0, 0.20, -4.8], [0, -0.55, -7.6], [0, -1.55, -10.0],
    ], [0.24, 0.20, 0.155, 0.10, 0.045], { sides: 12, tubular: 26 });
    tintPN(tailTube, (p, nrm) => {
      const c = col(nrm.y > 0 ? SUN.tailTop : SUN.tailPale);
      c.lerp(col(nrm.y > 0 ? SUN.tailPale : SUN.tailTop), Math.pow(1 - Math.abs(nrm.y), 3) * 0.5);
      // The scale rings a mouse's tail is ringed with, as a slow band down its length.
      const ring = 0.92 + 0.08 * Math.sin(p.z * 5.5);
      c.multiplyScalar(ring);
      return [c.r, c.g, c.b];
    });
    put(tailParts, tailTube, 0xffffff, null, null, { keepColor: true });
    // A tail stopping in mid-air shows the hole straight through it.
    put(tailParts, ball(0.045, 8), SUN.tailPale, [0, -1.55, -10.0]);
  }

  // --- what it is carrying --------------------------------------------------
  const carried = carry === 'none' ? null : carriedItem(carry, rng);

  // --- assemble -------------------------------------------------------------
  const root = group();
  // One inner rig so the whole animal can BOB without the registered root ever moving --
  // the animation contract in RootMotion.js: four separate places persist the live
  // transform of a registered object, and an animated root walks away across sessions.
  const rig = new THREE.Group();
  rig.scale.setScalar(S);
  root.add(rig);

  rig.add(mesh(mergeParts(body), furMaterial([14, 6])));

  const headPivot = new THREE.Group();
  headPivot.position.set(JOINT.neck[0], JOINT.neck[1], JOINT.neck[2]);
  headPivot.add(mesh(mergeParts(head), furMaterial([8, 4])));
  headPivot.add(mesh(mergeParts(headGloss), standard({
    vertexColors: true, roughness: 0.18, metalness: 0.05,
  })));
  if (carried) {
    carried.position.set(0, -0.62, 3.3);
    headPivot.add(carried);
  }
  rig.add(headPivot);

  const legs = [];
  for (const front of [true, false]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      const j = front ? JOINT.shoulder : JOINT.hip;
      pivot.position.set(sx * j[0], j[1], j[2]);
      pivot.add(mesh(mergeParts(legMesh(front, sx)), furMaterial([6, 3])));
      rig.add(pivot);
      legs.push({ pivot, front, sx });
    }
  }

  const tailPivot = new THREE.Group();
  tailPivot.position.set(JOINT.tail[0], JOINT.tail[1], JOINT.tail[2]);
  tailPivot.add(mesh(mergeParts(tailParts), furMaterial([16, 3])));
  rig.add(tailPivot);

  root.userData.tick = mouseTick(root, rig, { headPivot, legs, tailPivot, carried, carrying, idle, rng });
  return root;
}

// What a mouse is carrying home: this is the whole story of the world in one prop.
function carriedItem(kind, rng) {
  const parts = [];
  if (kind === 'seed') {
    parts.push(...seedParts({ length: 1.15, seed: Math.floor(rng() * 100) }));
  } else if (kind === 'grass') {
    // A blade of dry grass held across the mouth, which is how a mouse actually carries
    // nest material -- in the teeth, at the middle, so it balances.
    for (let i = 0; i < 3; i++) {
      const bend = (rng() - 0.5) * 0.8;
      const len = 2.6 + rng() * 1.8;
      put(parts, tube([
        [-len, bend * 0.4, -0.2 + i * 0.12],
        [0, 0, 0],
        [len * 0.9, -bend, 0.15 + i * 0.1],
      ], [0.012, 0.055, 0.012], { sides: 5, tubular: 10 }), i === 1 ? SUN.dryGrass : SUN.nestGrass);
    }
  } else if (kind === 'fluff') {
    // Thistle or dandelion down: the warmest thing a mouse can line a nest with.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 0.22 + rng() * 0.12;
      put(parts, ball(0.17 + rng() * 0.08, 7), SUN.down,
        [Math.cos(a) * r, Math.sin(a) * r * 0.7, (rng() - 0.5) * 0.3]);
    }
  } else if (kind === 'petal') {
    const petal = solidSurface({
      nu: 5,
      nv: 8,
      point: (u, v) => {
        const s = (u - 0.5) * 2;
        const hw = 0.30 * Math.sin(Math.PI * Math.pow(v, 0.6));
        return [s * hw, v * 1.9 - 0.7, (s * s) * hw * 0.5 + Math.sin(v * 2) * 0.12];
      },
      thick: () => 0.02,
    });
    tintPN(petal, (p) => {
      const c = lerpCol(SUN.petalDeep, SUN.petalTip, THREE.MathUtils.clamp((p.y + 0.7) / 1.9, 0, 1));
      return [c.r, c.g, c.b];
    });
    put(parts, petal, 0xffffff, null, null, { keepColor: true });
  }
  return mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.8 }));
}

// THE GAIT, and it is driven by how fast the animal is ACTUALLY MOVING rather than by a
// frame counter -- because what moves these mice is a student's program, which can be
// edited, slowed down, stopped or replaced. A leg cycle tied to the clock would scurry on
// the spot; tied to distance travelled, the legs stop when the mouse stops and speed up
// when somebody changes a glide from 8 feet to 20.
function mouseTick(root, rig, { headPivot, legs, tailPivot, carried, carrying, idle, rng }) {
  const last = new THREE.Vector3();
  let started = false;
  let phase = rng() * 6.283;
  let still = 0;
  let clock = rng() * 10;
  let hasItem = carrying;
  let sniff = 0;
  if (carried) carried.visible = hasItem;
  const baseY = rig.position.y;

  return {
    update(dt) {
      clock += dt;
      const here = root.position;
      let speed = 0;
      if (started) speed = here.distanceTo(last) / Math.max(1e-4, dt);
      last.copy(here);
      started = true;

      // The stride advances with DISTANCE, so the feet never skate.
      phase += (speed * 0.30 + (speed > 0.2 ? 1.2 : 0) * 0) * dt * 6.0;
      const moving = speed > 0.35 && !idle;
      if (moving) {
        still = 0;
      } else {
        still += dt;
        // ONE PICK-UP OR DROP PER STOP. A mouse that pauses at the seed head picks a seed
        // up; the next time it stops -- at the nest -- it puts it down. That is the whole
        // job these animals are doing, told without a single new mechanism: the stops are
        // already in the program a student can open and read.
        if (carried && still > 1.1 && still - dt <= 1.1) {
          hasItem = !hasItem;
          carried.visible = hasItem;
        }
      }

      const swing = moving ? 0.85 : 0.06;
      for (const leg of legs) {
        // Diagonal pairs move together, which is what a four-legged animal does at a trot.
        const diag = (leg.front ? 0 : Math.PI) + (leg.sx > 0 ? Math.PI : 0);
        const s = Math.sin(phase + diag);
        leg.pivot.rotation.x = s * swing * (leg.front ? 0.9 : 1);
        // A leg swinging forward lifts; a leg pushing back stays down.
        leg.pivot.rotation.z = leg.sx * Math.max(0, s) * swing * 0.10;
      }

      // The body rises and falls with the stride, and a stopped mouse BREATHES.
      rig.position.y = baseY + (moving
        ? Math.sin(phase * 2) * 0.055 * rig.scale.y
        : Math.sin(clock * 2.4) * 0.012 * rig.scale.y);

      // A stopped mouse SNIFFS: nose up, nose down, a flick of the head to the side. This
      // is most of what makes a still animal look alive rather than switched off.
      if (!moving) {
        sniff += dt;
        headPivot.rotation.x = Math.sin(sniff * 9.5) * 0.085 - 0.05;
        headPivot.rotation.y = Math.sin(sniff * 0.8) * 0.35;
      } else {
        sniff = 0;
        headPivot.rotation.x = Math.sin(phase * 2 + 1) * 0.05;
        headPivot.rotation.y *= 0.9;
      }

      // The tail counterweights the run and drifts when the animal is still.
      tailPivot.rotation.y = Math.sin(phase * 0.5 + clock * (moving ? 1.6 : 0.5)) * (moving ? 0.28 : 0.12);
      tailPivot.rotation.x = -0.08 + Math.sin(clock * 0.9) * 0.05;
    },
  };
}

// ---------------------------------------------------------------------------
// 3. SEEDS -- the point of the whole world
// ---------------------------------------------------------------------------

// One sunflower seed: the striped hull, not the kernel. A real one is 12mm long, which at
// this world's forty-times animal scale is about a foot -- the size of a loaf of bread to
// the mouse carrying it, which is exactly the point.
// `packed` is the tier for a seed shoulder to shoulder with a hundred others in a head:
// all that is visible of it is the crown, because the disc it sits in hides its flanks and
// its neighbours hide the rest. A loose seed on the ground is the other case and keeps the
// full count -- it is the thing the build challenge tells a student to go and pick up.
// THIS IS THE ARAUCARIA TRAP INSIDE ONE PROP: at full detail the fallen head's 130 seeds
// were 45k triangles, more than a hero sunflower, for an object the eye reads as a texture.
export function seedParts({ length = 1.15, seed = 5, tone = 1, packed = false } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const L = length;
  const hull = solidLoft([
    { d: -L * 0.5, w: L * 0.04, up: L * 0.03, dn: L * 0.03, round: 1 },
    { d: -L * 0.28, w: L * 0.17, up: L * 0.11, dn: L * 0.11, round: 0.9 },
    { d: 0, w: L * 0.23, up: L * 0.14, dn: L * 0.14, round: 0.85 },
    { d: L * 0.30, w: L * 0.21, up: L * 0.13, dn: L * 0.13, round: 0.9 },
    { d: L * 0.5, w: L * 0.09, up: L * 0.06, dn: L * 0.06, round: 1 },
  ], packed
    // Radial sides are what a seed's silhouette is made of and tubular samples subdivide a
    // length that is already smooth -- so the cut comes out of the samples first.
    ? { sides: 9, samples: 6, axis: 'z' }
    : { sides: 14, samples: 12, axis: 'z' });
  tintPN(hull, (p) => {
    // The stripes run the LENGTH of the hull and are what make a sunflower seed
    // recognisable at a glance. Azimuth about the long axis, not position.
    const az = Math.atan2(p.y, p.x);
    const band = Math.abs(((az * 3 / Math.PI) % 1 + 1) % 1 - 0.5);
    const c = band < 0.17 ? col(SUN.seedPale) : col(SUN.seedDark);
    c.lerp(col(SUN.seedMid), 0.25 + rng() * 0.0);
    c.multiplyScalar((0.85 + 0.3 * smoothNoise3(p.x * 9, p.y * 9, p.z * 4)) * tone);
    return [c.r, c.g, c.b];
  });
  put(parts, hull, 0xffffff, null, null, { keepColor: true });
  return parts;
}

export function sunflowerSeed({ length = 1.15, seed = 5 } = {}) {
  return group(mesh(mergeParts(seedParts({ length, seed })), standard({
    vertexColors: true, roughness: 0.62, metalness: 0.02,
  })));
}

// A SEED HEAD ON THE GROUND -- the whole reason there are mice in this world.
//
// A ripe sunflower head breaks off and falls face up, and what a mouse finds is a dinner
// plate four feet across packed with seeds. This is the one place the seeds are real
// geometry rather than paint: it is the thing a student walks right up to.
export function fallenHead({
  size = 16, tilt = 0.38, spill = 14, seed = 9, picked = 0.25,
} = {}) {
  const rng = seededRandom(seed);
  const R = size / 2;
  const discR = R * 0.62;          // a fallen head has shed most of its ray florets
  const plant = [];
  const discParts = [];
  const seedParts0 = [];

  // The receptacle, face UP, tipped toward the path.
  put(plant, lathed(closed([
    [discR * 1.06, 0], [discR * 1.02, discR * 0.07], [discR * 0.88, discR * 0.19],
    [discR * 0.55, discR * 0.30], [0, discR * 0.36],
  ]), { segments: 26 }), SUN.stemDry, null, [-Math.PI / 2, 0, 0]);
  bandUV(plant[plant.length - 1].geometry, BAND.blank);

  // The painted disc, under the real seeds: the canvas carries the thousand seeds nobody
  // is going to count, and the solids carry the dozen at the front that catch the light.
  {
    const rings = 8;
    const segs = 30;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let i = 0; i <= rings; i++) {
      const rr = (i / rings) * discR;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        const edge = i === rings ? -discR * 0.08 : 0;
        positions.push(x, y, discR * 0.10 * (1 - Math.pow(rr / discR, 2)) + edge);
        uvs.push(0.5 + (x / discR) * 0.5, 0.5 + (y / discR) * 0.5);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + segs + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const face = new THREE.BufferGeometry();
    face.setIndex(indices);
    face.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    face.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    face.computeVertexNormals();
    discParts.push({ geometry: face, color: 0xffffff });
  }

  // Real seeds in the disc, on the same golden-angle spiral the paint is drawn from, with
  // a patch of them already taken -- a head the mice have been working on.
  const N = 130;
  for (let i = 1; i <= N; i++) {
    const f = i / N;
    const rr = Math.sqrt(f) * discR * 0.94;
    const a = i * GOLDEN_ANGLE;
    if (rng() < picked * (1.1 - f)) continue;   // gaps, thickest at the middle
    const s = seedParts({ length: size * 0.072, seed: seed + i, tone: 0.9 + rng() * 0.25, packed: true });
    for (const part of s) {
      seedParts0.push({
        ...part,
        geometry: placed(part.geometry, {
          pos: [Math.cos(a) * rr, Math.sin(a) * rr, discR * 0.10 * (1 - Math.pow(rr / discR, 2)) + size * 0.012],
          rot: [Math.PI / 2, 0, a + Math.PI / 2],
        }),
      });
    }
  }

  // Dry ray florets still hanging on, curled and brown.
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const L = R - discR;
    const W = L * 0.22;
    const petal = solidSurface({
      nu: 4,
      nv: 7,
      point: (u, v) => {
        const sx = (u - 0.5) * 2;
        const hw = W * Math.sin(Math.PI * Math.pow(v, 0.6)) * (1 + 0.3 * Math.sin(v * 9));
        return [sx * hw, discR * 1.02 + v * L, -v * v * L * 0.55 + (sx * sx) * hw * 0.8];
      },
      thick: (u, v) => W * 0.05 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - Math.pow(v, 4)),
    });
    bandUV(petal, BAND.petal);
    tintPN(petal, () => {
      const c = lerpCol(SUN.petalOld, SUN.stemDry, 0.35 + rng() * 0.3);
      return [c.r, c.g, c.b];
    });
    put(plant, aimed(petal, { roll: a }), 0xffffff, null, null, { keepColor: true });
  }

  // Bracts, dried and curling back.
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + rng() * 0.08;
    const bw = discR * 0.17;
    const len = discR * 0.6;
    const bract = solidSurface({
      nu: 4,
      nv: 6,
      point: (u, v) => {
        const sx = (u - 0.5) * 2;
        const hw = bw * Math.sin(Math.PI * Math.min(1, 0.25 + v * 0.9)) * (1 - v * 0.6);
        return [sx * hw, v * len, -len * v * v * 0.8 + (sx * sx) * hw * 0.4];
      },
      thick: (u, v) => bw * 0.15 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - v * 0.8),
    });
    bandUV(bract, BAND.leaf);
    put(plant, aimed(bract, { roll: a - Math.PI / 2, at: [Math.cos(a) * discR * 1.04, Math.sin(a) * discR * 1.04, -discR * 0.05] }),
      i % 3 ? SUN.stemDry : SUN.bractDeep);
  }

  // The snapped stalk still attached to the back.
  {
    const stub = solidLoft([
      { d: 0, w: R * 0.10, up: R * 0.10, dn: R * 0.10, round: 1 },
      { d: R * 0.5, w: R * 0.085, up: R * 0.085, dn: R * 0.085, round: 1 },
      { d: R * 0.85, w: R * 0.07, up: R * 0.075, dn: R * 0.06, round: 0.7 },
    ], { sides: 12, samples: 8, axis: 'z' });
    bandUV(stub, BAND.stem, { vScale: 3 });
    put(plant, stub, SUN.stemDry, [0, 0, -discR * 0.34 - R * 0.1], [0, 0, 0]);
  }

  // --- tip the whole head over and lay it on the ground ---------------------
  const lay = (g) => xformed(g, new THREE.Matrix4()
    .makeTranslation(0, R * 0.30, 0)
    .multiply(new THREE.Matrix4().makeRotationY(0.4))
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + tilt)));
  for (const list of [plant, discParts, seedParts0]) {
    for (const part of list) {
      if (part.position || part.rotation) {
        part.geometry = placed(part.geometry, {
          pos: part.position ?? [0, 0, 0], rot: part.rotation ?? [0, 0, 0],
        });
        part.position = null;
        part.rotation = null;
      }
      part.geometry = lay(part.geometry);
    }
  }

  // Seeds spilled on the ground around it, which is what tells a student what the head is
  // FOR before they have read a word.
  for (let i = 0; i < spill; i++) {
    const a = rng() * Math.PI * 2;
    const rr = R * (0.9 + rng() * 0.9);
    const s = seedParts({ length: size * 0.072, seed: seed + 200 + i, tone: 0.9 + rng() * 0.2 });
    for (const part of s) {
      seedParts0.push({
        ...part,
        geometry: placed(part.geometry, {
          pos: [Math.cos(a) * rr, size * 0.026, Math.sin(a) * rr],
          rot: [0, rng() * Math.PI * 2, 0],
        }),
      });
    }
  }

  return group(
    mesh(mergeParts(plant), plantMaterial()),
    mesh(mergeParts(discParts), discMaterial(true)),
    mesh(mergeParts(seedParts0), standard({ vertexColors: true, roughness: 0.6, metalness: 0.02 })),
  );
}

// Loose seeds and empty husks on the ground: the litter of a field in September, and the
// thing a student's mouse is programmed to run out and fetch.
export function seedScatter({ count = 18, spread = 9, size = 1.15, husks = 0.3, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = spread * Math.sqrt((i + 0.5) / count);
    const husk = rng() < husks;
    const s = seedParts({
      length: size * (0.85 + rng() * 0.3),
      seed: seed + i * 3,
      tone: husk ? 1.35 : 0.95 + rng() * 0.2,
    });
    for (const part of s) {
      parts.push({
        ...part,
        geometry: placed(part.geometry, {
          pos: [Math.cos(a) * rr + (rng() - 0.5) * spread * 0.2, size * 0.13, Math.sin(a) * rr + (rng() - 0.5) * spread * 0.2],
          rot: [husk ? Math.PI / 2 : (rng() - 0.5) * 0.5, rng() * Math.PI * 2, 0],
          // A husk is a split, emptied hull: flatter, and paler where the sun has had it.
          scale: husk ? [1, 0.45, 1] : [1, 1, 1],
        }),
      });
    }
  }
  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.65 })));
}

// ---------------------------------------------------------------------------
// 4. THE NEST -- the place everything in this world is being carried to
// ---------------------------------------------------------------------------

// The bank at the head of the field, with the burrow mouth dug into its foot.
//
// THE HOLE IS BUILT VOID FIRST, which is the reef cave's rule and the rabbit hole's: what
// reads as a hole is not a dark patch painted on a slope, it is a NEAR-BLACK ARCH standing
// forward inside a dent, with a tunnel behind it that really does go somewhere. Painted on
// the surface it looks like a smudge; sunk with no arch it disappears at thirty feet.
export function nestBank({
  width = 112, height = 44, depth = 64, mouth = 9, seed = 3, tufts = 26,
} = {}) {
  const rng = seededRandom(seed);
  const soil = [];
  const dark = [];
  const green = [];

  // The bank's own section: broad and steep-faced at the front (where it has been cut by
  // weather and by the field), long and gentle behind.
  const stations = [];
  const ROWS = 10;
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const k = Math.cos(t * Math.PI * 0.5);            // 1 at the base, 0 at the crown
    stations.push({
      d: t * height,
      w: (width / 2) * (0.35 + 0.65 * Math.pow(k, 0.85)),
      up: depth * 0.40 * (0.30 + 0.70 * Math.pow(k, 1.5)),
      dn: depth * 0.60 * (0.35 + 0.65 * Math.pow(k, 0.8)),
      b: -depth * 0.02 * t,
      roundUp: 0.78 + 0.22 * t,
      roundDn: 0.9,
    });
  }
  // Where the mouth goes, in the bank's own surface -- asked for rather than guessed, the
  // way everything laid on a curved surface in this project is (loftSampler's whole job).
  const sample = loftSampler(stations, { axis: 'y' });
  const T_MOUTH = 0.055;
  const mouthAt = sample(T_MOUTH, 0.25);

  const bank = solidLoft(stations, {
    sides: 44,
    samples: 26,
    axis: 'y',
    warp: (t, u) => {
      // Lumpy weathered soil. PERIODIC IN u -- a noise field sampled at u and at u+1
      // returns two different numbers and tears the seam open down the whole bank.
      const lump = (smoothNoise3(Math.cos(u * Math.PI * 2) * 2.2 + 3, Math.sin(u * Math.PI * 2) * 2.2, t * 4) - 0.5)
        * height * 0.055 * (0.4 + t);
      // The dent the burrow is dug into: a mouse's doorway is a scoop in the bank, not a
      // hole in a smooth cone, and the scoop is what catches a shadow at the top of the
      // opening. Gaussian in both directions, centred on the mouth.
      const du = Math.abs(((u - 0.25 + 0.5) % 1 + 1) % 1 - 0.5);
      const dent = -mouth * 1.05 * Math.exp(-(du * du) / (2 * 0.035 * 0.035) - ((t - T_MOUTH) ** 2) / (2 * 0.05 ** 2));
      return lump + dent;
    },
  });
  tintPN(bank, (p, nrm) => {
    const t = THREE.MathUtils.clamp(p.y / height, 0, 1);
    // Dry pale crust on top where the sun has had it, damp dark earth in the shade below.
    const c = lerpCol(SUN.soilDark, SUN.soilPale, Math.pow(t, 0.7) * 0.75);
    c.lerp(col(SUN.soil), 0.35);
    // An upward face collects dust and the beginnings of weeds; an overhang stays dark.
    c.lerp(col(SUN.soilPale), Math.max(0, nrm.y) * 0.22);
    c.lerp(col(SUN.soilDark), Math.max(0, -nrm.y) * 0.45);
    const blotch = smoothNoise3(p.x * 0.12, p.y * 0.12, p.z * 0.12);
    c.multiplyScalar(0.84 + 0.32 * blotch);
    return [c.r, c.g, c.b];
  });
  put(soil, bank, 0xffffff, null, null, { keepColor: true });

  // --- the mouth ------------------------------------------------------------
  const mz = mouthAt[2];
  // The throat: a real tunnel running back and DOWN into the bank. A mouse programmed to
  // run home goes into it and is gone, which is worth more than any amount of modelling.
  put(dark, tube([
    [0, mouth * 0.42, mz + 0.4],
    [0, mouth * 0.34, mz - mouth * 1.6],
    [-mouth * 0.5, mouth * 0.05, mz - mouth * 3.2],
  ], [mouth * 0.52, mouth * 0.48, mouth * 0.34], { sides: 16, tubular: 10 }), 0x14100c);
  // The arch itself: near-black, standing a little PROUD of the dent so its own rim casts
  // the shadow that says "opening". Flat on the ground, round over the top -- a mouse hole.
  {
    const outline = [];
    const w = mouth * 0.5;
    const h = mouth * 0.92;
    outline.push([-w, 0]);
    for (let i = 0; i <= 14; i++) {
      const a = Math.PI * (i / 14);
      outline.push([-Math.cos(a) * w, Math.sin(a) * h * 0.78 + h * 0.22]);
    }
    outline.push([w, 0]);
    const arch = extrudeOutline(outline, mouth * 0.30);
    put(dark, placed(arch, { pos: [0, 0.05, mz + mouth * 0.1] }), 0x120e0a);
  }
  // Worn earth and a spoil heap: every burrow has a fan of dug-out soil at its door, and
  // it is the detail that says the hole is LIVED IN.
  for (let i = 0; i < 26; i++) {
    const a = (rng() - 0.5) * 2.2;
    const rr = mouth * (0.7 + rng() * 1.9);
    const s = mouth * (0.10 + rng() * 0.16);
    const lump = ball(s, 7);
    lump.scale(1, 0.5 + rng() * 0.3, 1);
    put(soil, lump, rng() < 0.3 ? SUN.soilPale : SUN.soil,
      [Math.sin(a) * rr, s * 0.25, mz + Math.cos(a) * rr * 0.75 + mouth * 0.3]);
  }
  // A couple of roots prised out of the face, and a stone.
  for (let i = 0; i < 5; i++) {
    const u = 0.25 + (rng() - 0.5) * 0.22;
    const t = 0.12 + rng() * 0.5;
    const a = sample(t, u);
    const b = sample(t + 0.06, u + (rng() - 0.5) * 0.06);
    // `chain`, not `tube`: both ends of a prised-out root stand PROUD of the face (that
    // is what makes it prised out), so a bare sleeve shows a half-foot hole down the
    // middle of each one. chain caps both ends with a ball of the end's own radius, which
    // is also what a broken root looks like.
    chain(soil, SUN.root, [
      { p: [a[0], a[1], a[2] + 0.3], r: 0.5 },
      { p: [(a[0] + b[0]) / 2 + (rng() - 0.5) * 6, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + 2.5 + rng() * 2], r: 0.75 },
      { p: [b[0], b[1], b[2] + 0.4], r: 0.4 },
    ], { sides: 7, detail: 8 });
  }
  for (let i = 0; i < 7; i++) {
    const u = 0.25 + (rng() - 0.5) * 0.4;
    const t = 0.05 + rng() * 0.35;
    const a = sample(t, u);
    const s = 1.2 + rng() * 2.4;
    const stone = ball(s, 8);
    stone.scale(1, 0.7, 0.8);
    put(soil, stone, SUN.stone, [a[0], a[1], a[2] * 0.96]);
  }

  // Weeds and dry grass along the crown, which is what gives the bank its edge against the
  // sky -- a bare mound reads as a heap of spoil rather than as ground.
  for (let i = 0; i < tufts; i++) {
    const u = rng();
    const t = 0.72 + rng() * 0.27;
    const a = sample(t, u);
    const blades = 3 + Math.floor(rng() * 3);
    const hgt = 5 + rng() * 9;
    for (let b = 0; b < blades; b++) {
      const lean = (rng() - 0.5) * 0.9;
      // The base is pushed BACK DOWN INTO the bank by twice its own radius, for the same
      // reason the mouse's whiskers are: `sample` hands back a point ON the surface, and a
      // tube starting exactly there shows its open rim. At a hundred blades along the one
      // edge this bank puts against the sky, that is a row of holes on the skyline.
      put(green, tube([
        [a[0], a[1] - 0.62, a[2]],
        [a[0] + lean * hgt * 0.3, a[1] + hgt * 0.6, a[2] + (rng() - 0.5) * hgt * 0.2],
        [a[0] + lean * hgt, a[1] + hgt, a[2] + (rng() - 0.5) * hgt * 0.4],
      ], [0.30, 0.16, 0.02], { sides: 5, tubular: 6 }), rng() < 0.45 ? SUN.dryGrass : SUN.leafDeep);
    }
  }

  return group(
    mesh(mergeParts(soil), standard({
      vertexColors: true, roughness: 0.96, ...relief('soil', { seed, repeat: 14, strength: 0.8 }),
    })),
    // The throat and the arch are UNLIT-dark rather than merely dark: a hole is the one
    // thing in a sunlit world that has to stay black at every sun angle.
    mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 1, metalness: 0 })),
    mesh(mergeParts(green), standard({ vertexColors: true, roughness: 0.9 })),
  );
}

// The same bank, cut open: the tunnel, the grass nest with the pups in it, and the seed
// store. This is where the world explains itself.
//
// THE VOIDS ARE BUILT FIRST and the soil face is a flat plane at z = 0 that they open
// into: every chamber is a dark shell sitting BEHIND the face with its rim flush to it, so
// what a student sees is a hole rather than a black sticker (the trap Machu Picchu's
// niches and Ellis Island's windows both hit from the other side).
export function nestCutaway({ width = 46, height = 26, depth = 8, seed = 17 } = {}) {
  const rng = seededRandom(seed);
  const soil = [];
  const dark = [];
  const stuff = [];
  const W = width / 2;

  // The block of earth. Its FRONT face is the section, so it is flat and at z = 0.
  const outline = [[-W, 0]];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const x = -W + t * width;
    // A bank's crown, not a rectangle's top edge.
    const y = height * (0.55 + 0.45 * Math.cos((t - 0.5) * Math.PI * 1.1))
      + smoothNoise3(t * 5, 2.1, 0.5) * height * 0.08;
    outline.push([x, y]);
  }
  outline.push([W, 0]);
  const block = extrudeOutline(outline, depth);
  tintPN(block, (p, nrm) => {
    // Soil horizons: dark humus at the top, paler subsoil below, which is a real thing a
    // cut bank shows and the reason a section is worth cutting at all.
    const t = THREE.MathUtils.clamp(p.y / height, 0, 1);
    const band = t + smoothNoise3(p.x * 0.09, 0, p.y * 0.09) * 0.10;
    const c = band > 0.78 ? col(SUN.soilDark) : lerpCol(SUN.soil, SUN.soilPale, THREE.MathUtils.clamp(1 - band * 1.2, 0, 1));
    if (nrm.z > 0.5) c.multiplyScalar(1.06);        // the cut face itself, freshly opened
    c.multiplyScalar(0.86 + 0.28 * smoothNoise3(p.x * 0.3, p.y * 0.3, 4));
    return [c.r, c.g, c.b];
  });
  put(soil, placed(block, { pos: [0, 0, -depth / 2] }), 0xffffff, null, null, { keepColor: true });

  // --- the voids ------------------------------------------------------------
  //
  // THERE IS NO HOLE IN THE CUT FACE, AND THERE CANNOT BE ONE. `extrudeOutline` fans the
  // block's front face from its own centroid, so that face is solid across the whole
  // outline and there is no CSG in this project to cut it with. Everything at z < 0 is
  // therefore behind an opaque wall, whatever it is made of.
  //
  // That is the rule the first pass broke without noticing. Its chamber was a CLOSED
  // ellipsoid pushed back until only a shallow cap of it stood proud of the face -- which
  // is right, and is how Machu Picchu's niches and Ellis Island's windows are built: a
  // dark thing a hair proud reads as a hole because the lit soil around it is the frame.
  // But the nest, the three pups and the thirty-four stored seeds were then placed at
  // z = -0.9 to -2.8, INSIDE that closed ellipsoid and behind the face twice over. Every
  // one of them was modelled, merged, shipped and invisible: the exhibit this whole end of
  // the world exists for rendered as two black blobs on a bank.
  //
  // So a chamber hands back the function that says where its own front surface IS, and
  // everything that goes in one is seated PROUD of that -- the `onShell` idiom from the
  // robots, and the volcano's `surfaceAt` for the same reason: hand-picked depths near a
  // curved surface are either buried or floating, and the two failures look nothing alike.
  const chamber = (cx, cy, rx, ry) => {
    const rz = rx * 0.9;
    const back = -rx * 0.62;
    const shell = ball(1, 18);
    shell.scale(rx, ry, rz);
    put(dark, placed(shell, { pos: [cx, cy, back] }), 0x17110b);
    // The cap's z at an offset from the centre, and how far out the cap still clears the
    // face. Outside `reach` the ellipsoid is behind the wall and nothing put there can be
    // seen, which is what decides how big the nest inside it is allowed to be.
    const front = (dx, dy) => {
      const k = 1 - (dx / rx) ** 2 - (dy / ry) ** 2;
      return k <= 0 ? back : back + rz * Math.sqrt(k);
    };
    const reach = rx * Math.sqrt(Math.max(0, 1 - (back / rz) ** 2));
    return { cx, cy, rx, ry, front, reach };
  };
  // A run: a dark tube in the cut face. Its axis sits ON the face rather than behind it,
  // so the half of it that is proud reads as a channel for the same reason the chambers
  // do. Sunk to -r * 0.55, as it was, it is simply inside the block.
  const run = (pts, r) => {
    put(dark, tube(pts.map((p) => [p[0], p[1], r * 0.18]), pts.map(() => r), { sides: 12, tubular: 12 }), 0x17110b);
  };

  const NEST = chamber(-W * 0.34, height * 0.30, 6.2, 5.0);
  const LARDER = chamber(W * 0.40, height * 0.42, 4.6, 3.8);
  // The mouth, at the foot of the bank on the right, running in and down to the nest.
  run([[W * 0.92, height * 0.10], [W * 0.55, height * 0.20], [W * 0.1, height * 0.34], [NEST.cx + 3, NEST.cy]], 2.3);
  run([[LARDER.cx, LARDER.cy - 2], [W * 0.18, height * 0.36]], 1.9);
  // A bolt run: a second way out that stops just under the surface, which is exactly what
  // a burrowing animal digs and exactly the sort of thing a student asks about.
  run([[NEST.cx - 1, NEST.cy + 3], [-W * 0.55, height * 0.62], [-W * 0.62, height * 0.80]], 1.8);

  // --- what is IN them ------------------------------------------------------
  // The nest: a woven ball of shredded grass with a hollow, and three pups asleep in it.
  // Everything sits FORWARD of the chamber's own back wall, or the exhibit is an empty
  // hole (A Bug's Life's granary, which came out empty while the nursery beside it read).
  // The straws stay inside the chamber's own `reach` -- the radius out to which its cap is
  // still in front of the face. Woven out to 0.98 of the ellipsoid, as they were, most of
  // the nest sat where the wall is even after the depth was fixed.
  const NEST_R = Math.min(NEST.reach * 0.72, NEST.rx * 0.62);
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const rr = NEST_R * (0.55 + rng() * 0.45);
    const len = 2.2 + rng() * 2.6;
    const lean = rng() * Math.PI;
    const dx = Math.cos(a) * rr;
    const dy = Math.sin(a) * rr * 0.8;
    const z = NEST.front(dx, dy) + 0.5 + rng() * 1.1;
    put(stuff, tube([
      [NEST.cx + dx - Math.cos(lean) * len * 0.5, NEST.cy + dy - Math.sin(lean) * len * 0.3, z],
      [NEST.cx + dx + Math.cos(lean) * len * 0.5, NEST.cy + dy + Math.sin(lean) * len * 0.3, z + 0.2],
    ], [0.12, 0.10], { sides: 4, tubular: 3 }), rng() < 0.4 ? SUN.nestGrassDeep : SUN.nestGrass);
  }
  // THREE PUPS IN A ROW, not three on a small arc. They were placed at a = -0.4, 0.1, 0.6
  // on a radius of 1.9, which puts all three at x = 1.6..1.9 and spreads them 0.29ft in y
  // -- less than a fifth of one pup's own width. Rendered, they were a single pink mass,
  // and the count is the point: a placard says three.
  for (let i = 0; i < 3; i++) {
    const dx = (i - 1) * 1.5;
    const dy = -1.15 + (i === 1 ? 0.3 : 0);
    const z = NEST.front(dx, dy) + 1.0;
    const pup = ball(0.85, 12);
    pup.scale(1.5, 0.9, 1);
    put(stuff, placed(pup, { pos: [NEST.cx + dx, NEST.cy + dy, z], rot: [0, 0, 0.35 - i * 0.35] }), 0xe8b8a8);
    // The head, on alternating sides so the row does not read as one sausage.
    const hx = dx + (i === 1 ? -1.0 : 1.0);
    put(stuff, ball(0.34, 8), 0xe8b8a8,
      [NEST.cx + hx, NEST.cy + dy + 0.28, NEST.front(hx, dy + 0.28) + 0.95]);
  }
  // The larder: the seed store, which is the whole reason for the world's traffic.
  const LARDER_R = Math.min(LARDER.reach * 0.7, LARDER.rx * 0.6);
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2;
    const rr = LARDER_R * Math.sqrt(rng());
    const dx = Math.cos(a) * rr;
    const dy = -LARDER.ry * 0.3 + Math.sin(a) * rr * 0.45;
    const s = seedParts({ length: 1.3, seed: seed + i, tone: 0.95 + rng() * 0.2 });
    for (const part of s) {
      stuff.push({
        ...part,
        geometry: placed(part.geometry, {
          pos: [LARDER.cx + dx, LARDER.cy + dy, LARDER.front(dx, dy) + 0.55 + rng() * 0.8],
          rot: [rng() * 0.6, rng() * Math.PI * 2, rng() * 0.6],
        }),
      });
    }
  }

  return group(
    mesh(mergeParts(soil), standard({
      vertexColors: true, roughness: 0.96, ...relief('soil', { seed, repeat: 10, strength: 0.75 }),
    })),
    mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 1 })),
    mesh(mergeParts(stuff), standard({ vertexColors: true, roughness: 0.85 })),
  );
}

// ---------------------------------------------------------------------------
// 5. THE GROUND A MOUSE RUNS ON
// ---------------------------------------------------------------------------

// Grass and weeds between the rows. At this scale a blade of foxtail is a twenty-foot
// mast, and the whole clump sways on the wind shader -- opted in by key in Wind.js, which
// is why `position.y` here has to be honest height above the base.
export function prairieGrass({
  height = 18, count = 16, spread = 7, dry = 0.35, seed = 5, seedHeads = true,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = spread * Math.sqrt((i + 0.4) / count);
    const x0 = Math.cos(a) * rr;
    const z0 = Math.sin(a) * rr;
    const h = height * (0.55 + rng() * 0.75);
    const lean = (rng() - 0.5) * 1.5;
    const leanZ = (rng() - 0.5) * 1.5;
    const isDry = rng() < dry;
    // A blade is SAMPLED ALONG A CURVE, not stacked in segments: the sideways drift grows
    // far faster than the vertical spacing, so a segment-stacked blade comes apart into
    // green dashes halfway up (A Bug's Life learned this on exactly this shape).
    const tip = [x0 + lean * h * 0.55, h, z0 + leanZ * h * 0.55];
    const mid = [x0 + lean * h * 0.16, h * 0.62, z0 + leanZ * h * 0.16];
    // The base starts BELOW the ground plane, not on it. A blade is a tube and a tube's
    // base rim is open; started at y = 0 that ring is exactly coplanar with the terrain,
    // so on any slope at all half of it lifts clear and the blade is a pipe with a hole
    // in the end. Twenty-six of these patches are planted in this world.
    put(parts, tube([[x0, -h * 0.05, z0], mid, tip], [h * 0.022, h * 0.012, h * 0.0015], {
      sides: 5, tubular: 8,
    }), isDry ? SUN.dryGrass : (rng() < 0.5 ? SUN.leaf : SUN.leafDeep));
    // A seed head on some of them: this is a field in September and the grass has gone
    // over, which is also where half the nest lining in this world comes from.
    if (seedHeads && isDry && rng() < 0.6) {
      const spike = solidLoft([
        { d: 0, w: h * 0.012, up: h * 0.012, dn: h * 0.012, round: 1 },
        { d: h * 0.10, w: h * 0.035, up: h * 0.035, dn: h * 0.035, round: 1 },
        { d: h * 0.22, w: h * 0.008, up: h * 0.008, dn: h * 0.008, round: 1 },
      ], { sides: 7, samples: 6, axis: 'y' });
      put(parts, placed(spike, { pos: tip, rot: [leanZ * 0.5, 0, -lean * 0.5] }), SUN.nestGrass);
    }
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.9, ...relief('bark', { seed, repeat: 6, strength: 0.3 }),
  })));
}

// The other colour in a Kansas field: coneflowers, black-eyed Susans and cornflowers
// between the rows. The sunflowers are gold and green from end to end, and a field with
// nothing else in it reads as one colour however bright that colour is.
const PRAIRIE = {
  coneflower: { ray: 0xd06aa8, rayTip: 0xe79ac8, centre: 0xb4622c, cone: 1.0, droop: 0.55, petals: 13 },
  susan: { ray: 0xf5a623, rayTip: 0xffd166, centre: 0x4a3218, cone: 0.55, droop: 0.18, petals: 14 },
  cornflower: { ray: 0x5b7fd4, rayTip: 0x89a9ea, centre: 0x3f5ba8, cone: 0.35, droop: -0.1, petals: 11 },
  milkweed: { ray: 0xe8722c, rayTip: 0xf5a05a, centre: 0xd85a1e, cone: 0.3, droop: 0.05, petals: 16 },
};

export function prairieFlower({
  kind = 'coneflower', height = 22, seed = 7, blooms = 2,
} = {}) {
  const rng = seededRandom(seed);
  const cfg = PRAIRIE[kind] || PRAIRIE.coneflower;
  const parts = [];

  for (let b = 0; b < blooms; b++) {
    const h = height * (b === 0 ? 1 : 0.62 + rng() * 0.25);
    const lean = (rng() - 0.5) * 0.5;
    const leanZ = (rng() - 0.5) * 0.5;
    const top = [lean * h * 0.35, h, leanZ * h * 0.35];
    put(parts, tube([
      [0, -h * 0.04, 0],          // rooted under the ground, for the blade's reason above
      [lean * h * 0.1, h * 0.5, leanZ * h * 0.1],
      top,
    ], [h * 0.016, h * 0.011, h * 0.008], { sides: 6, tubular: 8 }), SUN.leafDeep);

    // Narrow lance-shaped leaves up the stem -- prairie plants have thin leaves, and a
    // sunflower's heart-shaped ones on a coneflower would read as a small sunflower.
    for (let i = 0; i < 3; i++) {
      const t = 0.18 + i * 0.2;
      const az = i * 2.3 + rng();
      const L = h * (0.22 - i * 0.04);
      const blade = solidSurface({
        nu: 5,
        nv: 9,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          const hw = L * 0.10 * Math.sin(Math.PI * Math.pow(v, 0.55)) * (1 - v * 0.3);
          return [s * hw, -v * v * L * 0.35, v * L];
        },
        thick: (u, v) => L * 0.006 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - Math.pow(v, 3)),
      });
      bandUV(blade, BAND.leaf);
      put(parts, aimed(blade, {
        yaw: az, pitch: -0.5,
        at: [lean * h * 0.1 * t, h * t, leanZ * h * 0.1 * t],
      }), SUN.leaf);
    }

    // The bloom: a ring of ray florets round a raised centre. A coneflower's rays DROOP,
    // which is the one thing that tells it from a daisy at any distance.
    const R = h * 0.16;
    const n = cfg.petals;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.1;
      const L = R * (0.85 + rng() * 0.3);
      const W = L * 0.24;
      const petal = solidSurface({
        nu: 4,
        nv: 7,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          const hw = W * Math.sin(Math.PI * Math.pow(THREE.MathUtils.clamp(v * 1.05, 0, 1), 0.6));
          return [s * hw, R * 0.22 + v * L, -cfg.droop * L * v * v + (s * s) * hw * 0.4];
        },
        thick: (u, v) => W * 0.07 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - Math.pow(v, 3)),
      });
      bandUV(petal, BAND.petal);
      tintPN(petal, (p) => {
        const c = lerpCol(cfg.ray, cfg.rayTip, THREE.MathUtils.clamp((p.y - R * 0.22) / L, 0, 1) * 0.8);
        return [c.r, c.g, c.b];
      });
      put(parts, placed(aimed(petal, { roll: a }), {
        pos: top, rot: [-Math.PI / 2 + 0.25, 0, 0],
      }), 0xffffff, null, null, { keepColor: true });
    }
    // The centre: a cone on a coneflower, a low dome on a Susan.
    const centre = ball(R * 0.34, 12);
    centre.scale(1, cfg.cone * 1.5, 1);
    put(parts, placed(centre, { pos: [top[0], top[1] + R * 0.12, top[2]] }), cfg.centre);
    // Pollen speckle so the middle is not a flat bead.
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const rr = R * 0.3 * Math.sqrt(rng());
      put(parts, ball(R * 0.035, 5), SUN.pollen,
        [top[0] + Math.cos(a) * rr, top[1] + R * 0.12 + cfg.cone * R * 0.4, top[2] + Math.sin(a) * rr]);
    }
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.82,
    map: sharedTexture(botanicalCanvas()),
    bumpMap: sharedTexture(botanicalCanvas(), { srgb: false }),
    bumpScale: 0.22,
  })));
}

// Nest material lying about the field: what the mice are carrying when they are not
// carrying seed. Four kinds, one builder -- they are all small things on the ground.
export function nestMaterial({ kind = 'grass', size = 6, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  if (kind === 'grass') {
    // A drift of dry stems, the way a swath of cut grass lies.
    for (let i = 0; i < 26; i++) {
      const a = (rng() - 0.5) * 0.9 + 0.4;
      const len = size * (0.5 + rng() * 0.8);
      const x = (rng() - 0.5) * size;
      const z = (rng() - 0.5) * size * 0.7;
      put(parts, tube([
        [x - Math.cos(a) * len * 0.5, size * 0.03 + rng() * size * 0.06, z - Math.sin(a) * len * 0.5],
        [x, size * 0.05 + rng() * size * 0.08, z],
        [x + Math.cos(a) * len * 0.5, size * 0.03 + rng() * size * 0.06, z + Math.sin(a) * len * 0.5],
      ], [0.05, 0.075, 0.04], { sides: 4, tubular: 5 }), rng() < 0.5 ? SUN.dryGrass : SUN.nestGrassDeep);
    }
  } else if (kind === 'feather') {
    // A feather a bird dropped: the warmest lining a mouse can find.
    const L = size * 1.4;
    const shaft = tube([[0, 0.12, -L * 0.5], [0, 0.22, 0], [0, 0.16, L * 0.5]], [0.07, 0.05, 0.02], { sides: 6, tubular: 6 });
    put(parts, shaft, 0xf2ece0);
    const vane = solidSurface({
      nu: 9,
      nv: 16,
      point: (u, v) => {
        const s = (u - 0.5) * 2;
        const hw = L * 0.16 * Math.sin(Math.PI * Math.pow(v, 0.7)) * (1 - v * 0.25);
        // Barbs sweep back toward the tip, so the vane is a leaf shape with a soft edge.
        return [s * hw, 0.16 + Math.abs(s) * 0.05, -L * 0.5 + v * L + Math.abs(s) * hw * 0.5];
      },
      thick: (u, v) => 0.035 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 1.6)) * (1 - Math.pow(v, 3)),
    });
    tintPN(vane, (p) => {
      const c = lerpCol(SUN.down, 0xcfc2ac, THREE.MathUtils.clamp(Math.abs(p.x) / (L * 0.16), 0, 1) * 0.6);
      c.multiplyScalar(0.92 + 0.14 * smoothNoise3(p.x * 2, 0, p.z * 2));
      return [c.r, c.g, c.b];
    });
    put(parts, vane, 0xffffff, null, null, { keepColor: true });
  } else if (kind === 'down') {
    // Thistle down caught on the ground: a puff of fibres round a seed.
    for (let i = 0; i < 24; i++) {
      const a = rng() * Math.PI * 2;
      const el = rng() * 1.2;
      const len = size * (0.3 + rng() * 0.35);
      put(parts, tube([
        [0, size * 0.22, 0],
        [Math.cos(a) * len * 0.6, size * 0.22 + Math.sin(el) * len * 0.5, Math.sin(a) * len * 0.6],
        [Math.cos(a) * len, size * 0.22 + Math.sin(el) * len * 0.9, Math.sin(a) * len],
      ], [0.05, 0.035, 0.012], { sides: 4, tubular: 5 }), SUN.down);
    }
    put(parts, ball(size * 0.09, 8), SUN.seedMid, [0, size * 0.20, 0]);
  } else if (kind === 'leaf') {
    // A fallen sunflower leaf, dried and curling: cover for a mouse and roof for a nest.
    const L = size * 1.6;
    const W = L * 0.5;
    const blade = solidSurface({
      nu: 11,
      nv: 18,
      point: (u, v) => {
        const s = (u - 0.5) * 2;
        const swell = Math.pow(THREE.MathUtils.clamp(v / 0.20, 0, 1), 0.62);
        const taper = Math.pow(1 - v, 0.60) / 0.836;
        const point = Math.pow(THREE.MathUtils.clamp((1 - v) / 0.10, 0, 1), 0.45);
        const hw = W * 0.5 * swell * taper * point * (1 + 0.05 * Math.sin(v * Math.PI * 14));
        // Curled: a dry leaf lifts its margins off the ground, which is what makes it a
        // dry leaf rather than a green one lying flat.
        const curl = (s * s) * hw * 0.8 + Math.pow(v, 2) * L * 0.10;
        return [s * hw, curl, v * L - L * 0.45];
      },
      thick: (u, v) => L * 0.004 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - Math.pow(v, 3)) + 0.02,
    });
    bandUV(blade, BAND.leaf);
    tintPN(blade, (p) => {
      const c = lerpCol(SUN.leafDry, SUN.stemDry, smoothNoise3(p.x * 0.5, p.z * 0.5, 3));
      c.lerp(col(SUN.leafDeep), Math.max(0, 0.35 - Math.abs(p.x) * 0.05));
      return [c.r, c.g, c.b];
    });
    put(parts, placed(blade, { pos: [0, 0.05, 0], rot: [0, rng() * Math.PI, 0] }), 0xffffff, null, null,
      { keepColor: true });
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true,
    roughness: 0.88,
    map: sharedTexture(botanicalCanvas()),
    bumpMap: sharedTexture(botanicalCanvas(), { srgb: false }),
    bumpScale: 0.2,
  })));
}

// THE RUNWAY. Mice really do wear paths through a field -- flattened, scuffed runs between
// the food and the nest that they use over and over -- and this world's whole layout hangs
// off one. It is ONE PROP for the same reason The Neighborhood's street grid is: the seams
// between separately-placed segments are exactly where z-fighting and hairline gaps live.
export function mouseRunway({
  points = [[0, 0], [0, -60]], width = 13, seed = 23, litter = 40,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = points.length;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    // The normal to the path, which is where the edges go.
    const nx = -dz / len;
    const nz = dx / len;
    // A worn path is not a ruled stripe: its width wanders.
    const half = (width / 2) * (0.78 + 0.36 * smoothNoise3(i * 0.7, 3.2, 0.5));
    if (i > 0) run += Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]);
    for (const s of [-1, 1]) {
      positions.push(p[0] + nx * half * s, 0.05, p[1] + nz * half * s);
      uvs.push(s > 0 ? 1 : 0, run / width);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const strip = new THREE.BufferGeometry();
  strip.setIndex(indices);
  strip.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  strip.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  strip.computeVertexNormals();
  tintPN(strip, (p) => {
    // Packed bare earth down the middle, scuffed and paler at the edges where the dust is
    // kicked out -- and darker in patches, because a run is not a painted line.
    const c = lerpCol(SUN.soil, SUN.soilDark, 0.45 + 0.35 * smoothNoise3(p.x * 0.06, 0, p.z * 0.06));
    c.multiplyScalar(0.9 + 0.2 * smoothNoise3(p.x * 0.4, 1, p.z * 0.4));
    return [c.r, c.g, c.b];
  });
  put(parts, strip, 0xffffff, null, null, { keepColor: true });

  // Husks, chaff and trodden litter along it. This is what says ANIMALS USE THIS -- a bare
  // brown ribbon reads as a road.
  for (let i = 0; i < litter; i++) {
    const t = rng() * (n - 1);
    const k = Math.floor(t);
    const f = t - k;
    const p0 = points[k];
    const p1 = points[Math.min(n - 1, k + 1)];
    const x = p0[0] + (p1[0] - p0[0]) * f + (rng() - 0.5) * width * 1.1;
    const z = p0[1] + (p1[1] - p0[1]) * f + (rng() - 0.5) * width * 1.1;
    if (rng() < 0.45) {
      const s = seedParts({ length: 0.9 + rng() * 0.4, seed: seed + i, tone: 1.2 });
      for (const part of s) {
        parts.push({
          ...part,
          geometry: placed(part.geometry, { pos: [x, 0.14, z], rot: [Math.PI / 2, rng() * 6.28, 0], scale: [1, 0.5, 1] }),
        });
      }
    } else {
      const clod = ball(0.3 + rng() * 0.7, 6);
      clod.scale(1, 0.55, 0.85);
      put(parts, placed(clod, { pos: [x, 0.08, z], rot: [0, rng() * 6.28, 0] }),
        rng() < 0.4 ? SUN.soilPale : SUN.soilDark);
    }
  }

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.97, ...relief('soil', { seed, repeat: 26, strength: 0.7 }),
  })));
  // A path is FLAT ON THE GROUND: it cannot cast a shadow without drawing a dark line
  // along its own edge, and it receives one from everything standing over it.
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// Clods, stones and dry litter -- the ground detail that stops a tilled field reading as
// a carpet. Merged to one mesh; placed in handfuls rather than one at a time.
export function soilClods({ count = 14, spread = 10, size = 1.6, seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = spread * Math.sqrt((i + 0.5) / count);
    const s = size * (0.4 + rng() * 1.1);
    const clod = ball(s, 7);
    clod.scale(1, 0.45 + rng() * 0.35, 0.8 + rng() * 0.4);
    const stone = rng() < 0.22;
    put(parts, placed(clod, {
      pos: [Math.cos(a) * rr, s * 0.18, Math.sin(a) * rr],
      rot: [(rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4],
    }), stone ? SUN.stone : (rng() < 0.5 ? SUN.soil : SUN.soilDark));
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.95, ...relief('soil', { seed, repeat: 8, strength: 0.85 }),
  })));
}

// A bumblebee working the flowers: two feet of it at this scale, and the only thing in the
// world that flies. Its wings blur on the per-frame tick the registry has always called.
export function bumbleBee({ size = 2.4, seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const body = [];
  const wings = [];
  const S = size / 2.4;
  // Abdomen, thorax and head in one line, with the bands that make it a bumblebee rather
  // than a fly.
  const abdomen = solidLoft([
    { d: -1.35, w: 0.06, up: 0.06, dn: 0.06, round: 1 },
    { d: -1.0, w: 0.34, up: 0.32, dn: 0.30, round: 1 },
    { d: -0.45, w: 0.46, up: 0.44, dn: 0.40, round: 1 },
    { d: 0.05, w: 0.42, up: 0.40, dn: 0.36, round: 1 },
    { d: 0.30, w: 0.30, up: 0.30, dn: 0.28, round: 1 },
  ], { sides: 18, samples: 14, axis: 'z' });
  tintPN(abdomen, (p) => {
    const band = Math.sin(p.z * 6.5) > 0 ? SUN.bee : SUN.beeDark;
    const c = col(p.z < -1.1 ? SUN.down : band);
    return [c.r, c.g, c.b];
  });
  put(body, abdomen, 0xffffff, null, null, { keepColor: true });
  const thorax = ball(0.44, 14);
  thorax.scale(1, 0.95, 1.05);
  put(body, placed(thorax, { pos: [0, 0, 0.55] }), SUN.bee);
  put(body, ball(0.28, 12), SUN.beeDark, [0, -0.02, 1.08]);
  for (const sx of [-1, 1]) {
    put(body, ball(0.10, 8), 0x1a1612, [sx * 0.17, 0.05, 1.22]);
    // Antennae and the six legs, which is what stops it reading as a bead on a stick.
    put(body, tube([[sx * 0.08, 0.12, 1.28], [sx * 0.25, 0.32, 1.6], [sx * 0.42, 0.24, 1.85]],
      [0.035, 0.025, 0.012], { sides: 4, tubular: 5 }), SUN.beeDark);
    for (let i = 0; i < 3; i++) {
      const z = 0.75 - i * 0.42;
      put(body, tube([[sx * 0.3, -0.25, z], [sx * 0.62, -0.5, z - 0.12], [sx * 0.72, -0.75, z - 0.3]],
        [0.055, 0.04, 0.025], { sides: 4, tubular: 4 }), SUN.beeDark);
    }
  }
  // Wings: a real pair each side, translucent, and the ONE transparent thing in the world.
  const wingPair = [];
  for (const sx of [-1, 1]) {
    for (const [len, wid, back] of [[1.25, 0.34, 0], [0.85, 0.26, -0.35]]) {
      const wing = solidSurface({
        nu: 6,
        nv: 10,
        point: (u, v) => {
          const s = (u - 0.5) * 2;
          const hw = wid * Math.sin(Math.PI * Math.pow(THREE.MathUtils.clamp(v * 1.05, 0, 1), 0.55));
          return [sx * (0.3 + v * len), 0.22 + s * hw * 0.15, back + s * hw + v * 0.15 * sx * 0];
        },
        thick: (u, v) => 0.018 * Math.max(0, 1 - Math.pow(Math.abs((u - 0.5) * 2), 2)) * (1 - Math.pow(v, 4)),
      });
      put(wingPair, wing, 0xe8f0f8);
    }
  }
  wings.push(...wingPair);

  const g = group(mesh(mergeParts(body), standard({
    vertexColors: true, roughness: 0.85, ...relief('weave', { seed, repeat: 10, strength: 0.6 }),
  })));
  const wingMesh = mesh(mergeParts(wings), standard({
    vertexColors: true, roughness: 0.25, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
  }));
  wingMesh.castShadow = false;
  g.add(wingMesh);
  g.scale.setScalar(S);
  g.position.y = size * 0.55;

  // A hover, and a wingbeat. A bee standing perfectly still on a flower is a brooch.
  let t = rng() * 10;
  const baseY = g.position.y;
  g.userData.tick = {
    update(dt) {
      t += dt;
      g.position.y = baseY + Math.sin(t * 2.6) * size * 0.06;
      g.rotation.y = Math.sin(t * 0.7) * 0.25;
      // The wings beat far faster than the frame rate can show, so what is drawn is the
      // BLUR: a shallow flutter plus a scale wobble, which reads as movement where a
      // literal 200Hz beat would strobe.
      wingMesh.rotation.z = Math.sin(t * 26) * 0.32;
      wingMesh.scale.y = 0.9 + Math.abs(Math.sin(t * 26)) * 0.2;
    },
  };
  return g;
}
