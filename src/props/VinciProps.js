import * as THREE from 'three';
import {
  standard, mesh, group, mergedMesh, relief,
  canvasTexture, signPanel, seededRandom, randomIn,
} from '../PropKit.js';
import {
  solidLoft, grooveAt, sweepProfile, extrudeOutline, revolve,
  solidSurface, chain, spike, dome, ball, tube, gearWheel,
  mergeParts, tintGeometry, weather, smoothNoise3, roundedOutline, lensOutline, put,
} from './LoftKit.js';

// Leonardo da Vinci's studio -- the workshop yard, with the machines built out of the
// notebooks and standing at full size.
//
// The design decision that shapes this world: these machines are mostly VOID. A wing is a
// frame with cloth stretched over part of it; a screw is a helix around a mast; a cart is
// an open gearbox. There is very little solid in any of them, which means two things --
// the `davinci` theme rakes its sun low so every machine throws a long readable shadow,
// and every frame member has to be a real strut with real thickness, because a machine
// drawn in outline reads as scaffolding.
//
// The second decision: NONE of these ever flew. Leonardo's flying machines are wrong --
// human arms cannot generate the power -- and the placards say so. Presenting them as
// working aircraft teaches something false about how engineering actually proceeds, which
// is by being wrong in interesting ways for a long time.
//
// THE REBUILD. Three things drove it, and the first matters most in this world:
//
//  * A GEAR IS ITS TEETH. The cart's gear train was a plain brass disc with 24 boxes stuck
//    round the rim -- so the machine this world calls the first robot, whose entire point
//    is that it is PROGRAMMED by pegs set between gear teeth, had no real teeth at all.
//    `gearWheel` cuts root circle, flanks and tips as ONE closed outline, so a tooth cannot
//    be a separate object from the wheel it grows out of.
//  * LINEN IS NOT A ZERO-THICKNESS PLANE. The ornithopter's membrane and the screw's sail
//    were `PlaneGeometry` rendered DoubleSide: edge-on they vanish, and a wing that
//    disappears when you walk round it is the one thing a flying machine must not do. The
//    screw was 56 separate box planks, which is also why it read as a heap of splinters.
//  * THE MERGING DISCIPLINE HAD LAPSED. This world was 199 draw calls for 63,000 triangles
//    -- the worst ratio in the app -- because the small props each added legs and panels to
//    a Group one mesh at a time. A codex stand was FIVE meshes for 126 triangles.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// WIDENED. The first pass had five colours -- two oaks, a linen, a brass and an iron -- and
// a Renaissance workshop is not a monochrome place. What is added is the range WITHIN
// timber (a workshop uses several woods and they are visibly different), the cordage and
// hide glue that actually hold these machines together, and the pigments on the painter's
// bench. Those pigment names are the real ones a 1490s studio ground for itself, which is
// worth a student knowing: this is where paint came from before there were tubes.
const WOOD = {
  oak: 0x8a6a42, oakDark: 0x6b5031, oakPale: 0xa88a5e,
  walnut: 0x5c452c, ash: 0xc0a172, fir: 0xb99a6a, limewash: 0xd8c9a8,
};
const CLOTH = { linen: 0xd8cbae, linenWarm: 0xc9bb98, linenDark: 0xb2a284, canvas: 0xbfae8a };
const METAL = { brass: 0xb08d4a, brassDark: 0x8a6d38, iron: 0x4a4640, ironBright: 0x6b665e, lead: 0x6e6f72 };
const CORD = { rope: 0xb09a6c, ropeDark: 0x8a7550 };
const PIGMENT = {
  ultramarine: 0x2f4f9e, verdigris: 0x3f8a72, vermilion: 0xb8402c,
  ochre: 0xc9963c, leadWhite: 0xe8e2d2, bone: 0x33302b, madder: 0x9a3f52,
};
const STONE = { wall: 0xb5a68c, wallDark: 0x9c8e76, quoin: 0xc8bba2, tile: 0xa8532e, tileDark: 0x8d4426 };

// A squared timber baulk: an extruded rounded rectangle, which is what a hand-adzed beam
// is. Used everywhere a strut has to read as WORKED wood rather than as a dowel -- a
// Renaissance frame is mortised square stock, and a world built out of cylinders reads as
// scaffolding poles.
function baulk(list, colour, { from, to, w = 0.2, h = null, roll = 0, ease = null }) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const len = a.distanceTo(b);
  if (len < 1e-4) return;
  const geo = extrudeOutline(roundedOutline(w, h ?? w, Math.min(w, h ?? w) * (ease ?? 0.28), 1), len);
  const m = new THREE.Matrix4();
  const dir = b.clone().sub(a).normalize();
  const up = Math.abs(dir.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up),
  );
  if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  list.push({ geometry: geo.applyMatrix4(m), color: colour });
}

// A LASHING. These machines are tied together, not bolted: hide glue and cord round every
// joint is how a 1490s frame is made, and a bare butt joint between two struts is the
// commonest way a timber machine reads as a computer model.
function lashing(list, { at, axis = [0, 0, 1], radius = 0.16, turns = 3, width = 0.05 }) {
  const dir = new THREE.Vector3(...axis).normalize();
  const ref = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const bn = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const nm = new THREE.Vector3().crossVectors(bn, dir).normalize();
  const pts = [];
  const steps = turns * 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * Math.PI * 2 * turns;
    const off = (t - 0.5) * width * turns * 2;
    pts.push([
      at[0] + bn.x * Math.cos(a) * radius + nm.x * Math.sin(a) * radius + dir.x * off,
      at[1] + bn.y * Math.cos(a) * radius + nm.y * Math.sin(a) * radius + dir.y * off,
      at[2] + bn.z * Math.cos(a) * radius + nm.z * Math.sin(a) * radius + dir.z * off,
    ]);
  }
  put(list, tube(pts, pts.map(() => width * 0.5), { sides: 5, tubular: steps }), CORD.rope);
}

