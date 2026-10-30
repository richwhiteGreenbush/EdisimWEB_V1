import * as THREE from 'three';
import { applyColorTint } from './ColorTint.js';
import { applyOpacity } from './Opacity.js';
import { forwardOf, formatValue } from './ProgramRunner.js';
import { isVariableRef, variablesIn } from './BlockDefs.js';

// JavaScript programs for placed objects -- the SECOND FRONTEND onto the block runner's
// semantics. Three jobs live here: transpile a block tree into readable JavaScript,
// syntax-highlight JavaScript for the editor pane, and run a student's JavaScript against
// a live object with exactly the block palette's vocabulary and pacing.
//
// THE RUNTIME IS ASYNC/AWAIT OVER THE SAME EFFECTS OBJECT THE BLOCK RUNNER USES. Every
// action here performs the identical side effect its block performs -- most of them ported
// line for line from ProgramRunner's cases, the rest delegated to the very same
// `effectsFor()` callbacks (say, duplicate, the four marker calls) -- and then awaits one
// scheduler tick. ProgramManager resolves those ticks once per animation frame, so a
// JavaScript program steps one action per frame exactly as a block program does, `glide`
// interpolates over real time the same way, and `forever` runs at the same documented
// half-rate (its pass costs the body's ticks plus one). One implementation of what "move
// forward" MEANS, two ways of writing it -- which is what stops the two from drifting.
//
// WHY ASYNC/AWAIT AND NOT AN INTERPRETER. The block runner can pause anywhere because it
// is a generator over data. Arbitrary JavaScript can only be paused where it awaits, and
// instrumenting arbitrary code to yield inside bare loops needs a real JS parser, which
// this project does not carry. So every action returns a promise, `await` is the pause
// point, and `repeat`/`forever` are supplied as functions that guarantee at least one tick
// per pass even when the body awaits nothing. A bare `while (true) {}` with no await in it
// will still hang the tab -- same as on any web page -- which is why the starter template
// and the editor's hint line both steer loops through forever()/repeat().

// ---------------------------------------------------------------------------
// Blocks -> JavaScript
// ---------------------------------------------------------------------------

const IND = '  ';

