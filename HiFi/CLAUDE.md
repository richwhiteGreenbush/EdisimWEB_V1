# CLAUDE.md — Edusim HiFi

Guidance for working in `HiFi/`. Read the repo root's `CLAUDE.md` too: HiFi RUNS that app's
code, so everything it says about records, props, programs and persistence applies here. This
file records what is different and what Babylon specifically bit.

## Commands

```bash
npm install                 # repo ROOT first -- HiFi uses the root's copy of three.js
cd HiFi && npm install
npm run dev                 # :5183
npm run build
```

**`npm run dev` and `vite preview` serve the app ALONE; `../serve-local.sh` serves it WITH its
gallery** (`http://localhost:8080/hifi/` beside `/hifiworlds/`, Apache + PHP-FPM, the production
layout). Get More Worlds is the relative link `../hifiworlds/` and a `?hifiworld=` link fetches
`/hifiworlds/download.php` same-origin, so neither can work on a Vite server: Vite answers the
unknown path with the app's own `index.html`, and the symptom is an unstyled "Starting the
renderer…" page at `/hifiworlds/`. That is a hosting fact, not a bug in the link — the same one
the main app records about `/app/` and `/worlds/`.

No lint, no tests. Verification is by LOOKING: `?ui=0&still=1&preset=<key>&x=&z=&yaw=&pitch=`
puts the camera anywhere in any world, and the render loop sets `window.__ready = true` once
the world has loaded, the ground mask has settled and every ORM texture is in — which is what a
headless screenshot script should wait on. `window.__debug` is DEV-only and carries BOTH
halves (`scene`/`camera`/`registry`/… are three.js and the app; `bscene`/`bcamera`/`bridge`/
`terrain`/… are Babylon).

**A hidden browser pane stops `requestAnimationFrame`** — same trap as the main app. Nothing
ticks, no program runs, no world finishes loading.

## THE ARCHITECTURE: three.js is the scene graph, Babylon is the renderer

Every class in the main app takes `scene`, `camera` and `canvas` by injection, and only two
things ever touched the three.js RENDERER: `VRView` (WebXR) and `PhotoMode` (which only asks
it for `domElement`). So `HiFi/src/main.js` wires up the main app's own classes — imported
from `../../src/` — exactly as that app's `main.js` does, against a `THREE.Scene` and a
`THREE.PerspectiveCamera` that are **never rendered**, and `bridge/ThreeBridge.js` mirrors
that scene into Babylon every frame.

That is how programming, Create Model, Draw, browser panels, save/load, duplication, photo
mode, fly mode, the size modes and all 43 preset worlds came across at once, and it is why
they cannot drift: there is one implementation. A from-scratch Babylon port of ~100k lines
would have been a second app, wrong in different places from the first.

What follows from it, and must not be broken:

