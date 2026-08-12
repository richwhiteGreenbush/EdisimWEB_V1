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
  classicalColumn,
  pediment,
  seededRandom,
  randomIn,
} from '../PropKit.js';
import { earthTexture } from './Earth.js';

// "The Library" -- a large public library laid out the way a real one is: a reading
// room ringed by arcaded windows, stack aisles labelled with their Dewey Decimal
// ranges, reading tables, a circulation desk, and a card catalog.

const BOOK_COLORS = [
  0x7d2b2b, 0x2f4f77, 0x2d5f3f, 0x6b4a1f, 0x4a2f5e, 0x8a5a1e,
  0x1f4a4a, 0x7a3050, 0x3a3f4a, 0x93702c, 0x54306b, 0x2b5a2b,
];

function woodTexture(repeatX, repeatY, base = '#8a5a30', grain = 'rgba(60,35,15,0.35)') {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(5150);
    ctx.strokeStyle = grain;
    for (let i = 0; i < 70; i++) {
      ctx.lineWidth = randomIn(rng, 0.6, 2.6);
      const y = randomIn(rng, 0, h);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x / 22 + i) * 2.4);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

// A run of wall with arched window openings punched through it: sill course, piers
// between the openings, an arch head over each, and a lintel course above.
//
// Built from solids rather than one extruded shape-with-holes so the window reveals
// have real depth and nothing depends on triangulating a hole path. The whole masonry
// run then merges to ONE vertex-colored mesh and the glazing to a second, which is
// what keeps a five-walled hall at a handful of draw calls instead of ~350 -- the per
// block color jitter that comes with vertex coloring also reads as coursed stone for
// free, which a single tiled texture across the merged UVs could not have done.
function arcadeWall({ length, height, thickness, baseColor = 0x9c7a63, bays = 4, sill = 3.4, windowTop = 10.5, seed = 2 }) {
  const rng = seededRandom(seed);
  const stoneParts = [];
  const glassParts = [];

  const base = new THREE.Color(baseColor);
  const jitter = () => {
    const shade = base.clone();
    const k = randomIn(rng, 0.86, 1.14);
    shade.setRGB(shade.r * k, shade.g * k, shade.b * k);
    return shade.getHex();
  };

  const stone = (w, h, d, x, y, z = 0) =>
    stoneParts.push({ geometry: new THREE.BoxGeometry(w, h, d), position: [x, y, z], color: jitter() });

  const bayWidth = length / bays;
  const openWidth = bayWidth * 0.5;
  const pierWidth = bayWidth - openWidth;
  const archRadius = openWidth / 2;
  const archBase = windowTop - archRadius;

  // Sill course and lintel course, laid as individual blocks so the jitter shows.
  const courseBlocks = Math.max(6, Math.round(length / 2.5));
  for (let i = 0; i < courseBlocks; i++) {
    const w = length / courseBlocks;
    const x = -length / 2 + w * (i + 0.5);
    stone(w * 0.99, sill, thickness, x, sill / 2);
    stone(w * 0.99, height - windowTop, thickness, x, (height + windowTop) / 2);
  }

  // Piers between and outside the openings.
  for (let i = 0; i <= bays; i++) {
    const edge = i === 0 || i === bays;
    const w = edge ? pierWidth / 2 : pierWidth;
    const x = -length / 2 + i * bayWidth + (i === 0 ? w / 2 : i === bays ? -w / 2 : 0);
    const courses = 4;
    for (let c = 0; c < courses; c++) {
      const h = (windowTop - sill) / courses;
      stone(w, h * 0.99, thickness, x, sill + h * (c + 0.5));
    }
  }

  for (let i = 0; i < bays; i++) {
    const cx = -length / 2 + bayWidth * (i + 0.5);

    // Arch head: voussoir blocks stepped around the semicircle.
    const voussoirs = 9;
    for (let v = 0; v < voussoirs; v++) {
      const angle = (Math.PI * (v + 0.5)) / voussoirs;
      stoneParts.push({
        geometry: new THREE.BoxGeometry(0.42, 0.62, thickness),
        rotation: [0, 0, angle - Math.PI / 2],
        position: [cx + Math.cos(angle) * (archRadius + 0.28), archBase + Math.sin(angle) * (archRadius + 0.28), 0],
        color: jitter(),
      });
    }
    // Spandrel fill between the arch crown and the lintel course.
    stone(openWidth + 0.9, windowTop - (archBase + archRadius) + 0.1, thickness, cx, (windowTop + archBase + archRadius) / 2);

    glassParts.push({
      geometry: new THREE.BoxGeometry(openWidth, archBase - sill, thickness * 0.3),
      position: [cx, (archBase + sill) / 2, 0],
      color: 0xcfe4f2,
    });
    glassParts.push({
      geometry: new THREE.CylinderGeometry(archRadius, archRadius, thickness * 0.3, 16, 1, false, 0, Math.PI),
      rotation: [Math.PI / 2, 0, 0],
      position: [cx, archBase, 0],
      color: 0xcfe4f2,
    });

    // Muntins, so the glass reads as a real divided-light window.
    for (let m = 1; m < 3; m++) {
      stoneParts.push({
        geometry: new THREE.BoxGeometry(0.09, archBase - sill, thickness * 0.55),
        position: [cx - openWidth / 2 + (openWidth * m) / 3, (archBase + sill) / 2, 0],
        color: 0x4a3b2a,
      });
    }
    for (let m = 1; m < 4; m++) {
      stoneParts.push({
        geometry: new THREE.BoxGeometry(openWidth, 0.09, thickness * 0.55),
        position: [cx, sill + ((archBase - sill) * m) / 4, 0],
        color: 0x4a3b2a,
      });
    }
  }

  const masonry = mergedMesh(stoneParts, { roughness: 0.95 });
  const glazing = mergedMesh(glassParts, {
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.34,
  });
  glazing.castShadow = false;

  return group(masonry, glazing);
}

