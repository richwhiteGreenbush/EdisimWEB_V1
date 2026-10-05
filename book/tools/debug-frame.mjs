import { launch, boot, loadWorld, inject } from './lib/app.mjs';
import { MODELS } from './models.mjs';
const { browser, page } = await launch({ scale: 1 });
await boot(page); await loadWorld(page, 'empty'); await inject(page);
const r = await page.evaluate(async (M) => {
  const b = window.__book; b.baseline();
  const id = await b.addModel(M.snowman, [0, 6]);
  const { THREE, registry, camera, player } = window.__debug;
  const box = new THREE.Box3().expandByObject(registry.get(id).object3D);
  const d = b.frame({ az: 22, el: 6, fill: 0.7 });
  return { box: [box.min.toArray(), box.max.toArray()], d, cam: camera.position.toArray(), eye: player.eyeHeight, near: camera.near };
}, MODELS);
console.log(JSON.stringify(r));
await browser.close();
