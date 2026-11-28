// Turning a library entry into something in the project: a sprite with its costumes, a backdrop, or
// a sound.
//
// EDUSIM'S OWN MODELS BECOME SPRITES HERE. The Model Database's builders are the main app's own
// (src/models/), so a model is built once, photographed from twelve angles against nothing, and the
// twelve pictures become its costumes: `next costume` turns it round. The pictures are made in the
// student's own browser when the model is chosen, so nothing has to be shipped for 269 models but the
// small card thumbnails the main app already has. The builders are loaded only when the Models tab is
// opened, so a student who never opens it never downloads them.
import * as THREE from 'three';
import { makeSprite, uniqueName } from '../project/Project.js';
import { costumeFromBlob, costumeFromCanvas, fetchBlob, soundFromBlob, wavBlob } from '../project/assets.js';
import { drawBackdrop } from './backdrops.js';
import { renderLibrarySound } from '../audio/soundLibrary.js';

export async function spriteFromCartoon(project, entry, { name } = {}) {
  const sprite = makeSprite(uniqueName(name || entry.name, project.targets.map((t) => t.name)), { size: entry.size || 100, library: entry.id });
  const blobs = await Promise.all(entry.costumes.map((c) => fetchBlob(c.file)));
  for (let i = 0; i < blobs.length; i++) {
    sprite.costumes.push(await costumeFromBlob(project, blobs[i], entry.costumes[i].name));
  }
  return sprite;
}

export async function backdropFromLibrary(project, entry) {
  const canvas = await drawBackdrop(entry);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
  const costume = await costumeFromBlob(project, blob, entry.name, { resolution: 2 });
  costume.library = entry.id;
  return costume;
}

// A sound is stored small: one channel at 22,050 samples a second is plenty for a game's sounds and
// keeps a project file light.
async function downmix(buffer, rate = 22050) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.max(1, Math.ceil(buffer.duration * rate)), sampleRate: rate });
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export async function soundFromLibrary(project, entry) {
  const rendered = await renderLibrarySound(entry.id);
  const small = await downmix(rendered);
  const sound = await soundFromBlob(project, wavBlob(small), entry.name);
  sound.library = entry.id;
  return sound;
}

export async function soundFromBuffer(project, buffer, name) {
  return soundFromBlob(project, wavBlob(await downmix(buffer)), name);
}

// --- the Model Database ---------------------------------------------------------------------

let catalog = null;
export async function modelCatalog() {
  if (!catalog) catalog = import('../../../src/models/catalog.js');
  return catalog;
}

// The card pictures the main app already ships, at /app/models/thumbs/. Stages is served from
// /stages/, a sibling directory, so the address is relative to that (and the dev server maps the
// same path; see vite.config.js).
export const modelThumb = (id) => `../app/models/thumbs/${id}.webp`;

const ANGLES = 12;
const SIZE = 256;

export async function spriteFromModel(project, model, { onProgress } = {}) {
  const { buildCatalogModel } = await import('../../../src/models/index.js');
  const object = await buildCatalogModel(model.id, { skirt: false });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.35));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-6, 3, -4);
  scene.add(fill);
  const pivot = new THREE.Group();
  scene.add(pivot);
  pivot.add(object);

  // Centre it, then fit a camera to a sphere round it so every angle frames it the same.
  const box = new THREE.Box3().setFromObject(object);
  const centre = box.getCenter(new THREE.Vector3());
  object.position.sub(centre);
  const radius = Math.max(0.01, box.getSize(new THREE.Vector3()).length() / 2);
  const camera = new THREE.PerspectiveCamera(30, 1, radius / 50, radius * 50);
  const elev = ((model.pictureElevation ?? 14) * Math.PI) / 180;
  const dist = radius / Math.sin((15 * Math.PI) / 180) * 1.02;
  camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
  camera.lookAt(0, 0, 0);

  const sprite = makeSprite(uniqueName(model.title, project.targets.map((t) => t.name)), { size: 100, library: `model:${model.id}` });
  try {
    for (let i = 0; i < ANGLES; i++) {
      pivot.rotation.y = (i / ANGLES) * Math.PI * 2;
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = SIZE;
      out.height = SIZE;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0);
      sprite.costumes.push(await costumeFromCanvas(project, out, `angle ${i + 1}`, { resolution: 2 }));
      onProgress?.((i + 1) / ANGLES);
    }
  } finally {
    object.traverse((n) => {
      n.geometry?.dispose?.();
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return sprite;
}
