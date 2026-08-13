# Surface textures

Photographic colour maps for the app's large flat surfaces — the terrain, the museum and
library hall floors, and the Mars dome deck. Loaded at runtime by `src/SurfaceTextures.js`
from these fixed URLs, the same way the startup assets in `public/tree/` and
`public/library/` are; never bundled, never stored in IndexedDB, never written into a
saved world file.

Everything else in the project is still generated in code. These exist because a photo
beats procedural noise on a surface that is big, flat and looked at from a few feet away,
and gives nothing to a surface you walk around — see the photo-texture notes in
`CLAUDE.md`.

## Source and licence

All five are from **[ambientCG](https://ambientcg.com)**, released under the
[Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
public domain dedication. CC0 imposes **no attribution requirement** — this file is a
courtesy, and a record of where to go for a replacement.

Each was taken from the material's `1K-JPG` download, using the `_Color` map only (the
normal, roughness, displacement and ambient-occlusion maps are not used), then re-encoded
to JPEG at quality 62 to keep the repository light. All are 1024 × 1024 and tile
seamlessly.

| File                  | ambientCG asset  | Used by                                    |
| --------------------- | ---------------- | ------------------------------------------ |
| `ground-soil.jpg`     | `Ground037`      | terrain — park, museum, library, dinosaur  |
| `ground-regolith.jpg` | `Ground068`      | terrain — moon, mars                       |
| `marble.jpg`          | `Marble006`      | museum gallery floor                       |
| `wood-floor.jpg`      | `WoodFloor008`   | library reading-room floor                 |
| `metal-deck.jpg`      | `MetalPlates006` | Mars habitation dome deck                  |

## Replacing or removing these

Nothing here is required. `photoMap()` falls back to a white pixel (a no-op, since a map
multiplies the material's colour) or to the surface's own canvas texture, so deleting this
folder returns every world to exactly how it rendered before these were added — one
console warning per missing file, no errors.

To swap one out, drop in a seamlessly-tiling replacement under the same filename. The
terrain maps are additionally normalised per channel to a mean of white at load time, so
their own overall colour is discarded and only their variation survives; the world theme
decides the hue. That is deliberate — it is what stops a grass photo turning Mars green.
