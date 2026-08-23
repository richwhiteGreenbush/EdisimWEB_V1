import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn,
} from '../PropKit.js';
import {
  revolve, extrudeOutline, ball, mergeParts, tube, put, xformed,
} from './LoftKit.js';

// Simon in the Land of Chalk Drawings -- a bright meadow where every object is a chalk
// drawing that came alive. The world exists to sell ONE idea, because it is the app's own
// idea: a flat drawing can stand up and become a thing (the Draw-to-balloon tool), and a
// thing can hold a chalk line of its own (the marker blocks). The puppy and the rocket
// ship drawing with the marker; the boards invite the student to draw back.
//
// Two techniques carry the whole look, and every builder here uses both:
//
//  * SCRIBBLE FILL. One near-white canvas of rough parallel chalk strokes, multiplied by
//    per-vertex colour (map x vertexColors -- the flower-bed trick, used deliberately).
//    The map carries stroke direction and chalk skip at a scale vertices cannot reach;
//    the tint owns the hue. The same canvas rides again as a linear-space bumpMap, so
//    the strokes catch the light the way chalk sits proud of paper tooth.
//
//  * INK HULL. Every solid gets a slightly larger copy of itself, displaced along its
//    own WELDED normals and rendered BackSide in an unlit ink navy -- the classic
//    inverted-hull toon outline. From every angle, every silhouette is a drawn line.
//    Unlit matters twice over: the line stays crisp at any sun angle, and BackSide on a
//    thin tube renders exactly like FrontSide when there is no shading, so hand-drawn
//    DETAIL lines (window crosses, kite string, the sky birds) live in the same mesh.
//    The hull is displaced along normals WELDED BY POSITION ONLY (uv/colour attributes
//    stripped first): a UV seam or a cap/side split would otherwise tear the hull apart
//    exactly where the outline must hold, and welding is also what rounds a box's
//    corners into a drawn line's corners.
//
// Everything else follows the house rules: feet at scale 1, origin at base centre
// (deliberate exceptions noted), fresh materials and textures per call, seededRandom
// never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Saturated but not pure: full-saturation primaries under this world's bright sky read
// as plastic toys, and real chalk is pigment plus a lot of white.
export const CHALK = {
  red: 0xd94f41, orange: 0xf0993c, yellow: 0xe8ce54, green: 0x77bd4e,
  blue: 0x4f9fdd, purple: 0x9a6fd0, pink: 0xe58ab4, white: 0xf7f4ea,
  cream: 0xf0e9d2, sky: 0xa3d5e8, brown: 0x9a6a42, brownDark: 0x77492a,
  skin: 0xf2c49b, grass: 0x77bd4e,
};

// The ink every outline is drawn in: a deep chalk-navy, not black -- black outlines
// under a paper-white sky read as marker pen, and the reference art is softer than that.
const INK = 0x323552;

const RAINBOW = ['#d94f41', '#f0993c', '#e8ce54', '#77bd4e', '#4f9fdd', '#9a6fd0'];

// The chalky hand-lettering font stack. Canvas font availability varies per student
// device, so this ends in `cursive`; the worst case is a roundish system face, which
// still reads as a friendly board.
const HAND = '"Chalkboard SE", "Comic Sans MS", "Segoe Print", "Comic Neue", cursive';

// ---------------------------------------------------------------------------
// The scribble fill
// ---------------------------------------------------------------------------

