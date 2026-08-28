import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  solidLoft, revolve, extrudeOutline, sweepProfile, solidSurface,
  ball, tube, chain, spike, dome, mergeParts, tintGeometry, placed, xformed,
  roundedOutline, lensOutline, put, smoothNoise3, grooveAt,
} from './LoftKit.js';

// Alice in Wonderland -- four hero characters read at SIX FEET (Alice, the Cheshire Cat,
// the Mad Hatter, the White Rabbit), the mad tea party they belong to, and the dream
// garden around them: giant mushrooms, card soldiers painting the roses, a rabbit hole,
// and a signpost that cannot make up its mind.
//
// THE ONE DECISION THAT SHAPES THIS FILE: these are CHARACTERS, not buildings, and a
// character is read almost entirely in its FACE and its SILHOUETTE. So the budget goes
// where the robot world's went -- high segment counts on heads and bodies a student
// stands nose to nose with, every button and eye positioned by asking the shell where
// its surface is (`onShell`), and every limb through `chain`, which sockets every joint
// by construction. Nothing is placed ON a surface; it is SUNK INTO one.
//
// The palette is the second half of the brief. Wonderland is polychrome the way a
// storybook plate is: Alice's cornflower blue against white, the Hatter's teal coat
// against a crimson vest and a green hat, the Cat striped lavender and rose, and the
// garden carrying gold, mint and mushroom scarlet. Every colour is named in WONDER
// below so the world stays one deck of cards rather than forty guesses.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const WONDER = {
  // Alice
  skin: 0xf3d2b0,
  blush: 0xe8a58a,
  hair: 0xeec25b,
  hairDeep: 0xc89a3c,
  band: 0x27314e,
  dress: 0x5b8fdc,
  dressDeep: 0x4271b8,
  apron: 0xfaf6ec,
  stocking: 0xf2f0e8,
  shoe: 0x2c2119,
  iris: 0x3f6fc2,
  lip: 0xc95f5f,

  // Cheshire Cat
  fur: 0xd9c6ee,
  furStripe: 0x9b76cc,
  furRose: 0xe2a2cc,
  furBelly: 0xf3ecf8,
  earPink: 0xd884b4,
  catNose: 0xc66a96,
  eyeGold: 0xf5c33b,
  mouthPlum: 0x46224e,
  tooth: 0xfdfaef,

  // Mad Hatter
  coat: 0x2f8c80,
  coatDeep: 0x226359,
  vest: 0xc23b4a,
  trouser: 0x5c5844,
  hat: 0x46a06d,
  hatDeep: 0x2f7a4e,
  bandPink: 0xd35f74,
  bandDeep: 0xa93a50,
  ruff: 0xfaf7ee,
  hatterHair: 0xe0782e,

  // White Rabbit
  rabbitFur: 0xf5f1e9,
  rabbitShade: 0xdcd6c8,
  rabbitEar: 0xf0b0c4,
  rabbitEye: 0xd84a55,
  waistcoat: 0x7b59c8,
  pinstripe: 0xa98fe0,
  bowRed: 0xd23558,

  // The garden
  gold: 0xd8a53f,
  brass: 0xb8863a,
  cream: 0xf5efdd,
  ink: 0x2c2733,
  wood: 0x8a5f3c,
  woodDeep: 0x60401f,
  bark: 0x4c3a4a,
  barkDeep: 0x352637,
  leaf: 0x3f8a55,
  leafDeep: 0x2e6b46,
  canopyTeal: 0x2f6e5e,
  blossom: 0xf0a8c8,
  blossomDeep: 0xd67ba6,
  mushroomRed: 0xd0453e,
  mushroomCream: 0xf0e3c8,
  roseRed: 0xd23b52,
  roseWhite: 0xfaf4ea,
  hedge: 0x3a7a48,
  cardWhite: 0xf7f3e8,
  heart: 0xc9203a,
  spade: 0x2b2733,
  teal: 0x64c4b4,
  pinkCup: 0xf0b8cc,
  mint: 0xb4e0c0,
  lilac: 0xc8b4e8,
  sky: 0xa8cce8,
};

const PASTELS = [WONDER.pinkCup, WONDER.mint, WONDER.lilac, WONDER.sky, WONDER.cream, WONDER.teal];

// ---------------------------------------------------------------------------
// Local helpers -- the ones that make "leave no open spaces" structural
// ---------------------------------------------------------------------------

// `revolve` decides its winding from the profile's direction: a bottom-up profile comes
// out inside out and renders DARK, not missing. Everything here lathes through this.
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

// mergeParts composes its Euler as Rx*Ry*Rz, so "turn in plan, then lay flat" cannot be
// said with one Euler. Bake the matrix in the order actually wanted (RobotProps' laid).
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

// A point on an ellipsoid in a given direction, with that surface's TRUE normal (the
// gradient, which is not the direction wherever the radii differ). Every eye, button,
// nose and cheek in this file is placed through here rather than by hand.
function onShell(centre, radii, dir) {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const [rx, ry, rz] = radii;
  const k = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
  const p = [centre[0] + d.x * k, centre[1] + d.y * k, centre[2] + d.z * k];
  const n = new THREE.Vector3((d.x * k) / (rx * rx), (d.y * k) / (ry * ry), (d.z * k) / (rz * rz)).normalize();
  return { p, n: [n.x, n.y, n.z] };
}

const off = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];

// The Euler that aims a +Y-authored cone along direction `d`. mergeParts composes its
// Euler as Rx*Ry*Rz -- Rz FIRST, then Ry -- so [pi/2, yaw, 0] aims every cone at +Z
// whatever the yaw says. Tip about Z first, then swing about Y.
function aimRot(d) {
  const v = new THREE.Vector3(d[0], d[1], d[2]).normalize();
  const tilt = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));
  return [0, Math.atan2(-v.z, v.x), -tilt];
}

// A CLOSED flattened ball sunk into whatever it stands on, aligned to that surface's
// normal -- every button, lens, nose, spot and boss here is one. Closed, never partial:
// a partial sphere's rim is a hole and its inside is back faces.
function stud(list, colour, {
  at, normal = [0, 1, 0], radius, rise, wide = 1, long = 1, sink = 0.55, detail = 14, tint = null,
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

// Arbitrary geometry authored facing +Z, swung to lie along a surface normal.
function facePlate(list, colour, geometry, { at, normal, sink = 0 }) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n),
  );
  m.setPosition(at[0] - n.x * sink, at[1] - n.y * sink, at[2] - n.z * sink);
  list.push({ geometry: xformed(geometry, m), color: colour });
}

// A sphere as loft stations with an independent front (+Z) squash and an independent
// width -- a character head is wider than deep and flatter at the face, and this is
// what lets the eyes stand proud of it (the robot's HEAD_FRONT lesson).
function headStations(R, { rows = 24, front = 1, wide = 1, tall = 1 } = {}) {
  const st = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    const s = Math.max(0.004, Math.sin(phi) * R);
    st.push({ d: -Math.cos(phi) * R * tall, w: s * wide, up: s * front, dn: s, round: 1 });
  }
  return st;
}

// A run of points lying ON an ellipsoid shell along an azimuth/elevation path --
// the smile arcs, the grin band and the lip lines are all built on this.
function shellArc(centre, radii, steps, azEl, proud = 0.01) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [az, el] = azEl(t);
    const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const { p, n } = onShell(centre, radii, dir);
    pts.push(off(p, n, proud));
  }
  return pts;
}

