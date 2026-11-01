// End-to-end check of the World Database panel, in the real app through the real DOM, against a
// real gallery.
//
//   ./serve-local.sh                                the local mirror, with both galleries seeded
//   npx vite --port 5199 --strictPort               (in another terminal; it proxies /worlds/)
//   node tools/check-world-database.mjs             the main app
//   (cd HiFi && npx vite)                           (another terminal; it proxies /hifiworlds/)
//   APP_URL=http://localhost:5183/ node tools/check-world-database.mjs     HiFi
//   APP_URL=http://localhost:8080/app/ node tools/check-world-database.mjs a production build
//   HIFI=1 APP_URL=http://localhost:5197/ ...    for HiFi on any other port
//
// A production build has no window.__debug, so against one this runs the student's path alone
// and reads the result off the screen. Screenshots land in scratch/world-db/.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const HIFI = Boolean(process.env.HIFI) || /hifi|:5183/.test(APP_URL);
const GALLERY = HIFI ? '/hifiworlds/' : '/worlds/';
const LABEL = HIFI ? 'hifi' : 'main';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = resolve(ROOT, 'scratch/world-db');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

let playwright;
try {
  playwright = await import('playwright-core');
} catch {
  playwright = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
}
const browser = await playwright.chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|500|favicon|ERR_|fonts\.g|Could not (load|open) |frame-ancestors|X-Frame/.test(m.text())) errors.push(m.text());
});
const screen = (name) => page.screenshot({ path: resolve(SHOTS, `${LABEL}-${name}.jpg`), quality: 82, type: 'jpeg' });

async function boot(url = APP_URL) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('#menu-toggle'), null, { timeout: 180000 });
  if (HIFI) await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  else await page.waitForTimeout(1500);
  await settled();
}
// Records rehydrate one at a time and the arrival camera flies in, so wait for both to stop.
async function settled() {
  if (!(await page.evaluate(() => !!window.__debug))) { await page.waitForTimeout(6000); return; }
  await page.waitForFunction(() => {
    const d = window.__debug;
    const now = `${d.registry.count}|${d.camera.position.toArray().map((v) => v.toFixed(2)).join()}`;
    const t = performance.now();
    if (window.__settledKey !== now) {
      window.__settledKey = now;
      window.__settledAt = t;
      return false;
    }
    return t - window.__settledAt > 1500;
  }, null, { timeout: 180000, polling: 200 });
}
async function openPanel() {
  if (!(await page.locator('#menu-panel').isVisible())) await page.click('#menu-toggle');
  await page.click('.menu-btn-worlds');
  await page.waitForSelector('#worlddb-panel .mdb-card', { timeout: 30000 });
}
const closed = () => page.waitForSelector('#worlddb-overlay', { state: 'hidden', timeout: 180000 });
const titles = () => page.locator('#worlddb-panel .mdb-card-title').allTextContents();
const cardOpen = (title) => page.locator('#worlddb-panel .mdb-card', { has: page.getByText(title, { exact: true }) }).locator('.mdb-card-place');

await boot();
const debug = await page.evaluate(() => !!window.__debug);
const live = (fn, arg) => page.evaluate(fn, arg);
const hasChanges = () => live(() => window.__debug.worldStore.hasChanges);
const count = () => live(() => window.__debug.registry.count);

// --- the list itself ----------------------------------------------------------------
const catalog = await live(async (url) => (await fetch(url)).json(), `${GALLERY}catalog.php`);
const browsable = catalog.worlds.filter((w) => !w.secret);
const ALLOWED = ['id', 'title', 'creator', 'group', 'description', 'place', 'objects', 'tags', 'thumb', 'shot', 'page', 'band', 'grades', 'objective', 'standards', 'lessons', 'secret'];
const leaked = catalog.worlds.flatMap((w) => Object.keys(w).filter((k) => !ALLOWED.includes(k)));
check('the list carries only its named fields', leaked.length === 0, leaked.join());
check('no hash or stored file name anywhere in it', !/manage_key|ip_hash|world_path|sha256/.test(JSON.stringify(catalog)));
check('the two secret worlds are marked', catalog.worlds.filter((w) => w.secret).length === 2);
// Not a failure: a world with no teacher entry shows under All and leaves the grade filter.
console.log(`note worlds with no grade band: ${catalog.worlds.filter((w) => !w.grades.length).map((w) => w.title).join(', ') || 'none'}`);
check('the bookkeeping tags are not shown as topics', !catalog.worlds.some((w) => w.tags.includes('official') || w.tags.includes('hifi')));

