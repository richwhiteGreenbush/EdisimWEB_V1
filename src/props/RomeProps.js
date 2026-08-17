import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

// The Flavian Amphitheatre -- the Colosseum -- and the corner of imperial Rome around it.
//
// SCALE. The real building is 615ft by 510ft and 157ft tall, which does not fit inside
// this app at all: WORLD_BOUND_RADIUS is 195ft, so a full-size Colosseum would be a wall
// the student could never walk around and never see whole. Everything here is therefore
// built at ROME = 1/3, the same compromise Ancient Egypt makes at 1/5, and the placards
// state the real dimensions so the reduction teaches rather than misleads.
//
// One number was chosen against the student rather than against the building: the ground
// arcade's arches come out about 8ft tall and 4.7ft wide, which a 5ft person walks through
// comfortably. That ratio (a person a little over half the height of the opening) is very
// close to the real one, so the arcade reads correctly even though the building does not.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const TRAVERTINE = 0xd8cbaa;
const TRAVERTINE_LIGHT = 0xe4d9bd;
const TRAVERTINE_SHADE = 0xbaac8c;
const TRAVERTINE_DARK = 0x9c8e70;
const TUFA = 0xa89878;
const BRICK = 0x9c6a4e;
const BRICK_DARK = 0x82563e;
const MARBLE = 0xe6e0d2;

// ---------------------------------------------------------------------------
// Local geometry helpers
// ---------------------------------------------------------------------------

// mergeColored applies a part's rotation as rotateX -> rotateY -> rotateZ, in that fixed
// order, and offers no way to compose two rotations about different axes in the order a
// caller wants. Everything in an arcade needs exactly that: a voussoir is rotated about Z
// to sit in its arch ring, and then the whole arch is swung about Y to face out of an
// elliptical wall. Doing it through the part fields applies the swing FIRST and produces a
// starburst of blocks flung off the building.
//
// So the arcade bakes a full Matrix4 into the geometry itself and hands mergeColored a
// part with no rotation at all -- the same escape hatch ParkProps.gooseSolid() uses, and
// for the same reason.
function xformed(geometry, color, matrix) {
  const g = geometry.clone();
  g.applyMatrix4(matrix);
  geometry.dispose();
  return { geometry: g, color };
}

// world = translate * rotateY(yaw) -- the frame of one bay in a curved wall.
function bayFrame(x, y, z, yaw) {
  return new THREE.Matrix4()
    .makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw));
}

// One semicircular arch ring, authored in the bay's own local frame: X across the
// opening, Y up from the springing line, Z through the wall.
//
// The blocks lie flush ONLY because the ring is a true circle -- a voussoir rotated by its
// own angle is tangent to a circle of that radius and to nothing else. Give an arch an
// independent rise and the same code splays the blocks outward like a starburst, which is
// the trap called out in CLAUDE.md for the bear dens, the park bridge and the library.
function archVoussoirs(radius, depth, blockDepth, color, count = 9) {
  const parts = [];
  const span = Math.PI / count;
  // Tangential length is generous by a whisker so neighbouring blocks bite into each
  // other instead of showing a hairline of daylight between them at the extrados.
  const tangential = 2 * radius * Math.tan(span / 2) * 1.06;
  for (let i = 0; i < count; i++) {
    const a = span * (i + 0.5);
    const g = new THREE.BoxGeometry(blockDepth, tangential, depth);
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * (radius + blockDepth / 2), Math.sin(a) * (radius + blockDepth / 2), 0)
      .multiply(new THREE.Matrix4().makeRotationZ(a));
    g.applyMatrix4(m);
    parts.push({ geometry: g, color });
  }
  return parts;
}

// Points evenly spaced BY ARC LENGTH round an ellipse, with the outward normal at each.
//
// Even steps in the parametric angle are not even steps along the curve -- on this
// ellipse they bunch the bays at the ends of the long axis and stretch them at the sides,
// which on a building whose whole signature is eighty identical arches is the first thing
// anyone would notice. Cheap to do properly: walk a fine table once, then resample it.
function ellipseStations(a, b, count, samples = 2048) {
  const cum = [0];
  let total = 0;
  let px = a;
  let pz = 0;
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const x = Math.cos(t) * a;
    const z = Math.sin(t) * b;
    total += Math.hypot(x - px, z - pz);
    cum.push(total);
    px = x;
    pz = z;
  }
  const stations = [];
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (cursor < samples && cum[cursor + 1] < target) cursor++;
    const t = (cursor / samples) * Math.PI * 2;
    const x = Math.cos(t) * a;
    const z = Math.sin(t) * b;
    // Outward normal of x=a·cos t, z=b·sin t is proportional to (b·cos t, a·sin t).
    stations.push({ x, z, yaw: Math.atan2(Math.cos(t) * b, Math.sin(t) * a), t });
  }
  return { stations, perimeter: total };
}

// A flat elliptical annulus lying in the ground plane, and the wall that drops from its
// inner edge -- the tread and riser of one seating tier.
function ellipticalRing(innerA, outerA, ratio, y, color, segments = 72) {
  const parts = [];
  const tread = new THREE.RingGeometry(innerA, outerA, segments);
  tread.rotateX(-Math.PI / 2);
  tread.scale(1, 1, ratio);
  tread.translate(0, y, 0);
  parts.push({ geometry: tread, color });
  return parts;
}

// ---------------------------------------------------------------------------
// The Colosseum
// ---------------------------------------------------------------------------

