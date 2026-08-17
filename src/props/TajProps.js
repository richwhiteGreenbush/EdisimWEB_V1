import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

// The Taj Mahal at Agra, from inside the great gate at first light.
//
// SCALE. The mausoleum is 240ft to the top of its finial and its plinth is 300ft square,
// with a garden a thousand feet long in front of it. The building is built here at about
// TAJ = 1/2.4 -- big enough to dominate the sky, small enough that a student can walk all
// the way round it inside a 195ft world. The GARDEN is compressed harder than the
// building, which is a deliberate second compromise: the charbagh's job in this world is
// to frame the view down the canal, and a correctly-scaled one would put the gate outside
// the world bound entirely.
//
// The three things that make this building recognisable, in order:
//
//  1. THE PLAN IS NOT A SQUARE. It is a square with its corners cut off -- an irregular
//     octagon -- and every one of those eight faces carries an arch. Modelled as a cube
//     it becomes a generic domed tomb.
//  2. THE DOME IS AN ONION, on a tall drum, and it bulges WIDER than the drum it stands
//     on before it turns in. A hemisphere reads as a Renaissance church.
//  3. THE FOUR MINARETS LEAN OUTWARD. About two degrees, on purpose, so that in an
//     earthquake they fall away from the tomb rather than onto it.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const MARBLE = 0xf0eade;
const MARBLE_SHADE = 0xdcd5c6;
const MARBLE_DEEP = 0xc4bcaa;
const SANDSTONE = 0xa8503a;
const SANDSTONE_DARK = 0x8e4130;
const RECESS = 0x4a4038;
const BRASS = 0xb9963f;

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

// The pointed Persian arch every opening in this complex uses. Two arcs rising from the
// springing line and meeting in a point -- NOT a semicircle, which is the single change
// that would make the whole building look European.
function pointedArchPath(width, height, spring, Ctor = THREE.Path) {
  const p = new Ctor();
  p.moveTo(-width / 2, 0);
  p.lineTo(-width / 2, spring);
  p.quadraticCurveTo(-width / 2, height * 0.93, 0, height);
  p.quadraticCurveTo(width / 2, height * 0.93, width / 2, spring);
  p.lineTo(width / 2, 0);
  p.closePath();
  return p;
}

// A rectangular panel with a pointed arch cut through it, extruded along Z. This is the
// unit the whole facade is made of: the iwan frames, the flanking niches, the gate.
function archedPanel(width, height, depth, archW, archH, spring) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  shape.holes.push(pointedArchPath(archW, archH, spring));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// The onion dome, as a lathe profile. The bulge is the whole character: the widest point
// is above the springing and WIDER than the drum under it.
function onionProfile(radius, height, steps = 26) {
  // r/h pairs sampled along the real silhouette -- swell, shoulder, neck, point.
  const key = [
    [1.0, 0.0], [1.06, 0.14], [1.05, 0.28], [0.98, 0.42], [0.86, 0.55],
    [0.70, 0.67], [0.53, 0.78], [0.36, 0.87], [0.21, 0.94], [0.09, 0.985], [0.0, 1.0],
  ];
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const span = t * (key.length - 1);
    const k = Math.min(Math.floor(span), key.length - 2);
    const f = span - k;
    pts.push(new THREE.Vector2(
      THREE.MathUtils.lerp(key[k][0], key[k + 1][0], f) * radius,
      THREE.MathUtils.lerp(key[k][1], key[k + 1][1], f) * height,
    ));
  }
  return pts;
}

// A ring of lotus petals -- the collar every Mughal dome sits in.
function lotusCollar(radius, petalH, color, count = 24) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const petal = new THREE.SphereGeometry(radius * 0.16, 8, 6);
    petal.scale(1, petalH / (radius * 0.16) / 2, 0.55);
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * radius * 0.94, 0, Math.sin(a) * radius * 0.94)
      .multiply(new THREE.Matrix4().makeRotationY(-a));
    petal.applyMatrix4(m);
    parts.push({ geometry: petal, color });
  }
  return parts;
}

