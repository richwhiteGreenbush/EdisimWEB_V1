import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// HiFi runs the main app's own logic (src/ one directory up) against a Babylon renderer --
// see src/bridge/ThreeBridge.js. Two things follow from importing across that boundary:
//
//  * `three` must resolve to ONE copy. The main app's files find it in the repo root's
//    node_modules; anything under HiFi/ would otherwise find a second copy of its own, and
//    two copies break every `instanceof` and `isMesh` check between them. The alias pins both
//    to the root install, which is why `npm install` has to have been run up there too.
//  * the dev server has to be allowed to serve files from outside this directory.
const root = resolve(__dirname, '..');
export default defineConfig({
  base: './',
  resolve: {
    alias: [{ find: /^three$/, replacement: resolve(root, 'node_modules/three') }, { find: /^three\//, replacement: `${resolve(root, 'node_modules/three')}/` }],
    dedupe: ['three'],
  },
  server: { port: 5183, fs: { allow: [root] } },
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
  build: { chunkSizeWarningLimit: 12000 },
});
