// A headless screenshot of the HiFi app, driven straight over the Chrome DevTools Protocol.
//
//   node tools/turkle/shot.mjs "<query string>" <out.png> [holdSeconds] [width] [height]
//
// TS_SHOT_BASE points it at something other than the local dev server -- the live site, for
// instance, which is the only way to check that a deploy actually landed.
//
// No puppeteer and no install: node's own global WebSocket is enough to speak CDP, and a
// screenshot is four messages. It waits on `window.__ready`, which the render loop sets once
// the world has loaded, the ground mask has settled and every ORM texture is in -- and then
// HOLDS, because the bridge's material sweep runs on a 600-frame clock and a shot taken at
// three seconds cannot see a bug that fires at ten.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [query, out, hold = '6', W = '1600', H = '900'] = process.argv.slice(2);
if (!query || !out) { console.error('usage: node tools/turkle/shot.mjs "<query>" <out.png> [holdSeconds]'); process.exit(1); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333 + (process.pid % 200);
const profile = mkdtempSync(join(tmpdir(), 'ts-shot-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  // WebGL in headless needs a backend. On macOS the NEW headless mode can reach the real
  // GPU through ANGLE/Metal, which renders a world like this in seconds; SwiftShader is the
  // fallback and is correct but takes minutes on a scene with a million-triangle terrain in
  // it. TS_SHOT_SOFTWARE=1 forces the fallback.
  ...(process.env.TS_SHOT_SOFTWARE
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']),
  '--disable-dev-shm-usage', '--mute-audio', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const tabs = await r.json();
      const page = tabs.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`Chrome never opened a debugging port.\n${chromeErr.slice(-800)}`);
}

const ws = new WebSocket(await endpoint());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`);
};
const send = (method, params = {}) => new Promise((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: Number(W), height: Number(H), deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: (process.env.TS_SHOT_BASE || 'http://localhost:5183/') + '?' + query });

let ready = false;
for (let i = 0; i < 600; i++) {
  await sleep(500);
  if (await evaluate('!!window.__ready')) { ready = true; break; }
}
if (!ready) { console.error('NEVER READY after 5 minutes'); }
console.log('ready:', ready, 'clean:', await evaluate('window.__readyClean'));
await sleep(Number(hold) * 1000);

const stats = await evaluate(`(() => {
  const d = window.__debug; if (!d) return null;
  const s = d.bscene;
  return JSON.stringify({
    fps: Math.round(d.engine.getFps()),
    meshes: s.meshes.length,
    activeMeshes: s.getActiveMeshes().length,
    materials: s.materials.length,
    textures: s.textures.length,
    lights: s.lights.length,
    records: d.registry.count,
    drawCalls: s.getEngine()._drawCalls ? s.getEngine()._drawCalls.current : null,
  });
})()`);
console.log('stats:', stats);
for (const l of logs.slice(-40)) console.log('  console', l);

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('wrote', out);
ws.close();
chrome.kill();
process.exit(0);
