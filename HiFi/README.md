# Edusim HiFi

A high-fidelity edition of Edusim, rendered with **Babylon.js** for current machines with
discrete GPUs. Everything the main app does is here — all 43 worlds, block and JavaScript
programming, Create Model, Draw, browser panels, YouTube panels, save/load, photo mode, fly
mode, VR — drawn with image-based lighting, cascaded shadows, a live sky, real terrain, grass
and water.

```bash
npm install               # in the REPO ROOT first: HiFi uses the main app's copy of three.js
cd HiFi && npm install
npm run dev               # http://localhost:5183  -- the app ALONE, for working on it
npm run build             # production build to HiFi/dist/
cd .. && ./serve-local.sh # http://localhost:8080/hifi/  -- the app WITH its gallery
```

**To test Get More Worlds or a `?hifiworld=` link, use `./serve-local.sh`, not `npm run dev` or
`vite preview`.** Both of those serve the app by itself at a root. The Get More Worlds button is
the relative link `../hifiworlds/`, which is right in production (the gallery is a sibling of
`/hifi/` in one docroot) and meaningless on a Vite server that has no gallery — Vite answers a
path it does not know with the app's own `index.html`, so you get an unstyled "Starting the
renderer…" page. `serve-local.sh` mounts `/hifi/` beside `/hifiworlds/` under Apache + PHP-FPM,
the way production does, builds HiFi if needed and seeds the gallery on first run.

Walk with the arrow keys, drag to look. The **☰ Menu** is the main app's own. The **✦ HiFi**
chip (bottom-left) has the renderer's settings — quality tier, wind — and a list of every
built-in world.

URL parameters: `?hifiworld=<id>` opens a world from the Edusim HiFi Worlds Database;
`?preset=<key>` loads a built-in world (`park`, `egypt`, `sea`, `neighborhood`, …);
`?quality=medium|high|ultra`; for screenshots `?ui=0&still=1&x=&z=&yaw=&pitch=&phase=`;
`?native=0` draws every prop as the main app's own model (an A/B switch for native models).

## How it works

**three.js is the scene graph; Babylon.js is the renderer.**

Edusim's logic — the record pipeline, ~500 prop builders, the block and JavaScript runtimes,
Create Model, Draw, duplication, IndexedDB persistence, the menu — is written against a
three.js scene, and every one of those classes takes `scene`, `camera` and `canvas` by
injection. None of them needs a three.js *renderer*. So HiFi imports them from `../src/` and
runs them unchanged against a three scene that is never drawn, and `src/bridge/ThreeBridge.js`
mirrors that scene into Babylon every frame. Picking, measuring, programming and saving happen
against real three.js geometry; everything you *see* is Babylon.

On the way across, the bridge upgrades what it carries: `MeshStandardMaterial` → PBR lit by
the sky probe, greyscale bump maps → real normal maps, point lights → a clustered light
container, shadow casters → cascaded shadow maps. And a prop with a **native HiFi model**
(`src/props/native.js` — trees, benches, lamp posts, planters, the Park's gate, nature centre,
pond, geese, fountain, flower beds…) is substituted rather than mirrored.

The payoff is that there is one Edusim, not two. A world fixed or added in the main app is
fixed or added here; a world file saved in either edition opens in the other.

| | Main app (three.js) | HiFi (Babylon.js) |
|---|---|---|
| Target | i5/i7 Chromebook, integrated graphics | current desktop/laptop, discrete GPU |
| Walkable world | 195ft radius | the same — the budget goes on models, not acreage |
| Terrain | 29k triangles, vertex colours | ~1M triangles, 1ft cells, 4-layer PBR splat, carved ponds, hills to the horizon |
| Ground cover | texture only | instanced grass blades + wildflowers, swaying, parting underfoot |
| Sky | flat colour | procedural atmosphere, lit drifting clouds, sun, stars, full day/night |
| Lighting | hemisphere + one sun | image-based lighting from the live sky, cascaded 4K shadows, SSAO, clustered point lights |
| Materials | vertex colours + generated bump tiles | PBR throughout; 2K photographic sets on native models |
| Trees | trunk + merged blobs | branching skeleton + ~2,500 translucent leaf cards, wind, distance LOD |
| Water | flat translucent disc | Fresnel water reflecting the sky probe, world-space ripples |
| Post | none | HDR, MSAA, ACES tone mapping, bloom, glow, colour grade |

Each world's environment is **derived** from the main app's theme (`src/themes.js`), with a
short override table for what a conversion cannot know — underwater, overcast, airless.

## Known limits

- The `changeColor` / `setOpacity` blocks do nothing on a **natively substituted** prop (they
  work on everything mirrored). `?native=0` is the escape hatch.
- The main app's in-headset menu (`VRMenu`) is a three.js object and is not carried into
  Babylon's WebXR session; VR here is walk/teleport/look. The headset path has not been run on
  a headset yet.
- Wind sways native vegetation only; mirrored vegetation is static.
- On Mars the habitation dome and its interior furniture (hydroponic racks, console, life
  support, bunks) are still the main app's models, relit. Everything outside the dome is native.

## Credits

Photographic textures are CC0 from [ambientCG](https://ambientcg.com) —
`public/textures/CREDITS.md`.
