# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Edusim: Web Edition is a single-user, browser-based 3D sandbox (Second Life-inspired): walk a
rolling-terrain world with the arrow keys / on-screen D-pad, import glTF/OBJ models
and images, freehand-draw shapes that inflate into 3D balloons, build your own models
out of stretchable primitives, drop glowing light
orbs, place live interactive web browser panels, and save/load the world. New visitors
land in a prebuilt Park; The Museum, The Library, The Moon, On Mars, Dinosaur Island
and Fantastic Voyage (human anatomy) are loadable from the menu. One more world —
1940's New York — is deliberately **not** in the menu and is reached only by clicking a
billboard behind the library building. Pure client-side Three.js app — no backend, ships as a static `dist/` bundle.

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
`WebBrowserManager`, `ConstructionManager`, `WorldStore`, `ImportManager`, `DrawTool`,
`ProgramEditor`, `ObjectMenu`, `BuildGizmo`, `PrimitiveMenu`, and `TouchNav`.
`ConstructionManager` sits **before** `PlayIconManager` and `ObjectMenu` on purpose — see
the Create Model notes for why that ordering is load-bearing. Boot sequence: `worldStore.rehydrateAll()` restores
whatever's in IndexedDB, and only if that leaves the registry **completely empty** does
it build the Park (`loadPresetWorld(BOOT_WORLD)`) — so a first visit gets a world, a
refresh keeps the student's own edits, and a loaded preset is never overwritten.
The animate loop ticks `registry`,
`programManager`, `playIconManager`, `webBrowserManager`, `constructionManager` and
`buildGizmo`, in that order, before `renderer.render()`.

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

