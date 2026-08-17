import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

// Red Square in winter: St Basil's at the south end, the Kremlin wall and Lenin's tomb
// down one side, GUM down the other, and the State History Museum closing the north.
//
// This world is very close to TRUE SIZE. St Basil's is 155ft tall and it is built at 155ft;
// the Kremlin wall is 62ft and it is 62ft. What is compressed is the SQUARE, which is
// really 1,090ft long by 230ft wide -- more than the whole world -- so the buildings are
// brought in to about 200ft apart. That is the right thing to compress: the square's
// proportions are not what anyone remembers about it, and the buildings are.
//
// The domes are the reason this world exists, and there is one fact worth building the
// whole cathedral around: THE NINE DOMES ARE ALL DIFFERENT. Different patterns, different
// colours, different sizes -- spirals, chevrons, facets. Paint them all one colour and
// it becomes an ordinary Russian church. They were not even original: the cathedral stood
// white with gold domes for a century before the colour was added.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const BRICK = 0xa8503c;
const BRICK_DARK = 0x8c4130;
const BRICK_LIGHT = 0xbe6248;
const TRIM = 0xefe9dc;
const TRIM_SHADE = 0xd8d0c0;
const GRANITE_RED = 0x7a3630;
const GRANITE_BLACK = 0x3a3634;
const GOLD = 0xd8a838;
const SNOW = 0xeef3f8;
const ROOF_GREEN = 0x2f6b4e;

// ---------------------------------------------------------------------------
// Domes
// ---------------------------------------------------------------------------

