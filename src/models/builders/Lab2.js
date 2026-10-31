import * as THREE from 'three';
import { standard, mesh, group, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, extrudeOutline } from '../../props/LoftKit.js';
import { tube, lin, mix, clamp01, sstep, tintVertices, flipped } from '../ModelKit.js';

// The Model Database's second bench of Chemistry & Physics models: lab glassware, a simple circuit,
// a bar magnet's field, a glass prism and a block and tackle. Every one of them is something a
// teacher asks a student to READ, COUNT or TRACE, so the things read are worked out in code from the
// physics rather than drawn: graduations from the vessel's own volume, needles from the field, the
// fan from Snell's law, the rope from its tangent points. LAB2_LAYOUTS at the bottom exports that
// arithmetic so it can be checked without looking.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1.
//
// ONE TRICK RECURS, AND IT IS WORTH KNOWING BEFORE READING ANY OF THIS. A transparent mesh is only
// allowed to be one mesh, so a flame or a meniscus cannot be see-through. But a surface drawn with
// only its BACK faces shows only the half of itself that is on the far side, from any bearing: the
// near half of a flame's outer mantle is simply not there, so the inner cone is visible through it,
// and the near half of a meniscus's wall is not there, so its true curve shows. All of it is opaque.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------------------------------------------------------------------------
// Private solids
// ---------------------------------------------------------------------------

// A surface of revolution about +Y from a BOTTOM-UP `[radius, y, flags]` profile. Flag 'c' doubles
// the row, which gives a crisp crease. `warp(angle, radius, y)` may move a row's radius by bearing
// (a beaker's spout). Bearing 0 is +Z and bearing 90 degrees is +X.
function lathe(profile, { segments = 48, warp = null } = {}) {
  const rows = [];
  for (const [r, y, flags = ''] of profile) {
    rows.push({ r, y });
    if (flags.includes('c')) rows.push({ r, y });
  }
  const positions = [];
  const uvs = [];
  const indices = [];
  let run = 0;
  rows.forEach((row, i) => {
    if (i) run += Math.hypot(row.r - rows[i - 1].r, row.y - rows[i - 1].y);
    for (let c = 0; c < segments; c++) {
      const a = (c / segments) * Math.PI * 2;
      const r = warp ? warp(a, row.r, row.y) : row.r;
      positions.push(Math.sin(a) * r, row.y, Math.cos(a) * r);
      uvs.push(c / segments, run);
    }
  });
  for (let i = 0; i < rows.length - 1; i++) {
    for (let c = 0; c < segments; c++) {
      const c2 = (c + 1) % segments;
      const p = i * segments + c;
      const t = i * segments + c2;
      const s = (i + 1) * segments + c2;
      const q = (i + 1) * segments + c;
      indices.push(p, t, s, p, s, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// The closed section of a ring, as a lathe profile: a rim, a washer, a wire.
function ringProfile(rc, yc, s, n = 8, squash = 1) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    out.push([rc + Math.cos(t) * s, yc + Math.sin(t) * s * squash]);
  }
  return out;
}

// A geometry authored along +Y, carried to `at` with its +Y pointing along `dir`.
function aimed(geometry, at, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const m = new THREE.Matrix4().compose(V(at[0] ?? at.x, at[1] ?? at.y, at[2] ?? at.z), q, V(1, 1, 1));
  geometry.applyMatrix4(m);
  return geometry;
}

function rod(a, b, radius, { sides = 10, radiusB = null, open = false } = {}) {
  const from = a.isVector3 ? a : V(...a);
  const to = b.isVector3 ? b : V(...b);
  const axis = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radiusB ?? radius, radius, axis.length(), sides, 1, open);
  g.translate(0, axis.length() / 2, 0);
  return aimed(g, from, axis);
}

function ball(radius, at, { detail = 14, squash = [1, 1, 1] } = {}) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.round(detail * 0.66)));
  g.scale(squash[0], squash[1], squash[2]);
  g.translate(at[0], at[1], at[2]);
  return g;
}

function box(w, h, d, at) {
  return new THREE.BoxGeometry(w, h, d).translate(at[0], at[1], at[2]);
}

// A rectangle in the XY plane facing +Z with its UVs set to one region of an atlas.
function atlasPlane(w, h, at, rect) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, mix(rect.u0, rect.u1, uv.getX(i)), mix(rect.v0, rect.v1, uv.getY(i)));
  }
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A patch lying on a surface of revolution, a hair proud of it, carrying one region of an atlas. A
// label on a cone or a cylinder has to ask the surface where it is. The back sheet faces inward so
// the patch still reads as enamel from the far side of a glass.
function revPatch(rOf, y0, y1, a0, a1, rect, { lift = 0.005, nu = 18, nv = 10, back = null } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const sheet = (radius, uvOf, flip) => {
    const start = positions.length / 3;
    for (let j = 0; j <= nv; j++) {
      const y = mix(y0, y1, j / nv);
      for (let i = 0; i <= nu; i++) {
        const a = mix(a0, a1, i / nu);
        const r = radius(y);
        positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
        uvs.push(...uvOf(i / nu, j / nv));
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const p = start + j * row + i;
        const q = p + 1;
        const s = p + row + 1;
        const t = p + row;
        if (flip) indices.push(p, s, q, p, t, s);
        else indices.push(p, q, s, p, s, t);
      }
    }
  };
  sheet((y) => rOf(y) + lift, (s, t) => [mix(rect.u0, rect.u1, s), mix(rect.v0, rect.v1, t)], false);
  if (back) sheet((y) => rOf(y) + lift * 0.4, () => back, true);
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// Hands out rectangles in a square atlas, in pixels and in UVs.
function atlasRegion(px0, py0, w, h, size) {
  return {
    x: px0, y: py0, w, h,
    u0: px0 / size, u1: (px0 + w) / size, v0: 1 - (py0 + h) / size, v1: 1 - py0 / size,
  };
}

// Largest size at which `text` fits `maxWidth`. Every sign in this project that guessed its type
// size has run off its own edge at least once.
function fitFont(ctx, text, maxWidth, startPx, build) {
  let px = startPx;
  ctx.font = build(px);
  while (px > 8 && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = build(px);
  }
  return px;
}

// A squared timber, authored along Z: 4 or 8 sides, each face flat, end grain darker than the
// faces, with the grain map running along the length.
function beamGeo(len, w, h, { chamfer = 0, tile = [1, 2], color, rng = null, capShade = 0.62, jitter = 0.07 }) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const outline = c > 0
    ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
    : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const u0 = rng ? rng() : 0;
  const v0 = rng ? rng() : 0;
  const k = rng ? 1 + (rng() - 0.5) * jitter * 2 : 1;
  const base = new THREE.Color(color);
  const side = [base.r * k, base.g * k, base.b * k];
  const cap = [side[0] * capShade, side[1] * capShade, side[2] * capShade];
  const pos = [];
  const nor = [];
  const uvs = [];
  const col = [];
  const tri = (a, b, cc, n, tone, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
    for (let i = 0; i < 3; i++) col.push(...tone);
  };
  const z0 = -len / 2;
  const z1 = len / 2;
  let run = u0 * tile[0];
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = [(by - ay) / seg, -(bx - ax) / seg, 0];
    const ua = run / tile[0];
    const ub = (run + seg) / tile[0];
    const va = v0 + z0 / tile[1];
    const vb = v0 + z1 / tile[1];
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1], n, side, [ua, va], [ub, va], [ub, vb]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1], n, side, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  for (let i = 1; i < outline.length - 1; i++) {
    const [ax, ay] = outline[0];
    const [bx, by] = outline[i];
    const [cx, cy] = outline[i + 1];
    const uv = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
    tri([ax, ay, z1], [bx, by, z1], [cx, cy, z1], [0, 0, 1], cap, uv(ax, ay), uv(bx, by), uv(cx, cy));
    tri([ax, ay, z0], [cx, cy, z0], [bx, by, z0], [0, 0, -1], cap, uv(ax, ay), uv(cx, cy), uv(bx, by));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// Carries a Z-authored geometry to lie from a to b, its local +Y as close to `up` as allowed.
function fromTo(geometry, a, b, up = null) {
  const A = V(...a);
  const B = V(...b);
  const z = B.clone().sub(A).normalize();
  let ref = up ? V(...up).normalize() : UP.clone();
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? UP.clone() : V(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return geometry.applyMatrix4(m);
}

function timber(list, color, a, b, w, h, opts = {}) {
  const len = V(...a).distanceTo(V(...b));
  if (len < 1e-4) return;
  const g = beamGeo(len, w, h, { color, ...opts });
  list.push({ geometry: fromTo(g, a, b, opts.up), keepColor: true });
}

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour,
// so one canvas serves every wood in a model. A texel of 150 is 30% of the colour in linear, not
// 59%, so nothing here goes much below 165.
function grainMaps({ seed = 3, knots = 3, strength = 0.5, width = 256, height = 512, streaks = 150 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(0, 0, width, height);
  const wrapX = (draw) => { for (const dx of [-width, 0, width]) draw(dx); };
  for (let i = 0; i < 26; i++) {
    const x = rng() * width;
    const w = 6 + rng() * 34;
    const shade = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${shade},${shade - 8},${shade - 18},0.42)`;
    wrapX((dx) => ctx.fillRect(x + dx, 0, w, height));
  }
  for (let i = 0; i < streaks; i++) {
    const x = rng() * width;
    const amp = 1 + rng() * 5;
    const cycles = 1 + Math.floor(rng() * 3);
    const phase = rng() * Math.PI * 2;
    const dark = 150 + Math.round(rng() * 70);
    ctx.strokeStyle = `rgba(${dark},${dark - 14},${dark - 30},${0.25 + rng() * 0.5})`;
    ctx.lineWidth = 0.6 + rng() * 1.5;
    wrapX((dx) => {
      ctx.beginPath();
      for (let y = 0; y <= height; y += 16) {
        const px = x + dx + Math.sin((y / height) * Math.PI * 2 * cycles + phase) * amp;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    });
  }
  for (let i = 0; i < knots; i++) {
    const x = 40 + rng() * (width - 80);
    const y = 50 + rng() * (height - 100);
    for (let r = 10; r > 2; r -= 2.4) {
      const dark = 165 + (13 - r) * -2;
      ctx.strokeStyle = `rgba(${dark},${dark - 22},${dark - 44},0.32)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.62, r * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: strength };
}

const solidMesh = (parts, params = {}) => mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.08, ...params }));

