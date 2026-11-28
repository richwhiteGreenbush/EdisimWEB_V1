// Runs the Build a City activities in the real app, so that what docs/guide/city.html tells a student
// to do is something a tool has done. Needs a dev server: `npx vite --port 5199`, or
// APP_URL=http://localhost:5183/ for HiFi.
//
//   node tools/check-city.mjs            the checks
//   node tools/check-city.mjs --shots    and also lay out a small city and photograph it for the
//                                        activities page (docs/guide/shots/city_*.jpg)
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
const SHOTS = resolve(ROOT, 'scratch/city');
const PAGE_SHOTS = resolve(ROOT, 'docs/guide/shots');
const TAKE_SHOTS = process.argv.includes('--shots');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const kit = MODELS.filter((m) => m.category === 'citykit');
check('the kit has 30 pieces, every one squared to the grid', kit.length === 30 && kit.every((m) => !!m.grid));
check('the pieces that tile are row pieces', ['road-straight', 'row-house'].every((id) => kit.find((m) => m.id === id).grid === 'row'));

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

// --- squares up ----------------------------------------------------------------------
const quarter = Math.PI / 2;
for (const yaw of [0, 0.7, 2.2, -1.1]) {
  const id = await place('fire-station', { x: 0, z: 150, yaw });
  const rot = await page.evaluate((recordId) => window.__debug.registry.get(recordId).object3D.rotation.y, id);
  const off = Math.abs(rot / quarter - Math.round(rot / quarter));
  check(`a building placed while facing ${yaw} lands on a quarter turn`, off < 1e-6, `rotation ${rot.toFixed(3)}`);
  await page.evaluate((recordId) => { const d = window.__debug; d.registry.remove(recordId); d.worldStore.deleteObject(recordId); }, id);
}
await empty();

// --- activity 1 and 2: rows ------------------------------------------------------------
for (const id of ['road-straight', 'row-house']) {
  for (const yaw of [0, Math.PI / 2]) {
    const recordId = await place(id, { x: -60, z: 140, yaw });
    await press(recordId);
    await page.waitForTimeout(1800);
    const row = (await positionsOf(id)).sort((a, b) => a.p[0] - b.p[0]);
    const xs = row.map((r) => r.p[0]);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    check(`${id} (placed facing ${yaw.toFixed(2)}): the arrow lays a straight row 20ft apart`, row.length === 4 && gaps.every((g) => Math.abs(g - 20) < 1e-6) && row.every((r) => Math.abs(r.p[2] - row[0].p[2]) < 1e-6) && row.every((r) => Math.abs(Math.sin(r.r)) < 1e-6), `${row.length} at gaps ${gaps.join()}`);
    check(`${id}: copies do not carry a program, so a row does not breed`, row.filter((r) => r.program).length === 1);
    await empty();
  }
}

// --- activity 3 and 5: vehicles move as their cards say -----------------------------------
for (const [id, wait, min, max] of [
  ['fire-engine', 9000, 100, 125], ['police-car', 9000, 100, 125], ['city-ambulance', 9000, 100, 125], ['city-taxi', 9000, 100, 125],
  ['city-bus', 4500, 35, 45], ['school-bus', 4500, 35, 45], ['garbage-truck', 2400, 17, 23], ['delivery-truck', 2400, 17, 23],
]) {
  const recordId = await place(id, { x: 0, z: 150, yaw: 0 });
  const start = await positionOf(recordId);
  await press(recordId);
  await page.waitForTimeout(wait);
  const now = await positionOf(recordId);
  const moved = Math.hypot(now[0] - start[0], now[2] - start[2]);
  check(`${id}: its starter program drives it about as far as the card says`, moved > min && moved < max, `${moved.toFixed(1)}ft in ${wait / 1000}s`);
  await stop(recordId);
}
await empty();

// --- activity 4: the traffic light reads its own numbers -----------------------------------
{
  const recordId = await place('traffic-light', { x: 0, z: 150, yaw: 0 });
  const lit = () => page.evaluate((r) => {
    const out = [];
    window.__debug.registry.get(r).object3D.traverse((o) => { if (o.isMesh) out.push(o.visible ? 1 : 0); });
    return out.join('');
  }, recordId);
  await press(recordId);
  await page.waitForTimeout(1000);
  const vars = await page.evaluate((r) => {
    const v = window.__debug.registry.get(r).object3D.userData.programVars;
    return v ? [v.get('green'), v.get('yellow'), v.get('red')] : null;
  }, recordId);
  check('the traffic light’s program gives it green 8, yellow 3 and red 8', JSON.stringify(vars) === '[8,3,8]', JSON.stringify(vars));
  const a = await lit();
  await page.waitForTimeout(8500);
  const b = await lit();
  await page.waitForTimeout(3000);
  const c = await lit();
  check('it changes from green to yellow to red', a !== b && b !== c && a !== c, `${a} > ${b} > ${c}`);
  await stop(recordId);
}
await empty();