// --- the menu -----------------------------------------------------------------------
await page.click('#menu-toggle');
const rows = await page.locator('#menu-panel > button').allTextContents();
check('World Database sits directly above Model Database', rows.indexOf('World Database') >= 0 && rows.indexOf('World Database') + 1 === rows.indexOf('Model Database'), rows.join(' | '));
check('Get More Worlds is gone', !rows.includes('Get More Worlds'));
await screen('01-menu');
if (debug) {
  const vrRows = await live(() => {
    const menu = window.__debug.vrView?.menu;
    if (!menu) return null;
    const was = menu.collapsed;
    menu.collapsed = false;
    const ids = menu.buildRows().map((r) => r.id);
    menu.collapsed = was;
    return ids;
  });
  if (vrRows) check('the headset menu offers it above the Model Database', vrRows.indexOf('worldDatabase') + 1 === vrRows.indexOf('modelDatabase'));
}

// --- browsing and searching ---------------------------------------------------------
await page.click('.menu-btn-worlds');
await page.waitForSelector('#worlddb-panel .mdb-card');
check('the menu row opens the panel', await page.locator('#worlddb-overlay').isVisible());
check('the panel lists every world but the secret two', (await titles()).length === browsable.length, `${(await titles()).length} of ${catalog.worlds.length}`);
check('the secret worlds are not listed', !(await titles()).some((t) => /New York|Under the Sea/.test(t)));
check('first in the list is the most opened', (await titles())[0] === browsable[0].title);
await page.waitForTimeout(800);
await screen('02-panel');

await page.fill('#worlddb-panel .mdb-search', 'dinosaur');
check('search finds a world by name', (await titles())[0] === 'Dinosaur Island', (await titles()).slice(0, 3).join());
await page.fill('#worlddb-panel .mdb-search', 'dino isl');
check('words match by prefix', (await titles())[0] === 'Dinosaur Island');
await page.fill('#worlddb-panel .mdb-search', 'xyzzy');
check('a search with no match says so', await page.locator('#worlddb-panel .mdb-empty').isVisible());
await page.fill('#worlddb-panel .mdb-search', 'sea');
check('one word does not reveal a secret world', !(await titles()).includes('Under the Sea'), (await titles()).slice(0, 4).join());
await page.fill('#worlddb-panel .mdb-search', 'under the sea');
check('its whole name does', (await titles()).includes('Under the Sea'));
await page.fill('#worlddb-panel .mdb-search', 'new york');
check('so does the other one', (await titles()).some((t) => t.includes('New York')));
await page.fill('#worlddb-panel .mdb-search', '');

await page.locator('#worlddb-panel .mdb-rail-btn', { hasText: 'Space' }).click();
check('a topic filters the cards', (await titles()).length === browsable.filter((w) => w.tags.includes('space')).length, String((await titles()).length));
await page.locator('#worlddb-panel .mdb-rail-btn', { hasText: 'All worlds' }).click();
await page.selectOption('#worlddb-panel .mdb-grade select', '9-12');
check('the grade filter narrows the list', (await titles()).length === browsable.filter((w) => w.grades.includes('9-12')).length, String((await titles()).length));
await page.selectOption('#worlddb-panel .mdb-grade select', 'all');

