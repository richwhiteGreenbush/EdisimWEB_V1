# Texture credits

Every set in this folder is from [ambientCG](https://ambientcg.com), released under
**CC0 1.0** (public domain) — no attribution is required; it is recorded here anyway.

Each folder is named for its ambientCG asset id and holds `color.jpg`, `normal.jpg` (OpenGL
convention), `rough.jpg` and, where the source has one, `ao.jpg`, recompressed at JPEG q80.

2K: Bark012, Grass004, Gravel022, Ground037, PavingStones070, Planks012, Rock030,
RoofingTiles013A, Wood049
1K: Concrete034, Ground054, Ground068, Metal032, Rock035

Roughness and AO are packed into one ORM texture at load time (`Kit.ormTexture`).