// Shrink-to-fit text on a canvas: measured, never guessed. The fourth time this project
// has learned that a drawn line a few words too long clips mid-word.
function fitText(ctx, text, maxWidth, px, font) {
  let size = px;
  for (; size > 8; size -= 1) {
    ctx.font = font.replace('{px}', String(size));
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  return size;
}

// A small canvas-textured plate (a label, a watch face, a card face). A separate mesh,
// because a material cannot carry both a map and vertex colours without multiplying
// them -- the plate always sits proud of a solid backing in the merged mesh behind it.
function texPlate(w, h, texW, texH, draw, { rough = 0.7 } = {}) {
  const texture = canvasTexture(texW, texH, draw);
  return mesh(new THREE.PlaneGeometry(w, h), standard({ map: texture, roughness: rough }));
}

const col = (hex) => new THREE.Color(hex);
const mixCol = (a, b, t) => col(a).lerp(col(b), t);

// ---------------------------------------------------------------------------
// ALICE
// ---------------------------------------------------------------------------

// 4.7ft tall -- a head shorter than the 5ft student standing next to her, which is what
// makes her read as a girl rather than a small adult. Storybook proportions (a head
// about a fifth of her height), cornflower dress with the white pinafore painted onto
// the SAME loft by tint -- one solid, two garments, no seam to open -- and a wave,
// because a greeter with both arms at her sides reads as a mannequin.
export function alice({ seed = 5, height = 4.7 } = {}) {
  const rng = seededRandom(seed);
  const skin = [];   // skin + hair: soft matte
  const cloth = [];  // dress, apron, stockings, shoes: weave relief
  const glow = [];   // eye highlights only

  const HEAD_R = 0.46;
  const HEAD_C = [0, 4.06, 0.02];
  const HEAD_FRONT = 0.86;
  const HEAD_RADII = [HEAD_R * 1.02, HEAD_R, HEAD_R * HEAD_FRONT];

  // --- the dress: hem to neck as ONE loft, apron painted by tint ------------
  const hemY = 1.92;
  const dressStations = [
    { d: hemY, w: 1.30, up: 1.06, dn: 1.06, round: 1 },
    { d: 2.20, w: 1.06, up: 0.88, dn: 0.88, round: 1 },
    { d: 2.62, w: 0.62, up: 0.52, dn: 0.52, round: 1 },
    { d: 2.98, w: 0.43, up: 0.36, dn: 0.36, round: 1 },
    { d: 3.30, w: 0.47, up: 0.38, dn: 0.36, round: 1 },
    { d: 3.56, w: 0.46, up: 0.36, dn: 0.34, round: 1 },
    { d: 3.72, w: 0.30, up: 0.24, dn: 0.24, round: 1 },
    { d: 3.80, w: 0.14, up: 0.12, dn: 0.12, round: 1 },
  ];
  // Eight pleats over 76 sides is over nine samples a cycle -- the Nyquist floor this
  // project holds every warp to. The pleats die above the waist.
  const dress = solidLoft(dressStations, {
    sides: 76, samples: 40, axis: 'y',
    warp: (t, u) => {
      const skirt = THREE.MathUtils.clamp((0.45 - t) / 0.45, 0, 1);
      return Math.sin(u * Math.PI * 2 * 8) * 0.028 * skirt;
    },
  });
  put(cloth, dress, 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const az = Math.atan2(p.x, p.z); // 0 is straight ahead
      const t = (p.y - hemY) / (3.8 - hemY);
      // The apron: a bib above the waist, a wider panel over the skirt, and a waistband.
      const bib = t > 0.58 && t < 0.92 && Math.abs(az) < 0.44;
      const panel = t <= 0.58 && Math.abs(az) < 0.78 - t * 0.3;
      const belt = t > 0.52 && t < 0.60 && Math.abs(az) < 1.2;
      if (bib || panel || belt) {
        const c = col(WONDER.apron);
        const shade = 1 - Math.max(0, Math.sin(az * 8)) * 0.05;
        return [c.r * shade, c.g * shade, c.b * shade];
      }
      // Dress blue, shaded into its own pleats so the folds read in flat light.
      const pleat = 0.5 + 0.5 * Math.sin(az * 8 + Math.PI / 2);
      const c = mixCol(WONDER.dressDeep, WONDER.dress, 0.45 + pleat * 0.55);
      return [c.r, c.g, c.b];
    },
  });

  // Hem band and collar: thin white rings sunk into the dress surface.
  const hemPts = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    hemPts.push([Math.sin(a) * 1.31, hemY + 0.10, Math.cos(a) * 1.07]);
  }
  put(cloth, sweepProfile(hemPts, lensOutline(0.09, 0.035), { closed: true, samples: 80 }), WONDER.apron);

  // Peter Pan collar: two rounded lobes at the neckline.
  for (const sx of [-1, 1]) {
    stud(cloth, WONDER.apron, {
      at: [sx * 0.13, 3.74, 0.13], normal: [sx * 0.25, 0.75, 0.6],
      radius: 0.13, rise: 0.05, wide: 1, long: 1.25, sink: 0.3,
    });
    // Apron shoulder straps, arcing from the bib's top edge over to the back.
    chain(cloth, WONDER.apron, [
      { p: [sx * 0.17, 3.60, 0.30], r: 0.042 },
      { p: [sx * 0.30, 3.70, 0.02], r: 0.042 },
      { p: [sx * 0.22, 3.58, -0.26], r: 0.042 },
    ], { sides: 8 });
  }

  // The apron bow at the small of her back: two loops and two tails, all solids.
  for (const sx of [-1, 1]) {
    put(cloth, extrudeOutline(lensOutline(0.30, 0.115), 0.07), WONDER.apron,
      [sx * 0.30, 3.02, -0.40], [0.12, sx * 0.75, sx * 0.25]);
    put(cloth, extrudeOutline([[-0.09, 0], [0.09, 0], [0.13, -0.62], [-0.13, -0.62]], 0.05), WONDER.apron,
      [sx * 0.14, 2.94, -0.46], [0.28, 0, sx * 0.28]);
  }
  put(cloth, ball(0.09, 12), WONDER.apron, [0, 3.03, -0.42]);

  // --- head and face --------------------------------------------------------
  put(skin, solidLoft(headStations(HEAD_R, { rows: 24, front: HEAD_FRONT, wide: 1.02 }), {
    sides: 52, samples: 40, axis: 'y',
  }), 0xffffff, [HEAD_C[0], HEAD_C[1], HEAD_C[2]], null, {
    keepColor: true,
    // Cheek blush, painted rather than stuck on. Authored frame: +Z is the face.
    tint: (p) => {
      const c = col(WONDER.skin);
      for (const sx of [-1, 1]) {
        const d = Math.hypot(p.x - sx * 0.235, p.y + 0.13, p.z - 0.33);
        const k = Math.max(0, 1 - d / 0.17);
        c.lerp(col(WONDER.blush), k * 0.5);
      }
      return [c.r, c.g, c.b];
    },
  });
  // Neck, buried in both the head and the dress collar.
  chain(skin, WONDER.skin, [
    { p: [0, 3.62, 0.02], r: 0.115 },
    { p: [0, 3.92, 0.02], r: 0.12 },
  ], { sides: 12 });

  // Eyes: white, iris, pupil, one specular highlight each -- without the highlight a
  // matte pupil reads as a hole in the face.
  for (const sx of [-1, 1]) {
    const e = onShell(HEAD_C, HEAD_RADII, [sx * 0.38, 0.10, 1]);
    stud(skin, 0xfdfdfa, { at: e.p, normal: e.n, radius: 0.105, rise: 0.045, wide: 1, long: 1.12, sink: 0.5 });
    stud(skin, WONDER.iris, { at: off(e.p, e.n, 0.022), normal: e.n, radius: 0.058, rise: 0.032, sink: 0.45 });
    stud(skin, 0x1c1a20, { at: off(e.p, e.n, 0.042), normal: e.n, radius: 0.028, rise: 0.02, sink: 0.4, detail: 10 });
    put(glow, ball(0.013, 8), 0xffffff, off([e.p[0] - sx * 0.02, e.p[1] + 0.025, e.p[2]], e.n, 0.055));
    // Lash line: a fine dark arc over the top of the eye.
    chain(skin, 0x3a2c20, shellArc(HEAD_C, HEAD_RADII, 8, (t) => [
      sx * (0.24 + t * 0.30), 0.205 + Math.sin(t * Math.PI) * 0.055,
    ], 0.012).map((p) => ({ p, r: 0.011 })), { sides: 6, detail: 6 });
    // Brow.
    chain(skin, WONDER.hairDeep, shellArc(HEAD_C, HEAD_RADII, 8, (t) => [
      sx * (0.22 + t * 0.30), 0.315 + Math.sin(t * Math.PI) * 0.06,
    ], 0.008).map((p) => ({ p, r: 0.013 })), { sides: 6, detail: 6 });
  }

  // Nose: the smallest stud on the model.
  {
    const n = onShell(HEAD_C, HEAD_RADII, [0, -0.06, 1]);
    stud(skin, WONDER.skin, { at: n.p, normal: n.n, radius: 0.045, rise: 0.035, sink: 0.35, detail: 10 });
  }
  // The smile: a thin arc that curves UP at both ends, lying on the face.
  chain(skin, WONDER.lip, shellArc(HEAD_C, HEAD_RADII, 12, (t) => {
    const s = t * 2 - 1;
    return [s * 0.30, -0.40 + s * s * 0.13];
  }, 0.008).map((p) => ({ p, r: 0.018 })), { sides: 8, detail: 8 });

  // --- hair: a cap that BURIES itself around the face -----------------------
  //
  // The cap is a closed shell slightly larger than the head whose front extent drops
  // below the head's own at face height -- so around the face the hair is inside the
  // head and invisible, and it emerges over the crown, the sides and the back. The
  // transition row is the hairline. Strand grooves at nine cycles over 84 sides.
  {
    const rows = 22;
    const st = [];
    for (let i = 0; i <= rows; i++) {
      const phi = (i / rows) * Math.PI;
      const s = Math.max(0.004, Math.sin(phi) * HEAD_R * 1.14);
      const h = -Math.cos(phi); // -1 chin .. 1 crown
      const front = h < 0.30 ? 0.52 : 0.52 + (Math.min(1, (h - 0.30) / 0.45)) * 0.58;
      st.push({ d: -Math.cos(phi) * HEAD_R * 1.16, w: s, up: s * front, dn: s * 1.02, round: 1 });
    }
    put(skin, solidLoft(st, {
      sides: 84, samples: 40, axis: 'y',
      warp: (t, u) => grooveAt(((u * 9) % 1) - 0.5, 0.09, 0.028),
    }), 0xffffff, [0, HEAD_C[1] + 0.05, -0.02], null, {
      keepColor: true,
      tint: (p) => {
        const c = mixCol(WONDER.hairDeep, WONDER.hair, 0.55 + 0.45 * THREE.MathUtils.clamp(p.y * 1.6 + 0.4, 0, 1));
        return [c.r, c.g, c.b];
      },
    });
  }
  // The side falls, the long back panel, and the fringe scallops.
  for (const sx of [-1, 1]) {
    chain(skin, WONDER.hair, [
      { p: [sx * 0.40, 4.32, 0.05], r: 0.15 },
      { p: [sx * 0.50, 3.85, 0.10], r: 0.155 },
      { p: [sx * 0.52, 3.35, 0.10], r: 0.13 },
      { p: [sx * 0.49, 2.95, 0.06], r: 0.09 },
    ], { sides: 12 });
    stud(skin, WONDER.hair, {
      at: [sx * 0.20, 4.42, 0.36], normal: [sx * 0.18, 0.55, 1],
      radius: 0.12, rise: 0.05, wide: 1, long: 1.3, sink: 0.4,
    });
  }
  put(skin, solidLoft([
    { d: 2.80, w: 0.26, up: 0.10, dn: 0.10, b: -0.34, round: 1 },
    { d: 3.20, w: 0.40, up: 0.14, dn: 0.14, b: -0.38, round: 1 },
    { d: 3.80, w: 0.44, up: 0.17, dn: 0.17, b: -0.34, round: 1 },
    { d: 4.30, w: 0.38, up: 0.16, dn: 0.16, b: -0.16, round: 1 },
    { d: 4.55, w: 0.22, up: 0.10, dn: 0.10, b: -0.02, round: 1 },
  ], {
    sides: 40, samples: 26, axis: 'y',
    warp: (t, u) => Math.sin(u * Math.PI * 2 * 4 + t * 5) * 0.02,
  }), WONDER.hair);

  // The hairband: an arc swept over the hair's own surface, ends buried in the falls.
  {
    const R = HEAD_R * 1.16 + 0.015;
    const C = [0, HEAD_C[1] + 0.05, -0.02];
    const tilt = 0.35;
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = -1.92 + (i / 16) * 3.84;
      pts.push([
        C[0] + Math.sin(a) * R,
        C[1] + Math.cos(a) * Math.cos(tilt) * R,
        C[2] - Math.cos(a) * Math.sin(tilt) * R,
      ]);
    }
    chain(cloth, WONDER.band, pts.map((p) => ({ p, r: 0.048 })), { sides: 10 });
  }

  // --- arms: one down, one WAVING ------------------------------------------
  const sleeve = (sx) => {
    put(cloth, ball(0.20, 18), WONDER.dress, [sx * 0.44, 3.50, 0.02], null, {
      keepColor: true,
      tint: (p) => {
        const c = p.y > 0.1 ? col(WONDER.dress) : mixCol(WONDER.dressDeep, WONDER.dress, 0.5);
        return [c.r, c.g, c.b];
      },
    });
  };
  sleeve(-1); sleeve(1);
  // Left arm down, hand slightly forward.
  chain(skin, WONDER.skin, [
    { p: [-0.50, 3.44, 0.05], r: 0.075 },
    { p: [-0.62, 2.98, 0.12], r: 0.066 },
    { p: [-0.66, 2.55, 0.24], r: 0.058 },
  ], { sides: 12 });
  put(skin, ball(0.085, 12), WONDER.skin, [-0.67, 2.46, 0.28], null, { scale: [1, 0.85, 1.15] });
  stud(skin, WONDER.skin, { at: [-0.60, 2.50, 0.30], normal: [-0.4, 0.2, 1], radius: 0.032, rise: 0.03, sink: 0.3, detail: 8 });
  // Right arm raised in a wave -- forearm angled OUT, palm open toward the viewer,
  // four little fingers fanned. A vertical sausage beside the head is not a wave.
  chain(skin, WONDER.skin, [
    { p: [0.50, 3.46, 0.05], r: 0.068 },
    { p: [0.76, 3.24, 0.14], r: 0.06 },
    { p: [1.00, 3.72, 0.20], r: 0.05 },
  ], { sides: 12 });
  put(skin, ball(0.085, 12), WONDER.skin, [1.05, 3.86, 0.22], null, { scale: [1.2, 1.25, 0.6] });
  for (let f = 0; f < 4; f++) {
    stud(skin, WONDER.skin, {
      at: [0.93 + f * 0.062, 3.96 + Math.sin(f * 1.8) * 0.015, 0.235], normal: [f * 0.16 - 0.22, 1, 0.18],
      radius: 0.024, rise: 0.062, sink: 0.15, detail: 8,
    });
  }
  stud(skin, WONDER.skin, {
    at: [0.94, 3.80, 0.24], normal: [-0.8, -0.1, 0.4], radius: 0.026, rise: 0.05, sink: 0.25, detail: 8,
  });
  // White cuffs where sleeve meets arm.
  for (const [x, y, z, rx, rz] of [[-0.56, 3.20, 0.09, 0, -0.25], [0.62, 3.36, 0.11, 0.2, 0.9]]) {
    put(cloth, new THREE.CylinderGeometry(0.085, 0.09, 0.09, 12), WONDER.apron, [x, y, z], [rx, 0, rz]);
  }

  // --- legs, socks, shoes ---------------------------------------------------
  for (const sx of [-1, 1]) {
    chain(cloth, WONDER.stocking, [
      { p: [sx * 0.24, 2.20, 0], r: 0.095 },
      { p: [sx * 0.245, 1.35, 0.02], r: 0.082 },
      { p: [sx * 0.24, 0.42, 0.01], r: 0.062 },
    ], { sides: 12 });
    // Mary Jane: a closed little loft with a rounded toe, a strap and a buckle.
    put(cloth, solidLoft([
      { d: -0.16, w: 0.085, up: 0.10, dn: 0.001, round: 0.7 },
      { d: 0.05, w: 0.105, up: 0.115, dn: 0.001, round: 0.62 },
      { d: 0.22, w: 0.10, up: 0.085, dn: 0.001, round: 0.7 },
      { d: 0.33, w: 0.07, up: 0.045, dn: 0.001, round: 0.9 },
    ], { sides: 26, samples: 14, axis: 'z' }), WONDER.shoe, [sx * 0.24, 0.035, 0.06]);
    put(cloth, new THREE.BoxGeometry(0.19, 0.035, 0.05), WONDER.shoe, [sx * 0.24, 0.20, 0.10]);
    stud(skin, WONDER.gold, { at: [sx * 0.30, 0.20, 0.11], normal: [sx, 0.2, 0.4], radius: 0.022, rise: 0.02, sink: 0.3, detail: 8 });
  }

  const s = height / 4.7;
  return group(
    mesh(placed(mergeParts(skin), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.55, metalness: 0 })),
    mesh(placed(mergeParts(cloth), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.8, metalness: 0, ...relief('weave', { seed, repeat: 7, strength: 0.22 }) })),
    mesh(placed(mergeParts(glow), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.45 })),
  );
}

// ---------------------------------------------------------------------------
// THE CHESHIRE CAT
// ---------------------------------------------------------------------------

