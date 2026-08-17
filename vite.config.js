import { defineConfig } from 'vite';

export default defineConfig({
  // RELATIVE asset urls, not the default '/'.
  //
  // The app is now served from two places: the origin root on Railway, and /app/ on the
  // gallery's own host (deploy.sh publishes it there so "Open this world in Edusim" can
  // fetch same-origin -- see WorldLink.js). With the default base the built bundle is
  // referenced as /assets/index-xxxx.js, which is correct at the root and a 404 one
  // directory down. './' is correct in both places.
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