- **The THREE camera is the source of truth.** `PlayerController`, `Cinema` and the size modes
  drive it; the render loop copies position, direction and fov onto Babylon's camera. Nothing
  in HiFi moves `bcamera` on its own (VR is the one exception — Babylon's XR camera takes over).
- **Picking is three's.** `ObjectMenu`, `PlayIconManager`, `ConstructionManager`, `BuildGizmo`
  and the browser panel's edit icon all raycast the three scene with the three camera, against
  real CPU-side geometry. Babylon meshes are `isPickable = false` and
  `bscene.detachControl()` is called so Babylon eats no pointer events. `scene.updateMatrixWorld()`
  is called by the bridge each frame because no three renderer exists to do it.
- **The ground they walk on is three's too.** `SceneSetup.buildWorld()` still builds the main
  app's ground mesh (ignored by the bridge), and `PlayerController` raycasts it. HiFi's terrain
  reproduces the same height function exactly out to `CLASSIC_EXTENT` (290ft, the corners of
  the main app's 400ft plane), so a record's Y, the player's feet and the visible ground agree.
  **Carved pond basins are the one place they do not**: the student wades at bank height.
- **`three` must resolve to ONE copy.** Main-app files find it in the root `node_modules`;
  `vite.config.js` aliases HiFi's own imports to the same install. Two copies break every
  `isMesh`/`instanceof` check between them and nothing renders, with no error.
- **The CSS3D browser panels just work**, because `WebBrowserManager` renders its own
  `CSS3DRenderer` through the three camera, which is kept in step.
- **IndexedDB is per ORIGIN.** `/hifi/` beside `/app/` would share `3dcoder-world` and each
  edition would overwrite the other's saved world. `main.js` redirects that one name to
  `edusim-hifi-world` by wrapping `indexedDB.open`, rather than touching a constant the main
  app documents as never-to-change.
- **The one edit made to the main app** is additive: `Menu` takes an optional `galleryUrl`
  (default unchanged), so Get More Worlds can open the HiFi gallery.

### The bridge (`bridge/ThreeBridge.js`)

Walks the three tree each frame: creates a Babylon node for anything new, disposes anything
gone, copies LOCAL transforms and visibility (the hierarchy is mirrored, so local is right),
re-reads the material fields a program can change via a signature string, and re-uploads any
texture or geometry whose three `version` moved — which is how an animated GIF, a growing
marker stroke, a recoloured robot and a photo finishing its load all work with no special case.

- `MeshStandardMaterial` → `PBRMaterial`; Basic/Sprite/Points/Line → unlit PBR.
- `bumpMap` (a HEIGHT field) → a generated tangent-space NORMAL map; Babylon's bump slot takes
  normals only. The Sobel wraps, because relief tiles tile.
- `flatShading` → real flat geometry (un-indexed, face normals); in three it is a shader trick.
- `THREE.Sprite` → a billboarded plane in rendering group 1 when `depthTest` is off.
- `PointLight` → `engine/Lights.js`, a `ClusteredLightContainer` that takes lights one at a time
  (students add orbs at runtime). Mirrored lights are `always: 1`; native lamps come up at dusk.
- `castShadow` → a cascaded-shadow caster, unless the material is transparent.
- Textures: three maps `uv * repeat + offset` about the ORIGIN; Babylon scales about its
  rotation centre (0.5) unless `uRotationCenter = vRotationCenter = 0`.

### Native models (`props/native.js`)

A `PROP_BUILDERS` key in the `NATIVE` table is drawn as a HiFi model instead of being mirrored.
The three object is still built — it is what gets clicked, measured and programmed — so a native
builder must take the SAME options, stand on the same origin and face the same way as the
original. `startup-tree` records (the shipped maple OBJ) are fitted by bounds, since a loaded
file has arbitrary scale and pivot. Identical natives are hardware INSTANCES of one template,
with a far LOD registered on the source mesh. `?native=0` turns substitution off for A/B.

**Known gap:** `changeColor` / `setOpacity` do not reach a substituted prop.

**Which worlds get native flora is a JUDGEMENT about the world, not a property of the prop.**
Dinosaur Island, Machu Picchu, A Rabbit's Den, The Neighborhood, the Park, the Moon and Mars are
worlds where realism is the point, and their vegetation, rocks and craters are native
(`Flora.js`, `Trees.js`' `SPECIES` table, `Regolith.js`, plus `Lunar.js` / `Martian.js` for the
hardware). Whimsical World, the chalk drawings, Wonderland and JavaScript Basics are stylised ON
PURPOSE and keep the main app's models: a photoreal oak in a chalk drawing is a bug.

- **Trees are quantised** (`quantiseTree`): heights snap to 4ft and seeds fold to three, so a
  world's trees are a dozen hardware-instanced templates; the instance is then scaled by
  wanted/snapped, so each still stands exactly as tall as its record says.
- **Fronds are ribbons** (`Flora.frond`): one painted frond on a curved, folded strip whose arc is
  integrated from a start and end ELEVATION, so "arching fern" and "stiff cycad" are two numbers.
- **Rocks replay the main app's random draws**, same generator and same order, so every native
  boulder stands where its pickable three.js twin is.
- **The ground cover is chosen per world** (`themes.js` OVERRIDES -> `Grass`'s `UNDERGROWTH`):
  flowers by default, fern drifts on the Cretaceous floor, tussocks on the puna, nothing on a
  mown town's lawns, and faceted STONES with no blades at all on regolith.

### The ground follows the world (`GroundMask.js`, `themes.js`)

- **Themes are DERIVED** from the main app's `WORLD_THEMES` — zenith from the sky colour, exp²
  fog from the linear pair, PBR ground layers tinted to the theme's ramp by solving against each
  set's mean luminance, grass only where the ground is green, hills unless the world is in
  space. `OVERRIDES` holds only what a conversion cannot know (underwater, overcast, airless).
  A theme added to the main app works here unedited.
- **A world's own hour is its theme's sun direction**, used exactly; nothing is recoloured at
  home. Time of Day (the main app's phase scrub) moves the sun along an arc from there.
- **Grass is kept off floors by reading GEOMETRY**: any low, wide, up-facing triangle of a
  mirrored prop is stamped into the terrain mask (gravel for path-like prop names, bare earth
  otherwise); natives declare a footprint; `park-pond` records carve a basin. Repainted when the
  theme changes and ~45 frames after the registry count settles, never per frame.

## The target, and the budget

Current machines with discrete GPUs; budgets roughly ten times the main app's (top of
`config.js`). **The walkable world is NOT bigger**: 195ft, the main app's, by Rich's direction —
spend the budget on model definition, not acreage. (His cap is ~100 acres; 195ft is 2.7.) Past
the bound the terrain is scenery only.

Measured, headless Chrome on an Apple M3 Pro (integrated) at 1600×900, `high`: most worlds
45–60fps at 2–12M triangles submitted a frame (that figure includes shadow cascades and the
foliage depth pre-pass). Not yet run on a discrete card.

## Traps this build hit

- **A TIME-BASED SWEEP NEEDS A PER-FRAME STAMP, AND A SCREENSHOT TAKEN AT THREE SECONDS CANNOT
  SEE A BUG THAT FIRES AT TEN.** The bridge frees materials and textures unused for 600 frames.
  Materials were stamped only when ASSIGNED, so ten seconds after any world loaded every
  mirrored material in it was disposed while its mesh was still using it: models went black,
  emissive signs went pure white, and the world looked as if the sun had set. Every
  verification shot had been taken seconds after `__ready`, so all 43 worlds "passed". `visit()`
  now calls `touch()` on each live object's materials (and their textures) every frame.
  **Verify anything with a clock in it by waiting past the clock** — `shot.mjs` takes a hold
  time for exactly this, and the check is: counts stable at 25s, zero disposed-in-use, and
  counts DROP after a world switch (which proves the sweep still does its job).
- **NEVER GIVE A MESH ZERO THIN INSTANCES -- it shipped, and it stuck three worlds on the loading
  screen in production.** With a colour buffer registered and a count of 0, Babylon compiles the
  mesh WITHOUT `INSTANCES` but WITH the instance-colour define, so the vertex shader multiplies by
  an `instanceColor` it never declared and fails to compile. `Scene.isReady()` checks DISABLED
  meshes too, so that one failure held the Moon, Mars (no grass blades) and The Neighborhood (no
  wildflowers) not-ready for ever. The dev server reached ready anyway on timing, so every local
  check passed; only the production build showed it. `Grass.scatter` now writes one zero-SCALE
  instance instead, and the loading screen lifts after a 900-frame grace period whatever
  `isReady()` says (`window.__readyClean` records which). **`scratchpad/readyall.mjs`-style sweep
  -- every preset, on the PRODUCTION BUILD, asserting clean-ready and zero "Unable to compile
  effect" -- is the check to run before any deploy.**
- **`mesh.createNormals()` INVERTS normals in this scene.** It hands ComputeNormals the scene's
  right-handed flag, but MeshBuilder geometry is wound LEFT-handed whatever the scene is (Babylon
  flips culling at draw time instead). Every normal comes out pointing into the surface: the
  native craters were lit from underneath and rendered black, with no error, and it looked like
  a shadow bug, then a vertex-colour bug. Call `VertexData.ComputeNormals(pos, indices, out)`
  with NO options, as `Kit.rock` does.
- **Do not tint a material whose vertex colours already carry the colour.** Both multiply, so
  the colour is SQUARED (0.15 x 0.75 in red, 0.02 x 0.07 in blue) and the surface goes black.
  `kit.mat(..., { vertexColors: true })` wants `gain`, never `tint`.
- **Cloning a `PBRCustomMaterial` drops its shader hooks**, the clone never compiles, and ONE
  material that is never ready holds the whole scene's `isReady()` false for good -- the world
  renders but never reports ready. Make a second species/material instead of a clone.
- **A SIGN FACE is a material whose `map` is also its `emissiveMap`**, which is how every board,
  placard and chart in the main app is built. Mirrored as lit-plus-emissive it is wrong at every
  hour here (milky by day under sun + bloom + glow, a bare glow at dusk), so the bridge draws
  those faces UNLIT at `SIGN_BRIGHTNESS`: the artwork's own colours whatever the sun is doing.
- **A DoubleSide material with no `sideOrientation` is lit from BEHIND.** With culling off,
  Babylon still decides which face is the back one — the one whose normal it flips for
  two-sided lighting — from `sideOrientation`, and the default disagrees with three's winding in
  a right-handed scene. Every cream sign board in every world rendered black, text faintly
  visible, and it looked exactly like a texture or depth bug. It took four probes to find.
- **A reflection probe as `scene.environmentTexture` can block EVERY PBR material forever.**
  Babylon derives diffuse IBL by reading the cube back off the GPU; for a float render-target
  cube that promise never resolved, and `isReadyForSubMesh` is false while it is pending — a sky
  with no world in it and NO error. `Environment.updateIrradiance()` computes the SH on the CPU
  from the same sky colours. (To recompute the engine's way: `forceSphericalPolynomialsRecompute()`;
  assigning `null` leaves the "computed" flag set and returns null for good.)
- **Babylon culls as LEFT-handed even in a right-handed scene.** Hand-built geometry wound
  CCW-outward is invisible from outside: `Kit.poly()`, `Kit.plane()` and the terrain emit their
  triangles reversed. Mirrored three geometry keeps its winding and states
  `CounterClockWiseSideOrientation` instead — which is what the glTF loader does.
- **A tree template's LOD twin must be attached or it stands at the origin.** A prop built
  outside the instancing path left its `metadata.lod` tree visible at (0,0,0): a maple in the
  middle of the Park gate. Everything native now goes through `Natives.build`'s template path.
- **Main-app emissive lifts clip under HiFi's sun.** Signs there carry `emissive` so a shaded
  face stays legible; under a 2× brighter sun plus bloom they go to white. The bridge scales
  mirrored emissive to 0.35 by day and 0.6 in worlds that are dark by design.
- **Additive and transparent materials must take alpha from their map** (`hasAlpha` +
  `useAlphaFromAlbedoTexture`), or a soft light shaft is a frosted-glass slab and a star's bloom
  quad is an opaque disc.
- **`MeshBuilder.CreatePlane` faces −Z and its text reads mirrored here**; `Kit.plane()` is
  hand-built. **`uv` is only declared in the PBR vertex shader when a texture is sampled**, so
  the grass blade fraction rides in vertex-colour ALPHA. **The metallic-workflow roughness hook
  is `Fragment_Custom_MetallicRoughness`**, and `Fragment_Before_Lights` runs before AO,
  reflectivity and reflection, so writing `surfaceAlbedo`/`normalW` there affects everything.
- **A tint is a MULTIPLIER over a photo, not a colour**; `gain` lifts a set that photographs
  dark. **Alpha-tested foliage needs `needDepthPrePass`** (28fps → 60). **Leaf-card normals are
  bent outward and `twoSidedLighting` stays off.** **A "metal" verdigris roof is a blue roof** —
  metals mirror the probe and the probe is sky. **The probe must not see the sun's disc at full
  strength**, or every rough surface gets fireflies.
- **Instancing copies a child's WORLD matrix under the template**, not its local position:
  offsets living on an intermediate node were being lost.

## Turkle Street: the first HiFi-FIRST world, and what it added to the engine

`props/Turkle.js` is HiFi world 44, and it is the first world in this project that was laid
out FOR this edition. Every `PROP_BUILDERS` key in it is in the `NATIVE` table -- not the
usual handful of trees and benches, all nineteen of them -- because the world's whole job is
to look like six photographs of a real corner in Park City, Kansas, and one mirrored three.js
house on that street would give the game away. See the root `CLAUDE.md` for the world itself;
what follows is what it forced into the engine, all of which is available to every other
world.

### `kit.mat`'s `neutral`, and the measurement behind it

**THE SETS ARE MUCH DARKER THAN THEY LOOK, AND EACH HAS A COLOUR CAST.** Measured off the
shipped JPEGs (the numbers are in `SET_MEAN` at the top of `Kit.js`), `Planks012` averages
**0.068** linear luminance and `RoofingTiles013A` averages **0.031**. A material tinted to a
pale khaki and left at `gain: 1` therefore renders at SEVEN PER CENT of the colour it was
asked for -- a whole street of tan houses came out near-black, and it read as a lighting bug
rather than an albedo one, because "too dark" looks like shadow. That is the inverse of the
trap Ellis Island's black steamship hull records, and much harder to see.

`gain` could fix the level and cannot fix the cast: Planks012 is 0.097/0.063/0.038 in RGB, a
strong red-brown, so every colour laid over it skews warm. **`neutral` (0..1) divides the
albedo by the set's own measured mean, PER CHANNEL** -- the main app's `neutralized()` trick
arriving here. At 1 the photo contributes only its light and shade and the tint owns the hue;
around 0.8 keeps some of the material's own character, which is usually what wood and brick
want. It is opt-in and defaults to 0, so nothing already shipped moves.

Two calibrations from using it: **do not neutralise a warm set all the way when the sky is
blue.** Gravel022 photographs warm, so `neutral: 0.9` on the asphalt swung the correction blue
and the road came out navy under a blue ambient. 0.72 leaves a quarter of the aggregate's own
warmth in, which is what makes it read as tarmac rather than slate. And **weathered concrete
is about 0.4 albedo, not the 0.75 that "light grey" suggests** -- at the first pass's value
every slab in the world blew out to white under a 4.7 sun.

### Generated surface patterns: lap siding and asphalt shingle

**THERE IS NO LAP SIDING AND NO ASPHALT SHINGLE IN THE TEXTURE LIBRARY**, and those are two of
the three surfaces a street is mostly made of. `Planks012` is a staggered plank FLOOR -- on a
wall it reads as brickwork -- and `RoofingTiles013A` is barrel clay tile, which is a
Mediterranean roof and not a Kansas one. Tinting either harder does not help, because what is
wrong is the PATTERN.

So `patternMat()` draws four: `lap`, `shingle`, `board` and `seam`. A near-white height field
becomes an albedo and a real tangent-space NORMAL map (a wrapped Sobel), with the paint colour
on `albedoColor` and the tile in `metadata.tile` so the Builder's feet-based projection lands
the courses at the right spacing. That last part is the whole point: lap siding is a FOUR-INCH
exposure, and at any tile that makes a plank photo's boards four inches, its staggered joints
become a grid of 4in blocks, which is stucco.

Three things it cost:

- **A `DynamicTexture` DOES NOT WRAP BY DEFAULT.** These are sampled in FEET -- the Builder
  box-projects a wall's UVs as position/tile -- so v runs past 1 on anything taller than the
  tile. Clamped, every wall above 5.3ft showed the canvas's last texel row stretched to the
  eave: a flat olive band across the top half of every house and garage on the street, with
  the courses stopping dead at a horizontal line halfway up. It read as a lighting artifact
  and was an address-mode one. Set `wrapU`/`wrapV` explicitly.
- **`uvRot` on a wall clads the street in vertical barn board.** The Builder projects u across
  an elevation and v up it, and `Planks012` is already photographed with its planks along u --
  so the obvious-looking quarter turn is exactly backwards, and at a 6in board width the
  result does not read as barn board either. It reads as corduroy.
- **Cache the material per (kind, colour) at module scope.** Nineteen buildings in six colours
  should be six materials.

### A rectangular terrain CARVE

`Height.js`'s carve took a circle, for pond basins. **A kerbed street is a cut too** -- the
gutter flowline sits five inches below the lawn behind the kerb -- and built without one the
whole carriageway is under the terrain and the terrain simply draws over it. `theme.carves`
now also takes `{ x, z, w, d, yaw, depth, feather }`, declared per prop key in `GroundMask.js`'s
`PROP_CARVES` (rather than read off a live native's metadata, because the carve has to be
known BEFORE the terrain is built and a native model is only made the frame after the bridge
first sees its object).

A pond's collar-levelling is deliberately skipped for a rectangle: **a road does not make its
surroundings level, it is cut through whatever they are.** The feather is narrow -- 1.0ft --
because the kerb solid is 0.7ft wide and buried a foot deep, so a transition that fits inside
it is a transition nobody can see.

The PLAYER still walks on the main app's uncarved ground, so a student crossing the street
walks five inches above the gutter. Same trade as a pond, and at five inches it is invisible.

### Footprints are a LIST now, and they carry a channel and a yaw

`natives.footprints` took one rect or one circle. Turkle Street's street network is a plus
shape with four rounded corners, and one rectangle either misses two carriageways or paints a
hundred feet of somebody's lawn as road -- so a footprint may now be an ARRAY of stamps, each
with its own `channel` (`path`/`worn`/`bare`), `strength`, local `cx`/`cz` and `yaw`. The
offsets are in the prop's own frame, so a list turns with it.

`worn` is worth reaching for: the lawn under a big tree is THINNER, and without something
saying so the terrain's own colour drift runs at a hundred and fifty feet, which is nearly
uniform across one lot and reads as a single bright mat.

### Time of Day survived a ground refresh -- a real bug, fixed

`refreshGround()` called `environment.applyTheme(theme, null)`, which resets the sun to the
world's AUTHORED hour, and that function runs whenever the registry settles. So **scrubbing
Time of Day to dusk and then placing a single light orb snapped the whole world back to
noon**, which reads as the slider having broken. It is also why `?phase=` never appeared in a
screenshot: the shot is taken long after the ground has settled. `refreshGround` now re-applies
`lastSunPhase`.

### Verification: `tools/turkle/shot.mjs`

There is no puppeteer in this checkout and there does not need to be: node's own global
`WebSocket` speaks the Chrome DevTools Protocol, and a screenshot is four messages. It waits
on `window.__ready` and then HOLDS, for the reason this file already records -- the bridge's
material sweep runs on a 600-frame clock and a shot taken at three seconds cannot see a bug
that fires at ten.

**Use the GPU, not SwiftShader.** `--headless=new` with `--use-angle=metal --enable-gpu`
renders a world like this in seconds; `--use-angle=swiftshader` is correct and takes many
minutes on a scene with a million-triangle terrain in it, which is long enough that the first
attempt looked like a hang. `TS_SHOT_SOFTWARE=1` forces the fallback.

**Per-prop measurements: 30-54 fps at 1600x900 on an M3 Pro (integrated), 98 records, ~707
meshes with 213-226 active, 119 materials, 106 textures, 3 point lights.** Still not run on a
discrete card.

## The Edusim HiFi Worlds Database (`../EdusimHiFiWorldDatabase/`)

A sibling of `EdusimWorldDatabase/`, same PHP + SQLite app, own data. Served from
`/hifiworlds/` beside the app's `/hifi/`; the link parameter is **`?hifiworld=<id>`**, resolved
against the root-relative `HIFI_WORLD_LINK_BASE` for the main app's same-origin reason. World
files are the main app's record format (stamped `"edition": "edusim-hifi"`), so they open in
either edition; what makes them HiFi is what draws them. Seed with
`php EdusimHiFiWorldDatabase/tools/seed-presets.php`; screenshots come from `seed/shots/` only.
