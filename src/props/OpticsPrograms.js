import { makeBlock } from '../BlockDefs.js';
import {
  setv, change, calc, fn, share, readout, until, when, whenSaid, wait, both, repeat, goHome, say,
  markerColor, markerDown, markerUp, programSteps,
} from '../BlockKit.js';
import {
  STEPS, MIRROR, PERISCOPE, TANK, BLOCK, FIBRE, PRISM, LENS,
  prismLaser, prismReach, prismEntry, SPECTRUM,
} from './OpticsModel.js';

// The Hall of Light's programs, all in blocks. Every beam of light is one of these: it keeps its own
// position in `x` (along the bench) and `y` (up), measured from where it started, and is told where
// the surfaces are by the green blocks at the top. It cannot see the glass, and the boards say so.
//
// Builders rather than constants, because two objects must not share one tree of block ids.
// tools/check-hall-of-light.mjs runs every one through the real block runner and compares the path it
// draws with OpticsModel.js.

const r3 = (v) => Math.round(v * 1000) / 1000;

// Which way the beam is pointing, as the two numbers `move forward and up` needs.
const aim = () => [fn('c', 'cos', 'angle'), fn('s', 'sin', 'angle')];

// Travel `dist` feet along `angle`, cut into `steps` equal moves so the light can be watched and still
// lands exactly on the surface. Then remember where it is.
const travel = () => [
  calc('dx', 'dist', '*', 'c'),
  calc('dy', 'dist', '*', 's'),
  calc('sx', 'dx', '/', 'steps'),
  calc('sy', 'dy', '/', 'steps'),
  repeat('steps', both('sx', 'sy')),
  change('x', 'dx'),
  change('y', 'dy'),
];

const start = (steps = STEPS) => [setv('steps', steps), setv('x', 0), setv('y', 0)];
const pen = (hex) => [markerColor(hex), markerDown()];

// A beam that waits for its cue goes back to its laser first, with the pen up so the trip is not drawn.
const restart = () => [markerUp(), goHome()];

export const BEAM_INK = {
  mirror: '#ff3b2f',
  periscope: '#ff3b2f',
  student: '#ffd21f',
  water: '#ff3b2f',
  spear: '#b9c2cc',
  block: '#ff3b2f',
  fibre: '#38e06a',
  white: '#ffffff',
};

// --- 1. The Mirror -------------------------------------------------------------
// The reflection rule is one block: the angle out is minus the angle in.
export const reflectRule = () => [calc('angle', 0, '-', 'angle')];

export const mirrorProgram = ({ angle = MIRROR.angle } = {}) => [
  setv('angle', angle),
  setv('below', r3(MIRROR.mirrorY - MIRROR.laser[1])),
  setv('screen', r3(MIRROR.screenU - MIRROR.laser[0])),
  setv('top', r3(MIRROR.boardTop - MIRROR.laser[1])),
  ...start(),
  ...pen(BEAM_INK.mirror),
  // Down to the mirror.
  ...aim(),
  calc('dist', 'below', '/', 's'),
  ...travel(),
  // Angle in = angle out.
  ...reflectRule(),
  // Up to the screen, or to the top of the board if it is aimed too steeply.
  ...aim(),
  calc('gap', 'screen', '-', 'x'),
  calc('dist', 'gap', '/', 'c'),
  calc('room', 'top', '-', 'y'),
  calc('high', 'room', '/', 's'),
  calc('dist', 'dist', 'min', 'high'),
  ...travel(),
  markerUp(),
  calc('height', 'y', '+', MIRROR.laser[1]),
  when('height', '>', MIRROR.screenTop, say('Over the top of the screen. Try a smaller angle.')),
  when('height', '<=', MIRROR.screenTop, readout('the dot is', 'height', 'feet up the screen')),
];

// --- 2. The Periscope ----------------------------------------------------------
// A mirror at angle m sends a beam at angle a off at 2m - a. At -45 degrees, flat in becomes straight down.
export const periscopeProgram = () => [
  setv('mirror', PERISCOPE.mirror),
  setv('angle', 0),
  setv('ahead', PERISCOPE.ahead),
  setv('drop', PERISCOPE.drop),
  setv('out', PERISCOPE.out),
  ...start(),
  ...pen(BEAM_INK.periscope),
  ...aim(),
  setv('dist', 'ahead'),
  ...travel(),
  calc('turn', 'mirror', '*', 2),
  calc('angle', 'turn', '-', 'angle'),
  ...aim(),
  setv('dist', 'drop'),
  ...travel(),
  calc('angle', 'turn', '-', 'angle'),
  ...aim(),
  setv('dist', 'out'),
  ...travel(),
  markerUp(),
  say('The eye sees the laser from behind the wall.'),
];

