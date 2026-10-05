// Capture every screenshot in the book from the running app.
//
//   npx vite --port 5199            (repo root, in another terminal)
//   node tools/capture.mjs          every scene, at print resolution (3200 x 2000)
//   node tools/capture.mjs train    only scenes whose name contains "train"
//   SCALE=1 node tools/capture.mjs  quick 1600 x 1000 drafts
//
// Scenes are grouped by world, because building a world is the slow part. Each scene
// leaves the world as it found it (removeAdded) so they can run in any order.
import { mkdirSync } from 'node:fs';
import { launch, boot, loadWorld, chrome, shot, inject, look } from './lib/app.mjs';
import { MODELS } from './models.mjs';

const OUT = new URL('../assets/shots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const filter = process.argv[2] || '';
const SCALE = Number(process.env.SCALE || 2);
const want = (name, world) => !filter || name.includes(filter) || world === filter;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- small helpers ------------------------------------------------------------------

async function reset(page) {
  await page.evaluate(() => {
    const d = window.__debug;
    window.__book.removeAdded();
    d.objectMenu.close();
    d.primitiveMenu.close();
    d.programEditor.close();
    d.buildGizmo.deactivate();
    d.photoMode.close?.();
    d.drawTool.close();
    d.menu.setCollapsed(true);
    d.player.setEyeHeight(5);
    d.menuActions.sunPhase(null);
  });
  await chrome(page, {});
}

// Full-page openers and the cover are portrait: 1000 x 1510 CSS = 2000 x 3020 pixels,
// enough for a full-bleed 6.125 x 9.25 in page at 300 ppi (1838 x 2775).
const PORTRAIT = new Set(['opener-1', 'opener-2', 'opener-3', 'opener-4', 'cover']);

// Scenes that show the app's own panels are captured in a narrower window, so the panels
// are big enough to read on a 6 in page: 1000 x 625 CSS pixels = 2000 x 1250 at 2x.
const UI = new Set(['app-ui', 'look-around-menu', 'photo-result', 'object-menu', 'life-menu', 'orb-dusk',
  'draw-pad', 'create-model-menu', 'hammer-menu', 'texture-panel', 'snowman-connect', 'station-sign',
  'program-empty', 'program-hello', 'program-loop', 'program-glide', 'program-square', 'program-wander',
  'program-hat', 'program-sunset', 'program-street', 'program-timetable', 'program-say']);

async function openMenu(page, group) {
  await chrome(page, { menu: true });
  await page.evaluate(() => window.__debug.menu.setCollapsed(false));
  if (group) await page.locator('#menu button', { hasText: group }).first().click();
  await sleep(300);
}

async function evalB(page, fn, arg) {
  return page.evaluate(fn, arg);
}

const pieces = (page, parts, origin, opts) =>
  evalB(page, ([p, o, x]) => window.__book.addPieces(p, o, x), [parts, origin, opts || {}]);
const model = (page, parts, origin, opts) =>
  evalB(page, ([p, o, x]) => window.__book.addModel(p, o, x), [parts, origin, opts || {}]);
const only = (name, ...names) => MODELS[name].filter((part) => names.includes(part.name));
const except = (name, ...names) => MODELS[name].filter((part) => !names.includes(part.name));

// Frame one of the world's own props by its name, e.g. the T. rex on Dinosaur Island.
const frameProp = (page, prop, opts) => evalB(page, ([p, o]) => {
  const d = window.__debug;
  const hit = [...d.registry.items.entries()].find(([, it]) => it.record?.prop === p);
  return window.__book.frame({ ...o, ids: hit ? [hit[0]] : [] });
}, [prop, opts]);

const frame = async (page, opts) => { const d = await evalB(page, (o) => window.__book.frame(o), opts); if (process.env.DEBUG) console.log('    frame d =', d); return d; };

async function gizmo(page, id, mode) {
  await evalB(page, ([i, m]) => window.__debug.buildGizmo.activate(i, m), [id, mode]);
  await sleep(300);
}

async function hammerMenu(page, id, view) {
  await chrome(page, { menu: false });
  await evalB(page, ([i, v]) => {
    const d = window.__debug;
    const s = window.__book.screenOf(i);
    d.primitiveMenu.open(i, s.x + 60, s.y - 120);
    if (v === 'texture') d.primitiveMenu.renderTexture();
    if (v === 'connect') d.primitiveMenu.renderConnect();
  }, [id, view]);
  await sleep(300);
}

async function editor(page, id) {
  await evalB(page, (i) => window.__debug.programEditor.open(i), id);
  await sleep(400);
}

async function setProgram(page, id, spec) {
  await evalB(page, ([i, s]) => window.__book.setProgram(i, s), [id, spec]);
}

// --- the scenes ---------------------------------------------------------------------

const PARK = {
  'park-arrival': async (page) => {
    await look(page, { x: 0, z: 16, at: [0, 5.6, -20] });
  },
  'app-ui': async (page) => {
    await look(page, { x: 0, z: 16, at: [0, 5.6, -20] });
    await openMenu(page);
  },
  'look-around-menu': async (page) => {
    await look(page, { x: 0, z: -48, at: [0, 4, -70] });
    await openMenu(page, 'Look Around');
  },
  'park-bandstand': async (page) => {
    await look(page, { x: 4, z: -50, at: [0, 4.5, -70] });
  },
  'park-bridge': async (page) => {
    await look(page, { x: -10, z: -36, at: [-26, 3, -40] });
  },
  'park-geese': async (page) => {
    await look(page, { x: -40, z: -33, at: [-52, 0.4, -40.5] });
  },
  'park-sign': async (page) => {
    // Chapter 1's first walk: one of the Park's white information signs, read up close.
    // Found by asking the registry rather than by hand-copied coordinates.
    await page.evaluate(() => {
      const d = window.__debug;
      const signs = [...d.registry.items.values()].filter((it) => it.record?.prop === 'info-placard');
      signs.sort((a, b) => Math.hypot(a.object3D.position.x - 2, a.object3D.position.z + 48) - Math.hypot(b.object3D.position.x - 2, b.object3D.position.z + 48));
      const o = signs[0].object3D;
      const fx = Math.sin(o.rotation.y), fz = Math.cos(o.rotation.y);
      const x = o.position.x + fx * 4.4 + fz * 0.5, z = o.position.z + fz * 4.4 - fx * 0.5;
      const gy = d.player.groundHeightAt(x, z);
      const dx = o.position.x - x, dz = o.position.z - z, dy = o.position.y + 3.0 - (gy + 5);
      d.player.setEyeHeight(5);
      d.player.resetTo({ x, z, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
    });
    await sleep(400);
  },
  'ant-geese': async (page) => {
    await look(page, { x: -45.5, z: -35.5, at: [-52, 0.9, -40.5], eye: 0.3 });
  },
  'pond-view': async (page) => {
    // What a goose on the pond sees: low over the water, looking back across the Park.
    await look(page, { x: -53, z: -41, at: [-10, 3.5, -52], eye: 1.4 });
  },
  'size-ant': async (page) => {
    await look(page, { x: 2, z: -48, at: [0, 6, -70], eye: 0.3 });
  },
  'size-me': async (page) => {
    await look(page, { x: 2, z: -48, at: [0, 4, -70] });
  },
  'size-giant': async (page) => {
    await look(page, { x: 2, z: -48, at: [0, 0, -68], eye: 22 });
  },
  'fly-view': async (page) => {
    await look(page, { x: 10, z: 30, at: [-5, 0, -40], eye: 55 });
  },
  'photo-result': async (page) => {
    await look(page, { x: 4, z: -54, at: [0, 4.5, -70] });
    await chrome(page, { menu: true });
    await evalB(page, () => { window.__debug.photoMode.open(); window.__debug.photoMode.capture(); });
    await sleep(900);
  },
  'photo-hung': async (page) => {
    await look(page, { x: 4, z: -54, at: [0, 4.5, -70] });
    await evalB(page, async () => {
      const pm = window.__debug.photoMode;
      pm.open();
      pm.capture();
      await new Promise((r) => setTimeout(r, 800));
      await pm.hangItHere();
      pm.close();
    });
    await sleep(800);
    const p = await evalB(page, () => {
      const d = window.__debug;
      const hit = [...d.registry.items.values()].reverse().find((it) => it.record?.kind === 'image');
      return hit ? hit.object3D.position.toArray() : [0, 3, -62];
    });
    await look(page, { x: p[0] + 7, z: p[2] + 9, at: [p[0], p[1], p[2]] });
  },
  'park-portal': async (page) => {
    await look(page, { x: -66, z: -4, at: [-82.6, 6, -8.8] });
  },
  'object-menu': async (page) => {
    await look(page, { x: -21, z: 0, at: [-26, 1, -8] });
    await evalB(page, () => {
      const d = window.__debug;
      const [id] = [...d.registry.items.entries()].find(([, it]) => it.record?.prop === 'bench' && Math.abs(it.record.transform.position[2] + 8) < 1);
      const s = window.__book.screenOf(id);
      d.objectMenu.open(id, s.x + 70, s.y - 150);
    });
    await sleep(400);
  },
  'life-menu': async (page) => {
    await look(page, { x: -21, z: 0, at: [-26, 1, -8] });
    await evalB(page, () => {
      const d = window.__debug;
      const [id] = [...d.registry.items.entries()].find(([, it]) => it.record?.prop === 'bench' && Math.abs(it.record.transform.position[2] + 8) < 1);
      const s = window.__book.screenOf(id);
      d.objectMenu.open(id, s.x + 70, s.y - 150);
      d.objectMenu.renderMotion();
    });
    await sleep(400);
  },
  'orb-day': async (page) => {
    await evalB(page, () => {
      const d = window.__debug;
      d.menuActions.lightOrb();
      const it = [...d.registry.items.values()].reverse().find((x) => x.record?.kind === 'light-orb');
      const y = d.player.groundHeightAt(-3, -58) + 3;
      it.object3D.position.set(-3, y, -58);
      it.record.transform.position = [-3, y, -58];
    });
    await sleep(400);
    await look(page, { x: 3, z: -48, at: [-1.5, 3.4, -62] });
  },
  'orb-dusk': async (page) => {
    await evalB(page, () => {
      const d = window.__debug;
      d.menuActions.lightOrb();
      const it = [...d.registry.items.values()].reverse().find((x) => x.record?.kind === 'light-orb');
      const y = d.player.groundHeightAt(-3, -58) + 3;
      it.object3D.position.set(-3, y, -58);
      it.record.transform.position = [-3, y, -58];
    });
    await sleep(400);
    await look(page, { x: 3, z: -48, at: [-1.5, 3.4, -62] });
    await openMenu(page, 'Look Around');
    await evalB(page, () => window.__debug.menuActions.sunPhase(0.8));
    await sleep(800);
  },
};

Object.assign(PARK, {
  'opener-1': async (page) => { await look(page, { x: 0, z: 22, at: [0, 7.5, -20] }); },
});

const DINO = {
  'opener-2': async (page) => { await look(page, { x: 12, z: -10, at: [2, 12.5, -48] }); },
  'dino-arrival': async (page) => { await look(page, { x: 0, z: 56, at: [0, 6, 10] }); },
  'dino-trex': async (page) => { await look(page, { x: 6, z: -14, at: [2, 11, -48] }); },
  'dino-trike': async (page) => { await look(page, { x: -44, z: 18, at: [-32, 4.5, -4] }); },
  'dino-nest': async (page) => { await look(page, { x: -6, z: -35, at: [-13, 0.3, -45] }); },
  'dino-dig': async (page) => { await look(page, { x: 26, z: 20, at: [34, 0, 6] }); },
};

const SEA = {
  'sea-arrival': async () => {},
};

// My World. The boards are taken out of the build shots so the model is the whole picture.
const BUILD = [0, 6];
const MY = {
  'myworld-arrival': async (page) => { await look(page, { x: 0, z: 16, at: [0, 4, -6] }); },
  'create-model-menu': async (page) => {
    await clearBoards(page);
    await look(page, { x: 0, z: 16, at: [0, 2, 4] });
    await evalB(page, async () => {
      for (const s of ['cube', 'sphere', 'cylinder', 'tetrahedron']) await window.__debug.menuActions.createPrimitive(s);
    });
    await frame(page, { az: 0, el: 14, fill: 0.42, pan: 14 });
    await openMenu(page, 'Create Model');
  },
  'four-shapes': async (page) => {
    await clearBoards(page);
    await pieces(page, [
      { name: 'cube', shape: 'cube', color: '#f2c94c', pos: [-4.5, 1, 0], scale: [1, 1, 1], rot: [0, 0, 0] },
      { name: 'sphere', shape: 'sphere', color: '#f2c94c', pos: [-1.5, 1, 0], scale: [1, 1, 1], rot: [0, 0, 0] },
      { name: 'cylinder', shape: 'cylinder', color: '#f2c94c', pos: [1.5, 1, 0], scale: [1, 1, 1], rot: [0, 0, 0] },
      { name: 'tetrahedron', shape: 'tetrahedron', color: '#f2c94c', pos: [4.5, 0.75, 0], scale: [1, 1, 1], rot: [0, 0, 0] },
    ], BUILD);
    await frame(page, { az: 0, el: 12, fill: 0.72 });
  },
  'hammer-menu': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, [{ name: 'cube', shape: 'cube', color: '#f2c94c', pos: [0, 1, 0], scale: [1, 1, 1], rot: [0, 0, 0] }], BUILD);
    await frame(page, { az: 25, el: 15, fill: 0.34, pan: -14 });
    await hammerMenu(page, id);
  },
  'texture-panel': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, [{ name: 'cube', shape: 'cube', color: '#3d8bf2', pos: [0, 1, 0], scale: [1, 1, 1], rot: [0, 0, 0] }], BUILD);
    await frame(page, { az: 25, el: 15, fill: 0.34, pan: -14 });
    await hammerMenu(page, id, 'texture');
  },
  'gizmo-stretch': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, [{ name: 'wall', shape: 'cube', color: '#f2c94c', pos: [0, 1.6, 0], scale: [1.8, 1.6, 0.5], rot: [0, 0, 0] }], BUILD);
    await frame(page, { az: 28, el: 16, fill: 0.6 });
    await gizmo(page, id, 'stretch');
  },
  'gizmo-rotate': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, [{ name: 'boiler', shape: 'cylinder', color: '#3fb37f', pos: [0, 1.2, 0], scale: [1.05, 1.6, 1.05], rot: [90, 0, 0] }], BUILD);
    await frame(page, { az: 32, el: 16, fill: 0.5 });
    await gizmo(page, id, 'rotate');
  },
  'snowman-parts': async (page) => {
    await clearBoards(page);
    await pieces(page, [
      { ...MODELS.snowman[0], pos: [-3.2, 1.2, 0] },
      { ...MODELS.snowman[1], pos: [0, 0.9, 0] },
      { ...MODELS.snowman[2], pos: [2.4, 0.6, 0] },
      { ...MODELS.snowman[3], pos: [4.2, 0.3, 0] },
    ], BUILD);
    await frame(page, { az: 0, el: 12, fill: 0.7 });
  },
  'snowman-lift': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, [MODELS.snowman[0], { ...MODELS.snowman[1], pos: [0, 3.6, 0] }], BUILD);
    await frame(page, { az: 22, el: 10, fill: 0.6 });
    await gizmo(page, ids[1], 'stretch');
  },
  'snowman-connect': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, MODELS.snowman, BUILD);
    await frame(page, { az: 15, el: 8, fill: 0.55, pan: -12 });
    await hammerMenu(page, ids[1], 'connect');
  },
  'snowman-done': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.snowman, BUILD);
    await frame(page, { az: 22, el: 6, fill: 0.7 });
  },
  'draw-pad': async (page) => {
    await look(page, { x: 0, z: 16, at: [0, 3, 0] });
    await chrome(page, { menu: false });
    await evalB(page, () => drawFish());
    await sleep(300);
  },
  'balloon-face': async (page) => {
    await look(page, { x: 0, z: 16, at: [0, 3, 0] });
    await evalB(page, async () => { await drawFace(); await window.__debug.drawTool.finish(); });
    await sleep(1600);
    await evalB(page, () => {
      const d = window.__debug;
      const it = [...d.registry.items.values()].reverse().find((o) => o.record?.kind === 'balloon');
      window.__book.frame({ ids: [it.object3D.userData.placedId], az: 8, el: 6, fill: 0.5 });
    });
    await sleep(400);
  },
  'balloon-fish': async (page) => {
    // Chapter 6's opener: one painting, puffed up, seen from three-quarters so its
    // thickness shows.
    await clearBoards(page);
    await look(page, { x: 0, z: 16, at: [0, 3, 0] });
    await evalB(page, async () => { await drawFish(); await window.__debug.drawTool.finish(); });
    await sleep(1600);
    await evalB(page, () => {
      const d = window.__debug;
      const it = [...d.registry.items.values()].reverse().find((o) => o.record?.kind === 'balloon');
      window.__book.frame({ ids: [it.object3D.userData.placedId], az: 24, el: 9, fill: 0.55 });
    });
    await sleep(400);
  },
  'balloon-zoo': async (page) => {
    await look(page, { x: 0, z: 16, at: [0, 3, 0] });
    await evalB(page, async () => {
      await drawFish(); await window.__debug.drawTool.finish();
      await drawStar(); await window.__debug.drawTool.finish();
      await drawCloud(); await window.__debug.drawTool.finish();
    });
    await sleep(1600);
    await evalB(page, () => {
      const d = window.__debug;
      const balloons = [...d.registry.items.values()].filter((it) => it.record?.kind === 'balloon').slice(-3);
      balloons.forEach((it, i) => {
        const x = (i - 1) * 3.2, z = 5 + (i === 1 ? -1.2 : 0);
        const lift = it.object3D.position.y - d.player.groundHeightAt(it.object3D.position.x, it.object3D.position.z);
        it.object3D.position.set(x, d.player.groundHeightAt(x, z) + lift, z);
        it.object3D.rotation.set(0, (i - 1) * -0.25, 0);
      });
    });
    await sleep(300);
    await frame(page, { az: 0, el: 8, fill: 0.62 });
  },

  // --- the train ---
  'train-boiler': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, only('locomotive', 'boiler'), BUILD);
    await frame(page, { az: 38, el: 16, fill: 0.5 });
    await gizmo(page, id, 'rotate');
  },
  'train-wheels': async (page) => {
    await clearBoards(page);
    await pieces(page, MODELS.locomotive.filter((p) => p.name === 'boiler' || p.name.startsWith('wheel')), BUILD);
    await frame(page, { az: 42, el: 16, fill: 0.7 });
  },
  'train-cab': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, except('locomotive', 'cowcatcher', 'chimney', 'dome', 'cab roof'), BUILD);
    await frame(page, { az: 42, el: 16, fill: 0.66 });
    await gizmo(page, ids[1], 'stretch');
  },
  'train-pieces': async (page) => {
    await clearBoards(page);
    await pieces(page, MODELS.locomotive, BUILD);
    await frame(page, { az: 42, el: 16, fill: 0.72 });
  },
  'train-render': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.locomotive, BUILD);
    await frame(page, { az: 42, el: 12, fill: 0.74 });
  },
  'train-carriage': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.locomotive, BUILD);
    await pieces(page, MODELS.carriage, [BUILD[0], BUILD[1] - 5.6]);
    await frame(page, { az: 52, el: 14, fill: 0.76 });
  },
  'train-finished': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.locomotive, BUILD);
    await model(page, MODELS.carriage, [BUILD[0], BUILD[1] - 5.6]);
    await frame(page, { az: 52, el: 10, fill: 0.78 });
  },
  'train-drive': async (page) => {
    await clearBoards(page);
    const loco = await model(page, MODELS.locomotive, [0, 2]);
    await look(page, { x: 6, z: 14, at: [0, 2, 2] });
    await evalB(page, async (id) => {
      const d = window.__debug;
      const s = window.__book.screenOf(id);
      d.objectMenu.open(id, s.x, s.y);
      d.objectMenu.renderCamera();
      const btn = [...document.querySelectorAll('#object-menu button')].find((b) => b.textContent.trim() === 'Drive it');
      btn.click();
    }, loco);
    await sleep(2500);
  },
  'station-platform': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.station, [0, 2]);
    await model(page, MODELS.locomotive, [-3, 6.5], { rotY: 90 });
    await model(page, MODELS.carriage, [-8.6, 6.5], { rotY: 90 });
    await look(page, { x: 8.5, z: 1.4, at: [-6, 2.2, 5.5], eye: 3.4 });
  },
  'tender': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.tender, BUILD);
    await frame(page, { az: 40, el: 14, fill: 0.62 });
  },

  // --- the turtle ---
  'turtle-shell': async (page) => {
    await clearBoards(page);
    const [id] = await pieces(page, only('turtle', 'shell'), BUILD);
    await frame(page, { az: 28, el: 22, fill: 0.55 });
    await gizmo(page, id, 'stretch');
  },
  'turtle-legs': async (page) => {
    // Chapter 10 step 3's try-it: crouched to an ant's height in front of the turtle,
    // checking that the four legs match. Shell, head and legs only -- no tail or eyes yet.
    await clearBoards(page);
    await pieces(page, only('turtle', 'shell', 'head', 'leg 1', 'leg 2', 'leg 3', 'leg 4'), BUILD);
    await frame(page, { az: 32, el: 7, fill: 0.48 });
  },
  'turtle-pieces': async (page) => {
    await clearBoards(page);
    await pieces(page, MODELS.turtle, BUILD);
    await frame(page, { az: 30, el: 18, fill: 0.62 });
  },
  'turtle-finished': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.turtle, BUILD);
    await frame(page, { az: 26, el: 8, fill: 0.64 });
  },
  'giraffe': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.giraffe, BUILD);
    await frame(page, { az: 42, el: 4, fill: 0.78 });
  },

  // --- the station and the house ---
  'station-columns': async (page) => {
    await clearBoards(page);
    await pieces(page, MODELS.station.filter((p) => p.name === 'platform' || p.name.startsWith('column')), BUILD);
    await frame(page, { az: 28, el: 18, fill: 0.76 });
  },
  'station-roof': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, except('station', 'sign'), BUILD);
    await frame(page, { az: 28, el: 16, fill: 0.72 });
    await gizmo(page, ids[5], 'stretch');
  },
  'station-sign': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, MODELS.station, BUILD);
    await frame(page, { az: 0, el: 6, fill: 0.62, pan: -18 });
    await hammerMenu(page, ids[6], 'texture');
  },
  'station-finished': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.station, [0, 2]);
    await model(page, MODELS.locomotive, [-3, 6.5], { rotY: 90 });
    await model(page, MODELS.carriage, [-8.6, 6.5], { rotY: 90 });
    await frame(page, { az: 24, el: 12, fill: 0.8 });
  },
  'house-roof': async (page) => {
    await clearBoards(page);
    const ids = await pieces(page, only('house', 'walls', 'roof'), BUILD);
    await frame(page, { az: 36, el: 16, fill: 0.56 });
    await gizmo(page, ids[1], 'rotate');
  },
  'house': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.house, BUILD);
    await frame(page, { az: 34, el: 8, fill: 0.72 });
  },

  // --- Part 4: programs (the editor covers the view; the model is behind it) ---
  'program-empty': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await frame(page, { az: 20, el: 10, fill: 0.5 });
    await editor(page, id);
  },
  'program-say': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await setProgram(page, id, [['say', { text: 'Hello!' }]]);
    await editor(page, id);
  },
  'turtle-play': async (page) => {
    // The green play button over a programmed model, with no speech bubble in the way.
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await frame(page, { az: 24, el: 12, fill: 0.62, tilt: 4 });
    await setProgram(page, id, [['rotate', { degrees: 0 }]]);
    await sleep(700);
  },
  'program-hello': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await setProgram(page, id, PROGRAMS.hello);
    await editor(page, id);
  },
  'turtle-hello': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await frame(page, { az: 22, el: 8, fill: 0.42, tilt: 5 });
    await setProgram(page, id, [['say', { text: 'Hello!' }]]);
    await sleep(700);
  },
  'program-loop': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await setProgram(page, id, PROGRAMS.loop);
    await editor(page, id);
  },
  'program-glide': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, BUILD);
    await setProgram(page, id, PROGRAMS.glide);
    await editor(page, id);
  },
  'train-glide': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, [-12, 3], { rotY: 90 });
    await frame(page, { box: { min: [-14, 0, 1], max: [10, 4.4, 5] }, az: 0, el: 8, fill: 0.92 });
    await setProgram(page, id, [['glide', { feet: 20, seconds: 4, ease: 'smooth' }]]);
    await sleep(2100);
  },
  'program-square': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, [-10, -6]);
    await setProgram(page, id, PROGRAMS.square);
    await editor(page, id);
  },
  'train-square': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, [-10, -6]);
    await setProgram(page, id, PROGRAMS.squareFast);
    await sleep(6500);
    await frame(page, { box: { min: [-12, 0, -9], max: [12, 4, 16] }, az: 0, el: 40, fill: 0.86 });
  },
  'train-hexagon': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, [-6, -8]);
    await setProgram(page, id, PROGRAMS.hexagonFast);
    await sleep(8000);
    await frame(page, { box: HEX_BOX, az: 0, el: 40, fill: 0.86 });
  },
  'program-wander': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await setProgram(page, id, PROGRAMS.wander);
    await editor(page, id);
  },
  'turtle-hide': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await frame(page, { az: 26, el: 8, fill: 0.6 });
    await setProgram(page, id, [['setOpacity', { percent: 30 }]]);
    await sleep(600);
  },
  'program-hat': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.turtle, BUILD);
    await setProgram(page, id, PROGRAMS.answer);
    await editor(page, id);
  },
  'talk-back': async (page) => {
    await clearBoards(page);
    const turtle = await model(page, MODELS.turtle, [3, 6], { rotY: -25 });
    const train = await model(page, MODELS.locomotive, [-4, 5], { rotY: 70 });
    await frame(page, { az: 0, el: 6, fill: 0.62, tilt: 4 });
    await setProgram(page, turtle, PROGRAMS.answer);
    await sleep(300);
    await setProgram(page, train, [['say', { text: 'All aboard!' }]]);
    await sleep(900);
  },
  'program-street': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.house, BUILD);
    await setProgram(page, id, []);
    await evalB(page, async ([i, s]) => {
      const d = window.__debug;
      d.registry.get(i).record.program = await window.__book.program(s);
      d.programEditor.open(i);
    }, [id, PROGRAMS.street]);
    await sleep(400);
  },
  'street': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.house, [-22, -2]);
    await setProgram(page, id, PROGRAMS.street);
    await sleep(2500);
    await frame(page, { az: 8, el: 10, fill: 0.86 });
  },
  'program-sunset': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.station, [0, 2]);
    await evalB(page, () => window.__debug.menuActions.lightOrb());
    await sleep(400);
    await evalB(page, async (spec) => {
      const d = window.__debug;
      const [id] = [...d.registry.items.entries()].reverse().find(([, it]) => it.record?.kind === 'light-orb');
      await window.__book.setProgram(id, spec);
      d.programEditor.open(id);
    }, PROGRAMS.sunset);
    await sleep(400);
  },
  'program-timetable': async (page) => {
    await clearBoards(page);
    const id = await model(page, MODELS.locomotive, BUILD);
    await evalB(page, async ([i, s]) => {
      const d = window.__debug;
      d.registry.get(i).record.program = await window.__book.program(s);
      d.programEditor.open(i);
    }, [id, PROGRAMS.timetable]);
    await sleep(400);
  },
  'town-day': async (page) => {
    await buildTown(page);
    if (process.env.DEBUG) console.log(JSON.stringify(await evalB(page, () => window.__book.newBoxes())));
    await frame(page, { az: 20, el: 10, fill: 0.95 });
  },
  'town-dusk': async (page) => {
    await buildTown(page);
    await evalB(page, () => window.__debug.menuActions.sunPhase(0.76));
    await sleep(1200);
    await frame(page, { az: 20, el: 10, fill: 0.95 });
  },

  // --- portrait pages: the four part openers and the front cover -------------------
  'opener-3': async (page) => {
    await clearBoards(page);
    await model(page, MODELS.station, [0, 2]);
    await model(page, MODELS.locomotive, [-3, 6.5], { rotY: 90 });
    await model(page, MODELS.carriage, [-8.6, 6.5], { rotY: 90 });
    await frame(page, { az: 38, el: 7, fill: 0.62, tilt: 9 });
  },
  'opener-4': async (page) => {
    await clearBoards(page);
    const turtle = await model(page, MODELS.turtle, [2.5, 6], { rotY: -25 });
    const train = await model(page, MODELS.locomotive, [-3.5, 5], { rotY: 70 });
    await frame(page, { az: 0, el: 6, fill: 0.62, tilt: 7 });
    await setProgram(page, turtle, PROGRAMS.answer);
    await sleep(300);
    await setProgram(page, train, [['say', { text: 'All aboard!' }]]);
    await sleep(900);
  },
  'cover': async (page) => {
    const front = await buildTown(page);
    await frame(page, { ids: front, az: 26, el: 8, fill: 0.92, tilt: 7 });
  },
};

