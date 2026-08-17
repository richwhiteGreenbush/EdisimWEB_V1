import { defineConfig } from 'vite';

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
