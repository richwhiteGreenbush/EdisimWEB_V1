import * as THREE from 'three';
import { standard, mesh, group, canvasTexture, relief, seededRandom } from '../../PropKit.js';
import { mergeParts, superXY, splineAt, weldSeam, roundedOutline, extrudeOutline, placed } from '../../props/LoftKit.js';

// The Model Database's Chemistry & Physics models: a carbon atom, a salt lattice, a Newton's
// cradle, a compound microscope and a gear train. All five are the kind of thing a teacher points
// at and asks somebody to COUNT, so the counts are computed rather than drawn, and the layouts are
// exported (LAB_LAYOUTS) so the arithmetic can be checked without looking.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1, one to a few
// merged meshes. There is no environment map anywhere in this app, so "polished steel" cannot be a
// high metalness (that renders black). It is a moderate metalness plus `polish()` below, which
// paints the studio reflection a real chrome surface would carry into the vertex colours.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------------------------------------------------------------------------
// Private solids
// ---------------------------------------------------------------------------

// A surface of revolution about +Y from a BOTTOM-UP `[radius, y, flags]` profile. LoftKit's
// `revolve` comes out inside out for a profile written this way, so this one owns its winding.
// Flag 'c' doubles the row, which gives a crisp crease: a machined shoulder rather than a
// pillow. Flag 'k' runs the row's radius through a flute, for a knurled knob.
function lathe(profile, { segments = 32, flutes = 0, depth = 0 } = {}) {
  const rows = [];
  for (const [r, y, flags = ''] of profile) {
    rows.push({ r, y, knurl: flags.includes('k') });
    if (flags.includes('c')) rows.push({ r, y, knurl: flags.includes('k') });
  }
  const positions = [];
  const uvs = [];
  const indices = [];
  let run = 0;
  rows.forEach((row, i) => {
    if (i) run += Math.hypot(row.r - rows[i - 1].r, row.y - rows[i - 1].y);
    for (let c = 0; c < segments; c++) {
      const a = (c / segments) * Math.PI * 2;
      const r = row.knurl ? row.r * (1 - depth * (0.5 + 0.5 * Math.cos(flutes * a))) : row.r;
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

// A geometry authored along +Y, carried to `at` with its +Y pointing along `dir`.
function aimed(geometry, at, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  const m = new THREE.Matrix4().compose(V(at[0] ?? at.x, at[1] ?? at.y, at[2] ?? at.z), q, V(1, 1, 1));
  geometry.applyMatrix4(m);
  return geometry;
}

// A straight rod between two points. `open` leaves the ends uncapped for a rod whose ends are both
// buried, which is most of what a salt lattice has three hundred of.
function rod(a, b, radius, { sides = 10, open = false, radiusB = null } = {}) {
  const from = a.isVector3 ? a : V(...a);
  const to = b.isVector3 ? b : V(...b);
  const axis = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radiusB ?? radius, radius, axis.length(), sides, 1, open);
  g.translate(0, axis.length() / 2, 0);
  return aimed(g, from, axis);
}

// A sphere at a point, optionally squashed about its own centre: a bead, a lens, a boss.
function ball(radius, at, { detail = 16, squash = [1, 1, 1] } = {}) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.round(detail * 0.66)));
  g.scale(squash[0], squash[1], squash[2]);
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A curved rod through a list of points, capped by a ball at each end.
function bentRod(list, color, points, radius, { sides = 8, samples = 24 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : V(...p))));
  list.push({ geometry: new THREE.TubeGeometry(curve, samples, radius, sides, false), color });
  for (const end of [points[0], points[points.length - 1]]) {
    const p = end.isVector3 ? end : V(...end);
    list.push({ geometry: ball(radius * 1.03, [p.x, p.y, p.z], { detail: sides + 2 }), color });
  }
}

// A slab with rounded corners, built up a BOTTOM-UP `[inset, y]` profile: a moulded base, a stage,
// a plinth. LoftKit's `solidLoft` caps with a fan that shares its rim's normals, which makes a big
// flat top shade like a pillow, so here each band of the profile and each cap owns its own
// vertices. Every band is flat in section and every corner is smooth in plan, and UVs are in feet.
function roundedSlab(halfW, halfD, corner, profile, { steps = 5 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringAt = (inset) => {
    const pts = roundedOutline(halfW - inset, halfD - inset, Math.max(0.01, corner - inset), steps);
    return pts.map(([x, y]) => [x, -y]); // counter-clockwise seen from above
  };
  const pushRing = (ring, y, runBase) => {
    const start = positions.length / 3;
    let run = 0;
    ring.forEach(([x, z], i) => {
      if (i) run += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
      positions.push(x, y, z);
      uvs.push(run, runBase);
    });
    return start;
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const [ia, ya] = profile[i];
    const [ib, yb] = profile[i + 1];
    const lo = ringAt(ia);
    const hi = ringAt(ib);
    const n = lo.length;
    const a = pushRing(lo, ya, ya);
    const b = pushRing(hi, yb, yb);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      indices.push(a + j, a + j2, b + j2, a + j, b + j2, b + j);
    }
  }
  for (const [index, top] of [[0, false], [profile.length - 1, true]]) {
    const ring = ringAt(profile[index][0]);
    const y = profile[index][1];
    const start = positions.length / 3;
    for (const [x, z] of ring) {
      positions.push(x, y, z);
      uvs.push(x, z);
    }
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    uvs.push(0, 0);
    for (let j = 0; j < ring.length; j++) {
      const j2 = (j + 1) % ring.length;
      if (top) indices.push(centre, start + j, start + j2);
      else indices.push(centre, start + j2, start + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A closed solid swept along a planar path whose plane contains neither `lateral` nor any twist:
// the horseshoe base (lateral = up) and the microscope's arm (lateral = X). The section is a
// superellipse whose size changes along the path, which is what a cast arm is. The end caps own
// their rims, and the winding is measured rather than assumed.
function sweptCasting(points, section, { samples = 48, sides = 28, lateral = [1, 0, 0] } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)), false, 'centripetal');
  const L = V(...lateral).normalize();
  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = sides + 1;
  const centres = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const T = curve.getTangentAt(t);
    const N = new THREE.Vector3().crossVectors(L, T).normalize();
    const { w, h, round = 0.6, lift = 0 } = section(t);
    const c = p.clone().addScaledVector(L, lift);
    centres.push(c);
    for (let j = 0; j <= sides; j++) {
      const [a, b] = superXY(j / sides, w, h, h, round, round);
      const q = c.clone().addScaledVector(L, a).addScaledVector(N, b);
      positions.push(q.x, q.y, q.z);
      uvs.push(t, j / sides);
    }
  }
  const forward = (i, j) => [ring * (i - 1) + (j - 1), ring * i + (j - 1), ring * i + j, ring * (i - 1) + j];
  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= sides; j++) {
      const [a, b, c, d] = forward(i, j);
      indices.push(a, b, c, a, c, d);
    }
  }
  for (const [row, flip] of [[0, false], [samples, true]]) {
    const start = positions.length / 3;
    for (let j = 0; j <= sides; j++) {
      const k = row * ring + j;
      positions.push(positions[k * 3], positions[k * 3 + 1], positions[k * 3 + 2]);
      uvs.push(0.5, 0.5);
    }
    const centre = positions.length / 3;
    positions.push(centres[row].x, centres[row].y, centres[row].z);
    uvs.push(0.5, 0.5);
    for (let j = 0; j < sides; j++) {
      if (flip) indices.push(centre, start + j + 1, start + j);
      else indices.push(centre, start + j, start + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (signedVolume(g) < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const swap = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = swap;
    }
    g.index.needsUpdate = true;
  }
  g.computeVertexNormals();
  return weldSeam(g, ring, samples + 1);
}

function signedVolume(g) {
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const p = g.attributes.position;
  const idx = g.index;
  let volume = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i)).sub(c);
    b.fromBufferAttribute(p, idx.getX(i + 1)).sub(c);
    d.fromBufferAttribute(p, idx.getX(i + 2)).sub(c);
    volume += a.dot(b.clone().cross(d)) / 6;
  }
  return volume;
}

// Gives a merged, already-placed geometry the look of polished metal. There is no environment map
// to reflect, so the reflection is PAINTED into the vertex colours, the way a chrome ball in a
// photograph actually looks: a sky that is brightest at the horizon and dimmer overhead, a hard dark
// line just below the horizon, and then the ground coming back up. A surface with no vertical
// curve at all (a post) would see none of that, so it also carries streaks that run round it by
// bearing, which is what a polished tube shows. It multiplies whatever colour is already there, and
// vertex colours are LINEAR, so every number here is pitched in linear.
function polish(geometry, {
  sky = 0.66, horizon = 1, dark = 0.14, ground = 0.5, streak = 0.45, skyTint = [0.94, 0.98, 1.06], groundTint = [1.04, 0.98, 0.92],
  bandLow = -0.16, bandHigh = -0.05, groundRise = [0.16, 0.9],
} = {}) {
  const n = geometry.attributes.normal;
  const count = n.count;
  let col = geometry.attributes.color;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
    geometry.setAttribute('color', col);
  }
  const { lerp, smoothstep } = THREE.MathUtils;
  for (let i = 0; i < count; i++) {
    const x = n.getX(i);
    const y = n.getY(i);
    const z = n.getZ(i);
    const up = lerp(horizon, sky, Math.pow(Math.max(0, y), 0.8));
    const down = lerp(dark, ground, smoothstep(-y, groundRise[0], groundRise[1]));
    const t = smoothstep(y, bandLow, bandHigh);
    const k0 = lerp(down, up, t);
    const side = Math.pow(1 - Math.min(1, Math.abs(y)), 2);
    const bearing = Math.cos(2 * Math.atan2(x, z) + 0.7);
    const k = k0 * (1 + streak * side * bearing);
    const tr = lerp(groundTint[0], skyTint[0], t);
    const tg = lerp(groundTint[1], skyTint[1], t);
    const tb = lerp(groundTint[2], skyTint[2], t);
    col.setXYZ(i, col.getX(i) * k * tr, col.getY(i) * k * tg, col.getZ(i) * k * tb);
  }
  col.needsUpdate = true;
  return geometry;
}

