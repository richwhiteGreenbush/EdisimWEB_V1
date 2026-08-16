import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, classicalColumn, pediment,
  seededRandom, randomIn,
} from '../PropKit.js';

// The United States Capitol, from the West Front looking up the Mall.
//
// Everything in this world is white marble against green lawn, which is a harder lighting
// problem than it sounds: white-on-white has no contrast of its own, so all the modelling
// has to come from SHADOW. That is why the `capitol` theme carries the cleanest, most
// neutral sun in the app (any warmth turns the whole building cream) and a high hemisphere
// fill -- a dome is a curved surface whose entire shaded half is lit by sky bounce alone.
//
// The dome is the one object here worth real geometry. Its shape is specific: a tall
// CAST-IRON dome on a colonnaded drum, with a second smaller dome and lantern above it,
// topped by the Statue of Freedom. It is not a hemisphere -- it is noticeably taller than
// it is wide, which is the difference between the Capitol and every state house that
// copied it.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const MARBLE = 0xe8e4da;
const MARBLE_SHADE = 0xd2cec2;
const SANDSTONE = 0xded8c8;
const BRONZE = 0x6e6a52;

// The dome, drum and Statue of Freedom. Split out because it is the whole silhouette.
export function capitolDome({ drumRadius = 15, seed = 3 } = {}) {
  const g = group();
  const parts = [];

  // Peristyle drum: 36 columns round it, one for each state at the time it was built.
  const colH = drumRadius * 1.15;
  parts.push({ geometry: new THREE.CylinderGeometry(drumRadius * 1.1, drumRadius * 1.16, 3, 40), color: MARBLE, position: [0, 1.5, 0] });
  const cols = 30;
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(drumRadius * 0.052, drumRadius * 0.058, colH, 10),
      color: MARBLE,
      position: [Math.cos(a) * drumRadius, 3 + colH / 2, Math.sin(a) * drumRadius],
    });
  }
  // Inner drum wall, so the colonnade has something behind it rather than showing sky.
  parts.push({ geometry: new THREE.CylinderGeometry(drumRadius * 0.86, drumRadius * 0.86, colH, 32), color: MARBLE_SHADE, position: [0, 3 + colH / 2, 0] });
  // Entablature and balustrade over the columns.
  parts.push({ geometry: new THREE.CylinderGeometry(drumRadius * 1.14, drumRadius * 1.1, 2.6, 40), color: MARBLE, position: [0, 3 + colH + 1.3, 0] });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(drumRadius * 0.022, drumRadius * 0.026, 1.9, 6),
      color: MARBLE,
      position: [Math.cos(a) * drumRadius * 1.1, 3 + colH + 3.5, Math.sin(a) * drumRadius * 1.1],
    });
  }

  const domeBase = 3 + colH + 4.6;

  // The dome itself. Scaled 1.28 TALLER than a hemisphere -- that proportion is the whole
  // character of it, and a plain hemisphere reads as a state capitol, not as the Capitol.
  const shell = new THREE.SphereGeometry(drumRadius * 0.94, 36, 22, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(1, 1.28, 1);
  parts.push({ geometry: shell, color: MARBLE, position: [0, domeBase, 0] });

  // Ribs. A cast-iron dome is a set of ribs with panels between them, and the ribs are
  // what catch the light -- without them the shell is a plain white balloon.
  const ribs = 24;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    const pts = [];
    const radii = [];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      const phi = t * Math.PI / 2;
      const r = drumRadius * 0.95 * Math.cos(phi);
      pts.push([Math.cos(a) * r, domeBase + drumRadius * 0.94 * 1.28 * Math.sin(phi), Math.sin(a) * r]);
      radii.push(drumRadius * 0.017 * (1 - t * 0.4));
    }
    parts.push({ geometry: taperedTube(pts, radii, { tubularSegments: 14, radialSegments: 6 }), color: MARBLE_SHADE });
  }

  // Two rows of dormer windows round the dome, which are how you read its size.
  for (const [tier, count, phi] of [[0, 20, 0.22], [1, 14, 0.5]]) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + tier * 0.15;
      const r = drumRadius * 0.95 * Math.cos(phi);
      const y = domeBase + drumRadius * 0.94 * 1.28 * Math.sin(phi);
      parts.push({
        geometry: new THREE.BoxGeometry(drumRadius * 0.06, drumRadius * 0.09, drumRadius * 0.05),
        color: 0x4a5058,
        position: [Math.cos(a) * r * 1.01, y, Math.sin(a) * r * 1.01],
        rotation: [0, -a, 0],
      });
    }
  }

  const domeTop = domeBase + drumRadius * 0.94 * 1.28;

  // Tholos: the little colonnaded lantern on top, then a small dome, then the statue.
  parts.push({ geometry: new THREE.CylinderGeometry(drumRadius * 0.2, drumRadius * 0.22, drumRadius * 0.06, 20), color: MARBLE, position: [0, domeTop + drumRadius * 0.03, 0] });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(drumRadius * 0.022, drumRadius * 0.024, drumRadius * 0.26, 8),
      color: MARBLE,
      position: [Math.cos(a) * drumRadius * 0.185, domeTop + drumRadius * 0.19, Math.sin(a) * drumRadius * 0.185],
    });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(drumRadius * 0.21, drumRadius * 0.19, drumRadius * 0.05, 20), color: MARBLE, position: [0, domeTop + drumRadius * 0.34, 0] });
  const cap = new THREE.SphereGeometry(drumRadius * 0.17, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 1.2, 1);
  parts.push({ geometry: cap, color: MARBLE, position: [0, domeTop + drumRadius * 0.37, 0] });

  g.add(mergedMesh(parts, { roughness: 0.86, ...relief('stone', { seed, repeat: 6 }) }));

  // --- The Statue of Freedom ---------------------------------------------
  // 19ft of bronze, and she is NOT wearing a liberty cap -- she wears a feathered helmet,
  // because Jefferson Davis (then Secretary of War) objected to the cap as a symbol of
  // freed slaves. That is a real and unpleasant piece of history standing on top of the
  // building, and it is worth a placard.
  const statue = [];
  const sy = domeTop + drumRadius * 0.37 + drumRadius * 0.2;
  const sh = drumRadius * 0.42;
  statue.push({ geometry: new THREE.CylinderGeometry(drumRadius * 0.1, drumRadius * 0.12, sh * 0.16, 14), color: BRONZE, position: [0, sy + sh * 0.08, 0] });
  const robe = taperedTube(
    [[0, sy + sh * 0.16, 0], [0, sy + sh * 0.5, 0], [0, sy + sh * 0.75, 0]],
    [sh * 0.15, sh * 0.11, sh * 0.085],
    { tubularSegments: 10, radialSegments: 10 },
  );
  statue.push({ geometry: robe, color: BRONZE });
  statue.push({ geometry: new THREE.SphereGeometry(sh * 0.07, 10, 8), color: BRONZE, position: [0, sy + sh * 0.83, 0] });
  // The feathered helmet.
  statue.push({ geometry: new THREE.ConeGeometry(sh * 0.075, sh * 0.14, 8), color: BRONZE, position: [0, sy + sh * 0.94, 0] });
  // Sword down at her right, shield at her left.
  statue.push({ geometry: new THREE.BoxGeometry(sh * 0.03, sh * 0.4, sh * 0.03), color: BRONZE, position: [sh * 0.14, sy + sh * 0.42, 0] });
  statue.push({ geometry: new THREE.CylinderGeometry(sh * 0.1, sh * 0.1, sh * 0.025, 12), color: BRONZE, position: [-sh * 0.15, sy + sh * 0.46, 0], rotation: [0, 0, Math.PI / 2] });

  g.add(mesh(mergeColored(statue), standard({
    vertexColors: true, roughness: 0.55, metalness: 0.5, ...relief('metal', { seed: seed + 2, repeat: 4 }),
  })));

  return g;
}

