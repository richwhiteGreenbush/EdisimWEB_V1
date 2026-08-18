import { applyWorldTheme } from './SceneSetup.js';
import { WEB_BROWSER_DEFAULT_URL } from './config.js';
import { youtubeEmbedUrl } from './WebUrl.js';
import { createBlockInstance } from './BlockDefs.js';

import { uuid } from './Uuid.js';
// The ready-made worlds behind Menu > Load World.
//
// A preset world is just a LIST OF RECORDS -- exactly the same record shape that
// IndexedDB and a .json world file hold -- handed to WorldStore.loadFromRecords(),
// which already wipes the live scene and rebuilds from records. So a preset needs no
// loading path of its own, and once loaded it behaves like any other world: every
// object is clickable, resizable, movable, programmable, and saveable.
//
// Nothing here stores geometry or image bytes. A `preset-prop` record carries only its
// builder name, its options and its transform, and is rebuilt from scratch on every
// load -- the same approach light orbs and balloons already take.

// Interior floors sit on a stylobate, so anything placed INSIDE a building has to be
// lifted to the finished floor rather than to the terrain. These two numbers must
// track museumHall()/libraryHall(): steps + floor slab thickness.
const MUSEUM_FLOOR = 1.7;
const LIBRARY_FLOOR = 1.55;

const ORB_WARM = '#f2a541';
const ORB_WHITE = '#f5f5f5';
const ORB_BLUE = '#3d8bf2';
const ORB_ROSE = '#e0455f';

// ---------------------------------------------------------------------------
// Layout entry helpers -- each returns a plain object the materializer turns into a
// record. `y` is height ABOVE THE TERRAIN at that spot unless `absoluteY` is set.
// ---------------------------------------------------------------------------

function prop(name, x, z, {
  y = 0, rotY = 0, rotX = 0, absoluteY = false, scale = 1, options = {}, program = null,
} = {}) {
  return { kind: 'preset-prop', prop: name, options, x, z, y, rotY, rotX, absoluteY, scale, program };
}

// One block for a program shipped ON a prop (see `program` above).
//
// Built through createBlockInstance() rather than written as an object literal, and that
// matters for more than tidiness: it stamps a fresh uuid and fills in EVERY param from
// the block's own schema. A hand-written `{ type: 'rotate', params: { degrees: 2 } }`
// looks complete and is not -- the moment a student opens it in the editor, any param
// the literal forgot renders as an empty field, and re-saving writes that back.
function block(type, params = {}, children) {
  const b = createBlockInstance(type);
  Object.assign(b.params, params);
  if (children) b.children = children;
  return b;
}

function orb(x, z, y, color = ORB_WHITE) {
  return { kind: 'light-orb', color, x, z, y };
}

// The yaw that turns a prop at (x, z) to FACE the point (tx, tz) -- normally the spawn.
//
// atan2(dx, dz), not atan2(dz, dx), and not the camera's formula either. A plain
// Object3D's forward is its own +Z, so this is the same arithmetic browserStation() has
// always used; a CAMERA looks down its own -Z and needs atan2(-dx, -dz) instead. Mixing
// the two is easy and silent -- it shipped five signs facing backwards in one world, each
// presenting its blank side to the arrival -- so every layout that turns something toward
// the player goes through this rather than through a hand-guessed constant.
function facing(x, z, tx = 0, tz = 0) {
  return Math.atan2(tx - x, tz - z);
}

// One of the three assets fetched from public/ (`startup-library` / `startup-tree` /
// `startup-billboard`). These are the project's own downloaded .obj/.png files, reused
// here at park scale.
//
// Sized by `height` IN FEET, never by a scale factor: the transform's scale is applied
// wholesale on rehydration and would wipe out the loaders' own height normalization,
// so a scale factor here would silently mean "N times the model's raw authored size".
// WorldStore re-normalizes to this height and then seats the model's base on the
// ground. See ModelLoader.scaleToHeight()/seatBaseAt().
function asset(kind, x, z, { height, y = 0, rotY = 0 } = {}) {
  return { kind, x, z, y, rotY, height };
}

// ---------------------------------------------------------------------------
// Programming activities
// ---------------------------------------------------------------------------

// One block on an activity board, in the colour of its palette category.
const ctrlStep = (text, depth = 0) => ({ cat: 'control', text, depth });
const moveStep = (text, depth = 0) => ({ cat: 'motion', text, depth });
const lookStep = (text, depth = 0) => ({ cat: 'look', text, depth });

// A challenge board pointed at one particular object in the world.
//
// Every sequence written on these boards has been checked against what the blocks
// ACTUALLY do, which is a real constraint: `move X/Y/Z` shift an object along the
// WORLD axes, not along its own facing. Rotating something therefore does not change
// which way it will travel -- so "drive in a square" is not writable with these blocks,
// and every patrol here is instead an out-and-back along one axis, with a `rotate 180`
// in the middle so the thing is facing the way it is going. That is a more honest
// lesson anyway: it is exactly the difference between turning and moving.
function activity(x, z, { number, title, target, steps, tip, rotY = 0, accent, y = 0 }) {
  return prop('activity-board', x, z, { rotY, y, options: { number, title, target, steps, tip, accent } });
}

// Feet from the ground to the CENTRE of a browser panel. WEB_BROWSER_HEIGHT is 2.6, so
// this puts the bottom edge at 2.7ft and the top at 5.3ft -- straddling a 5ft student's
// eye line, which is where a real information kiosk puts its screen.
const BROWSER_CENTRE_Y = 4;

// A live web browser panel on a stand, placed so a student walks straight into it.
//
// TWO records, not one: the panel (a `web-browser`, rebuilt from nothing but its URL)
// and the kiosk under it (an ordinary `preset-prop`). They are deliberately separate
// objects -- a browser panel is one bezel mesh that the whole Size/Move/Program and
// persistence machinery already understands, and folding scenery into it would mean
// every one of those paths growing a special case for this one kind.
//
// `faceX`/`faceZ` is what the panel turns to face, normally the world's spawn point.
// Both the panel and the stand take that same yaw, since the stand's surround is built
// around the panel's own plane.
// `y` lifts the whole station onto a raised deck -- New York's sidewalk is a 6in slab of
// its own, and a kiosk seated on the terrain under it stands half-buried in concrete.
function browserStation(x, z, { faceX = 0, faceZ = 0, url = WEB_BROWSER_DEFAULT_URL, y = 0 } = {}) {
  // atan2(dx, dz), not atan2(dz, dx): a plain Object3D's +Z is its facing direction,
  // and the bezel's PlaneGeometry is authored in the XY plane looking down +Z.
  const rotY = Math.atan2(faceX - x, faceZ - z);
  return [
    prop('browser-kiosk', x, z, { y, rotY, options: { centreY: BROWSER_CENTRE_Y } }),
    { kind: 'web-browser', x, z, y: BROWSER_CENTRE_Y + y, rotY, url },
  ];
}

// ---------------------------------------------------------------------------
// The Park -- the world a new visitor lands in
// ---------------------------------------------------------------------------

// Laid out like a large Olmsted-designed city park in the manner of Boston's Franklin
// Park: a formal entrance on the main axis, a great meadow east, a pond and a wooded
// shelter west, and the historic bear dens out at the far edge.
//
// The whole layout hangs off ONE north-south axis running down x = 0 from the gate to
// the bandstand, with two side branches. That is not decoration -- it is what makes a
// 90ft-deep world navigable by a 12-year-old with arrow keys: whichever way they
// wander, walking back to the paved path and turning always gets them somewhere.
function parkLayout() {
  const items = [];

  // --- Entrance -----------------------------------------------------------
  items.push(prop('park-gate', 0, -2, { options: { name: 'FRANKLIN PARK', opening: 16 } }));
  items.push(prop('map-kiosk', -25, -8, { rotY: 0.5 }));

  // A live web browser on the lawn a few paces inside the spawn point, so the first
  // thing a student can walk up to and use is the project's own site.
  items.push(...browserStation(-8, 6, { faceX: 0, faceZ: 16 }));

  // The project's own billboard image, reused as the park's welcome banner. Sized by
  // HEIGHT, and this image is a very wide banner -- at 6ft tall it comes out roughly
  // 24ft across and swallows the whole entrance. 3ft tall is about 12ft wide, which
  // reads as a sign rather than a wall.
  items.push(asset('startup-billboard', 20, -6, { rotY: -0.7, height: 3 }));

  // The nature centre. This was the downloaded little-library .obj until it was
  // replaced by a purpose-built one -- see natureCentre() in ParkProps.js for why. At
  // this yaw the building occupies roughly x -63..-32 and z -15..20, with its porch
  // facing east back toward the gate, so everything else out here is held clear of that
  // box and of the pond's bank.
  items.push(prop('nature-centre', -50, 2, { rotY: 1.3 }));
  items.push(
    prop('info-placard', -30, 6, {
      rotY: 1.3,
      options: {
        eyebrow: 'Nature centre',
        title: 'Start your visit here',
        body: 'Maps, trail guides and restrooms. Rangers here can tell you what is blooming, nesting or migrating in the park this week.',
      },
    })
  );

  // --- the way into Under the Sea -------------------------------------------------------
  //
  // The billboard behind the nature centre is the ONLY route to that world: it is
  // deliberately absent from Load World (`hidden` in PRESET_WORLDS below), so this sign is
  // its door. Clicking it loads the world -- see worldPortal() in CommonProps.js and the
  // reroute in ObjectMenu.tryPick().
  //
  // The geometry, since none of it is guessable from the numbers: the building is 30x18
  // on a plinth that reaches 20.4ft deep, centred on (-50, 2) and yawed 1.3, so its porch
  // faces out along (sin 1.3, cos 1.3) = (0.96, 0.27) and its BACK wall is at about
  // (-59.8, -0.7). The sign stands 24ft further along that line and takes the building's
  // own yaw, which faces it BACK toward the rear wall -- so a student rounding either back
  // corner walks into the slot between the two and meets the face square on. Turned the
  // other way it would show them its blank back and nothing else.
  items.push(
    prop('world-portal', -82.6, -8.8, {
      rotY: 1.3,
      options: {
        title: 'UNDER THE SEA',
        subtitle: 'A tropical coral reef, thirty feet down — walk the sand under a shark, meet a moray and an octopus',
        world: 'sea',
        accent: '#1f8fb4',
        face: '#0d2b3e',
      },
    })
  );
  items.push(prop('lamp-post', -75, -20, { options: { height: 10 } }));
  items.push(prop('lamp-post', -70, 3, { options: { height: 10 } }));

  // A portal nobody finds is a portal nobody has. This is the only signpost to it, out on
  // the lawn between the gate and the nature centre where every visitor already walks.
  items.push(
    prop('standing-sign', -20, 15, {
      rotY: 1.5,
      options: {
        lines: ['DIVE EXHIBIT'],
        subtitle: 'BEHIND THE NATURE CENTRE · WALK AROUND THE BUILDING',
        width: 9,
        height: 2.6,
        postHeight: 7,
        face: '#0d3b4a',
        accent: '#4fc4d8',
      },
    })
  );

  items.push(
    prop('info-placard', -13, -13, {
      rotY: 0.4,
      options: {
        eyebrow: 'Welcome',
        title: 'A park built for everyone',
        body: 'Frederick Law Olmsted designed parks like this one in the 1880s so that city families with no garden of their own still had somewhere green to go. It was a radical idea.',
      },
    })
  );
  items.push(
    prop('info-placard', 13, -13, {
      rotY: -0.4,
      options: {
        eyebrow: 'The Emerald Necklace',
        title: 'A chain of green',
        body: 'This park is the last bead on a 7-mile chain of connected parks. Olmsted linked them so you could walk from the city centre to open country without leaving green space.',
      },
    })
  );

  items.push(prop('drinking-fountain', 10, -16));
  items.push(prop('flower-bed', -16, -22, { options: { width: 11, depth: 5, seed: 7 } }));
  items.push(prop('flower-bed', 16, -22, { options: { width: 11, depth: 5, seed: 8 } }));

  // --- The main path ------------------------------------------------------
  for (const z of [-12, -26, -40, -54]) {
    items.push(prop('path-stones', 0, z, { options: { length: 14, width: 6, seed: 17 + z } }));
  }
  // West branch, out to the bridge and the pond. Rotated a quarter turn so the runs
  // lie along X; the -26 segment paves the ground under the bridge's arch.
  for (const x of [-12, -26]) {
    items.push(prop('path-stones', x, -40, { rotY: Math.PI / 2, options: { length: 14, width: 5, seed: 31 - x } }));
  }
  // East branch, out onto the great meadow.
  for (const x of [14, 28, 42]) {
    items.push(prop('path-stones', x, -26, { rotY: Math.PI / 2, options: { length: 14, width: 5, seed: 47 + x } }));
  }

  items.push(
    prop('trail-sign', 6, -34, {
      options: {
        arms: [
          { label: 'BANDSTAND', angle: Math.PI },
          { label: 'THE POND', angle: -Math.PI / 2 },
          { label: 'PLAYSTEAD', angle: Math.PI / 2 },
        ],
      },
    })
  );
  items.push(
    prop('trail-sign', -20, -46, {
      options: { arms: [{ label: 'OVERLOOK', angle: Math.PI }, { label: 'BEAR DENS', angle: Math.PI / 2 }] },
    })
  );

  items.push(prop('lamp-post', -11, -22));
  items.push(prop('lamp-post', 11, -22));
  items.push(prop('lamp-post', -11, -50));
  items.push(prop('lamp-post', 11, -50));
  items.push(prop('bench', -12, -30, { rotY: Math.PI / 2 }));
  items.push(prop('bench', 12, -30, { rotY: -Math.PI / 2 }));
  items.push(prop('bench', -12, -46, { rotY: Math.PI / 2 }));
  items.push(prop('bench', 12, -46, { rotY: -Math.PI / 2 }));

  // --- Fountain plaza, just off the axis ----------------------------------
  items.push(prop('stone-fountain', -29, -20, { options: { radius: 6.5 } }));
  items.push(prop('bench', -26, -8, { rotY: 0 }));
  items.push(prop('planter', -40, -19));
  items.push(prop('planter', -19, -14));

  // --- The bandstand, closing the axis ------------------------------------
  items.push(prop('bandstand', 0, -70, { rotY: -Math.PI / 2 }));
  items.push(
    prop('info-placard', 15, -63, {
      rotY: -0.7,
      options: {
        eyebrow: 'The bandstand',
        title: 'Why it is shaped like that',
        body: 'The domed roof and raised deck bounce sound outward and down, so a band with no microphones can still be heard across the lawn. Try standing at different distances.',
      },
    })
  );
  items.push(prop('bench', -14, -56, { rotY: -1.2 }));
  items.push(prop('bench', 14, -56, { rotY: 1.2 }));

  // --- The pond -----------------------------------------------------------
  // Radius 15, not 20: the pond's reed margin sits at ~1.0x its radius, and at 20 those
  // cattails came up through the floor of the Overlook shelter 25ft away.
  items.push(prop('park-pond', -52, -40, { options: { radius: 15, seed: 23, geese: false } }));
  items.push(prop('pond-geese', -52, -40, { rotY: 0.4, options: { spread: 4.5 } }));
  items.push(prop('bench', -33, -31, { rotY: -2.4 }));
  items.push(
    prop('info-placard', -24, -28, {
      rotY: -2.3,
      options: {
        eyebrow: 'Scarboro Pond',
        title: 'A whole food web',
        body: 'Sun feeds algae, algae feed insects and tadpoles, those feed the fish and frogs, and the heron at the far bank eats those. Pull out one link and the rest wobble.',
      },
    })
  );
  items.push(prop('picnic-set', -68, -14, { rotY: 0.35 }));
  items.push(prop('picnic-set', -74, -28, { rotY: -0.2 }));

  // The arch bridge straddles the west path, so students walk THROUGH it. Rotated a
  // quarter turn because the builder's arch opening runs along its local X while its
  // barrel runs along Z -- unrotated, the path would meet a solid abutment.
  items.push(prop('stone-arch-bridge', -26, -40, { rotY: Math.PI / 2, options: { span: 14, width: 8 } }));
  items.push(
    prop('info-placard', -20, -29, {
      rotY: -0.2,
      options: {
        eyebrow: 'Separate ways',
        title: 'Why the path goes under',
        body: 'Olmsted kept walkers, riders and carriages on separate levels so they never had to cross. It is the same idea as a motorway junction, invented for a park in the 1870s.',
      },
    })
  );

  // --- The Overlook shelter -----------------------------------------------
  items.push(prop('park-pavilion', -30, -72, { rotY: 0.35 }));
  items.push(prop('stone-steps', -26, -54, { options: { steps: 7, width: 9 } }));
  items.push(
    prop('info-placard', -20, -55, {
      rotY: -0.9,
      options: {
        eyebrow: 'The Overlook',
        title: 'Reading a landscape',
        body: 'Almost nothing here is accidental. Trees were planted to frame some views and hide others, and the ground was reshaped so the park feels bigger than it is.',
      },
    })
  );

  // --- The great meadow and the Playstead ---------------------------------
  items.push(prop('playground', 40, 6));
  items.push(
    prop('info-placard', 14, 4, {
      rotY: -0.5,
      options: {
        eyebrow: 'The playground',
        title: 'Swings are physics',
        body: 'A swing is a pendulum. Its rhythm depends on the length of the chain, not on how heavy you are — which is why the long swings feel slower than the short ones.',
      },
    })
  );

  // Yawed so the diamond runs out to the north-east. The backstop is the prop's
  // origin and the infield sits ~22ft behind it, so an unlucky rotation drops the
  // dirt of the infield straight on top of the bear dens.
  items.push(prop('ball-field', 58, -44, { rotY: -1.1, options: { baseline: 30 } }));
  items.push(
    prop('info-placard', 50, -29, {
      rotY: -0.8,
      options: {
        eyebrow: 'The Playstead',
        title: 'Room to run',
        body: 'Olmsted set aside 60 flat acres purely for games. Before public parks, most city kids had nowhere to play but the street.',
      },
    })
  );

  items.push(prop('wildflowers', 26, -44, { options: { radius: 9, count: 170, seed: 11 } }));
  items.push(prop('wildflowers', 40, -32, { options: { radius: 7, count: 130, seed: 12 } }));
  items.push(prop('wildflowers', 24, -52, { options: { radius: 8, count: 150, seed: 13 } }));
  items.push(
    prop('info-placard', 14, -34, {
      rotY: 0.3,
      options: {
        eyebrow: 'Pollinator meadow',
        title: 'Left long on purpose',
        body: 'This grass is cut once a year, not weekly. Bees, butterflies and beetles need flowers that are allowed to finish blooming — a mown lawn feeds almost nothing.',
      },
    })
  );

  // --- Puddingstone -------------------------------------------------------
  items.push(prop('puddingstone-outcrop', 18, -74, { options: { size: 10, seed: 13 } }));
  items.push(
    prop('info-placard', 8, -84, {
      rotY: 0.5,
      options: {
        eyebrow: 'Geology',
        title: 'Roxbury puddingstone',
        body: 'Look closely: this rock is made of thousands of rounded pebbles glued together. It formed from ancient gravel about 600 million years ago, and it is Massachusetts’ state rock.',
      },
    })
  );

  // --- The bear dens ------------------------------------------------------
  // Turned to catch the sun. The dens' facade is deep, north-facing stone with the
  // cornice over it, so at a grazing sun angle the whole thing sits in its own shadow;
  // yawed to about +0.45 it faces both the approach path and the sun's azimuth.
  items.push(prop('bear-dens', 46, -84, { rotY: 0.45 }));
  // Placard and bench on the FACADE side, which the yaw above moved: the dens front
  // now faces out along (sin 0.45, cos 0.45), so these sit up that way and face back
  // toward whoever is walking in.
  items.push(
    prop('info-placard', 57, -66, {
      rotY: 0.45,
      options: {
        eyebrow: 'Historic structure',
        title: 'The bear dens',
        body: 'Bears really lived behind these bars, from 1912 until the 1950s. We know far more now about what animals need, and no accredited zoo would build this today.',
      },
    })
  );
  items.push(prop('bench', 64, -70, { rotY: 0.45 }));

  // --- Planting -----------------------------------------------------------
  // Perimeter woods and specimen trees. Kept to a modest count: each tree is several
  // draw calls, and the park is already the heaviest of the four worlds.
  // Nothing tall within ~25ft of the spawn point: a 24ft canopy planted next to where
  // the student appears fills the whole screen and hides the gate they are meant to
  // walk through. The sun sits high in the +X/+Z quadrant for this theme, so trees are
  // also kept clear of that side of the bear dens, whose deep arches are already the
  // darkest thing in the park and go pitch black under a tree shadow.
  const trees = [
    ['shade-tree', -24, 22, 24, 4], ['shade-tree', 16, 22, 22, 9],
    ['shade-tree', -80, -30, 26, 14], ['shade-tree', 62, -6, 23, 21],
    ['shade-tree', -70, -52, 25, 26], ['shade-tree', 70, -26, 24, 33],
    ['shade-tree', -6, -90, 26, 38], ['shade-tree', 20, -96, 23, 45],
    ['conifer-tree', -48, -68, 28, 2], ['conifer-tree', -56, -74, 24, 6],
    ['conifer-tree', 24, -100, 26, 10], ['conifer-tree', 34, -104, 22, 15],
    ['conifer-tree', -10, -94, 27, 19], ['conifer-tree', 4, -100, 24, 24],
    ['flowering-tree', -15, -32, 16, 5], ['flowering-tree', 8, -36, 16, 31],
    ['flowering-tree', -30, -10, 15, 37], ['flowering-tree', 22, -18, 17, 43],
  ];
  for (const [kind, x, z, height, seed] of trees) {
    items.push(prop(kind, x, z, { options: { height, seed } }));
  }

  // Perimeter woodland. Without it the park sits as an island of detail in an endless
  // flat green plain, which is the single thing that most gives away that this is a
  // 400ft box rather than somewhere. A ring of trees closes the views off, and since
  // each tree is one merged draw call it is cheap enough to be worth 18 of them.
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + 0.35;
    const radius = 104 + ((i * 7) % 5) * 7;
    items.push(
      prop(i % 3 === 0 ? 'conifer-tree' : 'shade-tree', 5 + Math.cos(angle) * radius, -45 + Math.sin(angle) * radius, {
        options: { height: 22 + ((i * 5) % 4) * 3, seed: 100 + i * 13 },
      })
    );
  }

  // The maple .obj from public/, as the specimen trees nearest the path where its
  // extra detail actually shows against the low-poly planting around it.
  for (const [x, z, rotY, height] of [
    [-16, -46, 0.4, 22],
    [18, -46, -0.9, 19],
    [-36, -26, 1.6, 24],
    [26, -54, 2.2, 21],
  ]) {
    items.push(asset('startup-tree', x, z, { rotY, height }));
  }
  items.push(
    prop('info-placard', -7, -56, {
      rotY: 0.8,
      options: {
        eyebrow: 'Trees',
        title: 'How to tell them apart',
        body: 'Start with the leaf: is it one blade or many leaflets? Then the edge — smooth, toothed or lobed? Two questions will get you most of the way to a name.',
      },
    })
  );

  // --- Activities ---------------------------------------------------------
  items.push(
    activity(-40, -56, {
      number: 1,
      rotY: -2.5,
      accent: '#2f8f5b',
      title: 'Send the geese out for a paddle',
      target: 'Click a goose → Program. (They are one object, so they paddle together.)',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 0.3 feet', 2),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 0.3 feet', 2),
      ],
      tip: 'Out six feet, back six feet, over and over. Drop a wait 0.1 seconds inside each loop to slow them to a proper glide — geese are never in a hurry.',
    })
  );
  items.push(
    activity(24, -42, {
      number: 2,
      rotY: -0.9,
      accent: '#c2521f',
      title: 'Grow the maple from a sapling',
      target: 'Click the big maple tree → Program.',
      steps: [
        lookStep('set size to 25 %'),
        ctrlStep('repeat 12 times'),
        lookStep('change size by 12 %', 1),
        ctrlStep('wait 0.2 seconds', 1),
      ],
      tip: 'Two size blocks, and they are not the same. "set size to" always measures from how big the tree was when you pressed play, so it starts from a sapling every time. "change size by" builds on whatever size it is NOW — which is why 12% of a big tree is more than 12% of a small one, and why it speeds up as it goes. That is what growth really does.',
    })
  );

  // --- Lighting -----------------------------------------------------------
  // Light orbs where the park genuinely goes dark: deep under the shelter roof, inside
  // the bear dens' alcoves, under the bandstand dome, and beneath the bridge arch.
  items.push(orb(-34, -66, 7, ORB_WARM));
  items.push(orb(0, -70, 8.5, ORB_WARM));
  items.push(orb(-26, -40, 5.5, ORB_WHITE));
  items.push(orb(43, -83, 6, ORB_WARM));
  items.push(orb(50, -86, 6, ORB_WARM));
  items.push(orb(-25, -8, 7, ORB_WARM));

  return { theme: 'park', spawn: { x: 0, z: 16, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Museum
// ---------------------------------------------------------------------------

const PAINTINGS = [
  {
    style: 'destijl',
    title: 'Composition in Primary Colours',
    artistLine: 'De Stijl · 1920s',
    body: 'Only straight lines, right angles, black, white, and red-yellow-blue. Artists stripped painting down to its simplest possible parts.',
  },
  {
    style: 'nightsky',
    title: 'Village Under Turning Stars',
    artistLine: 'Post-Impressionism · 1880s',
    body: 'Thick, visible brushstrokes that swirl. These painters cared more about feeling and movement than about copying exactly what the eye sees.',
  },
  {
    style: 'ukiyoe',
    title: 'Great Swell Before the Mountain',
    artistLine: 'Ukiyo-e woodblock · 1830s',
    body: 'Carved into wood, then printed. Flat areas of colour and bold outlines — a Japanese style that later reshaped European painting.',
  },
  {
    style: 'pointillist',
    title: 'Afternoon on the Riverbank',
    artistLine: 'Pointillism · 1880s',
    body: 'Every colour here is separate dots. Your eye blends them into new colours — the same trick a phone screen uses with red, green and blue pixels.',
  },
  {
    style: 'colorfield',
    title: 'Three Warm Fields',
    artistLine: 'Colour Field · 1950s',
    body: 'No people, no places, no objects. Just enormous soft-edged rectangles of colour, meant to be stood close to and felt.',
  },
  {
    style: 'geometric',
    title: 'Improvisation in Circles',
    artistLine: 'Abstract art · 1910s',
    body: 'The first paintings that showed nothing at all from the real world. Shape, colour and line became the subject themselves.',
  },
];

function museumLayout() {
  const hallZ = -32;
  const items = [];

  items.push(prop('museum-hall', 0, hallZ));

  // Out on the plaza, where a student arrives -- not inside the gallery, where a live
  // web page competes with the exhibits it is standing among.
  items.push(...browserStation(-8, 4, { faceX: 0, faceZ: 14 }));

  // Five plinths down the gallery, each with its sculpture and its own label.
  const displays = [
    { x: -15, z: -21, sculpture: 'sculpture-bust', pedestal: 3.0, options: {},
      title: 'Portrait Bust', body: 'Carved portraits like this are over 2,000 years old. Before photographs, this was how you remembered a face.' },
    { x: 15, z: -21, sculpture: 'sculpture-knot', pedestal: 3.0, options: { size: 1.3 },
      title: 'Bronze Knot', body: 'One continuous surface with no beginning or end. Try walking all the way around it — can you find a seam?' },
    { x: 0, z: -38, sculpture: 'sculpture-figure', pedestal: 3.5, options: {},
      title: 'Standing Figure', body: 'The weight rests on one leg, so the hips and shoulders tilt opposite ways. Sculptors call this contrapposto.' },
    { x: -15, z: -45, sculpture: 'sculpture-crystals', pedestal: 2.6, options: { height: 3.4 },
      title: 'Light Study', body: 'Glass and colour. Move around it and watch the colour change as light passes through at different angles.' },
    { x: 15, z: -45, sculpture: 'sculpture-mobile', pedestal: 0, options: { height: 9 },
      title: 'Kinetic Sculpture', body: 'Sculpture that MOVES. Click this one, choose Program, and give it a "rotate forever" block of your own.' },
  ];

  for (const display of displays) {
    if (display.pedestal) {
      items.push(prop('museum-pedestal', display.x, display.z, { y: MUSEUM_FLOOR, options: { height: display.pedestal } }));
    }
    items.push(
      prop(display.sculpture, display.x, display.z, {
        y: MUSEUM_FLOOR + display.pedestal,
        options: display.options,
      })
    );
    items.push(
      // A real gallery stands its label a good pace clear of the work so two people can
      // read it without blocking the view. At the original 2.6ft the label was close
      // enough to the plinth to read as part of the sculpture's base.
      prop('info-placard', display.x + 3.8, display.z + 3.8, {
        y: MUSEUM_FLOOR,
        rotY: 0.5,
        options: { eyebrow: 'On display', title: display.title, body: display.body, height: 2.8, width: 2.0 },
      })
    );
  }

  items.push(prop('velvet-rope', 0, -33.4, { y: MUSEUM_FLOOR, options: { length: 5 } }));
  items.push(prop('velvet-rope', 0, -42.6, { y: MUSEUM_FLOOR, options: { length: 5 } }));

  // Paintings: three across the back wall, and three on the side walls.
  //
  // Hung with the canvas centre at 5.2ft above the gallery floor -- level with a 5ft
  // student's eyes, which is the same reason real galleries hang to a fixed centre
  // height rather than a fixed distance from the ceiling.
  //
  // The Z/X offsets put each canvas just PROUD of the wall's inner face, not of the
  // hall's outer half-width: museumHall's walls are 1ft thick, so the inner faces are
  // at depth/2 - 1 and width/2 - 1. Using the outer half-width buries the frame.
  const paintingY = MUSEUM_FLOOR + 5.2;
  const backWallZ = hallZ - 15.8;
  [-14, 0, 14].forEach((x, i) => {
    items.push(prop('framed-painting', x, backWallZ, { y: paintingY, options: PAINTINGS[i] }));
  });
  [-24, -40].forEach((z, i) => {
    items.push(prop('framed-painting', -20.4, z, { y: paintingY, rotY: Math.PI / 2, options: PAINTINGS[3 + i] }));
  });
  items.push(prop('framed-painting', 20.4, -32, { y: paintingY, rotY: -Math.PI / 2, options: PAINTINGS[5] }));

  // Gallery lighting, hung high so the cone reaches the floor.
  for (const [x, z] of [[-12, -24], [12, -24], [-12, -42], [12, -42], [0, -32]]) {
    items.push(orb(x, z, MUSEUM_FLOOR + 11, ORB_WARM));
  }

  items.push(
    activity(10, -34, {
      number: 1,
      y: MUSEUM_FLOOR,
      rotY: -0.7,
      accent: '#6b3fa0',
      title: 'Set the mobile turning',
      target: 'Click the hanging mobile → Program.',
      steps: [ctrlStep('forever'), moveStep('rotate 2 degrees', 1)],
      tip: 'Two degrees a frame is a slow, gallery-ish drift. Try 10 for a fairground spin, or 0.5 if you want visitors to wonder whether it is moving at all.',
    })
  );
  items.push(
    activity(-7, -36, {
      number: 2,
      y: MUSEUM_FLOOR,
      rotY: 0.6,
      accent: '#0f7d8c',
      title: 'Make the glass study change colour',
      target: 'Click the coloured glass sculpture → Program.',
      steps: [
        ctrlStep('forever'),
        lookStep('change color to blue', 1),
        ctrlStep('wait 1 seconds', 1),
        lookStep('change color to red', 1),
        ctrlStep('wait 1 seconds', 1),
      ],
      tip: 'Colour Field painters spent whole careers on how two colours sit next to each other. Pick your two and see which pair you cannot stop looking at.',
    })
  );
  items.push(prop('bench', -8, -29, { y: MUSEUM_FLOOR, rotY: Math.PI / 2 }));
  items.push(prop('bench', 8, -29, { y: MUSEUM_FLOOR, rotY: -Math.PI / 2 }));

  // Approach and plaza. The sign sits off the centre line on purpose -- squared up on
  // the axis it reads as a billboard bolted across the museum's own facade.
  items.push(
    prop('standing-sign', -23, -7, {
      rotY: 0.42,
      options: {
        lines: ['MUSEUM OF ART'],
        subtitle: 'SCULPTURE · PAINTING · DESIGN — FREE ADMISSION',
        width: 11,
        height: 3,
        postHeight: 7.5,
        face: '#243b4a',
      },
    })
  );
  items.push(
    prop('info-placard', -11, -7, {
      rotY: 0.35,
      options: {
        eyebrow: 'Before you go in',
        title: 'How to look at art',
        body: 'Pick one work. Stand with it for a full minute. What is the first thing you notice? What is the last?',
      },
    })
  );
  items.push(
    prop('info-placard', 11, -7, {
      rotY: -0.35,
      options: {
        eyebrow: 'Try this',
        title: 'You can build here too',
        body: 'Click anything in this world to resize, move, or program it. Use Draw and Import from the menu to add your own work.',
      },
    })
  );

  items.push(prop('sculpture-rings', -30, -16, { options: { radius: 3.6 } }));
  items.push(
    prop('info-placard', -31, -8, {
      options: {
        eyebrow: 'Plaza commission',
        title: 'Three Rings',
        body: 'Outdoor sculpture has to survive rain, sun and wind. That is why so much of it is bronze or stainless steel.',
      },
    })
  );

  items.push(prop('planter', -17, -13));
  items.push(prop('planter', 17, -13));
  items.push(prop('bench', -14, -2));
  items.push(prop('bench', 14, -2));
  items.push(prop('lamp-post', -22, 2));
  items.push(prop('lamp-post', 22, 2));
  items.push(prop('shade-tree', -36, 4, { options: { seed: 4 } }));
  items.push(prop('shade-tree', 36, 2, { options: { seed: 9, height: 25 } }));
  items.push(prop('shade-tree', 30, -22, { options: { seed: 14, height: 19 } }));

  return { theme: 'museum', spawn: { x: 0, z: 14, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Library
// ---------------------------------------------------------------------------

// The full Dewey Decimal top level. Three of these get a hanging aisle sign; the rest
// appear on the "how the shelves are organised" placard by the entrance.
const DEWEY = [
  ['000–099', 'GENERAL & COMPUTERS'],
  ['100–199', 'PHILOSOPHY'],
  ['200–299', 'RELIGION'],
  ['300–399', 'SOCIAL SCIENCES'],
  ['400–499', 'LANGUAGE'],
  ['500–599', 'SCIENCE'],
  ['600–699', 'TECHNOLOGY'],
  ['700–799', 'ARTS & SPORTS'],
  ['800–899', 'LITERATURE'],
  ['900–999', 'HISTORY & GEOGRAPHY'],
];

function libraryLayout() {
  const hallZ = -34;
  const items = [];
  const floor = LIBRARY_FLOOR;

  items.push(prop('library-hall', 0, hallZ));

  // On the approach, before the doors -- and outdoors, where the panel is not competing
  // with the reading room's own lighting.
  items.push(...browserStation(-8, 6, { faceX: 0, faceZ: 16 }));

  // Three stack rows running across the room, four double-sided units per row.
  const rows = [
    { z: -34, range: '500–599', subject: 'SCIENCE', color: '#1f6b4a' },
    { z: -42, range: '800–899', subject: 'LITERATURE', color: '#7a3050' },
    { z: -50, range: '900–999', subject: 'HISTORY', color: '#8a5a1e' },
  ];
  rows.forEach((row, r) => {
    [-9, -3, 3, 9].forEach((x, i) => {
      items.push(
        prop('bookshelf', x, row.z, {
          y: floor,
          options: { seed: r * 17 + i * 5 + 3, doubleSided: true, width: 6, height: 7 },
        })
      );
    });
    items.push(
      prop('dewey-sign', 15.5, row.z, {
        y: floor,
        rotY: -Math.PI / 2,
        options: { range: row.range, subject: row.subject, color: row.color },
      })
    );
  });

  items.push(prop('circulation-desk', 0, -22, { y: floor }));
  items.push(
    prop('info-placard', 8.5, -16, {
      y: floor,
      rotY: -0.5,
      options: {
        eyebrow: 'Start here',
        title: 'The circulation desk',
        body: 'Checking a book out is free. A librarian here can find you anything in the building — asking is the fastest search engine there is.',
      },
    })
  );

  items.push(prop('reading-table', -16, -26, { y: floor }));
  items.push(prop('reading-table', 16, -26, { y: floor }));
  items.push(prop('reading-table', -16, -46, { y: floor, options: { length: 7 } }));

  items.push(prop('card-catalog', -22, -19, { y: floor, rotY: Math.PI / 2.4 }));
  items.push(
    prop('info-placard', -22, -24, {
      y: floor,
      rotY: Math.PI / 2,
      options: {
        eyebrow: 'Before computers',
        title: 'The card catalog',
        body: 'Every book had a typed card filed in these drawers — by title, by author, and by subject. Finding one book meant opening three drawers.',
      },
    })
  );

  items.push(prop('library-globe', 21, -20, { y: floor }));
  items.push(prop('book-cart', 8, -28, { y: floor, rotY: 0.6 }));
  items.push(
    activity(-9, -24, {
      number: 1,
      y: floor,
      rotY: 0.25,
      accent: '#8a5a1e',
      title: 'Send the book cart back to the stacks',
      target: 'Click the book cart → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 15 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 15 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Notice the second loop uses MINUS one foot. Turning the cart round does not change which way move Z pushes it — you have to flip the number yourself.',
    })
  );
  items.push(
    activity(23, -31, {
      number: 2,
      y: floor,
      rotY: -0.6,
      accent: '#1f6b8a',
      title: 'Give the globe a spin',
      target: 'Click the globe → Program.',
      steps: [ctrlStep('forever'), moveStep('rotate 1 degrees', 1)],
      tip: 'The real Earth manages one full turn a day. See if you can find a number that looks convincing rather than dizzying — and remember the globe is tilted, so it will wobble like the real thing.',
    })
  );
  items.push(prop('story-rug', 19, -48, { y: floor }));
  items.push(
    prop('info-placard', 19, -41, {
      y: floor,
      rotY: Math.PI,
      options: {
        eyebrow: 'Story corner',
        title: 'Reading out loud',
        body: 'Public libraries began holding free story hours in the 1890s. Hearing a story read aloud is still one of the best ways to learn new words.',
      },
    })
  );

  items.push(
    prop('info-placard', -8.5, -16, {
      y: floor,
      rotY: 0.5,
      options: {
        eyebrow: 'How the shelves work',
        title: 'The Dewey Decimal System',
        body: `Every subject gets a number. ${DEWEY.slice(0, 4).map(([r, s]) => `${r} ${s}`).join(' · ')} … and on to 999. Walk the aisles and read the hanging signs.`,
        height: 3.0,
        width: 2.6,
      },
    })
  );

  // Reading-room lighting. Hung at 9ft, not up at the clerestory: a light orb's
  // PointLight dies off over ORB_LIGHT_DISTANCE (16ft), so from 12ft up the floor is
  // already at the edge of its falloff and the aisles stay gloomy.
  for (const [x, z] of [[-14, -22], [14, -22], [0, -30], [-13, -38], [13, -38], [0, -46], [-16, -50], [16, -50]]) {
    items.push(orb(x, z, floor + 9, ORB_WARM));
  }

  // Approach. Off-axis, so it announces the building instead of hiding the entrance.
  items.push(
    prop('standing-sign', -25, -5, {
      rotY: 0.45,
      options: {
        lines: ['PUBLIC LIBRARY'],
        subtitle: 'OPEN TO EVERYONE · BRING NOTHING BUT YOURSELF',
        width: 12,
        height: 3,
        postHeight: 7.5,
        face: '#2b3f5c',
      },
    })
  );
  items.push(prop('book-drop', 13, -6, { rotY: -0.3 }));
  items.push(
    prop('info-placard', 21, -7, {
      rotY: -0.6,
      options: {
        eyebrow: 'After hours',
        title: 'The book return',
        body: 'Libraries lend about 2 billion items a year in the US alone. Almost all of them come back — usually through a slot like this one.',
      },
    })
  );

  items.push(prop('bench', -15, -7, { rotY: 0.2 }));
  items.push(prop('bench', -20, 2));
  items.push(prop('lamp-post', -24, 4));
  items.push(prop('lamp-post', 24, 4));
  items.push(prop('planter', -18, -10));
  items.push(prop('planter', 18, -10));
  items.push(prop('shade-tree', -34, 0, { options: { seed: 21, height: 24 } }));
  items.push(prop('shade-tree', 34, -2, { options: { seed: 33, height: 20 } }));
  items.push(prop('shade-tree', -40, -26, { options: { seed: 41, height: 26 } }));
  items.push(prop('shade-tree', 40, -30, { options: { seed: 52, height: 22 } }));

  // --- the way into 1940's New York ---------------------------------------------------
  //
  // The billboard behind the building is the ONLY route to that world: it is deliberately
  // absent from Load World (`hidden` in PRESET_WORLDS below), so this sign is its door.
  // Clicking it loads the world -- see worldPortal() in CommonProps.js and the reroute in
  // ObjectMenu.tryPick().
  //
  // The hall is 40ft deep centred on z = -34, on a stylobate that reaches z = -57, so the
  // sign stands at -78 and faces BACK toward the building. That is the orientation that
  // works: a student rounding either rear corner walks into the 20ft slot between the two
  // and meets the face square on, where a sign facing away from the building would show
  // them its blank back and nothing else.
  items.push(
    prop('world-portal', 0, -78, {
      options: {
        title: "1940's NEW YORK",
        subtitle: 'Broadway at Times Square, summer 1949 — walk the street, ride under the marquees, look up at BOND',
        world: 'newyork',
        accent: '#c1272d',
      },
    })
  );
  items.push(prop('lamp-post', -17, -70, { options: { height: 10 } }));
  items.push(prop('lamp-post', 17, -70, { options: { height: 10 } }));
  items.push(prop('bench', -11, -68, { rotY: Math.PI }));
  items.push(prop('bench', 11, -68, { rotY: Math.PI }));
  items.push(prop('planter', -20, -62));
  items.push(prop('planter', 20, -62));

  // A portal nobody finds is a portal nobody has. This is the only signpost to it, out
  // on the approach where every visitor to this world already walks.
  items.push(
    prop('standing-sign', 19, 5, {
      rotY: -0.5,
      options: {
        lines: ['TIME TRAVEL EXHIBIT'],
        subtitle: 'BEHIND THE LIBRARY · WALK AROUND THE BUILDING',
        width: 9,
        height: 2.6,
        postHeight: 7,
        face: '#5c1f22',
        accent: '#e0b64c',
      },
    })
  );

  return { theme: 'library', spawn: { x: 0, z: 16, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Moon
// ---------------------------------------------------------------------------

function moonLayout() {
  const items = [];

  // Set beside the spawn point, well clear of the hardware -- on the Moon a lit panel
  // against a black sky is the brightest thing in the world, and parked among the
  // hardware it would pull the eye off all of it.
  items.push(...browserStation(-8, 4, { faceX: 0, faceZ: 14 }));

  items.push(prop('lunar-module', 0, -30));
  items.push(prop('lunar-rover', 17, -17, { rotY: -0.9 }));
  items.push(prop('lunar-flag', -13, -19));
  items.push(prop('lunar-plaque', 7, -16, { rotY: 0.2 }));
  items.push(prop('alsep-station', -24, -33, { rotY: 0.5 }));

  items.push(
    activity(27, -10, {
      number: 1,
      rotY: -0.8,
      accent: '#2f6bd6',
      title: 'Take the buggy out for rock samples',
      target: 'Click the Moon buggy → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 12 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 12 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Six feet out, turn, six feet home. The real crews were never allowed to drive further than they could WALK back if it broke down — so keep your loops short.',
    })
  );
  items.push(
    activity(10, 2, {
      number: 2,
      rotY: -0.3,
      accent: '#b8471f',
      title: 'Set the Earth turning',
      target: 'Look up, click the Earth → Program.',
      steps: [ctrlStep('forever'), moveStep('rotate 0.5 degrees', 1)],
      tip: 'From here the Earth never rises and never sets — the Moon keeps one face toward us, so it just hangs there. It does still turn, though. One full spin every 24 hours.',
    })
  );
  items.push(prop('bootprint-trail', 6, -14, { rotY: 0.35, options: { count: 10, seed: 5 } }));
  items.push(prop('bootprint-trail', -7, -12, { rotY: -0.5, options: { count: 8, seed: 8 } }));
  items.push(prop('bootprint-trail', 12, -26, { rotY: 1.3, options: { count: 9, seed: 13 } }));

  // Earth: fixed in the lunar sky, because the Moon keeps one face toward us and so
  // Earth never rises or sets for anyone standing here. Held at about 24 degrees of
  // elevation from the spawn point -- high enough to read as "up there", low enough to
  // sit inside a 70 degree vertical field of view without being clipped by the top of
  // the screen the moment the world loads.
  items.push(prop('earth-in-sky', -72, -150, { y: 84, absoluteY: true, options: { radius: 26 } }));

  items.push(prop('moon-habitat', -52, 10, { rotY: 0.4 }));
  items.push(prop('solar-array', -24, 24, { rotY: -0.5 }));

  for (const [x, z, radius, seed] of [
    [-56, -62, 18, 3],
    [58, -40, 24, 7],
    [-78, 36, 15, 11],
    [40, -84, 20, 17],
    [46, 18, 13, 23],
  ]) {
    items.push(prop('moon-crater', x, z, { options: { radius, rimHeight: 1.4 + (seed % 4) * 0.25, seed } }));
  }

  for (const [x, z, count, spread, scale, seed] of [
    [26, -40, 10, 8, 1.0, 31],
    [-32, -18, 8, 7, 0.8, 37],
    [-32, -50, 12, 11, 1.3, 41],
    [34, 2, 9, 9, 1.1, 43],
    [8, -48, 7, 6, 0.7, 47],
  ]) {
    items.push(prop('moon-rocks', x, z, { options: { count, spread, scale, seed } }));
  }

  items.push(
    prop('standing-sign', -25, -7, {
      rotY: 0.5,
      options: {
        lines: ['TRANQUILITY BASE'],
        subtitle: 'APOLLO LANDING SITE · 1 / 6 EARTH GRAVITY · NO ATMOSPHERE',
        width: 13,
        height: 3.2,
        postHeight: 7.5,
        face: '#161a24',
        accent: '#7fb6ff',
      },
    })
  );

  const facts = [
    {
      x: -11, z: -5, rotY: 0.3,
      eyebrow: 'Look up',
      title: 'Why the sky is black',
      body: 'The Moon has almost no atmosphere. With no air to scatter sunlight, the sky stays black even at noon — and the stars never twinkle.',
    },
    {
      x: -16, z: -17, rotY: 0.9,
      eyebrow: 'The flag',
      title: 'It is not waving',
      body: 'No air means no wind. A horizontal rod along the top hem holds the flag out flat. The ripples are just creases from being rolled up.',
    },
    {
      x: 26, z: -26, rotY: -0.9,
      eyebrow: 'Lunar Roving Vehicle',
      title: 'The Moon buggy',
      body: 'About 10 feet long — twice your height. Wheels of woven piano wire, because rubber tyres would crack in vacuum. Top speed: 8 mph.',
    },
    {
      x: -17, z: -22, rotY: 0.6,
      eyebrow: 'Lunar Module',
      title: 'Two ships in one',
      body: 'Only the top half flew home. The gold foil is Kapton, wrapped on to keep the temperature steady between +250°F in sun and -280°F in shade.',
    },
    {
      x: 13, z: -8, rotY: -0.4,
      eyebrow: 'Footprints',
      title: 'They are still there',
      body: 'No wind, no rain, no running water. The prints left in 1969 could stay sharp for millions of years — only micrometeorites slowly erase them.',
    },
    {
      x: -33, z: -26, rotY: 0.9,
      eyebrow: 'ALSEP',
      title: 'Experiments still running',
      body: 'The mirror panel here reflects laser beams straight back to Earth. Scientists still fire at it, and have measured the Moon drifting 1.5 inches farther away each year.',
    },
    {
      x: -38, z: 28, rotY: -0.4,
      eyebrow: 'What comes next',
      title: 'Living here',
      body: 'A lunar day lasts about 29.5 Earth days — two weeks of sun, then two weeks of night. Any real base has to store power for all of it.',
    },
  ];
  for (const fact of facts) {
    items.push(prop('info-placard', fact.x, fact.z, { rotY: fact.rotY, options: fact }));
  }

  // Fill lights. Without an atmosphere there is no scattered light, so shadows here
  // are genuinely black -- these keep the shadowed sides of the hardware readable.
  // Hung low (5-6ft) and close in: an orb reads as a floating ball against a black sky
  // rather than as a lamp, so up high it looks like set dressing that escaped, and its
  // PointLight is nearly spent by the time it reaches the ground anyway.
  items.push(orb(7, -24, 5.5, ORB_WHITE));
  items.push(orb(-9, -27, 5.5, ORB_BLUE));
  items.push(orb(-30, 6, 6, ORB_BLUE));

  return { theme: 'moon', spawn: { x: 0, z: 14, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// On Mars
// ---------------------------------------------------------------------------

// A crewed outpost on a flat basin, built around one walk-in Habitation Dome. The dome
// is the hub and everything else radiates off it, so a student who gets lost can always
// find the dome on the skyline and walk back to it -- the same navigational trick the
// Park's single north-south axis plays.
//
// The dome's interior floor sits at GROUND LEVEL rather than on a raised stylobate like
// the museum's and the library's. The player walks on the terrain mesh, not on props,
// so a raised floor would leave a student's eye height sunk below the deck they appear
// to be standing on. Everything indoors is therefore placed at y = 0.
function marsLayout() {
  const items = [];

  // Dome centre. Radius 22, so its wall runs from z = 8 (front, with the airlock out to
  // z ~ 16) back to z = -36, and interior props are kept within ~16ft of this point.
  const domeX = 0;
  const domeZ = -14;
  const inside = (ox, oz) => [domeX + ox, domeZ + oz];
  // Points a prop at the dome's centre from its offset, so nothing indoors ends up
  // presenting its back to the room.
  const facingIn = (ox, oz) => Math.atan2(-ox, -oz);

  // Straight out to the left of the spawn point, on the walk in to the dome.
  items.push(...browserStation(-8, 24, { faceX: 0, faceZ: 34 }));

  items.push(prop('habitation-dome', domeX, domeZ, { options: { label: 'MARS BASE ONE' } }));

  // --- Inside: the grow bay, the crew berths, and life support ------------
  for (const [ox, oz, seed] of [
    [-13, -8, 5],
    [-8, -14, 11],
    [-15, 1, 17],
  ]) {
    const [x, z] = inside(ox, oz);
    items.push(prop('hydroponic-rack', x, z, { rotY: facingIn(ox, oz), options: { seed } }));
  }

  for (const [ox, oz] of [
    [13, -8],
    [15, 2],
  ]) {
    const [x, z] = inside(ox, oz);
    items.push(prop('bunk-pod', x, z, { rotY: facingIn(ox, oz) }));
  }

  items.push(prop('life-support-rack', ...inside(5, -15), { rotY: facingIn(5, -15) }));
  items.push(prop('command-console', ...inside(10, 9), { rotY: facingIn(10, 9) }));
  items.push(prop('bench', ...inside(-4, 3), { rotY: 0.4 }));
  items.push(prop('bench', ...inside(4, 3), { rotY: -0.4 }));

  const indoorFacts = [
    {
      x: -9, z: -15, rotY: 1.1,
      eyebrow: 'The grow bay',
      title: 'Dinner under pink light',
      body: 'No soil — the roots sit in nutrient water. The lights are magenta because plants only use the red and blue parts of sunlight; the green is reflected, which is why leaves look green.',
    },
    {
      x: -1, z: -24, rotY: -0.2,
      eyebrow: 'Life support',
      title: 'Oxygen out of thin air',
      body: 'Martian air is 95% carbon dioxide. Split CO₂ and you get carbon and the O₂ you breathe. NASA really did this on Mars in 2021, with an instrument the size of a toaster.',
    },
    {
      x: 11, z: -16, rotY: -1.0,
      eyebrow: 'Crew quarters',
      title: 'A day and a bit',
      body: 'A Martian day — a "sol" — is 24 hours 37 minutes. Close enough to sleep by, but the extra 37 minutes add up: crews drift a whole night out of step with Earth in about a month.',
    },
    {
      x: -7, z: 3, rotY: 0.3,
      eyebrow: 'Why the dome',
      title: 'The air is the problem',
      body: 'Outside, the pressure is under 1% of Earth\'s — so low that the water in your blood would boil. The dome is not for warmth. It is holding an atmosphere in.',
    },
  ];
  for (const fact of indoorFacts) {
    items.push(prop('info-placard', fact.x, fact.z, { rotY: fact.rotY, options: fact }));
  }

  // Interior lighting. Hung at 9ft: a light orb's PointLight is nearly spent by ~12ft
  // (ORB_LIGHT_DISTANCE with decay 2), so hanging these up at the 20ft apex would leave
  // the floor at the very edge of the falloff. The grow bay gets a rose orb to match
  // the LED bars it is lighting.
  items.push(orb(0, -14, 9, ORB_WARM));
  items.push(orb(-12, -20, 9, ORB_ROSE));
  items.push(orb(12, -18, 9, ORB_WARM));
  items.push(orb(2, -28, 9, ORB_WHITE));
  items.push(orb(0, -2, 9, ORB_WHITE));

  // --- The approach -------------------------------------------------------
  items.push(
    prop('standing-sign', -23, 22, {
      rotY: 0.45,
      options: {
        lines: ['MARS BASE ONE'],
        subtitle: 'ARES PLANITIA · SOL 412 · CREW OF SIX',
        width: 13,
        height: 3.2,
        postHeight: 7.5,
        face: '#3a1d12',
        accent: '#ff9a5c',
      },
    })
  );

  // --- Outside: the hardware that keeps the base alive --------------------
  items.push(prop('greenhouse-tunnel', -40, -8, { rotY: 0.4 }));
  items.push(prop('ice-drill-rig', 36, -32, { rotY: -0.6 }));
  items.push(prop('comms-relay', 30, 12, { rotY: -0.4 }));
  items.push(prop('mars-lander', -30, -48, { rotY: 0.7 }));
  items.push(prop('weather-mast', 26, -6));

  // Kept well clear of the greenhouse and the entrance sign: a three-panel array is
  // over 20ft across the booms, so a nominal 10ft gap between centres is still an
  // overlap, and a panel sails straight through whatever it was parked beside.
  items.push(prop('solar-array', -40, 26, { rotY: -0.4 }));
  items.push(prop('solar-array', -62, 6, { rotY: -0.15 }));
  items.push(prop('solar-array', -52, -34, { rotY: 0.3 }));

  // The rover, with its own tracks running back past the spawn point so a student
  // arrives standing in them and can follow them to the machine that made them.
  items.push(prop('mars-rover', 28, 22, { rotY: -0.9 }));
  items.push(prop('rover-tracks', 10, 36, { rotY: -0.9, options: { count: 20, seed: 7 } }));
  items.push(
    activity(36, 28, {
      number: 1,
      rotY: -2.3,
      accent: '#c2521f',
      title: 'Send the rover out on survey',
      target: 'Click the six-wheeled rover → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Real Mars rovers crawl. Curiosity averages about 100 feet an HOUR, because every step has to be checked from Earth first — and Earth is up to 22 light-minutes away.',
    })
  );
  items.push(prop('mars-helicopter', 16, 30, { rotY: 0.5 }));
  items.push(
    activity(8, 42, {
      number: 2,
      rotY: 0.3,
      accent: '#1f6b8a',
      title: 'Fly the scout copter',
      target: 'Click the little helicopter → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 10 times', 1),
        moveStep('move up by 0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
        ctrlStep('repeat 10 times', 1),
        moveStep('move up by -0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
      ],
      tip: 'Up four feet, hover, back down — a negative number in move up goes down. On Mars getting off the ground is the hard part: the air is so thin the blades have almost nothing to push against, which is why the real Ingenuity had to spin at 2,500 rpm.',
    })
  );

  // --- Landscape ----------------------------------------------------------
  items.push(prop('dust-devil', -76, -70, { options: { height: 46, radius: 7 } }));
  items.push(prop('dust-devil', 92, -34, { options: { height: 34, radius: 5 } }));

  for (const [x, z, radius, seed] of [
    [-60, 44, 20, 3],
    [70, -70, 26, 7],
    [-74, -60, 16, 11],
    [62, 50, 14, 17],
    [6, -96, 22, 23],
    [-96, 6, 18, 29],
  ]) {
    items.push(prop('mars-crater', x, z, { options: { radius, rimHeight: 1.3 + (seed % 4) * 0.3, seed } }));
  }

  for (const [x, z, count, spread, scale, seed] of [
    [-58, -28, 10, 9, 1.1, 31],
    [48, -8, 8, 7, 0.9, 37],
    [30, -60, 12, 11, 1.3, 41],
    [-40, 40, 9, 8, 1.0, 43],
    [56, 24, 7, 6, 0.8, 47],
    [-14, -70, 11, 10, 1.2, 53],
  ]) {
    items.push(prop('mars-rocks', x, z, { options: { count, spread, scale, seed } }));
  }

  // Horizon relief. These sit past the fog's midpoint on purpose: half-dissolved into
  // the dust haze is what stops the 400ft ground plane reading as a flat disc with an
  // edge, and it is also exactly how a real Martian horizon looks.
  items.push(prop('distant-mountain', -150, -165, { options: { height: 46, baseRadius: 130 } }));
  items.push(prop('distant-mountain', 155, -135, { options: { height: 34, baseRadius: 92, caldera: false, color: 0x8f5231 } }));
  items.push(prop('distant-mountain', -55, 178, { options: { height: 28, baseRadius: 80, caldera: false, color: 0x94573a } }));

  // Phobos, fixed in the south-eastern sky. Small and far out on purpose: it is only
  // about 14 miles across, and pushed in any closer it stops reading as a moon and
  // starts reading as a boulder someone left hanging over the base.
  items.push(prop('phobos-in-sky', 118, -228, { y: 138, absoluteY: true, options: { radius: 6 } }));

  // --- Fact placards ------------------------------------------------------
  const facts = [
    {
      x: -13, z: 17, rotY: 0.35,
      eyebrow: 'Welcome',
      title: 'You are a long way from home',
      body: 'Mars is between 34 and 250 million miles away depending on where the two planets are. Even the fast trips take about seven months each way.',
    },
    {
      x: 14, z: 22, rotY: -0.35,
      eyebrow: 'Look up',
      title: 'Why the sky is butterscotch',
      body: 'Fine dust in the air scatters the red end of sunlight all over the sky. The strange part: at sunset it flips, and the glow around the setting sun turns BLUE.',
    },
    {
      x: -26, z: 29, rotY: 0.5,
      eyebrow: 'Gravity',
      title: 'You would weigh a third',
      body: 'Mars pulls with about 38% of Earth\'s gravity. A 100-pound student weighs 38 pounds here — and could jump nearly three times as high.',
    },
    {
      x: -50, z: 34, rotY: 0.7,
      eyebrow: 'On the horizon',
      title: 'The biggest volcano anywhere',
      body: 'Olympus Mons is about 16 miles high and as wide as Arizona — but its slopes are so gentle that standing on it, you would never know you were on a mountain.',
    },
    {
      x: -34, z: 0, rotY: -1.1,
      eyebrow: 'The greenhouse',
      title: 'Farming without soil',
      body: 'Martian dirt contains perchlorates, which are poisonous to us. Crops here are grown in trays of water instead — and every plant also helps recycle the air.',
    },
    {
      x: 45, z: -24, rotY: -0.3,
      eyebrow: 'The drill',
      title: 'There is ice under your feet',
      body: 'Buried water ice covers much of Mars. It is drinking water, it is breathable oxygen, and split into hydrogen and oxygen it is rocket fuel for the trip home.',
    },
    {
      x: 22, z: 8, rotY: -0.6,
      eyebrow: 'The relay dish',
      title: 'Nobody phones home',
      body: 'A radio signal takes 3 to 22 minutes each way. Ask Earth a question and the answer is at best six minutes behind you, so crews send messages, not conversations.',
    },
    {
      x: -33, z: 14, rotY: -0.5,
      eyebrow: 'Power',
      title: 'Sunlight, and a dust problem',
      body: 'Mars gets less than half the sunlight Earth does, and dust settling on the panels steals more. Planet-wide dust storms can dim the sky for months at a time.',
    },
    {
      // On the far side of the rover: sat on the near side it stands squarely between
      // the spawn point and the machine it is describing.
      x: 38, z: 18, rotY: -2.2,
      eyebrow: 'The rover',
      title: 'Wheels made of metal',
      body: 'About 10 feet long — twice your height. The wheels are milled from aluminium, because rubber goes brittle at −100°F and would fall apart in the near-vacuum.',
    },
    {
      x: 21, z: 36, rotY: 0.2,
      eyebrow: 'The scout',
      title: 'First flight on another world',
      body: 'The air here is 1% as thick as Earth\'s, so the blades have to spin about 2,400 times a minute — five times a helicopter at home — to find anything to push against.',
    },
    {
      x: 20, z: 4, rotY: -0.4,
      eyebrow: 'The weather mast',
      title: 'Wind you would barely feel',
      body: 'A 60 mph Martian gale pushes about as hard as a 4 mph breeze on Earth, because there is so little air in it. The movie version of a Mars storm is fiction.',
    },
    {
      x: 39, z: 4, rotY: -0.8,
      eyebrow: 'Two moons',
      title: 'Phobos and Deimos',
      body: 'Both are tiny lumps, probably captured asteroids. Phobos races around so fast that it rises in the WEST and sets in the east — twice every single day.',
    },
    {
      x: -17, z: -39, rotY: 0.6,
      eyebrow: 'The cargo lander',
      title: 'How all this got here',
      body: 'Nothing was carried by the crew. Supplies are landed years ahead, unmanned, and checked from Earth — so the base is already built and working before anyone arrives.',
    },
    {
      x: 16, z: -34, rotY: -2.6,
      eyebrow: 'The calendar',
      title: 'A year that lasts 687 days',
      body: 'Mars is further out, so its orbit takes almost twice as long. You would have birthdays half as often — and each of the four seasons lasts about six Earth months.',
    },
    {
      x: -49, z: -46, rotY: 0.5,
      eyebrow: 'Geology',
      title: 'Why Mars is red',
      body: 'The dust is full of iron oxide. That is rust — the same thing that forms on an old bicycle, spread across an entire planet and blown into every corner of it.',
    },
  ];
  for (const fact of facts) {
    items.push(prop('info-placard', fact.x, fact.z, { rotY: fact.rotY, options: fact }));
  }

  // Fill light where the base genuinely goes dark: inside the greenhouse tunnel, under
  // the lander's deck, in the airlock mouth, and at the foot of the drill derrick.
  items.push(orb(-40, -8, 5, ORB_WARM));
  items.push(orb(-30, -42, 6, ORB_WHITE));
  items.push(orb(0, 14, 6, ORB_WARM));
  items.push(orb(36, -32, 7, ORB_WHITE));

  return { theme: 'mars', spawn: { x: 0, z: 34, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Dinosaur Island
// ---------------------------------------------------------------------------

// The very end of the Cretaceous, about 66 million years ago, on the sort of hot
// coastal floodplain the Hell Creek fossil beds record. Every animal placed here really
// did share that time and place with Tyrannosaurus -- which is itself the lesson, since
// the famous dinosaurs of the toy box mostly never met one another.
//
// The walk is staged on purpose. A field camp and a dig come FIRST, so a student learns
// how anybody knows any of this before meeting the animals; then the plant-eaters
// around the lagoon; and the boardwalk dead-ends at the T. rex, whose head is waiting
// at about the height the path stops.
function dinosaurLayout() {
  const items = [];

  // --- The field station ---------------------------------------------------
  items.push(
    prop('standing-sign', -19, 33, {
      rotY: 0.42,
      options: {
        lines: ['DINOSAUR ISLAND'],
        subtitle: 'HELL CREEK FIELD STATION · 66 MILLION YEARS AGO',
        width: 13,
        height: 3.2,
        postHeight: 7.5,
        face: '#1f3324',
        accent: '#e0b452',
      },
    })
  );

  // Beside the path down from the spawn point, before the camp.
  items.push(...browserStation(-8, 46, { faceX: 0, faceZ: 56 }));

  items.push(prop('field-camp', 0, 26));
  items.push(prop('bench', -8, 32, { rotY: Math.PI }));
  items.push(prop('bench', 8, 32, { rotY: Math.PI }));
  items.push(orb(-6, 24, 6, ORB_WARM));
  items.push(orb(6, 24, 6, ORB_WARM));
  items.push(orb(0, 30, 6, ORB_WARM));

  // --- Boardwalks ----------------------------------------------------------
  // The spine runs south from camp; two branches go east to the dig and west to the
  // lagoon. Same job the Park's single axis does: whichever way a student wanders,
  // getting back on the timber and turning always leads somewhere.
  for (const z of [14, 0, -14, -28]) items.push(prop('boardwalk', 0, z, { options: { seed: 23 + z } }));
  for (const x of [13, 26]) items.push(prop('boardwalk', x, 6, { rotY: Math.PI / 2, options: { seed: 41 + x } }));
  for (const x of [-13, -26]) items.push(prop('boardwalk', x, -14, { rotY: Math.PI / 2, options: { seed: 59 - x } }));

  items.push(
    prop('trail-sign', 5, 8, {
      options: {
        arms: [
          { label: 'THE DIG', angle: Math.PI / 2 },
          { label: 'LAGOON', angle: -Math.PI / 2 },
          { label: 'PREDATOR — KEEP BACK', angle: Math.PI },
        ],
      },
    })
  );

  // --- The dig -------------------------------------------------------------
  items.push(prop('fossil-dig', 34, 6, { rotY: 0.35 }));
  items.push(orb(30, 2, 6, ORB_WHITE));
  items.push(orb(39, 10, 6, ORB_WHITE));

  // --- The lagoon ----------------------------------------------------------
  items.push(prop('park-pond', -48, -18, { options: { radius: 17, seed: 29 } }));
  items.push(prop('horsetail-patch', -33, -12, { options: { count: 30, radius: 6, height: 8, seed: 11 } }));
  items.push(prop('horsetail-patch', -40, -34, { options: { count: 26, radius: 5, height: 7, seed: 13 } }));
  items.push(prop('horsetail-patch', -62, -8, { options: { count: 22, radius: 5, height: 6, seed: 17 } }));

  // --- The animals ---------------------------------------------------------
  // The predator closes the main axis, angled across the end of the boardwalk so its
  // head comes round to meet whoever is walking down it.
  items.push(prop('tyrannosaurus', 6, -50, { rotY: -1.1 }));
  items.push(prop('dino-tracks', 11, -26, { rotY: -1.1, options: { count: 8, stride: 6, seed: 5 } }));

  items.push(prop('triceratops', -32, -4, { rotY: -0.75 }));
  items.push(prop('edmontosaurus', -50, -38, { rotY: 1.15 }));
  items.push(prop('ankylosaurus', -24, -32, { rotY: 2.4 }));
  items.push(prop('pachycephalosaurus', 16, -21, { rotY: -1.25 }));
  items.push(prop('dino-nest', -13, -45, { rotY: 0.6 }));

  items.push(
    activity(-12, -8, {
      number: 1,
      rotY: 0.9,
      accent: '#2f8f5b',
      title: 'Set the Triceratops grazing',
      target: 'Click the Triceratops → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 15 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 15 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Fifteen feet out across the clearing, turn, fifteen feet back — a browsing animal working a patch of ferns. Add wait 0.3 seconds inside the loops and it stops to chew.',
    })
  );
  items.push(
    activity(6, -70, {
      number: 2,
      rotY: -0.1,
      accent: '#6b3fa0',
      title: 'Put the Quetzalcoatlus on patrol',
      target: 'Look up, click the pterosaur → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 40 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 40 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'A 33-foot wingspan does not flap much — it soars. Long, slow, steady passes look far more right than anything quick. Try adding move Y to make it ride a thermal.',
    })
  );

  // A pterosaur overhead. Held at about 46ft: high enough to read as flying, low enough
  // that its shadow still crosses the ground where students are walking.
  items.push(prop('quetzalcoatlus', 26, -56, { y: 46, rotY: -0.5, rotX: 0.12 }));

  // --- Landscape -----------------------------------------------------------
  // A smoking volcano on the horizon. The smoke is placed 40ft ABOVE the terrain at the
  // same spot, which lands it in the caldera -- the mountain is grounded the same way,
  // so the two stay together whatever the ground is doing out there.
  items.push(prop('distant-mountain', -135, -150, { options: { height: 46, baseRadius: 115, color: 0x4a4a3c } }));
  items.push(prop('volcanic-smoke', -135, -150, { y: 40, options: { height: 74, radius: 12, seed: 7 } }));
  items.push(prop('distant-mountain', 150, -125, { options: { height: 34, baseRadius: 92, caldera: false, color: 0x40563a } }));
  items.push(prop('distant-mountain', -55, 176, { options: { height: 28, baseRadius: 80, caldera: false, color: 0x3f5233 } }));

  for (const [x, z, count, spread, scale, seed] of [
    [22, -8, 9, 8, 1.2, 31],
    [-18, 12, 7, 6, 0.9, 37],
    [40, -40, 11, 10, 1.4, 41],
    [-60, 20, 8, 7, 1.1, 43],
    [12, -66, 9, 9, 1.3, 47],
  ]) {
    items.push(prop('jungle-rocks', x, z, { options: { count, spread, scale, seed } }));
  }

  // --- Planting ------------------------------------------------------------
  // Araucaria for the canopy, tree ferns and cycads for the understory. Nothing tall
  // within ~20ft of the spawn point or the T. rex: a 40ft conifer dropped next to
  // either one fills the screen and hides the thing the student came to see.
  const canopy = [
    [-30, 22, 42, 3], [34, 26, 38, 9], [-56, 6, 44, 14], [52, -6, 40, 21],
    [-42, -50, 46, 26], [46, -60, 39, 33], [-20, -70, 43, 38], [26, 40, 37, 45],
    [-70, -40, 41, 52], [70, -34, 44, 57], [-8, -84, 40, 61], [36, -80, 38, 67],
  ];
  for (const [x, z, height, seed] of canopy) {
    items.push(prop('araucaria-tree', x, z, { options: { height, seed } }));
  }

  const understory = [
    ['tree-fern', -16, 18, 15, 3], ['tree-fern', 15, 16, 13, 6], ['tree-fern', -22, -2, 16, 10],
    ['tree-fern', 20, -4, 14, 15], ['tree-fern', -14, -26, 15, 19], ['tree-fern', 28, -42, 17, 24],
    ['tree-fern', -36, -22, 14, 28], ['tree-fern', 34, -22, 16, 34], ['tree-fern', -6, -62, 15, 39],
    ['cycad', -26, 40, 7, 5], ['cycad', 14, 31, 6, 8], ['cycad', -26, -18, 7, 12],
    ['cycad', 32, -12, 6, 16], ['cycad', -18, -38, 8, 22], ['cycad', 18, -46, 7, 27],
    ['ginkgo-tree', -26, 10, 28, 7], ['ginkgo-tree', 18, 20, 25, 18], ['ginkgo-tree', -44, -8, 30, 25],
    ['ginkgo-tree', 42, -26, 27, 31], ['ginkgo-tree', -30, -58, 26, 36],
    ['magnolia-shrub', -12, 8, 9, 17], ['magnolia-shrub', 13, -30, 8, 23],
    ['magnolia-shrub', -36, -40, 10, 29], ['magnolia-shrub', 23, -6, 9, 35],
  ];
  for (const [kind, x, z, height, seed] of understory) {
    items.push(prop(kind, x, z, { options: { height, seed } }));
  }

  for (const [x, z, count, radius, seed] of [
    [-8, 6, 16, 6, 13], [9, -8, 14, 5, 21], [-20, -6, 18, 7, 27],
    [18, -30, 15, 6, 33], [-30, -46, 17, 7, 39], [8, -40, 16, 6, 45],
    [-46, 4, 14, 6, 51], [40, -14, 15, 6, 57],
  ]) {
    items.push(prop('fern-patch', x, z, { options: { count, radius, seed } }));
  }

  // Perimeter forest. Without it the island reads as an island of detail on an endless
  // green plain; a ring of 40ft conifers closes every view off, and each tree is one
  // merged draw call so it is cheap enough to be worth sixteen of them.
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + 0.3;
    const radius = 96 + ((i * 7) % 5) * 8;
    items.push(
      prop('araucaria-tree', Math.cos(angle) * radius, -18 + Math.sin(angle) * radius, {
        options: { height: 36 + ((i * 5) % 4) * 4, seed: 100 + i * 13 },
      })
    );
  }

  // --- Placards ------------------------------------------------------------
  const facts = [
    {
      x: -11, z: 37, rotY: 0.3,
      eyebrow: 'Where you are',
      title: 'The last day of the dinosaurs',
      body: 'Everything here lived about 66 million years ago, right at the end of the Cretaceous. Every animal on this island really did share that time and place — most famous dinosaurs never met each other.',
    },
    {
      x: 11, z: 37, rotY: -0.3,
      eyebrow: 'Deep time',
      title: 'Stegosaurus was already ancient',
      body: 'More time separates Stegosaurus from T. rex than separates T. rex from you. The Age of Dinosaurs lasted so long that its own history had ancient history.',
    },
    {
      x: -10, z: 17, rotY: 0.4,
      eyebrow: 'Underfoot',
      title: 'No grass anywhere',
      body: 'Grass had barely appeared. The green here is ferns, horsetails and moss — which is why almost every plant-eater on this island is built to browse low shrubs, not to graze a lawn.',
    },
    {
      x: 10, z: 17, rotY: -0.4,
      eyebrow: 'Something new',
      title: 'The first flowers',
      body: 'Flowering plants were a recent invention in the Cretaceous. The magnolias here are among the oldest kinds still alive — T. rex lived alongside the very first blossom.',
    },
    {
      x: 15, z: 19, rotY: -0.5,
      eyebrow: 'The dig',
      title: 'How anyone knows any of this',
      body: 'The string grid is not decoration. Every bone is drawn and measured inside its own square before it is lifted, because where a bone sat tells you as much as the bone does.',
    },
    {
      x: 39, z: 27, rotY: -2.6,
      eyebrow: 'The dig',
      title: 'How a fossil forms',
      body: 'An animal has to be buried fast — under river mud or sand — before it rots or is eaten. Minerals then seep in over millions of years. Almost nothing that dies ever becomes a fossil.',
    },
    {
      x: 24, z: -16, rotY: -1.5,
      eyebrow: 'The dig',
      title: 'Plaster jackets',
      body: 'Those white bundles are bones wrapped in plaster and burlap, exactly like a cast on a broken arm. It is the only way to move something that has been shattered for 66 million years.',
    },
    {
      x: -21, z: 2, rotY: 1.4,
      eyebrow: 'Triceratops',
      title: 'Three horns and a shield',
      body: 'The frill is bone, and the brow horns are over three feet long. They were probably used against rivals as much as against predators — plenty of frills carry healed wounds from other Triceratops.',
    },
    {
      x: -18, z: -14, rotY: 2.2,
      eyebrow: 'Ankylosaurus',
      title: 'A living tank',
      body: 'Armour plates set into the skin, spikes along both flanks, and a solid bone club on the tail heavy enough to break a leg. Even its eyelids were armoured.',
    },
    {
      x: -46, z: -18, rotY: 1.1,
      eyebrow: 'Edmontosaurus',
      title: 'What T. rex ate',
      body: 'Some Edmontosaurus fossils carry T. rex bite marks that HEALED. That is the strongest evidence we have that T. rex attacked living prey — and that sometimes the prey got away.',
    },
    {
      x: 9, z: -14, rotY: -1.2,
      eyebrow: 'Pachycephalosaurus',
      title: 'Ten inches of solid skull',
      body: 'Stand next to this one — it is about your height. The dome on its head is bone up to ten inches thick, probably for shoving contests with rivals rather than head-on charges.',
    },
    {
      x: 25, z: -31, rotY: -1.0,
      eyebrow: 'Footprints',
      title: 'What tracks tell you',
      body: 'A skeleton tells you how an animal was built. A trackway tells you what it did — how fast it walked, whether it travelled alone, and how it placed its feet.',
    },
    {
      x: -21, z: -43, rotY: 0.5,
      eyebrow: 'The nest',
      title: 'Dinosaur parents',
      body: 'Dinosaurs built nests, sat on their eggs and looked after what hatched. That behaviour is one of the strongest links between them and the birds outside your window.',
    },
    {
      x: 25, z: -65, rotY: -2.3,
      eyebrow: 'Tyrannosaurus rex',
      title: 'Thirteen feet at the hip',
      body: 'Nearly three times your height at the hip, and forty feet nose to tail. The biggest teeth found are about the size of a banana — and built like railway spikes, for crushing bone rather than slicing.',
    },
    {
      x: -13, z: -58, rotY: 1.1,
      eyebrow: 'Tyrannosaurus rex',
      title: 'Those arms are not a joke',
      body: 'They are shorter than yours, but each one could curl around 400 pounds. Nobody is certain what they were for — holding struggling prey and pushing up off the ground are the best guesses.',
    },
    {
      x: 33, z: -47, rotY: -1.9,
      eyebrow: 'Look up',
      title: 'That is not a dinosaur',
      body: 'Quetzalcoatlus is a pterosaur — a flying cousin, not a dinosaur. Its wings are skin stretched on one enormous finger. Standing on the ground it was as tall as a giraffe.',
    },
    {
      x: -36, z: 20, rotY: 0.9,
      eyebrow: 'Living fossil',
      title: 'You can go and touch one',
      body: 'The ginkgo here is near-identical to the ginkgo growing in car parks today. Whatever wiped out the dinosaurs, this tree walked straight through it unchanged.',
    },
    {
      x: -16, z: 4, rotY: 0.7,
      eyebrow: 'They are still here',
      title: 'Birds are dinosaurs',
      body: 'Not "descended from" — they ARE dinosaurs, the one branch that survived. Every sparrow is a closer relative of T. rex than T. rex was of Triceratops.',
    },
    {
      x: -39, z: 34, rotY: 0.8,
      eyebrow: 'What happens next',
      title: 'The worst day on Earth',
      body: 'An asteroid about six miles across strikes near what is now Mexico. Within hours the sky is on fire; within years the cold and dark end three quarters of all species. Everything you can see from here goes — except the birds.',
    },
  ];
  for (const fact of facts) {
    items.push(prop('info-placard', fact.x, fact.z, { rotY: fact.rotY, options: fact }));
  }

  // Light orbs where the canopy genuinely closes over: the fern hollow, the nest, and
  // either side of the predator at the end of the walk, which is otherwise the darkest
  // and most important thing in the world.
  items.push(orb(-13, -45, 6, ORB_WARM));
  items.push(orb(10, -40, 8, ORB_WARM));
  items.push(orb(-2, -52, 8, ORB_WARM));
  items.push(orb(-30, -10, 7, ORB_WHITE));

  // Set down ~20ft short of the camp's eaves, matching the approach the other worlds
  // give you. Spawning at z=40 put the student's head under the thatch looking at the
  // back wall, with no idea what the building they were inside even was.
  return { theme: 'dinosaur', spawn: { x: 0, z: 56, yaw: 0 }, items };
}
// One accent hue per body SYSTEM, and every exhibit belonging to that system wears it --
// the plinth's lit ring and name plate, the placards beside it, the activity board.
//
// It replaced a single teal used on all twenty-odd exhibits, and it is the cheapest
// legibility in the world: from the far end of the hall the only thing a student can resolve
// is a coloured ring, so a violet one means nervous system before a single word is readable,
// and the kidney exhibit and the urinary chart are visibly a pair.
const SYS = {
  respiratory: '#57c4e5',
  circulatory: '#ff5f6d',
  digestive: '#f4a83a',
  urinary: '#3fc09b',
  nervous: '#a78bfa',
  skeletal: '#d8cba6',
  cellular: '#e879b8',
  voyage: '#5fc9dd',
};

// "Fantastic Voyage" -- the human body as a walk-through exhibition hall.
//
// The four organs the brief named -- lungs, stomach, liver, kidneys -- stand on lit plinths
// in the four corners of the hall, each with its own placards, and the heart sits at the
// centre of them because it is what physically connects all four.
//
// Whole SYSTEMS are taught by the chart gallery at the far end rather than by more geometry.
// A system is a set of relationships -- what drains into what, what feeds what -- and a
// labelled drawing shows that far better than a model you can only walk around.
//
// WHAT IS NOT HERE MATTERS AS MUCH AS WHAT IS. The first pass filled the hall out with four
// park benches, the project's own logo banner reused as an entrance sign, two charts that
// duplicated exhibits standing a few feet away, and twenty-four light orbs. None of those is
// about human anatomy, and between them they were spending a real share of this world's
// budget: every orb is a per-fragment forward-pass cost on integrated graphics -- by far the
// most expensive thing in this world -- and every chart is a 768x1024 canvas texture out of
// shared system memory. They are gone, and the organs got the room.
function voyageLayout() {
  const items = [];

  // Every organ model is authored to stand on a plinth of this height, so the two travel
  // together: the plinth at ground level, the model lifted onto its top face.
  const PLINTH = 3;

  // A lit plinth + its organ, as one call. `label` is on the plinth's own name plates,
  // which is what makes an exhibit readable from across the hall before you can read the
  // placard beside it.
  const exhibit = (name, x, z, { label, sublabel, radius = 4.4, height = PLINTH, rotY = 0, accent, options } = {}) => {
    items.push(prop('organ-plinth', x, z, { options: { label, sublabel, radius, height, accent } }));
    items.push(prop(name, x, z, { y: height, rotY, options: options || {} }));
  };

  const placard = (x, z, rotY, eyebrow, title, body, accent = SYS.voyage) => {
    items.push(prop('info-placard', x, z, { rotY, options: { eyebrow, title, body, accent, width: 2.6 } }));
  };

  // --- Arrival: the premise ------------------------------------------------
  // OFF THE SIGHTLINE, not across it. A 15ft sign on 8ft posts standing 14ft dead ahead
  // subtends about 28 degrees either side and 25 degrees up, which is most of the frame --
  // so the first thing a student saw was a signboard, with the artery tunnel they are
  // supposed to walk into hidden behind it. Pushed to one side and turned to face the
  // spawn it is just as readable at 19ft and the way in is visible past it. This is the
  // same arithmetic that moved Whimsical World's welcome board and the twister's: a near
  // sign competes with a far landmark on ANGLE, and the fix is always to move the sign.
  items.push(
    prop('standing-sign', -13, 66, {
      rotY: 0.36,
      options: {
        lines: ['FANTASTIC VOYAGE'],
        subtitle: 'YOU HAVE BEEN MINIATURISED',
        width: 15,
        height: 3.4,
        postHeight: 8,
        face: '#12323d',
        accent: SYS.voyage,
      },
    })
  );

  // Right at the entrance, before the artery -- this is the one world where the walk in
  // is a corridor, so the panel has to be met before the student commits to it. On the
  // opposite side from the title sign, so neither hides the other.
  items.push(...browserStation(10, 73, { faceX: 0, faceZ: 82 }));

  items.push(prop('micro-sub', 18, 60, { rotY: -0.6 }));
  items.push(
    activity(8, 66, {
      number: 2,
      rotY: -0.35,
      accent: '#0f7d8c',
      title: 'Launch the micro-sub',
      target: 'Click the submarine → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 30 times', 1),
        moveStep('move forward 0.8 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 30 times', 1),
        moveStep('move forward 0.8 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Twenty-four feet down the hall and back. Swallowable pill-sized cameras have been doing the real version of this trip since 2001 — no crew, but a very long journey.',
    })
  );
  placard(
    10,
    51,
    -0.5,
    'Your ride',
    'Shrunk down and injected',
    'A 1966 film imagined a submarine and its crew miniaturised and injected into a patient. That part is still fiction — but swallowable pill-sized cameras have been photographing the inside of real intestines since 2001.'
  );

  placard(
    -8,
    53,
    0.35,
    'Scale',
    'Everything here is enlarged',
    'A real liver is the size of a football, and a kidney is the size of your fist. At life size you could not walk round any of it, so every model here is roughly fifteen to twenty times too big. Each sign tells you the real size.'
  );

  // --- Into the body through an artery ------------------------------------
  items.push(prop('artery-tunnel', 0, 42, { options: { length: 28, radius: 6.5 } }));
  // Spread wide and lifted clear of eye level: at a tighter radius the cells packed the
  // middle of the tunnel and the view straight down it was a wall of red discs.
  items.push(prop('blood-cells', 0, 48, { options: { count: 11, radius: 5, height: 9, seed: 5 } }));
  items.push(prop('blood-cells', 0, 35, { options: { count: 9, radius: 5, height: 9, seed: 19 } }));
  // Inside a tunnel the sun reaches nothing, so the light has to come from in there. Hung
  // at 5ft, not at the crown: an orb's PointLight is nearly spent by ~12ft. Two, not three
  // -- the tunnel is 28ft long and a light every 9ft was one more than it needed.
  for (const z of [50, 38]) items.push(orb(0, z, 5, ORB_ROSE));

  placard(
    9,
    26,
    -0.35,
    'Where you are',
    'Inside an artery',
    'Laid end to end, one person’s blood vessels would run about 60,000 miles — enough to wrap around the Earth twice. The biggest, the aorta, is about as wide as a garden hose. The smallest are narrower than one red blood cell.',
    SYS.circulatory
  );

  // --- Under the rib cage --------------------------------------------------
  items.push(prop('rib-cage-arch', 0, 14, { options: { span: 15, height: 13, pairs: 7 } }));
  items.push(orb(0, 14, 10, ORB_WHITE));
  placard(
    11,
    17,
    -0.8,
    'The rib cage',
    'A cage that has to breathe',
    'Twelve pairs of ribs, and they are not a fixed box — every rib swings up and out when you breathe in. Behind you they join the spine; in front, the top seven pairs join the breastbone through flexible cartilage, which is the pale blue-white part here.',
    SYS.skeletal
  );

  // --- The organ hall: the four primary organs -----------------------------
  exhibit('lungs-model', -22, -6, {
    label: 'Lungs',
    sublabel: 'RESPIRATORY SYSTEM',
    radius: 5.4,
    rotY: 0.35,
    accent: SYS.respiratory,
  });
  placard(
    -13,
    -0.5,
    0.65,
    'Lungs',
    'A folded-up tennis court',
    'Real lungs are about 10 inches tall. Inside are 300–500 million alveoli — tiny air sacs — and unfolded they would cover about 70 square metres, roughly a classroom floor. That is the surface oxygen crosses to reach your blood.',
    SYS.respiratory
  );
  placard(
    -32,
    -17,
    2.5,
    'Left and right',
    'They are not a matching pair',
    'The right lung has three lobes and the left only two — the heart takes the space where the third would be. The left one here is cut open so you can see the airway inside. That is also why an inhaled peanut nearly always ends up in the right lung: its bronchus is wider and steeper.',
    SYS.respiratory
  );
  // Behind the exhibit and low, not beside it. An orb is a visible glowing ball, and one
  // sitting a few feet off the lungs' flank reads as a bright artifact stuck to the model
  // rather than as lighting -- the same thing the observatory's armillary ran into.
  items.push(orb(-30, -12, 7, ORB_WHITE));

  items.push(prop('alveoli-cluster', -38, 5, { rotY: 0.5 }));
  placard(
    -29,
    11,
    0.5,
    'Zoom in',
    'Where the swap happens',
    'This is one alveolus and its blood vessels, blown up enormously. The wall between air and blood is about one five-hundredth of a millimetre thick — thin enough for oxygen to cross by simply drifting. Blue vessels arrive, red ones leave.',
    SYS.respiratory
  );

  exhibit('stomach-model', 22, -6, {
    label: 'Stomach',
    sublabel: 'DIGESTIVE SYSTEM',
    radius: 4.6,
    rotY: -0.35,
    accent: SYS.digestive,
  });
  placard(
    13,
    -0.5,
    -0.65,
    'Stomach',
    'A bag of acid that does not digest itself',
    'Stomach acid sits around pH 1.5–3.5 — strong enough to strip rust off steel. The reason it does not eat through you is a layer of mucus that the stomach lining replaces every few days.',
    SYS.digestive
  );
  placard(
    31,
    -9,
    -2.5,
    'How much fits',
    'Empty, it is fist-sized',
    'An empty stomach holds well under a cup. Full, it stretches to about four times that. This one is cut open so you can see the folds — the rugae — that unfold to let it. Food stays here two to four hours, then leaves a teaspoon at a time.',
    SYS.digestive
  );
  items.push(orb(28, 0, 8, ORB_WARM));

  items.push(prop('villi-patch', 36, 5, { options: { count: 46, radius: 6, seed: 11 } }));
  placard(
    28,
    12,
    -0.5,
    'Small intestine',
    'Lined with millions of fingers',
    'Almost all of your food is actually absorbed here, not in the stomach. The lining is covered in villi like these — magnified hugely — and they turn a 22-foot tube into about 30 square metres of absorbing surface.',
    SYS.digestive
  );

  exhibit('intestine-coil', 36, -18, {
    label: 'Intestines',
    sublabel: 'ABOUT 27 FEET OF TUBE',
    radius: 5.0,
    rotY: -0.7,
    accent: SYS.digestive,
  });
  // Off to the side rather than overhead: directly above the plinth an orb sat down
  // inside the top loops of the colon and read as a light bulb baked into the model.
  items.push(orb(30, -22, 8, ORB_WARM));
  placard(
    44,
    -13,
    -1.2,
    'Why it is lumpy',
    'Three ribbons pulling it in',
    'The large intestine has three ribbons of muscle running its whole length, and they are shorter than the tube they are on — so it puckers between them into that row of pouches. The little yellow tags hanging off it are fat.',
    SYS.digestive
  );

  // The heart at the centre, because it is the thing all four primary organs are
  // plumbed into.
  exhibit('heart-model', 0, -20, {
    label: 'Heart',
    sublabel: 'THE HUB OF ALL OF IT',
    radius: 4.2,
    height: 3.5,
    accent: SYS.circulatory,
  });
  placard(
    -7,
    -14,
    0.4,
    'Heart',
    'Your own fist, beating',
    'A heart is about the size of the owner’s clenched fist. It beats around 100,000 times a day and pushes roughly 7,500 litres of blood — enough to fill a small swimming pool every week, without ever taking a break.',
    SYS.circulatory
  );
  placard(
    7,
    -14,
    -0.4,
    'Two pumps in one',
    'Blue side, red side',
    'The right half pumps blood to the lungs to collect oxygen; the left half pumps it to everywhere else. The colour changes along the groove where the two halves meet — and the blue side is not cold, it is just carrying blood that has not been to the lungs yet.',
    SYS.circulatory
  );
  items.push(orb(-6, -25, 9, ORB_ROSE));
  items.push(orb(6, -25, 9, ORB_ROSE));
  items.push(
    activity(-13, -24, {
      number: 1,
      rotY: 0.55,
      accent: '#b8324a',
      title: 'Make the heart beat',
      target: 'Click the heart → Program.',
      steps: [
        ctrlStep('repeat 12 times'),
        lookStep('change size by 6 %', 1),
        ctrlStep('wait 0.3 seconds', 1),
        lookStep('change size by -6 %', 1),
        ctrlStep('wait 0.3 seconds', 1),
      ],
      tip: 'Squeeze, rest, squeeze, rest — about 100,000 times a day without a single break. Watch carefully and the heart ends up a shade smaller than it started: +6% then -6% does not quite cancel out. Percentages are sneaky like that.',
    })
  );

  exhibit('liver-model', -22, -36, {
    label: 'Liver',
    sublabel: 'THE CHEMICAL PLANT',
    radius: 4.8,
    rotY: 0.4,
    accent: SYS.digestive,
  });
  placard(
    -13,
    -31,
    0.8,
    'Liver',
    'Five hundred jobs at once',
    'The largest organ inside you, about 3 pounds and roughly football-sized. It cleans the blood arriving from your gut, stores energy, makes bile for digesting fat, and breaks down medicines — several hundred jobs in one lump of tissue.',
    SYS.digestive
  );
  placard(
    -30,
    -43,
    2.7,
    'Three pipes and a bag',
    'What goes in and out underneath',
    'Turn to the underside and there are three tubes: indigo is blood arriving from your gut, scarlet is blood arriving with oxygen, green is bile leaving. The green sac tucked into the liver is the gallbladder, which stores that bile until you eat something fatty.',
    SYS.digestive
  );
  items.push(orb(-28, -30, 8, ORB_WARM));

  exhibit('kidney-model', 22, -36, {
    label: 'Kidneys',
    sublabel: 'URINARY SYSTEM',
    radius: 4.6,
    rotY: -0.4,
    accent: SYS.urinary,
  });
  placard(
    13,
    -31,
    -0.8,
    'Kidneys',
    'Filtering the whole lot, 40 times a day',
    'Each kidney is fist-sized and holds about a million microscopic filters. Together they pull around 180 litres of fluid out of your blood every day — then put about 99% of it straight back. What is left is roughly 1.5 litres of urine.',
    SYS.urinary
  );
  placard(
    30,
    -43,
    -2.7,
    'Cut in half',
    'A pale rind over dark triangles',
    'One of these is sliced open. The pale outer rind is where the filtering happens; the dark triangles are bundles of tiny tubes all pointing inward, draining into the funnel in the middle and then down the ureter. The yellow caps on top are a different organ entirely — they make adrenaline.',
    SYS.urinary
  );
  items.push(orb(28, -30, 8, ORB_BLUE));

  // --- The far wings: brain, nerve, DNA, cell ------------------------------
  exhibit('brain-model', -42, -24, {
    label: 'Brain',
    sublabel: 'NERVOUS SYSTEM',
    radius: 3.8,
    rotY: 1.2,
    accent: SYS.nervous,
  });
  placard(
    -38,
    -13,
    1.0,
    'Brain',
    'Two per cent of you, twenty per cent of the fuel',
    'About 86 billion nerve cells, folded up so that three times as much surface fits inside your skull — those folds are what all the ridges and grooves are. It is only about 2% of your body weight but burns around 20% of the oxygen you breathe, even while you sleep.',
    SYS.nervous
  );
  items.push(orb(-42, -29, 8, ORB_BLUE));

  items.push(prop('neuron-model', -58, 6, { rotY: 1.35, options: { length: 24 } }));
  placard(
    -46,
    16,
    0.9,
    'One nerve cell',
    'Signals at 270 miles an hour',
    'Signals arrive on the branching end, travel down the long fibre, and are handed to the next cell at the tips. The pale sleeves are insulation — and the GAPS between them are the trick: the signal leaps from one gap to the next instead of crawling, up to 120 metres per second.',
    SYS.nervous
  );
  items.push(orb(-56, 2, 7, ORB_WHITE));

  items.push(prop('dna-helix', 46, -30, { options: { height: 22, turns: 3.2 } }));
  placard(
    45,
    -15,
    -1.1,
    'DNA',
    'Two metres, in every cell',
    'The flat plates in the middle are the four letters the whole instruction book is written in. Notice the two rails are not opposite each other — that offset is what leaves a wide groove and a narrow one, which is how the proteins that read DNA find their way along it.',
    SYS.cellular
  );
  items.push(orb(46, -34, 8, ORB_ROSE));

  items.push(prop('cell-model', -54, -40));
  placard(
    -45,
    -31,
    0.5,
    'One cell',
    'Thirty-seven trillion of these',
    'Every organ in this hall is built from cells like this one, opened up so you can see in. The purple ball is the nucleus holding the DNA — the dots on it are pores. The orange capsules are mitochondria, and those folds inside them are where the energy from your food is released.',
    SYS.cellular
  );
  items.push(orb(-54, -35, 8, ORB_BLUE));

  // --- The systems gallery -------------------------------------------------
  // The sign stands well FORWARD of the charts. Parked at the mouth of the gallery it
  // sat squarely across the master chart's caption, which is the one block of text on
  // it that has to be readable from standing height.
  items.push(
    prop('standing-sign', 0, -42, {
      options: {
        lines: ['THE SYSTEMS GALLERY'],
        subtitle: 'HOW THE PIECES JOIN UP',
        width: 13,
        height: 3,
        postHeight: 7.5,
        face: '#12323d',
        accent: SYS.voyage,
      },
    })
  );

  // The master map is wider than the rest and dead on the axis: it is the chart that
  // answers "where was the thing I just walked around, and what is it next to?"
  items.push(prop('anatomy-chart', 0, -64, { options: { chart: 'body-systems', width: 12 } }));

  // Nine-foot charts, so the x positions here are centres about 16ft apart -- roughly a
  // 7ft gap between neighbouring boards. Any tighter and the gallery reads as one long
  // wall of paper rather than as six things you go and look at one at a time.
  //
  // The 'kidney-section' and 'cell' charts that used to hang out on the wings are gone:
  // both drew in two dimensions what the rebuilt models now show in three, standing a few
  // feet away, and a diagram of a thing you can walk round is the weakest kind of exhibit
  // this world has. Their texture memory went to the organs.
  for (const [chart, x, z, rotY] of [
    ['respiratory', -34, -60, 0.34],
    ['circulatory', -18, -62, 0.16],
    ['digestive', 18, -62, -0.16],
    ['urinary', 34, -60, -0.34],
    ['nervous', -52, -54, 0.6],
    ['skeletal', 52, -54, -0.6],
  ]) {
    items.push(prop('anatomy-chart', x, z, { rotY, options: { chart, width: 9 } }));
  }

  // The gallery is a wall of cream paper at the dark end of the hall, so it gets its own
  // lighting rather than relying on the exhibits' orbs 30ft away.
  for (const [x, z] of [[-26, -56], [26, -56]]) {
    items.push(orb(x, z, 9, ORB_WHITE));
  }

  return { theme: 'voyage', spawn: { x: 0, z: 82, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Empty World -- somewhere to build
// ---------------------------------------------------------------------------

// The Park's own three tree builders, with the height range each one looks right at
// there. Reused rather than re-tuned: these are the trees a student already knows from
// the world they landed in, and an empty field planted with something else would read as
// a different place rather than as the same place with nothing in it yet.
const EMPTY_WORLD_TREES = [
  { kind: 'shade-tree', minHeight: 20, maxHeight: 26 },
  { kind: 'conifer-tree', minHeight: 22, maxHeight: 28 },
  { kind: 'flowering-tree', minHeight: 14, maxHeight: 18 },
];

const EMPTY_WORLD_SPAWN = { x: 0, z: 16, yaw: 0 };

// The three boards stand in a shallow arc BEYOND the build zone, all facing the spawn.
//
// Two numbers decide this. A student arrives at (0, 16) looking down -Z, and a fresh
// construction piece lands PRIMITIVE_SPAWN_DISTANCE (10ft) in front of them and spirals
// out from there -- so everything from the spawn to about z = 0 has to stay clear, or the
// boards are things to walk round while building, which is the one thing this world is
// for. And the camera's 70 degree fov is VERTICAL: a 16:9 screen sees about 51 degrees
// either side, so the outer two sit at about 31 degrees off the arrival sightline, well
// inside the frame but not stacked in the middle of it.
//
// z = -6 puts them 22ft away dead ahead and 26ft on the diagonals: far enough to read the
// headline and see there are three of them, close enough that walking up to one is a few
// steps rather than a journey.
const MY_WORLD_BOARD_Z = -6;
const MY_WORLD_BOARD_X = 15;

// Bigger than an activity board (6.4 x 5.5), because these carry a whole tutorial rather
// than one challenge, and because the type size follows from the board size: a student
// should be able to read the steps from where they arrive and walk up only to check a
// detail. The copy is cut to match -- a billboard carrying a web page's worth of prose
// forces the auto-fit down to a size nobody can read from anywhere.
const MY_WORLD_CARD = { width: 10, height: 8, postHeight: 11 };

// Faces the board at (x, z) toward the spawn. atan2(dx, dz), not atan2(dz, dx): a plain
// Object3D's +Z is its facing direction.
const facingSpawn = (x, z) => Math.atan2(EMPTY_WORLD_SPAWN.x - x, EMPTY_WORLD_SPAWN.z - z);

// An open green field of the student's own, with three boards at the far side of it: what
// this world is for, how to build something in it, and how to make that thing move.
//
// It used to hold nothing at all, on the grounds that anything standing here is an
// obstacle to walk round while building. That is still the rule -- which is why the
// boards are grouped together at the edge of the working area rather than dotted about,
// and why there is still no browser station, no placards and no activity boards. But an
// empty field tells a student who has just arrived nothing whatsoever about what to do
// with it, and the two tutorials that turn it into a workshop were only ever on a website
// they would have to leave the app to read.
//
// Five trees rather than none because a truly featureless plane has no landmarks at all,
// so walking any distance in it stops feeling like moving. They are also the only thing
// giving the ground a sense of scale.
function emptyLayout() {
  const items = [];

  // The welcome board is centred and lower than the two beside it, so the three read as
  // one group with a heading rather than as three competing signs.
  items.push(
    prop('welcome-board', 0, MY_WORLD_BOARD_Z, {
      rotY: facingSpawn(0, MY_WORLD_BOARD_Z),
      options: {
        eyebrow: '🌱  MY WORLD',
        lead: 'This is your world to:',
        lines: ['Build and program', 'YOUR OWN ideas in!'],
        footnote: 'Nobody else can change it — and it saves itself as you go',
      },
    })
  );

  // Building, on the left. Condensed from the Rocket tutorial in the Hands-On Guide
  // (docs/guide/tutorials.html) -- the same eight pieces in the same order, cut to what a
  // student can read off a board while standing in front of it. A billboard that tries to
  // carry a web page's worth of prose ends up carrying none of it.
  items.push(
    prop('tutorial-board', -MY_WORLD_BOARD_X, MY_WORLD_BOARD_Z, {
      rotY: facingSpawn(-MY_WORLD_BOARD_X, MY_WORLD_BOARD_Z),
      options: {
        kicker: '🔨  BUILD IT',
        number: 1,
        title: 'Build a Rocket',
        intro: 'Menu ▸ Create Model. Each piece lands in front of you in build yellow — click the hammer above it.',
        steps: [
          { lead: 'Body', text: 'A Cylinder. Drag a TOP corner up until it is 3× as tall as it is wide. White.' },
          { lead: 'Nose', text: 'A Sphere stretched into an egg. Lift it onto the body with the green ball. Red.' },
          { lead: 'Engine', text: 'A Cylinder squashed short, a little wider than the body. Dark grey.' },
          { lead: 'Four fins', text: 'A Cube squashed flat, slid against the bottom of the body. One per side. Red.' },
          { lead: 'Connect, then Render', text: 'Join every piece to the body, then press Render Model.' },
        ],
        tip: 'Fins are fiddly: walk round to the side you are working on first. The corner nearest you is always the easiest to grab.',
        accent: '#c2521f',
        ...MY_WORLD_CARD,
      },
    })
  );

  // Programming, on the right, as the blocks themselves. The chips are drawn from
  // BlockDefs' CATEGORIES, so the colours on the board are the colours in the palette.
  items.push(
    prop('tutorial-board', MY_WORLD_BOARD_X, MY_WORLD_BOARD_Z, {
      rotY: facingSpawn(MY_WORLD_BOARD_X, MY_WORLD_BOARD_Z),
      options: {
        kicker: '🧩  CODE IT',
        number: 2,
        title: 'Now fly it',
        intro: 'Click your rocket and choose Program. Drag these together — the indented two go inside forever — then press Save.',
        steps: [
          { lead: 'Change one number', text: 'Try 2 degrees. Try 90. Take the wait out. Changing a number and running it again is the whole skill.' },
          { lead: 'Then fly it', text: 'Swap the rotate for glide 12 feet over 2 seconds, and put a rotate 90 degrees under it.' },
        ],
        blocks: [
          { cat: 'control', text: 'forever' },
          { cat: 'motion', text: 'rotate 15 degrees', depth: 1 },
          { cat: 'control', text: 'wait 0.1 seconds', depth: 1 },
        ],
        tip: 'move forward and glide go the way your model is POINTING, so a rotate genuinely steers it. Four glides and four 90 degree turns draw a square — and 360 divided by any number of sides gives you that shape.',
        accent: '#6b3fa0',
        ...MY_WORLD_CARD,
      },
    })
  );

  // Randomised at BUILD time and then baked into the records, so every fresh load of
  // this world is a different field while reloading a saved one gives back exactly the
  // field the student left. That is why Math.random() is fine here and is not fine in a
  // prop builder, where a rebuild has to reproduce the geometry it produced last time.
  const count = 5;
  for (let i = 0; i < count; i++) {
    // An even sweep with jitter rather than a free-for-all: five independent random
    // bearings leave a 3% chance of every tree landing behind the student, who then
    // arrives facing the emptiest possible view of an already empty world.
    const angle = ((i + Math.random() * 0.7) / count) * Math.PI * 2;
    const radius = 34 + Math.random() * 46; // far enough back that none frames the spawn
    const { kind, minHeight, maxHeight } = EMPTY_WORLD_TREES[Math.floor(Math.random() * EMPTY_WORLD_TREES.length)];
    items.push(
      prop(kind, EMPTY_WORLD_SPAWN.x + Math.cos(angle) * radius, EMPTY_WORLD_SPAWN.z + Math.sin(angle) * radius, {
        options: {
          height: minHeight + Math.random() * (maxHeight - minHeight),
          seed: Math.floor(Math.random() * 1000),
        },
      })
    );
  }

  return { theme: 'default', spawn: { ...EMPTY_WORLD_SPAWN }, items };
}

// ---------------------------------------------------------------------------
// 1940's New York -- Broadway at Times Square, summer 1949
// ---------------------------------------------------------------------------

// Modelled from a colour photograph of Times Square looking north, taken while "The
// Barkleys of Broadway" was on at Loew's State -- which dates it to the summer of 1949.
//
// The whole layout is one avenue running north (-Z) with a single cross street, and every
// number below hangs off three lines:
//
//   * the ROADWAY is x = -17..17, the SIDEWALKS x = +/-17..27, the BUILDING FACES x = +/-27.
//   * a west-side building faces east, so it is placed at x = -(27 + depth/2) with
//     rotY = +PI/2; an east-side one mirrors that with -PI/2. CityProps authors every
//     building and vehicle facing +Z.
//   * anything standing ON the sidewalk is placed at y = WALK, because the sidewalk is a
//     6in slab of its own and the terrain is underneath it. Vehicles get y = ROAD.
//
// A 54ft gap between facades is narrower than the real Broadway and that is deliberate.
// The camera's 70 degree fov is VERTICAL -- a 16:9 screen sees about 51 degrees either
// side -- so at the true width the marquee across the street sits outside the frame and a
// student arrives looking at empty road. At 54ft it fills the left of the view on arrival,
// which is what the photograph does.
//
// The scale reference throughout is the crowd in that photograph, per the brief: no people
// are modelled anywhere in this world, but every height here is set against the ones in
// the picture. The cab roof is chest-high, the marquee clears the sidewalk by two of them,
// and the Bond statues stand four storeys up.
const NY_WALK = 0.5; // top of the sidewalk slab -- see cityStreet()
const NY_ROAD = 0.12; // top of the asphalt slab
// Two feet off the kerb rather than back against the shopfronts, and the reason is the
// awnings: they reach 6.4ft out from the wall at 11ft up, so a spawn tucked against the
// building puts the whole sky behind a canvas roof and the student arrives in a dark box.
// Turned 14 degrees west rather than straight up the sidewalk, and that small angle does
// three things at once: it swings the marquee across the street from the edge of the frame
// into it, puts BOND almost dead ahead at the end of the view, and takes the nearest lamp
// post off the exact centre of the screen, where it was standing in front of the activity
// board like a bollard.
const NY_SPAWN = { x: 19, z: 48, yaw: 0.25 };

// The lamp line: three feet in from the kerb, which clears the shop awnings overhead and
// still lets the crook hang its lamp four feet out over the roadway.
const NY_WEST_WALK = -20;
const NY_EAST_WALK = 20;

function newYorkLayout() {
  const items = [];
  const west = (depth) => -(27 + depth / 2);
  const east = (depth) => 27 + depth / 2;
  const W = Math.PI / 2; // a west-side building turns its face east
  const E = -Math.PI / 2;

  // --- the street ------------------------------------------------------------------------
  // Offset to z = 10 so the single cross street lands at world z = -42 and the block the
  // student spawns in is the long one. `crossings` are in the prop's own frame.
  items.push(
    prop('city-street', 0, 10, {
      options: { length: 190, roadWidth: 34, walkWidth: 10, crossings: [-52], seed: 5 },
    })
  );

  // --- primary model 2: the Barkleys of Broadway theatre --------------------------------
  // Straight across the street and 46ft up the block, which puts its marquee 40 degrees
  // off the arrival sightline at 60ft -- the same framing rule the browser stations use.
  items.push(prop('broadway-theatre', west(30), 0, { rotY: W, options: { width: 48, depth: 30, height: 96, seed: 15 } }));

  // --- primary model 3: BOND ---------------------------------------------------------------
  // Squarely at the head of the avenue, across the cross street, so the whole view
  // terminates on it. Its face lands at z = -70; the roadway and the sidewalk behind that
  // line run on under the building, which costs nothing and saves cutting the slab.
  items.push(prop('bond-building', 0, -86, { options: { width: 54, depth: 32, seed: 27 } }));

  // --- the rest of the west side ------------------------------------------------------------
  items.push(prop('storefront-row', west(18), 42, {
    rotY: W,
    options: { length: 32, depth: 18, height: 24, shops: ['DRUGS', 'HABERDASHER', 'LUNCHEONETTE'], seed: 33 },
  }));
  items.push(prop('city-building', west(28), 78, {
    rotY: W,
    options: { width: 36, depth: 28, height: 62, style: 'brick', seed: 44 },
  }));
  // The Hotel Astor's copper mansard, showing past BOND's left shoulder.
  items.push(prop('city-building', -45, -84, {
    rotY: W,
    options: { width: 46, depth: 36, height: 74, style: 'mansard', seed: 51 },
  }));
  items.push(prop('city-building', -66, -44, {
    rotY: W,
    options: { width: 36, depth: 30, height: 68, style: 'stone', seed: 58 },
  }));

  // --- the east side --------------------------------------------------------------------------
  items.push(prop('theatre-front', east(26), 4, {
    rotY: E,
    options: {
      width: 44, depth: 26, height: 52, wallColor: 0xa4906f,
      marqueeFace: '#a8202b',
      marqueeLines: [
        { text: 'HOME OF THE BRAVE', size: 0.34, color: '#f7f1de' },
        { text: 'PRODUCED BY STANLEY KRAMER  ·  RELEASED THRU UNITED ARTISTS', size: 0.12, color: '#ffd766' },
      ],
      bladeText: 'ASTOR',
      bladeFace: '#123a6b',
      bladeHeight: 22,
      seed: 19,
    },
  }));
  items.push(prop('storefront-row', east(18), 44, {
    rotY: E,
    options: { length: 30, depth: 18, height: 26, shops: ['CAFETERIA', 'HATS', 'SHOE REPAIR'], seed: 62 },
  }));
  items.push(prop('city-building', east(30), 80, {
    rotY: E,
    options: { width: 34, depth: 30, height: 70, style: 'stone', seed: 66 },
  }));
  // The distant setback tower, showing past BOND's right shoulder.
  items.push(prop('city-building', 47, -82, {
    rotY: E,
    options: { width: 40, depth: 40, height: 124, style: 'setback', seed: 71 },
  }));
  items.push(prop('city-building', 62, -44, {
    rotY: E,
    options: { width: 36, depth: 30, height: 66, style: 'brick', seed: 74 },
  }));

  // --- background skyline ------------------------------------------------------------------------
  // Taller than everything on the block, and set well back, so they read as the next
  // streets over rather than as this one. Without them the sky comes down to the rooftops
  // and a 400ft ground plane reads as a film set.
  // `detail: 'far'` on every one of these. A window a student can walk up to is worth a
  // frame, a mullion, a transom, a moulded sill and a lintel; one on the next street over
  // at a hundred and thirty feet is worth its reveal and a sill, and nothing else survives
  // the distance anyway. Eight towers multiply that difference by eight.
  for (const [x, z, w, d, h, style, seed] of [
    [-80, 26, 44, 44, 118, 'setback', 81],
    [-76, -14, 40, 40, 96, 'stone', 84],
    [-94, 84, 48, 48, 128, 'setback', 87],
    [80, 22, 42, 42, 104, 'stone', 90],
    [88, -14, 38, 38, 88, 'brick', 93],
    [92, 82, 44, 44, 112, 'setback', 96],
    [-30, 128, 46, 40, 92, 'stone', 99],
    [34, 132, 42, 40, 84, 'brick', 102],
  ]) {
    items.push(prop('city-building', x, z, { options: { width: w, depth: d, height: h, style, detail: 'far', seed } }));
  }

  // --- primary model 4: the street lights -----------------------------------------------------
  // The crook reaches along the prop's +X, so a west-side lamp needs no rotation and an
  // east-side one is turned through 180 degrees to hang its lamp over the roadway.
  //
  // Two placement rules, both found by an overlap sweep rather than by eye:
  //
  //  * They stand at x = +/-20, three feet in from the kerb, NOT at 22. The shop awnings
  //    reach out to x = 22 at 11ft up, so a lamp on the 22 line grows straight through
  //    one -- and the awning hides the crook, which is the whole point of the object.
  //  * NOTHING between z = -20 and z = 23. That band is the two theatre marquees, which
  //    project 8-9ft over the sidewalk at 11-19ft up; a 21ft lamp post inside one goes
  //    through the roof of it. The block is well lit by the marquees themselves anyway.
  //
  // Only three carry a real PointLight -- see the note in bishopCrookLamp(). The rest are
  // lit glass, which is all that reads from 60ft in daylight, and it keeps this world off
  // a dozen point lights on a machine that has to pay for each one per fragment.
  for (const [z, lit] of [[88, false], [60, true], [32, true], [-22, true], [-72, false]]) {
    items.push(prop('bishop-crook-lamp', NY_WEST_WALK, z, { y: NY_WALK, options: { light: lit } }));
    items.push(prop('bishop-crook-lamp', NY_EAST_WALK, z, { y: NY_WALK, rotY: Math.PI, options: { light: lit && z === 32 } }));
  }

  // --- primary model 1: the yellow taxi, and the traffic around it -----------------------------
  // Northbound traffic keeps to x < 0 and faces -Z (rotY = PI); southbound mirrors it.
  // The hero cab is stopped mid-block 24ft from the spawn, FACING the student, so the
  // grille, the headlights, the whitewalls and the roof flag are all the first thing seen.
  //
  // FIVE cars, down from ten. The rebuild made each one about nine times the model it was,
  // and a street packed kerb to kerb spends that entirely on cars a student never walks up
  // to -- while also hiding the road, the kerbs and the markings under a solid rank of
  // metal. Five is enough to read as traffic: two lanes occupied, one car facing the
  // student, one going the other way, and one far enough up the block to give the avenue
  // some depth. The two the activity boards name are both still here, which is the one
  // constraint that is not a matter of taste.
  items.push(prop('taxi-cab', 12, 24, { y: NY_ROAD, options: { fleetNumber: '2-B-71', seed: 7 } }));
  items.push(prop('taxi-cab', -13, 6, { y: NY_ROAD, rotY: Math.PI, options: { fleetNumber: '4-A-19', seed: 11 } }));
  items.push(prop('taxi-cab', 13, -26, { y: NY_ROAD, options: { fleetNumber: '1-C-08', seed: 13 } }));

  // The two-tone sedan in the foreground of the photograph -- cream over red.
  items.push(prop('sedan-car', 5, 40, { y: NY_ROAD, options: { bodyColor: 0xb8342a, topColor: 0xe6dcc2, seed: 5 } }));
  items.push(prop('sedan-car', -5, -8, { y: NY_ROAD, rotY: Math.PI, options: { bodyColor: 0x232a38, seed: 9 } }));

  // The bus is deliberately kept: it is a different vehicle, it is the only thing on the
  // street that gives the cars a size to be judged against, and it is parked far enough up
  // the block that it costs the near view nothing.
  items.push(prop('city-bus', -13, -46, { y: NY_ROAD, rotY: Math.PI, options: { route: '7  BROADWAY', seed: 4 } }));

  // --- street furniture ---------------------------------------------------------------------------
  // ONE signal, on the east corner of the crossing. The south side of this block is
  // theatre frontage end to end, and a 17ft signal head standing on it ends up inside the
  // Barkleys marquee; the west corner is where the way home stands, and a signal post ten
  // feet in front of that billboard hid half of it. Neither of those shows up as a box
  // overlap -- the second one only turned up by standing where a student stands and
  // looking, which is the same lesson the activity boards taught in the other worlds.
  items.push(prop('traffic-signal', 20, -62, { y: NY_WALK }));
  items.push(prop('street-sign', 20.5, -18, { y: NY_WALK, rotY: -0.3, options: { street: 'W 45 ST', notice: 'NO STANDING' } }));
  items.push(prop('street-sign', -20.5, -83, { y: NY_WALK, rotY: 2.9, options: { street: 'BROADWAY', notice: 'ONE WAY' } }));
  items.push(prop('fire-hydrant', 24, 56, { y: NY_WALK }));
  items.push(prop('fire-hydrant', -24, 80, { y: NY_WALK }));
  items.push(prop('newsstand', -24, 68, { y: NY_WALK, rotY: W }));
  items.push(prop('subway-entrance', -22.5, 48, { y: NY_WALK, rotY: Math.PI, options: { label: 'SUBWAY' } }));

  // Painted wall advertising, hung on the facades either side. Mounted just clear of the
  // face line (x = +/-26.6) and turned to match the wall it hangs on.
  items.push(prop('wall-sign', 26.6, 6, {
    y: 34, rotY: E,
    options: { width: 22, height: 7, face: '#7d1c26', lines: [
      { text: 'ASTORIA', size: 0.42, color: '#ffd766' },
      { text: '4 BIG ACTS  ·  DANCING NIGHTLY', size: 0.16, color: '#f7f1de' },
    ] },
  }));
  items.push(prop('wall-sign', -26.6, 78, {
    y: 32, rotY: W,
    options: { width: 20, height: 6.5, face: '#14355e', lines: [
      { text: 'TWO TROUSER SUITS', size: 0.28, color: '#f7f1de' },
      { text: '$38.50', size: 0.36, color: '#ffd766' },
    ] },
  }));
  items.push(prop('wall-sign', 26.6, 80, {
    y: 30, rotY: E,
    options: { width: 20, height: 6, face: '#1d4a2e', lines: [
      { text: 'TIMES SQ. CAFETERIA', size: 0.3, color: '#f7f1de' },
      { text: 'OPEN ALL NIGHT', size: 0.2, color: '#ffd766' },
    ] },
  }));

  // --- the way home -----------------------------------------------------------------------------------
  // The return half of the pair in the Library. A one-way door would strand a student here
  // with only the menu to get out, and the menu is exactly what this world is not in.
  // On the corner plaza under BOND, not beside the spawn. Two reasons: a door home right
  // where you arrive is a door most students press before they have seen anything, and the
  // whole 45ft of sidewalk in front of the theatre is under its marquee, which is the one
  // stretch of this world where a 12ft billboard has nowhere to stand.
  items.push(prop('world-portal', -24, -67, {
    y: NY_WALK,
    rotY: 0.12,
    options: {
      title: 'THE LIBRARY',
      subtitle: 'Back to the reading room — the billboard behind the building brings you here again',
      world: 'library',
      accent: '#1f6b8a',
      width: 11,
      height: 6.4,
      postHeight: 11.5,
    },
  }));

  // --- placards ---------------------------------------------------------------------------------------
  items.push(prop('info-placard', 24, 4, {
    y: NY_WALK, rotY: 0.5,
    options: {
      eyebrow: 'At the curb',
      title: 'Why the cabs are yellow',
      body: 'A Chicago cab owner read a study saying yellow was the easiest colour to pick out at a distance, and painted his whole fleet. New York followed. This one is about 17 feet long — a foot longer than a modern taxi, and a foot taller.',
    },
  }));
  items.push(prop('info-placard', -24, 40, {
    y: NY_WALK, rotY: -0.5,
    options: {
      eyebrow: 'Look up',
      title: "The bishop's crook",
      body: 'Cast iron, twenty-one feet to the curl, with the lamp hung out over the roadway so the light lands on the street and not on the sidewalk. New York put up thousands of them from the 1890s; a few hundred are still standing.',
    },
  }));
  items.push(prop('info-placard', -24, -78, {
    y: NY_WALK, rotY: 0.15,
    options: {
      eyebrow: 'Straight ahead',
      title: 'The BOND sign',
      body: 'Two stone figures four storeys up, a lit disc between them, and letters you could read from six blocks away. Times Square was already the brightest place in America — the signs were lit in broad daylight, which is why they are lit here too.',
    },
  }));
  items.push(prop('info-placard', 24, 72, {
    y: NY_WALK, rotY: 0.2,
    options: {
      eyebrow: 'Summer 1949',
      title: 'What is playing',
      body: '"The Barkleys of Broadway" put Fred Astaire and Ginger Rogers back together after ten years apart, and it was the only film they made in colour. Across the street, "Home of the Brave" had opened three weeks earlier.',
    },
  }));

  // --- the two programming activities ---------------------------------------------------------------
  // Both target objects a student can actually PICK. That is a placement rule, not a
  // detail: the cabs are separate records from the street they stand on, which is exactly
  // why the Park's geese had to be split out of the pond.
  items.push(
    activity(24, 12, {
      number: 1,
      y: NY_WALK,
      rotY: 0.45,
      accent: '#e0a022',
      title: 'Send the yellow cab down Broadway and back',
      target: 'Click the taxi stopped in the road → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 20 times', 1),
        moveStep('move forward 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Both loops say the same thing, because move forward follows whichever way the cab is pointing right now — and the rotate 180 in the middle is what turns it round. Try wait 0.05 seconds inside a loop to slow it to a crawl.',
    })
  );
  items.push(
    activity(-24, 26, {
      number: 2,
      y: NY_WALK,
      rotY: -0.45,
      accent: '#c1272d',
      title: 'Fill the avenue with cabs',
      target: 'Click the taxi coming up the near lane → Program.',
      steps: [
        ctrlStep('repeat 3 times'),
        ctrlStep('duplicate 9 ft away', 1),
        ctrlStep('wait 0.5 seconds', 1),
      ],
      tip: 'Duplicate always drops the copy to the EAST, so the rank marches across the road toward you. Each copy comes out a little further along, which is why three of them do not land in a heap. The copies do not duplicate themselves — that is on purpose.',
    })
  );

  // --- the browser station -----------------------------------------------------------------------------
  items.push(...browserStation(24, 34, { faceX: NY_SPAWN.x, faceZ: NY_SPAWN.z, y: NY_WALK }));

  return { theme: 'newyork', spawn: { ...NY_SPAWN }, items };
}

// ---------------------------------------------------------------------------
// Under the Sea -- a tropical coral reef, thirty feet down
// ---------------------------------------------------------------------------

// Modelled from a photograph of a reef wall: a shark cruising over open water on the
// right, a moray looking out of a cave in the middle, an octopus down on the rubble to the
// left, and sea stars on the sand in the foreground.
//
// THE WHOLE COMPOSITION IS THE PHOTOGRAPH'S. A reef in real life is a wall with open water
// beside it, and the pairing is what makes either half work: the reef alone is a wall of
// clutter with nowhere to stand back and look at it from, and the open sand alone is a
// desert. So the reef mass runs across the front-left of the arrival view and the sand
// opens out to the right, which is also where the shark is -- the one thing in this world
// that needs empty water around it to read at all.
//
// Three numbers this hangs off:
//
//  * The SPAWN is at z = 24 facing just west of north, which puts the reef's near edge
//    about 40ft off -- inside this theme's 34ft fog start, so it arrives already softened
//    by water rather than as a hard-edged model. Turned 9 degrees west for the same reason
//    1940's New York is turned 14: it swings the reef mass off the frame edge and into the
//    view without putting it dead centre.
//  * Anything meant to be SWIMMING is placed with a `y`, which this file reads as feet
//    above the sea floor. The sharks are at 15-20ft, which is over a student's head by
//    three times and is the single strongest reminder that this is a volume and not a
//    field.
//  * The WATER SURFACE is at 46ft. High enough that the shafts have room to be long and
//    the sharks have room to be under it, low enough that it is unmistakably a lid.
const SEA_SPAWN = { x: 0, z: 20, yaw: 0.16 };
const SEA_CEILING = 46;

function seaLayout() {
  const items = [];

  // --- being under water --------------------------------------------------------------
  // These four carry no information and teach nothing; they are what stops the world from
  // being a blue field with fish standing in it. See the notes at the foot of SeaProps.js.
  items.push(prop('water-surface', 0, 0, { options: { size: 360, height: SEA_CEILING } }));
  items.push(prop('light-shafts', -10, -20, { options: { count: 4, height: SEA_CEILING, spread: 24, width: 9, seed: 103, opacity: 0.22 } }));
  items.push(prop('light-shafts', 28, 2, { options: { count: 3, height: SEA_CEILING, spread: 18, width: 8, seed: 211, opacity: 0.18 } }));
  items.push(prop('light-shafts', -34, -50, { options: { count: 3, height: SEA_CEILING, spread: 22, width: 11, seed: 307, opacity: 0.16 } }));
  items.push(prop('marine-snow', 0, 8, { options: { radius: 48, height: 32, count: 420, seed: 109 } }));
  items.push(prop('marine-snow', -14, -40, { options: { radius: 44, height: 30, count: 320, seed: 113 } }));
  items.push(prop('bubble-column', -3.5, -22, { options: { height: 18, count: 30, radius: 1.4, seed: 107 } }));
  items.push(prop('bubble-column', 27, -19, { y: 2, options: { height: 13, count: 20, radius: 1.0, seed: 127 } }));

  // --- the reef wall --------------------------------------------------------------------
  // An arc of mounds curving from the west round to the east, with a second broken ridge
  // behind it. The gap between the two is what gives the world somewhere to swim INTO --
  // one solid wall of coral would be a fence.
  //
  // THEY ARE TALL, and the first pass was not. At 5-6ft the mounds sat below a student's
  // eye line and the whole thing read as a scatter of boulders on a plain; a reef is a WALL
  // you cannot see over, and everything else about this world -- the cave in it, the shark
  // cruising along it, the sense of there being a somewhere-else on the far side -- depends
  // on it being one.
  //
  // Each front-ridge mound carries a coral garden DRAPED OVER IT (see `mound` in
  // coralGarden). Without that the gardens all sat on the sand around the rocks' feet and
  // the rocks themselves stayed bare grey, which is exactly backwards: on a real reef the
  // rock IS old coral and barely a square inch of it is uncovered.
  // THE HEIGHTS ARE UP BY ABOUT A THIRD on the two ridges, and the two small heads by the
  // spawn are deliberately left alone.
  //
  // A ten-foot mound thirty-five feet away stands under ten degrees above a 5ft student's eye
  // line, which is a rock, not a reef. What the arrival view has to say is that there is a
  // WALL of coral in front of you and a somewhere-else on the far side of it -- the cave in
  // it, the shark cruising along it and the open sand beside it all depend on that reading.
  // Height costs nothing here either: a bommie's triangle count goes with its RADIUS, since
  // that is what sets the crust count and the shell's ring spacing.
  const bommies = [
    [-42, -14, 9, 14, 401, 30], [-28, -15, 8, 15, 409, 28], [-18, -21, 7, 11, 419, 24],
    [13, -25, 8, 14, 431, 28], [24, -19, 7, 11.5, 439, 24], [33, -13, 6, 9, 443, 20],
    [-36, -38, 8, 12.5, 449, 24], [-16, -46, 7, 11, 457, 22], [6, -50, 8, 12.5, 463, 24],
    [27, -43, 7, 10.5, 467, 20], [44, -30, 7, 11, 479, 20], [-50, -24, 8, 12.5, 487, 22],
    [-32, 3, 4, 3, 491, 12], [31, -1, 3.5, 2.5, 493, 10],
  ];
  for (const [x, z, radius, height, seed, count] of bommies) {
    items.push(prop('coral-bommie', x, z, { options: { radius, height, seed } }));
    // `mound` is the mound's OWN height, not a fraction of it: coralGarden and coralBommie
    // now share one height function (see moundHeight in SeaProps), so the garden lands on the
    // rock exactly, and the small settling allowance is inside that function rather than
    // being fudged here.
    //
    // The counts are up by about half, because with the colonies actually ON the rock the
    // mound is what a student looks at rather than something they look past. Colonies are
    // still smaller than on open sand: a garden draped over a nine-foot rock is seen against
    // the rock, so a colony sized for open sand looks like a slab stuck on rather than
    // something growing out of it.
    items.push(prop('coral-garden', x, z, {
      options: {
        radius, count: Math.round(count * 1.25), height: height > 6 ? 0.95 : 0.76,
        mound: height, seed: seed + 1,
      },
    }));
  }

  // --- primary model 2: the moray's cave ------------------------------------------------
  // The cave and the eel are TWO objects, and deliberately: anything a student is invited
  // to click and program has to be a thing they can pick, and an eel modelled into the rock
  // would select the whole reef. Same decision, same reason, as the Park's geese.
  // The cave's mouth is 5ft wide and 4.8ft tall with a 5ft recess behind it, so the eel is
  // placed to put its head just proud of the rock at about mouth-centre height, with a good
  // three feet of body still down the hole. See reefCave() for how the recess is built.
  items.push(prop('reef-cave', -5, -21, { options: { width: 17, height: 11, mouth: 5.5, mouthHeight: 6.5, recess: 5, seed: 43 } }));
  // The cave gets a garden like every other mound. Bare rock around a hole reads as a
  // quarry; a real ledge mouth is as encrusted as everything else on the reef.
  // The cave is NOT a bommie -- its rock is a ring of lumps round a hole, not a dome -- so
  // this garden is draped lower and wider than the mound's own dimensions suggest. Sized to
  // the rock's full height it hangs colonies over the cave mouth, in mid-water.
  items.push(prop('coral-garden', -5, -21, { options: { radius: 10, count: 34, height: 1.0, mound: 6.5, seed: 44 } }));
  items.push(prop('moray-eel', -5, -19.6, { y: 1.1, rotY: 0.12, options: { length: 8.5, seed: 11 } }));
  items.push(
    prop('info-placard', -14, -9, {
      rotY: 0.8,
      options: {
        eyebrow: 'Green moray eel',
        title: 'Why its mouth never closes',
        body: 'It is not snarling. A moray has no gill covers to pump water with, so it has to gape to breathe — that open mouth is the animal taking a breath, over and over, all day. This one is about 6 feet of the 8 it grows to; the rest is still down the hole.',
      },
    })
  );

  // --- primary model 3: the octopus -----------------------------------------------------
  // Down on the rubble at the reef's foot, on the left, facing back toward the arrival
  // point so a student meets its eye rather than its mantle.
  items.push(prop('octopus', -21, -7, { rotY: 0.56, options: { span: 6.8, seed: 17 } }));
  items.push(
    prop('info-placard', -28, -3, {
      rotY: 0.65,
      options: {
        eyebrow: 'Common octopus',
        title: 'Nine brains and no bones',
        body: 'Two thirds of its neurons are in the arms, so each one solves its own problems while the head thinks about something else. With no skeleton at all, an octopus this size — about 7 feet across — can pour itself through a hole the width of its own eye.',
      },
    })
  );

  // --- primary model 1: the sharks ------------------------------------------------------
  // Over the open sand to the east, high enough to pass well over a student's head. The
  // second one is much further out and smaller, and it is doing a job: a single animal at a
  // known size gives the fog nothing to measure itself against, and a second one half-lost
  // in it is what makes the water read as deep.
  items.push(prop('reef-shark', 21, -25, { y: 18, rotY: -2.05, rotX: 0.08, options: { length: 8.5, seed: 5 } }));
  items.push(prop('reef-shark', -26, -60, { y: 21, rotY: 1.15, rotX: -0.05, options: { length: 7, seed: 23 } }));
  items.push(
    prop('info-placard', 15, -2, {
      rotY: -0.6,
      options: {
        eyebrow: 'Caribbean reef shark',
        title: 'It cannot stop swimming',
        body: 'Water has to keep moving over its gills, so it swims even while it sleeps — which is why the fins are always held out like wings. At 8 feet it is longer than a bed, and it eats fish. Divers on this reef swim with them every day.',
      },
    })
  );

  // --- primary model 4: the sea stars ----------------------------------------------------
  // On the open sand in the foreground, where the photograph has them: they are the one
  // thing here a student has to crouch to look at, which is the whole point of putting them
  // where somebody walking to the reef will step over one.
  items.push(prop('starfish', -7, 9, { rotY: 0.4, options: { size: 2.2, color: 0xd4392c, seed: 23 } }));
  items.push(prop('starfish', 8, 3, { rotY: -1.1, options: { size: 2.0, color: 0x3f78c8, seed: 29 } }));
  items.push(prop('starfish', 17, -8, { rotY: 2.2, options: { size: 1.6, color: 0xe08a2c, seed: 31 } }));
  items.push(prop('starfish', -24, 6, { rotY: 1.6, options: { size: 1.8, color: 0xc04a86, seed: 37 } }));
  items.push(
    prop('info-placard', -14.5, 13.5, {
      rotY: 0.7,
      options: {
        eyebrow: 'Sea stars',
        title: 'No head, no blood, no brain',
        body: 'It walks on hundreds of tiny water-powered feet under each arm, and it pumps sea water instead of blood. Lose an arm and it grows another. Most reef sea stars are hand-sized; the sunflower star of the Pacific reaches 3 feet across.',
      },
    })
  );

  // --- the anemone and its clownfish ------------------------------------------------------
  items.push(prop('sea-anemone', 7, -15, { options: { radius: 3.1, tentacles: 130, seed: 61 } }));
  // Above and just outside the crown, not inside it: placed at the anemone's own radius the
  // fish were completely swallowed by 130 tentacles, and a clownfish nobody can see is not
  // worth the anemone it came with.
  items.push(prop('clownfish-school', 7, -15, { y: 3.2, options: { count: 8, radius: 3.6, height: 2.4, seed: 97 } }));
  items.push(
    prop('info-placard', 14.5, -6.5, {
      rotY: -0.85,
      options: {
        eyebrow: 'Clownfish and anemone',
        title: 'A deal between two animals',
        body: 'Those tentacles sting every other fish that touches them. The clownfish wears a coat of mucus that stops them firing, so it gets a house nothing can follow it into — and in return it chases off the fish that eat anemones. Neither one survives long alone.',
      },
    })
  );

  // --- coral on the sand ---------------------------------------------------------------
  // Rubble gardens in the gaps between the mounds, at sea-floor level. Each is one draw
  // call, so the reef can be genuinely crowded without the frame budget noticing.
  const gardens = [
    [-34, -13, 6, 20, 0.9, 501], [-24, -18, 5, 16, 0.85, 509], [-11, -27, 5, 16, 0.8, 521],
    [4, -30, 5, 16, 0.85, 523], [19, -24, 5, 16, 0.85, 541], [30, -14, 5, 16, 0.8, 547],
    [-44, -18, 5, 16, 0.85, 557], [-26, -31, 5, 16, 0.9, 563], [-5, -40, 5, 16, 0.85, 569],
    [17, -38, 5, 16, 0.85, 571], [37, -20, 4, 12, 0.75, 577], [-13, -6, 4, 11, 0.6, 587],
    [10, -12, 3.5, 10, 0.55, 593], [-22, 1, 3.5, 10, 0.5, 599], [24, 4, 3.5, 10, 0.5, 601],
    // In the near field, between the spawn and the reef. Without these a student arrives
    // looking across thirty-five feet of bare floor, which is a third of the screen doing
    // nothing -- and worse, it puts everything worth seeing at a distance rather than
    // within reach. Kept low and sparse so nothing blocks the walk in.
    // Note the HEIGHT, not the count. Dropped to 0.4 these came out as scattered coloured
    // chips -- a colony a few inches across has no shape left to read, so a drift of them
    // looks like litter on the sand rather than like life on it. Fewer and bigger.
    [-9, 11, 4, 6, 1.15, 607], [15, 12, 4, 6, 1.1, 613], [-19, 6, 3.5, 5, 1.05, 617],
    [4, 2, 3, 4, 1.0, 619], [26, -3, 3.5, 5, 1.05, 631],
  ];
  // The five gardens between the spawn and the reef take a MUTED palette. A sand flat is not
  // a reef wall: the species that live out on open carbonate sand are drab -- olives, ochres,
  // dull rose -- and a handful of full-strength reef colours scattered across bare pale sand
  // reads as litter dropped on it rather than as life growing out of it. The reef's own
  // colour then arrives all at once when a student reaches the wall, which is the point.
  const SAND_PALETTE = [0x9a8b5c, 0xa8905e, 0x8d9464, 0xb09a72, 0x9c7e72, 0xa38a86, 0x7f8f74];
  for (const [x, z, radius, count, height, seed] of gardens) {
    items.push(prop('coral-garden', x, z, {
      options: { radius, count, height, seed, ...(z > 0 ? { palette: SAND_PALETTE } : {}) },
    }));
  }

  // Specimen colonies, big enough to be worth walking up to.
  items.push(prop('brain-coral', -13, -13, { options: { radius: 2.6, seed: 53, color: 0xcbb44f } }));
  items.push(prop('brain-coral', 20, -22, { options: { radius: 2.1, seed: 151, color: 0xc98a5a } }));
  items.push(prop('brain-coral', -31, -27, { options: { radius: 2.4, seed: 157, color: 0xb5a86a } }));
  items.push(
    prop('info-placard', -7.5, -11.5, {
      rotY: 0.25,
      options: {
        eyebrow: 'Brain coral',
        title: 'An animal that builds rock',
        body: 'Every groove holds a row of tiny animals, each one no bigger than a pinhead, and together they lay down limestone about half an inch a year. A boulder this size has been growing since before your great-grandparents were born.',
      },
    })
  );

  // Sea fans, all turned the same way. They feed by filtering water that passes through
  // them, so a real colony grows broadside to the current -- and a group of them facing
  // different ways is one of those mistakes that reads as wrong without being nameable.
  const FAN_YAW = 0.35;
  for (const [x, z, width, height, color, seed] of [
    [-35, -18, 5.5, 6.5, 0xb44a8e, 59], [-38, -14, 4.5, 5.5, 0xa48ec4, 161],
    [-32, -22, 5, 6, 0xcf5f78, 163], [30, -13, 4.5, 5.5, 0xb44a8e, 167],
    [-9, -33, 5, 6, 0xa48ec4, 173], [22, -35, 4.5, 5, 0xcf5f78, 179],
  ]) {
    items.push(prop('sea-fan', x, z, { rotY: FAN_YAW, options: { width, height, color, seed } }));
  }

  // Sponges, clams, urchins and cucumbers -- the reef's small change.
  items.push(prop('tube-sponge', -22, -20, { options: { count: 5, height: 3.4, color: 0xe0752a, seed: 67 } }));
  items.push(prop('tube-sponge', 10, -20, { options: { count: 4, height: 2.8, color: 0xc4508f, seed: 181 } }));
  items.push(prop('tube-sponge', -44, -12, { options: { count: 5, height: 3.6, color: 0xd85a30, seed: 191 } }));
  items.push(prop('tube-sponge', 31, -25, { options: { count: 3, height: 2.6, color: 0xe0a83a, seed: 193 } }));

  items.push(prop('giant-clam', -10, -3, { rotY: 0.5, options: { size: 3.0, seed: 71, mantle: 0x2fa0a8 } }));
  items.push(prop('giant-clam', 23, -12, { rotY: -1.2, options: { size: 2.4, seed: 197, mantle: 0x7a5fc0 } }));
  items.push(
    prop('info-placard', -16, 0, {
      rotY: 1.2,
      options: {
        eyebrow: 'Giant clam',
        title: 'It farms its own food',
        body: 'The blue frill is not decoration — it is a garden. Millions of algae live inside it, and the clam grows them for sugar the way a farmer grows a crop. The biggest species reaches four feet and lives over a hundred years.',
      },
    })
  );

  for (const [x, z, radius, seed] of [
    [-22, 3, 0.7, 73], [15, -16, 0.6, 199], [-31, -7, 0.65, 211], [29, -8, 0.55, 223], [2, -12, 0.6, 227],
    [-11, 7, 0.5, 239], [12, 7, 0.55, 241], [21, -2, 0.45, 251],
  ]) {
    items.push(prop('sea-urchin', x, z, { options: { radius, spines: 50, seed } }));
  }
  items.push(prop('sea-cucumber', 20, 1, { rotY: 0.8, options: { length: 2.6, seed: 79 } }));
  items.push(prop('sea-cucumber', -18, 2, { rotY: -0.4, options: { length: 2.2, seed: 229, color: 0x6b4a58 } }));
  items.push(prop('sea-cucumber', 33, -16, { rotY: 1.9, options: { length: 2.4, seed: 233 } }));

  // Seagrass on the open sand, and a taller stand of it out at the world's edge where it
  // has the same job the Park's perimeter woodland does: closing off the view so a 400ft
  // plane never shows a student where it ends.
  items.push(prop('seagrass-patch', 30, 12, { options: { radius: 7, count: 70, height: 2.2, seed: 83 } }));
  items.push(prop('seagrass-patch', -28, 15, { options: { radius: 6, count: 60, height: 2.0, seed: 239 } }));
  items.push(prop('seagrass-patch', 12, 20, { options: { radius: 5, count: 45, height: 1.8, seed: 241 } }));
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.4;
    const radius = 92 + ((i * 7) % 4) * 9;
    items.push(
      prop('seagrass-patch', Math.cos(angle) * radius, -14 + Math.sin(angle) * radius, {
        options: { radius: 11, count: 46, height: 7 + (i % 3) * 1.6, seed: 251 + i * 13, color: 0x3f6b40, drift: 0.65 },
      })
    );
  }

  // --- fish ---------------------------------------------------------------------------------
  // Spread through the whole volume rather than laid out on the floor, because that is the
  // difference between a world with fish in it and a world that is under water.
  const schools = [
    ['tang', 9, 5, -30, 5, 0.95, 4.5, 0.7, 89],
    ['yellow', 7, -20, -26, 4, 0.85, 4, -0.5, 311],
    ['anthias', 12, -30, -10, 9, 0.55, 4.5, 1.2, 313],
    ['damsel', 11, 3, -14, 3, 0.42, 3, 2.1, 317],
    ['butterfly', 6, 25, -30, 6, 0.75, 3.5, -1.4, 331],
    ['tang', 8, -40, -30, 11, 0.9, 5, 0.2, 337],
    ['anthias', 13, 16, -44, 7, 0.5, 5, 2.6, 347],
    ['damsel', 10, -12, -36, 4, 0.45, 3.5, -2.2, 349],
    ['yellow', 6, 34, -34, 8, 0.8, 4, 1.7, 353],
  ];
  for (const [species, count, x, z, y, length, radius, heading, seed] of schools) {
    items.push(prop('reef-fish-school', x, z, { y, options: { species, count, length, radius, heading, seed, rise: 4 } }));
  }

  // --- the browser station and the way home -----------------------------------------------
  items.push(...browserStation(7, 9, { faceX: SEA_SPAWN.x, faceZ: SEA_SPAWN.z }));

  // The return half of the pair behind the Park's nature centre. Out on the open sand to
  // the east rather than beside the spawn: a door home right where you arrive is a door
  // most students press before they have seen anything.
  items.push(
    prop('world-portal', 44, 14, {
      rotY: -Math.PI / 2,
      options: {
        title: 'THE PARK',
        subtitle: 'Back up to dry land — the meadow, the pond and the bandstand',
        world: 'park',
        accent: '#2f8f5b',
        face: '#123043',
      },
    })
  );

  // --- activities ---------------------------------------------------------------------------
  items.push(
    activity(44, -4, {
      number: 1,
      rotY: -1.48,
      accent: '#1f7fa8',
      title: 'Send the shark on patrol',
      target: 'Click the big shark overhead → Program. (Look up — it is 18 feet above you.)',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 40 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 40 times', 1),
        moveStep('move forward 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Twenty feet out, turn, twenty feet back. move forward goes the way the shark is POINTING, so the rotate is what actually sends it home — take it out and the shark just keeps going in one direction for ever.',
    })
  );
  items.push(
    activity(-44, 6, {
      number: 2,
      rotY: 1.88,
      accent: '#b4552a',
      title: 'Make the octopus change colour',
      target: 'Click the octopus on the rubble → Program.',
      steps: [
        ctrlStep('forever'),
        lookStep('change color to red', 1),
        ctrlStep('wait 1 seconds', 1),
        lookStep('change color to white', 1),
        ctrlStep('wait 1 seconds', 1),
      ],
      tip: 'A real octopus does this in about a fifth of a second, using millions of tiny colour sacs in its skin called chromatophores — and it does it while being colour-blind. Add a third colour and shorten the waits to see how fast you can make it flicker.',
    })
  );

  // --- lighting -------------------------------------------------------------------------------
  // ONE orb in the whole world, and it is DEEP INSIDE the moray's cave rather than in
  // front of it -- so what a student sees through the mouth is a faint glow somewhere back
  // in the rock, which is worth having, and never the lamp itself.
  //
  // The first pass had five spread through the reef and every one of them read as a
  // glowing ball hanging in mid-water -- which is the Moon's lesson (`against a black sky a
  // high orb reads as a floating ball rather than as a lamp`) with no roof anywhere to
  // rescue it. Open water gives a light source nothing to be attached to. The fix is to use
  // almost none and let the theme's very high hemisphere fill do the work instead, which is
  // also what really lights a reef.
  // Behind the cave's back wall, not inside the chamber. Orbs do not cast shadows here, so
  // the light passes through the rock and lifts the recess off pure black while the glowing
  // core itself is buried in the mound and can never be seen from anywhere.
  items.push(orb(-5, -29, 2.2, ORB_WHITE));

  return { theme: 'sea', spawn: { ...SEA_SPAWN }, items };
}

// ---------------------------------------------------------------------------
// Ancient Egypt -- the Giza plateau
// ---------------------------------------------------------------------------

// Everything here is built at ONE consistent 1:5 (see the note at the top of
// EgyptProps.js). At true size the Great Pyramid's base alone is 756ft -- wider than the
// entire walkable world, which is clamped to a 195ft radius -- and the monuments stand a
// quarter-mile apart. What survives 1:5 is every proportion a student can actually
// compare, and those are the lesson: Menkaure is less than half the height of the other
// two; the Sphinx is about as long as Menkaure's base is wide; Khafre only LOOKS taller
// than Khufu because it stands on higher ground. Each placard states the real dimension.
//
// The composition is the photograph everyone has seen: the Sphinx in the near ground with
// Khafre rising directly behind it. That is why Khafre sits on the centre line and Khufu,
// which is really the bigger one, is offset to the left where its size can be compared
// rather than blocked.
function egyptLayout() {
  const items = [];

  // --- The Sphinx and its enclosure ---------------------------------------
  // Facing +Z, back toward the spawn. The real Sphinx faces east toward the sunrise; here
  // it faces the arrival, because a monument whose entire identity is its FACE cannot be
  // introduced back-on. The causeway behind it runs to Khafre exactly as the real one does.
  items.push(prop('great-sphinx', 0, 34, { rotY: 0 }));

  // The Dream Stela stands between the real Sphinx's paws -- Thutmose IV's account of
  // falling asleep in its shadow and being told to dig it out of the sand. Placed just
  // ahead of the paws instead of between them, where it can actually be read.
  items.push(prop('stela', 0, 63, { rotY: 0, options: { width: 5, height: 9, seed: 31 } }));

  items.push(
    prop('info-placard', -9, 62, {
      rotY: 0.16,
      options: {
        eyebrow: 'c. 2500 BC',
        title: 'The Great Sphinx',
        accent: '#8c6b3f',
        body:
          'Really 240ft long and 66ft tall — carved from one ridge of limestone left standing when the quarry around it was cut away. It is not built from blocks. The head is much too small for the body because it is cut from a harder layer of rock that has worn away far more slowly. The nose has been missing for centuries, and the plaited beard is in a museum.',
      },
    }),
  );

  // The valley temple, south-east of the Sphinx, where the real one is. Bare Aswan granite
  // with no carving at all -- the deliberate contrast with every other surface here.
  items.push(prop('valley-temple', -34, 46, { rotY: 0.16 }));
  items.push(
    prop('info-placard', -22, 56, {
      rotY: 0.34,
      options: {
        eyebrow: 'Khafre’s valley temple',
        title: 'Stone with nothing written on it',
        accent: '#7d5044',
        body:
          'Most Egyptian buildings are covered in carving. This one is completely plain: square granite piers and slab lintels, and not one hieroglyph. The granite was floated 500 miles down the Nile from Aswan. Some blocks weigh 200 tons.',
      },
    }),
  );

  // --- The three pyramids -------------------------------------------------
  // Khafre on the centre line, directly behind the Sphinx, with its casing cap.
  items.push(
    prop('giza-pyramid', 6, -68, {
      options: { baseWidth: 706 / 5, height: 471 / 5, courses: 32, capHeight: 471 / 5 * 0.22, seed: 61 },
    }),
  );
  items.push(
    prop('cartouche-plaque', 6, -8, {
      rotY: -0.05,
      options: { label: 'KHAFRE', sub: 'Really 471 ft tall — the cap is its original casing' },
    }),
  );

  // Khufu, the Great Pyramid, offset left. Bigger than Khafre and standing on lower
  // ground, which is the whole comparison.
  items.push(
    prop('giza-pyramid', -112, -46, {
      options: { baseWidth: 756 / 5, height: 481 / 5, courses: 36, seed: 67 },
    }),
  );
  items.push(
    prop('cartouche-plaque', -96, 16, {
      rotY: 0.76,
      options: { label: 'KHUFU', sub: 'Really 481 ft — 2.3 million blocks' },
    }),
  );

  // Menkaure, right and much smaller, with its granite lower courses.
  items.push(
    prop('giza-pyramid', 118, -18, {
      options: { baseWidth: 344 / 5, height: 213 / 5, courses: 22, graniteCourses: 4, seed: 71 },
    }),
  );
  items.push(
    prop('cartouche-plaque', 104, 24, {
      rotY: -0.84,
      options: { label: 'MENKAURE', sub: 'Really 213 ft — under half its neighbours' },
    }),
  );

  // The queens' pyramids -- three small satellites beside Menkaure, as at the real site.
  // They also give the eye something to measure the big ones against.
  for (let i = 0; i < 3; i++) {
    items.push(
      prop('giza-pyramid', 138 - i * 22, 22 + i * 5, {
        options: { baseWidth: 8.5 - i * 0.7, height: 5.6 - i * 0.5, courses: 9, seed: 80 + i, entrance: false },
      }),
    );
  }

  // --- Khufu's ship -------------------------------------------------------
  // Found sealed in a pit beside the Great Pyramid in 1954, in 1,224 pieces. Placed out on
  // the plain toward Khufu where a student walking over to compare the pyramids passes it.
  items.push(prop('solar-barque', -68, 26, { rotY: 1.35 }));
  items.push(
    prop('info-placard', -58, 34, {
      rotY: 0.6,
      options: {
        eyebrow: 'Found 1954',
        title: 'Khufu’s ship',
        accent: '#8d6a41',
        body:
          'A 143ft cedar ship, sealed in a pit beside the Great Pyramid and found in 1,224 pieces. Rebuilt, it floats. It is the oldest large ship anywhere in the world, it has no keel, and it is sewn together with rope rather than nailed. The high curled ends copy a boat made of reeds.',
      },
    }),
  );

  // --- Mastaba field ------------------------------------------------------
  // The plateau between the monuments is not empty: it is covered in the flat-topped tombs
  // of officials, laid out in streets. Without them Giza reads as three objects on a
  // plain, which is the commonest way pictures of it mislead.
  const mastabaSpots = [
    [-44, -6, 0.1], [-44, -20, 0.1], [-44, -34, 0.1],
    [-70, -8, 0.1], [-70, -22, 0.1],
    [48, -2, -0.12], [48, -16, -0.12], [70, -4, -0.12],
    [-20, -30, 0.05], [-20, -44, 0.05],
  ];
  mastabaSpots.forEach(([x, z, rotY], i) => {
    items.push(
      prop('mastaba', x, z, {
        rotY,
        options: { width: 12 + (i % 3) * 3, depth: 8 + (i % 2) * 2, height: 4 + (i % 3) * 0.8, seed: 140 + i * 7 },
      }),
    );
  });

  // --- Obelisks flanking the approach -------------------------------------
  items.push(prop('obelisk', -13, 84, { options: { height: 22, seed: 21 } }));
  items.push(prop('obelisk', 13, 84, { options: { height: 22, seed: 24 } }));

  // --- Palms and desert ---------------------------------------------------
  // A palm band along the EAST edge, where the cultivated Nile valley meets the desert.
  // That edge is abrupt in Egypt -- you can stand with one foot on each -- and a band
  // rather than a scatter is what shows it.
  //
  // The band runs north-south at x = 96..156, deliberately NOT across the arrival
  // sightline. The first pass ran it straight in front of the spawn at z = 96..114 and a
  // 19ft palm landed 9.7ft from the player, filling the middle of the screen with a trunk
  // -- the same "nothing tall near the spawn" rule the Park's canopy note records, found
  // the same way, by standing there and looking.
  const palmSpots = [
    [98, 96], [112, 104], [126, 92], [140, 100], [154, 88],
    [102, 66], [118, 74], [134, 58], [150, 66],
    [106, 36], [124, 26], [142, 34],
    // A short answering row on the far west, so the plateau is framed rather than fenced.
    [-128, 92], [-144, 74], [-136, 108],
  ];
  palmSpots.forEach(([x, z], i) => {
    items.push(prop('date-palm', x, z, { options: { height: 20 + (i % 4) * 3, seed: 200 + i * 13 } }));
  });

  // Sand drifts across the open ground, thickest where the wind piles it against things.
  const driftSpots = [
    [-30, 60, 16], [30, 56, 14], [-90, 0, 20], [86, 8, 18], [-56, -30, 22],
    [56, -34, 20], [0, -30, 18], [-130, 20, 24], [130, 40, 22], [16, 74, 12],
  ];
  driftSpots.forEach(([x, z, size], i) => {
    items.push(prop('sand-drift', x, z, { options: { size, seed: 300 + i * 11 } }));
  });

  // Loose rock, reusing the Moon's boulder field with desert colours -- an impact-free
  // scatter is the same geometry problem on any world, and only the mineral colour differs.
  items.push(prop('moon-rocks', -24, 12, { options: { count: 9, spread: 16, colors: [0xb5a081, 0x9c8a6a, 0xc9b48d], seed: 401 } }));
  items.push(prop('moon-rocks', 40, 34, { options: { count: 8, spread: 14, colors: [0xa8926f, 0xbfa87e, 0xd0bb95], seed: 403 } }));

  // --- Wayfinding and welcome ---------------------------------------------
  items.push(
    prop('standing-sign', 0, 100, {
      rotY: 0,
      options: {
        lines: ['THE GIZA PLATEAU'],
        subtitle: 'Everything here is built at one fifth of true size — every sign gives the real one',
        width: 15,
        height: 4.2,
      },
    }),
  );

  items.push(...browserStation(-9, 96, { faceX: 0, faceZ: 108 }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-24, 78, {
      number: 1,
      rotY: 0.54,
      accent: '#c2861f',
      title: 'Raise the obelisk',
      target: 'Click the left-hand obelisk → Program.',
      steps: [
        ctrlStep('repeat 20 times'),
        moveStep('move up by 0.6 feet', 1),
        ctrlStep('wait 0.15 seconds', 1),
      ],
      tip: 'Egyptian crews raised these by hauling them upright onto a base with ropes and sand — no cranes, no pulleys. Yours cheats and floats. Change 0.6 to 0.1 and watch how much more convincing slow is than fast, then put "go back to start" on the end to drop it home again.',
    }),
  );

  items.push(
    activity(26, 78, {
      number: 2,
      rotY: -0.58,
      accent: '#7d5044',
      title: 'Sail the ship of the sun',
      target: 'Click Khufu’s ship → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 22 feet', 1),
        ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move forward 22 feet', 1),
        ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'move forward follows the hull, so the rotate genuinely turns the boat round rather than just spinning it on the spot. Swap move forward for glide 40 feet over 6 seconds and it stops teleporting and starts steaming.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  // Under the valley temple's roof slabs, which is the one genuinely enclosed space here.
  items.push(orb(-34, 44, 8, ORB_WARM));
  items.push(orb(-34, 52, 8, ORB_WARM));
  // Grazing the Sphinx's face from below and in front, the way a monument is lit at night.
  items.push(orb(0, 58, 3, ORB_WARM));

  return { theme: 'egypt', spawn: { x: 0, z: 118, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Solar System Walkthrough
// ---------------------------------------------------------------------------

// SIZE and DISTANCE are on two different scales here, and saying so is half the exhibit.
// One scale cannot do both: at a scale where Jupiter is walk-around-able, Neptune is forty
// miles away, and at a scale where all eight fit in a 390ft world, Earth is a grain of
// sand. So the planets are sized faithfully AGAINST EACH OTHER -- Jupiter really is 11
// Earths wide out here, and that comparison is the single most valuable thing in the world
// -- while the walk between them is compressed. Every marker prints the real distance,
// which is what stops the compression from teaching something false.
//
// Earth's radius is 1.6ft; every other body is that times its true ratio to Earth.
function solarLayout() {
  const items = [];
  const E = 1.6;

  // The Sun, 40ft ahead of the spawn: the arrival view. Its own point light is what
  // actually lights the inner planets, which is why they are grouped near it.
  //
  // NOT to the size scale, and the placard says so outright. At Earth = 1.6ft the Sun
  // would be 175ft across and would BE the world. A model that quietly shrinks the Sun
  // teaches that the Sun is a bit bigger than Jupiter, which is the one thing about it
  // nobody should come away believing.
  items.push(prop('sun-model', 0, 104, { options: { radius: 9, seed: 3 } }));
  items.push(
    prop('info-placard', -13, 112, {
      rotY: 0.4,
      options: {
        eyebrow: 'Not to scale — everything else is',
        title: 'The Sun',
        accent: '#e09030',
        body:
          '865,000 miles across, and 99.86% of all the mass in the solar system. If it were built to the same scale as the planets along this walk it would be 175ft wide and you could not see past it. It is a star, and an average one.',
      },
    }),
  );

  // --- The walkway --------------------------------------------------------
  // Eight segments rather than one 300ft slab: the frustum can drop most of it, and a
  // student walking the length passes a visible joint every few seconds, which is what
  // gives the distance a sense of being travelled rather than teleported.
  for (let i = 0; i < 8; i++) {
    items.push(prop('orbit-walk', 0, 92 - i * 38, { options: { length: 38, width: 9, seed: 5 + i } }));
  }

  // --- The eight planets --------------------------------------------------
  // z positions are a compressed walk, not a scale distance. Each entry carries the two
  // real numbers the placards and markers print.
  const planets = [
    { kind: 'mercury', z: 76,   r: 0.383, tilt: 0.03,  au: '0.39 AU', mi: '36 million miles',
      title: 'Mercury', body: '3,032 miles across. The smallest planet, and the fastest — a year here is 88 days. It has almost no atmosphere, so its day side is 800°F and its night side is -290°F.' },
    { kind: 'venus',   z: 50,   r: 0.949, tilt: 177.4, au: '0.72 AU', mi: '67 million miles',
      title: 'Venus', body: '7,521 miles across — almost exactly Earth’s size. You cannot see its surface: it is wrapped in cloud that traps heat so well the ground is 870°F, hotter than Mercury. It also spins backwards, and slower than it orbits.' },
    { kind: 'earth',   z: 22,   r: 1.0,   tilt: 23.4,  au: '1 AU',    mi: '93 million miles',
      title: 'Earth', body: '7,926 miles across. The only place known to have liquid water on its surface — and the only planet here whose colour comes from being alive. Its 23° tilt is what gives it seasons.',
      moons: [{ kind: 'moon', radius: 0.273 * 1.6 }] },
    { kind: 'mars',    z: -4,   r: 0.532, tilt: 25.2,  au: '1.52 AU', mi: '142 million miles',
      title: 'Mars', body: '4,212 miles across. Red because its soil is rusted iron. It has the tallest volcano in the solar system, Olympus Mons, and a canyon four times deeper than the Grand Canyon.',
      moons: [{ kind: 'rock', radius: 0.12 }, { kind: 'rock', radius: 0.09 }] },
    { kind: 'jupiter', z: -56,  r: 11.21, tilt: 3.1,   au: '5.2 AU',  mi: '484 million miles', noPlinth: true,
      title: 'Jupiter', body: '86,881 miles across — every other planet in the solar system would fit inside it with room to spare. It is a ball of gas with no surface to stand on. The red spot is a storm wider than Earth that has been blowing for at least 350 years.',
      moons: [{ kind: 'rock', radius: 0.29 * 1.6 }, { kind: 'moon', radius: 0.25 * 1.6 }, { kind: 'rock', radius: 0.41 * 1.6 }, { kind: 'moon', radius: 0.38 * 1.6 }] },
    { kind: 'saturn',  z: -114, r: 9.45,  tilt: 26.7,  au: '9.5 AU',  mi: '889 million miles', rings: true, noPlinth: true,
      title: 'Saturn', body: '72,367 miles across, and light enough to float in water if you had a bath big enough. The rings are 170,000 miles wide and only about 30ft thick — a sheet of ice and rock as thin as a house is tall.',
      moons: [{ kind: 'moon', radius: 0.404 * 1.6 }] },
    { kind: 'uranus',  z: -152, r: 4.01,  tilt: 97.8,  au: '19.2 AU', mi: '1.8 billion miles', noPlinth: true,
      title: 'Uranus', body: '31,518 miles across. Look at how it is tipped: Uranus orbits lying on its side, so each pole spends 42 years in sunlight and 42 in darkness. Voyager 2 flew past in 1986 and photographed a nearly featureless blue-green ball.',
      moons: [{ kind: 'rock', radius: 0.124 * 1.6 }] },
    { kind: 'neptune', z: -178, r: 3.88,  tilt: 28.3,  au: '30.1 AU', mi: '2.8 billion miles', noPlinth: true,
      title: 'Neptune', body: '30,599 miles across. The windiest place known — storms here run at 1,200 mph. It is so far out that one of its years is 165 of ours: it has completed a single orbit since it was discovered in 1846.',
      moons: [{ kind: 'moon', radius: 0.212 * 1.6 }] },
  ];

  planets.forEach((p, i) => {
    // Planets alternate sides of the walkway so a student passes between them rather than
    // walking round a line of them, and so the small inner four are never hidden behind
    // the giants.
    const side = i % 2 === 0 ? -1 : 1;
    const offset = p.r > 5 ? 20 : 7;
    items.push(
      prop('planet-model', side * offset, p.z, {
        options: {
          kind: p.kind,
          radius: p.r * E,
          tilt: p.tilt,
          rings: !!p.rings,
          plinth: !p.noPlinth,
          seed: 11 + i * 7,
          moons: p.moons || [],
        },
      }),
    );
    // Placard on the walkway side of its planet, angled back toward the walk.
    items.push(
      prop('info-placard', side * (offset - 3.5), p.z + 5, {
        rotY: side * -0.5,
        options: { eyebrow: p.mi, title: p.title, accent: '#7fb4ff', body: p.body },
      }),
    );
    // Distance marker on the deck itself.
    items.push(prop('distance-marker', side * -2.6, p.z, { rotY: side * 0.3, options: { label: p.au, sub: p.mi } }));
  });

  // --- Between Mars and Jupiter -------------------------------------------
  // Deliberately sparse. The belt in every film is a boulder field you dodge; the real one
  // averages about a million miles between rocks, so a student who leaves thinking it is
  // crowded has learned something false.
  items.push(prop('asteroid-belt', -16, -28, { options: { count: 20, spread: 20, seed: 31 } }));
  items.push(prop('asteroid-belt', 18, -32, { options: { count: 16, spread: 16, seed: 37 } }));
  items.push(
    prop('info-placard', 8, -24, {
      rotY: -0.3,
      options: {
        eyebrow: 'Between Mars and Jupiter',
        title: 'The asteroid belt',
        accent: '#9c9186',
        body:
          'Look how much empty space there is. Films show the belt as a boulder field you have to dodge; in reality the rocks average about a million miles apart, and every spacecraft that has flown through has done so without aiming for a gap.',
      },
    }),
  );

  // --- Dwarf planets ------------------------------------------------------
  // Ceres in the belt, Pluto out past Neptune. Both carry the reclassification, which is
  // the thing students most often ask about.
  items.push(prop('planet-model', 26, -20, { options: { kind: 'rock', radius: 0.074 * E * 4, tilt: 4, seed: 61 } }));
  items.push(
    prop('info-placard', 22, -15, {
      rotY: -0.6,
      options: { eyebrow: 'Dwarf planet · 1.8 AU', title: 'Ceres', accent: '#9c9186',
        body: '590 miles across and the largest object in the asteroid belt — it holds about a third of the belt’s entire mass by itself. Shown here at four times its true size, or you could not see it.' },
    }),
  );
  // z = -186, not -196. WORLD_BOUND_RADIUS clamps the player to 195ft, and at -196 Pluto
  // sat at r = 196.4 -- visible from the end of the walk and impossible to ever reach,
  // which is a cruel joke to play about Pluto specifically.
  items.push(prop('planet-model', 12, -184, { options: { kind: 'rock', radius: 0.186 * E * 2, tilt: 122, seed: 67 } }));
  items.push(
    prop('info-placard', 7, -178, {
      rotY: -0.5,
      options: { eyebrow: 'Dwarf planet · 39 AU', title: 'Pluto', accent: '#c8b8a0',
        body: 'Reclassified in 2006 — not because it shrank, but because we found others like it out here and needed a word for the group. It is smaller than our Moon. Shown at twice true size.' },
    }),
  );

  // --- Comets -------------------------------------------------------------
  // The tail always points AWAY from the Sun, whichever way the comet is travelling —
  // which is why both of these have their tails aimed down-walk, not backwards along their
  // own path. Almost everybody draws it streaming behind like a jet exhaust.
  items.push(prop('comet', -34, 40, { rotY: 0.6, options: { length: 16, seed: 41 } }));
  items.push(prop('comet', 40, -70, { rotY: -0.9, options: { length: 22, seed: 47 } }));
  items.push(
    prop('info-placard', -28, 46, {
      rotY: 0.9,
      options: { eyebrow: 'Which way does a tail point?', title: 'Comets', accent: '#9fd8ff',
        body: 'Away from the Sun — always. The tail is not exhaust; it is dust and gas being pushed off the comet by sunlight and the solar wind. On the way back out, a comet travels tail-first.' },
    }),
  );

  // --- Wayfinding ---------------------------------------------------------
  // Off the arrival axis, not across it. A 16ft sign 12ft from the spawn fills the frame
  // and the Sun -- the thing a student came here to see -- arrives behind a billboard.
  items.push(
    prop('standing-sign', 18, 130, {
      rotY: -1.04,
      options: {
        lines: ['THE SOLAR SYSTEM'],
        subtitle: 'Sizes are true against each other. Distances are not — every marker gives the real one',
        width: 14,
        height: 4,
      },
    }),
  );

  items.push(...browserStation(-9, 124, { faceX: 0, faceZ: 136 }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-22, 118, {
      number: 1,
      rotY: 0.55,
      accent: '#c2861f',
      title: 'Spin Jupiter',
      target: 'Walk down to Jupiter, click it → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('rotate 12 degrees', 1),
        ctrlStep('wait 0.05 seconds', 1),
      ],
      tip: 'Jupiter turns once every 10 hours — the shortest day of any planet, even though it is the biggest. Try the same script on Venus: a real Venus day is 243 Earth days, so slow it right down to 1 degree and a 2 second wait.',
    }),
  );

  items.push(
    activity(22, 118, {
      number: 2,
      rotY: -0.55,
      accent: '#3d8bf2',
      title: 'Send a comet in and back out',
      target: 'Click the comet near the Sun → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 30 feet', 1),
        ctrlStep('wait 1 seconds', 1),
        moveStep('move forward 30 feet', 1),
        ctrlStep('wait 3 seconds', 1),
      ],
      tip: 'A real comet moves fastest when it is closest to the Sun and crawls when it is far away, which is why it spends most of its life out in the cold. Make the outbound wait much longer than the inbound one and you have modelled that.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  // The outer planets are a long way from the Sun's point light, and the theme's hemi is
  // deliberately almost nothing (there is no ground out here to bounce off). Without these
  // Uranus and Neptune are unlit silhouettes -- which is astronomically true and
  // pedagogically useless.
  items.push(orb(0, -60, 12, ORB_BLUE));
  items.push(orb(0, -120, 12, ORB_BLUE));
  items.push(orb(0, -170, 10, ORB_BLUE));
  items.push(orb(0, 60, 8, ORB_WHITE));

  return { theme: 'solar', spawn: { x: 0, z: 140, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Water Cycle
// ---------------------------------------------------------------------------

// The design problem here is that a water cycle is a LOOP, and a loop is the one thing a
// 3D landscape does not naturally show. Stand in a real valley and you see a sea, a cloud
// and a river; you do not see that they are the same water going round. So the five big
// labelled arrows are the exhibit, laid out as a circuit a student can actually walk, and
// everything else exists to give the arrows something to connect.
//
// The circuit runs anticlockwise seen from above: sea (east) -> up -> cloud (north) ->
// rain (west) -> mountain and stream -> back to the sea. A student who follows the arrows
// ends up where they started, which is the entire point and is not something a poster can
// make anybody do.
function waterCycleLayout() {
  const items = [];

  // --- 1. The sea, and evaporation ----------------------------------------
  items.push(prop('water-body', 62, 30, { options: { width: 74, depth: 62, seed: 23 } }));
  items.push(prop('vapour-column', 52, 44, { y: 0.5, options: { height: 22, radius: 4, seed: 17 } }));
  items.push(prop('vapour-column', 74, 22, { y: 0.5, options: { height: 18, radius: 3.4, seed: 19 } }));
  items.push(prop('vapour-column', 66, 48, { y: 0.5, options: { height: 20, radius: 3.8, seed: 21 } }));
  items.push(
    prop('cycle-arrow', 46, 56, {
      rotY: -0.9,
      options: { span: 26, rise: 16, label: 'EVAPORATION', sub: 'the sun lifts water as invisible vapour', color: 0x3d8bf2 },
    }),
  );
  items.push(
    prop('info-placard', 38, 44, {
      rotY: -0.7,
      options: {
        eyebrow: 'Stage 1',
        title: 'Evaporation',
        accent: '#3d8bf2',
        body:
          'The sun heats the surface and water leaves it as a gas. You cannot see water vapour — the wisps here stand in for something genuinely invisible. About 90% of the water in the air came off the oceans this way; the rest came out of plants.',
      },
    }),
  );

  // --- 2. Condensation: the cloud -----------------------------------------
  // Clouds are placed with an explicit absoluteY, which is the deliberate exception to
  // "origin is the base centre" that the Moon's Earth and the museum's paintings also use.
  // Every base sits at exactly 34ft, because that is the point: cumulus form where rising
  // air reaches the condensation level, so a field of them all has ONE base height.
  items.push(prop('cumulus-cloud', 6, -14, { y: 62, absoluteY: true, options: { size: 46, height: 22, seed: 7 } }));
  items.push(prop('cumulus-cloud', -34, -26, { y: 58, absoluteY: true, options: { size: 38, height: 18, seed: 11 } }));
  items.push(prop('cumulus-cloud', 46, -34, { y: 60, absoluteY: true, options: { size: 34, height: 16, seed: 13 } }));
  items.push(prop('cumulus-cloud', -70, -8, { y: 56, absoluteY: true, options: { size: 40, height: 19, seed: 27, dark: true } }));
  items.push(
    prop('cycle-arrow', 26, -4, {
      rotY: -0.4,
      options: { span: 24, rise: 14, label: 'CONDENSATION', sub: 'vapour cools and turns back into droplets', color: 0x7a5fd0 },
    }),
  );
  items.push(
    prop('info-placard', 20, 8, {
      rotY: -0.4,
      options: {
        eyebrow: 'Stage 2',
        title: 'Condensation',
        accent: '#7a5fd0',
        body:
          'Air cools as it rises. Cold air holds less vapour, so at a certain height the water turns back into liquid droplets around specks of dust — and that is a cloud. Look at the bottoms: they are all flat, and all at the same height. That height is where the air got cold enough.',
      },
    }),
  );

  // --- 3. Precipitation ---------------------------------------------------
  // The rain curtain hangs under the dark cloud, which is the one that is raining. A
  // cloud only rains when its droplets have collided into drops too heavy to stay up, and
  // making exactly one cloud dark and exactly that one rain is how the world says so.
  items.push(prop('rain-curtain', -70, -8, { y: 10, absoluteY: true, options: { radius: 15, height: 44, count: 300, seed: 13 } }));
  items.push(
    prop('cycle-arrow', -46, 2, {
      rotY: 0.6,
      options: { span: 24, rise: 13, label: 'PRECIPITATION', sub: 'drops get too heavy to stay up', color: 0x2f9e8f },
    }),
  );
  items.push(
    prop('info-placard', -44, 16, {
      rotY: 0.5,
      options: {
        eyebrow: 'Stage 3',
        title: 'Precipitation',
        accent: '#2f9e8f',
        body:
          'A cloud droplet is far too small to fall — it would take days to reach the ground and would evaporate first. Rain happens when about a million of them collide and merge into one drop. Higher up and colder, the same process makes snow and hail.',
      },
    }),
  );

  // --- 4. Collection: the mountain, the snowpack and the stream -----------
  items.push(prop('mountain-peak', -104, -52, { options: { height: 52, radius: 38, seed: 29, snowline: 0.52 } }));
  items.push(prop('mountain-peak', -150, -20, { options: { height: 34, radius: 26, seed: 33, snowline: 0.62 } }));
  items.push(prop('stream-course', -78, 6, { rotY: -0.5, options: { length: 70, drop: 9, width: 4.5, seed: 31, bends: 3 } }));
  items.push(prop('stream-course', -44, 48, { rotY: -1.1, options: { length: 64, drop: 5, width: 6, seed: 35, bends: 2 } }));
  items.push(
    prop('info-placard', -84, 26, {
      rotY: 0.9,
      options: {
        eyebrow: 'Stage 4',
        title: 'Collection and runoff',
        accent: '#8a93a8',
        body:
          'Snow on a mountain is water in storage — sometimes for months, sometimes for thousands of years. When it melts it runs downhill, gathers into streams and rivers, and heads back to the sea. Look at where the snow stops: that line is where it is cold enough for snow to survive the summer.',
      },
    }),
  );
  items.push(
    prop('cycle-arrow', -30, 62, {
      rotY: 1.5,
      options: { span: 26, rise: 11, label: 'COLLECTION', sub: 'rivers carry it back to the sea', color: 0x2f6ea8 },
    }),
  );

  // --- 5. Transpiration, and what happens underground ---------------------
  // The stage every poster leaves out, and the one that explains wells and springs.
  items.push(prop('groundwater-cutaway', -34, 64, { rotY: 0.55, options: { width: 24, height: 10, depth: 8, seed: 37 } }));
  items.push(
    prop('info-placard', -20, 70, {
      rotY: 0.3,
      options: {
        eyebrow: 'Where the rest of it goes',
        title: 'Groundwater',
        accent: '#a08a63',
        body:
          'Not all rain runs off. Much of it soaks down through soil and porous rock until it reaches a layer water cannot pass, and collects there. That is the water table, and it is where a well gets its water. It moves — but slowly: a few feet a day, not a few feet a second.',
      },
    }),
  );

  // Transpiration: trees breathing water out of their leaves. A big oak moves about 40,000
  // gallons a year, which is the fact that makes this stage worth its own arrow.
  const treeSpots = [[-16, 30], [-26, 22], [-6, 26], [-34, 34], [-20, 44], [4, 34], [-42, 26]];
  treeSpots.forEach(([x, z], i) => {
    items.push(prop('shade-tree', x, z, { options: { height: 22 + (i % 3) * 4, seed: 60 + i * 5 } }));
  });
  items.push(prop('vapour-column', -22, 30, { y: 20, absoluteY: true, options: { height: 14, radius: 3, seed: 43, tint: 0xdaf0e2 } }));
  items.push(prop('vapour-column', -6, 27, { y: 20, absoluteY: true, options: { height: 12, radius: 2.6, seed: 45, tint: 0xdaf0e2 } }));
  items.push(
    prop('cycle-arrow', -16, 16, {
      rotY: 0.2,
      options: { span: 20, rise: 12, label: 'TRANSPIRATION', sub: 'plants breathe water out too', color: 0x4e9c3f },
    }),
  );
  items.push(
    prop('info-placard', -6, 14, {
      rotY: 0,
      options: {
        eyebrow: 'Stage 5',
        title: 'Transpiration',
        accent: '#4e9c3f',
        body:
          'Plants pull water up from their roots and let it out through tiny pores in their leaves. One large oak moves about 40,000 gallons a year — a whole forest can put more water into the air than a lake of the same size.',
      },
    }),
  );

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 24, 88, {
      rotY: -0.4,
      options: {
        lines: ['THE WATER CYCLE'],
        subtitle: 'Follow the five arrows all the way round — you will finish where you started',
        width: 15,
        height: 4.2,
      },
    }),
  );

  items.push(...browserStation(-11, 86, { faceX: 0, faceZ: 98 }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-24, 80, {
      number: 1,
      rotY: 0.35,
      accent: '#3d8bf2',
      title: 'Send a cloud across the sky',
      target: 'Click the big white cloud → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 60 feet', 1),
        ctrlStep('wait 4 seconds', 1),
        moveStep('move forward 60 feet', 1),
        ctrlStep('wait 4 seconds', 1),
      ],
      tip: 'Weather really does travel — in most of the world, west to east. Add a second cloud running at a different speed and you have the thing that makes forecasting hard: they do not all move together.',
    }),
  );

  items.push(
    activity(8, 82, {
      number: 2,
      rotY: -0.1,
      accent: '#2f9e8f',
      title: 'Make the rain fall',
      target: 'Click the grey rain under the dark cloud → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 20 times', 1),
        moveStep('move up by -1 feet', 2),
        ctrlStep('wait 0.05 seconds', 2),
        moveStep('go back to start', 1),
      ],
      tip: 'Fall a bit at a time, then jump back to the top — which is exactly how a cartoon makes endless rain out of one drawing. "go back to start" is what resets it, and it remembers where the rain was when you pressed play. Change -1 to -3 and it becomes a downpour.',
    }),
  );

  // --- The path round the circuit -----------------------------------------
  // Laid stone between the arrows, and it is doing the arrows' job at ground level: an
  // arrow tells a student which way the WATER goes, and the path tells them which way to
  // WALK to follow it. Without it the five arrows are five separate signs in a field, and
  // the loop only exists on the sign that says the word.
  const pathSpots = [
    [30, 74, -0.5], [42, 60, -0.8], [46, 42, -1.2], [40, 22, -1.5],
    [16, 6, 2.4], [-10, 2, 2.0], [-34, 8, 1.8], [-52, 22, 1.4],
    [-58, 42, 1.0], [-44, 60, 0.7], [-22, 72, 0.3], [2, 78, 0.0],
  ];
  pathSpots.forEach(([x, z, rotY], i) => {
    items.push(prop('path-stones', x, z, { rotY, options: { length: 16, width: 5, seed: 200 + i * 9 } }));
  });

  // --- Filling out the valley ---------------------------------------------
  // Conifers up the mountain flank, where the snowline and the treeline both matter, and
  // broadleaf lower down. The treeline stopping well below the snowline is real and worth
  // a student noticing without being told.
  const coniferSpots = [[-84, -34], [-96, -20], [-70, -30], [-118, -22], [-108, -6], [-132, -6], [-88, -8]];
  coniferSpots.forEach(([x, z], i) => {
    items.push(prop('conifer-tree', x, z, { options: { height: 20 + (i % 3) * 5, seed: 300 + i * 7 } }));
  });

  // Wildflowers on the wet meadow between the stream and the sea -- where the water is is
  // where the flowers are, which is the cycle's point made without a placard.
  items.push(prop('wildflowers', -30, 46, { options: { radius: 9, count: 130, seed: 401 } }));
  items.push(prop('wildflowers', 6, 52, { options: { radius: 8, count: 110, seed: 403 } }));
  items.push(prop('flower-bed', -14, 56, { rotY: 0.3, options: { width: 11, depth: 5, seed: 405 } }));

  // Boulders along the stream bed, reusing the Moon's field with river-rock colours.
  items.push(prop('moon-rocks', -66, 18, { options: { count: 8, spread: 12, colors: [0x6e6a5e, 0x8a8274, 0x5c5a52], seed: 501 } }));
  items.push(prop('moon-rocks', -50, 40, { options: { count: 7, spread: 10, colors: [0x7a7566, 0x66625a, 0x918a7c], seed: 503 } }));

  // A bench at the top of the walk, looking back down over the whole circuit.
  items.push(prop('bench', 26, 66, { rotY: -2.2, options: { length: 5 } }));
  items.push(prop('bench', -30, 62, { rotY: 2.4, options: { length: 5 } }));

  // --- Lighting -----------------------------------------------------------
  // Under the raining cloud, which is genuinely the darkest spot in the world, and inside
  // the tree group where the canopy closes over.
  items.push(orb(-70, -8, 9, ORB_WHITE));
  items.push(orb(-22, 30, 8, ORB_WHITE));

  return { theme: 'watercycle', spawn: { x: 0, z: 100, yaw: 0 }, items };
}


// ---------------------------------------------------------------------------
// Ancient Pompeii
// ---------------------------------------------------------------------------

// 24 August AD 79, early afternoon. The town is NOT a ruin here, and that is the whole
// design: every picture a student has seen is of broken wall stumps in bright sunshine,
// but the point of Pompeii is that it was an ordinary working town on an ordinary day.
// So the buildings stand, the bar is stocked, the street is intact -- and Vesuvius is
// going up behind them. The ruin is the consequence, not the subject.
function pompeiiLayout() {
  const items = [];
  const SP = { x: 0, z: 104 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- Vesuvius -----------------------------------------------------------
  // Far to the north-west and huge. The eruption column is a PLINIAN one -- named for
  // Pliny the Younger, who watched this exact eruption and described it as an umbrella
  // pine: a narrow trunk going up fast, then a flat spreading canopy where it stops
  // rising. That flat top is the identifying feature, not a widening plume.
  items.push(prop('vesuvius', -70, -168, { options: { height: 92, baseRadius: 104, columnHeight: 160, seed: 3 } }));

  // --- The street ---------------------------------------------------------
  // Running north up the middle of the world, so a student walks it on arrival.
  for (let i = 0; i < 4; i++) {
    items.push(prop('pompeii-street', 0, 62 - i * 48, { options: { length: 48, width: 16, seed: 11 + i, crossing: i % 2 === 0 } }));
  }

  // --- Houses down both sides ---------------------------------------------
  // Roman houses face INWARD onto their courtyards, so a street frontage has almost no
  // windows -- which is itself worth seeing, and is why these read as blank and solid.
  const villas = [
    [-25, 44, 1], [-25, 12, 1], [-25, -22, 1],
    [25, 50, -1], [25, 16, -1], [25, -18, -1],
  ];
  villas.forEach(([x, z, s], i) => {
    items.push(prop('pompeii-villa', x, z, { rotY: s > 0 ? Math.PI / 2 : -Math.PI / 2, options: { width: 26 + (i % 3) * 4, depth: 20, height: 15 + (i % 2) * 3, seed: 17 + i * 5 } }));
  });

  // The bar, opening straight onto the street. There are about 80 of these in Pompeii and
  // they are the clearest sign that this was a town where ordinary people bought hot food
  // on the way home rather than cooking it.
  items.push(prop('thermopolium', -11, 30, { rotY: Math.PI / 2, options: { length: 12, seed: 23 } }));
  items.push(
    prop('info-placard', -8, 40, {
      rotY: face(-8, 40),
      options: {
        eyebrow: 'A bar on the corner', title: 'Thermopolium', accent: '#9e3b28',
        body: 'Roman fast food. The round holes in the counter held dolia — big jars of stew, wine and hot food. There are about eighty of these in Pompeii, because most flats had no kitchen and no chimney. The counter is faced in broken scraps of marble, which is exactly how the real ones look.',
      },
    }),
  );

  // --- The forum ----------------------------------------------------------
  items.push(prop('forum-colonnade', -34, -8, { rotY: Math.PI / 2, options: { bays: 7, spacing: 8, height: 15, seed: 29 } }));
  items.push(prop('forum-colonnade', 34, -8, { rotY: -Math.PI / 2, options: { bays: 7, spacing: 8, height: 15, seed: 33 } }));
  items.push(
    prop('info-placard', -18, 4, {
      rotY: face(-18, 4),
      options: {
        eyebrow: 'The town square', title: 'The Forum', accent: '#c98b3a',
        body: 'Law courts, temples, the market and the town council all opened onto this one paved square, and no carts were allowed in it. Every Roman town of any size was laid out around one, which is why a Roman who had never been here would still have known exactly where to find things.',
      },
    }),
  );

  // --- The amphitheatre ---------------------------------------------------
  // Pompeii's is the oldest surviving stone amphitheatre anywhere -- about 70 BC, a
  // century and a half before the Colosseum.
  items.push(prop('amphitheatre', 86, -58, { options: { radiusX: 42, radiusZ: 34, height: 15, seed: 31 } }));
  items.push(
    prop('info-placard', 52, -34, {
      rotY: face(52, -34),
      options: {
        eyebrow: 'Built about 70 BC', title: 'The Amphitheatre', accent: '#8a4630',
        body: 'The oldest stone amphitheatre that still stands anywhere — a hundred and fifty years older than the Colosseum. It held 20,000 people, which is more than lived in the town. In AD 59 a riot broke out here between locals and visitors from Nuceria and the Senate banned games for ten years.',
      },
    }),
  );

  // --- Frescoes -----------------------------------------------------------
  items.push(prop('fresco-wall', -13, -46, { rotY: face(-13, -46), options: { width: 15, height: 10, seed: 41 } }));
  items.push(prop('fresco-wall', 14, -52, { rotY: face(14, -52), options: { width: 13, height: 9, seed: 45 } }));
  items.push(
    prop('info-placard', -4, -40, {
      rotY: face(-4, -40),
      options: {
        eyebrow: 'What the walls looked like', title: 'Pompeian red', accent: '#9e3b28',
        body: 'Almost every room in town was painted, floor to ceiling, in deep red and ochre fields divided by thin painted architecture with a small picture in the middle. The colour is so associated with this one town that painters still call it Pompeian red.',
      },
    }),
  );

  // --- The casts ----------------------------------------------------------
  // In 1863 Giuseppe Fiorelli realised the voids in the ash were body-shaped and poured
  // plaster into them. Placed off the main street rather than on it: these are the most
  // affecting objects in archaeology and they should be come upon, not paraded.
  items.push(prop('plaster-cast', -46, 30, { rotY: 0.6, options: { pose: 'curled', seed: 37 } }));
  items.push(prop('plaster-cast', -50, 24, { rotY: -0.9, options: { pose: 'curled', seed: 39 } }));
  items.push(prop('plaster-cast', -43, 22, { rotY: 2.1, options: { pose: 'seated', seed: 43 } }));
  items.push(
    prop('info-placard', -40, 36, {
      rotY: face(-40, 36),
      options: {
        eyebrow: 'Found 1863', title: 'The casts', accent: '#5a5045',
        body: 'The ash set hard around the people who died in it. Their bodies decayed and left holes. In 1863 Giuseppe Fiorelli worked out what the holes were and filled them with plaster — so these are casts of an empty space, not of a body. About 1,150 have been made.',
      },
    }),
  );

  // --- Ash ---------------------------------------------------------------
  // The fall on the first day was pumice: light, dry, and it piled up like grey snow.
  items.push(prop('ash-fall', -20, 20, { y: 4, absoluteY: true, options: { radius: 34, height: 46, count: 240, seed: 43 } }));
  items.push(prop('ash-fall', 26, -14, { y: 4, absoluteY: true, options: { radius: 30, height: 44, count: 200, seed: 47 } }));
  items.push(prop('ash-fall', 0, 62, { y: 4, absoluteY: true, options: { radius: 26, height: 40, count: 160, seed: 51 } }));

  // Drifts of fallen pumice against the buildings.
  [[-38, 46], [38, 40], [-38, 6], [38, 2], [-14, -34], [16, -30], [-46, -12], [48, 12]].forEach(([x, z], i) => {
    items.push(prop('sand-drift', x, z, { options: { size: 12 + (i % 3) * 4, color: 0xb5ad9e, seed: 300 + i * 9 } }));
  });

  // Loose rock and rubble.
  items.push(prop('moon-rocks', -60, -30, { options: { count: 9, spread: 14, colors: [0x6e6459, 0x8a8478, 0x5a564f], seed: 401 } }));
  items.push(prop('moon-rocks', 60, 26, { options: { count: 8, spread: 12, colors: [0x7d7466, 0x9a9186, 0x63605a], seed: 403 } }));

  // Street furniture and the rest of the town. A Roman street is dense -- shops, fountains
  // and shrines every few yards -- and an empty one reads as a film set after hours.
  items.push(prop('stone-fountain', -12, 60, { rotY: 0.4, options: { seed: 61 } }));
  items.push(prop('stone-fountain', 13, -8, { rotY: -0.3, options: { seed: 63 } }));
  items.push(prop('thermopolium', 11, -40, { rotY: -Math.PI / 2, options: { length: 10, seed: 27 } }));
  items.push(prop('pompeii-villa', -25, -54, { rotY: Math.PI / 2, options: { width: 24, depth: 18, height: 14, seed: 71 } }));
  items.push(prop('pompeii-villa', 25, -50, { rotY: -Math.PI / 2, options: { width: 26, depth: 18, height: 16, seed: 73 } }));
  items.push(prop('fresco-wall', -30, 62, { rotY: face(-30, 62), options: { width: 12, height: 8, seed: 49 } }));
  const potSpots = [[-13, 52], [13, 52], [-13, 18], [13, 18], [-13, -18], [13, -20]];
  potSpots.forEach(([x, z], i) => items.push(prop('planter', x, z, { options: { size: 2.6, shrubColor: 0x5c7a42 } })));
  items.push(prop('bench', -14, 70, { rotY: face(-14, 70) + Math.PI, options: { length: 5 } }));
  items.push(prop('bench', 15, 70, { rotY: face(15, 70) + Math.PI, options: { length: 5 } }));

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 22, 92, {
      rotY: face(22, 92),
      options: { lines: ['POMPEII'], subtitle: '24 August, AD 79 — an ordinary afternoon', width: 14, height: 4.2 },
    }),
  );
  items.push(...browserStation(-10, 90, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-25, 78, {
      number: 1, rotY: face(-25, 78), accent: '#c2521f',
      title: 'Raise the ash column',
      target: 'Click the falling ash near the forum → Program.',
      steps: [
        ctrlStep('repeat 30 times'),
        moveStep('move up by 1 feet', 1),
        lookStep('change size by 3 %', 1),
        ctrlStep('wait 0.1 seconds', 1),
      ],
      tip: 'It rises and spreads at the same time, which is what a Plinian column does — up fast, then flat at the top where the air stops it climbing. The real one reached 21 miles in about an hour. Pliny the Younger watched it from across the bay and wrote the only eyewitness account we have.',
    }),
  );
  items.push(
    activity(25, 76, {
      number: 2, rotY: face(25, 76), accent: '#9e3b28',
      title: 'Send a cart up the street',
      target: 'Click a stretch of paved street → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 40 feet', 1), ctrlStep('wait 3 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move forward 40 feet', 1), ctrlStep('wait 3 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Look at the ruts worn into the basalt, and the raised stepping stones across the road. The gaps between the stones are exactly a cart axle wide — the street doubled as the drain, and you crossed it without stepping in it.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(-11, 30, 5, ORB_WARM));
  items.push(orb(-34, -8, 9, ORB_WARM));
  items.push(orb(34, -8, 9, ORB_WARM));
  items.push(orb(-46, 27, 4, ORB_WHITE));

  return { theme: 'pompeii', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Leonardo da Vinci's Studio
// ---------------------------------------------------------------------------

// The workshop yard, with the machines built out of the notebooks at full size.
//
// The honest point of this world: NONE of the flying machines ever flew, and the placards
// say so. Leonardo's aerial screw could not have worked -- nothing counteracts its torque
// -- and no human has the power-to-weight ratio to flap a wing. Presenting them as working
// aircraft teaches something false about how engineering actually proceeds, which is by
// being wrong in interesting ways for a very long time. The cart, by contrast, DOES work:
// a replica was built in 2004 and it drove.
function davinciLayout() {
  const items = [];
  const SP = { x: 0, z: 74 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // The workshop itself, at the head of the yard.
  items.push(prop('studio-building', 0, -34, { options: { width: 36, depth: 26, height: 21, seed: 47 } }));

  // --- The machines, spread across the yard -------------------------------
  items.push(prop('ornithopter', -26, 20, { rotY: 0.5, options: { span: 34, seed: 7 } }));
  items.push(
    prop('info-placard', -14, 30, {
      rotY: face(-14, 30),
      options: {
        eyebrow: 'It never flew', title: 'The ornithopter', accent: '#8a6a42',
        body: 'A flapping-wing glider, framed like a bat rather than feathered like a bird — Leonardo studied bats because a membrane wing is something a person could actually build. It could not have worked: no human has the power to flap a wing that size. He was wrong for the right reasons, and the wing shape is very nearly a modern hang glider.',
      },
    }),
  );

  items.push(prop('aerial-screw', 28, 14, { options: { height: 19, radius: 9, seed: 13 } }));
  items.push(
    prop('info-placard', 17, 24, {
      rotY: face(17, 24),
      options: {
        eyebrow: 'Also never flew', title: 'The aerial screw', accent: '#b08d4a',
        body: 'Often called the first helicopter. Four people walk the capstan to spin a linen screw. It could not have lifted: nothing stops the whole machine spinning the opposite way, and the crew would have to run faster than anyone can. A real helicopter needs a tail rotor for exactly the reason this one fails.',
      },
    }),
  );

  items.push(prop('vinci-cart', -14, 46, { rotY: -0.6, options: { seed: 19 } }));
  items.push(
    prop('info-placard', -4, 50, {
      rotY: face(-4, 50),
      options: {
        eyebrow: 'This one works', title: 'The self-propelled cart', accent: '#9a7a3c',
        body: 'Driven by two coiled springs, and steered by pegs set between the gear teeth — change the pegs and it drives a different path. That makes it programmable, which is why it is often called the first robot. A working replica was built in 2004 and it drove exactly as drawn.',
      },
    }),
  );

  items.push(prop('war-machine', 34, 44, { rotY: -1.1, options: { seed: 41 } }));
  items.push(
    prop('info-placard', 24, 48, {
      rotY: face(24, 48),
      options: {
        eyebrow: 'Who paid for all this', title: 'The war machines', accent: '#6b5031',
        body: 'Leonardo wrote to the Duke of Milan offering himself as a military engineer, and listed painting last. The notebooks hold far more pages of catapults, bridges and cannon than of flying. Renaissance genius was funded by somebody, and it is worth knowing by whom.',
      },
    }),
  );

  // --- Drawings and the bench --------------------------------------------
  items.push(prop('vitruvian-panel', -34, -4, { rotY: face(-34, -4), options: { size: 9, seed: 23 } }));
  items.push(
    prop('info-placard', -25, 6, {
      rotY: face(-25, 6),
      options: {
        eyebrow: 'c. 1490', title: 'Vitruvian Man', accent: '#8a6a42',
        body: 'A drawing that is really an argument: a human body fits both a circle and a square, but not from the same centre. The square is centred on the body; the circle is centred on the navel. Leonardo solved a problem the Roman architect Vitruvius had posed fifteen centuries earlier.',
      },
    }),
  );

  items.push(prop('easel-painting', 32, -6, { rotY: face(32, -6), options: { width: 5, height: 7, seed: 37 } }));
  items.push(
    prop('info-placard', 24, 4, {
      rotY: face(24, 4),
      options: {
        eyebrow: 'Unfinished, like most of them', title: 'On the easel', accent: '#7a6448',
        body: 'Leonardo finished perhaps fifteen paintings in forty years. He left work half-done constantly, went back to the Mona Lisa for sixteen years, and never delivered it. What is on this easel is a blocked-in underpainting with the drawing still showing — which is what most of his panels actually looked like.',
      },
    }),
  );

  items.push(prop('workbench', -8, -12, { rotY: 0.2, options: { length: 11, seed: 29 } }));
  items.push(prop('workbench', 10, -14, { rotY: -0.3, options: { length: 9, seed: 31 } }));
  items.push(prop('codex-stand', -2, 4, { rotY: face(-2, 4), options: { seed: 31, sketch: 'gears' } }));
  items.push(prop('codex-stand', 12, 12, { rotY: face(12, 12), options: { seed: 35, sketch: 'wing' } }));
  items.push(prop('codex-stand', -18, 10, { rotY: face(-18, 10), options: { seed: 39, sketch: 'screw' } }));
  items.push(
    prop('info-placard', 4, 14, {
      rotY: face(4, 14),
      options: {
        eyebrow: 'Why it reads backwards', title: 'Mirror writing', accent: '#6b5031',
        body: 'Leonardo wrote right to left in mirror image through all 13,000 surviving pages. He was left-handed, and writing that way stops the ink smudging under your hand — the simplest explanation is usually the right one. It was not a code: anyone with a mirror can read it.',
      },
    }),
  );

  // --- The yard -----------------------------------------------------------
  const treeSpots = [[-44, 34], [-48, 12], [44, 30], [50, 8], [-44, -22], [46, -20]];
  treeSpots.forEach(([x, z], i) => {
    items.push(prop('shade-tree', x, z, { options: { height: 20 + (i % 3) * 4, seed: 200 + i * 7, leafColor: 0x5c7a42 } }));
  });
  items.push(prop('planter', -20, 60, { options: { size: 3.4 } }));
  items.push(prop('planter', 20, 60, { options: { size: 3.4 } }));
  items.push(prop('planter', -30, 46, { options: { size: 3 } }));
  items.push(prop('planter', 30, 44, { options: { size: 3 } }));
  items.push(prop('bench', -20, 34, { rotY: face(-20, 34) + Math.PI, options: { length: 5 } }));
  items.push(prop('bench', 20, 36, { rotY: face(20, 36) + Math.PI, options: { length: 5 } }));
  [[-9, 58, 0.2], [9, 56, -0.2], [-2, 32, 0.1], [4, 10, 0], [-6, -18, 0.3]].forEach(([x, z, r], i) => {
    items.push(prop('path-stones', x, z, { rotY: r, options: { length: 16, width: 5, seed: 400 + i * 7 } }));
  });
  items.push(prop('moon-rocks', -52, 48, { options: { count: 7, spread: 10, colors: [0x9a8a72, 0x7d7060, 0xb0a28a], seed: 501 } }));
  items.push(prop('moon-rocks', 52, 52, { options: { count: 6, spread: 9, colors: [0xa89a80, 0x8a7d68, 0xc0b298], seed: 503 } }));

  // More of the yard: a workshop is a place of clutter, and a tidy one reads as a showroom.
  items.push(prop('workbench', 20, -20, { rotY: -0.5, options: { length: 8, seed: 33 } }));
  items.push(prop('workbench', -22, -18, { rotY: 0.5, options: { length: 8, seed: 35 } }));
  items.push(prop('codex-stand', 22, 30, { rotY: face(22, 30), options: { seed: 43, sketch: 'gears' } }));
  items.push(prop('codex-stand', -30, 24, { rotY: face(-30, 24), options: { seed: 45, sketch: 'wing' } }));
  items.push(prop('vitruvian-panel', 36, -22, { rotY: face(36, -22), options: { size: 7, seed: 27 } }));
  items.push(prop('easel-painting', -34, -20, { rotY: face(-34, -20), options: { width: 4.4, height: 6, seed: 39 } }));
  items.push(prop('bench', -34, 8, { rotY: face(-34, 8) + Math.PI, options: { length: 4.5 } }));
  items.push(prop('bench', 34, 10, { rotY: face(34, 10) + Math.PI, options: { length: 4.5 } }));
  items.push(prop('planter', -14, 24, { options: { size: 2.6, shrubColor: 0x6b8a4a } }));
  items.push(prop('planter', 14, 26, { options: { size: 2.6, shrubColor: 0x6b8a4a } }));
  items.push(prop('flower-bed', -24, 62, { rotY: 0.3, options: { width: 9, depth: 4, seed: 605 } }));

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 20, 66, {
      rotY: face(20, 66),
      options: { lines: ['THE STUDIO'], subtitle: 'Most of these never worked — and that is the interesting part', width: 15, height: 4.2 },
    }),
  );
  items.push(...browserStation(-10, 62, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-26, 56, {
      number: 1, rotY: face(-26, 56), accent: '#b08d4a',
      title: 'Turn the aerial screw',
      target: 'Click the big linen screw → Program.',
      steps: [ctrlStep('forever'), moveStep('rotate 8 degrees', 1), ctrlStep('wait 0.06 seconds', 1)],
      tip: 'Watch what does NOT happen: it turns, and it stays exactly where it is. That is the flaw — with nothing to push against, spinning the screw would just spin the machine the other way. A modern helicopter needs a tail rotor for precisely this reason.',
    }),
  );
  items.push(
    activity(26, 58, {
      number: 2, rotY: face(26, 58), accent: '#9a7a3c',
      title: 'Drive the cart, then turn it',
      target: 'Click the self-propelled cart → Program.',
      steps: [
        ctrlStep('repeat 4 times'),
        moveStep('move forward 12 feet', 1), ctrlStep('wait 1 seconds', 1),
        moveStep('rotate 90 degrees', 1), ctrlStep('wait 0.5 seconds', 1),
      ],
      tip: 'This is the closest thing here to what the real cart did: it drove a fixed path set by pegs in its gears. Note that move Z always goes along the WORLD’s Z — the rotate turns the cart to face its way, but does not change which way move Z sends it.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(0, -30, 9, ORB_WARM));
  items.push(orb(-8, -12, 6, ORB_WARM));
  items.push(orb(10, -14, 6, ORB_WARM));

  return { theme: 'davinci', spawn: { ...SP, yaw: 0 }, items };
}


// ---------------------------------------------------------------------------
// Ellis Island
// ---------------------------------------------------------------------------

// 1907 -- the busiest year the station ever had: 1,004,756 people. The world is the
// harbour approach, because arriving is the part of the story that is actually about
// arriving.
//
// What this world must not do is make it look grand. The Main Building is handsome and
// the Registry Room is enormous, but the experience was a queue, a numbered tag pinned to
// your coat, a doctor looking at your eyes for thirty seconds, and a chalk letter on your
// shoulder if something was wrong. So the baggage is the largest object on the dock and
// the inspection line has an iron rail.
function ellisLayout() {
  const items = [];
  const SP = { x: 0, z: 112 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The Main Building --------------------------------------------------
  items.push(prop('ellis-main-building', 0, 12, { options: { width: 76, depth: 36, height: 27, seed: 5 } }));
  items.push(
    prop('info-placard', -22, 52, {
      rotY: face(-22, 52),
      options: {
        eyebrow: '1892 – 1954', title: 'The Main Building', accent: '#a8593c',
        body: 'Twelve million people came through this door. On the busiest single day, 17 April 1907, 11,747 were processed. Red brick with limestone trim and four copper domes — and for most arrivals this was the first American building they ever saw, from the deck of a ship.',
      },
    }),
  );

  // --- Liberty across the water -------------------------------------------
  // About half a mile off, which at this distance makes her a silhouette -- and the
  // silhouette is the whole thing: raised arm, seven-ray crown, tablet, huge pedestal.
  items.push(prop('statue-of-liberty', -132, -68, { rotY: 0.9, options: { scale: 0.5, seed: 11 } }));
  items.push(
    prop('info-placard', -60, 60, {
      rotY: face(-60, 60),
      options: {
        eyebrow: 'Look at her feet', title: 'The broken chain', accent: '#74b09a',
        body: 'Almost nobody sees it, because you cannot from the ground: she is stepping out of a broken shackle. The statue was a gift from France marking the end of slavery as much as independence. The seven rays of her crown stand for the seven continents and seas.',
      },
    }),
  );

  // --- The waterfront -----------------------------------------------------
  // The harbour itself, reusing the Water Cycle's water body -- open water is the same
  // problem whichever world needs it.
  items.push(prop('water-body', -96, 4, { options: { width: 130, depth: 150, seed: 23, shore: false } }));
  items.push(prop('water-body', 104, 30, { options: { width: 120, depth: 150, seed: 27, shore: false } }));

  items.push(prop('ferry-pier', -46, 76, { rotY: 0.2, options: { length: 46, width: 16, seed: 23 } }));
  items.push(prop('steamship', -80, 52, { rotY: 1.5, options: { length: 100, funnels: 2, seed: 17 } }));
  items.push(
    prop('info-placard', -40, 62, {
      rotY: face(-40, 62),
      options: {
        eyebrow: 'How you got here', title: 'Steerage', accent: '#24262b',
        body: 'First and second class passengers were inspected in their cabins and walked straight off at Manhattan. Only steerage came to Ellis Island. Steerage was below the waterline at the stern, over the propellers — a fortnight in the noisiest, roughest berth on the ship, for about $30.',
      },
    }),
  );

  // --- The dock -----------------------------------------------------------
  items.push(prop('baggage-pile', -20, 62, { rotY: 0.3, options: { count: 30, spread: 10, seed: 29 } }));
  items.push(prop('baggage-pile', 22, 58, { rotY: -0.4, options: { count: 22, spread: 8, seed: 33 } }));
  items.push(
    prop('info-placard', 2, 66, {
      rotY: face(2, 66),
      options: {
        eyebrow: 'Everything they owned', title: 'The baggage', accent: '#6b4a2c',
        body: 'You could bring what you could carry. People arrived with a trunk, or a bundle tied in a sheet, and left it in a heap on this dock while they were examined. Some never got it back. The photographs of the baggage room are the ones that carry the weight of the whole place.',
      },
    }),
  );

  items.push(prop('inspection-line', -6, 40, { rotY: 0.1, options: { length: 28, seed: 31 } }));
  items.push(
    prop('info-placard', 24, 42, {
      rotY: face(24, 42),
      options: {
        eyebrow: 'Six seconds a person', title: 'The line inspection', accent: '#3a3f45',
        body: 'Doctors watched you walk up the stairs — that was the first test, and you never knew it was happening. At the top they looked at your eyes with a buttonhook for trachoma. A chalk letter on your coat meant a second look: E for eyes, H for heart, X for suspected mental illness. About 2% were sent back.',
      },
    }),
  );

  items.push(prop('manifest-board', 30, 74, { rotY: face(30, 74), options: { ship: 'SS PRINZESSIN', date: '17 APRIL 1907', souls: '1,806', seed: 37 } }));

  // --- Landscape and lamps ------------------------------------------------
  // UNLIT, and there are six rather than ten. This world is a bright cold MORNING, and a
  // lamp post's PointLight is a per-fragment forward-pass cost -- the most expensive thing
  // an integrated GPU is asked for here. Ten of them plus three orbs made Ellis Island the
  // heaviest-lit world in the app, including the two set at night, to light a scene the sun
  // already lights. Unlit they are still street furniture and still cast shadows.
  const lamps = [[-30, 84], [30, 84], [-30, 56], [30, 54], [-14, 30], [16, 30]];
  lamps.forEach(([x, z], i) => items.push(prop('lamp-post', x, z, { options: { height: 13, seed: 100 + i, lit: false } })));
  const benches = [[-38, 68, 0.4], [38, 66, -0.4], [-40, 44, 0.9]];
  benches.forEach(([x, z, r]) => items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI + r, options: { length: 5 } })));
  [[-8, 92, 0], [10, 90, 0], [0, 70, 0], [-4, 52, 0.1]].forEach(([x, z, r], i) => {
    items.push(prop('path-stones', x, z, { rotY: r, options: { length: 16, width: 6, seed: 300 + i * 7 } }));
  });
  [[-56, 92], [56, 90], [-64, 34], [64, 60]].forEach(([x, z], i) => {
    items.push(prop('shade-tree', x, z, { options: { height: 18 + (i % 2) * 4, seed: 200 + i * 9, leafColor: 0x4c6b3a } }));
  });
  items.push(prop('flag-pole', 40, 88, { options: { height: 24, seed: 41 } }));

  // More of the dock. The station handled five thousand people on an ordinary day, and an
  // empty quay reads as a country halt.
  items.push(prop('baggage-pile', -34, 46, { rotY: 0.7, options: { count: 18, spread: 7, seed: 37 } }));
  items.push(prop('baggage-pile', 36, 44, { rotY: -0.6, options: { count: 16, spread: 6, seed: 39 } }));
  items.push(prop('baggage-pile', 4, 78, { rotY: 0.2, options: { count: 14, spread: 6, seed: 41 } }));
  items.push(prop('inspection-line', 26, 26, { rotY: -0.4, options: { length: 20, seed: 43 } }));
  items.push(prop('ferry-pier', 48, 74, { rotY: -0.25, options: { length: 40, width: 14, seed: 45 } }));
  items.push(prop('steamship', 92, 44, { rotY: -1.5, options: { length: 78, funnels: 1, seed: 47 } }));
  items.push(prop('manifest-board', -34, 76, { rotY: face(-34, 76), options: { ship: 'SS KROONLAND', date: '18 APRIL 1907', souls: '1,142', seed: 49 } }));
  const lamps3 = [[-46, 96], [46, 96], [-14, 74], [16, 74]];
  lamps3.forEach(([x, z], i) => items.push(prop('lamp-post', x, z, { options: { height: 13, seed: 150 + i, lit: false } })));
  items.push(prop('bench', -18, 84, { rotY: face(-18, 84) + Math.PI, options: { length: 5 } }));
  items.push(prop('bench', 18, 84, { rotY: face(18, 84) + Math.PI, options: { length: 5 } }));
  items.push(prop('planter', -24, 92, { options: { size: 3 } }));
  items.push(prop('planter', 24, 92, { options: { size: 3 } }));

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', -24, 98, {
      rotY: face(-24, 98),
      options: { lines: ['ELLIS ISLAND'], subtitle: '1907 — twelve million people came through this door', width: 15, height: 4.2 },
    }),
  );
  items.push(...browserStation(12, 98, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-30, 90, {
      number: 1, rotY: face(-30, 90), accent: '#a8593c',
      title: 'Bring the ship in to the pier',
      target: 'Click the steamship → Program.',
      steps: [
        ctrlStep('repeat 14 times'),
        moveStep('move forward 2 feet', 1),
        ctrlStep('wait 0.4 seconds', 1),
      ],
      tip: 'Two feet at a time, with a pause — a ship this size comes alongside at walking pace and stops by reversing its engines. Try 12 ft with no wait and you will see why they do not.',
    }),
  );
  items.push(
    activity(24, 88, {
      number: 2, rotY: face(24, 88), accent: '#74b09a',
      title: 'Make the ship signal, and Liberty answer',
      target: 'Two stacks. Give the first to the STEAMSHIP, the second to the Statue of Liberty.',
      steps: [
        ctrlStep('forever'),
        lookStep('say land ahead', 1),
        ctrlStep('wait 6 seconds', 1),
        ctrlStep('when an object says land ahead'),
        lookStep('change color to #ffd27f', 1),
        ctrlStep('wait 2 seconds', 1),
        lookStep('change color to #7fd4c4', 1),
      ],
      tip: 'Two objects, two stacks, one message. "when an object says" does not care WHICH object spoke, so give the same listening stack to the Main Building as well and both answer at once. Liberty really was a dull brown when she arrived — copper turns green as it weathers, and it took about thirty years.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  // Two orbs, not three. The third sat at Liberty's own position 34ft up, which on a statue
  // whose whole job is to be a SILHOUETTE across the water did nothing but put a bright ball
  // in the sky beside her -- the Moon's lesson, and Under the Sea's: open air gives an orb
  // nothing to be attached to. She is lit by the sun like everything else out there.
  items.push(orb(0, 26, 7, ORB_WARM));
  items.push(orb(-6, 40, 6, ORB_WHITE));

  return { theme: 'ellis', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The U.S. Capitol
// ---------------------------------------------------------------------------

// The West Front, seen from the Mall.
//
// The lighting problem here is white marble against green lawn: white-on-white has no
// contrast of its own, so all the modelling has to come from SHADOW. Hence the `capitol`
// theme's cleanest, most neutral sun in the app (any warmth turns the whole building
// cream) and a high hemisphere fill, since a dome is a curved surface whose entire shaded
// half is lit by sky bounce alone.
function capitolLayout() {
  const items = [];
  const SP = { x: 0, z: 150 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // The building and its dome. The dome is a SEPARATE object stacked on the centre block,
  // so a student can click and program it on its own -- and so the two can be sized
  // against each other without one builder growing a second job.
  items.push(prop('capitol-building', 0, -22, { options: { centreWidth: 48, wingWidth: 42, depth: 36, height: 26, seed: 7 } }));
  items.push(prop('capitol-dome', 0, -22, { y: 29, absoluteY: false, options: { drumRadius: 15, seed: 3 } }));
  items.push(
    prop('info-placard', -30, 52, {
      rotY: face(-30, 52),
      options: {
        eyebrow: 'Finished during the Civil War', title: 'The dome', accent: '#8a8578',
        body: 'Nearly nine million pounds of cast iron, built in rings and bolted together. Lincoln insisted the work continue through the war — "if people see the Capitol going on, it is a sign we intend the Union shall go on". It is not a hemisphere: it is markedly taller than it is wide, which is what separates it from every state house that copied it.',
      },
    }),
  );
  items.push(
    prop('info-placard', 30, 52, {
      rotY: face(30, 52),
      options: {
        eyebrow: 'On top, 19ft of bronze', title: 'The Statue of Freedom', accent: '#6e6a52',
        body: 'She wears a feathered helmet, not a liberty cap. Jefferson Davis — then Secretary of War, later president of the Confederacy — objected to the cap because it was the Roman symbol of a freed slave, and had it changed. The statue was cast by Philip Reid, who was himself enslaved.',
      },
    }),
  );

  // The reflecting pool on the axis. A mirror doubles the height of whatever stands at the
  // end of it, which is why the Mall has one.
  items.push(prop('reflecting-pool', 0, 78, { options: { length: 84, width: 24, seed: 17 } }));

  // The Washington Monument, off the axis to the west so it can be seen alongside rather
  // than behind. The colour change two thirds up is real: work stopped for 23 years over
  // the Civil War and the marble they went back to never matched.
  items.push(prop('washington-monument', -120, 96, { options: { height: 96, seed: 13 } }));
  items.push(
    prop('info-placard', -74, 92, {
      rotY: face(-74, 92),
      options: {
        eyebrow: 'Look two thirds of the way up', title: 'The Washington Monument', accent: '#d2cec2',
        body: 'The stone changes colour, and you can see the line from a mile off. Building stopped in 1854 when the money ran out, the Civil War came, and it stood as a stump for 23 years. When they finished it in 1884 the original quarry was gone and no other marble matched.',
      },
    }),
  );

  // The chambers, shown as a cutaway on the lawn since neither is enterable.
  items.push(prop('chamber-desks', -56, 22, { rotY: face(-56, 22), options: { rows: 5, seed: 19 } }));
  items.push(
    prop('info-placard', -40, 34, {
      rotY: face(-40, 34),
      options: {
        eyebrow: 'A cutaway of the chamber', title: '435 and 100', accent: '#6b4a2c',
        body: 'The House has 435 voting members and the Senate 100 — two per state regardless of size, which is why Wyoming and California have the same Senate power. The desks face a rostrum, and members of the two parties sit on opposite sides of the centre aisle.',
      },
    }),
  );

  // Statuary -- every state sends two.
  const statues = [[-24, 30], [24, 30], [-34, 8], [34, 8], [-24, -4], [24, -4]];
  statues.forEach(([x, z], i) => {
    items.push(prop('statuary-figure', x, z, { rotY: face(x, z), options: { height: 9 + (i % 2), seed: 60 + i * 5, robe: i % 2 === 0 } }));
  });
  items.push(
    prop('info-placard', 40, 34, {
      rotY: face(40, 34),
      options: {
        eyebrow: 'Two from every state', title: 'Statuary Hall', accent: '#6e6a52',
        body: 'Each state chooses two people to stand in the Capitol, and can swap them. States have been changing theirs — several have replaced Confederate figures since 2020. Who a place decides to put on a plinth is a live argument, not settled history.',
      },
    }),
  );

  items.push(prop('flag-pole', -18, 40, { options: { height: 28, seed: 29 } }));
  items.push(prop('flag-pole', 18, 40, { options: { height: 28, seed: 31 } }));

  // --- The Mall -----------------------------------------------------------
  // Elms in rows, which is what the Mall actually is: a formal allee, not scattered trees.
  for (let i = 0; i < 7; i++) {
    const z = 116 - i * 20;
    items.push(prop('shade-tree', -46, z, { options: { height: 24 + (i % 3) * 3, seed: 300 + i * 7, leafColor: 0x4e7a3a } }));
    items.push(prop('shade-tree', 46, z, { options: { height: 24 + ((i + 1) % 3) * 3, seed: 320 + i * 7, leafColor: 0x4e7a3a } }));
  }
  const benches2 = [[-30, 108], [30, 108], [-30, 66], [30, 66]];
  benches2.forEach(([x, z]) => items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI, options: { length: 5 } })));
  const lamps2 = [[-34, 124], [34, 124], [-34, 88], [34, 88], [-34, 50], [34, 50]];
  lamps2.forEach(([x, z], i) => items.push(prop('lamp-post', x, z, { options: { height: 12, seed: 400 + i } })));
  [[-13, 130, 0], [13, 130, 0], [0, 36, 0], [0, 20, 0]].forEach(([x, z, r], i) => {
    items.push(prop('path-stones', x, z, { rotY: r, options: { length: 18, width: 6, seed: 500 + i * 7 } }));
  });
  items.push(prop('planter', -20, 122, { options: { size: 3.6 } }));
  items.push(prop('planter', 20, 122, { options: { size: 3.6 } }));
  items.push(prop('flower-bed', -12, 44, { rotY: 0.2, options: { width: 11, depth: 5, seed: 601 } }));
  items.push(prop('flower-bed', 12, 44, { rotY: -0.2, options: { width: 11, depth: 5, seed: 603 } }));

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 22, 138, {
      rotY: face(22, 138),
      options: { lines: ['THE U.S. CAPITOL'], subtitle: 'The West Front, from the Mall', width: 15, height: 4.2 },
    }),
  );
  items.push(...browserStation(-11, 136, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-26, 128, {
      number: 1, rotY: face(-26, 128), accent: '#8a8578',
      title: 'Raise the dome into place',
      target: 'Click the dome (not the building) → Program.',
      steps: [
        moveStep('move up by 30 feet'),
        ctrlStep('repeat 24 times'),
        moveStep('move up by -1.5 feet', 1),
        ctrlStep('wait 0.12 seconds', 1),
        lookStep('say the union shall go on'),
      ],
      tip: 'Lift it clear, then lower it onto the building a foot and a half at a time. The real dome went up in cast-iron rings hoisted by a derrick standing inside it, right through the Civil War — Lincoln insisted the work carry on. The dome and the building are separate objects here, which is why you can move one without the other.',
    }),
  );
  items.push(
    activity(26, 128, {
      number: 2, rotY: face(26, 128), accent: '#6e6a52',
      title: 'Send a statue on tour',
      target: 'Click any bronze statue → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 16 feet', 1), ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move forward 16 feet', 1), ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'States really do swap theirs — several have been replaced in the last few years. Try changing the colour too: these are bronze, and bronze goes green outdoors, which is exactly what happened to the Statue of Liberty.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(0, 4, 10, ORB_WHITE));
  items.push(orb(-56, 22, 7, ORB_WARM));
  items.push(orb(0, -22, 46, ORB_WHITE));

  return { theme: 'capitol', spawn: { ...SP, yaw: 0 }, items };
}


// ---------------------------------------------------------------------------
// The Great Barrier Reef Dive
// ---------------------------------------------------------------------------

// About 25ft down on the outer reef -- shallower and clearer than `sea`'s 30ft patch reef.
//
// This world deliberately REUSES most of SeaProps. The water ceiling, light shafts, marine
// snow, bubble columns, bommies, gardens, clams, anemones and fish schools are the same
// problems already solved once, and solving them again differently would only make them
// diverge. What is new is the megafauna the Barrier Reef is actually known for -- a green
// turtle, a manta ray, the staghorn thickets that build the reef -- and one thing `sea`
// does not carry: a bleached section, because a reef only ever shown healthy teaches that
// it is fine.
function barrierLayout() {
  const items = [];
  const SP = { x: 0, z: 72 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The volume ---------------------------------------------------------
  // Ceiling, beams, snow, bubbles. An opaque surface is both more accurate and far cheaper
  // than a transparent one: from beneath, a wind-rippled surface is a MIRROR.
  items.push(prop('water-surface', 0, 0, { y: 25, absoluteY: true, options: { size: 340, seed: 5 } }));
  items.push(prop('light-shafts', -18, 6, { y: 24, absoluteY: true, options: { count: 8, height: 24, seed: 11 } }));
  items.push(prop('light-shafts', 34, -26, { y: 24, absoluteY: true, options: { count: 7, height: 24, seed: 13 } }));
  items.push(prop('marine-snow', 0, 10, { y: 12, absoluteY: true, options: { count: 900, radius: 90, height: 24, seed: 17 } }));
  items.push(prop('bubble-column', -34, -14, { options: { height: 24, seed: 19 } }));
  items.push(prop('bubble-column', 40, 18, { options: { height: 24, seed: 23 } }));

  // --- The reef wall ------------------------------------------------------
  // Across the front-left, with open sand to the right. The pairing is the composition:
  // the reef alone is a wall of clutter with nowhere to stand back and look from, and open
  // sand alone is a desert.
  const bommies = [
    [-52, 6, 14], [-40, -18, 17], [-58, -34, 12], [-30, -44, 15],
    [-64, 18, 11], [-16, -58, 13], [-46, 32, 10],
  ];
  bommies.forEach(([x, z, size], i) => {
    items.push(prop('coral-bommie', x, z, { options: { size, seed: 100 + i * 7 } }));
    items.push(prop('coral-garden', x, z, { options: { radius: size * 0.8, count: 22, mound: true, seed: 120 + i * 7 } }));
  });

  // Staghorn thickets -- the branching Acropora that actually builds the reef.
  const staghorns = [[-30, 14, 6], [-44, -6, 5], [-22, -30, 6.5], [-56, -14, 5], [-12, -46, 5.5], [-38, 22, 4.5]];
  staghorns.forEach(([x, z, size], i) => {
    items.push(prop('staghorn-coral', x, z, { rotY: i * 0.9, options: { size, seed: 200 + i * 11, color: [0xc98a4e, 0xb0704e, 0xd0a05e][i % 3] } }));
  });

  // Plate corals -- the tables that shade the reef flat.
  [[-26, -6, 4], [-48, 18, 3.4], [-18, -20, 4.4], [-58, 2, 3]].forEach(([x, z, r], i) => {
    items.push(prop('plate-coral', x, z, { options: { radius: r, seed: 300 + i * 9 } }));
  });

  items.push(prop('brain-coral', -22, 2, { options: { radius: 3.4, seed: 41 } }));
  items.push(prop('brain-coral', -36, -30, { options: { radius: 2.8, seed: 43 } }));
  items.push(prop('sea-fan', -44, 10, { rotY: 0.6, options: { height: 6, seed: 45 } }));
  items.push(prop('sea-fan', -54, -22, { rotY: -0.4, options: { height: 5, seed: 47 } }));
  items.push(prop('tube-sponge', -34, -2, { options: { height: 5, seed: 49 } }));
  items.push(prop('tube-sponge', -50, -8, { options: { height: 4, seed: 51 } }));
  items.push(prop('giant-clam', -24, -14, { rotY: 0.8, options: { size: 3.4, seed: 53 } }));
  items.push(prop('giant-clam', -40, 4, { rotY: -0.5, options: { size: 2.8, seed: 55 } }));
  items.push(prop('sea-anemone', -28, 20, { options: { radius: 2.4, seed: 57 } }));
  items.push(prop('clownfish-school', -28, 20, { y: 2.4, options: { count: 7, seed: 59 } }));

  // --- The open sand ------------------------------------------------------
  items.push(prop('seagrass-patch', 30, 22, { options: { radius: 12, count: 160, seed: 61 } }));
  items.push(prop('seagrass-patch', 48, -6, { options: { radius: 10, count: 130, seed: 63 } }));
  items.push(prop('sea-urchin', 24, 6, { options: { seed: 65 } }));
  items.push(prop('sea-cucumber', 36, 34, { rotY: 0.7, options: { seed: 67 } }));
  items.push(prop('starfish', 20, 34, { rotY: 1.2, options: { seed: 69 } }));
  items.push(prop('starfish', 44, 12, { rotY: -0.6, options: { seed: 71 } }));

  // --- The animals --------------------------------------------------------
  // Placed with a `y`, which is what makes this world a VOLUME rather than a field.
  items.push(prop('sea-turtle', 8, 10, { y: 9, rotY: -0.6, options: { length: 4.6, seed: 5 } }));
  items.push(prop('sea-turtle', -14, -34, { y: 13, rotY: 2.1, options: { length: 3.8, seed: 9 } }));
  items.push(
    prop('info-placard', 16, 30, {
      rotY: face(16, 30),
      options: {
        eyebrow: 'Green sea turtle', title: 'Older than you would guess', accent: '#5c6b3f',
        body: 'They take 25 to 50 years to become adults and can live past 80. A female returns to lay eggs on the same beach she hatched on, navigating by the Earth’s magnetic field. Note the flat shell and the huge front flippers — a domed shell and small feet would make this a tortoise.',
      },
    }),
  );

  // The manta, high and wide -- the largest thing here.
  items.push(prop('manta-ray', -8, -20, { y: 18, rotY: 0.5, options: { span: 14, seed: 11 } }));
  items.push(
    prop('info-placard', 4, 22, {
      rotY: face(4, 22),
      options: {
        eyebrow: 'Reef manta', title: 'Fifteen feet across', accent: '#2b3442',
        body: 'It swims by flapping its whole body like a wing, and feeds by cruising with its mouth wide open, filtering plankton. The two rolled fins on its head funnel water in. Every manta’s belly spots are unique, so researchers identify individuals the way we use fingerprints.',
      },
    }),
  );

  items.push(prop('potato-cod', -18, 8, { y: 5, rotY: 1.1, options: { length: 5.2, seed: 17 } }));
  items.push(prop('reef-shark', 22, -30, { y: 15, rotY: -0.8, options: { length: 6, seed: 21 } }));
  items.push(prop('reef-shark', 52, -44, { y: 18, rotY: -1.2, options: { length: 4.6, seed: 25 } }));
  items.push(prop('reef-fish-school', -20, -10, { y: 7, options: { count: 34, radius: 7, seed: 73 } }));
  items.push(prop('reef-fish-school', 12, -8, { y: 11, options: { count: 28, radius: 6, seed: 75 } }));

  // --- The bleached section ----------------------------------------------
  // Deliberately next to the living reef, so the two are seen together. Half the Barrier
  // Reef's shallow coral died in the 2016 and 2017 bleaching events.
  items.push(prop('bleached-patch', 26, -12, { options: { size: 16, seed: 23 } }));
  items.push(prop('staghorn-coral', 32, -20, { options: { size: 5.5, bleached: true, seed: 205 } }));
  items.push(prop('staghorn-coral', 20, -22, { options: { size: 4.5, bleached: true, seed: 207 } }));
  items.push(prop('plate-coral', 34, -6, { options: { radius: 3.6, bleached: true, seed: 305 } }));
  items.push(
    prop('info-placard', 20, 4, {
      rotY: face(20, 4),
      options: {
        eyebrow: 'The white section is not a species', title: 'Bleaching', accent: '#e8e4d8',
        body: 'Coral is an animal that farms algae inside itself, and the algae give it both its colour and most of its food. When the water gets too warm the coral expels them and turns bone white. It is not dead yet at that point — it is starving, and it can recover if the water cools quickly enough. In 2016 and 2017 much of it did not.',
      },
    }),
  );

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 20, 62, {
      rotY: face(20, 62),
      options: { lines: ['THE GREAT BARRIER REEF'], subtitle: 'Twenty-five feet down on the outer reef', width: 16, height: 4.2 },
    }),
  );
  items.push(...browserStation(-11, 60, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-24, 54, {
      number: 1, rotY: face(-24, 54), accent: '#2b3442',
      title: 'Fly the manta past the reef',
      target: 'Click the manta ray → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 40 feet', 1), ctrlStep('wait 4 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move forward 40 feet', 1), ctrlStep('wait 4 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Mantas really do patrol the same cleaning stations day after day, hovering while little wrasse pick parasites off them. Add a move Y to make it rise and fall as it goes — they do that too.',
    }),
  );
  items.push(
    activity(24, 52, {
      number: 2, rotY: face(24, 52), accent: '#e8a04e',
      title: 'Bleach a coral, then bring it back',
      target: 'Click a healthy staghorn thicket → Program.',
      steps: [
        ctrlStep('forever'),
        lookStep('change color to #ffffff', 1),
        lookStep('set opacity to 55 %', 1),
        ctrlStep('wait 3 seconds', 1),
        lookStep('change color to #c98a4e', 1),
        lookStep('set opacity to 100 %', 1),
        ctrlStep('wait 3 seconds', 1),
      ],
      tip: 'It goes pale AND thin, because a bleached coral has lost the algae living inside it — that is where both its colour and most of its food came from. The timing is the real lesson: warming turns it white in weeks, and recovery, if it comes at all, takes ten to fifteen years. Make the white wait twenty times longer and you have modelled it honestly.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  // ONE orb, buried behind the reef wall. Open water gives a light source nothing to be
  // attached to, so a visible orb reads as a glowing ball hanging in mid-water.
  items.push(orb(-48, -20, 3, ORB_WHITE));

  return { theme: 'reef', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Delta River Boat
// ---------------------------------------------------------------------------

// A sternwheel packet at a Mississippi landing, about 1870, at golden hour.
//
// The boat IS the world; everything else gives it somewhere to be. So it is built at close
// to true size -- a middling packet was around 180ft and this one is 130 -- and it is the
// one object a student is meant to walk the whole length of.
function deltaLayout() {
  const items = [];
  const SP = { x: 0, z: 88 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The river ----------------------------------------------------------
  // Wide, and running across the world rather than away from it, so the boat is seen
  // broadside -- which is the only angle that shows a sternwheeler what it is.
  items.push(prop('water-body', -30, -34, { options: { width: 210, depth: 96, seed: 23, shore: false } }));
  items.push(prop('water-body', 130, -30, { options: { width: 130, depth: 96, seed: 27, shore: false } }));

  // --- The boat -----------------------------------------------------------
  // y: -3 sinks the hull INTO the river. Seated on the terrain like every other prop, the
  // boat's flat bottom sat a clear foot above the water plane and the whole 45ft steamer
  // read as hovering -- which the wide overhanging guards only made worse, since from the
  // bank you then see straight under them. A packet drew about four feet loaded, and
  // putting that four feet below the surface is what makes it float rather than hover.
  items.push(prop('paddle-steamer', -4, -30, { y: -3, rotY: -1.45, options: { length: 130, name: 'DELTA QUEEN', seed: 5 } }));
  items.push(
    prop('info-placard', -26, 26, {
      rotY: face(-26, 26),
      options: {
        eyebrow: 'A sternwheel packet', title: 'Why the wheel is at the back', accent: '#9a3226',
        body: 'A sidewheeler is faster and turns better; a sternwheeler is narrower and can work water a sidewheeler cannot. On the upper Mississippi that mattered more than speed. These boats drew about four feet loaded — the old joke was that they could run on a heavy dew.',
      },
    }),
  );
  items.push(
    prop('info-placard', 22, 24, {
      rotY: face(22, 24),
      options: {
        eyebrow: 'Look how tall they are', title: 'The chimneys', accent: '#33312c',
        body: 'Not decoration: the height is what makes the draught that keeps the fires hot enough. They stand forward because the boilers are forward and the engines are aft, driving the wheel through long pitman arms. The fluted crowns were the one place an owner could show off.',
      },
    }),
  );

  // --- The landing --------------------------------------------------------
  items.push(prop('levee-landing', 0, 22, { options: { width: 50, seed: 17 } }));
  items.push(prop('cotton-bales', -22, 40, { rotY: 0.2, options: { count: 15, seed: 11 } }));
  items.push(prop('cotton-bales', 20, 44, { rotY: -0.3, options: { count: 12, seed: 13 } }));
  items.push(prop('cotton-bales', -34, 54, { rotY: 0.6, options: { count: 10, seed: 15 } }));
  items.push(
    prop('info-placard', 2, 46, {
      rotY: face(2, 46),
      options: {
        eyebrow: 'What the boat came for', title: 'Cotton', accent: '#bdb096',
        body: 'A bale weighed about 500lb and a big packet carried thousands. The whole river economy ran on it, and before 1865 that economy ran on enslaved labour — the boats, the landings and the bales are all part of that history and cannot honestly be shown without it.',
      },
    }),
  );

  items.push(prop('pirogue', 30, 14, { rotY: 0.5, options: { length: 14, seed: 29 } }));
  items.push(prop('pirogue', 38, 6, { rotY: -0.8, options: { length: 12, seed: 31 } }));

  // --- The swamp ----------------------------------------------------------
  // Cypress behind the levee. The `delta` theme's hemi is lifted for the same reason
  // Dinosaur Island's was: anything under Spanish moss is lit by bounce alone.
  const cypress = [
    [-58, 62, 44], [-72, 40, 38], [-46, 76, 40], [-84, 66, 34], [-62, 88, 36],
    [58, 66, 42], [74, 44, 36], [48, 82, 38], [86, 70, 34], [66, 96, 36],
    [-96, 88, 30], [96, 92, 32],
  ];
  cypress.forEach(([x, z, h], i) => {
    items.push(prop('cypress-tree', x, z, { options: { height: h, seed: 200 + i * 11, moss: i % 4 !== 0 } }));
  });
  items.push(
    prop('info-placard', -40, 68, {
      rotY: face(-40, 68),
      options: {
        eyebrow: 'Not a moss, and not a parasite', title: 'Spanish moss', accent: '#9a9a7c',
        body: 'It is an air plant, related to the pineapple. It takes nothing from the tree — it only sits there, living on rain and dust. It is not Spanish either: French settlers called it "Spanish beard" as an insult, and the Spanish called it "French hair" straight back.',
      },
    }),
  );

  items.push(prop('reed-bed', -34, 12, { options: { radius: 10, count: 110, seed: 37 } }));
  items.push(prop('reed-bed', 34, 10, { options: { radius: 9, count: 90, seed: 39 } }));
  items.push(prop('reed-bed', -50, 30, { options: { radius: 8, count: 80, seed: 41 } }));
  items.push(prop('reed-bed', 52, 32, { options: { radius: 8, count: 80, seed: 43 } }));

  items.push(prop('channel-marker', -66, -8, { options: { height: 15, red: true, seed: 31 } }));
  items.push(prop('channel-marker', 62, -12, { options: { height: 14, red: false, seed: 33 } }));
  items.push(
    prop('info-placard', 40, 34, {
      rotY: face(40, 34),
      options: {
        eyebrow: 'Mark twain', title: 'Two fathoms', accent: '#5f5040',
        body: 'A leadsman swung a weighted line and called the depth. "Mark twain" meant two fathoms — twelve feet — just enough water to be safe. Samuel Clemens was a licensed river pilot before he was a writer, and took the call for his pen name.',
      },
    }),
  );

  // --- Bank and trees -----------------------------------------------------
  [[-14, 58], [14, 60], [-28, 74], [28, 76]].forEach(([x, z], i) => {
    items.push(prop('shade-tree', x, z, { options: { height: 22 + (i % 2) * 5, seed: 400 + i * 7, leafColor: 0x4e6b3a } }));
  });
  items.push(prop('moon-rocks', -46, 6, { options: { count: 8, spread: 11, colors: [0x7d7466, 0x5f5a4e, 0x8e8778], seed: 501 } }));
  items.push(prop('moon-rocks', 48, 2, { options: { count: 7, spread: 10, colors: [0x6b6458, 0x8a8272, 0x565044], seed: 503 } }));
  items.push(prop('wildflowers', -20, 66, { options: { radius: 8, count: 110, seed: 601 } }));
  items.push(prop('wildflowers', 22, 68, { options: { radius: 7, count: 90, seed: 603 } }));
  const benches3 = [[-12, 50], [12, 52]];
  benches3.forEach(([x, z]) => items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI, options: { length: 5 } })));
  items.push(prop('lamp-post', -20, 56, { options: { height: 12, seed: 701 } }));
  items.push(prop('lamp-post', 20, 58, { options: { height: 12, seed: 703 } }));

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 22, 78, {
      rotY: face(22, 78),
      options: { lines: ['THE DELTA LANDING'], subtitle: 'A sternwheel packet on the Mississippi, about 1870', width: 15, height: 4.2 },
    }),
  );
  items.push(...browserStation(-11, 76, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-26, 72, {
      number: 1, rotY: face(-26, 72), accent: '#9a3226',
      title: 'Cast off and head downriver',
      target: 'Click the steamboat → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('glide 90 feet over 12 seconds', 1),
        moveStep('go back to start', 1),
        ctrlStep('wait 2 seconds', 1),
      ],
      tip: 'Now compare the two movement blocks. "move forward" jumps the whole distance at once; "glide" spreads it over the seconds you give it, so a boat this size stops teleporting and starts steaming. Downstream a packet made 15 mph and upstream barely 5 — try 12 seconds one way and 36 the other.',
    }),
  );
  items.push(
    activity(26, 70, {
      number: 2, rotY: face(26, 70), accent: '#6b5842',
      title: 'Pole the pirogue across',
      target: 'Click one of the little dug-out boats → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 20 feet', 1), ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move forward 20 feet', 1), ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'A pirogue is dug from a single cypress log and draws a few inches, so it goes where the steamboat cannot. Because move forward follows the way it points, you can give it four sides instead of two: repeat 4 times holding move forward and rotate 90 degrees.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(-4, -30, 16, ORB_WARM));
  items.push(orb(-30, -14, 10, ORB_WARM));
  items.push(orb(-58, 62, 9, ORB_WHITE));
  items.push(orb(58, 66, 9, ORB_WHITE));

  return { theme: 'delta', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Roman Colosseum
// ---------------------------------------------------------------------------

// The Flavian Amphitheatre at about a third of real size (see RomeProps.js for why), with
// the Arch of Constantine beside it and a corner of the Forum beyond.
//
// The composition is the approach a visitor actually makes: you come up out of the metro
// on the north-west side, the arch is on your right, and the Colosseum fills everything
// else. So the spawn is off the building's long axis rather than square-on to it -- a
// perfectly axial view of an ellipse hides the fact that it IS an ellipse.
function colosseumLayout() {
  const items = [];
  const SP = { x: 62, z: 150 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The amphitheatre ---------------------------------------------------
  // The surviving outer wall is set to the arc facing the spawn, so the student arrives
  // looking at four storeys of travertine rather than at the gap where they used to be.
  items.push(prop('colosseum', 0, 0, {
    options: { radiusX: 100, radiusZ: 82, height: 50, bays: 80, ruinFrom: 0.02, ruinTo: 0.52, seed: 5 },
  }));
  items.push(prop('hypogeum', 0, 0, { options: { radiusX: 47, radiusZ: 29, deck: 0.42, seed: 11 } }));

  items.push(
    prop('info-placard', 52, 118, {
      rotY: face(52, 118),
      options: {
        eyebrow: 'Built here at a third of full size', title: 'The Colosseum', accent: '#a8834a',
        body: 'The real one is 615ft by 510ft and 157ft tall — bigger than this whole world, which is why it is built smaller here. Eighty arches ring the ground floor and they were numbered: your pottery ticket gave you a gate, a stair and a row, and fifty thousand people could clear the building in minutes. Modern stadiums still use the plan.',
      },
    }),
  );
  items.push(
    prop('info-placard', -58, 112, {
      rotY: face(-58, 112),
      options: {
        eyebrow: 'Two thirds of it is missing', title: 'Where the rest went', accent: '#8c7a56',
        body: 'It was not destroyed in a war. Earthquakes brought down the south side, and then for a thousand years Rome quarried it — the travertine went into palaces, bridges and St Peter\'s. What you can see of the outer wall is the piece nobody got round to taking. The holes all over it are where iron cramps were levered out.',
      },
    }),
  );
  items.push(
    prop('info-placard', 20, -104, {
      rotY: facing(20, -104, 0, 0),
      options: {
        eyebrow: 'Under the floor', title: 'The hypogeum', accent: '#9c6a4e',
        body: 'The arena floor is gone, so you can see the two storeys of tunnels underneath it. Thirty-two lifts worked by counterweight brought animals and scenery straight up into the arena through trapdoors. The wooden deck at one end is a modern reconstruction, put there so people can see how high the floor was.',
      },
    }),
  );

  // --- The Arch of Constantine -------------------------------------------
  // Proportions matter more than size here: the real arch is 85ft wide and 69ft high, so
  // it is WIDER than it is tall. Built the other way round it reads as a gate tower.
  items.push(prop('arch-of-constantine', 118, 62, { rotY: facing(118, 62, SP.x, SP.z), options: { width: 34, height: 27, depth: 10, seed: 7 } }));
  items.push(
    prop('info-placard', 104, 88, {
      rotY: face(104, 88),
      options: {
        eyebrow: 'Second-hand sculpture', title: 'The Arch of Constantine', accent: '#8a7f6c',
        body: 'Put up in 315 AD, and most of the carving on it is older than the arch: roundels from a monument of Hadrian\'s, panels from Marcus Aurelius, statues from Trajan. Faces were recut to look like Constantine. Historians argue about whether that was thrift, hurry, or a deliberate claim to stand in a line of good emperors.',
      },
    }),
  );

  // --- A corner of the Forum ---------------------------------------------
  items.push(prop('forum-columns', -128, 34, { rotY: 0.35, options: { count: 6, height: 26, spacing: 9, seed: 17 } }));
  items.push(prop('forum-columns', -142, -28, { rotY: 1.2, options: { count: 4, height: 21, spacing: 8, entablature: false, seed: 23 } }));
  items.push(prop('she-wolf-column', -104, 76, { rotY: facing(-104, 76, SP.x, SP.z), options: { height: 13, seed: 21 } }));
  items.push(
    prop('info-placard', -96, 60, {
      rotY: face(-96, 60),
      options: {
        eyebrow: 'The city\'s own founding story', title: 'The she-wolf', accent: '#5c6b4a',
        body: 'Rome said it was founded by twins raised by a wolf. Romulus killed Remus in an argument over where the walls should go, and named the city after himself. Romans knew it was a legend and told it anyway — it says the place was built by outcasts and settled by force, which is closer to the truth than most founding stories manage.',
      },
    }),
  );

  // --- Gladiators ---------------------------------------------------------
  // In the arena, on the exposed hypogeum floor. They are the one thing here at true human
  // size, which is deliberate: the building is at a third, so a 5ft 6 figure standing in
  // it gives the eye something it actually knows the size of.
  items.push(prop('gladiator', -16, 8, { rotY: 0.4, options: { height: 5.6, tunic: 0xb04a3a, seed: 3 } }));
  items.push(prop('gladiator', 8, -12, { rotY: 3.5, options: { height: 5.6, tunic: 0x3f6b8a, seed: 9 } }));
  items.push(prop('gladiator', 122, 40, { rotY: facing(122, 40, SP.x, SP.z), options: { height: 5.6, tunic: 0x8a6a3f, seed: 15 } }));
  items.push(
    prop('info-placard', -34, 22, {
      rotY: facing(-34, 22, 0, 40),
      options: {
        eyebrow: 'Mostly they did not die', title: 'Gladiators', accent: '#8c4a3a',
        body: 'A trained gladiator was expensive — years of feeding, coaching and doctoring — so the owner who lent him out wanted him back. Fights were refereed, and most ended with a surrender. Some were free men who volunteered for the money. Most were slaves or prisoners, and none of that was their choice.',
      },
    }),
  );

  // --- The setting --------------------------------------------------------
  // Umbrella pines. They are the reason a photograph of this place is recognisable as Rome
  // rather than as any ruin anywhere, so there are enough of them to read as a stand.
  const pines = [
    [-152, 96, 36], [-118, 128, 32], [136, 118, 34], [162, 74, 30],
    [-166, -44, 33], [-138, -104, 31], [96, -134, 35], [30, -160, 32],
    [-46, -156, 30], [168, -22, 33], [124, 146, 29],
  ];
  pines.forEach(([x, z, h], i) => items.push(prop('stone-pine', x, z, { options: { height: h, seed: 200 + i * 7 } })));
  const cypresses = [[-92, 118, 24], [-78, 132, 21], [148, 96, 23], [158, 108, 20], [-158, 22, 22], [-150, -70, 24]];
  cypresses.forEach(([x, z, h], i) => items.push(prop('italian-cypress', x, z, { options: { height: h, seed: 300 + i * 5 } })));

  // Fallen blocks, always downhill of the gap in the wall.
  [[-118, -78], [-96, -108], [-64, -128], [-136, -40], [24, -138], [78, -122]].forEach(([x, z], i) => {
    items.push(prop('travertine-rubble', x, z, { options: { spread: 11 + (i % 3) * 3, count: 8 + (i % 4), seed: 400 + i * 11 } }));
  });

  items.push(prop('basalt-paving', 84, 122, { rotY: 0.42, options: { width: 18, depth: 40, seed: 27 } }));
  items.push(prop('basalt-paving', 116, 88, { rotY: 1.1, options: { width: 14, depth: 30, seed: 29 } }));
  items.push(prop('roman-fountain', 74, 106, { options: { height: 3.6, seed: 23 } }));
  items.push(prop('roman-fountain', -88, 96, { options: { height: 3.6, seed: 31 } }));

  [[70, 132], [98, 108], [-70, 104], [130, 84]].forEach(([x, z]) => {
    items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI, options: { length: 5 } }));
  });
  // The lamp posts stay OFF the arrival sightline. The first pass put one at (56, 134),
  // two degrees off the line from the spawn to the building, so a student arrived looking
  // at a 13ft pole standing like a bollard in the middle of the Colosseum -- the same
  // mistake, and the same fix, as the lamp on Broadway in the New York world.
  [[44, 138], [110, 96], [-82, 110], [140, 70]].forEach(([x, z], i) => {
    items.push(prop('lamp-post', x, z, { options: { height: 13, seed: 500 + i } }));
  });

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 84, 156, {
      rotY: face(84, 156),
      options: { lines: ['THE COLOSSEUM'], subtitle: 'Rome · begun 72 AD · finished in eight years', width: 16, height: 4.4 },
    }),
  );
  items.push(...browserStation(48, 140, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(34, 137, {
      number: 1, rotY: face(34, 137), accent: '#a8834a',
      title: 'March a gladiator round the arena',
      target: 'Click a gladiator in the arena → Program.',
      steps: [
        ctrlStep('repeat 4 times'),
        moveStep('move forward 30 feet', 1),
        ctrlStep('wait 1 seconds', 1),
        moveStep('rotate 90 degrees', 1),
        ctrlStep('wait 0.5 seconds', 1),
      ],
      tip: 'Four sides, four right turns — 360 divided by 4 is 90, so he ends up exactly where he began. Try five sides: what angle do you need? Then swap move forward for glide 30 feet over 3 seconds and watch the difference between jumping and travelling.',
    }),
  );
  items.push(
    activity(74, 122, {
      number: 2, rotY: face(74, 122), accent: '#8c7a56',
      title: 'Two gladiators, one signal',
      target: 'Click the gladiator by the arch → Program. Then click one in the arena.',
      steps: [
        lookStep('say ready'),
        ctrlStep('wait 2 seconds'),
        lookStep('say fight'),
        ctrlStep('when an object says fight'),
        moveStep('move forward 14 feet', 1),
        lookStep('change color to red', 1),
      ],
      tip: 'The first three blocks go on ONE gladiator. The when-an-object-says block goes on the OTHER one — it sits and waits until it hears the word. This is how you make two objects work together instead of each doing its own thing.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(0, 0, 26, ORB_WARM));
  items.push(orb(118, 62, 16, ORB_WARM));
  items.push(orb(-30, 60, 9, ORB_WHITE));

  return { theme: 'colosseum', spawn: { ...SP, yaw: Math.atan2(-(0 - SP.x), -(0 - SP.z)) }, items };
}

// ---------------------------------------------------------------------------
// Machu Picchu
// ---------------------------------------------------------------------------

// The citadel on the ridge, mostly at true size -- an Inca house is a house and a terrace
// wall is eight feet of stone. Only the mountain is scaled.
//
// The layout is the site's own: terraces on the approach, then the main plaza with the
// buildings up the west side, the Temple of the Sun on its outcrop, the Intihuatana on the
// highest point, and Huayna Picchu closing the view to the north.
function machuPicchuLayout() {
  const items = [];
  const SP = { x: 0, z: 128 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The agricultural sector -------------------------------------------
  // The terraces FLANK the approach; they do not cross it. A seven-step andenes bank is
  // 31ft of stone, and the first version of this world put two of them straight across the
  // arrival sightline -- which walled the entire citadel off behind a rampart and left a
  // student looking at nothing but the back of a retaining wall. Turned side-on they do
  // the job they should: they frame the walk in, and you read them as terraces because you
  // can see the steps in profile rather than end-on.
  items.push(prop('inca-terraces', -76, 74, { rotY: 1.5, options: { width: 62, steps: 7, rise: 4.5, tread: 8.5, curve: 4, seed: 7 } }));
  items.push(prop('inca-terraces', 78, 70, { rotY: -1.5, options: { width: 56, steps: 6, rise: 4.5, tread: 8.5, curve: 3, seed: 13 } }));
  items.push(prop('inca-terraces', -84, 6, { rotY: 1.45, options: { width: 46, steps: 5, rise: 4.2, tread: 8, curve: 3, seed: 19 } }));
  items.push(prop('inca-stairs', -50, 84, { rotY: -0.9, options: { width: 7, steps: 14, rise: 1.1, run: 1.35, seed: 19 } }));

  items.push(
    prop('info-placard', -52, 100, {
      rotY: face(-52, 100),
      options: {
        eyebrow: 'Not just flat ground', title: 'The terraces', accent: '#7a8a4e',
        body: 'Each one is built in layers: broken rock at the bottom, then gravel, then sand, then topsoil carried up from the valley. Six feet of rain falls here every year, and the terraces drain it THROUGH the mountain instead of letting it wash the mountain away. That is why the site is still standing and most of what the Spanish built later is not.',
      },
    }),
  );

  // --- The town -----------------------------------------------------------
  // Houses up the western side, facing the plaza. Roofs on some and not on others: what
  // survives is the stonework, and the thatch is all reconstruction.
  const houses = [
    [-52, 34, 18, 12, true, 0.15], [-54, 12, 16, 11, true, 0.1], [-50, -10, 15, 11, false, 0.08],
    [-56, -32, 17, 12, true, 0.0], [-44, -52, 14, 10, false, -0.1], [-60, -8, 12, 9, false, 1.55],
  ];
  houses.forEach(([x, z, w, d, roofed, r], i) => {
    items.push(prop('inca-house', x, z, { rotY: r, options: { width: w, depth: d, wallHeight: 8, roofed, seed: 100 + i * 9 } }));
  });
  const eastHouses = [[56, 28, 15, 11, true, -0.2], [58, 4, 14, 10, false, -0.12], [52, -22, 16, 11, true, -0.05]];
  eastHouses.forEach(([x, z, w, d, roofed, r], i) => {
    items.push(prop('inca-house', x, z, { rotY: r, options: { width: w, depth: d, wallHeight: 8, roofed, seed: 160 + i * 9 } }));
  });

  // The walls between them, with their trapezoidal doorways -- the teaching object of the
  // whole world.
  items.push(prop('inca-wall', -30, 46, { rotY: 0.1, options: { width: 20, height: 9, doorway: true, niches: 2, seed: 5 } }));
  items.push(prop('inca-wall', 30, 40, { rotY: -0.1, options: { width: 18, height: 8.5, doorway: true, niches: 2, seed: 11 } }));
  items.push(prop('inca-wall', -20, -46, { rotY: 1.5, options: { width: 22, height: 10, doorway: false, niches: 3, seed: 17 } }));
  items.push(
    prop('info-placard', -18, 58, {
      rotY: face(-18, 58),
      options: {
        eyebrow: 'No mortar anywhere', title: 'How the stones fit', accent: '#8a8578',
        body: 'Every block was shaped to fit the ones already laid — not cut to a standard size, which is why no two are alike and why the joints wander. A knife blade will not go into them. The walls lean inward and every door and window is a trapezoid, wider at the bottom: all of it is earthquake engineering, and it works.',
      },
    }),
  );

  // --- The sacred sector --------------------------------------------------
  items.push(prop('temple-of-the-sun', -22, -14, { rotY: 0.4, options: { radius: 11, height: 12, seed: 11 } }));
  items.push(
    prop('info-placard', -8, 4, {
      rotY: facing(-8, 4, 0, 60),
      options: {
        eyebrow: 'The only curved wall on the site', title: 'The Temple of the Sun', accent: '#a39683',
        body: 'A window here is cut so that at sunrise on the June solstice — midwinter in Peru — the light falls exactly along a line carved into the rock inside. The building is a calendar. It is built onto the living granite rather than onto foundations, and the masons cut the mountain to receive it.',
      },
    }),
  );

  items.push(prop('intihuatana', 4, -66, { rotY: 0.2, options: { height: 6, seed: 13 } }));
  items.push(
    prop('info-placard', 24, -54, {
      rotY: facing(24, -54, 0, 20),
      options: {
        eyebrow: '"The place that ties the sun"', title: 'The Intihuatana', accent: '#9a958c',
        body: 'One piece of granite, carved where it stood out of the bedrock. Its edges point to the four directions and at the equinoxes the pillar casts almost no shadow at midday. The Spanish smashed every one of these they found, as idols. This one survived because they never found the site.',
      },
    }),
  );
  items.push(prop('inca-stairs', 4, -46, { options: { width: 6, steps: 12, rise: 1.1, run: 1.3, seed: 23 } }));

  items.push(prop('inca-fountain', -40, 62, { rotY: 0.1, options: { height: 4.2, seed: 23 } }));
  items.push(prop('inca-fountain', -42, 48, { rotY: 0.1, options: { height: 4.2, seed: 29 } }));
  items.push(
    prop('info-placard', -30, 70, {
      rotY: face(-30, 70),
      options: {
        eyebrow: 'Sixteen of them, running downhill', title: 'The fountains', accent: '#5c7a86',
        body: 'A spring on the mountainside feeds a stone channel nearly half a mile long, which drops through the city from one fountain to the next. The first one is at the top by the temple; the last is at the bottom. It still runs. Getting water to arrive where you want it, at the right speed, down a mountain, is the hardest thing on this site.',
      },
    }),
  );

  // --- The landscape ------------------------------------------------------
  // Huayna Picchu behind the citadel, and two lesser peaks to give the ridge a horizon.
  items.push(prop('andean-peak', -18, -168, { options: { height: 132, baseRadius: 62, sugarloaf: true, seed: 29 } }));
  items.push(prop('andean-peak', 152, -86, { options: { height: 96, baseRadius: 58, sugarloaf: false, snow: true, seed: 37 } }));
  items.push(prop('andean-peak', -168, -60, { options: { height: 104, baseRadius: 64, sugarloaf: false, snow: true, seed: 41 } }));
  // Cloud lying in the valley, and it has to be FAR and LOW -- around the student's own
  // eye line, not above it. Brought in close, or lifted into the sky, it stops being
  // weather in a valley and becomes a white lump parked on the hillside beside you.
  items.push(prop('cloud-bank', -46, -176, { y: 14, absoluteY: true, options: { width: 200, depth: 70, seed: 31 } }));
  items.push(prop('cloud-bank', 172, -40, { y: 10, absoluteY: true, options: { width: 150, depth: 70, seed: 43 } }));
  items.push(prop('cloud-bank', -176, -112, { y: 12, absoluteY: true, options: { width: 140, depth: 60, seed: 47 } }));

  const outcrops = [[-70, -34, 9], [64, -50, 8], [-88, 10, 10], [80, 62, 7], [-14, -92, 11], [46, -80, 8]];
  outcrops.forEach(([x, z, s], i) => items.push(prop('granite-outcrop', x, z, { options: { size: s, seed: 500 + i * 7 } })));
  const grass = [[-64, 70], [72, 78], [-90, -14], [88, -20], [-34, -84], [34, -96], [-100, 46], [104, 40]];
  grass.forEach(([x, z], i) => items.push(prop('ichu-grass', x, z, { options: { radius: 6, count: 20, seed: 600 + i * 5 } })));

  // Llamas on the terraces, which is exactly where they are.
  items.push(prop('llama', -26, 74, { rotY: 1.2, options: { height: 5.6, seed: 37 } }));
  items.push(prop('llama', -16, 66, { rotY: 2.1, options: { height: 5.2, fleece: 0x8a7358, seed: 41 } }));
  items.push(prop('llama', 34, 70, { rotY: -0.8, options: { height: 5.4, fleece: 0xe4dccc, seed: 43 } }));
  items.push(
    prop('info-placard', -44, 82, {
      rotY: face(-44, 82),
      options: {
        eyebrow: 'Why there are no carts here', title: 'Llamas', accent: '#a08a62',
        body: 'The Inca built 25,000 miles of road across the Andes and never used a wheel on any of it. A wheel is no use on a staircase cut into a cliff; a llama walks up it carrying a hundred pounds. They also refuse to move if you overload them, which makes them very hard to abuse.',
      },
    }),
  );

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 30, 138, {
      rotY: face(30, 138),
      options: { lines: ['MACHU PICCHU'], subtitle: '7,970 feet · built about 1450 · abandoned within a century', width: 17, height: 4.4 },
    }),
  );
  items.push(...browserStation(-10, 118, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-32, 126, {
      number: 1, rotY: face(-32, 126), accent: '#8a8578',
      title: 'Take a llama up the terraces',
      target: 'Click a llama on the terraces → Program.',
      steps: [
        ctrlStep('repeat 6 times'),
        moveStep('glide 8 feet over 2 seconds', 1),
        moveStep('move up by 4.5 feet', 1),
        ctrlStep('wait 0.4 seconds', 1),
      ],
      tip: 'Each terrace is about eight feet deep and four and a half feet high, so this walks it up one step at a time. Glide travels the way the llama is facing; move up is always straight up, whichever way it points. Turn the llama round first and the same program climbs in a different direction.',
    }),
  );
  items.push(
    activity(34, 122, {
      number: 2, rotY: face(34, 122), accent: '#7a8a4e',
      title: 'Make the sun tie itself',
      target: 'Click the Intihuatana stone → Program.',
      steps: [
        ctrlStep('forever'),
        moveStep('rotate 4 degrees', 1),
        lookStep('set size to 104 %', 1),
        ctrlStep('wait 0.2 seconds', 1),
        lookStep('set size to 100 %', 1),
        ctrlStep('wait 0.2 seconds', 1),
      ],
      tip: 'Set size to is ABSOLUTE — it always measures from the size the stone started at, so 104 then 100 makes it pulse instead of growing forever. Change size by would double it every pass and the stone would swallow the mountain in about ten seconds. Try it and see.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(-22, -14, 8, ORB_WARM));
  items.push(orb(-52, 34, 9, ORB_WARM));
  items.push(orb(4, -66, 7, ORB_WHITE));

  return { theme: 'machupicchu', spawn: { ...SP, yaw: Math.atan2(-(0 - SP.x), -(-40 - SP.z)) }, items };
}

// ---------------------------------------------------------------------------
// The Taj Mahal
// ---------------------------------------------------------------------------

// The classic view: standing just inside the great gate, on the axis, with the canal
// running away to the plinth.
//
// The whole complex is a symmetry argument, so the layout is written as mirrored pairs
// rather than as a list of positions -- if a number appears once here it is because that
// object genuinely is on the centre line.
function tajLayout() {
  const items = [];
  const SP = { x: 0, z: 132 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);
  const TAJ_Z = -68;

  // --- The mausoleum ------------------------------------------------------
  items.push(prop('taj-mahal', 0, TAJ_Z, { options: { width: 75, height: 100, seed: 5 } }));

  // The four minarets, on the corners of the plinth. Each leans OUTWARD, which is what the
  // `rotY` is doing here: the builder tilts about its own local X, so turning the prop to
  // face the centre and then tipping it forward would lean it IN. Facing away is what
  // leans it out.
  const MIN = 64;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
    const x = sx * MIN;
    const z = TAJ_Z + sz * MIN;
    items.push(prop('taj-minaret', x, z, {
      rotY: facing(0, TAJ_Z, x, z),
      options: { height: 57, lean: 2, stages: 3, seed: 7 + i },
    }));
  });

  items.push(
    prop('info-placard', -46, 22, {
      rotY: face(-46, 22),
      options: {
        eyebrow: 'They lean on purpose', title: 'The four minarets', accent: '#c4bcaa',
        body: 'Each one tilts about two degrees away from the tomb. If an earthquake brought them down they would fall outward, away from the mausoleum — the same reasoning that puts a tree feller on the uphill side. They are also very slightly shorter than they look, because they are set on the plinth rather than beside it.',
      },
    }),
  );
  items.push(
    prop('info-placard', 46, 22, {
      rotY: face(46, 22),
      options: {
        eyebrow: 'A tomb for one person', title: 'Why it was built', accent: '#a8503a',
        body: 'Shah Jahan built it for Mumtaz Mahal, who died in 1631 having their fourteenth child. It took twenty-two years, twenty thousand workers and a thousand elephants to haul the marble 200 miles from Makrana. He was deposed by his own son and spent his last eight years imprisoned in the fort downriver, where he could see it.',
      },
    }),
  );

  // --- The garden ---------------------------------------------------------
  // The charbagh: four quarters divided by water. The canal is the reason the building is
  // delivered twice, once in stone and once upside down.
  items.push(prop('charbagh-canal', 0, 66, { options: { length: 76, width: 10, jets: 5, seed: 17 } }));
  items.push(prop('charbagh-canal', 0, 6, { options: { length: 34, width: 10, jets: 3, seed: 19 } }));
  items.push(prop('charbagh-canal', 0, 28, { rotY: Math.PI / 2, options: { length: 74, width: 10, jets: 5, seed: 21 } }));

  // Cypresses in rows down the canal. Formal, evenly spaced, and dark: they are
  // architecture in a garden like this, not planting.
  //
  // They are set WIDE of the water and kept to one row a side. The first pass ran them at
  // x = ±12 with a second family crossing behind, thirty trees in all, and the two things
  // they framed the view of were each other: the mosque and the jawab -- the pair the
  // whole symmetry argument rests on -- were completely hidden behind them from the only
  // place a student arrives.
  for (let i = 0; i < 7; i++) {
    const z = 32 + i * 12;
    for (const sx of [-1, 1]) {
      items.push(prop('garden-cypress', sx * 17, z, { options: { height: 18 + (i % 3), seed: 300 + i * 5 + (sx > 0 ? 1 : 0) } }));
    }
  }
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      items.push(prop('garden-cypress', sx * (34 + i * 13), 16, { options: { height: 16 + (i % 3), seed: 400 + i * 7 + (sx > 0 ? 1 : 0) } }));
    }
  }

  // --- The flanking buildings --------------------------------------------
  // The mosque west, the jawab east. The jawab was never a mosque and has no mihrab: it
  // exists so the composition is symmetrical, which tells you what mattered here.
  items.push(prop('taj-mosque', -74, TAJ_Z, { rotY: Math.PI / 2, options: { width: 46, depth: 22, height: 26, seed: 13 } }));
  items.push(prop('taj-mosque', 74, TAJ_Z, { rotY: -Math.PI / 2, options: { width: 46, depth: 22, height: 26, seed: 14 } }));
  items.push(
    prop('info-placard', -60, -26, {
      rotY: facing(-60, -26, 0, 40),
      options: {
        eyebrow: 'One of these is not a mosque', title: 'The mosque and the jawab', accent: '#8e4130',
        body: 'The building on the west is a working mosque, facing Mecca. The one on the east is its mirror image and always has been empty — jawab means "answer". It was built purely so that the view has the same thing on both sides. Symmetry mattered more than function, and that is the argument of the whole complex.',
      },
    }),
  );

  // --- The gate -----------------------------------------------------------
  items.push(prop('taj-gateway', 0, 152, { rotY: Math.PI, options: { width: 62, height: 46, depth: 20, seed: 11 } }));
  items.push(
    prop('info-placard', -34, 138, {
      rotY: face(-34, 138),
      options: {
        eyebrow: 'You are meant to arrive through it', title: 'The great gate', accent: '#a8503a',
        body: 'From outside, the gate hides the Taj completely. You walk through the arch and the whole building appears at once, framed and reflected. That is the design: the complex is arranged so the first view is a single event. Red sandstone here, white marble there — the colour change is doing the same work.',
      },
    }),
  );

  // --- Detail worth standing next to -------------------------------------
  items.push(prop('marble-screen', -18, -10, { rotY: 0.35, options: { width: 9, height: 10, seed: 23 } }));
  items.push(prop('marble-screen', 18, -10, { rotY: -0.35, options: { width: 9, height: 10, seed: 24 } }));
  items.push(prop('cenotaph', -7, -22, { options: { length: 9, width: 4.5, height: 4.4, ornate: false, seed: 29 } }));
  items.push(prop('cenotaph', 6, -25, { rotY: 0.06, options: { length: 8, width: 4, height: 4, ornate: true, seed: 31 } }));
  items.push(
    prop('info-placard', 26, -14, {
      rotY: facing(26, -14, 0, 40),
      options: {
        eyebrow: 'Both of these are empty', title: 'The cenotaphs', accent: '#c4bcaa',
        body: 'The two marble boxes under the dome are markers. The real graves are in a plain crypt below, unmarked and closed. Mumtaz\'s marker is dead centre; Shah Jahan\'s was squeezed in beside it after he died, and it is the ONLY thing in the entire building that is not symmetrical.',
      },
    }),
  );

  // --- Grounds ------------------------------------------------------------
  [[-52, 96], [52, 96], [-52, 60], [52, 60]].forEach(([x, z], i) => {
    items.push(prop('flower-bed', x, z, { rotY: (i % 2 ? 1 : -1) * 0.2, options: { width: 14, depth: 6, seed: 700 + i * 9 } }));
  });
  [[-24, 104], [24, 104], [-24, 40], [24, 40]].forEach(([x, z]) => {
    items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI, options: { length: 5 } }));
  });
  [[-40, 118], [40, 118], [-40, 78], [40, 78]].forEach(([x, z], i) => {
    items.push(prop('lamp-post', x, z, { options: { height: 11, seed: 800 + i } }));
  });
  [[-64, 122], [64, 122], [-70, 44], [70, 44]].forEach(([x, z], i) => {
    items.push(prop('shade-tree', x, z, { options: { height: 22 + (i % 3) * 3, seed: 900 + i * 7, leafColor: 0x4a6b32 } }));
  });

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 34, 128, {
      rotY: face(34, 128),
      options: { lines: ['THE TAJ MAHAL'], subtitle: 'Agra · 1632–1653 · white marble from Makrana', width: 16, height: 4.4 },
    }),
  );
  items.push(...browserStation(-24, 122, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-44, 132, {
      number: 1, rotY: face(-44, 132), accent: '#c4bcaa',
      title: 'Straighten a minaret',
      target: 'Click any one of the four minarets → Program.',
      steps: [
        lookStep('say leaning'),
        ctrlStep('wait 1 seconds'),
        moveStep('move up by 14 feet'),
        ctrlStep('wait 1 seconds'),
        moveStep('move up by -14 feet'),
        lookStep('set opacity to 45 %'),
      ],
      tip: 'Lift one out of the row and the lean is obvious against the three that are left. Then set opacity to 45% and you can see the tomb straight through it. Put it back with set opacity to 100% — or with go back to start, which undoes everything at once.',
    }),
  );
  items.push(
    activity(44, 132, {
      number: 2, rotY: face(44, 132), accent: '#a8503a',
      title: 'Send a cypress down the canal',
      target: 'Click a cypress beside the water → Program.',
      steps: [
        ctrlStep('repeat 8 times'),
        moveStep('glide 12 feet over 1.5 seconds', 1),
        lookStep('change size by -8 %', 1),
        moveStep('rotate 45 degrees', 1),
        moveStep('go back to start'),
      ],
      tip: 'It shrinks as it goes, so it looks like it is walking away from you. Go back to start puts it exactly where it began — position, turn and size all at once — which is the block to reach for whenever a program has made a mess.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(0, TAJ_Z, 46, ORB_WARM));
  items.push(orb(0, 100, 10, ORB_WARM));
  items.push(orb(-74, TAJ_Z, 16, ORB_WHITE));
  items.push(orb(74, TAJ_Z, 16, ORB_WHITE));

  return { theme: 'tajmahal', spawn: { ...SP, yaw: Math.atan2(-(0 - SP.x), -(TAJ_Z - SP.z)) }, items };
}

// ---------------------------------------------------------------------------
// Red Square
// ---------------------------------------------------------------------------

// Moscow in winter. St Basil's at the south end, the Kremlin wall and Lenin's tomb down
// the west side, GUM down the east, the History Museum closing the north.
//
// The square is really 1,090ft long and that will not fit, so the buildings are brought in
// to about 200ft apart. That is the right thing to compress: nobody remembers the square's
// proportions, and everybody remembers the domes.
function redSquareLayout() {
  const items = [];
  // The spawn is 220ft back from the cathedral, and that distance is set by its HEIGHT
  // rather than by how much room the square needs. At 155ft tall and 196ft away, the tent
  // roof and the top three domes -- the whole reason to build this world -- sat above the
  // top of the frame on arrival. The camera's 70 degree fov is vertical, so 35 degrees is
  // all there is above the horizon, and 220ft is what brings the finial inside it.
  const SP = { x: 0, z: 120 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- St Basil's ---------------------------------------------------------
  // `radius` is the plan across the eight chapels, and it was 34 at first, which made the
  // cathedral half as wide as it is tall. The real building is about two thirds as wide as
  // high -- it is a squat, crowded, top-heavy thing, and stretched thin it turns into a
  // generic spire.
  items.push(prop('st-basils', 0, -100, { options: { height: 155, radius: 44, seed: 5 } }));
  items.push(
    prop('info-placard', -40, -46, {
      rotY: facing(-40, -46, 0, 40),
      options: {
        eyebrow: 'Nine churches on one foundation', title: "St Basil's Cathedral", accent: '#c8452f',
        body: 'Eight chapels arranged as an eight-pointed star around a ninth in the middle, each with its own dome — and no two domes are alike. Ivan the Terrible had it built in 1561 to mark a victory. The story that he blinded the architect so it could never be repeated is almost certainly untrue: the same man went on to build something else.',
      },
    }),
  );
  items.push(
    prop('info-placard', 40, -46, {
      rotY: facing(40, -46, 0, 40),
      options: {
        eyebrow: 'It was white for a hundred years', title: 'The domes', accent: '#2e5fa8',
        body: 'The colour is not original. The cathedral stood white with gold domes until the 1680s, and the spirals, chevrons and facets were painted on later. Nobody is certain why. The shape is not borrowed either — the tall tent roof in the middle is Russian, and you will not find it on a Byzantine church.',
      },
    }),
  );

  // --- The Kremlin side ---------------------------------------------------
  // The wall runs the length of the west side, with the Spasskaya tower on the square and
  // the Nikolskaya at the far end.
  //
  // The whole west side is pulled IN to x = -74. At -92 the Spasskaya -- the tower with
  // the clock and the ruby star, and the single most photographed thing on this side of
  // the square -- sat 49 degrees off the arrival sightline and was clipped straight off
  // the edge of the frame. The camera's 70 degree fov is VERTICAL, so a 16:9 screen only
  // sees about 51 degrees either side, and 49 is not "just inside", it is on the bezel.
  items.push(prop('kremlin-wall', -74, -34, { rotY: Math.PI / 2, options: { length: 86, height: 26, depth: 12, seed: 7 } }));
  items.push(prop('kremlin-wall', -74, 66, { rotY: Math.PI / 2, options: { length: 78, height: 26, depth: 12, seed: 9 } }));
  items.push(prop('kremlin-tower', -74, 0, { rotY: Math.PI / 2, options: { height: 130, base: 18, clock: true, star: true, seed: 11 } }));
  items.push(prop('kremlin-tower', -74, 112, { rotY: Math.PI / 2, options: { height: 104, base: 15, clock: false, star: true, seed: 13 } }));
  items.push(prop('kremlin-tower', -74, -84, { rotY: Math.PI / 2, options: { height: 88, base: 13, clock: false, star: false, seed: 17 } }));
  items.push(prop('lenin-mausoleum', -52, 6, { rotY: Math.PI / 2, options: { width: 40, height: 24, depth: 30, seed: 13 } }));

  items.push(
    prop('info-placard', -34, 34, {
      rotY: face(-34, 34),
      options: {
        eyebrow: 'The clock is 20 feet across', title: 'The Spasskaya Tower', accent: '#a8503c',
        body: 'The gate tower on the square, and the one the chimes come from at New Year. The ruby star on top went up in 1937, replacing a double-headed imperial eagle. It is real glass, lit from inside, and it turns in the wind. The white upper stage is 200 years younger than the brick underneath it, which is why the two do not match.',
      },
    }),
  );
  items.push(
    prop('info-placard', -30, -16, {
      rotY: face(-30, -16),
      options: {
        eyebrow: 'Red and black granite', title: "Lenin's Mausoleum", accent: '#7a3630',
        body: 'A stepped pyramid, deliberately low, so the leaders standing on the roof to watch a parade were level with the crowd rather than above it. The dark bands are labradorite, which is nearly black and flashes blue when the light catches it. Lenin himself had asked to be buried beside his mother.',
      },
    }),
  );

  // --- GUM ----------------------------------------------------------------
  items.push(prop('gum-store', 80, 16, { rotY: -Math.PI / 2, options: { length: 190, height: 46, depth: 34, seed: 17 } }));
  items.push(
    prop('info-placard', 40, 46, {
      rotY: face(40, 46),
      options: {
        eyebrow: 'A shopping arcade under glass', title: 'GUM', accent: '#8c3f2c',
        body: 'Built in 1893 with an iron and glass roof over three parallel arcades — the same engineering as a railway station, put to shopping. Under the Soviet Union it was the state department store, and for a long stretch it was mostly queues. The fountain in the middle is where Muscovites still arrange to meet.',
      },
    }),
  );

  // --- The north end ------------------------------------------------------
  items.push(prop('history-museum', 0, 152, { rotY: Math.PI, options: { length: 120, height: 62, depth: 40, seed: 19 } }));

  // --- The square ---------------------------------------------------------
  // Cobbles, not asphalt. Laid in a long strip down the middle so the paving reads under
  // foot without paving the entire world.
  items.push(prop('square-paving', 0, 30, { options: { width: 62, depth: 130, snowy: true, seed: 23 } }));
  items.push(prop('square-paving', 0, -58, { options: { width: 50, depth: 52, snowy: true, seed: 27 } }));

  const drifts = [
    [-34, 74, 16], [34, 70, 14], [-28, -8, 12], [30, -12, 15], [-16, -74, 11], [22, -76, 13],
    [-46, 118, 15], [46, 114, 12], [-40, 40, 13], [40, 36, 11], [-12, 108, 14], [14, 104, 12],
  ];
  drifts.forEach(([x, z, l], i) => items.push(prop('snow-drift', x, z, { rotY: (i % 3) * 0.6, options: { length: l, height: 2.2, seed: 700 + i * 7 } })));

  const birches = [
    [-56, 128, 25], [-44, 140, 22], [56, 132, 24], [66, 118, 21],
    [-70, 146, 26], [72, 148, 23], [-84, 132, 24], [86, 140, 22],
  ];
  birches.forEach(([x, z, h], i) => items.push(prop('birch-tree', x, z, { options: { height: h, bare: true, seed: 800 + i * 5 } })));

  [[-26, 62], [26, 62], [-26, -30], [26, -30], [-26, 14], [26, 14]].forEach(([x, z], i) => {
    items.push(prop('lamp-post', x, z, { options: { height: 15, seed: 900 + i } }));
  });
  [[-20, 100], [20, 100], [-20, 44], [20, 44], [-18, -48], [18, -48]].forEach(([x, z]) => {
    items.push(prop('bench', x, z, { rotY: face(x, z) + Math.PI, options: { length: 5 } }));
  });
  [[-34, 96], [34, 96], [-34, -4], [34, -4]].forEach(([x, z], i) => {
    items.push(prop('planter', x, z, { options: { size: 3.6, seed: 950 + i } }));
  });

  // --- Wayfinding ---------------------------------------------------------
  items.push(
    prop('standing-sign', 32, 108, {
      rotY: face(32, 108),
      options: { lines: ['RED SQUARE'], subtitle: 'Krasnaya Ploshchad — "red" here once meant "beautiful"', width: 18, height: 4.4 },
    }),
  );
  // Pulled in toward the centre line. At (-14, 104) the panel sat at 41 degrees off the
  // arrival sightline and the first activity board at 47 -- close enough that the nearer
  // one covered half of the further one from the only place a student stands on arrival.
  items.push(...browserStation(-8, 106, { faceX: SP.x, faceZ: SP.z }));

  // --- Programming challenges ---------------------------------------------
  items.push(
    activity(-30, 92, {
      number: 1, rotY: face(-30, 92), accent: '#c8452f',
      title: 'Raise the cathedral out of the snow',
      target: "Click St Basil's → Program.",
      steps: [
        moveStep('move up by 40 feet'),
        ctrlStep('wait 1 seconds'),
        ctrlStep('repeat 20 times'),
        moveStep('move up by -2 feet', 1),
        ctrlStep('wait 0.1 seconds', 1),
        lookStep('say home'),
      ],
      tip: 'Twenty steps of two feet is forty feet, so it lands exactly back where it started. Change the 20 or the -2 and it will not — that arithmetic is the whole trick, and it is the same one that puts a lift on the right floor.',
    }),
  );
  items.push(
    activity(30, 92, {
      number: 2, rotY: face(30, 92), accent: '#2e5fa8',
      title: 'A parade past the tomb',
      target: 'Click a lamp post on the square → Program.',
      steps: [
        ctrlStep('forever'),
        ctrlStep('duplicate 12 ft away', 1),
        moveStep('glide 20 feet over 2 seconds', 1),
        lookStep('change color to blue', 1),
        ctrlStep('wait 1 seconds', 1),
      ],
      tip: 'Duplicate is the only block whose effect leaves its own object, and the copies do NOT inherit it — otherwise one lamp post would become a thousand in about four seconds. Take the forever out and use repeat 5 times instead to line up exactly five.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  // Winter afternoon: the sun is weak, so the square needs real fill or the north faces of
  // everything go flat. Warm orbs against the cold ground bounce.
  items.push(orb(0, -104, 48, ORB_WARM));
  items.push(orb(-66, 6, 14, ORB_WARM));
  items.push(orb(52, 16, 20, ORB_WARM));
  items.push(orb(0, 40, 16, ORB_WHITE));

  return { theme: 'redsquare', spawn: { ...SP, yaw: Math.atan2(-(0 - SP.x), -(-104 - SP.z)) }, items };
}

// ---------------------------------------------------------------------------
// A Bug's Life
// ---------------------------------------------------------------------------

// An ant colony, at ant scale, laid out as a WORKSHOP rather than as a place to look at.
//
// It is the only preset built around challenges first and scenery second, so the shape of
// it is different from every other world here: an avenue running from the spawn down to
// the nest, with five building challenges along the left and five coding challenges along
// the right, and the whole middle strip left deliberately EMPTY. That empty strip is the
// point -- a fresh construction piece lands PRIMITIVE_SPAWN_DISTANCE ahead of the student
// and spirals out from there, so anything standing in the middle is something to build
// round. My World learned that lesson; this world is laid out to it from the start.
//
// Everything else is pushed out to the sides and the far end, which is also what makes the
// scale read: the grass towers over you at the edges of the avenue rather than in it.
function bugsLayout() {
  const items = [];
  const SP = { x: 0, z: 132 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);
  // Boards face the middle of the avenue, but angled a little back UP it toward the
  // arrival -- square to the centre line they are edge-on from the spawn and a student
  // walks past five blank rectangles before seeing a single word.
  const faceAvenue = (x, z) => facing(x, z, 0, z + 34);
  const CARD = { width: 10.5, height: 8.4, postHeight: 11.5 };

  // --- Welcome ------------------------------------------------------------
  items.push(
    prop('welcome-board', 0, 100, {
      rotY: face(0, 100),
      options: {
        eyebrow: '🐜  A BUG’S LIFE',
        lead: 'You are the size of an ant.',
        lines: ['BUILD on the left,', 'CODE on the right.'],
        footnote: 'That blade of grass is really only as tall as your hand',
      },
    }),
  );
  items.push(
    prop('standing-sign', 30, 116, {
      rotY: face(30, 116),
      options: {
        lines: ['A BUG’S LIFE'],
        subtitle: 'An ant colony, sixty times life size — ten challenges down the avenue',
        width: 17, height: 4.4,
      },
    }),
  );
  items.push(...browserStation(-22, 114, { faceX: SP.x, faceZ: SP.z }));

  // --- The nest -----------------------------------------------------------
  items.push(prop('ant-hill', 0, -62, { options: { radius: 44, height: 26, seed: 11 } }));
  items.push(prop('nest-cutaway', -66, -40, { rotY: facing(-66, -40, 0, 40), options: { width: 46, height: 30, depth: 4, seed: 13 } }));
  items.push(
    prop('info-placard', -44, -20, {
      rotY: facing(-44, -20, 0, 30),
      options: {
        eyebrow: 'Cut through the nest', title: 'Who lives where', accent: '#8a6f4a',
        body: 'The brood is kept near the top where the sun warms the soil, and workers carry the eggs up and down through the day to keep them at the right temperature. The seed store is in the middle. The queen is deep down, and she is the only one laying — every worker you can see is her daughter. The rubbish heap is kept as far from the food as the nest allows.',
      },
    }),
  );
  items.push(
    prop('info-placard', 40, -30, {
      rotY: facing(40, -30, 0, 30),
      options: {
        eyebrow: 'Nobody is in charge', title: 'How a colony decides', accent: '#5f9a6a',
        body: 'There is no leader. An ant that finds food walks home laying a scent trail, and other ants that cross it follow it and lay more. A short route gets walked more often, so it gets stronger faster — and the colony ends up using the shortest path without a single ant ever comparing two routes. The queen gives no orders at all; she lays eggs.',
      },
    }),
  );

  // --- The food run -------------------------------------------------------
  // A trail from the food out on the right, curving back to the nest, with the foragers on
  // it. This is the object of half the coding challenges, so it is placed where a student
  // can stand beside it and still read the board that talks about it.
  items.push(prop('pheromone-trail', 34, -8, { rotY: 0.5, options: { length: 92, curve: 16, dots: 30, seed: 17 } }));
  items.push(prop('food-item', 72, 26, { options: { kind: 'crumb', size: 7, seed: 19 } }));
  items.push(prop('food-item', 82, 12, { options: { kind: 'seed', size: 5, seed: 21 } }));
  items.push(prop('food-item', 66, 40, { options: { kind: 'berry', size: 6, seed: 23 } }));
  items.push(prop('food-item', 88, 32, { options: { kind: 'sugar', size: 5, seed: 25 } }));
  items.push(prop('food-item', 58, 12, { options: { kind: 'leaf-piece', size: 6, seed: 27 } }));
  items.push(
    prop('info-placard', 62, 52, {
      rotY: facing(62, 52, 0, 60),
      options: {
        eyebrow: 'Fifty times its own weight', title: 'Carrying it home', accent: '#c48a3a',
        body: 'An ant can lift about fifty times what it weighs. Muscle strength goes up with the CROSS-SECTION of a muscle, but weight goes up with volume — so halving an animal\'s size makes it four times weaker and eight times lighter. Being small is why an ant is strong. Scaled up to your size it would be no stronger than you are.',
      },
    }),
  );

  // Foragers on the trail, all facing the way they are walking.
  const foragers = [[62, 20, 2.4], [46, 6, 2.6], [30, -14, 2.9], [16, -34, 3.0], [-8, -44, 3.4]];
  foragers.forEach(([x, z, r], i) => {
    items.push(prop('ant', x, z, { rotY: r, options: { length: 5.5, seed: 30 + i * 5 } }));
  });
  items.push(prop('ant', -18, -50, { rotY: 0.6, options: { length: 6.6, soldier: true, color: 0x5a2c14, seed: 61 } }));
  items.push(prop('ant', 12, -52, { rotY: 4.0, options: { length: 5.2, seed: 67 } }));

  // --- The aphid herd -----------------------------------------------------
  items.push(prop('clover', -74, 16, { options: { height: 20, seed: 31 } }));
  items.push(prop('clover', -62, 30, { options: { height: 16, seed: 33 } }));
  [[-76, 22], [-70, 12], [-80, 12], [-66, 22]].forEach(([x, z], i) => {
    items.push(prop('aphid', x, z, { rotY: i * 1.6, options: { length: 2.6, seed: 70 + i * 3 } }));
  });
  items.push(prop('ant', -68, 20, { rotY: -1.2, options: { length: 5.5, seed: 79 } }));
  items.push(
    prop('info-placard', -52, 34, {
      rotY: facing(-52, 34, 0, 60),
      options: {
        eyebrow: 'Farming, fifty million years before us', title: 'The aphid herd', accent: '#7fb04a',
        body: 'Aphids drink sap and give off a sugary drop called honeydew. Ants stroke them with their antennae to ask for it, carry them to fresh plants, and drive off ladybirds that try to eat them. Some species even take aphid eggs down into the nest for the winter. It is herding, and the aphids are the cattle.',
      },
    }),
  );

  // --- The water drop, and the things to build across it -----------------
  items.push(prop('water-drop', 40, 72, { options: { radius: 14, seed: 59 } }));
  items.push(prop('twig', 66, 84, { rotY: 0.9, options: { length: 56, thickness: 2.8, seed: 43 } }));
  items.push(prop('fallen-leaf', 62, 60, { rotY: 1.9, options: { length: 34, color: 0x8a6a2c, seed: 41 } }));
  items.push(prop('fallen-leaf', -52, 66, { rotY: 0.4, options: { length: 30, color: 0x9a7a34, seed: 45 } }));
  items.push(prop('ladybird', 62, 60, { y: 2.0, rotY: 2.2, options: { length: 7, spots: 7, seed: 7 } }));
  items.push(
    prop('info-placard', 30, 88, {
      rotY: face(30, 88),
      options: {
        eyebrow: 'Why it is a dome and not a puddle', title: 'One drop of water', accent: '#5fa8c4',
        body: 'Water molecules pull on each other harder than they pull on soil, so a small drop holds itself in a bead instead of spreading out. At your size that skin is strong enough to trap you — which is why ants cross water on a bridge, or on each other. Some species really do link legs into a living raft and float.',
      },
    }),
  );

  // --- The meadow ---------------------------------------------------------
  // Grass around the outside only. Inside the avenue it would be scenery to build round.
  // Two rings. The far one gives the horizon; the near one -- just outside the boards, at
  // 60 to 80ft -- is what actually sells the scale, because a fifty-foot blade only reads
  // as fifty feet when it is close enough to tower. With only the far ring the avenue came
  // out as a wide brown yard with a green fringe.
  const clumps = [
    [-62, 118, 50], [64, 112, 46], [-72, 88, 54], [74, 84, 48], [-66, 40, 52],
    [68, 36, 44], [-74, -10, 50], [76, -14, 46], [-60, -60, 48], [62, -64, 52],
    [-96, 108, 52], [96, 104, 48], [-118, 62, 56], [120, 58, 50], [-128, 6, 54],
    [130, 2, 46], [-112, -56, 50], [116, -60, 54], [-70, -96, 44], [72, -100, 48],
    [-16, -118, 52], [24, -126, 46], [-150, 40, 42], [150, 30, 44], [0, 154, 40],
    [-64, 140, 46], [70, 136, 42], [-142, -20, 40], [144, -24, 44],
  ];
  clumps.forEach(([x, z, h], i) => {
    items.push(prop('grass-clump', x, z, { options: { height: h, count: 6 + (i % 3), spread: 8, seed: 200 + i * 11 } }));
  });

  const dandelions = [[-88, 78, 42], [92, 70, 38], [-104, -30, 44], [104, -36, 40], [-40, -104, 38]];
  dandelions.forEach(([x, z, h], i) => items.push(prop('dandelion-clock', x, z, { options: { height: h, seed: 300 + i * 7 } })));

  const clovers = [[-84, 96, 18], [86, 92, 16], [-100, 34, 19], [98, 30, 17], [-90, -70, 18], [94, -74, 16]];
  clovers.forEach(([x, z, h], i) => items.push(prop('clover', x, z, { options: { height: h, seed: 400 + i * 5 } })));

  const shrooms = [[-108, 84, 24, 0xc4402e], [-96, 96, 18, 0xd8873a], [108, 80, 22, 0xb8543c], [-118, -74, 20, 0xc4402e]];
  shrooms.forEach(([x, z, h, c], i) => items.push(prop('toadstool', x, z, { options: { height: h, capColor: c, seed: 500 + i * 9 } })));

  const pebbles = [[-74, 52, 14], [76, -20, 16], [-58, -78, 12], [64, -84, 15], [-124, 96, 13], [126, 90, 14]];
  pebbles.forEach(([x, z, s], i) => items.push(prop('pebble-field', x, z, { options: { spread: s + 4, count: 6, size: s * 0.5, seed: 600 + i * 7 } })));

  // ========================================================================
  // FIVE BUILDING CHALLENGES -- down the left of the avenue
  // ========================================================================

  items.push(
    prop('tutorial-board', -34, 76, {
      rotY: faceAvenue(-34, 76), options: {
        kicker: '🔨  BUILD IT', number: 1, title: 'A bridge over the drop', accent: '#c2521f',
        intro: 'Menu ▸ Create Model. Every piece lands in front of you in build yellow — click the hammer floating above it.',
        steps: [
          { lead: 'Deck', text: 'A Cube. Grab a corner and stretch it long and thin — wider than the water, and about a step across.' },
          { lead: 'Two piers', text: 'A Cylinder stretched tall, one at each end of where the deck will go. Stand them in the soil, not in the water.' },
          { lead: 'Lift the deck', text: 'Drag the GREEN ball above the deck straight UP until it clears the piers, then slide it over them.' },
          { lead: 'Kerbs', text: 'Two more Cubes, squashed thin, laid along each edge so nothing rolls off.' },
          { lead: 'Connect, then Render', text: 'Connect every piece to the deck, then press Render Model. Now it is one object.' },
        ],
        tip: 'The green ball decides lift-or-slide from the first inch you drag it: pull UP to raise, sideways to slide. If it slides when you meant to lift, let go and start the drag straight upward.',
        ...CARD,
      },
    }),
  );

  items.push(
    prop('tutorial-board', -44, 50, {
      rotY: faceAvenue(-44, 50), options: {
        kicker: '🔨  BUILD IT', number: 2, title: 'Build a worker ant', accent: '#a8541f',
        intro: 'Walk up to a real one on the trail first and look at it side-on. Three parts, and a waist you could snap.',
        steps: [
          { lead: 'Gaster', text: 'A Sphere stretched into an egg, lying on its side. This is the big rear end.' },
          { lead: 'The waist', text: 'A Cylinder squashed very thin and very short, in front of it. Make it thinner than you think — this is the bit that makes it an ant.' },
          { lead: 'Middle and head', text: 'A Sphere for the middle, a smaller Sphere in front for the head, and two tiny Spheres on the sides of the head for eyes.' },
          { lead: 'Six legs', text: 'A Cylinder squashed to a rod. Three a side, and ALL SIX on the middle part only — never on the gaster.' },
          { lead: 'Antennae', text: 'Two more rods, bent at the elbow: one going up and out, a shorter one angled off the end of it.' },
        ],
        tip: 'Three parts and six legs is an insect. Two parts and eight legs is a spider. Get the waist and the elbowed antennae and everyone will know what you built.',
        ...CARD,
      },
    }),
  );

  items.push(
    prop('tutorial-board', -48, 22, {
      rotY: faceAvenue(-48, 22), options: {
        kicker: '🔨  BUILD IT', number: 3, title: 'A grain store', accent: '#8a6f2a',
        intro: 'The colony keeps its seeds in a dry chamber. Build one, then park a food item inside it.',
        steps: [
          { lead: 'Floor', text: 'A Cube squashed flat and stretched wide. Everything else stands on this.' },
          { lead: 'Three walls', text: 'A Cube stretched tall and thin. One at the back, one each side. Leave the fourth side open as a doorway.' },
          { lead: 'Roof', text: 'A Pyramid, stretched to overhang the walls. Lift it with the green ball until it sits on top of them.' },
          { lead: 'A step at the door', text: 'A short Cylinder laid on its side, so an ant can get in with a seed.' },
          { lead: 'Connect, then Render', text: 'Connect the walls to the floor and the roof to the walls, then Render Model.' },
        ],
        tip: 'A piece you have lifted keeps its height when you slide it sideways, so raise the roof once and then line it up. That is the whole reason the green handle exists.',
        ...CARD,
      },
    }),
  );

  items.push(
    prop('tutorial-board', -46, -6, {
      rotY: faceAvenue(-46, -6), options: {
        kicker: '🔨  BUILD IT', number: 4, title: 'A ladder to the leaf', accent: '#5f7a2a',
        intro: 'A fallen leaf is a floor from down here. Build something to get up onto one.',
        steps: [
          { lead: 'Two rails', text: 'A Cylinder stretched long and thin. Make a second one beside it, about a body-width apart.' },
          { lead: 'Rungs', text: 'Short Cylinders laid across, evenly spaced. Six or seven is plenty.' },
          { lead: 'Connect first', text: 'Connect every rung to both rails BEFORE you tilt anything. It is far easier while it is lying flat.' },
          { lead: 'Lean it', text: 'Open Rotate/Move Shape and drag an upright ring. It clicks round in 15 degree steps — 45 degrees is three clicks.' },
          { lead: 'Render', text: 'Press Render Model and walk up it.' },
        ],
        tip: 'A ring seen exactly edge-on cannot be grabbed — it is a hairline down the middle of the piece. Take two steps sideways and it opens into a circle you can hold.',
        ...CARD,
      },
    }),
  );

  items.push(
    prop('tutorial-board', -38, -34, {
      rotY: faceAvenue(-38, -34), options: {
        kicker: '🔨  BUILD IT', number: 5, title: 'Invent your own bug', accent: '#6b3fa0',
        intro: 'No instructions this time. Four shapes, and one rule to break on purpose or keep on purpose.',
        steps: [
          { lead: 'Decide what it is', text: 'Insect: three body parts, six legs, two antennae. Spider: two parts, eight legs, no antennae. Pick one and stick to it.' },
          { lead: 'Give it a job', text: 'A digger needs shovels on the front. A jumper needs huge back legs. A hunter needs eyes that face forward. The job decides the shape.' },
          { lead: 'Make it one colour family', text: 'Apply a colour to every piece from the same corner of the picker. A bug in six unrelated colours reads as a pile of shapes.' },
          { lead: 'Render, then program it', text: 'Render Model, then click it and give it a walk from the boards across the avenue.' },
        ],
        tip: 'Real insects are almost all symmetrical left-to-right. Build one side, then build the other to match — and if you get bored of matching, that asymmetry is exactly what makes a fiddler crab look odd.',
        ...CARD,
      },
    }),
  );

  // ========================================================================
  // FIVE CODING CHALLENGES -- down the right of the avenue
  // ========================================================================

  items.push(
    activity(34, 76, {
      number: 1, rotY: faceAvenue(34, 76), accent: '#4c97ff',
      title: 'Follow the scent trail',
      target: 'Click any ant on the glowing trail → Program.',
      steps: [
        ctrlStep('repeat 22 times'),
        moveStep('move forward 6 feet', 1),
        moveStep('rotate 5 degrees', 1),
        ctrlStep('wait 0.1 seconds', 1),
      ],
      tip: 'A little forward and a little turn, over and over, draws a curve — which is exactly the shape of the trail. Make the rotate bigger and the curve gets tighter. Make it 0 and the ant walks straight off the edge of the trail.',
    }),
  );

  items.push(
    activity(44, 50, {
      number: 2, rotY: faceAvenue(44, 50), accent: '#c48a3a',
      title: 'The forager’s round trip',
      target: 'Click an ant near the food → Program.',
      steps: [
        moveStep('move forward 34 feet'),
        ctrlStep('wait 1 seconds'),
        lookStep('say found it'),
        ctrlStep('wait 2 seconds'),
        moveStep('go back to start'),
      ],
      tip: 'Go back to start puts it exactly where it began — position, turn and size, all at once. It is the undo button for a program that has wandered off, and it is worth knowing before you need it.',
    }),
  );

  items.push(
    activity(48, 22, {
      number: 3, rotY: faceAvenue(48, 22), accent: '#ffab19',
      title: 'Tell the whole colony',
      target: 'Two ants. The first three blocks on ONE, the last two on ANOTHER.',
      steps: [
        lookStep('say food this way'),
        ctrlStep('wait 1 seconds'),
        lookStep('say food this way'),
        ctrlStep('when an object says food this way'),
        moveStep('glide 30 feet over 3 seconds', 1),
      ],
      tip: 'The second ant does nothing when you press play — it is waiting. It only moves when it hears the words, and they have to match exactly. Put the same two blocks on five ants and one scout starts the whole column.',
    }),
  );

  items.push(
    activity(46, -6, {
      number: 4, rotY: faceAvenue(46, -6), accent: '#9966ff',
      title: 'Carry the crumb home',
      target: 'Click the bread crumb itself → Program.',
      steps: [
        ctrlStep('repeat 8 times'),
        moveStep('glide 7 feet over 1 seconds', 1),
        lookStep('change size by -9 %', 1),
        ctrlStep('wait 0.5 seconds'),
        lookStep('set size to 100 %'),
      ],
      tip: 'Watch the last two blocks. Change size BY takes another slice off whatever is left, so eight of them do not remove 72% — they leave about half. Set size TO measures from the size it started at, so 100% is always the whole crumb back.',
    }),
  );

  items.push(
    activity(38, -34, {
      number: 5, rotY: faceAvenue(38, -34), accent: '#e0455f',
      title: 'The ladybird takes off',
      target: 'Click the ladybird on the fallen leaf → Program.',
      steps: [
        ctrlStep('repeat 14 times'),
        moveStep('move up by 3 feet', 1),
        moveStep('rotate 20 degrees', 1),
        lookStep('set opacity to 25 %', 1),
        ctrlStep('wait 0.15 seconds', 1),
        moveStep('go back to start'),
      ],
      tip: 'Move up is the one motion block that ignores which way a thing is facing — up is up. Set opacity fades it into the sky without deleting it, and go back to start brings it down again solid. Try taking that last block out and see where it ends up.',
    }),
  );

  // --- Lighting -----------------------------------------------------------
  items.push(orb(0, -62, 30, ORB_WARM));
  items.push(orb(-66, -40, 22, ORB_WHITE));
  items.push(orb(72, 26, 14, ORB_WARM));
  items.push(orb(0, 60, 26, ORB_WHITE));

  return { theme: 'bugs', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Space Station Survival
// ---------------------------------------------------------------------------

// A construction deck in low Mars orbit, laid out around FIVE BUILDING CHALLENGES.
//
// THE DECK IS A PLAN. Each challenge board stands beside a colour-coded bay painted on the
// plating, and the bay is where that build goes -- so "build a solar wing in bay 2" names
// somewhere a student can walk to and stand in. That is the difference between a build
// challenge and a suggestion, and it is what A Bug's Life's avenue of boards was reaching
// for without having anywhere to put the results.
//
// The middle of the deck is kept CLEAR for the same reason it is in My World: a fresh
// construction piece lands PRIMITIVE_SPAWN_DISTANCE (10ft) ahead of the student and spirals
// outward, so anything parked there is something to build around. Every finished module is
// pushed to the far side or the flanks.
function stationLayout() {
  const items = [];
  const SP = { x: 0, z: 86 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- Mars ---------------------------------------------------------------
  // A 150ft sphere sunk so only its upper cap clears the deck. absoluteY and a large
  // negative y: that is what makes it a world being ORBITED rather than a ball parked next
  // to the station, and it is placed BEYOND the deck so the horizon of the planet and the
  // edge of the plating are not fighting for the same line.
  //
  // It is the animated object: a planet turning about its own vertical is exactly what
  // `rotate` drives. 0.08 degrees is 0.04 a FRAME (forever yields on top of rotate's own
  // yield), which is about 2.4 degrees a second -- one rotation in two and a half minutes.
  // Slow enough to be noticed rather than watched.
  //
  // ITS CENTRE HAS TO BE ABOVE THE DECK'S HORIZON, and that is not a framing preference,
  // it is the only arrangement that reads as a sphere. A flat deck with the eye 5ft above it
  // hides everything below about -2 degrees whatever size the deck is, so a planet centred
  // below that line is cut through ABOVE its own equator -- and a circle cut above its
  // equator is a dome. Every version that sat Mars low came out as a hill: at radius 150 and
  // 320ft it was a hill close up, at radius 400 and 780ft it was a hill 700ft wide.
  //
  // 340ft of radius at ~780ft away spans about 48 degrees across and sits with its centre
  // ~6 degrees UP, so the visible part runs from the deck edge to 28 degrees and curves back
  // in on both sides. The bottom third stays hidden behind the deck, which is what a real
  // window over a planet looks like, and the top clears the 35-degree half-fov with room.
  items.push(prop('mars-globe', 0, -690, {
    y: 86,
    absoluteY: true,
    options: { radius: 340, seed: 75 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.08 })])],
  }));

  // --- The deck -----------------------------------------------------------
  items.push(prop('station-deck', 0, 10, { y: 0.06, absoluteY: true, options: { width: 230, depth: 230, seed: 45 } }));

  // --- The station itself, ringing the working area ------------------------
  items.push(prop('docking-node', 0, -46, { options: { radius: 8, seed: 15 } }));
  items.push(prop('station-module', -30, -46, {
    rotY: Math.PI / 2,
    options: { length: 40, radius: 6.5, bay: 'habitat', seed: 3 },
  }));
  items.push(prop('station-module', 30, -46, {
    rotY: Math.PI / 2,
    options: { length: 40, radius: 6.5, bay: 'lab', seed: 4 },
  }));
  items.push(prop('station-module', 0, -76, {
    options: { length: 34, radius: 6, bay: 'store', seed: 5 },
  }));
  items.push(prop('station-cupola', 0, -22, { options: { radius: 7.5, seed: 9 } }));

  items.push(prop('truss-segment', -62, -38, { rotY: Math.PI / 2, options: { length: 34, size: 6, bays: 5, seed: 33 } }));
  items.push(prop('truss-segment', 62, -38, { rotY: Math.PI / 2, options: { length: 34, size: 6, bays: 5, seed: 34 } }));
  items.push(prop('solar-array', -76, -48, { rotY: 0.2, options: { span: 46, width: 12, seed: 21 } }));
  items.push(prop('solar-array', 76, -48, { rotY: -0.2, options: { span: 46, width: 12, seed: 22 } }));
  items.push(prop('radiator-panel', -50, -74, { rotY: 0.4, options: { span: 28, width: 9, panels: 3, seed: 27 } }));
  items.push(prop('radiator-panel', 50, -74, { rotY: -0.4, options: { span: 28, width: 9, panels: 3, seed: 28 } }));
  items.push(prop('antenna-dish', -34, -12, { rotY: 0.6, options: { radius: 7, seed: 69 } }));
  items.push(prop('robotic-arm', 34, -12, { rotY: -1.2, options: { reach: 34, seed: 39 } }));

  // --- The human-scale things ---------------------------------------------
  items.push(prop('eva-suit', -14, 30, { rotY: face(-14, 30), options: { height: 7.4, seed: 63 } }));
  items.push(prop('eva-suit', 15, 34, { rotY: face(15, 34) + 0.5, options: { height: 7.2, seed: 64 } }));

  for (const [x, z, bay, seed] of [[-40, 12, 'store', 57], [42, 10, 'power', 58], [-26, 6, 'lab', 59]]) {
    items.push(prop('cargo-pod', x, z, { rotY: seed * 0.4, options: { size: 7, bay, seed } }));
  }
  for (const [x, z, bay, seed] of [[-38, 44, 'lab', 81], [36, 46, 'habitat', 82], [-20, 60, 'power', 83], [22, 62, 'store', 84]]) {
    items.push(prop('supply-crate', x, z, { rotY: seed * 0.3, options: { size: 3.6, bay, seed } }));
  }

  // --- FIVE BUILDING BAYS + their boards -----------------------------------
  // Bay marking, then the board beside it. The bay's colour and the board's accent are the
  // same value, which is the whole point of colour-coding the deck.
  //
  // THE FIVE BAYS ARE AN AVENUE, NOT A RING, and the middle of the deck is empty on purpose.
  // Two separate rules force it. A fresh construction piece lands PRIMITIVE_SPAWN_DISTANCE
  // ahead of the student and spirals out from there, so anything in the middle is something
  // to build round -- the lesson My World and A Bug's Life each learned. And the arrival view
  // is the station against Mars: the first pass had bay 3 at (-2, 34), two degrees off the
  // sightline and 52ft out, where a 10.5ft board hid the entire station behind it.
  const BAYS = [
    { n: 1, bay: 'habitat', x: -52, z: 66, accent: '#3f8fd9' },
    { n: 2, bay: 'power', x: 52, z: 66, accent: '#f2b134' },
    { n: 3, bay: 'dock', x: -56, z: 28, accent: '#9a6fd9' },
    { n: 4, bay: 'lab', x: 56, z: 28, accent: '#4fbf7a' },
    { n: 5, bay: 'store', x: -58, z: -6, accent: '#e0553f' },
  ];
  for (const b of BAYS) {
    items.push(prop('deck-bay', b.x, b.z - 20, { y: 0.14, absoluteY: true, options: { size: 20, bay: b.bay, number: b.n } }));
  }

  const CARD = { width: 10.5, height: 8.4, postHeight: 11, postColor: 0x9aa2ab };

  items.push(prop('tutorial-board', BAYS[0].x, BAYS[0].z, {
    rotY: face(BAYS[0].x, BAYS[0].z),
    options: {
      kicker: '🔧  BUILD IT · BAY 1',
      number: 1,
      title: 'A habitation module',
      intro: 'Menu ▸ Create Model. Each piece lands in front of you in build yellow — click the hammer floating above it.',
      steps: [
        { lead: 'Body', text: 'A Cylinder. Drag a top corner until it is about 4× as long as it is wide, then lay it down with the rotate rings. White.' },
        { lead: 'Two end caps', text: 'A Sphere squashed to a shallow dome on each end. White.' },
        { lead: 'Colour band', text: 'A Cylinder, barely thicker than the body but very short, slid round the middle. Blue.' },
        { lead: 'A window', text: 'A small Cylinder pushed through the wall so both ends show. Pale blue.' },
        { lead: 'Connect, then Render', text: 'Join every piece to the body, then press Render Model.' },
      ],
      tip: 'The rotate rings turn about the WORLD axes and do not follow the piece — so the flat amber ring always spins it on the spot and the upright ones always tip it, whatever state it is already in.',
      accent: BAYS[0].accent,
      ...CARD,
    },
  }));

  items.push(prop('tutorial-board', BAYS[1].x, BAYS[1].z, {
    rotY: face(BAYS[1].x, BAYS[1].z),
    options: {
      kicker: '🔧  BUILD IT · BAY 2',
      number: 2,
      title: 'A solar array wing',
      intro: 'Look at the real ones out on the truss first. A wing is a mast, a spine, and a wide flat blanket of cells.',
      steps: [
        { lead: 'Mast', text: 'A Cylinder, tall and thin. Grey.' },
        { lead: 'Blanket', text: 'A Cube. Squash it almost flat, then stretch it long and wide. Dark blue.' },
        { lead: 'Second blanket', text: 'Duplicate is not a build tool — make another and lift it into place with the green handle so the two are level.' },
        { lead: 'Spine', text: 'A thin Cube running the length of each blanket, tucked under it.' },
        { lead: 'Connect, then Render', text: 'Join both wings to the mast and press Render Model.' },
      ],
      tip: 'To get both wings at the SAME height, build one, then raise the second with the green handle until its shadow lines up with the first.',
      accent: BAYS[1].accent,
      ...CARD,
    },
  }));

  items.push(prop('tutorial-board', BAYS[2].x, BAYS[2].z, {
    rotY: face(BAYS[2].x, BAYS[2].z),
    options: {
      kicker: '🔧  BUILD IT · BAY 3',
      number: 3,
      title: 'A docking node',
      intro: 'The hub in the middle of the station. A ball with a port sticking out of every side — walk round the real one and count them.',
      steps: [
        { lead: 'Hub', text: 'A Sphere, squashed very slightly so it is wider than it is tall. White.' },
        { lead: 'Four ports', text: 'A short fat Cylinder pushed half into the hub. One on each side — front, back, left, right.' },
        { lead: 'A fifth port', text: 'One more on top, pointing straight up.' },
        { lead: 'Target rings', text: 'A very thin Cylinder on the end of one port, a little wider than it. Purple.' },
        { lead: 'Connect, then Render', text: 'Join every port to the hub and press Render Model.' },
      ],
      tip: 'Root each port a little way INSIDE the hub rather than resting it on the surface — two curved surfaces touching at a point always leave a visible notch.',
      accent: BAYS[2].accent,
      ...CARD,
    },
  }));

  items.push(prop('tutorial-board', BAYS[3].x, BAYS[3].z, {
    rotY: face(BAYS[3].x, BAYS[3].z),
    options: {
      kicker: '🔧  BUILD IT · BAY 4',
      number: 4,
      title: 'A greenhouse lab',
      intro: 'Survival means growing food. Build a module you can see into — this one is mostly window.',
      steps: [
        { lead: 'Frame', text: 'Four thin Cubes standing as corner posts, with two more laid across the top.' },
        { lead: 'Glazing', text: 'A Cube squashed thin, hung on the OUTSIDE of the frame. Pale green. One per side.' },
        { lead: 'Roof', text: 'Two flat Cubes leaned against each other into a shallow peak.' },
        { lead: 'Racks inside', text: 'Two long thin Cubes stacked, green on top for the crop.' },
        { lead: 'Connect, then Render', text: 'Join it all to one corner post and press Render Model.' },
      ],
      tip: 'Hang the glass OUTSIDE the frame, not inside it. A box with panels tucked in disappears — you end up looking at a solid slab.',
      accent: BAYS[3].accent,
      ...CARD,
    },
  }));

  items.push(prop('tutorial-board', BAYS[4].x, BAYS[4].z, {
    rotY: face(BAYS[4].x, BAYS[4].z),
    options: {
      kicker: '🔧  BUILD IT · BAY 5',
      number: 5,
      title: 'Your own supply lander',
      intro: 'No steps for this one. Everything that reaches this station arrives on something — design it.',
      steps: [
        { lead: 'It needs legs', text: 'Three or four, splayed out. Anything that lands has a wide base or it falls over.' },
        { lead: 'It needs a tank', text: 'Round or capsule-shaped, and bigger than you think.' },
        { lead: 'It needs an engine', text: 'A Cone, point down, under the tank.' },
        { lead: 'Give it a colour code', text: 'Use one of the five bay colours so a crew knows what is inside.' },
        { lead: 'Then program it', text: 'Once it is rendered, click it and give it forever ▸ move up by 0.2 feet. Now it is landing — or leaving.' },
      ],
      tip: 'Build it in this bay, then walk back to the cupola and look at it from there. If you cannot tell what it is from fifty feet away, it needs a stronger silhouette, not more detail.',
      accent: BAYS[4].accent,
      ...CARD,
    },
  }));

  // --- Words --------------------------------------------------------------
  items.push(
    prop('welcome-board', -22, 76, {
      rotY: face(-22, 76),
      options: {
        eyebrow: '🛰  SPACE STATION SURVIVAL',
        lead: 'You are on the construction deck, in orbit over Mars.',
        lines: ['Five bays. Five things to build.', 'The colours tell you which is which.'],
        footnote: 'Mars is turning below you — that is a program you can open',
      },
    }),
  );
  items.push(...browserStation(20, 78, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', -8, 12, {
    rotY: face(-8, 12),
    options: {
      title: 'Why everything is white',
      body: 'Sunlight in orbit is fierce and there is no air to carry heat away, so a spacecraft cooks in the sun and freezes in shadow. White blankets reflect most of what hits them; the gold foil is many layers of thin plastic with vacuum between them, which is one of the best insulators there is. The big white panels out on the truss are radiators — they are turned EDGE-ON to the sun on purpose, so they can dump heat without collecting any.',
    },
  }));
  items.push(prop('info-placard', 8, 12, {
    rotY: face(8, 12),
    options: {
      title: 'Reading the colours',
      body: 'Every module carries a band, and every bay on this deck is painted to match: blue for habitation, green for the labs, amber for power, red for stores, purple for docking. Real stations do this because in an emergency you have to know what you are looking at before you can read anything written on it. Build in the bay whose colour matches the job.',
    },
  }));

  // Light. Deliberately sparse: hard shadows and near-black fill are what make hardware
  // look like hardware, and a scattering of warm orbs would undo the whole theme.
  items.push(orb(0, -34, 12, ORB_WHITE));
  items.push(orb(-58, 40, 9, ORB_WARM));
  items.push(orb(58, 40, 9, ORB_WARM));

  return { theme: 'station', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Whimsical World
// ---------------------------------------------------------------------------

// A storybook landscape laid out around FIVE CODING CHALLENGES.
//
// The shape is a horseshoe: the carousel dead ahead at the far end, the five boards ringing
// the open middle, and each board's target object standing near it. That pairing is the
// whole layout rule here -- a board that names an object twenty feet away is a board a
// student reads and then loses, so every one of them has its subject in the same glance.
//
// The middle is left clear on purpose. A fresh construction piece lands
// PRIMITIVE_SPAWN_DISTANCE ahead of the student and spirals out, and while this world is
// about coding rather than building, a student who wants to add something of their own
// should not have to put it inside a mushroom.
function whimsyLayout() {
  const items = [];
  const SP = { x: 0, z: 74 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The hero, animated -------------------------------------------------
  // A carousel is the one elaborate model in this app that `rotate` can drive properly,
  // because it turns about the vertical -- see the note at the top of WhimsyProps.
  //
  // 0.5 degrees is 0.25 a FRAME: `forever` yields once per pass on top of the yield from
  // `rotate`, so one turn of the loop costs two frames. About 15 degrees a second, a full
  // turn in 24 -- a fairground carousel pace rather than a washing machine.
  items.push(prop('carousel', 0, -22, {
    options: { radius: 13, horses: 8, seed: 3 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.5 })])],
  }));

  // --- The five challenge targets, each beside its own board ---------------
  items.push(prop('hot-air-balloon', -40, 6, { y: 3, options: { height: 24, hue: 0xf2545b, seed: 51 } }));
  items.push(prop('wind-up-toy', 38, 12, { rotY: Math.PI, options: { height: 7, hue: 0x4fc3d9, seed: 61 } }));
  items.push(prop('mushroom-house', -34, 40, { options: { height: 15, hue: 0xf2545b, seed: 11 } }));
  items.push(prop('giant-flower', 34, 44, { options: { height: 13, hue: 0xe86bb5, seed: 71 } }));

  // --- Scenery ------------------------------------------------------------
  items.push(prop('rainbow-arch', 0, -58, { y: 2, options: { span: 74, bands: 7, thickness: 1.8 } }));
  items.push(prop('mushroom-house', -58, 8, { options: { height: 19, hue: 0x7a6ff0, seed: 12 } }));
  items.push(prop('mushroom-house', 56, -18, { options: { height: 13, hue: 0xf2a541, seed: 13 } }));
  items.push(prop('spiral-tower', -66, -34, { options: { height: 34, hue: 0x7a6ff0, seed: 101 } }));
  items.push(prop('spiral-tower', 62, -42, { options: { height: 27, hue: 0x4fc3d9, seed: 102 } }));

  for (const [x, z, h, hue, seed] of [
    [-24, -6, 20, 0x6fcf72, 21], [26, -8, 17, 0xf7d154, 22], [-48, -20, 22, 0x4fc3d9, 23],
    [46, -28, 19, 0xe86bb5, 24], [-42, 54, 16, 0x6fcf72, 25], [28, 60, 18, 0xf2a541, 26],
  ]) {
    items.push(prop('lollipop-tree', x, z, { options: { height: h, hue, seed } }));
  }

  for (const [x, z, r, hue, seed] of [
    [-52, 52, 4.5, 0x7a6ff0, 81], [48, 50, 3.5, 0x4fc3d9, 82], [12, -44, 5.0, 0xe86bb5, 83],
    [-18, -40, 4.0, 0xf7d154, 84],
  ]) {
    items.push(prop('gumdrop-rock', x, z, { options: { radius: r, hue, seed } }));
  }

  for (const [x, z, h, hue, seed] of [[-30, 22, 11, 0xf7d154, 72], [30, 26, 10, 0x7a6ff0, 73]]) {
    items.push(prop('giant-flower', x, z, { options: { height: h, hue, seed } }));
  }

  // Floating islands and clouds, up in the air. absoluteY: a thing that hovers has nothing
  // to do with the height of the ground under it.
  items.push(prop('floating-island', -70, 20, { y: 44, absoluteY: true, options: { radius: 11, hue: 0x6fcf72, seed: 41 } }));
  items.push(prop('floating-island', 72, 4, { y: 56, absoluteY: true, options: { radius: 8, hue: 0x4fc3d9, seed: 42 } }));
  for (const [x, z, y, w, seed] of [[-30, -60, 62, 20, 91], [36, -66, 70, 16, 92], [0, 30, 74, 22, 93]]) {
    items.push(prop('cloud-puff', x, z, { y, absoluteY: true, options: { width: w, seed } }));
  }

  items.push(prop('stepping-stones', 0, 34, { options: { count: 11, spacing: 5.5, hue: 0x4fc3d9, seed: 111 } }));

  // --- Words --------------------------------------------------------------
  items.push(
    // OFF THE CENTRE LINE. The carousel is 96ft away and about 16ft tall, so from the
    // spawn it subtends roughly 6 degrees -- while this board, 12ft ahead and 11ft to its
    // top, subtends 28. Anything on that sightline hides the hero of the world outright.
    prop('welcome-board', -19, 44, {
      rotY: face(-24, 58),
      options: {
        eyebrow: '🎠  WHIMSICAL WORLD',
        lead: 'Five things here are waiting to be told what to do.',
        lines: ['Find the five ⚡ boards.', 'The carousel is already running.'],
        footnote: 'Click anything, choose Program, and change a number',
      },
    }),
  );
  items.push(...browserStation(17, 64, { faceX: SP.x, faceZ: SP.z }));

  // --- FIVE CODING CHALLENGES ---------------------------------------------
  // Every sequence has been run. `move forward` and `glide` follow the object's own +Z, so
  // a `rotate` between them genuinely steers -- which is what makes challenge 2 close a
  // square exactly. `move up by` is the one motion block that is NOT relative to facing.
  items.push(activity(-16, 34, {
    number: 1,
    title: 'Fly the balloon',
    target: 'the red hot-air balloon',
    rotY: face(-16, 34),
    accent: '#f2545b',
    steps: [
      ctrlStep('forever'),
      moveStep('move up by 0.4 feet', 1),
      ctrlStep('wait 0.1 seconds', 1),
      moveStep('move up by -0.4 feet', 1),
      ctrlStep('wait 0.1 seconds', 1),
    ],
    tip: 'Up is always up, whichever way a thing is pointing — that is the one movement block that ignores facing. Make the two numbers different and the balloon drifts away.',
  }));

  items.push(activity(16, 34, {
    number: 2,
    title: 'Walk the wind-up toy in a square',
    target: 'the blue wind-up toy',
    rotY: face(16, 34),
    accent: '#4fc3d9',
    steps: [
      ctrlStep('forever'),
      ctrlStep('repeat 4 times', 1),
      moveStep('glide 12 feet over 3 seconds', 2),
      moveStep('rotate 90 degrees', 2),
    ],
    tip: '360 divided by 4 is 90, which is why it comes back to exactly where it started. Try repeat 3 with rotate 120, or repeat 6 with rotate 60.',
  }));

  items.push(activity(-34, 54, {
    number: 3,
    title: 'Grow the toadstool',
    target: 'the red mushroom house',
    rotY: face(-34, 54),
    accent: '#f2a541',
    steps: [
      ctrlStep('forever'),
      lookStep('change size by 8 %', 1),
      ctrlStep('wait 0.4 seconds', 1),
      lookStep('change size by -8 %', 1),
      ctrlStep('wait 0.4 seconds', 1),
    ],
    tip: 'Plus 8 then minus 8 does NOT come back to the same size — each one is a percentage of whatever it is now. Watch it slowly shrink, then work out why.',
  }));

  items.push(activity(34, 58, {
    number: 4,
    title: 'Make the flower change colour',
    target: 'the pink giant flower',
    rotY: face(34, 58),
    accent: '#e86bb5',
    steps: [
      ctrlStep('forever'),
      lookStep('change color to 🟣', 1),
      ctrlStep('wait 1 seconds', 1),
      lookStep('change color to 🟡', 1),
      ctrlStep('wait 1 seconds', 1),
    ],
    tip: 'Add a third colour and a third wait and you have a traffic light. Take the waits out and see what happens — it is still working, just too fast to see.',
  }));

  // Off to the side of the carousel rather than in front of it, for the same reason.
  items.push(activity(22, -4, {
    number: 5,
    title: 'Speed up the carousel',
    target: 'the carousel itself',
    rotY: face(22, -4),
    accent: '#7a6ff0',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 0.5 degrees', 1),
    ],
    tip: 'This one is ALREADY running — click the carousel and choose Program to read it. Change 0.5 to 6 and hold on. A negative number turns it the other way.',
  }));

  items.push(orb(0, -22, 10, ORB_WARM));
  items.push(orb(-38, 30, 8, ORB_ROSE));

  return { theme: 'whimsy', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Cologne Cathedral
// ---------------------------------------------------------------------------

// The west front seen across the Domplatte, which is the only view of this building that
// shows both spires at once and is the one every photograph is taken from.
//
// THE SPAWN IS 150FT OUT, and that number is set by HEIGHT, not by taste -- the same
// arithmetic Red Square needed. The spires reach 172ft; the camera's fov is 70 VERTICAL, so
// half of it is 35 degrees, and to get the tips inside the frame from eye height needs
// about 172/tan(35) = 245ft, or rather less with the pitch a student naturally uses. At
// 150ft they fill the view from top to bottom, which for this building is the right answer:
// it is meant to be overwhelming, and a cathedral you can see all of comfortably is a
// cathedral you have been shown too far away.
function cologneLayout() {
  const items = [];
  const SP = { x: 0, z: 150 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The square ---------------------------------------------------------
  items.push(prop('domplatte', 0, 40, { y: 0.3, absoluteY: true, options: { width: 220, depth: 230, seed: 35 } }));

  // --- The hero -----------------------------------------------------------
  // `facing() + PI`, NOT `facing()`.
  //
  // facing() turns an object so its own +Z points AT the target, and that is right for a
  // sign or a bench whose front is its +Z face. This building is 154ft deep and its front
  // is at the OTHER end: the west front sits at local z ~ 0 and the nave runs away from it
  // in +Z. Pointed at the spawn by the usual rule, the nave came toward the student and
  // they arrived twenty-five feet from the apse -- a black wall filling the whole frame,
  // with both spires 180ft behind it.
  //
  // Anything longer than it is wide needs this checked rather than assumed.
  // 148ft, not the 172 a straight 1/3 gives.
  //
  // The arithmetic is forced, not aesthetic. To fit a building of height H in a 70-degree
  // VERTICAL fov from eye height you need about (H-5)/tan(35) of run-up: at 172ft that is
  // 240ft, and the furthest a student can stand from a building at z=-6 is about 200ft
  // before WORLD_BOUND_RADIUS stops them. So at a true third the spires could never be
  // seen whole from anywhere in the world -- which for a building whose entire identity is
  // its spires is the one failure that matters. 148ft needs 205ft and fits.
  //
  // This is Red Square's lesson stated as a formula: distance is set by HEIGHT, and when
  // the distance is not available the height has to give. The placard carries the real
  // 515ft either way.
  items.push(prop('cologne-cathedral', 0, -6, {
    rotY: facing(0, -6, SP.x, SP.z) + Math.PI,
    options: { length: 150, height: 148, navWidth: 28, seed: 5 },
  }));

  // --- The animated object ------------------------------------------------
  // The restoration crane, slewing.
  //
  // A crane is the one piece of plant that turns about the VERTICAL, which is the only axis
  // the `rotate` block drives -- the same constraint that stopped Big Ben's clock hands
  // being animated. It is also genuinely characteristic: there has been scaffolding
  // somewhere on this cathedral continuously since it was finished, and the local saying is
  // that the world ends when the work does.
  //
  // 0.25 degrees a step is 0.125 a FRAME, because `forever` yields once per pass on top of
  // the yield from `rotate` -- so about 7.5 degrees a second, a full slew in 48 seconds.
  // A crane that whips round is a fairground ride.
  items.push(prop('restoration-crane', -46, -6, {
    options: { height: 66, jib: 40, seed: 15 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.25 })])],
  }));
  items.push(prop('scaffold-bay', -30, -44, {
    rotY: Math.PI / 2,
    options: { width: 26, height: 44, depth: 5, seed: 25 },
  }));

  // --- The old town, ringing the square -----------------------------------
  // Ordinary buildings, and their job is entirely comparative: a 172ft cathedral is only
  // enormous next to something a person recognises the size of.
  //
  // Pushed WELL out to the sides. At x = +/-86 they stood only 80ft from the arrival and
  // 40ft tall, so they subtended more than the cathedral did from 156ft and framed the
  // view like two cliffs -- the near-sign-versus-far-landmark problem again, in buildings.
  // Out at 120-135 they ring the square instead, which is the job they are here for.
  const HOUSES = [
    [-126, 96, 0.35, 0xb8a68c, 45], [-104, 124, 0.2, 0xa89478, 46], [-56, 146, 0.05, 0xc2b096, 47],
    [62, 144, -0.15, 0xb09a80, 48], [112, 118, -0.4, 0xc6b49a, 49], [134, 70, -0.9, 0xaa9880, 50],
  ];
  for (const [x, z, rotY, color, seed] of HOUSES) {
    items.push(prop('altstadt-house', x, z, {
      rotY: face(x, z) + rotY,
      options: { width: 17, height: 34 + (seed % 3) * 5, depth: 18, color, seed },
    }));
  }

  // --- Words --------------------------------------------------------------
  items.push(
    prop('welcome-board', 34, 128, {
      rotY: face(34, 128),
      options: {
        eyebrow: '⛪  COLOGNE CATHEDRAL',
        lead: 'The Cathedral of St Peter, at a third of life size.',
        lines: ['Look through the spires.', 'They are stone lace, not stone.'],
        footnote: 'Begun in 1248 and finished in 1880 — 632 years',
      },
    }),
  );
  items.push(...browserStation(-24, 132, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', 20, 96, {
    rotY: face(20, 96),
    options: {
      title: 'Six hundred and thirty-two years',
      body: 'The foundation stone went down in 1248. Work stopped around 1560 with the choir finished and the south tower a stump with a medieval crane left standing on it — and that crane stayed there, visible over the city, for nearly three hundred years. Building restarted in 1842 using the original drawings, which had survived, and finished in 1880. For four years afterwards it was the tallest building in the world.',
    },
  }));
  items.push(prop('info-placard', -22, 92, {
    rotY: face(-22, 92),
    options: {
      title: 'Why the spires have holes in them',
      body: 'They are openwork: a lattice of carved stone ribs with nothing filling the gaps. That is not decoration but engineering — a solid stone spire this tall would be far too heavy for the tower beneath it, and it would catch the wind like a sail. Stand where you can see sky through one and you are looking at the reason it is still standing.',
    },
  }));
  items.push(prop('info-placard', 0, 84, {
    rotY: face(0, 84),
    options: {
      title: 'The black is not dirt any more',
      body: 'Cologne’s sandstone reacts with rain and air to grow a dark crust, and the building has been almost black for a century. Cleaning it does not last — the crust simply reforms — and in places the crust is now protecting the stone underneath. So the restoration you can see happening never really ends: masons work their way round the building replacing what has decayed, and by the time they reach the end they start again.',
    },
  }));

  items.push(orb(0, 60, 8, ORB_WARM));

  return { theme: 'cologne', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// A Rabbit's Den
// ---------------------------------------------------------------------------

// A warren in a downland bank, at about 4x life size.
//
// The composition is a THREE-QUARTER approach to the cut bank rather than a square-on one.
// A cutaway seen dead-on is a flat picture; from an angle you read the depth of the tunnels
// and can see that the chamber is genuinely behind the face. The hero rabbit sits out on
// the turf between the student and the bank, so it is the first thing in the frame and the
// warren is what it is sitting in front of.
function warrenLayout() {
  const items = [];
  const SP = { x: 26, z: 58 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The bank, cut open -------------------------------------------------
  items.push(prop('warren-cutaway', -12, -18, {
    rotY: -0.45,
    options: { width: 46, height: 21, depth: 15, seed: 11 },
  }));

  // --- The hero -----------------------------------------------------------
  // Sitting up, which is the pose that shows every field mark at once: ears up, haunch
  // clear of the body line, the long hind foot flat on the ground, eye high on the side.
  items.push(prop('rabbit', 10, 20, {
    rotY: facing(10, 20, SP.x, SP.z) + 0.35,
    options: { length: 5.4, pose: 'sit', seed: 7 },
  }));
  // A second adult feeding, so the two poses can be compared.
  items.push(prop('rabbit', -22, 16, {
    rotY: 1.9,
    options: { length: 5.0, pose: 'feed', seed: 9 },
  }));
  // Two kits by the burrow mouth.
  items.push(prop('rabbit', -30, 2, { rotY: 0.8, options: { length: 5.2, pose: 'kit', seed: 13 } }));
  items.push(prop('rabbit', -34, 6, { rotY: 2.4, options: { length: 5.2, pose: 'kit', seed: 17 } }));

  // --- Burrow mouths in open ground ---------------------------------------
  items.push(prop('burrow-entrance', -30, 12, { options: { radius: 3.6, seed: 21 } }));
  items.push(prop('burrow-entrance', 18, -4, { options: { radius: 3.0, seed: 22 } }));

  // --- The animated object ------------------------------------------------
  // A butterfly flying a square circuit over the meadow.
  //
  // `glide` because it is the one block that spans TIME -- `move forward` teleports, and a
  // butterfly jumping 10ft at a stroke reads as a glitch rather than as flight. It is
  // placed with a `y` because it flies: a builder's origin is its base centre, so without
  // one it would be dragged through the grass.
  items.push(prop('butterfly', -2, 30, {
    y: 5.5,
    options: { span: 1.8, color: 0xe8843c, seed: 71 },
    program: [
      block('forever', {}, [
        block('repeat', { count: 4 }, [
          block('glide', { feet: 14, seconds: 6 }),
          block('rotate', { degrees: 90 }),
        ]),
      ]),
    ],
  }));

  // --- Planting -----------------------------------------------------------
  for (const [x, z, seed] of [[-44, 30, 31], [30, -2, 32]]) {
    items.push(prop('meadow-clump', x, z, { options: { radius: 9, count: 260, height: 2.8, seed } }));
  }
  for (const [x, z, seed] of [[-6, 34, 41], [34, 22, 42]]) {
    items.push(prop('meadow-flowers', x, z, { options: { radius: 7, count: 36, seed } }));
  }
  items.push(prop('bramble-thicket', 34, -24, { options: { radius: 9, canes: 18, seed: 51 } }));
  items.push(prop('hawthorn-tree', -52, -6, { options: { height: 23, seed: 61 } }));

  // --- Words --------------------------------------------------------------
  items.push(
    prop('welcome-board', 40, 40, {
      rotY: face(40, 40),
      options: {
        eyebrow: '🐇  A RABBIT’S DEN',
        lead: 'Everything here is about four times life size.',
        lines: ['The bank is cut open.', 'Look inside for the nest.'],
        footnote: 'A real rabbit is about sixteen inches nose to tail',
      },
    }),
  );
  items.push(...browserStation(46, 50, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', 20, 34, {
    rotY: face(20, 34),
    options: {
      title: 'Built to be prey',
      body: 'Almost every part of a rabbit is about not being eaten. Its eyes sit high on the SIDES of its head, so it can see nearly all the way round without turning — the blind spot is directly in front of its nose, which is why it uses those long whiskers to judge gaps. The ears turn independently. The white tail is a signal: flashed while running, it tells every other rabbit in the field to bolt.',
    },
  }));
  items.push(prop('info-placard', -4, 8, {
    rotY: face(-4, 8),
    options: {
      title: 'Inside the warren',
      body: 'A warren is dug, not found. The wide tunnels are runs, and the small blind ones are bolt holes — escape shafts that stop just under the surface so a rabbit can burst out of the ground anywhere. The chamber low down is the nest: the doe lines it with grass and with fur pulled from her own chest, then blocks the entrance with soil every time she leaves.',
    },
  }));

  items.push(orb(-12, 4, 7, ORB_WARM));

  return { theme: 'warren', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Big Ben & Westminster
// ---------------------------------------------------------------------------

// A SMALL world: fifteen objects, most of the detail budget in one of them.
//
// The whole layout exists to give the Elizabeth Tower an approach and a scale. The student
// arrives on the south bank looking north across the river, which is the view every
// photograph of this building is taken from -- the tower stands clear against sky with the
// Palace running away to the left and the bridge crossing in front.
function londonLayout() {
  const items = [];
  const SP = { x: 4, z: 120 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  const TOWER = { x: -6, z: -34 };

  // --- The river, laid across the middle ----------------------------------
  // absoluteY: a water plane has nothing to do with the height of the ground under it, and
  // seated on the terrain it would ripple with the hills.
  items.push(prop('thames-water', 0, 44, { y: 0.4, absoluteY: true, options: { width: 380, depth: 96, seed: 31 } }));
  items.push(prop('embankment-wall', 0, 88, { options: { length: 190, height: 3.2, seed: 61 } }));
  items.push(prop('embankment-wall', -30, -8, { options: { length: 150, height: 4.6, seed: 62 } }));

  // --- The hero -----------------------------------------------------------
  items.push(prop('elizabeth-tower', TOWER.x, TOWER.z, {
    rotY: facing(TOWER.x, TOWER.z, SP.x, SP.z),
    options: { height: 144, base: 18, seed: 3 },
  }));

  // The Palace runs away to the WEST (left from the arrival), which is the real
  // relationship and also keeps it out of the tower's silhouette.
  items.push(prop('westminster-wing', -92, -26, {
    rotY: facing(-92, -26, SP.x, SP.z),
    options: { bays: 9, bayWidth: 11, height: 40, depth: 26, seed: 12 },
  }));
  items.push(prop('victoria-tower', -168, -20, {
    options: { height: 88, base: 22, seed: 19 },
  }));

  // --- The bridge ---------------------------------------------------------
  // Crossing the river to the right of the tower, so it leads the eye in rather than
  // cutting across the thing the world is about.
  items.push(prop('westminster-bridge', 74, 44, {
    rotY: Math.PI / 2,
    options: { span: 150, width: 26, arches: 5, deckY: 5.5, seed: 27 },
  }));

  // --- The animated object ------------------------------------------------
  // A Routemaster driving a square circuit on the south bank.
  //
  // `glide` rather than `move forward` because glide spans TIME -- it is the one block
  // that interpolates instead of teleporting, so the bus slides rather than jumping 46ft
  // at a stroke. And `move forward`/`glide` follow the object's own +Z, so the `rotate`
  // between legs genuinely steers it: four legs and four right-angles close the square
  // exactly, which is the fact several activity boards in this app teach.
  //
  // 11 seconds a leg over 46ft is about 4ft/sec -- a slow bus, deliberately, because the
  // circuit is small and anything quicker reads as a toy being whipped round a track.
  items.push(prop('routemaster', 46, 104, {
    rotY: Math.PI,
    options: { length: 13, width: 5.2, height: 7.6 },
    program: [
      block('forever', {}, [
        block('repeat', { count: 4 }, [
          block('glide', { feet: 46, seconds: 11 }),
          block('rotate', { degrees: 90 }),
        ]),
      ]),
    ],
  }));

  // --- Street furniture, for scale ----------------------------------------
  items.push(prop('phone-box', 18, 108, { rotY: face(18, 108), options: { height: 8.2, width: 3 } }));
  // Two of each, not four and three. The brief caps this world at twenty objects, and
  // street furniture is the right thing to spend the last slots on rather than the first:
  // a lamp and a tree are here for scale, and two give that as well as four do.
  for (const [x, z, seed] of [[-24, 104, 41], [40, 98, 42]]) {
    items.push(prop('embankment-lamp', x, z, { options: { height: 15, seed } }));
  }
  for (const [x, z, seed] of [[-40, 112, 51], [34, 116, 52]]) {
    items.push(prop('plane-tree', x, z, { options: { height: 26, seed } }));
  }

  // --- Words --------------------------------------------------------------
  items.push(
    prop('welcome-board', 26, 130, {
      rotY: face(26, 130),
      options: {
        eyebrow: '🇬🇧  BIG BEN & WESTMINSTER',
        lead: 'The Elizabeth Tower, from the south bank.',
        lines: ['Big Ben is the BELL, not the tower.', 'Watch for the red bus.'],
        footnote: 'Shown at about half size — the real tower is 316 feet',
      },
    }),
  );
  items.push(...browserStation(-16, 112, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', -2, 86, {
    rotY: face(-2, 86),
    options: {
      title: 'Big Ben is a bell',
      body: 'The name belongs to the great hour bell inside the belfry — 13.7 tonnes of it — and not to the tower, which was just called the Clock Tower until 2012. The bell cracked within weeks of being hung in 1859. Rather than recast it again they turned it slightly, fitted a lighter hammer, and left the crack; that is why its note is slightly off, and it has been ever since.',
    },
  }));
  items.push(prop('info-placard', 22, 78, {
    rotY: face(22, 78),
    options: {
      title: 'Reading the clock',
      body: 'Each of the four dials is 23 feet across and made of 312 pieces of opal glass. The minute hand is 14 feet long and travels about 118 miles a year. Look at the numerals: this clock uses IV, not the IIII most clock faces use. Under each dial runs the Latin line DOMINE SALVAM FAC REGINAM NOSTRAM VICTORIAM PRIMAM — "O Lord, keep safe our Queen Victoria the First".',
    },
  }));
  items.push(prop('info-placard', -54, 84, {
    rotY: face(-54, 84),
    options: {
      title: 'Why it looks medieval but is not',
      body: 'The old Palace burned down in 1834. What replaced it is Victorian, finished in the 1860s — but Charles Barry and A.W.N. Pugin built it in the Perpendicular Gothic of four centuries earlier, on purpose, so that the new Parliament would look as though it had always been there. Almost every detail you can see, including this bridge’s parapet, was designed to match a building that is younger than the railways.',
    },
  }));

  // --- Light ---------------------------------------------------------------
  items.push(orb(-6, 6, 9, ORB_WARM));

  return { theme: 'london', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Inside an Animal Cell
// ---------------------------------------------------------------------------

// Laid out as a TOUR with a spine, the way the Park is: the nucleus dead ahead at the far
// end, the other four main organelles flanking the walk up to it, and the small ones out
// at the sides. An organelle diagram has no natural front, so without an imposed axis a
// student arrives in a soup of blobs and has no idea which one they are meant to look at
// first.
//
// The five the brief asks for are the five a student is examined on: nucleus,
// mitochondrion, rough ER, Golgi, and the membrane itself. Everything else is support.
function cellLayout() {
  const items = [];
  const SP = { x: 0, z: 74 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- Arrival ------------------------------------------------------------
  // The board sits 24ft out, not the usual 12-14. It is 12ft wide on 9.2ft posts, so from
  // 14ft away its top edge subtends about 25 degrees -- MORE than the 50ft nucleus does
  // from 108ft away (about 23), and it hid the hero object of the world completely. Pushed
  // back to 24ft it drops to about 15 and the nucleus clears it comfortably. The general
  // rule: a near sign competes with a far landmark on ANGLE, not on size, so the fix is
  // distance rather than a smaller board.
  items.push(
    prop('welcome-board', 0, 50, {
      rotY: face(0, 50),
      options: {
        eyebrow: '🔬  INSIDE AN ANIMAL CELL',
        lead: 'You have been shrunk about six million times.',
        lines: ['Five organelles, all to scale.', 'The nucleus is straight ahead.'],
        footnote: 'The whole cell would be a fifth the width of a human hair',
      },
    }),
  );
  items.push(...browserStation(9, 64, { faceX: SP.x, faceZ: SP.z }));

  // --- The cell boundary --------------------------------------------------
  // A ring of curved wall sections. It is what stops this reading as organelles standing
  // in an open field -- a cell's defining feature is that it HAS an edge.
  const WALL_R = 108;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * WALL_R;
    const z = Math.sin(a) * WALL_R;
    items.push(prop('membrane-wall', x, z, {
      rotY: facing(x, z, 0, 0),
      options: { span: 72, height: 17, curve: 0.16, seed: 9 + i },
    }));
  }

  // --- 1. The nucleus, at the head of the walk ----------------------------
  // Turned so its cutaway mouth faces the arrival. A cutaway pointed away is a closed
  // sphere, and the whole reason it is cut open is to be looked into.
  items.push(prop('cell-nucleus', 0, -34, {
    rotY: facing(0, -34, SP.x, SP.z),
    options: { radius: 25, pores: 30, seed: 3 },
  }));
  // The tag goes BESIDE the nucleus, not in front of it. Centred on the walk it hangs
  // squarely over the cutaway mouth and hides the nucleolus and chromatin -- which are the
  // only reason the thing is cut open. Clear of an object is not the same as readable, and
  // that cuts both ways.
  items.push(prop('organelle-tag', 23, -8, {
    rotY: face(23, -8),
    y: 7,
    options: {
      name: 'Nucleus',
      realSize: 'really about 6 µm across',
      job: 'Holds the DNA · controls the cell',
      width: 13,
      accent: '#c79ae8',
    },
  }));
  items.push(prop('info-placard', -13, -4, {
    rotY: face(-13, -4),
    options: {
      title: 'The nucleus',
      body: 'The biggest thing in the cell and the one in charge. The purple shell is a DOUBLE membrane — look for the gold rings, which are nuclear pores: the doorways that let messages out to the ribosomes. The dark ball inside is the nucleolus, where ribosomes are built. The loose pink threads are chromatin — not neat X-shaped chromosomes, because those only exist while a cell is dividing.',
    },
  }));

  // --- 2. Mitochondrion ---------------------------------------------------
  items.push(prop('mitochondrion', -46, 8, {
    rotY: facing(-46, 8, SP.x, SP.z),
    options: { length: 34, radius: 7.5, cristae: 12, seed: 8 },
  }));
  items.push(prop('organelle-tag', -26, -2, {
    rotY: face(-26, -2),
    y: 5,
    options: {
      name: 'Mitochondrion',
      realSize: 'really about 2 µm long',
      job: 'Releases energy from food',
      width: 12,
      accent: '#f2a05c',
    },
  }));
  items.push(prop('info-placard', -34, 24, {
    rotY: face(-34, 24),
    options: {
      title: 'The powerhouse',
      body: 'It is cut open lengthwise so you can see the folds. Those folds are called cristae, and they are the point: folding the inner membrane back and forth packs an enormous surface area into a tiny space, and that surface is where energy is actually released. A muscle cell has thousands of these. A skin cell has far fewer.',
    },
  }));
  items.push(prop('mitochondrion', -62, -22, {
    rotY: 0.9,
    options: { length: 26, radius: 6, cristae: 9, seed: 14 },
  }));

  // --- 3. Rough ER, wrapped round the nucleus -----------------------------
  // Placed touching the nucleus on purpose: the rough ER is CONTINUOUS with the nuclear
  // envelope, and putting it across the room would quietly teach that they are unrelated.
  items.push(prop('rough-er', 40, -18, {
    rotY: facing(40, -18, 0, -34),
    options: { width: 30, depth: 18, sheets: 5, seed: 12 },
  }));
  items.push(prop('organelle-tag', 62, -22, {
    rotY: face(62, -22),
    y: 5,
    options: {
      name: 'Rough ER',
      realSize: 'sheets about 50 nm thick',
      job: 'Builds and folds proteins',
      width: 12,
      accent: '#6f9ee0',
    },
  }));
  items.push(prop('info-placard', 28, 4, {
    rotY: face(28, 4),
    options: {
      title: 'Why "rough"?',
      body: 'The blue beads all over it. Each one is a ribosome — the machine that reads the instructions from the nucleus and builds a protein from them. Nothing else makes it rough. Notice the sheets run right up to the nucleus: the rough ER is joined to the nuclear envelope, so a message has almost no distance to travel.',
    },
  }));
  items.push(prop('smooth-er', 62, 6, {
    rotY: 0.4,
    options: { extent: 14, strands: 9, seed: 21 },
  }));
  items.push(prop('organelle-tag', 80, 16, {
    rotY: face(80, 16),
    y: 4,
    options: {
      name: 'Smooth ER',
      realSize: 'tubes about 60 nm across',
      job: 'Makes fats · no ribosomes',
      width: 10,
      accent: '#d9c07a',
    },
  }));

  // --- 4. Golgi -----------------------------------------------------------
  items.push(prop('golgi-body', 34, 34, {
    rotY: facing(34, 34, SP.x, SP.z),
    options: { width: 24, sacs: 6, seed: 17 },
  }));
  items.push(prop('organelle-tag', 54, 40, {
    rotY: face(54, 40),
    y: 4,
    options: {
      name: 'Golgi Body',
      realSize: 'really about 1.5 µm wide',
      job: 'Packs and ships proteins',
      width: 12,
      accent: '#5fd0cf',
    },
  }));
  items.push(prop('info-placard', 21, 44, {
    rotY: face(21, 44),
    options: {
      title: 'The post office',
      body: 'Proteins arrive from the ER at the bottom of the stack, get finished and labelled as they move up it, and leave from the top wrapped in a bubble — one of the little green vesicles pinching off the edges. The stack is curved, always; that dish shape is how you tell a Golgi from anything else in a picture.',
    },
  }));

  // --- 5. The membrane, as a cutaway diagram ------------------------------
  // Standing on its own out to the side, well clear of the walk, because it is a wall and
  // a wall across a route is an obstacle.
  items.push(prop('membrane-panel', -30, 52, {
    rotY: face(-30, 52),
    options: { width: 32, height: 14, columns: 28, seed: 5 },
  }));
  items.push(prop('organelle-tag', -50, 60, {
    rotY: face(-50, 60),
    y: 4,
    options: {
      name: 'Cell Membrane',
      realSize: 'really about 8 nm thick',
      job: 'Decides what gets in and out',
      width: 13,
      accent: '#f0d68c',
    },
  }));
  items.push(prop('info-placard', -46, 56, {
    rotY: face(-46, 56),
    options: {
      title: 'Two layers, tails inward',
      body: 'This is a slice through the wall you can see curving away all around you, blown up much larger again. Every gold ball is the water-loving head of one phospholipid and the two strands under it are its water-hating tails — which is why they point at each other in the middle. The blue barrels are channel proteins: the doors. Nothing crosses this wall by accident.',
    },
  }));

  // --- Supporting organelles ----------------------------------------------
  items.push(prop('lysosome', 56, -40, { options: { radius: 5, seed: 30 } }));
  items.push(prop('lysosome', -18, -56, { options: { radius: 4, seed: 31 } }));
  items.push(prop('lysosome', -74, 4, { options: { radius: 4.4, seed: 32 } }));

  // Loose vesicles drifting between the Golgi and the wall -- the traffic the coding
  // challenge is one example of. Several, because one in transit reads as a stray bubble
  // and a stream of them reads as a process.
  for (const [x, z, r, seed] of [[8, 44, 2.2, 42], [-6, 50, 1.9, 43], [-44, 34, 2.4, 44], [46, 14, 2.0, 45], [-64, -8, 2.2, 46]]) {
    items.push(prop('transport-vesicle', x, z, { options: { radius: r, cargo: 6, seed } }));
  }
  items.push(prop('organelle-tag', 72, -36, {
    rotY: face(72, -36),
    y: 3,
    options: { name: 'Lysosome', realSize: 'about 0.5 µm', job: 'Digests worn-out parts', width: 9, accent: '#e88ab8' },
  }));

  items.push(prop('centriole-pair', -66, 40, {
    rotY: 0.6,
    options: { length: 8, radius: 2.6 },
  }));
  items.push(prop('organelle-tag', -82, 46, {
    rotY: face(-82, 46),
    y: 3,
    options: { name: 'Centrioles', realSize: 'about 0.5 µm long', job: 'Pull chromosomes apart', width: 10, accent: '#b9c6d6' },
  }));
  items.push(prop('info-placard', -78, 46, {
    rotY: face(-78, 46),
    options: {
      title: 'Nine sets of three',
      body: 'Count the tubes around one barrel: nine groups of three, every time, in every animal cell anybody has ever looked at. The two barrels sit at right angles to each other. When the cell divides, these move to opposite ends and haul the chromosomes apart.',
    },
  }));

  // Free ribosomes, clustered rather than scattered -- about half of a cell's ribosomes
  // really are loose in the cytosol rather than on the ER, and a group says that where
  // five lone specks across the world just look like litter.
  for (const [x, z, s] of [[52, 40, 1], [57, 44, 2], [48, 45, 3], [-52, -44, 4], [24, -56, 5]]) {
    items.push(prop('free-ribosome', x, z, { options: { radius: 1.5 + (s % 2) * 0.3 } }));
  }
  items.push(prop('organelle-tag', 66, 38, {
    rotY: face(66, 38),
    y: 4,
    options: {
      name: 'Free Ribosomes',
      // The honesty label. Everything else in this world is at one scale and these are not,
      // so the tag says it outright rather than letting a student measure them against the
      // mitochondrion and draw the wrong conclusion.
      realSize: 'really 25 nm — shown much bigger',
      job: 'Build proteins loose in the cytosol',
      width: 12,
      accent: '#6f9ee0',
    },
  }));

  // Cytoskeleton across the open middle -- without it the space between organelles is
  // empty and a cell reads as a room with furniture in it.
  //
  // THIN, and kept off the main walk. At radius 0.45 these read as scaffolding poles and
  // were the most prominent thing in the arrival frame -- which is exactly backwards, since
  // they are the one thing here that is meant to be structure rather than subject. A
  // microtubule is 25nm; even at 0.22 they are enormously oversize already.
  for (const [x, z, r, seed] of [[-34, 12, 0.7, 55], [40, -6, -0.4, 56], [-46, -34, 1.3, 57], [58, 22, 0.2, 58], [8, -64, 1.0, 59]]) {
    items.push(prop('cytoskeleton-strand', x, z, { rotY: r, options: { length: 46, radius: 0.22, seed } }));
  }

  // --- The vesicle the coding challenge moves -----------------------------
  // Its own record, sitting just off the Golgi's shipping face and pointed at the membrane
  // panel, so `move forward` sends it the right way with no rotate needed first. Anything
  // a student is invited to program has to be a thing they can click, which is why it is
  // not one of the Golgi's own buds.
  items.push(prop('transport-vesicle', 20, 40, {
    rotY: facing(20, 40, -30, 52),
    options: { radius: 3, cargo: 8, seed: 41 },
  }));

  // --- Challenges ---------------------------------------------------------
  items.push(activity(-22, 54, {
    number: 1,
    title: 'Ship the protein out',
    target: 'the green transport vesicle by the Golgi',
    rotY: face(-22, 54),
    accent: '#2f9c8f',
    steps: [
      ctrlStep('repeat 12 times'),
      moveStep('move forward 4 feet', 1),
      ctrlStep('wait 0.3 seconds', 1),
      lookStep('change size by -4 %', 1),
    ],
    tip: 'It is already pointing at the cell membrane, so it travels the real route a finished protein takes: Golgi → vesicle → wall. Shrinking as it goes is what happens when it fuses and empties.',
  }));

  items.push(activity(24, 54, {
    number: 2,
    title: 'Make the powerhouse pulse',
    target: 'the big orange mitochondrion',
    rotY: face(24, 54),
    accent: '#d4633c',
    steps: [
      ctrlStep('forever'),
      lookStep('change size by 6 %', 1),
      ctrlStep('wait 0.4 seconds', 1),
      lookStep('change size by -6 %', 1),
      ctrlStep('wait 0.4 seconds', 1),
    ],
    tip: 'Mitochondria really do change shape — they stretch, split and join up all day. Change the 6 to 20 and watch it get out of hand.',
  }));

  // --- Light ---------------------------------------------------------------
  // Orbs are the app's own fill lighting, and ORB_LIGHT_DISTANCE is nearly spent by ~12ft,
  // so these sit low and close to what they are meant to light rather than up in the sky
  // where they would read as floating balls -- the Moon's lesson.
  items.push(orb(0, -14, 9, ORB_ROSE));
  items.push(orb(-44, 12, 8, ORB_WARM));
  items.push(orb(38, -14, 8, ORB_BLUE));
  items.push(orb(32, 34, 8, ORB_WHITE));
  items.push(orb(-30, 50, 8, ORB_WARM));

  return { theme: 'cell', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Inside a Twister
// ---------------------------------------------------------------------------

// A supercell over wheat country, with the tornado about 110ft out and slightly to the
// left of the arrival sightline.
//
// WHY NOT DEAD AHEAD: at 110ft a 92ft column with a 190ft cloud deck over it fills the
// whole frame, and a student arrives looking at grey. Offset, they get the funnel, the
// lit wheat beside it and the wrecked farm in one view -- which is the photograph this
// world is modelled on. The camera's fov of 70 is VERTICAL, so a 16:9 screen sees about
// 51 degrees either side; the funnel sits about 22 degrees off, comfortably inside it.
function twisterLayout() {
  const items = [];
  const SP = { x: 0, z: 96 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  const TORNADO = { x: -42, z: -18 };

  // --- Arrival ------------------------------------------------------------
  items.push(
    prop('welcome-board', 9, 76, {
      rotY: face(9, 76),
      options: {
        eyebrow: '🌪  INSIDE A TWISTER',
        lead: 'An EF4 is crossing the wheat.',
        lines: ['It is turning. Watch the ribs.', 'The farm was in its path.'],
        footnote: 'Stay out of the debris — or do not, nothing here can hurt you',
      },
    }),
  );
  items.push(...browserStation(-11, 86, { faceX: SP.x, faceZ: SP.z }));

  // --- 1. The funnel, turning ---------------------------------------------
  // The program ships ON the record, so it is already rotating when the world finishes
  // loading -- nobody has to find it and press play. It is an ordinary program: a student
  // can click the funnel, open it, read it and change the number.
  //
  // 0.6 degrees, which is 0.3 a FRAME and not 0.6 -- `forever` yields once per pass over
  // its children on top of the yield from `rotate` itself, so one turn of the loop costs
  // two frames. That is deliberate in the runner (it is what stops a `forever` holding an
  // empty body from spinning the tab to a halt) and it silently halves the rate of every
  // program written like this one. Measured rather than assumed: 120 ticks gave 21 degrees.
  //
  // The result is about 18 degrees a second, one rotation every 20 seconds. Slow, as asked.
  // Much faster and the helical ribs alias into a flicker instead of reading as a turn.
  items.push(prop('tornado-funnel', TORNADO.x, TORNADO.z, {
    options: { height: 94, topRadius: 22, waistRadius: 5.4, seed: 11 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.6 })])],
  }));

  // The storm above it. absoluteY, because a cloud deck has nothing to do with the height
  // of the ground under it -- seated on the terrain it would ripple with the hills.
  items.push(prop('supercell-base', TORNADO.x, TORNADO.z, {
    y: 104,
    absoluteY: true,
    options: { span: 200, thickness: 17, wallCloud: true, seed: 21 },
  }));
  // A second, higher deck further back, so the sky has depth rather than one flat lid.
  items.push(prop('supercell-base', 40, -120, {
    y: 128,
    absoluteY: true,
    options: { span: 150, thickness: 14, wallCloud: false, seed: 26 },
  }));

  // Rain trailing behind the storm, on the far side of the funnel from the sun -- which is
  // where it actually falls, and it keeps the curtain from washing out the lit wheat.
  items.push(prop('rain-curtain', 30, -78, { rotY: 0.35, options: { width: 90, height: 62, seed: 33 } }));
  items.push(prop('rain-curtain', -6, -96, { rotY: -0.2, options: { width: 70, height: 55, seed: 34 } }));

  items.push(prop('info-placard', -20, 52, {
    rotY: face(-20, 52),
    options: {
      title: 'What you are looking at',
      body: 'The funnel is not made of dust — it is CLOUD. Air spiralling inward drops in pressure, the water in it condenses, and that is what turns the column white enough to see. The brown at the bottom is the only part that is dirt. If the pressure is not low enough to condense, a tornado is completely invisible until it picks something up.',
    },
  }));

  // --- 2. The wrecked farmstead, in the path ------------------------------
  // Between the tornado and the spawn, and slightly to the right of the funnel, so the
  // damage reads as a TRAIL leading back to the thing that caused it rather than as a
  // separate ruin somewhere else in the field.
  items.push(prop('wrecked-farmhouse', -6, 26, {
    rotY: 0.3,
    options: { width: 24, depth: 17, wallH: 10, seed: 44 },
  }));
  items.push(prop('prairie-barn', 34, 6, {
    rotY: -0.5,
    options: { width: 26, depth: 18, wallH: 12, lean: 0.07, seed: 51 },
  }));
  items.push(prop('grain-silo', 52, 16, { options: { height: 25, radius: 5, seed: 61 } }));
  items.push(prop('farm-windmill', 22, 34, { options: { height: 26, blades: 16, seed: 71 } }));

  items.push(prop('info-placard', 6, 44, {
    rotY: face(6, 44),
    options: {
      title: 'Read the damage',
      body: 'The house lost its roof and the wall facing the storm; the barn is still standing but leaning. That difference is how damage surveyors assign a rating after a tornado has gone — nobody measures the wind directly, so the wreckage IS the measurement. Look at the chart by the trucks.',
    },
  }));

  // Debris trailing from the funnel toward the farm.
  for (const [x, z, r, seed] of [[-26, 8, 13, 91], [-14, 18, 11, 92], [2, 30, 12, 93], [16, 20, 10, 94], [-34, -2, 14, 95]]) {
    items.push(prop('debris-field', x, z, { options: { radius: r, count: 24, seed } }));
  }

  // Power line, snapped where the funnel crossed it. The poles nearest the tornado are
  // broken and the far ones are not -- a line of identical poles teaches nothing, a line
  // that fails at one end shows exactly how wide the damage path was.
  for (let i = 0; i < 7; i++) {
    const x = -78 + i * 22;
    const z = 58;
    const broken = x < -12;
    items.push(prop('power-pole', x, z, { options: { height: 20, broken, seed: 101 + i } }));
  }

  for (const [x, z, seed] of [[-58, 30, 121], [-46, 46, 122], [-70, 8, 123], [-30, -34, 124]]) {
    items.push(prop('snapped-tree', x, z, { options: { height: 15, seed } }));
  }

  // --- 3 & 5. The chase vehicles ------------------------------------------
  // Parked to the RIGHT of the arrival, facing the storm, with the student behind them --
  // which is where a chase team actually sits, and it puts the science between the student
  // and the tornado rather than off in a corner.
  items.push(prop('chase-vehicle', 46, 62, {
    rotY: facing(46, 62, TORNADO.x, TORNADO.z),
    options: { length: 15, width: 6.4 },
  }));
  items.push(prop('doppler-truck', 66, 46, {
    rotY: facing(66, 46, TORNADO.x, TORNADO.z),
    options: { length: 18, width: 7, dishRadius: 6.2 },
  }));
  items.push(prop('storm-probe', 30, 52, {}));
  items.push(prop('storm-probe', 24, 46, {}));

  // `organelle-tag` in a tornado world is deliberate reuse, not a stray paste: it is a
  // generic floating double-sided name plate and this is the one label here that has to be
  // readable from both sides. Same reasoning as moonCrater() and moonRocks() serving Mars
  // and Dinosaur Island -- these keys are persisted, so a second identical builder under a
  // prettier name would be a permanent duplicate to keep in step.
  items.push(prop('organelle-tag', 56, 56, {
    rotY: face(56, 56),
    y: 6,
    options: {
      name: 'Doppler on Wheels',
      realSize: 'reads wind at 100+ mph',
      job: 'Measures the spin from a mile away',
      width: 13,
      accent: '#7fc4f0',
    },
  }));
  items.push(prop('info-placard', 40, 74, {
    rotY: face(40, 74),
    options: {
      title: 'How the speed is measured',
      body: 'Radar does not see wind — it sees rain and debris. The dish sends a pulse and listens for what comes back, and the returning signal is squeezed slightly higher in pitch by anything moving toward it and lower by anything moving away. Both at once, right next to each other, means something is turning. That signature is what puts a tornado warning on a phone.',
    },
  }));

  // The EF chart, beside the trucks where the measuring happens.
  items.push(prop('ef-scale-board', 74, 68, {
    rotY: face(74, 68),
    options: { width: 12, postHeight: 3.6, highlight: 4 },
  }));

  // --- Landscape -----------------------------------------------------------
  // DENSE clumps on a wheat-coloured ground, rather than a thin carpet over everything.
  //
  // The theme's own groundLow/groundHigh are already gold, so the field reads as wheat from
  // the ground colour alone; the patches are there to give it texture where a student
  // actually stands. Spreading the same stalk budget over radius-20 patches made each one
  // about one stalk per five square feet -- individually visible poles with bare soil
  // between them, which is stubble, not crop. Fewer patches, packed harder, sited off the
  // arrival sightline so nothing near the camera turns into a picket fence.
  const WHEAT = [
    [-88, 74], [-52, 84], [46, 86], [82, 68], [104, 44],
    [-96, 34], [-62, 40], [58, 40], [92, 12],
    [-100, -8], [-68, -18], [-36, -54], [14, -62], [52, -48], [88, -26],
    [-30, 64], [34, 62],
  ];
  WHEAT.forEach(([x, z], i) => {
    items.push(prop('wheat-patch', x, z, { options: { radius: 13, count: 520, height: 3.4, seed: 81 + i } }));
  });

  for (const [x, z, seed] of [[-72, 62, 111], [64, 74, 112], [-20, 70, 113], [80, 36, 114], [-100, 6, 115], [44, -22, 116]]) {
    items.push(prop('hay-bale', x, z, { rotY: seed * 0.7, options: { radius: 2.4, width: 3.2, seed } }));
  }

  // --- Challenges ---------------------------------------------------------
  items.push(activity(-16, 78, {
    number: 1,
    title: 'Speed the twister up',
    target: 'the tornado itself',
    rotY: face(-16, 78),
    accent: '#5b6270',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 0.6 degrees', 1),
    ],
    tip: 'This program is ALREADY running on it — click the funnel and choose Program to see it. Change 0.6 to 5 and it becomes a violent one. Try a negative number: real tornadoes in this hemisphere almost always turn one way.',
  }));

  items.push(activity(18, 78, {
    number: 2,
    title: 'Fly the debris',
    target: 'any plank in a debris field',
    rotY: face(18, 78),
    accent: '#8a6a3c',
    steps: [
      ctrlStep('forever'),
      moveStep('move up by 1 feet', 1),
      moveStep('rotate 25 degrees', 1),
      ctrlStep('wait 0.1 seconds', 1),
      moveStep('move up by -0.6 feet', 1),
    ],
    tip: 'Up more than down, so it climbs while it tumbles. Swap the numbers around and you have something being sucked into the ground instead.',
  }));

  // --- Light ---------------------------------------------------------------
  // Very few, and low. Under a storm base the light is flat and grey; a scattering of warm
  // orbs would undo the one contrast this world is built on.
  items.push(orb(46, 60, 7, ORB_WARM));
  items.push(orb(-6, 30, 8, ORB_WHITE));

  return { theme: 'twister', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Constellations
// ---------------------------------------------------------------------------

// A dark observing field with eight constellation boards down an avenue, an armillary sphere
// turning at the head of it, and the winter sky itself hanging overhead.
//
// THE WHOLE WORLD IS BUILT ON ONE COMPASS DECISION: north is +Z, which is BEHIND a student who
// spawns facing -Z. That is not arbitrary and it is not reversible without redoing every
// number in here.
//
//  * Facing away from the pole means facing SOUTH, and the south is where the bright winter
//    constellations are. So the arrival view is Orion, dead ahead and high -- the single most
//    recognisable thing in the sky, given away for free before a student has read anything.
//  * Polaris, Ursa Major and Cassiopeia are therefore behind, over the entrance, which turns
//    "turn round" into an actual instruction with an actual payoff. The Polaris sight stands
//    16ft BEHIND the spawn aimed north, so it is the thing a student finds the moment they
//    look back, with the pole star directly above it.
//
// THE SKY IS ONE SEASON, and that is a correctness decision rather than a stylistic one.
// Orion and Scorpius are never up together -- one is a winter sky and the other a summer one --
// so hanging all eight figures overhead at once would put a plainly false sky over a world
// whose whole job is teaching what is really up there. Only the winter and circumpolar figures
// are in the sky; the other four are on their boards, and a placard says exactly why. That
// gap is what the planisphere is for.
function constellationsLayout() {
  const items = [];
  const SP = { x: 0, z: 76 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The hero: an armillary sphere, turning -----------------------------
  // 42ft ahead and dead centre. At radius 5.2 the sphere is 12ft across on a 5ft pedestal, so
  // it stands about 17 degrees wide and 15 tall from the spawn -- a monument rather than an
  // ornament, and comfortably inside a 16:9 screen's ~51 degrees either side.
  //
  // 0.14 degrees written is 0.07 a FRAME, because `forever` yields once per pass on top of
  // the yield from `rotate` itself. That is about 4 degrees a second: a full turn in a minute
  // and a half. Slow enough to notice rather than watch, which is what the real sky does.
  items.push(prop('armillary-sphere', 0, 34, {
    rotY: Math.PI, // its polar axis is authored toward +Z, and north here is +Z
    options: { radius: 5.2, latitude: 39, seed: 33 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.14 })])],
  }));

  // --- The eight boards, as an avenue -------------------------------------
  // Two columns fanning outward with distance, which is what keeps a near board from hiding a
  // far one, and every one of them turned to face the spawn. The angles off the arrival
  // sightline run 39, 31, 25 and 16 degrees from front to back -- all inside the frame, none
  // of them in the middle of it where the armillary is.
  const BOARDS = [
    ['orion', -28, 42, '#6f9bd1'],
    ['taurus', 28, 42, '#d19b6f'],
    ['ursaMajor', -38, 12, '#7fb8d9'],
    ['cassiopeia', 38, 12, '#a98fd0'],
    ['cygnus', -42, -18, '#79c2b0'],
    ['leo', 42, -18, '#d9b45f'],
    ['scorpius', -36, -46, '#d1786f'],
    ['crux', 36, -46, '#8fa5d9'],
  ];
  BOARDS.forEach(([figure, x, z, accent], i) => {
    items.push(prop('constellation-board', x, z, {
      rotY: face(x, z),
      options: { figure, accent, seed: 11 + i * 7 },
    }));
  });

  // --- The sky ------------------------------------------------------------
  // Every one of these floats, so they take an absoluteY and their own `tilt` -- a pattern
  // hung 100ft up and seen from 200ft out is met at a steep angle, and a record carries only
  // rotX (applied about the WORLD x-axis, after the yaw), which would roll a figure rather
  // than tip it. See the note on skyConstellation().
  //
  // Orion sits at 26 degrees of altitude and spans 20, so it runs from 16 to 36 degrees: in
  // frame on arrival without the student touching the mouse, which is the whole point of
  // putting it there.
  // 11 degrees left of the centre line rather than on it. Its name plate hangs 41ft below the
  // pattern, which on the axis put the label at exactly the altitude of the armillary's top
  // ring: the label and the hero of the world were fighting over one patch of sky.
  items.push(prop('sky-constellation', -40, -124, {
    y: 102, absoluteY: true, rotY: facing(-40, -124, SP.x, SP.z),
    options: { figure: 'orion', span: 82, tilt: 0.44, roll: -0.15, seed: 21 },
  }));
  items.push(prop('sky-constellation', 68, -112, {
    y: 150, absoluteY: true, rotY: facing(68, -112, SP.x, SP.z),
    options: { figure: 'taurus', span: 68, tilt: 0.628, roll: 0.35, seed: 22 },
  }));
  // Ursa Major and Cassiopeia flank the pole, BEHIND the spawn. Ursa Major's roll is set so
  // its two pointer stars really do lead the eye to where Polaris has been hung -- the board
  // beside it promises they do.
  items.push(prop('sky-constellation', 68, 176, {
    y: 118, absoluteY: true, rotY: facing(68, 176, SP.x, SP.z),
    options: { figure: 'ursaMajor', span: 88, tilt: 0.75, roll: Math.PI / 2, seed: 23 },
  }));
  items.push(prop('sky-constellation', -66, 172, {
    y: 112, absoluteY: true, rotY: facing(-66, 172, SP.x, SP.z),
    options: { figure: 'cassiopeia', span: 72, tilt: 0.74, roll: -1.0, seed: 24 },
  }));
  // Polaris: due north, 37 degrees up from the spawn and 39 from the sight below it.
  items.push(prop('sky-star', 0, 190, {
    y: 90, absoluteY: true, rotY: facing(0, 190, SP.x, SP.z),
    options: { magnitude: 1.98, spectral: 'F', size: 5.2, label: 'POLARIS', sub: 'the pole star', tilt: 0.64 },
  }));

  // Turned to run NORTH-SOUTH (rotY = 90 degrees puts its length along Z) and centred nearly
  // overhead, which is both where the winter Milky Way actually is -- it passes through Orion's
  // half of the sky and on over the zenith -- and the only orientation that reads as a band.
  // Running east-west it crossed one corner of the frame as a tapering wedge, which the eye
  // insists on reading as a comet.
  items.push(prop('milky-way', 0, 20, {
    y: 168, absoluteY: true, rotY: Math.PI / 2,
    options: { length: 460, width: 115, tilt: 0.85, opacity: 0.5, seed: 81 },
  }));

  // The Moon, hung where the world's own light comes FROM. The `constellations` theme puts its
  // directional light at [-150, 90, -60] -- low, ahead and well to the left -- so this is the
  // one world in the app where the light has a visible source in the sky, and the lit limb of
  // the Moon and the lit sides of everything on the ground agree.
  items.push(prop('moon-in-sky', -212, -16, {
    y: 128, absoluteY: true, options: { radius: 15, seed: 91 },
  }));

  // A meteor, flying. rotX tips its facing DOWN: `glide` follows the object's own +Z, and a
  // record's rotX is applied about the world x-axis after the yaw, so with this yaw a negative
  // rotX is what makes it descend rather than climb.
  items.push(prop('meteor', 96, -26, {
    y: 138, absoluteY: true, rotY: -1.9, rotX: -0.22,
    options: { length: 30, seed: 101 },
    program: [block('forever', {}, [
      block('glide', { feet: 170, seconds: 1.3 }),
      block('goHome'),
      block('wait', { seconds: 4 }),
    ])],
  }));

  // --- The instruments ----------------------------------------------------
  // The planisphere, as its two props: a fixed stand carrying the date scale and an index
  // that never moves, and the printed sky disc that turns inside it. The disc's rate is
  // deliberately faster than the armillary's -- this one is a demonstration of a whole year
  // going past, not of one night.
  items.push(prop('sky-wheel-stand', -16, -34, { rotY: face(-16, -34), options: { radius: 4.2, height: 3.3, seed: 51 } }));
  items.push(prop('sky-wheel-disc', -16, -34, {
    y: 3.45, rotY: face(-16, -34),
    options: { radius: 4.2, seed: 52 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.5 })])],
  }));

  items.push(prop('spectral-row', 17, -34, { rotY: face(17, -34), options: { length: 14, seed: 61 } }));

  // The Polaris sight, 16ft BEHIND the spawn and aimed north up the +Z axis at the star hung
  // above it. Its own reading plate is on the +Z face, which is the side a student stands on
  // to look through the tube -- you get behind a sight, not in front of it.
  items.push(prop('polaris-sight', 0, 92, { rotY: 0, options: { altitude: 39, height: 4.4, seed: 71 } }));

  items.push(prop('chart-table', -10, 66, { rotY: face(-10, 66), options: { width: 4.6, seed: 111 } }));

  // --- Words --------------------------------------------------------------
  // 25 degrees off the arrival sightline and 35ft out, not the usual 40-plus. At 45 degrees a
  // 12ft board has its outer half outside the ~48 degrees a 16:9 screen actually sees -- which
  // is what the first pass did, and it clipped the one board a student is meant to read first.
  items.push(prop('welcome-board', -15, 44, {
    rotY: face(-15, 44),
    options: {
      width: 10,
      eyebrow: '✦  THE CONSTELLATIONS',
      lead: 'Eight boards down the field. The same stars are overhead.',
      lines: ['Orion is straight ahead.', 'Now turn round and find Polaris.'],
      footnote: 'The brass sphere at the head of the avenue is already running a program',
    },
  }));
  items.push(...browserStation(24, 58, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', -11, 30, {
    rotY: face(-11, 30),
    options: {
      title: 'Why the whole sky turns',
      body: 'Nothing up there is moving the way it looks like it is. The Earth spins once a day, and because you are standing on it, everything else appears to swing the opposite way — 15 degrees every hour. Point at a star, wait an hour, and you are pointing 15 degrees off. The only exception is Polaris: it sits almost exactly above the North Pole, on the axis the Earth spins about, so it stays put while the entire rest of the sky wheels around it. Every trail in a long night-time photograph is a circle centred on that one star.',
    },
  }));
  items.push(prop('info-placard', 11, 30, {
    rotY: face(11, 30),
    options: {
      title: 'You are looking into the past',
      body: 'Light is fast but the sky is enormous, so everything you can see up there is out of date. The Moon is a second and a half old. The Sun is eight minutes. Sirius is nine years — light that left it when you were small. Betelgeuse in Orion is about 550 years, so you are seeing it as it was before anybody had sailed to America, and Deneb in Cygnus is around 1,500. The stars in one constellation are nowhere near each other: they are at wildly different distances and only look like a group because we are all looking from one spot.',
    },
  }));
  items.push(prop('info-placard', -22, -8, {
    rotY: face(-22, -8),
    options: {
      title: 'Tonight is a WINTER sky',
      body: 'Four of the eight boards show constellations you cannot see this evening, and that is not a mistake. As the Earth goes round the Sun, the night side of the planet faces a different part of space each season — so Scorpius and Cygnus are up there right now in the daytime, lost in sunlight, and they will be back on summer nights when Orion is the one that has gone. Crux never appears at all from this latitude. The star wheel down the field is the tool that answers "what is up tonight": line the date against the hour and read off the sky.',
    },
  }));
  items.push(prop('info-placard', 22, -8, {
    rotY: face(22, -8),
    options: {
      title: 'Why every lamp here is red',
      body: 'Your eyes take twenty to thirty minutes in the dark to reach full sensitivity, as a chemical called rhodopsin builds up in them — and one glance at a white light destroys it in a second. Red light barely touches rhodopsin, so observers use red torches and red lamps for everything, and the lamps on this field are hooded to throw their light down rather than sideways. It is worth trying for yourself on a clear night: wait half an hour without looking at a phone and the number of stars you can see roughly triples.',
    },
  }));

  // --- Two programming challenges -----------------------------------------
  items.push(activity(16, 30, {
    number: 1,
    title: 'Speed up the whole sky',
    target: 'the brass armillary sphere',
    rotY: face(16, 30),
    accent: '#d9b45f',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 0.14 degrees', 1),
    ],
    tip: 'This one is ALREADY running — click the sphere and choose Program to read it. The real sky takes 24 hours to come back round. Change 0.14 to 6 and watch a day go by in seconds, or make it negative and run time backwards.',
  }));

  items.push(activity(-22, 6, {
    number: 2,
    title: 'Throw a shooting star',
    target: 'the meteor high on your left',
    rotY: face(-22, 6),
    accent: '#79c2b0',
    steps: [
      ctrlStep('forever'),
      moveStep('glide 170 feet over 1.3 seconds', 1),
      moveStep('go back to start', 1),
      ctrlStep('wait 4 seconds', 1),
    ],
    tip: '`go back to start` is what makes it repeat instead of leaving the world — the meteor is put back where it began. Shorten the wait and you have a meteor shower. Real ones are grains of dust the size of this full stop, burning up sixty miles above you.',
  }));

  // --- Field furniture ----------------------------------------------------
  for (const [x, z] of [[-26, 30], [26, 28], [-30, -4]]) {
    items.push(prop('bench', x, z, { rotY: face(x, z), options: { length: 5, woodColor: 0x5f4a33 } }));
  }
  items.push(prop('red-lamp', -22, 14, { options: { height: 9, seed: 121 } }));
  items.push(prop('red-lamp', 22, 14, { options: { height: 9, seed: 122 } }));

  // Two orbs only. This world's darkness IS the exhibit, and every board in it is emissive
  // for exactly that reason -- a scattering of warm orbs would light the field up and throw
  // the sky away with it.
  // NOT at (0, 34): that is the armillary sphere's own position, and an orb hung 12ft up there
  // sits INSIDE the rings as a white ball floating next to the Earth at the centre of the
  // instrument. It reads as a modelling mistake, because it is one.
  // Both OFF the arrival sightline. An orb is a visible glowing ball -- that is what the app's
  // own light source looks like -- so one hung on the centre line reads as a bright artifact
  // floating next to the hero model rather than as lighting.
  items.push(orb(-17, 33, 8, ORB_WHITE));
  items.push(orb(19, -28, 9, ORB_BLUE));

  return { theme: 'constellations', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Telescope Observatory
// ---------------------------------------------------------------------------

// A working observatory at dusk, modelled from photographs: a ribbed silver dome on a
// corrugated drum with its shutter open, and a 36-inch reflector standing under the slit.
//
// THE DOME AND THE TELESCOPE SHARE A ROTATION RATE, and that is the world's one big idea.
// They are separate objects with separate programs, both `forever { rotate 0.05 }`, so they
// turn together and the open slit stays in front of the tube -- which is what a dome is FOR,
// and something no placard says nearly as well. Change one and they come apart, which is
// itself worth discovering.
//
// The drum's door and the dome's slit are both authored on the +Z face, but they are given
// DIFFERENT yaws on purpose: the door faces the arrival so a student can walk in, while the
// dome and the telescope are turned 26 degrees off it. A building whose door and shutter line
// up perfectly is a building that looks like one object.
function observatoryLayout() {
  const items = [];
  const SP = { x: 0, z: 92 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // A 30ft dome, not the 26ft the first pass had. The building was the right size for a real
  // 36-inch and the wrong size for this app: with a 13ft interior radius a student who walks in
  // is already at the telescope, with no room anywhere to stand back and see the whole
  // instrument. Two extra feet of radius is what makes it a room rather than a cupboard.
  const DOME = { x: 0, z: 26, radius: 15, wall: 12, aim: 0.45 };

  // --- The building -------------------------------------------------------
  // 66ft from the spawn. The dome's top is 25ft up, which is 17 degrees from eye height, and
  // the drum is 26ft wide -- about 23 degrees. It fills the arrival frame without needing the
  // student to look up, which for a building whose whole interest is at the top is the number
  // that matters.
  items.push(prop('observatory-drum', DOME.x, DOME.z, {
    rotY: 0, // the door faces +Z, straight back at the spawn
    options: { radius: DOME.radius, wallHeight: DOME.wall, seed: 7 },
  }));
  items.push(prop('observatory-dome', DOME.x, DOME.z, {
    y: DOME.wall, rotY: DOME.aim,
    options: { radius: DOME.radius + 0.4, shutter: 0.30, seed: 9 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.05 })])],
  }));
  items.push(prop('great-telescope', DOME.x, DOME.z, {
    rotY: DOME.aim,
    options: { aperture: 3.6, elevation: 38, latitude: 31, seed: 13 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.05 })])],
  }));
  // The gallery round the inside, with its gap over the doorway so nothing crosses the way in.
  items.push(prop('dome-catwalk', DOME.x, DOME.z, {
    rotY: 0, options: { radius: DOME.radius - 0.8, height: 8.2, gap: 0.42, seed: 17 },
  }));
  items.push(prop('control-desk', -8.5, 17.5, { rotY: facing(-8.5, 17.5, DOME.x, DOME.z), options: { width: 7.6, seed: 23 } }));

  // --- The rest of the site -----------------------------------------------
  items.push(prop('observatory-wing', 30, 34, { rotY: 0, options: { length: 34, width: 14, height: 9.5, seed: 29 } }));
  items.push(prop('student-dome', -38, 14, { rotY: face(-38, 14), options: { radius: 7, wallHeight: 7.5, seed: 31 } }));
  items.push(prop('radio-dish', 48, -20, {
    rotY: face(48, -20),
    options: { radius: 8, seed: 59 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.09 })])],
  }));
  items.push(prop('all-sky-camera', -22, 50, { options: { height: 5.5, seed: 53 } }));
  items.push(prop('weather-mast', -30, 62, { options: { height: 12 } }));
  items.push(prop('dobsonian-telescope', 16, 66, {
    rotY: face(16, 66) + 0.6, options: { tubeLength: 5.4, elevation: 52, seed: 37 },
  }));

  // The path in. Two runs rather than one long strip, because the flagstone prop lays its
  // rows along its own Z and a single 60ft slab of it reads as a runway.
  items.push(prop('path-stones', 0, 62, { options: { length: 26, width: 6, seed: 17 } }));
  items.push(prop('path-stones', 0, 44, { options: { length: 24, width: 6, seed: 23 } }));

  // --- Vegetation ---------------------------------------------------------
  for (const [x, z, h, seed] of [[-52, 44, 14, 41], [44, 58, 12, 42], [-46, -22, 15, 43]]) {
    items.push(prop('mesquite-tree', x, z, { options: { height: h, seed } }));
  }
  for (const [x, z, r, seed] of [[-24, 34, 2.8, 44], [22, 46, 2.4, 45], [-16, 78, 2.2, 46], [34, 8, 3.0, 47]]) {
    items.push(prop('desert-shrub', x, z, { options: { radius: r, seed } }));
  }
  for (const [x, z, seed] of [[-14, 40, 48], [12, 34, 49], [26, 70, 50]]) {
    items.push(prop('dry-grass', x, z, { options: { radius: 1.8, height: 2.4, blades: 26, seed } }));
  }

  // --- The sky ------------------------------------------------------------
  // Orion is hung where the telescope is actually POINTING -- 0.45 radians east of north at
  // 38 degrees up, which is behind the student. The control screen inside says the target is
  // M42, the nebula in Orion's sword, so a student who reads the screen and then walks out and
  // turns round is looking at the thing the dome is looking at. That agreement is the reason
  // these numbers are written as one set rather than picked twice.
  items.push(prop('sky-constellation', 65, 227, {
    y: 122, absoluteY: true, rotY: facing(65, 227, SP.x, SP.z),
    options: { figure: 'orion', span: 90, tilt: 0.663, roll: -0.2, seed: 26 },
  }));
  items.push(prop('sky-star', -52, 214, {
    y: 96, absoluteY: true, rotY: facing(-52, 214, SP.x, SP.z),
    options: { magnitude: 1.98, spectral: 'F', size: 3.0, label: 'POLARIS', sub: 'the dome’s own north', tilt: 0.60 },
  }));
  // Faint, not the full band: at dusk the sky is still bright enough that the Milky Way is
  // only just beginning to show, and a blazing galaxy over a lit horizon is the one thing that
  // would give the time of day away as invented.
  items.push(prop('milky-way', 0, 30, {
    y: 172, absoluteY: true, rotY: Math.PI / 2,
    options: { length: 440, width: 108, tilt: 0.85, opacity: 0.3, seed: 82 },
  }));
  // A waxing gibbous Moon, ahead and to the right at 33 degrees. Its painted terminator puts
  // the dark limb on its right, so the lit side faces the sunset away to the left -- which is
  // where this theme's sun is, and the only arrangement that is not quietly wrong.
  items.push(prop('moon-in-sky', 95, -55, {
    y: 118, absoluteY: true, options: { radius: 14, seed: 92 },
  }));

  // --- Words --------------------------------------------------------------
  // BEHIND the spawn, at the gate a visitor came in through -- not in front of them. At its
  // first position, 18ft ahead and 47 degrees off the sightline, a 9ft sign was both clipped by
  // the frame edge AND sitting on top of the welcome board behind it. Anything within about
  // 20ft of the spawn and past 40 degrees off-axis cannot fit on screen.
  items.push(prop('standing-sign', 14, 100, {
    rotY: face(14, 100),
    options: {
      lines: ['PRAIRIE RIDGE OBSERVATORY'],
      subtitle: 'EAST DOME OPEN · PLEASE KEEP LIGHTS RED',
      width: 9,
      height: 2.6,
      postHeight: 6.2,
      face: '#1d2b3a',
    },
  }));
  items.push(prop('welcome-board', -19, 60, {
    rotY: face(-19, 60),
    options: {
      eyebrow: '🔭  TELESCOPE OBSERVATORY',
      lead: 'The shutter is open and the telescope is tracking.',
      lines: ['Walk in through the door.', 'The dome turns. Watch it.'],
      footnote: 'The dome and the telescope run the same program — that is the whole trick',
    },
  }));
  items.push(...browserStation(20, 70, { faceX: SP.x, faceZ: SP.z }));

  items.push(prop('info-placard', -12, 46, {
    rotY: face(-12, 46),
    options: {
      title: 'Why a dome turns',
      body: 'A dome is not a roof, it is a shield with one gap in it. The telescope has to see out, but the wind must not get in — moving air shakes a 36-inch mirror enough to smear every star into a blur. So the dome carries a single slit, rides on wheels round a circular track, and follows the telescope all night. Everything else stays shut. Watch this one: it is turning at the same rate as the telescope inside it, which is why the slit stays in front of the tube instead of drifting off it.',
    },
  }));
  items.push(prop('info-placard', 12, 46, {
    rotY: face(12, 46),
    options: {
      title: 'Nobody looks through it',
      body: 'There is no eyepiece on this telescope and no chair at the top of it. The light goes to a camera cooled to well below freezing, and the astronomer sits at the desk inside reading numbers off a screen — often in another building, sometimes in another country. That is not laziness: a camera can stare at one faint galaxy for an hour and add up every photon, and an eye cannot add anything up at all. The eye is still the better instrument for one job, which is enjoying it.',
    },
  }));
  items.push(prop('info-placard', -9, 12, {
    rotY: facing(-9, 12, 0, 40),
    options: {
      title: 'How much more it sees than you do',
      body: 'A dark-adapted pupil is about 7 millimetres across. This mirror is 36 inches — 914 millimetres — and light-gathering goes with AREA, so it collects roughly seventeen thousand times as much light as one eye. That is the difference between seeing four thousand stars and seeing a hundred million. The mirror is glass with a coating of aluminium a few hundred atoms thick, and it is a shallow bowl, not a lens: big lenses sag under their own weight, which is why every large telescope built in the last century has been a mirror.',
    },
  }));
  items.push(prop('info-placard', 36, 20, {
    rotY: face(36, 20),
    options: {
      title: 'Why observatories live on dry hills',
      body: 'Air is the enemy. Every warm patch of it between the mirror and the star bends the light a little differently, and the result is a star that boils instead of sitting still — which is all twinkling actually is. So sites are chosen high, dry and far from cities: less air overhead, less water vapour in it, no streetlights. The vents round the bottom of this dome are opened hours before dark so the whole building cools to the outside temperature. A dome even a couple of degrees warm than the night air ruins its own view.',
    },
  }));

  // --- Two programming challenges -----------------------------------------
  items.push(activity(-24, 22, {
    number: 1,
    title: 'Turn the dome',
    target: 'the silver dome overhead',
    rotY: face(-24, 22),
    accent: '#6f9bd1',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 0.05 degrees', 1),
    ],
    tip: 'It is ALREADY running, and so is the telescope, on exactly the same number. Click the dome, choose Program, and change 0.05 to 3 — then watch the slit run away from the telescope and leave it staring at the inside of the roof. Now you know why the two are wired together.',
  }));

  items.push(activity(24, 56, {
    number: 2,
    title: 'Sweep the sky with the little telescope',
    target: 'the wooden Dobsonian by the path',
    rotY: face(24, 56),
    accent: '#d9b45f',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 12 degrees', 1),
      ctrlStep('wait 1 seconds', 1),
    ],
    tip: 'Thirty steps of 12 degrees is a full circle, so it comes back to where it started. Real observers do exactly this — sweep, stop, look, sweep — because a telescope only sees a patch of sky the width of your little fingernail.',
  }));

  // --- Furniture and light ------------------------------------------------
  for (const [x, z] of [[-30, 40], [26, 62]]) {
    items.push(prop('bench', x, z, { rotY: face(x, z), options: { length: 5, woodColor: 0x6b5a3f } }));
  }
  items.push(prop('red-lamp', 14, 44, { options: { height: 9, seed: 123 } }));

  // ALL THREE ORBS ARE INSIDE THE DOME, and there is none out on the site at all. The shutter
  // lets some sky in and the shell casts no shadow, but a 30-degree slit at dusk is nowhere near
  // enough to read a room by -- and the interior is the whole reason this building has a door,
  // so it gets the entire lighting budget. Outdoors there is a hooded red lamp and that is
  // deliberate: an observatory site at night IS dark, and every real one keeps it that way.
  //
  // They hang at 10-11ft, not up at the dome's springing: ORB_LIGHT_DISTANCE with decay 2 is
  // nearly spent by 12ft, so a light at the top of a dome leaves the floor at the edge of its
  // own cone and the telescope in silhouette.
  items.push(orb(10, 21, 10, ORB_WARM));
  items.push(orb(-10, 31, 10, ORB_WHITE));
  items.push(orb(0, 38, 11, ORB_WARM));

  return { theme: 'observatory', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Registry + materialization
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Seattle Center
// ---------------------------------------------------------------------------

// The campus the 1962 World's Fair left behind. Three hero models -- the Space Needle, the
// International Fountain and the Monorail -- plus the Pacific Science Center, which is where
// the three coding challenges live.
//
// THE COMPOSITION IS ONE SIGHTLINE and everything hangs off it. A student spawns at the south
// end looking north up the campus axis: the fountain sits dead ahead at 118ft, the Needle
// rises 10 degrees to the left of it at 213ft, and the two together are the photograph
// everybody has seen. Nothing tall is allowed inside that cone. The Pacific Science Center
// goes out to the west and MoPOP and the monorail to the east, so the student turns to find
// them rather than walking round them.
//
// The one number that governs the world: a 70-degree fov is VERTICAL, so a 16:9 screen sees
// about 51 degrees either side. The Needle at 10 degrees is comfortably central; the welcome
// board at 37 is clear of it; nothing else is allowed between 0 and 25.
function seattleLayout() {
  const items = [];
  const SP = { x: 0, z: 140 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- The three hero models ---------------------------------------------

  // 605ft in life, 151 here. At 213ft from the spawn it stands 35 degrees up, which fills the
  // arrival frame vertically without the student having to look up to find the top of it.
  items.push(prop('space-needle', -38, -72, { options: { seed: 62 } }));

  // The fountain is the world's middle, in both senses: it is the centre of the real campus
  // and it is the object the arrival sightline lands on. Its berm is 36ft, so it reads 35
  // degrees wide from the spawn -- big enough to be the destination, low enough that the
  // Needle clears it completely.
  items.push(prop('international-fountain', 0, 20, { options: { seed: 62 } }));

  // The guideway is placed at the ORIGIN with an unrotated path, so the control points below
  // are world coordinates and can be read straight off this map. A curving beam is worth the
  // trouble: the real line is all reverse curves and a straight one reads as a bridge.
  items.push(prop('monorail-guideway', 0, 0, {
    options: {
      seed: 62,
      height: 24,
      path: [[118, 24, -74], [106, 24, -26], [86, 24, 22], [70, 24, 70], [70, 24, 124]],
    },
  }));
  // On the beam, not on the ground: absoluteY at the deck height, and yawed to the path's own
  // tangent there. It arrives already running -- the carousel-and-twister mechanism -- so the
  // first thing a student sees moving in this world is a program, which no amount of signage
  // says as well. `move forward` follows the object's own +Z, and every prop in this project
  // is authored facing +Z, so the yaw below is also the direction of travel.
  items.push(prop('monorail-train', 86, 22, {
    y: 24, absoluteY: true, rotY: -0.36,
    options: { seed: 62, colour: 0xb4302c, cars: 2 },
    program: [block('forever', {}, [
      block('repeat', { count: 30 }, [block('moveForward', { feet: 1.6 })]),
      block('wait', { seconds: 1.5 }),
      block('goHome', {}),
      block('wait', { seconds: 2 }),
    ])],
  }));
  items.push(prop('monorail-station', 112, -58, {
    rotY: -0.245, options: { seed: 62, length: 46, height: 31 },
  }));

  // --- Pacific Science Center --------------------------------------------

  // Yamasaki's five arches, at 1/2.4. The row runs north-south (rotY = PI/2) so a student
  // walking west from the fountain meets them side-on, which is the view they are built for --
  // seen end-on they overlap into one white smear.
  items.push(prop('science-arches', -74, 30, {
    rotY: Math.PI / 2, options: { seed: 21, count: 5, height: 46, spacing: 15 },
  }));
  items.push(prop('science-pavilion', -98, 66, {
    rotY: 0.85, options: { seed: 23, width: 54, depth: 26, height: 15 },
  }));
  items.push(prop('info-placard', -58, 44, {
    rotY: face(-58, 44),
    options: {
      eyebrow: 'Pacific Science Center',
      title: 'Five arches, 110 feet tall',
      body: 'Minoru Yamasaki designed the US Science Pavilion for the 1962 World’s Fair. The arches are precast concrete lace — mostly sky. Built here at about two-fifths of full size.',
    },
  }));

  // The three challenge exhibits, in the courtyard behind the arches. Each one is the TARGET
  // of the board standing in front of it, and each teaches a different family of blocks.
  items.push(prop('science-orrery', -58, 72, { options: { seed: 31 } }));
  items.push(prop('science-rover', -76, 84, { rotY: 0.4, options: { seed: 33 } }));
  items.push(prop('science-rocket', -44, 88, { options: { seed: 35 } }));

  items.push(activity(-58, 84, {
    number: 1,
    title: 'Make the planets orbit',
    target: 'the orrery',
    accent: '#f2a541',
    rotY: face(-58, 84),
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 2 degrees', 1),
    ],
    tip: 'A forever loop yields once itself and once for the block inside it, so this turns about 1 degree a frame, not 2. Change the number and watch the planets speed up.',
  }));
  items.push(activity(-78, 96, {
    number: 2,
    title: 'Drive the rover in a square',
    target: 'the Mars rover',
    accent: '#3fb37f',
    rotY: face(-78, 96),
    steps: [
      ctrlStep('repeat 4 times'),
      moveStep('move forward 10 feet', 1),
      moveStep('rotate 90 degrees', 1),
    ],
    tip: '360 divided by 4 sides is 90. Try 3 sides and 120 degrees, or 6 and 60 — the rover comes back to exactly where it started every time.',
  }));
  items.push(activity(-42, 100, {
    number: 3,
    title: 'Launch the rocket',
    target: 'the sounding rocket',
    accent: '#3d8bf2',
    rotY: face(-42, 100),
    steps: [
      ctrlStep('repeat 20 times'),
      moveStep('move up by 2 feet', 1),
      ctrlStep('wait 1 seconds'),
      moveStep('go back to start'),
    ],
    tip: 'move up by is the one motion block that ignores which way a thing is facing — up is up. go back to start puts the rocket back on its stand.',
  }));

  // --- MoPOP, Chihuly and the Armory --------------------------------------

  items.push(prop('pop-museum', 62, -30, { rotY: -0.5, options: { seed: 41, scale: 1 } }));
  items.push(prop('chihuly-tower', 16, -50, { options: { seed: 43, height: 34, family: 'sun' } }));
  items.push(prop('chihuly-glasshouse', 42, -64, {
    rotY: -0.35, options: { seed: 45, length: 46, width: 26, height: 20 },
  }));
  items.push(prop('armory-hall', 80, 66, {
    rotY: -1.05, options: { seed: 47, length: 58, depth: 28, height: 19 },
  }));

  // --- Paving --------------------------------------------------------------
  // Two aprons: the one the student arrives on and the one between the fountain and the
  // Needle. A campus that is all lawn reads as a park, and this is a plaza.
  items.push(prop('plaza-paving', 0, 92, { options: { seed: 51, width: 74, depth: 44, tone: 0 } }));
  items.push(prop('plaza-paving', -8, -26, { options: { seed: 53, width: 96, depth: 42, tone: 1 } }));

  // --- Ornament ------------------------------------------------------------
  // Sonic Bloom: five 33ft steel flowers by Dan Corson, and the best answer this campus has to
  // "make it colourful" because that is literally what they are for.
  items.push(prop('sonic-bloom', -22, 100, { options: { seed: 55, count: 3, height: 22 } }));
  items.push(prop('sonic-bloom', 30, 44, { options: { seed: 57, count: 2, height: 19 } }));

  // --- Planting ------------------------------------------------------------
  // Douglas fir at the edges, because a 46ft conifer anywhere near the middle would compete
  // with the things this world is about; flowering colour close in, where it is walked past.
  items.push(prop('douglas-fir', -118, -6, { options: { seed: 61, height: 48, radius: 12 } }));
  items.push(prop('douglas-fir', -108, -54, { options: { seed: 63, height: 44, radius: 11 } }));
  items.push(prop('douglas-fir', 104, -78, { options: { seed: 65, height: 46, radius: 11.5 } }));
  items.push(prop('douglas-fir', -46, 122, { options: { seed: 67, height: 42, radius: 10.5 } }));
  // THE CHERRIES ARE OFF THE ARRIVAL SIGHTLINE, and this cost a rebuild to learn again. At
  // (-18, 112) one of them stood 28ft from the spawn with a 34ft crown: it subtended more
  // than 60 degrees and hid the Space Needle, the fountain and the welcome board between
  // them. A tree beats a landmark on ANGLE, not on size -- the same arithmetic that governs
  // where a sign goes -- so they are pushed out to the flanks where they frame the walk in
  // rather than block it.
  items.push(prop('flowering-cherry', -58, 118, { options: { seed: 71, height: 22, spread: 15 } }));
  items.push(prop('flowering-cherry', 56, 112, { options: { seed: 73, height: 20, spread: 14 } }));
  items.push(prop('japanese-maple', 46, 84, { options: { seed: 75, height: 15, spread: 11 } }));
  items.push(prop('japanese-maple', -44, 52, { options: { seed: 77, height: 14, spread: 10 } }));
  items.push(prop('rhododendron-bed', -26, 78, { options: { seed: 81, radius: 8, bushes: 5 } }));
  items.push(prop('rhododendron-bed', 24, 78, { options: { seed: 83, radius: 7.5, bushes: 5 } }));
  items.push(prop('rhododendron-bed', -50, 4, { options: { seed: 85, radius: 8.5, bushes: 6 } }));
  items.push(prop('rhododendron-bed', 46, 2, { options: { seed: 87, radius: 8, bushes: 5 } }));

  // --- Furniture and signage ----------------------------------------------
  items.push(prop('bench', -14, 62, { rotY: 0 }));
  items.push(prop('bench', 14, 62, { rotY: 0 }));
  items.push(prop('bench', -66, 58, { rotY: 1.4 }));
  items.push(prop('lamp-post', -30, 92, { options: { lit: false } }));
  items.push(prop('lamp-post', 30, 92, { options: { lit: false } }));

  // The welcome board sits 37 degrees off the arrival sightline at 50ft, which puts it fully
  // in frame and completely clear of the Needle at 10 degrees. Pushed BACK rather than made
  // smaller: a near sign competes with a far landmark on angle, not on size.
  items.push(prop('welcome-board', -30, 100, {
    rotY: face(-30, 100),
    options: {
      // welcomeBoard takes eyebrow/lead/lines/footnote, NOT title. An unknown option is
      // silently swallowed by a destructured default, so the heading never appeared and the
      // board rendered as three unlabelled sentences with a blank space above them.
      eyebrow: 'WELCOME TO',
      lead: 'SEATTLE CENTER',
      lines: [
        'The 74 acres left behind by the 1962 World’s Fair.',
        'Walk to the fountain, then on to the Space Needle.',
      ],
      footnote: 'Three coding challenges are at the Pacific Science Center, to the west.',
    },
  }));

  // The placards. Each states the REAL dimension, because everything here is built small and
  // a reduction that is not declared is just a wrong number.
  items.push(prop('info-placard', -22, -34, {
    rotY: face(-22, -34),
    options: {
      eyebrow: 'The Space Needle',
      title: '605 feet, built in 400 days',
      body: 'Raised for the 1962 fair and painted in four named colours: Astronaut White, Orbital Olive, Re-entry Red and Galaxy Gold. The roof went back to Galaxy Gold in 2012. Built here at one quarter size.',
    },
  }));
  items.push(prop('info-placard', 0, 62, {
    rotY: face(0, 62),
    options: {
      eyebrow: 'International Fountain',
      title: 'A 220-foot bowl and 274 nozzles',
      body: 'The silver dome throws water up to 120 feet, choreographed to music. Rebuilt in 1995 to let people walk right down into the basin. Built here at one third size.',
    },
  }));
  items.push(prop('info-placard', 58, 30, {
    rotY: face(58, 30),
    options: {
      eyebrow: 'The Monorail',
      title: 'Still running the 1962 trains',
      body: 'Alweg built two trains for the fair to carry people the mile to downtown in two minutes. They have run ever since — the oldest full-scale monorail still in daily service anywhere.',
    },
  }));
  items.push(prop('info-placard', 40, -14, {
    rotY: face(40, -14),
    options: {
      eyebrow: 'Glass and pop culture',
      title: 'Chihuly, and Gehry’s metal',
      body: 'Dale Chihuly blows glass in colours paint cannot reach. Next door, Frank Gehry clad MoPOP in 21,000 shingles of gold, silver, purple, red and blue — and ran the monorail straight through it.',
    },
  }));
  items.push(prop('standing-sign', -46, 108, {
    rotY: face(-46, 108),
    options: {
      // standingSign takes `lines`, not `title` -- with the wrong key it fell back to its own
      // placeholder and the wayfinder out on the lawn read, in large letters, SIGN.
      lines: ['PACIFIC SCIENCE CENTER'],
      subtitle: 'Three coding challenges — head west past the arches',
    },
  }));

  // The video, at the spawn. 12.8ft ahead and 39 degrees to the right: in frame on any screen,
  // and on the opposite side from both the welcome board and the Needle.
  items.push(...browserStation(8, 130, {
    faceX: SP.x, faceZ: SP.z, url: youtubeEmbedUrl('https://www.youtube.com/watch?v=OMzEjtHOSnw'),
  }));

  return { theme: 'seattle', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Robot Challenge World
// ---------------------------------------------------------------------------

// Five programmable robots on painted test pads down an avenue, with the workshop that
// services them planted round the edges. It is the second world laid out as a WORKSHOP
// rather than as a place to look at -- A Bug's Life was the first -- and everything about
// the plan follows from that.
//
// THE MIDDLE STRIP IS EMPTY, |x| < 13 from the spawn all the way to the far end, and that
// is the design rather than an oversight. A fresh construction piece lands
// PRIMITIVE_SPAWN_DISTANCE (10ft) ahead of the student and spirals out from there, so
// anything in the middle is something to build round. Every pad, board, bench and tree is
// pushed to the flanks; the only things on the centre line are the entrance arch, which is
// walked under, and the fifth robot at the very far end, which is the destination.
//
// THE FIVE BAYS GET DEEPER AS THEY GET HARDER. Bay 1 is 52ft from the spawn and bay 5 is
// 134ft, so walking further into the world IS the difficulty curve, and a student who has
// only managed the first two has still walked past the reason to come back.
//
// The arrival frame was cleared twice, which is the check this project keeps having to
// re-run. A 70-degree fov is VERTICAL, so a 16:9 screen sees about 51 degrees either side,
// and a near object hides everything inside its own angular width. All five bays sit within
// 27 degrees of the sightline; the browser station (38.7 degrees left, spanning 30 to 48)
// and the welcome board (40.1 degrees right, spanning 29 to 52) are both outside that band,
// which took moving bay 1 fourteen feet deeper -- at its first position it sat at 30.6
// degrees, squarely behind the kiosk.
function robotLayout() {
  const items = [];
  const SP = { x: 0, z: 66 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // The five machines, their pads and their challenges. ONE TABLE, because the robot's
  // colour, the accent painted on its pad, the colour of its board's header and the name on
  // its plate all have to agree -- from the middle of the avenue the only thing a student
  // can resolve is which coloured square is which, so a board that says "the lime robot"
  // has to be looking at a lime robot standing on a lime-marked pad.
  const BAYS = [
    {
      skin: 'cyan', name: 'Blip', accent: '#22b3cc', x: -26, z: 14, mark: 'line', start: [0, -4.5],
      board: [-13, 22],
      title: 'Send Blip down the lane and back',
      target: 'the blue robot on pad 1',
      steps: [
        moveStep('move forward 9 feet'),
        ctrlStep('wait 1 seconds'),
        moveStep('go back to start'),
      ],
      tip: 'No loop at all — these three run once, top to bottom, and then stop. `go back to start` always means the exact spot the robot was standing in when you pressed play, however far it has wandered since.',
    },
    {
      skin: 'coral', name: 'Spark', accent: '#e0453c', x: 27, z: -6, mark: 'spin', start: [0, 0],
      board: [14, 2],
      title: 'Spin Spark on the spot',
      target: 'the red robot on pad 2',
      steps: [
        ctrlStep('forever'),
        moveStep('rotate 4 degrees', 1),
      ],
      tip: 'The number is degrees per turn of the loop, not per second. Try 1, then try 20, then try -4 — and count the four painted ticks to see how far a quarter turn really is.',
    },
    {
      skin: 'lime', name: 'Turbo', accent: '#74c043', x: -28, z: -27, mark: 'square', start: [-4, -4],
      board: [-14, -19],
      title: 'Drive Turbo round the painted square',
      target: 'the green robot on pad 3',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 4 times', 1),
        moveStep('move forward 8 feet', 2),
        moveStep('rotate 90 degrees', 2),
      ],
      tip: '360 divided by 4 is 90, which is the whole reason Turbo lands back on the corner it started from. Try repeat 3 with rotate 120, or repeat 6 with rotate 60 — the paint on the pad is there to check yourself against.',
    },
    {
      skin: 'amber', name: 'Hopper', accent: '#f2971f', x: 28, z: -47, mark: 'course', start: [-4.4, -4.4],
      board: [15, -39],
      title: 'Patrol the course, and hop at every corner',
      target: 'the orange robot on pad 4',
      steps: [
        ctrlStep('forever'),
        moveStep('move forward 8.8 feet', 1),
        moveStep('move up by 3 feet', 1),
        ctrlStep('wait 0.4 seconds', 1),
        moveStep('move up by -3 feet', 1),
        moveStep('rotate 90 degrees', 1),
      ],
      tip: '`move up by` is the ONE movement block that ignores which way a robot is facing — up is up whichever way it is pointing. Make the two numbers different and Hopper climbs away into the sky, which is worth doing once.',
    },
    {
      skin: 'violet', name: 'Echo', accent: '#8352d9', x: 0, z: -68, mark: 'signal', start: [0, 0],
      board: [-14, -60],
      title: 'Make Echo wait for a signal from Hopper',
      target: 'the purple robot at the end of the avenue',
      steps: [
        ctrlStep('on Echo:  when an object says  go'),
        ctrlStep('repeat 4 times', 1),
        moveStep('move forward 7 feet', 2),
        moveStep('rotate 90 degrees', 2),
        lookStep('on Hopper:  say  go'),
      ],
      tip: 'The hardest one, and the only one that needs TWO robots. `when an object says` is a hat — it does NOT run when you press play, it runs when any object anywhere in the world says that exact word. Build Echo first, then give Hopper a `say go` block and press play on Hopper.',
    },
  ];

  BAYS.forEach((bay, i) => {
    const rotY = face(bay.x, bay.z);
    // The pad takes the robot's own yaw, so the lane, the square and the course are painted
    // in the frame the robot actually drives in. Turned independently, a program that closes
    // its square perfectly would still miss every painted corner.
    items.push(prop('robot-pad', bay.x, bay.z, {
      rotY,
      options: {
        seed: 300 + i, size: 17, accent: bay.accent, mark: bay.mark,
        number: i + 1, name: bay.name, start: bay.start,
      },
    }));
    // The robot stands where its own program starts, which for the three closed-path
    // challenges is a CORNER of the painted path rather than the middle of the pad. Standing
    // at the centre, a correct program traces a square of exactly the right size five feet
    // from the paint, and a student comparing the two concludes their program is wrong.
    // `rotY` turns the pad-local offset into world feet: an Object3D at yaw t maps local
    // (lx, lz) to (lx cos t + lz sin t, -lx sin t + lz cos t).
    const [lx, lz] = bay.start;
    const rx = bay.x + lx * Math.cos(rotY) + lz * Math.sin(rotY);
    const rz = bay.z - lx * Math.sin(rotY) + lz * Math.cos(rotY);
    // y = 0.19 is the pad's finished surface. The robot's lobes are tangent to its own
    // origin plane, so seated on the terrain instead it stands two inches inside the paving.
    items.push(prop('robot', rx, rz, {
      y: 0.19, rotY, options: { seed: 400 + i, skin: bay.skin, height: 6.4 },
    }));
    items.push(activity(bay.board[0], bay.board[1], {
      number: i + 1,
      title: bay.title,
      target: bay.target,
      steps: bay.steps,
      tip: bay.tip,
      accent: bay.accent,
      // Boards face back UP the avenue rather than at the spawn: a student reads them while
      // walking in, and past bay 2 the spawn is far enough behind that a board aimed at it
      // shows its edge to everybody actually standing in front of it.
      rotY: facing(bay.board[0], bay.board[1], 0, bay.board[1] + 18),
    }));
  });

  // --- the entrance -------------------------------------------------------
  // The arch is 24ft ahead, not 16. At 16 a 15ft crown stands 43 degrees up against a 35
  // degree half-fov and the thing a student is meant to walk THROUGH filled the entire
  // frame, hiding the avenue it exists to announce.
  // SPAN 20, NOT 24. At 24 the legs stand at 26.6 degrees off the sightline, which is exactly
  // where bay 1's robot is -- so the first machine a student is sent to look for was hidden
  // behind a leg of the gate telling them to go and look for it. Narrowing the arch is the
  // move rather than shifting the bay, because the only other place bay 1 can go is inside
  // the browser kiosk's own 30-to-48 degree shadow.
  items.push(prop('signal-arch', 0, 42, { options: { seed: 81, span: 20, height: 13, bands: 6 } }));
  // 34ft out rather than 25: a 10ft board at 25ft is 11 degrees of half-width sitting at 40
  // degrees off the sightline, which runs off the edge of a 16:9 frame. Pushed back it keeps
  // the same bearing at 8 degrees of half-width and comes fully inside.
  items.push(prop('welcome-board', 25, 33, {
    rotY: face(25, 33),
    options: {
      eyebrow: '🤖  ROBOT CHALLENGE FIELD',
      lead: 'Five robots. Five programs. Each one harder than the last.',
      lines: ['Walk down the avenue — bay 1 is nearest.', 'Click a robot, choose Program, build the blocks.'],
      footnote: 'The paint on each pad shows the path its program should trace',
    },
  }));
  items.push(...browserStation(-8, 56, { faceX: SP.x, faceZ: SP.z }));

  // Every world states the real size of anything it has enlarged. A classroom robot of this
  // shape is about six inches tall, so these are roughly twelvefold.
  items.push(prop('info-placard', -15, 12, {
    rotY: facing(-15, 12, 0, 26),
    options: {
      eyebrow: 'SCALE',
      title: 'Twelve times life size',
      body: 'A real classroom coding robot of this shape stands about 6 inches tall and weighs under a pound. These five are 6ft 5in — built big so you can walk round one and see what it is made of.',
      accent: '#3d8bf2',
    },
  }));

  // --- the two kinetic ornaments, both already running ---------------------
  //
  // The first thing anybody sees in this world is a program running, which no amount of
  // signage says as well. Both are ordinary props carrying an ordinary `program`, so a
  // student can click either one, read it, and change the number.
  //
  // 0.6 degrees is 0.3 A FRAME, not 0.6: `forever` yields once per pass ON TOP of the yield
  // from the block inside it, so one turn of the loop costs two frames. Measure it, never
  // compute it.
  items.push(prop('gear-pylon', -20, 38, {
    options: { seed: 31, height: 13, gears: 3 },
    program: [block('forever', {}, [block('rotate', { degrees: 0.6 })])],
  }));
  items.push(prop('ball-run', 22, 22, {
    options: { seed: 71, height: 11, turns: 2.2, radius: 3.0 },
    program: [block('forever', {}, [block('rotate', { degrees: -0.9 })])],
  }));

  // --- the workshop -------------------------------------------------------
  items.push(prop('tool-bench', -40, 4, { rotY: 0.35, options: { seed: 61, length: 8, depth: 3.2 } }));
  items.push(prop('parts-crate', -35, 9, { rotY: -0.4, options: { seed: 21, size: 3.6 } }));
  items.push(prop('parts-crate', -44, -1, { rotY: 0.8, options: { seed: 22, size: 3.2 } }));
  // THE DOCKS FACE THE AVENUE, not the robot they serve. A dock's back shield is a smooth
  // grey partial lathe with nothing on it, and aimed at its own robot every one of them
  // presented that blank side to the only place a student ever stands -- MarsProps' relay
  // dish and the space station's antenna, for the third time. A real robot reverses into a
  // dock anyway, so facing out is not even a fiction.
  items.push(prop('charge-dock', -38, 18, { rotY: facing(-38, 18, -20, 30), options: { seed: 11, accent: '#22b3cc' } }));
  items.push(prop('charge-dock', 39, -13, { rotY: facing(39, -13, 20, 4), options: { seed: 12, accent: '#e0453c' } }));
  items.push(prop('charge-dock', 16, -70, { rotY: facing(16, -70, 6, -54), options: { seed: 13, accent: '#8352d9' } }));

  items.push(prop('beacon-post', -15, 33, { options: { seed: 41, height: 9, colour: 0xf2a541 } }));
  items.push(prop('beacon-post', 15, 33, { options: { seed: 42, height: 9, colour: 0x3fb37f } }));
  items.push(prop('cone-marker', -16, 6, { options: { seed: 51, height: 2.4 } }));
  items.push(prop('cone-marker', 17, -14, { options: { seed: 52, height: 2.4 } }));

  // --- planting ------------------------------------------------------------
  //
  // Pacific Northwest stock reused from Seattle Center rather than rebuilt: the maple, the
  // cherry and the rhododendron bed are already the most vividly coloured plants in the app
  // and they are already verified. Reuse across worlds is the house pattern -- moonCrater
  // serves Mars, dustDevil serves Dinosaur Island.
  //
  // EVERY TREE IS OUTSIDE |x| = 34, and that is the arrival-frame rule again rather than a
  // planting preference: a tree beats a landmark on ANGLE, not on size, and two cherries at
  // 28ft with 34ft crowns hid all three hero models in Seattle Center.
  for (const [x, z, h, seed] of [[-54, 42, 46, 91], [55, 34, 43, 92], [-34, -82, 49, 93]]) {
    items.push(prop('douglas-fir', x, z, { options: { seed, height: h, radius: 11 } }));
  }
  items.push(prop('flowering-cherry', -52, 54, { options: { seed: 94, height: 22, spread: 15 } }));
  items.push(prop('flowering-cherry', 52, 56, { options: { seed: 95, height: 20, spread: 14 } }));
  items.push(prop('japanese-maple', 32, -80, { options: { seed: 96, height: 16, spread: 12 } }));

  for (const [x, z, r, seed] of [[-26, 56, 6.5, 97], [40, 17, 6.0, 98], [-36, -48, 6.5, 99]]) {
    items.push(prop('rhododendron-bed', x, z, { options: { seed, radius: r, bushes: 7 } }));
  }
  items.push(prop('flower-bed', 18, 42, { options: { seed: 101, width: 12, depth: 6 } }));
  items.push(prop('flower-bed', -18, -8, { options: { seed: 102, width: 11, depth: 6 } }));

  // NO LIGHT ORBS. This is a bright midday world with nothing roofed in it, and an orb is a
  // visible glowing ball -- outdoors in daylight it reads as an artifact hanging beside the
  // model rather than as lighting. Zero point lights is also the cheapest thing an
  // integrated GPU can be handed.
  return { theme: 'robots', spawn: { ...SP, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// Greenbush Science Center
// ---------------------------------------------------------------------------

// The Greenbush Science Center in Girard, Kansas -- the education service centre this whole
// app is built at -- modelled from a photograph of its front elevation, with the exhibit
// hall behind the door built out as a place a student can actually walk into.
//
// THE ARRIVAL IS THE PHOTOGRAPH. The spawn stands in the parking lot 92ft back with the
// whole 146ft frontage in view: the tower's left edge sits 33 degrees off the sightline and
// the far gable 41, both inside the ~51 a 16:9 screen sees, and the tall vault's ridge is
// 18 degrees up against a 35 degree half-fov. Those four numbers are the composition, and
// anything moved here has to be re-checked against them.
//
// EVERYTHING NEAR THE SPAWN IS KEPT OFF THE ENTRANCE'S BEARING. The door is 12 degrees left
// of the sightline; the browser kiosk sits 40 degrees right and the welcome board 43 degrees
// left, so between them they cover slices of the wing and of open lawn and none of the way
// in. On a facade this wide something is always behind something -- the rule that matters is
// that it is never the door.
function greenbushLayout() {
  const items = [];
  const SP = { x: 0, z: 92 };
  const face = (x, z) => facing(x, z, SP.x, SP.z);

  // --- the building -------------------------------------------------------
  items.push(prop('science-center', 0, 0, { options: { seed: 7 } }));

  // --- the site -----------------------------------------------------------
  items.push(prop('parking-lot', 10, 56, { options: { seed: 37, width: 172, depth: 66, bays: 16 } }));
  items.push(prop('plaza-paving', 4, 19, { options: { seed: 38, width: 156, depth: 12, tone: 2, bands: 9 } }));

  // The row of clipped boxwood along the tower wall, which is the most recognisable piece of
  // landscaping in the photograph, plus a pair either side of the door.
  for (let i = 0; i < 5; i++) {
    items.push(prop('clipped-shrub', -58 + i * 5.2, 4.2, { options: { seed: 41 + i, radius: 1.75 + (i % 2) * 0.2 } }));
  }
  items.push(prop('clipped-shrub', -32.5, 5.5, { options: { seed: 51, radius: 2.4, hue: 0x2f5030 } }));
  items.push(prop('clipped-shrub', -7.5, 5.5, { options: { seed: 52, radius: 2.4, hue: 0x2f5030 } }));

  items.push(prop('monument-sign', -54, 34, { rotY: face(-54, 34), options: { seed: 43, width: 11, height: 6.4 } }));
  items.push(prop('flag-pole', 52, 70, { options: { seed: 47, height: 30 } }));

  // Planting. Kansas stock and reused builders: the shade tree is the Park's, the cherry and
  // the maple are Seattle's, and the big conifer at the right end of the photograph is a
  // Douglas fir standing in for the spruce that is actually there. Reuse across worlds is
  // the house pattern -- moonCrater serves Mars, dustDevil serves Dinosaur Island.
  items.push(prop('shade-tree', -84, 34, { options: { height: 26, seed: 61 } }));
  items.push(prop('shade-tree', 100, 44, { options: { height: 23, seed: 62 } }));
  items.push(prop('douglas-fir', 102, -4, { options: { seed: 63, height: 38, radius: 9 } }));
  items.push(prop('flowering-cherry', -92, 60, { options: { seed: 64, height: 20, spread: 14 } }));
  items.push(prop('flowering-cherry', 108, 64, { options: { seed: 65, height: 19, spread: 13 } }));
  items.push(prop('japanese-maple', -74, 78, { options: { seed: 66, height: 15, spread: 11 } }));

  items.push(prop('flower-bed', -30, 12.5, { options: { seed: 71, width: 13, depth: 5.5 } }));
  items.push(prop('flower-bed', 16, 12.5, { options: { seed: 72, width: 15, depth: 5.5 } }));
  items.push(prop('flower-bed', 56, 11, { options: { seed: 73, width: 14, depth: 5.5 } }));
  items.push(prop('rhododendron-bed', -70, 22, { options: { seed: 74, radius: 6.5, bushes: 7 } }));
  items.push(prop('rhododendron-bed', 88, 22, { options: { seed: 75, radius: 6.5, bushes: 7 } }));
  items.push(prop('wildflowers', -100, 30, { options: { seed: 76, radius: 12, count: 130 } }));
  items.push(prop('wildflowers', 116, 30, { options: { seed: 77, radius: 11, count: 120 } }));

  items.push(prop('lamp-post', -40, 42, { options: { height: 17, lit: false } }));
  items.push(prop('lamp-post', 60, 42, { options: { height: 17, lit: false } }));
  items.push(prop('bench', -12, 20.5, { rotY: Math.PI, options: {} }));
  items.push(prop('bench', 30, 20.5, { rotY: Math.PI, options: {} }));
  items.push(prop('planter', -30.5, 14.5, { options: {} }));
  items.push(prop('planter', -9.5, 14.5, { options: {} }));

  // --- inside the hall ----------------------------------------------------
  //
  // The hall runs x -34..36 by z -4..-46 with a 12ft doorway, and the exhibits are laid down
  // BOTH WALLS with the middle left clear -- the same rule A Bug's Life and the Robot
  // Challenge Field are laid out to, and here it is doubled up: a fresh construction piece
  // lands 10ft ahead of the student, and an exhibit hall is also a room somebody has to be
  // able to walk across.
  const plinth = (x, z, accent, label, sub, radius = 3.2) =>
    prop('exhibit-plinth', x, z, { options: { seed: 300 + Math.round(x + z), radius, accent, label, sub } });

  // Left wall
  items.push(plinth(-28, -13, '#8a5cf5', 'Plasma Globe', 'Electricity you can see'));
  items.push(prop('plasma-globe', -28, -13, { y: 2.1, options: { seed: 11, radius: 2.4, height: 3.8 } }));
  items.push(plinth(-28, -23, '#3d8bf2', "Newton's Cradle", 'Momentum, conserved'));
  items.push(prop('newton-cradle', -28, -23, { y: 2.1, options: { seed: 31, height: 4.6 } }));
  items.push(prop('lab-bench', -28.5, -34, { rotY: Math.PI / 2, options: { seed: 19, length: 13 } }));

  // Right wall
  items.push(prop('turbine-demo', 29, -12, { options: { seed: 29, height: 13, blade: 4.6 } }));
  items.push(plinth(29, -23, '#f2a541', 'Orrery', 'The inner planets, to scale in time'));
  items.push(prop('science-orrery', 29, -23, { y: 2.1, scale: 0.6, options: { seed: 81 } }));
  items.push(prop('van-de-graaff', 29, -34, { options: { seed: 13, radius: 2.6, height: 8.5 } }));
  items.push(prop('periodic-wall', 16, -45.2, { options: { seed: 23, width: 19, height: 10.5 } }));

  // Down the middle, but off the walking spine -- the pendulum is the one thing in the room
  // tall enough to need the vault over it, so it stands under the taller of the two.
  items.push(prop('chart-table', -8, -10, { options: { seed: 82 } }));
  items.push(plinth(-12, -22, '#3fb37f', 'DNA', 'The molecule that carries the instructions'));
  items.push(prop('dna-helix', -12, -22, { y: 2.1, scale: 0.62, options: { seed: 83 } }));
  items.push(prop('cell-model', -10, -33, { scale: 0.68, options: { seed: 84 } }));
  items.push(plinth(12, -12, '#1aa79c', 'Armillary Sphere', 'How the sky was measured'));
  items.push(prop('armillary-sphere', 12, -12, { y: 2.1, scale: 0.85, options: { seed: 85 } }));
  items.push(prop('foucault-pendulum', 14, -24, { options: { seed: 17, height: 16, radius: 6 } }));
  items.push(prop('science-rocket', 14, -40, { options: { seed: 86, colour: 0xe8e5dc } }));
  items.push(prop('science-rover', 24, -16, { rotY: Math.PI, options: { seed: 87 } }));
  items.push(prop('robotic-arm', 22, -40, { scale: 0.42, options: { seed: 88 } }));

  // THE FIVE ROBOTS, along the back wall facing the door -- the robotics bay. They are the
  // Robot Challenge Field's own model reused at the same 6.4ft, which is deliberate: a
  // student who has met them there meets them again here, and Greenbush teaches robotics.
  ['cyan', 'coral', 'lime', 'amber', 'violet'].forEach((skin, i) => {
    items.push(prop('robot', -30 + i * 8, -42, { options: { seed: 500 + i, skin, height: 6.4 } }));
  });

  // Interior lighting. ORB_LIGHT_DISTANCE gives a decay-2 falloff nearly spent at ~12ft, so
  // these hang at 9ft rather than up at the vault -- at ceiling height the floor sits at the
  // very edge of the cone. Four is what a 70ft by 42ft room needs; the barrel vaults set
  // castShadow = false, so the sun does most of the work and these only lift the corners.
  items.push(orb(-24, -12, 9, ORB_WARM));
  items.push(orb(4, -12, 9, ORB_WHITE));
  items.push(orb(28, -18, 9, ORB_WARM));
  items.push(orb(-24, -34, 9, ORB_WHITE));
  items.push(orb(4, -40, 9, ORB_WARM));
  items.push(orb(28, -38, 9, ORB_WHITE));

  // --- words --------------------------------------------------------------
  items.push(prop('welcome-board', -32, 58, {
    rotY: face(-32, 58),
    options: {
      eyebrow: '⚛️  GREENBUSH SCIENCE CENTER',
      lead: 'Girard, Kansas — walk in through the front door.',
      lines: ['Fifteen exhibits and five robots inside.', 'Everything in here can be programmed.'],
      footnote: 'The doorway under the curved canopy is open — walk straight in',
    },
  }));
  items.push(prop('info-placard', -12, 14, {
    rotY: facing(-12, 14, SP.x, SP.z),
    options: {
      eyebrow: 'ABOUT THIS BUILDING',
      title: 'Two thirds of the real thing',
      body: 'The real Science Center has about 220 feet of frontage. This one has 146, because the world is only 390 feet across and you have to be able to stand back far enough to see all of it. Everything else — the twin barrel vaults, the tower, the canopy — is where it really is.',
      accent: '#1f5c4a',
    },
  }));
  items.push(...browserStation(10, 80, { faceX: SP.x, faceZ: SP.z }));

  // --- three coding challenges, all on exhibits ---------------------------
  items.push(activity(24, -8, {
    number: 1,
    title: 'Turn the wind turbine',
    target: 'the demonstration turbine by the right wall',
    rotY: facing(24, -8, -20, 20),
    accent: '#3fb37f',
    steps: [ctrlStep('forever'), moveStep('rotate 2 degrees', 1)],
    tip: 'The number is degrees per turn of the loop, not per second. A real turbine turns much slower than you expect — try 0.5, then try 20 and see which one looks right.',
  }));
  items.push(activity(22, -20, {
    number: 2,
    title: 'Set the planets going',
    target: 'the orrery on the amber plinth',
    rotY: facing(22, -20, -20, 20),
    accent: '#f2a541',
    steps: [
      ctrlStep('forever'),
      moveStep('rotate 0.6 degrees', 1),
      ctrlStep('wait 0.05 seconds', 1),
    ],
    tip: 'Take the wait out and it spins far too fast to read. Put it back and change it instead of the angle — that is the difference between how far it turns and how often.',
  }));
  items.push(activity(-6, -38, {
    number: 3,
    title: 'Drive a robot out of the bay',
    target: 'any of the five robots along the back wall',
    rotY: facing(-6, -38, -20, 0),
    accent: '#22b3cc',
    steps: [
      ctrlStep('repeat 4 times'),
      moveStep('move forward 6 feet', 1),
      moveStep('rotate 90 degrees', 1),
      moveStep('go back to start'),
    ],
    tip: '360 divided by 4 is 90, so it comes back to the corner it started from — and `go back to start` then puts it exactly where it was parked. Try repeat 3 with rotate 120.',
  }));

  return { theme: 'greenbush', spawn: { ...SP, yaw: 0 }, items };
}

export const PRESET_WORLDS = {
  park: { label: 'The Park', hint: 'The default world: a great meadow, a pond, a bandstand and the bear dens', build: parkLayout },
  museum: { label: 'The Museum', hint: 'A gallery of sculpture and painting, with a plaza out front', build: museumLayout },
  library: { label: 'The Library', hint: 'A public reading room: stacks, Dewey signs, card catalog, globe', build: libraryLayout },
  moon: { label: 'The Moon', hint: 'An Apollo landing site — lander, rover, flag and craters', build: moonLayout },
  mars: { label: 'On Mars', hint: 'A crewed outpost — walk into the Habitation Dome, then explore the base', build: marsLayout },
  dinosaur: {
    label: 'Dinosaur Island',
    hint: 'The end of the Cretaceous — a dig, a lagoon, and a T. rex at full size',
    build: dinosaurLayout,
  },
  voyage: {
    label: 'Fantastic Voyage',
    hint: 'Miniaturised inside the human body — walk around the lungs, stomach, liver and kidneys',
    build: voyageLayout,
  },
  // The KEY stays `empty` even though the label no longer says so. It is persisted --
  // world portals carry a target world name in their options, and it is what
  // buildPresetWorldRecords is called with -- so renaming it would break saved worlds to
  // no benefit. Only the label is a person-facing string.
  egypt: {
    label: 'Ancient Egypt',
    hint: 'The Giza plateau — the Great Sphinx, the three pyramids and Khufu’s buried ship',
    build: egyptLayout,
  },
  solar: {
    label: 'Solar System Walk',
    hint: 'Walk from the Sun out to Neptune — the planets sized truly against each other',
    build: solarLayout,
  },
  watercycle: {
    label: 'The Water Cycle',
    hint: 'Follow five labelled arrows round the whole loop — sea, cloud, rain, mountain, river',
    build: waterCycleLayout,
  },
  pompeii: {
    label: 'Ancient Pompeii',
    hint: 'A Roman town on an ordinary afternoon, with Vesuvius going up behind it',
    build: pompeiiLayout,
  },
  davinci: {
    label: "Da Vinci's Studio",
    hint: 'The flying machines and the cart, built full size out of the notebooks',
    build: davinciLayout,
  },
  ellis: {
    label: 'Ellis Island',
    hint: 'The harbour in 1907 — the Main Building, a steamship at the pier, Liberty across the water',
    build: ellisLayout,
  },
  capitol: {
    label: 'The U.S. Capitol',
    hint: 'The West Front from the Mall, with the dome, the chambers and the Washington Monument',
    build: capitolLayout,
  },
  reef: {
    label: 'Great Barrier Reef',
    hint: 'Twenty-five feet down — turtles, a manta ray, staghorn thickets and a bleached section',
    build: barrierLayout,
  },
  delta: {
    label: 'Delta River Boat',
    hint: 'A sternwheel packet at a Mississippi landing, about 1870',
    build: deltaLayout,
  },
  colosseum: {
    label: 'The Colosseum',
    hint: 'Rome — the amphitheatre, the Arch of Constantine and a corner of the Forum',
    build: colosseumLayout,
  },
  machupicchu: {
    label: 'Machu Picchu',
    hint: 'The Inca citadel at 7,970ft — terraces, temples and the peak behind it',
    build: machuPicchuLayout,
  },
  tajmahal: {
    label: 'The Taj Mahal',
    hint: 'Agra at first light — the tomb, its garden and the great gate',
    build: tajLayout,
  },
  redsquare: {
    label: 'Red Square',
    hint: "Moscow in winter — St Basil's, the Kremlin wall, GUM and Lenin's tomb",
    build: redSquareLayout,
  },
  bugs: {
    label: "A Bug's Life",
    hint: 'An ant colony at ant scale — five building challenges and five coding challenges',
    build: bugsLayout,
  },
  station: {
    label: 'Space Station Survival',
    hint: 'A construction deck over Mars with five building bays — modules, solar wings, a cupola',
    build: stationLayout,
  },
  whimsy: {
    label: 'Whimsical World',
    hint: 'A storybook landscape with five coding challenges — a carousel, a balloon, a wind-up toy',
    build: whimsyLayout,
  },
  cologne: {
    label: 'Cologne Cathedral',
    hint: 'The Cathedral of St Peter — twin openwork spires, a rose window, and the crane that never leaves',
    build: cologneLayout,
  },
  warren: {
    label: "A Rabbit's Den",
    hint: 'A warren cut open in a chalk bank — the nest, the bolt holes, and the rabbits themselves',
    build: warrenLayout,
  },
  london: {
    label: 'Big Ben & Westminster',
    hint: 'The Elizabeth Tower from the south bank, with the Palace, the bridge and a bus on its rounds',
    build: londonLayout,
  },
  cell: {
    label: 'Inside an Animal Cell',
    hint: 'Shrunk six million times — walk around the nucleus, a mitochondrion, the ER and the Golgi',
    build: cellLayout,
  },
  twister: {
    label: 'Inside a Twister',
    hint: 'An EF4 turning over wheat country, with the storm above it and the farm it hit',
    build: twisterLayout,
  },
  constellations: {
    label: 'The Constellations',
    hint: 'A winter observing field — eight star boards, an armillary sphere, and the real sky overhead',
    build: constellationsLayout,
  },
  observatory: {
    label: 'Telescope Observatory',
    hint: 'A hilltop dome at dusk with its shutter open — walk in and stand under a 36-inch reflector',
    build: observatoryLayout,
  },
  greenbush: {
    label: 'Greenbush Science Center',
    hint: 'The education service center in Girard, Kansas \u2014 walk in the front door to fifteen exhibits and five robots',
    build: greenbushLayout,
  },
  robots: {
    label: 'Robot Challenge World',
    hint: 'Five programmable robots on painted test pads \u2014 one challenge each, and each one harder than the last',
    build: robotLayout,
  },
  seattle: {
    label: 'Seattle Center',
    hint: 'The 1962 World\u2019s Fair campus \u2014 the Space Needle, the International Fountain and the Monorail',
    build: seattleLayout,
  },
  empty: {
    label: 'My World',
    hint: 'An open green field of your own, with three boards to get you started building',
    build: emptyLayout,
  },
  // HIDDEN from both menus (Menu.js and VRMenu.js skip any preset with this flag), and
  // deliberately so: the only way in is the billboard behind the Library, which is what
  // makes finding it worth something. It still lives in this table because everything
  // else about it is an ordinary preset -- buildPresetWorldRecords looks it up here by
  // name, and that is exactly what the portal calls.
  newyork: {
    label: "1940's New York",
    hint: 'Broadway at Times Square in the summer of 1949 — reached from the billboard behind the Library',
    build: newYorkLayout,
    hidden: true,
  },
  // Hidden for the same reason, behind its own door: the billboard behind the Park's
  // nature centre. See the notes on world portals in CLAUDE.md.
  sea: {
    label: 'Under the Sea',
    hint: 'A tropical coral reef thirty feet down — reached from the billboard behind the Park’s nature centre',
    build: seaLayout,
    hidden: true,
  },
};

// THE MENU NO LONGER LISTS WORLDS AT ALL, so the allowlist and its predicate are gone.
//
// `MENU_WORLDS` was a short list of four presets the Load World dropdown offered, and
// `isMenuWorld()` folded it together with the `hidden` flag so the DOM menu and the VR menu
// could never drift apart. Both menus now offer Get More Worlds instead: the gallery holds
// thirty-six worlds, every one of them openable by link, which is a better answer than any
// list this dropdown could have shown.
//
// `hidden: true` SURVIVES ON THE TWO PORTAL WORLDS and is now documentation rather than
// behaviour -- nothing reads it. It still records the one fact worth keeping: 1940's New York
// and Under the Sea have no door except a billboard inside another world, which is what makes
// finding them worth anything. Anything that ever lists worlds again should read it.

function toRecord(item, groundHeightAt) {
  const y = item.absoluteY ? item.y : groundHeightAt(item.x, item.z) + (item.y || 0);
  const s = item.scale || 1;
  const base = {
    id: uuid(),
    createdAt: Date.now(),
    transform: {
      position: [item.x, y, item.z],
      rotation: [item.rotX || 0, item.rotY || 0, 0],
      scale: [s, s, s],
    },
  };

  // A prop can ship WITH a program already on it, which is how the twister is turning
  // before anybody clicks anything. It is the ordinary `program` field every saved record
  // uses, so WorldStore.addAndRun() starts it on load with no new code path, PlayIcon
  // gives it a green ▶, and a student can open it, read it and change it like any other.
  //
  // Only set when there is one: `program: undefined` on every record in every world is a
  // key that gets written to IndexedDB and serialised into every exported world file.
  if (item.program?.length) base.program = item.program;

  if (item.kind === 'light-orb') return { ...base, kind: 'light-orb', color: item.color };
  // A browser panel carries no files either -- WebBrowserManager.createPanel() rebuilds
  // the whole thing from the URL, exactly as a light orb rebuilds from its colour.
  if (item.kind === 'web-browser') return { ...base, kind: 'web-browser', url: item.url };
  if (item.kind.startsWith('startup-')) {
    return { ...base, kind: item.kind, targetHeight: item.height, baseOnGround: true };
  }
  return { ...base, kind: 'preset-prop', prop: item.prop, options: item.options || {} };
}

// Builds the record list for a preset world.
//
// The theme is applied FIRST and on purpose: it reshapes the terrain, and every
// record's Y is then read off that terrain by raycasting the real ground mesh. Doing
// it the other way round would ground every object to the previous world's hills.
// The `world-theme` record leads the list so a reload rebuilds the same environment.
export function buildPresetWorldRecords(name, { groundHeightAt }) {
  const preset = PRESET_WORLDS[name];
  if (!preset) throw new Error(`Unknown preset world: "${name}"`);

  const layout = preset.build();
  applyWorldTheme(layout.theme);

  const records = [
    {
      id: uuid(),
      kind: 'world-theme',
      theme: layout.theme,
      createdAt: Date.now(),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
    // Where this world stands the player. Every layout already declares a spawn -- it is
    // what the Load World menu uses -- and this carries it INTO the records, so it
    // survives into IndexedDB, into an exported world file, and into the gallery.
    //
    // Without it a world file said nothing about where to stand, so anyone opening one
    // from a gallery link landed at the app's default spot: in these worlds, out in an
    // empty corner of a field with the thing they came to see behind them.
    //
    // The spawn rides in the record's own transform (position = where, rotation[1] =
    // facing) rather than in fields of its own -- see spawnFromRecords().
    {
      id: uuid(),
      kind: 'world-spawn',
      createdAt: Date.now(),
      transform: {
        position: [layout.spawn.x || 0, 0, layout.spawn.z || 0],
        rotation: [0, layout.spawn.yaw || 0, 0],
        scale: [1, 1, 1],
      },
    },
    ...layout.items.map((item) => toRecord(item, groundHeightAt)),
  ];

  return { records, spawn: layout.spawn, label: preset.label };
}
