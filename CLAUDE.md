# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Edusim: Web Edition is a single-user, browser-based 3D sandbox (Second Life-inspired): walk a
rolling-terrain world with the arrow keys / on-screen D-pad, import glTF/OBJ models
and images, freehand-draw shapes that inflate into 3D balloons, build your own models
out of stretchable primitives, drop glowing light
orbs, place live interactive web browser panels, and save/load the world. New visitors
land in a prebuilt Park; The Museum, The Library, The Moon, On Mars, Dinosaur Island
and Fantastic Voyage (human anatomy) are loadable from the menu. Two more worlds —
1940's New York and Under the Sea — are deliberately **not** in the menu and are each
reached only by clicking a billboard: New York from behind the library building, Under
the Sea from behind the Park's nature centre. Pure client-side Three.js app — no backend, ships as a static `dist/` bundle.

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

### The hardware target, and the quality bar that follows from it

**The target machine is an Intel Core i5 or i7 Chromebook** — Iris Xe / UHD integrated
graphics, a real desktop-class CPU, 8GB+ of shared RAM. Not a Celeron, not a phone, not
a bottom-of-the-cart loaner. Every budget in this file is set against that machine, and
the earlier notes that read "this app has to run on school Chromebooks" were written
against a much weaker assumption.

**So the quality bar goes up, deliberately.** These worlds are meant to be *more*
capable and the models in them *higher fidelity* than the first pass allowed. Where a
prop was coarsened to save triangles and the coarsening is visible — a faceted limb, a
silhouette that reads as a polygon, a detail dropped that carried the identification —
the fidelity is now the right call. The old counts are a **floor to build up from, not a
ceiling to stay under**. When a rebuild makes something read better up close, take it.

**What that does NOT relax, because none of it was ever about triangle count:**

- **Merging stays mandatory.** Draw calls are CPU and driver cost, and that cost did not
  move — a faster CPU raises the ceiling, it does not remove the wall. Integrated
  graphics is memory-bandwidth-bound, so state changes and per-mesh overhead still hurt
  far more per unit than geometry does. A hundred small meshes remains the wrong answer
  at any triangle budget; a hundred *thousand* triangles in one merged mesh is cheap.
- **Transparency and point lights stay expensive.** Both are fill-rate and per-light
  forward-pass costs, which is exactly where an integrated GPU falls over regardless of
  how good the CPU is. The Under the Sea and New York transparency counts (6 and 21
  meshes) and light counts (1 and 4) are still the discipline to aim at.
- **Every mesh is still drawn twice**, main pass plus the sun's shadow map.
- **Texture memory still comes out of system RAM** on shared-memory graphics. Fresh
  textures per prop stay small for the disposal reason (see `relief()`), and that
  reason is about correctness, not about VRAM.

**Revised working budgets, stated as targets to verify rather than as measurements.**
The per-world figures recorded further down are real, taken with `renderer.info`; these
are the headroom that opens up on the new target and they have **not** been confirmed on
the hardware yet. Treat roughly **1.5M triangles** and **under ~1000 draw calls** as the
new envelope, against the current spread of 95k–592k triangles and 134–777 calls. Measure
on an actual i5/i7 Chromebook before trusting a world that lands near the top of it, and
record what you find here the way every other world's numbers are recorded — **"measured
rather than assumed" is the rule that does not change.**

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
(`default`/`park`/`museum`/`library`/`moon`/`mars`/`dinosaur`/`voyage`/`newyork`/`sea`).
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

### Opening a shared world from a link

`?world=24` on the app's own address loads world 24 straight out of the gallery — no
download, no file picker. `WorldLink.js` reads it, `main.js` acts on it during boot, and
the gallery's world page carries the button (`▶ Open this world in Edusim`).

**The parameter carries an ID, never a URL, and that is the security design.** A parameter
naming an arbitrary address turns every copy of Edusim into something that will fetch and
display whatever a link tells it to, from a url that still begins with the real app's
address — the exact shape a convincing phishing link wants. An integer resolved against a
fixed base (`WORLD_LINK_BASE`) cannot point anywhere but the gallery, so there is no
allowlist to maintain and no way to aim it elsewhere.

**The fetch must be SAME-ORIGIN, and that is a hosting fact, not a preference.** A page may
not fetch across a scheme boundary — browsers block http-from-https as mixed content and
nothing client-side gets round it. That is the entire reason the app is deployed to **`/app/`
in the gallery's own docroot** rather than to a host of its own: it is what makes
`WORLD_LINK_BASE` resolvable whatever scheme the site is on. It deliberately does not fall
back to an absolute address if the fetch fails, because that produces a mixed-content console
error that reads like a bug in this code rather than the hosting fact it is. Note this held
through the domain gaining TLS with no change at all, which is the point of a root-relative
base: it is same-origin by construction.

### The app is served from ONE place, and every link says so

`https://edusim3dweb.com/app/`. The Railway deployment it used to run on is retired; nothing
in the repo configures it and no link points at it.

`EWD_APP_URL` was the one deliberately-absolute constant in `lib/config.php`; now that the
app is a directory in the same docroot it is `'../app/'`, like `EWD_SITE_URL` and
`EWD_GUIDE_URL` beside it, and the gallery emits no absolute links at all except Google
Fonts (`smoke-test.sh` asserts exactly that). `EWD_APP_OPEN_URL` holds the same value and
is still a separate constant, because only *it* carries the same-origin requirement above —
whatever `EWD_APP_URL` is ever repointed at, that one has to stay on this host.

`docs/` is the exception that keeps an absolute `https://edusim3dweb.com/app/` (48 links
across 13 files): the same files are also published to GitHub Pages, where a relative `app/`
is a dead end. The links carry the **trailing slash** on purpose — `/app` alone is a 301, and
that is a wasted round trip on the button whose job is to start the app. **They are `https:`
for the same reason**: the server now 301s every http url to https, so an http link costs
exactly the round trip the trailing slash exists to avoid.

**THE DOMAIN HAS A CERTIFICATE NOW, and the server 301s every http url to https.** That
arrived from the host rather than from anything in this repo, and it landed on the exact trap
this section had been carrying a warning about for months, so the warning is worth keeping
alongside what actually happened.

Immersive VR is back: `navigator.xr` is secure-context-only, and measured on the live site
`window.isSecureContext` is now true and `navigator.xr` is present, so `VRView` can take the
real `immersive-vr` path instead of always falling back to side-by-side stereo.
`crypto.randomUUID` is a second secure-context API and is likewise available again — though
`src/Uuid.js` stays, because it is what stopped a *blank page at boot* on the http deployment
and nothing guarantees the next host.

**The browser panels broke, exactly as predicted, and the fix is NOT the one the old warning
named.** `WEB_BROWSER_DEFAULT_URL` was `http://edusim3dweb.com`, so once the app was served
over https every panel became mixed content — the live console said *"requested an insecure
frame 'http://edusim3dweb.com/'. This request has been blocked"* and every panel in every
world went blank. Changing the constant is necessary and **not sufficient**, because that url
is **PERSISTED**: it is baked into the `web-browser` record of twenty-odd already-published
gallery worlds, into every world file a student has downloaded, and into every copy anybody
has sent a classmate, none of which can be edited from here. The seeder has no update path
either — it dedupes on `world_sha256` and every route through it ends in an insert — so
re-exporting and re-seeding would publish a second copy of every world rather than fix one.

So the fix is `secureFrameUrl()` in `WebUrl.js`, applied where the iframe's `src` is set
rather than where the url is written. On an https page it rewrites `http:` to `https:`; on an
http page it is a no-op, so a local dev server behaves exactly as before. That repairs every
already-published world and every already-downloaded file at once, with no re-seeding. It
rewrites every http url and not merely this host's, deliberately: an http frame in an https
page is blocked outright, so there is no case where leaving it as http works, and a host with
no https answers with a connection error, which reads better than a silent blank rectangle.
`WEB_BROWSER_DEFAULT_URL` is `https:` as well, so newly written records are correct at source.

**The general lesson, which is bigger than this one url: a constant that ends up inside a
saved record is not a constant.** Changing it only affects what is written from now on. The
same is true of `DB_NAME`, of every `PROP_BUILDERS` key and of every block type — this file
says so about each of them — and the browser panel's url quietly joined that list the day the
first world was seeded.

**Two things that had to change to serve the app from a subdirectory:**

- **`vite.config.js` sets `base: './'`.** The default `'/'` writes `/assets/index-xxxx.js`
  into the built page, which is right at a root and a 404 one directory down.
- **`StartupAssets.js`'s urls are relative** (`tree/…`, not `/tree/…`). They are fetched by
  url at runtime, so a leading slash resolves against the **domain root** — which under
  `/app/` is the marketing site, where the file is not. `SurfaceTextures.js` already did
  this correctly. `fetchAsFile()` now strips a leading slash itself rather than relying on
  each call site: the first pass converted the tree urls by hand and missed the billboard,
  so the Park's welcome banner 404'd in production for weeks. **The failure is invisible in
  dev**, because `npm run dev` serves the app at an origin root where both spellings work —
  which is the whole argument for putting the guard in the one funnel they share.

  `WORLD_LINK_BASE` is the deliberate opposite: root-relative, because it points at the
  *gallery*, not at the bundle.

**The link is stripped from the address bar before the world loads** (`history.replaceState`
in `takeLinkedWorldId`). Loading replaces everything, so a link left in the url would wipe
the student's work again on every refresh — including the refresh they do to try to get
back what they just lost.

**It resets the player; Load World File does not.** There the student chose a file while
standing somewhere and moving them would be rude. A link is the opposite: they may have
arrived from another world entirely and be standing 150ft out in fog that no longer exists,
and a world file carries no spawn of its own. `player.resetTo()` with no arguments is the
app's own default spot.

**Failure leaves the existing world alone**, because the fetch and the parse both happen
*before* `loadFromRecords` wipes anything. A dead link toasts the reason and rehydrates
whatever was already saved.

**Every world card on the marketing page carries one of these links** (`.world-open` in
`docs/index.html`, 22 of them). Three things about that block:

- **The card → id map is keyed by TITLE, not by position.** The grid gets reordered and
  worlds get inserted; a positional map would silently point a card at the wrong world
  instead of failing. The two gallery worlds with no card are **My World** (an empty
  sandbox — nothing to show) and **1940's New York**, which is deliberate: its only door is
  a billboard behind the Library, and the section text three paragraphs up promises the
  reader that at least one world is not on the list.
- **Link text is the world's own name**, not "open this world". Twenty-two identical link
  texts on one page is what a screen reader reads out twenty-two times.
- **The `.world-open` button takes no auto margin.** `.world-chips` already carries
  `margin: auto 0 0`, so the card's free space collects above the chips and pushes the
  chips *and* the button down together. Give the button an auto top margin as well and the
  free space is split between them, stranding the chips up under the paragraph.

The `.menu-mock` further down is `aria-hidden="true"` — a decorative replica of the in-app
menu — so the world names in it stay plain text. Focusable links inside `aria-hidden`
content are an accessibility bug, not a missed opportunity.

**The seven per-world guide cards carry the same link in three places** (`docs/guide/`:
park 1, museum 2, library 3, moon 4, mars 5, dinosaur 6, voyage 7). The other five guide
pages — builder, coding, index, teachers, tutorials — are not about one world and keep the
plain `/app/` link.

**Adding it exposed a stale instruction, which is the more important half.** Every card's
"Getting there" line read `☰ Menu → Load World → <that world>`, and `MENU_WORLDS` is down to
four — so The Museum, The Library, On Mars and Fantastic Voyage were each telling a student
to find a menu entry that is not there. The button is now the route and the menu is the
alternative, phrased per world from `inMenu`. The guide hub's "How to use a world card" step
1 said the same thing generically and was corrected the same way. **Anything that changes
`MENU_WORLDS` has to come back through these eight files**, since they are static HTML with
no build step and nothing will fail if they drift.

**A link on a printable page needs the address written out.** These cards have a Print
button, and `@media print` hides `.gfoot` — which is where the typed url lived — so a
printed card would have named no way into the world at all. `.print-only` carries
`edusim3dweb.com/app/?world=<id>` and `.gbtn-world` is hidden, since on paper the button is
just a dead amber lozenge.

`.gbtn-world` **floats** rather than sitting inline-block: these sentences run to three or
four lines, and an inline-block button on the first one drags that line's height with it
and leaves a visible gap above the rest. `.howto-warn` therefore needs `clear: both`.

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

### Prebuilt worlds: Park / Museum / Library / Moon / Mars / Dinosaur Island / Fantastic Voyage / the curriculum set / My World / (New York, Under the Sea)

The menu reads **Get More Worlds → Save World → Load World File → Create Model → Clear
World → VR Headset View**, in that order: get a world, keep this one, open a file, then
what am I building, then the two whole-session actions. **Load Object** (Import / Draw / Light Orb / Web Browser) is not
top-level — it is a dropdown *inside* Create Model, because bringing in a model, painting
a balloon, dropping an orb and hanging a browser panel are the same job as adding a
shape: putting something of your own into the world.

Both levels are built by `Menu.js`'s `_group()`, which pairs a `▸`/`▾` toggle button with
a `.menu-submenu` panel. **The two levels are tracked in separate lists and that is
load-bearing.** `setGroupOpen(group, open)` walks `this.groups` and closes every
top-level group except the one being opened, so the panel never shows two trees at once —
and a nested group must not take part in that, or opening Load Object would close the
Create Model it lives inside and hide itself along with it. `setNestedOpen()` applies the
same one-at-a-time rule among `this.nestedGroups` without touching their parent, while
`setGroupOpen()` always collapses every nested group: a sub-dropdown left open inside a
hidden tree would otherwise spring back the next time its parent opened, in a state the
student did not leave it in. `closeGroups()` is `setGroupOpen(null, false)`, which matches
nothing and therefore shuts everything — that's what collapsing the whole menu and picking
any submenu item both go through.

`_group()` appends whatever children it is handed and tags only the **buttons** as
sub-items, which is the whole of what makes nesting work: a nested group's toggle and its
panel are passed in as ordinary children, and the panel is a div, so giving it a button's
styling would draw a box round the entire subtree.

**Save World / Load World File wear `menu-subitem-alt`, which is now a different COLOUR
(amber) rather than a dimmer version of the submenu blue.** They are not more worlds —
they are the file pair, and one of them is the only button in the menu that does not
change what is on screen. Dimming them said "disabled", so the two buttons a student needs
in order to hand work in were the two that looked switched off.

**THERE IS NO LOAD WORLD DROPDOWN.** It used to hold a short allowlist of four presets
(`MENU_WORLDS` in `WorldPresets.js`, folded together with the `hidden` flag by
`isMenuWorld()` so the DOM menu and `VRMenu` could never drift apart) with the Save/Load
file pair underneath. Both the list and the predicate are gone, and the three buttons that
lived at the bottom of that dropdown are now top-level.

The reason is arithmetic: the gallery holds thirty-six worlds, every one openable by a
`?world=` link, against the four a dropdown could reasonably show. `Get More Worlds` is a
better answer than any list, so it leads the menu.

**What this costs, stated because it is easy to rediscover as a bug: `BOOT_WORLD` is no
longer reachable from inside the app.** A first visit still builds the Park and a refresh
still restores whatever the student did to it, but "give me a fresh Park" now means going
out through the gallery. That used to be the reason `BOOT_WORLD` had to stay on the
allowlist; with no allowlist the constraint is simply gone rather than violated.

**`loadPreset` stays wired up regardless, and must.** World portals call it — the billboard
behind the Library into 1940's New York, the one behind the Park's nature centre into Under
the Sea — and so does the `?world=` link path in `main.js`. Only the *menu* stopped calling
it. `VRView`'s `preset:` dispatch branch is now unreachable and is deliberately left in
place: re-adding preset rows to `VRMenu` should work rather than silently do nothing.

**`hidden: true` survives on the two portal worlds as documentation.** Nothing reads it any
more. It still records the one fact worth keeping — those two have no door except a
billboard inside another world, which is what makes finding them worth anything — and
anything that ever lists worlds again should read it.

**The three promoted buttons keep their colours and lose their `subitem` class names**
(`.menu-btn-gallery`, `.menu-btn-file`), because the names were describing a nesting that
no longer exists. Green for the gallery, amber for the file pair: one leaves the app, the
other two move a world between people, and one of those is the only button in the menu that
does not change what is on screen at all. Both halves of the pair have to be there — a
student who can only load a file can receive someone else's world but never send their own.

**`VRMenu` carries only the file pair**, both `leavesVR`. Get More Worlds is deliberately
absent from VR: it opens a browser tab, which a headset cannot show, and unlike Import or
Draw there is nothing useful left once the student has been dropped out of VR to look at it.

Two things about that URL. It is `window.open(..., 'noopener,noreferrer')`: a cross-origin
page opened without `noopener` can reach back through `window.opener` and navigate the app
out from under the student. And **the mixed-content limitation on
`WEB_BROWSER_DEFAULT_URL` does not apply to it** — that one is an `http:` *iframe* inside an
`https:` page, which browsers block; this is a top-level navigation into a new tab, which
they do not. That distinction is why this link kept working through the whole period the
in-world browser panel pointed at the same host was blank — and it is also why every
`https://edusim3dweb.com/app/` link in `docs/` is fine on the **https** GitHub Pages mirror.

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

**Every world except My World puts a live web browser panel by its spawn point**,
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

**My World is the deliberate exception to almost everything above.** No buildings, no
placards, no activity boards and no browser station: it exists so Create Model has
somewhere with an empty horizon, and every one of those would be an obstacle to walk round
while building. (Its `PRESET_WORLDS` **key is still `empty`** — that string is persisted,
since a world portal carries a target world name in its options and it is what
`buildPresetWorldRecords` is called with, so only the label changed.) It runs the
`default` theme — the one whose numbers are exactly the old pre-theme constants — and
holds five of the Park's own trees. They are not
decoration either: a genuinely featureless plane has no landmarks, so walking any distance
across it stops registering as movement, and nothing else gives the ground a sense of
scale. Their positions are randomised with `Math.random()` at **build** time and then baked
into records, which is why that is safe here and is not safe inside a prop builder — a
fresh load gives a different field, a reload of a saved one gives back exactly the field
the student left. The bearings are an even sweep with jitter rather than five free
draws: independent bearings leave a 3% chance of all five landing behind the student, who
then arrives facing the emptiest possible view of an already empty world.

**The three boards are the one thing standing in it, and they are grouped at the far side
of the working area for exactly the reason above.** An empty field tells a student who has
just arrived nothing about what to do with it, and the two tutorials that turn it into a
workshop were only ever on a website they had to leave the app to read. So My World now
carries a `welcome-board` saying what the place is for, flanked by two `tutorial-board`s —
build a rocket, then program it — at `x = ±15, z = -6`, all facing the spawn.

Three numbers decide that placement, and every one of them is a rule this project has hit
before:

- **Everything from the spawn to about `z = 0` stays clear**, because a fresh construction
  piece lands `PRIMITIVE_SPAWN_DISTANCE` (10ft) ahead and spirals out from there. Boards
  inside that are things to walk round while building, which is the one thing this world
  exists not to have.
- **The outer two sit ~31° off the arrival sightline**, not more. `fov: 70` is *vertical*,
  so a 16:9 screen sees about 51° either side — the same arithmetic that governs where a
  browser station goes.
- **The boards are 10 × 8ft, bigger than an activity board's 6.4 × 5.5, and the copy is
  cut to match.** Type size follows from board size, and `tutorialBoard` auto-fits its
  steps into whatever room the title left (as `cardTexture` does). Feed it a web page's
  worth of prose and the fit drops to a size nobody can read from anywhere — the first
  pass did exactly that, and the fix was to cut the words, not to enlarge the sign.

