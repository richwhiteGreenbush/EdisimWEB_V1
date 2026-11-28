// Opens Edusim Stages in headless Chrome, runs an optional script against it, prints every console
// error, and saves a screenshot. The everyday "does it work and what does it look like" check.
//
//   npx vite --port 5193 --strictPort          (in Stages/, in another terminal)
//   node Stages/tools/shot.mjs [out.png] [--eval "<js run in the page>"] [--wait ms] [--size 1366x768]
//
// Uses the playwright-core the print book already installs (book/node_modules), so the app itself
// does not depend on it.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const URL_ = process.env.APP_URL || 'http://localhost:5193/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i < 0 ? null : argv[i + 1]; };
const out = argv[0] && !argv[0].startsWith('--') ? argv[0] : '/private/tmp/claude-503/stages.png';
const evalJs = flag('eval');
const wait = Number(flag('wait') || 1500);
const [w, h] = (flag('size') || '1366x768').split('x').map(Number);
const path = flag('path') || '';

const { chromium } = await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(URL_ + path, { waitUntil: 'load' });
await page.waitForTimeout(wait);
const steps = flag('steps');
if (steps) {
  const mod = await import(pathToFileURL(resolve(process.cwd(), steps)).href);
  try { const r = await mod.default(page); if (r !== undefined) console.log('steps ->', JSON.stringify(r, null, 1)); } catch (e) { errors.push(`[steps] ${e.stack || e.message}`); }
}
if (evalJs) {
  try {
    const r = await page.evaluate(`(async () => { ${evalJs} })()`);
    if (r !== undefined) console.log('eval ->', typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  } catch (e) { errors.push(`[eval] ${e.message}`); }
  await page.waitForTimeout(Number(flag('after') || 800));
}
await page.screenshot({ path: out });
console.log(errors.length ? errors.join('\n') : 'no console errors');
console.log('screenshot:', out);
await browser.close();
