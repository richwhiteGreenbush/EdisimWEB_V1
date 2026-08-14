import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  sphere,
  group,
  mergedMesh,
  canvasTexture,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';
import { photoMap } from '../SurfaceTextures.js';

// "1940's New York" -- a block of Broadway at Times Square, modelled from a colour
// photograph taken in the summer of 1949.
//
// Everything here follows the house rules at the top of PropKit.js: authored in FEET at
// scale 1, a Group whose origin is its BASE CENTRE, fresh materials per call, seeded
// randomness only.
//
// One extra convention that is local to this file and worth stating once, because every
// layout entry depends on it: **a building or a vehicle is authored FACING +Z.** A plain
// Object3D's forward is its own +Z (the same fact browserStation() relies on), so a
// west-side building whose front looks east across the street is placed with
// rotY = +PI/2, an east-side one with -PI/2, and a car driving north (-Z) with rotY = PI.
//
// The scale reference is the crowd in the photograph. A 1940s cab roof comes to about
// the shoulder of the man walking beside it, the theatre marquee clears the sidewalk by
// nearly two of him, and the Bond statues stand four storeys over the street. Those
// ratios are what every size below is checked against -- the player is 5ft.

// ---------------------------------------------------------------------------
// Shared palette + canvas helpers
// ---------------------------------------------------------------------------

// Window glass, mostly dark with a couple of sky-reflecting panes. These are diffuse
// colours on recessed boxes, not a transparency effect: a real window seen from the
// street at noon is a dark hole with a bright reflection across the top of it, and
// modelling that as colour costs nothing and never sorts wrongly against the facade.
const GLASS_SHADES = [0x2f3a45, 0x36434f, 0x293039, 0x3d4c5a, 0x242d36];

const STONE_LIGHT = 0xc9c0ad;
const STONE_MID = 0xb0a691;
const ASPHALT = 0x56555a;
const CONCRETE = 0x9c988d;

// Draws `text` centred (or aligned) at (x, y), shrinking the point size until it fits
// `maxWidth`. Sign copy is written by the layout, not measured by it, so every sign in
// this world would otherwise be one long film title away from running off its own board.
function fitText(ctx, text, x, y, maxWidth, size, font, align = 'center') {
  let s = size;
  ctx.font = font(s);
  while (s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(s);
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  return s;
}

const SANS = (s) => `bold ${s}px "Helvetica Neue", Arial, sans-serif`;
const SANS_LIGHT = (s) => `${s}px "Helvetica Neue", Arial, sans-serif`;
const SERIF = (s) => `bold ${s}px Georgia, "Times New Roman", serif`;
const SCRIPT = (s) => `italic bold ${s}px Georgia, "Times New Roman", serif`;

// A ring of marquee bulbs painted around the edge of a sign canvas.
//
// These are painted, not modelled, everywhere except the hero theatre's own marquee. A
// Times Square sign carries a few hundred bulbs; at 4 triangles each that is affordable
// once and ruinous fifteen times, and from across a 44ft street a painted bulb with a
// soft halo under it is indistinguishable from a modelled one.
function bulbBorder(ctx, w, h, { spacing = 40, radius = 7, color = '#ffeec2', glow = 'rgba(255,214,130,0.45)' } = {}) {
  const dot = (x, y) => {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const inset = radius * 2.2;
  const across = Math.max(2, Math.round((w - inset * 2) / spacing));
  const down = Math.max(2, Math.round((h - inset * 2) / spacing));
  for (let i = 0; i <= across; i++) {
    const x = inset + ((w - inset * 2) * i) / across;
    dot(x, inset);
    dot(x, h - inset);
  }
  for (let i = 1; i < down; i++) {
    const y = inset + ((h - inset * 2) * i) / down;
    dot(inset, y);
    dot(w - inset, y);
  }
}

// A lit sign face: a flat field, an optional bulb border, and a stack of centred lines.
// Each line is { text, size (fraction of canvas height), color, font, gap }.
function signTexture({ width = 1024, height = 320, face = '#16294f', lines = [], bulbs = true, pad = 0.09 }) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    if (bulbs) bulbBorder(ctx, w, h);

    const margin = w * pad;
    const totalWeight = lines.reduce((sum, line) => sum + line.size + (line.gap ?? 0.05), 0);
    // Vertically centre the whole stack rather than starting from a fixed baseline: a
    // one-line sign and a four-line one share this function, and a fixed top leaves the
    // short one sitting up under the bulbs.
    let y = (h - totalWeight * h) / 2;
    for (const line of lines) {
      const size = line.size * h;
      y += size;
      ctx.fillStyle = line.color || '#f6f1e4';
      fitText(ctx, line.text, w / 2, y, w - margin * 2, size, line.font || SANS);
      y += (line.gap ?? 0.05) * h;
    }
  });
}

// Vertical blade lettering -- one character per line down a tall, narrow canvas, which is
// how every one of these signs in the photograph is actually set. Rotating a horizontal
// word 90 degrees is the instinctive version and it is wrong: a blade sign is read from
// the street below, and stacked capitals is what makes that possible.
function bladeTexture(text, { face = '#8c1c22', ink = '#fdf3dc', width = 256 } = {}) {
  const letters = [...String(text).toUpperCase()];
  const height = Math.round((width * letters.length) / 1.15);
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    bulbBorder(ctx, w, h, { spacing: 46, radius: 8 });
    const cell = h / letters.length;
    ctx.fillStyle = ink;
    letters.forEach((ch, i) => {
      fitText(ctx, ch, w / 2, cell * (i + 0.5) + cell * 0.31, w * 0.62, cell * 0.8, SANS);
    });
  });
}

// ---------------------------------------------------------------------------
// The street itself
// ---------------------------------------------------------------------------

// Roadway, curbs, sidewalks and markings, laid along Z as one prop.
//
// The road surface is one of the few places in this project where a PHOTOGRAPH earns its
// place (see the SurfaceTextures notes): it is big, dead flat, and walked over at close
// range, which is exactly the case generated noise loses. It is neutralised hard so the
// grey below decides the colour and the photo only supplies grit and wear.
//
// `crossings` are Z positions where a side street cuts through. The sidewalk is built as
// SEGMENTS between them rather than as one long slab with holes -- a 6in curb is a solid,
// and punching a gap in it after the fact would mean either CSG or a visible seam.
export function cityStreet({
  length = 280,
  roadWidth = 44,
  walkWidth = 12,
  crossings = [],
  seed = 5,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfRoad = roadWidth / 2;
  const outer = halfRoad + walkWidth;

  const asphalt = standard({
    color: ASPHALT,
    roughness: 1,
    // A tight repeat, deliberately. This photograph is being used for its GRIT, and at a
    // loose repeat its own large-scale variation reads as patches of a different material
    // spilled across the road rather than as asphalt.
    map: photoMap('ground-regolith.jpg', { repeat: 11, repeatY: 62, neutralize: 0.8 }),
    ...relief('soil', { seed: 11, repeat: 8, strength: 0.35 }),
  });
  const road = box(roadWidth, 0.12, length, asphalt, 0, 0.06, 0);
  road.castShadow = false; // a slab lying on the ground has nothing to cast onto
  g.add(road);

  for (const z of crossings) {
    const cross = box(outer * 2 + 24, 0.12, roadWidth, asphalt, 0, 0.061, z);
    cross.castShadow = false;
    g.add(cross);
  }

  // Sidewalk: a concrete slab with a flagstone joint pattern drawn on it, plus a
  // slightly darker granite curb along the roadway edge.
  const jointTile = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,68,62,0.42)';
    ctx.lineWidth = 5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((w / 4) * i, 0);
      ctx.lineTo((w / 4) * i, h);
      ctx.moveTo(0, (h / 4) * i);
      ctx.lineTo(w, (h / 4) * i);
      ctx.stroke();
    }
  });
  jointTile.wrapS = THREE.RepeatWrapping;
  jointTile.wrapT = THREE.RepeatWrapping;
  jointTile.repeat.set(3, Math.max(3, Math.round(length / 16)));

  const walkMat = standard({ color: CONCRETE, roughness: 0.96, map: jointTile, bumpMap: jointTile, bumpScale: 0.5 });
  const curbMat = standard({ color: 0x7c7972, roughness: 0.9, ...relief('stone', { seed: 23, repeat: 6 }) });

  // Segments between the crossings. Sorted so a layout can list them in any order.
  const cuts = [...crossings].sort((a, b) => a - b);
  const edges = [-length / 2, ...cuts.flatMap((z) => [z - halfRoad, z + halfRoad]), length / 2];
  for (let i = 0; i < edges.length; i += 2) {
    const from = edges[i];
    const to = edges[i + 1];
    const span = to - from;
    if (span <= 0.5) continue;
    const cz = (from + to) / 2;
    for (const side of [-1, 1]) {
      const walk = box(walkWidth, 0.5, span, walkMat, side * (halfRoad + walkWidth / 2), 0.25, cz);
      walk.castShadow = false;
      g.add(walk);
      g.add(box(0.9, 0.62, span, curbMat, side * (halfRoad - 0.45), 0.31, cz));
    }
  }

  // Markings. A 1940s New York avenue is marked far more sparsely than a modern one --
  // a dashed lane line and painted crosswalk ladders, no edge lines, no arrows.
  const paint = [];
  const white = 0xd8d4c6;
  for (let z = -length / 2 + 6; z < length / 2 - 6; z += 16) {
    if (cuts.some((c) => Math.abs(z - c) < halfRoad + 4)) continue;
    paint.push({ geometry: new THREE.BoxGeometry(0.5, 0.03, 7), position: [0, 0.135, z + 3.5], color: white });
  }
  for (const z of cuts) {
    for (const side of [-1, 1]) {
      const at = z + side * (halfRoad + 1.6);
      for (let i = 0; i < 9; i++) {
        const x = -halfRoad + 2.4 + i * ((roadWidth - 4.8) / 8);
        paint.push({ geometry: new THREE.BoxGeometry(1.5, 0.03, 5.5), position: [x, 0.135, at], color: white });
      }
    }
  }
  if (paint.length) {
    const marks = mergedMesh(paint, { roughness: 0.95 });
    marks.castShadow = false;
    g.add(marks);
  }

  // Manhole covers and a couple of steam-vent plates, scattered off the lane line.
  const iron = [];
  for (let i = 0; i < Math.max(3, Math.round(length / 42)); i++) {
    const z = randomIn(rng, -length / 2 + 20, length / 2 - 20);
    const x = randomIn(rng, -halfRoad + 5, halfRoad - 5);
    iron.push({
      geometry: new THREE.CylinderGeometry(1.15, 1.15, 0.09, 18),
      position: [x, 0.13, z],
      color: 0x4a453e,
    });
  }
  const covers = mergedMesh(iron, { roughness: 0.85, metalness: 0.35, ...relief('metal', { seed: 61, repeat: 2 }) });
  covers.castShadow = false;
  g.add(covers);

  return g;
}

// ---------------------------------------------------------------------------
// Primary model 1 -- the yellow taxi (and the traffic around it)
// ---------------------------------------------------------------------------

