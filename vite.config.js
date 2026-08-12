import { defineConfig } from 'vite';

export default defineConfig({
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
