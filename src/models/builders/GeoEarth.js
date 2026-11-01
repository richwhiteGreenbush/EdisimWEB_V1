import * as THREE from 'three';
import { Batch, signs, woodenBase, terrainBlock, paintTexels, seededRandom, mixc, shade, sstep, fbm, ridged, noise2, TAU } from '../geo/GeoKit.js';
import { landMask, earthColor, mountainAmount, climateZone, CLIMATE_GROUPS, inAfrica, inGreenland } from '../geo/GeoEarth.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import { lathe, tube } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The World Geography models that are about maps and the globe: a classroom globe, the grid of
// latitude and longitude, climate zones, why flat maps stretch, a compass rose and contour lines.

const DEG = Math.PI / 180;
const FONT = 'Arial, Helvetica, sans-serif';
const BRASS = 0xb8934a;
const WALNUT = 0x4a3020;

// Named places, by longitude and latitude. An ocean's name goes where a globe printer would put it.
const CONTINENTS = [['NORTH AMERICA', -100, 44, 1], ['SOUTH AMERICA', -59, -12, 0.95], ['EUROPE', 18, 50, 0.72], ['AFRICA', 20, 7, 1.05], ['ASIA', 92, 47, 1.2], ['AUSTRALIA', 134, -25, 0.8], ['ANTARCTICA', 40, -78, 0.85]];
const OCEANS = [['PACIFIC OCEAN', -152, 8, 1.1], ['PACIFIC OCEAN', 165, 25, 0.9], ['ATLANTIC OCEAN', -36, 26, 1], ['ATLANTIC OCEAN', -18, -28, 0.9], ['INDIAN OCEAN', 78, -24, 1], ['ARCTIC OCEAN', 10, 82, 0.72], ['SOUTHERN OCEAN', -95, -63, 0.8]];