// The brass finial: stacked discs, a spire and a crescent. It is 30ft of it in reality,
// and it is the only warm colour anywhere on the building.
function finial(scale, color = BRASS) {
  const parts = [];
  parts.push({ geometry: new THREE.SphereGeometry(0.5 * scale, 12, 9), color, position: [0, 0.4 * scale, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.42 * scale, 0.5 * scale, 0.22 * scale, 12), color, position: [0, 0.92 * scale, 0] });
  parts.push({ geometry: new THREE.SphereGeometry(0.34 * scale, 12, 9), color, position: [0, 1.28 * scale, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.26 * scale, 0.3 * scale, 0.18 * scale, 12), color, position: [0, 1.6 * scale, 0] });
  parts.push({ geometry: new THREE.SphereGeometry(0.22 * scale, 12, 9), color, position: [0, 1.85 * scale, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.05 * scale, 0.12 * scale, 1.4 * scale, 8), color, position: [0, 2.65 * scale, 0] });
  // The crescent, tips upward.
  const moon = new THREE.TorusGeometry(0.34 * scale, 0.07 * scale, 6, 16, Math.PI * 1.25);
  parts.push({ geometry: moon, color, position: [0, 3.55 * scale, 0], rotation: [0, Math.PI / 2, Math.PI * 0.38] });
  return parts;
}

// A chattri: the small domed kiosk on eight columns that sits at every roof corner.
function chattriParts(radius, height, color, shade) {
  const parts = [];
  const cols = 8;
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 1.2, radius * 1.28, height * 0.07, 16), color: shade, position: [0, height * 0.035, 0] });
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(radius * 0.09, radius * 0.1, height * 0.42, 8),
      color,
      position: [Math.cos(a) * radius, height * 0.28, Math.sin(a) * radius],
    });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 1.24, radius * 1.16, height * 0.09, 16), color: shade, position: [0, height * 0.535, 0] });
  const dome = new THREE.LatheGeometry(onionProfile(radius * 1.05, height * 0.42, 16), 20);
  parts.push({ geometry: dome, color, position: [0, height * 0.58, 0] });
  parts.push(...lotusCollar(radius * 1.05, height * 0.1, color, 14).map((p) => {
    p.geometry.translate(0, height * 0.59, 0);
    return p;
  }));
  for (const p of finial(radius * 0.34, BRASS)) {
    p.geometry.translate(0, height * 1.0, 0);
    parts.push(p);
  }
  return parts;
}

