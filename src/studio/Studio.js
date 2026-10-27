import * as THREE from 'three';
import { buildPresetWorldRecords } from '../WorldPresets.js';
import {
  FORMATS, PLATFORM_PACK, STUDIO_WORLDS, TEMPLATES, LENGTHS, DEFAULT_WORDS, END_WORDS,
  RECIPES, DEMOS, buildPlan, postCopy, worldDef,
} from './StudioScripts.js';
import { MUSIC_STYLES, AMBIENCES, SAMPLE_RATE, renderSoundtrack, SoundtrackPlayer } from './StudioAudio.js';
import { layoutFor, drawWatermark, blurInto, smooth } from './StudioOverlay.js';
import { Mp4Muxer } from './Mp4Muxer.js';
import './studio.css';

// THE SOCIAL MEDIA STUDIO.
//
// Opened with ?studio on the app's own address. It is the whole app -- the same scene, the
// same worlds, the same program runner -- with a director in charge of the camera and a
// compositor between the 3D frame and the screen. Pick a template, the worlds, the words
// and the music, press Preview to watch it, and Export to get an MP4 sized for Instagram,
// Facebook or LinkedIn.
//
// THREE DECISIONS CARRY THE FILE.
//
// 1. THE VIDEO IS RENDERED, NOT RECORDED. Export stops the animation loop and steps the app
//    itself one 1/60s frame at a time on a VIRTUAL clock (performance.now() is pinned to it
//    for the duration, which is what every program, glide, wait and speech bubble reads),
//    encodes every second frame with WebCodecs, and writes the MP4 with Mp4Muxer. So a
//    world that takes a second to build costs no frames, a slow machine makes a slower
//    export rather than a juddery one, and the result is the same every time.
//
// 2. EVERYTHING IN THE VIDEO IS ON ONE CANVAS. The renderer draws the world at the video's
//    own size into its (hidden) canvas; each frame is copied onto a 2D canvas and the
//    captions, cards and end card are drawn over it. That 2D canvas is what the stage
//    shows and what gets encoded, so the preview is the video. DOM overlays -- the app's
//    own menus, toasts, a browser panel's CSS3D layer -- can never be in a frame, which is
//    why the studio leaves browser panels out of every world it films.
//
// 3. NOTHING IS SAVED. Loading a world normally wipes IndexedDB and re-persists, which
//    would replace a student's own saved world with whatever the studio last filmed.
//    main.js turns WorldStore's persistence off before anything is loaded.

const STORE_KEY = 'edusim-studio';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Gluten:wght@800&family=Nunito:wght@700;800;900&family=JetBrains+Mono:ital,wght@0,500;0,600;1,500&display=swap';
const SIM_FPS = 60;
const OUT_FPS = 30;
const DISSOLVE = 0.45;

const DEFAULT_OPTS = {
  template: 'showcase',
  length: 30,
  format: 'reel',
  worlds: ['dinosaur', 'moon', 'wonderland', 'robots'],
  spotlightWorld: 'dinosaur',
  buildWorld: 'empty',
  recipe: 'rocket',
  demo: 'star',
  words: {},
  end: { ...END_WORDS },
  music: 'upbeat',
  ambience: 'auto',
  levels: { music: 0.75, ambience: 0.5, sfx: 0.8 },
  watermark: true,
  guides: true,
};

function loadOpts() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(DEFAULT_OPTS);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_OPTS),
      ...saved,
      end: { ...END_WORDS, ...saved.end },
      levels: { ...DEFAULT_OPTS.levels, ...saved.levels },
      words: saved.words || {},
    };
  } catch {
    return structuredClone(DEFAULT_OPTS);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c) node.append(c);
  return node;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