function glassMesh(parts, params = {}) {
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, transparent: true, opacity: 0.3, roughness: 0.07, metalness: 0, depthWrite: false, ...params,
  }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function unlitMesh(parts, params = {}) {
  const m = mesh(mergeParts(parts), new THREE.MeshBasicMaterial({ vertexColors: true, ...params }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// A linear colour from an sRGB hex, darkened or lightened, for a tint that has to return numbers.
const shade = (hex, k) => { const c = lin(hex); return [c[0] * k, c[1] * k, c[2] * k]; };

// ---------------------------------------------------------------------------
// Lab glassware
// ---------------------------------------------------------------------------

// All at three times life size: a 1 litre beaker, an Erlenmeyer flask holding about 465 mL to the
// brim (marked to 400), a 500 mL graduated cylinder and 150 mm test tubes. So a volume in the model is 27 times the real one, and every
// graduation is placed from the vessel's own inner profile rather than spaced by eye.
const GLASSWARE_SCALE = 3;
const CUBIC_FEET_TO_ML = 28316.85;
const realMl = (cubicFeet) => (cubicFeet * CUBIC_FEET_TO_ML) / GLASSWARE_SCALE ** 3;

// Volume held below height y, from an inner profile of [radius, y] running up from the floor.
function volumeBelow(inner, y) {
  let v = 0;
  for (let i = 0; i < inner.length - 1; i++) {
    const [r0, y0] = inner[i];
    const [r1, y1] = inner[i + 1];
    if (y <= y0) break;
    const top = Math.min(y, y1);
    const t = (top - y0) / (y1 - y0 || 1);
    const rt = mix(r0, r1, t);
    v += (Math.PI * (top - y0) * (r0 * r0 + r0 * rt + rt * rt)) / 3;
  }
  return v;
}

// The height at which a vessel holds `ml`, in real millilitres, by bisection.
function levelFor(inner, ml) {
  let lo = inner[0][1];
  let hi = inner[inner.length - 1][1];
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (realMl(volumeBelow(inner, m)) < ml) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

const radiusAt = (profile, y) => {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if (y <= y1) return mix(r0, r1, clamp01((y - y0) / (y1 - y0 || 1)));
  }
  return profile[profile.length - 1][0];
};

const GLASS = 0xcfe9ee;
const GLASS_EDGE = 0xd9f1f4;
const IRON = 0x34383e;
const BRASS = 0xc39a45;
const INK = '#16243c';

const BEAKER_LITRE = { R: 0.515, r: 0.492, H: 1.46, floor: 0.04, lip: 0.022 };
const BEAKER_SMALL = { R: 0.345, r: 0.33, H: 0.94, floor: 0.03, lip: 0.018 };
const beakerInner = (b) => [[b.r, b.floor], [b.r, b.H]];

const FLASK = {
  outer: [[0.52, 0.04], [0.15 + 0.022, 1.16], [0.142 + 0.022, 1.3], [0.142 + 0.022, 1.72]],
  inner: [[0.5, 0.04], [0.15, 1.16], [0.142, 1.3], [0.142, 1.72]],
  H: 1.76,
};

const CYLINDER = {
  R: 0.262, r: 0.246, foot: 0.11, floor: 0.17, H: 3.0, fill: 350, meniscus: 0.1,
};
const cylinderInner = () => [[CYLINDER.r, CYLINDER.floor], [CYLINDER.r, CYLINDER.H]];

// A spout pulls the top of the wall out at one bearing. Every row of the vessel goes through it, so
// the inner wall, the outer wall and the rim stay one lip.
function spoutWarp(bearing, H, { depth = 0.22, reach = 0.085, width = 0.34 } = {}) {
  return (a, r, y) => {
    if (r < 1e-4) return r;
    let d = a - bearing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const lift = sstep(y, H - depth, H);
    return r + reach * lift * lift * Math.exp(-((d / width) ** 2));
  };
}

function beakerProfile({ R, r, H, floor, lip }) {
  return [
    [0, 0], [R - 0.034, 0], [R - 0.01, 0.01], [R, 0.04], [R, H * 0.5], [R, H - 0.07],
    [R + lip * 0.45, H - 0.024], [R + lip, H - 0.004], [R + lip * 0.62, H + 0.009], [r + 0.003, H + 0.004],
    [r, H - 0.03], [r, H * 0.5], [r, floor + 0.03], [r - 0.03, floor], [0, floor],
  ];
}

// Liquid fills a vessel up to `surface`, with the top dished toward the wall. It stops a whisker
// inside the glass so the two never fight.
function liquidBody(inner, surface, menisc, color, { gap = 0.006, top = null } = {}) {
  const floor = inner[0][1];
  const rWall = (y) => radiusAt(inner, y) - gap;
  const rows = [[0, floor + 0.002], [rWall(floor) - 0.03, floor + 0.002], [rWall(floor + 0.03), floor + 0.03]];
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const y = mix(floor + 0.03, surface + menisc, i / steps);
    rows.push([rWall(y), y]);
  }
  rows[rows.length - 1].push('c');
  const rimR = rWall(surface + menisc);
  for (let i = 1; i <= 6; i++) {
    const t = 1 - i / 6;
    rows.push([rimR * t, surface + menisc * t ** 4]);
  }
  const g = lathe(rows, { segments: 44 });
  const base = lin(color);
  const pale = top ?? [mix(base[0], 1, 0.42), mix(base[1], 1, 0.42), mix(base[2], 1, 0.42)];
  tintVertices(g, (x, y, z, out) => {
    // Depth is what makes a coloured liquid: a little darker toward the floor.
    const d = clamp01((surface - y) / (surface - floor + 0.001));
    const k = 1.06 - d * 0.32;
    if (y >= surface + menisc * 0.002 && Math.hypot(x, z) < rimR - 0.002) { out[0] = pale[0]; out[1] = pale[1]; out[2] = pale[2]; } else {
      out[0] = base[0] * k; out[1] = base[1] * k; out[2] = base[2] * k;
    }
  });
  return g;
}

// A graduated scale painted on one region of the atlas. `marks` is [{ y, label, kind }], with y in
// feet, and the region covers y0..y1 of the vessel.
function paintScale(ctx, region, y0, y1, marks, { title = null, foot = null, numberPx = 34, major = 0.46, mid = 0.3, minor = 0.17, tickColor = INK } = {}) {
  const { x, y, w, h } = region;
  ctx.fillStyle = '#f7f6f0';
  ctx.fillRect(x, y, w, h);
  const rowOf = (fy) => y + h - ((fy - y0) / (y1 - y0)) * h;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const m of marks) {
    const py = rowOf(m.y);
    const len = (m.kind === 'major' ? major : m.kind === 'mid' ? mid : minor) * w;
    ctx.fillStyle = tickColor;
    const thick = m.kind === 'major' ? 5 : m.kind === 'mid' ? 4 : 3;
    ctx.fillRect(x + 8, py - thick / 2, len, thick);
    if (m.label) {
      ctx.font = `bold ${numberPx}px Arial, Helvetica, sans-serif`;
      ctx.fillText(m.label, x + 14 + len, py + 1);
    }
  }
  ctx.textAlign = 'center';
  if (title) {
    const px = fitFont(ctx, title, w - 14, Math.round(numberPx * 0.86), (s) => `bold ${s}px Arial, Helvetica, sans-serif`);
    ctx.fillStyle = tickColor;
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    ctx.fillText(title, x + w / 2, y + px * 0.8);
  }
  if (foot) {
    const px = fitFont(ctx, foot, w - 14, Math.round(numberPx * 0.62), (s) => `${s}px Arial, Helvetica, sans-serif`);
    ctx.fillStyle = tickColor;
    ctx.font = `${px}px Arial, Helvetica, sans-serif`;
    ctx.fillText(foot, x + w / 2, y + h - px * 0.8);
  }
}

// The marks for a vessel, each placed by asking its profile how high that volume stands.
function scaleMarks(inner, { max, minor, mid = 0, major }) {
  const marks = [];
  for (let ml = minor; ml <= max + 1e-6; ml += minor) {
    const isMajor = ml % major === 0;
    const isMid = !isMajor && mid && ml % mid === 0;
    marks.push({ ml, y: levelFor(inner, ml), kind: isMajor ? 'major' : isMid ? 'mid' : 'minor', label: isMajor ? String(ml) : null });
  }
  return marks;
}

function glasswareLayout() {
  const beaker = beakerInner(BEAKER_LITRE);
  const small = beakerInner(BEAKER_SMALL);
  const flask = FLASK.inner;
  const cylinder = cylinderInner();
  const cylinderMarks = scaleMarks(cylinder, { max: 500, minor: 10, mid: 50, major: 100 });
  const sag = levelFor(cylinder, CYLINDER.fill);
  return {
    beaker: { marks: scaleMarks(beaker, { max: 1000, minor: 100, major: 200 }), fill: 600, surface: levelFor(beaker, 600), brim: realMl(volumeBelow(beaker, BEAKER_LITRE.H)) },
    small: { marks: scaleMarks(small, { max: 200, minor: 50, major: 100 }), fill: 150, surface: levelFor(small, 150) },
    flask: { marks: scaleMarks(flask, { max: 400, minor: 100, major: 100 }), fill: 250, surface: levelFor(flask, 250), brim: realMl(volumeBelow(flask, 1.72)) },
    cylinder: { marks: cylinderMarks, fill: CYLINDER.fill, sag, rim: sag + CYLINDER.meniscus, brim: realMl(volumeBelow(cylinder, CYLINDER.H)) },
  };
}

function labGlassware() {
  const layout = glasswareLayout();
  const T = 2.7; // the bench top
  const wood = [];
  const solid = [];
  const printed = [];
  const glass = [];
  const flameCore = [];
  const flameMantle = [];
  const POSITION = {
    rack: [-2.84, -0.15], flask: [-1.32, 0.28], beaker: [-0.03, 0.34], cylinder: [1.0, -0.02], burner: [2.62, 0.04], tap: [3.5, -1.14],
  };

  // --- The atlas: every printed scale, and the bench's name plates.
  const ATLAS = 1024;
  const PPF = 370;
  const white = [8 / ATLAS, 1 - 8 / ATLAS];
  const cylArc = 1.12;
  const cylRegion = atlasRegion(20, 8, Math.round(CYLINDER.R * cylArc * PPF), 1008, ATLAS);
  const cylY0 = CYLINDER.floor - 0.06;
  const cylY1 = cylY0 + 1008 / PPF;
  const beakerArc = 1.0;
  const beakerRegion = atlasRegion(170, 8, Math.round(BEAKER_LITRE.R * beakerArc * PPF), 520, ATLAS);
  const beakerY0 = BEAKER_LITRE.floor + 0.04;
  const beakerY1 = beakerY0 + 520 / PPF;
  const flaskRegion = atlasRegion(380, 8, 170, 380, ATLAS);
  const flaskY0 = 0.09;
  const flaskY1 = flaskY0 + 380 / PPF;
  const smallRegion = atlasRegion(570, 8, 120, 260, ATLAS);
  const smallY0 = BEAKER_SMALL.floor + 0.03;
  const smallY1 = smallY0 + 260 / PPF;
  const NAMES = [
    ['Test tubes', POSITION.rack[0], 1.1],
    ['Erlenmeyer flask', POSITION.flask[0] - 0.05, 1.36],
    ['Beaker', POSITION.beaker[0] - 0.18, 0.66],
    ['Graduated cylinder', POSITION.cylinder[0] + 0.1, 1.5],
    ['Bunsen burner', POSITION.burner[0] + 0.12, 1.2],
  ];
  const nameRegions = NAMES.map((_, i) => atlasRegion(170, 560 + i * 92, 560, 84, ATLAS));

  const atlas = canvasTexture(ATLAS, ATLAS, (ctx, W, H) => {
    ctx.fillStyle = '#f7f6f0';
    ctx.fillRect(0, 0, W, H);
    paintScale(ctx, cylRegion, cylY0, cylY1, layout.cylinder.marks, { title: 'mL', numberPx: 32, major: 0.3, mid: 0.2, minor: 0.12, foot: '20 °C' });
    paintScale(ctx, beakerRegion, beakerY0, beakerY1, layout.beaker.marks, { title: 'mL', foot: 'approx.', numberPx: 40 });
    paintScale(ctx, flaskRegion, flaskY0, flaskY1, layout.flask.marks, { title: 'approx. mL', numberPx: 36 });
    paintScale(ctx, smallRegion, smallY0, smallY1, layout.small.marks, { title: 'mL', numberPx: 28, major: 0.34, minor: 0.2 });
    NAMES.forEach(([text], i) => {
      const r = nameRegions[i];
      ctx.fillStyle = '#f1e7c8';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = '#1e1a12';
      const aspect = NAMES[i][2] / 0.26;
      // The plate is narrower than its atlas region, so the type is drawn into the plate's own
      // proportion and only the middle of the region is used.
      const pw = r.h * aspect;
      const px = fitFont(ctx, text, Math.min(pw, r.w) - 22, 54, (s) => `bold ${s}px Georgia, 'Times New Roman', serif`);
      ctx.font = `bold ${px}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, r.x + Math.min(pw, r.w) / 2, r.y + r.h / 2 + 2);
    });
  });

  // --- The bench.
  const rng = seededRandom(4021);
  const TOP = 0xa86f3a;
  const FRAME = 0x7b4c28;
  const topT = 0.17;
  const plankW = 0.6;
  for (let i = 0; i < 5; i++) {
    const z = -1.2 + i * plankW;
    timber(wood, TOP, [-4, T - topT / 2, z], [4, T - topT / 2, z], plankW, topT, { chamfer: 0.012, rng, jitter: 0.12 });
  }
  const legY = T - topT;
  for (const x of [-3.62, 3.62]) {
    for (const z of [-1.2, 1.2]) timber(wood, FRAME, [x, 0, z], [x, legY, z], 0.3, 0.3, { chamfer: 0.02, rng, up: [0, 0, 1] });
    // The end rails and the low stretcher, tenoned between the legs.
    timber(wood, FRAME, [x, legY - 0.17, -1.2], [x, legY - 0.17, 1.2], 0.15, 0.34, { chamfer: 0.012, rng });
    timber(wood, FRAME, [x, 0.5, -1.2], [x, 0.5, 1.2], 0.15, 0.22, { chamfer: 0.012, rng });
  }
  const railY = legY - 0.19;
  for (const z of [-1.24, 1.24]) {
    timber(wood, FRAME, [-3.62, railY, z], [3.62, railY, z], 0.14, 0.38, { chamfer: 0.012, rng });
  }
  // A slatted shelf low down, because a bench has somewhere to put things.
  for (let i = 0; i < 6; i++) {
    const z = -1.05 + i * 0.42;
    timber(wood, TOP, [-3.62, 0.66, z], [3.62, 0.66, z], 0.36, 0.08, { chamfer: 0.01, rng, jitter: 0.14 });
  }
  for (const z of [-1.2, 1.2]) timber(wood, FRAME, [-3.62, 0.56, z], [3.62, 0.56, z], 0.14, 0.14, { chamfer: 0.01, rng });

  // Name plates on the front rail, under what they name.
  const plateZ = 1.24 + 0.07;
  NAMES.forEach(([, x, w], i) => {
    const r = nameRegions[i];
    const used = Math.min((r.h * w) / 0.26, r.w) / ATLAS;
    const rect = { u0: r.u0, u1: r.u0 + used, v0: r.v0, v1: r.v1 };
    solid.push({ geometry: box(w + 0.06, 0.32, 0.016, [x, railY, plateZ + 0.006]), color: BRASS });
    printed.push({ geometry: atlasPlane(w, 0.26, [x, railY, plateZ + 0.0155], rect), color: 0xffffff });
    for (const sx of [-1, 1]) solid.push({ geometry: ball(0.012, [x + sx * (w / 2 + 0.014), railY, plateZ + 0.015], { detail: 8 }), color: 0x7f6124 });
  });

  // --- The litre beaker. Spout to the student's right, printed patch to the front.
  const place = (geometry, key, y = T) => geometry.translate(POSITION[key][0], y, POSITION[key][1]);
  const beakerWarp = spoutWarp(Math.PI * 0.5, BEAKER_LITRE.H);
  glass.push({ geometry: place(lathe(beakerProfile(BEAKER_LITRE), { segments: 72, warp: beakerWarp }), 'beaker'), color: GLASS });
  solid.push({ geometry: place(lathe(ringProfile(BEAKER_LITRE.R + BEAKER_LITRE.lip * 0.55, BEAKER_LITRE.H - 0.002, 0.013), { segments: 72, warp: beakerWarp }), 'beaker'), color: GLASS_EDGE });
  solid.push({ geometry: place(lathe(ringProfile(BEAKER_LITRE.R - 0.012, 0.018, 0.016), { segments: 56 }), 'beaker'), color: 0xa9d2d6 });
  solid.push({ geometry: place(liquidBody(beakerInner(BEAKER_LITRE), layout.beaker.surface, 0.03, 0x1967e8), 'beaker'), keepColor: true });
  const halfArc = (beakerRegion.w / PPF / BEAKER_LITRE.R) / 2;
  printed.push({
    geometry: place(revPatch(() => BEAKER_LITRE.R, beakerY0, beakerY1, -halfArc, halfArc, beakerRegion, { back: white }), 'beaker'),
    color: 0xffffff,
  });

  // --- The flask.
  const flaskProfile = [
    [0, 0], [0.47, 0], [0.505, 0.012], [0.52, 0.045], [0.33, 0.6], [0.172, 1.14], [0.166, 1.24], [0.164, 1.34], [0.164, 1.68], [0.188, 1.72], [0.19, 1.745], [0.17, 1.76], [0.146, 1.75],
    [0.142, 1.7], [0.142, 1.3], [0.15, 1.16], [0.32, 0.6], [0.5, 0.05], [0.47, 0.04], [0, 0.04],
  ];
  glass.push({ geometry: place(lathe(flaskProfile, { segments: 64 }), 'flask'), color: GLASS });
  solid.push({ geometry: place(lathe(ringProfile(0.181, 1.742, 0.019), { segments: 40 }), 'flask'), color: GLASS_EDGE });
  solid.push({ geometry: place(lathe(ringProfile(0.5, 0.018, 0.016), { segments: 56 }), 'flask'), color: 0xa9d2d6 });
  solid.push({ geometry: place(liquidBody(FLASK.inner, layout.flask.surface, 0.024, 0x11a84a), 'flask'), keepColor: true });
  const flaskOuter = (y) => radiusAt(FLASK.outer, y);
  const flaskMid = (flaskY0 + flaskY1) / 2;
  const flaskHalf = (flaskRegion.w / PPF / flaskOuter(flaskMid)) / 2;
  printed.push({
    geometry: place(revPatch(flaskOuter, flaskY0, flaskY1, -flaskHalf, flaskHalf, flaskRegion, { back: white, nv: 16 }), 'flask'),
    color: 0xffffff,
  });

  // --- The graduated cylinder, with a hexagonal foot, a pouring lip and a real meniscus.
  const C = CYLINDER;
  const cylWarp = spoutWarp(-Math.PI * 0.72, C.H, { depth: 0.1, reach: 0.05, width: 0.3 });
  const cylProfile = [
    [0, C.foot], [C.R + 0.06, C.foot], [C.R + 0.012, C.foot + 0.03], [C.R, C.foot + 0.07], [C.R, C.H * 0.5], [C.R, C.H - 0.05],
    [C.R + 0.012, C.H - 0.012], [C.R + 0.008, C.H + 0.006], [C.r + 0.002, C.H + 0.004], [C.r, C.H - 0.02], [C.r, C.floor + 0.012], [C.r - 0.012, C.floor], [0, C.floor],
  ];
  glass.push({ geometry: place(lathe(cylProfile, { segments: 64, warp: cylWarp }), 'cylinder'), color: GLASS });
  const hex = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const p = [Math.cos(a) * 0.56, Math.sin(a) * 0.56];
    hex.push(p, [p[0] * 0.9997 + 1e-4, p[1] * 0.9997 + 1e-4]);
  }
  const foot = extrudeOutline(hex, C.foot).rotateX(Math.PI / 2).translate(0, C.foot / 2, 0);
  glass.push({ geometry: place(foot, 'cylinder'), color: GLASS });
  const footEdge = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const b = ((i + 1.5) / 6) * Math.PI * 2;
    for (const y of [C.foot, 0.012]) {
      footEdge.push({ geometry: place(rod([Math.cos(a) * 0.56, y, Math.sin(a) * 0.56], [Math.cos(b) * 0.56, y, Math.sin(b) * 0.56], 0.011, { sides: 6 }), 'cylinder'), color: 0xa9d2d6 });
    }
  }
  solid.push(...footEdge);
  solid.push({ geometry: place(lathe(ringProfile(C.R + 0.006, C.H, 0.012), { segments: 64, warp: cylWarp }), 'cylinder'), color: GLASS_EDGE });

  // The liquid is built in three pieces so the curve shows from every bearing: an opaque column up
  // to the BOTTOM of the meniscus, a wall from there to the top of it that only shows its far half
  // (flipped, so the near half culls), and the dished surface itself, top face only. Looking level,
  // the column and the far wall are one colour, and where the far half of the dish begins is exactly
  // the curve you read a cylinder at, because at any x the lowest point of a dish is at radius |x|.
  const rL = C.r - 0.006;
  const sag = layout.cylinder.sag;
  const rimY = layout.cylinder.rim;
  const LIQ = lin(0xd11f7a);
  const LIQ_DEEP = lin(0x9e1259);
  const column = lathe([
    [0, C.floor + 0.002], [rL - 0.012, C.floor + 0.002], [rL, C.floor + 0.014], [rL, sag * 0.5], [rL, sag, 'c'], [0, sag],
  ], { segments: 48 });
  tintVertices(column, (x, y, z, out) => {
    const t = clamp01((y - C.floor) / (sag - C.floor));
    out[0] = mix(LIQ_DEEP[0], LIQ[0], t); out[1] = mix(LIQ_DEEP[1], LIQ[1], t); out[2] = mix(LIQ_DEEP[2], LIQ[2], t);
  });
  solid.push({ geometry: place(column, 'cylinder'), keepColor: true });
  solid.push({ geometry: place(flipped(lathe([[rL, sag], [rL, rimY]], { segments: 48 })), 'cylinder'), color: 0xd11f7a });
  const dishRows = [];
  for (let i = 0; i <= 14; i++) {
    const t = 1 - i / 14;
    dishRows.push([rL * t, sag + C.meniscus * t ** 2.6]);
  }
  const dish = lathe(dishRows, { segments: 48 });
  solid.push({ geometry: place(dish, 'cylinder'), color: 0xf6c6dc });

  // The printed strip stands off to the left of the front, so the middle of the column is open to
  // read across, and the hundreds run round the front on the glass itself.
  const stripC = -0.74;
  const stripHalf = (cylRegion.w / PPF / C.R) / 2;
  printed.push({
    geometry: place(revPatch(() => C.R, cylY0, cylY1, stripC - stripHalf, stripC + stripHalf, cylRegion, { back: white, nv: 2 }), 'cylinder'),
    color: 0xffffff,
  });
  const ink = 0x16243c;
  for (const m of layout.cylinder.marks) {
    if (m.kind === 'minor') continue;
    const a1 = m.kind === 'major' ? 0.62 : 0.2;
    const thick = m.kind === 'major' ? 0.0085 : 0.0065;
    const band = lathe([[C.R + 0.0025, m.y - thick], [C.R + 0.0045, m.y - thick], [C.R + 0.0045, m.y + thick], [C.R + 0.0025, m.y + thick]], { segments: 64 });
    // Only the part of the circle on the front of the glass, so it reads as a printed line.
    const pos = band.attributes.position;
    const keep = [];
    const idx = band.index;
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i); const b = idx.getX(i + 1); const c = idx.getX(i + 2);
      const bearing = Math.atan2((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3);
      if (bearing > stripC + stripHalf - 0.02 && bearing < a1) keep.push(a, b, c);
    }
    band.setIndex(keep);
    solid.push({ geometry: place(band, 'cylinder'), color: ink });
  }

  // --- The test tube rack: real holes through the top plate, drilled sockets in the bottom one.
  const COLORS = [0xe0201f, 0xf07d12, 0xf2c80c, 0x18b24b, 0x1477e6, 0x8b2fd6];
  const LEVELS = [1.02, 0.92, 1.14, 0.98, 1.24, 0.95];
  const pitch = 0.3;
  const count = COLORS.length;
  const rackHalf = (pitch * count) / 2 + 0.1;
  const tubeR = 0.1;
  const tubeInner = tubeR - 0.011;
  const tubeH = 1.5;
  const rackPlate = (y, thick, holeR) => {
    const shape = new THREE.Shape();
    const hw = rackHalf; const hd = 0.24; const c = 0.03;
    shape.moveTo(-hw + c, -hd); shape.lineTo(hw - c, -hd); shape.lineTo(hw, -hd + c); shape.lineTo(hw, hd - c);
    shape.lineTo(hw - c, hd); shape.lineTo(-hw + c, hd); shape.lineTo(-hw, hd - c); shape.lineTo(-hw, -hd + c); shape.closePath();
    for (let i = 0; i < count; i++) {
      const hole = new THREE.Path();
      hole.absarc((i - (count - 1) / 2) * pitch, 0, holeR, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 18 });
    g.rotateX(-Math.PI / 2);
    g.translate(POSITION.rack[0], T + y, POSITION.rack[1]);
    return g;
  };
  const RACK = 0xb5763a;
  wood.push({ geometry: rackPlate(0.74, 0.08, 0.128), color: RACK });
  wood.push({ geometry: box(rackHalf * 2, 0.09, 0.56, [POSITION.rack[0], T + 0.045, POSITION.rack[1]]), color: RACK });
  for (const sx of [-1, 1]) {
    const x = POSITION.rack[0] + sx * (rackHalf - 0.05);
    timber(wood, 0x9a622f, [x, T + 0.05, POSITION.rack[1]], [x, T + 0.82, POSITION.rack[1]], 0.1, 0.44, { up: [0, 0, 1] });
  }
  for (let i = 0; i < count; i++) {
    const x = POSITION.rack[0] + (i - (count - 1) / 2) * pitch;
    const z = POSITION.rack[1];
    const bottom = 0.1;
    // A dark socket in the base plate for the tube to sit in.
    solid.push({ geometry: lathe([[0, 0], [0.11, 0], [0.11, 0.004], [0, 0.004]], { segments: 22 }).translate(x, T + 0.09, z), color: 0x3a2412 });
    const profile = [[0, bottom]];
    const R = tubeR;
    for (let k = 1; k <= 7; k++) {
      const t = (k / 7) * (Math.PI / 2);
      profile.push([Math.sin(t) * R, bottom + R - Math.cos(t) * R]);
    }
    profile.push([R, bottom + tubeH * 0.5], [R, bottom + tubeH - 0.03], [R + 0.012, bottom + tubeH], [R - 0.004, bottom + tubeH + 0.01], [tubeInner, bottom + tubeH - 0.01], [tubeInner, bottom + tubeH * 0.5], [tubeInner, bottom + R]);
    for (let k = 6; k >= 0; k--) {
      const t = (k / 7) * (Math.PI / 2);
      profile.push([Math.sin(t) * tubeInner, bottom + 0.011 + R - Math.cos(t) * tubeInner - (R - tubeInner)]);
    }
    glass.push({ geometry: lathe(profile, { segments: 24 }).translate(x, T, z), color: GLASS });
    solid.push({ geometry: lathe(ringProfile(R + 0.004, bottom + tubeH + 0.002, 0.009, 6), { segments: 24 }).translate(x, T, z), color: GLASS_EDGE });
    // The liquid, which also has a round bottom.
    const rIn = tubeInner - 0.004;
    const floorY = bottom + 0.018;
    const surface = bottom + LEVELS[i];
    const rows = [[0, floorY]];
    for (let k = 1; k <= 6; k++) {
      const t = (k / 6) * (Math.PI / 2);
      rows.push([Math.sin(t) * rIn, floorY + rIn - Math.cos(t) * rIn]);
    }
    rows.push([rIn, surface * 0.6 + floorY * 0.4], [rIn, surface + 0.02, 'c']);
    for (let k = 1; k <= 4; k++) {
      const t = 1 - k / 4;
      rows.push([rIn * t, surface + 0.02 * t ** 3]);
    }
    const c = lin(COLORS[i]);
    const g = lathe(rows, { segments: 20 });
    tintVertices(g, (lx, ly, lz, out) => {
      const k = 0.72 + 0.34 * clamp01((ly - floorY) / (surface - floorY));
      const lift = Math.hypot(lx, lz) < rIn - 0.002 && ly >= surface ? 0.36 : 0;
      out[0] = mix(c[0] * k, 1, lift); out[1] = mix(c[1] * k, 1, lift); out[2] = mix(c[2] * k, 1, lift);
    });
    solid.push({ geometry: g.translate(x, T, z), keepColor: true });
  }

  // --- The Bunsen burner: cast base, barrel, collar with its air hole, gas inlet, hose.
  const bx = POSITION.burner[0];
  const bz = POSITION.burner[1];
  const b = (g, y = T) => g.translate(bx, y, bz);
  solid.push({
    geometry: b(lathe([
      [0, 0], [0.31, 0, 'c'], [0.31, 0.035, 'c'], [0.285, 0.06], [0.2, 0.1], [0.11, 0.135], [0.085, 0.19, 'c'], [0, 0.19],
    ], { segments: 44 })),
    color: 0x2b2e33,
  });
  const barrelTop = 1.5;
  solid.push({
    geometry: b(lathe([
      [0, 0.15], [0.068, 0.15, 'c'], [0.068, barrelTop - 0.012, 'c'], [0.06, barrelTop, 'c'], [0.05, barrelTop, 'c'], [0.05, barrelTop - 0.08], [0, barrelTop - 0.08],
    ], { segments: 28 })),
    color: 0xc9a24c,
  });
  // The rotating air collar, darker brass, with its two air holes as dark panels in raised frames.
  const collarY0 = 0.34;
  const collarY1 = 0.56;
  solid.push({
    geometry: b(lathe([
      [0.06, collarY0], [0.086, collarY0, 'c'], [0.09, collarY0 + 0.01], [0.09, collarY1 - 0.01], [0.086, collarY1, 'c'], [0.06, collarY1],
    ], { segments: 32 })),
    color: 0xa57f33,
  });
  for (const bearing of [0.5, Math.PI + 0.5]) {
    const hole = revPatch(() => 0.09, collarY0 + 0.05, collarY1 - 0.05, bearing - 0.42, bearing + 0.42, { u0: 0, u1: 0, v0: 0, v1: 0 }, { lift: 0.0015, nu: 8, nv: 2 });
    solid.push({ geometry: b(hole), color: 0x0d0e10 });
  }
  // Inlet: a serrated nozzle at bearing 120 degrees, which the hose is pushed onto.
  const inletA = Math.PI * 0.5;
  const inletDir = V(Math.sin(inletA), 0, Math.cos(inletA));
  const inletAt = V(bx, T + 0.2, bz);
  const nozzleLen = 0.46;
  const nozzleRows = [[0, 0], [0.04, 0, 'c']];
  const ridges = 4;
  for (let i = 0; i < ridges; i++) {
    const s = 0.2 + (i / ridges) * (nozzleLen - 0.2);
    const s2 = s + (nozzleLen - 0.2) / ridges;
    nozzleRows.push([0.04, s, 'c'], [0.052, s + 0.008, 'c'], [0.036, s2 - 0.004, 'c']);
  }
  nozzleRows.push([0.032, nozzleLen, 'c'], [0, nozzleLen]);
  solid.push({ geometry: aimed(lathe(nozzleRows, { segments: 16 }), inletAt.clone(), inletDir), color: 0xc9a24c });

  // The gas tap on the bench, its own nozzle aimed down the bench toward the burner.
  const tx = POSITION.tap[0];
  const tz = POSITION.tap[1];
  const tapY = T + 0.46;
  solid.push({
    geometry: lathe([[0, 0], [0.16, 0, 'c'], [0.16, 0.03, 'c'], [0.09, 0.06], [0.055, 0.12], [0.052, 0.34], [0.07, 0.38], [0.07, 0.54], [0.04, 0.58], [0, 0.58]], { segments: 26 }).translate(tx, T, tz),
    color: 0xc9a24c,
  });
  const tapDir = V(0, 0, 1);
  const tapRows = [[0, 0], [0.038, 0, 'c']];
  for (let i = 0; i < ridges; i++) {
    const s = 0.08 + (i / ridges) * 0.3;
    const s2 = s + 0.3 / ridges;
    tapRows.push([0.038, s, 'c'], [0.05, s + 0.008, 'c'], [0.034, s2 - 0.004, 'c']);
  }
  tapRows.push([0.03, 0.4, 'c'], [0, 0.4]);
  const tapBase = V(tx, tapY, tz);
  solid.push({ geometry: aimed(lathe(tapRows, { segments: 16 }), tapBase.clone(), tapDir), color: 0xc9a24c });
  // The lever, turned along the nozzle: on.
  solid.push({ geometry: rod([tx, T + 0.58, tz], [tx, T + 0.62, tz], 0.03, { sides: 12 }), color: 0xa57f33 });
  solid.push({ geometry: rod([tx - tapDir.x * 0.08, T + 0.615, tz - tapDir.z * 0.08], [tx + tapDir.x * 0.28, T + 0.615, tz + tapDir.z * 0.28], 0.024, { sides: 10 }), color: 0xb5352a });
  solid.push({ geometry: ball(0.038, [tx + tapDir.x * 0.28, T + 0.615, tz + tapDir.z * 0.28], { detail: 12 }), color: 0xb5352a });

  // The hose runs from the burner's nozzle to the tap's, leaving each along its axis, and lies on the
  // bench in between with a little slack. Both ends are pushed well over the ridges.
  const hoseR = 0.062;
  const a0 = inletAt.clone().addScaledVector(inletDir, 0.2);
  const a1 = inletAt.clone().addScaledVector(inletDir, 0.58);
  const c0 = tapBase.clone().addScaledVector(tapDir, 0.1);
  const c1 = tapBase.clone().addScaledVector(tapDir, 0.5);
  const hosePath = [
    [a0.x, a0.y, a0.z], [a1.x, a1.y - 0.02, a1.z],
    [a1.x + 0.26, T + hoseR + 0.015, a1.z + 0.02],
    [3.82, T + hoseR + 0.004, -0.22],
    [3.72, T + hoseR + 0.05, -0.56],
    [c1.x, c1.y - 0.1, c1.z + 0.02],
    [c1.x, c1.y - 0.01, c1.z - 0.18],
    [c0.x, c0.y, c0.z],
  ];
  solid.push({ geometry: tube(hosePath, hoseR, { sides: 12, steps: 70, round: 2 }), color: 0xcf5a1c });

  // The clean blue flame: a bright inner cone and a mantle that shows only its far half.
  const flameY = T + barrelTop;
  const mantleH = 0.62;
  const mantle = lathe([
    [0, 0], [0.056, 0], [0.074, 0.05], [0.094, 0.14], [0.092, 0.26], [0.074, 0.4], [0.042, 0.53], [0, mantleH],
  ], { segments: 28 }).translate(bx, flameY, bz);
  const FL_LOW = lin(0x1438ff);
  const FL_HIGH = lin(0x54a4ff);
  tintVertices(mantle, (x, y, z, out) => {
    const t = clamp01((y - flameY) / mantleH);
    out[0] = mix(FL_LOW[0], FL_HIGH[0], t); out[1] = mix(FL_LOW[1], FL_HIGH[1], t); out[2] = mix(FL_LOW[2], FL_HIGH[2], t);
  });
  flameMantle.push({ geometry: mantle, keepColor: true });
  const core = lathe([[0, 0], [0.05, 0], [0.052, 0.03], [0.038, 0.12], [0.018, 0.21], [0, 0.27]], { segments: 22 }).translate(bx, flameY, bz);
  const CORE_LOW = lin(0x4fe0ff);
  const CORE_HIGH = lin(0xd8fbff);
  tintVertices(core, (x, y, z, out) => {
    const t = clamp01((y - flameY) / 0.27);
    out[0] = mix(CORE_LOW[0], CORE_HIGH[0], t); out[1] = mix(CORE_LOW[1], CORE_HIGH[1], t); out[2] = mix(CORE_LOW[2], CORE_HIGH[2], t);
  });
  flameCore.push({ geometry: core, keepColor: true });

  // The tripod: an iron ring on three legs, one behind and two either side of the front, so nothing
  // stands between the student and the flame.
  const ringY = 2.2;
  const ringR = 0.52;
  solid.push({ geometry: b(lathe(ringProfile(ringR, ringY, 0.032), { segments: 48 })), color: IRON });
  for (const bearing of [Math.PI, Math.PI * 0.3, -Math.PI * 0.3]) {
    const s = Math.sin(bearing);
    const c = Math.cos(bearing);
    const top = [bx + s * ringR, T + ringY, bz + c * ringR];
    const low = [bx + s * 0.7, T + 0.03, bz + c * 0.7];
    solid.push({ geometry: tube([top, [bx + s * 0.58, T + 1.5, bz + c * 0.58], low], [0.034, 0.034, 0.03], { sides: 10, steps: 12, round: 2 }), color: IRON });
    solid.push({ geometry: ball(0.052, top, { detail: 12 }), color: IRON });
    solid.push({ geometry: ball(0.05, [low[0], T + 0.03, low[2]], { detail: 12, squash: [1.2, 0.6, 1.2] }), color: 0x24272b });
  }

  // The gauze: a real square of wire, a frame and a ceramic centre.
  const gauzeY = T + ringY + 0.04;
  const G = 0.64;
  const wireStep = 0.056;
  for (let v = -G + wireStep; v < G; v += wireStep) {
    solid.push({ geometry: rod([bx - G, gauzeY, bz + v], [bx + G, gauzeY, bz + v], 0.0075, { sides: 4, open: true }), color: 0x7c8187 });
    solid.push({ geometry: rod([bx + v, gauzeY + 0.006, bz - G], [bx + v, gauzeY + 0.006, bz + G], 0.0075, { sides: 4, open: true }), color: 0x7c8187 });
  }
  for (const [p, q] of [[[-G, -G], [G, -G]], [[G, -G], [G, G]], [[G, G], [-G, G]], [[-G, G], [-G, -G]]]) {
    solid.push({ geometry: rod([bx + p[0], gauzeY + 0.003, bz + p[1]], [bx + q[0], gauzeY + 0.003, bz + q[1]], 0.016, { sides: 6 }), color: 0x60656b });
  }
  for (const [x, z] of [[-G, -G], [G, -G], [G, G], [-G, G]]) solid.push({ geometry: ball(0.018, [bx + x, gauzeY + 0.003, bz + z], { detail: 8 }), color: 0x60656b });
  solid.push({
    geometry: b(lathe([[0, 0], [0.34, 0, 'c'], [0.36, 0.008], [0.34, 0.018, 'c'], [0, 0.018]], { segments: 40 }), gauzeY - 0.006),
    color: 0xd9d4c6,
  });

  // A small beaker on the gauze, which is the card's answer to "what do you heat?".
  const onGauze = gauzeY + 0.012;
  const smallWarp = spoutWarp(Math.PI * 0.5, BEAKER_SMALL.H, { depth: 0.16, reach: 0.06, width: 0.32 });
  glass.push({ geometry: b(lathe(beakerProfile(BEAKER_SMALL), { segments: 56, warp: smallWarp }), onGauze), color: GLASS });
  solid.push({ geometry: b(lathe(ringProfile(BEAKER_SMALL.R + BEAKER_SMALL.lip * 0.55, BEAKER_SMALL.H - 0.002, 0.01), { segments: 56, warp: smallWarp }), onGauze), color: GLASS_EDGE });
  solid.push({ geometry: b(lathe(ringProfile(BEAKER_SMALL.R - 0.01, 0.014, 0.012), { segments: 40 }), onGauze), color: 0xa9d2d6 });
  solid.push({ geometry: b(liquidBody(beakerInner(BEAKER_SMALL), layout.small.surface, 0.02, 0xf06a12), onGauze), keepColor: true });
  const smallHalf = (smallRegion.w / PPF / BEAKER_SMALL.R) / 2;
  printed.push({
    geometry: b(revPatch(() => BEAKER_SMALL.R, smallY0, smallY1, -smallHalf, smallHalf, smallRegion, { back: white }), onGauze),
    color: 0xffffff,
  });

  const grain = grainMaps({ seed: 77, knots: 2, strength: 0.35 });
  return group(
    mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.62, metalness: 0, ...grain })),
    solidMesh(solid, { roughness: 0.36, metalness: 0.12 }),
    mesh(mergeParts(printed), standard({ map: atlas, roughness: 0.55, metalness: 0 })),
    glassMesh(glass),
    unlitMesh(flameCore),
    unlitMesh(flameMantle, { side: THREE.BackSide }),
  );
}

// ---------------------------------------------------------------------------
// Simple electric circuit
// ---------------------------------------------------------------------------

// The whole circuit is authored on the board: x across, y out of the board, z toward its front edge.
// One matrix then tilts all of it onto the stand, so nothing about the wiring has to know the tilt.
//
// The loop is data. `wires` says which terminal each wire joins, the components say which terminals
// are joined inside them, and LAB2_LAYOUTS.circuit returns the lot so "one complete loop" can be
// checked by walking it rather than by looking.
const CIRCUIT = {
  tilt: THREE.MathUtils.degToRad(20),
  centreY: 2.62,
  halfW: 3,
  halfD: 2,
  thick: 0.2,
  terminals: {
    minus: { x: -1.5, z: 1.1, base: 0.06, dir: [-1, 0] },
    plus: { x: 1.5, z: 1.1, base: 0.06, dir: [1, 0] },
    switchHinge: { x: 2.56, z: 0.02, base: 0.12, dir: [0, 1] },
    switchClip: { x: 1.72, z: -0.66, base: 0.12, dir: [0, -1] },
    bulbRight: { x: 0.65, z: -1.25, base: 0.1, dir: [1, 0] },
    bulbLeft: { x: -0.95, z: -1.25, base: 0.1, dir: [-1, 0] },
  },
  wires: [
    { from: 'plus', to: 'switchHinge', color: 0xd3201c, via: [[2.12, 1.18], [2.56, 0.84]] },
    { from: 'switchClip', to: 'bulbRight', color: 0xd3201c, via: [[1.36, -1.2]] },
    { from: 'bulbLeft', to: 'minus', color: 0x17181a, via: [[-1.75, -1.3], [-2.42, -0.72], [-2.5, 0.34], [-2.16, 1.02]] },
  ],
  inside: [['minus', 'plus', 'battery'], ['switchClip', 'switchHinge', 'switch blade'], ['bulbRight', 'bulbLeft', 'filament']],
};
const LUG_LIFT = 0.06;

// Walks the circuit: each component joins two terminals and each wire joins two. A closed circuit
// is one in which that walk comes back to where it began having used every piece exactly once.
function circuitLayout() {
  const { terminals, wires, inside } = CIRCUIT;
  const links = [
    ...wires.map((w, i) => ({ a: w.from, b: w.to, name: `wire ${i + 1}` })),
    ...inside.map(([a, b, name]) => ({ a, b, name })),
  ];
  const used = new Set();
  const walk = [];
  let at = 'plus';
  for (;;) {
    const next = links.find((l) => !used.has(l) && (l.a === at || l.b === at));
    if (!next) break;
    used.add(next);
    walk.push(next.name);
    at = next.a === at ? next.b : next.a;
    if (at === 'plus') break;
  }
  return { terminals, wires, walk, closed: at === 'plus' && used.size === links.length };
}

const terminalLug = (t) => t.base + LUG_LIFT;

function bindingPost(list, t) {
  const y = t.base;
  list.push({
    geometry: lathe([[0, 0], [0.1, 0, 'c'], [0.1, 0.022, 'c'], [0.056, 0.036], [0.036, 0.05], [0.036, 0.25], [0, 0.26]], { segments: 22 }).translate(t.x, y, t.z),
    color: BRASS,
  });
  // A knurled nut clamps the wire's lug down on the flange.
  const flutes = (a, r) => (r > 0.07 ? r * (1 + 0.05 * Math.cos(10 * a)) : r);
  list.push({
    geometry: lathe([[0, 0.086], [0.09, 0.086, 'c'], [0.09, 0.16, 'c'], [0.068, 0.186], [0, 0.19]], { segments: 40, warp: flutes }).translate(t.x, y, t.z),
    color: 0xd4ad58,
  });
}

// What a wire ends in: a copper ring round the post, a tongue, and a crimp the insulation runs into.
function wireLug(list, t) {
  const y = terminalLug(t);
  const [dx, dz] = t.dir;
  list.push({ geometry: lathe(ringProfile(0.062, y, 0.024, 8, 0.55), { segments: 20 }).translate(t.x, 0, t.z), color: 0xd77f3c });
  const a = [t.x + dx * 0.07, y, t.z + dz * 0.07];
  const b = [t.x + dx * 0.2, y, t.z + dz * 0.2];
  list.push({ geometry: rod(a, b, 0.03, { sides: 10 }), color: 0xd77f3c });
  list.push({ geometry: rod([t.x + dx * 0.17, y, t.z + dz * 0.17], [t.x + dx * 0.3, y, t.z + dz * 0.3], 0.052, { sides: 12, radiusB: 0.074 }), color: 0xc9ccd0 });
}

// A wire's centre line, in order from its first terminal to its last. It leaves and enters each along
// the terminal's own direction, and drops to lie on the board between them.
function wirePath(w, radius) {
  const A = CIRCUIT.terminals[w.from];
  const B = CIRCUIT.terminals[w.to];
  const yA = terminalLug(A);
  const yB = terminalLug(B);
  const rest = radius + 0.008;
  const pts = [
    [A.x + A.dir[0] * 0.24, yA, A.z + A.dir[1] * 0.24],
    [A.x + A.dir[0] * 0.42, Math.max(rest, yA - 0.03), A.z + A.dir[1] * 0.42],
  ];
  for (const [x, z] of w.via) pts.push([x, rest, z]);
  pts.push(
    [B.x + B.dir[0] * 0.42, Math.max(rest, yB - 0.03), B.z + B.dir[1] * 0.42],
    [B.x + B.dir[0] * 0.24, yB, B.z + B.dir[1] * 0.24],
  );
  return pts;
}

// One arrow on the board showing conventional current, painted from the wire's own direction.
function currentArrow(ctx, toPx, x, z, dx, dz) {
  const [px, py] = toPx(x, z);
  const len = Math.hypot(dx, dz) || 1;
  const a = Math.atan2(dz / len, dx / len);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  ctx.fillStyle = 'rgba(70,40,14,0.82)';
  ctx.beginPath();
  ctx.moveTo(-30, -5); ctx.lineTo(8, -5); ctx.lineTo(8, -14); ctx.lineTo(32, 0); ctx.lineTo(8, 14); ctx.lineTo(8, 5); ctx.lineTo(-30, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function simpleCircuit() {
  const { tilt, centreY, halfW, halfD, thick, terminals, wires } = CIRCUIT;
  const M = new THREE.Matrix4().makeRotationX(tilt).setPosition(0, centreY, 0);
  const toWorld = (x, y, z) => V(x, y, z).applyMatrix4(M);
  const solid = [];
  const stand = [];
  const printed = [];
  const glass = [];
  const lit = [];
  const glowBack = [];

  const ATLAS = 1024;
  const PPF = 512 / 3;
  const boardRegion = atlasRegion(0, 0, ATLAS, Math.round(halfD * 2 * PPF), ATLAS);
  const cellPatch = atlasRegion(0, 700, 700, 300, ATLAS);
  const bulbX = -0.15;
  const bulbZ = -1.25;
  const toPx = (x, z) => [(x + halfW) * PPF, (z + halfD) * PPF];

  const atlas = canvasTexture(ATLAS, ATLAS, (ctx) => {
    const rng = seededRandom(9031);
    const W = boardRegion.w;
    const H = boardRegion.h;
    ctx.fillStyle = '#d3a56c';
    ctx.fillRect(0, 0, ATLAS, ATLAS);
    // Birch board, the grain running across.
    for (let i = 0; i < 26; i++) {
      const y = rng() * H;
      const h = 8 + rng() * 40;
      const k = 196 + Math.round(rng() * 34);
      ctx.fillStyle = `rgba(${k},${k - 40},${k - 96},0.3)`;
      ctx.fillRect(0, y, W, h);
    }
    for (let i = 0; i < 240; i++) {
      const y0 = rng() * H;
      const amp = 1 + rng() * 6;
      const phase = rng() * 6.28;
      const k = 120 + Math.round(rng() * 50);
      ctx.strokeStyle = `rgba(${k},${k - 48},${k - 92},${0.12 + rng() * 0.3})`;
      ctx.lineWidth = 0.6 + rng() * 1.3;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 32) {
        const py = y0 + Math.sin((x / W) * 6.28 * 1.5 + phase) * amp;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
    // The warm pool of light under the lamp, which is most of what says the lamp is on.
    const [gx, gy] = toPx(bulbX, bulbZ + 0.05);
    const glow = ctx.createRadialGradient(gx, gy, 30, gx, gy, 360);
    glow.addColorStop(0, 'rgba(255,214,96,1)');
    glow.addColorStop(0.4, 'rgba(255,196,74,0.72)');
    glow.addColorStop(1, 'rgba(255,180,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // The names of the parts, in a lettering pen.
    const label = (text, x, z, px, color = '#3c2410') => {
      const [lx, ly] = toPx(x, z);
      ctx.fillStyle = color;
      ctx.font = `bold ${px}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly);
    };
    label('BATTERY', 0, 1.76, 34);
    label('SWITCH (closed)', 1.85, 0.46, 24);
    label('BULB', bulbX, -0.62, 34);
    label('One complete', -1.78, -0.2, 26, '#5a3a1c');
    label('loop', -1.78, 0.02, 26, '#5a3a1c');
    label('arrows: current', -1.78, 0.26, 19, '#5a3a1c');
    // + and - beside each battery terminal: big, because that is what the card asks you to trace from.
    label('+', 1.5, 1.74, 104, '#b81711');
    label('−', -1.5, 1.74, 104, '#141414');
    // Conventional current runs out of + and round to -, so the arrows follow the wires in that order.
    const inward = 0.26;
    for (const w of wires) {
      const pts = wirePath(w, 0.07);
      for (const f of w.from === 'plus' ? [0.55] : w.from === 'bulbLeft' ? [0.3, 0.72] : [0.5]) {
        const i = Math.floor(f * (pts.length - 1));
        const a = pts[i];
        const b = pts[i + 1];
        let nx = -(b[2] - a[2]);
        let nz = b[0] - a[0];
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[2] + b[2]) / 2;
        // Toward the board's centre, whichever side of the wire that is.
        const s = (nx * -mx + nz * -mz) > 0 ? 1 : -1;
        currentArrow(ctx, toPx, mx + s * nx * inward, mz + s * nz * inward, b[0] - a[0], b[2] - a[2]);
      }
    }

    // The cell's printed wrapper.
    const { x, y, w, h } = cellPatch;
    ctx.fillStyle = '#123a8c';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(x + w * 0.76, y, w * 0.24, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 170px Arial, Helvetica, sans-serif';
    ctx.fillText('−', x + w * 0.1, y + h * 0.5);
    ctx.font = 'bold 118px Arial, Helvetica, sans-serif';
    ctx.fillText('1.5 V', x + w * 0.43, y + h * 0.5);
    ctx.fillStyle = '#123a8c';
    ctx.font = 'bold 200px Arial, Helvetica, sans-serif';
    ctx.fillText('+', x + w * 0.88, y + h * 0.52);
  });

  // --- The board. Its top carries the painting and its edges the tone of the wood.
  const boardGeo = new THREE.BoxGeometry(halfW * 2, thick, halfD * 2).translate(0, -thick / 2, 0);
  {
    const p = boardGeo.attributes.position;
    const uv = boardGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const s = (p.getX(i) + halfW) / (halfW * 2);
      const t = (p.getZ(i) + halfD) / (halfD * 2);
      uv.setXY(i, mix(boardRegion.u0, boardRegion.u1, s), mix(boardRegion.v1, boardRegion.v0, t));
    }
  }
  printed.push({ geometry: boardGeo, color: 0xffffff });

  // --- The battery holder: a black tray with end plates, a spring at the minus end and a brass tab
  // at the plus end, and a strap from each contact out to its binding post.
  const cellZ = terminals.plus.z;
  const cellR = 0.33;
  const cellL = 1.26;
  const trayTop = 0.06;
  const cellY = trayTop + 0.05 + cellR;
  const BLACK = 0x2c2f35;
  solid.push({ geometry: box(3.5, trayTop, 0.92, [0, trayTop / 2, cellZ]), color: BLACK });
  for (const sz of [-1, 1]) solid.push({ geometry: box(1.92, 0.22, 0.09, [-0.02, trayTop + 0.11, cellZ + sz * 0.41]), color: BLACK });
  for (const sx of [-1, 1]) solid.push({ geometry: box(0.1, 0.78, 0.72, [sx * 0.99, trayTop + 0.39, cellZ]), color: 0x3a3e45 });
  // A saddle under the cell so it visibly rests in the tray rather than floating over it.
  for (const x of [-0.42, 0.42]) {
    const saddle = extrudeOutline([[-0.38, -0.002], [0.38, -0.002], [0.38, 0.12], [0.2, 0.08], [0, 0.06], [-0.2, 0.08], [-0.38, 0.12]].map(([a, b]) => [a, b]), 0.14);
    saddle.rotateY(Math.PI / 2).translate(x, trayTop, cellZ);
    solid.push({ geometry: saddle, color: 0x3a3e45 });
  }
  // The cell, along +X with its + on the right. The nub is the plus end, flat steel the minus.
  const cellX0 = -cellL / 2 - 0.01;
  const cellDir = V(1, 0, 0);
  const cellAt = [cellX0, cellY, cellZ];
  solid.push({ geometry: aimed(lathe([[0, 0], [cellR - 0.03, 0, 'c'], [cellR - 0.004, 0.012], [cellR, 0.03]], { segments: 56 }), cellAt, cellDir), color: 0xc9ccd0 });
  solid.push({ geometry: aimed(lathe([[cellR, 0.03], [cellR, cellL * 0.76]], { segments: 56 }), cellAt, cellDir), color: 0x123a8c });
  solid.push({ geometry: aimed(lathe([[cellR, cellL * 0.76], [cellR, cellL - 0.03], [cellR - 0.012, cellL - 0.008]], { segments: 56 }), cellAt, cellDir), color: 0xf5c518 });
  solid.push({
    geometry: aimed(lathe([[cellR - 0.012, cellL - 0.008], [cellR - 0.05, cellL, 'c'], [0.11, cellL, 'c'], [0.1, cellL + 0.015], [0.1, cellL + 0.07], [0.08, cellL + 0.085], [0, cellL + 0.09]], { segments: 56 }), cellAt, cellDir),
    color: 0xc9ccd0,
  });
  // The printed part of the wrapper lies over the top and the front: + and - and the voltage.
  {
    const positions = [];
    const uvs = [];
    const indices = [];
    const nu = 8;
    const nv = 14;
    const r = cellR + 0.004;
    const th0 = 1.08; // toward the front
    const th1 = -0.34; // toward the back
    for (let j = 0; j <= nv; j++) {
      const th = mix(th0, th1, j / nv);
      for (let i = 0; i <= nu; i++) {
        positions.push(cellX0 + 0.03 + (i / nu) * (cellL - 0.06), cellY + Math.cos(th) * r, cellZ + Math.sin(th) * r);
        uvs.push(mix(cellPatch.u0, cellPatch.u1, i / nu), mix(cellPatch.v0, cellPatch.v1, j / nv));
      }
    }
    const row = nu + 1;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const p = j * row + i;
        indices.push(p, p + 1, p + row + 1, p, p + row + 1, p + row);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(indices);
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    printed.push({ geometry: g, color: 0xffffff });
  }
  // The spring, from the minus end of the cell to the end plate, which has a brass plate behind it.
  const springPts = [];
  const coilR = 0.17;
  const plateX = -0.94;
  const springTurns = 4;
  const springSteps = 72;
  const endCell = cellX0 - 0.005;
  for (let i = 0; i <= springSteps; i++) {
    const t = i / springSteps;
    const a = t * springTurns * Math.PI * 2;
    const taper = 1 - 0.5 * Math.abs(t - 0.5);
    springPts.push([mix(plateX + 0.01, endCell, t), cellY + Math.cos(a) * coilR * taper, cellZ + Math.sin(a) * coilR * taper]);
  }
  solid.push({ geometry: tube(springPts, 0.016, { sides: 7, steps: springSteps * 2 }), color: 0xd5d8dc });
  const contact = (sx) => {
    solid.push({ geometry: box(0.03, 0.42, 0.42, [sx * 0.93, cellY, cellZ]), color: BRASS });
  };
  contact(-1);
  contact(1);
  // Straps from each contact over the end plate and along the tray to the post.
  for (const [sx, t] of [[-1, terminals.minus], [1, terminals.plus]]) {
    solid.push({ geometry: box(0.03, 0.42, 0.14, [sx * 1.055, trayTop + 0.21, cellZ]), color: BRASS });
    solid.push({ geometry: box(Math.abs(t.x) - 1.03, 0.012, 0.14, [sx * ((Math.abs(t.x) + 1.03) / 2), trayTop + 0.006, cellZ]), color: BRASS });
  }

  // --- Binding posts and wires.
  for (const t of Object.values(terminals)) {
    bindingPost(solid, t);
    wireLug(solid, t);
  }
  const wireR = 0.07;
  wires.forEach((w) => {
    const path = wirePath(w, wireR);
    solid.push({ geometry: tube(path, wireR, { sides: 12, steps: path.length * 12, round: 2 }), color: w.color });
    // Brass staples hold the wire down on the long runs, so it reads as lying on the board.
    for (let k = 1; k < w.via.length + 1; k += 1) {
      if (k >= path.length - 2) continue;
      const a = path[k];
      const b = path[k + 1];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[2] + b[2]) / 2;
      const rs = wireR + 0.018;
      const arc = [];
      for (let i = 0; i <= 8; i++) {
        const t = -Math.PI / 2 + (i / 8) * Math.PI;
        arc.push([mx + nx * Math.sin(t) * rs, -0.01 + rs * Math.cos(t) * 1.02 + (i === 0 || i === 8 ? -0.01 : 0), mz + nz * Math.sin(t) * rs]);
      }
      solid.push({ geometry: tube(arc, 0.016, { sides: 6, steps: 16 }), color: 0xbfa050 });
    }
  });

  // --- The knife switch: a slate base, a hinge at the back and a sprung clip at the front, a copper
  // blade between them, and an insulated handle. Closed: the blade lies in the clip.
  const sw = { x0: 0.96, x1: 2.86, z0: 0.2, z1: -0.86, top: 0.12 };
  const slate = extrudeOutline(corners((sw.x1 - sw.x0) / 2, (sw.z0 - sw.z1) / 2, 0.05), sw.top);
  slate.rotateX(Math.PI / 2).translate((sw.x0 + sw.x1) / 2, sw.top / 2, (sw.z0 + sw.z1) / 2);
  solid.push({ geometry: slate, color: 0x3e434a });
  const bladeZ = -0.32;
  const hingeX = 2.56;
  const clipX = 1.72;
  const bladeY = sw.top + 0.26;
  const bladeW = 0.05;
  const bladeH = 0.17;
  const COPPER = 0xd77f3c;
  // The two pairs of jaws, the blade on edge running between them. Closed: it lies in the clip.
  for (const sz of [-1, 1]) {
    const jawH = bladeY + 0.09 - sw.top;
    solid.push({ geometry: box(0.24, jawH, 0.04, [hingeX, sw.top + jawH / 2, bladeZ + sz * (bladeW / 2 + 0.022)]), color: BRASS });
    solid.push({ geometry: box(0.2, jawH, 0.04, [clipX, sw.top + jawH / 2, bladeZ + sz * (bladeW / 2 + 0.022)]), color: BRASS });
  }
  solid.push({ geometry: box(0.3, 0.05, 0.2, [hingeX, sw.top + 0.025, bladeZ]), color: BRASS });
  solid.push({ geometry: box(0.26, 0.05, 0.2, [clipX, sw.top + 0.025, bladeZ]), color: BRASS });
  solid.push({ geometry: rod([hingeX, bladeY, bladeZ - 0.09], [hingeX, bladeY, bladeZ + 0.09], 0.03, { sides: 12 }), color: 0xe3c778 });
  for (const sz of [-1, 1]) solid.push({ geometry: ball(0.04, [hingeX, bladeY, bladeZ + sz * 0.09], { detail: 10, squash: [1, 1, 0.5] }), color: 0xe3c778 });
  const bladeEnd = clipX - 0.3;
  solid.push({ geometry: box(hingeX + 0.08 - bladeEnd, bladeH, bladeW, [(hingeX + 0.08 + bladeEnd) / 2, bladeY, bladeZ]), color: COPPER });
  // The insulated handle, in line with the blade and lifted a little, for a hand to take.
  const gripAt = [bladeEnd - 0.02, bladeY + 0.01, bladeZ];
  solid.push({ geometry: rod([bladeEnd + 0.06, bladeY, bladeZ], gripAt, 0.034, { sides: 12 }), color: 0xc9ccd0 });
  solid.push({
    geometry: aimed(lathe([[0, 0], [0.05, 0.005], [0.066, 0.06], [0.078, 0.14], [0.084, 0.26], [0.074, 0.36], [0.04, 0.4], [0, 0.41]], { segments: 18 }), gripAt, V(-0.96, 0.28, 0)),
    color: 0x17181a,
  });
  // Brass straps from each pair of jaws out to the binding posts.
  const strap = (p, q) => {
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz);
    const g = new THREE.BoxGeometry(0.12, 0.014, len + 0.1);
    g.rotateY(Math.atan2(dx, dz));
    g.translate((p[0] + q[0]) / 2, sw.top + 0.007, (p[1] + q[1]) / 2);
    solid.push({ geometry: g, color: BRASS });
  };
  strap([clipX, bladeZ], [terminals.switchClip.x, terminals.switchClip.z]);
  strap([hingeX, bladeZ], [terminals.switchHinge.x, terminals.switchHinge.z]);

  // --- The lamp: a bakelite base carrying two posts, a brass socket, a glass bulb, and a coiled
  // filament that is the one thing here that is unlit, because it is the light.
  const baseT = terminals.bulbLeft.base;
  const baseOutline = extrudeOutline(corners(1.08, 0.42, 0.1), baseT);
  baseOutline.rotateX(Math.PI / 2).translate(bulbX, baseT / 2, bulbZ);
  solid.push({ geometry: baseOutline, color: 0x3d2615 });
  solid.push({
    geometry: lathe([
      [0, 0], [0.34, 0, 'c'], [0.34, 0.05, 'c'], [0.24, 0.1], [0.22, 0.14, 'c'], [0.22, 0.42, 'c'], [0.2, 0.44, 'c'], [0, 0.44],
    ], { segments: 40 }).translate(bulbX, baseT, bulbZ),
    color: 0xc39a45,
  });
  // Screw threads on the lamp's cap, seen just above the socket's rim.
  const capRows = [[0, 0.4]];
  for (let i = 0; i < 5; i++) {
    const y = 0.42 + i * 0.03;
    capRows.push([0.176, y], [0.19, y + 0.015]);
  }
  capRows.push([0.178, 0.58], [0.16, 0.6], [0, 0.6]);
  solid.push({ geometry: lathe(capRows, { segments: 32 }).translate(bulbX, baseT, bulbZ), color: 0xd9dbdf });
  for (const [t, sx] of [[terminals.bulbRight, 1], [terminals.bulbLeft, -1]]) {
    const len = Math.abs(t.x - bulbX) - 0.28;
    solid.push({ geometry: box(len, 0.014, 0.14, [bulbX + sx * (0.28 + len / 2), baseT + 0.007, bulbZ]), color: BRASS });
  }
  const bulbY0 = baseT + 0.56;
  const bulbShape = new THREE.CatmullRomCurve3([
    [0.17, 0], [0.19, 0.08], [0.25, 0.2], [0.36, 0.38], [0.43, 0.58], [0.45, 0.76], [0.42, 0.94], [0.33, 1.1], [0.2, 1.2], [0.08, 1.245], [0.0, 1.25],
  ].map(([r, y]) => V(r, y, 0)), false, 'centripetal');
  const envelope = [];
  for (let i = 0; i <= 34; i++) { const p = bulbShape.getPoint(i / 34); envelope.push([Math.max(0, p.x), p.y]); }
  envelope[envelope.length - 1][0] = 0;
  const inner = envelope.map(([r, y]) => [Math.max(0, r - 0.012), y - 0.008]).reverse().slice(1);
  const bulbProfile = [[0, 0], ...envelope, ...inner, [0, 0.02]];
  glass.push({ geometry: lathe(bulbProfile, { segments: 56 }).translate(bulbX, bulbY0, bulbZ), color: 0xfff0c4 });
  // The glow is the far half of a shell just inside the glass: drawn from its back faces, so from
  // every bearing there is warm light behind the filament and none in front of it.
  const glowShell = lathe([[0, 0.02], ...envelope.slice(1).map(([r, y]) => [Math.max(0, r - 0.02), y - 0.012])], { segments: 40 });
  const GLOW_HOT = lin(0xfff0a0);
  const GLOW_EDGE = lin(0xffa53a);
  tintVertices(glowShell, (x, y, z, out) => {
    const t = clamp01(Math.hypot(x, (y - 0.68) * 0.85, z) / 0.6);
    const k = t * t;
    out[0] = mix(GLOW_HOT[0], GLOW_EDGE[0], k); out[1] = mix(GLOW_HOT[1], GLOW_EDGE[1], k); out[2] = mix(GLOW_HOT[2], GLOW_EDGE[2], k);
  });
  glowBack.push({ geometry: glowShell.translate(bulbX, bulbY0, bulbZ), keepColor: true });
  // The stem and the two lead-in wires.
  const stemTop = bulbY0 + 0.34;
  glass.push({ geometry: lathe([[0, 0], [0.13, 0], [0.1, 0.1], [0.06, 0.2], [0.05, 0.34], [0, 0.35]], { segments: 18 }).translate(bulbX, bulbY0, bulbZ), color: 0xfff0c4 });
  const filY = bulbY0 + 0.68;
  const filHalf = 0.17;
  for (const sx of [-1, 1]) {
    solid.push({ geometry: tube([[bulbX + sx * 0.04, bulbY0 + 0.08, bulbZ], [bulbX + sx * 0.05, stemTop, bulbZ], [bulbX + sx * filHalf, filY, bulbZ]], 0.011, { sides: 6, steps: 10, round: 1 }), color: 0x6b6e73 });
  }
  const coil = [];
  const coilTurns = 7;
  const coilSteps = 112;
  for (let i = 0; i <= coilSteps; i++) {
    const t = i / coilSteps;
    const a = t * coilTurns * Math.PI * 2;
    coil.push([bulbX + mix(-filHalf, filHalf, t), filY + Math.sin(a) * 0.036, bulbZ + Math.cos(a) * 0.036]);
  }
  lit.push({ geometry: tube(coil, 0.014, { sides: 6, steps: coilSteps }), color: 0xfffbe0 });

  // Everything so far is in the board's frame. Tilt it onto the stand.
  for (const list of [solid, printed, glass, lit, glowBack]) for (const p of list) p.geometry.applyMatrix4(M);

  // --- The stand: two side frames under the board and a rail between them, in the world's frame.
  const rng = seededRandom(733);
  const FRAME = 0x70431f;
  const under = (x, z) => { const p = toWorld(x, -thick + 0.02, z); return [p.x, p.y, p.z]; };
  for (const x of [-2.42, 2.42]) {
    const f = under(x, 1.72);
    const b = under(x, -1.72);
    timber(stand, FRAME, [x, 0.09, f[2] + 0.42], [x, 0.09, b[2] - 0.42], 0.3, 0.18, { chamfer: 0.015, rng });
    timber(stand, FRAME, [x, 0.14, f[2]], f, 0.22, 0.22, { chamfer: 0.015, rng, up: [0, 0, 1] });
    timber(stand, FRAME, [x, 0.14, b[2]], b, 0.22, 0.22, { chamfer: 0.015, rng, up: [0, 0, 1] });
    // A diagonal brace, which is what keeps a frame like this from racking.
    const m = [x, 0.14, f[2] - 0.05];
    timber(stand, FRAME, m, [x, b[1] - 0.2, b[2] + 0.1], 0.12, 0.16, { chamfer: 0.012, rng, up: [1, 0, 0] });
  }
  const railF = under(0, 1.72);
  const railB = under(0, -1.72);
  timber(stand, FRAME, [-2.42, railB[1] - 0.26, railB[2]], [2.42, railB[1] - 0.26, railB[2]], 0.18, 0.24, { chamfer: 0.015, rng });
  timber(stand, FRAME, [-2.42, railF[1] - 0.2, railF[2]], [2.42, railF[1] - 0.2, railF[2]], 0.18, 0.2, { chamfer: 0.015, rng });
  // A moulded lip round the board, in the tilted frame.
  for (const [a, b, w] of [
    [[-halfW - 0.05, 0, halfD + 0.05], [halfW + 0.05, 0, halfD + 0.05], 0.1],
    [[-halfW - 0.05, 0, -halfD - 0.05], [halfW + 0.05, 0, -halfD - 0.05], 0.1],
    [[-halfW - 0.05, 0, -halfD], [-halfW - 0.05, 0, halfD], 0.1],
    [[halfW + 0.05, 0, -halfD], [halfW + 0.05, 0, halfD], 0.1],
  ]) {
    const pa = toWorld(a[0], -thick / 2 + 0.03, a[2]);
    const pb = toWorld(b[0], -thick / 2 + 0.03, b[2]);
    timber(stand, 0x7a4c26, [pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], w, thick + 0.06, { chamfer: 0.018, rng, up: [0, Math.cos(tilt), Math.sin(tilt)] });
  }

  const grain = grainMaps({ seed: 41, knots: 2, strength: 0.35 });
  const lamp = glassMesh(glass, { emissive: 0xffb84d, emissiveIntensity: 0.5, opacity: 0.2 });
  return group(
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.62, metalness: 0, ...grain })),
    solidMesh(solid, { roughness: 0.34, metalness: 0.14 }),
    mesh(mergeParts(printed), standard({ map: atlas, roughness: 0.7, metalness: 0 })),
    lamp,
    unlitMesh(lit),
    unlitMesh(glowBack, { side: THREE.BackSide }),
  );
}