// Pietra dura: semi-precious stone inlaid into white marble in floral arabesques. Thirty
// or forty different stones, all cut to fit. Drawn rather than modelled, because at any
// scale a student can see it the inlay is a pattern and not a relief.
function inlayTexture(seed = 3, sandstone = false) {
  const rng = seededRandom(seed);
  return canvasTexture(320, 512, (ctx, w, h) => {
    ctx.fillStyle = sandstone ? '#a8503a' : '#f2ece0';
    ctx.fillRect(0, 0, w, h);
    // The calligraphic border, which on the real gate gets WIDER further up so it reads
    // as the same height from the ground.
    ctx.strokeStyle = sandstone ? '#efe7d6' : '#2b2620';
    ctx.lineWidth = 3;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.strokeRect(30, 30, w - 60, h - 60);
    ctx.fillStyle = sandstone ? '#efe7d6' : '#2b2620';
    for (let i = 0; i < 26; i++) {
      const y = 44 + i * ((h - 88) / 26);
      ctx.beginPath();
      ctx.ellipse(23, y, 4, 7, rng() * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const stones = ['#c8423c', '#2f5fa8', '#2e7d52', '#d8a12c', '#6b3fa0', '#c96b8e'];
    // Vines: a stem with paired leaves and a flower, repeated up the panel. Every flower
    // is a different stone, which is what the real inlay does.
    for (let v = 0; v < 5; v++) {
      const cx = 60 + (v % 2) * 96 + rng() * 40;
      let y = h - 70;
      ctx.strokeStyle = '#3d6b3a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, y);
      for (let s = 0; s < 6; s++) {
        ctx.quadraticCurveTo(cx + (s % 2 ? 22 : -22), y - 30, cx, y - 60);
        y -= 60;
      }
      ctx.stroke();
      y = h - 100;
      for (let s = 0; s < 6; s++) {
        ctx.fillStyle = stones[Math.floor(rng() * stones.length)];
        ctx.beginPath();
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          ctx.ellipse(cx + Math.cos(a) * 11, y + Math.sin(a) * 11, 7, 5, a, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.fillStyle = '#d8a12c';
        ctx.beginPath();
        ctx.arc(cx, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#3d6b3a';
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + side * 24, y + 18, 12, 5, side * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        y -= 60;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The mausoleum
// ---------------------------------------------------------------------------

export function tajMahal({ width = 75, height = 100, seed = 5 } = {}) {
  const g = group();
  const parts = [];
  const glow = [];

  // The plinth is a TERRACE, not a step. The real one is 22ft high and 300ft square, and
  // it is most of why the building has the poise it does -- set on a 6ft kerb, as this was
  // at first, the tomb looks like it is sitting on the lawn.
  const plinthH = height * 0.115;
  const bodyH = height * 0.36;
  const drumH = height * 0.14;
  const domeH = height * 0.34;
  const chamfer = width * 0.28; // the cut corner, as a fraction of the side

  // --- The plinth ---------------------------------------------------------
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.28, plinthH, width * 1.28), color: MARBLE_SHADE, position: [0, plinthH / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.32, plinthH * 0.18, width * 1.32), color: MARBLE, position: [0, plinthH * 0.91, 0] });

  // --- The body: an irregular octagon ------------------------------------
  // Four long faces with a great iwan in each, and four short chamfered faces. Built as
  // eight separate wall panels rather than one prism, because every face carries an arch
  // and an arch has to be cut through a flat panel.
  const half = width / 2;
  const c = chamfer / 2;
  // Face centres and outward yaws, going round: long, short, long, short...
  const faces = [];
  for (let q = 0; q < 4; q++) {
    const yaw = (q * Math.PI) / 2;
    faces.push({ yaw, long: true, out: half, span: width - chamfer });
    faces.push({ yaw: yaw + Math.PI / 4, long: false, out: Math.hypot(half, half) - c * 0.71, span: chamfer * 1.06 });
  }

  for (const f of faces) {
    const x = Math.sin(f.yaw) * f.out;
    const z = Math.cos(f.yaw) * f.out;
    const frame = new THREE.Matrix4()
      .makeTranslation(x, plinthH, z)
      .multiply(new THREE.Matrix4().makeRotationY(f.yaw));

    if (f.long) {
      // The great iwan: a deep pointed recess nearly the full height of the block, inside
      // a raised rectangular frame (a pishtaq). The frame projecting proud of the wall is
      // what gives the building its shadow and its depth.
      const iwanW = f.span * 0.46;
      const iwanH = bodyH * 0.82;
      const pish = archedPanel(f.span * 0.58, bodyH * 0.98, width * 0.06, iwanW, iwanH, iwanH * 0.52);
      pish.applyMatrix4(frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, width * 0.03)));
      parts.push({ geometry: pish, color: MARBLE });
      // The recess behind it, dark. A pointed opening with nothing behind it reads as a
      // hole cut in cardboard.
      const back = new THREE.BoxGeometry(iwanW * 1.05, iwanH, width * 0.11);
      back.applyMatrix4(frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, iwanH / 2, -width * 0.03)));
      parts.push({ geometry: back, color: RECESS });
      // The flat wall either side of the pishtaq, with two storeys of small niches.
      const sideW = (f.span - f.span * 0.58) / 2;
      for (const side of [-1, 1]) {
        for (let lv = 0; lv < 2; lv++) {
          const nh = bodyH * 0.4;
          const panel = archedPanel(sideW, nh, width * 0.03, sideW * 0.5, nh * 0.78, nh * 0.42);
          panel.applyMatrix4(frame.clone().multiply(
            new THREE.Matrix4().makeTranslation(side * (f.span * 0.29 + sideW / 2), lv * bodyH * 0.47, 0),
          ));
          parts.push({ geometry: panel, color: MARBLE_SHADE });
          const rec = new THREE.BoxGeometry(sideW * 0.52, nh * 0.78, width * 0.02);
          rec.applyMatrix4(frame.clone().multiply(
            new THREE.Matrix4().makeTranslation(side * (f.span * 0.29 + sideW / 2), lv * bodyH * 0.47 + nh * 0.39, -width * 0.015),
          ));
          parts.push({ geometry: rec, color: RECESS });
        }
      }
    } else {
      // The chamfered corners: two storeys of arches, no pishtaq.
      for (let lv = 0; lv < 2; lv++) {
        const nh = bodyH * 0.47;
        const panel = archedPanel(f.span, nh, width * 0.05, f.span * 0.48, nh * 0.8, nh * 0.44);
        panel.applyMatrix4(frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, lv * bodyH * 0.5, 0)));
        parts.push({ geometry: panel, color: MARBLE });
        const rec = new THREE.BoxGeometry(f.span * 0.5, nh * 0.8, width * 0.04);
        rec.applyMatrix4(frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(0, lv * bodyH * 0.5 + nh * 0.4, -width * 0.02),
        ));
        parts.push({ geometry: rec, color: RECESS });
      }
    }
  }

  // The solid core behind all eight faces -- an octagonal prism. Without it the building
  // is a shell of loose panels and you can see straight through the gaps at the corners.
  const core = new THREE.CylinderGeometry(half * 1.02, half * 1.02, bodyH, 8);
  core.rotateY(Math.PI / 8);
  parts.push({ geometry: core, color: MARBLE_SHADE, position: [0, plinthH + bodyH / 2, 0] });

  // Parapet and cornice over the body.
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.04, height * 0.018, width * 1.04), color: MARBLE, position: [0, plinthH + bodyH, 0] });
  const para = new THREE.CylinderGeometry(half * 1.06, half * 1.06, height * 0.035, 8);
  para.rotateY(Math.PI / 8);
  parts.push({ geometry: para, color: MARBLE_SHADE, position: [0, plinthH + bodyH + height * 0.026, 0] });

  const roof = plinthH + bodyH + height * 0.044;

  // --- The drum and the dome ---------------------------------------------
  const drumR = width * 0.29;
  parts.push({ geometry: new THREE.CylinderGeometry(drumR, drumR * 1.04, drumH, 32), color: MARBLE, position: [0, roof + drumH / 2, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(drumR * 1.05, drumR * 1.05, height * 0.02, 32), color: MARBLE_SHADE, position: [0, roof + drumH, 0] });
  parts.push(...lotusCollar(drumR * 1.02, height * 0.05, MARBLE_SHADE, 28).map((p) => {
    p.geometry.translate(0, roof + drumH + height * 0.03, 0);
    return p;
  }));

  const dome = new THREE.LatheGeometry(onionProfile(drumR * 1.09, domeH, 30), 48);
  parts.push({ geometry: dome, color: MARBLE, position: [0, roof + drumH + height * 0.015, 0] });
  for (const p of finial(width * 0.055)) {
    p.geometry.translate(0, roof + drumH + domeH + height * 0.01, 0);
    parts.push(p);
  }

  // --- Chattris and guldastas --------------------------------------------
  // Four kiosks at the roof corners. They are what stops the dome floating: without them
  // the silhouette jumps straight from a flat parapet to a 34ft onion.
  const chR = width * 0.11;
  const chH = height * 0.19;
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const d = half * 0.72;
    for (const p of chattriParts(chR, chH, MARBLE, MARBLE_SHADE)) {
      p.geometry.translate(Math.cos(a) * d, roof, Math.sin(a) * d);
      parts.push(p);
    }
  }
  // Guldastas: thin spires standing on the parapet at the corners of each pishtaq.
  for (let i = 0; i < 4; i++) {
    const yaw = (i * Math.PI) / 2;
    for (const side of [-1, 1]) {
      const x = Math.sin(yaw) * half * 1.0 + Math.cos(yaw) * side * (width - chamfer) * 0.31;
      const z = Math.cos(yaw) * half * 1.0 - Math.sin(yaw) * side * (width - chamfer) * 0.31;
      parts.push({ geometry: new THREE.CylinderGeometry(width * 0.02, width * 0.026, height * 0.09, 10), color: MARBLE, position: [x, roof + height * 0.045, z] });
      const cap = new THREE.LatheGeometry(onionProfile(width * 0.028, height * 0.05, 12), 12);
      parts.push({ geometry: cap, color: MARBLE, position: [x, roof + height * 0.09, z] });
      for (const p of finial(width * 0.014)) {
        p.geometry.translate(x, roof + height * 0.14, z);
        parts.push(p);
      }
    }
  }

  g.add(mergedMesh(parts, { roughness: 0.55, ...relief('stone', { seed, repeat: 4 }) }));

  // The inlay, on the four pishtaq spandrels. A separate mesh because it is the one thing
  // here carrying a real colour map, and a map multiplied by a vertex colour would mud it.
  const tex = inlayTexture(seed);
  for (let i = 0; i < 4; i++) {
    const yaw = (i * Math.PI) / 2;
    for (const side of [-1, 1]) {
      const panel = mesh(
        new THREE.PlaneGeometry((width - chamfer) * 0.09, bodyH * 0.5),
        standard({ map: tex, roughness: 0.5 }),
      );
      panel.position.set(
        Math.sin(yaw) * (half + width * 0.062) + Math.cos(yaw) * side * (width - chamfer) * 0.245,
        plinthH + bodyH * 0.62,
        Math.cos(yaw) * (half + width * 0.062) - Math.sin(yaw) * side * (width - chamfer) * 0.245,
      );
      panel.rotation.y = yaw;
      g.add(panel);
    }
  }
  return g;
}

