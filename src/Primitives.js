import * as THREE from 'three';
import { restTransform } from './RootMotion.js';
import { nextPlacementXZ } from './Placement.js';
import { loadImageElement } from './MediaLoader.js';
import { buildBatchLoadingManager, loadModelFile } from './ModelLoader.js';
import {
  PRIMITIVE_SIZE,
  PRIMITIVE_DEFAULT_COLOR,
  PRIMITIVE_SPAWN_DISTANCE,
  PRIMITIVE_SPAWN_SPACING,
  CONNECT_TOUCH_EPSILON,
} from './config.js';

import { uuid } from './Uuid.js';
// Create Model: the student assembles a model out of simple shapes, then "renders" the
// connected cluster into one ordinary placed object.
//
// Two record kinds live here, and both follow this project's usual rule -- store the
// PARAMETERS, regenerate the geometry -- so IndexedDB persistence, world-file export
// (WorldFile base64s anything under `files` on its own) and the duplicate block all work
// with no per-kind code anywhere else:
//
//   { kind: 'primitive',    shape, color, files?: [texture], connections: [ids], transform }
//   { kind: 'built-model',  parts: [{shape,color,fileIndex,position,rotation,scale}], files, transform }

export const PRIMITIVE_SHAPES = ['cube', 'sphere', 'cylinder', 'tetrahedron'];

// What counts as a BUILD PIECE -- a thing that carries the floating hammer and can be
// stretched, rotated, connected and rendered. Originally only 'primitive'; imported
// models joined later, because a student who can build out of four ideal solids but not
// out of the dinosaur they just imported has been given the wrong half of the toy.
// Imports KEEP their ordinary click-to-edit menu as well -- unlike a primitive, an
// import is a finished object in its own right, so Size/Move/Program stay reachable and
// the hammer is additive.
export const BUILD_PIECE_KINDS = ['primitive', 'gltf', 'obj'];

export function isBuildPiece(record) {
  return !!record && BUILD_PIECE_KINDS.includes(record.kind);
}

// What to call a piece in menus and toasts: a primitive by its shape, an import by its
// file's own name -- which is what the student picked it by.
export function pieceLabel(record) {
  if (!record) return 'Shape';
  if (record.kind === 'primitive') return SHAPE_LABELS[record.shape] || 'Shape';
  const name = record.primaryFileName || record.files?.[0]?.name || '';
  const base = name.replace(/\.[^.]+$/, '');
  if (!base) return 'Imported Model';
  return base.length > 18 ? `${base.slice(0, 17)}…` : base;
}

export const SHAPE_LABELS = {
  cube: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  tetrahedron: 'Tetrahedron',
};

// Every one of these is authored centred on its own origin, which the stretch gizmo's
// maths depends on: it treats the mesh position as the box centre when anchoring the
// corner opposite the one being dragged.
export function primitiveGeometry(shape) {
  const s = PRIMITIVE_SIZE;
  switch (shape) {
    case 'sphere':
      return new THREE.SphereGeometry(s / 2, 28, 20);
    case 'cylinder':
      return new THREE.CylinderGeometry(s / 2, s / 2, s, 28);
    case 'tetrahedron':
      // PolyhedronGeometry's UVs are a spherical projection, so an applied image wraps
      // rather than sitting flat on each face and carries one visible seam. Acceptable
      // for a build toy; a per-face unwrap would mean hand-authoring the geometry.
      return new THREE.TetrahedronGeometry(s * 0.65);
    case 'cube':
    default:
      return new THREE.BoxGeometry(s, s, s);
  }
}