function esc(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// A block's variable name as a JavaScript name. A student can call a variable `top` or `wait`,
// and neither may be declared in a program whose runtime already binds that name.
const RESERVED_NAMES = new Set([
  'await', 'async', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do', 'function',
  'return', 'true', 'false', 'null', 'undefined', 'new', 'of', 'in', 'break', 'continue', 'try',
  'catch', 'finally', 'throw', 'switch', 'case', 'default', 'typeof', 'class', 'this', 'delete',
  'void', 'with', 'yield', 'enum', 'export', 'extends', 'import', 'super', 'instanceof', 'static',
  'eval', 'arguments', 'Math', 'Number', 'NaN', 'Infinity',
]);

function jsName(name) {
  const clash = RESERVED_NAMES.has(name) || JS_RUNTIME_NAMES.includes(name) || SHADOWED.includes(name);
  return clash ? `${name}_` : name;
}

// A numeric param as an expression: a literal, one of this program's own variables, or a value
// some other object shares.
function arg(raw, fallback, own) {
  if (!isVariableRef(raw)) return String(num(raw, fallback));
  const name = raw.trim();
  return own.has(name) ? jsName(name) : `sharedValue('${esc(name)}')`;
}

const JS_OPS = {
  '+': (a, b) => `${a} + ${b}`,
  '-': (a, b) => `${a} - ${b}`,
  '*': (a, b) => `${a} * ${b}`,
  '/': (a, b) => `${a} / ${b}`,
  '^': (a, b) => `Math.pow(${a}, ${b})`,
  min: (a, b) => `Math.min(${a}, ${b})`,
  max: (a, b) => `Math.max(${a}, ${b})`,
  mod: (a, b) => `${a} % ${b}`,
};

const JS_FNS = {
  sqrt: (a) => `Math.sqrt(${a})`,
  square: (a) => `${a} * ${a}`,
  abs: (a) => `Math.abs(${a})`,
  round: (a) => `Math.round(${a})`,
  sin: (a) => `Math.sin(${a} * Math.PI / 180)`,
  cos: (a) => `Math.cos(${a} * Math.PI / 180)`,
  tan: (a) => `Math.tan(${a} * Math.PI / 180)`,
  asin: (a) => `Math.asin(${a}) * 180 / Math.PI`,
  acos: (a) => `Math.acos(${a}) * 180 / Math.PI`,
  atan: (a) => `Math.atan(${a}) * 180 / Math.PI`,
};

function jsCompare(p, own) {
  const a = arg(p.a, 0, own);
  const b = arg(p.b, 0, own);
  if (p.op === '=') return `Math.abs(${a} - ${b}) < 1e-9`;
  return `${a} ${p.op} ${b}`;
}

// A `say` text with {name} values in it, as a string expression. A {word} that is not a variable
// stays literal, which is what the block does with it.
function sayText(text, own) {
  const parts = String(text ?? '').split(/(\{[A-Za-z][A-Za-z0-9_]*\})/);
  const out = [];
  for (const part of parts) {
    const name = /^\{(.+)\}$/.exec(part)?.[1];
    if (name && own.has(name)) out.push(`formatValue(${jsName(name)})`);
    else if (part) out.push(`'${esc(part)}'`);
  }
  return out.length ? out.join(' + ') : "''";
}

function emitBlocks(blocks, depth, topLevel, own) {
  const out = [];
  const pad = IND.repeat(depth);
  for (const block of blocks || []) {
    const p = block.params || {};
    switch (block.type) {
      case 'repeat':
        out.push(`${pad}await repeat(${arg(p.count, 10, own)}, async () => {`);
        out.push(...emitBlocks(block.children, depth + 1, false, own));
        out.push(`${pad}});`);
        break;
      case 'repeatUntil':
        out.push(`${pad}while (!(${jsCompare(p, own)})) {`);
        out.push(...emitBlocks(block.children, depth + 1, false, own));
        out.push(`${pad}${IND}await wait(0);`);
        out.push(`${pad}}`);
        break;
      case 'ifCompare':
        out.push(`${pad}if (${jsCompare(p, own)}) {`);
        out.push(...emitBlocks(block.children, depth + 1, false, own));
        out.push(`${pad}}`);
        break;
      case 'setVar': if (p.name) out.push(`${pad}${jsName(p.name)} = ${arg(p.value, 0, own)};`); break;
      case 'changeVar': if (p.name) out.push(`${pad}${jsName(p.name)} += ${arg(p.value, 1, own)};`); break;
      case 'calc':
        if (p.name) out.push(`${pad}${jsName(p.name)} = ${(JS_OPS[p.op] || JS_OPS['+'])(arg(p.a, 1, own), arg(p.b, 1, own))};`);
        break;
      case 'mathFn':
        if (p.name) out.push(`${pad}${jsName(p.name)} = ${(JS_FNS[p.fn] || JS_FNS.sqrt)(arg(p.a, 1, own))};`);
        break;
      case 'randomVar': {
        const a = arg(p.a, 0, own);
        const b = arg(p.b, 1, own);
        if (p.name) out.push(`${pad}${jsName(p.name)} = ${a} + Math.random() * (${b} - ${a});`);
        break;
      }
      case 'shareVar':
        if (p.name && own.has(p.name)) out.push(`${pad}shareValue('${esc(p.name)}', ${jsName(p.name)});`);
        break;
      case 'sayValue': {
        const label = String(p.label ?? '').trim();
        const unit = String(p.unit ?? '').trim();
        const head = label ? (label.endsWith('$') ? label : `${label} `) : '';
        const tail = unit ? (/^[%.,;:!?)]/.test(unit) ? unit : ` ${unit}`) : '';
        // In brackets, because `5.toFixed(2)` is a syntax error when the value is a plain number.
        const value = `(${arg(p.value, 0, own)}).toFixed(2)`;
        out.push(`${pad}await say(${[head && `'${esc(head)}'`, value, tail && `'${esc(tail)}'`].filter(Boolean).join(' + ')});`);
        break;
      }
      case 'moveBoth': out.push(`${pad}await moveBoth(${arg(p.forward, 1, own)}, ${arg(p.up, 1, own)});`); break;
      case 'setTilt': out.push(`${pad}await setTilt(${arg(p.degrees, 0, own)});`); break;
      case 'forever':
        out.push(`${pad}await forever(async () => {`);
        out.push(...emitBlocks(block.children, depth + 1, false, own));
        out.push(`${pad}});`);
        break;
      case 'whenSaid':
        // A hat REGISTERS rather than runs, so it is not awaited -- and the block runner
        // only honours hats at the top level of a program, so a nested one transpiles to
        // the same nothing it does as a block.
        if (topLevel) {
          out.push(`${pad}whenSaid('${esc(p.text)}', async () => {`);
          out.push(...emitBlocks(block.children, depth + 1, false, own));
          out.push(`${pad}});`);
        } else {
          out.push(`${pad}// ("when an object says" only listens from the top level)`);
        }
        break;
      case 'wait': out.push(`${pad}await wait(${arg(p.seconds, 1, own)});`); break;
      case 'moveForward': out.push(`${pad}await moveForward(${arg(p.feet, 2, own)});`); break;
      case 'moveUp': out.push(`${pad}await moveUp(${arg(p.feet, 1, own)});`); break;
      case 'glide': out.push(`${pad}await glide(${arg(p.feet, 10, own)}, ${arg(p.seconds, 2, own)});`); break;
      case 'goHome': out.push(`${pad}await goBackToStart();`); break;
      case 'rotate': out.push(`${pad}await rotate(${arg(p.degrees, 15, own)});`); break;
      case 'say': out.push(`${pad}await say(${sayText(p.text, own)});`); break;
      case 'changeSize': out.push(`${pad}await changeSize(${arg(p.percent, 10, own)});`); break;
      case 'setSize': out.push(`${pad}await setSize(${arg(p.percent, 100, own)});`); break;
      case 'setOpacity': out.push(`${pad}await setOpacity(${arg(p.percent, 100, own)});`); break;
      case 'changeColor': out.push(`${pad}await changeColor('${esc(p.color || '#ffffff')}');`); break;
      case 'markerColor': out.push(`${pad}await markerColor('${esc(p.color || '#3d8bf2')}');`); break;
      case 'markerDown': out.push(`${pad}await markerDown();`); break;
      case 'markerUp': out.push(`${pad}await markerUp();`); break;
      case 'eraseMarks': out.push(`${pad}await eraseAllMarks();`); break;
      case 'duplicate': out.push(`${pad}await duplicate(${num(p.offset, 4)});`); break;
      case 'moveX': out.push(`${pad}await moveX(${num(p.feet, 1)});`); break;
      case 'moveY': out.push(`${pad}await moveY(${num(p.feet, 1)});`); break;
      case 'moveZ': out.push(`${pad}await moveZ(${num(p.feet, 1)});`); break;
      default: out.push(`${pad}// (unknown block "${block.type}" skipped)`); break;
    }
  }
  return out;
}

