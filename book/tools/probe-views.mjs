// Render candidate camera spots in one world, to choose a view by eye.
//   node tools/probe-views.mjs <world> <outdir> <w>x<h> 'x,z,tx,ty,tz[,eye]' ...
import { launch, boot, loadWorld, chrome, look } from './lib/app.mjs';
const [world, out, size, ...views] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const { browser, page } = await launch({ scale: 1 });
await boot(page);
if (world !== 'park') await loadWorld(page, world);
await chrome(page, {});
await page.setViewportSize({ width: w, height: h });
let i = 0;
for (const v of views) {
  const [x, z, tx, ty, tz, eye = 5] = v.split(',').map(Number);
  await look(page, { x, z, at: [tx, ty, tz], eye });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/view-${i++}.jpg`, type: 'jpeg', quality: 70 });
}
await browser.close();