// A texture is loaded fresh for every mesh that needs one -- never cached and shared.
// PlacedRegistry.disposeObject3D() disposes a removed object's `map` outright, so one
// shared Texture handed to two registry roots is destroyed out from under the survivor.
async function textureFromFileRecord(fileRecord) {
  const url = URL.createObjectURL(fileRecord.data);
  let img;
  try {
    img = await loadImageElement(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

// Builds one shape's mesh from { shape, color, files? }. Used for both a standalone
// construction piece and each part of a rendered model, so the two always look identical
// -- rendering must not change the appearance of anything the student already built.
export async function createShapeMesh({ shape, color, fileRecord }) {
  const material = new THREE.MeshStandardMaterial({
    color: fileRecord ? '#ffffff' : color || PRIMITIVE_DEFAULT_COLOR,
    roughness: 0.72,
    metalness: 0.05,
  });
  if (fileRecord) {
    try {
      material.map = await textureFromFileRecord(fileRecord);
    } catch {
      // A texture that won't decode must not cost the student their shape -- fall back
      // to the flat colour, same "degrade, never break" rule as the photo surface maps.
      material.color.set(color || PRIMITIVE_DEFAULT_COLOR);
    }
  }

  const mesh = new THREE.Mesh(primitiveGeometry(shape), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// A construction piece. `isConstruction` is what keeps ObjectMenu's generic click-to-edit
// raycast off it: while a piece is being built it is reachable ONLY through its hammer
// icon, so Size/Move/Program can't be applied to something that isn't a finished model.
export async function createPrimitiveMesh(record) {
  const mesh = await createShapeMesh({
    shape: record.shape,
    color: record.color,
    fileRecord: record.files?.[0],
  });
  mesh.userData.isConstruction = true;
  return mesh;
}

export async function buildBuiltModel(record) {
  const group = new THREE.Group();
  for (const part of record.parts || []) {
    let child;
    if (part.kind === 'gltf' || part.kind === 'obj') {
      // An imported part: rebuilt through the exact loader path WorldStore uses for a
      // standalone gltf/obj record, against the slice of files this part brought in.
      const fileRecords = (record.files || []).slice(part.fileStart, part.fileStart + part.fileCount);
      const partFiles = fileRecords.map((f) => new File([f.data], f.name, { type: f.type }));
      const { manager, urlMap } = buildBatchLoadingManager(partFiles);
      try {
        const primary = partFiles.find((f) => f.name === part.primaryFileName) || partFiles[0];
        const mtlFile = partFiles.find((f) => /\.mtl$/i.test(f.name));
        const ext = part.kind === 'obj' ? 'obj' : /\.glb$/i.test(primary.name) ? 'glb' : 'gltf';
        child = await loadModelFile({ file: primary, ext, manager, mtlFile });
        child.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
      } finally {
        for (const url of urlMap.values()) URL.revokeObjectURL(url);
      }
    } else {
      child = await createShapeMesh({ shape: part.shape, color: part.color, fileRecord: part.fileIndex == null ? null : record.files?.[part.fileIndex] });
    }
    child.position.fromArray(part.position);
    child.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2]);
    child.scale.fromArray(part.scale);
    group.add(child);
  }
  return group;
}

export function liveBuildPieces(registry) {
  return [...registry.items.entries()]
    .filter(([, item]) => isBuildPiece(item.record))
    .map(([id, item]) => ({ id, ...item }));
}

export async function placePrimitive({ shape, scene, camera, registry, groundHeightAt }) {
  const id = uuid();
  const record = {
    id,
    kind: 'primitive',
    createdAt: Date.now(),
    shape,
    color: PRIMITIVE_DEFAULT_COLOR,
    connections: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };

  const mesh = await createPrimitiveMesh(record);

  // The spiral counts SHAPE primitives only: imports were placed by their own import
  // spiral and should not push a student's next cube further out.
  const shapeCount = [...registry.items.values()].filter((item) => item.record?.kind === 'primitive').length;
  const { x, z } = nextPlacementXZ(camera, shapeCount, {
    distance: PRIMITIVE_SPAWN_DISTANCE,
    spacing: PRIMITIVE_SPAWN_SPACING,
  });
  mesh.geometry.computeBoundingBox();
  const lift = -mesh.geometry.boundingBox.min.y;
  mesh.position.set(x, groundHeightAt(x, z) + lift, z);
  scene.add(mesh);

  record.transform.position = mesh.position.toArray();
  registry.add(id, mesh, { record });
  return { mesh, record };
}

// --- Connecting and rendering ---------------------------------------------------

// "Touching" is an axis-aligned box overlap with a little slack. For an unturned piece
// that box is exact; for one the student has rotated it is the enclosing AABB, which is
// bigger than the piece, so the test errs toward listing a near-miss as touching. That is
// the right direction to err in: the cost is a joint between two pieces with a hair's gap
// between them, which nobody can see, against a student being told nothing is touching a
// piece that visibly is.
export function touchingPrimitives(id, registry) {
  const mine = registry.get(id);
  if (!mine) return [];
  const myBox = new THREE.Box3().setFromObject(mine.object3D).expandByScalar(CONNECT_TOUCH_EPSILON);
  const other = new THREE.Box3();
  return liveBuildPieces(registry).filter((entry) => {
    if (entry.id === id) return false;
    other.setFromObject(entry.object3D);
    return myBox.intersectsBox(other);
  });
}

// Walks the connection graph in BOTH directions. A link is stored only on the piece the
// student clicked, but the two are joined either way round, so rendering from either end
// of a chain has to produce the same model.
export function clusterIds(rootId, registry) {
  const pieces = liveBuildPieces(registry);
  const byId = new Map(pieces.map((entry) => [entry.id, entry]));
  const neighbours = new Map(pieces.map((entry) => [entry.id, new Set()]));
  for (const entry of pieces) {
    for (const otherId of entry.record.connections || []) {
      if (!byId.has(otherId)) continue; // partner was deleted; the link is just stale
      neighbours.get(entry.id).add(otherId);
      neighbours.get(otherId).add(entry.id);
    }
  }

  const seen = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    for (const next of neighbours.get(id)) if (!seen.has(next)) queue.push(next);
  }
  return [...seen];
}

// Takes one construction piece out of the world for good.
//
// It also strips the removed id out of every OTHER piece's connections. clusterIds()
// already skips links it cannot resolve, so a dangling link breaks nothing today -- but a
// record that keeps claiming to be joined to something that no longer exists is a lie
// that gets saved to IndexedDB, exported into world files, and read by whatever "Edit
// Model" eventually re-splits a built model. Cheaper to keep the graph honest.
export async function removePrimitive({ id, registry, worldStore }) {
  registry.remove(id);
  await worldStore?.deleteObject(id);

  for (const entry of liveBuildPieces(registry)) {
    const links = entry.record.connections || [];
    if (!links.includes(id)) continue;
    entry.record.connections = links.filter((other) => other !== id);
    worldStore?.saveObject(entry.record);
  }
}

// Fuses a connected cluster of construction pieces into ONE placed object.
//
// There is no CSG here and deliberately so: the pieces overlap where they touch, and a
// Group of overlapping solids reads as one seamless model while staying a single registry
// root -- which is all "one solid model" has to mean for Size/Move/Program to work. A real
// boolean union would need a dependency this project doesn't carry, and would throw away
// the per-part data that keeps the record small and rebuildable.
export async function renderModelFromCluster({ rootId, registry, worldStore, menu }) {
  const ids = clusterIds(rootId, registry);
  if (!ids.length) return null;

  const union = new THREE.Box3();
  const box = new THREE.Box3();
  for (const id of ids) union.union(box.setFromObject(registry.get(id).object3D));
  const centre = union.getCenter(new THREE.Vector3());
  // Base-centre pivot, like every prop in this codebase: a layout (or ObjectMenu's Move)
  // can then place the model by its feet without knowing anything about its shape.
  const origin = new THREE.Vector3(centre.x, union.min.y, centre.z);

  const files = [];
  const parts = [];
  for (const id of ids) {
    const { object3D, record } = registry.get(id);
    // restTransform(): a piece carrying a motion sticker must be baked into the model at
    // the pose it RESTS at, not at whatever frame of its animation Render Model was
    // pressed on. See RootMotion.js.
    const rest = restTransform(object3D);
    const placement = {
      position: [rest.position[0] - origin.x, rest.position[1] - origin.y, rest.position[2] - origin.z],
      rotation: rest.rotation,
      scale: rest.scale,
    };

    if (record.kind === 'primitive') {
      let fileIndex = null;
      if (record.files?.[0]) {
        // Blobs are immutable, so the copy shares the reference rather than re-encoding
        // -- the same argument Duplicator.cloneRecord() makes.
        files.push({ ...record.files[0] });
        fileIndex = files.length - 1;
      }
      parts.push({ shape: record.shape, color: record.color, fileIndex, ...placement });
      continue;
    }

    // An IMPORTED piece. Its model files are hoisted into the built-model's own
    // top-level `files` array and the part records an index RANGE into it -- top-level,
    // because WorldFile's base64 walker only knows about `record.files`, so a Blob
    // nested anywhere else would silently serialise as {} and the exported world would
    // rebuild with a hole where the import was. `scale` is absolute (the import-time
    // 5ft normalization is baked into the live object's scale), so the rebuild applies
    // it directly and never re-normalizes.
    parts.push({
      kind: record.kind,
      primaryFileName: record.primaryFileName,
      fileStart: files.length,
      fileCount: (record.files || []).length,
      ...placement,
    });
    for (const f of record.files || []) files.push({ ...f });
  }

  // `parts` holds everything needed to split this back into construction pieces (world
  // position = the group transform applied to each part's local one), which is where an
  // "Edit Model" option would start. Rendering is one-way for now.
  const record = {
    id: uuid(),
    kind: 'built-model',
    createdAt: Date.now(),
    parts,
    files,
    transform: { position: origin.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1] },
  };

  for (const id of ids) {
    registry.remove(id);
    await worldStore.deleteObject(id);
  }

  await worldStore.rehydrateOne(record);
  await worldStore.saveObject(record);

  const count = parts.length;
  menu?.toast(`Model rendered from ${count} piece${count === 1 ? '' : 's'}! Click it to size, move or program it.`, {
    tone: 'success',
  });
  return record;
}