// A rounded rectangle, counter-clockwise, with every corner run doubled at its ends so the flats stay flat.
function corners(hw, hd, r, steps = 3) {
  const out = [];
  for (const [cx, cy, a0] of [[hw - r, hd - r, 0], [-hw + r, hd - r, Math.PI / 2], [-hw + r, -hd + r, Math.PI], [hw - r, -hd + r, -Math.PI / 2]]) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bar magnet and field
// ---------------------------------------------------------------------------

// The field is the two-pole model of a bar magnet: a north pole and a south pole a little in from
// each end, each with an inverse-square field. It is what a textbook's dipole picture is, it is exact
// enough near the bar to show the crowding at the poles, and everything on the board is computed from
// it: the painted filings, the standing filings and every compass needle.
const MAGNET = {
  top: 2.1, L: 3, W: 0.56, H: 0.34, poleX: 1.32, paperW: 3.86, paperD: 2.36,
};
const POLE_N = [-MAGNET.poleX, 0];
const POLE_S = [MAGNET.poleX, 0];

// B at a point, with y the height above the plane of the poles. North is a source, south a sink, so
// outside the bar the field runs from N round to S.
function magnetField(x, y, z) {
  const nx = x - POLE_N[0]; const nz = z - POLE_N[1];
  const sx = x - POLE_S[0]; const sz = z - POLE_S[1];
  const dn = (nx * nx + y * y + nz * nz) ** -1.5;
  const ds = (sx * sx + y * y + sz * sz) ** -1.5;
  return [nx * dn - sx * ds, y * dn - y * ds, nz * dn - sz * ds];
}

const insideBar = (x, z, margin = 0.02) => Math.abs(x) < MAGNET.L / 2 + margin && Math.abs(z) < MAGNET.W / 2 + margin;
const onPaper = (x, z) => Math.abs(x) < MAGNET.paperW - 0.03 && Math.abs(z) < MAGNET.paperD - 0.03;

// One unit step along the field in the plane of the board.
function fieldDir(x, z, y = 0.06) {
  const [bx, , bz] = magnetField(x, y, z);
  const len = Math.hypot(bx, bz) || 1;
  return [bx / len, bz / len];
}

// Field lines traced out of each pole with a midpoint rule: forward along the field from the north
// pole, backward along it from the south. Tracing from one pole alone is the obvious way and it is
// wrong: a line that leaves the sheet never comes back, so the far pole gets far fewer lines and the
// picture comes out lopsided, when the true field is symmetric. Iron filings do not lie evenly, they
// link up into chains along the lines, and starting the lines at equal angles round a pole gives the
// crowding there for nothing.
function traceFieldLines(count) {
  const lines = [];
  for (const [pole, other, sign] of [[POLE_N, POLE_S, 1], [POLE_S, POLE_N, -1]]) {
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2;
      let x = pole[0] + Math.cos(a) * 0.1;
      let z = pole[1] + Math.sin(a) * 0.1;
      const pts = [];
      for (let s = 0; s < 900; s++) {
        if (!insideBar(x, z)) pts.push([x, z]);
        const [dx, dz] = fieldDir(x, z);
        const [mx, mz] = fieldDir(x + sign * dx * 0.012, z + sign * dz * 0.012);
        x += sign * mx * 0.024; z += sign * mz * 0.024;
        if (!onPaper(x, z) && pts.length) break;
        if (Math.hypot(x - other[0], z - other[1]) < 0.09) break;
      }
      if (pts.length > 4) lines.push(pts);
    }
  }
  return lines;
}

