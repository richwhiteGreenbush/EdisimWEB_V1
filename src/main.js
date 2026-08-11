import * as THREE from 'three';
import { buildWorld } from './SceneSetup.js';
import { PlayerController } from './PlayerController.js';
import { Menu } from './Menu.js';
import { PlacedRegistry } from './PlacedRegistry.js';
import { ImportManager } from './ImportManager.js';
import { DrawTool } from './DrawTool.js';
import { WorldStore } from './WorldStore.js';
import { ObjectMenu } from './ObjectMenu.js';
import { placeStartupAssets } from './StartupAssets.js';
import { exportWorldToFile, readWorldFile } from './WorldFile.js';
import { TouchNav } from './TouchNav.js';
import { ProgramManager } from './ProgramManager.js';
import { ProgramEditor } from './ProgramEditor.js';
import { PlayIconManager } from './PlayIcon.js';
import { placeLightOrb } from './LightOrb.js';
import { WebBrowserManager, placeWebBrowser } from './WebBrowserPanel.js';
import { EYE_HEIGHT, PALETTE_SWATCHES } from './config.js';

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, EYE_HEIGHT, 6);

const { ground } = buildWorld(scene);
const player = new PlayerController(camera, canvas, ground);
const programManager = new ProgramManager();
const registry = new PlacedRegistry(scene, programManager);
const groundHeightAt = (x, z) => player.groundHeightAt(x, z);
const touchNav = new TouchNav();
const webBrowserManager = new WebBrowserManager({
  scene,
  camera,
  canvas,
  onEditClick: (id, clientX, clientY) => objectMenu.open(id, clientX, clientY),
});

const loadWorldInput = document.createElement('input');
loadWorldInput.type = 'file';
loadWorldInput.accept = '.json';
loadWorldInput.style.display = 'none';
loadWorldInput.addEventListener('change', async () => {
  const file = loadWorldInput.files[0];
  loadWorldInput.value = '';
  if (!file) return;
  try {
    const records = await readWorldFile(file);
    await worldStore.loadFromRecords(records);
    menu.toast(`Loaded world with ${records.length} object${records.length === 1 ? '' : 's'}.`, { tone: 'success' });
  } catch (err) {
    console.error('Failed to load world file:', err);
    menu.toast(err.message || 'Could not load that world file.', { tone: 'error' });
  }
});
document.body.appendChild(loadWorldInput);

const menu = new Menu({
  onImportClick: () => importManager.openFilePicker(),
  onDrawClick: () => drawTool.open(),
  onLightOrbClick: () => {
    const color = PALETTE_SWATCHES[registry.count % PALETTE_SWATCHES.length];
    const { record } = placeLightOrb({ scene, camera, registry, groundHeightAt, color });
    worldStore.saveObject(record);
    menu.toast('Light orb placed!', { tone: 'success' });
  },
  onWebBrowserClick: () => {
    const { record } = placeWebBrowser({ scene, camera, registry, groundHeightAt, webBrowserManager, worldStore });
    worldStore.saveObject(record);
    menu.toast('Web browser placed — some sites block being embedded.', { tone: 'success' });
  },
  onSaveWorldClick: async () => {
    if (registry.count === 0) {
      menu.toast('Nothing to save yet.');
      return;
    }
    try {
      const records = [...registry.items.values()].map((item) => item.record).filter(Boolean);
      await exportWorldToFile(records);
      menu.toast('World saved — check your downloads.', { tone: 'success' });
    } catch (err) {
      console.error('Failed to save world:', err);
      menu.toast('Could not save the world.', { tone: 'error' });
    }
  },
  onLoadWorldClick: () => loadWorldInput.click(),
  onClearClick: async () => {
    if (registry.count === 0) {
      menu.toast('Nothing to clear yet.');
      return;
    }
    registry.clear();
    playIconManager.clear();
    webBrowserManager.clear();
    await worldStore.clearAll();
    menu.toast('World cleared.', { tone: 'success' });
  },
});

const playIconManager = new PlayIconManager({ scene, camera, domElement: canvas, registry, programManager, menu });

const worldStore = new WorldStore({ scene, registry, menu, programManager, playIconManager, webBrowserManager });

const importManager = new ImportManager({
  scene,
  camera,
  groundHeightAt,
  menu,
  registry,
  onPlaced: (record) => worldStore.saveObject(record),
});

const drawTool = new DrawTool({
  scene,
  camera,
  groundHeightAt,
  menu,
  registry,
  onPlaced: (record) => worldStore.saveObject(record),
});

const programEditor = new ProgramEditor({ registry, worldStore, programManager, menu, playIconManager });

const objectMenu = new ObjectMenu({ scene, camera, domElement: canvas, registry, menu, worldStore, programEditor });

worldStore
  .rehydrateAll()
  .then(() => {
    const hasStartupAssets = [...registry.items.values()].some((item) => item.record?.kind?.startsWith('startup-'));
    if (!hasStartupAssets) {
      return placeStartupAssets({ scene, camera, registry, worldStore, groundHeightAt });
    }
  })
  .catch((err) => console.error('World initialization failed:', err));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);

if (import.meta.env.DEV) {
  window.__debug = {
    camera, player, renderer, scene, THREE, menu, registry, importManager, drawTool,
    worldStore, objectMenu, touchNav, programManager, programEditor, playIconManager,
    webBrowserManager,
  };
}

function animate(timestamp) {
  requestAnimationFrame(animate);
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  player.update(dt);
  registry.tick();
  programManager.tick();
  playIconManager.tick();
  webBrowserManager.tick();
  renderer.render(scene, camera);
}
animate();
