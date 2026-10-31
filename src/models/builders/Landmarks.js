// Builders for the Model Database's Landmarks entries: the Great Pyramid, the Parthenon and a
// medieval castle. Scale models a student walks round at waist-to-head height, so each one has
// to hold up from six feet away and from close above.
import * as THREE from 'three';
import {
  mergeParts, tintGeometry, smoothNoise3, revolve, extrudeOutline, solidSurface, solidLoft, grooveAt, smoothed,
} from '../../props/LoftKit.js';
import {
  seededRandom, canvasTexture, standard, mesh, group, relief,
} from '../../PropKit.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const smooth01 = (t) => { const k = clamp01(t); return k * k * (3 - 2 * k); };

// Vertex colours are LINEAR. Everything here goes through THREE.Color so a hex reads as the
// sRGB colour it looks like, and scaling afterwards is a scale of light rather than of paint.
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const times = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// A triangle soup with FACE normals and colours per corner. Coursed masonry is the one thing in
// this file where every face must be flat: a shared vertex at the lip of a step would average
// the riser's normal with the tread's, and a stack of pillowed courses reads as a pile of
// cushions. It also lets each block carry its own tone with a hard edge against its neighbour,
// which is most of what makes a course read as separate stones.
class Soup {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; }

  tri(a, b, c, ua, ub, uc, ca, cb, cc) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy; let ny = uz * vx - ux * vz; let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    nx /= len; ny /= len; nz /= len;
    this.p.push(...a, ...b, ...c);
    this.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.t.push(...ua, ...ub, ...uc);
    this.c.push(...ca, ...cb, ...cc);
  }

  // a, b, c, d counter-clockwise seen from outside.
  quad(a, b, c, d, uv, col) {
    const ca = col.length === 4 ? col : [col, col, col, col];
    this.tri(a, b, c, uv[0], uv[1], uv[2], ca[0], ca[1], ca[2]);
    this.tri(a, c, d, uv[0], uv[2], uv[3], ca[0], ca[2], ca[3]);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// A box whose UVs are laid out in FEET, so a tile lands at one size on every block. BoxGeometry's
// own 0..1 per face would stretch a whole tile over a merlon and a whole tile over a curtain wall.
function feetBox(w, h, d, rng = null, segW = 1, segH = 1) {
  const g = new THREE.BoxGeometry(w, h, d, segW, segH, 1);
  const uv = g.attributes.uv;
  const nor = g.attributes.normal;
  const ou = rng ? rng() * 40 : 0;
  const ov = rng ? rng() * 40 : 0;
  for (let i = 0; i < uv.count; i += 1) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const su = ax > 0.5 ? d : w;
    const sv = ay > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  }
  return g;
}

function stoneMaterial(tile, extras = {}) {
  return standard({
    vertexColors: true, map: tile, bumpMap: tile, bumpScale: 0.6, roughness: 0.94, metalness: 0, ...extras,
  });
}

function setRepeat(texture, feet, feetV = feet) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / feet, 1 / feetV);
  return texture;
}

// ---------------------------------------------------------------------------
// The Great Pyramid
// ---------------------------------------------------------------------------

// 1/24 of Khufu. 756ft on a side and 481ft as built gives 31.5 x 20.04; what stands today stops
// about 26ft short of that, so the courses stop at 455ft (18.95ft here) and a mast rises from the
// summit platform to the original apex, as the survey mast put up in 1874 does.
//
// Every course is a real ring of stone in plan. Its outline wanders in and out a run of blocks at
// a time and is eaten away at the corners, so a missing block is an actual notch, not a painted
// patch, and the entrance sits in a recess that truly goes back into the pyramid.
//
// KHUFU HAS ALMOST NO CASING LEFT. The patch of smooth white stone people picture at the summit
// is Khafre's pyramid next door. What is here is the stepped core, plus the handful of casing
// stones that survive at the foot of the north face, found by Howard Vyse in 1837.
const PYR = {
  BASE_Y: 0.25,
  HALF: 15.75, // half of 756ft / 24: the original casing line at the foot
  APEX: 20.04, // 481ft / 24
  TOP: 18.95, // 455ft / 24: where the stone stops today
  CORE_INSET: 0.25, // the core stands about 6ft (0.25 here) behind the lost casing
  SLOPE: Math.atan2(20.04, 15.75), // 51.84 degrees, the famous angle
};
const pyrCore = (y) => PYR.HALF * (1 - y / PYR.APEX) - PYR.CORE_INSET;

