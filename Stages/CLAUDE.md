# Edusim Stages

Make games, stories and animations with blocks, on a flat stage, in a layout anyone who has used
Scratch expects. A sibling of the main app (`../src/`) and of HiFi (`../HiFi/`), served at
**`https://edusim3dweb.com/stages/`**. The plan, the decisions behind it and what is still open are in
`../edusim-stages-plan.md`.

```bash
cd Stages && npm install          # the root `npm install` must be done first (three comes from there)
npx vite --port 5193 --strictPort # dev server
npm run build                     # Stages/dist, deployed by ../deploy.sh stages
```

## What it is made of

| Folder | What |
|---|---|
| `src/blocks/` | `defs.js`, THE one table of blocks; `make.js`, creating blocks and the `B/C/C2/R/V` writing kit |
| `src/runtime/` | `Runtime.js` (threads, timing, every block), `geometry.js` (where sprites are, touching), `cast.js` (Scratch's value rules) |
| `src/project/` | `Project.js` (the saved format), `assets.js` (pictures, masks, sounds), `Store.js` (IndexedDB autosave) |
| `src/render/` | `StageRenderer.js`: three.js, orthographic, plus a 2D overlay for bubbles, monitors, captions |
| `src/editor/` | `BlockEditor.js`: the palette, the script area, drag and drop |
| `src/ui/` | `App.js` (the composition root), the costume and sound editors, the libraries, Projects, Tutorials |
| `src/text/` | `text.js`: the Text view, blocks to text and back |
| `src/templates/` | the official projects (`index.js`), their kit (`kit.js`) and the tutorials (`tutorials.js`) |
| `src/library/` | `cartoons.js` (GENERATED), `backdrops.js`, `libraryAdd.js` (incl. Edusim models as sprites) |
| `src/audio/` | `AudioEngine.js` (play, notes, record for export), `soundLibrary.js` (every sound generated) |
| `src/export/` | `VideoExport.js`: MP4 on a virtual clock |
| `tools/` | the checks and the picture makers (below) |

## Rules that are not obvious from the code

- **EVERYTHING SAVED IS ADD-ONLY**: block `type`s (Scratch 3's opcode names, so an import of a
  Scratch project's sprites is a lookup), input names, menu values, the project format
  (`format: 'edusim-stages'`, `version: 1`), library ids (`toon-robo`, `scene-hills`, `model:human-heart`)
  and gallery ids (links carry them: `?project=catch`). The IndexedDB name is `edusim-stages` and must
  never be the main app's `3dcoder-world`: /stages/ and /app/ share an origin, so they share IndexedDB.
- **IT DOES NOT USE THE MAIN APP'S BLOCKS, RUNNER OR EDITOR**, on purpose (plan, section 3): those
  move objects in feet along their facing and take a frame per block, and saved Edusim worlds depend
  on both. Stages imports from `../src/` only the Model Database (lazily, when the Models tab opens),
  `Mp4Muxer.js` and the Studio's tunes (`StudioAudio.js`). Nothing in `../src/` was changed for it.
- **TIMING IS SCRATCH'S**: 30 frames a second (`FRAME_RATE`), a loop yields once per pass, motion and
  looks take no frame, and a frame keeps running passes until something changed on screen (capped at
  `MAX_PASSES`, not wall time, so exports and checks are repeatable). A speed in a Scratch tutorial is
  the same speed here.
- **"STOP ALL" CLEARS EVERY SPEECH BUBBLE**, as Scratch's does. A game-over script that says its message
  and then stops all shows nothing. The official projects end with `stop other scripts in sprite`
  instead, and the tutorials say why.
- **CLONES ARE LIMITED TO 100** (decision F), counted across the project. Clones share their original's
  costumes, sounds and scripts, and their textures: the renderer counts users per texture, which is safe
  because Stages owns its own disposal (the main app's fresh-material rule exists only because of
  `PlacedRegistry.disposeObject3D()`).
- **THERE IS NO MICROPHONE** (decision E): no record button, no `loudness` block, no permission prompt.
- **COLOURS PASS THROUGH UNCHANGED**: textures are `NoColorSpace`, output is linear, no tone mapping. The
  sprite shader samples with `flipY` off (an ImageBitmap ignores flipY) and flips in the shader.
- **TOUCHING IS PICTURE-ACCURATE**: boxes first, then the two costumes' alpha masks over the overlap
  (`geometry.js`). Masks are built when a picture is decoded; without one (node) a costume is solid.
- **EVERYTHING IN A VIDEO IS DRAWN, NEVER DOM**: bubbles, monitors, captions and the ask box are painted
  on the overlay canvas, so `compositeTo()` is exactly the stage.
- **AN ASSET NEVER CHANGES ONCE MADE**: a painted costume or an effected sound is saved as a new asset,
  so every cache keyed on asset id stays right.
- **A DRAG READS ITS DROP FROM THE DRAG IT WAS GIVEN.** `onUp` clears `this.drag` first, so `findDrop`
  takes the drag as an argument. The first version read `this.drag` and nothing ever snapped.
- **KENNEY'S SCENERY TILES ARE OPAQUE WITH WHITE SKY**: `strip()` crops at the first row that is not
  white (measured per tile), or every outdoor backdrop has a white band across the middle.
- **The `.is-cap` class is not the `cap` shape.** A forever loop is a C block that is a cap; giving it the
  shape's class made it a flex row and collapsed its mouth.

## The libraries

- **Cartoons**: Kenney's CC0 packs. `node Stages/tools/build-library.mjs <folder of unzipped packs>` copies
  a hand-picked set into `public/library/kenney/`, keeps each pack's `License.txt` beside its pictures and
  writes `src/library/cartoons.js`. A pack with no licence file is refused.
- **Edusim models**: any Model Database card, built in the browser by `../src/models/index.js` and
  photographed from 12 sides into 12 costumes. The picker shows the main app's card pictures from
  `../app/models/thumbs/` (a dev middleware serves that path locally), so /stages/ must stay a sibling of /app/.
- **World backdrops**: Edusim's own world screenshots, cropped to 4:3 in `public/library/worlds/`.
- **Sounds**: all generated (`soundLibrary.js`), stored in a project as small mono WAVs.

## Checks

```bash
node Stages/tools/check-blocks.mjs       # the runtime, in node: timing, every category, a file round trip
node Stages/tools/check-text.mjs         # the Text view: every block round-trips, mistakes get good messages
node Stages/tools/check-templates.mjs    # every official project, run in Chrome on a virtual clock (dev server on 5193)
node Stages/tools/gallery-pictures.mjs   # re-render the project pictures (then node tools/build-stages-page.mjs)
node Stages/tools/shot.mjs out.png [--steps script.mjs] [--eval js]   # look at it
```

`window.__stages` is the app in dev. `app.runVirtual(frames, keys, { flag })` runs the project on the
virtual clock; `app.loadGallery()` gives the templates through the app's own module graph (a console
`import()` is a separate copy).

**Measured on the development Mac** (headless Chrome): 100 moving clones are 103 draw calls, 0.14 ms of
runtime and 0.19 ms of drawing a frame; a 4-second 1280x720 export takes 0.8 s. **NOT YET MEASURED ON AN
i5/i7 CHROMEBOOK.**
