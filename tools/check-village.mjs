// Runs the Build a Village activities in the real app, so that what docs/guide/village.html tells a
// student to do is something a tool has done. Needs a dev server: `npx vite --port 5199`, or
// APP_URL=http://localhost:5183/ for HiFi.
//
//   node tools/check-village.mjs
//
// It builds a whole village too and prints what one costs, because a kit a child is invited to place
// dozens of times has to be measured as a village and not one model at a time.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { MODELS } from '../src/models/catalog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = resolve(ROOT, 'scratch/village');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const kit = MODELS.filter((m) => m.category === 'village');
// Animals are the exception on purpose: a cow does not need to line up with anything, and turned a
// little she arrives side on, which is the view that reads as a cow.
const ANIMALS = ['dairy-cow', 'sheep', 'farm-pig', 'hen-and-chicks', 'draft-horse', 'goat'];
check('the kit has 25 pieces, with everything but the animals squared to the grid', kit.length === 25 && kit.every((m) => !!m.grid !== ANIMALS.includes(m.id)));
check('everything that tiles is a row piece', ['wheat-plot', 'three-sisters-garden', 'vegetable-garden', 'rice-paddy', 'post-and-rail-fence', 'wooden-footbridge'].every((id) => kit.find((m) => m.id === id).grid === 'row'));

// The page tells a student to change 35 to 90 and says that walks a square. Run it, with the numbers
// the page prints, through the real runner.
{
  const { runBlocks } = await import('./lib/run-blocks.mjs');
  const { repeat, forward, rotate } = await import('../src/BlockKit.js');
  const THREE = await import('three');
  for (const steps of [40, 200]) {
    const object3D = new THREE.Object3D();
    runBlocks([repeat(4, repeat(steps, forward(0.05)), rotate(90))], { object3D });
    check(`turning 90 with ${steps} steps walks a closed square`, object3D.position.length() < 1e-6, object3D.position.toArray().map((v) => v.toFixed(4)).join());
  }
}

const playwright = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|ERR_|fonts\.g/.test(m.text())) errors.push(m.text()); });
await page.goto(APP_URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug?.registry?.count > 0, null, { timeout: 180000 });
if (await page.evaluate(() => !!window.__debug?.bscene)) await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

// My World, the empty field the activities start in, through the same path a world link takes.
await page.evaluate(async () => {
  const d = window.__debug;
  d.cinema?.release?.();
  await d.menuActions.loadPreset('empty');
});
await page.waitForTimeout(2500);
await page.evaluate(() => window.__debug.cinema?.release?.());

// The panel's own Place, standing where asked.
async function place(id, standAt = null) {
  return page.evaluate(async ({ id, standAt }) => {
    const d = window.__debug;
    if (standAt) d.player.resetTo(standAt);
    await new Promise((r) => setTimeout(r, 100));
    const before = new Set(d.registry.items.keys());
    await d.modelDatabase.place(id);
    if (d.modelDatabase.isOpen) d.modelDatabase.close();
    return [...d.registry.items.keys()].find((key) => !before.has(key));
  }, { id, standAt });
}
const positionsOf = (m) => page.evaluate((id) => [...window.__debug.registry.items.values()].filter((i) => i.record?.model === id).map((i) => ({ p: i.object3D.position.toArray(), program: !!i.record.program })), m);
const press = (id) => page.evaluate((recordId) => {
  const { registry, programManager } = window.__debug;
  const item = registry.get(recordId);
  programManager.startFromRecord(recordId, item.record, item.object3D);
}, id);

// --- squares up ----------------------------------------------------------------------
const quarter = await page.evaluate(() => Math.PI / 2);
for (const yaw of [0, 0.7, 2.2, -1.1]) {
  const id = await place('granary', { x: 0, z: 150, yaw });
  const rot = await page.evaluate((recordId) => window.__debug.registry.get(recordId).object3D.rotation.y, id);
  const off = Math.abs(rot / quarter - Math.round(rot / quarter));
  check(`a piece placed while facing ${yaw} lands on a quarter turn`, off < 1e-6, `rotation ${rot.toFixed(3)}`);
  await page.evaluate((recordId) => { const d = window.__debug; d.registry.remove(recordId); d.worldStore.deleteObject(recordId); }, id);
}
await page.evaluate(() => window.__debug.menuActions.loadPreset('empty'));
await page.waitForTimeout(2000);
await page.evaluate(() => window.__debug.cinema?.release?.());

