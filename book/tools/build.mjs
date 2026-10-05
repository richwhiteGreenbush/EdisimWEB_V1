// Build the book: assemble src/pages/*.html, check it, and print the KDP files.
//
//   node tools/build.mjs              interior PDF + cover PDF + page previews
//   node tools/build.mjs --no-pdf     checks and previews only
//
// Outputs (dist/):
//   book.html                                    the assembled book, viewable in any browser
//   The-Official-Edusim-Tutorial-and-Projects-Book-Vol-1-interior.pdf
//   The-Official-Edusim-Tutorial-and-Projects-Book-Vol-1-cover.pdf
//   preview/page-NNN.png, preview/spreads-N.jpg
//
// The checks are the KDP ones that fail silently otherwise: an exact page count, text
// running out of its safe area, a missing picture, and a picture printed below 250 ppi.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CHROME } from './lib/app.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, 'assets/shots');
const PRINT = join(ROOT, 'assets/print');
const EXPECT_PAGES = 112;
const NAME = 'The-Official-Edusim-Tutorial-and-Projects-Book-Vol-1';
const noPdf = process.argv.includes('--no-pdf');

mkdirSync(DIST, { recursive: true });
mkdirSync(PRINT, { recursive: true });

// --- 1. print copies of the pictures ------------------------------------------------
// The captures are 3200 px wide. Nothing in the book is printed wider than a page
// (6.125 in), so 2200 px is 360 ppi at full bleed and far more for anything smaller --
// and it keeps the PDF to a size KDP and a reviewer's laptop both handle comfortably.
const EXTRA = {
  'hifi-park': join(ROOT, '../docs/assets/screenshots/hifi_park.jpg'),
  'hifi-moon': join(ROOT, '../docs/assets/screenshots/hifi_moon.jpg'),
  'world-jsbasics': join(ROOT, '../docs/assets/screenshots/world_jsbasics.jpg'),
  'world-volcano': join(ROOT, '../docs/assets/screenshots/world_volcano.jpg'),
  'world-wonderland': join(ROOT, '../docs/assets/screenshots/world_wonderland.jpg'),
  'world-butterfly': join(ROOT, '../docs/assets/screenshots/world_butterfly.jpg'),
};
const sources = Object.fromEntries(readdirSync(SHOTS).filter((f) => f.endsWith('.jpg')).map((f) => [f.slice(0, -4), join(SHOTS, f)]));
Object.assign(sources, Object.fromEntries(Object.entries(EXTRA).filter(([, p]) => existsSync(p))));
let resized = 0;
for (const [name, src] of Object.entries(sources)) {
  const out = join(PRINT, `${name}.jpg`);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
  const dims = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src]).toString();
  const w = Number(dims.match(/pixelWidth: (\d+)/)[1]);
  const h = Number(dims.match(/pixelHeight: (\d+)/)[1]);
  if (w > h && w > 2200) execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '--resampleWidth', '2200', src, '--out', out]);
  else copyFileSync(src, out);
  resized++;
}
console.log(`pictures: ${Object.keys(sources).length} (${resized} refreshed)`);

// --- 2. assemble ------------------------------------------------------------------------
const pageFiles = readdirSync(join(SRC, 'pages')).filter((f) => f.endsWith('.html')).sort();
const body = pageFiles.map((f) => `<!-- ${f} -->\n${readFileSync(join(SRC, 'pages', f), 'utf8')}`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>The Official Edusim Tutorial &amp; Projects Book, Vol. 1</title>
<link rel="stylesheet" href="../src/book.css">
<script src="../src/book.js"></script>
</head><body>
${body}
</body></html>`;
writeFileSync(join(DIST, 'book.html'), html);

// --- 3. render and check ----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${join(DIST, 'book.html')}`);
await page.waitForFunction(() => window.__bookReady, null, { timeout: 120000 });

const report = await page.evaluate(() => {
  const pxPerIn = 96;
  const pages = [...document.querySelectorAll('section.page')];
  const problems = [];
  for (const pg of pages) {
    const n = pg.dataset.n;
    for (const safe of pg.querySelectorAll('.safe')) {
      if (safe.scrollHeight > safe.clientHeight + 1) problems.push(`p${n}: text overflows its safe area by ${((safe.scrollHeight - safe.clientHeight) / pxPerIn).toFixed(2)} in`);
      const sb = safe.getBoundingClientRect();
      for (const child of safe.children) {
        const cb = child.getBoundingClientRect();
        if (cb.right > sb.right + 1 || cb.bottom > sb.bottom + 1) problems.push(`p${n}: ${child.className || child.tagName} runs outside the safe area`);
      }
    }
    for (const img of pg.querySelectorAll('img')) {
      if (!img.naturalWidth) { problems.push(`p${n}: missing picture ${img.getAttribute('src')}`); continue; }
      const r = img.getBoundingClientRect();
      // object-fit: cover crops, so the binding dimension is whichever ratio is larger.
      const scale = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
      const ppi = 1 / (scale / pxPerIn);
      if (ppi < 250) problems.push(`p${n}: ${img.getAttribute('src').split('/').pop()} prints at ${Math.round(ppi)} ppi`);
    }
    for (const el of pg.querySelectorAll('x-shot, x-code, x-box, x-part, x-skill, x-blk')) problems.push(`p${n}: unrendered <${el.tagName.toLowerCase()}>`);
  }
  return { count: pages.length, problems };
});

