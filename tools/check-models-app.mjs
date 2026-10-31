// End-to-end check of the Model Database, in the real app through the real DOM.
//
//   npx vite --port 5199 --strictPort              (in another terminal)
//   node tools/check-models-app.mjs                the main app at :5199
//   APP_URL=http://localhost:5183/ node tools/check-models-app.mjs   HiFi's dev server
//
// It drives what a student does: open the menu, search, place, click the hammer, stretch, then
// refresh, export, reload, duplicate and render. Clicks are real pointer events at real screen
// positions, because this project has twice found a bug that calling an internal method
// directly could not see. Screenshots land in scratch/model-app/.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = resolve(ROOT, 'scratch/model-app');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const near = (a, b, eps = 0.02) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

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
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|ERR_|fonts\.g/.test(m.text())) errors.push(m.text()); });

const records = (kind) => page.evaluate((k) => [...window.__debug.registry.items.values()]
  .map((i) => i.record).filter((r) => r?.kind === k).map((r) => JSON.parse(JSON.stringify(r))), kind);
const screen = (name) => page.screenshot({ path: resolve(SHOTS, `${name}.jpg`), quality: 82, type: 'jpeg' });

async function boot() {
  await page.waitForFunction(() => window.__debug?.registry?.count > 0, null, { timeout: 180000 });
  // HiFi covers the canvas with its loading screen until the world is ready, and a click on
  // that is not a click on the world.
  if (await page.evaluate(() => !!window.__debug?.bscene)) {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  }
  await page.waitForTimeout(1500);
}
await page.goto(APP_URL, { waitUntil: 'load' });
await boot();
// Stop the arrival swoop and anything else holding the camera, so clicks land where we aim.
await page.evaluate(() => window.__debug.cinema?.release?.());

// Screen position of a world point, for a real click on it.
const project = (point) => page.evaluate((p) => {
  const { THREE, camera } = window.__debug;
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(...p).project(camera);
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}, point);
// A refresh puts the player back at the default spot, so walk them to the object first.
async function faceObject(id) {
  await page.evaluate((recordId) => {
    const { player, registry, cinema } = window.__debug;
    cinema?.release?.();
    const { x, z } = registry.get(recordId).object3D.position;
    player.resetTo({ x, z: z + 18, yaw: 0 });
  }, id);
  await page.waitForTimeout(250);
}
async function clickHammer(id) {
  await faceObject(id);
  const at = await page.evaluate((recordId) => {
    const sprite = window.__debug.constructionManager.icons.get(recordId);
    return sprite ? sprite.position.toArray() : null;
  }, id);
  const { x, y } = await project(at);
  await page.mouse.click(x, y);
  await page.waitForTimeout(150);
}
const menuButton = (name) => page.locator('#primitive-menu button', { hasText: name });

// --- find it ------------------------------------------------------------------------
await page.click('#menu-toggle');
await page.click('.menu-btn-models');
check('the menu row opens the panel', await page.locator('#modeldb-overlay').isVisible());
check('the panel lists fifty models', (await page.locator('.mdb-card').count()) === 50, String(await page.locator('.mdb-card').count()));
check('there are eight types plus All', (await page.locator('.mdb-rail-btn').count()) === 9);
await screen('01-panel');

await page.fill('.mdb-search', 'mitochondria');
check('search finds a model by what is inside it', (await page.locator('.mdb-card-title').first().textContent()) === 'Animal Cell');
await page.fill('.mdb-search', 'xyzzy');
check('a search with no match says so', await page.locator('.mdb-empty').isVisible());
await page.fill('.mdb-search', 'rex');
check('search matches inside a title', (await page.locator('.mdb-card-title').first().textContent()) === 'Tyrannosaurus rex');