// Mirror writing. Leonardo wrote right-to-left in mirror image through all 13,000 surviving
// pages, and it is the single most recognisable thing about the notebooks -- so the page
// texture is drawn as reversed marks rather than as legible text. Drawing real readable
// Italian would be both wrong and a fabrication.
function codexPage({ seed = 5, sketch = 'wing' } = {}) {
  return canvasTexture(512, 384, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#e0d2b0';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(150,120,80,${0.03 + rng() * 0.07})`;
      ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 6, 34), 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = 'rgba(70,48,26,0.85)';
    ctx.fillStyle = 'rgba(70,48,26,0.85)';
    ctx.lineWidth = 2;

    // The sketch, in brown ink, drawn in the top-left as Leonardo laid pages out.
    if (sketch === 'wing') {
      ctx.beginPath();
      ctx.moveTo(60, 120);
      ctx.quadraticCurveTo(150, 60, 260, 96);
      ctx.quadraticCurveTo(200, 130, 60, 120);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        ctx.beginPath(); ctx.moveTo(70 + i * 32, 118); ctx.lineTo(80 + i * 34, 92 + i * 2); ctx.stroke();
      }
    } else if (sketch === 'screw') {
      for (let i = 0; i < 40; i++) {
        const t = i / 39, a = t * Math.PI * 4;
        const x = 160 + Math.cos(a) * 70 * (1 - t * 0.5);
        const y = 180 - t * 110;
        if (i === 0) { ctx.beginPath(); ctx.moveTo(x, y); } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(160, 190); ctx.lineTo(160, 60); ctx.stroke();
    } else {
      // Gear train, and the teeth are drawn as real trapezoids rather than radial ticks --
      // the same point the cart itself now makes in three dimensions.
      for (const [cx, cy, r, n] of [[110, 130, 42, 16], [196, 130, 30, 12], [258, 130, 20, 8]]) {
        ctx.beginPath();
        for (let i = 0; i <= n * 4; i++) {
          const k = i % 4;
          const a = ((i >> 2) + [0.12, 0.22, 0.78, 0.88][k]) * (Math.PI * 2 / n);
          const rr = (k === 1 || k === 2) ? r + 7 : r;
          const x = cx + Math.cos(a) * rr;
          const y = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2); ctx.stroke();
      }
    }

    // Mirror writing: lines of reversed strokes. Each "word" is a run of short marks with
    // the taller ascenders on the RIGHT of the run, which is what makes a block of it read
    // as backwards at a glance rather than merely as scribble.
    for (let line = 0; line < 9; line++) {
      const y = 232 + line * 17;
      let x = w - 44;
      while (x > 40) {
        const wordLen = 3 + Math.floor(rng() * 7);
        for (let i = 0; i < wordLen; i++) {
          const tall = i === wordLen - 1 && rng() > 0.55;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 3, y - (tall ? 11 : 6));
          ctx.stroke();
          x -= 5.4;
        }
        x -= 7;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

// The ornithopter -- the flapping-wing glider from the Codex Atlanticus. BAT-FRAMED, not
// bird-feathered: Leonardo studied bats specifically because a membrane wing is something a
// person could actually build. The pilot lies prone in the middle and works the wings with
// hands and feet through a system of cords.
//
// The membrane is ONE closed solid per wing with a SCALLOPED trailing edge, which is the
// whole silhouette of a bat wing and the thing that says "this was copied from an animal".
// Built as four flat quads between the ribs it read as a rack with tarpaulins on it.
export function ornithopter({ span = 34, seed = 7 } = {}) {
  const g = group();
  const frame = [];
  const skin = [];
  const rng = seededRandom(seed);
  const deckY = 5.2;

  // Trestle it rests on, so it sits at working height rather than on the mud.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      baulk(frame, WOOD.oakDark, {
        from: [side * 2.5, 0, end * 3.4],
        to: [side * 2.2, deckY, end * 3.4],
        w: 0.20, h: 0.20,
      });
    }
    baulk(frame, WOOD.oakDark, {
      from: [side * 2.35, deckY * 0.45, -3.4], to: [side * 2.35, deckY * 0.45, 3.4], w: 0.11, h: 0.16,
    });
  }
  baulk(frame, WOOD.oakDark, { from: [-3, deckY, 0], to: [3, deckY, 0], w: 0.16, h: 0.2 });
  put(frame, extrudeOutline(roundedOutline(2.9, 4.2, 0.3, 2), 0.26), WOOD.oakDark,
    [0, deckY + 0.14, 0], [Math.PI / 2, 0, 0]);

  // Fuselage -- a slim boat-shaped frame the pilot lies IN, not sits across. Lofted, so it
  // is a real hull section rather than a scaled tube.
  put(frame, solidLoft([
    { d: -5.6, w: 0.10, up: 0.14, dn: 0.10, round: 1.4, b: deckY + 1.0 },
    { d: -3.0, w: 0.52, up: 0.55, dn: 0.48, round: 0.7, b: deckY + 1.2 },
    { d: -0.4, w: 0.62, up: 0.62, dn: 0.58, round: 0.62, b: deckY + 1.3 },
    { d: 2.4, w: 0.58, up: 0.58, dn: 0.54, round: 0.66, b: deckY + 1.3 },
    { d: 4.6, w: 0.34, up: 0.36, dn: 0.32, round: 0.9, b: deckY + 1.15 },
    { d: 6.0, w: 0.08, up: 0.10, dn: 0.08, round: 1.4, b: deckY + 1.0 },
  ], { sides: 18, samples: 22 }), WOOD.oak);
  // Longerons down each side of the hull, which is how it is actually built.
  for (const side of [-1, 1]) {
    put(frame, tube([
      [side * 0.14, deckY + 1.05, -5.4], [side * 0.58, deckY + 1.34, -1.0],
      [side * 0.54, deckY + 1.36, 2.2], [side * 0.16, deckY + 1.12, 5.8],
    ], [0.05, 0.08, 0.08, 0.05], { sides: 6 }), WOOD.oakDark);
  }

  // Wings. Each is a leading-edge spar plus four radiating ribs -- the bat's finger bones.
  const SPAN = span * 0.5;
  // The spar's own curve, sampled so the membrane can follow it exactly.
  const spar = (t) => [
    1.0 + t * (SPAN - 1.0),
    deckY + 1.6 + Math.sin(t * 1.5) * 1.9 - t * t * 1.1,
    0.5 - t * 3.7,
  ];
  // Each finger's tip, fanning back and out. The LAST one is the longest, which is what a
  // bat's wing actually does and what makes the trailing edge sweep.
  const finger = (k, t) => {
    const root = [1.2, deckY + 1.5, 1.0];
    const tip = [
      1.0 + (0.30 + k * 0.235) * (SPAN - 1.0),
      deckY + 1.6 + (1.5 - k * 0.22) - Math.pow(0.3 + k * 0.235, 2) * 1.4,
      2.2 + k * 2.5,
    ];
    return [
      root[0] + (tip[0] - root[0]) * t,
      root[1] + (tip[1] - root[1]) * t + Math.sin(t * Math.PI) * 0.5,
      root[2] + (tip[2] - root[2]) * t,
    ];
  };

  for (const side of [-1, 1]) {
    const mir = (p) => [p[0] * side, p[1], p[2]];
    // Leading-edge spar, tapering, in four lashed sections like a real built-up spar.
    const sparNodes = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      sparNodes.push({ p: mir(spar(t)), r: 0.30 - t * 0.20 });
    }
    chain(frame, WOOD.oakDark, sparNodes, { sides: 10, detail: 8 });
    for (let i = 1; i < 4; i++) {
      lashing(frame, { at: mir(spar(i / 4)), axis: [side, 0.3, -0.9], radius: 0.30 - (i / 4) * 0.18, turns: 3, width: 0.045 });
    }

    // Four finger ribs.
    for (let k = 0; k < 4; k++) {
      const nodes = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        nodes.push({ p: mir(finger(k, t)), r: 0.15 - t * 0.09 });
      }
      chain(frame, WOOD.oakDark, nodes, { sides: 8, detail: 7 });
      lashing(frame, { at: mir(finger(k, 0.04)), axis: [side, 0, 0.4], radius: 0.17, turns: 3, width: 0.04 });
    }

    // THE MEMBRANE, as one closed solid spanning spar to fingertips.
    //
    // `u` runs out along the wing and `v` from the leading spar back to the trailing edge.
    // The trailing edge is SCALLOPED between the fingertips, which is the bat's outline;
    // the surface also SAGS between the ribs, because stretched membrane always does and a
    // taut flat panel is what makes cloth read as sheet metal.
    put(skin, solidSurface({
      nu: 30,
      nv: 6,
      point: (u, v) => {
        const lead = spar(Math.min(1, u * 1.02));
        // Which finger pair this station lies between, and how far across.
        const fk = THREE.MathUtils.clamp(u * 3.999, 0, 3.999);
        const k0 = Math.floor(fk);
        const f = fk - k0;
        const a = finger(k0, 1);
        const b = finger(Math.min(3, k0 + 1), 1);
        const trail = [
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
        ];
        // The scallop: the membrane is drawn IN between the fingers, deepest midway.
        const scallop = 1 - Math.sin(f * Math.PI) * 0.22;
        const sag = Math.sin(f * Math.PI) * Math.sin(v * Math.PI) * 0.42;
        const chord = v * scallop;
        return [
          (lead[0] + (trail[0] - lead[0]) * chord) * side,
          lead[1] + (trail[1] - lead[1]) * chord - sag,
          lead[2] + (trail[2] - lead[2]) * chord,
        ];
      },
      thick: () => 0.028,
    }), CLOTH.linen);
  }

  // Tail: a fan membrane on two struts, which is the machine's only control surface.
  baulk(frame, WOOD.oakDark, { from: [-0.4, deckY + 1.2, 5.6], to: [-2.6, deckY + 1.3, 9.0], w: 0.11 });
  baulk(frame, WOOD.oakDark, { from: [0.4, deckY + 1.2, 5.6], to: [2.6, deckY + 1.3, 9.0], w: 0.11 });
  put(skin, solidSurface({
    nu: 10,
    nv: 4,
    point: (u, v) => {
      const x = (-2.6 + u * 5.2) * (0.35 + v * 0.65);
      return [x, deckY + 1.22 + v * 0.1 - Math.sin(u * Math.PI) * 0.16, 5.6 + v * 3.4];
    },
    thick: () => 0.026,
  }), CLOTH.linenWarm);

  // The cord system the pilot works the wings with -- the reason the placard can say he
  // drove it with hands AND feet.
  for (const side of [-1, 1]) {
    put(frame, tube([
      [side * 0.5, deckY + 1.5, 1.4],
      [side * SPAN * 0.34, deckY + 2.5, -0.4],
      [side * SPAN * 0.62, deckY + 2.2, -1.9],
    ], [0.035, 0.03, 0.028], { sides: 4 }), CORD.ropeDark);
  }

  g.add(mesh(
    weather(mergeParts(frame), { amount: 0.1, scale: 0.4, wash: 0.16, low: 0, fade: 8, seed }),
    standard({ vertexColors: true, roughness: 0.88, ...relief('wood', { seed, repeat: 8 }) }),
  ));
  // The linen is its own mesh: it takes a WEAVE relief, and it must not carry the timber's.
  g.add(mesh(
    tintGeometry(mergeParts(skin), (p, c) => {
      // Oiled linen is blotchy and it darkens where it is stretched over a rib.
      const n = 0.9 + smoothNoise3(p.x * 0.5, p.y * 0.5, p.z * 0.5) * 0.2;
      return [c.r * n, c.g * n, c.b * n * 0.98];
    }),
    standard({ vertexColors: true, roughness: 0.95, ...relief('weave', { seed: seed + 3, repeat: 10 }) }),
  ));
  void rng;
  return g;
}