// The shared skeleton of every car in this world, authored facing +Z.
//
// Four things say "1948" before any detail does, and each one is a separate rule below:
//
//  1. SEPARATE PONTOON FENDERS standing proud of the body, with the wheel visible under
//     the arch. The arch is built as seven small blocks stepped round the axle -- the
//     voussoir trick this project already uses for stone arches -- and NOT as a half
//     cylinder, which was the first attempt and was wrong: a partial cylinder is capped
//     at its flat ends, and that end cap is a solid half-disc sitting exactly where the
//     wheel should be seen. The car came out with no visible wheels at all and read as a
//     bulldozer.
//  2. RUNNING BOARDS bridging the two fenders. Without them the gap between fender and
//     door is a hole straight under the car.
//  3. A TALL UPRIGHT CABIN well back over a long hood. 5.5ft of height on 17ft of length;
//     modern long-and-low proportions lose the period instantly.
//  4. A GREENHOUSE BUILT AS A FRAME -- belt rail, three pillars a side, roof panel -- with
//     the glass hung on the OUTSIDE of it. The obvious version is one solid cabin box with
//     glass panels stuck to it, and that was the second thing wrong here: at any body
//     width the glass ends up inside the box, invisible, and the cabin reads as a painted
//     black slab. The dark interior filler goes *inside* the frame, behind the glass.
function periodCarParts({
  bodyColor,
  roofColor,
  width = 6.0,
  wheelR = 1.2,
  axleF = 5.0,
  axleR = -4.5,
  cabF = 2.2,
  cabR = -4.3,
  noseZ = 8.4,
  tailZ = -7.4,
  fastback = true,
}) {
  const paint = [];
  const chrome = [];
  const dark = [];
  const glass = [];
  const lamps = [];

  const SILL = 1.5;
  const BELT = 3.6;
  // 5.7ft to the roof on a 17ft body. That ratio is the single loudest period cue in the
  // whole car: modern proportions are long and low, and a cab of this date is nearly as
  // tall as the man standing beside it -- which is exactly what the photograph shows.
  const ROOF = 5.7;
  const trackX = width / 2 - 0.32; // wheel centre plane
  const fenderX = width / 2 - 0.28;
  const boardX = width / 2 - 0.25;
  const cabLen = cabF - cabR;
  const cabZ = (cabF + cabR) / 2;
  const glassColor = 0x2b3a44;
  const chromeColor = 0xcfd2d4;

  const put = (list, geometry, position, color, rotation = null) =>
    list.push({ geometry, position, rotation, color });

  // --- body ---------------------------------------------------------------------------
  // The tub runs the WHOLE length, nose to tail, and overlaps the hood and the nose block
  // rather than butting against them. Butted, the seams left a hole under the front of the
  // hood between the fenders that you can see straight through from kerb height.
  // The passenger tub is FULL width; the engine bay ahead of the scuttle is a good foot
  // narrower, with the front fenders standing outside it. Run the tub the whole length
  // instead (which was the first fix for a hole under the nose) and the car comes out with
  // a flat slab of a front end and reads as a truck -- the taper between the fenders is
  // most of what makes a 1940s nose look like one.
  const tubLen = noseZ - tailZ;
  const bayFront = noseZ + 0.45;
  put(paint, new THREE.BoxGeometry(width - 0.7, BELT - SILL, tubLen - (noseZ - cabF - 1.2)), [0, (SILL + BELT) / 2, (cabF + 1.2 + tailZ) / 2], bodyColor);
  put(paint, new THREE.BoxGeometry(width - 1.9, BELT - SILL, bayFront - cabF - 0.4), [0, (SILL + BELT) / 2, (bayFront + cabF + 0.4) / 2], bodyColor);
  put(paint, new THREE.BoxGeometry(width - 1.5, 0.95, noseZ - cabF - 0.4), [0, 3.15, (noseZ + cabF + 0.4) / 2], bodyColor); // hood
  put(paint, new THREE.BoxGeometry(width - 1.4, 0.5, 0.9), [0, 3.35, cabF + 0.6], bodyColor); // cowl
  put(paint, new THREE.BoxGeometry(width - 2.1, 1.6, 0.9), [0, 2.9, noseZ], bodyColor); // nose
  put(paint, new THREE.BoxGeometry(width - 0.8, 1.3, 2.2), [0, 2.85, tailZ], bodyColor); // deck

  // --- greenhouse frame ------------------------------------------------------------------
  put(paint, new THREE.BoxGeometry(width - 0.6, 0.36, cabLen + 0.2), [0, BELT, cabZ], bodyColor);
  put(paint, new THREE.BoxGeometry(width - 0.6, 0.34, cabLen + 0.3), [0, ROOF, cabZ], roofColor);
  for (const side of [-1, 1]) {
    const px = side * (width / 2 - 0.3);
    put(paint, new THREE.BoxGeometry(0.32, 2.2, 0.42), [px, 4.55, cabF - 0.2], bodyColor, [-0.28, 0, 0]); // A
    put(paint, new THREE.BoxGeometry(0.32, 1.95, 0.5), [px, 4.55, -0.3], bodyColor); // B
    put(paint, new THREE.BoxGeometry(0.32, 1.95, 0.55), [px, 4.55, cabR + 0.3], bodyColor); // C
  }
  if (fastback) {
    // Two slabs stepping down to the deck. From anywhere a pedestrian stands it reads as
    // one falling curve, which is the whole silhouette of a late-40s sedan.
    put(paint, new THREE.BoxGeometry(width - 0.85, 1.5, 2.6), [0, 4.25, cabR - 0.9], roofColor, [0.5, 0, 0]);
    put(paint, new THREE.BoxGeometry(width - 0.75, 1.5, 2.2), [0, 3.3, cabR - 2.4], bodyColor, [0.62, 0, 0]);
  } else {
    put(paint, new THREE.BoxGeometry(width - 0.85, 1.4, 2.0), [0, 4.2, cabR - 0.7], roofColor, [0.42, 0, 0]);
  }

  // --- fenders --------------------------------------------------------------------------
  // The arch has to sit CLOSE round the tyre. Sized generously it leaves a wheel-arch gap
  // the depth of the tyre itself, which is the silhouette of a lifted pickup and not of
  // anything built in 1948: crest below the hood line, and about three inches of daylight
  // over the tread.
  const arch = (axleZ, radius) => {
    const N = 7;
    const step = (Math.PI * radius) / N;
    for (let i = 0; i < N; i++) {
      const t = (Math.PI * (i + 0.5)) / N;
      for (const side of [-1, 1]) {
        put(
          paint,
          new THREE.BoxGeometry(1.25, 0.32, step * 1.35),
          [side * fenderX, wheelR + 0.05 + Math.sin(t) * radius, axleZ + Math.cos(t) * radius],
          bodyColor,
          [Math.PI / 2 - t, 0, 0]
        );
      }
    }
  };
  arch(axleF, 1.58);
  arch(axleR, 1.62);
  for (const side of [-1, 1]) {
    // The crown running forward off the front fender, carrying the headlight.
    put(paint, new THREE.BoxGeometry(1.25, 0.6, 2.6), [side * fenderX, 3.1, axleF + 1.5], bodyColor);
    put(dark, new THREE.BoxGeometry(1.2, 0.26, axleF - axleR - 2.4), [side * boardX, 1.42, (axleF + axleR) / 2], 0x36322d);
  }

  // --- underbody, wheels ------------------------------------------------------------------
  put(dark, new THREE.BoxGeometry(width - 1.0, 0.7, tubLen - 1.4), [0, 1.3, (noseZ + tailZ) / 2], 0x272420);
  put(dark, new THREE.BoxGeometry(width - 1.1, 2.0, cabLen - 0.55), [0, 4.55, cabZ], 0x15171b); // cabin interior
  for (const side of [-1, 1]) {
    for (const z of [axleF, axleR]) {
      const x = side * trackX;
      put(dark, new THREE.CylinderGeometry(wheelR, wheelR, 0.82, 20), [x, wheelR, z], 0x1b1918, [0, 0, Math.PI / 2]);
      // Whitewalls: standard on a fleet cab of this date and one of the loudest period
      // cues there is, so they are a PROUD disc rather than a painted stripe.
      put(chrome, new THREE.CylinderGeometry(wheelR * 0.7, wheelR * 0.7, 0.86, 18), [x, wheelR, z], 0xe4e0d4, [0, 0, Math.PI / 2]);
      put(chrome, new THREE.CylinderGeometry(wheelR * 0.38, wheelR * 0.38, 0.92, 16), [x, wheelR, z], chromeColor, [0, 0, Math.PI / 2]);
    }
  }

  // --- brightwork ---------------------------------------------------------------------------
  for (let i = 0; i < 7; i++) {
    put(chrome, new THREE.BoxGeometry(width - 2.4 - i * 0.06, 0.13, 0.22), [0, 2.25 + i * 0.22, noseZ + 0.5], chromeColor);
  }
  put(chrome, new THREE.BoxGeometry(0.22, 1.7, 0.3), [0, 2.95, noseZ + 0.55], chromeColor);
  for (const [z, y] of [[noseZ + 0.7, 1.95], [tailZ - 1.3, 2.0]]) {
    put(chrome, new THREE.BoxGeometry(width + 0.15, 0.34, 0.42), [0, y, z], chromeColor);
    for (const side of [-1, 1]) put(chrome, new THREE.BoxGeometry(0.3, 0.95, 0.5), [side * 1.5, y + 0.2, z], chromeColor);
  }
  for (const side of [-1, 1]) {
    // The lens goes in its OWN merge, not in with the chrome. There is no environment map
    // in this app, and a metalness-0.9 surface with nothing to reflect renders black --
    // which turned every headlight on the street into a dark blob stuck to the fender.
    // A lamp is a lit lens anyway, so it wants low metalness and a little emissive.
    put(lamps, new THREE.SphereGeometry(0.35, 14, 10), [side * fenderX, 3.45, axleF + 2.5], 0xfff4dc);
    put(chrome, new THREE.CylinderGeometry(0.4, 0.32, 0.45, 14), [side * fenderX, 3.42, axleF + 2.2], chromeColor, [Math.PI / 2, 0, 0]);
    put(chrome, new THREE.BoxGeometry(0.16, 0.14, 0.8), [side * (width / 2 - 0.24), 3.15, -0.9], chromeColor);
  }
  put(chrome, new THREE.BoxGeometry(0.5, 0.35, 0.14), [-(width / 2 + 0.12), 3.95, cabF + 0.4], chromeColor);

  // --- glass -----------------------------------------------------------------------------------
  // The windshield is SPLIT by a centre bar. Flat safety glass could not be curved in
  // 1948, so every screen of the period is two panes meeting at a shallow vee -- and that
  // bar is recognisable from right across the street.
  // Each side pane is fitted to the gap its two pillars actually leave, computed from the
  // pillar positions above rather than guessed -- a pane sized by eye either runs past the
  // C-pillar and out of the back of the car or leaves a stripe of body colour where a
  // window should be, and the two cars here have different cabin lengths.
  const frontPane = { from: -0.05, to: cabF - 0.45 };
  const rearPane = { from: cabR + 0.575, to: -0.55 };
  for (const side of [-1, 1]) {
    const px = side * (width / 2 - 0.26);
    put(glass, new THREE.BoxGeometry(width / 2 - 0.65, 1.95, 0.12), [side * (width / 4 - 0.05), 4.5, cabF + 0.16], glassColor, [-0.28, 0, 0]);
    put(glass, new THREE.BoxGeometry(0.12, 1.75, frontPane.to - frontPane.from), [px, 4.5, (frontPane.to + frontPane.from) / 2], glassColor);
    put(glass, new THREE.BoxGeometry(0.12, 1.6, rearPane.to - rearPane.from), [px, 4.45, (rearPane.to + rearPane.from) / 2], glassColor);
  }
  put(chrome, new THREE.BoxGeometry(0.16, 2.0, 0.2), [0, 4.5, cabF + 0.2], chromeColor, [-0.28, 0, 0]);
  put(glass, new THREE.BoxGeometry(width - 2.2, 1.3, 0.12), [0, 4.5, cabR - 0.1], glassColor, [0.32, 0, 0]);

  return { paint, chrome, dark, glass, lamps, BELT, ROOF, trackX, fenderX, width };
}

