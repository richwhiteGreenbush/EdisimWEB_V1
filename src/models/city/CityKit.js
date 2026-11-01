import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { lathe, alongMatrix } from '../ModelKit.js';
import { Batch, noise2, blobGeometry, TAU } from '../geo/GeoKit.js';
import { reducedMotion } from '../../Settings.js';

// The kit behind the City Dioramas: a city on a walnut base, the size of a large table, that a
// student walks round and looks down into. North is at the back of every one of them, and the plan
// is laid out from real latitudes and longitudes at one horizontal scale, so where things are is
// true even though how tall they are is not. A card always says which is which.
//
// ONE DESCRIPTION USED THREE TIMES. A coast, a road or a park is declared once in feet and then does
// three jobs: it is painted on the map, it is stamped into an occupancy mask, and it turns into solid
// land and quay walls. So a building cannot stand in a river or in the middle of Broadway, and no
// list of keep-out rectangles has to be remembered.
//
// SIX MESHES, whatever the city: the base and every landmark solid (vertex colour), the land (a
// painted map), the water, the facades (a near-white window tile times vertex colour, UVs in feet, so
// one tile serves a whole city's masonry), the labels, and the one thing that moves. Six is the
// catalogue's budget and thousands of buildings fit in it, because a building is ten triangles in one
// merged mesh and not a mesh of its own.

export { TAU };

export const LAND_Y = 0.9;
export const WATER_Y = LAND_Y - 0.13;
const RIM = 0.32;
const WALNUT = 0x80583a;
const WALNUT_DARK = 0x5c3f2a;
const QUAY = 0x8f8778;

const KM_PER_DEG_LAT = 110.95;
const KM_PER_DEG_LON_EQ = 111.32;

export const pathLength = (path) => {
  let n = 0;
  for (let i = 1; i < path.length; i += 1) n += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return n;
};

// A smooth run of points through hand-placed control points. A coast traced by eye has corners no
// real one has, and a river without its curve is a canal.
export function smooth(points, perSpan = 6) {
  if (points.length < 3) return points.map((p) => [p[0], p[1]]);
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getPoints((points.length - 1) * perSpan).map((p) => [p.x, p.z]);
}

// One side of a ribbon: the bank of a river `width` wide (a number or a function of 0..1 along it).
// side = 1 is to the right of the direction of travel as seen from above with north at the back.
export function bank(path, width, side) {
  const out = [];
  for (let i = 0; i < path.length; i += 1) {
    const a = path[Math.max(0, i - 1)]; const b = path[Math.min(path.length - 1, i + 1)];
    const dx = b[0] - a[0]; const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const w = typeof width === 'function' ? width(i / (path.length - 1)) : width;
    out.push([path[i][0] - (dz / len) * side * w / 2, path[i][1] + (dx / len) * side * w / 2]);
  }
  return out;
}

export const inPoly = (poly, x, z) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i]; const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const signedArea = (poly) => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, z0] = poly[i]; const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
};
// Everything below assumes one winding, so an outline written either way round still faces outward.
const wound = (poly) => (signedArea(poly) < 0 ? [...poly].reverse() : poly);

const rectOutline = (x, z, w, d, yaw) => {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([lx, lz]) => [x + c * lx + s * lz, z - s * lx + c * lz]);
};

// ---------------------------------------------------------------------------------------------
// Facades. Near-white, so the vertex colour supplies the hue: one tile, a whole city's stone.
// ---------------------------------------------------------------------------------------------
function facadeTile({ feet = [0.32, 0.26], cols = 8, rows = 7, win = '#48525c', wall = '#f3f0e8', lit = 0.14, winW = 0.56, winH = 0.62, band = 0, seed = 5 }) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    const cw = W / cols; const ch = H / rows;
    for (let r = 0; r < rows; r += 1) {
      if (band) {
        ctx.fillStyle = `rgba(90,86,78,${band})`;
        ctx.fillRect(0, r * ch + ch - 3, W, 3);
      }
      for (let c = 0; c < cols; c += 1) {
        const on = rng() < lit;
        ctx.fillStyle = on ? '#efd9a0' : win;
        ctx.fillRect(c * cw + cw * (1 - winW) / 2, r * ch + ch * (1 - winH) / 2, cw * winW, ch * winH);
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // A point on the pier between two windows. A constant UV has no derivative, so it samples the top
  // mip and stays pure white at any distance: a roof must not wear a window pattern.
  return { texture, feet, flat: [0.002, 0.002] };
}

class Facades {
  constructor(tile) {
    this.tile = tile;
    this.pos = []; this.nor = []; this.uv = []; this.col = [];
    this.tris = 0;
  }

  _tri(a, b, c, color, uva, uvb, uvc) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const [p, t] of [[a, uva], [b, uvb], [c, uvc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(t[0], t[1]);
      this.col.push(color[0], color[1], color[2]);
    }
    this.tris += 1;
  }

  // A wall between two edges of two outlines (one above the other), windowed.
  _wall(p, q, y0, y1, pTop, qTop, color, run, windows) {
    const [fw, fh] = this.tile.feet;
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const u0 = run / fw; const u1 = (run + L) / fw; const v0 = y0 / fh; const v1 = y1 / fh;
    const F = this.tile.flat;
    const uvs = windows ? [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] : [F, F, F, F];
    const a = [p[0], y0, p[1]]; const b = [pTop[0], y1, pTop[1]]; const c = [qTop[0], y1, qTop[1]]; const d = [q[0], y0, q[1]];
    this._tri(a, b, c, color, uvs[0], uvs[1], uvs[2]);
    this._tri(a, c, d, color, uvs[0], uvs[2], uvs[3]);
    return run + L;
  }

  // A solid standing on an outline. `top` narrows it as it rises, which is how a setback, a mansard
  // and a tapering skyscraper are all the same call.
  prism(outline, y0, y1, color, { top = null, roof = null, windows = true, cap = true } = {}) {
    const low = wound(outline);
    const reversed = low !== outline;
    const high = top ? (reversed ? [...top].reverse() : top) : low;
    let run = 0;
    for (let i = 0; i < low.length; i += 1) {
      const j = (i + 1) % low.length;
      run = this._wall(low[i], low[j], y0, y1, high[i], high[j], color, run, windows);
    }
    if (!cap) return;
    let cx = 0; let cz = 0;
    for (const p of high) { cx += p[0]; cz += p[1]; }
    cx /= high.length; cz /= high.length;
    const F = this.tile.flat;
    const capColor = roof ?? color;
    for (let i = 0; i < high.length; i += 1) {
      const j = (i + 1) % high.length;
      this._tri([cx, y1, cz], [high[j][0], y1, high[j][1]], [high[i][0], y1, high[i][1]], capColor, F, F, F);
    }
  }

  // Two slopes and two gable ends. The ridge runs along local Z.
  gable(x, z, w, d, yaw, y0, rise, color, wallColor) {
    const c = Math.cos(yaw); const s = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + c * lx + s * lz, y0 + ly, z - s * lx + c * lz];
    const W = w / 2; const D = d / 2;
    const F = this.tile.flat;
    const a = P(-W, 0, D); const b = P(W, 0, D); const e = P(W, 0, -D); const f = P(-W, 0, -D);
    const r0 = P(0, rise, D); const r1 = P(0, rise, -D);
    this._tri(b, e, r1, color, F, F, F); this._tri(b, r1, r0, color, F, F, F);
    this._tri(f, a, r0, color, F, F, F); this._tri(f, r0, r1, color, F, F, F);
    this._tri(a, b, r0, wallColor, F, F, F);
    this._tri(e, f, r1, wallColor, F, F, F);
  }

  mesh(params = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return mesh(g, standard({ map: this.tile.texture, vertexColors: true, roughness: 0.78, metalness: 0, ...params }));
  }
}