// The Capitol: central block under the dome, two long wings for the two chambers, and the
// great flight of west steps. Wings are LOWER than the centre and set back, which is what
// makes the dome read as the middle of something rather than as a hat on a shed.
export function capitolBuilding({ centreWidth = 46, wingWidth = 40, depth = 34, height = 24, seed = 7 } = {}) {
  const g = group();
  const parts = [];
  const stone = MARBLE;

  const totalW = centreWidth + wingWidth * 2;

  // Stylobate under the whole thing.
  parts.push({ geometry: new THREE.BoxGeometry(totalW + 6, 3, depth + 8), color: MARBLE_SHADE, position: [0, 1.5, 0] });

  // Rusticated base storey, then the main order above -- the horizontal split is what
  // gives the facade its scale.
  parts.push({ geometry: new THREE.BoxGeometry(centreWidth, height * 0.42, depth), color: SANDSTONE, position: [0, 3 + height * 0.21, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(centreWidth, height * 0.58, depth * 0.94), color: stone, position: [0, 3 + height * 0.42 + height * 0.29, 0] });

  for (const side of [-1, 1]) {
    const x = side * (centreWidth / 2 + wingWidth / 2);
    parts.push({ geometry: new THREE.BoxGeometry(wingWidth, height * 0.4, depth * 0.86), color: SANDSTONE, position: [x, 3 + height * 0.2, -depth * 0.03] });
    parts.push({ geometry: new THREE.BoxGeometry(wingWidth, height * 0.44, depth * 0.8), color: stone, position: [x, 3 + height * 0.4 + height * 0.22, -depth * 0.03] });
    // Wing cornice.
    parts.push({ geometry: new THREE.BoxGeometry(wingWidth + 2, height * 0.06, depth * 0.84), color: stone, position: [x, 3 + height * 0.84 + height * 0.03, -depth * 0.03] });
  }

  // Centre cornice.
  parts.push({ geometry: new THREE.BoxGeometry(centreWidth + 3, height * 0.07, depth * 0.98), color: stone, position: [0, 3 + height + height * 0.035, 0] });

  g.add(mergedMesh(parts, { roughness: 0.86, ...relief('stone', { seed, repeat: 7 }) }));

  // --- Porticoes ----------------------------------------------------------
  const marble = standard({ color: stone, roughness: 0.85, ...relief('stone', { seed: seed + 1, repeat: 4 }) });

  // The central portico: eight Corinthian columns and a pediment.
  const porticoH = height * 0.72;
  const porticoZ = depth / 2 + 3.5;
  for (let i = 0; i < 8; i++) {
    const col = classicalColumn(porticoH, 1.35, marble);
    col.position.set(-centreWidth * 0.36 + i * (centreWidth * 0.72 / 7), 3 + height * 0.28, porticoZ);
    g.add(col);
  }
  g.add(box(centreWidth * 0.86, 2.2, 7, marble, 0, 3 + height * 0.28 + porticoH + 1.1, porticoZ));
  const ped = pediment(centreWidth * 0.86, centreWidth * 0.15, 6.4, marble);
  ped.position.set(0, 3 + height * 0.28 + porticoH + 2.2, porticoZ);
  g.add(ped);

  // Wing porticoes, smaller.
  for (const side of [-1, 1]) {
    const x0 = side * (centreWidth / 2 + wingWidth / 2);
    const wh = height * 0.5;
    for (let i = 0; i < 6; i++) {
      const col = classicalColumn(wh, 1.0, marble);
      col.position.set(x0 - wingWidth * 0.28 + i * (wingWidth * 0.56 / 5), 3 + height * 0.28, depth * 0.43 + 2.6);
      g.add(col);
    }
    g.add(box(wingWidth * 0.68, 1.7, 5, marble, x0, 3 + height * 0.28 + wh + 0.85, depth * 0.43 + 2.6));
    const wp = pediment(wingWidth * 0.68, wingWidth * 0.13, 4.6, marble);
    wp.position.set(x0, 3 + height * 0.28 + wh + 1.7, depth * 0.43 + 2.6);
    g.add(wp);
  }

  // --- The West Front steps ----------------------------------------------
  // The great terraced flight where inaugurations are held.
  const steps = [];
  const treads = 22;
  for (let i = 0; i < treads; i++) {
    const t = i / treads;
    steps.push({
      geometry: new THREE.BoxGeometry(centreWidth * (1.05 + t * 0.5), 3 / treads * 1.05, 1.5),
      color: i % 2 ? MARBLE : MARBLE_SHADE,
      position: [0, 3 - (i + 0.5) * (3 / treads), porticoZ + 3.5 + i * 1.5],
    });
  }
  g.add(mergedMesh(steps, { roughness: 0.88, ...relief('stone', { seed: seed + 3, repeat: 6 }) }));

  return g;
}

// The Washington Monument, on the axis a long way west. 555ft of marble obelisk, and the
// join two thirds of the way up is real: construction stopped for 23 years over the Civil
// War, and the marble they went back to came from a different quarry and never matched.
export function washingtonMonument({ height = 92, seed = 13 } = {}) {
  const g = group();
  const base = height * 0.101; // the real shaft is 55ft square at 555ft
  const parts = [];

  const shaft = new THREE.CylinderGeometry(base * 0.72, base, height * 0.9, 4);
  shaft.rotateY(Math.PI / 4);
  parts.push({ geometry: shaft, color: MARBLE, position: [0, height * 0.45, 0] });

  // The colour change, at exactly the height the work stopped.
  const lower = new THREE.CylinderGeometry(base * 0.9, base * 1.004, height * 0.27, 4);
  lower.rotateY(Math.PI / 4);
  parts.push({ geometry: lower, color: 0xd6d0c0, position: [0, height * 0.135, 0] });

  const cap = new THREE.CylinderGeometry(0, base * 0.72 * 1.42, height * 0.1, 4);
  cap.rotateY(Math.PI / 4);
  parts.push({ geometry: cap, color: MARBLE, position: [0, height * 0.95, 0] });

  // The aluminium apex -- when it was set in 1884 aluminium was a precious metal.
  parts.push({ geometry: new THREE.ConeGeometry(base * 0.08, height * 0.02, 4), color: 0xd8dce0, position: [0, height * 1.005, 0] });

  g.add(mergedMesh(parts, { roughness: 0.84, ...relief('stone', { seed, repeat: 9 }) }));
  return g;
}

// A long reflecting pool. The mirror is the point: it doubles the height of whatever
// stands at the end of it, which is why the Mall has one.
export function reflectingPool({ length = 90, width = 22, seed = 17 } = {}) {
  const g = group();
  const parts = [];
  // Coping kerb.
  parts.push({ geometry: new THREE.BoxGeometry(width + 3, 0.9, length + 3), color: MARBLE_SHADE, position: [0, 0.45, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.7, length), color: 0x2f4a52, position: [0, 0.5, 0] });
  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 5 }) }));

  // The water: low roughness and high metalness is what makes it act as a mirror for the
  // sky rather than as a flat blue rectangle.
  const water = mesh(
    new THREE.PlaneGeometry(width - 0.6, length - 0.6),
    standard({ color: 0x86a8b8, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.92 }),
    0, 0.88, 0,
  );
  water.rotation.x = -Math.PI / 2;
  water.castShadow = false;
  g.add(water);
  return g;
}

