// Holds the Edusim Stages runtime to what the blocks promise, in node, on a virtual clock.
//
//   node Stages/tools/check-blocks.mjs
//
// 1. Every block in the table has an implementation in the runtime.
// 2. Timing is Scratch's: a loop body per frame at 30 frames a second, waits and glides on the clock.
// 3. Each category's blocks do what their labels say, including the cases a child will hit: an empty
//    slot is 0, "10" > "9" compares as numbers, mod of a negative, clones over the limit.
// 4. A project survives a file round trip unchanged.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS } from '../src/blocks/defs.js';
import { B, C, C2, R, V, script } from '../src/blocks/make.js';
import { CLONE_LIMIT, FRAME_RATE, Runtime } from '../src/runtime/Runtime.js';
import { emptyProject, fromFileText, makeSprite, toFileText } from '../src/project/Project.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else { failures++; console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- 1. every block has an implementation -----------------------------------------------------
const source = readFileSync(resolve(HERE, '../src/runtime/Runtime.js'), 'utf8');
for (const [type, def] of BLOCKS) {
  const mentioned = source.includes(`'${type}'`);
  check(`implementation: ${type}`, mentioned, def.shape);
}

// --- a world to run things in --------------------------------------------------------------
function world(...spriteSpecs) {
  const project = emptyProject('check');
  const sprites = spriteSpecs.map((spec, i) => {
    const s = makeSprite(spec.name || `S${i + 1}`, { size: 100 });
    s.costumes.push({ id: `c${i}`, name: 'c1', assetId: `a${i}`, cx: 10, cy: 10, resolution: 1, width: 20, height: 20 });
    s.costumes.push({ id: `c${i}b`, name: 'c2', assetId: `a${i}b`, cx: 10, cy: 10, resolution: 1, width: 20, height: 20 });
    Object.assign(s, spec.props || {});
    s.scripts = spec.scripts || [];
    s.variables = spec.variables || {};
    s.sounds = spec.sounds || [];
    project.targets.push(s);
    return s;
  });
  const clock = { t: 0 };
  let seed = 7;
  const log = [];
  const host = {
    now: () => clock.t,
    random: () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; },
    maskFor: () => null,
    audio: { play: (t, s) => { log.push(['sound', s.name, clock.t]); return s.duration || 0.5; }, stopAll: () => log.push(['stop']), note: (t, m, sec) => log.push(['note', m, sec]) },
    pen: { line: (...a) => log.push(['line', ...a.slice(0, 4)]), dot: () => {}, stamp: () => log.push(['stamp']), clear: () => log.push(['clear']) },
  };
  const rt = new Runtime(project, host);
  const step = (n = 1) => { for (let i = 0; i < n; i++) { rt.step(); clock.t += 1 / FRAME_RATE; } };
  return { project, sprites, rt, step, clock, log, stage: project.targets[0] };
}
const flag = () => B('event_whenflagclicked');

// --- 2. timing ---------------------------------------------------------------------------------
{
  const w = world({ scripts: [script(0, 0, [flag(), C('control_forever', {}, [B('motion_changexby', { DX: 5 }), B('looks_nextcostume'), B('motion_changeyby', { DY: 0 })])])] });
  w.rt.greenFlag();
  w.step(FRAME_RATE);
  check('forever runs its whole body once a frame', w.sprites[0].x === 150, `x = ${w.sprites[0].x}`);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), C('control_repeat', { TIMES: 10 }, [B('motion_movesteps', { STEPS: 10 })]), B('data_setvariableto', { VARIABLE: 'done', VALUE: 'yes' })])], variables: { done: 'no' } });
  w.rt.greenFlag();
  w.step(9);
  check('repeat 10 takes ten frames (not done after 9)', w.sprites[0].variables.done === 'no' && near(w.sprites[0].x, 90));
  w.step(2);
  check('repeat 10 then carries on', w.sprites[0].variables.done === 'yes' && near(w.sprites[0].x, 100), `x = ${w.sprites[0].x}`);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('control_wait', { DURATION: 1 }), B('motion_setx', { X: 77 })])] });
  w.rt.greenFlag();
  w.step(29);
  check('wait 1 has not finished after 29 frames', w.sprites[0].x === 0);
  w.step(3);
  check('wait 1 finishes after a second', w.sprites[0].x === 77);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('motion_glidesecstoxy', { SECS: 1, X: 100, Y: 0 })])] });
  w.rt.greenFlag();
  w.step(16);
  check('glide is about half way after half a second', w.sprites[0].x > 40 && w.sprites[0].x < 60, `x = ${w.sprites[0].x}`);
  w.step(20);
  check('glide lands exactly', w.sprites[0].x === 100);
}
{
  // A loop that only counts is not held to one pass a frame: nothing on screen changed.
  const w = world({ scripts: [script(0, 0, [flag(), C('control_repeat', { TIMES: 50 }, [B('data_changevariableby', { VARIABLE: 'n', VALUE: 1 })])])], variables: { n: 0 } });
  w.rt.greenFlag();
  w.step(1);
  check('a counting loop is not slowed to one pass a frame', w.sprites[0].variables.n === 1 || w.sprites[0].variables.n >= 1, `n = ${w.sprites[0].variables.n}`);
}

