// Every model the book builds, as the parts a reader actually makes.
//
// Units are feet, like the app. A part is one of Edusim's four shapes as it arrives from
// Create Model (a 2 ft cube, a sphere 2 ft across, a cylinder 2 ft across and 2 ft tall
// standing upright, a tetrahedron), then:
//   scale  -- how far Stretch to Shape pulled it along each of its OWN axes (1 = untouched)
//   rot    -- degrees turned with Rotate/Move Shape; always a multiple of 15, because the
//             rings snap every 15 degrees and the book must never ask for an angle a
//             reader cannot hit
//   pos    -- where its centre ends up, relative to the model's base centre on the ground
//   color  -- a swatch from Apply Texture, or a hex picked with "Any colour"
//
// Every model faces +Z, which is TOWARD the reader standing at the spawn point. That is
// measured, not assumed (tools/probe.mjs): a rendered model's `move forward` goes +Z, so a
// train built nose-toward-you is a train that drives the way its nose points.

export const SWATCH = {
  yellow: '#f2c94c', red: '#e0455f', orange: '#f2a541', green: '#3fb37f',
  blue: '#3d8bf2', purple: '#8a5cf5', white: '#f5f5f5',
};
// "Any colour" picks, named the way the book names them.
export const ANY = { black: '#2b2f36', grey: '#9aa3ad', brown: '#7a4a2a', darkGreen: '#2f7d55' };

const p = (name, shape, color, pos, scale = [1, 1, 1], rot = [0, 0, 0]) => ({ name, shape, color, pos, scale, rot });

