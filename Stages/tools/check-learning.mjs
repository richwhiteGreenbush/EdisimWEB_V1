// Builds and runs every LEARNING project (src/templates/learning/) in headless Chrome on the virtual
// clock, driving it the way its spec's `check` says (frames with keys held, a key press that starts
// "when key pressed" scripts, sprite clicks, answers to questions), and checks that it builds, that every script uses real blocks, sprites, sounds and
// costumes, that the runtime raises no warnings and the page no errors, that something visibly
// happens, and that any `expect` holds.
//
//   npx vite --port 5193 --strictPort      (in Stages/, in another terminal)
//   node Stages/tools/check-learning.mjs [--only id,id] [--file earth] [--shots dir]
//
// --shots writes one picture per project at the end of its run, to look at.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = process.env.APP_URL || 'http://localhost:5193/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : process.argv[i + 1]; };
const only = arg('--only')?.split(',');
const file = arg('--file');
const shots = arg('--shots');
if (shots) mkdirSync(shots, { recursive: true });

const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
let pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) pageErrors.push(m.text()); });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForFunction(() => window.__stages?.project, null, { timeout: 30000 });

const ids = await page.evaluate(async ([only, file]) => {
  const { LEARNING_SPECS } = await import('/src/templates/learning/index.js');
  const mod = file ? (await import(`/src/templates/learning/${file}.js`)).default.map((s) => s.id) : null;
  return LEARNING_SPECS.map((s) => s.id).filter((id) => (!only || only.includes(id)) && (!mod || mod.includes(id)));
}, [only, file]);