// A closed side outline drawn in the model's (z, y) plane, extruded across X: a wedge, a bracket.
// Each corner is doubled so its faces stay flat rather than shading like a pillow.
function wedge(points, width, x = 0) {
  const doubled = [];
  for (const [z, y] of points) doubled.push([-z, y], [-z, y]);
  const g = extrudeOutline(doubled, width);
  g.rotateY(Math.PI / 2); // the outline's x becomes -z, which is why it was negated above
  g.translate(x, 0, 0);
  return g;
}

const glossy = (params = {}) => standard({ vertexColors: true, roughness: 0.32, metalness: 0.02, ...params });
const steel = (params = {}) => standard({ vertexColors: true, roughness: 0.2, metalness: 0.42, ...params });

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

// A flat label lying a hair proud of whatever is behind it, with its own UVs.
function labelPlane(width, height, at, rotX, proud = 0.006) {
  const g = new THREE.PlaneGeometry(width, height);
  g.rotateX(rotX);
  const n = V(0, Math.sin(-rotX), Math.cos(rotX));
  g.translate(at[0] + n.x * proud, at[1] + n.y * proud, at[2] + n.z * proud);
  return g;
}

// ---------------------------------------------------------------------------
// Carbon atom
// ---------------------------------------------------------------------------

// Twelve spheres in a tight ball is an ICOSAHEDRON: twelve vertices, each touching five others, and
// nothing in the middle that would be a thirteenth particle. Three mutually touching spheres leave
// a triangular gap you can see through until their radius reaches edge / sqrt(3), so the radius is
// set just past that: the ball is closed, with no interior to look into, and every sphere still
// shows as a distinct cap to count.
//
// The icosahedron's vertices come in six antipodal pairs, so giving one of each pair to each kind
// is what makes the count exactly six and six by construction. The choice is then made to leave as
// few same-coloured neighbours as possible, or the protons clump on one side and the view from the
// other side is all neutrons.
function nucleusLayout(radius) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [0, 1, phi], [1, phi, 0], [phi, 0, 1],
    [0, 1, -phi], [-1, phi, 0], [phi, 0, -1],
  ];
  const tilt = new THREE.Euler(0.33, 0.57, 0.18);
  const unit = raw.map(([x, y, z]) => V(x, y, z).normalize().applyEuler(tilt));
  const edge = unit[0].distanceTo(unit[1]);
  const spacing = radius / 0.585; // edge length in feet: radius = 0.585 edge closes the gaps
  const rho = spacing / edge;
  const positions = [];
  for (const u of unit) {
    positions.push(u.clone().multiplyScalar(rho), u.clone().multiplyScalar(-rho));
  }
  // Index 2k and 2k+1 are antipodal. `mask` says which of each pair is the proton.
  const neighbours = [];
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      if (positions[i].distanceTo(positions[j]) < spacing * 1.05) neighbours.push([i, j]);
    }
  }
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 64; mask++) {
    const isProton = (i) => (((mask >> (i >> 1)) & 1) ^ (i & 1)) === 1;
    let same = 0;
    for (const [i, j] of neighbours) if (isProton(i) === isProton(j)) same += 1;
    // Faces toward the viewer should also show a mix, so break ties on the front's balance.
    const front = positions.reduce((sum, p, i) => sum + (p.z > 0 ? (isProton(i) ? 1 : -1) : 0), 0);
    const score = same * 10 + Math.abs(front);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  const particles = positions.map((p, i) => ({
    position: p,
    kind: (((best >> (i >> 1)) & 1) ^ (i & 1)) === 1 ? 'proton' : 'neutron',
  }));
  return { particles, rho, spacing };
}

const ATOM = {
  centre: [0, 5.18, 0],
  nucleon: 0.33,
  electron: 0.23,
  inner: { radius: 1.62, normal: [-0.709, 0.574, 0.41], electrons: 2, phase: Math.PI / 2, struts: [-0.68, 0.68] },
  outer: { radius: 2.72, normal: [0.497, 0.5, 0.709], electrons: 4, phase: Math.PI / 4, struts: [-0.36, 0.36] },
  collarY: 2.38,
};

// `angle` is measured round the ring from its lowest point, so a strut placed at a small angle is
// always below the atom and the electrons can be kept away from the struts.
function ringFrame(spec, centre) {
  const n = V(...spec.normal).normalize();
  const low = UP.clone().negate().addScaledVector(n, UP.dot(n)).normalize();
  const side = new THREE.Vector3().crossVectors(n, low).normalize();
  const c = V(...centre);
  return {
    n,
    u: low,
    v: side,
    at: (angle) => c.clone().addScaledVector(low, Math.cos(angle) * spec.radius).addScaledVector(side, Math.sin(angle) * spec.radius),
  };
}

function atomLayout() {
  const electrons = [];
  for (const [shell, spec] of [['inner', ATOM.inner], ['outer', ATOM.outer]]) {
    const frame = ringFrame(spec, ATOM.centre);
    for (let i = 0; i < spec.electrons; i++) {
      electrons.push({ shell, position: frame.at(spec.phase + (i / spec.electrons) * Math.PI * 2) });
    }
  }
  return { nucleus: nucleusLayout(ATOM.nucleon), electrons };
}

const PROTON = 0xd8362b;
const NEUTRON = 0x8f959d;
const ELECTRON = 0x2672f0;
const STAND = 0x39404b;

function carbonAtom() {
  const { centre, nucleon } = ATOM;
  const c = V(...centre);
  const { nucleus, electrons } = atomLayout();

  const beads = [];
  for (const { position, kind } of nucleus.particles) {
    beads.push({
      geometry: ball(nucleon, [c.x + position.x, c.y + position.y, c.z + position.z], { detail: 38 }),
      color: kind === 'proton' ? PROTON : NEUTRON,
    });
  }
  for (const { position } of electrons) {
    beads.push({ geometry: ball(ATOM.electron, [position.x, position.y, position.z], { detail: 32 }), color: ELECTRON });
  }

  const metal = [];
  const stand = [];
  const collar = V(0, ATOM.collarY, 0);

  // Rings, each with two struts from one collar on the column: a cradle under the atom, so nothing
  // but the column crosses the space a student is looking into.
  for (const spec of [ATOM.inner, ATOM.outer]) {
    const f = ringFrame(spec, centre);
    const torus = new THREE.TorusGeometry(spec.radius, 0.042, 12, 160);
    torus.applyMatrix4(new THREE.Matrix4().makeBasis(f.u, f.v, f.n).setPosition(c));
    metal.push({ geometry: torus, color: 0xdfe3e8 });
    for (const angle of spec.struts) {
      const end = f.at(angle);
      const mid = V(end.x * 0.62, collar.y + (end.y - collar.y) * 0.34, end.z * 0.62);
      bentRod(metal, 0xc9ced6, [collar.clone().add(V(0, 0.04, 0)), mid, end], 0.032, { sides: 8 });
    }
  }

  // The column: from the base up into the nucleus, where a small cup takes it.
  metal.push({ geometry: lathe([
    [0.1, 0.5], [0.1, ATOM.collarY - 0.14, 'c'], [0.19, ATOM.collarY - 0.1, 'c'], [0.2, ATOM.collarY - 0.05],
    [0.2, ATOM.collarY + 0.1], [0.17, ATOM.collarY + 0.15, 'c'], [0.08, ATOM.collarY + 0.16, 'c'],
    [0.08, c.y - 0.98, 'c'], [0.13, c.y - 0.9, 'c'], [0.24, c.y - 0.72], [0.0, c.y - 0.5],
  ], { segments: 28 }), color: 0xdfe3e8 });

  // A heavy turned base with a small lectern for its label.
  stand.push({ geometry: lathe([
    [0, 0], [1.72, 0, 'c'], [1.72, 0.1, 'c'], [1.64, 0.17], [1.48, 0.23, 'c'], [1.44, 0.27], [1.05, 0.36],
    [0.46, 0.43], [0.24, 0.52], [0.16, 0.66], [0.13, 0.82, 'c'], [0, 0.82],
  ], { segments: 56 }), color: STAND });
  const lean = 0.72; // how far the plaque's face is tipped back from upright, in radians
  const plaqueH = 0.72;
  const plaqueW = 2.1;
  const low = [1.42, 0.34]; // the plaque's lower edge, as (z, y), just clear of the base's slope
  const high = [low[0] - plaqueH * Math.sin(lean), low[1] + plaqueH * Math.cos(lean)];
  // The face of the lectern lies just behind the plaque and runs a little past it at both ends.
  const faceN = [Math.cos(lean), Math.sin(lean)]; // the plaque's normal, as (z, y)
  const faceUp = [-Math.sin(lean), Math.cos(lean)];
  const onFace = ([z, y], along) => [z + faceUp[0] * along - faceN[0] * 0.012, y + faceUp[1] * along - faceN[1] * 0.012];
  const lipLow = onFace(low, -0.05);
  const lipHigh = onFace(high, 0.05);
  stand.push({
    geometry: wedge([
      [lipLow[0], 0.2], lipLow, lipHigh, [lipHigh[0] - 0.05, lipHigh[1] - 0.05], [lipHigh[0] - 0.62, 0.34], [lipHigh[0] - 0.62, 0.2],
    ], plaqueW + 0.1),
    color: STAND,
  });
  const face = labelPlane(plaqueW, plaqueH, [0, (low[1] + high[1]) / 2, (low[0] + high[0]) / 2], -lean, 0.006);
  const plaque = mesh(face, standard({ map: atomPlaqueTexture(), roughness: 0.55, metalness: 0 }));
  plaque.castShadow = false;

  // A curved wire an inch thick has nothing to shadow itself with except acne.
  const atomMetal = mesh(polish(mergeParts(metal), { streak: 0.22, dark: 0.3, ground: 0.6 }), steel());
  atomMetal.receiveShadow = false;
  return group(
    mesh(mergeParts(beads), glossy({ roughness: 0.3 })),
    atomMetal,
    mesh(mergeParts(stand), glossy({ roughness: 0.3 })),
    plaque,
  );
}