// What the activity board asks a student to build on the empty beam, from nothing. Kept here so the
// check tool runs exactly what the board prints.
export const periscopeAnswer = () => [
  markerColor(BEAM_INK.student),
  markerDown(),
  both(PERISCOPE.ahead, 0),
  both(0, -PERISCOPE.drop),
  both(PERISCOPE.out, 0),
];

// --- 3. The Water Tank ---------------------------------------------------------
export const SPEAR = 'now the spear';

// Snell's law, n1 sin i = n2 sin r, with the angles from the normal. Air is n = 1.
export const snellRule = () => [
  calc('i', 90, '+', 'angle'),
  fn('si', 'sin', 'i'),
  calc('t', 'si', '/', 'n'),
  fn('r', 'asin', 't'),
  calc('angle', 'r', '-', 90),
];

export const waterProgram = ({ aim: aimAngle = TANK.aim, n = TANK.n } = {}) => [
  setv('n', n),
  setv('aim', aimAngle),
  share('aim'),
  setv('angle', 'aim'),
  setv('surface', r3(TANK.surfaceY - TANK.laser[1])),
  setv('depth', r3(TANK.floorY - TANK.surfaceY)),
  ...start(),
  ...pen(BEAM_INK.water),
  // Down to the water.
  ...aim(),
  calc('dist', 'surface', '/', 's'),
  ...travel(),
  // It bends at the surface.
  ...snellRule(),
  // Down to the floor of the tank.
  ...aim(),
  calc('dist', 'depth', '/', 's'),
  ...travel(),
  markerUp(),
  say('In at {i}°, bent to {r}°.'),
  wait(2),
  say(SPEAR),
];

// The line of sight: the in-air line carried straight on, as the eye assumes. It reads the laser's
// own `aim`, so changing the laser moves it too.
export const spearProgram = () => [
  whenSaid(SPEAR,
    ...restart(),
    setv('angle', 'aim'),
    setv('surface', r3(TANK.surfaceY - TANK.laser[1])),
    setv('depth', r3(TANK.floorY - TANK.surfaceY)),
    ...start(),
    ...aim(),
    calc('dist', 'surface', '/', 's'),
    ...travel(),
    ...pen(BEAM_INK.spear),
    calc('dist', 'depth', '/', 's'),
    ...travel(),
    markerUp(),
    say('A spear thrown where the fish seems to be goes past it.')),
];

// --- 4. The Light Pipe ---------------------------------------------------------
// The glass block. SHIPPED WITHOUT ITS GUARD, on purpose: at i = 45 the light cannot get out, n sin i
// is more than 1, and asin has no answer. The activity is to add the two `if` blocks below.
export const blockProgram = ({ i = BLOCK.i, fixed = false } = {}) => {
  const leave = [fn('r', 'asin', 't'), calc('angle', 90, '-', 'r')];
  const decide = fixed
    ? [when('t', '<=', 1, ...leave), when('t', '>', 1, calc('angle', 'i', '-', 90))]
    : leave;
  return [
    setv('n', BLOCK.n),
    setv('i', i),
    setv('rise', r3(BLOCK.top - BLOCK.start[1])),
    setv('out', BLOCK.out),
    ...start(),
    ...pen(BEAM_INK.block),
    // Up to the top of the glass, meeting it at i degrees from the normal.
    calc('angle', 90, '-', 'i'),
    ...aim(),
    calc('dist', 'rise', '/', 's'),
    ...travel(),
    // Out into the air: Snell's law the other way round.
    fn('si', 'sin', 'i'),
    calc('t', 'n', '*', 'si'),
    ...decide,
    ...aim(),
    setv('dist', 'out'),
    ...travel(),
    markerUp(),
  ];
};

// The two `if` blocks the activity adds, as the board prints them.
export const blockFix = () => blockProgram({ fixed: true }).filter((b) => b.type === 'ifCompare');

// The rod: every bounce is a total internal reflection, so all the light comes out of the far end.
export const fibreProgram = ({ angle = FIBRE.angle } = {}) => [
  setv('n', FIBRE.n),
  setv('angle', angle),
  setv('half', FIBRE.half),
  setv('length', FIBRE.length),
  calc('end', 'length', '-', 0.001),
  setv('bounces', 0),
  setv('done', 0),
  setv('leaked', 0),
  ...start(FIBRE.steps),
  ...pen(BEAM_INK.fibre),
  until('done', '=', 1,
    ...aim(),
    // To the far end, or to the wall it is heading for, whichever comes first.
    calc('gap', 'length', '-', 'x'),
    calc('dist', 'gap', '/', 'c'),
    when('s', '>', 0,
      calc('room', 'half', '-', 'y'),
      calc('high', 'room', '/', 's'),
      calc('dist', 'dist', 'min', 'high')),
    when('s', '<', 0,
      calc('room', 0, '-', 'half'),
      calc('room', 'room', '-', 'y'),
      calc('high', 'room', '/', 's'),
      calc('dist', 'dist', 'min', 'high')),
    ...travel(),
    when('x', '>=', 'end', setv('done', 1)),
    when('done', '=', 0,
      fn('i', 'abs', 'angle'),
      calc('i', 90, '-', 'i'),
      fn('si', 'sin', 'i'),
      calc('t', 'n', '*', 'si'),
      when('t', '>', 1, calc('angle', 0, '-', 'angle'), change('bounces', 1)),
      when('t', '<=', 1, setv('leaked', 1), setv('done', 1)))),
  when('leaked', '=', 1,
    fn('r', 'asin', 't'),
    when('s', '>', 0, calc('angle', 90, '-', 'r')),
    when('s', '<', 0, calc('angle', 'r', '-', 90)),
    ...aim(),
    setv('dist', FIBRE.leakOut),
    ...travel(),
    markerUp(),
    say('Light escaped at a wall. Try a smaller angle.')),
  when('leaked', '=', 0,
    markerUp(),
    say('{bounces} bounces, and none of the light got out.')),
];