// Near-white so it multiplies safely with the vertex tone. Vertical joints only: a course is a
// geometric ring, so its horizontal joints are real, and a tile with horizontal lines would
// fight them. The joints run the full height of the tile and wobble periodically so it tiles.
function limestoneTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f4f0e8';
    ctx.fillRect(0, 0, w, h);
    const wrapped = (x, y, r) => {
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    // Broad pale and tan blotches: limestone is never one flat tone across a block.
    // Hundreds of faint small dabs rather than a few big ones: a large flat disc shows its edge.
    for (let i = 0; i < 2400; i += 1) {
      ctx.fillStyle = rng() > 0.5 ? `rgba(208,194,170,${0.04 + rng() * 0.07})` : `rgba(255,252,246,${0.05 + rng() * 0.08})`;
      wrapped(rng() * w, rng() * h, 2 + rng() * 9);
    }
    // Pits and fossil pocks, which is what weathered Tura and Giza stone actually shows.
    for (let i = 0; i < 2600; i += 1) {
      const v = 140 + rng() * 70;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.82},${0.12 + rng() * 0.3})`;
      wrapped(rng() * w, rng() * h, 0.4 + rng() * rng() * 1.5);
    }
    // Joints between blocks.
    const joints = 7;
    for (let j = 0; j < joints; j += 1) {
      const x0 = (((j + (rng() - 0.5) * 0.55) / joints) * 0.9 + 0.01) * w;
      const phase = rng() * Math.PI * 2;
      const amp = 2 + rng() * 5;
      ctx.lineWidth = 1.6 + rng() * 2;
      ctx.strokeStyle = `rgba(84,72,56,${0.45 + rng() * 0.4})`;
      for (const dx of [-w, 0, w]) {
        ctx.beginPath();
        for (let y = 0; y <= h; y += 16) {
          const x = x0 + dx + Math.sin((y / h) * Math.PI * 2 + phase) * amp;
          if (y === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  });
}

function pyramidOfGiza() {
  const rng = seededRandom(2560);
  const soup = new Soup();
  const { BASE_Y, TOP, SLOPE } = PYR;
  const STONE_DARK = lin(0x7d7059);
  const STONE_MID = lin(0x9a8d74);
  const STONE_PALE = lin(0xb2a68e);
  const SAND = lin(0xb5a27e);
  const FRESH = lin(0xbdb19b);

  // --- the courses: thinner going up, with the occasional thick course the real one has -------
  const heights = [];
  {
    let y = 0;
    while (y < TOP) {
      const t = y / TOP;
      let h = lerp(0.46, 0.165, Math.pow(t, 0.72));
      if (rng() < 0.1) h *= 1.42;
      h *= 0.92 + rng() * 0.16;
      heights.push(h);
      y += h;
    }
    const k = TOP / y;
    for (let i = 0; i < heights.length; i += 1) heights[i] *= k;
  }

  // --- where the face has been quarried back: one list of scars per side -----------------------
  const scars = [[], [], [], []];
  for (let s = 0; s < 4; s += 1) {
    const count = 9 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      const y = Math.pow(rng(), 1.5) * TOP * 0.82;
      const half = pyrCore(y);
      scars[s].push({
        a: (rng() * 2 - 1) * half * 0.86,
        y,
        ra: 0.7 + rng() * 2.6,
        ry: 0.5 + rng() * 1.5,
        depth: 0.22 + rng() * 0.4,
      });
    }
  }
  // The north face (side 0, +Z). The Descending Passage opens about 56ft up and 24ft east of the
  // axis, which is x = -1 here since east is -X when north is +Z. Below it and nearer the middle
  // is the rough tunnel attributed to the caliph al-Mamun, which is how visitors go in today.
  const ENTRANCE = { x: -1.0, y: 2.32 };
  const TUNNEL = { x: 0.35, y: 1.28 };
  scars[0].push({ a: ENTRANCE.x, y: ENTRANCE.y + 0.1, ra: 1.0, ry: 0.85, depth: 0.7 });
  scars[0].push({ a: TUNNEL.x, y: TUNNEL.y, ra: 0.75, ry: 0.65, depth: 0.85 });
  const insetAt = (side, a, y) => {
    let d = 0;
    for (const b of scars[side]) {
      const k = 1 - ((a - b.a) / b.ra) ** 2 - ((y - b.y) / b.ry) ** 2;
      if (k > 0) d = Math.max(d, b.depth * smooth01(k * 1.8));
    }
    return d;
  };
  // What is left of each scar on the course below, per foot of face. A scar may open up at once
  // going upward but can only close by about a tread a course, or the stone above it overhangs
  // open air, and from a 5ft eye line that underside is a black slot across the pyramid.
  const CELL = 0.2;
  const lastInset = [0, 1, 2, 3].map(() => new Float32Array(200));
  const cellOf = (a) => Math.max(0, Math.min(199, Math.floor((a + 20) / CELL)));
  // The two openings are real notches in the courses, stepped block by block, not dark plates.
  const holeHalfWidth = (x, y) => {
    let best = null;
    const mouth = Math.abs(y - (ENTRANCE.y - 0.03));
    if (mouth < 0.2) best = { x: ENTRANCE.x, w: 0.2 };
    const t = (y - TUNNEL.y) / 0.34;
    if (Math.abs(t) < 1 && Math.abs(x - TUNNEL.x) < 2) best = { x: TUNNEL.x, w: 0.36 * Math.sqrt(1 - t * t) + 0.04 * Math.sin(y * 31) };
    return best;
  };

  // --- corner loss. A chamfer in course i+1 has to be inside the chamfer in course i or the stone
  // overhangs at the arris, so a cut can jump up abruptly (a collapse) and only recover slowly. ---
  const cuts = [0.08, 0.08, 0.08, 0.08];

  const P = (side, a, o) => {
    if (side === 0) return [a, o];
    if (side === 1) return [o, -a];
    if (side === 2) return [-a, -o];
    return [-o, a];
  };

  let y0 = 0;
  for (let c = 0; c < heights.length; c += 1) {
    const h = heights[c];
    const y1 = y0 + h;
    const H = pyrCore(y0 + h / 2);
    const hNext = c + 1 < heights.length ? heights[c + 1] : h;
    const Hnext = c + 1 < heights.length ? pyrCore(y1 + hNext / 2) : H * 0.35;
    const treadD = H - Hnext;
    const nearTop = c > heights.length - 7;

    for (let k = 0; k < 4; k += 1) {
      const collapse = rng() < 0.12 ? 0.3 + rng() * rng() * 1.1 : 0.05 + rng() * 0.16;
      const floor = cuts[k] - treadD * 1.8;
      cuts[k] = Math.min(H * (nearTop ? 0.55 : 0.4), Math.max(collapse, floor));
    }

    // The outline, as runs of blocks sharing a face plane.
    const pts = [];
    const uRate = Math.sqrt(0.42 / h);
    const v0 = rng() * 7;
    for (let s = 0; s < 4; s += 1) {
      const prev = cuts[(s + 3) % 4];
      const next = cuts[s];
      const aStart = -H + prev;
      const aEnd = H - next;
      let a = aStart;
      const minRun = Math.max(0.3, h * 2.2);
      while (a < aEnd - 1e-3) {
        let b = a + minRun + rng() * rng() * h * 12;
        if (b > aEnd - minRun * 0.6) b = aEnd;
        // Cut the run at the edges of an opening, so the notch has square block-sized sides.
        const hole = s === 0 ? holeHalfWidth(0, y0 + h / 2) : null;
        if (hole) {
          for (const edge of [hole.x - hole.w, hole.x + hole.w]) {
            if (a < edge - 1e-3 && b > edge + 1e-3) b = edge;
          }
        }
        const mid = (a + b) / 2;
        const inHole = !!hole && Math.abs(mid - hole.x) < hole.w;
        let off = (rng() - 0.72) * treadD * 0.8;
        const roll = rng();
        const missing = roll < (y0 < 3 ? 0.13 : 0.075);
        if (missing) off = -treadD * (0.7 + rng() * 0.2);
        else if (roll > 0.95) off += treadD * 0.2;
        // Nest against the course below: see lastInset.
        let inset = insetAt(s, mid, y0 + h / 2);
        const cellA = cellOf(a);
        const cellB = cellOf(b);
        for (let cell = cellA; cell <= cellB; cell += 1) inset = Math.max(inset, lastInset[s][cell] - treadD * 0.85);
        // A scar dies out before the arris: the chamfer there stands on the full face line, and
        // a course below it cut back further would leave it hanging over open air.
        inset *= smooth01((H - Math.abs(mid) - 0.5) / 1.1);
        for (let cell = cellA; cell <= cellB; cell += 1) lastInset[s][cell] = inset;
        const out = H + off - inset - (inHole ? 0.75 : 0);

        const [mx, mz] = P(s, mid, out);
        const yy = y0 + BASE_Y;
        const broad = smoothNoise3(mx * 0.16 + 3, yy * 0.2, mz * 0.16 + 9);
        const streak = smoothNoise3(mid * 0.9 + s * 11, yy * 0.08, 2.5);
        const pick = clamp01(broad * 0.8 + streak * 0.5 - 0.15 + (rng() - 0.5) * 0.34);
        let tone = pick < 0.5 ? mix3(STONE_DARK, STONE_MID, pick * 2) : mix3(STONE_MID, STONE_PALE, (pick - 0.5) * 2);
        if (inset > 0.1) tone = mix3(tone, FRESH, clamp01(inset * 1.1));
        if (missing) tone = times(tone, 0.72);
        tone = times(tone, 0.94 + rng() * 0.14);
        if (inHole) tone = times(tone, 0.035);
        const [ax, az] = P(s, a, out);
        const [bx, bz] = P(s, b, out);
        pts.push({ x: ax, z: az, tone, dark: inHole }, { x: bx, z: bz, tone, dark: inHole });
        a = b;
      }
      // A chamfer across the corner, with one jag in it so it never reads as a clean bevel.
      const [ex, ez] = P(s, H - next, H);
      const [fx, fz] = P((s + 1) % 4, -H + next, H);
      // The jag is a fixed fraction of a tread, not of the radius: scaled with the radius it cuts
      // far enough in at the foot of the pyramid to leave the course above hanging in the air.
      const jag = 0.3 + rng() * 0.4;
      const jx = lerp(ex, fx, jag);
      const jz = lerp(ez, fz, jag);
      const jr = Math.hypot(jx, jz) || 1;
      const pull = rng() * treadD * 0.5;
      const cTone = times(mix3(STONE_DARK, FRESH, rng() * 0.6), 0.86 + rng() * 0.16);
      pts.push({ x: ex, z: ez, tone: cTone }, { x: jx - (jx / jr) * pull, z: jz - (jz / jr) * pull, tone: cTone });
    }

    // Risers, treads, the underside of any overhang, and the hidden cap under the next course.
    const n = pts.length;
    let run = rng() * 60;
    const yA = y0 + BASE_Y;
    const yB = y1 + BASE_Y;
    const ringIn = [];
    for (let k = 0; k < n; k += 1) {
      const p = pts[k];
      const m = Math.max(Math.abs(p.x), Math.abs(p.z)) || 1;
      const target = Math.min(m - 0.01, Hnext - 0.012);
      const sc = Math.max(0.02, target / m);
      ringIn.push({ x: p.x * sc, z: p.z * sc });
    }
    for (let k = 0; k < n; k += 1) {
      const p = pts[k];
      const q = pts[(k + 1) % n];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 1e-4) continue;
      const u1 = run * uRate;
      const u2 = (run + len) * uRate;
      const riserLow = times(p.tone, 0.56);
      const riserHigh = times(p.tone, 1.04);
      soup.quad(
        [p.x, yA, p.z], [q.x, yA, q.z], [q.x, yB, q.z], [p.x, yB, p.z],
        [[u1, v0], [u2, v0], [u2, v0 + h], [u1, v0 + h]],
        [riserLow, riserLow, riserHigh, riserHigh],
      );
      const a = ringIn[k];
      const b = ringIn[(k + 1) % n];
      const lip = p.dark ? p.tone : mix3(p.tone, SAND, 0.42);
      const da = Math.hypot(p.x - a.x, p.z - a.z);
      const db = Math.hypot(q.x - b.x, q.z - b.z);
      // Contact shadow in the back of the tread, except where a scar has made the tread so deep
      // that its back is out in the light.
      const lipBright = times(lip, 1.08);
      const lipDark = times(lip, lerp(0.52, 0.92, clamp01((Math.max(da, db) - 0.3) / 0.5)));
      soup.quad(
        [p.x, yB, p.z], [q.x, yB, q.z], [b.x, yB, b.z], [a.x, yB, a.z],
        [[u1, v0 + h], [u2, v0 + h], [u2, v0 + h + db], [u1, v0 + h + da]],
        [lipBright, lipBright, lipDark, lipDark],
      );
      // Closing both ends: the underside shows wherever a course above a scar overhangs it.
      const under = times(p.tone, 0.5);
      soup.tri([0, yA, 0], [q.x, yA, q.z], [p.x, yA, p.z], [0, 0], [u2, v0], [u1, v0], under, under, under);
      soup.tri([0, yB, 0], [a.x, yB, a.z], [b.x, yB, b.z], [0, 0], [u1, v0], [u2, v0], under, under, under);
      run += len;
    }
    y0 = y1;
  }

  const parts = [{ geometry: soup.geometry(), keepColor: true }];

  // --- the summit: a platform of broken courses and loose blocks ------------------------------
  const topY = TOP + BASE_Y;
  const topHalf = pyrCore(TOP);
  for (let i = 0; i < 13; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * topHalf * 0.95;
    const s = 0.12 + rng() * 0.2;
    parts.push({
      geometry: feetBox(s * 1.5, s * 0.7, s, rng),
      color: new THREE.Color().setRGB(...times(mix3(STONE_MID, STONE_PALE, rng()), 0.9)).getHex(),
      position: [Math.cos(a) * r, topY - 0.02 + s * 0.3, Math.sin(a) * r],
      rotation: [(rng() - 0.5) * 0.3, rng() * 3, (rng() - 0.5) * 0.3],
    });
  }
  // The survey mast, standing at the summit to the height of the original apex.
  const MAST_TOP = PYR.APEX + BASE_Y;
  const timber = 0x3f3226;
  parts.push({
    geometry: new THREE.CylinderGeometry(0.018, 0.03, MAST_TOP - topY + 0.2, 7), color: timber,
    position: [0, (MAST_TOP + topY - 0.2) / 2, 0],
  });
  parts.push({ geometry: new THREE.CylinderGeometry(0.1, 0.13, 0.12, 8), color: 0x77694f, position: [0, topY + 0.04, 0] });

  // --- the two ways in, built in the plane of the recessed face -------------------------------
  // Local frame on the north face: X along the face, Y up the slope, Z out of it.
  const faceFrame = (x, y, back) => {
    const m = new THREE.Matrix4();
    const lean = Math.PI / 2 - SLOPE;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -lean);
    const pos = new THREE.Vector3(x, y + BASE_Y, pyrCore(y) - back);
    m.compose(pos, q, new THREE.Vector3(1, 1, 1));
    return m;
  };
  const onFace = (frame, geometry, color, at, rotZ = 0) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(at[0], at[1], at[2]),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ),
      new THREE.Vector3(1, 1, 1),
    );
    const g = geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(frame, m));
    parts.push({ geometry: g, color });
  };

  // The Descending Passage opens under great limestone chevrons, two pairs leaning together
  // into a gable. They are the most-photographed stones on the north face, and they lie in the
  // plane of the recess the courses already leave round the mouth.
  {
    const frame = faceFrame(ENTRANCE.x, ENTRANCE.y, 0.6);
    const pale = 0x9e917a;
    const paler = 0x8f826c;
    onFace(frame, feetBox(0.8, 0.17, 0.5, rng), pale, [0, 0.27, 0.02]);
    for (const [rise, len, thick, depth] of [[0.36, 0.74, 0.2, 0.56], [0.6, 1.0, 0.24, 0.62]]) {
      for (const side of [-1, 1]) {
        onFace(frame, feetBox(len, thick, depth, rng), side < 0 ? pale : paler,
          [side * len * 0.42, rise + len * 0.19, 0.08], side * -0.52);
      }
    }
  }

  // --- the casing stones Vyse uncovered at the foot of the north face: true polished wedges ----
  {
    const heightCase = 0.3;
    const backZ = pyrCore(0.1) + 0.02;
    const frontZ = PYR.HALF;
    const topFront = frontZ - heightCase / Math.tan(SLOPE);
    const widths = [0.72, 0.64, 0.8, 0.7, 0.66];
    let x = 2.05;
    for (let i = 0; i < widths.length; i += 1) {
      const w = widths[i];
      const tone = times(lin(0xcabfa8), 0.94 + rng() * 0.08);
      const dark = times(tone, 0.72);
      const s = new Soup();
      const gap = 0.012;
      const xa = x + gap;
      const xb = x + w - gap;
      const y0c = BASE_Y - 0.02;
      const y1c = BASE_Y + heightCase;
      // The tile leaves its last twelfth free of joints for exactly this: a casing stone is one
      // block, and its only joints are the real gaps between them.
      const f = (u, v) => [5.55 + u * 0.32 + i * 0.01, v * 0.5 + i];
      s.quad([xa, y0c, frontZ], [xb, y0c, frontZ], [xb, y1c, topFront], [xa, y1c, topFront], [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], [dark, dark, tone, tone]);
      s.quad([xa, y1c, topFront], [xb, y1c, topFront], [xb, y1c, backZ], [xa, y1c, backZ], [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], times(tone, 0.92));
      s.quad([xb, y0c, frontZ], [xb, y0c, backZ], [xb, y1c, backZ], [xb, y1c, topFront], [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], dark);
      s.quad([xa, y0c, backZ], [xa, y0c, frontZ], [xa, y1c, topFront], [xa, y1c, backZ], [f(0, 0), f(1, 0), f(1, 1), f(0, 1)], dark);
      parts.push({ geometry: s.geometry(), keepColor: true });
      x += w;
    }
    parts.push({
      geometry: feetBox(4.2, 0.08, 0.9, rng), color: 0xb5a584, position: [2.05 + 2.1, BASE_Y - 0.03, PYR.HALF - 0.12],
    });
  }

  // --- sand: a low plinth with a bank of debris against the foot ------------------------------
  const FOOT = pyrCore(0.1);
  const OUTER = 17.9;
  const bankAt = (x, z) => {
    const d = Math.max(Math.abs(x), Math.abs(z)) - FOOT;
    const face = Math.abs(x) > Math.abs(z) ? z : x;
    const lump = smoothNoise3(face * 0.22 + (Math.abs(x) > Math.abs(z) ? 7 : 19), 0.5, 3.2);
    const fine = smoothNoise3(x * 0.8, 1.7, z * 0.8);
    const peak = 0.45 + lump * lump * 1.5;
    const bank = peak * Math.exp(-Math.max(0, d) / 0.8);
    return BASE_Y + bank + (fine - 0.5) * 0.14 * smooth01(d / 0.6);
  };
  const noRubble = (x, z) => {
    // Keep the debris off the casing stones, which were dug clear to be seen.
    if (z > 0 && Math.abs(x - 4.15) < 2.5 && z > FOOT - 0.5 && z < FOOT + 1.7) return true;
    return false;
  };
  let sandGeometry;
  {
    const sectors = 196;
    const stationsS = [FOOT - 0.9, FOOT - 0.25, FOOT + 0.25, FOOT + 0.7, FOOT + 1.2, FOOT + 1.8, FOOT + 2.4, OUTER - 0.3, OUTER - 0.08, OUTER, OUTER];
    const positions = [];
    const uvs = [];
    const colours = [];
    const indices = [];
    const sandLight = lin(0xb7a27c);
    const sandDark = lin(0x8f7c5c);
    const debris = lin(0x8c8069);
    const ring = sectors + 1;
    for (let r = 0; r < stationsS.length; r += 1) {
      const s = stationsS[r];
      const power = lerp(48, 7, smooth01((s - FOOT) / (OUTER - FOOT)));
      for (let k = 0; k <= sectors; k += 1) {
        const th = (k % sectors) / sectors * Math.PI * 2;
        const sx = Math.sin(th);
        const cz = Math.cos(th);
        const rad = s / (Math.abs(sx) ** power + Math.abs(cz) ** power) ** (1 / power);
        const x = sx * rad;
        const z = cz * rad;
        let y;
        if (r === stationsS.length - 1) y = 0;
        else if (r === stationsS.length - 2) y = 0.06;
        else if (r === stationsS.length - 3) y = 0.18;
        else y = bankAt(x, z);
        if (noRubble(x, z)) y = Math.min(y, BASE_Y - 0.02);
        positions.push(x, y, z);
        uvs.push(x, z);
        const d = Math.max(Math.abs(x), Math.abs(z)) - FOOT;
        const n = smoothNoise3(x * 0.35, 4.4, z * 0.35) * 0.65 + smoothNoise3(x * 1.3, 8.1, z * 1.3) * 0.35;
        let c = mix3(sandDark, sandLight, clamp01(n * 1.3 - 0.05));
        c = mix3(c, debris, clamp01(1 - d / 1.6) * 0.65);
        colours.push(...c);
      }
    }
    for (let r = 0; r < stationsS.length - 1; r += 1) {
      for (let k = 0; k < sectors; k += 1) {
        const a = r * ring + k;
        const b = r * ring + k + 1;
        const c = (r + 1) * ring + k + 1;
        const d = (r + 1) * ring + k;
        indices.push(a, d, b, b, d, c);
      }
    }
    // The hidden floor, so the plinth is a closed solid.
    const centre = positions.length / 3;
    positions.push(0, 0, 0);
    uvs.push(0, 0);
    colours.push(0.1, 0.1, 0.1);
    const last = (stationsS.length - 1) * ring;
    for (let k = 0; k < sectors; k += 1) indices.push(centre, last + k + 1, last + k);
    const innerCentre = positions.length / 3;
    positions.push(0, BASE_Y - 0.05, 0);
    uvs.push(0, 0);
    colours.push(0.1, 0.1, 0.1);
    for (let k = 0; k < sectors; k += 1) indices.push(innerCentre, k, k + 1);
    sandGeometry = new THREE.BufferGeometry();
    sandGeometry.setIndex(indices);
    sandGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    sandGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sandGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    sandGeometry.computeVertexNormals();
    // Weld the wrapped seam so the plinth has no hard line down one side.
    const nor = sandGeometry.attributes.normal;
    for (let r = 0; r < stationsS.length; r += 1) {
      const a = r * ring;
      const b = a + sectors;
      const nx = nor.getX(a) + nor.getX(b);
      const ny = nor.getY(a) + nor.getY(b);
      const nz = nor.getZ(a) + nor.getZ(b);
      const len = Math.hypot(nx, ny, nz) || 1;
      nor.setXYZ(a, nx / len, ny / len, nz / len);
      nor.setXYZ(b, nx / len, ny / len, nz / len);
    }
  }

  // --- the rubble apron: dressed blocks that fell, thickest at the foot and at mid-face --------
  const rubbleTones = [0x9a8d74, 0x887b63, 0xaca08a, 0x7d7059, 0xbab09c];
  for (let i = 0; i < 560; i += 1) {
    const s = Math.floor(rng() * 4);
    const along = (rng() * 2 - 1) * (FOOT + 1.2);
    const spread = rng() * rng() * rng() * 2.6;
    const [x, z] = P(s, along, FOOT + 0.05 + spread);
    if (noRubble(x, z)) continue;
    const big = 1 - spread / 3;
    const size = (0.07 + rng() * rng() * 0.48) * (0.45 + big * 0.7);
    const sink = bankAt(x, z);
    const dressed = rng() < 0.72;
    const tone = rubbleTones[Math.floor(rng() * rubbleTones.length)];
    if (dressed) {
      parts.push({
        geometry: feetBox(size * (1 + rng() * 0.9), size * (0.5 + rng() * 0.5), size * (0.7 + rng() * 0.6), rng),
        color: tone,
        position: [x, sink + size * 0.04, z],
        rotation: [(rng() - 0.5) * 0.55, rng() * Math.PI, (rng() - 0.5) * 0.55],
      });
    } else {
      const g = new THREE.IcosahedronGeometry(size * 0.6, 0);
      const pos = g.attributes.position;
      const seed = rng() * 100;
      for (let v = 0; v < pos.count; v += 1) {
        const px = pos.getX(v); const py = pos.getY(v); const pz = pos.getZ(v);
        const m = 0.72 + 0.56 * smoothNoise3(px * 7 + seed, py * 7, pz * 7);
        pos.setXYZ(v, px * m * 1.2, py * m * 0.72, pz * m);
      }
      g.computeVertexNormals();
      const uvA = g.attributes.uv;
      for (let v = 0; v < uvA.count; v += 1) uvA.setXY(v, uvA.getX(v) * 0.6 + seed, uvA.getY(v) * 0.6);
      parts.push({ geometry: g, color: new THREE.Color(tone).multiplyScalar(0.72).getHex(), position: [x, sink, z], rotation: [rng() * 3, rng() * 3, rng() * 3] });
    }
  }

  // Gravel: a scatter of squashed chips pressed into the bank. Eight triangles apiece, and the
  // difference between a debris slope and a smooth dune with some boxes on it.
  const gravel = new THREE.OctahedronGeometry(1, 0);
  gravel.scale(1.25, 0.5, 1);
  for (let i = 0; i < 620; i += 1) {
    const s = Math.floor(rng() * 4);
    const along = (rng() * 2 - 1) * (FOOT + 1.8);
    const spread = rng() * rng() * 3.1 - 0.1;
    const [x, z] = P(s, along, FOOT + spread);
    if (noRubble(x, z)) continue;
    const size = 0.04 + rng() * rng() * 0.1;
    const shade = 0.62 + rng() * 0.36;
    const g = gravel.clone();
    g.scale(size, size, size);
    parts.push({
      geometry: g,
      color: new THREE.Color(rubbleTones[i % rubbleTones.length]).multiplyScalar(shade).getHex(),
      position: [x, bankAt(x, z) + size * 0.05, z],
      rotation: [(rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5],
    });
  }

  const stoneGeo = mergeParts(parts);
  const stone = mesh(stoneGeo, stoneMaterial(setRepeat(limestoneTile(11), 6), { bumpScale: 0.9 }));
  const sand = mesh(sandGeometry, standard({
    vertexColors: true, roughness: 1, ...relief('soil', { seed: 31, repeat: 1.1, strength: 1.2 }),
  }));
  sand.castShadow = false;
  return group(sand, stone);
}

// ---------------------------------------------------------------------------
// The Great Sphinx
// ---------------------------------------------------------------------------

// 1/12 of the real thing: 240ft nose-of-paw to tail, 66ft high and 62ft across the haunches gives
// 20 x 5.5 x 5.2. The face is at about 4.3ft, so a student looks it nearly in the eye.
//
// THE BODY IS BUILT IN HORIZONTAL SLICES, NOT LOFTED ROUND A SECTION. The Sphinx was cut out of a
// ridge of alternating hard and soft limestone, so its bands are strata: level in the world
// whatever the animal does underneath them. Every row of this grid lies at a fixed height with
// rows snapped to the band edges, which puts each groove exactly where it belongs and needs far
// fewer samples than a groove crossing a lofted section at an angle.
//
// THE HEAD IS ONE SURFACE TOO, face and headcloth together, so a seam between them cannot exist.
// A closed loft up Y whose section is a dense front sheet and a coarser back sheet: every lid,
// lip, stripe and fold is a displacement of that sheet.

// A table of [position, value] read as a smooth curve.
function curveTable(table) {
  return (at) => {
    const n = table.length;
    if (at <= table[0][0]) return table[0][1];
    if (at >= table[n - 1][0]) return table[n - 1][1];
    let i = 0;
    while (at > table[i + 1][0]) i += 1;
    const p0 = table[Math.max(0, i - 1)][1];
    const p1 = table[i][1];
    const p2 = table[i + 1][1];
    const p3 = table[Math.min(n - 1, i + 2)][1];
    const span = table[i + 1][0] - table[i][0];
    const f = (at - table[i][0]) / span;
    // Hermite with tangents scaled to the actual spacing, so uneven stations do not overshoot.
    const prevSpan = i > 0 ? table[i][0] - table[i - 1][0] : span;
    const nextSpan = i + 2 < n ? table[i + 2][0] - table[i + 1][0] : span;
    const m1 = ((p2 - p0) / (span + prevSpan)) * span;
    const m2 = ((p3 - p1) / (span + nextSpan)) * span;
    const f2 = f * f;
    const f3 = f2 * f;
    return (2 * f3 - 3 * f2 + 1) * p1 + (f3 - 2 * f2 + f) * m1 + (-2 * f3 + 3 * f2) * p2 + (f3 - f2) * m2;
  };
}

const bell = (x, centre, radius) => Math.exp(-(((x - centre) / radius) ** 2));
const between = (x, a, b, soft) => smooth01((x - a) / soft) * smooth01((b - x) / soft);

// Closed grid: `rows` rings of `cols` points each, wound outward when each ring runs
// counter-clockwise seen from above and the rows climb. Welded by position so a column or a row
// that has collapsed onto a ridge shades as one surface.
function ringGrid(rings, colourAt) {
  const rows = rings.length;
  const cols = rings[0].length;
  const positions = [];
  for (const ring of rings) for (const p of ring) positions.push(p[0], p[1], p[2]);
  const indices = [];
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const c2 = (c + 1) % cols;
      const a = r * cols + c;
      const b = r * cols + c2;
      const d = (r + 1) * cols + c2;
      const e = (r + 1) * cols + c;
      indices.push(a, b, d, a, d, e);
    }
  }
  const fan = (ringIndex, up) => {
    let mx = 0; let my = 0; let mz = 0;
    for (const p of rings[ringIndex]) { mx += p[0]; my += p[1]; mz += p[2]; }
    const centre = positions.length / 3;
    positions.push(mx / cols, my / cols, mz / cols);
    for (let c = 0; c < cols; c += 1) {
      const a = ringIndex * cols + c;
      const b = ringIndex * cols + (c + 1) % cols;
      if (up) indices.push(centre, a, b); else indices.push(centre, b, a);
    }
  };
  fan(0, false);
  fan(rows - 1, true);
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  raw.setIndex(indices);
  const g = smoothed(raw, 2e-4);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const c = colourAt(x, y, z);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    uv[i * 2] = x * 0.8 + z * 0.8;
    uv[i * 2 + 1] = y;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Near-white pitted limestone with no joints in it: the Sphinx is carved, not built.
function carvedTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f2eee6';
    ctx.fillRect(0, 0, w, h);
    const wrapped = (x, y, r) => {
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (let i = 0; i < 2600; i += 1) {
      ctx.fillStyle = rng() > 0.5 ? `rgba(204,190,166,${0.04 + rng() * 0.07})` : `rgba(255,252,246,${0.05 + rng() * 0.08})`;
      wrapped(rng() * w, rng() * h, 2 + rng() * 10);
    }
    for (let i = 0; i < 2800; i += 1) {
      const v = 120 + rng() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},${0.14 + rng() * 0.34})`;
      wrapped(rng() * w, rng() * h, 0.4 + rng() * rng() * 1.8);
    }
  });
}

// Small squared blocks: the forelegs and paws are cased in restoration masonry from antiquity
// onward, which is what they actually look like up close. Near-white, joints only.
function casingTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f0ece3';
    ctx.fillRect(0, 0, w, h);
    const courses = 8;
    const ch = h / courses;
    for (let r = 0; r < courses; r += 1) {
      let x = rng() * 40 - 40;
      const start = x;
      while (x < w + start) {
        const len = 44 + rng() * 60;
        const v = 225 + rng() * 28;
        ctx.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
        ctx.fillRect(x, r * ch, len, ch);
        x += len;
      }
      ctx.fillStyle = 'rgba(110,96,76,0.38)';
      ctx.fillRect(0, r * ch, w, 2);
      x = start;
      while (x < w + start) {
        const len = 44 + rng() * 60;
        ctx.fillRect(((x % w) + w) % w, r * ch, 2, ch);
        x += len;
      }
    }
    for (let i = 0; i < 1500; i += 1) {
      const v = 130 + rng() * 70;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.8},${0.16 + rng() * 0.3})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 2, 1 + rng() * 2);
    }
  });
}

const SPX = {
  BACK: 3.67, // 44ft / 12
  TOP: 5.5, // 66ft / 12
  CHIN: 3.34,
};

