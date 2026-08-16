import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

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
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const OAK = 0x8a6a42;
const OAK_DARK = 0x6b5031;
const LINEN = 0xd8cbae;
const BRASS = 0xb08d4a;
const IRON = 0x4a4640;

// Mirror writing. Leonardo wrote right-to-left in mirror image through all 13,000
// surviving pages, and it is the single most recognisable thing about the notebooks --
// so the page texture is drawn as reversed marks rather than as legible text. Drawing
// real readable Italian would be both wrong and a fabrication.
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
        i === 0 ? (ctx.beginPath(), ctx.moveTo(x, y)) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(160, 190); ctx.lineTo(160, 60); ctx.stroke();
    } else {
      // Gear train.
      for (const [cx, cy, r] of [[110, 130, 42], [196, 130, 30], [258, 130, 20]]) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.lineTo(cx + Math.cos(a) * (r + 7), cy + Math.sin(a) * (r + 7));
          ctx.stroke();
        }
      }
    }

    // Mirror writing: lines of reversed strokes. Each "word" is a run of short marks with
    // the taller ascenders on the RIGHT of the run, which is what makes a block of it
    // read as backwards at a glance rather than merely as scribble.
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

// The ornithopter -- the flapping-wing glider from the Codex Atlanticus. Bat-framed, not
// bird-feathered: Leonardo studied bats specifically because a membrane wing is something
// a person could actually build. The pilot lies prone in the middle and works the wings
// with hands and feet through a system of cords.
export function ornithopter({ span = 34, seed = 7 } = {}) {
  const g = group();
  const parts = [];
  const membrane = [];
  const deckY = 5.2;

  // Trestle it rests on, so it sits at working height rather than on the mud.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.2, 0.26, deckY, 8),
        color: OAK_DARK,
        position: [side * 2.2, deckY / 2, end * 3.4],
        rotation: [0, 0, side * 0.1],
      });
    }
  }
  parts.push({ geometry: new THREE.BoxGeometry(6, 0.3, 8.4), color: OAK_DARK, position: [0, deckY, 0] });

  // Fuselage -- a slim boat-shaped frame the pilot lies in.
  const hull = taperedTube(
    [[0, deckY + 1.0, -5.4], [0, deckY + 1.3, -1.8], [0, deckY + 1.3, 2.2], [0, deckY + 1.0, 5.8]],
    [0.22, 0.9, 0.85, 0.3],
    { tubularSegments: 20, radialSegments: 12 },
  );
  hull.scale(0.7, 1, 1); // narrow: a person lies in it, they do not sit across it
  parts.push({ geometry: hull, color: OAK });

  // Wings. Each is a leading-edge spar plus four radiating ribs -- the bat's finger bones
  // -- with the membrane between them.
  for (const side of [-1, 1]) {
    const spar = taperedTube(
      [
        [side * 1.0, deckY + 1.6, 0.5],
        [side * span * 0.22, deckY + 2.9, -0.6],
        [side * span * 0.36, deckY + 3.2, -1.9],
        [side * span * 0.5, deckY + 2.6, -3.2],
      ],
      [0.3, 0.24, 0.18, 0.1],
      { tubularSegments: 16, radialSegments: 8 },
    );
    parts.push({ geometry: spar, color: OAK_DARK });

    for (let f = 0; f < 4; f++) {
      const t = 0.2 + f * 0.24;
      const tipX = side * span * (0.16 + t * 0.34);
      const rootX = side * 1.2;
      const rib = taperedTube(
        [
          [rootX, deckY + 1.5, 1.0],
          [(rootX + tipX) / 2, deckY + 2.3 + t, 1.4 + f * 0.9],
          [tipX, deckY + 2.2 + t * 0.5, 2.2 + f * 2.3],
        ],
        [0.15, 0.11, 0.07],
        { tubularSegments: 12, radialSegments: 6 },
      );
      parts.push({ geometry: rib, color: OAK_DARK });
    }

    // Membrane: scalloped panels between the ribs, which is the bat wing's outline and
    // what stops the wing reading as a bare rack.
    for (let f = 0; f < 4; f++) {
      const t = 0.2 + f * 0.24;
      const panel = new THREE.CylinderGeometry(0.03, 0.03, 1, 3);
      void panel;
      const geo = new THREE.PlaneGeometry(span * 0.16, 3.4 + f * 1.6, 1, 1);
      membrane.push({
        geometry: geo,
        color: LINEN,
        position: [side * span * (0.13 + t * 0.3), deckY + 2.3 + t * 0.6, 1.6 + f * 1.55],
        rotation: [-Math.PI / 2 + 0.22, 0, side * 0.18],
      });
    }
  }

  // Tail.
  membrane.push({
    geometry: new THREE.PlaneGeometry(7, 5, 1, 1),
    color: LINEN,
    position: [0, deckY + 1.5, 7.6],
    rotation: [-Math.PI / 2 + 0.3, 0, 0],
  });

  g.add(mergedMesh(parts, { roughness: 0.88, ...relief('wood', { seed, repeat: 5 }) }));
  const skin = mesh(mergeColored(membrane), standard({
    vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, ...relief('weave', { seed: seed + 3, repeat: 4 }),
  }));
  g.add(skin);
  return g;
}