if (shots) await page.evaluate(() => { window.__learningShot = true; });
let failures = 0;
let passed = 0;
const seen = new Set();
for (const id of ids) {
  pageErrors = [];
  const problems = [];
  if (seen.has(id)) problems.push('duplicate id');
  seen.add(id);
  const r = await page.evaluate(async (id) => {
    const a = window.__stages;
    const { GALLERY } = await a.loadGallery();
    const entry = GALLERY.find((g) => g.id === id);
    const out = { problems: [] };
    const spec = entry.spec;
    for (const k of ['title', 'kind', 'blurb', 'learn', 'subject']) if (!spec[k]) out.problems.push(`no ${k}`);
    if (!Array.isArray(spec.grades) || spec.grades.length !== 2 || spec.grades[0] < 3 || spec.grades[1] > 12 || spec.grades[0] > spec.grades[1]) out.problems.push('grades must be [min, max] within 3-12');
    const { SUBJECTS } = await import('/src/templates/learning/kit.js');
    if (!SUBJECTS.some(([s]) => s === spec.subject)) out.problems.push(`unknown subject "${spec.subject}"`);
    if (!['Simulation', 'Story', 'Quiz', 'Game', 'Animation', 'Art'].includes(spec.kind)) out.problems.push(`unknown kind "${spec.kind}"`);
    const t0 = performance.now();
    try {
      await a.setProject(await entry.build(), { fresh: true });
    } catch (e) {
      out.problems.push(`build: ${e.message}`);
      return out;
    }
    out.buildMs = Math.round(performance.now() - t0);
    // Every block, sprite, sound and costume a script names exists.
    const { BLOCKS } = await import('/src/blocks/defs.js');
    const names = new Set(a.project.targets.map((t) => t.name));
    const messages = new Set();
    const heard = new Set();
    const walk = (blocks, t) => {
      for (const b of blocks || []) {
        if (!BLOCKS.has(b.type)) out.problems.push(`unknown block ${b.type}`);
        if (b.type === 'event_whenbroadcastreceived') heard.add(b.inputs.BROADCAST.value);
        for (const [k, v] of Object.entries(b.inputs || {})) {
          if (v.block) { walk([v.block], t); continue; }
          const val = v.value;
          if (['TOUCHINGOBJECTMENU', 'TOWARDS', 'DISTANCETOMENU', 'CLONE_OPTION', 'TO', 'OBJECT'].includes(k) && typeof val === 'string' && !val.startsWith('_') && !names.has(val)) out.problems.push(`${t.name}: no sprite "${val}"`);
          if (k === 'SOUND' && typeof val === 'string' && !t.sounds.some((s) => s.name === val)) out.problems.push(`${t.name}: no sound "${val}"`);
          if (k === 'COSTUME' && typeof val === 'string' && !/^\d+$/.test(val) && !t.costumes.some((c) => c.name === val)) out.problems.push(`${t.name}: no costume "${val}"`);
          if (k === 'BACKDROP' && typeof val === 'string' && !a.project.targets[0].costumes.some((c) => c.name === val) && !['next backdrop', 'previous backdrop', 'random backdrop'].includes(val)) out.problems.push(`no backdrop "${val}"`);
          if (k === 'BROADCAST' && b.type !== 'event_whenbroadcastreceived') messages.add(val);
        }
        walk(b.substack, t);
        walk(b.substack2, t);
      }
    };
    for (const t of a.project.targets) for (const s of t.scripts) walk(s.blocks, t);
    for (const m of heard) if (!messages.has(m)) out.problems.push(`nothing broadcasts "${m}"`);
    out.sprites = a.project.targets.length - 1;
    out.scripts = a.project.targets.reduce((n, t) => n + t.scripts.length, 0);
    return out;
  }, id);
  problems.push(...r.problems);
  if (!r.problems.some((p) => p.startsWith('build'))) {
    const run = await page.evaluate(async (id) => {
      const a = window.__stages;
      const { GALLERY } = await a.loadGallery();
      const spec = GALLERY.find((g) => g.id === id).spec;
      const rt = a.runtime;
      const snap = () => JSON.stringify({
        s: rt.drawOrder.map((t) => [t.name, Math.round(t.x), Math.round(t.y), t.visible, t.currentCostume, Math.round(t.size), Math.round(t.direction), t._rt.bubble?.text || '']),
        v: rt.stage.variables, b: rt.stage.currentCostume, c: rt.caption || '', n: rt.cloneCount,
      });
      const before = snap();
      const out = { problems: [], changed: false };
      let first = true;
      const steps = spec.check || [{ frames: 300 }];
      let maxClones = 0;
      for (const step of steps) {
        if (step.frames) {
          for (let i = 0; i < step.frames; i += 10) {
            a.runVirtual(Math.min(10, step.frames - i), step.keys || [], { flag: first });
            first = false;
            maxClones = Math.max(maxClones, rt.cloneCount);
          }
        } else if (step.press) {
          if (first) { a.runVirtual(1, [], { flag: true }); first = false; }
          rt.keyDown(step.press);
          a.runVirtual(2, [step.press]);
          rt.keys = new Set();
        } else if (step.click) {
          if (first) { a.runVirtual(1, [], { flag: true }); first = false; }
          const t = rt.spriteNamed(step.click);
          if (!t) out.problems.push(`check clicks "${step.click}", which is not a sprite`);
          else { rt.click(t); a.runVirtual(10); }
        } else if (step.answer != null) {
          if (!rt.asks.length) out.problems.push(`check answers "${step.answer}" but nothing is asking`);
          else { rt.answerQuestion(String(step.answer)); a.runVirtual(5); }
        } else if (step.expect) {
          for (const [k, v] of Object.entries(step.expect)) {
            if (String(rt.stage.variables[k]) !== String(v)) out.problems.push(`expected ${k} = ${v}, got ${rt.stage.variables[k]}`);
          }
        }
        if (snap() !== before) out.changed = true;
      }
      out.warnings = [...rt.warnings];
      out.maxClones = maxClones;
      out.caption = rt.caption || '';
      if (window.__learningShot) {
        a.draw();
        const c = document.createElement('canvas');
        c.width = 480; c.height = 360;
        a.renderer.compositeTo(c.getContext('2d'), 0, 0, 480, 360);
        out.shot = c.toDataURL('image/jpeg', 0.8);
      }
      rt.stopAll();
      return out;
    }, id).catch((e) => ({ problems: [`run: ${e.message}`], changed: false, warnings: [] }));
    problems.push(...run.problems);
    if (!run.changed) problems.push('nothing visibly happened in the run');
    if (run.warnings?.length) problems.push(...run.warnings.map((w) => `warning: ${w}`));
    if (run.maxClones >= 100) problems.push('hit the 100-clone limit');
    if (run.shot && shots) writeFileSync(resolve(shots, `${id}.jpg`), Buffer.from(run.shot.split(',')[1], 'base64'));
    r.maxClones = run.maxClones;
  }
  if (pageErrors.length) problems.push(...pageErrors.map((e) => `page error: ${e.slice(0, 160)}`));
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${id}`);
    for (const p of [...new Set(problems)]) console.log(`        - ${p}`);
  } else {
    passed++;
    console.log(`ok    ${id}  (${r.sprites} sprites, ${r.scripts} scripts, built in ${r.buildMs} ms, up to ${r.maxClones} clones)`);
  }
}
await browser.close();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