// Chains of filings: most of them seeded close beside a field line, the rest scattered, thinned by
// the strength of the field. Each chain is a few needles laid end to end along the true direction.
function filingChains(rng, { chains, onLines = 0.72 }) {
  const lines = traceFieldLines(40);
  const out = [];
  const needleIn = (x, z, list, len) => {
    const [dx, dz] = fieldDir(x, z);
    list.push({ x, z, dx, dz, len });
    return [x + dx * len * 1.08, z + dz * len * 1.08];
  };
  let guard = 0;
  while (out.length < chains && guard < chains * 30) {
    guard += 1;
    let x; let z;
    if (rng() < onLines) {
      const line = lines[Math.floor(rng() * lines.length)];
      const p = line[Math.floor(rng() * line.length)];
      const spread = 0.014 + 0.06 * rng() * rng();
      const [dx, dz] = fieldDir(p[0], p[1]);
      const off = (rng() - 0.5) * 2 * spread;
      x = p[0] - dz * off; z = p[1] + dx * off;
    } else {
      x = (rng() * 2 - 1) * MAGNET.paperW;
      z = (rng() * 2 - 1) * MAGNET.paperD;
      const [bx, , bz] = magnetField(x, 0.06, z);
      // Sparse where the field is weak, so the corners of the board stay nearly bare.
      if (rng() > Math.min(1, Math.hypot(bx, bz) ** 0.55 * 1.5)) continue;
    }
    if (!onPaper(x, z) || insideBar(x, z)) continue;
    const list = [];
    const n = 2 + Math.floor(rng() * 4);
    let cx = x; let cz = z;
    for (let i = 0; i < n; i++) {
      if (!onPaper(cx, cz) || insideBar(cx, cz)) break;
      const len = 0.03 + rng() * 0.05;
      [cx, cz] = needleIn(cx, cz, list, len);
    }
    if (list.length) out.push(list);
  }
  return out;
}