// ---------------------------------------------------------------------------------------------
// A frame: landmark coordinates in display feet, about one point, turned about the vertical.
// ---------------------------------------------------------------------------------------------
class Frame {
  constructor(city, x, z, { s = 1, yaw = 0, y = LAND_Y } = {}) {
    Object.assign(this, { city, x, z, s, yaw, y });
    this.c = Math.cos(yaw); this.sn = Math.sin(yaw);
  }

  p(lx, ly, lz) {
    const { s, c, sn } = this;
    return [this.x + (c * lx + sn * lz) * s, this.y + ly * s, this.z + (-sn * lx + c * lz) * s];
  }

  // The floor plan a landmark occupies, so nothing is built on it.
  reserve(w, d, margin = 0.06) {
    const m = this.city;
    m.reservePoly(rectOutline(this.x, this.z, (w + margin * 2) * this.s, (d + margin * 2) * this.s, this.yaw));
    return this;
  }

  box(lx, ly, lz, w, h, d, color, lyaw = 0) {
    const { s } = this;
    this.city.b.add(new THREE.BoxGeometry(w * s, h * s, d * s), color, { position: this.p(lx, ly + h / 2, lz), rotation: [0, this.yaw + lyaw, 0] });
    return this;
  }

  cyl(lx, ly, lz, rTop, rBot, h, color, seg = 10) {
    const { s } = this;
    this.city.b.add(new THREE.CylinderGeometry(rTop * s, rBot * s, h * s, seg), color, { position: this.p(lx, ly + h / 2, lz), rotation: [0, this.yaw, 0] });
    return this;
  }

  cone(lx, ly, lz, r, h, color, seg = 10) {
    return this.cyl(lx, ly, lz, 0, r, h, color, seg);
  }

  ball(lx, ly, lz, r, color, seg = 10, sy = 1) {
    const { s } = this;
    this.city.b.add(new THREE.SphereGeometry(r * s, seg, Math.max(5, seg >> 1)), color, { position: this.p(lx, ly, lz), scale: [1, sy, 1], rotation: [0, this.yaw, 0] });
    return this;
  }

  // Bottom-up, axis to axis, in display feet relative to its own base.
  lathe(lx, ly, lz, profile, color, seg = 18, sz = 1) {
    const { s } = this;
    this.city.b.add(lathe(profile.map(([r, h]) => [r * s, h * s]), seg), color, { position: this.p(lx, ly, lz), rotation: [0, this.yaw, 0], scale: [1, 1, sz] });
    return this;
  }

  // An onion, a saucer or a hemisphere: a closed lathe from a ring of radius r, h tall.
  dome(lx, ly, lz, r, h, color, seg = 16, onion = 0) {
    const profile = [[0, 0], [r, 0]];
    const N = 8;
    for (let i = 1; i <= N; i += 1) {
      const t = i / N;
      const a = (t * Math.PI) / 2;
      let rr = r * Math.cos(a);
      if (onion) rr = r * (Math.cos(a) * (1 - onion) + onion * Math.pow(Math.max(0, 1 - t), 1.5) * (1 + 0.85 * Math.sin(t * Math.PI)));
      profile.push([Math.max(0.001, rr), h * Math.sin(a) ** (onion ? 0.9 : 1)]);
    }
    profile.push([0, h]);
    return this.lathe(lx, ly, lz, profile, color, seg);
  }

