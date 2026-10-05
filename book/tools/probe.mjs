// Measure, in the running app, the behaviours the book's Part 4 text depends on.
//   node tools/probe.mjs
import { launch, boot, loadWorld, stand, chrome, shot } from './lib/app.mjs';

const { browser, page, errors } = await launch({ scale: 1 });
await boot(page);
await loadWorld(page, 'empty');
await chrome(page, {});

const result = await page.evaluate(async () => {
  const { worldStore, registry, programManager } = window.__debug;
  const B = await import('/src/BlockDefs.js');
  const blk = (type, params = {}, children) => {
    const b = B.createBlockInstance(type);
    Object.assign(b.params, params);
    if (children) b.children = children;
    return b;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A model built the way a student builds one: pieces in the world, rendered with rotation 0.
  // Its "nose" piece sits at +Z of the body.
  const model = async (x) => {
    const record = {
      id: crypto.randomUUID(), kind: 'built-model', createdAt: Date.now(), files: [],
      parts: [
        { shape: 'cube', color: '#e0455f', fileIndex: null, position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        { shape: 'sphere', color: '#3d8bf2', fileIndex: null, position: [0, 1, 1.4], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5] },
      ],
      transform: { position: [x, 0, -10], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };
    await worldStore.rehydrateOne(record);
    return record.id;
  };

  const run = async (id, program, ms) => {
    const item = registry.get(id);
    const p0 = item.object3D.position.clone();
    programManager.start(id, program, item.object3D);
    await sleep(ms);
    const p1 = item.object3D.position;
    return { dx: +(p1.x - p0.x).toFixed(2), dz: +(p1.z - p0.z).toFixed(2), rotY: +item.object3D.rotation.y.toFixed(3) };
  };

  const a = await model(-6);
  const forward = await run(a, [blk('moveForward', { feet: 5 })], 800);
  const b = await model(0);
  const turnThenForward = await run(b, [blk('rotate', { degrees: 90 }), blk('moveForward', { feet: 5 })], 800);
  const c = await model(6);
  const square = await run(c, [blk('repeat', { count: 4 }, [blk('glide', { feet: 4, seconds: 0.3 }), blk('rotate', { degrees: 90 })])], 4000);
  const d = await model(12);
  const dup = registry.count;
  await run(d, [blk('repeat', { count: 3 }, [blk('duplicate', { offset: 15 })])], 1500);
  const dupAfter = registry.count;
  return { forward, turnThenForward, square, duplicates: dupAfter - dup };
});
console.log(JSON.stringify(result, null, 1));
console.log('page errors:', errors.slice(0, 5));
await browser.close();