// One tileable canvas of rough, roughly-parallel chalk strokes plus speckle grain.
// NEAR-WHITE (floor ~0.8), because it multiplies the vertex tint: it must carry texture
// and no colour of its own. Strokes are drawn 9-way wrapped so the tile has no seam --
// a seam draws a straight line down every sphere in the world.
function scribbleCanvas(seed, { size = 192, angle = -0.6 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#efede6';
  ctx.fillRect(0, 0, size, size);

  const stroke = (x0, y0, a, len, width, value, alpha) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        for (let d = 0; d < len; d += 2.6) {
          // Chalk skips: per-dot alpha noise is what separates a chalk stroke from an
          // airbrush stroke.
          const skip = 0.45 + 0.55 * rng();
          ctx.fillStyle = `rgba(${value},${value},${Math.round(value * 0.985)},${(alpha * skip).toFixed(3)})`;
          const wob = (rng() - 0.5) * 1.6;
          const px = x0 + dx * d - dy * wob + ox;
          const py = y0 + dy * d + dx * wob + oy;
          ctx.beginPath();
          ctx.arc(px, py, width * (0.4 + 0.35 * rng()), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  for (let i = 0; i < 30; i++) {
    stroke(
      rng() * size, rng() * size,
      angle + (rng() - 0.5) * 0.5,
      randomIn(rng, 60, 150),
      randomIn(rng, 2.6, 4.6),
      Math.round(randomIn(rng, 190, 246)),
      randomIn(rng, 0.34, 0.68),
    );
  }
  // Speckle: bright chalk dust and dark paper tooth.
  for (let i = 0; i < 480; i++) {
    const light = rng() > 0.45;
    const v = light ? 255 : Math.round(randomIn(rng, 186, 208));
    ctx.fillStyle = `rgba(${v},${v},${v},${randomIn(rng, 0.25, 0.55).toFixed(2)})`;
    ctx.fillRect(rng() * size, rng() * size, 1.5, 1.5);
  }
  return canvas;
}

// The colour map and the bump map are two textures over ONE canvas: the map decodes as
// sRGB, the bump stays linear (a bump map is data -- the relief() rule).
function scribble(seed, { angle, repeat = 3 } = {}) {
  const canvas = scribbleCanvas(seed, { angle });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(canvas);
  bump.wrapS = THREE.RepeatWrapping;
  bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(repeat, repeat);
  return { map, bump };
}

// ---------------------------------------------------------------------------
// The ink hull
// ---------------------------------------------------------------------------

// A slightly larger copy of a geometry, displaced along smooth normals, for rendering
// BackSide in flat ink. Attributes other than position are stripped BEFORE welding so
// vertices weld by position alone -- a UV seam or a deliberate cap/side normal split
// would otherwise stay split and the hull would tear open along it.
function inkHull(source, grow = 0.05) {
  const bare = source.clone();
  for (const key of Object.keys(bare.attributes)) {
    if (key !== 'position') bare.deleteAttribute(key);
  }
  const welded = mergeVertices(bare, 1e-3);
  welded.computeVertexNormals();
  const pos = welded.attributes.position;
  const nor = welded.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nor.getX(i) * grow,
      pos.getY(i) + nor.getY(i) * grow,
      pos.getZ(i) + nor.getZ(i) * grow,
    );
  }
  pos.needsUpdate = true;
  return welded;
}

// A body part and its outline in one call. `extra` is the body part's extras
// (tint/keepColor/scale/about); the hull copies any transform so the line stays on the
// solid it belongs to.
function duo(parts, inks, geometry, color, position = null, rotation = null, extra = null) {
  put(parts, geometry, color, position, rotation, extra);
  const grow = extra?.grow ?? 0.085;
  const hull = { geometry: inkHull(geometry, grow) };
  if (position) hull.position = position;
  if (rotation) hull.rotation = rotation;
  if (extra?.scale) hull.scale = extra.scale;
  if (extra?.about) hull.about = extra.about;
  inks.push(hull);
}

// Runs a helper that pushes into a temp list (chain, spike) and outlines every part it
// made.
function duoAll(parts, inks, tmp, grow = 0.085) {
  for (const part of tmp) {
    parts.push(part);
    const hull = { geometry: inkHull(part.geometry, grow) };
    if (part.position) hull.position = part.position;
    if (part.rotation) hull.rotation = part.rotation;
    if (part.scale) hull.scale = part.scale;
    inks.push(hull);
  }
}

// The standard two-mesh chalk prop: one merged scribble-fill body, one merged unlit ink
// mesh (hulls + drawn detail lines together -- see the header for why BackSide serves
// both). The ink casts no shadow: the body's shadow already matches the silhouette.
function chalkAssembly(parts, inks, {
  seed = 1, angle = -0.6, repeat = 3, bump = 0.5, emissive = null, emissiveIntensity = 0.25,
} = {}) {
  const g = group();
  if (parts.length) {
    const tex = scribble(seed, { angle, repeat });
    g.add(mesh(mergeParts(parts), standard({
      vertexColors: true, map: tex.map, bumpMap: tex.bump, bumpScale: bump,
      roughness: 1, metalness: 0,
      // A flat emissive lift for props that are ALL underside (the clouds): the hemi
      // bounce is the only light a downward face gets, and a drawn cloud must not
      // have a grey belly. Flat is safe here because these props are near-white --
      // the emissive-bleaches-vertex-colour trap only bites saturated tints.
      ...(emissive ? { emissive: new THREE.Color(emissive), emissiveIntensity } : {}),
    })));
  }
  if (inks.length) {
    const inkMesh = mesh(mergeParts(inks), new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
    inkMesh.castShadow = false;
    inkMesh.receiveShadow = false;
    g.add(inkMesh);
  }
  return g;
}

// ---------------------------------------------------------------------------
// The puff: a drawing inflated into a solid
// ---------------------------------------------------------------------------

// Inflates a closed 2D outline into a puffy closed solid -- the same idea as the app's
// own Draw-to-balloon tool, which is exactly why it is the vocabulary of this world:
// every flat-drawn thing here (a kite, a butterfly wing, the train's whole profile) is
// a drawing that puffed up.
//
// Grid-sampled, BFS distance from the rim, height = depth * sqrt(d/dmax) -- rim height
// is ZERO, so the mirrored front and back sheets SHARE the rim vertices and the solid
// is watertight by construction, the BalloonInflator trick. Rim nodes are snapped to
// the true outline so the edge is the drawn line, not the grid's staircase.
function chalkPuff(outline, { depth = 0.5, grid = 22, seed = 1 } = {}) {
  const rng = seededRandom(seed * 7 + 3);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of outline) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cell = Math.max(maxX - minX, maxY - minY) / grid;
  const nx = Math.ceil((maxX - minX) / cell) + 3;
  const ny = Math.ceil((maxY - minY) / cell) + 3;
  const ox = minX - cell * 1.5;
  const oy = minY - cell * 1.5;

  const inPoly = (x, y) => {
    let c = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i];
      const [xj, yj] = outline[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };

  const idx = (i, j) => j * (nx + 1) + i;
  const inside = new Array((nx + 1) * (ny + 1)).fill(false);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) inside[idx(i, j)] = inPoly(ox + i * cell, oy + j * cell);
  }
  // Rim = outside nodes 8-adjacent to an inside node; active = inside or rim, which
  // guarantees every cell touching the shape has all four corners available.
  const rim = new Array(inside.length).fill(false);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      if (inside[idx(i, j)]) continue;
      let touch = false;
      for (let dj = -1; dj <= 1 && !touch; dj++) {
        for (let di = -1; di <= 1 && !touch; di++) {
          const ii = i + di; const jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii <= nx && jj <= ny && inside[idx(ii, jj)]) touch = true;
        }
      }
      rim[idx(i, j)] = touch;
    }
  }
  // BFS distance inward from the rim, 4-way over inside nodes.
  const dist = new Float32Array(inside.length).fill(0);
  let queue = [];
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      if (!inside[idx(i, j)]) continue;
      const edge = (i === 0 || j === 0 || i === nx || j === ny)
        || !inside[idx(i - 1, j)] || !inside[idx(i + 1, j)]
        || !inside[idx(i, j - 1)] || !inside[idx(i, j + 1)];
      if (edge) { dist[idx(i, j)] = 1; queue.push([i, j]); }
    }
  }
  let maxD = 1;
  while (queue.length) {
    const next = [];
    for (const [i, j] of queue) {
      const d = dist[idx(i, j)] + 1;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di; const jj = j + dj;
        if (ii < 0 || jj < 0 || ii > nx || jj > ny) continue;
        const k = idx(ii, jj);
        if (inside[k] && dist[k] === 0) { dist[k] = d; maxD = Math.max(maxD, d); next.push([ii, jj]); }
      }
    }
    queue = next;
  }

  // Node positions: interior nodes take a whisper of jitter (a drawn surface is not
  // machine-flat); rim nodes are snapped to the nearest point of the true outline.
  const px = new Float32Array(inside.length);
  const py = new Float32Array(inside.length);
  const h = new Float32Array(inside.length);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = idx(i, j);
      let x = ox + i * cell;
      let y = oy + j * cell;
      if (inside[k]) {
        const t = Math.sqrt(dist[k] / maxD);
        h[k] = depth * Math.sin(t * Math.PI * 0.5);
        if (dist[k] > 1.5) {
          x += (rng() - 0.5) * cell * 0.25;
          y += (rng() - 0.5) * cell * 0.25;
        }
      } else if (rim[k]) {
        let best = Infinity; let bx = x; let by = y;
        for (let s = 0, sPrev = outline.length - 1; s < outline.length; sPrev = s++) {
          const [ax, ay] = outline[sPrev];
          const [bx2, by2] = outline[s];
          const vx = bx2 - ax; const vy = by2 - ay;
          const len2 = vx * vx + vy * vy || 1;
          const t = THREE.MathUtils.clamp(((x - ax) * vx + (y - ay) * vy) / len2, 0, 1);
          const qx = ax + vx * t; const qy = ay + vy * t;
          const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
          if (d2 < best) { best = d2; bx = qx; by = qy; }
        }
        x = bx; y = by;
      }
      px[k] = x; py[k] = y;
    }
  }

  // Vertices: front and back share the vertex wherever height is ~0.
  const positions = [];
  const uvs = [];
  const front = new Int32Array(inside.length).fill(-1);
  const back = new Int32Array(inside.length).fill(-1);
  const w = maxX - minX || 1;
  const hh = maxY - minY || 1;
  const addVert = (k, z) => {
    positions.push(px[k], py[k], z);
    uvs.push((px[k] - minX) / w, (py[k] - minY) / hh);
    return positions.length / 3 - 1;
  };
  for (let k = 0; k < inside.length; k++) {
    if (!inside[k] && !rim[k]) continue;
    if (h[k] < 1e-4) {
      const v = addVert(k, 0);
      front[k] = v; back[k] = v;
    } else {
      front[k] = addVert(k, h[k]);
      back[k] = addVert(k, -h[k]);
    }
  }

  const indices = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k00 = idx(i, j); const k10 = idx(i + 1, j);
      const k01 = idx(i, j + 1); const k11 = idx(i + 1, j + 1);
      const anyIn = inside[k00] || inside[k10] || inside[k01] || inside[k11];
      if (!anyIn) continue;
      if (front[k00] < 0 || front[k10] < 0 || front[k01] < 0 || front[k11] < 0) continue;
      indices.push(front[k00], front[k10], front[k11], front[k00], front[k11], front[k01]);
      indices.push(back[k00], back[k11], back[k10], back[k00], back[k01], back[k11]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A closed outline with smooth hand-drawn wobble: low-frequency sine displacement from
// the centroid, never per-point jitter (which is jaggy, not wobbly).
function wobbly(points, rng, amp = 0.05) {
  const p1 = rng() * Math.PI * 2;
  const p2 = rng() * Math.PI * 2;
  const f1 = 2 + Math.floor(rng() * 2);
  const f2 = 5 + Math.floor(rng() * 3);
  let cx = 0; let cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= points.length; cy /= points.length;
  return points.map(([x, y], i) => {
    const t = (i / points.length) * Math.PI * 2;
    const k = 1 + amp * (0.7 * Math.sin(f1 * t + p1) + 0.3 * Math.sin(f2 * t + p2));
    return [cx + (x - cx) * k, cy + (y - cy) * k];
  });
}

function rectOutline(halfW, y0, y1, steps = 6) {
  const pts = [];
  for (let i = 0; i < steps; i++) pts.push([-halfW + (2 * halfW * i) / steps, y0]);
  for (let i = 0; i < steps; i++) pts.push([halfW, y0 + ((y1 - y0) * i) / steps]);
  for (let i = 0; i < steps; i++) pts.push([halfW - (2 * halfW * i) / steps, y1]);
  for (let i = 0; i < steps; i++) pts.push([-halfW, y1 - ((y1 - y0) * i) / steps]);
  return pts;
}

// Places a geometry by an explicit orthonormal-ish basis: local +X along `xAxis`,
// local +Y along `yAxis`. The escape hatch from single-Euler composition, same job as
// RomeProps.xformed -- a fin that must contain the hull's axis, a petal in a tilted
// head plane.
function basisPlaced(geometry, xAxis, yAxis, origin = [0, 0, 0]) {
  const x = new THREE.Vector3(...xAxis).normalize();
  const y = new THREE.Vector3(...yAxis).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  const yy = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, yy, z);
  m.setPosition(origin[0], origin[1], origin[2]);
  return xformed(geometry, m);
}

// `revolve` takes its winding from the profile's direction; a bottom-up profile comes
// out inside out (the Seattle lesson). Every lathe here goes through this.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// Chalk hand-lettering on a canvas: per-character jitter and rotation, struck twice so
// the edge breaks up the way chalk does. Returns the width drawn.
function chalkText(ctx, text, x, y, size, color, {
  align = 'left', weight = 700, jitter = null, rng = null,
} = {}) {
  const jr = rng || seededRandom(text.length * 31 + Math.round(size));
  const j = jitter ?? size * 0.05;
  ctx.save();
  ctx.font = `${weight} ${size}px ${HAND}`;
  ctx.textBaseline = 'alphabetic';
  const chars = [...String(text)];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  for (let i = 0; i < chars.length; i++) {
    const dy = (jr() - 0.5) * 2 * j;
    const rot = (jr() - 0.5) * 0.07;
    ctx.save();
    ctx.translate(cx + widths[i] / 2, y + dy);
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.fillText(chars[i], -widths[i] / 2, 0);
    ctx.globalAlpha = 0.35;
    ctx.fillText(chars[i], -widths[i] / 2 + size * 0.02, -size * 0.015);
    ctx.restore();
    cx += widths[i];
  }
  ctx.restore();
  return total;
}