// The onion profile. Fatter and more sharply waisted than the Taj's -- a Russian onion
// bulges to well over its drum radius and then pinches into a narrow neck under the cross,
// which is what gives it the flame shape.
function onionProfile(radius, height, steps = 26) {
  const key = [
    [0.82, 0.0], [1.0, 0.10], [1.09, 0.24], [1.08, 0.38], [0.98, 0.52],
    [0.82, 0.64], [0.62, 0.75], [0.42, 0.84], [0.24, 0.91], [0.12, 0.96], [0.0, 1.0],
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

// The painted pattern on one dome, as a wrapping canvas.
//
// It MUST tile horizontally, since LatheGeometry runs u from 0 to 1 once round: any
// pattern whose left and right edges differ draws a visible seam straight down the dome.
// Every pattern here is therefore built from a whole number of repeats across the width.
function domeTexture(kind, a, b, repeats = 8) {
  return canvasTexture(384, 384, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    const step = w / repeats;
    if (kind === 'spiral') {
      // Sheared stripes. The shear is a whole multiple of the tile height, so the stripe
      // that leaves the right edge re-enters at the left in the same place.
      for (let i = 0; i < repeats; i++) {
        ctx.beginPath();
        ctx.moveTo(i * step, 0);
        ctx.lineTo(i * step + step * 0.5, 0);
        ctx.lineTo(i * step + step * 0.5 + w, h);
        ctx.lineTo(i * step + w, h);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(i * step - w, 0);
        ctx.lineTo(i * step + step * 0.5 - w, 0);
        ctx.lineTo(i * step + step * 0.5, h);
        ctx.lineTo(i * step, h);
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'chevron') {
      for (let row = 0; row < 9; row++) {
        const y = (row / 9) * h;
        const rh = h / 9;
        if (row % 2) continue;
        ctx.beginPath();
        for (let i = 0; i <= repeats * 2; i++) {
          const x = (i / (repeats * 2)) * w;
          ctx.lineTo(x, y + (i % 2 ? rh : 0));
        }
        for (let i = repeats * 2; i >= 0; i--) {
          const x = (i / (repeats * 2)) * w;
          ctx.lineTo(x, y + rh + (i % 2 ? rh : 0));
        }
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'facet') {
      // Vertical ribs with a lozenge chain between them -- the "pineapple" dome.
      for (let i = 0; i < repeats; i++) {
        ctx.fillRect(i * step, 0, step * 0.22, h);
      }
      for (let i = 0; i < repeats; i++) {
        for (let j = 0; j < 7; j++) {
          const cx = i * step + step * 0.6;
          const cy = (j + 0.5) * (h / 7);
          ctx.beginPath();
          ctx.moveTo(cx, cy - h / 20);
          ctx.lineTo(cx + step * 0.22, cy);
          ctx.lineTo(cx, cy + h / 20);
          ctx.lineTo(cx - step * 0.22, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (kind === 'ribbed') {
      for (let i = 0; i < repeats; i++) {
        ctx.fillRect(i * step, 0, step * 0.42, h);
      }
    } else if (kind === 'diamond') {
      for (let i = 0; i < repeats; i++) {
        for (let j = 0; j < 9; j++) {
          const cx = i * step + (j % 2 ? step * 0.5 : 0);
          const cy = (j + 0.5) * (h / 9);
          ctx.beginPath();
          ctx.moveTo(cx, cy - h / 18);
          ctx.lineTo(cx + step * 0.4, cy);
          ctx.lineTo(cx, cy + h / 18);
          ctx.lineTo(cx - step * 0.4, cy);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx + w, cy - h / 18);
          ctx.lineTo(cx + step * 0.4 + w, cy);
          ctx.lineTo(cx + w, cy + h / 18);
          ctx.lineTo(cx - step * 0.4 + w, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // A little vertical shading, so a dome is not uniformly bright top to bottom.
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0.22)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  });
}

// A kokoshnik: the pointed ogee gable that rings the foot of every Russian drum and steps
// up every tower. It is a FLAT PLATE standing against the wall with its point upward, and
// getting that orientation wrong is worth saying out loud -- built as a three-sided cone
// laid on its side (which is what "rotate it to face outward" produces if you are not
// thinking about it) each one becomes a horizontal spike, and a cathedral with nine domes
// grows about a hundred white thorns sticking straight out of it.
//
// So: a pyramid with its apex up, squashed to a plate in its own local Z, then swung about
// Y to sit tangent to the drum.
function kokoshnik(radius, height, color, angle, cx, cy, cz, ringR) {
  const g = new THREE.ConeGeometry(radius, height, 4);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, 0.34);
  g.applyMatrix4(new THREE.Matrix4()
    .makeTranslation(cx + Math.cos(angle) * ringR, cy + height / 2, cz + Math.sin(angle) * ringR)
    .multiply(new THREE.Matrix4().makeRotationY(-angle)));
  return { geometry: g, color };
}

// An Orthodox cross: three bars, the lowest one slanted. That slant is the giveaway --
// straighten it and the church stops being Russian.
function orthodoxCross(scale, color = GOLD) {
  const parts = [];
  parts.push({ geometry: new THREE.BoxGeometry(0.16 * scale, 3.4 * scale, 0.16 * scale), color, position: [0, 1.7 * scale, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(1.0 * scale, 0.16 * scale, 0.14 * scale), color, position: [0, 2.85 * scale, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(1.7 * scale, 0.18 * scale, 0.14 * scale), color, position: [0, 2.15 * scale, 0] });
  const slant = new THREE.BoxGeometry(1.1 * scale, 0.16 * scale, 0.14 * scale);
  slant.rotateZ(0.42);
  parts.push({ geometry: slant, color, position: [0, 0.9 * scale, 0] });
  parts.push({ geometry: new THREE.SphereGeometry(0.26 * scale, 10, 8), color, position: [0, 0.1 * scale, 0] });
  return parts;
}

// One painted dome on its drum: the drum (with its ring of arched windows), the onion, the
// lantern and the cross.
//
// The dome itself is returned as its OWN mesh rather than merged, because it is the one
// thing in the building that carries a real colour map -- and a material with both a map
// and vertexColors multiplies them, which would turn every pattern to mud.
function paintedDome(g, { x = 0, y = 0, z = 0, drumR, drumH, domeR, domeH, pattern, colorA, colorB, repeats = 8, seed = 3 }) {
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(drumR, drumR * 1.04, drumH, 24), color: BRICK, position: [x, y + drumH / 2, z] });
  // Engaged colonnettes and arched windows round the drum -- these are always there and
  // they are what keeps a 20ft drum from reading as a length of pipe.
  const cols = 12;
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(drumR * 0.07, drumR * 0.07, drumH * 0.86, 8),
      color: TRIM,
      position: [x + Math.cos(a) * drumR * 1.02, y + drumH * 0.43, z + Math.sin(a) * drumR * 1.02],
    });
    if (i % 2 === 0) {
      parts.push({
        geometry: new THREE.BoxGeometry(drumR * 0.16, drumH * 0.46, drumR * 0.16),
        color: 0x2c2622,
        position: [x + Math.cos(a + Math.PI / cols) * drumR * 1.0, y + drumH * 0.5, z + Math.sin(a + Math.PI / cols) * drumR * 1.0],
      });
    }
  }
  parts.push({ geometry: new THREE.CylinderGeometry(drumR * 1.14, drumR * 1.06, drumH * 0.1, 24), color: TRIM, position: [x, y + drumH, z] });
  // Kokoshniki: the ring of pointed gables at the foot of every drum. Purely decorative,
  // entirely characteristic.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(kokoshnik(drumR * 0.36, drumR * 0.6, TRIM_SHADE, a, x, y - drumR * 0.1, z, drumR * 0.96));
  }
  g.add(mergedMesh(parts, { roughness: 0.88, ...relief('stone', { seed, repeat: 4 }) }));

  const dome = mesh(
    new THREE.LatheGeometry(onionProfile(domeR, domeH, 30), 40),
    standard({ map: domeTexture(pattern, colorA, colorB, repeats), roughness: 0.42, metalness: 0.22 }),
  );
  dome.position.set(x, y + drumH * 1.05, z);
  g.add(dome);

  const top = [];
  top.push({ geometry: new THREE.CylinderGeometry(domeR * 0.1, domeR * 0.14, domeH * 0.14, 10), color: GOLD, position: [x, y + drumH * 1.05 + domeH, z] });
  for (const p of orthodoxCross(domeR * 0.3)) {
    p.geometry.translate(x, y + drumH * 1.05 + domeH + domeH * 0.13, z);
    top.push(p);
  }
  g.add(mergedMesh(top, { roughness: 0.35, metalness: 0.7 }));
}

// ---------------------------------------------------------------------------
// St Basil's
// ---------------------------------------------------------------------------

// The Cathedral of the Intercession on the Moat. Nine churches on one foundation: a tall
// central one under a TENT roof -- not an onion -- with eight chapels round it, four on
// the axes and four on the diagonals, each with its own dome.
//
// The plan is the design: the eight are arranged as an eight-pointed star round the ninth.
export function stBasils({ height = 155, radius = 34, seed = 5 } = {}) {
  const g = group();
  const brick = [];

  // The podium the whole thing stands on, with its stairs. The church proper starts about
  // fifteen feet up, which is why it looks like it is standing on tiptoe.
  const podiumH = height * 0.1;
  brick.push({ geometry: new THREE.CylinderGeometry(radius * 1.32, radius * 1.38, podiumH, 16), color: BRICK_DARK, position: [0, podiumH / 2, 0] });
  brick.push({ geometry: new THREE.CylinderGeometry(radius * 1.36, radius * 1.32, podiumH * 0.1, 16), color: TRIM, position: [0, podiumH, 0] });
  for (let i = 0; i < 5; i++) {
    brick.push({
      geometry: new THREE.BoxGeometry(radius * 0.5 + i * radius * 0.05, podiumH / 5, radius * 0.34),
      color: TRIM_SHADE,
      position: [0, (podiumH / 5) * (i + 0.5), radius * 1.36 + (4 - i) * radius * 0.09],
    });
  }

  // --- The central tower --------------------------------------------------
  const coreR = radius * 0.42;
  const coreH = height * 0.44;
  const core = new THREE.CylinderGeometry(coreR * 0.9, coreR, coreH, 8);
  core.rotateY(Math.PI / 8);
  brick.push({ geometry: core, color: BRICK, position: [0, podiumH + coreH / 2, 0] });
  // Pilasters on each of the eight faces.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    brick.push({
      geometry: new THREE.BoxGeometry(radius * 0.06, coreH * 0.94, radius * 0.06),
      color: TRIM,
      position: [Math.cos(a) * coreR * 0.93, podiumH + coreH * 0.47, Math.sin(a) * coreR * 0.93],
      rotation: [0, -a, 0],
    });
    // Tall recessed windows.
    brick.push({
      geometry: new THREE.BoxGeometry(radius * 0.09, coreH * 0.3, radius * 0.09),
      color: 0x2a2420,
      position: [Math.cos(a + Math.PI / 8) * coreR * 0.9, podiumH + coreH * 0.62, Math.sin(a + Math.PI / 8) * coreR * 0.9],
    });
  }
  // Three tiers of kokoshniki stepping in below the tent -- the transition that makes the
  // tower look like it is gathering itself before the spire.
  for (let tier = 0; tier < 3; tier++) {
    const r = coreR * (1 - tier * 0.11);
    const y = podiumH + coreH + tier * height * 0.028;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (tier % 2 ? Math.PI / 8 : 0);
      brick.push(kokoshnik(r * 0.42, r * 0.7, tier % 2 ? TRIM_SHADE : BRICK_LIGHT, a, 0, y, 0, r * 0.92));
    }
  }

  // The tent (shatyor). Eight-sided, steep, and it is NOT an onion: this is the one
  // feature that distinguishes the central church from the eight around it.
  const tentBase = podiumH + coreH + height * 0.09;
  const tentH = height * 0.28;
  const tentR = coreR * 0.82;
  const tent = new THREE.ConeGeometry(tentR, tentH, 8);
  brick.push({ geometry: tent, color: BRICK_DARK, position: [0, tentBase + tentH / 2, 0] });
  // Ribs down the eight arrises, and the small dormers set into the slope.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const rib = new THREE.BoxGeometry(radius * 0.045, tentH * 1.02, radius * 0.05);
    rib.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * tentR * 0.47, tentBase + tentH / 2, Math.sin(a) * tentR * 0.47)
      .multiply(new THREE.Matrix4().makeRotationY(-a))
      .multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(tentR, tentH))));
    brick.push({ geometry: rib, color: TRIM });
    brick.push({
      geometry: new THREE.BoxGeometry(radius * 0.07, radius * 0.1, radius * 0.07),
      color: TRIM,
      position: [Math.cos(a + Math.PI / 8) * tentR * 0.62, tentBase + tentH * 0.28, Math.sin(a + Math.PI / 8) * tentR * 0.62],
    });
  }
  g.add(mergedMesh(brick, { roughness: 0.9, ...relief('stone', { seed, repeat: 6 }) }));

  // The small gold dome that finishes the tent.
  paintedDome(g, {
    x: 0, y: tentBase + tentH, z: 0,
    drumR: radius * 0.11, drumH: height * 0.045,
    domeR: radius * 0.14, domeH: height * 0.07,
    pattern: 'ribbed', colorA: '#d8a838', colorB: '#f0cd6a', repeats: 10, seed: seed + 1,
  });

  // --- The eight chapels --------------------------------------------------
  // Four big ones on the axes, four smaller between them, and every dome different. The
  // table below is the whole personality of the building, so it is written out in full
  // rather than generated -- a loop that varied hue by index would give eight domes that
  // are obviously the same dome eight times.
  const chapels = [
    { a: 0.00, big: true, pattern: 'spiral', colorA: '#2f7a4e', colorB: '#e8e2d2', repeats: 8 },
    { a: 0.25, big: true, pattern: 'facet', colorA: '#c8452f', colorB: '#e8e2d2', repeats: 9 },
    { a: 0.50, big: true, pattern: 'chevron', colorA: '#2e5fa8', colorB: '#e8e2d2', repeats: 8 },
    { a: 0.75, big: true, pattern: 'diamond', colorA: '#3f8a5c', colorB: '#d8a838', repeats: 7 },
    { a: 0.125, big: false, pattern: 'spiral', colorA: '#d8a838', colorB: '#8c3f2c', repeats: 7 },
    { a: 0.375, big: false, pattern: 'ribbed', colorA: '#e8e2d2', colorB: '#2e5fa8', repeats: 12 },
    { a: 0.625, big: false, pattern: 'chevron', colorA: '#d8a838', colorB: '#2f7a4e', repeats: 7 },
    { a: 0.875, big: false, pattern: 'facet', colorA: '#8c3f2c', colorB: '#d8b85a', repeats: 8 },
  ];

  const towers = [];
  for (const c of chapels) {
    const ang = c.a * Math.PI * 2 + Math.PI / 8;
    const dist = c.big ? radius * 0.86 : radius * 0.92;
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const tR = c.big ? radius * 0.26 : radius * 0.19;
    const tH = c.big ? height * 0.42 : height * 0.31;

    const body = new THREE.CylinderGeometry(tR * 0.94, tR, tH, 8);
    body.rotateY(Math.PI / 8);
    towers.push({ geometry: body, color: BRICK, position: [x, podiumH + tH / 2, z] });
    for (let i = 0; i < 8; i++) {
      const a2 = (i / 8) * Math.PI * 2;
      towers.push({
        geometry: new THREE.BoxGeometry(tR * 0.13, tH * 0.92, tR * 0.13),
        color: TRIM,
        position: [x + Math.cos(a2) * tR * 0.93, podiumH + tH * 0.46, z + Math.sin(a2) * tR * 0.93],
        rotation: [0, -a2, 0],
      });
      if (i % 2 === 0) {
        towers.push({
          geometry: new THREE.BoxGeometry(tR * 0.16, tH * 0.2, tR * 0.16),
          color: 0x2a2420,
          position: [x + Math.cos(a2 + Math.PI / 8) * tR * 0.9, podiumH + tH * 0.6, z + Math.sin(a2 + Math.PI / 8) * tR * 0.9],
        });
      }
    }
    // Two tiers of kokoshniki under each chapel's drum.
    for (let tier = 0; tier < 2; tier++) {
      const r = tR * (1 - tier * 0.14);
      const y = podiumH + tH + tier * height * 0.022;
      for (let i = 0; i < 8; i++) {
        const a2 = (i / 8) * Math.PI * 2 + (tier % 2 ? Math.PI / 8 : 0);
        towers.push(kokoshnik(r * 0.44, r * 0.72, tier % 2 ? BRICK_LIGHT : TRIM_SHADE, a2, x, y, z, r * 0.9));
      }
    }

    paintedDome(g, {
      x, y: podiumH + tH + height * 0.05, z,
      drumR: tR * 0.62, drumH: c.big ? height * 0.1 : height * 0.075,
      domeR: tR * 0.86, domeH: c.big ? height * 0.17 : height * 0.13,
      pattern: c.pattern, colorA: c.colorA, colorB: c.colorB, repeats: c.repeats, seed: seed + 7,
    });
  }
  g.add(mergedMesh(towers, { roughness: 0.9, ...relief('stone', { seed: seed + 2, repeat: 5 }) }));

  // The gallery that ties the nine together at podium level, and the covered porch.
  const gallery = [];
  gallery.push({ geometry: new THREE.CylinderGeometry(radius * 1.18, radius * 1.2, height * 0.11, 16), color: BRICK_LIGHT, position: [0, podiumH + height * 0.055, 0] });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    gallery.push({
      geometry: new THREE.BoxGeometry(radius * 0.09, height * 0.1, radius * 0.09),
      color: TRIM,
      position: [Math.cos(a) * radius * 1.19, podiumH + height * 0.055, Math.sin(a) * radius * 1.19],
      rotation: [0, -a, 0],
    });
  }
  gallery.push({ geometry: new THREE.CylinderGeometry(radius * 1.24, radius * 1.18, height * 0.02, 16), color: TRIM, position: [0, podiumH + height * 0.115, 0] });
  // The tent-roofed porch over the main stair. It needs something UNDER it: as a cone on
  // its own it was a green witch's hat floating forty feet up in front of the cathedral,
  // and it was half again the size it should be.
  const porchR = radius * 0.19;
  gallery.push({ geometry: new THREE.CylinderGeometry(porchR * 1.1, porchR * 1.15, height * 0.075, 8), color: BRICK_LIGHT, position: [0, podiumH + height * 0.155, radius * 1.32] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    gallery.push({
      geometry: new THREE.BoxGeometry(radius * 0.05, height * 0.07, radius * 0.05),
      color: TRIM,
      position: [Math.cos(a) * porchR * 1.1, podiumH + height * 0.155, radius * 1.32 + Math.sin(a) * porchR * 1.1],
      rotation: [0, -a, 0],
    });
  }
  gallery.push({ geometry: new THREE.ConeGeometry(porchR * 1.3, height * 0.1, 8), color: ROOF_GREEN, position: [0, podiumH + height * 0.242, radius * 1.32] });
  gallery.push({ geometry: new THREE.SphereGeometry(radius * 0.045, 10, 8), color: GOLD, position: [0, podiumH + height * 0.3, radius * 1.32] });
  g.add(mergedMesh(gallery, { roughness: 0.88, ...relief('stone', { seed: seed + 3, repeat: 5 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The Kremlin
// ---------------------------------------------------------------------------

// A run of the Kremlin wall. The merlons are SWALLOWTAILS -- a two-pronged M -- and that
// is not decoration, it is an import: the Milanese architects who built this wall in the
// 1490s brought the profile from the Ghibelline castles of northern Italy.
export function kremlinWall({ length = 90, height = 26, depth = 12, merlons = true, seed = 7 } = {}) {
  const parts = [];
  const bodyH = height * 0.8;
  parts.push({ geometry: new THREE.BoxGeometry(length, bodyH, depth), color: BRICK, position: [0, bodyH / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(length, height * 0.03, depth * 1.06), color: BRICK_DARK, position: [0, bodyH * 0.86, 0] });
  // Blind arcading down the face, which every stretch of this wall carries.
  const bays = Math.max(3, Math.round(length / 11));
  for (let i = 0; i < bays; i++) {
    const x = (i - (bays - 1) / 2) * (length / bays);
    parts.push({ geometry: new THREE.BoxGeometry(length / bays * 0.66, bodyH * 0.5, depth * 0.1), color: BRICK_DARK, position: [x, bodyH * 0.42, depth * 0.5] });
  }
  if (merlons) {
    const count = Math.max(4, Math.round(length / 7.5));
    const w = (length / count) * 0.68;
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * (length / count);
      const mh = height * 0.2;
      parts.push({ geometry: new THREE.BoxGeometry(w, mh * 0.55, depth * 0.4), color: BRICK, position: [x, bodyH + mh * 0.275, 0] });
      // The two prongs, with the V between them. Without the notch it is a battlement,
      // not a swallowtail.
      for (const side of [-1, 1]) {
        parts.push({ geometry: new THREE.BoxGeometry(w * 0.36, mh * 0.55, depth * 0.4), color: BRICK, position: [x + side * w * 0.32, bodyH + mh * 0.82, 0] });
      }
      parts.push({ geometry: new THREE.BoxGeometry(w * 1.02, height * 0.012, depth * 0.44), color: TRIM_SHADE, position: [x, bodyH + mh * 1.11, 0] });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed, repeat: 6 }) }));
}

// The Spasskaya Tower: the gate tower on the square, with the clock and, since 1937, a
// ruby star on top where a double-headed imperial eagle used to be.
//
// The star is real glass, three feet across, lit from inside, and it turns in the wind.
export function kremlinTower({
  height = 130, base = 18, clock = true, star = true, spire = true, seed = 11,
} = {}) {
  const g = group();
  const parts = [];
  const bodyH = height * 0.44;

  parts.push({ geometry: new THREE.BoxGeometry(base * 1.16, height * 0.03, base * 1.16), color: TRIM_SHADE, position: [0, height * 0.015, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(base, bodyH, base), color: BRICK, position: [0, bodyH / 2, 0] });
  // The gate arch through the base.
  parts.push({ geometry: new THREE.BoxGeometry(base * 0.38, bodyH * 0.44, base * 1.02), color: 0x241f1c, position: [0, bodyH * 0.22, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(base * 0.19, base * 0.19, base * 1.02, 12, 1, false, 0, Math.PI), color: 0x241f1c, position: [0, bodyH * 0.44, 0], rotation: [Math.PI / 2, 0, 0] });
  // Corner pilasters and a white string course, which is what makes it Kremlin brick and
  // not a factory chimney.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(base * 0.1, bodyH * 0.96, base * 0.1), color: TRIM, position: [sx * base * 0.48, bodyH * 0.48, sz * base * 0.48] });
    }
  }
  parts.push({ geometry: new THREE.BoxGeometry(base * 1.08, height * 0.018, base * 1.08), color: TRIM, position: [0, bodyH * 0.62, 0] });

  // The white gothic upper stage that carries the clock -- an eighteenth-century addition
  // in a completely different style from the tower under it, which is exactly how it looks.
  const upperH = height * 0.2;
  parts.push({ geometry: new THREE.BoxGeometry(base * 0.94, upperH, base * 0.94), color: TRIM, position: [0, bodyH + upperH / 2, 0] });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    // Pinnacles at each corner of the stage.
    parts.push({
      geometry: new THREE.ConeGeometry(base * 0.09, upperH * 0.5, 4),
      color: TRIM_SHADE,
      position: [Math.cos(a + Math.PI / 4) * base * 0.66, bodyH + upperH * 1.1, Math.sin(a + Math.PI / 4) * base * 0.66],
    });
  }
  parts.push({ geometry: new THREE.BoxGeometry(base * 1.0, height * 0.02, base * 1.0), color: TRIM_SHADE, position: [0, bodyH + upperH, 0] });

  // The belfry stage and the tent spire.
  const belfryH = height * 0.11;
  const oct = new THREE.CylinderGeometry(base * 0.42, base * 0.46, belfryH, 8);
  oct.rotateY(Math.PI / 8);
  parts.push({ geometry: oct, color: TRIM, position: [0, bodyH + upperH + belfryH / 2, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(base * 0.12, belfryH * 0.6, base * 0.12),
      color: 0x2a2420,
      position: [Math.cos(a) * base * 0.4, bodyH + upperH + belfryH * 0.52, Math.sin(a) * base * 0.4],
      rotation: [0, -a, 0],
    });
  }
  const spireBase = bodyH + upperH + belfryH;
  if (spire) {
    const spireH = height * 0.19;
    parts.push({ geometry: new THREE.ConeGeometry(base * 0.42, spireH, 8), color: ROOF_GREEN, position: [0, spireBase + spireH / 2, 0] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = new THREE.BoxGeometry(base * 0.035, spireH * 1.01, base * 0.04);
      rib.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(Math.cos(a) * base * 0.21, spireBase + spireH / 2, Math.sin(a) * base * 0.21)
        .multiply(new THREE.Matrix4().makeRotationY(-a))
        .multiply(new THREE.Matrix4().makeRotationX(-Math.atan2(base * 0.42, spireH))));
      parts.push({ geometry: rib, color: TRIM_SHADE });
    }
    parts.push({ geometry: new THREE.CylinderGeometry(base * 0.05, base * 0.08, height * 0.05, 8), color: GOLD, position: [0, spireBase + spireH + height * 0.025, 0] });
  }

  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 6 }) }));

  if (clock) {
    // Four faces, one on each side, because the clock is on all four and a student walks
    // round it. Roman numerals, gold on black -- and the real one is 20ft across.
    const face = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1a1714';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d8a838';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#d8a838';
      ctx.font = 'bold 22px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const nums = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
      nums.forEach((n, i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        ctx.fillText(n, w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * h * 0.36);
      });
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + 42, h / 2 - 56);
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 - 20, h / 2 + 66);
      ctx.stroke();
    });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const dial = mesh(new THREE.CircleGeometry(base * 0.34, 32), standard({ map: face, roughness: 0.5, emissive: 0x2a2010, emissiveMap: face, emissiveIntensity: 0.4 }));
      dial.position.set(Math.sin(a) * base * 0.48, bodyH + upperH * 0.52, Math.cos(a) * base * 0.48);
      dial.rotation.y = a;
      g.add(dial);
    }
  }

  if (star) {
    // A five-pointed star, built as ten triangles round a hub so it has real points rather
    // than being a decal. Emissive and unlit-looking, because it is lit from inside.
    const starParts = [];
    const R = base * 0.3;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const point = new THREE.ConeGeometry(R * 0.34, R, 4);
      point.rotateX(Math.PI / 2);
      point.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0)
        .multiply(new THREE.Matrix4().makeRotationZ(a - Math.PI / 2)));
      starParts.push({ geometry: point, color: 0xd8202a });
    }
    starParts.push({ geometry: new THREE.SphereGeometry(R * 0.3, 10, 8), color: 0xe83a44 });
    const starMesh = mergedMesh(starParts, {
      roughness: 0.3, emissive: 0xc01820, emissiveIntensity: 1.5, vertexColors: true,
    });
    starMesh.position.set(0, spireBase + height * 0.19 + height * 0.075, 0);
    starMesh.castShadow = false;
    g.add(starMesh);
    // A point light, so the star actually throws colour onto the spire under it.
    const glow = new THREE.PointLight(0xff3b44, 6, 34, 2);
    glow.position.set(0, spireBase + height * 0.19 + height * 0.075, 0);
    g.add(glow);
  }
  return g;
}

