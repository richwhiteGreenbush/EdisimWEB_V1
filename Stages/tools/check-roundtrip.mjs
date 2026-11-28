// The whole student path between the apps, through the real DOM, on ONE origin (the apps hand a
// project across through same-origin IndexedDB, so the dev servers on separate ports cannot do this):
//
//   Stages → 🌍 3D → Open in Edusim → the stage arrives in a world → click it → Edit in Stages
//   → change the project → Back to 3D world → the open 3D tab updates, over a BroadcastChannel
//   Stages → 🌍 3D → Open in Edusim HiFi → the stage arrives in HiFi
//
// Needs the PRODUCTION builds laid out as production lays them out (/app/, /stages/, /hifi/ side by
// side), e.g. ./serve-local.sh, or the three dist folders copied under one static server:
//   BASE=http://localhost:8098/ node Stages/tools/check-roundtrip.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.BASE || 'http://localhost:8080/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || '/private/tmp';
const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const errors = [];
ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(`${new URL(p.url()).pathname}: ${e.message}`)));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  (${detail})` : ''}`); if (!ok) failures++; };

// Reads the stage records out of an app's own database.
const stageRecords = (page, db) => page.evaluate((db) => new Promise((resolve) => {
  const req = indexedDB.open(db);
  req.onsuccess = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains('placedObjects')) { resolve([]); return; }
    const all = d.transaction('placedObjects').objectStore('placedObjects').getAll();
    all.onsuccess = async () => {
      const out = [];
      for (const r of all.result.filter((x) => x.kind === 'stages-project')) out.push({ id: r.id, layout: r.layout, text: await r.files[0].data.text() });
      resolve(out);
    };
  };
  req.onerror = () => resolve([]);
}), db);

async function waitFor(fn, ms = 60000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

const stages = await ctx.newPage();
await stages.goto(`${BASE}stages/?project=catch`, { waitUntil: 'load' });
await stages.waitForFunction(() => document.querySelector('.title-input')?.value === 'Catch the Coins', null, { timeout: 60000 });
check('Stages opens a project by link', true);

await stages.click('button.to3d');
await stages.waitForSelector('.t3-modal canvas');
await stages.screenshot({ path: `${OUT}/rt-dialog.png` });
const [app] = await Promise.all([ctx.waitForEvent('page'), stages.click('[data-go="app"]')]);
await app.waitForLoadState('load');
const arrived = await waitFor(async () => (await stageRecords(app, '3dcoder-world')).length === 1);
check('Open in Edusim: the stage arrives in a new world and is saved', !!arrived);
check('the handoff token is stripped from the address', !app.url().includes('from-stages'), app.url());
await app.waitForTimeout(7000); // the arrival swoop
await app.screenshot({ path: `${OUT}/rt-app.png` });

// Click the stage (it stands in front of the student) and choose Edit in Stages.
await app.mouse.click(683, 330);
await app.waitForSelector('#object-menu:not([hidden])', { timeout: 10000 }).catch(() => {});
const menuRows = await app.evaluate(() => [...document.querySelectorAll('#object-menu button')].map((b) => b.textContent).join(' | '));
const hasEdit = await app.locator('#object-menu button', { hasText: 'Edit in Stages' }).count();
check('clicking the stage offers Edit in Stages', hasEdit === 1, menuRows);
if (hasEdit) {
  const [edit] = await Promise.all([ctx.waitForEvent('page'), app.locator('#object-menu button', { hasText: 'Edit in Stages' }).click()]);
  await edit.waitForLoadState('load');
  await edit.waitForSelector('.back3d:not([hidden])', { timeout: 30000 }).catch(() => {});
  const back = await edit.locator('.back3d:not([hidden])').count();
  check('Edit in Stages opens the project with a way back', back === 1);
  await edit.fill('.title-input', 'Changed in Stages');
  await edit.press('.title-input', 'Enter');
  await edit.waitForTimeout(600);
  await edit.click('.back3d');
  await edit.waitForTimeout(2500);
  const toastSaid = await edit.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  check('Back to 3D world updates the open 3D tab at once', /has the new version/.test(toastSaid), toastSaid);
  const updated = await waitFor(async () => (await stageRecords(app, '3dcoder-world')).some((r) => r.text.includes('Changed in Stages')), 15000);
  check('the stage in the 3D world now carries the edited project', !!updated);
  check('and it is still one stage, updated in place', (await stageRecords(app, '3dcoder-world')).length === 1);
}

// HiFi.
await stages.bringToFront();
await stages.click('button.to3d');
await stages.waitForSelector('.t3-modal canvas');
const [hifi] = await Promise.all([ctx.waitForEvent('page'), stages.click('[data-go="hifi"]')]);
await hifi.waitForLoadState('load');
const inHifi = await waitFor(async () => (await stageRecords(hifi, 'edusim-hifi-world')).length === 1, 120000);
check('Open in Edusim HiFi: the stage arrives in HiFi', !!inHifi);
await hifi.waitForTimeout(9000);
await hifi.screenshot({ path: `${OUT}/rt-hifi.png` });

check('no page errors in any of the apps', !errors.length, errors.join(' | '));
await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
