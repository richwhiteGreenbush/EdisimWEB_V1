// Regression check for Stand on the Earth (src/props/EarthSkyProps.js, EarthSkyModel.js,
// EarthSkyPrograms.js and the lesson cards at EdusimWorldDatabase/lib/lessons/stand-on-the-earth.html).
//
//   node tools/check-standonearth.mjs
//
// A wrong phase or a swinging axis would teach the misconception this world exists to correct, so:
//
//  1. THE ASTRONOMY is measured off the real geometry: how much of each Moon a student at the pole
//     sees lit, which side it is on, where the season globe's axis points, and where the lamp stands
//     overhead. It does not trust the formulas to describe the props.
//  2. EVERY PROGRAM IS ACTUALLY RUN through the real block runner, as the chain it is in the world.
//  3. NOTHING IN THE WORLD OR ON THE CARDS IS JAVASCRIPT. This world is blocks only, on purpose.
//  4. THE LESSON CARDS ARE STATIC HTML, so every figure is generated here and looked for on the page.
//  5. The walkable dome is the same height function in both editions, and open edges hold a baseline.
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

const ctx = {
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {}, fillRect() {}, clearRect() {}, drawImage() {}, save() {}, restore() {},
  beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, fill() {}, stroke() {},
  translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeText() {}, strokeRect() {}, clip() {},
  quadraticCurveTo() {}, bezierCurveTo() {}, arcTo() {}, roundRect() {}, createPattern: () => ({}),
  measureText: (t) => ({ width: String(t).length * 9 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
};
globalThis.document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0, style: {} }) };

