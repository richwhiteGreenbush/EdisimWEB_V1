// The Build a City kit's shared numbers. It imports nothing and builds nothing, so every builder in
// builders/City*.js reads the same street, and two pieces made by two different files still meet.
//
// THE KIT'S MATH IS A 10-FOOT GRID, the village's rule. Everything is real life size, in feet, with
// its origin at the base centre and its front toward +Z.
//
//   A ROAD is 40ft across: two 12ft lanes (z = -12..12) and an 8ft sidewalk each side (|z| = 12..20).
//   road-straight is 20ft long along X, so `duplicate 20` lays a straight street.
//   road-intersection is 40 x 40 and its four edges carry exactly that same cross section, so a
//   straight section butts onto any side of it with no step and no gap.
//   A BUILDING's footprint is a whole number of 10ft cells, and its front wall stands on the front
//   edge of that footprint, so a building placed with its front against the back of a sidewalk
//   reads as being on the street.
//   A VEHICLE faces +Z with its tyres touching y = 0 and fits inside one 12ft lane.

export const GRID = 10;

export const ROAD = {
  length: 20, // one road-straight, along X
  width: 40, // kerb line to kerb line is LANE * 2; plus a sidewalk each side
  lane: 12,
  kerb: 12, // |z| of the kerb face
  sidewalk: 8,
  asphaltTop: 0.05, // the road surface
  sidewalkTop: 0.5, // a 6-inch kerb
  base: -0.4, // every slab runs down to here, so uneven ground never shows under it
};

// sRGB hex. A builder may vary these, but a city whose every piece picks its own grey reads as a
// pile of unrelated toys, so the street surfaces and the kerb are shared exactly.
export const PALETTE = {
  asphalt: 0x54565b, // 0x3a3b3f rendered nearly black under the sun, map and all
  asphaltWorn: 0x626266,
  concrete: 0xb9b4aa,
  kerb: 0xa7a298,
  laneYellow: 0xe2b23a,
  laneWhite: 0xeeeeea,
  glass: 0x26394a, // opaque dark glass; nothing in the kit is see-through but the bus shelter
  glassLit: 0xffe3a6,
  brickRed: 0x9c4a36,
  brickBrown: 0x7b4f3a,
  limestone: 0xd8cdb4,
  trim: 0xece7dc,
  roofTar: 0x4b4b4e,
  steel: 0x8d9298,
  tyre: 0x1d1e20,
  hubSilver: 0xb8bcc0,
  schoolBusYellow: 0xf2b21b,
  fireRed: 0xb51f1f,
  taxiYellow: 0xf3c318,
  grass: 0x5d9440,
  leaf: 0x4f8a36,
  bark: 0x5e4630,
};

// Tyre sizes, so the two vehicle files put the same wheel under the same class of vehicle.
// Radius and width in feet.
export const TYRE = {
  car: { r: 1.15, w: 0.75 },
  van: { r: 1.35, w: 0.8 },
  heavy: { r: 1.75, w: 0.95 },
};

// Build a Future City's colours: bright and optimistic, but each one a mid-range albedo, since a
// near-white clips under the sun and a near-black reads as a hole. Glow colours are for emissive parts.
export const FUTURE = {
  white: 0xe8edf2,
  pearl: 0xd7dde6,
  teal: 0x22b5a8,
  aqua: 0x45c8e8,
  sky: 0x4d8ff0,
  violet: 0x8a5cf0,
  magenta: 0xe04fb4,
  coral: 0xff7a59,
  sun: 0xffc23d,
  lime: 0x8bd448,
  leaf: 0x3fa34d,
  glass: 0x2b5876, // opaque tinted glass
  glowCyan: 0x5cf2ff,
  glowPink: 0xff5ccf,
  glowLime: 0xb6ff5c,
  glowGold: 0xffd166,
};