// ---------------------------------------------------------------------------
// SIMON -- the boy who drew all this
// ---------------------------------------------------------------------------

// The one figure in the world who is NOT scribble-filled logic-deep: he is the visitor,
// so his colours are denser -- but he still wears the ink outline, because here he is a
// drawing of himself. Right hand carries the giant chalk, left hand waves.
export function chalkSimon({ seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];

  // Shoes, legs, shorts.
  for (const s of [-1, 1]) {
    duo(P, K, ball(0.3, 14), CHALK.red, [s * 0.34, 0.24, 0.12], null,
      { scale: [1.1, 0.65, 1.5], grow: 0.06 });
    duo(P, K, tube([[s * 0.34, 0.32, 0.02], [s * 0.35, 0.9, 0], [s * 0.33, 1.5, 0]],
      [0.15, 0.15, 0.16], { sides: 12 }), CHALK.skin, null, null, { grow: 0.055 });
  }
  duo(P, K, ball(0.56, 18), 0x4a6fa8, [0, 1.62, 0], null, { scale: [1.05, 0.8, 0.92], grow: 0.07 });

  // The striped tee: one lathe, resampled finely so the band tint has mesh to land on
  // (a tint can only be as detailed as the mesh under it).
  const teeR = (t) => 0.52 + 0.13 * Math.sin(t * Math.PI * 0.9) - 0.2 * t * t;
  const teeProfile = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    teeProfile.push([Math.max(0.28, teeR(t)), 1.78 + t * 1.16]);
  }
  teeProfile.unshift([0, 1.78]);
  teeProfile.push([0, 2.94]);
  const tee = lathed(teeProfile, { segments: 22 });
  const stripe = (p) => (Math.floor((p.y - 1.78) / 0.26) % 2 === 0
    ? [0.93, 0.9, 0.85] : [0.85, 0.32, 0.28]);
  duo(P, K, tee, CHALK.white, null, null, { tint: (p) => stripe(p), keepColor: true, grow: 0.09 });

  // Sleeves and arms: right down and forward with the chalk, left up waving.
  duo(P, K, ball(0.2, 12), CHALK.white, [0.56, 2.7, 0], null,
    { tint: () => [0.85, 0.32, 0.28], keepColor: true, grow: 0.06 });
  duo(P, K, ball(0.2, 12), CHALK.white, [-0.56, 2.7, 0], null,
    { tint: () => [0.85, 0.32, 0.28], keepColor: true, grow: 0.06 });
  duo(P, K, tube([[0.6, 2.66, 0], [0.82, 2.3, 0.3], [0.92, 1.98, 0.55]],
    [0.12, 0.11, 0.1], { sides: 10 }), CHALK.skin, null, null, { grow: 0.05 });
  duo(P, K, ball(0.14, 10), CHALK.skin, [0.92, 1.95, 0.58], null, { grow: 0.05 });
  duo(P, K, tube([[-0.6, 2.66, 0], [-0.9, 3.05, 0.08], [-1.02, 3.5, 0.14]],
    [0.12, 0.11, 0.1], { sides: 10 }), CHALK.skin, null, null, { grow: 0.05 });
  duo(P, K, ball(0.15, 10), CHALK.skin, [-1.03, 3.56, 0.15], null, { grow: 0.05 });

  // The giant chalk stick, its top end seated INSIDE the hand ball (a stick placed by
  // eye floated half a foot in front of the grip -- the open-joint rule applies to
  // props a hand is holding too).
  const chalkStick = new THREE.CylinderGeometry(0.09, 0.1, 1.05, 10);
  duo(P, K, chalkStick, CHALK.white, [0.86, 1.63, 0.33], [0.72, 0, -0.18], { grow: 0.05 });
  duo(P, K, new THREE.CylinderGeometry(0.092, 0.095, 0.2, 10), CHALK.pink,
    [0.78, 1.32, 0.06], [0.72, 0, -0.18], { grow: 0.05 });

  // Head, hair, face.
  duo(P, K, ball(0.72, 24), CHALK.skin, [0, 3.72, 0], null, { grow: 0.1 });
  for (let i = 0; i < 7; i++) {
    const a = -1.2 + (i / 6) * 2.4;
    const r = randomIn(rng, 0.26, 0.4);
    duo(P, K, ball(r, 12), 0x7a4a2b,
      [Math.sin(a) * 0.52, 4.18 + Math.cos(a) * 0.28 - Math.abs(a) * 0.12, -0.1 - Math.abs(Math.sin(a)) * 0.12],
      null, { scale: [1, 0.8, 1], grow: 0.07 });
  }
  put(P, ball(0.075, 8), INK, [-0.24, 3.82, 0.63]);
  put(P, ball(0.075, 8), INK, [0.24, 3.82, 0.63]);
  const smile = new THREE.TorusGeometry(0.2, 0.042, 8, 16, 2.0);
  smile.rotateZ(-Math.PI / 2 - 1.0);
  put(P, smile, 0x8a3a30, [0, 3.55, 0.63]);
  put(P, ball(0.1, 8), 0xdd8272, [-0.42, 3.58, 0.52], null, { scale: [1, 0.6, 0.5] });
  put(P, ball(0.1, 8), 0xdd8272, [0.42, 3.58, 0.52], null, { scale: [1, 0.6, 0.5] });

  return chalkAssembly(P, K, { seed: seed + 40, repeat: 2.4, angle: -0.9 });
}

// ---------------------------------------------------------------------------
// THE CHALK PUPPY -- the character who draws
// ---------------------------------------------------------------------------

// Ships with the marker program (see the layout): draws its chalk circle once, then
// trots the ring forever. Authored facing +Z, because that is the way `move forward`
// will carry it.
export function chalkPuppy({ seed = 3, color = 0x7ec3e8 } = {}) {
  const P = [];
  const K = [];
  const dark = new THREE.Color(color).multiplyScalar(0.82).getHex();

  duo(P, K, tube([[0, 0.6, -0.52], [0, 0.7, 0], [0, 0.66, 0.44]],
    [0.28, 0.34, 0.28], { sides: 14 }), color, null, null, { grow: 0.07 });
  duo(P, K, ball(0.3, 12), color, [0, 0.62, -0.55], null, { grow: 0.07 });
  duo(P, K, ball(0.29, 12), color, [0, 0.68, 0.48], null, { grow: 0.07 });

  // Head, muzzle, nose, eyes, ears, tongue.
  duo(P, K, ball(0.34, 16), color, [0, 1.06, 0.66], null, { grow: 0.07 });
  duo(P, K, ball(0.2, 12), color, [0, 0.94, 0.94], null, { scale: [1, 0.85, 1], grow: 0.045 });
  put(P, ball(0.075, 8), INK, [0, 1.0, 1.1]);
  put(P, ball(0.055, 8), INK, [-0.14, 1.18, 0.94]);
  put(P, ball(0.055, 8), INK, [0.14, 1.18, 0.94]);
  for (const s of [-1, 1]) {
    duo(P, K, ball(0.17, 10), dark, [s * 0.3, 1.16, 0.56], [0.15, 0, s * 0.55],
      { scale: [0.55, 1, 0.35], grow: 0.04 });
  }
  put(P, ball(0.08, 8), CHALK.pink, [0.07, 0.84, 1.02], null, { scale: [0.6, 0.3, 0.8] });

  // Collar, tail, legs.
  const collar = new THREE.TorusGeometry(0.27, 0.05, 8, 18);
  collar.rotateX(Math.PI / 2 - 0.5);
  duo(P, K, collar, CHALK.red, [0, 0.88, 0.5], null, { grow: 0.035 });
  duo(P, K, tube([[0, 0.72, -0.78], [0, 1.02, -0.98], [0.1, 1.24, -0.86]],
    [0.08, 0.06, 0.045], { sides: 8 }), color, null, null, { grow: 0.035 });
  duo(P, K, ball(0.07, 8), color, [0.11, 1.26, -0.85], null, { grow: 0.035 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      duo(P, K, tube([[sx * 0.19, 0.55, sz * 0.32], [sx * 0.21, 0.3, sz * 0.34], [sx * 0.21, 0.14, sz * 0.34]],
        [0.09, 0.085, 0.08], { sides: 8 }), color, null, null, { grow: 0.04 });
      duo(P, K, ball(0.105, 8), dark, [sx * 0.21, 0.11, sz * 0.37], null,
        { scale: [1, 0.65, 1.25], grow: 0.04 });
    }
  }

  return chalkAssembly(P, K, { seed: seed + 41, repeat: 2.2, angle: 0.4 });
}

