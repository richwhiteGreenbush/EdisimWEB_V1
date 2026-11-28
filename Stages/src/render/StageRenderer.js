// Draws the stage: the backdrop, the pen layer and every sprite, with three.js, plus a 2D overlay
// for speech bubbles, variable monitors and captions.
//
// WHY THREE.JS FOR A FLAT STAGE: it is already in the bundle, and the stage is a plane in a 3D scene
// looked at by an orthographic camera, so giving the stage depth later is a change of camera rather
// than a new renderer (plan, section 9). x runs right, y up, and the order sprites are drawn in is
// their layer order.
//
// COLOURS PASS THROUGH UNCHANGED. Every texture is NoColorSpace and the output is linear, with no
// tone mapping: a 2D picture must come out exactly the colour it was painted, which the main app's
// physically-based colour pipeline would not do.
//
// CLONES SHARE TEXTURES, one per asset, counted here. The main app builds a fresh material for every
// prop because PlacedRegistry.disposeObject3D() destroys whatever it is handed; Stages does not use
// the registry and owns its own disposal, so sharing is safe here and matters at 100 clones.
//
// EVERYTHING A VIDEO SHOWS IS DRAWN, NEVER DOM. The bubbles, monitors and captions are painted on
// the overlay canvas, so the video exporter's composite of the two canvases is exactly the stage.
import * as THREE from 'three';
import { imageNow } from '../project/assets.js';
import { HALF_H, HALF_W, STAGE_H, STAGE_W, costumeOf } from '../runtime/geometry.js';
import { drawOverlay } from './overlay.js';
import { PenLayer } from './penLayer.js';


const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The four graphic effects, done in the shader so each costs nothing per sprite.
const FRAGMENT = `
uniform sampler2D map;
uniform float uGhost;
uniform float uBright;
uniform float uColor;
uniform float uPixel;
uniform vec2 uSize;
varying vec2 vUv;
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  if (uPixel > 0.0) {
    vec2 cell = vec2(uPixel) / uSize;
    uv = (floor(uv / cell) + 0.5) * cell;
  }
  vec4 c = texture2D(map, uv);
  if (uColor != 0.0) {
    vec3 hsv = rgb2hsv(c.rgb);
    hsv.y = max(hsv.y, 0.09);
    hsv.z = max(hsv.z, 0.055);
    hsv.x = fract(hsv.x + uColor);
    c.rgb = hsv2rgb(hsv);
  }
  c.rgb = clamp(c.rgb + uBright, 0.0, 1.0);
  c.a *= 1.0 - uGhost;
  if (c.a < 0.004) discard;
  gl_FragColor = c;
}`;

