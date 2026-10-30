import {
  setv, change, calc, fn, share, readout, forever, until, when, whenSaid, wait, forward, up, both,
  rotate, tilt, goHome, say, size, markerColor, markerDown, markerUp, programSteps,
} from '../BlockKit.js';
import {
  G, DT, DROP, CANNON, TRACK, COASTER, BUMPER, PENDULUM, SWING,
} from './MidwayModel.js';

// Newton's Midway's programs, all in blocks. Each one is a physics model a student can open: the
// green blocks at the top are its assumptions and the loop under them steps time by `dt`. Builders
// rather than constants, because two objects must not share one tree of block ids.
//
// tools/check-midway.mjs runs every one through the real block runner and compares what it says
// with MidwayModel.js, so nothing here has to be taken on trust.

// --- Station 1 -------------------------------------------------------------
// Rides up, then falls. The lift is deliberately not physics: it is what lets a student change the
// height and have the car really start from there.
export const dropProgram = ({ height = DROP.height, g = G, dt = DT } = {}) => [
  setv('height', height),
  setv('g', g),
  setv('dt', dt),
  forever(
    setv('y', 0),
    until('y', '>=', 'height', up(0.1), change('y', 0.1)),
    // The lift stops within one step of the height. The drop starts from the number exactly.
    setv('y', 'height'),
    wait(1),
    setv('v', 0),
    setv('t', 0),
    until('y', '<=', 0,
      calc('dv', 'g', '*', 'dt'),
      calc('v', 'v', '-', 'dv'),
      calc('dy', 'v', '*', 'dt'),
      calc('y', 'y', '+', 'dy'),
      change('t', 'dt'),
      up('dy')),
    readout('fell for', 't', 's'),
    wait(2.5),
    fn('speed', 'abs', 'v'),
    readout('hit the bottom at', 'speed', 'm/s'),
    wait(2.5),
    goHome(),
  ),
];

// --- Station 2 -------------------------------------------------------------
// One shot per run rather than a loop, and that is deliberate: the arc is left in the air, so a
// second shot at a new angle draws beside the first and the two can be compared. The green arrow
// is the trigger. A loop would also fill the world's marker budget inside one lesson.
export const cannonProgram = ({ speed = CANNON.speed, angle = CANNON.angle, g = G, dt = DT, ink = '#e0452e' } = {}) => [
  setv('speed', speed),
  setv('angle', angle),
  share('angle'),
  setv('g', g),
  setv('dt', dt),
  fn('cosA', 'cos', 'angle'),
  fn('sinA', 'sin', 'angle'),
  calc('vx', 'speed', '*', 'cosA'),
  calc('vy', 'speed', '*', 'sinA'),
  setv('x', 0),
  setv('y', 0),
  setv('t', 0),
  setv('top', 0),
  setv('landed', 0),
  markerColor(ink),
  markerDown(),
  until('landed', '=', 1,
    calc('dv', 'g', '*', 'dt'),
    calc('vy', 'vy', '-', 'dv'),
    calc('dx', 'vx', '*', 'dt'),
    calc('dy', 'vy', '*', 'dt'),
    change('x', 'dx'),
    change('y', 'dy'),
    change('t', 'dt'),
    calc('top', 'top', 'max', 'y'),
    both('dx', 'dy'),
    when('y', '<=', 0, setv('landed', 1))),
  markerUp(),
  readout('range', 'x', 'm'),
  wait(3),
  readout('in the air for', 't', 's'),
  wait(3),
  readout('highest point', 'top', 'm'),
];

// The barrel only ever does what the shot's own `angle` says.
export const barrelProgram = () => [
  forever(tilt('angle')),
];