// The reading room: stone-and-brick shell, arcaded windows on three sides, a columned
// entrance on the +Z face, and a clerestory band under the roof so daylight reaches
// the stacks. 16ft to the eaves -- about three times a 5ft student's height.
export function libraryHall({ width = 52, depth = 40, wallHeight = 16 } = {}) {
  const brickColor = 0xa8735a;
  const stone = standard({ color: 0xd9d2c1, roughness: 0.8 });
  const trim = standard({ color: 0xe6e0d0, roughness: 0.65 });
  const g = group();

  const halfW = width / 2;
  const halfD = depth / 2;
  const thickness = 1.1;

  for (let i = 0; i < 3; i++) {
    const inset = i * 0.9;
    g.add(box(width + 6 - inset * 2, 0.45, depth + 6 - inset * 2, stone, 0, 0.225 + i * 0.45, 0));
  }
  const floorY = 1.35;

  g.add(
    mesh(
      new THREE.BoxGeometry(width - thickness * 2, 0.2, depth - thickness * 2),
      // Tight repeat so one tile is ~2ft: at 10x8 across a 50ft room each grain line
      // is half a foot wide and the floor reads as painted swirls, not boards.
      standard({ map: woodTexture(24, 18), roughness: 0.6 }),
      0,
      floorY + 0.1,
      0
    )
  );

  // Back and side walls, arcaded.
  const back = arcadeWall({ length: width, height: wallHeight, thickness, baseColor: brickColor, bays: 5, seed: 11 });
  back.position.set(0, floorY, -halfD + thickness / 2);
  g.add(back);

  for (const side of [-1, 1]) {
    const wall = arcadeWall({ length: depth, height: wallHeight, thickness, baseColor: brickColor, bays: 4, seed: 12 });
    wall.position.set(side * (halfW - thickness / 2), floorY, 0);
    wall.rotation.y = Math.PI / 2;
    g.add(wall);
  }

  // Front wall: two arcaded wings flanking a 12ft entrance opening.
  const doorway = 12;
  const wingLength = (width - doorway) / 2;
  for (const side of [-1, 1]) {
    const wing = arcadeWall({ length: wingLength, height: wallHeight, thickness, baseColor: brickColor, bays: 2, seed: 13 });
    wing.position.set(side * (doorway / 2 + wingLength / 2), floorY, halfD - thickness / 2);
    g.add(wing);
  }
  g.add(box(doorway + 2, wallHeight - 12, thickness, stone, 0, floorY + wallHeight - (wallHeight - 12) / 2, halfD - thickness / 2));

  // Entrance portico.
  const columnHeight = 13;
  for (let i = 0; i < 4; i++) {
    const column = classicalColumn(columnHeight, 0.8, stone);
    column.position.set(-6 + i * 4, floorY, halfD + 3.4);
    g.add(column);
  }
  g.add(box(19, 1.2, 6, trim, 0, floorY + columnHeight + 0.6, halfD + 2.4));
  const gable = pediment(20, 4.2, 6.4, stone);
  gable.position.set(0, floorY + columnHeight + 1.2, halfD + 2.4);
  g.add(gable);

  // Cornice, clerestory band, and a roof built as an opaque perimeter frame around a
  // big glazed lantern.
  //
  // This is a LIGHTING requirement, not decoration. A solid roof slab leaves the whole
  // reading room in near-darkness: three.js has no light transmission through
  // translucent materials, so the only thing that decides whether the sun reaches the
  // floor is the shadow map. Anything with castShadow = false lets the sun straight
  // through. So the centre of the roof is glazed and shadow-exempt (the same trick the
  // museum's skylight uses) and daylight actually lands on the stacks.
  // The cornice must be a RING of four strips, not one slab spanning the footprint.
  // A slab is invisible from inside (you are looking at the roof above it) but it is a
  // shadow caster covering the entire building, so it silently cancels out every bit
  // of glazing above it and leaves the reading room in the dark.
  const corniceY = floorY + wallHeight + 0.5;
  const corniceW = 3;
  const outerW = width + 1.6;
  const outerD = depth + 1.6;
  g.add(box(outerW, 1, corniceW, trim, 0, corniceY, outerD / 2 - corniceW / 2));
  g.add(box(outerW, 1, corniceW, trim, 0, corniceY, -outerD / 2 + corniceW / 2));
  g.add(box(corniceW, 1, outerD - corniceW * 2, trim, outerW / 2 - corniceW / 2, corniceY, 0));
  g.add(box(corniceW, 1, outerD - corniceW * 2, trim, -outerW / 2 + corniceW / 2, corniceY, 0));

  const glazing = standard({
    color: 0xdff0ff,
    roughness: 0.1,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
  });
  const clerestory = box(width - 6, 2.4, depth - 6, glazing, 0, floorY + wallHeight + 2.2, 0);
  clerestory.castShadow = false;
  g.add(clerestory);

  // The glazed opening has to be GENEROUS, not a modest central skylight. The sun
  // comes in at an angle, so a beam entering the roof lands roughly (roof height above
  // the floor) / tan(sun elevation) further along -- with a 22ft drop that is 12ft or
  // more of horizontal travel. A small opening therefore puts its patch of daylight
  // against a wall and leaves the rest of the room in shadow, which is exactly how the
  // first version of this roof read: almost black inside.
  const roofY = floorY + wallHeight + 3.7;
  const slate = standard({ color: 0x4a5560, roughness: 0.85 });
  const frame = 3;
  const openW = width - 4 - frame * 2;
  const openD = depth - 4 - frame * 2;
  g.add(box(width - 4, 0.6, frame, slate, 0, roofY, (openD + frame) / 2));
  g.add(box(width - 4, 0.6, frame, slate, 0, roofY, -(openD + frame) / 2));
  g.add(box(frame, 0.6, openD, slate, (openW + frame) / 2, roofY, 0));
  g.add(box(frame, 0.6, openD, slate, -(openW + frame) / 2, roofY, 0));

  const lantern = mesh(new THREE.PlaneGeometry(openW, openD), glazing, 0, roofY + 0.15, 0);
  lantern.rotation.x = -Math.PI / 2;
  lantern.castShadow = false;
  g.add(lantern);

  // Structural glazing bars. Thin enough that their shadows read as detail on the
  // floor rather than as the roof being closed again.
  for (let i = 1; i < 7; i++) {
    g.add(box(0.35, 0.4, openD, slate, -openW / 2 + (openW * i) / 7, roofY + 0.25, 0));
  }
  g.add(box(openW, 0.45, 0.45, slate, 0, roofY + 0.3, 0));

  return g;
}

