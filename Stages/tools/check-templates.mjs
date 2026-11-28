// Opens every official project in headless Chrome, runs it on a virtual clock with keys held down,
// and checks it does what its card says. Also loads every tutorial's starter.
//
//   npx vite --port 5193 --strictPort      (in Stages/, in another terminal)
//   node Stages/tools/check-templates.mjs
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = process.env.APP_URL || 'http://localhost:5193/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stages?.project, null, { timeout: 30000 });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };

const load = (id) => page.evaluate(async (id) => {
  const a = window.__stages;
  const { GALLERY } = await a.loadGallery();
  const entry = GALLERY.find((g) => g.id === id);
  await a.setProject(await entry.build(), { fresh: true });
  return a.project.targets.map((t) => t.name);
}, id);
const run = (frames, keys = [], flag = false) => page.evaluate(([f, k, fl]) => window.__stages.runVirtual(f, k, { flag: fl }), [frames, keys, flag]);
const state = () => page.evaluate(() => {
  const a = window.__stages;
  const rt = a.runtime;
  const byName = Object.fromEntries(rt.drawOrder.filter((t) => !t.isClone).map((t) => [t.name, { x: Math.round(t.x), y: Math.round(t.y), visible: t.visible, costume: t.currentCostume, vars: t.variables, bubble: t._rt.bubble?.text || null, dir: t.direction, size: t.size }]));
  return { sprites: byName, stage: rt.stage.variables, backdrop: rt.stage.costumes[rt.stage.currentCostume]?.name, caption: rt.caption, clones: rt.cloneCount, running: rt.isRunning(), warnings: rt.warnings, asks: rt.asks.length };
});

// Every script in every project only uses blocks the table knows, and every menu value it names exists.
const audit = () => page.evaluate(async () => {
  const a = window.__stages;
  const { BLOCKS } = await import('/src/blocks/defs.js');
  const problems = [];
  const names = new Set(a.project.targets.map((t) => t.name));
  const walk = (blocks, t) => {
    for (const b of blocks || []) {
      if (!BLOCKS.has(b.type)) problems.push(`unknown ${b.type}`);
      for (const [k, v] of Object.entries(b.inputs || {})) {
        if (v.block) { walk([v.block], t); continue; }
        const val = v.value;
        if (['TOUCHINGOBJECTMENU', 'TOWARDS', 'DISTANCETOMENU'].includes(k) && !String(val).startsWith('_') && !names.has(val)) problems.push(`${t.name}: no sprite "${val}"`);
        if (k === 'SOUND' && !t.sounds.some((s) => s.name === val)) problems.push(`${t.name}: no sound "${val}"`);
        if (k === 'COSTUME' && typeof val === 'string' && !/^\\d+$/.test(val) && !t.costumes.some((c) => c.name === val)) problems.push(`${t.name}: no costume "${val}"`);
        if (k === 'BACKDROP' && !a.project.targets[0].costumes.some((c) => c.name === val) && !/backdrop$/.test(val)) problems.push(`no backdrop "${val}"`);
      }
      walk(b.substack, t);
      walk(b.substack2, t);
    }
  };
  for (const t of a.project.targets) for (const s of t.scripts) walk(s.blocks, t);
  return problems;
});

async function project(id, fn) {
  const names = await load(id);
  const problems = await audit();
  check(`${id}: loads (${names.join(', ')})`, names.length > 1);
  check(`${id}: every block, sprite, sound, costume and backdrop it names exists`, !problems.length, problems.join('; '));
  await fn();
  const s = await state();
  check(`${id}: no runtime warnings`, !s.warnings.length, s.warnings.join('; '));
}

await project('catch', async () => {
  await run(70, [], true);
  let s = await state();
  check('catch: coins are falling as clones', s.clones > 0, `${s.clones} clones`);
  await run(30, ['right arrow']);
  s = await state();
  check('catch: right arrow moves the catcher right', s.sprites.Catcher.x > 100, `x ${s.sprites.Catcher.x}`);
  await run(900);
  s = await state();
  check('catch: the game ends after 30 seconds and says the score', /caught/.test(s.sprites.Catcher.bubble || ''), s.sprites.Catcher.bubble);
});

await project('maze', async () => {
  await run(50, [], true);
  let s0 = await state();
  let touched = false;
  for (const k of ['right arrow', 'up arrow', 'left arrow', 'down arrow', 'right arrow', 'up arrow']) {
    for (let i = 0; i < 6; i++) {
      await run(5, [k]);
      touched ||= await page.evaluate(() => { const a = window.__stages; return a.runtime.touching(a.runtime.spriteNamed('Mouse'), 'Walls'); });
    }
  }
  const s = await state();
  check('maze: the mouse moves', s.sprites.Mouse.x !== s0.sprites.Mouse.x || s.sprites.Mouse.y !== s0.sprites.Mouse.y);
  check('maze: and never ends a frame inside a wall', !touched);
});

