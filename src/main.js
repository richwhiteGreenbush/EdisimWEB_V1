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
import { MarkerTrail } from './MarkerTrail.js';
import { SpeechBubbleManager } from './SpeechBubble.js';
import { placeLightOrb } from './LightOrb.js';
import { WebBrowserManager, placeWebBrowser } from './WebBrowserPanel.js';
import { youtubeEmbedUrl } from './WebUrl.js';
import { askForUrl } from './UrlPrompt.js';
import { buildPresetWorldRecords } from './WorldPresets.js';
import { duplicatePlacedObject } from './Duplicator.js';
import { VRView } from './VRView.js';
import { placePrimitive } from './Primitives.js';
import { ConstructionManager } from './ConstructionManager.js';
import { PrimitiveMenu } from './PrimitiveMenu.js';
import { BuildGizmo } from './BuildGizmo.js';
import { Motion } from './Motion.js';
import { Cinema, arrivalRig, flyRig } from './Cinema.js';
import { PhotoMode } from './PhotoMode.js';
import { SettingsPanel } from './SettingsPanel.js';
import { EYE_HEIGHT, PALETTE_SWATCHES, DEFAULT_THEME, BOOT_WORLD } from './config.js';
import { takeLinkedWorldId, fetchLinkedWorld } from './WorldLink.js';

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
// One spring for the whole app. Assigned onto the registry rather than injected because
// PlacedRegistry.add() is the single funnel every placement goes through, and that is
// where a placed object gets its arrival. buildGizmo does not exist yet -- it is attached
// below, and nothing animates before a frame is drawn.
const motion = new Motion({ registry, programManager });
registry.motion = motion;
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
  // The world ARRIVES rather than cutting. Every preset in this project is composed
  // around one arrival frame -- the notes for each of them argue about the angle at
  // length -- and until now that frame was delivered as a hard cut. The swoop ends
  // exactly on it, and arrivalRig returns null when the student has asked for no camera
  // movement, so this is also how that preference is honoured.
  const swoop = arrivalRig(cinema, spawn);
  if (swoop) cinema.take('Arrival', swoop);
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
    const spawn = await worldStore.loadFromRecords(records);
    // Move them ONLY if the file says where to stand.
    //
    // This used to never move anybody, on the grounds that the student chose the file
    // while standing somewhere and moving them would be rude. That reasoning rested on a
    // world file carrying no spawn -- with nowhere better to put them, leaving them put
    // was the least-wrong option. Now that a file can say, honouring it is plainly better:
    // loading one replaces the entire world, so wherever they were standing was in a place
    // that no longer exists.
    //
    // Files without a spawn still behave exactly as before, which is every world anybody
    // has already saved or been sent.
    if (spawn) player.resetTo(spawn);
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
  // A video is a browser panel whose address is already right, which is the only thing
  // that makes it work: youtube.com/watch sends X-Frame-Options and will not frame, and
  // a blocked frame gives the parent page nothing to detect -- so the rewrite has to
  // happen here, before the panel exists, rather than being diagnosed afterwards.
  youTube: async () => {
    menu.setCollapsed(true);
    const typed = await askForUrl({
      title: 'Paste a YouTube link',
      hint: 'Any YouTube address works — the one from the address bar, a Share link, or a Shorts link. '
        + 'It becomes a panel you can watch, move and resize like anything else you place.',
      placeholder: 'https://www.youtube.com/watch?v=…',
      confirmLabel: 'Add video',
    });
    if (typed === null) return;
    const url = youtubeEmbedUrl(typed);
    if (!url) {
      menu.toast('That does not look like a YouTube video link — try copying it again.', { tone: 'error' });
      return;
    }
    const { record } = placeWebBrowser({ scene, camera, registry, groundHeightAt, webBrowserManager, worldStore, url });
    worldStore.saveObject(record);
    menu.toast('Video placed — click it to play.', { tone: 'success' });
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
  // --- Looking at the world -----------------------------------------------------
  photo: () => {
    menu.setCollapsed(true);
    photoMode.open();
  },
  fly: () => {
    menu.setCollapsed(true);
    if (!cinema.take('Fly', flyRig(cinema))) return;
    menu.toast('Look up and press forward to climb. Esc to come back down.');
  },
  // `null` means "back to normal". EYE_HEIGHT itself is never written -- it is the
  // calibration point every prop in this project is sized against.
  eyeHeight: (feet) => {
    menu.setCollapsed(true);
    if (vrView.active) {
      // VRView reads EYE_HEIGHT in two places and VRMenu bakes its header anchor from it
      // at MODULE LOAD, so a runtime height leaves the in-scene VR menu hanging five feet
      // over a two-inch person's head. Gated off rather than made to agree.
      menu.toast('Come out of the headset view to change your size.', { tone: 'error' });
      return;
    }
    player.setEyeHeight(feet ?? EYE_HEIGHT);
    if (feet === null) menu.toast('Back to your own size.');
    else if (feet < 1) menu.toast('You are four inches tall. Go and look at the grass.', { tone: 'success' });
    else menu.toast('You are twenty-two feet tall.', { tone: 'success' });
  },
  settings: () => {
    menu.setCollapsed(true);
    settingsPanel.open();
  },

  clear: async () => {
    if (registry.count === 0) {
      menu.toast('Nothing to clear yet.');
      return;
    }
    // A rig pointed at an object in a world that is about to stop existing.
    cinema.release();
    registry.clear();
    playIconManager.clear();
    markerTrail.clear();
    speechBubbles.clear();
    webBrowserManager.clear();
    buildGizmo.deactivate();
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
  onYouTubeClick: menuActions.youTube,
  onCreatePrimitiveClick: menuActions.createPrimitive,
  onSaveWorldClick: menuActions.saveWorld,
  onLoadWorldClick: menuActions.loadWorldFile,
  onLoadPresetClick: menuActions.loadPreset,
  onPhotoClick: menuActions.photo,
  onFlyClick: menuActions.fly,
  onEyeHeightClick: menuActions.eyeHeight,
  onSettingsClick: menuActions.settings,
  onClearClick: menuActions.clear,
  onVRClick: async () => {
    // Collapse first: the menu is hidden while VR is on, and leaving it open means it
    // reappears mid-panel the moment the student comes back out. The stretch gizmo goes
    // for a stronger reason -- its Done chip is a DOM overlay and is hidden in VR, so a
    // gizmo left running would strand a blue box in the world with no way to dismiss it.
    menu.setCollapsed(true);
    buildGizmo.deactivate();
    try {
      await vrView.toggle();
    } catch (err) {
      console.error('VR view failed:', err);
      menu.toast('Could not start the VR view on this device.', { tone: 'error' });
    }
    menu.setVRActive(vrView.active);
  },
});