// The aerial screw -- the "helicopter". A linen helix wound round a central mast, meant to
// be spun by four people walking a capstan. It could never have worked: nothing stops the
// whole machine spinning the opposite way, and the crew would have to run faster than any
// human can.
//
// THE SAIL IS ONE HELICOID, not 56 planks.
//
// The old version laid box planks round the mast and had to defeat mergeColored's fixed
// rotateX-then-Y-then-Z order to do it -- the file's own comment records that the first
// attempt "rendered as an exploding heap of splinters". A helicoid is the exact surface a
// screw sail IS: sweep a radial line up a helix. One `solidSurface` call, real thickness, a
// closed rim, and no orientation arithmetic anywhere.
export function aerialScrew({ height = 18, radius = 9, seed = 13 } = {}) {
  const g = group();
  const frame = [];
  const sail = [];
  const turns = 2.2;
  const baseY = 3.4;
  const rise = height - baseY;
  const rInner = radius * 0.14;

  // Platform and the capstan bars the crew push.
  put(frame, revolve([
    [radius * 0.46, 0], [radius * 0.48, 0.35], [radius * 0.44, 0.9], [radius * 0.40, 1.1],
  ], { segments: 26 }), WOOD.oakDark, [0, 0, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    baulk(frame, WOOD.oak, {
      from: [Math.cos(a) * radius * 0.10, 3.1, Math.sin(a) * radius * 0.10],
      to: [Math.cos(a) * radius * 0.95, 3.3, Math.sin(a) * radius * 0.95],
      w: 0.15, h: 0.15,
    });
    // A grip block at the outboard end, so it reads as something a person pushes.
    put(frame, extrudeOutline(roundedOutline(0.22, 0.22, 0.08, 1), 0.9), WOOD.walnut,
      [Math.cos(a) * radius * 0.86, 3.3, Math.sin(a) * radius * 0.86], [Math.PI / 2, -a, 0]);
  }

  // The mast, in three lashed sections with a real taper.
  put(frame, revolve([
    [0.55, 0], [0.5, height * 0.3], [0.42, height * 0.7], [0.34, height], [0.2, height + 0.5],
  ], { segments: 14 }), WOOD.oak, [0, 1.1, 0]);
  for (const t of [0.25, 0.55, 0.85]) {
    lashing(frame, { at: [0, 1.1 + height * t, 0], axis: [0, 1, 0], radius: 0.52 - t * 0.18, turns: 4, width: 0.055 });
  }

  // Radial struts holding the helix out from the mast -- one every eighth of a turn, each
  // a real squared baulk lashed to the mast.
  const strutCount = 18;
  for (let i = 0; i <= strutCount; i++) {
    const t = i / strutCount;
    const a = t * Math.PI * 2 * turns;
    const r = radius * (1 - t * 0.18);
    const y = baseY + t * rise;
    baulk(frame, WOOD.oakDark, {
      from: [Math.cos(a) * rInner, y, Math.sin(a) * rInner],
      to: [Math.cos(a) * r, y + 0.05, Math.sin(a) * r],
      w: 0.10, h: 0.13,
    });
    // A stay from the strut's tip back down to the mast, which is what stops a 9ft
    // cantilever folding -- and it is drawn in the notebook.
    if (i % 2 === 0) {
      put(frame, tube([
        [Math.cos(a) * r * 0.98, y + 0.05, Math.sin(a) * r * 0.98],
        [Math.cos(a) * r * 0.4, y - rise * 0.10, Math.sin(a) * r * 0.4],
        [0, Math.max(1.4, y - rise * 0.18), 0],
      ], [0.035, 0.03, 0.03], { sides: 4 }), CORD.ropeDark);
    }
  }

  // THE SAIL. u runs up the helix, v runs out from the mast.
  put(sail, solidSurface({
    nu: 84,
    nv: 7,
    point: (u, v) => {
      const a = u * Math.PI * 2 * turns;
      const r = rInner + v * (radius * (1 - u * 0.18) - rInner);
      // Linen bellies between its struts: the sail is not a rigid ramp.
      const belly = Math.sin(v * Math.PI) * Math.sin(u * strutCount * Math.PI) * 0.10;
      return [Math.cos(a) * r, baseY + u * rise - belly, Math.sin(a) * r];
    },
    thick: (u, v) => 0.035 * (0.5 + 0.5 * Math.sin(Math.min(1, v * 1.6) * Math.PI * 0.8)),
  }), CLOTH.linen);

  g.add(mesh(
    weather(mergeParts(frame), { amount: 0.1, scale: 0.3, wash: 0.2, low: 0, fade: height, seed }),
    standard({ vertexColors: true, roughness: 0.88, ...relief('wood', { seed, repeat: 8 }) }),
  ));
  g.add(mesh(
    tintGeometry(mergeParts(sail), (p, c) => {
      const n = 0.88 + smoothNoise3(p.x * 0.4, p.y * 0.3, p.z * 0.4) * 0.24;
      return [c.r * n, c.g * n, c.b * n * 0.98];
    }),
    standard({ vertexColors: true, roughness: 0.95, ...relief('weave', { seed: seed + 2, repeat: 14 }) }),
  ));
  return g;
}

// The self-propelled cart -- a spring-driven vehicle, and the one machine here that DOES
// work: a working replica was built in 2004 and it drove. It is often called the first
// robot, because it can be programmed to steer by setting blocks between the gear teeth,
// which is a fair description of a cam.
//
// SO THE GEARS HAVE TO BE REAL. This is the exhibit: a student is told the machine is
// programmed by pegs between the teeth, and the model has to show teeth that a peg could
// sit between. `gearWheel` builds root circle, flanks and tips as one closed outline.
export function selfPropelledCart({ seed = 19 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const deckR = 3.4;
  const deckY = 1.5;

  // The deck, as a real planked disc with a rim, not a cylinder.
  put(parts, revolve([
    [0, 0], [deckR * 0.98, 0], [deckR, 0.1], [deckR, 0.34], [deckR * 0.94, 0.4], [0, 0.4],
  ], { segments: 30 }), WOOD.oak, [0, deckY, 0]);
  for (let i = 0; i < 9; i++) {
    const x = (i / 8 - 0.5) * deckR * 1.85;
    const half = Math.sqrt(Math.max(0, deckR * deckR - x * x)) * 0.98;
    if (half < 0.2) continue;
    put(parts, extrudeOutline(roundedOutline(deckR * 1.85 / 9 * 0.45, 0.05, 0.02, 1), half * 2),
      i % 2 ? WOOD.oak : WOOD.oakPale, [x, deckY + 0.42, 0]);
  }

  // Two great leaf-spring drums under the deck -- the power source, and the reason it moves
  // at all. Each is a lathe with a visible coiled spring inside its open face.
  for (const side of [-1, 1]) {
    put(parts, revolve([
      [0.3, 0], [1.1, 0], [1.15, 0.12], [1.15, 0.58], [1.1, 0.7], [0.3, 0.7], [0.28, 0.35],
    ], { segments: 22 }), METAL.brass, [side * 1.6, deckY - 0.5, 0], [Math.PI / 2, 0, 0]);
    // The coil itself, spiralling in -- what makes it a spring and not a tin.
    const coil = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44;
      const a = t * Math.PI * 2 * 2.6;
      const r = 1.0 - t * 0.62;
      coil.push([side * 1.6 + (t - 0.5) * 0.05, deckY - 0.5 + Math.sin(a) * r, Math.cos(a) * r]);
    }
    put(parts, tube(coil, coil.map(() => 0.05), { sides: 4, tubular: 44 }), METAL.ironBright);
  }

  // Wheels: two large driven at the back, one steerable at the front. Real spoked wheels --
  // a felloe rim, a hub, and spokes that are square stock, not boxes crossing a disc.
  const wheel = (x, z, r, w, spokes) => {
    // Felloe (the rim), as a swept ring of rectangular section.
    const ring = [];
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      ring.push([x, r + Math.sin(a) * 0, z]);
    }
    put(parts, revolve([
      [r - 0.28, -w / 2], [r, -w / 2], [r + 0.04, -w * 0.3], [r + 0.04, w * 0.3], [r, w / 2], [r - 0.28, w / 2],
    ], { segments: 24 }), WOOD.oakDark, [x, r, z], [0, 0, Math.PI / 2]);
    // Iron tyre.
    put(parts, revolve([
      [r + 0.04, -w * 0.34], [r + 0.1, -w * 0.34], [r + 0.1, w * 0.34], [r + 0.04, w * 0.34],
    ], { segments: 24 }), METAL.iron, [x, r, z], [0, 0, Math.PI / 2]);
    // Hub.
    put(parts, revolve([
      [0, -w * 0.8], [0.34, -w * 0.8], [0.42, -w * 0.5], [0.42, w * 0.5], [0.34, w * 0.8], [0, w * 0.8],
    ], { segments: 14 }), WOOD.walnut, [x, r, z], [0, 0, Math.PI / 2]);
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      baulk(parts, WOOD.ash, {
        from: [x, r + Math.sin(a) * 0.36, z + Math.cos(a) * 0.36],
        to: [x, r + Math.sin(a) * (r - 0.24), z + Math.cos(a) * (r - 0.24)],
        w: 0.075, h: 0.075,
      });
    }
    void ring;
  };
  wheel(-2.4, -1.6, 1.5, 0.42, 10);
  wheel(2.4, -1.6, 1.5, 0.42, 10);
  wheel(0, 2.9, 1.0, 0.36, 8);
  // Axles and the steering fork, so the wheels are attached to something.
  put(parts, tube([[-2.4, 1.5, -1.6], [2.4, 1.5, -1.6]], [0.13, 0.13], { sides: 8 }), METAL.iron);
  for (const side of [-1, 1]) {
    baulk(parts, WOOD.oakDark, { from: [side * 0.42, 1.0, 2.9], to: [side * 0.42, 2.1, 2.6], w: 0.1, h: 0.14 });
  }

  // THE GREAT HORIZONTAL GEAR -- the programming surface. Real teeth, a hub and six spokes.
  const bigTeeth = 30;
  const bigR = 2.15;
  {
    const gearGeo = gearWheel(bigR, bigTeeth, 0.3, { hub: 0.42, spokes: 6, spokeWidth: 0.2 });
    gearGeo.rotateX(-Math.PI / 2);
    put(parts, gearGeo, METAL.brass, [0, deckY + 0.55, 0]);
  }
  // The PEGS set between the teeth -- this is the program. A few are in, the rest of the
  // holes are empty, which is what makes it a thing you could change.
  for (let i = 0; i < bigTeeth; i++) {
    const a = (i / bigTeeth) * Math.PI * 2;
    const pr = bigR * 0.72;
    if (i % 5 === 0) {
      put(parts, revolve([
        [0.11, 0], [0.11, 0.7], [0.16, 0.72], [0.16, 0.82], [0, 0.86],
      ], { segments: 8 }), METAL.iron, [Math.cos(a) * pr, deckY + 0.68, Math.sin(a) * pr]);
    } else {
      // The empty peg hole, so the choice is visible.
      put(parts, revolve([[0.13, 0], [0.13, 0.06], [0, 0.06]], { segments: 8 }),
        METAL.brassDark, [Math.cos(a) * pr, deckY + 0.68, Math.sin(a) * pr]);
    }
  }

  // Two smaller gears MESHING with it -- a gear on its own is an ornament; a train is a
  // mechanism, and the meshing is what shows the drive going somewhere.
  for (const [gr, gt, ga, gy] of [[0.95, 13, 0.62, deckY + 0.55], [0.72, 10, -1.9, deckY + 0.55]]) {
    const meshR = bigR + gr - (bigR * 2.1 / bigTeeth) * 1.9 * 0.5;
    const gg = gearWheel(gr, gt, 0.26, { hub: 0.2, spokes: 4, spokeWidth: 0.14 });
    gg.rotateX(-Math.PI / 2);
    put(parts, gg, METAL.brassDark, [Math.cos(ga) * meshR, gy, Math.sin(ga) * meshR]);
    put(parts, revolve([[0.12, 0], [0.12, 1.1], [0.16, 1.16]], { segments: 8 }), METAL.iron,
      [Math.cos(ga) * meshR, deckY + 0.3, Math.sin(ga) * meshR]);
  }

  // The escapement arm, which is what meters the spring out instead of letting it dump all
  // its energy at once -- the actual clever bit of the design.
  baulk(parts, METAL.iron, { from: [0, deckY + 0.95, 1.1], to: [0, deckY + 0.95, 3.1], w: 0.08, h: 0.08 });
  put(parts, extrudeOutline(roundedOutline(0.5, 0.09, 0.04, 1), 0.1), METAL.ironBright,
    [0, deckY + 0.95, 1.2], [0, 0, 0]);
  // A pawl dropping onto the gear's teeth.
  baulk(parts, METAL.ironBright, { from: [0, deckY + 0.95, 2.2], to: [0.42, deckY + 0.62, 1.9], w: 0.06, h: 0.06 });

  return group(mesh(
    weather(mergeParts(parts), { amount: 0.1, scale: 0.5, wash: 0.14, low: 0, fade: 4, seed }),
    standard({ vertexColors: true, roughness: 0.7, metalness: 0.28, ...relief('wood', { seed, repeat: 9 }) }),
  ));
}

