// Edusim HiFi -- composition root.
//
// Two halves, and the seam between them is the whole design.
//
// THE APP is Edusim's own: the record pipeline, the menu, the block and JavaScript runtimes,
// Create Model, Draw, browser panels, duplication, persistence. Those classes are imported
// from the main app's src/ and wired up here exactly as that app's main.js wires them --
// against a three.js scene, a three.js camera and this canvas -- because every one of them
// takes those by injection and none of them needs a three.js RENDERER. There isn't one.
//
// THE RENDERER is Babylon: sky, image-based light, terrain, grass, water, shadows, post. The
// ThreeBridge mirrors the three scene into it every frame, and the three camera -- which the
// main app's PlayerController, Cinema and size modes all drive -- is copied onto Babylon's.
//
// So picking, measuring, programming and saving all happen against real three.js geometry
// that is never drawn, and everything a student SEES is Babylon.

import '../../src/style.css';
import './style.css';
import * as THREE from 'three';
import { Engine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';

import { buildWorld, applyWorldTheme, setSunPhase, getWorldTheme } from '../../src/SceneSetup.js';
import { PlayerController } from '../../src/PlayerController.js';
import { Menu } from '../../src/Menu.js';
import { PlacedRegistry } from '../../src/PlacedRegistry.js';
import { ImportManager } from '../../src/ImportManager.js';
import { DrawTool } from '../../src/DrawTool.js';
import { WorldStore } from '../../src/WorldStore.js';
import { ObjectMenu } from '../../src/ObjectMenu.js';
import { exportWorldToFile, readWorldFile, parseWorldPayload } from '../../src/WorldFile.js';
import { TouchNav } from '../../src/TouchNav.js';
import { ProgramManager } from '../../src/ProgramManager.js';
import { ProgramEditor } from '../../src/ProgramEditor.js';
import { PlayIconManager } from '../../src/PlayIcon.js';
import { MarkerTrail } from '../../src/MarkerTrail.js';
import { SpeechBubbleManager } from '../../src/SpeechBubble.js';
import { placeLightOrb } from '../../src/LightOrb.js';
import { WebBrowserManager, placeWebBrowser } from '../../src/WebBrowserPanel.js';
import { youtubeEmbedUrl } from '../../src/WebUrl.js';
import { askForUrl } from '../../src/UrlPrompt.js';
import { buildPresetWorldRecords, PRESET_WORLDS } from '../../src/WorldPresets.js';
import { duplicatePlacedObject } from '../../src/Duplicator.js';
import { placePrimitive } from '../../src/Primitives.js';
import { ConstructionManager } from '../../src/ConstructionManager.js';
import { PrimitiveMenu } from '../../src/PrimitiveMenu.js';
import { BuildGizmo } from '../../src/BuildGizmo.js';
import { Motion } from '../../src/Motion.js';
import { Cinema, arrivalRig, flyRig } from '../../src/Cinema.js';
import { PhotoMode } from '../../src/PhotoMode.js';
import { SettingsPanel } from '../../src/SettingsPanel.js';
import { EYE_HEIGHT, PALETTE_SWATCHES, DEFAULT_THEME, BOOT_WORLD } from '../../src/config.js';

import { QUALITY, DEFAULT_QUALITY, HIFI_DB_NAME, HIFI_GALLERY_URL, HIFI_WORLD_LINK_PARAM, HIFI_WORLD_LINK_BASE } from './config.js';
import { hifiTheme } from './themes.js';
import { Environment } from './engine/Environment.js';
import { Terrain } from './engine/Terrain.js';
import { Pipeline } from './engine/Pipeline.js';
import { Grass } from './engine/Grass.js';
import { Water } from './engine/Water.js';
import { Lights } from './engine/Lights.js';
import { Kit } from './props/Kit.js';
import { Natives } from './props/native.js';
import { fernRosetteMesh } from './props/Flora.js';
import { tickWind, windUniforms } from './props/Trees.js';
import { ThreeBridge } from './bridge/ThreeBridge.js';
import { paintGroundMask, pondCarves } from './GroundMask.js';
import { HiFiVR } from './HiFiVR.js';
import { HiFiPanel } from './HiFiPanel.js';

// ---- HiFi keeps its own saved world -------------------------------------------------------
// WorldStore opens the IndexedDB database named in the MAIN app's config, and IndexedDB is
// per ORIGIN, not per path: served from /hifi/ beside /app/, the two editions would share one
// database and each would overwrite the other's world on load. The name is redirected here,
// before anything opens it, rather than by editing a constant the main app documents as one
// that must never change.
{
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = (name, version) => open(name === '3dcoder-world' ? HIFI_DB_NAME : name, version);
}

const params = new URLSearchParams(location.search);
let stored = null;
try { stored = localStorage.getItem('hifi-quality'); } catch { /* blocked storage must not take the app down */ }
const qualityName = QUALITY[params.get('quality')] ? params.get('quality') : QUALITY[stored] ? stored : DEFAULT_QUALITY;
const quality = QUALITY[qualityName];

const loadingText = document.getElementById('loading-text');
const loadingFill = document.getElementById('loading-fill');
const progress = (text, f) => { if (loadingText) loadingText.textContent = text; if (loadingFill) loadingFill.style.width = `${Math.round(f * 100)}%`; };

// ---- the renderer ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: 'high-performance' }, true);
engine.setHardwareScalingLevel(quality.hardwareScale / Math.min(window.devicePixelRatio || 1, 2));
const bscene = new Scene(engine);
bscene.useRightHandedSystem = true;
bscene.skipPointerMovePicking = true;
bscene.detachControl(); // every pointer event belongs to the app's own listeners

const bcamera = new FreeCamera('eye', new Vector3(0, EYE_HEIGHT, 6), bscene);
bcamera.minZ = Number(params.get('minz') ?? 0.12);
bcamera.maxZ = 40000;
bcamera.inputs.clear();

const environment = new Environment(bscene, quality);
const terrain = new Terrain(bscene);
const pipeline = new Pipeline(bscene, bcamera, environment.sun, quality);
const grass = new Grass(bscene, terrain, quality);
const water = new Water(bscene);
const lights = new Lights(bscene);
const kit = new Kit(bscene, quality);
grass.useMesh('ferns', fernRosetteMesh(kit));
const natives = new Natives({ scene: bscene, kit, pipeline, lights, water, enabled: params.get('native') !== '0' });

// ---- the app (three.js, never rendered) ---------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, EYE_HEIGHT, 6);
const { ground } = buildWorld(scene);
const builtIn = [...scene.children]; // ground, the two lights, starfield, sun disc: HiFi has its own

const player = new PlayerController(camera, canvas, ground);
const programManager = new ProgramManager();
const registry = new PlacedRegistry(scene, programManager);
const motion = new Motion({ registry, programManager });
registry.motion = motion;
const groundHeightAt = (x, z) => player.groundHeightAt(x, z);
const touchNav = new TouchNav();
const webBrowserManager = new WebBrowserManager({
  scene, camera, canvas,
  onEditClick: (id, clientX, clientY) => objectMenu.open(id, clientX, clientY),
});
// Ahead of PlayIconManager and ObjectMenu on purpose -- see the main app's notes on why the
// registration order of these three pointer listeners is load-bearing.
const constructionManager = new ConstructionManager({
  scene, camera, canvas, registry,
  onHammerClick: (id, clientX, clientY) => primitiveMenu.open(id, clientX, clientY),
});

const bridge = new ThreeBridge({ scene: bscene, threeScene: scene, pipeline, lights, natives, registry, ignore: builtIn });

async function loadPresetWorld(name) {
  const { records, spawn, label } = buildPresetWorldRecords(name, { groundHeightAt });
  await worldStore.loadFromRecords(records);
  player.resetTo(spawn);
  // ?still=1 skips the arrival swoop: a screenshot wants the arrival FRAME, not the flight to it.
  const swoop = params.has('still') ? null : arrivalRig(cinema, spawn);
  if (swoop) cinema.take('Arrival', swoop);
  programManager.broadcast('start');
  lastSunPhase = null;
  return label;
}

const SUN_EVENTS = [[0.2, 'sunrise'], [0.5, 'noon'], [0.72, 'sunset'], [0.92, 'night']];
let lastSunPhase = null;

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
    if (spawn) player.resetTo(spawn);
    menu.toast(`Loaded world with ${records.length} object${records.length === 1 ? '' : 's'}.`, { tone: 'success' });
  } catch (err) {
    console.error('Failed to load world file:', err);
    menu.toast(err.message || 'Could not load that world file.', { tone: 'error' });
  }
});
document.body.appendChild(loadWorldInput);

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
    if (!url) { menu.toast('That does not look like a YouTube video link — try copying it again.', { tone: 'error' }); return; }
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
    if (registry.count === 0) { menu.toast('Nothing to save yet.'); return; }
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
    return loadPresetWorld(name)
      .then((label) => menu.toast(`${label} is ready — walk in and take a look.`, { tone: 'success' }))
      .catch((err) => {
        console.error(`Failed to load preset world "${name}":`, err);
        menu.toast('Could not build that world.', { tone: 'error' });
      });
  },
  photo: () => { menu.setCollapsed(true); photoMode.open(); },
  fly: () => {
    menu.setCollapsed(true);
    if (!cinema.take('Fly', flyRig(cinema))) return;
    menu.toast('Look up and press forward to climb. Esc to come back down.');
  },
  eyeHeight: (feet) => {
    menu.setCollapsed(true);
    if (vrView.active) { menu.toast('Come out of the headset view to change your size.', { tone: 'error' }); return; }
    player.setEyeHeight(feet ?? EYE_HEIGHT);
    if (feet === null) menu.toast('Back to your own size.');
    else if (feet < 1) menu.toast('You are four inches tall. Go and look at the grass.', { tone: 'success' });
    else menu.toast('You are twenty-two feet tall.', { tone: 'success' });
  },
  sunPhase: (phase) => {
    const before = lastSunPhase;
    setSunPhase(phase); // keeps the app's own idea of the hour in step (getSunPhase, settings)
    environment.setPhase(phase);
    lastSunPhase = phase;
    if (phase === null) { menu.toast('Back to this world’s own time of day.'); return; }
    if (before === null || before === undefined) return;
    for (const [at, event] of SUN_EVENTS) {
      if ((before < at && phase >= at) || (before > at && phase <= at)) programManager.broadcast(event);
    }
  },
  settings: () => { menu.setCollapsed(true); settingsPanel.open(); },
  clear: async () => {
    if (registry.count === 0) { menu.toast('Nothing to clear yet.'); return; }
    cinema.release();
    registry.clear();
    playIconManager.clear();
    markerTrail.clear();
    speechBubbles.clear();
    webBrowserManager.clear();
    buildGizmo.deactivate();
    await worldStore.clearAll();
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
  onSunPhaseChange: menuActions.sunPhase,
  onSettingsClick: menuActions.settings,
  onClearClick: menuActions.clear,
  galleryUrl: HIFI_GALLERY_URL,
  onVRClick: async () => {
    menu.setCollapsed(true);
    buildGizmo.deactivate();
    try { await vrView.toggle(); } catch (err) {
      console.error('VR view failed:', err);
      menu.toast('Could not start the VR view on this device.', { tone: 'error' });
    }
    menu.setVRActive(vrView.active);
  },
});

