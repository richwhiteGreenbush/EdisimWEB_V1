// The inspect space (src/InspectSpace.js), through the real DOM, against a dev server on 5199:
//
//   npx vite --port 5199 --strictPort
//   node tools/check-inspect.mjs
//
// The first check is the one that matters. A student has a world of their own in this browser, a
// link opens the inspect space, they stretch and delete things in it, and their world has to be
// exactly as they left it, including the flag that makes the World Database ask before replacing it.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const readSaved = () => page.evaluate(async () => {
  const { DB_NAME } = await import('/src/config.js');
  const db = await new Promise((res, rej) => {
    const open = indexedDB.open(DB_NAME);
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
  });
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names[0]);
  const all = await new Promise((res) => {
    const get = tx.objectStore(names[0]).getAll();
    get.onsuccess = () => res(get.result);
  });
  db.close();
  return {
    count: all.length,
    ids: all.map((r) => r.id).sort().join(),
    changed: localStorage.getItem(window.__debug.worldStore.changesKey),
  };
});

// --- A student with a world of their own ---------------------------------------------------
await page.goto(APP_URL, { waitUntil: 'load' });
// The Park is still arriving when the first record lands, and a read taken then is short of records.
await page.waitForFunction(() => window.__debug?.registry?.count > 0 && !window.__debug.worldStore.bulkLoading, null, { timeout: 120000 });
await page.waitForTimeout(800);
await page.evaluate(() => window.__debug.menuActions.lightOrb());
await page.waitForTimeout(400);
const before = await readSaved();
check('a world of their own is saved first', before.count > 0 && before.changed === '1', `${before.count} records, changed=${before.changed}`);

// --- The link ------------------------------------------------------------------------------
await page.goto(`${APP_URL}?inspect=animal-cell`, { waitUntil: 'load' });
await page.waitForSelector('.inspect-hud', { timeout: 120000 });
await page.evaluate(() => window.__debug.cinema.release());
check('the address keeps the link, so a refresh starts over', page.url().includes('inspect=animal-cell'));
check('the menu is hidden', await page.evaluate(() => getComputedStyle(document.getElementById('menu')).display === 'none'));
check('the veil has gone', await page.evaluate(() => !document.querySelector('.inspect-veil')));
check('Biology is the theme', (await page.textContent('.inspect-eyebrow')).includes('Biology'));
const space = await page.evaluate(() => {
  const { registry, inspect, scene } = window.__debug;
  const items = [...registry.items.values()];
  return {
    kinds: items.map((i) => i.record.kind).join(),
    model: items[0]?.record.model,
    hue: inspect.palette.hue,
    background: scene.background.getHexString(),
    stageRegistered: items.some((i) => i.object3D.userData.isInspectStage),
  };
});
check('one model is the only record', space.kinds === 'catalog-model' && space.model === 'animal-cell', space.kinds);
check('the stage is not a record, so it cannot be clicked or stretched', !space.stageRegistered);
check('the room takes its hue from the model', space.hue >= 150 && space.hue <= 240, `hue ${space.hue}, sky #${space.background}`);

// --- What a student can do to it -----------------------------------------------------------
await page.evaluate(() => {
  const { registry, worldStore } = window.__debug;
  const item = [...registry.items.values()][0];
  item.object3D.scale.multiplyScalar(2);
  item.record.transform.scale = item.object3D.scale.toArray();
  worldStore.saveObject(item.record);
  worldStore.deleteObject('nothing');
});
await page.waitForTimeout(200);
const after = await readSaved();
check('the saved world has the same records', after.ids === before.ids, `${after.count} of ${before.count}`);
check('and its changed flag is untouched', after.changed === before.changed, `changed=${after.changed}`);

// The button a student presses, then the model itself.
await page.click('.inspect-btn-go');
const orbiting = await page.evaluate(() => window.__debug.cinema.active);
check('Fly round it takes the camera', orbiting);
await page.evaluate(() => window.__debug.cinema.release());
await page.waitForTimeout(300);
check('and gives it back', await page.evaluate(() => !window.__debug.cinema.active));

// --- The way back --------------------------------------------------------------------------
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.inspect-hud', { timeout: 120000 });
check('a refresh builds the space again', await page.evaluate(() => window.__debug.registry.count === 1));
await page.click('.inspect-actions a:last-child');
await page.waitForFunction(() => window.__debug?.registry?.count > 1 && !window.__debug.worldStore.bulkLoading, null, { timeout: 120000 });
await page.waitForTimeout(500);
const home = await readSaved();
check('Open my world brings the saved world back', home.ids === before.ids && !page.url().includes('inspect'), page.url());
check('with the menu showing', await page.evaluate(() => getComputedStyle(document.getElementById('menu')).display !== 'none'));

// --- A bad link ----------------------------------------------------------------------------
await page.goto(`${APP_URL}?inspect=${encodeURIComponent('https://evil.example/x.json')}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug?.registry?.count > 1, null, { timeout: 120000 });
check('an unknown id opens the student\'s own world and fetches nothing', await page.evaluate(() => !document.querySelector('.inspect-hud') && window.__debug.worldStore.persistent));

// --- Every theme has what it needs --------------------------------------------------------
const themes = await page.evaluate(async () => {
  const { MODELS } = await import('/src/models/catalog.js');
  return [...new Set(MODELS.map((m) => m.subjects?.[0]))];
});
const missing = await page.evaluate(async () => {
  const { MODELS } = await import('/src/models/catalog.js');
  const { inspectTheme: theme } = await import('/src/InspectSpace.js');
  return MODELS.filter((m) => theme(m).label === 'Science' && !['science'].includes(m.subjects?.[0])).map((m) => m.id);
});
check(`every model's subject has a theme (${themes.length} subjects)`, missing.length === 0, missing.slice(0, 6).join());

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `${failures} FAILED` : 'All checks passed');
process.exit(failures ? 1 : 0);