// Lounging along a branch with its head turned to the viewer, striped lavender and
// rose, and grinning ear to ear -- the grin and the eyes ARE the animal, so they get
// the budget. The body lies along the cat's own X axis; the face looks down +Z. The
// tail is the big question-mark curl, swept in the X-Y plane so its whole shape shows
// from the front.
export function cheshireCat({ seed = 7, length = 5.6 } = {}) {
  const rng = seededRandom(seed);
  const fur = [];
  const glow = [];

  const stripes = (base) => (p) => {
    // Wavy rings along the body axis, alternating violet and rose over the base coat.
    const wob = smoothNoise3(p.x * 0.8 + 9, p.y * 0.8, p.z * 0.8) * 1.4;
    const band = Math.sin((p.x + wob * 0.35) * Math.PI * 2 / 1.65);
    let c;
    if (band > 0.45) c = col(WONDER.furStripe);
    else if (band < -0.55) c = col(WONDER.furRose);
    else c = col(base);
    // Pale belly, straight down from the axis.
    if (p.y < 0.55 && Math.abs(p.z) < 0.75) c.lerp(col(WONDER.furBelly), THREE.MathUtils.clamp((0.55 - p.y) / 0.9, 0, 1) * 0.85);
    return [c.r, c.g, c.b];
  };

  // --- body: a plump loft lying along X, belly flattened onto the branch ----
  put(fur, solidLoft([
    { d: -2.55, w: 0.30, up: 0.30, dn: 0.28, b: 0.85, round: 1 },
    { d: -2.10, w: 0.95, up: 1.00, dn: 0.72, b: 0.95, round: 1 },
    { d: -1.20, w: 1.06, up: 1.10, dn: 0.80, b: 1.00, round: 1 },
    { d: 0.00, w: 0.98, up: 0.96, dn: 0.78, b: 0.92, round: 1 },
    { d: 0.90, w: 0.92, up: 0.88, dn: 0.74, b: 0.88, round: 1 },
    { d: 1.55, w: 0.62, up: 0.60, dn: 0.52, b: 0.95, round: 1 },
  ], {
    sides: 56, samples: 44, axis: 'x',
    warp: (t, u) => smoothNoise3(t * 6.5, u * 6.5, 3.1) * 0.05 - 0.025,
  }), 0xffffff, null, null, { keepColor: true, tint: stripes(WONDER.fur) });

  // Haunch mound over the hip, and a folded hind paw peeking out.
  put(fur, ball(0.85, 24), 0xffffff, [-1.75, 0.95, 0.35], null, {
    scale: [1.05, 0.95, 0.9], keepColor: true, tint: stripes(WONDER.fur),
  });
  chain(fur, WONDER.furBelly, [
    { p: [-1.55, 0.35, 0.75], r: 0.20 },
    { p: [-1.05, 0.28, 0.95], r: 0.22 },
  ], { sides: 12 });

  // --- head: wide, round, front-flattened ----------------------------------
  const HR = 1.18;
  const HC = [1.55, 1.72, 0.42];
  const HEAD_RADII = [HR * 1.14, HR * 0.94, HR * 0.80];
  put(fur, solidLoft(headStations(HR, { rows: 26, front: 0.80, wide: 1.14, tall: 0.94 }), {
    sides: 64, samples: 48, axis: 'y',
    warp: (t, u) => smoothNoise3(t * 5.5, u * 5.5, 7.7) * 0.045 - 0.02,
  }), 0xffffff, HC, null, {
    keepColor: true,
    tint: (p) => {
      // Crown stripes in the head's own frame; muzzle pale around the mouth.
      const c = col(WONDER.fur);
      if (p.y > 0.30 && Math.sin(p.x * Math.PI * 2 / 0.95) > 0.35) c.set(WONDER.furStripe);
      const dm = Math.hypot(p.x, (p.y + 0.62) * 1.3, p.z - 0.85);
      if (dm < 0.72) c.lerp(col(WONDER.furBelly), 0.9);
      return [c.r, c.g, c.b];
    },
  });

  // Cheek fur ruffs: rooted spikes fanning strictly SIDEWAYS-OUT from the cheek line
  // -- they carry the WIDTH of the face. Aimed by direction, never by hand Euler.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const el = -0.55 + i * 0.24;
      const { p, n } = onShell(HC, HEAD_RADII, [sx, el * 0.8, 0.30]);
      spike(fur, i % 2 ? WONDER.fur : WONDER.furBelly, {
        length: 0.48 + Math.sin(i * 2.2) * 0.10, radius: 0.15,
        at: off(p, n, 0.10), rot: aimRot([sx, el * 0.35, 0.12]), sides: 8,
      });
    }
  }

  // Ears: rooted cones with pink inner studs -- BIG, the reference cat's ears are
  // half the drama of his silhouette.
  for (const sx of [-1, 1]) {
    spike(fur, WONDER.furStripe, {
      length: 1.15, radius: 0.44, at: [HC[0] + sx * 0.80, HC[1] + 1.22, HC[2] - 0.30],
      rot: [-0.10, 0, sx * 0.46], sides: 10,
    });
    stud(fur, WONDER.earPink, {
      at: [HC[0] + sx * 0.70, HC[1] + 1.12, HC[2] - 0.04], normal: [sx * 0.28, 0.40, 1],
      radius: 0.19, rise: 0.06, long: 1.6, sink: 0.35,
    });
  }

  // --- THE EYES: huge, gold, lit, with vertical slit pupils -----------------
  for (const sx of [-1, 1]) {
    const e = onShell(HC, HEAD_RADII, [sx * 0.44, 0.28, 1]);
    stud(fur, WONDER.mouthPlum, { at: e.p, normal: e.n, radius: 0.345, rise: 0.08, sink: 0.5, detail: 18 });
    stud(glow, WONDER.eyeGold, { at: off(e.p, e.n, 0.038), normal: e.n, radius: 0.30, rise: 0.10, sink: 0.4, detail: 18 });
    // The slit: an upright lens, sunk into the gold.
    facePlate(fur, 0x201322, extrudeOutline(lensOutline(0.175, 0.056).map(([a, b]) => [b, a]), 0.05), {
      at: off(e.p, e.n, 0.115), normal: e.n, sink: 0.02,
    });
    put(glow, ball(0.05, 10), 0xffffff, off([e.p[0] - sx * 0.08, e.p[1] + 0.10, e.p[2]], e.n, 0.125));
  }

  // --- THE GRIN: a white banana of teeth sweeping ear to ear ----------------
  //
  // A band swept along the head's own surface (shellArc), framed by dark lip lines and
  // cut by tooth dividers laid ON the band -- the image-two grin. sweepProfile's caps
  // close the band's ends; every divider is a capped chain.
  {
    const grinEl = (t) => {
      const sc = t * 2 - 1;
      return -0.42 + sc * sc * 0.34;
    };
    const bandPts = shellArc(HC, HEAD_RADII, 22, (t) => [(t * 2 - 1) * 1.04, grinEl(t)], 0.015);
    // Dark backing first: slightly bigger, slightly deeper -- the shadow of an open mouth.
    put(fur, sweepProfile(bandPts, roundedOutline(0.075, 0.21, 0.05, 3), { samples: 44 }), WONDER.mouthPlum);
    const toothPts = shellArc(HC, HEAD_RADII, 22, (t) => [(t * 2 - 1) * 1.00, grinEl(t)], 0.045);
    put(fur, sweepProfile(toothPts, roundedOutline(0.055, 0.155, 0.045, 3), { samples: 44 }), WONDER.tooth);
    // Tooth dividers: short vertical plum tubes lying on the white band.
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const az = (t * 2 - 1) * 0.98;
      const el = grinEl(t);
      const seg = shellArc(HC, HEAD_RADII, 3, (k) => [az, el - 0.115 + k * 0.23], 0.105);
      chain(fur, WONDER.mouthPlum, seg.map((p) => ({ p, r: 0.016 })), { sides: 6, detail: 6 });
    }
    // Lip lines above and below, thicker than the dividers.
    for (const dEl of [-0.155, 0.155]) {
      const lip = shellArc(HC, HEAD_RADII, 22, (t) => [(t * 2 - 1) * 1.05, grinEl(t) + dEl], 0.055);
      chain(fur, WONDER.mouthPlum, lip.map((p) => ({ p, r: 0.030 })), { sides: 8, detail: 8 });
    }
  }

  // Nose and whiskers.
  {
    const n = onShell(HC, HEAD_RADII, [0, -0.18, 1]);
    stud(fur, WONDER.catNose, { at: n.p, normal: n.n, radius: 0.085, rise: 0.05, wide: 1.25, sink: 0.35, detail: 10 });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const w = onShell(HC, HEAD_RADII, [sx * 0.5, -0.22 + i * 0.10, 0.85]);
        chain(fur, 0xf6f2fa, [
          { p: off(w.p, w.n, -0.05), r: 0.016 },
          { p: off([w.p[0] + sx * 0.85, w.p[1] + (i - 1) * 0.16 + 0.05, w.p[2] + 0.1], w.n, 0), r: 0.006 },
        ], { sides: 6, detail: 6 });
      }
    }
  }

  // --- front legs draped over the branch lip --------------------------------
  for (const [lx, drop] of [[0.72, 1.35], [1.55, 1.15]]) {
    chain(fur, 0xffffff, [
      { p: [lx, 0.75, 0.55], r: 0.26 },
      { p: [lx + 0.05, 0.05, 0.72], r: 0.21 },
      { p: [lx + 0.02, -drop, 0.66], r: 0.19 },
    ], { sides: 14, base: { keepColor: true, tint: stripes(WONDER.fur) } });
    // The paw: a soft ball with three toe studs.
    put(fur, ball(0.22, 14), WONDER.furBelly, [lx + 0.02, -drop - 0.08, 0.68], null, { scale: [1, 0.9, 1.15] });
    for (let tzi = -1; tzi <= 1; tzi++) {
      stud(fur, WONDER.furBelly, {
        at: [lx + 0.02 + tzi * 0.09, -drop - 0.16, 0.82], normal: [tzi * 0.25, -0.35, 1],
        radius: 0.055, rise: 0.045, sink: 0.3, detail: 8,
      });
    }
  }

  // --- the tail: one question-mark curl in the X-Y plane --------------------
  {
    const C = [-3.05, 1.95, -0.10];
    const pts = [];
    const a0 = -1.85;
    const a1 = 1.45;
    for (let i = 0; i <= 20; i++) {
      const a = a0 + (i / 20) * (a1 - a0);
      const r = 1.30 - (i / 20) * 0.18;
      pts.push({
        p: [C[0] + Math.cos(a) * r, C[1] + Math.sin(a) * r, C[2] + Math.sin(i * 0.9) * 0.05],
        r: 0.26 - (i / 20) * 0.10,
      });
    }
    chain(fur, 0xffffff, pts, {
      sides: 14,
      base: {
        keepColor: true,
        tint: (p) => {
          const a = Math.atan2(p.y - C[1], p.x - C[0]);
          const band = Math.floor(((a - a0) / (a1 - a0)) * 8);
          const c = col(band % 2 ? WONDER.furStripe : (band % 4 === 0 ? WONDER.furRose : WONDER.fur));
          return [c.r, c.g, c.b];
        },
      },
    });
    // The fluffy tip.
    put(fur, ball(0.24, 12), WONDER.furBelly, [C[0] + Math.cos(a1) * 1.12, C[1] + Math.sin(a1) * 1.12, C[2]]);
  }

  const s = length / 5.6;
  return group(
    mesh(placed(mergeParts(fur), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.72, metalness: 0, ...relief('bark', { seed, repeat: 6, strength: 0.28 }) })),
    mesh(placed(mergeParts(glow), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.25, emissive: 0xffdf80, emissiveIntensity: 0.5 })),
  );
}

// ---------------------------------------------------------------------------
// THE MAD HATTER
// ---------------------------------------------------------------------------

// 5.5ft of hatter under 2.2ft of hat. Teal coat over a crimson vest (painted onto the
// same loft), a ruff of white ballooning round the neck, orange hair bursting out
// under the brim, closed happy eyes and a grin -- and a teacup raised in one hand,
// because a hatter without tea is just a man in a hat.
export function madHatter({ seed = 11, height = 7.6 } = {}) {
  const rng = seededRandom(seed);
  const skin = [];
  const cloth = [];
  const glow = [];

  const HEAD_R = 0.47;
  const HEAD_C = [0, 5.02, 0.03];
  const HEAD_FRONT = 0.86;
  const HEAD_RADII = [HEAD_R, HEAD_R, HEAD_R * HEAD_FRONT];

  // --- legs and shoes -------------------------------------------------------
  for (const sx of [-1, 1]) {
    chain(cloth, WONDER.trouser, [
      { p: [sx * 0.28, 2.75, 0], r: 0.155 },
      { p: [sx * 0.30, 1.55, 0.03], r: 0.125 },
      { p: [sx * 0.30, 0.45, 0.02], r: 0.10 },
    ], { sides: 12 });
    put(cloth, solidLoft([
      { d: -0.22, w: 0.115, up: 0.13, dn: 0.001, round: 0.7 },
      { d: 0.10, w: 0.14, up: 0.15, dn: 0.001, round: 0.6 },
      { d: 0.38, w: 0.125, up: 0.10, dn: 0.001, round: 0.7 },
      { d: 0.52, w: 0.08, up: 0.05, dn: 0.001, round: 0.9 },
    ], { sides: 26, samples: 14, axis: 'z' }), WONDER.woodDeep, [sx * 0.30, 0.045, 0.08]);
    // A square brass buckle.
    put(glow, new THREE.BoxGeometry(0.14, 0.10, 0.03), WONDER.gold, [sx * 0.30, 0.24, 0.30], [-0.5, 0, 0]);
  }

  // --- coat: hem to neck, vest and lapels painted on ------------------------
  const hemY = 2.45;
  put(cloth, solidLoft([
    { d: hemY, w: 0.82, up: 0.68, dn: 0.68, round: 1 },
    { d: 2.95, w: 0.62, up: 0.52, dn: 0.52, round: 1 },
    { d: 3.45, w: 0.55, up: 0.47, dn: 0.45, round: 1 },
    { d: 4.05, w: 0.60, up: 0.50, dn: 0.46, round: 1 },
    { d: 4.45, w: 0.62, up: 0.50, dn: 0.44, round: 1 },
    { d: 4.68, w: 0.34, up: 0.28, dn: 0.26, round: 1 },
    { d: 4.78, w: 0.16, up: 0.13, dn: 0.13, round: 1 },
  ], {
    sides: 76, samples: 40, axis: 'y',
    warp: (t, u) => {
      const skirtiness = THREE.MathUtils.clamp((0.42 - t) / 0.42, 0, 1);
      return Math.sin(u * Math.PI * 2 * 6) * 0.03 * skirtiness;
    },
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const az = Math.atan2(p.x, p.z);
      const t = (p.y - hemY) / (4.78 - hemY);
      // Crimson vest up the front, edged by deep-teal lapel bands.
      if (Math.abs(az) < 0.30 && t > 0.18 && t < 0.92) {
        const c = mixCol(WONDER.vest, 0x8f2733, 0.25 + 0.3 * Math.abs(Math.sin(p.y * 9)));
        return [c.r, c.g, c.b];
      }
      if (Math.abs(az) < 0.46 && t > 0.18) {
        const c = col(WONDER.coatDeep);
        return [c.r, c.g, c.b];
      }
      const fold = 0.5 + 0.5 * Math.sin(az * 6 + Math.PI / 2);
      const c = mixCol(WONDER.coatDeep, WONDER.coat, 0.5 + fold * 0.5);
      return [c.r, c.g, c.b];
    },
  });
  // Vest buttons and the watch chain draped across it.
  for (let i = 0; i < 4; i++) {
    stud(glow, WONDER.gold, {
      at: [0, 3.05 + i * 0.42, 0.62 - i * 0.035], normal: [0, 0.1, 1],
      radius: 0.05, rise: 0.035, sink: 0.4, detail: 8,
    });
  }
  chain(glow, WONDER.gold, [
    { p: [0.02, 3.90, 0.60], r: 0.022 },
    { p: [0.28, 3.68, 0.60], r: 0.022 },
    { p: [0.44, 3.42, 0.56], r: 0.022 },
  ], { sides: 6, detail: 6 });

  // --- the ruff: a ring of white puffs, overlapping by construction ---------
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    put(cloth, ball(0.18, 12), i % 2 ? WONDER.ruff : 0xefe9da,
      [Math.sin(a) * 0.34, 4.72 + Math.cos(i * 2.1) * 0.03, Math.cos(a) * 0.30 + 0.02], null,
      { scale: [1, 0.62, 1] });
  }

  // --- arms: left down, right raising a teacup ------------------------------
  chain(cloth, WONDER.coat, [
    { p: [-0.58, 4.38, 0.02], r: 0.15 },
    { p: [-0.78, 3.62, 0.18], r: 0.125 },
    { p: [-0.82, 3.05, 0.28], r: 0.105 },
  ], { sides: 12 });
  put(cloth, new THREE.CylinderGeometry(0.115, 0.125, 0.14, 12), WONDER.ruff, [-0.82, 2.98, 0.30], [0.25, 0, -0.15]);
  put(skin, ball(0.10, 12), WONDER.skin, [-0.83, 2.82, 0.34], null, { scale: [1, 0.9, 1.2] });

  chain(cloth, WONDER.coat, [
    { p: [0.58, 4.38, 0.02], r: 0.15 },
    { p: [0.86, 3.85, 0.30], r: 0.125 },
    { p: [0.90, 4.10, 0.62], r: 0.105 },
  ], { sides: 12 });
  put(cloth, new THREE.CylinderGeometry(0.115, 0.125, 0.14, 12), WONDER.ruff, [0.90, 4.22, 0.64], [0.3, 0, 0.1]);
  put(skin, ball(0.10, 12), WONDER.skin, [0.91, 4.35, 0.66], null, { scale: [1.05, 0.9, 1.1] });
  // The teacup in his raised hand: cup, handle, saucer under it, and the tea itself.
  {
    const cupAt = [0.91, 4.42, 0.66];
    put(cloth, lathed(closed([[0.10, 0.02], [0.13, 0.06], [0.15, 0.22], [0.155, 0.26], [0.12, 0.26], [0.115, 0.10], [0.06, 0.045]])), WONDER.pinkCup, cupAt);
    put(cloth, lathed([[0.001, 0.255], [0.115, 0.255], [0.115, 0.26], [0.001, 0.26]]), 0xc79a5b, [cupAt[0], cupAt[1] + 0.005, cupAt[2]]);
    put(cloth, new THREE.TorusGeometry(0.07, 0.02, 8, 14), WONDER.pinkCup, [cupAt[0] + 0.15, cupAt[1] + 0.15, cupAt[2]], [0, 0.2, 0]);
    put(cloth, lathed(closed([[0.20, 0.005], [0.24, 0.03], [0.245, 0.045]])), WONDER.mint, [cupAt[0], cupAt[1] - 0.045, cupAt[2]]);
  }

  // --- head and face --------------------------------------------------------
  put(skin, solidLoft(headStations(HEAD_R, { rows: 24, front: HEAD_FRONT, wide: 1.0, tall: 1.06 }), {
    sides: 52, samples: 40, axis: 'y',
  }), 0xffffff, HEAD_C, null, {
    keepColor: true,
    tint: (p) => {
      const c = col(WONDER.skin);
      for (const sx of [-1, 1]) {
        const d = Math.hypot(p.x - sx * 0.26, p.y + 0.16, p.z - 0.30);
        c.lerp(col(WONDER.blush), Math.max(0, 1 - d / 0.16) * 0.55);
      }
      return [c.r, c.g, c.b];
    },
  });
  chain(skin, WONDER.skin, [
    { p: [0, 4.60, 0.02], r: 0.12 },
    { p: [0, 4.90, 0.02], r: 0.125 },
  ], { sides: 12 });

  // Closed happy eyes: two ∩ arcs, with brows above -- kept LOW on the face so the
  // hat brim and the hair ring cannot swallow them (they did, and an eyeless grin
  // reads as a skull).
  for (const sx of [-1, 1]) {
    chain(skin, 0x3a2a1e, shellArc(HEAD_C, HEAD_RADII, 8, (t) => [
      sx * (0.18 + t * 0.30), 0.02 + Math.sin(t * Math.PI) * 0.11,
    ], 0.014).map((p) => ({ p, r: 0.021 })), { sides: 6, detail: 6 });
    chain(skin, 0xb56a2a, shellArc(HEAD_C, HEAD_RADII, 8, (t) => [
      sx * (0.17 + t * 0.32), 0.235 + Math.sin(t * Math.PI) * 0.07,
    ], 0.008).map((p) => ({ p, r: 0.018 })), { sides: 6, detail: 6 });
  }
  // The nose: prominent, slightly drooping.
  {
    const n = onShell(HEAD_C, HEAD_RADII, [0, -0.16, 1]);
    stud(skin, WONDER.skin, { at: off(n.p, n.n, 0.02), normal: [0, -0.28, 1], radius: 0.08, rise: 0.12, sink: 0.3, detail: 12 });
  }
  // The grin: a white tooth band inside dark lips, smaller than the cat's but the same
  // construction -- band, backing, dividers, all lying on the head's own surface.
  {
    const gEl = (t) => {
      const sc = t * 2 - 1;
      return -0.44 + sc * sc * 0.20;
    };
    put(skin, sweepProfile(shellArc(HEAD_C, HEAD_RADII, 14, (t) => [(t * 2 - 1) * 0.46, gEl(t)], 0.008), roundedOutline(0.035, 0.085, 0.025, 3), { samples: 28 }), 0x5c3038);
    put(skin, sweepProfile(shellArc(HEAD_C, HEAD_RADII, 14, (t) => [(t * 2 - 1) * 0.42, gEl(t)], 0.022), roundedOutline(0.026, 0.058, 0.02, 3), { samples: 28 }), WONDER.tooth);
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const seg = shellArc(HEAD_C, HEAD_RADII, 2, (k) => [(t * 2 - 1) * 0.41, gEl(t) - 0.045 + k * 0.09], 0.05);
      chain(skin, 0x5c3038, seg.map((p) => ({ p, r: 0.009 })), { sides: 6, detail: 6 });
    }
  }

  // --- the hair: orange frizz bursting out under the brim -------------------
  //
  // The ring stops well short of the face (|a| < 2.15) and sits at temple height:
  // frizz that reaches the eye line hides the eyes under the brim's shadow.
  for (let i = 0; i < 12; i++) {
    const a = -2.15 + (i / 11) * 4.3;
    const rr = 0.40 + rng() * 0.10;
    put(skin, ball(0.13 + rng() * 0.08, 10), i % 3 ? WONDER.hatterHair : 0xc2601f,
      [Math.sin(a) * rr, 5.18 + Math.sin(i * 2.7) * 0.11, Math.cos(a) * rr * -1 + 0.02], null,
      { scale: [1, 0.85 + rng() * 0.3, 1] });
  }
  // The mutton-chop tufts in front of each ear, below the eye line.
  for (const sx of [-1, 1]) {
    put(skin, ball(0.15, 10), WONDER.hatterHair, [sx * 0.42, 4.86, 0.16], null, { scale: [1, 1.25, 1] });
  }

  // --- THE HAT --------------------------------------------------------------
  const HAT_Y = 5.60;
  // Brim: a lathe dish with an upturned edge; crown: wider at the top, slightly
  // concave -- the storybook silhouette rather than a straight stovepipe.
  put(cloth, lathed(closed([
    [0.30, 0.0], [0.98, 0.02], [1.06, 0.09], [1.02, 0.16], [0.62, 0.115], [0.30, 0.115],
  ]), { segments: 44 }), WONDER.hatDeep, [0, HAT_Y, 0.02]);
  put(cloth, lathed(closed([
    [0.560, 0.10], [0.545, 0.30], [0.535, 0.62], [0.545, 1.10], [0.575, 1.60], [0.615, 2.00], [0.625, 2.10], [0.60, 2.14], [0.31, 2.16],
  ]), { segments: 44 }), 0xffffff, [0, HAT_Y, 0.02], null, {
    keepColor: true,
    tint: (p) => {
      // The band: candy stripes by azimuth, tipped into a diagonal. Pink against
      // CREAM, not pink against deep red -- two close darks read as one dark band.
      if (p.y > 0.14 && p.y < 0.56) {
        const a = Math.atan2(p.x, p.z) + p.y * 1.8;
        const c = col(Math.floor(((a + Math.PI * 3) / (Math.PI / 5)) % 2) ? WONDER.bandPink : 0xf2e4d0);
        return [c.r, c.g, c.b];
      }
      const shade = 0.82 + 0.18 * Math.max(0, Math.sin(Math.atan2(p.x, p.z) + 2.2));
      const c = mixCol(WONDER.hatDeep, WONDER.hat, shade);
      return [c.r, c.g, c.b];
    },
  });

  const s = height / 7.6;
  const g = group(
    mesh(placed(mergeParts(skin), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.55, metalness: 0 })),
    mesh(placed(mergeParts(cloth), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.78, metalness: 0, ...relief('weave', { seed, repeat: 8, strength: 0.28 }) })),
    mesh(placed(mergeParts(glow), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.3, metalness: 0.55 })),
  );
  // The 10/6 card, tucked into the band. A separate plate because it carries a texture.
  const card = texPlate(0.30 * s, 0.42 * s, 96, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f7f2e2';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b9a26b';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#3a3226';
    ctx.textAlign = 'center';
    ctx.font = 'italic 22px Georgia, serif';
    ctx.fillText('In this', w / 2, 34);
    ctx.fillText('Style', w / 2, 58);
    ctx.font = 'bold 34px Georgia, serif';
    ctx.fillText('10/6', w / 2, 100);
  });
  card.position.set(0.30 * s, (HAT_Y + 0.36) * s, 0.52 * s);
  card.rotation.set(-0.06, 0.42, 0.10);
  g.add(card);
  return g;
}