// The camera rig. Constructed after `menu` because it toasts through it, and before
// ObjectMenu, which hands it to its Camera sub-page. vrView does not exist yet -- it is
// attached below, and take() is the only thing that reads it.
const cinema = new Cinema({ camera, player, registry, menu });

const markerTrail = new MarkerTrail({
  scene,
  onNotice: (message) => menu.toast(message),
});
// Assigned rather than injected, for the reason ProgramManager's own note gives: it is
// constructed at the very top of this file, before the scene exists.
programManager.marker = markerTrail;

const playIconManager = new PlayIconManager({ scene, camera, domElement: canvas, registry, programManager, menu });
const speechBubbles = new SpeechBubbleManager({ scene, registry });

const worldStore = new WorldStore({ scene, registry, menu, programManager, playIconManager, webBrowserManager, speechBubbles, markerTrail });

const photoMode = new PhotoMode({
  scene, camera, renderer, registry, worldStore, menu, player, groundHeightAt, cinema,
});
const settingsPanel = new SettingsPanel({
  onChange: (name) => {
    // Turning motion off mid-lesson has to take effect on the objects already moving.
    // Stickers check reducedMotion() every frame and put themselves back to rest, so the
    // only thing left to do is stop any one-shot that is in flight.
    if (name === 'motion') motion.clear();
  },
});

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

const objectMenu = new ObjectMenu({
  scene,
  camera,
  domElement: canvas,
  registry,
  menu,
  worldStore,
  programEditor,
  cinema,
  // Clicking a world-portal billboard runs the same action Load World does. It is the
  // only way to reach a preset marked `hidden` -- 1940's New York is reachable from the
  // billboard behind the Library and from nowhere else.
  onPortalClick: (name) => menuActions.loadPreset(name),
});

const buildGizmo = new BuildGizmo({
  scene,
  camera,
  canvas,
  registry,
  worldStore,
  groundHeightAt,
  constructionManager,
});

const primitiveMenu = new PrimitiveMenu({ registry, menu, worldStore, buildGizmo });

// The gizmo is the other thing that can own an object's transform, and Motion must never
// fight it -- a spring running on a piece the student has under their thumb is a stutter
// that reads as a bug in the gizmo.
motion.attach({ buildGizmo });