// A double-sided stack unit filled with books. The whole thing -- case, shelves,
// every book, every spine band -- merges into ONE vertex-colored geometry, so a room
// with a dozen loaded shelves still costs a dozen draw calls instead of hundreds.
export function bookshelf({ height = 7, width = 6, depth = 1.2, shelves = 5, seed = 1, doubleSided = false } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const caseColor = 0x6b4a2c;

  const panel = (w, h, d, x, y, z, color) => {
    parts.push({ geometry: new THREE.BoxGeometry(w, h, d), position: [x, y, z], color });
  };

  panel(0.3, height, depth, -width / 2 + 0.15, height / 2, 0, caseColor);
  panel(0.3, height, depth, width / 2 - 0.15, height / 2, 0, caseColor);
  panel(width, 0.3, depth, 0, height - 0.15, 0, caseColor);
  panel(width, 0.35, depth, 0, 0.175, 0, 0x51371f);
  if (!doubleSided) panel(width, height, 0.12, 0, height / 2, -depth / 2 + 0.06, 0x4f3720);

  const shelfSpacing = (height - 0.9) / shelves;
  // 11in tall books on ~15in shelf openings: correct against a 5ft reader, and the
  // proportion students actually recognise from their own school library.
  for (let s = 0; s < shelves; s++) {
    const shelfY = 0.35 + s * shelfSpacing;
    panel(width - 0.6, 0.14, depth - 0.1, 0, shelfY, 0, caseColor);

    const rows = doubleSided ? [depth / 4, -depth / 4] : [0];
    for (const rowZ of rows) {
      let x = -width / 2 + 0.45;
      const limit = width / 2 - 0.45;
      while (x < limit - 0.2) {
        const thick = randomIn(rng, 0.09, 0.26);
        if (x + thick > limit) break;
        const bookHeight = randomIn(rng, 0.72, 1.05);
        const lean = rng() < 0.06;
        const color = BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)];
        const cx = x + thick / 2;
        const cy = shelfY + 0.07 + bookHeight / 2;

        parts.push({
          geometry: new THREE.BoxGeometry(thick * 0.92, bookHeight, depth * 0.42),
          position: [cx, cy, rowZ],
          rotation: lean ? [0, 0, 0.18] : null,
          color,
        });
        // Two pale bands near the top of the spine: at aisle distance this is what
        // makes a wall of color read as "titled books" instead of striped blocks.
        if (thick > 0.13) {
          parts.push({
            geometry: new THREE.BoxGeometry(thick * 0.55, 0.05, depth * 0.43),
            position: [cx, cy + bookHeight * 0.28, rowZ],
            color: 0xd9c9a3,
          });
          parts.push({
            geometry: new THREE.BoxGeometry(thick * 0.4, 0.035, depth * 0.43),
            position: [cx, cy + bookHeight * 0.16, rowZ],
            color: 0xd9c9a3,
          });
        }
        x += thick + 0.012;
      }
    }
  }

  return group(mergedMesh(parts, { roughness: 0.82 }));
}