// --- details ------------------------------------------------------------------------
const lessoned = browsable.find((w) => w.lessons.length) ?? browsable[0];
await page.locator('#worlddb-panel .mdb-card', { has: page.getByText(lessoned.title, { exact: true }) }).locator('.mdb-card-open').click();
check('a card opens its details', (await page.locator('#worlddb-panel .mdb-detail-title').textContent()) === lessoned.title);
check('the details link to the world and its lessons', (await page.locator('#worlddb-panel .wdb-link').count()) === lessoned.lessons.length + 1);
const hrefs = await page.locator('#worlddb-panel .wdb-link').evaluateAll((els) => els.map((a) => ({ href: a.href, rel: a.rel })));
check('links out carry noopener', hrefs.every((a) => a.rel.includes('noopener')));
await page.waitForTimeout(800);
await screen('03-detail');
await page.keyboard.press('Escape');
check('Esc goes back from the details to the list', await page.locator('#worlddb-panel .mdb-grid').isVisible());
await page.keyboard.press('Escape');
check('Esc again closes the panel', !(await page.locator('#worlddb-overlay').isVisible()));

// --- a world that failed to arrive changes nothing ----------------------------------
const target = browsable.find((w) => /Dinosaur Island/.test(w.title)) ?? browsable[0];
const other = browsable.find((w) => /The Moon/.test(w.title)) ?? browsable[1];
const before = debug ? await count() : null;
await page.route(`**${GALLERY}download.php*`, (route) => route.abort());
await openPanel();
await cardOpen(target.title).click();
await page.locator('.toast', { hasText: /Could not reach/ }).first().waitFor({ timeout: 15000 });
check('a failed download leaves the panel open', await page.locator('#worlddb-overlay').isVisible());
if (debug) check('and the world untouched', (await count()) === before, `${before} objects`);
await page.unroute(`**${GALLERY}download.php*`);
await page.keyboard.press('Escape');

// --- opening with nothing changed goes straight through ------------------------------
if (debug) check('a world that has only been walked around counts as unchanged', (await hasChanges()) === false);
await live(() => {
  const d = window.__debug;
  if (!d) return;
  window.__heard = [];
  const original = d.programManager.broadcast.bind(d.programManager);
  d.programManager.broadcast = (word) => { window.__heard.push(word); return original(word); };
  d.menuActions?.eyeHeight?.(0.3);
});
await openPanel();
await cardOpen(target.title).click();
check('no question when nothing would be lost', (await page.locator('.wdb-confirm').count()) === 0);
await closed();
await page.locator('.toast', { hasText: `${target.title} is ready` }).first().waitFor({ timeout: 10000 });
check('the panel closes and says the world is ready', true);
if (debug) {
  await settled();
  const world = await page.evaluate(() => {
    const d = window.__debug;
    return {
      count: d.registry.count,
      heard: window.__heard,
      eye: d.player.eyeHeight,
    };
  });
  check('every record of the world arrived', world.count >= target.objects, `${world.count} of ${target.objects}`);
  check('"when this world opens" programs get their cue', world.heard.includes('start'));
  check('the student is back to their own size', world.eye === 5, String(world.eye));
  check('a freshly opened world counts as unchanged', (await hasChanges()) === false);
  const stored = await live((key) => localStorage.getItem(key), HIFI ? 'edusim-hifi-world-changed' : 'edusim-world-changed');
  check('each edition keeps its own flag', stored === '0', String(stored));
}
await page.waitForTimeout(HIFI ? 4000 : 1500);
await screen('04-opened');

// --- with a change, it asks ---------------------------------------------------------
await page.click('#menu-toggle');
await page.locator('#menu-panel > button', { hasText: 'Create Model' }).click();
await page.locator('#menu-panel .menu-subitem', { hasText: 'Cube' }).first().click();
await page.locator('.toast', { hasText: /Shape added/ }).first().waitFor({ timeout: 10000 });
if (debug) check('placing a shape counts as a change', (await hasChanges()) === true);
await page.click('#menu-toggle').catch(() => {});
const placedCount = debug ? await count() : null;
await openPanel();
await cardOpen(other.title).click();
await page.waitForSelector('.wdb-confirm');
check('now it asks first', await page.locator('.wdb-confirm').isVisible());
check('focus starts on the button that loses nothing', (await page.evaluate(() => document.activeElement?.textContent)) === 'Keep this world');
await page.waitForTimeout(300);
await screen('05-confirm');
await page.keyboard.press('Escape');
check('Esc answers the question and leaves the panel open', (await page.locator('.wdb-confirm').count()) === 0 && await page.locator('#worlddb-overlay').isVisible());
await cardOpen(other.title).click();
await page.locator('.wdb-confirm button', { hasText: 'Keep this world' }).click();
if (debug) check('Keep changes nothing', (await count()) === placedCount && (await hasChanges()) === true);

