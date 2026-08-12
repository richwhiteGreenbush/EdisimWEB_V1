import { applyWorldTheme } from './SceneSetup.js';

// The three ready-made worlds behind Menu > Load World.
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
  items.push(prop('map-kiosk', -12, -8, { rotY: 0.5 }));

  // The project's own billboard image, reused as the park's welcome banner. Sized by
  // HEIGHT, and this image is a very wide banner -- at 6ft tall it comes out roughly
  // 24ft across and swallows the whole entrance. 3ft tall is about 12ft wide, which
  // reads as a sign rather than a wall.
  items.push(asset('startup-billboard', 20, -3, { rotY: -0.7, height: 3 }));

  // The little library .obj as the nature centre. It is a wide, low building, so
  // normalizing it to a 15ft ridge gives it a 45ft-square footprint -- big enough to
  // swallow the entrance. Held to 12ft and set well back off the path instead.
  items.push(asset('startup-library', -48, -4, { rotY: 0.9, height: 12 }));
  items.push(
    prop('info-placard', -30, -12, {
      rotY: 0.9,
      options: {
        eyebrow: 'Nature centre',
        title: 'Start your visit here',
        body: 'Maps, trail guides and restrooms. Rangers here can tell you what is blooming, nesting or migrating in the park this week.',
      },
    })
  );

  items.push(
    prop('info-placard', -6, -11, {
      rotY: 0.4,
      options: {
        eyebrow: 'Welcome',
        title: 'A park built for everyone',
        body: 'Frederick Law Olmsted designed parks like this one in the 1880s so that city families with no garden of their own still had somewhere green to go. It was a radical idea.',
      },
    })
  );
  items.push(
    prop('info-placard', 6, -11, {
      rotY: -0.4,
      options: {
        eyebrow: 'The Emerald Necklace',
        title: 'A chain of green',
        body: 'This park is the last bead on a 7-mile chain of connected parks. Olmsted linked them so you could walk from the city centre to open country without leaving green space.',
      },
    })
  );

  items.push(prop('drinking-fountain', 11, -15));
  items.push(prop('flower-bed', -10, -18, { options: { width: 11, depth: 5, seed: 7 } }));
  items.push(prop('flower-bed', 10, -18, { options: { width: 11, depth: 5, seed: 8 } }));

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

  items.push(prop('lamp-post', -8, -22));
  items.push(prop('lamp-post', 8, -22));
  items.push(prop('lamp-post', -8, -50));
  items.push(prop('lamp-post', 8, -50));
  items.push(prop('bench', -7, -32, { rotY: Math.PI / 2 }));
  items.push(prop('bench', 7, -32, { rotY: -Math.PI / 2 }));
  items.push(prop('bench', -7, -48, { rotY: Math.PI / 2 }));
  items.push(prop('bench', 7, -48, { rotY: -Math.PI / 2 }));

  // --- Fountain plaza, just off the axis ----------------------------------
  items.push(prop('stone-fountain', -19, -25, { options: { radius: 6.5 } }));
  items.push(prop('bench', -19, -34, { rotY: 0 }));
  items.push(prop('planter', -28, -25));
  items.push(prop('planter', -19, -16));

  // --- The bandstand, closing the axis ------------------------------------
  items.push(prop('bandstand', 0, -70, { rotY: -Math.PI / 2 }));
  items.push(
    prop('info-placard', 11, -62, {
      rotY: -0.7,
      options: {
        eyebrow: 'The bandstand',
        title: 'Why it is shaped like that',
        body: 'The domed roof and raised deck bounce sound outward and down, so a band with no microphones can still be heard across the lawn. Try standing at different distances.',
      },
    })
  );
  items.push(prop('bench', -13, -66, { rotY: -1.2 }));
  items.push(prop('bench', 13, -66, { rotY: 1.2 }));

  // --- The pond -----------------------------------------------------------
  // Radius 15, not 20: the pond's reed margin sits at ~1.0x its radius, and at 20 those
  // cattails came up through the floor of the Overlook shelter 25ft away.
  items.push(prop('park-pond', -52, -40, { options: { radius: 15, seed: 23 } }));
  items.push(prop('bench', -34, -34, { rotY: -2.4 }));
  items.push(
    prop('info-placard', -32, -30, {
      rotY: -2.3,
      options: {
        eyebrow: 'Scarboro Pond',
        title: 'A whole food web',
        body: 'Sun feeds algae, algae feed insects and tadpoles, those feed the fish and frogs, and the heron at the far bank eats those. Pull out one link and the rest wobble.',
      },
    })
  );
  items.push(prop('picnic-set', -62, -22, { rotY: 0.35 }));
  items.push(prop('picnic-set', -68, -32, { rotY: -0.2 }));

  // The arch bridge straddles the west path, so students walk THROUGH it. Rotated a
  // quarter turn because the builder's arch opening runs along its local X while its
  // barrel runs along Z -- unrotated, the path would meet a solid abutment.
  items.push(prop('stone-arch-bridge', -26, -40, { rotY: Math.PI / 2, options: { span: 14, width: 8 } }));
  items.push(
    prop('info-placard', -26, -30, {
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
  items.push(prop('stone-steps', -28, -58, { options: { steps: 7, width: 9 } }));
  items.push(
    prop('info-placard', -24, -60, {
      rotY: -0.9,
      options: {
        eyebrow: 'The Overlook',
        title: 'Reading a landscape',
        body: 'Almost nothing here is accidental. Trees were planted to frame some views and hide others, and the ground was reshaped so the park feels bigger than it is.',
      },
    })
  );

  // --- The great meadow and the Playstead ---------------------------------
  items.push(prop('playground', 34, -14));
  items.push(
    prop('info-placard', 20, -12, {
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
    prop('info-placard', 46, -38, {
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
  items.push(prop('wildflowers', 18, -56, { options: { radius: 8, count: 150, seed: 13 } }));
  items.push(
    prop('info-placard', 24, -35, {
      rotY: 0.3,
      options: {
        eyebrow: 'Pollinator meadow',
        title: 'Left long on purpose',
        body: 'This grass is cut once a year, not weekly. Bees, butterflies and beetles need flowers that are allowed to finish blooming — a mown lawn feeds almost nothing.',
      },
    })
  );

  // --- Puddingstone -------------------------------------------------------
  items.push(prop('puddingstone-outcrop', 22, -70, { options: { size: 10, seed: 13 } }));
  items.push(
    prop('info-placard', 15, -64, {
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
    prop('info-placard', 53, -70, {
      rotY: 0.45,
      options: {
        eyebrow: 'Historic structure',
        title: 'The bear dens',
        body: 'Bears really lived behind these bars, from 1912 until the 1950s. We know far more now about what animals need, and no accredited zoo would build this today.',
      },
    })
  );
  items.push(prop('bench', 59, -73, { rotY: 0.45 }));

  // --- Planting -----------------------------------------------------------
  // Perimeter woods and specimen trees. Kept to a modest count: each tree is several
  // draw calls, and the park is already the heaviest of the four worlds.
  // Nothing tall within ~25ft of the spawn point: a 24ft canopy planted next to where
  // the student appears fills the whole screen and hides the gate they are meant to
  // walk through. The sun sits high in the +X/+Z quadrant for this theme, so trees are
  // also kept clear of that side of the bear dens, whose deep arches are already the
  // darkest thing in the park and go pitch black under a tree shadow.
  const trees = [
    ['shade-tree', -32, 10, 24, 4], ['shade-tree', 36, 6, 22, 9],
    ['shade-tree', -72, -26, 26, 14], ['shade-tree', 48, -8, 23, 21],
    ['shade-tree', -70, -52, 25, 26], ['shade-tree', 70, -26, 24, 33],
    ['shade-tree', -22, -80, 26, 38], ['shade-tree', 20, -96, 23, 45],
    ['conifer-tree', -48, -68, 28, 2], ['conifer-tree', -56, -74, 24, 6],
    ['conifer-tree', 24, -100, 26, 10], ['conifer-tree', 34, -104, 22, 15],
    ['conifer-tree', -10, -94, 27, 19], ['conifer-tree', 4, -100, 24, 24],
    ['flowering-tree', -15, -32, 16, 5], ['flowering-tree', 15, -32, 16, 31],
    ['flowering-tree', -28, -16, 15, 37], ['flowering-tree', 22, -18, 17, 43],
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
    [-42, -18, 1.6, 24],
    [26, -54, 2.2, 21],
  ]) {
    items.push(asset('startup-tree', x, z, { rotY, height }));
  }
  items.push(
    prop('info-placard', -12, -50, {
      rotY: 0.8,
      options: {
        eyebrow: 'Trees',
        title: 'How to tell them apart',
        body: 'Start with the leaf: is it one blade or many leaflets? Then the edge — smooth, toothed or lobed? Two questions will get you most of the way to a name.',
      },
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
  items.push(orb(-12, -8, 7, ORB_WARM));

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

  // Five plinths down the gallery, each with its sculpture and its own label.
  const displays = [
    { x: -13, z: -22, sculpture: 'sculpture-bust', pedestal: 3.0, options: {},
      title: 'Portrait Bust', body: 'Carved portraits like this are over 2,000 years old. Before photographs, this was how you remembered a face.' },
    { x: 13, z: -22, sculpture: 'sculpture-knot', pedestal: 3.0, options: { size: 1.3 },
      title: 'Bronze Knot', body: 'One continuous surface with no beginning or end. Try walking all the way around it — can you find a seam?' },
    { x: 0, z: -38, sculpture: 'sculpture-figure', pedestal: 3.5, options: {},
      title: 'Standing Figure', body: 'The weight rests on one leg, so the hips and shoulders tilt opposite ways. Sculptors call this contrapposto.' },
    { x: -13, z: -44, sculpture: 'sculpture-crystals', pedestal: 2.6, options: { height: 3.4 },
      title: 'Light Study', body: 'Glass and colour. Move around it and watch the colour change as light passes through at different angles.' },
    { x: 13, z: -44, sculpture: 'sculpture-mobile', pedestal: 0, options: { height: 9 },
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
      prop('info-placard', display.x + 2.6, display.z + 2.6, {
        y: MUSEUM_FLOOR,
        rotY: 0.5,
        options: { eyebrow: 'On display', title: display.title, body: display.body, height: 2.8, width: 2.0 },
      })
    );
  }

  items.push(prop('velvet-rope', 0, -34.2, { y: MUSEUM_FLOOR, options: { length: 7 } }));
  items.push(prop('velvet-rope', 0, -41.8, { y: MUSEUM_FLOOR, options: { length: 7 } }));

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

  items.push(prop('bench', -7, -30, { y: MUSEUM_FLOOR, rotY: Math.PI / 2 }));
  items.push(prop('bench', 7, -30, { y: MUSEUM_FLOOR, rotY: -Math.PI / 2 }));

  // Approach and plaza. The sign sits off the centre line on purpose -- squared up on
  // the axis it reads as a billboard bolted across the museum's own facade.
  items.push(
    prop('standing-sign', -19, -6, {
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
    prop('info-placard', -8, -6, {
      rotY: 0.35,
      options: {
        eyebrow: 'Before you go in',
        title: 'How to look at art',
        body: 'Pick one work. Stand with it for a full minute. What is the first thing you notice? What is the last?',
      },
    })
  );
  items.push(
    prop('info-placard', 8, -6, {
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
    prop('info-placard', -30, -10, {
      options: {
        eyebrow: 'Plaza commission',
        title: 'Three Rings',
        body: 'Outdoor sculpture has to survive rain, sun and wind. That is why so much of it is bronze or stainless steel.',
      },
    })
  );

  items.push(prop('planter', -26, -10));
  items.push(prop('planter', 26, -10));
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
    prop('info-placard', 6.5, -17, {
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
  items.push(prop('story-rug', 19, -48, { y: floor }));
  items.push(
    prop('info-placard', 19, -42, {
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
    prop('info-placard', -6.5, -17, {
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
    prop('standing-sign', -21, -5, {
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
    prop('info-placard', 18, -6, {
      rotY: -0.6,
      options: {
        eyebrow: 'After hours',
        title: 'The book return',
        body: 'Libraries lend about 2 billion items a year in the US alone. Almost all of them come back — usually through a slot like this one.',
      },
    })
  );

  items.push(prop('bench', -13, -6, { rotY: 0.2 }));
  items.push(prop('bench', -20, 2));
  items.push(prop('lamp-post', -24, 4));
  items.push(prop('lamp-post', 24, 4));
  items.push(prop('planter', -18, -10));
  items.push(prop('planter', 18, -10));
  items.push(prop('shade-tree', -34, 0, { options: { seed: 21, height: 24 } }));
  items.push(prop('shade-tree', 34, -2, { options: { seed: 33, height: 20 } }));
  items.push(prop('shade-tree', -40, -26, { options: { seed: 41, height: 26 } }));
  items.push(prop('shade-tree', 40, -30, { options: { seed: 52, height: 22 } }));

  return { theme: 'library', spawn: { x: 0, z: 16, yaw: 0 }, items };
}

// ---------------------------------------------------------------------------
// The Moon
// ---------------------------------------------------------------------------

function moonLayout() {
  const items = [];

  items.push(prop('lunar-module', 0, -30));
  items.push(prop('lunar-rover', 17, -17, { rotY: -0.9 }));
  items.push(prop('lunar-flag', -13, -19));
  items.push(prop('lunar-plaque', 3.5, -21, { rotY: 0.2 }));
  items.push(prop('alsep-station', -24, -33, { rotY: 0.5 }));

  items.push(prop('bootprint-trail', 6, -14, { rotY: 0.35, options: { count: 10, seed: 5 } }));
  items.push(prop('bootprint-trail', -7, -12, { rotY: -0.5, options: { count: 8, seed: 8 } }));
  items.push(prop('bootprint-trail', 12, -26, { rotY: 1.3, options: { count: 9, seed: 13 } }));

  // Earth: fixed in the lunar sky, because the Moon keeps one face toward us and so
  // Earth never rises or sets for anyone standing here. Held at about 24 degrees of
  // elevation from the spawn point -- high enough to read as "up there", low enough to
  // sit inside a 70 degree vertical field of view without being clipped by the top of
  // the screen the moment the world loads.
  items.push(prop('earth-in-sky', -72, -150, { y: 84, absoluteY: true, options: { radius: 26 } }));

  items.push(prop('moon-habitat', -38, 4, { rotY: 0.4 }));
  items.push(prop('solar-array', -30, 16, { rotY: -0.5 }));

  for (const [x, z, radius, seed] of [
    [-56, -62, 18, 3],
    [58, -40, 24, 7],
    [-64, 24, 15, 11],
    [40, -84, 20, 17],
    [46, 18, 13, 23],
  ]) {
    items.push(prop('moon-crater', x, z, { options: { radius, rimHeight: 1.4 + (seed % 4) * 0.25, seed } }));
  }

  for (const [x, z, count, spread, scale, seed] of [
    [26, -40, 10, 8, 1.0, 31],
    [-20, -8, 8, 7, 0.8, 37],
    [-32, -50, 12, 11, 1.3, 41],
    [34, 2, 9, 9, 1.1, 43],
    [8, -48, 7, 6, 0.7, 47],
  ]) {
    items.push(prop('moon-rocks', x, z, { options: { count, spread, scale, seed } }));
  }

  items.push(
    prop('standing-sign', -21, -6, {
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
      x: -8, z: -8, rotY: 0.3,
      eyebrow: 'Look up',
      title: 'Why the sky is black',
      body: 'The Moon has almost no atmosphere. With no air to scatter sunlight, the sky stays black even at noon — and the stars never twinkle.',
    },
    {
      x: 10, z: -9, rotY: -0.3,
      eyebrow: 'The flag',
      title: 'It is not waving',
      body: 'No air means no wind. A horizontal rod along the top hem holds the flag out flat. The ripples are just creases from being rolled up.',
    },
    {
      x: 22, z: -24, rotY: -0.9,
      eyebrow: 'Lunar Roving Vehicle',
      title: 'The Moon buggy',
      body: 'About 10 feet long — twice your height. Wheels of woven piano wire, because rubber tyres would crack in vacuum. Top speed: 8 mph.',
    },
    {
      x: -6, z: -20, rotY: 0.6,
      eyebrow: 'Lunar Module',
      title: 'Two ships in one',
      body: 'Only the top half flew home. The gold foil is Kapton, wrapped on to keep the temperature steady between +250°F in sun and -280°F in shade.',
    },
    {
      x: 9, z: -13, rotY: -0.2,
      eyebrow: 'Footprints',
      title: 'They are still there',
      body: 'No wind, no rain, no running water. The prints left in 1969 could stay sharp for millions of years — only micrometeorites slowly erase them.',
    },
    {
      x: -30, z: -22, rotY: 0.9,
      eyebrow: 'ALSEP',
      title: 'Experiments still running',
      body: 'The mirror panel here reflects laser beams straight back to Earth. Scientists still fire at it, and have measured the Moon drifting 1.5 inches farther away each year.',
    },
    {
      x: -34, z: 14, rotY: -0.4,
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
// Registry + materialization
// ---------------------------------------------------------------------------

export const PRESET_WORLDS = {
  park: { label: 'The Park', hint: 'The default world: a great meadow, a pond, a bandstand and the bear dens', build: parkLayout },
  museum: { label: 'The Museum', hint: 'A gallery of sculpture and painting, with a plaza out front', build: museumLayout },
  library: { label: 'The Library', hint: 'A public reading room: stacks, Dewey signs, card catalog, globe', build: libraryLayout },
  moon: { label: 'The Moon', hint: 'An Apollo landing site — lander, rover, flag and craters', build: moonLayout },
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