// Reading table with four chairs and a pair of green-shade lamps -- the classic
// public-reading-room silhouette. Table top at 2.5ft, chair seats at 1.5ft.
export function readingTable({ length = 8, width = 3.6 } = {}) {
  const g = group();
  const wood = standard({ map: woodTexture(3, 2, '#7d5330'), roughness: 0.55 });

  g.add(box(length, 0.22, width, wood, 0, 2.5, 0));
  g.add(box(length - 1.2, 0.5, width - 1, wood, 0, 2.2, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.4, 2.3, 0.4, wood, (sx * (length - 1.4)) / 2, 1.15, (sz * (width - 1)) / 2));
    }
  }

  // Chairs, merged into one geometry per table.
  const chairParts = [];
  const chairColor = 0x5f4326;
  const addChair = (cx, cz, rotY) => {
    const push = (w, h, d, x, y, z) =>
      chairParts.push({
        geometry: new THREE.BoxGeometry(w, h, d),
        position: [cx + (x * Math.cos(rotY) + z * Math.sin(rotY)), y, cz + (-x * Math.sin(rotY) + z * Math.cos(rotY))],
        rotation: [0, rotY, 0],
        color: chairColor,
      });
    push(1.5, 0.12, 1.4, 0, 1.5, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) push(0.14, 1.5, 0.14, sx * 0.6, 0.75, sz * 0.55);
    push(1.5, 1.5, 0.12, 0, 2.25, -0.62);
  };

  const perSide = Math.max(1, Math.round(length / 4));
  for (let i = 0; i < perSide; i++) {
    const x = -length / 2 + (length / perSide) * (i + 0.5);
    addChair(x, width / 2 + 1.1, Math.PI);
    addChair(x, -width / 2 - 1.1, 0);
  }
  g.add(mergedMesh(chairParts, { roughness: 0.8 }));

  // Banker's lamps: brass stem, green glass shade, and a real warm PointLight.
  const brass = standard({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 });
  for (const side of [-1, 1]) {
    const lx = (side * length) / 4;
    g.add(cyl(0.28, 0.34, 0.1, brass, lx, 2.66, 0, 16));
    g.add(cyl(0.06, 0.06, 1.0, brass, lx, 3.16, 0, 10));
    const shade = mesh(
      new THREE.CylinderGeometry(0.34, 0.5, 0.36, 20, 1, true),
      standard({
        color: 0x1f5c3a,
        emissive: new THREE.Color(0xffd889),
        emissiveIntensity: 0.5,
        roughness: 0.5,
        side: THREE.DoubleSide,
      }),
      lx,
      3.62,
      0
    );
    g.add(shade);
    const bulb = new THREE.PointLight(0xffd28a, 0.9, 14, 2);
    bulb.position.set(lx, 3.45, 0);
    g.add(bulb);
  }

  return g;
}