// Assembles the four merges every car in this world is made of. Paint, chrome, rubber and
// glass need genuinely different roughness/metalness, and mergedMesh takes ONE material
// per merge -- so four is the floor, not a missed optimisation.
function assembleCar({ paint, chrome, dark, glass, lamps }, seed) {
  const g = group();
  g.add(
    mergedMesh(paint, {
      roughness: 0.34,
      metalness: 0.2,
      // Faint orange peel. Sprayed lacquer over hand-beaten panels is not a mirror, and a
      // perfectly smooth body is what makes a generated car read as plastic.
      ...relief('metal', { seed: seed * 3 + 1, repeat: 4, strength: 0.06 }),
    })
  );
  // metalness 0.55, not the 0.9 chrome actually has. There is no environment map anywhere
  // in this app, so a fully metallic surface has nothing to reflect and renders as black:
  // at 0.9 every bumper and grille on the street came out looking like cast iron.
  g.add(mergedMesh(chrome, { roughness: 0.24, metalness: 0.55 }));
  g.add(mergedMesh(dark, { roughness: 0.92, ...relief('metal', { seed: seed + 9, repeat: 5, strength: 0.18 }) }));
  g.add(mergedMesh(glass, { roughness: 0.12, metalness: 0.45, transparent: true, opacity: 0.66 }));
  g.add(
    mergedMesh(lamps, {
      roughness: 0.2,
      metalness: 0.05,
      emissive: new THREE.Color(0xffe6b0),
      emissiveIntensity: 0.45,
    })
  );
  return g;
}

// A late-1940s New York cab: the livery, the roof flag and the whitewalls on top of the
// shared body above.
export function taxiCab({
  bodyColor = 0xe8a52c,
  roofColor = 0x2f2a26,
  fleetNumber = '2-B-71',
  seed = 7,
} = {}) {
  const rng = seededRandom(seed);
  const parts = periodCarParts({ bodyColor, roofColor, width: 6.0 });
  const g = assembleCar(parts, seed);

  // A checkerboard band and the fleet number, painted on each front door. Two separate
  // planes rather than one double-sided one: the number has to read the right way round
  // from both sides of the street, and a DoubleSide plane shows one of them mirrored.
  const doorTexture = canvasTexture(512, 192, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const squares = 16;
    const cell = w / squares;
    for (let i = 0; i < squares; i++) {
      ctx.fillStyle = i % 2 ? '#1d1b19' : '#f2ead6';
      ctx.fillRect(i * cell, h - cell * 1.1, cell, cell * 1.1);
    }
    ctx.fillStyle = '#1d1b19';
    fitText(ctx, 'TAXI', w / 2, h * 0.42, w * 0.5, h * 0.42, SANS);
    ctx.fillStyle = '#2b2723';
    fitText(ctx, fleetNumber, w / 2, h * 0.66, w * 0.4, h * 0.19, SANS_LIGHT);
  });
  for (const side of [-1, 1]) {
    const decal = mesh(new THREE.PlaneGeometry(3.2, 1.2), standard({ map: doorTexture, transparent: true, roughness: 0.5 }));
    decal.position.set(side * (parts.width / 2 - 0.32), 2.65, -0.6);
    decal.rotation.y = side * (Math.PI / 2);
    decal.castShadow = false;
    g.add(decal);
  }

  // Roof light box. Lit, because a cab with its flag up is what a cab looks like.
  const roofTexture = signTexture({
    width: 512,
    height: 160,
    face: '#f0b530',
    bulbs: false,
    lines: [{ text: 'TAXI', size: 0.52, color: '#231f1c', font: SANS }],
  });
  const roofSign = mesh(
    new THREE.BoxGeometry(2.15, 0.62, 0.42),
    standard({
      map: roofTexture,
      emissive: new THREE.Color(0xffd98a),
      emissiveMap: roofTexture,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    })
  );
  roofSign.position.set(0, parts.ROOF + 0.5, 0.6);
  g.add(roofSign);

  // A slight settle on the springs, different for every cab, so a rank of them is not a
  // row of clones. Seeded, so a reloaded world gives back the same rank.
  g.rotation.z = randomIn(rng, -0.012, 0.012);
  return g;
}

// The traffic around the hero cab: the same body, no livery, and a notch shorter.
export function sedanCar({ bodyColor = 0x27303f, topColor = null, seed = 3, coupe = false } = {}) {
  const rng = seededRandom(seed);
  const parts = periodCarParts({
    bodyColor,
    roofColor: topColor ?? bodyColor,
    width: 5.9,
    axleF: 4.7,
    axleR: -4.2,
    cabF: coupe ? 2.0 : 2.3,
    cabR: coupe ? -3.6 : -4.7,
    noseZ: 7.9,
    tailZ: -7.0,
    fastback: !coupe,
  });
  const g = assembleCar(parts, seed);
  g.rotation.z = randomIn(rng, -0.01, 0.01);
  return g;
}

// A period transit bus -- cream over green, roof destination blind, standee windows.
export function cityBus({ bodyColor = 0xe6dcc0, skirtColor = 0x2f6b46, route = '7  BROADWAY', seed = 4 } = {}) {
  const g = group();
  const LEN = 33;
  const WIDTH = 8.2;
  const paint = [];
  const dark = [];
  const glass = [];

  paint.push({ geometry: new THREE.BoxGeometry(WIDTH, 4.2, LEN), position: [0, 5.6, 0], color: bodyColor });
  paint.push({ geometry: new THREE.BoxGeometry(WIDTH, 2.6, LEN), position: [0, 3.0, 0], color: skirtColor });
  // Rounded roof: a wide, shallow half-cylinder rather than a flat lid. Every bus of the
  // period is a monocoque with a domed roof, and a flat one reads as a shipping container.
  paint.push({
    geometry: new THREE.CylinderGeometry(WIDTH / 2, WIDTH / 2, LEN - 0.6, 18, 1, false, 0, Math.PI),
    position: [0, 7.7, 0],
    rotation: [Math.PI / 2, 0, 0],
    color: bodyColor,
  });
  paint.push({ geometry: new THREE.BoxGeometry(WIDTH - 0.4, 3.4, 0.5), position: [0, 5.4, LEN / 2 + 0.1], color: bodyColor });

  for (const side of [-1, 1]) {
    for (const z of [LEN / 2 - 5, -LEN / 2 + 6]) {
      dark.push({
        geometry: new THREE.CylinderGeometry(1.5, 1.5, 0.9, 16),
        position: [side * (WIDTH / 2 - 0.55), 1.5, z],
        rotation: [0, 0, Math.PI / 2],
        color: 0x1b1918,
      });
    }
    glass.push({ geometry: new THREE.BoxGeometry(0.14, 2.5, LEN - 6), position: [side * (WIDTH / 2 - 0.02), 6.1, -0.5], color: 0x33454f });
  }
  glass.push({ geometry: new THREE.BoxGeometry(WIDTH - 1.2, 2.9, 0.14), position: [0, 6.0, LEN / 2 + 0.02], color: 0x33454f });
  glass.push({ geometry: new THREE.BoxGeometry(WIDTH - 1.4, 2.4, 0.14), position: [0, 6.0, -LEN / 2 - 0.02], color: 0x33454f });
  dark.push({ geometry: new THREE.BoxGeometry(WIDTH + 0.2, 0.4, 0.5), position: [0, 2.1, LEN / 2 + 0.2], color: 0x4a4640 });
  dark.push({ geometry: new THREE.BoxGeometry(WIDTH + 0.2, 0.4, 0.5), position: [0, 2.1, -LEN / 2 - 0.2], color: 0x4a4640 });

  g.add(mergedMesh(paint, { roughness: 0.42, metalness: 0.16 }));
  g.add(mergedMesh(dark, { roughness: 0.7, metalness: 0.4 }));
  g.add(mergedMesh(glass, { roughness: 0.14, metalness: 0.4, transparent: true, opacity: 0.6 }));

  const blind = signTexture({
    width: 768,
    height: 128,
    face: '#1c1b18',
    bulbs: false,
    lines: [{ text: route, size: 0.62, color: '#f5e2a6', font: SANS }],
  });
  const board = mesh(new THREE.PlaneGeometry(5.6, 0.95), standard({ map: blind, emissive: new THREE.Color(0xffe7a8), emissiveMap: blind, emissiveIntensity: 0.5, roughness: 0.7 }));
  board.position.set(0, 7.35, LEN / 2 + 0.32);
  g.add(board);
  return g;
}

// ---------------------------------------------------------------------------
// Primary model 4 -- the street light
// ---------------------------------------------------------------------------

