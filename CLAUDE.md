# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

3DCoder is a single-user, browser-based 3D sandbox (Second Life-inspired): walk a
rolling-terrain world with the arrow keys / on-screen D-pad, import glTF/OBJ models
and images, freehand-draw shapes that inflate into 3D balloons, drop glowing light
orbs, place live interactive web browser panels, and save/load the world. New visitors
land in a prebuilt Park; The Museum, The Library, The Moon, On Mars, Dinosaur Island
and Fantastic Voyage (human anatomy) are loadable from the menu. Pure client-side Three.js app — no backend, ships as a static `dist/` bundle.

## Commands

```bash
npm install
npm run dev       # Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

There is no lint or test setup in this project.

## Architecture

### Composition root

`src/main.js` is where everything is wired up: it creates the renderer/scene/camera,
then `PlayerController`, `ProgramManager`, `PlacedRegistry`, `Menu`, `PlayIconManager`,
`WebBrowserManager`, `WorldStore`, `ImportManager`, `DrawTool`, `ProgramEditor`,
`ObjectMenu`, and `TouchNav`. Boot sequence: `worldStore.rehydrateAll()` restores
whatever's in IndexedDB, and only if that leaves the registry **completely empty** does
it build the Park (`loadPresetWorld(BOOT_WORLD)`) — so a first visit gets a world, a
refresh keeps the student's own edits, and a loaded preset is never overwritten.
The animate loop ticks `registry`,
`programManager`, `playIconManager`, and `webBrowserManager`, in that order, before
`renderer.render()`.

### Units: everything is feet

`config.js`'s `EYE_HEIGHT = 5` and `MODEL_TARGET_HEIGHT = 5` are the calibration
point — the camera is a 5ft-tall person, and every imported/rehydrated model is
auto-scaled to exactly 5ft tall (see "Model scaling" below). `SPAWN_DISTANCE` and
`SPAWN_SPACING` are tuned relative to each other on purpose: the golden-angle
placement spiral's radius grows as `SPAWN_SPACING·√n`, and if that ever exceeds
`SPAWN_DISTANCE` for realistic values of n, new placements wrap around *behind* the
camera instead of fanning out in front of it. If either constant changes, re-check
this relationship.

### Terrain: a height-displaced, vertex-colored plane, retinted per theme

`SceneSetup.js` builds the ground as a subdivided `PlaneGeometry` (`TERRAIN_SEGMENTS`
per side) with each vertex's local Z displaced by `terrainHeightAt(theme, worldX, worldZ)`
before `computeVertexNormals()` — there's no separate heightmap asset or texture.
**Gotcha**: `PlaneGeometry` is authored flat in local XY; the mesh is then rotated
`-90°` about X to lay it down, which maps local Z → world Y (up) and local Y → world
`-Z`. Displacing the wrong axis (e.g. local Y) silently produces a vertical wall
instead of hills. `terrainHeightAt()` sums a few sine/cosine terms at irrational-ish
frequency ratios (deliberately not a random-per-vertex noise, which would create
seams) and multiplies by a `smoothstep` radial falloff that's exactly 0 within
`TERRAIN_FLAT_RADIUS` of the origin — this keeps the spawn point and the boot-time
library/tree/billboard on level ground regardless of the hill amplitude elsewhere.
Height-based vertex colors (dark green in valleys → lighter green on rises, via
`MeshStandardMaterial({ vertexColors: true })`) replace the old flat single-color
ground + `GridHelper` — a rigid technical grid read as visually wrong once the ground
actually has relief, so it was removed rather than kept alongside real terrain.

Nothing outside `SceneSetup.js` needed to change for this: `PlayerController` and
every placement path (`ImportManager`, `DrawTool`, `StartupAssets`, `LightOrb`) already
get ground height by raycasting straight down against the actual `ground` mesh
(`groundHeightAt`/`this.raycaster.intersectObject(this.ground)`), so they automatically
follow whatever height the mesh's real geometry has — flat or hilly.

**World themes.** Every visual property of the environment — sky/fog color, ground
relief (`amplitude`/`flatRadius`/`blendRadius`/`pockAmplitude`), ground color ramp,
hemisphere + sun color/intensity/direction, and whether the starfield is visible —
lives in `config.js`'s `WORLD_THEMES`
(`default`/`park`/`museum`/`library`/`moon`/`mars`/`dinosaur`/`voyage`).
`applyWorldTheme(name)` rewrites the ground's **existing** position/color attributes
**in place** on the **same** `BufferGeometry` and the same `Mesh` — deliberately, since
`PlayerController` and every placement path hold a reference to that mesh; swapping the
object out would strand them, whereas mutating it means they all pick up the new
terrain on their very next raycast with no notification plumbing at all. It's a no-op
when the requested theme is already live, which is what lets `WorldPresets` apply a
theme up front (to read correct ground heights) and then have that world's own
`world-theme` record re-apply it harmlessly during rehydration.

The `default` theme's numbers are exactly the old hardcoded constants, so a world with
no theme record looks precisely as it did before themes existed.

### PlacedRegistry is the hub

`PlacedRegistry` (in `PlacedRegistry.js`) is the single source of truth for every
live `Object3D` currently in the scene, regardless of kind (model/image/gif/balloon/
startup asset). `add()` tags `object3D.userData.placedId`; `resolveRoot()` walks up
from a raycast hit to find which registered id owns it (this is how `ObjectMenu`
turns a click into "which placed thing did you click"); `tick()` is called every
frame from `main.js`'s animate loop to drive per-frame updates (currently just
animated-GIF canvas redraws); `remove()`/`clear()` dispose geometry/material/texture
and call each item's `tick.dispose()`.

### Two independent persistence systems — don't conflate them

- **`WorldStore`** (`WorldStore.js`) — automatic, silent, IndexedDB-backed. Every
  placement or edit calls `onPlaced`/`persistTransform` → `worldStore.saveObject()`.
  `rehydrateAll()` runs once at boot.
- **`WorldFile`** (`WorldFile.js`) — explicit, user-triggered, portable `.json`
  export/import, reached from Load World ▸ **Save World** / **Load World File**.
  Base64-encodes any Blob file data for JSON transport.
  `WorldStore.loadFromRecords()` wipes the live world + IndexedDB and rehydrates +
  re-persists from a given record set — this is what Load World File ultimately calls.
  Keep both halves in the menu: export alone gives a student no way to open what a
  classmate sent them, and import alone gives them no way to send their own.

Both funnel through the same `record.kind` dispatch in `WorldStore.rehydrateOne()`:
`'gltf' | 'obj' | 'image' | 'gif' | 'balloon' | 'light-orb' | 'web-browser' |
'preset-prop' | 'world-theme' | 'startup-library' | 'startup-tree' |
'startup-billboard'`. gltf/obj/image/gif/balloon all carry
`files: [{name, type, data: Blob}]` (balloon's file is the painted canvas as
a PNG — geometry is *regenerated* via `BalloonInflator.inflateFromCanvas()`, never
stored); `light-orb`, `web-browser`, `preset-prop`, `world-theme`, and the three
`startup-*` kinds carry no `files` at all — a `light-orb` record is just
`{ color, transform }`, a `web-browser` record is `{ url, transform }`, and a
`preset-prop` record is `{ prop, options, transform }`, since
`LightOrb.createLightOrb(color)`, `WebBrowserManager.createPanel(record, worldStore)`
and `props/index.js`'s `buildProp(name, options)` all rebuild everything procedurally
every time, same philosophy as the balloon regenerating its geometry instead of
storing it.

`loadFromRecords()` settles the theme up front from
`records.find(r => r.kind === 'world-theme')?.theme || DEFAULT_THEME` **before**
rehydrating anything, so a world file with no theme of its own resets a leftover moon
sky back to daylight instead of inheriting it.

### Prebuilt worlds: Park / Museum / Library / Moon / Mars / Dinosaur Island / Fantastic Voyage

The menu's top level is just two expanding groups plus **Clear World**: **Load Object**
(Import / Draw / Light Orb / Web Browser — the things you put *into* a world) and
**Load World** (the worlds themselves). Both are built by `Menu.js`'s `_group()`, which
pairs a `▸`/`▾` toggle button with a `.menu-submenu` panel and registers the pair in
`this.groups`. `setGroupOpen(group, open)` walks that list and closes every group except
the one being opened, so the panel never shows two trees at once; `closeGroups()` is the
same call with `null`, which matches nothing and therefore shuts them all — that's what
collapsing the whole menu and picking any submenu item both go through.

Menu ▸ **Load World** opens a submenu (`Menu.js`, built by iterating
`WorldPresets.PRESET_WORLDS` so another world is a one-line change) listing the
ready-made worlds plus **From a file…**, which is where the original .json load lives.

**The Park is the boot world** (`config.js`'s `BOOT_WORLD`). A first visit — or any
visit where `rehydrateAll()` comes back with an empty registry — builds it via the same
`loadPresetWorld()` helper the menu uses. It then persists like any other world, so a
plain page refresh restores whatever the student actually did to it rather than
resetting their work; Load World ▸ The Park is the deliberate way back to a fresh copy.
This replaced `placeStartupAssets()`, which no longer exists — `StartupAssets.js` is now
just the three loaders, and the Park places those assets as records instead (the little
library as the nature centre, the maple as specimen trees, the Edusim image as the
welcome banner).

A preset world is *just a list of records* — the same record shape IndexedDB and a
world file already hold — handed to the existing `WorldStore.loadFromRecords()`. So
presets need no loading path of their own, and once loaded every object in them is
clickable, resizable, movable, **programmable** and saveable like anything else the
user placed. Nothing stores geometry or image bytes.

`buildPresetWorldRecords(name, { groundHeightAt })` (`WorldPresets.js`) **applies the
theme first, then reads each object's Y off the freshly reshaped terrain.** That order
is load-bearing: doing it the other way grounds every object to the *previous* world's
hills. `main.js`'s `onLoadPresetClick` then calls `player.resetTo(spawn)` — without it
a student who walked 100ft away reappears inside a wall when the world under them is
replaced.

**Everything is generated in code** — `PropKit.js` (shared helpers) plus `src/props/`
(`CommonProps` / `ParkProps` / `MuseumProps` / `LibraryProps` / `MoonProps` /
`MarsProps` / `DinoProps` / `BodyProps` / `Earth`), with `props/index.js`'s
`PROP_BUILDERS` as the name→builder table. **Those keys are
persisted**, so renaming one silently breaks every already-saved world using it; add a
new key instead. `buildProp()` throws on an unknown name rather than silently dropping
the object, so a typo in a layout surfaces immediately instead of leaving a hole.

House rules every builder follows (also stated at the top of `PropKit.js`):

- Authored directly in **feet at scale 1** — these are not user imports, so they never
  go through `ModelLoader.scaleToHeight()`. Sizes are real: the LRV is 10.2ft long, the
  LM ~20ft tall, a bookshelf 7ft, a bench seat 1.5ft.
- A builder returns a `Group` whose **origin is its base centre**, so a layout can place
  it with `position.set(x, groundHeightAt(x, z), z)` and nothing else. Anything that
  deliberately floats (Earth in the moon sky, wall-hung paintings) takes an explicit
  `y`/`absoluteY` in the layout instead of breaking the rule.
- **Materials and textures are built fresh per call, never shared between builders.**
  `PlacedRegistry.disposeObject3D()` disposes a removed object's materials/maps
  outright, so a material shared across two registry roots gets destroyed out from
  under the survivor.
- Randomness goes through `seededRandom()`, never `Math.random()` — a world rebuilt
  from its records must look identical to the one the student first saw, not reshuffle
  every bookshelf and boulder field on each rehydrate.

`mergeColored()`/`mergedMesh()` collapse many small solids into one vertex-colored
geometry (a 30-book shelf, a 40-part wire wheel, a whole arcaded wall) so the scene
stays at a few hundred draw calls. **Merging is not optional polish** — every mesh is
drawn twice (main pass + the sun's shadow map), so anything the layouts place *many* of
must be one mesh. Trees, benches and info placards were each originally 6–15 meshes;
merging them took the Park from ~1430 draw calls to ~1125. Three traps:

- **`mergeGeometries()` refuses a mix of indexed and non-indexed inputs**, and three.js
  is inconsistent about which it returns (Box/Cylinder/Sphere/Torus are indexed;
  `IcosahedronGeometry` and anything else from `PolyhedronGeometry` is not).
  `mergeColored()` drops everything to non-indexed when the batch is mixed rather than
  making every caller remember that.
- **A material with BOTH a `map` and `vertexColors` multiplies the two.** Tinting the
  vertices to the same colour the map already is squares it: the bear dens' facade came
  out near black that way. Where both are used, the vertex colours must be near-white
  brightness variation and the map supplies the colour.
- **Never jitter a non-indexed geometry per vertex index.** Each triangle owns its own
  copy of every corner, so per-index randomness moves the copies apart and the surface
  tears into loose overlapping shards — which is exactly how the puddingstone outcrops
  and the moon's boulders first looked. `PropKit.roughenSphere()` displaces by a smooth
  function of *direction* instead, so every copy of a shared corner moves identically.

**Arch geometry, in three places** (the bear dens, the park's bridge, the library's
arcaded walls): a voussoir rotated by `angle - 90°` only lies flush if the ring is a
true **circle** — give the arch an independent `rise` and the blocks splay outward like
a starburst. And the pier width between two arched openings is fixed at
`bay - 2 × archRadius`; padding the piers "so they overlap" narrows every opening while
the ring keeps its radius, leaving voussoirs apparently floating in the wall.

**Interior lighting is a shadow-map problem, not a materials problem.** three.js has no
light transmission through translucent materials, so the *only* thing deciding whether
sun reaches an interior floor is whether something above it casts a shadow. Anything
with `castShadow = false` lets the sun straight through — that's how both the museum's
skylight and the library's glazed lantern roof work. Two traps this hit in practice:

1. **A "cornice" or "roof" that is one solid box spanning the footprint caps the whole
   building.** It's invisible from inside (you're looking at the roof above it) but it
   silently cancels every bit of glazing above it. `libraryHall()` builds its cornice as
   a *ring* of four strips for exactly this reason.
2. **The glazed opening has to be generous.** Sun arrives at an angle, so a beam lands
   roughly `(height above floor) / tan(elevation)` further along — 12ft+ for a 22ft
   drop. A modest central skylight therefore throws its one patch of daylight against a
   wall and leaves the room dark. The library additionally uses a deliberately steep
   `sunPosition`, since it's the only preset with a roofed interior.

Light orbs are used as the in-world fill lighting (that's the app's own mechanism), but
`ORB_LIGHT_INTENSITY`/`ORB_LIGHT_DISTANCE` give a `decay: 2` falloff that is nearly
spent at ~12ft — hang them around 9ft indoors, not up at the ceiling, or the floor sits
at the edge of the cone. On the moon they're kept low (5–6ft) and close to hardware:
against a black sky a high orb reads as a floating ball rather than as a lamp.

The Mars dome's glazing works the same way (`castShadow = false` on the shell, the ribs
and the apex hub), but its **floor is at ground level**, unlike the museum's and the
library's raised ones. `PlayerController` walks on the terrain mesh, never on props, so
a raised interior floor puts the student's eyes below the deck they appear to be
standing on — tolerable in a gallery you look across, obvious in a room you walk into.
Mars therefore has no `MARS_FLOOR` constant: everything indoors is placed at `y = 0`.

**A big flat surface facing away from the sun is a black silhouette, not a dark
surface.** This bit three separate props in the Mars world and is worth recognising
early, because no amount of picking a lighter `color` fixes it:

- The airlock's swung-open hatch leaf — a 7ft disc has one face permanently unlit at
  every hinge angle, so it read as a black slab parked in the doorway. Deleted; the
  collar ring says "hatch" on its own.
- The relay dish — three compounding mistakes: too deep a cap (a 67° sweep is a bowl,
  and its convex back reads as a solid ball on a stick), the *north* cap (which opens
  downward, aiming the concave side at the ground), and raked so the approach saw the
  back. It now uses a shallow **south** cap tipped toward the walk-up. Note that a cap
  is authored around the sphere's pole, so the sphere centre must be offset by exactly
  the radius to put the bowl's vertex on the mount — otherwise the dish floats several
  feet clear of the mast it is bolted to.
- The life-support cabinet — an 8×7ft slab at `metalness: 0.7` has almost no diffuse
  response and, indoors under orb light, renders as a hole in the room.

Two more shape/texture traps from the same world:

- **A smoothly curved, zero-thickness surface is the worst case for shadow-map acne.**
  The dome's ring wall and airlock tube showed wavy bands right across them inside and
  out; both set `receiveShadow = false`, which costs nothing since neither has any
  thickness to shadow itself with.
- **`CircleGeometry` laid down by a −90° X rotation flips its texture's handedness** —
  the dome floor's "MUSTER" marking has to be drawn mirrored to read correctly underfoot.
- **Painted rectangles do not survive being wrapped on a cylinder.** The dust devil's
  first texture was random `fillRect` streaks; on a 40ft column they read as literal
  floating panels over the landscape. Soft-edged ellipses filled with a gradient that
  fades at both ends, plus a vertical fade over the whole sheet, is what makes it dust.
- **A shield volcano needs `baseRadius` several times its `height`.** Built to the
  proportions of a hill, `distantMountain()` came out as a sharp dark cone — the one
  silhouette Mars does not have.

`moonCrater()` and `moonRocks()` take `rimColor`/`floorColor` and `colors` options
because the Mars world reuses them: an impact is the same physics on both worlds and
only the mineral colour differs. The defaults are the original lunar greys, so every
already-saved moon world is untouched. `dustDevil()` gained `color`/`tint` for the same
reason — Dinosaur Island uses it as a volcanic smoke plume, and `moonRocks()` again as
mossy jungle boulders.

**Animals are swept tubes, not boxes.** `PropKit.taperedTube(points, radii)` sweeps a
Catmull-Rom curve with a per-control-point radius; three.js's own `TubeGeometry` is
constant-radius, which is useless here because the taper *is* the shape of a neck, a
tail or a limb. It returns an indexed geometry with real normals, so a whole animal is
a dozen tubes plus some cones going through `mergeColored()` into **one** mesh — which
is why Dinosaur Island holds 124 records at ~320 draw calls, fewer than any other
world. Two things to know when editing `DinoProps.js`:

- `scaleAbout(geometry, centre, scale)` exists because a plain `geometry.scale()` also
  multiplies position. Deepening a skull 14ft up an animal with a bare `.scale(1,1.28,1)`
  quietly relocates it to 18ft.
- The `scale` option on each animal multiplies **coordinates**, never `Object3D.scale`.
  `WorldStore.applyTransform()` replaces an object's scale from its record, so a builder
  that scaled its own Group would have that silently discarded on the next reload —
  the same trap the `startup-*` assets' `targetHeight` field exists to work around.

Three things this world got wrong first and are easy to reintroduce:

- **A closed canopy needs a much lighter `hemiGround` than an open world.** The hemi
  light is all that fills a hide standing in tree shade, and at the moon-ish `0x2c3418`
  first used here a Triceratops under a conifer read as a featureless black silhouette.
  It is now `0x57633c` at 1.45 intensity, and the animal hides were lightened too.
- **A frond that tapers to almost nothing reads as a black needle, not a leaf.** The
  shared `frond()` helper narrows to a third of its base width, never to a point, and
  builds at 6×4 segments because it gets flattened to 30% thickness and placed by the
  hundred in the ground-fern patches.
- **Bones have to clear the trench floor they lie on.** `fossilDig()`'s excavation floor
  is a slab with its top face at y≈0.27; with the spine at 0.55 the ribs swept down into
  it and disappeared, leaving a row of neural spines that read as a picket fence.

**Fantastic Voyage** is the human body, and it is the one world built around a
**deliberate split between geometry and images**: the four organs the brief named —
lungs, stomach, liver, kidneys — are walk-around 3D models, while whole *systems* are
`anatomyChart()` diagrams. That is not a shortcut. A system is a set of relationships
(what drains into what, what feeds what), and a labelled drawing carries relationships
that no amount of walking around a 3D organ can. The charts are canvas-drawn onto a
768×1024 portrait panel; `bodyOutline()` + `withBody()` give every chart the same
silhouette coordinate space, so an organ drawn at (-40, 430) lands in the same place on
every chart it appears on, and `withBody()` hands back a mapper so a label's leader line
can anchor to a body-space point from canvas space.

Everything is enlarged roughly fifteen to twenty times — a real liver is football-sized
and cannot be walked around — and **each placard states the real size**, so the
enlargement teaches instead of misleading.

Traps this world hit, several of them re-runs of earlier ones:

- **The environment is coloured AGAINST the exhibits.** Every organ here is warm, so the
  `voyage` theme is cool: teal plasma sky over a mauve-grey membrane floor. A warm
  "inside the body" sky was tried first and swallowed every model into one red mush —
  the same failure mode as the Mars props that came out as black silhouettes.
- **Translucency is a balance with two wrong ends.** The lungs' lobes are `opacity: 0.68`
  with `castShadow = false`: opaque hides the bronchial tree that is the whole reason for
  the model, and much below that the lobes stop reading as tissue and become glass bulbs
  with sticks in them. A see-through surface also loses most of its apparent colour, so
  the lobe pink is deliberately more saturated than a real lung.
- **A ring wrapped on a swept tube must take the INTERPOLATED radius at its own point on
  the curve** — the same lerp `taperedTube()` does internally, not the nearest control
  point's value. Sized from the nearest control point, the stomach's rugae down in the
  narrowing antrum hung outside the wall like loose bangles. `ringOnCurve()` exists for
  this, and bakes its orientation into the geometry with a matrix because `mergeColored()`
  only carries axis-aligned Euler rotations.
- **A helix whose rise per turn is smaller than its own tube diameter is not a coil, it
  is a stack.** The small intestine's turns merged into flat parallel sausages until the
  radius, height and depth were each given a different wobble frequency — which is also
  closer to what a real gut looks like than a clean spring is.
- **A lobed mass on a vertical stem is a tree, not a brain,** and thinning the stem does
  not fix it. The brain sits in a cut-away bone cradle that is deliberately *narrower*
  than the brain: sized to actually contain it, the bowl's rim rose above a 5ft student's
  eye line and hid the entire exhibit inside itself.
- **A dendrite that tapers to a point is a spike.** They end in a fork with a non-zero
  tip radius — the same lesson as Dinosaur Island's fronds.
- **An organelle's own half-length adds to its centre distance**, so placement radii that
  look safe on paper put the outermost mitochondria through the cell membrane.
- **A big flat panel viewed from behind is a black slab.** `anatomyChart()` puts a solid
  dark backing board behind its face for exactly this reason, and the micro-sub's name
  decals are emissive and mounted on both flanks, since one flank always faces away.
- **The walk-through artery's axis sits BELOW its own radius** (`radius * 0.45`), so the
  ground plane cuts the tube well below its centre line and leaves a wide opening at foot
  level with the vessel arching overhead. `PlayerController` walks on the terrain and
  never on props, so a tube centred at head height would put its floor underground and
  its walls in the student's face.

`cardTexture()` in `PropKit.js` now **fits the body text to whatever room the title left**
rather than drawing at a fixed 25px and letting it run off the card. How many lines a
title wraps to is not something a caller can predict from the outside, and a placard
whose last sentence is clipped is worse than one set a point smaller. `wrapLines()` was
split out of `wrapText()` to make that measurable. This is shared, so it silently
improves any over-long placard in the older worlds too.

The museum's paintings are generated **in the style of** a movement (De Stijl, Colour
Field, Post-Impressionist, Ukiyo-e, Pointillist, Geometric Abstraction) rather than
copied from a specific canvas — that's the educational point (each frame's built-in
plaque names the movement) and it means the gallery ships no third-party image files.

`main.js`'s boot check is `registry.count === 0`, **not** "no `startup-*` records came
back" — every preset world is built from `preset-prop` records, so the narrower check
would rebuild the Park on top of whichever world the student last loaded. Clearing the
world also calls `applyWorldTheme(DEFAULT_THEME)`, since the theme is carried by a
record that `registry.clear()` just removed.

**Reusing the fetched `public/` assets at preset scale** needs two optional record
fields, both handled in `WorldStore.rehydrateOne()`'s `startup-*` branch and both absent
from older records:

- `targetHeight` (feet) — because `applyTransform()` **replaces** scale wholesale, which
  silently discards the `scaleToHeight()` normalization the loaders just applied. A
  record asking for "scale 4" therefore gets four times the model's *raw authored* size,
  not four times 5ft; the maple came back hundreds of feet tall. Re-normalizing after
  the transform is self-correcting whatever scale it left behind. Layouts size these
  assets in feet via `asset(kind, x, z, { height })` and never with a scale factor.
- `baseOnGround` — where a model's pivot sits relative to its base is a property of the
  file and depends on the final scale, so the record stores the ground height and
  `ModelLoader.seatBaseAt()` drops the model's bottom onto it.

Note that sizing by *height* means a wide, low model gets a big footprint: the little
library normalized to a 15ft ridge is 45ft square, and the Edusim banner at 6ft tall is
24ft wide. Both are held smaller in the Park layout for exactly that reason.

### Startup assets always re-fetch, never store bytes

`StartupAssets.js`'s `loadLibraryModel()` / `loadTreeModel()` / `loadBillboardImage()`
always fetch fresh from their fixed `public/` URL, on first boot *and* on every
rehydrate/load — their records only ever store a transform. This is deliberate: they're
project assets, not user uploads, so duplicating their bytes into IndexedDB or a save
file would be pure waste, and it's the only way the tree's manually-applied textures
(next paragraph) survive a reload.

`public/tree/MapleTree.obj` ships with a `mtllib` reference but no matching `.mtl`
file, so `loadTreeModel()` hand-matches bark/leaf textures to hardcoded internal mesh
names (`tree_Mesh`, `leaves`, `leaves.001` — confirmed by inspecting the file, not
guessed). If that model file is ever replaced, this mapping can break silently (no
error, textures just don't apply).

### Shared loading/placement utilities — the real dedup points

- `ModelLoader.js`: `buildBatchLoadingManager()` + `loadModelFile()` is the *only*
  place glTF/OBJ loading happens — used by `ImportManager` (fresh imports),
  `WorldStore` (rehydration), and `StartupAssets`. Don't reimplement loading
  elsewhere.
- `Placement.js`: `nextPlacementXZ()` (the golden-angle spiral) and `faceCamera()`
  are shared by `ImportManager`, `DrawTool`, and `StartupAssets`.
- **Gotcha**: `Object3D.lookAt()` orients a plain object's local **+Z** toward the
  target — the opposite of `Camera.lookAt()`, which orients **-Z** toward it (three.js
  swaps the eye/target args internally for non-camera/light objects). `faceCamera()`
  targets `camera.position` directly *because of this*; targeting a point beyond the
  mesh (the original implementation) silently produces mirrored/backwards textures on
  images and balloons.

### Model-height normalization

`ModelLoader.scaleToHeight(object3D, targetHeight)` measures the current bounding-box
height via `Box3` and rescales to hit the target exactly. It's translation-invariant
and idempotent (safe to call on an already-scaled, already-positioned object), so the
same function backs both the import-time auto-scale and the object menu's "Reset to
5ft tall" action. `groundLiftFor()` computes how far to lift the model after scaling
so its *base* — not its local origin — touches the ground.

### Click-to-edit object menu

`ObjectMenu` listens for `pointerdown`/`pointerup` on the canvas and distinguishes a
tap (small movement, short duration) from `PlayerController`'s own look-drag, which
runs independently and is unaffected. On a genuine click it raycasts against
`registry.getRootObjects()`, resolves the hit via `registry.resolveRoot()`, and opens
a floating panel (Size % / Move ft / Program stub) at the click point. Edits mutate
the live object3D directly, then `persistTransform()` re-derives `record.transform`
and calls `worldStore.saveObject()`.

### Block-based object programming

Clicking **Program** in `ObjectMenu` opens `ProgramEditor`, a Scratch-style
drag-and-drop block editor. The pieces:

- `BlockDefs.js` — the schema: block type → category/color, label tokens, and param
  defaults (`repeat`/`forever`/`wait` control; `moveX/Y/Z`/`rotate` motion;
  `changeSize`/`changeColor` look). `createBlockInstance()`/`cloneBlockTree()` are the
  only ways block instances get created — always with fresh `id`s.
- `ProgramRunner.js` — a **generator-based** interpreter (`function*`). Every action
  yields once (`{type:'tick'}` or `{type:'wait', seconds}`) instead of running to
  completion, so a `forever` loop can be stepped one action per frame without ever
  blocking the main thread. **Gotcha**: `forever` yields unconditionally after each
  pass over its children, not just when they're empty — otherwise a nested `repeat 0
  times` (which yields nothing) would make the loop spin synchronously forever and
  hang the tab.
- `ProgramManager.js` — schedules one generator per running object (`Map<id,
  {generator, waitUntil}>`), stepped from `main.js`'s animate loop via `tick()`. A
  `wait` block sets `waitUntil`; the runner is skipped (not stepped) until
  `performance.now()` passes it.
- `ProgramEditor.js` — the palette + workspace UI. Drag/drop uses raw **Pointer
  Events**, not HTML5 drag-and-drop, matching every other custom-drag feature in this
  codebase. Drop targets are computed by walking the live tree and reading
  `getBoundingClientRect()` on the corresponding DOM nodes (`computeDropZones()`),
  not tracked abstractly — so the DOM is the source of truth for "where can this
  drop." Dragging a block *out of* the workspace (`onWorkspaceDragStart`) splices it
  out of the tree and re-renders *before* the drag begins; this is also what makes
  dropping a C-block onto its own descendants impossible for free — by the time a
  drop zone search runs, that subtree isn't part of the tree being searched anymore.

`WorldStore.addAndRun()` is the single funnel every rehydration path (IndexedDB
boot, Load World, startup assets) goes through, and it's what makes a saved program
resume automatically no matter how the object entered the scene — it starts the
`ProgramManager` runner if `record.program?.length` and refreshes the play icon (next
section). `ProgramEditor.save()` is the only other place a program is written; both
call `programManager.start()`, which always calls `stop()` first, so re-saving or
re-clicking play cleanly replaces any prior runner rather than stacking multiple.

### Play icon: manual (re)start for programmed objects

`PlayIcon.js`'s `PlayIconManager` shows a green ▶ `THREE.Sprite` (billboards to the
camera for free — no custom `faceCamera` needed) floating above any object whose
record has a non-empty `program`. It mirrors `ObjectMenu`'s click-vs-drag pointer
logic (`pointerdown`/`pointerup` + movement/time thresholds) so a look-drag never
misfires as a click, and raycasts only against the tracked icon sprites — never
against `registry.getRootObjects()` — so it can't intercept clicks meant for
`ObjectMenu`. Clicking a hit icon calls `programManager.start()` again, which is a
deliberate *restart*, not a resume/no-op — useful for re-running a script that has
already finished or drifted.

Icon lifecycle is driven entirely by `refresh(id, record, object3D)`, called from
`WorldStore.addAndRun()` and `ProgramEditor.save()`: it adds a sprite if the record
now has a program and didn't have an icon, removes it if the program was cleared,
and just repositions it otherwise. `tick()` (called every frame from `main.js`)
recomputes each icon's position from a fresh `Box3` of its object every frame, so it
correctly follows an object that a running program is moving/resizing. `clear()` must
be called anywhere `registry.clear()` is (Clear World, `WorldStore.loadFromRecords`)
— the two aren't linked automatically, so a new bulk-removal path that forgets this
call will leak orphaned icons.

**Gotcha**: `tryPick()` explicitly refreshes `camera.matrixWorld` and each candidate
icon's `modelViewMatrix` immediately before raycasting (`updateMatrixWorld()` +
`modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, icon.matrixWorld)`),
rather than trusting the values `tick()` last left in place. `Sprite.raycast()` reads
`modelViewMatrix`, and three.js only refreshes that as a side effect of an actual
`renderer.render()` call — `tick()`'s position update alone doesn't touch it. A click
is an async DOM event that can land between frames, so without this the raycast can
silently miss a sprite sitting right under the cursor (found via `WebBrowserPanel.js`'s
identical edit-icon sprite, which shares this exact click-to-open pattern — see that
file's notes for the full story, including a second, unrelated bug this same testing
surfaced).

### Light orbs: a Group, not a special case

`LightOrb.js`'s `createLightOrb(color)` returns a plain `THREE.Group` containing a
small emissive core mesh, a larger backside-only translucent "halo" mesh (a cheap
fake-bloom trick — no post-processing pipeline in this app), and a real
`THREE.PointLight` — all as children. Because it's a normal `Group` used as the
object3D everywhere else expects one, Size/Move/Program, `PlacedRegistry`'s raycast
picking (`resolveRoot()` walks up to whichever ancestor has `userData.placedId`, which
`registry.add()` sets on the group), and `PlayIconManager`'s `Box3`-from-object all
work on it with zero special-casing. `castShadow` is deliberately left off the light
(and the light has no shadow map to dispose) so placing many orbs stays cheap.

`ColorTint.js`'s `applyColorTint(object3D, hex)` is shared by the "change color to"
program block and `ObjectMenu`'s light-orb-only **Color** action, so both paths stay
in sync. **Gotcha**: it only touches a mesh's `material.emissive` when
`node.userData.isGlowMesh` is set (which only the orb's core/halo meshes have) —
`MeshStandardMaterial.emissive` defaults to black but always *exists*, so blindly
setting it on every tinted mesh would make an ordinary "change color to" on a tree or
balloon make it start glowing, which is not what that block means for non-glow
objects. It also updates `node.color` for any `isLight` child, which is what makes an
orb's actual cast light track its visible color.

`PALETTE_SWATCHES` in `config.js` is the one shared color list — `DrawTool`'s swatch
row, the `changeColor` block's default, and light-orb placement (which cycles through
it by `registry.count % length` for a new color each click) all read from it, instead
of three independently-guessed color arrays that would drift out of sync over time.

### Web browser panels: a second renderer, not a WebGL texture

There is no way to pipe a live, interactive `<iframe>` into a WebGL texture — no
browser API lets you rasterize cross-origin iframe content into a canvas (that would
be a security hole), and even same-origin content has no `captureStream()`-style
continuous-capture path. `WebBrowserPanel.js`'s `WebBrowserManager` uses
`CSS3DRenderer` (`three/examples/jsm/renderers/CSS3DRenderer.js`) instead: a *second*
renderer that positions real DOM elements with CSS 3D transforms, sharing the same
`camera` object as the main `WebGLRenderer` so the two layers' perspective stays in
sync every frame (`cssRenderer.render(cssScene, camera)` right alongside
`renderer.render(scene, camera)` in `main.js`'s animate loop).

Each panel is really two synchronized objects, split deliberately so the *existing*
placement/picking/persistence machinery needs zero special-casing:

- A normal WebGL **bezel mesh** (`PlaneGeometry` + `MeshStandardMaterial`) — this is
  the thing registered with `PlacedRegistry`, raycast-picked by `ObjectMenu`, and
  whose `record.transform` is what actually persists. Size/Move/Program all just work
  on it like any other placed object.
- A **`CSS3DObject`** wrapping a real `<iframe>` (plus an address-bar toolbar div),
  which `WebBrowserManager.tick()` makes follow the bezel's position/quaternion/scale
  every frame. **Gotcha**: since every placed object in this app is parented directly
  to `scene` (no nested transforms anywhere), a mesh's own `.position`/`.quaternion`/
  `.scale` *are* its effective world transform — the sync code copies those directly
  rather than reading `matrixWorld`, which avoids a real staleness bug (`matrixWorld`
  is only recomputed during a render traversal, so reading it immediately after a
  synchronous ObjectMenu edit would lag a frame).
- The DOM element is authored at a fixed pixel size (`WEB_BROWSER_DOM_WIDTH/HEIGHT`)
  for crisp text, then the `CSS3DObject` is scaled by `WEB_BROWSER_WIDTH /
  WEB_BROWSER_DOM_WIDTH` (a pixels→feet conversion) so it matches the bezel's real
  size in world units, and by the bezel's own `.scale` on top of that — so a
  Size-menu resize (or a Program's `changeSize` block) visibly resizes the iframe too.

**Known limitation, accepted rather than solved**: CSS3D content always renders *on
top of* the WebGL canvas — there's no per-pixel depth-buffer occlusion against other
3D geometry (that would need a stencil-mask trick well beyond this feature's scope).
`.wb-panel` does set `backface-visibility: hidden` so walking behind a panel makes it
disappear rather than showing its content mirrored, which is the one occlusion case
cheap enough to fix directly.

**Real-world content is out of this app's control**: many sites (Google, YouTube,
Facebook, X, most banks/SaaS) send `X-Frame-Options`/CSP `frame-ancestors` headers
that block being framed at all — there is no client-side workaround (a server-side
proxy would fix it but contradicts this project's no-backend design), and JS cannot
reliably detect the block from the parent page (a blocked frame just shows the
browser's own blank/error page inside the iframe, with no readable signal — accessing
`iframe.contentWindow.location`/`contentDocument` throws/returns null for *any*
successfully-navigated cross-origin frame, blocked or not, so that isn't a usable
signal either). `WEB_BROWSER_DEFAULT_URL` defaults to Wikipedia specifically because
it's known to allow framing; the panel's own persistent `.wb-hint` text is the honest
way of surfacing this constraint to the user instead of pretending to detect it.

**Gotcha this feature exposed in existing code**: `PlayerController.onKeyDown`
unconditionally captured `ArrowUp/Down/Left/Right` (`preventDefault()` + added to the
movement `keys` set) regardless of what had focus. That was latent but low-impact
before — every existing text input lives inside a full-screen modal where camera
movement doesn't matter. A web browser panel's always-visible, non-modal address bar
made it a real, disruptive bug (typing a URL with arrow-key cursor movement would also
spin/walk the avatar), so `onKeyDown` now early-returns via `isEditableTarget(e.target)`
(`INPUT`/`TEXTAREA`/`contentEditable`) before touching arrow keys at all.

Pointer-event coordination: `WebBrowserManager` sets every panel's `pointer-events` to
`none` for the duration of any canvas-originated mouse/touch-down (restored on
`pointerup`) — without this, a look-drag that started on the canvas and swept over a
panel would get "eaten," since mouse events occurring inside a cross-document iframe
never bubble to the parent window's listeners at all, so `PlayerController`'s
`window`-level `mouseup` would never fire and the drag would appear stuck.

**A floating edit icon for Size/Move/Program**: every mouse action on a panel goes to
the web page itself (left-click follows links, right-click opens the page's own
context menu, scroll scrolls the page) — `ObjectMenu`'s normal canvas-raycast
click-to-open path can never fire for a panel, since the CSS3D layer always sits on
top and consumes the click first, and deliberately intercepting any of those clicks
would break normal browsing. Instead, `createPanel()` also creates a small WebGL
`THREE.Sprite` ("edit" badge, blue pencil glyph on a canvas-drawn texture, visually
distinct from `PlayIcon.js`'s green ▶) floating `EDIT_ICON_MARGIN` feet above the
panel's bounding-box top — same billboard-sprite-hovering-above-the-object pattern as
the play icon, and for the same reason: a WebGL object floating *above* the CSS3D
panel's screen-space rect is never covered by it, so it's reachable by an ordinary
canvas click regardless of what the panel/iframe underneath is doing.

`WebBrowserManager` runs its own click-vs-drag detection for this icon (`downPos`/
`downTime` + the same movement/time thresholds `ObjectMenu` and `PlayIconManager`
each already use independently) on the *same* canvas `pointerdown` / window
`pointerup` pair that also drives the drag-suspend logic below — a genuine click (not
a look-drag) raycasts only against the tracked edit-icon sprites and, on a hit, calls
an `onEditClick(id, clientX, clientY)` callback wired in `main.js` to
`objectMenu.open(...)` (passed in as a closure over `objectMenu`, which is
constructed *after* `WebBrowserManager` — safe because the callback only ever runs on
a later click, well past full construction, same pattern as `menu`'s own button
callbacks referencing `worldStore`).

**Two gotchas found via real click testing (not caught by calling internal methods
directly — see below):**

1. **Competing click-arbitration systems race on the same event.** `ObjectMenu` also
   registers its own independent `pointerdown`/`pointerup` pair on this same
   canvas/window, and is constructed *after* `WebBrowserManager` — so on any click
   that reaches the canvas, `WebBrowserManager`'s `pointerup` listener runs first,
   then `ObjectMenu`'s runs second, in the same event dispatch. A click on the edit
   icon *does* reach the canvas (the icon floats in otherwise-empty screen space
   above the panel), so `ObjectMenu`'s own raycast fires for it too — finds nothing
   there, and calls `close()` right after `WebBrowserManager`'s handler just opened
   the menu, silently undoing it before the user ever sees it. `tryPickEditIcon()`
   calls `e.stopImmediatePropagation()` immediately after a confirmed icon hit
   (before invoking `onEditClick`) specifically to stop `ObjectMenu`'s
   later-registered listener from running at all for that event. It's a narrow,
   conditional call — only on an actual hit — so every other click (ground, other
   objects, misses) reaches `ObjectMenu` exactly as before.
2. **`Sprite.raycast()` depends on `modelViewMatrix`, which three.js only refreshes
   as a side effect of an actual `renderer.render()` call** — repositioning a sprite
   (or moving the camera) via `tick()` alone does *not* update it. A click is an
   async DOM event that can land between animation frames with no render in
   between, so a raycast immediately after a `tick()`-only reposition can silently
   miss a sprite that's visually right under the cursor. Both `tryPickEditIcon()`
   here and `PlayIconManager.tryPick()` now explicitly call
   `camera.updateMatrixWorld()` + `icon.updateMatrixWorld(true)` +
   `icon.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse,
   icon.matrixWorld)` for every candidate icon immediately before raycasting,
   rather than relying on an incidentally-recent render to have already done it.

Both of these were invisible to earlier verification that called `tryPickEditIcon()`
directly with a hand-built event object — that bypasses the real
`pointerdown`→`pointerup` pipeline entirely, so neither the competing-listener race
nor the stale-matrix raycast miss can occur in that harness. They only showed up once
tested with real `PointerEvent`s dispatched through the actual DOM (and even then,
dispatching directly on `window` instead of `canvas` produces `event.target ===
window`, not a real hit-tested target — a synthetic-event artifact distinct from
both bugs above, worth remembering if this code needs re-testing this way again.

**Gotcha, and why the bezel is explicitly excluded from `ObjectMenu`'s raycast**: the
first version of this relied *only* on the CSS3D DOM layer occluding clicks from ever
reaching the canvas over a panel — reasonable in principle, but `<iframe>` +
`transform: matrix3d()` hit-testing has known cross-browser inconsistencies (iframes
are commonly promoted to their own compositor layer, and some browsers' hit-testing
for that layer doesn't perfectly track the CSS 3D transform the way painting does).
That gap showed up in practice as ordinary clicks on a panel sometimes still reaching
the canvas and raycasting straight into the bezel mesh underneath, popping the object
menu instead of browsing. The fix isn't a better occlusion trick — it's removing the
dependency on occlusion entirely: `ObjectMenu.tryPick()` filters
`registry.getRootObjects()` down to `obj => !obj.userData.isWebBrowser` (the flag
`createPanel()` already sets on the bezel) before raycasting. A web-browser bezel is
now *never* pickable through the generic path, full stop, regardless of what the DOM
layer does or doesn't intercept — Size/Move/Program for a panel is reachable only
through its edit icon, by construction, not by convention.

### VR: WebXR when there's a headset, fullscreen side-by-side when there isn't

Menu ▸ **VR Headset View** (`VRView.js`) has two paths behind one button, picked at
click time by `navigator.xr.isSessionSupported('immersive-vr')`:

- **`'xr'`** — a real immersive session. The headset does its own per-eye projection,
  lens distortion and 6DoF tracking. This is the path a Quest browsing to the page takes.
- **`'stereo'`** — `StereoEffect` side-by-side in fullscreen, plus hand-rolled
  `deviceorientation` head-look. This is what a phone in a Cardboard-style holder needs,
  and it's the only way a student on a plain laptop sees what the stereo view is at all.

**ArrayCamera was considered and is deliberately not used directly**: `WebXRManager`
already builds and drives one internally for the XR path, so hand-rolling it would mean
reimplementing the pose plumbing that `renderer.xr` gives for free — and it would do
nothing for the phone case.

**Neither path touches `PlayerController` or the app camera.** Both drive a *separate*
camera that reads the player's state each frame:

- XR uses a `dolly` Group with its own `xrCamera` child. `WebXRManager` overwrites the
  transform of whatever camera it's handed (`updateUserCamera`), so handing it the real
  camera would fight `PlayerController` for control every frame. Instead the dolly is
  positioned from `camera.position` and `player.yaw`, and the headset pose is applied
  on top — walking with the arrow keys and leaning in the room both work, and neither
  knows about the other. The dolly sits at the player's **feet** (`y - EYE_HEIGHT`)
  because `local-floor` measures head height from the floor.
- Stereo uses a proxy `viewCamera`, for the same reason: `PlayerController` owns
  `camera.rotation` and overwrites anything written there on its next `update()`.

**The units trap, and it is a big one.** One world unit here is a **foot**; WebXR
reference spaces and `THREE.StereoCamera` both work in **metres**. So:

- `dolly.scale` is `3.280839895`. `WebXRManager` computes the eye transform as
  `dolly.matrixWorld × pose`, so scaling the dolly is what converts the pose's metres to
  feet. Without it a 1.7m-tall person is 1.7ft tall and the world renders 3.28×
  oversized around them.
- `setEyeSeparation` is `0.064 × 3.28 = 0.21`, not `StereoCamera`'s default `0.064`,
  which in feet is two thirds of an *inch* between the eyes. Measured against the real
  projection matrices, the correction takes the near-to-infinity parallax range from
  ~11px to ~36px per eye — the difference between a flat picture and actual depth.

Three smaller things worth keeping:

- **`main.js` uses `renderer.setAnimationLoop(animate)`, not `requestAnimationFrame`.**
  Inside an XR session frames have to come from the device's loop with that frame's pose
  attached; `setAnimationLoop` swaps the two over and is plain rAF otherwise.
- **`StereoEffect.render()` leaves the viewport and scissor set to the right-eye half
  and never restores them.** `VRView.exit()` resets both explicitly — without it the flat
  view comes back squeezed into the right-hand side of the canvas.
- **`body.vr-active` hides every DOM overlay** (`#css3d-layer`, `#menu`, `#touch-nav`,
  `#object-menu`). The web browser panels matter most: CSS3D draws real DOM over the
  canvas as ONE flat image, so in a split view it would straddle both eyes at once.
  Toasts stay, moved to the top — they're how "press Esc to come back" is delivered.
  `#menu` stays hidden too, and `VRMenu`'s in-scene panel replaces it (below) — the DOM
  menu is not merely inconvenient in VR, it is unrenderable.