export class Studio {
  constructor(app) {
    this.app = app;
    this.opts = loadOpts();
    this.player = new SoundtrackPlayer();
    this.player.setVolume(0.9);
    this.upload = null; // { name, buffer }
    this.run = null;
    this.clock = 0;
    this.currentWorld = null;
    this.spawn = { x: 0, z: 16, yaw: 0 };
    this.offset = { x: 0.5, y: 0.5 };
    this.raycaster = new THREE.Raycaster();
    this.results = [];
    this.busy = false;

    this.out = document.createElement('canvas');
    this.out.className = 'studio-out';
    this.octx = this.out.getContext('2d', { alpha: false });
    this.snap = document.createElement('canvas');
    this.snapValid = false;

    this.S = this.makeContext();

    document.body.classList.add('studio-mode');
    this.fontsReady = this.loadFonts();
    this.buildUI();
    this.applyFormat(this.opts.format);
    this.takeCamera();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.run) {
        e.stopImmediatePropagation();
        this.cancel();
      }
    }, true);

    const first = this.firstWorld();
    this.setStatus('Building the first world…');
    this.loadWorld(first)
      .then(() => {
        this.idlePose();
        this.setStatus('Ready. Press Preview to watch it, or Export to make the video.');
      })
      .catch((err) => this.fail('Could not build the first world', err));

    // A handle for automation (tools/studio-render.mjs) and for the console.
    window.__studio = this;
  }

  // --- the app, borrowed ------------------------------------------------------------------

  makeContext() {
    const self = this;
    const { scene, camera, registry, programManager, markerTrail } = this.app;
    return {
      scene,
      camera,
      registry,
      programManager,
      markerTrail,
      shared: {},
      lastPose: null,
      groundAt: (x, z) => self.app.groundHeightAt(x, z),
      get spawn() { return self.spawn; },
      get L() { return self.L; },
      get fov() { return self.format.fov; },
      get aspect() { return self.format.w / self.format.h; },
      findHero: (key) => self.findHero(key),
      pathClear: (from, to, ignore) => self.pathClear(from, to, ignore),
      cameraClear: (pos, ignore) => self.cameraClear(pos, ignore),
      lensClear: (pos, look, ignore) => self.lensClear(pos, look, ignore),
      clutterBehind: (cam, focus, reach) => self.clutterBehind(cam, focus, reach),
      project: (v) => self.project(v),
    };
  }

  takeCamera() {
    const { cinema } = this.app;
    if (cinema.active && cinema.rigName === 'Studio') return;
    cinema.take('Studio', { update: () => false, chipLabel: 'Studio' });
    // No ease-in from wherever the player was: the studio owns the camera outright.
    cinema.blend = 1;
  }

  firstWorld() {
    const o = this.opts;
    if (o.template === 'build') return o.buildWorld;
    if (o.template === 'code') return DEMOS[o.demo]?.world || o.buildWorld;
    if (o.template === 'spotlight') return o.spotlightWorld;
    return o.worlds[0] || 'park';
  }

  // Builds a preset world exactly as the menu does, minus its browser panel. A panel is DOM
  // drawn over the canvas, so in a video it would be an empty dark rectangle -- the kiosk
  // under it goes too, since a stand with nothing on it is a stranger object than neither.
  async loadWorld(key) {
    const { records, spawn } = buildPresetWorldRecords(key, { groundHeightAt: this.app.groundHeightAt });
    const kept = records.filter((r) => r.kind !== 'web-browser' && !(r.kind === 'preset-prop' && r.prop === 'browser-kiosk'));
    this.app.cinema.release({ restore: false });
    await this.app.worldStore.loadFromRecords(kept);
    this.app.player.resetTo(spawn);
    this.takeCamera();
    this.spawn = { x: spawn?.x || 0, z: spawn?.z || 0, yaw: spawn?.yaw || 0 };
    this.currentWorld = key;
    this.boxes = null;
    this.app.programManager.broadcast('start');
    // Compile every new material now rather than on the first frame that shows it.
    try { this.app.renderer.compile(this.app.scene, this.app.camera); } catch { /* best effort */ }
  }

  idlePose() {
    const { x, z, yaw } = this.spawn;
    const { camera } = this.app;
    const eye = this.app.groundHeightAt(x, z) + 5;
    camera.position.set(x, eye, z);
    camera.lookAt(x - Math.sin(yaw) * 40, eye - 1.5, z - Math.cos(yaw) * 40);
    this.setOffset(null, 1);
  }

  findHero(key) {
    let best = null;
    for (const item of this.app.registry.items.values()) {
      if (item.record?.kind !== 'preset-prop' || item.record.prop !== key) continue;
      const box = new THREE.Box3().setFromObject(item.object3D);
      if (box.isEmpty()) continue;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const d = Math.hypot(center.x - this.spawn.x, center.z - this.spawn.z);
      if (!best || d < best.d) {
        best = { root: item.object3D, box, center, size, radius: Math.max(size.x, size.y, size.z) * 0.52, d };
      }
    }
    return best;
  }

  // Can the camera at `from` see `to`? Anything solid and opaque in between says no;
  // translucent water, light shafts and the like do not count.
  pathClear(from, to, ignoreRoot, { ground = true } = {}) {
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    this.raycaster.set(from, dir);
    this.raycaster.near = 0.4;
    this.raycaster.far = dist * 0.9;
    const roots = ground ? [this.app.ground] : [];
    for (const item of this.app.registry.items.values()) {
      const k = item.record?.kind;
      if (item.object3D === ignoreRoot || k === 'world-theme' || k === 'world-spawn') continue;
      roots.push(item.object3D);
    }
    const hits = this.raycaster.intersectObjects(roots, true);
    for (const h of hits) {
      const o = h.object;
      if (!o.isMesh || !o.visible) continue;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m?.transparent && (m.opacity ?? 1) < 0.75) continue;
      let n = o;
      let mine = false;
      while (n) { if (n === ignoreRoot) { mine = true; break; } n = n.parent; }
      if (mine) continue;
      return false;
    }
    return true;
  }

  // Is a camera at `pos` standing inside something? Measured against the box of each
  // object's SOLID geometry -- opaque meshes only, so a drift of sparkles or a sheet of
  // light shafts, whose boxes cover half a world, does not count -- and skipping what is
  // really ground cover: a street or a path is too wide to be standing in, and a chair or
  // a flower bed too low (no shot here puts the camera under four feet).
  cameraClear(pos, ignoreRoot) {
    if (!this.boxes) {
      this.boxes = [];
      const size = new THREE.Vector3();
      for (const item of this.app.registry.items.values()) {
        const k = item.record?.kind;
        if (k === 'world-theme' || k === 'world-spawn') continue;
        const box = new THREE.Box3();
        item.object3D.updateMatrixWorld(true);
        item.object3D.traverse((n) => {
          if (!n.isMesh || !n.visible) return;
          const m = Array.isArray(n.material) ? n.material[0] : n.material;
          if (m?.transparent && (m.opacity ?? 1) < 0.9) return;
          if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
          box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));
        });
        if (box.isEmpty()) continue;
        box.getSize(size);
        if (size.x > 60 || size.z > 60 || size.y < 4) continue;
        this.boxes.push({ box: box.expandByScalar(0.8), root: item.object3D });
      }
    }
    for (const { box, root } of this.boxes) {
      if (root !== ignoreRoot && box.containsPoint(pos)) return false;
    }
    return true;
  }

  // Is anything right up against the lens? A fan of short rays over the lower two thirds of
  // the view, where foreground lives. Foreground is often GOOD -- a teapot in the corner of
  // the Mad Hatter's shot is the tea party -- so only two things count against a camera:
  // anything within four feet, which fills a corner with a blur, and a sign or board out to
  // twelve, because a flat panel seen from behind is a black slab (the app's own notes have
  // that lesson three times over), and a black slab in the corner of a frame reads as a fault.
  lensClear(pos, look, ignoreRoot, maxHits = 1) {
    const fwd = look.clone().sub(pos).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const v = Math.tan(THREE.MathUtils.degToRad(this.format.fov) / 2) * 0.85;
    const hz = v * (this.format.w / this.format.h);
    const roots = [];
    for (const item of this.app.registry.items.values()) {
      const k = item.record?.kind;
      if (item.object3D === ignoreRoot || k === 'world-theme' || k === 'world-spawn') continue;
      roots.push(item.object3D);
    }
    let near = 0;
    for (const sx of [-1, 0, 1]) {
      for (const sy of [-1, -0.45, 0.2]) {
        if (sx === 0 && sy === 0.2) continue; // dead centre is the subject itself
        const dir = fwd.clone().addScaledVector(right, sx * hz).addScaledVector(up, sy * v).normalize();
        this.raycaster.set(pos, dir);
        this.raycaster.near = 0.1;
        this.raycaster.far = 12;
        const hit = this.raycaster.intersectObjects(roots, true).find((h) => h.object.isMesh && h.object.visible);
        if (!hit) continue;
        if (hit.distance < 4) { near++; continue; }
        let n = hit.object;
        while (n && !n.userData?.placedId) n = n.parent;
        const prop = n ? this.app.registry.get(n.userData.placedId)?.record?.prop || '' : '';
        if (/board|placard|sign|chart|kiosk|portal|billboard|plaque|poster/.test(prop)) near++;
      }
    }
    return near <= maxHits;
  }

  // How busy the background is behind `focus` as seen from `cam`: a fan of level rays across
  // the frame's width, counting the solid things they meet within `reach` feet, nearer ones
  // counting for more. One ray down the middle missed the board standing just off to the
  // side of the model, which is exactly the one a viewer notices.
  clutterBehind(cam, focus, reach = 80) {
    if (!this.boxes) this.cameraClear(focus, null);
    const base = focus.clone().sub(cam).setY(0).normalize();
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.format.fov) / 2) * (this.format.w / this.format.h));
    const hit = new THREE.Vector3();
    const seen = new Map();
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2 * half;
      const dir = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const ray = new THREE.Ray(cam.clone(), dir);
      for (const { box, root } of this.boxes) {
        if (!ray.intersectBox(box, hit)) continue;
        const d = hit.distanceTo(cam);
        if (d < reach) seen.set(root, Math.max(seen.get(root) || 0, 1 + (reach - d) / reach));
      }
    }
    let n = 0;
    for (const v of seen.values()) n += v;
    return n;
  }

  project(v) {
    const p = v.clone().project(this.app.camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: ((p.x + 1) / 2) * this.format.w, y: ((1 - p.y) / 2) * this.format.h };
  }

  // --- format and stage ---------------------------------------------------------------------

  applyFormat(id) {
    this.format = FORMATS[id] || FORMATS.reel;
    const { w, h, fov } = this.format;
    const { renderer, camera } = this.app;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = fov;
    camera.updateProjectionMatrix();
    this.out.width = w;
    this.out.height = h;
    this.snap.width = w;
    this.snap.height = h;
    this.snapValid = false;
    this.L = layoutFor(this.format, w, h);
    this.fitStage();
  }

  onResize() {
    this.fitStage();
  }

  fitStage() {
    if (!this.stageEl) return;
    const box = this.stageEl.getBoundingClientRect();
    const { w, h } = this.format;
    const k = Math.min((box.width - 24) / w, (box.height - 24) / h);
    const cw = Math.max(50, w * k);
    const ch = Math.max(50, h * k);
    Object.assign(this.frameEl.style, { width: `${cw}px`, height: `${ch}px` });
    const s = this.L.safe;
    Object.assign(this.safeEl.style, {
      left: `${(s.x0 / w) * 100}%`,
      top: `${(s.y0 / h) * 100}%`,
      width: `${((s.x1 - s.x0) / w) * 100}%`,
      height: `${((s.y1 - s.y0) / h) * 100}%`,
    });
    this.safeEl.hidden = !this.opts.guides;
  }

  setOffset(target, k) {
    const want = target || { x: 0.5, y: 0.5 };
    this.offset.x += (want.x - this.offset.x) * k;
    this.offset.y += (want.y - this.offset.y) * k;
    const { camera } = this.app;
    const { w, h } = this.format;
    if (Math.abs(this.offset.x - 0.5) < 0.002 && Math.abs(this.offset.y - 0.5) < 0.002) {
      if (camera.view?.enabled) camera.clearViewOffset();
      return;
    }
    // The subject is looked AT, so it sits at the middle of the full image; shifting the
    // window by (0.5 - x) puts it at x on screen. This is how a card can take the bottom of
    // a Reel without the thing it is programming sliding underneath it.
    camera.setViewOffset(w, h, (0.5 - this.offset.x) * w, (0.5 - this.offset.y) * h, w, h);
  }

  // --- the frame hooks main.js calls ------------------------------------------------------

  // Before cinema.tick, after programs have moved things this frame.
  tick(dt) {
    if (!this.app.cinema.active) this.takeCamera();
    const run = this.run;
    if (!run) return;
    if (run.mode === 'preview' && !run.holding) {
      const pos = this.player.position();
      this.clock = pos != null ? pos : this.clock + dt;
    }
    if (run.holding) return;
    this.advance(dt);
  }

  // Immediately before the renderer draws. The play and hammer badges are UI floating in
  // the world, and the world is what is being filmed.
  beforeRender() {
    for (const s of this.app.playIconManager?.icons?.values?.() || []) s.visible = false;
    for (const s of this.app.constructionManager?.icons?.values?.() || []) s.visible = false;
  }

  // Immediately after the renderer draws, in the same task -- the drawing buffer is gone by
  // the next one (see PhotoMode).
  afterRender() {
    const ctx = this.octx;
    const { w, h } = this.format;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.app.renderer.domElement, 0, 0, w, h);
    const run = this.run;
    if (!run || !run.beat) {
      if (this.opts.watermark) drawWatermark(ctx, this.L, 1);
      this.updateTransport();
      return;
    }
    const beat = run.beat;
    const lt = Math.max(0, this.clock - beat.start);
    if (beat.endCard) blurInto(this.out, this.out, 1 / 12);
    if (run.holding && this.snapValid) {
      ctx.drawImage(this.snap, 0, 0, w, h);
    } else if (beat.transition === 'dissolve' && this.snapValid && lt < DISSOLVE) {
      ctx.globalAlpha = 1 - smooth(lt / DISSOLVE);
      ctx.drawImage(this.snap, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    if (!run.holding) {
      try {
        beat.draw?.(ctx, this.L, this.S, lt);
      } catch (err) {
        console.error('Studio overlay failed:', err);
      }
      if (this.opts.watermark && !beat.endCard) drawWatermark(ctx, this.L, 1);
    }
    this.updateTransport();
  }

  // --- the director ------------------------------------------------------------------------

  beatIndexAt(t) {
    const beats = this.run.plan.beats;
    for (let i = beats.length - 1; i >= 0; i--) if (t >= beats[i].start) return i;
    return 0;
  }

  advance(dt) {
    const run = this.run;
    const t = this.clock;
    if (t >= run.plan.total) {
      if (run.mode === 'preview') this.finishPreview();
      return;
    }
    const i = this.beatIndexAt(t);
    if (i !== run.index) {
      // Preview switches asynchronously and holds the picture meanwhile. Export never gets
      // here: its loop enters each beat before stepping the frame that needs it.
      if (run.mode === 'preview' && !run.entering) this.switchBeatLive(i);
      return;
    }
    const beat = run.beat;
    const lt = t - beat.start;
    try {
      beat.update?.(this.S, lt, dt);
      const pose = beat.pose?.(this.S, lt, dt);
      if (pose) {
        const { camera } = this.app;
        camera.position.copy(pose.pos);
        camera.lookAt(pose.look);
      }
      const k = 1 - Math.exp(-dt * 5);
      this.setOffset(beat.subject?.(this.S, this.L, lt) || null, k);
    } catch (err) {
      console.error(`Studio beat "${beat.label}" failed:`, err);
    }
  }

  async enterBeat(i) {
    const run = this.run;
    const prev = run.beat;
    const beat = run.plan.beats[i];
    run.entering = true;
    // The frame that is on screen now is the one the next shot dissolves from.
    const sctx = this.snap.getContext('2d');
    sctx.drawImage(this.out, 0, 0);
    this.snapValid = true;
    if (prev) {
      try { prev.teardown?.(this.S); } catch (err) { console.error(err); }
      this.S.lastPose = (tt, dd) => prev.pose?.(this.S, prev.dur + tt, dd);
    }
    if (beat.world !== this.currentWorld) {
      await this.loadWorld(beat.world);
      this.S.lastPose = null;
    }
    await beat.setup?.(this.S);
    run.index = i;
    run.beat = beat;
    run.entering = false;
  }

  async switchBeatLive(i) {
    const run = this.run;
    const beat = run.plan.beats[i];
    const needsLoad = beat.world !== this.currentWorld;
    run.holding = true;
    if (needsLoad) {
      this.player.stop();
      this.setStatus(`Building ${worldDef(beat.world).label}…`);
    }
    try {
      await this.enterBeat(i);
      if (needsLoad) {
        await nextFrame();
        await nextFrame();
      }
    } catch (err) {
      this.fail(`Could not set up "${beat.label}"`, err);
      return;
    }
    if (this.run !== run) return;
    this.clock = beat.start;
    if (needsLoad) {
      this.player.play(run.audio, beat.start);
      this.setStatus('Previewing…');
    }
    run.holding = false;
  }

  startRun(mode, plan, audio) {
    this.S = this.makeContext();
    this.run = { mode, plan, audio, index: -1, beat: null, holding: true, entering: false };
    this.clock = 0;
    this.snapValid = false;
    // A fresh copy of the first world every time, so nothing from a previous take -- a
    // model, a mark, a robot left mid-star -- leaks into this one.
    this.currentWorld = null;
    this.renderTimeline(plan);
  }

  endRun() {
    const run = this.run;
    if (!run) return;
    try { run.beat?.teardown?.(this.S); } catch { /* finishing anyway */ }
    this.run = null;
    this.player.stop();
    this.setOffset(null, 1);
    this.setRunning(false);
  }

  finishPreview() {
    this.endRun();
    this.setStatus('Preview finished. Export when it looks right.');
  }

  cancel() {
    if (!this.run) return;
    this.cancelled = true;
    if (this.run.mode === 'preview') {
      this.endRun();
      this.setStatus('Stopped.');
    }
  }

  // --- planning and sound ------------------------------------------------------------------

  wordsFor(template = this.opts.template) {
    return { ...DEFAULT_WORDS[template], ...(this.opts.words[template] || {}) };
  }

  makePlan() {
    const o = this.opts;
    return buildPlan({
      template: o.template,
      length: o.length,
      worlds: o.worlds,
      spotlightWorld: o.spotlightWorld,
      buildWorld: o.buildWorld,
      recipe: o.recipe,
      demo: o.demo,
      words: { ...this.wordsFor(), ...o.end },
      music: o.music === 'upload' && !this.upload ? 'none' : o.music,
      ambience: o.ambience,
    });
  }

  async mixSoundtrack(plan) {
    const o = this.opts;
    return renderSoundtrack({
      duration: plan.total,
      endAt: plan.endAt,
      music: o.music === 'upload' ? (this.upload ? 'upload' : 'none') : o.music,
      upload: this.upload?.buffer || null,
      ambience: plan.ambience,
      cues: plan.cues,
      levels: o.levels,
      seed: 7,
    });
  }

  loadFonts() {
    if (!document.querySelector('link[data-studio-fonts]')) {
      document.head.append(el('link', { rel: 'stylesheet', href: FONTS_URL, 'data-studio-fonts': true }));
    }
    const faces = ['700 64px Fredoka', '600 64px Fredoka', '800 64px Gluten', '800 40px Nunito', '900 40px Nunito', '700 40px Nunito', '600 30px "JetBrains Mono"', 'italic 500 30px "JetBrains Mono"'];
    // Never wait on the network forever: offline, the system fonts are a fine fallback.
    return Promise.race([
      Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))),
      sleep(5000),
    ]);
  }

  // --- preview -----------------------------------------------------------------------------

  async preview() {
    if (this.busy) return;
    if (this.run) { this.cancel(); return; }
    // Created inside the click, before any await: a browser only lets audio start from a
    // user gesture.
    this.player.ensureContext();
    this.busy = true;
    this.cancelled = false;
    this.setRunning(true, 'preview');
    try {
      await this.fontsReady;
      this.setStatus('Mixing the soundtrack…');
      const plan = this.makePlan();
      const audio = await this.mixSoundtrack(plan);
      this.startRun('preview', plan, audio);
      this.setStatus(`Building ${worldDef(plan.beats[0].world).label}…`);
      await this.enterBeat(0);
      await nextFrame();
      await nextFrame();
      if (this.cancelled || !this.run) return;
      this.clock = 0;
      this.player.play(audio, 0);
      this.run.holding = false;
      this.setStatus('Previewing… press Esc or Stop to end early.');
    } catch (err) {
      this.fail('Preview failed', err);
    } finally {
      this.busy = false;
    }
  }

  // --- export ------------------------------------------------------------------------------

  async exportFormats(formatIds) {
    if (this.busy || this.run) return [];
    if (typeof VideoEncoder === 'undefined') {
      this.setStatus('This browser cannot encode video here. Use Chrome on localhost or https.', true);
      return [];
    }
    this.busy = true;
    this.cancelled = false;
    this.setRunning(true, 'export');
    const produced = [];
    const before = this.opts.format;
    try {
      await this.fontsReady;
      this.setStatus('Mixing the soundtrack…');
      const audio = await this.mixSoundtrack(this.makePlan());
      for (const [n, id] of formatIds.entries()) {
        if (this.cancelled) break;
        const label = `${FORMATS[id].ratio} ${FORMATS[id].label}`;
        const result = await this.exportOne(id, audio, (p) => {
          this.setProgress((n + p) / formatIds.length, `Rendering ${label} (${n + 1} of ${formatIds.length}) — ${Math.round(p * 100)}%`);
        });
        if (result) {
          produced.push(result);
          this.results.unshift(result);
        }
      }
      if (this.cancelled) this.setStatus('Export cancelled.');
      else this.setStatus(`Done — ${produced.length} video${produced.length === 1 ? '' : 's'} ready.`);
    } catch (err) {
      this.fail('Export failed', err);
    } finally {
      this.busy = false;
      this.setProgress(null);
      this.setRunning(false);
      this.applyFormat(before);
      this.markFormat();
    }
    if (produced.length) this.showResults(produced);
    return produced;
  }

  async exportOne(formatId, audio, onProgress) {
    this.applyFormat(formatId);
    this.markFormat(formatId);
    const plan = this.makePlan();
    const { w, h, bitrate } = this.format;

    const mux = new Mp4Muxer({ video: { width: w, height: h }, audio: { sampleRate: SAMPLE_RATE, channels: 2, bitrate: 160000 } });
    let encodeError = null;
    const venc = new VideoEncoder({
      output: (chunk, meta) => mux.addVideoChunk(chunk, meta),
      error: (e) => { encodeError = e; },
    });
    venc.configure({
      codec: 'avc1.640028', // High profile, level 4.0: enough for 1080x1920 or 1920x1080 at 30fps
      width: w,
      height: h,
      bitrate,
      bitrateMode: 'variable',
      framerate: OUT_FPS,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    });

    // Take the app off the display's clock and onto ours.
    this.app.setAnimationLoop(null);
    const realNow = performance.now.bind(performance);
    let vnow = realNow();
    performance.now = () => vnow;
    const started = realNow();
    try {
      this.startRun('export', plan, audio);
      const frames = Math.ceil(plan.total * SIM_FPS);
      for (let f = 0; f < frames; f++) {
        if (this.cancelled) return null;
        const t = f / SIM_FPS;
        const i = this.beatIndexAt(t);
        if (i !== this.run.index) {
          await this.enterBeat(i);
          this.run.holding = false;
        }
        this.clock = t;
        vnow += 1000 / SIM_FPS;
        const encode = f % (SIM_FPS / OUT_FPS) === 0;
        this.app.frame(1 / SIM_FPS, { render: encode });
        if (encode) {
          const n = f / (SIM_FPS / OUT_FPS);
          const frame = new VideoFrame(this.out, { timestamp: Math.round((n * 1e6) / OUT_FPS), duration: Math.round(1e6 / OUT_FPS) });
          venc.encode(frame, { keyFrame: n % (OUT_FPS * 2) === 0 });
          frame.close();
          while (venc.encodeQueueSize > 4) await sleep(1);
        }
        if (encodeError) throw encodeError;
        if (f % 15 === 0) {
          onProgress(f / frames);
          await sleep(0);
        }
      }
      await venc.flush();
      if (encodeError) throw encodeError;
      await this.encodeAudio(audio, plan.total, mux);
      const { blob, duration } = mux.finalize();
      onProgress(1);
      const o = this.opts;
      const day = new Date().toISOString().slice(0, 10);
      return {
        blob,
        url: URL.createObjectURL(blob),
        name: `edusim-${o.template}-${this.format.ratio.replace(':', 'x')}-${day}.mp4`,
        format: this.format,
        duration,
        size: blob.size,
        seconds: (realNow() - started) / 1000,
        copy: postCopy({ ...o }, plan),
      };
    } finally {
      delete performance.now;
      if (performance.now === undefined) performance.now = realNow;
      this.endRun();
      try { venc.close(); } catch { /* already closed */ }
      this.app.setAnimationLoop(this.app.animate);
    }
  }

  async encodeAudio(buffer, seconds, mux) {
    if (typeof AudioEncoder === 'undefined') return;
    const support = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 }).catch(() => null);
    if (!support?.supported) {
      console.warn('AAC encoding is not available here; the video will be silent.');
      return;
    }
    let error = null;
    const enc = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: (e) => { error = e; } });
    enc.configure({ codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000, aac: { format: 'aac' } });
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const total = Math.min(buffer.length, Math.round(seconds * SAMPLE_RATE));
    const step = 4800;
    for (let at = 0; at < total; at += step) {
      const n = Math.min(step, total - at);
      const data = new Float32Array(n * 2);
      data.set(left.subarray(at, at + n), 0);
      data.set(right.subarray(at, at + n), n);
      enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / SAMPLE_RATE), data }));
      if (enc.encodeQueueSize > 20) await sleep(1);
    }
    await enc.flush();
    enc.close();
    if (error) throw error;
  }

  // --- UI ----------------------------------------------------------------------------------

  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.opts)); } catch { /* per-machine convenience only */ }
  }

  set(path, value) {
    let o = this.opts;
    const keys = path.split('.');
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    o[keys[keys.length - 1]] = value;
    this.save();
  }

  buildUI() {
    this.root = el('div', { class: 'studio' });
    const back = el('a', { class: 'studio-back', href: window.location.pathname, text: '← Back to Edusim' });
    const header = el('header', { class: 'studio-head' },
      el('div', { class: 'studio-brand' }, el('span', { class: 'studio-mark', text: 'Edusim' }), el('span', { text: 'Social Media Studio' })),
      back,
    );

    this.panel = el('div', { class: 'studio-panel' });
    this.stageEl = el('div', { class: 'studio-stage' });
    this.frameEl = el('div', { class: 'studio-frame' });
    this.safeEl = el('div', { class: 'studio-safe', title: 'Safe zone: the platform’s own buttons and captions do not cover this area' });
    this.frameEl.append(this.out, this.safeEl);
    this.stageEl.append(this.frameEl);

    this.timeline = el('div', { class: 'studio-timeline' });
    this.playhead = el('div', { class: 'studio-playhead' });
    this.timeText = el('div', { class: 'studio-time', text: '0:00' });
    this.progress = el('div', { class: 'studio-progress', hidden: true }, el('div'));
    this.status = el('div', { class: 'studio-status', role: 'status' });

    this.previewBtn = el('button', { class: 'studio-btn', type: 'button', onclick: () => this.preview() }, '▶ Preview');
    this.exportBtn = el('button', { class: 'studio-btn studio-btn-primary', type: 'button', onclick: () => this.exportFormats([this.opts.format]) }, '⬇ Export MP4');
    this.packBtn = el('button', { class: 'studio-btn studio-btn-pack', type: 'button', onclick: () => this.exportFormats(PLATFORM_PACK) }, '⬇ All platforms (3)');
    this.stopBtn = el('button', { class: 'studio-btn studio-btn-stop', type: 'button', hidden: true, onclick: () => this.cancel() }, '■ Stop');
    this.resultsBtn = el('button', { class: 'studio-btn studio-btn-ghost', type: 'button', hidden: true, onclick: () => this.showResults(this.results) }, 'Videos');

    const transport = el('div', { class: 'studio-transport' },
      el('div', { class: 'studio-buttons' }, this.previewBtn, this.stopBtn, this.exportBtn, this.packBtn, this.resultsBtn),
      el('div', { class: 'studio-track' }, this.timeline, this.playhead),
      el('div', { class: 'studio-meta' }, this.timeText, this.status),
      this.progress,
    );

    const main = el('main', { class: 'studio-main' }, this.stageEl, transport);
    this.root.append(header, el('div', { class: 'studio-body' }, this.panel, main));
    document.body.append(this.root);
    this.renderPanel();
    this.renderTimeline(this.safePlan());
    new ResizeObserver(() => this.fitStage()).observe(this.stageEl);
  }

  safePlan() {
    try { return this.makePlan(); } catch { return null; }
  }

  section(title, ...children) {
    return el('section', { class: 'studio-sec' }, el('h3', { text: title }), ...children);
  }

  segmented(options, current, onPick, cls = '') {
    return el('div', { class: `studio-seg ${cls}` }, options.map((o) => el('button', {
      type: 'button',
      class: o.value === current ? 'is-on' : '',
      title: o.hint || '',
      onclick: () => onPick(o.value),
    }, o.icon || null, el('span', { text: o.label }))));
  }

  field(label, input, hint = '') {
    return el('label', { class: 'studio-field' }, el('span', { class: 'studio-label', text: label }), input, hint ? el('small', { text: hint }) : null);
  }

  textInput(value, onInput, { placeholder = '', max = 80 } = {}) {
    return el('input', { type: 'text', value, placeholder, maxlength: max, oninput: (e) => onInput(e.target.value) });
  }

  select(options, current, onPick) {
    const s = el('select', { onchange: (e) => onPick(e.target.value) }, options.map((o) => el('option', { value: o.value, text: o.label })));
    s.value = current;
    return s;
  }

  slider(value, onInput) {
    return el('input', { type: 'range', min: 0, max: 1, step: 0.05, value, oninput: (e) => onInput(Number(e.target.value)) });
  }

  changed({ panel = false, format = false } = {}) {
    this.save();
    if (format) {
      this.applyFormat(this.opts.format);
      if (!this.run) this.idlePose();
    }
    if (panel) this.renderPanel();
    this.renderTimeline(this.safePlan());
  }

  renderPanel() {
    const o = this.opts;
    const words = this.wordsFor();
    const p = this.panel;
    p.innerHTML = '';

    p.append(this.section('Video',
      el('div', { class: 'studio-cards' }, TEMPLATES.map((t) => el('button', {
        type: 'button',
        class: `studio-card ${t.id === o.template ? 'is-on' : ''}`,
        onclick: () => { o.template = t.id; this.changed({ panel: true }); },
      }, el('strong', { text: t.label }), el('small', { text: t.hint })))),
      this.field('Length', this.segmented(LENGTHS.map((s) => ({ value: s, label: `${s}s` })), o.length, (v) => { o.length = v; this.changed({ panel: true }); })),
      this.field('Shape', this.segmented(Object.values(FORMATS).map((f) => ({
        value: f.id,
        label: f.ratio,
        hint: `${f.label} — ${f.platforms}`,
        icon: el('i', { class: 'studio-ratio', style: `aspect-ratio:${f.w}/${f.h}` }),
      })), o.format, (v) => { o.format = v; this.changed({ panel: true, format: true }); }, 'studio-seg-shapes'), FORMATS[o.format].platforms),
    ));

    if (o.template === 'showcase' || o.template === 'tour') {
      const list = el('div', { class: 'studio-worlds' }, STUDIO_WORLDS.map((w) => {
        const idx = o.worlds.indexOf(w.key);
        return el('button', {
          type: 'button',
          class: `studio-world ${idx >= 0 ? 'is-on' : ''}`,
          title: w.fact,
          onclick: () => {
            const at = o.worlds.indexOf(w.key);
            if (at >= 0) { if (o.worlds.length > 1) o.worlds.splice(at, 1); } else o.worlds.push(w.key);
            this.changed({ panel: true });
          },
        }, el('b', { text: idx >= 0 ? String(idx + 1) : '+' }), el('span', { text: w.label }));
      }));
      p.append(this.section('Worlds', el('p', { class: 'studio-note', text: 'In the order you pick them. The first one opens the video.' }), list));
    }
    if (o.template === 'spotlight') {
      p.append(this.section('World', this.select(STUDIO_WORLDS.map((w) => ({ value: w.key, label: w.label })), o.spotlightWorld, (v) => { o.spotlightWorld = v; this.changed(); })));
    }
    if (o.template === 'showcase' || o.template === 'build') {
      p.append(this.section('Build',
        this.field('Model', this.segmented(Object.entries(RECIPES).map(([k, r]) => ({ value: k, label: r.label })), o.recipe, (v) => { o.recipe = v; this.changed({ panel: true }); })),
        this.field('Built in', this.select([
          { value: 'empty', label: 'My World (open field)' },
          { value: 'park', label: 'The Park' },
          { value: 'robots', label: 'Robot Challenge World' },
          { value: 'chalk', label: 'The Land of Chalk Drawings' },
        ], o.buildWorld, (v) => { o.buildWorld = v; this.changed(); })),
      ));
    }
    if (o.template === 'code') {
      p.append(this.section('Program',
        this.field('Demo', this.select(Object.entries(DEMOS).map(([k, d]) => ({ value: k, label: d.label })), o.demo, (v) => { o.demo = v; this.changed(); }),
          'The same program is shown in blocks, then turned over into JavaScript.'),
      ));
    }

    const wordInputs = [
      this.field('Headline', this.textInput(words.hook, (v) => { this.set(`words.${o.template}.hook`, v); this.changed(); }), 'Put *stars* round words to make them amber.'),
      this.field('Under the headline', this.textInput(words.sub, (v) => { this.set(`words.${o.template}.sub`, v); this.changed(); })),
    ];
    if (o.template === 'showcase' || o.template === 'tour') {
      wordInputs.push(this.field('Banner over the worlds', this.textInput(words.band, (v) => { this.set(`words.${o.template}.band`, v); this.changed(); })));
    }
    wordInputs.push(
      this.field('End card line', this.textInput(o.end.tagline, (v) => { o.end.tagline = v; this.changed(); })),
      this.field('Web address', this.textInput(o.end.url, (v) => { o.end.url = v; this.changed(); })),
      this.field('Call to action', this.textInput(o.end.cta, (v) => { o.end.cta = v; this.changed(); }), 'Instagram does not make links clickable in captions — “link in bio” works there.'),
      this.field('Small print', this.textInput(o.end.small, (v) => { o.end.small = v; this.changed(); })),
      el('button', { type: 'button', class: 'studio-link', onclick: () => { delete o.words[o.template]; o.end = { ...END_WORDS }; this.changed({ panel: true }); } }, 'Reset words to the defaults'),
    );
    p.append(this.section('Words', ...wordInputs));

    const musicOpts = [...MUSIC_STYLES.map((m) => ({ value: m.id, label: m.label })), { value: 'upload', label: this.upload ? `My track: ${this.upload.name}` : 'My own track…' }];
    const fileInput = el('input', {
      type: 'file',
      accept: 'audio/*',
      hidden: true,
      onchange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const buffer = await this.player.decode(await file.arrayBuffer());
          this.upload = { name: file.name.replace(/\.[^.]+$/, '').slice(0, 28), buffer };
          o.music = 'upload';
          this.changed({ panel: true });
          this.setStatus(`Using "${file.name}" as the music. Make sure you have the rights to post it.`);
        } catch (err) {
          this.fail('That audio file could not be read', err);
        }
      },
    });
    p.append(this.section('Sound',
      this.field('Music', this.select(musicOpts, o.music, (v) => {
        if (v === 'upload' && !this.upload) { fileInput.click(); return; }
        o.music = v;
        this.changed({ panel: true });
      }), MUSIC_STYLES.find((m) => m.id === o.music)?.hint || (o.music === 'upload' ? 'Your file, faded in and out to fit.' : '')),
      fileInput,
      this.field('Music volume', this.slider(o.levels.music, (v) => { o.levels.music = v; this.save(); })),
      this.field('Ambience', this.select(AMBIENCES.map((a) => ({ value: a.id, label: a.label })), o.ambience, (v) => { o.ambience = v; this.changed(); })),
      this.field('Ambience volume', this.slider(o.levels.ambience, (v) => { o.levels.ambience = v; this.save(); })),
      this.field('Sound effects', this.slider(o.levels.sfx, (v) => { o.levels.sfx = v; this.save(); })),
      el('p', { class: 'studio-note', text: 'All music and sound here is generated in the browser, so it is yours to post.' }),
    ));

    p.append(this.section('Look',
      el('label', { class: 'studio-check' }, el('input', { type: 'checkbox', checked: o.watermark, onchange: (e) => { o.watermark = e.target.checked; this.save(); } }), el('span', { text: 'Edusim logo in the corner' })),
      el('label', { class: 'studio-check' }, el('input', { type: 'checkbox', checked: o.guides, onchange: (e) => { o.guides = e.target.checked; this.save(); this.fitStage(); } }), el('span', { text: 'Show the safe zone (never in the video)' })),
    ));
  }

  markFormat(id = this.opts.format) {
    for (const b of this.panel.querySelectorAll('.studio-seg-shapes button')) {
      b.classList.toggle('is-on', b.title.startsWith(FORMATS[id].label));
    }
  }

  renderTimeline(plan) {
    this.timeline.innerHTML = '';
    this.timelinePlan = plan;
    if (!plan) return;
    for (const b of plan.beats) {
      this.timeline.append(el('div', {
        class: `studio-beat studio-beat-${b.kind}`,
        style: `flex:${b.dur}`,
        title: `${b.label} — ${b.dur.toFixed(1)}s`,
      }, el('span', { text: b.label })));
    }
    this.timeText.textContent = `0:00 / ${fmtTime(plan.total)}`;
  }

  updateTransport() {
    const plan = this.run?.plan || this.timelinePlan;
    if (!plan) return;
    const t = this.run ? this.clock : 0;
    this.playhead.style.left = `${Math.min(100, (t / plan.total) * 100)}%`;
    this.playhead.hidden = !this.run;
    this.timeText.textContent = `${fmtTime(t)} / ${fmtTime(plan.total)}`;
  }

  setRunning(on, mode) {
    this.root.classList.toggle('is-running', on);
    this.previewBtn.hidden = on && mode === 'preview';
    this.stopBtn.hidden = !on;
    this.previewBtn.disabled = on;
    this.exportBtn.disabled = on;
    this.packBtn.disabled = on;
    this.panel.classList.toggle('is-locked', on);
  }

  setStatus(text, error = false) {
    this.status.textContent = text;
    this.status.classList.toggle('is-error', error);
  }

  setProgress(k, text) {
    if (k == null) { this.progress.hidden = true; return; }
    this.progress.hidden = false;
    this.progress.firstChild.style.width = `${Math.round(k * 100)}%`;
    if (text) this.setStatus(text);
  }

  fail(what, err) {
    console.error(what, err);
    this.setStatus(`${what}: ${err?.message || err}`, true);
    if (this.run) this.endRun();
    this.setRunning(false);
    this.busy = false;
  }

  showResults(list) {
    if (!list?.length) return;
    this.resultsBtn.hidden = false;
    this.resultsBtn.textContent = `Videos (${this.results.length})`;
    const close = () => sheet.remove();
    const copyFor = list[0].copy;
    let tab = 'instagram';
    const copyBox = el('textarea', { class: 'studio-copy', readonly: true, rows: 9 });
    const tabs = el('div', { class: 'studio-seg' });
    const renderTabs = () => {
      tabs.innerHTML = '';
      for (const [id, label] of [['instagram', 'Instagram'], ['facebook', 'Facebook'], ['linkedin', 'LinkedIn']]) {
        tabs.append(el('button', { type: 'button', class: id === tab ? 'is-on' : '', onclick: () => { tab = id; renderTabs(); } }, label));
      }
      copyBox.value = copyFor[tab];
    };
    renderTabs();
    const copyBtn = el('button', {
      type: 'button',
      class: 'studio-btn',
      onclick: async () => {
        try { await navigator.clipboard.writeText(copyBox.value); copyBtn.textContent = 'Copied ✓'; } catch { copyBox.select(); }
        setTimeout(() => { copyBtn.textContent = 'Copy caption'; }, 1600);
      },
    }, 'Copy caption');

    const videos = el('div', { class: 'studio-results' }, list.map((r) => el('figure', { class: 'studio-result' },
      el('video', { src: r.url, controls: true, playsinline: true, preload: 'metadata', style: `aspect-ratio:${r.format.w}/${r.format.h}` }),
      el('figcaption', {},
        el('strong', { text: `${r.format.ratio} ${r.format.label}` }),
        el('small', { text: `${r.format.platforms}` }),
        el('small', { text: `${r.format.w}×${r.format.h} · ${r.duration.toFixed(1)}s · ${(r.size / 1048576).toFixed(1)} MB · rendered in ${Math.round(r.seconds)}s` }),
        el('a', { class: 'studio-btn studio-btn-primary', href: r.url, download: r.name }, '⬇ Download'),
      ),
    )));

    const sheet = el('div', { class: 'studio-sheet', onclick: (e) => { if (e.target === sheet) close(); } },
      el('div', { class: 'studio-sheet-body' },
        el('div', { class: 'studio-sheet-head' }, el('h2', { text: 'Your videos' }), el('button', { type: 'button', class: 'studio-btn studio-btn-ghost', onclick: close }, 'Close')),
        videos,
        el('h3', { text: 'Caption to post with it' }),
        tabs,
        copyBox,
        el('div', { class: 'studio-buttons' }, copyBtn),
        el('p', { class: 'studio-note', text: 'MP4, H.264 video with AAC sound — what Instagram, Facebook and LinkedIn all accept. On a phone, AirDrop or email it to yourself and post from the app.' }),
      ),
    );
    document.body.append(sheet);
  }
}