// --- Station 3 -------------------------------------------------------------
export const trackProgram = ({ force = TRACK.force, mass, mu = 0, g = G, dt = DT, length = TRACK.length } = {}) => [
  setv('force', force),
  setv('mass', mass),
  setv('mu', mu),
  setv('g', g),
  setv('dt', dt),
  setv('length', length),
  calc('weight', 'mass', '*', 'g'),
  calc('friction', 'mu', '*', 'weight'),
  calc('net', 'force', '-', 'friction'),
  calc('a', 'net', '/', 'mass'),
  forever(
    wait(1.5),
    when('a', '<=', 0,
      say('Friction is too strong. This cart cannot move.'),
      wait(5)),
    when('a', '>', 0,
      setv('x', 0),
      setv('v', 0),
      setv('t', 0),
      until('x', '>=', 'length',
        calc('dv', 'a', '*', 'dt'),
        change('v', 'dv'),
        calc('dx', 'v', '*', 'dt'),
        change('x', 'dx'),
        change('t', 'dt'),
        forward('dx')),
      readout('time', 't', 's'),
      wait(3),
      readout('final speed', 'v', 'm/s'),
      wait(3),
      goHome()),
  ),
];

// --- Station 4 -------------------------------------------------------------
// The car's speed comes from its ENERGY: height sets the potential energy, friction takes its
// share as heat, and whatever is left of the total is motion.
export const coasterProgram = ({
  height = COASTER.height, slope = COASTER.slope, mass = COASTER.mass, mu = COASTER.mu, g = G, dt = DT,
} = {}) => [
  setv('height', height),
  setv('slope', slope),
  setv('mass', mass),
  setv('mu', mu),
  setv('g', g),
  setv('dt', dt),
  calc('weight', 'mass', '*', 'g'),
  calc('total', 'weight', '*', 'height'),
  share('total'),
  fn('sinS', 'sin', 'slope'),
  fn('cosS', 'cos', 'slope'),
  calc('rub', 'mu', '*', 'weight'),
  calc('rub', 'rub', '*', 'cosS'),
  forever(
    // The chain lift: backward up the slope it is about to roll down, which is why changing the
    // height really does change where it starts. It lives at the bottom of the V.
    setv('y', 0),
    setv('heat', 0),
    setv('KE', 0),
    setv('PE', 0),
    share('heat'),
    share('KE'),
    share('PE'),
    setv('liftY', 0.1),
    calc('liftX', 0.1, '/', 'sinS'),
    calc('liftX', 'liftX', '*', 'cosS'),
    calc('liftX', 0, '-', 'liftX'),
    until('y', '>=', 'height',
      both('liftX', 'liftY'),
      change('y', 'liftY'),
      calc('PE', 'weight', '*', 'y'),
      share('PE')),
    setv('y', 'height'),
    setv('PE', 'total'),
    share('PE'),
    wait(1),
    setv('side', -1),
    setv('ds', 0.01),
    setv('rolling', 1),
    setv('best', 0),
    until('rolling', '=', 0,
      calc('dy', 'ds', '*', 'sinS'),
      calc('dy', 'dy', '*', 'side'),
      calc('dx', 'ds', '*', 'cosS'),
      change('y', 'dy'),
      calc('lost', 'rub', '*', 'ds'),
      change('heat', 'lost'),
      // At the bottom of the V it stops going down, by exactly as much as it overshot.
      when('side', '<', 0,
        when('y', '<=', 0,
          setv('side', 1),
          calc('dy', 'dy', '-', 'y'),
          setv('y', 0))),
      calc('PE', 'weight', '*', 'y'),
      calc('KE', 'total', '-', 'PE'),
      calc('KE', 'KE', '-', 'heat'),
      share('PE'),
      share('KE'),
      share('heat'),
      when('KE', '<=', 0, setv('rolling', 0)),
      when('KE', '>', 0,
        calc('v2', 'KE', '*', 2),
        calc('v2', 'v2', '/', 'mass'),
        fn('v', 'sqrt', 'v2'),
        calc('best', 'best', 'max', 'v'),
        calc('ds', 'v', '*', 'dt')),
      both('dx', 'dy')),
    readout('top speed', 'best', 'm/s'),
    wait(3),
    readout('climbed back to', 'y', 'm'),
    wait(3),
    goHome(),
  ),
];