// `ruinFrom`/`ruinTo` are the arc (in turns, 0..1) over which the OUTER four-storey
// facade still stands. That wall is the building's most famous fact: two thirds of it is
// gone, quarried for stone through the middle ages, and what survives is one continuous
// northern stretch. A Colosseum modelled intact is a Colosseum nobody recognises.
export function colosseum({
  radiusX = 100, radiusZ = 82, height = 50, bays = 80,
  ruinFrom = 0.30, ruinTo = 0.80, seed = 5,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const stone = [];
  const inner = [];

  const { stations, perimeter } = ellipseStations(radiusX, radiusZ, bays);
  const bayWidth = perimeter / bays;

  // Four storeys. The attic is the tall solid one -- it carries no arcade at all, only
  // pilasters and small square windows, which is what makes the top of the building read
  // as a wall rather than as a fourth ring of holes.
  const storey = height * 0.22;
  const atticH = height - storey * 3;
  const wallDepth = radiusX * 0.052;

  // The arch is sized from the bay, not the other way round: pier = bay - 2·archRadius is
  // fixed, and padding the piers "so they overlap" narrows every opening while the ring
  // keeps its radius, leaving voussoirs apparently floating in the wall.
  const archR = bayWidth * 0.33;
  const springing = storey * 0.30;

  const withinRuin = (turn) => {
    const t = ((turn % 1) + 1) % 1;
    return t >= ruinFrom && t <= ruinTo;
  };

  for (let k = 0; k < bays; k++) {
    const s = stations[k];
    const turn = k / bays;
    // How much of this bay survives. The ends of the standing stretch are ragged rather
    // than sheared off square: a wall that stops dead at full height reads as a model that
    // was cut, not as a ruin.
    const distToEnd = Math.min(
      Math.abs(turn - ruinFrom), Math.abs(turn - ruinTo),
      Math.abs(turn + 1 - ruinTo), Math.abs(turn - 1 - ruinFrom),
    );
    let levels = withinRuin(turn) ? 4 : 0;
    if (levels === 4 && distToEnd < 0.035) levels = 2 + Math.floor(rng() * 2);
    else if (levels === 4 && distToEnd < 0.06) levels = 3 + Math.floor(rng() * 2);

    for (let lv = 0; lv < Math.min(levels, 3); lv++) {
      const base = lv * storey;
      const frame = bayFrame(s.x, base, s.z, s.yaw);
      const tone = lv === 0 ? TRAVERTINE : lv === 1 ? TRAVERTINE_SHADE : TRAVERTINE_DARK;

      // Piers either side of the opening, then the arch ring over it.
      const pierW = (bayWidth - archR * 2) / 2;
      for (const side of [-1, 1]) {
        const p = new THREE.BoxGeometry(pierW, springing + archR + storey * 0.1, wallDepth);
        stone.push(xformed(p, tone, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(side * (archR + pierW / 2), (springing + archR + storey * 0.1) / 2, 0),
        )));
      }
      const ring = archVoussoirs(archR, wallDepth, bayWidth * 0.1, tone);
      for (const part of ring) {
        stone.push(xformed(part.geometry, tone, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(0, springing, 0),
        )));
      }
      // Spandrel above the arch, closing the wall up to the next entablature.
      const spanTop = springing + archR + bayWidth * 0.1;
      const fillH = Math.max(0.2, storey - spanTop);
      const fill = new THREE.BoxGeometry(bayWidth, fillH, wallDepth);
      stone.push(xformed(fill, tone, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(0, spanTop + fillH / 2, 0),
      )));

      // The engaged half-column in front of each pier. These are the orders stacked in
      // the correct sequence -- Doric, Ionic, Corinthian -- which is the single most
      // taught thing about this facade, so the capitals get visibly different profiles.
      const colR = bayWidth * 0.075;
      const colH = storey * 0.84;
      const col = new THREE.CylinderGeometry(colR * 0.9, colR, colH, 12);
      stone.push(xformed(col, tone, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(-(archR + pierW / 2), colH / 2, wallDepth / 2),
      )));
      const capH = lv === 0 ? colR * 0.5 : colR * 0.9;
      const capR = lv === 0 ? colR * 1.15 : lv === 1 ? colR * 1.35 : colR * 1.5;
      const cap = new THREE.CylinderGeometry(capR, colR * 0.95, capH, 12);
      stone.push(xformed(cap, MARBLE, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(-(archR + pierW / 2), colH + capH / 2, wallDepth / 2),
      )));

      // Entablature band over the whole bay, tying the storey together.
      const ent = new THREE.BoxGeometry(bayWidth * 1.02, storey * 0.1, wallDepth * 1.3);
      stone.push(xformed(ent, tone, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(0, storey - storey * 0.05, 0),
      )));
    }

    // The attic: solid wall, flat pilasters, and a small square window every other bay.
    if (levels >= 4) {
      const frame = bayFrame(s.x, storey * 3, s.z, s.yaw);
      const wall = new THREE.BoxGeometry(bayWidth, atticH, wallDepth);
      stone.push(xformed(wall, TRAVERTINE_SHADE, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(0, atticH / 2, 0),
      )));
      const pil = new THREE.BoxGeometry(bayWidth * 0.16, atticH * 0.86, wallDepth * 0.35);
      stone.push(xformed(pil, TRAVERTINE, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(-bayWidth / 2, atticH * 0.43, wallDepth * 0.6),
      )));
      if (k % 2 === 0) {
        const win = new THREE.BoxGeometry(bayWidth * 0.3, atticH * 0.24, wallDepth * 0.5);
        stone.push(xformed(win, 0x33291f, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(0, atticH * 0.52, wallDepth * 0.45),
        )));
      }
      // Corbels for the velarium masts. The awning was rigged from brackets exactly here
      // and worked by sailors seconded from the fleet at Misenum -- three sockets survive
      // in the real cornice for every bay.
      //
      // They have to be SHORT. A corbel is a bracket a foot or two proud of the wall, and
      // the first pass gave them the full wall depth and a half -- seven feet of stone
      // cantilevered into the air, which from the ground read as a row of diving boards
      // round the top of the building.
      const corbel = new THREE.BoxGeometry(bayWidth * 0.11, atticH * 0.07, wallDepth * 0.55);
      stone.push(xformed(corbel, TRAVERTINE, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(0, atticH * 0.94, wallDepth * 0.62),
      )));
      if (k % 4 === 0) {
        const mast = new THREE.CylinderGeometry(bayWidth * 0.028, bayWidth * 0.036, height * 0.13, 8);
        stone.push(xformed(mast, 0x6b543a, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(0, atticH + height * 0.065, wallDepth * 0.2),
        )));
      }
    }
  }

  // --- The second ring wall -----------------------------------------------
  // Inside the lost outer facade stands a lower wall that survives the whole way round.
  // It is what a visitor actually sees from three quarters of the approach, and without
  // it the building is a crescent rather than a ring.
  const innerA = radiusX * 0.86;
  const innerB = radiusZ * 0.86;
  const { stations: inner2 } = ellipseStations(innerA, innerB, bays);
  const innerBay = (perimeter * 0.86) / bays;
  for (let k = 0; k < bays; k++) {
    const s = inner2[k];
    // Ragged: the top storey is missing over most of the circuit, and here and there a
    // whole bay has gone. Seeded, so a reload gives back the same ruin.
    const roll = rng();
    const levels = withinRuin(k / bays) ? 3 : roll < 0.12 ? 0 : roll < 0.55 ? 2 : 3;
    for (let lv = 0; lv < levels; lv++) {
      const frame = bayFrame(s.x, lv * storey, s.z, s.yaw);
      const tone = lv === 0 ? TUFA : TRAVERTINE_DARK;
      const r = innerBay * 0.32;
      const pierW = (innerBay - r * 2) / 2;
      for (const side of [-1, 1]) {
        const p = new THREE.BoxGeometry(pierW, springing + r, wallDepth * 0.8);
        inner.push(xformed(p, tone, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(side * (r + pierW / 2), (springing + r) / 2, 0),
        )));
      }
      for (const part of archVoussoirs(r, wallDepth * 0.8, innerBay * 0.09, tone, 7)) {
        inner.push(xformed(part.geometry, tone, frame.clone().multiply(
          new THREE.Matrix4().makeTranslation(0, springing, 0),
        )));
      }
      const top = springing + r + innerBay * 0.09;
      const fillH = Math.max(0.15, storey - top);
      inner.push(xformed(new THREE.BoxGeometry(innerBay, fillH, wallDepth * 0.8), tone, frame.clone().multiply(
        new THREE.Matrix4().makeTranslation(0, top + fillH / 2, 0),
      )));
    }
  }

  // --- The cavea ----------------------------------------------------------
  // Seating in stepped elliptical tiers falling toward the arena. Rome sat by rank and
  // the rank was legislated: senators on the marble at the front, then knights, then
  // citizens, with women and the poor in the wooden gallery at the very top.
  const arenaA = radiusX * 0.47;
  const arenaB = radiusZ * 0.353;
  const ratio = radiusZ / radiusX;
  const tiers = 16;
  const caveaRise = storey * 2.5;
  const caveaTop = innerA * 0.97;

  // THE BANK HAS TO BE SOLID UNDERNEATH, and this is the one thing the first version of
  // this world got badly wrong. Treads and risers alone are a set of rings hanging in the
  // air: there is no collision anywhere in this app, so a student walks straight in under
  // them and finds themselves beneath thirty feet of seating looking up at the undersides
  // of the marble. A real cavea stands on a mass of vaulted concrete, and what that mass
  // does for us here is close the shape off.
  //
  // One open cone from the arena edge to the top, set a little below the step corners so
  // the treads still read as steps standing on it.
  const slope = new THREE.CylinderGeometry(caveaTop, arenaA, caveaRise, 72, 1, true);
  slope.scale(1, 1, ratio);
  slope.translate(0, 2.2 + caveaRise / 2 - 1.4, 0);
  inner.push({ geometry: slope, color: TUFA });
  // ...and the ring of substructure below the front row, so the bank meets the arena floor
  // in a wall rather than in a knife edge.
  const skirt = new THREE.CylinderGeometry(arenaA, arenaA, 3.6, 72, 1, true);
  skirt.scale(1, 1, ratio);
  skirt.translate(0, 1.8, 0);
  inner.push({ geometry: skirt, color: TRAVERTINE_DARK });

  for (let i = 0; i < tiers; i++) {
    const t0 = i / tiers;
    const t1 = (i + 1) / tiers;
    const a0 = THREE.MathUtils.lerp(arenaA, caveaTop, t0);
    const a1 = THREE.MathUtils.lerp(arenaA, caveaTop, t1);
    const y = 2.2 + t0 * caveaRise;
    const tone = i < 3 ? MARBLE : i < 10 ? TRAVERTINE_SHADE : TUFA;
    inner.push(...ellipticalRing(a0, a1, ratio, y, tone));
    // The riser under each tread, deliberately DARKER than the tread above it. Seen from
    // the arena a bank of seating is read almost entirely from the shadow line under each
    // row, and toned the same as its tread the whole cavea flattens into a smooth ramp.
    const riser = new THREE.CylinderGeometry(a0, a0, caveaRise / tiers + 0.1, 72, 1, true);
    riser.scale(1, 1, ratio);
    riser.translate(0, y - caveaRise / tiers / 2, 0);
    inner.push({ geometry: riser, color: new THREE.Color(tone).multiplyScalar(0.72).getHex() });
  }

  // Radial staircases dividing the bank into wedges. These are what a cavea actually looks
  // like -- the rows are cut by aisles every few yards, and the wedges between them (cunei)
  // are how a ticket told you where to sit. Without them a stepped ellipse still reads as a
  // ramp, because nothing crosses the horizontal lines.
  const aisles = 16;
  for (let i = 0; i < aisles; i++) {
    const t = (i / aisles) * Math.PI * 2;
    const steps = tiers;
    for (let s = 0; s < steps; s++) {
      const f = (s + 0.5) / steps;
      const a = THREE.MathUtils.lerp(arenaA, caveaTop, f);
      const y = 2.2 + f * caveaRise;
      const w = (caveaTop - arenaA) / steps * 1.3;
      const stair = new THREE.BoxGeometry(w, caveaRise / tiers * 0.55, radiusX * 0.055);
      stair.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(Math.cos(t) * a, y + 0.3, Math.sin(t) * a * ratio)
        .multiply(new THREE.Matrix4().makeRotationY(-Math.atan2(Math.sin(t) * ratio, Math.cos(t)))));
      inner.push({ geometry: stair, color: s < 6 ? TRAVERTINE_LIGHT : TRAVERTINE });
    }
  }

  // The podium wall: the barrier between the front row and the arena floor. It was 12ft
  // high in reality and that is the point of it -- the senators sat directly above
  // whatever was in the arena. Travertine rather than white marble: at 2.6ft and running
  // right round the arena, a bright white band is the first thing the eye lands on from
  // anywhere inside the building, and it should be the last.
  const podium = new THREE.CylinderGeometry(arenaA, arenaA, 2.6, 72, 1, true);
  podium.scale(1, 1, arenaB / arenaA);
  podium.translate(0, 1.3, 0);
  inner.push({ geometry: podium, color: TRAVERTINE_SHADE });

  const stoneMesh = mergedMesh(stone, { roughness: 0.92, ...relief('stone', { seed, repeat: 5 }) });
  const innerMesh = mergedMesh(inner, {
    roughness: 0.95, side: THREE.DoubleSide, ...relief('stone', { seed: seed + 3, repeat: 6 }),
  });
  g.add(stoneMesh, innerMesh);
  return g;
}

