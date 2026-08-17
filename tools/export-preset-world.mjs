// Exports a preset world to the .json payload the gallery seeds from, without a browser.
//
//   node tools/export-preset-world.mjs sea EdusimWorldDatabase/seed/worlds/sea.json
//
// A preset world is a list of RECORDS -- prop name, options, transform -- and building that
// list touches no geometry at all, so it runs perfectly well in node. The one thing it does
// need is the ground height under each object, and every path inside the app gets that by
// raycasting the real terrain mesh, which needs a renderer and a rendered frame. So this
// calls SceneSetup's own terrainHeightAt directly: the same function the mesh is built from,
// rather than a copy of it that is free to drift.
import { writeFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const [name, out] = process.argv.slice(2);
if (!name || !out) {
  console.error('usage: node tools/export-preset-world.mjs <preset> <out.json>');
  process.exit(1);
}

const { buildPresetWorldRecords, PRESET_WORLDS } = await import('../src/WorldPresets.js');
const { terrainHeightAt } = await import('../src/SceneSetup.js');
const { WORLD_THEMES, DEFAULT_THEME } = await import('../src/config.js');

if (!PRESET_WORLDS[name]) {
  console.error(`unknown preset "${name}" -- one of: ${Object.keys(PRESET_WORLDS).join(', ')}`);
  process.exit(1);
}

// THE THEME HAS TO BE KNOWN BEFORE THE HEIGHTS ARE READ, and a preset does not declare it
// anywhere a caller can see: it is returned by the layout function, alongside the records
// that were already grounded against it. Reading it off PRESET_WORLDS gives undefined, which
// falls back to the default theme -- and the default theme's hills are not this world's, so
// every object comes out a foot or so off the sea floor it is supposed to be sitting on.
//
// So this builds TWICE: once to find out which theme the layout asked for, and once for real.
// The app cannot do that (it has already applied the theme to a live mesh by then); a tool
// can, and it costs a few milliseconds.
const probe = buildPresetWorldRecords(name, { groundHeightAt: () => 0 });
const themeName = (probe.records ?? probe).find((r) => r.kind === 'world-theme')?.theme ?? DEFAULT_THEME;
const theme = WORLD_THEMES[themeName] ?? WORLD_THEMES[DEFAULT_THEME];
const built = buildPresetWorldRecords(name, {
  groundHeightAt: (x, z) => terrainHeightAt(theme, x, z),
});

const records = built.records ?? built;
const payload = {
  format: 'edusim-world',
  version: 1,
  exportedAt: new Date().toISOString(),
  records,
};
const text = JSON.stringify(payload);
writeFileSync(out, text);
console.log(`${name}: ${records.length} records, ${(text.length / 1024).toFixed(1)} KB -> ${out}`);
