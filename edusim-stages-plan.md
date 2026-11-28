# Edusim Stages: plan

A third Edusim app, beside the main app and HiFi, for making **games, stories and animations** with
blocks, in a layout anyone who has used Scratch will recognise. It lives in this repo as `Stages/` and
is served at **`https://edusim3dweb.com/stages/`**. It starts **2D**: a flat stage, sprites and
backdrops. It is built so that 3D can be added later without rebuilding it.

**Rules:**
- Work on a branch (`stage`).
- No deploys to the live sites without Rich's say-so.
- Finish each phase with a short summary and wait for approval.
- No accounts, no server storage of student work, no student data.
- The main app and HiFi must behave exactly as before. Anything shared that changes is checked with
  their existing tools (see section 6).

---

## Status (2026-11-27): built, all six phases

Rich named it **Edusim Stages** (so `Stages/` and `/stages/`), chose 2D first, decided A to G (section 5),
and asked for every phase to be built, pushed and deployed. What exists now, and where the build
departed from this plan:

- **Built**: the Scratch-style layout; the stage (three.js, orthographic) with sprites, backdrops, the pen
  and monitors; 105 blocks in nine categories with real reporter slots; Scratch timing at 30 frames a
  second; picture-accurate touching; clones (100); the paint editor, the sound effects editor; the
  libraries (103 cartoon sprites from Kenney's CC0 packs, every Model Database model as a 12-costume
  sprite, 20 Edusim world backdrops plus composed and plain ones, 40 generated sounds); autosave and
  project files; video export with sound; the Text view; 11 official projects (Projects, linkable as
  `/stages/?project=<id>`); 7 tutorials; offline (a service worker written by the build); the marketing
  page's `#stages` section, the guide page, the deploy target and the smoke test.
- **Departure 1: Stages has its own block table, runner and editor**, instead of adding block types to
  the main app's `BLOCK_DEFS` and refactoring its `ProgramEditor`. Scripts floating freely and reporters
  nesting in slots needed a different editor anyway, and keeping them apart is what guarantees the main
  app and HiFi did not change (nothing under `src/` was edited for Stages). The types use Scratch 3's
  opcode names, which keeps a later import of Scratch sprites a lookup.
- **Departure 2: text coding is one Text view, not Basic Beginner and Basic Pro.** Every block has a
  text form generated from the block table itself (Scratch's words, Python's indentation and colons,
  reporters in brackets), and text compiles back to blocks, held to a round trip of every block by
  `Stages/tools/check-text.mjs`. It covers all 105 blocks with nothing to maintain; the two levels stay
  in the main app.
- **Departure 3: the official-projects gallery is built into the app**, not a server gallery like
  `/hifiworlds/`. Every project is written in code from the block table and the library, so it needs no
  server and `Stages/tools/check-templates.mjs` can run each one and check it does what its card says.
  Students share their own work as files, as decision G says.
- **Answered from section 7**: `Mp4Muxer` takes the audio after the video (the Studio's exporter already
  does, and a Stages export decodes with its sound in Chrome and in avconvert); every Kenney pack's own
  licence file was read, says CC0, and ships beside its pictures.
- **Still open**: measuring on an i5/i7 Chromebook (on the development Mac 100 moving clones cost 103 draw
  calls and about 0.3 ms a frame); Scratch's exact timing rules and the 300-clone figure are from memory,
  not a source; WebCodecs on ChromeOS; importing Scratch projects; everything in section 9.

---

## 1. The name

