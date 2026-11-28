// Holds Convert to 3D World to its promise: a project runs the SAME in 3D as in 2D.
//
//   npx vite --port 5193 --strictPort      (in Stages/)
//   npx vite --port 5173 --strictPort      (in the repo root: the main app)
//   node Stages/tools/check-stages3d.mjs
//
// For every official project it builds the project in Stages, converts it into a world in the main
// app, and runs both on one virtual clock with the same dice and the same keys held, comparing every
// sprite's position, direction, costume, size and visibility, the clones and the variables. They run
// the same runtime, so any difference is a bug in how the 3D stage hosts it. It also checks that each
// sprite is drawn where its stage coordinates say (the 2D-to-3D mapping), that a world file round
// trip keeps the project byte for byte, that handoff tokens are single-use and shape-checked, and
// that the object menu offers Play and Edit in Stages.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STAGES = process.env.STAGES_URL || 'http://localhost:5193/';
const APP = process.env.APP_URL || 'http://localhost:5173/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail && !ok ? `  (${detail})` : ''}`); if (!ok) failures++; };

const stagesPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await stagesPage.goto(STAGES, { waitUntil: 'load' });
await stagesPage.waitForFunction(() => window.__stages?.project, null, { timeout: 30000 });
const appPage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const appErrors = [];
appPage.on('pageerror', (e) => appErrors.push(e.message));
await appPage.goto(APP, { waitUntil: 'load' });
await appPage.waitForFunction(() => window.__debug?.registry?.count > 0, null, { timeout: 60000 });
await appPage.waitForTimeout(1500);

// The key schedule both runs follow: which keys are held during each frame.
const KEYS = (f) => (f % 90 < 30 ? ['right arrow'] : f % 90 < 50 ? ['up arrow'] : f % 90 < 70 ? ['left arrow'] : []);
const FRAMES = 150;
const CHECKPOINTS = [1, 30, 75, 150];

const SNAPSHOT = `(rt) => ({
  clones: rt.cloneCount,
  stage: JSON.stringify(rt.stage.variables), backdrop: rt.stage.currentCostume, caption: rt.caption || '',
  sprites: rt.drawOrder.map((t) => [t.isClone ? 'clone:' + t.original.name : t.name, Math.round(t.x * 1000) / 1000, Math.round(t.y * 1000) / 1000,
    Math.round(t.direction * 1000) / 1000, t.currentCostume, Math.round(t.size * 1000) / 1000, t.visible, JSON.stringify(t.variables || {}), t._rt.bubble?.text || '']),
})`;

const PLAN = {
  catch: ['set', 'life'], jump: ['set', 'huge'], space: ['set', 'small'], maze: ['board', 'life'], paddle: ['board', 'small'],
  quiz: ['set', 'life'], 'moon-trip': ['set', 'life'], walk: ['set', 'life'], heart: ['set', 'life'], dance: ['set', 'huge'], patterns: ['board', 'life'],
};

