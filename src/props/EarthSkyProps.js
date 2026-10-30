import * as THREE from 'three';
import { standard, mesh, group, canvasTexture } from '../PropKit.js';
import { mergeParts, put } from './LoftKit.js';
import { reducedMotion } from '../Settings.js';
import { moonInSky } from './SkyProps.js';
import { CONTINENTS, earthTexture } from './Earth.js';
import {
  Buffers, block, fitText, lathed, printedBoard, scenery, solid, stick, SANS,
} from './AtomProps.js';
import {
  GLOBE, POLE_EYE_Y, SUN_BEARING, SUN_DRAWN_ELEVATION, SUN_PROP, sunLightDirection, NOON_LONGITUDE,
  bearingOfLongitude, clockHours, clockLabel, MOON, STATION, PHASES, stationBearing, TILT, AXIS, ORRERY,
  earthAt, lampAt, orreryDegrees, GAUGE, DIAL, GIRARD_LATITUDE, YEAR_DAYS, declination as declinationOf,
} from './EarthSkyModel.js';

// Stand on the Earth -- the student is the Earth, on the North Pole of a globe they can walk on, with
// eight moons round them showing every phase at once and a ninth going round. Down at the foot of the
// globe, a tilted Earth orbits a lamp and a sky bowl shows the Sun's path over Kansas.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call, no Math.random.
//
// THE LIGHT ON THE MOONS AND ON BOTH EARTHS IS WORKED OUT PER VERTEX, and that is the world's one
// large decision. The obvious version is a lit sphere under the world's sun, and it fails three ways
// in a lesson about phases: the Look Around time-of-day slider moves that sun and would change the
// phase, HiFi lights through an environment that lifts a dark limb, and the fill the boards need to
// be readable would wash the dark side out. So each of these is an unlit material whose vertex
// colours are the dot product with one fixed direction. A phase is therefore not painted on: it comes
// from the geometry at every angle, which is what the failed painted phases in SkyProps.js could not
// do, and both editions show the same Moon. A tint is only as detailed as the mesh under it, so these
// spheres carry more segments than their size alone would ask for.

export const SE = {
  moon: '#8f7be0',
  season: '#e0a02e',
  scale: '#3f9fc9',
};

const UP = new THREE.Vector3(0, 1, 0);
const GLOBE_FOOT = Math.sqrt(GLOBE.radius ** 2 - (GLOBE.radius - GLOBE.height) ** 2);
const unlit = (extra = {}) => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, ...extra });

// 0 on the night side, 1 in full light, with the soft edge a real terminator has.
function daylight(dot) {
  const t = Math.min(1, Math.max(0, (dot + 0.05) / 0.17));
  return t * t * (3 - 2 * t);
}

// Writes the light into a geometry's colour attribute. `normalOf(i, out)` gives a vertex's normal in
// world axes. Linear values: a vertex colour is linear, whatever it looks like written down.
function writeDaylight(geometry, light, night, normalOf) {
  const color = geometry.attributes.color;
  const out = new THREE.Vector3();
  for (let i = 0; i < color.count; i++) {
    normalOf(i, out);
    const k = night + (1 - night) * daylight(out.x * light[0] + out.y * light[1] + out.z * light[2]);
    color.setXYZ(i, k, k, k);
  }
  color.needsUpdate = true;
}

function withColor(geometry) {
  const n = geometry.attributes.position.count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return geometry;
}

// ---------------------------------------------------------------------------
// The globe underfoot
// ---------------------------------------------------------------------------

// Where a latitude and longitude land on the dome, in plan.
function planOf(latitude, longitude) {
  const r = GLOBE.radius * Math.cos((latitude * Math.PI) / 180);
  const b = bearingOfLongitude(longitude);
  return [Math.sin(b) * r, Math.cos(b) * r];
}

