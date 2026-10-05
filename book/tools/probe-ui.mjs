import { launch, boot, chrome, shot, inject, look } from './lib/app.mjs';
const out = process.argv[2];
const { browser, page, errors } = await launch({ scale: 1 });
await boot(page);
await chrome(page, { menu: true });
const info = await page.evaluate(() => {
  const m = document.getElementById('menu');
  return { html: m ? m.outerHTML.slice(0, 600) : 'no #menu', buttons: [...document.querySelectorAll('#menu button')].map(b => b.textContent.trim()).slice(0, 60) };
});
console.log(JSON.stringify(info, null, 1));
await shot(page, out);
console.log(errors);
await browser.close();