// The "duplicate" block's effect, handed over now that both the registry and the world
// store exist. ProgramManager is built at the top of this file because PlacedRegistry
// takes it as a constructor argument, so it cannot be given these up front -- and it
// does not need to be, since nothing calls this until a program is actually running.
programManager.onDuplicate = (id, offset) => duplicatePlacedObject({ id, offset, registry, worldStore, menu });
// The `say` block's visible half. The broadcast half -- waking every `when an object
// says` hat in the world -- is ProgramManager's own job and needs nothing from here.
programManager.onSay = (id, object3D, text) => speechBubbles.show(id, object3D, text);

// A JavaScript program's runtime errors reach the student as a toast. Blocks cannot fail
// this way -- every block is valid by construction -- but hand-typed code can, and the
// console is not somewhere a student looks.
programManager.onScriptError = (id, err) =>
  menu.toast(`JavaScript error: ${err?.message || err}`, { tone: 'error' });

// `?world=24` on the address opens that world out of the gallery. Read -- and stripped
// from the url -- BEFORE anything is built, so the boot world is never built just to be
// thrown away a moment later, and so a refresh cannot replay the link. See WorldLink.js.
const linkedWorldId = takeLinkedWorldId();

worldStore
  .rehydrateAll()
  .then(async () => {
    if (linkedWorldId) {
      menu.toast('Opening the shared world…');
      const records = await fetchLinkedWorld(linkedWorldId);
      const spawn = await worldStore.loadFromRecords(records);
      // Stand them where the world says, and at the app's own default spot if it does not
      // say -- which is every world file exported before spawns existed.
      //
      // Moving them at all is not optional here: they may have arrived from another world
      // entirely and be standing 150ft out in the fog of a world that no longer exists.
      // Before the spawn record this could only ever be the default spot, which in a world
      // composed around one particular view meant arriving in an empty corner with the
      // thing they came to see behind them.
      player.resetTo(spawn || undefined);
      menu.toast('Shared world opened — this replaced what was here before.', { tone: 'success' });
      return;
    }
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
  .catch(async (err) => {
    console.error('World initialization failed:', err);
    if (linkedWorldId) {
      // The link is the only thing that failed. Leave the student somewhere rather than
      // on an empty plane: whatever was already saved has survived, because the failure
      // happened before loadFromRecords wiped anything.
      menu.toast(err?.message || 'Could not open that world.', { tone: 'error' });
      if (registry.count === 0) {
        await loadPresetWorld(BOOT_WORLD).catch(() => {});
      }
    }
  });

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

// take() refuses while a headset session is live: VRView builds its dolly from
// camera.position.y and player.yaw and the stereo path copies camera.quaternion outright,
// so a rig driving the camera would go straight into the headset at full amplitude.
cinema.attach({ vrView });

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
    worldStore, objectMenu, touchNav, programManager, programEditor, playIconManager, speechBubbles,
    webBrowserManager, vrView, constructionManager, primitiveMenu, markerTrail, buildGizmo,
    motion, cinema, photoMode, settingsPanel,
  };
}

// renderer.setAnimationLoop rather than a bare requestAnimationFrame: inside a WebXR
// session the frames have to come from the XR device's own loop (at its refresh rate,
// with the pose for that frame attached), and this is what swaps the two over. Outside
// a session it is plain requestAnimationFrame, so nothing else changes.
function animate(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  // A camera rig owns the eyes while it is running -- the same true/false arbitration
  // vrView.render() uses at the bottom of this function.
  if (!cinema.active) player.update(dt);
  registry.tick(dt, camera);
  motion.tick(dt);
  programManager.tick();
  // AFTER the programs have moved things, and BEFORE webBrowserManager.tick(), which
  // renders the CSS3D layer itself and therefore wants the final camera. A ride that read
  // its subject before programManager.tick() would be exactly one frame stale -- invisible
  // under `glide`, eight feet of lag under `forever { moveForward 8 }`.
  cinema.tick(dt);
  markerTrail.tick();
  playIconManager.tick();
  speechBubbles.tick();
  webBrowserManager.tick();
  constructionManager.tick();
  buildGizmo.tick();
  // vrView draws the frame itself when a headset or stereo view is running.
  if (!vrView.render()) renderer.render(scene, camera);
  // IMMEDIATELY after the draw, in the same task. The renderer is built without
  // preserveDrawingBuffer, so a WebGL drawing buffer read from a click handler on a later
  // tick comes back as a black rectangle with no error at all. This is the only place a
  // photograph can legally be taken.
  photoMode.afterRender();
}
renderer.setAnimationLoop(animate);