// ---------------------------------------------------------------------------
// THE CHALK ROCKET -- Simon's rocket off the book cover
// ---------------------------------------------------------------------------

// Authored with its nose along +Z (its `move forward` direction) and a small baked
// nose-up pitch, origin under its belly: it ships flying a circle at altitude, drawing
// its own rainbow contrail with the marker -- so its chalk line appears just beneath
// it, which is the cover picture: a rocket riding its own rainbow.
export function chalkRocket({ seed = 11 } = {}) {
  const P = [];
  const K = [];
  const LIFT = 1.62; // origin -> hull axis, so the lowest fin tip sits at y ~= 0

  // The hull: one lathe about Y, tinted into cream body / red nose / blue banded tail,
  // then tipped to fly along +Z. Rows every ~0.09ft so the band edges land on mesh.
  const noseY = 1.7; // in lathe frame, before rotation
  const hullR = (y) => {
    if (y < -1.3) return 0.62 + (y + 2.7) * 0.16;
    if (y < 0.2) return 0.84 + 0.1 * Math.cos((y + 0.55) * 1.1);
    if (y < noseY) return 0.92 * Math.cos(((y - 0.2) / (noseY - 0.2)) * 1.05);
    return 0.01;
  };
  const prof = [[0, -2.7]];
  for (let y = -2.7; y <= 3.1; y += 0.09) {
    prof.push([Math.max(0.02, hullR(Math.min(y, 3.05)) * (y > noseY ? Math.max(0.03, 1 - (y - noseY) / 1.4) : 1)), y]);
  }
  prof.push([0, 3.1]);
  const hull = lathed(prof, { segments: 30 });
  hull.rotateX(Math.PI / 2); // +Y (lathe axis) -> +Z (flight)
  const hullTint = (p) => {
    // p is pre-rotation? No: tint runs on the geometry as handed over -- already
    // rotated -- so the axis is +Z here and bands are read off p.z.
    const z = p.z;
    if (z > 1.55) return [0.85, 0.33, 0.27]; // nose red
    if (z < -1.35) {
      return Math.floor((z + 2.75) / 0.24) % 2 === 0
        ? [0.36, 0.62, 0.86] : [0.93, 0.91, 0.84]; // banded tail
    }
    return [0.94, 0.92, 0.86]; // cream body
  };
  duo(P, K, hull, CHALK.cream, [0, LIFT, 0], [-0.1, 0, 0],
    { tint: hullTint, keepColor: true, grow: 0.06 });

  // Three fins containing the hull axis, each with a rounded landing foot.
  const finOutline = [[0.5, -2.75], [1.3, -2.95], [1.52, -2.5], [1.05, -1.5], [0.55, -1.25]];
  for (const a of [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 + (4 * Math.PI) / 3]) {
    const dir = [Math.cos(a), Math.sin(a), 0];
    const fin = basisPlaced(extrudeOutline(finOutline, 0.12), dir, [0, 0, 1], [0, 0, 0]);
    duo(P, K, fin, CHALK.blue, [0, LIFT, 0], [-0.1, 0, 0], { grow: 0.05 });
    const foot = ball(0.24, 10);
    foot.scale(1.25, 1.25, 0.6);
    const footPlaced = basisPlaced(foot, dir, [0, 0, 1],
      [dir[0] * 1.42, dir[1] * 1.42, -2.88]);
    duo(P, K, footPlaced, 0x3f7fc0, [0, LIFT, 0], [-0.1, 0, 0], { grow: 0.045 });
  }

  // Portholes on both flanks (one flank always faces away -- the micro-sub lesson).
  for (const s of [-1, 1]) {
    const ring = new THREE.TorusGeometry(0.4, 0.09, 10, 22);
    ring.rotateY(Math.PI / 2);
    duo(P, K, ring, CHALK.white, [s * 0.86, LIFT + 0.06, 0.42], [-0.1, 0, 0], { grow: 0.045 });
  }

  const g = chalkAssembly(P, K, { seed: seed + 42, repeat: 2.6, angle: 0.2 });

  // Simon's face in the porthole: a canvas disc, one per flank, sharing one texture.
  const faceTex = canvasTexture(128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#f7f2e2';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a4a2b'; // mop of hair
    ctx.beginPath();
    ctx.arc(64, 46, 40, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fill();
    for (const fx of [34, 52, 70, 88]) {
      ctx.beginPath();
      ctx.arc(fx, 48, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f2c49b'; // face
    ctx.beginPath();
    ctx.arc(64, 72, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#323552';
    ctx.beginPath(); ctx.arc(53, 68, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(75, 68, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a3a30';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 78, 10, 0.35, Math.PI - 0.35);
    ctx.stroke();
  });
  const faceMat = standard({ map: faceTex, roughness: 0.95, transparent: true, alphaTest: 0.4 });
  for (const s of [-1, 1]) {
    const disc = mesh(new THREE.CircleGeometry(0.34, 20), faceMat);
    disc.position.set(s * 0.88, LIFT + 0.06 + 0.042, 0.42 + 0.0);
    disc.rotation.set(-0.1 * (s > 0 ? 1 : 1), s * Math.PI / 2, 0, 'YXZ');
    disc.position.x += s * 0.06;
    g.add(disc);
  }

  // The exhaust flame: two crossed chalk-flame puffs, unlit so they read as bright
  // crayon whatever the sun does.
  const flameOutline = (len, w2) => [
    [0, w2], [-len * 0.3, w2 * 0.75], [-len * 0.55, w2 * 0.45], [-len * 0.75, w2 * 0.18],
    [-len, 0], [-len * 0.75, -w2 * 0.18], [-len * 0.55, -w2 * 0.45], [-len * 0.3, -w2 * 0.75],
    [0, -w2],
  ];
  const flameParts = [];
  const orange = chalkPuff(flameOutline(1.7, 0.55), { depth: 0.16, grid: 14, seed });
  const yellow = chalkPuff(flameOutline(1.1, 0.34), { depth: 0.12, grid: 12, seed: seed + 1 });
  for (const roll of [0, Math.PI / 2]) {
    // The puff faces +Z; swing its long axis (-X) to point down the -Z exhaust line.
    const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2)
      .premultiply(new THREE.Matrix4().makeRotationZ(roll));
    put(flameParts, xformed(orange, m.clone()), 0xf0872e, [0, LIFT + 0.28, -2.85], [-0.1, 0, 0]);
    put(flameParts, xformed(yellow, m.clone()), 0xf6cf4a, [0, LIFT + 0.28, -2.8], [-0.1, 0, 0]);
  }
  const flameTex = scribble(seed + 5, { angle: 0, repeat: 2 });
  const flame = mesh(mergeParts(flameParts), new THREE.MeshBasicMaterial({
    vertexColors: true, map: flameTex.map,
  }));
  flame.castShadow = false;
  g.add(flame);

  return g;
}

// ---------------------------------------------------------------------------
// The rainbow arch, the sun, the clouds, the birds -- the drawn sky
// ---------------------------------------------------------------------------

// Six chalk bands, each hand-misregistered a little against its neighbours, feet
// buried in cloud puffs. A partial torus is an OPEN TUBE at both cut ends -- the
// clouds are what close the composition over those holes, so they are load-bearing.
export function chalkRainbow({ seed = 7, radius = 15 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  for (let i = 0; i < 6; i++) {
    const R = radius - i * 1.04;
    const band = new THREE.TorusGeometry(R, 0.56, 10, 46, Math.PI);
    duo(P, K, band, new THREE.Color(RAINBOW[i]).getHex(),
      [randomIn(rng, -0.14, 0.14), randomIn(rng, -0.1, 0.1), i * 0.045],
      [0, 0, randomIn(rng, -0.025, 0.025)], { grow: 0.1 });
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const r = randomIn(rng, 1.0, 1.7);
      duo(P, K, ball(r, 14), CHALK.white,
        [s * (radius - 2.6) + randomIn(rng, -1.2, 1.2), randomIn(rng, 0.3, 1.4), randomIn(rng, -0.7, 0.7)],
        null, { scale: [1.15, 0.8, 1], grow: 0.11 });
    }
  }
  return chalkAssembly(P, K, { seed: seed + 43, repeat: 5, angle: 0.1 });
}

// A kid-drawing sun: ball, triangle rays in its own drawing plane (facing +Z -- the
// flattest drawings live in the sky, deliberately), and a face. Floats via absoluteY.
export function chalkSun({ seed = 9 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  duo(P, K, ball(2.6, 26), 0xf0cf4a, [0, 0, 0], null, { grow: 0.15 });
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + randomIn(rng, -0.06, 0.06);
    const long = i % 2 === 0;
    const len = (long ? 3.0 : 2.0) * randomIn(rng, 0.85, 1.15);
    const rad = long ? 0.66 : 0.48;
    const d = 2.45 + len * 0.32;
    const cone = new THREE.ConeGeometry(rad, len, 8);
    duo(P, K, cone, 0xf2a23c, [Math.cos(a) * d, Math.sin(a) * d, 0],
      [0, 0, a - Math.PI / 2], { grow: 0.1 });
  }
  put(P, ball(0.17, 10), INK, [-0.85, 0.45, 2.4]);
  put(P, ball(0.17, 10), INK, [0.85, 0.45, 2.4]);
  const smile = new THREE.TorusGeometry(0.95, 0.1, 8, 20, 2.1);
  smile.rotateZ(-Math.PI / 2 - 1.05);
  put(P, smile, 0xa8552e, [0, -0.1, 2.32]);
  put(P, ball(0.28, 8), 0xe89a60, [-1.35, -0.35, 2.05], null, { scale: [1, 0.65, 0.5] });
  put(P, ball(0.28, 8), 0xe89a60, [1.35, -0.35, 2.05], null, { scale: [1, 0.65, 0.5] });
  return chalkAssembly(P, K, { seed: seed + 44, repeat: 3.2, angle: 0.5 });
}

// A cloud puff cluster; `rain: true` hangs slanted chalk rain under it.
export function chalkCloud({ seed = 13, rain = false } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  duo(P, K, ball(2.4, 16), CHALK.white, [0, 0.4, 0], null, { scale: [1.6, 0.55, 1], grow: 0.12 });
  for (let i = 0; i < 5; i++) {
    const x = -2.6 + i * 1.3 + randomIn(rng, -0.3, 0.3);
    const r = randomIn(rng, 1.0, 1.7) * (1 - Math.abs(x) / 7);
    duo(P, K, ball(r, 16), CHALK.white, [x, 0.7 + r * 0.55, randomIn(rng, -0.4, 0.4)],
      null, { scale: [1.1, 0.9, 1], grow: 0.12 });
  }
  if (rain) {
    for (let i = 0; i < 9; i++) {
      const x = randomIn(rng, -2.6, 2.6);
      const z = randomIn(rng, -0.6, 0.6);
      const drop = new THREE.CylinderGeometry(0.06, 0.06, randomIn(rng, 0.9, 1.4), 6);
      // No ink hull: a hull on a rod this thin swallows the colour whole, and pale
      // blue against the paper sky IS the drawn look.
      put(P, drop, CHALK.sky, [x, randomIn(rng, -1.4, -0.6), z], [0, 0, 0.2]);
    }
  }
  return chalkAssembly(P, K, {
    seed: seed + 45, repeat: 3, angle: -0.2, emissive: 0xfbf9f2, emissiveIntensity: 0.3,
  });
}

// The two-arc scribble bird every child draws in every sky. Ink only -- it IS a line.
export function chalkBird({ seed = 17, span = 2.2 } = {}) {
  const K = [];
  const rng = seededRandom(seed);
  const s = span / 2.2;
  const lift = randomIn(rng, 0.4, 0.52) * s;
  const birdTube = tube(
    [[-1.1 * s, 0, 0], [-0.55 * s, lift, 0], [0, 0.04 * s, 0], [0.55 * s, lift, 0], [1.1 * s, 0, 0]],
    [0.05, 0.075, 0.07, 0.075, 0.05], { sides: 8, tubular: 30 },
  );
  K.push({ geometry: birdTube });
  return chalkAssembly([], K, { seed });
}

// ---------------------------------------------------------------------------
// The meadow furniture: house, trees, flowers, fence, signpost, kite, train
// ---------------------------------------------------------------------------

// The classic first-drawing house: wobbly walls, an oversized roof, a leaning chimney
// and a curl of smoke drawn in one line. Faces +Z.
export function chalkHouse({ seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];

  const walls = extrudeOutline(wobbly(rectOutline(4.5, 0, 6), rng, 0.03), 6.6);
  duo(P, K, walls, 0xf0cf6a, [0, 0, 0], null, { grow: 0.14 });

  const roofPts = wobbly([[-5.6, 5.65], [-1.8, 5.65], [2.2, 5.65], [5.6, 5.65], [3.6, 7.6], [0.25, 10.4], [-3.2, 7.8]], rng, 0.02);
  const roof = extrudeOutline(roofPts, 7.6);
  duo(P, K, roof, 0xd85440, [0, 0, 0], null, { grow: 0.14 });

  duo(P, K, new THREE.BoxGeometry(1.2, 3.4, 1.2), 0xa84034, [2.45, 8.9, -0.7], [0, 0, 0.09], { grow: 0.08 });

  // The smoke curl: one drawn line spiralling off the chimney top.
  const curl = [];
  curl.push([2.55, 10.4, -0.7], [2.75, 11.3, -0.7]);
  const cx = 3.45; const cy = 12.15;
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI * 0.7 + (i / 10) * Math.PI * 2.1;
    const r = 0.25 + (i / 10) * 0.75;
    curl.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85, -0.7]);
  }
  // NO ink hull on the smoke: the curl's loops overlap, so a hull fills every crevice
  // between them and the whole curl reads as solid ink. Smoke is the one thing in this
  // world soft enough to go outline-free.
  put(P, tube(curl, [0.28, 0.32, 0.36, 0.4, 0.45], { sides: 10, tubular: 40 }), 0xf2f0ea);

  // Door (rounded top, proud of the wall -- there is no CSG here), knob, two crossed
  // windows. The window cross-bars are DETAIL LINES: straight into the ink batch.
  const doorPts = [];
  doorPts.push([-0.8, 0]);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    doorPts.push([Math.cos(a) * 0.8, 2.4 + Math.sin(a) * 0.75]);
  }
  doorPts.push([0.8, 0]);
  duo(P, K, extrudeOutline(wobbly(doorPts, rng, 0.02), 0.3), CHALK.blue, [-1.4, 0, 3.32], null, { grow: 0.08 });
  put(P, ball(0.1, 8), CHALK.yellow, [-0.9, 1.55, 3.52]);
  for (const wx of [1.9]) {
    duo(P, K, extrudeOutline(wobbly(rectOutline(0.85, 3.1, 4.8), rng, 0.03), 0.24),
      CHALK.white, [wx, 0, 3.3], null, { grow: 0.08 });
    K.push({ geometry: tube([[wx - 0.85, 3.95, 3.48], [wx, 3.96, 3.5], [wx + 0.85, 3.95, 3.48]], [0.035, 0.035], { sides: 6 }) });
    K.push({ geometry: tube([[wx, 3.12, 3.48], [wx + 0.01, 3.95, 3.5], [wx, 4.78, 3.48]], [0.035, 0.035], { sides: 6 }) });
  }

  return chalkAssembly(P, K, { seed: seed + 46, repeat: 4, angle: -0.5 });
}

