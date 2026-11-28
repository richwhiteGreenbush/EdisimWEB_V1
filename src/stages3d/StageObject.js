// AN EDUSIM STAGES PROJECT, STANDING IN A 3D WORLD (the `stages-project` record kind).
//
// Convert to 3D World in Stages puts a whole 2D project into a world as ONE object, and this runs it
// with THE STAGES RUNTIME ITSELF (Stages/src/runtime/), the same code that runs it in 2D. Nothing is
// translated into this app's blocks, so nothing is lost: keys, touching, clones, costumes, sounds,
// ask and the pen work at the same speed as in 2D, because they are the same program (plan:
// edusim-stages-to-3d-plan.md, decision A). The runtime is pure JavaScript and draws through a `host`;
// here the host draws sprites as objects in the world.
//
// Two layouts (the record's `layout`):
//   set    the stage stands upright like a theatre set; sprites are cutouts on it
//   board  the stage lies on the ground like a giant game board; picture sprites stand up and turn
//          to face the student (decision B)
// A sprite that came from the Model Database (`library: 'model:<id>'`) becomes the real 3D model
// again, its costume number turning it, since its 12 costumes were 12 angles of it.
//
// HIFI DRAWS THIS TOO, through ThreeBridge, so everything here is scene-graph state the bridge can
// read: planes with MeshBasicMaterial, canvas textures (their `version` bumps on needsUpdate),
// sprites. No ShaderMaterial, so the 2D shader's effects become material settings: ghost is
// opacity, brightness darkens through the colour, colour is a tint, pixelate is not drawn in 3D.
//
// It takes camera, cinema and canvas by INJECTION (configureStages3D), never a renderer.
import * as THREE from 'three';
import { fromFileText } from '../../Stages/src/project/Project.js';
import { imageNow, maskFor, preloadProject } from '../../Stages/src/project/assets.js';
import { FRAME_RATE, Runtime, keyName } from '../../Stages/src/runtime/Runtime.js';
import { STAGE_H, STAGE_W, costumeOf } from '../../Stages/src/runtime/geometry.js';
import { AudioEngine } from '../../Stages/src/audio/AudioEngine.js';
import { drawOverlay } from '../../Stages/src/render/overlay.js';
import { PenLayer } from '../../Stages/src/render/penLayer.js';
import { putHandoff } from '../../Stages/src/project/handoff.js';

// Feet per stage step. Life size makes a 100-step character 5 ft tall, the student's own height
// (EYE_HEIGHT), and the set 24 x 18 ft (decision C).
export const STAGE_SIZES = {
  small: { step: 1 / 80, lift: 2.6, label: 'Small' },
  life: { step: 1 / 20, lift: 0.6, label: 'Life size' },
  huge: { step: 1 / 5, lift: 0, label: 'Huge' },
};

const ctx3d = { camera: null, cinema: null, domElement: null, menu: null, registry: null };

// main.js (and HiFi's) hands these in once. Without them a stage still draws and animates; it just
// cannot be played with keys.
export function configureStages3D(ctx) {
  Object.assign(ctx3d, ctx);
}

// The stage's footprint in feet, for placing one before it is built.
export function stageFootprint(layout, size) {
  const s = STAGE_SIZES[size] || STAGE_SIZES.life;
  const w = STAGE_W * s.step;
  const h = STAGE_H * s.step;
  return layout === 'board' ? { width: w, depth: h, height: h * 0.4 } : { width: w, depth: w * 0.12, height: h + s.lift };
}

