// Edusim HiFi -- shared constants.
//
// World units are FEET, exactly as in the main app: the camera is a 5ft-tall person and
// every size below is calibrated against that. The scene also runs RIGHT-HANDED
// (scene.useRightHandedSystem) so that a layout written for the three.js app -- spawn
// looking down -Z, props authored facing +Z, rotY measured the same way -- carries over
// coordinate for coordinate. Babylon's native left-handed space would mirror every world.

export const MOVE_SPEED = 9; // feet/second, the main app's figure
export const RUN_MULTIPLIER = 2.2; // Shift
export const TURN_SPEED = 2; // radians/second
export const LOOK_SENSITIVITY = 0.0035; // radians per pixel of mouse drag
export const TOUCH_LOOK_SENSITIVITY = 0.0055;
export const MAX_PITCH = Math.PI / 2 - 0.08;
export const EYE_HEIGHT = 5;
// THE WALKABLE WORLD IS THE MAIN APP'S OWN: 195ft in radius, about 2.7 acres. An earlier pass
// opened it out to 640ft and that was the wrong place to spend the budget -- a world three
// times wider is mostly empty ground to cross, and every triangle spent covering it is one
// not spent on the models a student actually walks up to. What HiFi adds past the bound is
// SCENERY, not territory: the terrain runs on to a ring of hills so the world has a horizon,
// but nobody has to walk there. (The cap Rich set is "roughly 100 acres"; this is far inside
// it, and the scenery ring is what would grow first if a world ever needed the room.)
//
// It is also not a free choice: PlayerController and every layout in the main app are built
// to this number, and HiFi runs that code as it stands.
export const WORLD_BOUND_RADIUS = 195;
// Main-app layouts stand props out to the corners of their 400ft plane, so the ground has to
// be the CLASSIC ground -- identical heights -- at least that far out. HiFi's own relief and
// the hills only begin past it.
export const CLASSIC_EXTENT = 290;
export const GROUND_SIZE = 440; // feet covered by the painted ground mask
export const FAR_TERRAIN_RADIUS = 9000;

export const BOOT_WORLD = 'park';

// Budgets. The main app is held to ~1.5M triangles and under 1000 draw calls a frame, because
// its target is integrated graphics. HiFi targets current machines with discrete GPUs and is
// budgeted accordingly -- roughly an order of magnitude up on every axis:
//
//   triangles drawn / frame   ~12M  (high)   ~20M (ultra)     main app: 1.5M
//   draw calls                ~3000                          main app: 1000
//   texture sets              2K PBR (albedo/normal/ORM)      main app: 96px bump tiles
//   walkable world            195ft radius -- the SAME; the budget goes on models
//   terrain                   ~1M triangles, 1ft cells        main app: 29k, 3.3ft cells
//   a hero tree               ~12k triangles, 2,500 leaf cards   main app: ~1.5k
//   shadow maps               4 cascades x 4096               main app: one 2048 ortho box
//
// These are targets to measure against, the same rule the main app keeps: a world that lands
// near the top of the envelope gets profiled on real hardware before it is trusted.
//
// 'high' is the default, 'ultra' is for machines with room to spare, and 'medium' exists so a
// laptop on battery still gets a usable frame rate rather than a slideshow.
export const QUALITY = {
  medium: { shadowSize: 2048, cascades: 3, ssao: false, msaa: 2, grassRadius: 60, grassDensity: 0.6, probe: 128, hardwareScale: 1.25, lodDistance: 160, detail: 0.6, shadowDistance: 200 },
  high: { shadowSize: 4096, cascades: 3, ssao: true, msaa: 4, grassRadius: 90, grassDensity: 1.1, probe: 256, hardwareScale: 1, lodDistance: 240, detail: 1, shadowDistance: 300 },
  ultra: { shadowSize: 4096, cascades: 4, ssao: true, msaa: 8, grassRadius: 140, grassDensity: 1.8, probe: 512, hardwareScale: 1, lodDistance: 520, detail: 1.5, shadowDistance: 560 },
};
export const DEFAULT_QUALITY = 'high';

export const DEFAULT_THEME = 'default';

// ---- the HiFi edition's own places ------------------------------------------------------------
// Its own IndexedDB database (see main.js for why it cannot share the main app's), and its own
// gallery: the Edusim HiFi Worlds Database, served from /hifiworlds/ in the same docroot as
// this app's /hifi/. The link BASE is root-relative for the main app's reason -- the fetch has
// to be same-origin whatever scheme the site is on -- and the gallery URL is relative for the
// same reason every other link in that docroot is.
export const HIFI_DB_NAME = 'edusim-hifi-world';
export const HIFI_GALLERY_URL = '../hifiworlds/';
export const HIFI_WORLD_LINK_PARAM = 'hifiworld';
export const HIFI_WORLD_LINK_BASE = '/hifiworlds/download.php?id=';