// A siege catapult / spring-bow, from the military engineering pages. Leonardo took a
// salary from Ludovico Sforza as a military engineer, and the war machines fill more
// notebook pages than the flying ones -- which is worth a student knowing about how
// Renaissance genius was actually funded.
export function warMachine({ seed = 41 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // Base frame: two long cheeks with cross members, not one slab.
  for (const side of [-1, 1]) {
    baulk(parts, WOOD.oakDark, { from: [side * 2.0, 1.4, -4.4], to: [side * 2.0, 1.4, 4.4], w: 0.26, h: 0.36 });
  }
  for (const z of [-3.6, -1.2, 1.4, 3.8]) {
    baulk(parts, WOOD.oak, { from: [-2.1, 1.4, z], to: [2.1, 1.4, z], w: 0.2, h: 0.26 });
    lashing(parts, { at: [-2.0, 1.4, z], axis: [0, 0, 1], radius: 0.34, turns: 3, width: 0.05 });
    lashing(parts, { at: [2.0, 1.4, z], axis: [0, 0, 1], radius: 0.34, turns: 3, width: 0.05 });
  }

  // Wheels -- spoked, with iron tyres.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * 2.4;
      const z = sz * 3.2;
      const r = 1.35;
      put(parts, revolve([
        [r - 0.3, -0.25], [r, -0.25], [r + 0.05, -0.14], [r + 0.05, 0.14], [r, 0.25], [r - 0.3, 0.25],
      ], { segments: 22 }), WOOD.oakDark, [x, r, z], [0, 0, Math.PI / 2]);
      put(parts, revolve([
        [r + 0.05, -0.16], [r + 0.12, -0.16], [r + 0.12, 0.16], [r + 0.05, 0.16],
      ], { segments: 22 }), METAL.iron, [x, r, z], [0, 0, Math.PI / 2]);
      put(parts, revolve([
        [0, -0.4], [0.32, -0.4], [0.4, -0.24], [0.4, 0.24], [0.32, 0.4], [0, 0.4],
      ], { segments: 12 }), WOOD.walnut, [x, r, z], [0, 0, Math.PI / 2]);
      for (let s = 0; s < 8; s++) {
        const a = (s / 8) * Math.PI * 2;
        baulk(parts, WOOD.ash, {
          from: [x, r + Math.sin(a) * 0.34, z + Math.cos(a) * 0.34],
          to: [x, r + Math.sin(a) * (r - 0.26), z + Math.cos(a) * (r - 0.26)],
          w: 0.07, h: 0.07,
        });
      }
    }
    put(parts, tube([[-2.5, 1.35, sx * 3.2], [2.5, 1.35, sx * 3.2]], [0.12, 0.12], { sides: 8 }), METAL.iron);
  }

  // Two great LAMINATED bow arms -- the springs, and the lamination is the point: a single
  // stave that size would snap, so it is built up from thin leaves glued and bound. Each
  // leaf is its own sweep, which is what makes the bundle read as laminated.
  for (const side of [-1, 1]) {
    for (let leaf = 0; leaf < 3; leaf++) {
      const off = (leaf - 1) * 0.17;
      put(parts, sweepProfile(
        [
          [side * 0.5, 2.6 + off, -3.2],
          [side * 2.1, 3.1 + off, -2.5],
          [side * 3.6, 3.7 + off, -1.4],
          [side * 4.9, 4.3 + off, 0.0],
          [side * 5.7, 4.7 + off, 1.3],
        ],
        lensOutline(0.34, 0.085, 6),
        { samples: 22, twist: () => Math.PI / 2 },
      ), leaf === 1 ? WOOD.ash : WOOD.oakPale);
    }
    // Bindings holding the leaves together.
    for (const t of [0.2, 0.5, 0.8]) {
      const x = side * (0.5 + t * 5.2);
      lashing(parts, {
        at: [x, 2.6 + t * 2.1, -3.2 + t * 4.5],
        axis: [side * 0.9, 0.35, 0.85], radius: 0.42, turns: 4, width: 0.05,
      });
    }
    // The arm's root, socketed into the frame.
    put(parts, revolve([
      [0, 0], [0.52, 0], [0.55, 0.5], [0.44, 0.9], [0, 0.9],
    ], { segments: 12 }), METAL.iron, [side * 0.5, 2.2, -3.2]);
  }

  // Bowstring -- a real cord running tip to tip through a nock, sagging under tension.
  put(parts, tube([
    [-5.7, 4.7, 1.3], [0, 4.2, 2.9], [5.7, 4.7, 1.3],
  ], [0.07, 0.08, 0.07], { sides: 5 }), CORD.rope);

  // Stock and trough.
  baulk(parts, WOOD.oak, { from: [0, 2.5, -3.6], to: [0, 2.9, 4.4], w: 0.42, h: 0.34 });
  for (const side of [-1, 1]) {
    baulk(parts, WOOD.oakDark, { from: [side * 0.34, 2.78, -2.4], to: [side * 0.34, 3.06, 3.6], w: 0.06, h: 0.16 });
  }

  // Windlass: a drum with handspikes, a ratchet wheel and a pawl -- what actually draws the
  // bow, and without it the machine has no way to be loaded.
  put(parts, revolve([
    [0, -1.2], [0.5, -1.2], [0.55, -1.0], [0.55, 1.0], [0.5, 1.2], [0, 1.2],
  ], { segments: 14 }), WOOD.oakDark, [0, 2.95, 4.0], [0, 0, Math.PI / 2]);
  {
    const ratchet = gearWheel(0.78, 14, 0.14, { hub: 0.18, spokes: 0 });
    ratchet.rotateY(Math.PI / 2);
    put(parts, ratchet, METAL.iron, [1.25, 2.95, 4.0]);
    baulk(parts, METAL.ironBright, { from: [1.25, 3.9, 4.5], to: [1.25, 3.1, 4.05], w: 0.06, h: 0.06 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    baulk(parts, WOOD.ash, {
      from: [-1.3, 2.95 + Math.sin(a) * 0.2, 4.0 + Math.cos(a) * 0.2],
      to: [-1.3, 2.95 + Math.sin(a) * 1.5, 4.0 + Math.cos(a) * 1.5],
      w: 0.08, h: 0.08,
    });
  }
  // The drawn rope from the windlass to the string.
  put(parts, tube([[0, 3.5, 3.9], [0, 3.9, 3.3], [0, 4.2, 2.9]], [0.06, 0.06, 0.06], { sides: 5 }), CORD.ropeDark);

  // A stone shot in the trough, and a small pile beside the machine.
  put(parts, ball(0.72, 12), 0x8a8478, [0, 3.35, -1.4]);
  for (let i = 0; i < 5; i++) {
    put(parts, ball(randomIn(rng, 0.5, 0.72), 10), i % 2 ? 0x8a8478 : 0x776f66,
      [randomIn(rng, -4.6, -3.2), randomIn(rng, 0.5, 0.7), randomIn(rng, -4.6, -2.6)]);
  }

  return group(mesh(
    weather(mergeParts(parts), { amount: 0.11, scale: 0.4, wash: 0.2, low: 0, fade: 5, seed }),
    standard({ vertexColors: true, roughness: 0.86, metalness: 0.15, ...relief('wood', { seed, repeat: 8 }) }),
  ));
}

// ---------------------------------------------------------------------------
// Drawings, benches and the yard
// ---------------------------------------------------------------------------

// The Vitruvian Man, on a board. Drawn rather than photographed, for the same reason the
// museum's paintings are: this ships no third-party image files.
export function vitruvianPanel({ size = 9, seed = 23 } = {}) {
  const texture = canvasTexture(640, 640, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#e2d5b6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(150,120,80,${0.03 + rng() * 0.06})`;
      ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 8, 40), 0, Math.PI * 2); ctx.fill();
    }
    const cx = w / 2, cy = h * 0.5, R = w * 0.36;
    ctx.strokeStyle = 'rgba(70,48,26,0.9)';
    ctx.lineWidth = 3;
    // The circle and the square -- the whole argument of the drawing is that a human body
    // fits both, from DIFFERENT centres.
    ctx.beginPath(); ctx.arc(cx, cy + R * 0.12, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(cx - R * 0.9, cy - R * 0.78, R * 1.8, R * 1.8);

    ctx.lineWidth = 2.6;
    const S = R * 0.86;
    ctx.beginPath(); ctx.ellipse(cx, cy - S * 0.72, S * 0.115, S * 0.15, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.17, cy - S * 0.55);
    ctx.lineTo(cx - S * 0.14, cy + S * 0.12);
    ctx.lineTo(cx + S * 0.14, cy + S * 0.12);
    ctx.lineTo(cx + S * 0.17, cy - S * 0.55);
    ctx.closePath(); ctx.stroke();
    for (const [ax, ay] of [[0.92, -0.56], [0.86, -0.2]]) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * S * 0.17, cy - S * 0.5);
        ctx.lineTo(cx + s * S * ax, cy + S * ay);
        ctx.stroke();
      }
    }
    for (const [lx, ly] of [[0.2, 0.9], [0.52, 0.78]]) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * S * 0.1, cy + S * 0.12);
        ctx.lineTo(cx + s * S * lx, cy + S * ly);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(70,48,26,0.7)'; ctx.lineWidth = 1.8;
    for (const y0 of [h * 0.07, h * 0.115, h * 0.9, h * 0.945]) {
      let x = w * 0.86;
      while (x > w * 0.14) {
        ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x - 3, y0 - 6); ctx.stroke();
        x -= 5.2;
      }
    }
  });

  const g = group();
  const parts = [];
  const boardY = size / 2 + 2.2;
  // A moulded frame and three easel legs, ALL MERGED. The first version was five separate
  // meshes for 110 triangles.
  put(parts, extrudeOutline(roundedOutline(size / 2 + 0.35, size / 2 + 0.35, 0.16, 1), 0.4),
    WOOD.oakDark, [0, boardY, 0]);
  for (const side of [-1, 1]) {
    baulk(parts, WOOD.oakDark, {
      from: [side * (size * 0.34), 0, 0.35], to: [side * (size * 0.30), boardY + size * 0.42, 0.1], w: 0.13, h: 0.16,
    });
  }
  baulk(parts, WOOD.oakDark, { from: [0, 0, -1.3], to: [0, boardY + size * 0.36, -0.1], w: 0.13, h: 0.16 });
  baulk(parts, WOOD.oak, { from: [-size * 0.3, boardY - size / 2 - 0.2, 0.28], to: [size * 0.3, boardY - size / 2 - 0.2, 0.28], w: 0.12, h: 0.18 });
  g.add(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.82, ...relief('wood', { seed: seed + 1, repeat: 5 }),
  })));
  const face = signPanel(size, size, texture);
  face.position.set(0, boardY, 0.22);
  g.add(face);
  return g;
}