// The circulation desk: a curved counter with a service gap, a computer terminal, and
// a date-stamp caddy. Where a student would actually check a book out.
export function circulationDesk({ radius = 7, height = 3.4 } = {}) {
  const g = group();
  const wood = standard({ map: woodTexture(4, 1, '#6f4a29'), roughness: 0.6 });
  const top = standard({ color: 0x2f3a42, roughness: 0.4 });

  const counter = mesh(
    new THREE.CylinderGeometry(radius, radius, height, 40, 1, true, -Math.PI * 0.75, Math.PI * 1.5),
    wood,
    0,
    height / 2,
    0
  );
  counter.material.side = THREE.DoubleSide;
  g.add(counter);

  const cap = mesh(
    new THREE.RingGeometry(radius - 0.9, radius + 0.35, 40, 1, -Math.PI * 0.75, Math.PI * 1.5),
    top,
    0,
    height,
    0
  );
  cap.rotation.x = -Math.PI / 2;
  g.add(cap);

  const inner = mesh(
    new THREE.CylinderGeometry(radius - 0.9, radius - 0.9, height - 0.6, 40, 1, true, -Math.PI * 0.75, Math.PI * 1.5),
    wood,
    0,
    (height - 0.6) / 2,
    0
  );
  inner.material.side = THREE.DoubleSide;
  g.add(inner);

  // Staff terminal. Sits ON the counter and faces INWARD, toward where a librarian
  // would stand -- the counter's service gap is at the back (-Z), so putting the
  // monitor there parks it in the walkway instead of on the desk.
  const dark = standard({ color: 0x22262b, roughness: 0.45 });
  const terminal = group();
  terminal.add(box(0.9, 0.1, 0.5, dark, 0, height + 0.05, 0));
  terminal.add(cyl(0.1, 0.14, 0.5, dark, 0, height + 0.3, 0, 10));
  terminal.add(box(1.7, 1.1, 0.12, dark, 0, height + 1.0, 0));
  terminal.add(
    mesh(
      new THREE.PlaneGeometry(1.5, 0.9),
      standard({ color: 0x1b4a6b, emissive: new THREE.Color(0x2f7fb5), emissiveIntensity: 0.8, roughness: 0.3 }),
      0,
      height + 1.0,
      -0.07
    )
  );
  terminal.add(box(1.3, 0.07, 0.45, dark, 0, height + 0.05, -0.8));

  const terminalAngle = -0.55; // radians around the counter from +Z
  terminal.position.set(Math.sin(terminalAngle) * (radius - 0.5), 0, Math.cos(terminalAngle) * (radius - 0.5));
  terminal.rotation.y = terminalAngle;
  g.add(terminal);

  // Book return bin behind the desk.
  g.add(box(2.6, 2.4, 1.8, standard({ color: 0x3f5a3f, roughness: 0.8 }), radius - 3, 1.2, -2.5));

  return g;
}

