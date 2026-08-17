import * as THREE from 'three';
import { buildBatchLoadingManager, loadModelFile, scaleToHeight } from './ModelLoader.js';
import { loadImagePlane } from './MediaLoader.js';
import { MODEL_TARGET_HEIGHT } from './config.js';

// The three assets fetched from public/: a little library building, a maple tree, and
// an image billboard. These re-fetch from their fixed URL every time (including on
// rehydrate) rather than storing file bytes in IndexedDB -- they're project assets,
// not user uploads, so there's nothing to gain from duplicating them into the
// database, and it's the only way the tree's manually-applied bark/leaf textures (it
// ships with no .mtl) survive a reload.
//
// They are no longer placed by a boot routine of their own: the Park preset world
// places them as records (visitor centre, specimen maples, welcome banner), which is
// why only the three loaders live here now. Their `startup-*` record kinds are
// unchanged, so worlds saved before the Park existed still rehydrate.

// Every url here names a file shipped in `public/`, so it must resolve RELATIVE to
// wherever the bundle is mounted -- an origin root, or /app/ on the gallery's host. A
// leading slash instead looks for it at the domain root, which under /app/ is the
// marketing site: the fetch 404s and the asset silently never appears.
//
// The strip is here rather than at each call site because this is the one funnel they all
// go through, and the failure is invisible in dev (where the app IS at a root) and shows
// up only as a missing object in production. Two of the three loaders were already
// converted by hand and the third was missed, which is precisely the argument for making
// the guard structural instead of remembering it each time.
async function fetchAsFile(url, name, type) {
  const relative = url.replace(/^\/+/, '');
  const res = await fetch(relative);
  if (!res.ok) throw new Error(`Failed to fetch ${relative}: ${res.status}`);
  const blob = await res.blob();
  return new File([blob], name, { type: type || blob.type });
}

async function loadTexture(url, { srgb = true } = {}) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function tagShadows(object3D) {
  object3D.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

export async function loadLibraryModel() {
  const [objFile, mtlFile] = await Promise.all([
    fetchAsFile('library/mini-library.obj', 'mini-library.obj'),
    fetchAsFile('library/mini-library.mtl', 'mini-library.mtl'),
  ]);
  const { manager, urlMap } = buildBatchLoadingManager([objFile, mtlFile]);
  try {
    const object3D = await loadModelFile({ file: objFile, ext: 'obj', manager, mtlFile });
    scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
    tagShadows(object3D);
    return object3D;
  } finally {
    for (const url of urlMap.values()) URL.revokeObjectURL(url);
  }
}

// Ships as MapleTree.obj with no accompanying .mtl -- the object names inside it
// (tree_Mesh / leaves / leaves.001, confirmed by inspecting the file) are matched
// here to the loose bark/leaf/mask textures that came with it.
export async function loadTreeModel() {
  const objFile = await fetchAsFile('tree/MapleTree.obj', 'MapleTree.obj');
  const { manager, urlMap } = buildBatchLoadingManager([objFile]);
  let object3D;
  try {
    object3D = await loadModelFile({ file: objFile, ext: 'obj', manager });
  } finally {
    for (const url of urlMap.values()) URL.revokeObjectURL(url);
  }

  const [barkTexture, leafTexture, leafMask] = await Promise.all([
    loadTexture('tree/maple_bark.png'),
    loadTexture('tree/maple_leaf.png'),
    loadTexture('tree/maple_leaf_Mask.png', { srgb: false }),
  ]);

  object3D.traverse((node) => {
    if (!node.isMesh) return;
    if (node.name === 'tree_Mesh') {
      node.material = new THREE.MeshStandardMaterial({ map: barkTexture, roughness: 0.9 });
    } else if (node.name === 'leaves' || node.name === 'leaves.001') {
      node.material = new THREE.MeshStandardMaterial({
        map: leafTexture,
        alphaMap: leafMask,
        transparent: true,
        alphaTest: 0.4,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
    }
  });

  tagShadows(object3D);
  scaleToHeight(object3D, MODEL_TARGET_HEIGHT);
  return object3D;
}

export async function loadBillboardImage() {
  const file = await fetchAsFile('NewEdusim.png', 'NewEdusim.png', 'image/png');
  return loadImagePlane(file, { isGif: false });
}
