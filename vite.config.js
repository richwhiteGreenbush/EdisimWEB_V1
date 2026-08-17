import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// DEV-ONLY capture endpoint, so a rendered frame can be written to disk.
//
// The gallery cards want a real 1600x1000 screenshot of each world, and there is no way to
// get one out of a browser tab by itself: a canvas can produce a data URL but the page has
// no filesystem, and a sandboxed viewer blocks a download the page starts itself. `apply:
// 'serve'` keeps this out of the production build entirely -- it is not middleware that
// ships, it is a darkroom sink attached to the dev server.
function captureSink() {
  return {
    name: 'edusim-capture-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { path, dataUrl } = JSON.parse(body);
            // Refuse to write anywhere but the repo's own screenshot folders.
            if (!/^(docs\/assets\/screenshots|scratch)\/[\w.-]+\.(jpg|png)$/.test(path)) {
              res.statusCode = 400; res.end('bad path'); return;
            }
            const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, Buffer.from(b64, 'base64'));
            res.end(JSON.stringify({ ok: true, path, bytes: Buffer.from(b64, 'base64').length }));
          } catch (e) {
            res.statusCode = 500; res.end(String(e && e.message));
          }
        });
      });
    },
  };
}

export default defineConfig({
  // RELATIVE asset urls, not the default '/'.
  //
  // The app is deployed to /app/ on the gallery's own host -- a SUBDIRECTORY, not an
  // origin root. With the default base the built bundle is referenced as
  // /assets/index-xxxx.js, which is correct at a root and a 404 one directory down, so
  // the whole app comes up blank. './' resolves against whatever directory it is mounted
  // in and is therefore correct in both, which is what serve-local.sh's second port
  // exists to keep proving.
  //
  // It has to be a subdirectory: "Open this world in Edusim" hands the app a world id and
  // the app fetches the file back out of the gallery, and that fetch has to be
  // same-origin -- see WorldLink.js.
  base: './',
  plugins: [captureSink()],
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/loaders/OBJLoader.js',
      'three/examples/jsm/loaders/MTLLoader.js',
      'three/examples/jsm/renderers/CSS3DRenderer.js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      'three/examples/jsm/effects/StereoEffect.js',
    ],
  },
});
