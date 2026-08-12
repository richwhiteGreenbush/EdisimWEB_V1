// World units are feet throughout -- the camera is a 5ft-tall person, and every
// distance/size constant below is calibrated against that.
export const MOVE_SPEED = 6; // feet/second
export const TURN_SPEED = 2; // radians/second
export const LOOK_SENSITIVITY = 0.0035; // radians per pixel of mouse drag
// A finger swipe crosses a few hundred pixels at most on a phone, where a mouse drag
// has a whole desktop display to work with -- at the mouse figure above, a full swipe
// across a handset turns the view by well under 45deg and reads as broken.
export const TOUCH_LOOK_SENSITIVITY = 0.0055; // radians per pixel of finger drag
export const MAX_PITCH = Math.PI / 2 - 0.08; // clamp just short of straight up/down
export const EYE_HEIGHT = 5; // feet
export const WORLD_BOUND_RADIUS = 195; // stay within the 400x400 ground plane

export const GROUND_SIZE = 400;
export const TERRAIN_SEGMENTS = 120; // ground mesh subdivisions per side

// Every visual property of the environment itself -- sky, fog, ground relief, ground
// color, and the two scene lights -- lives here, keyed by theme name. SceneSetup's
// applyWorldTheme() reshapes the existing ground mesh in place from these numbers, and
// a preset world persists its choice as a `world-theme` record so the setting survives
// a reload or a Save/Load World round trip.
//
// flatRadius / blendRadius: terrain is EXACTLY flat inside flatRadius and reaches full
// amplitude by blendRadius. The museum and library both drop a ~50ft building near the
// origin, so their flat zone has to comfortably contain that footprint or the building
// ends up straddling a hillside.
// `park` is the world a brand-new visitor lands in -- main.js builds it whenever
// rehydration comes back empty. `default` is the bare green world, kept for backward
// compatibility: it is exactly the old hardcoded terrain constants, so any world saved
// before themes existed, or cleared back to nothing, looks precisely as it always did.
export const DEFAULT_THEME = 'default';
export const BOOT_WORLD = 'park';