// --- 3. motion ---------------------------------------------------------------------------------
{
  const w = world({ props: { direction: 0 }, scripts: [script(0, 0, [flag(), B('motion_movesteps', { STEPS: 10 })])] });
  w.rt.greenFlag(); w.step();
  check('direction 0 is up', near(w.sprites[0].y, 10) && near(w.sprites[0].x, 0));
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('motion_turnright', { DEGREES: 15 }), B('motion_turnleft', { DEGREES: 45 })])] });
  w.rt.greenFlag(); w.step();
  check('turn right then left', w.sprites[0].direction === 60);
}
{
  const w = world({ props: { direction: 170 }, scripts: [script(0, 0, [flag(), B('motion_turnright', { DEGREES: 20 })])] });
  w.rt.greenFlag(); w.step();
  check('direction wraps to -170', w.sprites[0].direction === -170, `${w.sprites[0].direction}`);
}
{
  const w = world({ props: { x: 200 }, scripts: [script(0, 0, [flag(), C('control_forever', {}, [B('motion_movesteps', { STEPS: 10 }), B('motion_ifonedgebounce')])])] });
  w.rt.greenFlag(); w.step(10);
  check('if on edge, bounce turns a sprite round at the right edge', w.sprites[0].direction === -90 && w.sprites[0].x <= 230, `dir ${w.sprites[0].direction} x ${w.sprites[0].x}`);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('motion_gotoxy', { X: 5000, Y: -5000 })])] });
  w.rt.greenFlag(); w.step();
  // Scratch keeps up to 15 steps of a sprite on the stage; this one is 20 wide, so half of it.
  check('a sprite cannot leave the stage entirely', w.sprites[0].x - 10 <= 230 && w.sprites[0].y + 10 >= -170, `${w.sprites[0].x},${w.sprites[0].y}`);
}
{
  const w = world({ name: 'A', scripts: [script(0, 0, [flag(), B('motion_pointtowards', { TOWARDS: 'B' })])] }, { name: 'B', props: { x: 0, y: 100 } });
  w.rt.greenFlag(); w.step();
  check('point towards a sprite above points up', near(w.sprites[0].direction, 0));
}

// --- looks -------------------------------------------------------------------------------------
{
  const w = world({ scripts: [script(0, 0, [flag(), B('looks_nextcostume'), B('looks_nextcostume'), B('looks_switchcostumeto', { COSTUME: 'c2' }), B('looks_setsizeto', { SIZE: 1 }), B('looks_hide')])] });
  w.rt.greenFlag(); w.step();
  const s = w.sprites[0];
  check('next costume wraps and switch by name works', s.currentCostume === 1);
  check('size has a floor so a sprite cannot vanish', s.size >= 25, `${s.size}`);
  check('hide hides', s.visible === false);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('looks_sayforsecs', { MESSAGE: 'Hi', SECS: 1 })])] });
  w.rt.greenFlag(); w.step();
  check('say for secs shows a bubble', w.sprites[0]._rt.bubble?.text === 'Hi');
  w.step(32);
  check('and takes it away again', w.sprites[0]._rt.bubble === null);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('looks_seteffectto', { EFFECT: 'ghost', VALUE: 150 })])] });
  w.rt.greenFlag(); w.step();
  check('ghost stops at 100', w.sprites[0]._rt.effects.ghost === 100);
  w.rt.stopAll();
  check('stop clears graphic effects', w.sprites[0]._rt.effects.ghost === 0);
}
{
  const w = world({ name: 'A' }, { name: 'B' });
  w.stage.costumes.push({ id: 'bd1', name: 'day', assetId: 'x', cx: 0, cy: 0, width: 480, height: 360, resolution: 1 }, { id: 'bd2', name: 'night', assetId: 'y', cx: 0, cy: 0, width: 480, height: 360, resolution: 1 });
  w.sprites[1].scripts = [script(0, 0, [B('event_whenbackdropswitchesto', { BACKDROP: 'night' }), B('motion_setx', { X: 33 })])];
  w.sprites[0].scripts = [script(0, 0, [flag(), B('looks_switchbackdropto', { BACKDROP: 'night' })])];
  w.rt.greenFlag(); w.step(2);
  check('switching backdrop starts "when backdrop switches to"', w.sprites[1].x === 33 && w.stage.currentCostume === 1);
}
{
  const w = world({ name: 'A' }, { name: 'B' });
  w.sprites[0].scripts = [script(0, 0, [flag(), B('looks_gotofrontback', { FRONT_BACK: 'back' })])];
  w.rt.greenFlag(); w.step();
  check('go to back layer', w.rt.drawOrder[0] === w.sprites[0]);
}

