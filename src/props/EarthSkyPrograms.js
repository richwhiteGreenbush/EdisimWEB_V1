import {
  setv, calc, fn, change, share, forever, repeat, when, wait, forward, rotate, up, say, programSteps,
} from '../BlockKit.js';
import {
  ORBIT_DAYS, DAY_STEP, START_DAY, MOON, PHASES, DEGREES_TO_RADIANS, TILT, EQUINOX_DAY, DEGREES_PER_DAY,
  DIAL, GAUGE,
} from './EarthSkyModel.js';

// Stand on the Earth's programs, in blocks and nothing else. Every number a student is invited to
// change is a green block at the top, every program is run by tools/check-standonearth.mjs, and a
// builder is called once per object, because two objects must not share one tree of block ids.

// The clock owns the Moon's numbers and reads back where the Moon has got to. It waits a moment
// first, because `moonDay` does not exist until the Moon, which reads these numbers, has started.
export const moonClockProgram = ({ orbitDays = ORBIT_DAYS, dayStep = DAY_STEP } = {}) => [
  setv('orbitDays', orbitDays),
  setv('dayStep', dayStep),
  share('orbitDays'),
  share('dayStep'),
  setv('slot', -1),
  wait(0.2),
  forever(
    calc('part', 'moonDay', '/', 'orbitDays'),
    calc('part', 'part', '*', 8),
    fn('now', 'round', 'part'),
    calc('now', 'now', 'mod', 8),
    calc('gap', 'now', '-', 'slot'),
    fn('gap', 'abs', 'gap'),
    when('gap', '>', 0,
      setv('slot', 'now'),
      fn('day', 'round', 'moonDay'),
      ...PHASES.map((phase, i) => when('now', '=', i, say(`Day {day}: ${phase.name.toLowerCase()}`)))),
    wait(0.1),
  ),
];

// One trip round is `rotate` and `move forward`, over and over. Nothing here points the Moon at the
// Earth: turning once per orbit is what keeps one face toward the middle, and that is the lesson.
export const moonProgram = ({ orbit = MOON.orbit, startDay = START_DAY } = {}) => [
  setv('orbit', orbit),
  setv('moonDay', startDay),
  share('moonDay'),
  forever(
    calc('turn', 360, '/', 'orbitDays'),
    calc('turn', 'turn', '*', 'dayStep'),
    calc('step', 'turn', '*', DEGREES_TO_RADIANS),
    calc('step', 'step', '*', 'orbit'),
    change('moonDay', 'dayStep'),
    when('moonDay', '>=', 'orbitDays', calc('moonDay', 'moonDay', '-', 'orbitDays')),
    share('moonDay'),
    forward('step'),
    rotate('turn'),
  ),
];

// The dial owns the day and the place. It runs once and stops, so a program on the calendar can take
// over `yearDay` simply by sharing a newer one, and the dial's green arrow takes it back.
export const seasonDialProgram = ({ yearDay = DIAL.yearDay, latitude = DIAL.latitude } = {}) => [
  setv('yearDay', yearDay),
  setv('latitude', latitude),
  share('yearDay'),
  share('latitude'),
];

// The daylight column reads the day and the place and works out the sky. It ships WITHOUT a guard on
// the cosine, on purpose: past the polar circles it asks for an arccosine that has no answer, and
// putting that right is a challenge. `guarded` is that challenge's answer, for the check tool.
export const daylightProgram = ({ guarded = false } = {}) => [
  setv('feetPerHour', GAUGE.feetPerHour),
  setv('level', 0),
  setv('hour', 6),
  setv('lastDay', -1),
  setv('lastPlace', -1000),
  forever(
    calc('a', 'yearDay', '-', EQUINOX_DAY),
    calc('a', 'a', '*', DEGREES_PER_DAY),
    fn('s', 'sin', 'a'),
    calc('declination', 's', '*', TILT),
    calc('gap', 'latitude', '-', 'declination'),
    fn('gap', 'abs', 'gap'),
    calc('noon', 90, '-', 'gap'),
    fn('tanLat', 'tan', 'latitude'),
    fn('tanDec', 'tan', 'declination'),
    calc('x', 'tanLat', '*', 'tanDec'),
    calc('x', 'x', '*', -1),
    ...(guarded ? [when('x', '<', -1, setv('x', -1)), when('x', '>', 1, setv('x', 1))] : []),
    fn('angle', 'acos', 'x'),
    calc('dayLength', 'angle', '/', 7.5),
    change('hour', 0.04),
    when('hour', '>=', 24, setv('hour', 0)),
    share('declination'),
    share('noon'),
    share('dayLength'),
    share('hour'),
    calc('goal', 'dayLength', '*', 'feetPerHour'),
    calc('dy', 'goal', '-', 'level'),
    up('dy'),
    setv('level', 'goal'),
    calc('dayGap', 'yearDay', '-', 'lastDay'),
    fn('dayGap', 'abs', 'dayGap'),
    calc('placeGap', 'latitude', '-', 'lastPlace'),
    fn('placeGap', 'abs', 'placeGap'),
    calc('changed', 'dayGap', '+', 'placeGap'),
    when('changed', '>', 0,
      setv('lastDay', 'yearDay'),
      setv('lastPlace', 'latitude'),
      fn('sayNoon', 'round', 'noon'),
      calc('sayHours', 'dayLength', '*', 10),
      fn('sayHours', 'round', 'sayHours'),
      calc('sayHours', 'sayHours', '/', 10),
      say('Day {yearDay}, latitude {latitude}: noon Sun {sayNoon} degrees up, {sayHours} hours of daylight.')),
  ),
];

// Challenge 5, exactly as its board has it.
export const calendarAnswer = () => [
  repeat(365,
    change('yearDay', 1),
    share('yearDay'),
    wait(0.05)),
];

// --- What the boards show, off the real blocks --------------------------------
export const BOARD_STEPS = {
  moon: () => programSteps([
    calc('turn', 360, '/', 'orbitDays'),
    calc('turn', 'turn', '*', 'dayStep'),
    calc('step', 'turn', '*', DEGREES_TO_RADIANS),
    calc('step', 'step', '*', 'orbit'),
    forward('step'),
    rotate('turn'),
  ]),
  clock: () => programSteps(moonClockProgram().slice(0, 4)),
  dial: () => programSteps(seasonDialProgram()),
  sky: () => programSteps([
    calc('a', 'yearDay', '-', EQUINOX_DAY),
    calc('a', 'a', '*', DEGREES_PER_DAY),
    fn('s', 'sin', 'a'),
    calc('declination', 's', '*', TILT),
    calc('gap', 'latitude', '-', 'declination'),
    fn('gap', 'abs', 'gap'),
    calc('noon', 90, '-', 'gap'),
  ]),
};