// Text on an equirectangular sheet spreads toward the poles, so it is squeezed by cos(latitude) to
// come out square on the sphere.
function globeText(ctx, w, h, text, lon, lat, size, { color = '#fff', italic = false, stroke = null } = {}) {
  const x = ((lon + 180) / 360) * w; const y = ((90 - lat) / 180) * h;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1 / Math.max(0.2, Math.cos(lat * DEG)), 1);
  ctx.font = `${italic ? 'italic ' : ''}bold ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = size * 0.16; ctx.strokeStyle = stroke; ctx.strokeText(text, 0, 0); }
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// A sheet painted by a function of longitude, latitude and land, then written on. A globe's bump map
// is painted from the ranges, because at this size a mountain range is a change of light rather than
// a change of outline.
function globeSphere(r, W, H, colorAt, write, { bump = true, segments = 120 } = {}) {
  const map = canvasTexture(W, H, (ctx) => {
    const mask = landMask(W, H);
    paintTexels(ctx, W, H, (px, py) => colorAt(((px + 0.5) / W) * 360 - 180, 90 - ((py + 0.5) / H) * 180, mask[py * W + px]));
    write?.(ctx, W, H);
  });
  const params = { map, roughness: 0.46, metalness: 0.02 };
  if (bump) {
    const bumpW = 1024; const bumpH = 512;
    params.bumpMap = canvasTexture(bumpW, bumpH, (ctx) => {
      const mask = landMask(bumpW, bumpH);
      paintTexels(ctx, bumpW, bumpH, (px, py) => {
        const lon = ((px + 0.5) / bumpW) * 360 - 180; const lat = 90 - ((py + 0.5) / bumpH) * 180;
        const v = mask[py * bumpW + px] ? 118 + 120 * mountainAmount(lon, lat) + 12 * fbm(lon * 0.3, lat * 0.3, 3, 2) : 90;
        return [v, v, v];
      });
    });
    params.bumpMap.colorSpace = THREE.NoColorSpace;
    params.bumpScale = 1.6;
  }
  return mesh(new THREE.SphereGeometry(r, segments, Math.round(segments * 0.66)), standard(params));
}

// A circle of brass round the sphere's local axis, at a latitude.
function ringAtLatitude(batch, r, lat, thick, color, tilt = null) {
  const y = Math.sin(lat * DEG) * r; const R = Math.cos(lat * DEG) * r;
  const g = new THREE.TorusGeometry(R, thick, 8, 120);
  g.rotateX(Math.PI / 2);
  batch.add(g, color, { position: [0, y, 0] });
}
function ringAtLongitude(batch, r, lon, thick, color) {
  const g = new THREE.TorusGeometry(r, thick, 8, 120);
  // A torus lies in XY; a meridian plane holds the axis and the direction of that longitude.
  g.rotateY(-lon * DEG);
  batch.add(g, color);
}

// Turned stand, its top at `y`, with an optional half meridian holding a sphere at `tilt` degrees.
function turnedStand(batch, y) {
  batch.add(lathe([[0, 0], [1.75, 0], [1.75, 0.14], [1.5, 0.22], [0.75, 0.42], [0.42, 0.66], [0.27, 1.05], [0.42, 1.2], [0.25, 1.32], [0.2, y], [0, y]], 48), WALNUT);
}

function classroomGlobe(group, batch, r, cy, tiltDeg) {
  const tilt = new THREE.Group();
  tilt.position.set(0, cy, 0);
  tilt.rotation.z = -tiltDeg * DEG;
  group.add(tilt);
  const spin = new THREE.Group();
  tilt.add(spin);
  return { tilt, spin };
}

function meridianArc(batch, r, cy, tiltDeg, gap = 0.1) {
  // A brass half circle in the tilted plane, joined to the stand's post below, with pins at the poles.
  const pts = [];
  const R = r + gap;
  const axis = tiltDeg * DEG;
  for (let i = 0; i <= 40; i += 1) {
    const a = -Math.PI / 2 + (i / 40) * Math.PI;
    // Measured from the axis's own direction, on the side away from the viewer's right.
    const lx = -Math.cos(a) * R; const ly = Math.sin(a) * R;
    pts.push([lx * Math.cos(axis) + ly * Math.sin(axis), cy + (-lx * Math.sin(axis) + ly * Math.cos(axis)), 0]);
  }
  batch.add(tube(pts, 0.05, { sides: 8, steps: 90 }), BRASS);
  return pts;
}

function spinTick(root, spin, rate) {
  root.userData.tick = { update(dt) { if (!reducedMotion()) spin.rotation.y += dt * rate; }, dispose() {} };
}

// ---------------------------------------------------------------------------------------------
function buildWorldGlobe() {
  const root = new THREE.Group();
  const batch = new Batch();
  const R = 3; const CY = 5.05; const TILT = 23.4;
  turnedStand(batch, CY - R * 0.96);
  const arc = meridianArc(batch, R, CY, TILT);
  const { spin } = classroomGlobe(root, batch, R, CY, TILT);
  const lowest = arc.reduce((a, b) => (b[1] < a[1] ? b : a));
  batch.add(tube([[0, CY - R * 0.98, 0], lowest], 0.09, { sides: 8, steps: 3, straight: true }), BRASS);
  const sphere = globeSphere(R, 2400, 1200, (lon, lat, land) => earthColor(lon, lat, land), (ctx, w, h) => {
    for (const [text, lon, lat, k] of CONTINENTS) globeText(ctx, w, h, text, lon, lat, 25 * k, { color: '#fff', stroke: 'rgba(30,30,20,0.72)' });
    for (const [text, lon, lat, k] of OCEANS) globeText(ctx, w, h, text, lon, lat, 25 * k, { color: 'rgba(214,232,248,0.92)', italic: true });
  });
  spin.add(sphere);
  // Lon -90 faces +z as built, and adding to the angle moves a place east. This starts with the
  // Americas and the Atlantic in front, then it turns.
  spin.rotation.y = -0.5;
  for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8);
    batch.add(g, BRASS, { position: [Math.sin(TILT * DEG) * s * (R + 0.04), CY + Math.cos(TILT * DEG) * s * (R + 0.04), 0], rotation: [0, 0, -TILT * DEG] });
  }
  root.add(batch.mesh({ roughness: 0.42, metalness: 0.22 }));
  spinTick(root, spin, 0.07);
  return root;
}

// ---------------------------------------------------------------------------------------------
function buildLatLongGlobe() {
  const root = new THREE.Group();
  const batch = new Batch();
  const R = 3.1; const CY = 4.6;
  const holder = new THREE.Group();
  holder.position.set(0, CY, 0);
  root.add(holder);
  const sphere = globeSphere(R, 2400, 1200, (lon, lat, land) => {
    const base = earthColor(lon, lat, land);
    // Quiet the map so the grid is what you read: greyed toward a paper tone.
    let c = land ? mixc(base, [176, 176, 150], 0.55) : mixc(base, [62, 104, 142], 0.55);
    const near = (v, step, wide) => { const m = ((v % step) + step) % step; return Math.min(m, step - m) < wide; };
    if (near(lat, 15, 0.16) || near(lon, 15, 0.16 / Math.max(0.12, Math.cos(lat * DEG)))) c = mixc(c, [244, 244, 236], 0.58);
    return c;
  }, (ctx, w, h) => {
    const num = (v, a, b) => (v === 0 ? '0°' : `${Math.abs(v)}°${v > 0 ? a : b}`);
    // The degree figures are printed every 60 degrees round, so one is always in view.
    for (const lon of [-157.5, -97.5 - 15, -37.5, 22.5, 82.5, 142.5]) {
      for (let lat = -75; lat <= 75; lat += 15) globeText(ctx, w, h, num(lat, 'N', 'S'), lon, lat + 1.9, 15, { color: '#fff', stroke: 'rgba(20,30,40,0.8)' });
    }
    for (const lat of [52, -22]) {
      for (let lon = -165; lon <= 180; lon += 15) globeText(ctx, w, h, num(lon, 'E', 'W'), lon + 2.1, lat, 14, { color: '#ffe9a8', stroke: 'rgba(20,30,40,0.8)' });
    }
    const named = [['EQUATOR', -3], ['TROPIC OF CANCER', 23.4], ['TROPIC OF CAPRICORN', -23.4], ['ARCTIC CIRCLE', 66.6], ['ANTARCTIC CIRCLE', -66.6]];
    for (const [text, lat] of named) for (const lon of [-128, -8, 112]) globeText(ctx, w, h, text, lon, lat + (lat === -3 ? 0 : 2.4), 15, { color: '#ffd9a0', stroke: 'rgba(20,30,40,0.85)' });
    for (const lat of [38, -38]) globeText(ctx, w, h, 'PRIME MERIDIAN', 0.6, lat, 13, { color: '#ffd9a0', stroke: 'rgba(20,30,40,0.85)' });
  }, { bump: false });
  holder.add(sphere);
  // Lon -90 faces +z as built; the pin's side turned a little further toward the walk-up.
  const TURN = -0.16;
  sphere.rotation.y = TURN;
  const lift = 0.02;
  const inner = new Batch();
  ringAtLatitude(inner, R + lift, 0, 0.05, 0xd8452f);
  for (const lat of [23.4, -23.4]) ringAtLatitude(inner, R + lift, lat, 0.03, 0xe8a23a);
  for (const lat of [66.6, -66.6]) ringAtLatitude(inner, R + lift, lat, 0.03, 0x5cb6d8);
  ringAtLongitude(inner, R + lift, 0, 0.042, 0xe8c544);
  // The pin, in Kansas: 38 north, 97 west, turned with the map.
  const dir = new THREE.Vector3(Math.cos(38 * DEG) * Math.cos(-97 * DEG), Math.sin(38 * DEG), -Math.cos(38 * DEG) * Math.sin(-97 * DEG));
  const tip = dir.clone().multiplyScalar(R);
  const head = dir.clone().multiplyScalar(R + 0.5);
  inner.add(tube([tip.toArray(), head.toArray()], [0.018, 0.022], { sides: 6, steps: 2, straight: true }), 0xcfd4d8);
  inner.add(new THREE.SphereGeometry(0.1, 14, 10), 0xd92c2c, { position: head.toArray() });
  const grid = inner.mesh({ roughness: 0.44, metalness: 0.12 });
  grid.rotation.y = TURN;
  holder.add(grid);
  // A plain cradle from below: this globe is upright, so the grid stays level with the eye.
  batch.add(lathe([[0, 0], [1.8, 0], [1.8, 0.14], [1.45, 0.24], [0.6, 0.44], [0.32, 0.7], [0.24, 1.2], [0, 1.2]], 48), WALNUT);
  const rim = new THREE.TorusGeometry(1.4, 0.09, 10, 64);
  rim.rotateX(Math.PI / 2);
  batch.add(rim, BRASS, { position: [0, CY - Math.sqrt(R * R - 1.4 * 1.4) - 0.02, 0] });
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * TAU + 0.5;
    batch.add(tube([[Math.cos(a) * 0.2, 1.15, Math.sin(a) * 0.2], [Math.cos(a) * 0.8, 1.42, Math.sin(a) * 0.8], [Math.cos(a) * 1.4, CY - Math.sqrt(R * R - 1.4 * 1.4) - 0.02, Math.sin(a) * 1.4]], 0.06, { sides: 8, steps: 10 }), BRASS);
  }
  root.add(batch.mesh({ roughness: 0.42, metalness: 0.22 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
function buildClimateGlobe() {
  const root = new THREE.Group();
  const batch = new Batch();
  const R = 3; const CY = 5.05; const TILT = 23.4;
  turnedStand(batch, CY - R * 0.96);
  const arc = meridianArc(batch, R, CY, TILT);
  const lowest = arc.reduce((a, b) => (b[1] < a[1] ? b : a));
  batch.add(tube([[0, CY - R * 0.98, 0], lowest], 0.09, { sides: 8, steps: 3, straight: true }), BRASS);
  const { spin } = classroomGlobe(root, batch, R, CY, TILT);
  const sphere = globeSphere(R, 2400, 1200, (lon, lat, land) => {
    if (!land) return mixc([40, 74, 112], [32, 62, 100], fbm(lon * 0.05, lat * 0.05, 2, 21) * 0.5 + 0.5);
    const zone = climateZone(lon, lat, fbm(lon * 0.13, lat * 0.13, 3, 8));
    return CLIMATE_GROUPS[zone].color;
  }, null, { bump: false });
  spin.add(sphere);
  spin.rotation.y = -0.5;
  root.add(batch.mesh({ roughness: 0.42, metalness: 0.22 }));
  spinTick(root, spin, 0.07);

  // The key: one bright strip of plates laid on a slope in front of the stand.
  const keyW = 8.2; const keyD = 1.5;
  const key = canvasTexture(1400, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f1e6';
    ctx.fillRect(0, 0, w, h);
    const cell = w / CLIMATE_GROUPS.length;
    CLIMATE_GROUPS.forEach((group, i) => {
      const [r, g, b] = group.color;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(i * cell + 12, 16, cell - 24, 100);
      ctx.strokeStyle = '#3a3a34'; ctx.lineWidth = 3;
      ctx.strokeRect(i * cell + 12, 16, cell - 24, 100);
      ctx.fillStyle = '#20262c';
      ctx.textAlign = 'center';
      ctx.font = `bold 38px ${FONT}`;
      ctx.fillText(group.name, (i + 0.5) * cell, 166);
      ctx.font = `25px ${FONT}`;
      const words = group.note.split(' ');
      if (group.note.length > 18) {
        ctx.fillText(words.slice(0, 2).join(' '), (i + 0.5) * cell, 204);
        ctx.fillText(words.slice(2).join(' '), (i + 0.5) * cell, 234);
      } else ctx.fillText(group.note, (i + 0.5) * cell, 208);
    });
  });
  const plate = new THREE.PlaneGeometry(keyW, keyD);
  const keyMesh = mesh(plate, standard({ map: key, roughness: 0.7, emissive: 0xffffff, emissiveMap: key, emissiveIntensity: 0.14 }));
  keyMesh.position.set(0, 0.86, 3.05);
  keyMesh.rotation.x = -Math.PI / 2 + 0.42;
  root.add(keyMesh);
  // The wedge it lies on.
  const wedge = new THREE.BufferGeometry();
  const hw = keyW / 2 + 0.1; const z0 = 3.05 - Math.cos(0.42) * (keyD / 2 + 0.08); const z1 = 3.05 + Math.cos(0.42) * (keyD / 2 + 0.08);
  const yBack = 0.86 + Math.sin(0.42) * (keyD / 2 + 0.08) - 0.015; const yFront = 0.86 - Math.sin(0.42) * (keyD / 2 + 0.08) - 0.015;
  const v = [
    -hw, yFront, z1, hw, yFront, z1, hw, yBack, z0, -hw, yFront, z1, hw, yBack, z0, -hw, yBack, z0, // top
    -hw, 0, z1, hw, 0, z1, hw, yFront, z1, -hw, 0, z1, hw, yFront, z1, -hw, yFront, z1, // front
    hw, 0, z0, -hw, 0, z0, -hw, yBack, z0, hw, 0, z0, -hw, yBack, z0, hw, yBack, z0, // back
    hw, 0, z1, hw, 0, z0, hw, yBack, z0, hw, 0, z1, hw, yBack, z0, hw, yFront, z1, // right
    -hw, 0, z0, -hw, 0, z1, -hw, yFront, z1, -hw, 0, z0, -hw, yFront, z1, -hw, yBack, z0, // left
  ];
  wedge.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  wedge.computeVertexNormals();
  root.add(mesh(wedge, standard({ color: WALNUT, roughness: 0.6 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Why maps stretch: the same Earth twice, with the two regions everyone argues about in one colour.
// ---------------------------------------------------------------------------------------------
const GREENLAND_TINT = [226, 84, 62];
const AFRICA_TINT = [240, 176, 56];

function mapColor(lon, lat, land) {
  if (land) {
    if (inGreenland(lon, lat)) return GREENLAND_TINT;
    if (inAfrica(lon, lat)) return AFRICA_TINT;
    return [188, 192, 158];
  }
  return [66, 122, 164];
}

function buildMapProjection() {
  const root = new THREE.Group();
  const batch = new Batch();
  const R = 1.75; // the Earth's radius on BOTH: that is what makes the map's width 2 pi R
  const LAT = 78; // Mercator runs to infinity at the pole, so it stops here, as printed maps do
  const yMax = Math.log(Math.tan(Math.PI / 4 + (LAT * DEG) / 2)) * R;
  const sheetW = TAU * R; const sheetH = yMax * 2;
  const cx = -2.35; const cz = 0.55; const cy = 1.15 + sheetH / 2;
  // The sheet's left edge. Chosen so that the curled part behind the globe is Asia and the Pacific,
  // and Greenland and Africa both land on the flat part, clear of the globe in front of it.
  const startLon = 65;
  // The sheet's left part curls behind the globe, and the rest lies flat beside it.
  const ARC = 118 * DEG;
  const arcLen = ARC * (R + 0.34);
  const flatLen = sheetW - arcLen;
  const peelX = cx; const peelZ = cz - R - 0.34;
  const sp = []; const su = []; const si = [];
  const rows = 30; const cols = 110;
  for (let i = 0; i <= cols; i += 1) {
    const s = (i / cols) * sheetW;
    let x; let z;
    if (s < arcLen) {
      const a = (arcLen - s) / (R + 0.34);
      x = peelX - Math.sin(a) * (R + 0.34); z = cz - Math.cos(a) * (R + 0.34);
    } else { x = peelX + (s - arcLen); z = peelZ; }
    for (let j = 0; j <= rows; j += 1) {
      sp.push(x, cy - sheetH / 2 + (j / rows) * sheetH, z);
      su.push(i / cols, j / rows);
    }
  }
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = i * (rows + 1) + j; const b = a + rows + 1;
      si.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setIndex(si);
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sheet.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  sheet.computeVertexNormals();
  const W = 2048; const H = Math.round(W * sheetH / sheetW);
  const mapTex = canvasTexture(W, H, (ctx) => {
    const mw = 2400; const mh = 1200;
    const mask = landMask(mw, mh);
    paintTexels(ctx, W, H, (px, py) => {
      const lon = (((startLon + ((px + 0.5) / W) * 360) + 180) % 360) - 180;
      const y = (1 - 2 * (py + 0.5) / H) * yMax / R;
      const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / DEG;
      const land = mask[Math.floor(((90 - lat) / 180) * mh) * mw + Math.floor(((lon + 180) / 360) * mw)];
      let c = mapColor(lon, lat, land);
      const off = (v, step, wide) => { const m = ((v % step) + step) % step; return Math.min(m, step - m) < wide; };
      // A grid every 15 degrees is the whole demonstration: watch the rows get taller toward the top.
      const row = (lat2) => Math.log(Math.tan(Math.PI / 4 + (lat2 * DEG) / 2));
      const px15 = (W / 24);
      const lonOff = ((((px + 0.5) / W) * 360 + startLon + 360) % 15) * (W / 360);
      if (Math.min(lonOff, px15 - lonOff) < 1.3) c = mixc(c, [255, 255, 255], 0.5);
      const nearest = Math.round(lat / 15) * 15;
      if (Math.abs(row(nearest) - y) * (H / (2 * yMax / R)) < 1.3) c = mixc(c, [255, 255, 255], 0.5);
      return c;
    });
    ctx.font = `bold 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const at = (lon, lat) => {
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
      return [(((lon - startLon + 360) % 360) / 360) * W, (1 - y / (yMax / R)) * H / 2];
    };
    const label = (text, lon, lat, size, color = '#1d2228') => {
      const [x, y] = at(lon, lat);
      ctx.font = `bold ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    label('GREENLAND', -42, 72, 34);
    label('AFRICA', 20, 5, 40);
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
  });
  const sheetMesh = mesh(sheet, standard({ map: mapTex, roughness: 0.72, side: THREE.DoubleSide }));
  root.add(sheetMesh);
  // Rails along the top and bottom of the flat part, and the two posts that hold it up.
  const fx0 = peelX - 0.1; const fx1 = peelX + flatLen + 0.12;
  const railZ = peelZ - 0.05;
  for (const y of [cy - sheetH / 2 - 0.05, cy + sheetH / 2 + 0.05]) {
    batch.add(new THREE.BoxGeometry(fx1 - fx0, 0.12, 0.16), WALNUT, { position: [(fx0 + fx1) / 2, y, railZ] });
  }
  for (const x of [fx0 + 0.1, fx1 - 0.1]) {
    batch.add(new THREE.BoxGeometry(0.16, cy + sheetH / 2 + 0.12, 0.16), WALNUT, { position: [x, (cy + sheetH / 2 + 0.12) / 2, railZ - 0.09] });
  }
  // The floor it all stands on.
  const baseW = 10.9; const baseD = 6.3;
  const base = new THREE.BoxGeometry(baseW, 0.28, baseD);
  batch.add(base, 0x3b2a1c, { position: [0, 0.14, 0] });
  // The same two tints on the globe: a globe does not stretch, so this is the true size of each.
  const globe = globeSphere(R, 2000, 1000, mapColor, (ctx, w, h) => {
    globeText(ctx, w, h, 'GREENLAND', -42, 72, 22, { color: '#fff', stroke: 'rgba(20,20,20,0.7)' });
    globeText(ctx, w, h, 'AFRICA', 20, 5, 34, { color: '#1d2228' });
  }, { bump: false, segments: 96 });
  globe.position.set(cx, cy, cz);
  // Turned so Africa and Greenland are both on the side a student walks up to.
  globe.rotation.y = -1.28;
  root.add(globe);
  batch.add(lathe([[0, 0], [0.95, 0], [0.95, 0.1], [0.5, 0.25], [0.2, 0.5], [0.13, cy - R - 0.2], [0.42, cy - R + 0.04], [0, cy - R + 0.04]], 36), BRASS, { position: [cx, 0.26, cz] });
  signs(root, batch, [
    { text: 'On a globe, sizes are true', x: cx - 0.1, z: cz + 2.3, y: 0.72, ground: 0.28 },
    { text: 'On a flat map, the far north stretches', x: cx + 4.6, z: peelZ + 1.05, y: 0.62, ground: 0.28 },
  ]);
  root.add(batch.mesh({ roughness: 0.6 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// The compass rose.
// ---------------------------------------------------------------------------------------------
function buildCompassRose() {
  const root = new THREE.Group();
  const batch = new Batch();
  const R = 3.3; const TOP = 2.5;
  // The pedestal and the deep bowl. North is -z, so it reads the right way up from the walk-up side.
  batch.add(lathe([[0, 0], [2.7, 0], [2.7, 0.2], [2.2, 0.34], [0.9, 0.62], [0.72, 1.3], [1.5, 1.72], [R - 0.2, TOP - 0.3], [R, TOP - 0.16], [R + 0.09, TOP + 0.08], [R - 0.08, TOP + 0.16], [R - 0.22, TOP + 0.06], [R - 0.22, TOP], [0, TOP]], 96), 0xb8934a);
  const NAMES = [['N', 0, 'big'], ['NNE', 22.5], ['NE', 45, 'mid'], ['ENE', 67.5], ['E', 90, 'big'], ['ESE', 112.5], ['SE', 135, 'mid'], ['SSE', 157.5], ['S', 180, 'big'], ['SSW', 202.5], ['SW', 225, 'mid'], ['WSW', 247.5], ['W', 270, 'big'], ['WNW', 292.5], ['NW', 315, 'mid'], ['NNW', 337.5]];
  const dial = canvasTexture(2048, 2048, (ctx, w, h) => {
    const c = w / 2;
    ctx.fillStyle = '#f2e9d2';
    ctx.fillRect(0, 0, w, h);
    const sheen = ctx.createRadialGradient(c, c, 0, c, c, c);
    sheen.addColorStop(0, '#f8f1dd'); sheen.addColorStop(1, '#e4d6b4');
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a2d1e';
    // Every degree, heavier every ten.
    ctx.translate(c, c);
    for (let d = 0; d < 360; d += 1) {
      ctx.save();
      ctx.rotate(d * DEG);
      const big = d % 10 === 0; const mid = d % 5 === 0;
      ctx.lineWidth = big ? 5 : mid ? 3.5 : 1.6;
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.985);
      ctx.lineTo(0, -c * (big ? 0.925 : mid ? 0.945 : 0.96));
      ctx.stroke();
      if (d % 30 === 0) {
        ctx.fillStyle = '#3a2d1e';
        ctx.font = `bold 40px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d), 0, -c * 0.885);
      }
      ctx.restore();
    }
    ctx.lineWidth = 6;
    for (const k of [0.985, 0.845, 0.54]) { ctx.beginPath(); ctx.arc(0, 0, c * k, 0, TAU); ctx.stroke(); }
    for (const [name, d, kind] of NAMES) {
      ctx.save();
      ctx.rotate(d * DEG);
      ctx.fillStyle = kind === 'big' ? (name === 'N' ? '#b42318' : '#1e2a38') : '#3b4652';
      ctx.font = `bold ${kind === 'big' ? 118 : kind === 'mid' ? 72 : 44}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, 0, -c * (kind === 'big' ? 0.72 : kind === 'mid' ? 0.73 : 0.77));
      ctx.restore();
    }
  });
  const disc = new THREE.CircleGeometry(R - 0.24, 96);
  disc.rotateX(-Math.PI / 2);
  // The sheet's north, at the top of the canvas, is -z after this rotation.
  const dialMesh = mesh(disc, standard({ map: dial, roughness: 0.55 }));
  dialMesh.position.y = TOP + 0.005;
  root.add(dialMesh);
  // The star: sixteen raised points, each a kite with one light facet and one dark, which is the
  // drawing every compass rose has made since the medieval charts.
  const star = new Batch();
  const point = (deg, len, wide, light, dark, y0) => {
    const a = deg * DEG; const dx = Math.sin(a); const dz = -Math.cos(a); // +x east, -z north
    const nx = Math.cos(a); const nz = Math.sin(a);
    const tip = [dx * len, y0, dz * len];
    const ridge = [dx * len * 0.18, y0 + 0.13, dz * len * 0.18];
    const hub = [0, y0 + 0.13, 0];
    const left = [dx * len * 0.2 + nx * -wide, y0, dz * len * 0.2 + nz * -wide];
    const right = [dx * len * 0.2 + nx * wide, y0, dz * len * 0.2 + nz * wide];
    const facet = (a1, b1, c1, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...a1, ...b1, ...c1], 3));
      g.computeVertexNormals();
      star.add(g, color);
    };
    facet(tip, ridge, right, light); facet(ridge, hub, right, light);
    facet(tip, left, ridge, dark); facet(ridge, left, hub, dark);
  };
  const rose = R - 0.24;
  for (let i = 0; i < 8; i += 1) point(22.5 + i * 45, rose * 0.43, 0.1, 0xd9b46a, 0x8a6a2c, TOP + 0.02);
  for (let i = 0; i < 4; i += 1) point(45 + i * 90, rose * 0.56, 0.2, 0x4f7a9c, 0x25435c, TOP + 0.03);
  for (let i = 0; i < 4; i += 1) point(i * 90, rose * 0.63, 0.32, i === 0 ? 0xd6432f : 0xe8e2d0, i === 0 ? 0x8e1f15 : 0x1f2c3a, TOP + 0.04);
  root.add(star.mesh({ roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
  // The needle, on a pivot, level above the star. Red end north.
  const needle = new THREE.Group();
  needle.position.y = TOP + 0.5;
  const nb = new Batch();
  const half = (len, color, sign) => {
    const g = new THREE.BufferGeometry();
    const w = 0.13; const t = 0.045;
    const v = [
      0, t, 0, w, 0, 0, 0, 0, -sign * len, 0, t, 0, 0, 0, -sign * len, -w, 0, 0,
      0, -t, 0, 0, 0, -sign * len, w, 0, 0, 0, -t, 0, -w, 0, 0, 0, 0, -sign * len,
    ];
    if (sign < 0) {
      // Reversing the direction of travel reverses the winding too.
      for (let i = 0; i < v.length; i += 9) {
        for (let k = 0; k < 3; k += 1) { const tmp = v[i + 3 + k]; v[i + 3 + k] = v[i + 6 + k]; v[i + 6 + k] = tmp; }
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    nb.add(g, color);
  };
  half(rose * 0.8, 0xc9281c, 1);
  half(rose * 0.8, 0xe6e8ea, -1);
  nb.add(new THREE.SphereGeometry(0.1, 14, 10), BRASS, { scale: [1, 0.6, 1] });
  needle.add(nb.mesh({ roughness: 0.34, metalness: 0.3 }));
  root.add(needle);
  batch.add(new THREE.ConeGeometry(0.09, 0.48, 12), BRASS, { position: [0, TOP + 0.24, 0] });
  root.add(batch.mesh({ roughness: 0.38, metalness: 0.55 }));
  // A needle settles and never quite stops: it hunts a little about north.
  let t = 0;
  root.userData.tick = {
    update(dt) {
      if (reducedMotion()) { needle.rotation.y = 0; return; }
      t += dt;
      needle.rotation.y = 0.05 * Math.sin(t * 0.9) + 0.022 * Math.sin(t * 2.3 + 1);
    },
    dispose() {},
  };
  return root;
}

// ---------------------------------------------------------------------------------------------
// Contour lines: one height function, used for the hill and for the map beside it.
// ---------------------------------------------------------------------------------------------
function buildContourHill() {
  const root = new THREE.Group();
  const SIDE = 8.6;
  const BASE = 0.5; const STEP = 0.32;
  // In the hill's own frame, centred. The big peak has a steep north-east face on purpose.
  const landH = (x, z) => {
    const big = 3.75 * Math.exp(-(((x + 1.25) ** 2) / (x > -1.25 ? 1.2 : 3.4) + ((z + 0.75) ** 2) / (z < -0.75 ? 1.3 : 3.8)));
    const small = 2.35 * Math.exp(-(((x - 2.05) ** 2) / 1.9 + ((z - 1.55) ** 2) / 2.1));
    return BASE + big + small + 0.06 * fbm(x * 0.5, z * 0.5, 3, 7);
  };
  const tintFor = (h) => {
    const t = (h - BASE) / 4;
    const low = [118, 168, 96]; const mid = [214, 200, 124]; const high = [184, 134, 84]; const top = [232, 226, 214];
    if (t < 0.35) return mixc(low, mid, t / 0.35);
    if (t < 0.72) return mixc(mid, high, (t - 0.35) / 0.37);
    return mixc(high, top, (t - 0.72) / 0.28);
  };
  const contourAt = (h, slope, pxPerFt, c) => {
    const f = (h - BASE) / STEP;
    const nearestLine = Math.round(f);
    // Nothing at the zero line: the land's foot is nearly level there, so a contour at that height
    // wanders across the plain tracing the noise instead of the shape of anything.
    if (nearestLine < 1) return c;
    const dy = Math.abs(f - nearestLine) * STEP;
    // Line width in feet of ground is the same everywhere, so convert through the slope.
    const across = dy / Math.max(0.07, slope);
    const index = nearestLine % 5 === 0;
    const wide = index ? 0.038 : 0.02;
    if (across < wide) return mixc(c, [62, 40, 22], 0.95);
    return c;
  };
  const hx = -SIDE / 2 - 0.2;
  const block = terrainBlock({
    w: SIDE, d: SIDE, plinth: 0.32, nx: 150, nz: 150,
    height: (x, z) => 0.32 + landH(x, z) - BASE + 0.45,
    texW: 1400, texH: 1400, lightAmount: 0.35, relief: 0.06, strip: 200,
    paint: (x, z, y, slope) => contourAt(landH(x, z), slope, 160, tintFor(landH(x, z))),
    strata: (x, z, y, g) => mixc([136, 104, 72], [116, 88, 60], noise2(x * 5, y * 9, 3) * 0.5 + 0.5),
  });
  block.root.position.set(hx, 0, 0);
  root.add(block.root);
  // The map: the same function, seen from straight above, with the lines and nothing else to help.
  const mapSize = SIDE;
  const mapTex = canvasTexture(1400, 1400, (ctx, w, h) => {
    const px2 = (p) => (p / w - 0.5) * mapSize;
    const heights = new Float32Array((w + 1) * (h + 1));
    for (let y = 0; y <= h; y += 1) for (let x = 0; x <= w; x += 1) heights[x + y * (w + 1)] = landH(px2(x), px2(y));
    paintTexels(ctx, w, h, (x, y) => {
      const v = heights[x + y * (w + 1)];
      const dx = (heights[x + 1 + y * (w + 1)] - v) / (mapSize / w);
      const dz = (heights[x + (y + 1) * (w + 1)] - v) / (mapSize / h);
      const slope = Math.hypot(dx, dz);
      return contourAt(v, slope, 160, mixc(tintFor(v), [244, 240, 226], 0.62));
    });
    // Height figures on the index lines, down the gentle south-west flank, as a printed map has them.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const toPx = (x) => (x / mapSize + 0.5) * w;
    const writeOn = (text, x, z, size = 34) => {
      ctx.font = `bold ${size}px ${FONT}`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = '#f8f4e6';
      ctx.fillRect(toPx(x) - tw / 2 - 6, toPx(z) - size * 0.62, tw + 12, size * 1.24);
      ctx.fillStyle = '#3e2816';
      ctx.fillText(text, toPx(x), toPx(z));
    };
    writeOn('Summit', -1.25, -1.25, 44);
    writeOn('Lower peak', 2.05, 0.95, 40);
    writeOn('Saddle', 0.55, 0.22, 40);
    writeOn('Steep: lines crowd', 1.55, -2.55, 42);
    writeOn('Gentle: lines spread', -2.0, 3.1, 42);
  });
  const sheet = new THREE.PlaneGeometry(mapSize, mapSize);
  sheet.rotateX(-Math.PI / 2 + 0.34);
  const mx = SIDE / 2 + 0.2;
  const my = 0.62 + Math.sin(0.34) * mapSize / 2;
  const mapMesh = mesh(sheet, standard({ map: mapTex, roughness: 0.82, emissive: 0xffffff, emissiveMap: mapTex, emissiveIntensity: 0.1 }));
  mapMesh.position.set(mx, my, 0);
  mapMesh.receiveShadow = false;
  root.add(mapMesh);
  const batch = new Batch();
  // A sloped desk under the map: a wedge seen from the side.
  const cosA = Math.cos(0.34) * mapSize / 2; const sinA = Math.sin(0.34) * mapSize / 2;
  const hw = mapSize / 2 + 0.12; const zF = cosA + 0.1; const zB = -cosA - 0.1;
  const yF = my - sinA - 0.06; const yB = my + sinA - 0.06;
  const wedge = new THREE.BufferGeometry();
  const v = [
    -hw, yF, zF, hw, yF, zF, hw, yB, zB, -hw, yF, zF, hw, yB, zB, -hw, yB, zB,
    -hw, 0, zF, hw, 0, zF, hw, yF, zF, -hw, 0, zF, hw, yF, zF, -hw, yF, zF,
    hw, 0, zB, -hw, 0, zB, -hw, yB, zB, hw, 0, zB, -hw, yB, zB, hw, yB, zB,
    hw, 0, zF, hw, 0, zB, hw, yB, zB, hw, 0, zF, hw, yB, zB, hw, yF, zF,
    -hw, 0, zB, -hw, 0, zF, -hw, yF, zF, -hw, 0, zB, -hw, yF, zF, -hw, yB, zB,
  ];
  wedge.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  wedge.computeVertexNormals();
  batch.add(wedge, WALNUT, { position: [mx, 0, 0] });
  // Everything on the hill is named the same as on the map, on signs standing where the words are.
  const onHill = (x, z, up) => ({ x: hx + x, z, y: 0.32 + landH(x, z) - BASE + 0.45 + up, ground: 0.32 + landH(x, z) - BASE + 0.45 });
  signs(root, batch, [
    { text: 'Summit', ...onHill(-1.25, -0.75, 0.5) },
    { text: 'Lower peak', ...onHill(2.05, 1.55, 0.5) },
    { text: 'Saddle', ...onHill(0.55, 0.6, 0.55) },
  ]);
  root.add(batch.mesh({ roughness: 0.6 }));
  return root;
}

export const BUILDERS = {
  'world-globe': () => buildWorldGlobe(),
  'latitude-longitude-globe': () => buildLatLongGlobe(),
  'climate-zones-globe': () => buildClimateGlobe(),
  'map-projection': () => buildMapProjection(),
  'compass-rose': () => buildCompassRose(),
  'contour-map-hill': () => buildContourHill(),
};