// Twelve compasses on an ellipse round the bar, every 30 degrees, so one sits straight off each end
// and one straight off each side. Each needle's north tip points along the field at its own centre.
function magnetLayout() {
  const compasses = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 2.62;
    const z = Math.sin(a) * 1.62;
    const [dx, dz] = fieldDir(x, z, 0);
    compasses.push({ x, z, dx, dz });
  }
  return { compasses, poleN: POLE_N, poleS: POLE_S, field: magnetField };
}

const COMPASS_R = 0.27;
const PAINTED_CHAINS = 9000;

function barMagnetField() {
  const { top: T, L, W, H, paperW, paperD } = MAGNET;
  const layout = magnetLayout();
  const wood = [];
  const solid = [];
  const printed = [];
  const glass = [];
  const paper = [];

  const rngA = seededRandom(5101);
  const painted = filingChains(rngA, { chains: PAINTED_CHAINS, onLines: 0.62 });

  // --- The sheet the filings lie on, carried by its painting: this is the one canvas in this file
  // above 1024, because a filing is about a tenth of an inch and it is the whole picture.
  const CW = 2048;
  const CH = Math.round((CW * paperD) / paperW);
  const sheet = canvasTexture(CW, CH, (ctx, w, h) => {
    const rng = seededRandom(6007);
    ctx.fillStyle = '#ece3cc';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const v = 214 + Math.round(rng() * 22);
      ctx.fillStyle = `rgba(${v},${v - 8},${v - 26},0.3)`;
      ctx.fillRect(rng() * w, rng() * h, 2 + rng() * 26, 1 + rng() * 2);
    }
    const toX = (x) => ((x + paperW) / (2 * paperW)) * w;
    const toY = (z) => ((z + paperD) / (2 * paperD)) * h;
    const ppf = w / (2 * paperW);
    ctx.lineCap = 'round';
    const SHADES = ['#17181b', '#222327', '#2c2b2c', '#37342f'];
    const batches = SHADES.map(() => []);
    for (const chain of painted) for (const n of chain) batches[Math.floor(rng() * SHADES.length)].push(n);
    batches.forEach((batch, s) => {
      ctx.strokeStyle = SHADES[s];
      ctx.lineWidth = 1.25 + s * 0.22;
      ctx.beginPath();
      for (const n of batch) {
        const hx = n.dx * n.len * 0.5;
        const hz = n.dz * n.len * 0.5;
        ctx.moveTo(toX(n.x - hx), toY(n.z - hz));
        ctx.lineTo(toX(n.x + hx), toY(n.z + hz));
      }
      ctx.stroke();
    });
    // A little soft shadow where the bar stands on the sheet, so it sits down rather than floats.
    ctx.fillStyle = 'rgba(40,34,24,0.22)';
    ctx.fillRect(toX(-L / 2 - 0.05), toY(-W / 2 - 0.05), (L + 0.1) * ppf, (W + 0.1) * ppf);
  });
  const sheetGeo = new THREE.PlaneGeometry(paperW * 2, paperD * 2).rotateX(-Math.PI / 2).translate(0, T, 0);
  paper.push({ geometry: sheetGeo, color: 0xffffff });

  // --- The filings that stand proud of the sheet: real needles, each lying along the field in three
  // dimensions, so close to a pole they lift toward it the way real ones stand up. A three-sided
  // bipyramid is six triangles. They sit on top of the painting and catch the sun.
  const rngB = seededRandom(5303);
  const standing = filingChains(rngB, { chains: 1750, onLines: 0.82 });
  const fp = [];
  const fn = [];
  const fc = [];
  const IRON_TONES = [lin(0x1b1c1f), lin(0x26272b), lin(0x323338), lin(0x45464c)];
  const clearOfCompass = (x, z) => layout.compasses.every((c) => Math.hypot(x - c.x, z - c.z) > COMPASS_R + 0.05);
  const barCentreY = H / 2;
  const a1 = new THREE.Vector3();
  const a2 = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const pushTri = (p, q, r, tone) => {
    a1.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    a2.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    a1.cross(a2).normalize();
    for (const v of [p, q, r]) {
      fp.push(v[0], v[1], v[2]);
      fn.push(a1.x, a1.y, a1.z);
      fc.push(tone[0], tone[1], tone[2]);
    }
  };
  let standingCount = 0;
  for (const chain of standing) {
    for (const n of chain) {
      if (!clearOfCompass(n.x, n.z)) continue;
      const [bx, by, bz] = magnetField(n.x, 0.03 - barCentreY, n.z);
      // A filing lines up with the field wherever it points, including out of the sheet, up to the
      // point where it would simply fall over.
      const flat = Math.hypot(bx, bz) || 1;
      const lift = Math.min(0.75, Math.abs(by) / flat);
      axis.set(bx, Math.sign(by) * flat * Math.tan(lift), bz).normalize();
      const half = n.len * 0.72 + 0.008;
      const rad = 0.0048 + rngB() * 0.0042;
      const cy = T + Math.abs(axis.y) * half + rad + 0.001;
      const tipA = [n.x + axis.x * half, cy + axis.y * half, n.z + axis.z * half];
      const tipB = [n.x - axis.x * half, cy - axis.y * half, n.z - axis.z * half];
      const side = Math.hypot(axis.x, axis.z) > 0.01 ? V(-axis.z, 0, axis.x).normalize() : V(1, 0, 0);
      const up = side.clone().cross(axis).normalize();
      const ring = [0, 1, 2].map((k) => {
        const t = (k / 3) * Math.PI * 2 + 0.5;
        const c = Math.cos(t) * rad;
        const s = Math.sin(t) * rad;
        return [n.x + side.x * c + up.x * s, cy + side.y * c + up.y * s, n.z + side.z * c + up.z * s];
      });
      const tone = IRON_TONES[Math.floor(rngB() * IRON_TONES.length)];
      for (let k = 0; k < 3; k++) {
        const r0 = ring[k];
        const r1 = ring[(k + 1) % 3];
        pushTri(tipA, r0, r1, tone);
        pushTri(tipB, r1, r0, tone);
      }
      standingCount += 1;
    }
  }
  const filingGeo = new THREE.BufferGeometry();
  filingGeo.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  filingGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
  filingGeo.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  solid.push({ geometry: filingGeo, keepColor: true });

  // --- The bar. Two lengths of painted steel meeting at the middle, with their letters printed on
  // the top and on both long faces.
  const r = 0.035;
  const halfOutline = (s) => {
    const out = [[0, H / 2], [0, H / 2]];
    const xEnd = s * (L / 2);
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * (Math.PI / 2);
      out.push([xEnd - s * r * (1 - Math.sin(t)), H / 2 - r * (1 - Math.cos(t))]);
    }
    for (let i = 0; i <= 4; i++) {
      const t = (i / 4) * (Math.PI / 2);
      out.push([xEnd - s * r * (1 - Math.cos(t)), -H / 2 + r * (1 - Math.sin(t))]);
    }
    out.push([0, -H / 2], [0, -H / 2]);
    return s > 0 ? out.reverse() : out;
  };
  const RED = 0xd9231f;
  const BLUE = 0x1b57d6;
  for (const [s, color] of [[-1, RED], [1, BLUE]]) {
    solid.push({ geometry: extrudeOutline(halfOutline(s), W).translate(0, T + H / 2, 0), color });
  }
  const LET = 512;
  const dialRegion = atlasRegion(0, 0, 256, 256, LET);
  const nRegion = atlasRegion(256, 0, 128, 128, LET);
  const sRegion = atlasRegion(384, 0, 128, 128, LET);
  const inset = (r) => { const k = 6 / LET; return { ...r, u0: r.u0 + k, u1: r.u1 - k, v0: r.v0 + k, v1: r.v1 - k }; };
  const letters = canvasTexture(LET, LET, (ctx) => {
    ctx.fillStyle = '#fbfaf4';
    ctx.fillRect(0, 0, LET, LET);
    const cx = 128; const cy = 128;
    ctx.strokeStyle = '#1b1f27';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const big = i % 9 === 0;
      const mid = i % 3 === 0;
      ctx.lineWidth = big ? 6 : mid ? 4 : 2;
      const inner = big ? 88 : mid ? 98 : 106;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * 118, cy + Math.sin(a) * 118);
      ctx.stroke();
    }
    for (const [region, bg, text] of [[nRegion, '#d9231f', 'N'], [sRegion, '#1b57d6', 'S']]) {
      ctx.fillStyle = bg;
      ctx.fillRect(region.x, region.y, region.w, region.h);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 110px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, region.x + region.w / 2, region.y + region.h / 2 + 5);
    }
  });
  for (const [x, region] of [[-1.02, inset(nRegion)], [1.02, inset(sRegion)]]) {
    const top = atlasPlane(0.46, 0.46, [0, 0, 0], region).rotateX(-Math.PI / 2).translate(x, T + H + 0.003, 0);
    printed.push({ geometry: top, color: 0xffffff });
    printed.push({ geometry: atlasPlane(0.28, 0.28, [x, T + H / 2, W / 2 + 0.003], region), color: 0xffffff });
    printed.push({ geometry: atlasPlane(0.28, 0.28, [0, 0, 0], region).rotateY(Math.PI).translate(x, T + H / 2, -W / 2 - 0.003), color: 0xffffff });
  }

  // --- The compasses, each standing proud on three feet.
  const dialUv = dialRegion;
  for (const c of layout.compasses) {
    const at = (g, y = T) => g.translate(c.x, y, c.z);
    const footH = 0.05;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      solid.push({ geometry: at(ball(0.045, [Math.sin(a) * 0.17, footH * 0.5, Math.cos(a) * 0.17], { detail: 8, squash: [1, 0.7, 1] })), color: 0x8a6c2c });
    }
    const y0 = footH * 0.75;
    solid.push({
      geometry: at(lathe([
        [0, y0], [COMPASS_R - 0.02, y0, 'c'], [COMPASS_R, y0 + 0.018], [COMPASS_R, y0 + 0.11], [COMPASS_R - 0.006, y0 + 0.126, 'c'], [COMPASS_R - 0.034, y0 + 0.126, 'c'],
        [COMPASS_R - 0.034, y0 + 0.052, 'c'], [0, y0 + 0.052],
      ], { segments: 40 })),
      color: BRASS,
    });
    const dial = new THREE.CircleGeometry(COMPASS_R - 0.036, 32);
    const dp = dial.attributes.position;
    const du = dial.attributes.uv;
    for (let i = 0; i < dp.count; i++) {
      du.setXY(i, mix(dialUv.u0, dialUv.u1, 0.5 + (dp.getX(i) / (COMPASS_R - 0.036)) * 0.5), mix(dialUv.v0, dialUv.v1, 0.5 + (dp.getY(i) / (COMPASS_R - 0.036)) * 0.5));
    }
    dial.rotateX(-Math.PI / 2);
    printed.push({ geometry: at(dial, T + y0 + 0.054), color: 0xffffff });
    // The needle: a flat lozenge on a pin, its north half red and pointing along the field.
    const pivotY = T + y0 + 0.086;
    const needleLen = COMPASS_R - 0.058;
    const needleW = 0.045;
    const needleT = 0.012;
    const north = V(c.dx, 0, c.dz);
    const across = V(-c.dz, 0, c.dx);
    const half = (dir, color) => {
      const tip = V(c.x, pivotY, c.z).addScaledVector(dir, needleLen);
      const a = V(c.x, pivotY, c.z).addScaledVector(across, needleW);
      const b = V(c.x, pivotY, c.z).addScaledVector(across, -needleW);
      const u = V(c.x, pivotY + needleT, c.z);
      const d = V(c.x, pivotY - needleT, c.z);
      const tris = [[tip, u, a], [tip, b, u], [tip, a, d], [tip, d, b]];
      const positions = [];
      for (const [p, q, s] of tris) {
        const e = q.clone().sub(p).cross(s.clone().sub(p));
        const mid = p.clone().add(q).add(s).multiplyScalar(1 / 3).sub(V(c.x, pivotY, c.z));
        const order = e.dot(mid) >= 0 ? [p, q, s] : [p, s, q];
        for (const v of order) positions.push(v.x, v.y, v.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      solid.push({ geometry: g, color });
    };
    half(north, 0xe0201a);
    half(north.clone().negate(), 0x2b3644);
    solid.push({ geometry: lathe([[0, T + y0 + 0.05], [0.012, T + y0 + 0.05], [0.012, pivotY + 0.012], [0.02, pivotY + 0.016], [0.02, pivotY + 0.026], [0, pivotY + 0.032]], { segments: 12 }).translate(c.x, 0, c.z), color: 0xb08d4e });
    // A low glass over it, and a brass bezel to hold the glass.
    const glassY = T + y0 + 0.122;
    glass.push({ geometry: at(lathe([[COMPASS_R - 0.016, 0], [COMPASS_R - 0.05, 0.022], [COMPASS_R * 0.55, 0.04], [0, 0.048]], { segments: 32 }), glassY), color: GLASS });
    solid.push({ geometry: lathe(ringProfile(COMPASS_R - 0.012, glassY + 0.004, 0.012), { segments: 40 }).translate(c.x, 0, c.z), color: 0xd4ad58 });
  }

  // --- The board and its low stand.
  const rng = seededRandom(1187);
  const FRAME = 0x6e4322;
  const slabT = 0.14;
  wood.push({ geometry: box(paperW * 2 + 0.1, slabT, paperD * 2 + 0.1, [0, T - slabT / 2 - 0.002, 0]), color: 0xa9774a });
  const fw = 0.24;
  const outerX = paperW + fw / 2 - 0.01;
  const outerZ = paperD + fw / 2 - 0.01;
  const edgeY = T - 0.06;
  for (const z of [-outerZ, outerZ]) timber(wood, 0x855429, [-outerX - fw / 2, edgeY, z], [outerX + fw / 2, edgeY, z], fw, 0.2, { chamfer: 0.02, rng });
  for (const x of [-outerX, outerX]) timber(wood, 0x855429, [x, edgeY, -outerZ + fw / 2], [x, edgeY, outerZ - fw / 2], fw, 0.2, { chamfer: 0.02, rng });
  const legX = paperW - 0.25;
  const legZ = paperD - 0.25;
  const legTop = T - slabT;
  for (const x of [-legX, legX]) {
    for (const z of [-legZ, legZ]) timber(wood, FRAME, [x, 0, z], [x, legTop, z], 0.3, 0.3, { chamfer: 0.025, rng, up: [0, 0, 1] });
    timber(wood, FRAME, [x, legTop - 0.14, -legZ], [x, legTop - 0.14, legZ], 0.14, 0.28, { chamfer: 0.012, rng });
    timber(wood, FRAME, [x, 0.42, -legZ], [x, 0.42, legZ], 0.14, 0.2, { chamfer: 0.012, rng });
  }
  for (const z of [-legZ, legZ]) timber(wood, FRAME, [-legX, legTop - 0.14, z], [legX, legTop - 0.14, z], 0.14, 0.28, { chamfer: 0.012, rng });
  timber(wood, FRAME, [-legX, 0.42, 0], [legX, 0.42, 0], 0.14, 0.2, { chamfer: 0.012, rng });

  const grain = grainMaps({ seed: 212, knots: 2, strength: 0.35 });
  return group(
    mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.62, metalness: 0, ...grain })),
    mesh(mergeParts(paper), standard({ map: sheet, roughness: 0.9, metalness: 0 })),
    solidMesh(solid, { roughness: 0.42, metalness: 0.14 }),
    mesh(mergeParts(printed), standard({ map: letters, roughness: 0.42, metalness: 0.14 })),
    glassMesh(glass, { opacity: 0.2 }),
  );
}

