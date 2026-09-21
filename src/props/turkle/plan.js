// THE PLAN OF TURKLE STREET -- where the kerbs, the pavement and the lot lines are, in feet.
//
// This module is PURE ARITHMETIC. It imports nothing, builds no geometry and knows about
// neither three.js nor Babylon, and that is the whole reason it exists: the street is drawn
// TWICE -- once by `src/props/TurkleProps.js` as the pickable three.js object and once by
// `HiFi/src/props/Turkle.js` as the photographic model that is actually rendered -- and a
// street whose two copies disagree by a foot is a street with a kerb running through the
// middle of its own gutter. One description, two renderers.
//
// It also answers the question that decides whether a paved intersection reads as paved at
// all: HOW HIGH IS THE ROAD AT THIS POINT. A real curbed street is a shallow trough. The
// gutter flowline sits about five inches below the lawn, the pan rises two feet to the edge
// of pavement, and the asphalt then crowns back up to nearly lawn level at the centre line.
// Get that wrong -- lay the asphalt as one flat slab, which is what every first pass does --
// and the curb has nothing to do, the gutter is a painted stripe, and rain would run
// uphill.
//
// THE HEIGHT COMES FROM ONE GLOBAL DISTANCE FUNCTION, not from each piece's own cross
// section, and that is what makes the intersection correct for free. `curbDistance(x, z)` is
// the distance from a point to the nearest KERB, wherever that kerb is -- a straight run, or
// one of the four corner returns. Feed it to `roadHeight()` and the gutter automatically
// follows the returns round the corner, dies out across the mouth of the intersection (there
// is no kerb there to run beside), and leaves the middle of the junction as one flat
// plateau, which is exactly what a real one is. A per-piece cross section cannot do any of
// that without special cases at every corner.
//
// Geometry, all of it read off the photographs:
//
//   * TURKLE AVENUE runs east-west, kerb faces at z = 21 and z = 47 -- twenty-six feet, a
//     residential section, not an arterial.
//   * WEST 7th STREET crosses it north-south, kerb faces at x = -83 and x = -57.
//   * The four corner returns are R = 18, tangent to both kerbs, which is why the pavement
//     is decomposed the way it is below.
//
// Everything downstream is stated as a grid of points (`pavementPatches`) or a swept path
// (`curbRuns`). Neither edition invents a vertex of its own, so a seam between two pieces is
// a shared EDGE rather than two edges that nearly coincide -- the hairline-crack rule The
// Neighborhood's street grid records.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAN = {
  // Kerb faces. The road is between them.
  turkleN: 21,
  turkleS: 47,
  seventhW: -83,
  seventhE: -57,
  returnR: 18,
  // How far each street runs from the middle before it is left to the fog. Past
  // WORLD_BOUND_RADIUS (195) it is scenery, but it has to REACH that far or the street
  // visibly stops in the middle of a lawn.
  reach: 170,

  // The trough, in feet above the lawn.
  curbTop: 0.16,     // top of the kerb, a hair proud of the grass
  curbBack: 0.70,    // how far the kerb reaches back under the grass
  curbBase: -1.40,   // buried bottom of the kerb solid
  flow: -0.40,       // gutter flowline, at the kerb face
  panWidth: 2.0,     // concrete gutter pan
  panEdge: -0.24,    // edge of pavement, where asphalt meets pan
  crown: 0.0,        // the middle of the carriageway, back up at lawn level
  crownRun: 11,      // feet from the pan edge to full crown (half of 26 less the two pans)
};

const TAU = Math.PI * 2;
const deg = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// The kerb line
// ---------------------------------------------------------------------------

