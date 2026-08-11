import * as THREE from 'three';
import { buildBatchLoadingManager, loadModelFile, scaleToHeight, groundLiftFor } from './ModelLoader.js';
import { loadImagePlane } from './MediaLoader.js';
import { faceCamera } from './Placement.js';
import { MODEL_TARGET_HEIGHT, STARTUP_ASSET_SPACING } from './config.js';

// Boot-time world content: a library building, a maple tree, and an image billboard,
// fetched from public/ static assets. These re-fetch from their fixed URL every time
// (including on rehydrate) rather than storing file bytes in IndexedDB -- they're
// project assets, not user uploads, so there's nothing to gain from duplicating them
// into the database, and it's the only way the tree's manually-applied bark/leaf
// textures (it ships with no .mtl) survive a reload.

async function fetchAsFile(url, name, type) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
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
    fetchAsFile('/library/mini-library.obj', 'mini-library.obj'),
    fetchAsFile('/library/mini-library.mtl', 'mini-library.mtl'),
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
  const objFile = await fetchAsFile('/tree/MapleTree.obj', 'MapleTree.obj');
  const { manager, urlMap } = buildBatchLoadingManager([objFile]);
  let object3D;
  try {
    object3D = await loadModelFile({ file: objFile, ext: 'obj', manager });
  } finally {
    for (const url of urlMap.values()) URL.revokeObjectURL(url);
  }

  const [barkTexture, leafTexture, leafMask] = await Promise.all([
    loadTexture('/tree/maple_bark.png'),
    loadTexture('/tree/maple_leaf.png'),
    loadTexture('/tree/maple_leaf_Mask.png', { srgb: false }),
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
  const file = await fetchAsFile('/NewEdusim.png', 'NewEdusim.png', 'image/png');
  return loadImagePlane(file, { isGif: false });
}

function trianglePositions(spacing) {
  const radius = spacing / Math.sqrt(3);
  const angles = [Math.PI / 2, Math.PI / 2 + (2 * Math.PI) / 3, Math.PI / 2 - (2 * Math.PI) / 3];
  return angles.map((a) => ({ x: radius * Math.cos(a), z: radius * Math.sin(a) }));
}

async function placeOne({ kind, pos, isImage, loader, scene, camera, registry, worldStore, groundHeightAt }) {
  const groundY = groundHeightAt(pos.x, pos.z);
  let object3D;
  let tick;

  if (isImage) {
    const result = await loader();
    object3D = result.mesh;
    tick = result.tick;
    object3D.position.set(pos.x, groundY + result.planeHeight / 2, pos.z);
    faceCamera(object3D, camera);
  } else {
    object3D = await loader();
    const lift = groundLiftFor(object3D);
    object3D.position.set(pos.x, groundY + lift, pos.z);
  }

  const id = crypto.randomUUID();
  const record = {
    id,
    kind,
    createdAt: Date.now(),
    transform: {
      position: object3D.position.toArray(),
      rotation: [object3D.rotation.x, object3D.rotation.y, object3D.rotation.z],
      scale: object3D.scale.toArray(),
    },
  };

  scene.add(object3D);
  registry.add(id, object3D, { tick, record });
  worldStore?.saveObject(record);
}

export async function placeStartupAssets({ scene, camera, registry, worldStore, groundHeightAt }) {
  const [libraryPos, treePos, billboardPos] = trianglePositions(STARTUP_ASSET_SPACING);

  const jobs = [
    { kind: 'startup-library', pos: libraryPos, loader: loadLibraryModel, isImage: false },
    { kind: 'startup-tree', pos: treePos, loader: loadTreeModel, isImage: false },
    { kind: 'startup-billboard', pos: billboardPos, loader: loadBillboardImage, isImage: true },
  ];

  for (const job of jobs) {
    try {
      await placeOne({ ...job, scene, camera, registry, worldStore, groundHeightAt });
    } catch (err) {
      console.error(`Failed to load startup asset "${job.kind}":`, err);
    }
  }
}
