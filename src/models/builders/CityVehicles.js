import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, mesh, standard } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { lathe, outward, tube, alongMatrix } from '../ModelKit.js';
import { PALETTE, TYRE } from '../town/TownKit.js';

// The Build a City kit's big vehicles: the four that are each a whole public service.
//
//   city-bus        a 40ft low-floor transit bus, 8.5ft wide, doors on the curb side, a bike rack
//                   folded down on the front, the route sign lit over the windscreen.
//   school-bus      a 38ft conventional (the hood in front of the windscreen), stopped with its red
//                   lights on and the STOP arm swung out on the driver's side. Its side glass is the
//                   kit's one see-through mesh, so the rows of seats behind it are real.
//   fire-engine     a 35ft pumper: crew cab and light bar, the pump panel of valves and gauges, a
//                   ground ladder racked on the side, the hose bed at the back.
//   garbage-truck   a 30ft rear loader: a cab-over cab, the packer body, the open hopper at the back
//                   and the crew's riding steps and grab handles.
//
// Real life size in feet, origin at the base centre, front toward +Z, tyres touching y = 0.
//
// WHICH SIDE IS WHICH. Facing +Z with +Y up, a driver's LEFT hand is +X. So in a country that
// drives on the right the driver's side is +X and the curb side, where the doors are, is -X.
//
// HOW EACH ONE IS MADE. A body is a SIDE PROFILE -- an outline in (z, y) with the wheel arches cut
// into it -- extruded across the width with a rounded bevel, so every long edge is soft and the
// arches are real openings. Windows, doors, lamps and signs are built FORWARD of that solid, a hair
// proud, never cut into it. Six meshes at most, one per material:
//   paint, rubber and black trim, metal, glass, lamps (emissive, from an atlas), signs (the atlas).

const V3 = THREE.Vector3;

// ---------------------------------------------------------------------------------------------
// Small geometry
// ---------------------------------------------------------------------------------------------

function T(g, pos = [0, 0, 0], rot = [0, 0, 0], order = 'XYZ') {
  const m = new THREE.Matrix4().compose(
    new V3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], order)),
    new V3(1, 1, 1),
  );
  g.applyMatrix4(m);
  return g;
}

// A box with every edge rounded, pushed out from a subdivided cube so the normals are analytic and
// nothing creases. Indexed, closed, wound outward.
function rbox(w, h, d, r = 0.05, seg = 1) {
  // Thin or tiny parts gain nothing from a rounded edge but triangles.
  if (r < 0.012 || Math.min(w, h, d) < 0.07) return new THREE.BoxGeometry(w, h, d);
  const n = seg * 2 + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.max(1e-4, Math.min(r, half[0] * 0.98, half[1] * 0.98, half[2] * 0.98));
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const map = (v, H) => {
    const k = Math.round((v + 0.5) * n);
    if (k <= seg) return -(H - rr) - rr * (seg - k) / seg;
    return (H - rr) + rr * (k - seg - 1) / seg;
  };
  const c = [0, 0, 0];
  const core = [0, 0, 0];
  for (let i = 0; i < P.count; i++) {
    c[0] = map(P.getX(i), half[0]); c[1] = map(P.getY(i), half[1]); c[2] = map(P.getZ(i), half[2]);
    for (let k = 0; k < 3; k++) core[k] = Math.max(-(half[k] - rr), Math.min(half[k] - rr, c[k]));
    let dx = c[0] - core[0]; let dy = c[1] - core[1]; let dz = c[2] - core[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    P.setXYZ(i, core[0] + dx * rr, core[1] + dy * rr, core[2] + dz * rr);
    N.setXYZ(i, dx, dy, dz);
  }
  return g;
}

// A box from its two corners, rounded.
function slab(x0, x1, y0, y1, z0, z1, r = 0.04) {
  return rbox(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), r)
    .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function cylY(r, h, segs = 16) {
  return new THREE.CylinderGeometry(r, r, h, segs);
}
function cylX(r, len, segs = 16) {
  return new THREE.CylinderGeometry(r, r, len, segs).rotateZ(Math.PI / 2);
}
function cylZ(r, len, segs = 16) {
  return new THREE.CylinderGeometry(r, r, len, segs).rotateX(Math.PI / 2);
}

// A rod between two points, closed at both ends.
function rod(a, b, r, segs = 8) {
  const { m, len } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(r, r, len, segs).rotateX(Math.PI / 2).translate(0, 0, len / 2);
  return g.applyMatrix4(m);
}

// Rounds each corner of a closed polygon by `radii[i]` (0 leaves it sharp), convex or concave.
function fillet(pts, radii, steps = 4) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const P = pts[i];
    const r = Array.isArray(radii) ? radii[i] : radii;
    if (!r) { out.push(P); continue; }
    const A = pts[(i - 1 + n) % n];
    const B = pts[(i + 1) % n];
    let v1 = [A[0] - P[0], A[1] - P[1]]; const l1 = Math.hypot(v1[0], v1[1]);
    let v2 = [B[0] - P[0], B[1] - P[1]]; const l2 = Math.hypot(v2[0], v2[1]);
    v1 = [v1[0] / l1, v1[1] / l1]; v2 = [v2[0] / l2, v2[1] / l2];
    const ang = Math.acos(Math.max(-1, Math.min(1, v1[0] * v2[0] + v1[1] * v2[1])));
    if (ang < 1e-3 || ang > Math.PI - 1e-3) { out.push(P); continue; }
    let t = r / Math.tan(ang / 2);
    t = Math.min(t, l1 * 0.48, l2 * 0.48);
    const rr = t * Math.tan(ang / 2);
    let bx = v1[0] + v2[0]; let by = v1[1] + v2[1]; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
    const dc = rr / Math.sin(ang / 2);
    const C = [P[0] + bx * dc, P[1] + by * dc];
    const S = [P[0] + v1[0] * t, P[1] + v1[1] * t];
    const E = [P[0] + v2[0] * t, P[1] + v2[1] * t];
    const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]);
    let da = Math.atan2(E[1] - C[1], E[0] - C[0]) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps;
      out.push([C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr]);
    }
  }
  return out;
}

// The points of a wheel arch cut up into a body's bottom edge, which runs toward +z. The arch is a
// circle about the axle that meets the bottom edge at height `yb`.
function arch(zc, yAxle, R, yb, steps = 14) {
  const s = Math.max(-0.95, Math.min(0.95, (yAxle - yb) / R));
  const alpha = Math.asin(s);
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const a = Math.PI + alpha - ((Math.PI + 2 * alpha) * k) / steps;
    pts.push([zc + Math.cos(a) * R, yAxle + Math.sin(a) * R]);
  }
  return pts;
}

// A side profile (z, y), counter-clockwise, extruded across `width` with every long edge rounded,
// centred on `x`. A convex corner's fillet must be 0 or at least `r`: the bevel insets the outline
// by r, and a smaller arc inset that far folds over itself and tears a hole in the side.
function profileSolid(outline, width, r = 0.3, { segs = 3, x = 0 } = {}) {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = Math.max(0.02, width - 2 * r);
  let g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: r > 0, bevelThickness: r, bevelSize: r, bevelOffset: -r, bevelSegments: segs, curveSegments: 1,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2 + x, 0, 0);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, 0.62);
  return outward(g);
}

// A cross-section (x, y) extruded along Z from z0 to z1, its end edges rounded by `r`.
function sectionSolid(outline, z0, z1, r = 0.06, segs = 2) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = Math.max(0.02, (z1 - z0) - 2 * r);
  let g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: r > 0, bevelThickness: r, bevelSize: r, bevelOffset: -r, bevelSegments: segs, curveSegments: 1,
  });
  g.translate(0, 0, z0 + r);
  g.deleteAttribute('uv');
  g = toCreasedNormals(g, 0.62);
  return outward(g);
}

// The crown of a bus roof as a squircle from wall top to wall top: [x, y] points from +x to -x.
function roofArc(halfW, rise, y0, n = 18, p = 0.42) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI;
    const c = Math.cos(t); const sn = Math.sin(t);
    pts.push([Math.sign(c) * Math.pow(Math.abs(c), p) * halfW, y0 + Math.pow(sn, p) * rise]);
  }
  return pts;
}

// An arch cut into a bottom edge that ends at `zEnd` partway round, for a body panel whose front
// stops over a wheel.
function archTo(zc, yAxle, R, yb, zEnd, steps = 12) {
  return arch(zc, yAxle, R, yb, steps).filter(([z]) => z < zEnd - 0.02)
    .concat([[zEnd, yAxle + Math.sqrt(Math.max(0, R * R - (zEnd - zc) ** 2))]]);
}

// The same arch clipped to the span zMin..zMax of a panel that starts or stops over the wheel.
function archClip(zc, yAxle, R, yb, zMin, zMax, steps = 12) {
  const onCircle = (z) => [z, yAxle + Math.sqrt(Math.max(0, R * R - (z - zc) ** 2))];
  const pts = arch(zc, yAxle, R, yb, steps).filter(([z]) => z > zMin + 0.2 && z < zMax - 0.2);
  if (zc - R < zMin) pts.unshift(onCircle(zMin));
  if (zc + R > zMax) pts.push(onCircle(zMax));
  return pts;
}

// A rail along a side at height y, skipping the stretches where an arch or a door would cut it.
function railRuns(z0, z1, gaps) {
  const runs = [];
  let a = z0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g1 <= a || g0 >= z1) continue;
    if (g0 > a + 0.3) runs.push([a, g0]);
    a = Math.max(a, g1);
  }
  if (z1 > a + 0.3) runs.push([a, z1]);
  return runs;
}
function archGap(zc, yAxle, R, y, pad = 0.12) {
  const d = Math.abs(y - yAxle);
  if (d >= R) return null;
  const h = Math.sqrt(R * R - d * d) + pad;
  return [zc - h, zc + h];
}

// An octagonal plate facing +Z, its two faces both reading the atlas rectangle the right way round.
// With more sides it is a round badge or a gauge face.
function octagon(r, t, rect, sides = 8) {
  const g = new THREE.CylinderGeometry(r, r, t, sides, 1).rotateX(Math.PI / 2).rotateZ(sides === 8 ? Math.PI / 8 : 0);
  const U = g.attributes.uv; const P = g.attributes.position; const N = g.attributes.normal;
  for (let i = 0; i < U.count; i++) {
    const back = N.getZ(i) < -0.5;
    const u = 0.5 + (back ? -1 : 1) * P.getX(i) / (2 * r);
    const v = 0.5 + P.getY(i) / (2 * r);
    U.setXY(i, rect.u0 + (rect.u1 - rect.u0) * Math.max(0, Math.min(1, u)), rect.v0 + (rect.v1 - rect.v0) * Math.max(0, Math.min(1, v)));
  }
  return g;
}

// A panel lying on the straight profile segment (z0, y0) -> (z1, y1), `off` proud of it along its
// outward normal (the outline is counter-clockwise), spanning x0..x1 and `t` thick.
function onSegment(z0, y0, z1, y1, x0, x1, { off = 0.02, t = 0.05, r = 0.03, inset = 0 } = {}) {
  const dz = z1 - z0; const dy = y1 - y0;
  const len = Math.hypot(dz, dy);
  const nz = dy / len; const ny = -dz / len;
  const phi = Math.atan2(dz, dy);
  const g = rbox(Math.abs(x1 - x0), Math.max(0.02, len - inset * 2), t, r);
  g.rotateX(phi);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2 + ny * off, (z0 + z1) / 2 + nz * off);
  return g;
}

// A plate whose +Z face shows an atlas rectangle. Its other faces sample the same rectangle, which
// at 0.03ft of edge nobody can see.
function plate(w, h, t, rect, r = 0.01, twoSided = false) {
  const g = rbox(w, h, t, r);
  const U = g.attributes.uv;
  const P = g.attributes.position;
  const N = g.attributes.normal;
  for (let i = 0; i < U.count; i++) {
    const back = twoSided && N.getZ(i) < -0.5;
    const u = 0.5 + (back ? -1 : 1) * P.getX(i) / w;
    const v = 0.5 + P.getY(i) / h;
    U.setXY(i, rect.u0 + (rect.u1 - rect.u0) * Math.max(0, Math.min(1, u)), rect.v0 + (rect.v1 - rect.v0) * Math.max(0, Math.min(1, v)));
  }
  return g;
}

// Points every vertex's uv at one atlas swatch, so a lamp of any shape glows one colour.
function swatchUV(g, rect) {
  const U = g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2);
  const u = (rect.u0 + rect.u1) / 2; const v = (rect.v0 + rect.v1) / 2;
  for (let i = 0; i < U.count; i++) U.setXY(i, u, v);
  g.setAttribute('uv', U);
  return g;
}

// ---------------------------------------------------------------------------------------------
// The atlas: every lamp colour and every painted sign on one small canvas
// ---------------------------------------------------------------------------------------------

class Atlas {
  constructor(w = 512, h = 512) {
    this.w = w; this.h = h; this.ops = []; this.x = 2; this.y = 2; this.row = 0;
  }