// Four chains, each running with the ROAD ON ITS LEFT. That is not a convention chosen for
// tidiness: the swept kerb profile is written as (distance into the road, height), so the
// sweep's outward axis is the path's left normal (-dz, dx), and one chain wound the other
// way turns its kerb inside out and buries the face in the lawn.
//
// Each chain is a straight run, a quarter-circle return, and another straight run. They are
// listed anticlockwise about the junction.
export const CURB_CHAINS = [
  { // north-west: Turkle's north kerb coming in from the west, round into 7th's west kerb
    parts: [
      { seg: [[-PLAN.reach, PLAN.turkleN], [-101, PLAN.turkleN]] },
      { arc: { c: [-101, 3], r: PLAN.returnR, a0: deg(90), a1: deg(0) } },
      { seg: [[-83, 3], [-83, -PLAN.reach]] },
    ],
  },
  { // north-east: 7th's east kerb coming down from the north, round into Turkle's north kerb
    parts: [
      { seg: [[-57, -PLAN.reach], [-57, 3]] },
      { arc: { c: [-39, 3], r: PLAN.returnR, a0: deg(180), a1: deg(90) } },
      { seg: [[-39, PLAN.turkleN], [PLAN.reach, PLAN.turkleN]] },
    ],
  },
  { // south-east: Turkle's south kerb coming in from the east, round into 7th's east kerb
    parts: [
      { seg: [[PLAN.reach, PLAN.turkleS], [-39, PLAN.turkleS]] },
      { arc: { c: [-39, 65], r: PLAN.returnR, a0: deg(270), a1: deg(180) } },
      { seg: [[-57, 65], [-57, PLAN.reach]] },
    ],
  },
  { // south-west: 7th's west kerb coming up from the south, round into Turkle's south kerb
    parts: [
      { seg: [[-83, PLAN.reach], [-83, 65]] },
      { arc: { c: [-101, 65], r: PLAN.returnR, a0: deg(360), a1: deg(270) } },
      { seg: [[-101, PLAN.turkleS], [-PLAN.reach, PLAN.turkleS]] },
    ],
  },
];

function segDistance(px, pz, [ax, az], [bx, bz]) {
  const dx = bx - ax; const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function arcDistance(px, pz, { c, r, a0, a1 }) {
  const dx = px - c[0]; const dz = pz - c[1];
  const rad = Math.hypot(dx, dz);
  let a = Math.atan2(dz, dx);
  const lo = Math.min(a0, a1); const hi = Math.max(a0, a1);
  // Bring the point's bearing into the arc's own turn before testing it -- an arc written
  // 360 -> 270 lives outside atan2's range entirely.
  while (a < lo - 1e-9) a += TAU;
  while (a > hi + TAU - 1e-9) a -= TAU;
  if (a >= lo - 1e-9 && a <= hi + 1e-9) return Math.abs(rad - r);
  const e0 = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r];
  const e1 = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
  return Math.min(Math.hypot(px - e0[0], pz - e0[1]), Math.hypot(px - e1[0], pz - e1[1]));
}

// Distance from a point to the nearest kerb face. THE ONE FUNCTION the whole road surface
// is derived from.
export function curbDistance(x, z) {
  let best = Infinity;
  for (const chain of CURB_CHAINS) {
    for (const part of chain.parts) {
      const d = part.seg ? segDistance(x, z, part.seg[0], part.seg[1]) : arcDistance(x, z, part.arc);
      if (d < best) best = d;
    }
  }
  return best;
}

// A ROAD HAS TO STOP SOMEWHERE, AND A FLAT SLAB ENDING IN MID-FIELD SHOWS ITS OWN EDGE.
//
// Looking down either street away from the junction, the first pass ended the carriageway in
// a hard bright line across open grass with the skirt of the slab catching the sun under it.
// There is no junction out there to end it at and fog will not hide it -- Kansas air is the
// clearest in the app and that is a deliberate part of this world.
//
// So the last thirty-four feet DIVE, three feet down. The ground closes over the road about
// a quarter of the way into the ramp and what is left reads as the street going over a rise,
// which is how a road on the plains actually leaves the frame. The kerb sinks with it
// (`sweepAlong`/`sweepMesh` add this to every frame), or a length of kerb is left standing in
// the grass with no road between it.
//
// `max(|x|, |z|)` is the along-street distance without having to know which street a point is
// on: near the junction both are small, along Turkle x dominates, up 7th z does.
const SINK_RUN = 34;
const SINK_DEPTH = 3.0;
export function sinkAt(x, z) {
  const along = Math.max(Math.abs(x), Math.abs(z));
  const t = Math.min(1, Math.max(0, (along - (PLAN.reach - SINK_RUN)) / SINK_RUN));
  return SINK_DEPTH * t * t * (3 - 2 * t);
}