// The aerial screw -- the "helicopter". A linen helix wound round a central mast, meant to
// be spun by four people walking a capstan. It could never have worked: it has no way to
// counteract the torque, and the crew would have to run faster than any human can.
export function aerialScrew({ height = 18, radius = 9, seed = 13 } = {}) {
  const g = group();
  const parts = [];

  // Platform and capstan bars the crew push.
  parts.push({ geometry: new THREE.CylinderGeometry(radius * 0.42, radius * 0.46, 1.1, 16), color: OAK_DARK, position: [0, 0.55, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(0.16, 0.16, radius * 0.9, 8),
      color: OAK,
      position: [Math.cos(a) * radius * 0.45, 3.2, Math.sin(a) * radius * 0.45],
      rotation: [Math.PI / 2, 0, -a + Math.PI / 2],
    });
  }

  // Mast.
  parts.push({ geometry: new THREE.CylinderGeometry(0.42, 0.55, height, 12), color: OAK, position: [0, height / 2 + 1.1, 0] });

  // Radial struts holding the helix out from the mast.
  const turns = 2.2;
  const segs = 56;
  for (let i = 0; i <= segs; i += 4) {
    const t = i / segs;
    const a = t * Math.PI * 2 * turns;
    const r = radius * (1 - t * 0.18);
    const y = 3.4 + t * (height - 3.4);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.1, 0.13, r, 6),
      color: OAK_DARK,
      position: [Math.cos(a) * r / 2, y, Math.sin(a) * r / 2],
      rotation: [Math.PI / 2, 0, -a + Math.PI / 2],
    });
  }

  g.add(mergedMesh(parts, { roughness: 0.88, ...relief('wood', { seed, repeat: 5 }) }));

  // The screw surface: a ribbon of planks winding up the mast.
  //
  // TILT ABOUT X, THEN SPIN ABOUT Y -- and the order is the whole reason this works.
  // mergeColored applies a part's rotation as rotateX, then rotateY, then rotateZ, in that
  // fixed order. The first version tried to orient flat PlaneGeometry panels with a
  // combined X-and-Z Euler, which under that order does not compose into a helix at all:
  // every panel came out at its own arbitrary angle and the screw rendered as an exploding
  // heap of splinters. A plank laid along Z, tilted about X to give it the helix's pitch,
  // and then spun about Y to place it round the mast, lands correctly for any angle.
  const sail = [];
  const pitch = Math.atan2((height - 3.4) / turns, 2 * Math.PI * radius);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const a0 = t0 * Math.PI * 2 * turns;
    const y0 = 3.4 + t0 * (height - 3.4), y1 = 3.4 + t1 * (height - 3.4);
    const r = radius * (1 - t0 * 0.18);
    const segLen = Math.hypot((2 * Math.PI * r * turns) / segs, y1 - y0) * 1.5;
    sail.push({
      // Authored along Z, spanning the blade's width in X.
      geometry: new THREE.BoxGeometry(r * 0.92, 0.07, segLen),
      color: i % 2 ? LINEN : 0xcabd9f,
      position: [Math.cos(a0) * r * 0.54, (y0 + y1) / 2, Math.sin(a0) * r * 0.54],
      rotation: [pitch, -a0 + Math.PI / 2, 0],
    });
  }
  const cloth = mesh(mergeColored(sail), standard({
    vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, ...relief('weave', { seed: seed + 2, repeat: 3 }),
  }));
  g.add(cloth);
  return g;
}