  rect(pw, ph, draw) {
    if (this.x + pw + 2 > this.w) { this.x = 2; this.y += this.row + 3; this.row = 0; }
    const x = this.x; const y = this.y;
    this.x += pw + 3; this.row = Math.max(this.row, ph);
    this.ops.push((ctx) => {
      ctx.save(); ctx.translate(x, y);
      ctx.beginPath(); ctx.rect(0, 0, pw, ph); ctx.clip();
      draw(ctx, pw, ph); ctx.restore();
    });
    const e = 0.5;
    return {
      u0: (x + e) / this.w, u1: (x + pw - e) / this.w,
      v0: 1 - (y + ph - e) / this.h, v1: 1 - (y + e) / this.h,
    };
  }

  swatch(css) {
    return this.rect(6, 6, (ctx, w, h) => { ctx.fillStyle = css; ctx.fillRect(-2, -2, w + 4, h + 4); });
  }

  texture() {
    const tex = canvasTexture(this.w, this.h, (ctx) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, this.w, this.h);
      for (const op of this.ops) op(ctx);
    });
    tex.anisotropy = 8;
    return tex;
  }
}

// Text at the largest size that fits the box, measured, never clipped.
function fitText(ctx, text, cx, cy, maxW, maxH, { weight = 800, family = 'Arial, Helvetica, sans-serif', color = '#000' } = {}) {
  let size = maxH;
  ctx.font = `${weight} ${size}px ${family}`;
  const w = ctx.measureText(text).width || 1;
  if (w > maxW) size = Math.max(6, size * (maxW / w));
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

// An LED destination sign: amber characters on black, then a dot grid over them so the text reads
// as lamps rather than as paint.
function ledSign(text, ctx, w, h) {
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(0, 0, w, h);
  fitText(ctx, text, w / 2, h / 2 + h * 0.03, w * 0.94, h * 0.78, { weight: 900, color: '#ffb22e' });
  ctx.fillStyle = 'rgba(8,8,8,0.55)';
  const pitch = Math.max(3, Math.round(h / 16));
  for (let x = 0; x < w; x += pitch) ctx.fillRect(x, 0, 1, h);
  for (let y = 0; y < h; y += pitch) ctx.fillRect(0, y, w, 1);
}

// The International Symbol of Access, drawn: a blue square, a seated figure and its wheel.
function accessSymbol(ctx, w, h) {
  ctx.fillStyle = '#1f5fae';
  ctx.fillRect(0, 0, w, h);
  const s = Math.min(w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.085;
  ctx.beginPath(); ctx.arc(w * 0.44, h * 0.18, s * 0.075, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w * 0.42, h * 0.3); ctx.lineTo(w * 0.42, h * 0.56); ctx.lineTo(w * 0.62, h * 0.56);
  ctx.lineTo(w * 0.72, h * 0.8); ctx.lineTo(w * 0.8, h * 0.76);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.42, h * 0.4); ctx.lineTo(w * 0.6, h * 0.4); ctx.stroke();
  ctx.lineWidth = s * 0.07;
  ctx.beginPath(); ctx.arc(w * 0.44, h * 0.64, s * 0.22, Math.PI * 0.55, Math.PI * 1.75); ctx.stroke();
}

// ---------------------------------------------------------------------------------------------
// The six materials, fresh on every build
// ---------------------------------------------------------------------------------------------

function kit(atlasW = 512, atlasH = 512) {
  return {
    paint: [], dark: [], metal: [], glass: [], lamp: [], sign: [],
    atlas: new Atlas(atlasW, atlasH),
  };
}

function finish(K, { glassClear = false, paintRough = 0.42, lampGlow = 0.85 } = {}) {
  const group = new THREE.Group();
  const tex = K.atlas.texture();
  const add = (list, material, shadow = true) => {
    if (!list.length) return;
    const m = mesh(mergeParts(list), material);
    m.receiveShadow = true;
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  add(K.paint, standard({ vertexColors: true, roughness: paintRough, metalness: 0.04 }));
  add(K.dark, standard({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  add(K.metal, standard({ vertexColors: true, roughness: 0.3, metalness: 0.55 }));
  if (glassClear) {
    const g = add(K.glass, standard({
      vertexColors: true, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false,
    }), false);
    if (g) g.renderOrder = 2;
  } else {
    add(K.glass, standard({ vertexColors: true, roughness: 0.14, metalness: 0.2 }));
  }
  add(K.lamp, standard({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: lampGlow, roughness: 0.35 }), false);
  add(K.sign, standard({ map: tex, roughness: paintRough, metalness: 0.04 }));
  return group;
}

const put = (list, geometry, color) => { list.push({ geometry, color }); };

// ---------------------------------------------------------------------------------------------
// Wheels: TownKit's heavy tyre on a steel disc, ten lug nuts, a hub cap
// ---------------------------------------------------------------------------------------------

function wheel(K, x, z, side, { tyre = TYRE.heavy, rim = PALETTE.hubSilver, dual = false, hubCap = 0x9ea3a8 } = {}) {
  const R = tyre.r; const hw = tyre.w / 2;
  const yA = R - 0.02;
  const tyres = dual ? [0, -(tyre.w + 0.08)] : [0];
  for (const off of tyres) {
    const prof = [
      [0, -hw * 0.82], [R * 0.62, -hw * 0.86], [R * 0.9, -hw], [R * 0.99, -hw * 0.62], [R * 1.003, 0],
      [R * 0.99, hw * 0.62], [R * 0.9, hw], [R * 0.62, hw * 0.86], [0, hw * 0.82],
    ];
    const g = outward(lathe(prof, 22));
    g.rotateZ(-side * Math.PI / 2);
    g.translate(x + side * off, yA, z);
    put(K.dark, g, PALETTE.tyre);
  }
  // The disc: a dished rim with a flange, standing proud of the outer sidewall.
  const rr = R * 0.56;
  const disc = outward(lathe([
    [0, hw * 0.7], [rr * 1.04, hw * 0.7], [rr * 1.08, hw * 0.88], [rr * 1.02, hw * 0.98], [rr * 0.9, hw * 0.9],
    [rr * 0.62, hw * 0.86], [rr * 0.5, hw * 1.0], [0, hw * 1.02],
  ], 20));
  disc.rotateZ(-side * Math.PI / 2).translate(x, yA, z);
  put(K.metal, disc, rim);
  const hub = outward(lathe([[0, hw * 0.95], [rr * 0.34, hw * 0.95], [rr * 0.34, hw * 1.25], [rr * 0.26, hw * 1.36], [0, hw * 1.38]], 12));
  hub.rotateZ(-side * Math.PI / 2).translate(x, yA, z);
  put(K.metal, hub, hubCap);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const nut = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 6);
    nut.translate(Math.cos(a) * rr * 0.44, hw * 1.04, Math.sin(a) * rr * 0.44);
    nut.rotateZ(-side * Math.PI / 2).translate(x, yA, z);
    put(K.metal, nut, 0xc9ccd0);
  }
  // Hand holes in the disc, dark, so it reads as a pressed steel wheel and not a plate.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const hole = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 6);
    hole.translate(Math.cos(a) * rr * 0.75, hw * 0.885, Math.sin(a) * rr * 0.75);
    hole.rotateZ(-side * Math.PI / 2).translate(x, yA, z);
    put(K.dark, hole, 0x18191b);
  }
}

// The wheel wells behind every arch, dark, so a student looking into one sees a recess and not
// daylight through to the other side.
function wells(K, axles, halfW, R, top) {
  for (const z of axles) {
    put(K.dark, slab(-halfW + 0.15, halfW - 0.15, R - 0.4, top, z - R * 1.05, z + R * 1.05, 0.05), 0x151617);
    put(K.dark, cylX(0.22, halfW * 2 - 1.2, 10).translate(0, R - 0.02, z), 0x2a2b2d);
  }
}

// ---------------------------------------------------------------------------------------------
// Common fittings
// ---------------------------------------------------------------------------------------------

// A lamp: a dark bezel on the body with the lit lens a hair proud of it, both facing +Z or -Z.
function lampAt(K, sw, x, y, z, w, h, facing = 1, { round = false, bezel = 0.05, depth = 0.08 } = {}) {
  if (round) {
    const b = cylZ(Math.max(w, h) / 2 + bezel, depth, 18).translate(x, y, z + facing * depth / 2);
    put(K.dark, b, 0x1a1b1c);
    put(K.lamp, swatchUV(cylZ(Math.max(w, h) / 2, depth, 18).translate(x, y, z + facing * (depth / 2 + 0.03)), sw), 0xffffff);
  } else {
    put(K.dark, new THREE.BoxGeometry(w + bezel * 2, h + bezel * 2, depth).translate(x, y, z + facing * depth / 2), 0x1a1b1c);
    put(K.lamp, swatchUV(rbox(w, h, depth, 0.03).translate(x, y, z + facing * (depth / 2 + 0.03)), sw), 0xffffff);
  }
}

// A lamp on a side wall facing +X or -X.
function sideLamp(K, sw, x, y, z, w, h, side) {
  put(K.lamp, swatchUV(rbox(0.08, h, w, 0.03).translate(x + side * 0.04, y, z), sw), 0xffffff);
}

// A wiper: arm and blade lying on the windscreen.
function wiper(K, x, y, z, len, ang, lean = 0) {
  const g = rbox(0.06, len, 0.05, 0.02).translate(0, len / 2, 0);
  g.rotateZ(ang);
  g.rotateX(lean);
  g.translate(x, y, z);
  put(K.dark, g, 0x141516);
}

// A truck/bus mirror head on a stalk: a dark housing with glass on its back face.
function mirrorHead(K, x, y, z, w = 0.55, h = 1.1) {
  put(K.dark, rbox(w, h, 0.22, 0.08).translate(x, y, z), 0x1c1d1f);
  put(K.glass, rbox(w - 0.08, h - 0.08, 0.04, 0.02).translate(x, y, z - 0.12), PALETTE.glass);
}

// ---------------------------------------------------------------------------------------------
// city-bus
// ---------------------------------------------------------------------------------------------

function cityBus() {
  const K = kit(512, 512);
  const A = K.atlas;
  const SW = {
    head: A.swatch('#fff4dc'), tail: A.swatch('#e3241b'), amber: A.swatch('#ffad1f'),
    marker: A.swatch('#ff8a1a'), white: A.swatch('#ffffff'), stop: A.swatch('#b8130f'),
  };
  const ROUTE = A.rect(500, 72, (ctx, w, h) => ledSign('12 DOWNTOWN', ctx, w, h));
  const ROUTE_SIDE = A.rect(300, 56, (ctx, w, h) => ledSign('12 DOWNTOWN', ctx, w, h));
  const ROUTE_REAR = A.rect(110, 70, (ctx, w, h) => ledSign('12', ctx, w, h));
  const ACCESS = A.rect(96, 96, accessSymbol);
  const NUMBER = A.rect(150, 50, (ctx, w, h) => {
    ctx.fillStyle = '#e4e6e8'; ctx.fillRect(0, 0, w, h);
    fitText(ctx, '2412', w / 2, h / 2, w * 0.9, h * 0.8, { color: '#1b2a40' });
  });
  const RIDE = A.rect(380, 64, (ctx, w, h) => {
    ctx.fillStyle = '#eef0f2'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a69b0'; ctx.fillRect(0, h * 0.82, w, h * 0.18);
    fitText(ctx, 'CITY TRANSIT', w / 2, h * 0.42, w * 0.9, h * 0.62, { color: '#1d4a80' });
  });

  const L = 40; const W = 8.5; const hw = W / 2;
  const zF = L / 2; const zR = -L / 2;
  const R = TYRE.heavy.r; const yA = R - 0.02;
  const axF = 12.6; const axR = -10.6;
  const archR = R + 0.25;
  const yb = 1.0; // the skirt
  const ySplit = 4.05; // where the blue lower body meets the white upper body, clear above the arches
  const roof = 9.85;
  const WHITE = 0xdfe2e4; const BLUE = 0x2a69b0; const DARKBLUE = 0x1d4a80;

  // Lower body: the skirt, both arches, the bumper zone.
  const lower = [
    [zR + 0.05, yb + 0.35], ...arch(axR, yA, archR, yb), ...arch(axF, yA, archR, yb), [zF, yb], [zF + 0.05, ySplit], [zR, ySplit],
  ];
  put(K.paint, profileSolid(lower, W, 0.15), BLUE);

  // Upper body: from the split to the roof, raked a little at the front.
  const upper = fillet([
    [zR, ySplit], [zF + 0.05, ySplit], [zF - 0.12, 8.4], [zF - 0.35, 9.4], [zF - 1.0, roof], [zR + 0.5, roof], [zR, roof - 0.6],
  ], [0, 0, 0, 0.6, 0.5, 0.5, 0], 5);
  put(K.paint, profileSolid(upper, W, 0.36), WHITE);

  // The rub rail where the two meet.
  put(K.dark, slab(-hw - 0.05, hw + 0.05, ySplit - 0.09, ySplit + 0.09, zR + 0.2, zF - 0.05, 0.06), 0x1b1c1e);
  put(K.paint, slab(-hw - 0.02, hw + 0.02, ySplit + 0.12, ySplit + 0.3, zR + 0.4, zF - 0.4, 0.04), DARKBLUE);

  // Wheels, wells.
  wells(K, [axF, axR], hw, R, 3.6);
  for (const side of [1, -1]) {
    wheel(K, side * (hw - 0.55), axF, side);
    wheel(K, side * (hw - 0.55), axR, side, { dual: true });
  }

  // --- side glazing: a continuous dark band, the body showing between the panes as pillars ----
  const winLo = 4.4; const winHi = 8.55;
  const sideWin = (side, z0, z1) => {
    const x = side * (hw + 0.005);
    put(K.dark, slab(x - 0.04, x + 0.04, winLo - 0.08, winHi + 0.08, z0 - 0.08, z1 + 0.08, 0.05), 0x141516);
    put(K.glass, slab(x + side * 0.03 - 0.025, x + side * 0.03 + 0.025, winLo, winHi, z0, z1, 0.06), PALETTE.glass);
    // the sliding upper vent of each pane
    put(K.dark, slab(x + side * 0.06 - 0.015, x + side * 0.06 + 0.015, winHi - 1.05, winHi - 0.98, z0 + 0.05, z1 - 0.05, 0.01), 0x2b2d30);
  };
  // Curb side (-X): front door 15.1..18.9, middle door -6.6..-2.8.
  const curbPanes = [[-18.6, -14.9], [-14.6, -11.0], [-10.7, -7.1], [-2.4, 1.3], [1.6, 5.3], [5.6, 9.3], [9.6, 14.6]];
  for (const [a, b] of curbPanes) sideWin(-1, a, b);
  const drvPanes = [[-18.6, -14.9], [-14.6, -11.0], [-10.7, -7.1], [-6.8, -3.1], [-2.8, 0.9], [1.2, 4.9], [5.2, 8.9], [9.2, 12.9], [13.2, 16.4]];
  for (const [a, b] of drvPanes) sideWin(1, a, b);
  // The driver's window, its own pane forward of the rest, lower sill.
  sideWin(1, 16.7, 19.4);

  // --- doors: two-leaf glass doors in dark frames, on the curb side -----------------------
  const door = (z0, z1) => {
    const x = -hw - 0.01;
    put(K.dark, slab(x - 0.06, x + 0.06, yb + 0.1, 9.1, z0 - 0.12, z1 + 0.12, 0.05), 0x1a1b1d);
    const mid = (z0 + z1) / 2;
    for (const [a, b] of [[z0, mid - 0.04], [mid + 0.04, z1]]) {
      put(K.metal, slab(x - 0.1, x - 0.04, yb + 0.15, 9.0, a, b, 0.04), 0x55595e);
      put(K.glass, slab(x - 0.13, x - 0.09, yb + 0.35, 4.6, a + 0.14, b - 0.14, 0.04), PALETTE.glass);
      put(K.glass, slab(x - 0.13, x - 0.09, 4.85, 8.8, a + 0.14, b - 0.14, 0.04), PALETTE.glass);
      put(K.dark, slab(x - 0.15, x - 0.1, 4.62, 4.83, a + 0.1, b - 0.1, 0.02), 0x222325);
    }
    // the rubber nosing where the leaves meet
    put(K.dark, slab(x - 0.16, x - 0.08, yb + 0.15, 9.0, mid - 0.05, mid + 0.05, 0.03), 0x101112);
  };
  door(15.15, 18.95);
  door(-6.6, -2.8);
  // The access symbol on the front door's rear leaf, and the side route sign above the windows.
  put(K.sign, plate(0.9, 0.9, 0.034, ACCESS).rotateY(-Math.PI / 2).translate(-hw - 0.15, 3.65, 18.0), 0xffffff);
  put(K.dark, slab(-hw - 0.03, -hw + 0.02, 8.62, 9.42, 9.8, 14.3, 0.03), 0x0e0e0f);
  put(K.lamp, plate(4.3, 0.66, 0.03, ROUTE_SIDE).rotateY(-Math.PI / 2).translate(-hw - 0.04, 9.02, 12.05), 0xffffff);
  // Fleet number and livery panels.
  for (const side of [1, -1]) {
    put(K.sign, plate(4.6, 0.78, 0.03, RIDE).rotateY(side * Math.PI / 2).translate(side * (hw + 0.015), 2.6, side > 0 ? -1 : 1.5), 0xffffff);
  }
  put(K.sign, plate(1.1, 0.36, 0.03, NUMBER).rotateY(Math.PI / 2).translate(hw + 0.02, 8.95, 17.4), 0xffffff);

  // --- the front ---------------------------------------------------------------------------
  // Windscreen: one big pane on the raked face, the destination sign above it.
  const fz0 = zF + 0.05; const fz1 = zF - 0.12; // the face runs from (fz0, ySplit) up to (fz1, 8.4)
  // The face is the upper body's segment from (zF + 0.05, ySplit) to (zF - 0.12, 8.4); its outward
  // normal points +Z. onSegment's off is measured along that normal, so a positive offset is proud.
  const face = (y0, y1, x0, x1, off, t, list, color, r = 0.04) => {
    const k0 = (y0 - ySplit) / (8.4 - ySplit); const k1 = (y1 - ySplit) / (8.4 - ySplit);
    const za = fz0 + (fz1 - fz0) * k0; const zb = fz0 + (fz1 - fz0) * k1;
    // onSegment wants the profile direction of travel, which runs up the front face.
    put(list, onSegment(za, y0, zb, y1, x0, x1, { off, t, r }), color);
  };
  face(4.25, 8.35, -hw + 0.2, hw - 0.2, 0.0, 0.08, K.dark, 0x141516);
  face(4.35, 8.25, -hw + 0.32, hw - 0.32, 0.05, 0.05, K.glass, PALETTE.glass);
  // destination sign box above, on the sloped header
  put(K.dark, onSegment(zF - 0.14, 8.45, zF - 0.34, 9.35, -3.3, 3.3, { off: 0.0, t: 0.1, r: 0.04 }), 0x0d0d0e);
  put(K.lamp, plate(6.3, 0.8, 0.03, ROUTE).rotateX(-Math.atan2(0.2, 0.9)).translate(0, 8.9, zF - 0.17), 0xffffff);
  // wipers, parked at the bottom of the screen
  wiper(K, -1.6, 4.55, zF + 0.1, 2.6, -1.35, -0.03);
  wiper(K, 1.9, 4.55, zF + 0.1, 2.6, -1.35, -0.03);
  // headlights, turn lamps, the bumper and its number plate area
  for (const side of [1, -1]) {
    lampAt(K, SW.head, side * 3.3, 2.35, zF + 0.05, 0.9, 0.42, 1);
    lampAt(K, SW.head, side * 2.3, 2.35, zF + 0.05, 0.55, 0.42, 1);
    lampAt(K, SW.amber, side * 3.5, 3.15, zF + 0.05, 0.6, 0.2, 1);
    // marker lamps high on the front corners
    lampAt(K, SW.marker, side * 3.7, 9.55, zF - 0.6, 0.22, 0.12, 1);
  }
  put(K.dark, slab(-hw + 0.02, hw - 0.02, yb - 0.02, 1.95, zF - 0.1, zF + 0.32, 0.14), 0x1e1f21);
  put(K.dark, slab(-0.9, 0.9, 1.15, 1.75, zF + 0.32, zF + 0.36, 0.02), 0x2c2d30);

  // The bike rack, folded down: a frame on two pivots at the bumper with two wheel trays across it.
  const rackY = 1.55; const rz0 = zF + 0.36; const rz1 = zF + 2.75;
  for (const x of [-1.7, 1.7]) {
    put(K.metal, rod([x, rackY, rz0], [x, rackY, rz1], 0.07), 0x2f3236);
    put(K.metal, rod([x, rackY - 0.4, zF + 0.34], [x, rackY - 0.02, zF + 1.3], 0.05), 0x2f3236);
  }
  put(K.metal, rod([-1.8, rackY, rz1], [1.8, rackY, rz1], 0.07), 0x2f3236);
  for (const z of [zF + 1.2, zF + 2.1]) {
    // a tray: a channel across the bus, with its upturned ends
    put(K.metal, slab(-2.4, 2.4, rackY - 0.06, rackY + 0.04, z - 0.18, z + 0.18, 0.03), 0x3a3d42);
    put(K.metal, slab(-2.4, 2.4, rackY + 0.04, rackY + 0.16, z - 0.2, z - 0.15, 0), 0x3a3d42);
    put(K.metal, slab(-2.4, 2.4, rackY + 0.04, rackY + 0.16, z + 0.15, z + 0.2, 0), 0x3a3d42);
    for (const x of [-2.4, 2.4]) put(K.metal, slab(x - 0.06, x + 0.06, rackY, rackY + 0.5, z - 0.2, z + 0.2, 0.03), 0x3a3d42);
  }
  // the wheel hooks, folded flat
  for (const x of [-0.7, 0.9]) put(K.metal, rod([x, rackY + 0.1, rz0 + 0.1], [x, rackY + 0.12, rz1 - 0.2], 0.05), 0xd8b221);

  // Bull-horn mirrors: arms from the roof corners, heads hanging just outside the windscreen.
  for (const side of [1, -1]) {
    const a = [side * (hw - 0.5), 9.3, zF - 0.6];
    const b = [side * (hw + 0.15), 9.45, zF + 0.9];
    const c = [side * (hw + 0.35), 8.6, zF + 1.25];
    put(K.dark, tube([a, b, c], 0.07, { sides: 8 }), 0x1c1d1f);
    mirrorHead(K, side * (hw + 0.38), 7.95, zF + 1.25, 0.5, 1.2);
  }

  // --- the rear ----------------------------------------------------------------------------
  put(K.dark, slab(-hw + 0.02, hw - 0.02, yb + 0.25, 2.0, zR - 0.3, zR + 0.1, 0.12), 0x1e1f21);
  // engine door with its louvres
  put(K.paint, slab(-3.4, 3.4, 2.2, 5.9, zR - 0.06, zR + 0.05, 0.05), 0xd4d7da);
  for (let i = 0; i < 9; i++) {
    const y = 2.6 + i * 0.32;
    put(K.dark, slab(-2.6, 2.6, y, y + 0.14, zR - 0.1, zR - 0.04, 0.02), 0x2a2b2d);
  }
  // a small rear window up top, the route number, tail lamps in tall clusters
  put(K.dark, slab(-3.4, 3.4, 6.3, 8.4, zR - 0.06, zR + 0.05, 0.05), 0x141516);
  put(K.glass, slab(-3.25, 3.25, 6.42, 8.28, zR - 0.1, zR - 0.04, 0.05), PALETTE.glass);
  put(K.dark, slab(-0.8, 0.8, 8.5, 9.15, zR - 0.08, zR + 0.05, 0.03), 0x0d0d0e);
  put(K.lamp, plate(1.35, 0.5, 0.03, ROUTE_REAR).rotateY(Math.PI).translate(0, 8.825, zR - 0.1), 0xffffff);
  for (const side of [1, -1]) {
    lampAt(K, SW.tail, side * 3.75, 4.3, zR, 0.42, 0.42, -1, { round: true });
    lampAt(K, SW.amber, side * 3.75, 3.4, zR, 0.42, 0.42, -1, { round: true });
    lampAt(K, SW.tail, side * 3.75, 5.2, zR, 0.42, 0.42, -1, { round: true });
    lampAt(K, SW.marker, side * 3.7, 9.4, zR + 0.55, 0.22, 0.12, -1);
    // side marker lamps along the skirt
    for (const z of [-17.5, 0.5, 17.5]) sideLamp(K, SW.marker, side * hw, 1.6, z, 0.3, 0.12, side);
  }

  // --- the roof: the equipment pod and the air conditioner ------------------------------------
  const pod = fillet([[-18.6, roof - 0.1], [6.0, roof - 0.1], [7.4, roof + 0.62], [-18.2, roof + 0.62]], [0, 0.3, 0.25, 0.25], 3);
  put(K.paint, profileSolid(pod, 7.0, 0.12), 0xd3d6d9);
  put(K.dark, slab(-3.2, 3.2, roof + 0.62, roof + 0.66, -16.5, -9.5, 0.02), 0x3a3c40);
  for (let i = 0; i < 2; i++) {
    put(K.dark, cylY(0.75, 0.06, 20).translate(-1.5 + i * 3, roof + 0.66, -13), 0x26272a);
  }
  // roof hatches
  for (const z of [10.5, -3.0]) put(K.paint, slab(-1.3, 1.3, roof - 0.05, roof + 0.18, z - 1.2, z + 1.2, 0.08), 0xc9ccd0);

  return finish(K);
}


// ---------------------------------------------------------------------------------------------
// school-bus
// ---------------------------------------------------------------------------------------------

function schoolBus() {
  const K = kit(512, 512);
  const A = K.atlas;
  const SW = {
    head: A.swatch('#fff4dc'), tail: A.swatch('#e3241b'), amber: A.swatch('#ffa21a'), red: A.swatch('#ff2a1c'),
    white: A.swatch('#ffffff'), strobe: A.swatch('#f2f6ff'), marker: A.swatch('#ff8a1a'),
  };
  const YEL = PALETTE.schoolBusYellow;
  const yellowCss = '#f2b21b';
  const lettered = (text, frame = true) => (ctx, w, h) => {
    ctx.fillStyle = yellowCss; ctx.fillRect(0, 0, w, h);
    if (frame) { ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(3, h * 0.07); ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth); }
    fitText(ctx, text, w / 2, h / 2 + h * 0.03, w * 0.88, h * 0.7, { weight: 900, color: '#111' });
  };
  const SCHOOL_BUS = A.rect(300, 72, lettered('SCHOOL BUS'));
  const SCHOOL_BUS_REAR = A.rect(300, 72, lettered('SCHOOL BUS'));
  const DISTRICT = A.rect(500, 54, lettered('CITY PUBLIC SCHOOLS', false));
  const DISTRICT2 = A.rect(500, 54, lettered('CITY PUBLIC SCHOOLS', false));
  const NUMBER = A.rect(80, 60, lettered('7', false));
  const EMERGENCY = A.rect(300, 46, lettered('EMERGENCY DOOR', false));
  const FLASH = A.rect(320, 110, (ctx, w, h) => {
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = yellowCss; ctx.fillRect(5, 5, w - 10, h - 10);
    fitText(ctx, 'STOP WHEN', w / 2, h * 0.3, w * 0.86, h * 0.34, { weight: 900, color: '#111' });
    fitText(ctx, 'RED LIGHTS FLASH', w / 2, h * 0.7, w * 0.86, h * 0.34, { weight: 900, color: '#111' });
  });
  const STOP = A.rect(160, 160, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    const oct = (rad) => {
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
        const x = w / 2 + Math.cos(a) * rad; const y = h / 2 + Math.sin(a) * rad;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    oct(w * 0.5 * 0.995); ctx.fillStyle = '#ffffff'; ctx.fill();
    oct(w * 0.455); ctx.fillStyle = '#c8161a'; ctx.fill();
    fitText(ctx, 'STOP', w / 2, h / 2 + h * 0.02, w * 0.72, h * 0.36, { weight: 900, color: '#ffffff' });
  });

  const W = 8.0; const hw = W / 2; const wallT = 0.22;
  const zR = -19.0; const zCab = 13.8; const zNose = 19.05;
  const R = TYRE.heavy.r; const yA = R - 0.02; const archR = R + 0.3;
  const axF = 14.6; const axR = -8.4;
  const yb = 2.15; const floorY = 3.0; const sill = 5.3; const winTop = 8.3; const railTop = 8.55;
  const doorZ0 = 9.95; const doorZ1 = 12.3;
  const SEAT = 0x4f6b3e; const LINER = 0xd8d4c8; const FLOOR = 0x3c3d40;

  // --- the side walls, solid only up to the window sills -------------------------------------
  const wall = (side, z0, z1, { frontArch = false } = {}) => {
    const bottom = [];
    if (z0 < axR && z1 > axR) bottom.push(...arch(axR, yA, archR, yb, 12));
    let tail;
    if (frontArch && z1 > axF - archR) tail = archTo(axF, yA, archR, yb, z1, 10);
    else tail = [[z1, yb]];
    const pts = [[z0, yb + 0.25], ...bottom, ...tail, [z1, sill], [z0, sill]];
    const x = side * (hw - wallT / 2);
    put(K.paint, profileSolid(fillet(pts, pts.map((p, i) => (i === 0 || i >= pts.length - 2 ? 0.08 : 0)), 2), wallT, 0.07, { x }), YEL);
    // the pale lining inside, floor to sill
    put(K.paint, slab(x - side * (wallT / 2 + 0.03), x - side * wallT / 2, floorY, sill - 0.05, Math.max(z0, zR + 0.3), Math.min(z1, 12.9), 0), LINER);
  };
  wall(1, zR, zCab, { frontArch: true });
  wall(-1, zR, doorZ0);
  wall(-1, doorZ1, zCab, { frontArch: true });

  // --- the window band: pillars, glass, the frames that split each window -------------------
  const pillar = (side, z0, z1) => put(K.paint, slab(side * (hw - wallT), side * hw, sill - 0.02, railTop, z0, z1, 0), YEL);
  const pane = (side, z0, z1, y0 = sill + 0.05, y1 = winTop) => {
    const x = side * (hw - 0.1);
    put(K.glass, slab(x - 0.025, x + 0.025, y0, y1, z0, z1, 0), 0x5a6e80);
    // the aluminium frame and the meeting rail halfway up, where the upper sash drops
    const fx = side * (hw + 0.005);
    put(K.metal, slab(fx - 0.03, fx + 0.03, y0 - 0.02, y0 + 0.08, z0, z1, 0), 0xb9bdc2);
    put(K.metal, slab(fx - 0.03, fx + 0.03, y1 - 0.08, y1 + 0.02, z0, z1, 0), 0xb9bdc2);
    const ym = (y0 + y1) / 2 + 0.2;
    put(K.metal, slab(fx - 0.04, fx + 0.04, ym - 0.06, ym + 0.06, z0, z1, 0), 0xb9bdc2);
    for (const z of [z0 + 0.04, z1 - 0.04]) put(K.metal, slab(fx - 0.03, fx + 0.03, y0, y1, z - 0.04, z + 0.04, 0), 0xb9bdc2);
  };
  const bay = 2.55; const winStart = zR + 0.25;
  const nWin = 11;
  for (const side of [1, -1]) {
    let z = winStart;
    pillar(side, zR, z + 0.12);
    for (let i = 0; i < nWin; i++) {
      const z0 = z + 0.12; const z1 = z + bay - 0.18;
      pane(side, z0, z1);
      pillar(side, z1, z1 + 0.3 + (i === nWin - 1 ? 0 : 0));
      z += bay;
    }
    // what is left before the cab
    const zLast = winStart + nWin * bay;
    if (side > 0) {
      // the driver's window, bigger, and the corner post
      pillar(side, zLast - 0.1, zLast + 0.25);
      pane(side, zLast + 0.25, zCab - 0.4, sill + 0.05, winTop);
      pillar(side, zCab - 0.4, zCab);
    } else {
      pillar(side, zLast - 0.1, doorZ0 + 0.02);
      pillar(side, doorZ1 - 0.02, doorZ1 + 0.15);
      pane(side, doorZ1 + 0.15, zCab - 0.4, sill + 0.05, winTop);
      pillar(side, zCab - 0.4, zCab);
    }
    // the rail over the windows
    put(K.paint, slab(side * (hw - wallT), side * hw, winTop, railTop, zR, zCab, 0.04), YEL);
  }
  // the band over the door
  put(K.paint, slab(-hw, -hw + wallT, winTop, railTop, doorZ0, doorZ1, 0), YEL);

  // --- the roof: a yellow crown over a white ceiling, and the two end caps ---------------------
  const outerArc = roofArc(hw, 1.45, railTop);
  const midArc = roofArc(hw - 0.12, 1.33, railTop);
  const innerArc = roofArc(hw - 0.22, 1.23, railTop);
  put(K.paint, sectionSolid([...outerArc, ...[...midArc].reverse()], zR + 0.05, zCab - 0.05, 0.03), YEL);
  put(K.paint, sectionSolid([...midArc, ...[...innerArc].reverse()], zR + 0.3, zCab - 0.3, 0.02), 0xeeeae0);
  const cap = [[hw, winTop], ...outerArc.slice(1, -1), [-hw, winTop]];
  put(K.paint, sectionSolid(cap, zCab - 0.6, zCab + 0.05, 0.12), YEL);
  put(K.paint, sectionSolid(cap, zR - 0.05, zR + 0.55, 0.12), YEL);
  // roof hatches and the white strobe
  for (const z of [6.5, -9.5]) put(K.paint, slab(-1.3, 1.3, railTop + 1.38, railTop + 1.58, z - 1.2, z + 1.2, 0.08), 0xe7e3d8);
  put(K.lamp, swatchUV(outward(lathe([[0, 0], [0.24, 0], [0.23, 0.1], [0.17, 0.2], [0, 0.25]], 12)).translate(0, railTop + 1.44, -16.5), SW.strobe), 0xffffff);
  put(K.dark, cylY(0.28, 0.1, 12).translate(0, railTop + 1.42, -16.5), 0x1b1c1e);

  // --- inside: floor, seats, the wheel boxes, the driver's place ------------------------------
  put(K.dark, slab(-hw + wallT, hw - wallT, floorY - 0.3, floorY, zR + 0.3, 13.0, 0), FLOOR);
  put(K.dark, slab(-0.6, 0.6, floorY, floorY + 0.01, zR + 0.4, 9.0, 0), 0x55575b);
  for (const side of [1, -1]) {
    put(K.dark, slab(side * 2.25, side * (hw - wallT), yb - 0.1, 4.1, axR - 2.15, axR + 2.15, 0.1), 0x2a2b2e);
  }
  const rowPitch = 2.45;
  for (const side of [1, -1]) {
    const xIn = side * 0.72; const xOut = side * (hw - wallT - 0.08);
    for (let i = 0; i < 11; i++) {
      const zb = 8.6 - i * rowPitch; // the back of the seat
      const xc = (xIn + xOut) / 2; const sw = Math.abs(xOut - xIn);
      // the high padded back, leaning a little
      const back = rbox(sw, 2.25, 0.36, 0.14).rotateX(-0.12).translate(xc, 5.2, zb + 0.18);
      put(K.paint, back, SEAT);
      put(K.paint, new THREE.BoxGeometry(sw, 0.36, 1.35).translate(xc, 4.15, zb + 0.95), SEAT);
      put(K.metal, slab(xIn - side * 0.12, xIn - side * 0.05, floorY, 3.98, zb + 0.4, zb + 1.4, 0), 0x6d7075);
    }
    // the padded barrier at the front of each side
    put(K.paint, rbox(Math.abs((hw - wallT - 0.08) - 0.72), 2.4, 0.2, 0.08).translate(side * ((hw - wallT - 0.08 + 0.72) / 2), 4.4, 9.95), SEAT);
  }
  // driver's seat on the driver's side (+X), the wheel, the dash
  put(K.dark, rbox(1.6, 2.4, 0.3, 0.12).rotateX(-0.15).translate(2.2, 5.0, 10.9), 0x2b2c2f);
  put(K.dark, rbox(1.6, 0.35, 1.5, 0.1).translate(2.2, 4.0, 11.6), 0x2b2c2f);
  put(K.dark, cylY(0.3, 1.0, 10).translate(2.2, 3.5, 11.6), 0x2b2c2f);
  put(K.dark, new THREE.TorusGeometry(0.75, 0.06, 6, 20).rotateX(-0.85).translate(2.2, 5.15, 12.55), 0x1c1d1f);
  put(K.dark, rod([2.2, 5.1, 12.6], [2.2, 4.4, 13.3], 0.08), 0x1c1d1f);
  put(K.dark, slab(-hw + wallT, hw - wallT, floorY, 5.5, 12.95, zCab - 0.05, 0.06), 0x34363a);
  // the stepwell inside the door
  for (const [y, z0] of [[2.45, -hw + 0.05], [2.75, -hw + 0.6]]) put(K.dark, slab(z0, -2.1, y - 0.12, y, doorZ0 + 0.1, doorZ1 - 0.1, 0), 0x2c2d30);

  // --- the entrance door: two glass leaves -------------------------------------------------
  {
    const x = -hw + 0.06;
    const mid = (doorZ0 + doorZ1) / 2;
    for (const [a, b] of [[doorZ0 + 0.06, mid - 0.03], [mid + 0.03, doorZ1 - 0.06]]) {
      put(K.metal, slab(x - 0.05, x + 0.05, 2.3, 2.62, a, b, 0), 0x2a2c2f);
      put(K.metal, slab(x - 0.05, x + 0.05, 4.9, 5.12, a, b, 0), 0x2a2c2f);
      put(K.metal, slab(x - 0.05, x + 0.05, 8.08, 8.28, a, b, 0), 0x2a2c2f);
      for (const z of [a + 0.06, b - 0.06]) put(K.metal, slab(x - 0.05, x + 0.05, 2.3, 8.28, z - 0.06, z + 0.06, 0), 0x2a2c2f);
      put(K.glass, slab(x - 0.02, x + 0.02, 2.62, 4.9, a + 0.1, b - 0.1, 0), 0x5a6e80);
      put(K.glass, slab(x - 0.02, x + 0.02, 5.12, 8.08, a + 0.1, b - 0.1, 0), 0x5a6e80);
    }
  }

  // --- rub rails, lettering, markers -------------------------------------------------------
  for (const side of [1, -1]) {
    for (const y of [2.5, 3.55, 4.55]) {
      const gaps = [];
      const g = archGap(axR, yA, archR, y, 0.1); if (g) gaps.push(g);
      if (side < 0) gaps.push([doorZ0 - 0.05, doorZ1 + 0.05]);
      const gf = archGap(axF, yA, archR, y, 0.1); if (gf) gaps.push(gf);
      for (const [a, b] of railRuns(zR + 0.15, zCab - 0.05, gaps)) {
        put(K.dark, slab(side * (hw - 0.02), side * (hw + 0.09), y - 0.11, y + 0.11, a, b, 0), 0x141516);
      }
    }
    // the black band at the sill
    put(K.dark, slab(side * (hw - 0.02), side * (hw + 0.07), sill - 0.12, sill + 0.02, zR + 0.15, side > 0 ? zCab - 0.05 : doorZ0 - 0.05, 0.03), 0x141516);
    put(K.sign, plate(8.2, 0.62, 0.03, side > 0 ? DISTRICT : DISTRICT2, 0.01).rotateY(side * Math.PI / 2).translate(side * (hw + 0.016), 4.05, -2.5), 0xffffff);
    for (const z of [zR + 0.8, -2.5, 11.8]) {
      if (side < 0 && z > doorZ0 - 0.5 && z < doorZ1 + 0.5) continue;
      sideLamp(K, SW.marker, side * hw, 3.05, z, 0.32, 0.14, side);
    }
    // the amber turn repeater by the cab
    sideLamp(K, SW.amber, side * hw, 6.9, zCab - 0.2, 0.3, 0.3, side);
  }
  put(K.sign, plate(0.62, 0.48, 0.03, NUMBER).rotateY(Math.PI / 2).translate(hw + 0.016, 6.9, -16.8), 0xffffff);

  // --- the front cap: SCHOOL BUS between the red and amber warning lamps --------------------
  const zc = zCab + 0.05;
  put(K.sign, plate(3.1, 0.74, 0.03, SCHOOL_BUS).translate(0, 9.05, zc + 0.015), 0xffffff);
  const warn = (zFace, facing) => {
    for (const side of [1, -1]) {
      for (const [x, sw] of [[side * 3.15, SW.red], [side * 2.25, SW.amber]]) {
        put(K.dark, slab(x - 0.38, x + 0.38, 8.68, 9.44, zFace, zFace + facing * 0.12, 0.05), 0x141516);
        put(K.lamp, swatchUV(cylZ(0.3, 0.1, 18).translate(x, 9.06, zFace + facing * 0.14), sw), 0xffffff);
        // the visor over each lamp
        put(K.dark, slab(x - 0.38, x + 0.38, 9.4, 9.46, zFace + facing * 0.1, zFace + facing * 0.42, 0), 0x141516);
      }
    }
  };
  warn(zc, 1);
  warn(zR - 0.05, -1);

  // --- the cab front: the windscreen in its frame, the cowl under it -----------------------
  put(K.paint, slab(-hw, hw, floorY - 0.2, 5.62, 13.05, zCab + 0.05, 0.06), YEL);
  put(K.dark, slab(-hw + 0.12, hw - 0.12, 5.5, winTop + 0.05, zCab - 0.12, zCab + 0.08, 0.05), 0x141516);
  for (const [a, b] of [[-hw + 0.24, -0.07], [0.07, hw - 0.24]]) put(K.glass, slab(a, b, 5.62, winTop - 0.06, zCab + 0.04, zCab + 0.09, 0), 0x5a6e80);
  for (const side of [1, -1]) put(K.paint, slab(side * (hw - 0.2), side * hw, sill - 0.02, railTop, zCab - 0.4, zCab + 0.05, 0.05), YEL);
  wiper(K, -2.0, 5.75, zCab + 0.14, 2.3, -1.2);
  wiper(K, 1.6, 5.75, zCab + 0.14, 2.3, -1.2);

  // --- the hood, the fenders, the grille ------------------------------------------------------
  const hood = fillet([[zCab - 0.2, 2.55], [zNose, 2.55], [zNose + 0.02, 4.95], [zNose - 0.45, 5.4], [zCab - 0.2, 5.72]], [0, 0.42, 0.45, 0.55, 0], 4);
  put(K.paint, profileSolid(hood, 5.1, 0.38), YEL);
  for (const side of [1, -1]) {
    const fz1 = zNose - 1.2;
    const fender = [
      ...archClip(axF, yA, archR, yb, zCab - 0.3, fz1, 12), [fz1, yb], [fz1 + 0.15, 3.3], [fz1 - 0.35, 4.3], [zCab - 0.3, 4.45],
    ];
    const fx = side * 3.27;
    put(K.paint, profileSolid(fillet(fender, fender.map((p, i) => (i >= fender.length - 3 ? 0.35 : 0)), 3), 1.46, 0.3, { x: fx }), YEL);
    // the dark inside of the arch
    put(K.dark, slab(side * 2.5, side * 2.64, yb - 0.1, 4.2, axF - 2.1, axF + 2.1, 0), 0x151617);
    // the step and the black fender edge
    put(K.dark, slab(side * 2.55, side * 3.95, 2.0, 2.18, fz1 - 0.2, fz1 + 0.6, 0.04), 0x141516);
  }
  // grille: chrome surround, dark core, vertical bars
  put(K.metal, slab(-1.75, 1.75, 2.8, 4.85, zNose - 0.02, zNose + 0.12, 0.08), 0xc4c8cc);
  put(K.dark, slab(-1.55, 1.55, 2.95, 4.7, zNose + 0.06, zNose + 0.16, 0), 0x111213);
  for (let i = 0; i < 9; i++) {
    const x = -1.4 + i * 0.35;
    put(K.metal, slab(x - 0.04, x + 0.04, 2.98, 4.67, zNose + 0.12, zNose + 0.2, 0), 0x9aa0a6);
  }
  for (const side of [1, -1]) {
    lampAt(K, SW.head, side * 2.1, 3.65, zNose + 0.02, 0.62, 0.62, 1, { round: true });
    lampAt(K, SW.amber, side * 2.1, 4.55, zNose - 0.2, 0.42, 0.22, 1);
  }
  // the bumper and the stowed crossing arm on the curb end of it
  put(K.dark, slab(-hw + 0.05, hw - 0.05, 1.75, 2.62, zNose - 0.1, zNose + 0.45, 0.1), 0x151617);
  put(K.dark, slab(-hw - 0.05, -hw + 0.55, 1.9, 2.75, zNose + 0.4, zNose + 0.75, 0.06), 0x151617);
  put(K.paint, rod([-hw + 0.3, 2.35, zNose + 0.6], [0.6, 2.35, zNose + 0.62], 0.07, 10), YEL);
  put(K.paint, rod([0.4, 2.35, zNose + 0.6], [0.6, 2.35, zNose + 0.62], 0.11, 10), YEL);

  // --- mirrors: tall flat mirrors by the windscreen, convex crossview mirrors on the fenders ---
  for (const side of [1, -1]) {
    put(K.dark, rod([side * hw, 7.7, zCab - 0.2], [side * (hw + 0.55), 7.7, zCab + 0.55], 0.05), 0x1b1c1e);
    put(K.dark, rod([side * hw, 5.9, zCab - 0.2], [side * (hw + 0.55), 6.2, zCab + 0.55], 0.05), 0x1b1c1e);
    mirrorHead(K, side * (hw + 0.6), 6.95, zCab + 0.6, 0.55, 1.35);
    put(K.dark, rod([side * 3.3, 4.4, zNose - 1.4], [side * 3.75, 5.3, zNose - 0.4], 0.04), 0x1b1c1e);
    // the housing's black back faces forward and the convex glass faces back at the driver: two
    // half-spheres meeting at one rim, so the mirror is a closed lens
    put(K.dark, new THREE.SphereGeometry(0.34, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).rotateX(Math.PI / 2).rotateY(-side * 0.5).translate(side * 3.8, 5.35, zNose - 0.35), 0x1b1c1e);
    put(K.dark, new THREE.SphereGeometry(0.34, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.3, 1).rotateX(-Math.PI / 2).rotateY(-side * 0.5).translate(side * 3.8, 5.35, zNose - 0.35), 0x3c4a58);
  }

  // --- the STOP arm, swung out on the driver's side, with its two red lamps -------------------
  {
    const x = hw + 1.35; const y = 5.95; const z = 11.2;
    put(K.dark, slab(hw, hw + 0.25, y - 0.6, y + 0.6, z - 0.12, z + 0.12, 0.04), 0x141516);
    put(K.dark, slab(hw + 0.2, x - 0.6, y - 0.08, y + 0.08, z - 0.05, z + 0.05, 0), 0x141516);
    put(K.sign, octagon(0.82, 0.06, STOP).translate(x, y, z), 0xffffff);
    for (const dy of [0.95, -0.95]) {
      put(K.dark, cylZ(0.15, 0.16, 12).translate(x, y + dy, z), 0x141516);
      put(K.lamp, swatchUV(cylZ(0.12, 0.2, 12).translate(x, y + dy, z), SW.red), 0xffffff);
    }
  }

  // --- the rear: emergency door, its window, lamps, the warning sign, the bumper ----------------
  const zb = zR;
  // the rear wall, built round the emergency door's window opening
  const rw = (x0, x1, y0, y1) => put(K.paint, slab(x0, x1, y0, y1, zb - 0.05, zb + 0.22, 0), YEL);
  rw(-hw, -1.35, yb, railTop); rw(1.35, hw, yb, railTop); rw(-1.35, 1.35, yb, 5.45); rw(-1.35, 1.35, 7.95, railTop);
  put(K.paint, slab(-hw + wallT, hw - wallT, floorY, sill - 0.05, zb + 0.22, zb + 0.26, 0), LINER);
  put(K.glass, slab(-1.35, 1.35, 5.45, 7.95, zb + 0.06, zb + 0.1, 0), 0x5a6e80);
  // the door's outline, hinges and handle
  for (const [x0, x1, y0, y1] of [[-1.55, -1.45, yb + 0.2, 8.25], [1.45, 1.55, yb + 0.2, 8.25], [-1.55, 1.55, 8.15, 8.25], [-1.5, 1.5, 5.3, 5.45], [-1.5, 1.5, 7.95, 8.08], [-1.5, -1.35, 5.45, 7.95], [1.35, 1.5, 5.45, 7.95]]) {
    put(K.dark, slab(x0, x1, y0, y1, zb - 0.12, zb - 0.04, 0), 0x141516);
  }
  put(K.metal, slab(0.9, 1.3, 4.9, 5.05, zb - 0.18, zb - 0.06, 0.02), 0xc4c8cc);
  put(K.sign, plate(2.6, 0.4, 0.03, EMERGENCY).rotateY(Math.PI).translate(0, 8.7, zb - 0.1), 0xffffff);
  put(K.sign, plate(2.7, 0.93, 0.03, FLASH).rotateY(Math.PI).translate(0, 4.3, zb - 0.07), 0xffffff);
  put(K.sign, plate(3.1, 0.74, 0.03, SCHOOL_BUS_REAR).rotateY(Math.PI).translate(0, 9.05, zb - 0.065), 0xffffff);
  for (const side of [1, -1]) {
    lampAt(K, SW.tail, side * 2.9, 3.6, zb - 0.05, 0.62, 0.62, -1, { round: true });
    lampAt(K, SW.amber, side * 2.9, 4.5, zb - 0.05, 0.5, 0.5, -1, { round: true });
    lampAt(K, SW.white, side * 2.15, 3.6, zb - 0.05, 0.34, 0.34, -1, { round: true });
  }
  put(K.dark, slab(-hw - 0.02, hw + 0.02, 1.85, 2.65, zb - 0.45, zb + 0.15, 0.1), 0x151617);

  // --- wheels ---------------------------------------------------------------------------------
  for (const side of [1, -1]) {
    wheel(K, side * 3.3, axF, side, { rim: 0xcfd2d5 });
    wheel(K, side * (hw - 0.55), axR, side, { dual: true, rim: 0xcfd2d5 });
  }
  put(K.dark, cylX(0.22, W - 1.4, 10).translate(0, yA, axR), 0x2a2b2d);
  put(K.dark, cylX(0.2, 6.0, 10).translate(0, yA, axF), 0x2a2b2d);
  // the frame rails and the fuel tank under the floor
  for (const side of [1, -1]) put(K.dark, slab(side * 1.2, side * 1.6, 1.7, 2.75, zR + 1.0, zNose - 0.4, 0), 0x202123);

  return finish(K, { glassClear: true, paintRough: 0.36 });
}

// ---------------------------------------------------------------------------------------------
// fire-engine
// ---------------------------------------------------------------------------------------------

// A roll-up compartment door on a side wall facing `side`: a brushed panel of slats in a frame,
// with the lift bar along the bottom.
function rollDoor(K, side, xFace, z0, z1, y0, y1) {
  const x = xFace;
  put(K.metal, slab(x - side * 0.01, x + side * 0.05, y0 - 0.08, y1 + 0.08, z0 - 0.08, z1 + 0.08, 0), 0x8c9096);
  put(K.metal, slab(x + side * 0.03, x + side * 0.08, y0, y1, z0, z1, 0), 0xc9cdd2);
  for (let y = y0 + 0.34; y < y1 - 0.1; y += 0.34) {
    put(K.dark, slab(x + side * 0.075, x + side * 0.09, y - 0.02, y + 0.02, z0 + 0.02, z1 - 0.02, 0), 0x55595f);
  }
  put(K.metal, slab(x + side * 0.06, x + side * 0.16, y0, y0 + 0.2, z0 + 0.02, z1 - 0.02, 0), 0xe1e4e7);
}

function fireEngine() {
  const K = kit(512, 512);
  const A = K.atlas;
  const SW = {
    head: A.swatch('#fff4dc'), tail: A.swatch('#e3241b'), amber: A.swatch('#ffa21a'), red: A.swatch('#ff2a1c'),
    white: A.swatch('#ffffff'), clear: A.swatch('#e8f0ff'), marker: A.swatch('#ff8a1a'),
  };
  const RED = PALETTE.fireRed; const WHITE = 0xe9e6df; const CHROME = 0xd6dade;
  const ENGINE = A.rect(260, 60, (ctx, w, h) => {
    ctx.fillStyle = '#121214'; ctx.fillRect(0, 0, w, h);
    fitText(ctx, 'ENGINE 1', w / 2, h / 2 + 2, w * 0.9, h * 0.72, { weight: 900, color: '#f2c14e' });
  });
  const badge = (ctx, w, h) => {
    ctx.fillStyle = '#e2b13c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9e1919'; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f6d36d'; ctx.lineWidth = w * 0.03; ctx.beginPath(); ctx.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2); ctx.stroke();
    fitText(ctx, 'CITY', w / 2, h * 0.27, w * 0.4, h * 0.11, { weight: 900, color: '#f6d36d' });
    fitText(ctx, '1', w / 2, h * 0.5, w * 0.3, h * 0.3, { weight: 900, color: '#ffffff' });
    fitText(ctx, 'FIRE DEPT', w / 2, h * 0.74, w * 0.5, h * 0.1, { weight: 900, color: '#f6d36d' });
  };
  const BADGE_L = A.rect(128, 128, badge);
  const BADGE_R = A.rect(128, 128, badge);
  const GAUGE = A.rect(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#fbfbf7'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * 0.75 + (k / 10) * Math.PI * 1.5;
      ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * w * 0.3, h / 2 + Math.sin(a) * h * 0.3);
      ctx.lineTo(w / 2 + Math.cos(a) * w * 0.42, h / 2 + Math.sin(a) * h * 0.42); ctx.stroke();
    }
    ctx.fillStyle = '#c11'; ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.5);
    ctx.fillRect(-1.5, -h * 0.36, 3, h * 0.4); ctx.restore();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 3, 0, Math.PI * 2); ctx.fill();
  });
  const CHEVRON = A.rect(200, 120, (ctx, w, h) => {
    ctx.fillStyle = '#f2c81e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c4161b';
    for (let k = -4; k < 8; k++) {
      const x = k * 40;
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 20, h); ctx.lineTo(x + 20 + h * 0.8, 0); ctx.lineTo(x + h * 0.8, 0); ctx.closePath(); ctx.fill();
    }
  });
  const TAGS = ['#d33', '#2a6fd6', '#f0c020', '#2f9e44', '#f08a1c', '#eeeeee'].map((c) => A.swatch(c));

  const zF = 17.0; const zR = -17.5;
  const R = TYRE.heavy.r; const yA = R - 0.02; const archR = R + 0.3;
  const axF = 14.3; const axR = -6.8;
  const yb = 1.95;
  const cabW = 8.2; const cw = cabW / 2; const bodyW = 7.9; const bw = bodyW / 2;
  const zCab = 7.6; const zPump0 = 5.1; const yTop = 7.5;
  const roof = 9.5; const ySplit = 8.75;

  // --- the cab: red to the top of the glass, white roof above it -----------------------------
  put(K.paint, profileSolid(fillet([[zCab, yb + 0.15], ...arch(axF, yA, archR, yb, 12), [zF, yb], [zF + 0.05, 4.8], [zF - 0.14, ySplit], [zCab, ySplit]], 0), cabW, 0.24), RED);
  const roofOutline = fillet([[zCab, ySplit], [zF - 0.14, ySplit], [zF - 0.32, roof], [zCab, roof]], [0, 0, 0.42, 0.36], 4);
  put(K.paint, profileSolid(roofOutline, cabW, 0.3), WHITE);
  // the reflective stripe round the cab, and along the body under the compartments
  for (const side of [1, -1]) {
    // the arches stop below 3.8ft, so the stripe runs the full length of the cab over them
    put(K.paint, slab(side * (cw - 0.02), side * (cw + 0.03), 4.35, 4.85, zCab + 0.1, zF - 0.1, 0), WHITE);
    put(K.paint, slab(side * (cw + 0.0), side * (cw + 0.04), 4.27, 4.35, zCab + 0.1, zF - 0.1, 0), 0xd9a63a);
  }
  put(K.paint, slab(-cw + 0.3, cw - 0.3, 4.35, 4.85, zF + 0.0, zF + 0.1, 0), WHITE);

  // windscreen and cab windows
  const faceZ = (y) => (zF + 0.05) + ((zF - 0.14) - (zF + 0.05)) * ((y - 4.8) / (ySplit - 4.8));
  put(K.dark, onSegment(faceZ(5.35), 5.35, faceZ(8.65), 8.65, -cw + 0.25, cw - 0.25, { off: 0.0, t: 0.08, r: 0.04 }), 0x141516);
  for (const [a, b] of [[-cw + 0.35, -0.06], [0.06, cw - 0.35]]) put(K.glass, onSegment(faceZ(5.45), 5.45, faceZ(8.55), 8.55, a, b, { off: 0.05, t: 0.04, r: 0 }), PALETTE.glass);
  wiper(K, -2.2, 5.6, zF + 0.12, 2.2, -1.25);
  wiper(K, 1.4, 5.6, zF + 0.12, 2.2, -1.25);
  const doorF = [10.25, 12.35]; const doorC = [7.85, 10.05];
  for (const side of [1, -1]) {
    const x = side * cw;
    const win = (z0, z1, y0 = 5.9) => {
      put(K.dark, slab(x - 0.03, x + side * 0.05, y0 - 0.08, 8.68, z0 - 0.08, z1 + 0.08, 0), 0x141516);
      put(K.glass, slab(x + side * 0.03, x + side * 0.07, y0, 8.6, z0, z1, 0), PALETTE.glass);
    };
    win(doorF[0] + 0.25, doorF[1] - 0.2);
    win(doorC[0] + 0.2, doorC[1] - 0.25);
    win(12.75, zF - 0.6, 6.2);
    // door shut lines, handles, the steps under each door
    for (const [z0, z1] of [doorF, doorC]) {
      for (const z of [z0, z1]) put(K.dark, slab(x - 0.02, x + side * 0.03, yb + 0.15, ySplit - 0.05, z - 0.03, z + 0.03, 0), 0x2a1010);
      put(K.metal, slab(x, x + side * 0.1, 5.3, 5.42, z1 - 0.75, z1 - 0.25, 0.03), CHROME);
      put(K.metal, slab(x - side * 0.6, x + side * 0.05, 2.45, 2.55, z0 + 0.1, z1 - 0.1, 0), CHROME);
    }
    put(K.sign, octagon(0.68, 0.03, side > 0 ? BADGE_R : BADGE_L, 24).rotateY(side * Math.PI / 2).translate(x + side * 0.02, 3.5, (doorF[0] + doorF[1]) / 2), 0xffffff);
    // grab rails beside the doors
    put(K.metal, rod([x + side * 0.12, 3.2, doorC[0] - 0.12], [x + side * 0.12, 7.2, doorC[0] - 0.12], 0.05), CHROME);
    // West Coast mirrors on arms
    put(K.metal, rod([x, 7.2, 14.0], [x + side * 0.62, 7.4, 15.4], 0.05), CHROME);
    put(K.metal, rod([x, 5.6, 14.0], [x + side * 0.62, 6.0, 15.4], 0.05), CHROME);
    mirrorHead(K, x + side * 0.66, 6.7, 15.45, 0.55, 1.4);
  }
  put(K.sign, plate(2.4, 0.52, 0.03, ENGINE).rotateX(-0.03).translate(0, 9.02, zF - 0.14), 0xffffff);

  // --- the front: grille, lamps, the chrome bumper and its siren -------------------------------
  put(K.metal, slab(-2.2, 2.2, 2.7, 4.2, zF - 0.05, zF + 0.1, 0.06), CHROME);
  for (let i = 0; i < 6; i++) {
    const y = 2.85 + i * 0.23;
    put(K.dark, slab(-2.05, 2.05, y, y + 0.12, zF + 0.05, zF + 0.13, 0), 0x18191a);
  }
  for (const side of [1, -1]) {
    put(K.dark, slab(side * 2.4, side * 3.95, 2.75, 3.6, zF - 0.02, zF + 0.1, 0.05), 0x18191a);
    lampAt(K, SW.head, side * 2.85, 3.18, zF + 0.08, 0.6, 0.48, 1);
    lampAt(K, SW.head, side * 3.6, 3.18, zF + 0.08, 0.5, 0.48, 1);
    // the red and white flashers above them, the amber turn lamp at the corner
    lampAt(K, SW.red, side * 3.05, 4.05, zF + 0.05, 0.7, 0.36, 1);
    lampAt(K, SW.amber, side * 3.75, 4.05, zF + 0.05, 0.28, 0.36, 1);
  }
  put(K.metal, slab(-cw, cw, 1.85, 2.75, zF + 0.05, zF + 0.95, 0.12), CHROME);
  // the bumper's well, with a coiled front line in it
  put(K.dark, slab(-1.5, 1.5, 2.66, 2.78, zF + 0.2, zF + 0.85, 0), 0x18191a);
  for (let i = 0; i < 3; i++) put(K.paint, rbox(2.6, 0.16, 0.18, 0.07).translate(0, 2.85 + i * 0.15, zF + 0.4 + (i % 2) * 0.2), 0xf0c128);
  // the mechanical siren and two air horns
  put(K.metal, outward(lathe([[0, 0], [0.33, 0], [0.36, 0.5], [0.32, 0.62], [0.2, 0.68], [0, 0.7]], 16)).rotateX(Math.PI / 2).translate(-2.9, 3.05, zF + 0.5), CHROME);
  for (const x of [2.5, 3.2]) put(K.metal, outward(lathe([[0, -0.4], [0.06, -0.4], [0.07, 0.1], [0.2, 0.42], [0.21, 0.46], [0, 0.46]], 12)).rotateX(Math.PI / 2).translate(x, 2.35, zF + 0.65), CHROME);

  // --- the light bar and the roof -------------------------------------------------------------
  put(K.dark, slab(-3.7, 3.7, roof - 0.02, roof + 0.16, 15.1, 16.1, 0.06), 0x18191a);
  for (let i = 0; i < 8; i++) {
    const x = -3.25 + i * 0.93;
    const sw = (i === 3 || i === 4) ? SW.clear : SW.red;
    put(K.lamp, swatchUV(rbox(0.82, 0.34, 0.9, 0.12).translate(x, roof + 0.33, 15.6), sw), 0xffffff);
  }
  put(K.metal, slab(-1.0, 1.0, roof - 0.02, roof + 0.12, 9.0, 11.2, 0.05), 0xb9bdc2);

  // --- the pump house: stainless panels on both sides, gauges, valves, the big intake ----------
  put(K.paint, slab(-bw, bw, yb, 8.2, zPump0, zCab + 0.05, 0.08), RED);
  for (const side of [1, -1]) {
    const x = side * (bw + 0.02);
    put(K.metal, slab(x - side * 0.02, x + side * 0.06, 2.35, 7.95, zPump0 + 0.1, zCab - 0.1, 0), 0xd3d6da);
    put(K.dark, slab(x + side * 0.04, x + side * 0.07, 5.15, 5.2, zPump0 + 0.15, zCab - 0.15, 0), 0x55595f);
    // gauges: two big master gauges and a row of small ones
    for (const [z, y, r] of [[5.75, 6.95, 0.36], [6.95, 6.95, 0.36], [5.6, 5.85, 0.2], [6.15, 5.85, 0.2], [6.7, 5.85, 0.2], [7.2, 5.85, 0.2]]) {
      put(K.metal, cylX(r + 0.05, 0.1, 14).translate(x + side * 0.09, y, z), CHROME);
      put(K.sign, octagon(r, 0.03, GAUGE, 18).rotateY(side * Math.PI / 2).translate(x + side * 0.145, y, z), 0xffffff);
    }
    // discharge valves: colour-coded tags, T-handles and capped outlets
    const disc = [[5.6, 0], [6.3, 1], [7.0, 2]];
    for (const [z, k] of disc) {
      put(K.lamp, swatchUV(slab(x + side * 0.06, x + side * 0.09, 4.62, 4.88, z - 0.25, z + 0.25, 0), TAGS[k]), 0xffffff);
      put(K.metal, rod([x, 4.3, z], [x + side * 0.42, 4.3, z], 0.035, 6), CHROME);
      put(K.paint, rbox(0.12, 0.12, 0.5, 0.05).translate(x + side * 0.44, 4.3, z), [0xc62828, 0x2a6fd6, 0xe8b820][k]);
    }
    for (const [z, k] of [[5.55, 3], [7.05, 4]]) {
      put(K.metal, outward(lathe([[0, 0], [0.24, 0], [0.24, 0.12], [0.18, 0.16], [0.18, 0.3], [0.22, 0.3], [0.22, 0.42], [0, 0.42]], 14)).rotateZ(-side * Math.PI / 2).translate(x + side * 0.02, 3.1, z), CHROME);
      put(K.lamp, swatchUV(cylX(0.05, 0.05, 8).translate(x + side * 0.42, 3.42, z), TAGS[k]), 0xffffff);
    }
    // the large-diameter intake with its long-handled cap
    put(K.metal, outward(lathe([[0, 0], [0.44, 0], [0.44, 0.14], [0.36, 0.18], [0.36, 0.3], [0.46, 0.3], [0.46, 0.38], [0, 0.4]], 18)).rotateZ(-side * Math.PI / 2).translate(x + side * 0.02, 3.35, 6.3), CHROME);
    for (const a of [0, Math.PI]) put(K.metal, rod([x + side * 0.38, 3.35, 6.3], [x + side * 0.38, 3.35 + Math.cos(a) * 0.62, 6.3 + Math.sin(a) * 0.62 + 0.0001], 0.04, 6), CHROME);
    // a step and a grab rail for the operator
    put(K.metal, slab(x, x + side * 0.5, 2.05, 2.2, zPump0 + 0.2, zCab - 0.2, 0), 0xc4c8cc);
  }

  // --- the body: compartments with roll-up doors, the hose bed, the ladder ----------------------
  const body = [[zR, yb + 0.1], ...arch(axR, yA, archR, yb, 12), [zPump0 + 0.05, yb], [zPump0 + 0.05, yTop], [zR, yTop]];
  put(K.paint, profileSolid(body, bodyW, 0.2), RED);
  put(K.paint, slab(-bw, bw, yTop - 0.05, 8.35, -3.6, zPump0 + 0.05, 0.1), RED);
  for (const side of [1, -1]) {
    const x = side * bw;
    rollDoor(K, side, x, 0.3, 4.75, 2.35, 6.75);
    rollDoor(K, side, x, -4.6, 0.0, 2.35, 6.75);
    rollDoor(K, side, x, axR - 1.95, axR + 1.95, 4.15, 6.75);
    rollDoor(K, side, x, -13.0, axR - 2.25, 2.35, 6.75);
    rollDoor(K, side, x, zR + 0.35, -13.3, 2.35, 6.75);
    // the white stripe along the bottom rail, and the rub rail over the wheel
    put(K.paint, slab(x - side * 0.02, x + side * 0.03, 2.0, 2.25, zR + 0.2, axR - archR - 0.05, 0), WHITE);
    put(K.paint, slab(x - side * 0.02, x + side * 0.03, 2.0, 2.25, axR + archR + 0.05, zPump0, 0), WHITE);
    for (const z of [zR + 0.5, axR, 3.0]) sideLamp(K, SW.marker, x + side * 0.02, 7.15, z, 0.3, 0.14, side);
    // the red warning lamps high on each body corner
    put(K.lamp, swatchUV(rbox(0.12, 0.42, 0.7, 0.05).translate(x + side * 0.06, 7.75, zR + 0.9), SW.red), 0xffffff);
  }
  // the two crosslays behind the pump house: hose folded across the truck, ready to pull from either side
  for (const [k, z0, z1] of [[0, 1.5, 2.55], [1, 2.75, 3.8]]) {
    for (let i = 0; i < 3; i++) {
      put(K.paint, rbox(bodyW - 0.1 + (i % 2) * 0.08, 0.2, z1 - z0, 0.09).translate(0, 8.47 + i * 0.19, (z0 + z1) / 2), [0x3f7fc0, 0xd8d0be][k]);
    }
  }
  for (const z of [1.4, 2.65, 3.9]) put(K.metal, slab(-bw + 0.2, bw - 0.2, 8.35, 9.0, z - 0.04, z + 0.04, 0), 0xb9bdc2);
  // hose bed: low side walls, two beds of folded hose showing their loops at the open back
  for (const side of [1, -1]) put(K.paint, slab(side * (bw - 0.18), side * bw, yTop - 0.05, 8.55, zR, -3.55, 0.06), RED);
  put(K.metal, slab(-0.06, 0.06, yTop - 0.05, 8.4, zR + 0.3, -3.6, 0), 0xb9bdc2);
  const hoseCol = [0xe3bb2c, 0xdcd3c2];
  for (const [k, x0, x1] of [[0, -bw + 0.2, -0.08], [1, 0.08, bw - 0.2]]) {
    for (let i = 0; i < 4; i++) {
      const y = yTop + 0.12 + i * 0.2;
      const shift = (i % 2) * 0.12;
      put(K.paint, rbox(x1 - x0, 0.2, -3.7 - (zR + 0.1) - shift, 0.09).translate((x0 + x1) / 2, y, (zR + 0.1 + shift - 3.7) / 2), hoseCol[k]);
    }
  }
  // ground ladder racked along the curb side, on two brackets
  {
    const x = -bw - 0.2; const yL = 7.05; const yH = 8.45; const za = -15.8; const zb = 3.6;
    for (const y of [yL, yH]) put(K.metal, slab(x - 0.06, x + 0.06, y - 0.12, y + 0.12, za, zb, 0.03), 0xc9cdd1);
    for (let z = za + 0.5; z < zb - 0.3; z += 1.0) put(K.metal, rod([x, yL, z], [x, yH, z], 0.05, 6), 0xc9cdd1);
    for (const z of [-12.0, 0.6]) put(K.dark, slab(x + 0.02, -bw + 0.02, 6.85, 8.65, z - 0.15, z + 0.15, 0), 0x2a2b2d);
    // the pike pole clipped above it
    put(K.paint, rod([x - 0.08, 8.75, -14.5], [x - 0.08, 8.75, -2.0], 0.05, 6), 0xd9a400);
  }

  // --- the rear: tailboard, rear compartment, lamps, chevrons ---------------------------------
  put(K.metal, slab(-bw, bw, 1.85, 2.15, zR - 0.75, zR + 0.1, 0.04), 0xc4c8cc);
  {
    // the rear compartment door faces -Z, so it is built here rather than through rollDoor
    put(K.metal, slab(-1.9, 1.9, 2.35, 6.9, zR - 0.06, zR + 0.02, 0), 0x8c9096);
    put(K.metal, slab(-1.8, 1.8, 2.45, 6.8, zR - 0.1, zR - 0.04, 0), 0xc9cdd2);
    for (let y = 2.75; y < 6.7; y += 0.3) put(K.dark, slab(-1.78, 1.78, y - 0.02, y + 0.02, zR - 0.12, zR - 0.09, 0), 0x55595f);
    put(K.metal, slab(-1.78, 1.78, 2.45, 2.65, zR - 0.18, zR - 0.08, 0), 0xe1e4e7);
  }
  for (const side of [1, -1]) {
    put(K.sign, plate(1.5, 1.5, 0.03, CHEVRON).rotateY(Math.PI).translate(side * 2.9, 5.1, zR - 0.04), 0xffffff);
    lampAt(K, SW.tail, side * 2.9, 3.85, zR, 0.5, 0.5, -1, { round: true });
    lampAt(K, SW.amber, side * 2.9, 3.0, zR, 0.42, 0.42, -1, { round: true });
    lampAt(K, SW.white, side * 2.25, 3.0, zR, 0.3, 0.3, -1, { round: true });
    lampAt(K, SW.red, side * 3.1, 6.8, zR, 0.8, 0.36, -1);
    // grab rails either side of the hose bed
    put(K.metal, rod([side * 2.15, 3.0, zR - 0.15], [side * 2.15, 6.6, zR - 0.15], 0.045, 6), CHROME);
  }

  // --- wheels ---------------------------------------------------------------------------------
  wells(K, [axR], bw, R, 4.0);
  put(K.dark, slab(-2.45, 2.45, yb - 0.1, 4.0, axF - 2.1, axF + 2.1, 0), 0x151617);
  for (const side of [1, -1]) {
    wheel(K, side * (cw - 0.6), axF, side, { rim: CHROME, hubCap: 0xe6e9ec });
    wheel(K, side * (bw - 0.55), axR, side, { dual: true, rim: CHROME, hubCap: 0xe6e9ec });
  }
  put(K.dark, cylX(0.2, cabW - 1.4, 10).translate(0, yA, axF), 0x2a2b2d);
  for (const side of [1, -1]) put(K.dark, slab(side * 1.2, side * 1.6, 1.6, 2.6, zR + 1.0, zF - 0.5, 0), 0x202123);

  return finish(K, { paintRough: 0.34 });
}