// A workbench with tools laid out, plus a half-finished machine part in a vice.
export function workbench({ length = 10, seed = 29 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const topY = 3.0;

  // A real joiner's bench: a thick top with a planed edge, splayed legs, stretchers and an
  // apron. The first version was a slab on four square posts.
  put(parts, extrudeOutline(roundedOutline(length / 2, 1.7, 0.09, 1), 0.42), WOOD.oak,
    [0, topY, 0], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      baulk(parts, WOOD.oakDark, {
        from: [sx * (length / 2 - 0.5), 0, sz * 1.5],
        to: [sx * (length / 2 - 0.7), topY - 0.22, sz * 1.3],
        w: 0.22, h: 0.22,
      });
    }
    baulk(parts, WOOD.oakDark, {
      from: [sx * (length / 2 - 0.6), 0.9, -1.4], to: [sx * (length / 2 - 0.6), 0.9, 1.4], w: 0.1, h: 0.14,
    });
  }
  baulk(parts, WOOD.oakDark, { from: [-length / 2 + 0.6, 0.9, 0], to: [length / 2 - 0.6, 0.9, 0], w: 0.1, h: 0.14 });
  baulk(parts, WOOD.oakDark, { from: [-length / 2 + 0.7, topY - 0.5, 1.5], to: [length / 2 - 0.7, topY - 0.5, 1.5], w: 0.09, h: 0.2 });

  // Bench dog holes down the top, which is the detail that says "this is a workbench".
  for (let i = 0; i < 6; i++) {
    put(parts, revolve([[0.075, 0], [0.075, 0.05], [0, 0.05]], { segments: 6 }), WOOD.walnut,
      [-length / 2 + 1.0 + i * ((length - 2) / 5), topY + 0.21, -0.9]);
  }

  // Tools: chisels with real handles and tangs, a saw, dividers, a mallet, a plane.
  for (let i = 0; i < 5; i++) {
    const x = -length / 2 + 1.4 + i * ((length - 3) / 4);
    const z = randomIn(rng, -0.6, 0.6);
    baulk(parts, METAL.ironBright, { from: [x, topY + 0.26, z - 0.7], to: [x, topY + 0.26, z + 0.2], w: 0.05, h: 0.035 });
    put(parts, revolve([
      [0, 0], [0.09, 0.03], [0.13, 0.2], [0.11, 0.6], [0.14, 0.66], [0.1, 0.74], [0, 0.76],
    ], { segments: 8 }), WOOD.walnut, [x, topY + 0.26, z + 0.24], [Math.PI / 2, 0, 0]);
  }
  // Dividers -- the instrument on nearly every page of the notebooks, and a real hinged pair.
  for (const s of [-1, 1]) {
    baulk(parts, METAL.brass, {
      from: [length * 0.28, topY + 0.24, 1.5], to: [length * 0.28 + s * 0.42, topY + 0.24, -0.5], w: 0.045, h: 0.045,
    });
  }
  put(parts, ball(0.1, 8), METAL.brassDark, [length * 0.28, topY + 0.26, 1.5]);
  // Mallet.
  put(parts, extrudeOutline(roundedOutline(0.34, 0.3, 0.1, 1), 0.9), WOOD.walnut,
    [-length * 0.34, topY + 0.5, 0.9], [0, 0, Math.PI / 2]);
  baulk(parts, WOOD.ash, { from: [-length * 0.34, topY + 0.5, 0.9], to: [-length * 0.34 + 1.1, topY + 0.34, 1.1], w: 0.07, h: 0.07 });
  // A wooden try plane.
  put(parts, extrudeOutline(roundedOutline(0.26, 0.24, 0.06, 1), 1.6), WOOD.oakPale,
    [length * 0.06, topY + 0.44, -1.0], [0, Math.PI / 2, 0]);
  baulk(parts, METAL.ironBright, { from: [length * 0.06, topY + 0.62, -1.0], to: [length * 0.06 - 0.16, topY + 0.28, -1.0], w: 0.09, h: 0.03 });

  // A vice at the end holding a half-finished gear -- which ties the bench to the machines.
  put(parts, extrudeOutline(roundedOutline(0.55, 0.42, 0.1, 1), 1.1), METAL.iron,
    [length / 2 - 0.9, topY + 0.5, 0]);
  put(parts, revolve([[0.13, 0], [0.13, 1.5], [0.2, 1.56], [0.2, 1.7]], { segments: 8 }), METAL.brass,
    [length / 2 - 0.9, topY + 0.5, 0]);
  {
    const blank = gearWheel(0.62, 11, 0.16, { hub: 0.14, spokes: 0 });
    blank.rotateY(Math.PI / 2);
    put(parts, blank, WOOD.ash, [length / 2 - 0.9, topY + 1.05, 0]);
  }
  // Shavings and offcuts under the bench, because a workshop is a place of mess.
  for (let i = 0; i < 7; i++) {
    put(parts, extrudeOutline(roundedOutline(randomIn(rng, 0.1, 0.26), 0.035, 0.02, 1), randomIn(rng, 0.3, 0.8)),
      i % 2 ? WOOD.oakPale : WOOD.ash,
      [randomIn(rng, -length * 0.4, length * 0.4), 0.05, randomIn(rng, -1.4, 1.4)],
      [Math.PI / 2, randomIn(rng, 0, 3), randomIn(rng, -0.4, 0.4)]);
  }

  return group(mesh(
    weather(mergeParts(parts), { amount: 0.1, scale: 0.6, wash: 0.14, low: 0, fade: 3.5, seed }),
    standard({ vertexColors: true, roughness: 0.85, metalness: 0.14, ...relief('wood', { seed, repeat: 7 }) }),
  ));
}