function sphinxBody(rng) {
  const HARD = lin(0xa89b82);
  const SOFT = lin(0x8a7c62);
  const halfWidth = curveTable([
    [-10.42, 0.12], [-10.3, 0.75], [-10.0, 1.3], [-9.5, 1.85], [-8.5, 2.22], [-7.1, 2.3], [-5.6, 2.1], [-4.2, 1.8], [-2.2, 1.66],
    [0, 1.7], [1.6, 1.9], [2.8, 1.98], [3.7, 1.92], [4.3, 1.84], [4.55, 1.62], [4.7, 1.2],
  ]);
  const ridge = curveTable([
    [-10.42, 0.45], [-10.3, 1.05], [-10.0, 1.8], [-9.6, 2.6], [-8.8, 3.3], [-7.6, 3.72], [-6.4, 3.72], [-4.4, 3.46], [-1.5, 3.46],
    [1.2, 3.64], [2.8, 3.76], [3.8, 3.72], [4.3, 3.6], [4.7, 3.3],
  ]);

  // The strata. Thicknesses vary by an order of magnitude in real rock; an even alternation of
  // equal bands would read as a beach umbrella.
  const bands = [];
  {
    let y = 0.02;
    let hard = true;
    while (y < 3.9) {
      const t = hard ? 0.24 + rng() * 0.26 : 0.09 + rng() * 0.16;
      bands.push({ y0: y, y1: y + t, hard, depth: hard ? 0 : 0.045 + rng() * 0.07 });
      y += t;
      hard = !hard;
    }
  }
  const bandAt = (y) => bands.find((b) => y <= b.y1) ?? bands[bands.length - 1];
  const rowsY = [];
  for (const b of bands) {
    const t = b.y1 - b.y0;
    rowsY.push(b.y0, b.y0 + t * 0.2, b.y0 + t * 0.5, b.y0 + t * 0.8);
  }
  for (let y = 2.9; y < 3.82; y += 0.08) rowsY.push(y);
  rowsY.sort((p, q) => p - q);
  const rows = rowsY.filter((y, i) => i === 0 || y - rowsY[i - 1] > 0.012);
  rows.push(3.86);

  // Haunch and shoulder are plateaus with an edge on them, not soft bumps. A lion's thigh reads
  // because of the line where it stops; a Gaussian has no line, and that is what a loaf is.
  const thighE = (z, y) => ((z + 7.0) / 2.5) ** 2 + ((y - 1.55) / 1.8) ** 2;
  const shoulderE = (z, y) => ((z - 2.2) / 1.45) ** 2 + ((y - 1.95) / 1.6) ** 2;

  const flank = (side, z, y) => {
    const top = ridge(z);
    const yy = Math.min(y, top);
    const v = clamp01(yy / top);
    if (v >= 0.9999) return { x: 0, y: top };
    const sf = (1 - v ** 2.7) ** (1 / 2.7);
    let w = halfWidth(z) * sf;
    const te = thighE(z, yy);
    w += (0.3 * smooth01((1 - te) / 0.2) + 0.2 * Math.max(0, 1 - te)) * sf;
    const se = shoulderE(z, yy);
    w += (0.17 * smooth01((1 - se) / 0.22) + 0.12 * Math.max(0, 1 - se)) * sf;
    // The flank draws in hard behind the ribs, and the ribs show faintly.
    w -= 0.16 * bell(z, -3.7, 0.9) * bell(yy, 1.4, 1.2) * sf;
    w += 0.022 * Math.sin(z * 3.6) * between(z, -3.0, 0.6, 0.7) * bell(yy, 2.0, 0.9) * sf;
    // The tail lies along the animal's right side, which is -X when it faces +Z.
    if (side < 0) w += 0.2 * between(z, -9.4, -3.9, 0.4) * bell(yy, 0.32 + (z + 9.4) * 0.012, 0.11);
    // The strata, with a slow wander so no groove is a ruled line.
    const b = bandAt(yy);
    if (!b.hard) {
      const profile = between(yy, b.y0, b.y1, Math.max(0.025, (b.y1 - b.y0) * 0.3));
      const wander = 0.55 + 0.8 * smoothNoise3(z * 0.42 + b.y0 * 9, b.y0 * 3, side);
      w -= b.depth * profile * wander * sf * smooth01((0.97 - v) / 0.12);
    }
    w += (smoothNoise3(z * 1.6 + side * 3, yy * 3.1, side * 7) - 0.5) * 0.08 * sf;
    return { x: Math.max(0, w), y: yy };
  };

  const stations = [];
  for (let z = -10.42; z < -9.2; z += 0.12) stations.push(z);
  for (let z = -9.2; z < 3.5; z += 0.46) stations.push(z);
  for (let z = 3.5; z < 4.6; z += 0.28) stations.push(z);
  stations.push(4.7);
  const rings = stations.map((z) => {
    const ring = [];
    for (let j = 0; j < rows.length; j += 1) { const f = flank(1, z, rows[j]); ring.push([f.x, f.y, z]); }
    for (let j = rows.length - 2; j >= 0; j -= 1) { const f = flank(-1, z, rows[j]); ring.push([-f.x, f.y, z]); }
    return ring;
  });
  const colourAt = (x, y, z) => {
    const b = bandAt(y);
    const n = smoothNoise3(x * 0.5 + 3, y * 0.9, z * 0.5);
    const top = Math.max(0.2, ridge(z));
    // Strata show on the flanks; along the back they are worn into one surface.
    // On the chest they run straight across, whatever the surface is doing behind them.
    const flankness = z > 3.7 ? smooth01((3.5 - y) / 0.2) : smooth01((0.93 - y / top) / 0.1);
    let c = mix3(HARD, SOFT, 0.08 + n * 0.32);
    if (!b.hard) c = mix3(c, times(mix3(SOFT, HARD, n * 0.28), 0.84), flankness);
    const edge = Math.min(y - b.y0, b.y1 - y);
    if (b.hard && edge < 0.03) c = times(c, lerp(1, 0.86, flankness));
    // The creases round the thigh and the shoulder.
    c = times(c, 1 - 0.2 * bell(thighE(z, y), 1.02, 0.12) - 0.15 * bell(shoulderE(z, y), 1.03, 0.14));
    // Darker low on the flank, where the sand has sat and blown.
    return times(c, lerp(0.86, 1, smooth01(y / 1.2)));
  };
  const trunk = ringGrid(rings, colourAt);

  // THE CHEST is its own surface, in the same horizontal rows. A body built in slices cannot close
  // its own front: every row above the falling ridge collapses onto the centre line, and that is a
  // fan of long triangles with a chevron of colour across the animal's chest. Standing the chest
  // up on its own rows lets the same strata run straight across it.
  const chestY = [];
  for (const b of bands) {
    const t = b.y1 - b.y0;
    if (b.y0 < 3.35) chestY.push(b.y0, b.y0 + t * 0.2, b.y0 + t * 0.8);
  }
  chestY.push(3.42);
  const chestFront = curveTable([[0, 4.92], [1, 4.96], [2, 4.96], [2.7, 4.88], [3.1, 4.72], [3.42, 4.4]]);
  // The same falling section as the flank, so the chest passes into the body instead of standing
  // proud of it down one edge.
  const chestHalf = curveTable([[0, 1.78], [1.5, 1.71], [2.6, 1.46], [3.1, 1.19], [3.42, 0.84]]);
  const COLS = 32;
  const chestRings = chestY.map((y) => {
    const ring = [];
    const hw = chestHalf(y);
    const front = chestFront(y);
    const b = bandAt(y);
    const cut = !b.hard ? b.depth * between(y, b.y0, b.y1, Math.max(0.025, (b.y1 - b.y0) * 0.3)) : 0;
    for (let k = 0; k <= COLS; k += 1) {
      const a = (k / COLS) * Math.PI;
      const x = -Math.cos(a) * hw;
      const wander = 0.55 + 0.8 * smoothNoise3(x * 0.6 + b.y0 * 9, b.y0 * 3, 2);
      const z = 3.9 + (front - 3.9) * Math.sin(a) ** 0.45 - 0.6 * cut * wander * Math.sin(a)
        + (smoothNoise3(x * 2.4, y * 3.1, 6) - 0.5) * 0.05 * Math.sin(a);
      ring.push([x, y, z]);
    }
    ring.push([0, y, 3.6]);
    return ring;
  });
  return mergeParts([
    { geometry: trunk, keepColor: true },
    { geometry: ringGrid(chestRings, colourAt), keepColor: true },
  ]);
}

// Face at (|x|, y): everything but the headcloth. Returns depth in z, with `ao` for how far down a
// crease the point is, which goes into the tint because a crease reads by being dark.
const faceWidth = curveTable([[3.25, 0.2], [3.42, 0.33], [3.68, 0.47], [4.0, 0.56], [4.4, 0.6], [4.78, 0.58]]);

function sphinxFace(ax, y) {
  const faceW = faceWidth(y);
  const q = Math.min(0.985, (ax / (faceW * 1.16)) ** 2);
  let z = 4.68 + 0.5 * Math.sqrt(1 - q);
  let ao = 0;
  // Forehead and brow: a heavy ridge following the eye out to the temple.
  z += 0.02 * bell(y, 4.66, 0.1);
  const EX = 0.27;
  const EY = 4.415;
  const dx = (ax - EX) / 0.158;
  const browLine = 4.545 + 0.028 * bell(ax, 0.25, 0.14) - 0.075 * smooth01((ax - 0.36) / 0.24);
  const brow = bell(y, browLine, 0.027) * bell(ax, 0.27, 0.27);
  z += 0.052 * brow;
  ao += 0.28 * bell(y, browLine - 0.04, 0.018) * bell(ax, 0.27, 0.24);
  // Eye sockets, then the eye sitting in the socket.
  const socket = bell(y, EY, 0.08) * bell(ax, EX, 0.2);
  z -= 0.085 * socket;
  ao += socket * 0.22 + 0.34 * bell(y, EY + 0.075, 0.018) * bell(ax, EX, 0.15);
  const lid = Math.max(0, 1 - dx * dx);
  const lidH = 0.066 * lid ** 0.6;
  const dy = y - (EY + 0.014 * dx);
  if (lidH > 1e-3) {
    const e = dy / lidH;
    if (Math.abs(e) < 1) {
      const ball = Math.sqrt(1 - e * e) * lid ** 0.5;
      z += 0.062 * ball;
      ao -= 0.34 * ball;
    }
    const upper = e > 0 ? 1 : 0.55;
    const rim = bell(Math.abs(e), 1.2, 0.28) * lid ** 0.25;
    z += 0.026 * rim * upper;
    ao += 0.85 * bell(Math.abs(e), 0.98, 0.17) * lid ** 0.2 * upper;
  }
  // The painted cosmetic line running out from the outer corner of the eye.
  const lineY = EY + 0.014 - (ax - EX - 0.158) * 0.12;
  const paint = bell(y, lineY, 0.012) * between(ax, EX + 0.13, EX + 0.31, 0.02);
  ao += 0.42 * paint;
  z -= 0.012 * paint;
  // Cheekbones and jaw.
  z += 0.035 * bell(y, 4.12, 0.2) * bell(ax, 0.38, 0.17);
  z -= 0.024 * bell(y, 3.82, 0.14) * bell(ax, 0.47, 0.11);
  // THE MISSING NOSE. The bridge survives down to about halfway; below that the stone has been
  // prised away, leaving a rough scar that widens downward, with the flanges of the two nostrils
  // clinging on either side of it. A clean recess here reads as a vent, not as a loss.
  const bridge = bell(ax, 0, 0.07 + (4.56 - y) * 0.09) * between(y, 4.3, 4.6, 0.05);
  z += 0.105 * bridge;
  const scarHalf = 0.065 + Math.max(0, 4.36 - y) * 0.36;
  const inScar = between(y, 3.965, 4.35, 0.022) * (1 - smooth01((ax - scarHalf) / 0.022));
  const rough = smoothNoise3(ax * 22, y * 22, 2) * 0.6 + smoothNoise3(ax * 60, y * 60, 5) * 0.4;
  z += 0.075 * bell(y, 4.05, 0.17) * bell(ax, 0, 0.22) * (1 - inScar);
  z -= inScar * (0.012 + 0.04 * rough);
  ao += inScar * (0.02 + 0.3 * (1 - rough) * (1 - rough));
  ao += 0.22 * bell(y, 4.352, 0.012) * (1 - smooth01((ax - 0.085) / 0.03));
  const flange = bell(ax, scarHalf + 0.035, 0.035) * bell(y, 4.03, 0.05);
  z += 0.06 * flange;
  ao += 0.45 * bell(y, 3.962, 0.014) * bell(ax, 0.15, 0.1);
  // Lips. A mouth about 7.6ft wide really, so 0.32 half-width here; the corners lift, which is
  // the faint smile people remark on, and the upper lip carries a real bow.
  const mouthY = 3.722 + 0.03 * (ax / 0.31) ** 2 - 0.009 * bell(ax, 0, 0.035);
  const inMouth = 1 - smooth01((ax - 0.285) / 0.045);
  z += 0.055 * bell(y, 3.775 + 0.012 * bell(ax, 0.07, 0.05), 0.04) * bell(ax, 0, 0.27);
  z -= 0.016 * bell(ax, 0, 0.024) * bell(y, 3.865, 0.05);
  z -= 0.03 * bell(y, mouthY, 0.012) * inMouth;
  ao += 0.9 * bell(y, mouthY, 0.011) * inMouth;
  z += 0.05 * bell(y, 3.67, 0.034) * bell(ax, 0, 0.21);
  z -= 0.032 * bell(y, 3.6, 0.028) * bell(ax, 0, 0.2);
  ao += 0.2 * bell(y, 3.6, 0.026) * bell(ax, 0, 0.19);
  z += 0.055 * bell(y, 3.47, 0.08) * bell(ax, 0, 0.17);
  // Creases from nose to mouth corner.
  const fold = Math.abs(ax - (0.22 + (3.98 - y) * 0.42));
  const inFold = between(y, 3.76, 3.97, 0.04);
  z -= 0.012 * bell(fold, 0, 0.02) * inFold;
  ao += 0.22 * bell(fold, 0, 0.022) * inFold;
  // The ear, standing clear in front of the wing of the headcloth, with a hollow in it.
  const earX = (ax - 0.688) / 0.062;
  const earY = (y - 4.22) / 0.2;
  const ear = earX * earX + earY * earY;
  if (ear < 1.6) {
    const e = smooth01((1.25 - ear) / 0.5);
    z += 0.05 * e;
    const hollow = smooth01((0.55 - ((ax - 0.684) / 0.034) ** 2 - ((y - 4.2) / 0.115) ** 2) / 0.4);
    z -= 0.045 * hollow;
    ao += 0.4 * hollow + 0.14 * smooth01((ear - 1.0) / 0.3);
  }
  // Four and a half thousand years of sand: pits, and the left cheek worse than the right.
  z += (smoothNoise3(ax * 13, y * 13, 4) - 0.5) * 0.014;
  // The jaw line: a curve from under the chin up to the ear, behind which everything rolls away.
  const jawLine = 3.37 + 0.5 * (ax / 0.6) ** 2.6;
  z -= 0.5 * smooth01((jawLine - y) / 0.09);
  return { z, ao: clamp01(ao) };
}

// The face stands this much higher than sphinxFace's own numbers were drawn at.
const FACE_LIFT = 0.15;

const hdHalf = curveTable([
  [2.0, 1.3], [3.0, 1.24], [3.5, 1.2], [3.72, 1.2], [3.88, 1.32], [4.02, 1.46], [5.0, 1.12],
  [5.38, 0.98], [5.47, 0.84], [5.5, 0.5],
]);
const hdEdge = curveTable([[2.0, 3.5], [3.75, 3.85], [4.0, 4.2], [4.75, 4.2], [5.25, 4.02], [5.5, 3.9]]);
const hdCrown = curveTable([[4.83, 5.215], [5.0, 5.13], [5.2, 4.98], [5.38, 4.72], [5.47, 4.46], [5.5, 4.2]]);
const hdBack = curveTable([[2.0, 2.2], [3.7, 2.4], [4.05, 2.95], [4.55, 3.2], [5.25, 3.46], [5.5, 3.85]]);

// One nemes stripe every STRIPE feet, on five rows. Rows are laid on this lattice so a row lands in
// every groove: the cloth is broad flat pleats with a narrow crease between them, and a pure sine
// at this sampling would read as a coil pot.
const STRIPE = 0.105;
const STRIPE_ROWS = 5;
const stripeGroove = (y) => (Math.abs(((y / STRIPE) % 1 + 1) % 1 - 0.5) < 0.09 ? 1 : 0);
const stripeTone = (y) => (Math.floor(y / STRIPE) % 2 === 0 ? 1 : 0.84);

function sphinxShellAt(x, y) {
  const ax = Math.abs(x);
  const yf = y - FACE_LIFT;
  const hw = hdHalf(y);
  const edge = hdEdge(y);
  const openTop = 4.72 - 0.11 * (ax / 0.78) ** 3;
  const openW = curveTable([[3.2, 0.3], [3.42, 0.46], [3.66, 0.7], [3.9, 0.77], [4.8, 0.78]])(yf);
  // A smooth minimum, so the corners of the opening are round: a hard min leaves a sharp little
  // tab of cloth standing at each temple.
  const smin = (a, b, k) => { const h = clamp01(0.5 + (0.5 * (b - a)) / k); return lerp(b, a, h) - k * h * (1 - h); };
  const dist = smin(smin(openW - ax, openTop - yf, 0.12), yf - 3.3, 0.1);
  const m = smooth01(dist / 0.09);

  const stripeFade = 1 - smooth01((y - 5.28) / 0.14);
  const onGroove = stripeGroove(y);
  let front;
  let stripeK;
  const r = Math.min(0.999, ax / hw);
  if (y >= 3.72) {
    const zf = y > 4.83 ? hdCrown(y) : lerp(5.2, 5.215, smooth01((y - 4.45) / 0.38));
    // The wings are flaps standing out from the head, so the front falls away almost straight.
    front = edge + (zf - edge) * (1 - r ** 1.5) ** 0.8;
    // Headband: a raised strip along the top of the opening, with the stump of the royal cobra
    // broken off in the middle of it.
    const band = between(yf - openTop, 0.0, 0.085, 0.012) * (1 - smooth01((ax - 0.6) / 0.3));
    front += 0.02 * band;
    front += 0.06 * bell(ax, 0, 0.05) * bell(yf, 4.76, 0.05);
    stripeK = stripeFade * (1 - band);
  } else {
    // Below the wings: the throat between two broad lappets lying on the chest. Both fade into
    // the chest rather than stopping, because a lappet that ends in a square is a table leg.
    const lapOuter = 0.92 - (3.72 - y) * 0.05;
    const lapInner = 0.42 + (3.72 - y) * 0.1;
    const fade = smooth01((y - 2.95) / 0.32);
    const lap = between(ax, lapInner, lapOuter, 0.09) * fade;
    // Under the lappets the shell dives inside the chest, so only the body's own surface shows.
    const chest = lerp(3.95, 4.62, smooth01((y - 2.75) / 0.6));
    const curve = (1 - r ** 3) ** 0.5;
    front = edge + (chest + 0.13 * lap + 0.07 * smooth01((y - 3.4) / 0.3) * lap - edge) * curve;
    stripeK = lap;
  }
  front -= 0.018 * stripeK * onGroove;
  front += (smoothNoise3(ax * 4.1, y * 4.1, 8) - 0.5) * 0.05 * (1 - m);
  // Inside the opening the shell drops well behind the face, whose patch fills it.
  const faceZ = 4.5 + 0.5 * Math.sqrt(Math.max(0, 1 - (ax / 0.9) ** 2));
  const z = lerp(front, faceZ - 0.06, m);
  return { z, stripeK, onGroove, m, edge };
}

// The shell: nemes, lappets, chest and neck, one surface with the opening recessed in it.
function sphinxShell() {
  const columns = [];
  for (let k = 1; k <= 11; k += 1) columns.push(-(0.82 + ((12 - k) / 11) * 0.62));
  for (let k = -18; k <= 18; k += 1) columns.push((k / 18) * 0.82);
  for (let k = 1; k <= 11; k += 1) columns.push(0.82 + (k / 11) * 0.62);

  const rowsY = [];
  for (let y = 2.0; y < 3.2; y += 0.1) rowsY.push(y);
  const step = STRIPE / STRIPE_ROWS;
  let lattice = Math.ceil(3.2 / step);
  for (let y = lattice * step; y < 5.3; lattice += 1, y = lattice * step) rowsY.push(y);
  for (let y = 5.31; y < 5.5; y += 0.03) rowsY.push(y);
  rowsY.push(5.5);

  const BACK = 18;
  const rings = rowsY.map((y) => {
    const ring = [];
    const hw = hdHalf(y);
    for (const c of columns) {
      const x = Math.max(-hw, Math.min(hw, c));
      const at = sphinxShellAt(x, y);
      ring.push([x, y, Math.abs(x) >= hw - 1e-4 ? at.edge : at.z]);
    }
    const edge = hdEdge(y);
    const zBack = hdBack(y);
    for (let k = 1; k < BACK; k += 1) {
      const a = (k / BACK) * Math.PI;
      const x = hw * Math.cos(a);
      // Concave toward the edge: seen from behind or above, the wings are thin flaps.
      let z = edge - (edge - zBack) * (1 - Math.abs(Math.cos(a))) ** 0.72;
      // The plaited tail of the cloth, down the middle of the back of the head.
      z -= 0.07 * bell(x, 0, 0.17) * between(y, 3.7, 4.8, 0.1);
      z += 0.014 * stripeGroove(y) * (1 - smooth01((y - 5.28) / 0.14)) * smooth01((y - 3.9) / 0.1);
      ring.push([x, y, z]);
    }
    return ring;
  });

  const STONE = lin(0xb0a48e);
  const GROOVE = lin(0x5e5140);
  return ringGrid(rings, (x, y, z) => {
    const edge = hdEdge(y);
    const n = smoothNoise3(x * 2.1, y * 2.1, z * 2.1);
    let c = mix3(STONE, times(STONE, 0.76), clamp01(n * 1.4 - 0.25));
    // Head and body are one stone at the chest, whatever harder bed the head was cut from.
    c = mix3(lin(0x9f917a), c, smooth01((y - 3.1) / 0.5));
    const fade = (y > 3.72 ? 1 : (z > edge + 0.02 ? sphinxShellAt(x, y).stripeK : 0)) * (1 - smooth01((y - 5.28) / 0.14));
    // Alternate pleats a shade apart, which is what says striped, and a dark line in each crease.
    c = times(c, lerp(1, stripeTone(y), fade));
    if (stripeGroove(y)) c = mix3(c, GROOVE, 0.5 * fade);
    return c;
  });
}

