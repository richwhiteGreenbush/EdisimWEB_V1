import { launch, boot, loadWorld, inject, look, chrome, shot } from './lib/app.mjs';
import { MODELS } from './models.mjs';
const S = process.argv[2];
const { browser, page } = await launch({ scale: 1 });
await boot(page); await loadWorld(page, 'empty'); await inject(page); await chrome(page, {});
await page.evaluate(async (M) => {
  const b = window.__book; b.baseline();
  const id = await b.addModel(M.turtle, [-5, 4], { rotY: 90 });
  await b.setProgram(id, [['markerColor', { color: '#e0455f' }], ['markerDown'], ['glide', { feet: 10, seconds: 1 }], ['markerUp']]);
}, MODELS);
await page.waitForTimeout(1800);
await look(page, { x: 0, z: 8, at: [0, 0.1, 4], eye: 1.5 });
await shot(page, `${S}/marker-front.jpg`);
const info = await page.evaluate(() => {
  const { scene, THREE } = window.__debug;
  const out = [];
  scene.traverse((o) => { if (o.isMesh && o.material?.vertexColors && o.frustumCulled === false) { out.push(o.material.side); o.material.side = THREE.DoubleSide; o.material.needsUpdate = true; } });
  return out;
});
await page.waitForTimeout(400);
await shot(page, `${S}/marker-double.jpg`);
console.log('marker meshes sides:', info);
await browser.close();