// The New York "bishop's crook": a fluted cast-iron column on a scrolled base, a single
// arm curling up and over the roadway, and a teardrop luminaire hanging from its tip.
//
// The crook is a taperedTube, not a chain of cylinders. It is the ONLY part of this
// object anybody looks at, its whole character is that its radius falls as it curls, and
// a segmented approximation shows every joint from the sidewalk directly under it.
//
// At most ONE real PointLight, in the main luminaire, and `light: false` on most of them.
// A dozen lamps down a street at two lights each is twenty-four point lights in one
// scene: three.js compiles the count into the shader, so every one of them is paid for on
// every fragment of every object in the world. The lamps that are lit are the ones a
// student stands next to; the rest are emissive glass, which is all that reads from 60ft
// away in daylight anyway. The lower globe is emissive-only on every lamp.
export function bishopCrookLamp({
  height = 21,
  reach = 7.5,
  color = 0xffeec6,
  intensity = 1.5,
  globe = true,
  light = true,
} = {}) {
  const g = group();
  const ironColor = 0x22272b;
  const parts = [];

  // Base: a stepped octagonal plinth with a flared collar.
  parts.push({ geometry: new THREE.CylinderGeometry(0.95, 1.12, 0.55, 8), position: [0, 0.275, 0], color: ironColor });
  parts.push({ geometry: new THREE.CylinderGeometry(0.72, 0.95, 0.7, 8), position: [0, 0.9, 0], color: ironColor });
  parts.push({ geometry: new THREE.CylinderGeometry(0.4, 0.72, 1.5, 12), position: [0, 2.0, 0], color: ironColor });

  // Shaft.
  parts.push({ geometry: new THREE.CylinderGeometry(0.2, 0.34, height - 2.7, 14), position: [0, 2.7 + (height - 2.7) / 2, 0], color: ironColor });
  // Collar rings -- cast iron of this pattern is banded, and the bands are what stop a
  // 21ft cylinder reading as a length of pipe.
  for (const y of [5.2, 10.4, height - 1.4]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.34, 0.34, 0.3, 14), position: [0, y, 0], color: ironColor });
  }

  // The crook. A quarter turn up and over toward +X, falling away at the tip.
  const tipX = reach;
  const tipY = height + 2.4;
  const crook = taperedTube(
    [
      [0, height - 0.6, 0],
      [0.25, height + 1.6, 0],
      [1.5, height + 3.0, 0],
      [3.4, height + 3.4, 0],
      [tipX - 0.6, height + 3.1, 0],
      [tipX, tipY, 0],
    ],
    [0.21, 0.2, 0.18, 0.16, 0.14, 0.13],
    { tubularSegments: 28, radialSegments: 12 }
  );
  parts.push({ geometry: crook, color: ironColor });

  // The scroll under the crook -- the "crook" of the name. A torus arc, which is exactly
  // what a wrought volute is.
  parts.push({
    geometry: new THREE.TorusGeometry(1.5, 0.12, 8, 20, Math.PI * 1.25),
    position: [1.7, height + 0.5, 0],
    rotation: [0, 0, -0.4],
    color: ironColor,
  });
  parts.push({
    geometry: new THREE.TorusGeometry(0.75, 0.1, 8, 16, Math.PI * 1.4),
    position: [3.9, height + 2.0, 0],
    rotation: [0, 0, 2.2],
    color: ironColor,
  });

  // Luminaire body (the glass hangs off it below).
  parts.push({ geometry: new THREE.CylinderGeometry(0.5, 0.62, 0.5, 14), position: [tipX, tipY - 0.5, 0], color: ironColor });

  if (globe) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.12, 0.12, 2.1, 10), position: [-1.05, 13.4, 0], rotation: [0, 0, Math.PI / 2], color: ironColor });
    parts.push({ geometry: new THREE.CylinderGeometry(0.28, 0.16, 0.35, 10), position: [-2.05, 13.2, 0], color: ironColor });
  }

  g.add(mergedMesh(parts, { roughness: 0.5, metalness: 0.55, ...relief('metal', { seed: 71, repeat: 4 }) }));

  // Teardrop: a cone under a hemisphere, point down. This is the acorn shade every
  // photograph of the period shows, and it is the reason the lamp reads as 1940s rather
  // than as a modern cobra head. The lower globe joins the same merge.
  //
  // OPAQUE, and all of it in ONE mesh -- both on purpose, and both about the machines this
  // is meant to run on. Lit glass at opacity 0.92 is visually indistinguishable from solid
  // and costs a transparent draw, which on an integrated GPU means no early-Z, a sort every
  // frame and real overdraw; a dozen lamps down a street at three glass meshes apiece was
  // 36 of them and by itself the largest block of transparency in any world in this app.
  const lit = [
    { geometry: new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), position: [tipX, tipY - 1.05, 0], color: 0xfff6df },
    { geometry: new THREE.ConeGeometry(0.62, 1.5, 16), rotation: [Math.PI, 0, 0], position: [tipX, tipY - 1.8, 0], color: 0xfff6df },
  ];
  if (globe) lit.push({ geometry: new THREE.SphereGeometry(0.62, 16, 10), position: [-2.05, 12.6, 0], color: 0xfff6df });

  const glassMesh = mergedMesh(lit, {
    emissive: new THREE.Color(color),
    emissiveIntensity: 1.9,
    roughness: 0.35,
  });
  glassMesh.castShadow = false;
  // Tagged so the "change color to" block tints the glow as well as the paint -- the same
  // hook light orbs use (see ColorTint.applyColorTint).
  glassMesh.userData.isGlowMesh = true;
  g.add(glassMesh);

  if (light) {
    const lamp = new THREE.PointLight(color, intensity, 46, 2);
    lamp.position.set(tipX, tipY - 1.6, 0);
    g.add(lamp);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

// Punches a grid of recessed windows into one face of a merged building shell.
//
// Recessed BOXES rather than a painted window texture, and the reason is silhouette. A
// facade is seen from the sidewalk at a raking angle, where a painted window is a flat
// decal and a real reveal throws a shadow down its own side. It costs ~24 vertices a
// window and buys the whole difference between a building and a billboard.
function punchWindows(parts, {
  axis = 'z',
  sign = 1,
  faceAt,
  span,
  yStart,
  floors,
  floorHeight,
  bays,
  winW = 3.1,
  winH = 4.4,
  reveal = 0.55,
  frameColor = STONE_LIGHT,
  rng,
  litChance = 0.12,
}) {
  const bayWidth = span / bays;
  for (let f = 0; f < floors; f++) {
    const y = yStart + floorHeight * (f + 0.55);
    for (let b = 0; b < bays; b++) {
      const u = -span / 2 + bayWidth * (b + 0.5);
      const glass = rng() < litChance
        ? [0xbda476, 0xa8905f][Math.floor(rng() * 2)]
        : GLASS_SHADES[Math.floor(rng() * GLASS_SHADES.length)];

      const at = faceAt - sign * reveal * 0.5;
      const put = (w, h, d, du, dy, color) => {
        const geometry = axis === 'z' ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w);
        const position = axis === 'z' ? [u + du, y + dy, at] : [at, y + dy, u + du];
        parts.push({ geometry, position, color });
      };
      put(winW, winH, reveal, 0, 0, glass);
      // Sill, proud of the wall, and a lintel band. Cheap, and it is what makes a row of
      // holes read as windows rather than as damage.
      const sillAt = faceAt + sign * 0.12;
      const sillGeom = axis === 'z'
        ? new THREE.BoxGeometry(winW + 0.7, 0.24, 0.42)
        : new THREE.BoxGeometry(0.42, 0.24, winW + 0.7);
      parts.push({
        geometry: sillGeom,
        position: axis === 'z' ? [u, y - winH / 2 - 0.1, sillAt] : [sillAt, y - winH / 2 - 0.1, u],
        color: frameColor,
      });
    }
  }
}

// A low-poly period city block: shell, window grid, ground-floor storefront band and a
// crowning cornice. Styles differ in the roof, which is the only part of a background
// building anyone ever identifies it by.
//
//   'stone'   -- limestone office block with a heavy projecting cornice
//   'brick'   -- narrower loft building, corbelled brick parapet
//   'setback' -- 1920s zoning-law tower stepping back twice as it rises
//   'mansard' -- green copper mansard with dormers (the Hotel Astor, centre distance)
export function cityBuilding({
  width = 44,
  depth = 34,
  height = 80,
  style = 'stone',
  wallColor = null,
  floorHeight = 9,
  baseHeight = 13,
  bays = 0,
  sides = true,
  seed = 9,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const color = wallColor ?? (style === 'brick' ? 0x8d5c48 : style === 'mansard' ? 0xa89478 : STONE_MID);
  const parts = [];
  const halfW = width / 2;
  const halfD = depth / 2;
  const bayCount = bays || Math.max(3, Math.round(width / 6.5));
  const sideBays = Math.max(3, Math.round(depth / 6.5));

  const shellTop = style === 'mansard' ? height - 12 : height;
  const floors = Math.max(1, Math.floor((shellTop - baseHeight - 4) / floorHeight));

  if (style === 'setback') {
    // Three stacked masses. The zoning law of 1916 is why every tower of this date looks
    // like a wedding cake, and the steps are far more identifying than any detail on them.
    const tiers = [
      { w: width, d: depth, from: 0, to: shellTop * 0.5 },
      { w: width * 0.74, d: depth * 0.74, from: shellTop * 0.5, to: shellTop * 0.8 },
      { w: width * 0.48, d: depth * 0.48, from: shellTop * 0.8, to: shellTop },
    ];
    for (const t of tiers) {
      parts.push({
        geometry: new THREE.BoxGeometry(t.w, t.to - t.from, t.d),
        position: [0, (t.from + t.to) / 2, 0],
        color,
      });
      parts.push({
        geometry: new THREE.BoxGeometry(t.w + 1.1, 0.9, t.d + 1.1),
        position: [0, t.to - 0.45, 0],
        color: STONE_LIGHT,
      });
      const tierFloors = Math.max(1, Math.floor((t.to - t.from - 3) / floorHeight));
      punchWindows(parts, {
        axis: 'z', sign: 1, faceAt: t.d / 2, span: t.w * 0.86,
        yStart: t.from + 1.5, floors: tierFloors, floorHeight,
        bays: Math.max(2, Math.round(t.w / 7)), rng,
      });
      if (sides) {
        for (const s of [-1, 1]) {
          punchWindows(parts, {
            axis: 'x', sign: s, faceAt: s * (t.w / 2), span: t.d * 0.86,
            yStart: t.from + 1.5, floors: tierFloors, floorHeight,
            bays: Math.max(2, Math.round(t.d / 7)), rng,
          });
        }
      }
    }
  } else {
    parts.push({ geometry: new THREE.BoxGeometry(width, shellTop, depth), position: [0, shellTop / 2, 0], color });

    // Ground floor: a darker polished base with shop glazing, which is what every one of
    // these buildings actually has at eye level and the only part a walker sees closely.
    parts.push({
      geometry: new THREE.BoxGeometry(width + 0.5, baseHeight, depth + 0.5),
      position: [0, baseHeight / 2, 0],
      color: 0x4b433b,
    });
    const shopBays = Math.max(2, Math.round(width / 9));
    for (let i = 0; i < shopBays; i++) {
      const x = -width / 2 + (width / shopBays) * (i + 0.5);
      parts.push({
        geometry: new THREE.BoxGeometry((width / shopBays) * 0.76, baseHeight * 0.52, 0.5),
        position: [x, baseHeight * 0.52, halfD + 0.1],
        color: 0x2b3a44,
      });
    }
    parts.push({
      geometry: new THREE.BoxGeometry(width + 1.2, 0.7, depth + 1.2),
      position: [0, baseHeight + 0.35, 0],
      color: STONE_LIGHT,
    });

    punchWindows(parts, {
      axis: 'z', sign: 1, faceAt: halfD, span: width * 0.88,
      yStart: baseHeight + 1.2, floors, floorHeight, bays: bayCount, rng,
    });
    if (sides) {
      for (const s of [-1, 1]) {
        punchWindows(parts, {
          axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.88,
          yStart: baseHeight + 1.2, floors, floorHeight, bays: sideBays, rng,
        });
      }
    }

    const cornice = style === 'brick' ? 1.4 : 2.4;
    parts.push({
      geometry: new THREE.BoxGeometry(width + cornice, 1.6, depth + cornice),
      position: [0, shellTop - 2.2, 0],
      color: STONE_LIGHT,
    });
    parts.push({
      geometry: new THREE.BoxGeometry(width + 0.6, 2.6, depth + 0.6),
      position: [0, shellTop - 0.4, 0],
      color: style === 'brick' ? color : STONE_LIGHT,
    });
  }

  g.add(
    mergedMesh(parts, {
      roughness: 0.9,
      ...relief(style === 'brick' ? 'stone' : 'stone', { seed: seed + 3, repeat: 7 }),
    })
  );

  if (style === 'mansard') {
    // A truncated square pyramid. A 4-sided cylinder rotated 45deg gives flats facing the
    // axes; the radius has to be scaled by sqrt(2) for the FLATS (not the corners) to land
    // on the building's own width, which is the one bit of this that is easy to get wrong.
    const roofH = 12;
    const copper = standard({ color: 0x5d8f79, roughness: 0.75, metalness: 0.25, ...relief('metal', { seed: 83, repeat: 5 }) });
    const geometry = new THREE.CylinderGeometry((width * 0.62) / Math.SQRT2, (width * 1.02) / Math.SQRT2, roofH, 4);
    geometry.rotateY(Math.PI / 4);
    geometry.scale(1, 1, depth / width);
    const roof = mesh(geometry, copper, 0, shellTop + roofH / 2, 0);
    g.add(roof);

    const dormers = [];
    const count = Math.max(3, Math.round(width / 11));
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + (width / count) * (i + 0.5);
      dormers.push({ geometry: new THREE.BoxGeometry(4.4, 5.2, 4.0), position: [x, shellTop + 3.6, depth * 0.4], color: 0x5d8f79 });
      dormers.push({ geometry: new THREE.BoxGeometry(3.0, 3.2, 0.4), position: [x, shellTop + 3.8, depth * 0.4 + 2.1], color: 0x2c3944 });
      dormers.push({
        geometry: new THREE.CylinderGeometry(2.5 / Math.SQRT2, 2.5 / Math.SQRT2, 2.0, 4),
        rotation: [0, Math.PI / 4, 0],
        position: [x, shellTop + 7.2, depth * 0.4],
        color: 0x4d7f69,
      });
    }
    g.add(mergedMesh(dormers, { roughness: 0.75, metalness: 0.25 }));
    g.add(box(width * 0.16, 9, depth * 0.16, standard({ color: 0x7a5a48, roughness: 0.95 }), width * 0.28, shellTop + roofH + 3, -depth * 0.2));
  }

  return g;
}

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

