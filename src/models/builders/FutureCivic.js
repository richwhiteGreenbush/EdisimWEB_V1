// Build a Future City: the five civic buildings. Future School, Zero-Waste Recycling Center, Fusion
// Power Plant, Spaceport Launch Pad, Hyperloop Station.
//
// Each is an imagined building at life size in feet, origin at the base centre, front toward +Z,
// with a foundation running down to exactly y = -0.4 (they are seated pieces). Each is at most six
// meshes, one per material (src/models/town/FutureCivicKit.js says which), and whatever moves by
// itself lives in an inner group driven by `root.userData.tick`, so the root itself never moves:
//
//   future-school       the robotics lab's robot arm swings and nods.
//   zero-waste-center   three robot arms swing between the belt and their bins, and the bottles,
//                       cans and paper ride the belts. One mesh, rewritten each frame.
//   fusion-power-plant  the plasma ring turns and its glow breathes.
//   spaceport-pad       the rocket flies when its program sets `height`; the crew arm swings clear.
//   hyperloop-station   nothing: the pod waits with its door open.
//
// All of it holds still, or very nearly, under reduced motion.

import { schoolBuild } from '../town/FutureCivicSchool.js';
import { wasteBuild } from '../town/FutureCivicWaste.js';
import { fusionBuild } from '../town/FutureCivicFusion.js';
import { spaceportBuild } from '../town/FutureCivicSpaceport.js';
import { hyperloopBuild } from '../town/FutureCivicHyperloop.js';

export const BUILDERS = {
  'future-school': () => schoolBuild(),
  'zero-waste-center': () => wasteBuild(),
  'fusion-power-plant': () => fusionBuild(),
  'spaceport-pad': () => spaceportBuild(),
  'hyperloop-station': () => hyperloopBuild(),
};