// A lollipop tree in any colour a child owns. Crown is overlapping smooth spheres, each
// with its own outline, so the canopy reads as a cluster of drawn lobes.
export function chalkTree({ seed = 21, color = 0x76b84a, fruit = 0xd94f41 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  duo(P, K, tube([[0, 0, 0], [0.24, 2.6, 0], [-0.16, 5.4, 0], [0, 7.0, 0]],
    [0.74, 0.56, 0.42, 0.34], { sides: 12 }), 0xa87c50, null, null, { grow: 0.06 });
  duo(P, K, tube([[0, 5.2, 0], [0.9, 6.3, 0.2], [1.45, 7.15, 0.3]], [0.26, 0.19, 0.14], { sides: 8 }),
    0xa87c50, null, null, { grow: 0.05 });

  const base = new THREE.Color(color);
  const lobes = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rng();
    const r = randomIn(rng, 1.5, 2.3);
    const c = [Math.cos(a) * randomIn(rng, 0.7, 1.7), 8.2 + Math.sin(i * 2.1) * 0.9 + randomIn(rng, -0.4, 0.6), Math.sin(a) * randomIn(rng, 0.6, 1.4)];
    lobes.push({ c, r });
    const tone = base.clone().lerp(new THREE.Color(0xffffff), randomIn(rng, 0, 0.22));
    duo(P, K, ball(r, 18), tone.getHex(), c, null, { scale: [1, 0.88, 1], grow: 0.12 });
  }
  for (let i = 0; i < 9; i++) {
    const lobe = lobes[Math.floor(rng() * lobes.length)];
    const th = rng() * Math.PI * 2;
    const ph = Math.acos(randomIn(rng, -0.15, 0.9));
    const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.88, Math.sin(ph) * Math.sin(th)];
    put(P, ball(0.21, 8), fruit,
      [lobe.c[0] + d[0] * lobe.r * 0.98, lobe.c[1] + d[1] * lobe.r * 0.98, lobe.c[2] + d[2] * lobe.r * 0.98]);
  }
  return chalkAssembly(P, K, { seed: seed + 47, repeat: 2.8, angle: 0.8 });
}

