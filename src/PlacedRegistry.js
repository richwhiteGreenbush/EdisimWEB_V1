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
  }

  add(id, object3D, { tick, record } = {}) {
    object3D.userData.placedId = id;
    this.items.set(id, { object3D, tick, record });
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

  tick() {
    for (const item of this.items.values()) item.tick?.update?.();
  }

  get count() {
    return this.items.size;
  }
}
