import * as THREE from 'three';
import { buildProp } from '../props/index.js';
import { uuid } from '../Uuid.js';
import { restTransform, rebaseRestPose } from '../RootMotion.js';
import { PRIMITIVE_SPAWN_DISTANCE, WORLD_BOUND_RADIUS } from '../config.js';
import { MODEL_BY_ID, modelCategory } from './catalog.js';
import { STARTER_PROGRAMS } from './programs.js';

// The record behind everything placed from the Model Database:
//
//   { kind: 'catalog-model', model: id, connections: [], transform, program?, programIdle? }
//
// Parameters, not geometry, like every other kind: the id says what to build, so a model costs
// a world file about two hundred bytes and never touches `files`. It is its own kind rather
// than a flag on `preset-prop` because a kind is what ConstructionManager hangs a hammer on,
// and every preset prop in every world having one would be several hundred hammers.

// One chunk per family, so the twenty-nine models that are not already world props cost a
// normal boot nothing at all. HiFi imports this file too, and Vite splits both the same way.
const BUILDER_CHUNKS = {
  life: () => import('./builders/Life.js'),
  space: () => import('./builders/Space.js'),
  lab: () => import('./builders/Lab.js'),
  machines: () => import('./builders/Machines.js'),
  landmarks: () => import('./builders/Landmarks.js'),
  artifacts: () => import('./builders/Artifacts.js'),
  arts: () => import('./builders/Arts.js'),
};

export async function buildCatalogModel(id) {
  const entry = MODEL_BY_ID.get(id);
  if (!entry) throw new Error(`Unknown catalogue model: "${id}"`);
  let object3D;
  if (entry.prop) {
    object3D = buildProp(entry.prop, entry.options ?? {});
  } else {
    const { BUILDERS } = await BUILDER_CHUNKS[entry.builder]();
    const builder = BUILDERS[id];
    if (!builder) throw new Error(`No builder for catalogue model: "${id}"`);
    object3D = builder(entry.options ?? {});
  }
  object3D.userData.catalogModel = id;
  return object3D;
}

function unscaledBox(object3D) {
  const box = new THREE.Box3();
  const child = new THREE.Box3();
  const toRoot = new THREE.Matrix4();
  object3D.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(object3D.matrixWorld).invert();
  object3D.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    toRoot.multiplyMatrices(inverse, node.matrixWorld);
    child.copy(node.geometry.boundingBox).applyMatrix4(toRoot);
    box.union(child);
  });
  return box;
}

// How far back a thing of this size has to stand to arrive in the frame. fov 70 is VERTICAL,
// so this solves height and width separately and takes the larger, and the margin keeps it off
// the bezel. A tall model is the case that decides most of these: the Saturn V at 25ft has to
// stand well back or its top is above the screen.
function framingDistance({ width, height, depth, eye, aspect }) {
  const halfV = THREE.MathUtils.degToRad(35) * 0.85;
  const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) * Math.max(aspect, 0.5)) * 0.85;
  const forTop = height > eye ? (height - eye) / Math.tan(halfV) : 0;
  const forWidth = width / 2 / Math.tan(halfH);
  return Math.max(PRIMITIVE_SPAWN_DISTANCE, forTop, forWidth) + depth / 2;
}

// What a new model should not land inside. Very wide or very low props are left out, since a
// street, a lawn or a path is somewhere you can legitimately put a thing. The student's own
// pieces are listed separately, because a populated world can leave nowhere clear of its trees
// and benches, and landing in a tree is still better than landing inside their last model.
function obstacles(registry) {
  const scenery = [];
  const own = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  for (const item of registry.items.values()) {
    const kind = item.record?.kind;
    if (!item.object3D || kind === 'world-theme' || kind === 'world-spawn') continue;
    box.setFromObject(item.object3D);
    if (box.isEmpty()) continue;
    box.getSize(size);
    if (size.x > 70 || size.z > 70 || size.y < 1) {
      if (kind !== 'catalog-model') continue;
    }
    (kind === 'catalog-model' || kind === 'primitive' ? own : scenery).push(box.clone());
  }
  return { scenery, own };
}

function clearOf(boxes, x, z, radius) {
  return !boxes.some((b) => {
    const dx = Math.max(b.min.x - x, 0, x - b.max.x);
    const dz = Math.max(b.min.z - z, 0, z - b.max.z);
    return dx * dx + dz * dz < radius * radius;
  });
}

// NOT the golden-angle spiral. That is tuned to a small n, and past SPAWN_SPACING*sqrt(n) =
// distance it wraps behind the student, who then reads "placed" over an empty view. A student
// filling a world with models reaches that quickly, and these are much bigger than a 2ft cube.
// So this searches rings in FRONT of the student for the nearest spot that is clear of
// everything, then for the nearest clear of their own models, and if a very full world has
// neither it takes the spot straight ahead: a model overlapping something is fixable with the
// gizmo, and a model out of sight is not.
export function findPlacementSpot({ camera, registry, distance, radius }) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  const heading = Math.atan2(dir.x, dir.z);
  const { scenery, own } = obstacles(registry);
  const bound = WORLD_BOUND_RADIUS - radius;
  let straightAhead = null;
  let clearOfOwn = null;
  for (const ring of [1, 1.3, 1.65, 2.05, 2.6, 3.2, 4, 5]) {
    for (const off of [0, 16, -16, 32, -32, 46, -46]) {
      const bearing = heading + THREE.MathUtils.degToRad(off);
      const x = camera.position.x + Math.sin(bearing) * distance * ring;
      const z = camera.position.z + Math.cos(bearing) * distance * ring;
      if (Math.hypot(x, z) > bound) continue;
      straightAhead ??= { x, z };
      if (!clearOf(own, x, z, radius)) continue;
      clearOfOwn ??= { x, z };
      if (clearOf(scenery, x, z, radius)) return { x, z };
    }
  }
  // Standing at the edge of the world looking out, every spot ahead is out of bounds, so the
  // model comes to the student instead of being placed where they could not walk to it.
  return clearOfOwn ?? straightAhead ?? { x: camera.position.x, z: camera.position.z };
}

