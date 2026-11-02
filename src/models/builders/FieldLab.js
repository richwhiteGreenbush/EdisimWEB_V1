import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mesh, standard, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, extrudeOutline, solidSurface, smoothNoise3, tintGeometry } from '../../props/LoftKit.js';
import {
  Sculpt, polygonize, tube, lathe, outward, lin, clamp01, mix, sstep, mixInto,
  sphereP, ellipsoidP, curveP, segsP, torusP, boxP, onSurface, fieldNormal, pathOn, grainBump, tintVertices,
} from '../ModelKit.js';
import { Batch, addPine, addHouse, paintTexels, fbm, noise2, mixc, shade } from '../geo/GeoKit.js';
import { landMask, earthColor } from '../geo/GeoEarth.js';
import { reducedMotion } from '../../Settings.js';

// The Model Database's field bench: a frog's life cycle, a pond cut open, a hydroelectric dam, the
// seasons and a human knee. Authored in feet, origin at the base centre, front toward +Z.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// Label plates. Each is a real thin box with its words on both big faces, so it reads from behind
// too and cannot show an edge-on nothing. They all share one atlas and one mesh, and cast no shadow.
// ---------------------------------------------------------------------------------------------
class Plates {
  constructor({ pxPerFoot = 220, width = 1024 } = {}) {
    this.list = [];
    this.pxPerFoot = pxPerFoot;
    this.width = width;
  }

  // `at` is the plate's centre, `yaw` turns its face from +Z, `tilt` leans its top back.
  add(text, at, {
    h = 0.34, w = null, yaw = 0, tilt = 0, bg = '#f5f0e0', fg = '#1d2830', badge = null, badgeColor = '#b4552a', draw = null, thick = 0.035,
  } = {}) {
    const chars = String(text).length + (badge ? 3 : 0);
    const width = w ?? h * (chars * 0.42 + 0.7);
    this.list.push({ text, at, h, w: width, yaw, tilt, bg, fg, badge, badgeColor, draw, thick });
    return this;
  }

  texture() {
    let rows = 0;
    for (const p of this.list) {
      const ww = p.w * this.pxPerFoot;
      p.scale = ww > this.width - 8 ? (this.width - 8) / ww : 1;
      p.pw = Math.round(ww * p.scale);
      p.ph = Math.max(8, Math.round(p.h * this.pxPerFoot * p.scale));
      p.py = rows;
      rows += p.ph + 4;
    }
    const W = this.width; const H = rows + 4;
    this.W = W; this.H = H;
    return canvasTexture(W, H, (ctx) => {
      ctx.fillStyle = '#cfc9b6';
      ctx.fillRect(0, 0, W, H);
      for (const p of this.list) {
        ctx.save();
        ctx.translate(0, p.py);
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, 0, p.pw, p.ph);
        if (p.draw) {
          p.draw(ctx, p.pw, p.ph);
        } else {
          const pad = p.ph * 0.2;
          let left = pad;
          if (p.badge) {
            const r = p.ph * 0.4;
            ctx.fillStyle = p.badgeColor;
            ctx.beginPath();
            ctx.arc(pad * 0.6 + r, p.ph / 2, r, 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${r * 1.45}px ${FONT}`;
            ctx.fillText(String(p.badge), pad * 0.6 + r, p.ph / 2 + r * 0.06);
            left = pad * 0.6 + r * 2 + pad * 0.7;
          }
          let size = p.ph * 0.66;
          ctx.font = `700 ${size}px ${FONT}`;
          const room = p.pw - left - pad;
          const tw = ctx.measureText(p.text).width;
          if (tw > room) { size *= room / tw; ctx.font = `700 ${size}px ${FONT}`; }
          ctx.fillStyle = p.fg;
          ctx.textBaseline = 'middle';
          if (p.badge) {
            ctx.textAlign = 'left';
            ctx.fillText(p.text, left, p.ph / 2 + size * 0.05);
          } else {
            ctx.textAlign = 'center';
            ctx.fillText(p.text, p.pw / 2, p.ph / 2 + size * 0.05);
          }
        }
        ctx.restore();
      }
    });
  }

  geometry() {
    const pos = []; const nor = []; const uv = []; const idx = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    const { W, H } = this;
    for (const p of this.list) {
      q.setFromEuler(new THREE.Euler(-p.tilt, p.yaw, 0, 'YXZ'));
      m.compose(new THREE.Vector3(...p.at), q, new THREE.Vector3(1, 1, 1));
      const hw = p.w / 2; const hh = p.h / 2; const ht = p.thick / 2;
      const u0 = 1 / W; const u1 = (p.pw - 1) / W;
      const vTop = 1 - (p.py + 1) / H; const vBot = 1 - (p.py + p.ph - 1) / H;
      const rimU = (W - 2) / W; const rimV = 2 / H;
      const quad = (a, b, c, d, nn, us) => {
        const base = pos.length / 3;
        [a, b, c, d].forEach((corner, i) => {
          v.set(corner[0], corner[1], corner[2]).applyMatrix4(m);
          pos.push(v.x, v.y, v.z);
          n.set(nn[0], nn[1], nn[2]).applyQuaternion(q);
          nor.push(n.x, n.y, n.z);
          uv.push(us[i][0], us[i][1]);
        });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      const rim = [[rimU, rimV], [rimU, rimV], [rimU, rimV], [rimU, rimV]];
      quad([-hw, -hh, ht], [hw, -hh, ht], [hw, hh, ht], [-hw, hh, ht], [0, 0, 1], [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]]);
      quad([hw, -hh, -ht], [-hw, -hh, -ht], [-hw, hh, -ht], [hw, hh, -ht], [0, 0, -1], [[u0, vBot], [u1, vBot], [u1, vTop], [u0, vTop]]);
      quad([-hw, hh, ht], [hw, hh, ht], [hw, hh, -ht], [-hw, hh, -ht], [0, 1, 0], rim);
      quad([-hw, -hh, -ht], [hw, -hh, -ht], [hw, -hh, ht], [-hw, -hh, ht], [0, -1, 0], rim);
      quad([hw, -hh, ht], [hw, -hh, -ht], [hw, hh, -ht], [hw, hh, ht], [1, 0, 0], rim);
      quad([-hw, -hh, -ht], [-hw, -hh, ht], [-hw, hh, ht], [-hw, hh, -ht], [-1, 0, 0], rim);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  mesh() {
    const map = this.texture();
    const m = mesh(this.geometry(), standard({ map, roughness: 0.82, metalness: 0, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.16 }));
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }
}

// Sends a whole geometry to one spot of an atlas, where the map is plain white and so multiplies
// nothing, or planar-maps it into a patch.
function toPatch(geometry, u, v) {
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { arr[i * 2] = u; arr[i * 2 + 1] = v; }
  geometry.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  return geometry;
}
function planarPatch(geometry, [u0, v0, u1, v1], cx, cz, radius) {
  const p = geometry.attributes.position;
  const arr = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    arr[i * 2] = mix(u0, u1, clamp01(0.5 + (p.getX(i) - cx) / (2 * radius)));
    arr[i * 2 + 1] = mix(v0, v1, clamp01(0.5 + (p.getZ(i) - cz) / (2 * radius)));
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  return geometry;
}

// A small rounded stone: a sphere moved by a smooth function of direction, so it cannot tear.
function stoneGeometry(rng, rx, ry, rz, widthSegs = 9, heightSegs = 6, rough = 0.2) {
  const g = new THREE.SphereGeometry(1, widthSegs, heightSegs);
  const p = g.attributes.position;
  const ox = rng() * 40; const oy = rng() * 40; const oz = rng() * 40;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const k = 1 + rough * (smoothNoise3(x * 1.6 + ox, y * 1.6 + oy, z * 1.6 + oz) * 2 - 1);
    p.setXYZ(i, x * k * rx, y * k * ry, z * k * rz);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------
// 1. The frog's life cycle
// ---------------------------------------------------------------------------------------------
const POND = { water: 6.3, rim: 7.0, waterY: 0.46 };

// A frog sitting, facing +Z, with its feet on y = 0, at about 3.5ft long before `scale`. The legs
// are one field with the body, which is what makes a thigh flow out of a haunch, and the stub of a
// tail is what turns the same animal into a froglet.
function frogGeometry({ cell, scale, tail = false, seed = 77, toes = true }) {
  const c = cell / scale;
  const BACK = lin(0x6c9440);
  const BELLY = lin(0xece4c6);
  const s = new Sculpt(c);
  const headY = -0.18;

  s.add(ellipsoidP([0, 0.72, -0.92], [0.56, 0.42, 0.72], [-0.26, 0, 0]), BACK);
  s.add(ellipsoidP([0, 0.9, -0.18], [0.58, 0.5, 0.74], [-0.28, 0, 0]), BACK, { k: 0.3 });
  s.add(ellipsoidP([0, 1.06, 0.42], [0.56, 0.42, 0.56], [-0.16, 0, 0]), BACK, { k: 0.26 });
  // The head: broad and flat, running to a blunt snout. Its width is what makes it a frog.
  s.add(ellipsoidP([0, 1.38 + headY, 0.98], [0.56, 0.26, 0.62], [0.02, 0, 0]), BACK, { k: 0.18 });
  s.add(ellipsoidP([0, 1.3 + headY, 1.5], [0.28, 0.15, 0.42], [0.06, 0, 0]), BACK, { k: 0.2 });
  s.add(ellipsoidP([0, 1.16 + headY, 1.04], [0.45, 0.13, 0.6], [0.12, 0, 0]), BELLY, { k: 0.1, ck: 0.06 });
  // The bulges the eyes sit in, on top of the head.
  for (const side of [1, -1]) {
    s.add(ellipsoidP([side * 0.33, 1.52 + headY, 1.0], [0.17, 0.15, 0.21]), BACK, { k: 0.1 });
    s.add(ellipsoidP([side * 0.39, 1.665 + headY, 0.99], [0.13, 0.045, 0.2], [0, 0, side * -0.42]), BACK, { k: 0.05 });
  }
  const headField = s.snapshot();

  // A hind leg folded along the flank: thigh forward from the hip, knee beside the shoulder, shank
  // back to the ankle at the rump, long foot forward along the ground.
  for (const side of [1, -1]) {
    const hip = [side * 0.38, 0.66, -1.12];
    const knee = [side * 1.02, 0.52, 0.16];
    const ankle = [side * 0.92, 0.2, -1.32];
    const midfoot = [side * 1.02, 0.11, -0.52];
    const toeRoot = [side * 1.12, 0.09, -0.02];
    s.add(curveP([hip, [side * 0.74, 0.7, -0.52], knee], [0.34, 0.31, 0.18], 12), BACK, { k: 0.2 });
    s.add(curveP([knee, [side * 1.14, 0.44, -0.56], ankle], [0.18, 0.2, 0.1], 12), BACK, { k: 0.05 });
    s.add(curveP([ankle, [side * 0.98, 0.14, -0.9], midfoot, toeRoot], [0.1, 0.1, 0.095, 0.11], 12), BACK, { k: 0.04 });
    const shoulder = [side * 0.48, 0.92, 0.58];
    const elbow = [side * 0.76, 0.5, 0.62];
    const wrist = [side * 0.6, 0.11, 0.96];
    s.add(curveP([shoulder, [side * 0.68, 0.72, 0.56], elbow], [0.15, 0.13, 0.1], 8), BACK, { k: 0.14 });
    s.add(curveP([elbow, [side * 0.7, 0.28, 0.8], wrist], [0.1, 0.09, 0.085], 8), BACK, { k: 0.04 });
  }
  if (tail) {
    // What is left of the tail: thick at the root, and already blunt, because it is being absorbed.
    s.add(curveP([[0, 0.72, -1.4], [0, 0.66, -1.85], [0, 0.56, -2.3]], [0.2, 0.13, 0.05], 8), BACK, { k: 0.12 });
  }

  const bodyField = s.snapshot();
  // The raised fold down each side of the back.
  for (const side of [1, -1]) {
    const path = pathOn(bodyField, [
      [side * 0.32, 1.34, 0.76], [side * 0.38, 1.32, 0.3], [side * 0.42, 1.1, -0.2], [side * 0.4, 0.96, -0.62], [side * 0.32, 0.9, -1.02],
    ], 14);
    s.add(segsP(path, path.map((_, i) => mix(0.045, 0.03, i / 14))), lin(0xa69c5c), { k: 0.06, ck: 0.03 });
  }
  // The mouth is a long groove following the jaw back to below the drum.
  const mouth = [];
  for (let i = 0; i <= 24; i++) {
    const a = -1 + 2 * (i / 24);
    const z = mix(1.92, 0.58, Math.abs(a) ** 1.2);
    const x = a * mix(0.0, 0.56, Math.min(1, Math.abs(a) ** 0.72));
    mouth.push(onSurface(headField, [x, 1.25 + headY, z], 0, 8));
  }
  s.sub(segsP(mouth, mouth.map(() => Math.max(0.03, c * 0.7))), lin(0x262012), { k: 0.03, ck: 0.03 });
  for (const side of [1, -1]) {
    s.sub(sphereP(onSurface(headField, [side * 0.11, 1.44 + headY, 1.74]), Math.max(0.035, c * 0.6)), lin(0x1c170d), { k: 0.012, ck: 0.015 });
  }
  // The tympanum, a shallow round drum behind the eye in a low rim.
  const drums = [1, -1].map((side) => onSurface(headField, [side * 0.55, 1.42 + headY, 0.66]));
  const DRUM_R = 0.17;
  drums.forEach((d) => {
    const n = fieldNormal(headField, d);
    s.add(torusP(d, n, DRUM_R, Math.max(0.022, c * 0.45)), lin(0x5f5430), { k: 0.03, ck: 0.02 });
    s.sub(sphereP([d[0] + n[0] * 0.48, d[1] + n[1] * 0.48, d[2] + n[2] * 0.48], 0.495), null, { k: 0.02 });
  });
  // A low warty undulation of the whole skin.
  s.map((d, x, y, z) => {
    if (d > 0.1 || d < -0.1) return d;
    return d + 0.012 * Math.sin(x * 11 + y * 4) * Math.sin(z * 10 + y * 6);
  }, [-2.5, 0.3, -3, 2.5, 3, 2.5]);

  const GREEN = lin(0x557e34); const GREEN2 = lin(0x6c9040);
  const BROWN = lin(0x5a5230); const DARK = lin(0x262612);
  const DRUM = lin(0x8a7240);
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    const isSkin = Math.abs(rgb[0] - BACK[0]) < 0.08 && Math.abs(rgb[1] - BACK[1]) < 0.08 && Math.abs(rgb[2] - BACK[2]) < 0.08;
    if (!isSkin) return;
    // Green and brown in big soft patches, then darker blotches that break up the outline. Every
    // frequency here is held well below what the mesh can draw.
    const big = smoothNoise3(x * 1.8 + seed, y * 1.8, z * 1.8);
    const mid = smoothNoise3(x * 3.6, y * 3.6 + seed, z * 3.6);
    const fine = smoothNoise3(x * 6.4 + 9, y * 6.4, z * 6.4 + seed);
    rgb[0] = mix(GREEN[0], GREEN2[0], fine); rgb[1] = mix(GREEN[1], GREEN2[1], fine); rgb[2] = mix(GREEN[2], GREEN2[2], fine);
    mixInto(rgb, BROWN, sstep(big, 0.44, 0.66) * 0.72);
    mixInto(rgb, DARK, sstep(fine + 0.35 * (mid - 0.5), 0.6, 0.67) * 0.78);
    for (const d of drums) {
      const dd = Math.hypot(x - d[0], y - d[1], z - d[2]) - DRUM_R * 0.94;
      mixInto(rgb, DRUM, 1 - sstep(dd, -0.02, 0.02));
    }
    mixInto(rgb, BELLY, (1 - sstep(ny, -0.6, -0.12)) * (1 - sstep(y, 1.1, 1.2)) * 0.9);
  };
  const parts = [{ geometry: polygonize(s, { tint, uvScale: 3.2 / scale, extraReach: 0.05 }), keepColor: true }];

  if (toes) {
    const TOE = 0x76844a; const WEB = 0x94a06a;
    for (const side of [1, -1]) {
      const root = [side * 1.12, 0.07, -0.02];
      const lengths = [0.34, 0.5, 0.74, 1.06, 0.64]; // five toes, the fourth the longest
      const spreads = [-0.62, -0.32, -0.02, 0.26, 0.58];
      const tips = [];
      for (let i = 0; i < 5; i++) {
        const yaw = (spreads[i] + 0.05) * side;
        const dx = Math.sin(yaw); const dz = Math.cos(yaw); const L = lengths[i];
        parts.push({ geometry: tube([root, [root[0] + dx * L * 0.55, 0.066, root[2] + dz * L * 0.55], [root[0] + dx * L, 0.056, root[2] + dz * L]], [0.05, 0.042, 0.04], { sides: 6, steps: 5, round: 1 }), color: TOE });
        tips.push({ dx, dz, L });
      }
      for (let i = 0; i < 4; i++) {
        const a = tips[i]; const b = tips[i + 1];
        parts.push({
          geometry: solidSurface({
            nu: 6, nv: 4,
            point: (u, v) => {
              const edge = mix(a.L, b.L, u) * 0.97 * mix(1, 0.62, Math.sin(u * Math.PI));
              const r = edge * v;
              return [root[0] + mix(a.dx, b.dx, u) * r, 0.06, root[2] + mix(a.dz, b.dz, u) * r];
            },
            thick: (u, v) => 0.014 * (1 - v ** 5),
            axis: [0, 1, 0],
          }),
          color: WEB,
        });
      }
      const wrist = [side * 0.6, 0.08, 0.96];
      for (const [a, L] of [[-0.42, 0.34], [-0.05, 0.44], [0.32, 0.4], [0.72, 0.26]]) {
        const yaw = (a - 0.18) * side;
        const tip = [wrist[0] + Math.sin(yaw) * L, 0.045, wrist[2] + Math.cos(yaw) * L];
        parts.push({ geometry: tube([wrist, [wrist[0] + Math.sin(yaw) * L * 0.5, 0.06, wrist[2] + Math.cos(yaw) * L * 0.5], tip], [0.05, 0.042, 0.04], { sides: 6, steps: 4, round: 1 }), color: TOE });
      }
    }
  }
  const geometry = mergeParts(parts);
  geometry.scale(scale, scale, scale);
  return geometry;
}

// The eyes, gold with a level black pupil. Each sphere is sunk into its bulge under the lid.
function frogEyes(scale, matrix) {
  const R = 0.165;
  const out = [];
  for (const side of [1, -1]) {
    const g = new THREE.SphereGeometry(R, 20, 14);
    const gaze = new THREE.Vector3(side * 0.86, 0.34, 0.36).normalize();
    const flatUp = new THREE.Vector3(0, 1, 0).addScaledVector(gaze, -gaze.y).normalize();
    const right = new THREE.Vector3().crossVectors(flatUp, gaze);
    const P = g.attributes.position; const uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) uv.setXY(i, 0.5 + P.getX(i) / (2 * R), 0.5 + P.getY(i) / (2 * R));
    g.applyMatrix4(new THREE.Matrix4().makeBasis(right, flatUp, gaze));
    g.translate(side * 0.415, 1.56 - 0.18, 1.0);
    g.scale(scale, scale, scale);
    g.applyMatrix4(matrix);
    out.push({ geometry: g, color: 0xffffff });
  }
  return out;
}
function eyeTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const iris = ctx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
    iris.addColorStop(0, '#f2cc55');
    iris.addColorStop(0.55, '#d4a02c');
    iris.addColorStop(0.86, '#a8741e');
    iris.addColorStop(1, '#38220e');
    ctx.fillStyle = iris;
    ctx.fillRect(0, 0, w, h);
    const flecks = seededRandom(551);
    for (let i = 0; i < 160; i++) {
      const a = flecks() * TAU; const r = 10 + flecks() * 48;
      ctx.fillStyle = flecks() > 0.5 ? 'rgba(255,233,150,0.55)' : 'rgba(92,52,12,0.5)';
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 0.7 + flecks() * 1.4, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#070503';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 29, 10, 0, 0, TAU);
    ctx.fill();
  });
}

// A tadpole along local Z, head at +Z, its tail running to -Z. Only the tail waves, so every vertex
// behind the body keeps how far along the tail it is. Returns a geometry in local coordinates.
function tadpoleGeometry({ length, gills = false, hindLegs = false, seed = 3 }) {
  const bodyLen = hindLegs ? 1.25 : 0.95;
  const tailLen = length - bodyLen;
  const c = 0.044;
  const OLIVE = lin(0x4a4a26); const PALE = lin(0xc7bf9c);
  const s = new Sculpt(c);
  const by = bodyLen * 0.3;
  s.add(ellipsoidP([0, 0, 0], [bodyLen * 0.33, by, bodyLen * 0.5]), OLIVE);
  s.add(ellipsoidP([0, -0.01, bodyLen * 0.36], [bodyLen * 0.27, by * 0.74, bodyLen * 0.3]), OLIVE, { k: 0.12 });
  // Tail root, to carry the body's line into the tail.
  s.add(ellipsoidP([0, 0.02, -bodyLen * 0.46], [bodyLen * 0.16, by * 0.62, bodyLen * 0.34]), OLIVE, { k: 0.12 });
  // The mouth: a small dark notch under the snout.
  s.sub(ellipsoidP([0, -by * 0.52, bodyLen * 0.62], [bodyLen * 0.1, 0.05, 0.08]), lin(0x1a160c), { k: 0.02, ck: 0.02 });
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    if (rgb[0] < 0.03) return;
    const n = smoothNoise3(x * 5 + seed, y * 5, z * 5);
    const n2 = smoothNoise3(x * 2.4, y * 2.4 + seed, z * 2.4);
    const k = 0.72 + n2 * 0.6;
    rgb[0] = OLIVE[0] * k; rgb[1] = OLIVE[1] * k; rgb[2] = OLIVE[2] * k;
    mixInto(rgb, lin(0x8c7c3e), sstep(smoothNoise3(x * 9 + seed, y * 9, z * 9), 0.68, 0.76) * 0.6);
    mixInto(rgb, PALE, (1 - sstep(ny, -0.75, -0.2)) * 0.95);
  };
  const parts = [{ geometry: polygonize(s, { tint, uvScale: 1, extraReach: 0.05 }), keepColor: true }];

  // Eyes high and wide, small and dark, each with a pale ring.
  for (const side of [1, -1]) {
    const e = [side * bodyLen * 0.26, by * 0.4, bodyLen * 0.34];
    parts.push({ geometry: new THREE.SphereGeometry(0.075, 12, 8), color: 0xb79c4e, position: [e[0], e[1], e[2]] });
    parts.push({ geometry: new THREE.SphereGeometry(0.052, 12, 8), color: 0x050403, position: [e[0] + side * 0.03, e[1] + 0.015, e[2] + 0.008] });
  }

  // The tail: a muscular core inside a thin fin, higher in the middle than at either end.
  const tailZ0 = -bodyLen * 0.5;
  const tailY = (u) => 0.03 - 0.02 * u;
  parts.push({
    geometry: tube([[0, tailY(0), tailZ0 + 0.1], [0, tailY(0.33), tailZ0 - tailLen * 0.33], [0, tailY(0.66), tailZ0 - tailLen * 0.66], [0, tailY(1), tailZ0 - tailLen]], [bodyLen * 0.13, bodyLen * 0.08, bodyLen * 0.05, 0.004], { sides: 7, steps: 16, round: 1 }),
    tint: ({ x, y, z }) => {
      const n = smoothNoise3(x * 3, y * 7, z * 4 + seed);
      const k = 0.7 + n * 0.5;
      return [OLIVE[0] * k * 1.25, OLIVE[1] * k * 1.25, OLIVE[2] * k * 1.1];
    },
    keepColor: true,
  });
  const finTop = (u) => Math.sin(Math.min(1, u * 1.0 + 0.03) ** 0.72 * Math.PI) * bodyLen * 0.34 * (1 - u * 0.15) + 0.005;
  const finBot = (u) => Math.sin(Math.min(1, u * 1.0 + 0.03) ** 0.62 * Math.PI) * bodyLen * 0.26 + 0.005;
  parts.push({
    geometry: solidSurface({
      nu: 22, nv: 6,
      point: (u, v) => [0, tailY(u) + mix(-finBot(u), finTop(u), v), tailZ0 - 0.08 - (tailLen - 0.06) * u],
      thick: (u, v) => (1 - (2 * v - 1) ** 2) * mix(0.03, 0.012, u),
      axis: [1, 0, 0],
    }),
    tint: ({ x, y, z }) => {
      const n = smoothNoise3(x * 2 + seed, y * 8, z * 8);
      const dots = sstep(n, 0.62, 0.7) * 0.75;
      const c0 = lin(0xa6a46c);
      return [mix(c0[0], 0.06, dots), mix(c0[1], 0.06, dots), mix(c0[2], 0.03, dots)];
    },
    keepColor: true,
  });

  if (gills) {
    // External gills: a feathery tuft each side of the neck, a stem with side branches.
    const rng = seededRandom(seed + 11);
    for (const side of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        const root = [side * bodyLen * 0.24, by * (0.3 - k * 0.3), bodyLen * (0.04 - k * 0.05)];
        const tip = [side * (bodyLen * 0.24 + 0.6 - k * 0.05), by * (0.7 - k * 0.45), bodyLen * (-0.12 - k * 0.1)];
        parts.push({ geometry: tube([root, [mix(root[0], tip[0], 0.5), mix(root[1], tip[1], 0.5) + 0.04, mix(root[2], tip[2], 0.5)], tip], [0.03, 0.024, 0.012], { sides: 5, steps: 5, round: 1 }), color: 0xb0523c });
        for (let b = 1; b <= 5; b++) {
          const t = b / 6;
          const p = [mix(root[0], tip[0], t), mix(root[1], tip[1], t) + 0.03, mix(root[2], tip[2], t)];
          for (const up of [1, -1]) {
            const q = [p[0] + side * (0.05 + rng() * 0.03), p[1] + up * (0.13 + rng() * 0.03) * (1.1 - t * 0.5), p[2] - 0.04];
            parts.push({ geometry: tube([p, q], [0.012, 0.005], { sides: 4, steps: 1, round: 0, straight: true }), color: 0xc4664a });
          }
        }
      }
    }
  }
  if (hindLegs) {
    // Two small back legs where the body meets the tail, with long feet and spread toes.
    for (const side of [1, -1]) {
      const hip = [side * bodyLen * 0.2, -by * 0.34, -bodyLen * 0.36];
      const knee = [side * (bodyLen * 0.2 + 0.36), -by * 0.42, -bodyLen * 0.2];
      const ankle = [side * (bodyLen * 0.2 + 0.46), -by * 0.46, -bodyLen * 0.54];
      const foot = [side * (bodyLen * 0.2 + 0.6), -by * 0.48, -bodyLen * 0.3];
      parts.push({ geometry: tube([hip, [mix(hip[0], knee[0], 0.5), hip[1], mix(hip[2], knee[2], 0.5)], knee], [0.1, 0.08, 0.055], { sides: 8, steps: 6, round: 2 }), color: 0x4e4e2a });
      parts.push({ geometry: tube([knee, [mix(knee[0], ankle[0], 0.5) + side * 0.03, knee[1], mix(knee[2], ankle[2], 0.5)], ankle], [0.055, 0.05, 0.04], { sides: 7, steps: 6, round: 2 }), color: 0x585630 });
      parts.push({ geometry: tube([ankle, [mix(ankle[0], foot[0], 0.5), ankle[1], mix(ankle[2], foot[2], 0.5)], foot], [0.04, 0.038, 0.035], { sides: 6, steps: 5, round: 2 }), color: 0x62603a });
      for (const a of [-0.5, -0.15, 0.2, 0.55]) {
        const yaw = a * side + side * 0.35;
        parts.push({ geometry: tube([foot, [foot[0] + Math.sin(yaw) * 0.26, foot[1], foot[2] + Math.cos(yaw) * 0.26]], [0.024, 0.014], { sides: 5, steps: 2, round: 1, straight: true }), color: 0x6c6a42 });
      }
    }
  }
  const geometry = mergeParts(parts);
  // Clear of the tail, the wave is zero, and it grows along the tail.
  const P = geometry.attributes.position;
  const waveAt = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) waveAt[i] = Math.max(0, tailZ0 + 0.05 - P.getZ(i));
  return { geometry, waveAt };
}

// The atlas under the pond: the painted bed, and plain patches for what lies on it.
function pondAtlas() {
  const S = 1024; const STRIP = 256;
  const H = S + STRIP;
  const texture = canvasTexture(S, H, (ctx) => {
    const rng = seededRandom(4411);
    // The bed: dark silt, pale near the shallows, with a soft dark ring round the deep middle.
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.08, S / 2, S / 2, S * 0.5);
    g.addColorStop(0, '#5a6a50');
    g.addColorStop(0.42, '#6e7a56');
    g.addColorStop(0.76, '#8c8a62');
    g.addColorStop(0.9, '#a39a70');
    g.addColorStop(1, '#6a5238');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2400; i++) {
      const a = rng() * TAU; const r = Math.sqrt(rng()) * S * 0.5;
      const x = S / 2 + Math.cos(a) * r; const y = S / 2 + Math.sin(a) * r;
      const v = rng();
      ctx.fillStyle = v > 0.5 ? `rgba(40,44,28,${0.06 + rng() * 0.12})` : `rgba(180,172,130,${0.05 + rng() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + rng() * 12, 2 + rng() * 8, rng() * 3, 0, TAU);
      ctx.fill();
    }
    // Pebbles and drowned leaves.
    for (let i = 0; i < 300; i++) {
      const a = rng() * TAU; const r = (0.62 + rng() * 0.36) * S * 0.46;
      const x = S / 2 + Math.cos(a) * r; const y = S / 2 + Math.sin(a) * r;
      const v = 110 + rng() * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.82})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + rng() * 5, 2 + rng() * 4, rng() * 3, 0, TAU);
      ctx.fill();
    }
    // Waterweed, painted fronds rooted in the silt.
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const a = rng() * TAU; const r = (0.2 + rng() * 0.72) * S * 0.46;
      let x = S / 2 + Math.cos(a) * r; let y = S / 2 + Math.sin(a) * r;
      let heading = rng() * TAU;
      const n = 4 + Math.floor(rng() * 5);
      ctx.strokeStyle = `rgba(${40 + rng() * 40},${84 + rng() * 50},${40 + rng() * 26},0.75)`;
      ctx.lineWidth = 2 + rng() * 2.5;
      for (let k = 0; k < n; k++) {
        const nx = x + Math.cos(heading) * 14; const ny = y + Math.sin(heading) * 14;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        for (const sgn of [1, -1]) {
          ctx.beginPath(); ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(heading + sgn * 0.8) * 9, y + Math.sin(heading + sgn * 0.8) * 9);
          ctx.stroke();
        }
        x = nx; y = ny; heading += (rng() - 0.5) * 0.7;
      }
    }
    // The strip: white, a lily pad, a stone.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, S, STRIP, STRIP);
    // The pad's veins run out from the notch's root, the way a water lily's do.
    ctx.fillStyle = '#f0f4e8';
    ctx.fillRect(STRIP, S, STRIP, STRIP);
    const cx = STRIP * 1.5; const cy = S + STRIP / 2;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      ctx.strokeStyle = 'rgba(170,190,120,0.5)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * STRIP * 0.5, cy + Math.sin(a) * STRIP * 0.5);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      const t = 0.62;
      for (const sgn of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * STRIP * 0.5 * t, cy + Math.sin(a) * STRIP * 0.5 * t);
        ctx.lineTo(cx + Math.cos(a + sgn * 0.11) * STRIP * 0.5, cy + Math.sin(a + sgn * 0.11) * STRIP * 0.5);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#e9e6dc';
    ctx.fillRect(STRIP * 2, S, STRIP, STRIP);
    for (let i = 0; i < 1400; i++) {
      const v = rng();
      ctx.fillStyle = v > 0.5 ? `rgba(70,62,50,${0.06 + rng() * 0.16})` : `rgba(255,250,235,${0.1 + rng() * 0.3})`;
      ctx.beginPath();
      ctx.arc(STRIP * 2 + rng() * STRIP, S + rng() * STRIP, 0.6 + rng() * 1.5, 0, TAU);
      ctx.fill();
    }
  });
  const vOf = (py) => 1 - py / H;
  return {
    texture,
    bedUV: (x, z, R) => [0.5 + (x / R) * 0.5, vOf(S * (0.5 + (z / R) * 0.5))],
    white: [(STRIP * 0.5) / S, vOf(S + STRIP * 0.5)],
    pad: [STRIP / S, vOf(S + STRIP), (STRIP * 2) / S, vOf(S)],
    stone: [(STRIP * 2) / S, vOf(S + STRIP), (STRIP * 3) / S, vOf(S)],
  };
}

