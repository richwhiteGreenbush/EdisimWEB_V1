import * as THREE from 'three';
import { SPAWN_DISTANCE, SPAWN_SPACING, GOLDEN_ANGLE } from './config.js';

// Golden-angle spiral around a drop point in front of the camera, so sequential
// placements (models, images, balloons — anything) fan out evenly instead of stacking.
// `distance`/`spacing` default to the import-sized values; Create Model's construction
// pieces pass a tighter pair so they land within arm's reach of each other.
export function nextPlacementXZ(camera, n, { distance = SPAWN_DISTANCE, spacing = SPAWN_SPACING } = {}) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();

  const dropX = camera.position.x + dir.x * distance;
  const dropZ = camera.position.z + dir.z * distance;
  const radius = spacing * Math.sqrt(n);
  const angle = n * GOLDEN_ANGLE;

  return { x: dropX + Math.cos(angle) * radius, z: dropZ + Math.sin(angle) * radius };
}

// Yaws a flat object (already positioned) to face back toward the camera, oriented
// once at placement time — not a continuously-tracking billboard.
// Object3D.lookAt() points the local +Z axis (a plane's front) AT the target, so the
// target must be the camera itself, not a point further beyond the mesh.
export function faceCamera(mesh, camera) {
  const target = new THREE.Vector3(camera.position.x, mesh.position.y, camera.position.z);
  if (target.distanceToSquared(mesh.position) < 1e-6) return;
  mesh.lookAt(target);
}