// A chamber desk block -- the semicircular ranks of desks that fill the House and Senate.
// Placed in the open as a cutaway exhibit, since neither chamber is enterable here.
export function chamberDesks({ rows = 5, seed = 19 } = {}) {
  const parts = [];
  const wood = 0x6b4a2c;
  for (let r = 0; r < rows; r++) {
    const radius = 8 + r * 4.2;
    const count = 7 + r * 3;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI * 0.42 + (i / (count - 1)) * Math.PI * 0.84;
      const x = Math.sin(a) * radius;
      const z = -Math.cos(a) * radius;
      const y = r * 0.55;
      parts.push({ geometry: new THREE.BoxGeometry(2.4, 0.24, 1.5), color: wood, position: [x, y + 2.5, z], rotation: [0, -a, 0] });
      parts.push({ geometry: new THREE.BoxGeometry(2.4, 1.5, 0.2), color: 0x5a3d24, position: [x, y + 1.8, z - 0.65], rotation: [0, -a, 0] });
      // Chair.
      parts.push({ geometry: new THREE.BoxGeometry(1.5, 0.2, 1.4), color: 0x7d2f2f, position: [x + Math.sin(a) * 1.6, y + 1.6, z - Math.cos(a) * 1.6], rotation: [0, -a, 0] });
      // The tier the row stands on.
      if (i === 0) {
        parts.push({ geometry: new THREE.CylinderGeometry(radius + 2.1, radius + 2.1, 0.55, 30, 1, false, -Math.PI * 0.5, Math.PI), color: 0x8a7a62, position: [0, y + 0.27, 0] });
      }
    }
  }
  // The rostrum they all face.
  parts.push({ geometry: new THREE.BoxGeometry(9, 3.2, 3.4), color: 0x5a3d24, position: [0, 1.6, 8] });
  parts.push({ geometry: new THREE.BoxGeometry(10, 0.4, 4.2), color: wood, position: [0, 3.4, 8] });

  return group(mergedMesh(parts, { roughness: 0.82, ...relief('wood', { seed, repeat: 5 }) }));
}