function frogLifeCycle() {
  const root = new THREE.Group();
  root.name = 'frog-life-cycle';
  const { water: RW, rim: RR, waterY: WY } = POND;
  const rng = seededRandom(9127);
  const atlas = pondAtlas();
  const scene = [];
  const addPatch = (geometry, color, position = null) => {
    if (position) geometry.translate(position[0], position[1], position[2]);
    toPatch(geometry, atlas.white[0], atlas.white[1]);
    scene.push({ geometry, color, keepUv: true });
  };

  // --- Where the five stages stand. The walk runs clockwise seen from above, which on this bearing
  // (0 is +Z, toward +X) means the bearing falls: left, back left, back right, right, front. ---
  const BEARINGS = [288, 216, 144, 72, 0].map((b) => b * DEG);
  const polar = (b, r) => [Math.sin(b) * r, Math.cos(b) * r];

  // --- The bed and its earth bank, in one lathe, painted from above ---
  const bed = lathe([
    [0, 0], [RR + 0.1, 0], [RR + 0.1, 0.2], [RR - 0.1, 0.3], [RW + 0.08, 0.32], [RW - 0.2, 0.16], [RW - 1.2, 0.12], [3.0, 0.09], [0, 0.08],
  ], 96);
  {
    const p = bed.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = atlas.bedUV(p.getX(i), p.getZ(i), RR + 0.12);
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    bed.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    scene.push({ geometry: bed, color: 0xffffff });
  }

  // --- The stone rim, one irregular coping stone after another, each sunk into the bank ---
  const count = 44;
  for (let i = 0; i < count; i++) {
    const a = ((i + (rng() - 0.5) * 0.2) / count) * TAU;
    const r = RR - 0.34 + (rng() - 0.5) * 0.1;
    const rx = 0.56 + rng() * 0.2; const ry = 0.15 + rng() * 0.08; const rz = 0.3 + rng() * 0.1;
    const g = stoneGeometry(rng, rx, ry, rz, 8, 6, 0.26);
    g.rotateY(a);
    const [x, z] = [Math.sin(a) * r, Math.cos(a) * r];
    g.translate(x, 0.39 + (rng() - 0.5) * 0.04, z);
    planarPatch(g, atlas.stone, x, z, 2.2);
    const k = 0.66 + rng() * 0.34;
    const cc = new THREE.Color(rng() > 0.5 ? 0x8d8a80 : 0x7d7f78);
    cc.multiplyScalar(k);
    scene.push({ geometry: g, color: cc.getHex() });
  }

  // --- Lily pads: the big one is the frog's, the rest fill the gaps between stages ---
  const padGeometry = (r, cx, cz, notchAt) => {
    const pts = [];
    const seg = 40;
    for (let i = 0; i <= seg; i++) {
      const a = notchAt + 0.11 + (i / seg) * (TAU - 0.22);
      const rr = r * (1 + 0.02 * Math.sin(a * 5));
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    pts.push([Math.cos(notchAt) * r * 0.12, Math.sin(notchAt) * r * 0.12]);
    const g = extrudeOutline(pts, 0.05, { uvFeet: false });
    g.rotateX(-Math.PI / 2);
    g.translate(cx, WY + 0.025, cz);
    planarPatch(g, atlas.pad, cx, cz, r);
    return g;
  };
  const padTint = [0x5c8f3e, 0x6a9a44, 0x4f8238, 0x76a24c];
  const addPad = (b, d, r, c, notch) => {
    const [x, z] = polar(b, d);
    scene.push({ geometry: padGeometry(r, x, z, notch), color: c });
    return [x, z];
  };
  const FROG_POS = polar(BEARINGS[4], 4.25);
  scene.push({ geometry: padGeometry(1.72, FROG_POS[0], FROG_POS[1], 2.2), color: 0x5e9440 });
  [[36, 5.1, 0.72, 1.1], [324, 5.0, 0.8, 4.4], [252, 5.45, 0.62, 3.0], [108, 5.5, 0.66, 0.4], [180, 4.7, 0.92, 5.2], [172, 3.2, 0.5, 2], [250, 2.9, 0.55, 1.5], [110, 3.1, 0.6, 3.6], [330, 3.0, 0.42, 0.6], [30, 2.95, 0.46, 4.5]].forEach(([deg, d, r, notch], i) => {
    addPad(deg * DEG, d, r, padTint[i % padTint.length], notch);
  });
  // A water lily in flower, on the pad beside the frog: two whorls of pointed petals round a gold heart.
  {
    const [fx, fz] = polar(36 * DEG, 5.1);
    const y0 = WY + 0.05;
    for (const [n, r, lift, off, col] of [[9, 0.52, 0.12, 0, 0xe8dfe4], [7, 0.36, 0.24, 0.35, 0xf0d6de]]) {
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        const dx = Math.cos(a); const dz = Math.sin(a);
        const g = tube([[fx + dx * 0.05, y0 + 0.03, fz + dz * 0.05], [fx + dx * r * 0.55, y0 + lift * 0.5, fz + dz * r * 0.55], [fx + dx * r, y0 + lift, fz + dz * r]], [0.03, 0.11, 0], { sides: 6, steps: 5, section: () => [1, 0.34], frame: () => [-dz, 0, dx] });
        addPatch(g, col);
      }
    }
    addPatch(new THREE.SphereGeometry(0.13, 12, 8), 0xd9b02e, [fx, y0 + 0.14, fz]);
  }

  // --- The rock the froglet is climbing onto ---
  const ROCK = polar(BEARINGS[3], 4.72);
  {
    const g = stoneGeometry(rng, 1.0, 0.86, 0.92, 18, 12, 0.16);
    { const q = g.attributes.position; for (let i = 0; i < q.count; i++) if (q.getY(i) < -0.2) q.setY(i, -0.2); }
    g.computeVertexNormals();
    g.translate(ROCK[0], 0.3, ROCK[1]);
    planarPatch(g, atlas.stone, ROCK[0], ROCK[1], 2.4);
    // Grey stone, with moss creeping up from the waterline.
    const GREY = lin(0x77786f); const MOSS = lin(0x54683a);
    tintGeometry(g, ({ x, y, z }) => {
      const n = smoothNoise3(x * 2.2, y * 2.2, z * 2.2);
      const m = sstep(n + (0.7 - y) * 0.5, 0.56, 0.72);
      const k = 0.78 + 0.4 * smoothNoise3(x * 4 + 3, y * 4, z * 4);
      return [mix(GREY[0], MOSS[0], m) * k, mix(GREY[1], MOSS[1], m) * k, mix(GREY[2], MOSS[2], m) * k];
    });
    scene.push({ geometry: g, keepColor: true });
  }
  for (const [db, dd, s] of [[-0.3, 1.0, 0.42], [0.28, -0.8, 0.34]]) {
    const [x, z] = polar(BEARINGS[3] + db, 4.72 + dd);
    const g = stoneGeometry(rng, s * 1.2, s * 0.8, s, 10, 7, 0.16);
    g.translate(x, 0.34, z);
    planarPatch(g, atlas.stone, x, z, s * 1.4);
    scene.push({ geometry: g, color: 0x6e6a5c });
  }

  // --- Reeds and cattails in clumps against the rim, each rooted below the waterline ---
  const reedClump = (deg, dist, n, tall) => {
    const b = deg * DEG;
    const [cx, cz] = polar(b, dist);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU; const q = Math.sqrt(rng()) * 0.55;
      const x = cx + Math.cos(a) * q; const z = cz + Math.sin(a) * q;
      const h = tall * (0.7 + rng() * 0.3);
      const lx = (rng() - 0.5) * 0.5; const lz = (rng() - 0.5) * 0.5;
      const isTail = i % 4 === 0;
      const top = [x + lx, 0.12 + h, z + lz];
      const g = tube([[x, 0.1, z], [x + lx * 0.3, 0.1 + h * 0.5, z + lz * 0.3], top], isTail ? [0.04, 0.03, 0.022] : [0.055, 0.035, 0], { sides: 5, steps: 6, round: 1 });
      addPatch(g, isTail ? 0x718a45 : (rng() > 0.5 ? 0x63853c : 0x7c9648));
      if (isTail) {
        const head = tube([[x + lx * 0.86, 0.12 + h * 0.8, z + lz * 0.86], [x + lx * 0.98, 0.12 + h * 0.97, z + lz * 0.98]], [0.082, 0.078], { sides: 7, steps: 3, round: 2, straight: true });
        addPatch(head, 0x523620);
      }
    }
  };
  reedClump(180, 5.75, 9, 3.6);
  reedClump(202, 5.85, 5, 2.9);
  reedClump(120, 5.75, 6, 2.6);
  reedClump(252, 5.8, 6, 2.5);

  // --- The ring of arrows in the middle of the pond: the walk, drawn once, floating ---
  const ARROW_R = 2.3;
  BEARINGS.forEach((b, i) => {
    // From this stage's bearing toward the next: the bearing falls. The last closes the cycle.
    const from = b - 9 * DEG; const to = b - 62 * DEG;
    const half = 0.1; const headHalf = 0.3; const headLen = 15 * DEG;
    const shaftEnd = to + headLen;
    const pts = [];
    const steps = 12;
    const P = (bb, r) => [Math.sin(bb) * r, Math.cos(bb) * r];
    for (let k = 0; k <= steps; k++) pts.push(P(mix(from, shaftEnd, k / steps), ARROW_R + half));
    pts.push(P(shaftEnd, ARROW_R + headHalf));
    pts.push(P(to, ARROW_R));
    pts.push(P(shaftEnd, ARROW_R - headHalf));
    for (let k = steps; k >= 0; k--) pts.push(P(mix(from, shaftEnd, k / steps), ARROW_R - half));
    // A band round a curve is not star-shaped about its centre, so a centre-fan cap folds over itself.
    // The shape is triangulated properly instead.
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, WY + 0.01, 0);
    addPatch(g, i === 4 ? 0xd9a02a : 0xeec14a);
  });

  // --- The animals ---
  const animals = [];
  const eyeParts = [];

  // 5, the adult: at the front, on its pad, looking out at whoever walks up.
  {
    const S = 0.74;
    const m = new THREE.Matrix4().makeTranslation(FROG_POS[0], WY + 0.05, FROG_POS[1] - 0.18);
    const g = frogGeometry({ cell: 0.05, scale: S, seed: 77 });
    g.applyMatrix4(m);
    animals.push({ geometry: g, keepColor: true });
    eyeParts.push(...frogEyes(S, m));
  }
  // 4, the froglet: smaller, still with a stub of tail, up on the rock and headed out of the pond.
  {
    const S = 0.42;
    const b = BEARINGS[3];
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(ROCK[0] + Math.sin(b) * 0.05, 1.0, ROCK[1] + Math.cos(b) * 0.05),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, b, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const g = frogGeometry({ cell: 0.042, scale: S, tail: true, seed: 31, toes: false });
    g.applyMatrix4(m);
    animals.push({ geometry: g, keepColor: true });
    eyeParts.push(...frogEyes(S, m));
  }
  // 1, the frogspawn: a floating clump, each egg a dark embryo in a ball of clear jelly.
  const jelly = [];
  {
    const [cx, cz] = polar(BEARINGS[0], 4.3);
    const eggs = [];
    const R = 0.2;
    let guard = 0;
    while (eggs.length < 50 && guard++ < 6000) {
      const a = rng() * TAU; const q = Math.sqrt(rng());
      const x = cx + Math.cos(a) * q * 1.38; const z = cz + Math.sin(a) * q * 1.2;
      const y = WY + 0.04 + (rng() ** 1.5) * (1 - q * q * 0.85) * 0.62;
      if (eggs.every((e) => Math.hypot(e[0] - x, e[1] - y, e[2] - z) > R * 1.62)) eggs.push([x, y, z]);
    }
    for (const e of eggs) {
      const j = new THREE.SphereGeometry(R, 9, 6);
      j.translate(e[0], e[1], e[2]);
      jelly.push({ geometry: j, color: 0xb9dce6 });
      const d = new THREE.SphereGeometry(0.078, 7, 5);
      d.translate(e[0] + (rng() - 0.5) * 0.04, e[1] + 0.015, e[2] + (rng() - 0.5) * 0.04);
      const tone = 0x17140f;
      animals.push({ geometry: d, color: tone });
    }
  }

  // 2 and 3, the tadpoles: just under the surface, heading the way the walk goes, their backs and
  // the tops of their fins breaking the water.
  const tadList = [
    { b: BEARINGS[1], r: 4.35, opts: { length: 2.7, gills: true, seed: 3 } },
    { b: BEARINGS[2], r: 4.35, opts: { length: 3.0, hindLegs: true, seed: 8 } },
  ];
  const tadGeoms = []; const waveList = [];
  const dirs = [];
  for (const t of tadList) {
    const { geometry, waveAt } = tadpoleGeometry(t.opts);
    const [x, z] = polar(t.b, t.r);
    // Local +Z points along the walk, which at bearing b means falling bearing.
    const hx = -Math.cos(t.b); const hz = Math.sin(t.b);
    const yaw = Math.atan2(hx, hz);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + hx * 0.4, WY - 0.04, z + hz * 0.4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, yaw, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(m);
    tadGeoms.push(geometry);
    waveList.push(waveAt);
    dirs.push(new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, yaw, 0, 'YXZ'))));
  }
  const tadMerged = mergeGeometries(tadGeoms, false);
  const tadP = tadMerged.attributes.position;
  tadP.setUsage(THREE.DynamicDrawUsage);
  const base = Float32Array.from(tadP.array);
  const wave = new Float32Array(tadP.count);
  const sideX = new Float32Array(tadP.count); const sideZ = new Float32Array(tadP.count);
  {
    let o = 0;
    tadGeoms.forEach((g, i) => {
      const n = g.attributes.position.count;
      wave.set(waveList[i], o);
      for (let k = 0; k < n; k++) { sideX[o + k] = dirs[i].x; sideZ[o + k] = dirs[i].z; }
      o += n;
    });
  }
  const tadMat = standard({ vertexColors: true, roughness: 0.42, metalness: 0, bumpMap: grainBump(61, { dots: 900, min: 1, max: 2.6 }), bumpScale: 0.2 });
  const tadMesh = mesh(tadMerged, tadMat);
  tadMerged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, -3.7), 5);

  const setWave = (t) => {
    // A travelling wave that grows toward the tip, which is what pushes water backward.
    const A = 0.09;
    for (let i = 0; i < tadP.count; i++) {
      const s = wave[i];
      const k = i * 3;
      if (s <= 0) continue;
      const off = A * (s * 0.62 + s * s * 0.12) * Math.sin(s * 2.9 - t * 3.4);
      tadP.array[k] = base[k] + sideX[i] * off;
      tadP.array[k + 2] = base[k + 2] + sideZ[i] * off;
    }
    tadP.needsUpdate = true;
  };
  setWave(0.6);

  // --- The water, and the jelly with it: one translucent mesh, so nothing competes for its draw ---
  const ripple = canvasTexture(1024, 1024, (ctx, w, h) => {
    const rr = seededRandom(707);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // Short broken crests, all roughly one way, as a light breeze leaves them. Closed rings read as
    // somebody having drawn circles on the water.
    ctx.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const x = rr() * w; const y = rr() * h;
      ctx.strokeStyle = `rgba(176,196,190,${0.1 + rr() * 0.22})`;
      ctx.lineWidth = 1 + rr() * 2.4;
      const L = 10 + rr() * 34; const lift = (rr() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(x - L, y + lift);
      ctx.quadraticCurveTo(x, y - lift, x + L, y + lift * 0.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 24, 24);
  });
  const sheet = new THREE.CircleGeometry(RW + 0.25, 96);
  sheet.rotateX(-Math.PI / 2);
  sheet.translate(0, WY, 0);
  const wet = [{ geometry: sheet, color: 0x4f8f8a }, ...jelly.map((j) => {
    toPatch(j.geometry, 8 / 1024, 1 - 8 / 1024);
    return j;
  })];
  const waterMesh = mesh(mergeParts(wet), standard({ vertexColors: true, map: ripple, roughness: 0.16, metalness: 0, transparent: true, opacity: 0.52, depthWrite: false }));
  waterMesh.castShadow = false;

  // --- The name plates, on the rim, facing out. They read from inside the pond as well. ---
  const plates = new Plates({ pxPerFoot: 200 });
  const NAMES = ['Frogspawn: eggs in jelly', 'Tadpole with gills', 'Tadpole with back legs', 'Froglet, tail shrinking', 'Adult frog'];
  BEARINGS.forEach((b, i) => {
    const r = RR - 0.36;
    const [x, z] = polar(b, r);
    plates.add(NAMES[i], [x, 0.92, z], { h: 0.46, yaw: b, tilt: 0.14, badge: i + 1 });
    // Two short posts, standing on the stone under the plate.
    const reach = plates.list[i].w * 0.36;
    const px = Math.cos(b) * reach; const pz = -Math.sin(b) * reach;
    for (const sgn of [1, -1]) {
      addPatch(tube([[x + px * sgn, 0.45, z + pz * sgn], [x + px * sgn, 0.72, z + pz * sgn]], 0.04, { sides: 6, steps: 1, round: 1, straight: true }), 0x3a3226);
    }
  });

  // The static scene keeps the UVs given above, which mergeParts does as long as they are present.
  const sceneMesh = mesh(mergeParts(scene), standard({ vertexColors: true, map: atlas.texture, roughness: 0.86, metalness: 0, bumpMap: atlas.texture, bumpScale: 0.5 }));
  sceneMesh.castShadow = true;
  root.add(sceneMesh);
  const animalMesh = mesh(mergeParts(animals), standard({ vertexColors: true, roughness: 0.38, metalness: 0, bumpMap: grainBump(47, { dots: 1200, min: 1.1, max: 3 }), bumpScale: 0.26 }));
  root.add(animalMesh);
  root.add(mesh(mergeParts(eyeParts), standard({ map: eyeTexture(), roughness: 0.12, metalness: 0, vertexColors: true })));
  root.add(tadMesh);
  root.add(waterMesh);
  root.add(plates.mesh());

  if (!reducedMotion()) {
    let t = 0.6; let acc = 0;
    root.userData.tick = {
      update(dt) {
        t += dt; acc += dt;
        if (acc < 1 / 30) return;
        acc = 0;
        setWave(t);
      },
    };
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// 2. The pond, cut open
// ---------------------------------------------------------------------------------------------

// The water's section is a real recess, not a painted wall with fish stuck on it. The cut face stops
// at the bed, the surface carries on over the opening as a thin slab, and the back of the opening is
// the water painted in section. That is what lets a fish turn round. It is still opaque, and it faces
// the approach, and a student looks into it the way they look into a tank.
function stadiumAt(s, x0, x1, zc, r) {
  const L = x1 - x0; const T = 2 * L + 2 * Math.PI * r;
  let d = ((s % T) + T) % T;
  if (d < L) return { x: x1 - d, z: zc + r, yaw: -Math.PI / 2 };
  d -= L;
  if (d < Math.PI * r) { const a = d / r; return { x: x0 - r * Math.sin(a), z: zc + r * Math.cos(a), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) }; }
  d -= Math.PI * r;
  if (d < L) return { x: x0 + d, z: zc - r, yaw: Math.PI / 2 };
  d -= L;
  const a = d / r;
  return { x: x1 + r * Math.sin(a), z: zc - r * Math.cos(a), yaw: Math.atan2(Math.cos(a), Math.sin(a)) };
}

// A sunfish: one swept hull whose depth changes along its length, thin fins rooted inside it.
function bluegill(L, seed = 5) {
  const parts = [];
  const H = L * 0.36; const W = L * 0.09;
  const hAt = (t) => Math.max(0.05, Math.sin(Math.PI * t ** 0.78) ** 0.72) * H;
  const wAt = (t) => Math.max(0.09, Math.sin(Math.PI * t ** 0.9) ** 0.7) * W;
  let hull = new THREE.SphereGeometry(1, 18, 26);
  hull.rotateX(Math.PI / 2);
  hull.deleteAttribute('uv'); hull.deleteAttribute('normal');
  hull = mergeVertices(hull, 1e-4);
  const hp = hull.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i); const y = hp.getY(i); const u = hp.getZ(i);
    const rs = Math.hypot(x, y) || 1;
    const t = (u + 1) / 2;
    hp.setXYZ(i, (x / rs) * wAt(t) * Math.min(1, rs * 3), (y / rs) * hAt(t) * Math.min(1, rs * 3), u * L * 0.5);
  }
  hull.computeVertexNormals();
  const BACK = lin(0x4a5a2e); const SIDE = lin(0x6e8a5c); const BLUE = lin(0x5a8a8c); const BREAST = lin(0xd98a2e); const BAR = lin(0x2c3a24); const FLAP = lin(0x101418);
  tintVertices(hull, (x, y, z, out) => {
    const zn = z / (L * 0.5); const yn = y / H;
    out[0] = mix(SIDE[0], BACK[0], sstep(yn, 0.0, 0.7)); out[1] = mix(SIDE[1], BACK[1], sstep(yn, 0.0, 0.7)); out[2] = mix(SIDE[2], BACK[2], sstep(yn, 0.0, 0.7));
    mixInto(out, BLUE, sstep(zn, 0.35, 0.6) * 0.7);
    mixInto(out, BREAST, (1 - sstep(yn, -0.55, -0.12)) * 0.95 * sstep(zn, -0.6, -0.1));
    const bars = Math.sin(zn * 17 + 0.8 + seed);
    mixInto(out, BAR, sstep(bars, 0.35, 0.8) * sstep(yn, -0.45, -0.05) * (1 - sstep(zn, 0.5, 0.65)) * 0.65);
    // The dark ear flap every bluegill has, just behind the gill cover.
    const fx = (zn - 0.38) / 0.1; const fy = (yn - 0.12) / 0.2;
    mixInto(out, FLAP, 1 - sstep(Math.hypot(fx, fy), 0.8, 1.1));
    mixInto(out, lin(0x1a1a14), 1 - sstep(Math.hypot((zn - 0.97) / 0.04, yn / 0.28), 0.7, 1.1));
  });
  parts.push({ geometry: hull, keepColor: true });

  const fin = (point, thick, color, nu = 10, nv = 4) => parts.push({
    geometry: solidSurface({ nu, nv, point, thick, axis: [1, 0, 0] }), color,
  });
  // Dorsal: spiny and tall in front, soft behind.
  fin((u, v) => {
    const z = mix(0.28, -0.42, u) * L;
    const t = 0.5 + z / L;
    const top = hAt(t) - 0.02;
    const tall = L * (0.1 + 0.14 * Math.sin(Math.PI * clamp01(u * 1.05)) + 0.03 * Math.sin(u * 40));
    return [0, top + v * tall - 0.02, z];
  }, (u, v) => 0.012 * (1 - v ** 3), 0x3a4628, 18, 3);
  // Anal fin.
  fin((u, v) => {
    const z = mix(-0.05, -0.4, u) * L;
    const t = 0.5 + z / L;
    return [0, -hAt(t) + 0.02 - v * L * (0.05 + 0.12 * Math.sin(Math.PI * u)), z];
  }, (u, v) => 0.012 * (1 - v ** 3), 0x46502e, 10, 3);
  // The tail, slightly forked.
  parts.push({
    geometry: solidSurface({
      nu: 12, nv: 4,
      point: (u, v) => {
        const s = 2 * u - 1;
        const reach = L * (0.17 + 0.09 * Math.abs(s) ** 1.2);
        return [0, s * (L * 0.03 + v * L * 0.2), -L * 0.46 - v * reach];
      },
      thick: (u, v) => 0.014 * (1 - v ** 3),
      axis: [1, 0, 0],
    }),
    color: 0x4a5430,
  });
  // A pectoral fin on each side, raked back from behind the gill.
  for (const side of [1, -1]) {
    parts.push({
      geometry: solidSurface({
        nu: 6, nv: 3,
        point: (u, v) => [side * (W * 0.6 + v * 0.1), -L * 0.06 - u * L * 0.09 + v * 0.02, L * 0.14 - v * L * (0.1 + 0.16 * Math.sin(u * Math.PI))],
        thick: (u, v) => 0.01 * (1 - v ** 3),
        axis: [side, 0, 0.3],
      }),
      color: 0xb48a3c,
    });
    const eye = [side * W * 0.72, H * 0.12, L * 0.38];
    parts.push({ geometry: new THREE.SphereGeometry(L * 0.045, 10, 8), color: 0xc4a640, position: eye, scale: [0.55, 1, 1] });
    parts.push({ geometry: new THREE.SphereGeometry(L * 0.027, 10, 8), color: 0x050403, position: [eye[0] + side * 0.013, eye[1], eye[2]], scale: [0.6, 1, 1] });
  }
  return mergeParts(parts);
}