await page.fill('.mdb-search', '');
await page.locator('.mdb-rail-btn', { hasText: 'Landmarks' }).click();
check('a type tab filters the cards', (await page.locator('.mdb-card').count()) === 7);
await page.locator('.mdb-rail-btn', { hasText: 'All models' }).click();
await page.selectOption('.mdb-grade select', '6-8');
const sixToEight = await page.locator('.mdb-card').count();
await page.selectOption('.mdb-grade select', 'K-2');
const kToTwo = await page.locator('.mdb-card').count();
check('the grade filter narrows them', kToTwo > 0 && kToTwo < sixToEight, `K-2 ${kToTwo}, 6-8 ${sixToEight}`);
await page.selectOption('.mdb-grade select', 'all');
await page.keyboard.press('Escape');
check('Escape closes the panel', !(await page.locator('#modeldb-overlay').isVisible()));
await page.click('#menu-toggle');
await page.click('.menu-btn-models');
await page.fill('.mdb-search', 'rex');

// Arrow keys must not walk the student around behind an open panel.
const before = await page.evaluate(() => window.__debug.camera.position.toArray());
await page.keyboard.press('Tab');
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(350);
await page.keyboard.up('ArrowUp');
check('arrow keys do not move the player behind the panel', near(before, await page.evaluate(() => window.__debug.camera.position.toArray()), 0.001));

// --- place it -----------------------------------------------------------------------
await page.fill('.mdb-search', 'heart');
await page.click('.mdb-card-open');
await page.waitForTimeout(500);
check('a card opens its details', await page.locator('.mdb-detail').isVisible());
await screen('02-detail');
const tris0 = await page.evaluate(() => window.__debug.registry.count);
await page.click('.mdb-place-big');
await page.waitForFunction(() => document.querySelector('#modeldb-overlay').hidden, null, { timeout: 30000 });
await page.waitForTimeout(800);
check('placing adds one object', (await page.evaluate(() => window.__debug.registry.count)) === tris0 + 1);
const [heart] = await records('catalog-model');
check('the record stores an id, not geometry', heart.model === 'human-heart' && !heart.files);
check('the record is tiny', JSON.stringify(heart).length < 400, `${JSON.stringify(heart).length} bytes`);
const inFrame = await page.evaluate((p) => {
  const { THREE, camera } = window.__debug;
  const v = new THREE.Vector3(...p).project(camera);
  return Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1;
}, heart.transform.position);
check('it arrives in the frame', inFrame);
await screen('03-placed');

// --- a big model must land where it can be seen ---------------------------------------
//
// A toast saying "placed" over a view with nothing new in it is the failure here, and it reached
// the live site: the small heart above always fits, while in a populated world the nearest empty
// ground for anything big was 120ft off behind a building. Nine sample points on each model, in
// the frame and with a clear ray from the eye, and at least five must be seen.
const hidden = await page.evaluate(async () => {
  const d = window.__debug;
  const T = d.THREE;
  const ray = new T.Raycaster();
  const problems = [];
  d.camera.updateMatrixWorld();
  for (const id of ['parthenon', 'medieval-castle', 'lunar-module', 'cutaway-volcano', 'taj-mahal', 'viking-longship', 'pyramid-of-giza', 'statue-of-liberty']) {
    await d.modelDatabase.place(id);
    await new Promise((r) => setTimeout(r, 40));
    const item = [...d.registry.items.values()].filter((i) => i.record?.model === id).pop();
    item.object3D.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(item.object3D);
    const c = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3());
    const others = [...d.registry.items.values()].filter((i) => i !== item && i.object3D && !['world-theme', 'world-spawn'].includes(i.record?.kind)).map((i) => i.object3D);
    ray.camera = d.camera;
    let seen = 0;
    for (const fy of [0.2, 0.5, 0.8]) {
      for (const fx of [-0.35, 0, 0.35]) {
        const point = new T.Vector3(c.x + size.x * fx, box.min.y + size.y * fy, c.z + size.z * fx * 0.3);
        const v = point.clone().project(d.camera);
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || v.z >= 1) continue;
        const dir = point.clone().sub(d.camera.position);
        ray.far = dir.length();
        ray.set(d.camera.position, dir.normalize());
        const near = others.filter((o) => ray.ray.intersectsBox(new T.Box3().setFromObject(o)));
        if (!ray.intersectObjects(near, true).some((h) => h.object.isMesh)) seen += 1;
      }
    }
    if (seen < 5) problems.push(`${id} ${seen}/9`);
    d.registry.remove(item.record.id);
    await d.worldStore.deleteObject(item.record.id);
  }
  return problems;
});
check('big models land where the student can see them', hidden.length === 0, hidden.join(', '));