// Height of the finished road surface at a point inside the pavement.
export function roadHeight(x, z) {
  const d = curbDistance(x, z);
  const sink = sinkAt(x, z);
  if (d <= PLAN.panWidth) return PLAN.flow + (PLAN.panEdge - PLAN.flow) * (d / PLAN.panWidth) - sink;
  const t = Math.min(1, (d - PLAN.panWidth) / PLAN.crownRun);
  // A parabolic crown, which is what a paving machine actually lays -- a linear one has a
  // visible ridge down the middle of the street.
  return PLAN.panEdge + (PLAN.crown - PLAN.panEdge) * (1 - (1 - t) * (1 - t)) - sink;
}

// True where the surface is the CONCRETE gutter pan rather than asphalt. Quads are
// classified by their own centre, so the boundary lands on a grid line wherever the kerb is
// straight (which is everywhere except the returns, where it is radial and therefore exact).
export function isPan(x, z) { return curbDistance(x, z) <= PLAN.panWidth + 1e-6; }

// ---------------------------------------------------------------------------
// Station lists -- THE SEAM RULE
// ---------------------------------------------------------------------------
//
// Two pieces of pavement that meet must share their vertices, not merely their edge. So the
// station lists are built ONCE, here, and every patch that touches another patch takes its
// stations from the same list. The fillets' outer legs are 2ft steps over 18ft; the bands
// that they abut carry those same 2ft steps, and the 26ft opening across the junction
// carries the same twenty stations on both sides of it.

const FILLET_N = 9;  // divisions along each 18ft leg of a return's outer corner

// Stations across a 26ft carriageway, fine at the two kerbs (the pan is only 2ft wide and
// carries the whole fall) and coarse through the middle, where it is one smooth crown.
function crossStations(a, b) {
  const span = b - a;
  const f = [0, 0.5, 1, 1.5, 2, 2.75, 3.75, 5, 6.5, 8.25, 10.25, 13,
    15.75, 17.75, 19.5, 21, 22.25, 23.25, 24, 24.5, 25, 25.5, 26];
  return f.map((v) => a + (v / 26) * span);
}