// A small tadpole in a school: round body, fin and tail, nothing more.
function schoolTadpole(s = 1) {
  const parts = [];
  parts.push({ geometry: new THREE.SphereGeometry(0.15, 12, 8), color: 0x4a4626, scale: [0.82, 0.78, 1.18] });
  for (const side of [1, -1]) parts.push({ geometry: new THREE.SphereGeometry(0.026, 8, 6), color: 0x050403, position: [side * 0.09, 0.05, 0.1] });
  parts.push({
    geometry: tube([[0, 0.01, -0.08], [0, 0.015, -0.3], [0.012, 0.01, -0.5], [-0.01, 0.005, -0.68]], [0.05, 0.03, 0.018, 0.003], { sides: 5, steps: 8, round: 1 }),
    color: 0x4c4a2a,
  });
  parts.push({
    geometry: solidSurface({
      nu: 10, nv: 3,
      point: (u, v) => {
        const h = Math.sin(Math.min(1, u + 0.04) * Math.PI) ** 0.6 * 0.06;
        return [0.012 * Math.sin(u * 6), 0.012 + mix(-h, h * 1.1, v), -0.14 - u * 0.56];
      },
      thick: (u, v) => (1 - (2 * v - 1) ** 2) * 0.008,
      axis: [1, 0, 0],
    }),
    color: 0x98986a,
  });
  const g = mergeParts(parts);
  g.scale(s, s, s);
  return g;
}

function heronGeometry() {
  const c = 0.036;
  const s = new Sculpt(c);
  const SLATE = lin(0x62707e); const PALE = lin(0xc9c6bb); const DARK = lin(0x20262e); const WHITE = lin(0xdedcd2);
  // Body held slanted, with a long folded wing.
  // A long narrow keel from chest to tail, not a ball: a heron is slim from the side and from above.
  s.add(curveP([[0, 2.24, 0.34], [0, 2.1, 0.0], [0, 1.86, -0.42], [0, 1.58, -0.86], [0, 1.4, -1.12]], [0.21, 0.27, 0.22, 0.09, 0.015], 16), SLATE);
  // The folded wing lies along the flank and ends in dark flight feathers over the tail.
  for (const side of [1, -1]) {
    s.add(curveP([[side * 0.12, 2.24, 0.2], [side * 0.2, 2.06, -0.14], [side * 0.17, 1.8, -0.54], [side * 0.09, 1.56, -0.96], [side * 0.04, 1.42, -1.18]], [0.13, 0.17, 0.13, 0.07, 0.012], 16), lin(0x566474), { k: 0.09, ck: 0.05 });
  }
  // THE S IS THE ANIMAL: out of the chest, back over the shoulders, then forward to the head.
  const neck = [[0, 2.26, 0.42], [0, 2.56, 0.74], [0, 2.92, 0.62], [0, 3.14, 0.32], [0, 3.34, 0.36], [0, 3.46, 0.6]];
  s.add(curveP(neck, [0.13, 0.095, 0.082, 0.072, 0.066, 0.066], 26), WHITE, { k: 0.1, ck: 0.06 });
  s.add(ellipsoidP([0, 3.49, 0.68], [0.07, 0.08, 0.18], [0.04, 0, 0]), WHITE, { k: 0.05 });
  // A trailing fringe of plumes on the breast.
  s.add(curveP([[0, 2.42, 0.56], [0, 2.14, 0.62], [0, 1.86, 0.54]], [0.07, 0.05, 0.012], 8), PALE, { k: 0.05 });
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    // A dark streak down the front of the neck.
    if (y > 2.3 && y < 3.2 && Math.abs(x) < 0.03 && z > 0.3 && nz > 0.2) mixInto(rgb, DARK, 0.75);
    // The flight feathers: the wing darkens toward its tip, in long lines running back along it.
    if (y < 2.3 && z < 0.2 && Math.abs(x) > 0.06) {
      const lines = Math.sin((y - z * 0.62) * 34);
      mixInto(rgb, DARK, sstep(-z, 0.3, 0.75) * 0.82);
      const f = 0.92 + 0.12 * sstep(lines, 0.1, 0.7);
      rgb[0] *= f; rgb[1] *= f; rgb[2] *= f;
    }
    const n = smoothNoise3(x * 5, y * 5, z * 5);
    const k = 0.9 + n * 0.2;
    rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
  };
  const parts = [{ geometry: polygonize(s, { tint, uvScale: 2, extraReach: 0.04 }), keepColor: true }];
  // The dagger of a bill.
  parts.push({ geometry: tube([[0, 3.5, 0.72], [0, 3.48, 0.98], [0, 3.42, 1.32]], [0.052, 0.036, 0], { sides: 8, steps: 8, section: () => [1, 0.8] }), tint: ({ z }) => { const a = lin(0xd9a62e); const b = lin(0x6a5a2a); const t = sstep(z, 1.0, 1.3); return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }, keepColor: true });
  // The black stripe over the eye, ending in a plume that hangs behind the head.
  for (const side of [1, -1]) {
    parts.push({ geometry: tube([[side * 0.055, 3.555, 0.76], [side * 0.05, 3.57, 0.56], [side * 0.03, 3.5, 0.3], [side * 0.012, 3.34, 0.02]], [0.018, 0.03, 0.022, 0], { sides: 6, steps: 10 }), color: 0x14181e });
    parts.push({ geometry: new THREE.SphereGeometry(0.03, 10, 7), color: 0xe0c040, position: [side * 0.062, 3.51, 0.77] });
    parts.push({ geometry: new THREE.SphereGeometry(0.016, 8, 6), color: 0x050403, position: [side * 0.083, 3.512, 0.778] });
    // Long legs: hip, the backward-bending ankle, down to spread toes.
    const LEG = 0x5e5a3c;
    const hip = [side * 0.13, 1.84, -0.1]; const ank = [side * 0.15, 0.92, -0.2]; const foot = [side * 0.16, 0.06, 0.02];
    parts.push({ geometry: tube([hip, [side * 0.15, 1.42, -0.16], ank], [0.06, 0.04, 0.038], { sides: 8, steps: 6, round: 1 }), color: LEG });
    parts.push({ geometry: new THREE.SphereGeometry(0.052, 10, 7), color: LEG, position: ank });
    parts.push({ geometry: tube([ank, [side * 0.155, 0.5, -0.1], foot], [0.036, 0.032, 0.03], { sides: 8, steps: 6, round: 1 }), color: LEG });
    for (const a of [-0.6, 0, 0.6, Math.PI]) {
      parts.push({ geometry: tube([foot, [foot[0] + Math.sin(a) * 0.3, 0.03, foot[2] + Math.cos(a) * 0.3]], [0.026, 0.012], { sides: 5, steps: 2, round: 1, straight: true }), color: LEG });
    }
  }
  return mergeParts(parts);
}

// A painted turtle: a domed shell with its scutes painted on from a jittered grid, and a yellow-
// striped head and neck held out.
function turtleGeometry() {
  const c = 0.034;
  const s = new Sculpt(c);
  const SHELL = lin(0x2f3a24); const SKIN = lin(0x3a4630); const PLAST = lin(0xc9a94c);
  s.add(ellipsoidP([0, 0.22, 0], [0.46, 0.22, 0.58]), SHELL);
  s.add(ellipsoidP([0, 0.14, 0], [0.42, 0.08, 0.54]), PLAST, { k: 0.02, ck: 0.02 });
  const shellField = s.snapshot();
  s.add(curveP([[0, 0.16, 0.44], [0, 0.22, 0.66], [0, 0.26, 0.84]], [0.1, 0.08, 0.08], 8), SKIN, { k: 0.06 });
  s.add(ellipsoidP([0, 0.28, 0.9], [0.09, 0.075, 0.13]), SKIN, { k: 0.05 });
  for (const side of [1, -1]) {
    s.add(curveP([[side * 0.3, 0.12, 0.3], [side * 0.5, 0.08, 0.44], [side * 0.58, 0.03, 0.56]], [0.07, 0.06, 0.05], 8), SKIN, { k: 0.05 });
    s.add(curveP([[side * 0.28, 0.12, -0.32], [side * 0.48, 0.07, -0.46], [side * 0.56, 0.03, -0.56]], [0.08, 0.065, 0.05], 8), SKIN, { k: 0.05 });
  }
  s.add(curveP([[0, 0.14, -0.5], [0, 0.1, -0.66]], [0.05, 0.012], 4), SKIN, { k: 0.04 });
  // Scute centres: a row of five down the middle, four each side.
  const scutes = [];
  for (let i = 0; i < 5; i++) scutes.push([0, -0.44 + i * 0.22]);
  for (const side of [1, -1]) for (let i = 0; i < 4; i++) scutes.push([side * 0.26, -0.33 + i * 0.22]);
  const LINE = lin(0xb9a24a); const STRIPE = lin(0xc8b23a); const RED = lin(0x9a3a22);
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    const onShell = shellField.d(x, y, z) < c * 0.6 && y > 0.12;
    if (onShell && z < 0.62 && ny > -0.1) {
      let a = 9; let b = 9;
      for (const q of scutes) {
        const d = Math.hypot(x - q[0], z - q[1]);
        if (d < a) { b = a; a = d; } else if (d < b) b = d;
      }
      const edge = 1 - sstep(b - a, 0.015, 0.05);
      const k = 0.8 + 0.5 * smoothNoise3(x * 5, y * 5, z * 5);
      rgb[0] = SHELL[0] * k; rgb[1] = SHELL[1] * k; rgb[2] = SHELL[2] * k;
      mixInto(rgb, LINE, edge * 0.8);
      const rimD = Math.hypot(x / 0.46, z / 0.58);
      mixInto(rgb, RED, sstep(rimD, 0.87, 0.93) * 0.9);
    } else if (rgb[1] < 0.2) {
      // Yellow stripes on neck, head and legs.
      const st = Math.sin((x * 30 + y * 42)) ;
      mixInto(rgb, STRIPE, sstep(st, 0.45, 0.8) * 0.85);
    }
  };
  const parts = [{ geometry: polygonize(s, { tint, uvScale: 2, extraReach: 0.04 }), keepColor: true }];
  for (const side of [1, -1]) parts.push({ geometry: new THREE.SphereGeometry(0.024, 9, 6), color: 0x070604, position: [side * 0.073, 0.31, 0.95] });
  return mergeParts(parts);
}

function nymphGeometry() {
  const s = new Sculpt(0.022);
  const C = lin(0x4e4a26);
  s.add(ellipsoidP([0, 0.1, -0.12], [0.1, 0.055, 0.24]), C);
  s.add(ellipsoidP([0, 0.1, 0.12], [0.075, 0.055, 0.1]), C, { k: 0.04 });
  s.add(ellipsoidP([0, 0.1, 0.27], [0.1, 0.055, 0.075]), C, { k: 0.03 });
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    const band = Math.sin(z * 38);
    const k = 0.8 + 0.25 * sstep(band, -0.2, 0.6);
    rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    if (ny > 0.2 && Math.abs(x) < 0.03) mixInto(rgb, lin(0x2a2814), 0.5);
  };
  const parts = [{ geometry: polygonize(s, { tint, uvScale: 2, extraReach: 0.02 }), keepColor: true }];
  for (const side of [1, -1]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.038, 10, 7), color: 0x14120a, position: [side * 0.085, 0.125, 0.29] });
    for (const [z, zz] of [[0.2, 0.34], [0.12, 0.08], [0.04, -0.14]]) {
      const hip = [side * 0.06, 0.08, z]; const knee = [side * 0.22, 0.13, (z + zz) / 2]; const foot = [side * 0.28, 0.005, zz];
      parts.push({ geometry: tube([hip, knee, foot], [0.016, 0.013, 0.006], { sides: 5, steps: 5, round: 1 }), color: 0x5a5430 });
    }
    // Wing buds, which is what says this will one day fly.
    parts.push({ geometry: new THREE.SphereGeometry(0.05, 8, 6), color: 0x38341c, position: [side * 0.05, 0.15, -0.03], scale: [0.5, 0.25, 2.1] });
  }
  return mergeParts(parts);
}

function dragonflyParts(parts, at, yaw) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  const push = (geometry, color, tint = null) => {
    geometry.applyMatrix4(m);
    parts.push(tint ? { geometry, tint, keepColor: true } : { geometry, color });
  };
  push(tube([[0, 0, 0.14], [0, 0, -0.1], [0, 0.01, -0.45], [0, 0.03, -0.72]], [0.05, 0.04, 0.024, 0.016], { sides: 7, steps: 14, round: 1 }), null, (p) => {
    const local = p.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert());
    const band = Math.sin(local.z * 44);
    const c0 = lin(0x2a78a8); const c1 = lin(0x12202c);
    const t = sstep(band, 0.1, 0.5);
    return [mix(c0[0], c1[0], t), mix(c0[1], c1[1], t), mix(c0[2], c1[2], t)];
  });
  push(new THREE.SphereGeometry(0.06, 10, 7).translate(0, 0.002, 0.16), 0x1a4a60);
  for (const side of [1, -1]) {
    push(new THREE.SphereGeometry(0.05, 10, 7).translate(side * 0.045, 0.015, 0.2), 0x7a2a1c);
    for (const [z, span, chord] of [[0.09, 0.82, 0.13], [0.01, 0.76, 0.15]]) {
      push(solidSurface({
        nu: 12, nv: 3,
        point: (u, v) => {
          const c1 = chord * (0.65 + 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.1 + 0.08)));
          return [side * (0.03 + u * span), 0.03 + 0.015 * u, z + (v - 0.5) * c1];
        },
        thick: () => 0.005,
        axis: [0, 1, 0],
      }), null, ({ x }) => {
        const k = 0.9 + 0.1 * Math.sin(x * 60);
        return [0.72 * k, 0.76 * k, 0.76 * k];
      });
    }
  }
}

function pondCattail(parts, rng, x, y, z, h, { head = true } = {}) {
  const lx = (rng() - 0.5) * 0.4; const lz = (rng() - 0.5) * 0.4;
  const top = [x + lx, y + h, z + lz];
  parts.push({
    geometry: tube([[x, y - 0.2, z], [x + lx * 0.3, y + h * 0.5, z + lz * 0.3], top], head ? [0.042, 0.03, 0.02] : [0.06, 0.038, 0], { sides: 5, steps: 6, round: 1, section: head ? null : () => [1, 0.5] }),
    color: head ? 0x6e8a44 : (rng() > 0.5 ? 0x5f8a3c : 0x7c9a4a),
  });
  if (head) {
    parts.push({ geometry: tube([[x + lx * 0.84, y + h * 0.78, z + lz * 0.84], [x + lx * 0.98, y + h * 0.97, z + lz * 0.98]], [0.09, 0.085], { sides: 8, steps: 3, round: 2, straight: true }), color: 0x523620 });
  }
}

// Exported so the arrows' direction can be held to the rule: each eater comes after what it eats.
export const POND_FOOD_CHAIN = ['SUN', 'PLANTS', 'INSECTS', 'FISH', 'HERON'];

