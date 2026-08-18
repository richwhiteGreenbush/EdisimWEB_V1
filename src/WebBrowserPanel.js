import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { nextPlacementXZ, faceCamera } from './Placement.js';
import {
  WEB_BROWSER_WIDTH,
  WEB_BROWSER_HEIGHT,
  WEB_BROWSER_DOM_WIDTH,
  WEB_BROWSER_DOM_HEIGHT,
  WEB_BROWSER_DEFAULT_URL,
  EDIT_ICON_SIZE,
  EDIT_ICON_MARGIN,
} from './config.js';

import { uuid } from './Uuid.js';
import { normalizeBrowserUrl, secureFrameUrl } from './WebUrl.js';
const PIXELS_TO_FEET = WEB_BROWSER_WIDTH / WEB_BROWSER_DOM_WIDTH;
const CLICK_MOVE_THRESHOLD = 6; // px -- beyond this, a pointerdown->pointerup is a look-drag, not a click
const CLICK_TIME_THRESHOLD = 500; // ms

// A blue pencil badge, matching PlayIcon.js's canvas-drawn style but a distinct
// color/glyph so the two floating icons read as different actions at a glance.
function buildEditIconTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fillStyle = '#3d8bf2';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1f5aad';
  ctx.stroke();

  ctx.save();
  ctx.translate(64, 68);
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-7, -30, 14, 40); // pencil shaft
  ctx.beginPath();
  ctx.moveTo(-7, 10);
  ctx.lineTo(7, 10);
  ctx.lineTo(0, 26);
  ctx.closePath();
  ctx.fill(); // pencil tip
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A "browser panel" is really two synchronized objects: a normal WebGL bezel mesh
// (the thing Size/Move/Program/persistence/raycasting all already know how to
// handle, same as every other placed object) and a CSS3DObject wrapping a real
// <iframe> that visually follows the bezel's transform every frame. There is no way
// to pipe a live, interactive iframe into a WebGL texture -- CSS3DRenderer, which
// positions real DOM elements with CSS 3D transforms instead of rasterizing them, is
// the only way to have genuinely interactive (clickable, scrollable, typeable) web
// content inside a Three.js scene.
//
// Every mouse action on the panel itself (left-click, right-click, scroll) is left
// alone for normal browsing -- Size/Move/Program is reached only through a floating
// WebGL "edit" icon hovering above the panel, same click-to-open pattern as
// PlayIcon.js, so it can never be confused with a click on the page underneath.
export class WebBrowserManager {
  constructor({ scene, camera, canvas, onEditClick }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.onEditClick = onEditClick;

    this.cssScene = new THREE.Scene();
    this.cssRenderer = new CSS3DRenderer();
    this.cssRenderer.domElement.id = 'css3d-layer';
    document.body.appendChild(this.cssRenderer.domElement);
    this.handleResize();

    this.editIconTexture = buildEditIconTexture();
    this.panels = new Map(); // id -> { bezelMesh, cssObject, wrapperEl, editIcon }

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.downPos = null;
    this.downTime = 0;

    // While the player is dragging to look around, the cursor's start point can
    // sweep across a panel mid-drag. Once the pointer is truly over the iframe (a
    // separate document), our window-level mouse listeners stop seeing move/up
    // events entirely, effectively "eating" the drag. Suspending pointer-events on
    // every panel for the duration of any canvas-originated drag sidesteps that.
    // The same pointerdown/up pair also tracks a click (vs. drag) for the edit icon.
    this.onCanvasPointerDown = (e) => {
      if (e.button !== 0) return;
      this.downPos = { x: e.clientX, y: e.clientY };
      this.downTime = performance.now();
      this.setPanelsInteractive(false);
    };
    this.onWindowPointerUp = (e) => {
      this.setPanelsInteractive(true);
      this.tryPickEditIcon(e);
    };
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    window.addEventListener('pointerup', this.onWindowPointerUp);

    this.onResize = () => this.handleResize();
    window.addEventListener('resize', this.onResize);
  }

  handleResize() {
    this.cssRenderer.setSize(window.innerWidth, window.innerHeight);
  }

  setPanelsInteractive(interactive) {
    for (const { wrapperEl } of this.panels.values()) {
      wrapperEl.style.pointerEvents = interactive ? 'auto' : 'none';
    }
  }

