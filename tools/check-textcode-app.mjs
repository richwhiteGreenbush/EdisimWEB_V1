// The text-coding student path, through the real DOM, in a real browser:
// name an object, type a program at Basic Beginner (with a mistake), use Fix it and
// autocomplete, Save, reopen, rewrite at Basic Pro, look at Blocks, make one object `tell`
// another, and open a legacy JavaScript program.
//
//   npx vite --port 5199 --strictPort          (in another terminal)
//   node tools/check-textcode-app.mjs          [APP_URL=http://localhost:5183/ for HiFi]
//
// Screenshots go to /tmp/edusim-textcode/ unless SHOTS=<dir> is set.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const SHOTS = process.env.SHOTS || '/tmp/edusim-textcode';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(SHOTS, { recursive: true });

let pw;
try {
  pw = await import('playwright-core');
} catch {
  pw = await import(pathToFileURL(path.resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
}
const browser = await pw.chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
const check = (ok, what, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${!ok && detail ? `\n       ${detail}` : ''}`);
  if (!ok) failures++;
};
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const record = (id) => page.evaluate((i) => {
  const r = window.__debug.registry.get(i).record;
  return { objectName: r.objectName, programMode: r.programMode, programLevel: r.programLevel, programText: r.programText, program: r.program };
}, id);
const typeInEditor = async (text) => {
  await page.click('#program-text-input');
  await page.keyboard.type(text);
  await page.waitForTimeout(400);
};
const problems = () => page.$$eval('#program-problems .pe-card', (cards) => cards.map((c) => c.textContent));

try {
  await page.goto(APP_URL, { waitUntil: 'load' });
  // HiFi's production build has no __debug; this check runs against a dev server.
  await page.waitForFunction(() => window.__debug?.registry?.count > 5, null, { timeout: 90000 });
  await page.evaluate(() => indexedDB.databases?.());
  const ids = await page.evaluate(() => [...window.__debug.registry.items.entries()]
    .filter(([, it]) => it.record.kind === 'preset-prop' && !it.record.program?.length && !it.record.programJs)
    .slice(0, 3).map(([id]) => id));
  check(ids.length === 3, 'found three objects to program');
  const [teller, listener, legacy] = ids;

  // ---- naming ------------------------------------------------------------------------
  await page.evaluate((id) => window.__debug.objectMenu.open(id, 500, 260), listener);
  await page.click('.om-name-btn');
  await page.fill('.om-field-name input', 'robot two');
  check((await page.inputValue('.om-field-name input')) === 'robot_two', 'a space in a name becomes _');
  await page.fill('.om-field-name input', 'size');
  check(await page.isDisabled('text=Save name'), 'a reserved word cannot be a name');
  await page.fill('.om-field-name input', 'robot2');
  await shot('1-name');
  await page.click('text=Save name');
  check((await record(listener)).objectName === 'robot2', 'the name is saved on the record');
  check((await page.textContent('.om-title-row .om-title')) === 'robot2', 'the menu title shows the name');
  await page.evaluate(() => window.__debug.objectMenu.close());

  // ---- the listener, typed at Basic Beginner -------------------------------------------
  await page.evaluate((id) => window.__debug.programEditor.open(id), listener);
  check((await page.textContent('#program-title')) === 'Program: robot2', 'the Program panel shows the name');
  await page.click('.pe-mode-btn:has-text("Basic Beginner")');
  await typeInEditor('when an object says go\nsay got it');
  const listenerText = await page.inputValue('#program-text-input');
  check(listenerText === 'when an object says go\n    say got it', 'Enter after a `when` line pushes the next line in', JSON.stringify(listenerText));
  await page.click('#program-actions button:has-text("Save")');
  const lr = await record(listener);
  check(lr.programMode === 'text' && lr.programLevel === 1 && lr.program?.[0]?.type === 'whenSaid', 'Save stores text, level and the compiled blocks', JSON.stringify(lr));

  // ---- the teller: a mistake, Fix it, autocomplete ------------------------------------
  await page.evaluate((id) => window.__debug.programEditor.open(id), teller);
  await page.click('.pe-mode-btn:has-text("Basic Beginner")');
  await typeInEditor('turn 15 degrees');
  let cards = await problems();
  check(cards.length === 1 && /rotate/.test(cards[0]), 'an unknown command gets a card suggesting `rotate`', cards.join(' | '));
  await shot('2-problem');
  await page.click('.pe-card-fix');
  await page.waitForTimeout(300);
  check((await page.inputValue('#program-text-input')) === 'rotate 15 degrees', 'Fix it rewrites the line');
  check((await page.$$('#program-problems .pe-card')).length === 0, 'and the card goes');
  await page.click('#program-text-input');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('te');
  await page.waitForTimeout(150);
  const popup = await page.$$eval('.pe-complete li', (lis) => lis.map((li) => li.textContent));
  check(popup.some((t) => t.startsWith('tell')), 'typing `te` offers `tell`', popup.join(' | '));
  await shot('3-autocomplete');
  await page.keyboard.press('Enter');
  const afterTell = await page.inputValue('#program-text-input');
  check(/\ntell robot hello$/.test(afterTell), 'Enter takes the suggestion', JSON.stringify(afterTell));
  // Replace the default name and words with the real ones, through autocomplete for the name.
  await page.evaluate(() => {
    const t = document.querySelector('#program-text-input');
    t.value = t.value.replace(/tell robot hello$/, 'tell ');
    t.setSelectionRange(t.value.length, t.value.length);
  });
  await page.keyboard.type('ro');
  await page.waitForTimeout(150);
  const names = await page.$$eval('.pe-complete li', (lis) => lis.map((li) => li.textContent));
  check(names.some((t) => t.startsWith('robot2')), 'after `tell`, the world\'s object names are offered', names.join(' | '));
  await page.keyboard.press('Enter');
  await page.keyboard.type(' go');
  await page.waitForTimeout(400);
  check((await page.$$('#program-problems .pe-card')).length === 0, 'the finished program has no problems', (await problems()).join(' | '));
  await shot('4-beginner');

  // Spy on speech before saving: Save starts the program.
  await page.evaluate(() => {
    window.__said = [];
    const pm = window.__debug.programManager;
    const orig = pm.onSay;
    pm.onSay = (id, o, text) => { window.__said.push([id, text]); orig?.(id, o, text); };
  });
  await page.click('#program-actions button:has-text("Save")');
  await page.waitForTimeout(800);
  const said = await page.evaluate(() => window.__said);
  check(said.some(([id, t]) => id === teller && t === 'go'), 'the teller says go', JSON.stringify(said));
  check(said.some(([id, t]) => id === listener && t === 'got it'), 'robot2 hears it and answers', JSON.stringify(said));

  // ---- reopen, rewrite at Pro, look at Blocks ------------------------------------------
  await page.evaluate((id) => window.__debug.programEditor.open(id), teller);
  check(await page.isVisible('#program-text-input'), 'reopening a typed program opens the text');
  await page.click('.pe-mode-btn:has-text("Basic Pro")');
  check(await page.isVisible('#program-confirm'), 'moving up a level asks first');
  await shot('5-confirm');
  await page.click('text=Rewrite in Basic Pro');
  await page.waitForTimeout(300);
  const pro = await page.inputValue('#program-text-input');
  check(pro === 'rotate 15\ntell robot2 "go"\n', 'the program is rewritten at Basic Pro', JSON.stringify(pro));
  await shot('6-pro');
  await page.click('.pe-mode-btn:has-text("Blocks")');
  const blockTypes = await page.$$eval('#program-workspace .pe-block', (els) => els.map((e) => e.dataset.type));
  check(blockTypes.join(',') === 'rotate,tell', 'Blocks shows the same program', blockTypes.join(','));
  await shot('7-blocks');
  await page.click('#program-actions button:has-text("Cancel")');

  // ---- a mistake blocks Save ----------------------------------------------------------
  const savedBefore = (await record(teller)).programText;
  await page.evaluate((id) => window.__debug.programEditor.open(id), teller);
  await page.fill('#program-text-input', 'rotate 15\nmove forwrd 3\n');
  await page.dispatchEvent('#program-text-input', 'input');
  await page.click('#program-actions button:has-text("Save")');
  check(await page.isVisible('#program-panel'), 'Save refuses while a line has a problem');
  check((await record(teller)).programText === savedBefore, 'and nothing is saved');
  await page.click('#program-actions button:has-text("Cancel")');

  // ---- legacy JavaScript --------------------------------------------------------------
  await page.evaluate((id) => {
    const r = window.__debug.registry.get(id).record;
    r.programMode = 'js';
    r.programJs = 'await forever(async () => {\n  await rotate(2);\n});\n';
  }, legacy);
  await page.evaluate((id) => window.__debug.programEditor.open(id), legacy);
  check(await page.isVisible('.pe-legacy-note'), 'a JavaScript program opens read-only with a note');
  check(await page.evaluate(() => document.querySelector('#program-text-input').readOnly), 'and cannot be typed into');
  await shot('8-legacy');
  await page.click('#program-actions button:has-text("Cancel")');

  check(!errors.length, 'no page errors', errors.join(' | '));
} catch (err) {
  console.log(err.stack);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failure(s). Screenshots in ${SHOTS}` : `\nAll app checks passed. Screenshots in ${SHOTS}`);
process.exit(failures ? 1 : 0);