// A stack of open codex pages on a stand -- the notebooks themselves, showing the mirror
// writing that is the studio's signature.
export function codexStand({ seed = 31, sketch = 'gears' } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed + 4);
  const legH = 3.2;

  // ALL the joinery in one mesh. This prop was five meshes for 126 triangles, which is the
  // clearest case in the file of the merging discipline having lapsed.
  for (const sx of [-1, 1]) {
    baulk(parts, WOOD.oakDark, { from: [sx * 1.7, 0, 0.5], to: [sx * 1.5, legH, 0.2], w: 0.13, h: 0.13 });
    baulk(parts, WOOD.oakDark, { from: [sx * 1.7, 0, -0.9], to: [sx * 1.5, legH, -0.5], w: 0.13, h: 0.13 });
    baulk(parts, WOOD.oakDark, { from: [sx * 1.6, 1.1, 0.4], to: [sx * 1.6, 1.1, -0.7], w: 0.07, h: 0.1 });
  }
  baulk(parts, WOOD.oakDark, { from: [-1.6, 1.1, -0.15], to: [1.6, 1.1, -0.15], w: 0.07, h: 0.1 });
  // The sloped desk, with a real ledge along its lower edge to stop the pages sliding off.
  put(parts, extrudeOutline(roundedOutline(2.3, 1.6, 0.08, 1), 0.2), WOOD.oak,
    [0, legH + 0.5, 0.1], [-Math.PI / 2 + 0.55, 0, 0]);
  baulk(parts, WOOD.oakDark, { from: [-2.2, legH + 0.06, 1.32], to: [2.2, legH + 0.06, 1.32], w: 0.08, h: 0.11 });

  // Loose sheets under the open page, slightly fanned.
  for (let i = 0; i < 4; i++) {
    put(parts, extrudeOutline(roundedOutline(1.6, 1.15, 0.03, 1), 0.03), CLOTH.linen,
      [randomIn(rng, -0.4, 0.4), legH + 0.42 + i * 0.035, 0.1 + randomIn(rng, -0.3, 0.3)],
      [-Math.PI / 2 + 0.55, 0, randomIn(rng, -0.2, 0.2)]);
  }
  // An inkwell and a quill, because a page with nothing to have written it is odd.
  put(parts, revolve([[0.16, 0], [0.18, 0.16], [0.12, 0.24], [0.13, 0.3]], { segments: 10 }),
    METAL.lead, [1.55, legH + 0.62, -0.75]);
  baulk(parts, CLOTH.linenWarm, { from: [1.55, legH + 0.7, -0.75], to: [1.9, legH + 1.4, -1.15], w: 0.035, h: 0.035 });

  g.add(mesh(
    weather(mergeParts(parts), { amount: 0.1, scale: 0.7, wash: 0.12, low: 0, fade: 3, seed }),
    standard({ vertexColors: true, roughness: 0.84, ...relief('wood', { seed, repeat: 5 }) }),
  ));

  // The open page keeps its own mesh, because it carries the codex texture.
  const page = mesh(
    new THREE.PlaneGeometry(4.2, 3.1),
    standard({ map: codexPage({ seed, sketch }), roughness: 0.95, side: THREE.DoubleSide }),
    0, legH + 0.62, 0.16,
  );
  page.rotation.x = -Math.PI / 2 + 0.55;
  g.add(page);
  return g;
}