function pondEcosystem() {
  const root = new THREE.Group();
  root.name = 'pond-ecosystem';
  const W = 16; const D = 7; const X0 = -W / 2; const Z0 = -D / 2; const ZF = D / 2;
  const PLINTH = 0.3; const WY = 3.0; const BED = 1.08; const TOPY = 3.8;
  const ZB = 1.8; // the back of the opening

  // --- One description of the ground: the mesh, the painting and both cut outlines read it. ---
  const bedX = (x) => {
    const left = mix(3.56, BED, sstep(x, -6.3, -2.9));
    const right = (2.84 - BED) * sstep(x, 1.5, 5.4) + (3.42 - 2.84) * sstep(x, 5.3, 6.9);
    const wob = 0.05 * Math.sin(x * 2.1 + 1) + 0.03 * Math.sin(x * 5.3);
    return left + right + wob;
  };
  const height = (x, z) => {
    const shore = 0.6 + 0.5 * Math.sin(x * 0.55 + 0.6);
    const back = mix(BED, 3.5 + 0.1 * Math.sin(x * 0.9), sstep(-z, shore - 0.7, shore + 2.1));
    const h = Math.max(bedX(x), back);
    const land = sstep(h, WY - 0.1, WY + 0.25);
    return h + land * 0.07 * fbm(x * 1.3, z * 1.3, 3, 4);
  };
  // Where the bed crosses the waterline at the cut face.
  let xL = 0; let xR = 0;
  for (let x = -8; x < 0; x += 0.01) if (height(x, ZF) < WY) { xL = x; break; }
  for (let x = 8; x > 0; x -= 0.01) if (height(x, ZF) < WY) { xR = x; break; }

  // --- The soil's section, painted texel by texel ---
  const rngP = seededRandom(5150);
  const TW = 1400; const TH = Math.round(TW * D / W); const FH = Math.round(TW * (TOPY - PLINTH) / W); const SH = 60;
  const AH = TH + FH + SH;
  const bacteria = [];
  const atlas = canvasTexture(TW, AH, (ctx) => {
    // The top.
    paintTexels(ctx, TW, TH, (px, py) => {
      const x = X0 + ((px + 0.5) / TW) * W; const z = Z0 + ((py + 0.5) / TH) * D;
      const h = height(x, z);
      const n = fbm(x * 2.2, z * 2.2, 4, 3) * 0.5 + 0.5;
      const fine = noise2(x * 16, z * 16, 9);
      let c;
      if (h < WY + 0.03) {
        // The bed: black ooze with pale silt. It is what the opening's floor shows.
        c = mixc([58, 46, 34], [92, 76, 54], n);
        c = mixc(c, [120, 104, 76], sstep(h, BED + 0.6, WY) * 0.6);
      } else {
        const grass = mixc([70, 104, 44], [112, 136, 58], n);
        const mud = mixc([86, 68, 46], [112, 92, 62], n);
        c = mixc(mud, grass, sstep(h - WY, 0.08, 0.26));
      }
      return shade(c, 1 + fine * 0.09);
    });
    // The cut face.
    const yOf = (py) => TOPY - ((py + 0.5) / FH) * (TOPY - PLINTH);
    const img = ctx.createImageData(TW, FH);
    const d = img.data;
    let o = 0;
    for (let py = 0; py < FH; py++) {
      const y = yOf(py);
      for (let px = 0; px < TW; px++) {
        const x = X0 + ((px + 0.5) / TW) * W;
        const g = height(x, ZF);
        const under = g - y;
        const wob = 0.09 * fbm(x * 1.1, y * 0.6, 3, 21);
        const grain = noise2(x * 26, y * 26, 12) * 0.5 + noise2(x * 58, y * 58, 13) * 0.5;
        let c;
        if (under < 0) c = [40, 34, 28];
        else {
          const isBed = g < WY - 0.02;
          if (isBed) {
            // Under the water: black organic ooze, then banded silt, then pale clay.
            const bands = y + wob * 1.4;
            const depth = under;
            if (depth < 0.2 + wob) c = mixc([32, 26, 20], [46, 36, 26], grain * 0.5 + 0.5);
            else if (depth < 0.42 + wob) c = [86, 72, 54];
            else if (depth < 0.6 + wob * 1.2) c = [62, 52, 38];
            else c = mixc([128, 112, 86], [108, 94, 70], Math.sin(bands * 20) * 0.5 + 0.5);
          } else {
            // Under the bank: dark topsoil with roots, then brown, then clay and stones.
            if (under < 0.32 + wob) c = mixc([44, 34, 22], [58, 46, 30], grain * 0.5 + 0.5);
            else if (under < 1.2 + wob * 2) c = mixc([92, 70, 46], [110, 86, 56], grain * 0.5 + 0.5);
            else c = mixc([134, 108, 76], [118, 94, 66], Math.sin((y + wob) * 15) * 0.5 + 0.5);
          }
          const k = 1 + grain * 0.16;
          c = [c[0] * k, c[1] * k, c[2] * k];
        }
        d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = 255;
      }
    }
    ctx.putImageData(img, 0, TH);
    const fx = (x) => ((x - X0) / W) * TW;
    const fy = (y) => TH + ((TOPY - y) / (TOPY - PLINTH)) * FH;
    // Stones in the clay.
    for (let i = 0; i < 90; i++) {
      const x = X0 + rngP() * W; const y = PLINTH + 0.05 + rngP() * 1.1;
      if (y > height(x, ZF) - 0.5) continue;
      const v = 96 + rngP() * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.95},${v * 0.84})`;
      ctx.beginPath();
      ctx.ellipse(fx(x), fy(y), 2 + rngP() * 6, 1.5 + rngP() * 4, rngP() * 3, 0, TAU);
      ctx.fill();
    }
    // Roots of the bank plants, thin and pale, working down from the surface.
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const left = i < 30;
      const x0 = left ? mix(-7.8, -4.8, rngP()) : mix(5.9, 7.8, rngP());
      let px = fx(x0); let py = fy(height(x0, ZF) - 0.03);
      let a = Math.PI / 2 + (rngP() - 0.5) * 0.7;
      ctx.strokeStyle = `rgba(${176 + rngP() * 30},${150 + rngP() * 24},${112},${0.5 + rngP() * 0.4})`;
      ctx.lineWidth = 1 + rngP() * 1.8;
      ctx.beginPath(); ctx.moveTo(px, py);
      const n = 5 + Math.floor(rngP() * 6);
      for (let k = 0; k < n; k++) { a += (rngP() - 0.5) * 0.6; px += Math.cos(a) * 12; py += Math.sin(a) * 12; ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // Patches of bacteria on the rot in the ooze: pale films, stippled with rods big enough to see.
    for (const [bx, r] of [[-2.1, 0.5], [0.3, 0.42], [2.4, 0.46]]) {
      const gy = height(bx, ZF) - 0.11;
      bacteria.push([bx, gy]);
      ctx.fillStyle = 'rgba(214,196,120,0.36)';
      ctx.beginPath();
      ctx.ellipse(fx(bx), fy(gy), r * TW / W, 0.13 * TW / W, 0, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 70; i++) {
        const a = rngP() * TAU; const q = Math.sqrt(rngP());
        ctx.strokeStyle = rngP() > 0.5 ? 'rgba(236,222,150,0.95)' : 'rgba(200,120,90,0.9)';
        ctx.lineWidth = 2.2;
        const cx = fx(bx) + Math.cos(a) * q * r * TW / W; const cy = fy(gy) + Math.sin(a) * q * 0.12 * TW / W;
        const t = rngP() * 3;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(t) * 4, cy + Math.sin(t) * 4); ctx.stroke();
      }
    }
    // A strip of plain soil for the other three sides.
    ctx.fillStyle = '#6e5840';
    ctx.fillRect(0, TH + FH, TW, SH);
    for (let i = 0; i < 2600; i++) {
      const v = 70 + rngP() * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.8},${v * 0.58})`;
      ctx.fillRect(rngP() * TW, TH + FH + rngP() * SH, 1 + rngP() * 3, 1 + rngP() * 2);
    }
  });
  const topUV = (x, z) => [(x - X0) / W, 1 - ((z - Z0) / D) * (TH / AH)];
  const faceUV = (x, y) => [(x - X0) / W, 1 - (TH + ((TOPY - y) / (TOPY - PLINTH)) * FH) / AH];
  const sideUV = (t, y) => [t * 0.98 + 0.01, 1 - (TH + FH + ((TOPY - y) / (TOPY - PLINTH)) * SH) / AH];

  // --- The ground mesh. Nothing below the water behind the opening can ever be seen, so it is left out. ---
  const nx = 104; const nz = 46; const ring = nx + 1;
  const P = new Float32Array(ring * (nz + 1) * 3); const UVs = new Float32Array(ring * (nz + 1) * 2);
  const H = new Float32Array(ring * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = i + j * ring;
      const x = X0 + (i / nx) * W; const z = Z0 + (j / nz) * D;
      H[k] = height(x, z);
      P[k * 3] = x; P[k * 3 + 1] = H[k]; P[k * 3 + 2] = z;
      const [u, v] = topUV(x, z);
      UVs[k * 2] = u; UVs[k * 2 + 1] = v;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      const zMid = Z0 + ((j + 0.5) / nz) * D;
      if (zMid < ZB - 0.1 && Math.max(H[a], H[b], H[c], H[e]) < WY - 0.04) continue;
      idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(P, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(UVs, 2));
  land.setIndex(idx);
  land.computeVertexNormals();
  const flatPieces = [land.toNonIndexed()];
  // The front: one polygon whose top edge is the ground, which is the bed across the opening.
  {
    const pts = [new THREE.Vector2(X0, PLINTH), new THREE.Vector2(-X0, PLINTH)];
    for (let i = nx; i >= 0; i--) { const x = X0 + (i / nx) * W; pts.push(new THREE.Vector2(x, height(x, ZF))); }
    const shape = new THREE.Shape(pts);
    const shaped = new THREE.ShapeGeometry(shape);
    const g = shaped.index ? shaped.toNonIndexed() : shaped;
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = faceUV(p.getX(i), p.getY(i));
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      p.setZ(i, ZF);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    flatPieces.push(g);
  }
  // The other three sides, at the same stations as the ground's own edge.
  const wall = (from, to, n) => {
    const pos = []; const uv = [];
    for (let i = 0; i < n; i++) {
      const t0 = i / n; const t1 = (i + 1) / n;
      const x0 = mix(from[0], to[0], t0); const z0 = mix(from[1], to[1], t0);
      const x1 = mix(from[0], to[0], t1); const z1 = mix(from[1], to[1], t1);
      const y0 = height(x0, z0); const y1 = height(x1, z1);
      for (const [x, y, z, t] of [[x0, PLINTH, z0, t0], [x1, PLINTH, z1, t1], [x1, y1, z1, t1], [x0, PLINTH, z0, t0], [x1, y1, z1, t1], [x0, y0, z0, t0]]) {
        pos.push(x, y, z);
        const [u, v] = sideUV(t, y);
        uv.push(u, v);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  flatPieces.push(wall([-X0, ZF], [-X0, Z0], nz), wall([-X0, Z0], [X0, Z0], nx), wall([X0, Z0], [X0, ZF], nz));
  const groundMesh = mesh(mergeGeometries(flatPieces, false), standard({ map: atlas, roughness: 0.92, metalness: 0, bumpMap: atlas, bumpScale: 0.6 }));
  root.add(groundMesh);

  // --- The water: its surface, and the section at the back of the opening. ---
  const WTW = 1024; const WTH = 448; const WFH = 230;
  const waterTex = canvasTexture(WTW, WTH + WFH, (ctx) => {
    const r = seededRandom(991);
    const g0 = ctx.createLinearGradient(0, 0, WTW, 0);
    g0.addColorStop(0, '#3b7f7a'); g0.addColorStop(0.5, '#2f7a80'); g0.addColorStop(1, '#5a9a80');
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, WTW, WTH);
    // Algae drifting where the sun is on it, in soft green rafts.
    for (let i = 0; i < 260; i++) {
      const x = r() * WTW; const y = r() * WTH;
      ctx.fillStyle = `rgba(${106 + r() * 40},${152 + r() * 40},${64 + r() * 20},${0.04 + r() * 0.1})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 8 + r() * 44, 4 + r() * 18, r() * 3, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(150,196,90,${0.3 + r() * 0.5})`;
      ctx.fillRect(r() * WTW, r() * WTH, 1 + r() * 2.4, 1 + r() * 2.4);
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const x = r() * WTW; const y = r() * WTH; const L = 8 + r() * 26;
      ctx.strokeStyle = `rgba(190,226,222,${0.08 + r() * 0.18})`;
      ctx.lineWidth = 1 + r() * 1.6;
      ctx.beginPath(); ctx.moveTo(x - L, y); ctx.quadraticCurveTo(x, y - 3 + r() * 6, x + L, y); ctx.stroke();
    }
    // The section: bright where the sun comes in, deep blue-green toward the mud.
    const g1 = ctx.createLinearGradient(0, WTH, 0, WTH + WFH);
    g1.addColorStop(0, '#82c9a8');
    g1.addColorStop(0.14, '#5eb0a0');
    g1.addColorStop(0.5, '#2f8290');
    g1.addColorStop(1, '#134a60');
    ctx.fillStyle = g1;
    ctx.fillRect(0, WTH, WTW, WFH);
    // Sun shafts, all leaning one way, as sunbeams do.
    for (let i = 0; i < 16; i++) {
      const x = r() * WTW; const w = 12 + r() * 40;
      const g = ctx.createLinearGradient(0, WTH, 0, WTH + WFH * 0.8);
      g.addColorStop(0, 'rgba(226,246,206,0.26)');
      g.addColorStop(1, 'rgba(226,246,206,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x, WTH); ctx.lineTo(x + w, WTH);
      ctx.lineTo(x + w - 46, WTH + WFH * 0.8); ctx.lineTo(x - 46 - w * 0.4, WTH + WFH * 0.8);
      ctx.fill();
    }
    // Algae cells in the bright water, thick near the top.
    for (let i = 0; i < 900; i++) {
      const q = r() ** 2.2;
      ctx.fillStyle = `rgba(${96 + r() * 70},${186 + r() * 50},${84},${0.6 * (1 - q) + 0.1})`;
      ctx.beginPath();
      ctx.arc(r() * WTW, WTH + q * WFH, 0.7 + r() * 1.5, 0, TAU);
      ctx.fill();
    }
    // Far weed, in silhouette against the water.
    for (let i = 0; i < 70; i++) {
      const x = r() * WTW;
      const y0 = WTH + WFH; const hh = 40 + r() * 100;
      ctx.strokeStyle = `rgba(14,${64 + r() * 30},${64 + r() * 20},${0.3 + r() * 0.4})`;
      ctx.lineWidth = 2 + r() * 3;
      ctx.beginPath(); ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(x + (r() - 0.5) * 30, y0 - hh * 0.5, x + (r() - 0.5) * 40, y0 - hh);
      ctx.stroke();
    }
  });
  const wTop = (x, z) => [(x - X0) / W, 1 - (((z - Z0) / D) * WTH) / (WTH + WFH)];
  const wSec = (x, y) => [(x - X0) / W, 1 - (WTH + ((WY - y) / (WY - BED + 0.1)) * WFH) / (WTH + WFH)];
  const plateShape = new THREE.Shape([
    new THREE.Vector2(xL, -ZF), new THREE.Vector2(xL - 1.1, -ZF + 0.9), new THREE.Vector2(xL - 1.1, -Z0),
    new THREE.Vector2(xR + 1.0, -Z0), new THREE.Vector2(xR + 1.0, -ZF + 0.9), new THREE.Vector2(xR, -ZF),
  ].reverse());
  const slab = new THREE.ExtrudeGeometry(plateShape, { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, WY - 0.05, 0);
  {
    const p = slab.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const [u, v] = wTop(p.getX(i), p.getZ(i)); uv[i * 2] = u; uv[i * 2 + 1] = v; }
    slab.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const secPts = [new THREE.Vector2(xL - 0.02, WY), new THREE.Vector2(xR + 0.02, WY)];
  for (let i = nx; i >= 0; i--) {
    const x = X0 + (i / nx) * W;
    if (x > xL - 0.02 && x < xR + 0.02) secPts.splice(1, 0, new THREE.Vector2(x, Math.min(WY, height(x, ZB) - 0.04)));
  }
  const section = new THREE.ShapeGeometry(new THREE.Shape(secPts));
  {
    const p = section.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = wSec(p.getX(i), p.getY(i));
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      p.setZ(i, ZB);
    }
    section.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const waterMesh = mesh(mergeGeometries([slab, section.index ? section.toNonIndexed() : section], false), standard({ map: waterTex, roughness: 0.34, metalness: 0, emissive: 0x4a8088, emissiveMap: waterTex, emissiveIntensity: 0.5 }));
  waterMesh.castShadow = false;
  root.add(waterMesh);

  // --- Everything else that holds still ---
  const rng = seededRandom(2024);
  const parts = [];
  // The base, in the same mesh rather than a mesh of its own.
  parts.push({ geometry: new THREE.BoxGeometry(W + 0.5, PLINTH * 0.62, D + 0.5), color: 0x3b2a1c, position: [0, PLINTH * 0.31, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(W + 0.2, PLINTH * 0.42, D + 0.2), color: 0x4a3524, position: [0, PLINTH * 0.79, 0] });

  // Cattails along both shores: rooted in the shallows, seed-heads held above the leaves.
  const clump = (cx, cz, n, tall) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU; const q = Math.sqrt(rng()) * 0.6;
      const x = cx + Math.cos(a) * q; const z = cz + Math.sin(a) * q;
      pondCattail(parts, rng, x, Math.max(height(x, z), BED), z, tall * (0.72 + rng() * 0.3) + (WY - Math.min(WY, height(x, z))), { head: i % 3 === 0 });
    }
  };
  clump(-5.3, 1.9, 10, 2.2);
  clump(-4.5, -0.6, 8, 2.5);
  clump(6.25, 1.6, 8, 1.9);
  clump(2.0, -1.1, 9, 2.2);
  // Grass on the banks.
  for (let i = 0; i < 36; i++) {
    const right = rng() > 0.62;
    const x = right ? mix(6.3, 7.8, rng()) : mix(-7.8, -5.6, rng()); const z = mix(-3.2, 3.2, rng());
    const y = height(x, z);
    for (let k = 0; k < 4; k++) {
      const lx = (rng() - 0.5) * 0.3; const lz = (rng() - 0.5) * 0.3; const h = 0.3 + rng() * 0.32;
      parts.push({ geometry: tube([[x, y - 0.03, z], [x + lx * 0.4, y + h * 0.6, z + lz * 0.4], [x + lx, y + h, z + lz]], [0.028, 0.02, 0], { sides: 3, steps: 3, round: 0 }), color: rng() > 0.5 ? 0x5e8a3a : 0x779a48 });
    }
  }
  // Lily pads with their long stems, the stems visible in the opening.
  const padAt = (x, z, r, notch, tone, stem) => {
    const pts = [];
    for (let i = 0; i <= 36; i++) {
      const a = notch + 0.12 + (i / 36) * (TAU - 0.24);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    pts.push([Math.cos(notch) * r * 0.1, Math.sin(notch) * r * 0.1]);
    const g = extrudeOutline(pts, 0.05, { uvFeet: false });
    g.rotateX(-Math.PI / 2);
    parts.push({
      geometry: g, position: [x, WY + 0.026, z],
      tint: (p) => {
        const a = Math.atan2(p.z, p.x);
        const c0 = lin(tone);
        const k = 0.92 + 0.14 * Math.sin(a * 13);
        return [c0[0] * k, c0[1] * k, c0[2] * k];
      },
      keepColor: true,
    });
    if (stem) {
      const y0 = height(x, z);
      parts.push({ geometry: tube([[x + 0.25, y0 - 0.05, z - 0.1], [x + 0.12, (y0 + WY) / 2, z + 0.06], [x, WY, z]], 0.028, { sides: 5, steps: 8, round: 1 }), color: 0x7a7a3e });
    }
  };
  padAt(-1.6, 2.65, 0.66, 1.2, 0x5a8e3c, true);
  padAt(-0.2, 2.9, 0.42, 3.4, 0x6a9a44, true);
  padAt(-2.3, 1.2, 0.72, 0.4, 0x4f8238, false);
  padAt(0.9, 0.9, 0.62, 2.2, 0x6a9a44, false);
  padAt(1.9, 2.75, 0.5, 5.2, 0x5a8e3c, true);
  padAt(3.1, 2.2, 0.56, 1.0, 0x76a24c, false);
  // A flower on one.
  for (const [n, rr, lift, off, col] of [[9, 0.34, 0.1, 0, 0xe8dfe4], [7, 0.24, 0.2, 0.35, 0xf0d6de]]) {
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU; const dx = Math.cos(a); const dz = Math.sin(a);
      const y0 = WY + 0.05;
      parts.push({ geometry: tube([[-1.6 + dx * 0.03, y0 + 0.02, 2.65 + dz * 0.03], [-1.6 + dx * rr * 0.55, y0 + lift * 0.5, 2.65 + dz * rr * 0.55], [-1.6 + dx * rr, y0 + lift, 2.65 + dz * rr]], [0.02, 0.075, 0], { sides: 5, steps: 4, section: () => [1, 0.34], frame: () => [-dz, 0, dx] }), color: col });
    }
  }
  parts.push({ geometry: new THREE.SphereGeometry(0.085, 10, 7), color: 0xd9b02e, position: [-1.6, WY + 0.14, 2.65] });
  // Eelgrass in the opening, against the back, rooted in the mud.
  for (const [cx, n] of [[-3.0, 6], [-1.55, 7], [0.1, 6], [1.15, 6], [2.5, 6], [3.8, 5]]) {
    for (let i = 0; i < n; i++) {
      const x = cx + (rng() - 0.5) * 0.5; const z = ZB + 0.08 + rng() * 0.22;
      const y0 = height(x, z) - 0.04; const h = (WY - y0) * (0.55 + rng() * 0.38);
      const bend = (rng() - 0.5) * 0.5;
      parts.push({
        geometry: tube([[x, y0, z], [x + bend * 0.3, y0 + h * 0.5, z + 0.03], [x + bend, y0 + h, z]], [0.05, 0.046, 0], { sides: 5, steps: 7, round: 0, section: () => [1, 0.22], frame: () => [1, 0, 0] }),
        color: rng() > 0.5 ? 0x3f8a48 : 0x54a050,
      });
    }
  }

  // The heron, standing in the shallows, looking across the water: the only silhouette against the sky.
  {
    const g = heronGeometry();
    const hx = 4.5; const hz = 0.5;
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(hx, Math.min(WY, height(hx, hz)) - 0.03, hz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2 - 0.25, 0)), new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: g, keepColor: true });
  }
  // The log, from the left bank out over the water, half under, with the turtle on it.
  {
    const log = tube([[-6.3, 3.28, 2.72], [-4.6, 3.08, 2.82], [-3.0, 3.03, 2.9], [-2.45, 3.03, 2.92]], [0.26, 0.25, 0.23, 0.21], { sides: 12, steps: 14, round: 2 });
    tintVertices(log, (x, y, z, out) => {
      const n = smoothNoise3(x * 7, y * 14, z * 14);
      const a = lin(0x4a3a2a); const b = lin(0x2a2018); const t = sstep(n, 0.42, 0.62);
      out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
    });
    parts.push({ geometry: log, keepColor: true });
    const t = turtleGeometry();
    t.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(-3.55, 3.2, 2.88), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 - 0.12, 0)), new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: t, keepColor: true });
  }
  // Down in the opening: the nymph on the mud, stalking, and a snail on the mud beside it.
  {
    const n = nymphGeometry();
    const nx1 = -0.75; const nz1 = 3.05;
    n.scale(1.5, 1.5, 1.5);
    n.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(nx1, height(nx1, nz1) + 0.03, nz1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2 + 0.5, 0)), new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: n, keepColor: true });
    // The snail: a shell wound as a real spiral, sitting on a foot.
    const sx = 0.72; const sz = 3.05; const sy = height(sx, sz);
    const pts = []; const radii = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26; const a = t * TAU * 2.6;
      const rr = mix(0.2, 0.01, t ** 0.75);
      pts.push([Math.cos(a) * rr, 0.24 + t * 0.26, Math.sin(a) * rr]);
      radii.push(mix(0.14, 0.012, t ** 0.8));
    }
    const shell = tube(pts, radii, { sides: 9, steps: 46, round: 1 });
    tintVertices(shell, (x, y, z, out) => {
      const a = Math.atan2(z, x);
      const k = 0.8 + 0.25 * Math.sin(a * 8 + y * 40);
      out[0] = 0.26 * k; out[1] = 0.16 * k; out[2] = 0.07 * k;
    });
    shell.translate(sx, sy, sz);
    parts.push({ geometry: shell, keepColor: true });
    parts.push({ geometry: new THREE.SphereGeometry(1, 14, 8), color: 0x7a6e50, position: [sx, sy + 0.06, sz + 0.04], scale: [0.14, 0.08, 0.34] });
    for (const side of [1, -1]) {
      parts.push({ geometry: tube([[sx + side * 0.05, sy + 0.1, sz + 0.26], [sx + side * 0.1, sy + 0.2, sz + 0.38]], [0.018, 0.008], { sides: 5, steps: 2, round: 1, straight: true }), color: 0x6a6048 });
    }
  }
  // Worms in the mud's section: half sunk into the cut, so they stand proud of it and cannot float.
  const wormAt = (x0, y0, flip, len) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push([x0 + flip * t * len, y0 + 0.07 * Math.sin(t * 7.3) - 0.05 * t, ZF]);
    }
    const g = tube(pts, [0.045, 0.058, 0.06, 0.058, 0.045], { sides: 8, steps: 28, round: 2 });
    tintVertices(g, (x, y, z, out) => {
      const band = Math.sin(x * 40);
      const k = 0.86 + 0.14 * band;
      out[0] = 0.62 * k; out[1] = 0.27 * k; out[2] = 0.24 * k;
    });
    parts.push({ geometry: g, keepColor: true });
  };
  wormAt(-3.3, 0.72, 1, 0.95);
  wormAt(2.1, 0.66, -1, 0.85);
  wormAt(3.5, 0.96, 1, 0.8);
  // A dragonfly settled on a reed over the middle of the water, wings out flat.
  {
    const rx = 0.35; const rz = 1.1; const top = 3.82;
    parts.push({ geometry: tube([[rx, WY - 0.1, rz], [rx + 0.03, 3.45, rz], [rx + 0.06, top, rz]], [0.03, 0.022, 0.016], { sides: 6, steps: 5, round: 1 }), color: 0x6e8a44 });
    dragonflyParts(parts, [rx + 0.06, top + 0.06, rz + 0.04], 0.5);
  }

  // The chain's two posts, on the back bank.
  for (const px of [-4.0, 1.0]) {
    parts.push({ geometry: tube([[px, height(px, -3.0) - 0.05, -3.0], [px, 5.05, -3.0]], 0.05, { sides: 8, steps: 1, round: 1, straight: true }), color: 0x3a2e20 });
  }
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.62, metalness: 0, bumpMap: grainBump(83, { dots: 1000, min: 1, max: 2.6 }), bumpScale: 0.2 })));

  // --- What moves: two sunfish together, and a school of tadpoles in the shallows ---
  const fish = new THREE.Group();
  const fishParts = [];
  {
    const a = bluegill(1.3, 5);
    a.translate(0.0, 0.0, 0.0);
    fishParts.push(a);
    const b = bluegill(1.0, 9);
    b.translate(0.42, -0.34, -0.72);
    fishParts.push(b);
  }
  const fishMesh = mesh(mergeGeometries(fishParts, false), standard({ vertexColors: true, roughness: 0.4, metalness: 0 }));
  fishMesh.geometry.computeBoundingSphere();
  fish.add(fishMesh);
  root.add(fish);
  const tads = new THREE.Group();
  const tadParts = [];
  const trng = seededRandom(66);
  for (let i = 0; i < 5; i++) {
    const g = schoolTadpole(0.92 + trng() * 0.25);
    g.rotateY((trng() - 0.5) * 0.5);
    g.translate((trng() - 0.5) * 0.5, (trng() - 0.5) * 0.3, (i - 2) * 0.42);
    tadParts.push(g);
  }
  tads.add(mesh(mergeGeometries(tadParts, false), standard({ vertexColors: true, roughness: 0.45, metalness: 0 })));
  root.add(tads);

  const fishPath = { x0: -2.1, x1: 1.0, zc: 2.67, r: 0.4 };
  const tadPath = { x0: 1.9, x1: 3.4, zc: 2.72, r: 0.34 };
  const pose = (t) => {
    const f = stadiumAt(t * 0.42 + 1.5, fishPath.x0, fishPath.x1, fishPath.zc, fishPath.r);
    fish.position.set(f.x, 2.14 + 0.07 * Math.sin(t * 0.8), f.z);
    fish.rotation.set(0, f.yaw + 0.07 * Math.sin(t * 5.2), 0);
    const g = stadiumAt(t * 0.3 + 0.8, tadPath.x0, tadPath.x1, tadPath.zc, tadPath.r);
    tads.position.set(g.x, 2.58 + 0.04 * Math.sin(t * 1.3), g.z);
    tads.rotation.set(0, g.yaw + 0.1 * Math.sin(t * 6.1), 0);
  };
  pose(0);
  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; pose(t); } };
  }

  // --- Plates ---
  const plates = new Plates({ pxPerFoot: 180, width: 1200 });
  const twoLines = (title, line, color) => (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let s1 = h * 0.46;
    ctx.font = `700 ${s1}px ${FONT}`;
    if (ctx.measureText(title).width > w - 16) { s1 *= (w - 16) / ctx.measureText(title).width; ctx.font = `700 ${s1}px ${FONT}`; }
    ctx.fillText(title, w / 2, h * 0.32);
    let s2 = h * 0.28;
    ctx.font = `700 ${s2}px ${FONT}`;
    if (ctx.measureText(line).width > w - 16) { s2 *= (w - 16) / ctx.measureText(line).width; ctx.font = `700 ${s2}px ${FONT}`; }
    ctx.fillText(line, w / 2, h * 0.74);
  };
  plates.add('PRODUCERS', [-0.2, WY + 0.26, ZF - 0.04], { w: 2.5, h: 0.52, draw: twoLines('PRODUCERS', 'plants and algae use sunlight', '#3f7a35') });
  plates.add('CONSUMERS', [2.9, WY + 0.26, ZF - 0.04], { w: 2.5, h: 0.52, draw: twoLines('CONSUMERS', 'animals eat plants or each other', '#a85a22') });
  plates.add('DECOMPOSERS', [-0.75, 0.62, ZF + 0.03], { w: 2.9, h: 0.5, draw: twoLines('DECOMPOSERS', 'worms and bacteria break down the dead', '#5a4630') });
  // The chain. Each arrow points at what eats, because that is the way the energy goes.
  plates.add('chain', [-1.5, 5.1, -2.92], {
    w: 6.8, h: 1.12,
    draw: (ctx, w, h) => {
      ctx.fillStyle = '#f5f0e0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d2830';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${h * 0.2}px ${FONT}`;
      ctx.fillText('Energy flows from what is eaten to what eats it', w / 2, h * 0.16);
      const n = POND_FOOD_CHAIN.length;
      const boxW = w * 0.15; const gap = (w - n * boxW - w * 0.04) / (n - 1);
      const y0 = h * 0.34; const bh = h * 0.56;
      const colors = ['#d99a1e', '#3f7a35', '#2a7a8c', '#8a5a2a', '#55606e'];
      POND_FOOD_CHAIN.forEach((name, i) => {
        const x = w * 0.02 + i * (boxW + gap);
        ctx.fillStyle = colors[i];
        ctx.fillRect(x, y0, boxW, bh);
        ctx.fillStyle = '#ffffff';
        let size = bh * 0.42;
        ctx.font = `700 ${size}px ${FONT}`;
        const tw = ctx.measureText(name).width;
        if (tw > boxW - 8) { size *= (boxW - 8) / tw; ctx.font = `700 ${size}px ${FONT}`; }
        ctx.fillText(name, x + boxW / 2, y0 + bh / 2);
        if (i < n - 1) {
          const ax0 = x + boxW + gap * 0.12; const ax1 = x + boxW + gap * 0.88; const ay = y0 + bh / 2;
          ctx.strokeStyle = '#1d2830'; ctx.fillStyle = '#1d2830';
          ctx.lineWidth = h * 0.05;
          ctx.beginPath(); ctx.moveTo(ax0, ay); ctx.lineTo(ax1 - h * 0.1, ay); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ax1, ay); ctx.lineTo(ax1 - h * 0.14, ay - h * 0.1); ctx.lineTo(ax1 - h * 0.14, ay + h * 0.1); ctx.fill();
        }
      });
    },
  });
  root.add(plates.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// 3. The hydroelectric dam, cut down its centre line
// ---------------------------------------------------------------------------------------------

// Exported so a script can hold the model to the rule: the water must be below the crest, the dam
// wider at its foot than at its top, and the intake below the surface and above the turbine.
export const DAM_SECTION = {
  crest: 5.0, reservoir: 4.5, river: 1.22, heelX: -2.6, crestRightX: -2.05, toeX: 0.4, toeY: 1.0,
  intake: [-2.6, 3.05], pipeEnd: [-0.25, 1.7], pipeR: 0.2, runnerY: 1.42,
};

// The back half of a pipe, seen from inside, for a pipe the cut has opened. Wound by measuring.
function halfPipe(path, r, inner, deep) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.2);
  const rows = Math.max(8, path.length * 8); const cols = 10;
  const pos = []; const idx = [];
  const back = new THREE.Vector3(0, 0, -1);
  for (let i = 0; i <= rows; i++) {
    const c = curve.getPoint(i / rows);
    const t = curve.getTangent(i / rows);
    const n = new THREE.Vector3(-t.y, t.x, 0).normalize();
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI;
      const p = c.clone().addScaledVector(n, Math.cos(a) * r).addScaledVector(back, Math.sin(a) * r);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j; const b = a + 1; const c = a + cols + 1; const e = c + 1;
      idx.push(a, b, e, a, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Which way does the first triangle face? The inside of the pipe faces its own axis.
  {
    const A = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[3 * cols]);
    const B = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[3 * cols + 1]);
    const C = new THREE.Vector3().fromBufferAttribute(g.attributes.position, idx[3 * cols + 2]);
    const nn = B.clone().sub(A).cross(C.clone().sub(A));
    if (nn.z < 0) for (let i = 0; i < idx.length; i += 3) { const v = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = v; }
    g.setIndex(idx);
  }
  g.computeVertexNormals();
  const a = lin(inner); const b = lin(deep);
  tintVertices(g, (x, y, z, out, i) => {
    const j = i % (cols + 1);
    const t = Math.sin((j / cols) * Math.PI);
    out[0] = mix(a[0], b[0], t); out[1] = mix(a[1], b[1], t); out[2] = mix(a[2], b[2], t);
  });
  return g;
}

function hydroelectricDam() {
  const root = new THREE.Group();
  root.name = 'hydroelectric-dam';
  const W = 16; const D = 6; const X0 = -8; const ZF = 3; const Z0 = -3; const PLINTH = 0.3;
  const S = DAM_SECTION;
  const HD = S.crest; const WL = S.reservoir; const RY = S.river;
  const slopeX = (y) => S.crestRightX + (WL - y) * ((S.toeX - S.crestRightX) / (WL - S.toeY));
  const slopeY = (x) => WL - (x - S.crestRightX) / ((S.toeX - S.crestRightX) / (WL - S.toeY));
  const ROOM = { x0: -0.25, x1: 3.1, y0: 0.62, y1: 3.42, z: 1.0, outerX0: -0.5, outerX1: 3.3, top: 3.6 };
  const XT = 4.55; const ZT = 1.95; const NOTCH_Y = 0.78;
  const RUNNER = [1.35, S.runnerY, 2.25];

  // --- One description of the ground ---
  const bed = (x) => {
    if (x < S.heelX) return 0.98 + 0.55 * sstep(-x, 3.2, 8) + 0.06 * Math.sin(x * 2.3);
    return 0.86 + 0.05 * Math.sin(x * 1.9 + 1);
  };
  const hillTop = (x) => (x < 1.5 ? 6.0 : mix(6.0, 3.4, sstep(x, 1.5, 7))) + 0.2 * Math.sin(x * 1.1);
  const height = (x, z) => {
    const b = bed(x);
    const up = mix(b, hillTop(x), sstep(-z, 0.5, 3.0));
    let down = b;
    down = mix(down, 1.86, sstep(-z, -0.98, -0.36));
    down = mix(down, hillTop(x), sstep(-z, 1.5, 3.0));
    const t = sstep(x, -3.2, -1.0);
    const h = mix(up, down, t);
    const dry = sstep(h, x < -1 ? WL : RY + 0.04, (x < -1 ? WL : RY + 0.04) + 0.2);
    return h + dry * 0.12 * fbm(x * 0.9, z * 0.9, 3, 7);
  };
  const faceTop = HD + 0.02;

  // --- The atlas: the top, the cut face, then rock and bare concrete ---
  const TW = 1400; const TH = Math.round(TW * D / W); const FH = Math.round(TW * (faceTop - PLINTH) / W); const LOW = 140;
  const AH = TH + FH + LOW;
  const inPipe = (x, y, r) => {
    const [ax, ay] = S.intake; const [bx, by] = S.pipeEnd;
    const dx = bx - ax; const dy = by - ay;
    const t = clamp01(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
    return Math.hypot(x - ax - dx * t, y - ay - dy * t) < r;
  };
  const regionOf = (x, y) => {
    const g = bed(x);
    if (y < (x >= S.heelX && x <= S.toeX + 0.22 ? 0.7 : g)) return 'rock';
    if (x >= S.heelX && x <= S.crestRightX) return 'dam';
    if (x > S.crestRightX && x < slopeX(Math.max(1.0, Math.min(WL, y)))) return 'dam';
    if (x < S.heelX) return 'water';
    if (x >= ROOM.outerX0 && x <= ROOM.outerX1 && y <= ROOM.top) return 'house';
    if (x > ROOM.outerX1) return 'river';
    return 'rock';
  };
  const rngA = seededRandom(4242);
  const atlas = canvasTexture(TW, AH, (ctx) => {
    // The top.
    paintTexels(ctx, TW, TH, (px, py) => {
      const x = X0 + ((px + 0.5) / TW) * W; const z = Z0 + ((py + 0.5) / TH) * D;
      const h = height(x, z);
      const n = fbm(x * 1.8, z * 1.8, 4, 3) * 0.5 + 0.5;
      const fine = noise2(x * 18, z * 18, 9);
      const up = x < -1;
      const shore = up ? WL : RY;
      let c = mixc([64, 92, 48], [96, 116, 58], n);
      c = mixc(c, mixc([116, 106, 90], [146, 132, 112], n), sstep(n, 0.56, 0.68));
      // The pale band a reservoir leaves on its own shore, and gravel along the river.
      c = mixc(c, up ? [186, 170, 146] : [150, 136, 112], 1 - sstep(h, shore + (up ? 0.34 : 0.26), shore + (up ? 0.44 : 0.4)));
      return shade(c, 1 + fine * 0.08);
    });
    // The cut face.
    const img = ctx.createImageData(TW, FH);
    const d = img.data;
    let o = 0;
    for (let py = 0; py < FH; py++) {
      const y = faceTop - ((py + 0.5) / FH) * (faceTop - PLINTH);
      for (let px = 0; px < TW; px++) {
        const x = X0 + ((px + 0.5) / TW) * W;
        const r = regionOf(x, y);
        const grain = noise2(x * 24, y * 24, 12) * 0.5 + noise2(x * 53, y * 53, 13) * 0.5;
        let c;
        if (r === 'dam') {
          // Concrete, with its pours showing as level lift lines.
          const lift = Math.abs(((y * 2.2) % 1) - 0.5);
          c = mixc([166, 162, 150], [146, 142, 130], grain * 0.5 + 0.5);
          if (lift > 0.47) c = shade(c, 0.86);
        } else if (r === 'house') {
          c = mixc([186, 182, 170], [168, 164, 152], grain * 0.5 + 0.5);
        } else if (r === 'water') {
          const t = clamp01((WL - y) / (WL - 1));
          c = mixc([96, 172, 196], [18, 66, 106], t ** 0.8);
          c = shade(c, 1 + grain * 0.02);
        } else if (r === 'river') {
          const t = clamp01((RY - y) / (RY - 0.8));
          c = mixc([84, 160, 184], [34, 92, 124], t);
        } else {
          // Bedrock, in tilted beds, with a darker fractured band.
          const dip = y + x * 0.07 + 0.14 * fbm(x * 0.8, y * 0.8, 3, 9);
          const band = Math.sin(dip * 15);
          c = mixc([110, 98, 84], [88, 78, 68], band * 0.5 + 0.5);
          if (Math.sin(dip * 3.1) > 0.75) c = shade(c, 0.8);
          c = shade(c, 1 + grain * 0.14);
        }
        d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = 255;
      }
    }
    ctx.putImageData(img, 0, TH);
    const fx = (x) => ((x - X0) / W) * TW;
    const fy = (y) => TH + ((faceTop - y) / (faceTop - PLINTH)) * FH;
    // Aggregate: the stones in the concrete, big enough to see, and only in the dam.
    let placed = 0; let guard = 0;
    while (placed < 800 && guard++ < 6000) {
      const x = S.heelX + rngA() * (S.toeX - S.heelX + 0.2); const y = 0.72 + rngA() * (HD - 0.74);
      if (regionOf(x, y) !== 'dam' || inPipe(x, y, S.pipeR + 0.03)) continue;
      const v = 96 + rngA() * 90;
      ctx.fillStyle = `rgb(${v},${v * 0.97},${v * 0.9})`;
      ctx.beginPath();
      ctx.ellipse(fx(x), fy(y), 1.2 + rngA() * 2.8, 1 + rngA() * 2.2, rngA() * 3, 0, TAU);
      ctx.fill();
      placed++;
    }
    // The steel lining of the pipe, as a dark line each side of the cut.
    ctx.strokeStyle = '#3a4650';
    ctx.lineWidth = 4;
    for (const s of [1, -1]) {
      const [ax, ay] = S.intake; const [bx, by] = S.pipeEnd;
      const len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len; const ny = (bx - ax) / len;
      ctx.beginPath();
      ctx.moveTo(fx(ax + nx * s * (S.pipeR + 0.018)), fy(ay + ny * s * (S.pipeR + 0.018)));
      ctx.lineTo(fx(bx + nx * s * (S.pipeR + 0.018)), fy(by + ny * s * (S.pipeR + 0.018)));
      ctx.stroke();
    }
    // Pressure, drawn where it pushes: an arrow at the dam's wet face, longer the deeper it is.
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.fillStyle = 'rgba(255,255,255,0.92)';
    for (const y of [4.1, 3.5, 2.4, 1.75, 1.25]) {
      const len = 0.22 + (WL - y) * 0.32;
      const x1 = S.heelX - 0.05; const x0 = x1 - len;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(fx(x0), fy(y)); ctx.lineTo(fx(x1) - 12, fy(y)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx(x1), fy(y)); ctx.lineTo(fx(x1) - 14, fy(y) - 9); ctx.lineTo(fx(x1) - 14, fy(y) + 9); ctx.fill();
    }
    // Bars across the intake.
    ctx.strokeStyle = '#2a3238'; ctx.lineWidth = 3;
    // Rock and concrete tiles.
    ctx.fillStyle = '#6f6657';
    ctx.fillRect(0, TH + FH, TW / 2, LOW);
    for (let i = 0; i < 1800; i++) {
      const v = 70 + rngA() * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.92},${v * 0.8})`;
      ctx.fillRect(rngA() * TW / 2, TH + FH + rngA() * LOW, 1 + rngA() * 3, 1 + rngA() * 2);
    }
    ctx.fillStyle = '#a8a59a';
    ctx.fillRect(TW / 2, TH + FH, TW / 2, LOW);
    for (let i = 0; i < 90; i++) {
      // Water stains run straight down a dam's dry face.
      const x = TW / 2 + rngA() * TW / 2; const y = TH + FH + rngA() * LOW * 0.4;
      ctx.strokeStyle = `rgba(70,66,56,${0.05 + rngA() * 0.14})`;
      ctx.lineWidth = 1 + rngA() * 5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rngA() - 0.5) * 3, y + rngA() * LOW); ctx.stroke();
    }
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = 'rgba(70,66,56,0.16)';
      ctx.fillRect(TW / 2, TH + FH + (k / 8) * LOW, TW / 2, 1.5);
    }
  });
  const topUV = (x, z) => [(x - X0) / W, 1 - (((z - Z0) / D) * TH) / AH];
  const faceUV = (x, y) => [(x - X0) / W, 1 - (TH + ((faceTop - y) / (faceTop - PLINTH)) * FH) / AH];
  const rockUV = (t, y) => [clamp01(t) * 0.48 + 0.01, 1 - (TH + FH + clamp01((faceTop + 1.2 - y) / (faceTop + 1.2 - PLINTH)) * LOW * 0.98) / AH];
  const concreteUV = (u, v) => [0.51 + clamp01(u) * 0.48, 1 - (TH + FH + (1 - clamp01(v)) * LOW * 0.98) / AH];

  // --- Ground mesh ---
  const nx = 100; const nz = 38; const ring = nx + 1;
  const P = new Float32Array(ring * (nz + 1) * 3); const UVs = new Float32Array(ring * (nz + 1) * 2); const HH = new Float32Array(ring * (nz + 1));
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const k = i + j * ring; const x = X0 + (i / nx) * W; const z = Z0 + (j / nz) * D;
      HH[k] = height(x, z);
      P[k * 3] = x; P[k * 3 + 1] = HH[k]; P[k * 3 + 2] = z;
      const [u, v] = topUV(x, z);
      UVs[k * 2] = u; UVs[k * 2 + 1] = v;
    }
  }
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      const xMid = X0 + ((i + 0.5) / nx) * W;
      const level = xMid < S.heelX + 1 ? WL : RY;
      if (Math.max(HH[a], HH[b], HH[c], HH[e]) < level - 0.05) continue;
      idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(P, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(UVs, 2));
  land.setIndex(idx);
  land.computeVertexNormals();
  const pieces = [land.toNonIndexed()];

  // The cut face, one polygon that goes round everything the cut has opened.
  {
    const [ix, iy] = S.intake; const [jx, jy] = S.pipeEnd;
    const r = S.pipeR / Math.cos(Math.atan2(iy - jy, jx - ix));
    const pts = [[X0, PLINTH], [-X0, PLINTH], [-X0, RY], [XT, RY], [XT, NOTCH_Y], [ROOM.x1, ROOM.y0], [ROOM.x0, ROOM.y0], [jx, jy - r], [ix, iy - r], [ix, iy + r], [jx, jy + r], [ROOM.x0, ROOM.y1], [ROOM.x1, ROOM.y1], [ROOM.x1, RY], [ROOM.outerX1, RY], [ROOM.outerX1, ROOM.top], [ROOM.outerX0, ROOM.top], [ROOM.outerX0, slopeY(ROOM.outerX0)], [S.crestRightX, WL], [S.crestRightX, HD], [S.heelX, HD], [S.heelX, WL], [X0, WL]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const shaped = new THREE.ShapeGeometry(shape);
    const g = shaped.index ? shaped.toNonIndexed() : shaped;
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = faceUV(p.getX(i), p.getY(i));
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      p.setZ(i, ZF);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    pieces.push(g);
  }
  // The other three sides: rock, except where the water has been cut on the left and the right.
  const wall = (from, to, n, top, uvAt) => {
    const pos = []; const uv = [];
    for (let i = 0; i < n; i++) {
      const t0 = i / n; const t1 = (i + 1) / n;
      const x0 = mix(from[0], to[0], t0); const z0 = mix(from[1], to[1], t0);
      const x1 = mix(from[0], to[0], t1); const z1 = mix(from[1], to[1], t1);
      const y0 = top(x0, z0); const y1 = top(x1, z1);
      for (const [x, y, z, t] of [[x0, PLINTH, z0, t0], [x1, PLINTH, z1, t1], [x1, y1, z1, t1], [x0, PLINTH, z0, t0], [x1, y1, z1, t1], [x0, y0, z0, t0]]) {
        pos.push(x, y, z);
        const [u, v] = uvAt(t, y, z);
        uv.push(u, v);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  };
  // Left: the reservoir's section carries on round the corner, as the face's own left edge does.
  pieces.push(wall([X0, Z0], [X0, ZF], nz, (x, z) => Math.max(height(x, z), WL), (t, y, z) => (height(X0, z) > WL + 0.02 ? rockUV(t, y) : faceUV(X0 + 0.02 + t * 0.03, y))));
  pieces.push(wall([-X0, ZF], [-X0, Z0], nz, (x, z) => Math.max(height(x, z), RY), (t, y, z) => (height(-X0, z) > RY + 0.02 ? rockUV(t, y) : faceUV(-X0 - 0.05 - t * 0.03, y))));
  pieces.push(wall([-X0, Z0], [X0, Z0], nx, height, (t, y) => rockUV(t, y)));

  // The dam itself: the same section, extruded back into the hillside, in the bare-concrete patch.
  {
    const whole = [[S.heelX, 0.7], [S.toeX + 0.22, 0.7], [S.toeX, S.toeY], [S.crestRightX, WL], [S.crestRightX, HD], [S.heelX, HD]];
    // Beside the hall the dam stops at the hall's wall, or its toe would stand in the room.
    const beside = [[S.heelX, 0.7], [ROOM.outerX0 + 0.05, 0.7], [ROOM.outerX0 + 0.05, slopeY(ROOM.outerX0 + 0.05)], [S.crestRightX, WL], [S.crestRightX, HD], [S.heelX, HD]];
    const sect = (outline, z0, z1, capStart) => {
      const g0 = extrudeOutline(outline, z1 - z0, { capEnd: false, capStart, uvFeet: true });
      g0.translate(0, 0, (z0 + z1) / 2);
      const g = g0.index ? g0.toNonIndexed() : g0;
      const p = g.attributes.position;
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const [u, v] = concreteUV((p.getZ(i) + 3) / 6, (p.getY(i) - 0.7) / (HD - 0.7));
        uv[i * 2] = u; uv[i * 2 + 1] = v;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeVertexNormals();
      pieces.push(g);
    };
    sect(whole, Z0, ROOM.z - 0.14, true);
    sect(beside, ROOM.z - 0.14, ZF, false);
  }
  root.add(mesh(mergeGeometries(pieces, false), standard({ map: atlas, roughness: 0.9, metalness: 0, bumpMap: atlas, bumpScale: 0.4 })));

  // --- The water's surfaces ---
  const wTex = canvasTexture(1024, 384, (ctx, w, h) => {
    const r = seededRandom(313);
    ctx.fillStyle = '#3a8ea6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const g = 120 + r() * 70;
      ctx.fillStyle = `rgba(${30 + r() * 50},${g},${150 + r() * 40},0.12)`;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, 10 + r() * 50, 4 + r() * 14, 0, 0, TAU);
      ctx.fill();
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < 700; i++) {
      const x = r() * w; const y = r() * h; const L = 6 + r() * 22;
      ctx.strokeStyle = `rgba(214,238,240,${0.12 + r() * 0.26})`;
      ctx.lineWidth = 0.8 + r() * 1.6;
      ctx.beginPath(); ctx.moveTo(x - L, y); ctx.quadraticCurveTo(x, y + (r() - 0.5) * 5, x + L, y); ctx.stroke();
    }
  });
  const quads = [
    [X0, S.heelX + 0.02, Z0, ZF, WL], // the reservoir, its right edge sunk in the dam
    [0.2, ROOM.outerX0 + 3.8, Z0, ROOM.z - 0.14, RY], // the river behind the powerhouse
    [ROOM.outerX1, XT, Z0, ZT, RY], // alongside it, stopping at the open tailrace
    [XT, -X0, Z0, ZF, RY], // and on down the valley
  ];
  const qpos = []; const quv = []; const qidx = [];
  quads.forEach(([x0, x1, z0, z1, y]) => {
    const b = qpos.length / 3;
    for (const [x, z] of [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]) {
      qpos.push(x, y, z);
      quv.push((x - X0) / W, (z - Z0) / D);
    }
    qidx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const qg = new THREE.BufferGeometry();
  qg.setAttribute('position', new THREE.Float32BufferAttribute(qpos, 3));
  qg.setAttribute('uv', new THREE.Float32BufferAttribute(quv, 2));
  qg.setIndex(qidx);
  qg.computeVertexNormals();
  const waterMesh = mesh(qg, standard({ map: wTex, roughness: 0.26, metalness: 0 }));
  waterMesh.castShadow = false;
  root.add(waterMesh);

  // --- The structure ---
  const rng = seededRandom(808);
  const parts = [];
  const box = (x0, x1, y0, y1, z0, z1, color) => parts.push({ geometry: new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] });
  // A wall seen from one side only, for the inside of what the cut opened.
  const inner = (a, b, c, e, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...e], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    parts.push({ geometry: g, color });
  };
  parts.push({ geometry: new THREE.BoxGeometry(W + 0.5, PLINTH * 0.62, D + 0.5), color: 0x3b2a1c, position: [0, PLINTH * 0.31, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(W + 0.2, PLINTH * 0.42, D + 0.2), color: 0x4a3524, position: [0, PLINTH * 0.79, 0] });

  const R = ROOM;
  // The hall's outside.
  const CONC = 0xb4b0a4;
  box(R.outerX0, R.outerX1, R.y1, R.top, R.z, ZF - 0.012, CONC); // roof
  box(R.x1, R.outerX1, RY, R.y1, R.z, ZF - 0.012, CONC); // right wall
  box(R.outerX0, R.x0, slopeY(R.outerX0) - 0.2, R.y1, R.z, ZF - 0.012, CONC); // left wall, sunk in the dam
  box(R.outerX0, R.outerX1, RY - 0.2, R.top, R.z - 0.14, R.z, CONC); // back
  // Its inside: pale, because a machine hall is, and because it is what the machines stand against.
  const IN = 0xd0ccbe; const FLOOR = 0x8f8f86;
  inner([R.x0, R.y0, ZF], [R.x1, R.y0, ZF], [R.x1, R.y0, R.z], [R.x0, R.y0, R.z], FLOOR);
  inner([R.x0, R.y0, R.z], [R.x1, R.y0, R.z], [R.x1, R.y1, R.z], [R.x0, R.y1, R.z], IN);
  inner([R.x0, R.y0, ZF], [R.x0, R.y0, R.z], [R.x0, R.y1, R.z], [R.x0, R.y1, ZF], 0xbdb9ab);
  inner([R.x1, RY, R.z], [R.x1, RY, ZF], [R.x1, R.y1, ZF], [R.x1, R.y1, R.z], 0xbdb9ab);
  inner([R.x0, R.y1, R.z], [R.x1, R.y1, R.z], [R.x1, R.y1, ZF], [R.x0, R.y1, ZF], 0x9a9688);
  // The opening through the right wall, and the tailrace: open on top, with water at its back.
  inner([R.x1, R.y0, R.z], [R.x1, R.y0, ZT], [R.x1, RY, ZT], [R.x1, RY, R.z], 0x8a8a80);
  inner([R.x1, R.y0, ZT], [XT, NOTCH_Y, ZT], [XT, RY, ZT], [R.x1, RY, ZT], 0x2f7f9a);
  inner([R.x1, R.y0, ZF], [XT, NOTCH_Y, ZF], [XT, NOTCH_Y, ZT], [R.x1, R.y0, ZT], 0x4a5a60);
  inner([XT, NOTCH_Y, ZF], [XT, RY, ZF], [XT, RY, ZT], [XT, NOTCH_Y, ZT], 0x2f7f9a);
  // A band of colour round the hall, at the height of the old painted dado.
  box(R.x0 + 0.01, R.x1 - 0.01, 2.08, 2.14, R.z, R.z + 0.012, 0x4a7a86);

  // The penstock's back wall, the turbine's steel, and the way out.
  const pipeZ = ZF;
  parts.push({ geometry: halfPipe([[S.intake[0], S.intake[1], pipeZ], [mix(S.intake[0], S.pipeEnd[0], 0.5), mix(S.intake[1], S.pipeEnd[1], 0.5), pipeZ], [S.pipeEnd[0], S.pipeEnd[1], pipeZ]], S.pipeR, 0x4aa8c8, 0x14567e), keepColor: true });
  const DRAFT = [[RUNNER[0], 1.12, RUNNER[2]], [RUNNER[0], 0.98, RUNNER[2]], [RUNNER[0] + 0.35, 0.88, RUNNER[2]], [RUNNER[0] + 1.0, 0.9, RUNNER[2]], [R.x1, 0.98, RUNNER[2]], [XT + 0.02, 1.0, RUNNER[2]]];
  parts.push({ geometry: halfPipe(DRAFT, 0.2, 0x4aa8c8, 0x14567e), keepColor: true });
  parts.push({
    geometry: tube([[-0.34, 1.72, 2.74], [0.1, 1.6, 2.6], [0.38, 1.47, 2.36], [0.55, 1.42, 2.25]], 0.2, { sides: 14, steps: 16, round: 1 }),
    color: 0x47677c,
  });
  // The scroll case: half of the ring that feeds the runner from every side, the back half so the
  // runner can be seen.
  {
    const g = new THREE.TorusGeometry(0.8, 0.2, 12, 28, Math.PI);
    g.rotateX(-Math.PI / 2);
    g.translate(RUNNER[0], RUNNER[1], RUNNER[2]);
    parts.push({ geometry: g, color: 0x47677c });
    parts.push({ geometry: new THREE.SphereGeometry(0.205, 14, 10), color: 0x47677c, position: [RUNNER[0] + 0.8, RUNNER[1], RUNNER[2]] });
    // Bolted flange rings where the penstock's steel meets the case.
    for (const [x, y, zz, ax] of [[0.1, 1.6, 2.6, [0.62, -0.28, -0.73]], [0.38, 1.47, 2.36, [0.42, -0.12, -0.9]]]) {
      const f = new THREE.TorusGeometry(0.205, 0.028, 8, 28);
      f.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, zz), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...ax).normalize()), new THREE.Vector3(1, 1, 1)));
      parts.push({ geometry: f, color: 0x2e4656 });
    }
    // The concrete block the case is cast into, up to the deck.
    box(RUNNER[0] - 1.1, RUNNER[0] + 1.1, R.y0, 1.2, R.z, RUNNER[2] - 0.22, 0x9c988a);
    // The deck, behind the machine, and the column that carries the generator's frame.
    box(R.x0, R.x1, 2.1, 2.2, R.z, 1.5, 0x8f8f86);
    for (const sx of [-1.05, 1.05]) box(RUNNER[0] + sx - 0.11, RUNNER[0] + sx + 0.11, 1.2, 2.42, RUNNER[2] - 0.96, RUNNER[2] - 0.72, 0x7a786c);
    // A handrail on the deck.
    for (let i = 0; i < 9; i++) {
      const x = R.x0 + 0.18 + i * 0.37;
      if (Math.abs(x - RUNNER[0]) < 0.32) continue;
      parts.push({ geometry: tube([[x, 2.2, 1.49], [x, 2.5, 1.49]], 0.012, { sides: 5, steps: 1, round: 0, straight: true }), color: 0xd0b03a });
    }
    parts.push({ geometry: tube([[R.x0, 2.5, 1.49], [R.x1, 2.5, 1.49]], 0.014, { sides: 5, steps: 1, round: 1, straight: true }), color: 0xd0b03a });
  }
  // The stator: the half that stays still, cut open so the rotor can be seen turning in it.
  {
    const a = new THREE.Shape();
    const O = 0.86; const In = 0.66;
    a.absarc(0, 0, O, 0, Math.PI, false);
    a.absarc(0, 0, In, Math.PI, 0, true);
    const g = new THREE.ExtrudeGeometry(a, { depth: 0.66, bevelEnabled: false, curveSegments: 22 });
    g.rotateX(-Math.PI / 2);
    g.translate(RUNNER[0], 2.4, RUNNER[2]);
    parts.push({ geometry: g, color: 0x35566e });
    for (let i = 0; i <= 12; i++) {
      const b = (i / 12) * Math.PI;
      const c = [RUNNER[0] + Math.cos(b) * (In - 0.02), RUNNER[2] - Math.sin(b) * (In - 0.02)];
      parts.push({ geometry: tube([[c[0], 2.38, c[1]], [c[0], 3.08, c[1]]], 0.035, { sides: 5, steps: 1, round: 1, straight: true }), color: 0xb87333 });
    }
    // The frame over the top, tied back to the wall.
    box(RUNNER[0] - 0.1, RUNNER[0] + 0.1, 3.08, 3.2, R.z, RUNNER[2] + 0.1, 0x35566e);
  }

  // The crest: road, parapet each side, lamp posts, a gatehouse over the intake.
  box(S.heelX - 0.03, S.heelX + 0.05, HD, HD + 0.16, Z0, ZF - 0.012, 0xb4b0a4);
  box(S.crestRightX - 0.05, S.crestRightX + 0.03, HD, HD + 0.16, Z0, ZF - 0.012, 0xb4b0a4);
  box(S.heelX + 0.05, S.crestRightX - 0.05, HD, HD + 0.015, Z0, ZF - 0.012, 0x4f4f4a);
  box(S.heelX + 0.02, S.crestRightX - 0.02, HD + 0.16, HD + 0.72, -0.8, 0.5, 0xc6c2b4);
  box(S.heelX - 0.05, S.crestRightX + 0.05, HD + 0.72, HD + 0.82, -0.9, 0.6, 0x6e4a34);
  for (let i = 0; i < 4; i++) box(S.heelX + 0.12, S.crestRightX - 0.12, HD + 0.4, HD + 0.58, -0.68 + i * 0.32, -0.52 + i * 0.32, 0x273038);
  for (const z of [2.4, 1.2, -1.6]) {
    parts.push({ geometry: tube([[S.heelX + 0.06, HD, z], [S.heelX + 0.06, HD + 0.6, z]], 0.018, { sides: 5, steps: 1, round: 1, straight: true }), color: 0x3a3e42 });
  }

  // The valley: pines above the water, and the town beyond the towers.
  const batch = new Batch();
  for (let i = 0; i < 40; i++) {
    const x = mix(-7.8, 7.8, rng()); const z = mix(-2.9, -0.2, rng());
    const h = height(x, z);
    const shore = x < -1.5 ? WL + 0.5 : RY + 0.6;
    if (h < shore || (x > -3 && x < 0.5)) continue;
    if (x > 3.2 && x < 7.9 && z > -2.1) continue; // keep the bench clear
    addPine(batch, x, h - 0.03, z, 0.7 + rng() * 0.7, rng);
  }
  const WALLS = [0xd8cfae, 0xc8a884, 0xe2dccb, 0xb9c0c6, 0xc4977a, 0xdcc78e];
  const ROOFS = [0x6e4a34, 0x51545a, 0x7e3f2e];
  const houses = [[6.25, -0.5], [6.85, -0.72], [7.45, -0.42], [6.4, -1.25], [7.0, -1.42], [7.6, -1.15], [6.1, -1.85], [6.72, -2.0], [7.32, -2.02], [5.85, -0.92]];
  houses.forEach(([x, z], i) => {
    const hw = 0.34 + rng() * 0.14; const hd = 0.26 + rng() * 0.1; const hh = 0.22 + rng() * 0.08;
    addHouse(batch, x, height(x, z) - 0.01, z, hw, hd, hh, WALLS[i % WALLS.length], ROOFS[i % ROOFS.length], (rng() - 0.5) * 0.6);
  });
  // The tall thing in any small town.
  {
    const cx = 6.95; const cz = -0.98; const gy = height(cx, cz);
    batch.add(new THREE.BoxGeometry(0.2, 0.75, 0.2), 0xe6dfce, { position: [cx, gy + 0.37, cz] });
    batch.add(new THREE.ConeGeometry(0.16, 0.42, 4), 0x51545a, { position: [cx, gy + 0.96, cz], rotation: [0, Math.PI / 4, 0] });
  }
  parts.push({ geometry: mergeGeometries(batch.parts, false), keepColor: true });

  // A lattice tower, and the three wires. A straight strut is two points.
  const strut = (a, b, r = 0.02, color = 0x6e7a84) => parts.push({ geometry: tube([a, b], r, { sides: 4, steps: 1, round: 0, straight: true }), color });
  const tower = (x, z, h) => {
    const y0 = height(x, z) - 0.05; const base = 0.26; const neck = 0.06;
    const levels = 5;
    const at = (l, sx, sz) => {
      const t = l / levels;
      const w = mix(base, neck, t ** 0.75);
      return [x + sx * w, y0 + t * h, z + sz * w];
    };
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      for (let l = 0; l < levels; l++) strut(at(l, sx, sz), at(l + 1, sx, sz), 0.022);
    }
    for (let l = 0; l < levels; l++) {
      const pairs = [[[1, 1], [1, -1]], [[1, -1], [-1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]]];
      for (const [p, q] of pairs) {
        strut(at(l, p[0], p[1]), at(l + 1, q[0], q[1]), 0.011);
        strut(at(l + 1, p[0], p[1]), at(l + 1, q[0], q[1]), 0.011);
      }
    }
    const arms = [];
    for (const [t, span] of [[0.98, 0.42], [0.8, 0.52]]) {
      const y = y0 + t * h;
      strut([x, y, z - span], [x, y, z + span], 0.02);
      arms.push([x, y - 0.06, z - span], [x, y - 0.06, z + span]);
    }
    arms.push([x, y0 + h + 0.12, z]);
    strut([x, y0 + h, z], [x, y0 + h + 0.12, z], 0.012);
    return arms;
  };
  const wire = (a, b, sag = 0.14) => {
    parts.push({
      geometry: tube([a, [mix(a[0], b[0], 0.33), mix(a[1], b[1], 0.33) - sag * 0.75, mix(a[2], b[2], 0.33)], [mix(a[0], b[0], 0.66), mix(a[1], b[1], 0.66) - sag * 0.75, mix(a[2], b[2], 0.66)], b], 0.012, { sides: 3, steps: 8, round: 0 }),
      color: 0x20262c,
    });
  };
  // Transformer yard on the bench, fed from the hall's roof, feeding the first tower.
  const YX = 4.15; const YZ = -0.75; const yardY = height(YX, YZ);
  box(YX - 0.68, YX + 0.68, yardY - 0.02, yardY + 0.03, YZ - 0.5, YZ + 0.5, 0x8c8a7c);
  const bushings = [];
  for (let i = 0; i < 3; i++) {
    const z = YZ - 0.34 + i * 0.34;
    box(YX - 0.26, YX + 0.26, yardY + 0.03, yardY + 0.36, z - 0.12, z + 0.12, 0x5e6e62);
    for (let f = 0; f < 5; f++) box(YX - 0.3 + f * 0.15 - 0.012, YX - 0.3 + f * 0.15 + 0.012, yardY + 0.05, yardY + 0.32, z - 0.16, z + 0.16, 0x4e5e52);
    parts.push({ geometry: lathe([[0, 0], [0.04, 0], [0.04, 0.05], [0.025, 0.07], [0.04, 0.1], [0.025, 0.13], [0.035, 0.16], [0.02, 0.2], [0, 0.2]], 8), color: 0x8f6a4a, position: [YX + 0.14, yardY + 0.36, z] });
    parts.push({ geometry: lathe([[0, 0], [0.04, 0], [0.04, 0.05], [0.025, 0.07], [0.04, 0.1], [0.025, 0.13], [0.035, 0.16], [0.02, 0.2], [0, 0.2]], 8), color: 0x8f6a4a, position: [YX - 0.14, yardY + 0.36, z] });
    bushings.push({ in: [YX - 0.14, yardY + 0.56, z], out: [YX + 0.14, yardY + 0.56, z] });
  }
  [-0.3, 0, 0.3].forEach((off, i) => {
    const a = [ROOM.outerX1 - 0.34, R.top + 0.24, 1.5 + off];
    parts.push({ geometry: tube([[a[0], R.top, a[2]], a], 0.024, { sides: 5, steps: 1, round: 1, straight: true }), color: 0x8f6a4a });
    wire(a, bushings[i].in, 0.1);
  });
  // Fence round the yard: posts, and a top rail.
  const fx0 = YX - 0.72; const fx1 = YX + 0.72; const fz0 = YZ - 0.54; const fz1 = YZ + 0.54; const fy = yardY + 0.22;
  for (const [a, b] of [[[fx0, fz1], [fx1, fz1]], [[fx1, fz1], [fx1, fz0]], [[fx1, fz0], [fx0, fz0]], [[fx0, fz0], [fx0, fz1]]]) {
    strut([a[0], fy, a[1]], [b[0], fy, b[1]], 0.01, 0x9aa0a4);
    strut([a[0], yardY, a[1]], [a[0], fy, a[1]], 0.012, 0x9aa0a4);
  }
  const t1 = tower(5.25, -1.0, 2.5);
  const t2 = tower(6.15, -2.55, 2.55);
  const tArms = [t1[0], t1[2], t1[1]];
  bushings.forEach((b, i) => wire(b.out, tArms[i], 0.08));
  [[0, 0], [1, 1], [2, 3]].forEach(([i, j]) => wire(t1[i < 2 ? i : 3], t2[j], 0.16));
  // Down from the last tower to a pole in the middle of town.
  const pole = [7.05, height(7.05, -1.72), -1.72];
  strut([pole[0], pole[1] - 0.05, pole[2]], [pole[0], pole[1] + 1.05, pole[2]], 0.03, 0x4a3524);
  strut([pole[0], pole[1] + 1.0, pole[2] - 0.2], [pole[0], pole[1] + 1.0, pole[2] + 0.2], 0.018, 0x4a3524);
  wire(t2[3], [pole[0], pole[1] + 1.02, pole[2] + 0.18], 0.14);
  wire(t2[2], [pole[0], pole[1] + 1.02, pole[2] - 0.18], 0.14);
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.74, metalness: 0, bumpMap: grainBump(39, { dots: 800, min: 0.8, max: 2 }), bumpScale: 0.14 })));

  // --- What spins: runner, shaft and rotor, on one axle ---
  const spin = new THREE.Group();
  spin.position.set(RUNNER[0], 0, RUNNER[2]);
  const rotor = [];
  const BRONZE = 0xc0a668;
  rotor.push({ geometry: lathe([[0, 1.5], [0.2, 1.5], [0.25, 1.56], [0.24, 1.62], [0.15, 1.72], [0.09, 1.76], [0, 1.76]], 28), color: 0x9a8650 });
  // The nose of the hub, down the middle of the water's way out.
  rotor.push({ geometry: lathe([[0, 1.08], [0.05, 1.12], [0.13, 1.3], [0.2, 1.48], [0.2, 1.6], [0, 1.6]], 20), color: 0xa8905a });
  // The runner's blades: each one sweeps round as it comes in, which is what the water pushes on.
  const BLADES = 9;
  for (let i = 0; i < BLADES; i++) {
    const a0 = (i / BLADES) * TAU;
    rotor.push({
      geometry: solidSurface({
        nu: 14, nv: 6,
        point: (u, v) => {
          const r = mix(0.6, 0.17, u);
          const a = a0 + 1.5 * u ** 1.1;
          const low = mix(1.42, 1.16, u);
          return [Math.cos(a) * r, mix(mix(1.6, 1.58, u), low, v), Math.sin(a) * r];
        },
        thick: (u, v) => 0.024 * (1 - 0.5 * v),
      }),
      color: i === 0 ? 0xc85a30 : BRONZE,
    });
  }
  // The shaft, marked so that it can be seen to turn.
  {
    const g = lathe([[0, 1.72], [0.085, 1.72], [0.085, 2.5], [0, 2.5]], 16);
    tintVertices(g, (x, y, z, out) => { const a = Math.atan2(z, x); const m = lin(Math.sin(a * 2) > 0 ? 0x8d979c : 0x4a5258); out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; });
    rotor.push({ geometry: g, keepColor: true });
    rotor.push({ geometry: lathe([[0, 1.74], [0.17, 1.74], [0.17, 1.82], [0, 1.82]], 16), color: 0x6a7276 });
  }
  // The generator's rotor: poles round a wheel, alternately copper and steel so the turning reads.
  rotor.push({ geometry: lathe([[0, 2.46], [0.46, 2.46], [0.46, 3.0], [0, 3.0]], 28), color: 0x4a4e52 });
  const POLES = 10;
  for (let i = 0; i < POLES; i++) {
    const a = (i / POLES) * TAU;
    rotor.push({ geometry: new THREE.BoxGeometry(0.2, 0.5, 0.16), color: i % 2 ? 0xb87333 : 0xcdd0d0, position: [Math.sin(a) * 0.52, 2.73, Math.cos(a) * 0.52], rotation: [0, a, 0] });
  }
  rotor.push({ geometry: lathe([[0, 3.0], [0.3, 3.0], [0.28, 3.04], [0.1, 3.08], [0, 3.08]], 18), color: 0x6a7276 });
  const spinMesh = mesh(mergeParts(rotor), standard({ vertexColors: true, roughness: 0.5, metalness: 0.1 }));
  spin.add(spinMesh);
  root.add(spin);

  // --- The water moving: dashes along the pipe, gone inside the closed steel, out through the tailrace ---
  const pathA = [[S.intake[0] + 0.02, S.intake[1], ZF - 0.08], [S.pipeEnd[0] + 0.02, S.pipeEnd[1], ZF - 0.08]];
  const curveB = new THREE.CatmullRomCurve3(DRAFT.map((p) => new THREE.Vector3(p[0], p[1], p[2] + 0.02)), false, 'catmullrom', 0.2);
  const lenA = Math.hypot(pathA[1][0] - pathA[0][0], pathA[1][1] - pathA[0][1]);
  const lenB = curveB.getLength();
  const GAP = 1.1;
  const TOTAL = lenA + GAP + lenB;
  const lookup = [];
  for (let i = 0; i <= 80; i++) lookup.push(curveB.getPointAt(i / 80));
  const atB = (s) => { const t = clamp01(s) * 80; const i = Math.min(79, Math.floor(t)); return lookup[i].clone().lerp(lookup[i + 1], t - i); };
  const DASHES = 30; const SP = TOTAL / DASHES;
  const dashPos = new Float32Array(DASHES * 8 * 3);
  const dashNor = new Float32Array(DASHES * 8 * 3);
  const dashIdx = [];
  for (let i = 0; i < DASHES; i++) {
    const o = i * 8;
    for (let k = 0; k < 8; k++) { dashNor[(o + k) * 3 + 2] = 1; }
    // A closed block: each dash has thickness, and is wound outward.
    const f = [[0, 1, 2, 0, 2, 3], [5, 4, 7, 5, 7, 6], [4, 0, 3, 4, 3, 7], [1, 5, 6, 1, 6, 2], [3, 2, 6, 3, 6, 7], [4, 5, 1, 4, 1, 0]];
    for (const q of f) for (const v of q) dashIdx.push(o + v);
  }
  const dashes = new THREE.BufferGeometry();
  dashes.setAttribute('position', new THREE.BufferAttribute(dashPos, 3).setUsage(THREE.DynamicDrawUsage));
  dashes.setAttribute('normal', new THREE.BufferAttribute(dashNor, 3));
  dashes.setIndex(dashIdx);
  dashes.boundingSphere = new THREE.Sphere(new THREE.Vector3(1, 2, 2.5), 7);
  dashes.boundingBox = new THREE.Box3(new THREE.Vector3(-2.7, 0.7, 1.9), new THREE.Vector3(4.7, 3.3, 3));
  const setDashes = (t) => {
    const a = dashes.attributes.position;
    const HALF = 0.11; const Th = 0.042;
    for (let i = 0; i < DASHES; i++) {
      const s = ((i * SP + t * 1.25) % TOTAL + TOTAL) % TOTAL;
      let c; let tx; let ty; let shrink = 1;
      if (s < lenA) {
        const u = s / lenA;
        c = new THREE.Vector3(mix(pathA[0][0], pathA[1][0], u), mix(pathA[0][1], pathA[1][1], u), pathA[0][2]);
        tx = (pathA[1][0] - pathA[0][0]) / lenA; ty = (pathA[1][1] - pathA[0][1]) / lenA;
        shrink = Math.min(1, s / 0.12, (lenA - s) / 0.12);
      } else if (s > lenA + GAP) {
        const v = (s - lenA - GAP) / lenB;
        c = atB(v);
        const n = atB(Math.min(1, v + 0.01)).sub(atB(Math.max(0, v - 0.01)));
        const nl = Math.hypot(n.x, n.y) || 1;
        tx = n.x / nl; ty = n.y / nl;
        shrink = Math.min(1, (s - lenA - GAP) / 0.14, (TOTAL - s) / 0.2);
      } else {
        // Inside the closed steel, where nothing can see it.
        c = new THREE.Vector3(RUNNER[0], RUNNER[1], RUNNER[2]); tx = 1; ty = 0; shrink = 0;
      }
      const hx = tx * HALF * shrink; const hy = ty * HALF * shrink;
      const nx2 = -ty * Th * shrink; const ny2 = tx * Th * shrink;
      const dz = 0.02 * shrink;
      let o = i * 8 * 3;
      for (const [sa, sb, sz] of [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]]) {
        a.array[o++] = c.x + hx * sa + nx2 * sb;
        a.array[o++] = c.y + hy * sa + ny2 * sb;
        a.array[o++] = c.z + dz * sz;
      }
    }
    a.needsUpdate = true;
  };
  setDashes(0);
  root.add(mesh(dashes, standard({ color: 0xdff4fb, roughness: 0.3, metalness: 0, emissive: 0x9ad8ee, emissiveIntensity: 0.55 })));

  const pose = (t) => { spin.rotation.y = -t * 2.6 + 0.4; setDashes(t); };
  pose(0);
  if (!reducedMotion()) {
    let t = 0; let acc = 0;
    root.userData.tick = {
      update(dt) {
        t += dt; acc += dt;
        spin.rotation.y = -t * 2.6 + 0.4;
        if (acc < 1 / 30) return;
        acc = 0;
        setDashes(t);
      },
    };
  }

  // --- Labels ---
  const plates = new Plates({ pxPerFoot: 170, width: 1100 });
  const z = ZF + 0.03;
  plates.add('RESERVOIR', [-5.6, 3.55, z], { h: 0.44 });
  plates.add('Deeper water pushes harder', [-5.75, 2.75, z], { h: 0.28, bg: '#dcecf0' });
  plates.add('DAM', [-1.95, 1.3, z], { h: 0.4 });
  plates.add('PENSTOCK', [-1.72, 3.42, z], { h: 0.32, yaw: 0, bg: '#fff4c8' });
  plates.add('TURBINE', [2.55, 1.72, 2.92], { h: 0.3, bg: '#fff4c8' });
  plates.add('GENERATOR', [2.52, 3.02, 2.92], { h: 0.3, bg: '#fff4c8' });
  plates.add('RIVER', [6.3, 0.88, z], { h: 0.34, bg: '#dcecf0' });
  plates.add('POWER LINES', [5.25, 3.72, -0.72], { h: 0.3 });
  plates.add('TOWN', [6.9, height(6.9, -0.1) + 0.36, -0.08], { h: 0.26 });
  root.add(plates.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// 4. The seasons
// ---------------------------------------------------------------------------------------------

// The whole lesson, as numbers a script can hold the model to. Theta is the angle round the orbit,
// counter-clockwise seen from above the north. The axis leans toward -X, which is where the lamp is
// from the June marker at +X, and it never changes.
export const EARTH_TILT_DEG = 23.4;
export const SEASON_AXIS = [-Math.sin(EARTH_TILT_DEG * DEG), Math.cos(EARTH_TILT_DEG * DEG), 0];
export const SEASON_YEAR_SECONDS = 40;
export const SEASON_MARKERS = [
  { name: 'June Solstice', theta: 0, note: 'North leans toward the Sun: summer in the north' },
  { name: 'September Equinox', theta: Math.PI / 2, note: 'Neither pole leans toward the Sun' },
  { name: 'December Solstice', theta: Math.PI, note: 'North leans away from the Sun: winter in the north' },
  { name: 'March Equinox', theta: Math.PI * 1.5, note: 'Neither pole leans toward the Sun' },
];
export const SEASON_ORBIT_R = 5.6;
export const orbitPoint = (theta) => [Math.cos(theta) * SEASON_ORBIT_R, -Math.sin(theta) * SEASON_ORBIT_R];
// How far the north pole leans toward the lamp: +sin(tilt) in June, -sin(tilt) in December.
export function northLean(theta) {
  const [x, z] = orbitPoint(theta);
  const len = Math.hypot(x, z);
  return SEASON_AXIS[0] * (-x / len) + SEASON_AXIS[2] * (-z / len);
}

function seasonsOrbit() {
  const root = new THREE.Group();
  root.name = 'seasons-orbit';
  const RB = 7.6; const TOP = 0.3; const RO = SEASON_ORBIT_R; const CY = 3.6; const RG = 1.0;
  const THETA0 = 5 * DEG; // just past June, with the north plainly lit
  const SPIN_RATE = (3 * TAU) / SEASON_YEAR_SECONDS;

  // --- The printed top ---
  const S = 2048;
  const toPx = (v) => ((v / RB) + 1) / 2 * S;
  const printed = canvasTexture(S, S, (ctx) => {
    const r = seededRandom(1923);
    ctx.fillStyle = '#10182a';
    ctx.fillRect(0, 0, S, S);
    const glow = ctx.createRadialGradient(S / 2, S / 2, 20, S / 2, S / 2, toPx(3.6) - S / 2);
    glow.addColorStop(0, 'rgba(255,206,110,0.85)');
    glow.addColorStop(0.3, 'rgba(255,170,70,0.3)');
    glow.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const v = 120 + r() * 130;
      ctx.fillStyle = `rgba(${v},${v},${v + 10},${0.25 + r() * 0.6})`;
      ctx.beginPath();
      ctx.arc(r() * S, r() * S, 0.6 + r() * r() * 2.6, 0, TAU);
      ctx.fill();
    }
    const cx = S / 2; const cy = S / 2; const scale = S / (2 * RB);
    // The track: a double gold line with the globe's way marked in chevrons.
    ctx.strokeStyle = '#d9b45a';
    ctx.lineWidth = 7;
    ctx.beginPath(); ctx.arc(cx, cy, (RO + 0.48) * scale, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, (RO - 0.48) * scale, 0, TAU); ctx.stroke();
    // Chevrons point counter-clockwise on the sheet, which is counter-clockwise seen from above.
    ctx.fillStyle = 'rgba(217,180,90,0.75)';
    for (let i = 0; i < 48; i++) {
      const th = (i / 48) * TAU;
      ctx.save();
      ctx.translate(cx + Math.cos(th) * RO * scale, cy - Math.sin(th) * RO * scale);
      // Heading along increasing theta: (-sin, -cos) on the sheet.
      ctx.rotate(Math.atan2(-Math.cos(th), -Math.sin(th)));
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-8, -13); ctx.lineTo(-2, 0); ctx.lineTo(-8, 13);
      ctx.fill();
      ctx.restore();
    }
    // The months, at the middle of each, read from outside the ring.
    const MONTHS = [['JAN', 15], ['FEB', 46], ['MAR', 74], ['APR', 105], ['MAY', 135], ['JUN', 166], ['JUL', 196], ['AUG', 227], ['SEP', 258], ['OCT', 288], ['NOV', 319], ['DEC', 349]];
    const JUNE_DAY = 172;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 42px ${FONT}`;
    for (const [name, day] of MONTHS) {
      const th = ((day - JUNE_DAY) / 365) * TAU;
      const px = cx + Math.cos(th) * (RO + 0.82) * scale; const py = cy - Math.sin(th) * (RO + 0.82) * scale;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(-(px - cx), py - cy));
      ctx.fillStyle = '#c6cedc';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
    // A short line from the Sun out to each of the four markers.
    for (const m of SEASON_MARKERS) {
      ctx.strokeStyle = 'rgba(255,220,140,0.45)';
      ctx.lineWidth = 5;
      ctx.setLineDash([26, 22]);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(m.theta) * 1.2 * scale, cy - Math.sin(m.theta) * 1.2 * scale);
      ctx.lineTo(cx + Math.cos(m.theta) * (RO - 0.5) * scale, cy - Math.sin(m.theta) * (RO - 0.5) * scale);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // The way round, said in words, inside the ring where nothing rolls over it.
    ctx.font = `700 64px ${FONT}`;
    ctx.fillStyle = '#e8dcbc';
    ctx.fillText('One trip round the Sun is one year', cx, cy + 3.2 * scale);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 18, 18);
  });
  const disc = new THREE.CircleGeometry(RB - 0.12, 96);
  disc.rotateX(-Math.PI / 2);
  disc.translate(0, TOP, 0);

  const plates = new Plates({ pxPerFoot: 150, width: 1100 });
  const twoLine = (title, note) => (ctx, w, h) => {
    ctx.fillStyle = '#f5f0e0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d2830';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let s1 = h * 0.46;
    ctx.font = `700 ${s1}px ${FONT}`;
    if (ctx.measureText(title).width > w - 18) { s1 *= (w - 18) / ctx.measureText(title).width; ctx.font = `700 ${s1}px ${FONT}`; }
    ctx.fillText(title, w / 2, h * 0.31);
    let s2 = h * 0.25;
    ctx.font = `700 ${s2}px ${FONT}`;
    if (ctx.measureText(note).width > w - 18) { s2 *= (w - 18) / ctx.measureText(note).width; ctx.font = `700 ${s2}px ${FONT}`; }
    ctx.fillStyle = '#7a4a10';
    ctx.fillText(note, w / 2, h * 0.75);
  };
  const stand = [];
  stand.push({ geometry: lathe([[0, 0], [RB, 0], [RB, TOP * 0.74], [RB - 0.05, TOP * 0.8], [RB - 0.1, TOP + 0.012], [RB - 0.12, TOP - 0.03], [0, TOP - 0.03]], 96), color: 0x1a2030 });
  // The lamp's post, up through a brass collar to the Sun.
  stand.push({ geometry: lathe([[0, TOP], [0.72, TOP], [0.72, TOP + 0.07], [0.42, TOP + 0.14], [0.14, TOP + 0.24], [0.1, TOP + 0.55], [0.1, CY - 0.72], [0.2, CY - 0.72], [0.2, CY - 0.64], [0, CY - 0.64]], 28), color: 0x8a7038 });
  // A marker on the track for each season, and its plate outside the ring, on two posts.
  const YAWS = [0.36, 0, -0.36, 0];
  SEASON_MARKERS.forEach((m, i) => {
    const [x, z] = orbitPoint(m.theta);
    stand.push({ geometry: lathe([[0, TOP], [0.3, TOP], [0.3, TOP + 0.03], [0.2, TOP + 0.06], [0, TOP + 0.08]], 20), color: 0xd9b45a, position: [x, 0, z] });
    const px = Math.cos(m.theta) * (RO + 1.28); const pz = -Math.sin(m.theta) * (RO + 1.28);
    const w = 3.7; const y = 1.18;
    plates.add(m.name, [px, y, pz], { w, h: 0.74, yaw: YAWS[i], tilt: 0.1, draw: twoLine(m.name, m.note) });
    for (const sgn of [1, -1]) {
      const qx = px + Math.cos(YAWS[i]) * sgn * 1.2; const qz = pz - Math.sin(YAWS[i]) * sgn * 1.2;
      stand.push({ geometry: tube([[qx, TOP - 0.02, qz], [qx, y - 0.34, qz]], 0.04, { sides: 7, steps: 1, round: 1, straight: true }), color: 0x6a5a30 });
    }
  });
  plates.add('The Sun', [0, TOP + 0.62, 0.92], { h: 0.3, tilt: 0.3, bg: '#fff0c8' });
  // One mesh for the printed top and everything standing on it: the stand reads a white corner of the
  // sheet, and so multiplies nothing, and the disc is plain white under its own print.
  const whiteU = 12 / S; const whiteV = 1 - 12 / S;
  const standParts = mergeParts(stand);
  toPatch(standParts, whiteU, whiteV);
  const printedTop = mergeParts([{ geometry: disc, color: 0xffffff }]);
  const standAll = mergeGeometries([standParts.index ? standParts.toNonIndexed() : standParts, printedTop.index ? printedTop.toNonIndexed() : printedTop], false);
  root.add(mesh(standAll, standard({ vertexColors: true, map: printed, roughness: 0.58, metalness: 0.05 })));

  // --- The Sun, unlit: a lamp is its own light, and the world's sun must not put a dark side on it ---
  const sunMap = canvasTexture(512, 256, (ctx, w, h) => {
    const r = seededRandom(52);
    ctx.fillStyle = '#ffe07a';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = r() > 0.5 ? `rgba(255,246,190,${0.1 + r() * 0.25})` : `rgba(255,170,50,${0.08 + r() * 0.2})`;
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, 1 + r() * 7, 0, TAU);
      ctx.fill();
    }
  });
  const sun = mesh(new THREE.SphereGeometry(0.82, 40, 26), new THREE.MeshBasicMaterial({ map: sunMap, toneMapped: false }));
  sun.position.set(0, CY, 0);
  sun.castShadow = false;
  sun.receiveShadow = false;
  root.add(sun);

  // --- What travels: everything under `carrier` translates and never turns ---
  const carrier = new THREE.Group();
  carrier.name = 'carrier';
  root.add(carrier);
  const A = new THREE.Vector3(...SEASON_AXIS);
  const pt = (d) => [A.x * d, A.y * d, A.z * d];
  const POLAR = RG + 0.24; const TAIL = RG + 0.42;
  const rig = [];
  // The rod, right through the globe.
  rig.push({ geometry: tube([pt(-TAIL), pt(POLAR)], 0.035, { sides: 10, steps: 1, round: 1, straight: true }), color: 0xc8a650 });
  // The pointer above the north pole, straight on along the rod: the thing to watch all year.
  const TIP = RG + 1.3;
  rig.push({ geometry: tube([pt(POLAR - 0.02), pt(TIP - 0.3)], 0.024, { sides: 8, steps: 1, round: 0, straight: true }), color: 0xe8c040 });
  {
    const cone = lathe([[0, 0], [0.09, 0], [0, 0.32]], 14);
    cone.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pt(TIP - 0.3)), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), A), new THREE.Vector3(1, 1, 1)));
    rig.push({ geometry: cone, color: 0xe8c040 });
  }
  // The arm, from the cart up to the bottom of the rod, curved to clear the globe.
  const low = pt(-TAIL);
  const footY = TOP + 0.14 - CY;
  rig.push({ geometry: tube([[0, footY - 0.05, 0], [0, footY + 0.5, 0], [low[0] * 0.8, low[1] - 0.3, low[2]], low], [0.075, 0.06, 0.05, 0.05], { sides: 10, steps: 16, round: 1 }), color: 0x7a6a3a });
  rig.push({ geometry: new THREE.SphereGeometry(0.075, 12, 8), color: 0xc8a650, position: low });
  // The cart on the track.
  rig.push({ geometry: lathe([[0, 0], [0.46, 0], [0.46, 0.06], [0.38, 0.12], [0.1, 0.16], [0, 0.16]], 24), color: 0x8a7038, position: [0, TOP - CY, 0] });
  carrier.add(mesh(mergeParts(rig), standard({ vertexColors: true, roughness: 0.44, metalness: 0.15 })));

  // A plate carried with it, always facing the same way, saying what the pointer shows.
  const tagPlates = new Plates({ pxPerFoot: 180, width: 900 });
  const tipAt = pt(TIP + 0.26);
  tagPlates.add('Always toward Polaris', [tipAt[0], tipAt[1] + 0.02, tipAt[2]], { h: 0.32, bg: '#fff0c8' });
  carrier.add(tagPlates.mesh());

  // --- The globe. A real coastline and an unlit material, with the day painted on per vertex from
  // the lamp, since the world's own sun is somewhere else altogether. ---
  const earthMap = canvasTexture(2048, 1024, (ctx, w, h) => {
    const mask = landMask(w, h);
    paintTexels(ctx, w, h, (px, py) => earthColor(((px + 0.5) / w) * 360 - 180, 90 - ((py + 0.5) / h) * 180, mask[py * w + px]));
    const yOf = (lat) => ((90 - lat) / 180) * h;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(w, yOf(0)); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,226,120,0.85)';
    ctx.setLineDash([26, 18]);
    for (const lat of [EARTH_TILT_DEG, -EARTH_TILT_DEG, 90 - EARTH_TILT_DEG, EARTH_TILT_DEG - 90]) {
      ctx.beginPath(); ctx.moveTo(0, yOf(lat)); ctx.lineTo(w, yOf(lat)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Kansas, because the card asks about it.
    const kx = ((-98.4 + 180) / 360) * w; const ky = yOf(38.5);
    ctx.fillStyle = '#e8352a';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 16 / Math.cos(38.5 * DEG), 16, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.translate(kx, ky + 46);
    ctx.scale(1 / Math.cos(38.5 * DEG), 1);
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText('Kansas', 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Kansas', 0, 0);
    ctx.restore();
  });
  const sphere = new THREE.SphereGeometry(RG, 112, 72);
  const sp = sphere.attributes.position;
  const colorAttr = new THREE.BufferAttribute(new Float32Array(sp.count * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
  sphere.setAttribute('color', colorAttr);
  const globe = mesh(sphere, new THREE.MeshBasicMaterial({ map: earthMap, vertexColors: true, fog: false }));
  globe.name = 'globe';
  globe.castShadow = false;
  globe.receiveShadow = false;
  carrier.add(globe);
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), A);
  const qSpin = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const inv = new THREE.Quaternion();
  const toLamp = new THREE.Vector3();
  const repaint = () => {
    // The lamp's direction in the globe's own frame, then one dot product per vertex.
    inv.copy(globe.quaternion).invert();
    toLamp.set(-carrier.position.x, CY - carrier.position.y, -carrier.position.z).normalize().applyQuaternion(inv);
    const c = colorAttr.array;
    for (let i = 0, o = 0; i < sp.count; i++, o += 3) {
      const d = (sp.getX(i) * toLamp.x + sp.getY(i) * toLamp.y + sp.getZ(i) * toLamp.z) / RG;
      const day = sstep(d, -0.07, 0.09);
      // Brighter where the light falls straight: the seasons are in this one line.
      const k = day * (0.55 + 0.6 * Math.max(0, d));
      c[o] = 0.1 + k; c[o + 1] = 0.12 + k; c[o + 2] = 0.2 + k * 0.96;
    }
    colorAttr.needsUpdate = true;
  };
  // Where the longitude of Kansas faces at the start: at t = 0 it looks out toward the approach, on
  // the lit side of the globe.
  const SPIN0 = (-98.4 + 150) * DEG * -1 + 0.2;
  const place = (t) => {
    const theta = THETA0 + (t / SEASON_YEAR_SECONDS) * TAU;
    const [x, z] = orbitPoint(theta);
    carrier.position.set(x, CY, z);
    qSpin.setFromAxisAngle(up, SPIN0 + t * SPIN_RATE);
    globe.quaternion.copy(tilt).multiply(qSpin);
  };
  place(0);
  repaint();
  // A globe that has gone round less than this looks the same: the terminator is wider than the step.
  const STEP = 1.6 * DEG;
  if (!reducedMotion()) {
    let t = 0; let since = 0;
    root.userData.tick = {
      update(dt) {
        t += dt;
        place(t);
        since += dt * SPIN_RATE;
        if (since >= STEP) { since = 0; repaint(); }
      },
    };
  }

  root.add(plates.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// 5. The knee
// ---------------------------------------------------------------------------------------------

// Seen from its outer side, front toward +X. A quarter of the joint has been cut away, the front of
// the side nearest you, because the cruciate ligaments live in the notch BETWEEN the condyles and from
// the side a whole knee hides them completely. The far condyle stands whole behind them, the near one
// keeps its back half, and every cut is painted as bone in section.
//
// EVERYTHING TURNS ABOUT ONE CENTRE. Side on, a condyle is a circle about C and the tibial plateau
// sits just outside that circle, so a rotation about C can neither open the joint nor drive one bone
// through the other. That is the only reason this hinge holds together at every angle, and a real
// knee's roll and glide is what it leaves out, which the card says.
export const KNEE = {
  centre: [1.25, 5.2, 0], scale: 1.6,
  condyleR: 0.84, plateauY: -0.9,
  flexMin: 5, flexMax: 60, flexAtStart: 16, period: 9,
};
export const kneeFlexAt = (t) => {
  const mid = (KNEE.flexMin + KNEE.flexMax) / 2; const amp = (KNEE.flexMax - KNEE.flexMin) / 2;
  const phase = Math.asin((KNEE.flexAtStart - mid) / amp);
  return mid + amp * Math.sin((t / KNEE.period) * TAU + phase);
};

function bonePores(seed) {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const r = seededRandom(seed);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = r() * w; const y = r() * h; const rad = 0.8 + r() * r() * 3;
      const v = 186 + r() * 54;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.8},${0.25 + r() * 0.45})`;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.ellipse(x + ox, y + oy, rad, rad * (0.6 + r() * 0.5), r() * 3, 0, TAU);
          ctx.fill();
        }
      }
    }
    // A white corner, for what is not bone.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 18, 18);
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// What is cut shows what is inside: a hard white shell, then sponge, then marrow down a long bone.
function boneTint(envelope, cell, { medulla = null, articular }) {
  const IVORY = lin(0xdccfae); const IVORY2 = lin(0xc6b48c);
  const CORTEX = lin(0xeee6d0); const SPONGE = lin(0xc08a68); const SPONGE2 = lin(0xe0bd96); const MARROW = lin(0xd8a844);
  const CART = lin(0xcfe4f2);
  return (x, y, z, nx, ny, nz, rgb) => {
    const depth = -envelope.d(x, y, z);
    const artic = articular(x, y, z);
    if (depth > cell * 0.8) {
      // A cut face.
      if (depth < 0.07) { rgb[0] = CORTEX[0]; rgb[1] = CORTEX[1]; rgb[2] = CORTEX[2]; if (artic > 0.5) mixInto(rgb, CART, 0.9); return; }
      const n = smoothNoise3(x * 8, y * 8, z * 8);
      rgb[0] = mix(SPONGE[0], SPONGE2[0], n); rgb[1] = mix(SPONGE[1], SPONGE2[1], n); rgb[2] = mix(SPONGE[2], SPONGE2[2], n);
      if (medulla) mixInto(rgb, MARROW, medulla(x, y));
      return;
    }
    const n = smoothNoise3(x * 3.4, y * 3.4, z * 3.4);
    rgb[0] = mix(IVORY2[0], IVORY[0], n); rgb[1] = mix(IVORY2[1], IVORY[1], n); rgb[2] = mix(IVORY2[2], IVORY[2], n);
    mixInto(rgb, CART, artic);
  };
}

