# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

3DCoder is a single-user, browser-based 3D sandbox (Second Life-inspired): walk a
rolling-terrain world with the arrow keys / on-screen D-pad, import glTF/OBJ models
and images, freehand-draw shapes that inflate into 3D balloons, drop glowing light
orbs, place live interactive web browser panels, and save/load the world. Pure
client-side Three.js app — no backend, ships as a static `dist/` bundle.

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
whatever's in IndexedDB, and only if that leaves zero `startup-*` records does it call
`placeStartupAssets()` — so the library/tree/billboard load once ever (or once per
fresh IndexedDB), not on every visit. The animate loop ticks `registry`,
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

### Terrain: a height-displaced, vertex-colored plane

`SceneSetup.js` builds the ground as a subdivided `PlaneGeometry` (`TERRAIN_SEGMENTS`
per side) with each vertex's local Z displaced by `terrainHeightAt(worldX, worldZ)`
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
  export/import (Save World / Load World buttons in the menu). Base64-encodes any
  Blob file data for JSON transport. `WorldStore.loadFromRecords()` wipes the live
  world + IndexedDB and rehydrates + re-persists from a given record set — this is
  what a "Load World" click ultimately calls.

Both funnel through the same `record.kind` dispatch in `WorldStore.rehydrateOne()`:
`'gltf' | 'obj' | 'image' | 'gif' | 'balloon' | 'light-orb' | 'web-browser' |
'startup-library' | 'startup-tree' | 'startup-billboard'`. gltf/obj/image/gif/balloon
all carry `files: [{name, type, data: Blob}]` (balloon's file is the painted canvas as
a PNG — geometry is *regenerated* via `BalloonInflator.inflateFromCanvas()`, never
stored); `light-orb`, `web-browser`, and the three `startup-*` kinds carry no `files`
at all — a `light-orb` record is just `{ color, transform }` and a `web-browser`
record is `{ url, transform }`, since both `LightOrb.createLightOrb(color)` and
`WebBrowserManager.createPanel(record, worldStore)` rebuild everything procedurally
every time, same philosophy as the balloon regenerating its geometry instead of
storing it.

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

### Touch input is fully decoupled from PlayerController

`TouchNav.js` never touches `PlayerController` directly — it dispatches synthetic
`KeyboardEvent('keydown'/'keyup', { code: 'Arrow...' })` on `window`, identical to
what a physical keyboard produces, which `PlayerController`'s existing listeners pick
up unmodified. **Gotcha**: `Element.setPointerCapture()` throws `NotFoundError` for
any pointerId the browser doesn't consider "active" (reliably happens with
programmatic multi-touch) — it's wrapped in try/catch so a capture failure can never
block the key dispatch; `pointerleave` is the release fallback for when capture isn't
available.

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
  `three/examples/jsm/loaders/*.js` and `renderers/*.js` paths in use — omitting this
  produces a "multiple instances of three.js" runtime warning, because Vite's dev-time
  pre-bundling otherwise treats the deep-imported files as a separate module graph
  from the bare `three` import. `CSS3DRenderer.js` was added here alongside the
  existing loaders when the web browser panel feature was built.
- Vite only serves `public/` verbatim over HTTP. Anything that needs to be
  `fetch()`-able at runtime by a fixed URL (the startup assets) must live under
  `public/`, not the project root.
- `main.js` exposes `window.__debug` (camera, player, renderer, scene, THREE, menu,
  registry, importManager, drawTool, worldStore, objectMenu, touchNav, programManager,
  programEditor, playIconManager, webBrowserManager) gated behind `import.meta.env.DEV`
  and stripped from production builds — useful for console-driven testing during
  development.