function ramp(a, b, step) {
  const out = [];
  const n = Math.max(1, Math.round((b - a) / step));
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

function join(...lists) {
  const out = [];
  for (const l of lists) for (const v of l) if (!out.length || Math.abs(out[out.length - 1] - v) > 1e-6) out.push(v);
  return out;
}

// Along Turkle: coarse out at the world edge, 2ft through both pairs of returns, and the
// junction's own cross stations across the mouth.
function turkleStations() {
  return join(
    ramp(-PLAN.reach, -110, 12),
    ramp(-110, -101, 4.5),
    ramp(-101, -83, 18 / FILLET_N),
    crossStations(-83, -57),
    ramp(-57, -39, 18 / FILLET_N),
    ramp(-39, -14, 5),
    ramp(-14, 62, 5.4),
    ramp(62, PLAN.reach, 12),
  );
}

// Along 7th: 2ft through the returns either side of the junction, coarse away from it.
function seventhStations(from, to) {
  // `from` is the junction-side end.
  const dir = Math.sign(to - from);
  const near = dir < 0
    ? join(ramp(3, -15, 18 / FILLET_N).reverse(), ramp(-15, -60, 7.5).reverse(), ramp(-60, to, 12).reverse()).reverse()
    : join(ramp(65, 83, 18 / FILLET_N), ramp(83, 128, 7.5), ramp(128, to, 12));
  return dir < 0 ? near : near;
}

// ---------------------------------------------------------------------------
// The pavement, decomposed so that nothing overlaps anything
// ---------------------------------------------------------------------------
//
// Seven patches. The three BANDS are the two carriageways, with Turkle's band owning the
// whole junction square (the Neighborhood's rule: the through street owns the intersection,
// so the cross street abuts it rather than crossing it). The four FILLETS are the flares at
// the inner corners -- an 18ft square with a quarter-disc of grass taken out of it, which is
// exactly what a kerb return leaves behind.
//
// A fillet is parameterised from its arc to its outer corner, and it DEGENERATES to a point
// at each tangent, which is correct: a return's flare has zero width where it meets the
// straight kerb. Zero-area quads there are dropped by the callers.
export function pavementPatches() {
  const patches = [];
  const tX = turkleStations();
  const zAcross = crossStations(PLAN.turkleN, PLAN.turkleS);

  // Turkle Avenue, full width, full length, junction included.
  patches.push({ name: 'turkle', rows: tX.map((x) => zAcross.map((z) => [x, z])) });

  // West 7th, north of the junction and south of it. Its cross stations are Turkle's own
  // stations through the mouth, so the shared edges at z = 21 and z = 47 line up vertex for
  // vertex.
  const xAcross = crossStations(PLAN.seventhW, PLAN.seventhE);
  const zNorth = join(ramp(-PLAN.reach, -60, 12), ramp(-60, -15, 7.5), ramp(-15, 3, 18 / FILLET_N), ramp(3, PLAN.turkleN, 18 / FILLET_N));
  const zSouth = join(ramp(PLAN.turkleS, 65, 18 / FILLET_N), ramp(65, 83, 18 / FILLET_N), ramp(83, 128, 7.5), ramp(128, PLAN.reach, 12));
  patches.push({ name: 'seventh-n', rows: zNorth.map((z) => xAcross.map((x) => [x, z])) });
  patches.push({ name: 'seventh-s', rows: zSouth.map((z) => xAcross.map((x) => [x, z])) });

  for (const f of RETURNS) patches.push({ name: `return-${f.name}`, rows: filletRows(f) });
  return patches;
}

// The four returns. `c` is the arc centre, `a0`/`a1` its bearings, and `leg0`/`leg1` are the
// two outer legs it flares to -- written as the points the arc's own ends map to.
const RETURNS = [
  { name: 'ne', c: [-39, 3], a0: deg(180), a1: deg(90), corner: [-57, 21] },
  { name: 'nw', c: [-101, 3], a0: deg(90), a1: deg(0), corner: [-83, 21] },
  { name: 'se', c: [-39, 65], a0: deg(270), a1: deg(180), corner: [-57, 47] },
  { name: 'sw', c: [-101, 65], a0: deg(360), a1: deg(270), corner: [-83, 47] },
];

function filletRows({ c, a0, a1, corner }) {
  const R = PLAN.returnR;
  const p0 = [c[0] + Math.cos(a0) * R, c[1] + Math.sin(a0) * R];
  const p1 = [c[0] + Math.cos(a1) * R, c[1] + Math.sin(a1) * R];
  const rows = [];
  const RADIAL = 7;
  for (let i = 0; i <= FILLET_N * 2; i++) {
    const t = i / (FILLET_N * 2);
    const a = a0 + (a1 - a0) * t;
    const arc = [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R];
    // The outer boundary is an L: the first half runs from the arc's first tangent point to
    // the square corner, the second half from the corner to the other tangent point. Both
    // halves are stepped in EQUAL 2ft divisions, which is what the abutting bands carry.
    const u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
    const out = t <= 0.5
      ? [p0[0] + (corner[0] - p0[0]) * u, p0[1] + (corner[1] - p0[1]) * u]
      : [corner[0] + (p1[0] - corner[0]) * u, corner[1] + (p1[1] - corner[1]) * u];
    const row = [];
    for (let k = 0; k <= RADIAL; k++) {
      const s = k / RADIAL;
      row.push([arc[0] + (out[0] - arc[0]) * s, arc[1] + (out[1] - arc[1]) * s]);
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The kerb runs, and the driveway aprons that interrupt them
// ---------------------------------------------------------------------------

// Samples one chain into a polyline of `{ x, z, nx, nz }` frames, `n` being the LEFT normal
// -- which by the winding rule above points into the road.
function sampleChain(chain, step = 4) {
  const pts = [];
  const push = (x, z, nx, nz) => {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - x, last.z - z) < 1e-6) return;
    pts.push({ x, z, nx, nz });
  };
  for (const part of chain.parts) {
    if (part.seg) {
      const [[ax, az], [bx, bz]] = part.seg;
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / step));
      const dx = (bx - ax) / len; const dz = (bz - az) / len;
      for (let i = 0; i <= n; i++) push(ax + (bx - ax) * (i / n), az + (bz - az) * (i / n), -dz, dx);
    } else {
      const { c, r, a0, a1 } = part.arc;
      const n = Math.max(6, Math.round((Math.abs(a1 - a0) * r) / 1.6));
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        // Walking the arc with decreasing bearing, the tangent is (sin a, -cos a); its left
        // normal is (cos a, sin a), i.e. straight out from the centre. Walking the other way
        // both flip. One `sign` keeps the kerb facing the road either way round.
        const sign = a1 > a0 ? -1 : 1;
        push(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, sign * Math.cos(a), sign * Math.sin(a));
      }
    }
  }
  return pts;
}

