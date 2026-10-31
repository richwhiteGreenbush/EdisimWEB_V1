// Builders for the Model Database's second body set: the eye, the ear, the tooth, the skin and the
// digestive tract. Four of the five are SECTIONS, and a section is two different problems.
//
// THE ONE IDEA IN THIS FILE: A CUT FACE IS A FLAT PLATE WITH A PAINTING ON IT, AND A HOLLOW IN A CUT
// FACE IS BUILT VOID FIRST.
//
//  * The layers of a tooth or an eye are razor sharp in life and a vertex tint cannot draw them, so
//    every cut face is a plane carrying a canvas, painted by filling the same regions the solids are
//    built from. `contour` traces a region off its distance field and the very same loops then cut
//    the plate's outline, cut its holes and fill its colours, so a layer cannot disagree with the
//    solid it belongs to.
//  * There is no CSG, so a hollow is a sculpt of the void, turned inside out, trimmed at the plane
//    (`hollowAt`), with the plate's hole traced from the same field. Whatever is hung in the hollow
//    (ossicles, a nerve in a root canal) is real geometry standing in real depth.
//  * Anything that must read as an object rather than as a layer stands proud of the plate and is
//    half sunk into it, so it can neither float nor show a crescent of daylight.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, extrudeOutline, roundedOutline } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, sphereP, ellipsoidP, segsP, curveP, boxP, Sculpt, polygonize, tube, lathe, vesselMouth, tintVertices, polylineDist, organMesh, grainBump, standBase, outward, flipped,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Shared: regions, plates and hollows
// ---------------------------------------------------------------------------------------------

// Marching squares over f(a, b), negative inside. Returns closed loops of [a, b] with the inside on
// the left, so an outer boundary is counter-clockwise and a hole clockwise.
function contour(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  const H = (i, j) => (i + j * na) * 2;
  const V = (i, j) => (i + j * na) * 2 + 1;
  const point = (edge) => {
    const horizontal = edge % 2 === 0;
    const at = Math.floor(edge / 2);
    const i = at % na; const j = Math.floor(at / na);
    const p = v[at]; const q = v[horizontal ? at + 1 : at + na];
    const t = p / (p - q);
    return horizontal ? [a0 + (i + t) * cell, b0 + j * cell] : [a0 + i * cell, b0 + (j + t) * cell];
  };
  const next = new Map();
  for (let j = 0; j < nb - 1; j++) {
    for (let i = 0; i < na - 1; i++) {
      const c0 = v[i + j * na]; const c1 = v[i + 1 + j * na]; const c2 = v[i + 1 + (j + 1) * na]; const c3 = v[i + (j + 1) * na];
      const mask = (c0 < 0 ? 1 : 0) | (c1 < 0 ? 2 : 0) | (c2 < 0 ? 4 : 0) | (c3 < 0 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      const e0 = H(i, j); const e1 = V(i + 1, j); const e2 = H(i, j + 1); const e3 = V(i, j);
      const centre = (c0 + c1 + c2 + c3) < 0;
      const link = (p, q) => next.set(p, q);
      switch (mask) {
        case 1: link(e0, e3); break;
        case 2: link(e1, e0); break;
        case 3: link(e1, e3); break;
        case 4: link(e2, e1); break;
        case 5: if (centre) { link(e0, e1); link(e2, e3); } else { link(e0, e3); link(e2, e1); } break;
        case 6: link(e2, e0); break;
        case 7: link(e2, e3); break;
        case 8: link(e3, e2); break;
        case 9: link(e0, e2); break;
        case 10: if (centre) { link(e3, e0); link(e1, e2); } else { link(e1, e0); link(e3, e2); } break;
        case 11: link(e1, e2); break;
        case 12: link(e3, e1); break;
        case 13: link(e0, e1); break;
        case 14: link(e3, e0); break;
        default: break;
      }
    }
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let e = start;
    while (e !== undefined && !used.has(e)) {
      used.add(e);
      loop.push(point(e));
      e = next.get(e);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

const loopArea = (loop) => {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return s / 2;
};

function insideLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i]; const [xj, yj] = loop[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A flat plate from contour loops. `at(a, b)` puts a point in the world, `uv(a, b)` on the painting,
// and `normal` says which way it faces. The triangulation's own winding is measured, not assumed.
function plate(loops, at, uv, normal) {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  const positions = []; const uvs = []; const normals = []; const index = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => insideLoop(h[0], outer));
    const contourPts = outer.map(([x, y]) => new THREE.Vector2(x, y));
    const holePts = mine.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const faces = THREE.ShapeUtils.triangulateShape(contourPts, holePts);
    const base = positions.length / 3;
    for (const [a, b] of [...outer, ...mine.flat()]) {
      const p = at(a, b); positions.push(p[0], p[1], p[2]);
      const t = uv(a, b); uvs.push(t[0], t[1]);
      normals.push(normal[0], normal[1], normal[2]);
    }
    for (const [i, j, k] of faces) index.push(base + i, base + j, base + k);
  }
  const P = positions;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const ux = P[b * 3] - P[a * 3]; const uy = P[b * 3 + 1] - P[a * 3 + 1]; const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3]; const vy = P[c * 3 + 1] - P[a * 3 + 1]; const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    if (nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) { index[t + 1] = c; index[t + 2] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

// A sculpt ended at the plane z = plane. Polygonised past the plane so the walls are true walls where
// they cross it, then the far cap is thrown away and whatever crossed is pressed onto the plane, so
// the mesh's rim lies on the plate's contour with no chamfer between them.
function trimmedAt(sculpt, plane, options = {}) {
  const margin = sculpt.cell * 1.6;
  const reach = 200;
  sculpt.sub({
    box: [-reach, -reach, plane + margin, reach, reach, plane + margin + reach],
    f: (x, y, z) => plane + margin - z,
  });
  const g = polygonize(sculpt, options);
  const p = g.attributes.position;
  const idx = g.index;
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (p.getZ(a) >= plane && p.getZ(b) >= plane && p.getZ(c) >= plane) continue;
    kept.push(a, b, c);
  }
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > plane) p.setZ(i, plane);
  g.setIndex(kept);
  return g;
}

// The inside of a void: a sculpt of it, trimmed at the plane and turned inside out.
const hollowAt = (sculpt, plane, options) => flipped(trimmedAt(sculpt, plane, options));

// A distance field slice as a function of (a, b), from any sculpt's ops.
function sliceOf(ops, z) {
  return (x, y) => {
    let d = 1e9;
    for (const op of ops) {
      if (op.kind === 0) {
        const v = op.f(x, y, z);
        if (op.k > 0) {
          const h = Math.max(op.k - Math.abs(d - v), 0) / op.k;
          d = Math.min(d, v) - h * h * op.k * 0.25;
        } else if (v < d) d = v;
      } else if (op.kind === 1) {
        const c = -op.f(x, y, z);
        if (op.k > 0) {
          const h = Math.max(op.k - Math.abs(d - c), 0) / op.k;
          d = Math.max(d, c) + h * h * op.k * 0.25;
        } else if (c > d) d = c;
      } else if (d < 1e8) d = op.map(d, x, y, z);
    }
    return d;
  };
}

// A slow field read once onto a grid and bilinearly after that, since one section asks the same field
// for a dozen contours and each distance is a walk over a few hundred segments.
function gridded(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  return (a, b) => {
    const x = Math.max(0, Math.min(na - 1.001, (a - a0) / cell));
    const y = Math.max(0, Math.min(nb - 1.001, (b - b0) / cell));
    const i = Math.floor(x); const j = Math.floor(y);
    const s = x - i; const t = y - j;
    const p = i + j * na;
    return (v[p] * (1 - s) + v[p + 1] * s) * (1 - t) + (v[p + na] * (1 - s) + v[p + na + 1] * s) * t;
  };
}

// Fills loops on a canvas through a mapping from model feet to pixels. Even-odd, so a loop inside a
// loop is a hole, exactly as the plate sees it.
function fillLoops(ctx, loops, map, style) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  if (style) ctx.fillStyle = style;
  ctx.fill('evenodd');
}

function traceLoops(ctx, loops, map, style, width) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function clipLoops(ctx, loops, map) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.clip('evenodd');
}

// A parametric sheet: rows i along the profile, columns j round it. Normals are computed, and a
// caller who cares about which way it faces hands it through `outward` while the origin is sensible.
function sheet(rows, cols, point, uv = null) {
  const positions = []; const uvs = []; const index = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const p = point(i / rows, j / cols);
      positions.push(p[0], p[1], p[2]);
      const t = uv ? uv(i / rows, j / cols) : [j / cols, i / rows];
      uvs.push(t[0], t[1]);
    }
  }
  const w = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * w + j; const b = a + 1; const c = a + w + 1; const d = a + w;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Human eye
// ---------------------------------------------------------------------------------------------

// Everything is authored in the eye's own frame, the optical axis along +Z with the centre at the
// origin, then turned and lifted as one piece. Dimensions are a real adult eye's at 5ft for a 24mm
// globe (1mm = 0.208ft), which is the card's "about 60 times".
//
// It is a RIGHT eye, seen from the front: the owner of it faces +Z, so their nose is toward +X. The
// wedge is the upper nasal quarter. That is what puts the optic disc on the floor of the cut, since
// the disc lies about 15 degrees to the nasal side of the back of the eye.
//
// AN EYE IS A SOLID OF REVOLUTION, SO ONLY A CUT THROUGH ITS AXIS SHOWS IT PROPERLY, AND A CUT THROUGH
// ITS AXIS IS EDGE-ON TO ANYBODY STANDING DEAD AHEAD. So the eye is turned in its cradle, toward -X and
// a little down, by just enough that a student in front looks into the wedge and still meets the iris.
const EYE = {
  R: 2.5, // outer sclera
  rChoroid: 2.33,
  rRetina: 2.245,
  rVitreous: 2.15,
  corneaZ: 1.108, corneaR: 1.625, corneaIn: 1.52,
  limbusR: 1.22, limbusZ: 2.18,
  pupil: 0.42,
  irisRoot: 1.33, irisZ: 2.0,
  lensFront: 1.96, lensBack: 1.13, lensR: 0.98, lensEq: 1.6,
  ora: 1.02, // where the retina stops, in z
  phiA: THREE.MathUtils.degToRad(-14), // the floor of the wedge
  phiB: THREE.MathUtils.degToRad(82), // its wall
  discPolar: THREE.MathUtils.degToRad(15),
};

function eyeSectionPainting() {
  const W = 1024; const rowH = 512;
  const PX = W / 5.5; // feet to pixels
  const Z0 = -2.62;
  const paintRow = (ctx, top, withDisc) => {
    const mapX = (z) => (z - Z0) * PX;
    const mapY = (rho) => top + rowH - 8 - rho * PX;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, W, rowH);
    ctx.clip();
    const disc = (r, style) => {
      ctx.beginPath();
      ctx.arc(mapX(0), mapY(0), r * PX, 0, Math.PI * 2);
      ctx.fillStyle = style;
      ctx.fill();
    };
    // The cream of the sclera runs under everything, and past the axis so nothing leaves a seam.
    ctx.fillStyle = '#eee7d8';
    ctx.fillRect(0, top, W, rowH);
    // Sclera: collagen in long lamellae, a few fine lines following the wall.
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(mapX(0), mapY(0), (2.355 + i * 0.03) * PX, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(176,160,132,0.34)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // The back of the eye is painted as three nested discs, and the front is then laid over them.
    disc(EYE.rChoroid, '#5a2118');
    // Choroid: a dense bed of vessels, so a bead of red through the dark brown.
    const rng = seededRandom(withDisc ? 311 : 617);
    for (let i = 0; i < 180; i++) {
      const a = rng() * Math.PI * 1.1 + Math.PI * 0.45;
      const r = EYE.rRetina + rng() * (EYE.rChoroid - EYE.rRetina);
      ctx.fillStyle = rng() > 0.5 ? '#a4301f' : '#34110e';
      ctx.beginPath();
      ctx.ellipse(mapX(Math.cos(a) * r), mapY(Math.abs(Math.sin(a)) * r), 2.6 + rng() * 2.2, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    disc(EYE.rRetina, '#f08a3c');
    // Retina: its layers as bands, with the pale fibre layer on the inside.
    disc(EYE.rRetina - 0.03, '#e4562f');
    disc(EYE.rRetina - 0.06, '#f6a55a');
    // The vitreous is a solid pale jelly in a cut face, shaded so it reads as depth rather than card.
    const glow = ctx.createRadialGradient(mapX(-0.2), mapY(0.2), 0.2 * PX, mapX(-0.2), mapY(0.2), EYE.rVitreous * PX);
    glow.addColorStop(0, '#f3f4e6');
    glow.addColorStop(0.72, '#e4ebdf');
    glow.addColorStop(1, '#c6d6cf');
    disc(EYE.rVitreous, glow);
    // Faint veils in the jelly, sweeping from the lens back to the wall.
    ctx.strokeStyle = 'rgba(150,172,166,0.28)';
    ctx.lineWidth = 1.4;
    for (let i = 1; i <= 7; i++) {
      const rho = i * 0.27;
      ctx.beginPath();
      ctx.moveTo(mapX(0.9), mapY(rho * 0.5));
      ctx.bezierCurveTo(mapX(0.1), mapY(rho * 0.72), mapX(-1), mapY(rho * 0.95), mapX(-Math.sqrt(Math.max(0.1, EYE.rVitreous ** 2 - rho ** 2))), mapY(rho));
      ctx.stroke();
    }
    // Hyaloid canal, the remnant of the artery that fed the lens before birth.
    ctx.fillStyle = 'rgba(208,220,210,0.9)';
    ctx.fillRect(mapX(-2.15), mapY(0.09), (2.15 + 1.13) * PX, 0.09 * PX);

    // Retinal vessels: small cross-sections in the fibre layer.
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * 0.5 + (i + 0.5) * (Math.PI * 0.48) / 26 + (rng() - 0.5) * 0.02;
      const r = EYE.rRetina - 0.075;
      ctx.fillStyle = i % 2 ? '#b31c22' : '#30408c';
      ctx.beginPath();
      ctx.arc(mapX(Math.cos(a) * r), mapY(Math.abs(Math.sin(a)) * r), 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- The front of the eye, in front of the ora ------------------------------------------
    // Forward of the ora there is no retina: the lining is only choroid, then the ciliary body.
    const ciliaryOuter = EYE.rChoroid;
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX(EYE.ora), top, W - mapX(EYE.ora), rowH);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(mapX(0), mapY(0), ciliaryOuter * PX, 0, Math.PI * 2);
    ctx.arc(mapX(0), mapY(0), (EYE.rVitreous - 0.01) * PX, 0, Math.PI * 2, true);
    ctx.fillStyle = '#5a2118';
    ctx.fill('evenodd');
    ctx.restore();

    // The ciliary body: a wedge against the wall from the ora to the root of the iris, ridged with
    // its processes along the inside.
    const rimAt = (z) => Math.sqrt(Math.max(0, ciliaryOuter ** 2 - z * z));
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) { const z = mix(EYE.ora, 2.03, i / steps); pts.push([z, rimAt(z) + 0.01]); }
    const inner = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const z = mix(2.03, EYE.ora, t);
      const base = mix(1.12, rimAt(EYE.ora) - 0.03, t * t);
      const ridge = t < 0.6 ? Math.abs(Math.sin(t * Math.PI * 8)) * 0.06 : 0;
      inner.push([z, base - ridge * 0 + ridge]);
    }
    ctx.beginPath();
    [...pts, ...inner].forEach(([z, r], i) => { if (i === 0) ctx.moveTo(mapX(z), mapY(r)); else ctx.lineTo(mapX(z), mapY(r)); });
    ctx.closePath();
    ctx.fillStyle = '#7f2c20';
    ctx.fill();
    ctx.strokeStyle = '#4a1610';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Aqueous: the clear fluid in front of the lens and round the iris, shown pale blue.
    ctx.save();
    ctx.beginPath();
    ctx.rect(mapX(1.93), top, W, rowH);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(mapX(EYE.corneaZ), mapY(0), EYE.corneaIn * PX, 0, Math.PI * 2);
    ctx.fillStyle = '#bfe5ef';
    ctx.fill();
    ctx.restore();
    // The same fluid fills the little chamber behind the iris, in front of the zonules.
    ctx.beginPath();
    ctx.moveTo(mapX(1.94), mapY(0.5));
    ctx.lineTo(mapX(1.94), mapY(1.3));
    ctx.lineTo(mapX(1.74), mapY(1.24));
    ctx.lineTo(mapX(1.72), mapY(0.97));
    ctx.closePath();
    ctx.fillStyle = '#c9e7ec';
    ctx.fill();

    // Cornea in section: a clear band, thinner at the centre, with its bright front skin.
    ctx.beginPath();
    ctx.arc(mapX(EYE.corneaZ), mapY(0), EYE.corneaR * PX, 0, Math.PI * 2);
    ctx.arc(mapX(EYE.corneaZ), mapY(0), EYE.corneaIn * PX, 0, Math.PI * 2, true);
    ctx.save();
    ctx.clip('evenodd');
    ctx.fillStyle = '#9fd0e0';
    ctx.fillRect(mapX(1.9), top, W, rowH);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(mapX(EYE.corneaZ), mapY(0), (EYE.corneaR - 0.012) * PX, -Math.PI * 0.32, Math.PI * 0.32);
    ctx.strokeStyle = '#5fa8c4';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Zonules: the fine fibres slinging the lens from the ciliary body.
    ctx.strokeStyle = 'rgba(176,134,70,0.8)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 15; i++) {
      const t = i / 14;
      ctx.beginPath();
      ctx.moveTo(mapX(mix(1.42, 1.78, t)), mapY(EYE.lensR * (1 - Math.abs(t - 0.5) * 0.08)));
      ctx.lineTo(mapX(mix(1.08, 1.92, t)), mapY(mix(1.48, 1.28, t)));
      ctx.stroke();
    }

    // Iris: a dark pigmented band, thick at the collarette, with its colour on the front skin only.
    const irisTop = [[2.0, EYE.pupil], [2.03, 0.62], [2.05, 0.82], [2.07, 1.05], [2.08, EYE.irisRoot]];
    const irisBottom = [[1.97, EYE.irisRoot], [1.94, 1.05], [1.91, 0.75], [1.93, 0.58], [1.965, EYE.pupil]];
    ctx.beginPath();
    [...irisTop, ...irisBottom].forEach(([z, r], i) => { if (i === 0) ctx.moveTo(mapX(z), mapY(r)); else ctx.lineTo(mapX(z), mapY(r)); });
    ctx.closePath();
    ctx.fillStyle = '#281612';
    ctx.fill();
    ctx.beginPath();
    irisTop.forEach(([z, r], i) => { if (i === 0) ctx.moveTo(mapX(z), mapY(r)); else ctx.lineTo(mapX(z), mapY(r)); });
    ctx.strokeStyle = '#2f8aa6';
    ctx.lineWidth = 4;
    ctx.stroke();

    // The face of the cornea-sclera junction, the limbus.
    ctx.beginPath();
    ctx.moveTo(mapX(EYE.limbusZ), mapY(EYE.limbusR));
    ctx.lineTo(mapX(EYE.limbusZ - 0.1), mapY(EYE.limbusR + 0.12));
    ctx.strokeStyle = '#a8bcc2';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // The fovea, a dimple in the retina where the axis meets the back wall, in macular yellow.
    ctx.beginPath();
    ctx.ellipse(mapX(-EYE.rRetina + 0.02), mapY(0), 0.075 * PX, 0.2 * PX, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#f7d44a';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(mapX(-EYE.rVitreous - 0.012), mapY(0), 0.05 * PX, 0.075 * PX, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d7e4dd';
    ctx.fill();

    // The optic disc, the blind spot: no retina at all, just the fibres gathering into the nerve.
    if (withDisc) {
      const a = EYE.discPolar;
      const ax = -Math.cos(a); const ar = Math.sin(a);
      const cx = -ar; const cr = -ax; // across the nerve, in (z, rho)
      const local = (s, t) => [ax * s + cx * t, ar * s + cr * t];
      const poly = (list, style) => {
        ctx.beginPath();
        list.forEach(([s, t], i) => { const [z, r] = local(s, t); if (i === 0) ctx.moveTo(mapX(z), mapY(r)); else ctx.lineTo(mapX(z), mapY(r)); });
        ctx.closePath();
        ctx.fillStyle = style;
        ctx.fill();
      };
      // The dural sheath melts into the sclera, and the nerve passes through a gap in every layer.
      poly([[2.3, -0.45], [2.6, -0.42], [2.6, 0.42], [2.3, 0.45]], '#d8d2c4');
      poly([[2.08, -0.42], [2.2, -0.31], [2.62, -0.31], [2.62, 0.31], [2.2, 0.31], [2.08, 0.42]], '#f3e4a2');
      // The disc stands a hair into the eye, cupped at its centre.
      poly([[2.03, -0.44], [2.1, -0.46], [2.1, 0.46], [2.03, 0.44], [2.0, 0.28], [2.03, 0.09], [2.08, 0], [2.03, -0.09], [2.0, -0.28]], '#f6efc9');
      // Fibres fan from the retina on both sides into the nerve.
      ctx.strokeStyle = '#e4cd88';
      ctx.lineWidth = 1.4;
      for (let i = -5; i <= 5; i++) {
        if (i === 0) continue;
        const [z0, r0] = local(2.03, i * 0.082);
        const [z1, r1] = local(2.6, i * 0.052);
        ctx.beginPath();
        ctx.moveTo(mapX(z0), mapY(r0));
        ctx.lineTo(mapX(z1), mapY(r1));
        ctx.stroke();
      }
      // The central retinal artery and vein run in the middle of the nerve.
      const [zA, rA] = local(2.02, -0.04); const [zB, rB] = local(2.62, -0.04);
      const [zC, rC] = local(2.02, 0.05); const [zD, rD] = local(2.62, 0.05);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#c0242a';
      ctx.beginPath(); ctx.moveTo(mapX(zA), mapY(rA)); ctx.lineTo(mapX(zB), mapY(rB)); ctx.stroke();
      ctx.strokeStyle = '#2d4ea8';
      ctx.beginPath(); ctx.moveTo(mapX(zC), mapY(rC)); ctx.lineTo(mapX(zD), mapY(rD)); ctx.stroke();
    }
    ctx.restore();
  };
  return canvasTexture(W, rowH * 2, (ctx) => {
    paintRow(ctx, 0, true);
    paintRow(ctx, rowH, false);
  });
}