// A projecting theatre marquee: the lit box hanging over the sidewalk, its soffit, and
// a modelled bulb chase around all three visible edges.
//
// The bulbs on THIS one are real geometry, unlike every other sign in the world. A
// marquee is the object a student stands directly underneath, close enough that painted
// dots on a flat soffit read as what they are.
function marquee({ width, projection, faceHeight, lines, face, atY, bulbColor = 0xffe6a8 }) {
  const g = group();
  const steel = standard({ color: 0x2b2f34, roughness: 0.55, metalness: 0.55, ...relief('metal', { seed: 91, repeat: 3 }) });

  const fascia = signTexture({
    width: 1024,
    height: Math.round((1024 * faceHeight) / width),
    face,
    lines,
  });
  const sideTexture = signTexture({
    width: 512,
    height: Math.round((512 * faceHeight) / projection),
    face,
    lines: lines.slice(0, 2),
  });

  const litMat = (map) =>
    standard({ map, emissive: new THREE.Color(0xfff0cc), emissiveMap: map, emissiveIntensity: 0.75, roughness: 0.6 });

  const bodyY = atY + faceHeight / 2;
  g.add(box(width, faceHeight + 0.5, projection, steel, 0, bodyY, projection / 2));

  const front = mesh(new THREE.PlaneGeometry(width - 0.5, faceHeight), litMat(fascia));
  front.position.set(0, bodyY, projection + 0.02);
  g.add(front);
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.PlaneGeometry(projection - 0.4, faceHeight), litMat(sideTexture));
    panel.position.set(side * (width / 2 + 0.02), bodyY, projection / 2);
    panel.rotation.y = side * (Math.PI / 2);
    g.add(panel);
  }

  // Soffit: the underside is a lit ceiling in every one of these photographs, so it is a
  // pale emissive panel with a grid of bulbs in it, not a dark steel plate.
  const soffit = mesh(
    new THREE.PlaneGeometry(width - 0.6, projection - 0.4),
    standard({ color: 0xf0e2c4, emissive: new THREE.Color(0xffe3ad), emissiveIntensity: 0.5, roughness: 0.7, side: THREE.DoubleSide })
  );
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set(0, atY - 0.24, projection / 2);
  g.add(soffit);

  const bulbs = [];
  const step = 1.35;
  for (let x = -width / 2 + 0.7; x <= width / 2 - 0.7; x += step) {
    bulbs.push({ geometry: new THREE.SphereGeometry(0.19, 8, 6), position: [x, atY - 0.32, projection + 0.02], color: 0xfff2d2 });
    bulbs.push({ geometry: new THREE.SphereGeometry(0.19, 8, 6), position: [x, atY + faceHeight + 0.28, projection + 0.02], color: 0xfff2d2 });
    bulbs.push({ geometry: new THREE.SphereGeometry(0.17, 8, 6), position: [x, atY - 0.3, projection * 0.45], color: 0xfff2d2 });
  }
  for (let z = 0.7; z <= projection - 0.4; z += step) {
    for (const side of [-1, 1]) {
      bulbs.push({ geometry: new THREE.SphereGeometry(0.19, 8, 6), position: [side * (width / 2 + 0.02), atY - 0.32, z], color: 0xfff2d2 });
      bulbs.push({ geometry: new THREE.SphereGeometry(0.19, 8, 6), position: [side * (width / 2 + 0.02), atY + faceHeight + 0.28, z], color: 0xfff2d2 });
    }
  }
  const chase = mergedMesh(bulbs, {
    emissive: new THREE.Color(bulbColor),
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  chase.castShadow = false;
  g.add(chase);

  // Hanger rods back to the wall, so the box is not floating.
  for (const side of [-1, 1]) {
    g.add(cyl(0.09, 0.09, 7.5, steel, side * (width / 2 - 1.5), atY + faceHeight + 3.4, projection * 0.75, 8));
  }
  return g;
}

// A vertical blade sign standing off the face of a building.
//
// It projects along +Z and its readable faces point +/-X, which is the opposite of what
// the instinct says: a blade is meant to be read by somebody walking ALONG the sidewalk,
// not standing in front of the building.
function bladeSign({ text, height, projection = 5.5, face = '#8c1c22', atY }) {
  const g = group();
  const steel = standard({ color: 0x2b2f34, roughness: 0.55, metalness: 0.5 });
  const texture = bladeTexture(text, { face });
  const litMat = standard({
    map: texture,
    emissive: new THREE.Color(0xffd9a8),
    emissiveMap: texture,
    emissiveIntensity: 0.85,
    roughness: 0.6,
  });

  g.add(box(1.1, height, projection, steel, 0, atY + height / 2, projection / 2));
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.PlaneGeometry(projection, height), litMat);
    panel.position.set(side * 0.58, atY + height / 2, projection / 2);
    panel.rotation.y = side * (Math.PI / 2);
    g.add(panel);
  }
  return g;
}

// A flat lit sign hung on a wall face. `worldPortal` aside, this is how every secondary
// piece of Times Square copy in this world is made.
export function wallSign({
  width = 16,
  height = 6,
  face = '#123a6b',
  lines = [],
  bulbs = true,
  frame = 0x2b2f34,
  emissiveIntensity = 0.8,
} = {}) {
  const g = group();
  const texture = signTexture({
    width: 1024,
    height: Math.max(160, Math.round((1024 * height) / width)),
    face,
    bulbs,
    lines,
  });
  g.add(box(width + 0.5, height + 0.5, 0.4, standard({ color: frame, roughness: 0.6, metalness: 0.4 }), 0, 0, -0.2));
  const panel = mesh(
    new THREE.PlaneGeometry(width, height),
    standard({ map: texture, emissive: new THREE.Color(0xfff0cc), emissiveMap: texture, emissiveIntensity, roughness: 0.6 })
  );
  panel.position.z = 0.02;
  g.add(panel);
  return g;
}

// ---------------------------------------------------------------------------
// Primary model 2 -- the Barkleys of Broadway theatre
// ---------------------------------------------------------------------------

