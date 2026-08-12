import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  cardTexture,
  signPanel,
  canvasTexture,
  seededRandom,
  randomIn,
} from '../PropKit.js';

// Props shared by more than one preset world: the info placards that carry each
// world's teaching text, plain signage, benches, and lamp posts.

// A slanted reading label on a short stand -- the museum-label form factor, reused in
// all three worlds. Angled ~30 degrees off vertical so the text faces a standing
// 5ft reader looking slightly down at it.
// Two meshes: everything metal merges into one, and the printed face stays separate
// because it is the only part that needs its own canvas texture. There are 13 of these
// in the Park, so the merge is worth doing even though each is small.
export function infoPlacard({ title, body, eyebrow, accent = '#8c6b3f', height = 3.2, width = 2.2 } = {}) {
  const g = group();
  const metalColor = 0x3a3f45;
  const faceHeight = width * 0.625;
  const tilt = -Math.PI / 6;
  const headY = height + faceHeight * 0.28;

  g.add(
    mergedMesh(
      [
        { geometry: new THREE.CylinderGeometry(0.55, 0.62, 0.12, 20), position: [0, 0.06, 0], color: metalColor },
        {
          geometry: new THREE.CylinderGeometry(0.11, 0.13, height - 0.12, 14),
          position: [0, (height - 0.12) / 2 + 0.12, 0],
          color: metalColor,
        },
        {
          geometry: new THREE.BoxGeometry(width + 0.1, faceHeight + 0.1, 0.09),
          rotation: [tilt, 0, 0],
          position: [0, headY, 0],
          color: metalColor,
        },
      ],
      { roughness: 0.5, metalness: 0.6 }
    )
  );

  const face = signPanel(width, faceHeight, cardTexture({ title, body, eyebrow, accent }));
  face.position.set(0, headY + Math.sin(-tilt) * 0.051, Math.cos(tilt) * 0.051);
  face.rotation.x = tilt;
  g.add(face);

  return g;
}

// A flat wall-mounted plaque (no stand) -- for hanging next to artwork or on a
// building. `depth` pushes it off whatever surface it is placed against.
export function wallPlacard({ title, body, eyebrow, accent = '#8c6b3f', width = 1.6 } = {}) {
  const height = width * 0.625;
  const frame = standard({ color: 0x2f2b26, roughness: 0.6 });
  const g = group(box(width + 0.06, height + 0.06, 0.05, frame, 0, 0, 0));
  const face = signPanel(width, height, cardTexture({ title, body, eyebrow, accent }));
  face.position.z = 0.031;
  g.add(face);
  return g;
}

