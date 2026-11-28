import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { lin, clamp01, outward, alongMatrix, mix } from '../ModelKit.js';

// Private helpers for builders/FutureWorks.js (Build a Future City's works: drone port, wind tree,
// air-cleaning tower, hologram kiosk, rain garden plaza). Nothing here is shared with another file.

export function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// A vertical cylinder from y0 to y1.
export function cylY(rBot, rTop, y0, y1, x, z, seg = 16) {
  const g = new THREE.CylinderGeometry(rTop, rBot, y1 - y0, seg, 1);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

// A round rod from a to b, closed at both ends.
export function rod(a, b, r, sides = 8) {
  const { m, len } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

// A squared bar from a to b.
export function bar(a, b, w, h, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = new THREE.BoxGeometry(w, h, len);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  return g;
}

export function ball(c, r, w = 10, h = 7) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.translate(c[0], c[1], c[2]);
  return g;
}

// A ring lying flat (axis 'y'), facing +Z (axis 'z') or +X (axis 'x').
export function ring(R, r, c, axis = 'y', radial = 6, tubular = 40) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  if (axis === 'y') g.rotateX(Math.PI / 2);
  else if (axis === 'x') g.rotateY(Math.PI / 2);
  g.translate(c[0], c[1], c[2]);
  return g;
}

export function tone(hex, k) {
  const c = new THREE.Color(hex);
  c.r *= k; c.g *= k; c.b *= k;
  return c;
}