// The picture palace on the left of the photograph: a limestone office block with a
// theatre carved out of its base, a blue marquee slung across the sidewalk, a blade sign
// climbing five storeys, and a hanging banner for the season.
//
// Authored facing +Z, origin base centre.
export function broadwayTheatre({
  width = 46,
  depth = 30,
  height = 96,
  seed = 15,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const parts = [];

  const BASE = 13.5; // top of the stone base, under the marquee
  const stone = STONE_MID;

  parts.push({ geometry: new THREE.BoxGeometry(width, height, depth), position: [0, height / 2, 0], color: stone });

  // Classical base: a plinth course, four engaged pilasters and an entablature. The
  // photograph's building has exactly this, and it is what separates a theatre from an
  // office block at street level.
  parts.push({ geometry: new THREE.BoxGeometry(width + 1.4, 1.5, depth + 1.4), position: [0, 0.75, 0], color: STONE_LIGHT });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.9, BASE - 3.2, depth + 0.9), position: [0, 1.5 + (BASE - 3.2) / 2, 0], color: STONE_LIGHT });
  for (let i = 0; i < 5; i++) {
    const x = -halfW + 3.6 + i * ((width - 7.2) / 4);
    parts.push({ geometry: new THREE.BoxGeometry(2.3, BASE - 4.6, 1.1), position: [x, 1.5 + (BASE - 4.6) / 2, halfD + 0.7], color: STONE_LIGHT });
    parts.push({ geometry: new THREE.BoxGeometry(2.9, 0.7, 1.5), position: [x, BASE - 2.9, halfD + 0.8], color: 0xd8d0be });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width + 2.2, 1.7, depth + 2.2), position: [0, BASE - 0.85, 0], color: STONE_LIGHT });

  // Entrance: a recessed lobby, dark inside so it reads as a way in rather than as a
  // panel. Same lesson the Park's nature centre learned -- a single lit sheet across a
  // door opening is a board, and what makes it a door is the reveal and the divisions.
  const doorW = 15;
  parts.push({ geometry: new THREE.BoxGeometry(doorW, 10.5, 3.0), position: [0, 5.25, halfD - 1.3], color: 0x16130f });
  for (let i = 0; i < 4; i++) {
    const x = -doorW / 2 + 1.4 + i * ((doorW - 2.8) / 3);
    parts.push({ geometry: new THREE.BoxGeometry(0.45, 9.6, 0.5), position: [x, 4.8, halfD + 0.05], color: 0x8a6a2c });
  }
  parts.push({ geometry: new THREE.BoxGeometry(doorW + 0.8, 0.6, 0.7), position: [0, 9.9, halfD + 0.1], color: 0x8a6a2c });
  parts.push({ geometry: new THREE.BoxGeometry(doorW - 1.2, 1.5, 0.35), position: [0, 10.8, halfD + 0.12], color: 0xb99a4c });

  // Shop bays either side of the lobby, glazed.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry((width - doorW) / 2 - 5.5, 7.6, 0.55),
      position: [side * (doorW / 2 + (width - doorW) / 4 + 0.6), 5.4, halfD + 0.45],
      color: 0x2b3a44,
    });
  }

  // Office storeys above.
  const floors = Math.floor((height - BASE - 12) / 8.4);
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.86,
    yStart: BASE + 3.5, floors, floorHeight: 8.4, bays: 7, rng, winW: 3.0, winH: 4.6,
  });
  for (const s of [-1, 1]) {
    punchWindows(parts, {
      axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.84,
      yStart: BASE + 3.5, floors, floorHeight: 8.4, bays: 5, rng, winW: 3.0, winH: 4.6,
    });
  }

  parts.push({ geometry: new THREE.BoxGeometry(width + 3.0, 1.9, depth + 3.0), position: [0, height - 3.6, 0], color: STONE_LIGHT });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.8, 2.8, depth + 0.8), position: [0, height - 1.4, 0], color: STONE_LIGHT });

  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed, repeat: 8 }) }));

  // --- the marquee ---------------------------------------------------------------------
  const marqueeBox = marquee({
    width: width - 8,
    projection: 9.5,
    faceHeight: 6.4,
    atY: 12.2,
    face: '#152a56',
    lines: [
      { text: 'FRED ASTAIRE   ·   GINGER ROGERS', size: 0.155, color: '#f7f1de', font: SANS },
      { text: '"The Barkleys of BROADWAY"', size: 0.3, color: '#ffd766', font: SCRIPT, gap: 0.04 },
      { text: 'OSCAR LEVANT  ·  A TECHNICOLOR MUSICAL', size: 0.115, color: '#dfe6f5', font: SANS_LIGHT },
    ],
  });
  marqueeBox.position.z = halfD;
  g.add(marqueeBox);

  // --- blade sign ----------------------------------------------------------------------
  const blade = bladeSign({ text: 'STATE', height: 34, projection: 5.5, face: '#8c1c22', atY: 26 });
  blade.position.set(-halfW + 5.5, 0, halfD);
  g.add(blade);

  // --- poster boards flanking the entrance ----------------------------------------------
  const posterTexture = canvasTexture(384, 560, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1b3a74');
    grad.addColorStop(1, '#8d2440');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd766';
    fitText(ctx, 'ASTAIRE', w / 2, h * 0.2, w * 0.86, h * 0.1, SANS);
    fitText(ctx, 'ROGERS', w / 2, h * 0.32, w * 0.86, h * 0.1, SANS);
    ctx.fillStyle = '#f7f1de';
    fitText(ctx, 'The Barkleys', w / 2, h * 0.56, w * 0.9, h * 0.11, SCRIPT);
    fitText(ctx, 'of BROADWAY', w / 2, h * 0.68, w * 0.9, h * 0.1, SCRIPT);
    ctx.fillStyle = '#e6d9b8';
    fitText(ctx, 'M-G-M  ·  TECHNICOLOR', w / 2, h * 0.86, w * 0.84, h * 0.055, SANS_LIGHT);
    ctx.strokeStyle = '#f0c86a';
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, w - 24, h - 24);
  });
  const frameMat = standard({ color: 0x8a6a2c, roughness: 0.5, metalness: 0.55 });
  for (const x of [-doorW / 2 - 2.6, doorW / 2 + 2.6]) {
    const board = group();
    board.add(box(3.4, 5.2, 0.34, frameMat, 0, 0, 0));
    const face = mesh(new THREE.PlaneGeometry(3.0, 4.8), standard({ map: posterTexture, roughness: 0.75, emissive: new THREE.Color(0x6a5a3a), emissiveMap: posterTexture, emissiveIntensity: 0.35 }));
    face.position.z = 0.19;
    board.add(face);
    board.position.set(x, 6.4, halfD + 0.6);
    g.add(board);
  }

  // --- hanging season banner --------------------------------------------------------------
  // Angled off the wall on a bracket, exactly as it hangs in the photograph. Slightly
  // skewed rather than square-on: a banner that hangs perfectly flat reads as a sign.
  const bannerTexture = canvasTexture(360, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c1272d';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#1f3f7a';
    fitText(ctx, "Loew's", w / 2, h * 0.2, w * 0.7, h * 0.12, SCRIPT);
    ctx.fillStyle = '#c1272d';
    fitText(ctx, 'BIG', w / 2, h * 0.46, w * 0.8, h * 0.24, SANS);
    ctx.fillStyle = '#1f3f7a';
    fitText(ctx, 'SHOW', w / 2, h * 0.66, w * 0.82, h * 0.14, SANS);
    fitText(ctx, 'SEASON', w / 2, h * 0.82, w * 0.86, h * 0.13, SANS);
  });
  const banner = group();
  banner.add(cyl(0.08, 0.08, 5.5, standard({ color: 0x2b2f34, roughness: 0.6, metalness: 0.5 }), 0, 3.9, -2.6, 8));
  const cloth = signPanel(4.6, 6.6, bannerTexture);
  cloth.position.set(0, 0, 0);
  banner.add(cloth);
  banner.position.set(-halfW + 13, 30, halfD + 2.8);
  banner.rotation.y = -0.35;
  g.add(banner);

  return g;
}

// ---------------------------------------------------------------------------
// Primary model 3 -- the BOND building
// ---------------------------------------------------------------------------

// A stylised classical figure in pale stone, for the pair that stand over the Bond sign.
//
// These are SCULPTURE, not people: smooth, abstracted, and quarry-coloured, closer to a
// war memorial than to a portrait. The brief's "no people" is about the crowd in the
// photograph, which is why there are no pedestrians anywhere in this world -- but the two
// colossi are the single most identifying thing about this building, and a Bond sign
// without them is not the Bond sign.
//
// Built from taperedTubes with a joint sphere at every hip and shoulder, which is
// DinoProps' lesson and applies verbatim: two tubes meeting at an angle each end in an
// open ring lying in its own plane, and wherever the planes disagree the surfaces cross.
function bondStatue({ height = 29, color = 0xe2dccd, mirrored = false, seed = 41 } = {}) {
  const s = height / 24; // every number below is authored against a 24-unit figure
  const side = mirrored ? -1 : 1;
  const parts = [];
  const add = (geometry, position, rotation) => parts.push({ geometry, position, rotation, color });
  const at = (x, y, z = 0) => [x * s * side, y * s, z * s];

  const tube = (points, radii, segments = 22) =>
    taperedTube(points.map(([x, y, z]) => [x * s * side, y * s, (z || 0) * s]), radii.map((r) => r * s), {
      tubularSegments: segments,
      radialSegments: 14,
    });

  // Legs, weight on one of them. Contrapposto is the difference between a classical figure
  // and a shop dummy and it costs one displaced control point.
  add(tube([[1.15, 0.4, 0.1], [1.1, 3.4, 0.2], [1.05, 6.6, 0.05], [0.95, 9.0, -0.05], [0.85, 11.2, 0]],
    [0.62, 0.95, 0.8, 1.15, 1.3]));
  add(tube([[-1.25, 0.4, 0.55], [-1.3, 3.5, 0.65], [-1.35, 6.7, 0.4], [-1.1, 9.1, 0.1], [-0.85, 11.2, 0]],
    [0.6, 0.92, 0.78, 1.12, 1.28]));
  add(new THREE.SphereGeometry(1.45 * s, 16, 12), at(0.95, 11.0));
  add(new THREE.SphereGeometry(1.45 * s, 16, 12), at(-0.95, 11.0));
  for (const [x, z] of [[1.15, 0.6], [-1.25, 1.05]]) {
    add(new THREE.BoxGeometry(1.5 * s, 0.7 * s, 3.0 * s), at(x, 0.35, z));
  }

  // Torso -- then FLATTENED, and that is the whole difference between a figure and a
  // snowman. A swept tube is as deep as it is wide by construction, so a chest sized to
  // look right from the front is a five-foot-deep barrel from the side, which is exactly
  // how the first pair read from the street. Scaling the finished geometry 1.3 wide and
  // 0.72 deep costs nothing (every control point is on x = 0, so nothing moves) and gives
  // the shallow, broad ribcage a human silhouette actually has.
  const torso = tube([[0, 10.6, 0], [0, 13.4, 0.2], [0, 16.2, 0.15], [0, 18.6, 0], [0, 19.8, -0.15]],
    [1.95, 1.6, 2.0, 2.15, 1.75]);
  torso.scale(1.3, 1, 0.72);
  add(torso);

  // A real shoulder line. Without it the arms grow straight out of the ribcage and the
  // whole upper body reads as one lump.
  const shoulders = new THREE.SphereGeometry(1.5 * s, 18, 12);
  shoulders.scale(1.8, 0.7, 0.78);
  add(shoulders, at(0, 19.3));

  // Arms. One down the flank, one raised across the body -- the pair in the photograph are
  // not mirror images, and a matched pair reads as a pattern rather than as sculpture.
  const raised = mirrored;
  add(tube(
    raised
      ? [[2.9, 19.2, 0], [3.7, 16.6, 0.9], [4.0, 14.2, 1.9], [3.6, 12.6, 2.7]]
      : [[2.9, 19.2, 0], [3.35, 16.4, 0.3], [3.4, 13.6, 0.35], [3.3, 11.9, 0.6]],
    [0.88, 0.72, 0.58, 0.5]
  ));
  add(tube([[-2.9, 19.2, 0], [-3.3, 16.4, -0.1], [-3.35, 13.6, 0.1], [-3.2, 11.8, 0.5]],
    [0.88, 0.72, 0.58, 0.5]));
  add(new THREE.SphereGeometry(1.0 * s, 14, 10), at(2.9, 19.2));
  add(new THREE.SphereGeometry(1.0 * s, 14, 10), at(-2.9, 19.2));

  // Neck and head. A 24-unit figure gets a 3.2-unit head -- seven and a half heads tall,
  // the canonical proportion, and the neck has to be VISIBLE or the head sits on the
  // shoulders like a knob.
  add(tube([[0, 19.3, -0.1], [0, 21.0, 0]], [0.8, 0.7]));
  const head = new THREE.SphereGeometry(1.55 * s, 20, 16);
  head.scale(0.86, 1.12, 0.95);
  add(head, at(0, 22.4, 0.05));

  return group(
    mergedMesh(parts, {
      roughness: 0.94,
      ...relief('stone', { seed, repeat: 4, strength: 0.45 }),
    })
  );
}

