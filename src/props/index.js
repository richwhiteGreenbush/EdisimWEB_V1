import * as Common from './CommonProps.js';
import * as Museum from './MuseumProps.js';
import * as Library from './LibraryProps.js';
import * as Moon from './MoonProps.js';
import * as Mars from './MarsProps.js';
import * as Dino from './DinoProps.js';
import * as Park from './ParkProps.js';
import * as Body from './BodyProps.js';
import * as City from './CityProps.js';
import * as Sea from './SeaProps.js';
import * as Egypt from './EgyptProps.js';
import * as Solar from './SolarProps.js';
import * as Water from './WaterProps.js';
import * as Pompeii from './PompeiiProps.js';
import * as Vinci from './VinciProps.js';
import * as Ellis from './EllisProps.js';
import * as Capitol from './CapitolProps.js';
import * as Barrier from './BarrierProps.js';
import * as Delta from './DeltaProps.js';
import * as Rome from './RomeProps.js';
import * as Andes from './AndesProps.js';
import * as Taj from './TajProps.js';
import * as Moscow from './MoscowProps.js';
import * as Bug from './BugProps.js';

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
  'activity-board': Common.activityBoard,
  'welcome-board': Common.welcomeBoard,
  'tutorial-board': Common.tutorialBoard,
  'browser-kiosk': Common.browserKiosk,
  'world-portal': Common.worldPortal,

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

  // Fantastic Voyage (human body)
  'organ-plinth': Body.organPlinth,
  'lungs-model': Body.lungsModel,
  'stomach-model': Body.stomachModel,
  'liver-model': Body.liverModel,
  'kidney-model': Body.kidneyModel,
  'heart-model': Body.heartModel,
  'brain-model': Body.brainModel,
  'intestine-coil': Body.intestineCoil,
  'alveoli-cluster': Body.alveoliCluster,
  'villi-patch': Body.villiPatch,
  'blood-cells': Body.bloodCells,
  'cell-model': Body.cellModel,
  'dna-helix': Body.dnaHelix,
  'neuron-model': Body.neuronModel,
  'rib-cage-arch': Body.ribCageArch,
  'artery-tunnel': Body.arteryTunnel,
  'micro-sub': Body.microSub,
  'anatomy-chart': Body.anatomyChart,

  // Park
  'park-gate': Park.parkGate,
  'nature-centre': Park.natureCentre,
  'map-kiosk': Park.mapKiosk,
  bandstand: Park.bandstand,
  'park-pavilion': Park.parkPavilion,
  'park-pond': Park.parkPond,
  'pond-geese': Park.pondGeese,
  'canada-goose': Park.canadaGoose,
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

  // 1940's New York
  'city-street': City.cityStreet,
  'city-building': City.cityBuilding,
  'broadway-theatre': City.broadwayTheatre,
  'bond-building': City.bondBuilding,
  'theatre-front': City.theatreFront,
  'storefront-row': City.storefrontRow,
  'bishop-crook-lamp': City.bishopCrookLamp,
  'taxi-cab': City.taxiCab,
  'sedan-car': City.sedanCar,
  'city-bus': City.cityBus,
  'traffic-signal': City.trafficSignal,
  'street-sign': City.streetSign,
  'fire-hydrant': City.fireHydrant,
  newsstand: City.newsstand,
  'subway-entrance': City.subwayEntrance,
  'wall-sign': City.wallSign,

  // Under the Sea
  'reef-shark': Sea.reefShark,
  'moray-eel': Sea.morayEel,
  octopus: Sea.octopus,
  starfish: Sea.starfish,
  'coral-bommie': Sea.coralBommie,
  'reef-cave': Sea.reefCave,
  'coral-garden': Sea.coralGarden,
  'brain-coral': Sea.brainCoral,
  'sea-fan': Sea.seaFan,
  'sea-anemone': Sea.seaAnemone,
  'tube-sponge': Sea.tubeSponge,
  'giant-clam': Sea.giantClam,
  'sea-urchin': Sea.seaUrchin,
  'sea-cucumber': Sea.seaCucumber,
  'seagrass-patch': Sea.seagrassPatch,
  'reef-fish-school': Sea.reefFishSchool,
  'clownfish-school': Sea.clownfishSchool,
  'water-surface': Sea.waterSurface,
  'light-shafts': Sea.lightShafts,
  'bubble-column': Sea.bubbleColumn,
  'marine-snow': Sea.marineSnow,

  // Ancient Egypt
  'great-sphinx': Egypt.greatSphinx,
  'giza-pyramid': Egypt.gizaPyramid,
  'valley-temple': Egypt.valleyTemple,
  obelisk: Egypt.obelisk,
  stela: Egypt.stela,
  mastaba: Egypt.mastaba,
  'date-palm': Egypt.datePalm,
  'sand-drift': Egypt.sandDrift,
  'solar-barque': Egypt.solarBarque,
  'cartouche-plaque': Egypt.cartouchePlaque,

  // Solar System Walkthrough
  'sun-model': Solar.sunModel,
  'planet-model': Solar.planetModel,
  'orbit-walk': Solar.orbitWalk,
  'distance-marker': Solar.distanceMarker,
  'asteroid-belt': Solar.asteroidBelt,
  comet: Solar.comet,

  // The Water Cycle
  'cumulus-cloud': Water.cumulusCloud,
  'rain-curtain': Water.rainCurtain,
  'vapour-column': Water.vapourColumn,
  'water-body': Water.waterBody,
  'mountain-peak': Water.mountainPeak,
  'stream-course': Water.streamCourse,
  'groundwater-cutaway': Water.groundwaterCutaway,
  'cycle-arrow': Water.cycleArrow,

  // Ancient Pompeii
  vesuvius: Pompeii.vesuvius,
  'pompeii-street': Pompeii.pompeiiStreet,
  'pompeii-villa': Pompeii.pompeiiVilla,
  thermopolium: Pompeii.thermopolium,
  'forum-colonnade': Pompeii.forumColonnade,
  amphitheatre: Pompeii.amphitheatre,
  'plaster-cast': Pompeii.plasterCast,
  'fresco-wall': Pompeii.frescoWall,
  'ash-fall': Pompeii.ashFall,

  // Leonardo da Vinci's Studio
  ornithopter: Vinci.ornithopter,
  'aerial-screw': Vinci.aerialScrew,
  'vinci-cart': Vinci.selfPropelledCart,
  'vitruvian-panel': Vinci.vitruvianPanel,
  workbench: Vinci.workbench,
  'codex-stand': Vinci.codexStand,
  'easel-painting': Vinci.easelPainting,
  'war-machine': Vinci.warMachine,
  'studio-building': Vinci.studioBuilding,

  // Ellis Island
  'ellis-main-building': Ellis.ellisMainBuilding,
  'statue-of-liberty': Ellis.statueOfLiberty,
  steamship: Ellis.steamship,
  'ferry-pier': Ellis.ferryPier,
  'baggage-pile': Ellis.baggagePile,
  'inspection-line': Ellis.inspectionLine,
  'manifest-board': Ellis.manifestBoard,

  // The U.S. Capitol
  'capitol-building': Capitol.capitolBuilding,
  'capitol-dome': Capitol.capitolDome,
  'washington-monument': Capitol.washingtonMonument,
  'reflecting-pool': Capitol.reflectingPool,
  'chamber-desks': Capitol.chamberDesks,
  'statuary-figure': Capitol.statuaryFigure,
  'flag-pole': Capitol.flagPole,

  // The Great Barrier Reef
  'sea-turtle': Barrier.seaTurtle,
  'manta-ray': Barrier.mantaRay,
  'staghorn-coral': Barrier.staghornCoral,
  'plate-coral': Barrier.plateCoral,
  'potato-cod': Barrier.potatoCod,
  'bleached-patch': Barrier.bleachedPatch,

  // The Delta River Boat
  'paddle-steamer': Delta.paddleSteamer,
  'cotton-bales': Delta.cottonBales,
  'levee-landing': Delta.leveeLanding,
  'cypress-tree': Delta.cypressTree,
  pirogue: Delta.pirogue,
  'channel-marker': Delta.channelMarker,
  'reed-bed': Delta.reedBed,

  // The Roman Colosseum
  colosseum: Rome.colosseum,
  hypogeum: Rome.hypogeum,
  'arch-of-constantine': Rome.archOfConstantine,
  gladiator: Rome.gladiator,
  'stone-pine': Rome.stonePine,
  'italian-cypress': Rome.italianCypress,
  'travertine-rubble': Rome.travertineRubble,
  'forum-columns': Rome.forumColumns,
  'she-wolf-column': Rome.sheWolfColumn,
  'roman-fountain': Rome.romanFountain,
  'basalt-paving': Rome.basaltPaving,

  // Machu Picchu
  'inca-wall': Andes.incaWall,
  'inca-terraces': Andes.incaTerraces,
  'temple-of-the-sun': Andes.templeOfTheSun,
  intihuatana: Andes.intihuatana,
  'inca-house': Andes.incaHouse,
  'inca-stairs': Andes.incaStairs,
  'inca-fountain': Andes.incaFountain,
  'andean-peak': Andes.andeanPeak,
  'cloud-bank': Andes.cloudBank,
  llama: Andes.llama,
  'granite-outcrop': Andes.graniteOutcrop,
  'ichu-grass': Andes.ichuGrass,

  // The Taj Mahal
  'taj-mahal': Taj.tajMahal,
  'taj-minaret': Taj.tajMinaret,
  'taj-gateway': Taj.tajGateway,
  'taj-mosque': Taj.tajMosque,
  'charbagh-canal': Taj.charbaghCanal,
  'garden-cypress': Taj.gardenCypress,
  'marble-screen': Taj.marbleScreen,
  cenotaph: Taj.cenotaph,

  // Red Square
  'st-basils': Moscow.stBasils,
  'kremlin-wall': Moscow.kremlinWall,
  'kremlin-tower': Moscow.kremlinTower,
  'lenin-mausoleum': Moscow.leninMausoleum,
  'gum-store': Moscow.gumStore,
  'history-museum': Moscow.historyMuseum,
  'square-paving': Moscow.squarePaving,
  'snow-drift': Moscow.snowDrift,
  'birch-tree': Moscow.birchTree,

  // A Bug's Life
  ant: Bug.ant,
  aphid: Bug.aphid,
  ladybird: Bug.ladybird,
  'ant-hill': Bug.antHill,
  'nest-cutaway': Bug.nestCutaway,
  'pheromone-trail': Bug.pheromoneTrail,
  'food-item': Bug.foodItem,
  'grass-blade': Bug.grassBlade,
  'grass-clump': Bug.grassClump,
  clover: Bug.clover,
  'dandelion-clock': Bug.dandelionClock,
  'fallen-leaf': Bug.fallenLeaf,
  twig: Bug.twig,
  'pebble-field': Bug.pebbleField,
  toadstool: Bug.toadstool,
  'water-drop': Bug.waterDrop,
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
