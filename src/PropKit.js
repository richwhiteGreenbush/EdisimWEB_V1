import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared low-level helpers for the procedural preset-world props (see src/props/).
//
// House rules every builder in src/props/ follows:
//   * Everything is authored directly in FEET at scale 1 -- these are not user
//     imports, so they never go through ModelLoader.scaleToHeight().
//   * A builder returns a THREE.Group whose local origin is its BASE CENTER, so
//     WorldPresets can place it with position.set(x, groundHeightAt(x, z), z) and
//     nothing else. Anything that deliberately floats (Earth in the moon sky) gets
//     an explicit yOffset in the layout instead of breaking that rule.
//   * Materials and textures are built fresh per call, never shared between two
//     builders. PlacedRegistry.disposeObject3D() disposes a removed object's
//     materials/maps outright, so a material instance shared across two registry
//     roots would be destroyed out from under the survivor.

export function standard(params) {
  return new THREE.MeshStandardMaterial(params);
}

// castShadow/receiveShadow on by default: the sun's shadow camera already covers the
// whole ground plane, and self-shadowing is most of what sells these as solid objects.
export function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  return mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

export function cyl(radiusTop, radiusBottom, height, material, x = 0, y = 0, z = 0, segments = 20) {
  return mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material, x, y, z);
}

export function sphere(radius, material, x = 0, y = 0, z = 0, segments = 24) {
  return mesh(new THREE.SphereGeometry(radius, segments, Math.max(8, segments >> 1)), material, x, y, z);
}

export function group(...children) {
  const g = new THREE.Group();
  for (const child of children) if (child) g.add(child);
  return g;
}

// Merges many small solids into ONE geometry carrying per-vertex colors, so a shelf of
// 30 books or a wire wheel of 40 spokes costs a single draw call instead of dozens.
// Each part is { geometry, color, position?, rotation? } -- rotation is applied first,
// then position, matching how the same values would read on an Object3D.
//
// mergeGeometries() refuses a mix of indexed and non-indexed inputs, and three.js is
// inconsistent about which it hands back (Box/Cylinder/Sphere/Torus are indexed;
// Icosahedron and anything from PolyhedronGeometry is not). Rather than make every
// caller remember that, this drops everything to non-indexed when the batch is mixed.
export function mergeColored(parts) {
  const geometries = [];
  const tint = new THREE.Color();
  const mixedIndexing =
    parts.some((p) => p.geometry.index) && parts.some((p) => !p.geometry.index);

  for (const part of parts) {
    let geometry = part.geometry.clone();
    if (mixedIndexing && geometry.index) geometry = geometry.toNonIndexed();
    geometry.clearGroups();

    if (part.rotation) {
      const [rx, ry, rz] = part.rotation;
      if (rx) geometry.rotateX(rx);
      if (ry) geometry.rotateY(ry);
      if (rz) geometry.rotateZ(rz);
    }
    if (part.position) geometry.translate(part.position[0], part.position[1], part.position[2]);

    tint.set(part.color ?? 0xffffff);
    const count = geometry.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  }

  const merged = mergeGeometries(geometries, false);

  // PART RANGES: where each input's vertices ended up inside the merged buffer.
  //
  // Six lines, a few dozen bytes per prop, and they are the whole difference between "the
  // T. rex is one merged mesh, so nothing on it can move" and "the T. rex's jaw opens for
  // zero draw calls". This loop was already walking the parts one at a time and already
  // reading each one's position.count to size the colour array -- it simply threw the
  // ranges away.
  //
  // A part can be NAMED (`part.part = 'jaw'`) so a builder's tick can find its own pieces
  // without counting them, which is what stops an articulated prop breaking silently the
  // next time somebody inserts a solid halfway up its parts list.
  //
  // THE RULE THAT COMES WITH THIS: anything that moves a range must recompute the
  // geometry's bounding volumes afterwards, or three separate things break and none of
  // them looks like the same bug -- the mesh is frustum-culled against a stale sphere and
  // VANISHES when you look slightly away; ObjectMenu's raycast early-outs on that same
  // sphere so the moved part is clickable only where it used to be; and PlayIcon does a
  // fresh Box3.setFromObject every frame, which reads the stale box, so the green play
  // button hangs in the air over where the animal was standing. See PropKit.rotateRange().
  const ranges = [];
  let offset = 0;
  for (let i = 0; i < geometries.length; i++) {
    const count = geometries[i].attributes.position.count;
    ranges.push({ name: parts[i].part ?? null, start: offset, count });
    offset += count;
  }
  merged.userData.partRanges = ranges;

  for (const geometry of geometries) geometry.dispose();
  return merged;
}