`tutorialBoard` draws its **block chips before its numbered steps**: a coding card reads
"here is the stack, now go and change it". The chips come from `CATEGORIES` in
`BlockDefs.js`, the same import trick `activityBoard` uses, so the orange `forever` painted
on the board is the orange `forever` the student then drags. `welcomeBoard` exists because
`standingSign` is built around one line plus a subtitle — give it three and the third falls
off the bottom of its own canvas, since it sizes type off the panel height and starts at a
fixed fraction of it. `welcomeBoard` measures its whole block of text and centres it, and
its face is **dark** where the two cards are cream: in an open field the only things to see
are green ground and blue sky, so a third cream rectangle in the row would read as one more
of the same.

`buildPresetWorldRecords(name, { groundHeightAt })` (`WorldPresets.js`) **applies the
theme first, then reads each object's Y off the freshly reshaped terrain.** That order
is load-bearing: doing it the other way grounds every object to the *previous* world's
hills. `main.js`'s `onLoadPresetClick` then calls `player.resetTo(spawn)` — without it
a student who walked 100ft away reappears inside a wall when the world under them is
replaced.

**Everything is generated in code** — `PropKit.js` (shared helpers) plus `src/props/`
(`CommonProps` / `ParkProps` / `MuseumProps` / `LibraryProps` / `MoonProps` /
`MarsProps` / `DinoProps` / `BodyProps` / `CityProps` / `SeaProps` / `Earth`), with `props/index.js`'s
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
  `weave` / `hide`). `hide` is the odd one out and the newest: it is a wrapped CELL pattern
  rather than noise -- a mosaic of tubercles with a crease between each pair, which is what
  reptile skin actually is. `soil` was standing in for it and reads as grit, because clumped
  noise has no characteristic size and skin does.

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
stays at a few hundred draw calls. **Merging is not optional polish, and the i5/i7 target
does not soften this** — every mesh is drawn twice (main pass + the sun's shadow map), and
draw-call overhead is CPU and driver cost that a bigger triangle budget does nothing to
pay off. Anything the layouts place *many* of must be one mesh. Trees, benches and info placards were each originally 6–15 meshes;
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
is why Dinosaur Island holds 129 records at 343 draw calls, fewer than any other world --
and why rebuilding all six animals from 34k triangles to 322k moved that number not at all. Two things to know when editing `DinoProps.js`:

- `scaleAbout(geometry, centre, scale)` exists because a plain `geometry.scale()` also
  multiplies position. Deepening a skull 14ft up an animal with a bare `.scale(1,1.28,1)`
  quietly relocates it to 18ft.
- The `scale` option on each animal multiplies **coordinates**, never `Object3D.scale`.
  `WorldStore.applyTransform()` replaces an object's scale from its record, so a builder
  that scaled its own Group would have that silently discarded on the next reload —
  the same trap the `startup-*` assets' `targetHeight` field exists to work around.

**What makes a theropod read as a theropod** (from rebuilding `tyrannosaurus()` against a
reference illustration — 41ft nose to tail, 13ft at the hip, 12.8k triangles), in order of
how much each one buys:

- **THE DRUMSTICK, and it has to hang BELOW the belly line.** The femur is twice the
  thickness of the shin under it and carries a muscle mass the size of the ribcage. Sized
  correctly but tucked up against the body it hides *inside the body's own silhouette* and
  buys nothing — the first pass had a full-size thigh and still read as a barrel on stilts.
  A separate caudofemoral bulge behind and below the hip is what pushes it clear.
- **A SHORT, THICK, S-CURVED NECK.** Five feet, not ten. A long smooth neck turns the
  animal into a sauropod with teeth.
- **A jaw that is actually ARTICULATED.** Build it closed — which is what "a lower jaw
  under the upper one" produces if you are not thinking about it — and the two tooth rows
  interpenetrate into one welded saw. The jaw line and its tooth row are swung about the
  hinge together, as one piece, by a single `GAPE` angle.
- **A skull built in THREE segments, not one sweep.** Its width has to change along its
  length — wide and deep at the back for the jaw muscles and forward-facing eyes, narrow at
  the snout — and `scaleAbout` can only be applied once per geometry.
- **Countershading plus a dark dorsal stripe and a banded tail**, rather than one flat
  olive from nose to tip. Two gotchas there: the stripe's centre line has to sit **on the
  back's surface**, not on the body axis, or it is entirely inside the ribcage and
  invisible — and the ribcage is scaled 1.12 taller *after* it is swept, so the surface is
  higher than the control-point radii alone say. The `band`/`flank`/`snout` tones are all
  derived from the two colours a record can set, so a custom-coloured animal stays coherent.

Three things this world got wrong first and are easy to reintroduce:

- **A closed canopy needs a much lighter `hemiGround` than an open world.** The hemi
  light is all that fills a hide standing in tree shade, and at the moon-ish `0x2c3418`
  first used here a Triceratops under a conifer read as a featureless black silhouette.
  It is now `0x57633c` at 1.45 intensity, and the animal hides were lightened too.
- **A frond that tapers to almost nothing reads as a black needle, not a leaf.** The
  shared `frond()` helper narrows to a third of its base width, never to a point, and
  builds at 8×5 segments because it gets flattened to 30% thickness and placed by the
  hundred in the ground-fern patches. At the 4 radial sides it started with, the flattened
  blade became a visible diamond in cross-section the moment smooth shading came in.
- **Bones have to clear the trench floor they lie on.** `fossilDig()`'s excavation floor
  is a slab with its top face at y≈0.27; with the spine at 0.55 the ribs swept down into
  it and disappeared, leaving a row of neural spines that read as a picket fence.

#### The rebuild: SMOOTH shading, and closing every gap by construction

All six animals were rebuilt against the i5/i7 target. They had been 2.7k–12.8k triangles
each — 34k for all six, which was 8% of this world's geometry while being essentially all
of its point. They are now 38k–85k each, and the world sits at **762k triangles of
geometry / 1.48M drawn a frame (the sun's shadow map is the doubling) / 343 draw calls /
1.29ms of CPU render**, against 426k drawn and the same 343 calls before. Draw calls did
not move at all, because every animal is still ONE merged mesh.

**Flat shading was hiding the seams, and dropping it is what forced everything else.**
`creature()` used `flatShading: true`, which read as faceted hide and, more usefully,
concealed the crossings where a dozen separately-swept tubes intersect. Smooth shading is
what makes higher segment counts worth paying for and it shows every one of those
crossings — so the gap work below is not tidiness, it is the price of the change.

- **`limb()` replaces hand-placed joints.** It takes the nodes of a limb and emits a tube
  per span, a socket ball at every interior node, and a cap at each open end. An unclosed
  junction is now impossible rather than remembered.
- **Socket size comes from the BEND, not from the fattest nearby radius.** Both tubes
  already have that node's radius there, so the ball only has to cover the flats' inset
  plus the wedge the two end planes leave on the outside of the bend — a factor of
  `1/cos(phi/2)`. Sized from neighbouring radii instead, a 1.5ft joint got a 2.4ft ball and
  every limb in the world read as a stack of balloons.
- **A cone on a curved surface leaves a crescent of daylight**, so `spike()` is rooted by
  default: a ball at three quarters of the base radius, pushed a third of the length back
  down the axis so it straddles the base disc rather than sitting on it.
- **A tube that stops at a real thickness needs a ball; one that tapers to 0 must not have
  one.** Radius 0 closes the end but turns the last segment into a cone — right for a tail
  tip or a horn, wrong for a jaw, a wing finger or a toe.
- **`scute()` sinks its equator into the parent.** A hemisphere placed exactly on a curved
  surface meets it along a circle that only closes if both curvatures agree, and they never
  do.

**Per-vertex colour from POSITION is what replaced the countershading tube.** `mergeColored`
gives each part one flat colour, so hide tone could only change where one solid stopped and
the next began — which is why the pale underside used to be a separate tube and read as a
panel bolted on. A colour map is the obvious fix and the wrong one: `map` × `vertexColors`
multiplies, and every part here has its own UV scale (a 20ft tail and a 1ft toe both run u
from 0 to 1), so no single repeat is right for both. `hideTint()` shades the merged colour
attribute by world position instead — countershading as a smooth gradient up the flank, a
darker back, and a 3D dapple that cannot show a seam. Teeth, eyes and claws are merged in a
second batch the tint never touches.

Five things this rebuild got wrong first, each found only by looking:

- **`geometry.scale()` after a translate moves the part.** The T. rex's antorbital fenestra
  panels were scaled 1.5× wide *after* `scute()` had placed them at x=17.3, so they flew out
  to x=26 and hung six feet in front of the animal's snout as two black lenses. `scaleAbout`
  exists for exactly this and the trap is in this file twice over now.
- **An options object that is SPREAD must use the receiver's key names.** The segment
  constants were `{ tubular, radial }` where `taperedTube` takes `{ tubularSegments,
  radialSegments }`. They spread in cleanly, three.js ignored them, every tube in the world
  silently fell back to the library defaults, and tuning the constants did nothing. Nothing
  errors and nothing warns — the only symptom is that the numbers are fiction.
- **Where the back IS has to be derived from the sweep, not guessed.** Ankylosaurus' carapace
  worked its height out as `3.65 * 0.78 + 3.3 * 0.22`, a plausible-looking line that is not
  what `scaleAbout` does to a swept tube: the real back is at 5.87 and every one of ~120
  osteoderms sat at 3.57, buried two feet inside the animal. An ankylosaur with no armour on
  it is a hippopotamus. Both it and Triceratops' flank scutes now place onto a surface
  function built from the same control points the torso was swept from.
- **RADIAL segments are worth paying for and TUBULAR ones are not.** Radial sides close the
  notch where two tubes meet and stop a limb reading as a prism; tubular segments only
  subdivide along a length that is already smooth. The first pass spent on both, hit 2.2M
  triangles, and the honest reading was that tessellation is not what makes these animals
  better — the anatomy is. A 30-side tube and a 22-side tube are indistinguishable at ten
  feet; the drumstick, the socketed knee and the gum line read from across the clearing.
- **A background prop's cost is multiplied by its placement count.** `araucariaTree` is
  planted **28 times**; rebuilt at nine whorls of eight it came out at 61k each — 1.71M
  triangles of background conifer, more than everything else in the world put together, for
  a backdrop to six animals that between them used 22% of that. It is 7.6k now, still eight
  times the old faceted version, with a real upcurved branch sweep it never had.

Two smaller notes. Triceratops' frill is a **closed lens** — a sphere flattened on one axis
— rather than a cut disc, because a partial cylinder's rim is three surfaces meeting at hard
edges and the seam where it enters the skull is visible from below; and it is **wider than it
is tall**, after one pass stood it ten feet high (a dorsal sail) and another buried its lower
half in the neck (a mane). And the epoccipitals are low **scallops**: thirteen bone-white
0.85ft spikes read as a crown of thorns, which was the loudest wrong thing on the animal.

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

#### The rebuild: HALF WHOLE AND HALF SECTIONED, and grooves instead of rings

Rebuilt against the i5/i7 target, the same pass Dinosaur Island, Under the Sea and New York
each had. The world was **442 calls / 310k drawn / 35 transparent / 24 point lights / 90
records** and is now **385 calls / 633k drawn / 17 transparent / 16 point lights / 88 textures
/ 76 records**, 852ms to build. Draw calls went DOWN, transparency and lighting halved, and
the geometry doubled — every number that costs an integrated GPU moved the right way.

**Every primary organ is now HALF WHOLE AND HALF SECTIONED, and that one decision drove
most of the rest.** A lung, a kidney, a stomach and a cell each teach two unrelated things —
what the outside looks like and what is inside it — and the first pass tried to show both at
once by making the outside *see-through*: five translucent lung lobes, a 55%-opacity stomach
wall, a 22%-opacity cell membrane. That is why this world had the highest transparency and the
highest light count in the app, and it did not even work: a see-through surface loses most of
its apparent colour, so the lungs read as glass bulbs with sticks in them and the cell as a
bubble with confetti in it. A cut face is opaque, costs nothing, shows far more, and is what a
real specimen is. The cuts also stay honest — `cutOutline` closes the section over a flat face,
so every one of these is still a closed solid.

**An organ's identity lives in its SECTION, not in its size.** `organLoft` is the helper the
file turns on: a closed solid whose cross-section changes *shape* along a curving axis, with
control points splined station to station and each ring resampled by a closed Catmull-Rom.
`taperedTube` sweeps a circle and `SphereGeometry` scales an ellipsoid, so with either of them
the only thing that can vary along the length is scale — which is exactly why the first pass
came out as a hall of eggs. A liver is a dome on top of a flat plate meeting at a knife-sharp
anterior border; a lung is domed laterally and flat against the mediastinum; neither is
expressible as an ellipsoid at any resolution.

**A GROOVE IS A MODULATION OF ONE SURFACE, and that is how "leave no open spaces" became
structural here.** `organLoft`'s `warp` callback supplies every fissure, sulcus, hilum, rugal
fold, haustral pucker, tracheal ring and coronary sulcus in the world, and a displacement of a
surface cannot open a gap in it. The first pass built all of those as separate solids laid on
top, and each one had to be sized against a radius it did not own: the stomach's rugae hung
outside the antrum like loose bangles, the lung lobes had daylight between them from every
angle, and the tracheal cartilages read as a spring balanced on a wishbone.

Five more helpers back it up, and none has a path that leaves an open ring: `shellLoft`
(returns `{outer, inner}` so a sectioned hollow organ can be two tissues, with real wall
thickness at the cut mouth), `vessel` (ONE smooth sweep, capped only at free ends — a vessel
is a continuous curve, so unlike an animal's limb it has no interior joins to close),
`vesselTree` (sockets at bifurcations), `blister` and `tint`.

Traps this rebuild hit, most of which generalise:

- **`mergeVertices` + `computeVertexNormals` on a merged organ DESTROYS it.** Every part
  arriving at the merge already carries correct smooth normals, and `mergeColored` passes the
  normal attribute straight through. Re-welding afterwards throws away `organLoft`'s seam weld
  — so a hard line runs up the flank of every organ — and where a cut face has left zero-area
  triangles it computes garbage normals from them and smears those across the neighbours. A
  whole lung rendered as creased fabric. It is also 300ms per organ, which at eighteen
  exhibits is the difference between a world that loads and one a student waits for.
- **A cut outline's kept points are one CYCLICALLY contiguous run.** Scanning 0..n-1 and
  pushing every point past the plane looks equivalent and is not: the moment the run wraps
  past index 0 the array comes out as `[0, 6, 7, …]`, the outline crosses itself, and the loft
  renders as a folded curtain you can see through.
- **A per-vertex tint MULTIPLIES, so it cannot turn red into blue.** The heart's red-left /
  blue-right convention is applied across one solid with the boundary in the interventricular
  sulcus — which means the colour change lands on a real landmark instead of on the seam
  between two balls, which is what the first pass had. It only works because the ventricular
  mass is painted with a WHITE sentinel and the tint supplies the actual colour; painted
  myocardium red first, the tint could only ever produce darker reds.
- **EVERY WARP FREQUENCY IS BOUNDED BY THE SAMPLE COUNT.** The brain's gyral field ran at 26
  cycles over 66 rows — two and a half samples per ridge, under Nyquist — so instead of gyri it
  produced aliasing and the brain rendered as a crumpled paper bag with tears in it. Nine
  samples per cycle is what makes a ridge a ridge, and where detail has to be finer the sample
  count goes up rather than the frequency.
- **A SULCUS IS A NARROW CUT, not the trough of a wave.** Feeding a wave field straight in as
  a displacement gives rolling undulation, which at any amplitude reads as a dented pillow
  because the ridges and the valleys are the same width. Cutting only where the field crosses
  ZERO turns the same field into a branching network of clefts between broad gyri — and the
  transfer function has to be a GAUSSIAN, not a clamped ramp on `|field|`, because anything
  built on an absolute value has a kink at zero, which is the bottom of every sulcus, so each
  one came out as a hard crease.
- **Cleft WIDTH is bounded by the mesh, not by anatomy.** A real sulcus is ~3mm on a 14cm
  brain, which at this model's twelvefold enlargement is one quad. These gyri are deliberately
  broader and fewer than a real cortex's.
- **Several independent displacements that each look reasonable can exceed the section
  radius**, at which point the surface passes through its own axis and turns inside out. The
  brain clamps the total to a third of the local radius.
- **`blister` must be a CLOSED sphere, never a partial one.** A partial sphere's rim is a hole
  and its inside is back faces, so unless the rim is completely buried you see straight
  through it — and half the time it is not, because the pons is fatter than the brainstem it
  bulges from and an adrenal gland is wider than the pole of the kidney it caps. Both rendered
  as pale wedges with holes in them. `sink` now flattens a closed sphere instead of cutting it.
  Same rule killed the neuron's target cell, which was rendering as an odd floating hoop.
- **A `CircleGeometry` cannot be displaced into a dimpled surface.** It is a triangle fan with
  one centre vertex and no interior vertices, so displacing it just swings each rim vertex
  about the centre and shreds the fan into loose triangles standing at angles. The villi
  patch's mucosal floor left half a dozen of them lying on the ground like dropped petals; it
  is a low cylinder now.
- **A capillary net GRAZES its alveolus, and the tolerance either side is inches.** At 2.05
  against a cluster reaching 2.28 each ring was buried and only the arc crossing the front
  showed, so a net read as one red bar and one blue bar laid across the sac; at 2.62 they
  cleared it entirely and read as three hoops orbiting it, like a diagram of an atom.
- **A shellLoft's two cut rims wind opposite ways, and so do its two end annuli.** Each of the
  four strips faces a different direction, so one winding rule cannot serve all of them — and
  getting one wrong does not make it invisible, it makes it *lit from behind*, so it renders
  as a hard black band along the cut.
- **A sectioned face wants FLAT PLATES, not solids.** The kidney's medullary pyramids were
  real cones and its calyces real hemispherical cups, and eight of those stacked up an arc read
  unmistakably as a spine with vertebrae. A section shows *cut* surfaces, so a triangle drawn
  in the plane says "pyramid" and a solid does not. The pyramids also have to be broad-based
  and short: taller than wide — which is what the word suggests — they are a row of shark's
  teeth.
- **A vessel has to come from somewhere.** The four renal vessels ran halfway to the midline
  and stopped, so the exhibit had four fat coloured bars floating between the kidneys. Two
  short trunks for the aorta and the vena cava turn that into a circuit.
- **Work out which way the model is LYING.** The rib cage is a row of hoops spread along Z with
  the spine on top — a cage on its back — which puts the breastbone down the middle of the
  tunnel floor, not upright at one end where the first pass parked it, twenty feet from the
  nearest cartilage it was meant to join. Vertebral BODIES are drums whose axis runs along the
  spine, so they lie on their sides; left upright they are a stack of coins seen end on.
- **A cutaway has to open TOWARD THE APPROACH.** The cell's wedge was centred on the section's
  u = 0, which is +X, so the exhibit presented a smooth pale ball to everybody who walked up to
  it. Section fraction 0.75 is +Z, and the covered range has to wrap past 1.
- **A wide shallow dome at eye height is seen edge on, so what a student looks at is its
  UNDERSIDE.** The lungs' diaphragm rendered as a black smile slung under the exhibit until
  its skirt was run down to the plinth top, leaving no underside to see.
- **A missing import silently deletes a whole class of exhibit.** `buildProp` throws and
  `WorldStore` catches per record, so dropping `box` from the import list took out all nine
  anatomy charts and the only symptom was a record count nine short and nine console lines.

**The palette was WIDENED, which is the second half of this pass.** Anatomical models are
polychrome and the first pass was not: nearly everything was one of four warm red-browns, so a
liver, a kidney and a heart read as the same object three times. Specimen colour is a code a
student can learn — scarlet is oxygenated, indigo is not, yellow is nerve, green is bile,
blue-white is cartilage — and `TISSUE` now uses the whole of it. On top of that, **one accent
hue per body SYSTEM** (respiratory sky blue, circulatory crimson, digestive amber, urinary
green, nervous violet, skeletal bone, cellular magenta) is carried by every exhibit's plinth
ring, name plate and placards. It is the cheapest legibility in the world: from the far end of
the hall the only thing a student can resolve is a coloured ring, so a violet one means nervous
system before a single word is readable. The `voyage` theme itself kept its cool-against-warm
logic — that is still the whole reason the exhibits read — but over a much wider range, since a
near-monochrome slate hall reads as fog whatever is standing in it.

**Four kinds of prop were REMOVED to pay for the organs**, and none of them was about human
anatomy: four park benches, the project's own logo banner reused as an entrance sign, the two
charts that drew in two dimensions what the rebuilt models now show in three a few feet away,
and eight of the twenty-four light orbs. Orbs are the most expensive thing in this world — a
per-fragment forward-pass cost on integrated graphics — and each chart is a 768×1024 canvas
texture out of shared system memory.

**Per-prop, measured**: brain 33.2k triangles (was 4.8k), lungs 31.9k (was 15.2k), cell 31.1k
(was 9.2k), intestines 22.1k (was 11.3k), neuron 20.9k (was 8.1k), heart 19.7k (was 10.3k),
villi 19.0k (was 6.2k), DNA 17.1k (was 7.4k), stomach 16.9k (was 8.5k), rib cage 16.3k (was
5.2k), kidneys 15.3k (was 8.0k), alveoli 12.8k (was 11.7k), micro-sub 11.7k (was 4.8k), artery
tunnel 10.2k (was 3.9k), liver 9.7k (was 3.7k), blood cells 7.5k (was 5.1k), plinth 1.3k,
chart 0.13k. There is well over half the envelope spare, recorded as headroom rather than
spent.

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

Three choices keep this world the lightest-rendering populated one in the app: every prop
merges to one or a few vertex-coloured meshes, marquee bulbs are *painted* on the sign
canvas everywhere except the one marquee a student stands directly under, and the lamps'
lit glass is **opaque and merged into a single mesh per lamp**. A dozen lamps at three
translucent glass meshes apiece was 36 transparent draws — the largest block of
transparency in any world here — for glass at opacity 0.92 that was visually
indistinguishable from solid.

#### The rebuild: LOFTED HULLS, MITRED MOULDINGS, and five cars instead of ten

Rebuilt against the i5/i7 target, the same pass Dinosaur Island and Under the Sea had. The
world was **383 calls / 234k drawn / 21 transparent** and is now **396 calls / 667k drawn /
12 transparent / 4 point lights / 57 records**. Draw calls barely moved and transparency
went DOWN, because every prop still merges to one or a few meshes and there are half as
many vehicles.

**The whole file was axis-aligned boxes, and for a city of stone that is nearly
defensible.** A building IS a box; the interesting part of one is its mouldings. It was
never defensible for the object this world is actually about. A 1948 automobile has no flat
panel anywhere on it — the hood crowns, the fenders are pontoons swept over the wheels, the
roof falls into the deck in a single curve — and the hero cab is parked 24ft from the spawn
*facing the student*, which is as close as anything in this app is ever looked at. It read
as a carton on four cylinders.

Four helpers replace the boxes, and between them they make the gap rule STRUCTURAL rather
than remembered: `bodyLoft()` (a closed hull whose section changes shape along its length),
`sweepProfile()` (a closed outline swept on a **parallel-transport** frame — not Frenet,
which flips through the inflection every wheel arch has), `mouldedRing()` (a moulding
mitred round a rectangle) and `extrudeOutline()`. None of them has a path that leaves an
open ring or an unmatched edge.

**The car is two lofted hulls and everything else is applied to their own surface
functions.** The lower hull is one closed solid from tail to nose — deck, doors, cowl, hood
and the prow the grille hangs on — whose superellipse roundness changes along the length:
near-rectangular with a soft corner through the doors, a broad shallow crown over the hood,
fully round at the prow. The cabin is a second hull rooted four inches INSIDE it at the belt
line, and the glass is applied to the cabin's own surface, so **the body colour left showing
between the panes IS the pillar** — it cannot be a hair out of line with the roof it holds
up, because it is the roof.

`mouldedRing()` is most of what separates the rebuilt buildings from the first pass, and the
trick that makes the mitre exact is that a profile point standing `out` proud of every face
traces a rectangle of half-size `(halfW + out, halfD + out)` — so a cornice is just a stack
of rectangles and the corners meet at 45° with no mitre arithmetic anywhere.

**Encrusting soot is a COLOUR problem, not a geometry one.** `soot()` runs on the merged
geometry, multiplying vertex colours by broad blotching plus vertical grime that strengthens
toward the bottom of the elevation. Real coursed masonry is never one flat colour and sooty
1949 New York least of all; as geometry that would be hundreds of solids per facade.

Traps this rebuild hit, most of which generalise:

- **A patch lying on a faceted loft has to clear the host's SAGITTA, not its surface.** Both
  the patch and the body approximate the same smooth section at *different* sample spacings,
  so between two of the patch's samples its quad cuts inside the body's by about
  `r(1 - cos(π/sides))` — 0.017ft on a 2.3ft cabin at 26 sides. Lifted the 0.004 that looks
  generous on paper, every roof in the world z-fought into a black-and-yellow checkerboard,
  which reads as a texture bug rather than a depth one.
- **A windscreen and a fastback backlight sit on the section's CROWN (u = ¼), not its flank
  (u = 0).** Both are surfaces swept by the top of the section as z advances. Centred on the
  equator by mistake they land down the side of the car where the doors are, and the symptom
  is "the cabin has no glass at all".
- **Translucent glass needs something dark behind it.** Every pane is a slab on the cabin's
  own surface, and what you see through it is the cabin — which, once the cabin was painted
  body colour, was yellow. The windows read as dirty plastic. One inset dark loft is the fix.
- **A prow that tapers to a point has nowhere to hang a grille.** A 1948 front end is
  essentially the grille: the body carries a full section right up to a gently bowed face.
  Run the loft to a rounded tip and every chrome bar ends up buried inside the bodywork.
- **A bumper is wider than the nose and hangs below the fender crowns, so its ends have
  nothing behind them.** The blade stood in mid-air past the corner of the bodywork with
  daylight above and below. The valance APRON under the grille is what a real car closes
  that with, and it doubles as the thing the blade bolts to. Same for the headlights: seated
  0.12ft too high they float clear of the wing, which is the loudest possible "these are two
  separate objects".
- **A lathe is built about +Y, so its detailing lives on the +Y face** — `rotateZ(+90°)`
  sends that inboard and seals the whitewall and hubcap inside the car. The symptom is a
  wheel that is a plain black disc, which looks like a missing material rather than a sign
  error. And the whitewall is a BAND: run it from hubcap to tread and the wheel is a pale
  disc with a thin dark rim, which is a modern low-profile tyre and the exact opposite of
  what these cars ran.
- **`extrudeOutline` lays its UVs out in FEET**, which is right for a curb carrying a tiling
  bump map and wrong for a canvas awning whose stripe must span the awning exactly once —
  clamped past u = 1 the whole canopy came out as one flat off-white slab.
- **A scallop lathed about Y is a saucer.** The awning valance has to be a scalloped
  *outline* extruded through its own thickness, or every tab lies flat instead of hanging.
- **A bus needs TUMBLEHOME or its wheels cannot be seen.** At a boxy section the body is full
  width to the ground and the wheels, which sit inboard, are sealed inside the skirt. Rounding
  the section below the waist frees them — and then pinches the underside to a keel, so a
  flat-bottomed skirt has to go back inside it or the wheels emerge from an edge and read as
  hanging in space. Its end stations also carry a full section: tapered to nothing, the front
  bumper had no bodywork within four feet of it.
- **`surfacePatch` can only lie on a loft's swept SIDES, never its end cap.** Asking for the
  bus's windscreen gave a band across the roof; the screens at each end are flat panels.
- **`detail: 'far'` is what makes eight background towers affordable.** A window a student can
  walk up to earns a frame, mullion, transom, moulded sill and lintel; one on the next street
  at 130ft earns its reveal and a sill, and nothing else survives the distance.

**Five cars, down from ten** (three cabs, two sedans, plus the bus, which is a different
vehicle and the only thing on the street giving the cars a size to be judged against). Each
car is about nine times the model it was, and a street packed kerb to kerb spends that
entirely on cars nobody walks up to while hiding the road, the kerbs and the markings under
a solid rank of metal. The two the activity boards name are both still there, which is the
one constraint here that is not a matter of taste.

**Per-prop, measured**: taxi 25.8k triangles (was 2.4k), sedan 25.0k, bus 7.1k, bishop's
crook lamp 5.0k (was 2.3k), near city building 8.6k (was 3.0k), far city building 4.6k,
Broadway theatre 20.9k (was 12.7k), Bond building 22.9k (was 13.4k), theatre front 12.5k,
subway entrance 6.5k (was 1.4k), storefront row 2.4k, street 2.3k. There is still roughly
half the envelope spare, which is recorded here as headroom rather than spent: the models
read correctly at the distances they are actually seen from, and tessellation nobody can
resolve buys nothing at any budget.

### Under the Sea, and how to make a world feel like a VOLUME

A tropical coral reef thirty feet down, modelled from a photograph, in
`src/props/SeaProps.js` + `seaLayout()`. Like New York it is `hidden: true` and reached
only through a portal — the billboard in the 24ft slot behind the Park's nature centre,
with a `standing-sign` wayfinder out on the lawn as the only signpost to it. The portal
plumbing is unchanged; see the New York section above for how a door works.

**Everything specific to this world follows from one problem: it is the only world that is
not a landscape.** Every other preset is objects standing on a floor under a sky, and the
sky is empty because there is nothing in it. Water is a *material* the student is inside,
and the entire difference between this world and a blue field with fish standing in it is
four props that carry no information and teach nothing:

- **`waterSurface()` — the ceiling, and it is OPAQUE.** The instinct is to make water
  translucent; from beneath, a wind-rippled surface is a *mirror*, and you cannot see
  through it except at the steepest angles. So an opaque plane is both more accurate and
  free, where a transparent one at 360ft square would be the most expensive object in the
  app. It is self-lit (`emissive` + `emissiveMap`), because the sun is on the far side of
  it and without that the brightest thing in the scene renders as a dark grey slab.
  `castShadow = false`, or it seals the sun out of the entire world — the museum
  skylight's trap at world scale.
- **`lightShafts()` — additive quads, `fog: false`, and ALL LEANING THE SAME WAY.** Sunbeams
  are parallel; they only appear to fan out through perspective. The first version gave each
  shaft its own bearing and the result was unmistakably a laser show. `fog` must be off
  because three.js fogs a fragment *before* blending, so a fully-fogged additive fragment
  adds the fog colour onto a background that is already the fog colour and the far end of
  every shaft becomes a bright blue wall. They also have to be **wide** — narrower than
  about 1:10 against their length and a beam of light becomes a rod of glass falling
  through the water.
- **`marineSnow()` — a `THREE.Points` cloud**, one draw call for the whole volume, and the
  cheapest immersion in the file by a wide margin. Deliberately faint: turned up far enough
  to actually notice, it stops reading as debris and starts reading as a starfield.
- **`bubbleColumn()` — bubbles that GROW as they rise**, because the pressure squeezing them
  drops the whole way up. All of them in one translucent mesh.

**The `sea` theme's numbers are the other half of it.** The fog is by far the closest in the
app (30/155) and is the single biggest reason the world reads as water — open it up to the
Park's distances and it becomes a blue field. `hemiGround` is `0x9db2a8`, the *lightest*
ground bounce anywhere in this project, for two reasons that only apply here: light in
water is scattered by the water itself so it genuinely arrives from every direction, and
the floor is white carbonate sand, which is a far better reflector than grass. What forced
the number was the shark — its white belly faces down, so the sun never touches it and the
ground bounce is the entire light it gets. At a normal outdoor value the countershading
rendered as the same olive grey as its back and the animal read as a lump.

**The composition is the photograph's, and the pairing is the point**: reef wall across the
front-left, open sand to the right. The reef alone is a wall of clutter with nowhere to
stand back and look at it from; the open sand alone is a desert. The sharks are placed with
a `y` (15–20ft above the floor), which is what makes the world a volume rather than a
field, and the far one is smaller and half-lost in the fog — a single animal at a known
size gives the fog nothing to measure itself against.

The four primary models, and what carries each:

- **Reef shark** — the first dorsal has to be BIG with a concave trailing edge; hard-edged
  countershading; a heterocercal tail (upper lobe much longer, or it is a tuna); pectorals
  held out and down like wings, since it cannot stop swimming; five raked gill slits.
- **Moray eel** — the mouth never closes, because a moray has no gill covers and breathes
  by gaping. Built closed, the two tooth rows also interpenetrate into one welded saw, so it
  uses the same single-angle jaw swing the T. rex does. No paired fins anywhere: add
  pectorals and it becomes a fish.
- **Octopus** — the eye is the whole animal: a domed lens set high with a **horizontal bar**
  pupil, not a round one. Eight arms that each do something different (an even fan of eight
  is a fairground ride). Suckers are placed from each arm's own sampled curve, not from the
  tube's UVs, because a swept tube's Frenet frame twists unpredictably along a curling path
  and there is no fixed `v` that means "underside".
- **Sea star** — arms taper from a real disc, not from a point; flat on the bottom and domed
  on top; and the beaded tubercles are the animal, the same way the goose's feather edging is.

Traps this world hit that generalise:

- **A hole has to be built VOID FIRST.** `reefCave()` builds the five faces of the recess
  and then places rock around them from those dimensions. Built the other way — boulders
  with dark slabs shoved in behind — it produced neither a hole nor a cave: the slabs stuck
  out through the rock as black fins and the mouth was a two-foot slot with a boulder in it.
  The void is also deliberately **1.6× the opening**, because sized to match, its four
  straight edges land exactly at the gap and the cave reads as a black *rectangle* cut into
  the reef. Oversized, every edge hides behind rock.
- **Flat colonies are right on sand and wrong on a slope.** `coralGarden`'s `mound` option
  drapes a garden over a bommie (without it the rock stays bare grey and the coral rings its
  foot, which is exactly backwards — reef rock *is* old coral). But plates and encrusting
  mats are essentially flat, so on a mound's flank they lie against the rock and read as
  coloured stickers. Same colonies, opposite verdict, purely because of what they are seen
  against — so a draped garden picks from a different kind list. The lean is also capped
  near 17°: at the rock's true slope a coloured slab reads as litter dropped on it.
- **`SphereGeometry`'s height-segment floor is where the triangles go.** `ball()` floors at
  3, not 5, and that one character was worth about 60,000 triangles: nearly everything here
  is a *small* sphere asked for at detail 4 or 5 — a fish's eye, a tentacle tip, a tubercle
  — and a floor of 5 quietly made each one a 50-triangle ball a few inches across. The
  opposite bound matters too, though: at **4 width segments a sphere is square in
  cross-section**, and 130 anemone tentacles tipped with detail-4 balls read as pale cubes
  on sticks. Six is two dozen triangles and unmistakably a bead.
- **A near-field colony has to be big enough to have a shape.** Scaled down to a few inches
  the sand-level gardens between the spawn and the reef came out as scattered coloured chips
  — litter on the sand rather than life on it. Fewer and bigger is the fix, not more.
- **Open water gives a light orb nothing to be attached to.** Five orbs through the reef each
  read as a glowing ball hanging in mid-water — the Moon's lesson with no roof anywhere to
  rescue it. There is now exactly ONE in the world, buried *behind* the cave's back wall:
  orbs do not cast shadows here, so its light passes through the rock and lifts the recess
  off pure black while the core itself can never be seen.
- **Caustics need a MIN of wave trains, not a sum.** Summed, the strongest train dominates
  and the ceiling comes out looking combed; taking the minimum lights a pixel wherever any
  train is at a node, and the three families of bright lines overlap into the closed
  cellular web a real caustic pattern is. Every frequency must be an integer multiple of
  2π/size or the sheet's seam draws a straight line across the sky.

#### The rebuild: NO THIN SHEETS, NO OPEN ENDS, and a section that changes shape

Rebuilt against the i5/i7 target, the same pass Dinosaur Island had. The world was **271
calls / 484k drawn** and is now **277 calls / 1.53M drawn / 763k of geometry / 1.35ms of
CPU / 6 transparent meshes / 1 point light / 86 textures**, 160ms to build and 1.4s to load.
Draw calls barely moved, because every prop still merges to one or two meshes.

**Three things were capping the whole file and they only make sense together.**

- **Everything was `flatShading: true`.** It reads as low-poly art, and — exactly as on
  Dinosaur Island — it was also hiding the crossings where a dozen swept tubes intersect.
- **Every fin, blade and frond was a flat extrusion rendered `DoubleSide`.** A shark's
  dorsal at 0.07ft thick with a square edge is a piece of card, and edge-on it vanishes.
  `solidSurface()` replaces them all with closed lens-section solids and `DoubleSide` is
  gone from every animal in the file.
- **Every body was a constant-aspect sweep.** `taperedTube` sweeps a CIRCLE, so lateral
  compression could only be faked by scaling the finished sweep — one ratio for the whole
  animal. But a fish's section changes shape ALONG its length: a shark is round amidships,
  wider than deep across the head, and a thin vertical blade at the tail stalk.
  **`bodySweep()` splines width, depth above the axis and depth below it independently**,
  and it carries more realism than any amount of tessellation.

**The gap rules, which are the answer to "leave no open spaces", and every one is structural
rather than remembered:** `chain()` emits a tube per span, a socket ball at every interior
node sized from the BEND (`1/cos(phi/2)`, not from the fattest nearby radius) and a cap at
each open end; a tube stopping at a real thickness gets a ball and one tapering to 0 must
not; `spike()` is rooted; `dome()` sinks its equator; and `solidSurface()` closes its own
rim with BOTH windings — eighty triangles against a whole class of inside-out bug.

Traps this rebuild hit, most of which generalise:

- **`computeVertexNormals()` on a NON-INDEXED geometry can only compute FACE normals.**
  Everything from `PolyhedronGeometry` is non-indexed, so every rock in this world was
  flat-shaded whatever the material said, and subdividing only made the facets smaller.
  `mergeVertices()` first is the whole fix — and it drops the vertex count sixfold.
- **A wrapped grid's duplicated SEAM column needs its normals welded.** A swept body or a
  lathe has to duplicate the vertices at u=0 as u=1, because one vertex cannot carry both
  ends of the texture coordinate — and `computeVertexNormals` then treats the copies as
  unrelated and creases the surface exactly where it should be smoothest. On a reef mound
  that is a hard line from the apex to the sand, visible from across the world.
- **A garden draped over a mound and the mound itself must read ONE height function.** The
  first pass had the rock as a heap of random lumps and the garden assuming a smooth dome;
  they disagreed by several feet and a third of every draped garden hung in open water
  beside its own rock. `moundHeight()` is now shared, so the mound can be as irregular as it
  likes. Making the rock a clean half-ellipsoid instead was the SECOND mistake — that reads
  as a giant marshmallow, and satellites seated at a fraction of the local height sit
  *inside* it and contribute nothing.
- **Countershading cannot be a function of height alone.** A pectoral fin is a plate held
  well below the body's centre line, so every vertex on it — top face and bottom alike —
  sits at a height the belly rule calls white, and both pectorals rendered as solid white
  paddles. What countershading IS, is which way a surface faces, so anything outboard of the
  body takes its tone from its own **normal** instead.
- **`mergeColored` OVERWRITES a part's existing vertex colours**, which wiped a finished sea
  fan to white the moment it was handed back as one part. `mergeParts()` in this file adds
  `keepColor` and a per-part `tint` — and the tint is applied BEFORE the part's transform,
  so "distance from the axis" is measured from an axis that is still where it was authored.
- **A relief tile has to be sized to the SURFACE, not to the number of parts.** A mound
  shell's u runs once round fifty feet and its v across nine, so a square repeat of 6 put a
  nine-foot stone cell on the rock — which is not grain, it is another lump. Same arithmetic
  stretched the shark's denticles 3:1 into lengthwise streaks down its flank.
- **Encrusting growth is a COLOUR problem, not a geometry one.** There is almost no bare
  rock on a living reef, and covering a nine-foot mound in solids costs hundreds of them —
  fourteen mounds later that is the world's whole budget spent on scenery. A per-vertex
  paint of irregular patches does it for free. Two calibration notes: six saturated hues at
  full strength turns every mound into a pastel Easter egg, and the patch SCALE is a spatial
  frequency in feet — at 0.5 one patch spans twelve feet and a mound comes out as one flat
  wash.
- **A branching recursion cannot draw a net**, because it can only ever divide. A gorgonian's
  branches REJOIN, and without those cross-links a sea fan is a small purple tree. Link every
  node rather than only the tips, and collect the candidate pairs and SHUFFLE them before
  capping — an in-order pass spends the whole allowance on the first sub-branch the
  depth-first walk reaches, and meshes one corner solid while the rest stays bare.
- **A ceiling of caustics is a contrast problem.** A caustic web genuinely is a net of bright
  lines, and drawn at full strength that is what the sky reads as: lace wallpaper. Thirty
  feet of water diffuses it into soft dapple, so the highlight only ever sits a little above
  the water colour. Inverting the exponent to broaden the bright regions is the other wrong
  answer — most of the sheet goes bright and the pattern reads as dark speckles on white.
- **A sprawled octopus's web sags into the seabed.** Its arms are already almost on the sand,
  so a catenary of any realistic depth buried the one feature that separates an octopus from
  a spider. Clamp it above the floor.
- **Papillae scattered in unrotated coordinates on a mantle that IS rotated** hang in the
  water above the animal like flies. Keep the mantle's frame as a matrix and place onto it.
- **Colour on open sand is litter.** The five gardens between the spawn and the reef take a
  muted olive-and-ochre palette, because a handful of full-strength reef colours scattered
  on bare pale sand reads as rubbish dropped on it — and the reef's own colour then arrives
  all at once when a student reaches the wall, which is the point.
- **The reef has to be a WALL.** A ten-foot mound thirty-five feet away stands under ten
  degrees above a 5ft eye line, which is a rock. Height is also free here: a bommie's cost
  goes with its RADIUS, since that sets the crust count and the shell's ring spacing.

**`tools/export-preset-world.mjs` exists because of this rebuild.** A preset world is a list
of records and building it touches no geometry, so it runs in node — except that the ground
height under each object comes from raycasting the real terrain mesh, which needs a renderer
and a rendered frame. The tool calls `SceneSetup`'s own `terrainHeightAt` (exported for
exactly this) and builds TWICE: once to discover which theme the layout asked for, and once
for real. Skip that and every object comes out a foot off the sea floor, grounded against
the default theme's hills. Validated against the committed `dinosaur.json`: every prop,
option and x/z identical, y within 1/8 inch (analytic vs raycast-interpolated terrain).

### LoftKit, and the rebuild of Ancient Egypt / Ellis Island / Da Vinci's Studio

`src/props/LoftKit.js` is the shared solid-modelling kit those three worlds were rebuilt on.
It exists because all three failed in the *same* three ways, and one copy of the answer is
better than three: a hull that is a scaled tube, detail laid on a curved surface as separate
solids, and cloth built as a zero-thickness `DoubleSide` plane.

**CityProps keeps its own private originals and that is deliberate.** It is verified and
shipped, and refactoring 3,500 lines to import from here would risk world 9 for no gain a
student can see. Two implementations of `bodyLoft` therefore exist; the drift risk is
accepted and recorded rather than traded for that one.

**What it provides**: `solidLoft` (a closed solid whose SECTION CHANGES SHAPE along a
curving axis, with a `warp` callback), `loftSampler` (+ `tAtD`/`uAtB` inverses so anything
applied to a loft is placed by asking the loft where its own surface is), `grooveAt`,
`sweepProfile` on parallel-transport frames, `mouldedRing`, `extrudeOutline`, `revolve`,
`solidSurface`, `chain`/`spike`/`dome`, `gearWheel`, `tintGeometry`/`weather`, `mergeParts`,
`smoothed`.

Five bugs came out of this rebuild that are worth more than the models, because each one is
invisible in the obvious way and each cost a real amount of looking:

- **AN ODD PERMUTATION FLIPS HANDEDNESS, SO EVERY `axis: 'y'` LOFT WAS INSIDE OUT.** `'z'` is
  the identity; `'y'` and `'x'` move the third coordinate into another slot, which is a
  single transposition, and a mirrored basis reverses every cross product — so triangles
  wound counter-clockwise in the loft's frame come out clockwise in the world. Under a
  `FrontSide` material that does NOT look like a missing surface: the outward faces are
  culled and you see the far inner wall lit by its own inverted normals, which reads as a
  dark, muddy, roughly-right shape. It survived a first inspection on the Statue of Liberty
  and was only caught on the Sphinx, whose nemes came out flat dark brown while its vertex
  colours *measured lighter than the body's*. Fixed by XOR-ing the winding with the axis's
  handedness, not by re-ordering the mapping — re-ordering silently swaps which lateral `w`
  and `up`/`dn` mean and breaks every existing caller.
- **A CAP MUST NOT SHARE VERTICES WITH THE SIDES.** `computeVertexNormals` averages every
  face touching a vertex, so an extruded block's corners blended their two side normals with
  the cap's and tilted them diagonally outward. A plain rectangular block then shades like a
  pillow, and a wall built of them reads as a grid of **diamond studs** rather than as
  masonry — which is exactly how the valley temple and every mastaba first came out.
  Duplicating the rim for the caps costs 2n vertices and buys flat faces.
- **A CENTRE FAN, NOT A FAN FROM VERTEX 0.** A vertex fan is correct only for a CONVEX
  outline, and two of the shapes this kit exists to extrude are a GEAR and an eleven-pointed
  STAR FORT. Fanning a gear from a vertex on its root circle throws triangles straight across
  the tooth gaps.
- **A WARPED LOFT'S END CAP IS A VISIBLE ROSETTE.** The fan runs from the section's
  *un-warped* centre out to the *warped* rim, so wherever a warp is running the cap shows as
  a ring of scalloped wedges. It is still closed — but it has to finish somewhere you cannot
  see it. The Sphinx's body ended 0.7ft outside the chest meant to cover it and had a stone
  rosette sitting between its front paws.
- **A WARP THAT RECOVERS HEIGHT FROM THE SECTION IS AXIS-SPECIFIC.** `bandWarp` gets a
  point's height from `sin(2πu) × half-height`, which is right on a loft running along Z
  because its `up`/`dn` *are* the vertical. Reused on a loft running along Y those are DEPTH,
  and the same expression produces rings concentric about the vertical axis: the Sphinx's
  breast came out with a radial fan carved into it that read unmistakably as a scallop shell.
  On a vertical loft the height is simply `d`.

**Nyquist bit twice more, and the symptom was different both times.** The Sphinx's weathering
bands ran thirteen 0.9ft bands over the ~23 samples the +X flank gets from 46 sides — under
two samples each — and the body rendered as a featureless bar of soap rather than as anything
faceted. The nemes ran eighteen pleats at three samples each and rendered *dark*, because an
under-sampled warp computes garbage normals from near-degenerate quads. **A flank spans only
HALF a section's u range**, which is the arithmetic that catches people out: sides ÷ 2 is the
budget, not sides.

**Under a bright sky a dark surface cannot render dark.** The Ellis theme carries a
1.45-intensity hemisphere over a 2.2 sun, and a black hull authored at 0.10 albedo measured
about 45% grey on screen — so the steamship read as battleship grey and no amount of adjusting
the paint BANDS touched it, because the bands were never wrong. Ship's paint also is not
metallic: metalness 0.22 plus a `metal` relief at repeat 12 scattered a specular sheen across
the whole flank. This is the exact inverse of the CityProps `metalness: 0.9` trap.

**A WINDOW HAS TO BE BUILT FORWARD OF A SOLID WALL.** There is no CSG here, so a lofted brick
body has no opening in it and anything placed at a z inside the wall plane is sealed in the
brickwork. Ellis's three great Registry Room windows had their reveal 1.35ft back and their
glazing 0.5ft back and rendered as **bare brick with a stone frame round nothing**. Same rule
as Machu Picchu's niches: dark panel a hair proud, glazing proud of that, mullions proud of
that, architrave projecting furthest — the frame's own shadow is what reads as a recess.

**A DECK CANNOT BE WIDER THAN THE HULL AT ITS OWN STATION.** The steamship's planking was
laid `beam × 1.7` wide and `halfL × 1.5` long on a hull whose ends taper to 2.7ft, so at both
ends it hung feet out past the plating as one pale slab covering the black topsides. Clipping
each plank to the hull's own half-width along its run is what `tAtD` is for. The same fix
applies to the solar barque.

**A LOFT IS A CLOSED SOLID, SO ITS TOP IS THE DECK.** A white sheer strake defined only by
HEIGHT painted the whole weather deck as well as the sides — and at the bow, where the section
is narrow and tall, that came out as a broad flat white wedge reading as polystyrene stuck to
the front of the ship. Qualify the band by how far OUT the point is, not just how high.

**Paint bands follow the LOCAL SHEER, not absolute height.** The hull's sheer rises 3.5ft
toward the stem, so bands fixed in world Y are right amidships and wrong at both ends.

#### What each world's models actually needed

**Ancient Egypt.** The obelisk was **36 triangles** — a four-sided prism with a photograph of
glyphs on it, for the most heavily carved object in Egypt. It is now a lofted shaft carrying
real **sunk relief** (`sunkRelief`), which is the technique Egypt used outdoors because raised
carving goes flat by noon; the paint survives *in the cuts*, recovered in the tint by
comparing a point's radius against the section's nominal one. **Egypt was polychrome**, and
the six-mineral palette (Egyptian blue, malachite, red and yellow ochre, carbon black, gypsum
white) is one a student can learn — it is by far the most striking thing the palette widening
added, and it is visible on the Dream Stela from across the plateau.

The Sphinx's weathering bands are grooves derived from the section's own height, so they
cannot float off the flank the way eight box beams did. **The height budget is the thing to
get right**: the back is 44ft and the nemes tops out at 66ft, so the body takes two thirds and
the head and neck the rest. Built with the body's back at 13.0 of a 13.2 total the head had
nowhere to go and sat sunk into the shoulders.

Pyramids gained the RUIN — courses of visibly different heights, blocks missing from the
arrises, a rubble apron of fallen casing, a worn broken summit. Two traps: the notches were
placed on the CORNER diagonals at the face's half-width, but a square's corner is
`half × √2` from the axis, so every one floated *outside* the stone and six pyramids came out
furry; and the entrance's relieving gable was sized off `baseWidth`, which on Khufu made two
11ft slabs leaning off the side of the monument.

**Ellis Island.** Liberty's drapery was fourteen boxes stuck round a tapered tube; it is now a
fold field warping one lofted robe. **The drift has to be almost nothing** — 0.16·sin(2.1h) +
0.28h walked each fold half way round her and produced a barley-twist column. **Two fold
families at counts sharing no common factor** (8 and 19) is what separates cloth from fluting.
And the applied face features had to go: she stands 223ft off, so her head is six feet tall and
subtends about two degrees, at which size a modelled eyeball is one pixel and a DARK solid one
pixel across is a smudge. The two "sleeve gathering" domes at the top of the chest were the
loudest mistake in the file — a pair of dark hemispheres at chest height on a female figure
reads as exactly one thing.

`lampPost` gained an additive `lit` option (default TRUE, so every saved world is untouched).
Ellis was carrying **ten point lights on street lamps in a world set on a bright morning** —
more than either night world — and unlit it drops to two.

`standingSign` now shrinks its title and subtitle to fit. It drew both at a fixed fraction of
the panel height with no measurement, so "1907 — twelve million people came through this door"
arrived as "07 — twelve million people came through this do". Shared prop, so this quietly
fixes every world that has ever passed it a long line.

**Da Vinci's Studio.** This world was **199 draw calls for 63,000 triangles** — the worst
ratio in the app — because the small props each added legs and panels to a Group one mesh at a
time: a codex stand was FIVE meshes for 126 triangles. It is 185 calls for three times the
geometry now.

**A gear is its teeth.** The cart's gear train was a brass disc with 24 boxes round the rim, so
the machine this world calls the first robot — whose entire point is that it is PROGRAMMED by
pegs set between gear teeth — had no teeth a peg could sit between. `gearWheel` cuts root
circle, flanks and tips as one closed outline, and the cart now shows iron pegs in some gaps
and empty holes in the others, which is what makes it a thing you could change.

**The aerial screw is ONE helicoid**, not 56 box planks whose Euler order had to be defeated
(the old file's own comment records that the first attempt "rendered as an exploding heap of
splinters"). Sweep a radial line up a helix and the surface a screw sail IS falls out, with
real thickness and no orientation arithmetic anywhere.

`baulk()` and `lashing()` are why the frames read as worked timber: a Renaissance machine is
mortised square stock tied with cord, and a world built from cylinders reads as scaffolding
poles.

#### Performance, measured

| World | records | calls | drawn | geometry | textures | meshes | transparent | lights |
|---|---|---|---|---|---|---|---|---|
| Ancient Egypt | 65 (65) | 125 (114) | 731k (191k) | 612k (163k) | 36 (28) | 100 (97) | 3 (3) | 3 (3) |
| Da Vinci's Studio | 59 (59) | **185 (199)** | 259k (63k) | 169k (54k) | 56 (35) | **133 (160)** | 3 (3) | 3 (3) |
| Ellis Island | 57 (58) | 134 (122) | 312k (74k) | 226k (74k) | 28 (18) | 129 (133) | 4 (5) | **2 (13)** |

Baselines in brackets. All three sit well inside the ~1.5M / <1000 envelope, and Egypt's
612k is the highest — of which the **date palm is 26k planted fifteen times, about 390k, or
two thirds of the world's geometry for a backdrop at x = 98..154**. That is the araucaria trap
again ("a background prop's cost is multiplied by its placement count") and it is recorded here
as the first thing to trim if this world ever needs headroom.

**`tools/export-preset-world.mjs`** exported all three; `vite.config.js` carries a dev-only
`captureSink` plugin (`apply: 'serve'`) so a rendered frame can be POSTed to disk, because a
canvas can make a data URL but a page has no filesystem and a sandboxed viewer blocks a
download the page starts itself.

### The four world landmarks: Colosseum / Machu Picchu / Taj Mahal / Red Square

`RomeProps.js`, `AndesProps.js`, `TajProps.js`, `MoscowProps.js`. Ordinary presets in every
respect — the interest is in what they forced, most of which generalises.

**Scaling a building that does not fit.** `WORLD_BOUND_RADIUS` is 195ft, so the Colosseum
(615 × 510 × 157) is built at **1/3** and the Taj (240ft tall, 300ft plinth) at about
**1/2.4**, the same compromise Egypt makes at 1/5. Machu Picchu and Red Square are close to
TRUE SIZE, because a house is a house and a 155ft cathedral fits — what is compressed there
is the *ground between* the buildings, which is the right thing to compress: nobody
remembers how wide Red Square is and everybody remembers the domes. Every placard states
the real dimension, so the reduction teaches instead of misleading.

The Colosseum's one deliberately-preserved ratio is the **arch to the person**: at 1/3 the
ground arcade comes out 8ft tall and 4.7ft wide, so a 5ft student passes through it looking
the right size. Get that and nobody can judge the rest.

**`mergeColored` cannot compose two rotations, and an arcade needs three.** A voussoir is
rotated about Z to sit in its ring and then the whole arch is swung about Y to face out of
an elliptical wall; the part fields apply rotateX → rotateY → rotateZ in that fixed order,
which applies the swing FIRST and flings the blocks off the building. `RomeProps.xformed()`
bakes a full `Matrix4` into the geometry instead — the same escape hatch `gooseSolid()` uses.

**Even steps in an ellipse's parametric angle are not even steps along it.** On a building
whose signature is eighty identical arches, uniform `t` bunches the bays at the ends of the
long axis. `ellipseStations()` walks a fine arc-length table once and resamples it.

**A stepped bank must be SOLID underneath.** The cavea was treads and risers with nothing
below, and since nothing in this app has collision a student walks straight in under thirty
feet of seating and looks up at the underside of the marble. One open cone from the arena
edge to the top closes it. Then two things make it read as *seating* rather than as a ramp:
risers tinted darker than their own treads (a bank of seats is read almost entirely from
the shadow line under each row), and **radial staircases** cutting the rings into wedges —
without something crossing the horizontal lines it stays a ramp however many steps it has.

**Mortarless polygonal masonry needs a dark slab BEHIND it.** Inca ashlar built as polygons
with nothing behind them reads as a heap of river cobbles, because wherever two faces fail
to meet you see another block further back and every joint becomes a rounded edge. With a
solid backing the gaps become *joints*. Three numbers matter: the blocks are overfilled to
**1.42 × 1.34** (at the 1.22 first tried, four corners of backing show through per block and
it turns into crazy paving), they are 6–8 sided rather than 5–8, and each is rotated by
`π/sides` **plus a small jitter** so every block has a flat edge top and bottom. That last
one is what keeps the courses level while no two stones are the same shape.

**A recess cannot be cut back into a wall that is already solid.** `ashlarPanel` knows
nothing about niches, so a dark panel set behind the stonework simply disappears. Build the
niche FORWARD instead: dark panel a hair proud of the blocks, frame projecting further
still. The frame casts the shadow, and the shadow is what says "hole". (A dark box set
*proud* of the wall with no frame is the other failure — it reads as a black sticker.)

**Two roof-pitch traps, both silent, both in the same six lines.** Thatch courses rotated
by `atan2(run, rise)` — the angle from VERTICAL — sit 20° off the plane they are meant to
lie in and splay apart into a venetian blind. And the sign is per-side: a box's long axis is
bidirectional, so the *same* rotation that is right for the −Z slope is mirrored on the +Z
one. It is `side * atan2(rise, run)`. Section matters too: half a step thick and two and a
half steps long buries most of each course and reads as thatch; square-section bars spaced
about their own thickness are a woodpile from any angle.

**A retaining kerb must be built as steps, not as one raked slab.** A box tall enough to
retain a fourteen-step flight and long enough to run beside it is 20ft × 8ft, and tipped to
the rake it projects past both ends — a grey ramp lying on the grass.

**A horn does not taper to a point.** `andeanPeak`'s `(1-t)^1.9` is zero at the top, so the
last rings collapse into a needle. The profile bottoms out at a `summit` fraction (0.14) and
only the top tenth is rounded off — a dome sitting on a horn. Snow lines follow the ridges
(`t + sin(a·5)·0.06`), because a level contour reads as a knitted hat.

**A decorative gable is a flat plate with its point UP.** `MoscowProps.kokoshnik()` exists
because building one as a 3-sided cone laid on its side — which is what "rotate it to face
outward" produces if you are not thinking about it — turns every one into a horizontal
spike, and a cathedral with nine drums grows about a hundred white thorns.

**A LatheGeometry dome's texture must tile horizontally.** `u` runs 0→1 once round, so any
pattern whose left and right edges differ draws a seam straight down the dome. Every one of
`domeTexture`'s patterns is built from a whole number of repeats across the width.

**The nine domes are written out as a table, not generated.** A loop varying hue by index
gives eight domes that are obviously the same dome eight times, and "no two alike" is the
single most-repeated fact about St Basil's.

Composition lessons that cost a rebuild each:

- **A terrace bank is 31ft of stone and must not cross the arrival sightline.** Machu
  Picchu's first pass put two of them straight across it and walled the entire citadel off
  behind a rampart. Turned side-on they frame the walk in *and* you can read the steps.
- **Fog erased the mountain.** 55/330 is what a cloud forest looks like and it reduced
  Huayna Picchu — 300ft away and the reason anyone recognises the place — to a grey ghost.
  The atmosphere is carried by `cloud-bank` props lying in the valley instead, at around eye
  height: lifted into the sky they stop being weather and become lumps on the hillside.
- **Distance is set by HEIGHT.** St Basil's at 155ft needs 220ft of run-up or its domes sit
  above the top of the frame; the spawn moved, not the building.
- **Snow is a contrast problem.** Bare setts at near-black against a white terrain made Red
  Square a chessboard with a road down the middle. Wet granite under a winter sky is a mid
  grey, snow that has only been walked on is mostly still there, and three drift frequencies
  rather than two stop the swept edge drawing one clean sine curve across the whole square.
- **Check the arrival frame for things at 45–50°.** The Spasskaya Tower at x=-92 was 49° off
  and clipped by the bezel; the browser panel at 41° covered an activity board at 47°. A 70°
  *vertical* fov is only ~51° either side on 16:9, so 49 is not "just inside".

### Inside an Animal Cell, and Inside a Twister

`CellProps.js` / `cellLayout()` and `StormProps.js` / `twisterLayout()`. Both are gallery
worlds: they are in `PRESET_WORLDS` (so they can be built and exported) and deliberately
**not** in `MENU_WORLDS`.

**A prop can now ship WITH a program on it, and the twister is why.** `prop()` takes a
`program`, `toRecord()` passes it through, and `WorldStore.addAndRun()` starts it on load
with no new code path — so the funnel is turning before anybody clicks anything, it gets a
green ▶ like any other programmed object, and a student can open it and change the number.
It survives export into a world file, which is verified rather than assumed: the downloaded
copy rehydrates with the runner active. Blocks go through `createBlockInstance()` and never
an object literal, so every param comes from the block's own schema — a hand-written block
that omits one renders an empty field the moment the editor opens it.

**`forever` yields once per pass ON TOP of the yield from the block inside it**, so one
turn of `forever { rotate N }` costs two frames and the effective rate is **N/2 per frame**.
That is deliberate in the runner (it is what stops a `forever` holding an empty body from
hanging the tab) and it silently halves every program written this way. Measure it; do not
compute it.

**A surface of revolution spun about its own axis is pixel-identical at every angle.** A
smooth grey cone rotating at any speed is a smooth grey cone standing still, so "animate the
tornado" is a GEOMETRY problem before it is an animation one. `helicalShell()` corrugates
the funnel into ribs whose phase shifts with height — a helix, not flutes — and the three
nested shells are wound at *different* rates so they shear past one another. Two
sub-vortices spiral up the outside and the debris at the base is individual chunks rather
than a haze. Any one of those alone would carry the spin; none of them would.

**A CUTAWAY shell cannot use `FrontSide`.** Looking into an opening means looking at the
*inside* of the far wall, and the inside of a sphere is its back faces: culled, so the whole
interior vanishes and all that is left is the two rim arcs of the cut. The nucleus rendered
as a pair of purple claws with a ball floating between them until this was found. The
lungs' `FrontSide` rule is for CLOSED shells and does not transfer — `shellMaterial()` takes
a `cutaway` flag for exactly this.

**A near sign competes with a far landmark on ANGLE, not on size.** The welcome board is
12ft wide on 9.2ft posts, so from 14ft its top subtends ~25° — *more* than the 50ft nucleus
does from 108ft — and it hid the hero object of the world completely. The fix is to push the
board back, not to shrink it. Both worlds had this and both are fixed by distance.

**`rotY` cannot lay an upright model down.** The mitochondrion was authored along Y with the
layout meant to tip it; `rotY` spins about the vertical, so it stayed a barrel on end however
much it was turned. A record carries only `rotX`/`rotY` and the base-on-ground convention
fights `rotX`, so the tipping belongs inside the builder.

**Damage carries no identity on its own.** The farmhouse tore all four walls evenly and came
out as a ring of grey battlements — unmistakably a ruined castle. One INTACT gable end with a
chimney and a window is what makes it a house; the storm side then tears away from there.

Two more, both cheap to re-hit: `welcomeBoard` and `organelleTag` drew their text at a fixed
size with no measurement, so an over-long line ran off both edges clipped mid-word — both now
shrink to fit, and `welcomeBoard` measures *before* `blockH` so the vertical centring still
holds. And the cell's scale is consistent across the five main organelles with every label
stating the real micrometre figure; the free ribosomes are the one exception and **their own
label says so**, because at true scale they are three inches across.

### Whimsical World and Space Station Survival

`WhimsyProps.js` / `whimsyLayout()` and `StationProps.js` / `stationLayout()`. Gallery worlds
— in `PRESET_WORLDS`, deliberately not in `MENU_WORLDS`. One is five *coding* challenges, the
other five *building* challenges, and both are led by colour.

**The best first coding challenge is CHANGING a program, not writing one.** The carousel is
already turning when a student arrives (a `program` on the prop, the mechanism the twister
introduced), and board 5 is "open it and change one number". Four boards ask for a program
from nothing; the fifth asks for an edit, and it is the one that works for the student who
has never done either. It also means the first thing anyone sees in this world is a program
running, which no amount of signage says as well.

**A planet you are orbiting has to have its CENTRE above the horizon.** Not a framing
preference — the only arrangement that reads as a sphere. A flat deck with the eye 5ft above
it hides everything below about −2°, so a planet centred lower is cut *above* its own
equator, and a circle cut above its equator is a dome. Mars was built three times and the
first two were hills: radius 150 at 320ft was a hill close up, radius 400 at 780ft was a hill
700ft wide. 340ft at ~780ft with the centre ~6° up spans 48° across, reaches 28° up, and
curves back in on both sides.

**The station theme paints the TERRAIN OUT.** `groundLow`/`groundHigh` are near-black, so the
only floor is the 230ft-square `station-deck` prop and everything past its edge is space. Left
at deck grey the terrain ran to the horizon and gave Mars a flat line to sit on — which is the
other half of why it read as a hill. It is the one theme whose ground is not meant to be seen.

**The sun is on the student's side here**, which no other outdoor world does. A planet takes
the same directional light as everything else, so a sun behind it lights its far side and
hands the arrival view a dark disc.

Traps, most of them re-runs:

- **A partial `SphereGeometry`'s phi is measured from −X, not +Z.** The EVA suits' gold
  visors were authored around phi = 0 and sat on each suit's left ear, so every one presented
  a blank white ball to anyone walking up. And a visor must be BIGGER than the helmet it
  covers — at a hair under, it is sealed inside the shell, the same mistake as a window on
  the inner face of a wall.
- **A dish must open toward the walk-up, and then it needs `DoubleSide`.** Turned the wrong
  way, `antennaDish` rendered as a smooth white egg on a post (`MarsProps`' relay dish, again).
  Turned the right way it rendered as a hoop with three spokes and no dish, because the
  surface you now see is the cap's *inside* — its back faces. Note `BufferGeometry.rotateX`
  turns about the geometry's origin, so a cap has to be seated with its vertex at the origin
  before it is tipped.
- **A window module built as mullions with panes between them and nothing behind is a box.**
  The cupola's six dark panes *were* its drum — a blue shipping container on a white pedestal.
  A cupola is a white pressure vessel that happens to have windows, so the solid wall goes in
  first and the glass sits proud of it, narrower and shorter than its bay.
- **Draw a planet from soft fills, never outlines.** Craters and shield volcanoes as stroked
  circles — which is how a crater is drawn on a *diagram* — turned Mars into a screenful of
  soap bubbles. A bright crescent offset inside a dark disc, the second attempt, did the same.
  Filled, faint, slightly elliptical, no rim.
- **A dark arc under two dark patches is a smile under two eyes.** Valles Marineris at the
  width and contrast the feature deserves on a map gave the planet a face. It is now a thin
  scar you notice second.
- **A large smooth gradient needs grain or the JPEG bands it.** The gallery screenshot came
  back with broad vertical bands across Mars that are not in the render. A pixel of noise
  across the texture fixes it and reads as dust.
- **Axial tilt is what makes a polar cap exist.** Upright, the north pole sits exactly on the
  top limb and the cap paints a sliver a pixel or two deep. The `rotate` block turns the root
  about the world vertical, so a tilted child precesses rather than spinning on its own axis —
  at 0.04°/frame that is one circuit in over two minutes, and the cap is worth the pedantry.
- **Both worlds' arrival frames had to be cleared twice.** Whimsical World's welcome board sat
  56° off the sightline (outside the ~51° a 16:9 screen sees) and was clipped by the bezel with
  a lollipop tree in front of it; the station's bay 3 board sat two degrees off it and hid the
  entire station. The five bays are now an avenue down both sides with the middle strip empty —
  which is also what a world full of construction needs, since a fresh piece lands
  `PRIMITIVE_SPAWN_DISTANCE` ahead and spirals out.
- `tutorialBoard` takes a `postColor` now. Dark iron is right in every outdoor world and is
  timber-on-a-deck in orbit.

**Performance**: Whimsical World is 40 records / 134 draw calls / 127k triangles; Space Station
Survival is 44 / 156 / 95k. Both world files are well under 20 KB.

### The Constellations and Telescope Observatory, and how to render NIGHT

`SkyProps.js` / `constellationsLayout()` and `ObservatoryProps.js` / `observatoryLayout()`.
Gallery worlds — in `PRESET_WORLDS`, deliberately not in `MENU_WORLDS`. They are the app's first
**dark** worlds, and they share a sky: `milky-way`, `moon-in-sky`, `sky-constellation` and
`sky-star` are `SkyProps` keys used by both layouts.

**ONE TABLE OF REAL STARS FEEDS FOUR THINGS.** `CONSTELLATIONS` in `SkyProps.js` holds eight
figures as chart-accurate positions plus real magnitudes and spectral classes, and it is used
by the walk-up board, by the giant sky pattern, by the planisphere's printed disc and by the
`chart-table`'s paper map. That it is ONE table is why they agree: Orion on the board is the
same Orion overhead with Betelgeuse the same red. Anything that edits star data edits it once.

**A `MeshBasicMaterial` SPHERE IS A FLAT DISC**, and that ruined the first pass of this world.
An unlit material gives every pixel the same colour, so a star core rendered as a hard-edged
coloured button and a bigger translucent sphere around it added a second hard edge — a row of
buttons with rings, nothing reading as light. What the eye recognises as a star is the
*gradient*, so the bloom is a **textured quad**: one painted radial falloff with four faint
diffraction spikes, merged per figure, tinted per star by `map × vertexColors` (the multiply
this file usually warns about, used deliberately, exactly as the flower beds do). Stars keep a
small sphere core as well, which is what gives a board's stars presence as objects standing off
its face.

**In a dark world every surface that carries information must be emissive or unlit.** A lit
panel at night is a dim panel. Every board, placard, chart and screen in both worlds is
emissive; every star, label, milky way and moon is `MeshBasicMaterial` with `fog: false`, or the
sky fades to the fog colour and the constellations dissolve.

**Neither theme is as dark as night really is.** Both were tuned down and then brought back up:
at a physically plausible hemisphere fill the observing field read as a void with signs floating
in it, and a student could not see the ground they were walking on. What matters is what a
dark-adapted eye *reports* — you can see your feet, and colour is nearly gone.

**A NIGHT WORLD NEEDS A COMPASS DECISION, and it is not reversible.** North in The
Constellations is **+Z**, which is behind a student who spawns facing −Z. Facing away from the
pole means facing SOUTH, which is where the bright winter constellations are — so the arrival
view is Orion, given away before anything is read, and Polaris, Ursa Major and Cassiopeia are
over the entrance, which makes "turn round" an instruction with a payoff. The Polaris sight
stands 16ft *behind* the spawn.

**The sky is ONE SEASON, and that is a correctness rule.** Orion and Scorpius are never up
together. Hanging all eight figures overhead at once would put a plainly false sky over a world
whose whole job is teaching what is really up there, so only the winter and circumpolar figures
are in the sky, a placard says exactly why, and the planisphere is the tool that answers it.

**The Moon is FULL, after two failed phases.** A phase is a range of longitudes, so which part
of it faces the camera depends on where the layout hung it and how the prop is turned — every
angle but the intended one gave a bright ball with a dark bite out of one corner. Painting the
dark side near-black made it a *hole in the sky* (darker than the sky itself); erasing its alpha
made it a hole wherever the sky was dark, which is most of both worlds. A full Moon reads
correctly from every angle and is right for both — a full Moon rises as the Sun sets.

**The Milky Way is three quads showing three THIRDS of one texture**, not three copies of it.
The sheet is faded to nothing at `u = 0` and `u = 1`; with three copies every panel ended at
full brightness and the band had two hard diagonal cuts across the sky. It also has to be tipped
most of the way to horizontal and run roughly north-south through the zenith: hung upright and
east-west it crossed one corner of the frame as a tapering wedge, which the eye insists on
reading as a comet.

**The dome and the telescope are SEPARATE OBJECTS running the same program**, and that is the
observatory's whole idea. `observatory-drum` is fixed (door, walls, stone base), `observatory-dome`
sits on it with an `absoluteY` and `forever { rotate 0.05 }`, and `great-telescope` carries the
same number — so the slit stays in front of the tube, which is what a dome is FOR. The drum's
door and the dome's slit are both authored on +Z but given *different* yaws: a building whose
door and shutter line up perfectly reads as one object.

**A FLAT SIGN ON A ROUND WALL MUST BE TANGENT, AND PLACED BY AZIMUTH.** Both wall signs were
first positioned in Cartesian coordinates with a hand-guessed yaw, and because a chord cuts
inside the circle it joins, one end of each sank into the corrugation — the Greenbush wordmark
rendered as "GREENBUS", clipped dead straight by the wall it was mounted on. `observatoryDrum`'s
`mount(object3D, azimuth, y)` fixes it by construction: a tangent's points are all further from
the axis than the point it touches. Note the yaw is the azimuth *itself*, not its negative —
`CylinderGeometry` measures theta from +Z as `x = r·sinθ`, the same convention `rotation.y` uses.

**Astrological sign characters (U+2648…) are COLOUR EMOJI.** A canvas draws them from an emoji
font that ignores `fillStyle`, so twelve engraved brass zodiac sectors came out as twelve purple
stickers on the hero model. Anything drawn on a canvas texture here has to be ordinary text or
drawn geometry — which also applies to the Greenbush mark, drawn in code rather than shipped as
an image file so the world file stays a few kilobytes.

**Two coplanar rings z-fight, and it looks like a material bug.** The armillary's zodiac band was
built at the ecliptic ring's exact radius; the two shimmered violet along their whole
intersection. The band now sits inside the ring, which is also what the real instrument looks
like — the ring is structure, the band is the plate it carries.

**Interior scale is set by what has to FIT.** The dome started at a photo-accurate 26ft, which is
right for a real 36-inch and wrong for this app: a student who walks in is already at the
telescope with nowhere to stand back. At 30ft it is a room. The truss length is likewise set by
clearance rather than by optics — lengthen it and the tube goes through its own roof, which is
invisible outside and unmissable from the floor. The floor stays at ground level, the shell sets
`castShadow = false` (or the dome caps the building), and curved zero-thickness shells set
`receiveShadow = false`.

**All three orbs are INSIDE the dome and there are none on the site.** A 30° slit at dusk is
nowhere near enough to read a room by, and the interior is the whole reason the building has a
door. Outdoors gets one hooded red lamp, which is what a real observatory site allows itself —
and both worlds have a placard on why: red light barely touches rhodopsin, and dark adaptation
takes twenty to thirty minutes to build and one glance at white light to destroy.

**An orb is a visible glowing ball.** One hung on the arrival sightline reads as a bright
artifact floating beside the hero model rather than as lighting — and one placed at the
armillary's own position sits *inside* the rings next to the Earth at the centre of the
instrument.

**Performance**: The Constellations is 40 records / ~185 draw calls / 71k triangles / 29
transparent meshes / 4 point lights; Telescope Observatory is 45 / ~290 / 202k / 13 / 5. Both
world files are about 15 KB — the whole star and sky machinery costs nothing to store because
every star is a name and a number in `CONSTELLATIONS`, rebuilt on load.

### Seattle Center, and a world about a SKYLINE

`SeattleProps.js` + `seattleLayout()`. A gallery world -- in `PRESET_WORLDS`, deliberately not
in `MENU_WORLDS`. Three hero models (Space Needle, International Fountain, Monorail), the
Pacific Science Center carrying the three coding challenges, and the campus round them.

**This is the first world dominated by ONE OBJECT SEEN FROM 220FT**, and that moves the whole
budget. Every other world here is things you walk between; this one is a 151ft tower in the
middle distance, and detail that lives in a surface -- grain, weathering, tooling -- is
invisible at that range. What reads is SILHOUETTE and PROFILE: the wasp waist of the tripod,
the flare of the saucer's underside, the step of the halo. So the Needle spends its triangles
on a 120-sided saucer and a nine-station leg loft and almost none on texture, while the
fountain, the science exhibits and the planting -- all things a student stands next to -- get
the surface work instead.

**Scale**: Needle 1/4 (151ft), fountain 1/3, arches 1/2.4, monorail near full size because a
train is the one thing whose size a student already knows. Every placard states the real
figure.

**The 1962 colours are a real, named, teachable palette**, which is what this world adds:
Astronaut White, Orbital Olive, Re-entry Red and Galaxy Gold. The tower is painted as it is
today -- white with the gold roof it got back for the 50th in 2012 -- and the placard names
all four. MoPOP's six anodised metals and Chihuly's glass hues carry the rest.

**Five bugs came out of this build, and four of them are silent in a way that matters more
than the models:**

- **`extrudeOutline` IS CENTRED ON ITS OWN DEPTH**, running from `-depth/2` to `+depth/2`.
  That is right for the mouldings it was written for and a trap for anything authored from
  the ground up: the science pavilion's floor sat 7.8ft underground, the Armory's 9.5ft, and
  every arcade column was half buried. Nothing errors -- the buildings just come out squat,
  which reads as a proportion mistake rather than an offset one. `upright()`/`slab()` in this
  file exist so no caller has to remember.
- **`mergeParts` OVERWRITES a part's colour attribute unless `keepColor: true` is set, so a
  `tint` without it is computed and thrown away.** The Space Needle's glazing bands, gold
  roof and halo, the monorail's livery and MoPOP's six colours were all correct and all
  discarded; the symptom was that the most-looked-at object in the world was uniformly white.
- **`revolve` DECIDES ITS WINDING FROM THE PROFILE'S DIRECTION.** A profile written bottom-up
  -- which is how anybody writes one -- comes out INSIDE OUT. Measured: `[[3,0],[3,2]]` gives
  a mean radial normal dot of **-0.999**, and the same two points reversed give **+0.999**.
  Under a FrontSide material that does not look like a missing surface, it looks like a DARK
  one, because you are seeing the far inner wall lit by its own inverted normals. The
  fountain's grass amphitheatre rendered as a black ring 72ft across. `lathed()` wraps it.
- **`emissive` IS A FLAT MATERIAL COLOUR AND `vertexColors` DOES NOT MULTIPLY IT.** So
  `emissive: 0xffffff` on a vertex-coloured mesh adds the same white glow to every triangle:
  the Chihuly tower's amber, vermilion and rose all came out the same pale cream, and raising
  `emissiveIntensity` to make the glass "glow" destroyed more of its colour. Where a glow is
  wanted the emissive is now a colour from the same family; elsewhere it is gone.
- **`THREE.MathUtils.smoothstep` takes `(x, min, max)`**, and `smoothstep(0.36, 0.1, t)`
  reads as "from 0.36 down to 0.1 over t" while doing nothing of the kind. The saucer's rib
  field ran over the glazing and the roof instead of stopping at the halo.

**Two more that generalise:**

- **A SATURATED GROUND BOUNCE PAINTS EVERY DOWNWARD FACE.** The saucer is a 35ft disc of white
  paint facing straight down 126ft up; the sun can never touch it, so `hemiGround` is the
  entire light it gets, and at an honest grass green it rendered as an olive-brown mushroom
  cap. What was wrong was the SATURATION, not the brightness -- `0x8d9384` at 1.5. Under the
  Sea's lesson (the shark's white belly) arriving at a building.
- **WHICH YAW TURNS A PART RADIAL DEPENDS ON WHICH AXIS HAS TO END UP RADIAL.** The orrery's
  arm runs along its extrusion (Z) and takes `pi/2 - a`; a rocket fin's span is the outline's
  own X and takes `-a`. Getting it wrong does not look like a rotation error -- the fins
  simply stand tangentially and the rocket reads as having a collar.

**Composition.** One sightline: spawn at the south end looking north, fountain dead ahead at
118ft, Needle 10 degrees left at 213ft. Nothing tall inside that cone -- the science centre
goes west, MoPOP and the monorail east, so a student turns to find them. Two cherry trees
started at 28ft from the spawn with 34ft crowns and hid all three hero models between them;
a tree beats a landmark on ANGLE, not size, which is the same arithmetic that governs signs.

**The monorail arrives already moving** -- a `program` on the prop, the mechanism the twister
and the carousel introduced -- so the first thing anyone sees in this world is a program
running. The three challenges target three EXHIBITS rather than scenery, one block family
each: `forever`+`rotate` on the orrery, `repeat`+`move forward`+`rotate` on the rover (360
divided by the number of sides), and `move up by`+`wait`+`go back to start` on the rocket.

**The YouTube panel at the spawn** is an ordinary `browserStation` whose url goes through
`youtubeEmbedUrl()`, so the record stores the embeddable form and the panel simply works --
see the video-panel section above for why a `watch?v=` link cannot.

**Performance, measured**: 49 records / **170 draw calls** / 695k drawn / 376k geometry / 93
meshes / **3 transparent** / **0 point lights** / 51 textures / 1.72ms warm CPU render. 792ms
to build, 292ms to load, 14.7KB world file. Per-prop the heaviest are MoPOP 35k, fountain 25k,
Needle 21k, chihuly glasshouse 12k; the four Douglas firs are about 8k each, which is the
araucaria trap watched rather than repeated.

### Greenbush Science Center, and a hero you walk INSIDE

`GreenbushProps.js` + `greenbushLayout()`. A gallery world -- in `PRESET_WORLDS`, deliberately
not in `MENU_WORLDS`. The education service centre this app is made in, modelled from a
photograph of its front elevation, with the exhibit hall behind the door built out as a room
a student can walk into.

**It is the first hero in this project that has an INSIDE**, and that is what shapes the file.
Every other building here is looked at: the museum and the library have interiors, but they
are galleries you look across from a raised floor, and Mars' dome is a shell. This one is a
146ft frontage whose front door is a real opening into a 70 x 42ft hall holding fifteen
exhibits, and three constraints fall out of that immediately.

- **THE FLOOR IS AT GROUND LEVEL.** `PlayerController` walks on the terrain and never on
  props, so a raised interior floor puts a student's eyes below the deck they appear to be
  standing on. Mars learned this; the museum and the library are the counter-example and they
  get away with it only because you look across them rather than walk into them.
- **THERE IS NO CSG, SO AN OPENING CANNOT BE CUT.** `wallWithOpening` assembles the front wall
  as two piers and a header, the way a real one is built. A dark panel laid on a solid wall is
  the trap Machu Picchu's niches and Ellis Island's windows both hit.
- **AN OPEN DOOR HAS TO LOOK OPEN.** The first pass glazed the opening with one sheet of dark
  glass, which is a WINDOW -- and a student who reads it as a window does not try to walk
  through it, collision or no collision. It is two narrow sidelights at the jambs with a
  transom over and eight feet of nothing in the middle, so from under the canopy you see the
  lit hall and the robots standing in it. That view is the only invitation that works.

**Four bugs, and the first two are the ones worth carrying forward.**

- **THE VAULTS WERE THE CEILING, AND TWO ARCS DO NOT COVER A RECTANGLE.** Arcs 30 and 40ft
  wide over a hall 70ft wide leave open strips at both ends, and from inside those were bands
  of BLUE SKY across the top of the room. The ceiling is now a flat deck at the wall head and
  the vaults sit on it as roof form -- which is what the real building has anyway. **The deck
  is its own MESH**, because `castShadow` lives on the Mesh and not on a merged part: anything
  that has to let the sun through cannot be merged with anything that has to block it.
- **A REUSED PROP CARRIES ITS OWN WORLD'S SCALE.** Nine exhibits here come from Fantastic
  Voyage, Seattle Center, the observatory and the space station, and measured in place the
  robot arm was 28.5ft across, the DNA helix 22.4ft TALL against a 19.4ft ceiling, and the
  orrery's 14.2ft span put it a foot through the right wall. Reuse is the house pattern and
  it is right; re-measuring is not optional. The check is worth automating -- a sweep for
  anything whose box escapes the room found all four in one pass.
- **A GRID OF BOXES STEPPING UP A CURVE IS A STAIRCASE.** The gable infill under each vault
  was 22 brick boxes climbing the arch and read as exactly that. An arch's infill is a
  half-disc, its centroid lies inside it, and so `extrudeOutline`'s centre fan caps it
  correctly with no special case at all. (The related trap is why the vault SHELL cannot use
  `extrudeOutline`: an arc BAND's centroid is in the hollow, so its cap would throw triangles
  across the opening -- `barrelShell` emits the end strips directly.)
- **RADIUS, NOT WIDTH, DECIDES WHICH OF TWO CONCENTRIC BANDS DOMINATES.** The cream fascia was
  placed at `halfSpan + 0.9`, making it the OUTERMOST ring of each arch, so from the road every
  vault read as a cream dome with a thin green rim -- the exact inverse of the photograph.
  Moved inside the green it became the slim line it is meant to be.

**A ROOM NEEDS AN INTERIOR FINISH, and that is legibility rather than decoration.** A deck
soffit in roof green and walls in face brick are both surfaces facing away from every light
in the world, so the ceiling rendered pure black and the walls dark red: the hall read as a
cave with exhibits in it. A pale lining, a dark skirting and six orbs at 9ft is what an
exhibit hall actually has, and it is also what the orbs bounce off.

**Two things carry the building's likeness and neither is geometry.** Coursed brick is a
COLOUR problem -- horizontal course banding plus a broad blotch and a grime wash, since as
geometry it is thousands of solids per elevation. And the roof's standing seams are a tint,
because a seam stands about an inch proud on a roof 30ft up seen from 90ft, which is
sub-pixel; as geometry it would need ten samples per seam to escape aliasing and buy nothing.

**The hero was the LIGHTEST thing in its own world at 6.7k triangles** -- lighter than one
tree -- because a building is boxes. What brick architecture is read from is its horizontal
lines, so a stone base course, a soldier band under the eaves, sills and lintels round every
opening and a soldier arch over the door took it to 8.6k. Each is a mitred `mouldedRing` or a
flat band: a handful of triangles apiece and the cheapest fidelity in the file.

**Composition.** The spawn stands in the parking lot 92ft back: the tower's left edge is 33
degrees off the sightline and the far gable 41, both inside the ~51 a 16:9 screen sees, and
the tall vault's ridge is 18 degrees up against a 35 degree half-fov. On a facade this wide
something is always behind something -- the rule that matters is that it is never the door,
which sits 12 degrees left while the kiosk is 40 right and the welcome board 43 left.

**Performance, measured**: 71 records / **297 draw calls** / 699k drawn / 384k geometry / 159
meshes / 7 transparent / 6 point lights / 75 textures / 0.72ms warm CPU render. 625ms to
build, 317ms to load, 17.7KB world file. The building itself is 8.6k triangles in five meshes
(brick, roof, metal, trim, glass); the heaviest props in the world are all reused exhibits --
cell model 31.1k, robot 28.6k, Douglas fir 22.9k, DNA helix 17.1k.

The world holds exactly what the brief asked for: 15 science exhibits in the hall, 5 robots
along its back wall, and 30 accessory models outside.

### Robot Challenge World, and a hero model read from SIX FEET

`RobotProps.js` + `robotLayout()`. A gallery world -- in `PRESET_WORLDS`, deliberately not in
`MENU_WORLDS`. Five programmable robots on painted test pads down an avenue, one challenge
each, plus the workshop that services them.

**The one decision that shapes the file: this hero model is read at SIX FEET.** Every other
hero here is read at forty (a dinosaur), a hundred and thirty (a fountain) or two hundred and
twenty (the Space Needle), and the budget goes to silhouette because that is all that
survives the distance. A student walks right onto these pads and stands nose to nose with the
robot, and at that range every join, every seam and every crescent of daylight between two
solids is not merely visible, it is the only thing you can see. So the whole file is built on
one rule -- **NOTHING IS PLACED ON A SURFACE, IT IS SUNK INTO ONE** -- with three helpers to
make it structural rather than remembered:

- **`onShell(centre, radii, dir)`** returns a point on an ellipsoid *and that surface's true
  normal*, and every button, port, grille and panel is positioned through it. Hand-picked
  coordinates near a sphere are either floating or buried, the two failures look nothing
  alike, and hunting each one separately is the whole afternoon. Note the normal is **not**
  the direction -- on an ellipsoid it is the gradient, which points somewhere else entirely
  wherever the three radii differ, and using the direction tips every stud on a flattened face.
- **`stud`** is a closed flattened ball sunk along that normal: every button, boss, lens,
  grille and port on the robot is one. Closed, never partial -- the rule Fantastic Voyage's
  `blister` was rewritten for.
- **`shellPatch`** lays a panel on a sphere as a real patch of a slightly larger concentric
  sphere, with the **mid-surface radius varying**: proud of the host in the middle, inside it
  at every edge, thickness going to zero at the border so `solidSurface` emits no rim there.
  A flat plate cannot lie on a sphere -- sink it far enough for its rim to disappear and its
  middle goes too. The first chest yoke was a flat rounded box and read as a black card taped
  to the robot with its bottom corners an inch clear of the shell.

**What makes it read as this kind of robot**, in the order the identification depends on:
the EYE SENSORS -- a stereo PAIR, each a stack of accent bezel ring, white spoked LED disc,
domed black lens and one specular highlight, with an accent band bridging them; the TRI-LOBE body (two big
lobes side by side with a third pushed forward between them, all the same family of size --
two lobes is a scooter, four is a car); the head sitting IN THE NOTCH rather than on a neck,
with a black collar filling the crease; and exactly TWO colours.

**TWO SENSORS, NOT ONE, AND THAT IS A TRADEMARK DECISION RATHER THAN A STYLISTIC ONE.** The
first build gave this robot a single enormous central eye, which is the signature of one
specific commercial classroom robot; a model in this app has no business being mistaken for
it. A stereo pair reads just as clearly as a robot, is what a machine that actually judges
distance would have, and belongs to nobody. The change is only in `robot()`, so it reached
both worlds that use the prop at once — the geometry is rebuilt from the record on every
load, which is why nothing had to be re-seeded and only the gallery's screenshots needed
recapturing.

**A PAIR'S FACE HAS TO CLEAR THE HEAD AT ITS INNER EDGE, NOT AT ITS OWN CENTRE.** A pod
centred at x = 0.78 sits over a head surface only 1.13 deep, but its inner edge reaches back
to x = 0.06 where the head is 1.263. Sized from the pod's own centre the face cleared by
seventeen thousandths of a foot and the shell bulged through the inner third of both sensors.
This is the single-eye clearance problem again, and it is harder off-axis, not easier.

**THE HEAD'S FRONT IS SQUASHED TO 0.72 AND THAT IS WHAT MAKES THE EYES POSSIBLE.** A round head
of radius 1.76 reaches z = 1.76 at its pole and the sensors' faces sit at 1.42, so on a round
head the shell bulges straight THROUGH both of them and the robot appears to have a blue ball
where each lens should be. On a `'y'`-axis loft `up` is the +Z half-extent and `dn`
the -Z one, so flattening the front only leaves the back of the head perfectly round -- which
is what those two channels are for. Each pod is ONE closed lathe running from deep inside
the head out to the bezel crown, so the join between a sensor and the head is not a join: the
pod simply emerges. Two colours on one solid, split by radius in the tint rather than built
as two rings, which is what guarantees there is no seam between them to leave a gap at.

**Seven bugs came out of this build. The first is the most general thing in this file.**

- **`mergeParts` APPLIES A PART'S ROTATION AS ONE EULER IN XYZ ORDER, WHICH COMPOSES AS
  Rx·Ry·Rz -- so a middle Y term is applied BEFORE the X term, not after it.** For a plate
  authored upright in XY and then laid down by Rx(pi/2), that is the entire difference between
  turning it IN PLAN and TILTING it out of the ground. Measured: the plate's own normal, which
  should stay at |y| = 1 however far it is turned, comes back 0.958 at 0.29 radians, 0.894 at
  0.4636 and **0.697 at 0.8** -- a 45 degree tilt. Every painted lane, square and chevron on
  the five pads was standing at an angle out of the paving, and the symptom was not a rotation
  that looked wrong so much as **pads whose bounding boxes measured four to nine FEET tall
  instead of six inches**. `laid()` bakes the pair as a matrix in the order actually wanted and
  returns 1.000 at every angle. **`SeattleProps`' `slab`/`upright` carry the same latent bug**
  and are only safe because no caller there passes a non-zero `rotY`.
- **`welcomeBoard` fitted its big `lines` and NOT its `lead` or `footnote`.** Both were drawn
  at a fixed fraction of the board's height with no measurement, so one sentence a few words
  too long ran off both edges clipped mid-word. Shared prop, so fixing it quietly improves
  every world that has ever passed it a long lead. Two notes: the font string handed to the
  fitter has to be the REAL one (the footnote is an italic serif and measuring it in the
  headings' sans is a tenth out), and this is the third time this exact failure has been
  found in this project -- `cardTexture`'s body, `standingSign`'s title, now this.
- **A PARTIAL LATHE HAS A SIDE IT IS MEANT TO BE READ FROM, AND `start` DECIDES WHICH.** The
  charge dock's back shield was swept about +Z, so the shell arced forward over its own ramp
  and presented a smooth convex grey back to everybody walking up, with the accent stripe and
  all three lamps hidden behind it. Swept about -Z its concave side faces the walk-up. That is
  MarsProps' relay dish and the space station's antenna for the third and fourth time.
- **A lathe profile that does not start and end ON THE AXIS is an open tube**, and the hole is
  at the top of the post where a student looking up sees straight down it. Every mast, post and
  cone here goes through `closed()`.
- **`gearWheel` takes `hub`, not `bore`.** Nothing errors, the option is simply ignored and the
  gears come out solid -- the "an options object that is SPREAD must use the receiver's key
  names" trap this file already records once for `taperedTube`'s segment counts.
- **A crate's contents have to break the LIP LINE.** Sitting below it they are visible only
  from above, which is not an angle anybody has, and the crate reads as empty.
- **The arch hid bay 1.** At span 24 its legs stand at 26.6 degrees off the sightline, which
  is exactly where the first robot is -- so the gate telling a student to go and look at it
  was standing in front of it. Narrowing to 20 was the move rather than shifting the bay,
  because the only other place bay 1 fits is inside the browser kiosk's own 30-to-48 degree
  shadow. Third arrival-frame correction in three worlds.

**THE PAINT ON EACH PAD IS THE PATH ITS PROGRAM ACTUALLY TRACES, VERIFIED BY RUNNING IT.**
`repeat 4 { move forward 8, rotate 90 }` walks (0,0) -> (0,8) -> (8,8) -> (8,0) -> (0,0) in the
pad's own frame, so **the robot starts on a CORNER of the painted square rather than in the
middle of it**, and the layout offsets it there (`start: [lx, lz]`, rotated into world feet by
the pad's own yaw). Painted round the centre with the robot standing at that centre, a correct
program traces a square of exactly the right size five feet away from the paint, and a student
comparing the two concludes their program is broken. All five programs were run and measured
rather than reasoned about: Blip travels 9.00ft and returns to 0.000 from home; Spark turns
120 degrees in 60 ticks (the documented `forever` half-rate); Hopper hops exactly 3.00ft and
its furthest point is 12.45ft, which is 8.8·sqrt(2) and so closes its square; Echo does not
move at all until Hopper says the word and then runs 9.90ft, which is 7·sqrt(2).

**The five challenges are a real ramp, and the order was chosen so the first one has no loop
in it at all.** 1 a plain three-block sequence; 2 one block inside `forever`; 3 nested C-blocks
plus 360-divided-by-the-sides; 4 a six-block sequence mixing all three block categories; 5 the
only challenge needing TWO objects -- a `whenSaid` hat on one robot and a `say` on another,
which is the one construct nothing else in this world uses. Two ornaments (the gear pylon and
the ball run) ship already turning, because the easiest way to learn a program is to open one
somebody else wrote and change a number.

**Layout.** The middle strip is empty (|x| < 13) from the spawn to the far end, for the reason
A Bug's Life found: a fresh construction piece lands 10ft ahead of the student, so anything in
the middle is something to build round. The five bays get DEEPER as they get harder -- bay 1 at
52ft, bay 5 at 134ft -- so walking further into the world *is* the difficulty curve. Zero point
lights and zero transparent meshes: a bright midday world with nothing roofed in it, where an
orb would read as an artifact hanging beside the model rather than as lighting.

**The theme's `hemiGround` is `0x969a8d`, the Seattle number arriving for a much smaller
object.** A robot is a cluster of large smooth spheres, so at any sun angle the lower third of
every lobe faces the ground and takes its entire illumination from the bounce; at an honest
grass green the cyan robot's underside came out olive. The sun also comes from BEHIND the
student (+Z), which only the space station does otherwise: every robot faces the spawn and its
face is the whole model, so a sun from the far side puts that one eye in its own shade.

**Performance, measured**: 45 records / **179 draw calls** / 671k drawn / 350k geometry / 89
meshes / **0 transparent** / **0 point lights** / 54 textures / 0.48ms warm CPU render. 332ms
to build, 360ms to load, 14.2KB world file. Per prop: douglas fir 22.9k triangles, **robot
28.6k**, flowering cherry 14.6k, japanese maple 12.1k, tool bench 9.2k, ball run 8.0k,
rhododendron bed 5.2k, gear pylon 4.2k, flower bed 4.0k, signal arch 3.1k, pad 2.4k, crate
2.4k, charge dock 1.4k, beacon 0.8k, cone 0.4k. The robot was 17.8k on the first pass and was
deliberately raised: more than half this world's budget was unspent, and on the one object the
whole world exists for, spare budget is not a virtue.

The PNW planting is reused from Seattle Center rather than rebuilt -- the maple, the cherry and
the rhododendron bed are already the most vividly coloured plants in the app and already
verified. Reuse across worlds is the house pattern (`moonCrater` serves Mars, `dustDevil`
serves Dinosaur Island).

### Volcanoes & Rocks, and why a TINT CAN ONLY BE AS DETAILED AS THE MESH UNDER IT

`VolcanoProps.js` + `volcanoLayout()`. A gallery world -- in `PRESET_WORLDS`, deliberately not
in `MENU_WORLDS`. A cut-away stratovolcano with its plumbing exposed, the lava it is making,
and the twelve rocks of the rock cycle laid out where a student can walk round each one.

**The one decision that shapes the file: a volcano teaches two different things and only one
of them is visible from outside.** The cone is a landform -- a silhouette, a slope angle, a
crater. The interesting half is the plumbing. So a quarter is cut out and the cut face is
OPAQUE, which is what a real museum model does; making the outside translucent is the trap
Fantastic Voyage spent a rebuild learning.

#### A ROCK IS NOT A LUMPY SPHERE

`boulder()` was a noise-displaced sphere, which is a potato: convex in every direction, the
same size along every axis, without one flat face or sharp edge on it. What makes stone read
as stone is that IT BROKE. Three things now come out of one RADIAL displacement -- radial
because a shared corner must move identically from every triangle that owns it or the surface
tears, which the puddingstone and the reef rocks each learned:

- **FRACTURE is the SUPPORT FUNCTION of a convex polyhedron.** The distance to a set of
  cutting planes along direction d is `min(h_i / (d . n_i))` over the planes facing that way
  -- a pure function of DIRECTION, so evaluating it per vertex cuts genuine flats into a
  sphere with no CSG and no risk of tearing. Plane normals come off a golden-angle spiral
  WITH jitter: nine free directions reliably leave one flank uncut, and an uncut flank is a
  bare piece of the original sphere.
- **MASS is a low-frequency lobe field plus a per-rock anisotropic scale.** This is the half
  that fixes "too symmetrical" -- a rock 1.2 long, 0.85 wide and 0.95 tall has stopped being
  a ball before any surface detail is applied.
- **`toCreasedNormals` is what makes it worth paying for.** It welds normals only where
  neighbouring faces are near coplanar, so fracture flats stay flat, arrises stay sharp and
  the weathered curve between them stays smooth. Flat-shading the lot instead (`toNonIndexed`
  + `computeVertexNormals`) shows the sphere's own latitude tessellation on every rounded
  part, which is the low-poly look this is getting away from. **The crease angle is bounded
  BELOW by the tessellation**: at `detail` d a smooth sphere already turns 360/d per step, so
  anything under that welds nothing and the rock flat-shades. 26 degrees against a detail-22
  sphere's ~16.

**`boulder()` hands back `geometry.userData.surfaceAt(dir)`**, the same displacement as a
function, because anything laid ON the rock has to ask where its surface actually is.
Hand-picked radii near a non-spherical surface are either floating or buried, the two
failures look nothing alike, and hunting each one separately is the whole afternoon. Pumice's
vesicles, the conglomerate's clasts, the schist's mica and the ammonite all go through it --
this is `RobotProps`' `onShell` lesson arriving on a shape with no closed form.

#### The grain map: the multiply this file warns about, used deliberately

Every specimen carries ONE near-white `grainTexture(kind, seed)` as both `map` and `bumpMap`.
A material with both `map` and `vertexColors` MULTIPLIES them -- normally the bug that turned
the bear dens black -- and here it is the whole point: the map has no colour of its own, so it
carries texture at a scale vertices cannot reach while the vertex tint goes on carrying hue
and large-scale structure. Same trick as the flower beds.

**THAT VERTICES CANNOT REACH IT IS THE ARGUMENT.** At detail 46 a 2.4ft specimen samples every
0.16ft and granite's crystals are an inch; pushing the tint frequency up to meet them is the
Nyquist trap, and under two samples per cycle it does not produce crystals, it produces BLUR.
The granite, marble and gneiss tint frequencies were all lowered to what the mesh can resolve
and the inch-scale detail moved into the texture. Dots are drawn NINE TIMES, wrapped by one
tile in both axes, because a rock is a closed surface and a seam draws a straight line down it.

Calibration notes: dots at r = 3..8.5px on a 256 tile read as POLKA DOTS, not grain -- small
and low-contrast, with a second much coarser and fainter blotch pass, is what reads as rock.
And **a near-white albedo CLIPS under this world's sun+hemi**: marble's veining measured a
0.41-to-0.82 spread in the buffer and rendered as a white egg, so the pale rocks were darkened
and `hemiIntensity` came down from 1.85 to 1.7.

#### THE CUT FACE, and three bugs stacked behind one another

Each one hid the next, and the third is the most generally useful thing in this file.

1. **`revolve` closes a partial sweep with its own radial caps and they are NOT usable here.**
   It picks each cap's winding assuming the profile runs in its natural direction, and this
   profile is REVERSED because that is what makes the outer surface face outward (measured
   +0.701 against -0.701). Reversing fixes the cone and inverts both caps with it, so the one
   surface the model exists to show was back-face culled: it rendered as a hollow tent.
2. **An `extrudeOutline` replacement looked right and was still wrong.** AN EXTRUDED OUTLINE
   HAS NO INTERIOR VERTICES -- a fan from the centroid to the outline points, exactly like a
   `CircleGeometry` -- so a per-vertex tint had nowhere to land and eleven correctly-computed
   strata interpolated across four enormous triangles into a smooth wash. The data was right
   and there was nothing to draw it on. Fantastic Voyage's villi floor died the same way.
3. **A grid fixed that and exposed Nyquist again.** Eleven nested bands over a 58-column grid
   is two or three samples per band near the base, and a hard threshold cannot do better than
   the mesh under it: the section came out as a STAIRCASE, which reads as a rendering bug
   rather than as geology.

**So the section is a TEXTURE.** The face is a flat plane with known extents, painted per texel
by the same region predicates the solids are built from -- razor sharp at any mesh density --
and it carries an `emissiveMap` as well, which is the only way the chamber and the conduit can
glow while the rock around them stays rock (`emissive` is a flat material colour and
`vertexColors` does not multiply it). It gets its own mesh, since a material cannot carry both
a map and vertex colours without multiplying them.

**`createImageData` returns an ImageData, not the array.** Writing indices straight onto the
object silently does nothing and `putImageData` then lays down the all-zero buffer it was
created with -- a completely black cut face, indistinguishable at a glance from inside-out
normals, which is what it was first mistaken for. `.data`.

**A canvas holds sRGB bytes and `THREE.Color` works in linear**, so anything computed as a
Color and written into an ImageData has to be converted back or every band lands about a stop
too dark.

**ONE description of the plumbing, used twice.** The chamber, conduit, dikes and sill are each
a region of the (radius, height) plane, used both to build the solids that fill the notch and
to paint the same structure onto the face. With two descriptions a chamber's painted outline
and its own wall drift apart and the model stops reading as one cut object.

Four more that generalise:

- **AN EVEN ALTERNATION OF EQUAL BANDS IS A BEACH UMBRELLA.** Real beds differ in thickness by
  an order of magnitude, so the band coordinate is WARPED before it is quantised -- two sines,
  and the single biggest thing separating a section from a stripe. Eleven layers over an 82ft
  radius is 7ft a bed and reads as a tent however it is coloured; 27 reads as bedding.
- **A CUT FACE IS LIT ENTIRELY BY THE HEMISPHERE**, because it faces sideways and opens toward
  the spawn while the sun rakes from behind. Painted at basalt's honest near-black the strata
  were eleven distinct colours in the buffer rendering as one flat black wall.
- **MAGMA CHILLS AGAINST THE ROCK IT SITS IN.** One `meltHeat(r, y)` ramp serves the chamber,
  the conduit, the dikes and the sill, dark and crystal-rich at the contact and incandescent
  only at the core. Painted at one flat bright colour the chamber is a lightbulb in the
  mountain and the dikes are drinking straws -- which is exactly how two passes rendered.
- **EVERY DIKE HAS TO DIE INSIDE THE ROCK**, and its far end has to be checked against the
  flank rather than guessed. Two of the first three ran to r = 27 at y = 55, where the flank is
  20 wide, and stood off the mountain as orange spikes. Both cut faces show the same set
  mirrored, so three apiece reads as a sunburst; two thin ones read as intrusions.
- **A "cutaway" solid buried in the SOLID sector is invisible from every angle.** The dikes and
  the sill are painted only. Built as solids the only thing they contributed was breaking out
  through the flank.

#### A STRATOVOLCANO IS DARK, and a flow follows the slope it is on

The first cone lerped its flank most of the way to pale ash and rendered as a smooth tan
circus tent -- which no amount of gullying would have rescued, because the problem was ALBEDO
rather than shape. It is old dark basalt streaked with pale ash where the last fall settled,
and RED round the vent, where steam and air have been at the rock while it was still hot.

**The gullies have to be DEEP and they have to VARY.** 3.5% of the radius is a traffic cone; a
barranca is tens of feet, and it bites hardest at mid-height because it has nothing to cut at
the summit and fans out into the apron before the base. An even comb of them at one depth is a
fluted column, which is the other way to make a smooth object look manufactured.

**A FLOW HAS TO START ON THE CONE'S OWN SURFACE, and hand-picked x/z cannot do it.** The flank
is 82ft at the base and 20ft at 55ft up, so a placement that looks right on the plan is either
buried in the mountain or hanging beside it -- one sat 14ft inside the rock and read as a black
slab floating in the notch. `flankFlow` in the layout solves for the radius at the height asked
for, sets the yaw to the same bearing, and takes the run and the fall off the cone as well.

**`lavaFlow`'s `curve` exponent is measured off the cone, not chosen.** It was 1.25, which
falls SLOWEST at the start -- exactly where a stratovolcano falls fastest -- so every flow left
the flank within a few feet and arched over the mountain like a flying buttress. Solving the
flank's own profile for the half-way point gives 0.908.

#### Lava: a crack network as an EMISSIVE MAP

A flow is a dark crust with incandescent cracks in it, and the cracks are the whole reason it
reads as molten. They cannot be a vertex tint, for the reason above, so `crackTexture()` paints
them as an emissiveMap -- **Worley F2-F1 on a jittered grid**, the distance between the two
nearest sites, which is near zero exactly on a cell boundary. That is not a stylistic choice: a
crust cracks into polygons because it is contracting as it cools, and the boundaries of a
random point set are what those polygons are. Only the 3x3 neighbouring cells are searched and
the indices wrap, so it is fast and it tiles. **The cooling gradient is baked into the texture
along v**, because with one flat `emissive` there is nowhere else to put it -- otherwise the
toe of a 60ft flow glows as brightly as the vent.

Three lava props, and the two new ones are where the lava a student can actually reach lives:
`lavaLake` in the crater (a fountain plays above a HOLE otherwise, and looking down into a
summit crater is what a student walks up the model to do) and `pahoehoeField` at ground level.
Everything else is 20 to 90ft up the cone, where ropes, cracks and glow are all below what the
eye can resolve. **Pahoehoe ropes are one term in the surface function** -- the skin chills
first and is dragged forward by the fluid underneath, so it wrinkles into arcs that bow
DOWNSTREAM at the middle and lag at the levees -- and a displacement of a surface cannot open a
gap in it.

**Three orbs, each buried in something.** An orb is a visible glowing ball as well as a light,
so one hung in the open notch reads as an artifact floating in front of the hero. The crater
one sits below the rim; the two on the plain sit inside their own sheet's crust.

#### The red

The theme's `sky` is the FOG, so it is the single biggest red decision in the world -- every
distant scoria field and the whole horizon fade into it. Pushed to a real sunset it stops
reading as daylight and starts reading as Mars, which this app already has: `0xb07a63` is a
dusty iron haze, and it still leaves the pale ash ground brighter than the sky, which daylight
requires. The ground ramp reddens without dropping its top end, because the pallor is
load-bearing -- against a dark ground the basalt, obsidian and slate specimens all vanish.

**The red is IRON and it belongs where the heat has been.** Basalt is about a tenth iron by
weight and oxidises the moment steam and air get at it hot, which is why the inside of a cinder
cone and the top of a cooling flow are brick red while the same rock a foot deeper is grey. At
full saturation those colours came out as traffic cones scattered on the plain: oxidised basalt
is a dull brick, and what makes it read as iron is that it is DARKER than the ash around it,
not more colourful than everything else in the world.

**Performance, measured**: 61 records (55 props) / **155 draw calls** / 410k drawn / 110
geometries / 110 meshes / **7 transparent** / **3 point lights** / 44 textures. 377ms to build,
889ms to load. Well inside the ~1.5M / <1000 envelope, with the section's two 640px canvases
the largest single cost.

### JavaScript Basics, and a world whose exhibits ARE its programs

`JsBasicsProps.js` + `jsbasicsLayout()`. A gallery world -- in `PRESET_WORLDS`, deliberately
not in `MENU_WORLDS`. The world that teaches the Program panel's JavaScript mode: five
lessons down an avenue, each taught by a working machine beside a board showing its code,
with the Code Beacon -- a lighthouse in JavaScript yellow -- at the far end.

**`prop()` takes `programJs` now, and that one field is the world's mechanism.** It rides
into the record as `programJs` + `programMode: 'js'` (persisted fields, like everything in a
record), so a preset prop ships RUNNING JavaScript through the same `startFromRecord`
funnel a student's own saved code uses. Six objects here do: the beacon's lamp, the golden
screw, the mood stone, a patrolling robot, and Ping and Pong. The carousel introduced
ship-with-a-program for blocks; this is the same idea in the other language, and the whole
point of the world is that a student can open any of them and READ it.

**The hero is two objects on purpose.** The tower stands still; the lamp -- a separate prop
at `BEACON_DECK_Y`, an exported constant so the two agree without asking each other --
turns on `forever { rotate 2 }`. That is the observatory's dome-and-telescope pattern
promoted to the hero itself, and the placard by the door prints the four lines. The lamp
carries two opposed beam cones (apex AT the lamp -- a beam is narrow at its source; the
first pass had the cones backwards), `fog: false`, additive-ish translucency, so the
rotation reads from anywhere in the world.

**A TINT CAN ONLY BE AS DETAILED AS THE MESH UNDER IT, hit within the hour of writing it
down.** The beacon's spiral daymark is a per-vertex tint, and the first shaft was lathed
from its six authored stations -- so the spiral's diagonal edge had a whole storey of
vertical interpolation to smear across and the tower rendered airbrushed. The lathe now
runs over the profile resampled at 1.2ft rows. Same lesson, third file: the fix is always
more mesh or a texture, never a hotter tint.

**Ping and Pong are an eternal conversation as a teaching exhibit.** Each robot's
`whenSaid()` answers the other's `say()` after a polite spin (`repeat(12, rotate(30))` --
twelve small turns, because one `rotate(360)` is instant and therefore invisible); Ping's
main script opens the conversation once at boot. The hats' no-re-entry guard is what keeps
politeness from becoming runaway, and the pair demonstrates say/whenSaid/wait/repeat in one
glance of speech bubbles.

Smaller things worth keeping:

- **The code boards paint real syntax highlighting on canvas**, with the editor's own token
  colours copied into `TOKEN_COLORS` -- the board a student reads and the pane they then
  type into must be one palette. Fit-to-longest-line before drawing (the cardTexture rule);
  `map` + `emissiveMap` from the same texture so the dark panel stays legible at any sun
  angle; posts OUTSIDE the panel because the text is left-aligned (the activity-board rule).
- **The mood stone is NEAR-WHITE because a colour tint multiplies** -- white is the only
  base every colour in its cycle actually shows on. Its facets are flat because
  IcosahedronGeometry is non-indexed and `computeVertexNormals` can only make face normals
  -- the reef-rock trap, used deliberately for once.
- **The toy blocks are a soft loft, not a box**: a vertical `solidLoft` whose section
  rounds harder at top and bottom closes every edge and corner. Letter plates are
  alpha-tested planes proud of each face, one shared canvas per block.
- **The patrol robot's square is `glide` + instant `rotate`** -- glide is the only smooth
  translation, so patrols read as driving; `moveUp` bobbing was rejected because moveUp is
  stepwise and reads as teleporting.
- **The browser station points at the app's own coding guide** (`guide/coding.html`) --
  same-origin, so it frames.

**Performance, measured**: 30 records (27 props) / **100 draw calls** / 378k drawn / 61
meshes / **5 transparent** / **0 point lights** / 23 textures. 322ms to build; the world
file is 9.0 KB. The beacon is ~20k triangles, the screw 6k, the boards 0.3k each --
the whole world is lighter than one of the volcano's rock specimens, and it reads better
from the spawn than anything half its cost.

### A Bug's Life, and building a world around CHALLENGES

`BugProps.js` + `bugsLayout()`. The only preset laid out as a **workshop** rather than as a
place to look at: an avenue from the spawn to the nest, five `tutorial-board` building
challenges down the left, five `activity-board` coding challenges down the right, and the
whole middle strip deliberately empty. That emptiness is the design — a fresh construction
piece lands `PRIMITIVE_SPAWN_DISTANCE` ahead of the student and spirals out, so anything in
the middle is something to build round. My World found that out; this world is laid out to
it from the start, with every prop pushed to the sides and the far end.

**The scale is inverted.** Every other world shrinks the scenery to fit a 5ft person; this
one leaves the person at 5ft and grows the world to about **60×** around them, so a grass
blade is a fifty-foot tower and a breadcrumb is a boulder. Not the literal 300× an
ant-to-human ratio gives: at 300× one blade is past the world bound and past the fog, and
you lose the sky — at which point it stops being a meadow and becomes a cave.

**What makes an ant read as an ant**, in order: a genuinely narrow **petiole** (waist)
between the middle and rear sections; **elbowed** antennae, bent sharply partway, not smooth
feelers; and six legs on the **middle section only**. Two things nearly cost it:

- **Thick dark legs make a spider.** The first pass had them at 0.11 radius in the darkest
  tone available, and six heavy black legs splayed round a body is unmistakably the wrong
  animal. They are wiry now and the same colour as the body.
- **Near-black detail on a near-black silhouette is not detail.** The antennae were drawn in
  the darkest tone and vanished against the body and the soil. They carry half the
  identification, so they are the *lightest* tone on the model, thicker than instinct says,
  and have a bead at the elbow to say "this bends here".

Traps that generalise:

- **A curved stem has to be sampled along a real curve.** `grassBlade` first placed each
  segment at its own height and rotated it by the local slope — but the sideways
  displacement grows far faster than the vertical spacing, so by halfway up the pieces no
  longer touched and a clump read as green dashes hanging in mid-air. It now walks a
  `QuadraticBezierCurve3` and derives each segment's rotation FROM the two points it lies
  between, which cannot come apart.
- **A hole needs a real crater, not a dark spot.** `antHill`'s pellets stop well short of
  the middle; ringing them all the way in left a dome with a smudge on top.
- **Anything inside a cutaway chamber must sit in FRONT of the void's own front face.** The
  granary's seeds were at the slab's mid-depth, which is *inside* the dark box, so the
  chamber came out empty while the identically-built nursery next to it showed its eggs.
- **A grid of boxes is pixel art.** `nestCutaway`'s soil face staggers alternate courses by
  half a cell and varies every lump's size; on a straight grid the vertical joints line up
  all the way down and a wall of earth reads as Minecraft.

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

**Every sequence on these boards has been run.** That used to carry a hard constraint:
`move X/Y/Z` shifted an object along the **WORLD** axes, so rotating something did not
change where it then travelled, "drive around the field in a square" was not writable at
all, and every patrol had to be an out-and-back with a `rotate 180 degrees` in the middle.

**`move forward` and `glide` removed that constraint**, and the boards were rewritten
when they landed. Both follow the object's own facing (`getWorldDirection()`, i.e. its
local **+Z** — the same forward every prop in `src/props/` is authored to), so a `rotate`
now genuinely steers. `repeat 4 { move forward 10, rotate 90 }` returns to its exact
starting point, and several boards teach that as "360 divided by the number of sides".

**Motion is `move forward` / `move up by` / `glide` / `rotate` / `go back to start`.**
`move up by` is the one that is NOT relative to facing, deliberately: up is up whichever
way a thing is pointing, and a lift that tilted with its object would be useless for the
jobs it exists for — raising a dome onto a building, floating a balloon, dropping rain
(negative goes down). Everything else follows the object's own +Z, so a `rotate` genuinely
steers and `repeat 4 { move forward 10, rotate 90 }` closes a square.

There was a period with no vertical block at all, and five boards that had raised an
obelisk, a dome, an ash column, a rain curtain and a helicopter were rewritten onto
`changeSize`/`setSize`, `setOpacity` or `say`/`whenSaid`. Those rewrites are still there
and still work — they were not reverted when `move up by` landed, because a board that
teaches two blocks at once is not improved by teaching one.

`moveX`/`moveY`/`moveZ` are a different thing entirely and are **retired** — see below.
Do not confuse `moveY` (retired, world axis, absent from the palette) with `moveUp`
(current, world axis, in the palette). They do the same arithmetic; only one of them is
something a student can still find.

`moveX`/`moveY`/`moveZ` still exist in `BLOCK_DEFS` and in the runner, flagged `retired`
and absent from `PALETTE_ORDER`. **They must stay there.** A block type is persisted
inside every saved program — in IndexedDB, in an exported world file, in the copy a
student sent a classmate — so deleting them would not tidy anything up, it would turn
somebody's working program into a silent no-op with no way to see why.

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

### Flowers: geometry for the shape, a texture for everything else

`flowerBed()` and `wildflowers()` both plant the same thing — a balloon flower
(*Platycodon grandiflorus*) modelled from a photograph: a five-pointed star of fused
petals with darker radiating veins, a deeper throat, and five pale stamens round a short
style. They were spheres on sticks.

**The whole design turns on one idea: the shape is geometry and everything else is a
texture MULTIPLIED by a per-flower vertex colour.** That is normally the trap this file
warns about — a material carrying both `map` and `vertexColors` multiplies the two, which
is what turned the bear dens black — and here it is the entire point. The map is a
near-*white* veined disc, so it carries pattern and no colour of its own; the vertex
colour carries the hue and is different on every bloom. One 256px canvas and one merge
therefore give a drift where no two flowers share a colour, each correctly veined. Painting
veins as geometry would be fifteen extra solids on each of ~740 flowers.

Four things worth keeping:

- **A more detailed flower is a CHEAPER one here.** The head is a 10-segment
  `CircleGeometry` with alternate rim vertices pushed out to the tips — ten triangles,
  against roughly forty for the 5×4 sphere it replaces. The Park's triangle count went
  *down* by ~48k. Its UVs must be rewritten from the final outline, though: `CircleGeometry`
  lays them out for the circle it started as, and leaving them squeezes the veins into the
  notches.
- **Draw the veins FAT in texture space.** A bloom is ~30 screen pixels across with a
  student standing over it, so a 3px line on a 256px canvas lands under one screen pixel
  and mips to nothing — the first pass came out as flat coloured stars with no veining at
  all.
- **`notch: 0.66`, not 0.58.** A balloon flower's petals are fused for half their length;
  a deep notch makes a starfish, and narrow petals have no room to show veins.
- **Size and colour are randomised, but height and bloom size are the SAME roll.** Rolled
  independently a drift is big flowers on stubby stems beside pinheads on tall ones, which
  reads as broken rather than varied. Hue, saturation and lightness are then jittered per
  flower on top of the palette pick — eight flat colours across 170 flowers still reads as
  eight kinds of plastic.

`flowerTemplates()` pre-builds eight size buckets, each with its stem and two leaves
already merged into one stalk geometry, so **every plant costs `mergeColored` exactly two
parts** — a stalk and a head, the same as the old sphere-on-a-stick. The first version
built a fresh stem, two leaves and a head per plant: ~3,700 geometries and 2,960 parts for
the Park. Nobody can tell 170 continuously varied stem heights from 170 drawn out of eight
once each also has its own lean, yaw and colour.

**Deliberately not replaced**: `floweringTree()`'s blossom canopy (a crown mass, not a
flower model), Dinosaur Island's `magnoliaShrub()` (a Cretaceous magnolia, and that world
teaches it as one of the first flowering plants — a modern garden perennial there would be
wrong), and the water-lily dots on the pond's lily pads.

### The Canada goose, and how a small animal is built here

`canadaGoose()` in `ParkProps.js` is the app's one detailed bird, modelled from a
photograph, and `pondGeese()` is now just a pair of them swimming. It is registered as
`canada-goose` too, so a single one can be placed anywhere. Both poses come out of the
same builder: `pose: 'swim'` sinks the bird to its waterline and drops the legs, which is
the one deliberate break from "origin is the base centre" — a floating bird has no base.

**A species is a list of field marks, not a silhouette.** The first version was three
spheres and it was unmistakably a duck-ish blob; what makes this one a Canada goose is,
in order of how much each one buys: the **white chinstrap** (a strap, narrow at the eye
and broadening to meet its twin under the throat — not a white disc on the cheek), a
**long** black neck carrying the head a full body-depth clear of the back, a **pale**
greyish breast that is nearly as light as the belly, and pale-edged feathers over a brown
wing. Get the chinstrap and the neck length and it reads at fifty feet.

Four things this hit that generalise to any small animal here:

- **Feathers need something underneath them.** Rows of blocks on a bare flank read as
  planks stacked on a goose. A solid wing *shell* supplies the mass and silhouette, and
  the rows are laid over it purely for the barring — neither does the other's job.
- **They have to OVERLAP.** The step along a row is half a feather, not a whole one;
  spaced feather-to-feather the shell shows between them and it becomes a fence.
- **A row sunk inside the shell is invisible**, and the shell is a flattened tube, so it
  is widest at its middle and narrows toward the spine and the flank. Each row's lateral
  offset is set to its own height, which is why they are not a straight line.
- **The wing must start behind the shoulder.** The pale breast in front of it is a third
  of what you see from the side; buried, the bird is a dark lump.

Two mechanical notes. `gooseSolid()` bakes a full `Matrix4` into each geometry rather than
using `mergeColored`'s per-part Euler+translate, because nearly every piece is a squashed
sphere or a feather rolled about its own long axis — and because it lets a whole pair
merge into **three** meshes total (matte underparts, matte plumage, glossy head) instead
of three per bird. Its `about` argument is the pivot for that rotation and scale, and it
is not optional decoration: the swept tubes are authored in absolute bird coordinates, so
flattening the belly by 0.6 around the default origin does not squash the belly, it drops
it half a foot through the floor.

**Segment counts here are low because of VIEWING DISTANCE, not because of the budget** —
4.4k triangles a bird, ~7.8k for the Park's pair, against 11.5k before a pass over every
sweep and sphere. These are read from across a pond, where an 18-segment sweep and a
26-segment one are the same goose. That argument is perceptual and survives the move to
an i5/i7 target unchanged: spending triangles on detail nobody can resolve buys nothing
at any budget.

**The inverse is now the live question, though.** `canada-goose` is registered as a
standalone prop, so one can be placed anywhere — including somewhere a student walks
right up to it, which is exactly where 18 segments *does* show. A near-field rebuild at
higher segment counts is well within the new envelope and is the kind of fidelity the
hardware-target section is asking for; the pond pair is simply not the case that needs
it. The Park is 752 draw calls / 592k triangles / 3.5ms with the new pair in it, against
748 / 578k before: two extra draw calls for the whole flock.

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

### The marker: an in-world 3D pen

`MarkerTrail.js`, driven by four Look blocks — `marker color`, `marker down`, `marker up`,
`erase all marks`. With the marker down an object leaves a **3-inch coloured tube** behind
it wherever it goes, in three dimensions: `move up by` lifts the line off the ground with
the object.

**A TUBE AND NOT A LINE, and that is not a stylistic choice.** `THREE.Line` ignores
`linewidth` on essentially every platform — the WebGL spec makes it optional and Chrome has
never implemented it — so a "line" is always exactly one pixel wide however close you get,
which is invisible from across a world and unusable in VR. A tube is a real object: it takes
the sun, casts a shadow, and stays legible at any distance.

**THE COST MODEL IS THE WHOLE DESIGN, and both obvious implementations are unusable.** One
small mesh per segment reaches hundreds of draw calls within seconds of a `forever` loop,
which is the single thing an integrated GPU cannot survive; rebuilding one `TubeGeometry`
from the whole path each time it grows is O(n²) and stalls the frame. So a **stroke is ONE
mesh with PRE-ALLOCATED buffers and a growing draw range**: appending a segment writes a
ring of vertices and bumps a counter — O(1), no allocation, no index rewrite (the index is
written once for the full capacity, and indices for rings that do not exist yet are simply
never reached). A full stroke is closed and the next starts **from its last point**, so a
`forever` loop draws one unbroken line across as many meshes as it needs at constant cost.

Six things worth keeping:

- **The frame is PARALLEL TRANSPORTED from ring to ring**, not recomputed. A Frenet frame
  flips through every inflection and is undefined on a straight run, and a marker's path is
  mostly straight runs with corners in them — the same reason `LoftKit.sweepProfile`
  transports its frame.
- **Both ends are capped with a zero-radius ring.** An open tube end is a hole, and a hole
  is exactly what a 3-inch pipe viewed end-on shows. Two extra rings per stroke.
- **`frustumCulled = false`.** The buffer is allocated up front and mostly zeroed, so a
  bounding sphere computed from it is wrong and the stroke vanishes when you look away. One
  extra draw call is much cheaper than a line that disappears.
- **THERE IS NO TELEPORT DETECTION, deliberately.** `move forward 8` completes inside a
  single tick, so an 8ft step in one frame is an ordinary line — any jump threshold would
  chop legitimate strokes in half. `go back to start` therefore draws its return line, which
  is what Scratch's pen does and is the more predictable rule.
- **Sampled once a frame, not driven from the motion blocks.** `glide` interpolates across
  many frames and a rotating object moves without any block firing, so watching the object's
  actual position catches every case with no per-block plumbing.
- **A colour change closes the stroke and opens a new one AT THE SAME POINT.** A stroke is
  one colour; sharing the point is what keeps the join solid rather than leaving a gap the
  width of one frame's travel. There is ONE material for every mark in the world, carrying
  per-vertex colour — a material per stroke would be one to create and dispose per colour
  change.

**The tip is at the object's own origin lifted by the tube's radius.** Every prop here is
authored with its origin at its BASE CENTRE, so that rests the tube on the ground rather
than half-burying it.

**`erase all marks` clears EVERY mark in the world, not only this object's** — that is what
the block says, and it is what makes it useful when five robots have been scribbling. An
object still holding its marker down keeps drawing from where it now is, because lifting
every pen would make the block silently switch the marker off, which is not what it says.

**MARKS ARE NOT PERSISTED, and that is deliberate rather than unfinished.** They are the
*output* of a program, and the program itself is saved — press ▶ and they come back. Scratch
does not save its pen canvas either. Persisting them would mean a new record kind, a world
file that grows without bound as a `forever` loop runs, and a rehydration path for geometry
this project otherwise never stores.

`MARKER_MAX_POINTS` (24,000, about 60 meshes) exists for the same reason `MAX_WORLD_OBJECTS`
does: `forever { move forward }` with the marker down is unbounded by nature. Hitting it
toasts once and stops drawing rather than degrading the frame rate.

**`markerTrail.clear()` must be called anywhere `registry.clear()` is** — Clear World and
`WorldStore.loadFromRecords`. The two are not linked automatically, which is the same trap
`PlayIconManager.clear()` carries.

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

### The Block Code / JavaScript toggle, and how one program has two frontends

The Program panel's title row carries a toggle: **[Block Code] [JavaScript]**, blocks by
default. In JavaScript view the palette and workspace are replaced by a syntax-highlighted
code pane where the object is programmed in real JavaScript. `src/JsProgram.js` holds all
three pieces -- the blocks→JS transpiler, the highlighter, and the runtime -- and
`ProgramManager` runs both kinds.

**THE RUNTIME IS ASYNC/AWAIT OVER THE SAME EFFECTS OBJECT THE BLOCK RUNNER USES.** Every
api function (`moveForward`, `rotate`, `glide`, `say`, the marker four, all of them)
performs the identical side effect its block performs -- most ported line for line from
`ProgramRunner`'s cases, the rest delegated to the very same `effectsFor()` callbacks --
and then awaits one scheduler tick. `ProgramManager.tick()` resolves pending ticks once per
frame, so JavaScript steps at exactly the block cadence: `glide` interpolates over real
time, `forever` runs at the documented half-rate (body + one unconditional tick), and
`wait` holds on a timestamp. One implementation of what "move forward" MEANS, two ways of
writing it -- that is what stops the frontends drifting.

**Why async/await and not an interpreter:** arbitrary JS can only pause where it awaits,
and instrumenting bare loops to yield needs a real parser this project does not carry. So
`repeat()`/`forever()` are supplied functions that guarantee at least one tick per pass
even when the body awaits nothing (`repeat(1e9, () => {})` is a slow counter, not a hung
tab). A bare `while (true) {}` still hangs -- the starter template and the hint line under
the editor both steer loops through `forever()` for exactly that reason.

**Switching views never destroys either representation.** The blocks and the JavaScript
live side by side on the record and BOTH are saved: `program` (blocks, as ever), plus three
new PERSISTED fields -- `programJs` (the text), `programMode` (`'js'` runs the JavaScript;
absent means blocks), and `programJsAuto` (the JS was generated from the blocks and never
hand-edited). While `programJsAuto` holds, entering the JavaScript view regenerates from
the current blocks, so the code tracks what the student just built; the first keystroke in
the pane clears it and their text is thereafter left alone. All three fields ride through
IndexedDB, world files and duplication untouched -- like every persisted field, they are
only ever added, never renamed.

**`recordHasProgram(record)` in ProgramManager.js is the one predicate** for "does this
record carry anything runnable", and `startFromRecord()` is the one dispatch; WorldStore's
`addAndRun`, PlayIcon's refresh/click and ProgramEditor's save all go through them, so a
saved JavaScript program resumes on load, earns a green ▶ and restarts from it exactly as
blocks do.

Things this feature learned or must not lose:

- **`eval` and `arguments` must never join the shadowed-globals list** -- strict mode
  forbids them as parameter names and the whole compile throws. The shadow list
  (`window`, `document`, `alert`, `location`...) is accident-prevention, not a security
  boundary: it stops `alert()` freezing the animate loop and `location=` navigating the
  app away, nothing more.
- **A syntax error is caught at Save**, with the editor still open and the code still in
  the pane -- nothing saved, nothing lost. Runtime errors (a misspelled name is a
  ReferenceError) toast via `programManager.onScriptError`, because a student never opens
  the console; blocks keep their console-only behaviour since blocks cannot fail that way.
- **Copies do not breed, by flag rather than by strip.** JavaScript cannot have its
  `duplicate()` calls stripped the way `stripDuplicateBlocks` rewrites a block tree, so
  `Duplicator.cloneRecord` sets a persisted `programNoDuplicate` on js-mode copies and the
  runtime makes their `duplicate()` a no-op. The copy keeps the rest of its behaviour.
- **JS hats hear block broadcasts and vice versa** -- `whenSaid('go', fn)` registers into
  the same `broadcast()` a block `say` feeds, with the same normalisation and the same
  no-re-entry guard, so challenge-5-style pairs work across the language boundary.
- **Stopping a JS run is dropping its pending resolvers.** Nothing resolves them again, so
  every await in the user's code simply never returns and the async frames become
  unreachable -- no flags to poll, nothing to leak. A run whose main script ends stays
  registered only if it holds hats, mirroring "a program that is nothing but hats sits
  still until somebody speaks".
- **The editor is the textarea-over-highlighted-`<pre>` trick.** The textarea owns text,
  caret and scrollbar (text transparent, caret white); the `<pre>` under it owns the
  colours; every metric -- font, padding, wrapping, tab-size -- must be identical on both
  layers or the caret sits beside the wrong character. The highlight layer is
  `overflow: hidden` and scrolled programmatically in the textarea's scroll handler.
  `#program-palette`/`#program-workspace`/`#program-js-pane` all carry explicit `[hidden]`
  rules because their id styles' `display` would otherwise beat the UA's hidden default.
- **Tab inserts two spaces** instead of leaving the field, and the arrow keys are safe in
  the pane because `PlayerController.isEditableTarget` already covers TEXTAREA.

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

Menu ▸ **Create Model** is a top-level group with one button per shape, and **Load Object
is a nested dropdown at the bottom of it** — `_group()` now takes a `nested` flag and
appends whatever children it is handed, so one group can sit inside another (see the menu
notes above for why the two levels are tracked separately). Each shape button drops a 2ft yellow construction
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

**FILTERING THE BEZEL OUT OF THE RAYCAST WAS HALF A FIX, and the other half is that a
panel has to OCCLUDE.** Removing it from the pickable set does not make the ray stop at
it — the ray carries straight on and returns whatever is BEHIND the panel. So a click on
a video's play button that came through the hit-test gap opened Program on the workbench
standing behind the screen, which reads as the panel having opened a menu and is worse
than the bug the filter was added to prevent. The bezel is therefore left IN the pickable
set and rejected *after* the raycast, on `hits[0]` only (`ObjectMenu.isBehindPanel`): a
panel hides what is behind it, so a click on one selects nothing at all. Note the panel's
bottom edge sits on the ground, so a prop the panel is standing on can legitimately be
nearer than that last inch of bezel and still open its own menu — that is correct, not a
leak. Construction pieces are still filtered out *before* the raycast, because a build
piece deliberately does not occlude the world behind it.

### Putting a YouTube video in the world

Menu ▸ Create Model ▸ Load Object ▸ **YouTube Video**. There is no way to put a YouTube
video on a mesh: a `THREE.VideoTexture` needs a `<video>` element it can read pixels out
of, YouTube serves no direct file, and a canvas that has drawn a cross-origin frame is
tainted so readback throws. The browser panel already in the app *is* the answer — a real
`<iframe>` positioned by `CSS3DRenderer`, interactive because it is still DOM.

**The whole feature is one URL rewrite** (`src/WebUrl.js`), and it exists because
`youtube.com/watch` sends `X-Frame-Options` and will not frame at all. A blocked frame is
undetectable from the parent page — `contentDocument` throws for *any* cross-origin frame,
blocked or not — so a student who pastes the link out of their address bar gets a blank
rectangle and no explanation. Only `/embed/` frames. `youtubeEmbedUrl()` accepts every form
(`watch?v=`, `youtu.be`, `shorts`, `live`, `playlist`, an already-correct `embed`), carries
`t=`/`start=` across as seconds, and returns **null** rather than a guess for a channel, a
search or a non-YouTube address — the menu action toasts that instead of placing a dead
panel. `normalizeBrowserUrl()` wraps it for the panel's own address bar, so a watch link
pasted *there* is rewritten too.

Four things that were wrong and are worth keeping:

- **`referrerpolicy="no-referrer"` BREAKS YouTube outright.** The player checks the
  referrer against the video's embedding permissions and answers a request carrying none
  with "Error 153 — Video player configuration error", rendered in YouTube's own dark
  chrome, which looks exactly like a broken app rather than a policy answer. It is
  `origin` now: scheme and host, never the path, so which page a student is on still does
  not leave the machine and it is stricter than the browser's own default.
- **A framed player is inert without `allow` and `allowfullscreen`.** Autoplay and
  encrypted-media are what let it start and play protected streams; the fullscreen button
  is present and does nothing without the attribute. Camera, microphone, geolocation and
  clipboard-write are deliberately NOT granted — they would go to every site a student
  ever types in, not just to the video.
- **The placement spiral counted `registry.count`.** `SPAWN_SPACING·√n` exceeds
  `SPAWN_DISTANCE` for any populated world, so on Da Vinci's Studio (59 records) a fresh
  panel landed 51ft away *behind* the student: the toast said "placed" and there was
  nothing in front of them. It counts live panels now — the same correction
  `placePrimitive()` already carries, and the same trap the units section predicts.
- **The embed is `https:` inside an `http:` page, which is allowed.** That is the opposite
  direction from `WEB_BROWSER_DEFAULT_URL`'s mixed-content problem, so this works today
  and keeps working if the domain ever gets a certificate.

`UrlPrompt.js` asks for the link — a one-field modal rather than `window.prompt()`, which
blocks the page and stops the animate loop dead, and which has nowhere to put the sentence
explaining which kind of link works. Its Esc listener is **capture-phase on window** so it
closes the box rather than reaching `VRView`'s Esc. The VR row is `leavesVR: true`, since a
text box to paste into is exactly what a headset cannot show.

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