// A bronze statue on a plinth -- National Statuary Hall sends two from every state.
export function statuaryFigure({ height = 9, seed = 23, robe = false } = {}) {
  const parts = [];
  const plinthH = height * 0.34;
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.34, plinthH, height * 0.34), color: MARBLE_SHADE, position: [0, plinthH / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.4, plinthH * 0.1, height * 0.4), color: MARBLE, position: [0, plinthH, 0] });

  const fH = height - plinthH;
  const body = taperedTube(
    [[0, plinthH, 0], [0, plinthH + fH * 0.34, 0.05], [0, plinthH + fH * 0.62, 0], [0, plinthH + fH * 0.8, -0.03]],
    [fH * (robe ? 0.2 : 0.14), fH * 0.13, fH * 0.115, fH * 0.09],
    { tubularSegments: 16, radialSegments: 12 },
  );
  parts.push({ geometry: body, color: BRONZE });
  parts.push({ geometry: new THREE.SphereGeometry(fH * 0.075, 12, 10), color: BRONZE, position: [0, plinthH + fH * 0.88, -0.03] });
  // One arm across the chest, one at the side -- the standard statuary pose, and having
  // them differ is what stops it reading as a chess piece.
  const arm = taperedTube(
    [[fH * 0.1, plinthH + fH * 0.72, 0], [fH * 0.13, plinthH + fH * 0.55, 0.06], [fH * 0.04, plinthH + fH * 0.5, fH * 0.11]],
    [fH * 0.04, fH * 0.033, fH * 0.028], { tubularSegments: 10, radialSegments: 8 },
  );
  parts.push({ geometry: arm, color: BRONZE });
  const arm2 = taperedTube(
    [[-fH * 0.1, plinthH + fH * 0.72, 0], [-fH * 0.12, plinthH + fH * 0.52, 0], [-fH * 0.11, plinthH + fH * 0.36, 0.02]],
    [fH * 0.04, fH * 0.032, fH * 0.026], { tubularSegments: 10, radialSegments: 8 },
  );
  parts.push({ geometry: arm2, color: BRONZE });

  return group(mergedMesh(parts, { roughness: 0.6, metalness: 0.45, ...relief('metal', { seed, repeat: 4 }) }));
}