// A bar standing in the ground, raised by exactly the height its share of the energy calls for.
export const energyBarProgram = ({ name, fullHeight }) => [
  setv('full', fullHeight),
  setv('level', 0),
  forever(
    calc('part', name, '/', 'total'),
    calc('goal', 'part', '*', 'full'),
    calc('dy', 'goal', '-', 'level'),
    up('dy'),
    setv('level', 'goal'),
  ),
];

// --- Station 5 -------------------------------------------------------------
// The scoreboard owns the numbers. A student changes them in ONE place and both cars read the
// answers, which is what `share` is for.
export const bumperControlProgram = ({
  m1 = BUMPER.m1, m2 = BUMPER.m2, u1 = BUMPER.u1, u2 = BUMPER.u2, e = BUMPER.e,
} = {}) => [
  setv('m1', m1),
  setv('m2', m2),
  setv('u1', u1),
  setv('u2', u2),
  setv('e', e),
  // Momentum along the line from car A toward car B, so car B's speed toward A counts against.
  calc('pA', 'm1', '*', 'u1'),
  calc('pB', 'm2', '*', 'u2'),
  calc('before', 'pA', '-', 'pB'),
  calc('closing', 'u1', '+', 'u2'),
  calc('bounce', 'e', '*', 'closing'),
  calc('sum', 'm1', '+', 'm2'),
  calc('kickA', 'm2', '*', 'bounce'),
  calc('kickB', 'm1', '*', 'bounce'),
  calc('v1', 'before', '-', 'kickA'),
  calc('v1', 'v1', '/', 'sum'),
  calc('v2', 'before', '+', 'kickB'),
  calc('v2', 'v2', '/', 'sum'),
  calc('pA2', 'm1', '*', 'v1'),
  calc('pB2', 'm2', '*', 'v2'),
  calc('after', 'pA2', '+', 'pB2'),
  setv('gap', BUMPER.start - BUMPER.carLength),
  calc('tHit', 'gap', '/', 'closing'),
  share('u1'),
  share('u2'),
  share('v1'),
  share('v2'),
  share('tHit'),
  forever(
    say('go'),
    wait(2),
    readout('momentum before', 'before', 'kg m/s'),
    wait(4),
    readout('momentum after', 'after', 'kg m/s'),
    wait(4),
    readout('car A leaves at', 'v1', 'm/s'),
    wait(4),
    readout('car B leaves at', 'v2', 'm/s'),
    wait(6),
  ),
];

const bumperRun = (approach, leave, leaveSign) => [
  setv('dt', DT),
  whenSaid('go',
    setv('t', 0),
    until('t', '>=', 'tHit',
      calc('dx', approach, '*', 'dt'),
      forward('dx'),
      change('t', 'dt')),
    setv('t', 0),
    until('t', '>=', 3,
      calc('dx', leave, '*', 'dt'),
      calc('dx', 'dx', '*', leaveSign),
      forward('dx'),
      change('t', 'dt')),
    wait(5),
    goHome()),
];

// Car A faces B, so along the line its own forward is positive and its v1 reads straight through.
export const bumperCarA = () => bumperRun('u1', 'v1', 1);
// Car B faces A, so moving away from A along the line is backward for it.
export const bumperCarB = () => bumperRun('u2', 'v2', -1);

// --- Station 6 -------------------------------------------------------------
export const pendulumProgram = ({
  length = PENDULUM.length, angle = PENDULUM.angle, g = G, dt = PENDULUM.dt,
} = {}) => [
  setv('length', length),
  setv('angle', angle),
  setv('g', g),
  setv('dt', dt),
  setv('swing', 0),
  setv('t', 0),
  setv('seen', 0),
  // The arm is built 12 long, so a new length shows as a new size.
  calc('armSize', 'length', '/', 12),
  calc('armSize', 'armSize', '*', 100),
  size('armSize'),
  calc('pull', 'g', '/', 'length'),
  calc('pull', 'pull', '*', 57.3),
  forever(
    setv('was', 'swing'),
    fn('s', 'sin', 'angle'),
    calc('accel', 'pull', '*', 's'),
    calc('dw', 'accel', '*', 'dt'),
    calc('swing', 'swing', '-', 'dw'),
    calc('da', 'swing', '*', 'dt'),
    change('angle', 'da'),
    change('t', 'dt'),
    tilt('angle'),
    // Reversing at the same side marks one whole swing. The first reversal is only half a swing
    // from where it was let go, so that one starts the clock rather than reporting it.
    when('was', '<', 0,
      when('swing', '>=', 0,
        when('seen', '=', 1, readout('one full swing:', 't', 's')),
        setv('seen', 1),
        setv('t', 0))),
  ),
];

