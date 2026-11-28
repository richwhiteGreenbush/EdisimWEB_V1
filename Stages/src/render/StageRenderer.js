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
import { imageNow, maskFor } from '../project/assets.js';
import { HALF_H, HALF_W, STAGE_H, STAGE_W, boundsOf, costumeOf } from '../runtime/geometry.js';
import { toText } from '../runtime/cast.js';

const PEN_SCALE = 2; // pen canvas pixels per stage step

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

    this.pen = document.createElement('canvas');
    this.pen.width = STAGE_W * PEN_SCALE;
    this.pen.height = STAGE_H * PEN_SCALE;
    this.penCtx = this.pen.getContext('2d');
    this.penTexture = new THREE.CanvasTexture(this.pen);
    this.prepTexture(this.penTexture);
    this.penMesh = new THREE.Mesh(this.plane, this.makeMaterial(this.penTexture, this.pen.width, this.pen.height));
    this.penMesh.scale.set(STAGE_W, STAGE_H, 1);
    this.penMesh.renderOrder = -2;
    this.scene.add(this.penMesh);
    this.penDirty = false;

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

    if (this.penDirty) { this.penTexture.needsUpdate = true; this.penDirty = false; }
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(state);
  }

  // --- the overlay: bubbles, monitors, captions ------------------------------------------------

  drawOverlay(state) {
    const ctx = this.octx;
    const k = this.overlay.width / STAGE_W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    this.monitorRects = [];
    for (const m of state.monitors || []) {
      if (!m.visible) continue;
      this.drawMonitor(ctx, m, state.monitorLabel?.(m) ?? m.name, state.monitorValue?.(m));
    }
    for (const target of state.drawOrder) {
      const b = target._rt?.bubble;
      if (b && target.visible) this.drawBubble(ctx, target, b);
    }
    if (state.caption) this.drawCaption(ctx, state.caption);
    if (state.askQuestion != null) this.drawAsk(ctx, state.askQuestion);
  }

  drawMonitor(ctx, m, label, value) {
    const text = toText(value ?? '');
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    if (m.mode === 'large') {
      const w = Math.max(40, ctx.measureText(text).width + 16);
      roundRect(ctx, m.x, m.y, w, 24, 5, '#ff8c1a', '#db6e00');
      ctx.fillStyle = '#fff';
      ctx.font = '700 14px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(text, m.x + w / 2, m.y + 12.5);
      this.monitorRects.push({ id: m.id, x: m.x, y: m.y, w, h: 24 });
      return;
    }
    const lw = ctx.measureText(label).width;
    ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
    const vw = Math.max(36, ctx.measureText(text).width + 12);
    const w = lw + vw + 18;
    roundRect(ctx, m.x, m.y, w, 22, 4, '#e6f0ff', '#c4ccda');
    ctx.fillStyle = '#575e75';
    ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(label, m.x + 6, m.y + 11.5);
    roundRect(ctx, m.x + lw + 12, m.y + 3, vw, 16, 4, m.kind === 'variable' ? '#ff8c1a' : '#4c97ff', null);
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, m.x + lw + 12 + vw / 2, m.y + 11.5);
    this.monitorRects.push({ id: m.id, x: m.x, y: m.y, w, h: 22 });
  }

  // A bubble sits above the sprite's top right corner, and flips to the left when that would run off
  // the stage, as Scratch's does.
  drawBubble(ctx, target, bubble) {
    const b = boundsOf(target, maskFor);
    ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
    const lines = wrap(ctx, bubble.text, 150);
    const lh = 16;
    const w = Math.max(48, Math.min(170, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20));
    const h = lines.length * lh + 14;
    const sx = HALF_W + b.right;
    const sy = HALF_H - b.top;
    let left = sx - 8;
    let flipped = false;
    if (left + w > STAGE_W - 4) { left = HALF_W + b.left - w + 8; flipped = true; }
    left = Math.max(4, Math.min(STAGE_W - w - 4, left));
    let top = sy - h - 14;
    top = Math.max(4, Math.min(STAGE_H - h - 4, top));
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#c4ccda';
    ctx.fillStyle = '#ffffff';
    const tx = flipped ? left + w - 26 : left + 18;
    ctx.beginPath();
    ctx.roundRect(left, top, w, h, 12);
    ctx.fill();
    ctx.stroke();
    if (bubble.kind === 'think') {
      for (const [dx, dy, r] of [[0, 8, 4], [flipped ? 6 : -6, 16, 2.5]]) {
        ctx.beginPath();
        ctx.arc(tx + dx, top + h + dy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(tx, top + h - 1);
      ctx.lineTo(tx + (flipped ? 10 : -6), top + h + 11);
      ctx.lineTo(tx + (flipped ? -2 : 12), top + h - 1);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx, top + h);
      ctx.lineTo(tx + (flipped ? 10 : -6), top + h + 11);
      ctx.lineTo(tx + (flipped ? -2 : 12), top + h);
      ctx.stroke();
    }
    ctx.fillStyle = '#575e75';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, left + 10, top + 7 + i * lh));
    ctx.restore();
  }

  drawCaption(ctx, text) {
    ctx.save();
    ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
    const lines = wrap(ctx, text, 420).slice(0, 4);
    const lh = 22;
    const h = lines.length * lh + 18;
    const top = STAGE_H - h - 10;
    ctx.fillStyle = 'rgba(20, 24, 40, 0.78)';
    ctx.beginPath();
    ctx.roundRect(20, top, STAGE_W - 40, h, 10);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, HALF_W, top + 9 + i * lh));
    ctx.restore();
  }

  // The ask box. A real text field is laid over it while the project runs; the drawing is what an
  // exported video shows.
  drawAsk(ctx, question) {
    ctx.save();
    const top = STAGE_H - (question ? 66 : 44);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#c4ccda';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(10, top, STAGE_W - 20, STAGE_H - top - 10, 8);
    ctx.fill();
    ctx.stroke();
    if (question) {
      ctx.fillStyle = '#575e75';
      ctx.font = '700 13px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(question, 20, top + 8, STAGE_W - 40);
    }
    ctx.restore();
  }

  // --- the pen -------------------------------------------------------------------------------

  penXY(x, y) { return [(x + HALF_W) * PEN_SCALE, (HALF_H - y) * PEN_SCALE]; }

  penLine(x0, y0, x1, y1, colour, size) {
    const ctx = this.penCtx;
    const [a, b] = this.penXY(x0, y0);
    const [c, d] = this.penXY(x1, y1);
    ctx.strokeStyle = colour;
    ctx.lineWidth = size * PEN_SCALE;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
    this.penDirty = true;
  }

  penDot(x, y, colour, size) {
    const ctx = this.penCtx;
    const [a, b] = this.penXY(x, y);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(a, b, Math.max(0.5, (size * PEN_SCALE) / 2), 0, Math.PI * 2);
    ctx.fill();
    this.penDirty = true;
  }

  // Stamping draws the sprite's current look into the pen layer, effects included.
  penStamp(target) {
    const costume = costumeOf(target);
    const img = costume && imageNow(costume.assetId);
    if (!img || !target.visible) return;
    const ctx = this.penCtx;
    const s = (target.size / 100) / (costume.resolution || 1);
    const e = target._rt?.effects || {};
    ctx.save();
    const [px, py] = this.penXY(target.x, target.y);
    ctx.translate(px, py);
    if (target.rotationStyle === 'all around') ctx.rotate(((target.direction - 90) * Math.PI) / 180);
    if (target.rotationStyle === 'left-right' && target.direction < 0) ctx.scale(-1, 1);
    ctx.scale(s * PEN_SCALE, s * PEN_SCALE);
    ctx.globalAlpha = 1 - Math.max(0, Math.min(100, e.ghost || 0)) / 100;
    const filters = [];
    if (e.color) filters.push(`hue-rotate(${((e.color % 200) / 200) * 360}deg)`);
    if (e.brightness) filters.push(`brightness(${1 + e.brightness / 100})`);
    if (filters.length) ctx.filter = filters.join(' ');
    ctx.drawImage(img, -costume.cx, -costume.cy);
    ctx.restore();
    this.penDirty = true;
  }

  penClear() {
    this.penCtx.clearRect(0, 0, this.pen.width, this.pen.height);
    this.penDirty = true;
  }

  // The finished frame drawn into a 2D context: the video exporter's input.
  compositeTo(ctx, x, y, w, h) {
    ctx.drawImage(this.canvas, x, y, w, h);
    ctx.drawImage(this.overlay, x, y, w, h);
  }
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function wrap(ctx, text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else line = next;
      while (ctx.measureText(line).width > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > max) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}
