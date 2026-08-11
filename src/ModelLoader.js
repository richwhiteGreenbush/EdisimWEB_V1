import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

// Shared by ImportManager (fresh imports) and WorldStore (rehydrating saved records) so
// both go through identical glTF/OBJ loading logic.

export function buildBatchLoadingManager(files) {
  const manager = new THREE.LoadingManager();
  const urlMap = new Map();
  for (const file of files) {
    urlMap.set(file.name, URL.createObjectURL(file));
  }
  manager.setURLModifier((url) => {
    if (urlMap.has(url)) return urlMap.get(url);
    const base = url.split('/').pop();
    if (base && urlMap.has(base)) return urlMap.get(base);
    return url;
  });
  return { manager, urlMap };
}

export async function loadModelFile({ file, ext, manager, mtlFile }) {
  const url = URL.createObjectURL(file);
  try {
    if (ext === 'glb' || ext === 'gltf') {
      const gltf = await new GLTFLoader(manager).loadAsync(url);
      return gltf.scene;
    }
    if (ext === 'obj') {
      const objLoader = new OBJLoader(manager);
      if (mtlFile) {
        const mtlUrl = URL.createObjectURL(mtlFile);
        try {
          const materials = await new MTLLoader(manager).loadAsync(mtlUrl);
          materials.preload();
          objLoader.setMaterials(materials);
        } finally {
          URL.revokeObjectURL(mtlUrl);
        }
      }
      return await objLoader.loadAsync(url);
    }
    throw new Error(`Unsupported model extension: .${ext}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Height is translation-invariant (and every placed model is yaw/pitch/roll-free), so
// this box3 read works whether the object is still at the origin (fresh import) or
// already positioned in the world (a later "resize" from the object menu).
function currentHeight(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  return box.max.y - box.min.y;
}

// Uniformly scales object3D (from whatever its current scale is) so its bounding-box
// height becomes targetHeight. Self-correcting: safe to call again later on an
// already-scaled, already-placed object (e.g. a "reset to 5ft" action).
export function scaleToHeight(object3D, targetHeight) {
  const height = currentHeight(object3D);
  if (height > 1e-6) {
    object3D.scale.multiplyScalar(targetHeight / height);
  }
}

// How far below its own local origin the object's lowest point sits, at its CURRENT
// scale. Call right after scaleToHeight and before positioning (object still at the
// origin) to know how much to lift it so its base lands on the ground, not its pivot.
export function groundLiftFor(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  return -box.min.y;
}
