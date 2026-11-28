// Pictures for the Project Database and the tutorial cards: each official project is run for a few
// seconds on the virtual clock and its stage is saved as public/gallery/<id>.jpg. Rerun whenever a
// project changes how it looks.
//
//   npx vite --port 5193 --strictPort      (in Stages/, in another terminal)
//   node Stages/tools/gallery-pictures.mjs [--only id,id]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const OUT = resolve(HERE, '../public/gallery');
const URL_ = process.env.APP_URL || 'http://localhost:5193/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const only = (() => { const i = process.argv.indexOf('--only'); return i < 0 ? null : process.argv[i + 1].split(','); })();

// How long to run each, and which keys to hold, so the picture shows the project doing its thing.
const PLAN = {
  catch: [[80], [25, ['right arrow']], [40]],
  jump: [[60], [10, ['right arrow', 'up arrow']], [6, ['right arrow']]],
  space: [[70], [22, ['left arrow']], [20]],
  maze: [[40], [24, ['right arrow']], [10, ['up arrow']]],
  paddle: [[95]],
  quiz: [[140]],
  'moon-trip': [[520]],
  walk: [[150]],
  heart: [[20]],
  dance: [[35]],
  patterns: [[260]],
};

mkdirSync(OUT, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stages?.project, null, { timeout: 30000 });
// The learning projects carry their own picture plan (`picture` in the spec; 150 frames if none).
const learning = await page.evaluate(async () => {
  const { LEARNING_SPECS } = await import('/src/templates/learning/index.js');
  return LEARNING_SPECS.map((s) => [s.id, s.picture || [[150]]]);
});
for (const [id, steps] of [...Object.entries(PLAN), ...learning]) {
  if (only && !only.includes(id)) continue;
  const data = await page.evaluate(async ([id, steps]) => {
    const a = window.__stages;
    const { GALLERY } = await a.loadGallery();
    await a.setProject(await GALLERY.find((g) => g.id === id).build(), { fresh: true });
    a.renderer.setSize(640, 480, 1);
    let first = true;
    for (const [frames, keys = []] of steps) { a.runVirtual(frames, keys, { flag: first }); first = false; }
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 480;
    a.renderer.compositeTo(c.getContext('2d'), 0, 0, 640, 480);
    const url = c.toDataURL('image/jpeg', 0.84);
    a.runtime.stopAll();
    a.resize();
    return url;
  }, [id, steps]);
  writeFileSync(resolve(OUT, `${id}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', id);
}
await browser.close();
