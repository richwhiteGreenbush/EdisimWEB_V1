import { applyWorldTheme } from './SceneSetup.js';
import { WEB_BROWSER_DEFAULT_URL } from './config.js';

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

function prop(name, x, z, { y = 0, rotY = 0, rotX = 0, absoluteY = false, scale = 1, options = {} } = {}) {
  return { kind: 'preset-prop', prop: name, options, x, z, y, rotY, rotX, absoluteY, scale };
}

function orb(x, z, y, color = ORB_WHITE) {
  return { kind: 'light-orb', color, x, z, y };
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
        moveStep('move X by 0.3 feet', 2),
        ctrlStep('repeat 20 times', 1),
        moveStep('move X by -0.3 feet', 2),
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
        ctrlStep('repeat 12 times'),
        lookStep('change size by 8 %', 1),
        ctrlStep('wait 0.2 seconds', 1),
      ],
      tip: 'Watch closely: 8% of a big tree is more than 8% of a small one, so it speeds up as it goes. That is what growth really does. Use -7 % to shrink it back down.',
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
        moveStep('move Z by -1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 15 times', 1),
        moveStep('move Z by 1 feet', 2),
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
        moveStep('move X by 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 12 times', 1),
        moveStep('move X by -0.5 feet', 2),
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
        moveStep('move Z by -0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 20 times', 1),
        moveStep('move Z by 0.4 feet', 2),
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
        moveStep('move Y by 0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
        ctrlStep('repeat 10 times', 1),
        moveStep('move Y by -0.4 feet', 2),
        ctrlStep('wait 0.1 seconds', 2),
      ],
      tip: 'Up four feet, hover, back down. move Y is the only block that goes UP — and on Mars getting off the ground is the hard part, because there is barely any air for the blades to push against.',
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
        moveStep('move X by 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 15 times', 1),
        moveStep('move X by -1 feet', 2),
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
        moveStep('move X by 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 40 times', 1),
        moveStep('move X by -0.5 feet', 2),
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

// ---------------------------------------------------------------------------
// Fantastic Voyage -- the human body
// ---------------------------------------------------------------------------