**Edusim Stages** (Rich's choice, from the suggested "Edusim Stage"). The reasons for the name held:

- **It is the address.** `/stage/` sits next to `/app/`, `/hifi/` and `/worlds/`, and the name says
  what you get there.
- **Teachers already know the word.** Scratch calls its playing area "the stage", so a teacher who has
  taught Scratch knows where the game runs before anyone explains it.
- **It covers all three jobs.** Games are played on a stage, stories are performed on one, and
  animations are staged.
- **It still fits once 3D arrives.** A diorama, a theatre set and a game board are all stages, so the
  name does not need changing when the stage gains depth (section 9).
- **It is not "Scratch".** The name and the cat belong to the Scratch Foundation. Nothing in this app
  uses either.

Other names, if Rich prefers one: **Edusim Playhouse** (warmer, younger), **Edusim Showtime** (more
playful), **Edusim Storyboard** (best for stories, but undersells games).

A project is called a **project**, as in Scratch, rather than inventing a word a teacher has to learn.

---

## 2. The idea

### What it is for

Scratch's design is often summed up as "low floor, wide walls, high ceiling": it is easy to start, it
can make many kinds of things, and there is room to grow. Edusim already has the high ceiling: blocks
that compile from Python-style text (Basic Beginner and Basic Pro), maths blocks, messages between
objects and a video exporter. What it lacks is the low floor *for games*. The world is open, so you
cannot see the whole playing field. There is no x and y a child can read. Nothing collides, and
nothing listens for a key.

Edusim Stage is that floor. It is a fixed stage where everything is visible at once, with numbers a
9-year-old can reason about. It uses the same block language as Edusim, so what a student learns here
carries over to the 3D worlds, and the other way round.

### What it borrows from each

| From Scratch (ideas only, no code or art) | From Edusim (its own code) |
|---|---|
| Stage, sprite list, backdrops, costumes, sounds tabs | The block schema, runner and editor (`BlockDefs`, `ProgramRunner`, `ProgramEditor`) |
| Green flag and stop | The maths blocks, variables and `share` |
| Events: flag, key pressed, sprite clicked, messages | Messages between objects: `say` / `whenSaid` / `tell` / `broadcast` |
| Sensing: touching, distance, mouse, ask and answer, timer | Speech bubbles (`SpeechBubble.js`) |
| Clones, a pen, stage monitors | The paint canvas (`DrawTool.js`) |
| x from -240 to 240 and y from -180 to 180 | Generated sound with nothing to license (`StudioAudio.js`) |
| | MP4 export (`Mp4Muxer.js`, the Studio's virtual clock) |
| | Text coding (`src/textcode/`) |
| | 269 models in the Model Database, rendered as 2D costumes (section 4) |

### What makes it more than a copy of Scratch

1. **Every animation exports as a real video.** Scratch cannot do this well, and the Studio already
   can. For the stories and animations half of the audience this is probably the main reason to use it.
2. **The sprite library is Edusim's own models.** Each Model Database model becomes a set of 2D
   costumes, one picture per angle of its turntable, so a sprite can turn round with `next costume`.
3. **It grows into Python-style code.** Basic Beginner and Basic Pro already compile to blocks.
4. **It grows into 3D** (section 9). The stage gains depth, a sprite can be a 3D model, and later a
   student can step inside their own game.

### Who it is for

Ages 8 to 13 first, which is Scratch's core audience, with nothing to stop a high-school class using
it. That age range sets the layout (big targets, plain words) and the order of the templates.

---

## 3. What I checked in the code (2026-11-27)

These facts shape the design:

- **The runner moves objects in 3D, the Edusim way.** `moveForward` moves along the object's +Z
  (`forwardOf()`), `rotate` turns about Y, and `moveUp` changes Y (`ProgramRunner.js` around line 226).
  A 2D stage needs Scratch's meaning: move along a heading in the x-y plane, and turn about the screen.
  **So the 2D motion blocks are new block types.** The Edusim ones are not repurposed, since their
  meaning is persisted in every saved world.
- **Every action takes a frame.** Each motion or look block yields one tick, `forever` costs an extra
  tick per pass (CLAUDE.md's documented half rate), and maths blocks take none (`runPass`, `SPIN_LIMIT`
  2000). In Scratch a whole loop body runs inside one frame and the loop yields at the end of each pass.
  So `forever { change x by 5; if touching edge … }` must run once per frame, whatever the number of
  blocks in it. **Stage needs its own timing mode** (decision A).
- **There are no sensing or input blocks.** Nothing in `src/` defines touching, key pressed or a
  position reporter (CLAUDE.md says so for the Hall of Light, too).
- **There are no reporter blocks.** A number field can hold a number or a variable's name (`variable:
  true`), but not a block. Scratch's round and pointed reporter slots do not exist yet (decision B).
- **There is no if/else.** Text coding gives `else` an error card (E150) because blocks cannot say it.
- **The palette is one list.** `PALETTE_ORDER` in `BlockDefs.js` is the only one, and `ProgramEditor`
  reads it directly (line 237). Stage needs its own list, and the editor has to accept it as a
  parameter. The main app's palette must not change.
- **`ProgramEditor` is a modal** (1,206 lines) that opens over the world. Stage needs it docked in the
  middle of the layout, so it has to be refactored into a part that can be mounted either way.
- **HiFi shows how a sibling app is wired.** `HiFi/vite.config.js` pins `three` to the root
  `node_modules`, allows `fs` to serve `../`, and sets `base: './'`. Stage copies all three.
- **`deploy.sh`'s site rsync runs with `--delete`** and excludes `worlds/`, `app/`, `hifi/` and
  `hifiworlds/`. **`stage/` has to join that list**, or `./deploy.sh site` deletes the app.
- **The website feedback popup refuses to run only under `/app/`, `/hifi/`, `/worlds/` and
  `/hifiworlds/`**, or on a page with a `#scene` canvas (`docs/assets/edusim-feedback.js`, line 62).
  **`/stage/` has to be added**, or the popup asks children for feedback inside the app. That would
  break the promise in `privacy.html`.
- **`tools/lib/run-blocks.mjs` already runs a program with the clock taken out.** Stage's check tools
  build on it.

---

## 4. The design

### The layout

The layout is fitted to a 1366 × 768 Chromebook screen, the target machine.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Edusim Stage   File ▾  Edit ▾  Tutorials   [project name]    ▶ flag  ■    │
├────────────┬───────────────────────────────┬──────────────────────────────┤
│ Code │Costumes│Sounds                     │                              │
│  ● Motion  │                               │          STAGE               │
│  ● Looks   │      script area for the      │        480 × 360             │
│  ● Sound   │      selected sprite          │                              │
│  ● Events  │                               ├──────────────────────────────┤
│  ● Control │                               │ Sprite: Robot  x 0  y 0  ⟳ 90│
│  ● Sensing │                               │ [sprite] [sprite] [+]  │ Stage│
│  ● Maths   │                               │                        │ [bg] │
│  ● Pen     │                               │                        │  [+] │
└────────────┴───────────────────────────────┴──────────────────────────────┘
```

- The stage is drawn at 480 × 360 CSS pixels by default, with buttons for a small stage, a big stage
  and full screen.
- The **category list** down the left of the palette jumps to that section, as Scratch's does. Colours
  come from `CATEGORIES`, with new categories added for Events, Sensing, Sound and Pen.
- The **sprite info row** shows name, x, y, size, direction and show/hide, and every field can be
  edited.
- **Touch works throughout.** Chromebooks have touch screens, and the editor already uses Pointer
  Events.

### Coordinates and units: Scratch's, on purpose

- The stage runs from **x -240 to 240 and y -180 to 180**, in **steps**. One three.js unit is one step.
- Direction 90 points right and 0 points up, as in Scratch.
- These numbers are deliberately Scratch's and not Edusim's feet. Every Scratch worksheet, tutorial and
  teacher habit then works here unchanged. That is worth more than matching the 3D app's units.
- Edusim's "everything is feet" rule belongs to the 3D worlds. Stage writes down its own unit, and the
  plan for 3D (section 9) keeps steps.

### Rendering: three.js, orthographic, on a vertical plane

- **An `OrthographicCamera` looking down -Z at a stage in the x-y plane.** x runs right, y up, and z is
  the layer order. It is a theatre backdrop rather than a floor, because stories, animations and
  platform games are all seen from the side, as Scratch's are.
- **Each sprite is one textured plane** (`MeshBasicMaterial`, unlit, transparent), with order set by
  `renderOrder` and depth testing off. That is one draw call per visible sprite: a few dozen in a normal
  project and up to the clone limit in a busy one, well inside the envelope.
- **Why three.js and not a 2D canvas:**
  - It is already in the bundle.
  - Speech bubbles and the export path already work with it.
  - Section 9's 3D is then a change of camera rather than a new renderer.
- **Clones share their costume textures**, counted per texture. Edusim's "a fresh material per prop"
  rule exists because `PlacedRegistry.disposeObject3D()` destroys whatever it is handed. Stage does not
  use `PlacedRegistry` and owns its own disposal, so sharing is safe here and matters once there are clones.
  The difference is written down so that nobody "fixes" it.
- **The pen is a canvas texture on a plane behind every sprite**, Scratch's pen layer. Lines are drawn
  into that canvas and `stamp` draws the costume into it. It is re-uploaded once a frame, and only when
  something was drawn. Edusim's 3D marker tube is the wrong tool on a flat stage.

### The block language

**Stage adds block types to the shared `BLOCK_DEFS`, add-only**, with a flag saying which app shows
each one. Edusim's palette is unchanged and Stage's leaves out the 3D-only blocks. One schema and one
runner means a block means the same thing everywhere, and text coding can cover both apps later.

| Category | Phase 2 blocks (Scratch's meanings) |
|---|---|
| **Events** | when flag clicked · when [key] pressed · when this sprite clicked · when backdrop switches to · when I receive (Edusim's `whenSaid`) · broadcast (silent, no bubble) · broadcast and wait |
| **Motion** | move (n) steps · turn ↻ / ↺ (n) degrees · go to x: y: · go to [random / mouse / sprite] · glide (s) secs to x: y: · point in direction · point towards · change x by · set x to · change y by · set y to · if on edge, bounce · set rotation style · *reporters:* x position, y position, direction |
| **Looks** | switch costume to · next costume · switch backdrop to · next backdrop · say / think (for secs) · show · hide · change / set size · change / set [colour, ghost, brightness] effect · clear effects · go to front / back layer · go forward / back (n) layers · *reporters:* costume number, backdrop name, size |
| **Sound** | play sound until done · start sound · stop all sounds · play note (n) for (b) beats · change / set volume |
| **Control** | wait · repeat · forever · if · **if / else** · wait until · repeat until · stop [all / this script / other scripts] · create clone of · when I start as a clone · delete this clone |
| **Sensing** | touching [sprite / edge / mouse]? · distance to · key [k] pressed? · mouse down? · ask and wait · *reporters:* answer, mouse x, mouse y, timer · reset timer (no `loudness`: there is no microphone, decision E) |
| **Maths** | Edusim's existing blocks, plus a monitor checkbox beside each variable that shows it on the stage |
| **Pen** | erase all · stamp · pen down / up · set / change pen colour · set / change pen size |

`if / else` is added to the shared runner and is not Stage-only. Text coding's E150 card for `else`
can then be retired in a later phase.

### Collision: boxes first, then pixels

`touching` has to feel right, or every game is unfair.

- Test the two sprites' rotated bounding boxes first, which is cheap.
- If the boxes overlap, compare the two costumes' **alpha masks** over the overlap.
  - Each mask is built once per costume, at about one cell per two steps.
  - The sample points are transformed by each sprite's position, direction and size.
- This is what makes a round ball touching a round coin behave like circles rather than squares.
- `touching edge` is a box against the stage bounds.
- `touching colour` is left out of Phase 2. It needs a readback of the rendered frame, which is slow
  on integrated graphics.

### Saving: its own database, its own file

- **IndexedDB, named `edusim-stage`.** It is never `DB_NAME`'s `'3dcoder-world'`, so Stage can never
  touch a student's Edusim world.
- The project autosaves, the way `WorldStore` does.
- **A project file is `<name>.edusim-stage.json`:**

  ```
  { format: 'edusim-stage', version: 1,
    stage:     { backdrops: [...], current, programs, variables },
    sprites:   [ { id, name, costumes: [assetId…], sounds: [assetId…], x, y, direction, size,
                   visible, layer, rotationStyle, effects, program, programText?, programLevel? } ],
    assets:    [ { id, name, type, sha256, data: <base64> } ],
    monitors:  [...] }
  ```

  Assets are stored once, deduplicated by hash, so ten clones of a costume cost one image.
- **Every field and block type is persisted, so the format is add-only from version 1.** CLAUDE.md's
  rule ("a constant that ends up inside a saved record is not a constant") applies from the first
  saved project.
- File > Save to your computer and File > Load from your computer both exist from day one. Scratch
  learned that a student needs both halves.

### Sprites and costumes: where pictures come from

1. **Paint.** `DrawTool`'s canvas becomes the costume editor, adding an eraser, fill, a rectangle and
   an ellipse.
2. **Upload** a PNG, JPEG, GIF or SVG. SVG is drawn to a canvas.
3. **The library, made from Edusim's own models.** `tools/model-pictures.mjs` already renders 12-angle
   turntables. A variant writes each model side-on with a transparent background as a costume set,
   so a horse, a rocket or the Space Needle arrive as sprites with 12 turning costumes.
   - Excluded, by the existing rule: no real people's likenesses and nothing sacred.
   - That rule is applied to the 269 cards before the set is generated.
4. **Free cartoon characters and backdrops**, released as CC0 (decision D), for a drawn look
   alongside the rendered one.

### Sound

- **Generated sounds**, built on `StudioAudio`'s synthesiser: pops, jumps, coins, lasers, boings, drum
  loops and the four music styles as loops. Nothing is a recording, so there is nothing to license.
- **Upload** WAV, MP3 or OGG.
- **No recording.** There is no microphone access anywhere in the app (decision E).

### Export to video

- Stage's loop is `frame(dt)`, like the main app's, so the Studio's method carries over:
  1. Stop the loop.
  2. Pin `performance.now()` to a virtual clock.
  3. Step 1/60 s at a time.
  4. Encode every second frame at 30 fps with WebCodecs into `Mp4Muxer`.
- **Audio runs in the opposite order to the Studio.** The Studio plans its soundtrack before the first
  frame. A student's sounds start whenever their program says. So export logs every sound start
  (time, sound, volume) during the run, renders the mix afterwards with an `OfflineAudioContext`, and
  then writes the audio track.
  - Whether `Mp4Muxer` accepts audio added after the video samples has not been checked (section 7).
  - If not, the run is done twice: the first pass to log the sounds, the second to encode.
- The options are 16:9, 4:3 at stage size, or 9:16 with the stage letterboxed.
- The pictures are encoded the way the Studio does it, so the files play on phones, in Photos and in
  Google Slides.

---

## 5. Decisions (made by Rich, 2026-11-27)

**A. Timing: Scratch's, for Stage only.**
- Stage programs run a whole loop body each frame. Motion and looks blocks take no frame, and loops,
  `wait`, `glide`, `say for secs` and `broadcast and wait` hand the frame back.
- This is a runner option (`timing: 'stage'`), chosen per app.
- Edusim's per-block timing stays exactly as it is, since saved worlds depend on it.
- *Why:* every Scratch game, tutorial and instinct assumes this timing, and with Edusim's a loop slows
  down as blocks are added to it.

**B. Reporter blocks: yes, real round and pointed slots, from version 1.**
- A param can hold a block (`{ block: {...} }`) as well as a number or a variable name.
  - Round reporters are numbers (`x position`, `answer`).
  - Pointed reporters are true/false (`touching edge?`, `key space pressed?`, `<` `=` `>` `and` `or`
    `not`).
- *Why now:* this is the single most Scratch-like part of the interface and it changes the saved
  format. Adding it after projects exist would mean every saved project has two formats forever.
- *Cost:* the largest editor change in the plan. Nested reporters are Stage-only, so the main app's
  editor never has to show them.

**C. Words: Scratch's.** Sprite, costume, backdrop, stage, broadcast, clone, green flag. A teacher who
knows Scratch knows them all already. The interface, the tutorials and the guide page all use them.

**D. The library: Edusim's models plus free cartoon characters.**
- **Rendered models:** every Model Database model that passes the existing exclusions, as a 12-costume
  turning set. These are Edusim's own and nobody else has them.
- **Cartoon characters and backdrops:** a set released as **CC0** (public domain), so nothing carries
  an attribution or licence obligation, the same footing as the ambientCG textures.
  - Every pack's own licence file is read and kept with the source, rather than trusting a site's
    summary.
  - Nothing that looks like a character from an existing game, film or show, whatever its licence says.
  - A small set of original Edusim characters can be drawn later to sit beside them.

**E. No microphone.**
- There is no record button and no `loudness` sensing block, and the app never asks for microphone
  permission. That keeps `privacy.html`'s promise that the app asks a child for nothing, with no new
  sentence needed.
- Sounds come from the generated library or from an uploaded file.
- One thing to know: an uploaded file could still be a recording made elsewhere. That matters only once
  a gallery exists, and decision G keeps the gallery to official projects.

**F. Clone limit: 100.** A third of Scratch's limit, chosen for the target Chromebook.
- `create clone` past 100 does nothing, and shows one message per run that says why.
- The limit counts clones across the whole project, as Scratch's does, not per sprite.
- Every template is built to stay under it: Catch! and Space Dodge recycle their clones (`delete this
  clone` when they leave the stage) rather than relying on the limit.

**G. Sharing: files only until Phase 5, then an official-projects gallery.** This matches the World
Database rule: student uploads do not appear in the app until there is an approval step.

---

## 6. Phases

### Phase 0: The skeleton (about a day)

- `Stage/` with `package.json` (vite only), `index.html`, `vite.config.js` (HiFi's `three` alias,
  `fs.allow` on `../`, `base: './'`, port **5193**) and `src/main.js`.
- An empty layout: three panes, the stage drawing one backdrop, and the flag and stop buttons doing
  nothing yet.
- Prepared but **not run**:
  - `deploy.sh stage`, and `stage/` added to the site rsync's exclude list.
  - `serve-local.sh` mounting `/stage/`.
  - `/stage/` added to the feedback popup's refusal pattern.
- **Check:** `npm run build` in `Stage/` writes `Stage/dist/`, which loads from both a subdirectory and
  an origin root, as the main app does on ports 8080 and 8081.

### Phase 1: The stage, sprites and saving (no code blocks yet)

- The orthographic renderer, a sprite manager (add, remove, select, layers, rotation style), and
  dragging sprites on the stage.
- The sprite info row, with every field editable.
- Costumes: paint (from `DrawTool`), upload, and the first 40 library sprites rendered from models.
  Backdrops the same way.
- Save to IndexedDB, Save to computer, Load from computer, and New project.
- **Checks:**
  - `tools/check-stage-project.mjs` round-trips a project through a file and through IndexedDB, and
    compares the result field by field.
  - A load that fails leaves the open project untouched, the `loadFromRecords` rule.

### Phase 2: The language

- Refactor `ProgramEditor` into a part that can be mounted docked or as a modal, and takes a palette
  list. **The main app's editor must look and behave exactly as it does today.**
- The Stage timing mode (A), reporter slots (B), and every block in section 4's table except Sound.
- Collision with boxes then masks, keyboard and mouse input, clones, the pen layer, and stage monitors.
- **Checks:**
  - `tools/check-stage-blocks.mjs` runs programs headless through the real runner (using
    `run-blocks.mjs`) and compares positions and variables with expected values, including
    `touching` between rotated, scaled sprites.
  - `tools/check-blocks.mjs`, `tools/check-textcode.mjs` and `tools/check-textcode-app.mjs` still pass,
    unchanged, for the main app.
  - `tools/check-models-app.mjs` still passes in both editions.

### Phase 3: Sound, stories and video

- The sound library (generated), upload, and the Sound blocks. No recording (decision E).
- `think`, `ask and wait`, narrator captions (a Looks block, drawn as the Studio's caption cards), and
  `broadcast and wait` for story timing.
- Export to MP4.
- **Checks:**
  - An exported file opens in QuickTime and has the right duration, as the Studio's `avconvert` check
    does.
  - Exporting the same project twice gives the same frames.

### Phase 4: Templates and tutorials

These are original games and stories in common genres, not copies of existing games:

| Template | Teaches |
|---|---|
| **Catch!** (things fall, you catch them) | events, x position, clones (recycled), score |
| **Maze Runner** | arrow keys, touching, a timer |
| **Paddle Ball** | bounce, two-player keys, broadcast |
| **Jump Up** (a platformer) | gravity as a variable, y velocity, touching ground |
| **Space Dodge** | clones (recycled), random, lives, game over |
| **Quiz Show** | ask and answer, if / else, score |
| **Talking Animals** (a story) | say, broadcast and wait, backdrops as scenes |
| **Flip-book Animation** | costumes, wait, export to video |

- Each template has a step-by-step tutorial card in the app.
- There is also a generated guide page, `docs/guide/stage.html`, made by a `tools/build-stage-page.mjs`
  in the same style as the village and city pages.
- **Check:** a tool runs every template's programs and asserts what its tutorial says will happen.

### Phase 5: Sharing, offline and text coding

- **Offline as an installable app.**
  - A web app manifest and a service worker scoped to `/stage/`.
  - The service worker is versioned per build, so a deploy can never leave students on a stale copy.
  - `docs/.htaccess` already sends `no-cache` for html.
- **Basic Beginner and Basic Pro for Stage blocks.** New entries in `textcode/commands.js`, held by the
  existing round-trip checks.
- **An official-projects gallery** (G), set up the way HiFi's gallery is: its own directory,
  `?project=<id>` links that carry an id and never a URL, and same-origin fetches.

### Phase 6: Launch (only on Rich's say-so)

- `./deploy.sh stage` runs a dry run first, then the real deploy.
- The marketing page gets a `#stage` band and a nav link, and `#resources` gets an entry.
- CLAUDE.md gets its own section, the notes vault gets an Editions note and an entry in
  Decisions by Rich, and `smoke-test.sh` covers `/stage/`.
- **Measure on an i5/i7 Chromebook** before launch: the busiest template plus 100 clones, recording
  frame time and draw calls, the way every world's numbers are recorded.

### Later: the stage gains depth (section 9)

---

## 7. Facts to check before anything ships

- **The licences of Scratch's own repositories.** The plan uses no Scratch code, but if any is borrowed
  later, check each one's current licence first. I believe some were relicensed recently and I have
  not checked which.
- **The Scratch Foundation's trademark guidance**, so that "for anyone who knows Scratch" in marketing
  copy is acceptable wording.
- **Scratch's exact timing rules** (loops yield once per pass unless run without screen refresh), so the
  "works like Scratch" claim is honest. Stage's clone limit is deliberately lower than Scratch's, and the
  guide page says so.
- **The licence file of every cartoon pack** used in the library (decision D).
- **Whether `Mp4Muxer` accepts audio after the video**, or needs both tracks interleaved as they go.
- **WebCodecs H.264 encoding on ChromeOS** on the target hardware.
- **That every rendered library sprite reads at 60 to 100 px tall.** Many models are tuned for 3D
  close-up, so this is a look-at-it check rather than a count.

---

## 8. Size and cost, estimated

These are estimates, not measurements:

| Phase | New code | Shared code touched |
|---|---|---|
| 0 Skeleton | ~300 lines | `deploy.sh`, `serve-local.sh`, `edusim-feedback.js` (one line each) |
| 1 Stage and saving | ~2,500 | `DrawTool` (exported for reuse) |
| 2 Language | ~4,000 | `BlockDefs`, `ProgramRunner`, `ProgramEditor` (the refactor) |
| 3 Sound and video | ~2,000 | `StudioAudio`, `Mp4Muxer` (reused, maybe extended) |
| 4 Templates | ~1,500 plus content | none |
| 5 Sharing and text | ~2,000 | `textcode/commands.js`, gallery PHP (copied) |

Phase 2 is the risky one because it is the only phase that edits code the main app runs. That is why
its checks are the main app's own tools.

**Runtime, expected:**
- A normal project is 10 to 50 draw calls, and a 100-clone stress test about 120.
- Triangles are negligible.
- Memory is mostly costume textures: a 256 px costume is about 256 KB decoded, so a 40-sprite
  project with 4 costumes each is about 40 MB.
- Texture memory is the first thing to watch on a shared-memory Chromebook, as it is in the Model
  Database.

---

## 9. Later: from 2D to 3D

This is not in scope now. It is written down so that Phases 0 to 5 do not close it off.

- **Depth.** The stage plane already lives in 3D space and z is the layer order. A project setting
  unlocks `z`, and a *Tabletop* camera tilts the view. Coordinates stay in steps.
- **3D sprites.** A sprite's costume can be a Model Database model instead of a picture. Its record is
  then `{ model: 'human-heart' }`, which costs bytes rather than an image, as in Edusim.
- **Step Inside.** A play mode puts the camera in the stage in first person, using
  `PlayerController`, so a student walks round their own game, and later goes into VR through
  `VRView`.
- **To Edusim and back.** A Stage project could be hung in an Edusim world as a panel, and a world
  could open a Stage project.
- **Importing Scratch projects.** Scratch 3's project format is open JSON. Importing a project's
  sprites and backdrops (not its code) would be a strong on-ramp for classes that already use Scratch.

Two things in this plan exist to keep these doors open: the stage is a plane in a 3D scene (section
4), and blocks share one schema with Edusim (section 4).