**`config.js`'s `DB_NAME` is still `'3dcoder-world'` and must stay that way.** The project
was renamed to Edusim everywhere a person can see it — the tab title, the world-file
downloads, the error messages — but that string is the IndexedDB database every student's
saved work lives in. Renaming it migrates nothing; it silently opens a new empty database
and every world anyone has built disappears. The same goes for the `startup-*` and
`preset-prop` record kinds and the prop-builder keys: they are persisted, not cosmetic.

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
'preset-prop' | 'primitive' | 'built-model' | 'world-theme' | 'startup-library' |
'startup-tree' | 'startup-billboard'`. gltf/obj/image/gif/balloon all carry
`files: [{name, type, data: Blob}]` (balloon's file is the painted canvas as
a PNG — geometry is *regenerated* via `BalloonInflator.inflateFromCanvas()`, never
stored); `light-orb`, `web-browser`, `preset-prop`, `world-theme`, and the three
`startup-*` kinds carry no `files` at all — a `light-orb` record is just
`{ color, transform }`, a `web-browser` record is `{ url, transform }`, and a
`preset-prop` record is `{ prop, options, transform }`, since
`LightOrb.createLightOrb(color)`, `WebBrowserManager.createPanel(record, worldStore)`
and `props/index.js`'s `buildProp(name, options)` all rebuild everything procedurally
every time, same philosophy as the balloon regenerating its geometry instead of
storing it. Create Model's `primitive`/`built-model` sit in between: they rebuild their
geometry from named parameters like the above, and carry `files` **only** when the student
has applied an uploaded image to a surface.

`loadFromRecords()` settles the theme up front from
`records.find(r => r.kind === 'world-theme')?.theme || DEFAULT_THEME` **before**
rehydrating anything, so a world file with no theme of its own resets a leftover moon
sky back to daylight instead of inheriting it.

### Prebuilt worlds: Park / Museum / Library / Moon / Mars / Dinosaur Island / Fantastic Voyage / Empty / (New York)

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
just the three loaders, and the Park places two of those assets as records (the maple as
specimen trees, the Edusim image as the welcome banner).

**The Park no longer uses `startup-library` at all.** The downloaded little-library
`.obj` stood in as the nature centre and was the wrong object for the job twice over: it
is a street-corner book box, so blown up to a 12ft ridge it read as a garden shed with a
glass front rather than a building anyone could enter, and because these assets are
sized by *height*, that 12ft gave it a ~36ft-square footprint it did not visually earn.
`ParkProps.natureCentre()` replaces it — long, low, deep-eaved, with a porch that reads
as an entrance from across the lawn — and drops one fetch from every load of this world.
The loader and the `startup-library` record kind both stay: worlds saved before this
still carry those records, and `WorldStore` must keep rehydrating them.

Two things that building caught, both general:

- **A window has to sit on the OUTER face of a wall.** These buildings have no interior —
  the walls are solid boxes — so a pane placed at the instinctive "inner face"
  (`width / 2 - wall`) is sealed inside the timber and can never be seen from anywhere a
  student can stand. Only the doorway is different, because it is a real opening.
- **Glazing a whole door opening as one sheet is always wrong.** A 7ft × 7ft pane of lit
  glass has no features, so it reads as a blank illuminated board, not a way in. What
  makes it a door is the divisions — a dark reveal behind it, a transom, a centre
  mullion, rails at handle height — and the glass has to be dimmer than instinct says,
  since it sits in permanent shade under the porch.

A preset world is *just a list of records* — the same record shape IndexedDB and a
world file already hold — handed to the existing `WorldStore.loadFromRecords()`. So
presets need no loading path of their own, and once loaded every object in them is
clickable, resizable, movable, **programmable** and saveable like anything else the
user placed. Nothing stores geometry or image bytes.

**Every world except the Empty World puts a live web browser panel by its spawn point**,
via `WorldPresets.browserStation()`. It emits **two** records, not one: the panel (a
`web-browser`, carrying nothing but its URL) and a `browser-kiosk` prop under it. They
stay separate objects deliberately — a browser panel is one bezel mesh that the whole
Size/Move/Program and persistence machinery already understands, and folding scenery into
it would mean every one of those paths growing a special case for this one kind. The
price is that resizing the panel does not resize its stand, which is the right trade.
Two placement details:

- `rotY` is `atan2(dx, dz)`, not `atan2(dz, dx)` — a plain `Object3D`'s **+Z** is its
  facing direction, and the bezel's `PlaneGeometry` is authored in XY looking down +Z.
- Each station sits about **10ft ahead of the spawn and 8ft to one side**, ~39° off the
  arrival sightline. The first pass used ~11ft to the side and 3ft ahead, which is 75°
  off — outside the frame on any screen, so a student arrived with the panel behind their
  shoulder. Note the camera's `fov: 70` is **vertical**; a 16:9 screen actually sees about
  51° either side, which is what makes 39° comfortable rather than marginal.

**The Empty World is the deliberate exception to almost everything above.** No buildings,
no placards, no activity boards and no browser station: it exists so Create Model has
somewhere with an empty horizon, and every one of those would be an obstacle to walk round
while building. It runs the `default` theme — the one whose numbers are exactly the old
pre-theme constants — and holds nothing but five of the Park's own trees. They are not
decoration either: a genuinely featureless plane has no landmarks, so walking any distance
across it stops registering as movement, and nothing else gives the ground a sense of
scale. Their positions are randomised with `Math.random()` at **build** time and then baked
into records, which is why that is safe here and is not safe inside a prop builder — a
fresh load gives a different field, a reload of a saved one gives back exactly the field
the student left. The bearings are an even sweep with jitter rather than five free
draws: independent bearings leave a 3% chance of all five landing behind the student, who
then arrives facing the emptiest possible view of an already empty world.

`buildPresetWorldRecords(name, { groundHeightAt })` (`WorldPresets.js`) **applies the
theme first, then reads each object's Y off the freshly reshaped terrain.** That order
is load-bearing: doing it the other way grounds every object to the *previous* world's
hills. `main.js`'s `onLoadPresetClick` then calls `player.resetTo(spawn)` — without it
a student who walked 100ft away reappears inside a wall when the world under them is
replaced.

**Everything is generated in code** — `PropKit.js` (shared helpers) plus `src/props/`
(`CommonProps` / `ParkProps` / `MuseumProps` / `LibraryProps` / `MoonProps` /
`MarsProps` / `DinoProps` / `BodyProps` / `CityProps` / `Earth`), with `props/index.js`'s
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
- Surfaces get their texture from `PropKit.relief(kind, { seed, repeat, strength })`,
  spread into a material's params (`bark` / `wood` / `stone` / `metal` / `soil` /
  `weave`).

`relief()` exists because every prop here is built from smooth analytic solids, and a
smooth solid under a single sun reads as plastic whatever colour it is painted. It
returns a small tileable greyscale height field wired in as a **`bumpMap`** — and it has
to be a bumpMap, not a colour map, for two reasons. First, nearly every prop is a merged
**vertex-coloured** mesh, and a material carrying both a `map` and `vertexColors`
multiplies the two — the exact mistake that turned the bear dens' facade near-black. A
bump map does not touch colour, so it composes safely with vertex colours, with a real
map, or with a flat colour. Second, getting the same relief out of triangles would
multiply the vertex count of every object in every world.

Four things to know about it:

- **A fresh texture per call, never a cached shared one.** `disposeObject3D()` disposes a
  removed object's `bumpMap` outright, so one cached tile handed to two props is
  destroyed out from under whichever survives. That is why the tile is only 96px square.
- **`NoColorSpace`, not the sRGB `canvasTexture()` sets.** A bump map is data, not
  colour; the sRGB decode would silently reshape every height in it.
- **The patterns are anisotropic on purpose.** A material's character is mostly *which
  direction its detail runs* — bark stretches the noise vertically into fibres, brushed
  metal stretches it the other way, and only stone is left isotropic.
- **It fakes lighting, not silhouette.** It vanishes at grazing angles and never
  self-shadows, so it is right for grain and weathering and wrong for anything whose
  outline should visibly change.

Where a prop *already* has a colour map whose light and dark **are** its relief — the
Park's puddingstone and pond ripples, the Library's wood — that same texture is passed as
`bumpMap` as well rather than generating a second one. A texture's `dispose()` is
idempotent, so pointing two material slots at one texture is safe.

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

**Closing the gaps where primitives meet.** Three rules, and every visible "the leg does
not join the body" complaint in this project traced to one of them:

1. **`taperedTube`'s `radialSegments` default is 14, not 8, and that is load-bearing.** A
   tube's rendered surface is inset from its nominal radius by `cos(π/n)` at the flats —
   7.6% at 8 sides, 2.5% at 14. Where a limb plugs into a torso BOTH surfaces retreat by
   that much, and since two tubes' Frenet frames are unrelated their flats meet at
   arbitrary angles, so the worst case is a genuine V-notch. On a 3ft torso and a 2ft
   thigh that was nearly half a foot of apparent gap. Small details still pass an explicit
   low count — a 0.3ft dendrite gains nothing.
2. **Two tubes meeting at an angle cannot close on their own — put a ball in the socket.**
   Each ends in an open ring lying in its own plane, so wherever the planes disagree the
   surfaces cross. `DinoProps.joint()` is a sphere slightly larger than the thicker tube;
   sized to *match* it, its silhouette lands exactly on theirs and the seam only moves.
   Every hip, knee, ankle, shoulder and elbow has one, and so does every bronchial
   bifurcation. Root the limb a little way INSIDE the body too, not on its surface.
3. **`taperedTube` does not cap its ends — it is a sleeve.** A tube stopping in mid-air
   shows the hole straight through it, which is what made every great vessel on the heart
   look broken. `BodyProps.capEnd()` closes one with a sphere of the tube's own end radius,
   and reads as a cut vessel, which is what an anatomical specimen has. Ending at radius 0
   also closes it but turns the last segment into a cone — right for a tail, a frond or a
   dendrite, wrong for a bronchus, where it reads as a pale blade stuck through the tissue.

**A belly is a wide flattened mass inside the torso, not a tube slung under it.** Every
animal here originally carried its pale countershading as a narrow tube a foot *below* the
body, which read as a plank strapped on: too small to be the body, too separate to be part
of it, and leaving a hard step down the whole flank. They are now wide tubes whose axis
sits inside the torso, `scaleAbout`-flattened to ~0.65 vertically, clearing the torso's own
underside by a few inches. Countershading needs a broad pale underside, not a keel.

**Stacked transparency reads as creases.** The lungs' lobes are `FrontSide`, not
`DoubleSide`: with DoubleSide each lobe contributes two transparent layers, so where three
lobes overlap the viewer looks through six surfaces and the overlaps darken into what look
like hard cracks between them. Culling back faces halves the stack, and the airway inside
is still perfectly visible through the front shell — which was the only thing DoubleSide
was buying.

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

### 1940's New York, and world portals

Broadway at Times Square in the summer of 1949, modelled from a colour photograph, in
`src/props/CityProps.js` + `newYorkLayout()`. It is the only world **not listed in either
menu**: `PRESET_WORLDS.newyork` carries `hidden: true`, and both `Menu.js` and
`VRMenu.js` skip any preset with that flag. Everything else about it is an ordinary
preset — `buildPresetWorldRecords` looks it up by name like any other.

**A world portal is a door, and it is four lines of plumbing.** `CommonProps.worldPortal()`
stamps `object3D.userData.portalWorld` on the billboard it builds; `ObjectMenu.tryPick()`
reads that off the picked object and calls `onPortalClick` instead of opening
Size/Move/Program; `main.js` wires that to the same `menuActions.loadPreset` the Load
World menu uses. Nothing else in the app knows portals exist — a portal is a plain
`preset-prop` record, so it saves, exports to a world file, rehydrates and duplicates with
no per-kind code, and the flag comes back on every rebuild because the builder always sets
it. The cost is that a portal cannot itself be resized, moved or programmed, since this is
the only path to that panel for a prop. That is the right trade for a door.

Two placement decisions that are the feature, not decoration:

- The billboard is **behind** the Library hall, in the 20ft slot between its rear wall and
  the sign, and it faces **back toward the building**. A student rounding either rear
  corner walks into that slot and meets the face square on; turned the other way it shows
  them its blank back. A `standing-sign` out on the approach ("TIME TRAVEL EXHIBIT ·
  BEHIND THE LIBRARY") is the only signpost to it — a portal nobody finds is a portal
  nobody has.
- **The door goes both ways.** New York carries a return portal on the corner plaza under
  BOND. It is deliberately not beside the spawn: a way home where you arrive is one most
  students press before they have seen anything.

The board says `CLICK THIS SIGN TO GO` in as many words. Every other object in this app
opens a menu when clicked, so a sign that silently replaces the entire world would be a
nasty surprise; the call-to-action strip is what makes it a door rather than a trapdoor.

**The street's coordinate system**, which every number in the layout hangs off: the
roadway is `x = -17..17`, the sidewalks `x = ±17..27`, the building faces `x = ±27`.
Every building and vehicle in `CityProps.js` is authored **facing +Z**, so a west-side
building is placed at `x = -(27 + depth/2)` with `rotY = +PI/2` and an east-side one
mirrors it. Anything standing ON the sidewalk takes `y = 0.5`, because the sidewalk is a
6in slab of its own and the terrain is underneath it; vehicles take `y = 0.12`.

**54ft between facades is narrower than the real Broadway, deliberately.** The camera's
70° fov is *vertical*, so a 16:9 screen sees about 51° either side; at the true street
width the marquee across the road sits outside the frame and a student arrives looking at
empty asphalt. The spawn is also turned 14° west rather than straight up the sidewalk,
which swings the marquee into the view, puts BOND almost dead ahead, and takes the nearest
lamp post off the exact centre of the screen where it was standing like a bollard.

Traps this world hit, several of which generalise:

- **`Raycaster` does not update `matrixWorld`, and the ground's is the identity until the
  first rendered frame.** `PlaneGeometry` is authored upright in XY and the ground mesh is
  laid down by a -90° rotation — so a ground-height probe before that first frame does not
  *miss* (harmless, it returns 0), it **hits the plane still standing up** and returns a
  vertex row's local Y as a height. That put a 96ft theatre 157ft underground. `SceneSetup`
  now calls `ground.updateMatrixWorld()` at build time; the ground never moves again
  (`applyWorldTheme` rewrites its vertices in place, never its transform), so once is enough.
- **A partial `CylinderGeometry` is CAPPED at its flat ends.** Wheel arches built as half
  cylinders came out with a solid half-disc exactly where the wheel should be visible, and
  every car in the world read as a bulldozer. They are seven small blocks stepped round the
  axle instead — the same voussoir trick the stone arches use.
- **A cabin built as one solid box hides its own glass.** At any body width the window
  panels end up inside the box and the greenhouse reads as a painted black slab. It is a
  *frame* — belt rail, three pillars a side, roof panel — with the glass hung outside it and
  a dark interior filler within.
- **A swept tube is as deep as it is wide.** A statue torso sized to look right from the
  front is a 5ft-deep barrel from the side; the Bond figures are `geometry.scale(1.3, 1, 0.72)`
  after sweeping, which moves nothing (every control point is on x = 0) and is the whole
  difference between a figure and a snowman.
- **`metalness: 0.9` with no environment map renders BLACK.** There is no env map anywhere
  in this app, so chrome sits at 0.55 and headlight lenses are their own low-metalness,
  slightly emissive merge — at 0.9 every bumper looked like cast iron and every headlight
  was a dark blob stuck to a fender.
- **The hemisphere fill is the entire lighting budget for one side of a street.** A city
  block is a canyon and the sun can only ever light one face of it, so `hemiGround` is
  `0x6b6459` at 1.8 — far lighter than any other outdoor world, for the same reason
  Dinosaur Island needed it under a closed canopy.
- **Nothing tall stands between z = -20 and z = 23.** That band is the two theatre
  marquees, which project 8-9ft over the sidewalk at 11-19ft up; a 21ft lamp post inside
  one grows through the roof of it. Lamps also sit at `x = ±20`, three feet in from the
  kerb, because the shop awnings reach out to 22.
- **Clear of a box is not the same as readable.** A traffic signal ten feet in front of the
  return portal passed every overlap sweep and hid half the sign — found only by standing
  where a student stands and looking, the same lesson as the activity boards.

**Performance, measured rather than assumed** (this app has to run on school Chromebooks):
394 draw calls, 235k triangles, 21 transparent meshes, **4 point lights**, 102 textures,
~2.1ms of CPU render — the lightest-rendering populated world in the app, against the Park's
748 calls / 578k tris / 4.6ms. Three choices bought that: every prop merges to one or a few
vertex-coloured meshes, marquee bulbs are *painted* on the sign canvas everywhere except
the one marquee a student stands directly under, and the lamps' lit glass is **opaque and
merged into a single mesh per lamp**. A dozen lamps at three translucent glass meshes apiece
was 36 transparent draws — the largest block of transparency in any world here — for glass
at opacity 0.92 that was visually indistinguishable from solid.

### Photo textures, but only on the big flat surfaces

`SurfaceTextures.js` loads photographic maps from `public/textures/` for the handful of
genuinely large **flat** surfaces: the terrain, the museum and library hall floors, and
the Mars dome deck. Everything else stays generated in code.

The line is drawn there on purpose. A photograph wins where a surface is big, flat and
seen close up — real material has colour variation at several scales at once, which no
amount of summed sine waves invents — and "a photo has no silhouette" costs nothing when
the surface genuinely is flat. On anything a student walks around, generated geometry
plus `PropKit.relief()` is still right: a photo cannot give a T. rex a profile. Sources
are CC0 (ambientCG), so nothing here carries an attribution obligation.

Four things hold it together:

- **Missing files degrade, they do not break.** `photoMap()` returns a Texture
  immediately, backed by a 1×1 white pixel (or by the overlay canvas, below). A map
  multiplies the material's colour, so white is a no-op — with `public/textures/` empty
  the whole app renders exactly as it did before this existed, with one console warning
  per file and no errors. These are fetched over HTTP at runtime, so a 404 must never
  take a world down.
- **Decoded images are cached; Textures are not.** `disposeObject3D()` disposes a removed
  object's `map` outright, so one cached Texture handed to two props dies with the first
  removal — the same trap that governs materials throughout `src/props/`. Caching one
  level lower, at the `HTMLImageElement`, keeps the decode and the request shared while
  every caller still owns its own Texture. (The ground mesh is the one exception: it is
  created once and mutated in place forever, never disposed, so `SceneSetup` caches its
  detail textures per file.)
- **The terrain's ground maps are converted to pure LUMINANCE first** (`luminance: true`,
  Rec. 709 weights). Normalising per channel removes a photo's average colour cast but
  keeps the *relative* differences between channels, so a mossy patch in the source stays
  greener than the grit around it — fine on grass, and quite wrong on the Moon, where it
  left the regolith visibly mottled with green. Discarding hue entirely means the theme's
  ramp owns the ground colour completely and the photo contributes only grain, grit and
  wear, which is the whole reason it is there. Rec. 709 weights rather than a flat channel
  average: the eye is far more sensitive to green, and a flat average visibly darkens
  foliage.
- **`neutralized()` is what lets a photo coexist with `vertexColors`.** The terrain is
  vertex-coloured from each theme's `groundLow`/`groundHigh` ramp, and a material with
  both a `map` and `vertexColors` multiplies them — dropping a grass photo straight on
  would stain Mars and the Moon green. Normalising the photo **per channel** to a mean of
  white makes the multiply a no-op on average: the theme still decides the hue, the photo
  contributes grain, grit and wear. Per channel, not by luminance — a single luminance
  divisor leaves the photo's colour *cast* intact, which is exactly the green-Mars bug.
- **Composite the existing canvas over the photo; never replace it with a bumpMap.** The
  instinct is to promote the photo to `map` and demote the canvas to `bumpMap`. That is
  wrong wherever the canvas carries **colour that means something** — the museum floor's
  two-tone checker is a checkerboard *because of its colour*, and the Mars deck's yellow
  hazard ring and painted MUSTER marking are not markings once they are relief.
  `photoMap({ overlay })` multiplies the canvas over the photo instead, and the canvas can
  still be passed separately as `bumpMap` for the joints. It also makes the no-file
  fallback exact rather than merely acceptable, since the composite degrades to the canvas
  alone.

Three tuning rules, each learned the hard way:

- **`neutralize` has to be set against how much the OVERLAY needs to stay readable, not
  against how good the photo looks.** The library's boards and the Mars deck plate take
  0.85 because their overlays are low-contrast seams. The museum floor takes **0.3**: its
  overlay is the entire design of the room, and at 0.85 a high-contrast blue-grey marble
  buried the checkerboard completely and the gallery came out looking like camouflage.
- **`overlayTiles` exists for overlays that do not tile.** The Mars deck's canvas is one
  circular layout drawn once across a 44ft floor, so at 1:1 the photograph was stretched
  to 44ft as well and turned to mush. Tiling the photo 6× *inside* the composite gives the
  plate a ~7ft repeat while the hazard ring and MUSTER marking stay where they were drawn.
- **The terrain wants the photo TWICE** — neutralized as `map`, and again raw as
  `bumpMap`. Neutralizing is what keeps the photo's colour out of the theme's way, but a
  bump map wants the full range; flattening it toward white flattens the relief with it.
  The rebalanced colour map on its own is too washed out to read at standing height, and
  the bump is what actually puts grain under a student's feet.

`photoMap` takes `repeat`/`repeatY` separately because the library floor tiles 24×18 — a
scalar repeat stretches the boards.

### Programming activities: two per world

Every preset world carries two `activity-board` props — big, bright signs setting a
programming challenge for one particular object in that world, with the exact blocks to
snap together. `WorldPresets.activity()` places one; `ctrlStep`/`moveStep`/`lookStep`
build its block list.

**The chips are coloured from `CATEGORIES` in `BlockDefs.js`, not from a copy of those
hex values.** That import is the whole trick: the orange chip on the sign is the same
orange as the `repeat` block the student is about to go and drag, so the board teaches
the palette while it sets the task. A local copy of the colours would drift silently and
produce exactly the confusion the board exists to prevent.

**Every sequence on these boards has been run.** That is not politeness — `move X/Y/Z`
shift an object along the **WORLD** axes, not along its own facing, so rotating something
does **not** change which way it will then travel. "Drive around the field in a square"
is not writable with this block set. Every patrol on every board is therefore an
out-and-back along one axis with a `rotate 180 degrees` in the middle so the thing faces
the way it is going, and several boards say so in their tip. If a block is ever added
that moves relative to facing, these can be rewritten — until then, a board promising a
circuit would be a board that lies.

Two placement rules, both learned by getting them wrong:

- **The posts go OUTSIDE the panel**, unlike `standingSign`, which tucks them inside its
  edges. That works there because its text is centred; an activity board's text is
  left-aligned and starts a few inches in, so an inset post stands in front of the first
  character of every single line.
- **A board has to be readable, which is a stronger condition than not overlapping.** The
  automated overlap sweep passes things that are visually hopeless — a tree fern's fronds
  or a bridge abutment can sit clear of the board's box and still cover half of it from
  the angle a student actually approaches from. Boards need eyes on them, not just a
  clean audit.

`pondGeese()` exists because of this feature. The geese were built into `parkPond()`, so
clicking one selected the entire pond — "program the geese to paddle about" moved the
water, the bank and the cattails with them. **Anything a student is invited to program has
to be a thing they can pick**, which is a placement decision as much as a modelling one.
`parkPond` still draws its own pair by default (`geese: true`) so every world already
saved with a pond is untouched; the Park asks for `geese: false` and places the pair
separately on top.

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
  defaults (`repeat`/`forever`/`wait`/`duplicate` control; `moveX/Y/Z`/`rotate` motion;
  `changeSize`/`changeColor` look). `createBlockInstance()`/`cloneBlockTree()` are the
  only ways block instances get created — always with fresh `id`s. Blocks are rendered
  as plain rounded pills with **no jigsaw nub on the top edge** — Scratch draws one
  because its blocks are a single bitmap per block with no gap between them, so the tab
  is what shows they interlock; here they are spaced DOM elements and a 5px stub poking
  out of the top read as a rendering artifact. Order is carried by the stack itself and
  by the drop indicator, so nothing is lost. Note `#program-palette`'s width is sized to
  the widest block template (`duplicate [4] ft away`) — the labels are `nowrap`, so a
  narrower palette overflows sideways rather than wrapping.
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