// Free-standing signage on two posts: a building name, an aisle heading, a trail sign.
export function standingSign({
  lines = ['SIGN'],
  subtitle = '',
  width = 8,
  height = 2.4,
  postHeight = 5,
  face = '#1d3b2a',
  ink = '#f3ead6',
  accent = '#c9a227',
} = {}) {
  const post = standard({ color: 0x4a4136, roughness: 0.85 });
  const g = group();

  const inset = width / 2 - 0.5;
  g.add(cyl(0.16, 0.2, postHeight, post, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.16, 0.2, postHeight, post, inset, postHeight / 2, 0, 12));

  const texture = canvasTexture(1024, 1024 * (height / width), (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    const titleSize = subtitle ? h * 0.3 : h * 0.4;
    ctx.font = `bold ${titleSize}px Georgia, "Times New Roman", serif`;
    const startY = subtitle ? h * 0.42 : h * 0.62;
    lines.forEach((line, i) => ctx.fillText(line, w / 2, startY + i * titleSize * 1.1));

    if (subtitle) {
      ctx.fillStyle = accent;
      ctx.font = `${h * 0.15}px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(subtitle, w / 2, h * 0.78);
    }
  });

  const panelY = postHeight - height / 2 - 0.4;
  const panel = signPanel(width, height, texture);
  panel.position.set(0, panelY, 0.001);
  g.add(box(width + 0.12, height + 0.12, 0.1, post, 0, panelY, -0.06), panel);

  return g;
}

// Park/gallery bench: slatted seat and back on two cast legs. ~1.5ft seat height,
// which reads correctly against the 5ft player.
// Merged to one mesh. There are nine of these in the Park alone and fifteen slats and
// legs apiece, so leaving them unmerged costs ~250 draw calls across the main and
// shadow passes for nothing but park furniture.
export function bench({ length = 5, woodColor = 0x8a5a32 } = {}) {
  const parts = [];
  const iron = 0x2c2f33;

  for (const side of [-1, 1]) {
    const x = side * (length / 2 - 0.4);
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 1.45, 0.16), position: [x, 0.725, -0.55], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 1.45, 0.16), position: [x, 0.725, 0.55], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.16, 0.16, 1.3), position: [x, 1.45, 0], color: iron });
    parts.push({ geometry: new THREE.BoxGeometry(0.14, 1.4, 0.14), position: [x, 2.1, -0.55], color: iron });
  }

  for (let i = 0; i < 4; i++) {
    parts.push({ geometry: new THREE.BoxGeometry(length, 0.11, 0.28), position: [0, 1.56, -0.5 + i * 0.34], color: woodColor });
  }
  for (let i = 0; i < 3; i++) {
    parts.push({ geometry: new THREE.BoxGeometry(length, 0.3, 0.1), position: [0, 2.0 + i * 0.38, -0.62], color: woodColor });
  }

  return group(mergedMesh(parts, { roughness: 0.75 }));
}

// Lamp post with a real PointLight inside the globe, so it genuinely lights the
// ground under it rather than only looking lit.
export function lampPost({ height = 11, color = 0xffe6b0, intensity = 1.6 } = {}) {
  const iron = standard({ color: 0x24272b, roughness: 0.55, metalness: 0.5 });
  const g = group();

  g.add(cyl(0.32, 0.44, 0.5, iron, 0, 0.25, 0, 16));
  g.add(cyl(0.14, 0.2, height, iron, 0, height / 2 + 0.4, 0, 14));

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 20, 14),
    standard({ color: 0xfff4d8, emissive: new THREE.Color(color), emissiveIntensity: 2.4, roughness: 0.4 })
  );
  globe.position.y = height + 0.7;
  globe.userData.isGlowMesh = true;
  g.add(globe);

  g.add(cyl(0.32, 0.12, 0.5, iron, 0, height + 1.35, 0, 14));

  const light = new THREE.PointLight(color, intensity, 34, 2);
  light.position.y = height + 0.7;
  g.add(light);

  return g;
}

// A full-grown shade tree, ~22ft, built from a tapered forked trunk and overlapping
// low-poly foliage masses. Generated rather than loaded so its height is exact against
// the 5ft player (a real street tree is four or five times a person, not the 5ft the
// import pipeline would normalize a downloaded model to).
// Trunk, limbs AND canopy all merge into a SINGLE vertex-colored mesh. A tree built
// the obvious way -- one mesh per canopy blob -- costs seven draw calls, and the park
// alone plants twenty-odd of them; merging takes the whole world from ~1200 calls to
// something a school Chromebook can hold at 60fps. Flat shading does the work that
// separate materials would otherwise have done.
export function shadeTree({ height = 22, seed = 4, leafColor = 0x4c7d33, trunkColor = 0x5d4530 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkHeight = height * 0.42;

  parts.push({
    geometry: new THREE.CylinderGeometry(height * 0.026, height * 0.055, trunkHeight, 10),
    position: [0, trunkHeight / 2, 0],
    color: trunkColor,
  });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + randomIn(rng, -0.3, 0.3);
    const lean = randomIn(rng, 0.5, 0.9);
    const limbLength = height * randomIn(rng, 0.2, 0.3);
    parts.push({
      geometry: new THREE.CylinderGeometry(height * 0.012, height * 0.024, limbLength, 8),
      rotation: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean],
      position: [
        Math.cos(angle) * limbLength * 0.38,
        trunkHeight + limbLength * 0.34,
        Math.sin(angle) * limbLength * 0.38,
      ],
      color: trunkColor,
    });
  }

  const crownY = trunkHeight + height * 0.24;
  const crownRadius = height * 0.3;
  const shade = new THREE.Color(leafColor);
  parts.push({ geometry: new THREE.IcosahedronGeometry(crownRadius, 1), position: [0, crownY, 0], color: leafColor });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.6;
    parts.push({
      geometry: new THREE.IcosahedronGeometry(crownRadius * randomIn(rng, 0.5, 0.72), 1),
      rotation: [rng() * 3, rng() * 3, rng() * 3],
      position: [
        Math.cos(angle) * crownRadius * 0.85,
        crownY + randomIn(rng, -0.35, 0.4) * crownRadius,
        Math.sin(angle) * crownRadius * 0.85,
      ],
      color: shade.clone().multiplyScalar(randomIn(rng, 0.82, 1.14)).getHex(),
    });
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// A shallow planter box with a simple shrub -- softens the plaza edges outdoors.
export function planter({ size = 3, shrubColor = 0x3f7a3a } = {}) {
  const stone = standard({ color: 0xb9b3a6, roughness: 0.95 });
  const soil = standard({ color: 0x3a2d21, roughness: 1 });
  const leaf = standard({ color: shrubColor, roughness: 0.9, flatShading: true });
  const g = group();

  const wall = 0.22;
  for (const [dx, dz, w, d] of [
    [0, size / 2 - wall / 2, size, wall],
    [0, -size / 2 + wall / 2, size, wall],
    [size / 2 - wall / 2, 0, wall, size - wall * 2],
    [-size / 2 + wall / 2, 0, wall, size - wall * 2],
  ]) {
    g.add(box(w, 1.5, d, stone, dx, 0.75, dz));
  }
  g.add(box(size - wall * 2, 1.3, size - wall * 2, soil, 0, 0.65, 0));

  g.add(mesh(new THREE.IcosahedronGeometry(size * 0.42, 1), leaf, 0, 1.3 + size * 0.3, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(size * 0.28, 1), leaf, size * 0.22, 1.3 + size * 0.16, -size * 0.16));

  return g;
}
