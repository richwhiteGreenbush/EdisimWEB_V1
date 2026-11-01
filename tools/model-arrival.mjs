// Photographs what a student really sees first: each model placed through the panel in My World, from
// a 5ft eye, under a bright sky. tools/model-pictures.mjs is for the shipped pictures, from a raised
// camera against a dark backdrop, and that view hides exactly what fails here: water below a rim, a
// disk seen edge-on, pale lines lost against the sky. Look at this sheet before adopting a model.
//
//   node tools/model-arrival.mjs id,id,id [out.jpg]
//
// Needs a dev server on 5199, or APP_URL=http://localhost:5183/ for HiFi.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ids = (process.argv[2] || '').split(',').filter(Boolean);
if (!ids.length) throw new Error('Name the models: node tools/model-arrival.mjs id,id,id [out.jpg]');
const out = process.argv[3] || resolve(ROOT, 'scratch/model-arrival/sheet.jpg');
mkdirSync(dirname(out), { recursive: true });

const playwright = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 625 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(APP_URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug?.registry?.count > 0, null, { timeout: 180000 });
if (await page.evaluate(() => !!window.__debug?.bscene)) await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
// Swapping worlds while the boot world is still arriving leaves both in the scene.
const settled = () => page.waitForFunction(() => {
  const n = window.__debug.registry.count;
  const t = performance.now();
  if (window.__k !== n) { window.__k = n; window.__t = t; return false; }
  return t - window.__t > 2000;
}, null, { timeout: 180000, polling: 200 });
await settled();
await page.evaluate(async () => {
  const d = window.__debug;
  d.cinema?.release?.();
  await d.menuActions.loadPreset('empty');
  const css = document.createElement('style');
  css.textContent = '#menu,#touch-nav,#toast-host{display:none!important}';
  document.head.append(css);
});
await settled();

const shots = [];
for (const id of ids) {
  await page.evaluate(async (model) => {
    const d = window.__debug;
    d.cinema?.release?.();
    d.player.resetTo({ x: 0, z: 90, yaw: 0 });
    await new Promise((r) => setTimeout(r, 80));
    window.__before = new Set(d.registry.items.keys());
    await d.modelDatabase.place(model);
    if (d.modelDatabase.isOpen) d.modelDatabase.close();
  }, id);
  await page.waitForTimeout(800);
  shots.push([id, (await page.screenshot({ type: 'jpeg', quality: 76 })).toString('base64')]);
  await page.evaluate(() => {
    const d = window.__debug;
    const key = [...d.registry.items.keys()].find((k) => !window.__before.has(k));
    if (key) { d.registry.remove(key); d.worldStore.deleteObject(key); }
  });
}
const cols = Math.min(shots.length, 4);
const w = cols === 1 ? 1000 : Math.round(1600 / cols);
const h = Math.round(w * 0.625);
const sheet = await browser.newPage({ viewport: { width: cols * w, height: Math.ceil(shots.length / cols) * (h + 16) } });
await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${w}px);background:#222;color:#fff;font:12px sans-serif">${shots.map(([id, data]) => `<div><img src="data:image/jpeg;base64,${data}" width="${w}" height="${h}" style="display:block"><div style="height:16px">${id}</div></div>`).join('')}</body>`);
await sheet.waitForTimeout(400);
await sheet.screenshot({ path: out, type: 'jpeg', quality: 86 });
await browser.close();
console.log(out, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