// Rotates one merged part in place, about a pivot, on the CPU.
//
// Deliberately not a shader. Nothing in src/ has ever patched a shader; PropKit.mesh()
// sets castShadow unconditionally so a shader-displaced jaw would cast a rigid rest-pose
// shadow; and ObjectMenu raycasts CPU geometry, so a shader-moved jaw would be clickable
// only where it used to be. Rotating two thousand vec3s is tens of microseconds on the
// machine this is built for, and has none of those problems.
export function rotateRange(geometry, range, axis, angle, pivot) {
  if (!range || !angle) return;
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  const v = new THREE.Vector3();
  const end = range.start + range.count;
  for (let i = range.start; i < end; i++) {
    v.fromBufferAttribute(pos, i).sub(pivot).applyQuaternion(q).add(pivot);
    pos.setXYZ(i, v.x, v.y, v.z);
    if (nor) {
      v.fromBufferAttribute(nor, i).applyQuaternion(q);
      nor.setXYZ(i, v.x, v.y, v.z);
    }
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  // Not optional -- see the note in mergeColored above.
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

// Finds a named range on a merged geometry.
export function partRange(geometry, name) {
  return geometry.userData.partRanges?.find((r) => r.name === name) || null;
}

// Convenience wrapper: mergeColored() straight into a vertex-colored mesh.
export function mergedMesh(parts, materialParams = {}) {
  return mesh(mergeColored(parts), standard({ vertexColors: true, roughness: 0.75, ...materialParams }));
}

// ---------------------------------------------------------------------------
// Procedural surface relief
// ---------------------------------------------------------------------------

// Every prop in this project is built from smooth analytic solids -- boxes, cylinders,
// spheres, swept tubes -- and a smooth solid under a single sun reads as plastic no
// matter what colour it is painted. `relief()` below is what breaks that up: a small
// tileable greyscale height field wired in as a **bumpMap**, which perturbs the surface
// normal per pixel so the light catches grain, pitting and weathering that the geometry
// does not actually have.
//
// bumpMap specifically, and NOT a colour map, for two reasons:
//
//  1. Nearly every prop here is a merged, vertex-coloured mesh, and a material carrying
//     BOTH a `map` and `vertexColors` MULTIPLIES the two -- the mistake that turned the
//     bear dens' facade near-black (see the merge notes in CLAUDE.md). A bumpMap does
//     not touch colour at all, so it composes safely with vertex colours, with a real
//     texture map, or with a plain flat colour.
//  2. It costs one greyscale texture and no extra geometry. Getting the same relief out
//     of triangles would multiply the vertex count of every object in every world.
//
// The trade-off worth knowing: a bumpMap fakes lighting, not silhouette. It disappears
// at grazing angles and never self-shadows, so it is right for grain and weathering and
// wrong for anything whose outline should visibly change.

const RELIEF_TILE = 96; // px per tile -- small on purpose, see the cost note in relief()
const RELIEF_GRID = 8; // noise lattice cells across one tile

// Tileable value noise. The lattice wraps at `gridSize`, so ANY integer multiple of it
// samples seamlessly -- which is what lets the patterns below stack octaves and stretch
// axes freely and still tile. Deterministic from `seed`, like everything else here: a
// world rebuilt from its records has to come back looking identical.
function makeNoise(gridSize, seed) {
  const rng = seededRandom(seed);
  const lattice = new Float32Array(gridSize * gridSize);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();

  return function sample(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx); // smoothstep, so the lattice does not show as a grid
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = ((x0 % gridSize) + gridSize) % gridSize;
    const j0 = ((y0 % gridSize) + gridSize) % gridSize;
    const i1 = (i0 + 1) % gridSize;
    const j1 = (j0 + 1) % gridSize;
    const a = lattice[j0 * gridSize + i0];
    const b = lattice[j0 * gridSize + i1];
    const c = lattice[j1 * gridSize + i0];
    const d = lattice[j1 * gridSize + i1];
    const top = a + (b - a) * sx;
    const bottom = c + (d - c) * sx;
    return top + (bottom - top) * sy;
  };
}

// Each pattern maps (noise, u, v) in tile space to a height in [0, 1]. The trick in all
// of them is ANISOTROPY: a material's character is mostly in which direction its detail
// runs, so bark stretches the noise vertically into fibres, brushed metal stretches it
// the other way, and only stone is left isotropic.
const RELIEF_PATTERNS = {
  // Long vertical fibres split by a few deep furrows -- the furrows are what actually
  // reads as bark; fibre alone just looks like dirt.
  bark: (n, u, v) => {
    const fibre = n(u * 64, v * 8) * 0.62 + n(u * 128, v * 24) * 0.24;
    const wander = n(u * 16, v * 8) * 0.14;
    const furrow = Math.abs(Math.sin((u + wander) * Math.PI * 2 * 5));
    return fibre * 0.62 + Math.pow(furrow, 0.5) * 0.38;
  },
  // Grain running the long way, plus a plank seam every quarter tile.
  wood: (n, u, v) => {
    const grain = n(u * 8, v * 96) * 0.7 + n(u * 16, v * 48) * 0.3;
    const seam = Math.min(1, Math.abs(((v * 4) % 1) - 0.5) * 7);
    return 0.25 + grain * 0.55 * seam + seam * 0.2;
  },
  // Plain three-octave fBm: rock has no preferred direction, and pretending it does is
  // what makes procedural stone look like fabric.
  stone: (n, u, v) => {
    const f = n(u * 8, v * 8) * 0.55 + n(u * 24, v * 24) * 0.29 + n(u * 64, v * 64) * 0.16;
    return Math.pow(f, 1.25);
  },
  // Brushed: heavily stretched across u, and deliberately low-contrast. Metal that is
  // visibly bumpy reads as corroded, which is not what most of this hardware is.
  metal: (n, u, v) => 0.45 + (n(u * 4, v * 128) * 0.7 + n(u * 8, v * 64) * 0.3) * 0.3,
  // Clumped grit -- loose soil, regolith, dust.
  soil: (n, u, v) => {
    const clump = n(u * 12, v * 12) * 0.5 + n(u * 40, v * 40) * 0.3 + n(u * 96, v * 96) * 0.2;
    return Math.pow(clump, 0.85);
  },
  // Over-under crosshatch, for cloth and canvas.
  weave: (n, u, v) => {
    const warp = Math.abs(Math.sin(u * Math.PI * 2 * 24));
    const weft = Math.abs(Math.sin(v * Math.PI * 2 * 24));
    return 0.35 + Math.max(warp, weft) * 0.45 + n(u * 32, v * 32) * 0.2;
  },
  // Pebbled reptile hide: irregular polygonal scales with a sunken seam between them.
  //
  // A CELL pattern, not noise, and that is the whole point. `soil` was standing in for hide
  // before this existed and it reads as grit -- clumps at no particular size, with nothing
  // tiling. Real reptile skin is a mosaic of tubercles of ONE rough size with a crease
  // between every pair, and what the eye picks up on a big animal at arm's length is those
  // creases catching the light. So this measures the distance to the nearest of a set of
  // jittered cell centres (a wrapped Worley pattern) and darkens the boundaries where two
  // cells meet, giving a dome per scale and a valley round each one.
  //
  // The lattice wraps at CELL_GRID exactly as makeNoise's does, so the tile still repeats
  // seamlessly at any integer multiple -- which matters here more than anywhere, because
  // hide is asked for at a repeat of 14 or more.
  hide: (n, u, v) => {
    const G = 7; // cells across one tile
    const su = u * G;
    const sv = v * G;
    const cu = Math.floor(su);
    const cv = Math.floor(sv);
    let nearest = 9;
    let second = 9;
    for (let dv = -1; dv <= 1; dv++) {
      for (let du = -1; du <= 1; du++) {
        // Jitter each cell centre by the SAME wrapped noise field, so neighbouring tiles
        // agree about where their shared cells are.
        const gu = cu + du;
        const gv = cv + dv;
        const ju = n(((gu % G) + G) % G + 0.5, ((gv % G) + G) % G + 0.5);
        const jv = n(((gv % G) + G) % G + 3.5, ((gu % G) + G) % G + 1.5);
        const d = Math.hypot(su - (gu + 0.15 + ju * 0.7), sv - (gv + 0.15 + jv * 0.7));
        if (d < nearest) { second = nearest; nearest = d; } else if (d < second) { second = d; }
      }
    }
    // A dome across each cell, plus a hard crease where two cells are equidistant.
    const dome = 1 - Math.min(1, nearest / 0.62);
    const seam = Math.min(1, (second - nearest) * 3.4);
    const grain = n(u * 96, v * 96) * 0.12;
    return 0.24 + Math.pow(dome, 0.7) * 0.42 * seam + seam * 0.22 + grain;
  },
};

// How pronounced each surface is by default. bumpScale is roughly "how far the fake
// normal leans", so these are tuned by eye against a 5ft player standing next to the
// prop -- close enough to see the grain, far enough that it does not boil.
const RELIEF_STRENGTH = { bark: 0.85, wood: 0.4, stone: 0.6, metal: 0.14, soil: 0.9, weave: 0.3, hide: 0.7 };

// Renders one tile of `kind` as a greyscale height field.
//
// NoColorSpace, not the sRGB that canvasTexture() sets: a bump map is DATA, not colour,
// and putting it through the sRGB decode would silently reshape every height in it.
function reliefTexture(kind, seed, repeat, size) {
  const pattern = RELIEF_PATTERNS[kind];
  const noise = makeNoise(RELIEF_GRID, seed);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const height = pattern(noise, x / size, y / size);
      const value = Math.max(0, Math.min(255, Math.round(height * 255)));
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

// Material parameters adding `kind` surface relief, to spread into standard()/mergedMesh():
//
//     mergedMesh(parts, { roughness: 0.9, ...relief('bark', { seed }) })
//
// A FRESH texture per call, never a shared cached one -- PlacedRegistry.disposeObject3D()
// disposes a removed object's bumpMap outright, so one cached tile handed to two props
// would be destroyed out from under whichever of them survived the other. That is why
// the tile is only 96px square: at ~9k pixels it costs well under a millisecond to
// generate, and a world places a few hundred of them during one load.
export function relief(kind, { seed = 7, repeat = 3, size = RELIEF_TILE, strength } = {}) {
  if (!RELIEF_PATTERNS[kind]) throw new Error(`Unknown relief surface: "${kind}"`);
  return {
    bumpMap: reliefTexture(kind, seed, repeat, size),
    bumpScale: strength ?? RELIEF_STRENGTH[kind],
  };
}

// ---------------------------------------------------------------------------
// Canvas-drawn textures
// ---------------------------------------------------------------------------

export function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

// Word-wraps `text` to `maxWidth` under the context's CURRENT font, returning the lines.
// Split out from wrapText so a caller can find out how tall a block will be before
// committing to drawing it -- which is what lets cardTexture below size its own type.
export function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Word-wraps `text` to `maxWidth` and draws it from (x, y) downward, returning the y
// baseline just past the last line so callers can stack blocks of text.
export function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  let cursorY = y;
  for (const line of wrapLines(ctx, text, maxWidth)) {
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
  return cursorY;
}

// The museum/library/moon info-card artwork: a heading rule, a title, and a body
// paragraph on a warm card. Shared so every placard, plaque, and sign in all three
// worlds reads as one consistent design language.
export function cardTexture({
  title,
  body,
  eyebrow,
  accent = '#8c6b3f',
  background = '#f4efe4',
  ink = '#2a2622',
  width = 640,
  height = 400,
}) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    let y = 76;
    if (eyebrow) {
      ctx.fillStyle = accent;
      ctx.font = 'bold 24px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(String(eyebrow).toUpperCase(), 46, y);
      y += 20;
    }

    ctx.fillStyle = ink;
    ctx.font = 'bold 40px Georgia, "Times New Roman", serif';
    y = wrapText(ctx, title, 46, y + 34, w - 92, 46);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(46, y + 6);
    ctx.lineTo(46 + 120, y + 6);
    ctx.stroke();

    // The body is fitted to whatever room the title left, rather than drawn at a fixed
    // size and allowed to run off the bottom of the card. A placard whose last sentence
    // is clipped is worse than one set a point or two smaller, and how many lines a
    // title wraps to is not something the caller can predict from the outside.
    if (body) {
      ctx.fillStyle = ink;
      const top = y + 52;
      const available = h - 34 - top;
      let lineHeight = 33;
      for (const size of [25, 23, 21, 19, 17]) {
        lineHeight = Math.round(size * 1.32);
        ctx.font = `${size}px Georgia, "Times New Roman", serif`;
        if (wrapLines(ctx, body, w - 92).length * lineHeight <= available) break;
      }
      wrapText(ctx, body, 46, top, w - 92, lineHeight);
    }
  });
}

