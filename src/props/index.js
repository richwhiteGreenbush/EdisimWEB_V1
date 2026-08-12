import * as Common from './CommonProps.js';
import * as Museum from './MuseumProps.js';
import * as Library from './LibraryProps.js';
import * as Moon from './MoonProps.js';
import * as Mars from './MarsProps.js';
import * as Dino from './DinoProps.js';
import * as Park from './ParkProps.js';

// The name -> builder table that a `preset-prop` record is rehydrated through.
//
// These keys are PERSISTED: a record saved to IndexedDB (or exported to a .json world
// file) stores only its prop name, its options and its transform, and rebuilds the
// geometry from scratch on every load -- the same philosophy as light orbs and
// balloons. So renaming a key here silently breaks every already-saved world that
// uses it; add a new key instead.
export const PROP_BUILDERS = {
  // Shared
  'info-placard': Common.infoPlacard,
  'wall-placard': Common.wallPlacard,
  'standing-sign': Common.standingSign,
  bench: Common.bench,
  'lamp-post': Common.lampPost,
  planter: Common.planter,
  'shade-tree': Common.shadeTree,

  // Museum
  'museum-hall': Museum.museumHall,
  'museum-pedestal': Museum.museumPedestal,
  'sculpture-knot': Museum.sculptureKnot,
  'sculpture-figure': Museum.sculptureFigure,
  'sculpture-bust': Museum.sculptureBust,
  'sculpture-crystals': Museum.sculptureCrystals,
  'sculpture-mobile': Museum.sculptureMobile,
  'sculpture-rings': Museum.sculptureRings,
  'framed-painting': Museum.framedPainting,
  'velvet-rope': Museum.velvetRope,

  // Library
  'library-hall': Library.libraryHall,
  bookshelf: Library.bookshelf,
  'reading-table': Library.readingTable,
  'circulation-desk': Library.circulationDesk,
  'card-catalog': Library.cardCatalog,
  'dewey-sign': Library.deweySign,
  'library-globe': Library.libraryGlobe,
  'book-cart': Library.bookCart,
  'book-drop': Library.bookDrop,
  'story-rug': Library.storyRug,

  // Moon
  'lunar-rover': Moon.lunarRover,
  'lunar-module': Moon.lunarModule,
  'lunar-flag': Moon.lunarFlag,
  'alsep-station': Moon.alsepStation,
  'moon-crater': Moon.moonCrater,
  'moon-rocks': Moon.moonRocks,
  'bootprint-trail': Moon.bootprintTrail,
  'earth-in-sky': Moon.earthInSky,
  'moon-habitat': Moon.moonHabitat,
  'solar-array': Moon.solarArray,
  'lunar-plaque': Moon.lunarPlaque,

  // Mars
  'habitation-dome': Mars.habitationDome,
  'hydroponic-rack': Mars.hydroponicRack,
  'bunk-pod': Mars.bunkPod,
  'life-support-rack': Mars.lifeSupportRack,
  'command-console': Mars.commandConsole,
  'greenhouse-tunnel': Mars.greenhouseTunnel,
  'ice-drill-rig': Mars.iceDrillRig,
  'comms-relay': Mars.commsRelay,
  'mars-lander': Mars.marsLander,
  'weather-mast': Mars.weatherMast,
  'mars-rover': Mars.marsRover,
  'mars-helicopter': Mars.marsHelicopter,
  'rover-tracks': Mars.roverTracks,
  'dust-devil': Mars.dustDevil,
  'phobos-in-sky': Mars.phobosInSky,
  'distant-mountain': Mars.distantMountain,
  'mars-crater': Mars.marsCrater,
  'mars-rocks': Mars.marsRocks,

  // Dinosaur Island
  tyrannosaurus: Dino.tyrannosaurus,
  triceratops: Dino.triceratops,
  ankylosaurus: Dino.ankylosaurus,
  edmontosaurus: Dino.edmontosaurus,
  pachycephalosaurus: Dino.pachycephalosaurus,
  quetzalcoatlus: Dino.quetzalcoatlus,
  'dino-nest': Dino.dinoNest,
  'tree-fern': Dino.treeFern,
  cycad: Dino.cycad,
  'ginkgo-tree': Dino.ginkgoTree,
  'araucaria-tree': Dino.araucariaTree,
  'horsetail-patch': Dino.horsetailPatch,
  'fern-patch': Dino.fernPatch,
  'magnolia-shrub': Dino.magnoliaShrub,
  'field-camp': Dino.fieldCamp,
  'fossil-dig': Dino.fossilDig,
  boardwalk: Dino.boardwalk,
  'dino-tracks': Dino.dinoTracks,
  'jungle-rocks': Dino.jungleRocks,
  'volcanic-smoke': Dino.volcanicSmoke,

  // Park
  'park-gate': Park.parkGate,
  'map-kiosk': Park.mapKiosk,
  bandstand: Park.bandstand,
  'park-pavilion': Park.parkPavilion,
  'park-pond': Park.parkPond,
  'stone-fountain': Park.stoneFountain,
  'stone-arch-bridge': Park.stoneArchBridge,
  'stone-steps': Park.stoneSteps,
  'bear-dens': Park.bearDens,
  'puddingstone-outcrop': Park.puddingstoneOutcrop,
  playground: Park.playground,
  'ball-field': Park.ballField,
  'picnic-set': Park.picnicSet,
  'path-stones': Park.pathStones,
  'trail-sign': Park.trailSign,
  'drinking-fountain': Park.drinkingFountain,
  'flower-bed': Park.flowerBed,
  wildflowers: Park.wildflowers,
  'conifer-tree': Park.coniferTree,
  'flowering-tree': Park.floweringTree,
};

// Rebuilds a preset prop from its saved record. Throws on an unknown name rather than
// silently dropping the object, so a typo in a world layout surfaces immediately
// instead of leaving a mysterious hole in the world.
export function buildProp(name, options = {}) {
  const builder = PROP_BUILDERS[name];
  if (!builder) throw new Error(`Unknown preset prop: "${name}"`);
  const object3D = builder(options);
  object3D.userData.presetProp = name;
  return object3D;
}