// A framed painting in progress on an easel, with a palette. Deliberately UNFINISHED --
// blocked-in underpainting and a drawn cartoon, not a copy of a famous picture. Leonardo
// left most of what he started unfinished, and that is the honest thing to show.
export function easelPainting({ width = 5, height = 7, seed = 37 } = {}) {
  const texture = canvasTexture(448, 640, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#8a7250';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6d7c72';
    ctx.fillRect(0, 0, w, h * 0.42);
    ctx.fillStyle = '#54604f';
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(randomIn(rng, -40, w), h * randomIn(rng, 0.22, 0.4));
      ctx.lineTo(randomIn(rng, 0, w), h * randomIn(rng, 0.1, 0.2));
      ctx.lineTo(randomIn(rng, 0, w + 40), h * randomIn(rng, 0.22, 0.42));
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#7a6448';
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.52, w * 0.15, h * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w * 0.28, h);
    ctx.quadraticCurveTo(w * 0.3, h * 0.66, w * 0.5, h * 0.62);
    ctx.quadraticCurveTo(w * 0.7, h * 0.66, w * 0.72, h);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(240,235,220,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.52, w * 0.15, h * 0.1, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.42, h * 0.62); ctx.lineTo(w * 0.58, h * 0.62); ctx.stroke();
    // Bare panel showing through at the bottom right -- the unfinished corner.
    ctx.fillStyle = '#c9b48c';
    ctx.beginPath(); ctx.moveTo(w, h * 0.72); ctx.lineTo(w, h); ctx.lineTo(w * 0.7, h); ctx.closePath(); ctx.fill();
  });

  const g = group();
  const parts = [];
  const boardY = 4.6;
  for (const side of [-1, 1]) {
    baulk(parts, WOOD.oakDark, {
      from: [side * 1.9, 0, 0.5], to: [side * 1.4, boardY + height * 0.55, 0.2], w: 0.14, h: 0.16,
    });
  }
  baulk(parts, WOOD.oakDark, { from: [0, 0, -1.9], to: [0, boardY + height * 0.45, -0.1], w: 0.14, h: 0.16 });
  // The ledge the panel stands on, plus the peg that sets its height.
  baulk(parts, WOOD.oak, { from: [-1.9, boardY - height / 2, 0.34], to: [1.9, boardY - height / 2, 0.34], w: 0.16, h: 0.13 });
  for (const side of [-1, 1]) {
    put(parts, revolve([[0.06, 0], [0.06, 0.36], [0.09, 0.4]], { segments: 6 }), WOOD.walnut,
      [side * 1.45, boardY - height / 2 + 0.1, 0.34], [Math.PI / 2, 0, 0]);
  }
  // A palette hooked on the leg, with real blobs of ground pigment on it -- the six colours
  // a 1490s studio made for itself, which is worth showing rather than a brown disc.
  {
    const pal = extrudeOutline(roundedOutline(1.05, 0.72, 0.3, 3), 0.1);
    put(parts, pal, WOOD.oakPale, [2.3, 3.2, 0.5], [Math.PI / 2 - 0.3, 0, 0.2]);
    const cols = [PIGMENT.ultramarine, PIGMENT.verdigris, PIGMENT.vermilion,
      PIGMENT.ochre, PIGMENT.leadWhite, PIGMENT.bone, PIGMENT.madder];
    cols.forEach((col, i) => {
      const a = (i / cols.length) * Math.PI * 1.5 - 0.5;
      dome(parts, col, {
        radius: 0.15, height: 0.07,
        at: [2.3 + Math.cos(a) * 0.62, 3.26 + Math.sin(a) * 0.2, 0.5 + Math.sin(a) * 0.5],
        rot: [Math.PI / 2 - 0.3, 0, 0.2], detail: 7, sink: 0.3,
      });
    });
  }
  // Brushes in a jar at the foot.
  put(parts, revolve([[0.24, 0], [0.26, 0.5], [0.22, 0.6]], { segments: 10 }), WOOD.walnut, [-2.4, 0, 0.9]);
  for (let i = 0; i < 4; i++) {
    baulk(parts, WOOD.ash, {
      from: [-2.4, 0.4, 0.9], to: [-2.4 + (i - 1.5) * 0.16, 1.5, 0.9 + (i % 2 ? 0.2 : -0.1)], w: 0.035, h: 0.035,
    });
  }
  g.add(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.82, ...relief('wood', { seed: seed + 1, repeat: 5 }),
  })));

  const panel = mesh(
    new THREE.PlaneGeometry(width, height),
    standard({ map: texture, roughness: 0.92, side: THREE.DoubleSide }),
    0, boardY, 0.42,
  );
  panel.rotation.x = -0.1;
  g.add(panel);
  return g;
}