// A patch of giant chalk daisies, mixed colours, heads tilted toward +Z.
export function chalkFlowers({ seed = 23, count = 6 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  const heads = [CHALK.pink, CHALK.blue, CHALK.orange, CHALK.purple, CHALK.white, CHALK.red];
  for (let i = 0; i < count; i++) {
    const x = randomIn(rng, -3.6, 3.6);
    const z = randomIn(rng, -2.4, 2.4);
    const h = randomIn(rng, 1.6, 3.0);
    const lean = randomIn(rng, -0.25, 0.25);
    const top = [x + lean * h, h, z];
    duo(P, K, tube([[x, 0, z], [x + lean * h * 0.5, h * 0.55, z], top],
      [0.085, 0.075, 0.06], { sides: 8 }), 0x5a9e3c, null, null, { grow: 0.045 });
    for (const s of [-1, 1]) {
      const leaf = ball(0.38, 10);
      duo(P, K, leaf, 0x5a9e3c, [x + s * 0.28, h * 0.45, z], [0, 0, s * 0.7],
        { scale: [1.1, 0.3, 0.45], grow: 0.04 });
    }
    // The head: petals in a plane tilted up toward the viewer, placed by basis.
    const n = new THREE.Vector3(0, 0.75, 0.66).normalize(); // head plane normal
    const petalColor = heads[i % heads.length];
    const petals = 7;
    for (let pIdx = 0; pIdx < petals; pIdx++) {
      const a = (pIdx / petals) * Math.PI * 2 + rng() * 0.2;
      const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
        .projectOnPlane(n).normalize();
      const petal = ball(0.46, 10);
      petal.scale(1, 0.24, 0.55);
      const pc = radial.clone().multiplyScalar(0.56);
      const placedPetal = basisPlaced(petal, radial.toArray(), n.toArray(),
        [top[0] + pc.x, top[1] + pc.y + 0.1, top[2] + pc.z]);
      duo(P, K, placedPetal, petalColor, null, null, { grow: 0.05 });
    }
    duo(P, K, ball(0.24, 10), 0xe8b23c, [top[0], top[1] + 0.14, top[2] + 0.1], null, { grow: 0.05 });
  }
  return chalkAssembly(P, K, { seed: seed + 48, repeat: 2.4, angle: -0.3 });
}

// The fence Simon climbs over: tall boards, wobbly tops, and (optionally) the stile
// that says "this is the way in". Runs along X, faces +Z.
export function chalkFence({ seed = 27, length = 22, stile = false } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  const n = Math.max(4, Math.round(length / 1.5));
  const step = length / n;
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + step * (i + 0.5);
    const h = randomIn(rng, 4.5, 5.3);
    const tone = new THREE.Color(0xd8a86a).lerp(new THREE.Color(0xffffff), randomIn(rng, 0, 0.18));
    duo(P, K, new THREE.BoxGeometry(step * 0.78, h, 0.16), tone.getHex(),
      [x, h / 2 + 0.15, 0], [0, randomIn(rng, -0.04, 0.04), randomIn(rng, -0.035, 0.035)], { grow: 0.075 });
  }
  for (const railY of [1.5, 3.55]) {
    duo(P, K, new THREE.BoxGeometry(length + 0.6, 0.5, 0.22), 0xb98a52, [0, railY, -0.24], null, { grow: 0.05 });
  }
  for (const px of [-length / 2, length / 2]) {
    duo(P, K, new THREE.BoxGeometry(0.55, 5.6, 0.5), 0xa87a48, [px, 2.85, -0.2], [0, 0, randomIn(rng, -0.03, 0.03)], { grow: 0.05 });
  }
  if (stile) {
    // A little ladder leaning on the front face at the near end.
    const lx = -length / 2 + 1.4;
    for (const s of [-1, 1]) {
      duo(P, K, tube([[lx + s * 0.5, 0.1, 1.9], [lx + s * 0.42, 2.4, 1.0], [lx + s * 0.36, 4.6, 0.15]],
        [0.11, 0.1, 0.1], { sides: 8 }), 0xb98a52, null, null, { grow: 0.04 });
    }
    for (let i = 0; i < 4; i++) {
      const t = 0.16 + i * 0.24;
      const y = 0.1 + t * 4.5;
      const z = 1.9 - t * 1.75;
      const rung = new THREE.CylinderGeometry(0.08, 0.08, 1.0, 8);
      rung.rotateZ(Math.PI / 2);
      duo(P, K, rung, 0xb98a52, [lx, y, z], null, { grow: 0.035 });
    }
  }
  return chalkAssembly(P, K, { seed: seed + 49, repeat: 3.4, angle: -1.1 });
}

