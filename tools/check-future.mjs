// Runs the Build a Future City activities in the real app, so that what docs/guide/futurecity.html
// tells a student to do is something a tool has done. Needs a dev server: `npx vite --port 5199`, or
// APP_URL=http://localhost:5183/ for HiFi.
//
//   node tools/check-future.mjs            the checks
//   node tools/check-future.mjs --shots    and also lay out a small future city and photograph it
//                                          for the activities page (docs/guide/shots/future_*.jpg)
//
// It builds one of every piece too and prints what that costs, because a kit a child is invited to
// place dozens of times has to be measured as a city and not one model at a time.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { MODELS } from '../src/models/catalog.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = resolve(ROOT, 'scratch/future');
const PAGE_SHOTS = resolve(ROOT, 'docs/guide/shots');
const TAKE_SHOTS = process.argv.includes('--shots');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const kit = MODELS.filter((m) => m.category === 'futurecity');
check('the kit has 30 pieces, every one squared to the grid', kit.length === 30 && kit.every((m) => !!m.grid));
check('the pieces that tile are row pieces', ['smart-road', 'maglev-track', 'hyperloop-tube'].every((id) => kit.find((m) => m.id === id).grid === 'row'));
// The pieces whose technology does not exist yet must say so on their card. The rest (a maglev, an
// airship, a rain garden) are real today and only arranged in a future city.
const NOT_YET = ['vertical-farm-tower', 'forest-tower', 'solar-skyscraper', 'future-school', 'fusion-power-plant', 'spaceport-pad', 'hyperloop-station', 'hover-scooter', 'drone-port', 'air-cleaning-tower', 'hologram-kiosk'];
const said = (id) => { const m = kit.find((k) => k.id === id); return /imagined/i.test(`${m.blurb} ${m.realSize} ${m.facts.join(' ')}`); };
const unsaid = NOT_YET.filter((id) => !said(id));
check('every piece that cannot be built yet says it is imagined', unsaid.length === 0, unsaid.join(', '));

const playwright = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await playwright.chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|favicon|ERR_|fonts\.g/.test(m.text())) errors.push(m.text()); });
await page.goto(APP_URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__debug?.registry?.count > 0, null, { timeout: 180000 });
if (await page.evaluate(() => !!window.__debug?.bscene)) await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });

const empty = async () => {
  await page.evaluate(async () => {
    const d = window.__debug;
    d.cinema?.release?.();
    await d.menuActions.loadPreset('empty');
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__debug.cinema?.release?.());
};
await empty();

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
const positionsOf = (m) => page.evaluate((id) => [...window.__debug.registry.items.values()].filter((i) => i.record?.model === id).map((i) => ({ p: i.object3D.position.toArray(), r: i.object3D.rotation.y, program: !!i.record.program })), m);
const positionOf = (recordId) => page.evaluate((r) => window.__debug.registry.get(r).object3D.position.toArray(), recordId);
const press = (id) => page.evaluate((recordId) => {
  const { registry, programManager } = window.__debug;
  const item = registry.get(recordId);
  programManager.startFromRecord(recordId, item.record, item.object3D);
}, id);
const stop = (id) => page.evaluate((r) => window.__debug.programManager.stop(r), id);

// The heights of every group in a model. The spaceport's rocket is an inner group that its own tick
// lifts, so the largest rise among them is its flight, with no box arithmetic.
const groupHeights = (recordId) => page.evaluate((r) => {
  const out = [];
  window.__debug.registry.get(r).object3D.traverse((o) => { if (!o.isMesh) out.push(o.position.y); });
  return out;
}, recordId);

// --- rows --------------------------------------------------------------------------------
for (const [id, step] of [['smart-road', 20], ['maglev-track', 40], ['hyperloop-tube', 40]]) {
  const recordId = await place(id, { x: -60, z: 140, yaw: 0 });
  await press(recordId);
  await page.waitForTimeout(1800);
  const row = (await positionsOf(id)).sort((a, b) => a.p[0] - b.p[0]);
  const xs = row.map((r) => r.p[0]);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  check(`${id}: the arrow lays a straight row ${step}ft apart`, row.length === 4 && gaps.every((g) => Math.abs(g - step) < 1e-6) && row.every((r) => Math.abs(r.p[2] - row[0].p[2]) < 1e-6), `${row.length} at gaps ${gaps.join()}`);
  check(`${id}: copies do not carry a program, so a row does not breed`, row.filter((r) => r.program).length === 1);
  await empty();
}

// --- the vehicles move as their cards say --------------------------------------------------
for (const [id, wait, min, max] of [
  ['self-driving-pod', 9000, 100, 125], ['robo-bus', 4500, 35, 45], ['maglev-train', 4600, 70, 85],
  ['delivery-drone', 5500, 40, 55], ['helper-robot', 2700, 10, 16], ['hover-scooter', 2700, 10, 16],
  ['sweeper-robot', 4300, 15, 21], ['cargo-airship', 4000, 3, 60],
]) {
  const recordId = await place(id, { x: 0, z: 150, yaw: 0 });
  const start = await positionOf(recordId);
  await press(recordId);
  await page.waitForTimeout(wait);
  const now = await positionOf(recordId);
  const moved = Math.hypot(now[0] - start[0], now[2] - start[2]);
  check(`${id}: its starter program moves it about as far as the card says`, moved > min && moved < max, `${moved.toFixed(1)}ft in ${wait / 1000}s`);
  await stop(recordId);
}
{
  const recordId = await place('air-taxi', { x: 0, z: 150, yaw: 0 });
  const start = await positionOf(recordId);
  await press(recordId);
  await page.waitForTimeout(1800);
  const now = await positionOf(recordId);
  check('air-taxi: it takes off straight up first', now[1] - start[1] > 20, `${(now[1] - start[1]).toFixed(1)}ft up`);
  await stop(recordId);
}
for (const id of ['delivery-drone', 'cargo-airship', 'hover-scooter', 'maglev-train']) {
  const recordId = await place(id, { x: 40, z: 150, yaw: 0 });
  const entry = MODELS.find((m) => m.id === id);
  const y = await page.evaluate((r) => {
    const d = window.__debug;
    const o = d.registry.get(r).object3D;
    return o.position.y - d.player.groundHeightAt(o.position.x, o.position.z);
  }, recordId);
  check(`${id}: arrives ${entry.hover}ft above the ground`, Math.abs(y - entry.hover) < 0.01, `${y.toFixed(2)}ft`);
}
await empty();

// --- activity 4: the spaceport reads its own height -----------------------------------------
{
  const recordId = await place('spaceport-pad', { x: 0, z: 150, yaw: 0 });
  const base = await groupHeights(recordId);
  await press(recordId);
  let rise = 0;
  for (let i = 0; i < 28; i++) {
    await page.waitForTimeout(350);
    const now = await groupHeights(recordId);
    rise = Math.max(rise, ...now.map((y, k) => y - base[k]));
  }
  check('the spaceport’s rocket climbs the 60 feet its program says', Math.abs(rise - 60) < 0.5, `${rise.toFixed(1)}ft`);
  await stop(recordId);
  await page.waitForTimeout(1500);
}
await empty();

// --- activity 6: the kiosk's welcome --------------------------------------------------------
{
  const recordId = await place('hologram-kiosk', { x: 0, z: 150, yaw: 0 });
  const heard = await page.evaluate(async (id) => {
    const d = window.__debug;
    const block = (type, params = {}, children) => {
      const b = { id: crypto.randomUUID(), type, params };
      if (children) b.children = children;
      return b;
    };
    const item = d.registry.get(id);
    item.record.program = [block('whenWorld', { event: 'start' }, [block('say', { text: 'Welcome to our city of the future!' })])];
    delete item.record.programIdle;
    d.programManager.startFromRecord(id, item.record, item.object3D);
    const out = [];
    const original = d.programManager.broadcast.bind(d.programManager);
    d.programManager.broadcast = (text, from) => { out.push(text); return original(text, from); };
    d.programManager.broadcast('start');
    await new Promise((r) => setTimeout(r, 1500));
    d.programManager.broadcast = original;
    return out;
  }, recordId);
  check('opening the world makes the kiosk say its welcome', heard.includes('Welcome to our city of the future!'), heard.join(' > '));
}
await empty();

// --- one of every piece, measured --------------------------------------------------------
for (const m of kit) await place(m.id, { x: 0, z: 150, yaw: 0 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__debug.player.resetTo({ x: 0, z: 170, yaw: 0 }));
await page.waitForTimeout(1500);
const cost = await page.evaluate(() => {
  const d = window.__debug;
  const info = d.renderer?.info;
  const geometry = [...d.registry.items.values()].filter((i) => i.record?.kind === 'catalog-model').reduce((sum, i) => {
    let t = 0;
    i.object3D.traverse((o) => { if (o.isMesh && o.geometry) t += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    return sum + t;
  }, 0);
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
  return { calls: info?.render?.calls, drawn: info?.render?.triangles, geometry: Math.round(geometry), records: d.registry.count, textures: seen.size, textureMB: Math.round(textureBytes / 1048576) };
});
console.log('one of each future piece in My World:', JSON.stringify(cost));
check('one of each piece fits inside the 750k meter', cost.geometry < 750000, `${Math.round(cost.geometry / 1000)}k`);
await page.screenshot({ path: resolve(SHOTS, 'city-one-of-each.jpg'), quality: 82, type: 'jpeg' });

// --- a small future city for the activities page ------------------------------------------
if (TAKE_SHOTS) {
  await empty();
  const city = await page.evaluate(async () => {
    const d = window.__debug;
    const placed = [];
    for (const [id, item] of [...d.registry.items]) {
      if (item.record?.kind !== 'world-theme' && item.record?.kind !== 'world-spawn') d.registry.remove(id);
    }
    const { seatHeight } = await import('/src/models/index.js');
    const { MODEL_BY_ID } = await import('/src/models/catalog.js');
    const ground = (x, z) => d.player.groundHeightAt(x, z);
    const put = async (model, x, z, rot = 0, lift = null) => {
      const record = { id: crypto.randomUUID(), kind: 'catalog-model', createdAt: Date.now(), model, connections: [], transform: { position: [x, ground(x, z), z], rotation: [0, rot, 0], scale: [1, 1, 1] } };
      await d.worldStore.rehydrateOne(record);
      const object3D = d.registry.get(record.id).object3D;
      object3D.position.y = lift === null ? seatHeight(MODEL_BY_ID.get(model), object3D, x, z, rot, ground) : ground(x, z) + lift;
      record.transform.position[1] = object3D.position.y;
      placed.push(record.id);
      return record.id;
    };
    const N = Math.PI;
    await put('smart-intersection', 0, -60);
    for (const x of [-90, -70, -50, -30, 30, 50, 70, 90]) await put('smart-road', x, -60);
    for (const z of [-150, -130, -110, -90, -30, -10, 10]) await put('smart-road', 0, z, Math.PI / 2);
    // North side, fronts facing the street.
    await put('vertical-farm-tower', 40, -105);
    await put('solar-skyscraper', 90, -105);
    await put('forest-tower', -45, -105);
    await put('future-school', -110, -115);
    // South side, facing north.
    await put('biodome-garden', 40, -20, N);
    await put('printed-dome-home', 85, -30, N);
    await put('rain-garden-plaza', -40, -20, N);
    await put('ev-charging-hub', -95, -32, N);
    // Further out.
    for (const x of [-60, -20, 20, 60, 100]) await put('maglev-track', x, 60);
    await put('maglev-train', 20, 60, Math.PI / 2, 3.2);
    await put('fusion-power-plant', 80, 120, N);
    const pad = await put('spaceport-pad', -95, 30, N);
    const { STARTER_PROGRAMS } = await import('/src/models/programs.js');
    d.registry.get(pad).record.program = STARTER_PROGRAMS.rocketLaunch();
    // Street things.
    await put('wind-tree', 30, -86);
    await put('hologram-kiosk', 60, -84);
    await put('air-cleaning-tower', -75, -88);
    await put('robo-bus', 40, -54, Math.PI / 2);
    await put('self-driving-pod', -50, -66, -Math.PI / 2);
    await put('helper-robot', 75, -82, -Math.PI / 2);
    await put('delivery-drone', 20, -40, 0, 14);
    await put('air-taxi', -20, -120, 0, 26);
    await put('cargo-airship', 70, 110, Math.PI / 2, 70);
    return { count: placed.length, pad };
  });
  console.log(`laid out a future city of ${city.count} pieces`);
  await page.addStyleTag({ content: '#menu, #touch-nav, #toast-host, #object-menu, .cinema-chip, #model-meter { display: none !important; }' });
  await page.evaluate(() => {
    const d = window.__debug;
    d.constructionManager.tick = () => {};
    d.playIconManager.tick = () => {};
    d.scene.traverse((o) => { if (o.isSprite) o.visible = false; });
  });
  const shoot = async (name, { x, z, yaw, pitch, eye }, wait = 2500) => {
    await page.evaluate(({ x, z, yaw, pitch, eye }) => {
      const d = window.__debug;
      d.player.setEyeHeight(eye);
      d.player.resetTo({ x, z, yaw, pitch });
    }, { x, z, yaw, pitch, eye });
    await page.waitForTimeout(wait);
    mkdirSync(PAGE_SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(PAGE_SHOTS, name), quality: 80, type: 'jpeg' });
    console.log(`wrote docs/guide/shots/${name}`);
  };
  await shoot('future_overview.jpg', { x: -160, z: -40, yaw: -Math.PI / 2 - 0.12, pitch: -0.36, eye: 60 });
  await shoot('future_street.jpg', { x: 100, z: -52, yaw: Math.PI / 2 - 0.25, pitch: 0.06, eye: 5 });
  await press(city.pad);
  await shoot('future_spaceport.jpg', { x: -75, z: 168, yaw: -0.14, pitch: 0.3, eye: 25 }, 6200);
  await page.evaluate(() => window.__debug.player.setEyeHeight(5));
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
