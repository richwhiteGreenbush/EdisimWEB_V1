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
import { duplicatePlacedObject } from './Duplicator.js';
import { VRView } from './VRView.js';
import { placePrimitive } from './Primitives.js';
import { ConstructionManager } from './ConstructionManager.js';
import { PrimitiveMenu } from './PrimitiveMenu.js';
import { StretchGizmo } from './StretchGizmo.js';
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

// Constructed HERE, ahead of PlayIconManager and ObjectMenu, and the order is
// load-bearing: all three register their own pointerdown/pointerup pair on this same
// canvas/window, and they run in registration order within a single event dispatch. A
// hammer click has to be able to stopImmediatePropagation() away from the two later
// listeners, or ObjectMenu's raycast finds nothing where the icon floats and closes the
// panel this one just opened. (Same story as the web browser panel's edit icon.)
const constructionManager = new ConstructionManager({
  scene,
  camera,
  canvas,
  registry,
  onHammerClick: (id, clientX, clientY) => primitiveMenu.open(id, clientX, clientY),
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

// Every menu action, keyed by id, in one place. There are now TWO menus driving these
// -- the DOM one in the corner and VRMenu's in-scene panel -- and the keys here are the
// row ids VRMenu emits. Extracted rather than duplicated so that "Load Object > Light
// Orb" cannot come to mean two slightly different things depending on which menu the
// student happened to be looking at.
const menuActions = {
  import: () => importManager.openFilePicker(),
  draw: () => drawTool.open(),
  lightOrb: () => {
    const color = PALETTE_SWATCHES[registry.count % PALETTE_SWATCHES.length];
    const { record } = placeLightOrb({ scene, camera, registry, groundHeightAt, color });
    worldStore.saveObject(record);
    menu.toast('Light orb placed!', { tone: 'success' });
  },
  webBrowser: () => {
    const { record } = placeWebBrowser({ scene, camera, registry, groundHeightAt, webBrowserManager, worldStore });
    worldStore.saveObject(record);
    menu.toast('Web browser placed — some sites block being embedded.', { tone: 'success' });
  },
  createPrimitive: async (shape) => {
    try {
      const { record } = await placePrimitive({ shape, scene, camera, registry, groundHeightAt });
      worldStore.saveObject(record);
      menu.toast('Shape added — click the hammer above it to build.', { tone: 'success' });
    } catch (err) {
      console.error('Failed to place a build shape:', err);
      menu.toast('Could not add that shape.', { tone: 'error' });
    }
  },
  saveWorld: async () => {
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
  loadWorldFile: () => loadWorldInput.click(),
  loadPreset: (name) => {
    menu.setCollapsed(true);
    menu.toast('Building the world…');
    loadPresetWorld(name)
      .then((label) => menu.toast(`${label} is ready — walk in and take a look.`, { tone: 'success' }))
      .catch((err) => {
        console.error(`Failed to load preset world "${name}":`, err);
        menu.toast('Could not build that world.', { tone: 'error' });
      });
  },
  clear: async () => {
    if (registry.count === 0) {
      menu.toast('Nothing to clear yet.');
      return;
    }
    registry.clear();
    playIconManager.clear();
    webBrowserManager.clear();
    stretchGizmo.deactivate();
    await worldStore.clearAll();
    // The theme is carried by a record, and clearing removed it -- so put the sky,
    // terrain and lighting back to the default world rather than leaving the player
    // standing on grey lunar hills under a black sky with nothing on them.
    applyWorldTheme(DEFAULT_THEME);
    menu.toast('World cleared.', { tone: 'success' });
  },
};

const menu = new Menu({
  onImportClick: menuActions.import,
  onDrawClick: menuActions.draw,
  onLightOrbClick: menuActions.lightOrb,
  onWebBrowserClick: menuActions.webBrowser,
  onCreatePrimitiveClick: menuActions.createPrimitive,
  onSaveWorldClick: menuActions.saveWorld,
  onLoadWorldClick: menuActions.loadWorldFile,
  onLoadPresetClick: menuActions.loadPreset,
  onClearClick: menuActions.clear,
  onVRClick: async () => {
    // Collapse first: the menu is hidden while VR is on, and leaving it open means it
    // reappears mid-panel the moment the student comes back out. The stretch gizmo goes
    // for a stronger reason -- its Done chip is a DOM overlay and is hidden in VR, so a
    // gizmo left running would strand a blue box in the world with no way to dismiss it.
    menu.setCollapsed(true);
    stretchGizmo.deactivate();
    try {
      await vrView.toggle();
    } catch (err) {
      console.error('VR view failed:', err);
      menu.toast('Could not start the VR view on this device.', { tone: 'error' });
    }
    menu.setVRActive(vrView.active);
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

const stretchGizmo = new StretchGizmo({ scene, camera, canvas, registry, worldStore, groundHeightAt });

const primitiveMenu = new PrimitiveMenu({ registry, menu, worldStore, stretchGizmo });

// The "duplicate" block's effect, handed over now that both the registry and the world
// store exist. ProgramManager is built at the top of this file because PlacedRegistry
// takes it as a constructor argument, so it cannot be given these up front -- and it
// does not need to be, since nothing calls this until a program is actually running.
programManager.onDuplicate = (id, offset) => duplicatePlacedObject({ id, offset, registry, worldStore, menu });

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
  // The same actions the DOM menu runs. VRView's in-scene panel is the only menu a
  // headset can actually display, so it has to reach all of them.
  actions: menuActions,
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
    webBrowserManager, vrView, constructionManager, primitiveMenu, stretchGizmo,
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
  constructionManager.tick();
  stretchGizmo.tick();
  // vrView draws the frame itself when a headset or stereo view is running.
  if (!vrView.render()) renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);