**The `duplicate` block is the only one whose effect leaves its own object**, and
everything awkward about it follows from that (`Duplicator.js`):

- It copies the **record**, not the `Object3D`. Every kind already knows how to rebuild
  itself from a record, so cloning it and handing it back to `WorldStore.rehydrateOne()`
  duplicates all nine kinds with no per-kind code. `object3D.clone()` would instead share
  materials and maps with the original — which `PlacedRegistry.disposeObject3D()` then
  destroys out from under the survivor — and would leave the copy with no record, so it
  could never be saved, reloaded or edited.
- The transform comes from the **live** `object3D`, not `record.transform`. A program
  that has been moving its object has not written those changes back to the record
  (`persistTransform` only runs on an `ObjectMenu` edit), so the record can be many feet
  stale and the copy would appear at the object's starting point.
- **`stripDuplicateBlocks()` is what stops the block being exponential.** A copy that
  inherited an unmodified program would start duplicating on its own next frame, and each
  of its copies after that, so `forever { duplicate }` would double the world every few
  frames. Removing just this one block leaves the rest intact — a spinning object still
  produces spinning copies, they simply do not breed. A loop left holding nothing after
  the strip is dropped too, or `repeat 4 { duplicate }` hands every copy an empty
  `repeat` — a non-empty program that does nothing, which still earns a green play icon.
