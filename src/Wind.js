import * as THREE from 'three';
import { windOn } from './Settings.js';

// THE WIND.
//
// One shared uniform block and one shader patch make every leaf, frond, blade, banner and
// awning in all forty-two worlds move -- for ZERO draw calls, zero new meshes and zero
// per-object CPU. It is the highest ratio of life-per-cost available in this codebase, and
// the reason it is available at all is the constraint that looks like it should forbid it:
//
//   Nearly every prop here is ONE MERGED, VERTEX-COLOURED MESH. That is exactly why a
//   dinosaur's leg cannot be rotated -- there is no Object3D to turn -- and exactly why
//   displacing every leaf in a world is a per-vertex ALU cost on triangles that are
//   already being drawn. This hardware has vertex ALU spare and draw calls it does not.
//
// FOUR THINGS THAT WOULD OTHERWISE BITE, all of them found by reading rather than by
// running, and none of which produces an error:
//
// 1. DO NOT ADD A SWAY-WEIGHT ATTRIBUTE. mergeGeometries() refuses a batch whose inputs do
//    not share an identical attribute set -- it returns null and the prop SILENTLY
//    DISAPPEARS -- and LoftKit.mergeParts() strips every attribute outside
//    position/normal/uv/color before merging, with a comment saying exactly why. The
//    weight is derived from local position.y instead. Every prop in this project is
//    authored origin-at-base-centre (the house rule at the top of PropKit.js), so
//    position.y ALREADY IS height above the base, in feet, for zero bytes, zero merge
//    changes and zero builder edits.
//
// 2. THE WEIGHT MUST GO TO ZERO AT THE BASE. This is not polish. Get it wrong and a grass
//    field slides sideways across the ground like a sheet of paper.
//
// 3. THE SHADOW PASS HAS NEVER HEARD OF ANY OF THIS. PropKit.mesh() sets castShadow = true
//    unconditionally on every mesh it builds, and the sun renders the depth pass with
//    three's own MeshDepthMaterial -- so a swaying tree casts a perfectly rigid shadow of
//    its rest pose. It fails silently and reads as a lighting bug. A customDepthMaterial
//    carrying the same injection is the fix, and it is a SECOND compiled program, which is
//    the real reason this is a bigger job than it looks.
//
// 4. WRAP THE TIME. An unbounded elapsed time in a mediump vertex shader loses precision
//    and bands visibly inside a single lesson.
//
// This is the app's first custom shader -- there is no onBeforeCompile, ShaderMaterial,
// customProgramCacheKey or customDepthMaterial anywhere else in src/ -- so the honest risk
// here is novelty rather than cost.

export const uniforms = {
  // xyz unused, w = wrapped seconds. Packed as a Vector4 so one uniform carries the clock.
  uTime: { value: 0 },
  // (dirX, dirZ, strength, gustScale)
  uWind: { value: new THREE.Vector4(0.82, 0.57, 1, 0.045) },
  // Where the student is standing, for the parting effect.
  uPlayer: { value: new THREE.Vector3(0, 0, 0) },
  // Set to 0 to switch the whole family off without recompiling anything.
  uWindOn: { value: 1 },
};

// Height in feet at which a prop is considered fully flexible. Below the base it is zero,
// so a trunk stays planted while a canopy moves.
const DEFAULT_TOP = 14;

let elapsed = 0;

export function tickWind(dt, camera) {
  elapsed = (elapsed + dt) % 1000; // see note 4
  uniforms.uTime.value = elapsed;
  uniforms.uWindOn.value = windOn() ? 1 : 0;
  if (camera) uniforms.uPlayer.value.copy(camera.position);
}

export function setWind({ dirX, dirZ, strength, gust } = {}) {
  const w = uniforms.uWind.value;
  if (dirX !== undefined) w.x = dirX;
  if (dirZ !== undefined) w.y = dirZ;
  if (strength !== undefined) w.z = strength;
  if (gust !== undefined) w.w = gust;
}

// The injection, shared by the visible material and its depth twin so they can never
// disagree about where a leaf is.
function vertexChunk(top, amount) {
  return /* glsl */ `
    // Height above this prop's own base, normalised. Props here are authored with their
    // origin AT THE BASE CENTRE, so position.y is already feet above the ground.
    float wHeight = clamp(position.y / ${top.toFixed(2)}, 0.0, 1.0);
    // Squared: the weight has to reach zero at the base or the whole prop slides.
    float wWeight = wHeight * wHeight * ${amount.toFixed(3)} * uWindOn * uWind.z;

    vec3 wWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;

    // GUSTS TRAVEL. A band of stronger wind moving downwind is the difference between a
    // meadow that ripples and a meadow that wobbles like jelly -- every blade breathing in
    // unison is the giveaway. Phase by position ALONG the wind direction.
    float wAlong = wWorld.x * uWind.x + wWorld.z * uWind.y;
    float wGust = 0.55 + 0.45 * sin(wAlong * uWind.w - uTime * 0.9);

    // Two frequencies sharing no common factor, so a stand of trees never visibly beats
    // in time with itself.
    float wSway = sin(uTime * 1.7 + wAlong * 0.35) * 0.65
                + sin(uTime * 2.9 + wWorld.x * 0.21 + wWorld.z * 0.17) * 0.35;

    transformed.x += uWind.x * wSway * wWeight * wGust;
    transformed.z += uWind.y * wSway * wWeight * wGust;
    // A little vertical, or a tall frond shears sideways instead of bending.
    transformed.y -= abs(wSway) * wWeight * wGust * 0.12;

    // THE NUDGE: grass parts as you walk through it. In an app where nothing collides with
    // anything -- you walk straight through the T. rex -- this is the only acknowledgement
    // the world ever gives that the student has a body. Three lines on top of the wind.
    vec2 wAway = wWorld.xz - uPlayer.xz;
    float wNear = smoothstep(4.5, 0.0, length(wAway));
    // The epsilon matters: normalize(vec2(0.0)) is NaN, and ONE NaN vertex takes the whole
    // merged mesh off screen -- which presents as the prop being deleted when you stand
    // exactly on it.
    transformed.xz += normalize(wAway + vec2(1e-4)) * wNear * wWeight * 1.35;
  `;
}