// The exposed substructure under the lost arena floor: a maze of brick service walls,
// with the modern partial deck over one end.
//
// It is built as walls STANDING ON the ground rather than as a pit, and that is not a
// shortcut -- PlayerController walks on the terrain and never on props, so an excavated
// floor would put a student's eyes below the deck they appear to be standing on. Walls
// rising out of the floor is also exactly what the hypogeum looks like today.
export function hypogeum({ radiusX = 47, radiusZ = 29, deck = 0.42, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const wallH = 3.2;

  // Concentric and radial walls -- the real plan is a grid of galleries, not a labyrinth.
  const rings = 4;
  for (let i = 1; i <= rings; i++) {
    const f = i / (rings + 0.4);
    const a = radiusX * f;
    const ring = new THREE.CylinderGeometry(a, a, wallH, 48, 1, true);
    ring.scale(1, 1, radiusZ / radiusX);
    ring.translate(0, wallH / 2, 0);
    parts.push({ geometry: ring, color: i % 2 ? BRICK : BRICK_DARK });
  }
  const spokes = 18;
  for (let i = 0; i < spokes; i++) {
    const t = (i / spokes) * Math.PI * 2;
    const len = radiusX * 0.78;
    const w = new THREE.BoxGeometry(len, wallH, 0.9);
    const m = new THREE.Matrix4()
      .makeTranslation(Math.cos(t) * radiusX * 0.42, wallH / 2, Math.sin(t) * radiusZ * 0.42)
      .multiply(new THREE.Matrix4().makeRotationY(-Math.atan2(Math.sin(t) * radiusZ, Math.cos(t) * radiusX)));
    parts.push(xformed(w, i % 3 ? BRICK : BRICK_DARK, m));
  }

  // Rubble and the stubs of the lift shafts. Thirty-two of these hauled animals up to the
  // arena on counterweighted platforms.
  for (let i = 0; i < 14; i++) {
    const t = rng() * Math.PI * 2;
    const r = 0.35 + rng() * 0.5;
    parts.push({
      geometry: new THREE.BoxGeometry(randomIn(rng, 1.2, 2.2), randomIn(rng, 0.8, 1.6), randomIn(rng, 1.2, 2)),
      color: rng() < 0.5 ? TUFA : BRICK,
      position: [Math.cos(t) * radiusX * r, 0.5, Math.sin(t) * radiusZ * r],
      rotation: [0, rng() * Math.PI, 0],
    });
  }

  g.add(mergedMesh(parts, { roughness: 0.96, side: THREE.DoubleSide, ...relief('stone', { seed, repeat: 7 }) }));

  // The reconstructed deck over one end, which is how the arena is presented today. Its
  // planking runs the short way across, like a real floor laid on joists.
  const deckA = radiusX * deck;
  const boards = [];
  const count = Math.max(6, Math.round((radiusZ * 2) / 1.5));
  for (let i = 0; i < count; i++) {
    const z = -radiusZ + ((i + 0.5) / count) * radiusZ * 2;
    const halfW = deckA * Math.sqrt(Math.max(0, 1 - (z / radiusZ) ** 2));
    if (halfW < 0.6) continue;
    boards.push({
      geometry: new THREE.BoxGeometry(halfW * 2, 0.35, 1.36),
      color: i % 2 ? 0x8a6a46 : 0x7d5f3e,
      position: [radiusX - deckA, wallH + 0.18, z],
    });
  }
  g.add(mergedMesh(boards, { roughness: 0.88, ...relief('wood', { seed: seed + 1, repeat: 4 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The Arch of Constantine
// ---------------------------------------------------------------------------

// The triumphal arch that stands beside the Colosseum: three openings, a tall attic with
// the dedication, and eight columns. Most of its sculpture was cut off older monuments --
// the empire was reusing its own art by 315 AD, which is a more interesting fact about
// late Rome than anything the inscription says.
export function archOfConstantine({ width = 24, height = 26, depth = 8, seed = 7 } = {}) {
  const g = group();
  const parts = [];

  const pierW = width * 0.175;
  const bigR = width * 0.145;
  const sideR = width * 0.082;
  const bigSpring = height * 0.34;
  const sideSpring = height * 0.20;
  const bodyH = height * 0.71;

  // Piers. Four of them, so the two small openings sit between the big one and the ends.
  const centres = [-width / 2 + pierW / 2, -bigR - pierW / 2, bigR + pierW / 2, width / 2 - pierW / 2];
  for (const cx of centres) {
    parts.push({ geometry: new THREE.BoxGeometry(pierW, bodyH, depth), color: MARBLE, position: [cx, bodyH / 2, 0] });
  }

  // Rings over each opening, plus the wall above each.
  const rings = [
    { x: 0, r: bigR, spring: bigSpring },
    { x: -(bigR + pierW + sideR), r: sideR, spring: sideSpring },
    { x: bigR + pierW + sideR, r: sideR, spring: sideSpring },
  ];
  for (const o of rings) {
    for (const part of archVoussoirs(o.r, depth, width * 0.028, MARBLE, 9)) {
      parts.push(xformed(part.geometry, MARBLE, new THREE.Matrix4().makeTranslation(o.x, o.spring, 0)));
    }
    parts.push({ geometry: new THREE.BoxGeometry(o.r * 2, o.spring, depth * 0.999), color: 0x3b332a, position: [o.x, o.spring / 2, -depth * 0.001] });
    const top = o.spring + o.r + width * 0.028;
    parts.push({ geometry: new THREE.BoxGeometry(o.r * 2, Math.max(0.2, bodyH - top), depth), color: MARBLE, position: [o.x, top + (bodyH - top) / 2, 0] });
  }

  // Entablature and attic.
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.06, height * 0.055, depth * 1.12), color: 0xdad2c2, position: [0, bodyH + height * 0.0275, 0] });
  const atticH = height - bodyH - height * 0.055;
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.98, atticH, depth * 0.96), color: MARBLE, position: [0, bodyH + height * 0.055 + atticH / 2, 0] });

  // Free-standing columns on tall plinths in front of the piers, each carrying a statue
  // block up on the attic -- the arch's real vertical rhythm comes from these, not from
  // the openings.
  for (const cx of centres) {
    const plinthH = height * 0.11;
    parts.push({ geometry: new THREE.BoxGeometry(pierW * 0.72, plinthH, depth * 0.22), color: 0xcdc4b2, position: [cx, plinthH / 2, depth / 2 + depth * 0.09] });
    const colH = bodyH - plinthH - height * 0.05;
    parts.push({ geometry: new THREE.CylinderGeometry(width * 0.022, width * 0.025, colH, 14), color: 0x8a7f6c, position: [cx, plinthH + colH / 2, depth / 2 + depth * 0.09] });
    parts.push({ geometry: new THREE.CylinderGeometry(width * 0.033, width * 0.024, height * 0.03, 14), color: 0xdad2c2, position: [cx, plinthH + colH + height * 0.015, depth / 2 + depth * 0.09] });
    parts.push({ geometry: new THREE.BoxGeometry(pierW * 0.5, atticH * 0.8, depth * 0.2), color: 0xd4ccbb, position: [cx, bodyH + height * 0.055 + atticH * 0.4, depth / 2 + depth * 0.09] });
  }

  // The roundels -- second-century medallions lifted off a monument of Hadrian's and set
  // into a fourth-century arch.
  for (const cx of [-(bigR + pierW / 2 + sideR * 0.4), -(bigR + pierW / 2 - sideR * 0.4), bigR + pierW / 2 - sideR * 0.4, bigR + pierW / 2 + sideR * 0.4]) {
    const disc = new THREE.CylinderGeometry(width * 0.045, width * 0.045, depth * 0.06, 20);
    disc.rotateX(Math.PI / 2);
    parts.push({ geometry: disc, color: 0xbcb1a0, position: [cx, bodyH * 0.78, depth / 2 + depth * 0.01] });
  }

  g.add(mergedMesh(parts, { roughness: 0.88, ...relief('stone', { seed, repeat: 4 }) }));

  // The dedication panel, on both faces because an arch is walked round.
  // The lines are FITTED to the canvas rather than set at a fixed size. Roman inscriptions
  // are long, and a line drawn at a guessed point size runs off both ends of the panel --
  // which is exactly what the first pass did to the word CONSTANTINO.
  const tex = canvasTexture(768, 200, (ctx, w, h) => {
    ctx.fillStyle = '#e2dbcb';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#4a3d2c';
    ctx.textAlign = 'center';
    const fit = (text, y, max, weight = 'bold') => {
      for (const size of [40, 36, 32, 28, 24, 20]) {
        ctx.font = `${weight} ${size}px Georgia, "Times New Roman", serif`;
        if (ctx.measureText(text).width <= max) break;
      }
      ctx.fillText(text, w / 2, y);
    };
    fit('IMP · CAES · FL · CONSTANTINO', 62, w - 60);
    fit('MAXIMO · P · F · AVGVSTO', 116, w - 60);
    ctx.fillStyle = '#7a6a52';
    fit('S · P · Q · R', 166, w - 60, '');
  });
  for (const side of [1, -1]) {
    const panel = signPanel(width * 0.72, atticH * 0.62, tex);
    panel.position.set(0, bodyH + height * 0.055 + atticH * 0.5, side * (depth * 0.49));
    if (side < 0) panel.rotation.y = Math.PI;
    g.add(panel);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Figures and street furniture
// ---------------------------------------------------------------------------

// A gladiator, armed as a murmillo: big rectangular scutum, short gladius, and the
// crested helmet with the tiny grilled eyeholes that is the type's whole signature.
//
// Built facing +Z like every prop here, so `rotate` and `move forward` steer it.
export function gladiator({ height = 5.6, tunic = 0xb04a3a, seed = 3 } = {}) {
  const g = group();
  const S = height / 5.6;
  const parts = [];
  const SKIN = 0xa97a55;
  const BRONZE = 0xa5813f;
  const IRON = 0x6e6a66;

  // Torso and hips as one swept mass. A tube is as DEEP as it is wide, so a torso sized
  // to look right from the front is a barrel from the side -- scaled after sweeping, the
  // same correction the Bond figures in CityProps need.
  const torso = taperedTube(
    [[0, 1.55 * S, 0], [0, 2.2 * S, 0], [0, 2.95 * S, 0.02 * S], [0, 3.55 * S, 0]],
    [0.42 * S, 0.5 * S, 0.46 * S, 0.36 * S],
    { tubularSegments: 14, radialSegments: 12 },
  );
  torso.scale(1.18, 1, 0.68);
  parts.push({ geometry: torso, color: tunic });

  // Legs. The right one is planted and the left advanced -- a figure with both feet
  // together reads as a doll however good the armour is.
  const legs = [[-0.24 * S, 0.16 * S], [0.24 * S, -0.3 * S]];
  legs.forEach(([lx, lz], i) => {
    const leg = taperedTube(
      [[lx, 0.1 * S, lz], [lx * 1.05, 0.85 * S, lz * 0.5], [lx * 1.05, 1.55 * S, 0]],
      [0.15 * S, 0.19 * S, 0.26 * S],
      { tubularSegments: 10, radialSegments: 10 },
    );
    parts.push({ geometry: leg, color: SKIN });
    // Greave on the leading leg only; a murmillo wore one.
    if (i === 1) {
      const greave = new THREE.CylinderGeometry(0.21 * S, 0.17 * S, 0.85 * S, 10);
      parts.push({ geometry: greave, color: BRONZE, position: [lx * 1.02, 0.62 * S, lz * 0.45] });
    }
    parts.push({ geometry: new THREE.BoxGeometry(0.28 * S, 0.16 * S, 0.6 * S), color: 0x6b4a30, position: [lx, 0.08 * S, lz + 0.1 * S] });
  });

  // Arms. The shield arm is forward and bent, the sword arm drawn back.
  const shieldArm = taperedTube(
    [[-0.5 * S, 3.3 * S, 0], [-0.72 * S, 2.85 * S, 0.35 * S], [-0.6 * S, 2.5 * S, 0.75 * S]],
    [0.17 * S, 0.14 * S, 0.12 * S], { tubularSegments: 10, radialSegments: 10 },
  );
  parts.push({ geometry: shieldArm, color: SKIN });
  const swordArm = taperedTube(
    [[0.5 * S, 3.3 * S, 0], [0.78 * S, 2.95 * S, -0.2 * S], [0.86 * S, 2.62 * S, 0.15 * S]],
    [0.17 * S, 0.14 * S, 0.12 * S], { tubularSegments: 10, radialSegments: 10 },
  );
  parts.push({ geometry: swordArm, color: SKIN });
  // The manica -- segmented plate on the sword arm, which is the other half of the type.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    parts.push({
      geometry: new THREE.CylinderGeometry(0.19 * S - t * 0.03 * S, 0.19 * S - t * 0.03 * S, 0.14 * S, 10),
      color: BRONZE,
      position: [0.55 * S + t * 0.3 * S, 3.24 * S - t * 0.6 * S, -0.06 * S],
      rotation: [0, 0, -0.5],
    });
  }

  // Head, and the helmet over it.
  parts.push({ geometry: new THREE.SphereGeometry(0.27 * S, 14, 10), color: SKIN, position: [0, 3.85 * S, 0] });
  const helm = new THREE.SphereGeometry(0.33 * S, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  parts.push({ geometry: helm, color: BRONZE, position: [0, 3.86 * S, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.34 * S, 0.34 * S, 0.1 * S, 16), color: BRONZE, position: [0, 3.7 * S, 0] });
  // Brim, wide at the back -- the murmillo helmet is famously heavy and enclosing.
  const brim = new THREE.CylinderGeometry(0.46 * S, 0.36 * S, 0.09 * S, 16);
  parts.push({ geometry: brim, color: BRONZE, position: [0, 3.62 * S, -0.05 * S] });
  parts.push({ geometry: new THREE.BoxGeometry(0.5 * S, 0.34 * S, 0.06 * S), color: 0x4a3a24, position: [0, 3.78 * S, 0.3 * S] });
  // The crest -- a fin, not a plume.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    parts.push({
      geometry: new THREE.BoxGeometry(0.07 * S, (0.3 - Math.abs(t - 0.45) * 0.3) * S, 0.1 * S),
      color: 0x8f2f28,
      position: [0, 4.18 * S + (0.15 - Math.abs(t - 0.45) * 0.15) * S, (0.26 - t * 0.52) * S],
    });
  }

  // The scutum -- curved, and the curve is the point: it is a section of a cylinder a man
  // stands behind, not a flat board.
  const shield = new THREE.CylinderGeometry(0.95 * S, 0.95 * S, 2.05 * S, 18, 1, true, -0.62, 1.24);
  shield.rotateY(Math.PI);
  parts.push({ geometry: shield, color: 0xa8342c, position: [-0.62 * S, 2.7 * S, 1.55 * S] });
  parts.push({ geometry: new THREE.SphereGeometry(0.16 * S, 12, 8), color: BRONZE, position: [-0.62 * S, 2.7 * S, 0.68 * S] });

  // Gladius: a short stabbing sword, about 20 inches of blade.
  parts.push({ geometry: new THREE.BoxGeometry(0.09 * S, 0.06 * S, 1.6 * S), color: IRON, position: [0.92 * S, 2.55 * S, 0.7 * S] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 0.34 * S, 8), color: 0x5a3f28, position: [0.9 * S, 2.58 * S, -0.05 * S], rotation: [Math.PI / 2, 0, 0] });

  g.add(mergedMesh(parts, { roughness: 0.62, metalness: 0.18 }));
  return g;
}