// The kerb, as runs of frames to sweep a profile along. `aprons` are driveway crossings on
// Turkle's NORTH kerb: a real apron replaces the kerb with a depressed concrete ramp over
// its own width, so the run is CUT there rather than the ramp being laid over a kerb that is
// still standing. Each is `{ x, width }` -- the driveway's centre and its width at the kerb,
// to which the flare wings are added here so the layout does not have to know about them.
export const APRON_WING = 3.2;

export function curbRuns(aprons = []) {
  const cuts = aprons.map((a) => ({
    side: a.side ?? 'north',
    lo: a.x - a.width / 2 - APRON_WING,
    hi: a.x + a.width / 2 + APRON_WING,
  }));
  const runs = [];
  for (const chain of CURB_CHAINS) {
    const pts = sampleChain(chain);
    let run = [];
    for (const p of pts) {
      // Only Turkle's two kerbs are ever cut -- 7th has no frontage on this block, so
      // nobody's drive crosses it.
      const kerbZ = Math.abs(p.z - PLAN.turkleN) < 0.01 ? 'north'
        : Math.abs(p.z - PLAN.turkleS) < 0.01 ? 'south' : null;
      const cut = kerbZ && cuts.some((c) => c.side === kerbZ && p.x > c.lo && p.x < c.hi);
      if (cut) { if (run.length > 1) runs.push(run); run = []; } else run.push(p);
    }
    if (run.length > 1) runs.push(run);
  }
  // A cut leaves the kerb ending in mid-air at the apron's wing, so each cut end is squared
  // off by the sweep's own end cap; nothing else is needed.
  return runs;
}

// A driveway apron: the concrete that carries a car from the gutter up to the lot, laid
// where the kerb has been cut out. Returned as a grid, like the pavement, so the two agree
// at the gutter.
//
// The wings are the whole trick. A slab the width of the drive leaves a six-inch step down
// to the gutter at each side; the wings are what a real apron uses to bring that step to
// nothing, and they are why an apron is wider at the kerb than the drive it serves.
export function apronRows({ x, width, back = 18, side = 'north' }) {
  const kerb = side === 'south' ? PLAN.turkleS : PLAN.turkleN;
  const halfDrive = width / 2;
  const halfFull = halfDrive + APRON_WING;
  const rows = [];
  const zs = [kerb, kerb + (back - kerb) * 0.04, kerb + (back - kerb) * 0.1,
    kerb + (back - kerb) * 0.18, back - (back - kerb) * 0.05, back];
  const cols = [];
  for (let i = -8; i <= 8; i++) cols.push(i / 8);
  for (const z of zs) {
    const row = [];
    for (const u of cols) {
      const sign = Math.sign(u) || 1;
      const a = Math.abs(u);
      // Full width at the kerb, narrowing to the drive's own width by the back of the apron.
      const t = (kerb - z) / (kerb - back);
      const half = halfFull + (halfDrive - halfFull) * Math.min(1, t * 1.6);
      row.push([x + sign * a * half, z]);
    }
    rows.push(row);
  }
  return rows;
}

// Height of the apron surface at a point: the gutter at the kerb line, lot level at the
// back, and the wings sloping across as well as along.
export function apronHeight(x, z, { x: cx, width, back = 18, lot = 0.06, side = 'north' }) {
  const kerb = side === 'south' ? PLAN.turkleS : PLAN.turkleN;
  const t = Math.min(1, Math.max(0, (kerb - z) / (kerb - back)));
  const along = PLAN.flow + (lot - PLAN.flow) * (t * t * (3 - 2 * t));
  // Across: the wings drop to the gutter's own level at their outer edge, so the apron is a
  // shallow valley rather than a slab with two cliffs.
  const half = width / 2;
  const over = Math.max(0, Math.abs(x - cx) - half) / APRON_WING;
  const wing = Math.min(1, over) * (1 - t);
  return along - (along - PLAN.flow) * wing * 0.85;
}