export function mixHex(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// UVs in feet from the world position, planar by each face's normal.
export function feetUV(g, tile = 1) {
  const P = g.attributes.position; const N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// A pixel rectangle of a canvas as UVs (CanvasTexture flips Y).
export const rect = (x, y, w, h, W, H) => ({ u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H });

export function fitFont(ctx, text, maxW, px, family, weight = 'bold') {
  ctx.font = `${weight} ${px}px ${family}`;
  const measured = ctx.measureText(text).width;
  if (measured > maxW) {
    px = Math.max(6, Math.floor((px * maxW) / measured));
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}
export const SANS = 'Arial, Helvetica, sans-serif';
export const HEAVY = '"Arial Black", "Helvetica Neue", Arial, Helvetica, sans-serif';

// Text centred in a box, shrunk to fit its width, with a soft glow behind it.
export function glowText(ctx, text, cx, cy, maxW, px, color, glow, family = HEAVY) {
  fitFont(ctx, text, maxW, px, family);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = glow;
  ctx.shadowBlur = px * 0.35;
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function bodyMat(params = {}) {
  return standard({ vertexColors: true, roughness: 0.5, metalness: 0.2, ...params });
}

// Every lit part: unlit vertex colour, so one mesh carries any number of glow colours.
export function glowMat() {
  return new THREE.MeshBasicMaterial({ vertexColors: true });
}

// A sign atlas: the texture is both the colour and the glow, so dark ground stays dark and the
// lettering lights up. (HiFi draws a material whose emissiveMap is its map as an unlit sign.)
export function signMat(texture, intensity = 0.7) {
  return standard({ map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.45, metalness: 0 });
}

export function meshOf(parts, material, { cast = true, receive = true } = {}) {
  const m = mesh(mergeParts(parts), material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Maps every UV of a geometry into an atlas rectangle, except the faces whose normal is not the
// front's, which take the `edge` rectangle (a plain dark texel).
export function uvFront(g, front, edge, isFront) {
  const U = g.attributes.uv; const N = g.attributes.normal;
  for (let i = 0; i < U.count; i++) {
    const f = isFront(N.getX(i), N.getY(i), N.getZ(i));
    const r = f ? front : edge;
    const u = f ? U.getX(i) : 0.5; const v = f ? U.getY(i) : 0.5;
    U.setXY(i, mix(r.u0, r.u1, u), mix(r.v0, r.v1, v));
  }
  return g;
}

// A plate of w x h facing +Z with depth d, its front face carrying an atlas rectangle.
export function atlasPlate(w, h, d, front, edge) {
  const g = new THREE.BoxGeometry(w, h, d);
  return uvFront(g, front, edge, (nx, ny, nz) => nz > 0.9);
}

// A thin disc lying flat, its top carrying an atlas rectangle.
export function atlasDisc(r, y0, y1, front, edge, seg = 40) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  return uvFront(g, front, edge, (nx, ny) => ny > 0.9);
}

// ---------------------------------------------------------------------------------------------
// SPINNERS: many small parts each turning about its OWN axis, in one mesh, by rewriting a few
// hundred vertices a frame. An inner group can only turn everything about one pivot, and a mesh
// per turbine would blow the six-mesh budget, so this is the Chladni plate's mechanism: the
// position and normal buffers are DynamicDrawUsage (which is also what HiFi's bridge reads to make
// its own buffer updatable), and the bounding sphere is set by hand to cover every pose.
//
//   units: [{ parts: [{ geometry, color }...], pivot: [x,y,z], axis: [ax,ay,az], speed (rad/s),
//             phase (rad) }]
// Returns { mesh, update(dt) }.
// ---------------------------------------------------------------------------------------------
export function spinMesh(units, material) {
  const geoms = [];
  const ranges = [];
  let start = 0;
  for (const u of units) {
    let g = mergeParts(u.parts);
    if (g.index) g = g.toNonIndexed();
    geoms.push(g);
    const count = g.attributes.position.count;
    ranges.push({ start, count, pivot: new THREE.Vector3(...u.pivot), axis: new THREE.Vector3(...u.axis).normalize(), speed: u.speed, angle: u.phase ?? 0 });
    start += count;
  }
  const geometry = mergeGeometries(geoms, false);
  const P = geometry.attributes.position; const N = geometry.attributes.normal;
  const baseP = Float32Array.from(P.array); const baseN = Float32Array.from(N.array);
  P.setUsage(THREE.DynamicDrawUsage); N.setUsage(THREE.DynamicDrawUsage);
  geometry.computeBoundingSphere();
  // Every vertex stays within its own distance of its pivot, so the sphere of the rest pose grown
  // by the largest such reach covers every pose.
  let reach = 0;
  for (const r of ranges) {
    for (let i = r.start; i < r.start + r.count; i++) {
      const dx = baseP[i * 3] - r.pivot.x; const dy = baseP[i * 3 + 1] - r.pivot.y; const dz = baseP[i * 3 + 2] - r.pivot.z;
      reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  geometry.boundingSphere.radius += reach;
  const m = mesh(geometry, material);
  const q = new THREE.Quaternion(); const v = new THREE.Vector3();
  const pose = (all) => {
    for (const r of ranges) {
      if (!all && !r.speed) continue;
      q.setFromAxisAngle(r.axis, r.angle);
      for (let i = r.start; i < r.start + r.count; i++) {
        v.set(baseP[i * 3] - r.pivot.x, baseP[i * 3 + 1] - r.pivot.y, baseP[i * 3 + 2] - r.pivot.z).applyQuaternion(q);
        P.array[i * 3] = v.x + r.pivot.x; P.array[i * 3 + 1] = v.y + r.pivot.y; P.array[i * 3 + 2] = v.z + r.pivot.z;
        v.set(baseN[i * 3], baseN[i * 3 + 1], baseN[i * 3 + 2]).applyQuaternion(q);
        N.array[i * 3] = v.x; N.array[i * 3 + 1] = v.y; N.array[i * 3 + 2] = v.z;
      }
    }
    P.needsUpdate = true; N.needsUpdate = true;
  };
  pose(true);
  return {
    mesh: m,
    update(dt) {
      if (!(dt > 0)) return;
      for (const r of ranges) r.angle = (r.angle + r.speed * dt) % (Math.PI * 2);
      pose(false);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rounded solids
// ---------------------------------------------------------------------------------------------

// A closed loft of rounded rectangles, bottom to top: [{ y, hw, hd, r }]. Caps carry their own
// vertices, so the top and bottom edges stay crisp.
export function roundedLoft(sections, k = 4) {
  const ringOf = (s) => {
    const pts = [];
    const r = Math.min(s.r, s.hw - 1e-3, s.hd - 1e-3);
    const cs = [[s.hw - r, s.hd - r], [-(s.hw - r), s.hd - r], [-(s.hw - r), -(s.hd - r)], [s.hw - r, -(s.hd - r)]];
    for (let c = 0; c < 4; c++) {
      for (let j = 0; j <= k; j++) {
        const a = (c * Math.PI) / 2 + (j / k) * (Math.PI / 2);
        pts.push([(s.cx ?? 0) + cs[c][0] + r * Math.cos(a), s.y, (s.cz ?? 0) + cs[c][1] + r * Math.sin(a)]);
      }
    }
    return pts;
  };
  const rings = sections.map(ringOf);
  const m = rings[0].length;
  const pos = [];
  const index = [];
  for (const rr of rings) for (const p of rr) pos.push(...p);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const a = i * m + j; const b = i * m + j2; const c = (i + 1) * m + j2; const d = (i + 1) * m + j;
      index.push(a, c, b, a, d, c);
    }
  }
  for (const [ri, top] of [[0, false], [rings.length - 1, true]]) {
    const base = pos.length / 3;
    for (const p of rings[ri]) pos.push(...p);
    const s = sections[ri];
    const centre = pos.length / 3;
    pos.push(s.cx ?? 0, s.y, s.cz ?? 0);
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      if (top) index.push(centre, base + j2, base + j); else index.push(centre, base + j, base + j2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// Crown lumps: a smooth function of DIRECTION, so every copy of a shared corner moves identically.
function lumps(d, ph) {
  return Math.sin(d.x * 3.1 + ph) * Math.cos(d.z * 2.7 - ph * 0.6) * 0.5
    + Math.sin(d.y * 4.3 + d.x * 2.2 + ph * 1.7) * 0.35
    + Math.cos(d.z * 5.2 - d.y * 1.9 + ph * 0.4) * 0.22;
}

// A leafy lump, shaded darker underneath, its colour in its own vertices (use keepColor).
export function blob(c, R, squash, detail, rng, base, { amount = 0.16 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position;
  const ph = rng() * 10;
  const d = new THREE.Vector3();
  const col = new Float32Array(P.count * 3);
  const baseC = lin(base);
  for (let i = 0; i < P.count; i++) {
    d.set(P.getX(i), P.getY(i), P.getZ(i)).normalize();
    const k = 1 + lumps(d, ph) * amount;
    P.setXYZ(i, c[0] + d.x * R * k, c[1] + d.y * R * k * squash, c[2] + d.z * R * k);
    const shade = 0.66 + 0.34 * clamp01(d.y * 0.5 + 0.55);
    col[i * 3] = baseC[0] * shade; col[i * 3 + 1] = baseC[1] * shade; col[i * 3 + 2] = baseC[2] * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export { seededRandom, canvasTexture, mergeParts, lin, clamp01, outward, alongMatrix, mix };