// The umbrella pine -- a bare trunk and a flat canopy carried high. It is the single most
// recognisable plant silhouette in Rome, and it only works if the trunk is genuinely
// naked for most of its height: a pine with foliage low down is any old conifer.
export function stonePine({ height = 34, seed = 9 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const trunkH = height * 0.66;

  const lean = randomIn(rng, -0.09, 0.09);
  const trunk = taperedTube(
    [[0, 0, 0], [lean * height * 0.2, trunkH * 0.4, lean * height * 0.1],
      [lean * height * 0.45, trunkH * 0.75, lean * height * 0.2], [lean * height * 0.6, trunkH, lean * height * 0.25]],
    [height * 0.032, height * 0.024, height * 0.019, height * 0.016],
    { tubularSegments: 12, radialSegments: 10 },
  );
  parts.push({ geometry: trunk, color: 0x8a6a4c });

  // Branches fan up and OUT to hold the canopy clear of the trunk.
  const tipX = lean * height * 0.6;
  const tipZ = lean * height * 0.25;
  const limbs = 7;
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rng() * 0.4;
    const reach = height * randomIn(rng, 0.2, 0.3);
    parts.push({
      geometry: taperedTube(
        [[tipX, trunkH * 0.92, tipZ],
          [tipX + Math.cos(a) * reach * 0.5, trunkH + height * 0.09, tipZ + Math.sin(a) * reach * 0.5],
          [tipX + Math.cos(a) * reach, trunkH + height * 0.16, tipZ + Math.sin(a) * reach]],
        [height * 0.014, height * 0.009, height * 0.005],
        { tubularSegments: 8, radialSegments: 8 },
      ),
      color: 0x7d6047,
    });
  }
  g.add(mergedMesh(parts, { roughness: 0.95, ...relief('bark', { seed, repeat: 3 }) }));

  // The canopy: overlapping flattened domes, deliberately WIDE and SHALLOW. A round crown
  // makes it an ordinary pine; the parasol is the whole species.
  const crown = [];
  const spread = height * 0.42;
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rng() * 0.5;
    const r = i === 0 ? 0 : spread * randomIn(rng, 0.35, 0.86);
    const blobR = height * randomIn(rng, 0.11, 0.17);
    // SphereGeometry, not Icosahedron: anything from PolyhedronGeometry is non-indexed,
    // so computeVertexNormals gives per-face normals and the crown renders as faceted
    // rock however smooth the material claims to be.
    const blob = new THREE.SphereGeometry(blobR, 12, 9);
    blob.scale(1, 0.5, 1);
    crown.push({
      geometry: blob,
      color: [0x3f5c33, 0x496a3a, 0x35502c][i % 3],
      position: [tipX + Math.cos(a) * r, trunkH + height * randomIn(rng, 0.12, 0.2), tipZ + Math.sin(a) * r],
    });
  }
  g.add(mergedMesh(crown, { roughness: 0.94, flatShading: false }));
  return g;
}