// The bounding box of the hexagon route, worked out from the program itself.
const HEX_BOX = (() => {
  let x = -6, z = -8, h = 0;
  const xs = [x], zs = [z];
  for (let i = 0; i < 6; i++) {
    x += 12 * Math.sin(h); z += 12 * Math.cos(h);
    xs.push(x); zs.push(z);
    h += Math.PI / 3;
  }
  return { min: [Math.min(...xs) - 2, 0, Math.min(...zs) - 2], max: [Math.max(...xs) + 2, 4, Math.max(...zs) + 2] };
})();

// The programs exactly as the book prints them.
const PROGRAMS = {
  hello: [['say', { text: 'Hello!' }], ['wait', { seconds: 1 }], ['moveForward', { feet: 5 }], ['rotate', { degrees: 180 }], ['goHome']],
  loop: [['moveUp', { feet: 2 }], ['wait', { seconds: 0.3 }], ['moveUp', { feet: -2 }], ['repeat', { count: 4 }, [['rotate', { degrees: 90 }], ['wait', { seconds: 0.5 }]]]],
  glide: [['glide', { feet: 20, seconds: 4, ease: 'smooth' }]],
  square: [['markerColor', { color: '#e0455f' }], ['markerDown'], ['repeat', { count: 4 }, [['glide', { feet: 20, seconds: 4, ease: 'smooth' }], ['rotate', { degrees: 90 }]]]],
  squareFast: [['markerColor', { color: '#e0455f' }], ['markerDown'], ['repeat', { count: 4 }, [['glide', { feet: 20, seconds: 1.2, ease: 'smooth' }], ['rotate', { degrees: 90 }]]], ['markerUp']],
  hexagonFast: [['markerColor', { color: '#8a5cf5' }], ['markerDown'], ['repeat', { count: 6 }, [['glide', { feet: 12, seconds: 1, ease: 'smooth' }], ['rotate', { degrees: 60 }]]], ['markerUp']],
  wander: [['forever', {}, [['glide', { feet: 3, seconds: 2, ease: 'smooth' }], ['wait', { seconds: 1 }], ['rotate', { degrees: 30 }]]]],
  answer: [['whenSaid', { text: 'All aboard!' }, [['say', { text: 'Wait for me!' }]]]],
  street: [['repeat', { count: 3 }, [['duplicate', { offset: 15 }]]]],
  sunset: [['whenWorld', { event: 'sunset' }, [['changeColor', { color: '#f2c94c' }]]]],
  timetable: [['forever', {}, [['glide', { feet: 30, seconds: 5, ease: 'smooth' }], ['say', { text: 'All aboard!' }], ['wait', { seconds: 3 }], ['rotate', { degrees: 180 }]]]],
};