// ---------------------------------------------------------------------------------------------
// garbage-truck
// ---------------------------------------------------------------------------------------------

// Three chasing arrows round a triangle, drawn rather than typed.
function recycleMark(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = r * 0.22; ctx.lineCap = 'butt';
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k / 3) * Math.PI * 2);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, -Math.PI / 2 + 0.28, -Math.PI / 2 + 1.55);
    ctx.stroke();
    const a = -Math.PI / 2 + 1.62;
    const tx = Math.cos(a) * r * 0.62; const ty = Math.sin(a) * r * 0.62;
    ctx.translate(tx, ty); ctx.rotate(a + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(r * 0.28, 0); ctx.lineTo(-r * 0.05, -r * 0.24); ctx.lineTo(-r * 0.05, r * 0.24); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function garbageTruck() {
  const K = kit(512, 512);
  const A = K.atlas;
  const SW = {
    head: A.swatch('#fff4dc'), tail: A.swatch('#e3241b'), amber: A.swatch('#ffa21a'), white: A.swatch('#ffffff'),
    marker: A.swatch('#ff8a1a'), beacon: A.swatch('#ffb11f'),
  };
  const GREEN = 0x2f7a43; const DKGREEN = 0x245f35; const CAB = 0xe4e2dc;
  const sideSign = (ctx, w, h) => {
    ctx.fillStyle = '#f1f1ec'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f7a43'; ctx.fillRect(0, 0, w, h * 0.1); ctx.fillRect(0, h * 0.9, w, h * 0.1);
    recycleMark(ctx, h * 0.56, h * 0.5, h * 0.36, '#2f7a43');
    fitText(ctx, 'CITY', h * 1.1 + (w - h * 1.1) / 2, h * 0.32, (w - h * 1.2) * 0.9, h * 0.3, { weight: 900, color: '#245f35' });
    fitText(ctx, 'SANITATION', h * 1.1 + (w - h * 1.1) / 2, h * 0.66, (w - h * 1.2) * 0.92, h * 0.3, { weight: 900, color: '#245f35' });
  };
  const SIDE_L = A.rect(400, 120, sideSign);
  const SIDE_R = A.rect(400, 120, sideSign);
  const STAY = A.rect(300, 100, (ctx, w, h) => {
    ctx.fillStyle = '#f2c81e'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    fitText(ctx, 'STAY BACK', w / 2, h * 0.36, w * 0.86, h * 0.38, { weight: 900, color: '#111' });
    fitText(ctx, '50 FEET', w / 2, h * 0.72, w * 0.6, h * 0.28, { weight: 900, color: '#111' });
  });
  const NUMBER = A.rect(110, 60, (ctx, w, h) => {
    ctx.fillStyle = '#f1f1ec'; ctx.fillRect(0, 0, w, h);
    fitText(ctx, '31', w / 2, h / 2, w * 0.8, h * 0.8, { weight: 900, color: '#222' });
  });
  const CHEVRON = A.rect(160, 100, (ctx, w, h) => {
    ctx.fillStyle = '#f2c81e'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c4161b';
    for (let k = -4; k < 8; k++) {
      const x = k * 34;
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 17, h); ctx.lineTo(x + 17 + h * 0.8, 0); ctx.lineTo(x + h * 0.8, 0); ctx.closePath(); ctx.fill();
    }
  });

  const zF = 15.0; const zR = -15.0;
  const R = TYRE.heavy.r; const yA = R - 0.02; const archR = R + 0.28;
  const axF = 12.4; const axR1 = -4.1; const axR2 = -8.5;
  const cabW = 7.9; const cw = cabW / 2; const W = 8.0; const hw = W / 2;
  const zCab = 8.6; const yb = 1.95;
  const bodyBot = 3.65; const bodyTop = 10.85; const zBody0 = -7.4; const zBody1 = 8.25;

  // --- the cab-over cab: flat front, a big screen, low entry behind the front wheel ------------
  const cab = fillet([
    [zCab, yb + 0.1], ...arch(axF, yA, archR, yb, 12), [zF, yb], [zF + 0.08, 4.7], [zF - 0.18, 8.55], [zF - 0.7, 9.15], [zCab, 9.15],
  ], 0);
  put(K.paint, profileSolid(fillet(cab, cab.map((p, i) => (i >= cab.length - 3 ? 0.45 : 0)), 4), cabW, 0.3), CAB);
  // a green band round the cab under the glass
  for (const side of [1, -1]) put(K.paint, slab(side * (cw - 0.02), side * (cw + 0.03), 4.15, 4.6, zCab + 0.15, zF - 0.1, 0), GREEN);
  put(K.paint, slab(-cw + 0.3, cw - 0.3, 4.15, 4.6, zF + 0.04, zF + 0.12, 0), GREEN);
  const faceZ = (y) => (zF + 0.08) + ((zF - 0.18) - (zF + 0.08)) * ((y - 4.7) / (8.55 - 4.7));
  put(K.dark, onSegment(faceZ(5.0), 5.0, faceZ(8.45), 8.45, -cw + 0.22, cw - 0.22, { off: 0.0, t: 0.08, r: 0.04 }), 0x141516);
  for (const [a, b] of [[-cw + 0.32, -0.06], [0.06, cw - 0.32]]) put(K.glass, onSegment(faceZ(5.1), 5.1, faceZ(8.35), 8.35, a, b, { off: 0.05, t: 0.04, r: 0 }), PALETTE.glass);
  wiper(K, -2.0, 5.25, zF + 0.16, 2.1, -1.25);
  wiper(K, 1.3, 5.25, zF + 0.16, 2.1, -1.25);
  // the door and its window, the steps up to it, mirrors on arms
  for (const side of [1, -1]) {
    const x = side * cw;
    put(K.dark, slab(x - 0.03, x + side * 0.05, 5.4, 8.5, 8.95, 10.55, 0), 0x141516);
    put(K.glass, slab(x + side * 0.03, x + side * 0.07, 5.5, 8.42, 9.05, 10.45, 0), PALETTE.glass);
    put(K.dark, slab(x - 0.03, x + side * 0.05, 5.5, 8.42, 10.75, zF - 0.75, 0), 0x141516);
    put(K.glass, slab(x + side * 0.03, x + side * 0.07, 5.6, 8.35, 10.85, zF - 0.85, 0), PALETTE.glass);
    for (const z of [8.82, 10.65]) put(K.dark, slab(x - 0.02, x + side * 0.03, yb + 0.2, 8.6, z - 0.03, z + 0.03, 0), 0x3a3a3a);
    put(K.metal, slab(x, x + side * 0.1, 5.0, 5.12, 9.0, 9.5, 0.03), 0xc4c8cc);
    for (const y of [2.25, 3.25]) put(K.dark, slab(x - side * 0.7, x + side * 0.04, y - 0.06, y + 0.06, 8.85, 10.5, 0), 0x2b2c2e);
    put(K.metal, rod([x + side * 0.12, 3.6, zCab + 0.2], [x + side * 0.12, 7.6, zCab + 0.2], 0.05, 6), 0xc4c8cc);
    put(K.dark, rod([x, 7.6, 13.2], [x + side * 0.6, 7.7, 14.6], 0.05), 0x1b1c1e);
    put(K.dark, rod([x, 6.0, 13.2], [x + side * 0.6, 6.3, 14.6], 0.05), 0x1b1c1e);
    mirrorHead(K, x + side * 0.64, 6.95, 14.65, 0.52, 1.3);
    put(K.sign, plate(0.9, 0.5, 0.03, NUMBER).rotateY(side * Math.PI / 2).translate(x + side * 0.02, 7.3, zCab + 0.55), 0xffffff);
  }
  // roof marker lamps and the beacon
  for (let i = 0; i < 5; i++) lampAt(K, SW.marker, -1.2 + i * 0.6, 9.18, zF - 0.62, 0.3, 0.12, 1, { bezel: 0.03 });
  // the front: grille, headlamps, bumper
  put(K.dark, slab(-2.3, 2.3, 2.4, 3.95, zF - 0.02, zF + 0.14, 0.05), 0x161718);
  for (let i = 0; i < 9; i++) put(K.metal, slab(-2.15 + i * 0.54, -2.05 + i * 0.54, 2.5, 3.85, zF + 0.1, zF + 0.17, 0), 0x8e9399);
  for (const side of [1, -1]) {
    put(K.dark, slab(side * 2.5, side * 3.85, 2.55, 3.55, zF - 0.02, zF + 0.12, 0.05), 0x161718);
    lampAt(K, SW.head, side * 3.25, 3.05, zF + 0.1, 0.95, 0.6, 1);
    lampAt(K, SW.amber, side * 2.75, 3.05, zF + 0.1, 0.32, 0.6, 1);
  }
  put(K.metal, slab(-cw, cw, 1.6, 2.4, zF + 0.05, zF + 0.75, 0.1), 0x9fa4aa);

  // --- the packer body: a big rounded box with stiffening posts down its sides -----------------
  const bodyOutline = fillet([[zBody0, bodyBot], [zBody1, bodyBot], [zBody1, bodyTop - 0.6], [zBody1 - 0.6, bodyTop], [zBody0, bodyTop]], [0, 0, 0, 0.5, 0], 4);
  put(K.paint, profileSolid(bodyOutline, W, 0.4), GREEN);
  for (const side of [1, -1]) {
    const x = side * hw;
    for (const z of [-6.6, -3.6, -0.6, 2.4, 5.4, 7.7]) put(K.paint, slab(x - side * 0.02, x + side * 0.12, bodyBot + 0.1, bodyTop - 0.35, z - 0.18, z + 0.18, 0.05), DKGREEN);
    put(K.paint, slab(x - side * 0.02, x + side * 0.14, bodyBot, bodyBot + 0.35, zBody0, zBody1, 0.05), DKGREEN);
    put(K.sign, plate(6.2, 1.86, 0.03, side > 0 ? SIDE_R : SIDE_L).rotateY(side * Math.PI / 2).translate(x + side * 0.14, 7.4, 0.9), 0xffffff);
    for (const z of [-6.9, 0.9, 7.9]) sideLamp(K, SW.marker, x + side * 0.02, bodyBot + 0.6, z, 0.3, 0.14, side);
  }
  // the exhaust stack behind the cab
  put(K.metal, outward(lathe([[0, 3.5], [0.22, 3.5], [0.22, 10.9], [0.19, 11.2], [0, 11.2]], 12)).translate(2.9, 0, 8.45), 0x9aa0a6);
  put(K.dark, outward(lathe([[0, 9.5], [0.26, 9.5], [0.27, 11.0], [0, 11.0]], 12)).translate(2.9, 0, 8.45), 0x2a2b2d);

  // --- the tailgate: side walls framing the open hopper, the blade inside it ------------------
  const gate = (notch) => fillet(notch
    ? [[zBody0 - 0.05, 2.75], [-13.6, 2.75], [zR, 3.3], [zR, 3.85], [-12.7, 4.15], [-12.4, 6.6], [zR + 0.05, 7.35], [zR + 0.35, 9.6], [-12.8, bodyTop + 0.15], [zBody0 - 0.05, bodyTop + 0.15]]
    : [[zBody0 - 0.05, 2.75], [-13.6, 2.75], [zR, 3.3], [zR + 0.05, 7.35], [zR + 0.35, 9.6], [-12.8, bodyTop + 0.15], [zBody0 - 0.05, bodyTop + 0.15]],
  notch ? [0, 0.2, 0.15, 0.14, 0.25, 0.2, 0.3, 0.6, 0.8, 0] : [0, 0.2, 0.15, 0.3, 0.6, 0.8, 0], 3);
  put(K.paint, profileSolid(gate(true), W - 0.9, 0.12), GREEN);
  for (const side of [1, -1]) put(K.paint, profileSolid(gate(false), 0.46, 0.12, { x: side * (hw - 0.22) }), GREEN);
  // the hopper's floor, its curved sweep and the packer blade, in worn steel
  put(K.metal, onSegment(zR, 3.86, -12.7, 4.16, -hw + 0.45, hw - 0.45, { off: 0.02, t: 0.04, r: 0 }), 0x5b6066);
  put(K.metal, onSegment(-12.7, 4.16, -12.4, 6.6, -hw + 0.45, hw - 0.45, { off: 0.02, t: 0.04, r: 0 }), 0x4a4e54);
  put(K.dark, onSegment(-12.4, 6.6, zR + 0.05, 7.36, -hw + 0.45, hw - 0.45, { off: 0.02, t: 0.04, r: 0 }), 0x1f2022);
  for (let i = 0; i < 4; i++) {
    const y = 4.6 + i * 0.5;
    put(K.metal, slab(-hw + 0.5, hw - 0.5, y, y + 0.08, -12.62 + (y - 4.16) * 0.12, -12.5 + (y - 4.16) * 0.12, 0), 0x3c4045);
  }
  // a bag of rubbish waiting in the hopper
  put(K.dark, new THREE.SphereGeometry(0.55, 10, 6).scale(1.1, 0.85, 1).translate(-1.2, 4.55, -13.4), 0x2a2c30);
  put(K.dark, new THREE.SphereGeometry(0.45, 10, 6).scale(1, 0.8, 1.1).translate(0.4, 4.45, -13.6), 0x3b4a5c);
  // the lift cylinders on each side, from the body to the tailgate
  for (const side of [1, -1]) {
    const x = side * (hw + 0.12);
    put(K.metal, rod([x, 5.0, zBody0 + 0.6], [x, 9.9, zBody0 - 1.0], 0.13, 10), 0x2c2f33);
    put(K.metal, rod([x, 7.5, zBody0 - 0.2], [x, 9.9, zBody0 - 1.0], 0.07, 8), 0xd5d8dc);
    // the rear lamps on the side walls, the work light, the beacon on top
    lampAt(K, SW.tail, side * (hw - 0.22), 5.0, zR - 0.02, 0.36, 0.9, -1);
    lampAt(K, SW.amber, side * (hw - 0.22), 6.05, zR, 0.36, 0.5, -1);
    lampAt(K, SW.white, side * (hw - 0.22), 3.7, zR - 0.01, 0.36, 0.3, -1);
    put(K.dark, cylY(0.24, 0.16, 12).translate(side * 3.2, bodyTop + 0.22, -12.2), 0x1b1c1e);
    put(K.lamp, swatchUV(outward(lathe([[0, 0], [0.2, 0], [0.2, 0.32], [0.12, 0.42], [0, 0.44]], 12)).translate(side * 3.2, bodyTop + 0.3, -12.2), SW.beacon), 0xffffff);
    // the crew's riding steps: a folded-down grate on a bracket at each back corner
    put(K.metal, slab(side * 2.4, side * 3.95, 1.75, 1.9, zR - 1.05, zR + 0.1, 0.03), 0x8a8f95);
    for (let k = 0; k < 4; k++) put(K.dark, slab(side * 2.5, side * 3.85, 1.9, 1.93, zR - 0.95 + k * 0.28, zR - 0.85 + k * 0.28, 0), 0x2a2b2d);
    for (const bx of [2.45, 3.8]) put(K.metal, slab(side * bx, side * (bx + 0.15), 1.75, 3.45, zR + 0.05, zR + 0.4, 0), 0x6c7177);
    // and the grab handles they hold on to, standing off the tailgate
    const gx = side * (hw - 0.22);
    put(K.paint, rod([gx, 3.9, zR - 0.55], [gx, 7.0, zR - 0.45], 0.07, 8), 0xf2c81e);
    for (const y of [3.9, 7.0]) put(K.paint, rod([gx, y, zR - 0.55 + (y - 3.9) * 0.03], [gx, y, zR + 0.05], 0.06, 8), 0xf2c81e);
  }
  put(K.sign, plate(2.4, 0.8, 0.03, STAY).rotateY(Math.PI).translate(0, 8.4, zR + 0.0), 0xffffff);
  for (const side of [1, -1]) put(K.sign, plate(1.2, 0.75, 0.03, CHEVRON).rotateY(Math.PI).translate(side * 2.6, 2.95, -13.8), 0xffffff);

  // --- the chassis: frame, tanks, wheels ----------------------------------------------------------
  for (const side of [1, -1]) put(K.dark, slab(side * 1.25, side * 1.65, 2.4, bodyBot, zR + 1.6, zF - 0.4, 0), 0x202123);
  put(K.metal, cylZ(0.7, 3.4, 16).translate(2.75, 2.85, 1.6), 0xc4c8cc);
  put(K.dark, slab(-3.6, -1.9, 2.3, 3.6, 0.0, 3.4, 0.08), 0x2a2b2d);
  put(K.dark, slab(-hw + 0.2, hw - 0.2, 2.8, bodyBot, 5.2, zBody1, 0), 0x2a2b2d);
  // the half fenders over the tandem and the mud flaps behind it
  for (const side of [1, -1]) {
    put(K.dark, slab(side * 2.4, side * 3.95, 3.5, 3.62, axR2 - 2.0, axR1 + 2.0, 0.03), 0x1d1e20);
    put(K.dark, slab(side * 2.45, side * 3.9, 1.0, 3.5, axR2 - 2.2, axR2 - 2.1, 0), 0x1d1e20);
  }
  put(K.dark, slab(-2.4, 2.4, yb - 0.1, 4.0, axF - 2.05, axF + 2.05, 0), 0x151617);
  for (const side of [1, -1]) {
    wheel(K, side * (cw - 0.6), axF, side, { rim: 0xd6d9dc });
    wheel(K, side * (hw - 0.55), axR1, side, { dual: true, rim: 0xd6d9dc });
    wheel(K, side * (hw - 0.55), axR2, side, { dual: true, rim: 0xd6d9dc });
  }
  for (const z of [axF, axR1, axR2]) put(K.dark, cylX(0.2, W - 1.4, 10).translate(0, yA, z), 0x2a2b2d);

  return finish(K, { paintRough: 0.4 });
}

export const BUILDERS = {
  'city-bus': cityBus,
  'school-bus': schoolBus,
  'fire-engine': fireEngine,
  'garbage-truck': garbageTruck,
};
