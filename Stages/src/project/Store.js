// Autosave: the open project is kept in IndexedDB so a refresh, a crash or a closed laptop loses
// nothing.
//
// THE DATABASE IS `edusim-stages`, NEVER THE MAIN APP'S `3dcoder-world`. /stages/ and /app/ share an
// origin, so they share IndexedDB; a different name is what guarantees Stages can never read, write
// or wipe a student's Edusim world. The name is persisted the moment the first project is saved, so
// like DB_NAME it must never change.
import { normalise, plain } from './Project.js';

const DB = 'edusim-stages';
const STORE = 'projects';
const KEY = 'current';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSaved() {
  try {
    const raw = await run('readonly', (s) => s.get(KEY));
    return raw ? normalise(raw) : null;
  } catch (err) {
    console.warn('[stages] could not read the saved project', err);
    return null;
  }
}

export async function saveNow(project, drawOrder = null) {
  const p = plain(project);
  if (drawOrder) {
    const stage = p.targets.find((t) => t.isStage);
    const ids = drawOrder.filter((t) => !t.isClone).map((t) => t.id);
    p.targets = [stage, ...ids.map((id) => p.targets.find((t) => t.id === id)).filter(Boolean),
      ...p.targets.filter((t) => !t.isStage && !ids.includes(t.id))];
  }
  p.modified = new Date().toISOString();
  await run('readwrite', (s) => s.put(p, KEY));
}

// A save that waits for a pause in the editing, so dragging a block does not write the database
// sixty times a second.
export class AutoSaver {
  constructor(getProject, getOrder) {
    this.getProject = getProject;
    this.getOrder = getOrder;
    this.timer = null;
    this.enabled = true;
    this.onSaved = null;
  }

  touch() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 900);
  }

  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.enabled) return;
    try {
      await saveNow(this.getProject(), this.getOrder?.());
      this.onSaved?.();
    } catch (err) {
      console.warn('[stages] autosave failed', err);
    }
  }
}