export const MODELS = {
  // Chapter 8 warm-up: four pieces, no stretching beyond resizing.
  snowman: [
    p('bottom ball', 'sphere', SWATCH.white, [0, 1.2, 0], [1.2, 1.2, 1.2]),
    p('middle ball', 'sphere', SWATCH.white, [0, 3.1, 0], [0.9, 0.9, 0.9]),
    p('head', 'sphere', SWATCH.white, [0, 4.45, 0], [0.6, 0.6, 0.6]),
    p('nose', 'tetrahedron', SWATCH.orange, [0, 4.5, 0.62], [0.16, 0.16, 0.32]),
  ],

  // Chapter 9: a steam locomotive, 12 pieces, nose toward +Z.
  locomotive: [
    p('boiler', 'cylinder', SWATCH.green, [0, 2.35, 1.9], [1.05, 1.6, 1.05], [90, 0, 0]),
    p('cab', 'cube', SWATCH.red, [0, 2.7, -0.85], [1.25, 1.4, 1.15]),
    p('cab roof', 'cube', ANY.black, [0, 4.2, -0.85], [1.45, 0.12, 1.35]),
    p('chimney', 'cylinder', ANY.black, [0, 3.75, 3.0], [0.35, 0.6, 0.35]),
    p('dome', 'sphere', SWATCH.orange, [0, 3.4, 1.55], [0.5, 0.45, 0.5]),
    p('cowcatcher', 'tetrahedron', SWATCH.red, [0, 0.85, 3.9], [0.9, 0.7, 0.6], [0, 45, 0]),
    p('wheel 1', 'cylinder', SWATCH.yellow, [-1.15, 0.7, 2.6], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 2', 'cylinder', SWATCH.yellow, [1.15, 0.7, 2.6], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 3', 'cylinder', SWATCH.yellow, [-1.15, 0.7, 0.9], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 4', 'cylinder', SWATCH.yellow, [1.15, 0.7, 0.9], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 5', 'cylinder', SWATCH.yellow, [-1.15, 0.7, -1.0], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 6', 'cylinder', SWATCH.yellow, [1.15, 0.7, -1.0], [0.7, 0.175, 0.7], [0, 0, 90]),
  ],

  // Chapter 9: the carriage, 6 pieces, built to match the locomotive.
  carriage: [
    p('body', 'cube', SWATCH.blue, [0, 2.4, 0], [1.2, 1.1, 2.0]),
    p('roof', 'cylinder', SWATCH.white, [0, 3.45, 0], [1.25, 2.1, 0.45], [90, 0, 0]),
    p('wheel 1', 'cylinder', SWATCH.yellow, [-1.15, 0.7, 1.3], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 2', 'cylinder', SWATCH.yellow, [1.15, 0.7, 1.3], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 3', 'cylinder', SWATCH.yellow, [-1.15, 0.7, -1.3], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 4', 'cylinder', SWATCH.yellow, [1.15, 0.7, -1.3], [0.7, 0.175, 0.7], [0, 0, 90]),
  ],

  // Chapter 9, your turn: a coal tender to run between the engine and the carriage.
  tender: [
    p('body', 'cube', SWATCH.green, [0, 1.9, 0], [1.15, 0.6, 1.3]),
    p('coal', 'sphere', ANY.black, [0, 2.55, 0], [1.0, 0.35, 1.15]),
    p('wheel 1', 'cylinder', SWATCH.yellow, [-1.15, 0.7, 0.8], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 2', 'cylinder', SWATCH.yellow, [1.15, 0.7, 0.8], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 3', 'cylinder', SWATCH.yellow, [-1.15, 0.7, -0.8], [0.7, 0.175, 0.7], [0, 0, 90]),
    p('wheel 4', 'cylinder', SWATCH.yellow, [1.15, 0.7, -0.8], [0.7, 0.175, 0.7], [0, 0, 90]),
  ],

  // Chapter 10: the turtle, 9 pieces. The head, legs and tail keep the yellow every shape
  // arrives in, so only the shell and the eyes need painting.
  turtle: [
    p('shell', 'sphere', SWATCH.green, [0, 1.2, 0], [1.6, 0.8, 1.9]),
    p('head', 'sphere', SWATCH.yellow, [0, 1.0, 2.1], [0.55, 0.5, 0.6]),
    p('leg 1', 'cylinder', SWATCH.yellow, [-1.15, 0.6, 1.1], [0.35, 0.6, 0.35]),
    p('leg 2', 'cylinder', SWATCH.yellow, [1.15, 0.6, 1.1], [0.35, 0.6, 0.35]),
    p('leg 3', 'cylinder', SWATCH.yellow, [-1.15, 0.6, -1.1], [0.35, 0.6, 0.35]),
    p('leg 4', 'cylinder', SWATCH.yellow, [1.15, 0.6, -1.1], [0.35, 0.6, 0.35]),
    p('tail', 'tetrahedron', SWATCH.yellow, [0, 0.9, -1.95], [0.25, 0.25, 0.35]),
    p('eye 1', 'sphere', ANY.black, [-0.25, 1.2, 2.55], [0.1, 0.1, 0.1]),
    p('eye 2', 'sphere', ANY.black, [0.25, 1.2, 2.55], [0.1, 0.1, 0.1]),
  ],

  // Chapter 10, your turn: a giraffe, 10 pieces.
  giraffe: [
    p('body', 'cube', SWATCH.orange, [0, 3.6, 0], [0.8, 0.7, 1.4]),
    p('leg 1', 'cylinder', SWATCH.yellow, [-0.55, 1.5, 1.0], [0.18, 1.5, 0.18]),
    p('leg 2', 'cylinder', SWATCH.yellow, [0.55, 1.5, 1.0], [0.18, 1.5, 0.18]),
    p('leg 3', 'cylinder', SWATCH.yellow, [-0.55, 1.5, -1.0], [0.18, 1.5, 0.18]),
    p('leg 4', 'cylinder', SWATCH.yellow, [0.55, 1.5, -1.0], [0.18, 1.5, 0.18]),
    p('neck', 'cylinder', SWATCH.orange, [0, 5.25, 1.55], [0.25, 1.4, 0.25], [30, 0, 0]),
    p('head', 'sphere', SWATCH.orange, [0, 6.55, 2.35], [0.35, 0.35, 0.55]),
    p('horn 1', 'cylinder', ANY.brown, [-0.15, 7.0, 2.2], [0.06, 0.25, 0.06]),
    p('horn 2', 'cylinder', ANY.brown, [0.15, 7.0, 2.2], [0.06, 0.25, 0.06]),
    p('tail', 'cylinder', ANY.brown, [0, 3.2, -1.55], [0.05, 0.5, 0.05], [-30, 0, 0]),
  ],

  // Chapter 11: the train station, 7 pieces. The sign is a picture (Upload an Image).
  station: [
    p('platform', 'cube', ANY.grey, [0, 0.4, 0], [5, 0.4, 2]),
    p('column 1', 'cylinder', SWATCH.white, [-4, 2.6, -1.2], [0.2, 1.8, 0.2]),
    p('column 2', 'cylinder', SWATCH.white, [4, 2.6, -1.2], [0.2, 1.8, 0.2]),
    p('column 3', 'cylinder', SWATCH.white, [-4, 2.6, 1.2], [0.2, 1.8, 0.2]),
    p('column 4', 'cylinder', SWATCH.white, [4, 2.6, 1.2], [0.2, 1.8, 0.2]),
    p('roof', 'cube', SWATCH.red, [0, 4.55, 0], [5.4, 0.15, 2.4]),
    p('sign', 'cube', SWATCH.white, [0, 5.3, 0], [1.9, 0.45, 0.06], [0, 0, 0], 'sign'),
  ],

  // Chapter 11, your turn: a house, 8 pieces. The roof is a long cube turned 45 degrees
  // on the front-to-back ring and sunk halfway into the walls: what shows is a gable.
  house: [
    p('walls', 'cube', SWATCH.yellow, [0, 2.2, 0], [3, 2.2, 2.5]),
    p('roof', 'cube', SWATCH.red, [0, 4.4, 0], [3.3, 1.98, 1.98], [45, 0, 0]),
    p('door', 'cube', ANY.brown, [0, 0.9, 2.52], [0.5, 0.9, 0.05]),
    p('window 1', 'cube', SWATCH.blue, [-1.8, 2.6, 2.52], [0.45, 0.45, 0.05]),
    p('window 2', 'cube', SWATCH.blue, [1.8, 2.6, 2.52], [0.45, 0.45, 0.05]),
    p('window 3', 'cube', SWATCH.blue, [-3.02, 2.6, 0], [0.05, 0.45, 0.45]),
    p('window 4', 'cube', SWATCH.blue, [3.02, 2.6, 0], [0.05, 0.45, 0.45]),
    p('chimney', 'cube', SWATCH.white, [1.7, 5.6, -0.8], [0.3, 0.8, 0.3]),
  ],
};

// The sign is the one piece wearing a picture; p() above ignores the 7th argument, so it
// is attached here by name.
MODELS.station.find((part) => part.name === 'sign').image = 'sign';