Exit is reachable three ways and they all converge on the same cleanup: the menu button
(now labelled *Exit VR Headset View*), `Esc`, and the headset's own menu button, which
fires the session's `end` event without going through the menu at all — hence
`onNotice({type:'exited'})` calling back into `menu.setVRActive(false)`.

**The menu inside VR is a 3D object, and it has to be** (`VRMenu.js`). Un-hiding `#menu`
achieves nothing: in an `immersive-vr` session the headset displays only what the WebGL
renderer draws into the XR framebuffer, and HTML is never composited into it (WebXR's
`dom-overlay` exists but is specified for immersive-**AR** on handheld devices). In the
stereo path the DOM *is* visible — drawn ONCE, flat, straddling both eye halves, which in
a Cardboard holder is doubled and unfocusable. One panel in the scene fixes both at once,
because the headset projects it per-eye and `StereoEffect` draws it twice with correct
parallax for free.

`main.js` extracts every menu action into one `menuActions` object keyed by the row ids
`VRMenu` emits, so the DOM menu and the in-scene panel run literally the same code.
Rows that need a file picker, a 2D modal or a CSS3D panel (Import / Draw / Web Browser /
Save World / Load World File) are marked `leavesVR` and drop out of VR before running —
a real answer, where a greyed-out button is not. Everything else (all seven worlds,
Light Orb, Clear World, Exit) runs without leaving the headset.