// A map of the top of the world, drawn from straight above. The world's equirectangular map is at
// its worst exactly where a student stands on it: every meridian pinches to one point. So this draws
// the same coastlines onto a polar plan, and the shell takes its uv from plan position.
function polarMap(reach) {
  return canvasTexture(2048, 2048, (ctx, w) => {
    const X = (x) => ((x + reach) / (2 * reach)) * w;
    const Z = (z) => ((z + reach) / (2 * reach)) * w;
    const px = w / (2 * reach);
    ctx.fillStyle = '#17629f';
    ctx.fillRect(0, 0, w, w);

    // Every edge is subdivided, because a straight line in latitude and longitude is a curve here.
    const trace = (ring) => {
      ctx.beginPath();
      ring.forEach(([lon, lat], i) => {
        const [nextLon, nextLat] = ring[(i + 1) % ring.length];
        for (let s = 0; s < 8; s++) {
          const t = s / 8;
          const [x, z] = planOf(lat + (nextLat - lat) * t, lon + (nextLon - lon) * t);
          if (i === 0 && s === 0) ctx.moveTo(X(x), Z(z));
          else ctx.lineTo(X(x), Z(z));
        }
      });
      ctx.closePath();
    };
    for (const ring of CONTINENTS) {
      trace(ring);
      ctx.fillStyle = '#5d8f4a';
      ctx.fill();
      ctx.strokeStyle = '#2c5a35';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Tundra and sea ice, as rings of latitude over everything.
    const ringAt = (latitude, width, style) => {
      ctx.beginPath();
      ctx.arc(X(0), Z(0), GLOBE.radius * Math.cos((latitude * Math.PI) / 180) * px, 0, Math.PI * 2);
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.stroke();
    };
    // Only a small cap. A student stands at the very middle of this and the dome curves away at 33ft,
    // so anything wider is all they can see, and the Earth under their feet is a white disc.
    const iceR = 7.5 * px;
    const ice = ctx.createRadialGradient(X(0), Z(0), iceR * 0.5, X(0), Z(0), iceR);
    ice.addColorStop(0, 'rgba(238,244,250,0.96)');
    ice.addColorStop(0.8, 'rgba(232,240,248,0.8)');
    ice.addColorStop(1, 'rgba(232,240,248,0)');
    ctx.fillStyle = ice;
    ctx.beginPath();
    ctx.arc(X(0), Z(0), iceR, 0, Math.PI * 2);
    ctx.fill();

    // The graticule: what makes it read as a globe rather than as a map on a hill.
    for (const latitude of [80, 70, 60, 50, 40]) ringAt(latitude, 2, 'rgba(255,255,255,0.32)');
    ringAt(66.5, 3, 'rgba(255,240,170,0.5)');

    // A meridian every hour of the clock that matters, each with the time it is there right now. East
    // of noon is later, and that is what lets a student read a phase's time off the ground under it.
    for (let degrees = 0; degrees < 360; degrees += 45) {
      const b = SUN_BEARING + (degrees * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(X(Math.sin(b) * 3), Z(Math.cos(b) * 3));
      ctx.lineTo(X(Math.sin(b) * reach), Z(Math.cos(b) * reach));
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 6;
      ctx.stroke();
      // Text whose foot is toward the pole, so a student standing there reads it looking outward.
      ctx.save();
      // Close in. Past about 15ft from a 5ft eye, type lying on the ground is seen edge on.
      ctx.translate(X(Math.sin(b) * 12.5), Z(Math.cos(b) * 12.5));
      ctx.rotate(Math.atan2(Math.sin(b), -Math.cos(b)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(3.4 * px)}px ${SANS}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(8,20,40,0.85)';
      const label = clockLabel(clockHours(degrees));
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    // The pole, and the place the student lives (or could).
    ctx.fillStyle = '#d6453a';
    ctx.beginPath();
    ctx.arc(X(0), Z(0), 1.1 * px, 0, Math.PI * 2);
    ctx.fill();
    const [kx, kz] = planOf(GIRARD_LATITUDE, NOON_LONGITUDE);
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(X(kx), Z(kz), 0.9 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(X(kx), Z(kz + 4));
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(2.6 * px)}px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('GIRARD, KANSAS', 0, 0);
    ctx.restore();
  });
}

// The printed top of the Earth. It lies a hair above the terrain the student actually walks on. The
// terrain is a much coarser mesh, and where a triangle spans the foot of the dome it cannot follow
// the curve, so the last stretch of the shell flares up to stay clear of it.
export function earthShell() {
  const { radius: R, height: H } = GLOBE;
  const below = R - H;
  const reach = Math.sqrt(R * R - below * below);
  const maxColat = Math.acos(below / R);
  const rings = 72;
  const sides = 128;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= rings; j++) {
    const colat = (j / rings) * maxColat;
    const r = R * Math.sin(colat);
    const t = Math.max(0, (r / reach - 0.84) / 0.16);
    const lift = 0.12 + 1.4 * t * t;
    for (let i = 0; i <= sides; i++) {
      const b = (i / sides) * Math.PI * 2;
      const x = Math.sin(b) * r;
      const z = Math.cos(b) * r;
      positions.push(x, R * Math.cos(colat) - below + lift, z);
      normals.push(Math.sin(b) * Math.sin(colat), Math.cos(colat), Math.cos(b) * Math.sin(colat));
      uvs.push((x + reach) / (2 * reach), 1 - (z + reach) / (2 * reach));
    }
  }
  const row = sides + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * row + i;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  withColor(g);
  const light = sunLightDirection();
  const n = g.attributes.normal;
  // Dimmer than the moons' dark side is black: the time labels have to stay readable at midnight.
  writeDaylight(g, light, 0.2, (i, out) => out.fromBufferAttribute(n, i));
  const shell = mesh(g, unlit({ map: polarMap(reach) }));
  shell.castShadow = false;
  shell.receiveShadow = false;
  return scenery(group(shell));
}

// Everything on the floor that says where something goes.
//
// THE FLOOR ITSELF IS AN UNLIT BLACK RING OVER THE TERRAIN. Near-black terrain under a low sun still
// reads as a brown hillside, because a surface seen at a grazing angle reflects whatever its colour
// is, and in HiFi it would be lit sand. This is what makes it space. It stops under the dome's foot.
export function floorMarks() {
  const parts = [];
  const ring = (inner, outer, y, color, segments = 160) => {
    const g = new THREE.RingGeometry(inner, outer, segments, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    parts.push({ geometry: g, color });
  };
  ring(GLOBE_FOOT - 1, 9000, 0.03, 0x03040a, 96);
  ring(STATION.orbit - 0.25, STATION.orbit + 0.25, 0.09, 0x4d5a7a);
  ring(MOON.orbit - 0.4, MOON.orbit + 0.4, 0.09, 0x8f7be0);
  const merged = mergeParts(parts);
  const m = mesh(merged, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  m.castShadow = false;
  m.receiveShadow = false;
  return scenery(group(m));
}

// A soft glow, as a billboard: a gradient is the only thing the eye reads as light. A larger shell
// round a sphere has a hard edge whatever its opacity, and it reads as a brown ring.
function glow(size, color) {
  const texture = canvasTexture(256, 256, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true,
  }));
  sprite.scale.set(size, size, 1);
  sprite.raycast = () => {};
  return sprite;
}

// A ball that is simply bright. Not tone mapped, or the brightest thing in the world comes out cream.
function brightBall(radius, color) {
  const ball = mesh(new THREE.SphereGeometry(radius, 40, 26), new THREE.MeshBasicMaterial({ color, fog: false, toneMapped: false }));
  ball.castShadow = false;
  ball.receiveShadow = false;
  return ball;
}

// The Sun of the moon lab. It is drawn higher than it lights from, for the reason in the model.
export function labSun() {
  const { radius } = SUN_PROP;
  return scenery(group(brightBall(radius, 0xfff4d0), glow(radius * 5.5, 'rgba(255,190,90,0.55)')));
}

// Where to put it, so a layout and this file cannot disagree.
export function labSunPosition() {
  const d = SUN_PROP.distance;
  const e = (SUN_DRAWN_ELEVATION * Math.PI) / 180;
  return {
    x: Math.sin(SUN_BEARING) * d,
    y: POLE_EYE_Y + Math.tan(e) * d,
    z: Math.cos(SUN_BEARING) * d,
  };
}

// ---------------------------------------------------------------------------
// The moons
// ---------------------------------------------------------------------------

// The Moon's map out of the one the Constellations world already paints, because the maria are how
// anybody knows it is the Moon. The prop it comes from is thrown away.
function moonMap() {
  const source = moonInSky({ radius: 1 });
  let map = null;
  source.traverse((node) => {
    if (!node.isMesh) return;
    if (!map && node.material.map) map = node.material.map;
    node.geometry.dispose();
  });
  return map;
}

// The bearing of the middle of the maria on a sphere carrying that map, and so how far to turn it.
const NEAR_SIDE_BEARING = (47 * Math.PI) / 180;

// One Moon sphere whose near side faces along `bearing`.
function moonSphere(radius, bearing, detail = 56) {
  const g = new THREE.SphereGeometry(radius, detail, Math.round(detail * 0.66));
  g.rotateY(bearing - NEAR_SIDE_BEARING);
  return withColor(g);
}

// The eight phases, standing round the student all at once. All of it is one prop: the moons are one
// mesh, lit once at build time because nothing here moves, and their names are one sheet of type.
export function moonRing() {
  const light = sunLightDirection();
  const parts = [];
  const plinth = [];
  const faces = new Buffers();
  const white = new THREE.Color(0xffffff);
  const W = 15;
  const H = 3.6;
  PHASES.forEach((phase, index) => {
    const b = stationBearing(index);
    const sx = Math.sin(b);
    const cz = Math.cos(b);
    const at = [sx * STATION.orbit, STATION.y, cz * STATION.orbit];
    // The near side faces the pole, so inward: the opposite bearing.
    const g = moonSphere(STATION.radius, b + Math.PI, 48);
    const n = g.attributes.normal;
    writeDaylight(g, light, 0.035, (i, out) => out.fromBufferAttribute(n, i));
    parts.push({ geometry: g, position: at, keepColor: true });

    // A post behind the Moon, and its name above it on both sides.
    const postR = STATION.orbit + STATION.radius + 0.6;
    const px = sx * postR;
    const pz = cz * postR;
    const plateY = STATION.y + STATION.radius + 4.2;
    stick(plinth, [px, 0, pz], [px, plateY + H / 2, pz], 0.3, 0x39404d, 10);
    stick(plinth, [px, STATION.y, pz], [sx * (STATION.orbit + 2), STATION.y, cz * (STATION.orbit + 2)], 0.3, 0x39404d, 10);
    put(plinth, new THREE.BoxGeometry(W + 0.4, H + 0.4, 0.3), 0x1a1f2b, [sx * STATION.orbit, plateY, cz * STATION.orbit], [0, b, 0]);
    stick(plinth, [sx * STATION.orbit, plateY, cz * STATION.orbit], [px, plateY, pz], 0.2, 0x39404d, 8);

    const uvRow = (reversed) => {
      const rows = PHASES.length;
      const v0 = 1 - (index + 1) / rows;
      const v1 = 1 - index / rows;
      return reversed ? [1, v0, 0, v1] : [0, v0, 1, v1];
    };
    // The side the pole sees. A student at the pole looks outward, so their right is outward x up,
    // and that order makes the quad's normal point back at them. The other side reads from outside.
    const inward = [-sx, 0, -cz];
    const right = [-cz * W, 0, sx * W];
    const flip = [-right[0], 0, -right[2]];
    const cx = sx * STATION.orbit;
    const cy = plateY - H / 2;
    const cZ = cz * STATION.orbit;
    const lift = 0.17;
    faces.quad(
      [cx + inward[0] * lift - right[0] / 2, cy, cZ + inward[2] * lift - right[2] / 2],
      right, [0, H, 0], white, uvRow(false),
    );
    faces.quad(
      [cx - inward[0] * lift - flip[0] / 2, cy, cZ - inward[2] * lift - flip[2] / 2],
      flip, [0, H, 0], white, uvRow(false),
    );
  });

  const moons = mesh(mergeParts(parts), unlit({ map: moonMap() }));
  moons.castShadow = false;
  moons.receiveShadow = false;

  const sheet = canvasTexture(1024, 256 * PHASES.length, (ctx, w, h) => {
    const rowH = h / PHASES.length;
    PHASES.forEach((phase, i) => {
      ctx.fillStyle = '#141923';
      ctx.fillRect(0, i * rowH, w, rowH);
      ctx.fillStyle = SE.moon;
      ctx.fillRect(0, i * rowH, w, rowH * 0.05);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitText(ctx, phase.name, 800, Math.round(rowH * 0.58), SANS, w * 0.92);
      ctx.fillText(phase.name, w / 2, i * rowH + rowH * 0.55);
    });
  });
  const plates = mesh(faces.geometry(), standard({ map: sheet, emissive: 0xffffff, emissiveMap: sheet, emissiveIntensity: 0.4, roughness: 0.85, vertexColors: true }));
  plates.castShadow = false;

  const hardware = solid(plinth);
  // In a low sun these throw shadows two hundred feet long, across the season exhibits.
  hardware.castShadow = false;
  return scenery(group(moons, hardware, plates));
}

// The Moon that moves. A block program drives its root, which is what makes it real to a student: it
// can be clicked, opened, changed and ridden. Local +X points at the Earth, because at the bearing
// the layout gives it, forward (+Z) is along the orbit and left of forward is inward. The tick only
// repaints the light as the Moon turns; the light is in world axes and the Moon spins through it.
export function orbitingMoon() {
  const g = moonSphere(MOON.radius, Math.PI / 2, 56);
  const m = mesh(g, unlit({ map: moonMap() }));
  m.castShadow = false;
  m.receiveShadow = false;
  const root = group(m);
  const light = sunLightDirection();
  const base = g.attributes.normal;
  const q = new THREE.Quaternion();
  let last = null;
  root.userData.tick = {
    update() {
      root.getWorldQuaternion(q);
      if (last && Math.abs(last.dot(q)) > 0.9999999) return;
      last = q.clone();
      writeDaylight(g, light, 0.035, (i, out) => out.fromBufferAttribute(base, i).applyQuaternion(q));
    },
  };
  return root;
}

// The clock at the student's feet. It owns the Moon's numbers.
export function moonClock() {
  const parts = [];
  put(parts, lathed([[0, 0], [1.2, 0], [1.2, 0.25], [0.45, 0.45], [0.36, 2.4], [0, 2.4]], { segments: 28 }), 0x2d323b);
  block(parts, 3.8, 2.2, 0.4, 0x2d323b, [0, 3.3, 0]);
  const plate = printedBoard(3.5, 1.9, 0.08, (ctx, w, h) => {
    ctx.fillStyle = '#151a22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = SE.moon;
    ctx.fillRect(0, 0, w, h * 0.06);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, 'MOON CLOCK', 800, Math.round(h * 0.2), SANS, w * 0.9);
    ctx.fillText('MOON CLOCK', w / 2, h * 0.32);
    ctx.fillStyle = '#cfc6f5';
    fitText(ctx, 'Click me, press Program', 700, Math.round(h * 0.13), SANS, w * 0.9);
    ctx.fillText('Click me, press Program', w / 2, h * 0.58);
    ctx.fillText('and change a green number', w / 2, h * 0.76);
  }, { pixelsPerFoot: 110 });
  plate.position.set(0, 3.3, 0.25);
  return group(solid(parts), plate);
}

// ---------------------------------------------------------------------------
// The seasons
// ---------------------------------------------------------------------------

// The lamp and the printed floor of the orbit. It reads the `yearDay` the dial shares, and it is one
// prop, because an axis on a block program would swing round with the object: `rotate` is the only way
// a program has of changing direction, so a program-driven Earth would point its north at a different
// star every month. Keeping that axis still is the whole of what this exhibit has to get right.
export function seasonOrrery() {
  const { orbit, lampRadius, earthRadius } = ORRERY;
  const floorR = orbit + earthRadius + 4;
  const texture = canvasTexture(1536, 1536, (ctx, w) => {
    const c = w / 2;
    const px = w / (2 * floorR);
    ctx.fillStyle = '#10141e';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = SE.season;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(c, c, orbit * px, 0, Math.PI * 2);
    ctx.stroke();
    const months = [
      ['JANUARY', 15], ['FEBRUARY', 46], ['MARCH', 74], ['APRIL', 105], ['MAY', 135], ['JUNE', 166],
      ['JULY', 196], ['AUGUST', 227], ['SEPTEMBER', 258], ['OCTOBER', 288], ['NOVEMBER', 319], ['DECEMBER', 349],
    ];
    for (const [name, day] of months) {
      const b = ((orreryDegrees(day) - 90) * Math.PI) / 180;
      const r = (orbit + earthRadius + 0.6) * px;
      ctx.save();
      ctx.translate(c + Math.sin(b) * r, c + Math.cos(b) * r);
      ctx.rotate(Math.atan2(Math.sin(b), -Math.cos(b)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(2.1 * px)}px ${SANS}`;
      ctx.fillStyle = '#ffe2a6';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
    // The fixed direction of the axis, printed four times, because the eye needs to be told.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(1.5 * px)}px ${SANS}`;
    ctx.fillText('North always leans this way', c, c + (lampRadius + 8) * px);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 5;
    const ay = c + (lampRadius + 11) * px;
    ctx.beginPath();
    ctx.moveTo(c - 7 * px, ay);
    ctx.lineTo(c + 7 * px, ay);
    ctx.lineTo(c + 5.5 * px, ay - 1.1 * px);
    ctx.moveTo(c + 7 * px, ay);
    ctx.lineTo(c + 5.5 * px, ay + 1.1 * px);
    ctx.stroke();
  });
  const floor = mesh(new THREE.CircleGeometry(floorR, 96), standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.55, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.12;
  floor.castShadow = false;

  // The lamp, at the true focus of the orbit, on a post.
  const lamp = lampAt();
  const post = [];
  stick(post, [lamp[0], 0, lamp[2]], [lamp[0], lamp[1] - lampRadius, lamp[2]], 0.5, 0x39404d, 12);
  const bulb = brightBall(lampRadius, 0xfff4d0);
  bulb.position.set(lamp[0], lamp[1], lamp[2]);
  const halo = glow(lampRadius * 5, 'rgba(255,190,90,0.5)');
  halo.position.copy(bulb.position);

  // The Earth: a tilted globe, and an axis with a ring round it at the student's own latitude.
  const axisQ = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...AXIS));
  const ballGeometry = withColor(new THREE.SphereGeometry(earthRadius, 96, 64));
  ballGeometry.rotateY(-Math.PI / 2);
  const ball = mesh(ballGeometry, unlit({ map: earthTexture(1024) }));
  ball.castShadow = false;
  ball.receiveShadow = false;
  ball.quaternion.copy(axisQ);

  const axisParts = [];
  stick(axisParts, [0, -earthRadius - 2, 0], [0, earthRadius + 2.4, 0], 0.13, 0xe8e2d0, 12);
  put(axisParts, new THREE.ConeGeometry(0.34, 1.1, 14), 0xd6453a, [0, earthRadius + 2.8, 0]);
  const lat = (GIRARD_LATITUDE * Math.PI) / 180;
  const ring = new THREE.TorusGeometry(earthRadius * Math.cos(lat) + 0.02, 0.05, 8, 72);
  ring.rotateX(Math.PI / 2);
  put(axisParts, ring, 0xffd24a, [0, earthRadius * Math.sin(lat), 0]);
  const equator = new THREE.TorusGeometry(earthRadius + 0.02, 0.04, 8, 72);
  equator.rotateX(Math.PI / 2);
  put(axisParts, equator, 0xffffff);
  const rod = mesh(mergeParts(axisParts), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  rod.castShadow = false;
  rod.receiveShadow = false;
  rod.quaternion.copy(axisQ);

  const earth = group(ball, rod);
  const g = scenery(group(floor, solid(post), bulb, halo, earth));

  const base = ballGeometry.attributes.normal;
  let shown = DIAL.yearDay;
  const light = [0, 0, 0];
  const place = () => {
    const at = earthAt(shown);
    earth.position.set(at[0], at[1], at[2]);
    const dx = lamp[0] - at[0];
    const dy = lamp[1] - at[1];
    const dz = lamp[2] - at[2];
    const n = Math.hypot(dx, dy, dz);
    light[0] = dx / n;
    light[1] = dy / n;
    light[2] = dz / n;
    writeDaylight(ballGeometry, light, 0.06, (i, out) => out.fromBufferAttribute(base, i).applyQuaternion(axisQ));
  };
  place();
  g.userData.tick = {
    update(dt, camera, worldVars) {
      const raw = worldVars?.get('yearDay');
      if (raw === undefined) return;
      // Always forward through the year, however far: a jump from June to December goes the way the
      // Earth goes, not back through the spring.
      const wanted = ((raw % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
      const ahead = ((wanted - shown) % YEAR_DAYS + YEAR_DAYS) % YEAR_DAYS;
      if (ahead < 0.01) return;
      const ease = reducedMotion() ? 1 : 1 - Math.exp(-3 * dt);
      shown = ahead < 0.05 ? wanted : (shown + ahead * ease) % YEAR_DAYS;
      place();
    },
  };
  return g;
}

// ---- the sky bowl ----
const BOWL = { radius: 24, eye: 5, wall: 25 };
const PATH_SIDES = 6;
const PATH_POINTS = 120;

// One day's path across the sky: the full circle the Sun runs, for an observer at this latitude. The
// night half is simply below the horizon wall, so nothing has to work out sunrise.
function writePath(array, normals, start, latitude, dec, thick = 0.16) {
  const φ = (latitude * Math.PI) / 180;
  const δ = (dec * Math.PI) / 180;
  // x is east, y is up, -z is north.
  const pole = new THREE.Vector3(0, Math.sin(φ), -Math.cos(φ));
  const meridian = new THREE.Vector3(0, Math.cos(φ), Math.sin(φ));
  const east = new THREE.Vector3(1, 0, 0);
  const centre = pole.clone().multiplyScalar(Math.sin(δ) * BOWL.radius);
  const radius = Math.cos(δ) * BOWL.radius;
  const p = new THREE.Vector3();
  const out = new THREE.Vector3();
  let o = start;
  for (let i = 0; i < PATH_POINTS; i++) {
    const H = (i / PATH_POINTS) * Math.PI * 2;
    out.copy(meridian).multiplyScalar(Math.cos(H)).addScaledVector(east, -Math.sin(H));
    p.copy(centre).addScaledVector(out, radius);
    for (let s = 0; s < PATH_SIDES; s++) {
      const a = (s / PATH_SIDES) * Math.PI * 2;
      const nx = out.x * Math.cos(a) + pole.x * Math.sin(a);
      const ny = out.y * Math.cos(a) + pole.y * Math.sin(a);
      const nz = out.z * Math.cos(a) + pole.z * Math.sin(a);
      array[o] = p.x + nx * thick;
      array[o + 1] = p.y + BOWL.eye + ny * thick;
      array[o + 2] = p.z + nz * thick;
      normals[o] = nx;
      normals[o + 1] = ny;
      normals[o + 2] = nz;
      o += 3;
    }
  }
}

// Where the Sun is, from an observer at the middle: x east, y up, -z north.
export function skyDirection(latitude, dec, hour) {
  const φ = (latitude * Math.PI) / 180;
  const δ = (dec * Math.PI) / 180;
  const H = ((hour - 12) * 15 * Math.PI) / 180;
  const up = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H);
  const north = Math.cos(φ) * Math.sin(δ) - Math.sin(φ) * Math.cos(δ) * Math.cos(H);
  const east = -Math.cos(δ) * Math.sin(H);
  return [east, up, -north];
}

// Three fixed paths, today's, a bead for the Sun and a stick with a shadow. A student stands in the
// middle and looks south. All of it follows the `latitude`, `declination` and `hour` the daylight
// column shares, and only the paths that changed are rewritten.
export function skyBowl() {
  const parts = [];
  const wall = new THREE.CylinderGeometry(BOWL.wall, BOWL.wall, BOWL.eye, 96, 1, true);
  wall.translate(0, BOWL.eye / 2, 0);
  const wallMesh = mesh(wall, standard({ color: 0x1c2230, roughness: 0.9, side: THREE.DoubleSide }));
  wallMesh.castShadow = false;
  stick(parts, [0, 0, 0], [0, 3.4, 0], 0.14, 0xd8d2c0, 10);
  put(parts, new THREE.SphereGeometry(0.2, 10, 8), 0xd8d2c0, [0, 3.4, 0]);

  // The compass, printed round the floor: a student needs to know which way south is.
  const texture = canvasTexture(1024, 1024, (ctx, w) => {
    const c = w / 2;
    const px = w / (2 * BOWL.wall);
    ctx.fillStyle = '#121723';
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    for (const r of [8, 16, 24]) {
      ctx.beginPath();
      ctx.arc(c, c, r * px, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(3.4 * px)}px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('N', c, c - 20 * px);
    ctx.fillText('S', c, c + 20 * px);
    ctx.fillText('E', c + 20 * px, c);
    ctx.fillText('W', c - 20 * px, c);
    ctx.font = `700 ${Math.round(1.4 * px)}px ${SANS}`;
    ctx.fillText('Stand at the stick. Face S.', c, c + 12 * px);
  });
  const floor = mesh(new THREE.CircleGeometry(BOWL.wall, 80), standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.5, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.12;
  floor.castShadow = false;

  // The paths: one geometry of four circles, each a fixed run of the buffer.
  const verts = PATH_POINTS * PATH_SIDES;
  const count = verts * 4;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const indices = [];
  const tints = [0xf2c230, 0x8fb7d8, 0x6e8df0, 0xffffff];
  const tmp = new THREE.Color();
  for (let path = 0; path < 4; path++) {
    tmp.set(tints[path]);
    for (let v = 0; v < verts; v++) colors.set([tmp.r, tmp.g, tmp.b], (path * verts + v) * 3);
    const base = path * verts;
    for (let i = 0; i < PATH_POINTS; i++) {
      const next = (i + 1) % PATH_POINTS;
      for (let s = 0; s < PATH_SIDES; s++) {
        const t = (s + 1) % PATH_SIDES;
        const a = base + i * PATH_SIDES + s;
        const b = base + next * PATH_SIDES + s;
        const c = base + i * PATH_SIDES + t;
        const d = base + next * PATH_SIDES + t;
        indices.push(a, b, c, c, b, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BOWL.eye, 0), BOWL.radius + 1);
  const paths = mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  paths.castShadow = false;
  paths.receiveShadow = false;

  const bead = mesh(new THREE.SphereGeometry(1.5, 22, 14), new THREE.MeshBasicMaterial({ color: 0xfff0b8, fog: false }));
  bead.castShadow = false;
  bead.receiveShadow = false;

  const shadow = mesh(new THREE.BoxGeometry(0.34, 0.02, 1), new THREE.MeshBasicMaterial({ color: 0x050608, fog: false }));
  shadow.castShadow = false;
  shadow.receiveShadow = false;

  const root = scenery(group(floor, wallMesh, solid(parts), paths, bead, shadow));

  let shownLat = null;
  let shownDec = null;
  const writeFixed = (latitude) => {
    writePath(positions, normals, 0, latitude, TILT);
    writePath(positions, normals, verts * 3, latitude, 0);
    writePath(positions, normals, verts * 2 * 3, latitude, -TILT);
  };
  const stickTop = 3.4;
  const sync = (latitude, dec, hour) => {
    let dirty = false;
    if (latitude !== shownLat) { writeFixed(latitude); shownLat = latitude; shownDec = null; dirty = true; }
    if (dec !== shownDec) { writePath(positions, normals, verts * 3 * 3, latitude, dec, 0.26); shownDec = dec; dirty = true; }
    if (dirty) {
      g.attributes.position.needsUpdate = true;
      g.attributes.normal.needsUpdate = true;
    }
    const [x, y, z] = skyDirection(latitude, dec, hour);
    bead.position.set(x * BOWL.radius, BOWL.eye + y * BOWL.radius, z * BOWL.radius);
    if (y > 0.02) {
      const across = Math.hypot(x, z) || 1;
      const length = Math.min(BOWL.radius - 2, stickTop * (across / y));
      shadow.scale.set(1, 1, length);
      shadow.position.set((-x / across) * length * 0.5, 0.16, (-z / across) * length * 0.5);
      shadow.rotation.y = Math.atan2(-x, -z);
    } else {
      shadow.scale.set(1, 1, 0.001);
    }
  };
  const startDec = declinationOf(DIAL.yearDay);
  sync(DIAL.latitude, startDec, 12);

  root.userData.tick = {
    update(dt, camera, worldVars) {
      if (!worldVars?.has('declination')) return;
      sync(worldVars.get('latitude') ?? DIAL.latitude, worldVars.get('declination'), worldVars.get('hour') ?? 12);
    },
  };
  return root;
}

// The dial that owns the day and the place, and the empty post a student's calendar goes on.
function controlPost(title, line1, line2, accent) {
  const parts = [];
  put(parts, lathed([[0, 0], [1.3, 0], [1.3, 0.3], [0.5, 0.5], [0.4, 2.6], [0, 2.6]], { segments: 28 }), 0x2d323b);
  block(parts, 4.2, 2.4, 0.4, 0x2d323b, [0, 3.6, 0]);
  const plate = printedBoard(3.9, 2.1, 0.08, (ctx, w, h) => {
    ctx.fillStyle = '#151a22';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, w, h * 0.06);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, title, 800, Math.round(h * 0.2), SANS, w * 0.9);
    ctx.fillText(title, w / 2, h * 0.32);
    ctx.fillStyle = '#ffe2a6';
    fitText(ctx, line1, 700, Math.round(h * 0.13), SANS, w * 0.9);
    ctx.fillText(line1, w / 2, h * 0.58);
    fitText(ctx, line2, 700, Math.round(h * 0.13), SANS, w * 0.9);
    ctx.fillText(line2, w / 2, h * 0.76);
  }, { pixelsPerFoot: 110 });
  plate.position.set(0, 3.6, 0.25);
  return group(solid(parts), plate);
}

export const seasonDial = () => controlPost('SEASON DIAL', 'Click me, press Program', 'and change a green number', SE.season);
export const calendarPost = () => controlPost('CALENDAR', 'I have no program yet', 'Click me and write one', SE.season);

// A column in the ground, raised to the hours of daylight. It carries the program that works out the
// sky, which is what the board beside it shows.
export function daylightColumn() {
  const parts = [];
  const height = GAUGE.hours * GAUGE.feetPerHour;
  block(parts, 1, height, 0.6, 0xe0a02e, [0, height / 2, 0]);
  const column = solid(parts);
  // A sun this low throws the boards on the dome's shadows all the way here, and a shadow across an
  // instrument reads as part of the reading.
  column.receiveShadow = false;
  return group(column);
}

export const DAYLIGHT_COLUMN_X = -1.2;

export function daylightGauge() {
  const { hours, feetPerHour } = GAUGE;
  const height = hours * feetPerHour;
  const parts = [];
  for (const sx of [-1, 1]) {
    block(parts, 0.3, height + 3, 0.3, 0x363b47, [sx * 2.7, (height + 3) / 2, -0.3]);
  }
  const board = printedBoard(5, height + 1, 0.2, (ctx, w, h) => {
    ctx.fillStyle = '#f5f1e6';
    ctx.fillRect(0, 0, w, h);
    const yOf = (hour) => h - (hour / hours) * (height / (height + 1)) * h;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let hour = 0; hour <= hours; hour += 2) {
      const major = hour % 6 === 0;
      ctx.fillStyle = '#20242a';
      ctx.fillRect(w * 0.05, yOf(hour) - (major ? 3 : 1), w * (major ? 0.55 : 0.48), major ? 6 : 3);
      ctx.font = `800 ${Math.round(w * (major ? 0.12 : 0.09))}px ${SANS}`;
      ctx.fillText(`${hour} h`, w * 0.96, yOf(hour));
    }
    ctx.textAlign = 'center';
    ctx.font = `800 ${Math.round(w * 0.085)}px ${SANS}`;
    ctx.fillStyle = '#7a5410';
    ctx.fillText('HOURS OF DAYLIGHT', w * 0.5, h - (height / (height + 1)) * h - h * 0.012);
  }, { pixelsPerFoot: 36 });
  board.position.set(0, (height + 1) / 2, 0);
  return scenery(group(solid(parts), board), { shadows: false });
}

// The true sizes and distance, laid out on the floor where they fit. An Earth one foot in radius has
// a Moon sixty feet away, which is what no picture of the Earth and Moon ever shows.
export function trueScaleEarth({ radius = 1 } = {}) {
  const parts = [];
  put(parts, lathed([[0, 0], [1, 0], [1, 0.2], [0.3, 0.35], [0.14, 3.2], [0, 3.2]], { segments: 24 }), 0x2d323b);
  const ball = mesh(new THREE.SphereGeometry(radius, 40, 28), standard({ map: earthTexture(512), roughness: 0.6 }));
  ball.position.y = 3.2 + radius * 0.95;
  return group(solid(parts), ball);
}

export function trueScaleMoon({ radius = 0.27 } = {}) {
  const parts = [];
  put(parts, lathed([[0, 0], [1, 0], [1, 0.2], [0.3, 0.35], [0.14, 3.9], [0, 3.9]], { segments: 24 }), 0x2d323b);
  const ball = mesh(new THREE.SphereGeometry(radius, 28, 20), standard({ map: moonMap(), roughness: 0.9 }));
  ball.position.y = 3.9 + radius * 0.9;
  return group(solid(parts), ball);
}

