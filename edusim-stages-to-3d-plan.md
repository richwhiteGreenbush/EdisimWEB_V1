# Convert to 3D World: plan

A student starts a project in **Edusim Stages** (2D), and at any point presses **Convert to 3D World**.
The project opens in **Edusim** (the 3D app) as a world they can walk into: the stage stands in the
world, the sprites stand on it as cutouts or as real 3D models, the backdrop becomes the surroundings,
and the project still runs. Press the green flag in 3D and the game plays, the story tells itself, the
animation moves.

**Rules (the same as the Stages plan):**
- Work on a branch (`stages-3d`).
- No deploys without Rich's say-so.
- Finish each phase with a short summary and wait for approval.
- No accounts, no server storage, no student data.
- The main app's saved worlds must load and behave exactly as before.

---

## Status (2026-11-28): built, all phases, decisions A to E as recommended

Rich took every recommendation (run, not translate; board pictures stand up; life size; an Edusim-world
backdrop loads that world; play mode takes the arrow keys) and asked for every phase to be built,
pushed and deployed.

- **Phase 1-2**: `src/stages3d/StageObject.js` and the `stages-project` kind, both layouts at all three
  sizes, Model Database sprites as real models, the runtime hosted with keys, mouse, clicks, sounds,
  bubbles, captions, monitors, the pen and clones; play mode as a camera rig. Found by looking: My World's
  three signboards stood between the student and the stage, so a conversion into My World leaves them out
  and play mode hides anything in the way; a stage-sized sprite on a board (a maze's walls) has to lie
  flat rather than stand up.
- **Phase 3**: the dialog with its preview, the token handoff, the "replace your world?" question,
  Download a world file.
- **Phase 4**: HiFi draws it through the bridge with no change to HiFi beyond wiring.
- **Phase 5**: Edit in Stages and Back to 3D world, live over a BroadcastChannel, with a token fallback.
- **Phase 6**: the "Walk into Your Project" tutorial, the guide page, the home page, CLAUDE.md.
- **Checks**: `Stages/tools/check-stages3d.mjs` holds all 11 official projects to identical state in 2D
  and 3D for 150 frames (with keys held), every sprite drawn within a hundredth of a step of where it
  should be; `Stages/tools/check-roundtrip.mjs` passed the whole path on production builds.
- **Departures**: pixelate is not drawn in 3D, and the colour effect is a tint rather than a hue turn (no
  shader that crosses to HiFi). Sound is not positional yet. A downloaded world file stands the stage in a
  plain world (the full preset world is built by the 3D app, which Stages does not include).
- **Still open**: measuring on an i5/i7 Chromebook; positional sound.

---

## 1. How a project starts, and where the button is

A project starts the way any Stages project does: from a blank project, from a tutorial, or from
Projects. Nothing about starting changes. What changes is that the 3D app is always one step away:

- **File → Convert to 3D World…** in Stages, and a 🌍 button beside the green flag, so it is found
  without being looked for.
- The button is there from the first minute, deliberately. Converting a half-finished project is useful:
  a student can lay out a scene in 2D, where placing things is easy, then walk into it.
- **Converting does not change the Stages project.** It makes a copy in 3D. The 2D project stays where it
  was, autosaved, and can be converted again after more work.

The dialog asks three things and shows a picture of the result before anything happens:

| Question | Choices | Default |
|---|---|---|
| **How should the stage stand?** | **As a stage set**: upright, like a theatre or a pop-up book. **As a board on the ground**: lying flat, like a giant game board you walk round. | Set, unless the backdrop is plain, a grid or a maze |
| **How big?** | Small (a model on a table), Life size (characters about as tall as you), Huge | Life size |
| **Where?** | The matching Edusim world (when the backdrop came from one), My World (an empty field), or the backdrop itself as a wall | The matching world, when there is one |

Then: **Open in Edusim** (the 3D app opens with the world loaded), **Open in Edusim HiFi**, or
**Download as a world file** (for sharing, or for a computer offline).

---

## 2. The decision this plan turns on: translate the scripts, or run them

There are two ways to "render a project into a 3D world", and they give very different results.

**A. Translate.** Every sprite becomes an ordinary Edusim object with its scripts rewritten in the 3D
app's own blocks. The student can then carry on in Edusim's editor. But I checked the 3D app's block set
(`src/BlockDefs.js`, 2026-11-27), and most of what Stages projects rely on has **no equivalent there**:

| Stages relies on | In the 3D app's blocks |
|---|---|
| when a key is pressed, when this sprite is clicked | none (only `when I hear` and `when the sun…`) |
| touching, touching the edge | none |
| costumes, next costume | none (an image object has one picture) |
| play sound | none |
| go to x: y:, change x by, set y to | none: every move is relative to the object's facing |
| clones that are deleted | `duplicate` makes permanent copies |
| reporters inside slots, if / else, broadcast and wait | variables and `calc` only; no else |
| a loop body per frame | one block per frame, and `forever` at half rate |

Translated, every game in Projects would stop working: Catch the Coins needs keys, clones and touching;
Jump Up needs keys and touching; the Quiz needs ask and answer. Only animations made of moves and turns
would survive, and even those would run at different speeds.

**B. Run.** The whole project goes into the world as **one living object**, and the 3D app runs it with
**the Stages runtime itself**: the same code that runs it in 2D (`Stages/src/runtime/`). It is pure
JavaScript that already knows nothing about screens; it draws through a `host` it is handed. In 3D that
host draws sprites as objects in the world instead of on a flat canvas. Nothing is translated, so
nothing is lost: keys, touching, clones, costumes, sounds, ask, captions and the pen all work, at the
same speed, because they are the same program.

**Recommendation: B for Convert to 3D World**, so a converted project always works. Then, later and
optionally, A as a separate **Unpack into Edusim objects** that says plainly what came across and what
did not (section 8). B also matches the word "render": the project is drawn in 3D, not rewritten.

What B costs: in 3D the scripts are read and changed in Stages, not in the 3D app's editor. Clicking the
stage in 3D offers **Edit in Stages**, which opens the project there and brings the changes back
(phase 5).

---

## 3. What the student sees in 3D

### The stage

| Stages | As a stage set | As a board on the ground |
|---|---|---|
| The stage, 480 × 360 steps | An upright panel, its foot on the ground | A flat panel just above the ground |
| x | across the set | across the board |
| y | up the set | away from the start of the board |
| Layer order | a hair of depth per layer, front sprites nearest | a hair of height per layer |
| The backdrop | painted on the panel | painted on the board |
| The pen | drawn on the panel, over the backdrop | drawn on the board |

**Life size** is one step to a twentieth of a foot: the set is 24 ft wide and 18 ft tall, and a 100-step
character stands 5 ft tall, the same height as the student (the main app's `EYE_HEIGHT`). **Small** is a
quarter of that and **Huge** four times it.

### The sprites

- **A picture sprite is a cutout**: its current costume on a flat panel, standing upright. On a set it faces
  the audience, as a puppet would. On a board it turns to face the student wherever they stand, so it never
  goes edge-on (the main app's `Sprite` objects already billboard). Costumes, size, ghost, show and hide
  work as they do in 2D. Direction shows as a turn in the panel's own plane on a set, and as a left-right
  flip on a board, where a picture lying on its side would read as fallen over.
- **A sprite that came from the Model Database becomes the real 3D model again.** It already remembers
  which model it was (`library: 'model:human-heart'`), and its 12 costumes are 12 angles. In 3D,
  costume *n* turns the real model to angle *n*, so `next costume` spins a real heart. The 2D project that
  started as a turntable of photographs ends as the object it was photographed from, which is the whole
  point of the mashup.
- **Speech and thought bubbles** use the main app's own `SpeechBubbleManager`, which the 3D app already
  uses for `say`.
- **Captions** appear on a banner above the set, and on screen while the student watches.
- **Variable monitors** stand on a small board beside the stage.

### The surroundings

Stages backdrops remember where they came from (`costume.library`, persisted). So:

- **A backdrop from an Edusim world** (`world-moon`, `world-park`, `world-egypt`…) loads **that world**
  (`buildPresetWorldRecords`) and puts the stage in it, at a clear spot in front of the spawn found by
  the Model Database's own `findPlacementSpot()`. A Trip to the Moon converts into a stage set standing on
  the actual Moon.
- **A scene or plain backdrop** goes into My World, the empty field built for this, using a theme close
  to the scene (hills to `park`, space to `station`, underwater to `sea`, night to `constellations`).
- **A backdrop that switches during the project** (a story's scenes) changes the painting on the set.
  It does not reload the world around it, which would throw the student out of where they are standing.

---

## 4. Playing it in 3D

The arrow keys walk the student in the 3D app, and most games use the arrow keys. So a converted project
has a **play mode**, the way the 3D app's camera rigs work (`Cinema.js`):

- Press the project's green ▶ (the 3D app's own play icon) and the camera moves to face the stage.
- From then on, keys, clicks and the mouse go to the project. The pointer is cast onto the stage's panel,
  which gives the project its mouse x and y.
- **Esc**, or the on-screen **Stop playing** chip, gives the keys back for walking. The chip copies
  `.cinema-chip`, because a tablet has no Esc key.
- With the project not in play mode it keeps running (an animation keeps animating as the student walks
  round it), but it hears no keys.

---

## 5. How the project gets from Stages to the 3D app

`/stages/` and `/app/` are on one origin, so they can hand a project across directly, but **the link
carries a token, never a project or an address**. That is the `?world=` rule from CLAUDE.md:

1. Stages writes the converted world into its own IndexedDB (`edusim-stages`) under a fresh random
   token, with a time stamp.
2. It opens `/app/?from-stages=<token>`.
3. The 3D app checks the token's shape, reads the world, deletes it from storage, and strips the
   parameter from the address bar (`takeLinkedWorldId`'s reason: a refresh must not replay it).
4. If the student's 3D world has unsaved changes it asks first (`WorldStore.hasChanges`), then
   `loadFromRecords`. A failed read leaves the existing world alone.
5. Tokens older than an hour are cleared on the next visit, so nothing piles up.

**Download as a world file** writes the same records through the 3D app's own `exportWorldToFile`
format, so it opens with **Load World File** in Edusim or HiFi, offline, or on another computer.

---

## 6. What has to change in the 3D app

Unlike Stages v1, this **does** change the main app. It is one new record kind, which CLAUDE.md
already describes as add-only work with a known checklist:

- **A new record kind, `stages-project`**:
  `{ kind, transform, layout: 'set' | 'board', scale, files: [project file] }`.
  The project travels in `files` so `WorldFile` base64s it with no new code. It is rebuilt from the file
  on every load, the `preset-prop` philosophy.
- **The checklist CLAUDE.md gives for a new kind**: `WorldStore.rehydrateOne()`, `objectLabel`,
  `ewd_known_kinds` in BOTH galleries, `stats.php`'s vocabulary (`tools/build-stats-vocab.mjs`), and the
  object menu (Size, Move and Program work on it as a whole; Program offers **Edit in Stages** instead).
- **`src/stages3d/`**, the 3D host for the Stages runtime: a `host` like Stages' own (clock, masks,
  audio, pen), plus drawing every sprite each frame.
- **HiFi has to be able to draw it.** HiFi runs the main app's code and mirrors the scene into
  Babylon (`ThreeBridge`), so the 3D drawing must use only what crosses: planes with standard or basic
  materials, textures with a `version`, and sprites. **No `ShaderMaterial`**, so Stages' four shader
  effects become material settings in 3D: ghost is opacity, brightness is the material colour
  (darkening only), colour is a hue tint, and pixelate is dropped in 3D. The conversion report says so.
- **The Stages runtime is imported from `Stages/src/runtime/`** by the main app (lazily, only when a
  world holds a `stages-project`). That makes the runtime shared code: its check tools have to pass for
  both apps, and CLAUDE.md gains a line saying so.

**Nothing changes for any existing world.** No block, no record kind, no theme and no saved field is
renamed or removed.

---

## 7. Phases

### Phase 1: The 3D stage, standing still
`stages-project` loads, saves, exports and rehydrates. It draws the stage, the backdrop, the pen and every
sprite in its starting pose, in both layouts and at all three sizes. Model sprites come back as models.
No scripts run yet.
**Check:** a tool converts every project in Projects into a world, loads each into the 3D app, and compares
every sprite's 3D position with its 2D position through the mapping in section 3. A round trip through a
world file changes nothing.

### Phase 2: Running in 3D
The Stages runtime runs inside the world: costumes, motion, effects, bubbles, captions, sounds, the pen,
clones and monitors. Play mode and Stop playing are added.
**Check:** `check-templates` runs every project in 3D as well as 2D, on the same virtual clock, and holds
the two runs to the same sprite positions frame by frame. They are the same runtime, so any difference is
a mapping bug.

### Phase 3: Convert to 3D World in Stages
The dialog, the preview picture, the layout, size and surroundings choices, the token handoff, the
"replace your world?" question in the 3D app, and Download as a world file.
**Check:** the whole student path through the real DOM in both apps, including a dead token, a refresh
after arriving, and a project too big for the browser's storage.

### Phase 4: HiFi
The same world opens in HiFi through the bridge. Each project is looked at there, not only counted.

### Phase 5: Edit in Stages, and back
Clicking the stage in 3D offers **Edit in Stages**. Stages opens the project (by the same kind of token),
and **Back to 3D** updates that one record in the world, leaving everything else in the world alone.

### Phase 6: Launch (only on Rich's say-so)
The Stages guide, one new tutorial ("Walk into your project"), the marketing page's `#stages` cards,
CLAUDE.md, and the Chromebook measurement.

### Later: Unpack into Edusim objects (approach A)
For students who want to carry on in the 3D app's own blocks. It translates what translates and lists
what did not, by sprite and by block. To translate games faithfully it would need new blocks in the 3D app
(key and click hats, touching, costumes on image objects, play sound, a sideways move, go to). That is a
large, separate piece of work on the main app's block set and text coding, so it is not proposed here.

---

## 8. Decisions for Rich

**A. Run, rather than translate (recommended).** A converted project always works, and its scripts are
edited in Stages. Translation comes later, if at all, as Unpack into Edusim objects.

**B. Picture sprites on a board stand up and face you (recommended).** The alternative lays them flat
like game pieces, which reads well from above and badly from a 5 ft eye.

**C. The default size is life size (recommended):** characters about the student's height, the set 24 ft
wide.

**D. A backdrop from an Edusim world loads that whole world (recommended).** The alternative is always My
World with the picture as a wall, which is simpler and much less of a payoff.

**E. Play mode takes the arrow keys (recommended).** Walking and playing need the same keys, and the
alternative of moving the game to WASD breaks every Stages project and tutorial.

---

## 9. Risks and things to check

- **This is the first Stages work that changes the main app.** The new kind's checklist is long, and
  forgetting an item fails silently: CLAUDE.md's own example is a part with no shape coming back as a 2 ft
  yellow cube. Phase 1's round-trip check is there for exactly that.
- **World files get bigger.** A world carrying a project carries its pictures and sounds; the largest
  official project is about 1 MB. That is fine for a file, but a gallery upload limit may need checking.
- **Performance in 3D.** Every mesh is drawn twice (the sun's shadow map), so 100 clones are about 200 draw
  calls. Cutouts will cast no shadow by default. Measure on an i5/i7 Chromebook, as always.
- **Sound in 3D** uses Stages' own engine; positional sound (louder when nearer) is a later nicety.
- **The arrow-key handover** has to survive the VR view, touch screens and a tablet with no Esc, which is
  why play mode copies the camera rigs' rules rather than inventing new ones.

## 10. Size, estimated

Phase 1 about 900 lines, phase 2 about 700, phase 3 about 500, phase 4 depends on what HiFi shows, phase 5
about 400, plus the checks. The runtime itself, which is the hard part, already exists and is already
checked.
