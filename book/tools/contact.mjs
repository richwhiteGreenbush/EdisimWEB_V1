// A contact sheet of captured shots, for reviewing a batch at a glance.
//   node tools/contact.mjs out.jpg name1 name2 ...   (names without .jpg; none = all)
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CHROME } from './lib/app.mjs';
const [out, ...names] = process.argv.slice(2);
const dir = process.env.CONTACT_DIR ? process.env.CONTACT_DIR.replace(/\/?$/, '/') : new URL('../assets/shots/', import.meta.url).pathname;
const list = names.length ? names : readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort();
const html = `<body style="margin:0;background:#222;font:14px sans-serif;color:#fff;display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px">${list.map((n) => `<figure style="margin:0"><img src="file://${dir}${n}.jpg" style="width:100%;display:block"><figcaption>${n}</figcaption></figure>`).join('')}</body>`;
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const tmp = `${dir}_contact.html`;
writeFileSync(tmp, html);
await p.goto(`file://${tmp}`, { waitUntil: 'load' });
unlinkSync(tmp);
await p.screenshot({ path: out, fullPage: true, type: 'jpeg', quality: 80 });
await b.close();
