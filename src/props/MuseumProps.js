import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  sphere,
  group,
  canvasTexture,
  cardTexture,
  signPanel,
  classicalColumn,
  pediment,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';
import { photoMap } from '../SurfaceTextures.js';

// "The Museum" -- a neoclassical art gallery, its sculptures, and its paintings.
//
// The paintings are generated in the STYLE of a movement rather than copied from a
// specific canvas: original compositions in De Stijl, Color Field, Post-Impressionist,
// Ukiyo-e, Pointillist and Geometric Abstract idioms. That is the educational point
// (each frame's plaque names the movement and what defines it) and it means the
// gallery ships no third-party image files at all.

// Polished marble is nearly smooth, so its relief is deliberately faint -- just enough
// veining and tool-marking to stop a 50ft wall of it reading as a single flat fill.
const MARBLE = () => standard({ color: 0xf1ede3, roughness: 0.34, metalness: 0.02, ...relief('stone', { seed: 11, repeat: 4, strength: 0.2 }) });
const STONE = () => standard({ color: 0xe4dfd2, roughness: 0.72, ...relief('stone', { seed: 13, repeat: 3 }) });
const BRONZE = () => standard({ color: 0x8c6a3f, roughness: 0.3, metalness: 0.85, ...relief('metal', { seed: 17, repeat: 2, strength: 0.22 }) });