// The self-propelled cart -- a spring-driven vehicle, and the one machine here that DOES
// work: a working replica was built in 2004 and it drove. It is often called the first
// robot, because it can be programmed to steer by setting blocks between the gear teeth,
// which is a fair description of a cam.
export function selfPropelledCart({ seed = 19 } = {}) {
  const parts = [];
  const deckR = 3.4;

  parts.push({ geometry: new THREE.CylinderGeometry(deckR, deckR, 0.36, 20), color: OAK, position: [0, 1.5, 0] });

  // Two big leaf-spring drums under the deck -- the power source.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.CylinderGeometry(1.1, 1.1, 0.7, 16), color: BRASS, position: [side * 1.5, 1.0, 0], rotation: [Math.PI / 2, 0, 0] });
  }

  // Wheels: two large driven at the back, one steerable at the front.
  const wheel = (x, z, r, w) => {
    parts.push({ geometry: new THREE.CylinderGeometry(r, r, w, 16), color: OAK_DARK, position: [x, r, z], rotation: [0, 0, Math.PI / 2] });
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      parts.push({
        geometry: new THREE.BoxGeometry(w * 0.5, r * 1.7, 0.16),
        color: OAK,
        position: [x, r, z],
        rotation: [0, 0, a],
      });
    }
  };
  wheel(-2.4, -1.6, 1.5, 0.42);
  wheel(2.4, -1.6, 1.5, 0.42);
  wheel(0, 2.9, 1.0, 0.36);

  // The gear train on top -- the "programming" surface, with peg holes round the rim.
  parts.push({ geometry: new THREE.CylinderGeometry(2.1, 2.1, 0.3, 24), color: BRASS, position: [0, 1.85, 0] });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(0.34, 0.34, 0.5),
      color: BRASS,
      position: [Math.cos(a) * 2.28, 1.85, Math.sin(a) * 2.28],
      rotation: [0, -a, 0],
    });
    // A few pegs actually set, which is what makes it a program rather than a wheel.
    if (i % 5 === 0) {
      parts.push({ geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.8, 6), color: IRON, position: [Math.cos(a) * 1.75, 2.3, Math.sin(a) * 1.75] });
    }
  }
  // Escapement arm.
  parts.push({ geometry: new THREE.BoxGeometry(0.22, 0.22, 3), color: IRON, position: [0, 2.4, 1.4] });

  return group(mergedMesh(parts, { roughness: 0.72, metalness: 0.25, ...relief('wood', { seed, repeat: 5 }) }));
}

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
    // fits both, from different centres.
    ctx.beginPath(); ctx.arc(cx, cy + R * 0.12, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeRect(cx - R * 0.9, cy - R * 0.78, R * 1.8, R * 1.8);

    ctx.lineWidth = 2.6;
    const S = R * 0.86;
    // Head.
    ctx.beginPath(); ctx.ellipse(cx, cy - S * 0.72, S * 0.115, S * 0.15, 0, 0, Math.PI * 2); ctx.stroke();
    // Torso.
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.17, cy - S * 0.55);
    ctx.lineTo(cx - S * 0.14, cy + S * 0.12);
    ctx.lineTo(cx + S * 0.14, cy + S * 0.12);
    ctx.lineTo(cx + S * 0.17, cy - S * 0.55);
    ctx.closePath(); ctx.stroke();
    // Two pairs of arms and two of legs -- the superimposed positions are the point.
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
    // Mirror-written notes above and below, as on the original sheet.
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
  const frame = standard({ color: OAK_DARK, roughness: 0.8, ...relief('wood', { seed: seed + 1, repeat: 3 }) });
  g.add(box(size + 0.7, size + 0.7, 0.4, frame, 0, size / 2 + 2.2, 0));
  const face = signPanel(size, size, texture);
  face.position.set(0, size / 2 + 2.2, 0.22);
  g.add(face);
  // Easel legs.
  for (const side of [-1, 1]) {
    g.add(cyl(0.14, 0.18, size / 2 + 2.4, frame, side * (size * 0.32), (size / 2 + 2.4) / 2, 0.3, 8));
  }
  g.add(cyl(0.14, 0.18, size / 2 + 2.6, frame, 0, (size / 2 + 2.6) / 2, -1.2, 8));
  return g;
}

