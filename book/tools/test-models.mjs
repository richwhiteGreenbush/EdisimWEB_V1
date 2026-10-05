// Look at every model once, to check proportions before any real capture.
import { launch, boot, loadWorld, chrome, shot, inject, look } from './lib/app.mjs';
import { MODELS } from './models.mjs';
const out = process.argv[2] || '/tmp/models.jpg';
const { browser, page, errors } = await launch({ scale: 1 });
await boot(page);
await loadWorld(page, 'empty');
await inject(page);
await chrome(page, {});
await page.evaluate(async (M) => {
  const b = window.__book;
  await b.addModel(M.locomotive, [-9, 4]);
  await b.addModel(M.carriage, [-9, -2.5]);
  await b.addModel(M.turtle, [-3, 6]);
  await b.addModel(M.giraffe, [1, 2]);
  await b.addModel(M.snowman, [4, 7]);
  await b.addModel(M.station, [7, -4]);
  await b.addModel(M.house, [-2, -6]);
}, MODELS);
await look(page, { x: 2, z: 22, at: [-1, 2, 0], eye: 9 });
await shot(page, out);
console.log(errors);
await browser.close();