function tiledTexture(repeatX, repeatY, size, draw) {
  const texture = canvasTexture(size, size, draw);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

function marbleFloorTexture(repeat) {
  return tiledTexture(repeat, repeat, 256, (ctx, w) => {
    const half = w / 2;
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = '#c8c1b2';
    ctx.fillRect(0, 0, half, half);
    ctx.fillRect(half, half, half, half);

    // Veining: few, faint, and drawn as long smooth curves in one direction. Short
    // many-segment polylines at higher alpha (the obvious first try) read as pencil
    // scribble on the floor rather than as stone.
    const rng = seededRandom(7);
    ctx.strokeStyle = 'rgba(126,120,110,0.16)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = randomIn(rng, 0.6, 1.6);
      ctx.beginPath();
      let x = randomIn(rng, -20, w);
      let y = randomIn(rng, 0, w);
      ctx.moveTo(x, y);
      for (let s = 0; s < 3; s++) {
        const nx = x + randomIn(rng, 55, 95);
        const ny = y + randomIn(rng, -26, 26);
        ctx.quadraticCurveTo(x + 40, y + randomIn(rng, -18, 18), nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------------------------
// The gallery building
// ---------------------------------------------------------------------------

// Open-fronted neoclassical gallery: solid back and side walls to hang paintings on,
// a six-column portico across the front so students can see and walk straight in, and
// a beam-and-skylight roof so real sunlight reaches the art inside.
export function museumHall({ width = 44, depth = 34, wallHeight = 15 } = {}) {
  const marble = MARBLE();
  const stone = STONE();
  const trim = standard({ color: 0xd9d2c2, roughness: 0.6 });
  const g = group();

  const halfW = width / 2;
  const halfD = depth / 2;
  const wall = 1;

  // Stylobate: three steps wrapping the front, with the platform the building sits on.
  for (let i = 0; i < 3; i++) {
    const inset = i * 0.9;
    g.add(box(width + 5 - inset * 2, 0.5, depth + 5 - inset * 2, stone, 0, 0.25 + i * 0.5, 0));
  }
  const floorY = 1.5;

  // Photographed marble for the surface, the drawn checker for the JOINTS.
  //
  // Splitting the two this way is the point of the whole flat-surface pass. A photo
  // gives real stone the thing procedural drawing cannot fake -- variation at several
  // scales at once, so the floor still looks like something when a student stands on it
  // and looks straight down. The canvas texture keeps its job as the bump map, where its
  // one genuine strength (knowing exactly where the tile joints are) turns into real
  // grooves the light catches.
  //
  // `color` still carries the marble's tint and the photo is neutralized against it, so
  // a missing texture file leaves a plain cream floor with grooved joints rather than a
  // white void -- and so the gallery's colour stays a decision made here in code.
  const floorTexture = marbleFloorTexture(8);
  g.add(
    mesh(
      new THREE.BoxGeometry(width - wall * 2, 0.2, depth - wall * 2),
      standard({
        // The photo is composited UNDER the drawn checker, not swapped for it. A
        // checkerboard floor is a checkerboard because of its colour, so demoting the
        // canvas to bump alone would have thrown the pattern away and left grooves.
        //
        // A much lower neutralize than the other floors, and this is the general rule:
        // the strength has to be set against how much the OVERLAY needs to stay
        // readable. The library's boards and the Mars deck plate can take 0.85 because
        // their overlays are low-contrast seams. Here the overlay is the entire design
        // of the floor, and at 0.85 a high-contrast blue-grey marble buried the
        // checkerboard completely -- the gallery floor came out looking like camouflage.
        map: photoMap('marble.jpg', { repeat: 8, neutralize: 0.3, overlay: floorTexture.image }),
        bumpMap: floorTexture,
        bumpScale: 0.35,
        roughness: 0.28,
        metalness: 0.05,
      }),
      0,
      floorY + 0.1,
      0
    )
  );

  // Back + side walls.
  g.add(box(width, wallHeight, wall, marble, 0, floorY + wallHeight / 2, -halfD + wall / 2));
  g.add(box(wall, wallHeight, depth, marble, -halfW + wall / 2, floorY + wallHeight / 2, 0));
  g.add(box(wall, wallHeight, depth, marble, halfW - wall / 2, floorY + wallHeight / 2, 0));

  // Front portico: six columns on the +Z face, carrying an entablature and pediment.
  const columnHeight = wallHeight - 2;
  for (let i = 0; i < 6; i++) {
    const column = classicalColumn(columnHeight, 0.85, marble);
    column.position.set(-halfW + 3 + i * ((width - 6) / 5), floorY, halfD - 1.6);
    g.add(column);
  }

  const entabY = floorY + columnHeight;
  g.add(box(width, 1.1, 4.2, trim, 0, entabY + 0.55, halfD - 1.6));
  g.add(box(width + 1.2, 0.7, 4.8, stone, 0, entabY + 1.45, halfD - 1.6));

  const gable = pediment(width + 1.2, 5, 4.8, stone);
  gable.position.set(0, entabY + 1.8, halfD - 1.6);
  g.add(gable);

  // Frieze band along the top of the three solid walls, tying them to the portico.
  g.add(box(width, 0.9, wall + 0.5, trim, 0, floorY + wallHeight - 0.45, -halfD + wall / 2));
  g.add(box(wall + 0.5, 0.9, depth, trim, -halfW + wall / 2, floorY + wallHeight - 0.45, 0));
  g.add(box(wall + 0.5, 0.9, depth, trim, halfW - wall / 2, floorY + wallHeight - 0.45, 0));

  // Roof: exposed beams plus tinted skylight panels between them. Deliberately
  // translucent so the directional sun still reaches the sculptures below.
  const beam = standard({ color: 0xbfb8a8, roughness: 0.7 });
  const glass = standard({
    color: 0xdcf0ff,
    roughness: 0.1,
    metalness: 0,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
  });
  const roofY = floorY + wallHeight + 0.2;
  for (let i = 0; i <= 7; i++) {
    g.add(box(0.6, 0.7, depth, beam, -halfW + (i * width) / 7, roofY, 0));
  }
  g.add(box(width, 0.5, 0.6, beam, 0, roofY, 0));
  const skylight = mesh(new THREE.PlaneGeometry(width - 2, depth - 2), glass, 0, roofY + 0.4, 0);
  skylight.rotation.x = -Math.PI / 2;
  skylight.castShadow = false;
  g.add(skylight);

  return g;
}

// Marble display plinth. 3ft tall by default, so a 4ft sculpture on top puts its
// detail right at a 5ft student's eye level.
export function museumPedestal({ height = 3, width = 2.2, color = 0xece7db } = {}) {
  const marble = standard({ color, roughness: 0.35 });
  const g = group();
  g.add(box(width + 0.4, 0.25, width + 0.4, marble, 0, 0.125, 0));
  g.add(box(width, height - 0.5, width, marble, 0, height / 2, 0));
  g.add(box(width + 0.35, 0.25, width + 0.35, marble, 0, height - 0.125, 0));
  return g;
}

// ---------------------------------------------------------------------------
// Sculptures
// ---------------------------------------------------------------------------

// Modern abstract bronze. A torus knot is the one primitive that genuinely reads as
// mid-century abstract sculpture, and it spins beautifully if a student programs it.
export function sculptureKnot({ size = 1.6, color = 0x8c6a3f } = {}) {
  const g = group();
  const knot = mesh(new THREE.TorusKnotGeometry(size, size * 0.3, 160, 24, 2, 3), standard({ color, roughness: 0.28, metalness: 0.9 }));
  knot.position.y = size * 1.55;
  g.add(knot);
  g.add(cyl(size * 0.75, size * 0.95, 0.35, standard({ color: 0x2e2a26, roughness: 0.6 }), 0, 0.175, 0, 24));
  return g;
}

// Stylized classical marble figure: a lathe-turned draped lower body, a tapered
// torso, angled arms and a head. Roughly 4.6ft tall so it towers slightly on a plinth.
export function sculptureFigure({ height = 4.6, color = 0xf1ece0 } = {}) {
  const marble = standard({ color, roughness: 0.36, metalness: 0.02 });
  const g = group();
  const s = height / 4.6;

  // Drapery: a lathe profile from hem to waist, with folds from the varying radius.
  const profile = [
    [0.98, 0.0], [1.02, 0.12], [0.92, 0.45], [0.86, 0.9],
    [0.8, 1.35], [0.7, 1.75], [0.6, 2.05], [0.52, 2.3],
  ].map(([r, y]) => new THREE.Vector2(r * s, y * s));
  const drape = mesh(new THREE.LatheGeometry(profile, 32), marble);
  g.add(drape);

  // Torso, tilted slightly for contrapposto.
  const torso = mesh(new THREE.CapsuleGeometry(0.42 * s, 0.85 * s, 8, 20), marble, 0.03 * s, 2.82 * s, 0);
  torso.scale.set(1.15, 1, 0.78);
  torso.rotation.z = -0.06;
  g.add(torso);

  g.add(cyl(0.5 * s, 0.46 * s, 0.3 * s, marble, 0.02 * s, 3.42 * s, 0, 20)); // shoulders
  g.add(cyl(0.15 * s, 0.17 * s, 0.3 * s, marble, 0.02 * s, 3.66 * s, 0, 14)); // neck

  const head = sphere(0.32 * s, marble, 0.02 * s, 4.02 * s, 0, 24);
  head.scale.set(0.86, 1.12, 0.94);
  g.add(head);
  const bun = sphere(0.17 * s, marble, 0.02 * s, 4.16 * s, -0.24 * s, 16);
  g.add(bun);

  // Arms: one lowered along the drape, one raised across the chest.
  const armLeft = mesh(new THREE.CapsuleGeometry(0.14 * s, 1.15 * s, 6, 12), marble, -0.52 * s, 2.85 * s, 0.05 * s);
  armLeft.rotation.z = 0.16;
  g.add(armLeft);
  const armRight = mesh(new THREE.CapsuleGeometry(0.14 * s, 1.0 * s, 6, 12), marble, 0.55 * s, 2.95 * s, 0.22 * s);
  armRight.rotation.set(0.4, 0, -0.75);
  g.add(armRight);

  return g;
}

// Portrait bust on an integral socle -- the other unmistakably "museum" silhouette.
export function sculptureBust({ height = 3.2, color = 0xeee9dd } = {}) {
  const marble = standard({ color, roughness: 0.38 });
  const g = group();
  const s = height / 3.2;

  g.add(box(1.5 * s, 0.28 * s, 1.2 * s, marble, 0, 0.14 * s, 0));
  g.add(cyl(0.42 * s, 0.6 * s, 0.75 * s, marble, 0, 0.65 * s, 0, 20));

  const chest = mesh(new THREE.CapsuleGeometry(0.62 * s, 0.5 * s, 8, 20), marble, 0, 1.42 * s, 0);
  chest.scale.set(1.35, 1, 0.8);
  g.add(chest);

  g.add(cyl(0.2 * s, 0.24 * s, 0.42 * s, marble, 0, 2.08 * s, 0.02 * s, 14));

  const head = sphere(0.42 * s, marble, 0, 2.62 * s, 0.02 * s, 24);
  head.scale.set(0.88, 1.14, 0.98);
  g.add(head);

  const hair = sphere(0.44 * s, standard({ color: 0xe2dccd, roughness: 0.55 }), 0, 2.72 * s, -0.04 * s, 20);
  hair.scale.set(0.92, 0.86, 0.98);
  g.add(hair);
  g.add(sphere(0.13 * s, marble, 0, 2.5 * s, 0.36 * s, 12)); // nose/brow mass

  return g;
}

// Faceted "crystal" cluster -- a geometry lesson standing on a plinth, and the piece
// that best shows off what the light orbs do when they are placed nearby.
export function sculptureCrystals({ height = 4, color = 0x6fc6d9 } = {}) {
  const g = group();
  const rng = seededRandom(19);
  const glassy = () =>
    standard({
      color,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
      flatShading: true,
    });

  g.add(cyl(1.15, 1.3, 0.3, standard({ color: 0x30343a, roughness: 0.55, metalness: 0.4 }), 0, 0.15, 0, 6));

  const shards = [
    [0, 1, 0, 1],
    [0.62, 0.66, 0.2, 0.62],
    [-0.5, 0.55, -0.42, 0.5],
    [0.2, 0.42, -0.62, 0.4],
    [-0.62, 0.34, 0.5, 0.34],
  ];
  for (const [x, scale, z] of shards) {
    const shard = mesh(new THREE.ConeGeometry(0.44 * scale, height * scale, 6), glassy(), x, (height * scale) / 2 + 0.3, z);
    shard.rotation.set(randomIn(rng, -0.14, 0.14), randomIn(rng, 0, Math.PI), randomIn(rng, -0.14, 0.14));
    g.add(shard);
  }
  return g;
}

// A kinetic mobile: discs on counterbalanced arms. Built so that a student's very
// first "rotate forever" program produces an obviously correct, satisfying result.
export function sculptureMobile({ height = 8, colors = ['#e0455f', '#f2a541', '#3fb37f', '#3d8bf2'] } = {}) {
  const rod = standard({ color: 0x2b2e32, roughness: 0.4, metalness: 0.7 });
  const g = group();

  g.add(cyl(0.8, 1.0, 0.3, rod, 0, 0.15, 0, 20));
  g.add(cyl(0.12, 0.16, height, rod, 0, height / 2 + 0.3, 0, 12));

  const tiers = [
    { y: height * 0.92, arm: 3.4 },
    { y: height * 0.66, arm: 2.6 },
    { y: height * 0.42, arm: 1.9 },
  ];
  tiers.forEach((tier, i) => {
    const arm = box(tier.arm * 2, 0.1, 0.1, rod, 0, tier.y, 0);
    arm.rotation.y = i * 0.9;
    g.add(arm);

    for (const side of [-1, 1]) {
      const colorIndex = (i * 2 + (side > 0 ? 1 : 0)) % colors.length;
      const disc = mesh(
        new THREE.CylinderGeometry(0.62, 0.62, 0.08, 24),
        standard({ color: colors[colorIndex], roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }),
        Math.cos(i * 0.9) * side * tier.arm,
        tier.y - 0.85,
        -Math.sin(i * 0.9) * side * tier.arm
      );
      disc.rotation.x = Math.PI / 2;
      g.add(disc);
      g.add(
        cyl(
          0.02,
          0.02,
          0.85,
          rod,
          Math.cos(i * 0.9) * side * tier.arm,
          tier.y - 0.42,
          -Math.sin(i * 0.9) * side * tier.arm,
          6
        )
      );
    }
  });

  return g;
}

// Large outdoor plaza piece: three interlocking rings on a stone base.
export function sculptureRings({ radius = 3.2, color = 0x9a6b3a } = {}) {
  const bronze = BRONZE();
  bronze.color.set(color);
  const g = group();

  g.add(box(radius * 2, 1, radius * 2, standard({ color: 0x8f887a, roughness: 0.9 }), 0, 0.5, 0));

  const orientations = [
    [0, 0, 0],
    [Math.PI / 2.6, 0.7, 0],
    [-Math.PI / 3, -0.6, 0.5],
  ];
  orientations.forEach((rotation, i) => {
    const ring = mesh(
      new THREE.TorusGeometry(radius * (1 - i * 0.13), 0.28, 20, 60),
      bronze,
      0,
      1 + radius * 0.95,
      0
    );
    ring.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.add(ring);
  });

  return g;
}

// ---------------------------------------------------------------------------
// Paintings
// ---------------------------------------------------------------------------

const PAINTING_STYLES = {
  // De Stijl: black grid, white ground, primaries only.
  destijl(ctx, w, h) {
    ctx.fillStyle = '#f5f2ea';
    ctx.fillRect(0, 0, w, h);
    const blocks = [
      [0, 0, 0.36, 0.42, '#d42a2a'],
      [0.62, 0.0, 0.38, 0.2, '#2b57b8'],
      [0.36, 0.62, 0.26, 0.38, '#f2c400'],
      [0.62, 0.58, 0.38, 0.24, '#d42a2a'],
      [0, 0.78, 0.2, 0.22, '#1b1b1b'],
    ];
    for (const [x, y, bw, bh, color] of blocks) {
      ctx.fillStyle = color;
      ctx.fillRect(x * w, y * h, bw * w, bh * h);
    }
    ctx.fillStyle = '#111111';
    for (const x of [0.36, 0.62]) ctx.fillRect(x * w - 8, 0, 16, h);
    for (const y of [0.2, 0.42, 0.58, 0.78]) ctx.fillRect(0, y * h - 8, w, 16);
  },

  // Color Field: stacked soft-edged rectangles floating on a saturated ground.
  colorfield(ctx, w, h) {
    ctx.fillStyle = '#8c2f1d';
    ctx.fillRect(0, 0, w, h);
    const bands = [
      [0.09, 0.08, 0.82, 0.36, '#e8913a'],
      [0.11, 0.5, 0.78, 0.2, '#f2d7a0'],
      [0.1, 0.74, 0.8, 0.18, '#59160f'],
    ];
    for (const [x, y, bw, bh, color] of bands) {
      ctx.fillStyle = color;
      // Many low-alpha passes shrinking inward give the feathered edge the style
      // depends on -- a hard fillRect reads as a flag, not a Color Field canvas.
      for (let i = 0; i < 26; i++) {
        ctx.globalAlpha = 0.09;
        const inset = i * 2.2;
        ctx.fillRect(x * w + inset, y * h + inset, bw * w - inset * 2, bh * h - inset * 2);
      }
      ctx.globalAlpha = 1;
    }
  },

  // Post-Impressionist night: swirling directional strokes, haloed stars, dark village.
  nightsky(ctx, w, h) {
    ctx.fillStyle = '#141c3a';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(2024);

    ctx.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const cx = randomIn(rng, 0, w);
      const cy = randomIn(rng, 0, h * 0.78);
      const swirl = Math.sin(cx / 90) * 1.6 + Math.cos(cy / 70) * 1.1;
      const len = randomIn(rng, 10, 30);
      const blues = ['#1d2c5e', '#2b4a91', '#3f6bbd', '#8fb2e0', '#c9d8f2'];
      ctx.strokeStyle = blues[Math.floor(rng() * blues.length)];
      ctx.lineWidth = randomIn(rng, 3, 7);
      ctx.globalAlpha = randomIn(rng, 0.45, 0.95);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo(cx + Math.cos(swirl) * len, cy + Math.sin(swirl) * len, cx + Math.cos(swirl) * len * 2, cy + Math.sin(swirl + 0.6) * len * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const [sx, sy, r] of [[0.18, 0.2, 26], [0.44, 0.12, 18], [0.68, 0.26, 22], [0.86, 0.14, 16]]) {
      const gradient = ctx.createRadialGradient(sx * w, sy * h, 2, sx * w, sy * h, r * 2.4);
      gradient.addColorStop(0, '#fff6c8');
      gradient.addColorStop(0.4, 'rgba(247,220,120,0.55)');
      gradient.addColorStop(1, 'rgba(247,220,120,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(sx * w, sy * h, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#101a2e';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.8);
    for (let x = 0; x <= w; x += w / 12) {
      ctx.lineTo(x, h * (0.78 + Math.sin(x / 60) * 0.03));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#0a1020';
    for (const [bx, bw, bh] of [[0.12, 0.1, 0.13], [0.3, 0.14, 0.1], [0.56, 0.11, 0.15], [0.75, 0.13, 0.09]]) {
      ctx.fillRect(bx * w, h * 0.82 - bh * h, bw * w, bh * h + 40);
    }
    ctx.fillStyle = '#f4d580';
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(randomIn(rng, 0.12, 0.86) * w, randomIn(rng, 0.75, 0.86) * h, 9, 12);
    }
  },

  // Ukiyo-e: flat color areas, a strong outlined wave, and a distant peak.
  ukiyoe(ctx, w, h) {
    ctx.fillStyle = '#e8dfc4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#cdbf9c';
    ctx.fillRect(0, 0, w, h * 0.42);

    // Mount Fuji.
    ctx.fillStyle = '#3d4a63';
    ctx.beginPath();
    ctx.moveTo(w * 0.36, h * 0.62);
    ctx.lineTo(w * 0.56, h * 0.3);
    ctx.lineTo(w * 0.76, h * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f2efe6';
    ctx.beginPath();
    ctx.moveTo(w * 0.48, h * 0.42);
    ctx.lineTo(w * 0.56, h * 0.3);
    ctx.lineTo(w * 0.64, h * 0.42);
    ctx.lineTo(w * 0.58, h * 0.4);
    ctx.lineTo(w * 0.53, h * 0.44);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#1c3f7a';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.55);
    ctx.bezierCurveTo(w * 0.2, h * 0.3, w * 0.34, h * 0.34, w * 0.42, h * 0.56);
    ctx.bezierCurveTo(w * 0.5, h * 0.78, w * 0.74, h * 0.72, w, h * 0.62);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f7f4ea';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.55);
    ctx.bezierCurveTo(w * 0.2, h * 0.3, w * 0.34, h * 0.34, w * 0.42, h * 0.56);
    ctx.bezierCurveTo(w * 0.34, h * 0.42, w * 0.2, h * 0.4, 0, h * 0.63);
    ctx.closePath();
    ctx.fill();

    const rng = seededRandom(88);
    ctx.strokeStyle = '#f7f4ea';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const fx = randomIn(rng, 0.02, 0.44) * w;
      const fy = randomIn(rng, 0.36, 0.62) * h;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.quadraticCurveTo(fx + 26, fy - 34, fx + 8, fy - 62);
      ctx.stroke();
    }
  },

  // Pointillism: an entire landscape built only from separated dots of pure color.
  pointillist(ctx, w, h) {
    ctx.fillStyle = '#efe9d8';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(404);

    const bands = [
      { y0: 0, y1: 0.46, palette: ['#8fc4e8', '#bcdcf2', '#e9f2f7', '#7fb0dd'] },
      { y0: 0.46, y1: 0.58, palette: ['#4f8f4a', '#6fae57', '#3d7440', '#9bc46a'] },
      { y0: 0.58, y1: 1, palette: ['#c9c05e', '#e0d581', '#a8a047', '#f0e6a4', '#7e8f42'] },
    ];
    for (const band of bands) {
      const count = Math.round((band.y1 - band.y0) * 26000);
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = band.palette[Math.floor(rng() * band.palette.length)];
        const x = randomIn(rng, 0, w);
        const y = randomIn(rng, band.y0, band.y1) * h;
        ctx.beginPath();
        ctx.arc(x, y, randomIn(rng, 2.2, 4.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // A tree, still made only of dots.
    for (let i = 0; i < 2600; i++) {
      const angle = randomIn(rng, 0, Math.PI * 2);
      const radius = Math.sqrt(rng()) * w * 0.11;
      ctx.fillStyle = ['#2f5f33', '#4b8340', '#78a84f', '#274d2c'][Math.floor(rng() * 4)];
      ctx.beginPath();
      ctx.arc(w * 0.76 + Math.cos(angle) * radius, h * 0.34 + Math.sin(angle) * radius * 1.2, randomIn(rng, 2.4, 4.6), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = ['#6b4a2a', '#8a6238', '#4d3520'][Math.floor(rng() * 3)];
      ctx.beginPath();
      ctx.arc(w * 0.76 + randomIn(rng, -12, 12), randomIn(rng, 0.44, 0.66) * h, randomIn(rng, 2.4, 4.2), 0, Math.PI * 2);
      ctx.fill();
    }
  },

  // Geometric abstraction: circles, arcs and hard lines on a light ground.
  geometric(ctx, w, h) {
    ctx.fillStyle = '#efe6d5';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(1911);
    const palette = ['#d94f3d', '#f2b134', '#2e6ea6', '#2a2a2a', '#5b9e6a', '#7a4fa3'];

    for (let i = 0; i < 9; i++) {
      ctx.globalAlpha = randomIn(rng, 0.55, 0.95);
      ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
      ctx.beginPath();
      ctx.arc(randomIn(rng, 0.1, 0.9) * w, randomIn(rng, 0.1, 0.9) * h, randomIn(rng, 0.05, 0.17) * w, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = palette[Math.floor(rng() * palette.length)];
      ctx.lineWidth = randomIn(rng, 3, 11);
      ctx.beginPath();
      ctx.moveTo(randomIn(rng, 0, w), randomIn(rng, 0, h));
      ctx.lineTo(randomIn(rng, 0, w), randomIn(rng, 0, h));
      ctx.stroke();
    }

    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = palette[Math.floor(rng() * palette.length)];
      ctx.beginPath();
      const cx = randomIn(rng, 0.15, 0.85) * w;
      const cy = randomIn(rng, 0.15, 0.85) * h;
      const size = randomIn(rng, 0.05, 0.11) * w;
      ctx.moveTo(cx, cy - size);
      ctx.lineTo(cx + size, cy + size);
      ctx.lineTo(cx - size, cy + size);
      ctx.closePath();
      ctx.fill();
    }
  },
};

// A framed canvas with its museum plaque built in, so the painting and the text that
// teaches it are one object a student can move (or program) as a unit.
export function framedPainting({
  style = 'destijl',
  width = 4.5,
  height = 3.4,
  title = 'Untitled',
  artistLine = 'Studio study',
  body = '',
  frameColor = 0xb08d3e,
} = {}) {
  const draw = PAINTING_STYLES[style] || PAINTING_STYLES.destijl;
  const pixelWidth = 768;
  const texture = canvasTexture(pixelWidth, Math.round((pixelWidth * height) / width), draw);

  const frame = standard({ color: frameColor, roughness: 0.42, metalness: 0.55 });
  const g = group();

  const border = 0.32;
  const outerW = width + border * 2;
  const outerH = height + border * 2;
  g.add(box(outerW, border, 0.34, frame, 0, height / 2 + border / 2, 0));
  g.add(box(outerW, border, 0.34, frame, 0, -height / 2 - border / 2, 0));
  g.add(box(border, outerH, 0.34, frame, -width / 2 - border / 2, 0, 0));
  g.add(box(border, outerH, 0.34, frame, width / 2 + border / 2, 0, 0));
  g.add(box(width, height, 0.1, standard({ color: 0x1a1a1a, roughness: 0.9 }), 0, 0, -0.09));

  const canvasFace = mesh(new THREE.PlaneGeometry(width, height), standard({ map: texture, roughness: 0.88 }), 0, 0, 0.06);
  g.add(canvasFace);

  const plaqueTexture = cardTexture({
    eyebrow: artistLine,
    title,
    body,
    accent: '#8c6b3f',
    width: 640,
    height: 300,
  });
  const plaque = signPanel(1.5, 0.7, plaqueTexture);
  plaque.position.set(width / 2 + border + 0.95, -height / 2 + 0.25, 0.03);
  g.add(box(1.56, 0.76, 0.05, standard({ color: 0x2f2b26, roughness: 0.6 }), plaque.position.x, plaque.position.y, 0));
  g.add(plaque);

  return g;
}

// Museum stanchions and rope, to mark off the centrepiece the way a real gallery does.
export function velvetRope({ length = 6, ropeColor = 0x8c1b2f } = {}) {
  const brass = standard({ color: 0xc9a227, roughness: 0.3, metalness: 0.85 });
  const g = group();

  for (const side of [-1, 1]) {
    const x = (side * length) / 2;
    g.add(cyl(0.5, 0.58, 0.16, brass, x, 0.08, 0, 20));
    g.add(cyl(0.09, 0.11, 2.6, brass, x, 1.3, 0, 14));
    g.add(sphere(0.16, brass, x, 2.68, 0, 16));
  }

  // A catenary-ish sag, approximated with a quadratic bezier through a low midpoint.
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-length / 2, 2.5, 0),
    new THREE.Vector3(0, 1.65, 0),
    new THREE.Vector3(length / 2, 2.5, 0)
  );
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.09, 10, false), standard({ color: ropeColor, roughness: 0.95 })));

  return g;
}