// ---------------------------------------------------------------------------
// Glass prism
// ---------------------------------------------------------------------------

// Every ray is computed by Snell's law at both faces, in the z = 0 plane. Apex up, so the fan bends
// DOWN, toward the prism's base, and red is on top. The incoming beam is set at minimum deviation for
// the middle of the spectrum, which is how a prism is really set up to give the cleanest spectrum.
//
// THE INDICES ARE EXAGGERATED AND THE CARD SHOULD SAY SO. Crown glass runs from about 1.514 in the red
// to about 1.530 in the violet (figures from memory, not checked against a data sheet), which fans a
// beam by about 1.4 degrees, under an inch over this model's three feet. These run 1.46 to 1.60, which
// fans it 12.6 degrees, about nine times that, so the seven colours can be told apart at six feet. The
// order, and which way they bend, are unchanged.
const SPECTRUM = [
  { name: 'Red', n: 1.46, color: 0xff1a12 },
  { name: 'Orange', n: 1.483, color: 0xff7a00 },
  { name: 'Yellow', n: 1.506, color: 0xffe100 },
  { name: 'Green', n: 1.53, color: 0x0fd23a },
  { name: 'Blue', n: 1.553, color: 0x128cff },
  { name: 'Indigo', n: 1.577, color: 0x3a2bd8 },
  { name: 'Violet', n: 1.6, color: 0x9a1fe8 },
];
const PRISM = { side: 1.84, length: 2.5, baseY: 3.42, entry: 0.46, lampBack: 3.15, screenAt: 2.95, screenYaw: 0.72 };

// Vector Snell in the plane. I and N are unit, N facing against I.
function refract2(I, N, n1, n2) {
  const cosi = -(I[0] * N[0] + I[1] * N[1]);
  const eta = n1 / n2;
  const k = 1 - eta * eta * (1 - cosi * cosi);
  if (k < 0) return null;
  const c = eta * cosi - Math.sqrt(k);
  return [eta * I[0] + c * N[0], eta * I[1] + c * N[1]];
}

function prismLayout() {
  const { side, baseY, entry, screenAt } = PRISM;
  const h = (side * Math.sqrt(3)) / 2;
  const A = [-side / 2, baseY];
  const B = [side / 2, baseY];
  const C = [0, baseY + h];
  const leftN = [-Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]; // outward
  const rightN = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  const mid = (1.46 + 1.6) / 2;
  const i = Math.asin(mid * Math.sin(Math.PI / 6));
  const inA = i - Math.PI / 6; // above the horizontal, measured to +x
  const incoming = [Math.cos(inA), Math.sin(inA)];
  const E = [mix(A[0], C[0], entry), mix(A[1], C[1], entry)];
  const hitRight = (p, d) => {
    // The right face is the line through B and C.
    const ex = C[0] - B[0]; const ey = C[1] - B[1];
    const den = d[0] * -ey - d[1] * -ex;
    const t = ((B[0] - p[0]) * -ey - (B[1] - p[1]) * -ex) / den;
    return [p[0] + d[0] * t, p[1] + d[1] * t];
  };
  const inAngle = Math.atan2(incoming[1], incoming[0]);
  const rays = SPECTRUM.map((c) => {
    const inside = refract2(incoming, leftN, 1, c.n);
    const X = hitRight(E, inside);
    const out = refract2(inside, [-rightN[0], -rightN[1]], c.n, 1);
    const deviation = inAngle - Math.atan2(out[1], out[0]);
    return { ...c, inside, exit: X, out, deviation };
  });
  // The screen stands square to the middle of the fan. Yawing it about the line the fan lands on
  // moves no ray's landing point, because every ray lies in the plane that line is in.
  const midRay = rays[3];
  const centre = [midRay.exit[0] + midRay.out[0] * screenAt, midRay.exit[1] + midRay.out[1] * screenAt];
  for (const r of rays) {
    const t = ((centre[0] - r.exit[0]) * midRay.out[0] + (centre[1] - r.exit[1]) * midRay.out[1]) / (r.out[0] * midRay.out[0] + r.out[1] * midRay.out[1]);
    r.hit = [r.exit[0] + r.out[0] * t, r.exit[1] + r.out[1] * t];
  }
  return { A, B, C, E, incoming, inAngle, rays, centre, screenDir: midRay.out };
}