// A flat, double-sided sign face. Used for placards, aisle signs, and building signage.
export function signPanel(width, height, texture, { emissive = null, emissiveIntensity = 0.35 } = {}) {
  const material = standard({
    map: texture,
    roughness: 0.85,
    side: THREE.DoubleSide,
    ...(emissive ? { emissive: new THREE.Color(emissive), emissiveMap: texture, emissiveIntensity } : {}),
  });
  return mesh(new THREE.PlaneGeometry(width, height), material);
}

// ---------------------------------------------------------------------------
// Small shared solids
// ---------------------------------------------------------------------------

// A fluted classical column: shaft + torus base + flared capital, total `height` feet.
export function classicalColumn(height, radius, material) {
  const shaftHeight = height * 0.86;
  const g = new THREE.Group();
  g.add(cyl(radius * 1.25, radius * 1.35, height * 0.05, material, 0, height * 0.025, 0, 16));
  g.add(cyl(radius * 0.92, radius, shaftHeight, material, 0, height * 0.05 + shaftHeight / 2, 0, 20));
  const capY = height * 0.05 + shaftHeight;
  g.add(cyl(radius * 1.15, radius * 0.95, height * 0.05, material, 0, capY + height * 0.025, 0, 20));
  g.add(box(radius * 2.6, height * 0.04, radius * 2.6, material, 0, capY + height * 0.07, 0));
  return g;
}