// ---------------------------------------------------------------------------
// THE WHITE RABBIT
// ---------------------------------------------------------------------------

// Upright, waistcoated, and LATE: 4ft of anxious rabbit under 1.5ft of ears, one of
// them kinked at the tip, holding a golden pocket watch up as evidence. Waistcoat
// pinstripes are painted onto the body loft (eight stripes over eighty sides -- the
// Nyquist floor again); the watch face is the one texture on him.
export function whiteRabbit({ seed = 13, height = 5.5 } = {}) {
  const rng = seededRandom(seed);
  const fur = [];
  const brass = [];
  const glow = [];

  const HEAD_R = 0.50;
  const HEAD_C = [0, 3.32, 0.04];
  const HEAD_RADII = [HEAD_R * 1.02, HEAD_R * 0.98, HEAD_R * 0.85];

  // --- body: a pear in a waistcoat ------------------------------------------
  put(fur, solidLoft([
    { d: 0.85, w: 0.48, up: 0.42, dn: 0.42, round: 1 },
    { d: 1.25, w: 0.66, up: 0.58, dn: 0.55, round: 1 },
    { d: 1.85, w: 0.62, up: 0.56, dn: 0.50, round: 1 },
    { d: 2.45, w: 0.48, up: 0.42, dn: 0.38, round: 1 },
    { d: 2.85, w: 0.30, up: 0.26, dn: 0.24, round: 1 },
    { d: 3.00, w: 0.16, up: 0.13, dn: 0.13, round: 1 },
  ], { sides: 80, samples: 34, axis: 'y' }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const az = Math.atan2(p.x, p.z);
      // The shirt front, then the waistcoat with pinstripes, then white fur below.
      if (p.y > 1.35 && p.y < 2.9 && Math.abs(az) < 0.24) {
        const c = col(0xfdfbf4);
        return [c.r, c.g, c.b];
      }
      if (p.y > 1.18 && p.y < 2.92 && Math.abs(az) < 2.35) {
        const stripe = Math.abs(((az * 8 / (Math.PI * 2)) % 1 + 1) % 1 - 0.5) < 0.15;
        const c = col(stripe ? 0xc0aaf2 : WONDER.waistcoat);
        c.multiplyScalar(0.9 + 0.1 * Math.cos(az));
        return [c.r, c.g, c.b];
      }
      const c = col(p.y < 1.0 ? WONDER.rabbitFur : WONDER.rabbitShade);
      return [c.r, c.g, c.b];
    },
  });
  // Waistcoat hem: a thin rolled edge so the garment reads as cloth ON the fur.
  {
    const hem = [];
    for (let i = 0; i <= 36; i++) {
      const a = -2.3 + (i / 36) * 4.6;
      hem.push({ p: [Math.sin(a) * 0.655, 1.22 + Math.cos(a * 2) * 0.02, Math.cos(a) * 0.565], r: 0.035 });
    }
    chain(fur, WONDER.waistcoat, hem, { sides: 8 });
  }
  for (let i = 0; i < 3; i++) {
    stud(brass, WONDER.gold, {
      at: [0.10, 1.62 + i * 0.44, 0.585 - i * 0.05], normal: [0.1, 0.1, 1],
      radius: 0.045, rise: 0.032, sink: 0.4, detail: 8,
    });
  }
  // Watch chain: vest button to hip pocket.
  chain(brass, WONDER.gold, [
    { p: [0.10, 2.06, 0.56], r: 0.02 },
    { p: [0.38, 1.78, 0.52], r: 0.02 },
    { p: [0.52, 1.52, 0.40], r: 0.02 },
  ], { sides: 6, detail: 6 });

  // The bow tie: two lens loops, a knot, and white polka dots.
  const bowTint = (p) => {
    const d = smoothNoise3(p.x * 14 + 3, p.y * 14, p.z * 14);
    const c = col(d > 0.72 ? 0xfaf4ea : WONDER.bowRed);
    return [c.r, c.g, c.b];
  };
  for (const sx of [-1, 1]) {
    put(fur, extrudeOutline(lensOutline(0.20, 0.09), 0.09), 0xffffff,
      [sx * 0.20, 2.92, 0.235], [0.35, sx * 0.5, sx * 0.12], { keepColor: true, tint: bowTint });
  }
  put(fur, ball(0.075, 10), WONDER.bowRed, [0, 2.90, 0.27]);

  // --- head, muzzle, buck teeth ---------------------------------------------
  put(fur, solidLoft(headStations(HEAD_R, { rows: 24, front: 0.85, wide: 1.02, tall: 0.98 }), {
    sides: 56, samples: 40, axis: 'y',
    warp: (t, u) => smoothNoise3(t * 5, u * 5, 4.4) * 0.03 - 0.015,
  }), WONDER.rabbitFur, HEAD_C);
  // Muzzle: a soft wide stud low on the face; nose; split upper lip; two buck teeth.
  {
    const m = onShell(HEAD_C, HEAD_RADII, [0, -0.28, 1]);
    stud(fur, 0xfdfbf6, { at: m.p, normal: m.n, radius: 0.21, rise: 0.13, wide: 1.25, long: 1, sink: 0.4, detail: 16 });
    const n = onShell(HEAD_C, HEAD_RADII, [0, -0.10, 1]);
    stud(fur, 0xe8889c, { at: off(n.p, n.n, 0.055), normal: n.n, radius: 0.072, rise: 0.055, wide: 1.2, sink: 0.3, detail: 8 });
    chain(fur, 0xd8cfc2, [
      { p: off(n.p, n.n, 0.075), r: 0.012 },
      { p: off([n.p[0], n.p[1] - 0.16, n.p[2]], n.n, 0.075), r: 0.012 },
    ], { sides: 6, detail: 6 });
    for (const sx of [-1, 1]) {
      put(fur, new THREE.BoxGeometry(0.06, 0.11, 0.045), 0xfffef8,
        off([m.p[0] + sx * 0.038, m.p[1] - 0.155, m.p[2]], m.n, 0.055));
    }
  }
  // Pink-red eyes, worried wide.
  for (const sx of [-1, 1]) {
    const e = onShell(HEAD_C, HEAD_RADII, [sx * 0.42, 0.14, 1]);
    stud(fur, 0xfdfdfa, { at: e.p, normal: e.n, radius: 0.13, rise: 0.055, sink: 0.5 });
    stud(fur, 0xe05560, { at: off(e.p, e.n, 0.026), normal: e.n, radius: 0.082, rise: 0.042, sink: 0.45 });
    stud(fur, 0x260f14, { at: off(e.p, e.n, 0.052), normal: e.n, radius: 0.034, rise: 0.022, sink: 0.4, detail: 10 });
    put(glow, ball(0.018, 8), 0xffffff, off([e.p[0] - sx * 0.025, e.p[1] + 0.035, e.p[2]], e.n, 0.068));
  }
  // Cheek fur tufts and whiskers.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const { p, n } = onShell(HEAD_C, HEAD_RADII, [sx, -0.30 + i * 0.18, 0.35]);
      spike(fur, WONDER.rabbitFur, {
        length: 0.22, radius: 0.075, at: off(p, n, 0.02),
        rot: aimRot([n[0], n[1] * 0.3 - 0.1, n[2] * 0.4]), sides: 7,
      });
    }
    for (let i = 0; i < 3; i++) {
      const w = onShell(HEAD_C, HEAD_RADII, [sx * 0.55, -0.28 + i * 0.09, 0.8]);
      chain(fur, 0xf8f6ee, [
        { p: off(w.p, w.n, -0.03), r: 0.011 },
        { p: [w.p[0] + sx * 0.55, w.p[1] + (i - 1) * 0.10, w.p[2] + 0.08], r: 0.004 },
      ], { sides: 6, detail: 6 });
    }
  }

  // --- THE EARS: one true, one kinked ---------------------------------------
  //
  // Each ear is its own upright loft -- flattened, pink up the inner face -- built at
  // the origin and matrix-placed onto the head, so the pink is painted in the ear's own
  // frame before the transform (mergeParts runs tints first).
  const ear = (kink) => {
    const st = [];
    const rows = 14;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const wRaw = Math.sin(Math.min(1, t * 1.25) * Math.PI);
      const w = Math.max(0.02, wRaw * 0.185 + 0.02 * (1 - t));
      st.push({
        d: t * 1.5,
        w,
        up: Math.max(0.015, w * 0.42),
        dn: Math.max(0.015, w * 0.42),
        a: kink ? Math.max(0, t - 0.60) * 1.3 : Math.sin(t * 2.2) * 0.04,
        b: kink ? -Math.max(0, t - 0.60) * 0.75 : -t * 0.10,
        round: 1,
      });
    }
    return solidLoft(st, { sides: 22, samples: 26, axis: 'y' });
  };
  const earTint = (p) => {
    const c = col(WONDER.rabbitFur);
    if (p.z > 0.005 && p.y > 0.25 && p.y < 1.38) c.lerp(col(WONDER.rabbitEar), 0.85);
    return [c.r, c.g, c.b];
  };
  put(fur, ear(false), 0xffffff, [-0.26, 3.62, -0.06], [-0.16, 0, -0.24], { keepColor: true, tint: earTint });
  put(fur, ear(true), 0xffffff, [0.26, 3.60, -0.06], [-0.14, 0, 0.26], { keepColor: true, tint: earTint });

  // --- arms: one paw raised with the watch ----------------------------------
  chain(fur, WONDER.waistcoat, [
    { p: [-0.44, 2.55, 0.05], r: 0.10 },
    { p: [-0.60, 2.10, 0.18], r: 0.085 },
    { p: [-0.62, 1.75, 0.32], r: 0.075 },
  ], { sides: 10 });
  put(fur, ball(0.10, 12), WONDER.rabbitFur, [-0.63, 1.68, 0.38]);
  chain(fur, WONDER.waistcoat, [
    { p: [0.44, 2.55, 0.05], r: 0.10 },
    { p: [0.66, 2.30, 0.28], r: 0.085 },
    { p: [0.62, 2.72, 0.48], r: 0.075 },
  ], { sides: 10 });
  put(fur, ball(0.10, 12), WONDER.rabbitFur, [0.60, 2.84, 0.52]);

  // THE WATCH: a golden case in the raised paw, its face a texture, its chain looping
  // back to the vest. The crown and bow sit at the top like a real hunter case.
  const WATCH = [0.60, 3.02, 0.56];
  const WTILT = 0.55; // tipped well back, so the dial faces up the arrival sightline
  put(brass, lathed(closed([
    [0.16, 0.0], [0.21, 0.02], [0.225, 0.055], [0.21, 0.09], [0.16, 0.11],
  ]), { segments: 28 }), WONDER.gold, WATCH, [Math.PI / 2 - WTILT, 0, 0]);
  put(brass, new THREE.CylinderGeometry(0.028, 0.028, 0.05, 8), WONDER.gold, [WATCH[0], WATCH[1] + 0.13, WATCH[2] - 0.075], null);
  put(brass, new THREE.TorusGeometry(0.035, 0.012, 6, 12), WONDER.gold, [WATCH[0], WATCH[1] + 0.17, WATCH[2] - 0.085], [0.3, 0, 0]);
  // The chain swings OUT from the watch in a real drape, then back to the vest.
  chain(brass, WONDER.gold, [
    { p: [WATCH[0] - 0.02, WATCH[1] - 0.10, WATCH[2] + 0.02], r: 0.016 },
    { p: [0.48, 2.60, 0.66], r: 0.016 },
    { p: [0.28, 2.24, 0.66], r: 0.016 },
    { p: [0.10, 2.06, 0.56], r: 0.016 },
  ], { sides: 6, detail: 6 });

  // --- legs, feet, tail -----------------------------------------------------
  for (const sx of [-1, 1]) {
    chain(fur, WONDER.rabbitFur, [
      { p: [sx * 0.26, 1.05, 0], r: 0.14 },
      { p: [sx * 0.28, 0.55, 0.04], r: 0.12 },
    ], { sides: 12 });
    put(fur, solidLoft([
      { d: -0.28, w: 0.13, up: 0.14, dn: 0.001, round: 0.75 },
      { d: 0.12, w: 0.15, up: 0.15, dn: 0.001, round: 0.65 },
      { d: 0.48, w: 0.13, up: 0.11, dn: 0.001, round: 0.7 },
      { d: 0.66, w: 0.085, up: 0.055, dn: 0.001, round: 0.9 },
    ], { sides: 24, samples: 14, axis: 'z' }), WONDER.rabbitFur, [sx * 0.28, 0.03, 0.14]);
    // Toe creases.
    for (const tx of [-0.05, 0.05]) {
      chain(fur, WONDER.rabbitShade, [
        { p: [sx * 0.28 + tx, 0.115, 0.62], r: 0.008 },
        { p: [sx * 0.28 + tx, 0.05, 0.76], r: 0.008 },
      ], { sides: 5, detail: 5 });
    }
  }
  put(fur, ball(0.19, 14), 0xfdfbf6, [0, 1.10, -0.55]);

  const s = height / 5.5;
  const g = group(
    mesh(placed(mergeParts(fur), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.7, metalness: 0, ...relief('bark', { seed, repeat: 7, strength: 0.22 }) })),
    mesh(placed(mergeParts(brass), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.32, metalness: 0.6 })),
    mesh(placed(mergeParts(glow), { scale: [s, s, s] }),
      standard({ vertexColors: true, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0.4 })),
  );
  // The watch face: white dial, worried hands.
  const dial = texPlate(0.20 * s, 0.20 * s, 96, 96, (ctx, w, h) => {
    ctx.fillStyle = '#f8f4e6';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3a3226';
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.sin(a) * (w * 0.36), h / 2 - Math.cos(a) * (w * 0.36));
      ctx.lineTo(w / 2 + Math.sin(a) * (w * 0.44), h / 2 - Math.cos(a) * (w * 0.44));
      ctx.stroke();
    }
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + w * 0.26, h / 2 - h * 0.10);
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 - w * 0.06, h / 2 - h * 0.34);
    ctx.stroke();
    ctx.fillStyle = '#c9203a';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  dial.position.set(WATCH[0] * s, (WATCH[1] + 0.062) * s, (WATCH[2] + 0.096) * s);
  dial.rotation.set(-0.55, 0, 0);
  g.add(dial);
  return g;
}