// A walk-through anatomy exhibition, laid out as a journey rather than a grid: you
// arrive beside the micro-sub, walk INTO the body through a length of artery, pass under
// a rib cage, and come out in a hall of organs with the systems gallery at the far end.
//
// The four organs the world is built around -- lungs, stomach, liver, kidneys -- take
// the four corners of the hall, each on its own lit plinth with its own placard, and the
// heart sits at the centre of them because it is what physically connects all four.
//
// Whole SYSTEMS are taught by the chart gallery at the north end rather than by more
// geometry. A system is a set of relationships -- what drains into what, what feeds what
// -- and a labelled drawing shows that far better than a model you can only walk around.
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

  const placard = (x, z, rotY, eyebrow, title, body) => {
    items.push(prop('info-placard', x, z, { rotY, options: { eyebrow, title, body, accent: '#2f8ba0', width: 2.6 } }));
  };

  // --- Arrival: the premise ------------------------------------------------
  items.push(
    prop('standing-sign', 0, 68, {
      options: {
        lines: ['FANTASTIC VOYAGE'],
        subtitle: 'YOU HAVE BEEN MINIATURISED',
        width: 15,
        height: 3.4,
        postHeight: 8,
        face: '#12323d',
        accent: '#5fc9dd',
      },
    })
  );

  // Right at the entrance, before the artery -- this is the one world where the walk in
  // is a corridor, so the panel has to be met before the student commits to it.
  items.push(...browserStation(-9, 73, { faceX: 0, faceZ: 82 }));

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
        moveStep('move Z by -0.8 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 30 times', 1),
        moveStep('move Z by 0.8 feet', 2),
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

  // The project's own banner image, reused as the entrance sign. Held to 3ft tall: this
  // is a very wide image, so 3ft of height is about 12ft of width.
  items.push(asset('startup-billboard', -18, 60, { rotY: 0.7, height: 3 }));

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
  items.push(prop('blood-cells', 0, 50, { options: { count: 10, radius: 5, height: 9, seed: 5 } }));
  items.push(prop('blood-cells', 0, 34, { options: { count: 8, radius: 5, height: 9, seed: 19 } }));
  // Inside a tunnel the sun reaches nothing, so the light has to come from in there. Hung
  // at 5ft, not at the crown: an orb's PointLight is nearly spent by ~12ft.
  for (const z of [53, 44, 35]) items.push(orb(0, z, 5, ORB_ROSE));

  placard(
    9,
    26,
    -0.35,
    'Where you are',
    'Inside an artery',
    'Laid end to end, one person’s blood vessels would run about 60,000 miles — enough to wrap around the Earth twice. The biggest, the aorta, is about as wide as a garden hose. The smallest are narrower than one red blood cell.'
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
    'Twelve pairs of ribs, and they are not a fixed box — every rib swings up and out when you breathe in. Behind you they join the spine; in front, the top seven pairs join the breastbone through flexible cartilage.'
  );

  // --- The organ hall: the four primary organs -----------------------------
  exhibit('lungs-model', -22, -6, {
    label: 'Lungs',
    sublabel: 'RESPIRATORY SYSTEM',
    radius: 5.4,
    rotY: 0.35,
  });
  placard(
    -13,
    -0.5,
    0.65,
    'Lungs',
    'A folded-up tennis court',
    'Real lungs are about 10 inches tall. Inside are 300–500 million alveoli — tiny air sacs — and unfolded they would cover about 70 square metres, roughly a classroom floor. That is the surface oxygen crosses to reach your blood.'
  );
  placard(
    -32,
    -17,
    2.5,
    'Left and right',
    'They are not a matching pair',
    'The right lung has three lobes, the left only two — the heart takes the space where the third would be. That is also why an inhaled peanut nearly always ends up in the right lung: its bronchus is wider and steeper.'
  );
  items.push(orb(-28, 0, 8, ORB_WHITE));
  items.push(orb(-16, -13, 8, ORB_WHITE));

  items.push(prop('alveoli-cluster', -38, 5, { rotY: 0.5 }));
  placard(
    -29,
    11,
    0.5,
    'Zoom in',
    'Where the swap happens',
    'This is one alveolus and its blood vessels, blown up enormously. The wall between air and blood is about one five-hundredth of a millimetre thick — thin enough for oxygen to cross by simply drifting.'
  );
  items.push(orb(-38, 7, 7, ORB_BLUE));

  exhibit('stomach-model', 22, -6, {
    label: 'Stomach',
    sublabel: 'DIGESTIVE SYSTEM',
    radius: 4.6,
    rotY: -0.35,
  });
  placard(
    13,
    -0.5,
    -0.65,
    'Stomach',
    'A bag of acid that does not digest itself',
    'Stomach acid sits around pH 1.5–3.5 — strong enough to strip rust off steel. The reason it does not eat through you is a layer of mucus that the stomach lining replaces every few days.'
  );
  placard(
    31,
    -9,
    -2.5,
    'How much fits',
    'Empty, it is fist-sized',
    'An empty stomach holds well under a cup. Full, it stretches to about four times that. Those folds you can see inside — the rugae — are what unfold to let it. Food stays here two to four hours, then leaves a teaspoon at a time.'
  );
  items.push(orb(28, 0, 8, ORB_WARM));
  items.push(orb(16, -13, 8, ORB_WHITE));

  items.push(prop('villi-patch', 36, 5, { options: { count: 46, radius: 6, seed: 11 } }));
  placard(
    28,
    12,
    -0.5,
    'Small intestine',
    'Lined with millions of fingers',
    'Almost all of your food is actually absorbed here, not in the stomach. The lining is covered in villi like these — magnified hugely — and they turn a 22-foot tube into about 30 square metres of absorbing surface.'
  );

  exhibit('intestine-coil', 36, -18, {
    label: 'Intestines',
    sublabel: 'ABOUT 27 FEET OF TUBE',
    radius: 5.0,
    rotY: -0.7,
  });
  // Off to the side rather than overhead: directly above the plinth an orb sat down
  // inside the top loops of the colon and read as a light bulb baked into the model.
  items.push(orb(30, -22, 8, ORB_WARM));

  // The heart at the centre, because it is the thing all four primary organs are
  // plumbed into.
  exhibit('heart-model', 0, -20, {
    label: 'Heart',
    sublabel: 'THE HUB OF ALL OF IT',
    radius: 4.2,
    height: 3.5,
    accent: '#ff7a6e',
  });
  placard(
    -7,
    -14,
    0.4,
    'Heart',
    'Your own fist, beating',
    'A heart is about the size of the owner’s clenched fist. It beats around 100,000 times a day and pushes roughly 7,500 litres of blood — enough to fill a small swimming pool every week, without ever taking a break.'
  );
  placard(
    7,
    -14,
    -0.4,
    'Two pumps in one',
    'Blue side, red side',
    'The right half pumps blood to the lungs to collect oxygen; the left half pumps it to everywhere else. That is why anatomy models colour them differently — the blue side is not cold, it is just carrying blood that has not been to the lungs yet.'
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
  items.push(prop('bench', -9, -30, { rotY: 0.3 }));
  items.push(prop('bench', 9, -30, { rotY: -0.3 }));

  exhibit('liver-model', -22, -36, {
    label: 'Liver',
    sublabel: 'THE CHEMICAL PLANT',
    radius: 4.8,
    rotY: 0.4,
  });
  placard(
    -13,
    -31,
    0.8,
    'Liver',
    'Five hundred jobs at once',
    'The largest organ inside you, about 3 pounds and roughly football-sized. It cleans the blood arriving from your gut, stores energy, makes bile for digesting fat, and breaks down medicines — several hundred jobs in one lump of tissue.'
  );
  placard(
    -30,
    -43,
    2.7,
    'Unique',
    'It can grow back',
    'The liver is the only human organ that regrows. Remove up to two thirds of it and the rest will grow back to full size in a matter of weeks — which is what makes it possible for a living person to donate part of theirs.'
  );
  items.push(orb(-28, -30, 8, ORB_WARM));
  items.push(orb(-16, -43, 8, ORB_WHITE));

  exhibit('kidney-model', 22, -36, {
    label: 'Kidneys',
    sublabel: 'URINARY SYSTEM',
    radius: 4.6,
    rotY: -0.4,
  });
  placard(
    13,
    -31,
    -0.8,
    'Kidneys',
    'Filtering the whole lot, 40 times a day',
    'Each kidney is fist-sized and holds about a million microscopic filters. Together they pull around 180 litres of fluid out of your blood every day — then put about 99% of it straight back. What is left is roughly 1.5 litres of urine.'
  );
  placard(
    30,
    -43,
    -2.7,
    'Why two?',
    'You only need one',
    'The right kidney sits lower than the left, pushed down by the liver above it. You are born with two, but a single healthy kidney does the whole job — which is why a living person can donate one.'
  );
  items.push(orb(28, -30, 8, ORB_BLUE));
  items.push(orb(16, -43, 8, ORB_WHITE));

  items.push(prop('anatomy-chart', 38, -49, { rotY: -1.0, options: { chart: 'kidney-section', width: 8 } }));

  // --- The far wings: brain, nerve, DNA, cell ------------------------------
  exhibit('brain-model', -42, -24, {
    label: 'Brain',
    sublabel: 'NERVOUS SYSTEM',
    radius: 3.8,
    rotY: 1.2,
  });
  placard(
    -38,
    -13,
    1.0,
    'Brain',
    'Two per cent of you, twenty per cent of the fuel',
    'About 86 billion nerve cells, folded up so that three times as much surface fits inside your skull. It is only about 2% of your body weight but burns around 20% of the oxygen you breathe — even while you sleep.'
  );
  items.push(orb(-42, -29, 8, ORB_BLUE));

  items.push(prop('neuron-model', -58, 6, { rotY: 1.35, options: { length: 24 } }));
  placard(
    -46,
    16,
    0.9,
    'One nerve cell',
    'Signals at 270 miles an hour',
    'Signals arrive on the branching end, travel down the long fibre, and are handed to the next cell at the tips. The pale sleeves are insulation — the gaps between them let the signal leap ahead instead of crawling, up to 120 metres per second.'
  );
  items.push(orb(-56, 2, 7, ORB_WHITE));

  items.push(prop('dna-helix', 46, -30, { options: { height: 22, turns: 3.2 } }));
  placard(
    45,
    -15,
    -1.1,
    'DNA',
    'Two metres, in every cell',
    'The rungs are the four letters the whole instruction book is written in. About three billion of them are packed into nearly every one of your cells — roughly two metres of DNA, coiled into a space you need a microscope to see.'
  );
  items.push(orb(46, -34, 8, ORB_ROSE));

  items.push(prop('cell-model', -54, -40, { rotY: 0.6 }));
  items.push(prop('anatomy-chart', -60, -26, { rotY: 0.9, options: { chart: 'cell', width: 8 } }));
  placard(
    -45,
    -31,
    0.5,
    'One cell',
    'Thirty-seven trillion of these',
    'Every organ in this hall is built from cells like this one. The purple ball is the nucleus, holding the DNA; the orange capsules are mitochondria, which release the energy from your food. This model is about a million times life size.'
  );
  items.push(orb(-54, -36, 8, ORB_BLUE));

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
        accent: '#5fc9dd',
      },
    })
  );

  // The master map is wider than the rest and dead on the axis: it is the chart that
  // answers "where was the thing I just walked around, and what is it next to?"
  items.push(prop('anatomy-chart', 0, -64, { options: { chart: 'body-systems', width: 12 } }));

  // Nine-foot charts, so the x positions here are centres about 16ft apart -- roughly a
  // 7ft gap between neighbouring boards. Any tighter and the gallery reads as one long
  // wall of paper rather than as six things you go and look at one at a time.
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
  for (const [x, z] of [[-34, -55], [-9, -57], [9, -57], [34, -55]]) {
    items.push(orb(x, z, 9, ORB_WHITE));
  }
  items.push(prop('bench', -12, -48, { rotY: Math.PI - 0.2 }));
  items.push(prop('bench', 12, -48, { rotY: Math.PI + 0.2 }));

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
          { lead: 'Then launch it', text: 'Swap those for repeat 30 times holding move Y by 0.4 feet.' },
        ],
        blocks: [
          { cat: 'control', text: 'forever' },
          { cat: 'motion', text: 'rotate 15 degrees', depth: 1 },
          { cat: 'control', text: 'wait 0.1 seconds', depth: 1 },
        ],
        tip: 'move X, Y and Z slide a model along the WORLD’s directions, not the way it is facing. Turning something does not change which way it will travel.',
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
    items.push(prop('city-building', x, z, { options: { width: w, depth: d, height: h, style, seed } }));
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
  items.push(prop('taxi-cab', 12, 24, { y: NY_ROAD, options: { fleetNumber: '2-B-71', seed: 7 } }));
  items.push(prop('taxi-cab', -13, 6, { y: NY_ROAD, rotY: Math.PI, options: { fleetNumber: '4-A-19', seed: 11 } }));
  items.push(prop('taxi-cab', 13, -26, { y: NY_ROAD, options: { fleetNumber: '1-C-08', seed: 13 } }));
  items.push(prop('taxi-cab', -13, 66, { y: NY_ROAD, rotY: Math.PI, options: { fleetNumber: '3-B-44', seed: 17 } }));
  items.push(prop('taxi-cab', 5, -60, { y: NY_ROAD, options: { fleetNumber: '5-D-62', seed: 23 } }));

  // The two-tone sedan in the foreground of the photograph -- cream over red.
  items.push(prop('sedan-car', 5, 38, { y: NY_ROAD, options: { bodyColor: 0xb8342a, topColor: 0xe6dcc2, seed: 5 } }));
  items.push(prop('sedan-car', -5, -6, { y: NY_ROAD, rotY: Math.PI, options: { bodyColor: 0x232a38, seed: 9 } }));
  items.push(prop('sedan-car', 5, 4, { y: NY_ROAD, options: { bodyColor: 0x1c1b19, seed: 21 } }));
  items.push(prop('sedan-car', -5, 40, { y: NY_ROAD, rotY: Math.PI, options: { bodyColor: 0x5a2836, coupe: true, seed: 29 } }));
  items.push(prop('sedan-car', 13, 74, { y: NY_ROAD, options: { bodyColor: 0x2f4436, seed: 31 } }));
  items.push(prop('city-bus', -13, -44, { y: NY_ROAD, rotY: Math.PI, options: { route: '7  BROADWAY', seed: 4 } }));

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
        moveStep('move Z by 1 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 20 times', 1),
        moveStep('move Z by -1 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'The cab is facing you, so the FIRST leg is a plus. Turning it round does not change which way move Z pushes it — that is why the second loop uses minus one. Try wait 0.05 seconds inside a loop to slow it to a crawl.',
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
  const bommies = [
    [-42, -14, 9, 10, 401, 30], [-28, -15, 8, 11, 409, 28], [-18, -21, 7, 8, 419, 24],
    [13, -25, 8, 10, 431, 28], [24, -19, 7, 8.5, 439, 24], [33, -13, 6, 6.5, 443, 20],
    [-36, -38, 8, 9, 449, 24], [-16, -46, 7, 8, 457, 22], [6, -50, 8, 9, 463, 24],
    [27, -43, 7, 7.5, 467, 20], [44, -30, 7, 8, 479, 20], [-50, -24, 8, 9, 487, 22],
    [-32, 3, 4, 3, 491, 12], [31, -1, 3.5, 2.5, 493, 10],
  ];
  for (const [x, z, radius, height, seed, count] of bommies) {
    items.push(prop('coral-bommie', x, z, { options: { radius, height, seed } }));
    // Smaller colonies on the mounds than on the sand. A garden draped over a nine-foot
    // rock is seen against the rock, so a colony sized for open sand looks like a slab
    // stuck on rather than something growing out of it.
    items.push(prop('coral-garden', x, z, {
      options: { radius, count, height: height > 6 ? 0.78 : 0.6, mound: height * 0.95, seed: seed + 1 },
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
  items.push(prop('coral-garden', -5, -21, { options: { radius: 8.5, count: 26, height: 1.0, mound: 10, seed: 44 } }));
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
  items.push(prop('reef-shark', 21, -25, { y: 15, rotY: -2.05, rotX: 0.08, options: { length: 8.5, seed: 5 } }));
  items.push(prop('reef-shark', -26, -60, { y: 19, rotY: 1.15, rotX: -0.05, options: { length: 7, seed: 23 } }));
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
    [-9, 11, 4, 7, 0.7, 607], [15, 12, 4, 7, 0.65, 613], [-19, 6, 3.5, 6, 0.65, 617],
    [4, 2, 3, 5, 0.6, 619], [26, -3, 3.5, 6, 0.65, 631],
  ];
  for (const [x, z, radius, count, height, seed] of gardens) {
    items.push(prop('coral-garden', x, z, { options: { radius, count, height, seed } }));
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
        options: { radius: 11, count: 70, height: 7 + (i % 3) * 1.6, seed: 251 + i * 13, color: 0x3f6b40, drift: 0.65 },
      })
    );
  }

  // --- fish ---------------------------------------------------------------------------------
  // Spread through the whole volume rather than laid out on the floor, because that is the
  // difference between a world with fish in it and a world that is under water.
  const schools = [
    ['tang', 11, 5, -30, 5, 0.95, 4.5, 0.7, 89],
    ['yellow', 8, -20, -26, 4, 0.85, 4, -0.5, 311],
    ['anthias', 16, -30, -10, 9, 0.55, 4.5, 1.2, 313],
    ['damsel', 14, 3, -14, 3, 0.42, 3, 2.1, 317],
    ['butterfly', 6, 25, -30, 6, 0.75, 3.5, -1.4, 331],
    ['tang', 9, -40, -30, 11, 0.9, 5, 0.2, 337],
    ['anthias', 18, 16, -44, 7, 0.5, 5, 2.6, 347],
    ['damsel', 12, -12, -36, 4, 0.45, 3.5, -2.2, 349],
    ['yellow', 7, 34, -34, 8, 0.8, 4, 1.7, 353],
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
      target: 'Click the big shark overhead → Program. (Look up — it is 15 feet above you.)',
      steps: [
        ctrlStep('forever'),
        ctrlStep('repeat 40 times', 1),
        moveStep('move X by -0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
        ctrlStep('repeat 40 times', 1),
        moveStep('move X by 0.5 feet', 2),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'Twenty feet out and twenty feet back, for ever. The two rotate blocks are what make it face the way it is going: move X always travels along the world, never along the shark, so turning it does not change where it goes — it only changes which way it points.',
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
        moveStep('move Y by 0.6 ft', 1),
        ctrlStep('wait 0.15 seconds', 1),
      ],
      tip: 'Egyptian crews raised these by hauling them upright onto a base with ropes and sand. Yours cheats and floats. Change 0.6 to 0.1 and watch how much more convincing slow is than fast.',
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
        moveStep('move X by 22 ft', 1),
        ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
        moveStep('move X by 22 ft', 1),
        ctrlStep('wait 2 seconds', 1),
        moveStep('rotate 180 degrees', 1),
      ],
      tip: 'move X always slides along the world’s X, never along the way the boat is pointing — so the two rotate blocks are only there to turn the hull to face its direction of travel. Take them out and it sails backwards half the time.',
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
        moveStep('move Z by -30 ft', 1),
        ctrlStep('wait 1 seconds', 1),
        moveStep('move Z by 30 ft', 1),
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
// Registry + materialization
// ---------------------------------------------------------------------------

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

function toRecord(item, groundHeightAt) {
  const y = item.absoluteY ? item.y : groundHeightAt(item.x, item.z) + (item.y || 0);
  const s = item.scale || 1;
  const base = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    transform: {
      position: [item.x, y, item.z],
      rotation: [item.rotX || 0, item.rotY || 0, 0],
      scale: [s, s, s],
    },
  };

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
      id: crypto.randomUUID(),
      kind: 'world-theme',
      theme: layout.theme,
      createdAt: Date.now(),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
    ...layout.items.map((item) => toRecord(item, groundHeightAt)),
  ];

  return { records, spawn: layout.spawn, label: preset.label };
}