- **The offset is stepped per run**, counted in the closure `ProgramManager.start()`
  builds. Without it `repeat 3 { duplicate 4 ft }` puts all three copies at the same
  point, because the object never moved between them and each measured from the same
  origin — a student sees one object and concludes the block is broken.
- `MAX_WORLD_OBJECTS` (400) exists only because of this block: it is the one thing in the
  app that adds objects without a human clicking each time.
- `ProgramManager` is constructed at the top of `main.js` (`PlacedRegistry` takes it as a
  constructor argument), long before the registry and world store exist, so
  `programManager.onDuplicate` is **assigned afterwards** rather than injected. That is
  safe because nothing calls it until a program is actually running.

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

### Create Model: building a model out of primitives

Menu ▸ **Create Model** is its own top-level group (`_group()` does not nest, so it could
not go under Load Object) with one button per shape. Each drops a 2ft yellow construction
piece on the ground ahead of the student, carrying a floating amber **hammer** icon that
opens `PrimitiveMenu`: Apply Texture / Stretch to Shape / Rotate/Move Shape / Connect to
Primitive / Remove Shape / Render Model / Close. Render Model fuses a connected cluster
into one ordinary placed object, after which Size/Move/Program, saving and duplicating all
work on it like anything else. Remove Shape sits directly above it, because those two are
the panel's only irreversible buttons and both are coloured as commitments rather than as
steps.