const cinema = new Cinema({ camera, player, registry, menu });
const markerTrail = new MarkerTrail({ scene, onNotice: (message) => menu.toast(message) });
programManager.marker = markerTrail;
const playIconManager = new PlayIconManager({ scene, camera, domElement: canvas, registry, programManager, menu });
const speechBubbles = new SpeechBubbleManager({ scene, registry });
const worldStore = new WorldStore({ scene, registry, menu, programManager, playIconManager, webBrowserManager, speechBubbles, markerTrail });
// PhotoMode only ever asks its renderer for the canvas it drew to.
const photoMode = new PhotoMode({ scene, camera, renderer: { domElement: canvas }, registry, worldStore, menu, player, groundHeightAt, cinema });
const settingsPanel = new SettingsPanel({ onChange: (name) => { if (name === 'motion') motion.clear(); } });
const importManager = new ImportManager({ scene, camera, groundHeightAt, menu, registry, onPlaced: (record) => worldStore.saveObject(record) });
const drawTool = new DrawTool({ scene, camera, groundHeightAt, menu, registry, onPlaced: (record) => worldStore.saveObject(record) });
const programEditor = new ProgramEditor({ registry, worldStore, programManager, menu, playIconManager });
const objectMenu = new ObjectMenu({
  scene, camera, domElement: canvas, registry, menu, worldStore, programEditor, cinema,
  onPortalClick: (name) => menuActions.loadPreset(name),
});
const buildGizmo = new BuildGizmo({ scene, camera, canvas, registry, worldStore, groundHeightAt, constructionManager });
const primitiveMenu = new PrimitiveMenu({ registry, menu, worldStore, buildGizmo });
motion.attach({ buildGizmo });