// The capstone scene. Returns the ids of the things in the foreground, for framing.
async function buildTown(page) {
  await clearBoards(page);
  const front = [];
  front.push(await model(page, MODELS.station, [0, -4]));
  front.push(await model(page, MODELS.locomotive, [-6, 0.5], { rotY: 90 }));
  front.push(await model(page, MODELS.carriage, [-11.6, 0.5], { rotY: 90 }));
  front.push(await model(page, MODELS.turtle, [7, 4.5], { rotY: -30 }));
  for (const [x, z] of [[-21, -14], [-11, -16], [11, -16], [21, -14]]) await model(page, MODELS.house, [x, z]);
  await placeOrb(page, [6.5, -1.5], 4.2);
  await placeOrb(page, [-16, -9], 4.2);
  await placeOrb(page, [16, -9], 4.2);
  await sleep(500);
  return front;
}

// A light orb, placed where the scene wants it rather than where Light Orb drops it.
async function placeOrb(page, [x, z], height = 3) {
  await evalB(page, async ([x, z, h]) => {
    const d = window.__debug;
    d.registry.bulkLoading = true;
    try { d.menuActions.lightOrb(); } finally { d.registry.bulkLoading = false; }
    const it = [...d.registry.items.values()].reverse().find((o) => o.record?.kind === 'light-orb');
    const y = d.player.groundHeightAt(x, z) + h;
    it.object3D.position.set(x, y, z);
    it.record.transform.position = [x, y, z];
  }, [x, z, height]);
}