**There is no CSG, and "seam the pieces together" does not need any.** Connecting is a
recorded link, and rendering builds a `THREE.Group` of the same overlapping solids
registered as ONE root — which is all "one solid model" has to mean here, since
`resolveRoot()` already maps a click on any child back to the single id. A real boolean
union would mean a dependency this project doesn't carry (`three@0.185` only, no
`three-bvh-csg`) and would throw away the per-part data that keeps the record small and
rebuildable.

Two record kinds, both in `rehydrateOne()`'s dispatch and both storing parameters rather
than geometry, exactly like `light-orb` and `preset-prop`:

- `primitive` — `{ shape, color, files?: [texture], connections: [ids], transform }`
- `built-model` — `{ parts: [{shape, color, fileIndex, position, rotation, scale}], files, transform }`

They must be handled **before the gltf/obj fall-through**, which assumes everything in
`files` is a model file and would hand a texture PNG to the glTF parser. Because both
rebuild from their record, world-file export (`WorldFile` base64s anything under `files`
unprompted), IndexedDB rehydration and the `duplicate` block all work with no per-kind
code — a duplicated model comes back with its own materials and its own decoded texture,
which matters because `disposeObject3D()` destroys a removed object's `map` outright.

Things worth knowing before editing this:

- **Construction pieces are excluded from `ObjectMenu`'s raycast** (`userData.isConstruction`,
  alongside the existing `isWebBrowser` exclusion). Until it is rendered a piece is a
  *part*, not an object, and Size/Move/Program are whole-object actions. The model that
  replaces the pieces carries no such flag and picks up normally.
