import * as THREE from 'three';
import { GROUND_SIZE, TERRAIN_SEGMENTS, WORLD_THEMES, DEFAULT_THEME } from './config.js';
import { photoMap } from './SurfaceTextures.js';

// One tile of ground detail per ~6.7ft. Small enough that a student standing still sees
// real grain underfoot, large enough that the repeat is not obvious across a 400ft plane.
const GROUND_DETAIL_REPEAT = 60;
// How hard the photo is allowed to swing away from the theme's own colour. See
// neutralized() in SurfaceTextures.js -- at 1.0 the photo's full relative range comes
// through, and past about 0.6 the ground starts to read as the photo's material rather
// than as the world's.
const GROUND_DETAIL_STRENGTH = 0.8;

// Ground detail maps are cached per FILE, not per theme, because several themes share
// one: the park, museum, library and dinosaur worlds are all soil-and-growth, and the
// moon and mars are both regolith. Unlike the props, the ground mesh is created once and
// never disposed -- applyWorldTheme mutates it in place -- so a shared texture here is
// safe in the one place it would not be anywhere else.
const groundDetail = new Map();
function groundDetailFor(file) {
  if (!groundDetail.has(file)) {
    groundDetail.set(file, {
      // luminance: the photo contributes brightness variation ONLY, never hue. Keeping
      // its relative channel differences left mossy patches in the source showing
      // through as green on the Moon and Mars; the world theme owns the ground colour,
      // and the photo's job is grain, grit and wear.
      map: photoMap(file, { repeat: GROUND_DETAIL_REPEAT, neutralize: GROUND_DETAIL_STRENGTH, luminance: true }),
      // The SAME photo again, un-neutralized, as a height field. Neutralizing is what
      // keeps the photo's colour out of the theme's way, but a bump map wants its full
      // range -- flattening it toward white would flatten the relief with it. This is
      // what puts real grain under a student's feet; the rebalanced colour map alone is
      // too washed out to read at standing height.
      bumpMap: photoMap(file, { repeat: GROUND_DETAIL_REPEAT, data: true }),
    });
  }
  return groundDetail.get(file);
}

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

// A second, higher-frequency layer used only by the moon theme: shallow dimples that
// read as small impact craters at walking scale, on top of the broad maria swells.
function pockNoise(x, z) {
  return Math.sin(x * 0.32 + 0.4) * Math.cos(z * 0.29 - 1.1) * Math.cos(x * 0.11 + z * 0.13);
}

// Flattens out to exactly 0 within the theme's flatRadius (so the spawn point and
// whatever sits at the middle of a world are on level ground), then eases up to full
// hill height by blendRadius.
//
// EXPORTED for one reason: tools/export-preset-world.mjs. Every placement path in the app
// gets its ground height by raycasting the real mesh, which is right, and which needs a
// renderer, a canvas and a rendered frame. Exporting a preset world to a .json for the
// gallery needs the same numbers with none of that -- and re-deriving them in the tool
// would be a copy of this function free to drift away from it.
export function terrainHeightAt(theme, worldX, worldZ) {
  const radius = Math.hypot(worldX, worldZ);
  const falloff = smoothstep(theme.flatRadius, theme.blendRadius, radius);
  if (falloff === 0) return 0;
  const base = (rawNoise(worldX, worldZ) / RAW_NOISE_PEAK) * theme.amplitude;
  const pocks = theme.pockAmplitude ? pockNoise(worldX, worldZ) * theme.pockAmplitude : 0;
  return (base + pocks) * falloff;
}

// Rewrites the ground mesh's existing position + color attributes in place for a
// theme. Deliberately in-place on the SAME BufferGeometry and the same Mesh:
// PlayerController and every placement path hold a reference to that mesh and raycast
// against it for ground height, so swapping the object out would strand them, while
// mutating it means they all pick up the new terrain on their very next raycast with
// no notification plumbing at all.
function writeTerrain(geometry, theme) {
  const position = geometry.attributes.position;
  const color = geometry.attributes.color;
  const low = new THREE.Color(theme.groundLow);
  const high = new THREE.Color(theme.groundHigh);
  const tint = new THREE.Color();

  for (let i = 0; i < position.count; i++) {
    // PlaneGeometry is authored flat in local XY (z=0); the mesh is rotated -90° about
    // X to lay it down, which maps local Z -> world Y (up) and local Y -> world -Z.
    const localX = position.getX(i);
    const localY = position.getY(i);
    const height = terrainHeightAt(theme, localX, -localY);
    position.setZ(i, height);

    const t = THREE.MathUtils.clamp(height / (theme.amplitude || 1), -1, 1) * 0.5 + 0.5;
    tint.copy(low).lerp(high, t);
    color.setXYZ(i, tint.r, tint.g, tint.b);
  }

  position.needsUpdate = true;
  color.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

// A dome of points far outside the play area. Only the airless themes switch it on --
// stars are invisible from a daylit planet surface with an atmosphere.
function buildStarfield() {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tint = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // Uniform over the upper hemisphere: sampling cos(phi) rather than phi avoids the
    // dense clump straight overhead that naive uniform-angle sampling produces.
    const theta = Math.random() * Math.PI * 2;
    const y = Math.random();
    const r = Math.sqrt(1 - y * y);
    const radius = 460;
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;

    tint.setHSL(0.55 + Math.random() * 0.12, 0.25 * Math.random(), 0.6 + Math.random() * 0.4);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const stars = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, fog: false })
  );
  stars.name = 'starfield';
  stars.visible = false;
  return stars;
}