// The studio building itself -- a Tuscan workshop: stone ground floor, plastered upper,
// pantile roof, and a big open arch so the machines can be wheeled out into the yard.
export function studioBuilding({ width = 34, depth = 24, height = 20, seed = 47 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);
  const wall = 1.2;

  // Three solid walls, coursed as real rubble masonry rather than one box each: irregular
  // block lengths with a half-block offset per course, so the vertical joints never line up.
  const buildWall = (cx, cz, along, len) => {
    let y = 0;
    let course = 0;
    while (y < height - 0.2) {
      const ch = Math.min(randomIn(rng, 0.9, 1.5), height - y);
      let s = -len / 2;
      let first = true;
      while (s < len / 2 - 0.05) {
        let bl = randomIn(rng, 1.4, 3.0);
        if (first && course % 2) bl *= 0.55;
        first = false;
        bl = Math.min(bl, len / 2 - s);
        const tone = [STONE.wall, STONE.wallDark, 0xc0b195][Math.floor(rng() * 3)];
        put(parts, extrudeOutline(
          roundedOutline((bl * 0.97) / 2, (ch * 0.94) / 2, Math.min(bl, ch) * 0.08, 1), wall,
        ), tone,
        along === 'x' ? [cx + s + bl / 2, y + ch / 2, cz] : [cx, y + ch / 2, cz + s + bl / 2],
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

  // Front wall with a big central arch: piers each side, then voussoirs over the opening.
  const openW = width * 0.34;
  const openH = height * 0.5;
  const R = openW / 2;
  for (const side of [-1, 1]) {
    buildWall(side * (openW / 2 + (width - openW) / 4), depth / 2 - wall / 2, 'x', (width - openW) / 2);
  }
  // The spandrel above the arch.
  put(parts, extrudeOutline(
    roundedOutline(width / 2, (height - openH - R) / 2, 0.2, 1), wall,
  ), STONE.wall, [0, openH + R + (height - openH - R) / 2, depth / 2 - wall / 2]);
  // The arch ring. A voussoir only lies flush if the ring is a TRUE circle -- so the rise is
  // exactly the half-span, and the blocks are rotated by (angle - 90 degrees).
  const vous = 15;
  for (let i = 0; i < vous; i++) {
    const a = Math.PI * (i + 0.5) / vous;
    const key = i === (vous - 1) / 2;
    put(parts, extrudeOutline(
      roundedOutline(R * 0.17, (Math.PI * R) / vous * 0.56, R * 0.03, 1), wall * (key ? 1.25 : 1.05),
    ), key ? STONE.quoin : (i % 2 ? 0xa2937c : STONE.wall),
    [Math.cos(a) * R * (key ? 1.19 : 1.14), openH + Math.sin(a) * R * (key ? 1.19 : 1.14), depth / 2 - wall / 2],
    [0, 0, a - Math.PI / 2]);
  }
  // Dressed quoins up the front corners, which is what separates a built wall from a heap.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 13; i++) {
      const y = 0.4 + i * ((height - 1.2) / 13);
      const long = i % 2 === 0;
      put(parts, extrudeOutline(roundedOutline(long ? 1.3 : 0.75, (height - 1.2) / 13 * 0.44, 0.1, 1), 1.5),
        i % 2 ? STONE.quoin : 0xbfb097,
        [sx * (width / 2 - (long ? 1.3 : 0.75) + 0.15), y, depth / 2 - 0.4]);
    }
  }

  // Upper-storey windows with real reveals, sills and shutters hung on hinges.
  for (let i = 0; i < 3; i++) {
    const x = -width * 0.3 + i * width * 0.3;
    const wy = height * 0.74;
    put(parts, extrudeOutline(roundedOutline(1.1, 1.6, 0.1, 1), 0.5), 0x2b2419, [x, wy, depth / 2 - 0.5]);
    put(parts, extrudeOutline(roundedOutline(1.35, 1.85, 0.1, 1), 0.3), STONE.quoin, [x, wy, depth / 2 - 0.05]);
    put(parts, extrudeOutline(roundedOutline(1.55, 0.2, 0.06, 1), 0.7), STONE.quoin, [x, wy - 1.85, depth / 2 + 0.1]);
    for (const side of [-1, 1]) {
      const sh = extrudeOutline(roundedOutline(0.52, 1.6, 0.06, 1), 0.14);
      put(parts, sh, 0x5f6f52,
        [x + side * (1.1 + Math.cos(0.6) * 0.52), wy, depth / 2 + 0.1 + Math.sin(0.6) * 0.52],
        [0, side * -0.6, 0]);
      // Louvre battens, as grooves cut into the shutter rather than boards laid on it.
      for (let b = 0; b < 7; b++) {
        put(parts, extrudeOutline(roundedOutline(0.46, 0.035, 0.01, 1), 0.05), 0x4e5c44,
          [x + side * (1.1 + Math.cos(0.6) * 0.52), wy - 1.3 + b * 0.42, depth / 2 + 0.18 + Math.sin(0.6) * 0.52],
          [0, side * -0.6, 0]);
      }
    }
  }

  g.add(mesh(
    weather(mergeParts(parts), { amount: 0.13, scale: 0.1, wash: 0.3, low: 0, fade: height * 0.8, seed, warm: 0.3 }),
    standard({ vertexColors: true, roughness: 0.93, ...relief('stone', { seed, repeat: 9 }) }),
  ));

  // Roof: overlapping PANTILE rows, and each tile is a real half-round rather than a flat
  // strip -- a pantile roof is the most recognisable thing about a Tuscan building and a
  // stack of boxes reads as corrugated iron.
  //
  // NOT shadow-casting, so the sun can reach a few feet inside the doorway rather than
  // leaving a black hole under the arch.
  const roof = [];
  const rows = 9;
  const eave = height + 0.4;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const z = -depth * 0.57 + (r + 0.5) * ((depth * 1.14) / rows);
    const y = eave + Math.sin(t * Math.PI) * 2.4;
    const tilt = Math.cos(t * Math.PI) * 0.22;
    // The under-course, laid flat.
    put(roof, extrudeOutline(roundedOutline(width * 0.56, 0.12, 0.05, 1), (depth * 1.14) / rows * 0.98),
      r % 2 ? STONE.tile : STONE.tileDark, [0, y, z], [tilt, 0, 0]);
    // The over-tiles: half-round covers along the joints, which is what a pantile roof IS.
    const covers = Math.round(width / 1.5);
    for (let c = 0; c <= covers; c++) {
      const x = -width * 0.56 + c * ((width * 1.12) / covers);
      put(roof, revolve([[0, 0], [0.22, 0], [0.24, 0.06], [0.2, 0.2], [0, 0.2]],
        { segments: 7, start: -Math.PI / 2, sweep: Math.PI }),
      c % 3 === 0 ? 0xbb6238 : STONE.tile, [x, y + 0.1, z], [tilt + Math.PI / 2, 0, 0]);
    }
  }
  // Ridge tiles.
  for (let c = 0; c < Math.round(width / 1.4); c++) {
    const x = -width * 0.55 + c * (width * 1.1 / Math.round(width / 1.4));
    put(roof, revolve([[0, 0], [0.3, 0], [0.32, 0.08], [0.26, 0.26], [0, 0.26]],
      { segments: 8, start: -Math.PI / 2, sweep: Math.PI }),
    c % 2 ? STONE.tile : 0xbb6238, [x, eave + 2.5, -depth * 0.57 + depth * 0.57], [Math.PI / 2, 0, 0]);
  }
  const roofMesh = mesh(
    weather(mergeParts(roof), { amount: 0.14, scale: 0.4, wash: 0.1, low: eave, fade: 3, seed: seed + 2 }),
    standard({ vertexColors: true, roughness: 0.95, ...relief('stone', { seed: seed + 2, repeat: 12 }) }),
  );
  roofMesh.castShadow = false;
  g.add(roofMesh);
  return g;
}