// One minaret. Separate from the mausoleum so a student can click and program it on its
// own -- and because there are four, and one builder placed four times is a quarter of
// the geometry of one that draws them all.
//
// `lean` is the outward tilt in degrees. It is real, it is deliberate, and it is the
// answer to the only question anyone asks about these towers.
export function tajMinaret({ height = 57, lean = 2, stages = 3, seed = 7 } = {}) {
  const g = group();
  const parts = [];
  const baseR = height * 0.055;

  parts.push({ geometry: new THREE.CylinderGeometry(baseR * 1.5, baseR * 1.62, height * 0.06, 16), color: MARBLE_SHADE, position: [0, height * 0.03, 0] });
  const stageH = (height * 0.78) / stages;
  for (let s = 0; s < stages; s++) {
    const y = height * 0.06 + s * stageH;
    const r0 = baseR * (1 - s * 0.09);
    const r1 = baseR * (1 - (s + 1) * 0.09);
    parts.push({ geometry: new THREE.CylinderGeometry(r1, r0, stageH * 0.9, 20), color: MARBLE, position: [0, y + stageH * 0.45, 0] });
    // The balcony ring at the top of each stage -- the tower's only horizontal, and what
    // makes it read as a minaret rather than as a chimney.
    parts.push({ geometry: new THREE.CylinderGeometry(r1 * 1.55, r1 * 1.5, stageH * 0.05, 20), color: MARBLE_SHADE, position: [0, y + stageH * 0.92, 0] });
    parts.push({ geometry: new THREE.CylinderGeometry(r1 * 1.52, r1 * 1.52, stageH * 0.07, 20, 1, true), color: MARBLE, position: [0, y + stageH * 0.97, 0] });
    // Balusters round the rail.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      parts.push({
        geometry: new THREE.CylinderGeometry(r1 * 0.06, r1 * 0.06, stageH * 0.08, 6),
        color: MARBLE,
        position: [Math.cos(a) * r1 * 1.5, y + stageH * 0.985, Math.sin(a) * r1 * 1.5],
      });
    }
  }
  // Crowning chattri.
  const top = height * 0.84;
  const chR = baseR * 1.25;
  for (const p of chattriParts(chR, height * 0.18, MARBLE, MARBLE_SHADE)) {
    p.geometry.translate(0, top, 0);
    parts.push(p);
  }

  const m = mergedMesh(parts, { roughness: 0.55, ...relief('stone', { seed, repeat: 5 }) });
  // The lean goes on the GROUP, not baked into the geometry: it must tilt away from the
  // tomb, so the layout supplies the direction by rotating the whole prop about Y and this
  // tips it consistently about its own local X.
  m.rotation.x = THREE.MathUtils.degToRad(lean);
  g.add(m);
  return g;
}