Five things this got wrong first, four of them only visible once actually driven:

- **`rotation.y` must be the bearing FROM the player TO the panel, with no half turn.**
  Adding `Math.PI` — the instinctive "turn it round to face me" — aims the face directly
  away, and with a `FrontSide` material the panel then renders as *nothing at all*:
  present, correctly placed, in the scene, and completely invisible.
- **A body-locked panel welded to `player.yaw` can never be reached by gaze.** On
  anything without head tracking the view direction *is* the yaw, so a panel held at a
  fixed offset from it sits permanently beside the crosshair. Hence `FOLLOW_DEAD_ANGLE`:
  the panel only starts following after ~31° of turn, which is what lets a student look
  at it while it stays still.
- **The header is pinned to the horizon, and the offset must stay smaller than half the
  header's own height.** Pinning the panel's *top edge* left the collapsed tab ~10° up;
  even a 0.25ft lift missed, because a 0.32ft tab at 4.6ft only spans ±2° while that lift
  is 3.1°. The header is deliberately chunky for the same reason — it is the one target a
  student must find before anything else is reachable.
- **A resized canvas needs a NEW `CanvasTexture`, not `needsUpdate` on the old one.**
  three allocates immutable GPU storage at first upload, so a re-upload at a different
  size is silently dropped and the panel keeps showing the previous drawing stretched
  over the new quad — which looks exactly like the menu having failed to open.
