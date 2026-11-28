// Holds the Text view to a round trip: every block in the table, printed as text and read back,
// is the same block with the same inputs; and the mistakes a student is likely to make get a
// message naming the line.
//
//   node Stages/tools/check-text.mjs
import { BLOCKS, blockDef } from '../src/blocks/defs.js';
import { B, C, C2, R, V, createBlock } from '../src/blocks/make.js';
import { parseScripts, printScripts } from '../src/text/text.js';

let fails = 0;
let passes = 0;
const check = (name, ok, detail = '') => { if (ok) passes++; else { fails++; console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); } };

// The shape of a tree without ids, numbers compared as numbers.
function shape(blocks) {
  return (blocks || []).map((b) => ({
    t: b.type,
    i: Object.fromEntries(Object.entries(b.inputs || {}).map(([k, v]) => [k, v.block ? shape([v.block])[0] : (v.value === '' || v.value == null ? '' : String(Number.isFinite(Number(v.value)) && String(v.value).trim() !== '' ? Number(v.value) : v.value))])),
    s: b.substack ? shape(b.substack) : undefined,
    s2: b.substack2 ? shape(b.substack2) : undefined,
  }));
}
const same = (a, b) => JSON.stringify(shape(a)) === JSON.stringify(shape(b));
const ctx = { variables: ['score', 'my variable', 'vy'] };

function trip(name, scripts) {
  const text = printScripts(scripts.map((blocks) => ({ blocks })));
  let back;
  try { back = parseScripts(text, ctx); } catch (e) { check(name, false, `${e.message}\n${text}`); return; }
  const ok = back.length === scripts.length && scripts.every((s, i) => same(s, back[i]));
  check(name, ok, ok ? '' : `${text}\n--- read back as ---\n${printScripts(back.map((blocks) => ({ blocks })))}`);
}

// Every block, with menu defaults filled in the way the editor fills them.
const FILL = { gotoTargets: '_random_', pointTargets: '_mouse_', touchTargets: '_edge_', cloneTargets: '_myself_', costumes: 'walk a',
  backdrops: 'Moon', backdropsAndNext: 'next backdrop', sounds: 'Pop', messages: 'game over', ofTargets: '_stage_', propertiesOf: 'backdrop #' };
for (const [type, def] of BLOCKS) {
  const b = createBlock(type);
  for (const [name, spec] of Object.entries(def.inputs)) {
    if (spec.kind === 'menu' && typeof spec.options === 'string') b.inputs[name].value = FILL[spec.options];
    if (spec.kind === 'variable') b.inputs[name].value = 'score';
    if (spec.kind === 'boolean') b.inputs[name].block = R('sensing_mousedown');
  }
  if (def.shape === 'hat') trip(`block ${type}`, [[b, B('motion_movesteps', { STEPS: 3 })]]);
  else if (def.shape === 'reporter' || def.shape === 'boolean') trip(`block ${type}`, [[B('looks_say', { MESSAGE: b })]]);
  else trip(`block ${type}`, [[B('event_whenflagclicked'), b]]);
}

// Nesting, else, empty mouths, scripts without a hat, odd text.
trip('nested loops, if/else and reporters', [[
  B('event_whenflagclicked'), B('data_setvariableto', { VARIABLE: 'score', VALUE: 0 }),
  C('control_forever', {}, [
    C2('control_if_else', { CONDITION: R('operator_and', { OPERAND1: R('sensing_keypressed', { KEY_OPTION: 'right arrow' }), OPERAND2: R('operator_lt', { OPERAND1: V('vy'), OPERAND2: 1 }) }) },
      [B('motion_changexby', { DX: -9 }), C('control_repeat', { TIMES: 3 }, [])],
      [B('looks_say', { MESSAGE: R('operator_join', { STRING1: 'I caught ', STRING2: R('operator_join', { STRING1: V('score'), STRING2: ' "coins"' }) }) })]),
  ]),
], [B('motion_movesteps', { STEPS: R('operator_mathop', { OPERATOR: 'sqrt', NUM: 9 }) })], [C('control_if', { CONDITION: null })]]);
trip('variables with spaces and empty slots', [[B('event_whenflagclicked'), B('data_changevariableby', { VARIABLE: 'my variable', VALUE: V('my variable') }), B('motion_movesteps', { STEPS: R('operator_add', {}) })]]);
trip('"of" versus maths "of"', [[B('event_whenflagclicked'), B('looks_say', { MESSAGE: R('sensing_of', { PROPERTY: 'x position', OBJECT: 'Ball' }) }), B('looks_say', { MESSAGE: R('operator_mathop', { OPERATOR: 'abs', NUM: -4 }) })]]);

// Writing it by hand, the way a student would.
{
  const s = parseScripts(`when flag clicked:
    forever:
        move 10 steps
        if on edge, bounce   # a comment
        turn right 15 degrees

when "space" key pressed:
    say "Hi" for 2 seconds
`, ctx);
  check('hand-written text reads', s.length === 2 && s[0][1].substack.length === 3 && s[0][1].substack[2].type === 'motion_turnright');
}
const errorFor = (text) => { try { parseScripts(text, ctx); return null; } catch (e) { return e.message; } };
check('an unknown line names the line and suggests a block', /Line 2/.test(errorFor('when flag clicked:\n    move 10 step')) && /Did you mean/.test(errorFor('when flag clicked:\n    move 10 step')), errorFor('when flag clicked:\n    move 10 step'));
check('a C block without a colon says so', /needs a :/.test(errorFor('when flag clicked:\n    forever\n        move 10 steps')));
check('a bad indent says so', /4 spaces/.test(errorFor('when flag clicked:\n  move 10 steps')));
check('a missing closing quote says so', /closing "/.test(errorFor('when flag clicked:\n    say "Hi')));
check('an unknown variable lists the real ones', /Variables here/.test(errorFor('when flag clicked:\n    say (lives)')));
check('a bracketed number says brackets are for blocks', /without brackets/.test(errorFor('when flag clicked:\n    if (5) then:\n        pass')));
check('a number in a true-false slot says so', /true-or-false/.test(errorFor('when flag clicked:\n    if 5 then:\n        pass')));
check('an else with no if says so', /belongs under/.test(errorFor('when flag clicked:\n    forever:\n        pass\n    else:\n        pass')));

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