  bar(a, b, r, color, sides = 4) {
    const { s } = this;
    const A = this.p(...a); const B = this.p(...b);
    const { m, len } = alongMatrix(A, B);
    if (len < 1e-5) return this;
    const g = new THREE.CylinderGeometry(r * s, r * s, len, sides, 1, true);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, len / 2);
    g.applyMatrix4(m);
    this.city.b.add(g, color);
    return this;
  }

  // Walls with windows on them, in the facade mesh.
  block(lx, ly, lz, w, h, d, color, { lyaw = 0, top = null, roof = null, windows = true } = {}) {
    const { s } = this;
    const [wx, , wz] = this.p(lx, 0, lz);
    const y0 = this.y + ly * s;
    const outline = rectOutline(wx, wz, w * s, d * s, this.yaw + lyaw);
    const upper = top ? rectOutline(wx, wz, top[0] * s, top[1] * s, this.yaw + lyaw) : null;
    this.city.f.prism(outline, y0, y0 + h * s, lin(color), { top: upper, roof: roof === null ? null : lin(roof), windows });
    return this;
  }

  // Any outline, in the frame's own coordinates.
  outline(points, ly, h, color, { top = null, roof = null, windows = true } = {}) {
    const { s } = this;
    const world = (list) => list.map(([lx, lz]) => { const q = this.p(lx, 0, lz); return [q[0], q[2]]; });
    const y0 = this.y + ly * s;
    this.city.f.prism(world(points), y0, y0 + h * s, lin(color), { top: top ? world(top) : null, roof: roof === null ? null : lin(roof), windows });
    return this;
  }

  // A square at the base turning into a square at 45 degrees at the top, in eight triangles: how One
  // World Trade Center and a few others get their facets. Each triangle is checked against the axis
  // rather than trusted, because a wrong winding here reads as a dark tower and not a missing one.
  antiprism(lx, ly, lz, rBase, rTop, h, color, { turn = 0, flat = true } = {}) {
    const { s } = this;
    const [cx, , cz] = this.p(lx, 0, lz);
    const col = lin(color);
    const f = this.city.f;
    const y0 = this.y + ly * s; const y1 = y0 + h * s;
    const base = []; const top = [];
    for (let i = 0; i < 4; i += 1) {
      const a = this.yaw + turn + Math.PI / 4 + (i * TAU) / 4;
      const b = a + Math.PI / 4;
      base.push([cx + Math.sin(a) * rBase * s, y0, cz + Math.cos(a) * rBase * s]);
      top.push([cx + Math.sin(b) * rTop * s, y1, cz + Math.cos(b) * rTop * s]);
    }
    const [fw, fh] = f.tile.feet;
    const face = (A, B, C, down) => {
      const ux = B[0] - A[0]; const uz = B[2] - A[2]; const uy = B[1] - A[1];
      const vx = C[0] - A[0]; const vz = C[2] - A[2]; const vy = C[1] - A[1];
      const nx = uy * vz - uz * vy; const nz = ux * vy - uy * vx;
      const mx = (A[0] + B[0] + C[0]) / 3 - cx; const mz = (A[2] + B[2] + C[2]) / 3 - cz;
      const uvOf = (P) => [(((P[0] - cx) * Math.cos(this.yaw) - (P[2] - cz) * Math.sin(this.yaw)) + ((P[2] - cz) * Math.cos(this.yaw) + (P[0] - cx) * Math.sin(this.yaw))) / fw, P[1] / fh];
      const tone = down ? col.map((v) => v * 0.8) : col;
      const F = f.tile.flat;
      const uvA = flat ? F : uvOf(A); const uvB = flat ? F : uvOf(B); const uvC = flat ? F : uvOf(C);
      if (nx * mx + nz * mz >= 0) f._tri(A, B, C, tone, uvA, uvB, uvC);
      else f._tri(A, C, B, tone, uvA, uvC, uvB);
    };
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      face(base[i], base[j], top[i], false);
      face(top[i], top[j], base[j], true);
    }
    return this;
  }

  gable(lx, ly, lz, w, d, rise, color, wallColor, lyaw = 0) {
    const { s } = this;
    const [wx, , wz] = this.p(lx, 0, lz);
    this.city.f.gable(wx, wz, w * s, d * s, this.yaw + lyaw, this.y + ly * s, rise * s, lin(color), lin(wallColor ?? color));
    return this;
  }
}

