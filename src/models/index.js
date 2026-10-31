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

// One chunk per family, so the models that are not already world props cost a normal boot
// nothing at all. HiFi imports this file too, and Vite splits both the same way.
const BUILDER_CHUNKS = {
  life: () => import('./builders/Life.js'),
  space: () => import('./builders/Space.js'),
  lab: () => import('./builders/Lab.js'),
  machines: () => import('./builders/Machines.js'),
  landmarks: () => import('./builders/Landmarks.js'),
  artifacts: () => import('./builders/Artifacts.js'),
  arts: () => import('./builders/Arts.js'),
  body2: () => import('./builders/Body2.js'),
  life2: () => import('./builders/Life2.js'),
  space2: () => import('./builders/Space2.js'),
  lab2: () => import('./builders/Lab2.js'),
  math: () => import('./builders/MathModels.js'),
  machines2: () => import('./builders/Machines2.js'),
  landmarks2: () => import('./builders/Landmarks2.js'),
  artifacts2: () => import('./builders/Artifacts2.js'),
  arts2: () => import('./builders/Arts2.js'),
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
// models are always listed, and separately, because landing inside their last model is worse
// than landing on a bench.
function obstacles(registry) {
  const scenery = [];
  const own = [];
  const blockers = [];
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  for (const item of registry.items.values()) {
    const kind = item.record?.kind;
    if (!item.object3D || kind === 'world-theme' || kind === 'world-spawn') continue;
    box.setFromObject(item.object3D);
    if (box.isEmpty()) continue;
    blockers.push({ object3D: item.object3D, box: box.clone() });
    box.getSize(size);
    const mine = kind === 'catalog-model' || kind === 'primitive';
    if (mine) own.push(box.clone());
    else if (size.x <= 70 && size.z <= 70 && size.y >= 1) scenery.push(box.clone());
  }
  return { scenery, own, blockers };
}

function overlapCount(boxes, x, z, radius) {
  let count = 0;
  for (const b of boxes) {
    const dx = Math.max(b.min.x - x, 0, x - b.max.x);
    const dz = Math.max(b.min.z - z, 0, z - b.max.z);
    if (dx * dx + dz * dz < radius * radius) count += 1;
  }
  return count;
}

// Whether the student could see a model standing here, by real rays against real meshes rather
// than bounding boxes: a tree's box reaches the ground and its canopy does not, and a gate's box
// is solid where its arch is open. Five rays: three across the model's middle, two higher up.
const sightRay = new THREE.Raycaster();
function openSightlines({ camera, blockers, x, z, ground, height, radius }) {
  const eye = camera.position;
  const toward = new THREE.Vector3(x - eye.x, 0, z - eye.z).normalize();
  const across = new THREE.Vector3(toward.z, 0, -toward.x);
  const low = ground + Math.min(height / 2, eye.y - ground);
  const high = ground + height * 0.75;
  const target = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let open = 0;
  sightRay.camera = camera;
  for (const [side, y] of [[0, low], [-0.7, low], [0.7, low], [-0.35, high], [0.35, high]]) {
    target.set(x + across.x * radius * side, y, z + across.z * radius * side);
    direction.subVectors(target, eye);
    sightRay.far = Math.max(0.1, direction.length() - radius * 0.6);
    sightRay.set(eye, direction.normalize());
    const near = [];
    for (const blocker of blockers) {
      if (sightRay.ray.intersectsBox(blocker.box)) near.push(blocker.object3D);
    }
    const hit = near.length && sightRay.intersectObjects(near, true).some((h) => h.object.isMesh);
    if (!hit) open += 1;
  }
  return open;
}

// NOT the golden-angle spiral. That is tuned to a small n, and past SPAWN_SPACING*sqrt(n) =
// distance it wraps behind the student, who then reads "placed" over an empty view.
//
// THE RULE IS THAT THE STUDENT CAN SEE IT, ahead of everything else. The first version looked
// for the nearest EMPTY ground, and a populated world's nearest empty ground for anything big was
// 120ft off behind a building: in the Park the Parthenon, the castle and five others all landed
// out of sight while the toast said "placed". So each spot is scored by what is wrong with it,
// worst first: hidden, then outside the frame, then inside the student's own models, then on top
// of scenery. A model overlapping a bench is fixed with the gizmo; a model nobody can find is not.
//
// The cheap scores are worked out first and the rays are only cast in that order, because a good
// spot is usually among the first few and a raycast against merged props is not free.
export function findPlacementSpot({ camera, registry, distance, radius, height = 0, groundHeightAt }) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  let heading = Math.atan2(dir.x, dir.z);
  const { scenery, own, blockers } = obstacles(registry);
  const bound = WORLD_BOUND_RADIUS - radius;
  const halfView = Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) * Math.max(camera.aspect, 0.5));

  const candidates = (bearingFrom) => {
    const list = [];
    for (const [ringIndex, ring] of [1, 1.2, 1.45, 1.75, 2.1, 2.5].entries()) {
      for (const off of [0, 12, -12, 24, -24, 36, -36]) {
        const reach = distance * ring;
        const bearing = bearingFrom + THREE.MathUtils.degToRad(off);
        const x = camera.position.x + Math.sin(bearing) * reach;
        const z = camera.position.z + Math.cos(bearing) * reach;
        if (Math.hypot(x, z) > bound) continue;
        const outside = THREE.MathUtils.degToRad(Math.abs(off)) + Math.atan(radius / reach) > halfView;
        const cost = (outside ? 200 : 0)
          + overlapCount(own, x, z, radius) * 300
          + Math.min(overlapCount(scenery, x, z, radius), 4) * 30
          + ringIndex * 30
          + Math.abs(off) / 2;
        list.push({ x, z, cost });
      }
    }
    return list;
  };

  let list = candidates(heading);
  if (!list.length) {
    // Standing at the edge of the world looking out, every spot ahead is out of bounds, so the
    // model goes back toward the middle, where the student can walk to it.
    heading = Math.atan2(-camera.position.x, -camera.position.z);
    list = candidates(heading);
  }
  if (!list.length) return { x: camera.position.x, z: camera.position.z };

  list.sort((a, b) => a.cost - b.cost);
  let best = null;
  for (const spot of list) {
    if (best && spot.cost >= best.score) break;
    const ground = groundHeightAt ? groundHeightAt(spot.x, spot.z) : 0;
    const open = openSightlines({ camera, blockers, x: spot.x, z: spot.z, ground, height, radius });
    const score = spot.cost + (5 - open) * 200;
    if (!best || score < best.score) best = { x: spot.x, z: spot.z, score };
    if (open === 5) break;
  }
  return { x: best.x, z: best.z };
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
  const { x, z } = findPlacementSpot({ camera, registry, distance, radius, height: size.y, groundHeightAt });

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
