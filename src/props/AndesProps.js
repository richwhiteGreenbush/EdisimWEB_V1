// Machu Picchu: the citadel on the ridge, at 7,970ft, with the cloud still in the valley.
//
// Unlike Rome and Egypt this world is mostly at TRUE SIZE. An Inca house is a house, a
// terrace wall is eight feet of stone, and the plaza is a plaza -- all of it fits. The one
// thing that cannot is Huayna Picchu, the sugarloaf behind the site, which stands 1,180ft
// above the ruins; it is built as a scaled peak at the edge of the world, the same
// compromise MarsProps.distantMountain() makes.
//
// The masonry is the lesson here, and it is worth stating what makes it different: the
// blocks are cut to fit each other rather than to a module, laid with NO mortar at all,
// and the walls lean inward. Every opening is a trapezoid, wider at the bottom. All three
// are earthquake engineering -- the region is seismically violent, and buildings the
// Spanish put up alongside these have fallen down twice since.
//
// THIS FILE IS A BARREL. The rebuild took the world from ~183k triangles to a great deal
// more, and the four families below are 500-1,100 lines each; merged into one file they
// would be 3,500 lines with four sets of private helpers competing for names in one scope.
// They are split by what a student is actually looking at, which is also how the fidelity
// budget is argued: `peaks` is read at 200-300ft and spends everything on silhouette,
// `masonry` is read at arm's length and spends it on the face of the stone.
//
// props/index.js imports this module as a namespace, so every key in PROP_BUILDERS is
// unchanged and no saved world can tell the difference.
//
// House rules, which every one of these files follows: feet at scale 1, origin at base
// centre, fresh materials per call, seededRandom never Math.random. See PropKit.js.

export { andeanPeak, cloudBank } from './andes/peaks.js';
export { ashlarPanel, incaWall, incaTerraces, incaStairs } from './andes/masonry.js';
export { incaHouse, templeOfTheSun, intihuatana, incaFountain } from './andes/buildings.js';
export {
  graniteOutcrop, ichuGrass, polylepisTree, andeanFlowers, terraceCrop,
} from './andes/ground.js';

// Retired from the layout, kept because its prop key is persisted. See the file.
export { llama } from './andes/llama-retired.js';