function glassPrism() {
  const layout = prismLayout();
  const { length, baseY, lampBack, screenYaw } = PRISM;
  const { A, B, C, E, incoming, inAngle, rays, centre, screenDir } = layout;
  const wood = [];
  const solid = [];
  const printed = [];
  const glass = [];
  const beams = [];
  const hz = length / 2;

  // --- The prism: a closed solid, its corners doubled so each face stays flat, its edges picked out
  // in opaque rods the way a real prism's polished edges catch the light.
  const tri = [A, A, B, B, C, C];
  const prismGeo = extrudeOutline(tri, length);
  glass.push({ geometry: prismGeo, color: 0xb8e6f6 });
  const EDGE = 0xdff6fa;
  const edgeR = 0.017;
  const verts = [A, B, C];
  for (let i = 0; i < 3; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % 3];
    for (const z of [-hz, hz]) {
      solid.push({ geometry: rod([p[0], p[1], z], [q[0], q[1], z], edgeR, { sides: 8 }), color: EDGE });
      solid.push({ geometry: ball(edgeR * 1.25, [p[0], p[1], z], { detail: 10 }), color: EDGE });
    }
    solid.push({ geometry: rod([p[0], p[1], -hz], [p[0], p[1], hz], edgeR, { sides: 8 }), color: EDGE });
  }

  // --- The beams. Every one is unlit, since it is the light. A ball at each bend closes the join.
  const WHITE = 0xfffdf4;
  const lampMouth = [E[0] - incoming[0] * (lampBack - 0.82), E[1] - incoming[1] * (lampBack - 0.82)];
  beams.push({ geometry: rod([lampMouth[0], lampMouth[1], 0], [E[0], E[1], 0], 0.03, { sides: 10 }), color: WHITE });
  beams.push({ geometry: ball(0.033, [E[0], E[1], 0], { detail: 10 }), color: WHITE });
  for (const r of rays) {
    beams.push({ geometry: rod([E[0], E[1], 0], [r.exit[0], r.exit[1], 0], 0.0165, { sides: 8 }), color: r.color });
    beams.push({ geometry: ball(0.0185, [r.exit[0], r.exit[1], 0], { detail: 8 }), color: r.color });
    beams.push({ geometry: rod([r.exit[0], r.exit[1], 0], [r.hit[0], r.hit[1], 0], 0.0185, { sides: 8 }), color: r.color });
  }

  // --- The screen. Its basis is worked out from the fan so each bar lands exactly where its ray does.
  const dirIn = V(-screenDir[0], -screenDir[1], 0);
  const normal = dirIn.clone().multiplyScalar(Math.cos(screenYaw)).add(V(0, 0, Math.sin(screenYaw))).normalize();
  const vAxis = V(screenDir[1], -screenDir[0], 0); // in the fan's plane, across the rays
  if (vAxis.y < 0) vAxis.negate();
  const uAxis = vAxis.clone().cross(normal).normalize();
  const basis = new THREE.Matrix4().makeBasis(uAxis, vAxis, normal);
  basis.setPosition(centre[0], centre[1], 0);
  const onScreen = (g) => g.applyMatrix4(basis);
  const vOf = (p) => (p[0] - centre[0]) * vAxis.x + (p[1] - centre[1]) * vAxis.y;
  const vs = rays.map((r) => vOf(r.hit));
  const vTop = vs[0];
  const vLow = vs[vs.length - 1];
  const cardW = 1.56;
  const cardH = vTop - vLow + 0.56;
  const cardMid = (vTop + vLow) / 2;
  const barU0 = -0.32;
  const barU1 = 0.32;
  const cardC = 0.24; // the card sits off to one side, so the names fit beside the bars
  const SIZE = 1024;
  const cardPx = SIZE / Math.max(cardW, cardH);
  const cardCanvas = atlasRegion(0, 0, Math.round(cardW * cardPx), Math.round(cardH * cardPx), SIZE);
  const card = canvasTexture(SIZE, SIZE, (ctx) => {
    ctx.fillStyle = '#f4f2e8';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const { w, h } = cardCanvas;
    const rowOf = (v) => (h / 2) - (v - cardMid) * cardPx;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const gaps = [];
    for (let i = 0; i < vs.length - 1; i++) gaps.push(vs[i] - vs[i + 1]);
    const px = Math.floor(Math.min(...gaps) * cardPx * 0.92);
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    rays.forEach((r, i) => {
      ctx.fillStyle = '#20242c';
      ctx.fillText(r.name, ((barU1 + 0.06 - cardC + cardW / 2) / cardW) * w, rowOf(vs[i]));
    });
  });
  const cardGeo = new THREE.BoxGeometry(cardW, cardH, 0.012).translate(cardC, cardMid, 0.016);
  {
    const p = cardGeo.attributes.position;
    const uv = cardGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, mix(cardCanvas.u0, cardCanvas.u1, (p.getX(i) - cardC) / cardW + 0.5), mix(cardCanvas.v0, cardCanvas.v1, (p.getY(i) - cardMid) / cardH + 0.5));
    }
  }
  printed.push({ geometry: onScreen(cardGeo), color: 0xffffff });
  solid.push({ geometry: onScreen(box(cardW + 0.1, cardH + 0.1, 0.04, [cardC, cardMid, 0])), color: 0x2b2f36 });
  rays.forEach((r, i) => {
    const up = i === 0 ? vs[0] + (vs[0] - vs[1]) / 2 : (vs[i - 1] + vs[i]) / 2;
    const down = i === vs.length - 1 ? vs[i] - (vs[i - 1] - vs[i]) / 2 : (vs[i] + vs[i + 1]) / 2;
    beams.push({ geometry: onScreen(box(barU1 - barU0, up - down, 0.006, [(barU0 + barU1) / 2, (up + down) / 2, 0.027])), color: r.color });
  });

  // --- The base: planks, then three posts rising to prism table, lamp and screen.
  const rng = seededRandom(3301);
  const baseTop = 0.32;
  for (let i = 0; i < 4; i++) {
    const z = -1.26 + i * 0.84;
    timber(wood, 0x8a5730, [-4.2, baseTop - 0.09, z], [4.2, baseTop - 0.09, z], 0.84, 0.18, { chamfer: 0.014, rng, jitter: 0.12 });
  }
  for (const x of [-3.7, 3.7]) timber(wood, 0x5c3719, [x, 0.07, -1.72], [x, 0.07, 1.72], 0.3, 0.14, { chamfer: 0.02, rng });

  const post = (x, z, y1, r = 0.075) => {
    solid.push({
      geometry: lathe([
        [0, baseTop], [r * 3.2, baseTop, 'c'], [r * 3.2, baseTop + 0.05, 'c'], [r * 2.3, baseTop + 0.09], [r * 1.5, baseTop + 0.16], [r * 1.06, baseTop + 0.3, 'c'],
        [r, baseTop + 0.32], [r, y1 - 0.2, 'c'], [r * 1.5, y1 - 0.15], [r * 1.5, y1 - 0.04, 'c'], [r * 1.1, y1, 'c'], [0, y1],
      ], { segments: 32 }).translate(x, 0, z),
      color: 0x32363d,
    });
  };

  // The prism's table on its central column, and two bronze cradles holding the ends.
  const tableT = 0.08;
  const tableY = baseY - 0.004 - tableT / 2;
  post(0, 0, tableY - tableT / 2 + 0.01, 0.12);
  solid.push({ geometry: box(PRISM.side + 0.34, tableT, length + 0.3, [0, tableY, 0]), color: 0x4a4f58 });
  solid.push({ geometry: box(PRISM.side + 0.46, 0.05, 0.46, [0, tableY - tableT / 2 - 0.02, 0]), color: 0x32363d });
  // Four bronze wedges hold it, each cut to the slope of the face it bears on.
  for (const z of [-hz + 0.2, hz - 0.2]) {
    for (const s of [-1, 1]) {
      const c = PRISM.side / 2;
      const rise = 0.13;
      const wedge = [[c + 0.17, baseY - 0.004], [c + 0.17, baseY + rise], [c - rise / Math.sqrt(3) + 0.004, baseY + rise], [c + 0.004, baseY - 0.004]];
      const pts = [];
      for (const [x, y] of wedge) pts.push([s * x, y], [s * x, y]);
      solid.push({ geometry: extrudeOutline(pts, 0.3).translate(0, 0, z), color: BRASS });
    }
  }

  // --- The lamp box, tilted to fire along the incoming beam. Everything goes through one matrix.
  const lampC = [E[0] - incoming[0] * lampBack, E[1] - incoming[1] * lampBack];
  const lampM = new THREE.Matrix4().makeRotationZ(inAngle).setPosition(lampC[0], lampC[1], 0);
  const onLamp = (g) => g.applyMatrix4(lampM);
  const BODY = 0x2d3f55;
  solid.push({ geometry: onLamp(box(0.92, 0.62, 0.6, [0, 0, 0])), color: BODY });
  solid.push({ geometry: onLamp(box(0.98, 0.05, 0.66, [0, 0.33, 0])), color: 0x1e2a3a });
  solid.push({ geometry: onLamp(box(0.98, 0.05, 0.66, [0, -0.33, 0])), color: 0x1e2a3a });
  for (let i = 0; i < 5; i++) {
    const x = -0.3 + i * 0.15;
    for (const s of [-1, 1]) solid.push({ geometry: onLamp(box(0.08, 0.34, 0.006, [x, 0.02, s * 0.303])), color: 0x0d1117 });
  }
  // The barrel, ending in a plate with the bright slit the beam leaves through.
  const barrelDir = V(1, 0, 0);
  solid.push({
    geometry: onLamp(aimed(lathe([[0, 0], [0.17, 0, 'c'], [0.17, 0.3, 'c'], [0.2, 0.32], [0.2, 0.36, 'c'], [0, 0.36]], { segments: 28 }), [0.46, 0, 0], barrelDir)),
    color: BRASS,
  });
  solid.push({ geometry: onLamp(aimed(lathe([[0, 0], [0.12, 0, 'c'], [0.12, 0.004, 'c'], [0, 0.004]], { segments: 22 }), [0.82, 0, 0], barrelDir)), color: 0x101216 });
  beams.push({ geometry: onLamp(aimed(lathe([[0, 0], [0.05, 0, 'c'], [0.05, 0.006, 'c'], [0, 0.006]], { segments: 18 }), [0.822, 0, 0], barrelDir)), color: 0xfff7cf });
  // Vents on the top, a knob on the side.
  solid.push({ geometry: onLamp(lathe([[0, 0], [0.09, 0, 'c'], [0.09, 0.05], [0.07, 0.07], [0, 0.075]], { segments: 18 }).rotateX(Math.PI / 2).translate(0.22, -0.16, 0.302)), color: 0xb3241b });
  // The yoke and the post under it.
  const yokeBelow = V(0, -0.36, 0).applyMatrix4(lampM);
  post(yokeBelow.x, 0, yokeBelow.y - 0.02, 0.07);
  solid.push({ geometry: ball(0.12, [yokeBelow.x, yokeBelow.y - 0.02, 0], { detail: 16 }), color: 0x32363d });
  // The flex: from the back of the box, down and into the base.
  const backOf = V(-0.46, -0.12, 0).applyMatrix4(lampM);
  solid.push({
    geometry: tube([[backOf.x + 0.02, backOf.y, 0], [backOf.x - 0.22, backOf.y - 0.14, 0.03], [backOf.x - 0.3, 1.6, 0.14], [backOf.x - 0.12, 0.7, 0.3], [backOf.x + 0.1, baseTop + 0.03, 0.42]], 0.028, { sides: 8, steps: 40 }),
    color: 0x17181a,
  });
  solid.push({ geometry: lathe([[0, 0], [0.09, 0, 'c'], [0.09, 0.03], [0.05, 0.05], [0, 0.05]], { segments: 16 }).translate(backOf.x + 0.1, baseTop, 0.42), color: 0x17181a });

  // --- The screen's post, under its frame.
  const lowest = V(0, cardMid - cardH / 2 - 0.05, 0).applyMatrix4(basis);
  post(lowest.x, lowest.z, lowest.y + 0.02, 0.07);
  solid.push({ geometry: ball(0.11, [lowest.x, lowest.y, lowest.z], { detail: 14 }), color: 0x32363d });

  const grain = grainMaps({ seed: 505, knots: 2, strength: 0.35 });
  const lightMesh = unlitMesh(beams);
  return group(
    mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.6, metalness: 0, ...grain })),
    solidMesh(solid, { roughness: 0.36, metalness: 0.16 }),
    mesh(mergeParts(printed), standard({ map: card, roughness: 0.85, metalness: 0 })),
    glassMesh(glass, { opacity: 0.36 }),
    lightMesh,
  );
}

// ---------------------------------------------------------------------------
// Pulley system
// ---------------------------------------------------------------------------

// A four-part tackle laid out in ONE PLANE, on purpose. A real double block has its two wheels side
// by side on one pin, and from the front one wheel hides the other and the ropes overlap, which is no
// use to anybody counting them. Here all four wheels are in the plane z = 0. The rope's path then
// gives the wheels' positions: it leaves one wheel on a tangent straight into the next one's, so with
// every wheel's rope radius Rc the vertical runs are exactly 2Rc apart and all four are truly parallel,
// which is what makes the mechanical advantage exactly four rather than nearly.
//
//   the becket ... -4Rc   (fixed to the upper block)
//   L1 at -3Rc under, up -2Rc, U1 at -Rc over, down 0, L2 at +Rc under, up +2Rc, U2 at +3Rc over,
//   down +4Rc to the hand.
//
// Four equal tensions at -4, -2, 0, +2 Rc balance at -Rc, so that is where the lower block's load
// hangs. Five at -4..+4 Rc balance at 0, so that is where the upper block hangs from the beam.
const WEIGHT_R = 0.55;
const PULLEY = {
  Rc: 0.45, ropeR: 0.06, upperY: 7.25, lowerY: 3.2, gripY: 3.04, frameX: 2.95, ridgeY: 8.7, footZ: 2.32,
};

function pulleyLayout() {
  const { Rc, ropeR, upperY, lowerY, gripY } = PULLEY;
  const wheels = {
    L1: { x: -3 * Rc, y: lowerY, over: false },
    U1: { x: -Rc, y: upperY, over: true },
    L2: { x: Rc, y: lowerY, over: false },
    U2: { x: 3 * Rc, y: upperY, over: true },
  };
  const beck = { x: -4 * Rc + 0.1, y: upperY + 0.22, r: 0.1 };
  // The centre line, in order: seized tail, round the becket pin, then each span and wheel.
  const path = [];
  const line = (x, y) => path.push([x, y, 0]);
  line(-4 * Rc + 0.155, beck.y - 0.5);
  line(-4 * Rc + 0.2, beck.y);
  for (let i = 1; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    line(beck.x + Math.cos(a) * beck.r, beck.y + Math.sin(a) * beck.r);
  }
  const arcOf = (w, n = 24) => {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // Always travelling left tangent to right tangent: under a lower wheel, over an upper one.
      const a = w.over ? Math.PI - t * Math.PI : Math.PI + t * Math.PI;
      line(w.x + Math.cos(a) * Rc, w.y + Math.sin(a) * Rc);
    }
  };
  arcOf(wheels.L1);
  arcOf(wheels.U1);
  arcOf(wheels.L2);
  arcOf(wheels.U2);
  line(4 * Rc, gripY);
  // The runs that hold up the lower block: from its wheels up to the upper block.
  const holding = [-4 * Rc, -2 * Rc, 0, 2 * Rc];
  return {
    weightCubicFeet: weightOutline(1.12).reduce((v, [r, y], i, all) => {
      if (!i) return v;
      const [r0, y0] = all[i - 1];
      return v + (Math.PI * Math.abs(y - y0) * (r * r + r * r0 + r0 * r0)) / 3;
    }, 0),
    wheels, path, holding, free: 4 * Rc, Rc, ropeR, loadX: holding.reduce((s, x) => s + x, 0) / holding.length,
    hangX: [...holding, 4 * Rc].reduce((s, x) => s + x, 0) / 5,
  };
}

// A rope swept along a planar path, with texture coordinates running along it and round it, which
// is what lets a tile of one strand wrap into a three-strand lay. Normals are the radial directions.
function ropeGeometry(path, r, { sides = 14, strands = 3 } = {}) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const P = path.map((p) => V(p[0], p[1], p[2]));
  const circumference = 2 * Math.PI * r;
  const lenPerTile = circumference / strands; // one tile along per strand gives a 45 degree lay
  const Z = V(0, 0, 1);
  // The ends shrink to a point over a short run so the rope is a closed solid.
  const n = P.length;
  const rows = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    if (i) run += P[i].distanceTo(P[i - 1]);
    const t = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]).normalize();
    rows.push({ p: P[i], t, run, r });
  }
  const capOf = (row, dir) => [0.86, 0.5, 0.001].map((k) => ({ p: row.p.clone().addScaledVector(row.t, dir * r * (1 - k * k) ** 0.5), t: row.t, run: row.run + dir * r * 0.5, r: r * k }));
  const all = [...capOf(rows[0], -1).reverse(), ...rows, ...capOf(rows[n - 1], 1)];
  const ring = sides + 1;
  all.forEach((row) => {
    const side = new THREE.Vector3().crossVectors(row.t, Z).normalize();
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = side.x * c + Z.x * s; const ny = side.y * c + Z.y * s; const nz = side.z * c + Z.z * s;
      positions.push(row.p.x + nx * row.r, row.p.y + ny * row.r, row.p.z + nz * row.r);
      normals.push(nx, ny, nz);
      uvs.push((j / sides) * strands, row.run / lenPerTile);
    }
  });
  for (let i = 0; i < all.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const c = a + ring + 1;
      const d = a + ring;
      indices.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

// One strand of a laid rope: a diagonal band with a dark crease either side and fibres along it. It
// tiles both ways, because the crease leaves one corner exactly as it enters the opposite one.
function ropeMaps() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(2718);
  ctx.fillStyle = '#d9b777';
  ctx.fillRect(0, 0, S, S);
  const diag = (offset, width, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(offset - S, S * 2);
    ctx.lineTo(offset + S * 2 - S, S * -1 + S * 0);
    ctx.stroke();
  };
  for (const off of [-S, 0, S, 2 * S]) {
    // Each band: a lit crown down the middle, then dark at the crease.
    diag(off + S * 0.5, 44, 'rgba(240,214,160,0.75)');
    diag(off, 13, 'rgba(84,58,26,0.95)');
    diag(off, 26, 'rgba(120,88,44,0.42)');
  }
  for (let i = 0; i < 70; i++) {
    const off = rng() * S * 2 - S * 0.5;
    const k = 150 + Math.round(rng() * 80);
    diag(off, 0.7 + rng() * 0.8, `rgba(${k},${k - 24},${k - 66},0.3)`);
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: 0.9 };
}