// The card catalog: the pre-computer index, and one of the best "how did people find
// things before search?" teaching objects a library world can have.
export function cardCatalog({ columns = 8, rows = 6, height = 4.4 } = {}) {
  const width = columns * 0.85;
  const depth = 1.8;
  const parts = [];
  const caseColor = 0x6b4526;

  parts.push({ geometry: new THREE.BoxGeometry(width + 0.4, 0.5, depth + 0.3), position: [0, 0.25, 0], color: 0x4f3319 });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.4, 0.35, depth + 0.4), position: [0, height - 0.17, 0], color: 0x4f3319 });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.3, height, depth), position: [0, height / 2, 0], color: caseColor });

  const drawerH = (height - 1.1) / rows;
  for (let c = 0; c < columns; c++) {
    for (let r = 0; r < rows; r++) {
      const x = -width / 2 + 0.425 + c * 0.85;
      const y = 0.6 + drawerH * (r + 0.5);
      parts.push({
        geometry: new THREE.BoxGeometry(0.74, drawerH - 0.08, 0.16),
        position: [x, y, depth / 2 + 0.05],
        color: 0x8a6035,
      });
      parts.push({
        geometry: new THREE.BoxGeometry(0.3, 0.1, 0.12),
        position: [x, y - drawerH * 0.18, depth / 2 + 0.16],
        color: 0xc9a227,
      });
      parts.push({
        geometry: new THREE.BoxGeometry(0.42, 0.12, 0.03),
        position: [x, y + drawerH * 0.2, depth / 2 + 0.14],
        color: 0xe8dcc0,
      });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.75 }));
}

// Hanging aisle sign carrying a Dewey Decimal range. These are the navigational
// spine of the library world -- walk to "500-599 SCIENCE" to find the science stacks.
export function deweySign({ range = '500–599', subject = 'SCIENCE', color = '#1f4f7a', height = 9 } = {}) {
  const g = group();
  const metal = standard({ color: 0x3c4248, roughness: 0.45, metalness: 0.6 });

  g.add(cyl(0.5, 0.6, 0.2, metal, 0, 0.1, 0, 18));
  g.add(cyl(0.12, 0.15, height, metal, 0, height / 2, 0, 12));
  g.add(box(4.6, 0.14, 0.14, metal, 0, height, 0));

  const texture = canvasTexture(768, 384, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, 0, w, h * 0.5);
    ctx.strokeStyle = '#f0e6cd';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 132px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(range, w / 2, h * 0.46);
    ctx.fillStyle = '#f2d98c';
    ctx.font = 'bold 66px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(subject, w / 2, h * 0.78);
  });

  const panel = signPanel(4.4, 2.2, texture);
  panel.position.y = height - 1.3;
  g.add(box(4.5, 2.3, 0.1, metal, 0, panel.position.y, -0.06));
  g.add(panel);

  return g;
}