function atomPlaqueTexture() {
  return canvasTexture(840, 288, (ctx, w, h) => {
    ctx.fillStyle = '#f2f0e8';
    ctx.fillRect(0, 0, w, h);
    // The element's own tile, as the periodic table prints it.
    ctx.fillStyle = '#1e2329';
    ctx.fillRect(18, 18, 252, h - 36);
    ctx.fillStyle = '#f2f0e8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 46px Arial, sans-serif';
    ctx.fillText('6', 36, 70);
    ctx.textAlign = 'center';
    ctx.font = 'bold 150px Arial, sans-serif';
    ctx.fillText('C', 144, 192);
    fitFont(ctx, 'Carbon', 220, 46, (px) => `${px}px Arial, sans-serif`);
    ctx.fillText('Carbon', 144, 246);
    const rows = [['#d8362b', '6 protons'], ['#8f959d', '6 neutrons'], ['#2672f0', '6 electrons (2 + 4)']];
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    rows.forEach(([colour, text], i) => {
      const y = 60 + i * 84;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(322, y, 27, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e2329';
      fitFont(ctx, text, 450, 58, (px) => `bold ${px}px Arial, sans-serif`);
      ctx.fillText(text, 366, y + 2);
    });
  });
}

// ---------------------------------------------------------------------------
// Salt crystal
// ---------------------------------------------------------------------------

// The colours of Atom Hall's crystal. Rock salt is the simplest lattice there is: step one place
// along any axis and the kind changes, so the parity of (i + j + k) says which ion sits where and
// every ion's six nearest neighbours are the other kind by construction.
const SALT_MODEL = {
  ionsPerEdge: 5,
  spacing: 2,
  sodium: { color: 0x8f5bd6, radius: 0.29 },
  chloride: { color: 0x3fb56a, radius: 0.52 },
  baseHalf: 5.25,
  baseTop: 0.52,
  firstLayer: 1.18,
};

function saltLayout() {
  const { ionsPerEdge: n, spacing, firstLayer } = SALT_MODEL;
  const mid = (n - 1) / 2;
  const ions = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        ions.push({
          i, j, k,
          kind: (i + j + k) % 2 === 0 ? 'sodium' : 'chloride',
          position: [(i - mid) * spacing, firstLayer + j * spacing, (k - mid) * spacing],
        });
      }
    }
  }
  return { ions };
}

function saltCrystal() {
  const { ions } = saltLayout();
  const { ionsPerEdge: n, spacing, sodium, chloride, baseHalf, baseTop } = SALT_MODEL;
  const parts = [];
  const bonds = [];
  const lookup = new Map(ions.map((ion) => [`${ion.i},${ion.j},${ion.k}`, ion]));
  for (const ion of ions) {
    const style = ion.kind === 'sodium' ? sodium : chloride;
    const detail = ion.kind === 'sodium' ? 16 : 20;
    parts.push({ geometry: ball(style.radius, ion.position, { detail }), color: style.color });
    for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const other = lookup.get(`${ion.i + di},${ion.j + dj},${ion.k + dk}`);
      if (other) bonds.push({ geometry: rod(ion.position, other.position, 0.05, { sides: 8, open: true }), color: 0xcfd4da });
    }
    // The bottom layer stands on short posts, one per ion, sunk into the base.
    if (ion.j === 0) {
      const foot = [ion.position[0], baseTop - 0.1, ion.position[2]];
      bonds.push({ geometry: rod(ion.position, foot, 0.05, { sides: 8, open: true }), color: 0xcfd4da });
      bonds.push({ geometry: lathe([[0.15, baseTop - 0.05], [0.15, baseTop + 0.02, 'c'], [0.07, baseTop + 0.07, 'c'], [0.05, baseTop + 0.09]], { segments: 12 }).translate(ion.position[0], 0, ion.position[2]), color: 0xcfd4da });
    }
  }
  const slab = roundedSlab(baseHalf, baseHalf, 0.35, [[0, 0], [0, 0.2], [0.58, baseTop], [0.58, baseTop]]);

  // The legend lies on the base's sloping front edge, where someone standing there reads it.
  const slope = Math.atan2(baseTop - 0.2, 0.58);
  const plaque = mesh(
    labelPlane(5.6, 0.58, [0, (baseTop + 0.2) / 2, baseHalf - 0.29], -(Math.PI / 2 - slope)),
    standard({ map: saltPlaqueTexture(), roughness: 0.6, metalness: 0 }),
  );
  plaque.castShadow = false;

  return group(
    mesh(mergeParts(parts), glossy({ roughness: 0.3 })),
    mesh(polish(mergeParts(bonds), { sky: 0.9, dark: 0.5, ground: 0.66, streak: 0.2 }), steel({ roughness: 0.35, metalness: 0.25 })),
    mesh(slab, standard({ color: 0x46505d, roughness: 0.55, metalness: 0.03, ...relief('stone', { seed: 11, repeat: 2, strength: 0.25 }) })),
    plaque,
  );
}

function saltPlaqueTexture() {
  return canvasTexture(1120, 116, (ctx, w, h) => {
    ctx.fillStyle = '#eceae2';
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    const y = h / 2 + 2;
    const entry = (x, colour, radius, text, charge) => {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e2329';
      ctx.textAlign = 'left';
      fitFont(ctx, text, 400, 60, (px) => `bold ${px}px Arial, sans-serif`);
      ctx.fillText(text, x + 58, y);
      const wide = ctx.measureText(text).width;
      ctx.font = 'bold 40px Arial, sans-serif';
      ctx.fillText(charge, x + 62 + wide, y - 16);
    };
    entry(60, '#8f5bd6', 24, 'Sodium ion Na', '+');
    entry(620, '#3fb56a', 43, 'Chloride ion Cl', '-');
  });
}

// ---------------------------------------------------------------------------
// Newton's cradle
// ---------------------------------------------------------------------------

const CRADLE = {
  ballRadius: 0.34,
  ballY: 1.5,
  count: 5,
  railY: 3.84,
  railZ: 0.88,
  postX: 2.34,
  railRadius: 0.055,
  threadRadius: 0.015,
  baseTop: 0.34,
};

function cradleLayout() {
  const { ballRadius, count, ballY } = CRADLE;
  const balls = [];
  for (let i = 0; i < count; i++) balls.push([(i - (count - 1) / 2) * ballRadius * 2, ballY, 0]);
  return { balls };
}

function woodTexture(seed) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6b3f22';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 180; i++) {
      const y = rng() * h;
      const dark = rng() < 0.6;
      ctx.strokeStyle = dark ? `rgba(38,20,10,${0.08 + rng() * 0.26})` : `rgba(164,108,62,${0.06 + rng() * 0.2})`;
      ctx.lineWidth = 0.6 + rng() * 2.4;
      const wobble = 2 + rng() * 7;
      const phase = rng() * Math.PI * 2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 32) {
        // A whole number of waves across the tile, so the grain has no seam.
        const yy = y + Math.sin((x / w) * Math.PI * 2 + phase) * wobble;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.22, 0.42);
  return texture;
}

