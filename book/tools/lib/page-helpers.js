// Injected into the running app (window.__book). Everything here goes through the app's
// own record kinds and WorldStore.rehydrateOne -- the same path a saved world takes back
// in -- so what the camera sees is exactly what a reader's build would be.
(() => {
  const D = () => window.__debug;
  const rad = (deg) => (deg * Math.PI) / 180;
  const added = new Set();

  async function blocks() {
    return import('/src/BlockDefs.js');
  }

  // ['repeat', { count: 4 }, [ ['glide', { feet: 20, seconds: 4 }], ['rotate', { degrees: 90 }] ]]
  async function program(spec) {
    const B = await blocks();
    const build = (node) => {
      const [type, params = {}, children] = node;
      const b = B.createBlockInstance(type);
      Object.assign(b.params, params);
      if (children) b.children = children.map(build);
      return b;
    };
    return spec.map(build);
  }

  function signBlob(text = 'EDUSIM STATION') {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#fff6df';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#e0455f';
    g.lineWidth = 22;
    g.strokeRect(11, 11, c.width - 22, c.height - 22);
    g.fillStyle = '#1e2a3a';
    g.font = 'bold 120px Fredoka, Nunito, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2 + 6);
    return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  }

  async function fileFor(part) {
    if (!part.image) return null;
    const data = await signBlob(part.text);
    return { name: 'station-sign.png', type: 'image/png', data };
  }

  const ground = (x, z) => D().player.groundHeightAt(x, z);

  // New objects normally "pop" in, growing from nothing over a fraction of a second. A
  // screenshot (or a framing measurement) taken mid-pop sees a shrunken model, so these
  // helpers add records the way a world load does, with the pop switched off.
  async function quietly(fn) {
    const r = D().registry;
    const prev = r.bulkLoading;
    r.bulkLoading = true;
    try { return await fn(); } finally { r.bulkLoading = prev; }
  }

  // Loose construction pieces -- each with its own hammer, joined in a chain.
  async function addPieces(parts, origin = [0, 0], { rotY = 0, only } = {}) {
    const ids = [];
    const [ox, oz] = origin;
    const gy = ground(ox, oz);
    const cos = Math.cos(rad(rotY)), sin = Math.sin(rad(rotY));
    for (const part of parts) {
      if (only && !only.includes(part.name)) continue;
      const [px, py, pz] = part.pos;
      const wx = ox + px * cos + pz * sin;
      const wz = oz - px * sin + pz * cos;
      const file = await fileFor(part);
      const record = {
        id: crypto.randomUUID(),
        kind: 'primitive',
        createdAt: Date.now(),
        shape: part.shape,
        color: part.color,
        connections: ids.length ? [ids[0]] : [],
        transform: {
          position: [wx, gy + py, wz],
          rotation: [rad(part.rot[0]), rad(part.rot[1] + rotY), rad(part.rot[2])],
          scale: part.scale,
        },
        ...(file ? { files: [file] } : {}),
      };
      await quietly(() => D().worldStore.rehydrateOne(record));
      ids.push(record.id);
      added.add(record.id);
    }
    return ids;
  }

  // A finished model, exactly as Render Model would leave it: one built-model record,
  // origin at its base centre, rotation 0 (then turned by rotY, as a program would).
  async function addModel(parts, origin = [0, 0], { rotY = 0, programSpec, scale = 1 } = {}) {
    const [ox, oz] = origin;
    const files = [];
    const outParts = [];
    for (const part of parts) {
      const file = await fileFor(part);
      let fileIndex = null;
      if (file) {
        files.push(file);
        fileIndex = files.length - 1;
      }
      outParts.push({
        shape: part.shape,
        color: part.color,
        fileIndex,
        position: part.pos,
        rotation: part.rot.map(rad),
        scale: part.scale,
      });
    }
    const record = {
      id: crypto.randomUUID(),
      kind: 'built-model',
      createdAt: Date.now(),
      parts: outParts,
      files,
      transform: { position: [ox, ground(ox, oz), oz], rotation: [0, rad(rotY), 0], scale: [scale, scale, scale] },
    };
    if (programSpec) record.program = await program(programSpec);
    await quietly(() => D().worldStore.rehydrateOne(record));
    added.add(record.id);
    return record.id;
  }

  async function setProgram(id, spec) {
    const item = D().registry.get(id);
    item.record.program = await program(spec);
    D().programManager.start(id, item.record.program, item.object3D);
    D().playIconManager.refresh(id, item.record, item.object3D);
  }

  // Everything that was in the world when a scene began. A scene may add records by
  // routes this file does not see (a hung photo, a light orb, a duplicate), so cleanup
  // removes whatever is new rather than only what addPieces/addModel made.
  let base = null;
  function baseline() {
    base = new Set(D().registry.items.keys());
  }

  function removeAdded() {
    if (base) for (const id of [...D().registry.items.keys()]) if (!base.has(id)) added.add(id);
    for (const id of added) {
      if (D().registry.get(id)) {
        D().programManager.stop(id);
        D().registry.remove(id);
      }
    }
    added.clear();
    D().playIconManager.clear?.();
    D().markerTrail?.clear?.();
    D().speechBubbles?.clear?.();
  }

  // Remove EVERY record of the given kinds, the world's own included.
  function removeKinds(kinds) {
    for (const [id, item] of [...D().registry.items.entries()]) {
      if (kinds.includes(item.record?.kind) || kinds.includes(item.record?.prop)) D().registry.remove(id);
    }
  }

  // Project a world point to CSS pixels, for placing a menu where a click would put it.
  function screenOf(id) {
    const { camera, registry, THREE } = D();
    const o = registry.get(id).object3D;
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    c.project(camera);
    return { x: Math.round((c.x + 1) / 2 * innerWidth), y: Math.round((1 - c.y) / 2 * innerHeight) };
  }

  // Put the camera where a box fills `fill` of the frame (1 = touching the edge), seen
  // from compass bearing `az` (0 = straight in front of a model, i.e. from +Z; positive
  // swings round to its right, toward +X) and `el` degrees above it. The distance is found
  // by projecting the box's corners through the real camera, so it is exact for any shape.
  function frame({ ids, box: given, az = 30, el = 15, fill = 0.72, pan = 0, tilt = 0, minEye = 0.35 } = {}) {
    const { camera, registry, THREE, player } = D();
    // Fit the corners of EACH object's own box, not the corners of one box round all of
    // them: for a spread-out scene the union box's nearest corner is empty grass, and
    // fitting that pushes the camera much further back than anything visible needs.
    const box = new THREE.Box3();
    const corners = [];
    const addCorners = (b) => {
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
      box.union(b);
    };
    if (given) addCorners(new THREE.Box3(new THREE.Vector3(...given.min), new THREE.Vector3(...given.max)));
    else {
      const list = ids || [...registry.items.keys()].filter((id) => !base || !base.has(id));
      for (const id of list) {
        const it = registry.get(id);
        if (!it) continue;
        const b = new THREE.Box3().setFromObject(it.object3D);
        if (!b.isEmpty()) addCorners(b);
      }
    }
    const c = box.getCenter(new THREE.Vector3());
    const a = rad(az), e = rad(el);
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
    const place = (d) => {
      const p = c.clone().addScaledVector(dir, d);
      const gy = player.groundHeightAt(p.x, p.z);
      const eye = Math.max(minEye, p.y - gy);
      player.setEyeHeight(eye);
      const dx = c.x - p.x, dz = c.z - p.z, dy = c.y - (gy + eye);
      player.resetTo({ x: p.x, z: p.z, yaw: Math.atan2(-dx, -dz) + rad(pan), pitch: Math.atan2(dy, Math.hypot(dx, dz)) + rad(tilt) });
      camera.updateMatrixWorld(true);
      let m = 0;
      for (const k of corners) {
        const v = k.clone().project(camera);
        if (v.z > 1 || v.z < -1) return Infinity;
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
      return m;
    };
    let lo = 0.5, hi = 400;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      if (place(mid) > fill) lo = mid; else hi = mid;
    }
    place(hi);
    return hi;
  }

  function newBoxes() {
    const { registry, THREE } = D();
    return [...registry.items.entries()].filter(([id]) => !base || !base.has(id)).map(([id, it]) => {
      const b = new THREE.Box3().setFromObject(it.object3D);
      return [it.record?.kind, b.min.toArray().map((v) => +v.toFixed(1)), b.max.toArray().map((v) => +v.toFixed(1))];
    });
  }

  window.__book = { newBoxes, frame, baseline, program, addPieces, addModel, setProgram, removeAdded, removeKinds, screenOf, ground };
})();