// A sheave about +Z. The groove is a U sampled across the rim, cut so the rope's centre line rides
// exactly at Rc: the bottom of the groove is Rc less the rope's radius, and it touches rather than cuts.
function sheave(x, y, list, { Rc, ropeR }) {
  const rg = Rc - ropeR + 0.002;
  const Rf = Rc - 0.004; // below the rope's centre line, so half the rope stands proud to be seen
  const w = 0.125;
  const groove = 0.082;
  const rows = [
    [0, -0.15], [0.105, -0.15, 'c'], [0.105, -0.06, 'c'], [0.29, -0.06, 'c'], [0.31, -w, 'c'], [Rf - 0.012, -w], [Rf, -w + 0.012], [Rf, -groove - 0.006, 'c'],
  ];
  const N = 12;
  for (let i = 0; i <= N; i++) {
    const t = -1 + (i / N) * 2;
    rows.push([rg + (Rf - rg) * Math.abs(t) ** 2.4, t * groove]);
  }
  rows.push([Rf, groove + 0.006, 'c'], [Rf, w - 0.012], [Rf - 0.012, w], [0.31, w, 'c'], [0.29, 0.06, 'c'], [0.105, 0.06, 'c'], [0.105, 0.15, 'c'], [0, 0.15]);
  const wheel = aimed(lathe(rows, { segments: 64 }), [x, y, 0], V(0, 0, 1));
  list.push({ geometry: wheel, color: 0xb98a36 });
  // Five lightening holes, each a dark disc in a raised ring, on both faces of the web.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const hx = x + Math.cos(a) * 0.2;
    const hy = y + Math.sin(a) * 0.2;
    for (const s of [-1, 1]) {
      const disc = lathe([[0, 0], [0.056, 0, 'c'], [0.056, 0.003, 'c'], [0, 0.003]], { segments: 14 });
      list.push({ geometry: aimed(disc, [hx, hy, s * 0.06], V(0, 0, s)), color: 0x1f160a });
    }
  }
}

function pointsOutline(list) {
  const s = new THREE.Shape();
  list.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

// One cheek of a block: a board that stops at the axle line on the side the ropes leave from, with a
// window cut for each wheel on the side the rope wraps. So every wheel is held between two cheeks and
// the whole of the rope can still be followed. Real holes, by ExtrudeGeometry, since there is no CSG.
function cheekPlate(x0, x1, y0, y1, wheelsAt, rh, z, side, extraHole = null) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const shape = pointsOutline(corners((x1 - x0) / 2, (y1 - y0) / 2, 0.06, 4).map(([a, b]) => [a + cx, b + cy]));
  const bar = 0.085;
  const start = Math.asin(bar / rh);
  for (const w of wheelsAt) {
    for (const s of [side]) {
      const hole = new THREE.Path();
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const a = start + (i / n) * (Math.PI - 2 * start);
        const hx = w.x + Math.cos(a) * rh;
        const hy = w.y + s * Math.sin(a) * rh;
        if (i) hole.lineTo(hx, hy);
        else hole.moveTo(hx, hy);
      }
      hole.closePath();
      shape.holes.push(hole);
    }
  }
  if (extraHole) {
    const hole = new THREE.Path();
    hole.absarc(extraHole.x, extraHole.y, extraHole.r, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, z - 0.045);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.7, uv.getX(i) * 0.35);
  return g;
}

function axle(list, x, y) {
  list.push({ geometry: rod([x, y, -0.3], [x, y, 0.3], 0.048, { sides: 14 }), color: 0x6e727a });
  for (const s of [-1, 1]) {
    list.push({ geometry: aimed(lathe([[0, 0], [0.1, 0, 'c'], [0.1, 0.018, 'c'], [0, 0.018]], { segments: 18 }), [x, y, s * 0.24], V(0, 0, s)), color: 0x4a4e55 });
    list.push({ geometry: aimed(lathe([[0, 0], [0.078, 0, 'c'], [0.078, 0.05, 'c'], [0.05, 0.066], [0, 0.066]], { segments: 6 }), [x, y, s * 0.256], V(0, 0, s)), color: 0x3a3d43 });
  }
}

function boltThrough(list, x, y) {
  list.push({ geometry: rod([x, y, -0.27], [x, y, 0.27], 0.028, { sides: 10 }), color: 0x4a4e55 });
  for (const s of [-1, 1]) list.push({ geometry: ball(0.05, [x, y, s * 0.25], { detail: 10, squash: [1, 1, 0.55] }), color: 0x3a3d43 });
}

// An iron ring standing in the y-z plane, to thread through a hook that lies in the x-y plane.
function ironRing(list, x, y, R, w) {
  list.push({ geometry: aimed(lathe(ringProfile(R, 0, w, 10), { segments: 30 }), [x, y, 0], V(1, 0, 0)), color: 0x3e4148 });
}

function pulleySystem() {
  const layout = pulleyLayout();
  const { wheels, path, Rc, ropeR, loadX, hangX, free } = layout;
  const { upperY, lowerY, gripY, frameX, ridgeY, footZ } = PULLEY;
  const wood = [];
  const solid = [];
  const printed = [];
  const OAK = 0xb78a4f;
  const FRAME = 0x6f4a26;
  const rng = seededRandom(4411);
  const IRON_DARK = 0x3a3d43;

  // --- The A-frames: two, one at each end, each a pair of splayed legs on a sill, and a ridge beam
  // between them. A frame seen from the front is two posts, so the whole span stays clear to count
  // the rope against; from the side it is the A.
  const ridgeH = 0.56;
  const ridgeBottom = ridgeY - ridgeH / 2;
  timber(wood, FRAME, [-frameX - 0.45, ridgeY, 0], [frameX + 0.45, ridgeY, 0], 0.42, ridgeH, { chamfer: 0.03, rng });
  const legW = 0.34;
  const legAt = (y) => footZ * (1 - y / (ridgeBottom + 0.1));
  for (const x of [-frameX, frameX]) {
    timber(wood, 0x5e3d1e, [x, 0.17, -footZ - 0.75], [x, 0.17, footZ + 0.75], 0.42, 0.34, { chamfer: 0.03, rng });
    for (const s of [-1, 1]) {
      timber(wood, FRAME, [x, 0.3, s * legAt(0.3)], [x, ridgeBottom + 0.1, 0], legW, legW, { chamfer: 0.028, rng, up: [1, 0, 0] });
      // A diagonal brace from the leg to the sill, the other half of what stops a frame folding.
      timber(wood, 0x7a5228, [x, 2.65, s * legAt(2.65)], [x, 0.3, s * (footZ + 0.5)], 0.2, 0.24, { chamfer: 0.02, rng, up: [1, 0, 0] });
      // A knee from the leg up to the ridge, so the beam cannot rack along its length.
      const kneeLow = 6.9;
      timber(wood, 0x7a5228, [x, kneeLow, s * legAt(kneeLow)], [x - Math.sign(x) * 0.84, ridgeBottom + 0.02, s * 0.1], 0.2, 0.2, { chamfer: 0.02, rng });
      for (const [px, py, pz] of [[x, 0.42, s * legAt(0.42)], [x, 2.65, s * legAt(2.65)], [x, kneeLow, s * legAt(kneeLow)]]) {
        for (const e of [-1, 1]) solid.push({ geometry: ball(0.052, [px + e * (legW / 2 + 0.002), py, pz], { detail: 10, squash: [0.5, 1, 1] }), color: IRON_DARK });
      }
    }
    // The collar tie that makes each pair of legs an A.
    const tieY = 4.6;
    const tieZ = legAt(tieY) + 0.26;
    timber(wood, 0x7a5228, [x + 0.22, tieY, -tieZ], [x + 0.22, tieY, tieZ], 0.12, 0.34, { chamfer: 0.015, rng });
    timber(wood, 0x7a5228, [x - 0.22, tieY, -tieZ], [x - 0.22, tieY, tieZ], 0.12, 0.34, { chamfer: 0.015, rng });
    for (const s of [-1, 1]) solid.push({ geometry: rod([x - 0.32, tieY, s * legAt(tieY)], [x + 0.32, tieY, s * legAt(tieY)], 0.03, { sides: 10 }), color: IRON_DARK });
  }
  // Low stretchers front and back, tying the two sills together.
  for (const z of [-footZ - 0.35, footZ + 0.35]) {
    timber(wood, 0x5e3d1e, [-frameX, 0.1, z], [frameX, 0.1, z], 0.28, 0.2, { chamfer: 0.02, rng });
  }

  // --- The upper block.
  const Rf = Rc + ropeR;
  const rh = Rf + 0.04;
  const upperWheels = [wheels.U1, wheels.U2];
  const beck = { x: -4 * Rc + 0.1, y: upperY + 0.22 };
  const ux0 = -4 * Rc - 0.2;
  const ux1 = 4 * Rc + 0.2;
  const uy0 = upperY - 0.085;
  const uy1 = upperY + 0.66;
  for (const z of [-0.2, 0.2]) wood.push({ geometry: cheekPlate(ux0, ux1, uy0, uy1, upperWheels, rh, z, 1, { x: beck.x, y: beck.y, r: 0.2 }), color: OAK });
  for (const w of upperWheels) {
    sheave(w.x, w.y, solid, { Rc, ropeR });
    axle(solid, w.x, w.y);
  }
  // Spacers bolted through away from every rope. Nothing crosses z = 0 where a run goes through.
  for (const [x, y] of [[ux0 + 0.12, uy1 - 0.12], [hangX, uy1 - 0.1], [ux1 - 0.12, uy1 - 0.12], [hangX + Rc, uy1 - 0.08], [-3 * Rc, uy1 - 0.08]]) boltThrough(solid, x, y);
  // The becket pin the fixed end of the rope is made off round.
  solid.push({ geometry: rod([beck.x, beck.y, -0.27], [beck.x, beck.y, 0.27], 0.04, { sides: 14 }), color: 0x6e727a });
  for (const s of [-1, 1]) solid.push({ geometry: ball(0.06, [beck.x, beck.y, s * 0.25], { detail: 10, squash: [1, 1, 0.55] }), color: IRON_DARK });
  // Iron strap over the block, then a hook, then a ring through an eye under the beam.
  const hookR = 0.1;
  const hookW = 0.036;
  const ringW = 0.038;
  solid.push({ geometry: box(0.5, 0.05, 0.52, [hangX, uy1 + 0.015, 0]), color: IRON_DARK });
  solid.push({ geometry: lathe([[0, uy1], [0.09, uy1, 'c'], [0.09, uy1 + 0.11], [0.05, uy1 + 0.16], [0, uy1 + 0.17]], { segments: 16 }).translate(hangX - hookR, 0, 0), color: IRON_DARK });
  const hookCentreY = uy1 + 0.25;
  const hookPts = [[hangX - hookR, uy1 + 0.1, 0], [hangX - hookR, hookCentreY - 0.04, 0]];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI - (i / 12) * Math.PI * 1.25;
    hookPts.push([hangX + Math.cos(a) * hookR, hookCentreY + Math.sin(a) * hookR, 0]);
  }
  solid.push({ geometry: tube(hookPts, [hookW, hookW, hookW, hookW * 0.86, hookW * 0.5], { sides: 10, steps: 30 }), color: IRON_DARK });
  const ringR = 0.15;
  const topOfBowl = hookCentreY + hookR;
  // The ring's lowest wire lies under the hook's crown, pulled up against it.
  const ringCentre = topOfBowl - hookW - ringW + ringR;
  ironRing(solid, hangX, ringCentre, ringR, ringW);
  const eyeTop = ridgeBottom;
  solid.push({ geometry: box(0.36, 0.05, 0.3, [hangX, eyeTop + 0.015, 0]), color: IRON_DARK });
  solid.push({ geometry: rod([hangX, ringCentre + ringR - ringW * 0.5, 0], [hangX, eyeTop + 0.03, 0], 0.046, { sides: 10 }), color: IRON_DARK });
  solid.push({ geometry: ball(0.07, [hangX, ringCentre + ringR, 0], { detail: 10 }), color: IRON_DARK });

  // --- The lower block.
  const lowerWheels = [wheels.L1, wheels.L2];
  const lx0 = wheels.L1.x - Rf - 0.2;
  const lx1 = wheels.L2.x + Rf + 0.2;
  const ly0 = lowerY - 0.66;
  const ly1 = lowerY + 0.085;
  for (const z of [-0.2, 0.2]) wood.push({ geometry: cheekPlate(lx0, lx1, ly0, ly1, lowerWheels, rh, z, -1), color: OAK });
  for (const w of lowerWheels) {
    sheave(w.x, w.y, solid, { Rc, ropeR });
    axle(solid, w.x, w.y);
  }
  for (const [x, y] of [[loadX, ly0 + 0.1], [lx0 + 0.12, ly0 + 0.12], [lx1 - 0.12, ly0 + 0.12]]) boltThrough(solid, x, y);
  // Strap, hook and the ring the weight hangs from.
  solid.push({ geometry: box(0.5, 0.05, 0.52, [loadX, ly0 - 0.015, 0]), color: IRON_DARK });
  const lowHookY = ly0 - 0.28;
  const lowPts = [[loadX - hookR, ly0 - 0.02, 0], [loadX - hookR, lowHookY + 0.05, 0]];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI * 1.25;
    lowPts.push([loadX + Math.cos(a) * hookR, lowHookY + Math.sin(a) * hookR, 0]);
  }
  solid.push({ geometry: tube(lowPts, [hookW, hookW, hookW, hookW * 0.86, hookW * 0.5], { sides: 10, steps: 30 }), color: IRON_DARK });
  solid.push({ geometry: lathe([[0, -0.17], [0.05, -0.16], [0.09, -0.11], [0.09, 0], [0, 0]], { segments: 16 }).translate(loadX - hookR, ly0, 0), color: IRON_DARK });
  const bowlBottom = lowHookY - hookR;
  const wR = 0.16;
  const wW = 0.04;
  const weightRingY = bowlBottom + hookW + wW - wR;
  ironRing(solid, loadX, weightRingY, wR, wW);

  // --- The weight: cast iron, 400 lb. At about 450 lb per cubic foot this much iron really is about
  // that: the computed volume of this profile is in LAB2_LAYOUTS.pulley.
  const wTop = weightRingY - wR + 0.03;
  const weightProfile = weightOutline(wTop);
  const weight = lathe(weightProfile, { segments: 56 }).translate(loadX, 0, 0);
  solid.push({ geometry: weight, color: 0x3c3f45 });
  const WSIZE = 512;
  const faceRegion = atlasRegion(0, 0, WSIZE, 256, WSIZE);
  const weightLabel = canvasTexture(WSIZE, WSIZE, (ctx) => {
    ctx.fillStyle = '#34373c';
    ctx.fillRect(0, 0, WSIZE, WSIZE);
    ctx.fillStyle = '#f2efe2';
    const px = fitFont(ctx, '400 LB', WSIZE - 48, 180, (s) => `bold ${s}px Arial, Helvetica, sans-serif`);
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('400 LB', WSIZE / 2, 128);
  });
  const wBodyR = WEIGHT_R;
  const faceY0 = wTop - 0.72;
  const faceY1 = faceY0 + 0.4;
  for (const c of [0, Math.PI]) {
    printed.push({ geometry: revPatch(() => wBodyR, faceY0, faceY1, c - 0.78, c + 0.78, faceRegion, { nv: 1, nu: 22, lift: 0.004 }).translate(loadX, 0, 0), color: 0xffffff });
  }

  // --- The hand grip on the free end: a turned wooden T, with a brass ferrule on the rope.
  solid.push({
    geometry: lathe([[0, 0], [0.09, 0, 'c'], [0.09, 0.012], [0.078, 0.02], [0.078, 0.2], [0.09, 0.22, 'c'], [0, 0.22]], { segments: 18 }).translate(free, gripY - 0.15, 0),
    color: BRASS,
  });
  const gripLen = 0.72;
  const gripR = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    // A turned handle: swelling toward the middle, closed by a true round at each end.
    const end = Math.min(t, 1 - t) * gripLen;
    const body = 0.074 + 0.024 * Math.sin(Math.PI * t);
    const cap = end < body * 0.6 ? Math.sqrt(Math.max(0, 1 - (1 - end / (body * 0.6)) ** 2)) : 1;
    gripR.push([i === 0 || i === 24 ? 0 : body * cap, t * gripLen]);
  }
  wood.push({ geometry: aimed(lathe(gripR, { segments: 20 }), [free - gripLen / 2, gripY - 0.2, 0], V(1, 0, 0)), color: 0xb0692c });

  // --- The seizing where the rope's fixed end is bound back on itself.
  const seizeY = beck.y - 0.42;
  const seizeX = -4 * Rc + 0.08;
  for (let i = 0; i < 7; i++) {
    const y = seizeY + (i - 3) * 0.024;
    solid.push({ geometry: lathe(ringProfile(0.13, 0, 0.0135, 6), { segments: 20 }).scale(1.05, 1, 0.56).translate(seizeX, y, 0), color: 0x4a2d14 });
  }

  const grain = grainMaps({ seed: 88, knots: 3, strength: 0.4 });
  const rope = mesh(ropeGeometry(path, ropeR), standard({ roughness: 0.9, metalness: 0, ...ropeMaps() }));
  return group(
    mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.64, metalness: 0, ...grain })),
    solidMesh(solid, { roughness: 0.44, metalness: 0.2 }),
    mesh(mergeParts(printed), standard({ map: weightLabel, roughness: 0.6, metalness: 0.1 })),
    rope,
  );
}

function weightOutline(wTop) {
  const H = 1.12;
  const R = WEIGHT_R;
  const b = wTop - H;
  return [
    [0, b], [R - 0.05, b, 'c'], [R, b + 0.05], [R, wTop - 0.34], [R - 0.05, wTop - 0.24], [0.26, wTop - 0.12], [0.13, wTop - 0.04], [0.1, wTop + 0.03], [0.05, wTop + 0.06], [0, wTop + 0.06],
  ];
}

// ---------------------------------------------------------------------------

// The arithmetic behind each model, exported so it can be checked by something other than a picture.
export const LAB2_LAYOUTS = {
  glassware: glasswareLayout,
  circuit: circuitLayout,
  magnet: magnetLayout,
  filings: () => ({ painted: filingChains(seededRandom(5101), { chains: PAINTED_CHAINS, onLines: 0.62 }).reduce((n, c) => n + c.length, 0) }),
  prism: prismLayout,
  pulley: pulleyLayout,
};

export const BUILDERS = {
  'lab-glassware': () => labGlassware(),
  'simple-circuit': () => simpleCircuit(),
  'bar-magnet-field': () => barMagnetField(),
  'glass-prism': () => glassPrism(),
  'pulley-system': () => pulleySystem(),
};