function newtonsCradle() {
  const { ballRadius: r, railY, railZ, postX, railRadius, threadRadius, baseTop, count } = CRADLE;
  const { balls } = cradleLayout();
  const metal = [];
  const balls3 = [];
  const threads = [];

  for (const [x, y, z] of balls) {
    // A ball is a polished sphere, and darker where it faces its neighbour: a touching pair really
    // does shade one another, and that dark crescent is what tells the eye they are in contact.
    const sphere = ball(r, [0, 0, 0], { detail: 56 });
    const n = sphere.attributes.normal;
    const col = new Float32Array(n.count * 3);
    const nextLeft = x > balls[0][0] + 1e-6;
    const nextRight = x < balls[count - 1][0] - 1e-6;
    const { lerp, smoothstep } = THREE.MathUtils;
    for (let i = 0; i < n.count; i++) {
      const nx = n.getX(i);
      const ny = n.getY(i);
      const nz = n.getZ(i);
      // The sun already lights the crown, so the painted sky has to fall away toward the top or the
      // ball comes out as one flat pale cap.
      const upper = lerp(1.12, 0.3, Math.pow(Math.max(ny, 0), 0.72));
      const lower = lerp(0.1, 1.05, smoothstep(-ny, 0.05, 0.42));
      const t = smoothstep(ny, -0.1, -0.015);
      let shade = lerp(lower, upper, t);
      shade *= 1 + 0.32 * (1 - Math.abs(ny)) * Math.cos(2 * Math.atan2(nx, nz) + 0.7);
      if (nextRight && nx > 0.75) shade *= lerp(1, 0.28, smoothstep(nx, 0.75, 1));
      if (nextLeft && nx < -0.75) shade *= lerp(1, 0.28, smoothstep(-nx, 0.75, 1));
      col[i * 3] = shade * lerp(1.06, 0.9, t);
      col[i * 3 + 1] = shade * lerp(0.98, 0.95, t);
      col[i * 3 + 2] = shade * lerp(0.88, 1.02, t);
    }
    sphere.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sphere.translate(x, y, z);
    balls3.push({ geometry: sphere, keepColor: true });

    // The eyelet: a boss sunk into the crown of the ball, carrying a small ring whose hole runs
    // front to back, which is the way a thread hanging in a V passes through it.
    const crown = y + r;
    const ringR = 0.058;
    const ringTube = 0.016;
    const ringY = crown + 0.075 + ringR;
    metal.push({ geometry: lathe([[0.075, crown - 0.03], [0.075, crown + 0.03, 'c'], [0.05, crown + 0.06, 'c'], [0.026, crown + 0.095, 'c'], [0, crown + 0.095]], { segments: 18 }).translate(x, 0, z), color: 0xe6e9ee });
    metal.push({ geometry: new THREE.TorusGeometry(ringR, ringTube, 8, 22).translate(x, ringY, z), color: 0xe6e9ee });

    // Two threads, from the bottom of the eyelet's hole up to each rail. One bead closes the point
    // of the V; a sleeve on the rail is what each thread is tied round.
    const apex = V(x, ringY - ringR + ringTube + threadRadius * 0.4, z);
    threads.push({ geometry: ball(threadRadius * 1.25, [apex.x, apex.y, apex.z], { detail: 8 }), color: 0xf4f2ea });
    for (const side of [-1, 1]) {
      const top = V(x, railY, side * railZ);
      threads.push({ geometry: rod(apex, top, threadRadius, { sides: 6, open: true }), color: 0xf4f2ea });
      const sleeve = lathe([
        [0, -0.075], [railRadius * 1.1, -0.075, 'c'], [railRadius * 1.45, -0.05, 'c'], [railRadius * 1.45, 0.05, 'c'],
        [railRadius * 1.1, 0.075, 'c'], [0, 0.075],
      ], { segments: 14 });
      sleeve.rotateZ(Math.PI / 2);
      sleeve.translate(top.x, top.y, top.z);
      metal.push({ geometry: sleeve, color: 0xe6e9ee });
    }
  }

  // The frame: four posts and two rails, meeting at a ball at each top corner.
  for (const sz of [-1, 1]) {
    const railAxis = rod([-postX, railY, sz * railZ], [postX, railY, sz * railZ], railRadius, { sides: 16, open: true });
    metal.push({ geometry: railAxis, color: 0xe6e9ee });
    for (const sx of [-1, 1]) {
      const x = sx * postX;
      const z = sz * railZ;
      metal.push({ geometry: lathe([
        [0.17, baseTop - 0.02], [0.17, baseTop + 0.03, 'c'], [0.13, baseTop + 0.07, 'c'], [0.1, baseTop + 0.12],
        [0.08, baseTop + 0.2, 'c'], [railRadius * 1.05, baseTop + 0.24, 'c'], [railRadius * 1.05, railY - 0.05], [0.0, railY - 0.04],
      ], { segments: 18 }).translate(x, 0, z), color: 0xe6e9ee });
      metal.push({ geometry: ball(railRadius * 1.5, [x, railY, z], { detail: 18 }), color: 0xe6e9ee });
    }
  }

  const baseGeometry = roundedSlab(2.62, 1.2, 0.22, [
    [0.06, 0], [0, 0.03], [0, 0.17], [0.08, baseTop - 0.05], [0.14, baseTop - 0.01], [0.17, baseTop],
  ]);
  const base = mesh(baseGeometry, standard({
    map: woodTexture(29), roughness: 0.26, metalness: 0, ...relief('wood', { seed: 5, repeat: 2, strength: 0.05 }),
  }));

  const string = mesh(mergeParts(threads), standard({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  string.receiveShadow = false; // shadow acne on something a third of an inch thick reads as stripes
  return group(
    mesh(polish(mergeParts(metal), { sky: 0.42, horizon: 1.0, dark: 0.3, ground: 0.85, streak: 0.5, groundTint: [1.05, 0.97, 0.9], bandLow: -0.14, bandHigh: -0.04, groundRise: [0.06, 0.5] }), steel({ roughness: 0.16, metalness: 0.46 })),
    mesh(mergeParts(balls3), steel({ roughness: 0.13, metalness: 0.5 })),
    string,
    base,
  );
}

// ---------------------------------------------------------------------------
// Compound microscope
// ---------------------------------------------------------------------------

const SCOPE = {
  axisZ: 0.25,
  stageTop: 3.06,
  slideThick: 0.03,
  tilt: THREE.MathUtils.degToRad(20),
  turretY: 4.42,
  mountRadius: 0.42,
  eyepieceTilt: THREE.MathUtils.degToRad(42),
  headY: 5.3,
};

// Standard objective colour code: red 4x, yellow 10x, blue 40x. The band colours are a real
// convention, so a student who meets one in a lab finds the same colours there.
const OBJECTIVES = [
  { power: 40, length: 1.02, band: 0x2f6fe0, turn: 0 },
  { power: 10, length: 0.8, band: 0xf0c020, turn: (Math.PI * 2) / 3 },
  { power: 4, length: 0.6, band: 0xd8362b, turn: -(Math.PI * 2) / 3 },
];

function scopeOptics() {
  const { axisZ, tilt, turretY, mountRadius } = SCOPE;
  const down = V(0, -Math.cos(tilt), Math.sin(tilt));
  const back = V(0, -Math.sin(tilt), -Math.cos(tilt));
  // Placed so the turret's ACTIVE objective hangs exactly on the optical axis and points straight
  // down, while the other two swing out toward the front and either side.
  const turret = V(0, turretY, axisZ + mountRadius * Math.cos(tilt));
  const objectives = OBJECTIVES.map((o) => {
    const e = back.clone().applyAxisAngle(down, o.turn);
    const mount = turret.clone().addScaledVector(e, mountRadius);
    const dir = down.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(e, Math.sin(tilt)).normalize();
    return { ...o, mount, dir };
  });
  return { down, turret, objectives };
}

// One small atlas for everything printed on the instrument. A dark band with white figures is what
// a real objective carries, and it does not have to match the chrome it wraps.
function powerLabelTexture() {
  const cells = [['4x', '#16191d', '#f1f2f4'], ['10x', '#16191d', '#f1f2f4'], ['40x', '#16191d', '#f1f2f4'], ['10x', '#1b1e23', '#f1f2f4']];
  return canvasTexture(512, 96, (ctx) => {
    cells.forEach(([text, bg, fg], i) => {
      ctx.fillStyle = bg;
      ctx.fillRect(i * 128, 0, 128, 96);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, text, 108, 72, (px) => `bold ${px}px Arial, sans-serif`);
      ctx.fillText(text, i * 128 + 64, 50);
    });
  });
}

// A printed patch curved round a barrel. `cell` picks the atlas column; a barrel that points down
// has its local +Y pointing at the floor, so its label is flipped to read upright.
function barrelLabel(radius, y0, y1, span, centre, cell, flip) {
  const cols = 10;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let c = 0; c <= cols; c++) {
    const s = c / cols;
    const a = centre + (s - 0.5) * span;
    for (const [row, y] of [[0, y0], [1, y1]]) {
      positions.push(Math.sin(a) * radius, y, Math.cos(a) * radius);
      const u = flip ? 1 - s : s;
      const v = flip ? 1 - row : row;
      uvs.push((cell + u) / 4, v);
    }
  }
  for (let c = 0; c < cols; c++) {
    const a = c * 2;
    indices.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// The bearing round an aimed barrel that faces as near +Z as it can: where to print its label.
function bearingToFront(dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()).invert();
  const local = V(0, 0, 1).addScaledVector(dir, -dir.z).applyQuaternion(q);
  return Math.atan2(local.x, local.z);
}

function compoundMicroscope() {
  const { axisZ, stageTop, slideThick, turretY, eyepieceTilt, headY } = SCOPE;
  const enamel = [];
  const chrome = [];
  const labels = [];
  const BLACK = 0x2a2d33;
  const CHROME = 0xe4e7ec;
  const { down, turret, objectives } = scopeOptics();

  // --- The horseshoe: one casting swept round a U, open toward the front, heaviest at the back.
  enamel.push({ geometry: sweptCasting([
    [1.3, 0, 1.85], [1.42, 0, 0.9], [1.28, 0, -0.35], [0.76, 0, -1.25], [0, 0, -1.52],
    [-0.76, 0, -1.25], [-1.28, 0, -0.35], [-1.42, 0, 0.9], [-1.3, 0, 1.85],
  ], (t) => {
    const k = Math.sin(t * Math.PI); // 0 at the toes, 1 at the heel
    const toe = Math.min(1, Math.min(t, 1 - t) / 0.075);
    const rounded = Math.sqrt(Math.max(0.0025, 1 - (1 - toe) * (1 - toe)));
    return { w: 0.25 * (0.72 + 0.28 * rounded), h: (0.36 + 0.3 * k * k) * (0.05 + 0.95 * rounded), round: 0.3, lift: 0.25 };
  }, { lateral: [0, 1, 0], samples: 150, sides: 24 }), color: BLACK });

  // --- The arm: a heavy cast C, thick at the root and narrowing to the head. Its path IS the
  // silhouette from the side.
  const armPath = [
    [0, 0.25, -1.5], [0, 1.25, -1.72], [0, 2.3, -1.78], [0, 3.3, -1.66], [0, 4.2, -1.26], [0, 4.92, -0.62], [0, 5.28, 0.02], [0, headY, axisZ],
  ];
  const armLat = [0.52, 0.47, 0.43, 0.4, 0.37, 0.35, 0.33, 0.3];
  const armThick = [0.56, 0.5, 0.45, 0.4, 0.36, 0.33, 0.31, 0.28];
  enamel.push({ geometry: sweptCasting(armPath, (t) => ({
    w: splineAt(armLat, t), h: splineAt(armThick, t), round: 0.55,
  }), { lateral: [1, 0, 0], samples: 64, sides: 32 }), color: BLACK });

  // A chrome line let into each cheek of the arm, following its curve: most of what stops the arm
  // being one black shape, and exactly what the makers of these instruments did.
  for (const side of [-1, 1]) {
    chrome.push({ geometry: sweptCasting(armPath, (t) => {
      const fade = Math.min(1, Math.min(t - 0.44, 0.86 - t) / 0.03);
      const k = Math.max(0.02, fade);
      return { w: 0.022, h: 0.05 * k, round: 0.7, lift: side * (splineAt(armLat, t) - 0.012 - (1 - k) * 0.12) };
    }, { lateral: [1, 0, 0], samples: 56, sides: 8 }), color: CHROME });
  }

  // The boss where the arm roots into the heel of the horseshoe.
  enamel.push({ geometry: lathe([[0.58, 0.44, 'c'], [0.66, 0.5], [0.6, 0.62], [0.44, 0.8], [0, 0.86]], { segments: 40 }).translate(0, 0, -1.56), color: BLACK });

  // --- The optical head, where the light turns from the body tube into the eyepiece.
  enamel.push({ geometry: ball(0.52, [0, headY, axisZ], { detail: 36, squash: [0.8, 1, 1.08] }), color: BLACK });
  enamel.push({ geometry: lathe([
    [0.36, 4.45, 'c'], [0.41, 4.5, 'c'], [0.42, 4.7], [0.42, 4.98], [0.34, 5.28], [0, 5.32],
  ], { segments: 36 }).translate(0, 0, axisZ), color: BLACK });

  // --- The inclined eyepiece tube. Everything along it is authored up its own axis.
  const eyeDir = V(0, Math.cos(eyepieceTilt), Math.sin(eyepieceTilt));
  const headAt = [0, headY, axisZ];
  enamel.push({ geometry: aimed(lathe([
    [0.4, 0.1], [0.385, 0.5], [0.355, 0.8], [0.345, 1.08, 'c'], [0.0, 1.08],
  ], { segments: 36 }), headAt, eyeDir), color: BLACK });
  chrome.push({ geometry: aimed(lathe([
    [0.37, 1.0, 'c'], [0.375, 1.03], [0.375, 1.14], [0.33, 1.2, 'c'], [0.25, 1.2, 'c'], [0.25, 1.68], [0, 1.68],
  ], { segments: 36 }), headAt, eyeDir), color: CHROME });
  // The eyepiece: a black barrel, a knurled grip, a flared cup and a dark lens at the bottom of it.
  enamel.push({ geometry: aimed(lathe([
    [0.285, 1.62, 'c'], [0.29, 1.66], [0.29, 1.98, 'c'], [0.315, 2.0, 'ck'], [0.315, 2.13, 'ck'], [0.29, 2.15, 'c'],
    [0.29, 2.21], [0.34, 2.32], [0.375, 2.42], [0.37, 2.46, 'c'], [0.3, 2.45, 'c'], [0.25, 2.38, 'c'], [0, 2.36],
  ], { segments: 72, flutes: 24, depth: 0.08 }), headAt, eyeDir), color: BLACK });
  enamel.push({ geometry: aimed(lathe([[0.235, 2.37, 'c'], [0.17, 2.385], [0, 2.392]], { segments: 28 }), headAt, eyeDir), color: 0x0c1a2a });
  const eyeBearing = bearingToFront(eyeDir);
  labels.push({ geometry: aimed(barrelLabel(0.296, 1.72, 1.92, 1.25, eyeBearing, 3, false), headAt, eyeDir) });

  // --- The nosepiece turret: a tilted knurled disc with a dome over it.
  const turretUp = down.clone().negate();
  chrome.push({ geometry: aimed(lathe([
    [0, -0.02], [0.68, -0.02, 'c'], [0.74, 0.02, 'ck'], [0.74, 0.14, 'ck'], [0.68, 0.17, 'c'], [0.56, 0.3], [0.42, 0.42], [0.25, 0.52], [0, 0.56],
  ], { segments: 96, flutes: 32, depth: 0.05 }), turret, turretUp), color: 0xb7bcc4 });

  for (const o of objectives) {
    const { length: L } = o;
    chrome.push({ geometry: aimed(lathe([
      [0, -0.05], [0.3, -0.05, 'c'], [0.31, 0.03], [0.3, 0.1, 'c'], [0.255, 0.13, 'c'], [0.245, 0.17], [0.245, L * 0.72, 'c'],
      [0.208, L * 0.78], [0.172, L * 0.9], [0.15, L - 0.02, 'c'], [0, L - 0.02],
    ], { segments: 36 }), o.mount, o.dir), color: CHROME });
    // A coloured band low on the barrel, proud of it and sunk at both edges, and a black nose.
    enamel.push({ geometry: aimed(lathe([
      [0.24, L * 0.5, 'c'], [0.256, L * 0.5 + 0.01, 'c'], [0.256, L * 0.5 + 0.1, 'c'], [0.24, L * 0.5 + 0.11, 'c'],
    ], { segments: 36 }), o.mount, o.dir), color: o.band });
    enamel.push({ geometry: aimed(lathe([
      [0.13, L - 0.085, 'c'], [0.176, L - 0.075, 'c'], [0.17, L, 'c'], [0.09, L + 0.012, 'c'], [0, L + 0.012],
    ], { segments: 24 }), o.mount, o.dir), color: BLACK });
    const cell = o.power === 4 ? 0 : o.power === 10 ? 1 : 2;
    const h0 = 0.17;
    const h1 = Math.min(L * 0.5 - 0.015, 0.36);
    labels.push({ geometry: aimed(barrelLabel(0.249, h0, h1, 1.3, bearingToFront(o.dir), cell, true), o.mount, o.dir) });
  }

  // --- The stage: a square plate on a bracket that rides a rail on the front of the arm. Turning
  // the focus knobs drives a rack, so the stage rises and falls, which is what the card says.
  const stageBelow = stageTop - 0.14;
  const stage = roundedSlab(1.14, 1.14, 0.12, [[0.03, 0], [0, 0.03], [0, 0.11], [0.03, 0.14]]);
  stage.translate(0, stageBelow, axisZ);
  enamel.push({ geometry: stage, color: BLACK });
  const bracket = roundedSlab(0.42, 0.34, 0.06, [[0.015, 0], [0, 0.02], [0, 0.56], [0.03, 0.59]]);
  bracket.translate(0, stageTop - 0.62, -1.08);
  enamel.push({ geometry: bracket, color: BLACK });
  // The rail and rack rise above and below the bracket on the arm's front face.
  chrome.push({ geometry: new THREE.BoxGeometry(0.34, 2.15, 0.1).translate(0, 2.72, -1.36), color: CHROME });
  for (let i = 0; i < 14; i++) {
    chrome.push({ geometry: new THREE.BoxGeometry(0.2, 0.05, 0.1).translate(0, 3.17 + i * 0.1 - 0.0, -1.29), color: 0xbfc4cb });
  }

  // The aperture: a chrome ring standing proud of the plate, with a dark well inside it.
  chrome.push({ geometry: lathe([[0.3, -0.01], [0.32, 0.012, 'c'], [0.28, 0.022, 'c'], [0.22, 0.016, 'c'], [0, 0.016]], { segments: 40 }).translate(0, stageTop, axisZ), color: CHROME });
  enamel.push({ geometry: lathe([[0.222, 0.014, 'c'], [0, 0.019]], { segments: 28 }).translate(0, stageTop, axisZ), color: 0x05070a });

  // The specimen: a stained dot on the slide over the aperture.
  enamel.push({ geometry: ball(0.13, [0, stageTop + slideThick + 0.03, axisZ], { detail: 18, squash: [1, 0.05, 1] }), color: 0xc2487a });

  // Two spring clips, each a thin strip from a screwed boss on the plate down onto the slide.
  for (const sx of [-1, 1]) {
    const boss = [sx * 0.62, stageTop, axisZ - 0.72];
    chrome.push({ geometry: lathe([[0.09, -0.02], [0.09, 0.05, 'c'], [0.075, 0.075, 'c'], [0, 0.08]], { segments: 18 }).translate(boss[0], boss[1], boss[2]), color: CHROME });
    chrome.push({ geometry: sweptCasting([
      [boss[0], stageTop + 0.055, boss[2]],
      [boss[0], stageTop + 0.075, boss[2] + 0.35],
      [boss[0], stageTop + 0.066, boss[2] + 0.62],
      [boss[0], stageTop + slideThick + 0.018, boss[2] + 0.92],
    ], (t) => {
      const end = Math.min(1, (1 - t) / 0.04);
      return { w: 0.07, h: 0.012 * (0.2 + 0.8 * end), round: 0.5 };
    }, { lateral: [1, 0, 0], samples: 16, sides: 12 }), color: CHROME });
  }

  // --- Under the stage: the condenser that gathers light into the specimen.
  enamel.push({ geometry: lathe([
    [0.2, stageBelow + 0.03], [0.33, stageBelow - 0.02, 'c'], [0.33, stageBelow - 0.32], [0.27, stageBelow - 0.4, 'c'], [0.25, stageBelow - 0.56, 'c'],
    [0.12, stageBelow - 0.6, 'c'], [0, stageBelow - 0.6],
  ].reverse().map(([r, y, f]) => [r, y, f]), { segments: 36 }).translate(0, 0, axisZ), color: BLACK });
  chrome.push({ geometry: lathe([
    [0.33, stageBelow - 0.24, 'c'], [0.36, stageBelow - 0.22, 'ck'], [0.36, stageBelow - 0.12, 'ck'], [0.33, stageBelow - 0.1, 'c'],
  ], { segments: 72, flutes: 24, depth: 0.05 }).translate(0, 0, axisZ), color: CHROME });
  // The iris lever, sticking out to the side, and its knob.
  chrome.push({ geometry: rod([0.3, stageBelow - 0.17, axisZ + 0.08], [0.56, stageBelow - 0.17, axisZ + 0.26], 0.018, { sides: 8 }), color: CHROME });
  enamel.push({ geometry: ball(0.04, [0.56, stageBelow - 0.17, axisZ + 0.26], { detail: 10 }), color: BLACK });

  // --- The mirror on its fork, under the condenser and open to the front.
  const pivot = V(0, 1.42, axisZ);
  const barFrom = V(0, 1.56, -1.5);
  const barTo = V(0, 1.56, axisZ - 0.8);
  chrome.push({ geometry: rod(barFrom, barTo, 0.075, { sides: 14, open: true }), color: CHROME });
  chrome.push({ geometry: ball(0.11, [barTo.x, barTo.y, barTo.z], { detail: 14 }), color: CHROME });
  const armBoss = lathe([[0, -0.2], [0.14, -0.2, 'c'], [0.14, 0.2, 'c'], [0, 0.2]], { segments: 18 });
  armBoss.rotateX(Math.PI / 2);
  armBoss.translate(0, 1.56, -1.16);
  chrome.push({ geometry: armBoss, color: CHROME });
  for (const sx of [-1, 1]) {
    bentRod(chrome, CHROME, [barTo, V(sx * 0.48, 1.54, axisZ - 0.64), V(sx * 0.68, 1.44, axisZ - 0.28), V(sx * 0.7, pivot.y, pivot.z)], 0.045, { sides: 10, samples: 18 });
    chrome.push({ geometry: rod([sx * 0.56, pivot.y, pivot.z], [sx * 0.76, pivot.y, pivot.z], 0.04, { sides: 12 }), color: CHROME });
    chrome.push({ geometry: ball(0.058, [sx * 0.77, pivot.y, pivot.z], { detail: 12 }), color: CHROME });
  }
  const mirrorNormal = V(0, Math.cos(0.55), Math.sin(0.55));
  enamel.push({ geometry: aimed(lathe([
    [0, -0.09], [0.48, -0.09, 'c'], [0.6, -0.03, 'c'], [0.6, 0.03, 'c'], [0.56, 0.04, 'c'],
  ], { segments: 48 }), pivot, mirrorNormal), color: BLACK });
  // Its own mesh, because a shadow falling across a mirror is the one thing a mirror cannot show.
  const mirrorParts = aimed(lathe([[0.565, 0.035, 'c'], [0.46, 0.022], [0.36, 0.012], [0.26, 0.006], [0.14, 0.002], [0, 0]], { segments: 48 }), pivot, mirrorNormal);
  // The sky in it, brighter at the top edge, so it reads as a silvered glass and not a white plate.
  const mirrorUp = new THREE.Vector3().crossVectors(V(1, 0, 0), mirrorNormal).normalize();
  const mirrorColours = [];
  const mirrorPoint = new THREE.Vector3();
  for (let i = 0; i < mirrorParts.attributes.position.count; i++) {
    mirrorPoint.fromBufferAttribute(mirrorParts.attributes.position, i).sub(pivot);
    const h = mirrorPoint.dot(mirrorUp) / 0.565;
    const k = 0.42 + 0.3 * h * Math.abs(h) + 0.1 * (mirrorPoint.length() / 0.565);
    mirrorColours.push(k * 0.92, k * 0.98, k * 1.08);
  }
  mirrorParts.setAttribute('color', new THREE.Float32BufferAttribute(mirrorColours, 3));
  const mirrorFace = mesh(mirrorParts, steel({ roughness: 0.2, metalness: 0.2 }));
  mirrorFace.receiveShadow = false;
  mirrorFace.castShadow = false;

  // --- Focus knobs: coarse (the big one) and fine (the small one on the same shaft), on both sides
  // of the arm, low down where a hand resting on the bench finds them.
  const knobY = 2.42;
  const knobZ = -1.76;
  for (const sx of [-1, 1]) {
    const dir = V(sx, 0, 0);
    const at = [0, knobY, knobZ];
    enamel.push({ geometry: aimed(lathe([
      [0.28, 0.34, 'c'], [0.56, 0.42, 'c'], [0.6, 0.44, 'ck'], [0.6, 0.66, 'ck'], [0.56, 0.68, 'c'], [0.33, 0.73, 'c'], [0.1, 0.74, 'c'],
    ], { segments: 112, flutes: 28, depth: 0.08 }), at, dir), color: BLACK });
    enamel.push({ geometry: aimed(lathe([
      [0.1, 0.7, 'c'], [0.31, 0.77, 'c'], [0.33, 0.79, 'ck'], [0.33, 0.96, 'ck'], [0.3, 0.98, 'c'], [0.16, 1.0, 'c'],
    ], { segments: 80, flutes: 20, depth: 0.09 }), at, dir), color: BLACK });
    chrome.push({ geometry: aimed(lathe([[0.17, 0.97, 'c'], [0.17, 1.005, 'c'], [0.13, 1.03, 'c'], [0, 1.04]], { segments: 24 }), at, dir), color: CHROME });
    // A chrome cap at the tilt pivot, low on the arm.
    chrome.push({ geometry: aimed(lathe([[0.2, 0.4, 'c'], [0.22, 0.42], [0.22, 0.5, 'c'], [0.17, 0.53, 'c'], [0, 0.54]], { segments: 28 }), [0, 1.0, -1.66], dir), color: CHROME });
  }

  const slide = new THREE.BoxGeometry(1.75, slideThick, 0.58);
  slide.translate(0, stageTop + slideThick / 2 + 0.024, axisZ);
  const glass = mesh(slide, standard({ color: 0xd6ecf4, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false }));
  glass.castShadow = false;

  const printed = mesh(mergeParts(labels.map((l) => ({ ...l, color: 0xffffff }))), standard({ map: powerLabelTexture(), roughness: 0.45, metalness: 0 }));
  printed.castShadow = false;
  printed.material.vertexColors = false;

  return group(
    mesh(mergeParts(enamel), glossy({ roughness: 0.26 })),
    mesh(polish(mergeParts(chrome), { sky: 0.7, horizon: 1.05, dark: 0.14, ground: 0.5 }), steel({ roughness: 0.18, metalness: 0.42 })),
    printed,
    mirrorFace,
    glass,
  );
}

// ---------------------------------------------------------------------------
// Gear train
// ---------------------------------------------------------------------------

// A true involute spur gear, because a tooth is its flank. LoftKit's `gearOutline` fixes tooth
// proportions as a fraction of the tooth step and of the outer radius, and that cannot be made to
// mesh between gears of different counts: the tooth's width at the pitch circle changes with the
// count. Every gear here shares one module, so the pitch circles of a meshing pair touch at
// exactly the sum of their radii and a tooth at the pitch line is half a circular pitch wide.
const TRAIN = {
  module: 0.12,
  pressure: THREE.MathUtils.degToRad(20),
  addendum: 0.92,
  dedendum: 1.2,
  backlash: 0.014,
  thickness: 0.46,
  z: 0.58,
  // Coplanar, so the teeth can engage. Listed in the order they mesh.
  gears: [
    { teeth: 36, color: 0xd8362b, spokes: 6, arrowFrom: 1.75, arrowSweep: 1.0, markAt: 3.6 },
    { teeth: 24, color: 0xf0b414, spokes: 5, arrowFrom: -1.65, arrowSweep: 1.05, markAt: -0.3 },
    { teeth: 12, color: 0x2672f0, spokes: 0, arrowFrom: 2.75, arrowSweep: 1.25, markAt: 1.0 },
  ],
  first: [-1.0, 3.02],
  bearings: [THREE.MathUtils.degToRad(35), THREE.MathUtils.degToRad(130)],
};

const involute = (phi) => Math.tan(phi) - phi;

// The outline of a gear with a tooth centred on angle 0, counter-clockwise. Each point carries
// whether it belongs to a tooth rather than to the root land between two teeth, which is what lets
// one tooth be painted cleanly.
function spurOutline(N) {
  const { module: m, pressure, addendum, dedendum, backlash } = TRAIN;
  const rp = (N * m) / 2;
  const rb = rp * Math.cos(pressure);
  const ra = rp + addendum * m;
  const rr = rp - dedendum * m;
  const halfPitch = (Math.PI * m) / 4 - backlash / 2;
  const psiP = halfPitch / rp + involute(pressure);
  const psi = (r) => psiP - involute(Math.acos(Math.min(1, rb / Math.max(r, rb))));
  const step = (Math.PI * 2) / N;
  const flank = [];
  const flankSteps = 6;
  const r0 = Math.max(rb, rr);
  for (let i = 0; i <= flankSteps; i++) flank.push(r0 + ((ra - r0) * i) / flankSteps);

  const points = [];
  for (let k = 0; k < N; k++) {
    const c = k * step;
    const at = (a, r, tooth, id) => points.push({ x: Math.cos(c + a) * r, y: Math.sin(c + a) * r, tooth: tooth ? k : -1, id });
    const rootAngle = psi(rr);
    at(-rootAngle, rr, false);
    at(-rootAngle, rr, true);
    if (rb > rr) at(-psi(rb), rb, true);
    for (let i = rb > rr ? 1 : 0; i <= flankSteps; i++) at(-psi(flank[i]), flank[i], true);
    at(-psi(ra), ra, true); // crease into the tip land
    at(0, ra, true);
    at(psi(ra), ra, true);
    at(psi(ra), ra, true); // crease out of the tip land
    for (let i = flankSteps; i >= (rb > rr ? 1 : 0); i--) at(psi(flank[i]), flank[i], true);
    if (rb > rr) at(psi(rb), rb, true);
    at(rootAngle, rr, true);
    at(rootAngle, rr, false);
    // A midpoint on the root land keeps the land round on a big gear.
    at(step / 2, rr, false);
  }
  return { points, rp, ra, rr, rb };
}

// Where each gear stands and how far it is turned, so that a tooth of one sits in a gap of the next.
//
// If `a` is how far a gear's nearest tooth is from the line of centres, measured in teeth, and `b`
// the same for its mate looking back along that line, then the pair is in mesh when a + b is one
// half: a tooth on the line for one is a gap on the line for the other. Turning one gear by delta
// turns the other by -delta N1/N2, which leaves a + b unchanged, so this holds at any phase.
function gearTrainLayout() {
  const { module: m, gears, first, bearings } = TRAIN;
  const out = [];
  let previous = null;
  gears.forEach((gear, i) => {
    const rp = (gear.teeth * m) / 2;
    let centre;
    let phase;
    if (!previous) {
      centre = first.slice();
      phase = bearings[0] + 0.5 * ((Math.PI * 2) / gear.teeth) * 0.4;
    } else {
      const bearing = bearings[i - 1];
      const dist = previous.rp + rp;
      centre = [previous.centre[0] + Math.cos(bearing) * dist, previous.centre[1] + Math.sin(bearing) * dist];
      const stepA = (Math.PI * 2) / previous.teeth;
      const stepB = (Math.PI * 2) / gear.teeth;
      const a = (bearing - previous.phase) / stepA;
      phase = bearing + Math.PI - (0.5 - a) * stepB;
    }
    const entry = { ...gear, rp, centre, phase };
    out.push(entry);
    previous = entry;
  });
  return out;
}

// One rim of teeth: outer walls, inner wall and two annular faces, with colour written per point so
// that the marked tooth stops exactly at its own root corners.
function gearRim(outline, innerR, depth, color, marker, markTooth = 0) {
  const { points } = outline;
  const n = points.length;
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const body = new THREE.Color(color);
  const mark = new THREE.Color(marker);
  const tint = (p) => (p.tooth === markTooth ? mark : body);
  const push = (x, y, z, c) => {
    positions.push(x, y, z);
    colors.push(c.r, c.g, c.b);
    uvs.push(0, 0);
  };
  const back = -depth / 2;
  const front = depth / 2;
  // Outer wall.
  let start = 0;
  for (const z of [back, front]) for (const p of points) push(p.x, p.y, z, tint(p));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(start + i, start + j, start + n + j, start + i, start + n + j, start + n + i);
  }
  // Inner wall.
  start = positions.length / 3;
  const inner = points.map((p) => {
    const a = Math.atan2(p.y, p.x);
    return [Math.cos(a) * innerR, Math.sin(a) * innerR];
  });
  for (const z of [back, front]) for (const [x, y] of inner) push(x, y, z, body);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(start + i, start + n + i, start + n + j, start + i, start + n + j, start + j);
  }
  // Faces, in two bands: the teeth down to the root circle, then the plain rim. A vertex colour
  // blends across its triangle, so without the split the marked tooth's white smears right across
  // the rim. A tint can only be as detailed as the mesh under it.
  const strip = (z, flip, outerRing, innerRing) => {
    const s = positions.length / 3;
    outerRing.forEach(([x, y, c]) => push(x, y, z, c));
    innerRing.forEach(([x, y, c]) => push(x, y, z, c));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) indices.push(s + i, s + n + j, s + j, s + i, s + n + i, s + n + j);
      else indices.push(s + i, s + j, s + n + j, s + i, s + n + j, s + n + i);
    }
  };
  const rootR = Math.hypot(points[0].x, points[0].y);
  const toothRing = points.map((p) => [p.x, p.y, tint(p)]);
  const rootRingTinted = points.map((p) => {
    const a = Math.atan2(p.y, p.x);
    return [Math.cos(a) * rootR, Math.sin(a) * rootR, tint(p)];
  });
  const rootRing = rootRingTinted.map(([x, y]) => [x, y, body]);
  const innerRing = inner.map(([x, y]) => [x, y, body]);
  for (const [z, flip] of [[front, false], [back, true]]) {
    strip(z, flip, toothRing, rootRingTinted);
    strip(z, flip, rootRing, innerRing);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A spoke tapering from the hub to the rim, as a flat extrusion: an outline at its true angle, so
// no rotation has to be composed afterwards.
function spoke(angle, r0, r1, w0, w1, thick) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pt = (r, side) => [c * r - s * side, s * r + c * side];
  return extrudeOutline([pt(r0, -w0), pt(r1, -w1), pt(r1, w1), pt(r0, w0)], thick);
}