// Module-level because the theme is a property of THE world, not of any one caller --
// main.js, WorldStore (rehydrating a saved theme) and WorldPresets all reach for it.
const state = {
  scene: null,
  ground: null,
  hemi: null,
  sun: null,
  stars: null,
  themeName: null,
};

export function buildWorld(scene) {
  const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));

  const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  // Bake the -90° rotation into matrixWorld NOW, before anything can raycast against it.
  //
  // three.js only refreshes matrixWorld as a side effect of a render traversal, and
  // Raycaster does not force one -- so between this line and the first rendered frame the
  // ground's world matrix is the IDENTITY, which means the plane is still standing UPRIGHT
  // in the XY plane as PlaneGeometry authored it. A ground-height probe in that window
  // does not miss (which would be harmless, it returns 0); it HITS the vertical plane and
  // comes back with a vertex row's local Y as a height. That put a 96ft theatre 157ft
  // underground in a preset world built before the first frame. The ground never moves
  // afterwards -- applyWorldTheme rewrites its vertices in place, never its transform --
  // so one call here is all it ever needs.
  ground.updateMatrixWorld();

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x3a3a2a, 1.1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowExtent = GROUND_SIZE / 2;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  const stars = buildStarfield();
  scene.add(stars);

  state.scene = scene;
  state.ground = ground;
  state.hemi = hemi;
  state.sun = sun;
  state.stars = stars;

  applyWorldTheme(DEFAULT_THEME);

  return { ground };
}

export function getWorldTheme() {
  return state.themeName;
}

// The scene-graph stand-in for a `world-theme` record. The theme is a property of the
// world rather than of any object, but every persisted thing in this app is a record
// with an Object3D, so it gets an empty Group: it renders nothing, has no geometry to
// raycast against (so ObjectMenu and PlayIconManager can never pick it), and rides
// along through registry.clear(), Load World and a world-file export for free.
export function createThemeMarker() {
  const marker = new THREE.Group();
  marker.userData.isWorldTheme = true;
  return marker;
}

// The stand-in object for a `world-spawn` record -- where a world puts the player when it
// is opened. Same shape and same reasoning as the theme marker above: an empty Group has
// no geometry, so it can never be hit by ObjectMenu's raycast or given a play icon, but it
// IS an ordinary registry citizen. That is what makes the spawn survive everything for
// free -- it is written to IndexedDB, exported into a world file by Save World (which just
// maps the registry back to records), carried through the gallery, and rehydrated by
// loadFromRecords -- with no path in the app needing to know it exists.
export function createSpawnMarker() {
  const marker = new THREE.Group();
  marker.userData.isWorldSpawn = true;
  return marker;
}

// Retints and reshapes the whole environment: sky, fog, ground relief and color, the
// two lights, and the starfield. Cheap enough to call on a menu click (one pass over
// ~15k terrain vertices), and a no-op when the requested theme is already live -- which
// is what lets WorldPresets apply a theme up front to get correct ground heights and
// then have the world's own `world-theme` record re-apply it harmlessly on rehydrate.
export function applyWorldTheme(themeName) {
  const name = WORLD_THEMES[themeName] ? themeName : DEFAULT_THEME;
  if (!state.scene || state.themeName === name) return;
  const theme = WORLD_THEMES[name];

  state.scene.background = new THREE.Color(theme.sky);
  state.scene.fog = new THREE.Fog(theme.sky, theme.fogNear, theme.fogFar);

  writeTerrain(state.ground.geometry, theme);
  state.ground.material.roughness = theme.groundRoughness ?? 1;
  // A theme without a groundDetail file keeps the plain vertex-coloured ground it has
  // always had; `map = null` is the same no-op as the white stand-in.
  const detail = theme.groundDetail ? groundDetailFor(theme.groundDetail) : null;
  state.ground.material.map = detail?.map ?? null;
  state.ground.material.bumpMap = detail?.bumpMap ?? null;
  state.ground.material.bumpScale = detail ? 0.45 : 1;
  state.ground.material.needsUpdate = true;

  state.hemi.color.set(theme.hemiSky);
  state.hemi.groundColor.set(theme.hemiGround);
  state.hemi.intensity = theme.hemiIntensity;

  state.sun.color.set(theme.sunColor);
  state.sun.intensity = theme.sunIntensity;
  state.sun.position.set(theme.sunPosition[0], theme.sunPosition[1], theme.sunPosition[2]);

  state.stars.visible = !!theme.stars;

  state.themeName = name;
}
