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
    groundDetail: 'ground-soil.jpg',
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
    groundDetail: 'ground-soil.jpg',
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
    groundDetail: 'ground-soil.jpg',
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
    groundDetail: 'ground-regolith.jpg',
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
    groundDetail: 'ground-regolith.jpg',
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
    //
    // The palette was WIDENED rather than changed. Holding to cool-against-warm is still
    // right and is the whole reason the exhibits read -- but the first pass held it with a
    // very narrow range, a near-monochrome slate teal over a grey-mauve floor, and a hall
    // of that reads as fog whatever is standing in it. The sky is more saturated now and
    // the floor ramp runs a much wider spread, from a deep plum in the hollows to a warm
    // lilac on the rises: still cool, still nothing like the tissue colours, but with
    // enough range that the ground has form and the fog has somewhere to go.
    sky: 0x1d5070,
    fogNear: 84,
    fogFar: 260,
    groundLow: 0x332c46,
    groundHigh: 0x9b8fae,
    // Nearly flat, and flat over a very wide radius: this is an exhibition hall floor
    // with plinths, chart posts and a 30ft tunnel on it, and every one of those is a
    // rigid object that straddles a slope badly.
    amplitude: 2.2,
    flatRadius: 88,
    blendRadius: 155,
    hemiSky: 0xc9ecf8,
    hemiGround: 0x554b63,
    hemiIntensity: 1.62,
    sunColor: 0xfff4e6,
    sunIntensity: 2.25,
    sunPosition: [60, 115, 50],
    stars: false,
  },
  newyork: {
    // Broadway at Times Square on a hazy summer afternoon in 1949.
    //
    // Two things here are not the usual choices, and both are because this is the only
    // world whose ground is a MAN-MADE surface rather than landscape:
    //
    //  * The relief is effectively switched off (a low amplitude over a flat radius that
    //    swallows the whole block). Every building, sidewalk slab and curb in this world
    //    is a rigid box tens of feet long, and rolling ground puts one end of each of them
    //    underground and floats the other -- the same reason the museum and library
    //    widened their flat zones, taken to its conclusion.
    //  * The ground ramp is a narrow grey-brown, not a two-tone ramp. The street prop lays
    //    its own asphalt and concrete on top, so this colour is only ever glimpsed past
    //    the ends of the block, where it needs to read as more city and not as a meadow.
    groundDetail: 'ground-regolith.jpg',
    sky: 0xa8bfd2,
    // Close haze. Manhattan in July genuinely looks like this, and it is also what makes
    // a 400ft ground plane read as one block of an endless city instead of as an island:
    // the far end of the avenue fades before the edge of the world can be seen.
    fogNear: 70,
    fogFar: 250,
    groundLow: 0x4b4842,
    groundHigh: 0x6b675e,
    groundRoughness: 1,
    amplitude: 2.0,
    flatRadius: 165,
    blendRadius: 198,
    hemiSky: 0xd8e6f2,
    // Deliberately much lighter than any other outdoor world's ground bounce, and for the
    // same reason Dinosaur Island needed it: this world is a canyon. The sun can only ever
    // light ONE side of a street, and the hemisphere fill is the entire lighting budget for
    // the other -- at the usual 0x3d3933 the whole east frontage, marquees included, came
    // out as a black silhouette.
    hemiGround: 0x6b6459,
    hemiIntensity: 1.8,
    sunColor: 0xffeed2,
    sunIntensity: 2.45,
    // High and off to the +X side, so the west-facing shopfronts across the street are the
    // lit ones and the near sidewalk is in shade -- which is the light in the photograph,
    // and which is what makes the marquees read as lit rather than as painted panels.
    sunPosition: [95, 130, 55],
    stars: false,
  },
  sea: {
    // A tropical reef about 30ft down, in the middle of a bright day.
    //
    // This is the only theme whose job is to make the player feel SURROUNDED rather than
    // to light a landscape, and almost every number here is bent toward that:
    //
    //  * The fog is by far the closest in the app, and it is the single biggest reason
    //    the world reads as water. Clear tropical water still only gives 60-100ft of
    //    useful visibility, and everything past that fades to one flat blue -- which is
    //    also what stops a 400ft plane from ever showing its edge. Open it up to the
    //    park's distances and this stops being the sea and becomes a blue field.
    //  * Sunlight underwater is BLUE-WHITE and comes from almost straight overhead. Water
    //    absorbs red within the first 15ft, which is why a diver's photographs come back
    //    blue unless they carry a light; and the sun is steep because a shallow ray
    //    mostly reflects off the surface instead of entering it. The steepness is doing
    //    the same job it does in the library -- this is a world with overhangs, cave
    //    mouths and a solid ceiling of water over it.
    //  * The hemisphere fill is very high, and blue over sand. A reef is a heap of
    //    overhangs shading each other, and light in real water arrives from every
    //    direction at once because it is SCATTERED, not just from the sun -- the same
    //    problem Dinosaur Island's canopy had, with more of it.
    //
    // The ground ramp is pale carbonate sand rather than the seabed's true colour: it is
    // the reflector the whole reef is lit off, and the reef's own oranges and pinks need
    // something neutral to sit against. The corals supply the colour; the floor must not
    // compete with them.
    groundDetail: 'ground-regolith.jpg',
    sky: 0x1c6c99,
    fogNear: 30,
    fogFar: 155,
    groundLow: 0x8e8b74,
    groundHigh: 0xdcd2b2,
    groundRoughness: 1,
    // Low broad swells with a fine ripple layer on top -- pockAmplitude here is sand
    // waves, not the moon's craters. The flat zone holds the spawn, the browser station
    // and the reef's near edge.
    amplitude: 4.2,
    pockAmplitude: 0.5,
    flatRadius: 34,
    blendRadius: 108,
    hemiSky: 0x5fb4dc,
    // By some distance the LIGHTEST ground bounce in the app, and it has to be. Two things
    // are going on that no land world has. Light in water is scattered by the water itself,
    // so it genuinely arrives from every direction rather than only from the sun. And the
    // floor here is white carbonate sand, which is a far better reflector than grass or
    // regolith -- divers call the up-welling light off it "sand glare" for a reason.
    //
    // What forced the number was the shark. Its white belly faces DOWN, so the sun never
    // touches it and the ground bounce is the entire light it gets: at a normal outdoor
    // 0x7c8878 the countershading -- the second thing anybody recognises a shark by --
    // rendered as the same olive grey as its back, and the animal read as a lump. This is
    // the same lesson as the Mars props that came out as black silhouettes, in reverse.
    hemiGround: 0x9db2a8,
    hemiIntensity: 1.85,
    sunColor: 0xd8f2ff,
    sunIntensity: 2.5,
    sunPosition: [45, 175, 60],
    stars: false,
  },
  dinosaur: {
    groundDetail: 'ground-soil.jpg',
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

  // -------------------------------------------------------------------------
  // The nine curriculum worlds
  // -------------------------------------------------------------------------

  // Giza at mid-morning. Desert light is the brightest and hardest in this app: there is
  // no canopy, no cloud and no water vapour to soften it, so sunIntensity is the highest
  // anywhere here and hemiGround is a hot sand bounce rather than the usual cool earth.
  // That bounce is doing real work -- the Sphinx's north flank and every pyramid's shaded
  // face are lit by NOTHING else, and at a normal outdoor value they went to silhouette,
  // the same failure the Mars props hit.
  //
  // The sky is deliberately pale and slightly warm, not a saturated blue: desert haze
  // scatters enough dust to wash the horizon out, and a deep blue behind pale limestone
  // reads as a poster. Fog is far out (the point of this world is distant monumental
  // silhouettes) but not off, so the third pyramid sits back in the haze.
  egypt: {
    groundDetail: 'ground-regolith.jpg',
    sky: 0xd8c9a4,
    fogNear: 150,
    fogFar: 620,
    groundLow: 0xa8905f,
    groundHigh: 0xd8c193,
    groundRoughness: 1,
    amplitude: 3.4,
    flatRadius: 40,
    blendRadius: 150,
    hemiSky: 0xf2e4c4,
    hemiGround: 0x9c7f52,
    hemiIntensity: 1.5,
    sunColor: 0xfff0cc,
    sunIntensity: 2.9,
    sunPosition: [140, 150, 80],
    stars: false,
  },

  // Standing in space. This is the only theme with NO sun-facing ground bounce worth the
  // name: hemiGround is nearly black because there is no ground out here to bounce off,
  // and the planets have to be lit from one side like real bodies are. Turn the hemi up
  // and every planet becomes a flat disc with its terminator washed out -- the terminator
  // IS the lesson.
  //
  // Fog is off in practice (pushed past the far plane): haze between the viewer and Nep-
  // tune would be nonsense, and the walkway needs to show its whole length at once.
  solar: {
    sky: 0x05070f,
    fogNear: 400,
    fogFar: 1400,
    groundLow: 0x1d2130,
    groundHigh: 0x333850,
    groundRoughness: 0.9,
    amplitude: 0,
    flatRadius: 300,
    blendRadius: 320,
    // Lifted from the near-black the first pass used. Astronomically the fill out here
    // really is almost nothing, and at that value the deck, the placards and the outer
    // planets were all unlit silhouettes -- true, and pedagogically useless. This is the
    // lowest fill that still lets a student read a sign, with the deck's own emissive
    // edge lighting (see orbitWalk) doing the rest.
    hemiSky: 0x3d4a70,
    hemiGround: 0x141826,
    hemiIntensity: 0.95,
    sunColor: 0xfff6e8,
    sunIntensity: 3.1,
    // The directional light must come FROM WHERE THE SUN MODEL IS -- solarLayout puts it
    // at z = +104, the near end of the walk. The first pass left this at [-150, 60, 0],
    // so every planet was lit from the left while the Sun blazed away behind the student,
    // and the terminators all fell on the wrong side. In a world whose entire subject is
    // the Sun lighting the planets, that is not a lighting preference, it is an error.
    sunPosition: [10, 55, 190],
    stars: true,
  },

  // A bright showery afternoon over a valley -- the weather the cycle is made of. The
  // sky is a rain-washed blue-grey rather than the park's clean blue, fog sits close
  // enough to read as humidity, and the sun is strong but low-contrast: an overcast-edged
  // day has a very high hemi relative to its sun, which is exactly what keeps the
  // undersides of the cloud models readable instead of black.
  watercycle: {
    groundDetail: 'ground-soil.jpg',
    sky: 0x9fb8cc,
    fogNear: 90,
    fogFar: 330,
    groundLow: 0x3d6438,
    groundHigh: 0x76a355,
    amplitude: 5.5,
    flatRadius: 24,
    blendRadius: 110,
    hemiSky: 0xd8e6f2,
    hemiGround: 0x4e5a3a,
    hemiIntensity: 1.75,
    sunColor: 0xfff1dc,
    sunIntensity: 1.9,
    sunPosition: [70, 105, 60],
    stars: false,
  },

  // 24 August AD 79, early afternoon, under the ash column. The whole world is lit by a
  // sun that is being filtered through falling ash -- so sunColor is a strong ochre and
  // sunIntensity is DOWN, while hemiGround is a warm ash-grey lifted well above normal.
  //
  // This is the one theme where the sky and fog carry the narrative: a dirty amber sky
  // and close, warm haze put the eruption in every direction the student looks, without
  // needing a single prop to say so.
  pompeii: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xa8845c,
    fogNear: 70,
    fogFar: 300,
    groundLow: 0x6b5f4e,
    groundHigh: 0x9c8d74,
    amplitude: 2.8,
    flatRadius: 34,
    blendRadius: 120,
    hemiSky: 0xd9bb90,
    hemiGround: 0x6a5c48,
    hemiIntensity: 1.6,
    sunColor: 0xf0b464,
    sunIntensity: 1.7,
    sunPosition: [80, 95, 45],
    stars: false,
  },

  // A Tuscan workshop yard in late afternoon. Warm, dusty, low sun -- the light of the
  // drawings themselves. The ground is a beaten earth courtyard rather than grass, and
  // the sun is deliberately raked low so every machine casts a long readable shadow: a
  // wing frame and a screw are mostly VOID, and their shadow is what shows their shape.
  davinci: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xbfd0dc,
    fogNear: 80,
    fogFar: 300,
    groundLow: 0x6e5c44,
    groundHigh: 0xa08a68,
    amplitude: 1.4,
    flatRadius: 48,
    blendRadius: 120,
    hemiSky: 0xdfe6f0,
    hemiGround: 0x6a5a42,
    hemiIntensity: 1.4,
    sunColor: 0xffe2b0,
    sunIntensity: 2.5,
    sunPosition: [110, 62, 70],
    stars: false,
  },

  // New York harbour on a cold clear morning, 1907. A maritime sky: cooler and greyer
  // than any inland world here, with fog at a real harbour distance so Liberty across the
  // water sits in haze rather than crisply cut out -- which is what gives the crossing
  // its sense of distance. The ground ramp is harbour stone and wet paving, not grass.
  ellis: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xa8bccc,
    fogNear: 110,
    fogFar: 420,
    groundLow: 0x5a5f63,
    groundHigh: 0x8d9296,
    amplitude: 1.2,
    flatRadius: 60,
    blendRadius: 150,
    hemiSky: 0xcbdcea,
    hemiGround: 0x4e545a,
    hemiIntensity: 1.45,
    sunColor: 0xfff2e2,
    sunIntensity: 2.2,
    sunPosition: [90, 95, 70],
    stars: false,
  },

  // The National Mall on a clear spring day. Cleanest, most neutral light in the app on
  // purpose: this world is white marble against green lawn, and any warmth in the sun
  // turns the Capitol cream. High hemi because a dome is a curved surface whose whole
  // shaded half is lit by sky bounce alone.
  capitol: {
    groundDetail: 'ground-soil.jpg',
    sky: 0x8ec2e8,
    fogNear: 140,
    fogFar: 520,
    groundLow: 0x47713a,
    groundHigh: 0x86b45c,
    amplitude: 0.9,
    flatRadius: 90,
    blendRadius: 180,
    hemiSky: 0xdcecff,
    hemiGround: 0x4a5540,
    hemiIntensity: 1.5,
    sunColor: 0xfffaf0,
    sunIntensity: 2.35,
    sunPosition: [80, 130, 60],
    stars: false,
  },

  // The Great Barrier Reef in about 25ft of water -- shallower and clearer than `sea`,
  // which is set at 30ft on a Caribbean-style patch reef. So: fog opened up a little to
  // let a bommie field read as a field, a greener-blue water column (coral-sea water is
  // famously turquoise over white sand), and the same very high pale ground bounce, which
  // `sea` proved is what keeps a white-bellied animal from rendering as a lump.
  reef: {
    groundDetail: 'ground-regolith.jpg',
    sky: 0x1f86a8,
    fogNear: 42,
    fogFar: 190,
    groundLow: 0x9a9a80,
    groundHigh: 0xe4dcc0,
    groundRoughness: 1,
    amplitude: 2.2,
    flatRadius: 26,
    blendRadius: 105,
    hemiSky: 0x7fd4e8,
    hemiGround: 0xa6b8ad,
    hemiIntensity: 2.0,
    sunColor: 0xdff2ff,
    sunIntensity: 2.5,
    sunPosition: [30, 160, 25],
    stars: false,
  },

  // The lower Mississippi at golden hour. Humid river air: warm low sun, close haze off
  // the water, and a green-grey ground ramp for silt and levee grass. hemiGround is
  // lifted for the same reason Dinosaur Island's was -- a cypress swamp is a closed
  // canopy, and anything under Spanish moss is lit by bounce alone.
  delta: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xd9b98c,
    fogNear: 65,
    fogFar: 290,
    groundLow: 0x4a5638,
    groundHigh: 0x87905a,
    amplitude: 1.8,
    flatRadius: 30,
    blendRadius: 110,
    hemiSky: 0xf0d9b4,
    hemiGround: 0x5c6244,
    hemiIntensity: 1.6,
    sunColor: 0xffd9a0,
    sunIntensity: 2.3,
    sunPosition: [120, 48, 85],
    stars: false,
  },

  // Rome in late afternoon. Everything here is travertine -- a warm cream limestone that
  // has been weathering in the open for nineteen centuries -- so the sun is warm and low
  // and the ground ramp is dry grass over dust rather than lawn. The Colosseum is a
  // hollow ring of arcades, which means most of what a student sees is the INSIDE of a
  // shaded arch, so hemiIntensity is high for the same reason New York's is: a sun can
  // only ever light one face of a deep opening, and the fill light is the whole budget
  // for the other three.
  colosseum: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xa8c4de,
    fogNear: 130,
    fogFar: 480,
    groundLow: 0x6f6a4a,
    groundHigh: 0xa89a6c,
    amplitude: 1.1,
    flatRadius: 70,
    blendRadius: 165,
    hemiSky: 0xdce8ff,
    hemiGround: 0x6a6048,
    hemiIntensity: 1.75,
    sunColor: 0xffedcf,
    sunIntensity: 2.4,
    sunPosition: [-140, 95, 70],
    stars: false,
  },

  // Machu Picchu at 7,970ft, mid-morning, with cloud still in the valley.
  //
  // The sun is genuinely harsh: thin air at altitude scatters far less, so the light is
  // whiter and the shadows harder than in any other outdoor world here.
  //
  // The FOG had to be pulled back. It started at 55/330, which is what being inside a
  // cloud forest looks like -- and which erased Huayna Picchu, 300ft from the spawn and
  // the entire reason anyone recognises this place, into a pale grey ghost. The
  // atmosphere is carried by the `cloud-bank` props lying in the valley instead, which
  // put the weather where it belongs and leave the mountain visible.
  machupicchu: {
    groundDetail: 'ground-soil.jpg',
    sky: 0x7fb0dc,
    fogNear: 70,
    fogFar: 520,
    groundLow: 0x3a5230,
    groundHigh: 0x6d8848,
    amplitude: 2.4,
    flatRadius: 44,
    blendRadius: 140,
    hemiSky: 0xd6e8ff,
    hemiGround: 0x4c5a3c,
    hemiIntensity: 1.5,
    sunColor: 0xfffdf6,
    sunIntensity: 2.75,
    sunPosition: [95, 150, 105],
    stars: false,
  },

  // The Taj at first light, which is when it is actually visited and the one time of day
  // the marble is not white. It takes the colour of whatever sky is on it -- pink at
  // dawn, gold at dusk -- and that is the single most repeated fact about the building,
  // so the world has to show it rather than state it on a placard.
  //
  // Hence a rose sky with a low warm sun, and a hemiSky that is warm too, which is what
  // tints the dome's shaded half. A neutral fill would have left the building white on
  // one side and pink on the other, which is exactly wrong.
  // The sun is deliberately LOW and to one side rather than behind the tomb. Placed
  // straight behind it the whole facade -- the thing the world exists to show -- sits in
  // its own shadow, and no amount of fill light rescues a 100ft slab of marble lit only
  // from the sky. The hemisphere fill is also high and warm, which is what tints the
  // shaded half of the dome instead of leaving the building pink on one side and grey on
  // the other.
  tajmahal: {
    groundDetail: 'ground-soil.jpg',
    sky: 0xe8b48e,
    fogNear: 120,
    fogFar: 460,
    groundLow: 0x6b7a48,
    groundHigh: 0xa6b06c,
    amplitude: 0.7,
    flatRadius: 95,
    blendRadius: 190,
    hemiSky: 0xffd9bc,
    hemiGround: 0x6e6a50,
    hemiIntensity: 1.95,
    sunColor: 0xffd6a8,
    sunIntensity: 2.9,
    sunPosition: [-150, 78, 120],
    stars: false,
  },

  // Red Square under snow, in the flat blue light of a Moscow winter afternoon.
  //
  // Snow is the whole reason for this theme's numbers, and it is a harder lighting
  // problem than it sounds. A white ground is an enormous reflector, so hemiGround is the
  // second lightest in the app after the reef's carbonate sand -- without it St Basil's
  // undersides go black and the domes stop reading as domes. But snow under a low winter
  // sun is also BLUE, not white: the ground ramp is deliberately cold, and the sun is
  // weak and warm against it, which is the contrast that makes the cathedral's paint
  // work. Fog is close, because a winter afternoon there genuinely is hazy.
  // A Bug's Life: a summer lawn, seen from ant height.
  //
  // The ground ramp is SOIL, not grass, and that is the whole trick of the theme. Down
  // among the stems you are standing on bare earth and leaf litter; a green ground would
  // put the student on top of the lawn looking down at it, which is the one viewpoint this
  // world exists to avoid. All the green is up in the props, towering overhead.
  //
  // `flatRadius` is large and `amplitude` low because this is a CONSTRUCTION world before
  // it is anything else -- pieces have to sit flat next to each other over a wide area, the
  // same reason My World is nearly level.
  whimsy: {
    // A storybook afternoon. This is the only theme in the app where the environment is
    // allowed to be as loud as the objects in it -- everywhere else the sky is chosen to
    // lose to the exhibits, but here there are no exhibits, only a world that is supposed
    // to be delightful. So: a warm periwinkle sky and grass that is frankly too green.
    //
    // The one restraint is that the ground stays a SINGLE cheerful green rather than
    // rainbow. Every prop in this world is saturated and multicoloured, and a multicoloured
    // ground under them would leave nothing for the eye to rest on and no silhouette
    // anywhere -- the same reason the cell's cytosol is grey.
    sky: 0x9ec8f5,
    fogNear: 130,
    fogFar: 460,
    groundLow: 0x4f9c3f,
    groundHigh: 0x8fd45c,
    // Rolling, and quite a lot of it: the hills ARE the whimsy here, and a flat plane with
    // candy on it reads as a shop display rather than as a landscape.
    amplitude: 6.5,
    flatRadius: 46,
    blendRadius: 165,
    hemiSky: 0xe4f2ff,
    hemiGround: 0x6aa845,
    hemiIntensity: 1.9,
    sunColor: 0xfff6e0,
    sunIntensity: 2.5,
    sunPosition: [110, 150, 90],
    stars: false,
  },

  station: {
    // Low Mars orbit. Black sky, stars, and a sun with no atmosphere to soften it.
    //
    // TWO THINGS ARE DELIBERATE AND BOTH ARE ABOUT COLOUR, which this world is meant to be
    // led by. First, the hemisphere fill is warm ORANGE-BROWN rather than the usual sky
    // blue: the nearest large object is Mars, it fills a third of the view, and the light
    // bouncing off it is the planet's own colour. That single choice is what makes white
    // station hardware look like it is in orbit rather than on a stand in a hall.
    //
    // Second, hemiIntensity is LOW. In space there is no atmosphere to scatter light, so
    // shadows are nearly black and the contrast is brutal -- and that hard edge is most of
    // what makes hardware read as hardware. Lit like an overcast day it looks like plastic.
    sky: 0x05060a,
    // Fog effectively off. Vacuum does not fade anything, and a fogged starfield is the one
    // thing that instantly says "this is a room with a painted ceiling".
    fogNear: 900,
    fogFar: 2000,
    // THE GROUND IS THE VOID, not the floor. This is the one theme whose terrain is
    // painted out rather than painted: the floor a student stands on is the `station-deck`
    // prop, which is 230ft square and ENDS, and everything past its edge has to be space.
    // Left at deck grey the terrain ran on to the horizon and did the one thing this world
    // cannot afford -- it gave Mars a flat line to sit on, so a planet 700ft across read as
    // a hill behind a car park. Two shades a hair apart rather than one flat black, because
    // the ramp is what stops a large unlit plane banding.
    groundLow: 0x080a0e,
    groundHigh: 0x10131a,
    // Dead flat. The student is standing on a deck, not on ground.
    amplitude: 0,
    flatRadius: 190,
    blendRadius: 195,
    hemiSky: 0xffd9b0,
    hemiGround: 0x8a4a2a,
    // 0.75, not the 0.55 realism wants. Vacuum really does give near-black shadows, but at
    // 0.55 the deck a student is standing on was too dark to read the bay markings by --
    // and those markings are how this world tells them where each build goes.
    hemiIntensity: 1.0,
    sunColor: 0xfff4e8,
    sunIntensity: 3.2,
    // The sun is on the STUDENT'S side of the world, which is unusual here and is entirely
    // about Mars. A planet is lit by the same directional light as everything else, so a sun
    // behind it lights its far side and hands the arrival view a dark disc; only the
    // hemisphere fill was keeping it visible at all. Raked round to +Z and well to the right,
    // it lights the near face, leaves a terminator down the left limb, and picks out the
    // modules' near sides at the same time.
    sunPosition: [280, 140, 160],
    stars: true,
  },

  london: {
    // Westminster on an overcast afternoon. The Elizabeth Tower is honey-coloured Anston
    // limestone with a gilded spire, and both of those are WARM -- so the sky is a cool
    // flat grey-blue and the sun is weak and low. That is not just atmosphere: a bright
    // blue sky behind a pale gold tower flattens it, and the whole point of this world is
    // one building's silhouette and surface detail.
    sky: 0x93a3b4,
    fogNear: 150,
    fogFar: 520,
    // Wet paving and river mud rather than grass. The ground here is embankment, road and
    // bridge deck, so it is a made surface everywhere a student walks.
    groundDetail: 'ground-regolith.jpg',
    groundLow: 0x5c6068,
    groundHigh: 0x8d9199,
    // Effectively flat over the whole site. Every object in this world is a rigid building
    // or a bridge deck tens of feet long -- the museum/library/Mars rule.
    amplitude: 0.6,
    flatRadius: 120,
    blendRadius: 190,
    hemiSky: 0xc6d4e2,
    hemiGround: 0x6b6d72,
    hemiIntensity: 1.75,
    sunColor: 0xffeed6,
    sunIntensity: 1.7,
    // Low and from the south-west, which is what rakes across the tower's pilasters and
    // makes the stonework read as relief rather than as a flat panel.
    sunPosition: [-150, 110, 130],
    stars: false,
  },

  warren: {
    // A summer meadow, early evening. Rabbits are grey-brown and so is bare earth, which
    // is the whole colour problem of this world: the hero model and the ground it sits on
    // are the same colour family. So the grass is pushed green and bright and the soil in
    // the burrow cutaway is pushed dark, leaving the animal's own tones in the middle.
    groundDetail: 'ground-soil.jpg',
    sky: 0x9fc4e8,
    fogNear: 110,
    fogFar: 400,
    groundLow: 0x46672c,
    groundHigh: 0x87a844,
    // Gently rolling, and flat where the warren is cut open. A downland bank is what a
    // real warren is dug into.
    amplitude: 4.5,
    flatRadius: 52,
    blendRadius: 150,
    hemiSky: 0xd8ecff,
    hemiGround: 0x5e7434,
    hemiIntensity: 1.7,
    sunColor: 0xffe6b8,
    sunIntensity: 2.6,
    // Low warm evening sun -- when rabbits are actually out, and it rakes across fur.
    sunPosition: [-160, 90, 120],
    stars: false,
  },

  cologne: {
    // The Domplatte on a bright cold day.
    //
    // Cologne Cathedral is famously BLACK -- its sandstone weathers almost to soot -- and
    // a black building needs a bright background or it is a silhouette with no detail,
    // which is exactly the Mars-props failure at cathedral scale. So this is the lightest
    // sky in the app, with a strong sun and a very high hemisphere fill: the fill is what
    // gets into the openwork of the spires and stops them reading as solid.
    sky: 0xb9cfe4,
    fogNear: 170,
    fogFar: 620,
    groundDetail: 'ground-regolith.jpg',
    groundLow: 0x9a958c,
    groundHigh: 0xc6c0b4,
    // The Domplatte is a paved plaza. Flat, over a wide radius, for the same reason.
    amplitude: 0.5,
    flatRadius: 135,
    blendRadius: 195,
    hemiSky: 0xdfeeff,
    hemiGround: 0xa39c90,
    hemiIntensity: 2.1,
    sunColor: 0xfff4e2,
    sunIntensity: 2.4,
    sunPosition: [120, 150, 110],
    stars: false,
  },

  cell: {
    // Inside an animal cell. The student is suspended in cytosol, so like `voyage` this
    // is a VOLUME rather than a landscape -- close fog is most of what sells that, and
    // 45/210 is the second-closest in the app after Under the Sea.
    //
    // The palette is picked AGAINST the organelles, which is the rule this project has
    // now paid for three times (the Mars props that came out as black silhouettes, the
    // warm "inside the body" sky that turned every organ into one red mush). Every
    // organelle here is warm and saturated on purpose -- a violet nucleus, red-orange
    // mitochondria, a teal Golgi, blue ribosomes -- because that is how they are drawn in
    // every textbook a student will ever meet, and a diagram's colours are the thing they
    // are actually being asked to remember. So the cytosol is a desaturated blue-grey:
    // it is the only surface here NOT trying to be identified, and it has to lose.
    //
    // No `groundDetail` photo. The cytosol floor is not a material anybody has photographed
    // and the ground maps that ship with this project are regolith, soil, marble and
    // wood -- every one of them reads as "outdoors on a planet", which is the one thing
    // this floor must not.
    // Lighter than the first pass by a long way. At sky 0x2b3f57 over a 0x37485c floor the
    // whole world came out as one navy murk with the organelles barely separable from it --
    // the cytosol is meant to lose to the organelles, but losing is not the same as taking
    // the exhibits down with it. Everything here is a TRANSLUCENT shell, and a translucent
    // shell has almost no colour of its own: what you actually see is the background
    // through it, so the background has to be bright enough to carry them.
    sky: 0x4a6a8c,
    fogNear: 55,
    fogFar: 250,
    groundLow: 0x53687e,
    groundHigh: 0x8fa3b8,
    // Almost flat over a wide radius. Every organelle in here is a rigid closed shell
    // several tens of feet across, and rolling ground buries one side of each of them --
    // the same reason the museum, the library and Mars all flatten their floors.
    amplitude: 1.8,
    flatRadius: 92,
    blendRadius: 160,
    // A high hemisphere fill and a modest sun, because there is no sun inside a cell and
    // nothing here should read as lit from one direction. The organelles are translucent
    // shells and it is the fill that gets inside them.
    hemiSky: 0xd8ecfa,
    hemiGround: 0x76889c,
    hemiIntensity: 2.3,
    sunColor: 0xf2f8ff,
    sunIntensity: 1.9,
    sunPosition: [70, 130, 60],
    stars: false,
  },

  twister: {
    // A supercell over open prairie, maybe a mile out.
    //
    // This theme has ONE job the others do not: the tornado has to be the darkest thing
    // in the world, and it is a 90ft column of grey. Against a normal blue sky a grey
    // funnel reads as a smudge, so the sky is the storm -- a heavy blue-grey that the
    // funnel is darker still than.
    //
    // The ground goes the other way, and that is the whole trick of this world: under a
    // supercell the sun comes in UNDER the cloud base from the clear west edge, and the
    // wheat lights up bright gold against a near-black sky. That contrast is what every
    // photograph of a tornado on the plains is actually of, and it is why the sun here is
    // strong, warm and LOW (a 34deg elevation) while the sky above it is nearly slate.
    groundDetail: 'ground-soil.jpg',
    sky: 0x6b7484,
    // Wide open country, and the fog is doing perspective rather than mood: far enough
    // out that the storm is a real distance away, close enough that the horizon is not a
    // hard line where the ground plane stops.
    fogNear: 120,
    fogFar: 430,
    groundLow: 0x7d7038,
    groundHigh: 0xc9ab52,
    // Prairie, so it rolls -- but gently, and flat where the farmstead and the boards are.
    amplitude: 3.4,
    flatRadius: 60,
    blendRadius: 175,
    // The sky fill is grey rather than blue: under a storm base the light bouncing down
    // is the cloud's own colour, and a blue hemisphere here made everything look like a
    // sunny day with a dark object in it.
    hemiSky: 0x93a0b0,
    hemiGround: 0x7a6a3e,
    hemiIntensity: 1.5,
    sunColor: 0xffd9a0,
    sunIntensity: 2.8,
    // LOW and to one side -- 34deg up. This is the shaft of light under the storm base,
    // and it is what makes the wheat glow and the funnel stand black against it.
    sunPosition: [-190, 130, 95],
    stars: false,
  },

  bugs: {
    groundDetail: 'ground-soil.jpg',
    sky: 0x8ec8ea,
    fogNear: 95,
    fogFar: 380,
    groundLow: 0x4a3a26,
    groundHigh: 0x8a7048,
    amplitude: 1.0,
    flatRadius: 78,
    blendRadius: 165,
    hemiSky: 0xcfe6ff,
    hemiGround: 0x6a5a3c,
    hemiIntensity: 1.7,
    sunColor: 0xfff6dd,
    sunIntensity: 2.5,
    sunPosition: [110, 140, 80],
    stars: false,
  },

  redsquare: {
    groundDetail: 'ground-regolith.jpg',
    sky: 0x9db6cc,
    fogNear: 90,
    fogFar: 360,
    groundLow: 0xa8b6c4,
    groundHigh: 0xe4ecf4,
    groundRoughness: 0.95,
    amplitude: 0.5,
    flatRadius: 100,
    blendRadius: 190,
    hemiSky: 0xcfdcec,
    hemiGround: 0xb4c2ce,
    hemiIntensity: 1.9,
    sunColor: 0xffe6c2,
    sunIntensity: 1.9,
    sunPosition: [70, 58, 150],
    stars: false,
  },

  constellations: {
    // A dark observing field under a full sky of stars, and it is the FIRST theme in this app
    // where the world is genuinely night. Three things follow from that, and none of them is
    // just "turn the numbers down".
    //
    // 1. THE DIRECTIONAL LIGHT IS THE MOON, not the sun. So it is cool rather than warm
    //    (moonlight is reflected sunlight and physically almost the same colour, but the eye
    //    reads dim light as blue, and every photograph of a moonlit landscape comes out
    //    blue), it is weak, and it comes in from one side low enough to model the ground.
    //    At full sun intensity the field looks like a golf course at noon with a black sky
    //    over it, which is the one thing this world cannot be.
    // 2. IT IS NOT AS DARK AS IT SHOULD BE, deliberately. Real moonlight is about 1/400,000
    //    of daylight; a physically honest night is a black screen. What this is tuned to is
    //    what a dark-adapted eye REPORTS -- you can see the ground, you can read a sign held
    //    close, and colour is nearly gone. Hence a hemisphere fill that is a fifth of a
    //    daylight world's and a ground ramp that is dark but not black.
    // 3. EVERY SIGN IN THE WORLD IS EMISSIVE, in the props rather than here. A theme cannot
    //    fix an unlit panel at night, and the boards in this world are the whole lesson.
    //
    // No `groundDetail` photo. Every ground map that ships with this project was shot in
    // daylight, and neutralized down to this brightness it contributes nothing but noise --
    // while a mown observing field is meant to read as an absence of features anyway, so
    // that the sky is the only thing with detail in it.
    sky: 0x060a16,
    // Fog well back. It is doing two jobs at once: softening the far edge of the ground plane
    // (a hard line where the terrain stops is far more obvious at night, since there is no
    // haze to hide it) while leaving the constellations untouched -- every star, label and
    // glow in SkyProps.js sets `fog: false` precisely so the sky is never fogged.
    fogNear: 110,
    fogFar: 420,
    // Dark, but NOT black, and the difference is the whole tuning of this theme. At the first
    // pass's 0x16200f over a 0.55 hemisphere the field read as a void with signs floating in
    // it -- a student could not see the ground they were walking on, which is a different
    // thing from a world being night-time. This is roughly what a dark-adapted eye reports
    // from a mown field under a half moon: you can see where your feet are and almost no
    // colour at all.
    groundLow: 0x1c2814,
    groundHigh: 0x3a4a26,
    groundRoughness: 1,
    // Broad and level where the exhibits are, rising gently beyond. An observing site is
    // chosen for a flat horizon, and every board here is a rigid panel on two posts.
    amplitude: 3.0,
    flatRadius: 78,
    blendRadius: 168,
    // A cold blue fill at a fifth of daylight strength. The ground colour comes almost
    // entirely from this rather than from the moon, which is what makes the field read as
    // being under an open sky rather than under a single lamp.
    hemiSky: 0x2b3f66,
    hemiGround: 0x1a2216,
    hemiIntensity: 0.92,
    sunColor: 0xc6d8ff,
    // 0.95, and the number was worked down from 2.2. Anything above about 1.3 and the field
    // has daylight shadows on it; below about 0.7 and the armillary sphere's rings stop
    // catching any light at all and the hero of the world disappears.
    sunIntensity: 0.95,
    // Low and to the north-west, and it MATCHES where the layout hangs the Moon -- the light
    // in this world has a visible source in the sky, which no other world here can say.
    sunPosition: [-150, 95, 120],
    stars: true,
  },

  observatory: {
    // The blue hour on a dry hilltop: the sun is just down, the sky is deep enough for the
    // first stars, and the dome is still catching the last light off the horizon.
    //
    // THIS IS A COMPROMISE AND IT IS THE RIGHT ONE. Full night would be the honest setting
    // for an observatory and it would also hide the building, which is the thing this world
    // is FOR -- a black corrugated wall against a black sky is the Mars-props failure at
    // building scale. Full day would show the building and throw away the point of it. Dusk
    // is the only setting where a silver dome reads against the sky AND the shutter's open
    // slit reads as dark, which is what makes it obvious the dome is open.
    groundDetail: 'ground-soil.jpg',
    sky: 0x1b2b4a,
    // Wide, because a hilltop site is chosen for its distance from everything, and the
    // outbuildings need air between them.
    fogNear: 140,
    fogFar: 520,
    // Dry grass and caliche, read at dusk: brown-gold, well down in value.
    // Lighter than a literal dusk. At the first pass's 0x33301f the foreground read as tarmac
    // and a student could not see the path they were standing on -- the same correction the
    // constellations theme needed, for the same reason: what matters is what a dark-adapted eye
    // reports, not what a light meter would.
    groundLow: 0x413c26,
    groundHigh: 0x6e6342,
    groundRoughness: 1,
    // Effectively flat over the whole site. Every building here is a rigid drum or a long
    // shed, and the dome is a 27ft cylinder that cannot straddle a slope -- the museum,
    // library, Mars and New York rule.
    amplitude: 1.0,
    flatRadius: 110,
    blendRadius: 190,
    // A fairly strong blue fill, and it is doing most of the work. At dusk the whole sky is
    // the light source, which is why nothing on the site has a hard shadow -- and it is also
    // what gets INSIDE the dome, where the sun cannot reach through a 30-degree slit.
    hemiSky: 0x4a679a,
    hemiGround: 0x463f2a,
    hemiIntensity: 1.5,
    // The last of the sunset: warm, weak and very low, so it rakes across the corrugated
    // walls and the dome's ribs. That raking is what makes sheet metal read as sheet metal,
    // and it is the same trick the Elizabeth Tower's pilasters need.
    // Warm, but not as orange as a real last-light. At 0xffb877 the galvanised dome came out
    // bronze, and a silver dome is half of what this building is.
    sunColor: 0xffc793,
    sunIntensity: 1.5,
    sunPosition: [-190, 52, 60],
    stars: true,
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
// This project's own site: a useful landing page for a student who has just placed a
// panel, and it sends no X-Frame-Options or CSP frame-ancestors, so it allows being
// framed. Most large sites block embedding outright and there is no client-side
// workaround -- see the web browser panel notes in CLAUDE.md. Every preset world seeds
// its spawn-point panel from this same constant.
//
// This USED to come up blank in production and no longer does, which is worth recording
// because the reason had nothing to do with this file. edusim3dweb.com has no HTTPS (port
// 443 is not open), and the app was served from Railway over HTTPS -- and a browser
// refuses to load an http: iframe inside an https: page ("Mixed Content ... blocked").
// Now that the app is served from /app/ on this same http host, both ends are http, the
// iframe is same-origin, and the panel simply works. It always did on the local Apache
// mirror, which is why this looked like a deployment quirk rather than a wall.
//
// The direction of the constraint is the thing to remember: enabling SSL at pair Networks
// is still worth doing -- it is what brings immersive VR back (navigator.xr is
// secure-context-only) -- but this line has to become https: in the same change, or the
// panel goes blank again for exactly the old reason with the roles reversed.
export const WEB_BROWSER_DEFAULT_URL = 'http://edusim3dweb.com';

// --- Opening a shared world from a link ------------------------------------

// `?world=24` on the app's own address opens world 24 out of the gallery directly, with no
// download and no file picker. See WorldLink.js for why the parameter carries an ID rather
// than a url, and why this base has to be root-relative.
export const WORLD_LINK_PARAM = 'world';
export const WORLD_LINK_BASE = '/worlds/download.php?id=';

// The shared world gallery, opened in a new tab by Menu > Load World > Get More Worlds.
//
// The mixed-content rule described above does NOT apply here, and the difference is worth
// stating because the two look alike: that one is an http: IFRAME inside an https: page,
// which browsers block. This is a top-level navigation into a new tab, which they do not
// -- so this link kept working through the whole period the browser panel was blank, and
// would keep working if the app were ever served over https again.
export const WORLD_GALLERY_URL = 'http://edusim3dweb.com/worlds/';
export const EDIT_ICON_SIZE = 0.7; // feet, billboard sprite size
export const EDIT_ICON_MARGIN = 0.6; // feet above the panel's bounding-box top

// --- Create Model: build-your-own from primitives ---
export const PRIMITIVE_SIZE = 2; // feet -- every primitive is authored to this size before stretching
// The palette has no true yellow (#f2a541 is amber), and the brief asks for yellow
// specifically, so this is its own constant rather than a bent palette entry. The
// Apply Texture swatch row still offers PALETTE_SWATCHES alongside it.
export const PRIMITIVE_DEFAULT_COLOR = '#f2c94c';
// Construction pieces land much closer than an import ("a few feet in front of you"),
// and their spiral is counted over the LIVE PRIMITIVES only -- not registry.count, which
// in a preset world is already in the hundreds and would fling the first piece off the
// spiral's far edge. Keep SPACING*sqrt(pieces) under DISTANCE for a realistic build.
//
// 10ft, not the 8 this started at, and the reason is framing rather than reach. Eyes are
// at 5ft and a fresh piece is 2ft tall, so its base sits 5ft below the sightline: at 8ft
// away that is 32 degrees down, and the camera's 70 degree fov is VERTICAL, giving only
// 35 either side -- the piece a student just asked for arrived half off the bottom of
// the screen. At 10ft the whole shape and its hammer sit comfortably inside the frame.
export const PRIMITIVE_SPAWN_DISTANCE = 10; // feet in front of the camera
export const PRIMITIVE_SPAWN_SPACING = 2.5; // feet, golden-angle spiral between pieces
export const HAMMER_ICON_SIZE = 0.7; // feet, billboard sprite size
export const HAMMER_ICON_MARGIN = 0.6; // feet above the piece's bounding-box top
export const CONNECT_TOUCH_EPSILON = 0.05; // feet of slack when testing "are these touching?"
export const STRETCH_HANDLE_RADIUS = 0.13; // feet, corner grab spheres
export const STRETCH_MIN_SIZE = 0.2; // feet, per-axis floor so a piece can't be squashed to nothing
export const STRETCH_LIFT_GAP = 0.75; // feet the lift handle floats above the box's top face

// Rotate/Move Shape. The snap is what makes turning a piece useful for building rather
// than merely possible: square corners and 45° braces are most of what a model needs,
// and hitting either by eye is hopeless on a trackpad. 15° still leaves 24 positions.
export const ROTATE_SNAP_DEGREES = 15;
export const ROTATE_RING_GAP = 0.6; // feet the rings clear the piece's furthest corner by
export const ROTATE_RING_TUBE = 0.11; // feet, ring thickness -- also its grab target

// Deliberately still the old project name, and it has to stay that way. This is the
// IndexedDB database every student's saved world lives in -- renaming it does not migrate
// anything, it silently opens a NEW empty database and every world anyone has ever built
// disappears. The app is called Edusim everywhere a person can see; this string is not
// one of those places.
export const DB_NAME = '3dcoder-world';
export const DB_VERSION = 1;
export const STORE_NAME = 'placedObjects';