// A cypress: the dark exclamation mark of every Italian view. Deliberately narrow -- the
// species is barely wider than a person for its whole height.
export function italianCypress({ height = 22, seed = 4 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.017, height * 0.03, height * 0.22, 10), color: 0x6b5540, position: [0, height * 0.11, 0] });
  const layers = 9;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    // Fattest a third of the way up, tapering to a point: a spindle, not a cone.
    const r = height * 0.085 * Math.sin(Math.PI * (0.16 + t * 0.8)) ** 0.7;
    const blob = new THREE.SphereGeometry(r, 10, 8);
    blob.scale(1, 1.5, 1);
    parts.push({
      geometry: blob,
      color: [0x2c4429, 0x334e2f, 0x263c24][i % 3],
      position: [randomIn(rng, -0.3, 0.3), height * (0.16 + t * 0.78), randomIn(rng, -0.3, 0.3)],
    });
  }
  g.add(mergedMesh(parts, { roughness: 0.95 }));
  return g;
}

// Fallen travertine: the blocks that did not get carted off to build a palace. Rome's
// ruins were an open quarry for a thousand years, and this is what is left of the two
// thirds of the outer wall that is missing.
export function travertineRubble({ spread = 12, count = 9, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    const w = randomIn(rng, 1.4, 3.6);
    parts.push({
      geometry: new THREE.BoxGeometry(w, randomIn(rng, 0.7, 1.9), randomIn(rng, 1.2, 2.8)),
      color: [TRAVERTINE, TRAVERTINE_SHADE, TUFA, TRAVERTINE_DARK][i % 4],
      position: [Math.cos(a) * r, randomIn(rng, 0.25, 0.7), Math.sin(a) * r],
      rotation: [randomIn(rng, -0.12, 0.12), rng() * Math.PI, randomIn(rng, -0.14, 0.14)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.96, ...relief('stone', { seed, repeat: 3 }) }));
}

// A row of standing columns with a scrap of entablature across the top -- the Forum, and
// every other Roman site, in one prop.
export function forumColumns({ count = 5, height = 24, spacing = 8, entablature = true, seed = 17 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const r = height * 0.055;
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * spacing;
    // Not all of them are whole. A colonnade of identical intact columns is a rendering
    // of a reconstruction drawing, not of a ruin.
    const broken = rng() < 0.25;
    const h = broken ? height * randomIn(rng, 0.35, 0.7) : height;
    parts.push({ geometry: new THREE.BoxGeometry(r * 2.8, height * 0.03, r * 2.8), color: TRAVERTINE_SHADE, position: [x, height * 0.015, 0] });
    // Fluting: shallow rods let into the shaft. It is what stops a column reading as a pipe.
    parts.push({ geometry: new THREE.CylinderGeometry(r * 0.86, r, h, 20), color: MARBLE, position: [x, height * 0.03 + h / 2, 0] });
    for (let f = 0; f < 12; f++) {
      const a = (f / 12) * Math.PI * 2;
      parts.push({
        geometry: new THREE.CylinderGeometry(r * 0.1, r * 0.11, h * 0.98, 6),
        color: TRAVERTINE,
        position: [x + Math.cos(a) * r * 0.9, height * 0.03 + h / 2, Math.sin(a) * r * 0.9],
      });
    }
    if (!broken) {
      parts.push({ geometry: new THREE.CylinderGeometry(r * 1.35, r * 0.9, height * 0.05, 20), color: MARBLE, position: [x, height * 0.03 + h + height * 0.025, 0] });
      parts.push({ geometry: new THREE.BoxGeometry(r * 3, height * 0.025, r * 3), color: MARBLE, position: [x, height * 0.03 + h + height * 0.062, 0] });
    }
  }
  if (entablature) {
    // Only over the middle, and only where both neighbours are standing.
    const span = spacing * (count - 2);
    parts.push({ geometry: new THREE.BoxGeometry(span, height * 0.09, r * 2.6), color: TRAVERTINE, position: [0, height * 0.03 + height + height * 0.12, 0] });
    parts.push({ geometry: new THREE.BoxGeometry(span * 1.03, height * 0.035, r * 3.1), color: MARBLE, position: [0, height * 0.03 + height + height * 0.183, 0] });
  }
  return group(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 4 }) }));
}

