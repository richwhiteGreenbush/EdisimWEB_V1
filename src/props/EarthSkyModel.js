// Stand on the Earth -- every astronomy figure in the world, in one place.
//
// The same rule as AtomModel.js and MidwayModel.js: ONE TABLE feeds the props, the boards, the
// programs that ship running and the check tool, and tools/check-standonearth.mjs holds the printed
// lesson cards to the same numbers, because that page is static HTML.
//
// Pure arithmetic: this file imports nothing and builds no geometry, so it runs in node.
//
// BEARINGS ARE THE ONES rotation.y USES: a bearing b points along (sin b, cos b) in (x, z), and a
// larger bearing is further COUNTER-CLOCKWISE seen from above the North Pole, which is the way the
// Moon goes round and the way the Earth turns. That is why every angle below simply adds.

const RAD = Math.PI / 180;

// --- The globe the student stands on ----------------------------------------
export const GLOBE = { radius: 110, height: 44 };
export const EYE = 5;
export const POLE_EYE_Y = GLOBE.height + EYE;

// How far from the pole, in plan, a latitude lands on the dome.
export const planRadiusOfLatitude = (latitude) => GLOBE.radius * Math.cos(latitude * RAD);

// The Sun is toward -Z. Everything about the lab is measured from that bearing.
export const SUN_BEARING = Math.PI;
// What LIGHTS things sits nearly in the Moon's orbit plane, so a new moon is really dark and a full
// moon really full. Where the Sun is DRAWN is higher, so the moving Moon passes under it rather than
// eclipsing it every month, which is what the real Moon's tilted orbit does.
export const SUN_LIGHT_ELEVATION = 4.5;
export const SUN_DRAWN_ELEVATION = 14;
export const SUN_PROP = { distance: 185, radius: 14 };

export function sunLightDirection() {
  const e = SUN_LIGHT_ELEVATION * RAD;
  return [Math.sin(SUN_BEARING) * Math.cos(e), Math.sin(e), Math.cos(SUN_BEARING) * Math.cos(e)];
}

// Longitude -95 lies under the Sun's bearing, so it is noon in Kansas.
export const NOON_LONGITUDE = -95;
export const bearingOfLongitude = (longitude) => SUN_BEARING + (longitude - NOON_LONGITUDE) * RAD;