// The face: a dense patch of its own, because every lid and lip has to be sampled finely and the
// wings and the back of the head have no need to pay for that. Its rim falls back behind the
// headcloth's raised edge, so the join is a clean line where one surface passes behind another.
function sphinxFacePatch() {
  const NX = 90;
  const NY = 96;
  const positions = [];
  const colours = [];
  const uvs = [];
  const indices = [];
  const STONE = lin(0xbcae95);
  const SHADOW = lin(0x3c3024);
  const WARM = lin(0xb38f78);
  const X = 0.84;
  const Y0 = 3.26 + FACE_LIFT;
  const Y1 = 4.84 + FACE_LIFT;
  for (let j = 0; j <= NY; j += 1) {
    const y = lerp(Y0, Y1, j / NY);
    for (let i = 0; i <= NX; i += 1) {
      const x = lerp(-X, X, i / NX);
      const ax = Math.abs(x);
      const yf = y - FACE_LIFT;
      const f = sphinxFace(ax, yf);
      const rim = Math.min(X - ax, Y1 - y, y - Y0);
      // The corners are the part most likely to stand through the cloth, so they fall furthest.
      const corner = smooth01((ax - 0.72) / 0.1) * smooth01((yf - 4.6) / 0.1);
      const z = f.z - 0.3 * (1 - smooth01(rim / 0.05)) - 0.5 * corner;
      positions.push(x, y, z);
      uvs.push(x * 0.8 + z * 0.8, y);
      const n = smoothNoise3(x * 2.4 + (x < 0 ? 9 : 0), y * 2.4, 1.5);
      let c = mix3(STONE, times(STONE, 0.78), clamp01(n * 1.5 - 0.3));
      // Traces of the red paint survive on the face near the eye.
      c = mix3(c, WARM, 0.24 * bell(yf, 4.2, 0.28) * bell(ax, 0.4, 0.26));
      c = mix3(c, SHADOW, f.ao * 0.82);
      colours.push(...c);
    }
  }
  const R = NX + 1;
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const a = j * R + i;
      indices.push(a, a + 1, a + R + 1, a, a + R + 1, a + R);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return g;
}

// A leg lying along the ground, ending in a paw of real toes. The toes are grooves in the leg's
// own surface, so nothing can come unjoined from it.
function sphinxLeg(stations, { toes = 4, pawFrom = 0.8, grooveDepth = 0.1, sides = 36, toneHex = 0x9f937b } = {}) {
  const g = solidLoft(stations, {
    sides,
    samples: stations.length * 3,
    warp: (t, u, s) => {
      const k = smooth01((t - pawFrom) / 0.08);
      if (k <= 0) return (smoothNoise3(t * 40, u * 12, 2) - 0.5) * 0.03;
      const c = Math.cos(u * Math.PI * 2);
      const top = Math.sin(u * Math.PI * 2);
      if (top < -0.2) return 0;
      let d = 0;
      for (let i = 1; i < toes; i += 1) {
        const at = (i / toes) * 2 - 1;
        d += grooveAt(c - at, 0.05, grooveDepth);
      }
      // Scalloped toe ends, seen from above.
      const tip = smooth01((t - 0.93) / 0.05);
      d += tip * 0.05 * Math.abs(Math.sin(((c + 1) / 2) * toes * Math.PI));
      return d * k;
    },
  });
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) uv.setXY(i, pos.getZ(i), pos.getY(i) + pos.getX(i));
  // Dark down in the creases between the toes: at six feet that is what a toe is.
  const col = new Float32Array(pos.count * 3);
  const tone = lin(toneHex);
  const ring = sides + 1;
  const rows = stations.length * 3 + 1;
  for (let i = 0; i < pos.count; i += 1) {
    let k = 1;
    if (i < ring * rows) {
      const t = Math.floor(i / ring) / (rows - 1);
      const u = (i % ring) / sides;
      const up = Math.sin(u * Math.PI * 2);
      if (t > pawFrom && up > -0.2) {
        const c = Math.cos(u * Math.PI * 2);
        for (let e = 1; e < toes; e += 1) k = Math.min(k, 1 - 0.72 * Math.exp(-(((c - ((e / toes) * 2 - 1)) / 0.045) ** 2)) * smooth01((t - pawFrom) / 0.06));
      }
    }
    const n = smoothNoise3(pos.getX(i) * 0.8, pos.getY(i) * 2, pos.getZ(i) * 0.5);
    k *= (0.82 + n * 0.32) * lerp(0.84, 1, smooth01(pos.getY(i) / 0.5));
    col[i * 3] = tone[0] * k; col[i * 3 + 1] = tone[1] * k; col[i * 3 + 2] = tone[2] * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function dreamStelaFace() {
  return canvasTexture(320, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6d5e58';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2a211e';
    ctx.fillStyle = '#2a211e';
    ctx.lineWidth = 3;
    // The winged sun in the lunette.
    ctx.beginPath(); ctx.arc(w / 2, 60, 14, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w / 2 - 14, 60); ctx.quadraticCurveTo(w / 2 - 70, 34, w / 2 - 118, 62); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2 + 14, 60); ctx.quadraticCurveTo(w / 2 + 70, 34, w / 2 + 118, 62); ctx.stroke();
    // Two sphinxes back to back on their plinths, each receiving an offering from the king.
    for (const s of [-1, 1]) {
      const cx = w / 2 + s * 66;
      ctx.beginPath();
      ctx.moveTo(cx - s * 44, 170);
      ctx.lineTo(cx - s * 44, 146);
      ctx.lineTo(cx - s * 4, 142);
      ctx.lineTo(cx + s * 10, 112);
      ctx.lineTo(cx + s * 24, 112);
      ctx.lineTo(cx + s * 26, 142);
      ctx.lineTo(cx + s * 50, 158);
      ctx.lineTo(cx + s * 50, 170);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 50, 172, 100, 7);
    }
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i += 1) { ctx.beginPath(); ctx.moveTo(14, 90 + i * 104); ctx.lineTo(w - 14, 90 + i * 104); ctx.stroke(); }
    // Fourteen lines of inscription, as columns of small marks rather than as letters.
    const rng = seededRandom(1401);
    for (let row = 0; row < 15; row += 1) {
      const y = 212 + row * 19;
      ctx.beginPath(); ctx.moveTo(14, y + 15); ctx.lineTo(w - 14, y + 15); ctx.lineWidth = 1; ctx.stroke();
      let x = 18;
      while (x < w - 26) {
        const kind = Math.floor(rng() * 4);
        const size = 6 + rng() * 6;
        if (kind === 0) ctx.fillRect(x, y + 2, size, 3);
        else if (kind === 1) { ctx.beginPath(); ctx.arc(x + size / 2, y + 7, size / 2, 0, Math.PI * 2); ctx.stroke(); }
        else if (kind === 2) ctx.fillRect(x + size / 2 - 1, y, 2.5, 13);
        else { ctx.beginPath(); ctx.moveTo(x, y + 12); ctx.lineTo(x + size / 2, y + 1); ctx.lineTo(x + size, y + 12); ctx.stroke(); }
        x += size + 3 + rng() * 4;
      }
    }
    // A cracked and worn lower third: the lower lines of the real stela are lost.
    ctx.fillStyle = 'rgba(109,94,88,0.86)';
    ctx.fillRect(0, 440, w, 72);
  });
}

function greatSphinx() {
  const rng = seededRandom(66);
  // The forelegs and hind legs.
  const parts = [];
  const hindParts = [];
  for (const side of [-1, 1]) {
    const fore = sphinxLeg([
      { d: 0.1, w: 0.2, up: 0.5, dn: 0.45, a: side * 1.3, b: 0.6, round: 0.95 },
      { d: 1.0, w: 0.5, up: 0.85, dn: 0.55, a: side * 1.52, b: 0.68, round: 0.88 },
      { d: 2.4, w: 0.68, up: 0.92, dn: 0.54, a: side * 1.66, b: 0.7, round: 0.74 },
      { d: 4.4, w: 0.62, up: 0.72, dn: 0.5, a: side * 1.56, b: 0.6, round: 0.66 },
      { d: 6.4, w: 0.56, up: 0.58, dn: 0.46, a: side * 1.48, b: 0.54, round: 0.62 },
      { d: 7.8, w: 0.56, up: 0.5, dn: 0.42, a: side * 1.44, b: 0.5, round: 0.58 },
      { d: 8.5, w: 0.68, up: 0.48, dn: 0.4, a: side * 1.44, b: 0.46, round: 0.54 },
      { d: 9.15, w: 0.72, up: 0.42, dn: 0.36, a: side * 1.44, b: 0.42, round: 0.54 },
      { d: 9.5, w: 0.6, up: 0.3, dn: 0.28, a: side * 1.44, b: 0.36, round: 0.62 },
      { d: 9.62, w: 0.3, up: 0.09, dn: 0.1, a: side * 1.44, b: 0.32, round: 0.9 },
    ], { pawFrom: 0.68 });
    parts.push({ geometry: fore, keepColor: true });
    const hind = sphinxLeg([
      { d: -7.4, w: 0.2, up: 0.45, dn: 0.35, a: side * 1.7, b: 0.5, round: 0.9 },
      { d: -5.6, w: 0.46, up: 0.56, dn: 0.42, a: side * 2.2, b: 0.5, round: 0.72 },
      { d: -4.1, w: 0.42, up: 0.42, dn: 0.38, a: side * 2.02, b: 0.44, round: 0.64 },
      { d: -3.1, w: 0.52, up: 0.36, dn: 0.34, a: side * 1.96, b: 0.38, round: 0.56 },
      { d: -2.55, w: 0.44, up: 0.24, dn: 0.26, a: side * 1.94, b: 0.33, round: 0.62 },
      { d: -2.45, w: 0.2, up: 0.07, dn: 0.09, a: side * 1.94, b: 0.3, round: 0.9 },
    ], { pawFrom: 0.66, grooveDepth: 0.07, sides: 28, toneHex: 0x9d8f76 });
    hindParts.push({ geometry: hind, keepColor: true });
  }
  const legs = mergeParts(parts);
  const cased = mesh(legs, stoneMaterial(setRepeat(casingTile(47), 2.2), { bumpScale: 0.4 }));

  // The hind legs were cut from the living rock with the body, and stay carved, not cased.
  const carved = mergeParts([
    { geometry: sphinxBody(rng), keepColor: true },
    { geometry: sphinxShell(), keepColor: true },
    { geometry: sphinxFacePatch(), keepColor: true },
    ...hindParts,
  ]);
  const stone = mesh(carved, stoneMaterial(setRepeat(carvedTile(23), 3.2), { bumpScale: 0.7 }));

  // The bedrock, barely thicker than the sand on it.
  const baseGeo = (() => {
    const HX = 4.3;
    const HZ = 11.0;
    const SECTORS = 128;
    const sRings = [0.2, 0.42, 0.58, 0.7, 0.8, 0.87, 0.93, 0.97, 0.995, 1];
    const POWER = 2 / 6;
    const positions = []; const colours = []; const uvs = []; const indices = [];
    const SAND = lin(0xb19f7f);
    const SAND2 = lin(0x96866a);
    const ROCK = lin(0x867a66);
    for (let r = 0; r < sRings.length; r += 1) {
      for (let k = 0; k < SECTORS; k += 1) {
        const a = (k / SECTORS) * Math.PI * 2;
        const sx = Math.sin(a);
        const cz = Math.cos(a);
        const x = HX * sRings[r] * Math.sign(sx) * Math.abs(sx) ** POWER;
        const z = HZ * sRings[r] * Math.sign(cz) * Math.abs(cz) ** POWER;
        const rock = smooth01((smoothNoise3(x * 0.5 + 8, 2, z * 0.5) - 0.44) / 0.12);
        const ripple = (smoothNoise3(x * 1.6, 7, z * 1.1) - 0.5) * 0.05;
        const rim = r === sRings.length - 1 ? 0 : r === sRings.length - 2 ? 0.05 : 0.11 + ripple + rock * 0.025;
        positions.push(x, rim, z);
        uvs.push(x, z);
        colours.push(...mix3(mix3(SAND2, SAND, smoothNoise3(x * 0.8, 3, z * 0.8)), ROCK, rock * 0.72));
      }
    }
    for (let r = 0; r < sRings.length - 1; r += 1) {
      for (let k = 0; k < SECTORS; k += 1) {
        const k2 = (k + 1) % SECTORS;
        indices.push(r * SECTORS + k, (r + 1) * SECTORS + k, r * SECTORS + k2);
        indices.push(r * SECTORS + k2, (r + 1) * SECTORS + k, (r + 1) * SECTORS + k2);
      }
    }
    // A hub to close the middle, under the animal.
    const hub = positions.length / 3;
    positions.push(0, 0.1, 0);
    uvs.push(0, 0);
    colours.push(...SAND2);
    for (let k = 0; k < SECTORS; k += 1) indices.push(hub, k, (k + 1) % SECTORS);
    const g = new THREE.BufferGeometry();
    g.setIndex(indices);
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    g.computeVertexNormals();
    return g;
  })();
  const base = mesh(baseGeo, standard({ vertexColors: true, roughness: 1, ...relief('soil', { seed: 61, repeat: 1.1, strength: 1.2 }) }));
  base.castShadow = false;

  // The Dream Stela between the paws, and the small altar in front of it. Granite, set up about
  // 1401 BCE by Thutmose IV, whose inscription says the Sphinx promised him the throne if he
  // cleared the sand away.
  const STELA_Z = 5.52;
  const outline = [];
  for (const [x, y] of [[-0.32, 0.08], [0.32, 0.08], [0.32, 0.92]]) outline.push([x, y]);
  for (let i = 1; i < 12; i += 1) {
    const a = (i / 12) * Math.PI;
    outline.push([Math.cos(a) * 0.32, 0.92 + Math.sin(a) * 0.17]);
  }
  outline.push([-0.32, 0.92]);
  const stelaParts = [
    { geometry: extrudeOutline(outline, 0.14), color: 0x74645d, position: [0, 0, STELA_Z] },
    { geometry: feetBox(0.86, 0.1, 0.34, rng), color: 0x8c7d62, position: [0, 0.09, STELA_Z] },
  ];
  // A low wall of later brickwork each side, closing the space between the paws.
  for (const side of [-1, 1]) {
    stelaParts.push({ geometry: feetBox(0.14, 0.32, 1.1, rng), color: 0x8a7a5e, position: [side * 0.62, 0.2, STELA_Z + 0.32] });
  }
  stelaParts.push({ geometry: feetBox(0.42, 0.34, 0.3, rng), color: 0x93846a, position: [0, 0.22, STELA_Z + 1.2] });
  const stelaMesh = mesh(mergeParts(stelaParts), standard({ vertexColors: true, roughness: 0.82 }));
  const faceTex = dreamStelaFace();
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.58, 0.82),
    standard({ map: faceTex, bumpMap: faceTex, bumpScale: 0.5, roughness: 0.75 }),
  );
  panel.position.set(0, 0.51, STELA_Z + 0.072);
  panel.receiveShadow = true;

  return group(base, cased, stone, stelaMesh, panel);
}

// ---------------------------------------------------------------------------
// The Parthenon
// ---------------------------------------------------------------------------

// 1/8 of the temple as it stands today, long axis along X. West is -X and east (the main door) is
// +X, so +Z is the south side. A stylobate of 228 x 101ft gives 28.5 x 12.66; columns 34.25ft tall
// and 6.2ft through at the foot give 4.28 and 0.78. Column axes, spacing and the corner contraction
// follow the real plan, because the card asks a student to count them.
const PTH = {
  L: 28.5,
  W: 12.66,
  STEP_RISE: 0.21,
  STEP_TREAD: 0.29,
  AXIS_L: 13.75, // half the distance between corner column axes, long side
  AXIS_W: 5.83, // and short side
  COL_H: 4.28,
  R_BASE: 0.39,
  R_TOP: 0.3,
  PER_END: 8,
  PER_SIDE: 17,
  DRUMS: 6,
};
PTH.FLOOR = PTH.STEP_RISE * 3;

// `bays` spans between `bays + 1` columns. The two end bays are drawn in by about a seventh, the
// Greek solution to a triglyph having to sit on the corner of the frieze.
function axisStations(half, bays) {
  const CONTRACT = 0.86;
  const regular = (2 * half) / (bays - 2 + 2 * CONTRACT);
  const out = [-half];
  for (let i = 0; i < bays; i += 1) out.push(out[i] + regular * (i === 0 || i === bays - 1 ? CONTRACT : 1));
  return out;
}

// THE OUTER COLONNADE, as one list. The corner columns are counted once, because the short sides
// only take the columns BETWEEN their corners: 17 + 17 + 6 + 6 = 46. The card asks a student to
// count these, so the builder refuses to run on any other number.
function outerColumns() {
  const along = axisStations(PTH.AXIS_L, PTH.PER_SIDE - 1);
  const across = axisStations(PTH.AXIS_W, PTH.PER_END - 1);
  const list = [];
  for (const x of along) {
    list.push({ x, z: PTH.AXIS_W, side: 'south' });
    list.push({ x, z: -PTH.AXIS_W, side: 'north' });
  }
  for (const z of across.slice(1, -1)) {
    list.push({ x: -PTH.AXIS_L, z, side: 'west' });
    list.push({ x: PTH.AXIS_L, z, side: 'east' });
  }
  if (list.length !== 46) throw new Error(`The Parthenon has 46 outer columns, not ${list.length}`);
  return list;
}

// Near-white Pentelic grain: the fine parallel iron streaks that weather to honey. Horizontal joint
// exactly once per tile in v, and a column's v runs one per drum, so a joint lands on every drum.
function drumTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f5f1e8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i += 1) {
      const x = rng() * w;
      const y = rng() * h;
      const len = 8 + rng() * 40;
      const v = 190 + rng() * 50;
      ctx.strokeStyle = `rgba(${v},${v * 0.93},${v * 0.8},${0.05 + rng() * 0.12})`;
      ctx.lineWidth = 0.6 + rng() * 2.4;
      for (const dx of [0, -w, w]) for (const dy of [0, -h, h]) {
        ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx + (rng() - 0.5) * 3, y + dy + len); ctx.stroke();
      }
    }
    for (let i = 0; i < 900; i += 1) {
      const v = 120 + rng() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.8},${0.14 + rng() * 0.26})`;
      ctx.fillRect(rng() * w, rng() * h, 0.8 + rng() * 2, 0.8 + rng() * 2);
    }
    ctx.fillStyle = 'rgba(80,68,54,0.42)';
    ctx.fillRect(0, 0, w, 2.4);
  });
}

// Coursed marble blocks for everything that is not a column.
function ashlarTile(seed, { courses = 4, minLen = 110, spread = 120, line = 0.26 } = {}) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f2eee5';
    ctx.fillRect(0, 0, w, h);
    const ch = h / courses;
    for (let r = 0; r < courses; r += 1) {
      const offset = rng() * w;
      let x = 0;
      const seams = [];
      while (x < w - minLen * 0.5) {
        const len = Math.min(w - x, minLen + rng() * spread);
        const v = 234 + rng() * 18;
        ctx.fillStyle = `rgb(${v},${v * 0.98},${v * 0.95})`;
        const px = (x + offset) % w;
        ctx.fillRect(px, r * ch, len, ch);
        if (px + len > w) ctx.fillRect(px - w, r * ch, len, ch);
        seams.push(px);
        x += len;
      }
      ctx.fillStyle = `rgba(74,62,48,${line})`;
      ctx.fillRect(0, r * ch, w, 2.4);
      for (const px of seams) ctx.fillRect(px, r * ch, 2.4, ch);
    }
    for (let i = 0; i < 2200; i += 1) {
      const v = 130 + rng() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.8},${0.1 + rng() * 0.28})`;
      ctx.fillRect(rng() * w, rng() * h, 0.8 + rng() * 2.2, 0.8 + rng() * 2.2);
    }
  });
}

