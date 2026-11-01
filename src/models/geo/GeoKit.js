import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { tube } from '../ModelKit.js';

// The kit behind the World Geography models. A landscape here is a block cut out of the Earth: a
// height function, and one description of it used twice, as the shape of the mesh and as a colour
// painted texel by texel. A tint can only be as detailed as the mesh under it, so everything finer
// than a grid cell lives in the painting, including a second, finer height function that is only
// ever used to shade it. The four cut faces are painted from the same functions, so a river on top
// and the river in the cut face cannot disagree.
//
// Authored in feet, origin at the base centre, front toward +Z. A canvas holds sRGB bytes, so
// colours here are written as they should appear.

export const TAU = Math.PI * 2;
export const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const sstep = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------------------------------------
// Noise. A pure function of position and seed, so two builds of a model are identical.
// ---------------------------------------------------------------------------------------------
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x); const iz = Math.floor(z);
  const fx = x - ix; const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx); const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed); const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed); const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x, z, octaves = 4, seed = 0) {
  let sum = 0; let amp = 0.5; let f = 1; let total = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += noise2(x * f, z * f, seed + i * 17) * amp;
    total += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / total;
}

// Sharp crests and soft valleys: what makes a mountain range read as eroded rather than lumpy.
export function ridged(x, z, octaves = 4, seed = 0) {
  let sum = 0; let amp = 0.5; let f = 1; let total = 0; let prev = 1;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(noise2(x * f, z * f, seed + i * 31));
    const s = n * n;
    sum += s * amp * prev;
    total += amp; prev = clamp01(s * 1.6); amp *= 0.5; f *= 2.1;
  }
  return sum / total;
}

// A smooth run of [x, z] points through hand-placed control points.
export function smoothPath(points, samples = 120) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getPoints(samples).map((p) => [p.x, p.z]);
}

// Distance to a polyline, and how far along it the nearest point is (0..1).
export function pathDistance(path, x, z) {
  let best = Infinity; let at = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    const [ax, az] = path[i]; const [bx, bz] = path[i + 1];
    const dx = bx - ax; const dz = bz - az;
    const t = clamp01(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; at = (i + t) / (path.length - 1); }
  }
  return { d: best, t: at };
}

// An expensive function of position, sampled once on a grid and read back smoothly. A distance to
// a winding river is far too slow to ask per texel, and rounding the question to a cache instead
// shows: both the bank and the water come out with a stair-stepped, dotted edge.
export function sampledField(w, d, nx, nz, fn) {
  const X0 = -w / 2; const Z0 = -d / 2; const ring = nx + 1;
  const data = new Float32Array(ring * (nz + 1));
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) data[i + j * ring] = fn(X0 + (i / nx) * w, Z0 + (j / nz) * d);
  }
  return (x, z) => {
    const fx = clamp01((x - X0) / w) * nx; const fz = clamp01((z - Z0) / d) * nz;
    const i = Math.min(nx - 1, Math.floor(fx)); const j = Math.min(nz - 1, Math.floor(fz));
    const u = fx - i; const v = fz - j; const k = i + j * ring;
    return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v) + (data[k + ring] * (1 - u) + data[k + ring + 1] * u) * v;
  };
}