const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ---------------------------------------------------------------------------------------------
// The city
// ---------------------------------------------------------------------------------------------
export class City {
  /**
   * @param w,d      the plan, in feet
   * @param lat,lon  the point at the middle of the plan
   * @param km       kilometres per foot of plan
   */
  constructor({ w = 16, d = 16, lat, lon, km, seed = 1, tile = {}, landColor = '#c9c3b4', waterColor = '#3f7fa8', waterDeep = '#2d6690', title, subtitle }) {
    Object.assign(this, { w, d, lat, lon, km, seed, landColor, waterColor, waterDeep, title, subtitle });
    this.rng = seededRandom(seed);
    this.b = new Batch();
    this.f = new Facades(facadeTile(tile));
    this.mover_ = null;
    this.rotor_ = null;
    this.lands = [];
    this.grounds = [];
    this.parks = [];
    this.plazas = [];
    this.roads = [];
    this.lines = [];
    this.halos = [];
    this.landText = [];
    this.waterText = [];
    this.labels = [];
    this.painters = [];
    this.cell = 0.04;
    this.nx = Math.ceil(w / this.cell);
    this.nz = Math.ceil(d / this.cell);
    this.landMask = new Uint8Array(this.nx * this.nz);
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.lonK = (KM_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180)) / km;
    this.latK = KM_PER_DEG_LAT / km;
  }

  // Latitude and longitude to feet on the plan. North is -z, which is the back of the model.
  at(lat, lon) {
    return [(lon - this.lon) * this.lonK, -(lat - this.lat) * this.latK];
  }

  // A list of [lat, lon] to feet, smoothed if asked.
  geo(points, perSpan = 0) {
    const list = points.map(([la, lo]) => this.at(la, lo));
    return perSpan ? smooth(list, perSpan) : list;
  }

  frame(x, z, options) { return new Frame(this, x, z, options); }

  clampToPlan(p) {
    return [Math.max(-this.w / 2, Math.min(this.w / 2, p[0])), Math.max(-this.d / 2, Math.min(this.d / 2, p[1]))];
  }

  _scan(poly, fn) {
    const { cell, nx, nz, w, d } = this;
    let minZ = Infinity; let maxZ = -Infinity;
    for (const p of poly) { minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    const j0 = Math.max(0, Math.floor((minZ + d / 2) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((maxZ + d / 2) / cell));
    for (let j = j0; j <= j1; j += 1) {
      const z = -d / 2 + (j + 0.5) * cell;
      const cross = [];
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i, i += 1) {
        const [xi, zi] = poly[i]; const [xk, zk] = poly[k];
        if (zi > z !== zk > z) cross.push(xi + ((z - zi) / (zk - zi)) * (xk - xi));
      }
      cross.sort((a, b) => a - b);
      for (let c = 0; c + 1 < cross.length; c += 2) {
        const i0 = Math.max(0, Math.floor((cross[c] + w / 2) / cell));
        const i1 = Math.min(nx - 1, Math.floor((cross[c + 1] + w / 2) / cell));
        for (let i = i0; i <= i1; i += 1) fn(i + j * nx);
      }
    }
  }

  land(points) {
    const poly = wound(points.map((p) => this.clampToPlan(p)));
    this.lands.push(poly);
    this._scan(poly, (k) => { this.landMask[k] = 1; });
    return poly;
  }

  reservePoly(poly) {
    this._scan(poly, (k) => { this.blocked[k] = 1; });
  }

  reserveCircle(x, z, r) {
    const pts = [];
    for (let i = 0; i < 20; i += 1) pts.push([x + Math.cos((i / 20) * TAU) * r, z + Math.sin((i / 20) * TAU) * r]);
    this.reservePoly(pts);
  }

  _stamp(path, half) {
    const { cell, nx, nz, w, d } = this;
    for (let s = 0; s + 1 < path.length; s += 1) {
      const [ax, az] = path[s]; const [bx, bz] = path[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - half + w / 2) / cell));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + half + w / 2) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - half + d / 2) / cell));
      const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + half + d / 2) / cell));
      const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz || 1e-9;
      for (let j = j0; j <= j1; j += 1) {
        const z = -d / 2 + (j + 0.5) * cell;
        for (let i = i0; i <= i1; i += 1) {
          const x = -w / 2 + (i + 0.5) * cell;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= half) this.blocked[i + j * nx] = 1;
        }
      }
    }
  }

  // A district's ground tint. Painted only: it takes no room.
  ground(poly, color) { this.grounds.push({ poly, color }); return this; }

  road(path, width, { color = '#8d8a84', edge = '#6f6c66', keep = true } = {}) {
    this.roads.push({ path, width, color, edge });
    if (keep) this._stamp(path, width / 2 + 0.015);
    return this;
  }

  // A painted line with no road under it: a trail, an old shore, a city wall.
  line(path, width, color, { dash = null, keep = false } = {}) {
    this.lines.push({ path, width, color, dash });
    if (keep) this._stamp(path, width / 2 + 0.03);
    return this;
  }

  plaza(poly, color = '#d9d2c1') {
    this.plazas.push({ poly, color });
    this.reservePoly(poly);
    return this;
  }

  // A park: painted lawn with darker planting, reserved, with `trees` scattered through it.
  park(poly, { trees = 0, color = '#6f9a4e', treeH = 0.26, paths = [], greens = [0x3d6e36, 0x4c8040, 0x356530, 0x5a8c46] } = {}) {
    this.parks.push({ poly, color, paths });
    this.reservePoly(poly);
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    let placed = 0; let tries = 0;
    while (placed < trees && tries < trees * 40) {
      tries += 1;
      const x = minX + this.rng() * (maxX - minX); const z = minZ + this.rng() * (maxZ - minZ);
      if (!inPoly(poly, x, z) || !this.isLand(x, z)) continue;
      this.tree(x, z, treeH * (0.75 + this.rng() * 0.6), greens);
      placed += 1;
    }
    return this;
  }

  tree(x, z, h, greens = [0x3d6e36, 0x4c8040, 0x356530, 0x5a8c46], y = LAND_Y, detail = 1) {
    const r = h * 0.56;
    const c = new THREE.Color(greens[Math.floor(this.rng() * greens.length)]);
    const k = 0.86 + this.rng() * 0.3;
    this.b.add(blobGeometry(this.rng, detail, 0.14), [c.r * k, c.g * k, c.b * k], { position: [x, y + h * 0.58, z], scale: [r, h * 0.52, r], rotation: [0, this.rng() * TAU, 0] });
  }

  avenueTrees(path, spacing, h, offset = 0.1, greens) {
    const L = pathLength(path);
    const n = Math.floor(L / spacing);
    const sample = (d) => {
      let left = d;
      for (let i = 1; i < path.length; i += 1) {
        const dx = path[i][0] - path[i - 1][0]; const dz = path[i][1] - path[i - 1][1];
        const seg = Math.hypot(dx, dz);
        if (left <= seg) return [path[i - 1][0] + (dx * left) / seg, path[i - 1][1] + (dz * left) / seg, dx / seg, dz / seg];
        left -= seg;
      }
      return null;
    };
    for (let i = 0; i <= n; i += 1) {
      const p = sample(i * spacing);
      if (!p) continue;
      for (const side of [-1, 1]) {
        const x = p[0] - p[3] * side * offset; const z = p[1] + p[2] * side * offset;
        if (this.isLand(x, z)) this.tree(x, z, h, greens, LAND_Y, 0);
      }
    }
    return this;
  }

  isLand(x, z) {
    const i = Math.floor((x + this.w / 2) / this.cell); const j = Math.floor((z + this.d / 2) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return this.landMask[i + j * this.nx] === 1;
  }

  _free(x, z, w, d, yaw) {
    const { cell, nx, nz } = this;
    const c = Math.cos(yaw); const s = Math.sin(yaw);
    for (const fx of [-0.5, 0, 0.5]) {
      for (const fz of [-0.5, 0, 0.5]) {
        const px = x + c * fx * w + s * fz * d; const pz = z - s * fx * w + c * fz * d;
        const i = Math.floor((px + this.w / 2) / cell); const j = Math.floor((pz + this.d / 2) / cell);
        if (i < 2 || j < 2 || i >= nx - 2 || j >= nz - 2) return false;
        const k = i + j * nx;
        if (!this.landMask[k] || this.blocked[k]) return false;
      }
    }
    return true;
  }

  /**
   * Fills ground with buildings on a warped grid, in blocks with streets between them. Whatever a
   * road, a park, a landmark or the water has already claimed is simply passed over, so a diagonal
   * avenue cuts a regular grid the way Broadway really does.
   *
   * @param poly    only inside this outline, or everywhere if null
   * @param where   (x, z) => boolean, for a limit that is easier to say than to outline
   * @param yaw     the grid's turn from the plan
   * @param lot     [w, d] of one building
   * @param every   [a, b]: a street after every a lots one way and b the other
   * @param street  [sx, sz]: how wide those streets are
   * @param warp    feet of wander, for a street plan nobody ruled
   * @param h       (x, z, rng) => height in feet above the land
   * @param color   (x, z, rng) => a hex
   * @param style   (x, z, h, rng) => 'flat' | 'setback' | 'mansard' | 'gable' | 'hip'
   */
  fill({ poly = null, where = null, yaw = 0, lot = [0.3, 0.24], every = [2, 3], street = [0.08, 0.08], warp = 0, warpF = 0.35, turn = 0, h, color, style = () => 'flat', roof = null, skip = 0.03, anchor = [0, 0], seed = 3 }) {
    const c = Math.cos(yaw); const s = Math.sin(yaw);
    const diag = Math.hypot(this.w, this.d) * 0.75;
    const stepU = lot[0] + street[0] / every[0]; const stepV = lot[1] + street[1] / every[1];
    const nu = Math.ceil(diag / stepU); const nv = Math.ceil(diag / stepV);
    let count = 0;
    for (let iv = -nv; iv <= nv; iv += 1) {
      for (let iu = -nu; iu <= nu; iu += 1) {
        const lu = iu * lot[0] + Math.floor(iu / every[0]) * street[0];
        const lv = iv * lot[1] + Math.floor(iv / every[1]) * street[1];
        let x = anchor[0] + c * lu + s * lv;
        let z = anchor[1] - s * lu + c * lv;
        let local = yaw;
        if (warp) {
          const nx = noise2(x * warpF, z * warpF, seed); const nz = noise2(x * warpF + 11, z * warpF - 7, seed + 2);
          x += nx * warp; z += nz * warp;
          local += turn * noise2(x * warpF * 0.7 + 4, z * warpF * 0.7, seed + 5);
        }
        const r0 = this.rng(); const r1 = this.rng(); const r2 = this.rng();
        if (Math.abs(x) > this.w / 2 || Math.abs(z) > this.d / 2) continue;
        if (r0 < skip) continue;
        if (poly && !inPoly(poly, x, z)) continue;
        if (where && !where(x, z)) continue;
        const bw = lot[0] * (0.84 + r1 * 0.12); const bd = lot[1] * (0.84 + r2 * 0.12);
        if (!this._free(x, z, bw, bd, local)) continue;
        const height = h(x, z, this.rng);
        const hex = color(x, z, this.rng);
        const tone = 0.9 + this.rng() * 0.2;
        const k = lin(hex);
        this.building(x, z, bw, bd, local, height, style(x, z, height, this.rng), [k[0] * tone, k[1] * tone, k[2] * tone], roof ? roof(x, z, this.rng) : null);
        const out = rectOutline(x, z, bw, bd, local);
        this.reservePoly(out);
        this.halos.push(out);
        count += 1;
      }
    }
    return count;
  }

  building(x, z, w, d, yaw, h, style, color, roofHex = null) {
    const f = this.f; const y0 = LAND_Y;
    const roof = roofHex !== null ? lin(roofHex) : [color[0] * 0.62, color[1] * 0.62, color[2] * 0.62];
    if (style === 'setback' && h > 0.9) {
      const a = y0 + h * 0.46; const b = y0 + h * 0.82; const e = y0 + h;
      f.prism(rectOutline(x, z, w, d, yaw), y0, a, color, { roof });
      f.prism(rectOutline(x, z, w * 0.76, d * 0.76, yaw), a, b, color, { roof });
      f.prism(rectOutline(x, z, w * 0.54, d * 0.54, yaw), b, e, color, { roof });
    } else if (style === 'mansard') {
      const eave = y0 + h * 0.76;
      f.prism(rectOutline(x, z, w, d, yaw), y0, eave, color, { cap: false });
      f.prism(rectOutline(x, z, w, d, yaw), eave, y0 + h, roof, { top: rectOutline(x, z, w * 0.62, d * 0.62, yaw), roof, windows: false });
    } else if (style === 'gable') {
      const eave = y0 + h * 0.74;
      f.prism(rectOutline(x, z, w, d, yaw), y0, eave, color, { roof });
      f.gable(x, z, w * 1.04, d * 1.04, yaw + (w > d ? Math.PI / 2 : 0), eave, h * 0.26, roof, color);
    } else if (style === 'hip') {
      const eave = y0 + h * 0.78;
      f.prism(rectOutline(x, z, w, d, yaw), y0, eave, color, { roof });
      f.prism(rectOutline(x, z, w, d, yaw), eave, y0 + h, roof, { top: rectOutline(x, z, w * 0.2, d * 0.2, yaw), roof, windows: false });
    } else {
      f.prism(rectOutline(x, z, w, d, yaw), y0, y0 + h, color, { roof });
    }
  }

  // A plain deck on piers between two points on the plan, with a gentle rise and rails.
  bridge(a, b, { width = 0.14, color = 0x8a8578, deck = 0x5c5a56, piers = 3, rise = 0.05, seg = 8 } = {}) {
    // A crossing listed for a whole river may be off this plan, and it must not float past the rim.
    for (const p of [a, b]) if (Math.abs(p[0]) > this.w / 2 || Math.abs(p[1]) > this.d / 2) return this;
    const f = this.frame(0, 0);
    const P = (t) => [a[0] + (b[0] - a[0]) * t, 0.03 + rise * Math.sin(t * Math.PI), a[1] + (b[1] - a[1]) * t];
    const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let i = 0; i < seg; i += 1) {
      const p = P(i / seg); const q = P((i + 1) / seg);
      const mx = (p[0] + q[0]) / 2; const my = (p[1] + q[1]) / 2; const mz = (p[2] + q[2]) / 2;
      const tilt = Math.atan2(q[1] - p[1], (L / seg));
      this.b.add(new THREE.BoxGeometry(width, 0.035, L / seg + 0.01), deck, { position: [mx, LAND_Y + my - 0.018, mz], rotation: [-tilt, yaw, 0] });
    }
    for (let i = 1; i <= piers; i += 1) {
      const t = i / (piers + 1);
      const p = P(t);
      f.box(p[0], WATER_Y - LAND_Y - 0.02, p[2], width * 1.25, LAND_Y - WATER_Y + p[1] - 0.01, 0.07, color, yaw);
    }
    return this;
  }

  // A small boat at rest: a pointed hull and a little deckhouse.
  boat(x, z, yaw, length, hull = 0xe8e2d4, house = 0x8d3b2c) {
    const f = this.frame(x, z, { yaw, y: WATER_Y });
    addBoat(f, length, hull, house);
    return this;
  }

  // Wharves standing out into the water from a shore.
  pier(x, z, yaw, length, width = 0.09, color = 0x77726a) {
    const f = this.frame(x, z, { yaw });
    f.box(0, WATER_Y - LAND_Y, length / 2, width, LAND_Y - WATER_Y - 0.03, length, color);
    return this;
  }

  // The one thing on the model that moves. `build(frame)` draws it round the origin, facing +Z.
  mover(build, path, { speed = 0.35, y = WATER_Y, loop = false } = {}) {
    this.mover_ = { build, path, speed, y, loop };
    return this;
  }

  // ...or the one thing that turns: `build(frame)` draws it round the origin, turning about its +Z.
  rotor(build, { x, y, z, yaw = 0, rate = 0.08 }) {
    this.rotor_ = { build, x, y, z, yaw, rate };
    return this;
  }

  label(text, x, z, y, { size = 0.2, ground = LAND_Y } = {}) {
    this.labels.push({ text, x, z, y: LAND_Y + y, size, ground });
    return this;
  }

  landText_(text, path, size, color = 'rgba(40,36,30,0.72)') { this.landText.push({ text, path, size, color }); return this; }

  waterText_(text, path, size, color = 'rgba(232,242,248,0.72)') { this.waterText.push({ text, path, size, color }); return this; }

  paintOver(fn) { this.painters.push(fn); return this; }

  // ---------------------------------------------------------------------------------------------
  _drawPoly(ctx, poly) {
    ctx.beginPath();
    poly.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    ctx.closePath();
  }

  _drawPath(ctx, path) {
    ctx.beginPath();
    path.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
  }

  // Letters one at a time along a path, each turned to the path under it.
  _textAlong(ctx, { text, path, size, color }) {
    ctx.save();
    ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    // Read from the front of the model: a path running right to left would print upside down.
    const list = path[0][0] > path[path.length - 1][0] ? [...path].reverse() : path;
    const total = pathLength(list);
    const widths = [...text].map((ch) => ctx.measureText(ch).width * 1.12);
    const textLen = widths.reduce((a, b) => a + b, 0);
    let along = Math.max(0, (total - textLen) / 2);
    [...text].forEach((ch, n) => {
      let left = along + widths[n] / 2;
      for (let i = 1; i < list.length; i += 1) {
        const dx = list[i][0] - list[i - 1][0]; const dz = list[i][1] - list[i - 1][1];
        const seg = Math.hypot(dx, dz);
        if (left <= seg || i === list.length - 1) {
          ctx.save();
          ctx.translate(list[i - 1][0] + (dx * left) / (seg || 1), list[i - 1][1] + (dz * left) / (seg || 1));
          ctx.rotate(Math.atan2(dz, dx));
          ctx.fillText(ch, 0, 0);
          ctx.restore();
          break;
        }
        left -= seg;
      }
      along += widths[n];
    });
    ctx.restore();
  }

  _paintLand(ctx, W, H) {
    const { w, d } = this;
    const rng = seededRandom(this.seed + 77);
    ctx.fillStyle = this.landColor;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.scale(W / w, H / d);
    ctx.translate(w / 2, d / 2);
    for (const g of this.grounds) { ctx.fillStyle = g.color; this._drawPoly(ctx, g.poly); ctx.fill(); }
    // A grain, or the street level reads as a flat sheet of card.
    for (let i = 0; i < 9000; i += 1) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? '40,36,30' : '255,250,235'},${0.03 + rng() * 0.05})`;
      ctx.fillRect(-w / 2 + rng() * w, -d / 2 + rng() * d, 0.03 + rng() * 0.05, 0.03 + rng() * 0.05);
    }
    for (const p of this.plazas) {
      ctx.fillStyle = p.color; this._drawPoly(ctx, p.poly); ctx.fill();
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const r of this.roads) {
      ctx.strokeStyle = r.edge; ctx.lineWidth = r.width * 1.22; this._drawPath(ctx, r.path); ctx.stroke();
    }
    for (const r of this.roads) {
      ctx.strokeStyle = r.color; ctx.lineWidth = r.width; this._drawPath(ctx, r.path); ctx.stroke();
    }
    for (const p of this.parks) {
      ctx.fillStyle = p.color; this._drawPoly(ctx, p.poly); ctx.fill();
      ctx.save();
      this._drawPoly(ctx, p.poly); ctx.clip();
      let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
      for (const q of p.poly) { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minZ = Math.min(minZ, q[1]); maxZ = Math.max(maxZ, q[1]); }
      const area = (maxX - minX) * (maxZ - minZ);
      for (let i = 0; i < area * 90; i += 1) {
        ctx.fillStyle = `rgba(${rng() < 0.6 ? '38,70,32' : '150,185,96'},${0.1 + rng() * 0.16})`;
        ctx.beginPath();
        ctx.arc(minX + rng() * (maxX - minX), minZ + rng() * (maxZ - minZ), 0.03 + rng() * 0.09, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(232,222,196,0.85)'; ctx.lineWidth = 0.028;
      for (const path of p.paths) { this._drawPath(ctx, path); ctx.stroke(); }
      ctx.restore();
    }
    for (const l of this.lines) {
      ctx.strokeStyle = l.color; ctx.lineWidth = l.width;
      ctx.setLineDash?.(l.dash ?? []);
      this._drawPath(ctx, l.path); ctx.stroke();
      ctx.setLineDash?.([]);
    }
    // A soft contact shadow round every building. The sun does the rest, but on the shady side of a
    // block this is the only thing seating it on the ground.
    ctx.fillStyle = 'rgba(30,28,26,0.26)';
    for (const halo of this.halos) {
      ctx.save();
      let cx = 0; let cz = 0;
      for (const p of halo) { cx += p[0]; cz += p[1]; }
      cx /= 4; cz /= 4;
      ctx.translate(cx, cz); ctx.scale(1.14, 1.14); ctx.translate(-cx, -cz);
      this._drawPoly(ctx, halo); ctx.fill();
      ctx.restore();
    }
    for (const fn of this.painters) fn(ctx, rng);
    for (const t of this.landText) this._textAlong(ctx, t);
    ctx.restore();
  }

  _paintWater(ctx, W, H) {
    const { w, d } = this;
    const rng = seededRandom(this.seed + 31);
    const g = ctx.createLinearGradient?.(0, 0, 0, H);
    if (g) {
      g.addColorStop(0, this.waterDeep);
      g.addColorStop(1, this.waterColor);
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.scale(W / w, H / d);
    ctx.translate(w / 2, d / 2);
    for (let i = 0; i < 3200; i += 1) {
      const x = -w / 2 + rng() * w; const z = -d / 2 + rng() * d; const len = 0.08 + rng() * 0.28;
      ctx.strokeStyle = `rgba(${rng() < 0.55 ? '225,240,248' : '16,48,78'},${0.05 + rng() * 0.11})`;
      ctx.lineWidth = 0.012 + rng() * 0.018;
      ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x + len, z + (rng() - 0.5) * 0.02); ctx.stroke();
    }
    for (const t of this.waterText) this._textAlong(ctx, t);
    ctx.restore();
  }

  _base() {
    const { w, d } = this;
    const top = LAND_Y + 0.05;
    const fullW = w + RIM * 2; const fullD = d + RIM * 2;
    const add = (bw, bh, bd, x, y, z, color) => this.b.add(new THREE.BoxGeometry(bw, bh, bd), color, { position: [x, y + bh / 2, z] });
    add(fullW + 0.24, 0.16, fullD + 0.24, 0, 0, 0, WALNUT_DARK);
    add(fullW, WATER_Y - 0.16 - 0.02, fullD, 0, 0.16, 0, WALNUT);
    const rimY = WATER_Y - 0.02; const rimH = top - rimY;
    add(fullW, rimH, RIM, 0, rimY, (d + RIM) / 2, WALNUT);
    add(fullW, rimH, RIM, 0, rimY, -(d + RIM) / 2, WALNUT);
    add(RIM, rimH, d, (w + RIM) / 2, rimY, 0, WALNUT);
    add(RIM, rimH, d, -(w + RIM) / 2, rimY, 0, WALNUT);
  }

  // A closed wall round every shore, so land stands proud of the water by construction.
  _quays() {
    const { w, d } = this;
    const pos = [];
    const onEdge = (p) => Math.abs(Math.abs(p[0]) - w / 2) < 1e-3 || Math.abs(Math.abs(p[1]) - d / 2) < 1e-3;
    for (const poly of this.lands) {
      for (let i = 0; i < poly.length; i += 1) {
        const p = poly[i]; const q = poly[(i + 1) % poly.length];
        if (onEdge(p) && onEdge(q)) continue;
        const y0 = WATER_Y - 0.03;
        pos.push(p[0], y0, p[1], p[0], LAND_Y, p[1], q[0], LAND_Y, q[1], p[0], y0, p[1], q[0], LAND_Y, q[1], q[0], y0, q[1]);
      }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    this.b.add(g, QUAY);
  }

  _landMesh(map) {
    const { w, d } = this;
    const verts = []; const uvs = []; const idx = [];
    for (const poly of this.lands) {
      const contour = poly.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const base = verts.length / 3;
      for (const p of poly) {
        verts.push(p[0], LAND_Y, p[1]);
        uvs.push((p[0] + w / 2) / w, 1 - (p[1] + d / 2) / d);
      }
      for (const [a, b, c] of tris) {
        // Measured, not assumed: a triangle's winding depends on the outline's and earcut's both.
        const A = poly[a]; const B = poly[b]; const C = poly[c];
        const ny = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
        if (ny >= 0) idx.push(base + a, base + b, base + c);
        else idx.push(base + a, base + c, base + b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const m = mesh(g, standard({ map, roughness: 0.92, metalness: 0 }));
    m.castShadow = false;
    return m;
  }

  _waterMesh(map) {
    const W = this.w / 2 + 0.01; const D = this.d / 2 + 0.01;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-W, WATER_Y, -D, W, WATER_Y, -D, -W, WATER_Y, D, W, WATER_Y, D], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    g.computeVertexNormals();
    const m = mesh(g, standard({ map, roughness: 0.34, metalness: 0.02 }));
    m.castShadow = false;
    return m;
  }

  // Every word on the model, in one atlas on one mesh. Plates cast no shadow: a plate this wide lays
  // a dark bar across whatever it names.
  _labelMesh(root) {
    const list = [...this.labels];
    const hw = (this.w + RIM * 2) / 2;
    const front = this.d / 2 + RIM + 0.012;
    if (this.title) list.push({ text: this.title, x: 0, z: front, y: 0.5, size: 0.42, flush: true });
    if (this.subtitle) list.push({ text: this.subtitle, x: 0, z: front, y: 0.24, size: 0.2, flush: true });
    list.push({ text: '▲ NORTH', x: 0, z: -(this.d / 2 + RIM / 2), y: LAND_Y + 0.26, size: 0.26, ground: LAND_Y + 0.05 });
    if (!list.length) return;
    const atlasW = 2048; const rowH = 72; const pad = 26;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `bold 50px Arial, Helvetica, sans-serif`;
    const widths = list.map((label) => Math.min(atlasW - 8, measure.measureText(label.text).width + pad * 2));
    const texture = canvasTexture(atlasW, rowH * list.length, (ctx, w, h) => {
      ctx.fillStyle = '#fbf8ef';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `bold 50px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      list.forEach((label, i) => {
        const y = rowH * i;
        if (label.flush) {
          ctx.fillStyle = '#2a1a10';
          ctx.fillRect(0, y, w, rowH);
          ctx.fillStyle = '#f2e4c6';
        } else {
          ctx.fillStyle = '#1f2b33';
        }
        ctx.fillText(label.text, w / 2, y + rowH / 2 + 2, w - 16);
      });
    });
    const pos = []; const uv = [];
    const rows = list.length;
    list.forEach((label, i) => {
      const frac = widths[i] / atlasW;
      const width = Math.min(label.size * (widths[i] / rowH), hw * 1.92);
      const y0 = label.y; const y1 = label.y + label.size;
      const u0 = 0.5 - frac / 2; const u1 = 0.5 + frac / 2;
      const v0 = 1 - (i + 1) / rows; const v1 = 1 - i / rows;
      const half = width / 2;
      const quad = (a, b, e, f, ua, ub) => {
        for (const [p, u, v] of [[a, ua, v0], [b, ub, v0], [e, ub, v1], [a, ua, v0], [e, ub, v1], [f, ua, v1]]) {
          pos.push(p[0], p[1], p[2]); uv.push(u, v);
        }
      };
      const off = 0.012;
      const X = label.x; const Z = label.z;
      quad([X - half, y0, Z + off], [X + half, y0, Z + off], [X + half, y1, Z + off], [X - half, y1, Z + off], u0, u1);
      if (!label.flush) {
        quad([X + half, y0, Z - off], [X - half, y0, Z - off], [X - half, y1, Z - off], [X + half, y1, Z - off], u0, u1);
        const bottom = label.ground ?? LAND_Y;
        // The post stops under the plate. Run up behind it, it reads as a line through the words.
        if (label.y - bottom > 0.02) this.b.add(new THREE.CylinderGeometry(0.008, 0.011, label.y - bottom, 4), 0x8a7c55, { position: [X, (label.y + bottom) / 2, Z] });
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const m = mesh(g, standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.2, roughness: 0.8 }));
    m.castShadow = false;
    m.receiveShadow = false;
    root.add(m);
  }

  _rotor(root) {
    const spec = this.rotor_;
    const saved = this.b;
    this.b = new Batch();
    spec.build(new Frame(this, 0, 0, { y: 0 }));
    const m = this.b.mesh({ roughness: 0.6 });
    this.b = saved;
    const rig = new THREE.Group();
    rig.position.set(spec.x, spec.y, spec.z);
    rig.rotation.y = spec.yaw;
    const wheel = new THREE.Group();
    wheel.add(m);
    rig.add(wheel);
    root.add(rig);
    root.userData.tick = {
      update(dt) { if (!reducedMotion()) wheel.rotation.z += Math.min(dt, 0.1) * spec.rate; },
      dispose() {},
    };
  }

  _mover(root) {
    if (this.rotor_) { this._rotor(root); return; }
    const spec = this.mover_;
    if (!spec) return;
    const saved = this.b;
    this.b = new Batch();
    spec.build(new Frame(this, 0, 0, { y: 0 }));
    const m = this.b.mesh({ roughness: 0.6 });
    this.b = saved;
    const rig = new THREE.Group();
    rig.add(m);
    root.add(rig);
    const path = spec.path;
    const lengths = [0];
    for (let i = 1; i < path.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const total = lengths[lengths.length - 1];
    let travelled = total * 0.3; let dir = 1;
    const seat = () => {
      let i = 1;
      while (i < path.length - 1 && lengths[i] < travelled) i += 1;
      const a = path[i - 1]; const b = path[i];
      const t = (travelled - lengths[i - 1]) / ((lengths[i] - lengths[i - 1]) || 1);
      rig.position.set(a[0] + (b[0] - a[0]) * t, spec.y, a[1] + (b[1] - a[1]) * t);
      rig.rotation.y = Math.atan2((b[0] - a[0]) * dir, (b[1] - a[1]) * dir);
    };
    seat();
    root.userData.tick = {
      update(dt) {
        if (reducedMotion()) return;
        travelled += dir * spec.speed * Math.min(dt, 0.1);
        if (travelled >= total) { travelled = spec.loop ? 0 : total; if (!spec.loop) dir = -1; }
        if (travelled <= 0) { travelled = 0; dir = 1; }
        seat();
      },
      dispose() {},
    };
  }

  finish() {
    const { w, d } = this;
    const root = new THREE.Group();
    this._base();
    this._quays();
    const px = 128;
    const landTex = canvasTexture(Math.round(w * px), Math.round(d * px), (ctx, W, H) => this._paintLand(ctx, W, H));
    const waterTex = canvasTexture(Math.round(w * 72), Math.round(d * 72), (ctx, W, H) => this._paintWater(ctx, W, H));
    root.add(this._waterMesh(waterTex));
    root.add(this._landMesh(landTex));
    root.add(this.f.mesh());
    this._labelMesh(root);
    root.add(this.b.mesh());
    this._mover(root);
    return root;
  }
}