// The Capitoline she-wolf on a column: Romulus and Remus, and the founding story the city
// told about itself.
export function sheWolfColumn({ height = 13, seed = 21 } = {}) {
  const g = group();
  const parts = [];
  const colH = height * 0.72;
  parts.push({ geometry: new THREE.BoxGeometry(2.6, 0.7, 2.6), color: TRAVERTINE_SHADE, position: [0, 0.35, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(2, 0.5, 2), color: MARBLE, position: [0, 0.95, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.5, 0.6, colH, 18), color: MARBLE, position: [0, 1.2 + colH / 2, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.8, 0.55, 0.5, 18), color: MARBLE, position: [0, 1.2 + colH + 0.25, 0] });
  const top = 1.2 + colH + 0.5;

  const BRONZE = 0x5c6b4a;
  // Body, legs, head, tail. Small and dark, so it is a silhouette job: the stance is what
  // has to read, and the stance is four straight legs and a head turned to the side.
  const body = taperedTube(
    [[0, top + 1.05, -1.1], [0, top + 1.15, -0.3], [0, top + 1.15, 0.5], [0, top + 1.05, 1.0]],
    [0.16, 0.34, 0.32, 0.2], { tubularSegments: 12, radialSegments: 10 },
  );
  body.scale(0.8, 1, 1);
  parts.push({ geometry: body, color: BRONZE });
  for (const [lx, lz] of [[-0.24, -0.72], [0.24, -0.72], [-0.24, 0.66], [0.24, 0.66]]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.075, 0.1, 1.0, 8), color: BRONZE, position: [lx, top + 0.5, lz] });
  }
  parts.push({ geometry: new THREE.SphereGeometry(0.2, 12, 9), color: BRONZE, position: [0.34, top + 1.24, 1.16] });
  parts.push({ geometry: new THREE.ConeGeometry(0.12, 0.34, 8), color: BRONZE, position: [0.52, top + 1.2, 1.3], rotation: [0, 0, -1.3] });
  parts.push({ geometry: new THREE.ConeGeometry(0.07, 0.16, 6), color: BRONZE, position: [0.28, top + 1.42, 1.1] });
  parts.push({ geometry: new THREE.ConeGeometry(0.07, 0.16, 6), color: BRONZE, position: [0.44, top + 1.4, 1.18] });
  parts.push({
    geometry: taperedTube([[0, top + 1.1, -1.15], [-0.1, top + 0.85, -1.5], [-0.16, top + 0.55, -1.7]], [0.07, 0.05, 0.03],
      { tubularSegments: 6, radialSegments: 8 }),
    color: BRONZE,
  });
  // The twins underneath, which is the entire reason this statue exists.
  for (const tx of [-0.16, 0.22]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.15, 10, 8), color: BRONZE, position: [tx, top + 0.28, 0.1] });
    parts.push({ geometry: new THREE.SphereGeometry(0.1, 8, 6), color: BRONZE, position: [tx + 0.16, top + 0.42, 0.28] });
  }
  g.add(mergedMesh(parts, { roughness: 0.55, metalness: 0.35, ...relief('stone', { seed, repeat: 3 }) }));
  return g;
}