// Floor globe on a wooden cradle, tilted to Earth's real 23.5 degrees of axial tilt.
export function libraryGlobe({ radius = 1.4 } = {}) {
  const g = group();
  const wood = standard({ map: woodTexture(2, 2, '#6b4426'), roughness: 0.6 });
  const brass = standard({ color: 0xc9a227, roughness: 0.3, metalness: 0.9 });

  g.add(cyl(0.9, 1.1, 0.3, wood, 0, 0.15, 0, 20));
  g.add(cyl(0.16, 0.2, 2.1, wood, 0, 1.2, 0, 14));

  const tilted = group();
  tilted.rotation.z = THREE.MathUtils.degToRad(23.5);

  const ball = sphere(radius, standard({ map: earthTexture(1024), roughness: 0.85 }), 0, 0, 0, 40);
  tilted.add(ball);

  const meridian = mesh(new THREE.TorusGeometry(radius + 0.16, 0.07, 12, 48), brass);
  meridian.rotation.y = Math.PI / 2;
  tilted.add(meridian);
  tilted.add(cyl(0.05, 0.05, radius * 2 + 0.5, brass, 0, 0, 0, 8));

  tilted.position.y = 2.25 + radius;
  g.add(tilted);

  return g;
}

// Rolling book cart -- the everyday object that makes the room feel in use.
export function bookCart({ seed = 9 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const frame = 0x3f4a52;

  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.12, 3.2, 1.4), position: [sx * 1.7, 1.6, 0], color: frame });
  }
  for (let s = 0; s < 3; s++) {
    const y = 0.7 + s * 1.05;
    parts.push({ geometry: new THREE.BoxGeometry(3.4, 0.1, 1.3), position: [0, y, 0], color: frame });
    for (const rowZ of [0.32, -0.32]) {
      let x = -1.5;
      while (x < 1.3) {
        const thick = randomIn(rng, 0.1, 0.24);
        const h = randomIn(rng, 0.7, 1.0);
        parts.push({
          geometry: new THREE.BoxGeometry(thick * 0.9, h, 0.55),
          position: [x + thick / 2, y + 0.05 + h / 2, rowZ],
          color: BOOK_COLORS[Math.floor(rng() * BOOK_COLORS.length)],
        });
        x += thick + 0.015;
      }
    }
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.22, 0.22, 0.16, 12),
        rotation: [0, 0, Math.PI / 2],
        position: [sx * 1.4, 0.22, sz * 0.5],
        color: 0x1b1e22,
      });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.7 }));
}

// Outdoor book-return box by the entrance.
export function bookDrop({ height = 4.2 } = {}) {
  const shell = standard({ color: 0x2f5f4a, roughness: 0.6, metalness: 0.3 });
  const g = group();
  g.add(box(3, height, 2, shell, 0, height / 2, 0));
  g.add(box(3.2, 0.4, 2.2, standard({ color: 0x22452f, roughness: 0.6 }), 0, height + 0.2, 0));
  g.add(box(1.8, 0.28, 0.5, standard({ color: 0x141414, roughness: 0.9 }), 0, height - 0.6, 1.02));

  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f0e6cd';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#22452f';
    ctx.textAlign = 'center';
    ctx.font = 'bold 62px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('BOOK', w / 2, h * 0.42);
    ctx.fillText('RETURN', w / 2, h * 0.76);
  });
  const label = signPanel(2.2, 1.1, texture);
  label.position.set(0, height * 0.42, 1.005);
  g.add(label);

  return g;
}

// Story-time corner: a round rug and floor cushions.
export function storyRug({ radius = 6 } = {}) {
  const g = group();
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    const rings = ['#8c3a3a', '#c9a227', '#2f6b7a', '#d9cbb0', '#4a7a4a'];
    for (let i = 0; i < rings.length; i++) {
      ctx.fillStyle = rings[i];
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (w / 2) * (1 - i / rings.length), 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const rug = mesh(new THREE.CircleGeometry(radius, 40), standard({ map: texture, roughness: 1 }), 0, 0.06, 0);
  rug.rotation.x = -Math.PI / 2;
  rug.castShadow = false;
  g.add(rug);

  const cushionColors = [0xe0455f, 0xf2a541, 0x3fb37f, 0x3d8bf2, 0x8a5cf5];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const cushion = mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.45, 18),
      standard({ color: cushionColors[i % cushionColors.length], roughness: 0.95 }),
      Math.cos(angle) * radius * 0.6,
      0.28,
      Math.sin(angle) * radius * 0.6
    );
    g.add(cushion);
  }

  return g;
}