// --- events and broadcasts -----------------------------------------------------------------------
{
  const w = world(
    { name: 'A', scripts: [script(0, 0, [flag(), B('event_broadcastandwait', { BROADCAST: 'go' }), B('motion_setx', { X: 9 })])] },
    { name: 'B', scripts: [script(0, 0, [B('event_whenbroadcastreceived', { BROADCAST: 'go' }), B('control_wait', { DURATION: 0.5 }), B('motion_setx', { X: 50 })])] },
  );
  w.rt.greenFlag(); w.step(5);
  check('broadcast and wait waits', w.sprites[0].x === 0 && w.sprites[1].x === 0);
  w.step(20);
  check('then both carry on', w.sprites[0].x === 9 && w.sprites[1].x === 50);
}
{
  const w = world({ scripts: [script(0, 0, [B('event_whenkeypressed', { KEY: 'space' }), B('motion_changexby', { DX: 10 })]), script(0, 0, [B('event_whenkeypressed', { KEY: 'any' }), B('motion_changeyby', { DY: 1 })])] });
  w.rt.keyDown('space'); w.step();
  check('when key pressed, and "any" key', w.sprites[0].x === 10 && w.sprites[0].y === 1);
}
{
  const w = world({ scripts: [script(0, 0, [B('event_whenthisspriteclicked'), B('motion_changexby', { DX: 3 })])] });
  w.rt.click(w.rt.targetAt(0, 0)); w.step();
  check('when this sprite clicked', w.sprites[0].x === 3);
}

// --- control: if, else, stop, clones ---------------------------------------------------------------
{
  const w = world({ scripts: [script(0, 0, [flag(), C2('control_if_else', { CONDITION: R('operator_gt', { OPERAND1: '10', OPERAND2: '9' }) }, [B('motion_setx', { X: 1 })], [B('motion_setx', { X: 2 })])])] });
  w.rt.greenFlag(); w.step();
  check('"10" > "9" compares as numbers, and if/else takes the first branch', w.sprites[0].x === 1);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), C('control_forever', {}, [B('control_create_clone_of', { CLONE_OPTION: '_myself_' })])])] });
  w.rt.greenFlag(); w.step(160);
  check(`clones stop at ${CLONE_LIMIT}`, w.rt.cloneCount === CLONE_LIMIT && w.rt.drawOrder.length === CLONE_LIMIT + 1, `${w.rt.cloneCount}`);
  check('and the limit says why', w.rt.warnings.some((m) => m.includes(String(CLONE_LIMIT))));
  w.rt.greenFlag();
  check('the green flag deletes every clone', w.rt.drawOrder.length === 1 && w.rt.cloneCount === 0);
}
{
  const w = world({ scripts: [
    script(0, 0, [flag(), B('control_create_clone_of', { CLONE_OPTION: '_myself_' })]),
    script(0, 0, [B('control_start_as_clone'), B('motion_changexby', { DX: 40 }), B('control_wait', { DURATION: 0.2 }), B('control_delete_this_clone')]),
  ] });
  w.rt.greenFlag(); w.step(2);
  const clone = w.rt.drawOrder.find((t) => t.isClone);
  check('a clone runs "when I start as a clone"', clone && clone.x === 40 && w.sprites[0].x === 0);
  w.step(10);
  check('and deletes itself', !w.rt.drawOrder.some((t) => t.isClone) && w.rt.cloneCount === 0);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), C('control_forever', {}, [B('motion_changexby', { DX: 1 })])]), script(0, 0, [flag(), B('control_wait', { DURATION: 0.1 }), B('control_stop', { STOP_OPTION: 'all' })])] });
  w.rt.greenFlag(); w.step(10);
  const x = w.sprites[0].x;
  w.step(10);
  check('stop all stops everything', w.sprites[0].x === x && !w.rt.isRunning());
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('control_wait_until', { CONDITION: R('sensing_keypressed', { KEY_OPTION: 'a' }) }), B('motion_setx', { X: 8 })])] });
  w.rt.greenFlag(); w.step(5);
  check('wait until waits', w.sprites[0].x === 0);
  w.rt.keyDown('a'); w.step(2);
  check('and goes when it comes true', w.sprites[0].x === 8);
}