// Lenin's mausoleum: a stepped pyramid in red and black granite, small and very heavy.
// The stone was chosen for what it does under a grey sky -- polished labradorite in the
// bands, which is nearly black and flashes blue when the light catches it.
export function leninMausoleum({ width = 40, height = 24, depth = 30, seed = 13 } = {}) {
  const g = group();
  const parts = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const w = width * (1 - t * 0.52);
    const d = depth * (1 - t * 0.42);
    const h = height * (i === 0 ? 0.32 : 0.17);
    const y = i === 0 ? h / 2 : height * (0.32 + (i - 1) * 0.17) + h / 2;
    parts.push({ geometry: new THREE.BoxGeometry(w, h, d), color: i % 2 ? GRANITE_BLACK : GRANITE_RED, position: [0, y, 0] });
    parts.push({ geometry: new THREE.BoxGeometry(w * 1.03, height * 0.012, d * 1.03), color: 0x241f1e, position: [0, y + h / 2, 0] });
  }
  // The doorway and the black granite portal round it.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.22, height * 0.26, depth * 0.06), color: GRANITE_BLACK, position: [0, height * 0.13, depth * 0.5] });
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.15, height * 0.2, depth * 0.05), color: 0x141210, position: [0, height * 0.1, depth * 0.52] });
  // The reviewing stands either side, where the Politburo stood to watch the parades.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(width * 0.34, height * 0.2, depth * 0.5), color: GRANITE_RED, position: [side * width * 0.62, height * 0.1, 0] });
  }
  g.add(mergedMesh(parts, { roughness: 0.34, metalness: 0.14, ...relief('stone', { seed, repeat: 3 }) }));

  // The name, in the one place it appears, in Cyrillic.
  const tex = canvasTexture(384, 128, (ctx, w, h) => {
    ctx.fillStyle = '#1c1a19';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c8b98a';
    ctx.font = 'bold 62px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ЛЕНИН', w / 2, h / 2 + 4);
  });
  const sign = signPanel(width * 0.3, height * 0.1, tex);
  sign.position.set(0, height * 0.36, depth * 0.5 * (1 - 0.17) + 0.2);
  g.add(sign);
  return g;
}

