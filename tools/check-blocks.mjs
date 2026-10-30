// Regression check for the Math blocks' effect on everything that already existed.
//
//   node tools/check-blocks.mjs
//
// Adding variables changed how every numeric block param is read, and added names to the
// JavaScript runtime. Both touch programs saved long before either existed, in every gallery world
// and every file a student has downloaded, so this runs against all the seeded worlds:
//
//  1. No numeric param in any saved program reads as a variable, so `val()` gives every one of them
//     exactly what `Number(x) || 0` always did.
//  2. Every saved JavaScript program still compiles against the longer list of runtime names. A
//     student's `const moveBoth = ...` would otherwise become "already declared".
//  3. Every saved block program runs the same way it did: stepped through the new runner, the moves
//     it makes are compared with a small copy of the old arithmetic.
//  4. A loop of nothing but math cannot hang the tab, and `go back to start` survives a mid-air Save.
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';

const { BLOCK_DEFS, isVariableRef } = await import('../src/BlockDefs.js');
const { compileJs } = await import('../src/JsProgram.js');
const { runProgram } = await import('../src/ProgramRunner.js');
const { ProgramManager } = await import('../src/ProgramManager.js');
const { until, change, setv, up, forever, wait } = await import('../src/BlockKit.js');

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const dir = new URL('../EdusimWorldDatabase/seed/worlds/', import.meta.url);
const NEW_WORLDS = new Set(['midway.json', 'smallchange.json', 'atomhall.json', 'standonearth.json']);
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !NEW_WORLDS.has(f));

let programs = 0;
let jsPrograms = 0;
let params = 0;
const badParams = [];
const badJs = [];
const walk = (blocks, fn) => {
  for (const block of blocks || []) {
    fn(block);
    walk(block.children, fn);
  }
};
const allBlockPrograms = [];
for (const file of files) {
  const world = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  for (const record of world.records || world.objects || []) {
    if (record.programJs) {
      jsPrograms++;
      const { error } = compileJs(record.programJs);
      if (error) badJs.push(`${file}: ${error.message}`);
    }
    if (record.program?.length) {
      programs++;
      allBlockPrograms.push({ file, program: record.program });
      walk(record.program, (block) => {
        const def = BLOCK_DEFS[block.type];
        for (const [key, value] of Object.entries(block.params || {})) {
          if (def?.params?.[key]?.type !== 'number') continue;
          params++;
          if (isVariableRef(value)) badParams.push(`${file}: ${block.type}.${key} = ${value}`);
        }
      });
    }
  }
}
console.log(`\n${files.length} seeded worlds: ${programs} block programs, ${params} numeric params, ${jsPrograms} JavaScript programs`);
check(programs > 20, 'the sweep found the programs it is meant to read');
check(badParams.length === 0, 'no saved numeric param reads as a variable', badParams.slice(0, 3).join('; '));
check(badJs.length === 0, 'every saved JavaScript program still compiles', badJs.slice(0, 3).join('; '));

// The old arithmetic, block by block, for the blocks that move something.
function oldStep(block, o) {
  const n = (x) => Number(x) || 0;
  const p = block.params;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(o.quaternion);
  if (block.type === 'moveForward') o.position.addScaledVector(f, n(p.feet));
  if (block.type === 'moveUp') o.position.y += n(p.feet);
  if (block.type === 'rotate') o.rotation.y += THREE.MathUtils.degToRad(n(p.degrees));
  if (block.type === 'changeSize') { const k = 1 + n(p.percent) / 100; if (k > 0) o.scale.multiplyScalar(k); }
}
const MOVERS = new Set(['moveForward', 'moveUp', 'rotate', 'changeSize']);
let compared = 0;
let different = 0;
for (const { file, program } of allBlockPrograms) {
  // Pulled out of whatever loops hold them, because nearly every saved move is inside one. In
  // order, one after another, they can be compared without a clock.
  const stack = [];
  walk(program, (block) => { if (MOVERS.has(block.type)) stack.push({ type: block.type, params: block.params }); });
  if (!stack.length) continue;
  const a = new THREE.Object3D();
  const b = new THREE.Object3D();
  const gen = runProgram(stack, a, {});
  for (const block of stack) {
    gen.next();
    oldStep(block, b);
    compared++;
    if (a.position.distanceTo(b.position) > 1e-9 || Math.abs(a.scale.x - b.scale.x) > 1e-9) {
      different++;
      console.log(`    differs in ${file}: ${block.type}`);
    }
  }
}
console.log(`  (${compared} saved moves stepped both ways)`);
check(compared > 0 && different === 0, 'saved moves land exactly where they always did');

console.log('\nA loop of math cannot hang the tab');
{
  const o = new THREE.Object3D();
  const gen = runProgram([until('x', '>', 1e12, change('y', 1))], o, { vars: new Map(), worldVars: new Map() });
  const started = Date.now();
  let frames = 0;
  while (frames < 20 && !gen.next().done) frames++;
  check(frames === 20 && Date.now() - started < 2000, 'a repeat until that never ends still hands frames back', `${Date.now() - started}ms for 20 frames`);
}
{
  const vars = new Map();
  const gen = runProgram([setv('n', 0), ...[until('n', '>=', 500, change('n', 1))], up('n')], new THREE.Object3D(), { vars, worldVars: new Map() });
  const first = gen.next();
  check(!first.done && vars.get('n') === 500, 'a short math loop finishes inside one frame', `n = ${vars.get('n')}`);
}

console.log('\nStarting from where it was placed');
{
  const manager = new ProgramManager();
  const object3D = new THREE.Object3D();
  object3D.position.set(1, 2, 3);
  const record = {
    homeFromRecord: true,
    transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    program: [forever(up(1), wait(0))],
  };
  manager.startFromRecord('a', record, object3D);
  for (let i = 0; i < 5; i++) manager.tick();
  check(object3D.position.y > 2, 'the object has moved');
  manager.startFromRecord('a', record, object3D);
  check(object3D.position.y === 2, 'saving mid-flight puts it back on its record');
  check(manager.programs.get('a').home.position.y === 2, 'and that is the home it remembers');

  const plain = new THREE.Object3D();
  plain.position.set(0, 9, 0);
  const old = { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, program: [forever(up(1), wait(0))] };
  manager.startFromRecord('b', old, plain);
  check(manager.programs.get('b').home.position.y === 9, 'an object without the flag keeps its old meaning of start');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