// The hub works out the lean and the turn, and every chair reads both. Lean comes from cos(angle)
// = g / (w^2 L), the conical pendulum: the only thing holding a chair up and in is its chain.
export const swingHubProgram = ({ length = SWING.length, period = SWING.period, g = G } = {}) => [
  setv('length', length),
  setv('period', period),
  setv('g', g),
  setv('dt', 0.05),
  setv('clock', 0),
  calc('w', 6.2832, '/', 'period'),
  fn('w2', 'square', 'w'),
  calc('need', 'w2', '*', 'length'),
  calc('c', 'g', '/', 'need'),
  // Slower than this and the chain simply hangs straight down.
  calc('c', 'c', 'min', 1),
  fn('lean', 'acos', 'c'),
  calc('turn', 360, '/', 'period'),
  calc('turn', 'turn', '*', 'dt'),
  share('lean'),
  share('turn'),
  readout('the chains lean', 'lean', 'degrees'),
  forever(
    rotate('turn'),
    change('clock', 'dt'),
    when('clock', '>=', 8,
      readout('the chains lean', 'lean', 'degrees'),
      setv('clock', 0)),
  ),
];

export const swingChairProgram = () => [
  forever(tilt('lean'), rotate('turn')),
];

export const wheelProgram = () => [
  setv('turning', 0),
  forever(change('turning', 0.2), tilt('turning')),
];

// --- What the boards show, off the real blocks --------------------------------
const excerpt = (blocks) => programSteps(blocks);

export const BOARD_STEPS = {
  drop: () => excerpt([
    setv('g', G),
    setv('dt', DT),
    until('y', '<=', 0,
      calc('dv', 'g', '*', 'dt'),
      calc('v', 'v', '-', 'dv'),
      calc('dy', 'v', '*', 'dt'),
      calc('y', 'y', '+', 'dy'),
      change('t', 'dt'),
      up('dy')),
  ]),
  cannon: () => excerpt([
    setv('speed', CANNON.speed),
    setv('angle', CANNON.angle),
    fn('cosA', 'cos', 'angle'),
    fn('sinA', 'sin', 'angle'),
    calc('vx', 'speed', '*', 'cosA'),
    calc('vy', 'speed', '*', 'sinA'),
  ]),
  track: () => excerpt([
    setv('force', TRACK.force),
    setv('mass', 100),
    calc('friction', 'mu', '*', 'weight'),
    calc('net', 'force', '-', 'friction'),
    calc('a', 'net', '/', 'mass'),
  ]),
  coaster: () => excerpt([
    calc('total', 'weight', '*', 'height'),
    calc('PE', 'weight', '*', 'y'),
    calc('KE', 'total', '-', 'PE'),
    calc('KE', 'KE', '-', 'heat'),
    fn('v', 'sqrt', 'v2'),
    share('KE'),
  ]),
  bumper: () => excerpt([
    setv('m1', BUMPER.m1),
    setv('m2', BUMPER.m2),
    calc('pA', 'm1', '*', 'u1'),
    calc('pB', 'm2', '*', 'u2'),
    calc('before', 'pA', '-', 'pB'),
    share('v1'),
  ]),
  pendulum: () => excerpt([
    setv('length', PENDULUM.length),
    calc('pull', 'g', '/', 'length'),
    fn('s', 'sin', 'angle'),
    calc('accel', 'pull', '*', 's'),
    calc('swing', 'swing', '-', 'dw'),
    tilt('angle'),
  ]),
};

