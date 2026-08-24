import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, group, relief, seededRandom, randomIn } from '../../PropKit.js';
import { extrudeOutline, mergeParts, chain, tintGeometry, smoothNoise3 } from '../LoftKit.js';
import { ashlarPanel } from './masonry.js';

// ---------------------------------------------------------------------------
// Machu Picchu: the buildings.
//
// ASSEMBLY NOTE. This file lives at src/props/_andes/ while it is being built, so its
// import paths are '../../PropKit.js' and '../LoftKit.js'. Folded into
// src/props/AndesProps.js they become '../PropKit.js' and './LoftKit.js'. Nothing else
// in here cares where it sits.
//
// `ashlarPanel(width, height, depth, rng, opts)` is NOT defined here -- it is the shared
// rustic polygonal-masonry helper that lives further up the assembled file. The houses
// use it; the temple and the fountain deliberately do NOT, because the whole lesson of
// this world is that the Torreon's stonework is a different craft from the field walls,
// and it has to be built out of a different block to say so.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random, merge everything. See PropKit.js.
// ---------------------------------------------------------------------------

const BD_GRANITE = 0x78746c;
const BD_GRANITE_LIGHT = 0x8b867d;
const BD_GRANITE_DARK = 0x605c55;
const BD_GRANITE_WARM = 0x7f7466;
const BD_GRANITE_PALE = 0x97938a;
const BD_JOINT = 0x4b473f;          // what shows between two blocks: a shadow, not a stone
const BD_TONES = [BD_GRANITE, BD_GRANITE_LIGHT, BD_GRANITE_DARK, BD_GRANITE_WARM, 0x6e6a62];
// Ichu thatch, weathered. A fresh straw yellow reads as plastic; these roofs are
// grey-brown within a season of being laid.
const BD_THATCH = 0x8f7d58;
const BD_THATCH_DARK = 0x6b5d3e;
const BD_THATCH_PALE = 0xa2906a;
const BD_TIMBER = 0x6c5a42;
const BD_ROPE = 0x8d7a55;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

// A full Matrix4 baked into a geometry, because mergeParts applies a part's rotation as
// ONE Euler in XYZ order and that composes as Rx*Ry*Rz -- a middle Y term lands BEFORE
// the X term. A battered wall block needs yaw FIRST (to face out of the curve) and the
// inward lean SECOND, which that order cannot express: written as an Euler, every block
// on the Torreon splayed off the building instead of leaning into it.
function bd_place(geometry, x, y, z, yaw = 0, tilt = 0, roll = 0) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  if (tilt) m.multiply(new THREE.Matrix4().makeRotationX(tilt));
  if (roll) m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  const g = geometry.clone();
  g.applyMatrix4(m);
  return g;
}

// A PILLOWED ASHLAR BLOCK WITH A DRAFTED MARGIN -- the thing that separates the Torreon's
// masonry from every field wall on the site, and the reason it gets its own primitive
// rather than reusing the polygonal `ashlarPanel`.
//
// Fine Inca ashlar is not flat-faced. Each block's exposed face is slightly CONVEX and its
// rim is pecked back a fraction of an inch, so the line between two blocks is a fine dark V
// rather than a gap -- which is exactly why the joints look invisible and yet you can see
// every stone from across the plaza. Built as plain boxes the wall reads as breeze block,
// and no amount of colour variation rescues it.
//
// The whole face is one smooth function of position, so it cannot tear: z on the +Z plane
// goes to `t/2 - draft + (bulge+draft) * cos(m*pi/2)^1.5`, where m is the Chebyshev
// distance to the rim. THE SIDE FACES' RIM VERTICES MUST TAKE THE SAME RULE. Displacing
// only the front face leaves the side faces still standing at z = t/2 while the front rim
// has retreated -- a crack all the way round every block, invisible in a screenshot and
// unmistakable the moment the sun moves. m = 1 on a side rim, so the shared value falls
// out for free.
function bd_pillowBlock(w, h, t, { bulge = 0.085, draft = 0.05, seg = 4 } = {}) {
  const g = new THREE.BoxGeometry(w, h, t, seg, seg, 1);
  const pos = g.attributes.position;
  const hw = w / 2;
  const hh = h / 2;
  const face = t / 2 - 1e-4;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z < face) continue;
    const m = Math.min(1, Math.max(Math.abs(pos.getX(i)) / hw, Math.abs(pos.getY(i)) / hh));
    const lift = Math.pow(Math.cos(m * Math.PI * 0.5), 1.5);
    pos.setZ(i, t / 2 - draft + (bulge + draft) * lift);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// A closed heightfield solid over a rectangular plan: top surface from `hAt`, a short