// A wedge running round an arc, thick at the rim and thin at the inner edge: a meniscus.
function meniscusArc(cz, y0, a0, a1, rows = 26) {
  const rIn = 0.22; const rOut = 0.46; const SX = 1.55; const H = 0.15;
  const section = [];
  for (let k = 0; k <= 5; k++) { const s = k / 5; section.push([mix(rIn, rOut, s), y0 + 0.012 + H * s ** 1.5]); }
  section.push([rOut + 0.015, y0 + H * 0.55], [rOut, y0], [rIn, y0]);
  const n = section.length;
  const pos = []; const idx = [];
  for (let i = 0; i <= rows; i++) {
    const a = mix(a0, a1, i / rows);
    for (const [r, y] of section) pos.push(Math.cos(a) * r * SX, y, cz + Math.sin(a) * r);
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const p = i * n + j; const q = i * n + j2; const r = (i + 1) * n + j2; const s = (i + 1) * n + j;
      idx.push(p, q, r, p, r, s);
    }
  }
  // Both ends capped, each by a fan from its own centre.
  for (const [row, flip] of [[0, true], [rows, false]]) {
    const a = mix(a0, a1, row / rows);
    const cR = mix(rIn, rOut, 0.65); const cY = y0 + H * 0.3;
    const c = pos.length / 3;
    pos.push(Math.cos(a) * cR * SX, cY, cz + Math.sin(a) * cR);
    for (let j = 0; j < n; j++) {
      const p = row * n + j; const q = row * n + (j + 1) % n;
      if (flip) idx.push(c, q, p); else idx.push(c, p, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// The textbook view of a knee, and it needs no cutting: seen from the front with the joint bent and
// the kneecap folded down out of the way, the two crossed ligaments stand in the notch between the
// condyles with the menisci under them. An earlier version cut a quarter out to look inside, which
// left a bottle-shaped slab with torn edges and hid half of what the card names.
//
// Written with the front of the knee toward +X and the condyles along Z, because the flexion is then
// a plain turn about Z, and the whole thing is turned to face the student at the end.
function kneeJoint() {
  const root = new THREE.Group();
  root.name = 'knee-joint';
  const body = new THREE.Group();
  body.rotation.y = -Math.PI / 2; // local +X, the front of the knee, becomes +Z
  root.add(body);
  const C = new THREE.Vector3(...KNEE.centre);
  const R = KNEE.condyleR; const PY = KNEE.plateauY;
  const K = KNEE.scale; // the bones are written at scale 1, then every coordinate is multiplied
  const CELL = 0.042;
  const TIBIA_END = -3.0;

  // --- The femur, written about the centre of the hinge ---
  const fem = new Sculpt(CELL);
  const BONE = 0xdccfae;
  fem.add(ellipsoidP([0, 0, 0.57], [R, R, 0.43]), BONE);
  fem.add(ellipsoidP([0, 0, -0.57], [R, R, 0.43]), BONE, { k: 0.08 });
  fem.add(ellipsoidP([-0.02, 0.55, 0], [0.58, 0.98, 0.76]), BONE, { k: 0.26 });
  fem.add(ellipsoidP([0.28, 0.25, 0], [0.5, 0.5, 0.62]), BONE, { k: 0.14 });
  fem.add(curveP([[-0.02, 0.6, 0], [0.0, 1.35, 0], [0.04, 2.3, 0]], [0.44, 0.31, 0.27], 14), BONE, { k: 0.3 });
  // The notch the ligaments live in, and the groove the kneecap rides in.
  fem.sub(ellipsoidP([-0.2, -0.46, 0], [0.72, 0.76, 0.27]), null, { k: 0.06 });
  fem.sub(ellipsoidP([0.88, 0.1, 0], [0.12, 0.55, 0.15]), null, { k: 0.08 });
  const femEnvelope = fem.snapshot();
  // Where smooth cartilage covers the bone: all round the end of it, front to back, but not on top.
  const femArticular = (x, y, z) => {
    const rad = Math.hypot(x, y);
    const a = Math.atan2(y, x); // 0 is the front, -pi/2 the bottom
    const onEnd = 1 - sstep(a, 0.72, 0.86) * (1 - sstep(a, 2.36, 2.5));
    const zOut = sstep(Math.abs(z), 0.26, 0.34) + (x > 0.3 ? 1 : 0);
    return clamp01(onEnd * sstep(rad, 0.66, 0.72) * Math.min(1, zOut));
  };
  fem.map((d, x, y, z) => (d > 0.15 || d < -0.15 ? d : d - 0.028 * femArticular(x, y, z)), [-1.2, -1.2, -1.3, 1.3, 1.2, 1.3]);
  fem.sub(boxP([0, 2.65, 0], [1, 0.8, 1]), null, { k: 0.01 }); // the sawn top
  const femGeom = polygonize(fem, { tint: boneTint(femEnvelope, CELL, { medulla: (x, y) => 1 - sstep(Math.abs(x - 0.01), mix(0.02, 0.17, sstep(y, 0.85, 1.25)), mix(0.06, 0.2, sstep(y, 0.85, 1.25))), articular: femArticular }), uvScale: 1.5, extraReach: 0.05 });
  femGeom.scale(K, K, K);
  femGeom.translate(C.x, C.y, C.z);

  // --- The display stand, and the clamp that holds the femur still ---
  const fixed = [{ geometry: femGeom, keepColor: true }];
  const WALNUT = 0x4a3020;
  fixed.push({ geometry: new THREE.BoxGeometry(6.3, 0.17, 5.2), color: WALNUT, position: [0, 0.085, 0] });
  fixed.push({ geometry: new THREE.BoxGeometry(6.0, 0.09, 4.9), color: 0x5b3a24, position: [0, 0.21, 0] });
  const CX = C.x; const CLAMP = C.y + 1.55 * K; const STEM = [CX - 2.2, -2.05];
  const COLLAR = 0.34 * K;
  fixed.push({ geometry: tube([[STEM[0], 0.2, STEM[1]], [STEM[0], 3.0, STEM[1]], [STEM[0], CLAMP - 0.35, STEM[1]], [CX - 1.2, CLAMP, -1.25], [CX - COLLAR * 0.68, CLAMP, -COLLAR * 0.68]], [0.12, 0.11, 0.1, 0.085, 0.08], { sides: 12, steps: 36, round: 1 }), color: 0x6a5a34 });
  fixed.push({ geometry: lathe([[0, 0.22], [0.46, 0.22], [0.46, 0.3], [0.22, 0.38], [0.13, 0.52], [0, 0.52]], 22), color: 0x8a7038, position: [STEM[0], 0, STEM[1]] });
  {
    const ring = new THREE.TorusGeometry(COLLAR, 0.055, 10, 36);
    ring.rotateX(Math.PI / 2);
    ring.translate(CX + 0.03 * K, CLAMP, 0);
    fixed.push({ geometry: ring, color: 0xb08d4e });
  }

  // --- What swings: tibia, fibula, menisci and the folded-down kneecap, under one group turning about C ---
  const tib = new Sculpt(CELL);
  tib.add(ellipsoidP([0, PY - 0.12, 0], [0.84, 0.36, 1.0]), BONE);
  tib.add(ellipsoidP([0, PY - 0.44, 0], [0.62, 0.42, 0.74]), BONE, { k: 0.18 });
  tib.add(curveP([[0, PY - 0.5, 0], [-0.02, PY - 1.05, 0], [-0.05, TIBIA_END - 0.3, 0]], [0.5, 0.28, 0.25], 14), BONE, { k: 0.26 });
  tib.add(ellipsoidP([0.5, PY - 0.72, 0], [0.17, 0.3, 0.2]), BONE, { k: 0.14 }); // the tuberosity
  // Level off the plateau, then the two small peaks between its compartments.
  tib.sub(boxP([0, PY + 0.5, 0], [1.4, 0.5, 1.4]), null, { k: 0.02 });
  tib.add(ellipsoidP([0.02, PY, 0.11], [0.2, 0.085, 0.07]), BONE, { k: 0.05 });
  tib.add(ellipsoidP([-0.1, PY, -0.11], [0.2, 0.075, 0.07]), BONE, { k: 0.05 });
  const tibEnvelope = tib.snapshot();
  const tibArticular = (x, y, z) => {
    if (Math.abs(z) < 0.2) return 0;
    return sstep(y, PY - 0.045, PY - 0.015);
  };
  tib.map((d, x, y, z) => (d > 0.12 || d < -0.12 ? d : d - 0.022 * tibArticular(x, y, z)), [-1.2, PY - 0.2, -1.3, 1.2, PY + 0.2, 1.3]);
  tib.sub(boxP([0, TIBIA_END - 0.8, 0], [1, 0.8, 1]), null, { k: 0.01 });
  const tibGeom = polygonize(tib, { tint: boneTint(tibEnvelope, CELL, { medulla: (x, y) => 1 - sstep(Math.abs(x + 0.03), mix(0.13, 0.02, sstep(y, PY - 1.25, PY - 0.75)), mix(0.16, 0.06, sstep(y, PY - 1.25, PY - 0.75))), articular: tibArticular }), uvScale: 1.5, extraReach: 0.05 });
  const swing = [{ geometry: tibGeom, keepColor: true }];

  // The fibula: slim, on the outer side at the back, its head tucked under the plateau's edge.
  {
    const s = new Sculpt(0.04);
    s.add(ellipsoidP([-0.47, PY - 0.56, 0.66], [0.16, 0.2, 0.16]), BONE);
    s.add(curveP([[-0.47, PY - 0.56, 0.66], [-0.42, PY - 1.05, 0.62], [-0.36, -2.2, 0.54], [-0.33, TIBIA_END + 0.08, 0.5]], [0.12, 0.08, 0.075, 0.09], 16), BONE, { k: 0.1 });
    const env = s.snapshot();
    swing.push({ geometry: polygonize(s, { tint: boneTint(env, 0.04, { articular: () => 0 }), uvScale: 1.5, extraReach: 0.04 }), keepColor: true });
  }
  // The menisci, two pale C shapes opening toward the middle of the joint.
  const PALE = 0xece7d2;
  swing.push({ geometry: meniscusArc(-0.5, PY + 0.002, (118 * Math.PI) / 180, (422 * Math.PI) / 180, 34), color: PALE });
  swing.push({ geometry: meniscusArc(0.5, PY + 0.002, (298 * Math.PI) / 180, (602 * Math.PI) / 180, 34), color: PALE });

  // The kneecap, folded down over the shin on its ligament, as a dissection shows it: its back, the
  // smooth cartilage that normally rides in the femur's groove, now faces the student. Its tip points up.
  const TUB = [0.58, PY - 0.84, 0];
  const PAT = [0.5, -2.46, 0];
  const APEX = [PAT[0] + 0.03, PAT[1] + 0.36, 0];
  {
    const s = new Sculpt(0.032);
    s.add(ellipsoidP(PAT, [0.15, 0.3, 0.34]), BONE);
    s.add(ellipsoidP([PAT[0], PAT[1] + 0.2, 0], [0.12, 0.22, 0.17]), BONE, { k: 0.1 });
    const CART = lin(0xcfe4f2);
    s.add(ellipsoidP([PAT[0] + 0.09, PAT[1] + 0.01, 0], [0.09, 0.25, 0.28]), CART, { k: 0.03, ck: 0.03 });
    const tint = (x, y, z, nx, ny, nz, rgb) => {
      const k = 0.9 + smoothNoise3(x * 6, y * 6, z * 6) * 0.16;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    };
    swing.push({ geometry: polygonize(s, { tint, uvScale: 1.5, extraReach: 0.03 }), keepColor: true });
  }

  const hinge = new THREE.Group();
  hinge.position.copy(C);
  body.add(hinge);
  const boneMat = (seed) => standard({ vertexColors: true, map: bonePores(seed), roughness: 0.56, metalness: 0, bumpMap: grainBump(seed + 1, { dots: 900, min: 1, max: 3, contrast: 0.45 }), bumpScale: 0.3 });
  // Only the bone takes the pores: the stand reads the tile's white corner.
  for (const f of fixed) if (f.color !== undefined) toPatch(f.geometry, 9 / 256, 1 - 9 / 256);
  body.add(mesh(mergeParts(fixed), boneMat(301)));
  const swingGeom = mergeParts(swing);
  swingGeom.scale(K, K, K);
  hinge.add(mesh(swingGeom, boneMat(311)));

  // --- Ligaments, whose two ends belong to different bones, so their shape is rewritten ---
  const flexRot = (p, deg) => {
    const a = -deg * DEG;
    return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]];
  };
  const fixedEnd = (p) => () => p;
  const shinEnd = (p) => (d) => flexRot(p, d);
  const ropes = [
    { // the patellar ligament, from the tuberosity to the kneecap's tip
      a: shinEnd(TUB), b: shinEnd(APEX), bow: [0.07, 0, 0], w: 0.05, b0: 0.17, c0: 0xd8cca8, c1: 0xe6dcc0,
    },
    { // the anterior cruciate, coloured so the two can be told apart: outer wall of the notch, down to the front of the plateau
      a: fixedEnd([-0.2, -0.14, 0.25]), b: shinEnd([0.24, PY + 0.03, -0.11]), bow: [0, 0, 0], w: 0.055, b0: 0.06, c0: 0xc8583c, c1: 0xdc7050,
    },
    { // the posterior cruciate: inner wall of the notch, down to the back of the plateau
      a: fixedEnd([0.02, -0.14, -0.25]), b: shinEnd([-0.34, PY + 0.03, 0.11]), bow: [0, 0, 0], w: 0.055, b0: 0.06, c0: 0x2f7d9c, c1: 0x4a9ab8,
    },
    { // the outer collateral, from the condyle down to the head of the fibula
      a: fixedEnd([-0.1, -0.14, 0.97]), b: shinEnd([-0.47, PY - 0.46, 0.8]), bow: [0, 0, 0.07], w: 0.05, b0: 0.05, c0: 0xdcd0a8, c1: 0xe8dec0,
    },
    { // the inner collateral, a broad flat strap down to the tibia
      a: fixedEnd([-0.05, -0.1, -0.97]), b: shinEnd([0.02, PY - 0.72, -0.68]), bow: [0, 0, -0.07], w: 0.15, b0: 0.035, c0: 0xdcd0a8, c1: 0xe8dec0,
    },
  ];
  const RINGS = 13; const SIDES = 10;
  const vertsPer = RINGS * SIDES;
  const count = vertsPer * ropes.length;
  const rp = new Float32Array(count * 3); const rn = new Float32Array(count * 3); const rc = new Float32Array(count * 3);
  const rIdx = [];
  ropes.forEach((rope, q) => {
    const base = q * vertsPer;
    const c0 = lin(rope.c0); const c1 = lin(rope.c1);
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SIDES; j++) {
        const k = base + i * SIDES + j;
        const st = 0.92 + 0.14 * Math.sin((j / SIDES) * TAU * 3 + i * 0.6);
        const t = i / (RINGS - 1);
        rc[k * 3] = mix(c0[0], c1[0], t) * st; rc[k * 3 + 1] = mix(c0[1], c1[1], t) * st; rc[k * 3 + 2] = mix(c0[2], c1[2], t) * st;
        if (i < RINGS - 1) {
          const j2 = (j + 1) % SIDES;
          const p = base + i * SIDES + j; const r = base + i * SIDES + j2; const s = base + (i + 1) * SIDES + j2; const u = base + (i + 1) * SIDES + j;
          rIdx.push(p, r, s, p, s, u);
        }
      }
    }
    // Each end of a rope is buried in bone. It still closes, on a fan to one of its own ring's verts.
    for (let j = 1; j < SIDES - 1; j++) {
      rIdx.push(base, base + j + 1, base + j);
      const e = base + (RINGS - 1) * SIDES;
      rIdx.push(e, e + j, e + j + 1);
    }
  });
  const ropeG = new THREE.BufferGeometry();
  ropeG.setAttribute('position', new THREE.BufferAttribute(rp, 3).setUsage(THREE.DynamicDrawUsage));
  ropeG.setAttribute('normal', new THREE.BufferAttribute(rn, 3).setUsage(THREE.DynamicDrawUsage));
  ropeG.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  ropeG.setIndex(rIdx);
  ropeG.boundingSphere = new THREE.Sphere(C.clone(), 6.5);
  ropeG.boundingBox = new THREE.Box3(new THREE.Vector3(C.x - 3, C.y - 3.5, -1.8), new THREE.Vector3(C.x + 1.8, C.y + 1, 1.8));
  const T = new THREE.Vector3(); const N = new THREE.Vector3(); const B = new THREE.Vector3(); const Pt = new THREE.Vector3();
  const setRopes = (deg) => {
    const P = ropeG.attributes.position.array; const Nr = ropeG.attributes.normal.array;
    ropes.forEach((rope, q) => {
      const a = rope.a(deg); const b = rope.b(deg);
      const mid = [(a[0] + b[0]) / 2 + rope.bow[0], (a[1] + b[1]) / 2 + rope.bow[1], (a[2] + b[2]) / 2 + rope.bow[2]];
      let o = q * vertsPer * 3;
      for (let i = 0; i < RINGS; i++) {
        const t = i / (RINGS - 1);
        const u = 1 - t;
        Pt.set(u * u * a[0] + 2 * u * t * mid[0] + t * t * b[0], u * u * a[1] + 2 * u * t * mid[1] + t * t * b[1], u * u * a[2] + 2 * u * t * mid[2] + t * t * b[2]);
        T.set(2 * u * (mid[0] - a[0]) + 2 * t * (b[0] - mid[0]), 2 * u * (mid[1] - a[1]) + 2 * t * (b[1] - mid[1]), 2 * u * (mid[2] - a[2]) + 2 * t * (b[2] - mid[2])).normalize();
        N.set(-T.y, T.x, 0).normalize();
        B.crossVectors(T, N).normalize();
        // Narrow in the middle and spreading where it grips the bone, which is what a ligament does.
        const flare = 1 + 0.45 * (2 * t - 1) ** 2;
        for (let j = 0; j < SIDES; j++) {
          const ang = (j / SIDES) * TAU;
          const ca = Math.cos(ang); const sa = Math.sin(ang);
          P[o] = C.x + K * (Pt.x + N.x * ca * rope.w + B.x * sa * rope.b0 * flare);
          P[o + 1] = C.y + K * (Pt.y + N.y * ca * rope.w + B.y * sa * rope.b0 * flare);
          P[o + 2] = C.z + K * (Pt.z + N.z * ca * rope.w + B.z * sa * rope.b0 * flare);
          const nx = N.x * ca / rope.w + B.x * sa / (rope.b0 * flare);
          const ny = N.y * ca / rope.w + B.y * sa / (rope.b0 * flare);
          const nz = N.z * ca / rope.w + B.z * sa / (rope.b0 * flare);
          const nl = Math.hypot(nx, ny, nz) || 1;
          Nr[o] = nx / nl; Nr[o + 1] = ny / nl; Nr[o + 2] = nz / nl;
          o += 3;
        }
      }
    });
    ropeG.attributes.position.needsUpdate = true;
    ropeG.attributes.normal.needsUpdate = true;
  };
  body.add(mesh(ropeG, standard({ vertexColors: true, roughness: 0.46, metalness: 0 })));

  const pose = (deg) => {
    hinge.rotation.z = -deg * DEG;
    setRopes(deg);
  };
  pose(kneeFlexAt(0));
  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; pose(kneeFlexAt(t)); } };
  }

  // --- Labels. The femur's stay put; the shin's swing with it, leaning back so they stand upright at
  // the middle of the bend. All of them face the student, so a plate's yaw undoes the body's turn. ---
  const arrowLabel = (lines) => (ctx, w, h) => {
    ctx.fillStyle = '#f5f0e0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d2830';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lh = (h * 0.72) / lines.length;
    lines.forEach((text, i) => {
      let size = lh * 0.8;
      ctx.font = `700 ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      if (tw > w - 12) { size *= (w - 12) / tw; ctx.font = `700 ${size}px ${FONT}`; }
      ctx.fillText(text, w / 2, lh * (i + 0.5));
    });
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.96);
    ctx.lineTo(w / 2 - h * 0.11, h * 0.76);
    ctx.lineTo(w / 2 + h * 0.11, h * 0.76);
    ctx.fill();
  };
  const FACE = Math.PI / 2;
  const W = (x, y, z) => [C.x + K * x, C.y + K * y, C.z + K * z];
  // In the student's terms: X to their right, Y up, Z toward them.
  const S = (X, Y, Z) => [Z, Y, -X];
  const still = new Plates({ pxPerFoot: 230, width: 900 });
  still.add('FEMUR', W(0.6, 1.1, 0), { h: 0.3, w: 0.95, yaw: FACE });
  still.add('cruciate', W(0.9, 0.17, 0), { w: 1.2, h: 0.62, yaw: FACE, draw: arrowLabel(['CRUCIATE', 'LIGAMENTS']) });
  const LY = C.y + 0.1;
  still.add('CARTILAGE', S(-2.65, LY - 0.45, 2.45), { h: 0.28, w: 1.3, yaw: FACE });
  still.add('COLLATERAL LIGAMENT', S(-3.0, LY + 0.25, 1.1), { h: 0.28, w: 2.15, yaw: FACE });
  const leader = (a, b) => {
    const g = mergeParts([{ geometry: tube([a, b], 0.014, { sides: 6, steps: 1, round: 1, straight: true }), color: 0x2c2620 }]);
    g.deleteAttribute('color');
    toPatch(g, 0.998, 0.002);
    return g;
  };
  const stillMesh = still.mesh();
  stillMesh.geometry = mergeGeometries([
    stillMesh.geometry,
    leader(S(-2.0, LY - 0.45, 2.45), W(0.72, -0.3, 0.72)),
    leader(S(-1.95, LY + 0.25, 1.1), W(-0.08, -0.14, 1.0)),
  ], false);
  body.add(stillMesh);

  const UPRIGHT = ((KNEE.flexMin + KNEE.flexMax) / 2) * DEG;
  const moving = new Plates({ pxPerFoot: 230, width: 900 });
  const L = (x, y, z) => [K * x, K * y, K * z];
  moving.add('TIBIA', L(0.2, -1.95, -0.85), { h: 0.3, w: 0.9, yaw: FACE, tilt: UPRIGHT });
  moving.add('FIBULA', L(-0.25, -2.25, 1.25), { h: 0.28, w: 0.95, yaw: FACE, tilt: UPRIGHT });
  moving.add('MENISCUS', L(0.3, PY - 0.42, -1.55), { h: 0.28, w: 1.2, yaw: FACE, tilt: UPRIGHT });
  moving.add('PATELLA, FOLDED DOWN', L(0.72, -2.86, 0), { h: 0.26, w: 2.1, yaw: FACE, tilt: UPRIGHT });
  const movingMesh = moving.mesh();
  movingMesh.geometry = mergeGeometries([
    movingMesh.geometry,
    leader(L(0.3, PY - 0.42, -1.2), L(0.42, PY + 0.06, -0.78)),
    leader(L(0.2, -1.95, -0.57), L(0.1, -1.95, -0.27)),
    leader(L(-0.25, -2.25, 0.96), L(-0.36, -2.25, 0.6)),
  ], false);
  hinge.add(movingMesh);
  return root;
}

export const BUILDERS = {
  'frog-life-cycle': () => frogLifeCycle(),
  'pond-ecosystem': () => pondEcosystem(),
  'hydroelectric-dam': () => hydroelectricDam(),
  'seasons-orbit': () => seasonsOrbit(),
  'knee-joint': () => kneeJoint(),
};