// A leaning signpost with three arrow boards and hand-lettered text.
export function chalkSignpost({ seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  duo(P, K, tube([[0, 0, 0], [0.12, 3.4, 0], [0.3, 6.9, 0]], [0.17, 0.15, 0.13], { sides: 10 }),
    CHALK.brown, null, null, { grow: 0.05 });
  duo(P, K, ball(0.2, 10), CHALK.red, [0.32, 7.05, 0], null, { grow: 0.04 });

  const boards = [
    { y: 6.1, dir: 1, w: 3.6, color: CHALK.green, text: 'CHALK LAND' },
    { y: 5.15, dir: -1, w: 2.9, color: CHALK.orange, text: 'HOME' },
    { y: 4.2, dir: 1, w: 3.3, color: CHALK.blue, text: 'ART SHOW' },
  ];
  const texTexts = [];
  for (const b of boards) {
    const half = b.w / 2;
    const pts = b.dir > 0
      ? [[-half, -0.42], [half - 0.5, -0.42], [half + 0.35, 0], [half - 0.5, 0.42], [-half, 0.42]]
      : [[-half + 0.5, -0.42], [half, -0.42], [half, 0.42], [-half + 0.5, 0.42], [-half - 0.35, 0]];
    // Each board's placement is remembered so its TEXT PLATE can take the identical
    // transform: a flat plate under a yawed board sinks into the wood at one end and
    // clips the lettering mid-word.
    b.px = 0.18 + (rng() - 0.5) * 0.1;
    b.rot = [0, randomIn(rng, -0.14, 0.14), randomIn(rng, -0.03, 0.03)];
    duo(P, K, extrudeOutline(wobbly(pts, rng, 0.03), 0.18), b.color,
      [b.px, b.y, 0], b.rot, { grow: 0.045 });
    texTexts.push(b);
  }
  const g = chalkAssembly(P, K, { seed: seed + 50, repeat: 2.6, angle: -0.8 });

  // Three text plates share one canvas, one material, one mesh-merge.
  const tex = canvasTexture(512, 384, (ctx) => {
    ctx.clearRect(0, 0, 512, 384);
    texTexts.forEach((b, i) => {
      chalkText(ctx, b.text, 256, 128 * i + 88, 66, '#ffffff', { align: 'center' });
    });
  });
  const plateParts = [];
  texTexts.forEach((b, i) => {
    const plate = new THREE.PlaneGeometry(b.w * 0.82, 0.62);
    const uv = plate.attributes.uv;
    for (let u = 0; u < uv.count; u++) {
      uv.setY(u, (2 - i) / 3 + uv.getY(u) / 3);
    }
    plate.translate(0, 0, 0.115); // proud of the board FACE, so the shared rotation carries it
    put(plateParts, plate, 0xffffff, [b.px, b.y, 0], b.rot);
  });
  const plates = mesh(mergeParts(plateParts), standard({
    map: tex, transparent: true, alphaTest: 0.25, roughness: 0.9,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  plates.castShadow = false;
  g.add(plates);
  return g;
}

// The kite: a puffed diamond on a drawn string with bow tails, tied to a little spool
// on the ground. Origin at the spool (base centre); the kite rides high.
export function chalkKite({ seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  const top = [0.4, 12.4, 0.1];

  // A kite is the one drawing here that must stay CRISP. Puffed, its rim-snapped grid
  // rounded off the very corners that make a diamond a kite and it read as a leaf; a
  // paper kite is genuinely flat, so a thin extrusion is the honest solid, and the ink
  // hull is what softens the arris into a drawn line.
  const diamond = extrudeOutline([[0, -2.15], [1.08, 0.35], [0, 2.15], [-1.08, 0.35]], 0.22);
  const kiteRot = [0.3, 0.35, 0.12];
  duo(P, K, diamond, CHALK.red, top, kiteRot, { grow: 0.06 });
  // Crossbar detail lines, drawn proud of the face.
  K.push({
    geometry: tube([[0, 2.0, 0.24], [0, -0.05, 0.28], [0, -2.0, 0.24]], [0.045, 0.045], { sides: 6 }),
    position: top, rotation: kiteRot,
  });
  K.push({
    geometry: tube([[-1.0, 0.34, 0.24], [0, 0.37, 0.28], [1.0, 0.34, 0.24]], [0.045, 0.045], { sides: 6 }),
    position: top, rotation: kiteRot,
  });

  // The string: one drawn line sagging to the spool, with bows along it.
  const stringPts = [
    [top[0], top[1] - 2.15, top[2]],
    [1.0, 9.0, 0.55], [0.65, 5.6, 0.9], [0.12, 2.2, 0.5], [0, 0.42, 0],
  ];
  K.push({ geometry: tube(stringPts, [0.035, 0.035], { sides: 6, tubular: 36 }) });
  const bowColors = [CHALK.yellow, CHALK.blue, CHALK.green, CHALK.purple];
  const curve = new THREE.CatmullRomCurve3(stringPts.map((p) => new THREE.Vector3(...p)));
  for (let i = 0; i < 4; i++) {
    const p = curve.getPoint(0.14 + i * 0.21);
    for (const s of [-1, 1]) {
      const wing = ball(0.27, 8);
      duo(P, K, wing, bowColors[i], [p.x + s * 0.24, p.y, p.z],
        [0, 0, s * 0.65], { scale: [1, 0.45, 0.3], grow: 0.04 });
    }
    put(P, ball(0.08, 6), INK, [p.x, p.y, p.z]);
  }
  const spool = new THREE.CylinderGeometry(0.3, 0.3, 0.6, 12);
  spool.rotateZ(Math.PI / 2);
  duo(P, K, spool, CHALK.brown, [0, 0.32, 0], null, { grow: 0.05 });
  duo(P, K, new THREE.CylinderGeometry(0.06, 0.06, 0.8, 6), 0x77492a, [0.38, 0.36, 0], [0, 0, 0.5], { grow: 0.035 });

  return chalkAssembly(P, K, { seed: seed + 51, repeat: 2.2, angle: 0.3 });
}

// The chalk train: a toy engine whose whole side profile is ONE inflated drawing --
// the most literal "flat drawing puffed into a thing" in the world, which is why it is
// the object the second activity board hands the student. Faces +Z.
export function chalkTrain({ seed = 33 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];

  // Side profile in (x = forward, y = up), puffed, then swung so +x -> +Z.
  const profile = wobbly([
    [-3.1, 0.72], [-3.15, 2.4], [-3.2, 3.95], [-2.15, 4.1], [-1.12, 3.95], [-1.08, 2.6],
    [0.2, 2.62], [1.5, 2.58], [2.45, 2.5], [2.95, 2.05], [3.1, 1.4], [3.05, 0.74],
    [1.2, 0.7], [-1.0, 0.72],
  ], rng, 0.012);
  const body = chalkPuff(profile, { depth: 1.02, grid: 30, seed });
  body.rotateY(-Math.PI / 2); // outline +x -> +Z, puff thickness -> width
  duo(P, K, body, 0x4573cc, null, null, { grow: 0.11 });

  // Cab roof, funnel, dome, headlamp, cowcatcher.
  duo(P, K, new THREE.BoxGeometry(2.6, 0.2, 2.5), 0xd85440, [0, 4.14, -2.16], [0, 0, 0.015], { grow: 0.05 });
  // Red with a gold lip -- navy read as a black bar against its own ink outline.
  const funnel = lathed([[0, 2.4], [0.28, 2.4], [0.3, 3.3], [0.5, 3.6], [0.42, 3.82], [0, 3.85]], { segments: 14 });
  duo(P, K, funnel, 0xd85440, [0, 0, 1.9], null, {
    grow: 0.06, keepColor: true,
    tint: (p) => (p.y > 3.42 ? [0.92, 0.76, 0.34] : [0.85, 0.33, 0.25]),
  });
  for (let i = 0; i < 3; i++) {
    duo(P, K, ball(0.3 + i * 0.14, 12), CHALK.white, [0.12 * i, 4.1 + i * 0.72, 1.88 - i * 0.22],
      null, { grow: 0.07 });
  }
  duo(P, K, ball(0.4, 12), CHALK.yellow, [0, 2.75, 0.5], null, { scale: [0.8, 0.6, 0.8], grow: 0.045 });
  duo(P, K, ball(0.27, 10), CHALK.yellow, [0, 2.4, 3.2], null, { grow: 0.04 });
  const catcher = extrudeOutline([[0, 0.08], [1.0, 0.08], [0.05, 1.05]], 1.6);
  catcher.rotateY(-Math.PI / 2);
  duo(P, K, catcher, 0xd85440, [0, 0, 3.05], null, { grow: 0.05 });

  // Wheels: cylinders proud of the flanks, with hub studs and their own ink rings.
  const wheelDefs = [
    { z: -1.7, r: 1.05 }, { z: 0.45, r: 0.68 }, { z: 1.85, r: 0.68 },
  ];
  for (const s of [-1, 1]) {
    for (const wDef of wheelDefs) {
      const wheel = new THREE.CylinderGeometry(wDef.r, wDef.r, 0.22, 18);
      wheel.rotateZ(Math.PI / 2);
      duo(P, K, wheel, 0xd85440, [s * 1.12, wDef.r + 0.06, wDef.z], null, { grow: 0.08 });
      put(P, ball(0.16, 8), CHALK.white, [s * 1.26, wDef.r + 0.06, wDef.z], null, { scale: [0.5, 1, 1] });
    }
  }

  return chalkAssembly(P, K, { seed: seed + 52, repeat: 2.8, angle: 0.1 });
}

// A butterfly built from four puffed wing-drawings. One ships circling the flowers.
// Faces +Z (its travel direction); origin at base centre, wings up around y ~1.
export function chalkButterfly({ seed = 37, color = 0xe58ab4 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  const bodyY = 0.85;
  duo(P, K, tube([[0, bodyY, -0.32], [0, bodyY + 0.02, 0], [0, bodyY, 0.3]],
    [0.06, 0.09, 0.06], { sides: 8 }), 0x4a4468, null, null, { grow: 0.035 });
  duo(P, K, ball(0.11, 8), 0x4a4468, [0, bodyY + 0.03, 0.36], null, { grow: 0.035 });
  for (const s of [-1, 1]) {
    K.push({
      geometry: tube([[s * 0.04, bodyY + 0.1, 0.42], [s * 0.14, bodyY + 0.32, 0.52], [s * 0.26, bodyY + 0.42, 0.5]],
        [0.02, 0.02], { sides: 5 }),
    });
    put(P, ball(0.045, 6), 0x4a4468, [s * 0.27, bodyY + 0.44, 0.5]);
  }
  const upper = chalkPuff(wobbly([[0.05, 0.1], [0.55, 0.5], [0.85, 0.42], [0.95, 0.05], [0.7, -0.32], [0.25, -0.28]], rng, 0.05),
    { depth: 0.05, grid: 12, seed });
  const lower = chalkPuff(wobbly([[0.05, 0.05], [0.5, 0.1], [0.68, -0.18], [0.5, -0.5], [0.12, -0.35]], rng, 0.05),
    { depth: 0.04, grid: 10, seed: seed + 1 });
  const tone2 = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3).getHex();
  for (const s of [-1, 1]) {
    // Wing plane: outboard axis tilted 38 degrees up, chord along the body (+Z).
    const out = [s * Math.cos(0.66), Math.sin(0.66), 0];
    const wUp = basisPlaced(s < 0 ? mirroredX(upper) : upper, out, [0, 0, -1], [s * 0.05, bodyY + 0.05, 0.1]);
    const wLo = basisPlaced(s < 0 ? mirroredX(lower) : lower, out, [0, 0, -1], [s * 0.05, bodyY, -0.12]);
    duo(P, K, wUp, color, null, null, { grow: 0.035 });
    duo(P, K, wLo, tone2, null, null, { grow: 0.03 });
    // Spots live ON the wing plane, placed in the wing's own basis (local x -> `out`,
    // local y -> -Z) and sunk half-through so a dot bulges from both faces. Placed in
    // free space along `out` alone they float off the wing tip.
    const wingAt = (lx, ly) => [s * 0.05 + out[0] * lx, bodyY + 0.05 + out[1] * lx, 0.1 - ly];
    put(P, ball(0.09, 8), CHALK.white, wingAt(0.5, 0.06));
    put(P, ball(0.06, 8), CHALK.yellow, wingAt(0.78, -0.04));
  }
  return chalkAssembly(P, K, { seed: seed + 53, repeat: 2, angle: 0.6 });
}

function mirroredX(geometry) {
  const g = geometry.clone();
  g.scale(-1, 1, 1);
  // A negative scale flips winding; flip the index back so faces stay outward.
  const index = g.index.array;
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// The boards: blackboard welcome, easel invitation
// ---------------------------------------------------------------------------

// The welcome board IS a blackboard -- the one surface in this world chalk actually
// belongs on. Chalk tray, three chalk sticks, an eraser, hand-jittered lettering.
export function chalkBlackboard({ seed = 39 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];

  // A-frame legs and cross-braces.
  for (const s of [-1, 1]) {
    for (const lean of [-1, 1]) {
      duo(P, K, tube([[s * 4.6, 8.6, 0], [s * 4.75, 4.2, lean * 0.85], [s * 4.9, 0.15, lean * 1.7]],
        [0.15, 0.16, 0.17], { sides: 8 }), CHALK.brown, null, null, { grow: 0.05 });
    }
    const braceGeo = new THREE.CylinderGeometry(0.09, 0.09, 3.0, 8);
    braceGeo.rotateX(Math.PI / 2);
    duo(P, K, braceGeo, CHALK.brown, [s * 4.82, 2.2, 0], null, { grow: 0.04 });
  }
  // Frame and board.
  duo(P, K, new THREE.BoxGeometry(10.4, 7.2, 0.42), 0xb9853f, [0, 5.7, 0], null, { grow: 0.07 });
  duo(P, K, new THREE.BoxGeometry(9.9, 0.3, 0.9), 0xa87a48, [0, 2.02, 0.3], null, { grow: 0.05 });
  const chalkColors = [CHALK.white, CHALK.pink, CHALK.blue, CHALK.yellow];
  for (let i = 0; i < 4; i++) {
    const stick = new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8);
    stick.rotateZ(Math.PI / 2);
    duo(P, K, stick, chalkColors[i], [-3.1 + i * 1.1 + randomIn(rng, -0.2, 0.2), 2.24, 0.32 + randomIn(rng, -0.1, 0.1)],
      [0, randomIn(rng, -0.4, 0.4), 0], { grow: 0.03 });
  }
  duo(P, K, new THREE.BoxGeometry(0.8, 0.2, 0.36), 0x777d8a, [3.4, 2.26, 0.3], [0, 0.2, 0], { grow: 0.035 });

  const g = chalkAssembly(P, K, { seed: seed + 54, repeat: 3, angle: -1.2 });

  // The board face, drawn as a real blackboard: smudge wipes, rainbow headline,
  // white chalk lines, corner doodles. Emissive so it reads at any sun angle -- the
  // activity-board rule.
  const tex = canvasTexture(1180, 800, (ctx, w, h) => {
    ctx.fillStyle = '#2c3f36';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(255,255,255,${randomIn(rng, 0.015, 0.05).toFixed(3)})`;
      ctx.save();
      ctx.translate(rng() * w, rng() * h);
      ctx.rotate((rng() - 0.5) * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, 0, randomIn(rng, 90, 260), randomIn(rng, 20, 48), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    chalkText(ctx, 'WELCOME TO', w / 2, 96, 44, 'rgba(255,255,255,0.85)', { align: 'center', rng });
    // Rainbow headline: each word its own chalk colour. Measured, SHRUNK TO FIT, then
    // drawn -- the third prop in this project to relearn that a guessed type size runs
    // off its own board (cardTexture's body, standingSign's title, now this).
    const words = [['THE', '#e88a7a'], ['LAND', '#f0b04a'], ['OF', '#e8d15c'], ['CHALK', '#8ecf6a'], ['DRAWINGS', '#7ab8e8']];
    const measure = (size) => {
      ctx.font = `700 ${size}px ${HAND}`;
      return words.reduce((acc, [word]) => acc + ctx.measureText(word).width, 0) + size * 0.3 * (words.length - 1);
    };
    let headSize = 78;
    while (headSize > 30 && measure(headSize) > w - 190) headSize -= 2;
    const gap = headSize * 0.3;
    let x = (w - measure(headSize)) / 2;
    for (const [word, color] of words) {
      x += chalkText(ctx, word, x, 190, headSize, color, { rng }) + gap;
    }
    const lines = [
      ['Simon drew everything you can see —', 300],
      ['and it all came alive.', 358],
      ['The puppy and the rocket are drawing', 452],
      ['with their chalk RIGHT NOW. Watch!', 510],
      ['Draw your own creature:', 604],
      ['Menu › Create Model › Load Object › Draw', 662],
    ];
    for (const [text, y] of lines) {
      chalkText(ctx, text, w / 2, y, text.includes('Menu') ? 40 : 43, y > 560 ? '#f2e9a0' : 'rgba(255,255,255,0.93)', { align: 'center', rng });
    }
    // Corner doodles: a star, a spiral, a little sun, a heart.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 5;
    const star = (sx, sy, r) => {
      ctx.beginPath();
      for (let i = 0; i <= 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      ctx.stroke();
    };
    star(80, 100, 34);
    star(w - 90, 660, 26);
    // The spiral squiggle lives in the left margin, well clear of the headline it
    // originally overlapped.
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const a = i * 0.5;
      const r = 2 + i * 1.0;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](74 + Math.cos(a) * r, 480 + Math.sin(a) * r * 0.8);
    }
    ctx.stroke();
    // A heart for the top-right corner.
    ctx.beginPath();
    const hx = w - 88; const hy = 96; const hr = 26;
    ctx.moveTo(hx, hy + hr * 0.9);
    ctx.bezierCurveTo(hx - hr * 1.5, hy - hr * 0.4, hx - hr * 0.55, hy - hr * 1.25, hx, hy - hr * 0.35);
    ctx.bezierCurveTo(hx + hr * 0.55, hy - hr * 1.25, hx + hr * 1.5, hy - hr * 0.4, hx, hy + hr * 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,180,90,0.8)';
    ctx.beginPath();
    ctx.arc(95, 690, 26, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(95 + Math.cos(a) * 34, 690 + Math.sin(a) * 34);
      ctx.lineTo(95 + Math.cos(a) * 48, 690 + Math.sin(a) * 48);
      ctx.stroke();
    }
  });
  const face = mesh(new THREE.PlaneGeometry(9.7, 6.5), standard({
    map: tex, roughness: 0.92,
    emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.42,
  }));
  face.position.set(0, 5.72, 0.22);
  g.add(face);
  return g;
}

// The easel: the standing invitation to use the Draw tool, with a rack of chalk.
export function chalkEasel({ seed = 43 } = {}) {
  const rng = seededRandom(seed);
  const P = [];
  const K = [];
  for (const s of [-1, 1]) {
    duo(P, K, tube([[s * 0.4, 6.8, 0.1], [s * 0.9, 3.4, 0.35], [s * 1.5, 0.15, 0.6]],
      [0.13, 0.14, 0.15], { sides: 8 }), CHALK.brown, null, null, { grow: 0.045 });
  }
  duo(P, K, tube([[0, 6.75, 0.05], [0, 3.4, -0.75], [0, 0.15, -1.55]],
    [0.13, 0.14, 0.15], { sides: 8 }), CHALK.brown, null, null, { grow: 0.045 });
  const trayGeo = new THREE.BoxGeometry(3.9, 0.18, 0.7);
  duo(P, K, trayGeo, 0xa87a48, [0, 2.5, 0.62], [-0.12, 0, 0], { grow: 0.045 });
  const rack = [CHALK.red, CHALK.orange, CHALK.yellow, CHALK.green, CHALK.blue, CHALK.purple];
  for (let i = 0; i < rack.length; i++) {
    const stick = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8);
    stick.rotateZ(Math.PI / 2);
    stick.rotateY(randomIn(rng, -0.5, 0.5));
    duo(P, K, stick, rack[i], [-1.45 + i * 0.58, 2.66, 0.66], null, { grow: 0.03 });
  }
  duo(P, K, new THREE.BoxGeometry(4.3, 5.0, 0.16), 0xc9a86a, [0, 5.0, 0.32], [-0.12, 0, 0], { grow: 0.05 });
  const g = chalkAssembly(P, K, { seed: seed + 55, repeat: 2.4, angle: -0.9 });

  const tex = canvasTexture(560, 640, (ctx, w, h) => {
    ctx.fillStyle = '#f8f5ea';
    ctx.fillRect(0, 0, w, h);
    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = '#b9b2a0';
    ctx.lineWidth = 5;
    ctx.strokeRect(30, 30, w - 60, h - 60);
    ctx.setLineDash([]);
    chalkText(ctx, 'YOUR', w / 2, 190, 92, '#8a92a8', { align: 'center', rng });
    chalkText(ctx, 'DRAWING', w / 2, 300, 92, '#8a92a8', { align: 'center', rng });
    chalkText(ctx, 'HERE', w / 2, 410, 92, '#8a92a8', { align: 'center', rng });
    chalkText(ctx, 'Menu › Create Model ›', w / 2, 510, 34, '#a8a294', { align: 'center', rng });
    chalkText(ctx, 'Load Object › Draw', w / 2, 560, 34, '#a8a294', { align: 'center', rng });
  });
  const face = mesh(new THREE.PlaneGeometry(3.9, 4.6), standard({
    map: tex, roughness: 0.95,
    emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.28,
  }));
  face.position.set(0, 5.02, 0.44);
  face.rotation.x = -0.12;
  g.add(face);
  return g;
}