- **VR offsets have to be far smaller than the flat UI's.** Split side-by-side, each eye
  gets roughly 32° either side of centre, so the flat menu's "up in the corner" placement
  (~24° left, ~18° up) put the panel off the edge of the frame entirely.

**Two teardown races that only exist because the animate loop never stops.** `exit()`
awaits `session.end()` and `exitFullscreen()`, and `render()` keeps being called straight
through both — so `this.mode` is cleared FIRST, before any await, rather than last.
Separately, `updateMenu()` can itself *end the session* (a dwell or trigger landing on
Exit runs `exit()` synchronously as far as its first await), so both render branches
re-read `this.mode` immediately after calling it and return `false` to hand that frame
back to `main.js` for the flat view.

**Gaze-dwell is gated on there being no `tracked-pointer` input source.** With
controllers in hand, letting the panel also fire on a timer wherever the student happened
to be *looking* would select things they never chose. The trigger arbitrates the other
way: `onSelectStart()` gives the menu first refusal, and only starts a look-drag if the
ray missed — otherwise pressing a menu item would also start swinging the world around.

**Testing gotcha:** a three.js XR controller has `matrixAutoUpdate = false` (the pose is
written straight into `.matrix`), so posing one by hand for a test needs
`.matrix.compose(...)` — setting `.position`/`.quaternion` alone does nothing and the
ray silently misses. The real pose path is unaffected: `WebXRManager` decomposes into
`.position`/`.quaternion` itself, which is why `controllerYaw()` can read `.quaternion`.