function gearTrain() {
  const { thickness, z: gearZ } = TRAIN;
  const layout = gearTrainLayout();
  const paint = [];
  const metal = [];
  const frame = [];
  const baseTop = 0.56;
  const plateHalfW = 3.92;
  const plateTop = 7.86;
  const plateMidY = (plateTop + baseTop) / 2;
  const plateHalfH = (plateTop - baseTop) / 2;
  const frontZ = 0.06;
  const FRAME = 0x4f6078;
  const FRAME_EDGE = 0x657891;
  const STEEL = 0xe4e7ec;
  const along = V(0, 0, 1);
  const plateBackZ = frontZ - 0.2;

  layout.forEach((g, gearIndex) => {
    const outline = spurOutline(g.teeth);
    const [cx, cy] = g.centre;
    const innerR = outline.rr - 0.2;
    // One white tooth on each gear to count from, turned to somewhere it can be seen.
    const markTooth = ((Math.round(((g.markAt - g.phase) / (Math.PI * 2)) * g.teeth) % g.teeth) + g.teeth) % g.teeth;
    // The rim, turned to its phase. A rotation about Z keeps every position and normal correct.
    paint.push({
      geometry: placed(gearRim(outline, innerR, thickness, g.color, 0xf6f5ef, markTooth), {
        pos: [cx, cy, gearZ], rot: [0, 0, g.phase],
      }),
      keepColor: true,
    });
    const webThick = thickness * 0.5;
    const hubR = Math.max(0.28, g.rp * 0.2);
    if (g.spokes) {
      for (let s = 0; s < g.spokes; s++) {
        const a = g.phase + ((s + 0.5) / g.spokes) * Math.PI * 2;
        paint.push({
          geometry: spoke(a, hubR * 0.7, innerR + 0.06, hubR * 0.46, hubR * 0.32, webThick).translate(cx, cy, gearZ),
          color: g.color,
        });
      }
    } else {
      // The smallest gear has no room for spokes, and has a plain web.
      paint.push({ geometry: aimed(lathe([
        [0, -webThick / 2], [innerR + 0.04, -webThick / 2, 'c'], [innerR + 0.04, webThick / 2, 'c'], [0, webThick / 2],
      ], { segments: 40 }), [cx, cy, gearZ], along), color: g.color });
    }
    // The hub, standing proud of the rim on both faces.
    paint.push({ geometry: aimed(lathe([
      [0, -thickness * 0.62], [hubR, -thickness * 0.62, 'c'], [hubR, thickness * 0.5, 'c'], [hubR * 0.8, thickness * 0.62, 'c'], [0, thickness * 0.62],
    ], { segments: 40 }), [cx, cy, gearZ], along), color: g.color });
    // The axle, a bearing flange on the plate, a washer and a hex nut.
    const nutZ = gearZ + thickness * 0.62;
    metal.push({ geometry: rod([cx, cy, plateBackZ - 0.1], [cx, cy, nutZ + 0.1], 0.085, { sides: 16 }), color: STEEL });
    metal.push({ geometry: aimed(lathe([
      [0.0, -0.02], [hubR * 1.25, -0.02, 'c'], [hubR * 1.25, 0.05, 'c'], [hubR * 0.7, 0.09, 'c'], [hubR * 0.62, gearZ - thickness * 0.62 - frontZ + 0.02, 'c'], [0, gearZ - thickness * 0.62 - frontZ + 0.02],
    ], { segments: 32 }), [cx, cy, frontZ], along), color: STEEL });
    metal.push({ geometry: aimed(lathe([
      [0, -0.01], [hubR * 0.72, -0.01, 'c'], [hubR * 0.72, 0.022, 'c'], [0, 0.022],
    ], { segments: 28 }), [cx, cy, nutZ], along), color: STEEL });
    metal.push({ geometry: hexNut(0.16, 0.12, g.phase).translate(cx, cy, nutZ + 0.08), color: STEEL });
    // The axle comes through the plate at the back, where it is held by a nut of its own.
    metal.push({ geometry: aimed(lathe([[0, 0], [hubR * 0.9, 0, 'c'], [hubR * 0.9, 0.06, 'c'], [hubR * 0.5, 0.09, 'c'], [0, 0.1]], { segments: 24 }), [cx, cy, plateBackZ + 0.01], V(0, 0, -1)), color: STEEL });
    metal.push({ geometry: hexNut(0.15, 0.1, 0.3).translate(cx, cy, plateBackZ - 0.13), color: STEEL });
    // A painted arrow round the gear, on the plate where the teeth do not cover it, saying which way
    // it turns when the crank goes clockwise. Every meshed pair turns opposite ways.
    const clockwise = gearIndex % 2 === (layout.length - 1) % 2;
    frame.push({ geometry: turnArrow(cx, cy, outline.ra + 0.3, g.arrowFrom, g.arrowSweep, clockwise, frontZ), color: g.color });
  });

  // The crank, on the 12-tooth gear: the small gear driving the big ones is the lesson on the card.
  const small = layout[layout.length - 1];
  const [sx, sy] = small.centre;
  const crankZ = gearZ + thickness * 0.62 + 0.26;
  const crankAngle = THREE.MathUtils.degToRad(28);
  const crankLen = 1.06;
  const tip = V(sx + Math.cos(crankAngle) * crankLen, sy + Math.sin(crankAngle) * crankLen, crankZ);
  metal.push({ geometry: rod([sx, sy, crankZ - 0.2], [sx, sy, crankZ + 0.06], 0.1, { sides: 18 }), color: STEEL });
  const armOutline = [];
  const armSteps = 8;
  const cA = Math.cos(crankAngle);
  const sA = Math.sin(crankAngle);
  for (let i = 0; i <= armSteps; i++) {
    const a = -Math.PI / 2 + (i / armSteps) * Math.PI;
    const x = crankLen + Math.cos(a) * 0.1;
    const y = Math.sin(a) * 0.1;
    armOutline.push([sx + x * cA - y * sA, sy + x * sA + y * cA]);
  }
  for (let i = 0; i <= armSteps; i++) {
    const a = Math.PI / 2 + (i / armSteps) * Math.PI;
    const x = Math.cos(a) * 0.19;
    const y = Math.sin(a) * 0.19;
    armOutline.push([sx + x * cA - y * sA, sy + x * sA + y * cA]);
  }
  metal.push({ geometry: extrudeOutline(armOutline, 0.1).translate(0, 0, crankZ), color: STEEL });
  metal.push({ geometry: rod(tip.clone().add(V(0, 0, -0.04)), tip.clone().add(V(0, 0, 0.22)), 0.05, { sides: 12 }), color: STEEL });
  paint.push({ geometry: aimed(lathe([
    [0, 0.04], [0.07, 0.05], [0.095, 0.12], [0.1, 0.32], [0.088, 0.56], [0.118, 0.7], [0.1, 0.8], [0, 0.83],
  ], { segments: 24 }), tip, along), color: 0x1d2026 });

  // --- The upright plate, framed and bolted, sunk into the base.
  const plate = roundedSlab(plateHalfW, plateHalfH + 0.1, 0.32, [[0.015, -0.2], [0, -0.185], [0, -0.015], [0.015, 0]]);
  plate.rotateX(Math.PI / 2);
  plate.translate(0, plateMidY - 0.1, frontZ - 0.0);
  frame.push({ geometry: plate, color: FRAME });

  const barW = 0.26;
  const barD = 0.06;
  const frontBars = [
    [0, plateTop - barW / 2 - 0.05, 2 * plateHalfW - 0.2, barW],
    [0, baseTop + barW / 2, 2 * plateHalfW - 0.2, barW],
    [-plateHalfW + barW / 2 + 0.05, plateMidY, barW, 2 * plateHalfH - 0.1],
    [plateHalfW - barW / 2 - 0.05, plateMidY, barW, 2 * plateHalfH - 0.1],
  ];
  for (const [x, y, w, h] of frontBars) {
    const bar = roundedSlab(w / 2, h / 2, 0.03, [[0, -0.02], [0, barD - 0.015], [0.015, barD]]);
    bar.rotateX(Math.PI / 2);
    bar.translate(x, y, frontZ);
    frame.push({ geometry: bar, color: FRAME_EDGE });
  }
  for (const x of [-plateHalfW + 0.18, -plateHalfW / 2, 0, plateHalfW / 2, plateHalfW - 0.18]) {
    for (const y of [plateTop - 0.18, baseTop + 0.13]) {
      metal.push({ geometry: boltHead(x, y, frontZ + barD), color: STEEL });
    }
  }
  for (const x of [-plateHalfW + 0.18, plateHalfW - 0.18]) {
    for (const y of [plateMidY - plateHalfH * 0.5, plateMidY, plateMidY + plateHalfH * 0.5]) {
      metal.push({ geometry: boltHead(x, y, frontZ + barD), color: STEEL });
    }
  }

  // The same frame on the back of the plate, so walking round it finds a made thing and not a sheet.
  for (const [x, y, w, h] of frontBars) {
    const bar = roundedSlab(w / 2, h / 2, 0.03, [[0, -0.02], [0, barD - 0.015], [0.015, barD]]);
    bar.rotateX(-Math.PI / 2);
    bar.translate(x, y, plateBackZ);
    frame.push({ geometry: bar, color: FRAME_EDGE });
  }

  // Two gussets behind the plate: an 8ft sheet on a base wants bracing, and it gives the side view
  // something to read besides a line.
  for (const x of [-2.7, 2.7]) {
    const gusset = extrudeOutline([[0, baseTop + 3.2], [0, baseTop - 0.04], [-1.42, baseTop - 0.04], [-1.42, baseTop + 0.22]], 0.16);
    gusset.rotateY(-Math.PI / 2);
    // Rotating about Y sends the outline's x to z, so the outline's negative x runs toward the back.
    gusset.translate(x, 0, -0.1);
    frame.push({ geometry: gusset, color: FRAME });
  }

  // The base: a heavy moulded plinth.
  const base = roundedSlab(4.32, 1.78, 0.2, [[0, 0], [0, 0.34], [0.06, 0.42], [0.2, baseTop - 0.03], [0.24, baseTop]]);
  frame.push({ geometry: base, color: 0x38424f });

  return group(
    mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.36, metalness: 0.05 })),
    mesh(polish(mergeParts(metal), { sky: 1.05, dark: 0.2, ground: 0.55 }), steel()),
    mesh(mergeParts(frame), standard({ vertexColors: true, roughness: 0.62, metalness: 0.05, ...relief('metal', { seed: 13, repeat: 2, strength: 0.05 }) })),
  );
}

