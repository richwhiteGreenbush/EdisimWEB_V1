import * as THREE from 'three';
import { BALLOON_MAX_INFLATE, BALLOON_TARGET_SPAN } from './config.js';

const GRID_RESOLUTION = 48; // cells across the longer bounding-box side
const MIN_INSIDE_VERTS = 9;
const MIN_PAINTED_PIXELS = 40;
const ALPHA_THRESHOLD = 16; // 0-255 -- a pixel counts as "painted" past this alpha

// Multi-source BFS from every "rim" cell (an inside cell touching the outside, or the
// grid edge) inward -- gives each inside cell its grid-step distance to the nearest
// unpainted pixel. Replaces both the old point-in-polygon rim detection and the
// polygon-edge distance check in one pass, and generalizes for free to whatever shape
// was actually painted: concave blobs, multiple disconnected strokes, holes, etc.
function computeDistanceField(insideFlags, cols, rows) {
  const at = (r, c) => r * (cols + 1) + c;
  const dist = new Float32Array((cols + 1) * (rows + 1)).fill(Infinity);
  const queue = [];

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (!insideFlags[at(r, c)]) continue;
      const isRim =
        r === 0 || r === rows || c === 0 || c === cols ||
        !insideFlags[at(r - 1, c)] || !insideFlags[at(r + 1, c)] ||
        !insideFlags[at(r, c - 1)] || !insideFlags[at(r, c + 1)];
      if (isRim) {
        dist[at(r, c)] = 0;
        queue.push(r, c);
      }
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const r = queue[qi++];
    const c = queue[qi++];
    const d = dist[at(r, c)];
    const neighbors = [
      [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1],
    ];
    for (const [nr, nc] of neighbors) {
      if (nr < 0 || nr > rows || nc < 0 || nc > cols) continue;
      if (!insideFlags[at(nr, nc)]) continue;
      if (dist[at(nr, nc)] > d + 1) {
        dist[at(nr, nc)] = d + 1;
        queue.push(nr, nc);
      }
    }
  }

  return dist;
}

function findPaintedBounds(imageData) {
  const { width, height, data } = imageData;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (count < MIN_PAINTED_PIXELS || maxX < minX) return null;
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1, count };
}

// Turns a freehand painting into a puffy, closed 3D "balloon" mesh, textured with the
// actual painting (so multiple brush colors show up on the result, not just one flat
// color): the painted region is rasterized onto a grid (an ear-clip triangulation only
// ever uses a polygon's own boundary points as vertices, useless for a heightfield --
// we need real interior samples), every non-rim vertex is pushed out along Z in
// proportion to its distance from the unpainted area (sqrt falloff -> rounded, not
// conical), and mirrored to form a back half. Rim vertices are forced to height zero,
// so front and back halves meet there automatically -- no separate stitching pass.
export function inflateFromCanvas(sourceCanvas) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const srcCtx = sourceCanvas.getContext('2d');
  const imageData = srcCtx.getImageData(0, 0, width, height);

  const bounds = findPaintedBounds(imageData);
  if (!bounds) return null;

  const data = imageData.data;
  const isPaintedAt = (px, py) => {
    if (px < 0 || px >= width || py < 0 || py >= height) return false;
    return data[(py * width + px) * 4 + 3] > ALPHA_THRESHOLD;
  };

  const cols = GRID_RESOLUTION;
  const rows = GRID_RESOLUTION;
  const insideFlags = new Uint8Array((cols + 1) * (rows + 1));
  const at = (r, c) => r * (cols + 1) + c;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const px = Math.floor(bounds.minX + (c / cols) * bounds.width);
      const py = Math.floor(bounds.minY + (r / rows) * bounds.height);
      insideFlags[at(r, c)] = isPaintedAt(px, py) ? 1 : 0;
    }
  }

  const dist = computeDistanceField(insideFlags, cols, rows);

  const vertIndex = new Int32Array((cols + 1) * (rows + 1)).fill(-1);
  const verts = [];
  let maxDist = 0;

  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      if (!insideFlags[at(r, c)]) continue;
      const d = dist[at(r, c)];
      vertIndex[at(r, c)] = verts.length;
      verts.push({
        px: bounds.minX + (c / cols) * bounds.width,
        py: bounds.minY + (r / rows) * bounds.height,
        u: c / cols,
        v: 1 - r / rows,
        d,
      });
      if (d > maxDist && d !== Infinity) maxDist = d;
    }
  }
  if (verts.length < MIN_INSIDE_VERTS || maxDist < 1e-6) return null;

  const tris = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = vertIndex[at(r, c)];
      const b = vertIndex[at(r, c + 1)];
      const d2 = vertIndex[at(r + 1, c)];
      const e = vertIndex[at(r + 1, c + 1)];
      // Winding must be CCW as seen from +Z (world x = c-axis, world y = -r-axis) so
      // the front half's computed normals point toward the viewer, not away -- with
      // MeshStandardMaterial's lighting, "away" reads as an unlit, near-black surface
      // even though side:DoubleSide keeps it visible.
      if (a >= 0 && b >= 0 && d2 >= 0) tris.push(a, d2, b);
      if (b >= 0 && e >= 0 && d2 >= 0) tris.push(b, d2, e);
    }
  }
  if (!tris.length) return null;

  const vertexCount = verts.length;
  const cx = bounds.minX + bounds.width / 2;
  const cy = bounds.minY + bounds.height / 2;
  const maxExtent = Math.max(bounds.width, bounds.height);
  const scale = maxExtent > 1e-6 ? BALLOON_TARGET_SPAN / maxExtent : 1;

  const positions = new Float32Array(vertexCount * 2 * 3);
  const uvs = new Float32Array(vertexCount * 2 * 2);
  for (let i = 0; i < vertexCount; i++) {
    const vert = verts[i];
    const x = (vert.px - cx) * scale;
    const y = -(vert.py - cy) * scale; // screen-down -> world-up
    const t = vert.d / maxDist;
    const z = BALLOON_MAX_INFLATE * Math.sqrt(t);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    uvs[i * 2] = vert.u;
    uvs[i * 2 + 1] = vert.v;

    const bi = (vertexCount + i) * 3;
    positions[bi] = x;
    positions[bi + 1] = y;
    positions[bi + 2] = -z;
    const buvi = (vertexCount + i) * 2;
    uvs[buvi] = vert.u;
    uvs[buvi + 1] = vert.v;
  }

  const triCount = tris.length / 3;
  const IndexType = vertexCount * 2 > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexType(triCount * 6);
  for (let t = 0; t < triCount; t++) {
    const a = tris[t * 3];
    const b = tris[t * 3 + 1];
    const c = tris[t * 3 + 2];

    indices[t * 6] = a;
    indices[t * 6 + 1] = b;
    indices[t * 6 + 2] = c;

    // Back half: offset into the mirrored vertex block, reversed winding so its
    // normal faces outward (away from the front half) instead of inward.
    indices[t * 6 + 3] = a + vertexCount;
    indices[t * 6 + 4] = c + vertexCount;
    indices[t * 6 + 5] = b + vertexCount;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  // Crop to just the painted bounding box so the (0..1) UVs above line up with the texture.
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = bounds.width;
  cropCanvas.height = bounds.height;
  cropCanvas.getContext('2d').drawImage(sourceCanvas, bounds.minX, bounds.minY, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  const texture = new THREE.CanvasTexture(cropCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.45,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