// ---------------------------------------------------------------------------
// THE MAD TEA PARTY
// ---------------------------------------------------------------------------

// The long table, laid: a draped cloth (one loft, its hem rippling), turned legs
// showing beneath, and the whole service merged into the same mesh -- teapots with
// real spouts and handles, cups on saucers, a stacked tower of cups, and a two-tier
// cake stand. One draw call for the entire party.
export function teaTable({ seed = 17, length = 9.5, width = 3.6, height = 2.5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const hl = length / 2;
  const hw = width / 2;

  // The cloth: rectangular-section loft, hem swinging near the grass, top capped flat.
  // The hem has to hang LOW -- stopped a foot up, the whole table read as a floating
  // white slab, because the legs are thin and the cloth is what carries the mass.
  put(parts, solidLoft([
    { d: height - 1.68, w: hl + 0.40, up: hw + 0.38, dn: hw + 0.38, round: 0.26 },
    { d: height - 1.0, w: hl + 0.30, up: hw + 0.28, dn: hw + 0.28, round: 0.24 },
    { d: height - 0.45, w: hl + 0.20, up: hw + 0.20, dn: hw + 0.20, round: 0.22 },
    { d: height - 0.06, w: hl + 0.14, up: hw + 0.14, dn: hw + 0.14, round: 0.2 },
    { d: height, w: hl + 0.10, up: hw + 0.10, dn: hw + 0.10, round: 0.2 },
  ], {
    sides: 84, samples: 16, axis: 'y',
    warp: (t, u) => Math.sin(u * Math.PI * 2 * 9) * 0.06 * (1 - t),
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const border = p.y < height - 0.72;
      const c = col(border ? WONDER.pinkCup : WONDER.cream);
      return [c.r, c.g, c.b];
    },
  });
  // The mint runner: its own thin slab, because the cloth's top is a centre-fan cap
  // with no interior vertices for a tint to land on (the villi-floor lesson).
  put(parts, laid(extrudeOutline(roundedOutline(hl * 0.92, 0.68, 0.2, 3), 0.03)), WONDER.mint,
    [0, height + 0.015, 0]);
  // Turned legs, stout enough to read below the hem.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(parts, lathed(closed([
        [0.21, 0], [0.21, 0.2], [0.12, 0.32], [0.17, 0.7], [0.12, 1.0], [0.18, 1.35], [0.13, height - 0.3],
      ]), { segments: 14 }), WONDER.woodDeep, [sx * (hl - 0.55), 0, sz * (hw - 0.4)]);
    }
  }

  const TOP = height + 0.01;
  // A teapot: body, spout (a capped chain), handle (a torus buried at both ends), lid.
  const teapot = (x, z, colour, accent, yaw) => {
    put(parts, lathed(closed([
      [0.20, 0.0], [0.42, 0.06], [0.50, 0.32], [0.46, 0.58], [0.30, 0.72], [0.13, 0.76],
    ]), { segments: 30 }), 0xffffff, [x, TOP, z], [0, yaw, 0], {
      keepColor: true,
      tint: (p) => {
        const dots = smoothNoise3(p.x * 11 + 5, p.y * 11, p.z * 11) > 0.74;
        const c = col(dots ? accent : colour);
        return [c.r, c.g, c.b];
      },
    });
    put(parts, lathed(closed([[0.14, 0], [0.10, 0.05], [0.05, 0.09], [0.045, 0.13]])), colour, [x, TOP + 0.74, z]);
    put(parts, ball(0.045, 8), accent, [x, TOP + 0.88, z]);
    const ca = Math.cos(yaw);
    const sa = Math.sin(yaw);
    chain(parts, colour, [
      { p: [x + sa * 0.38, TOP + 0.28, z + ca * 0.38], r: 0.055 },
      { p: [x + sa * 0.62, TOP + 0.46, z + ca * 0.62], r: 0.045 },
      { p: [x + sa * 0.70, TOP + 0.62, z + ca * 0.70], r: 0.038 },
    ], { sides: 8 });
    put(parts, new THREE.TorusGeometry(0.17, 0.045, 8, 16), colour,
      [x - sa * 0.52, TOP + 0.42, z - ca * 0.52], [0, yaw, 0.15]);
  };
  teapot(-1.7, 0.1, WONDER.pinkCup, 0xffffff, 0.5);
  teapot(2.6, -0.4, WONDER.teal, WONDER.cream, -1.9);

  // A cup on a saucer. `lean` tips the stacked-tower cups.
  const cup = (x, z, colour, { lean = 0, yaw = 0, lift = 0, saucer = true } = {}) => {
    if (saucer) {
      put(parts, lathed(closed([[0.10, 0.0], [0.26, 0.02], [0.30, 0.055], [0.27, 0.06], [0.10, 0.025]]), { segments: 22 }), colour, [x, TOP + lift, z]);
    }
    put(parts, lathed(closed([
      [0.085, 0.02], [0.13, 0.05], [0.155, 0.20], [0.16, 0.24], [0.125, 0.24], [0.115, 0.09], [0.055, 0.05],
    ]), { segments: 20 }), colour, [x, TOP + lift + (saucer ? 0.05 : 0), z], [lean, yaw, lean * 0.6]);
    put(parts, new THREE.TorusGeometry(0.055, 0.017, 6, 12), colour,
      [x + Math.sin(yaw + Math.PI / 2) * 0.16, TOP + lift + 0.15, z + Math.cos(yaw + Math.PI / 2) * 0.16], [0, yaw, 0]);
  };
  let ci = 0;
  for (const [cx, cz] of [[-3.6, 0.6], [-2.6, -0.8], [-0.6, 0.9], [0.5, -0.9], [1.5, 0.7], [3.6, 0.5]]) {
    cup(cx + randomIn(rng, -0.1, 0.1), cz + randomIn(rng, -0.1, 0.1), PASTELS[ci++ % PASTELS.length], { yaw: rng() * 3 });
  }
  // The leaning tower of cups.
  cup(-0.5, -0.2, WONDER.lilac, {});
  cup(-0.52, -0.2, WONDER.mint, { lift: 0.30, lean: 0.10, saucer: false });
  cup(-0.48, -0.16, WONDER.pinkCup, { lift: 0.56, lean: -0.14, saucer: false, yaw: 1.2 });

  // The cake stand: stem, two tiers, little cakes, cherries.
  {
    const SX = 1.0;
    const SZ = 0.15;
    put(parts, lathed(closed([
      [0.30, 0.0], [0.10, 0.05], [0.07, 0.5], [0.10, 0.55],
    ]), { segments: 18 }), WONDER.cream, [SX, TOP, SZ]);
    for (const [ty, tr] of [[0.55, 0.62], [1.02, 0.40]]) {
      put(parts, lathed(closed([[tr, 0], [tr + 0.03, 0.02], [tr, 0.045], [0.06, 0.045]]), { segments: 26 }), WONDER.cream, [SX, TOP + ty, SZ]);
      if (ty < 1) {
        put(parts, lathed(closed([[0.07, 0.045], [0.07, 0.45], [0.09, 0.5]]), { segments: 12 }), WONDER.cream, [SX, TOP + ty, SZ]);
      }
    }
    let k = 0;
    for (const [dx, dz, tier] of [[-0.34, 0.1, 0.6], [0.05, -0.33, 0.6], [0.3, 0.24, 0.6], [-0.12, 0.1, 1.07], [0.14, -0.08, 1.07]]) {
      const cc = PASTELS[(k + 1) % PASTELS.length];
      put(parts, lathed(closed([[0.115, 0], [0.13, 0.09], [0.10, 0.16], [0.05, 0.17]]), { segments: 14 }), cc, [SX + dx, TOP + tier, SZ + dz]);
      put(parts, ball(0.035, 8), WONDER.heart, [SX + dx, TOP + tier + 0.19, SZ + dz]);
      k++;
    }
  }
  // Scattered macarons and sugar cubes.
  for (let i = 0; i < 7; i++) {
    const mx = randomIn(rng, -hl + 0.8, hl - 0.8);
    const mz = randomIn(rng, -hw + 0.6, hw - 0.6);
    if (i % 2) {
      put(parts, lathed(closed([[0.09, 0], [0.10, 0.03], [0.095, 0.05], [0.10, 0.07], [0.09, 0.09], [0.04, 0.10]]), { segments: 12 }),
        PASTELS[Math.floor(rng() * PASTELS.length)], [mx, TOP, mz]);
    } else {
      put(parts, new THREE.BoxGeometry(0.09, 0.08, 0.09), 0xfdfcf6, [mx, TOP + 0.04, mz], [0, rng() * 2, 0]);
    }
  }

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.7, metalness: 0.02,
    ...relief('weave', { seed, repeat: 6, strength: 0.3 }),
  })));
}

// A mismatched painted chair. `tall` makes the high-backed one at the head of the
// table; the heart cut in the back is a real extruded outline, not a decal.
export function teaChair({ seed = 19, colour = 0x64c4b4, tall = false } = {}) {
  const parts = [];
  const seatY = 1.45;
  const backH = tall ? 3.6 : 2.6;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      put(parts, lathed(closed([
        [0.09, 0], [0.09, 0.14], [0.055, 0.24], [0.075, 0.8], [0.055, seatY - 0.1],
      ]), { segments: 12 }), WONDER.woodDeep, [sx * 0.62, 0, sz * 0.55]);
    }
  }
  put(parts, extrudeOutline(roundedOutline(0.78, 0.68, 0.2, 4), 0.14), colour,
    [0, seatY, 0], [-Math.PI / 2, 0, 0]);
  // Back stiles and the heart-pierced splat.
  for (const sx of [-1, 1]) {
    chain(parts, WONDER.woodDeep, [
      { p: [sx * 0.62, seatY, -0.52], r: 0.055 },
      { p: [sx * 0.56, seatY + backH * 0.7, -0.58], r: 0.05 },
      { p: [sx * 0.46, seatY + backH, -0.60], r: 0.045 },
    ], { sides: 8 });
  }
  put(parts, extrudeOutline(roundedOutline(0.52, backH * 0.32, 0.16, 4), 0.09), colour,
    [0, seatY + backH * 0.62, -0.57], [0.06, 0, 0]);
  // The heart, standing proud of the splat.
  const heartPts = [];
  for (let i = 0; i <= 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    heartPts.push([
      0.16 * Math.sin(t) ** 3,
      0.012 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    ]);
  }
  put(parts, extrudeOutline(heartPts, 0.12), WONDER.heart, [0, seatY + backH * 0.62, -0.56], [0.06, 0, 0]);
  // Ball finials on the stiles -- the flat crest disc read as a plate balanced on the
  // chair back.
  for (const sx of [-1, 1]) {
    put(parts, ball(0.085, 10), WONDER.woodDeep, [sx * 0.46, seatY + backH + 0.05, -0.60]);
  }

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.68, metalness: 0.02,
    ...relief('wood', { seed, repeat: 4, strength: 0.5 }),
  })));
}