// The Darwaza-i rauza -- the great gate. Red sandstone with white marble inlay, and a row
// of eleven small domes along the top for each year it took to build the thing.
//
// It exists to frame the first view: you see nothing of the Taj until you step through it,
// and then you see all of it at once, which is the entire design of the complex.
export function tajGateway({ width = 62, height = 46, depth = 20, seed = 11 } = {}) {
  const g = group();
  const parts = [];

  const bodyH = height * 0.72;
  parts.push({ geometry: new THREE.BoxGeometry(width, bodyH, depth), color: SANDSTONE, position: [0, bodyH / 2, 0] });

  // The great arch, cut clean through so a student can actually walk under it.
  const archW = width * 0.28;
  const archH = bodyH * 0.72;
  for (const side of [1, -1]) {
    const face = archedPanel(width * 0.44, bodyH * 0.94, depth * 0.1, archW, archH, archH * 0.5);
    face.translate(0, 0, side * depth * 0.47);
    parts.push({ geometry: face, color: SANDSTONE_DARK });
  }
  // The passage itself: two side walls and a ceiling, leaving the arch open end to end.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry((width - archW) / 2, bodyH, depth),
      color: SANDSTONE,
      position: [side * (archW + (width - archW) / 2) / 2, bodyH / 2, 0],
    });
  }
  parts.push({ geometry: new THREE.BoxGeometry(archW, bodyH - archH, depth), color: SANDSTONE, position: [0, archH + (bodyH - archH) / 2, 0] });

  // Flanking niches, two storeys, either side of the pishtaq.
  for (const side of [-1, 1]) {
    for (let lv = 0; lv < 2; lv++) {
      const nh = bodyH * 0.42;
      const panel = archedPanel(width * 0.13, nh, depth * 0.06, width * 0.07, nh * 0.76, nh * 0.4);
      panel.translate(side * width * 0.34, lv * bodyH * 0.48, depth * 0.5);
      parts.push({ geometry: panel, color: SANDSTONE_DARK });
      parts.push({ geometry: new THREE.BoxGeometry(width * 0.072, nh * 0.76, depth * 0.05), color: RECESS, position: [side * width * 0.34, lv * bodyH * 0.48 + nh * 0.38, depth * 0.47] });
    }
  }

  // The white marble frame round the pishtaq, and the parapet.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.46, height * 0.02, depth * 1.02), color: MARBLE, position: [0, bodyH * 0.96, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.03, height * 0.035, depth * 1.03), color: MARBLE_SHADE, position: [0, bodyH + height * 0.017, 0] });

  // Eleven chattris along the roofline -- the count is the thing.
  const roof = bodyH + height * 0.035;
  for (let i = 0; i < 11; i++) {
    const x = (i - 5) * (width / 11.6);
    const r = width * 0.032;
    for (const p of chattriParts(r, height * 0.15, MARBLE, MARBLE_SHADE)) {
      p.geometry.translate(x, roof, depth * (i % 2 ? 0.16 : -0.16));
      parts.push(p);
    }
  }
  // Corner turrets, taller than the kiosks between them.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geometry: new THREE.CylinderGeometry(width * 0.028, width * 0.034, height * 0.13, 12), color: SANDSTONE, position: [sx * width * 0.47, roof + height * 0.065, sz * depth * 0.44] });
      for (const p of chattriParts(width * 0.042, height * 0.14, MARBLE, MARBLE_SHADE)) {
        p.geometry.translate(sx * width * 0.47, roof + height * 0.13, sz * depth * 0.44);
        parts.push(p);
      }
    }
  }

  g.add(mergedMesh(parts, { roughness: 0.8, ...relief('stone', { seed, repeat: 5 }) }));

  // Calligraphy bands framing the great arch, on the garden side.
  const tex = inlayTexture(seed + 2, true);
  for (const side of [-1, 1]) {
    const band = mesh(new THREE.PlaneGeometry(width * 0.05, bodyH * 0.9), standard({ map: tex, roughness: 0.75 }));
    band.position.set(side * width * 0.245, bodyH * 0.47, depth * 0.51);
    g.add(band);
  }
  return g;
}