console.log(`pages: ${report.count} (expected ${EXPECT_PAGES})`);
if (report.count !== EXPECT_PAGES) report.problems.unshift(`PAGE COUNT ${report.count}, expected ${EXPECT_PAGES}`);
if (errors.length) report.problems.push(...errors.map((e) => `script: ${e}`));
console.log(report.problems.length ? `${report.problems.length} problems:\n  ${report.problems.join('\n  ')}` : 'no problems');

// --- 4. previews -----------------------------------------------------------------------
const PREV = join(DIST, 'preview');
rmSync(PREV, { recursive: true, force: true });
mkdirSync(PREV, { recursive: true });
const handles = await page.$$('section.page');
for (let i = 0; i < handles.length; i++) {
  await handles[i].screenshot({ path: join(PREV, `page-${String(i + 1).padStart(3, '0')}.png`) });
}
// Spreads as a reader sees them: 1 alone on the right, then 2-3, 4-5, ...
const spreads = [[null, 1]];
for (let n = 2; n <= handles.length; n += 2) spreads.push([n, n + 1 <= handles.length ? n + 1 : null]);
const per = 6;
for (let s = 0; s < spreads.length; s += per) {
  const group = spreads.slice(s, s + per);
  const cells = group.map(([l, r]) => {
    const img = (n) => (n ? `<img src="page-${String(n).padStart(3, '0')}.png" style="width:300px;display:block">` : '<div style="width:300px"></div>');
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><div style="display:flex;gap:2px;background:#888;padding:2px">${img(l)}${img(r)}</div><div style="font:12px sans-serif;color:#fff">${l || ''}${l && r ? '–' : ''}${r || ''}</div></div>`;
  }).join('');
  const sheet = join(PREV, `_sheet.html`);
  writeFileSync(sheet, `<body style="margin:0;background:#333;padding:8px;display:grid;grid-template-columns:repeat(3,620px);gap:10px">${cells}</body>`);
  const p2 = await browser.newPage({ viewport: { width: 1900, height: 900 } });
  await p2.goto(`file://${sheet}`);
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: join(PREV, `spreads-${s / per + 1}.jpg`), fullPage: true, type: 'jpeg', quality: 80 });
  await p2.close();
  rmSync(sheet);
}

// --- 5. the PDFs ------------------------------------------------------------------------
if (!noPdf) {
  const interior = join(DIST, `${NAME}-interior.pdf`);
  await page.pdf({ path: interior, width: '6.125in', height: '9.25in', printBackground: true, preferCSSPageSize: true });
  const pdfPages = (readFileSync(interior).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`interior PDF: ${pdfPages} pages, ${(statSync(interior).size / 1e6).toFixed(1)} MB`);
  if (pdfPages !== EXPECT_PAGES) console.log(`  !! PDF has ${pdfPages} pages, expected ${EXPECT_PAGES}`);

  // The cover: back + spine + front, one sheet, with bleed all round. KDP's spine
  // width for premium colour paper is 0.002347 in a page.
  if (existsSync(join(SRC, 'cover.html'))) {
    const spine = +(report.count * 0.002347).toFixed(4);
    const width = 0.125 + 6 + spine + 6 + 0.125;
    const cover = await browser.newPage();
    await cover.goto(`file://${join(SRC, 'cover.html')}?spine=${spine}`);
    await cover.waitForFunction(() => window.__coverReady, null, { timeout: 60000 });
    const coverPdf = join(DIST, `${NAME}-cover.pdf`);
    await cover.pdf({ path: coverPdf, width: `${width}in`, height: '9.25in', printBackground: true, pageRanges: '1' });
    await cover.setViewportSize({ width: Math.round(width * 96), height: Math.round(9.25 * 96) });
    await cover.screenshot({ path: join(PREV, 'cover.png') });
    console.log(`cover PDF: ${width.toFixed(4)} x 9.25 in (spine ${spine} in)`);
  }
}

await browser.close();
process.exitCode = report.problems.length ? 1 : 0;