// One fluted shaft. 20 flutes meeting at sharp arrises, as on the real columns, with three points
// per flute and a pair of normals at each arris, so the arris is a crease and the flute is a curve.
// Each drum owns its own pair of rows, so one drum can be a different stone from its neighbours
// (the pale ones are modern repairs in new Pentelic marble) with a hard line between them.
function flutedShaft({ rBase, rTop, height, drumTones, topTone = null, y0 = 0, cut = 1 }) {
  const FLUTES = 20;
  const DEPTH = 0.085;
  const SLOPE = 0.62; // how far an arris normal leans toward its flute, in radians
  const positions = []; const normals = []; const uvs = []; const colours = []; const indices = [];
  const radiusAt = (t) => lerp(rBase, rTop, t ** 1.8); // entasis: straight would be t ** 1
  const drums = drumTones.length;
  const pushRow = (t, tone, drumIndex, drumT) => {
    const r = radiusAt(t);
    const lean = (rBase - rTop) / height;
    for (let f = 0; f < FLUTES; f += 1) {
      for (let k = 0; k < 3; k += 1) {
        const a = ((f + k / 2) / FLUTES) * Math.PI * 2;
        const rr = k === 1 ? r * (1 - DEPTH) : r;
        positions.push(Math.sin(a) * rr, y0 + t * height, Math.cos(a) * rr);
        const tilt = k === 0 ? SLOPE : k === 2 ? -SLOPE : 0;
        const na = a + tilt;
        const nl = Math.hypot(1, lean);
        normals.push(Math.sin(na) / nl, lean / nl, Math.cos(na) / nl);
        uvs.push((a / (Math.PI * 2)) * 2.4, drumIndex + drumT);
        // Down in the flute it is darker than on the arris, and at any distance that is the flute.
        const shade = k === 1 ? 0.66 : 1.06;
        colours.push(tone[0] * shade, tone[1] * shade, tone[2] * shade);
      }
    }
  };
  const ring = FLUTES * 3;
  let rows = 0;
  const lastDrum = Math.ceil(drums * cut) - 1;
  for (let d = 0; d <= lastDrum; d += 1) {
    const t0 = d / drums;
    const t1 = Math.min(cut, (d + 1) / drums);
    pushRow(t0, drumTones[d], d, 0);
    pushRow(t1, drumTones[d], d, (t1 - t0) * drums);
    const a0 = rows * ring;
    const b0 = (rows + 1) * ring;
    for (let f = 0; f < FLUTES; f += 1) {
      for (let k = 0; k < 2; k += 1) {
        const a = a0 + f * 3 + k;
        const b = a + 1;
        const c = b0 + f * 3 + k + 1;
        const e = b0 + f * 3 + k;
        indices.push(a, b, c, a, c, e);
      }
    }
    rows += 2;
  }
  // Close the top with a fan for a broken stump; a whole column ends inside its capital.
  if (cut < 1) {
    const top = (rows - 1) * ring;
    const yTop = y0 + cut * height;
    const centre = positions.length / 3;
    positions.push(0, yTop, 0);
    normals.push(0, 1, 0);
    uvs.push(0.4, 0.5);
    const breakTone = topTone ?? drumTones[lastDrum];
    colours.push(breakTone[0], breakTone[1], breakTone[2]);
    for (let i = 0; i < ring; i += 1) {
      const a = top + i;
      const b = top + (i + 1) % ring;
      indices.push(centre, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return g;
}

// A Doric capital: annulets, then the echinus flaring into a square abacus. `revolve` wants its
// profile running top to bottom or it comes out inside out.
function doricCapital(rNeck, tone, darker) {
  const R = rNeck;
  const profile = [
    [R * 1.42, 0.34], [R * 1.36, 0.27], [R * 1.2, 0.16], [R * 1.05, 0.08], [R * 1.05, 0.05],
    [R * 0.98, 0.042], [R * 1.04, 0.034], [R * 1.02, 0.0], [R * 0.9, -0.02],
  ];
  const echinus = revolve(profile, { segments: 20 });
  const uv = echinus.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, 0.25 + uv.getY(i) * 0.5);
  const shadow = new THREE.BufferAttribute(new Float32Array(echinus.attributes.position.count * 3), 3);
  for (let i = 0; i < shadow.count; i += 1) {
    const y = echinus.attributes.position.getY(i);
    const c = mix3(darker, tone, smooth01((y - 0.02) / 0.2));
    shadow.setXYZ(i, c[0], c[1], c[2]);
  }
  echinus.setAttribute('color', shadow);
  const half = R * 1.42 * 1.03;
  const abacus = new THREE.BoxGeometry(half * 2, 0.13, half * 2);
  abacus.translate(0, 0.335 + 0.065, 0);
  const auv = abacus.attributes.uv;
  for (let i = 0; i < auv.count; i += 1) auv.setXY(i, auv.getX(i) * 0.8, 0.3 + auv.getY(i) * 0.4);
  return mergeParts([{ geometry: echinus, keepColor: true }, { geometry: abacus, color: new THREE.Color().setRGB(tone[0], tone[1], tone[2]).getHex() }]);
}

// Worn, chipped runs of marble round a rectangle: one tier of the crepidoma.
function stepTier(soup, rng, hx, hz, y0, y1, tread, tones) {
  const P = (side, a, o) => {
    if (side === 0) return [a, o];
    if (side === 1) return [o, -a];
    if (side === 2) return [-a, -o];
    return [-o, a];
  };
  const pts = [];
  for (let s = 0; s < 4; s += 1) {
    const half = s % 2 === 0 ? hx : hz;
    const out = s % 2 === 0 ? hz : hx;
    let a = -half;
    while (a < half - 1e-3) {
      let b = a + 0.55 + rng() * 1.5;
      if (b > half - 0.4) b = half;
      const roll = rng();
      const off = roll < 0.1 ? -0.05 - rng() * 0.07 : (rng() - 0.5) * 0.014;
      const tone = times(tones[Math.floor(rng() * tones.length)], (roll < 0.1 ? 0.84 : 0.95) + rng() * 0.08);
      const [ax, az] = P(s, a, out + off);
      const [bx, bz] = P(s, b, out + off);
      pts.push({ x: ax, z: az, tone }, { x: bx, z: bz, tone });
      a = b;
    }
  }
  const n = pts.length;
  let run = rng() * 20;
  const v0 = rng() * 5;
  for (let k = 0; k < n; k += 1) {
    const p = pts[k];
    const q = pts[(k + 1) % n];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-4) continue;
    const low = times(p.tone, 0.66);
    const high = times(p.tone, 1.02);
    soup.quad(
      [p.x, y0, p.z], [q.x, y0, q.z], [q.x, y1, q.z], [p.x, y1, p.z],
      [[run, v0], [run + len, v0], [run + len, v0 + (y1 - y0)], [run, v0 + (y1 - y0)]],
      [low, low, high, high],
    );
    // The tread runs in to under the next tier up, with its contact shadow at the back.
    const inset = (x, z) => {
      const kx = Math.max(0.01, Math.abs(x) - tread - 0.2);
      const kz = Math.max(0.01, Math.abs(z) - tread - 0.2);
      return [Math.sign(x) * Math.min(Math.abs(x), kx), Math.sign(z) * Math.min(Math.abs(z), kz)];
    };
    const [ax, az] = inset(p.x, p.z);
    const [bx, bz] = inset(q.x, q.z);
    const back = times(p.tone, 0.74);
    const front = times(p.tone, 1.04);
    soup.quad(
      [p.x, y1, p.z], [q.x, y1, q.z], [bx, y1, bz], [ax, y1, az],
      [[p.x, p.z], [q.x, q.z], [bx, bz], [ax, az]],
      [front, front, back, back],
    );
    run += len;
  }
}

function parthenon() {
  const rng = seededRandom(447);
  const MARBLE = lin(0xc2b8a2);
  const WEATHERED = lin(0xa69a83);
  const HONEY = lin(0xbdac8c);
  const RESTORED = lin(0xcfcabd);

  const COL_SHAFT = PTH.COL_H - 0.47;
  const colTop = PTH.FLOOR + PTH.COL_H;

  // --- the columns, all in one mesh -----------------------------------------------------------
  const columnParts = [];
  const list = outerColumns();
  const standColumn = (x, z, y0, rBase, rTop, shaftH, restoredChance, cut = 1) => {
    const tones = [];
    for (let d = 0; d < PTH.DRUMS; d += 1) {
      const pick = rng();
      let t = pick < 0.5 ? mix3(MARBLE, HONEY, rng() * 0.6) : mix3(MARBLE, WEATHERED, rng() * 0.45);
      if (rng() < restoredChance) t = mix3(RESTORED, MARBLE, rng() * 0.4);
      tones.push(times(t, 0.97 + rng() * 0.05));
    }
    const shaft = flutedShaft({ rBase, rTop, height: shaftH, drumTones: tones, y0: 0, cut, topTone: times(RESTORED, 0.9) });
    const yaw = rng() * 0.1;
    columnParts.push({ geometry: shaft, keepColor: true, position: [x, y0, z], rotation: [0, yaw, 0] });
    if (cut >= 1) {
      const capital = doricCapital(rTop, tones[PTH.DRUMS - 1], times(tones[PTH.DRUMS - 1], 0.66));
      columnParts.push({ geometry: capital, keepColor: true, position: [x, y0 + shaftH, z] });
    }
  };
  for (const c of list) {
    // The north colonnade has had the most modern repair, and it shows in paler new drums.
    standColumn(c.x, c.z, PTH.FLOOR, PTH.R_BASE, PTH.R_TOP, COL_SHAFT, c.side === 'north' && Math.abs(c.x) < 7 ? 0.28 : 0.04);
  }
  // The two inner porches, six columns each, a little slimmer and standing on the cella's raised
  // floor. They are not part of the 46, and from outside they sit behind the outer row.
  const INNER_FLOOR = PTH.FLOOR + 0.08;
  const INNER_R = PTH.R_BASE * 0.88;
  const INNER_RT = PTH.R_TOP * 0.88;
  const INNER_SHAFT = COL_SHAFT - 0.3;
  const innerZ = [-4.0, -2.4, -0.8, 0.8, 2.4, 4.0];
  const WEST_PORCH = -11.1;
  const EAST_PORCH = 10.9;
  innerZ.forEach((z) => standColumn(WEST_PORCH, z, INNER_FLOOR, INNER_R, INNER_RT, INNER_SHAFT, 0.08));
  // The east porch went with the church's apse. Stumps survive, some restored higher than others.
  [0.34, 1.0, 0.5, 0.17, 0.67, 0.34].forEach((cut, i) => standColumn(EAST_PORCH, innerZ[i], INNER_FLOOR, INNER_R, INNER_RT, INNER_SHAFT, 0.15, cut));

  const columnsGeo = mergeParts(columnParts);

  // --- everything else: steps, entablature, walls, floor --------------------------------------
  const parts = [];
  const hexOf = (c) => new THREE.Color().setRGB(c[0], c[1], c[2]).getHex();
  const marbleHex = (k = 1) => hexOf(times(mix3(MARBLE, rng() < 0.5 ? HONEY : WEATHERED, rng() * 0.7), k * (0.96 + rng() * 0.07)));

  // The three steps of the crepidoma.
  const stepSoup = new Soup();
  const stepTones = [MARBLE, mix3(MARBLE, HONEY, 0.5), mix3(MARBLE, WEATHERED, 0.5)];
  const R = PTH.STEP_RISE;
  const T = PTH.STEP_TREAD;
  stepTier(stepSoup, rng, PTH.L / 2 + 2 * T, PTH.W / 2 + 2 * T, 0, R, T, stepTones);
  stepTier(stepSoup, rng, PTH.L / 2 + T, PTH.W / 2 + T, R, 2 * R, T, stepTones);
  stepTier(stepSoup, rng, PTH.L / 2, PTH.W / 2, 2 * R, 3 * R, T, stepTones);
  parts.push({ geometry: stepSoup.geometry(), keepColor: true });
  // The floor of the peristyle and the body of the platform.
  parts.push({ geometry: feetBox(PTH.L - 0.56, PTH.FLOOR, PTH.W - 0.56, null, 12, 1), color: hexOf(times(MARBLE, 0.92)), position: [0, PTH.FLOOR / 2 - 0.004, 0] });

  // A side, as a frame: local x along it, local z outward from the temple.
  const SIDES = {
    south: { rotY: 0, o: PTH.AXIS_W, half: PTH.AXIS_L, stations: axisStations(PTH.AXIS_L, PTH.PER_SIDE - 1) },
    east: { rotY: Math.PI / 2, o: PTH.AXIS_L, half: PTH.AXIS_W, stations: axisStations(PTH.AXIS_W, PTH.PER_END - 1) },
    north: { rotY: Math.PI, o: PTH.AXIS_W, half: PTH.AXIS_L, stations: axisStations(PTH.AXIS_L, PTH.PER_SIDE - 1) },
    west: { rotY: -Math.PI / 2, o: PTH.AXIS_L, half: PTH.AXIS_W, stations: axisStations(PTH.AXIS_W, PTH.PER_END - 1) },
  };
  const onSide = (side, geometry, color, a, y, o, keepColor = false) => {
    const sn = Math.sin(side.rotY);
    const cs = Math.cos(side.rotY);
    const zz = side.o + o;
    parts.push({ geometry, color, keepColor, position: [a * cs + zz * sn, y, -a * sn + zz * cs], rotation: [0, side.rotY, 0] });
  };
  const longBox = (side, a0, a1, y0, y1, depth, oCentre, tone) => {
    const len = a1 - a0;
    onSide(side, feetBox(len, y1 - y0, depth, rng, Math.max(1, Math.round(len / 1.1)), 1), tone, (a0 + a1) / 2, (y0 + y1) / 2, oCentre);
  };

  const ARCH_Y0 = colTop;
  const ARCH_Y1 = ARCH_Y0 + 0.47;
  const FRIEZE_Y1 = ARCH_Y1 + 0.52;
  const CORN_Y1 = FRIEZE_Y1 + 0.32;
  const OVER = 0.31; // half the architrave's depth, which is what the corners overlap by
  const TRI_W = 0.346;

  // One triglyph: in plan, two full grooves and a half-groove down each edge. Its depth is
  // extruded vertically, which keeps the grooves running straight down the block.
  const triglyphOutline = (() => {
    const w = TRI_W / 2;
    const p = 0.05;
    const v = 0.022;
    const a = w / 3;
    return [
      [-w, 0], [w, 0], [w, -p + v], [w - v * 0.9, -p], [a + v * 0.9, -p], [a, -p + v * 0.9], [a - v * 0.9, -p],
      [-a + v * 0.9, -p], [-a, -p + v * 0.9], [-a - v * 0.9, -p], [-w + v * 0.9, -p], [-w, -p + v],
    ];
  })();
  const regula = (() => {
    const s = new Soup();
    const w = TRI_W / 2;
    const white = [1, 1, 1];
    const uv = [[0.3, 0.3], [0.5, 0.3], [0.5, 0.5], [0.3, 0.5]];
    const h = 0.03;
    const d = 0.022;
    s.quad([-w, -h, d], [w, -h, d], [w, 0, d], [-w, 0, d], uv, white);
    s.quad([-w, -h, 0], [w, -h, 0], [w, -h, d], [-w, -h, d], uv, white);
    for (let i = 0; i < 6; i += 1) {
      const x0 = -w + (i + 0.2) * (TRI_W / 6);
      const x1 = x0 + (TRI_W / 6) * 0.6;
      const yy = -h - 0.028;
      s.quad([x0, yy, d * 0.8], [x1, yy, d * 0.8], [x1, -h, d], [x0, -h, d], uv, white);
      s.quad([x0, yy, 0], [x1, yy, 0], [x1, yy, d * 0.8], [x0, yy, d * 0.8], uv, white);
    }
    return s.geometry();
  })();

  // What stands of each side, as fractions of the side's bays. Between them, the explosion of
  // 1687 took the middle out of both long sides. The ruin is stepped: the architrave reaches
  // furthest, the frieze less far, the cornice least.
  const spans = {
    south: [[0, 5.5], [10.5, 16]],
    north: [[0, 7], [10, 16]],
    west: [[0, 7]],
    east: [[0, 7]],
  };
  for (const [name, side] of Object.entries(SIDES)) {
    const st = side.stations;
    const bays = st.length - 1;
    const atBay = (b) => {
      const i = Math.min(bays - 1, Math.floor(b));
      return lerp(st[i], st[i + 1], b - i);
    };
    // Triglyph centres: one over every column, one in every bay, and the corner ones pushed
    // out to the very corner of the frieze.
    const cornerA = side.half + OVER - TRI_W / 2;
    const glyphs = [-cornerA];
    for (let i = 0; i < bays; i += 1) {
      const left = i === 0 ? -cornerA : st[i];
      const right = i === bays - 1 ? cornerA : st[i + 1];
      glyphs.push((left + right) / 2);
      glyphs.push(i === bays - 1 ? cornerA : st[i + 1]);
    }

    for (const [b0, b1] of spans[name]) {
      const atStart = b0 === 0;
      const atEnd = b1 === bays;
      const ext0 = atStart ? -side.half - OVER : atBay(b0);
      const ext1 = atEnd ? side.half + OVER : atBay(b1);
      const toneA = marbleHex(0.98);
      // Architrave, with its small taenia along the top.
      longBox(side, ext0, ext1, ARCH_Y0, ARCH_Y1, OVER * 2, 0, toneA);
      longBox(side, ext0, ext1, ARCH_Y1 - 0.045, ARCH_Y1, 0.03, OVER + 0.012, marbleHex(1.02));
      // Frieze: a shade shorter wherever it is a broken end.
      const f0 = atStart ? ext0 : atBay(b0 + 0.5);
      const f1 = atEnd ? ext1 : atBay(b1 - 0.5);
      longBox(side, f0, f1, ARCH_Y1, FRIEZE_Y1, 0.5, 0, marbleHex(0.9));
      let prev = null;
      for (const a of glyphs) {
        if (a < f0 + TRI_W * 0.45 || a > f1 - TRI_W * 0.45) { prev = null; continue; }
        const tri = extrudeOutline(triglyphOutline, FRIEZE_Y1 - ARCH_Y1);
        tri.rotateX(-Math.PI / 2);
        // The grooves carry the triglyph, so they are painted dark as well as cut.
        const triTone = new THREE.Color(marbleHex(0.98));
        tintGeometry(tri, (p) => (p.z < 0.038 && p.z > 0.012 ? [triTone.r * 0.5, triTone.g * 0.5, triTone.b * 0.5] : [triTone.r, triTone.g, triTone.b]));
        onSide(side, tri, 0xffffff, a, (ARCH_Y1 + FRIEZE_Y1) / 2, 0.26, true);
        onSide(side, regula, marbleHex(0.96), a, ARCH_Y1 - 0.045, OVER);
        // The metope between this triglyph and the last: hacked away by the early Christians on
        // three sides of the building, which leaves a scarred lump rather than a flat panel.
        if (prev !== null) {
          const w = a - prev - TRI_W;
          const h = FRIEZE_Y1 - ARCH_Y1 - 0.04;
          const panel = new THREE.PlaneGeometry(w, h, 3, 3);
          const pp = panel.attributes.position;
          const seed = rng() * 90;
          for (let v = 0; v < pp.count; v += 1) {
            const px = pp.getX(v); const py = pp.getY(v);
            const edge = Math.min(w / 2 - Math.abs(px), h / 2 - Math.abs(py));
            const k = smooth01(edge / 0.07);
            pp.setZ(v, k * (smoothNoise3(px * 7 + seed, py * 7, 3) * 0.06 - 0.015));
          }
          panel.computeVertexNormals();
          const puv = panel.attributes.uv;
          for (let v = 0; v < puv.count; v += 1) puv.setXY(v, puv.getX(v) * w + seed, puv.getY(v) * h + 0.05);
          onSide(side, panel, marbleHex(0.94), (a + prev) / 2, (ARCH_Y1 + FRIEZE_Y1) / 2 - 0.01, 0.255);
        }
        prev = a;
      }
      // Cornice: shorter again at a break, with mutules on its soffit and a hawksbeak at the lip.
      const c0 = atStart ? ext0 - 0.14 : atBay(b0 + 1);
      const c1 = atEnd ? ext1 + 0.14 : atBay(b1 - 1);
      if (c1 > c0) {
        longBox(side, c0, c1, FRIEZE_Y1, FRIEZE_Y1 + 0.18, 1.0, 0.12, marbleHex(0.92));
        longBox(side, c0, c1, FRIEZE_Y1 + 0.18, FRIEZE_Y1 + 0.24, 1.08, 0.13, marbleHex(0.98));
        longBox(side, c0, c1, FRIEZE_Y1 + 0.24, CORN_Y1, 0.96, 0.08, marbleHex(0.92));
        for (const a of glyphs) {
          if (a < c0 + 0.2 || a > c1 - 0.2) continue;
          onSide(side, feetBox(0.34, 0.03, 0.3, rng), marbleHex(0.8), a, FRIEZE_Y1 - 0.012, 0.47);
        }
      }
    }
  }

  // --- the pediments. West survives in outline, with the stumps of two figures in the corner.
  // East stands only in its two corner wedges, its centre lost to the apse of the church. ------
  const PED_H = 1.46;
  const PED_W = PTH.AXIS_W + OVER + 0.14;
  const RAKE = Math.atan2(PED_H, PED_W);
  const rakeBand = (side, fromT, toT, s, oCentre = 0.1) => {
    // A raking cornice between two fractions of the way up: thickness goes perpendicular to the
    // slope, so it lies on the wall rather than standing on it.
    const x0 = lerp(PED_W, 0, fromT) * s;
    const x1 = lerp(PED_W, 0, toT) * s;
    const y0 = CORN_Y1 + lerp(0, PED_H, fromT);
    const y1 = CORN_Y1 + lerp(0, PED_H, toT);
    const up = 0.32 / Math.cos(RAKE);
    const outline = [[x0, y0], [x1, y1], [x1, y1 + up], [x0, y0 + up]];
    onSide(side, extrudeOutline(outline, 1.04), marbleHex(0.94), 0, 0, oCentre);
  };
  const tympanum = (side, outline, tone) => {
    onSide(side, extrudeOutline(outline, 0.42), tone, 0, 0, -0.02);
  };
  const west = SIDES.west;
  // The wall breaks away near the top on one side, taking the raking cornice with it.
  const wTop = CORN_Y1;
  tympanum(west, [
    [-PED_W, wTop], [PED_W, wTop], [PED_W * 0.62, wTop + PED_H * 0.38], [PED_W * 0.44, wTop + PED_H * 0.56],
    [PED_W * 0.34, wTop + PED_H * 0.5], [PED_W * 0.26, wTop + PED_H * 0.46], [PED_W * 0.1, wTop + PED_H * 0.72], [0, wTop + PED_H * 0.98], [-PED_W * 0.5, wTop + PED_H * 0.5],
  ], marbleHex(0.84));
  rakeBand(west, 0, 1, -1);
  rakeBand(west, 0, 0.56, 1);
  // Two worn figures in the north-west corner, which is all that remains of the sculpture there.
  for (const [a, h, w] of [[-PED_W * 0.74, 0.17, 0.3], [-PED_W * 0.52, 0.3, 0.26], [-PED_W * 0.34, 0.2, 0.2]]) {
    const blob = new THREE.IcosahedronGeometry(1, 2);
    const pos = blob.attributes.position;
    for (let v = 0; v < pos.count; v += 1) {
      const px = pos.getX(v); const py = pos.getY(v); const pz = pos.getZ(v);
      const k = 0.8 + 0.5 * smoothNoise3(px * 2.4 + a, py * 2.4, pz * 2.4);
      pos.setXYZ(v, px * k * w, py * k * h, pz * k * 0.17);
    }
    onSide(west, smoothed(blob, 1e-3), marbleHex(0.8), a, wTop + h * 0.72, 0.22);
  }
  const east = SIDES.east;
  tympanum(east, [[-PED_W, wTop], [-PED_W * 0.34, wTop], [-PED_W * 0.4, wTop + PED_H * 0.38], [-PED_W * 0.7, wTop + PED_H * 0.3]], marbleHex(0.84));
  tympanum(east, [[PED_W, wTop], [PED_W * 0.44, wTop], [PED_W * 0.5, wTop + PED_H * 0.3], [PED_W * 0.74, wTop + PED_H * 0.26]], marbleHex(0.84));
  rakeBand(east, 0, 0.32, -1);
  rakeBand(east, 0, 0.27, 1);

  // --- inside: raised floor, the great west wall with its door, low cella walls ----------------
  const WX0 = -9.7;
  const WX1 = 9.7;
  const WZ = 4.28;
  const WT = 0.46;
  parts.push({ geometry: feetBox(24.0, 0.08, 9.6, rng, 10, 1), color: hexOf(times(MARBLE, 0.9)), position: [-0.1, PTH.FLOOR + 0.04, 0] });
  const wallTone = () => hexOf(times(mix3(HONEY, WEATHERED, rng()), 0.9 + rng() * 0.08));
  // The long walls have been down since 1687. Each block column is its own height, stepped.
  for (const z of [-WZ, WZ]) {
    let x = WX0;
    const seed = z > 0 ? 3 : 8;
    while (x < WX1) {
      const len = 0.62 + rng() * 0.3;
      const n = smoothNoise3(x * 0.32 + seed, 1.3, z);
      const courses = Math.max(1, Math.round(n * n * 5 + rng() * 1.6));
      const h = courses * 0.3;
      parts.push({ geometry: feetBox(Math.min(len, WX1 - x), h, WT, rng, 1, Math.max(1, courses)), color: wallTone(), position: [x + len / 2, INNER_FLOOR + h / 2, z] });
      x += len;
    }
  }
  // The west cross wall stands to its full height, with the great door through it: two piers and
  // a lintel, a real opening, since a dark panel on a solid wall is not a door.
  const WALL_TOP = INNER_FLOOR + INNER_SHAFT + 0.47;
  const DOOR_HALF = 0.72;
  const DOOR_TOP = INNER_FLOOR + 3.1;
  for (const s of [-1, 1]) {
    const hw = (WZ + WT / 2 - DOOR_HALF) / 2;
    const centre = s * (DOOR_HALF + hw);
    parts.push({ geometry: feetBox(WT, WALL_TOP - INNER_FLOOR, hw * 2, rng, 1, 6), color: wallTone(), position: [WX0, (WALL_TOP + INNER_FLOOR) / 2, centre] });
    parts.push({ geometry: feetBox(WT + 0.12, DOOR_TOP - INNER_FLOOR, 0.14, rng), color: marbleHex(0.9), position: [WX0, (DOOR_TOP + INNER_FLOOR) / 2, s * (DOOR_HALF + 0.05)] });
  }
  parts.push({ geometry: feetBox(WT + 0.14, 0.42, DOOR_HALF * 2 + 0.5, rng), color: marbleHex(0.92), position: [WX0, DOOR_TOP + 0.21, 0] });
  parts.push({ geometry: feetBox(WT, WALL_TOP - DOOR_TOP - 0.42, DOOR_HALF * 2, rng), color: wallTone(), position: [WX0, (WALL_TOP + DOOR_TOP + 0.42) / 2, 0] });
  // Antae: the wall's ends, thickened, running out to meet the west porch.
  for (const z of [-WZ, WZ]) {
    parts.push({ geometry: feetBox(1.3, WALL_TOP - INNER_FLOOR, WT, rng, 1, 6), color: wallTone(), position: [WX0 - 0.42, (WALL_TOP + INNER_FLOOR) / 2, z] });
  }
  // The west porch's own lintel and frieze, with the Panathenaic band still on it.
  const PORCH_TOP = INNER_FLOOR + INNER_SHAFT + 0.47;
  parts.push({ geometry: feetBox(0.58, 0.4, WZ * 2 + WT, rng, 1, 1), color: marbleHex(0.96), position: [WEST_PORCH, PORCH_TOP + 0.2, 0] });
  parts.push({ geometry: feetBox(0.5, 0.42, WZ * 2 + WT, rng, 1, 1), color: marbleHex(0.84), position: [WEST_PORCH, PORCH_TOP + 0.61, 0] });
  // And the return of that lintel back to the wall, closing the porch at its two ends.
  for (const z of [-WZ, WZ]) {
    parts.push({ geometry: feetBox(1.4, 0.82, WT, rng), color: wallTone(), position: [(WEST_PORCH + WX0) / 2 - 0.05, PORCH_TOP + 0.41, z] });
  }
  // The ceiling beams still spanning the west peristyle, from that frieze across to the outer one.
  for (const z of [-4.0, -2.4, -0.8, 0.8, 2.4, 4.0]) {
    parts.push({ geometry: feetBox(2.5, 0.28, 0.3, rng), color: marbleHex(0.92), position: [-12.4, ARCH_Y1 + 0.2, z] });
  }
  // The east cross wall is gone but for its footing, and so is the door the church replaced.
  parts.push({ geometry: feetBox(WT, 0.3, WZ * 2, rng, 1, 1), color: wallTone(), position: [WX1, INNER_FLOOR + 0.15, 0] });
  // The dividing wall between the two rooms, low.
  parts.push({ geometry: feetBox(WT, 0.6, WZ * 2 - 0.2, rng, 1, 2), color: wallTone(), position: [-3.7, INNER_FLOOR + 0.3, 0] });
  // The poros foundation of Athena's statue: a dark rectangle in the floor of the east room, all
  // that is left of a figure 40ft tall.
  parts.push({ geometry: feetBox(3.3, 0.04, 2.0, rng, 3, 1), color: 0x5e5240, position: [4.6, INNER_FLOOR + 0.02, 0] });
  // A few fallen drums and blocks in the cella.
  for (const [x, z, r, len, rx] of [[0.4, -2.6, 0.32, 0.6, 0.3], [7.4, 2.6, 0.3, 0.55, 1.2], [-6.2, 1.8, 0.33, 0.58, 2.1], [-1.8, 3.2, 0.29, 0.5, 0.6]]) {
    parts.push({ geometry: new THREE.CylinderGeometry(r, r * 1.02, len, 20), color: marbleHex(0.9), position: [x, INNER_FLOOR + r * 0.96, z], rotation: [Math.PI / 2, 0, rx] });
  }
  for (let i = 0; i < 14; i += 1) {
    const x = (rng() * 2 - 1) * 8.5;
    const z = (rng() * 2 - 1) * 3.5;
    const s = 0.15 + rng() * 0.3;
    parts.push({ geometry: feetBox(s * 1.8, s * 0.8, s * 1.2, rng), color: marbleHex(0.85), position: [x, INNER_FLOOR + s * 0.4, z], rotation: [0, rng() * 3, 0] });
  }

  const buildingGeo = mergeParts(parts);

  // Weathering, all as a tint over what the blocks already carry.
  const weatherFn = (p, c) => {
    const broad = smoothNoise3(p.x * 0.22, p.y * 0.55, p.z * 0.22);
    const fine = smoothNoise3(p.x * 1.3, p.y * 1.9, p.z * 1.3);
    let k = 0.84 + broad * 0.24 + (fine - 0.5) * 0.12;
    k *= lerp(0.9, 1, smooth01(p.y / 1.4));
    const warm = clamp01(broad * 1.3 - 0.45) * 0.08;
    return [c.r * k * (1 + warm * 0.3), c.g * k, c.b * k * (1 - warm)];
  };
  tintGeometry(columnsGeo, weatherFn);
  tintGeometry(buildingGeo, weatherFn);

  // The refinements: no straight lines in the building. The platform rises toward the middle of
  // each side, about 4.3in in 228ft on the real thing, and the columns lean slightly inward. Both
  // are small enough to be felt rather than seen, which is the whole point of them.
  const refine = (g) => {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const rise = (0.036 * (1 - (x / 14.5) ** 2) + 0.02 * (1 - (z / 6.6) ** 2)) * Math.min(1, y / PTH.FLOOR);
      const above = Math.max(0, y - PTH.FLOOR);
      pos.setXYZ(i, x * (1 - 0.00048 * above), y + rise, z * (1 - 0.0011 * above));
    }
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
  };
  refine(columnsGeo);
  refine(buildingGeo);

  const columns = mesh(columnsGeo, standard({
    vertexColors: true, map: setRepeat(drumTile(5), 2.4, 1), roughness: 0.82, metalness: 0,
  }));
  const tile = setRepeat(ashlarTile(13), 2.4);
  const building = mesh(buildingGeo, stoneMaterial(tile, { bumpScale: 0.4, roughness: 0.88 }));
  const root = group(building, columns);
  root.userData.outerColumns = list.length;
  return root;
}