// The Bond clothing store: a dark storefront under a signboard four storeys high,
// carrying the giant BOND letters, the two colossi, and the illuminated disc between them.
//
// Authored facing +Z, origin base centre. It stands at the head of the avenue so the
// whole street terminates on it, which is exactly the job it does in the photograph.
export function bondBuilding({
  width = 68,
  depth = 32,
  seed = 27,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const parts = [];

  const STORE = 15; // top of the storefront
  const WALL = 42; // top of the building proper -- the sign deck
  const SIGN_TOP = 56; // top of the BOND letter band

  parts.push({ geometry: new THREE.BoxGeometry(width, WALL, depth), position: [0, WALL / 2, 0], color: 0x8f8574 });
  // Polished dark base with big display windows. Bond's was a clothing store and the
  // whole ground floor is glass; the mullions between the bays are all that is solid.
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, STORE, depth + 0.6), position: [0, STORE / 2, 0], color: 0x2b2924 });
  const bays = 7;
  for (let i = 0; i < bays; i++) {
    const x = -halfW + (width / bays) * (i + 0.5);
    parts.push({
      geometry: new THREE.BoxGeometry((width / bays) * 0.82, 8.4, 0.6),
      position: [x, 5.6, halfD + 0.35],
      color: 0x33434d,
    });
    parts.push({
      geometry: new THREE.BoxGeometry((width / bays) * 0.86, 0.5, 1.5),
      position: [x, 10.2, halfD + 0.8],
      color: 0x6d5c3a,
    });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width + 1.6, 0.9, depth + 1.6), position: [0, STORE + 0.45, 0], color: 0xb3a892 });

  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.8,
    yStart: STORE + 2.5, floors: 2, floorHeight: 9.5, bays: 6, rng, winW: 3.6, winH: 5.2,
  });
  for (const s of [-1, 1]) {
    punchWindows(parts, {
      axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.8,
      yStart: STORE + 2.5, floors: 3, floorHeight: 9.5, bays: 4, rng,
    });
  }

  // The signboard: a solid backing wall standing on the roof, with the letter band
  // across its face. Backed solid on purpose -- a big flat panel seen from behind is a
  // black slab (the Mars lesson), and this one is seen from three quarters of the world.
  parts.push({ geometry: new THREE.BoxGeometry(width, SIGN_TOP - WALL, 2.4), position: [0, (WALL + SIGN_TOP) / 2, halfD - 1.2], color: 0x1c2b3f });
  // Truss legs behind the board, which is how these were actually held up.
  for (let i = 0; i < 5; i++) {
    const x = -halfW + 4 + i * ((width - 8) / 4);
    parts.push({ geometry: new THREE.BoxGeometry(0.7, SIGN_TOP - WALL + 6, 0.7), position: [x, (WALL + SIGN_TOP) / 2 + 3, halfD - 4.5], color: 0x33383d });
    parts.push({ geometry: new THREE.BoxGeometry(0.6, 0.6, 7), position: [x, WALL + 1.5, halfD - 4.0], color: 0x33383d });
  }

  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 7 }) }));

  // --- the letters -----------------------------------------------------------------------
  const bondFace = signTexture({
    width: 1536,
    height: 420,
    face: '#152238',
    lines: [{ text: 'BOND', size: 0.68, color: '#fbf6e8', font: SANS }],
  });
  const letters = mesh(
    new THREE.PlaneGeometry(width - 3, SIGN_TOP - WALL - 1),
    standard({ map: bondFace, emissive: new THREE.Color(0xffffff), emissiveMap: bondFace, emissiveIntensity: 0.95, roughness: 0.55 })
  );
  letters.position.set(0, (WALL + SIGN_TOP) / 2, halfD + 0.05);
  g.add(letters);

  // --- storefront band -------------------------------------------------------------------
  const band = wallSign({
    width: width - 6,
    height: 4.6,
    face: '#111c2e',
    lines: [
      { text: 'BOND', size: 0.4, color: '#fbf6e8', font: SANS },
      { text: 'TWO  TROUSER  SUITS', size: 0.22, color: '#f0c86a', font: SANS },
    ],
  });
  band.position.set(0, 12.6, halfD + 0.9);
  g.add(band);

  // Vertical "CLOTHES" strip at the left edge of the storefront, as in the photograph.
  const clothes = bladeSign({ text: 'CLOTHES', height: 15, projection: 3.4, face: '#1c3f6b', atY: STORE + 2 });
  clothes.position.set(-halfW + 3.2, 0, halfD);
  g.add(clothes);

  // --- pedestals, statues, disc -------------------------------------------------------------
  const pedestalMat = standard({ color: 0xcdc4b0, roughness: 0.92, ...relief('stone', { seed: seed + 5, repeat: 3 }) });
  const statueX = halfW - 11;
  for (const side of [-1, 1]) {
    const plinth = group();
    plinth.add(box(11, 4.5, 9, pedestalMat, 0, 2.25, 0));
    plinth.add(box(12.2, 0.9, 10.2, pedestalMat, 0, 5.0, 0));
    plinth.add(box(12.2, 0.9, 10.2, pedestalMat, 0, 0.45, 0));
    plinth.position.set(side * statueX, SIGN_TOP, halfD - 5);
    g.add(plinth);

    // 29ft, on a shorter plinth. At 24 they were about one and a half times the height of
    // the letter band below them, and the photograph is nearer two and a half: from the
    // street the pair have to read as the biggest thing on the block, and a figure that
    // merely stands on a sign reads as a weathervane.
    const figure = bondStatue({ height: 29, mirrored: side < 0, seed: seed + (side > 0 ? 3 : 9) });
    figure.position.set(side * statueX, SIGN_TOP + 5.45, halfD - 5);
    // Turned a few degrees inward, toward each other and toward the street below.
    figure.rotation.y = side * -0.18;
    g.add(figure);
  }

  // The illuminated disc between them. Circular signs are drawn on a square canvas and
  // masked, not "drawn round" -- ring text is set by rotating the context about the
  // centre, one glyph at a time.
  const discTexture = canvasTexture(768, 768, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    // A LIT disc, not a dark one. Painted at the navy of the letter board it read as a
    // hole punched in the sky between the statues; the whole reason this thing is in the
    // photograph is that it glows.
    ctx.fillStyle = '#1c4b86';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f3e4b4';
    ctx.lineWidth = 9;
    for (const r of [w * 0.47, w * 0.335, w * 0.30]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const ring = (text, radius, size, color) => {
      const chars = [...text];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = color;
      ctx.font = SANS(size);
      ctx.textAlign = 'center';
      const step = (Math.PI * 2) / chars.length;
      chars.forEach((ch, i) => {
        ctx.save();
        ctx.rotate(i * step - Math.PI / 2 + step / 2);
        ctx.translate(0, -radius);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    };
    ring('★ BOND · CLOTHES · FOR · MEN · AND · WOMEN ', w * 0.40, 46, '#ffd766');

    ctx.fillStyle = '#fdfaf0';
    fitText(ctx, '1899', cx, cy + h * 0.05, w * 0.5, h * 0.3, SANS);
    ctx.fillStyle = '#d8e6f7';
    fitText(ctx, 'ESTABLISHED', cx, cy - h * 0.12, w * 0.36, h * 0.06, SANS_LIGHT);
    fitText(ctx, 'FIFTH  AVENUE  ·  BROADWAY', cx, cy + h * 0.18, w * 0.44, h * 0.05, SANS_LIGHT);

    // Painted bulbs round the rim, same reasoning as bulbBorder.
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const r = w * 0.435;
      ctx.fillStyle = 'rgba(255,220,150,0.4)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffeec2';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const discR = 9;
  const disc = group();
  disc.add(cyl(discR, discR, 1.6, standard({ color: 0x22303f, roughness: 0.7, metalness: 0.4 }), 0, 0, 0, 40).rotateX(Math.PI / 2));
  const discFace = mesh(
    new THREE.CircleGeometry(discR - 0.15, 44),
    standard({ map: discTexture, emissive: new THREE.Color(0xffffff), emissiveMap: discTexture, emissiveIntensity: 1.25, roughness: 0.5 })
  );
  discFace.position.z = 0.86;
  disc.add(discFace);
  disc.position.set(0, SIGN_TOP + 13.5, halfD - 4.2);
  g.add(disc);

  return g;
}

// ---------------------------------------------------------------------------
// Other theatres, storefronts and street furniture
// ---------------------------------------------------------------------------

// A generic period movie house: a plain masonry front with a lit marquee and a blade.
// This is what "HOME OF THE BRAVE" and the Criterion are built from -- the same objects
// the hero theatre uses, without the classical base, the poster boards or the banner.
export function theatreFront({
  width = 40,
  depth = 26,
  height = 46,
  wallColor = 0xa08a6e,
  marqueeLines = [{ text: 'NOW SHOWING', size: 0.3, color: '#f7f1de', font: SANS }],
  marqueeFace = '#a8202b',
  bladeText = '',
  bladeFace = '#123a6b',
  bladeHeight = 20,
  seed = 19,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfD = depth / 2;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(width, height, depth), position: [0, height / 2, 0], color: wallColor });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, 12, depth + 0.6), position: [0, 6, 0], color: 0x3f382f });
  parts.push({ geometry: new THREE.BoxGeometry(13, 9.5, 2.6), position: [0, 4.75, halfD - 1.1], color: 0x14110e });
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.4, 8.6, 0.5),
      position: [-6.5 + 1.3 + i * 3.3, 4.3, halfD + 0.05],
      color: 0xa08040,
    });
  }
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.82,
    yStart: 24, floors: Math.max(1, Math.floor((height - 30) / 8.6)), floorHeight: 8.6,
    bays: Math.max(3, Math.round(width / 8)), rng,
  });
  parts.push({ geometry: new THREE.BoxGeometry(width + 2.2, 1.6, depth + 2.2), position: [0, height - 2.4, 0], color: STONE_LIGHT });

  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 6 }) }));

  const box1 = marquee({
    width: width - 6,
    projection: 8.5,
    faceHeight: 5.6,
    atY: 11.5,
    face: marqueeFace,
    lines: marqueeLines,
  });
  box1.position.z = halfD;
  g.add(box1);

  if (bladeText) {
    const blade = bladeSign({ text: bladeText, height: bladeHeight, projection: 4.6, face: bladeFace, atY: 20 });
    blade.position.set(-width / 2 + 4.6, 0, halfD);
    g.add(blade);
  }
  return g;
}