export const WORLD_THEMES = {
  default: {
    sky: 0x87ceeb,
    fogNear: 60,
    fogFar: 220,
    groundLow: 0x3d6b30,
    groundHigh: 0x7fae52,
    amplitude: 2.5,
    flatRadius: 14,
    blendRadius: 34,
    hemiSky: 0xbfd9ff,
    hemiGround: 0x3a3a2a,
    hemiIntensity: 1.1,
    sunColor: 0xfff2d6,
    sunIntensity: 2.2,
    sunPosition: [60, 90, 40],
    stars: false,
  },
  park: {
    sky: 0x8fc4ea,
    fogNear: 110,
    fogFar: 340,
    groundLow: 0x3f6b2e,
    groundHigh: 0x82b34d,
    // Gentle rolling meadow rather than the default's hillier ground: an Olmsted park
    // reads as broad open lawn with soft swells. Amplitude is kept low because the
    // flagstone paths are laid as flat segments -- steeper ground would bury one end
    // of a segment and float the other.
    amplitude: 3.2,
    flatRadius: 26,
    blendRadius: 95,
    hemiSky: 0xd2e8ff,
    hemiGround: 0x46512c,
    hemiIntensity: 1.25,
    sunColor: 0xfff4d9,
    sunIntensity: 2.4,
    sunPosition: [80, 120, 55],
    stars: false,
  },
  museum: {
    sky: 0x9ec6e8,
    fogNear: 90,
    fogFar: 280,
    groundLow: 0x5f7a4a,
    groundHigh: 0x8fa86a,
    amplitude: 1.6,
    flatRadius: 76,
    blendRadius: 130,
    hemiSky: 0xd6e6ff,
    hemiGround: 0x4a4536,
    hemiIntensity: 1.35,
    sunColor: 0xfff4e0,
    sunIntensity: 2.3,
    sunPosition: [70, 110, 60],
    stars: false,
  },
  library: {
    sky: 0xa9c9e6,
    fogNear: 90,
    fogFar: 280,
    groundLow: 0x496b34,
    groundHigh: 0x84a55a,
    amplitude: 1.8,
    flatRadius: 82,
    blendRadius: 140,
    hemiSky: 0xcfe2ff,
    hemiGround: 0x574d3c,
    hemiIntensity: 1.5,
    sunColor: 0xffeccb,
    sunIntensity: 2.1,
    // Steep on purpose. The library is the only preset with a roofed interior, and a
    // low sun throws its daylight straight into a wall instead of down onto the floor.
    sunPosition: [-45, 130, 40],
    stars: false,
  },
  moon: {
    // No atmosphere means a black sky at high noon and brutally hard shadows: the
    // hemisphere fill is dialled right down so the sun does nearly all the lighting,
    // which is exactly why real lunar photographs look the way they do.
    sky: 0x05060b,
    fogNear: 150,
    fogFar: 340,
    groundLow: 0x54524c,
    groundHigh: 0xa8a49a,
    groundRoughness: 1,
    // A wide level landing site ringed by hills -- which is also how real Apollo sites
    // were chosen. Everything the crew left behind sits inside the flat zone.
    amplitude: 5.5,
    pockAmplitude: 0.8,
    flatRadius: 42,
    blendRadius: 95,
    hemiSky: 0x2b3038,
    hemiGround: 0x14161a,
    hemiIntensity: 0.35,
    sunColor: 0xfffdf5,
    sunIntensity: 3.4,
    sunPosition: [90, 60, 70],
    stars: true,
  },
  mars: {
    // The butterscotch sky is not artistic licence: fine iron-oxide dust suspended in
    // the thin air scatters the red end of sunlight through, which is also why Martian
    // SUNSETS are blue -- the exact opposite of Earth's.
    sky: 0xc8a184,
    fogNear: 100,
    fogFar: 340,
    groundLow: 0x6d3a22,
    groundHigh: 0xb0714a,
    groundRoughness: 1,
    // A broad flat basin for the base, ringed by hills. flatRadius has to comfortably
    // contain the 44ft dome AND its outbuildings, or the habitat straddles a slope.
    amplitude: 5.5,
    pockAmplitude: 0.7,
    flatRadius: 50,
    blendRadius: 115,
    hemiSky: 0xe6b892,
    hemiGround: 0x3d1f12,
    hemiIntensity: 0.95,
    sunColor: 0xfff0dc,
    // Mars gets about 43% of the sunlight Earth does, and dust dims it further, so the
    // sun is a notch weaker than the park's -- but only a notch. Dialled to what it
    // "really" is, the world reads as broken rather than as distant.
    sunIntensity: 2.0,
    sunPosition: [75, 105, 45],
    // No starfield: unlike the Moon, Mars has enough atmosphere to make a bright
    // daytime sky, and stars are washed out of it just as they are on Earth.
    stars: false,
  },
  voyage: {
    // "Fantastic Voyage" -- the visitor has been miniaturised, so the environment is
    // meant to read as fluid rather than as landscape: a deep plasma teal overhead and a
    // close fog wall, which is what makes a 400ft ground plane feel like the inside of
    // something instead of an open field.
    //
    // The colours here are chosen AGAINST the exhibits, not for themselves. Every organ
    // model in this world is warm -- pink lung, red heart, brown liver -- and a warm
    // environment would have swallowed all of them into one red mush, which is the same
    // class of mistake as the Mars props that came out as black silhouettes. Cool teal
    // sky over a muted mauve-grey membrane floor makes the tissue colours pop, and the
    // charts (cream paper) read from right across the hall.
    sky: 0x24485c,
    fogNear: 80,
    fogFar: 250,
    groundLow: 0x3c3849,
    groundHigh: 0x7d7490,
    // Nearly flat, and flat over a very wide radius: this is an exhibition hall floor
    // with plinths, chart posts and a 30ft tunnel on it, and every one of those is a
    // rigid object that straddles a slope badly.
    amplitude: 2.2,
    flatRadius: 88,
    blendRadius: 155,
    hemiSky: 0xbfe4f2,
    hemiGround: 0x4c4557,
    hemiIntensity: 1.55,
    sunColor: 0xfff2e4,
    sunIntensity: 2.2,
    sunPosition: [60, 115, 50],
    stars: false,
  },
  dinosaur: {
    // Late Cretaceous: hot, humid and far more carbon dioxide than today, with no ice
    // at either pole. The short fog distance is the point -- a coastal floodplain in
    // that climate is hazy, and the haze is what makes the island feel enclosed and
    // makes a 40ft animal loom out of it rather than being visible from the far side.
    sky: 0xa9c8cc,
    fogNear: 70,
    fogFar: 265,
    groundLow: 0x2e5326,
    groundHigh: 0x77a244,
    // The flat zone has to hold the field camp, the boardwalk junctions AND the dig
    // trench, whose floor is a flat slab -- on a slope one end of it buries itself and
    // the other floats.
    amplitude: 6,
    flatRadius: 46,
    blendRadius: 112,
    hemiSky: 0xd8ece2,
    // Deliberately much lighter than the other worlds' ground bounce. This is the only
    // preset with a closed canopy AND large animals standing under it, and the hemi
    // light is all that fills a shadowed hide -- at 0x2c3418 a Triceratops parked in
    // tree shade read as a black silhouette with no readable shape at all.
    hemiGround: 0x57633c,
    hemiIntensity: 1.45,
    sunColor: 0xfff1cd,
    sunIntensity: 2.3,
    sunPosition: [65, 100, 55],
    stars: false,
  },
};

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
// Wikipedia specifically because it is known to allow being framed -- most large sites
// send X-Frame-Options/CSP frame-ancestors headers that block it outright, and there is
// no client-side workaround. See the web browser panel notes in CLAUDE.md.
export const WEB_BROWSER_DEFAULT_URL = 'https://en.wikipedia.org/wiki/Edusim';
export const EDIT_ICON_SIZE = 0.7; // feet, billboard sprite size
export const EDIT_ICON_MARGIN = 0.6; // feet above the panel's bounding-box top

export const DB_NAME = '3dcoder-world';
export const DB_VERSION = 1;
export const STORE_NAME = 'placedObjects';
