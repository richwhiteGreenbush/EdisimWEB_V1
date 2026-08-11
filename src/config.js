// World units are feet throughout -- the camera is a 5ft-tall person, and every
// distance/size constant below is calibrated against that.
export const MOVE_SPEED = 6; // feet/second
export const TURN_SPEED = 2; // radians/second
export const LOOK_SENSITIVITY = 0.0035; // radians per pixel of drag
export const MAX_PITCH = Math.PI / 2 - 0.08; // clamp just short of straight up/down
export const EYE_HEIGHT = 5; // feet
export const WORLD_BOUND_RADIUS = 195; // stay within the 400x400 ground plane

export const GROUND_SIZE = 400;
export const TERRAIN_SEGMENTS = 120; // ground mesh subdivisions per side
export const TERRAIN_AMPLITUDE = 2.5; // feet, max hill height
export const TERRAIN_FLAT_RADIUS = 14; // feet -- perfectly flat clearing around spawn/startup assets
export const TERRAIN_BLEND_RADIUS = 34; // feet -- hills reach full height by this radius

// Spiral radius grows as SPAWN_SPACING*sqrt(n); keep SPAWN_DISTANCE comfortably larger
// than that radius for a reasonable number of placements, or later objects wrap around
// behind the camera instead of fanning out in front of it.
export const SPAWN_DISTANCE = 20; // feet in front of the camera
export const SPAWN_SPACING = 6; // golden-angle spiral spacing between sequential imports (feet)
export const GOLDEN_ANGLE = 2.399963229728653; // radians (~137.5deg)

export const MODEL_MAX_BYTES = 200 * 1024 * 1024; // 200MB
export const IMAGE_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const MODEL_ROOT_EXTENSIONS = ['gltf', 'glb', 'obj'];
export const MODEL_AUX_EXTENSIONS = ['mtl', 'bin']; // never placed standalone, only resolved alongside a model root
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif'];
export const IMAGE_PLANE_MAX_SIZE = 5; // feet, longest edge

export const BALLOON_MAX_INFLATE = 0.45; // feet
export const BALLOON_TARGET_SPAN = 1.5; // feet, normalized outline width

export const MODEL_TARGET_HEIGHT = 5; // feet -- every imported model is normalized to this height

export const STARTUP_ASSET_SPACING = 20; // feet between the boot-time starter assets
export const STARTUP_LOADED_KEY = '3dcoder-starter-loaded';

export const PLAY_ICON_SIZE = 0.8; // feet, billboard sprite size
export const PLAY_ICON_MARGIN = 0.6; // feet above the object's bounding-box top

// Shared color palette -- Draw's swatches, the "change color to" block's default,
// and Light Orb placement all pick from this same set so the whole app feels like
// one consistent palette rather than several independently-guessed color lists.
export const PALETTE_SWATCHES = ['#e0455f', '#f2a541', '#3fb37f', '#3d8bf2', '#8a5cf5', '#f5f5f5'];

export const ORB_RADIUS = 0.35; // feet, glowing core sphere
export const ORB_HALO_SCALE = 1.8; // halo sphere radius, as a multiple of ORB_RADIUS
export const ORB_HOVER_HEIGHT = 3; // feet above the ground the orb floats at
export const ORB_EMISSIVE_INTENSITY = 2.2;
export const ORB_LIGHT_INTENSITY = 1.4;
export const ORB_LIGHT_DISTANCE = 16; // feet, PointLight falloff range

export const WEB_BROWSER_WIDTH = 4; // feet
export const WEB_BROWSER_HEIGHT = 2.6; // feet
export const WEB_BROWSER_DOM_WIDTH = 900; // px -- DOM authoring size, for crisp text
export const WEB_BROWSER_DOM_HEIGHT = 585; // px -- keeps the same 4:2.6 aspect as above
export const WEB_BROWSER_DEFAULT_URL = 'https://en.wikipedia.org/wiki/Three.js';
export const EDIT_ICON_SIZE = 0.7; // feet, billboard sprite size
export const EDIT_ICON_MARGIN = 0.6; // feet above the panel's bounding-box top

export const DB_NAME = '3dcoder-world';
export const DB_VERSION = 1;
export const STORE_NAME = 'placedObjects';
