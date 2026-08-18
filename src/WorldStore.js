import { DB_NAME, DB_VERSION, STORE_NAME } from './config.js';
import { buildBatchLoadingManager, loadModelFile, scaleToHeight, seatBaseAt } from './ModelLoader.js';
import { loadImagePlane, loadImageElement } from './MediaLoader.js';
import { inflateFromCanvas } from './BalloonInflator.js';
import { loadLibraryModel, loadTreeModel, loadBillboardImage } from './StartupAssets.js';
import { createLightOrb } from './LightOrb.js';
import { createPrimitiveMesh, buildBuiltModel } from './Primitives.js';
import { applyWorldTheme, createThemeMarker, createSpawnMarker } from './SceneSetup.js';
import { buildProp } from './props/index.js';
import { DEFAULT_THEME } from './config.js';

// The spawn a set of records asks for, as PlayerController.resetTo() wants it, or null.
//
// It reads the marker's ordinary TRANSFORM rather than bespoke fields: position is where
// to stand and rotation[1] is which way to face. That keeps the spawn in the one place
// every other record already keeps its placement, so nothing else -- persistence, export,
// the gallery -- needs a special case for it.
//
// `y` is deliberately not carried through. PlayerController.resetTo() raycasts the ground
// at the given x/z and sits the camera at EYE_HEIGHT above whatever it finds, which is
// what makes a spawn survive a world being loaded under a different theme with completely
// different terrain -- a stored height would put the student in the air or underground.
export function spawnFromRecords(records) {
  const record = records?.find((r) => r?.kind === 'world-spawn');
  if (!record) return null;
  const [x = 0, , z = 0] = record.transform?.position || [];
  const [, yaw = 0] = record.transform?.rotation || [];
  return { x, z, yaw };
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function runTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
  });
}

function applyTransform(object3D, transform) {
  object3D.position.fromArray(transform.position);
  object3D.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
  object3D.scale.fromArray(transform.scale);
}

export class WorldStore {
  constructor({ scene, registry, menu, programManager, playIconManager, webBrowserManager, speechBubbles, markerTrail }) {
    this.scene = scene;
    this.registry = registry;
    this.menu = menu;
    this.programManager = programManager;
    this.playIconManager = playIconManager;
    this.markerTrail = markerTrail;
    this.speechBubbles = speechBubbles;
    this.webBrowserManager = webBrowserManager;
    this.dbPromise = openDB();

    // Best-effort: reduces the odds the browser evicts this data under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
  }

  // Every rehydration path funnels through here so a saved program resumes
  // automatically whether it came from IndexedDB or a loaded world file.
  addAndRun(record, object3D, extra = {}) {
    this.registry.add(record.id, object3D, { ...extra, record });
    if (record.program?.length) {
      this.programManager?.start(record.id, record.program, object3D);
    }
    this.playIconManager?.refresh(record.id, record, object3D);
  }

  async saveObject(record) {
    try {
      const db = await this.dbPromise;
      await runTx(db, 'readwrite', (store) => store.put(record));
    } catch (err) {
      const message =
        err?.name === 'QuotaExceededError'
          ? 'Storage is full — this was placed but may not be here next time.'
          : 'Could not save this for next time.';
      this.menu?.toast(message, { tone: 'error' });
    }
  }

  async clearAll() {
    const db = await this.dbPromise;
    await runTx(db, 'readwrite', (store) => store.clear());
  }

  // Removing one record, as opposed to wiping the world. Rendering a model is the only
  // thing that needs it: the construction pieces it consumed have to stop coming back on
  // the next refresh, or the student gets their model AND a ghost copy of its parts.
  async deleteObject(id) {
    try {
      const db = await this.dbPromise;
      await runTx(db, 'readwrite', (store) => store.delete(id));
    } catch {
      this.menu?.toast('Could not tidy up an old piece.', { tone: 'error' });
    }
  }

  // Replaces the entire live world with a set of records loaded from a saved world
  // file: wipes the current scene + IndexedDB, then rehydrates and re-persists each
  // given record so it becomes the new "live" state going forward.
  async loadFromRecords(records) {
    this.registry.clear();
    this.playIconManager?.clear();
    this.markerTrail?.clear();
    this.speechBubbles?.clear();
    this.webBrowserManager?.clear();
    await this.clearAll();

    // Settle the environment up front from whatever the incoming set asks for, so a
    // world file with no theme of its own resets a leftover moon sky back to daylight
    // instead of inheriting it. applyWorldTheme() is a no-op when the theme is already
    // live, which is what makes this free for the preset path (WorldPresets already
    // applied it in order to read correct ground heights) and idempotent when the
    // matching `world-theme` record comes back round through rehydrateOne() below.
    applyWorldTheme(records.find((record) => record?.kind === 'world-theme')?.theme || DEFAULT_THEME);

    for (const record of records) {
      try {
        await this.rehydrateOne(record);
        await this.saveObject(record);
      } catch (err) {
        console.error('Failed to load a record from the world file:', record?.kind, err);
      }
    }

    // Hand back where this world wants the player, or null if it does not say.
    //
    // Returned rather than acted on, because the caller is the only thing that knows
    // whether moving somebody is appropriate: a world opened from a link or a file should
    // place them, and a page refresh restoring the world they are already standing in
    // must not. `null` is the honest answer for every world file exported before spawns
    // existed, and every caller falls back to the app's own default for it.
    return spawnFromRecords(records);
  }

