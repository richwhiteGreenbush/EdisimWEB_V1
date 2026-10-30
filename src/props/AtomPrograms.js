import {
  setv, calc, fn, random, share, forever, when, up, both, say, programSteps,
} from '../BlockKit.js';
import {
  THERMOSTAT, SPEED_PER_ROOT_KELVIN, GAUGE, SOLID, LIQUID, GAS, TREND_RADIUS, TREND_EN,
} from './AtomModel.js';

// Atom Hall's programs, in blocks and nothing else. Every number a student is invited to change is
// a green block at the top, every program is run by tools/check-atomhall.mjs, and a builder is
// called once per object, because two objects must not share one tree of block ids.

// The two buttons at each corner of the table. They wait for a green play button rather than
// running on load, and the skyline reads `trend` through its own tick.
export const trendProgram = (trend) => [
  setv('trend', trend),
  share('trend'),
  say(trend === TREND_EN ? 'Tall towers hold on to electrons hardest.' : 'Tall towers are the biggest atoms.'),
];

export const radiusButton = () => trendProgram(TREND_RADIUS);
export const electronegativityButton = () => trendProgram(TREND_EN);

// The thermostat owns the numbers. It runs once and stops, so a program a student writes on the
// burner can take over `temperature` simply by sharing a newer value.
export const thermostatProgram = ({
  temperature = THERMOSTAT.temperature, melts = THERMOSTAT.melts, boils = THERMOSTAT.boils,
} = {}) => [
  setv('temperature', temperature),
  setv('melts', melts),
  setv('boils', boils),
  when('temperature', '<', 0,
    say('Nothing can be colder than 0 K. Using 0.'),
    setv('temperature', 0)),
  share('temperature'),
  share('melts'),
  share('boils'),
];

// The thermometer reads whatever temperature is shared, and works out what the particles need:
// the one place in the world where temperature turns into speed.
export const thermometerProgram = () => [
  setv('full', GAUGE.full),
  setv('topK', GAUGE.topKelvin),
  setv('level', 0),
  setv('last', -1),
  forever(
    calc('t', 'temperature', 'max', 0),
    fn('root', 'sqrt', 't'),
    calc('speed', 'root', '*', SPEED_PER_ROOT_KELVIN),
    setv('state', GAS),
    when('t', '<', 'boils', setv('state', LIQUID)),
    when('t', '<', 'melts', setv('state', SOLID)),
    share('speed'),
    share('state'),
    calc('part', 't', 'min', 'topK'),
    calc('part', 'part', '/', 'topK'),
    calc('goal', 'part', '*', 'full'),
    calc('dy', 'goal', '-', 'level'),
    up('dy'),
    setv('level', 'goal'),
    calc('gap', 't', '-', 'last'),
    fn('gap', 'abs', 'gap'),
    when('gap', '>', 0,
      setv('last', 't'),
      when('state', '=', SOLID, say('{t} K: solid. Speed {speed} ft per step.')),
      when('state', '=', LIQUID, say('{t} K: liquid. Speed {speed} ft per step.')),
      when('state', '=', GAS, say('{t} K: gas. Speed {speed} ft per step.'))),
  ),
];

// One particle. It knows nothing about temperature, only `speed` and `state`. Its walls are
// measured from where it stands in the crystal, because x and y here are its distance from home.
export const particleProgram = ({ left, right, floor, roof, surface }) => [
  setv('left', left),
  setv('right', right),
  setv('floor', floor),
  setv('roof', roof),
  setv('surface', surface),
  setv('x', 0),
  setv('y', 0),
  random('angle', 0, 360),
  fn('vx', 'cos', 'angle'),
  fn('vy', 'sin', 'angle'),
  forever(
    when('state', '=', SOLID,
      calc('shake', 'speed', '*', 0.4),
      calc('low', 'shake', '*', -1),
      random('jx', 'low', 'shake'),
      random('jy', 'low', 'shake'),
      calc('dx', 'x', '*', -0.2),
      calc('dy', 'y', '*', -0.2),
      calc('dx', 'dx', '+', 'jx'),
      calc('dy', 'dy', '+', 'jy')),
    when('state', '>=', LIQUID,
      setv('top', 'roof'),
      when('state', '=', LIQUID, setv('top', 'surface')),
      when('x', '>', 'right', fn('vx', 'abs', 'vx'), calc('vx', 'vx', '*', -1)),
      when('x', '<', 'left', fn('vx', 'abs', 'vx')),
      when('y', '>', 'top', fn('vy', 'abs', 'vy'), calc('vy', 'vy', '*', -1)),
      when('y', '<', 'floor', fn('vy', 'abs', 'vy')),
      calc('dx', 'vx', '*', 'speed'),
      calc('dy', 'vy', '*', 'speed')),
    calc('x', 'x', '+', 'dx'),
    calc('y', 'y', '+', 'dy'),
    both('dx', 'dy'),
  ),
];

// --- What the boards show, off the real blocks --------------------------------
export const BOARD_STEPS = {
  trend: () => programSteps(trendProgram(TREND_EN).slice(0, 2)),
  thermostat: () => programSteps(thermostatProgram().filter((b) => b.type !== 'ifCompare')),
  law: () => programSteps([
    calc('t', 'temperature', 'max', 0),
    fn('root', 'sqrt', 't'),
    calc('speed', 'root', '*', SPEED_PER_ROOT_KELVIN),
    setv('state', GAS),
    when('t', '<', 'boils', setv('state', LIQUID)),
    when('t', '<', 'melts', setv('state', SOLID)),
    share('speed'),
    share('state'),
  ]),
  particle: () => programSteps([
    forever(
      when('state', '=', SOLID,
        calc('dx', 'x', '*', -0.2),
        calc('dx', 'dx', '+', 'jx')),
      when('state', '>=', LIQUID,
        setv('top', 'roof'),
        when('state', '=', LIQUID, setv('top', 'surface')),
        calc('dx', 'vx', '*', 'speed')),
      both('dx', 'dy'),
    ),
  ]),
};