programManager.onDuplicate = (id, offset) => duplicatePlacedObject({ id, offset, registry, worldStore, menu });
programManager.onSay = (id, object3D, text) => speechBubbles.show(id, object3D, text);
programManager.onScriptError = (id, err) => menu.toast(`JavaScript error: ${err?.message || err}`, { tone: 'error' });

const vrView = new HiFiVR({
  scene: bscene, camera: bcamera, terrain, pipeline, threeCamera: camera, player,
  onNotice: ({ type, message }) => {
    if (type === 'exited') { menu.setVRActive(false); menu.toast('Back to the normal view.'); return; }
    if (message) menu.toast(message, { tone: 'success', duration: 6000 });
  },
});
cinema.attach({ vrView });

new HiFiPanel({
  quality: qualityName, qualities: Object.keys(QUALITY), worlds: PRESET_WORLDS,
  actions: {
    setQuality: (q) => { try { localStorage.setItem('hifi-quality', q); } catch { /* ignore */ } const u = new URL(location.href); u.searchParams.set('quality', q); location.href = u.toString(); },
    setWind: (w) => { windUniforms.strength = w; grass.wind = w; },
    loadPreset: (key) => menuActions.loadPreset(key),
  },
});

// ---- ?hifiworld=<id> : open a world straight out of the Edusim HiFi Worlds Database --------------
// An ID resolved against a fixed, same-origin base, never a URL -- the main app's reasoning,
// unchanged: a parameter naming an address turns every copy of the app into something that
// will fetch and show whatever a link tells it to. Stripped from the address bar before the
// world loads, or a refresh would wipe the student's work again.
function takeLinkedWorldId() {
  const url = new URL(location.href);
  const id = url.searchParams.get(HIFI_WORLD_LINK_PARAM);
  if (!id) return null;
  url.searchParams.delete(HIFI_WORLD_LINK_PARAM);
  history.replaceState(null, '', url.toString());
  return /^\d{1,9}$/.test(id) ? id : null;
}
async function fetchLinkedWorld(id) {
  const res = await fetch(`${HIFI_WORLD_LINK_BASE}${encodeURIComponent(id)}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(res.status === 404 ? 'That world is not in the HiFi gallery any more.' : 'The HiFi gallery could not be reached.');
  return parseWorldPayload(await res.text());
}

// ---- ground: theme, carved ponds, the painted mask ---------------------------------------------------
let liveTheme = null; let liveCarves = ''; let lastCount = -1; let settle = 0;
function refreshGround(force = false) {
  const name = getWorldTheme();
  const carves = pondCarves(registry, natives);
  const carveKey = JSON.stringify(carves);
  if (force || name !== liveTheme || carveKey !== liveCarves) {
    liveTheme = name; liveCarves = carveKey;
    const theme = { ...hifiTheme(name), carves };
    terrain.applyTheme(theme);
    environment.applyTheme(theme, null);
    pipeline.applyTheme(theme);
    grass.applyTheme(theme);
    water.applyTheme(theme);
    natives.setTheme(theme);
    bridge.setEmissiveScale(theme.dark || theme.closed ? 0.6 : 0.35, theme.dark ? 0.5 : theme.closed ? 0.68 : 0.82);
  }
  paintGroundMask({ terrain, registry, bridge, natives });
  grass.invalidate();
}
environment.onChange = () => { lights.setNight(environment.lampAmount); natives.setNight(environment.lampAmount); };

// ---- boot ---------------------------------------------------------------------------------------------
const linkedWorldId = takeLinkedWorldId();
const presetParam = PRESET_WORLDS[params.get('preset')] ? params.get('preset') : null;
let worldReady = false;
progress('Building the world…', 0.45);
refreshGround(true);

worldStore.rehydrateAll()
  .then(async () => {
    if (linkedWorldId) {
      menu.toast('Opening the shared world…');
      const records = await fetchLinkedWorld(linkedWorldId);
      const spawn = await worldStore.loadFromRecords(records);
      player.resetTo(spawn || undefined);
      menu.toast('Shared world opened — this replaced what was here before.', { tone: 'success' });
      return;
    }
    if (presetParam) return loadPresetWorld(presetParam);
    if (registry.count === 0) return loadPresetWorld(BOOT_WORLD);
  })
  .catch(async (err) => {
    console.error('World initialization failed:', err);
    if (linkedWorldId) menu.toast(err?.message || 'Could not open that world.', { tone: 'error' });
    if (registry.count === 0) await loadPresetWorld(BOOT_WORLD).catch(() => {});
  })
  .finally(() => {
    if (params.has('x') || params.has('z') || params.has('yaw') || params.has('pitch')) {
      cinema.release();
      player.resetTo({ x: Number(params.get('x') ?? 0), z: Number(params.get('z') ?? 6), yaw: Number(params.get('yaw') ?? 0), pitch: Number(params.get('pitch') ?? 0) });
    }
    if (params.has('phase')) menuActions.sunPhase(Number(params.get('phase')));
    worldReady = true;
  });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  engine.resize();
});

if (params.get('ui') === '0') document.body.classList.add('hifi-noui');

const timer = new THREE.Timer();
timer.connect(document);
const _dir = new THREE.Vector3();
let frames = 0; let readyFrames = 0; let hudClock = 0;
const statsPanel = document.querySelector('.hf-hud');

engine.runRenderLoop(() => {
  timer.update();
  const dt = Math.min(timer.getDelta(), 0.1);

  // The app's own frame, in the main app's own order.
  if (!cinema.active) player.update(dt);
  registry.tick(dt, camera);
  motion.tick(dt);
  programManager.tick();
  cinema.tick(dt);
  markerTrail.tick();
  playIconManager.tick();
  speechBubbles.tick();
  webBrowserManager.tick();
  constructionManager.tick();
  buildGizmo.tick();

  // Mirror it, and put Babylon's eye where three's is.
  bridge.sync();
  camera.getWorldDirection(_dir);
  const p = camera.position;
  bcamera.position.set(p.x, p.y, p.z);
  bcamera.setTarget(new Vector3(p.x + _dir.x, p.y + _dir.y, p.z + _dir.z));
  bcamera.fov = (camera.fov * Math.PI) / 180;
  vrView.update();

  // The ground follows the world: a new theme or a new pond at once, the mask once a burst of
  // placements has settled (a duplicating program adds objects for seconds at a time).
  const themeNow = getWorldTheme();
  if (themeNow !== liveTheme) refreshGround();
  if (registry.count !== lastCount) { lastCount = registry.count; settle = 45; }
  else if (settle > 0 && --settle === 0) refreshGround();

  environment.update(dt);
  tickWind(dt);
  water.update(dt);
  natives.update(dt);
  grass.update(dt, p.x, p.z, p.y - player.eyeHeight);
  bscene.render();
  photoMode.afterRender();

  frames++;
  if (frames === 10) progress('Loading textures…', 0.8);
  if (worldReady && settle === 0 && bscene.isReady()) readyFrames++;
  if (readyFrames === 40) Promise.all(kit.pending).then(() => { document.getElementById('loading')?.remove(); window.__ready = true; });
  hudClock += dt;
  if (hudClock > 0.5 && statsPanel) { hudClock = 0; statsPanel.textContent = `${engine.getFps().toFixed(0)} fps · ${qualityName} · ${registry.count} objects`; }
});

if (import.meta.env.DEV) {
  window.__debug = {
    THREE, scene, camera, player, registry, worldStore, menu, menuActions, programManager, programEditor, objectMenu,
    constructionManager, primitiveMenu, buildGizmo, drawTool, importManager, webBrowserManager, markerTrail, cinema, vrView,
    engine, bscene, bcamera, environment, terrain, pipeline, grass, water, lights, kit, natives, bridge, refreshGround, touchNav,
  };
}