// A giant pastel teacup a student can walk up to and look into -- and it ships
// spinning, one more program to open and change. The inner wall runs all the way down
// to a real floor inside, so looking in shows tea, not back faces.
export function giantTeacup({ seed = 23, radius = 2.4, colour = 0xf0b8cc } = {}) {
  const parts = [];
  const R = radius;
  const H = R * 0.82;
  put(parts, lathed(closed([
    [R * 0.55, 0.0], [R * 1.28, 0.04], [R * 1.42, 0.14], [R * 1.30, 0.20], [R * 0.55, 0.10],
  ]), { segments: 44 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const c = mixCol(colour, 0xffffff, 0.35);
      return [c.r, c.g, c.b];
    },
  });
  put(parts, lathed(closed([
    [R * 0.42, 0.12], [R * 0.62, 0.22], [R * 0.86, H * 0.45], [R * 0.98, H * 0.92], [R, H],
    [R * 0.94, H], [R * 0.82, H * 0.9], [R * 0.62, H * 0.42], [R * 0.42, H * 0.30],
  ]), { segments: 44 }), 0xffffff, [0, 0.1, 0], null, {
    keepColor: true,
    tint: (p) => {
      const dots = smoothNoise3(p.x * 2.2 + 8, p.y * 2.2, p.z * 2.2) > 0.72;
      const c = col(dots ? 0xffffff : colour);
      return [c.r, c.g, c.b];
    },
  });
  // Gold rim, the tea inside, and the big handle -- a FULL torus, its inner arc buried
  // in the cup wall, because a partial torus's two tube ends are open rings.
  put(parts, new THREE.TorusGeometry(R * 0.975, 0.05, 8, 44), WONDER.gold, [0, H + 0.1, 0], [Math.PI / 2, 0, 0]);
  put(parts, lathed(closed([[R * 0.80, 0], [R * 0.80, 0.02]]), { segments: 36 }), 0xa8743c, [0, H * 0.55, 0]);
  put(parts, new THREE.TorusGeometry(R * 0.29, R * 0.095, 12, 26), colour,
    [R * 1.06, H * 0.54, 0], [0, 0, -0.15]);

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.5, metalness: 0.04,
  })));
}

// ---------------------------------------------------------------------------
// FLORA
// ---------------------------------------------------------------------------

// A giant toadstool: curved stem, skirt ring, domed cap with sunken white spots.
// `lean` tips the whole thing a few degrees so a grove never reads as bollards.
export function giantMushroom({
  seed = 29, height = 6, capColour = 0xd0453e, spots = true, lean = 0,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const H = height;
  const capR = H * 0.52;
  const capBase = H * 0.62;
  const stemLean = H * 0.06;

  // The stem: a 'y' loft drifting sideways as it rises.
  put(parts, solidLoft([
    { d: 0, w: H * 0.16, h: H * 0.16, round: 1 },
    { d: H * 0.2, w: H * 0.125, h: H * 0.125, a: stemLean * 0.3, round: 1 },
    { d: H * 0.45, w: H * 0.115, h: H * 0.115, a: stemLean * 0.8, round: 1 },
    { d: capBase + H * 0.06, w: H * 0.14, h: H * 0.14, a: stemLean, round: 1 },
  ], {
    sides: 24, samples: 20, axis: 'y',
    warp: (t, u) => smoothNoise3(u * 2.5, t * 4, seed) * H * 0.014,
  }), WONDER.mushroomCream);
  // The skirt ring under the cap.
  put(parts, new THREE.TorusGeometry(H * 0.145, H * 0.035, 10, 20), 0xe0d0b0,
    [stemLean * 0.85, capBase - H * 0.035, 0], [Math.PI / 2 + 0.15, 0, 0]);

  // The cap: dome above, curled under-rim, dark gill disc below -- one closed lathe.
  put(parts, lathed(closed([
    [capR * 0.55, 0.0], [capR * 0.9, 0.02], [capR, H * 0.055], [capR * 0.995, H * 0.11],
    [capR * 0.9, H * 0.2], [capR * 0.62, H * 0.31], [capR * 0.28, H * 0.375], [0.02, H * 0.395],
  ]), { segments: 40 }), 0xffffff, [stemLean, capBase, 0], null, {
    keepColor: true,
    tint: (p) => {
      if (p.y < H * 0.035) {
        const c = col(0xcbb794);
        return [c.r, c.g, c.b];
      }
      const c = mixCol(capColour, 0xffffff, Math.max(0, p.y / (H * 0.395) - 0.6) * 0.25);
      return [c.r, c.g, c.b];
    },
  });
  if (spots) {
    // Spots seated by asking the cap's own profile where its surface is.
    const capProfile = (t) => [capR * (1 - t * t * 0.72), H * (0.055 + t * 0.34)];
    for (let i = 0; i < 11; i++) {
      const a = rng() * Math.PI * 2;
      const t = 0.15 + rng() * 0.75;
      const [r, y] = capProfile(t);
      const up = Math.atan2(t * 1.4, 1);
      stud(parts, 0xf6efe2, {
        at: [stemLean + Math.sin(a) * r, capBase + y, Math.cos(a) * r],
        normal: [Math.sin(a) * Math.cos(up), Math.sin(up) + 0.4, Math.cos(a) * Math.cos(up)],
        radius: H * (0.05 + rng() * 0.035), rise: H * 0.02, sink: 0.45, detail: 10,
      });
    }
  }
  // Grass tuft at the foot.
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    spike(parts, WONDER.leafDeep, {
      length: 0.5 + rng() * 0.3, radius: 0.08, at: [Math.sin(a) * H * 0.17, 0.15, Math.cos(a) * H * 0.17],
      rot: [randomIn(rng, -0.3, 0.3), 0, randomIn(rng, -0.3, 0.3)], sides: 6,
    });
  }

  const g = mergeParts(parts);
  return group(mesh(lean ? placed(g, { rot: [0, 0, lean], about: [0, 0, 0] }) : g, standard({
    vertexColors: true, roughness: 0.62, metalness: 0,
    ...relief('soil', { seed, repeat: 5, strength: 0.4 }),
  })));
}

// A fairy ring of small toadstools with grass tufts between them.
export function mushroomRing({ seed = 31, radius = 3.6, count = 9 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.3;
    const r = radius * randomIn(rng, 0.9, 1.08);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const h = randomIn(rng, 0.5, 0.95);
    const cap = [WONDER.mushroomRed, 0xd8843c, WONDER.lilac][Math.floor(rng() * 3)];
    put(parts, lathed(closed([[h * 0.16, 0], [h * 0.13, h * 0.55], [h * 0.17, h * 0.62]]), { segments: 10 }),
      WONDER.mushroomCream, [x, 0, z]);
    put(parts, lathed(closed([
      [h * 0.42, h * 0.55], [h * 0.44, h * 0.62], [h * 0.30, h * 0.78], [0.01, h * 0.84],
    ]), { segments: 16 }), cap, [x, 0, z]);
    stud(parts, 0xf6efe2, {
      at: [x, h * 0.8, z], normal: [0.2, 1, 0.1], radius: h * 0.09, rise: h * 0.04, sink: 0.4, detail: 8,
    });
    spike(parts, WONDER.leafDeep, {
      length: 0.4, radius: 0.06, at: [x + 0.3, 0.12, z - 0.2], rot: [0.2, 0, -0.15], sides: 6,
    });
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.65, ...relief('soil', { seed, repeat: 4, strength: 0.4 }),
  })));
}

// The Wonderland tree: a gnarled violet-barked trunk that twists as it rises, a few
// crooked limbs, and either a teal dream-canopy, a blossom canopy, or bare twisted
// branches. `perch: true` grows the Cheshire Cat's branch instead -- a thick level
// limb along local +X whose top is at PERCH height, kept clear of canopy.
export const PERCH = { x: 3.7, y: 8.45, z: 0.3 };

export function wonderTree({
  seed = 37, height = 22, canopy = 'teal', perch = false,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const H = height;

  // The trunk: root flare warped into buttresses, then a twisting climb.
  const twist = rng() * Math.PI * 2;
  put(parts, solidLoft([
    { d: 0, w: H * 0.085, h: H * 0.085, round: 0.7 },
    { d: H * 0.06, w: H * 0.062, h: H * 0.062, round: 0.85 },
    { d: H * 0.3, w: H * 0.048, h: H * 0.048, a: Math.sin(twist) * H * 0.03, b: Math.cos(twist) * H * 0.02, round: 1 },
    { d: H * 0.55, w: H * 0.04, h: H * 0.04, a: Math.sin(twist + 1.8) * H * 0.05, b: Math.cos(twist + 1.4) * H * 0.035, round: 1 },
    { d: H * 0.75, w: H * 0.032, h: H * 0.032, a: Math.sin(twist + 3.1) * H * 0.03, round: 1 },
    { d: H * 0.82, w: H * 0.02, h: H * 0.02, round: 1 },
  ], {
    sides: 26, samples: 30, axis: 'y',
    warp: (t, u) => grooveAt(((u * 5 + t * 1.2) % 1) - 0.5, 0.13, H * 0.012) + smoothNoise3(u * 4, t * 7, seed) * H * 0.008,
  }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const k = 0.75 + smoothNoise3(p.x * 0.6, p.y * 0.6, p.z * 0.6) * 0.5;
      const c = mixCol(WONDER.barkDeep, WONDER.bark, Math.min(1, k));
      return [c.r, c.g, c.b];
    },
  });

  // Limbs: capped chains wandering outward. The canopy puffs sit ON their ends.
  const limbEnds = [];
  const limbs = perch ? 2 : 3;
  for (let i = 0; i < limbs; i++) {
    const a = twist + (i / limbs) * Math.PI * 2 + (perch ? 1.9 : 0.6);
    const e = [Math.sin(a) * H * 0.28, H * (0.78 + rng() * 0.16), Math.cos(a) * H * 0.28];
    chain(parts, WONDER.bark, [
      { p: [Math.sin(a) * H * 0.02, H * 0.62, Math.cos(a) * H * 0.02], r: H * 0.026 },
      { p: [Math.sin(a) * H * 0.14, H * 0.74, Math.cos(a) * H * 0.14], r: H * 0.02 },
      { p: e, r: H * 0.012 },
    ], { sides: 10 });
    limbEnds.push(e);
  }
  limbEnds.push([0, H * 0.84, 0]);

  if (perch) {
    // The Cat's branch: level, knuckled, thick enough to lounge on, reaching +X.
    chain(parts, WONDER.bark, [
      { p: [0.2, PERCH.y - 0.75, 0], r: 0.72 },
      { p: [1.4, PERCH.y - 0.52, 0.18], r: 0.56 },
      { p: [2.9, PERCH.y - 0.48, 0.28], r: 0.52 },
      { p: [4.6, PERCH.y - 0.50, 0.30], r: 0.44 },
      { p: [5.9, PERCH.y - 0.30, 0.4], r: 0.16 },
    ], { sides: 12 });
    // A snag stub beyond it, like the reference painting's dead branch.
    chain(parts, WONDER.barkDeep, [
      { p: [4.4, PERCH.y - 0.6, 0.3], r: 0.2 },
      { p: [5.4, PERCH.y - 1.4, 0.7], r: 0.06 },
    ], { sides: 8 });
  }

  if (canopy !== 'bare') {
    const base = canopy === 'blossom' ? WONDER.blossom : WONDER.canopyTeal;
    const deep = canopy === 'blossom' ? WONDER.blossomDeep : 0x224f42;
    const crownTint = {
      keepColor: true,
      tint: (p) => {
        const k = smoothNoise3(p.x * 0.9 + seed, p.y * 0.9, p.z * 0.9);
        const c = mixCol(deep, base, 0.35 + k * 0.65);
        return [c.r, c.g, c.b];
      },
    };
    // Puffs pulled IN toward the crown so every pair overlaps -- a canopy of separate
    // balls with daylight between them is a bunch of balloons, not a tree -- plus one
    // central mass that bridges the trunk top into the cluster.
    for (const e of limbEnds) {
      const rr = H * randomIn(rng, 0.18, 0.24);
      put(parts, ball(rr, 20), 0xffffff, [e[0] * 0.68, e[1] - rr * 0.08, e[2] * 0.68], null, {
        scale: [1.2, 0.85, 1.15], ...crownTint,
      });
    }
    put(parts, ball(H * 0.21, 20), 0xffffff, [0, H * 0.80, 0], null, {
      scale: [1.25, 0.9, 1.2], ...crownTint,
    });
  }
  // Moss skirt at the base.
  put(parts, ball(H * 0.11, 14), WONDER.leafDeep, [0, 0, 0], null, { scale: [1.5, 0.3, 1.5] });

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.85, metalness: 0,
    ...relief('bark', { seed, repeat: 4, strength: 0.8 }),
  })));
}

