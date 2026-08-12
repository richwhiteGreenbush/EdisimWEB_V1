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
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

// Convenience wrapper: mergeColored() straight into a vertex-colored mesh.
export function mergedMesh(parts, materialParams = {}) {
  return mesh(mergeColored(parts), standard({ vertexColors: true, roughness: 0.75, ...materialParams }));
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
export function signPanel(width, height, texture, { emissive = null } = {}) {
  const material = standard({
    map: texture,
    roughness: 0.85,
    side: THREE.DoubleSide,
    ...(emissive ? { emissive: new THREE.Color(emissive), emissiveMap: texture, emissiveIntensity: 0.35 } : {}),
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
export function taperedTube(points, radii, { tubularSegments = 26, radialSegments = 8 } = {}) {
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