- **`ConstructionManager` must be constructed before `PlayIconManager` and `ObjectMenu`.**
  All three register their own pointerdown/pointerup pair on the same canvas/window and run
  in registration order within one dispatch, so a hammer hit calls
  `e.stopImmediatePropagation()` to stop ObjectMenu raycasting the same click, finding
  nothing where the icon floats, and `close()`ing the panel that was just opened. Same
  arbitration, same reason, as the web browser panel's edit icon — and the sprite raycast
  needs the same explicit `modelViewMatrix` refresh.
- **Hammer icons self-sync from the registry every frame** instead of being pushed at from
  `WorldStore`/clear paths the way play icons are. Whether a piece has a hammer is a pure
  function of "is there a live record of kind `primitive` with this id" — unlike a play
  icon, which tracks a program being written or cleared — so deriving it in `tick()` means
  there is no `refresh()` call a future bulk-removal path can forget.
- **`BuildGizmo` listens on `window` in the CAPTURE phase, and has to.**
  `PlayerController` registers its look-drag `pointerdown` on the canvas at boot, long
  before this class exists, and `stopImmediatePropagation` from a later listener on the
  same element cannot suppress an earlier one. A capture-phase window listener runs before
  every target-phase canvas listener regardless of order, which is the only way a corner
  grab can be claimed away from the camera. It only stops propagation when the raycast
  actually hits, so a drag on empty ground still turns the view.