// A run of low shops with canvas awnings, for the block ends. Authored facing +Z.
export function storefrontRow({
  length = 44,
  depth = 20,
  height = 22,
  shops = ['DRUGS', 'HABERDASHER', 'LUNCHEONETTE'],
  wallColor = 0x9a7f63,
  seed = 33,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfD = depth / 2;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(length, height, depth), position: [0, height / 2, 0], color: wallColor });
  parts.push({ geometry: new THREE.BoxGeometry(length + 1.6, 1.4, depth + 1.6), position: [0, height - 1.6, 0], color: STONE_LIGHT });
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: length * 0.84,
    yStart: 13, floors: 1, floorHeight: 7.5, bays: shops.length * 2, rng, winW: 2.6, winH: 4.2,
  });

  const bayWidth = length / shops.length;
  for (let i = 0; i < shops.length; i++) {
    const x = -length / 2 + bayWidth * (i + 0.5);
    parts.push({ geometry: new THREE.BoxGeometry(bayWidth * 0.9, 9, 0.6), position: [x, 5.2, halfD + 0.3], color: 0x2f3d47 });
    parts.push({ geometry: new THREE.BoxGeometry(bayWidth * 0.94, 0.6, 0.8), position: [x, 10.1, halfD + 0.4], color: 0x3a3128 });
  }
  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed: seed + 1, repeat: 6 }) }));

  // Awnings, striped, sloping down toward the street. Every one of these fronts in the
  // photograph has one out, and the stripe is what identifies the period.
  const awningColors = ['#7d2f2f', '#2f5d7d', '#3f6b3f', '#7d6a2f'];
  for (let i = 0; i < shops.length; i++) {
    const x = -length / 2 + bayWidth * (i + 0.5);
    const tint = awningColors[Math.floor(rng() * awningColors.length)];
    const stripe = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f2ead6';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = tint;
      for (let s = 0; s < 8; s += 2) ctx.fillRect((w / 8) * s, 0, w / 8, h);
    });
    // 5ft of reach, not the 6.4 this started at. A sidewalk here is only 10ft wide, and an
    // awning that covers half of it puts a canvas ceiling over the one place a student is
    // most likely to be standing -- they arrive looking at the underside of it rather than
    // at the street.
    const canopy = mesh(
      new THREE.BoxGeometry(bayWidth * 0.86, 0.25, 5.0),
      standard({ map: stripe, roughness: 0.95, side: THREE.DoubleSide })
    );
    canopy.position.set(x, 10.9, halfD + 2.5);
    canopy.rotation.x = 0.22;
    g.add(canopy);

    const sign = wallSign({
      width: bayWidth * 0.8,
      height: 2.2,
      face: '#1d2b3f',
      bulbs: false,
      lines: [{ text: shops[i], size: 0.5, color: '#f0c86a', font: SANS }],
      emissiveIntensity: 0.5,
    });
    sign.position.set(x, 12.6, halfD + 0.5);
    g.add(sign);
  }
  return g;
}

// Post-mounted traffic signal, three lenses in a dark cast housing.
export function trafficSignal({ height = 13, seed = 12 } = {}) {
  const g = group();
  const iron = 0x2a2f31;
  const parts = [
    { geometry: new THREE.CylinderGeometry(0.62, 0.78, 0.5, 12), position: [0, 0.25, 0], color: iron },
    { geometry: new THREE.CylinderGeometry(0.22, 0.34, height, 12), position: [0, height / 2 + 0.4, 0], color: iron },
    { geometry: new THREE.BoxGeometry(1.5, 4.0, 1.3), position: [0, height + 1.6, 0], color: iron },
    { geometry: new THREE.BoxGeometry(1.9, 0.35, 1.7), position: [0, height + 3.75, 0], color: iron },
  ];
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.5, ...relief('metal', { seed, repeat: 3 }) }));

  const lens = (color, y, lit) =>
    mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.22, 14),
      standard({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: lit ? 2.4 : 0.12,
        roughness: 0.35,
      }),
      0,
      y,
      0.7
    );
  for (const [color, dy, lit] of [[0xd83a2a, 1.2, true], [0xe0a52c, 0, false], [0x39b862, -1.2, false]]) {
    const l = lens(color, height + 1.6 + dy, lit);
    l.rotation.x = Math.PI / 2;
    if (lit) l.userData.isGlowMesh = true;
    g.add(l);
  }
  return g;
}

// A curbside street-name blade plus a regulatory sign on the same post.
export function streetSign({ street = 'W 45 ST', notice = 'NO STANDING', height = 9 } = {}) {
  const g = group();
  const iron = standard({ color: 0x33383a, roughness: 0.6, metalness: 0.5 });
  g.add(cyl(0.13, 0.19, height, iron, 0, height / 2, 0, 10));

  const nameTexture = signTexture({
    width: 512,
    height: 128,
    face: '#1d4a2e',
    bulbs: false,
    lines: [{ text: street, size: 0.52, color: '#f4f1e6', font: SANS }],
  });
  const blade = signPanel(4.4, 1.1, nameTexture);
  blade.position.set(0, height - 0.8, 0.03);
  g.add(blade);

  if (notice) {
    const noticeTexture = signTexture({
      width: 320,
      height: 400,
      face: '#f2efe4',
      bulbs: false,
      lines: [
        { text: notice.split(' ')[0], size: 0.19, color: '#8c1c22', font: SANS },
        { text: notice.split(' ').slice(1).join(' '), size: 0.19, color: '#8c1c22', font: SANS },
      ],
    });
    const plate = signPanel(1.5, 1.9, noticeTexture);
    plate.position.set(0, height - 3.2, 0.03);
    g.add(plate);
  }
  return g;
}

export function fireHydrant({ color = 0x9c3226 } = {}) {
  const parts = [
    { geometry: new THREE.CylinderGeometry(0.62, 0.72, 0.28, 14), position: [0, 0.14, 0], color: 0x3f3a33 },
    { geometry: new THREE.CylinderGeometry(0.42, 0.5, 1.9, 14), position: [0, 1.2, 0], color },
    { geometry: new THREE.CylinderGeometry(0.5, 0.42, 0.18, 14), position: [0, 2.22, 0], color },
    { geometry: new THREE.SphereGeometry(0.42, 14, 10), position: [0, 2.45, 0], color },
    { geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.55, 10), rotation: [0, 0, Math.PI / 2], position: [0.44, 1.6, 0], color },
    { geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.55, 10), rotation: [Math.PI / 2, 0, 0], position: [0, 1.6, 0.44], color },
  ];
  return group(mergedMesh(parts, { roughness: 0.75, metalness: 0.2, ...relief('metal', { seed: 44, repeat: 2 }) }));
}

// A corner newsstand: a green board kiosk stacked with papers and magazines.
export function newsstand({ seed = 55 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const wood = standard({ color: 0x2f5340, roughness: 0.9, ...relief('wood', { seed, repeat: 4 }) });
  const parts = [];
  const W = 8;
  const D = 5;
  const H = 8;

  parts.push({ geometry: new THREE.BoxGeometry(W, 0.3, D), position: [0, 0.15, 0], color: 0x2f5340 });
  parts.push({ geometry: new THREE.BoxGeometry(W, H, 0.35), position: [0, H / 2, -D / 2], color: 0x2f5340 });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.35, H, D), position: [side * (W / 2), H / 2, 0], color: 0x2f5340 });
  }
  parts.push({ geometry: new THREE.BoxGeometry(W, 3.2, 0.35), position: [0, H - 1.6, D / 2], color: 0x2f5340 });
  parts.push({ geometry: new THREE.BoxGeometry(W + 2.4, 0.3, D + 2.6), position: [0, H + 0.15, 0.9], color: 0x24402f });
  parts.push({ geometry: new THREE.BoxGeometry(W, 0.35, 2.2), position: [0, 3.4, D / 2 + 0.6], color: 0x6d5c3a });
  g.add(mergedMesh(parts, { roughness: 0.9 }));
  g.add(mergedMesh([{ geometry: new THREE.BoxGeometry(W - 1, 0.3, 2), position: [0, 3.6, D / 2 + 0.6], color: 0xd8d2c0 }], { roughness: 0.95 }));

  // Papers and magazines, seeded so a reload gives back the same stand.
  const stock = [];
  for (let i = 0; i < 16; i++) {
    const x = randomIn(rng, -W / 2 + 0.9, W / 2 - 0.9);
    const y = 3.75 + Math.floor(rng() * 3) * 0.12;
    const shade = [0xd8d2c0, 0xc9c2ad, 0xdcd0a8, 0xcbb9a0][Math.floor(rng() * 4)];
    stock.push({
      geometry: new THREE.BoxGeometry(1.1, 0.09, 1.5),
      rotation: [0, randomIn(rng, -0.3, 0.3), 0],
      position: [x, y, D / 2 + randomIn(rng, 0.1, 1.1)],
      color: shade,
    });
  }
  g.add(mergedMesh(stock, { roughness: 0.95 }));

  const header = wallSign({
    width: W - 0.6,
    height: 1.8,
    face: '#1b2c1f',
    bulbs: false,
    lines: [{ text: 'NEWS  ·  CIGARS  ·  CANDY', size: 0.42, color: '#f0c86a', font: SANS }],
    emissiveIntensity: 0.45,
  });
  header.position.set(0, H - 1.6, D / 2 + 0.3);
  g.add(header);
  return g;
}

// A cast-iron subway entrance kiosk with its railing and stair mouth -- the one piece of
// street furniture that says "New York" on its own.
export function subwayEntrance({ label = 'SUBWAY', seed = 66 } = {}) {
  const g = group();
  const iron = 0x2d3134;
  const parts = [];
  const W = 9;
  const D = 7;

  // The stair opening is a dark box sunk into the sidewalk, not a hole in the ground:
  // the terrain here is a solid mesh and nothing can be cut out of it.
  parts.push({ geometry: new THREE.BoxGeometry(W - 1.6, 1.2, D - 1.6), position: [0, -0.4, 0], color: 0x0d0f11 });
  for (const [w, d, x, z] of [[W, 0.5, 0, -D / 2], [W, 0.5, 0, D / 2], [0.5, D, -W / 2, 0], [0.5, D, W / 2, 0]]) {
    parts.push({ geometry: new THREE.BoxGeometry(w, 0.5, d), position: [x, 0.25, z], color: 0x6e6a61 });
  }
  // Railing: newels, a top rail and balusters, three sides only -- the fourth is the way in.
  for (const [x, z, along] of [[0, -D / 2, 'x'], [-W / 2, 0, 'z'], [W / 2, 0, 'z']]) {
    const span = along === 'x' ? W : D;
    parts.push({
      geometry: along === 'x' ? new THREE.BoxGeometry(span, 0.18, 0.18) : new THREE.BoxGeometry(0.18, 0.18, span),
      position: [x, 3.3, z],
      color: iron,
    });
    const count = Math.round(span / 0.9);
    for (let i = 0; i <= count; i++) {
      const t = -span / 2 + (span / count) * i;
      parts.push({
        geometry: new THREE.CylinderGeometry(0.06, 0.06, 3.1, 6),
        position: along === 'x' ? [t, 1.75, z] : [x, 1.75, t],
        color: iron,
      });
    }
  }
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.34, 4.2, 0.34), position: [x, 2.1, z], color: iron });
    parts.push({ geometry: new THREE.SphereGeometry(0.26, 10, 8), position: [x, 4.3, z], color: iron });
  }
  g.add(mergedMesh(parts, { roughness: 0.65, metalness: 0.5, ...relief('metal', { seed, repeat: 3 }) }));

  // The sign rides the CLOSED back rail and faces outward (-Z), away from the stair.
  // Mounted on the open side it would hang over the way in, and facing +Z from the back
  // rail it would be readable only by somebody already standing on the steps.
  const sign = wallSign({
    width: 5.2,
    height: 1.7,
    face: '#0f2340',
    bulbs: false,
    lines: [{ text: label, size: 0.5, color: '#f4f1e6', font: SANS }],
    emissiveIntensity: 0.5,
  });
  sign.position.set(0, 5.6, -D / 2 - 0.3);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.add(cyl(0.12, 0.12, 2.6, standard({ color: iron, roughness: 0.6, metalness: 0.5 }), 0, 4.3, -D / 2 - 0.2, 8));
  return g;
}
