// The project: what a student makes, saves and shares.
//
// THE SAVED FORMAT IS PERSISTED FROM VERSION 1, so every field below is ADD-ONLY. A project file is
// `<title>.edusim-stages.json`:
//
//   { format: 'edusim-stages', version: 1, title, created, modified,
//     targets: [ stage, ...sprites ],            the stage first; sprites in layer order, back first
//     monitors: [ { id, kind, target, name | opcode + params, x, y, visible, mode } ],
//     messages: [ 'message1', ... ],
//     assets: [ { id, name, type, data } ] }     data is base64 in a file and a Blob everywhere else
//
//   target: { id, name, isStage, x, y, direction, size, visible, rotationStyle, draggable,
//             currentCostume, costumes: [costume], sounds: [sound], variables: { name: value },
//             scripts: [script], volume, library? }
//   costume: { id, name, assetId, cx, cy, resolution, width, height }
//   sound:   { id, name, assetId, duration }
//
// Anything under a key starting with `_` is runtime state and is never saved.
import { newId } from '../blocks/make.js';

export const FORMAT = 'edusim-stages';
export const VERSION = 1;
export const FILE_SUFFIX = '.edusim-stages.json';

export function emptyProject(title = 'Untitled') {
  const now = new Date().toISOString();
  return {
    format: FORMAT, version: VERSION, title, created: now, modified: now,
    targets: [makeStage()], monitors: [], messages: ['message1'], assets: [],
  };
}

export function makeStage() {
  return {
    id: 'stage', name: 'Stage', isStage: true, x: 0, y: 0, direction: 90, size: 100, visible: true,
    rotationStyle: 'all around', draggable: false, currentCostume: 0, costumes: [], sounds: [],
    variables: { 'my variable': 0 }, scripts: [], volume: 100,
  };
}

export function makeSprite(name, extra = {}) {
  return {
    id: newId('t'), name, isStage: false, x: 0, y: 0, direction: 90, size: 100, visible: true,
    rotationStyle: 'all around', draggable: false, currentCostume: 0, costumes: [], sounds: [],
    variables: {}, scripts: [], volume: 100, ...extra,
  };
}

export const stageOf = (project) => project.targets.find((t) => t.isStage);
export const spritesOf = (project) => project.targets.filter((t) => !t.isStage);
export const assetById = (project, id) => project.assets.find((a) => a.id === id) || null;

// A name nobody else in the project has: "Leo", "Leo2", "Leo3"...
export function uniqueName(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  const stem = base.replace(/\d+$/, '') || base;
  for (let i = 2; ; i++) if (!used.has(`${stem}${i}`)) return `${stem}${i}`;
}

// Every message any block in the project broadcasts or listens for, plus the ones the student made.
export function messagesIn(project) {
  const set = new Set(project.messages || []);
  for (const t of project.targets) {
    for (const s of t.scripts || []) {
      walk(s.blocks, (b) => {
        if (b.inputs?.BROADCAST?.value) set.add(b.inputs.BROADCAST.value);
      });
    }
  }
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function walk(blocks, fn) {
  for (const b of blocks || []) {
    fn(b);
    for (const i of Object.values(b.inputs || {})) if (i.block) walk([i.block], fn);
    walk(b.substack, fn);
    walk(b.substack2, fn);
  }
}
export { walk as walkProjectBlocks };

// Removes any asset no costume or sound uses any more, so a file does not carry dead pictures.
export function pruneAssets(project) {
  const used = new Set();
  for (const t of project.targets) {
    for (const c of t.costumes) used.add(c.assetId);
    for (const s of t.sounds) used.add(s.assetId);
  }
  project.assets = project.assets.filter((a) => used.has(a.id));
}

// Strips runtime-only state (`_` keys) for saving. Blobs are kept: IndexedDB stores them as they are,
// and the file writer base64s them.
export function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('_')) continue;
      out[k] = plain(v);
    }
    return out;
  }
  return value;
}

// --- files -----------------------------------------------------------------------------------

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function toFileText(project, drawOrder = null) {
  const p = plain(project);
  if (drawOrder) {
    const stage = p.targets.find((t) => t.isStage);
    const order = drawOrder.filter((t) => !t.isClone).map((t) => t.id);
    p.targets = [stage, ...order.map((id) => p.targets.find((t) => t.id === id)).filter(Boolean),
      ...p.targets.filter((t) => !t.isStage && !order.includes(t.id))];
  }
  p.modified = new Date().toISOString();
  p.assets = await Promise.all(p.assets.map(async (a) => ({ id: a.id, name: a.name, type: a.type, data: await blobToBase64(a.data) })));
  return JSON.stringify(p);
}

// Reads a project file. Everything is checked BEFORE the caller replaces what is open, so a broken
// file leaves the student's work alone (the main app's loadFromRecords rule).
export function fromFileText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not an Edusim Stages project (it is not readable JSON).'); }
  if (!raw || raw.format !== FORMAT) throw new Error('That file is not an Edusim Stages project.');
  if (typeof raw.version !== 'number' || raw.version > VERSION) {
    throw new Error('That project was made with a newer Edusim Stages. Refresh the page to get the latest version, then try again.');
  }
  return normalise({
    ...raw,
    assets: (raw.assets || []).map((a) => ({ id: a.id, name: a.name, type: a.type, data: base64ToBlob(a.data || '', a.type || 'application/octet-stream') })),
  });
}

// Fills in anything an older or hand-made project leaves out, so nothing downstream has to ask.
export function normalise(p) {
  p.format = FORMAT;
  p.version = p.version || VERSION;
  p.title = String(p.title || 'Untitled');
  p.targets = Array.isArray(p.targets) ? p.targets : [];
  if (!p.targets.some((t) => t.isStage)) p.targets.unshift(makeStage());
  const stage = p.targets.find((t) => t.isStage);
  p.targets = [stage, ...p.targets.filter((t) => !t.isStage)];
  for (const t of p.targets) {
    const base = t.isStage ? makeStage() : makeSprite(t.name || 'Sprite');
    for (const [k, v] of Object.entries(base)) if (t[k] === undefined) t[k] = v;
    t.costumes = (t.costumes || []).filter((c) => c && c.assetId);
    t.sounds = (t.sounds || []).filter((s) => s && s.assetId);
    t.scripts = (t.scripts || []).filter((s) => s && Array.isArray(s.blocks));
    t.variables = t.variables && typeof t.variables === 'object' ? t.variables : {};
    if (t.currentCostume >= t.costumes.length) t.currentCostume = 0;
  }
  p.monitors = Array.isArray(p.monitors) ? p.monitors : [];
  p.messages = Array.isArray(p.messages) ? p.messages : ['message1'];
  p.assets = Array.isArray(p.assets) ? p.assets : [];
  return p;
}

export function safeFileName(title) {
  return `${String(title || 'project').replace(/[^a-z0-9 _-]+/gi, '').trim().replace(/\s+/g, '-') || 'project'}${FILE_SUFFIX}`;
}