// Local time at a place `degrees` counter-clockwise from the Sun: east of noon is later.
export const clockHours = (degrees) => (12 + degrees / 15) % 24;
export function clockLabel(hours) {
  const h = ((hours % 24) + 24) % 24;
  if (h === 0) return 'MIDNIGHT';
  if (h === 12) return 'NOON';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// --- The Moon -------------------------------------------------------------
// The cycle of phases is 29.5 days. This lab's Sun does not move, so that is what one trip round
// takes here; the real Moon makes the trip in 27.3 days and needs two more to catch up, because the
// Earth has moved on round the Sun. Both are stated on a placard and on the teacher's card.
export const ORBIT_DAYS = 29.5;
export const SIDEREAL_DAYS = 27.3;
export const DAY_STEP = 0.05; // moon days per pass of its program
export const START_DAY = 5;
export const DEGREES_TO_RADIANS = 0.01745;

export const MOON = { orbit: 160, y: 62, radius: 13 };
export const STATION = { orbit: 130, y: 26, radius: 10 };

export const PHASES = [
  { name: 'New moon', day: 0, lit: 'none' },
  { name: 'Waxing crescent', day: 3.7, lit: 'right' },
  { name: 'First quarter', day: 7.4, lit: 'right' },
  { name: 'Waxing gibbous', day: 11.1, lit: 'right' },
  { name: 'Full moon', day: 14.8, lit: 'all' },
  { name: 'Waning gibbous', day: 18.4, lit: 'left' },
  { name: 'Last quarter', day: 22.1, lit: 'left' },
  { name: 'Waning crescent', day: 25.8, lit: 'left' },
];

export const moonDegrees = (day, orbitDays = ORBIT_DAYS) => (360 * day) / orbitDays;
export const moonBearing = (day, orbitDays = ORBIT_DAYS) => SUN_BEARING + moonDegrees(day, orbitDays) * RAD;
export const stationBearing = (index) => SUN_BEARING + index * 45 * RAD;

// The fraction of the disc that looks lit from Earth.
export const litFraction = (day, orbitDays = ORBIT_DAYS) => (1 - Math.cos(moonDegrees(day, orbitDays) * RAD)) / 2;

export function phaseSlot(day, orbitDays = ORBIT_DAYS) {
  return Math.round((8 * day) / orbitDays) % 8;
}

// What the shared hour on the printed Earth is when each phase stands highest.
export const highestAt = (index) => clockLabel(clockHours(index * 45));

// --- The seasons ----------------------------------------------------------
export const TILT = 23.44;
export const YEAR_DAYS = 365;
export const DEGREES_PER_DAY = 0.9863; // 360 / 365, as a block can hold it
export const EQUINOX_DAY = 81;
export const SOLSTICE_DAYS = { june: 172, december: 355 };
export const KEY_DAYS = [
  { name: 'March', yearDay: 81 },
  { name: 'June', yearDay: 172 },
  { name: 'September', yearDay: 264 },
  { name: 'December', yearDay: 355 },
];
export const GIRARD_LATITUDE = 37.5;

export const declination = (yearDay) => TILT * Math.sin((yearDay - EQUINOX_DAY) * DEGREES_PER_DAY * RAD);
export const noonHeight = (latitude, dec) => 90 - Math.abs(latitude - dec);

// Hours of daylight, with the Sun's centre as the edge and no bending of light by the air. Past the
// polar circles the cosine leaves -1..1, and that is the Sun never setting or never rising.
export function dayLength(latitude, dec) {
  const x = -Math.tan(latitude * RAD) * Math.tan(dec * RAD);
  return Math.acos(Math.max(-1, Math.min(1, x))) / RAD / 7.5;
}

export const DIAL = { yearDay: SOLSTICE_DAYS.june, latitude: GIRARD_LATITUDE };
export const GAUGE = { feetPerHour: 1.25, hours: 24 };

// The orbit in the season hall. The axis leans toward +X and stays leaning there all year, so the
// Earth stands on the -X side of the lamp in June with its north tipped toward it. The orbit's true
// shape is kept: the lamp is off-centre by the real eccentricity, toward where the Earth is in early
// January, and it comes to about seven inches on a 34ft orbit. That is the point.
export const ORRERY = { orbit: 34, y: 9, lampRadius: 5, earthRadius: 6, eccentricity: 0.0167 };
export const AXIS = (() => {
  const t = TILT * RAD;
  return [Math.sin(t), Math.cos(t), 0];
})();

export function orreryDegrees(yearDay) {
  return ((yearDay - SOLSTICE_DAYS.june) / YEAR_DAYS) * 360;
}

// Earth's centre in the orrery's own frame. A bearing of -90 degrees is -X, where June is.
export function earthAt(yearDay) {
  const b = (orreryDegrees(yearDay) - 90) * RAD;
  return [Math.sin(b) * ORRERY.orbit, ORRERY.y, Math.cos(b) * ORRERY.orbit];
}

// The lamp sits at a focus, toward January: the Sun is not at the centre of the Earth's orbit.
export function lampAt() {
  const b = (orreryDegrees(PERIHELION_DAY) - 90) * RAD;
  const off = ORRERY.orbit * ORRERY.eccentricity;
  return [Math.sin(b) * off, ORRERY.y, Math.cos(b) * off];
}

// Where the lamp stands overhead on the season globe, measured off the model's real geometry.
export function subLampLatitude(yearDay) {
  const e = earthAt(yearDay);
  const l = lampAt();
  const d = [l[0] - e[0], l[1] - e[1], l[2] - e[2]];
  const n = Math.hypot(...d);
  return Math.asin((d[0] * AXIS[0] + d[1] * AXIS[1] + d[2] * AXIS[2]) / n) / RAD;
}

export const PERIHELION_DAY = 3;
export const APHELION_DAY = 185;
export const PERIHELION_MILES = 91.4; // millions
export const APHELION_MILES = 94.5;

// --- True scale -----------------------------------------------------------
export const MILES = { earthRadius: 3959, moonRadius: 1080, moonDistance: 238855, sunRadius: 432690, sunDistance: 92960000 };
export const trueScale = (earthFeet) => {
  const k = earthFeet / MILES.earthRadius;
  return {
    moonRadius: MILES.moonRadius * k,
    moonDistance: MILES.moonDistance * k,
    sunRadius: MILES.sunRadius * k,
    sunDistance: MILES.sunDistance * k,
  };
};