// A workbench with tools laid out, plus a half-finished machine part in a vice.
export function workbench({ length = 10, seed = 29 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const topY = 3.0;

  parts.push({ geometry: new THREE.BoxGeometry(length, 0.42, 3.4), color: OAK, position: [0, topY, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.5, topY, 0.5), color: OAK_DARK, position: [sx * (length / 2 - 0.6), topY / 2, sz * 1.3] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(length - 1.4, 0.3, 0.4), color: OAK_DARK, position: [0, 1.0, 0] });

  // Tools: chisels, a saw, dividers, a mallet.
  for (let i = 0; i < 6; i++) {
    const x = -length / 2 + 1.2 + i * ((length - 2.4) / 5);
    parts.push({ geometry: new THREE.BoxGeometry(0.14, 0.14, 1.5), color: IRON, position: [x, topY + 0.3, randomIn(rng, -0.7, 0.7)], rotation: [0, randomIn(rng, -0.3, 0.3), 0] });
    parts.push({ geometry: new THREE.CylinderGeometry(0.16, 0.13, 0.9, 8), color: OAK_DARK, position: [x, topY + 0.3, -1.1], rotation: [Math.PI / 2, 0, 0] });
  }
  // Dividers -- the instrument on nearly every page of the notebooks.
  parts.push({ geometry: new THREE.BoxGeometry(0.1, 0.1, 2.2), color: BRASS, position: [length * 0.28, topY + 0.32, 0.6], rotation: [0, 0.18, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(0.1, 0.1, 2.2), color: BRASS, position: [length * 0.28, topY + 0.32, 0.6], rotation: [0, -0.18, 0] });
  // Mallet.
  parts.push({ geometry: new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10), color: OAK, position: [-length * 0.34, topY + 0.5, 0.9], rotation: [0, 0, Math.PI / 2] });

  // A vice at the end holding a part.
  parts.push({ geometry: new THREE.BoxGeometry(1.1, 0.8, 1.1), color: IRON, position: [length / 2 - 0.9, topY + 0.5, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.3, 2.2, 10), color: BRASS, position: [length / 2 - 0.9, topY + 1.6, 0] });

  return group(mergedMesh(parts, { roughness: 0.85, metalness: 0.12, ...relief('wood', { seed, repeat: 5 }) }));
}

// A stack of open codex pages on a stand -- the notebooks themselves, showing the mirror
// writing that is the studio's signature.
export function codexStand({ seed = 31, sketch = 'gears' } = {}) {
  const g = group();
  const wood = standard({ color: OAK_DARK, roughness: 0.82, ...relief('wood', { seed, repeat: 3 }) });
  const legH = 3.2;
  for (const sx of [-1, 1]) g.add(cyl(0.14, 0.18, legH, wood, sx * 1.5, legH / 2, 0, 8));
  g.add(box(4.6, 0.28, 3.2, wood, 0, legH, 0));

  // The open page, tilted toward the reader on a sloped desk.
  const page = mesh(
    new THREE.PlaneGeometry(4.2, 3.1),
    standard({ map: codexPage({ seed, sketch }), roughness: 0.95, side: THREE.DoubleSide }),
    0, legH + 0.75, 0,
  );
  page.rotation.x = -Math.PI / 2 + 0.55;
  g.add(page);

  // A few loose sheets underneath.
  const loose = [];
  const rng = seededRandom(seed + 4);
  for (let i = 0; i < 4; i++) {
    loose.push({
      geometry: new THREE.BoxGeometry(3.4, 0.05, 2.4),
      color: 0xd8cbae,
      position: [randomIn(rng, -0.5, 0.5), legH + 0.16 + i * 0.06, randomIn(rng, -0.4, 0.4)],
      rotation: [0, randomIn(rng, -0.25, 0.25), 0],
    });
  }
  g.add(mergedMesh(loose, { roughness: 0.96 }));
  return g;
}

// A framed painting in progress on an easel, with a palette. Deliberately UNFINISHED --
// blocked-in underpainting and a drawn cartoon, not a copy of a famous picture. Leonardo
// left most of what he started unfinished, and that is the honest thing to show.
export function easelPainting({ width = 5, height = 7, seed = 37 } = {}) {
  const texture = canvasTexture(448, 640, (ctx, w, h) => {
    const rng = seededRandom(seed);
    // Warm ground, as a panel is prepared.
    ctx.fillStyle = '#8a7250';
    ctx.fillRect(0, 0, w, h);
    // Underpainted landscape at the top -- blocked in, edges soft.
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
    // The figure: a drawn cartoon in chalk over a blocked shape, no face painted in.
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
  const wood = standard({ color: OAK_DARK, roughness: 0.82, ...relief('wood', { seed: seed + 1, repeat: 3 }) });
  const boardY = 4.6;
  g.add(cyl(0.15, 0.2, boardY + height * 0.6, wood, -1.5, (boardY + height * 0.6) / 2, 0, 8));
  g.add(cyl(0.15, 0.2, boardY + height * 0.6, wood, 1.5, (boardY + height * 0.6) / 2, 0, 8));
  g.add(cyl(0.15, 0.2, boardY + height * 0.5, wood, 0, (boardY + height * 0.5) / 2, -1.6, 8));
  g.add(box(3.6, 0.3, 0.5, wood, 0, boardY - height / 2, 0.3));

  const panel = mesh(new THREE.PlaneGeometry(width, height), standard({ map: texture, roughness: 0.92, side: THREE.DoubleSide }), 0, boardY, 0.3);
  panel.rotation.x = -0.1;
  g.add(panel);

  // Palette hooked on the leg.
  const pal = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 16), standard({ color: 0xa8865a, roughness: 0.7 }), 2.1, 3.2, 0.4);
  pal.rotation.set(Math.PI / 2 - 0.3, 0, 0.2);
  g.add(pal);
  return g;
}

// A siege catapult / spring-bow, from the military engineering pages. Leonardo took a
// salary from Ludovico Sforza as a military engineer, and the war machines fill more
// notebook pages than the flying ones -- which is worth a student knowing about how
// Renaissance genius was actually funded.
export function warMachine({ seed = 41 } = {}) {
  const parts = [];
  const frameC = OAK;

  // Base frame and wheels.
  parts.push({ geometry: new THREE.BoxGeometry(4.4, 0.6, 9), color: OAK_DARK, position: [0, 1.4, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ geometry: new THREE.CylinderGeometry(1.35, 1.35, 0.5, 14), color: OAK_DARK, position: [sx * 2.4, 1.35, sz * 3.2], rotation: [0, 0, Math.PI / 2] });
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      parts.push({ geometry: new THREE.BoxGeometry(0.5, 2.4, 0.14), color: frameC, position: [sx * 2.4, 1.35, sz * 3.2], rotation: [0, 0, a] });
    }
  }

  // Two great laminated bow arms -- the springs.
  for (const side of [-1, 1]) {
    const arm = taperedTube(
      [[side * 0.5, 2.6, -3.2], [side * 3.4, 3.6, -1.6], [side * 5.6, 4.6, 1.2]],
      [0.42, 0.32, 0.16],
      { tubularSegments: 14, radialSegments: 8 },
    );
    parts.push({ geometry: arm, color: frameC });
  }
  // Bowstring.
  parts.push({ geometry: new THREE.CylinderGeometry(0.07, 0.07, 11.4, 6), color: 0x6b5f45, position: [0, 4.6, 1.2], rotation: [0, 0, Math.PI / 2] });

  // Windlass and the trough.
  parts.push({ geometry: new THREE.BoxGeometry(0.9, 0.7, 7.5), color: frameC, position: [0, 2.5, 0.4] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.55, 0.55, 2.4, 12), color: OAK_DARK, position: [0, 2.9, 4.0], rotation: [0, 0, Math.PI / 2] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push({ geometry: new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), color: OAK, position: [0, 2.9 + Math.sin(a) * 0.8, 4.0 + Math.cos(a) * 0.8], rotation: [0, 0, Math.PI / 2] });
  }
  // A stone shot in the trough.
  parts.push({ geometry: new THREE.SphereGeometry(0.7, 12, 10), color: 0x8a8478, position: [0, 3.2, -1.4] });

  return group(mergedMesh(parts, { roughness: 0.86, ...relief('wood', { seed, repeat: 5 }) }));
}