export function blocksToJs(blocks) {
  const own = variablesIn(blocks || []);
  const lines = emitBlocks(blocks || [], 0, true, own);
  // Block variables start at 0 and are visible to the whole program, hats included, so they are
  // declared once at the top rather than wherever the first `set` happens to be.
  if (own.size) lines.unshift(`let ${[...own].map((name) => `${jsName(name)} = 0`).join(', ')};`, '');
  return lines.length ? `${lines.join('\n')}\n` : '';
}

// What an empty program opens with in JavaScript view: a working example, not a blank
// page. `forever()` is in it deliberately -- the one JavaScript habit that matters here is
// putting loops through forever()/repeat() so the world keeps running.
export const JS_STARTER = `// Program this object with JavaScript.
// Put \`await\` in front of every action, and use forever() for loops
// so the rest of the world keeps running.

await forever(async () => {
  await rotate(15);
  await wait(0.5);
});
`;

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

// Order is the calling convention: compileJs() declares these as the function's
// parameters and ProgramManager passes the api's values in the same order.
export const JS_RUNTIME_NAMES = [
  'moveForward', 'moveUp', 'glide', 'rotate', 'goBackToStart',
  'wait', 'repeat', 'forever', 'whenSaid', 'duplicate',
  'say', 'changeSize', 'setSize', 'setOpacity', 'changeColor',
  'markerColor', 'markerDown', 'markerUp', 'eraseAllMarks',
  'moveX', 'moveY', 'moveZ',
  'moveBoth', 'setTilt', 'shareValue', 'sharedValue', 'formatValue',
];