// A flat curved arrow lying on the plate, sunk into it. `from` and `sweep` are in radians and the
// head is always at the end of travel, so `clockwise` only decides which end that is.
function turnArrow(cx, cy, radius, from, sweep, clockwise, z) {
  const half = 0.05;
  const head = 0.14;
  const headLen = 0.3 / radius;
  const steps = 22;
  const outer = [];
  const inner = [];
  const dir = clockwise ? -1 : 1;
  const start = clockwise ? from + sweep : from;
  for (let i = 0; i <= steps; i++) {
    const a = start + dir * ((i / steps) * sweep);
    outer.push([cx + Math.cos(a) * (radius + half), cy + Math.sin(a) * (radius + half)]);
    inner.push([cx + Math.cos(a) * (radius - half), cy + Math.sin(a) * (radius - half)]);
  }
  const end = start + dir * sweep;
  const tip = end + dir * headLen;
  const outline = [
    ...outer,
    [cx + Math.cos(end) * (radius + head), cy + Math.sin(end) * (radius + head)],
    [cx + Math.cos(tip) * radius, cy + Math.sin(tip) * radius],
    [cx + Math.cos(end) * (radius - head), cy + Math.sin(end) * (radius - head)],
    ...inner.reverse(),
  ];
  return ribbonArrow(outline, steps + 1, z);
}

