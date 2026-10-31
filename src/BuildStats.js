import { JS_RUNTIME_NAMES } from './JsProgram.js';

// The detail under "Built" on the gallery's stats page: which world, which kind of object,
// which SHAPE of program. Read EdusimWorldDatabase/lib/stats.php's header first.
//
// WHAT LEAVES THIS FILE IS NAMES OFF A FIXED LIST, and that is what keeps the privacy page
// true. A program's numbers, its `say` text, its colours and every character of its
// JavaScript stay on the machine, as do uploaded file names, pictures and browser-panel
// addresses. `forever(rotate)` says what a program is made of and nothing a student wrote.
// The server holds the same lists (lib/stats-vocab.php) and stores `other` for anything not
// on them, so this file is not the only thing standing behind that sentence.
//
// There is no id in any request. A count is one fire-and-forget POST through the same
// window.edusimCount the page counter uses, so Do Not Track and Global Privacy Control turn
// it off the same way, and an absent endpoint is indistinguishable from a working one.

const WORLD_KEY = 'edusim-stats-world';

// One count per distinct (world, object, program) per app session -- the `built` counter's
// rule, "a session, not a shape". A lesson placing four hundred cubes is one line and one
// request. The cap bounds what one session can send however many combinations it finds.
const MAX_COUNTS_PER_SESSION = 80;

// A program with more blocks than this is cut off and ends in `...`. Past this length the
// row says "a very long program", which is all anybody can use it for.
const MAX_SIGNATURE_BLOCKS = 40;

let enabled = false;
const counted = new Set();
// Objects a running `duplicate` block made. A program did those, not a person, and the
// program itself is what gets counted.
const programCopies = new WeakSet();

// HiFi runs PlacedRegistry and ProgramEditor out of this same src/ and never calls this, so
// nothing here happens there. Neither does the Social Media Studio, which films its own
// builds: main.js leaves it off in ?studio.
export function enableBuildStats() {
  enabled = true;
}

// localStorage because a world survives a refresh and its name has to survive with it, or
// everything built after one reads as "unknown". Wrapped because localStorage throws in a
// browser set to block site data. The value is a label from this file's own short list,
// never a file name, and it is never sent except beside a count.
export function setStatsWorld(label) {
  try {
    localStorage.setItem(WORLD_KEY, label);
  } catch (err) { /* it reads as "unknown" instead */ }
}

function statsWorld() {
  try {
    return localStorage.getItem(WORLD_KEY) || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

export function markProgramCopy(record) {
  programCopies.add(record);
}

// Every kind maps to a label here, and nothing else off the record is read: a gltf record
// holds its file name and a web-browser record its address.
export function objectLabel(record) {
  switch (record?.kind) {
    case 'primitive': return `shape:${record.shape}`;
    case 'preset-prop': return `prop:${record.prop}`;
    case 'catalog-model': return `catalog:${record.model}`;
    case 'gltf':
    case 'obj': return 'model';
    case 'built-model':
    case 'image':
    case 'gif':
    case 'balloon':
    case 'light-orb':
    case 'web-browser':
    case 'startup-library':
    case 'startup-tree':
    case 'startup-billboard':
    case 'startup-llama': return record.kind;
    default: return 'other';
  }
}

function blockSignature(blocks, budget) {
  const parts = [];
  for (const block of blocks || []) {
    if (budget.left <= 0) {
      parts.push('...');
      break;
    }
    budget.left -= 1;
    // type and children only. block.params is where everything a student typed lives.
    parts.push(block.children?.length
      ? `${block.type}(${blockSignature(block.children, budget)})`
      : block.type);
  }
  return parts.join(',');
}

// Comments and strings go first, because they are the only places a student's own words are
// in JavaScript, and the names are then matched against the runtime's own list -- so what
// comes out is a set of known api calls whatever the program says.
const JS_NOISE = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?|`(?:\\.|[^`])*`?/g;

function jsSignature(code) {
  const text = String(code ?? '').replace(JS_NOISE, ' ');
  const used = JS_RUNTIME_NAMES.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(text));
  return used.length ? `js:${used.join(',')}` : 'js:';
}

export function programSignature(record) {
  if (record?.programMode === 'js') return jsSignature(record.programJs);
  return blockSignature(record?.program, { left: MAX_SIGNATURE_BLOCKS });
}

function count(kind, object, program) {
  if (!enabled) return;
  const world = statsWorld();
  const key = `${kind}|${world}|${object}|${program}`;
  if (counted.has(key) || counted.size >= MAX_COUNTS_PER_SESSION) return;
  counted.add(key);
  try {
    window.edusimCount?.(kind, '/app/', { world, object, program });
  } catch (err) { /* counting can never be the reason a shape fails to appear */ }
}

export function countPlaced(record) {
  if (!record || record.kind === 'world-theme' || record.kind === 'world-spawn') return;
  if (programCopies.has(record)) return;
  count('placed', objectLabel(record), '');
}

export function countProgram(record) {
  const program = programSignature(record);
  if (program) count('programmed', objectLabel(record), program);
}