// My World's boards, and any of its five trees that landed in the build area. The trees
// are planted at random on every load, so one can stand in the middle of a scene.
async function clearBoards(page) {
  await evalB(page, () => {
    const d = window.__debug;
    window.__book.removeKinds(['welcome-board', 'tutorial-board']);
    for (const [id, it] of [...d.registry.items.entries()]) {
      const p = it.record?.transform?.position;
      if (/tree/.test(it.record?.prop || '') && p && Math.abs(p[0]) < 45 && p[2] > -45 && p[2] < 30) d.registry.remove(id);
    }
  });
}

// --- drawing, for the Draw chapter ---------------------------------------------------
// Painted straight onto the Draw tool's own canvas, then inflated by its own finish().
const DRAW_HELPERS = `
  window.drawFish = async () => {
    const t = window.__debug.drawTool; t.open();
    const g = t.ctx, w = t.canvas.width, h = t.canvas.height, cx = w * 0.46, cy = h * 0.5;
    g.fillStyle = '#f2a541'; g.beginPath(); g.ellipse(cx, cy, w * 0.26, h * 0.26, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e0455f'; g.beginPath(); g.moveTo(cx + w * 0.2, cy); g.lineTo(cx + w * 0.42, cy - h * 0.26); g.lineTo(cx + w * 0.42, cy + h * 0.26); g.closePath(); g.fill();
    g.fillStyle = '#3d8bf2'; for (const k of [-1, 0, 1]) { g.beginPath(); g.ellipse(cx + k * w * 0.07, cy + h * 0.02, w * 0.025, h * 0.12, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#1e2a3a'; g.beginPath(); g.arc(cx - w * 0.15, cy - h * 0.06, h * 0.035, 0, Math.PI * 2); g.fill();
  };
  window.drawStar = async () => {
    const t = window.__debug.drawTool; t.open();
    const g = t.ctx, w = t.canvas.width, h = t.canvas.height, cx = w / 2, cy = h / 2, R = h * 0.42, r = R * 0.45;
    g.fillStyle = '#8a5cf5'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R; g.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
    g.closePath(); g.fill();
  };
  window.drawFace = async () => {
    const t = window.__debug.drawTool; t.open();
    const g = t.ctx, w = t.canvas.width, h = t.canvas.height, cx = w / 2, cy = h / 2, R = h * 0.4;
    g.fillStyle = '#f2c94c'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1e2a3a';
    for (const k of [-1, 1]) { g.beginPath(); g.ellipse(cx + k * R * 0.36, cy - R * 0.22, R * 0.11, R * 0.16, 0, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#e0455f'; g.lineWidth = R * 0.13; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy + R * 0.02, R * 0.52, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
    g.fillStyle = '#f2a541';
    for (const k of [-1, 1]) { g.beginPath(); g.arc(cx + k * R * 0.62, cy + R * 0.18, R * 0.12, 0, Math.PI * 2); g.fill(); }
  };
  window.drawCloud = async () => {
    const t = window.__debug.drawTool; t.open();
    const g = t.ctx, w = t.canvas.width, h = t.canvas.height;
    g.fillStyle = '#3fb37f';
    for (const [x, y, r] of [[0.32, 0.58, 0.2], [0.5, 0.45, 0.26], [0.68, 0.58, 0.2], [0.5, 0.65, 0.2]]) { g.beginPath(); g.arc(w * x, h * y, h * r, 0, Math.PI * 2); g.fill(); }
  };
`;