export class StageRenderer {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.octx = overlay.getContext('2d');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0xffffff, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-HALF_W, HALF_W, HALF_H, -HALF_H, -1000, 1000);
    this.camera.position.z = 100;
    this.plane = new THREE.PlaneGeometry(1, 1);
    this.textures = new Map(); // assetId -> { texture, users }
    this.nodes = new Map(); // target -> { group, mesh, assetId }
    this.backdrop = this.makeNode();
    this.backdrop.group.renderOrder = -3;
    this.scene.add(this.backdrop.group);

    this.penLayer = new PenLayer();
    this.pen = this.penLayer.canvas;
    this.penTexture = new THREE.CanvasTexture(this.pen);
    this.prepTexture(this.penTexture);
    this.penMesh = new THREE.Mesh(this.plane, this.makeMaterial(this.penTexture, this.pen.width, this.pen.height));
    this.penMesh.scale.set(STAGE_W, STAGE_H, 1);
    this.penMesh.renderOrder = -2;
    this.scene.add(this.penMesh);

    this.cssW = STAGE_W;
    this.cssH = STAGE_H;
    this.pixelRatio = 1;
    this.monitorRects = [];
  }

  setSize(cssW, cssH, pixelRatio = window.devicePixelRatio || 1) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.pixelRatio = Math.min(2, pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(cssW, cssH, false);
    this.overlay.width = Math.round(cssW * this.pixelRatio);
    this.overlay.height = Math.round(cssH * this.pixelRatio);
  }

  // A pointer position on the canvas, as a stage point.
  toStage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * STAGE_W - HALF_W;
    const y = HALF_H - ((clientY - r.top) / r.height) * STAGE_H;
    return [x, y];
  }

  // The same, measured from the stage's top-left corner (where monitors are placed).
  toScreen(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * STAGE_W, ((clientY - r.top) / r.height) * STAGE_H];
  }

  prepTexture(t) {
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    t.premultiplyAlpha = false;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }

  makeMaterial(texture, w, h) {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        map: { value: texture }, uGhost: { value: 0 }, uBright: { value: 0 }, uColor: { value: 0 },
        uPixel: { value: 0 }, uSize: { value: new THREE.Vector2(w || 1, h || 1) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  makeNode() {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(this.plane, this.makeMaterial(null, 1, 1));
    mesh.visible = false;
    group.add(mesh);
    return { group, mesh, assetId: null };
  }

  textureFor(assetId) {
    let entry = this.textures.get(assetId);
    if (!entry) {
      const img = imageNow(assetId);
      if (!img) return null;
      const texture = new THREE.Texture(img);
      this.prepTexture(texture);
      entry = { texture, users: 0 };
      this.textures.set(assetId, entry);
    }
    return entry;
  }

  setNodeAsset(node, assetId) {
    if (node.assetId === assetId) return;
    if (node.assetId) {
      const old = this.textures.get(node.assetId);
      if (old && --old.users <= 0) { old.texture.dispose(); this.textures.delete(node.assetId); }
    }
    node.assetId = null;
    const entry = assetId ? this.textureFor(assetId) : null;
    if (!entry) { node.mesh.material.uniforms.map.value = null; return; }
    entry.users++;
    node.assetId = assetId;
    node.mesh.material.uniforms.map.value = entry.texture;
  }

  // Lays a costume into a node: where the picture sits relative to its rotation centre, and how big.
  placeCostume(node, target, costume) {
    const s = (target.size / 100) / (costume.resolution || 1);
    let flip = 1;
    let theta = 0;
    if (!target.isStage) {
      if (target.rotationStyle === 'all around') theta = ((90 - target.direction) * Math.PI) / 180;
      else if (target.rotationStyle === 'left-right' && target.direction < 0) flip = -1;
    }
    node.group.position.set(target.isStage ? 0 : target.x, target.isStage ? 0 : target.y, 0);
    node.group.rotation.z = theta;
    const w = costume.width;
    const h = costume.height;
    node.mesh.position.set((w / 2 - costume.cx) * s * flip, -(h / 2 - costume.cy) * s, 0);
    node.mesh.scale.set(w * s * flip, h * s, 1);
    const u = node.mesh.material.uniforms;
    u.uSize.value.set(w, h);
  }

  applyEffects(node, effects) {
    const u = node.mesh.material.uniforms;
    u.uGhost.value = Math.max(0, Math.min(100, effects.ghost || 0)) / 100;
    u.uBright.value = Math.max(-100, Math.min(100, effects.brightness || 0)) / 100;
    u.uColor.value = ((effects.color || 0) % 200) / 200;
    u.uPixel.value = Math.abs(effects.pixelate || 0) / 10;
  }

  // Draws one frame. `state` is { stage, drawOrder, caption, monitors, monitorValue, editing }.
  render(state) {
    const stage = state.stage;
    const bd = costumeOf(stage);
    if (bd) {
      this.setNodeAsset(this.backdrop, bd.assetId);
      this.backdrop.mesh.visible = !!this.backdrop.assetId;
      // A backdrop is fitted to the stage whatever its size, as in Scratch at resolution 2.
      const s = Math.min(STAGE_W / (bd.width / (bd.resolution || 1)), STAGE_H / (bd.height / (bd.resolution || 1)));
      this.placeCostume(this.backdrop, { isStage: true, size: s * 100 }, bd);
      this.applyEffects(this.backdrop, stage._rt?.effects || {});
    } else {
      this.backdrop.mesh.visible = false;
    }

    const live = new Set(state.drawOrder);
    for (const [target, node] of this.nodes) {
      if (!live.has(target)) {
        this.setNodeAsset(node, null);
        node.mesh.material.dispose();
        this.scene.remove(node.group);
        this.nodes.delete(target);
      }
    }
    state.drawOrder.forEach((target, i) => {
      let node = this.nodes.get(target);
      if (!node) {
        node = this.makeNode();
        this.nodes.set(target, node);
        this.scene.add(node.group);
      }
      const costume = costumeOf(target);
      node.group.renderOrder = i;
      node.mesh.renderOrder = i;
      if (!costume || !target.visible) { node.mesh.visible = false; return; }
      this.setNodeAsset(node, costume.assetId);
      node.mesh.visible = !!node.assetId;
      this.placeCostume(node, target, costume);
      this.applyEffects(node, target._rt?.effects || {});
    });

    if (this.penLayer.dirty) { this.penTexture.needsUpdate = true; this.penLayer.dirty = false; }
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(state);
  }

  // --- the overlay: bubbles, monitors, captions (drawn by overlay.js) --------------------------

  drawOverlay(state) {
    const k = this.overlay.width / STAGE_W;
    this.monitorRects = drawOverlay(this.octx, k, state);
  }

  // --- the pen (PenLayer, shared with the 3D stage) ------------------------------------------

  penLine(...a) { this.penLayer.line(...a); }
  penDot(...a) { this.penLayer.dot(...a); }
  penStamp(t) { this.penLayer.stamp(t); }
  penClear() { this.penLayer.clear(); }

  // The finished frame drawn into a 2D context: the video exporter's input.
  compositeTo(ctx, x, y, w, h) {
    ctx.drawImage(this.canvas, x, y, w, h);
    ctx.drawImage(this.overlay, x, y, w, h);
  }
}