// --- activity 3: rows ----------------------------------------------------------------
for (const [id, step, program] of [['wheat-plot', 20, 'plot'], ['three-sisters-garden', 20, 'plot'], ['vegetable-garden', 20, 'plot'], ['rice-paddy', 20, 'plot'], ['post-and-rail-fence', 10, 'fence'], ['wooden-footbridge', 30, 'stream']]) {
  const recordId = await place(id, { x: -60, z: 140, yaw: 0 });
  await press(recordId);
  await page.waitForTimeout(1800);
  const row = (await positionsOf(id)).sort((a, b) => a.p[0] - b.p[0]);
  const xs = row.map((r) => r.p[0]);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  check(`${id}: pressing the arrow lays a straight row (${program})`, row.length === (id === 'wooden-footbridge' ? 3 : 4) && gaps.every((g) => Math.abs(g - step) < 1e-6) && row.every((r) => Math.abs(r.p[2] - row[0].p[2]) < 1e-6), `${row.length} at gaps ${gaps.join()}`);
  check(`${id}: copies do not carry a program, so a row does not breed`, row.filter((r) => r.program).length === 1);
  await page.evaluate(() => window.__debug.menuActions.loadPreset('empty'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__debug.cinema?.release?.());
}

// A row has to be straight whichever way the student was facing when they placed the first piece.
for (const yaw of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
  const recordId = await place('post-and-rail-fence', { x: 0, z: 100, yaw });
  await press(recordId);
  await page.waitForTimeout(1500);
  const rows = await page.evaluate(() => [...window.__debug.registry.items.values()].filter((i) => i.record?.model === 'post-and-rail-fence').map((i) => i.object3D.rotation.y));
  const ends = rows.every((r) => Math.abs(Math.sin(r)) < 1e-6);
  check(`a fence placed while facing ${yaw.toFixed(2)} still runs end to end`, rows.length === 4 && ends, `${rows.length} sections`);
  await page.evaluate(() => window.__debug.menuActions.loadPreset('empty'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__debug.cinema?.release?.());
}

// --- activity 4: animals stay near, and turning 90 walks a square ----------------------
for (const [id, reach] of [['dairy-cow', 8], ['sheep', 8], ['farm-pig', 8], ['goat', 8], ['hen-and-chicks', 5]]) {
  const recordId = await place(id, { x: 0, z: 150, yaw: 0 });
  const start = await page.evaluate((r) => window.__debug.registry.get(r).object3D.position.toArray(), recordId);
  await press(recordId);
  await page.waitForTimeout(6000);
  const now = await page.evaluate((r) => window.__debug.registry.get(r).object3D.position.toArray(), recordId);
  const moved = Math.hypot(now[0] - start[0], now[2] - start[2]);
  check(`${id}: its starter program moves it and keeps it near`, moved > 0.1 && moved < reach, `${moved.toFixed(2)}ft from start`);
  await page.evaluate((r) => window.__debug.programManager.stop(r), recordId);
}
{
  const recordId = await place('draft-horse', { x: 0, z: 150, yaw: 0 });
  await press(recordId);
  await page.waitForTimeout(3000);
  check('draft-horse: its program is running', await page.evaluate((r) => window.__debug.programManager.isRunning(r), recordId));
  await page.evaluate((r) => window.__debug.programManager.stop(r), recordId);
}
await page.evaluate(() => window.__debug.menuActions.loadPreset('empty'));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__debug.cinema?.release?.());

// --- activity 5: from field to loaf, exactly as printed ----------------------------------
const ids = {};
for (const id of ['wheat-plot', 'grain-windmill', 'village-bakery', 'market-stall']) ids[id] = await place(id, { x: 0, z: 150, yaw: 0 });
const said = await page.evaluate(async (ids) => {
  const d = window.__debug;
  const block = (type, params = {}, children) => {
    const b = { id: crypto.randomUUID(), type, params };
    if (children) b.children = children;
    return b;
  };
  const relay = (hear, sayText) => [block('whenSaid', { text: hear }, [block('wait', { seconds: 2 }), block('say', { text: sayText })])];
  const set = (id, program) => {
    const item = d.registry.get(id);
    item.record.program = program;
    delete item.record.programIdle;
    d.programManager.startFromRecord(id, item.record, item.object3D);
  };
  const heard = [];
  const original = d.programManager.broadcast.bind(d.programManager);
  d.programManager.broadcast = (text, from) => { heard.push(text); return original(text, from); };
  set(ids['grain-windmill'], relay('wheat is ready', 'flour is ready'));
  set(ids['village-bakery'], relay('flour is ready', 'bread is ready'));
  set(ids['market-stall'], relay('bread is ready', 'Fresh bread for sale!'));
  set(ids['wheat-plot'], [block('wait', { seconds: 2 }), block('say', { text: 'wheat is ready' })]);
  await new Promise((r) => setTimeout(r, 11000));
  d.programManager.broadcast = original;
  return heard;
}, ids);
check('the chain runs in order, across four objects', said.join('|') === 'wheat is ready|flour is ready|bread is ready|Fresh bread for sale!', said.join(' > '));

// --- activity 6: the school bell at dawn ------------------------------------------------
{
  const recordId = await place('schoolhouse', { x: 0, z: 150, yaw: 0 });
  const heard = await page.evaluate(async (id) => {
    const d = window.__debug;
    const block = (type, params = {}, children) => {
      const b = { id: crypto.randomUUID(), type, params };
      if (children) b.children = children;
      return b;
    };
    const item = d.registry.get(id);
    item.record.program = [block('whenWorld', { event: 'sunrise' }, [block('say', { text: 'Time for school!' })])];
    delete item.record.programIdle;
    d.programManager.startFromRecord(id, item.record, item.object3D);
    const out = [];
    const original = d.programManager.broadcast.bind(d.programManager);
    d.programManager.broadcast = (text, from) => { out.push(text); return original(text, from); };
    await d.menuActions.sunPhase(0.0);
    await new Promise((r) => setTimeout(r, 300));
    await d.menuActions.sunPhase(0.4);
    await new Promise((r) => setTimeout(r, 1500));
    d.programManager.broadcast = original;
    return out;
  }, recordId);
  check('sliding the time of day from night to morning rings the bell', heard.includes('Time for school!'), heard.join(' > '));
}
await page.evaluate(() => window.__debug.menuActions.sunPhase(null));

// --- a whole village, measured ----------------------------------------------------------
await page.evaluate(() => window.__debug.menuActions.loadPreset('empty'));
await page.waitForTimeout(1500);
await page.evaluate(() => window.__debug.cinema?.release?.());
for (const m of kit) {
  await place(m.id, { x: 0, z: 150, yaw: 0 });
}
await page.waitForTimeout(1500);
await page.evaluate(() => window.__debug.player.resetTo({ x: 0, z: 170, yaw: 0 }));
await page.waitForTimeout(1500);
const cost = await page.evaluate(() => {
  const d = window.__debug;
  const info = d.renderer?.info;
  const meshes = (() => { let n = 0; d.scene.traverse((o) => { if (o.isMesh) n += 1; }); return n; })();
  const geometry = [...d.registry.items.values()].filter((i) => i.record?.kind === 'catalog-model').reduce((sum, i) => {
    let t = 0;
    i.object3D.traverse((o) => { if (o.isMesh && o.geometry) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return sum + t;
  }, 0);
  // Texture memory comes out of a Chromebook's system RAM, so add up what this village allocated:
  // width x height x 4 bytes, and a third again for the mipmaps.
  const seen = new Set();
  let textureBytes = 0;
  for (const item of d.registry.items.values()) {
    if (item.record?.kind !== 'catalog-model') continue;
    item.object3D.traverse((o) => {
      if (!o.isMesh) return;
      for (const material of [].concat(o.material)) {
        for (const key of ['map', 'bumpMap', 'emissiveMap', 'normalMap', 'alphaMap', 'roughnessMap']) {
          const texture = material?.[key];
          const image = texture?.image;
          if (!image || seen.has(texture.uuid)) continue;
          seen.add(texture.uuid);
          textureBytes += (image.width || 0) * (image.height || 0) * 4 * 4 / 3;
        }
      }
    });
  }
  return { calls: info?.render?.calls, drawn: info?.render?.triangles, meshes, geometry: Math.round(geometry), records: d.registry.count, textures: seen.size, textureMB: Math.round(textureBytes / 1048576) };
});
console.log('one of each piece in My World:', JSON.stringify(cost));
check('one of each piece fits inside the 750k meter', cost.geometry < 750000, `${Math.round(cost.geometry / 1000)}k`);
await page.screenshot({ path: resolve(SHOTS, 'village-one-of-each.jpg'), quality: 82, type: 'jpeg' });

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