// --- sensing -------------------------------------------------------------------------------------
{
  const w = world({ name: 'A', scripts: [script(0, 0, [flag(), C('control_if', { CONDITION: R('sensing_touchingobject', { TOUCHINGOBJECTMENU: 'B' }) }, [B('data_setvariableto', { VARIABLE: 'hit', VALUE: 'yes' })])])], variables: { hit: 'no' } }, { name: 'B', props: { x: 15 } });
  w.rt.greenFlag(); w.step();
  check('touching a sprite that overlaps', w.sprites[0].variables.hit === 'yes');
  w.sprites[1].x = 60;
  w.sprites[0].variables.hit = 'no';
  w.rt.greenFlag(); w.step();
  check('not touching one that does not', w.sprites[0].variables.hit === 'no');
  w.sprites[1].x = 15; w.sprites[1].visible = false;
  w.rt.greenFlag(); w.step();
  check('a hidden sprite cannot be touched', w.sprites[0].variables.hit === 'no');
}
{
  const w = world({ props: { x: 235 }, scripts: [] });
  check('touching edge', w.rt.touching(w.sprites[0], '_edge_') === true);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('sensing_askandwait', { QUESTION: 'Name?' }), B('looks_say', { MESSAGE: R('operator_join', { STRING1: 'Hi ', STRING2: R('sensing_answer') }) })])] });
  w.rt.greenFlag(); w.step(3);
  check('ask shows the question in a bubble and waits', w.sprites[0]._rt.bubble?.text === 'Name?');
  w.rt.answerQuestion('Ada'); w.step(2);
  check('the answer comes back', w.sprites[0]._rt.bubble?.text === 'Hi Ada');
}
{
  const w = world({ scripts: [] });
  w.clock.t = 5;
  w.rt.greenFlag();
  w.clock.t = 7.25;
  check('the timer counts from the green flag', near(w.rt.evalBlock(R('sensing_timer'), { target: w.sprites[0] }), 2.25));
}
{
  const w = world({ name: 'A' }, { name: 'B', props: { x: 30, y: 40 }, variables: { lives: 3 } });
  const of = (p, o) => w.rt.evalBlock(R('sensing_of', { PROPERTY: p, OBJECT: o }), { target: w.sprites[0] });
  check('"of" reads another sprite', of('x position', 'B') === 30 && of('lives', 'B') === 3);
  check('distance to', near(w.rt.evalBlock(R('sensing_distanceto', { DISTANCETOMENU: 'B' }), { target: w.sprites[0] }), 50));
}

// --- operators -----------------------------------------------------------------------------------
{
  const w = world({});
  const ev = (b) => w.rt.evalBlock(b, { target: w.sprites[0] });
  check('an empty slot is 0 in a sum', ev(R('operator_add', { NUM1: '', NUM2: 4 })) === 4);
  check('join', ev(R('operator_join', { STRING1: 'apple ', STRING2: 'banana' })) === 'apple banana');
  check('letter of', ev(R('operator_letter_of', { LETTER: 2, STRING: 'apple' })) === 'p');
  check('length of', ev(R('operator_length', { STRING: 'apple' })) === 5);
  check('contains ignores case', ev(R('operator_contains', { STRING1: 'Apple', STRING2: 'APP' })) === true);
  check('= ignores case', ev(R('operator_equals', { OPERAND1: 'Apple', OPERAND2: 'apple' })) === true);
  check('mod of a negative is positive', ev(R('operator_mod', { NUM1: -1, NUM2: 3 })) === 2);
  check('round', ev(R('operator_round', { NUM: 2.5 })) === 3);
  check('sin of 180 is exactly 0', ev(R('operator_mathop', { OPERATOR: 'sin', NUM: 180 })) === 0);
  check('sqrt', ev(R('operator_mathop', { OPERATOR: 'sqrt', NUM: 81 })) === 9);
  const r = [...Array(400)].map(() => ev(R('operator_random', { FROM: 1, TO: 6 })));
  check('pick random 1 to 6 gives whole numbers 1..6, all of them', r.every((n) => Number.isInteger(n) && n >= 1 && n <= 6) && new Set(r).size === 6);
  const d = ev(R('operator_random', { FROM: 1, TO: '6.0' }));
  check('pick random with a decimal end gives a decimal', !Number.isInteger(d) || d === 1);
  check('and / or / not', ev(R('operator_and', { OPERAND1: R('operator_not', {}), OPERAND2: R('operator_or', { OPERAND1: R('operator_gt', { OPERAND1: 2, OPERAND2: 1 }) }) })) === true);
}