// The mosque on the west side of the platform, and its mirror image -- the jawab, the
// "answer" -- on the east. The jawab is not a mosque and never was: it exists solely so
// the composition is symmetrical, which tells you what mattered most here.
export function tajMosque({ width = 46, depth = 22, height = 26, seed = 13 } = {}) {
  const g = group();
  const parts = [];
  const bodyH = height * 0.56;

  parts.push({ geometry: new THREE.BoxGeometry(width * 1.06, height * 0.05, depth * 1.1), color: SANDSTONE_DARK, position: [0, height * 0.025, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width, bodyH, depth), color: SANDSTONE, position: [0, height * 0.05 + bodyH / 2, 0] });

  // A central pishtaq with two smaller arches either side.
  const cW = width * 0.3;
  const cH = bodyH * 0.94;
  const centre = archedPanel(cW, cH, depth * 0.08, cW * 0.5, cH * 0.76, cH * 0.44);
  centre.translate(0, height * 0.05, depth * 0.5);
  parts.push({ geometry: centre, color: SANDSTONE_DARK });
  parts.push({ geometry: new THREE.BoxGeometry(cW * 0.52, cH * 0.76, depth * 0.1), color: RECESS, position: [0, height * 0.05 + cH * 0.38, depth * 0.45] });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const aw = width * 0.155;
      const ah = bodyH * 0.66;
      const p = archedPanel(aw, ah, depth * 0.06, aw * 0.52, ah * 0.78, ah * 0.42);
      p.translate(side * (cW / 2 + aw * (i + 0.5)), height * 0.05, depth * 0.5);
      parts.push({ geometry: p, color: SANDSTONE });
      parts.push({ geometry: new THREE.BoxGeometry(aw * 0.54, ah * 0.78, depth * 0.05), color: RECESS, position: [side * (cW / 2 + aw * (i + 0.5)), height * 0.05 + ah * 0.39, depth * 0.46] });
    }
  }

  parts.push({ geometry: new THREE.BoxGeometry(width * 1.03, height * 0.03, depth * 1.03), color: MARBLE_SHADE, position: [0, height * 0.05 + bodyH, 0] });
  const roof = height * 0.08 + bodyH;

  // Three white domes over the prayer hall.
  for (const dx of [-width * 0.26, 0, width * 0.26]) {
    const r = dx === 0 ? width * 0.11 : width * 0.085;
    const dh = dx === 0 ? height * 0.3 : height * 0.23;
    parts.push({ geometry: new THREE.CylinderGeometry(r * 1.02, r * 1.06, height * 0.06, 24), color: MARBLE_SHADE, position: [dx, roof + height * 0.03, 0] });
    parts.push({ geometry: new THREE.LatheGeometry(onionProfile(r * 1.08, dh, 22), 30), color: MARBLE, position: [dx, roof + height * 0.06, 0] });
    for (const p of finial(r * 0.28)) {
      p.geometry.translate(dx, roof + height * 0.06 + dh, 0);
      parts.push(p);
    }
  }
  // Corner minarets, short ones.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geometry: new THREE.CylinderGeometry(width * 0.022, width * 0.028, height * 0.72, 12), color: SANDSTONE, position: [sx * width * 0.48, height * 0.05 + height * 0.36, sz * depth * 0.47] });
      for (const p of chattriParts(width * 0.036, height * 0.16, MARBLE, MARBLE_SHADE)) {
        p.geometry.translate(sx * width * 0.48, height * 0.05 + height * 0.72, sz * depth * 0.47);
        parts.push(p);
      }
    }
  }

  g.add(mergedMesh(parts, { roughness: 0.8, ...relief('stone', { seed, repeat: 4 }) }));
  return g;
}