// The surface atlas: the sclera in a band across the top two thirds, unrolled by (azimuth, polar), and
// the iris seen face on in a square below it. Painted once, on one canvas, so it costs one mesh.
function eyeSurfacePainting() {
  const S = 1024;
  const rng = seededRandom(7719);
  return canvasTexture(S, S, (ctx) => {
    // --- Sclera, the top half of the sheet --------------------------------------------------
    const H = S / 2;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d9dfe0'); // the blue-white at the limbus
    g.addColorStop(0.1, '#efece2');
    g.addColorStop(0.7, '#ece4d1');
    g.addColorStop(1, '#e4d3b2'); // yellower toward the back, where it meets the fat of the orbit
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, H);
    // Faint blood vessels: each a wandering walk from the limbus or the back, forking as it goes.
    const vessel = (x0, y0, dirY, width, depth, hue) => {
      let x = x0; let y = y0; let a = (rng() - 0.5) * 0.7;
      const steps = 14 + Math.floor(rng() * 14);
      ctx.strokeStyle = hue;
      ctx.lineCap = 'round';
      for (let i = 0; i < steps; i++) {
        const nx = x + Math.sin(a) * 9; const ny = y + Math.cos(a) * 9 * dirY;
        ctx.lineWidth = width * (1 - (i / steps) * 0.7);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        for (const ox of nx < 40 ? [S] : nx > S - 40 ? [-S] : []) { ctx.beginPath(); ctx.moveTo(x + ox, y); ctx.lineTo(nx + ox, ny); ctx.stroke(); }
        x = nx; y = ny; a += (rng() - 0.5) * 0.55;
        if (depth > 0 && rng() < 0.13) vessel(x, y, dirY, width * 0.72, depth - 1, hue);
      }
    };
    for (let i = 0; i < 22; i++) vessel(rng() * S, 4 + rng() * 14, 1, 0.9 + rng() * 0.8, 1, rng() > 0.35 ? 'rgba(186,70,60,0.28)' : 'rgba(150,66,92,0.22)');
    for (let i = 0; i < 12; i++) vessel(rng() * S, H - 6 - rng() * 40, -1, 0.9 + rng() * 0.7, 1, 'rgba(176,84,70,0.18)');

    // --- Iris, a square at the bottom left --------------------------------------------------
    const cx = H / 2; const cy = H + H / 2; const R = H / 2 - 4;
    const scale = R / EYE.irisRoot;
    const ring = ctx.createRadialGradient(cx, cy, EYE.pupil * scale, cx, cy, R);
    ring.addColorStop(0, '#b77d2a'); // gold round the pupil
    ring.addColorStop(0.18, '#a8892f');
    ring.addColorStop(0.3, '#3e8ca0');
    ring.addColorStop(0.74, '#2d7fa6');
    ring.addColorStop(0.9, '#1f5470');
    ring.addColorStop(0.96, '#112a3a');
    ring.addColorStop(1, '#0d1f2c');
    ctx.fillStyle = ring;
    ctx.fillRect(0, H, H, H);
    // Radial fibres, thousands of them, light and dark, each a slightly wavering spoke.
    ctx.lineCap = 'round';
    for (let i = 0; i < 1500; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = (EYE.pupil + rng() * 0.3) * scale;
      const r1 = r0 + (0.18 + rng() * 0.75) * scale;
      const wob = (rng() - 0.5) * 0.03;
      const light = rng();
      ctx.strokeStyle = light > 0.55 ? `rgba(${170 + rng() * 60},${205 + rng() * 40},${215 + rng() * 30},${0.1 + rng() * 0.22})`
        : light > 0.25 ? `rgba(10,44,70,${0.14 + rng() * 0.28})` : `rgba(232,180,70,${0.06 + rng() * 0.16})`;
      ctx.lineWidth = 0.7 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a + wob) * Math.min(r1, R), cy + Math.sin(a + wob) * Math.min(r1, R));
      ctx.stroke();
    }
    // The collarette, a jagged ruff about a third of the way out.
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const r = (0.72 + (i % 2 ? 0.05 : -0.03) + (rng() - 0.5) * 0.02) * scale;
      if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(232,196,104,0.62)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Crypts, the dark gaps in the weave.
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2; const r = (0.82 + rng() * 0.36) * scale;
      ctx.fillStyle = `rgba(6,30,48,${0.25 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 6 + rng() * 9, 2 + rng() * 2.4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // The pupil. A hole in the iris, which looks black because no light comes back out of it.
    ctx.beginPath();
    ctx.arc(cx, cy, EYE.pupil * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#050505';
    ctx.fill();
    ctx.strokeStyle = '#3a2412';
    ctx.lineWidth = 3;
    ctx.stroke();

    // The rest of the bottom half: the nerve-sheath and muscle are vertex coloured, so it stays plain.
    ctx.fillStyle = '#e4d3b2';
    ctx.fillRect(H, H, H, H);
  });
}

function humanEye() {
  const { R, phiA, phiB } = EYE;
  const phiSpan = Math.PI * 2 - (phiB - phiA);
  const phiAt = (t) => phiB + phiSpan * t;
  const CY = 3.72;
  const place = new THREE.Matrix4().compose(
    new THREE.Vector3(0, CY, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.14, -0.58, 0, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );

  // --- The painted surface: sclera and iris ---------------------------------------------------
  const polarStart = Math.asin(EYE.limbusR / R);
  const scleraG = outward(sheet(88, 132, (ti, tj) => {
    const th = mix(polarStart, Math.PI, ti);
    const ph = phiAt(tj);
    const r = R * Math.sin(th);
    return [r * Math.cos(ph), r * Math.sin(ph), R * Math.cos(th)];
  }, (ti, tj) => [phiAt(tj) / (Math.PI * 2), 1 - ti * 0.5]));
  const irisZ = (r) => {
    // A shallow cone with the root forward of the pupil's plane and the collarette standing proud.
    const t = clamp01((r - EYE.pupil) / (EYE.irisRoot - EYE.pupil));
    return mix(2.0, 2.08, t) + Math.exp(-(((r - 0.72) / 0.09) ** 2)) * 0.012;
  };
  const irisG = sheet(26, 110, (ti, tj) => {
    const r = ti * EYE.irisRoot;
    const ph = phiAt(tj);
    return [r * Math.cos(ph), r * Math.sin(ph), r < EYE.pupil ? 2.0 : irisZ(r)];
  }, (ti, tj) => {
    const r = ti;
    const ph = phiAt(tj);
    const half = (256 - 4) / 1024;
    return [0.25 + Math.cos(ph) * r * half, 0.25 + Math.sin(ph) * r * half];
  });
  if (irisG.attributes.normal.getZ(irisG.attributes.position.count - 1) < 0) {
    const f = flipped(irisG);
    irisG.setIndex(f.index);
    irisG.setAttribute('normal', f.attributes.normal);
  }

  const surfaceG = mergeParts([{ geometry: scleraG, color: 0xffffff }, { geometry: irisG, color: 0xffffff }]);
  surfaceG.applyMatrix4(place);
  const surfaceMap = eyeSurfacePainting();

  // --- The two cut faces ----------------------------------------------------------------------
  const inBall = (z, rho) => Math.min(Math.hypot(z, rho) - R, Math.hypot(z - EYE.corneaZ, rho) - EYE.corneaR);
  const PX = 1 / 5.5;
  const faceUv = (row) => (z, rho) => [(z + 2.62) * PX, row === 0 ? 1 - (504 - rho * 186.18) / 1024 : 1 - (1016 - rho * 186.18) / 1024];
  const dirA = [Math.cos(phiA), Math.sin(phiA), 0];
  const dirB = [Math.cos(phiB), Math.sin(phiB), 0];
  // (a, b) = (z, rho) on the floor and (rho, z) on the wall, which is what keeps both outward.
  const floorLoops = contour((z, rho) => Math.max(inBall(z, rho), -0.015 - rho), [-2.7, -0.1, 2.95, 2.7], 0.016);
  const wallLoops = contour((rho, z) => Math.max(inBall(z, rho), -0.015 - rho), [-0.1, -2.7, 2.7, 2.95], 0.016);
  const floorFace = plate(floorLoops, (z, rho) => [dirA[0] * rho, dirA[1] * rho, z], faceUv(0), [-Math.sin(phiA), Math.cos(phiA), 0]);
  const wallFace = plate(wallLoops, (rho, z) => [dirB[0] * rho, dirB[1] * rho, z], (rho, z) => faceUv(1)(z, rho), [Math.sin(phiB), -Math.cos(phiB), 0]);
  const faceG = mergeParts([{ geometry: floorFace, color: 0xffffff }, { geometry: wallFace, color: 0xffffff }]);
  faceG.applyMatrix4(place);

  // --- The cornea ------------------------------------------------------------------------------
  const corneaG = outward(sheet(26, 96, (ti, tj) => {
    const th = ti * Math.asin((EYE.limbusR + 0.02) / EYE.corneaR);
    const ph = phiAt(tj);
    const r = EYE.corneaR * Math.sin(th);
    return [r * Math.cos(ph), r * Math.sin(ph), EYE.corneaZ + EYE.corneaR * Math.cos(th)];
  }));
  corneaG.applyMatrix4(place);

  // --- The muscles, the nerve, and everything else with vertex colour -------------------------
  const parts = [];
  // A muscle strap lies on the globe from its tendon back past the equator, then leaves it for the
  // back of the orbit, cut off where it would run out of the model.
  const onBall = (polarDeg, phiDeg, lift = 0.004) => {
    const th = THREE.MathUtils.degToRad(polarDeg); const ph = THREE.MathUtils.degToRad(phiDeg);
    const r = R + lift;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  const MUSCLE = lin(0xb4382f);
  const MUSCLE_DARK = lin(0x8a2620);
  const TENDON = lin(0xece4d2);
  // A strap cannot be a flat tube: a flat band 1.3ft wide on a 2.5ft ball stands clear of it at both
  // edges, which is a visible plate with a shadow under it. So every ring of the sweep is bent to the
  // ball's own curvature while it lies on the ball, its edges come to nothing exactly on the surface,
  // and the bend relaxes as the muscle leaves for the back of the orbit.
  const strap = (points, width, thick, { taper = 0.66, tendon = 0.14 } = {}) => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
    const ROWS = 54; const SIDES = 16;
    const C = curve.getSpacedPoints(ROWS);
    const positions = []; const colors = []; const index = [];
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      const T = C[Math.min(ROWS, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize();
      const radial = C[i].clone().normalize();
      const across = new THREE.Vector3().crossVectors(radial, T).normalize();
      const up = new THREE.Vector3().crossVectors(T, across).normalize();
      const onBallness = 1 - sstep(C[i].length(), R + 0.03, R + 0.4);
      const end = Math.min(1, Math.sqrt(Math.min(t, 1 - t) / 0.025));
      const w = width * mix(1, taper, sstep(t, tendon, 1)) * (t < tendon ? mix(0.84, 1, t / tendon) : 1) * end;
      const h = thick * mix(0.34, 1, sstep(t, tendon * 0.5, tendon * 1.4)) * end;
      const c = sstep(t, tendon * 0.7, tendon * 1.3);
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const u = Math.cos(a) * w; const v = Math.sin(a);
        const sag = (onBallness * u * u) / (2 * R);
        const p = C[i].clone().addScaledVector(across, u).addScaledVector(up, v * h - sag);
        positions.push(p.x, p.y, p.z);
        const fibre = j % 2 === 0 ? 0 : 0.42;
        colors.push(
          mix(TENDON[0], mix(MUSCLE[0], MUSCLE_DARK[0], fibre), c),
          mix(TENDON[1], mix(MUSCLE[1], MUSCLE_DARK[1], fibre), c),
          mix(TENDON[2], mix(MUSCLE[2], MUSCLE_DARK[2], fibre), c),
        );
      }
    }
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < SIDES; j++) {
        const j2 = (j + 1) % SIDES;
        const a = i * SIDES + j; const b = i * SIDES + j2; const c = (i + 1) * SIDES + j2; const d = (i + 1) * SIDES + j;
        index.push(a, b, c, a, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    parts.push({ geometry: outward(g), keepColor: true });
  };
  const APEX = [0.3, 0, -4.9];
  const rectus = (phi) => {
    const ph = THREE.MathUtils.degToRad(phi);
    const path = [58, 72, 88, 104, 120].map((p) => onBall(p, phi));
    // It leaves the ball tangentially, heading for the apex, and stops short of it as a clean cut.
    const leave = (t) => [mix(path[4][0], APEX[0], t) + Math.cos(ph) * 0.06, mix(path[4][1], APEX[1], t) + Math.sin(ph) * 0.06, mix(path[4][2], APEX[2], t)];
    strap([...path, leave(0.38), leave(0.68)], 0.6, 0.13, { taper: 0.42 });
  };
  rectus(107); // superior
  rectus(180); // lateral
  rectus(268); // inferior
  // The superior oblique's tendon runs out from under the superior rectus to its insertion on the
  // back of the eye. It is all tendon on this stretch, so it stays pale, and it ends hidden under the
  // rectus, since its belly and pulley would lie in the wedge.
  strap([onBall(124, 152), onBall(108, 136), onBall(92, 120), onBall(80, 108)], 0.2, 0.05, { taper: 0.9, tendon: 2 });
  // The inferior oblique crosses under the eye from the nasal side to the back of the outer side.
  strap([onBall(128, 200), onBall(114, 232), onBall(100, 268), onBall(86, 296), onBall(72, 316)], 0.38, 0.1, { taper: 0.8, tendon: 0.08 });

  // --- The optic nerve: half a nerve, cut by the same plane as the floor -----------------------
  const nA = new THREE.Vector3(-Math.sin(phiA), Math.cos(phiA), 0); // toward the wedge
  const eA = new THREE.Vector3(dirA[0], dirA[1], 0);
  const az = new THREE.Vector3(0, 0, 1);
  const nerveDir = eA.clone().multiplyScalar(Math.sin(EYE.discPolar)).addScaledVector(az, -Math.cos(EYE.discPolar)).normalize();
  const across = new THREE.Vector3().crossVectors(nA, nerveDir).normalize();
  const nerveStart = 2.25; const nerveEnd = 4.4; const nerveR = (s) => 0.4 + 0.1 * (1 - sstep(s, 2.4, 2.9));
  const SHEATH = lin(0xe6dcc6);
  const NERVE = lin(0xf1dd90);
  const half = sheet(36, 24, (ti, tj) => {
    const s = mix(nerveStart, nerveEnd, ti);
    const a = tj * Math.PI;
    const r = nerveR(s);
    const p = nerveDir.clone().multiplyScalar(s).addScaledVector(across, Math.cos(a) * r).addScaledVector(nA, -Math.sin(a) * r);
    return [p.x, p.y, p.z];
  });
  // Faces outward from the nerve's own axis.
  {
    const P = half.attributes.position; const N = half.attributes.normal;
    const mid = half.attributes.position.count - 13;
    const v = new THREE.Vector3(P.getX(mid), P.getY(mid), P.getZ(mid));
    const n = new THREE.Vector3(N.getX(mid), N.getY(mid), N.getZ(mid));
    const axisPoint = nerveDir.clone().multiplyScalar(nerveEnd);
    if (n.dot(v.sub(axisPoint)) < 0) {
      const f = flipped(half);
      half.setIndex(f.index);
      half.setAttribute('normal', f.attributes.normal);
    }
  }
  parts.push({ geometry: half, color: 0xe6dcc6 });
  // The cut face of the nerve, and its sawn end, as bands with mesh edges along each boundary.
  const stripe = (s0, s1, t0, t1, color) => {
    const p = (s, t) => nerveDir.clone().multiplyScalar(s).addScaledVector(across, t).addScaledVector(nA, 0.004);
    const a = p(s0, t0); const b = p(s1, t0); const c = p(s1, t1); const d = p(s0, t1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([nA.x, nA.y, nA.z, nA.x, nA.y, nA.z, nA.x, nA.y, nA.z, nA.x, nA.y, nA.z], 3));
    // Wound by measurement.
    const cross = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    g.setIndex(cross.dot(nA) > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    parts.push({ geometry: g, color });
  };
  const sEntry = 2.46;
  stripe(sEntry, nerveEnd, -0.5, -0.4, 0xd8d2c4);
  stripe(sEntry, nerveEnd, 0.4, 0.5, 0xd8d2c4);
  stripe(sEntry, nerveEnd, -0.4, -0.31, 0xe6dcc6);
  stripe(sEntry, nerveEnd, 0.31, 0.4, 0xe6dcc6);
  for (let k = 0; k < 6; k++) {
    const t0 = mix(-0.31, 0.31, k / 6); const t1 = mix(-0.31, 0.31, (k + 1) / 6);
    stripe(sEntry, nerveEnd, t0, t1, k % 2 ? 0xf3e4a2 : 0xeed88a);
  }
  stripe(sEntry, nerveEnd, -0.04 - 0.014, -0.04 + 0.014, 0xc0242a);
  stripe(sEntry, nerveEnd, 0.05 - 0.014, 0.05 + 0.014, 0x2d4ea8);
  // The nerve's sawn end, a half disc with a dark rim of sheath.
  {
    const r = nerveR(nerveEnd);
    const g = sheet(4, 24, (ti, tj) => {
      const a = tj * Math.PI;
      const rr = ti * r;
      const p = nerveDir.clone().multiplyScalar(nerveEnd).addScaledVector(across, Math.cos(a) * rr).addScaledVector(nA, -Math.sin(a) * rr);
      return [p.x, p.y, p.z];
    });
    const f = g.attributes.normal.getX(30) * nerveDir.x + g.attributes.normal.getY(30) * nerveDir.y + g.attributes.normal.getZ(30) * nerveDir.z < 0 ? flipped(g) : g;
    tintVertices(f, (x, y, z, out) => {
      const v = new THREE.Vector3(x, y, z);
      const off = v.addScaledVector(nerveDir, -nerveEnd).length();
      const c = off > 0.32 ? SHEATH : NERVE;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    parts.push({ geometry: f, keepColor: true });
  }

  const organic = mergeParts(parts);
  organic.applyMatrix4(place);

  // --- The lens: whole, because it is an object rather than a layer ---------------------------
  // Bottom up along z: two half ellipses meeting at a rounded equator, the back one the deeper, as the
  // real lens is. Nothing on it is sharp, which is what stops it reading as a lemon.
  const lensProfile = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    const r = EYE.lensR * Math.sin(a) ** 0.86;
    const z = Math.cos(a) > 0
      ? EYE.lensEq - (EYE.lensEq - EYE.lensBack) * Math.cos(a)
      : EYE.lensEq - (EYE.lensFront - EYE.lensEq) * Math.cos(a);
    lensProfile.push([i === 0 || i === 24 ? 0 : r, z]);
  }
  const lensG = lathe(lensProfile, 56);
  lensG.rotateX(Math.PI / 2);
  tintVertices(lensG, (x, y, z, out) => {
    const d = Math.hypot(x, y) / EYE.lensR;
    const c = sstep(d, 0.1, 0.98);
    out[0] = mix(0.54, 0.7, c); out[1] = mix(0.24, 0.42, c); out[2] = mix(0.03, 0.1, c);
  });
  lensG.applyMatrix4(place);

  // --- The stand ------------------------------------------------------------------------------
  const standParts = [];
  standBase(standParts, 2.1, { top: 0.42, collarR: 0.32 });
  const hoopR = R + 0.26;
  // A brass hoop cradles the globe from underneath, in the plane of its equator, clear of the muscle
  // straps, and two felted pads carry the weight through to the sclera.
  const hoopPts = [];
  for (let i = 0; i <= 28; i++) {
    const a = mix(-Math.PI * 0.5 - 1.0, -Math.PI * 0.5 + 1.0, i / 28);
    hoopPts.push([Math.cos(a) * hoopR, CY + Math.sin(a) * hoopR, -0.1]);
  }
  standParts.push({ geometry: tube(hoopPts, 0.085, { sides: 12, steps: 56, round: 3 }), color: 0xc29a4e });
  for (const a of [-Math.PI * 0.5 - 0.98, -Math.PI * 0.5 + 0.98]) {
    const inner = R + 0.0;
    standParts.push({
      geometry: tube(
        [[Math.cos(a) * hoopR, CY + Math.sin(a) * hoopR, -0.1], [Math.cos(a) * inner, CY + Math.sin(a) * inner, -0.1]],
        [0.14, 0.2], { sides: 16, steps: 3, round: 3, straight: true },
      ),
      color: 0x7a2a26,
    });
  }
  standParts.push({
    geometry: lathe([[0, 0.3], [0.34, 0.3], [0.3, 0.46], [0.19, 0.56], [0.15, 0.8], [0.18, CY - hoopR - 0.12], [0.26, CY - hoopR - 0.03], [0.2, CY - hoopR + 0.08], [0, CY - hoopR + 0.1]], 28),
    position: [0, 0, -0.1],
    color: 0xc29a4e,
  });

  // --- Assembly -------------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'human-eye';
  root.add(mesh(surfaceG, standard({ map: surfaceMap, roughness: 0.3, metalness: 0 })));
  root.add(mesh(faceG, standard({ map: eyeSectionPainting(), roughness: 0.62, metalness: 0 })));
  const cornea = mesh(corneaG, standard({ color: 0xdff2f6, transparent: true, opacity: 0.2, roughness: 0.06, metalness: 0, depthWrite: false }));
  cornea.castShadow = false;
  root.add(cornea);
  root.add(organMesh([{ geometry: organic, keepColor: true }], { roughness: 0.62, metalness: 0 }));
  root.add(organMesh([{ geometry: lensG, keepColor: true }, ...standParts], { roughness: 0.3, metalness: 0.08 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Shared: a sawn block, open at its front, and a neat plinth under it
// ---------------------------------------------------------------------------------------------

const rrectD = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r; const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function subdivided(outline, step) {
  const out = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]; const b = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([mix(a[0], b[0], k / n), mix(a[1], b[1], k / n)]);
  }
  return out;
}

// Sides and back of a block with rounded edges. The front is left open for a plate: the block is only
// ever a sleeve, since a cap there would plug every hollow in the cut face.
function openBlock(x0, x1, y0, y1, z0, z1, r, tint) {
  const hw = (x1 - x0) / 2; const hh = (y1 - y0) / 2;
  const g = extrudeOutline(subdivided(roundedOutline(hw, hh, r, 4), 0.09), z1 - z0, { capStart: true, capEnd: false });
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  tintVertices(g, tint);
  return g;
}

function plinth(parts, x0, x1, z0, z1, h = 0.32, { color = 0x5b3a24, trim = 0xb08d4e } = {}) {
  const hw = (x1 - x0) / 2; const hd = (z1 - z0) / 2;
  const slab = (w, d, r, y0, y1, c) => {
    const g = extrudeOutline(roundedOutline(w, d, r, 5), y1 - y0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.push({ geometry: g, color: c });
  };
  slab(hw, hd, 0.2, 0, h * 0.62, color);
  slab(hw - 0.04, hd - 0.04, 0.18, h * 0.62, h * 0.72, trim);
  slab(hw - 0.1, hd - 0.1, 0.14, h * 0.72, h, color);
}

// ---------------------------------------------------------------------------------------------
// Human ear
// ---------------------------------------------------------------------------------------------

// A cut through the side of the head, from the front, the way every textbook draws it: the owner
// faces +Z, so this is their right ear and the outside world is at -X. The pinna is the one thing
// that does not lie in the cut. It is swung forward on its root until its face looks at the student,
// because seen truly edge-on from the front an ear is a flap with none of its folds showing.
//
// IT IS NOT TO ONE SCALE, and says so here because a real ear would make the inner parts invisible.
// The ossicles and the labyrinth are about twice the size the pinna would give them. Those are the
// things the model exists to show, and at true proportion a stirrup would be two inches across.
//
// The labyrinth is one sculpted surface, which is what it is in life: a single bony cavity whose parts
// are continuous. The three canals' planes come from one orthonormal set, so they are at right angles
// by construction, and each plane is turned about 55 degrees from the student so that all three read
// as open loops at once. A real labyrinth is not posed like that in the head.
function humanEar() {
  const ZF = 0.75; const Z0 = -1.3; const X0 = -1.6; const X1 = 3.0; const Y0 = 0.32; const Y1 = 5.35;
  const rng = seededRandom(5521);

  // --- The voids, first ------------------------------------------------------------------------
  const CANAL = [[-2.1, 3.04], [-1.6, 3.04], [-1.1, 3.12], [-0.6, 3.0], [-0.08, 2.92]];
  const canalPts = CANAL.map(([x, y]) => [x, y, ZF]);
  const voids = new Sculpt(0.07);
  voids.add(curveP(canalPts, [0.36, 0.34, 0.32, 0.3, 0.3], 24), 0xe59a8a);
  voids.add(ellipsoidP([0.5, 3.0, ZF], [0.66, 1.15, 0.6]), 0xa83f3f, { ck: 0.04 });
  voids.add(curveP([[0.48, 2.05, ZF], [0.58, 1.5, ZF], [0.74, 0.95, ZF], [0.92, 0.1, ZF]], [0.17, 0.15, 0.14, 0.14], 16), 0xd97f7c, { k: 0.08, ck: 0.04 });
  const PLUM = 0x8c5a70;
  const labyrinthHollow = [
    [ellipsoidP([2.0, 1.8, ZF], [1.0, 1.0, 0.62]), 0],
    [ellipsoidP([1.72, 3.0, ZF], [0.64, 0.74, 0.55]), 0.2],
    [ellipsoidP([2.02, 3.86, ZF], [0.92, 0.92, 0.66]), 0.25],
    [curveP([[2.3, 2.72, ZF], [2.7, 2.78, ZF], [3.3, 2.84, ZF]], [0.25, 0.23, 0.23], 10), 0.12],
  ];
  for (const [prim, k] of labyrinthHollow) voids.add(prim, PLUM, { k, ck: 0.04 });
  // Stopped at the block's own sides, so a wall of the hollow cannot stand outside it.
  voids.sub({ box: [X1 - 0.01, -2, -3, 8, 8, 3], f: (x) => X1 - 0.01 - x });
  voids.sub({ box: [-4, -2, -3, 8, Y0 + 0.02, 3], f: (x, y) => y - Y0 - 0.02 });
  const voidSlice = sliceOf(voids.ops, ZF);
  const hollow = hollowAt(voids, ZF, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const n = 0.86 + smoothNoise3(x * 3, y * 3, z * 3) * 0.28;
      const depth = sstep(ZF - z, 0, 0.6);
      const k = n * mix(1, 0.72, depth);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });

  // The canal's half pipe runs on past the block into the pinna so its contour is open at the edge, but
  // no wall of it may stand outside the block, where it would hang in the bowl of the ear as a ribbon.
  {
    const p = hollow.attributes.position;
    const list = [];
    const idx = hollow.index;
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
      if (Math.max(p.getX(a), p.getX(b), p.getX(c)) < X0) continue;
      list.push(a, b, c);
    }
    hollow.setIndex(list);
  }

  // --- The cut face ----------------------------------------------------------------------------
  const cx = (X0 + X1) / 2; const cy = (Y0 + Y1) / 2; const hw = (X1 - X0) / 2; const hh = (Y1 - Y0) / 2;
  const plateField = (x, y) => Math.max(rrectD(x, y, cx, cy, hw, hh, 0.07), -voidSlice(x, y));
  const plateLoops = contour(plateField, [X0 - 0.05, Y0 - 0.05, X1 + 0.05, Y1 + 0.05], 0.018);
  const voidLoops = contour((x, y) => voidSlice(x, y), [X0 - 1.5, Y0 - 0.5, X1 + 0.5, Y1 + 0.5], 0.03);
  const plateG = plate(plateLoops, (x, y) => [x, y, ZF], (x, y) => [(x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0)], [0, 0, 1]);

  // Where one tissue gives way to the next, on the face and round the block's sides alike.
  const SKIN = '#e8ad8e'; const SKIN3 = lin(0xe8ad8e);
  const TISSUE = '#f4cfb0'; const TISSUE3 = lin(0xf4cfb0);
  const BONE = '#ecdcb6'; const BONE3 = lin(0xecdcb6);
  const tissueEdge = (y) => -0.62 + Math.sin(y * 2.3) * 0.12 + Math.sin(y * 5.1) * 0.04;
  const W = 920; const H = Math.round(W * ((Y1 - Y0) / (X1 - X0)));
  const faceMap = canvasTexture(W, H, (ctx) => {
    const PX = W / (X1 - X0);
    const map = (x, y) => [(x - X0) * PX, H - (y - Y0) * PX];
    ctx.fillStyle = BONE;
    ctx.fillRect(0, 0, W, H);
    // Bone: a dense stipple, and blotches at a coarser scale so it is not a flat cream.
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${rng() > 0.5 ? '205,180,128' : '250,240,214'},0.22)`;
      ctx.beginPath();
      ctx.ellipse(rng() * W, rng() * H, 18 + rng() * 40, 12 + rng() * 26, rng() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(170,140,90,0.34)' : 'rgba(255,250,232,0.4)';
      ctx.beginPath();
      ctx.arc(rng() * W, rng() * H, 0.7 + rng() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Mastoid air cells: a honeycomb of little hollows in the bone above and behind the canal.
    for (let i = 0; i < 120; i++) {
      const x = mix(-0.75, 1.1, rng()); const y = mix(4.22, 5.2, rng());
      const r = 0.04 + rng() * 0.08;
      const [px, py] = map(x, y);
      ctx.fillStyle = '#b9925f';
      ctx.beginPath(); ctx.ellipse(px, py, r * PX, r * PX * (0.7 + rng() * 0.3), rng() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7c5a3c';
      ctx.beginPath(); ctx.ellipse(px + 1, py + 1, r * PX * 0.72, r * PX * 0.54, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // The hard capsule of bone round the inner ear, the densest in the body, a paler smooth ring.
    const capsule = contour((x, y) => voidSlice(x, y) - 0.14, [X0 - 0.5, Y0 - 0.5, X1 + 0.5, Y1 + 0.5], 0.03)
      .filter((l) => l.some(([x]) => x > 1.3));
    fillLoops(ctx, capsule, map, '#f7efd8');
    // Soft tissue fills the outer part of the head, with fibres running through it.
    ctx.beginPath();
    let [mx, my] = map(tissueEdge(Y0), Y0);
    ctx.moveTo(0, H); ctx.lineTo(mx, my);
    for (let y = Y0; y <= Y1; y += 0.08) { [mx, my] = map(tissueEdge(y), y); ctx.lineTo(mx, my); }
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = TISSUE;
    ctx.fill();
    ctx.strokeStyle = 'rgba(212,150,120,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const y = mix(Y0, Y1, rng()); const x = mix(X0, -0.8, rng());
      const [a, b] = map(x, y);
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.quadraticCurveTo(a + 18, b - 8 + rng() * 16, a + 34 + rng() * 22, b + (rng() - 0.5) * 18);
      ctx.stroke();
    }
    // Cartilage rings the outer third of the canal, and bone takes over from it.
    const cartilageLoops = contour((x, y) => {
      const d = polylineDist(canalPts, x, y, ZF) - 0.56;
      return Math.max(d, x - tissueEdge(y) - 0.05);
    }, [X0 - 0.5, 2, 0.3, 4.2], 0.02);
    fillLoops(ctx, cartilageLoops, map, '#cfe0e8');
    ctx.save();
    clipLoops(ctx, cartilageLoops, map);
    for (let i = 0; i < 240; i++) {
      const [a, b] = map(mix(X0, -0.4, rng()), mix(2.3, 3.8, rng()));
      ctx.fillStyle = 'rgba(92,128,152,0.5)';
      ctx.beginPath(); ctx.ellipse(a, b, 2.4, 1.6, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // The skin down the left edge of the block.
    ctx.fillStyle = SKIN;
    ctx.fillRect(0, 0, 0.1 * PX, H);
    // The canal has a skin of its own, a thin bright lining right round the cut.
    traceLoops(ctx, voidLoops.filter((l) => l.some(([x, y]) => x < -0.3 && Math.abs(y - 3) < 0.6)), map, '#c9685e', 6);
    // Every hollow has a dark edge where it breaks the face, which is the shadow that says it is one.
    traceLoops(ctx, voidLoops, map, 'rgba(58,28,28,0.75)', 2.6);
  });

  // --- The block's sides, which carry the same layers round the corner -------------------------
  const blockTint = (x, y, z, out) => {
    const edge = tissueEdge(y);
    const c = x < X0 + 0.11 ? SKIN3 : x < edge ? TISSUE3 : BONE3;
    const n = 0.92 + smoothNoise3(x * 2.4, y * 2.4, z * 2.4) * 0.16;
    out[0] = c[0] * n; out[1] = c[1] * n; out[2] = c[2] * n;
  };
  const blockG = openBlock(X0, X1, Y0, Y1, Z0, ZF, 0.07, blockTint);

  // --- The pinna -------------------------------------------------------------------------------
  const u = new THREE.Vector3(0.83, 0, 0.5578).normalize();
  const v = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().crossVectors(u, v);
  const pinnaAt = new THREE.Matrix4().makeBasis(u, v, n);
  pinnaAt.setPosition(-2.12, 3.1, ZF - 0.02);
  const toWorldX = (x, y, z) => -2.12 + u.x * x + n.x * z;
  const PINNA = 0xe9ad90; const PINNA_DEEP = 0xc9705f;
  const P = new Sculpt(0.055);
  P.add(ellipsoidP([-0.3, 0.2, -0.02], [0.92, 1.33, 0.11]), PINNA);
  P.add(ellipsoidP([-0.16, -0.6, -0.02], [0.62, 0.72, 0.1]), PINNA, { k: 0.2 });
  P.add(ellipsoidP([-0.02, -1.22, -0.01], [0.4, 0.42, 0.15]), 0xeeb49a, { k: 0.2 });
  P.add(ellipsoidP([0.22, -0.12, -0.36], [0.86, 0.95, 0.42]), PINNA, { k: 0.2 });
  const helix = [[0.18, -0.08, 0.13], [0.48, 0.33, 0.12], [0.54, 0.85, 0.1], [0.27, 1.32, 0.08], [-0.3, 1.5, 0.08], [-0.86, 1.26, 0.08], [-1.14, 0.7, 0.08], [-1.15, 0.1, 0.08], [-0.95, -0.5, 0.06], [-0.62, -0.97, 0.04], [-0.3, -1.22, 0.03]];
  P.add(curveP(helix, [0.07, 0.1, 0.125, 0.14, 0.15, 0.15, 0.145, 0.135, 0.11, 0.08, 0.06], 60), 0xeeb296, { k: 0.05 });
  // The scapha: the groove just inside the rim, which is what makes the rim read as rolled.
  P.sub(curveP([[0.16, 1.1, 0.2], [-0.32, 1.23, 0.2], [-0.76, 1.03, 0.2], [-0.93, 0.58, 0.2], [-0.92, 0.0, 0.18], [-0.74, -0.45, 0.16]], 0.13, 34), null, { k: 0.1 });
  // The antihelix is a Y: a stem from the antitragus that forks into two crura near the top.
  P.add(curveP([[-0.32, -0.84, 0.09], [-0.56, -0.28, 0.12], [-0.57, 0.24, 0.13]], [0.09, 0.125, 0.12], 16), PINNA, { k: 0.09 });
  P.add(curveP([[-0.57, 0.24, 0.13], [-0.56, 0.68, 0.1], [-0.3, 1.0, 0.07]], [0.115, 0.09, 0.06], 14), PINNA, { k: 0.08 });
  P.add(curveP([[-0.57, 0.24, 0.13], [-0.18, 0.52, 0.1], [0.24, 0.62, 0.08]], [0.11, 0.085, 0.05], 14), PINNA, { k: 0.08 });
  // The concha, the deep bowl, and the funnel from it into the head.
  const CONCHA = ellipsoidP([0.05, -0.28, 0.34], [0.5, 0.6, 0.44]);
  P.sub(CONCHA, null, { k: 0.1 });
  const FUNNEL = curveP([[0.0, -0.3, 0.2], [0.36, -0.27, -0.12], [1.0, -0.08, -0.56]], [0.4, 0.31, 0.32], 12);
  P.sub(FUNNEL, null, { k: 0.12 });
  // Tragus and antitragus stand either side of the notch at the bottom of the bowl.
  P.add(ellipsoidP([0.6, -0.34, 0.19], [0.19, 0.27, 0.14], [0, 0.25, 0.1]), 0xeeb296, { k: 0.08 });
  P.add(ellipsoidP([-0.2, -0.92, 0.17], [0.18, 0.13, 0.1]), 0xeeb296, { k: 0.07 });
  // Sawn where it enters the block.
  P.sub({ box: [-4, -4, -4, 4, 4, 4], f: (x, y, z) => -1.58 - toWorldX(x, y, z) });
  const pinnaG = polygonize(P, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const bowl = 1 - sstep(Math.min(CONCHA.f(x, y, z), FUNNEL.f(x, y, z)), 0.0, 0.14);
      const deep = lin(PINNA_DEEP);
      rgb[0] = mix(rgb[0], deep[0], bowl); rgb[1] = mix(rgb[1], deep[1], bowl); rgb[2] = mix(rgb[2], deep[2], bowl);
      const m = 0.94 + smoothNoise3(x * 3.4, y * 3.4, z * 3.4) * 0.12;
      rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
    },
  });
  pinnaG.applyMatrix4(pinnaAt);

  // --- The eardrum -----------------------------------------------------------------------------
  const D = [-0.09, 2.94, ZF + 0.02];
  const dn = new THREE.Vector3(0.74, -0.2, 0.64).normalize();
  const upD = new THREE.Vector3(0, 1, 0).addScaledVector(dn, -dn.y).normalize();
  const sideD = new THREE.Vector3().crossVectors(upD, dn);
  const dR = 0.64;
  const drumG = lathe([[0, 0.09], [dR * 0.3, 0.07], [dR * 0.65, 0.035], [dR, -0.012], [dR * 1.01, 0.012], [dR * 0.65, 0.064], [dR * 0.3, 0.1], [0, 0.125]], 64);
  tintVertices(drumG, (x, y, z, out) => {
    const a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 24) * 0.05 + Math.sin(a * 7) * 0.03;
    const c = lin(0xe4cfc4);
    const rim = sstep(Math.hypot(x, z), dR * 0.86, dR);
    out[0] = mix(c[0], 0.72, rim) * k; out[1] = mix(c[1], 0.38, rim) * k; out[2] = mix(c[2], 0.34, rim) * k;
  });
  drumG.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...D),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dn),
    new THREE.Vector3(1, 1, 1),
  ));
  // On the eardrum's medial face, in terms of its own axes.
  const onDrum = (up, side, lift) => {
    const p = new THREE.Vector3(...D).addScaledVector(upD, up).addScaledVector(sideD, side).addScaledVector(dn, lift);
    return [p.x, p.y, p.z];
  };

  // --- The three ossicles, one sculpt, each its own colour --------------------------------------
  const HAMMER = 0xf0b43c; const ANVIL = 0xf4e6b4; const STIRRUP = 0xf08a4a;
  const O = new Sculpt(0.027);
  // Hammer: the handle lies on the eardrum from its centre to its top edge, then neck and round head.
  const umbo = onDrum(0, 0, 0.13);
  const handleTop = onDrum(0.56, 0.02, 0.08);
  const head = [0.2, 3.98, ZF + 0.14];
  O.add(curveP([umbo, onDrum(0.28, 0.01, 0.105), handleTop, [0.08, 3.68, ZF + 0.12], head], [0.05, 0.055, 0.07, 0.08, 0.13], 24), HAMMER);
  O.add(ellipsoidP(head, [0.2, 0.26, 0.2]), HAMMER, { k: 0.07 });
  O.add(curveP([handleTop, onDrum(0.6, -0.1, 0.03)], [0.06, 0.03], 5), HAMMER, { k: 0.03 }); // its lateral process
  // Anvil: a body like a molar against the hammer's head, a short process back, a long one down.
  const anvil = [0.5, 3.86, ZF + 0.1];
  O.add(ellipsoidP(anvil, [0.21, 0.25, 0.17]), ANVIL, { k: 0.01, ck: 0.014 });
  O.add(curveP([anvil, [0.74, 3.98, ZF + 0.02], [0.92, 4.0, ZF - 0.06]], [0.13, 0.085, 0.045], 12), ANVIL, { k: 0.05, ck: 0.014 });
  const lenticular = [0.66, 3.0, ZF + 0.08];
  O.add(curveP([anvil, [0.55, 3.5, ZF + 0.1], [0.55, 3.14, ZF + 0.09], lenticular], [0.11, 0.06, 0.05, 0.055], 18), ANVIL, { k: 0.05, ck: 0.014 });
  // Stirrup: head, neck, two arched crura, and the footplate that sits in the oval window.
  const sHead = [0.74, 3.0, ZF + 0.07];
  const footX = 1.13;
  O.add(ellipsoidP(sHead, [0.07, 0.08, 0.075]), STIRRUP, { k: 0.008, ck: 0.012 });
  O.add(curveP([sHead, [0.86, 3.2, ZF + 0.06], [1.0, 3.3, ZF + 0.05], [footX, 3.28, ZF + 0.05]], [0.05, 0.04, 0.037, 0.04], 16), STIRRUP, { k: 0.03, ck: 0.012 });
  O.add(curveP([sHead, [0.86, 2.8, ZF + 0.06], [1.0, 2.7, ZF + 0.05], [footX, 2.72, ZF + 0.05]], [0.05, 0.04, 0.037, 0.04], 16), STIRRUP, { k: 0.03, ck: 0.012 });
  O.add(ellipsoidP([footX + 0.01, 3.0, ZF + 0.05], [0.042, 0.36, 0.19]), STIRRUP, { k: 0.02, ck: 0.012 });
  const ossicleG = polygonize(O);

  // --- The labyrinth, one surface --------------------------------------------------------------
  const L = new Sculpt(0.043);
  const VEST = [1.55, 3.02, ZF - 0.02];
  const COCHLEA = 0xb978d8; const CANALS = 0x46c2ac; const VESTIBULE = 0x7fd0dc; const NERVE = 0xf2cf3e;
  L.add(ellipsoidP(VEST, [0.42, 0.44, 0.32]), VESTIBULE);
  // The cochlea: 2.5 turns, a spiral climbing a cone with its apex toward the student.
  const TURNS = 2.5;
  const C0 = new THREE.Vector3(2.02, 1.8, ZF - 0.16);
  const axis = new THREE.Vector3(-0.2, -0.16, 0.97).normalize();
  const e1 = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1);
  const spiral = []; const spiralR = [];
  spiral.push([VEST[0] + 0.1, VEST[1] - 0.24, VEST[2]]); spiralR.push(0.22);
  const S = 150;
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const a = 0.32 + t * TURNS * Math.PI * 2; // starts up by the vestibule
    const rho = mix(0.74, 0.1, t ** 0.88);
    const h = mix(0.02, 0.74, t);
    const p = C0.clone().addScaledVector(e1, Math.cos(a) * rho).addScaledVector(e2, Math.sin(a) * rho).addScaledVector(axis, h);
    spiral.push([p.x, p.y, p.z]);
    spiralR.push(mix(0.205, 0.075, t ** 0.9));
  }
  const COCHLEA_TUBE = segsP(spiral, spiralR);
  L.add(COCHLEA_TUBE, COCHLEA, { k: 0.03, ck: 0.05 });
  // The three canals, in three planes at right angles to each other.
  const N1 = new THREE.Vector3(0.8165, 0, 0.5774);
  const N2 = new THREE.Vector3(-0.4082, 0.7071, 0.5774);
  const N3 = new THREE.Vector3(-0.4082, -0.7071, 0.5774);
  const root3 = [VEST[0] + 0.14, VEST[1] + 0.22, VEST[2]];
  const canalLoop = (normal, toward, R, ampullaFirst = true) => {
    const d = new THREE.Vector3(...toward);
    d.addScaledVector(normal, -d.dot(normal)).normalize();
    const c = new THREE.Vector3(...root3).addScaledVector(d, R * 0.96);
    const side = new THREE.Vector3().crossVectors(normal, d);
    const pts = [root3.slice()]; const radii = [0.09];
    const M = 40;
    for (let i = 0; i <= M; i++) {
      const t = i / M;
      const th = THREE.MathUtils.degToRad(mix(32, 328, t));
      const p = c.clone().addScaledVector(d, -Math.cos(th) * R).addScaledVector(side, Math.sin(th) * R);
      pts.push([p.x, p.y, p.z]);
      const amp = ampullaFirst ? 1 - sstep(t, 0.04, 0.2) : sstep(t, 0.8, 0.96);
      radii.push(0.086 + amp * 0.075);
    }
    pts.push(root3.slice()); radii.push(0.09);
    L.add(segsP(pts, radii), CANALS, { k: 0.05, ck: 0.05 });
  };
  canalLoop(N1, [0.55, 1, 0], 0.46); // posterior
  canalLoop(N2, [1, 0.28, 0], 0.47); // lateral
  canalLoop(N3, [-0.34, 1, 0], 0.46); // anterior
  // The nerve: a branch from the cochlea's core and a branch from the vestibule, which join and leave
  // through their own channel at the right of the block.
  const trunk = [[2.42, 2.76, ZF - 0.06], [2.72, 2.78, ZF - 0.04], [3.2, 2.84, ZF - 0.03]];
  const coreP = C0.clone().addScaledVector(axis, 0.1);
  L.add(curveP([[coreP.x, coreP.y, coreP.z], [2.2, 2.18, ZF - 0.44], [2.34, 2.56, ZF - 0.3], trunk[0]], [0.1, 0.095, 0.1, 0.11], 16), NERVE, { k: 0.07, ck: 0.03 });
  L.add(curveP([[VEST[0] + 0.3, VEST[1] - 0.02, VEST[2] - 0.08], [2.0, 2.92, ZF - 0.1], trunk[0]], [0.08, 0.085, 0.1], 12), NERVE, { k: 0.05, ck: 0.03 });
  L.add(curveP(trunk, [0.135, 0.13, 0.13], 10), NERVE, { k: 0.05, ck: 0.03 });
  L.sub({ box: [3.12, 2, -2, 4, 4, 3], f: (x) => 3.12 - x });
  const labyrinthG = polygonize(L, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const m = 0.96 + smoothNoise3(x * 4, y * 4, z * 4) * 0.08;
      rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
    },
  });

  // --- Assembly -------------------------------------------------------------------------------
  const stand = [];
  plinth(stand, -3.1, 3.1, Z0 - 0.25, ZF + 0.45, Y0);
  const root = new THREE.Group();
  root.name = 'human-ear';
  root.add(mesh(mergeParts([{ geometry: plateG, color: 0xffffff }]), standard({ map: faceMap, roughness: 0.78, metalness: 0 })));
  root.add(organMesh([{ geometry: blockG, keepColor: true }, { geometry: hollow, keepColor: true }, ...stand], { roughness: 0.74, metalness: 0 }));
  root.add(organMesh([{ geometry: pinnaG, keepColor: true }], { roughness: 0.52, metalness: 0, bumpMap: grainBump(23, { dots: 1200, contrast: 0.3 }), bumpScale: 0.18 }));
  root.add(organMesh([{ geometry: labyrinthG, keepColor: true }, { geometry: ossicleG, keepColor: true }, { geometry: drumG, keepColor: true }], { roughness: 0.34, metalness: 0 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Tooth cross section
// ---------------------------------------------------------------------------------------------

// A lower molar, cut front to back through its two roots with the front part removed, so the plate at
// z = ZC is a mesiodistal section. The cut passes close to the tips of the two cheek-side cusps, which
// is why it shows two cusps and a fissure; the other cusps stand behind it. A real molar has more than
// two roots in some teeth and a textbook section always idealises this one, but two is right for the
// usual lower first molar.
//
// Every layer is one distance field used twice: to cut the solid and to fill its colour on the plate.
function toothSection() {
  const ZC = 1.0; const Z_CROWN = 0.8;
  const rng = seededRandom(9104);

  // --- The tooth itself ------------------------------------------------------------------------
  const T = new Sculpt(0.06);
  const ROOT_Z = ZC - 0.03;
  const ROOT_A = [[-0.72, 4.5, ROOT_Z], [-0.9, 3.42, ROOT_Z], [-0.9, 2.32, ROOT_Z], [-0.72, 1.46, ROOT_Z], [-0.56, 1.14, ROOT_Z]];
  const ROOT_B = [[0.72, 4.5, ROOT_Z], [0.86, 3.42, ROOT_Z], [0.84, 2.32, ROOT_Z], [0.66, 1.5, ROOT_Z], [0.52, 1.2, ROOT_Z]];
  const CREAM = 0xf1ecdf;
  T.add(boxP([0, 5.25, Z_CROWN], [0.92, 0.28, 0.82], null, 0.62), CREAM);
  T.add(boxP([0, 4.5, Z_CROWN], [0.95, 0.45, 0.8], null, 0.3), CREAM, { k: 0.3 });
  T.add(curveP(ROOT_A, [0.78, 0.62, 0.47, 0.27, 0.14], 18), CREAM, { k: 0.25 });
  T.add(curveP(ROOT_B, [0.78, 0.62, 0.47, 0.27, 0.14], 18), CREAM, { k: 0.25 });
  // The cusps: two in a front row the cut passes through, two behind, and a low fifth at the far end.
  for (const [x, y, z, rx, ry, rz] of [
    [-0.82, 6.2, ZC - 0.04, 0.72, 0.72, 0.62], [0.82, 6.16, ZC - 0.04, 0.72, 0.7, 0.62],
    [-0.8, 6.22, 0.06, 0.68, 0.7, 0.62], [0.78, 6.18, 0.06, 0.66, 0.68, 0.62],
    [1.32, 5.98, 0.56, 0.36, 0.46, 0.42],
  ]) T.add(ellipsoidP([x, y, z], [rx, ry, rz]), CREAM, { k: 0.42 });
  // The fissures, the grooves food and decay both find.
  T.sub(curveP([[-1.5, 6.3, Z_CROWN - 0.28], [-0.7, 6.26, Z_CROWN - 0.26], [0, 6.2, Z_CROWN - 0.26], [0.7, 6.24, Z_CROWN - 0.26], [1.6, 6.26, Z_CROWN - 0.26]], 0.06, 24), null, { k: 0.14 });
  T.sub(curveP([[0, 6.62, 1.8], [0, 6.34, 1.0], [0, 6.2, 0.5], [0, 6.2, -0.1], [0, 6.4, -0.8]], 0.05, 24), null, { k: 0.16 });
  const toothSlice = gridded(sliceOf(T.ops, ZC), [-3.4, -0.2, 3.4, 7.4], 0.02);

  // --- Jawbone and gum -------------------------------------------------------------------------
  const BONE_PRIM = boxP([0, 2.1, -0.3], [2.72, 1.65, 1.4], null, 0.2);
  const GUM_BLOCK = boxP([0, 3.82, -0.3], [2.74, 0.62, 1.42], null, 0.24);
  const GUM_COLLAR = ellipsoidP([0, 4.42, Z_CROWN], [1.95, 0.52, 1.74]);
  const BONE_C = lin(0xe6d6ae); const GUM_C = lin(0xe9808e);
  const G = new Sculpt(0.125);
  G.add(BONE_PRIM, BONE_C);
  G.add(GUM_BLOCK, GUM_C, { ck: 0.03 });
  G.add(GUM_COLLAR, GUM_C, { k: 0.3, ck: 0.03 });
  const gumSlice = gridded(sliceOf(G.ops, ZC), [-3.4, -0.2, 3.4, 7.4], 0.025);
  const boneSlice = gridded((x, y) => BONE_PRIM.f(x, y, ZC), [-3.4, -0.2, 3.4, 7.4], 0.03);

  // --- The voids: the pulp cavity, and the canal under the roots in the bone ---------------------
  const CANAL_A = ROOT_A.map(([x, y], i) => [i === 0 ? -0.56 : x, i === 0 ? 4.72 : y, ZC]);
  const CANAL_B = ROOT_B.map(([x, y], i) => [i === 0 ? 0.56 : x, i === 0 ? 4.72 : y, ZC]);
  const PULP = 0xd8525a;
  const Pv = new Sculpt(0.042);
  Pv.add(ellipsoidP([0, 5.0, ZC], [0.74, 0.42, 0.5]), PULP);
  Pv.add(curveP([[-0.5, 5.12, ZC], [-0.72, 5.46, ZC], [-0.82, 5.72, ZC]], [0.26, 0.15, 0.06], 10), PULP, { k: 0.1 });
  Pv.add(curveP([[0.5, 5.1, ZC], [0.72, 5.42, ZC], [0.82, 5.68, ZC]], [0.26, 0.15, 0.06], 10), PULP, { k: 0.1 });
  Pv.add(curveP(CANAL_A, [0.3, 0.2, 0.135, 0.085, 0.07], 18), PULP, { k: 0.1 });
  Pv.add(curveP(CANAL_B, [0.3, 0.2, 0.135, 0.085, 0.07], 18), PULP, { k: 0.1 });
  const pulpSlice = gridded(sliceOf(Pv.ops, ZC), [-3.4, -0.2, 3.4, 7.4], 0.016);
  const IAN_Y = 0.78;
  const JAW = 0x9a3f52;
  Pv.add(curveP([[-3.3, IAN_Y, ZC], [0, IAN_Y - 0.03, ZC], [3.3, IAN_Y, ZC]], 0.24, 16), JAW, { ck: 0.03 });
  Pv.sub({ box: [2.9, -1, -2, 8, 3, 3], f: (x) => 2.9 - x });
  Pv.sub({ box: [-8, -1, -2, -2.9, 3, 3], f: (x) => x + 2.9 });
  const voidSlice = gridded(sliceOf(Pv.ops, ZC), [-3.4, -0.2, 3.4, 7.4], 0.016);
  const voidG = hollowAt(Pv, ZC, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const d = sstep(ZC - z, 0, 0.42);
      const k = (0.95 + smoothNoise3(x * 5, y * 5, z * 5) * 0.14) * mix(1.05, 0.62, d);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });

  // --- The cut face ----------------------------------------------------------------------------
  const X0 = -3.05; const X1 = 3.05; const Y0 = 0.2; const Y1 = 7.0;
  const solidSlice = (x, y) => Math.min(toothSlice(x, y), gumSlice(x, y));
  const plateLoops = contour((x, y) => Math.max(solidSlice(x, y), -voidSlice(x, y)), [X0, Y0 - 0.05, X1, Y1], 0.016);
  const plateG = plate(plateLoops, (x, y) => [x, y, ZC], (x, y) => [(x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0)], [0, 0, 1]);
  const enamelDepth = (y) => (y < 4.55 ? 0.045 : mix(0.045, 0.36, sstep(y, 4.55, 5.6)));
  const W = 1024; const H = Math.round((W * (Y1 - Y0)) / (X1 - X0));
  const PX = W / (X1 - X0);
  const map = (x, y) => [(x - X0) * PX, H - (y - Y0) * PX];
  const region = (f, c = 0.022) => contour(f, [X0 - 0.2, Y0 - 0.2, X1 + 0.2, Y1 + 0.2], c);
  const faceMap = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#eddcb2';
    ctx.fillRect(0, 0, W, H);
    // Gum, with the bone over it.
    const gumLoops = region(gumSlice);
    fillLoops(ctx, gumLoops, map, '#ea7f8d');
    ctx.save();
    clipLoops(ctx, gumLoops, map);
    for (let i = 0; i < 500; i++) {
      const [a, b] = map(mix(X0, X1, rng()), mix(3, 5, rng()));
      ctx.fillStyle = rng() > 0.5 ? 'rgba(180,60,84,0.35)' : 'rgba(255,190,190,0.35)';
      ctx.beginPath(); ctx.arc(a, b, 1 + rng() * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    traceLoops(ctx, gumLoops, map, '#c64f65', 5);
    // Compact bone in laminae round the outside.
    const boneLoops = region(boneSlice);
    fillLoops(ctx, boneLoops, map, '#f0e4c6');
    ctx.save();
    clipLoops(ctx, boneLoops, map);
    ctx.lineWidth = 1.4;
    for (const off of [0.06, 0.12, 0.18]) {
      traceLoops(ctx, region((x, y) => boneSlice(x, y) + off, 0.03), map, 'rgba(170,140,92,0.6)', 1.4);
    }
    ctx.restore();
    // Spongy bone inside it: red marrow spaces between a lattice of struts, coarser toward the middle.
    const spongy = region((x, y) => boneSlice(x, y) + 0.26);
    fillLoops(ctx, spongy, map, '#e2c994');
    ctx.save();
    clipLoops(ctx, spongy, map);
    for (let i = 0; i < 1000; i++) {
      const x = mix(X0, X1, rng()); const y = mix(0.3, 4, rng());
      const [a, b] = map(x, y);
      const r = (0.035 + rng() * 0.075) * PX;
      ctx.fillStyle = rng() > 0.3 ? '#b4574f' : '#8f3a3d';
      ctx.beginPath(); ctx.ellipse(a, b, r, r * (0.45 + rng() * 0.5), rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // The ligament that slings the root in its socket, a thin pink line round it.
    fillLoops(ctx, region((x, y) => Math.max(toothSlice(x, y) - 0.07, y - 4.45)), map, '#d9707e');
    // Cementum on the root, and enamel on the crown, with dentin under both.
    const toothLoops = region(toothSlice, 0.016);
    fillLoops(ctx, toothLoops, map, '#d8bd72');
    ctx.save();
    clipLoops(ctx, toothLoops, map);
    ctx.fillStyle = '#faf8f0';
    ctx.fillRect(0, 0, W, map(0, 4.55)[1]);
    // Enamel's growth lines, curving in from the surface, are very faint.
    for (let i = 1; i <= 3; i++) traceLoops(ctx, region((x, y) => toothSlice(x, y) + i * 0.09, 0.03), map, 'rgba(136,170,190,0.16)', 1.2);
    ctx.restore();
    const dentinLoops = region((x, y) => toothSlice(x, y) + enamelDepth(y), 0.016);
    fillLoops(ctx, dentinLoops, map, '#f0d48e');
    ctx.save();
    clipLoops(ctx, dentinLoops, map);
    // Dentin's tubules run from the pulp out to the enamel: fine, close, slightly S-curved lines.
    ctx.strokeStyle = 'rgba(190,140,70,0.44)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 150; i++) {
      const a = (i / 150) * Math.PI;
      const [p, q] = map(Math.cos(a) * 0.5, 5.0 + Math.sin(a) * 0.2);
      const [r, s] = map(Math.cos(a) * 1.8, 5.0 + Math.sin(a) * 1.6);
      ctx.beginPath(); ctx.moveTo(p, q); ctx.quadraticCurveTo((p + r) / 2 + 6, (q + s) / 2 - 4, r, s); ctx.stroke();
    }
    for (const path of [ROOT_A, ROOT_B]) {
      for (let y = 1.3; y < 4.5; y += 0.035) {
        let x = path[0][0];
        for (let i = 0; i < path.length - 1; i++) if (y <= path[i][1] && y >= path[i + 1][1]) x = mix(path[i][0], path[i + 1][0], (path[i][1] - y) / (path[i][1] - path[i + 1][1]));
        const [p, q] = map(x - 0.8, y - 0.06); const [r, s] = map(x + 0.8, y + 0.06);
        ctx.beginPath(); ctx.moveTo(p, s); ctx.lineTo(r, q); ctx.stroke();
      }
    }
    ctx.restore();
    // The pulp's wall, with its darker lining of predentin and the shadow where the void starts.
    const pulpLoops = region(pulpSlice, 0.016);
    traceLoops(ctx, pulpLoops, map, '#d6a460', 7);
    const jawLoops = region(voidSlice, 0.016);
    traceLoops(ctx, jawLoops, map, 'rgba(80,20,28,0.7)', 2.6);
    traceLoops(ctx, toothLoops, map, 'rgba(120,84,50,0.42)', 1.6);
  });

  // --- The outside ------------------------------------------------------------------------------
  // The tooth is polygonised only where it can be seen, above the gum.
  T.sub({ box: [-8, -1, -3, 8, 4.1, 4], f: (x, y) => y - 4.1 });
  const crownG = trimmedAt(T, ZC, {
    uvScale: 0.9,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // Ivory toward the neck, whiter on the cusps, and a shade darker down in the fissures.
      const t = sstep(y, 4.7, 6.2);
      const groove = 1 - 0.5 * (1 - sstep(Math.min(Math.abs(x) * 1.6, Math.abs(z - (Z_CROWN - 0.26)) * 1.6), 0.02, 0.16)) * sstep(y, 5.8, 6.1);
      rgb[0] = mix(0.74, 0.78, t) * groove; rgb[1] = mix(0.65, 0.75, t) * groove; rgb[2] = mix(0.44, 0.66, t) * groove;
    },
  });
  const gumG = trimmedAt(G, ZC, {
    uvScale: 1.2,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const inBone = BONE_PRIM.f(x, y, z) < 0.05 && Math.min(GUM_BLOCK.f(x, y, z), GUM_COLLAR.f(x, y, z)) > -0.02;
      if (inBone || rgb[1] > 0.5) {
        // Banded jawbone: broad strata, a thin dark seam between them, and a wandering edge.
        const wob = (smoothNoise3(x * 0.8, y * 0.8, z * 0.8) - 0.5) * 0.3;
        const band = Math.sin((y + wob) * Math.PI * 2 * 1.4);
        const k = 0.86 + 0.12 * band + 0.08 * smoothNoise3(x * 3, y * 8, z * 3);
        rgb[0] *= k; rgb[1] *= k * 0.98; rgb[2] *= k * 0.94;
      } else {
        const k = 0.9 + smoothNoise3(x * 6, y * 6, z * 6) * 0.18;
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      }
    },
  });

  // --- The nerve and vessels, real and standing in the cavity -----------------------------------
  const tubes = [];
  const lay = (points, r0, r1, color, sides = 9) => {
    const radii = points.map((_, i) => mix(r0, r1, i / (points.length - 1)));
    tubes.push({ geometry: tube(points, radii, { sides, steps: (points.length - 1) * 5, round: 2 }), color });
  };
  const NERVE = 0xf4d23e; const ART = 0xe4262a; const VEIN = 0x2c52c0;
  // Along the jaw, in their own canal, three abreast.
  const at = (x, y, dz = 0) => [x, y, ZC + dz];
  const runX = [-2.92, -1.5, 0, 1.5, 2.92];
  lay(runX.map((x) => at(x, IAN_Y + 0.11, -0.02)), 0.07, 0.07, ART);
  lay(runX.map((x) => at(x, IAN_Y - 0.01, 0.0)), 0.085, 0.085, NERVE);
  lay(runX.map((x) => at(x, IAN_Y - 0.13, -0.02)), 0.075, 0.075, VEIN);
  // Up through the tip of each root and on into the crown. In a root the three lie side by side, and
  // the bone between the jaw canal and the root tip is crossed half sunk in the face.
  const bundle = (path, horn, far) => {
    const off = [-0.042, 0, 0.042];
    const cols = [ART, NERVE, VEIN];
    const tip = path[path.length - 1];
    off.forEach((o, i) => {
      const w = (y) => o * mix(1, 3.3, sstep(y, 1.3, 4.4));
      const pts = [at(tip[0] + o * 1.4, IAN_Y + (i === 1 ? 0 : (i === 0 ? 0.11 : -0.13)), -0.01)];
      for (let k = path.length - 1; k >= 0; k--) {
        const [x, y] = k === 0 ? [mix(path[0][0], 0, 0.2), 4.72] : path[k];
        pts.push(at(x + w(y), y, 0.012));
      }
      lay(pts, 0.03 + (i === 1 ? 0.002 : 0), 0.05, cols[i], 8);
    });
    // In the chamber they spread into branches, one running up into each horn of the pulp.
    const top = [mix(path[0][0], 0, 0.2), 4.72];
    lay([at(top[0] - 0.13, top[1], 0.012), at(mix(top[0], horn[0], 0.5) - 0.06, 5.14, 0.016), at(horn[0] - 0.02, horn[1], 0.012)], 0.042, 0.015, ART, 7);
    lay([at(top[0], top[1], 0.012), at(mix(top[0], horn[0], 0.5), 5.22, 0.02), at(horn[0] + 0.05, horn[1] + 0.04, 0.012)], 0.044, 0.015, NERVE, 7);
    lay([at(top[0] + 0.13, top[1], 0.012), at(mix(top[0], far, 0.45), 5.08, 0.012), at(far, 5.02, 0.012)], 0.042, 0.02, VEIN, 7);
    lay([at(top[0] + 0.13, top[1], 0.012), at(mix(top[0], horn[0], 0.5) + 0.12, 5.1, 0.012), at(horn[0] + 0.1, horn[1] - 0.08, 0.012)], 0.03, 0.012, VEIN, 7);
  };
  bundle(ROOT_A, [-0.8, 5.62], 0.22);
  bundle(ROOT_B, [0.8, 5.58], -0.22);

  // --- Assembly -------------------------------------------------------------------------------
  const stand = [];
  plinth(stand, -3.15, 3.15, -2.1, 1.5, 0.27);
  const root = new THREE.Group();
  root.name = 'tooth-section';
  root.add(mesh(mergeParts([{ geometry: plateG, color: 0xffffff }]), standard({ map: faceMap, roughness: 0.6, metalness: 0 })));
  root.add(organMesh([{ geometry: crownG, keepColor: true }, ...tubes], { roughness: 0.26, metalness: 0 }));
  root.add(organMesh([{ geometry: gumG, keepColor: true }, { geometry: voidG, keepColor: true }, ...stand], { roughness: 0.66, metalness: 0 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Skin cross section
// ---------------------------------------------------------------------------------------------

// A sawn block of skin with its front and right-hand faces as cuts and its top as the real surface.
// The layers are a painting; what lives in them is real geometry half sunk in the plate. Each object
// is placed through `front` or `side`, which turn (along-the-face, height, proud-of-the-face) into a
// point, so the same follicle can stand on either cut.
//
// Thicknesses are exaggerated against one another the way every diagram of skin does: the epidermis
// here is a sixteenth of the block, about right for the dermis it sits on and much too thin to hold
// its own detail, and a hair, a gland and a corpuscle are not to one scale.
function skinSection() {
  const X0 = -3; const X1 = 3; const ZB = -1.8; const ZF = 1.2; const YB = 0.3; const YT = 5.3;
  const FAT_TOP = 2.86;
  const rng = seededRandom(3307);
  const front = (s, y, d = 0) => [s, y, ZF + d];
  const side = (s, y, d = 0) => [X1 + d, y, s]; // s runs along z

  // --- The painted faces ------------------------------------------------------------------------
  // One long strip wrapped round the corner: the front from s = 0 to 6, the side from 6 to 9, so a
  // layer's wavy edge runs round the corner unbroken.
  const W = 1404; const H = 780;
  const PX = W / 9;
  const mapS = (s) => s * PX;
  const mapY = (y) => H - (y - YB) * PX;
  const rete = (s) => YT - 0.34 + Math.sin(s * 6.3) * 0.055 + Math.sin(s * 13.7 + 1) * 0.022;
  const fatEdge = (s) => FAT_TOP + Math.sin(s * 2.4) * 0.07 + Math.sin(s * 5.9 + 2) * 0.05;
  const strip = (f, style, close = YB - 0.2) => {
    const ctx = strip.ctx;
    ctx.beginPath();
    ctx.moveTo(0, mapY(close));
    for (let s = 0; s <= 9.01; s += 0.03) ctx.lineTo(mapS(s), mapY(f(s)));
    ctx.lineTo(W, mapY(close));
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };
  const faceMap = canvasTexture(W, H, (ctx) => {
    strip.ctx = ctx;
    // Stratum corneum at the top: flat dead cells flaking away. It is drawn first and everything else
    // is laid up to its underside.
    ctx.fillStyle = '#f2dcbd';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(176,132,92,0.55)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) {
      const y = YT - 0.015 - i * 0.017;
      ctx.beginPath();
      for (let s = 0; s <= 9.01; s += 0.06) { const p = mapY(y + (Math.sin(s * 9 + i) * 0.003)); if (s === 0) ctx.moveTo(0, p); else ctx.lineTo(mapS(s), p); }
      ctx.stroke();
    }
    // Living epidermis, darkening as it deepens and with its cells in rows.
    strip(() => YT - 0.075, '#eeb78c');
    for (let i = 0; i < 2100; i++) {
      const s = rng() * 9; const y = YT - 0.08 - rng() * 0.3;
      if (y < rete(s)) continue;
      ctx.fillStyle = 'rgba(166,96,62,0.38)';
      ctx.beginPath();
      ctx.ellipse(mapS(s), mapY(y), 2.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // The basal layer: the row of dark, pigmented cells where new skin is made. It rides the wavy edge.
    strip((s) => rete(s) + 0.035, '#8d5232');
    // Dermis, thick and fibrous, paler in its top band where the papillae are.
    strip(rete, '#f6c7ae');
    strip((s) => rete(s) - 0.24, '#eea894');
    ctx.lineCap = 'round';
    for (let i = 0; i < 1100; i++) {
      const s = rng() * 9; const y = mix(FAT_TOP - 0.1, YT - 0.6, rng());
      const a = (rng() - 0.5) * 1.2; const len = 12 + rng() * 26;
      const x = mapS(s); const py = mapY(y);
      ctx.strokeStyle = rng() > 0.45 ? 'rgba(206,110,100,0.46)' : 'rgba(255,224,206,0.5)';
      ctx.lineWidth = 1 + rng() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.bezierCurveTo(x + len * 0.3, py + Math.sin(a) * len * 0.8, x + len * 0.7, py - Math.sin(a) * len * 0.5, x + len, py + Math.sin(a) * len * 0.4);
      ctx.stroke();
    }
    // The fatty layer's walls, which show between the real lobes.
    strip(fatEdge, '#c8902a');
    for (let i = 0; i < 400; i++) {
      const s = rng() * 9; const y = mix(YB, FAT_TOP - 0.2, rng());
      ctx.fillStyle = 'rgba(120,76,20,0.32)';
      ctx.beginPath(); ctx.ellipse(mapS(s), mapY(y), 4 + rng() * 9, 2 + rng() * 6, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
  });
  const faceRect = (a, b, c, d, u0, u1, normal) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([...normal, ...normal, ...normal, ...normal], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 0, u1, 0, u1, 1, u0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  };
  const frontFace = faceRect([X0, YB, ZF], [X1, YB, ZF], [X1, YT, ZF], [X0, YT, ZF], 0, 6 / 9, [0, 0, 1]);
  const sideFace = faceRect([X1, YB, ZF], [X1, YB, ZB], [X1, YT, ZB], [X1, YT, ZF], 6 / 9, 1, [1, 0, 0]);

  // --- The surface ------------------------------------------------------------------------------
  const DX = X1 - X0; const DZ = ZF - ZB;
  const PORES = [[1.35, ZF - 0.12]];
  for (let i = 0; i < 15; i++) PORES.push([mix(X0 + 0.3, X1 - 0.3, rng()), mix(ZB + 0.25, ZF - 0.3, rng())]);
  const topMap = canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e6ad8b';
    ctx.fillRect(0, 0, w, h);
    // Skin's surface is a net of fine creases dividing it into little plates: a jittered lattice.
    const cols = 34; const rows = 17;
    const jitter = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) jitter.push([(i + (rng() - 0.5) * 0.7) * (w / cols), (j + (rng() - 0.5) * 0.7) * (h / rows)]);
    const at = (i, j) => jitter[i + j * (cols + 1)];
    ctx.strokeStyle = 'rgba(166,104,76,0.4)';
    ctx.lineWidth = 1.3;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const a = at(i, j);
        for (const b of [i < cols ? at(i + 1, j) : null, j < rows ? at(i, j + 1) : null, i < cols && j < rows ? at(i + 1, j + 1) : null]) {
          if (!b) continue;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        }
      }
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(244,196,160,0.3)' : 'rgba(186,118,86,0.22)';
      ctx.beginPath(); ctx.arc(rng() * w, rng() * h, 1 + rng() * 3.4, 0, Math.PI * 2); ctx.fill();
    }
  });
  const ripple = (x, z) => 0.012 * Math.sin(x * 3.1 + z * 1.7) + 0.008 * Math.sin(x * 7.1 - z * 5.3);
  const edgeFade = (x, z) => sstep(Math.min(x - X0, X1 - x, z - ZB, ZF - z), 0, 0.2);
  const topG = sheet(26, 52, (ti, tj) => {
    const x = mix(X0, X1, tj); const z = mix(ZF, ZB, ti);
    return [x, YT + ripple(x, z) * edgeFade(x, z), z];
  }, (ti, tj) => [tj, ti]);

  // --- What lives in it -------------------------------------------------------------------------
  const parts = [];
  const lay = (points, r0, r1, color, { sides = 9, end = 2, per = 5 } = {}) => {
    const radii = points.map((_, i) => mix(r0, r1, i / (points.length - 1)));
    parts.push({ geometry: tube(points, radii, { sides, steps: Math.round((points.length - 1) * per), round: end }), color });
  };
  const SKINDEEP = { ART: 0xdf2730, VEIN: 0x2a50bd, NERVE: 0xf5d432, SWEAT: 0x2fc0ad, HAIR: 0x3d2615, SHEATH: 0xf0d3a4, BULB: 0xe7c48c, PAPILLA: 0xc6324a, GLAND: 0xf7e58a, MUSCLE: 0xbd3f58 };

  // A follicle, its gland, its muscle: one sculpted surface, so the gland grows out of the follicle.
  const F = new Sculpt(0.042);
  const follicle = (place, s0, lean, scale = 1) => {
    const p = (ds, y, d) => place(s0 + ds, y, d);
    const yTop = YT; const yRoot = 3.06 + (1 - scale) * 0.7;
    const sheathPath = [p(0, yTop + 0.02, -0.08), p(lean * 0.25, 4.72, -0.05), p(lean * 0.62, 3.9, -0.05), p(lean, yRoot + 0.2, -0.05)];
    const rs = [0.15, 0.17, 0.175, 0.2].map((r) => r * scale);
    F.add(curveP(sheathPath, rs, 22), SKINDEEP.SHEATH);
    const root = p(lean * 1.05, yRoot, -0.05);
    F.add(ellipsoidP(root, [0.28 * scale, 0.34 * scale, 0.26 * scale]), SKINDEEP.BULB, { k: 0.12, ck: 0.04 });
    // The papilla, the little knot of blood vessels that feeds the root, pushes up into the bulb's base.
    const pap = p(lean * 1.06, yRoot - 0.14 * scale, 0.12 * scale);
    F.add(ellipsoidP(pap, [0.1 * scale, 0.13 * scale, 0.1 * scale]), SKINDEEP.PAPILLA, { ck: 0.015 });
    // The oil gland, a bunch of lobes on the side the muscle pulls from, with a duct into the follicle.
    const dir = lean > 0 ? -1 : 1;
    const gl = [[0.3, 4.28, 0.03, 0.13], [0.5, 4.42, 0.03, 0.15], [0.62, 4.22, 0.02, 0.14], [0.45, 4.08, 0.03, 0.15], [0.26, 4.06, 0.02, 0.1], [0.66, 4.02, 0.01, 0.1]];
    F.add(curveP([p(lean * 0.34, 4.44, -0.02), p(dir * 0.18 * scale + lean * 0.34, 4.34, 0)], 0.05 * scale, 5), SKINDEEP.GLAND, { k: 0.05, ck: 0.03 });
    for (const [dx, y, d, r] of gl) {
      F.add(sphereP(p(lean * 0.34 + dir * dx * scale, 4.46 - (4.46 - y) * scale, d), r * scale), SKINDEEP.GLAND, { k: 0.05, ck: 0.03 });
    }
    // The hair stands on the sheath as a dark line and passes out through the surface.
    const shaft = [p(lean * 1.02, yRoot + 0.1, 0.09 * scale), p(lean * 0.62, 3.9, 0.11 * scale), p(lean * 0.25, 4.72, 0.095), p(lean * 0.04, 5.2, 0.03), p(0, YT + 0.02, -0.07), p(-lean * 0.12, YT + 0.5, -0.05), p(-lean * 0.38, YT + 1.08, 0.02)];
    lay(shaft, 0.062 * scale, 0.012, SKINDEEP.HAIR, { sides: 8, per: 6 });
    // The arrector pili, the muscle that makes goose bumps, from low on the follicle up to the skin.
    const a0 = p(lean * 0.68, 3.74, 0); const a1 = p(lean * 0.2 + dir * 0.62 * scale, 4.5 + 0.34, 0.0);
    lay([a0, [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2], a1], 0.05 * scale, 0.028 * scale, SKINDEEP.MUSCLE, { sides: 8 });
  };
  follicle(front, -1.42, -0.62);
  follicle(side, -0.9, 0.42, 0.78); // s = z, running toward the back
  F.sub({ box: [-8, YT - 0.01, -8, 8, 8, 8], f: (x, y) => YT - 0.01 - y });
  const follicleG = polygonize(F, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const k = 0.93 + smoothNoise3(x * 6, y * 6, z * 6) * 0.16;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });

  // A sweat gland: a ball of coiled tube deep in the dermis, and one long duct to a pore at the surface.
  const sweat = (place, s0, y0, poreS, R = 0.46) => {
    // A spirograph rather than a spiral: small loops marching round a bigger one is what a ball of
    // coiled tube looks like, where nested rings read as a target.
    const coil = [];
    const N = 210;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2 * 2;
      const b = a * 7.3;
      coil.push(place(s0 + (Math.cos(a) * 0.62 + Math.cos(b) * 0.42) * R, y0 + (Math.sin(a) * 0.46 + Math.sin(b) * 0.34) * R, 0.055 + Math.sin(b * 0.5 + a) * 0.045));
    }
    const lastCoil = coil[coil.length - 1];
    const top = [];
    const n = 42;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const y = mix(lastCoil[1], YT - 0.01, t);
      const inEpidermis = sstep(y, YT - 0.5, YT - 0.38);
      const s = mix(s0 + Math.cos(0) * R * 0.2, poreS, t);
      const wave = Math.sin(t * Math.PI * 7) * 0.05 * (1 - inEpidermis) + Math.sin(t * Math.PI * 30) * 0.06 * inEpidermis;
      top.push(place(s + wave, y, 0.03 * (1 - sstep(t, 0.9, 1))));
    }
    lay([...coil, ...top], 0.05, 0.036, SKINDEEP.SWEAT, { sides: 8, per: 1.5 });
  };
  sweat(front, 1.28, 3.42, 1.35);
  sweat(side, 0.2, 3.3, 0.45, 0.36);

  // Vessels. A big artery and vein in the deep plexus, running along both cut faces, and branches
  // climbing to a second plexus under the epidermis, where hairpin capillaries reach into each papilla.
  const corner = (y, d) => {
    const pts = [];
    for (const x of [-3.0, -2.1, -1.1, 0.0, 1.0, 2.0, 2.8]) pts.push([x, y + Math.sin(x * 1.3) * 0.06, ZF + d]);
    pts.push([X1 + d * 0.7, y, ZF + d * 0.7 - 0.0]);
    for (const z of [0.9, 0, -0.9, -1.8]) pts.push([X1 + d, y + Math.sin(z * 1.4) * 0.05, z]);
    return pts;
  };
  parts.push({ geometry: tube(corner(2.98, 0.0), 0.085, { sides: 12, steps: 90, round: 0 }), color: SKINDEEP.ART });
  parts.push({ geometry: tube(corner(2.72, 0.0), 0.1, { sides: 12, steps: 90, round: 0 }), color: SKINDEEP.VEIN });
  const riser = (x, y0, xTop, color, r) => {
    lay([front(x, y0, 0), front(mix(x, xTop, 0.35), mix(y0, 4.55, 0.4), 0.0), front(mix(x, xTop, 0.72), mix(y0, 4.55, 0.74), 0.0), front(xTop, 4.55, 0.0)], r, r * 0.62, color, { sides: 8 });
  };
  riser(-0.5, 2.98, -0.38, SKINDEEP.ART, 0.05);
  riser(-0.32, 2.72, -0.16, SKINDEEP.VEIN, 0.055);
  riser(0.42, 2.98, 0.34, SKINDEEP.ART, 0.05);
  riser(0.56, 2.72, 0.56, SKINDEEP.VEIN, 0.055);
  // The shallow plexus, two thin lines a little under the wavy edge.
  const shallow = (y, color, r, a, b) => {
    const pts = [];
    for (let x = a; x <= b + 0.01; x += (b - a) / 7) pts.push(front(x, y + Math.sin(x * 4.1) * 0.03, 0));
    lay(pts, r, r * 0.8, color, { sides: 7, per: 3 });
  };
  shallow(4.56, SKINDEEP.ART, 0.03, -0.95, 0.95);
  shallow(4.47, SKINDEEP.VEIN, 0.034, -0.95, 0.95);
  // One hairpin loop into each papilla the plexus passes under, found from the edge itself.
  for (let s = 2.05; s < 3.95; s += 0.001) {
    // The top of a papilla is where rete(s) has its local maximum, with s on the strip (x = s - 3).
    const here = rete(s);
    if (here > rete(s - 0.05) && here >= rete(s + 0.05)) {
      const x = s - 3;
      lay([front(x - 0.045, 4.56, 0), front(x - 0.05, 4.76, 0.005), front(x - 0.018, here - 0.03, 0.006), front(x + 0.018, here - 0.03, 0.006), front(x + 0.05, 4.74, 0.005), front(x + 0.045, 4.47, 0)], 0.014, 0.016, SKINDEEP.ART, { sides: 6, per: 3 });
      s += 0.3;
    }
  }
  // A perforating pair running down through the fat from the deep plexus.
  const PERF_A = [front(0.86, 2.98, 0), front(0.98, 2.3, 0.03), front(0.78, 1.5, 0.03), front(0.9, 0.3, 0.03)];
  const PERF_V = [front(1.1, 2.72, 0), front(1.2, 2.1, 0.03), front(1.02, 1.4, 0.03), front(1.14, 0.3, 0.03)];
  lay(PERF_A, 0.06, 0.05, SKINDEEP.ART, { sides: 9, end: 0 });
  lay(PERF_V, 0.07, 0.06, SKINDEEP.VEIN, { sides: 9, end: 0 });

  // Nerve: a trunk along the bottom of the dermis, branching to three kinds of ending.
  const NERVE_MAIN = [front(-3.0, 3.34, 0), front(-2.2, 3.42, 0), front(-1.0, 3.28, 0), front(-0.1, 3.36, 0), front(0.3, 3.46, 0.0)];
  lay(NERVE_MAIN, 0.05, 0.036, SKINDEEP.NERVE, { sides: 8, end: 0 });
  // Free endings run up through the dermis into the epidermis and simply stop: those feel pain.
  const FE = [front(0.3, 3.46, 0), front(0.06, 3.96, 0.0), front(-0.05, 4.5, 0.01), front(-0.1, 4.84, 0.01)];
  lay(FE, 0.034, 0.018, SKINDEEP.NERVE, { sides: 7 });
  lay([front(-0.1, 4.84, 0.01), front(-0.18, 5.02, 0.01), front(-0.2, 5.14, 0.008)], 0.016, 0.006, SKINDEEP.NERVE, { sides: 6 });
  lay([front(-0.1, 4.84, 0.01), front(-0.02, 5.03, 0.01), front(0.03, 5.16, 0.008)], 0.016, 0.006, SKINDEEP.NERVE, { sides: 6 });
  lay([front(-0.1, 4.84, 0.01), front(-0.1, 5.02, 0.01), front(-0.08, 5.12, 0.008)], 0.014, 0.006, SKINDEEP.NERVE, { sides: 6 });
  // A touch corpuscle sits in a papilla just under the epidermis: a small striped oval.
  const corpuscle = (c, rx, ry, rings, base, stripe) => {
    const g = lathe(Array.from({ length: 25 }, (_, i) => {
      const a = (i / 24) * Math.PI;
      return [i === 0 || i === 24 ? 0 : Math.sin(a) * rx, -Math.cos(a) * ry];
    }), 18);
    const A = lin(base); const B = lin(stripe);
    tintVertices(g, (x, y, z, out) => {
      const v = Math.sin((y / ry) * Math.PI * rings);
      const m = v > 0 ? A : B;
      out[0] = m[0]; out[1] = m[1]; out[2] = m[2];
    });
    g.translate(c[0], c[1], c[2]);
    parts.push({ geometry: g, keepColor: true });
  };
  corpuscle(front(0.7, 4.76, 0.025), 0.07, 0.15, 4, 0xf4d874, 0xd79a2c);
  lay([front(0.3, 3.46, 0), front(0.62, 4.0, 0.0), front(0.7, 4.62, 0.012)], 0.03, 0.016, SKINDEEP.NERVE, { sides: 7 });
  // A pressure corpuscle lies deep, in the fat: a big onion-layered oval on the end of its own branch.
  const onion = front(-0.28, 2.1, 0.03);
  corpuscle(onion, 0.2, 0.42, 6, 0xf6eeb8, 0xd4b45a);
  lay([front(-0.9, 3.3, 0), front(-0.56, 2.9, 0.0), front(-0.32, 2.5, 0.02)], 0.035, 0.03, SKINDEEP.NERVE, { sides: 7 });
  // On the side face, a nerve and a couple of vessels running back along it.
  lay([side(1.2, 3.8, 0), side(0.5, 3.9, 0), side(-0.5, 3.76, 0), side(-1.8, 3.88, 0)], 0.04, 0.04, SKINDEEP.NERVE, { sides: 7, end: 0 });
  lay([side(1.2, 4.55, 0), side(0.4, 4.5, 0), side(-0.6, 4.58, 0), side(-1.8, 4.52, 0)], 0.03, 0.03, SKINDEEP.ART, { sides: 7, end: 0 });
  lay([side(1.2, 4.46, 0), side(0.4, 4.4, 0), side(-0.6, 4.47, 0), side(-1.8, 4.42, 0)], 0.034, 0.034, SKINDEEP.VEIN, { sides: 7, end: 0 });

  // Hairs elsewhere on the top, and the pores.
  const hairSpots = [];
  for (let i = 0; i < 16; i++) {
    const x = mix(X0 + 0.35, X1 - 0.35, rng()); const z = mix(ZB + 0.3, ZF - 0.4, rng());
    hairSpots.push([x, z]);
    const lean = rng() * Math.PI * 2; const l = 0.55 + rng() * 0.75;
    const dx = Math.cos(lean); const dz = Math.sin(lean);
    lay([[x, YT - 0.04, z], [x + dx * l * 0.16, YT + l * 0.4, z + dz * l * 0.16], [x + dx * l * 0.42, YT + l * 0.76, z + dz * l * 0.42], [x + dx * l * 0.76, YT + l * 1.02, z + dz * l * 0.76]], 0.024, 0.005, SKINDEEP.HAIR, { sides: 6, end: 0, per: 3 });
    // Each stands in its own small dimple-ring, so it does not read as a pin stuck in a plate.
    const ring = lathe([[0, YT - 0.02], [0.09, YT - 0.02], [0.07, YT + 0.018], [0.03, YT + 0.008], [0, YT + 0.006]], 12);
    ring.translate(x, 0, z);
    parts.push({ geometry: ring, color: 0xd4977a });
  }
  for (const [x, z] of PORES) {
    const pore = lathe([[0, YT - 0.02], [0.08, YT - 0.02], [0.07, YT + 0.016], [0.035, YT + 0.012], [0.024, YT + 0.002], [0, YT - 0.002]], 14);
    tintVertices(pore, (px, py, pz, out) => {
      const c = Math.hypot(px, pz) < 0.03 ? lin(0x34180f) : lin(0xdba284);
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    pore.translate(x, 0, z);
    parts.push({ geometry: pore, keepColor: true });
  }

  // Fat: real lobes, a packed crowd of yellow cells bulging from both cut faces. Each is a hemisphere
  // whose rim is buried in the plate. Lobes keep clear of anything else standing on the face.
  const lobes = [];
  const keepOut = [...PERF_A, ...PERF_V, onion].map((p) => [p[0], p[1], p[2]]);
  const lobeHalf = new THREE.SphereGeometry(1, 11, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const lobeRow = (spanA, spanB, toWorld, normalQ, stoffset) => {
    const pitch = 0.46;
    let row = 0;
    for (let y = YB + 0.22; y < FAT_TOP - 0.12; y += pitch * 0.86, row += 1) {
      for (let s = spanA + 0.2 + (row % 2) * pitch * 0.5; s < spanB - 0.14; s += pitch) {
        const sj = s + (rng() - 0.5) * 0.09; const yj = y + (rng() - 0.5) * 0.09;
        if (yj > fatEdge(stoffset(sj)) - 0.1) continue;
        const p = toWorld(sj, yj);
        if (keepOut.some((k) => Math.hypot(k[0] - p[0], k[1] - p[1], k[2] - p[2]) < 0.36)) continue;
        const r = 0.2 + rng() * 0.05;
        const g = lobeHalf.clone();
        g.scale(r, r * 0.52, r * (0.9 + rng() * 0.2));
        g.applyQuaternion(normalQ);
        g.translate(p[0], p[1], p[2]);
        const a = 0.86 + rng() * 0.2;
        const base = [0.96 * a, 0.62 * a, 0.08 * a];
        const cx = p[0]; const cy = p[1]; const cz = p[2];
        tintVertices(g, (x, yy, z, out) => {
          const off = Math.hypot(x - cx, yy - cy, z - cz) / r;
          const edge = sstep(off, 0.55, 1.02);
          out[0] = base[0] * mix(1, 0.72, edge); out[1] = base[1] * mix(1, 0.6, edge); out[2] = base[2] * mix(1, 0.7, edge);
        });
        lobes.push({ geometry: g, keepColor: true });
      }
    }
  };
  const qFront = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  const qSide = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  lobeRow(X0, X1, (s, y) => [s, y, ZF - 0.012], qFront, (s) => s - X0);
  lobeRow(ZB, ZF, (s, y) => [X1 - 0.012, y, s], qSide, (s) => 6 + (ZF - s));

  // --- The two faces nobody cut with care: the back and the left, in plain bands ------------------
  const band = (x0, z0, x1, z1) => {
    const rows = [YB, FAT_TOP, YT - 0.34, YT - 0.05, YT];
    const cols = [lin(0xd8a032), lin(0xeda593), lin(0xeeb78c), lin(0xf2dcbd)];
    const positions = []; const colors = []; const index = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const b = positions.length / 3;
      for (const [x, y, z] of [[x0, rows[i], z0], [x1, rows[i], z1], [x1, rows[i + 1], z1], [x0, rows[i + 1], z0]]) {
        positions.push(x, y, z); colors.push(...cols[i]);
      }
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return { geometry: g, keepColor: true };
  };
  const stand = [band(X1, ZB, X0, ZB), band(X0, ZB, X0, ZF)];
  plinth(stand, X0 - 0.16, X1 + 0.16, ZB - 0.16, ZF + 0.34, YB);

  // --- Assembly -------------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'skin-section';
  root.add(mesh(mergeParts([{ geometry: frontFace, color: 0xffffff }, { geometry: sideFace, color: 0xffffff }]), standard({ map: faceMap, roughness: 0.74, metalness: 0 })));
  topMap.anisotropy = 8;
  root.add(mesh(mergeParts([{ geometry: topG, color: 0xffffff }]), standard({ map: topMap, bumpMap: topMap, bumpScale: 0.6, roughness: 0.62, metalness: 0 })));
  root.add(organMesh([{ geometry: follicleG, keepColor: true }, ...parts], { roughness: 0.42, metalness: 0 }));
  root.add(organMesh([...lobes], { roughness: 0.46, metalness: 0 }));
  root.add(organMesh(stand, { roughness: 0.66, metalness: 0 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Digestive system
// ---------------------------------------------------------------------------------------------

// A closed loop that fills a grid exactly once and never crosses itself, which is the one property a
// model of coiled gut has to have. Walk round a random spanning tree of a coarse grid, and the path
// that keeps the tree on its left visits every cell of a grid twice as fine. Seeded, so it is the same
// gut each time, and a tree rather than a serpentine so it wanders instead of reading as a radiator.
function gutLoop(cols, rows, seed) {
  const rng = seededRandom(seed);
  const id = (i, j) => i + j * cols;
  const seen = new Uint8Array(cols * rows);
  const links = new Set();
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const stack = [id(0, 0)];
  seen[0] = 1;
  while (stack.length) {
    const here = stack[stack.length - 1];
    const i = here % cols; const j = Math.floor(here / cols);
    const options = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]
      .filter(([a, b]) => a >= 0 && b >= 0 && a < cols && b < rows && !seen[id(a, b)]);
    if (!options.length) { stack.pop(); continue; }
    const [a, b] = options[Math.floor(rng() * options.length)];
    seen[id(a, b)] = 1;
    links.add(key(here, id(a, b)));
    stack.push(id(a, b));
  }
  const linked = (i, j, a, b) => a >= 0 && b >= 0 && a < cols && b < rows && links.has(key(id(i, j), id(a, b)));
  // Fine cell (u, v) sits in coarse cell (u>>1, v>>1). Each step goes round the coarse cell's wall,
  // crossing to a neighbour wherever the tree says the wall is open.
  const nextOf = (u, v) => {
    const i = u >> 1; const j = v >> 1; const cu = u & 1; const cv = v & 1;
    if (cu === 0 && cv === 0) return linked(i, j, i, j - 1) ? [u, v - 1] : [u + 1, v]; // heading along the low side
    if (cu === 1 && cv === 0) return linked(i, j, i + 1, j) ? [u + 1, v] : [u, v + 1];
    if (cu === 1 && cv === 1) return linked(i, j, i, j + 1) ? [u, v + 1] : [u - 1, v];
    return linked(i, j, i - 1, j) ? [u - 1, v] : [u, v - 1];
  };
  const out = [];
  let [u, v] = [0, 0];
  for (let n = 0; n < cols * rows * 4; n++) {
    out.push([u, v]);
    [u, v] = nextOf(u, v);
    if (u === 0 && v === 0) break;
  }
  return out;
}

// Corner cutting, which turns a grid walk into a smooth gut with no overshoot to cross its neighbour.
function chaikin(points, rounds = 2) {
  let p = points;
  for (let r = 0; r < rounds; r++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]; const b = p[i + 1];
      out.push(a.map((v, k) => mix(v, b[k], 0.25)), a.map((v, k) => mix(v, b[k], 0.75)));
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// The large intestine's section is not a circle. Three flat bands of muscle run its whole length and
// gather it into three rows of pouches, so its surface is a function of distance along it AND angle
// round it, which `tube` cannot do. Closed at both ends by a radius going to nothing.
function haustraTube(points, radiusAt, { rows = 280, sides = 24, pouches = 20, pouchFade = () => 1, colorAt } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const C = curve.getSpacedPoints(rows);
  const T = C.map((p, i) => C[Math.min(rows, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize());
  let N = Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const positions = []; const colors = []; const index = [];
  const out = [0, 0, 0];
  const BANDS = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    N = N.clone().addScaledVector(T[i], -N.dot(T[i])).normalize();
    const B = new THREE.Vector3().crossVectors(T[i], N);
    const base = radiusAt(t);
    const along = Math.sin(t * pouches * Math.PI) ** 2;
    const fade = pouchFade(t);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      let band = 1e9;
      for (const b of BANDS) { const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); if (d < band) band = d; }
      const openness = sstep(band, 0.08, 0.55);
      const bulge = 0.84 + (0.16 + 0.3 * along) * openness;
      const r = base * mix(1, bulge, fade);
      const ca = Math.cos(a) * r; const sa = Math.sin(a) * r;
      positions.push(C[i].x + N.x * ca + B.x * sa, C[i].y + N.y * ca + B.y * sa, C[i].z + N.z * ca + B.z * sa);
      colorAt(t, along, openness, fade, out);
      colors.push(out[0], out[1], out[2]);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j; const b = i * sides + j2; const c = (i + 1) * sides + j2; const d = (i + 1) * sides + j;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// The owner faces +Z, so their left is +X: the stomach lies toward +X and the liver toward -X, as in
// the heart. The organs are roughly one and a half times a real adult's, and stand at about the height
// they have in a tall person. The small intestine cannot be its true length in this space, so it is
// two folded sheets of one continuous tube, far shorter than the real thing.
function digestiveSystem() {
  const parts = [];

  // --- Esophagus, stomach and duodenum: one surface ----------------------------------------------
  const ROSE = 0xe36a7f; const ESOPH = 0xdc9a7c; const DUO = 0xef8f55;
  const S = new Sculpt(0.029);
  const TOP = [0.0, 5.84, -0.12];
  const ESO_PATH = [TOP, [0.02, 5.5, -0.13], [0.06, 5.2, -0.1], [0.14, 5.0, -0.05], [0.26, 4.9, -0.01]];
  S.add(curveP(ESO_PATH, [0.085, 0.078, 0.078, 0.085, 0.11], 18), ESOPH);
  // Stomach: fundus up by the esophagus, body down the left, then the J's hook back to the middle.
  const STOMACH = curveP([[0.46, 5.07, 0.0], [0.56, 4.8, 0.02], [0.53, 4.5, 0.04], [0.34, 4.26, 0.06], [0.08, 4.25, 0.06], [-0.12, 4.36, 0.04], [-0.24, 4.47, 0.02]], [0.27, 0.32, 0.31, 0.25, 0.17, 0.12, 0.09], 36);
  S.add(STOMACH, ROSE, { k: 0.1, ck: 0.05 });
  // The pylorus is a real ring of muscle, a visible waist.
  const DUO_PATH = [[-0.24, 4.47, 0.02], [-0.42, 4.47, 0.0], [-0.56, 4.3, -0.01], [-0.58, 4.05, -0.01], [-0.46, 3.9, 0.0], [-0.2, 3.88, -0.02], [0.02, 3.98, -0.04]];
  S.add(curveP(DUO_PATH, [0.075, 0.09, 0.095, 0.095, 0.09, 0.085, 0.08], 26), DUO, { k: 0.03, ck: 0.02 });
  // Sawn flat at the top so the vessel mouth can be fitted.
  const esoDir = [0, 1, 0];
  S.sub({ box: [-1, TOP[1] - 0.04, -1, 1, 7, 1], f: (x, y) => TOP[1] - 0.05 - y });
  const stomachTint = (x, y, z, nx, ny, nz, rgb) => {
    // Oblique muscle fibres on the stomach, and the pale band of the greater curvature's vessels.
    const inStomach = STOMACH.f(x, y, z) < 0.03 ? 1 : 0;
    if (inStomach) {
      const fibre = 0.93 + 0.14 * smoothNoise3((x + y * 0.8) * 3.2, (x - y) * 14, z * 3.2);
      rgb[0] *= fibre; rgb[1] *= fibre; rgb[2] *= fibre;
    } else {
      const m = 0.94 + smoothNoise3(x * 5, y * 5, z * 5) * 0.12;
      rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
    }
  };
  parts.push({ geometry: polygonize(S, { tint: stomachTint, uvScale: 2.2 }), keepColor: true });
  vesselMouth(parts, [TOP[0], TOP[1] + 0.02, TOP[2]], esoDir, 0.085, ESOPH, 0x511c1c, { depth: 0.1, wall: 0.03 });

  // --- The small intestine: a long loop folded into two sheets ------------------------------------
  const R_SI = 0.047;
  // A rectangular grid would give a rectangular gut. The grid is mapped onto a rounded patch and then
  // warped by a slow noise, too gently to make two neighbouring runs touch, and each run rides up and
  // over its neighbours in depth.
  const sheetPath = (seed, zOf) => {
    const COLS = 12; const ROWS = 8;
    const cells = gutLoop(COLS / 2, ROWS / 2, seed);
    return cells.map(([u, v], i) => {
      const gx = (u / (COLS - 1)) * 2 - 1; const gy = (v / (ROWS - 1)) * 2 - 1;
      const rx = gx * Math.sqrt(1 - (gy * gy) / 2.4); const ry = gy * Math.sqrt(1 - (gx * gx) / 2.4);
      const wx = (smoothNoise3(rx * 1.3 + seed, ry * 1.3, 2.1) - 0.5) * 0.11;
      const wy = (smoothNoise3(rx * 1.3, ry * 1.3 + seed, 7.3) - 0.5) * 0.11;
      const x = rx * 0.64 + wx; const y = 3.55 + ry * 0.36 + wy;
      return [x, y, zOf(x, y, i)];
    });
  };
  const frontSheet = sheetPath(8807, (x, y, i) => 0.05 + 0.14 * Math.sqrt(Math.max(0.03, 1 - (x / 0.76) ** 2 - ((y - 3.55) / 0.46) ** 2)) + Math.sin(i * 0.9) * 0.022);
  const backSheet = sheetPath(1913, (x, y, i) => -0.11 + Math.sin(i * 0.8 + 1) * 0.02);
  const duoEnd = DUO_PATH[DUO_PATH.length - 1];
  const CECUM_IN = [-0.66, 3.55, 0.0];
  // Rotate each closed loop so it opens at the point nearest where it is entered.
  const openNear = (loop, p) => {
    let best = 0; let bd = 1e9;
    loop.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
    return [...loop.slice(best), ...loop.slice(0, best)];
  };
  const front = openNear(frontSheet, duoEnd);
  const backOpen = openNear(backSheet, front[front.length - 1]);
  const gutPath = chaikin([
    [duoEnd[0] - 0.02, duoEnd[1] + 0.01, duoEnd[2]],
    [duoEnd[0] + 0.06, duoEnd[1] - 0.05, duoEnd[2] + 0.06],
    ...front,
    ...backOpen,
    CECUM_IN,
  ], 3);
  const gutLength = gutPath.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - gutPath[i - 1][0], p[1] - gutPath[i - 1][1], p[2] - gutPath[i - 1][2]) : 0), 0);
  const gutG = tube(gutPath, R_SI, { sides: 9, steps: Math.round(gutLength / 0.034), round: 2 });
  {
    const P = gutG.attributes.position;
    const rows = P.count / 9;
    tintVertices(gutG, (x, y, z, out, i) => {
      const row = Math.floor(i / 9) / rows;
      const c = lin(0xf19c8a); const d = lin(0xe9b07e);
      const k = 0.94 + 0.1 * Math.sin(row * 340) + 0.05 * smoothNoise3(x * 8, y * 8, z * 8);
      out[0] = mix(c[0], d[0], row) * k; out[1] = mix(c[1], d[1], row) * k; out[2] = mix(c[2], d[2], row) * k;
    });
  }
  parts.push({ geometry: gutG, keepColor: true });

  // --- The large intestine: the frame round everything --------------------------------------------
  const COLON_PATH = [
    [-0.82, 3.38, 0.03], [-0.84, 3.6, 0.03], [-0.87, 3.92, 0.02], [-0.84, 4.14, 0.05], [-0.7, 4.2, 0.12], [-0.48, 4.06, 0.22], [-0.24, 3.94, 0.27],
    [0.1, 3.9, 0.28], [0.42, 3.97, 0.24], [0.7, 4.14, 0.12], [0.88, 4.33, 0.0], [1.0, 4.3, -0.07], [1.02, 4.06, -0.08], [0.96, 3.75, -0.06], [0.88, 3.42, -0.03],
    [0.72, 3.2, 0.06], [0.42, 3.1, 0.12], [0.26, 3.2, 0.06], [0.08, 3.22, -0.07], [0.0, 3.1, -0.1], [0.0, 2.98, -0.1], [0.0, 2.86, -0.09],
  ];
  const OCHRE = lin(0xb98a3e); const OCHRE_DARK = lin(0x8a6128); const BAND = lin(0xdcc28a); const RECTUM = lin(0xa86c44);
  const colonG = haustraTube(COLON_PATH, (t) => {
    const cecum = 1 + 0.26 * (1 - sstep(t, 0.0, 0.08));
    const narrowing = mix(1, 0.72, sstep(t, 0.55, 0.82));
    const close = Math.sqrt(sstep(t, 0, 0.02));
    return 0.145 * cecum * narrowing * mix(1, 0.72, sstep(t, 0.94, 1)) * close;
  }, {
    rows: 250,
    sides: 20,
    pouches: 21,
    pouchFade: (t) => 1 - sstep(t, 0.84, 0.9),
    colorAt: (t, along, openness, fade, out) => {
      const rect = sstep(t, 0.84, 0.9);
      for (let k = 0; k < 3; k++) {
        const pouch = mix(OCHRE_DARK[k], OCHRE[k], along);
        const c = mix(BAND[k], pouch, sstep(openness, 0, 0.22));
        out[k] = mix(c, RECTUM[k], rect);
      }
    },
  });
  parts.push({ geometry: colonG, keepColor: true });
  // The anal canal: the end of the tract, sawn with a real opening.
  vesselMouth(parts, [0, 2.88, -0.09], [0, -1, 0], 0.075, RECTUM, 0x2f120c, { depth: 0.08, wall: 0.025 });
  // The appendix, a little worm hanging off the blind end of the cecum.
  parts.push({ geometry: tube([[-0.82, 3.34, 0.03], [-0.86, 3.2, 0.06], [-0.78, 3.1, 0.08], [-0.7, 3.09, 0.07]], [0.05, 0.034, 0.03, 0.026], { sides: 9, steps: 24, round: 2 }), color: 0xcf9040 });

  // --- The liver, gallbladder and pancreas ---------------------------------------------------------
  const LIVER = 0x7d1c1e;
  const L = new Sculpt(0.038);
  // A big domed right lobe, a left lobe tapering across the middle to a blunt point, and a groove
  // between them. A lozenge has no lobes, so the two are different shapes rather than one stretched.
  L.add(ellipsoidP([-0.46, 4.74, 0.04], [0.6, 0.42, 0.42]), LIVER);
  L.add(curveP([[-0.28, 4.88, 0.12], [0.02, 4.9, 0.16], [0.3, 4.93, 0.15], [0.47, 4.95, 0.12]], [0.25, 0.2, 0.115, 0.04], 14), LIVER, { k: 0.14 });
  // Its underside is cut hollow, leaving a sharp lower edge along the front.
  L.sub(ellipsoidP([-0.26, 4.2, -0.2], [0.96, 0.42, 0.56]), null, { k: 0.05 });
  // The notch for the gallbladder, in that edge.
  L.sub(ellipsoidP([-0.34, 4.42, 0.32], [0.1, 0.13, 0.14]), null, { k: 0.05 });
  // The groove of the falciform ligament divides the two lobes on top.
  L.sub(curveP([[-0.17, 5.32, 0.2], [-0.15, 5.0, 0.42], [-0.14, 4.62, 0.46]], 0.026, 8), null, { k: 0.07 });
  L.map((d, x, y, z) => d + (smoothNoise3(x * 3, y * 3, z * 3) - 0.5) * 0.022);
  const liverG = polygonize(L, {
    uvScale: 2,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const k = 0.92 + smoothNoise3(x * 7, y * 7, z * 7) * 0.2 + ny * 0.05;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });
  parts.push({ geometry: liverG, keepColor: true });

  const GREEN = 0x3e9d3c;
  const G = new Sculpt(0.022);
  const GB_NECK = [-0.3, 4.54, 0.16]; const GB_FUNDUS = [-0.36, 4.3, 0.28];
  G.add(curveP([GB_NECK, [-0.33, 4.42, 0.22], GB_FUNDUS], [0.05, 0.09, 0.105], 10), GREEN);
  // The bile duct runs from the neck of the gallbladder and the liver down to the duodenum.
  G.add(curveP([GB_NECK, [-0.36, 4.5, 0.09], [-0.44, 4.36, 0.07], [-0.51, 4.22, 0.06]], [0.032, 0.032, 0.032, 0.032], 12), 0x4fb24a, { k: 0.02 });
  parts.push({ geometry: polygonize(G, { uvScale: 2 }), keepColor: true });

  // Pancreas: head inside the duodenum's C, then body and tail running up behind the stomach.
  const P = new Sculpt(0.032);
  const PANCREAS = 0xf0ca6c;
  P.add(curveP([[-0.42, 4.08, -0.06], [-0.2, 4.1, -0.16], [0.14, 4.16, -0.22], [0.5, 4.3, -0.25], [0.78, 4.48, -0.25]], [0.17, 0.12, 0.105, 0.09, 0.055], 20), PANCREAS);
  P.map((d, x, y, z) => d + (smoothNoise3(x * 15, y * 15, z * 15) - 0.5) * 0.05);
  parts.push({ geometry: polygonize(P, { uvScale: 2, tint: (x, y, z, nx, ny, nz, rgb) => { const k = 0.82 + smoothNoise3(x * 15, y * 15, z * 15) * 0.32; rgb[0] *= k; rgb[1] *= k; rgb[2] *= k; } }), keepColor: true });

  // --- The stand: a column behind everything, with four arms reaching forward ----------------------
  const stand = [];
  stand.push({ geometry: lathe([[0, 0], [1.22, 0], [1.22, 0.12], [1.2, 0.15], [1.13, 0.17], [1.1, 0.22], [1.0, 0.26], [0.72, 0.3], [0, 0.32]], 64), color: 0x5b3a24 });
  const BRASS = 0xc29a4e;
  const CZ = -0.66;
  // The column stands at the back of the base, so it never passes through the middle of the organs.
  stand.push({ geometry: lathe([[0, 0.2], [0.2, 0.2], [0.2, 0.31], [0.13, 0.42], [0.095, 0.6], [0.088, 3.0], [0.08, 5.56], [0.07, 5.6], [0, 5.62]], 20), position: [0, 0, CZ], color: BRASS });
  stand.push({ geometry: lathe([[0, 5.56], [0.095, 5.56], [0.11, 5.6], [0.095, 5.66], [0, 5.7]], 18), position: [0, 0, CZ], color: BRASS });
  const arm = (y0, to) => {
    const from = [0, y0, CZ];
    const mid = [to[0] * 0.5, mix(y0, to[1], 0.3), mix(CZ, to[2], 0.5)];
    stand.push({ geometry: tube([from, mid, to], [0.042, 0.032, 0.03], { sides: 10, steps: 14, round: 2 }), color: BRASS });
    stand.push({ geometry: lathe([[0, -0.04], [0.04, -0.04], [0.058, 0], [0.04, 0.05], [0, 0.06]], 14), position: from, rotation: [Math.PI / 2, 0, 0], color: BRASS });
  };
  arm(5.5, [0.02, 5.48, -0.13]); // the esophagus
  arm(4.72, [0.46, 4.7, -0.14]); // the back of the stomach
  arm(3.6, [0.0, 3.56, -0.17]); // the back of the intestines
  arm(3.06, [0.0, 3.03, -0.14]); // the rectum

  const root = new THREE.Group();
  root.name = 'digestive-system';
  root.add(organMesh(parts, { roughness: 0.4, metalness: 0, bumpMap: grainBump(61, { dots: 1400, contrast: 0.3 }), bumpScale: 0.12 }));
  root.add(organMesh(stand, { roughness: 0.42, metalness: 0.2 }));
  return root;
}

export const BUILDERS = {
  'human-eye': humanEye,
  'human-ear': humanEar,
  'tooth-section': toothSection,
  'skin-section': skinSection,
  'digestive-system': digestiveSystem,
};