export function addBoat(f, L, hull, house) {
  const W = L * 0.32;
  const outline = [[0, L / 2], [W / 2, L * 0.18], [W / 2, -L * 0.42], [W * 0.3, -L / 2], [-W * 0.3, -L / 2], [-W / 2, -L * 0.42], [-W / 2, L * 0.18]];
  f.city.b.add(extrudeY(outline, 0.05), hull, { position: f.p(0, 0.005, 0), rotation: [0, f.yaw, 0] });
  f.box(0, 0.055, -L * 0.08, W * 0.62, 0.05, L * 0.42, house);
  f.box(0, 0.105, -L * 0.1, W * 0.4, 0.03, L * 0.2, 0xf0ebe0);
}

// An outline stood straight up, with a cap. Used where a flat-sided solid has no windows to wear.
export function extrudeY(outline, h) {
  const low = wound(outline);
  const pos = [];
  let cx = 0; let cz = 0;
  for (const p of low) { cx += p[0]; cz += p[1]; }
  cx /= low.length; cz /= low.length;
  for (let i = 0; i < low.length; i += 1) {
    const p = low[i]; const q = low[(i + 1) % low.length];
    pos.push(p[0], 0, p[1], p[0], h, p[1], q[0], h, q[1], p[0], 0, p[1], q[0], h, q[1], q[0], 0, q[1]);
    pos.push(cx, h, cz, q[0], h, q[1], p[0], h, p[1]);
    pos.push(cx, 0, cz, p[0], 0, p[1], q[0], 0, q[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
