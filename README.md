# 3DCoder

A single-user, browser-based 3D sandbox in the spirit of Second Life. Walk around an
open, gently rolling landscape with the arrow keys, drag your own glTF/OBJ models or
images onto the ground, freehand-draw a shape that inflates into a 3D balloon figure,
drop a glowing light orb, or place a live, interactive web browser. Everything you
place is saved locally in your browser (IndexedDB) and is still there next time you
open the page.

World units are feet: you (the camera) are 5ft tall, and every imported model is
automatically scaled to 5ft tall too.

The menu is collapsed to a small "☰ Menu" button by default — click it to expand.

## Controls

- `Arrow Up` / `Arrow Down` — walk forward / backward
- `Arrow Left` / `Arrow Right` — turn left / right
- Left-click + drag — look around
- Left-click an object — open its menu (Size / Move / Program)
- On touch devices, the on-screen D-pad in the bottom-right corner mirrors the arrow
  keys — press and hold to walk/turn, and it supports multiple fingers at once

## Importing content

Use the **Import** button (or drag files onto the window) to bring in:

- 3D models: `.gltf`, `.glb`, `.obj` (+ matching `.mtl` and textures), up to 200MB —
  automatically scaled to 5ft tall on import
- Images: `.png`, `.jpg`, `.gif` (animated GIFs play), up to 50MB

Free CC0 models, textures, and HDRIs: [polyhaven.com](https://polyhaven.com) — linked
directly in the in-app menu.

Use **Draw** to paint a shape — pick a color and brush size, paint in as many strokes
and colors as you like, then click Done to inflate it into a puffy 3D balloon textured
with your painting.

Use **Light Orb** to drop a glowing sphere of light in front of you — it hovers a few
feet off the ground and actually lights up nearby terrain, not just a glow effect.
Each click cycles through a different color; fine-tune it afterward from the object's
**Color** menu, or animate its color with a Program's "change color to" block.

Use **Web Browser** to place a real, live, clickable web page in front of you — it
opens on Wikipedia by default, and has its own address bar built into the top of the
panel for navigating anywhere. **Many sites (Google, YouTube, Facebook, X, most
banks/SaaS apps) block being shown in an embedded panel like this one — that's a
security setting on the site's own end, not something this app can work around.**
Wikipedia, MDN, most blogs, and sites built to allow embedding all work well. The
panel is a real web page: you can click links, scroll, type in forms, and it keeps
whatever page you last navigated to across a reload.

Since every click on the panel goes to the web page itself (following links,
clicking buttons — right-click included, for the page's own context menu), click the
blue **✎ edit icon** floating just above the panel to open its Size/Move/Program menu
instead.

## Editing a placed object

Left-click any placed object (model, image, gif, or balloon) to open its menu:

- **Size** — resize by a percentage of its current size, or reset it to exactly 5ft
  tall
- **Move** — nudge it backward and/or up, in feet, relative to where you're
  standing
- **Color** — light orbs only: pick a new glow color, which updates both the orb's
  visible glow and the light it casts
- **Program** — open a Scratch-style block editor to script the object's behavior

Changes are saved automatically to your browser (IndexedDB), so a resize, move, or
program survives a reload without any extra action.

## Programming an object

Click a placed object and choose **Program** to open a drag-and-drop block editor:

- **Control** blocks (yellow) — `repeat ... times`, `forever`, `wait ... seconds`
- **Motion** blocks (blue) — `move X/Y/Z by ... feet`, `rotate ... degrees`
- **Look** blocks (purple) — `change size by ... %`, `change color to ...`

Drag blocks from the palette on the left into the workspace to build a script;
`repeat`/`forever` are C-shaped and hold other blocks inside them. Drag a block onto
another to reorder it, drag it out of the workspace to delete it, or click its `×`.
Click **Save** to attach the script to the object and start running it immediately.

Once an object has a saved program, a green **▶ play icon** floats above it in the
world — click the icon any time to (re)start its script from the beginning, whether
or not it's already running.

Programs are saved as part of the object's record, so they persist across reloads and
travel with Save World / Load World just like everything else. **Clear World** stops
every running script along with removing the objects.

## Saving and loading a world file

Beyond the automatic browser save, **Save World** downloads the current world as a
`.json` file you can back up or share, and **Load World** loads a previously saved
file back in — this replaces everything currently placed. Model/image bytes are
embedded in the file (base64), so a loaded world doesn't depend on the original
imported files still being around; the boot-time starter assets (library/tree/
billboard) instead just reference their `public/` path, keeping save files small.

## Terrain

The ground is a gently rolling landscape rather than a flat plane — hills are smooth
and modest (a couple of feet of relief), and there's always a flat clearing around
your spawn point so the startup scene stays level. Walking, object placement, and
the ground-following camera all automatically follow the terrain's actual height.

## Startup content

On first load, a small library building, a maple tree, and an `NewEdusim.png`
billboard load automatically (from `public/library`, `public/tree`, and
`public/NewEdusim.png`), spaced about 20ft apart. They behave like any other placed
object — click one to resize, move, or program it.

## Development

```bash
npm install
npm run dev
```

```bash
npm run build
npm run preview
```

No backend or server is required — `npm run build` produces a static `dist/` folder.