- **The gizmo carries THREE grabs, and the third one is load-bearing.** Corner handles
  stretch, the box body slides, and a green **move handle** floating above the box does all
  three axes in mid-air. Without a grab that leaves the ground *nothing could ever be
  stacked on anything else* — no head on a body, no snowman, no roof on walls — which is
  what the tutorials ran into the moment they tried to describe building one.
- **Every horizontal move preserves ELEVATION ABOVE THE TERRAIN, not absolute Y**
  (`BuildGizmo.elevationOf()` / `seat()`). This is what makes stacking usable rather than
  merely possible. Re-seating a dragged piece flat on the ground is what makes it follow
  hills, but it also means a piece lifted onto another one drops straight back to the grass
  the instant it is slid an inch sideways — so it could be raised to the right height and
  never lined up over the thing it was meant to sit on. Carrying elevation keeps both:
  a grounded piece has elevation 0 and stays grounded, a raised one rides the hills at its
  own height. Lifting rewrites `drag.elevation` mid-drag, or raising and then sliding within
  one grab would undo the raise.
- **The green handle picks lift-vs-slide from the first 8px of pointer travel, and then
  holds it.** One drag is 2 degrees of freedom and the handle needs 3, so something has to
  choose; the alternatives were a modifier key (no such thing on a tablet) or a fourth
  handle. Mostly-vertical travel wins ties and means lift, because dragging up the screen to
  raise something is what everyone tries first. Consequence worth knowing: *pure* forward/back
  through this handle needs the drag to start sideways, so the box body — which is a much
  bigger target and slides freely in both flat axes — stays the primary way to move a piece
  horizontally.
- **A flat slide must not be measured on a horizontal plane the grab ray only grazes.**
  `beginFlatDrag()` exists because of rotate mode: the rings push the green handle up to
  ~4ft, within a foot of the 5ft eye line, so every ray through it meets a horizontal
  plane at ~5° — and no choice of plane HEIGHT rescues that, since the intersection just
  slides out to wherever the near-horizontal ray finally comes down (~44ft out for a
  plane at ground level). Measured there, pixels of vertical pointer wobble threw the
  piece 20ft in Z, and a pointer drifting above the plane's horizon lost the
  intersection entirely and froze the piece — which presented as "the gizmo can't move
  things sideways". Steep grabs (a body grab on a knee-high piece) still track a
  horizontal plane directly, keeping the piece glued under the pointer; below
  `FLAT_DRAG_MIN_SIN` (15°) the drag is measured on a camera-facing VERTICAL plane and
  decomposed — sideways travel slides laterally, up/down pushes away and pulls back, 1:1
  at the grab's own distance.
- **A ring seen edge-on is skipped in picking (`RING_PICK_MIN_DOT`), and a fresh piece
  always has one edge-on.** A piece placed straight ahead puts one upright ring's plane
  through the camera by construction, so it projects as a hairline straight down the
  middle of the piece — exactly where a student clicks meaning to grab the body — and a
  grab on it is dead anyway, since the pointer's angle around an axis parallel to the
  view is numerical noise (the drag accumulated nothing and the piece simply froze).
  Skipping it lets the click fall through to the body slide that was almost certainly
  meant. The guide's "walk two steps sideways" tip for edge-on rings still applies to
  *using* one; this is about not letting the unusable ring eat clicks.
- **The move handle and the hammer icon occupy the same airspace**, and a sprite with
  `depthTest: false` draws straight over a mesh. `ConstructionManager.suppressId` is set by
  the gizmo while a piece is active, so that piece loses its hammer until Done — which costs
  nothing, since its menu is closed and the gizmo owns the pointer anyway.
- **Everything the gizmo measures works in the piece's OWN frame, not in its world AABB**
  (`BuildGizmo.frame()`). Rotate/Move Shape is why. The AABB of a turned box is bigger than the
  box and its sides do not line up with it, so an overlay or a stretch sized from it pulls
  the piece along the wrong directions entirely. `frame()` returns centre + half-extents
  along the object's own axes + its quaternion; `stretchByCorner()` then projects the drag
  onto those axes (`reach.dot(axes[i])`) instead of reading `hit[key] - anchor[key]`. With
  an unturned piece the two are identical arithmetic, which is why this could be swapped in
  under the existing behaviour rather than beside it. The **one remaining invariant** is
  that every primitive geometry is authored centred on its own origin — that is what makes
  `object3D.position` the centre of its own box at any rotation.
- **Rotate/Move Shape turns about the WORLD axis the ring is drawn on, and the rings do not
  turn with the piece.** Rings that follow the object are the CAD convention and they are
  wrong here: the control a student is holding slides out from under them as they use it.
  Fixed rings mean the flat amber one always spins the piece on the spot and the upright
  ones always tip it, whatever state it is already in. Implementation follows from that —
  `q_new = axisAngle(delta) · q_start`, pre-multiplied. Post-multiplying would turn about
  the piece's own axis, which is not the ring being held.
