import * as THREE from 'three';
import { nextPlacementXZ } from './Placement.js';
import {
  ORB_RADIUS,
  ORB_HALO_SCALE,
  ORB_HOVER_HEIGHT,
  ORB_EMISSIVE_INTENSITY,
  ORB_LIGHT_INTENSITY,
  ORB_LIGHT_DISTANCE,
  PALETTE_SWATCHES,
} from './config.js';

// A light orb is a Group (core glow sphere + soft halo + an actual PointLight), all
// as children -- so Size/Move/Program act on it exactly like any other placed object
// (moving/scaling the group carries the light along for free) with no special-casing
// needed in PlacedRegistry, ObjectMenu, or PlayIconManager.
export function createLightOrb(color = PALETTE_SWATCHES[0]) {
  const group = new THREE.Group();
  group.userData.isLightOrb = true;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(ORB_RADIUS, 20, 16),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: ORB_EMISSIVE_INTENSITY,
      roughness: 0.35,
      metalness: 0,
    })
  );
  core.userData.isGlowMesh = true;
  core.castShadow = false;
  group.add(core);

  // Cheap fake bloom: a larger, backside-only, unlit translucent shell -- no
  // post-processing pipeline needed for the orb to read as "glowing" up close.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(ORB_RADIUS * ORB_HALO_SCALE, 16, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.BackSide, depthWrite: false })
  );
  halo.userData.isGlowMesh = true;
  group.add(halo);

  // decay=2 (physically-based falloff) with a finite distance cutoff keeps a large
  // number of placed orbs cheap to light -- no shadow casting, deliberately.
  const light = new THREE.PointLight(color, ORB_LIGHT_INTENSITY, ORB_LIGHT_DISTANCE, 2);
  group.add(light);

  return group;
}

export function placeLightOrb({ scene, camera, registry, groundHeightAt, color }) {
  const { x, z } = nextPlacementXZ(camera, registry.count);
  const group = createLightOrb(color);
  const groundY = groundHeightAt(x, z);
  group.position.set(x, groundY + ORB_HOVER_HEIGHT, z);
  scene.add(group);

  const id = crypto.randomUUID();
  const record = {
    id,
    kind: 'light-orb',
    createdAt: Date.now(),
    color,
    transform: {
      position: group.position.toArray(),
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  };

  registry.add(id, group, { record });
  return { group, record };
}