**Controllers: trigger-drag to turn, thumbstick to walk.** Both controllers are parented
to the **dolly**, not to the scene — `WebXRManager` writes the raw pose into each one's
local matrix, so a controller under the dolly is carried along as the player walks and
turns for free, and its local transform stays in metres for the dolly's scale to
convert (the ray line each one carries is therefore authored 1 unit long, ≈3.3ft in the
world). Neither input touches the camera: the trigger drag writes `player.yaw` and the
thumbstick calls `player.setAnalogMove(forward, strafe)`, so terrain following and the
world-bound clamp keep applying, and the arrow keys keep working at the same time.

- **Read the controller's yaw in the DOLLY's frame, never in world space.** `player.yaw`
  rotates the dolly, and the controller is a child of it — so a world-space yaw contains
  the player's own yaw, and feeding its delta back into `player.yaw` is a positive
  feedback loop that spins the world up like a flywheel the moment the trigger is held.
  `controller.quaternion` is local, which is exactly the measurement that can't do this.
- **Only yaw is applied.** Pitching the rig from a controller tilts the horizon under
  someone wearing a headset, which is a well-known way to make them ill — and looking up
  and down is what the headset's own tracking already does. This is deliberate, not an
  omission: `render()`'s dolly only ever takes `rotation.y`.