- **A rotate drag accumulates wrapped increments; it does not diff against the start
  angle.** A raw difference reads the ±180° crossing as a near-full turn the other way, so
  a drag could never wind past a half turn.
- **Rotation snaps to `ROTATE_SNAP_DEGREES` (15°)**, which is what makes it useful for
  building rather than merely possible: square corners and 45° braces are most of what a
  model needs and neither is hittable by eye on a trackpad.
- **A turn has to HOLD the piece's elevation, not clamp it out of the ground.** Turning
  swings the corners about, so the lowest point moves without the piece being dragged
  anywhere — a 2ft cube on the grass reaches 0.41ft below itself at 45°. The obvious
  version of this is a one-way "push it up if it is underground" clamp, and it is wrong:
  it lifts the piece at 45° and has nothing to bring it back down at 90°, so every quarter
  turn leaves it hovering a few inches in the air. `rotateByRing()` instead recomputes the
  origin-to-base offset each frame (the rotation is what just changed it) and re-seats at
  the elevation captured when the drag began.
- **`touchingPrimitives()` is no longer exact.** It is an AABB test, and the AABB of a
  turned piece is bigger than the piece, so Connect now errs toward listing a near-miss.
  That is the right direction to err in: an invisible hair of a gap in a joint costs
  nothing, against telling a student nothing is touching a piece that visibly is.
- **Dragging the blue box body is the primary move affordance**: pieces have to be brought
  into contact before they can be connected, and folding that into the same mode as
  stretching avoids a second menu screen for it. It re-seats on the terrain each frame
  (`groundHeightAt` + the elevation and base offset captured at grab), so a piece dragged
  across hills follows them at whatever height it is already at.
- **`Remove Shape` is `removePrimitive()` in `Primitives.js`, not a call to
  `registry.remove()` at the menu.** It lives next to the connection code because deleting a
  piece is a graph edit: every OTHER piece's `connections` has to stop naming the id.
  `clusterIds()` already skips links it cannot resolve, so a dangling link breaks nothing at
  runtime — but the record is persisted, exported into world files, and read by whatever
  eventually re-splits a built model, so it must not keep claiming a partner that is gone.
  It is deliberately unconfirmed: nothing else in this app asks "are you sure", and the
  button exists precisely for the student who put down the wrong shape.
- **`PRIMITIVE_SPAWN_DISTANCE` is a framing number, not a reach number.** Eyes are at 5ft
  and a fresh piece is 2ft tall, so its base sits 5ft below the sightline; at the 8ft this
  started at that is 32° down against a **vertical** 70° fov (35° either side), and the
  shape a student just asked for arrived half off the bottom of the screen. 10ft fixes it.
- **The placement spiral counts LIVE PRIMITIVES, not `registry.count`.** In a preset world
  the registry is already in the hundreds, and `SPACING·√n` would put the first piece
  ~28ft off to one side of a 10ft drop point.
- **`WorldStore.deleteObject(id)` is the only path that removes ONE record** rather than
  wiping the world; Render Model and Remove Shape are its two callers. Without it the
  consumed pieces come back on the next refresh alongside the model built from them.
- The gizmo's Done chip clears the toast band (`bottom: 76px`, not 22) — `#toast-host` is
  also bottom-centred and entering stretch mode fires a toast, so at the same offset the
  hint covers the only exit button. `main.js`'s VR toggle deactivates the gizmo for the
  related reason that the chip is hidden in VR.
- **Colour and an uploaded image are mutually exclusive on a piece**, and applying either
  clears the other: a material carrying both multiplies them, so a "yellow" photo-textured
  cube comes out muddy with nothing on screen to explain why. The same multiply trap as
  `map` × `vertexColors` in the props.
- Create Model is deliberately **absent from `VRMenu`**: placing a shape would work, but
  the hammer panel, the file picker and the Done chip are all flat-screen DOM, so a student
  in a headset would be left with pieces they could not build with.

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

**Eye height is 5ft in every mode, and in a headset that takes calibration.** Flat and
stereo both put the camera at `EYE_HEIGHT` because both read `PlayerController`'s camera
directly. XR cannot: the dolly sits on the floor and `local-floor` adds the WEARER's real
head height on top, so a tall adult stood at 5.9ft, a seated student at 3.9ft, and — since
`local-floor` is only an *optional* session feature — a runtime that declines it measures
from wherever the headset was at session start, which on a desk puts the eyes at ground
level with the world towering overhead. Every size in these worlds is calibrated against a
5ft person ("the T. rex's hip is taller than a grown-up" is only true from 5ft), so
`calibrateEyeHeight()` measures the head's height above the dolly and sinks or lifts the
dolly by the difference.

It is a **constant offset measured once**, not a per-frame clamp. Clamping would also
cancel out ducking, leaning and crouching — the very things a headset is for. Calibrating
maps the wearer's standing height to 5ft and lets every movement away from standing come
through at full size. The measurement is the *tallest* sample from the first ~60 frames,
because a wearer settles into position rather than out of it (the first frames catch them
still lifting the headset on), and because taking the max makes a stray low reading
harmless — including the zero-valued first frame before any pose exists.

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
  programEditor, playIconManager, webBrowserManager, vrView, constructionManager,
  primitiveMenu, buildGizmo) gated behind `import.meta.env.DEV`
  and stripped from production builds — useful for console-driven testing during
  development.