for (const [id, [layout, size]] of Object.entries(PLAN)) {
  // 2D: build the project, save its text, then run it.
  const twoD = await stagesPage.evaluate(async ([id, frames, cps, keysSrc, snapSrc]) => {
    const a = window.__stages;
    const keys = eval(keysSrc);
    const snap = eval(snapSrc);
    const { GALLERY } = await a.loadGallery();
    const project = await GALLERY.find((g) => g.id === id).build();
    await a.setProject(project, { fresh: true });
    const { toFileText } = await import('/src/project/Project.js');
    const text = await toFileText(a.project);
    let seed = 7;
    a.runtime.host.random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    a.exporting = true;
    a.virtualTime = 0;
    a.runtime.greenFlag();
    const out = {};
    for (let f = 1; f <= frames; f++) {
      a.runtime.keys = new Set(keys(f));
      a.runtime.step();
      a.virtualTime += 1 / 30;
      if (cps.includes(f)) out[f] = snap(a.runtime);
    }
    a.exporting = false;
    a.runtime.stopAll();
    return { text, out };
  }, [id, FRAMES, CHECKPOINTS, KEYS.toString(), SNAPSHOT]);

  // 3D: convert the same text into a world, then run it the same way.
  const threeD = await appPage.evaluate(async ([text, layout, size, frames, cps, keysSrc, snapSrc]) => {
    const keys = eval(keysSrc);
    const snap = eval(snapSrc);
    const d = window.__debug;
    d.worldStore.setChanged(false);
    await d.stagesLink.convert({ type: 'convert', title: 'check', layout, size, preset: 'empty', projectText: text });
    const root = d.registry.getRootObjects().find((o) => o.userData.stagesProject);
    const stage = root.userData.stagesProject;
    let vt = 0;
    let seed = 7;
    stage.clock = () => vt;
    stage.dice = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    stage.started = false; // stepped here, not by the frame loop
    stage.runtime.timerStart = 0;
    stage.runtime.greenFlag();
    const out = {};
    const mapping = [];
    for (let f = 1; f <= frames; f++) {
      stage.runtime.keys = new Set(keys(f));
      stage.runtime.step();
      vt += 1 / 30;
      stage.sync(d.camera);
      if (cps.includes(f)) {
        out[f] = snap(stage.runtime);
        // Where each sprite is drawn, read back into stage coordinates.
        root.updateMatrixWorld(true);
        for (const [t, node] of stage.nodes) {
          if (!node.pivot.visible) continue;
          const world = node.pivot.getWorldPosition(new d.THREE.Vector3());
          let x;
          let y;
          if (node.pivot.parent === stage.plane) {
            const local = stage.plane.worldToLocal(world.clone());
            x = local.x; y = local.y;
          } else {
            const local = root.worldToLocal(world.clone());
            x = local.x / stage.step; y = -local.z / stage.step;
          }
          mapping.push(Math.max(Math.abs(x - t.x), Math.abs(y - t.y)));
        }
      }
    }
    const nodesMatch = stage.nodes.size === stage.runtime.drawOrder.length;
    stage.runtime.stopAll();
    return { out, worst: Math.max(0, ...mapping), nodesMatch, warnings: stage.runtime.warnings, models: [...stage.nodes.values()].filter((n) => n.model).length };
  }, [twoD.text, layout, size, FRAMES, CHECKPOINTS, KEYS.toString(), SNAPSHOT]);

  let firstDiff = '';
  for (const f of CHECKPOINTS) {
    const a = JSON.stringify(twoD.out[f]);
    const b = JSON.stringify(threeD.out[f]);
    if (a !== b && !firstDiff) firstDiff = `frame ${f}: 2D ${a.slice(0, 160)} | 3D ${b.slice(0, 160)}`;
  }
  check(`${id} (${layout}, ${size}): runs identically in 2D and 3D for ${FRAMES} frames`, !firstDiff, firstDiff);
  check(`${id}: every sprite is drawn where its stage coordinates say`, threeD.worst < 0.01, `worst ${threeD.worst}`);
  check(`${id}: one 3D object per sprite and clone`, threeD.nodesMatch);
  check(`${id}: no runtime warnings in 3D`, !threeD.warnings.length, threeD.warnings.join('; '));
  if (id === 'heart') check('heart: the Model Database sprite comes back as the real model', threeD.models === 1, `${threeD.models} models`);
}

// The dialog's choices, in Stages.
const dialog = await stagesPage.evaluate(async () => {
  const a = window.__stages;
  const { GALLERY } = await a.loadGallery();
  const m = await import('/src/export/To3D.js');
  const moon = await GALLERY.find((g) => g.id === 'moon-trip').build();
  const maze = await GALLERY.find((g) => g.id === 'maze').build();
  return { worlds: m.worldsInProject(moon), mazeLayout: m.defaultLayout(maze), moonLayout: m.defaultLayout(moon) };
});
check('a story set in the Park and on the Moon offers both worlds, the current one first', JSON.stringify(dialog.worlds) === '["park","moon"]', JSON.stringify(dialog.worlds));
check('a maze on a plain backdrop defaults to a board, a scene to a set', dialog.mazeLayout === 'board' && dialog.moonLayout === 'set');

// A world file round trip, the handoff rules, and the object menu, in the main app.
const misc = await appPage.evaluate(async () => {
  const d = window.__debug;
  const item = [...d.registry.getRootObjects()].map((o) => d.registry.get(d.registry.resolveRoot(o))).find((i) => i?.record?.kind === 'stages-project');
  const before = await item.record.files[0].data.text();
  const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(item.record.files[0].data); });
  const fileText = JSON.stringify({ format: 'edusim-world', version: 1, records: [{ ...item.record, files: [{ name: 'p.json', type: 'application/json', dataBase64: b64 }] }] });
  const { parseWorldPayload } = await import('/src/WorldFile.js');
  const records = parseWorldPayload(fileText);
  await d.worldStore.loadFromRecords(records);
  const again = d.registry.getRootObjects().find((o) => o.userData.stagesProject);
  const after = again ? await d.registry.get(d.registry.resolveRoot(again)).record.files[0].data.text() : '';
  const h = await import('/Stages/src/project/handoff.js');
  const token = await h.putHandoff({ type: 'convert', projectText: 'x' });
  const first = await h.takeHandoff(token);
  const second = await h.takeHandoff(token);
  const bad = await h.takeHandoff('../../etc/passwd');
  // The object menu.
  const id = d.registry.resolveRoot(again);
  d.objectMenu.open(id, 400, 300);
  const rows = [...document.querySelectorAll('#object-menu button, .object-menu button')].map((b) => b.textContent);
  d.objectMenu.close();
  return { same: before === after && !!after, single: !!first && second === null, badRefused: bad === null, rows };
});
check('a world file round trip keeps the project byte for byte', misc.same);
check('a handoff token works once', misc.single);
check('a token of the wrong shape is refused', misc.badRefused);
check('the object menu offers Play and Edit in Stages', misc.rows.some((r) => r.includes('Play')) && misc.rows.some((r) => r.includes('Edit in Stages')), misc.rows.join(' | '));
check('no page errors in the main app', !appErrors.length, appErrors.join(' | '));

await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