- **The yaw delta has to be wrapped to ±π.** Swinging across the ±180° seam otherwise
  reads as a 350° flick the other way.
- **`three` decomposes the pose into `targetRay.rotation` (an Euler), not the
  quaternion** — that works only because `Euler` also has `setFromRotationMatrix` and
  its `onChange` syncs `Object3D.quaternion`. Reading `.quaternion` is safe; assuming
  the Euler's *order* is not, so `controllerYaw()` extracts through a `'YXZ'` Euler of
  its own.
- **Sticks are read from `session.inputSources` every frame, not cached on connect.** A
  controller can wake, sleep or change hands mid-session.
- **xr-standard puts the touchpad on axes 0/1 and the thumbstick on axes 2/3**, and a
  controller may report either or both — whichever pair is actually deflected wins, so
  older touchpad-only hardware still walks.
- **A deadzone is not optional, and it has to rescale from its own edge.** Sticks rest
  slightly off centre and drift as they wear, so a raw reading is never reliably zero;
  returning the raw value past the threshold makes a barely-nudged stick jump straight
  to a fifth of full walking speed.
- **`releaseControllers()` runs on both exit paths** (`exit()` and the session's own
  `end` event). Leaving VR with a stick held or a trigger down otherwise strands the
  player walking forever in the flat view, where nothing is feeding those values any
  more.