// --- activity 6: the emergency chain, exactly as printed -------------------------------
{
  const ids = {};
  for (const id of ['city-hall', 'fire-station', 'fire-engine']) ids[id] = await place(id, { x: 0, z: 150, yaw: 0 });
  const start = await positionOf(ids['fire-engine']);
  const said = await page.evaluate(async (ids) => {
    const d = window.__debug;
    const block = (type, params = {}, children) => {
      const b = { id: crypto.randomUUID(), type, params };
      if (children) b.children = children;
      return b;
    };
    const set = (id, program) => {
      const item = d.registry.get(id);
      item.record.program = program;
      delete item.record.programIdle;
      d.programManager.startFromRecord(id, item.record, item.object3D);
    };
    const heard = [];
    const original = d.programManager.broadcast.bind(d.programManager);
    d.programManager.broadcast = (text, from) => { heard.push(text); return original(text, from); };
    set(ids['fire-engine'], [block('whenSaid', { text: 'Engine 1 on the way!' }, [block('glide', { feet: 120, seconds: 8 })])]);
    set(ids['fire-station'], [block('whenSaid', { text: 'Fire at the library!' }, [block('wait', { seconds: 1 }), block('say', { text: 'Engine 1 on the way!' })])]);
    set(ids['city-hall'], [block('wait', { seconds: 2 }), block('say', { text: 'Fire at the library!' })]);
    await new Promise((r) => setTimeout(r, 13000));
    d.programManager.broadcast = original;
    return heard;
  }, ids);
  check('the emergency chain runs in order across three objects', said.join('|') === 'Fire at the library!|Engine 1 on the way!', said.join(' > '));
  const now = await positionOf(ids['fire-engine']);
  const moved = Math.hypot(now[0] - start[0], now[2] - start[2]);
  check('and the engine drives 120 feet', Math.abs(moved - 120) < 1, `${moved.toFixed(2)}ft`);
}
{
  const recordId = await place('street-lamp', { x: 40, z: 150, yaw: 0 });
  const heard = await page.evaluate(async (id) => {
    const d = window.__debug;
    const block = (type, params = {}, children) => {
      const b = { id: crypto.randomUUID(), type, params };
      if (children) b.children = children;
      return b;
    };
    const item = d.registry.get(id);
    item.record.program = [block('whenWorld', { event: 'sunset' }, [block('say', { text: 'Lights on!' })])];
    delete item.record.programIdle;
    d.programManager.startFromRecord(id, item.record, item.object3D);
    const out = [];
    const original = d.programManager.broadcast.bind(d.programManager);
    d.programManager.broadcast = (text, from) => { out.push(text); return original(text, from); };
    await d.menuActions.sunPhase(0.5);
    await new Promise((r) => setTimeout(r, 300));
    await d.menuActions.sunPhase(0.97);
    await new Promise((r) => setTimeout(r, 1500));
    d.programManager.broadcast = original;
    return out;
  }, recordId);
  check('sliding the time of day to dusk switches the street light on', heard.includes('Lights on!'), heard.join(' > '));
}
await page.evaluate(() => window.__debug.menuActions.sunPhase(null));
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
console.log('one of each piece in My World:', JSON.stringify(cost));
check('one of each piece fits inside the 750k meter', cost.geometry < 750000, `${Math.round(cost.geometry / 1000)}k`);
await page.screenshot({ path: resolve(SHOTS, 'city-one-of-each.jpg'), quality: 82, type: 'jpeg' });