// The one-line reference under the editor. Retired world-axis moves still run (old
// programs transpile to them) but are not advertised, same as the block palette.
export const JS_API_HINT = [
  'moveForward(ft)', 'moveUp(ft)', 'moveBoth(ft, ft)', 'glide(ft, sec)', 'rotate(deg)', 'setTilt(deg)', 'goBackToStart()',
  'wait(sec)', 'repeat(n, fn)', 'forever(fn)', "whenSaid('text', fn)", 'duplicate(ft)',
  "say('hi')", 'changeSize(%)', 'setSize(%)', 'setOpacity(%)', "changeColor('#ff5a12')",
  "markerColor('#00c2ff')", 'markerDown()', 'markerUp()', 'eraseAllMarks()',
].join('  ·  ');

// Globals a student's code should not reach BY ACCIDENT, shadowed as unpassed (and so
// undefined) parameters. This is accident-prevention, not a security boundary -- the code
// runs client-side in the student's own browser at the same trust level as everything
// else on the page, and a determined person can escape any parameter shadow. What this
// buys is that `alert()` cannot freeze the animate loop, `location = ...` cannot navigate
// the app away mid-lesson, and `document.title = ...` fails fast instead of "working".
// `eval` and `arguments` must NOT appear here: strict mode forbids them as parameter
// names and the whole compile would throw.
const SHADOWED = [
  'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames', 'location',
  'localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'Worker', 'Function', 'alert', 'confirm', 'prompt', 'open', 'close',
];

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Compiles a program's text into a callable async function, or returns the SyntaxError.
// An AsyncFunction rather than new Function, so top-level `await` works exactly as the
// transpiler and the starter template write it.
export function compileJs(code) {
  try {
    return { fn: new AsyncFunction(...JS_RUNTIME_NAMES, ...SHADOWED, `'use strict';\n${String(code ?? '')}`), error: null };
  } catch (error) {
    return { fn: null, error };
  }
}