// A run of the charbagh's central watercourse: raised marble kerbs, a dark still channel,
// and a line of fountain jets down the middle.
//
// The water is the point of the whole garden. A charbagh is four quarters divided by
// channels -- the paradise garden of the Quran, with its four rivers -- and the canal in
// front of the Taj exists so the building is delivered twice, once in stone and once
// upside down in the water.
export function charbaghCanal({ length = 60, width = 9, jets = 4, seed = 17 } = {}) {
  const g = group();
  const parts = [];
  const kerb = width * 0.22;

  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(kerb, 1.1, length), color: MARBLE, position: [side * (width / 2 - kerb / 2), 0.55, 0] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width - kerb * 2, 0.5, length), color: MARBLE_DEEP, position: [0, 0.25, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width + kerb * 2, 0.4, length + kerb * 2), color: 0xb8ad98, position: [0, 0.2, 0] });
  g.add(mergedMesh(parts, { roughness: 0.7, ...relief('stone', { seed, repeat: 6 }) }));

  // The water. Nearly flat and dark: still water in shade reflects the sky, so it reads as
  // a mirror only when it is DARKER than the sky, not when it is painted sky-coloured.
  const water = mesh(
    new THREE.PlaneGeometry(width - kerb * 2.2, length - 0.4),
    standard({ color: 0x2c4c5c, roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.92 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.52;
  water.castShadow = false;
  g.add(water);

  // Jets. Small, and lit -- these are the only moving thing in the garden.
  const jetParts = [];
  for (let i = 0; i < jets; i++) {
    const z = -length / 2 + ((i + 0.5) / jets) * length;
    jetParts.push({ geometry: new THREE.CylinderGeometry(0.16, 0.2, 0.5, 10), color: 0xd8d0be, position: [0, 0.7, z] });
    jetParts.push({ geometry: new THREE.ConeGeometry(0.09, 2.0, 8), color: 0xcfe8f2, position: [0, 1.9, z] });
  }
  const jetMesh = mergedMesh(jetParts, { roughness: 0.25, emissive: 0x6b8fa0, emissiveIntensity: 0.35 });
  jetMesh.castShadow = false;
  g.add(jetMesh);
  return g;
}

// The garden's cypresses, in the rows a formal Persian garden plants them in. Dark,
// narrow, and evenly spaced -- they are architecture here, not planting.
export function gardenCypress({ height = 20, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.015, height * 0.028, height * 0.16, 9), color: 0x5f4c39, position: [0, height * 0.08, 0] });
  const layers = 10;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = height * 0.075 * Math.sin(Math.PI * (0.2 + t * 0.76)) ** 0.65;
    const blob = new THREE.SphereGeometry(r, 10, 8);
    blob.scale(1, 1.6, 1);
    parts.push({
      geometry: blob,
      color: [0x27401f, 0x2f4a26, 0x1f3419][i % 3],
      position: [randomIn(rng, -0.2, 0.2), height * (0.14 + t * 0.8), randomIn(rng, -0.2, 0.2)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.95 }));
}