// skirt down to y = 0 round the rim, and a bottom fan.
//
// This is how the carved granite in this file is built -- the Intihuatana, the Torreon's
// bedrock and the fountain's apron. A single surface CANNOT open a hole in itself, so the
// pillar growing out of the Intihuatana's table has no seam to leave a gap at: it is the
// same sheet, pushed up. Built as a plinth with a post standing on it, the join is a
// junction between two solids and the whole claim of the object -- one piece of granite --
// is gone.
//
// Winding is spelled out rather than left to luck: the top quads are (a, c, b)/(b, c, d)
// so the normal is +Y, the rim runs counter-clockwise seen from above so its skirt faces
// out, and the bottom fan is reversed. Get any of the three backwards and it does not read
// as a missing surface, it reads as a DARK one.
function bd_heightSolid(halfX, halfZ, nx, nz, hAt, { rim = 0.05 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const top = [];
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = -halfX + (2 * halfX * i) / nx;
      const z = -halfZ + (2 * halfZ * j) / nz;
      const edge = i === 0 || j === 0 || i === nx || j === nz;
      const y = edge ? rim : Math.max(rim, hAt(x, z));
      top.push(positions.length / 3);
      positions.push(x, y, z);
      uvs.push(i / nx, j / nz);
    }
  }
  const at = (i, j) => top[i * (nz + 1) + j];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i, j + 1);
      const d = at(i + 1, j + 1);
      indices.push(a, c, b, b, c, d);
    }
  }
  // The rim loop, counter-clockwise seen from above.
  const loop = [];
  for (let i = 0; i <= nx; i++) loop.push(at(i, 0));
  for (let j = 1; j <= nz; j++) loop.push(at(nx, j));
  for (let i = nx - 1; i >= 0; i--) loop.push(at(i, nz));
  for (let j = nz - 1; j >= 1; j--) loop.push(at(0, j));
  const bottom = loop.map((k) => {
    const idx = positions.length / 3;
    positions.push(positions[k * 3], 0, positions[k * 3 + 2]);
    uvs.push(0, 0);
    return idx;
  });
  for (let k = 0; k < loop.length; k++) {
    const k2 = (k + 1) % loop.length;
    indices.push(loop[k], loop[k2], bottom[k2], loop[k], bottom[k2], bottom[k]);
  }
  const centre = positions.length / 3;
  positions.push(0, 0, 0);
  uvs.push(0.5, 0.5);
  for (let k = 0; k < bottom.length; k++) {
    const k2 = (k + 1) % bottom.length;
    indices.push(centre, bottom[k2], bottom[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A hard-but-antialiased threshold. A raw `e > 0.74` on a grid draws the plan outline as a
// staircase one cell wide, which at six feet reads as pixellation rather than as a cut
// face; a smoothstep over about one cell keeps the arris sharp and the outline clean.
function bd_edge(e, at, width) {
  return THREE.MathUtils.smoothstep(e, at - width, at + width);
}

// A cut stone water channel running along Z: a bed and two cheeks, overlapping at the
// corners so the trough is closed by construction.
//
// NOT one extruded C-section. `extrudeOutline` caps with a fan from the outline's vertex
// AVERAGE, and that is only correct for a polygon star-shaped about that point -- a C's
// average sits in the notch, outside the stone, so half the cap's triangles come out wound
// backwards and the rest sheet across the trough. It reads as a dark plate blocking the
// channel, which looks like a material bug rather than a triangulation one.
function bd_channel(len, w, wall, deep, bedColor, cheekColor) {
  return [
    { geometry: new THREE.BoxGeometry(w + wall * 2, wall, len), color: bedColor,
      position: [0, wall / 2, 0] },
    { geometry: new THREE.BoxGeometry(wall, deep + wall, len), color: cheekColor,
      position: [-(w + wall) / 2, (deep + wall) / 2, 0] },
    { geometry: new THREE.BoxGeometry(wall, deep + wall, len), color: cheekColor,
      position: [(w + wall) / 2, (deep + wall) / 2, 0] },
  ].map((part) => {
    const g = part.geometry;
    g.translate(part.position[0], part.position[1], part.position[2]);
    return { geometry: g, color: part.color };
  });
}

function bd_stoneMesh(parts, seed, { repeat = 4, ...params } = {}) {
  return mesh(
    mergeParts(parts),
    standard({
      vertexColors: true, roughness: 0.93, metalness: 0,
      ...relief('stone', { seed, repeat }), ...params,
    }),
  );
}

// ---------------------------------------------------------------------------
// incaHouse -- the masma, and there are nine of them in this world
// ---------------------------------------------------------------------------

// A canonical Inca building: stone walls to the eaves, a trapezoidal door in the long
// downhill side, gable ends carried up in stone to hold the ridge, and a very steep ichu
// roof over the lot.
//
// THE ROOF IS THE OBJECT. It is 55 degrees, because the site gets six feet of rain a year
// and thatch only sheds water if it is nearly a wall -- modelled at a European 35 the whole
// village stops looking Andean. Everything below is worth reading before touching it:
//
//  * The roof is a CORE plus LIPS, not a stack of bars. The core is one extruded section
//    -- both slopes, the ridge and a real soffit -- so it is a closed solid and the eave
//    can never show a hollow underside, which is what "a hat balanced on the walls" looks
//    like from underneath. The courses are half-buried round bars laid ON that core: a
//    cylinder sunk into a FLAT plane cannot leave a crescent of daylight the way one laid
//    on a curved surface would, so the junction is closed by construction.
//  * The courses are RADIUS 0.5 SUNK 0.24, so each shows about three inches of round lip
//    and they overlap at the base. Square-section bars spaced about their own thickness
//    are a woodpile from any angle -- that was the first two attempts at this roof.
//  * They lie along X, parallel to the ridge, so THERE IS NO PITCH ROTATION TO GET WRONG.
//    The recorded trap here is that a course rotated by atan2(run, rise) -- the angle from
//    VERTICAL -- sits twenty degrees off the plane it belongs in and a slope splays apart
//    like a venetian blind. Placing the bar's centre on the plane and leaving its axis
//    horizontal removes the sign question entirely rather than getting it right once.
//  * There is a real ROOF STRUCTURE under it: purlins, rafters and a lashed ridge pole,
//    hanging below the soffit where they can be seen from under the eave and through the
//    door. Without it the eave is a slab.
//  * The gables carry PROJECTING STONE PEGS. Those are the tie-downs the thatch ropes went
//    over, they are on every reconstruction of these buildings, and they are the detail
//    that says Inca rather than generic-thatched-cottage.
export function incaHouse({
  width = 16, depth = 11, wallHeight = 8, roofed = true, gableEnds = true, seed = 17,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const stone = [];
  const WALL = 1.8;
  const batter = wallHeight * 0.09;

  // 55 degrees, and every roof number below is derived from it rather than guessed.
  const PITCH = 0.96;                          // rad, ~55 deg
  const tanP = Math.tan(PITCH);
  const cosP = Math.cos(PITCH);
  const THICK = 1.05;                          // thatch thickness, measured perpendicular
  const tv = THICK / cosP;                     // ...and the same thickness measured vertically
  const EAVE_OVER = 1.3;
  const E = depth / 2 + EAVE_OVER;             // z of the eave edge
  // The underside meets the wall head 0.15 BELOW it, so the thatch bites down onto the
  // stone. Sitting exactly on it, a hairline of daylight opens along the whole eave the
  // first time the sun is low.
  const RIDGE = wallHeight - 0.15 + tv + (depth / 2) * tanP;

  // --- walls -------------------------------------------------------------
  // ashlarPanel hands back mergeColored parts, and a part may carry its own
  // position/rotation rather than having them baked in -- the backing slab does. Consuming
  // only `geometry` therefore silently stacks every panel's backing at the origin, which
  // reads as a lump of rock in the middle of the house.
  const pushPanel = (panel, dx, dy, dz, yaw) => {
    for (const p of panel) {
      let geo = p.geometry.clone();
      if (p.rotation) {
        const [rx, ry, rz] = p.rotation;
        if (rx) geo.rotateX(rx);
        if (ry) geo.rotateY(ry);
        if (rz) geo.rotateZ(rz);
      }
      if (p.position) geo.translate(p.position[0], p.position[1], p.position[2]);
      if (yaw) geo = bd_place(geo, 0, 0, 0, yaw);
      geo.translate(dx, dy, dz);
      stone.push({ geometry: geo, color: p.color });
    }
  };

  // Back long wall, solid.
  pushPanel(
    ashlarPanel(width, wallHeight, WALL, rng, { batter: batter * 0.6, course: 1.25 }),
    0, 0, -(depth / 2 - WALL / 2), 0,
  );

  // Front long wall, with the trapezoidal doorway. THE TRAPEZOID IS THE TEACHING OBJECT:
  // wider at the sill than at the lintel, which is what keeps the jambs standing when the
  // ground moves, and it is the first thing anybody recognises about Inca building.
  const doorB = Math.min(width * 0.12, 2.1);          // half-width at the sill
  const doorT = doorB * 0.76;                          // ...and at the head
  const doorH = Math.min(6.6, wallHeight * 0.8);
  const frontZ = depth / 2 - WALL / 2;
  const pierW = width / 2 - doorB;
  for (const s of [-1, 1]) {
    pushPanel(
      ashlarPanel(pierW, wallHeight, WALL, rng, { batter: batter * 0.6, course: 1.25 }),
      s * (doorB + pierW / 2), 0, frontZ, 0,
    );
    // The raking jamb: the wedge between the pier's straight edge and the door's leaning
    // one. There is no CSG here, so the opening is not cut out of a wall -- the wall is
    // built round it and this is the piece that makes the rake.
    const jamb = extrudeOutline(
      [[s * doorB, 0], [s * doorB, doorH], [s * doorT, doorH]], WALL * 0.98,
    );
    stone.push({ geometry: bd_place(jamb, 0, 0, frontZ), color: BD_GRANITE_WARM });
    // A dressed reveal stone standing a little proud, so the opening reads as a THICKNESS
    // rather than as a hole cut in a sheet. The frame's own shadow is what says "depth".
    const rake = Math.atan2(doorB - doorT, doorH);
    stone.push({
      geometry: bd_place(
        new THREE.BoxGeometry(0.55, doorH * 1.02, WALL * 1.16),
        s * (doorB + doorT) / 2, doorH / 2, frontZ, 0, 0, s * rake,
      ),
      color: BD_GRANITE_LIGHT,
    });
  }
  // The monolithic lintel. One stone across the whole opening, and it is the piece
  // everybody photographs.
  stone.push({
    geometry: new THREE.BoxGeometry(doorT * 2 + 2.4, 0.9, WALL * 1.2),
    color: BD_GRANITE_PALE,
    position: [0, doorH + 0.45, frontZ],
  });
  // The panel over the lintel has to be LIFTED onto it -- ashlarPanel always builds from
  // y = 0, so dropped in as-is it stands in the doorway instead of over it.
  pushPanel(
    ashlarPanel(doorT * 2 + 1.6, Math.max(0.6, wallHeight - doorH - 0.9), WALL, rng, { course: 1.05 }),
    0, doorH + 0.9, frontZ, 0,
  );

  // Gable-end walls.
  for (const s of [-1, 1]) {
    pushPanel(
      ashlarPanel(depth, wallHeight, WALL, rng, { batter: batter * 0.6, course: 1.25 }),
      s * (width / 2 - WALL / 2), 0, 0, Math.PI / 2,
    );
  }

  // A dark floor inside, so the doorway shows an interior instead of grass.
  stone.push({
    geometry: new THREE.BoxGeometry(width - WALL * 1.6, 0.22, depth - WALL * 1.6),
    color: 0x453f38,
    position: [0, 0.11, 0],
  });

  if (roofed && gableEnds) {
    // The gable: coursed stone rising with the rake, standing 0.34 PROUD of the thatch so
    // it reads as a stone verge. Built the instinctive way -- a triangle from the wall head
    // to the ridge -- its rake is steeper than the roof's and the thatch pokes out over it
    // at the eaves. The rake line has to be the ROOF's own line, offset.
    const proud = 0.34;
    const gz = depth / 2 + 0.45;
    const rakeY = (z) => RIDGE + proud - Math.abs(z) * tanP;
    for (const s of [-1, 1]) {
      const gx = s * (width / 2 - WALL / 2);
      const outline = [
        [-gz, wallHeight - 0.9], [gz, wallHeight - 0.9],
        [gz, rakeY(gz)], [0, rakeY(0)], [-gz, rakeY(gz)],
      ];
      stone.push({
        // THINNER THAN THE BLOCKS IT BACKS, the way ashlarPanel's own backing is. At the
        // full WALL this slab spans exactly the same +/-WALL/2 as the coursed blocks are
        // centred in, and since those are only WALL*0.92 wide it stood 0.86in proud on BOTH
        // faces -- so both gable ends of all five roofed houses rendered as one flat
        // near-black triangle from eaves to ridge, and the block loop below it was never
        // visible from anywhere, inside or out.
        geometry: bd_place(extrudeOutline(outline, WALL * 0.62), gx, 0, 0, -Math.PI / 2),
        color: BD_JOINT,
      });
      // Coursed blocks over that backing, shortening as they climb.
      let y = wallHeight - 0.7;
      while (y < rakeY(0) - 0.5) {
        const ch = randomIn(rng, 0.85, 1.15);
        const half = Math.min(gz, Math.max(0.4, (rakeY(0) - (y + ch)) / tanP));
        let z = -half;
        while (z < half - 0.05) {
          const bl = Math.min(randomIn(rng, 1.1, 2.2), half - z);
          if (bl < 0.3) break;
          stone.push({
            geometry: new THREE.BoxGeometry(WALL * 0.92, ch * 1.06, bl * 1.06),
            color: BD_TONES[Math.floor(rng() * BD_TONES.length)],
            position: [gx, y + ch / 2, z + bl / 2],
          });
          z += bl;
        }
        y += ch;
      }
      // THE TIE-DOWN PEGS. Rooted 0.4ft into the gable face -- a cylinder resting on the
      // face would show a ring of daylight the first time the sun came round.
      for (const side of [-1, 1]) {
        for (let k = 0; k < 4; k++) {
          const zp = side * (0.9 + k * (gz - 1.2) / 3.4);
          const yp = rakeY(zp) - 0.85;
          stone.push({
            geometry: bd_place(
              new THREE.CylinderGeometry(0.26, 0.3, 1.3, 8),
              s * (width / 2 - 0.2), yp, zp, 0, 0, Math.PI / 2,
            ),
            color: BD_GRANITE_LIGHT,
          });
        }
      }
    }
  }

  if (!roofed) {
    // A ruin, which is what six of the nine actually are on the site: the thatch is all
    // reconstruction and the stonework is what survived. Tumbled blocks at the foot say
    // that far more cheaply than a jagged wall head does.
    for (let i = 0; i < 7; i++) {
      const a = rng() * Math.PI * 2;
      const r = randomIn(rng, 0.55, 0.9);
      stone.push({
        geometry: bd_place(
          new THREE.BoxGeometry(randomIn(rng, 1, 1.9), randomIn(rng, 0.7, 1.1), randomIn(rng, 0.8, 1.5)),
          Math.cos(a) * (width / 2 + randomIn(rng, 0.8, 2.6)),
          r * 0.5,
          Math.sin(a) * (depth / 2 + randomIn(rng, 0.6, 2.2)),
          rng() * 2, randomIn(rng, -0.2, 0.2), randomIn(rng, -0.25, 0.25),
        ),
        color: BD_TONES[Math.floor(rng() * BD_TONES.length)],
      });
    }
  }

  g.add(bd_stoneMesh(stone, seed, { repeat: 5, roughness: 0.95 }));
  if (!roofed) return g;

  // --- the roof ----------------------------------------------------------
  const thatch = [];
  const roofLen = gableEnds ? width - 1.6 : width + 0.6;
  const eaveTop = RIDGE - E * tanP;
  const slopeLen = E / cosP;
  const sinP = Math.sin(PITCH);

  // THE CORE IS TWO SLABS, ONE PER SLOPE, AND NOT ONE EXTRUDED SECTION.
  //
  // The instinctive build is a single chevron outline -- both slopes, the ridge and the
  // soffit -- run through `extrudeOutline`. It is wrong, and silently: that outline's
  // CENTROID lies in the hollow UNDER the tent, and extrudeOutline caps with a centre fan,
  // so the end caps throw triangles straight across the inside of the roof. Same trap the
  // Greenbush vault shell records. Two boxes cannot have it: a box is convex, its caps are
  // right by construction, and the two overlap past the apex so the ridge has no seam.
  //
  // beta = side * pitch, the angle from the HORIZONTAL. Written as the angle from vertical
  // -- atan2(run, rise) -- every slab sits twenty degrees off the plane it belongs in.
  for (const s of [-1, 1]) {
    const beta = s * PITCH;
    const ny = cosP;
    const nz = s * sinP;
    const slabLen = slopeLen + 0.3;
    const dMid = slabLen / 2;
    const zc = s * E - s * dMid * cosP - nz * (THICK / 2);
    const yc = eaveTop + dMid * sinP - ny * (THICK / 2);
    thatch.push({
      geometry: bd_place(new THREE.BoxGeometry(roofLen, THICK, slabLen), 0, yc, zc, 0, beta),
      color: BD_THATCH_DARK,
    });

    // The courses. Half-buried round bars laid ON that flat slab: a cylinder sunk into a
    // FLAT plane cannot leave the crescent of daylight one laid on a curved surface would,
    // so the junction is closed by construction rather than by care.
    const rows = 13;
    const step = slopeLen / rows;
    for (let i = 0; i < rows; i++) {
      const d = (i - 0.12) * step;
      const r = i === 0 ? 0.62 : randomIn(rng, 0.46, 0.54);
      const sink = i === 0 ? 0.3 : 0.24;
      const z = s * E - s * d * cosP;
      const y = eaveTop + d * sinP;
      const c = new THREE.CylinderGeometry(r, r, roofLen * 1.005, 8, 12);
      c.rotateZ(Math.PI / 2);
      c.translate(0, y - ny * sink, z - nz * sink);
      // The lip wanders. A straight cylinder along the ridge is a pipe, and thirteen pipes
      // is corrugated iron. Displaced along the plane's own NORMAL by a smooth function of
      // world x -- POSITION, never vertex index, or the surface tears into loose shards.
      const pos = c.attributes.position;
      const ph = i * 1.7 + (s > 0 ? 0.6 : 2.4) + seed * 0.13;
      const amp = i === 0 ? 0.13 : 0.075;
      for (let v = 0; v < pos.count; v++) {
        const px = pos.getX(v);
        const w = Math.sin(px * 0.62 + ph) * 0.7 + Math.sin(px * 1.31 - ph * 1.7) * 0.3;
        pos.setXYZ(v, px, pos.getY(v) + ny * w * amp, pos.getZ(v) + nz * w * amp);
      }
      pos.needsUpdate = true;
      c.computeVertexNormals();
      // COLOUR PER COURSE, RANDOM AND NARROW. A strict [mid, dark, pale][i % 3] cycle is a
      // regular light-dark-light band every three rows, and that -- not the geometry -- is
      // what made a shaggy roof read as painted planks: thirteen overlapping bars are
      // already a mass, and a repeating stripe is the one thing that turns a mass back into
      // slats. A seeded pick over a TIGHTER range, dirtier toward the eave where the rain
      // runs off, reads as one weathered thatch.
      const tone = new THREE.Color([BD_THATCH, BD_THATCH_DARK, BD_THATCH_PALE][Math.floor(rng() * 3)]);
      tone.offsetHSL(randomIn(rng, -0.012, 0.012), randomIn(rng, -0.05, 0.05),
        randomIn(rng, -0.035, 0.035) - (1 - i / rows) * 0.045);
      thatch.push({ geometry: c, color: tone.getHex() });
    }

    // A ragged fringe hanging off the cut eave. Trimmed thatch is never a clean line, and
    // the slab's square end is the one place this roof would show its construction.
    const n = Math.max(6, Math.round(roofLen / 1.15));
    for (let k = 0; k < n; k++) {
      const px = -roofLen / 2 + (roofLen * (k + 0.5)) / n;
      const drop = randomIn(rng, 0.4, 1.0);
      thatch.push({
        geometry: bd_place(
          new THREE.BoxGeometry(roofLen / n + 0.14, drop + 0.55, 0.5),
          px, eaveTop - 0.45 - drop / 2, s * (E - 0.38),
          0, s * randomIn(rng, -0.14, 0.14), randomIn(rng, -0.1, 0.1),
        ),
        color: k % 2 ? BD_THATCH_DARK : BD_THATCH,
      });
    }
  }
  // The ridge bundle, which every one of these roofs has -- and it is also what covers the
  // X the two slabs make where they cross above the apex.
  const ridgeR = 0.85;
  thatch.push({
    geometry: bd_place(
      new THREE.CylinderGeometry(ridgeR, ridgeR, roofLen * 1.02, 10, 6),
      0, RIDGE - 0.25, 0, 0, 0, Math.PI / 2,
    ),
    color: BD_THATCH_DARK,
  });
  // The rope over it, tied down to the gable pegs.
  for (let k = 0; k < 5; k++) {
    const px = -roofLen * 0.38 + (roofLen * 0.76 * k) / 4;
    thatch.push({
      geometry: bd_place(
        new THREE.TorusGeometry(ridgeR + 0.1, 0.075, 6, 12),
        px, RIDGE - 0.25, 0, Math.PI / 2, 0, 0,
      ),
      color: BD_ROPE,
    });
  }
  g.add(mesh(
    mergeParts(thatch),
    standard({ vertexColors: true, roughness: 1, metalness: 0, ...relief('weave', { seed: seed + 2, repeat: 9 }) }),
  ));

  // --- the structure under it -------------------------------------------
  // Without this the eave has a blank soffit and the roof reads as a hat balanced on the
  // walls. It hangs BELOW the slab's underside, where it can be seen from under the eave
  // and through the doorway.
  const frame = [];
  const soffitAt = (z) => RIDGE - Math.abs(z) * tanP - tv;
  frame.push({
    geometry: bd_place(
      new THREE.CylinderGeometry(0.34, 0.34, roofLen * 0.94, 8, 3),
      0, RIDGE - tv - 0.16, 0, 0, 0, Math.PI / 2,
    ),
    color: BD_TIMBER,
  });
  for (const s of [-1, 1]) {
    // Purlins hang BELOW the rafters, because that is the order you see looking up: purlin,
    // rafter, thatch. They overlap the rafters, so no junction is left open. The outermost
    // one sits out under the overhang, which is the one a student actually sees.
    for (const z of [s * (E - 0.7), s * 3.6, s * 1.4]) {
      frame.push({
        geometry: bd_place(
          new THREE.CylinderGeometry(0.28, 0.28, roofLen * 0.9, 8, 3),
          0, soffitAt(z) - 0.42, z, 0, 0, Math.PI / 2,
        ),
        color: BD_TIMBER,
      });
    }
    // Rafters, up the slope, half inside the soffit. The rotation is derived from the two
    // ends rather than guessed: a cylinder authored along Y goes to (0, cos b, sin b) under
    // Rx(b), so b = atan2(-z0, y1 - y0) and the sign per side falls out of z0.
    const nR = 7;
    const z0 = s * (E - 0.25);
    const y0 = soffitAt(z0) - 0.06;
    const y1 = RIDGE - tv - 0.12;
    const beta = Math.atan2(-z0, y1 - y0);
    const len = Math.hypot(z0, y1 - y0);
    for (let k = 0; k < nR; k++) {
      const px = -roofLen * 0.42 + (roofLen * 0.84 * k) / (nR - 1);
      frame.push({
        geometry: bd_place(
          new THREE.CylinderGeometry(0.2, 0.2, len, 7, 2),
          px, (y0 + y1) / 2, z0 / 2, 0, beta,
        ),
        color: 0x7a684d,
      });
      // The lashing at the ridge -- a rope collar, which is how these frames were held
      // together. It rings the ridge pole, so it cannot float clear of anything.
      frame.push({
        geometry: bd_place(
          new THREE.TorusGeometry(0.44, 0.09, 6, 10),
          px, RIDGE - tv - 0.16, 0, Math.PI / 2, 0, 0,
        ),
        color: BD_ROPE,
      });
    }
  }
  g.add(mesh(
    mergeParts(frame),
    standard({ vertexColors: true, roughness: 0.95, metalness: 0, ...relief('bark', { seed: seed + 5, repeat: 6 }) }),
  ));
  return g;
}

// ---------------------------------------------------------------------------
// templeOfTheSun -- the Torreon
// ---------------------------------------------------------------------------

// The only curved wall on the site, and the finest masonry on it.
//
// THREE THINGS CARRY THE IDENTIFICATION, in this order:
//
//  1. IT IS A D, NOT A CYLINDER. A semicircular tower closing onto a straight back with
//     the doorway in it. Built as a round tower it is a Norman keep; the flat side is most
//     of what a photograph of this building shows.
//  2. THE STONES ARE A DIFFERENT CRAFT. Fine coursed near-rectangular ashlar with pillowed
//     faces and drafted margins (`bd_pillowBlock`), against the polygonal field walls
//     twenty feet away. That difference IS the lesson, so the two must not share a block.
//  3. IT GROWS OUT OF THE LIVING GRANITE. Raw bedrock swells up into the base and the
//     masonry is cut to receive it -- courses stop against the rock and the bottom of a
//     block is trimmed to its surface. Without that it is a round tower on a foundation,
//     which is every round tower ever built.
export function templeOfTheSun({ radius = 11, height = 12, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const R0 = radius;
  const WALL = 2.3;
  // A pronounced batter -- the wall leans in about five degrees over its height, which is
  // both real and the reason these walls are still up.
  const BATTER = height * 0.085;
  const TILT = Math.atan2(BATTER, height);
  const SWEEP = Math.PI + 0.12;        // a shade past a half turn, so it laps the back wall

  // --- the living rock ---------------------------------------------------
  const swellA = -1.15;
  const sx = Math.sin(swellA) * R0 * 0.95;
  const sz = Math.cos(swellA) * R0 * 0.95;
  const rockAt = (x, z) => {
    const rr = Math.hypot(x, z);
    // A low rock pavement under the whole building, dying out past the wall.
    let h = 0.44 * (1 - THREE.MathUtils.smoothstep(rr, R0 * 0.95, R0 * 1.24));
    // The swell that breaks through the wall line. This is the whole detail.
    const d = Math.hypot(x - sx, z - sz);
    h += height * 0.44 * Math.exp(-(d * d) / (R0 * 0.44 * (R0 * 0.44)));
    const d2 = Math.hypot(x + R0 * 0.5, z - R0 * 0.62);
    h += height * 0.14 * Math.exp(-(d2 * d2) / (R0 * 0.3 * (R0 * 0.3)));
    h += (smoothNoise3(x * 0.19 + seed, 0.5, z * 0.19) - 0.5) * 0.9 * Math.min(1, h * 1.6);
    return Math.max(0, h);
  };
  // R0 * 1.28 and not more: the wall's outer face is at R0 + WALL/2, so this is an apron of
  // about two feet of bare granite round the building. At the 1.7 it started at, a 37ft
  // slab of rock reached the Temple's own placard fifteen feet away.
  const rock = bd_heightSolid(R0 * 1.28, R0 * 1.28, 38, 38, rockAt, { rim: 0.07 });
  tintGeometry(rock, (p) => {
    const t = THREE.MathUtils.clamp(p.y / (height * 0.42), 0, 1);
    const n = smoothNoise3(p.x * 0.5, p.y * 0.5, p.z * 0.5);
    const k = 0.20 + 0.10 * t + n * 0.07;
    return [k * 0.66, k * 0.645, k * 0.6];
  });
  g.add(mesh(rock, standard({
    vertexColors: true, roughness: 0.98, metalness: 0,
    ...relief('stone', { seed: seed + 3, repeat: 9 }),
  })));

  // --- openings ----------------------------------------------------------
  // Two trapezoidal windows. The first is the solstice window: at sunrise on the June
  // solstice the light comes through it and falls along a line carved into the rock inside.
  const windows = [
    { a: 0.62, y0: height * 0.38, y1: height * 0.38 + 3.4, wb: 1.5, wt: 1.16, boss: true },
    { a: -0.34, y0: height * 0.4, y1: height * 0.4 + 3.1, wb: 1.35, wt: 1.05, boss: true },
  ];
  const inWindow = (a, y) => windows.some((w) => {
    if (y < w.y0 - 0.02 || y > w.y1 + 0.02) return false;
    const f = (y - w.y0) / (w.y1 - w.y0);
    const half = (w.wb + (w.wt - w.wb) * f) / R0;
    let da = a - w.a;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    return Math.abs(da) < half;
  });
  const doorB = 1.9;
  const doorT = 1.45;
  const doorH = 6.6;
  const inDoor = (x, y) => {
    if (y > doorH) return false;
    const half = doorB + (doorT - doorB) * (y / doorH);
    return Math.abs(x) < half;
  };

  const blocks = [];
  const backing = [];

  // --- the curved wall ---------------------------------------------------
  // Courses are level and get SHALLOWER as they climb, which is what fine Inca ashlar
  // does and what makes a wall read as built rather than as tiled.
  const courses = [];
  for (let y = 0; y < height - 0.25;) {
    const ch = Math.min(randomIn(rng, 0.95, 1.2) * (1 - (y / height) * 0.3), height - y);
    courses.push([y, y + ch]);
    y += ch;
  }
  courses.forEach(([y0, y1], ci) => {
    const yMid = (y0 + y1) / 2;
    const r = R0 - BATTER * (yMid / height);
    const arc = SWEEP * r;
    const n = Math.max(10, Math.round(arc / randomIn(rng, 2.0, 2.35)));
    const bl = arc / n;
    const off = rng() * bl;                // stagger, so vertical joints break course to course
    for (let i = 0; i < n; i++) {
      const s = off + i * bl;
      const a = -SWEEP / 2 + (s + bl / 2) / r;
      if (a < -SWEEP / 2 || a > SWEEP / 2) continue;
      const halfA = bl / 2 / r;
      // Skip a block if any part of it falls in an opening; the jamb stones below then
      // build the exact trapezoid back FORWARD. Skipping on the centre alone leaves half a
      // block hanging into the window.
      if (inWindow(a - halfA, y0) || inWindow(a + halfA, y0)
        || inWindow(a - halfA, y1) || inWindow(a + halfA, y1)) continue;
      // The rock. `top` is the course top; a block whose bottom is buried is SHORTENED to
      // meet the granite rather than left floating on it or sunk into it.
      const bx = Math.sin(a) * r;
      const bz = Math.cos(a) * r;
      const rockY = rockAt(bx, bz);
      const base = Math.max(y0, rockY - 0.25);
      if (y1 - base < 0.34) continue;
      // The top course is broken. This building has been roofless for five hundred years
      // and a dead-level parapet is the one thing it certainly does not have.
      const top = ci === courses.length - 1 ? y1 - randomIn(rng, 0, 0.75) : y1;
      if (top - base < 0.34) continue;
      const h = top - base;
      blocks.push({
        geometry: bd_place(
          bd_pillowBlock(bl * 1.035, h * 1.04, WALL),
          bx, (base + top) / 2, bz, a, TILT,
        ),
        color: BD_TONES[Math.floor(rng() * BD_TONES.length)],
      });
    }
  });
  // The dark shell behind the faces. Without it two blocks that fail to meet show a third
  // block further back and every joint reads as a rounded edge -- a heap of cobbles, not a
  // wall. With it, the gaps become JOINTS, which is exactly how a photograph of this
  // masonry reads: pale faces separated by fine dark lines.
  const stations = 44;
  for (let i = 0; i < stations; i++) {
    const a = -SWEEP / 2 + (SWEEP * (i + 0.5)) / stations;
    const r = R0 - BATTER * 0.5 - WALL * 0.55;
    const bx = Math.sin(a) * r;
    const bz = Math.cos(a) * r;
    const base = Math.max(0, rockAt(bx, bz) - 0.5);
    const top = height - 0.3;
    if (top - base < 0.4) continue;
    backing.push({
      geometry: bd_place(
        new THREE.BoxGeometry((SWEEP * r * 1.3) / stations, top - base, WALL * 0.78),
        bx, (base + top) / 2, bz, a, TILT,
      ),
      color: BD_JOINT,
    });
  }

  // --- the straight back -------------------------------------------------
  const backZ = -WALL / 2;
  courses.forEach(([y0, y1], ci) => {
    const yMid = (y0 + y1) / 2;
    const lean = BATTER * (yMid / height);
    const halfW = R0 + 0.15;
    const n = Math.max(8, Math.round((halfW * 2) / randomIn(rng, 2.0, 2.4)));
    const bl = (halfW * 2) / n;
    const off = rng() * bl * 0.7;
    for (let i = 0; i < n; i++) {
      const x = -halfW + off + (i + 0.5) * bl;
      if (x > halfW - 0.2) continue;
      if (inDoor(Math.abs(x) - bl / 2, y0) || inDoor(Math.abs(x) + bl / 2, y0)
        || inDoor(Math.abs(x) - bl / 2, y1) || inDoor(Math.abs(x) + bl / 2, y1)) continue;
      const bz = backZ - lean * 0.45;
      const rockY = rockAt(x, bz);
      const base = Math.max(y0, rockY - 0.25);
      const top = ci === courses.length - 1 ? y1 - randomIn(rng, 0, 0.7) : y1;
      if (top - base < 0.34) continue;
      blocks.push({
        geometry: bd_place(
          bd_pillowBlock(bl * 1.035, (top - base) * 1.04, WALL),
          x, (base + top) / 2, bz, Math.PI, TILT,
        ),
        color: BD_TONES[Math.floor(rng() * BD_TONES.length)],
      });
    }
  });
  backing.push({
    geometry: new THREE.BoxGeometry((R0 + 0.15) * 2, height - 0.3, WALL * 0.6),
    color: BD_JOINT,
    position: [0, (height - 0.3) / 2, backZ + WALL * 0.32],
  });
  // The doorway's jambs and lintel, built FORWARD of the wall.
  const frame = [];
  const rake = Math.atan2(doorB - doorT, doorH);
  for (const s of [-1, 1]) {
    frame.push({
      geometry: bd_place(
        new THREE.BoxGeometry(0.6, doorH * 1.02, WALL * 1.2),
        // THE ROLL MUST BE NEGATED WHENEVER THE YAW IS PI. bd_place composes T*Ry*Rx*Rz,
        // so a pi yaw flips the local X axis and the Z-roll then leans each jamb the WRONG
        // WAY. Measured, the jamb centreline ran sill x = +/-1.446 to head x = +/-1.904 --
        // it has to move TOWARD zero -- and the clear opening came out 2.40ft at the sill
        // and 3.12ft at the head. That is an inverted trapezoid on the hero building, in a
        // world whose entire teaching point is that an Inca opening is wider at the bottom;
        // the house door and both Torreon windows are correct, so a student comparing them
        // saw the temple contradicting every other opening on the site.
        s * (doorB + doorT) / 2, doorH / 2, backZ - 0.06, Math.PI, 0, -s * rake,
      ),
      color: BD_GRANITE_LIGHT,
    });
  }
  frame.push({
    geometry: new THREE.BoxGeometry(doorT * 2 + 2.6, 0.95, WALL * 1.24),
    color: BD_GRANITE_PALE,
    position: [0, doorH + 0.47, backZ - 0.06],
  });
  frame.push({
    geometry: new THREE.BoxGeometry(doorB * 2, doorH, 0.5),
    color: 0x2b2823,
    position: [0, doorH / 2, backZ + WALL * 0.18],
  });

  // --- the windows, built forward ---------------------------------------
  for (const w of windows) {
    const yMid = (w.y0 + w.y1) / 2;
    const r = R0 - BATTER * (yMid / height);
    const wRake = Math.atan2(w.wb - w.wt, w.y1 - w.y0);
    const px = Math.sin(w.a) * r;
    const pz = Math.cos(w.a) * r;
    // The dark reveal, set back into the thickness. It is the shadow that says "opening";
    // a mid-grey panel flush with the face just reads as a differently coloured stone.
    frame.push({
      geometry: bd_place(
        new THREE.BoxGeometry(w.wb * 2, w.y1 - w.y0, 0.5),
        Math.sin(w.a) * (r - WALL * 0.3), yMid, Math.cos(w.a) * (r - WALL * 0.3), w.a, TILT,
      ),
      color: 0x2b2823,
    });
    for (const s of [-1, 1]) {
      const off = ((w.wb + w.wt) / 2) * s;
      frame.push({
        geometry: bd_place(
          new THREE.BoxGeometry(0.62, w.y1 - w.y0 + 0.9, WALL * 1.18),
          px + Math.cos(w.a) * off, yMid, pz - Math.sin(w.a) * off, w.a, TILT, s * wRake,
        ),
        color: BD_GRANITE_LIGHT,
      });
    }
    frame.push({
      geometry: bd_place(
        new THREE.BoxGeometry(w.wt * 2 + 2.0, 0.72, WALL * 1.22),
        px, w.y1 + 0.36, pz, w.a, TILT,
      ),
      color: BD_GRANITE_PALE,
    });
    frame.push({
      geometry: bd_place(
        new THREE.BoxGeometry(w.wb * 2 + 1.5, 0.5, WALL * 1.3),
        px, w.y0 - 0.25, pz, w.a, TILT,
      ),
      color: BD_GRANITE_PALE,
    });
    // THE DRILLED BOSSES beside the window. They are real, they are odd, and they are the
    // detail nobody puts on a generic round tower. Sunk into the wall face by 0.4 of their
    // own depth: a hemisphere resting ON a face shows the ring where it meets it.
    if (!w.boss) continue;
    for (const s of [-1, 1]) {
      // PLACED BY BEARING, NOT ALONG THE CHORD. Stepping `off` tangentially and then
      // seating along the WINDOW's radial leaves the boss outside the circle by
      // r*(sec(theta) - 1) -- at 3.8ft round a 10.5ft wall that is 0.71ft, and measured
      // there was 0.31ft of open air behind every one of the four. They hovered off the
      // masonry with daylight all round and each casting its own shadow on the wall, which
      // is precisely the failure the comment above claims to avoid.
      const off = (w.wb + 2.3) * s;
      const a2 = w.a + off / r;
      const bx = Math.sin(a2) * r;
      const bz = Math.cos(a2) * r;
      // SIZE AND SEATING BOTH MATTER. At radius 0.52 standing with its centre ON the wall
      // face, a boss is a foot across and projects six inches -- which on a 12ft tower does
      // not read as a tie point, it reads as a ball stuck on a stick, and four of them round
      // two windows read as eyes. A real one is a nub you could get a rope behind.
      const knob = new THREE.SphereGeometry(0.27, 12, 8);
      knob.scale(1, 1, 0.58);
      const stand = WALL * 0.5 - 0.055;
      frame.push({
        geometry: bd_place(
          knob, bx + Math.sin(a2) * stand, yMid + 0.4, bz + Math.cos(a2) * stand, a2, TILT,
        ),
        color: BD_GRANITE_PALE,
      });
      // ...and the DRILL HOLE, which is what makes it a tie point rather than a lump.
      frame.push({
        geometry: bd_place(
          new THREE.CylinderGeometry(0.075, 0.065, 0.40, 8),
          bx + Math.sin(a2) * stand, yMid + 0.4, bz + Math.cos(a2) * stand,
          a2, TILT + Math.PI / 2,
        ),
        color: 0x322e29,
      });
    }
  }

  const wall = mergeParts([...backing, ...blocks, ...frame]);
  // A little wind-wash down the faces, strengthening toward the ground. Real granite that
  // has stood for six centuries is never one flat colour, and this costs no geometry.
  tintGeometry(wall, (p, c) => {
    const n = smoothNoise3(p.x * 0.22 + seed, p.y * 0.3, p.z * 0.22);
    const k = 1 - 0.14 * n - 0.1 * THREE.MathUtils.clamp(1 - p.y / 4, 0, 1);
    return [c.r * k, c.g * k, c.b * k * 0.985];
  });
  g.add(mesh(wall, standard({
    vertexColors: true, roughness: 0.9, metalness: 0,
    ...relief('stone', { seed, repeat: 5 }),
  })));
  return g;
}

// ---------------------------------------------------------------------------
// intihuatana
// ---------------------------------------------------------------------------

// "The place that ties the sun". ONE PIECE OF GRANITE, carved where it stood out of the
// bedrock -- an irregular stepped plinth with a canted table, and a squared pillar rising
// off-centre from it whose corners point to the four directions.
//
// IT HAS TO READ AS CARVED FROM ONE MASS, so it is built as ONE SURFACE: a heightfield
// whose top is the table where the plan is outside the pillar's footprint and the pillar's
// canted top where it is inside, with the frustum's sloping side faces in between. A
// displacement of a surface cannot open a gap in it, so there is no seam between pillar and
// base to close -- built as a post standing on a plinth, that junction is the one thing the
// object must not have.
//
// `toCreasedNormals` is what makes it read as CUT rather than as weathered: it welds
// normals only where neighbouring faces are near coplanar, so the table stays flat, the
// pillar's arrises stay sharp, and the rounded rock between them stays smooth.
export function intihuatana({ height = 6, seed = 13 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const RX = 5.5;
  const RZ = 4.6;
  const tableY = height * 0.46;
  const pTop = tableY + height * 0.62;
  // The pillar is off-centre, as the real one is, and turned 45 degrees so its CORNERS
  // face the four directions.
  const px = 0.75;
  const pz = -0.5;
  const wTop = 0.72;
  const wBase = wTop + 0.19;           // the taper -- a heightfield CAN do a frustum
  const c45 = Math.SQRT1_2;
  const phase = rng() * 6.28;

  const hAt = (x, z) => {
    const th = Math.atan2(z, x);
    const rn = Math.hypot(x / RX, z / RZ);
    // An irregular plan, so the plinth is a carved outcrop and not a slab.
    const wob = 1 + 0.10 * Math.sin(3 * th + phase) + 0.06 * Math.sin(5 * th - phase * 1.7)
      + 0.035 * Math.sin(7 * th + 2.4);
    const e = rn / wob;
    // AN EVEN STACK OF EQUAL STEPS IS A WEDDING CAKE. The real base is a few shallow cut
    // terraces of quite different depths, so the levels are uneven on purpose.
    let y = tableY;
    y -= tableY * 0.24 * bd_edge(e, 0.56, 0.03);
    y -= tableY * 0.30 * bd_edge(e, 0.735, 0.03);
    y -= tableY * 0.30 * bd_edge(e, 0.87, 0.03);
    y -= tableY * 0.16 * bd_edge(e, 0.975, 0.025);
    // The canted upper surface: the table is not level, and the tilt is the point of it.
    y += (x * 0.062 - z * 0.045) * THREE.MathUtils.clamp(y / tableY, 0, 1);
    // Carved facets rather than boulder lumps -- shallow and broad.
    y += (smoothNoise3(x * 0.42 + seed, 0.5, z * 0.42) - 0.5) * 0.34 * THREE.MathUtils.clamp(y, 0, 1);
    if (y < 0.07) return 0.07;

    // The raised boss the pillar stands on.
    const bu = (x - px) * c45 + (z - pz) * c45;
    const bv = -(x - px) * c45 + (z - pz) * c45;
    const bm = Math.max(Math.abs(bu), Math.abs(bv));
    y += 0.42 * (1 - bd_edge(bm, 1.95, 0.09));

    // The gnomon. `max` is what makes it grow out of the table instead of standing on it.
    const top = pTop + bu * 0.085 - bv * 0.055;
    if (bm <= wTop) return Math.max(y, top);
    if (bm < wBase) return Math.max(y, top - ((bm - wTop) / (wBase - wTop)) * (top - y));
    return y;
  };

  // ~0.17ft cells: about nine across the pillar's 1.5ft face, which is what it takes for
  // the frustum's side to read as a face rather than as a ramp. The half-extents clear the
  // LARGEST plan lobe (wob peaks at 1.195), not the average one.
  const geom = bd_heightSolid(RX * 1.22, RZ * 1.24, 78, 66, hAt, { rim: 0.07 });
  tintGeometry(geom, (p) => {
    const n = smoothNoise3(p.x * 0.55 + seed, p.y * 0.55, p.z * 0.55);
    // Weathered pale on top, warmer and darker in the cut steps and down at the grass.
    const up = THREE.MathUtils.clamp((p.y - tableY * 0.5) / (pTop - tableY * 0.5), 0, 1);
    // Linear, not sRGB: 0.56-0.93 here renders 0.78-0.97 and the stone comes out as chalk.
    const k = 0.14 + up * 0.08 + n * 0.06;
    return [k, k * 0.985, k * 0.945];
  });
  const carved = toCreasedNormals(geom, (28 * Math.PI) / 180);
  g.add(mesh(carved, standard({
    vertexColors: true, roughness: 0.88, metalness: 0,
    ...relief('stone', { seed, repeat: 6 }),
  })));
  return g;
}

// ---------------------------------------------------------------------------
// incaFountain
// ---------------------------------------------------------------------------

// One of the sixteen. The water arrives from the spring along a cut stone channel, drops
// through a SHAPED SPOUT, and lands in a basin cut below it. It is still running.
//
// THE SPOUT IS THE ENGINEERING and it is the reason this prop exists rather than a trough.
// Its channel narrows and its floor steepens toward a sharp lip, which is what turns a
// dribble down the stonework into a single coherent jet you can hold a jar under. Modelled
// as a plain notch in a wall the water has nothing to leave from and the whole object stops
// being a machine.
export function incaFountain({ height = 4.2, seed = 23 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const stone = [];
  const WALL = 1.4;
  const faceZ = -0.35;                 // the front face of the fountain wall
  const spoutY = height * 0.72;
  const lipZ = faceZ + 1.5;            // how far the spout throws the water clear of the wall
  const basinZ = 2.0;
  const rimTop = 0.95;
  const waterY = 0.74;

  // --- the rock it is cut into ------------------------------------------
  const rockAt = (x, z) => {
    let h = 0.3 * (1 - THREE.MathUtils.smoothstep(Math.hypot(x / 4.4, z / 4.6), 0.8, 1.05));
    // The bank rising behind, which is where the channel comes down from.
    h += 1.1 * Math.exp(-((z + 3.4) * (z + 3.4)) / 3.2) * (1 - THREE.MathUtils.smoothstep(Math.abs(x), 2.6, 4.4));
    h += (smoothNoise3(x * 0.6 + seed, 0.5, z * 0.6) - 0.5) * 0.28 * Math.min(1, h * 3);
    return Math.max(0, h);
  };
  const apron = bd_heightSolid(4.6, 4.9, 30, 32, rockAt, { rim: 0.07 });
  tintGeometry(apron, (p) => {
    const n = smoothNoise3(p.x * 0.8, p.y * 0.8, p.z * 0.8);
    // A VERTEX COLOUR IS LINEAR, and 0.55-0.85 in linear is 0.78-0.94 in sRGB -- so this
    // apron rendered as a sheet of white paving next to a wall measuring 0.39. Written as
    // if the numbers were sRGB, which is the natural thing to do and wrong every time.
    const k = 0.16 + n * 0.08 + THREE.MathUtils.clamp(p.y, 0, 1) * 0.05;
    return [k * 1.0, k * 0.98, k * 0.92];
  });
  g.add(mesh(apron, standard({
    vertexColors: true, roughness: 0.97, metalness: 0,
    ...relief('stone', { seed: seed + 7, repeat: 7 }),
  })));

  // --- the fountain wall, in the fine ashlar ----------------------------
  const wallW = 5.4;
  let y = 0.15;
  while (y < height - 0.2) {
    const ch = Math.min(randomIn(rng, 0.72, 0.94), height - y);
    const n = Math.max(3, Math.round(wallW / randomIn(rng, 1.5, 1.9)));
    const bl = wallW / n;
    for (let i = 0; i < n; i++) {
      const x = -wallW / 2 + (i + 0.5) * bl + (rng() - 0.5) * 0.12;
      stone.push({
        geometry: bd_place(
          bd_pillowBlock(bl * 1.04, ch * 1.05, WALL, { bulge: 0.07, draft: 0.045 }),
          x, y + ch / 2, faceZ - WALL / 2, 0, 0,
        ),
        color: BD_TONES[Math.floor(rng() * BD_TONES.length)],
      });
    }
    y += ch;
  }
  stone.push({
    geometry: new THREE.BoxGeometry(wallW + 0.5, height, WALL * 0.75),
    color: BD_JOINT,
    position: [0, height / 2, faceZ - WALL * 0.8],
  });
  // A coping over the wall head, which is what stops the run of blocks reading as unfinished.
  stone.push({
    geometry: new THREE.BoxGeometry(wallW + 0.9, 0.4, WALL * 1.5),
    color: BD_GRANITE_PALE,
    position: [0, height + 0.18, faceZ - WALL * 0.55],
  });

  // --- the channel coming in --------------------------------------------
  // A real cut trough with a bed and two cheeks, not a slot painted on a slab. See
  // bd_channel for why it is not one extruded C-section.
  const cw = 0.72;
  const ct = 0.26;
  const cd = 0.44;
  const runLen = 3.6;
  for (const part of bd_channel(runLen, cw, ct, cd, BD_GRANITE_LIGHT, BD_GRANITE_WARM)) {
    part.geometry.translate(0, height * 0.86, faceZ - WALL - runLen / 2 + 0.2);
    stone.push(part);
  }
  // Its bed, so the channel is not floating over the bank.
  stone.push({
    geometry: new THREE.BoxGeometry(1.7, height * 0.9, runLen * 0.92),
    color: BD_GRANITE_DARK,
    position: [0, height * 0.44, faceZ - WALL - runLen / 2 + 0.2],
  });
  // Two cover slabs. The Inca capped these runs with stone; leaving the whole channel open
  // makes it read as a gutter.
  for (const t of [-1.15, 0.35]) {
    stone.push({
      geometry: new THREE.BoxGeometry(1.5, 0.24, 1.05),
      color: BD_GRANITE_WARM,
      position: [0, height * 0.86 + cd + ct + 0.08, faceZ - WALL - runLen / 2 + 0.2 + t],
    });
  }

  // --- the spout ---------------------------------------------------------
  // Built as overlapping solids -- floor, two converging cheeks, and a chamfered lip --
  // because there is no CSG here, so the groove is what the solids leave between them.
  const spoutLen = lipZ - faceZ + 0.25;
  const midZ = (faceZ + lipZ) / 2;
  stone.push({
    geometry: bd_place(
      new THREE.BoxGeometry(1.5, 0.36, spoutLen),
      0, spoutY - 0.1, midZ, 0, -0.16,
    ),
    color: BD_GRANITE_PALE,
  });
  for (const s of [-1, 1]) {
    // The cheeks converge on the lip: the channel is 0.9ft wide at the wall and 0.34 at the
    // lip, which is what concentrates the flow into one thread instead of a sheet.
    stone.push({
      geometry: bd_place(
        new THREE.BoxGeometry(0.3, 0.62, spoutLen),
        s * 0.44, spoutY + 0.1, midZ, s * 0.11, -0.16,
      ),
      color: BD_GRANITE_PALE,
    });
  }
  // The lip itself -- a sharp chamfered edge. A square end lets the water cling and run
  // back along the underside of the stone, which is exactly the failure this shape solves.
  stone.push({
    geometry: bd_place(
      new THREE.BoxGeometry(1.1, 0.3, 0.42),
      0, spoutY - 0.24, lipZ, 0, -0.62,
    ),
    color: BD_GRANITE_LIGHT,
  });

  // --- the basin ---------------------------------------------------------
  // A rim with a dished floor inside it. A dark slab laid flat on the grass reads as a
  // doormat; what makes a basin a basin is the lip round the edge.
  const bw = 4.5;
  const bd = 3.9;
  const rimT = 0.62;
  for (const [ox, oz, w, d] of [
    [0, -bd / 2 + rimT / 2, bw, rimT], [0, bd / 2 - rimT / 2, bw, rimT],
    [-bw / 2 + rimT / 2, 0, rimT, bd], [bw / 2 - rimT / 2, 0, rimT, bd],
  ]) {
    stone.push({
      geometry: new THREE.BoxGeometry(w, rimTop, d),
      color: BD_GRANITE_LIGHT,
      position: [ox, rimTop / 2, basinZ + oz],
    });
  }
  const inW = bw - rimT * 2;
  const inD = bd - rimT * 2;
  const bowl = bd_heightSolid(inW / 2 + 0.15, inD / 2 + 0.15, 16, 14, (x, z) => {
    const e = Math.hypot(x / (inW / 2), z / (inD / 2));
    return 0.62 - 0.34 * (1 - Math.min(1, e * e));
  }, { rim: 0.05 });
  bowl.translate(0, 0, basinZ);
  stone.push({ geometry: bowl, color: BD_GRANITE_DARK });
  // An overflow lip at the front, so the fountain is part of a run that goes on downhill --
  // there are sixteen of these fountains and the water leaves every one of them.
  for (const part of bd_channel(1.6, cw, ct, cd, BD_GRANITE_WARM, BD_GRANITE_DARK)) {
    part.geometry.translate(0, rimTop - 0.44, basinZ + bd / 2 + 0.55);
    stone.push(part);
  }

  const stoneGeo = mergeParts(stone);
  tintGeometry(stoneGeo, (p, c) => {
    const n = smoothNoise3(p.x * 0.7 + seed, p.y * 0.7, p.z * 0.7);
    const k = 1 - 0.12 * n - 0.09 * THREE.MathUtils.clamp(1 - p.y / 1.4, 0, 1);
    return [c.r * k, c.g * k, c.b * k];
  });
  g.add(bd_stoneMesh([{ geometry: stoneGeo, color: 0xffffff, keepColor: true }], seed));

  // --- the water ---------------------------------------------------------
  // The pool is OPAQUE and metalness 0. There is no environment map anywhere in this app,
  // so a metallic pool has almost no diffuse response and renders as a hole in the stone --
  // the same trap the Mars life-support cabinet fell into.
  const pool = mesh(
    new THREE.BoxGeometry(inW - 0.1, 0.14, inD - 0.1),
    standard({
      color: 0x6f97a2, roughness: 0.22, metalness: 0,
      emissive: 0x14262c, emissiveIntensity: 0.5,
    }),
    0, waterY, basinZ,
  );
  pool.castShadow = false;
  g.add(pool);

  // THE JET, and it is the world's only transparent mesh here. `chain` caps both ends with
  // a socket ball, so there is no open tube end -- and both caps are buried anyway, one in
  // the spout's throat and one under the surface of the pool.
  const jet = [];
  const drop = spoutY - 0.3 - waterY;
  chain(jet, 0xffffff, [
    { p: [0, spoutY - 0.16, lipZ - 0.3], r: 0.17 },
    { p: [0, spoutY - 0.16 - drop * 0.45, lipZ + 0.24], r: 0.12 },
    { p: [0, waterY - 0.1, lipZ + 0.42], r: 0.15 },
  ], { sides: 10, detail: 8 });
  const jetMesh = mesh(
    mergeParts(jet),
    standard({
      vertexColors: true, color: 0xdcf1f6, transparent: true, opacity: 0.55,
      roughness: 0.12, metalness: 0, emissive: 0x9fd4e0, emissiveIntensity: 0.35,
    }),
  );
  jetMesh.castShadow = false;
  g.add(jetMesh);
  return g;
}