// GUM: the department store down the east side. Built in 1893 as a glass-roofed shopping
// arcade, and its facade is an enormous run of arched bays with two turrets and a curved
// central gable -- which is the only part anyone can draw from memory, so it is the part
// that has to be right.
export function gumStore({ length = 190, height = 46, depth = 34, seed = 17 } = {}) {
  const g = group();
  const parts = [];
  const bodyH = height * 0.78;
  parts.push({ geometry: new THREE.BoxGeometry(length, bodyH, depth), color: 0xd8cdb8, position: [0, bodyH / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(length * 1.005, height * 0.05, depth * 1.02), color: 0xc0b49c, position: [0, height * 0.13, 0] });

  const bays = Math.round(length / 12);
  for (let i = 0; i < bays; i++) {
    const x = (i - (bays - 1) / 2) * (length / bays);
    const bw = (length / bays) * 0.7;
    // Ground floor: a big arched shop window in every bay.
    parts.push({ geometry: new THREE.BoxGeometry(bw, bodyH * 0.24, depth * 0.06), color: 0x2f3a44, position: [x, bodyH * 0.16, depth * 0.5] });
    parts.push({ geometry: new THREE.CylinderGeometry(bw / 2, bw / 2, depth * 0.06, 14, 1, false, 0, Math.PI), color: 0x2f3a44, position: [x, bodyH * 0.28, depth * 0.5], rotation: [Math.PI / 2, 0, 0] });
    // Upper storeys: paired windows under a shared arch.
    for (let lv = 1; lv <= 2; lv++) {
      parts.push({ geometry: new THREE.BoxGeometry(bw * 0.66, bodyH * 0.17, depth * 0.05), color: 0x38424c, position: [x, bodyH * (0.16 + lv * 0.26), depth * 0.5] });
      parts.push({ geometry: new THREE.BoxGeometry(bw * 0.9, bodyH * 0.03, depth * 0.07), color: 0xefe6d2, position: [x, bodyH * (0.05 + lv * 0.26), depth * 0.51] });
    }
    parts.push({ geometry: new THREE.BoxGeometry(bw * 0.16, bodyH * 0.62, depth * 0.05), color: 0xefe6d2, position: [x + (length / bays) * 0.5, bodyH * 0.44, depth * 0.5] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(length * 1.01, height * 0.045, depth * 1.03), color: 0xefe6d2, position: [0, bodyH, 0] });

  // The central gable: a wide curved pediment carrying the clock and the name.
  const gW = length * 0.19;
  parts.push({ geometry: new THREE.BoxGeometry(gW, height * 0.16, depth * 0.12), color: 0xe4dac4, position: [0, bodyH + height * 0.08, depth * 0.48] });
  parts.push({ geometry: new THREE.CylinderGeometry(gW / 2, gW / 2, depth * 0.12, 20, 1, false, 0, Math.PI), color: 0xe4dac4, position: [0, bodyH + height * 0.16, depth * 0.48], rotation: [Math.PI / 2, 0, 0] });
  // Two turrets, one at each end of the run.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(length * 0.055, height * 0.13, depth * 0.2), color: 0xe4dac4, position: [side * length * 0.42, bodyH + height * 0.065, depth * 0.44] });
    parts.push({ geometry: new THREE.ConeGeometry(length * 0.042, height * 0.2, 4), color: ROOF_GREEN, position: [side * length * 0.42, bodyH + height * 0.23, depth * 0.44], rotation: [0, Math.PI / 4, 0] });
    parts.push({ geometry: new THREE.CylinderGeometry(0.2, 0.2, height * 0.09, 6), color: GOLD, position: [side * length * 0.42, bodyH + height * 0.375, depth * 0.44] });
  }
  // The glazed barrel roof over the arcades behind, which is what the building is famous
  // for on the inside.
  for (let i = -1; i <= 1; i++) {
    const roof = new THREE.CylinderGeometry(depth * 0.15, depth * 0.15, length * 0.92, 16, 1, true, 0, Math.PI);
    roof.rotateZ(Math.PI / 2);
    parts.push({ geometry: roof, color: 0x9fb4bc, position: [0, bodyH + height * 0.02, i * depth * 0.3] });
  }
  g.add(mergedMesh(parts, { roughness: 0.82, ...relief('stone', { seed, repeat: 7 }) }));

  const tex = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#e4dac4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8c3f2c';
    ctx.font = 'bold 74px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ГУМ', w / 2, h / 2 + 4);
  });
  const sign = signPanel(gW * 0.44, height * 0.09, tex);
  sign.position.set(0, bodyH + height * 0.085, depth * 0.545);
  g.add(sign);
  return g;
}