// A giant dreaming flower: a curved stem, two leaf blades with real thickness, and a
// ring of petal plates round a face that is fast asleep. The face is a small canvas
// on the flower's button centre -- subtle, storybook, not a jump scare.
export function wonderFlower({
  seed = 41, height = 7, petal = 0xe0455f, heart = 0xf2c94c,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const H = height;
  const lean = 0.35;
  const headAt = [Math.sin(lean) * H * 0.28, H * 0.92, 0.15];

  chain(parts, WONDER.leaf, [
    { p: [0, 0, 0], r: H * 0.028 },
    { p: [Math.sin(lean) * H * 0.10, H * 0.5, 0.02], r: H * 0.022 },
    { p: [headAt[0], headAt[1] - 0.35, headAt[2] - 0.12], r: H * 0.018 },
  ], { sides: 10 });
  // Leaves: solidSurface blades, thickness dying at the edges.
  for (const [sx, ly, yaw] of [[-1, H * 0.22, 0.6], [1, H * 0.38, -0.8]]) {
    const L = H * 0.34;
    put(parts, solidSurface({
      nu: 8, nv: 6,
      point: (u, v) => {
        const along = u * L;
        const wHalf = Math.sin(u * Math.PI) * L * 0.30;
        return [
          sx * (0.1 + along * Math.cos(0.5)),
          ly + along * 0.55 + Math.sin(u * Math.PI) * 0.3 - v * 0.06,
          (v - 0.5) * 2 * wHalf,
        ];
      },
      thick: (u, v) => 0.03 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) + 0.004,
    }), WONDER.leaf, null, [0, yaw, 0]);
  }
  // Petals: lens plates fanned round the head, tilted toward the viewer.
  const petals = 9;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const pl = H * 0.22;
    put(parts, extrudeOutline(lensOutline(pl * 0.5, pl * 0.20), 0.05), 0xffffff, [
      headAt[0] + Math.cos(a) * pl * 0.62,
      headAt[1] + Math.sin(a) * pl * 0.62,
      headAt[2] - 0.02 + Math.sin(i * 2.2) * 0.03,
    ], [0.32, 0, a], {
      keepColor: true,
      tint: (p) => {
        const c = mixCol(petal, 0xffffff, Math.max(0, Math.abs(p.x) / (pl * 0.5)) * 0.35);
        return [c.r, c.g, c.b];
      },
    });
  }
  put(parts, ball(H * 0.115, 18), heart, [headAt[0], headAt[1], headAt[2] + 0.02], null, { scale: [1, 1, 0.55] });

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.6, ...relief('soil', { seed, repeat: 4, strength: 0.3 }),
  })));
  // The sleeping face.
  const face = texPlate(H * 0.15, H * 0.15, 96, 96, (ctx, w, h) => {
    ctx.fillStyle = `#${col(heart).getHexString()}`;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5c4018';
    ctx.lineWidth = 5;
    for (const ex of [w * 0.32, w * 0.68]) {
      ctx.beginPath();
      ctx.arc(ex, h * 0.42, w * 0.11, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.62, w * 0.14, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(214, 106, 89, 0.5)';
    for (const ex of [w * 0.18, w * 0.82]) {
      ctx.beginPath();
      ctx.arc(ex, h * 0.58, w * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  face.position.set(headAt[0], headAt[1], headAt[2] + 0.09);
  g.add(face);
  return g;
}

// A rose bush -- and if `painted` is set, the gag from the story: half the white roses
// are dripping red, and a paint pot and brush stand at the foot of the bush.
export function roseBush({ seed = 43, size = 3.2, painted = false } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const R = size / 2;

  // The bush body: three overlapping lumpy balls.
  for (const [dx, dz, rr] of [[-R * 0.4, 0, R * 0.75], [R * 0.42, R * 0.15, R * 0.68], [0, -R * 0.3, R * 0.7]]) {
    put(parts, ball(rr, 18), 0xffffff, [dx, rr * 0.75, dz], null, {
      keepColor: true,
      tint: (p) => {
        const k = smoothNoise3(p.x * 1.4 + seed, p.y * 1.4, p.z * 1.4);
        const c = mixCol(WONDER.leafDeep, WONDER.hedge, 0.3 + k * 0.7);
        return [c.r, c.g, c.b];
      },
    });
  }
  // Roses: a swirl-tinted ball with a five-stud petal collar, seated on the bush.
  const roses = 8;
  for (let i = 0; i < roses; i++) {
    const a = (i / roses) * Math.PI * 2 + rng() * 0.4;
    const el = randomIn(rng, 0.15, 0.9);
    const dir = [Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el)];
    const at = [dir[0] * R * 0.78, R * 0.72 + dir[1] * R * 0.72, dir[2] * R * 0.78];
    const red = painted ? i % 2 === 0 : true;
    const roseCol = red ? WONDER.roseRed : WONDER.roseWhite;
    put(parts, ball(R * 0.16, 12), 0xffffff, at, null, {
      keepColor: true,
      tint: (p) => {
        const swirl = Math.sin(Math.atan2(p.z, p.x) * 3 + p.y * 18) * 0.5 + 0.5;
        const c = mixCol(roseCol, red ? 0x8f1f30 : 0xd8ccb8, swirl * 0.4);
        // A drip of fresh paint down the white ones being painted.
        if (painted && !red && p.y < -R * 0.06 && Math.abs(p.x) < R * 0.03) c.set(WONDER.roseRed);
        return [c.r, c.g, c.b];
      },
    });
    for (let k = 0; k < 5; k++) {
      const pa = (k / 5) * Math.PI * 2;
      stud(parts, roseCol, {
        at: [at[0] + Math.cos(pa) * R * 0.13, at[1] - R * 0.05, at[2] + Math.sin(pa) * R * 0.13],
        normal: [Math.cos(pa) * 0.7, 0.7, Math.sin(pa) * 0.7],
        radius: R * 0.075, rise: R * 0.03, sink: 0.35, detail: 8,
      });
    }
  }
  if (painted) {
    put(parts, lathed(closed([
      [0.24, 0], [0.26, 0.02], [0.28, 0.36], [0.30, 0.40], [0.26, 0.40], [0.24, 0.38], [0.22, 0.06],
    ]), { segments: 16 }), 0x8f9299, [R * 0.9, 0, R * 0.55]);
    put(parts, lathed(closed([[0.22, 0.38], [0.22, 0.40]]), { segments: 16 }), WONDER.roseRed, [R * 0.9, 0.005, R * 0.55]);
    chain(parts, WONDER.wood, [
      { p: [R * 0.9 + 0.3, 0.42, R * 0.55 - 0.1], r: 0.03 },
      { p: [R * 0.9 + 0.62, 0.9, R * 0.55 - 0.28], r: 0.025 },
    ], { sides: 6 });
    stud(parts, WONDER.roseRed, {
      at: [R * 0.9 + 0.28, 0.44, R * 0.55 - 0.09], normal: [0.4, 1, -0.2],
      radius: 0.06, rise: 0.05, sink: 0.3, detail: 6,
    });
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.8, ...relief('soil', { seed, repeat: 5, strength: 0.5 }),
  })));
}

// A run of clipped hedge with heart finials -- the Queen's garden wall.
export function heartHedge({ seed = 47, length = 9, height = 3.2 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const hl = length / 2;
  put(parts, solidLoft([
    { d: -hl, w: 0.02, up: 0.02, dn: 0.02, round: 0.6 },
    { d: -hl + 0.5, w: 1.05, up: height * 0.5, dn: height * 0.5, round: 0.5 },
    { d: 0, w: 1.1, up: height * 0.52, dn: height * 0.52, round: 0.5 },
    { d: hl - 0.5, w: 1.05, up: height * 0.5, dn: height * 0.5, round: 0.5 },
    { d: hl, w: 0.02, up: 0.02, dn: 0.02, round: 0.6 },
  ], {
    sides: 30, samples: 30, axis: 'x',
    warp: (t, u) => smoothNoise3(t * 9 + seed, u * 3.2, 2.2) * 0.10 - 0.05,
  }), 0xffffff, [0, height * 0.52, 0], null, {
    keepColor: true,
    tint: (p) => {
      const k = smoothNoise3(p.x * 0.8, p.y * 0.8 + seed, p.z * 0.8);
      const c = mixCol(WONDER.leafDeep, WONDER.hedge, 0.3 + k * 0.7);
      return [c.r, c.g, c.b];
    },
  });
  // Heart finials on trimmed posts at each end.
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.16, 0.22, 0.55, 10), WONDER.leafDeep, [sx * (hl - 0.5), height + 0.18, 0]);
    const heartPts = [];
    for (let i = 0; i <= 22; i++) {
      const t = (i / 22) * Math.PI * 2;
      heartPts.push([
        0.62 * Math.sin(t) ** 3,
        0.048 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      ]);
    }
    put(parts, extrudeOutline(heartPts, 0.38), WONDER.hedge, [sx * (hl - 0.5), height + 1.15, 0], [0, sx * 0.3, 0]);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.85, ...relief('soil', { seed, repeat: 6, strength: 0.6 }),
  })));
}

// ---------------------------------------------------------------------------
// THE SET
// ---------------------------------------------------------------------------

// The rabbit hole: a grassy mound built VOID FIRST -- the dark recess is five real
// faces, the mound is placed around it, and a little arched door with a brass knob
// stands open at the back of the dark, going down.
export function rabbitHole({ seed = 53, width = 7 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const R = width / 2;

  // THE OPENING IS BUILT FORWARD, NOT CARVED BACK -- the Machu Picchu niche rule. The
  // funnel warped into the mound below shades the approach, but what actually reads as
  // "hole" from thirty feet is a near-black ARCH standing inside it, with the tiny
  // door ajar on its face and a dark tongue of floor running out of it.
  const VW = R * 0.40;
  const VH = R * 0.52;
  const dark = 0x120d16;
  const archPts = [
    [-VW * 1.1, 0], [VW * 1.1, 0], [VW * 1.1, VH * 1.15], [VW * 0.7, VH * 1.75],
    [0, VH * 2.0], [-VW * 0.7, VH * 1.75], [-VW * 1.1, VH * 1.15],
  ];
  put(parts, extrudeOutline(archPts, 0.16), dark, [0, 0, -R * 0.05]);
  put(parts, new THREE.BoxGeometry(VW * 2, 0.1, R * 0.9), dark, [0, 0.03, R * 0.30], [-0.16, 0, 0]);
  // The tiny door, ajar on the face of the dark.
  const doorPts = [[-0.5, 0], [0.5, 0], [0.5, 0.75], [0.35, 1.05], [0, 1.18], [-0.35, 1.05], [-0.5, 0.75]];
  put(parts, extrudeOutline(doorPts, 0.09), WONDER.wood, [0.35, 0.02, -R * 0.05 + 0.16], [0, -0.4, 0]);
  stud(parts, WONDER.gold, { at: [0.12, 0.55, -R * 0.05 + 0.24], normal: [-0.3, 0.1, 1], radius: 0.055, rise: 0.05, sink: 0.3, detail: 8 });

  // The mound around the void: a TALL rounded hummock with the mouth bitten into its
  // FACE. Height matters: at 0.7R the opening had nowhere to live but the top, and the
  // whole thing read as a bunker.
  put(parts, solidLoft([
    { d: -R, w: 0.03, h: 0.03, round: 0.8 },
    { d: -R * 0.55, w: R * 0.85, up: R * 0.88, dn: R * 0.4, round: 0.68 },
    { d: R * 0.1, w: R, up: R * 1.0, dn: R * 0.4, round: 0.66 },
    { d: R * 0.68, w: R * 0.68, up: R * 0.66, dn: R * 0.4, round: 0.72 },
    { d: R, w: 0.03, h: 0.03, round: 0.8 },
  ], {
    sides: 44, samples: 30, axis: 'x',
    warp: (t, u) => {
      // The mouth: a deep bite where the mound faces +Z at ground level.
      const local = { t: (t - 0.5) * 2 };
      const uu = Math.min(Math.abs(u), Math.abs(u - 1));
      const mouth = Math.exp(-(uu ** 2) / 0.013) * Math.exp(-(local.t ** 2) / 0.2);
      return smoothNoise3(t * 5, u * 5, seed) * R * 0.05 - mouth * R * 0.82;
    },
  }), 0xffffff, [0, 0, -R * 0.22], null, {
    keepColor: true,
    tint: (p) => {
      const soil = p.y < 0.9 && p.z > -0.4;
      const k = smoothNoise3(p.x * 1.1, p.y * 1.1, p.z * 1.1 + seed);
      const c = soil ? mixCol(0x4a3524, 0x6b5138, k) : mixCol(WONDER.leafDeep, WONDER.hedge, 0.25 + k * 0.75);
      return [c.r, c.g, c.b];
    },
  });
  // Roots framing the mouth -- thick enough to silhouette against the dark.
  for (const [sx, rr] of [[-1, 0.24], [1, 0.20]]) {
    chain(parts, WONDER.bark, [
      { p: [sx * VW * 1.45, 0.05, 0.7], r: rr },
      { p: [sx * VW * 1.22, VH * 0.95, 0.05], r: rr * 0.82 },
      { p: [sx * VW * 0.42, VH * 1.42, -0.65], r: rr * 0.65 },
      { p: [-sx * VW * 0.48, VH * 1.36, -0.85], r: rr * 0.5 },
    ], { sides: 9 });
  }
  // A trodden dirt apron out the front.
  put(parts, lathed(closed([[VW * 1.5, 0], [VW * 1.5, 0.05]]), { segments: 20 }), 0x5c452e, [0, 0.02, 0.8]);

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.85, ...relief('soil', { seed, repeat: 5, strength: 0.6 }),
  })));
}

// A card soldier: a walking playing card. The card is a real solid with a white edge;
// the pips and frame are a texture plate on its front; head, limbs and halberd are
// chains and lathes. `suit`/`rank` pick the card.
export function cardSoldier({ seed = 59, suit = 'heart', rank = '2', height = 6.2 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const red = suit === 'heart' || suit === 'diamond';
  const suitCol = red ? WONDER.heart : WONDER.spade;

  const CW = 1.05; // card half-width
  const CH = 1.55; // card half-height
  const cardC = 3.15; // card centre height

  // The card body.
  put(parts, extrudeOutline(roundedOutline(CW, CH, 0.16, 5), 0.16), WONDER.cardWhite, [0, cardC, 0]);
  // Legs, feet, arms, hands -- black-clad, socketed.
  for (const sx of [-1, 1]) {
    chain(parts, WONDER.ink, [
      { p: [sx * 0.38, 1.62, 0], r: 0.10 },
      { p: [sx * 0.40, 0.85, 0.03], r: 0.085 },
      { p: [sx * 0.40, 0.35, 0.02], r: 0.075 },
    ], { sides: 10 });
    put(parts, solidLoft([
      { d: -0.18, w: 0.10, up: 0.11, dn: 0.001, round: 0.7 },
      { d: 0.10, w: 0.115, up: 0.12, dn: 0.001, round: 0.65 },
      { d: 0.38, w: 0.09, up: 0.07, dn: 0.001, round: 0.8 },
    ], { sides: 20, samples: 10, axis: 'z' }), suitCol, [sx * 0.40, 0.03, 0.08]);
  }
  chain(parts, WONDER.ink, [
    { p: [-CW + 0.06, 3.7, 0], r: 0.085 },
    { p: [-CW - 0.35, 3.35, 0.15], r: 0.075 },
    { p: [-CW - 0.45, 2.95, 0.28], r: 0.065 },
  ], { sides: 10 });
  put(parts, ball(0.10, 10), WONDER.cardWhite, [-CW - 0.47, 2.87, 0.32]);
  // Right arm grips the halberd.
  chain(parts, WONDER.ink, [
    { p: [CW - 0.06, 3.7, 0], r: 0.085 },
    { p: [CW + 0.32, 3.4, 0.18], r: 0.075 },
    { p: [CW + 0.42, 3.05, 0.30], r: 0.065 },
  ], { sides: 10 });
  put(parts, ball(0.10, 10), WONDER.cardWhite, [CW + 0.45, 2.98, 0.33]);
  // The halberd: shaft, spearhead, and a suit-shaped charm below the head.
  chain(parts, WONDER.wood, [
    { p: [CW + 0.45, 0.15, 0.33], r: 0.05 },
    { p: [CW + 0.45, 5.6, 0.33], r: 0.045 },
  ], { sides: 8 });
  spike(parts, 0xb8bcc4, { length: 0.75, radius: 0.14, at: [CW + 0.45, 6.05, 0.33], sides: 8 });
  put(parts, ball(0.09, 8), suitCol, [CW + 0.45, 5.5, 0.33]);

  // The head over the card's top edge, helmeted in the suit colour.
  const HC = [0, cardC + CH + 0.38, 0];
  put(parts, ball(0.34, 22), WONDER.skin, HC);
  chain(parts, WONDER.skin, [{ p: [0, cardC + CH - 0.1, 0], r: 0.12 }, { p: [0, cardC + CH + 0.15, 0], r: 0.12 }], { sides: 10 });
  put(parts, lathed(closed([
    [0.365, 0.02], [0.375, 0.10], [0.345, 0.26], [0.22, 0.40], [0.02, 0.44],
  ]), { segments: 24 }), suitCol, [HC[0], HC[1] + 0.02, HC[2]]);
  stud(parts, suitCol, { at: [0, HC[1] + 0.46, 0], normal: [0, 1, 0], radius: 0.06, rise: 0.09, sink: 0.3, detail: 8 });
  // Face: two dot eyes, a moustache of two arcs.
  const HEAD_RADII = [0.34, 0.34, 0.34];
  for (const sx of [-1, 1]) {
    const e = onShell(HC, HEAD_RADII, [sx * 0.32, 0.06, 1]);
    stud(parts, 0x2a2118, { at: e.p, normal: e.n, radius: 0.035, rise: 0.025, sink: 0.4, detail: 8 });
    chain(parts, 0x4a3423, shellArc(HC, HEAD_RADII, 5, (t) => [sx * (0.06 + t * 0.22), -0.24 - Math.sin(t * 2.6) * 0.10], 0.01)
      .map((p) => ({ p, r: 0.02 })), { sides: 6, detail: 6 });
  }

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.6, metalness: 0.05,
    ...relief('weave', { seed, repeat: 6, strength: 0.25 }),
  })));

  // The card face: frame, corner indices, pips.
  const pip = (ctx, x, y, size, kind, flip) => {
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = red ? '#c9203a' : '#2b2733';
    if (kind === 'heart') {
      ctx.beginPath();
      ctx.moveTo(0, size * 0.35);
      ctx.bezierCurveTo(size * 0.55, -size * 0.25, size * 0.28, -size * 0.62, 0, -size * 0.2);
      ctx.bezierCurveTo(-size * 0.28, -size * 0.62, -size * 0.55, -size * 0.25, 0, size * 0.35);
      ctx.fill();
    } else if (kind === 'spade') {
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.42);
      ctx.bezierCurveTo(size * 0.5, size * 0.05, size * 0.3, size * 0.34, 0, size * 0.22);
      ctx.bezierCurveTo(-size * 0.3, size * 0.34, -size * 0.5, size * 0.05, 0, -size * 0.42);
      ctx.fill();
      ctx.fillRect(-size * 0.06, size * 0.1, size * 0.12, size * 0.4);
    } else { // club
      for (const [dx, dy] of [[0, -size * 0.2], [-size * 0.2, size * 0.05], [size * 0.2, size * 0.05]]) {
        ctx.beginPath();
        ctx.arc(dx, dy, size * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillRect(-size * 0.05, 0, size * 0.1, size * 0.42);
    }
    ctx.restore();
  };
  const face = texPlate(CW * 2 - 0.14, CH * 2 - 0.14, 256, 384, (ctx, w, h) => {
    ctx.fillStyle = '#f9f5ea';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = red ? '#c9203a' : '#2b2733';
    ctx.lineWidth = 5;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = red ? '#c9203a' : '#2b2733';
    ctx.font = 'bold 44px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(rank, 40, 62);
    pip(ctx, 40, 96, 26, suit, false);
    ctx.save();
    ctx.translate(w - 40, h - 62 + 14);
    ctx.rotate(Math.PI);
    ctx.font = 'bold 44px Georgia, serif';
    ctx.fillText(rank, 0, 0);
    ctx.restore();
    pip(ctx, w - 40, h - 96, 26, suit, true);
    const n = parseInt(rank, 10) || 2;
    const rowsOf = n <= 3 ? [[w / 2, n]] : [[w * 0.36, Math.ceil(n / 2)], [w * 0.64, Math.floor(n / 2)]];
    for (const [colX, count] of rowsOf) {
      for (let i = 0; i < count; i++) {
        const y = h * 0.30 + (count === 1 ? h * 0.2 : (i / (count - 1)) * h * 0.4);
        pip(ctx, colX, y, 34, suit, y > h * 0.55);
      }
    }
  });
  face.position.set(0, cardC, 0.085);
  g.add(face);
  // A plain back pattern on the reverse.
  const back = texPlate(CW * 2 - 0.14, CH * 2 - 0.14, 128, 192, (ctx, w, h) => {
    ctx.fillStyle = '#a83248';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f0d8b8';
    ctx.lineWidth = 2;
    for (let i = -h; i < w + h; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + h, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke();
    }
    ctx.strokeStyle = '#f9f5ea';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  });
  back.position.set(0, cardC, -0.085);
  back.rotation.y = Math.PI;
  g.add(back);

  const s = height / 6.2;
  g.scale.setScalar(s);
  return g;
}

