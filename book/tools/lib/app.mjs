// Drive the real Edusim app (the Vite dev server, which exposes window.__debug) from a
// script, so every screenshot in the book is the app itself rather than a mock-up.
//
//   APP_URL   default http://localhost:5199/  (`npx vite --port 5199` from the repo root)
//
// Chrome is the system install, run headless on the real GPU through ANGLE/Metal -- the
// same choice tools/turkle/shot.mjs makes. SwiftShader works too but takes minutes a frame
// on the bigger worlds.
import { chromium } from 'playwright-core';

export const APP_URL = process.env.APP_URL || 'http://localhost:5199/';
export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// 1600 x 1000 CSS pixels at 2x = 3200 x 2000 pixels: 300 ppi up to 10.6 in wide, which
// covers everything up to a full-bleed spread.
export const VIEW = { width: 1600, height: 1000 };

export async function launch({ scale = 2 } = {}) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio'],
  });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: scale });
  // The camera must not fly itself in or bob: a screenshot needs the frame we set.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('edusim-settings', JSON.stringify({
        motion: 'auto', wind: true, cameraEffects: false, cameraMoves: false,
      }));
    } catch { /* storage blocked: the defaults only cost a swoop */ }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { browser, context, page, errors };
}

// A world streams its records in one at a time, so "it has some objects" is not "it is
// built". Wait until the count has held still for a while and the bulk load is over --
// a scene that snapshots the world any earlier treats the late arrivals as its own and
// deletes them when it tidies up.
export async function settle(page, quietMs = 2000) {
  let last = -1;
  for (;;) {
    const { count, bulk } = await page.evaluate(() => ({
      count: window.__debug.registry.count,
      bulk: !!window.__debug.registry.bulkLoading,
    }));
    if (count === last && !bulk) break;
    last = count;
    await page.waitForTimeout(quietMs);
  }
  await page.waitForTimeout(800);
}

// Boot and wait until the first world (the Park, on a fresh profile) is built.
export async function boot(page) {
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__debug && window.__debug.registry.count > 30, null, { timeout: 120000 });
  await settle(page);
}

export async function loadWorld(page, name) {
  await page.evaluate(async (n) => {
    window.__debug.menuActions.loadPreset(n);
  }, name);
  await page.waitForFunction(() => window.__debug.registry.count > 3, null, { timeout: 120000 });
  await settle(page);
}

// Stand somewhere. yaw 0 looks down -Z; positive yaw turns the view LEFT (toward -X).
export async function stand(page, { x = 0, z = 6, yaw = 0, pitch = 0, eye } = {}) {
  await page.evaluate(({ x, z, yaw, pitch, eye }) => {
    const { player } = window.__debug;
    if (eye != null) player.setEyeHeight(eye);
    player.resetTo({ x, z, yaw, pitch });
  }, { x, z, yaw, pitch, eye });
  await page.waitForTimeout(300);
}

// Hide (or show) the app's own chrome for a clean picture.
export async function chrome(page, { menu = false, toasts = false, touch = false } = {}) {
  await page.evaluate(({ menu, toasts, touch }) => {
    let style = document.getElementById('__book-style');
    if (!style) {
      style = document.createElement('style');
      style.id = '__book-style';
      document.head.appendChild(style);
    }
    style.textContent = [
      menu ? '' : '#menu { display: none !important; }',
      toasts ? '' : '#toast-host { display: none !important; }',
      touch ? '' : '#touch-nav { display: none !important; }',
    ].join('\n');
  }, { menu, toasts, touch });
}

export async function shot(page, path, { quality = 88, clip } = {}) {
  await page.waitForTimeout(400);
  await page.screenshot({ path, type: 'jpeg', quality, clip });
}

// window.__book: the scene helpers (tools/lib/page-helpers.js).
export async function inject(page) {
  const has = await page.evaluate(() => !!window.__book);
  if (!has) await page.addScriptTag({ path: new URL('./page-helpers.js', import.meta.url).pathname });
}

// Stand at (x, z) and look at a point. Eye height is the app's 5 ft unless given.
export async function look(page, { x, z, at, eye = 5 }) {
  await page.evaluate(({ x, z, at, eye }) => {
    const { player } = window.__debug;
    player.setEyeHeight(eye);
    const gy = player.groundHeightAt(x, z);
    const [tx, ty, tz] = at;
    const dx = tx - x, dz = tz - z, dy = ty - (gy + eye);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    player.resetTo({ x, z, yaw, pitch });
  }, { x, z, at, eye });
  await page.waitForTimeout(350);
}