// --- the run ---------------------------------------------------------------------------

const WORLDS = [
  ['park', PARK],
  ['dinosaur', DINO],
  ['sea', SEA],
  ['empty', MY],
];

const { browser, page, errors } = await launch({ scale: SCALE });
await boot(page);
let n = 0;
for (const [world, scenes] of WORLDS) {
  const names = Object.keys(scenes).filter((name) => want(name, world));
  if (!names.length) continue;
  if (world !== 'park') await loadWorld(page, world);
  else await reset(page).catch(() => {});
  await inject(page);
  await page.evaluate(DRAW_HELPERS);
  // A fresh world: the previous world's snapshot must not survive into it, or the
  // first scene's tidy-up deletes everything this world just built.
  await page.evaluate(() => window.__book.baseline());
  for (const name of names) {
    const ui = UI.has(name);
    const tall = PORTRAIT.has(name);
    await page.setViewportSize(ui ? { width: 1000, height: 625 } : tall ? { width: 1000, height: 1510 } : { width: 1600, height: 1000 });
    await reset(page);
    await page.evaluate(() => window.__book.baseline());
    if (world === 'sea' || name === 'myworld-arrival') await sleep(1500);
    try {
      await scenes[name](page);
      await shot(page, `${OUT}${name}.jpg`);
      n++;
      console.log('  ok ', name);
    } catch (err) {
      console.log('  FAIL', name, err.message.split('\n')[0]);
    }
  }
}
console.log(`${n} shots`, errors.length ? errors.slice(0, 5) : '');
await browser.close();