// A US flag on a pole. The Capitol flies several continuously, and one over each chamber
// is raised only while that chamber is in session -- which is a fact students like.
export function flagPole({ height = 26, seed = 29 } = {}) {
  const g = group();
  const pole = standard({ color: 0xdedad2, roughness: 0.4, metalness: 0.4 });
  g.add(cyl(0.16, 0.24, height, pole, 0, height / 2, 0, 10));
  g.add(mesh(new THREE.SphereGeometry(0.42, 10, 8), standard({ color: 0xd9b23c, roughness: 0.35, metalness: 0.6 }), 0, height + 0.3, 0));
  g.add(cyl(1.5, 1.7, 0.9, standard({ color: MARBLE_SHADE, roughness: 0.9, ...relief('stone', { seed, repeat: 2 }) }), 0, 0.45, 0, 12));

  const flag = canvasTexture(380, 200, (ctx, w, h) => {
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
      ctx.fillRect(0, (i * h) / 13, w, h / 13);
    }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, w * 0.4, (h / 13) * 7);
    ctx.fillStyle = '#ffffff';
    for (let r = 0; r < 9; r++) {
      const cols = r % 2 === 0 ? 6 : 5;
      for (let c = 0; c < cols; c++) {
        const x = (w * 0.4 / 12) * (r % 2 === 0 ? 1 + c * 2 : 2 + c * 2);
        const y = ((h / 13) * 7 / 10) * (1 + r);
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
  // A gentle wave, so it does not read as a decal on a stick.
  const cloth = new THREE.PlaneGeometry(9.5, 5, 14, 2);
  const pos = cloth.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin((x + 4.75) * 0.9) * 0.55 * ((x + 4.75) / 9.5));
  }
  cloth.computeVertexNormals();
  const m = mesh(cloth, standard({ map: flag, roughness: 0.9, side: THREE.DoubleSide }), 4.9, height - 3.4, 0);
  g.add(m);
  return g;
}