// ---------------------------------------------------------------------------
// The medieval castle
// ---------------------------------------------------------------------------

// A concentric castle of about 1280 at 1/8, typical rather than any one place: a square keep with
// corner turrets, a curtain wall with a real walkway behind its battlements, four round towers,
// and a twin-towered gatehouse on +Z with a drawbridge over the moat. The courtyard is open to the
// sky and has things in it, so it reads from above as a place and not a solid block.
const CST = {
  WALL: 8.5, // centre line of the curtain wall, from the castle's centre
  WALL_T: 0.82,
  WALL_H: 5.0, // walkway level, measured from the castle's ground
  ISLAND: 0.72, // ground level inside the moat
  TOWER_R: 1.75,
};

// Dressed coursed stone, near white. One tile is 4ft square and carries 20 courses, in running bond
// with a tone per block: that is every wall, without a block of it being geometry.
function coursedTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#efe9dc';
    ctx.fillRect(0, 0, w, h);
    const courses = 20;
    const ch = h / courses;
    for (let r = 0; r < courses; r += 1) {
      const offset = rng() * w;
      const seams = [];
      let x = 0;
      while (x < w - 50) {
        const len = Math.min(w - x, 60 + rng() * 100);
        const v = 214 + rng() * 38;
        ctx.fillStyle = `rgb(${v},${v * 0.975},${v * 0.92})`;
        const px = (x + offset) % w;
        ctx.fillRect(px, r * ch, len, ch);
        if (px + len > w) ctx.fillRect(px - w, r * ch, len, ch);
        seams.push(px);
        x += len;
      }
      ctx.fillStyle = 'rgba(70,62,52,0.54)';
      ctx.fillRect(0, r * ch, w, 3);
      for (const px of seams) ctx.fillRect(px, r * ch, 2.8, ch);
    }
    for (let i = 0; i < 3000; i += 1) {
      const v = 110 + rng() * 90;
      ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.86},${0.1 + rng() * 0.26})`;
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
    }
  });
}

// Slates: rows offset by half a slate, near white, for a cone or a pitched roof in slate colour.
function slateTile(seed) {
  const rng = seededRandom(seed);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#d8d8da';
    ctx.fillRect(0, 0, w, h);
    const rows = 12;
    const rh = h / rows;
    const cols = 12;
    const cw = w / cols;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c <= cols; c += 1) {
        const x = (c + (r % 2) * 0.5) * cw;
        const v = 184 + rng() * 68;
        ctx.fillStyle = `rgb(${v},${v},${v * 1.02})`;
        ctx.fillRect(x, r * rh, cw - 2, rh);
        ctx.fillStyle = 'rgba(20,20,26,0.7)';
        ctx.fillRect(x + cw - 2.5, r * rh, 2.5, rh);
      }
      const grad = ctx.createLinearGradient(0, r * rh, 0, r * rh + rh);
      grad.addColorStop(0, 'rgba(255,255,255,0.1)');
      grad.addColorStop(0.75, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(10,10,16,0.65)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, r * rh, w, rh);
    }
  });
}

// A closed lathe with a flat normal per profile segment and UVs in feet round a nominal radius, so
// a band is a band and a tile lands at one size. `rows` runs bottom to top. The u wraps a whole
// number of tiles, so the join in the coursing can never draw a line down a tower.
function latheBands(rows, { segments = 40, tileFeet = 4, nominal = null } = {}) {
  const r0 = nominal ?? Math.max(...rows.map((p) => p[0]));
  const tiles = Math.max(1, Math.round((Math.PI * 2 * r0) / tileFeet));
  const s = new Soup();
  const white = [1, 1, 1];
  const uAt = (k) => (k / segments) * tiles * tileFeet;
  let run = 0;
  for (let j = 0; j < rows.length - 1; j += 1) {
    const [ra, ya] = rows[j];
    const [rb, yb] = rows[j + 1];
    const seg = Math.hypot(ra - rb, ya - yb);
    if (seg < 1e-5) continue;
    for (let k = 0; k < segments; k += 1) {
      const a0 = (k / segments) * Math.PI * 2;
      const a1 = ((k + 1) / segments) * Math.PI * 2;
      const p = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
      s.quad(
        p(a0, ra, ya), p(a1, ra, ya), p(a1, rb, yb), p(a0, rb, yb),
        [[uAt(k), run], [uAt(k + 1), run], [uAt(k + 1), run + seg], [uAt(k), run + seg]],
        white,
      );
    }
    run += seg;
  }
  // Smooth round the drum, leaving the bands flat: the normal keeps its slope and takes its
  // heading from the vertex's own bearing.
  const g = s.geometry();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i); const z = pos.getZ(i);
    const ny = nor.getY(i);
    const flat = Math.hypot(nor.getX(i), nor.getZ(i));
    const len = Math.hypot(x, z);
    if (len > 1e-5 && flat > 1e-3) nor.setXYZ(i, (x / len) * flat, ny, (z / len) * flat);
  }
  return g;
}

function medievalCastle() {
  const rng = seededRandom(1280);
  const stone = [];
  const slate = [];
  const trim = [];
  const G = CST.ISLAND;
  const STONE = 0xa79f8f;
  const STONE_DARK = 0x8d8576;
  const STONE_PALE = 0xbab2a2;
  const DRESSED = 0xcbc3b2;
  const VOID = 0x0d0b09;
  const OAK = 0x5d4228;
  const IRON = 0x2b2a2c;
  const SLATE = 0x56606e;
  const tone = () => new THREE.Color([STONE, STONE, STONE_DARK, STONE_PALE][Math.floor(rng() * 4)]).getHex();
  const S = (geometry, color, position, rotation = null) => stone.push({ geometry, color, position, rotation });
  const T = (geometry, color, position, rotation = null) => trim.push({ geometry, color, position, rotation });

  // An arrow slit is a cross-shaped dark loop with dressed jambs standing proud of the wall; there
  // is no CSG, so the frame's own shadow is what says the hole goes in.
  const arrowLoop = (x, y, z, rotY, h = 0.72) => {
    const place = (lx, ly, lz) => {
      const c = Math.cos(rotY); const n = Math.sin(rotY);
      return [x + lx * c + lz * n, y + ly, z - lx * n + lz * c];
    };
    T(new THREE.BoxGeometry(0.07, h, 0.03), VOID, place(0, 0, 0.022), [0, rotY, 0]);
    for (const s of [-1, 1]) {
      S(feetBox(0.05, h + 0.12, 0.06, rng), STONE_PALE, place(s * 0.06, 0, 0.012), [0, rotY, 0]);
    }
    S(feetBox(0.17, 0.05, 0.07, rng), STONE_PALE, place(0, h / 2 + 0.04, 0.016), [0, rotY, 0]);
    S(feetBox(0.17, 0.05, 0.07, rng), STONE_PALE, place(0, -h / 2 - 0.04, 0.016), [0, rotY, 0]);
    // The cross-slit for a crossbow's traverse, proud of the jambs so it shows on both sides.
    T(new THREE.BoxGeometry(0.26, 0.05, 0.015), VOID, place(0, h * 0.12, 0.05), [0, rotY, 0]);
  };

  // A round-headed window with a dark panel and a dressed frame, built forward of the wall.
  const archWindow = (x, y, z, rotY, w = 0.5, h = 0.92) => {
    const place = (lx, ly, lz) => {
      const c = Math.cos(rotY); const n = Math.sin(rotY);
      return [x + lx * c + lz * n, y + ly, z - lx * n + lz * c];
    };
    const outline = [[-w / 2, -h / 2], [w / 2, -h / 2]];
    const spring = h / 2 - w / 2;
    for (let i = 0; i <= 8; i += 1) {
      const a = (i / 8) * Math.PI;
      outline.push([Math.cos(a) * w / 2, spring + Math.sin(a) * w / 2]);
    }
    T(extrudeOutline(outline, 0.03), VOID, place(0, 0, 0.018), [0, rotY, 0]);
    for (const s of [-1, 1]) S(feetBox(0.07, h - w / 2 + 0.06, 0.08, rng), DRESSED, place(s * (w / 2 + 0.03), -w / 4, 0.024), [0, rotY, 0]);
    S(feetBox(w + 0.2, 0.06, 0.1, rng), DRESSED, place(0, -h / 2 - 0.03, 0.03), [0, rotY, 0]);
    // The voussoirs of the head, as a ring of short dressed blocks.
    for (let i = 0; i < 7; i += 1) {
      const a = ((i + 0.5) / 7) * Math.PI;
      const c = Math.cos(a); const n = Math.sin(a);
      S(feetBox(0.09, 0.09, 0.08, rng), DRESSED, place(c * (w / 2 + 0.04), spring + n * (w / 2 + 0.04), 0.024), [0, rotY, a]);
    }
  };

  // Crenellations on a straight run. The merlons are real and they STAND ON the wall top, with a
  // parapet under them so nothing can float, and a loop cut in every other one.
  const parapetRun = (a0, a1, faceAt, y, rotY, { thick = 0.2, pitch = 0.66, mh = 0.46, wallH = 0.3 } = {}) => {
    const c = Math.cos(rotY); const n = Math.sin(rotY);
    const place = (la, ly, lo) => [la * c + lo * n, ly, -la * n + lo * c];
    const len = a1 - a0;
    S(feetBox(len, wallH, thick, rng, Math.max(1, Math.round(len / 1.5)), 1), tone(), place((a0 + a1) / 2, y + wallH / 2, faceAt - thick / 2), [0, rotY, 0]);
    const count = Math.max(1, Math.floor(len / pitch));
    const step = len / count;
    for (let i = 0; i < count; i += 1) {
      const a = a0 + (i + 0.5) * step;
      S(feetBox(step * 0.58, mh, thick, rng), tone(), place(a, y + wallH + mh / 2 - 0.01, faceAt - thick / 2), [0, rotY, 0]);
      S(feetBox(step * 0.62, 0.035, thick + 0.03, rng), DRESSED, place(a, y + wallH + mh, faceAt - thick / 2), [0, rotY, 0]);
      if (i % 2 === 0) T(new THREE.BoxGeometry(0.05, 0.24, 0.02), VOID, place(a, y + wallH + mh * 0.48, faceAt + 0.005), [0, rotY, 0]);
    }
  };

  // Crenellations on a round tower: wedge-faced merlons tangent to the drum, on a ring parapet.
  const ringMerlons = (cx, cz, r, y, count, mh = 0.42, thick = 0.2) => {
    const pitch = (Math.PI * 2 * r) / count;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * Math.PI * 2;
      S(feetBox(pitch * 0.58, mh, thick, rng), tone(), [cx + Math.sin(a) * (r - thick / 2), y + mh / 2 - 0.01, cz + Math.cos(a) * (r - thick / 2)], [0, a, 0]);
      S(feetBox(pitch * 0.62, 0.035, thick + 0.03, rng), DRESSED, [cx + Math.sin(a) * (r - thick / 2), y + mh, cz + Math.cos(a) * (r - thick / 2)], [0, a, 0]);
    }
  };

  // A banner on a pole with a real waving, closed cloth. Colours by the tint, in big simple shapes.
  const banner = (x, y, z, { h = 1.6, len = 1.25, deep = 0.56, yaw = 0.3, c1 = 0xb51d24, c2 = 0xe6b422, swallow = true }) => {
    T(new THREE.CylinderGeometry(0.022, 0.032, h, 7), OAK, [x, y + h / 2, z]);
    T(new THREE.SphereGeometry(0.05, 8, 6), 0xd4a93a, [x, y + h + 0.04, z]);
    const cy = y + h - deep / 2 - 0.05;
    const cloth = solidSurface({
      nu: 24,
      nv: 8,
      point: (u, v) => {
        const waveZ = Math.sin(u * 7.5 + 0.6) * 0.09 * u;
        const droop = u * u * 0.08;
        const narrow = 1 - 0.1 * u;
        const px = u * len;
        const py = (v - 0.5) * deep * narrow - droop + Math.sin(u * 5) * 0.012;
        return [px * Math.cos(yaw) + waveZ * Math.sin(yaw), py, -px * Math.sin(yaw) + waveZ * Math.cos(yaw)];
      },
      thick: () => 0.012,
    });
    const A = new THREE.Color(c1);
    const B = new THREE.Color(c2);
    tintGeometry(cloth, (p) => {
      // Quartered, which is good heraldry and not by accident any nation's flag.
      const along = Math.hypot(p.x, p.z) / len;
      const c = (along < 0.5) === (p.y > 0) ? A : B;
      return [c.r, c.g, c.b];
    });
    // A swallowtail: the two last columns of the cloth pulled in at the middle of the fly.
    if (swallow) {
      const pos = cloth.attributes.position;
      for (let i = 0; i < pos.count; i += 1) {
        const px = pos.getX(i); const py = pos.getY(i); const pz = pos.getZ(i);
        const along = Math.hypot(px, pz) / len;
        if (along > 0.7) {
          const pull = ((along - 0.7) / 0.3) * Math.max(0, 1 - Math.abs(py) / (deep * 0.42));
          pos.setXYZ(i, px * (1 - pull * 0.3), py, pz * (1 - pull * 0.3));
        }
      }
      cloth.computeVertexNormals();
    }
    trim.push({ geometry: cloth, keepColor: true, position: [x, cy, z] });
  };

  // --- the curtain wall, with its walkway and battlements --------------------------------------
  const W = CST.WALL;
  const TH = CST.WALL_T;
  const WALK = G + CST.WALL_H;
  const sides = [0, Math.PI / 2, Math.PI, -Math.PI / 2]; // +Z, +X, -Z, -X
  const towerGap = CST.TOWER_R * 0.75;
  const GATE_HALF = 1.72;
  for (let si = 0; si < 4; si += 1) {
    const rotY = sides[si];
    const c = Math.cos(rotY); const n = Math.sin(rotY);
    const place = (la, y, lo) => [la * c + lo * n, y, -la * n + lo * c];
    const runs = si === 0 ? [[-W + towerGap, -GATE_HALF], [GATE_HALF, W - towerGap]] : [[-W + towerGap, W - towerGap]];
    for (const [a0, a1] of runs) {
      const len = a1 - a0;
      S(feetBox(len, CST.WALL_H, TH, rng, Math.round(len / 1.2), 6), STONE, place((a0 + a1) / 2, G + CST.WALL_H / 2, W), [0, rotY, 0]);
      // A battered plinth along the foot of the wall.
      S(feetBox(len, 0.5, TH + 0.2, rng, Math.round(len / 2), 1), STONE_DARK, place((a0 + a1) / 2, G + 0.25, W), [0, rotY, 0]);
      parapetRun(a0, a1, W + TH / 2 + 0.05, WALK, rotY);
      // The dressed string course under the battlements.
      S(feetBox(len, 0.07, TH + 0.2, rng), DRESSED, place((a0 + a1) / 2, WALK - 0.03, W + 0.03), [0, rotY, 0]);
      // Arrow loops along the wall, on the outside.
      const loops = Math.max(1, Math.round(len / 2.6));
      for (let i = 0; i < loops; i += 1) {
        const a = a0 + ((i + 0.5) / loops) * len;
        arrowLoop(...place(a, G + 2.6, W + TH / 2), rotY);
      }
      // And a low rail on the courtyard side, which is what makes it a walkway.
      S(feetBox(len, 0.16, 0.1, rng), STONE_DARK, place((a0 + a1) / 2, WALK + 0.08, W - TH / 2 + 0.05), [0, rotY, 0]);
    }
  }

  // --- four round towers. Two carry conical slate roofs; two are open fighting tops ------------
  const R = CST.TOWER_R;
  const TOWER_TOP = G + CST.WALL_H + 1.5;
  const corners = [[W, W, true], [-W, W, false], [-W, -W, true], [W, -W, false]];
  corners.forEach(([x, z, conical], ci) => {
    const rows = [
      [0, G - 0.02], [R + 0.5, G - 0.02], [R + 0.5, G + 0.08], [R + 0.08, G + 1.0], [R, G + 1.1],
      [R, TOWER_TOP - 0.3], [R + 0.03, TOWER_TOP - 0.3], [R + 0.03, TOWER_TOP - 0.24],
      [R + 0.28, TOWER_TOP - 0.02], [R + 0.28, TOWER_TOP], [R + 0.28, TOWER_TOP + 0.3],
      [R + 0.08, TOWER_TOP + 0.3], [R + 0.08, TOWER_TOP + 0.05], [0, TOWER_TOP + 0.05],
    ];
    stone.push({ geometry: latheBands(rows, { segments: 44, nominal: R }), color: STONE, position: [x, 0, z] });
    // Machicolation corbels ringing the drum under the fighting top.
    for (let i = 0; i < 18; i += 1) {
      const a = (i / 18) * Math.PI * 2;
      S(feetBox(0.14, 0.24, 0.32, rng), STONE_DARK, [x + Math.sin(a) * (R + 0.12), TOWER_TOP - 0.2, z + Math.cos(a) * (R + 0.12)], [0, a, 0]);
    }
    ringMerlons(x, z, R + 0.28, TOWER_TOP + 0.3, 13);
    // Arrow loops round the outward half of the drum, at two levels, staggered.
    const bearing = Math.atan2(x, z);
    for (let i = -2; i <= 2; i += 1) {
      const a = bearing + i * 0.66;
      for (const [yy, skip] of [[G + 2.4, 0], [G + 4.5, 1]]) {
        if ((i + 2) % 2 === skip) arrowLoop(x + Math.sin(a) * R, yy, z + Math.cos(a) * R, a, 0.68);
      }
    }
    if (conical) {
      const roofY = TOWER_TOP + 0.3;
      const roofR = R + 0.2;
      const coneRows = [[0, roofY - 0.02], [roofR + 0.14, roofY - 0.02], [roofR + 0.14, roofY + 0.02], [roofR * 0.92, roofY + 0.35], [roofR * 0.5, roofY + 2.1], [0.05, roofY + 3.5], [0, roofY + 3.5]];
      slate.push({ geometry: latheBands(coneRows, { segments: 36, tileFeet: 2.4, nominal: roofR }), color: ci === 0 ? SLATE : 0x4c5664, position: [x, 0, z] });
      banner(x, roofY + 3.42, z, { h: 1.05, len: 1.05, deep: 0.5, yaw: 0.35, c1: ci === 0 ? 0xb51d24 : 0x1f4e9e, c2: 0xe6b422 });
    } else {
      // An open top with a timber hoard post and a small flag, to stand a watchman on.
      S(feetBox(R * 1.1, 0.03, R * 1.1, rng), STONE_DARK, [x, TOWER_TOP + 0.06, z]);
      banner(x, TOWER_TOP + 0.05, z, { h: 2.2, len: 0.9, deep: 0.42, yaw: -0.5, c1: 0xe6b422, c2: 0xb51d24, swallow: false });
    }
  });

  // --- the gatehouse on +Z: twin drum towers, an arched passage, portcullis, drawbridge --------
  {
    const FACE = W + TH / 2 + 1.05; // the front of the gate block
    const BLOCK_D = TH + 2.4;
    const GZ = FACE - BLOCK_D / 2;
    const GATE_H = 6.3;
    const OPEN_HALF = 0.72;
    const SPRING = 1.55;
    // Two piers and an arched head, so the gate passage is a genuine opening: from outside you
    // see through the portcullis, down a dark vault, to the light of the courtyard.
    const archPts = [];
    for (let i = 0; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI;
      archPts.push([Math.cos(a) * OPEN_HALF, SPRING + Math.sin(a) * OPEN_HALF]);
    }
    // Two piers with a head over them: an outline with an arched bite out of its foot would need
    // its centroid above the arch for extrudeOutline's centre fan to work, and it would not be.
    for (const s of [-1, 1]) {
      const cx = s * (OPEN_HALF + GATE_HALF) / 2;
      S(feetBox(GATE_HALF - OPEN_HALF, SPRING, BLOCK_D, rng, 1, 3), STONE, [cx, G + SPRING / 2, GZ]);
    }
    const head = [[GATE_HALF, SPRING], [GATE_HALF, GATE_H], [-GATE_HALF, GATE_H], [-GATE_HALF, SPRING], ...archPts.slice().reverse()];
    const headGeo = extrudeOutline(head, BLOCK_D);
    // extrudeOutline runs u along the outline, so on an upright face the courses would stand on
    // end. Everything is relaid in feet from the vertex's own position.
    {
      const pp = headGeo.attributes.position;
      const nn = headGeo.attributes.normal;
      const uu = headGeo.attributes.uv;
      for (let i = 0; i < pp.count; i += 1) {
        const up = Math.abs(nn.getY(i)) > 0.7;
        uu.setXY(i, Math.abs(nn.getX(i)) > 0.5 ? pp.getZ(i) : pp.getX(i), up ? pp.getZ(i) : pp.getY(i));
      }
    }
    S(headGeo, STONE, [0, G, GZ]);
    // The underside of the vault, near black: the passage is unlit.
    const vault = [];
    for (let i = 0; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI;
      vault.push([Math.cos(a) * OPEN_HALF, SPRING + Math.sin(a) * OPEN_HALF]);
    }
    {
      const s = new Soup();
      const dark = [0.012, 0.01, 0.009];
      const dim = [0.05, 0.043, 0.036];
      const zF = GZ + BLOCK_D / 2;
      const zB = GZ - BLOCK_D / 2;
      for (let i = 0; i < 12; i += 1) {
        const a = vault[i]; const b = vault[i + 1];
        s.quad([b[0], b[1] + G, zF], [a[0], a[1] + G, zF], [a[0], a[1] + G, zB], [b[0], b[1] + G, zB], [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], [dark, dark, dim, dim]);
      }
      for (const side of [-1, 1]) {
        const x = side * OPEN_HALF;
        const a = [x, G, zF]; const b = [x, G, zB]; const c = [x, G + SPRING, zB]; const d = [x, G + SPRING, zF];
        if (side > 0) s.quad(a, b, c, d, [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], [dark, dim, dim, dark]);
        else s.quad(b, a, d, c, [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], [dim, dark, dark, dim]);
      }
      trim.push({ geometry: s.geometry(), keepColor: true });
    }
    // Paving through the passage, darkening inward, so the arch does not frame a strip of lawn.
    {
      const s = new Soup();
      const lit = [0.1, 0.09, 0.075];
      const dim = [0.018, 0.016, 0.014];
      const zF = FACE + 0.02;
      const zB = GZ - BLOCK_D / 2;
      s.quad([-OPEN_HALF, G + 0.015, zF], [OPEN_HALF, G + 0.015, zF], [OPEN_HALF, G + 0.015, zB], [-OPEN_HALF, G + 0.015, zB], [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1]], [lit, lit, dim, dim]);
      trim.push({ geometry: s.geometry(), keepColor: true });
    }
    // The dressed arch ring round the opening.
    for (let i = 0; i < 13; i += 1) {
      const a = (i / 12) * Math.PI;
      const rr = OPEN_HALF + 0.09;
      S(feetBox(0.2, 0.24, 0.1, rng), DRESSED, [Math.cos(a) * rr, G + SPRING + Math.sin(a) * rr, FACE + 0.02], [0, 0, a - Math.PI / 2]);
    }
    for (const s of [-1, 1]) S(feetBox(0.18, SPRING, 0.1, rng), DRESSED, [s * (OPEN_HALF + 0.09), G + SPRING / 2, FACE + 0.02]);
    // The portcullis, half lowered, its bars seen against the dark: a real grid of oak and iron.
    const PORT_Z = FACE - 0.3;
    for (let i = 0; i < 7; i += 1) {
      const x = -OPEN_HALF + 0.09 + (i / 6) * (OPEN_HALF * 2 - 0.18);
      T(new THREE.BoxGeometry(0.055, SPRING + OPEN_HALF - 0.1, 0.055), IRON, [x, G + 0.34 + (SPRING + OPEN_HALF - 0.1) / 2, PORT_Z]);
      // The iron spikes along its foot.
      T(new THREE.ConeGeometry(0.04, 0.14, 4), IRON, [x, G + 0.28, PORT_Z], [Math.PI, 0, 0]);
    }
    for (let j = 0; j < 7; j += 1) {
      T(new THREE.BoxGeometry(OPEN_HALF * 2, 0.05, 0.05), OAK, [0, G + 0.42 + j * 0.3, PORT_Z]);
    }

    // A dressed string course and crenellated top.
    S(feetBox(GATE_HALF * 2 + 0.1, 0.08, BLOCK_D + 0.1, rng), DRESSED, [0, G + GATE_H - 0.02, GZ]);
    parapetRun(-GATE_HALF, GATE_HALF, FACE + 0.06, G + GATE_H, 0, { pitch: 0.62, mh: 0.42, wallH: 0.28 });
    parapetRun(-GATE_HALF, GATE_HALF, -(GZ - BLOCK_D / 2) + 0.05, G + GATE_H, Math.PI, { pitch: 0.62, mh: 0.42, wallH: 0.2 });
    // Machicolations and a slit over the gate, and a coat of arms on a shield.
    archWindow(0, G + 4.25, FACE, 0, 0.42, 0.78);
    // A heater shield over the arch: red, with a gold chevron.
    const shield = [[-0.36, 0.4], [-0.36, 0.02], [-0.3, -0.18], [-0.16, -0.36], [0, -0.46], [0.16, -0.36], [0.3, -0.18], [0.36, 0.02], [0.36, 0.4]];
    T(extrudeOutline(shield, 0.04), 0xa81c22, [0, G + 3.2, FACE + 0.03]);
    T(extrudeOutline([[-0.3, -0.12], [0, 0.18], [0.3, -0.12], [0.3, -0.27], [0, 0.03], [-0.3, -0.27]], 0.02), 0xe0b02a, [0, G + 3.2, FACE + 0.056]);
    for (let i = 0; i < 6; i += 1) {
      S(feetBox(0.16, 0.3, 0.28, rng), STONE_DARK, [-GATE_HALF + 0.36 + i * 0.54, G + GATE_H - 0.34, FACE + 0.1]);
    }

    // The flanking drums, D-shaped in plan, standing forward of the gate.
    const DR = 1.1;
    const DRUM_TOP = G + GATE_H + 0.75;
    for (const s of [-1, 1]) {
      const dx = s * (GATE_HALF + 0.42);
      const dz = FACE - 0.45;
      const rows = [
        [0, G - 0.02], [DR + 0.36, G - 0.02], [DR + 0.36, G + 0.07], [DR + 0.06, G + 0.9], [DR, G + 1.0],
        [DR, DRUM_TOP - 0.26], [DR + 0.2, DRUM_TOP - 0.04], [DR + 0.2, DRUM_TOP + 0.24],
        [DR + 0.04, DRUM_TOP + 0.24], [DR + 0.04, DRUM_TOP + 0.03], [0, DRUM_TOP + 0.03],
      ];
      stone.push({ geometry: latheBands(rows, { segments: 36, nominal: DR }), color: STONE, position: [dx, 0, dz] });
      ringMerlons(dx, dz, DR + 0.2, DRUM_TOP + 0.24, 10);
      for (const a of [0.1 * s, s * 0.95]) arrowLoop(dx + Math.sin(a) * DR, G + 2.5, dz + Math.cos(a) * DR, a, 0.62);
      arrowLoop(dx + Math.sin(s * 0.5) * DR, G + 4.4, dz + Math.cos(s * 0.5) * DR, s * 0.5, 0.62);
      banner(dx, DRUM_TOP, dz, { h: 1.6, len: 0.96, deep: 0.44, yaw: 0.2, c1: 0x1f4e9e, c2: 0xf0eee6 });
    }

    // The drawbridge: lowered oak planks on two beams, from the gate across the moat to a stone
    // abutment, held by chains from slots above the arch.
    const BRIDGE_Y = G + 0.03;
    const BRIDGE_Z0 = FACE + 0.04;
    const BRIDGE_Z1 = FACE + 3.1;
    const planks = Math.round((BRIDGE_Z1 - BRIDGE_Z0) / 0.24);
    for (let i = 0; i < planks; i += 1) {
      const z = lerp(BRIDGE_Z0, BRIDGE_Z1, (i + 0.5) / planks);
      T(new THREE.BoxGeometry(OPEN_HALF * 2 + 0.2, 0.05, 0.22), [0x6b4c2e, 0x5d4228, 0x76563a][i % 3], [0, BRIDGE_Y - (i / planks) * 0.1, z]);
    }
    for (const s of [-1, 1]) {
      const span = BRIDGE_Z1 - BRIDGE_Z0;
      T(new THREE.BoxGeometry(0.1, 0.1, span), 0x47321f, [s * (OPEN_HALF - 0.05), BRIDGE_Y - 0.1, (BRIDGE_Z0 + BRIDGE_Z1) / 2]);
      // The chain: an iron rod from the outer end of the bridge up to the wall.
      const from = new THREE.Vector3(s * (OPEN_HALF + 0.05), BRIDGE_Y + 0.02, BRIDGE_Z0 + 1.5);
      const to = new THREE.Vector3(s * (OPEN_HALF + 0.05), G + SPRING + OPEN_HALF + 0.6, FACE + 0.02);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const len = from.distanceTo(to);
      const rod = new THREE.CylinderGeometry(0.018, 0.018, len, 5);
      rod.lookAt(to.clone().sub(from));
      rod.rotateX(Math.PI / 2);
      T(rod, IRON, [mid.x, mid.y, mid.z]);
    }
    // The stone abutment across the moat, with a little causeway.
    S(feetBox(OPEN_HALF * 2 + 0.7, 0.42, 0.9, rng), STONE_DARK, [0, 0.42, BRIDGE_Z1 + 0.35]);
    S(feetBox(OPEN_HALF * 2 + 0.5, 0.05, 0.9, rng), DRESSED, [0, 0.645, BRIDGE_Z1 + 0.35]);
  }

  // --- the keep, set a little behind the centre of the courtyard -------------------------------
  {
    const KH = 3.6; // half-width
    const KZ = -1.1;
    const KEEP_TOP = G + 10.2;
    const KY = G;
    S(feetBox(KH * 2 + 0.36, 0.55, KH * 2 + 0.36, rng, 6, 1), STONE_DARK, [0, KY + 0.27, KZ]);
    S(feetBox(KH * 2, KEEP_TOP - KY, KH * 2, rng, 6, 10), STONE, [0, (KEEP_TOP + KY) / 2, KZ]);
    // Flat buttresses up each face, and three string courses: what makes a Norman keep read.
    for (let si = 0; si < 4; si += 1) {
      const rotY = sides[si];
      const c = Math.cos(rotY); const n = Math.sin(rotY);
      const place = (la, y, lo) => [la * c + lo * n, y, KZ - la * n + lo * c];
      for (const a of [-1.2, 1.2]) {
        S(feetBox(0.34, KEEP_TOP - KY - 0.6, 0.1, rng, 1, 6), STONE_PALE, place(a, (KEEP_TOP + KY) / 2 - 0.1, KH + 0.04), [0, rotY, 0]);
      }
      for (const yy of [KY + 3.2, KY + 6.3, KEEP_TOP - 0.26]) {
        S(feetBox(KH * 2 + 0.1, 0.07, 0.1, rng), DRESSED, place(0, yy, KH + 0.02), [0, rotY, 0]);
      }
      // Windows, growing as they go up, the way a keep's do: slits low, proper lights high.
      for (const a of [-2.3, 0, 2.3]) {
        archWindow(...place(a, KY + 7.7, KH), rotY, 0.44, 0.92);
        if (!(si === 0 && a === 0)) arrowLoop(...place(a, KY + 4.6, KH), rotY, 0.72);
        if (a !== 0) arrowLoop(...place(a, KY + 1.8, KH), rotY, 0.62);
      }
      parapetRun(-KH, KH, KH + 0.09, KEEP_TOP, rotY + 0, { pitch: 0.62, mh: 0.4, wallH: 0.24 });
    }
    // The steep roof behind the battlements: a real gable, a solid, with slate running down it.
    const roofY = KEEP_TOP + 0.02;
    const HALF = KH - 0.35;
    const RIDGE = 1.75;
    const s = new Soup();
    const c = [1, 1, 1];
    const slopeLen = Math.hypot(HALF, RIDGE);
    const uv = (a, b) => [a, b];
    const LZ = HALF;
    // Long axis along X, so the slopes face +Z and -Z and the gables face +X and -X.
    s.quad([-LZ, roofY, HALF + KZ], [LZ, roofY, HALF + KZ], [LZ, roofY + RIDGE, KZ], [-LZ, roofY + RIDGE, KZ], [uv(0, 0), uv(LZ * 2, 0), uv(LZ * 2, slopeLen), uv(0, slopeLen)], c);
    s.quad([LZ, roofY, -HALF + KZ], [-LZ, roofY, -HALF + KZ], [-LZ, roofY + RIDGE, KZ], [LZ, roofY + RIDGE, KZ], [uv(0, 0), uv(LZ * 2, 0), uv(LZ * 2, slopeLen), uv(0, slopeLen)], c);
    slate.push({ geometry: s.geometry(), color: SLATE });
    for (const sign of [-1, 1]) {
      const gable = new Soup();
      const x = sign * LZ;
      const pa = [x, roofY, sign > 0 ? KZ + HALF : KZ - HALF];
      const pb = [x, roofY, sign > 0 ? KZ - HALF : KZ + HALF];
      const pc = [x, roofY + RIDGE, KZ];
      gable.tri(pa, pb, pc, [0, 0], [HALF * 2, 0], [HALF, RIDGE], c, c, c);
      stone.push({ geometry: gable.geometry(), color: STONE });
    }

    // Four corner turrets rising above the battlements, each with a little conical slate cap.
    const TR = 0.82;
    const TURRET_TOP = KEEP_TOP + 1.45;
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const tx = sx * (KH - 0.08);
      const tz = KZ + sz * (KH - 0.08);
      const rows = [[0, KY], [TR + 0.05, KY], [TR, KY + 0.6], [TR, TURRET_TOP - 0.18], [TR + 0.12, TURRET_TOP - 0.04], [TR + 0.12, TURRET_TOP + 0.14], [TR, TURRET_TOP + 0.14], [TR, TURRET_TOP + 0.03], [0, TURRET_TOP + 0.03]];
      stone.push({ geometry: latheBands(rows, { segments: 30, nominal: TR }), color: STONE_PALE, position: [tx, 0, tz] });
      ringMerlons(tx, tz, TR + 0.12, TURRET_TOP + 0.14, 8, 0.32, 0.14);
      const coneRows = [[0, TURRET_TOP + 0.08], [TR * 0.84, TURRET_TOP + 0.08], [TR * 0.74, TURRET_TOP + 0.25], [TR * 0.3, TURRET_TOP + 1.05], [0.03, TURRET_TOP + 1.65], [0, TURRET_TOP + 1.65]];
      slate.push({ geometry: latheBands(coneRows, { segments: 24, tileFeet: 2.4, nominal: TR }), color: SLATE, position: [tx, 0, tz] });
      for (const a of [sx * 0.8, sx * 2.3]) arrowLoop(tx + Math.sin(a) * TR, KY + 8.9, tz + Math.cos(a) * TR, a, 0.56);
    }
    // The great flag on the keep's ridge, the highest thing in the castle.
    banner(0, roofY + RIDGE - 0.02, KZ, { h: 1.75, len: 1.5, deep: 0.74, yaw: 0.25, c1: 0xb51d24, c2: 0xe6b422 });

    // The door is on the first floor, reached up an outside timber stair: if the yard falls, the
    // stair can be burned and the keep still holds.
    const DOOR_Y = KY + 2.5;
    archWindow(0, DOOR_Y, KH + KZ, 0, 0.56, 1.05);
    T(new THREE.BoxGeometry(1.1, 0.07, 0.65), OAK, [0, DOOR_Y - 0.58, KH + KZ + 0.38]);
    for (const x of [-0.5, 0.5]) T(new THREE.BoxGeometry(0.08, DOOR_Y - 0.6 - KY, 0.08), 0x47321f, [x, KY + (DOOR_Y - 0.6 - KY) / 2, KH + KZ + 0.62]);
    const STEPS = 11;
    for (let i = 0; i < STEPS; i += 1) {
      const t = (i + 0.5) / STEPS;
      const y = lerp(DOOR_Y - 0.58, KY + 0.04, t);
      T(new THREE.BoxGeometry(0.7, 0.05, 0.22), OAK, [0, y, KH + KZ + 0.72 + t * 1.8]);
    }
    for (const x of [-0.37, 0.37]) {
      const from = new THREE.Vector3(x, DOOR_Y - 0.5, KH + KZ + 0.72);
      const to = new THREE.Vector3(x, KY + 0.05, KH + KZ + 2.62);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      const rod = new THREE.BoxGeometry(0.06, 0.1, from.distanceTo(to));
      rod.lookAt(to.clone().sub(from));
      T(rod, 0x47321f, [mid.x, mid.y - 0.02, mid.z]);
    }
  }

  // --- the courtyard: a great hall against the west wall, stables against the east, a well ------
  {
    const inner = W - TH / 2;
    const gable = (x, z, lenX, depthZ, wallH, rise, colour) => {
      // Long axis along Z: slopes face +X and -X.
      S(feetBox(depthZ, wallH, lenX, rng, 3, 3), STONE_PALE, [x, G + wallH / 2, z]);
      const hw = depthZ / 2 + 0.14;
      const hl = lenX / 2 + 0.14;
      const y0 = G + wallH;
      const y1 = y0 + rise;
      const r = new Soup();
      const c = [1, 1, 1];
      const sl = Math.hypot(hw, rise);
      r.quad([x + hw, y0, z + hl], [x + hw, y0, z - hl], [x, y1, z - hl], [x, y1, z + hl], [[0, 0], [hl * 2, 0], [hl * 2, sl], [0, sl]], c);
      r.quad([x - hw, y0, z - hl], [x - hw, y0, z + hl], [x, y1, z + hl], [x, y1, z - hl], [[0, 0], [hl * 2, 0], [hl * 2, sl], [0, sl]], c);
      slate.push({ geometry: r.geometry(), color: colour });
      for (const sign of [-1, 1]) {
        const gb = new Soup();
        const zz = z + sign * (hl - 0.14);
        const a = [x + (sign > 0 ? -1 : 1) * (depthZ / 2), y0, zz];
        const b = [x + (sign > 0 ? 1 : -1) * (depthZ / 2), y0, zz];
        gb.tri(a, b, [x, y1, zz], [0, 0], [depthZ, 0], [depthZ / 2, rise], c, c, c);
        stone.push({ geometry: gb.geometry(), color: STONE_PALE });
      }
    };
    // The great hall: tall roof, three lit windows on its courtyard side.
    const HX = -inner + 1.15;
    gable(HX, 2.4, 6.2, 2.2, 2.3, 1.45, 0x5b4f4a);
    for (const z of [0.5, 2.4, 4.3]) archWindow(HX + 1.1, G + 1.3, z, Math.PI / 2, 0.42, 1.2);
    // The stables and stores, lower, under clay tiles.
    const SX = inner - 0.95;
    gable(SX, 0.2, 7.2, 1.8, 1.25, 0.95, 0x8b5a40);
    for (const z of [-2.6, -1.2, 0.2, 1.6, 3]) T(new THREE.BoxGeometry(0.03, 0.8, 0.6), 0x24190f, [SX - 0.91, G + 0.42, z]);
    // A stone stair up to the walkway on each side of the gate.
    for (const s of [-1, 1]) {
      const N = 16;
      for (let i = 0; i < N; i += 1) {
        const t = (i + 1) / N;
        const h = (WALK - G) * t;
        S(feetBox(0.56, h, 0.32, rng), STONE_DARK, [s * (2.55 + t * 3.2), G + h / 2, inner - 0.28]);
      }
    }
    // The well: a round stone kerb with a little timber frame over it.
    const wellX = 3.8;
    const wellZ = 5.2;
    stone.push({ geometry: latheBands([[0.36, G], [0.46, G], [0.46, G + 0.42], [0.32, G + 0.42], [0.32, G + 0.1], [0, G + 0.1]], { segments: 18, nominal: 0.46 }), color: STONE_PALE, position: [wellX, 0, wellZ] });
    T(new THREE.CircleGeometry(0.31, 18), VOID, [wellX, G + 0.115, wellZ], [-Math.PI / 2, 0, 0]);
    for (const s of [-1, 1]) T(new THREE.BoxGeometry(0.06, 1.0, 0.06), OAK, [wellX + s * 0.46, G + 0.5, wellZ]);
    T(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), OAK, [wellX, G + 0.95, wellZ], [0, 0, Math.PI / 2]);
    // Barrels and a cart by the stable door, things a child can look for.
    for (const [x, z] of [[5.2, 3.4], [5.45, 3.05], [5.05, 2.9]]) {
      T(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 10), 0x6b4c2e, [x, G + 0.2, z]);
    }
  }

  // --- merge ---------------------------------------------------------------------------------
  const stoneGeo = mergeParts(stone);
  tintGeometry(stoneGeo, (p, c) => {
    const broad = smoothNoise3(p.x * 0.28, p.y * 0.34, p.z * 0.28);
    const fine = smoothNoise3(p.x * 1.2, p.y * 1.1, p.z * 1.2);
    let k = 0.82 + broad * 0.3 + (fine - 0.5) * 0.12;
    // Damp and moss at the foot of every wall.
    const low = 1 - smooth01((p.y - G) / 1.6);
    k *= lerp(1, 0.78, low);
    return [c.r * k * (1 - low * 0.1), c.g * k, c.b * k * (1 - low * 0.26)];
  });
  const stoneMesh = mesh(stoneGeo, stoneMaterial(setRepeat(coursedTile(29), 4), { bumpScale: 0.5, roughness: 0.92 }));
  const slateGeo = mergeParts(slate);
  tintGeometry(slateGeo, (p, c) => {
    const n = smoothNoise3(p.x * 1.1, p.y * 1.1, p.z * 1.1);
    const k = 0.84 + n * 0.3;
    return [c.r * k, c.g * k, c.b * k];
  });
  const slateMesh = mesh(slateGeo, stoneMaterial(setRepeat(slateTile(37), 2.4), { bumpScale: 0.3, roughness: 0.68 }));
  const trimMesh = mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.78, side: THREE.FrontSide }));

  // --- the ground: the island, the moat's banks and an outer lawn, one radial surface -----------
  const MOAT_IN = 11.0;
  const MOAT_OUT = 12.55;
  const OUTER = 13.1;
  const WATER = 0.3;
  const ringS = [0, 2, 4, 6, 8, 9.6, 10.5, MOAT_IN - 0.05, MOAT_IN + 0.15, MOAT_IN + 0.45, MOAT_IN + 0.75, MOAT_OUT - 0.42, MOAT_OUT - 0.14, MOAT_OUT + 0.08, OUTER - 0.1, OUTER];
  const SECTORS = 128;
  const positions = []; const colours = []; const uvs = []; const indices = [];
  const GRASS = lin(0x5a6b3e);
  const GRASS2 = lin(0x6f7c4c);
  const EARTH = lin(0x7b6a4d);
  const YARD = lin(0x8e7f63);
  const heightAt = (s) => {
    if (s <= MOAT_IN - 0.05) return G;
    if (s <= MOAT_IN + 0.75) return lerp(G, 0.16, smooth01((s - (MOAT_IN - 0.05)) / 0.8));
    if (s <= MOAT_OUT - 0.42) return 0.16;
    if (s <= MOAT_OUT + 0.08) return lerp(0.16, 0.62, smooth01((s - (MOAT_OUT - 0.42)) / 0.5));
    if (s < OUTER) return lerp(0.62, 0.04, smooth01((s - (MOAT_OUT + 0.08)) / (OUTER - MOAT_OUT - 0.08)));
    return 0;
  };
  for (let r = 0; r < ringS.length; r += 1) {
    const s = ringS[r];
    for (let k = 0; k < SECTORS; k += 1) {
      const a = (k / SECTORS) * Math.PI * 2;
      const sx = Math.sin(a); const cz = Math.cos(a);
      const P2 = 6;
      const rad = s / (Math.abs(sx) ** P2 + Math.abs(cz) ** P2) ** (1 / P2);
      const x = sx * rad; const z = cz * rad;
      const y = heightAt(s) + (s > 10.4 && s < OUTER - 0.2 ? (smoothNoise3(x * 0.7, 3, z * 0.7) - 0.5) * 0.09 : 0);
      positions.push(x, Math.max(0, y), z);
      uvs.push(x, z);
      const n = smoothNoise3(x * 0.6, 5, z * 0.6);
      let c = mix3(GRASS, GRASS2, n);
      if (s < 8.5) c = mix3(YARD, EARTH, n * 0.7);
      else if (s < 9.4) c = mix3(mix3(YARD, EARTH, n), GRASS, smooth01((s - 8.5) / 0.9));
      if (s > MOAT_IN + 0.2 && s < MOAT_OUT - 0.1) c = mix3(EARTH, c, 0.2);
      colours.push(...c);
    }
  }
  for (let r = 0; r < ringS.length - 1; r += 1) {
    for (let k = 0; k < SECTORS; k += 1) {
      const k2 = (k + 1) % SECTORS;
      if (r === 0) {
        // The innermost ring has collapsed to the centre, so a fan.
        indices.push(k, SECTORS + k, SECTORS + k2);
      } else {
        indices.push(r * SECTORS + k, (r + 1) * SECTORS + k, r * SECTORS + k2);
        indices.push(r * SECTORS + k2, (r + 1) * SECTORS + k, (r + 1) * SECTORS + k2);
      }
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setIndex(indices);
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  groundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  groundGeo.computeVertexNormals();
  const ground = mesh(groundGeo, standard({ vertexColors: true, roughness: 1, ...relief('soil', { seed: 73, repeat: 1.2, strength: 1.3 }) }));
  ground.castShadow = false;

  // The water: one flat sheet, opaque, ringed by its banks.
  const P2W = 6;
  const wPos = []; const wIdx = []; const wUv = [];
  const WSEC = 96;
  for (const s of [MOAT_IN + 0.2, MOAT_OUT - 0.05]) {
    for (let k = 0; k < WSEC; k += 1) {
      const a = (k / WSEC) * Math.PI * 2;
      const sx = Math.sin(a); const cz = Math.cos(a);
      const rad = s / (Math.abs(sx) ** P2W + Math.abs(cz) ** P2W) ** (1 / P2W);
      wPos.push(sx * rad, WATER, cz * rad);
      wUv.push(sx * rad, cz * rad);
    }
  }
  for (let k = 0; k < WSEC; k += 1) {
    const k2 = (k + 1) % WSEC;
    wIdx.push(k, WSEC + k, k2, k2, WSEC + k, WSEC + k2);
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setIndex(wIdx);
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  waterGeo.computeVertexNormals();
  const water = mesh(waterGeo, standard({
    color: 0x304f58, roughness: 0.3, metalness: 0, ...relief('stone', { seed: 91, repeat: 0.5, strength: 0.25 }),
  }));
  water.castShadow = false;

  return group(ground, water, stoneMesh, slateMesh, trimMesh);
}

// ---------------------------------------------------------------------------

export const BUILDERS = {
  'pyramid-of-giza': pyramidOfGiza,
  'great-sphinx': greatSphinx,
  parthenon,
  'medieval-castle': medievalCastle,
};