// The State History Museum: dark red brick, and a forest of tented turrets. It closes the
// north end of the square, and it is the reason the square is red-walled at both ends.
export function historyMuseum({ length = 120, height = 62, depth = 40, seed = 19 } = {}) {
  const g = group();
  const parts = [];
  const bodyH = height * 0.6;
  parts.push({ geometry: new THREE.BoxGeometry(length, bodyH, depth), color: BRICK_DARK, position: [0, bodyH / 2, 0] });
  const bays = Math.round(length / 10);
  for (let i = 0; i < bays; i++) {
    const x = (i - (bays - 1) / 2) * (length / bays);
    for (let lv = 0; lv < 2; lv++) {
      parts.push({ geometry: new THREE.BoxGeometry((length / bays) * 0.4, bodyH * 0.22, depth * 0.05), color: 0x2e2622, position: [x, bodyH * (0.2 + lv * 0.36), depth * 0.5] });
      parts.push({ geometry: new THREE.BoxGeometry((length / bays) * 0.52, bodyH * 0.03, depth * 0.07), color: TRIM_SHADE, position: [x, bodyH * (0.33 + lv * 0.36), depth * 0.51] });
    }
    parts.push({ geometry: new THREE.BoxGeometry((length / bays) * 0.12, bodyH * 0.9, depth * 0.04), color: BRICK, position: [x + (length / bays) * 0.5, bodyH * 0.45, depth * 0.5] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(length * 1.01, height * 0.035, depth * 1.02), color: TRIM_SHADE, position: [0, bodyH, 0] });

  // The turrets. Two big ones on the corners of the front, four small along the roofline,
  // all with tented caps -- the massed spires are the whole silhouette.
  const spires = [
    [-length * 0.44, depth * 0.4, 1.0], [length * 0.44, depth * 0.4, 1.0],
    [-length * 0.2, depth * 0.36, 0.62], [length * 0.2, depth * 0.36, 0.62],
    [0, depth * 0.4, 0.82], [-length * 0.44, -depth * 0.4, 0.7], [length * 0.44, -depth * 0.4, 0.7],
  ];
  for (const [x, z, s] of spires) {
    const tw = length * 0.055 * s;
    const th = height * 0.16 * s;
    parts.push({ geometry: new THREE.BoxGeometry(tw * 1.6, th, tw * 1.6), color: BRICK_DARK, position: [x, bodyH + th / 2, z] });
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      parts.push({ geometry: new THREE.ConeGeometry(tw * 0.3, th * 0.7, 4), color: BRICK, position: [x + Math.cos(a) * tw * 0.9, bodyH + th * 1.2, z + Math.sin(a) * tw * 0.9] });
    }
    parts.push({ geometry: new THREE.ConeGeometry(tw * 1.05, height * 0.24 * s, 8), color: BRICK_DARK, position: [x, bodyH + th + height * 0.12 * s, z] });
    parts.push({ geometry: new THREE.CylinderGeometry(0.16, 0.24, height * 0.05 * s, 6), color: GOLD, position: [x, bodyH + th + height * 0.24 * s + height * 0.025 * s, z] });
  }
  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed, repeat: 8 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The square itself
// ---------------------------------------------------------------------------

// The paving: setts laid in fan patterns, and it is genuinely cobbled -- the square is not
// asphalted, which is why every parade on it sounds the way it does.
export function squarePaving({ width = 60, depth = 90, snowy = true, seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const cell = 1.7;
  const cols = Math.max(2, Math.round(width / cell));
  const rows = Math.max(2, Math.round(depth / cell));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i - (cols - 1) / 2) * cell;
      const z = (j - (rows - 1) / 2) * cell;
      // Snow lies over most of it and is swept off in patches, so the tone varies by a
      // smooth function of position rather than per stone.
      //
      // Two things had to change from the first pass, and both are about CONTRAST rather
      // than about pattern. The bare setts were nearly black against a white terrain, and
      // the threshold left about half the square clear -- so the paving came out as a
      // chessboard with a black road down the middle of it. Wet granite under a winter sky
      // is a mid grey, not black, and snow that has only been walked on is mostly still
      // there. Three frequencies rather than two, so the edge of a swept patch wanders
      // instead of drawing one clean sine curve across the whole square.
      const drift = (Math.sin(x * 0.09) * Math.cos(z * 0.07) + Math.sin(x * 0.031 + z * 0.043) * 0.6) * 0.4 + 0.5;
      const snowHere = snowy && drift > 0.3;
      parts.push({
        geometry: new THREE.BoxGeometry(cell * 0.94, 0.2, cell * 0.94),
        color: snowHere ? [0xdde6ee, 0xe8eff5, 0xd2dce6][(i + j) % 3] : [0x9a938a, 0x8b847c, 0xa39c92][(i + j) % 3],
        position: [x, 0.1, z],
        rotation: [0, randomIn(rng, -0.05, 0.05), 0],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 8 }) }));
}