// The change has to survive a refresh, along with the work it describes.
await page.keyboard.press('Escape');
await boot();
await openPanel();
await cardOpen(other.title).click();
await page.waitForSelector('.wdb-confirm');
check('it still asks after a refresh', await page.locator('.wdb-confirm').isVisible());

// Save first, then open.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.locator('.wdb-confirm button', { hasText: 'Save this world first' }).click(),
]);
check('Save this world first downloads the world', /\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
await page.locator('.wdb-confirm button', { hasText: `Open ${other.title}` }).waitFor({ timeout: 10000 });
await page.waitForTimeout(200);
await screen('06-saved');
await page.locator('.wdb-confirm button', { hasText: `Open ${other.title}` }).click();
await closed();
await page.locator('.toast', { hasText: `${other.title} is ready` }).first().waitFor({ timeout: 10000 });
check('then the world opens', true);
if (debug) {
  await settled();
  check('the placed shape went with the old world', (await page.evaluate(() => [...window.__debug.registry.items.values()].filter((i) => i.record?.kind === 'primitive').length)) === 0);
}

// --- when the list cannot be had -----------------------------------------------------
await page.route(`**${GALLERY}catalog.php`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><p>A filter page</p>' }));
await boot();
if (!(await page.locator('#menu-panel').isVisible())) await page.click('#menu-toggle');
await page.click('.menu-btn-worlds');
await page.locator('#worlddb-panel .mdb-empty button', { hasText: 'Try again' }).waitFor({ timeout: 15000 });
check('a 200 that is not JSON reads as a failure, with a way forward', true);
await page.waitForTimeout(200);
await screen('07-error');
await page.unroute(`**${GALLERY}catalog.php`);
await page.locator('#worlddb-panel .mdb-empty button', { hasText: 'Try again' }).click();
await page.waitForSelector('#worlddb-panel .mdb-card', { timeout: 15000 });
check('Try again recovers', (await titles()).length === browsable.length);
await page.keyboard.press('Escape');

// --- a link still opens a world, the same way -----------------------------------------
const param = HIFI ? 'hifiworld' : 'world';
await boot(`${APP_URL}?${param}=${target.id}`);
await page.locator('.toast', { hasText: /Shared world opened/ }).first().waitFor({ timeout: 30000 }).catch(() => {});
check('a link is stripped from the address', !page.url().includes(`${param}=`), page.url());
if (debug) check('and its world arrived', (await count()) >= target.objects, String(await count()));

// --- a phone ---------------------------------------------------------------------------
await page.setViewportSize({ width: 390, height: 780 });
await openPanel();
await page.waitForTimeout(800);
await screen('08-phone');
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1360, height: 860 });

// --- no shipped world counts as changed just by running --------------------------------
if (debug && !process.env.SKIP_SWEEP) {
  const flagged = [];
  for (const world of catalog.worlds) {
    await live((id) => window.__debug.worldDatabase.openWorld(id), world.id);
    await page.waitForTimeout(HIFI ? 2500 : 1500);
    if (await hasChanges()) flagged.push(world.title);
    await live(() => window.__debug.cinema?.release?.());
  }
  check(`no world of ${catalog.worlds.length} counts as changed from its own programs`, flagged.length === 0, flagged.join(', '));
}

check('no errors in the console', errors.length === 0, errors.slice(0, 4).join(' || '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
process.exit(failures ? 1 : 0);