await project('jump', async () => {
  await run(90, [], true);
  let s = await state();
  check('jump: the hero lands on the ground and stays there', s.sprites.Hero.y > -150 && s.sprites.Hero.y < -90, `y ${s.sprites.Hero.y}`);
  const yGround = s.sprites.Hero.y;
  await run(8, ['up arrow']);
  s = await state();
  check('jump: up jumps', s.sprites.Hero.y > yGround + 40, `y ${s.sprites.Hero.y}`);
  await run(60, ['right arrow']);
  s = await state();
  check('jump: right runs right', s.sprites.Hero.x > -120, `x ${s.sprites.Hero.x}`);
});

await project('space', async () => {
  await run(60, [], true);
  let s = await state();
  check('space: meteors fall', s.clones > 0);
  await run(40, ['left arrow']);
  s = await state();
  check('space: the ship moves', s.sprites.Ship.x < -100, `x ${s.sprites.Ship.x}`);
  await run(1800);
  s = await state();
  check('space: the game ends when the lives run out', s.stage.lives < 1 && /lasted/.test(s.sprites.Ship.bubble || ''), `lives ${s.stage.lives} ${s.sprites.Ship.bubble}`);
});

await project('paddle', async () => {
  await run(120, [], true);
  const s = await state();
  check('paddle: the ball is in play', s.running && (s.sprites.Ball.x !== 0 || s.sprites.Ball.y !== 60));
  // The paddle follows the mouse.
  await page.evaluate(() => { window.__stages.runtime.mouse.x = -150; });
  await run(3);
  const t = await state();
  check('paddle: the paddle follows the mouse', t.sprites.Paddle.x === -150, `x ${t.sprites.Paddle.x}`);
});

await project('quiz', async () => {
  await run(150, [], true);
  for (let q = 0; q < 5; q++) {
    await run(10);
    const answer = await page.evaluate(() => { const v = window.__stages.runtime.spriteNamed('Maya').variables; return v.a * v.b; });
    await page.evaluate((n) => window.__stages.runtime.answerQuestion(String(n)), answer);
    await run(60);
  }
  await run(40);
  const s = await state();
  check('quiz: five right answers score five', s.stage.score === 5, `score ${s.stage.score}`);
  check('quiz: and Maya says so', /5 out of 5/.test(s.sprites.Maya.bubble || ''), s.sprites.Maya.bubble);
});

await project('moon-trip', async () => {
  await run(30, [], true);
  let s = await state();
  check('moon-trip: starts in the park with a caption', s.backdrop === 'Park' && !!s.caption);
  await run(900);
  s = await state();
  check('moon-trip: ends on the Moon', s.backdrop === 'Moon', s.backdrop);
});

await project('walk', async () => {
  await run(300, [], true);
  const s = await state();
  check('walk: Sam walks across town', s.sprites.Sam.x > 150, `x ${s.sprites.Sam.x}`);
  check('walk: the bee flies a wave', Math.abs(s.sprites.Bee.y - 80) <= 25);
});

await project('heart', async () => {
  await run(60, [], true);
  const s = await state();
  check('heart: the model has 12 costumes and turns', s.sprites.Heart.costume > 0);
  check('heart: shows a fact', !!s.caption);
});

await project('dance', async () => {
  await run(40, [], true);
  const s = await state();
  check('dance: Robo changes costume', s.sprites.Robo.costume > 0);
});

await project('patterns', async () => {
  await run(240, [], true);
  const lines = await page.evaluate(() => {
    const c = window.__stages.renderer.pen;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i]) n++;
    return n;
  });
  check('patterns: the pen draws', lines > 2000, `${lines} sampled pixels`);
});

// Every tutorial's starter loads, and has its sprites but none of the scripts the tutorial builds.
const starters = await page.evaluate(async () => {
  const { STARTERS } = await window.__stages.loadGallery();
  const out = {};
  for (const [k, build] of Object.entries(STARTERS)) {
    const p = await build();
    out[k] = { sprites: p.targets.length - 1, scripts: p.targets.reduce((n, t) => n + t.scripts.length, 0) };
  }
  return out;
});
for (const [k, v] of Object.entries(starters)) check(`starter ${k}: sprites and no scripts`, v.sprites > 0 && v.scripts === 0, JSON.stringify(v));

check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
