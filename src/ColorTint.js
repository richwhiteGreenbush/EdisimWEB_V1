import * as THREE from 'three';

// Shared by the "change color to" program block and ObjectMenu's light-orb Color
// action, so both stay in sync. Only meshes explicitly tagged as glow meshes (light
// orbs) get their emissive channel touched -- tinting an ordinary model or balloon
// must never make it start glowing, since MeshStandardMaterial always has an
// `emissive` property (default black) whether or not the object is meant to glow.
export function applyColorTint(object3D, hex) {
  const color = new THREE.Color(hex);
  object3D.traverse((node) => {
    if (node.isLight) {
      node.color.copy(color);
      return;
    }
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      material.color?.copy(color);
      if (node.userData.isGlowMesh && material.emissive) material.emissive.copy(color);
    }
  });
}