// Triangular pediment (the gable over a classical portico), extruded along Z.
export function pediment(width, height, depth, material) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return mesh(geometry, material);
}

// A tube of VARYING radius swept along a Catmull-Rom curve through `points`.
//
// three.js's own TubeGeometry is constant-radius, which is no use for the thing this
// exists for: a neck, a tail, a limb or a torso is *defined* by its taper. `radii` is
// one radius per control point, resampled smoothly along the curve, and a radius of 0
// closes the end to a point (a tail tip) so no cap is needed.
//
// Returns an INDEXED geometry with correct normals, so it drops straight into
// mergeColored() alongside boxes and cylinders -- which is the point, since an animal
// built this way is a dozen tubes that must end up as one draw call.
// radialSegments defaults to 14, not 8, and that number is doing more work than it
// looks. A tube's rendered surface is INSET from its nominal radius by cos(pi/n) at the
// flats -- 7.6% at 8 sides, 2.5% at 14. Where a limb plugs into a torso, both surfaces
// retreat inward by that much, and because two tubes' Frenet frames are unrelated their
// flats meet at arbitrary angles, so the worst case shows as a genuine V-shaped notch at
// the joint. On a 3ft torso and a 2ft thigh that was nearly half a foot of apparent gap.
// Raising it is the single cheapest fix for the whole class of "the leg does not meet
// the body" problem, and it rounds every body in both worlds as a side effect.
// Small details still pass an explicit low count -- a 0.3ft dendrite gains nothing here.
export function taperedTube(points, radii, { tubularSegments = 26, radialSegments = 14 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const frames = curve.computeFrenetFrames(tubularSegments, false);

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const center = new THREE.Vector3();

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    curve.getPointAt(t, center);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];

    // Resample the per-control-point radii onto the curve's arc parameter.
    const span = (radii.length - 1) * t;
    const index = Math.min(Math.floor(span), radii.length - 2);
    const radius = THREE.MathUtils.lerp(radii[index], radii[index + 1], span - index);

    for (let j = 0; j <= radialSegments; j++) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = -Math.cos(angle);
      const nx = cos * normal.x + sin * binormal.x;
      const ny = cos * normal.y + sin * binormal.y;
      const nz = cos * normal.z + sin * binormal.z;
      positions.push(center.x + radius * nx, center.y + radius * ny, center.z + radius * nz);
      normals.push(nx, ny, nz);
      uvs.push(t, j / radialSegments);
    }
  }

  for (let i = 1; i <= tubularSegments; i++) {
    for (let j = 1; j <= radialSegments; j++) {
      const a = (radialSegments + 1) * (i - 1) + (j - 1);
      const b = (radialSegments + 1) * i + (j - 1);
      const c = (radialSegments + 1) * i + j;
      const d = (radialSegments + 1) * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

export function randomIn(rng, min, max) {
  return min + rng() * (max - min);
}

// Roughens a sphere-like geometry into a natural boulder shape.
//
// **The displacement must be a smooth function of DIRECTION, never a fresh random
// number per vertex.** IcosahedronGeometry (and everything else from
// PolyhedronGeometry) is NON-INDEXED: every triangle carries its own copy of each
// corner. Jittering per vertex index therefore moves each copy somewhere different,
// tearing the surface into disconnected overlapping triangles -- the result reads as a
// heap of shattered grey paper, not as rock. Sampling continuous waves off the
// normalized direction gives every copy of a shared corner the same displacement, so
// the shell stays welded.
//
// `flatten` squashes the result vertically afterwards, for boulders that sit low.
export function roughenSphere(geometry, { amount = 0.18, flatten = 1, phase = 0 } = {}) {
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const length = p.length() || 1;
    const nx = p.x / length;
    const ny = p.y / length;
    const nz = p.z / length;

    const wave =
      Math.sin(nx * 5.1 + phase) * Math.cos(ny * 4.3 - phase * 0.7) +
      Math.sin(nz * 6.7 + phase * 1.3) * 0.6 +
      Math.cos((nx + nz) * 3.3 - phase) * 0.4;

    p.multiplyScalar(1 + (wave / 2) * amount);
    p.y *= flatten;
    position.setXYZ(i, p.x, p.y, p.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Deterministic PRNG so a world rebuilt from a saved record looks identical to the one
// the student saw when they first loaded it -- Math.random() would reshuffle every
// bookshelf and boulder field on each rehydrate.
export function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
