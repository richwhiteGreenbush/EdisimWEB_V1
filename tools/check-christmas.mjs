// Checks A Cabin Christmas: that the programs the world ships, and the ones its two boards
// teach, really do what the boards say -- run through the real ProgramRunner.
//
//   node tools/check-christmas.mjs
//
// 1. The toy train's shipped program keeps it on the track, and so does the board's
//    "double BOTH numbers" version, while doubling only one number leaves the rails.
// 2. The snowman's board program dances a square and ends where it started, saying its line.
// 3. Every record in the layout is one the app can rebuild: a known prop key, legal names.
import * as THREE from 'three';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { runBlocks } = await import('./lib/run-blocks.mjs');
const { makeBlock } = await import('../src/BlockDefs.js');
const { TRAIN_R, TRAIN_STEP, TRAIN_TURN, TRAIN_CENTRE } = await import('../src/props/ChristmasProps.js');
const { buildPresetWorldRecords } = await import('../src/WorldPresets.js');
const { isValidName, RESERVED } = await import('../src/textcode/commands.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// A train starts at the origin facing +z; its track's centre is TRAIN_CENTRE, to its left (+x)
// because a positive rotate turns left, and half a step ahead because it walks a polygon.
function trainDrift(step, turn, laps = 2) {
  const program = [makeBlock('forever', {}, [makeBlock('moveForward', { feet: step }), makeBlock('rotate', { degrees: turn })])];
  const passes = Math.round((360 / turn) * laps);
  const { log } = runBlocks(program, { maxSteps: passes * 3 });
  let worst = 0;
  for (const p of log.path) worst = Math.max(worst, Math.abs(Math.hypot(p.x - TRAIN_CENTRE[0], p.z - TRAIN_CENTRE[1]) - TRAIN_R));
  return worst;
}

const shipped = trainDrift(TRAIN_STEP, TRAIN_TURN);
check('train: the shipped program stays on the track', shipped < 0.02, `worst ${shipped.toFixed(3)}ft off the rails over two laps`);
const doubled = trainDrift(TRAIN_STEP * 2, TRAIN_TURN * 2);
// Its polygon's centre moves forward by another half step, so it runs a hair off the middle of
// the rails -- well inside the 0.42ft gauge.
check('train: doubling BOTH numbers stays on the same track', doubled < 0.2, `worst ${doubled.toFixed(3)}ft, gauge 0.42ft`);
const oneOnly = trainDrift(TRAIN_STEP * 2, TRAIN_TURN, 1);
check('train: doubling only one number leaves the rails, as the board says', oneOnly > 2, `${oneOnly.toFixed(1)}ft off`);

// The snowman's board, exactly as printed.
{
  const program = [
    makeBlock('repeat', { count: 4 }, [makeBlock('moveForward', { feet: 3 }), makeBlock('rotate', { degrees: 90 })]),
    makeBlock('say', { text: 'Merry Christmas!' }),
  ];
  const { log, object3D } = runBlocks(program);
  const far = Math.max(...log.path.map((p) => Math.hypot(p.x, p.z)));
  check('snowman: the dance ends where it started', object3D.position.length() < 1e-6, `ended ${object3D.position.length().toExponential(1)}ft from home`);
  check('snowman: the square is 3ft a side', Math.abs(far - 3 * Math.SQRT2) < 1e-6, `furthest point ${far.toFixed(3)}ft`);
  check('snowman: he says his line', log.says.includes('Merry Christmas!'));
  check('snowman: and turns back to the way he faced', Math.abs(((object3D.rotation.y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) < 1e-6 || Math.abs(Math.abs(object3D.rotation.y) - 2 * Math.PI) < 1e-6);
}

// The layout.
{
  const { records } = buildPresetWorldRecords('christmas', { groundHeightAt: () => 0 });
  const { PROP_BUILDERS } = await import('../src/props/index.js').catch(() => ({ PROP_BUILDERS: null }));
  if (PROP_BUILDERS) {
    const unknown = records.filter((r) => r.kind === 'preset-prop' && !PROP_BUILDERS[r.prop]).map((r) => r.prop);
    check('every prop key is in PROP_BUILDERS', unknown.length === 0, unknown.join(', '));
  }
  const names = records.map((r) => r.objectName).filter(Boolean);
  check('object names are legal and unique', names.every((n) => isValidName(n) && !RESERVED.has(n)) && new Set(names).size === names.length, names.join(', '));
  const lights = records.filter((r) => r.kind === 'light-orb').length;
  check('no light orbs (the props carry the world\'s three lights)', lights === 0);
  const theme = records.find((r) => r.kind === 'world-theme')?.theme;
  check('the theme record leads', records[0].kind === 'world-theme' && theme === 'christmas');
  const train = records.find((r) => r.objectName === 'train');
  check('the train ships running and goes home on restart', !!train?.program?.length && train.homeFromRecord === true);
  const bytes = JSON.stringify(records).length;
  check('the world file is small', bytes < 60000, `${(bytes / 1024).toFixed(1)} KB`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