// Builds the api values for one run. `run` is ProgramManager's per-run state:
// { pending: [{resolve, at}], hats: [{key, body, running}], ticks, noDuplicate } -- the
// manager resolves `pending` entries whose time has come once per frame, and bumps
// `ticks` for each one, which is what repeat's anti-hang guard below measures.
export function buildJsRuntime({ object3D, effects, run }) {
  const tick = () => new Promise((resolve) => { run.pending.push({ resolve, at: 0 }); });
  const sleepUntil = (at) => new Promise((resolve) => { run.pending.push({ resolve, at }); });

  // Perform a block-equivalent side effect, then hand the frame back.
  const act = async (fn) => { fn(); await tick(); };

  return {
    moveForward: (feet) => act(() => {
      object3D.position.addScaledVector(forwardOf(object3D), num(feet));
    }),
    // World Y, not the object's own up -- the block's documented exception.
    moveUp: (feet) => act(() => { object3D.position.y += num(feet); }),
    glide: async (feet, seconds) => {
      // Interpolated from the real clock, exactly as the block is, so the same program
      // takes the same time on a slow machine.
      const distance = num(feet);
      const secs = Math.max(0.05, num(seconds));
      const from = object3D.position.clone();
      const delta = forwardOf(object3D).clone().multiplyScalar(distance);
      const started = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - started) / (secs * 1000));
        object3D.position.copy(from).addScaledVector(delta, t);
        await tick();
        if (t >= 1) break;
      }
    },
    rotate: (degrees) => act(() => {
      object3D.rotation.y += THREE.MathUtils.degToRad(num(degrees));
    }),
    goBackToStart: () => act(() => {
      if (effects.home) {
        object3D.position.copy(effects.home.position);
        object3D.quaternion.copy(effects.home.quaternion);
        object3D.scale.copy(effects.home.scale);
      }
    }),
    wait: (seconds) => sleepUntil(performance.now() + Math.max(0, num(seconds)) * 1000),
    repeat: async (count, body) => {
      // At least one tick per pass even when the body awaited nothing -- the async
      // translation of the runner's rule that a pass which never yields must not spin
      // synchronously. `repeat(1e9, () => {})` is a slow counter, not a hung tab.
      const n = Math.max(0, Math.floor(num(count)));
      for (let i = 0; i < n; i++) {
        const before = run.ticks;
        if (typeof body === 'function') await body();
        if (run.ticks === before) await tick();
      }
    },
    forever: async (body) => {
      // The unconditional tick after every pass is the block's own documented behaviour
      // (one turn of `forever { rotate N }` costs two frames), kept identical so a
      // program reads the same speed whichever way it was written.
      for (;;) {
        if (typeof body === 'function') await body();
        await tick();
      }
    },
    whenSaid: (text, body) => {
      const key = String(text ?? '').trim().toLowerCase();
      if (key && typeof body === 'function') run.hats.push({ key, body, running: false });
    },
    duplicate: (feet) => act(() => {
      // `noDuplicate` is set on records created BY duplication (see Duplicator.js):
      // JavaScript cannot have its duplicate() stripped out the way a block tree can, so
      // the copy keeps its whole program and this one call becomes a no-op -- the same
      // "copies do not breed" rule by other means.
      if (!run.noDuplicate) effects.duplicate?.(num(feet, 4));
    }),
    say: (text) => act(() => effects.say?.(String(text ?? ''))),
    changeSize: (percent) => act(() => {
      const factor = 1 + num(percent) / 100;
      if (factor > 0) object3D.scale.multiplyScalar(factor);
    }),
    setSize: (percent) => act(() => {
      // Against the size at program START, via the same captured home the block uses.
      const p = Number(percent);
      if (Number.isFinite(p) && p > 0 && effects.home) {
        object3D.scale.copy(effects.home.scale).multiplyScalar(p / 100);
      }
    }),
    setOpacity: (percent) => act(() => applyOpacity(object3D, Number(percent))),
    changeColor: (color) => act(() => applyColorTint(object3D, color || '#ffffff')),
    markerColor: (color) => act(() => effects.markerColor?.(color || '#3d8bf2')),
    markerDown: () => act(() => effects.markerDown?.()),
    markerUp: () => act(() => effects.markerUp?.()),
    eraseAllMarks: () => act(() => effects.eraseMarks?.()),
    moveBoth: (forward, up) => act(() => {
      object3D.position.addScaledVector(forwardOf(object3D), num(forward));
      object3D.position.y += num(up);
    }),
    setTilt: (degrees) => act(() => {
      object3D.rotation.z = THREE.MathUtils.degToRad(num(degrees));
    }),
    // What `share` publishes, read and written without taking a frame, as the blocks do.
    shareValue: (name, value) => { effects.worldVars?.set(String(name), num(value)); },
    sharedValue: (name) => effects.worldVars?.get(String(name)) ?? 0,
    formatValue,
    moveX: (feet) => act(() => { object3D.position.x += num(feet); }),
    moveY: (feet) => act(() => { object3D.position.y += num(feet); }),
    moveZ: (feet) => act(() => { object3D.position.z += num(feet); }),
  };
}

// ---------------------------------------------------------------------------
// Syntax highlighting
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  'await', 'async', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do',
  'function', 'return', 'true', 'false', 'null', 'undefined', 'new', 'of', 'in',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'switch', 'case',
  'default', 'typeof', 'class', 'this',
]);

const API_NAMES = new Set(JS_RUNTIME_NAMES);

// One pass, one regex: comments, strings, numbers, identifiers -- in that order, so a
// keyword inside a string stays string-coloured. The string patterns tolerate a missing
// closing quote, because mid-keystroke that is the normal state of the text.
const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|('(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`])*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)/g;

function escHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightJs(code) {
  const src = String(code ?? '');
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(src); m; m = TOKEN.exec(src)) {
    out += escHtml(src.slice(last, m.index));
    const [text, comment, string, number, ident] = m;
    if (comment) out += `<span class="js-c">${escHtml(text)}</span>`;
    else if (string) out += `<span class="js-s">${escHtml(text)}</span>`;
    else if (number) out += `<span class="js-n">${escHtml(text)}</span>`;
    else if (ident && KEYWORDS.has(ident)) out += `<span class="js-k">${escHtml(text)}</span>`;
    else if (ident && API_NAMES.has(ident)) out += `<span class="js-f">${escHtml(text)}</span>`;
    else out += escHtml(text);
    last = m.index + text.length;
  }
  return out + escHtml(src.slice(last));
}