// --- 5. The Prism --------------------------------------------------------------
// The white beam goes to the glass and gives the cue; six colour beams, waiting at the face, take it
// from there, each with its own n.
export const SPLIT = 'split the light';

export const whiteLaserProgram = () => {
  const laser = prismLaser();
  return [
    setv('angle', laser.angle),
    setv('dist', laser.dist),
    ...start(),
    ...pen(BEAM_INK.white),
    ...aim(),
    ...travel(),
    markerUp(),
    say(SPLIT),
    wait(3),
    say('Violet bends the most. Red bends the least.'),
  ];
};

export const colourProgram = (colour) => [
  whenSaid(SPLIT,
    ...restart(),
    setv('n', colour.n),
    setv('angle', laserAngle()),
    setv('into', PRISM.intoNormal),
    setv('out', PRISM.outNormal),
    setv('reach', r3(prismReach())),
    setv('screen', r3(PRISM.screenU - prismEntry()[0])),
    ...start(),
    ...pen(colour.hex),
    // Into the glass: it slows down and bends toward the normal.
    calc('i', 'angle', '-', 'into'),
    fn('si', 'sin', 'i'),
    calc('t', 'si', '/', 'n'),
    fn('r', 'asin', 't'),
    calc('angle', 'into', '+', 'r'),
    // Across to the far face.
    calc('k', 'angle', '-', 'out'),
    fn('ck', 'cos', 'k'),
    calc('dist', 'reach', '/', 'ck'),
    ...aim(),
    ...travel(),
    // Out of the glass: it speeds up and bends away from the normal.
    calc('i', 'angle', '-', 'out'),
    fn('si', 'sin', 'i'),
    calc('t', 'n', '*', 'si'),
    fn('r', 'asin', 't'),
    calc('angle', 'out', '+', 'r'),
    // On to the screen.
    ...aim(),
    calc('gap', 'screen', '-', 'x'),
    calc('dist', 'gap', '/', 'c'),
    ...travel(),
    markerUp()),
];

function laserAngle() {
  return prismLaser().angle;
}

// --- 6. The Lens ---------------------------------------------------------------
// The lens owns `f` and shares it; every beam reads it. One green arrow, five beams.
export const FOCUS = 'focus';

export const lensProgram = ({ f = LENS.f } = {}) => [
  setv('f', f),
  share('f'),
  say(FOCUS),
  wait(4),
  say('The beams meet {f} feet past the lens.'),
];

export const lensRule = () => [
  fn('ta', 'tan', 'angle'),
  calc('k', 'h', '/', 'f'),
  calc('ta', 'ta', '-', 'k'),
  fn('angle', 'atan', 'ta'),
];

export const lensBeamProgram = (h, hex) => [
  whenSaid(FOCUS,
    ...restart(),
    setv('h', h),
    setv('angle', 0),
    setv('lens', r3(LENS.u - LENS.start)),
    setv('screen', r3(LENS.screenU - LENS.u)),
    ...start(),
    ...pen(hex),
    ...aim(),
    setv('dist', 'lens'),
    ...travel(),
    // The lens rule: tan(new angle) = tan(angle) - h / f.
    ...lensRule(),
    ...aim(),
    calc('dist', 'screen', '/', 'c'),
    ...travel(),
    markerUp()),
];

// --- The hall ------------------------------------------------------------------
export const clearProgram = () => [
  makeBlock('eraseMarks'),
  say('All the light is cleared. Press any green arrow to draw it again.'),
];

// What the block boards quote, taken from the real blocks.
export const BOARD_STEPS = {
  mirror: () => programSteps(reflectRule()),
  water: () => programSteps(snellRule()),
  lens: () => programSteps(lensRule()),
  travel: () => programSteps([...aim(), ...travel()]),
};

export { SPECTRUM };