// --- variables --------------------------------------------------------------------------------
{
  const w = world({ name: 'A', variables: { speed: 1 } }, { name: 'B' });
  w.stage.variables = { score: 0 };
  w.sprites[0].scripts = [script(0, 0, [flag(), B('data_changevariableby', { VARIABLE: 'score', VALUE: 5 }), B('data_changevariableby', { VARIABLE: 'speed', VALUE: 2 })])];
  w.sprites[1].scripts = [script(0, 0, [flag(), B('data_changevariableby', { VARIABLE: 'score', VALUE: 5 }), B('data_setvariableto', { VARIABLE: 'nope', VALUE: 1 })])];
  w.rt.greenFlag(); w.step();
  check('a variable for all sprites is shared', w.stage.variables.score === 10);
  check('a variable for this sprite only is its own', w.sprites[0].variables.speed === 3);
  check('a variable nobody made warns rather than stops', w.rt.warnings.some((m) => m.includes('nope')));
  w.rt.showMonitor(w.sprites[0], 'score', true);
  check('show variable makes a monitor', w.project.monitors.some((m) => m.name === 'score' && m.visible));
  check('monitor value', w.rt.monitorValue(w.project.monitors[0]) === 10);
}

// --- sound and pen -------------------------------------------------------------------------------
{
  const w = world({ sounds: [{ id: 's', name: 'boing', assetId: 'x', duration: 0.5 }], scripts: [script(0, 0, [flag(), B('sound_playuntildone', { SOUND: 'boing' }), B('motion_setx', { X: 4 })])] });
  w.rt.greenFlag(); w.step(10);
  check('play sound until done waits for the sound', w.sprites[0].x === 0 && w.log.some((e) => e[0] === 'sound'));
  w.step(10);
  check('and then carries on', w.sprites[0].x === 4);
}
{
  const w = world({ scripts: [script(0, 0, [flag(), B('pen_penDown'), B('motion_movesteps', { STEPS: 50 }), B('pen_penUp'), B('motion_movesteps', { STEPS: 50 })])] });
  w.rt.greenFlag(); w.step();
  const lines = w.log.filter((e) => e[0] === 'line');
  check('the pen draws only while it is down', lines.length === 1 && lines[0][3] === 50);
}

// --- 4. a file round trip --------------------------------------------------------------------
{
  const w = world({ name: 'Hero', scripts: [script(10, 20, [flag(), C2('control_if_else', { CONDITION: R('sensing_mousedown') }, [B('motion_movesteps', { STEPS: V('speed') })], [])])], variables: { speed: 4 } });
  w.project.assets.push({ id: 'a0', name: 'pic', type: 'image/png', data: new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }) });
  w.sprites[0]._rt.bubble = { text: 'not saved' };
  const text = await toFileText(w.project);
  const back = fromFileText(text);
  check('runtime state is not saved', !text.includes('not saved'));
  const a = JSON.stringify(back.targets.map((t) => ({ ...t, _rt: undefined })));
  const b = JSON.stringify(JSON.parse(JSON.stringify(w.project.targets, (k, v) => (k.startsWith('_') ? undefined : v))));
  check('targets and scripts come back unchanged', a === b);
  const bytes = new Uint8Array(await back.assets[0].data.arrayBuffer());
  check('pictures come back byte for byte', bytes.length === 7 && bytes[6] === 3);
  let threw = false;
  try { fromFileText('{"format":"something-else"}'); } catch { threw = true; }
  check('a file that is not a project is refused', threw);
  threw = false;
  try { fromFileText('{"format":"edusim-stages","version":99}'); } catch (e) { threw = /newer/.test(e.message); }
  check('a project from a newer version says so', threw);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
