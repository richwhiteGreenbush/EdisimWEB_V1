// Render Social Media Studio videos from the command line, with nobody at the keyboard.
//
//   npx vite --port 5199                  # in another terminal: the studio runs in the app
//   node tools/studio-render.mjs                                  # a 30s Showcase, all 3 platforms
//   node tools/studio-render.mjs --template tour --length 15 --formats reel \
//        --worlds moon,dinosaur,volcano --music playful
//   node tools/studio-render.mjs --template code --demo star --formats landscape \
//        --hook "Learn to *code* in 3D" --music-file ~/Music/track.mp3
//
// Every option the studio's own panel has is a flag here; anything not given falls back to
// the studio's defaults. Each video lands in studio-output/ with a .captions.txt beside it
// holding the Instagram, Facebook and LinkedIn captions.
//
// It drives the REAL studio in headless Chrome rather than re-implementing it, so a video
// made here is identical to one made by pressing Export: the same plan, the same frame-by-
// frame render, the same soundtrack. Chrome is the system install, run on the real GPU
// through ANGLE/Metal -- the choice book/tools/lib/app.mjs makes, and for the same reason.
//
//   APP_URL   default http://localhost:5199/
//   CHROME    default the macOS Chrome install

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// playwright-core is a dev dependency of the book, not of the app. Use the app's own if it
// ever gets one, otherwise borrow the book's rather than making every app install pull it.
async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    try {
      return await import(pathToFileURL(resolve(ROOT, 'book/node_modules/playwright-core/index.mjs')).href);
    } catch {
      console.error('playwright-core is not installed. Run `npm install` in book/ (or `npm i -D playwright-core` here).');
      process.exit(1);
    }
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key.startsWith('no-')) { out[key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = next;
    i++;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 20).join('\n'));
  process.exit(0);
}

const template = args.template || 'showcase';
const formats = String(args.formats || 'reel,portrait,square').split(',').map((s) => s.trim()).filter(Boolean);
const outDir = resolve(ROOT, args.out || 'studio-output');

// The studio reads its options from localStorage at boot, so the CLI writes them there.
const words = {};
for (const k of ['hook', 'sub', 'band']) if (typeof args[k] === 'string') words[k] = args[k];
const end = {};
for (const k of ['tagline', 'url', 'cta', 'small']) if (typeof args[k] === 'string') end[k] = args[k];
const opts = {
  template,
  length: Number(args.length || 30),
  format: formats[0],
  ...(args.worlds ? { worlds: String(args.worlds).split(',').map((s) => s.trim()) } : {}),
  ...(args.spotlight ? { spotlightWorld: args.spotlight } : {}),
  ...(args['build-world'] ? { buildWorld: args['build-world'] } : {}),
  ...(args.model ? { recipe: args.model } : {}),
  ...(args.demo ? { demo: args.demo } : {}),
  ...(args.music && args.music !== true ? { music: args.music } : {}),
  ...(args.ambience ? { ambience: args.ambience } : {}),
  ...(args.watermark === false ? { watermark: false } : {}),
  words: Object.keys(words).length ? { [template]: words } : {},
  ...(Object.keys(end).length ? { end } : {}),
};
const musicFile = typeof args['music-file'] === 'string' ? resolve(args['music-file'].replace(/^~/, process.env.HOME)) : null;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ viewport: { width: 1500, height: 940 }, acceptDownloads: true });
await context.addInitScript((o) => {
  try { localStorage.setItem('edusim-studio', JSON.stringify(o)); } catch { /* a fresh profile always has storage */ }
}, opts);
const page = await context.newPage();
page.on('pageerror', (e) => console.error('  page error:', e.message));

try {
  const url = new URL(APP_URL);
  url.searchParams.set('studio', '');
  console.log(`Opening the studio at ${url.href}`);
  await page.goto(url.href, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__studio && /Ready|failed|Could not/i.test(document.querySelector('.studio-status')?.textContent || ''),
    null,
    { timeout: 180000 },
  );

  if (musicFile) {
    const b64 = readFileSync(musicFile).toString('base64');
    const name = basename(musicFile);
    await page.evaluate(async ([data, fileName]) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const s = window.__studio;
      s.upload = { name: fileName.replace(/\.[^.]+$/, '').slice(0, 28), buffer: await s.player.decode(bytes.buffer) };
      s.opts.music = 'upload';
    }, [b64, name]);
    console.log(`Using ${name} as the music.`);
  }

  console.log(`Rendering ${template}, ${opts.length}s, as ${formats.join(' + ')}…`);
  const started = Date.now();
  const poll = setInterval(async () => {
    const status = await page.evaluate(() => document.querySelector('.studio-status')?.textContent).catch(() => null);
    if (status) process.stdout.write(`\r  ${status.padEnd(90)}`);
  }, 1000);
  const results = await page.evaluate(async (f) => {
    const list = await window.__studio.exportFormats(f);
    return list.map((r) => ({ name: r.name, size: r.size, duration: r.duration, ratio: r.format.ratio, copy: r.copy }));
  }, formats);
  clearInterval(poll);
  process.stdout.write('\n');
  if (!results.length) {
    const status = await page.evaluate(() => document.querySelector('.studio-status')?.textContent);
    throw new Error(status || 'Nothing was rendered.');
  }

  mkdirSync(outDir, { recursive: true });
  const links = await page.$$('.studio-result a[download]');
  for (const [i, r] of results.entries()) {
    const [download] = await Promise.all([page.waitForEvent('download'), links[i].click()]);
    const target = resolve(outDir, r.name);
    await download.saveAs(target);
    const captions = [
      `INSTAGRAM\n${r.copy.instagram}`,
      `FACEBOOK\n${r.copy.facebook}`,
      `LINKEDIN\n${r.copy.linkedin}`,
    ].join('\n\n---\n\n');
    writeFileSync(target.replace(/\.mp4$/, '.captions.txt'), `${captions}\n`);
    console.log(`  ${r.ratio.padEnd(5)} ${target}  (${r.duration.toFixed(1)}s, ${(r.size / 1048576).toFixed(1)} MB)`);
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s.`);
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