const Props = await import('../src/props/EarthSkyProps.js');
const M = await import('../src/props/EarthSkyModel.js');
const P = await import('../src/props/EarthSkyPrograms.js');
const { runBlocks } = await import('./lib/run-blocks.mjs');
const { formatValue } = await import('../src/ProgramRunner.js');
const { buildProp } = await import('../src/props/index.js');
const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');
const { terrainHeightAt } = await import('../src/SceneSetup.js');
const { classicHeightAt } = await import('../HiFi/src/engine/Height.js');
const { WORLD_THEMES } = await import('../src/config.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;
const RAD = Math.PI / 180;

// What a student at the pole sees of a sphere at `at`: the lit share of the visible disc, and how the
// light falls left and right of the middle of it. Weighted by each vertex's area as seen from there.
function seen(geometry, start, count, at, quaternion = null) {
  const eye = new THREE.Vector3(0, M.POLE_EYE_Y, 0);
  const toEye = eye.clone().sub(new THREE.Vector3(...at)).normalize();
  const right = toEye.clone().multiplyScalar(-1).cross(new THREE.Vector3(0, 1, 0)).normalize();
  const n = new THREE.Vector3();
  const normal = geometry.attributes.normal;
  const color = geometry.attributes.color;
  let area = 0; let lit = 0; let litRight = 0; let litLeft = 0;
  for (let i = start; i < start + count; i++) {
    n.fromBufferAttribute(normal, i);
    if (quaternion) n.applyQuaternion(quaternion);
    const facing = n.dot(toEye);
    if (facing <= 0) continue;
    const k = color.getX(i);
    area += facing;
    lit += facing * k;
    if (n.dot(right) > 0) litRight += facing * k;
    else litLeft += facing * k;
  }
  return { fraction: lit / area, litRight, litLeft };
}

// ---------------------------------------------------------------------------
// 1. The Moon
// ---------------------------------------------------------------------------
console.log('\nThe Moon, as a student at the pole sees it');
{
  const ring = Props.moonRing();
  const moons = ring.children[0].geometry;
  const each = moons.attributes.position.count / 8;
  check(Number.isInteger(each), 'eight moons in one mesh');
  M.PHASES.forEach((phase, i) => {
    const b = M.stationBearing(i);
    const at = [Math.sin(b) * M.STATION.orbit, M.STATION.y, Math.cos(b) * M.STATION.orbit];
    const s = seen(moons, i * each, each, at);
    const want = M.litFraction(phase.day);
    // The stations sit a little below the eye, so what is seen is off the formula by that angle.
    check(near(s.fraction, want, 0.09), `${phase.name} looks ${(want * 100).toFixed(0)}% lit`, `${(s.fraction * 100).toFixed(1)}%`);
    // A gibbous moon is lit on both sides of its middle, only more on one.
    if (phase.lit === 'right') check(s.litRight > s.litLeft * 1.2, `${phase.name} is lit on the viewer's right`, (s.litRight / s.litLeft).toFixed(2));
    if (phase.lit === 'left') check(s.litLeft > s.litRight * 1.2, `${phase.name} is lit on the viewer's left`, (s.litLeft / s.litRight).toFixed(2));
  });
  check(M.PHASES.every((p, i) => M.phaseSlot(p.day) === i), 'each phase day falls in its own slot');
}
{
  // The moving Moon: its light is repainted as it turns, so test it at its own bearing and turn.
  for (const [day, name] of [[0, 'new'], [M.ORBIT_DAYS / 4, 'first quarter'], [M.ORBIT_DAYS / 2, 'full'], [(M.ORBIT_DAYS * 3) / 4, 'last quarter']]) {
    const moon = Props.orbitingMoon();
    const b = M.moonBearing(day);
    moon.position.set(Math.sin(b) * M.MOON.orbit, M.MOON.y, Math.cos(b) * M.MOON.orbit);
    moon.rotation.y = b + Math.PI / 2;
    moon.updateMatrixWorld(true);
    moon.userData.tick.update(1 / 60);
    const g = moon.children[0].geometry;
    const s = seen(g, 0, g.attributes.position.count, moon.position.toArray(), moon.getWorldQuaternion(new THREE.Quaternion()));
    check(near(s.fraction, M.litFraction(day), 0.06), `the moving Moon at ${name} looks ${(M.litFraction(day) * 100).toFixed(0)}% lit`, `${(s.fraction * 100).toFixed(1)}%`);
  }
  // Local +X points at the Earth, so the near side stays toward the pole wherever it is.
  const moon = Props.orbitingMoon();
  const b = M.moonBearing(9);
  moon.rotation.y = b + Math.PI / 2;
  moon.updateMatrixWorld(true);
  const inward = new THREE.Vector3(1, 0, 0).applyQuaternion(moon.quaternion);
  check(near(inward.x, -Math.sin(b), 1e-9) && near(inward.z, -Math.cos(b), 1e-9), "the Moon's local +X points at the Earth");
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(moon.quaternion);
  const toLeftOfSun = new THREE.Vector3(Math.sin(b + 0.01) - Math.sin(b), 0, Math.cos(b + 0.01) - Math.cos(b)).normalize();
  check(forward.dot(toLeftOfSun) > 0.999, 'and its forward is counter-clockwise from above, the way the Moon goes');
}
{
  check(near(M.clockHours(0), 12) && near(M.clockHours(90), 18) && near(M.clockHours(180), 0) && near(M.clockHours(270), 6), 'the printed clock: noon toward the Sun, then later going east');
  check(M.highestAt(2) === '6 PM' && M.highestAt(4) === 'MIDNIGHT' && M.highestAt(6) === '6 AM', 'first quarter over 6 PM, full over midnight, last quarter over 6 AM');
  const s = M.sunLightDirection();
  check(near(Math.hypot(...s), 1) && s[2] < -0.99, 'the light comes from the Sun prop’s bearing');
  const sunAt = Props.labSunPosition();
  check(near(Math.atan2(sunAt.x, sunAt.z), M.SUN_BEARING, 1e-6), 'and the Sun is drawn on that bearing');
  // A new moon must pass under the drawn Sun rather than cover it.
  const moonTop = Math.atan((M.MOON.y + M.MOON.radius - M.POLE_EYE_Y) / M.MOON.orbit) / RAD;
  const sunBottom = M.SUN_DRAWN_ELEVATION - Math.atan(M.SUN_PROP.radius / M.SUN_PROP.distance) / RAD;
  check(moonTop < sunBottom, 'the moving Moon passes under the Sun', `${moonTop.toFixed(1)} vs ${sunBottom.toFixed(1)} degrees`);
  const theme = WORLD_THEMES.standonearth;
  const len = Math.hypot(...theme.sunPosition);
  const elevation = Math.asin(theme.sunPosition[1] / len) / RAD;
  check(near(elevation, M.SUN_DRAWN_ELEVATION, 0.1) && theme.sunPosition[0] === 0 && theme.sunPosition[2] < 0, "the theme's sun agrees with the Sun prop, or HiFi's sky draws two", `${elevation.toFixed(1)} degrees`);
}

// ---------------------------------------------------------------------------
// 2. The seasons
// ---------------------------------------------------------------------------
console.log('\nThe seasons, measured off the orrery');
{
  check(near(M.declination(172), 23.44, 0.01) && near(M.declination(355), -23.44, 0.02), 'the solstices');
  check(near(M.subLampLatitude(172), M.TILT, 0.02), 'in June the lamp is overhead at 23.44 north', M.subLampLatitude(172).toFixed(2));
  check(near(M.subLampLatitude(355), -M.TILT, 0.02), 'in December at 23.44 south', M.subLampLatitude(355).toFixed(2));
  check(near(M.subLampLatitude(81), 0, 1) && near(M.subLampLatitude(264), 0, 1), 'at the equinoxes near the equator', `${M.subLampLatitude(81).toFixed(2)}, ${M.subLampLatitude(264).toFixed(2)}`);
  const lamp = M.lampAt();
  const distance = (d) => { const e = M.earthAt(d); return Math.hypot(e[0] - lamp[0], e[1] - lamp[1], e[2] - lamp[2]); };
  check(distance(M.PERIHELION_DAY) < distance(M.APHELION_DAY), 'the Earth is closest in January', `${distance(M.PERIHELION_DAY).toFixed(2)} vs ${distance(M.APHELION_DAY).toFixed(2)} ft`);
  const ratio = distance(M.APHELION_DAY) / distance(M.PERIHELION_DAY);
  const real = M.APHELION_MILES / M.PERIHELION_MILES;
  check(near(ratio, real, 0.002), 'by the true ratio', `${ratio.toFixed(4)} vs ${real.toFixed(4)}`);

  const orrery = Props.seasonOrrery();
  const earth = orrery.children.find((c) => c.isGroup);
  const ball = earth.children[0];
  const g = ball.geometry;
  const northOf = () => {
    // The vertex at the north pole of the globe, and how lit it is.
    const n = new THREE.Vector3();
    let best = -2; let index = 0;
    const normal = g.attributes.normal;
    for (let i = 0; i < normal.count; i++) {
      n.fromBufferAttribute(normal, i);
      if (n.y > best) { best = n.y; index = i; }
    }
    return g.attributes.color.getX(index);
  };
  const southOf = () => {
    const n = new THREE.Vector3();
    let best = 2; let index = 0;
    const normal = g.attributes.normal;
    for (let i = 0; i < normal.count; i++) {
      n.fromBufferAttribute(normal, i);
      if (n.y < best) { best = n.y; index = i; }
    }
    return g.attributes.color.getX(index);
  };
  const go = (yearDay) => { const vars = new Map([['yearDay', yearDay]]); for (let i = 0; i < 2000; i++) orrery.userData.tick.update(1 / 60, null, vars); };
  const axes = [];
  const axisNow = () => new THREE.Vector3(0, 1, 0).applyQuaternion(ball.quaternion).applyQuaternion(earth.quaternion);
  go(172);
  axes.push(axisNow());
  check(northOf() > 0.9 && southOf() < 0.2, 'June: the north pole is in light and the south in dark', `${northOf().toFixed(2)} / ${southOf().toFixed(2)}`);
  check(near(earth.position.x, M.earthAt(172)[0], 0.05) && near(earth.position.z, M.earthAt(172)[2], 0.05), 'and the Earth is where June is');
  go(355);
  axes.push(axisNow());
  check(northOf() < 0.2 && southOf() > 0.9, 'December: the other way round', `${northOf().toFixed(2)} / ${southOf().toFixed(2)}`);
  check(near(earth.position.x, M.earthAt(355)[0], 0.05), 'and the Earth is across the orbit');
  go(81);
  axes.push(axisNow());
  check(near(northOf(), southOf(), 0.2), 'March: both poles on the edge of the light');
  check(axes.every((a) => near(a.x, M.AXIS[0], 1e-9) && near(a.y, M.AXIS[1], 1e-9) && near(a.z, M.AXIS[2], 1e-9)), 'THE AXIS NEVER SWINGS: one direction in every month', axes[0].toArray().map((v) => v.toFixed(3)).join(' '));
  check(near(Math.acos(M.AXIS[1]) / RAD, M.TILT, 1e-6), `and it leans ${M.TILT} degrees`);
  // A big jump goes forward through the year, the way the Earth goes.
  go(172);
  const vars = new Map([['yearDay', 355]]);
  orrery.userData.tick.update(0.02, null, vars);
  const moved = Math.atan2(earth.position.x, earth.position.z) - Math.atan2(M.earthAt(172)[0], M.earthAt(172)[2]);
  check(((moved % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) < Math.PI, 'and a jump to December goes forward through the summer');
}
{
  const dir = Props.skyDirection(M.GIRARD_LATITUDE, M.declination(172), 12);
  const alt = Math.asin(dir[1]) / RAD;
  check(near(alt, M.noonHeight(M.GIRARD_LATITUDE, M.declination(172)), 1e-6), 'the bowl and the column agree on the noon Sun', `${alt.toFixed(2)} degrees`);
  check(dir[2] > 0, 'from Kansas the noon Sun is to the south, which is +Z on the bowl');
  check(Props.skyDirection(-33.9, M.declination(355), 12)[2] < 0, 'from Sydney it is to the north');
  const morning = Props.skyDirection(M.GIRARD_LATITUDE, 0, 9);
  const evening = Props.skyDirection(M.GIRARD_LATITUDE, 0, 15);
  check(morning[0] > 0 && evening[0] < 0, 'it rises in the east and sets in the west');
  const sunrise = Props.skyDirection(M.GIRARD_LATITUDE, 0, 6);
  check(near(sunrise[1], 0, 1e-9), 'at an equinox it rises at six');
  check(near(M.trueScale(1).moonDistance, 60.33, 0.01), 'a one-foot Earth has its Moon 60 feet away');
  check(near(M.trueScale(1).moonRadius, 0.273, 0.001), 'and that Moon is 0.27 feet in radius');
}

// ---------------------------------------------------------------------------
// 3. The programs, run as the chain they are in the world
// ---------------------------------------------------------------------------
console.log('\nThe programs');
{
  const worldVars = new Map();
  runBlocks(P.moonClockProgram(), { worldVars, maxSteps: 1, stopWhen: () => true });
  check(worldVars.get('orbitDays') === M.ORBIT_DAYS && worldVars.get('dayStep') === M.DAY_STEP, 'the clock shares its numbers before it waits');

  // One trip round, on a real object at the bearing the layout gives it.
  const b = M.moonBearing(M.START_DAY);
  const object3D = new THREE.Object3D();
  object3D.position.set(Math.sin(b) * M.MOON.orbit, M.MOON.y, Math.cos(b) * M.MOON.orbit);
  object3D.rotation.y = b + Math.PI / 2;
  const start = object3D.position.clone();
  const startYaw = object3D.rotation.y;
  let wrapped = 0;
  let last = M.START_DAY;
  const passes = Math.round(M.ORBIT_DAYS / M.DAY_STEP);
  const run = runBlocks(P.moonProgram(), {
    object3D, worldVars, maxSteps: passes * 3,
    stopWhen: () => {
      const now = worldVars.get('moonDay');
      if (now < last) wrapped++;
      last = now;
      return false;
    },
  });
  const worst = Math.max(...run.log.path.map((p) => Math.abs(Math.hypot(p.x, p.z) - M.MOON.orbit)));
  check(worst < M.MOON.orbit * 0.01, 'the Moon stays on its orbit', `${worst.toFixed(2)} ft off at most`);
  check(start.distanceTo(object3D.position) < M.MOON.orbit * 0.02, 'and comes back to where it started after one orbit', `${start.distanceTo(object3D.position).toFixed(2)} ft`);
  check(near(object3D.rotation.y - startYaw, Math.PI * 2, 0.02), 'having turned exactly once, so one face stays toward us', `${((object3D.rotation.y - startYaw) / RAD).toFixed(1)} degrees`);
  check(wrapped === 1 && near(worldVars.get('moonDay'), M.START_DAY, 0.2), 'and the day has come round', worldVars.get('moonDay').toFixed(2));
  check(!run.log.problems.length, 'with no warnings', run.log.problems[0] || '');
  // Faster gets round in fewer steps: Activity 1.
  const fastVars = new Map([['orbitDays', M.ORBIT_DAYS], ['dayStep', 0.2]]);
  const fast = new THREE.Object3D();
  fast.position.copy(start);
  fast.rotation.y = startYaw;
  runBlocks(P.moonProgram(), { object3D: fast, worldVars: fastVars, maxSteps: Math.round(M.ORBIT_DAYS / 0.2) * 3 });
  check(start.distanceTo(fast.position) < M.MOON.orbit * 0.05, 'activity 1: at 0.2 it goes round in a quarter of the steps');
  // Activity 2: with no rotate block it leaves in a straight line.
  const noTurn = P.moonProgram().map((block) => (block.type === 'forever' ? { ...block, children: block.children.filter((c) => c.type !== 'rotate') } : block));
  const lost = new THREE.Object3D();
  lost.position.copy(start);
  lost.rotation.y = startYaw;
  runBlocks(noTurn, { object3D: lost, worldVars: new Map(worldVars), maxSteps: 900 });
  check(Math.hypot(lost.position.x, lost.position.z) > M.MOON.orbit * 1.5, 'activity 2: without rotate it flies off', `${Math.hypot(lost.position.x, lost.position.z).toFixed(0)} ft out`);

  // The clock names every phase in order.
  const clockVars = new Map([['moonDay', 0]]);
  const names = [];
  let d = 0;
  const clock = runBlocks(P.moonClockProgram(), {
    worldVars: clockVars,
    maxSteps: 6000,
    stopWhen: (log) => {
      d += 0.02;
      clockVars.set('moonDay', d % M.ORBIT_DAYS);
      if (log.says.length > names.length) names.push(log.says.at(-1));
      return names.length >= 9;
    },
  });
  const order = names.slice(0, 8).map((s) => s.replace(/^Day \d+: /, ''));
  check(order.join('|') === M.PHASES.map((p) => p.name.toLowerCase()).join('|'), 'the clock names the phases in order', order.join(', '));
  check(!clock.log.problems.length, 'with no warnings', clock.log.problems[0] || '');
}

function sky(yearDay, latitude, { guarded = false } = {}) {
  const worldVars = new Map();
  runBlocks(P.seasonDialProgram({ yearDay, latitude }), { worldVars });
  const object3D = new THREE.Object3D();
  const run = runBlocks(P.daylightProgram({ guarded }), { worldVars, object3D, maxSteps: 400, stopWhen: (log) => log.says.length >= 1 });
  return { worldVars, said: run.log.says[0], problems: run.log.problems, column: object3D.position.y };
}
{
  for (const { name, yearDay } of M.KEY_DAYS) {
    const dec = M.declination(yearDay);
    const noon = M.noonHeight(M.GIRARD_LATITUDE, dec);
    const hours = M.dayLength(M.GIRARD_LATITUDE, dec);
    const r = sky(yearDay, M.GIRARD_LATITUDE);
    check(near(r.worldVars.get('noon'), noon, 1e-6), `${name} at Girard: noon Sun ${noon.toFixed(1)} degrees`);
    check(near(r.worldVars.get('dayLength'), hours, 1e-6), `${name} at Girard: ${hours.toFixed(1)} hours`);
    check(near(r.column, hours * M.GAUGE.feetPerHour, 1e-6), `${name}: the column stands at the reading`, `${r.column.toFixed(2)} ft`);
    check(r.said === `Day ${yearDay}, latitude ${formatValue(M.GIRARD_LATITUDE)}: noon Sun ${Math.round(noon)} degrees up, ${formatValue(Math.round(hours * 10) / 10)} hours of daylight.`, `${name}: the column says it`, r.said);
    check(!r.problems.length, `${name}: no warnings`);
  }
  for (const latitude of [0, -33.9]) {
    for (const yearDay of [172, 355]) {
      const r = sky(yearDay, latitude);
      check(near(r.worldVars.get('dayLength'), M.dayLength(latitude, M.declination(yearDay)), 1e-6) && !r.problems.length, `latitude ${latitude}, day ${yearDay}: ${r.worldVars.get('dayLength').toFixed(1)} hours`);
    }
  }
  check(sky(172, -33.9).worldVars.get('dayLength') < 12 && sky(355, -33.9).worldVars.get('dayLength') > 12, 'Sydney has its long days in December');
  // Activity 4: past the polar circle it has no answer until a student guards it.
  check(sky(172, 70).problems.some((p) => p.startsWith('math')), 'latitude 70 in June has no answer as shipped, which is the challenge');
  const june = sky(172, 70, { guarded: true });
  const december = sky(355, 70, { guarded: true });
  check(near(june.worldVars.get('dayLength'), 24, 1e-6) && !june.problems.length, 'guarded, it reads 24 hours in June');
  check(near(december.worldVars.get('dayLength'), 0, 1e-6) && !december.problems.length, 'and 0 in December');
  // Activity 5, and the chain that hears it.
  const worldVars = new Map();
  runBlocks(P.seasonDialProgram(), { worldVars });
  const cal = runBlocks(P.calendarAnswer(), { worldVars });
  check(worldVars.get('yearDay') === M.DIAL.yearDay + 365 && !cal.log.problems.length, 'the calendar on its board runs a whole year', String(worldVars.get('yearDay')));
  runBlocks(P.seasonDialProgram(), { worldVars });
  check(worldVars.get('yearDay') === M.DIAL.yearDay, "the dial's green arrow takes the day back");
}

// ---------------------------------------------------------------------------
// 4. The world
// ---------------------------------------------------------------------------
console.log('\nThe world builds');
const built = buildPresetWorldRecords('standonearth', { groundHeightAt: () => 0 });
const records = built.records;
const props = records.filter((r) => r.kind === 'preset-prop');
check(records.every((r) => !r.programJs && r.programMode !== 'js'), 'no record in this world carries JavaScript');
{
  const order = (prop) => records.findIndex((r) => r.prop === prop && r.program?.length);
  check(order('se-moon-clock') < order('se-moon'), 'the clock shares before the Moon reads');
  check(order('se-season-dial') < order('se-daylight-column'), 'the dial shares before the column reads');
  check(records.find((r) => r.prop === 'se-calendar-post') && !records.find((r) => r.prop === 'se-calendar-post').program?.length, 'the calendar has no program: writing one is the challenge');
  check(records.filter((r) => r.prop === 'activity-board').length === 5, 'five coding challenges');
  check(records.filter((r) => r.prop === 'block-board').length === 3, 'three boards showing real blocks');
  check(records.some((r) => r.kind === 'web-browser' && r.url.includes('stand-on-the-earth')), 'the kiosk opens the lesson card');
  check(built.spawn.x === 0 && built.spawn.z === 0, 'the student arrives on the North Pole');
  const out = records.filter((r) => r.transform && Math.hypot(r.transform.position[0], r.transform.position[2]) > 192);
  check(out.length === 0, 'everything is inside the world', out.map((r) => r.prop).join(', '));
  const moon = records.find((r) => r.prop === 'se-moon');
  check(near(moon.transform.position[1], M.MOON.y), 'the Moon is at its orbit height');
  check(near(Math.hypot(moon.transform.position[0], moon.transform.position[2]), M.MOON.orbit, 1e-6), 'and on its orbit');
}
{
  const theme = WORLD_THEMES.standonearth;
  check(theme.cap.radius === M.GLOBE.radius && theme.cap.height === M.GLOBE.height, 'the theme and the model agree on the globe');
  check(near(terrainHeightAt(theme, 0, 0), M.GLOBE.height), 'the pole is at the top of the dome', `${M.GLOBE.height} ft`);
  const hifiTheme = { amplitude: theme.amplitude, flatRadius: theme.flatRadius, blendRadius: theme.blendRadius, cap: theme.cap };
  let worst = 0;
  for (let x = -130; x <= 130; x += 7.3) for (let z = -130; z <= 130; z += 6.1) worst = Math.max(worst, Math.abs(terrainHeightAt(theme, x, z) - classicHeightAt(hifiTheme, x, z)));
  check(worst < 1e-9, 'both editions walk on the same dome', worst.toExponential(1));
  check(terrainHeightAt(theme, 120, 0) === 0, 'past its foot the ground is flat');
  const other = WORLD_THEMES.park;
  check(near(terrainHeightAt(other, 130, 70), classicHeightAt(other, 130, 70), 1e-9), 'and a world with no cap is unchanged');
  check(near(M.planRadiusOfLatitude(M.GIRARD_LATITUDE), 87.27, 0.01) && M.planRadiusOfLatitude(M.GIRARD_LATITUDE) < Math.sqrt(M.GLOBE.radius ** 2 - (M.GLOBE.radius - M.GLOBE.height) ** 2), 'Kansas is on the dome');
}
let triangles = 0;
let meshes = 0;
for (const r of props) {
  const object3D = buildProp(r.prop, r.options);
  object3D.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
}
console.log(`  ${props.length} props, ${meshes} meshes, ${Math.round(triangles).toLocaleString('en-US')} triangles of geometry`);
{
  const seed = new URL('../EdusimWorldDatabase/seed/worlds/standonearth.json', import.meta.url);
  if (existsSync(seed)) {
    const world = JSON.parse(readFileSync(seed, 'utf8'));
    const list = world.records || world.objects || [];
    check(list.length === records.length, 'the seeded world is this world', `${list.length} records`);
    check(list.every((r) => !r.programJs && r.programMode !== 'js'), 'the seeded world carries no JavaScript');
    const pole = list.find((r) => r.prop === 'se-moon-clock');
    check(pole.transform.position[1] > 30, 'things on the dome were grounded on the dome', `${pole.transform.position[1].toFixed(1)} ft`);
  } else {
    check(false, 'the seeded world has been exported');
  }
}

// ---------------------------------------------------------------------------
// 5. The lesson cards
// ---------------------------------------------------------------------------
console.log('\nThe lesson cards');
{
  const html = readFileSync(new URL('../EdusimWorldDatabase/lib/lessons/stand-on-the-earth.html', import.meta.url), 'utf8');
  const text = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
  check(!/javascript/i.test(text), 'the cards never mention JavaScript');
  check(html.includes('id="lc-student"') && html.includes('id="lc-teacher"'), 'a student guide and a teacher card');
  const student = html.slice(html.indexOf('id="lc-student"'), html.indexOf('id="lc-teacher"'));
  const teacher = html.slice(html.indexOf('id="lc-teacher"'));
  check(!student.includes('class="answers"'), "the student's copy holds no answer key");
  check(!/\b75\.9\b|\b14\.6\b/.test(student), "and none of the answers it asks for");
  check(teacher.includes('class="answers"') && teacher.includes('class="honest"'), 'the teacher card has the key and the honesty note');
  const said = (yearDay, latitude = M.GIRARD_LATITUDE) => {
    const dec = M.declination(yearDay);
    return { noon: Math.round(M.noonHeight(latitude, dec)), hours: Math.round(M.dayLength(latitude, dec) * 10) / 10 };
  };
  const required = [
    ...M.PHASES.map((p, i) => `${p.name.toLowerCase()} ${M.highestAt(i)}`),
    `${M.ORBIT_DAYS} days`, `${M.SIDEREAL_DAYS} days`,
    `${M.PERIHELION_MILES} million miles`, `${M.APHELION_MILES} million miles`,
    `March ${said(81).noon} degrees and ${said(81).hours} hours`,
    `June ${said(172).noon} degrees and ${said(172).hours} hours`,
    `September ${said(264).noon} degrees and ${said(264).hours} hours`,
    `December ${said(355).noon} degrees and ${said(355).hours} hours`,
    `Sydney: ${said(172, -33.9).hours} hours in June and ${said(355, -33.9).hours} in December`,
    `Equator: ${said(172, 0).hours} hours`,
    `${Math.round(M.trueScale(1).moonDistance)} feet`,
    `${M.GIRARD_LATITUDE}`,
  ];
  for (const figure of required) check(text.includes(figure), `card states ${figure}`);
  check(M.trueScale(M.GLOBE.radius).moonDistance > 5280, 'on this globe the true Moon really is over a mile away', `${Math.round(M.trueScale(M.GLOBE.radius).moonDistance)} ft`);
  for (const { name, yearDay } of M.KEY_DAYS) check(html.includes(`${yearDay} (${name})`), `the guide offers day ${yearDay} as ${name}`);
}

// ---------------------------------------------------------------------------
// 6. Open edges
// ---------------------------------------------------------------------------
function boundaryEdges(geometry, cell) {
  const pos = geometry.attributes.position;
  const key = (i) => `${Math.round(pos.getX(i) / cell)},${Math.round(pos.getY(i) / cell)},${Math.round(pos.getZ(i) / cell)}`;
  const seen2 = new Map();
  const count = geometry.index ? geometry.index.count : pos.count;
  const at = (t) => (geometry.index ? geometry.index.getX(t) : t);
  for (let t = 0; t < count; t += 3) {
    const a = key(at(t)); const b = key(at(t + 1)); const c = key(at(t + 2));
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      if (p === q) continue;
      const e = p < q ? `${p}|${q}` : `${q}|${p}`;
      seen2.set(e, (seen2.get(e) || 0) + 1);
    }
  }
  let open = 0;
  for (const v of seen2.values()) if (v === 1) open++;
  return open;
}

// [builder, baseline]. Raise a baseline ONLY after looking at the prop and confirming the change is a
// surface, not a visible hole. Non-zero entries: the shell's rim, buried at the dome's foot; the floor
// rings and printed boards, which are planes; and the bowl's open horizon wall.
const CASES = [
  ['earthShell', 128], ['floorMarks', 832], ['labSun', 0], ['moonRing', 64], ['orbitingMoon', 0], ['moonClock', 4],
  ['seasonOrrery', 96], ['skyBowl', 272], ['seasonDial', 4], ['calendarPost', 4], ['daylightColumn', 0],
  ['daylightGauge', 4], ['trueScaleEarth', 0], ['trueScaleMoon', 0],
];
console.log('\nprop                 meshes     tris   open  baseline');
for (const [name, baseline] of CASES) {
  const obj = Props[name]();
  let tris = 0; let meshCount = 0; let open = 0;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    meshCount++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    open += Math.min(boundaryEdges(g, 0.004), boundaryEdges(g, 0.0071));
  });
  const bad = open > baseline;
  if (bad) failures++;
  console.log(`${name.padEnd(20)} ${String(meshCount).padStart(5)} ${String(Math.round(tris)).padStart(8)} ${String(open).padStart(6)} ${String(baseline).padStart(9)}${bad ? '  REGRESSION' : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
