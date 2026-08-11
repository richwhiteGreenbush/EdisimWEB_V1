import * as THREE from 'three';
import { GROUND_SIZE, TERRAIN_SEGMENTS, TERRAIN_AMPLITUDE, TERRAIN_FLAT_RADIUS, TERRAIN_BLEND_RADIUS } from './config.js';

const SKY_COLOR = 0x87ceeb;
const LOW_COLOR = new THREE.Color(0x3d6b30);
const HIGH_COLOR = new THREE.Color(0x7fae52);

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Sum of a few smooth sine/cosine waves at irrational-ish frequency ratios so the
// hills don't read as an obviously periodic/grid-aligned pattern. Every term here is
// continuous and differentiable everywhere, which is what actually makes the terrain
// "smooth" -- there's no per-vertex randomness to create seams or hard edges.
function rawNoise(x, z) {
  return (
    Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.038 - 0.6) +
    Math.sin(x * 0.021 - 0.9 + z * 0.017) * 0.6 +
    Math.cos(x * 0.09 + z * 0.07 + 2.3) * 0.25
  );
}
const RAW_NOISE_PEAK = 1.85; // ~= sum of the term amplitudes above, for normalizing to [-1, 1]

// Flattens out to exactly 0 within TERRAIN_FLAT_RADIUS of the origin (so the spawn
// point and the boot-time library/tree/billboard sit on level ground), then eases up
// to full hill height by TERRAIN_BLEND_RADIUS.
function terrainHeightAt(worldX, worldZ) {
  const radius = Math.hypot(worldX, worldZ);
  const falloff = smoothstep(TERRAIN_FLAT_RADIUS, TERRAIN_BLEND_RADIUS, radius);
  if (falloff === 0) return 0;
  return (rawNoise(worldX, worldZ) / RAW_NOISE_PEAK) * TERRAIN_AMPLITUDE * falloff;
}

function buildTerrainGeometry() {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const tint = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    // PlaneGeometry is authored flat in local XY (z=0); the mesh is rotated -90° about
    // X to lay it down, which maps local Z -> world Y (up) and local Y -> world -Z.
    const localX = position.getX(i);
    const localY = position.getY(i);
    const worldZ = -localY;
    const height = terrainHeightAt(localX, worldZ);
    position.setZ(i, height);

    const t = THREE.MathUtils.clamp(height / TERRAIN_AMPLITUDE, -1, 1) * 0.5 + 0.5;
    tint.copy(LOW_COLOR).lerp(HIGH_COLOR, t);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 60, 220);

  const ground = new THREE.Mesh(
    buildTerrainGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3a2a, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowExtent = GROUND_SIZE / 2;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  return { ground };
}