// The studio building itself -- a Tuscan workshop: stone ground floor, plastered upper,
// pantile roof, and a big open arch so the machines can be wheeled out into the yard.
export function studioBuilding({ width = 34, depth = 24, height = 20, seed = 47 } = {}) {
  const g = group();
  const parts = [];
  const wall = 1.2;
  const stone = 0xb5a68c;

  for (const [x, z, w, d] of [
    [0, -depth / 2 + wall / 2, width, wall],
    [-width / 2 + wall / 2, 0, wall, depth],
    [width / 2 - wall / 2, 0, wall, depth],
  ]) {
    parts.push({ geometry: new THREE.BoxGeometry(w, height, d), color: stone, position: [x, height / 2, z] });
  }

  // Front wall with a big central arch: piers each side, then voussoirs over the opening.
  const openW = width * 0.34;
  const openH = height * 0.5;
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry((width - openW) / 2, height, wall),
      color: stone,
      position: [side * (openW / 2 + (width - openW) / 4), height / 2, depth / 2 - wall / 2],
    });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width, height - openH - openW / 2, wall), color: stone, position: [0, openH + openW / 2 + (height - openH - openW / 2) / 2, depth / 2 - wall / 2] });
  // The arch ring. A voussoir only lies flush if the ring is a true circle -- so the rise
  // is exactly the half-span, and the blocks are rotated by (angle - 90 degrees).
  const R = openW / 2;
  const vous = 13;
  for (let i = 0; i < vous; i++) {
    const a = Math.PI * (i + 0.5) / vous;
    parts.push({
      geometry: new THREE.BoxGeometry(R * 0.34, (Math.PI * R) / vous * 1.1, wall),
      color: i % 2 ? 0xa2937c : stone,
      position: [Math.cos(a) * R * 1.14, openH + Math.sin(a) * R * 1.14, depth / 2 - wall / 2],
      rotation: [0, 0, a - Math.PI / 2],
    });
  }

  // Upper-storey windows with shutters.
  for (let i = 0; i < 3; i++) {
    const x = -width * 0.3 + i * width * 0.3;
    parts.push({ geometry: new THREE.BoxGeometry(2.2, 3.2, 0.4), color: 0x2b2419, position: [x, height * 0.74, depth / 2 - 0.2] });
    for (const side of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(1.05, 3.2, 0.22), color: 0x5f6f52, position: [x + side * 1.6, height * 0.74, depth / 2 + 0.1], rotation: [0, side * -0.5, 0] });
    }
  }

  g.add(mergedMesh(parts, { roughness: 0.93, ...relief('stone', { seed, repeat: 5 }) }));

  // Roof: overlapping pantile rows, and NOT shadow-casting over the arch, so the sun can
  // reach a few feet inside the doorway rather than leaving a black hole.
  const roof = [];
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    roof.push({
      geometry: new THREE.BoxGeometry(width * 1.1, 0.34, (depth * 1.14) / rows),
      color: r % 2 ? 0xa8532e : 0xbb6238,
      position: [0, height + 0.4 + Math.sin(t * Math.PI) * 2.2, -depth * 0.57 + (r + 0.5) * ((depth * 1.14) / rows)],
      rotation: [Math.cos(t * Math.PI) * 0.2, 0, 0],
    });
  }
  g.add(mergedMesh(roof, { roughness: 0.95, ...relief('stone', { seed: seed + 2, repeat: 6 }) }));
  return g;
}