// A nasone -- the cast-iron street fountain that still runs all over Rome, day and night,
// straight off the ancient aqueducts.
export function romanFountain({ height = 3.6, seed = 23 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(1.15, 1.3, 0.35, 16), color: 0x8a8378, position: [0, 0.175, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.95, 1.0, 0.6, 16), color: 0x6f6a62, position: [0, 0.62, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.9, 0.9, 0.12, 16), color: 0x4d6a70, position: [0, 0.9, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.36, height - 0.9, 14), color: 0x4a4640, position: [0, 0.9 + (height - 0.9) / 2, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(0.36, 0.3, 0.28, 14), color: 0x3f3b36, position: [0, height - 0.1, 0] });
  // The spout is the "big nose" the thing is named after -- a curved pipe, always running.
  const spout = new THREE.TorusGeometry(0.34, 0.075, 8, 14, Math.PI * 0.62);
  parts.push({ geometry: spout, color: 0x3f3b36, position: [0, height - 0.42, 0.3], rotation: [Math.PI / 2, 0, 1.4] });
  g.add(mergedMesh(parts, { roughness: 0.72, metalness: 0.3, ...relief('metal', { seed, repeat: 3 }) }));
  // Water: one thin, always-falling stream.
  const water = mesh(
    new THREE.CylinderGeometry(0.045, 0.07, height - 1.5, 8),
    standard({ color: 0xbfe4ee, transparent: true, opacity: 0.62, roughness: 0.2, metalness: 0.1 }),
    0, 0.9 + (height - 1.5) / 2, 0.62,
  );
  water.castShadow = false;
  g.add(water);
  return g;
}

// Basalt paving. Roman streets were laid in big polygonal blocks of volcanic basalt, and
// the irregular jigsaw is what makes them look Roman rather than merely cobbled.
export function basaltPaving({ width = 16, depth = 30, seed = 27 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const cell = 2.0;
  const cols = Math.max(2, Math.round(width / cell));
  const rows = Math.max(2, Math.round(depth / cell));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = (i - (cols - 1) / 2) * cell + randomIn(rng, -0.22, 0.22);
      const z = (j - (rows - 1) / 2) * cell + randomIn(rng, -0.22, 0.22);
      const s = randomIn(rng, 0.78, 1.06);
      parts.push({
        geometry: new THREE.CylinderGeometry(cell * 0.6 * s, cell * 0.58 * s, 0.22, rng() < 0.5 ? 5 : 6),
        color: [0x4c4a48, 0x565350, 0x434140, 0x5e5a56][(i + j) % 4],
        position: [x, 0.11, z],
        rotation: [0, rng() * Math.PI, 0],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.94, ...relief('stone', { seed, repeat: 5 }) }));
}
