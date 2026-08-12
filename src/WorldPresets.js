import { applyWorldTheme } from './SceneSetup.js';

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
      x: -9, z: -16, rotY: 1.1,
      eyebrow: 'The grow bay',
      title: 'Dinner under pink light',
      body: 'No soil — the roots sit in nutrient water. The lights are magenta because plants only use the red and blue parts of sunlight; the green is reflected, which is why leaves look green.',
    },
    {
      x: -3, z: -25, rotY: -0.2,
      eyebrow: 'Life support',
      title: 'Oxygen out of thin air',
      body: 'Martian air is 95% carbon dioxide. Split CO₂ and you get carbon and the O₂ you breathe. NASA really did this on Mars in 2021, with an instrument the size of a toaster.',
    },
    {
      x: 9, z: -14, rotY: -1.0,
      eyebrow: 'Crew quarters',
      title: 'A day and a bit',
      body: 'A Martian day — a "sol" — is 24 hours 37 minutes. Close enough to sleep by, but the extra 37 minutes add up: crews drift a whole night out of step with Earth in about a month.',
    },
    {
      x: -6, z: 2, rotY: 0.3,
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
    prop('standing-sign', -20, 24, {
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
  items.push(prop('mars-helicopter', 16, 30, { rotY: 0.5 }));

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
    [-52, -20, 10, 9, 1.1, 31],
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
      x: -9, z: 22, rotY: 0.35,
      eyebrow: 'Welcome',
      title: 'You are a long way from home',
      body: 'Mars is between 34 and 250 million miles away depending on where the two planets are. Even the fast trips take about seven months each way.',
    },
    {
      x: 9, z: 22, rotY: -0.35,
      eyebrow: 'Look up',
      title: 'Why the sky is butterscotch',
      body: 'Fine dust in the air scatters the red end of sunlight all over the sky. The strange part: at sunset it flips, and the glow around the setting sun turns BLUE.',
    },
    {
      x: -16, z: 30, rotY: 0.5,
      eyebrow: 'Gravity',
      title: 'You would weigh a third',
      body: 'Mars pulls with about 38% of Earth\'s gravity. A 100-pound student weighs 38 pounds here — and could jump nearly three times as high.',
    },
    {
      x: -38, z: 26, rotY: 0.7,
      eyebrow: 'On the horizon',
      title: 'The biggest volcano anywhere',
      body: 'Olympus Mons is about 16 miles high and as wide as Arizona — but its slopes are so gentle that standing on it, you would never know you were on a mountain.',
    },
    {
      x: -30, z: -2, rotY: -1.1,
      eyebrow: 'The greenhouse',
      title: 'Farming without soil',
      body: 'Martian dirt contains perchlorates, which are poisonous to us. Crops here are grown in trays of water instead — and every plant also helps recycle the air.',
    },
    {
      x: 32, z: -22, rotY: -0.3,
      eyebrow: 'The drill',
      title: 'There is ice under your feet',
      body: 'Buried water ice covers much of Mars. It is drinking water, it is breathable oxygen, and split into hydrogen and oxygen it is rocket fuel for the trip home.',
    },
    {
      x: 24, z: 16, rotY: -0.6,
      eyebrow: 'The relay dish',
      title: 'Nobody phones home',
      body: 'A radio signal takes 3 to 22 minutes each way. Ask Earth a question and the answer is at best six minutes behind you, so crews send messages, not conversations.',
    },
    {
      x: -28, z: 12, rotY: -0.5,
      eyebrow: 'Power',
      title: 'Sunlight, and a dust problem',
      body: 'Mars gets less than half the sunlight Earth does, and dust settling on the panels steals more. Planet-wide dust storms can dim the sky for months at a time.',
    },
    {
      // On the far side of the rover: sat on the near side it stands squarely between
      // the spawn point and the machine it is describing.
      x: 34, z: 17, rotY: -2.2,
      eyebrow: 'The rover',
      title: 'Wheels made of metal',
      body: 'About 10 feet long — twice your height. The wheels are milled from aluminium, because rubber goes brittle at −100°F and would fall apart in the near-vacuum.',
    },
    {
      x: 12, z: 33, rotY: 0.2,
      eyebrow: 'The scout',
      title: 'First flight on another world',
      body: 'The air here is 1% as thick as Earth\'s, so the blades have to spin about 2,400 times a minute — five times a helicopter at home — to find anything to push against.',
    },
    {
      x: 22, z: 2, rotY: -0.4,
      eyebrow: 'The weather mast',
      title: 'Wind you would barely feel',
      body: 'A 60 mph Martian gale pushes about as hard as a 4 mph breeze on Earth, because there is so little air in it. The movie version of a Mars storm is fiction.',
    },
    {
      x: 34, z: 2, rotY: -0.8,
      eyebrow: 'Two moons',
      title: 'Phobos and Deimos',
      body: 'Both are tiny lumps, probably captured asteroids. Phobos races around so fast that it rises in the WEST and sets in the east — twice every single day.',
    },
    {
      x: -22, z: -42, rotY: 0.6,
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
      x: -46, z: -40, rotY: 0.5,
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

  items.push(prop('field-camp', 0, 26));
  items.push(prop('bench', -6, 30, { rotY: Math.PI }));
  items.push(prop('bench', 6, 30, { rotY: Math.PI }));
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
    ['tree-fern', 20, -4, 14, 15], ['tree-fern', -14, -26, 15, 19], ['tree-fern', 22, -36, 17, 24],
    ['tree-fern', -36, -22, 14, 28], ['tree-fern', 30, -18, 16, 34], ['tree-fern', -6, -62, 15, 39],
    ['cycad', -14, 31, 7, 5], ['cycad', 14, 31, 6, 8], ['cycad', -26, -18, 7, 12],
    ['cycad', 26, -12, 6, 16], ['cycad', -18, -38, 8, 22], ['cycad', 18, -46, 7, 27],
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
      x: -8, z: 34, rotY: 0.3,
      eyebrow: 'Where you are',
      title: 'The last day of the dinosaurs',
      body: 'Everything here lived about 66 million years ago, right at the end of the Cretaceous. Every animal on this island really did share that time and place — most famous dinosaurs never met each other.',
    },
    {
      x: 8, z: 34, rotY: -0.3,
      eyebrow: 'Deep time',
      title: 'Stegosaurus was already ancient',
      body: 'More time separates Stegosaurus from T. rex than separates T. rex from you. The Age of Dinosaurs lasted so long that its own history had ancient history.',
    },
    {
      x: -7, z: 20, rotY: 0.4,
      eyebrow: 'Underfoot',
      title: 'No grass anywhere',
      body: 'Grass had barely appeared. The green here is ferns, horsetails and moss — which is why almost every plant-eater on this island is built to browse low shrubs, not to graze a lawn.',
    },
    {
      x: 7, z: 20, rotY: -0.4,
      eyebrow: 'Something new',
      title: 'The first flowers',
      body: 'Flowering plants were a recent invention in the Cretaceous. The magnolias here are among the oldest kinds still alive — T. rex lived alongside the very first blossom.',
    },
    {
      x: 24, z: 10, rotY: -0.5,
      eyebrow: 'The dig',
      title: 'How anyone knows any of this',
      body: 'The string grid is not decoration. Every bone is drawn and measured inside its own square before it is lifted, because where a bone sat tells you as much as the bone does.',
    },
    {
      x: 34, z: 17, rotY: -2.6,
      eyebrow: 'The dig',
      title: 'How a fossil forms',
      body: 'An animal has to be buried fast — under river mud or sand — before it rots or is eaten. Minerals then seep in over millions of years. Almost nothing that dies ever becomes a fossil.',
    },
    {
      x: 25, z: -2, rotY: -1.5,
      eyebrow: 'The dig',
      title: 'Plaster jackets',
      body: 'Those white bundles are bones wrapped in plaster and burlap, exactly like a cast on a broken arm. It is the only way to move something that has been shattered for 66 million years.',
    },
    {
      x: -24, z: -2, rotY: 1.4,
      eyebrow: 'Triceratops',
      title: 'Three horns and a shield',
      body: 'The frill is bone, and the brow horns are over three feet long. They were probably used against rivals as much as against predators — plenty of frills carry healed wounds from other Triceratops.',
    },
    {
      x: -20, z: -28, rotY: 2.2,
      eyebrow: 'Ankylosaurus',
      title: 'A living tank',
      body: 'Armour plates set into the skin, spikes along both flanks, and a solid bone club on the tail heavy enough to break a leg. Even its eyelids were armoured.',
    },
    {
      x: -42, z: -34, rotY: 1.1,
      eyebrow: 'Edmontosaurus',
      title: 'What T. rex ate',
      body: 'Some Edmontosaurus fossils carry T. rex bite marks that HEALED. That is the strongest evidence we have that T. rex attacked living prey — and that sometimes the prey got away.',
    },
    {
      x: 12, z: -18, rotY: -1.2,
      eyebrow: 'Pachycephalosaurus',
      title: 'Ten inches of solid skull',
      body: 'Stand next to this one — it is about your height. The dome on its head is bone up to ten inches thick, probably for shoving contests with rivals rather than head-on charges.',
    },
    {
      x: 14, z: -34, rotY: -1.0,
      eyebrow: 'Footprints',
      title: 'What tracks tell you',
      body: 'A skeleton tells you how an animal was built. A trackway tells you what it did — how fast it walked, whether it travelled alone, and how it placed its feet.',
    },
    {
      x: -8, z: -38, rotY: 0.5,
      eyebrow: 'The nest',
      title: 'Dinosaur parents',
      body: 'Dinosaurs built nests, sat on their eggs and looked after what hatched. That behaviour is one of the strongest links between them and the birds outside your window.',
    },
    {
      x: 16, z: -60, rotY: -2.3,
      eyebrow: 'Tyrannosaurus rex',
      title: 'Thirteen feet at the hip',
      body: 'Nearly three times your height at the hip, and forty feet nose to tail. The biggest teeth found are about the size of a banana — and built like railway spikes, for crushing bone rather than slicing.',
    },
    {
      x: -6, z: -58, rotY: 1.1,
      eyebrow: 'Tyrannosaurus rex',
      title: 'Those arms are not a joke',
      body: 'They are shorter than yours, but each one could curl around 400 pounds. Nobody is certain what they were for — holding struggling prey and pushing up off the ground are the best guesses.',
    },
    {
      x: 30, z: -46, rotY: -1.9,
      eyebrow: 'Look up',
      title: 'That is not a dinosaur',
      body: 'Quetzalcoatlus is a pterosaur — a flying cousin, not a dinosaur. Its wings are skin stretched on one enormous finger. Standing on the ground it was as tall as a giraffe.',
    },
    {
      x: -30, z: 14, rotY: 0.9,
      eyebrow: 'Living fossil',
      title: 'You can go and touch one',
      body: 'The ginkgo here is near-identical to the ginkgo growing in car parks today. Whatever wiped out the dinosaurs, this tree walked straight through it unchanged.',
    },
    {
      x: -20, z: 6, rotY: 0.7,
      eyebrow: 'They are still here',
      title: 'Birds are dinosaurs',
      body: 'Not "descended from" — they ARE dinosaurs, the one branch that survived. Every sparrow is a closer relative of T. rex than T. rex was of Triceratops.',
    },
    {
      x: -34, z: 30, rotY: 0.8,
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

  items.push(prop('micro-sub', 18, 60, { rotY: -0.6 }));
  placard(
    13,
    54,
    -0.5,
    'Your ride',
    'Shrunk down and injected',
    'A 1966 film imagined a submarine and its crew miniaturised and injected into a patient. That part is still fiction — but swallowable pill-sized cameras have been photographing the inside of real intestines since 2001.'
  );

  // The project's own banner image, reused as the entrance sign. Held to 3ft tall: this
  // is a very wide image, so 3ft of height is about 12ft of width.
  items.push(asset('startup-billboard', -18, 60, { rotY: 0.7, height: 3 }));

  placard(
    -10,
    58,
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
    -30,
    -13,
    2.5,
    'Left and right',
    'They are not a matching pair',
    'The right lung has three lobes, the left only two — the heart takes the space where the third would be. That is also why an inhaled peanut nearly always ends up in the right lung: its bronchus is wider and steeper.'
  );
  items.push(orb(-28, 0, 8, ORB_WHITE));
  items.push(orb(-16, -13, 8, ORB_WHITE));

  items.push(prop('alveoli-cluster', -36, 4, { rotY: 0.5 }));
  placard(
    -32,
    9,
    0.5,
    'Zoom in',
    'Where the swap happens',
    'This is one alveolus and its blood vessels, blown up enormously. The wall between air and blood is about one five-hundredth of a millimetre thick — thin enough for oxygen to cross by simply drifting.'
  );
  items.push(orb(-36, 6, 7, ORB_BLUE));

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
    30,
    -13,
    -2.5,
    'How much fits',
    'Empty, it is fist-sized',
    'An empty stomach holds well under a cup. Full, it stretches to about four times that. Those folds you can see inside — the rugae — are what unfold to let it. Food stays here two to four hours, then leaves a teaspoon at a time.'
  );
  items.push(orb(28, 0, 8, ORB_WARM));
  items.push(orb(16, -13, 8, ORB_WHITE));

  items.push(prop('villi-patch', 34, 4, { options: { count: 46, radius: 6, seed: 11 } }));
  placard(
    30,
    10,
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

  items.push(prop('anatomy-chart', 34, -46, { rotY: -1.0, options: { chart: 'kidney-section', width: 8 } }));

  // --- The far wings: brain, nerve, DNA, cell ------------------------------
  exhibit('brain-model', -42, -24, {
    label: 'Brain',
    sublabel: 'NERVOUS SYSTEM',
    radius: 3.8,
    rotY: 1.2,
  });
  placard(
    -37,
    -18,
    1.0,
    'Brain',
    'Two per cent of you, twenty per cent of the fuel',
    'About 86 billion nerve cells, folded up so that three times as much surface fits inside your skull. It is only about 2% of your body weight but burns around 20% of the oxygen you breathe — even while you sleep.'
  );
  items.push(orb(-42, -29, 8, ORB_BLUE));

  items.push(prop('neuron-model', -48, -8, { rotY: 1.35, options: { length: 24 } }));
  placard(
    -40,
    -6,
    0.9,
    'One nerve cell',
    'Signals at 270 miles an hour',
    'Signals arrive on the branching end, travel down the long fibre, and are handed to the next cell at the tips. The pale sleeves are insulation — the gaps between them let the signal leap ahead instead of crawling, up to 120 metres per second.'
  );
  items.push(orb(-46, -12, 7, ORB_WHITE));

  items.push(prop('dna-helix', 46, -30, { options: { height: 22, turns: 3.2 } }));
  placard(
    41,
    -26,
    -1.1,
    'DNA',
    'Two metres, in every cell',
    'The rungs are the four letters the whole instruction book is written in. About three billion of them are packed into nearly every one of your cells — roughly two metres of DNA, coiled into a space you need a microscope to see.'
  );
  items.push(orb(46, -34, 8, ORB_ROSE));

  items.push(prop('cell-model', -46, -46, { rotY: 0.6 }));
  items.push(prop('anatomy-chart', -38, -52, { rotY: 0.5, options: { chart: 'cell', width: 8 } }));
  placard(
    -42,
    -40,
    0.5,
    'One cell',
    'Thirty-seven trillion of these',
    'Every organ in this hall is built from cells like this one. The purple ball is the nucleus, holding the DNA; the orange capsules are mitochondria, which release the energy from your food. This model is about a million times life size.'
  );
  items.push(orb(-46, -42, 8, ORB_BLUE));

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

  for (const [chart, x, z, rotY] of [
    ['respiratory', -30, -60, 0.34],
    ['circulatory', -15, -62, 0.16],
    ['digestive', 15, -62, -0.16],
    ['urinary', 30, -60, -0.34],
    ['nervous', -45, -54, 0.6],
    ['skeletal', 45, -54, -0.6],
  ]) {
    items.push(prop('anatomy-chart', x, z, { rotY, options: { chart, width: 9 } }));
  }

  // The gallery is a wall of cream paper at the dark end of the hall, so it gets its own
  // lighting rather than relying on the exhibits' orbs 30ft away.
  for (const [x, z] of [[-30, -55], [-8, -57], [8, -57], [30, -55]]) {
    items.push(orb(x, z, 9, ORB_WHITE));
  }
  items.push(prop('bench', -12, -48, { rotY: Math.PI - 0.2 }));
  items.push(prop('bench', 12, -48, { rotY: Math.PI + 0.2 }));

  return { theme: 'voyage', spawn: { x: 0, z: 82, yaw: 0 }, items };
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