### Touch input is fully decoupled from PlayerController

`TouchNav.js` never touches `PlayerController` directly — it dispatches synthetic
`KeyboardEvent('keydown'/'keyup', { code: 'Arrow...' })` on `window`, identical to
what a physical keyboard produces, which `PlayerController`'s existing listeners pick
up unmodified. **Gotcha**: `Element.setPointerCapture()` throws `NotFoundError` for
any pointerId the browser doesn't consider "active" (reliably happens with
programmatic multi-touch) — it's wrapped in try/catch so a capture failure can never
block the key dispatch; `pointerleave` is the release fallback for when capture isn't
available.

**Look, though, is `PlayerController`'s own job, and it is Pointer Events — not mouse
events.** A browser only synthesises compatibility mouse events for a *tap*; a drag
produces `pointermove`/`touchmove` and nothing else. So a `mousemove`-based look
simply did not exist on a phone or tablet, and touch users could only turn with the
D-pad. `PlayerController` now listens for `pointerdown`/`pointermove`/`pointerup`/
`pointercancel`, which covers mouse, finger and stylus in one handler set (and matches
how every other custom drag in this codebase is built). Four things it depends on:

- **`#scene` sets `touch-action: none`.** Left on `auto`, the browser claims the
  gesture as a pan/zoom a few pixels in and fires `pointercancel` — the look starts and
  then dies mid-drag, which is a far more confusing failure than not working at all.