// ---------------------------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------------------------
function paintTexels(ctx, w, h, fn) {
  const image = ctx.createImageData(w, h);
  const { data } = image;
  const out = [0, 0, 0];
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const c = fn(px, py, out) ?? out;
      const k = (py * w + px) * 4;
      data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
export { paintTexels };

// ---------------------------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------------------------
const DEFAULT_STRATA = (x, z, y) => {
  const band = y * 3.1 + 0.5 * noise2(x * 0.4, z * 0.4, 5);
  const t = band - Math.floor(band);
  const a = [120, 96, 72]; const b = [146, 120, 92];
  return mixc(a, b, t < 0.5 ? t * 2 : 2 - t * 2);
};

/**
 * Builds a landscape block.
 *
 * @param w,d        size in feet
 * @param plinth     height of the wooden base under it
 * @param height     (x, z) => the ground's y, in feet above the origin
 * @param fine       (x, z) => a finer height used ONLY to shade the painting. Defaults to height.
 * @param water      y of a flat water surface, or null
 * @param paint      (x, z, y, slope, shadeLight) => [r, g, b]: the ground's colour
 * @param waterPaint (x, z, depth) => [r, g, b]
 * @param strata     (x, z, y, groundY) => [r, g, b]: the cut faces below the ground
 * @param labels     [{ text, x, y, size }] painted on the front cut face
 */
export function terrainBlock({
  w, d, plinth = 0.3, nx = 170, nz = 120, height, fine = null, water = null, paint,
  waterPaint = null, strata = DEFAULT_STRATA, labels = [], texW = 1400, texH = null, relief = 0.5,
  strip = 256, lightAmount = 0.5, roughness = 0.9, waterSeed = 7, plinthColor = 0x3b2a1c, sectionWater = null,
}) {
  const root = new THREE.Group();
  const X0 = -w / 2; const Z0 = -d / 2;
  const tH = texH ?? Math.round(texW * d / w);
  const surface = (x, z) => (water === null ? height(x, z) : Math.max(height(x, z), water));

  // --- the ground ---
  const ring = nx + 1;
  const hs = new Float32Array(ring * (nz + 1));
  const pos = new Float32Array(hs.length * 3);
  const uv = new Float32Array(hs.length * 2);
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const k = i + j * ring;
      const x = X0 + (i / nx) * w; const z = Z0 + (j / nz) * d;
      hs[k] = height(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = hs[k]; pos[k * 3 + 2] = z;
      uv[k * 2] = i / nx; uv[k * 2 + 1] = 1 - j / nz;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      // Split along the shorter drop, so a ridge does not saw.
      if (Math.abs(hs[a] - hs[e]) < Math.abs(hs[b] - hs[c])) idx.push(a, c, e, a, e, b);
      else idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setIndex(idx);
  land.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  land.computeVertexNormals();

  const shadeHeight = fine ?? height;
  const map = canvasTexture(texW, tH, (ctx) => {
    // Heights at every texel first, because the slope and the baked light both need neighbours.
    const stride = texW + 1;
    const fineH = new Float32Array(stride * (tH + 1));
    const px2x = (px) => X0 + (px / texW) * w;
    const py2z = (py) => Z0 + (py / tH) * d;
    for (let py = 0; py <= tH; py += 1) {
      for (let px = 0; px <= texW; px += 1) fineH[px + py * stride] = shadeHeight(px2x(px), py2z(py));
    }
    const cellX = w / texW; const cellZ = d / tH;
    paintTexels(ctx, texW, tH, (px, py) => {
      const dx = (fineH[px + 1 + py * stride] - fineH[px + py * stride]) / cellX;
      const dz = (fineH[px + (py + 1) * stride] - fineH[px + py * stride]) / cellZ;
      const slope = Math.hypot(dx, dz);
      const x = px2x(px + 0.5); const z = py2z(py + 0.5);
      const y = fineH[px + py * stride];
      // Light from the upper left of the sheet, a little like a shaded relief map. It carries the
      // detail too fine for the mesh, and the world's own sun still does the large forms.
      // Floored, because a cliff must stay rock-coloured: taken to zero it reads as a black hole.
      const lit = Math.max(0.68, (dx * 0.62 + dz * 0.5 + 0.55) / Math.sqrt(dx * dx + dz * dz + 1) * lightAmount + (1 - lightAmount * 0.55));
      const c = paint(x, z, y, slope, lit);
      return shade(c, lit);
    });
  });
  const landMesh = mesh(land, standard({ map, roughness, metalness: 0, bumpMap: map, bumpScale: relief }));
  root.add(landMesh);

  // --- the water ---
  if (water !== null) {
    const wTex = canvasTexture(Math.round(texW * 0.7), Math.round(tH * 0.7), (ctx, cw, ch) => {
      paintTexels(ctx, cw, ch, (px, py) => {
        const x = X0 + ((px + 0.5) / cw) * w; const z = Z0 + ((py + 0.5) / ch) * d;
        const depth = water - height(x, z);
        const ripple = fbm(x * 3.2, z * 5.5, 3, waterSeed) * 7;
        const base = waterPaint ? waterPaint(x, z, depth)
          : mixc([92, 170, 186], [28, 78, 128], sstep(depth, 0, 0.7));
        return [base[0] + ripple, base[1] + ripple, base[2] + ripple];
      });
    });
    const plate = new THREE.BufferGeometry();
    const W = w / 2; const D = d / 2;
    plate.setAttribute('position', new THREE.Float32BufferAttribute([-W, water, -D, W, water, -D, -W, water, D, W, water, D], 3));
    plate.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    plate.setIndex([0, 2, 1, 1, 2, 3]);
    plate.computeVertexNormals();
    const waterMesh = mesh(plate, standard({ map: wTex, roughness: 0.3, metalness: 0.04 }));
    waterMesh.castShadow = false;
    root.add(waterMesh);
  }

  // --- the four cut faces and the floor. They read the same height the ground's edge does, at the
  // same stations, so no crack can open between them. ---
  let yTop = 0;
  const walls = [
    { from: [X0, -Z0], to: [-X0, -Z0], n: nx }, // front, +z
    { from: [-X0, -Z0], to: [-X0, Z0], n: nz }, // right, +x
    { from: [-X0, Z0], to: [X0, Z0], n: nx }, // back, -z
    { from: [X0, Z0], to: [X0, -Z0], n: nz }, // left, -x
  ];
  for (const wall of walls) {
    wall.tops = [];
    for (let i = 0; i <= wall.n; i += 1) {
      const t = i / wall.n;
      const top = surface(mix(wall.from[0], wall.to[0], t), mix(wall.from[1], wall.to[1], t));
      wall.tops.push(top);
      if (top > yTop) yTop = top;
    }
  }
  const atlasW = texW;
  const atlasH = strip * 4;
  const sidePos = []; const sideUv = [];
  const vOf = (wallIndex, y) => 1 - (wallIndex + 1 - (y - plinth) / (yTop - plinth)) / 4;
  walls.forEach((wall, index) => {
    for (let i = 0; i < wall.n; i += 1) {
      const t0 = i / wall.n; const t1 = (i + 1) / wall.n;
      const x0 = mix(wall.from[0], wall.to[0], t0); const z0 = mix(wall.from[1], wall.to[1], t0);
      const x1 = mix(wall.from[0], wall.to[0], t1); const z1 = mix(wall.from[1], wall.to[1], t1);
      const a = [x0, plinth, z0, t0, vOf(index, plinth)];
      const b = [x1, plinth, z1, t1, vOf(index, plinth)];
      const c = [x1, wall.tops[i + 1], z1, t1, vOf(index, wall.tops[i + 1])];
      const e = [x0, wall.tops[i], z0, t0, vOf(index, wall.tops[i])];
      for (const v of [a, b, c, a, c, e]) { sidePos.push(v[0], v[1], v[2]); sideUv.push(v[3], v[4]); }
    }
  });
  // The floor, seen by nothing, is what makes the block a closed solid.
  const floorV = (x, z) => [x, plinth, z, 0, 0];
  for (const v of [floorV(X0, Z0), floorV(-X0, Z0), floorV(-X0, -Z0), floorV(X0, Z0), floorV(-X0, -Z0), floorV(X0, -Z0)]) {
    sidePos.push(v[0], v[1], v[2]); sideUv.push(v[3], v[4]);
  }
  const sides = new THREE.BufferGeometry();
  sides.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
  sides.setAttribute('uv', new THREE.Float32BufferAttribute(sideUv, 2));
  sides.computeVertexNormals();
  const sideMap = canvasTexture(atlasW, atlasH, (ctx) => {
    paintTexels(ctx, atlasW, atlasH, (px, py) => {
      const wallIndex = Math.min(3, Math.floor(py / strip));
      const wall = walls[wallIndex];
      const t = (px + 0.5) / atlasW;
      const x = mix(wall.from[0], wall.to[0], t); const z = mix(wall.from[1], wall.to[1], t);
      const y = yTop - ((py - wallIndex * strip + 0.5) / strip) * (yTop - plinth);
      const ground = height(x, z);
      if (y > ground) {
        if (water !== null && y <= water) {
          const depth = water - y;
          return sectionWater ? sectionWater(depth) : mixc([52, 132, 170], [20, 58, 104], sstep(depth, 0, 1.6));
        }
        return [0, 0, 0];
      }
      return strata(x, z, y, ground);
    });
    // Labels on the front face, sized in feet. The atlas does not have square texels in feet, so
    // the text is drawn through a scale or it comes out stretched sideways.
    const pxX = atlasW / w; const pxY = strip / (yTop - plinth);
    for (const label of labels) {
      const size = (label.size ?? 0.26) * pxY;
      ctx.save();
      ctx.translate(((label.x - X0) / w) * atlasW, ((yTop - label.y) / (yTop - plinth)) * strip);
      ctx.scale(pxX / pxY, 1);
      ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
      const width = ctx.measureText(label.text).width;
      const pad = size * 0.4;
      ctx.fillStyle = 'rgba(16, 20, 26, 0.74)';
      ctx.fillRect(-width / 2 - pad, -size * 0.74, width + pad * 2, size * 1.45);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
    }
  });
  root.add(mesh(sides, standard({ map: sideMap, roughness: 0.92, metalness: 0 })));

  root.add(woodenBase(w + 0.5, d + 0.5, plinth, plinthColor));
  return { root, surface, landMesh, ground: height, X0, Z0 };
}

// A plain base with a moulded step. Two boxes, merged: nothing to come apart.
export function woodenBase(w, d, h, color = 0x3b2a1c) {
  const lower = new THREE.BoxGeometry(w, h * 0.62, d).toNonIndexed();
  lower.translate(0, h * 0.31, 0);
  const upper = new THREE.BoxGeometry(w - h * 0.5, h * 0.38, d - h * 0.5).toNonIndexed();
  upper.translate(0, h * 0.81, 0);
  return mesh(mergeGeometries([lower, upper]), standard({ color, roughness: 0.62, metalness: 0 }));
}

// ---------------------------------------------------------------------------------------------
// Scenery: everything small, merged into one vertex-coloured mesh.
// ---------------------------------------------------------------------------------------------
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

export class Batch {
  constructor() { this.parts = []; }

  // `color` is a hex, or (x, y, z) => [r, g, b] in linear 0..1 for a per-vertex tint.
  add(geometry, color, { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    tmpE.set(rotation[0], rotation[1], rotation[2], 'YXZ');
    tmpQ.setFromEuler(tmpE);
    tmpM.compose(new THREE.Vector3(...position), tmpQ, new THREE.Vector3(...scale));
    g.applyMatrix4(tmpM);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    if (color === null) {
      // The geometry already carries its own colours.
      arr.set(g.attributes.color.array);
    } else if (typeof color === 'function') {
      const p = g.attributes.position;
      for (let i = 0; i < n; i += 1) {
        const c = color(p.getX(i), p.getY(i), p.getZ(i));
        arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
      }
    } else {
      const c = Array.isArray(color) ? { r: color[0], g: color[1], b: color[2] } : new THREE.Color(color);
      for (let i = 0; i < n; i += 1) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key);
    }
    this.parts.push(g);
    return this;
  }

  mesh(params = {}) {
    return mesh(mergeGeometries(this.parts), standard({ vertexColors: true, roughness: 0.82, metalness: 0, ...params }));
  }
}

// A blob with soft normals, so a crown of them reads as foliage rather than as cut gems.
export function blobGeometry(rng, detail = 1, bump = 0.16) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const phase = rng() * 50;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const k = 1 + bump * Math.sin(x * 3.1 + phase) * Math.sin(y * 2.7 + phase * 0.7) * Math.sin(z * 3.3 - phase);
    p.setXYZ(i, x * k, y * k, z * k);
    n[i * 3] = x; n[i * 3 + 1] = y; n[i * 3 + 2] = z;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// A crown of many small clumps with a colour each. A few big smooth blobs read as balloons, and it
// is the broken outline and the patchy tone that make foliage.
export function addCrown(batch, x, y, z, w, h, count, greens, rng, detail = 1) {
  for (let i = 0; i < count; i += 1) {
    const a = rng() * TAU; const q = Math.sqrt(rng());
    const lift = (rng() * 2 - 1);
    const px = x + Math.cos(a) * q * w * 0.8; const pz = z + Math.sin(a) * q * w * 0.8;
    const py = y + lift * h * 0.34 * Math.sqrt(1 - q * q * 0.7) + (1 - q) * h * 0.22;
    const size = w * (0.26 + rng() * 0.16);
    const base = new THREE.Color(greens[Math.floor(rng() * greens.length)]);
    const k = 0.84 + rng() * 0.34;
    batch.add(blobGeometry(rng, detail, 0.2), [base.r * k, base.g * k, base.b * k], {
      position: [px, py, pz], scale: [size, size * (h / w) * 1.05, size], rotation: [rng() * 3, rng() * 3, 0],
    });
  }
}

export function addPine(batch, x, y, z, h, rng, color = 0x2c4d33) {
  const c = new THREE.Color(color);
  batch.add(new THREE.CylinderGeometry(h * 0.025, h * 0.04, h * 0.3, 5), 0x4a3524, { position: [x, y + h * 0.13, z] });
  for (let i = 0; i < 3; i += 1) {
    const r = h * (0.24 - i * 0.055); const tall = h * (0.46 - i * 0.05);
    const k = 0.88 + rng() * 0.28;
    batch.add(new THREE.ConeGeometry(r, tall, 7), [c.r * k, c.g * k, c.b * k], {
      position: [x, y + h * (0.33 + i * 0.235), z], rotation: [0, rng() * TAU, 0],
    });
  }
}

export function addBroadleaf(batch, x, y, z, h, rng, greens = [0x3f7a35, 0x4f8c3c, 0x2f6a30], { detail = 1, trunk = 0x54402c } = {}) {
  const crown = h * (0.34 + rng() * 0.08);
  batch.add(new THREE.CylinderGeometry(h * 0.035, h * 0.06, h * 0.72, 6), trunk, { position: [x, y + h * 0.36, z] });
  const puffs = 3 + Math.floor(rng() * 3);
  batch.add(blobGeometry(rng, detail), greens[Math.floor(rng() * greens.length)], {
    position: [x, y + h - crown * 0.75, z], scale: [crown, crown * 0.78, crown], rotation: [0, rng() * TAU, 0],
  });
  for (let i = 0; i < puffs; i += 1) {
    const a = rng() * TAU; const r = crown * (0.45 + rng() * 0.35); const s = crown * (0.45 + rng() * 0.25);
    batch.add(blobGeometry(rng, detail), greens[Math.floor(rng() * greens.length)], {
      position: [x + Math.cos(a) * r, y + h - crown * (0.55 + rng() * 0.45), z + Math.sin(a) * r], scale: [s, s * 0.8, s],
    });
  }
}

export function addPalm(batch, x, y, z, h, rng, { frond = 0x3d8a3a, trunk = 0x7a6248, fronds = 8 } = {}) {
  const lean = rng() * TAU; const bend = h * (0.08 + rng() * 0.14);
  const tx = x + Math.cos(lean) * bend; const tz = z + Math.sin(lean) * bend; const ty = y + h;
  batch.add(tube([[x, y - 0.02, z], [x + Math.cos(lean) * bend * 0.35, y + h * 0.55, z + Math.sin(lean) * bend * 0.35], [tx, ty, tz]], [h * 0.034, h * 0.022, h * 0.02], { sides: 5, steps: 6 }), trunk);
  for (let i = 0; i < fronds; i += 1) {
    const a = (i / fronds) * TAU + rng() * 0.4; const len = h * (0.34 + rng() * 0.12);
    const cx = Math.cos(a); const cz = Math.sin(a);
    const pts = [[tx, ty, tz], [tx + cx * len * 0.45, ty + len * 0.2, tz + cz * len * 0.45], [tx + cx * len * 0.85, ty - len * 0.02, tz + cz * len * 0.85], [tx + cx * len * 1.05, ty - len * 0.36, tz + cz * len * 1.05]];
    batch.add(tube(pts, [h * 0.012, h * 0.03, h * 0.022, 0], { sides: 4, steps: 6 }), frond);
  }
}

// A house: a box and a gable prism with its ridge along the box's width.
export function addHouse(batch, x, y, z, w, d, h, wall, roof, yaw = 0, roofH = null) {
  const rh = roofH ?? h * 0.55;
  batch.add(new THREE.BoxGeometry(w, h, d), wall, { position: [x, y + h / 2, z], rotation: [0, yaw, 0] });
  const prism = new THREE.BufferGeometry();
  const W = w * 0.56; const D = d * 0.6;
  // Two slopes and two gables, wound outward.
  const v = [
    -W, 0, D, W, 0, D, W, rh, 0, -W, 0, D, W, rh, 0, -W, rh, 0,
    W, 0, -D, -W, 0, -D, -W, rh, 0, W, 0, -D, -W, rh, 0, W, rh, 0,
    W, 0, D, W, 0, -D, W, rh, 0,
    -W, 0, -D, -W, 0, D, -W, rh, 0,
    -W, 0, D, -W, 0, -D, W, 0, -D, -W, 0, D, W, 0, -D, W, 0, D,
  ];
  prism.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  prism.computeVertexNormals();
  batch.add(prism, roof, { position: [x, y + h, z], rotation: [0, yaw, 0] });
}

// ---------------------------------------------------------------------------------------------
// Signs: every label in one atlas, on one mesh, readable from both sides. The posts go in the
// scenery batch. They stand on what they name.
// ---------------------------------------------------------------------------------------------
export function signs(root, batch, list, { post = 0x2b2f35, plate = 0.42, yaw = 0 } = {}) {
  const rowH = 64; const atlasW = 1024;
  const texture = canvasTexture(atlasW, rowH * list.length, (ctx, w, h) => {
    ctx.fillStyle = '#fbf8ef';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    list.forEach((sign, i) => {
      let size = 44;
      ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
      const wide = ctx.measureText(sign.text).width;
      if (wide > atlasW - 24) { size = Math.floor(size * (atlasW - 24) / wide); ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`; }
      ctx.fillStyle = '#1f2b33';
      ctx.fillText(sign.text, w / 2, rowH * (i + 0.5) + 2);
    });
  });
  texture.flipY = true;
  const pos = []; const uv = [];
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  list.forEach((sign, i) => {
    const aspect = atlasW / rowH;
    // Shrink the plate to its words, by cropping the row symmetrically.
    const chars = Math.max(4, sign.text.length);
    const frac = Math.min(1, (chars * 26 + 46) / atlasW);
    const width = plate * aspect * frac;
    const y0 = sign.y; const y1 = sign.y + plate;
    const u0 = 0.5 - frac / 2; const u1 = 0.5 + frac / 2;
    const v0 = 1 - (i + 1) / list.length; const v1 = 1 - i / list.length;
    const hw = width / 2;
    // A sign that reads off a pole takes `left` instead of `x`: its plate starts there.
    if (sign.left !== undefined) sign.x = sign.left + hw;
    const P = (lx, y, off) => [sign.x + lx * c + off * s, y, sign.z - lx * s + off * c];
    const quad = (a, b, e, f, ua, ub) => {
      for (const [p, u, v] of [[a, ua, v0], [b, ub, v0], [e, ub, v1], [a, ua, v0], [e, ub, v1], [f, ua, v1]]) {
        pos.push(p[0], p[1], p[2]); uv.push(u, v);
      }
    };
    const off = 0.012;
    quad(P(-hw, y0, off), P(hw, y0, off), P(hw, y1, off), P(-hw, y1, off), u0, u1);
    quad(P(hw, y0, -off), P(-hw, y0, -off), P(-hw, y1, -off), P(hw, y1, -off), u0, u1);
    const bottom = sign.ground ?? 0;
    // The post stops under the plate. Run up behind it, it reads as a line through the words.
    if (sign.y - bottom > 0.02) batch.add(new THREE.CylinderGeometry(0.035, 0.045, sign.y - bottom, 6), post, { position: [sign.x, (sign.y + bottom) / 2, sign.z] });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = mesh(g, standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.22, roughness: 0.8 }));
  // No shadows from a label: a plate this wide lays a dark bar across whatever it names.
  m.receiveShadow = false;
  m.castShadow = false;
  root.add(m);
}

export { seededRandom };