function canvasFromImage(img) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, img.width);
  c.height = Math.max(1, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

export async function buildStageObject(record) {
  const file = record.files?.[0];
  if (!file?.data) throw new Error('This stage has no project inside it.');
  const project = fromFileText(await file.data.text());
  await preloadProject(project);
  const stage = new StageObject(record, project);
  await stage.ready;
  return stage.root;
}

class StageObject {
  constructor(record, project) {
    this.record = record;
    this.project = project;
    this.layout = record.layout === 'board' ? 'board' : 'set';
    const size = STAGE_SIZES[record.size] || STAGE_SIZES.life;
    this.step = size.step;
    this.lift = size.lift;
    this.W = STAGE_W * this.step;
    this.H = STAGE_H * this.step;
    this.textures = new Map();
    this.nodes = new Map();
    this.models = new Map();
    this.bubbleSprites = new Map();
    this.playing = false;
    this.started = false;
    this.acc = 0;
    this.overlaySig = '';
    this.audio = new AudioEngine();
    this.penLayer = new PenLayer();

    // The clock and the dice can be swapped for a check tool's (see Stages/tools/check-stages3d.mjs),
    // which runs the same project in 2D and 3D on one virtual clock.
    this.clock = () => performance.now() / 1000;
    this.dice = Math.random;
    this.runtime = new Runtime(project, {
      now: () => this.clock(),
      random: () => this.dice(),
      maskFor,
      audio: this.audio,
      pen: {
        line: (...a) => this.penLayer.line(...a),
        dot: (...a) => this.penLayer.dot(...a),
        stamp: (t) => this.penLayer.stamp(t),
        clear: () => this.penLayer.clear(),
      },
      onAsk: () => this.updateAsk(),
    });

    this.root = new THREE.Group();
    this.root.name = `Stages: ${project.title}`;
    this.root.userData.stagesProject = this;
    this.root.userData.tick = { update: (dt, camera) => this.update(dt, camera), dispose: () => this.dispose() };

    // Everything on the stage's own surface lives in `plane`, in stage steps scaled to feet: x right,
    // y up the stage, z toward the audience. The board is the same plane laid down.
    this.plane = new THREE.Group();
    this.plane.scale.setScalar(this.step);
    if (this.layout === 'board') {
      this.plane.rotation.x = -Math.PI / 2;
      this.boardTop = Math.max(0.12, this.step * 3);
      this.plane.position.set(0, this.boardTop, 0);
    } else {
      this.plane.position.set(0, this.lift + this.H / 2, 0);
    }
    this.root.add(this.plane);
    this.zStep = 0.4; // steps between layers; tiny in feet

    this.buildFurniture();
    this.backdrop = this.flat(STAGE_W, STAGE_H, 0, { opaque: true });
    this.penTexture = new THREE.CanvasTexture(this.penLayer.canvas);
    this.penTexture.colorSpace = THREE.SRGBColorSpace;
    this.penMesh = this.flat(STAGE_W, STAGE_H, this.zStep * 0.5, { map: this.penTexture });

    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.width = STAGE_W * 2;
    this.overlayCanvas.height = STAGE_H * 2;
    this.overlayTexture = new THREE.CanvasTexture(this.overlayCanvas);
    this.overlayTexture.colorSpace = THREE.SRGBColorSpace;
    if (this.layout === 'set') {
      this.overlayMesh = this.flat(STAGE_W, STAGE_H, 0, { map: this.overlayTexture });
    } else {
      // On a board, bubbles float over each sprite instead, and the monitors and captions go on a
      // sign standing at the far edge, where they can be read.
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(this.W * 0.55, this.H * 0.55), this.material({ map: this.overlayTexture }));
      sign.position.set(0, this.boardTop + this.H * 0.3 + 0.4, -this.H / 2 - 0.4);
      this.root.add(sign);
      this.overlayMesh = sign;
    }

    this.ready = this.loadModels().then(() => this.sync(null));
  }

  // --- building ----------------------------------------------------------------------------

  material({ map = null, opaque = false } = {}) {
    const m = new THREE.MeshBasicMaterial({ map, transparent: !opaque, alphaTest: opaque ? 0 : 0.04, side: THREE.DoubleSide, toneMapped: false });
    return m;
  }

  // A flat panel on the stage surface, `w` x `h` steps, at depth `z` steps toward the audience.
  flat(w, h, z, opts) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.material(opts));
    mesh.position.z = z;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.plane.add(mesh);
    return mesh;
  }

  // The frame round a set, or the slab under a board: so the stage reads as a made thing standing in
  // the world rather than a picture hanging in the air.
  buildFurniture() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x2b3350, roughness: 0.7 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc42d4a, roughness: 0.6 });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
      return m;
    };
    const t = Math.max(0.08, this.W * 0.02);
    if (this.layout === 'board') {
      add(new THREE.BoxGeometry(this.W + t * 2, this.boardTop, this.H + t * 2), wood, 0, this.boardTop / 2 - 0.01, 0);
      return;
    }
    const d = Math.max(0.1, this.W * 0.03);
    const midY = this.lift + this.H / 2;
    add(new THREE.BoxGeometry(this.W + t * 2, t, d), trim, 0, this.lift + this.H + t / 2, -d / 2 + 0.01);
    add(new THREE.BoxGeometry(t, this.H + t * 2, d), trim, -this.W / 2 - t / 2, midY, -d / 2 + 0.01);
    add(new THREE.BoxGeometry(t, this.H + t * 2, d), trim, this.W / 2 + t / 2, midY, -d / 2 + 0.01);
    add(new THREE.BoxGeometry(this.W + t * 2, this.lift + t, d * 4), wood, 0, (this.lift + t) / 2 - 0.01, 0);
    // A back panel, so the set does not show its painting reversed from behind.
    add(new THREE.BoxGeometry(this.W, this.H, 0.02), wood, 0, midY, -d * 0.5);
  }

  textureFor(assetId) {
    let tex = this.textures.get(assetId);
    if (!tex) {
      const img = imageNow(assetId);
      if (!img) return null;
      tex = new THREE.CanvasTexture(canvasFromImage(img));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.textures.set(assetId, tex);
    }
    return tex;
  }

  // Model Database sprites come back as their models, built once per model; clones share it.
  async loadModels() {
    const ids = new Set();
    for (const t of this.project.targets) {
      const lib = t.library || '';
      if (!t.isStage && lib.startsWith('model:')) ids.add(lib.slice(6));
    }
    if (!ids.size) return;
    let buildCatalogModel;
    try {
      ({ buildCatalogModel } = await import('../models/index.js'));
    } catch { return; }
    for (const id of ids) {
      try {
        const object = await buildCatalogModel(id, { skirt: false });
        const box = new THREE.Box3().setFromObject(object);
        const centre = box.getCenter(new THREE.Vector3());
        const radius = Math.max(0.01, box.getSize(new THREE.Vector3()).length() / 2);
        this.models.set(id, { object, centre, radius, min: box.min.clone(), used: false });
      } catch (err) {
        console.warn('[stages3d] could not build model', id, err);
      }
    }
  }

  // --- each frame ----------------------------------------------------------------------------

  update(dt, camera) {
    if (this.started) {
      this.acc += Math.min(dt, 0.25);
      const frame = 1 / FRAME_RATE;
      let n = 0;
      while (this.acc >= frame && n < 3) { this.runtime.step(); this.acc -= frame; n++; }
      if (n === 3) this.acc = 0;
    }
    this.sync(camera);
  }

  sync(camera) {
    const stage = this.runtime.stage;
    const bd = costumeOf(stage);
    const bdTex = bd && this.textureFor(bd.assetId);
    if (this.backdrop.material.map !== bdTex) { this.backdrop.material.map = bdTex; this.backdrop.material.needsUpdate = true; }
    applyEffects(this.backdrop.material, stage._rt?.effects);
    if (this.penLayer.dirty) { this.penTexture.needsUpdate = true; this.penLayer.dirty = false; }

    const order = this.runtime.drawOrder;
    const live = new Set(order);
    for (const [target, node] of this.nodes) {
      if (!live.has(target)) { this.dropNode(node); this.nodes.delete(target); }
    }
    let camLocal = null;
    if (camera && this.layout === 'board') {
      this.root.updateMatrixWorld();
      camLocal = this.root.worldToLocal(camera.position.clone());
    }
    order.forEach((target, i) => {
      let node = this.nodes.get(target);
      if (!node) { node = this.makeNode(target); this.nodes.set(target, node); }
      this.placeNode(node, target, i, camLocal);
    });
    this.syncOverlay(order);
  }

  makeNode(target) {
    const original = target.isClone ? target.original : target;
    const lib = original.library || '';
    const model = lib.startsWith('model:') ? this.models.get(lib.slice(6)) : null;
    const pivot = new THREE.Group();
    if (model) {
      const object = model.used ? model.object.clone(true) : model.object;
      model.used = true;
      object.position.copy(model.centre).multiplyScalar(-1);
      const holder = new THREE.Group();
      holder.add(object);
      pivot.add(holder);
      (this.layout === 'board' ? this.root : this.plane).add(pivot);
      return { pivot, holder, model, object, ghost: -1 };
    }
    const mesh = new THREE.Mesh(this.unitPlane || (this.unitPlane = new THREE.PlaneGeometry(1, 1)), this.material());
    mesh.castShadow = false;
    pivot.add(mesh);
    (this.layout === 'board' ? this.root : this.plane).add(pivot);
    return { pivot, mesh };
  }

  dropNode(node) {
    node.pivot.parent?.remove(node.pivot);
    node.mesh?.material.dispose();
    if (node.model && node.object !== node.model.object) node.object.removeFromParent();
    if (node.model && node.object === node.model.object) node.model.used = false;
  }

  placeNode(node, target, i, camLocal) {
    const costume = costumeOf(target);
    node.pivot.visible = !!(costume && target.visible);
    if (!node.pivot.visible) return;
    const res = costume.resolution || 1;
    const s = target.size / 100 / res; // steps per costume pixel
    const hSteps = costume.height * s;
    const effects = target._rt?.effects || {};

    if (node.model) {
      // The 12 costumes were the model photographed from 12 sides, so costume n turns it to side n.
      const { model } = node;
      const k = (hSteps * this.step) / (2 * model.radius * 1.02); // feet per model unit
      const yaw = ((target.currentCostume || 0) / Math.max(1, (target.isClone ? target.original : target).costumes.length)) * Math.PI * 2;
      if (this.layout === 'board') {
        node.pivot.position.set(target.x * this.step, this.boardTop + (model.centre.y - model.min.y) * k, -target.y * this.step);
        node.holder.scale.setScalar(k);
      } else {
        // On a set the model stands just in front of the painting, its back near the panel.
        node.pivot.position.set(target.x, target.y, this.zStep * (i + 2) + (model.radius * k) / this.step);
        node.holder.scale.setScalar(k / this.step);
      }
      node.holder.rotation.y = yaw;
      const ghost = Math.max(0, Math.min(100, effects.ghost || 0));
      if (ghost !== node.ghost) {
        node.ghost = ghost;
        node.object.traverse((n) => {
          for (const m of Array.isArray(n.material) ? n.material : n.material ? [n.material] : []) {
            if (m.userData.wasTransparent === undefined) m.userData.wasTransparent = m.transparent;
            m.transparent = ghost > 0 || m.userData.wasTransparent;
            m.opacity = 1 - ghost / 100;
          }
        });
      }
      return;
    }

    // On a board, a sprite as big as the stage is scenery (a maze's walls, a level's platforms):
    // it lies flat on the board with the backdrop rather than standing up as one giant cutout.
    const flat = this.layout === 'set' || (costume.width * s >= STAGE_W * 0.6 || costume.height * s >= STAGE_H * 0.6);
    const parent = flat ? this.plane : this.root;
    if (node.pivot.parent !== parent) { parent.add(node.pivot); node.pivot.rotation.set(0, 0, 0); }
    const tex = this.textureFor(costume.assetId);
    const mat = node.mesh.material;
    if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
    applyEffects(mat, effects);
    let flip = 1;
    let theta = 0;
    if (target.rotationStyle === 'left-right' && target.direction < 0) flip = -1;
    if (target.rotationStyle === 'all around') theta = ((90 - target.direction) * Math.PI) / 180;
    const w = costume.width;
    const h = costume.height;
    if (!flat) {
      // Standing up, turned to the student, centred on the sprite's spot (decision B).
      const hFeet = hSteps * this.step;
      node.pivot.position.set(target.x * this.step, this.boardTop + hFeet / 2, -target.y * this.step);
      if (camLocal) node.pivot.rotation.y = Math.atan2(camLocal.x - node.pivot.position.x, camLocal.z - node.pivot.position.z);
      node.mesh.scale.set(w * s * this.step * flip, hFeet, 1);
      node.mesh.position.set(0, 0, 0);
      return;
    }
    node.pivot.position.set(target.x, target.y, this.zStep * (i + 2));
    node.pivot.rotation.z = theta;
    node.mesh.position.set((w / 2 - costume.cx) * s * flip, -(h / 2 - costume.cy) * s, 0);
    node.mesh.scale.set(w * s * flip, h * s, 1);
  }

  // The overlay is redrawn only when what it shows has changed.
  syncOverlay(order) {
    const rt = this.runtime;
    const board = this.layout === 'board';
    const bubbleSig = order.map((t) => (t._rt?.bubble && t.visible ? `${t._rt.bubble.text}@${Math.round(t.x)},${Math.round(t.y)}` : '')).join('|');
    const monitors = this.project.monitors.filter((m) => m.visible).map((m) => `${m.id}=${rt.monitorValue(m)}`).join('|');
    const sig = `${board ? '' : bubbleSig}#${monitors}#${rt.caption || ''}`;
    if (sig !== this.overlaySig) {
      this.overlaySig = sig;
      drawOverlay(this.overlayCanvas.getContext('2d'), 2, {
        drawOrder: order, monitors: this.project.monitors, bubbles: !board, caption: rt.caption,
        monitorValue: (m) => rt.monitorValue(m), monitorLabel: (m) => this.monitorLabel(m),
      });
      this.overlayTexture.needsUpdate = true;
      this.overlayMesh.position.z = board ? this.overlayMesh.position.z : this.zStep * (order.length + 4);
    }
    if (board) this.syncBubbleSprites(order);
  }

  monitorLabel(m) {
    const owner = m.target ? this.project.targets.find((t) => t.id === m.target) : null;
    const label = m.kind === 'variable' ? m.name : (m.opcode || '').replace(/^[a-z]+_/, '').replace(/_/g, ' ');
    return owner ? `${owner.name}: ${label}` : label;
  }

  // On a board, each speech bubble floats over its sprite as a billboard.
  syncBubbleSprites(order) {
    const live = new Set();
    for (const t of order) {
      const b = t._rt?.bubble;
      if (!b || !t.visible) continue;
      live.add(t);
      let entry = this.bubbleSprites.get(t);
      if (!entry || entry.text !== b.text || entry.kind !== b.kind) {
        if (entry) { entry.sprite.material.map.dispose(); entry.sprite.material.dispose(); entry.sprite.removeFromParent(); }
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 240;
        paintBubble(c.getContext('2d'), b.text, b.kind, c.width, c.height);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, toneMapped: false }));
        this.root.add(sprite);
        entry = { sprite, text: b.text, kind: b.kind };
        this.bubbleSprites.set(t, entry);
      }
      const costume = costumeOf(t);
      const hFeet = costume ? (costume.height / (costume.resolution || 1)) * (t.size / 100) * this.step : 2;
      const w = Math.max(2.5, this.W * 0.2);
      entry.sprite.scale.set(w, w / 2, 1);
      entry.sprite.position.set(t.x * this.step, this.boardTop + hFeet + w / 4, -t.y * this.step);
    }
    for (const [t, entry] of this.bubbleSprites) {
      if (live.has(t)) continue;
      entry.sprite.material.map.dispose();
      entry.sprite.material.dispose();
      entry.sprite.removeFromParent();
      this.bubbleSprites.delete(t);
    }
  }

  // --- playing ---------------------------------------------------------------------------------

  // The green flag. With `watch`, the camera comes round to face the stage and the keys go to the
  // project until Esc or Stop playing (decision E).
  play({ watch = true } = {}) {
    this.audio.unlock();
    this.runtime.greenFlag();
    this.started = true;
    this.acc = 0;
    if (watch) this.enterPlayMode();
  }

  stop() {
    this.runtime.stopAll();
    this.started = false;
    this.leavePlayMode();
    if (ctx3d.cinema?.rigName === 'Stages') ctx3d.cinema.release();
  }

  enterPlayMode() {
    const cinema = ctx3d.cinema;
    if (!cinema || this.playing) return;
    const ok = cinema.take('Stages', this.playRig());
    if (!ok) return;
    this.playing = true;
    document.body.classList.add('stages-playing');
    this.onKeyDown = (e) => {
      if (e.key === 'Escape' || isEditable(e.target)) return;
      const name = keyName(e.key);
      if (!name) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.runtime.keyDown(name);
    };
    this.onKeyUp = (e) => this.runtime.keyUp(keyName(e.key));
    // Capture phase, ahead of the player's own arrow keys.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    const el = ctx3d.domElement;
    if (el) {
      this.onPointerMove = (e) => this.pointer(e);
      this.onPointerDown = (e) => {
        this.audio.unlock();
        const at = this.pointer(e);
        this.runtime.mouse.down = true;
        if (at) this.runtime.click(this.runtime.targetAt(at[0], at[1]));
      };
      this.onPointerUp = () => { this.runtime.mouse.down = false; };
      el.addEventListener('pointermove', this.onPointerMove);
      el.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointerup', this.onPointerUp);
    }
    this.updateAsk();
  }

  leavePlayMode() {
    if (!this.playing) return;
    this.playing = false;
    document.body.classList.remove('stages-playing');
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    const el = ctx3d.domElement;
    if (el) {
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerdown', this.onPointerDown);
      window.removeEventListener('pointerup', this.onPointerUp);
    }
    this.runtime.keys.clear();
    this.showOccluders();
    this.updateAsk();
  }

  // A camera that faces the set square on (or looks down across the board) from far enough back
  // that the whole stage fits. fov 70 is VERTICAL, so both the width and the height are solved.
  playRig() {
    const self = this;
    const half = THREE.MathUtils.degToRad(35);
    const target = new THREE.Vector3();
    const want = new THREE.Vector3();
    return {
      subjectId: this.record.id,
      chipLabel: '■ Stop playing',
      update(dt, ctx) {
        const aspect = ctx.camera.aspect || 16 / 9;
        const fitH = (self.H / 2) / Math.tan(half);
        const fitW = (self.W / 2) / (Math.tan(half) * aspect);
        const d = Math.max(fitH, fitW) * 1.24;
        self.root.updateMatrixWorld();
        if (self.layout === 'board') {
          target.set(0, self.boardTop, self.H * 0.06);
          want.set(0, self.boardTop + d * 0.86, d * 0.74);
        } else {
          // Aimed a little below the middle, so the stage sits above the Stop playing button.
          target.set(0, self.lift + self.H * 0.44, 0);
          want.set(0, self.lift + self.H * 0.5, d);
        }
        self.root.localToWorld(target);
        self.root.localToWorld(want);
        ctx.camera.position.copy(want);
        ctx.camera.lookAt(target);
        // Once the camera has arrived, anything standing between it and the stage is hidden until
        // play ends: a stage is no use to play on behind a signboard or a tree.
        if (ctx.camera.position.distanceTo(want) < 0.01 && !self.hidden) self.hideOccluders();
        return false;
      },
      end() { self.leavePlayMode(); },
    };
  }

  hideOccluders() {
    const { camera, registry } = ctx3d;
    this.hidden = [];
    if (!camera || !registry) return;
    camera.updateMatrixWorld();
    this.root.updateMatrixWorld();
    const others = registry.getRootObjects().filter((o) => o !== this.root && o.visible);
    const ray = new THREE.Raycaster();
    const seen = new Set();
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const p = new THREE.Vector3((i / 4 - 0.5) * STAGE_W * 0.96, (j / 4 - 0.5) * STAGE_H * 0.96, 1);
        this.plane.localToWorld(p);
        const dir = p.clone().sub(camera.position);
        const far = dir.length();
        ray.set(camera.position, dir.normalize());
        ray.far = far - 0.05;
        for (const hit of ray.intersectObjects(others, true)) {
          const id = registry.resolveRoot(hit.object);
          const root = id && registry.get(id)?.object3D;
          if (root && !seen.has(root)) { seen.add(root); root.visible = false; this.hidden.push(root); }
        }
      }
    }
  }

  showOccluders() {
    for (const o of this.hidden || []) o.visible = true;
    this.hidden = null;
  }

  // The pointer, cast onto the stage's surface, as a stage point.
  pointer(e) {
    const { camera, domElement } = ctx3d;
    if (!camera || !domElement) return null;
    const r = domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    this.plane.updateMatrixWorld();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.plane.matrixWorld);
    const origin = new THREE.Vector3().setFromMatrixPosition(this.plane.matrixWorld);
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());
    if (!hit) return null;
    const local = this.plane.worldToLocal(hit);
    const x = Math.max(-STAGE_W / 2, Math.min(STAGE_W / 2, local.x));
    const y = Math.max(-STAGE_H / 2, Math.min(STAGE_H / 2, local.y));
    this.runtime.mouse.x = x;
    this.runtime.mouse.y = y;
    return [x, y];
  }

  // The ask box, while the project is asking and the student is playing.
  updateAsk() {
    const ask = this.runtime?.asks?.[0];
    if (!ask || !this.playing) { this.askBox?.remove(); this.askBox = null; return; }
    if (!this.askBox) {
      const box = document.createElement('form');
      box.className = 'stages3d-ask';
      box.innerHTML = '<label><span></span><input type="text" autocomplete="off" aria-label="Your answer"></label><button type="submit">Answer</button>';
      box.addEventListener('submit', (e) => {
        e.preventDefault();
        this.runtime.answerQuestion(box.querySelector('input').value);
        box.querySelector('input').value = '';
        this.updateAsk();
      });
      box.querySelector('input').addEventListener('keydown', (e) => e.stopPropagation(), true);
      document.body.appendChild(box);
      this.askBox = box;
    }
    this.askBox.querySelector('span').textContent = ask.question;
    setTimeout(() => this.askBox?.querySelector('input').focus(), 0);
  }

  // --- going back to Stages ----------------------------------------------------------------

  async editInStages() {
    const text = await this.record.files[0].data.text();
    const token = await putHandoff({
      type: 'edit', recordId: this.record.id, projectText: text, title: this.project.title,
      layout: this.layout, size: this.record.size || 'life',
      edition: location.pathname.includes('/hifi') ? 'hifi' : 'app',
    });
    // Not `noopener` in the features: with it, window.open always returns null, so a blocked tab
    // could not be told from one that opened. Same origin, so cutting the opener here is enough.
    const opened = window.open(`../stages/?from-world=${token}`, '_blank');
    if (opened) opened.opener = null;
    else ctx3d.menu?.toast('Your browser blocked the new tab. Allow pop-ups for this site, then try again.', { tone: 'error' });
  }

  dispose() {
    this.leavePlayMode();
    if (ctx3d.cinema?.rigName === 'Stages' && ctx3d.cinema.rig?.subjectId === this.record.id) ctx3d.cinema.release({ restore: false });
    this.runtime.stopAll();
    this.audio.stopAll();
    this.askBox?.remove();
    for (const tex of this.textures.values()) tex.dispose();
    for (const [, entry] of this.bubbleSprites) { entry.sprite.material.map?.dispose(); entry.sprite.material.dispose(); }
    this.penTexture.dispose();
    this.overlayTexture.dispose();
  }
}