- **The active look pointer is held by *id*, not as a boolean.** A second finger
  landing (on the D-pad, or a pinch) must not hijack the look another finger started,
  and must not end it on its own `pointerup` — which a `dragging = true/false` flag
  cannot express. Walking with one thumb while looking with the other is the whole
  point of doing this on a tablet.
- **`pointercancel` is bound to the same handler as `pointerup`.** The browser takes a
  touch away without a `pointerup` (a system gesture, an incoming call), and a look
  left attached to a finger that no longer exists then follows the next unrelated
  `pointermove`.
- **Touch gets its own, larger `TOUCH_LOOK_SENSITIVITY`.** A handset screen is a few
  hundred pixels wide where a mouse has a whole desktop display, so at the mouse's
  radians-per-pixel a full swipe turns the view by well under 45°.

Click-vs-drag arbitration elsewhere (`ObjectMenu`, `PlayIconManager`,
`WebBrowserManager`) needed no changes and must not grow any: each already runs its own
movement/time threshold over this same pointer stream, so a tap still opens an object's
menu and a drag across that same object looks around instead.

### Balloon inflation is a custom heightfield sampled from the actual painting

`DrawTool` is a real multi-stroke paint canvas (adjustable brush size, multiple
colors, strokes accumulate — nothing clears until the user hits Clear).
`BalloonInflator.inflateFromCanvas(canvas)` rasterizes the *painted pixels*
(alpha > threshold within the tight bounding box of paint) onto a grid — deliberately
not `THREE.ShapeGeometry`, whose ear-clipping triangulation only ever uses a polygon's
own boundary points as vertices (no interior samples), and not a point-in-polygon test
against a single closed outline either, since a real painting is rarely one clean
closed stroke. A multi-source BFS from every grid cell touching unpainted space (the
"rim") gives each inside cell its grid-step distance inward, driving both the puffy
sqrt-falloff height (rim = 0, same front/back-meet-at-zero trick as before, so no
separate stitching pass) and generalizing for free to concave blobs / multiple
disconnected strokes. The mesh is UV-mapped and textured with a `CanvasTexture`
cropped to that bounding box — via `MeshStandardMaterial.map`, not a flat `color` —
which is *why* multiple brush colors actually show up on the result.

**Gotcha (found via testing, easy to reintroduce)**: the grid-quad triangle winding
must be `(a, d, b)` / `(b, d, e)`, not the more "obvious" `(a, b, d)` / `(b, e, d)` —
the latter is clockwise as seen from +Z given this code's axis mapping (`x` from the
column index, `y` = `-`row index), so `computeVertexNormals()` produces normals
pointing *away* from the camera. `side: THREE.DoubleSide` still renders it (nothing
gets culled), but `MeshStandardMaterial` lights it as if it were facing away —
reads as an almost-black surface, not a missing/invisible one. If the balloon ever
renders dark again, check this first: print the position/normal at the max-Z (peak)
vertex and confirm the normal is `~[0,0,1]`, not `[0,0,-1]`.

Persistence: balloon records store the painted canvas as a PNG in `files` (same shape
as image/gif records) rather than points+color — `WorldStore` rehydration decodes it
back to a canvas and calls `inflateFromCanvas()` again, so the mesh (and its winding
gotcha above) is always regenerated fresh, never stored as geometry.

### UI stacking: toasts must outrank every modal

`#toast-host` is `z-index: 50` — deliberately higher than every overlay in the app
(`#css3d-layer`=5, menu=10, touch-nav=15, Draw=30, object-menu=25, Program=35/36, drag
ghost=40). `#css3d-layer` sits just above the plain canvas but below all of the app's
own UI chrome, so a web browser panel's projected screen position can never cover the
Menu/toast/an open modal. Several flows show an error
toast *without* closing the modal that triggered it (e.g. `DrawTool.finish()`'s "paint
a bigger shape first" when the canvas is empty) — if a toast's z-index ever drops
below a modal's again, that toast silently renders behind the modal's background and
the user never sees why their action failed. `ObjectMenu.positionAt()` also clamps its
on-screen position synchronously (not via a deferred `requestAnimationFrame`) for the
same class of reason: the panel is already laid out by the time it runs, so measuring
a frame later just adds a visible jump when opening near a screen edge.

### Build/tooling notes

- `vite.config.js`'s `optimizeDeps.include` must list `three` alongside the specific
  `three/examples/jsm/loaders/*.js`, `renderers/*.js` and `utils/*.js` paths in use —
  omitting this produces a "multiple instances of three.js" runtime warning, because
  Vite's dev-time pre-bundling otherwise treats the deep-imported files as a separate
  module graph from the bare `three` import. `CSS3DRenderer.js` was added here when the
  web browser panel was built, `BufferGeometryUtils.js` when the preset worlds started
  merging geometry, and `effects/StereoEffect.js` for the VR view.
- Vite only serves `public/` verbatim over HTTP. Anything that needs to be
  `fetch()`-able at runtime by a fixed URL (the startup assets) must live under
  `public/`, not the project root.
- `main.js` exposes `window.__debug` (camera, player, renderer, scene, THREE, menu,
  registry, importManager, drawTool, worldStore, objectMenu, touchNav, programManager,
  programEditor, playIconManager, webBrowserManager) gated behind `import.meta.env.DEV`
  and stripped from production builds — useful for console-driven testing during
  development.