  async rehydrateAll() {
    let records;
    try {
      const db = await this.dbPromise;
      records = await runTx(db, 'readonly', (store) => store.getAll());
    } catch {
      return;
    }

    for (const record of records || []) {
      try {
        await this.rehydrateOne(record);
      } catch (err) {
        console.error('Failed to restore a placed object:', record?.primaryFileName || record?.kind, err);
      }
    }
  }

  async rehydrateOne(record) {
    if (record.kind === 'startup-library' || record.kind === 'startup-tree' || record.kind === 'startup-billboard') {
      const loader =
        record.kind === 'startup-library' ? loadLibraryModel : record.kind === 'startup-tree' ? loadTreeModel : loadBillboardImage;
      const result = await loader();
      const object3D = result?.mesh || result;
      const tick = result?.tick;
      applyTransform(object3D, record.transform);

      // Preset worlds reuse these fetched assets at their own real-world size, via two
      // optional fields that older records simply don't have.
      //
      // `targetHeight` exists because applyTransform() REPLACES scale wholesale, which
      // silently discards the scaleToHeight() normalization the loaders just applied --
      // so a record asking for "scale 4" would get four times the model's raw authored
      // size, not four times 5ft. Re-normalizing here is self-correcting no matter what
      // scale the transform left behind.
      //
      // `baseOnGround` then seats it: where a model's pivot sits relative to its base
      // is a property of the file, and depends on the final scale, so the record stores
      // the ground height and this puts the bottom of the model on it.
      if (record.targetHeight) scaleToHeight(object3D, record.targetHeight);
      if (record.baseOnGround) seatBaseAt(object3D, record.transform.position[1]);

      this.scene.add(object3D);
      this.addAndRun(record, object3D, { tick });
      return;
    }

    if (record.kind === 'world-theme') {
      applyWorldTheme(record.theme);
      const marker = createThemeMarker();
      applyTransform(marker, record.transform);
      this.scene.add(marker);
      this.addAndRun(record, marker);
      return;
    }

    // Where this world puts the player. Rehydrating it does not MOVE anybody -- moving is
    // the caller's decision, because the same records arrive by four different routes and
    // only some of them should reposition the student (a page refresh restoring what they
    // were already standing in must not). loadFromRecords() hands the spawn back instead.
    if (record.kind === 'world-spawn') {
      const marker = createSpawnMarker();
      applyTransform(marker, record.transform);
      this.scene.add(marker);
      this.addAndRun(record, marker);
      return;
    }

    // Preset-world scenery: rebuilt from its builder name + options every time, so no
    // geometry or texture bytes are ever stored. Same philosophy as light orbs.
    if (record.kind === 'preset-prop') {
      const object3D = buildProp(record.prop, record.options);
      applyTransform(object3D, record.transform);
      this.scene.add(object3D);
      this.addAndRun(record, object3D);
      return;
    }

    if (record.kind === 'light-orb') {
      const group = createLightOrb(record.color);
      applyTransform(group, record.transform);
      this.scene.add(group);
      this.addAndRun(record, group);
      return;
    }

    if (record.kind === 'web-browser') {
      const bezelMesh = this.webBrowserManager.createPanel(record, this);
      applyTransform(bezelMesh, record.transform);
      this.scene.add(bezelMesh);
      this.addAndRun(record, bezelMesh);
      return;
    }

    // Create Model's two kinds. Both rebuild their geometry from the record's parameters,
    // and both must be handled BEFORE the gltf/obj fall-through below -- that branch
    // assumes everything in `files` is a model file, so a primitive carrying a texture
    // PNG would be handed to the glTF parser.
    if (record.kind === 'primitive') {
      const mesh = await createPrimitiveMesh(record);
      applyTransform(mesh, record.transform);
      this.scene.add(mesh);
      this.addAndRun(record, mesh);
      return;
    }

    if (record.kind === 'built-model') {
      const group = await buildBuiltModel(record);
      applyTransform(group, record.transform);
      this.scene.add(group);
      this.addAndRun(record, group);
      return;
    }

    if (record.kind === 'balloon') {
      const fr = record.files[0];
      const url = URL.createObjectURL(fr.data);
      let img;
      try {
        img = await loadImageElement(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);

      const mesh = inflateFromCanvas(canvas);
      if (!mesh) return;
      applyTransform(mesh, record.transform);
      this.scene.add(mesh);
      this.addAndRun(record, mesh);
      return;
    }

    if (record.kind === 'image' || record.kind === 'gif') {
      const fr = record.files[0];
      const file = new File([fr.data], fr.name, { type: fr.type });
      const { mesh, tick } = await loadImagePlane(file, { isGif: record.kind === 'gif' });
      applyTransform(mesh, record.transform);
      this.scene.add(mesh);
      this.addAndRun(record, mesh, { tick });
      return;
    }

    // gltf / obj
    const files = record.files.map((f) => new File([f.data], f.name, { type: f.type }));
    const { manager, urlMap } = buildBatchLoadingManager(files);
    try {
      const primary = files.find((f) => f.name === record.primaryFileName) || files[0];
      const mtlFile = files.find((f) => /\.mtl$/i.test(f.name));
      const ext = record.kind === 'obj' ? 'obj' : /\.glb$/i.test(primary.name) ? 'glb' : 'gltf';
      const object3D = await loadModelFile({ file: primary, ext, manager, mtlFile });
      object3D.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      applyTransform(object3D, record.transform);
      this.scene.add(object3D);
      this.addAndRun(record, object3D);
    } finally {
      for (const url of urlMap.values()) URL.revokeObjectURL(url);
    }
  }
}