// Ghost is opacity and brightness darkens through the colour. Colour is a tint here, where the 2D
// stage's shader turns the hue; the 3D app has no shader that crosses to HiFi.
function applyEffects(material, e = {}) {
  const ghost = Math.max(0, Math.min(100, e.ghost || 0));
  material.opacity = 1 - ghost / 100;
  const bright = Math.max(-100, Math.min(0, e.brightness || 0));
  const k = 1 + bright / 100;
  if (e.color) material.color.setHSL((((e.color % 200) + 200) % 200) / 200, 0.7, 0.5 + 0.35 * k).multiplyScalar(1);
  else material.color.setRGB(k, k, k);
}

// A speech or thought bubble on its own canvas, for a board, where each one floats over its sprite.
function paintBubble(ctx, text, kind, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 34px system-ui, "Segoe UI", sans-serif';
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > w - 70 && line) { lines.push(line); line = word; } else line = next;
  }
  lines.push(line);
  const shown = lines.slice(0, 3);
  const bh = shown.length * 40 + 30;
  const bw = Math.min(w - 20, Math.max(120, Math.max(...shown.map((l) => ctx.measureText(l).width)) + 50));
  const x = (w - bw) / 2;
  const y = Math.max(4, h - bh - 46);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#9aa3b8';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, bh, 28);
  ctx.fill();
  ctx.stroke();
  if (kind === 'think') {
    for (const [dx, dy, r] of [[0, 18, 9], [-14, 34, 6]]) { ctx.beginPath(); ctx.arc(w / 2 + dx, y + bh + dy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else {
    ctx.beginPath();
    ctx.moveTo(w / 2 - 16, y + bh - 2);
    ctx.lineTo(w / 2, y + bh + 34);
    ctx.lineTo(w / 2 + 16, y + bh - 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(w / 2 - 14, y + bh - 6, 28, 6);
  }
  ctx.fillStyle = '#3b4256';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  shown.forEach((l, i) => ctx.fillText(l, w / 2, y + 16 + i * 40));
}

function isEditable(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export { STAGE_W, STAGE_H };