// The arrow is a long thin curved outline, which no centre fan can cap, so its top is stitched
// across from one edge to the other and the head closed as its own triangle.
function ribbonArrow(outline, count, z) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const total = outline.length;
  for (const zz of [z - 0.03, z + 0.012]) {
    for (const [x, y] of outline) {
      positions.push(x, y, zz);
      uvs.push(0, 0);
    }
  }
  for (const [x, y] of outline) {
    positions.push(x, y, z + 0.012);
    uvs.push(0, 0);
  }
  const top = total * 2;
  const wind = (a, b, c) => {
    const [ax, ay] = outline[a];
    const [bx, by] = outline[b];
    const [cx, cy] = outline[c];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area > 0) indices.push(top + a, top + b, top + c);
    else indices.push(top + a, top + c, top + b);
  };
  for (let i = 0; i < count - 1; i++) {
    const a = i;
    const b = i + 1;
    const d = total - 1 - i;
    const c = total - 2 - i;
    wind(a, b, c);
    wind(a, c, d);
  }
  wind(count - 1, count, count + 1);
  wind(count - 1, count + 1, count + 2);
  // The little band round the edge, whichever way the outline happens to wind.
  let area = 0;
  for (let i = 0; i < total; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % total];
    area += x0 * y1 - x1 * y0;
  }
  for (let i = 0; i < total; i++) {
    const j = (i + 1) % total;
    if (area > 0) indices.push(i, j, total + j, i, total + j, total + i);
    else indices.push(i, total + j, j, i, total + i, total + j);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A nut's corners are doubled so each flat stays flat.
function hexNut(radius, depth, turn) {
  const outline = [];
  for (let i = 0; i < 6; i++) {
    const a = turn + (i / 6) * Math.PI * 2;
    const p = [Math.cos(a) * radius, Math.sin(a) * radius];
    outline.push(p, p);
  }
  return extrudeOutline(outline, depth);
}

function boltHead(x, y, z) {
  return aimed(lathe([[0, -0.02], [0.075, -0.02, 'c'], [0.075, 0.02, 'c'], [0.055, 0.04, 'c'], [0, 0.045]], { segments: 14 }), [x, y, z], V(0, 0, 1));
}

// ---------------------------------------------------------------------------

// The arithmetic behind each model, exported so it can be checked by something other than a picture.
export const LAB_LAYOUTS = {
  atom: atomLayout,
  salt: saltLayout,
  cradle: () => ({ ...cradleLayout(), radius: CRADLE.ballRadius }),
  gears: () => gearTrainLayout().map((g) => ({ ...g, outline: spurOutline(g.teeth).points })),
};

export const BUILDERS = {
  'carbon-atom': () => carbonAtom(),
  'salt-crystal': () => saltCrystal(),
  'newtons-cradle': () => newtonsCradle(),
  'compound-microscope': () => compoundMicroscope(),
  'gear-train': () => gearTrain(),
};
