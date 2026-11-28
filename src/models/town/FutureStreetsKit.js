import * as THREE from 'three';
import { standard, seededRandom, canvasTexture } from '../../PropKit.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { outward } from '../ModelKit.js';

// Private helpers for builders/FutureStreets.js. The plan solids are copied from CityStreets.js on
// purpose (they are not exported there), because the smart road and the smart intersection have to
// build the city road's cross section from the very same arithmetic to meet it with no step.

// ---------------------------------------------------------------------------------------------
// A small solid-modelling soup: triangles oriented by an outward hint, flat faces.
// ---------------------------------------------------------------------------------------------
export class Solid {
  constructor() { this.p = []; }

  tri(a, b, c, want = null) {
    if (want) {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { const t = b; b = c; c = t; }
    }
    this.p.push(...a, ...b, ...c);
  }

  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.p.length / 3) * 2), 2));
    return g;
  }
}

export function signedArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function edgeOut(p, q, area) {
  const dx = q[0] - p[0]; const dy = q[1] - p[1];
  const s = area > 0 ? 1 : -1;
  return [dy * s, -dx * s];
}

export function earcut(pts) {
  return THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
}

// A plan outline [[x, z]] stood up from bottom heights to top heights (numbers, or arrays per point).
export function planPrism(s, pts, y0, y1, topTris = null) {
  const n = pts.length;
  const area = signedArea2(pts);
  const b = (i) => (Array.isArray(y0) ? y0[i] : y0);
  const t = (i) => (Array.isArray(y1) ? y1[i] : y1);
  const tris = topTris ?? earcut(pts);
  for (const [i, j, k] of tris) {
    s.tri([pts[i][0], t(i), pts[i][1]], [pts[j][0], t(j), pts[j][1]], [pts[k][0], t(k), pts[k][1]], [0, 1, 0]);
    s.tri([pts[i][0], b(i), pts[i][1]], [pts[j][0], b(j), pts[j][1]], [pts[k][0], b(k), pts[k][1]], [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = edgeOut(pts[i], pts[j], area);
    s.quad([pts[i][0], b(i), pts[i][1]], [pts[j][0], b(j), pts[j][1]], [pts[j][0], t(j), pts[j][1]], [pts[i][0], t(i), pts[i][1]], [o[0], 0, o[1]]);
  }
}

export function boxS(s, x0, x1, y0, y1, z0, z1) {
  planPrism(s, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1);
}

// A profile [[d, y]] swept along a plan path [[x, z]] whose per-point normals point the way d grows.
export function planSweep(s, path, normals, profile) {
  const pa = signedArea2(profile);
  const at = (i, k) => [path[i][0] + normals[i][0] * profile[k][0], profile[k][1], path[i][1] + normals[i][1] * profile[k][0]];
  const m = profile.length;
  for (let i = 0; i < path.length - 1; i++) {
    const nx = (normals[i][0] + normals[i + 1][0]) / 2; const nz = (normals[i][1] + normals[i + 1][1]) / 2;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const o = edgeOut(profile[k], profile[k2], pa);
      s.quad(at(i, k), at(i + 1, k), at(i + 1, k2), at(i, k2), [nx * o[0], o[1], nz * o[0]]);
    }
  }
  const tris = earcut(profile);
  const last = path.length - 1;
  const t0 = [path[0][0] - path[1][0], 0, path[0][1] - path[1][1]];
  const t1 = [path[last][0] - path[last - 1][0], 0, path[last][1] - path[last - 1][1]];
  for (const [a, b, c] of tris) {
    s.tri(at(0, a), at(0, b), at(0, c), t0);
    s.tri(at(last, a), at(last, b), at(last, c), t1);
  }
}

// World-aligned planar UVs in feet, by which way each face points.
export function planarUV(g, tile) {
  const P = g.attributes.position; const N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(N.getX(i)); const ay = Math.abs(N.getY(i)); const az = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export function part(solid, color) { return { geometry: solid.geometry(), color }; }

// A plan [[x, y]] extruded along +Z from z0 to z1 as a closed solid.
export function prismXY(pts, z0, z1) {
  const s = new Solid();
  planPrism(s, pts.map(([x, y]) => [x, -y]), z0, z1);
  const out = new Solid();
  for (let i = 0; i < s.p.length; i += 3) out.p.push(s.p[i], -s.p[i + 2], s.p[i + 1]);
  return out.geometry();
}

export function creased(g, degrees = 32) {
  return toCreasedNormals(g, degrees * Math.PI / 180);
}

export function roundRect(hw, hh, r, steps = 4) {
  const pts = [];
  const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, Math.PI / 2], [-(hw - r), -(hh - r), Math.PI], [hw - r, -(hh - r), -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// Every uv of a geometry pinned to one texel: a glow part that is not a screen reads the atlas's
// white corner, so the map multiplies its vertex colour by one.
export function pinUV(g, u = 0.995, v = 0.995) {
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = u; uv[i * 2 + 1] = v; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// A closed loft up Y of superellipse sections. stations: { y, hw, hd, x?, z?, p? }.
// ---------------------------------------------------------------------------------------------
export function loftY(stations, { sides = 32, p = 4 } = {}) {
  const pos = []; const idx = [];
  for (const st of stations) {
    const e = 2 / (st.p ?? p);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a); const s = Math.sin(a);
      pos.push((st.x ?? 0) + st.hw * Math.sign(c) * Math.abs(c) ** e, st.y, (st.z ?? 0) + st.hd * Math.sign(s) * Math.abs(s) ** e);
    }
  }
  const rows = stations.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      idx.push(i * sides + j, (i + 1) * sides + j, (i + 1) * sides + j2, i * sides + j, (i + 1) * sides + j2, i * sides + j2);
    }
  }
  const b = pos.length / 3; const s0 = stations[0];
  pos.push(s0.x ?? 0, s0.y, s0.z ?? 0);
  const t = pos.length / 3; const s1 = stations[rows - 1];
  pos.push(s1.x ?? 0, s1.y, s1.z ?? 0);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    idx.push(b, j2, j);
    idx.push(t, (rows - 1) * sides + j, (rows - 1) * sides + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// ---------------------------------------------------------------------------------------------
// Near-white tiles, multiplied by vertex colour.
// ---------------------------------------------------------------------------------------------
function wrapDots(ctx, w, h, x, y, r, style) {
  ctx.fillStyle = style;
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// The smart road's surface: a smooth resin over fine aggregate, with a faint hexagonal weave of
// embedded sensor wire. A 4ft tile, so copies 20ft apart continue it.
export function smartSurfaceTexture(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f2f3f6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      const a = 0.025 + rng() * 0.03;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 16 + rng() * 34, rng() < 0.5 ? `rgba(180,184,196,${a})` : `rgba(255,255,255,${a * 2})`);
    }
    for (let i = 0; i < 1400; i++) {
      const r = 0.4 + rng() * 0.8;
      const g = 190 + (rng() * 50 | 0);
      wrapDots(ctx, w, h, rng() * w, rng() * h, r, rng() < 0.6 ? `rgba(255,255,255,${0.35 + rng() * 0.4})` : `rgba(${g},${g},${g + 8},${0.15 + rng() * 0.2})`);
    }
    // A hex weave of 4 cells across: the tile is 4ft, so a cell is a foot.
    ctx.strokeStyle = 'rgba(205,212,228,0.55)';
    ctx.lineWidth = 1.2;
    const s = w / 4; const hh = s * Math.sqrt(3) / 2;
    for (let row = -1; row <= Math.ceil(h / hh) + 1; row++) {
      for (let col = -1; col <= 5; col++) {
        const cx = col * s + (row % 2 ? s / 2 : 0); const cy = row * hh;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const a = Math.PI / 6 + (k / 6) * Math.PI * 2;
          const px = cx + Math.cos(a) * s * 0.42; const py = cy + Math.sin(a) * s * 0.42;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Solar paving: a 5ft tile holding four 2.5ft glass tiles, each a 4 x 4 grid of cells, with a pale
// grout between them. Near white, so the vertex colour decides the blue.
export function solarTileTexture(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#eef0f6';
    ctx.fillRect(0, 0, w, h);
    const tile = w / 2; const grout = 5;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const x0 = tx * tile + grout / 2; const y0 = ty * tile + grout / 2; const s = tile - grout;
        const cell = s / 4;
        for (let cy = 0; cy < 4; cy++) {
          for (let cx = 0; cx < 4; cx++) {
            const v = 200 + (rng() * 18 | 0);
            ctx.fillStyle = `rgb(${v - 10},${v - 4},${v + 14})`;
            ctx.fillRect(x0 + cx * cell + 1.2, y0 + cy * cell + 1.2, cell - 2.4, cell - 2.4);
          }
        }
        // Two thin silver bus bars across each tile.
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        for (const f of [0.33, 0.66]) ctx.fillRect(x0, y0 + s * f, s, 1);
      }
    }
    // Grout: lighter than the glass, split across the tile seam.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, grout / 2); ctx.fillRect(0, h - grout / 2, w, grout / 2);
    ctx.fillRect(0, 0, grout / 2, h); ctx.fillRect(w - grout / 2, 0, grout / 2, h);
    ctx.fillRect(tile - grout / 2, 0, grout, h); ctx.fillRect(0, tile - grout / 2, w, grout);
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Concrete with a tooled joint every tile (the city kit's tile, lightened a touch).
export function concreteTexture(seed, { joints = true } = {}) {
  const rng = seededRandom(seed);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f1efea';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      const a = 0.03 + rng() * 0.05;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 18 + rng() * 40, rng() < 0.55 ? `rgba(150,140,128,${a})` : `rgba(255,255,255,${a})`);
    }
    for (let i = 0; i < 1500; i++) {
      const style = rng() < 0.5 ? `rgba(120,112,100,${0.1 + rng() * 0.2})` : `rgba(255,255,255,${0.2 + rng() * 0.4})`;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 0.5 + rng() * 1.2, style);
    }
    if (joints) {
      ctx.fillStyle = 'rgba(80,76,70,0.75)';
      ctx.fillRect(0, 0, 2, h); ctx.fillRect(w - 2, 0, 2, h);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(2, 0, 3, h); ctx.fillRect(w - 5, 0, 3, h);
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function texturedMaterial(texture, { roughness = 0.8, bump = 0.4, metalness = 0 } = {}) {
  return standard({ vertexColors: true, map: texture, bumpMap: texture, bumpScale: bump, roughness, metalness });
}

// Unlit, vertex-coloured: every lit part of a model in one mesh. It casts no shadow, since a light
// strip a few hundredths of a foot thick only shadows itself in streaks.
export function glowMaterial(extra = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, ...extra });
}