  tryPickEditIcon(e) {
    if (e.button !== 0 || !this.downPos) return;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - this.downTime;
    this.downPos = null;
    if (dist > CLICK_MOVE_THRESHOLD || dt > CLICK_TIME_THRESHOLD) return; // was a look-drag, not a click
    if (e.target !== this.canvas) return; // click landed on UI, not the world
    if (!this.panels.size) return;

    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // Sprite.raycast() reads modelViewMatrix, which three.js only refreshes as a
    // side effect of an actual renderer.render() call -- repositioning a sprite (or
    // moving the camera) via tick() does NOT update it. A click can land between
    // frames with no render in between, so it must be refreshed explicitly here or
    // the raycast can silently miss a sprite that's visually right under the cursor.
    this.camera.updateMatrixWorld();
    const icons = [...this.panels.values()].map((p) => p.editIcon);
    for (const icon of icons) {
      icon.updateMatrixWorld(true);
      icon.modelViewMatrix.multiplyMatrices(this.camera.matrixWorldInverse, icon.matrixWorld);
    }
    const hits = this.raycaster.intersectObjects(icons, false);
    if (!hits.length) return;

    // ObjectMenu registers its own independent pointerdown/pointerup pair on this
    // same canvas/window (after this manager, so it runs second) -- without this,
    // its own click-detection sees the exact same click, raycasts the 3D scene at
    // the same point, finds nothing there (the icon floats in otherwise-empty space
    // above the panel), and calls close() right after this handler just opened the
    // menu, silently undoing it in the same event dispatch. stopImmediatePropagation
    // prevents that later-registered listener from running at all for this event.
    e.stopImmediatePropagation?.();

    const id = hits[0].object.userData.placedId;
    this.onEditClick?.(id, e.clientX, e.clientY);
  }