// A jali -- a marble screen pierced with a lattice, cut from a single slab. The one round
// the cenotaphs took ten years on its own.
export function marbleScreen({ width = 8, height = 9, seed = 23 } = {}) {
  const g = group();
  const parts = [];
  const frame = width * 0.09;
  parts.push({ geometry: new THREE.BoxGeometry(width, frame, 0.7), color: MARBLE, position: [0, frame / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width, frame, 0.7), color: MARBLE, position: [0, height - frame / 2, 0] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(frame, height, 0.7), color: MARBLE, position: [side * (width / 2 - frame / 2), height / 2, 0] });
  }
  // The lattice: a diagonal grid, which is what the real screens are cut in. Two crossing
  // families of thin bars, so the openings are diamonds rather than squares.
  const inner = width - frame * 2;
  const innerH = height - frame * 2;
  const diag = Math.hypot(inner, innerH);
  const step = width * 0.13;
  for (const dir of [1, -1]) {
    const n = Math.ceil(diag / step);
    for (let i = -n; i <= n; i++) {
      const bar = new THREE.BoxGeometry(0.16, diag * 1.2, 0.36);
      bar.rotateZ(dir * Math.PI / 4);
      bar.translate(i * step * 1.414 * 0.5 * dir + (dir > 0 ? 0 : 0), height / 2, 0);
      // Clip by simply skipping bars whose centre falls outside the opening.
      if (Math.abs(i * step * 0.707) > inner / 2 + innerH / 2) continue;
      parts.push({ geometry: bar, color: MARBLE_SHADE });
    }
  }
  // A solid backing plane would defeat the point; instead the frame is deeper than the
  // lattice so the screen still reads as a slab.
  g.add(mergedMesh(parts, { roughness: 0.5, ...relief('stone', { seed, repeat: 3 }) }));
  return g;
}

// A cenotaph -- the marble box in the chamber under the dome. Both of the ones inside are
// EMPTY: the actual graves are in a plain crypt below, unmarked and unvisitable.
export function cenotaph({ length = 8, width = 4, height = 4, ornate = true, seed = 29 } = {}) {
  const parts = [];
  parts.push({ geometry: new THREE.BoxGeometry(length * 1.2, height * 0.16, width * 1.4), color: MARBLE_SHADE, position: [0, height * 0.08, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(length, height * 0.62, width), color: MARBLE, position: [0, height * 0.47, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(length * 1.05, height * 0.08, width * 1.08), color: MARBLE_SHADE, position: [0, height * 0.82, 0] });
  if (ornate) {
    // The pen box on top marks a man; a writing tablet marks a woman. Shah Jahan's is the
    // one with the box, and it is also the only thing in the entire building that is not
    // symmetrical -- it was added later, off-centre, beside his wife's.
    parts.push({ geometry: new THREE.BoxGeometry(length * 0.3, height * 0.14, width * 0.2), color: MARBLE, position: [0, height * 0.93, 0] });
  } else {
    parts.push({ geometry: new THREE.BoxGeometry(length * 0.42, height * 0.05, width * 0.3), color: MARBLE, position: [0, height * 0.89, 0] });
  }
  return group(mergedMesh(parts, { roughness: 0.45, ...relief('stone', { seed, repeat: 3 }) }));
}
