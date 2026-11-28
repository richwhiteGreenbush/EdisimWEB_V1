// Handing a project between Edusim Stages (/stages/) and Edusim (/app/, /hifi/).
//
// The two apps share an origin, so they can hand a project across through IndexedDB. THE LINK
// CARRIES A TOKEN, NEVER A PROJECT OR AN ADDRESS: the main app's ?world= rule. A token only ever
// names something this browser itself stored a moment ago, so a link cannot make either app fetch
// or open anything else. A token is read once and deleted, and anything left over is swept after
// an hour.
//
// Used by both apps: Stages imports it directly, the main app from ../Stages/src/project/.
//
// Payloads:
//   { type: 'convert', title, layout, scale, preset, projectText }      Stages -> 3D, a new world
//   { type: 'update', recordId, projectText }                            Stages -> 3D, one stage updated
//   { type: 'edit', recordId, projectText }                              3D -> Stages, edit this one

const DB = 'edusim-stages'; // the Stages database, see Store.js. Never the main app's 3dcoder-world.
const STORE = 'projects';
const MAX_AGE = 60 * 60 * 1000;
export const TOKEN_PATTERN = /^[a-z0-9]{24}$/;
export const CHANNEL = 'edusim-stages-link';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export function newToken() {
  const bytes = new Uint8Array(12);
  if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putHandoff(payload) {
  const token = newToken();
  await tx('readwrite', (s) => s.put({ ...payload, created: Date.now() }, `handoff:${token}`));
  return token;
}

// Reads a handoff and deletes it. Null for a token of the wrong shape, one that is not there, or one
// older than an hour.
export async function takeHandoff(token) {
  if (!TOKEN_PATTERN.test(String(token || ''))) return null;
  const key = `handoff:${token}`;
  const value = await tx('readonly', (s) => s.get(key));
  await tx('readwrite', (s) => s.delete(key)).catch(() => {});
  if (!value || Date.now() - (value.created || 0) > MAX_AGE) return null;
  return value;
}

export async function sweepHandoffs() {
  try {
    const keys = await tx('readonly', (s) => s.getAllKeys());
    const old = [];
    for (const k of keys || []) {
      if (!String(k).startsWith('handoff:')) continue;
      const v = await tx('readonly', (s) => s.get(k));
      if (!v || Date.now() - (v.created || 0) > MAX_AGE) old.push(k);
    }
    for (const k of old) await tx('readwrite', (s) => s.delete(k));
  } catch { /* storage blocked: nothing to sweep */ }
}

// Reads ?<param>=<token> off the address and strips it, so a refresh cannot replay it (the main
// app's takeLinkedWorldId rule).
export function takeTokenParam(param) {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return null; }
  const token = params.get(param);
  if (!token) return null;
  params.delete(param);
  const q = params.toString();
  try { history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash); } catch { /* fine */ }
  return TOKEN_PATTERN.test(token) ? token : null;
}