// A drift of ploughed snow. Low, long and soft-edged: the piles left where the square gets
// cleared, which is most of what you actually see of snow in a city.
export function snowDrift({ length = 14, height = 2.2, seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const lumps = 7;
  for (let i = 0; i < lumps; i++) {
    const t = i / (lumps - 1);
    const r = height * randomIn(rng, 0.9, 1.35) * (0.6 + Math.sin(t * Math.PI) * 0.7);
    // SphereGeometry, never Icosahedron -- non-indexed geometry is flat-shaded whatever
    // the material says, and faceted snow reads as broken polystyrene.
    const blob = new THREE.SphereGeometry(r, 12, 8);
    blob.scale(1, 0.55, 0.8);
    parts.push({
      geometry: blob,
      color: [0xeef4fa, 0xe2ebf4, 0xf6fafd][i % 3],
      position: [(t - 0.5) * length, height * 0.1, randomIn(rng, -0.6, 0.6)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.95 }));
}

// A birch in winter: white bark with black scars, and bare branches. The bark is the whole
// tree -- a birch drawn in brown is any other sapling.
export function birchTree({ height = 26, bare = true, seed = 31 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const lean = randomIn(rng, -0.04, 0.04);

  const trunk = taperedTube(
    [[0, 0, 0], [lean * height * 0.3, height * 0.35, 0], [lean * height * 0.6, height * 0.68, 0], [lean * height * 0.8, height, 0]],
    [height * 0.022, height * 0.016, height * 0.011, height * 0.005],
    { tubularSegments: 12, radialSegments: 9 },
  );
  parts.push({ geometry: trunk, color: 0xe8eaea });
  // The black scars. They are lenticels -- horizontal, in short bands, and they are what
  // makes white bark read as birch rather than as a painted pole.
  for (let i = 0; i < 16; i++) {
    const t = rng();
    parts.push({
      geometry: new THREE.CylinderGeometry(height * 0.022 * (1 - t * 0.72) + 0.01, height * 0.022 * (1 - t * 0.72) + 0.01, height * randomIn(rng, 0.008, 0.02), 9, 1, true),
      color: 0x2e2c2a,
      position: [lean * height * 0.8 * t, height * t, 0],
    });
  }
  const branches = 9;
  for (let i = 0; i < branches; i++) {
    const t = 0.4 + (i / branches) * 0.55;
    const a = rng() * Math.PI * 2;
    const reach = height * randomIn(rng, 0.12, 0.26) * (1 - t * 0.4);
    parts.push({
      geometry: taperedTube(
        [[lean * height * 0.8 * t, height * t, 0],
          [lean * height * 0.8 * t + Math.cos(a) * reach * 0.5, height * (t + 0.08), Math.sin(a) * reach * 0.5],
          [lean * height * 0.8 * t + Math.cos(a) * reach, height * (t + 0.13), Math.sin(a) * reach]],
        [height * 0.008, height * 0.004, height * 0.0015],
        { tubularSegments: 7, radialSegments: 6 },
      ),
      color: 0xd8dcdc,
    });
  }
  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('bark', { seed, repeat: 4 }) }));

  if (!bare) {
    const leaves = [];
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const r = randomIn(rng, 0, height * 0.24);
      const blob = new THREE.SphereGeometry(height * randomIn(rng, 0.07, 0.12), 10, 8);
      blob.scale(1, 0.75, 1);
      leaves.push({ geometry: blob, color: [0x8aa83e, 0x769434, 0x9cb84e][i % 3], position: [Math.cos(a) * r, height * randomIn(rng, 0.62, 0.98), Math.sin(a) * r] });
    }
    g.add(mergedMesh(leaves, { roughness: 0.95 }));
  }
  return g;
}