// --- a small city for the activities page --------------------------------------------------
if (TAKE_SHOTS) {
  await empty();
  const city = await page.evaluate(async () => {
    const d = window.__debug;
    const placed = [];
    // My World's own trees and boards would be standing in the street.
    for (const [id, item] of [...d.registry.items]) {
      if (item.record?.kind !== 'world-theme' && item.record?.kind !== 'world-spawn') d.registry.remove(id);
    }
    // Facing +Z is rotation 0. A piece on the north side of the east-west street faces the street (+Z,
    // rotation 0); one on the south side faces -Z (rotation PI); a vehicle heading +X turns +PI/2.
    // Seated exactly as the panel seats a piece. A module imported from here is a second instance,
    // which is harmless for a pure function of its arguments.
    const { seatHeight } = await import('/src/models/index.js');
    const { MODEL_BY_ID } = await import('/src/models/catalog.js');
    const ground = (x, z) => d.player.groundHeightAt(x, z);
    const put = async (model, x, z, rot = 0) => {
      const record = { id: crypto.randomUUID(), kind: 'catalog-model', createdAt: Date.now(), model, connections: [], transform: { position: [x, ground(x, z), z], rotation: [0, rot, 0], scale: [1, 1, 1] } };
      await d.worldStore.rehydrateOne(record);
      const object3D = d.registry.get(record.id).object3D;
      object3D.position.y = seatHeight(MODEL_BY_ID.get(model), object3D, x, z, rot, ground);
      record.transform.position[1] = object3D.position.y;
      placed.push(record.id);
    };
    const N = Math.PI;
    // The streets: east-west along z = -60, north-south along x = 0, crossing at (0, -60).
    await put('road-intersection', 0, -60);
    for (const x of [-90, -70, -50, -30, 30, 50, 70, 90]) await put('road-straight', x, -60);
    for (const z of [-150, -130, -110, -90, -30, -10, 10]) await put('road-straight', 0, z, Math.PI / 2);
    // North side of the street (z < -80), fronts at z = -80, facing the street.
    for (const x of [30, 50, 70, 90]) await put('row-house', x, -100);
    await put('fire-station', -45, -105);
    await put('public-library', -100, -100);
    // South side (z > -40), fronts at z = -40, facing north.
    await put('apartment-building', 45, -20, N);
    await put('corner-grocery', 85, -20, N);
    await put('city-park', -40, -20, N);
    await put('city-diner', -95, -32, N);
    // East of the north-south street, beyond the apartments.
    await put('water-tower', -110, -175);
    await put('city-hall', -50, 50, N);
    // Street furniture and vehicles.
    await put('traffic-light', 23, -83);
    await put('traffic-light', -23, -37, N);
    for (const x of [-70, -30, 30, 70]) await put('street-lamp', x, -78.4, N);
    await put('bus-stop', 55, -43, N);
    await put('fire-hydrant', 40, -77);
    await put('recycling-bins', 70, -77.5);
    await put('city-bus', 40, -54, Math.PI / 2);
    await put('city-taxi', -60, -66, -Math.PI / 2);
    await put('school-bus', 6, -120, 0);
    await put('police-car', -6, -10, N);
    await put('fire-engine', -52, -96, 0);
    return placed.length;
  });
  console.log(`laid out a city of ${city} pieces`);
  await page.addStyleTag({ content: '#menu, #touch-nav, #toast-host, #object-menu, .cinema-chip, #model-meter { display: none !important; }' });
  // The hammer and play icons are sprites floating over every placed model; a photograph of a city
  // does not want forty of them.
  await page.evaluate(() => {
    const d = window.__debug;
    d.constructionManager.tick = () => {};
    d.playIconManager.tick = () => {};
    d.scene.traverse((o) => { if (o.isSprite) o.visible = false; });
  });
  const shoot = async (name, { x, z, yaw, pitch, eye }) => {
    await page.evaluate(({ x, z, yaw, pitch, eye }) => {
      const d = window.__debug;
      d.player.setEyeHeight(eye);
      d.player.resetTo({ x, z, yaw, pitch });
    }, { x, z, yaw, pitch, eye });
    await page.waitForTimeout(2500);
    mkdirSync(PAGE_SHOTS, { recursive: true });
    await page.screenshot({ path: resolve(PAGE_SHOTS, name), quality: 80, type: 'jpeg' });
    console.log(`wrote docs/guide/shots/${name}`);
  };
  await shoot('city_overview.jpg', { x: 165, z: -55, yaw: Math.PI / 2 - 0.05, pitch: -0.4, eye: 58 });
  await shoot('city_street.jpg', { x: 100, z: -52, yaw: Math.PI / 2 - 0.25, pitch: 0.02, eye: 5 });
  await shoot('city_firehouse.jpg', { x: -50, z: -62, yaw: 0, pitch: -0.05, eye: 5 });
  await page.evaluate(() => window.__debug.player.setEyeHeight(5));
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
