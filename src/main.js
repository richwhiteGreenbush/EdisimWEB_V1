import * as THREE from 'three';
import { buildWorld, applyWorldTheme } from './SceneSetup.js';
import { PlayerController } from './PlayerController.js';
import { Menu } from './Menu.js';
import { PlacedRegistry } from './PlacedRegistry.js';
import { ImportManager } from './ImportManager.js';
import { DrawTool } from './DrawTool.js';
import { WorldStore } from './WorldStore.js';
import { ObjectMenu } from './ObjectMenu.js';
import { exportWorldToFile, readWorldFile } from './WorldFile.js';
import { TouchNav } from './TouchNav.js';
import { ProgramManager } from './ProgramManager.js';
import { ProgramEditor } from './ProgramEditor.js';
import { PlayIconManager } from './PlayIcon.js';
import { placeLightOrb } from './LightOrb.js';
import { WebBrowserManager, placeWebBrowser } from './WebBrowserPanel.js';
import { buildPresetWorldRecords } from './WorldPresets.js';
import { VRView } from './VRView.js';
import { EYE_HEIGHT, PALETTE_SWATCHES, DEFAULT_THEME, BOOT_WORLD } from './config.js';

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

// Shared by the Load World menu and by the first-visit boot below.
// buildPresetWorldRecords applies the world's theme first and then reads each object's
// ground height off the freshly reshaped terrain -- so it has to run before
// loadFromRecords, and the player is only moved once the new ground exists under them.
async function loadPresetWorld(name) {
  const { records, spawn, label } = buildPresetWorldRecords(name, { groundHeightAt });
  await worldStore.loadFromRecords(records);
  player.resetTo(spawn);
  return label;
}

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
  onVRClick: async () => {
    // Collapse first: the menu is hidden while VR is on, and leaving it open means it
    // reappears mid-panel the moment the student comes back out.
    menu.setCollapsed(true);
    try {
      await vrView.toggle();
    } catch (err) {
      console.error('VR view failed:', err);
      menu.toast('Could not start the VR view on this device.', { tone: 'error' });
    }
    menu.setVRActive(vrView.active);
  },
  onLoadPresetClick: (name) => {
    menu.setCollapsed(true);
    menu.toast('Building the world…');
    loadPresetWorld(name)
      .then((label) => menu.toast(`${label} is ready — walk in and take a look.`, { tone: 'success' }))
      .catch((err) => {
        console.error(`Failed to load preset world "${name}":`, err);
        menu.toast('Could not build that world.', { tone: 'error' });
      });
  },
  onClearClick: async () => {
    if (registry.count === 0) {
      menu.toast('Nothing to clear yet.');
      return;
    }
    registry.clear();
    playIconManager.clear();
    webBrowserManager.clear();
    await worldStore.clearAll();
    // The theme is carried by a record, and clearing removed it -- so put the sky,
    // terrain and lighting back to the default world rather than leaving the player
    // standing on grey lunar hills under a black sky with nothing on them.
    applyWorldTheme(DEFAULT_THEME);
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
    // First visit (or a cleared/evicted IndexedDB) drops the student straight into the
    // Park. The check is "nothing came back at all", not "no startup-* records came
    // back": every preset world is built from `preset-prop` records, so the narrower
    // check would rebuild the Park on top of whichever world they had last loaded.
    //
    // Once built, the Park is persisted like any other world, so a plain page refresh
    // restores whatever the student had actually done to it rather than resetting
    // their work. Menu > Load World > The Park is the deliberate way back to a fresh
    // copy.
    if (registry.count === 0) {
      return loadPresetWorld(BOOT_WORLD);
    }
  })
  .catch((err) => console.error('World initialization failed:', err));

// Constructed after `menu` because its notices toast through it, and before the resize
// handler and animate loop, both of which hand it every frame/size change.
const vrView = new VRView({
  renderer,
  scene,
  camera,
  player,
  onNotice: ({ type, message }) => {
    if (type === 'exited') {
      // The headset's own menu button and the Esc key both leave without going through
      // the menu, so the button label has to be corrected from here.
      menu.setVRActive(false);
      menu.toast('Back to the normal view.');
      return;
    }
    if (message) menu.toast(message, { tone: 'success', duration: 6000 });
  },
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  vrView.resize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
timer.connect(document);

if (import.meta.env.DEV) {
  window.__debug = {
    camera, player, renderer, scene, THREE, menu, registry, importManager, drawTool,
    worldStore, objectMenu, touchNav, programManager, programEditor, playIconManager,
    webBrowserManager, vrView,
  };
}

// renderer.setAnimationLoop rather than a bare requestAnimationFrame: inside a WebXR
// session the frames have to come from the XR device's own loop (at its refresh rate,
// with the pose for that frame attached), and this is what swaps the two over. Outside
// a session it is plain requestAnimationFrame, so nothing else changes.
function animate(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  player.update(dt);
  registry.tick();
  programManager.tick();
  playIconManager.tick();
  webBrowserManager.tick();
  // vrView draws the frame itself when a headset or stereo view is running.
  if (!vrView.render()) renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