  positionEditIcon(editIcon, bezelMesh) {
    const box = new THREE.Box3().setFromObject(bezelMesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    editIcon.position.set(center.x, box.max.y + EDIT_ICON_MARGIN, center.z);
  }

  // Builds the bezel + CSS3D iframe + edit icon triple, but does not place or
  // register it -- used both for fresh placement and for rehydrating a saved record.
  createPanel(record, worldStore) {
    const bezelMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(WEB_BROWSER_WIDTH, WEB_BROWSER_HEIGHT),
      new THREE.MeshStandardMaterial({ color: 0x1a1e23, roughness: 0.8 })
    );
    bezelMesh.userData.isWebBrowser = true;

    const editIcon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.editIconTexture, depthTest: false, transparent: true }));
    editIcon.scale.set(EDIT_ICON_SIZE, EDIT_ICON_SIZE, 1);
    editIcon.renderOrder = 999;
    editIcon.userData.placedId = record.id;
    this.scene.add(editIcon);

    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'wb-panel';
    wrapperEl.style.width = `${WEB_BROWSER_DOM_WIDTH}px`;
    wrapperEl.style.height = `${WEB_BROWSER_DOM_HEIGHT}px`;

    const toolbar = document.createElement('div');
    toolbar.className = 'wb-toolbar';
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.className = 'wb-url-input';
    urlInput.value = record.url;
    urlInput.spellcheck = false;
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.className = 'wb-go-btn';
    goBtn.textContent = 'Go';
    toolbar.append(urlInput, goBtn);

    const frameWrap = document.createElement('div');
    frameWrap.className = 'wb-frame-wrap';
    const iframe = document.createElement('iframe');
    iframe.className = 'wb-iframe';
    iframe.src = secureFrameUrl(record.url);
    // 'origin', not 'no-referrer'. This used to send nothing at all, which is the more
    // private setting and is what breaks a YouTube embed outright: the player checks the
    // referrer against the video's embedding permissions and answers a request carrying
    // none with "Error 153 -- Video player configuration error", which renders as YouTube's
    // own dark chrome with a warning triangle in it and looks exactly like a broken app.
    // 'origin' sends the scheme and host and never the path, so which page a student is on
    // still does not leave the machine -- it is stricter than the browser's own default.
    iframe.setAttribute('referrerpolicy', 'origin');
    // A framed video player is inert without these. Autoplay and encrypted-media are what
    // a YouTube embed needs to start and to play its protected streams at all; fullscreen
    // is the one control on the player that reaches outside the frame, and without the
    // attribute its button is present and does nothing. Deliberately NOT granted:
    // camera, microphone, geolocation and clipboard-write, none of which any page in a
    // panel has a reason to want and all of which would be granted to every site a
    // student ever types in, not just to the video they asked for.
    iframe.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture');
    iframe.setAttribute('allowfullscreen', '');
    frameWrap.appendChild(iframe);

    const hint = document.createElement('div');
    hint.className = 'wb-hint';
    hint.textContent = 'Some sites block being embedded here — try Wikipedia, MDN, or your own site. Click the ✎ icon above to resize or move.';

    wrapperEl.append(toolbar, frameWrap, hint);

    const navigate = () => {
      const url = normalizeBrowserUrl(urlInput.value);
      if (!url) return;
      urlInput.value = url;
      iframe.src = secureFrameUrl(url);
      record.url = url;
      worldStore?.saveObject(record);
    };
    goBtn.addEventListener('click', navigate);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') navigate();
    });

    const cssObject = new CSS3DObject(wrapperEl);
    this.cssScene.add(cssObject);
    this.panels.set(record.id, { bezelMesh, cssObject, wrapperEl, editIcon });

    return bezelMesh;
  }

  removePanel(id) {
    const panel = this.panels.get(id);
    if (!panel) return;
    this.cssScene.remove(panel.cssObject);
    panel.wrapperEl.remove();
    this.scene.remove(panel.editIcon);
    panel.editIcon.material.dispose();
    this.panels.delete(id);
  }

  clear() {
    for (const id of [...this.panels.keys()]) this.removePanel(id);
  }

  // Every placed object lives directly under `scene` (no nested parenting anywhere
  // in this app), so a mesh's own position/quaternion/scale ARE its world transform
  // -- no matrixWorld staleness to worry about, and no ordering dependency on when
  // this runs relative to renderer.render().
  tick() {
    if (!this.panels.size) return;
    for (const { bezelMesh, cssObject, editIcon } of this.panels.values()) {
      cssObject.position.copy(bezelMesh.position);
      cssObject.quaternion.copy(bezelMesh.quaternion);
      cssObject.scale.copy(bezelMesh.scale).multiplyScalar(PIXELS_TO_FEET);
      this.positionEditIcon(editIcon, bezelMesh);
    }
    this.cssRenderer.render(this.cssScene, this.camera);
  }
}

export function placeWebBrowser({ scene, camera, registry, groundHeightAt, webBrowserManager, worldStore, url = WEB_BROWSER_DEFAULT_URL }) {
  // The spiral counts LIVE PANELS, not registry.count -- the same correction
  // placePrimitive() carries, and for the same reason. In a preset world the registry is
  // already in the dozens or hundreds, and SPAWN_SPACING*sqrt(n) then exceeds
  // SPAWN_DISTANCE and wraps the placement round BEHIND the camera: on Da Vinci's Studio
  // (59 records) a fresh panel landed 51ft away over the student's shoulder, so the toast
  // said "placed" and there was nothing anywhere in front of them. Counting the handful of
  // panels that actually exist keeps the first one at the drop point where it was asked
  // for. `panels` has not been added to yet at this point, so this is the count before it.
  const { x, z } = nextPlacementXZ(camera, webBrowserManager.panels.size);
  const id = uuid();
  const record = {
    id,
    kind: 'web-browser',
    createdAt: Date.now(),
    url,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };

  const bezelMesh = webBrowserManager.createPanel(record, worldStore);
  const groundY = groundHeightAt(x, z);
  bezelMesh.position.set(x, groundY + WEB_BROWSER_HEIGHT / 2, z);
  faceCamera(bezelMesh, camera);
  scene.add(bezelMesh);

  record.transform = {
    position: bezelMesh.position.toArray(),
    rotation: [bezelMesh.rotation.x, bezelMesh.rotation.y, bezelMesh.rotation.z],
    scale: bezelMesh.scale.toArray(),
  };

  registry.add(id, bezelMesh, { record });
  return { bezelMesh, record };
}
