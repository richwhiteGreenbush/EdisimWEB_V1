import { launch, boot, loadWorld, inject } from './lib/app.mjs';
const { browser, page } = await launch({ scale: 1 });
await boot(page); await loadWorld(page, 'empty'); await inject(page);
const r = await page.evaluate(() => {
  window.__book.baseline();
  const { registry, THREE } = window.__debug;
  return [...registry.items.values()].map((it) => {
    const b = new THREE.Box3().setFromObject(it.object3D);
    return [it.record?.kind, it.record?.prop, b.min.toArray().map((v) => +v.toFixed(1)), b.max.toArray().map((v) => +v.toFixed(1))];
  });
});
console.log(JSON.stringify(r));
const t = await page.evaluate(() => window.__debug.registry.items.size);
console.log(t);
await browser.close();
