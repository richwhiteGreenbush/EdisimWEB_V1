import { popIn } from './Motion.js';

// Tracks every live, placed Object3D (from imports, images, or drawn balloons) so
// ImportManager, DrawTool, and WorldStore can all add/remove/dispose through one place.

function disposeObject3D(root) {
  root.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
          material[key]?.dispose?.();
        }
        material.dispose();
      }
    }
  });
}

export class PlacedRegistry {
  constructor(scene, programManager) {
    this.scene = scene;
    this.programManager = programManager;
    this.items = new Map(); // id -> { object3D, tick, record }
    this.motion = null;
    // Set while a whole world is being rehydrated. add() is the single funnel every
    // placement goes through, which is exactly what makes it the right hook for the birth
    // pop -- and exactly why it needs this: without it, opening a world pops all 116 of
    // The Neighborhood's records at once, which is not an arrival, it is a fireworks
    // display in front of somebody trying to look at a town.
    this.bulkLoading = false;
  }

  add(id, object3D, { tick, baseTick, stickerTick, record } = {}) {
    object3D.userData.placedId = id;
    // baseTick and stickerTick are kept alongside the composed `tick` so a motion sticker
    // can be swapped at runtime without disposing the record's own tick with it -- an
    // animated GIF's canvas timer must survive a student trying all six stickers.
    this.items.set(id, { object3D, tick, baseTick, stickerTick, record });
    // A placed thing ARRIVES rather than simply being there. One hook, seven call sites,
    // all fifteen record kinds. Skipped for the world-theme and world-spawn markers,
    // which are invisible bookkeeping objects rather than things anybody watches.
    if (this.motion && !this.bulkLoading && record?.kind !== 'world-theme' && record?.kind !== 'world-spawn') {
      popIn(this.motion, object3D);
    }
  }

  get(id) {
    return this.items.get(id);
  }

  // Every root object3D, for raycasting against.
  getRootObjects() {
    return [...this.items.values()].map((item) => item.object3D);
  }

  // Walks up from a raycast hit (which may be a deep child mesh) to find which
  // registered root it belongs to.
  resolveRoot(object3D) {
    let node = object3D;
    while (node) {
      if (node.userData?.placedId) return node.userData.placedId;
      node = node.parent;
    }
    return null;
  }

  remove(id) {
    const item = this.items.get(id);
    if (!item) return;
    this.programManager?.stop(id);
    this.scene.remove(item.object3D);
    disposeObject3D(item.object3D);
    item.tick?.dispose?.();
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  // Called every frame from main.js's animate loop.
  //
  // `dt` and `camera` are passed through deliberately. For years this was `update?.()`
  // with no arguments and only animated GIFs used it, so nobody noticed -- but a tick
  // that counts FRAMES instead of seconds runs at a different speed on every machine,
  // which is exactly the reason `glide` reads a real clock rather than counting ticks.
  // Widening it is backward compatible: MediaLoader's GIF tick takes no parameters and
  // ignores extras.
  //
  // The camera goes through for the same reason it is cheap to: a creature that turns to
  // watch the student needs to know where they are standing, and handing it the camera
  // beats every alternative (a module-level singleton, a second registration path, a
  // manager that walks the registry a second time).
  //
  // NOTE the ordering this runs in: registry.tick() is called BEFORE programManager.tick(),
  // so anything here reads LAST frame's position for an object a program is moving. That
  // is invisible under `glide` and a full eight feet of lag under `forever { moveForward
  // 8 }`. Anything that has to sample a programmed object belongs after the program runs
  // -- which is where markerTrail.tick() already sits, for exactly this reason.
  tick(dt = 0, camera = null) {
    for (const item of this.items.values()) item.tick?.update?.(dt, camera);
  }

  get count() {
    return this.items.size;
  }
}