// The signpost that cannot make up its mind: a crooked post carrying arrows every
// which way. Each arrow is a solid with a measured, fitted text plate on its face --
// the arrows point at whatever the layout says they point at.
export function wonderSignpost({
  seed = 61, height = 8,
  arrows = [
    { text: 'TEA PARTY', yaw: -0.7, tilt: 0.06, colour: 0x64c4b4 },
    { text: 'RABBIT HOLE', yaw: 2.3, tilt: -0.08, colour: 0xd35f74 },
    { text: 'THIS WAY', yaw: 0.6, tilt: 0.12, colour: 0xf2c94c },
    { text: 'THAT WAY', yaw: 3.6, tilt: -0.05, colour: 0x8a5cf5 },
  ],
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const H = height;

  // A stout crooked post: the first pass was a 9ft wand with sticks at the top, which
  // from the spawn read as a dead sapling. Thick, short, and the arrows fill its
  // middle band where a 5ft student's eyes actually are.
  put(parts, solidLoft([
    { d: 0, w: 0.46, h: 0.46, round: 0.55 },
    { d: H * 0.12, w: 0.30, h: 0.30, a: 0.08, round: 0.7 },
    { d: H * 0.45, w: 0.25, h: 0.25, a: 0.28, round: 0.8 },
    { d: H * 0.75, w: 0.21, h: 0.21, a: -0.06, b: 0.16, round: 0.9 },
    { d: H, w: 0.15, h: 0.15, a: 0.12, round: 1 },
  ], {
    sides: 18, samples: 24, axis: 'y',
    warp: (t, u) => grooveAt(((u * 4 + t) % 1) - 0.5, 0.12, 0.035),
  }), WONDER.wood);
  put(parts, ball(0.22, 12), WONDER.woodDeep, [0.12, H, 0]);

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.8, ...relief('wood', { seed, repeat: 4, strength: 0.7 }),
  })));

  arrows.forEach((a, i) => {
    const y = H * 0.40 + i * H * 0.155;
    const boards = [];
    // The arrow: a rounded shaft with a real point, extruded.
    const L = 3.3;
    const outline = [
      [-L * 0.5, 0.32], [L * 0.28, 0.32], [L * 0.28, 0.52], [L * 0.62, 0], [L * 0.28, -0.52], [L * 0.28, -0.32], [-L * 0.5, -0.32],
    ];
    put(boards, extrudeOutline(outline, 0.14), a.colour, [0, 0, 0]);
    const bg = mesh(mergeParts(boards), standard({
      vertexColors: true, roughness: 0.75, ...relief('wood', { seed: seed + i, repeat: 3, strength: 0.5 }),
    }));
    const plate = texPlate(L * 0.94, 0.56, 384, 72, (ctx, w, h) => {
      ctx.fillStyle = `#${mixCol(a.colour, 0xffffff, 0.18).getHexString()}`;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#241d2b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const px = fitText(ctx, a.text, w - 70, 44, 'bold {px}px Georgia, serif');
      ctx.font = `bold ${px}px Georgia, serif`;
      ctx.fillText(a.text, w / 2 - 10, h / 2 + 2);
    });
    plate.position.set(0.05, 0, 0.085);
    // A second plate on the reverse, so the sign reads from both sides of the path.
    const plate2 = plate.clone();
    plate2.rotation.y = Math.PI;
    plate2.position.set(0.05, 0, -0.085);
    const arm = group(bg, plate, plate2);
    // The post wobbles; each arrow rides the post's local lean at its own height.
    const leanX = Math.sin(y / H * 3) * 0.18;
    arm.position.set(leanX, y, 0);
    arm.rotation.set(0, a.yaw, a.tilt);
    g.add(arm);
  });
  return g;
}

// The DRINK ME table: a little glass-topped tripod table with the famous bottle, the
// EAT ME cake, and the golden key lying beside them.
export function drinkMeTable({ seed = 67, height = 2.3 } = {}) {
  const parts = [];
  const glassParts = [];
  const H = height;

  put(parts, lathed(closed([
    [0.5, 0], [0.52, 0.05], [0.16, 0.1], [0.09, H * 0.5], [0.13, H * 0.82], [0.30, H * 0.9], [0.34, H * 0.94],
  ]), { segments: 24 }), WONDER.brass, [0, 0, 0]);
  // A solid brass rim round the glass: without it the top vanishes at any distance and
  // the bottle and cake read as floating over a bare pedestal.
  put(parts, new THREE.TorusGeometry(1.16, 0.045, 8, 36), WONDER.brass, [0, H * 0.97, 0], [Math.PI / 2, 0, 0]);
  put(glassParts, lathed(closed([[1.15, H * 0.94], [1.18, H * 0.97], [1.15, H], [0.0, H]]), { segments: 32 }), 0xcfe8e2);

  // The bottle: glass-green lathe, cork, paper label on a string.
  const BX = -0.35;
  put(parts, lathed(closed([
    [0.16, 0], [0.20, 0.03], [0.21, 0.32], [0.13, 0.45], [0.055, 0.52], [0.05, 0.72], [0.065, 0.76], [0.05, 0.78],
  ]), { segments: 20 }), 0x6fae9c, [BX, H, 0.1]);
  put(parts, new THREE.CylinderGeometry(0.045, 0.05, 0.08, 10), 0xc7a76a, [BX, H + 0.80, 0.1]);
  // The cake on a doily, with a cherry.
  const KX = 0.42;
  put(parts, lathed(closed([[0.26, 0], [0.27, 0.02], [0.26, 0.035]]), { segments: 18 }), 0xfdfcf4, [KX, H, -0.15]);
  put(parts, lathed(closed([
    [0.20, 0.03], [0.21, 0.16], [0.185, 0.185], [0.13, 0.20], [0.05, 0.21],
  ]), { segments: 18 }), 0xe8b87c, [KX, H, -0.15]);
  put(parts, lathed(closed([[0.185, 0.185], [0.16, 0.22], [0.05, 0.235]]), { segments: 18 }), WONDER.pinkCup, [KX, H + 0.01, -0.15]);
  put(parts, ball(0.045, 8), WONDER.heart, [KX, H + 0.27, -0.15]);
  // The golden key.
  const keyParts = [];
  put(keyParts, new THREE.TorusGeometry(0.07, 0.022, 6, 14), WONDER.gold, [0, 0, 0]);
  put(keyParts, new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), WONDER.gold, [0.19, 0, 0], [0, 0, Math.PI / 2]);
  put(keyParts, new THREE.BoxGeometry(0.05, 0.02, 0.07), WONDER.gold, [0.30, 0, 0.03]);
  put(keyParts, new THREE.BoxGeometry(0.04, 0.02, 0.05), WONDER.gold, [0.24, 0, 0.03]);
  put(parts, laid(mergeParts(keyParts.map((p) => ({ ...p, color: undefined, geometry: p.geometry }))), 0.8, Math.PI / 2), WONDER.gold, [0.1, H + 0.03, 0.42]);

  const g = group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.45, metalness: 0.3 })),
    mesh(mergeParts(glassParts), standard({
      vertexColors: true, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55,
    })),
  );
  // Labels: DRINK ME on the bottle, EAT ME flag on the cake.
  const label = (text, w, h) => texPlate(w, h, 128, 64, (ctx, cw, ch) => {
    ctx.fillStyle = '#f8f2e0';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#a08c5c';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, cw - 6, ch - 6);
    ctx.fillStyle = '#3a3226';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const px = fitText(ctx, text, cw - 18, 30, 'bold {px}px Georgia, serif');
    ctx.font = `bold ${px}px Georgia, serif`;
    ctx.fillText(text, cw / 2, ch / 2 + 1);
  });
  const l1 = label('DRINK ME', 0.34, 0.17);
  l1.position.set(BX, H + 0.24, 0.315);
  g.add(l1);
  const l2 = label('EAT ME', 0.3, 0.15);
  l2.position.set(KX, H + 0.42, -0.02);
  l2.rotation.x = -0.15;
  g.add(l2);
  // A little flag stick for the cake label.
  const stick = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), standard({ color: WONDER.woodDeep }));
  stick.position.set(KX, H + 0.3, -0.04);
  g.add(stick);
  return g;
}

// A giant fallen pocket watch, leaning against whatever is behind it -- Wonderland
// furniture at landscape scale. The face is one big drawn dial stopped at six
// o'clock: tea time, forever.
export function wonderClock({ seed = 71, radius = 2.1, lean = 0.42 } = {}) {
  const parts = [];
  const ground = [];
  const R = radius;

  // The case is authored FLAT, dial up, crown toward +Z; the whole body group is then
  // tipped -PI/2 + lean, which stands it on its rim facing the viewer with the crown
  // up. The chain links do NOT ride that tilt -- they lie in the grass, in the wrapper.
  put(parts, lathed(closed([
    [R * 0.72, 0.0], [R * 0.97, R * 0.05], [R, R * 0.16], [R * 0.97, R * 0.27], [R * 0.86, R * 0.32], [R * 0.72, R * 0.33],
  ]), { segments: 48 }), WONDER.gold, [0, 0, 0]);
  put(parts, new THREE.CylinderGeometry(R * 0.09, R * 0.1, R * 0.14, 12), WONDER.brass, [0, R * 0.16, R * 1.04], [Math.PI / 2, 0, 0]);
  put(parts, lathed(closed([[0.001, 0], [R * 0.13, 0.001], [R * 0.14, R * 0.05], [R * 0.10, R * 0.09], [0.001, R * 0.1]]), { segments: 12 }), WONDER.gold, [0, R * 0.16, R * 1.10], [-Math.PI / 2, 0, 0]);
  put(parts, new THREE.TorusGeometry(R * 0.16, R * 0.045, 8, 18), WONDER.gold, [0, R * 0.16, R * 1.28], [0, Math.PI / 2, 0]);
  // Chain links running off into the grass.
  const linkAt = (x, z, yaw) => {
    put(ground, new THREE.TorusGeometry(R * 0.12, R * 0.035, 8, 16), WONDER.brass, [x, R * 0.05, z], [Math.PI / 2 - 0.2, yaw, 0]);
  };
  linkAt(R * 0.6, R * 1.35, 0.3);
  linkAt(R * 1.05, R * 1.55, 1.2);
  linkAt(R * 1.55, R * 1.5, 2.1);
  linkAt(R * 2.0, R * 1.35, 2.8);

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.35, metalness: 0.55,
    ...relief('metal', { seed, repeat: 5, strength: 0.3 }),
  })));
  const face = texPlate(R * 1.42, R * 1.42, 384, 384, (ctx, w, h) => {
    ctx.fillStyle = '#f6f0dc';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5c4a2e';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#3a3226';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(w * 0.1)}px Georgia, serif`;
    const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    numerals.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2;
      ctx.fillText(n, w / 2 + Math.sin(a) * w * 0.375, h / 2 - Math.cos(a) * h * 0.375);
    });
    ctx.strokeStyle = '#2c2118';
    ctx.lineCap = 'round';
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2, h / 2 + h * 0.30); // six o'clock
    ctx.stroke();
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2);
    ctx.lineTo(w / 2 + w * 0.22, h / 2 - h * 0.10);
    ctx.stroke();
    ctx.fillStyle = '#c9203a';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
  });
  face.position.set(0, R * 0.335, 0.01);
  face.rotation.x = -Math.PI / 2;
  g.add(face);
  // Stand the watch up on its rim, leaning back, dial toward +Z.
  g.rotation.x = -Math.PI / 2 + lean;
  g.position.set(0, R * Math.cos(lean) * 0.98, -R * 0.1);
  const wrapper = group(g, mesh(mergeParts(ground), standard({
    vertexColors: true, roughness: 0.4, metalness: 0.5,
  })));
  return wrapper;
}

// Drifting dream-sparkles: one Points cloud, one draw call -- the enchanted-forest
// glitter from the reference art, kept faint enough to read as atmosphere.
export function wonderSparkles({ seed = 73, radius = 22, height = 13, count = 130 } = {}) {
  const rng = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tones = [0xffe08a, 0xf0a8d0, 0xa8f0d8, 0xfff6e8, 0xc8b4f8];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    positions[i * 3] = Math.sin(a) * d;
    positions[i * 3 + 1] = 0.4 + Math.pow(rng(), 1.6) * height;
    positions[i * 3 + 2] = Math.cos(a) * d;
    const c = col(tones[Math.floor(rng() * tones.length)]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.16,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  return group(points);
}