function patch(material, { top = DEFAULT_TOP, amount = 1 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uPlayer = uniforms.uPlayer;
    shader.uniforms.uWindOn = uniforms.uWindOn;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTime;
         uniform vec4 uWind;
         uniform vec3 uPlayer;
         uniform float uWindOn;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexChunk(top, amount)}`);
  };
  // three derives a program's cache key from onBeforeCompile.toString(), so two materials
  // patched with different numbers would otherwise SHARE a compiled program and the second
  // one would silently render with the first one's constants.
  material.customProgramCacheKey = () => `wind:${top}:${amount}`;
  return material;
}

// Applies the wind to a whole prop, visible pass and shadow pass together.
//
// Called from buildProp() by PROP_BUILDERS key rather than from inside each builder: one
// place, no edits to forty prop files, and opt-in by name so nothing sways that should not.
export function applyWind(object3D, options = {}) {
  object3D.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) patch(material, options);

    // The shadow twin. Without this the tree sways and its shadow does not, which reads as
    // a lighting bug rather than as a missing feature -- and PropKit.mesh() turned
    // castShadow on for every prop in the project.
    if (node.castShadow) {
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patch(depth, options);
      node.customDepthMaterial = depth;
    }
  });
  return object3D;
}

// WHICH PROPS MOVE, and how much.
//
// Opt-in by name. A list rather than a heuristic, because "does this sway" is a judgement
// about what the thing IS -- a hedge does, a stone wall does not, and no property of the
// geometry can tell you which. `top` is roughly the prop's own height in feet, since the
// weight is normalised against it; `amount` is how flexible it is.
export const WIND_PROPS = new Map([
  // Big trees: a lot of height, a modest amount of movement.
  ['araucaria-tree', { top: 40, amount: 0.55 }],
  ['douglas-fir', { top: 46, amount: 0.5 }],
  ['conifer-tree', { top: 26, amount: 0.6 }],
  ['nb-conifer', { top: 24, amount: 0.6 }],
  ['shade-tree', { top: 24, amount: 0.8 }],
  ['nb-tree', { top: 22, amount: 0.8 }],
  ['birch-tree', { top: 26, amount: 0.95 }],
  ['plane-tree', { top: 28, amount: 0.7 }],
  ['ginkgo-tree', { top: 24, amount: 0.8 }],
  ['hawthorn-tree', { top: 16, amount: 0.85 }],
  ['flowering-tree', { top: 20, amount: 0.85 }],
  ['flowering-cherry', { top: 22, amount: 0.85 }],
  ['japanese-maple', { top: 16, amount: 0.95 }],
  ['cypress-tree', { top: 30, amount: 0.45 }],
  ['date-palm', { top: 34, amount: 1.1 }],
  ['tree-fern', { top: 18, amount: 1.15 }],
  ['polylepis-tree', { top: 15, amount: 0.8 }],
  ['mesquite-tree', { top: 14, amount: 0.7 }],
  ['wonder-tree', { top: 22, amount: 0.8 }],
  ['chalk-tree', { top: 18, amount: 0.9 }],
  ['lollipop-tree', { top: 16, amount: 0.9 }],
  ['snapped-tree', { top: 18, amount: 0.3 }],

  // Undergrowth: short, and the most flexible things in any world.
  ['fern-patch', { top: 4.5, amount: 1.5 }],
  ['grass-clump', { top: 3.2, amount: 1.7 }],
  ['dry-grass', { top: 3.2, amount: 1.7 }],
  ['ichu-grass', { top: 3.5, amount: 1.6 }],
  ['wheat-patch', { top: 4.5, amount: 1.5 }],
  ['reed-bed', { top: 8, amount: 1.4 }],
  ['terrace-crop', { top: 3.5, amount: 1.4 }],
  ['meadow-flowers', { top: 2.6, amount: 1.4 }],
  ['flower-bed', { top: 2.4, amount: 1.3 }],
  ['andean-flowers', { top: 2.4, amount: 1.3 }],
  ['chalk-flowers', { top: 4, amount: 1.2 }],
  ['wonder-flower', { top: 6, amount: 1.2 }],
  ['giant-flower', { top: 9, amount: 1.1 }],
  ['rhododendron-bed', { top: 5, amount: 0.9 }],
  ['rose-bush', { top: 4, amount: 1 }],
  ['magnolia-shrub', { top: 7, amount: 1 }],
  ['desert-shrub', { top: 4, amount: 1 }],
  ['clipped-shrub', { top: 5, amount: 0.6 }],
  ['heart-hedge', { top: 6, amount: 0.5 }],
  ['nb-hedge', { top: 5, amount: 0.5 }],

  // A Bug's Life is built at sixty times life size, so its grass is a fifty-foot tower and
  // its stillness is the loudest wrong thing in that world.
  ['grass-blade', { top: 52, amount: 1.6 }],

  // Under the Sea. Water moves everything, and the reef standing perfectly still is the
  // one thing a world made of water could not not do.
  ['seagrass-patch', { top: 7, amount: 1.5 }],
  ['sea-fan', { top: 8, amount: 0.9 }],
  ['sea-anemone', { top: 3, amount: 1.4 }],
  ['staghorn-coral', { top: 6, amount: 0.45 }],
  ['coral-garden', { top: 5, amount: 0.7 }],
]);