export async function placeCatalogModel({ id, scene, camera, registry, groundHeightAt }) {
  const entry = MODEL_BY_ID.get(id);
  const object3D = await buildCatalogModel(id);
  const scale = entry.scale ?? 1;
  object3D.scale.setScalar(scale);

  const size = unscaledBox(object3D).getSize(new THREE.Vector3()).multiplyScalar(scale);
  const yawOff = entry.yaw ?? 0;
  const wide = Math.abs(size.x * Math.cos(yawOff)) + Math.abs(size.z * Math.sin(yawOff));
  const deep = Math.abs(size.x * Math.sin(yawOff)) + Math.abs(size.z * Math.cos(yawOff));
  const eye = camera.position.y - groundHeightAt(camera.position.x, camera.position.z);
  const distance = framingDistance({ width: wide, height: size.y, depth: deep, eye, aspect: camera.aspect });
  const radius = Math.max(wide, deep) / 2 + 1;
  const { x, z } = findPlacementSpot({ camera, registry, distance, radius });

  // A prop's origin is its base centre, so ground height plus any hover is the whole of
  // seating it. Parts below the origin are meant to be there: an ankle in the dirt, a skirt of
  // rock that hides the join with uneven ground.
  object3D.position.set(x, groundHeightAt(x, z) + (entry.hover ?? 0), z);
  object3D.rotation.y = Math.atan2(camera.position.x - x, camera.position.z - z) + yawOff;
  scene.add(object3D);

  const record = {
    id: uuid(),
    kind: 'catalog-model',
    createdAt: Date.now(),
    model: id,
    connections: [],
    transform: {
      position: object3D.position.toArray(),
      rotation: [object3D.rotation.x, object3D.rotation.y, object3D.rotation.z],
      scale: object3D.scale.toArray(),
    },
  };
  if (entry.program) {
    record.program = STARTER_PROGRAMS[entry.program]();
    record.programIdle = true;
    // `go back to start` has to mean where the student left it, and not wherever it was when
    // somebody last pressed Save in the middle of a lift-off. See the Math blocks notes.
    record.homeFromRecord = true;
  }
  return { object3D, record, tick: object3D.userData.tick };
}

// Stretching has no undo in this app, so the catalogue's own size is one button away. Turning
// about the vertical is kept, since which way a model faces is where the student put it; any
// tip is undone, and it sits back on the ground at its own hover height.
export function resetCatalogModel({ item, groundHeightAt, worldStore }) {
  const entry = MODEL_BY_ID.get(item.record?.model);
  if (!entry) return;
  const { object3D, record } = item;
  const rest = restTransform(object3D);
  const position = [rest.position[0], groundHeightAt(rest.position[0], rest.position[2]) + (entry.hover ?? 0), rest.position[2]];
  const scale = entry.scale ?? 1;
  record.transform = { position, rotation: [0, rest.rotation[1], 0], scale: [scale, scale, scale] };
  object3D.position.fromArray(position);
  object3D.rotation.set(0, rest.rotation[1], 0);
  object3D.scale.setScalar(scale);
  rebaseRestPose(object3D, record.transform);
  worldStore?.saveObject(record);
}

// A sign is a separate ordinary prop, because anything printed on the model itself would
// stretch with it. It stands beside the model on the student's side and faces them.
export async function placeInfoSign({ item, camera, groundHeightAt, worldStore }) {
  const entry = MODEL_BY_ID.get(item.record?.model);
  if (!entry) return null;
  const box = new THREE.Box3().setFromObject(item.object3D);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const toCamera = new THREE.Vector3(camera.position.x - centre.x, 0, camera.position.z - centre.z);
  if (toCamera.lengthSq() < 1e-6) toCamera.set(0, 0, 1);
  toCamera.normalize();
  const right = new THREE.Vector3(toCamera.z, 0, -toCamera.x);
  const reach = Math.max(size.x, size.z) / 2 + 2.5;
  const x = centre.x + right.x * reach + toCamera.x * 2;
  const z = centre.z + right.z * reach + toCamera.z * 2;

  const category = modelCategory(entry.category);
  const record = {
    id: uuid(),
    kind: 'preset-prop',
    createdAt: Date.now(),
    prop: 'info-placard',
    options: {
      title: entry.title,
      eyebrow: category.label,
      accent: category.accent,
      body: `${entry.facts[0]} Real size: ${entry.realSize}.`,
    },
    transform: {
      position: [x, groundHeightAt(x, z), z],
      rotation: [0, Math.atan2(camera.position.x - x, camera.position.z - z), 0],
      scale: [1, 1, 1],
    },
  };
  await worldStore.rehydrateOne(record);
  await worldStore.saveObject(record);
  return record;
}

// Geometry in the world right now. A budget the student can see, rather than one they discover
// when the lesson starts to stutter. Every mesh is also drawn into the shadow map, so this is
// about half of what the GPU actually draws.
export function worldTriangles(registry) {
  let total = 0;
  for (const item of registry.items.values()) {
    item.object3D?.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const { index, attributes } = node.geometry;
      total += (index ? index.count : attributes.position?.count ?? 0) / 3;
    });
  }
  return Math.round(total);
}