// --- the hammer tools -----------------------------------------------------------------
await clickHammer(heart.id);
check('its hammer opens the build menu', await page.locator('#primitive-menu').isVisible());
check('the build menu names it', (await page.locator('#primitive-menu .om-title').textContent()).includes('Human Heart'));
await screen('04-hammer');
await menuButton('Stretch to Shape').click();
await page.waitForTimeout(250);
const corner = await page.evaluate(() => {
  const g = window.__debug.buildGizmo;
  const handles = g.handles ?? [];
  const top = handles.map((h) => h.getWorldPosition(new window.__debug.THREE.Vector3())).sort((a, b) => b.y - a.y)[0];
  return top ? top.toArray() : null;
});
check('the stretch gizmo is up', !!corner);
const scale0 = (await records('catalog-model'))[0].transform.scale;
const start = await project(corner);
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(start.x + 40, start.y - 50, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const scale1 = (await records('catalog-model'))[0].transform.scale;
check('dragging a corner stretches it', !near(scale0, scale1), `${scale0} -> ${scale1}`);
check('the stretch is not uniform', Math.abs(scale1[0] - scale1[1]) > 0.005 || Math.abs(scale1[1] - scale1[2]) > 0.005);
await screen('05-stretched');
await page.locator('.stretch-done-chip').click();
await page.waitForTimeout(150);

// --- it survives everything a record goes through ---------------------------------------
await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
await page.reload({ waitUntil: 'load' });
await boot();
// Records rehydrate one after another, and a custom-built model's chunk loads on demand.
await page.waitForFunction(() => [...window.__debug.registry.items.values()].some((i) => i.record?.kind === 'catalog-model'), null, { timeout: 60000 });
await page.evaluate(() => window.__debug.cinema?.release?.());
const [afterReload] = await records('catalog-model');
check('it comes back after a refresh', !!afterReload && afterReload.model === 'human-heart');
check('its stretch comes back too', afterReload && near(afterReload.transform.scale, scale1, 0.001));
const live = await page.evaluate((id) => window.__debug.registry.get(id).object3D.scale.toArray(), afterReload.id);
check('the rebuilt object wears that stretch', near(live, scale1, 0.001));

await clickHammer(afterReload.id);
await menuButton('Reset Shape').click();
await page.waitForTimeout(150);
const [reset] = await records('catalog-model');
check('Reset Shape restores the catalogue size', near(reset.transform.scale, [1, 1, 1], 0.001));

// A world file round trip.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.evaluate(() => window.__debug.menuActions?.saveWorld?.() ?? window.__debug.saveWorldForTest?.()),
]).catch(() => [null]);
if (download) {
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  const world = JSON.parse(text);
  const list = world.records ?? world.objects ?? world;
  check('the world file carries the model', list.some((r) => r.kind === 'catalog-model' && r.model === 'human-heart'));
  await page.setInputFiles('input[type=file][accept=".json"]', path);
  await page.waitForFunction(() => [...window.__debug.registry.items.values()].some((i) => i.record?.kind === 'catalog-model'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check('it comes back from a world file', (await records('catalog-model')).length === 1);
} else {
  check('the world file exports', false, 'no download event');
}

// --- the About screen and its sign --------------------------------------------------------
const aboutTarget = (await records('catalog-model'))[0];
await faceObject(aboutTarget.id);
const bodyPoint = await page.evaluate((id) => {
  const { registry, THREE } = window.__debug;
  const c = new THREE.Box3().setFromObject(registry.get(id).object3D).getCenter(new THREE.Vector3());
  return [c.x, c.y + 1.5, c.z + 1];
}, aboutTarget.id);
const bodyAt = await project(bodyPoint);
await page.mouse.click(bodyAt.x, bodyAt.y);
await page.waitForTimeout(250);
await page.locator('#object-menu button', { hasText: 'About this model' }).click();
check('clicking the model offers its facts', (await page.locator('#object-menu .mdb-about-facts li').count()) >= 2);
const signsBefore = (await records('preset-prop')).filter((r) => r.prop === 'info-placard').length;
await page.locator('#object-menu button', { hasText: 'Place an Info Sign' }).click();
await page.waitForTimeout(600);
const signsAfter = (await records('preset-prop')).filter((r) => r.prop === 'info-placard').length;
check('Place an Info Sign stands a sign beside it', signsAfter === signsBefore + 1, `${signsBefore} -> ${signsAfter}`);
await screen('055-sign');
await page.mouse.click(5, 400);

// --- render a mixed cluster ------------------------------------------------------------
const catalogId = (await records('catalog-model'))[0].id;
await page.click('#menu-toggle');
await page.locator('.menu-btn', { hasText: 'Create Model' }).click();
await page.locator('.menu-subitem', { hasText: 'Cube' }).click();
await page.waitForTimeout(400);
await page.click('#menu-toggle');
const [cube] = await records('primitive');
await page.evaluate(({ cubeId, modelId }) => {
  const { registry, worldStore } = window.__debug;
  const model = registry.get(modelId).object3D;
  const c = registry.get(cubeId);
  c.object3D.position.copy(model.position).add({ x: 0, y: 1, z: 0 });
  c.record.transform.position = c.object3D.position.toArray();
  c.record.connections = [modelId];
  worldStore.saveObject(c.record);
}, { cubeId: cube.id, modelId: catalogId });
await page.waitForTimeout(200);
await clickHammer(cube.id);
await menuButton('Render Model').click();
await page.waitForTimeout(1500);
const built = await records('built-model');
check('a model and a cube render into one object', built.length === 1 && (await records('catalog-model')).length === 0);
const part = built[0]?.parts?.find((p) => p.kind === 'catalog-model');
check('the rendered model keeps the catalogue part', part?.model === 'human-heart');
const partMeshes = await page.evaluate((id) => {
  const o = window.__debug.registry.get(id).object3D;
  return o.children.map((c) => c.userData.catalogModel ?? 'shape');
}, built[0]?.id);
check('and does not turn it into a yellow cube', partMeshes.includes('human-heart'), partMeshes.join(','));
await screen('06-rendered');

// --- a lazy-chunk model, its starter program and the duplicate path ---------------------
await page.click('#menu-toggle');
await page.click('.menu-btn-models');
await page.fill('.mdb-search', 'robot');
await page.locator('.mdb-card-place').first().click();
await page.waitForFunction(() => document.querySelector('#modeldb-overlay').hidden, null, { timeout: 30000 });
await page.waitForTimeout(500);
const robot = (await records('catalog-model')).find((r) => r.model === 'classroom-robot');
check('a model with a starter program places it idle', !!robot?.program?.length && robot.programIdle === true);
const running = await page.evaluate((id) => window.__debug.programManager.isRunning(id), robot.id);
check('and it does not start by itself', !running);

const copies = await page.evaluate(async (id) => {
  const d = window.__debug;
  d.programManager.onDuplicate(id, 8);
  await new Promise((r) => setTimeout(r, 1500));
  return [...d.registry.items.values()].filter((i) => i.record?.kind === 'catalog-model' && i.record.model === 'classroom-robot').length;
}, robot.id);
check('the duplicate path copies a model', copies === 2, String(copies));

// The green arrow runs the starter program.
await faceObject(robot.id);
const start0 = await page.evaluate((id) => window.__debug.registry.get(id).object3D.position.toArray(), robot.id);
const iconAt = await page.evaluate((id) => {
  const icon = window.__debug.playIconManager.icons.get(id);
  return icon ? (icon.position ?? icon.sprite?.position).toArray() : null;
}, robot.id);
const iconScreen = await project(iconAt);
await page.mouse.click(iconScreen.x, iconScreen.y);
await page.waitForTimeout(1600);
check('its green arrow starts the program', await page.evaluate((id) => window.__debug.programManager.isRunning(id), robot.id));
const start1 = await page.evaluate((id) => window.__debug.registry.get(id).object3D.position.toArray(), robot.id);
check('and the model moves', !near(start0, start1, 0.05), `${start0.map((v) => v.toFixed(1))} -> ${start1.map((v) => v.toFixed(1))}`);

// Errors the app raised while all that was happening.
check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
