// The three World Database pages the book shows, captured from the live site.
//   node tools/capture-web.mjs
import { chromium } from 'playwright-core';
import { CHROME } from './lib/app.mjs';
const OUT = new URL('../assets/shots/', import.meta.url).pathname;
const BASE = process.env.GALLERY || 'https://edusim3dweb.com/worlds/';
const pages = [
  ['gallery-home', ''],
  ['gallery-world', 'world.php?id=6'],
  ['gallery-share', 'share.php'],
];
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1100, height: 688 }, deviceScaleFactor: 2 });
for (const [name, path] of pages) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log('ok', name, await p.title());
}
await b.close();
