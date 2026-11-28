// Edusim Stages' composition root: the layout, the project, the runtime and every pane, wired
// together. main.js only constructs this.
//
// The layout is Scratch's (plan, section 4): blocks and scripts on the left, the stage top right,
// the sprite list under it. Everything a student does goes through `changed()`, which autosaves.
import { BLOCKS, blockDef, labelParts } from '../blocks/defs.js';
import { createBlock, newId, walkBlocks } from '../blocks/make.js';
import { BlockEditor, menuLabel } from '../editor/BlockEditor.js';
import { FRAME_RATE, Runtime, keyName } from '../runtime/Runtime.js';
import { STAGE_H, STAGE_W } from '../runtime/geometry.js';
import { StageRenderer } from '../render/StageRenderer.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import {
  emptyProject, fromFileText, makeSprite, messagesIn, normalise, pruneAssets, safeFileName, spritesOf, stageOf,
  toFileText, uniqueName, FILE_SUFFIX,
} from '../project/Project.js';
import { costumeFromBlob, maskFor, preloadProject, soundFromBlob } from '../project/assets.js';
import { AutoSaver, loadSaved } from '../project/Store.js';
import { CHANNEL, putHandoff, takeHandoff, takeTokenParam } from '../project/handoff.js';
import { BACKDROPS } from '../library/backdrops.js';
import { CARTOON_SPRITES } from '../library/cartoons.js';
import {
  backdropFromLibrary, soundFromLibrary, spriteFromCartoon, spriteFromModel,
} from '../library/libraryAdd.js';
import { chooseBackdrop, chooseSound, chooseSprite } from './Library.js';
import { CostumeEditor, drawThumb } from './CostumeEditor.js';
import { SoundsPanel } from './SoundsPanel.js';
import { ask, el, escapeHtml, modal, promptText, toast } from './dialogs.js';

const CHANGED_KEY = 'edusim-stages.changed';
const LINK_KEY = 'edusim-stages.link';

export class App {
  constructor(root) {
    this.root = root;
    this.project = null;
    this.selected = null;
    this.tab = 'code';
    this.player = false;
    this.exporting = false;
    this.virtualTime = 0;
    this.audio = new AudioEngine();
    this.buildLayout();
    this.renderer = new StageRenderer(this.canvas, this.overlay);
    this.runtime = new Runtime(emptyProject(), this.makeHost());
    this.saver = new AutoSaver(() => this.project, () => this.runtime.drawOrder);
    this.saver.onSaved = () => { this.savedLabel.textContent = 'Saved'; };
    this.editor = new BlockEditor(this.root.querySelector('.pane-code'), this.editorHost());
    this.costumes = new CostumeEditor(this.root.querySelector('.pane-costumes'), this);
    this.sounds = new SoundsPanel(this.root.querySelector('.pane-sounds'), this);
    this.bindStage();
    this.bindKeys();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.loop(t));
  }

  // --- layout --------------------------------------------------------------------------------

  buildLayout() {
    this.root.innerHTML = `
      <header class="topbar">
        <a class="brand" href="https://edusim3dweb.com/" title="Edusim home page"><span class="brand-mark">E</span><span class="brand-name">Edusim <b>Stages</b></span></a>
        <div class="menus">
          <div class="menu"><button type="button" class="menu-btn" aria-haspopup="true">File ▾</button>
            <div class="menu-list" role="menu">
              <button type="button" data-act="new">New project</button>
              <button type="button" data-act="load">Load from your computer</button>
              <button type="button" data-act="save">Save to your computer</button>
              <button type="button" data-act="video">Export a video…</button>
              <button type="button" data-act="to3d">Convert to 3D World…</button>
            </div>
          </div>
          <button type="button" class="menu-btn" data-act="gallery">🎮 Projects</button>
          <button type="button" class="menu-btn" data-act="tutorials">📘 Tutorials</button>
        </div>
        <input class="title-input" type="text" aria-label="Project title" maxlength="60">
        <span class="saved" aria-live="polite"></span>
        <div class="top-right">
          <button type="button" class="top-link back3d" data-act="back3d" hidden>↩ Back to 3D world</button>
          <button type="button" class="top-link see-inside" data-act="inside">✎ See inside</button>
          <a class="top-link" href="../app/" title="Open Edusim, the 3D world">Edusim 3D</a>
        </div>
      </header>
      <main class="workspace-grid">
        <section class="left">
          <div class="tabs" role="tablist">
            <button type="button" class="tab on" data-tab="code" role="tab">Code</button>
            <button type="button" class="tab" data-tab="costumes" role="tab">Costumes</button>
            <button type="button" class="tab" data-tab="sounds" role="tab">Sounds</button>
            <div class="view-toggle" role="group" aria-label="Show the code as">
              <button type="button" class="on" data-view="blocks">Blocks</button>
              <button type="button" data-view="text">Text</button>
            </div>
          </div>
          <div class="pane pane-code"></div>
          <div class="pane pane-text" hidden>
            <div class="tx-bar">
              <span class="tx-title"></span>
              <button type="button" class="btn btn-primary btn-small" data-tx="apply">Use this text</button>
              <button type="button" class="btn btn-small" data-tx="reset">Undo my changes</button>
            </div>
            <textarea class="tx-area" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="The scripts as text"></textarea>
            <p class="tx-error" role="alert"></p>
            <details class="tx-help"><summary>How the text works</summary>
              <p>Each line is one block, written the way it reads. Blocks inside a loop or an if are indented by 4 spaces under a line that ends with <code>:</code>.</p>
              <p>Numbers go as they are: <code>move 10 steps</code>. Words and menu choices go in quotes: <code>say "Hello!"</code>, <code>when "space" key pressed:</code>. A reporter goes in brackets: <code>change x by (pick random 1 to 10)</code>, <code>if (touching "edge" ?) then:</code>, <code>say (score)</code>.</p>
              <p>A line starting with <code>#</code> is a note to yourself. <code>pass</code> means "nothing here yet".</p>
            </details>
          </div>
          <div class="pane pane-costumes" hidden></div>
          <div class="pane pane-sounds" hidden></div>
        </section>
        <section class="right">
          <div class="stage-bar">
            <button type="button" class="flag" title="Green flag: start" aria-label="Start">⚑</button>
            <button type="button" class="stop" title="Stop" aria-label="Stop">⬣</button>
            <button type="button" class="to3d" data-act="to3d" title="Convert to 3D World: walk into your project in Edusim">🌍 3D</button>
            <span class="stage-warn" role="status"></span>
            <div class="stage-sizes">
              <button type="button" data-size="small" title="Small stage" aria-label="Small stage">▫</button>
              <button type="button" data-size="normal" class="on" title="Normal stage" aria-label="Normal stage">◻</button>
              <button type="button" data-size="full" title="Full screen" aria-label="Full screen">⛶</button>
            </div>
          </div>
          <div class="stage-wrap">
            <canvas class="stage-canvas" aria-label="The stage"></canvas>
            <canvas class="stage-overlay" aria-hidden="true"></canvas>
            <form class="stage-ask" hidden><input type="text" aria-label="Your answer" autocomplete="off"><button type="submit" aria-label="Answer">✔</button></form>
          </div>
          <div class="sprite-info"></div>
          <div class="targets">
            <div class="sprite-list" aria-label="Sprites"></div>
            <div class="stage-card"></div>
          </div>
        </section>
      </main>
      <input type="file" class="file-in" accept=".json,application/json" hidden>
      <input type="file" class="pic-in" accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" hidden>
      <input type="file" class="snd-in" accept="audio/*" hidden>`;
    this.canvas = this.root.querySelector('.stage-canvas');
    this.overlay = this.root.querySelector('.stage-overlay');
    this.stageWrap = this.root.querySelector('.stage-wrap');
    this.askForm = this.root.querySelector('.stage-ask');
    this.titleInput = this.root.querySelector('.title-input');
    this.savedLabel = this.root.querySelector('.saved');
    this.warnLabel = this.root.querySelector('.stage-warn');
    this.spriteList = this.root.querySelector('.sprite-list');
    this.stageCard = this.root.querySelector('.stage-card');
    this.info = this.root.querySelector('.sprite-info');

    this.root.querySelector('.flag').addEventListener('click', () => this.greenFlag());
    this.root.querySelector('.stop').addEventListener('click', () => this.stop());
    this.root.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.tab)));
    this.view = 'blocks';
    this.root.querySelectorAll('.view-toggle button').forEach((b) => b.addEventListener('click', () => this.setView(b.dataset.view)));
    this.root.querySelector('[data-tx="apply"]').addEventListener('click', () => this.applyText());
    this.root.querySelector('[data-tx="reset"]').addEventListener('click', () => this.showText());
    const area = this.root.querySelector('.tx-area');
    area.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault();
        const { selectionStart: a, selectionEnd: b, value } = area;
        area.value = `${value.slice(0, a)}    ${value.slice(b)}`;
        area.selectionStart = area.selectionEnd = a + 4;
      }
    });
    this.root.querySelectorAll('.stage-sizes button').forEach((b) => b.addEventListener('click', () => this.setStageSize(b.dataset.size)));
    this.root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => this.action(b.dataset.act)));
    this.root.querySelectorAll('.menu').forEach((m) => {
      const btn = m.querySelector('.menu-btn');
      btn.addEventListener('click', (e) => { e.stopPropagation(); m.classList.toggle('open'); });
    });
    document.addEventListener('click', () => this.root.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open')));
    this.titleInput.addEventListener('change', () => {
      this.project.title = this.titleInput.value.trim() || 'Untitled';
      this.changed('title');
    });
    this.titleInput.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.titleInput.blur(); });
    this.askForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.askForm.querySelector('input');
      this.runtime.answerQuestion(input.value);
      input.value = '';
    });
    this.askForm.querySelector('input').addEventListener('keydown', (e) => e.stopPropagation());
    this.root.querySelector('.file-in').addEventListener('change', (e) => this.loadFile(e.target.files[0]));
  }

  action(act) {
    this.root.querySelectorAll('.menu.open').forEach((m) => m.classList.remove('open'));
    if (act === 'inside') this.setPlayer(false);
    if (act === 'new') this.newProject();
    if (act === 'load') this.root.querySelector('.file-in').click();
    if (act === 'save') this.saveFile();
    if (act === 'video') import('../export/VideoExport.js').then((m) => m.openExportDialog(this));
    if (act === 'to3d') import('../export/To3D.js').then((m) => m.openTo3DDialog(this));
    if (act === 'back3d') this.backTo3D();
    if (act === 'gallery') import('./Gallery.js').then((m) => m.openGallery(this));
    if (act === 'tutorials') import('./Tutorials.js').then((m) => m.openTutorials(this));
  }

  setTab(tab) {
    this.tab = tab;
    this.root.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    for (const name of ['code', 'costumes', 'sounds']) this.root.querySelector(`.pane-${name}`).hidden = name !== tab;
    this.root.querySelector('.view-toggle').hidden = tab !== 'code';
    if (tab === 'code') this.setView(this.view);
    else this.root.querySelector('.pane-text').hidden = true;
    if (tab === 'costumes') { this.costumes.show(this.selected); requestAnimationFrame(() => this.costumes.fit()); }
    if (tab === 'sounds') this.sounds.show(this.selected);
  }

  // --- the Text view ------------------------------------------------------------------------

  async setView(view) {
    if (this.view === 'text' && view === 'blocks' && this.textDirty()) {
      const answer = await ask('Use your text?', 'You changed the text. Turn it back into blocks before you go?', [['use', 'Use my text', true], ['drop', 'Leave it'], [null, 'Stay here']]);
      if (answer === null) return;
      if (answer === 'use' && !(await this.applyText())) return;
    }
    this.view = view;
    this.root.querySelectorAll('.view-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
    this.root.querySelector('.pane-code').hidden = view !== 'blocks';
    this.root.querySelector('.pane-text').hidden = view !== 'text';
    if (view === 'text') this.showText();
    else this.editor.renderWorkspace();
  }

  async showText() {
    const { printScripts } = await import('../text/text.js');
    const t = this.selected;
    this.textShown = printScripts(t.scripts);
    this.root.querySelector('.tx-area').value = this.textShown;
    this.root.querySelector('.tx-title').textContent = `${t.name}'s scripts as text`;
    this.root.querySelector('.tx-error').textContent = '';
  }

  textDirty() {
    return this.root.querySelector('.tx-area').value !== this.textShown;
  }

  async applyText() {
    const { parseScripts } = await import('../text/text.js');
    const area = this.root.querySelector('.tx-area');
    const err = this.root.querySelector('.tx-error');
    let scripts;
    try {
      scripts = parseScripts(area.value, { variables: this.variableNames(this.selected) });
    } catch (e) {
      err.textContent = e.message;
      if (e.line) {
        const lines = area.value.split('\n');
        const start = lines.slice(0, e.line - 1).join('\n').length + (e.line > 1 ? 1 : 0);
        area.focus();
        area.setSelectionRange(start, start + (lines[e.line - 1] || '').length);
      }
      return false;
    }
    this.runtime.stopAll();
    let y = 20;
    this.selected.scripts = scripts.map((blocks) => {
      const s = { id: newId('s'), x: 20, y, blocks };
      y += 60 + 40 * JSON.stringify(blocks).split('"type"').length;
      return s;
    });
    err.textContent = '';
    this.textShown = area.value;
    this.editor.renderWorkspace();
    this.editor.tidy();
    toast('Your text is now blocks.');
    return true;
  }

  setStageSize(size) {
    if (size === 'full') { this.setPlayer(!this.player); return; }
    this.root.classList.toggle('stage-small', size === 'small');
    this.root.querySelectorAll('.stage-sizes button').forEach((b) => b.classList.toggle('on', b.dataset.size === size));
    this.resize();
  }

  setPlayer(on) {
    this.player = on;
    this.root.classList.toggle('player', on);
    this.resize();
  }

  resize() {
    let w;
    if (this.player) {
      // The top bar, the flag row and the gaps between them.
      const availW = window.innerWidth - 32;
      const availH = window.innerHeight - 48 - 58 - 20;
      w = Math.min(availW, (availH * STAGE_W) / STAGE_H);
    } else {
      w = this.root.classList.contains('stage-small') ? 240 : Math.min(480, Math.max(240, window.innerWidth * 0.36));
    }
    const h = (w * STAGE_H) / STAGE_W;
    this.stageWrap.style.width = `${w}px`;
    this.stageWrap.style.height = `${h}px`;
    this.renderer.setSize(w, h);
    this.costumes?.fit?.();
  }

  // --- the project -----------------------------------------------------------------------------

  // The gallery module, loaded through the app's own module graph (a console import would be a
  // separate copy). The check tools use this.
  loadGallery() {
    return import('../templates/index.js');
  }

  // The exporter, for the check tools (the dialog is the student's way in).
  async exportForCheck(opts) {
    const { exportVideo } = await import('../export/VideoExport.js');
    return exportVideo(this, opts);
  }

  // Runs the project for `frames` frames on a virtual clock, with the given keys held down. For the
  // check tools: deterministic, and as fast as the machine allows.
  runVirtual(frames, keys = [], { flag = false } = {}) {
    const was = this.exporting;
    this.exporting = true;
    if (flag) { this.virtualTime = 0; this.runtime.greenFlag(); }
    for (let i = 0; i < frames; i++) {
      this.runtime.keys = new Set(keys);
      this.runtime.step();
      this.virtualTime += 1 / FRAME_RATE;
    }
    this.draw();
    this.exporting = was;
  }

  async boot() {
    const editToken = takeTokenParam('from-world');
    const params = new URLSearchParams(location.search);
    const linked = params.get('project');
    const play = params.has('play');
    let project = await loadSaved();
    if (editToken) {
      // "Edit in Stages" on a stage in a 3D world: open that stage's project here, and offer a way
      // back that updates it in place (plan: edusim-stages-to-3d-plan.md, phase 5).
      const payload = await takeHandoff(editToken).catch(() => null);
      if (payload?.type === 'edit') {
        const ok = !project || !this.hasChanges() || (await this.confirmReplace('Edit the stage from your 3D world'));
        if (ok) {
          try {
            project = fromFileText(payload.projectText);
            this.setLink({ recordId: payload.recordId, edition: payload.edition || 'app', layout: payload.layout, size: payload.size });
            await this.setProject(project, { fresh: true });
            toast('This is the project from your 3D world. When you are done, press ↩ Back to 3D world.', { ms: 6000 });
            return;
          } catch (err) {
            toast(err.message, { kind: 'error' });
          }
        }
      } else {
        toast('That link from your 3D world has expired. Click the stage there and choose Edit in Stages again.', { kind: 'error', ms: 6000 });
      }
    }
    this.setLink(this.readLink());
    if (linked) {
      const { GALLERY } = await import('../templates/index.js');
      const entry = GALLERY.find((g) => g.id === linked);
      // The link is removed from the address before anything loads, so a refresh keeps the
      // student's own work rather than reopening the linked project over it (the main app's
      // ?world= rule).
      history.replaceState(null, '', location.pathname + (play ? '?play' : ''));
      if (entry) {
        const replace = !project || !this.hasChanges() || (await ask('Open this project?',
          `"${entry.title}" will replace the project you have open. Save yours to your computer first if you want to keep it.`,
          [['replace', 'Open it', true], ['save', 'Save mine first'], ['keep', 'Keep mine']])) ;
        if (replace === 'save') await this.saveFile();
        if (replace === true || replace === 'replace' || replace === 'save') project = await entry.build();
      } else {
        toast('That project link is not one Edusim Stages knows.');
      }
    }
    if (!project) project = await this.defaultProject();
    await this.setProject(project, { fresh: !!linked });
    if (play) this.setPlayer(true);
  }

  async defaultProject() {
    const p = emptyProject('Untitled');
    const stage = stageOf(p);
    stage.costumes.push(await backdropFromLibrary(p, BACKDROPS[0]));
    stage.costumes[0].name = 'backdrop1';
    const robo = await spriteFromCartoon(p, CARTOON_SPRITES.find((s) => s.id === 'toon-robo'));
    p.targets.push(robo);
    return p;
  }

  async setProject(project, { fresh = false } = {}) {
    normalise(project);
    await preloadProject(project);
    this.project = project;
    this.runtime.setProject(project);
    this.renderer.penClear();
    this.titleInput.value = project.title;
    this.select(spritesOf(project)[0] || stageOf(project));
    this.renderTargets();
    if (fresh) { this.saver.touch(); this.markChanged(false); }
  }

  // --- the link back to a 3D world -------------------------------------------------------------

  readLink() {
    try { return JSON.parse(sessionStorage.getItem(LINK_KEY) || 'null'); } catch { return null; }
  }

  setLink(link) {
    this.link = link && link.recordId ? link : null;
    try {
      if (this.link) sessionStorage.setItem(LINK_KEY, JSON.stringify(this.link));
      else sessionStorage.removeItem(LINK_KEY);
    } catch { /* storage blocked: the button simply will not survive a refresh */ }
    const b = this.root.querySelector('.back3d');
    if (b) b.hidden = !this.link;
  }

  // Sends the edited project back. With the 3D world still open in another tab, it is updated at
  // once over a BroadcastChannel, which answers; with nothing answering, the world opens in a new
  // tab and updates itself from a handoff token.
  async backTo3D() {
    if (!this.link) return;
    const projectText = await toFileText(this.project, this.runtime.drawOrder);
    const { recordId, edition, layout = 'set', size = 'life' } = this.link;
    const answered = await new Promise((resolve) => {
      let ch;
      try { ch = new BroadcastChannel(CHANNEL); } catch { resolve(false); return; }
      const timer = setTimeout(() => { ch.close(); resolve(false); }, 1500);
      ch.onmessage = (e) => {
        if (e.data?.type === 'project-updated-ok' && e.data.recordId === recordId) {
          clearTimeout(timer);
          ch.close();
          resolve(true);
        }
      };
      ch.postMessage({ type: 'project-updated', recordId, projectText });
    });
    if (answered) {
      toast('Your 3D world has the new version. Switch to its tab to see it.', { ms: 5000 });
      return;
    }
    const token = await putHandoff({ type: 'update', recordId, projectText, title: this.project.title, layout, size, preset: 'empty' });
    const url = `${edition === 'hifi' ? '../hifi/' : '../app/'}?from-stages=${token}`;
    if (!window.open(url, '_blank')) location.href = url;
  }

  hasChanges() {
    try { return localStorage.getItem(CHANGED_KEY) === '1'; } catch { return true; }
  }

  markChanged(on) {
    try { localStorage.setItem(CHANGED_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  }

  // Every edit goes through here.
  changed(reason) {
    this.savedLabel.textContent = 'Saving…';
    this.saver.touch();
    this.markChanged(true);
    if (reason === 'costume' || reason === 'sprite' || reason === 'sound') this.renderTargets();
    if (reason === 'sprite' || reason === 'variable') this.editor.refresh();
  }

  pruneSoon() {
    clearTimeout(this.pruneTimer);
    this.pruneTimer = setTimeout(() => pruneAssets(this.project), 3000);
  }

  async confirmReplace(what) {
    if (!this.hasChanges()) return true;
    const answer = await ask(`${what}?`, 'This will replace the project you have open. Save it to your computer first if you want to keep it.',
      [['go', 'Replace it', true], ['save', 'Save mine first'], [null, 'Cancel']]);
    if (answer === 'save') { await this.saveFile(); return true; }
    return answer === 'go';
  }

  async newProject() {
    if (!(await this.confirmReplace('Start a new project'))) return;
    this.setLink(null);
    await this.setProject(await this.defaultProject(), { fresh: true });
    toast('A new project is ready.');
  }

  async openProject(build, title) {
    if (!(await this.confirmReplace(`Open "${title}"`))) return false;
    const project = await build();
    this.setLink(null);
    await this.setProject(project, { fresh: true });
    return true;
  }

  async saveFile() {
    const text = await toFileText(this.project, this.runtime.drawOrder);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeFileName(this.project.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    this.markChanged(false);
    toast(`Saved as ${a.download}. Keep it somewhere safe, or send it to a friend.`);
  }

  async loadFile(file) {
    this.root.querySelector('.file-in').value = '';
    if (!file) return;
    let project;
    try {
      project = fromFileText(await file.text());
    } catch (err) {
      toast(err.message, { kind: 'error', ms: 6000 });
      return;
    }
    if (!(await this.confirmReplace('Load this project'))) return;
    this.setLink(null);
    await this.setProject(project, { fresh: true });
    toast(`Opened "${project.title}".`);
  }

  // --- running -----------------------------------------------------------------------------

  makeHost() {
    return {
      now: () => (this.exporting ? this.virtualTime : performance.now() / 1000),
      random: Math.random,
      maskFor,
      audio: this.audio,
      pen: {
        line: (...a) => this.renderer.penLine(...a),
        dot: (...a) => this.renderer.penDot(...a),
        stamp: (t) => this.renderer.penStamp(t),
        clear: () => this.renderer.penClear(),
      },
      onAsk: (state) => this.showAsk(state),
      onChange: () => this.saver.touch(),
    };
  }

  greenFlag() {
    this.audio.unlock();
    this.runtime.greenFlag();
  }

  stop() {
    this.runtime.stopAll();
  }

  showAsk(state) {
    this.askState = state;
    this.askForm.hidden = !state;
    if (state) {
      this.askForm.classList.toggle('with-question', !!state.question);
      setTimeout(() => this.askForm.querySelector('input').focus(), 0);
    }
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.exporting) return;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    const frame = 1 / FRAME_RATE;
    let steps = 0;
    while (this.acc >= frame && steps < 3) {
      this.runtime.step();
      this.acc -= frame;
      steps++;
    }
    if (steps === 3) this.acc = 0;
    this.draw();
    if (now - (this.lastUi || 0) > 200) {
      this.lastUi = now;
      this.editor.markRunning();
      this.updateInfoValues();
      this.root.querySelector('.flag').classList.toggle('running', this.runtime.isRunning());
      const w = this.runtime.warnings;
      if (w.length) { this.warnLabel.textContent = w[w.length - 1]; this.warnLabel.title = w.join('\n'); } else this.warnLabel.textContent = '';
    }
  }

  draw() {
    this.renderer.render({
      stage: this.runtime.stage,
      drawOrder: this.runtime.drawOrder,
      caption: this.runtime.caption,
      monitors: this.project?.monitors,
      monitorValue: (m) => this.runtime.monitorValue(m),
      monitorLabel: (m) => this.monitorLabel(m),
      askQuestion: this.askState ? this.askState.question : null,
    });
  }

  // --- the stage ---------------------------------------------------------------------------

  bindStage() {
    const wrap = this.stageWrap;
    let drag = null;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.stage-ask')) return;
      this.audio.unlock();
      const [x, y] = this.renderer.toStage(e.clientX, e.clientY);
      this.runtime.mouse = { x, y, down: true };
      const [sx, sy] = this.renderer.toScreen(e.clientX, e.clientY);
      const mon = !this.player && this.renderer.monitorRects.find((r) => sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h);
      if (mon) {
        const m = this.project.monitors.find((x) => x.id === mon.id);
        drag = { monitor: m, dx: sx - m.x, dy: sy - m.y, moved: false, id: e.pointerId };
        wrap.setPointerCapture(e.pointerId);
        return;
      }
      const target = this.runtime.targetAt(x, y);
      const canDrag = !target.isStage && (!this.player ? !target.isClone : target.draggable);
      if (canDrag) {
        drag = { target, dx: x - target.x, dy: y - target.y, moved: false, id: e.pointerId };
        wrap.setPointerCapture(e.pointerId);
        if (!this.player && target !== this.selected) this.select(target);
      } else {
        this.runtime.click(target);
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      const [x, y] = this.renderer.toStage(e.clientX, e.clientY);
      this.runtime.mouse.x = Math.max(-240, Math.min(240, x));
      this.runtime.mouse.y = Math.max(-180, Math.min(180, y));
      if (!drag || e.pointerId !== drag.id) return;
      drag.moved = true;
      if (drag.monitor) {
        const [sx, sy] = this.renderer.toScreen(e.clientX, e.clientY);
        drag.monitor.x = Math.round(Math.max(0, Math.min(STAGE_W - 30, sx - drag.dx)));
        drag.monitor.y = Math.round(Math.max(0, Math.min(STAGE_H - 20, sy - drag.dy)));
        return;
      }
      drag.target.x = Math.round(Math.max(-240, Math.min(240, x - drag.dx)));
      drag.target.y = Math.round(Math.max(-180, Math.min(180, y - drag.dy)));
      this.runtime.redraw = true;
    });
    const end = (e) => {
      this.runtime.mouse.down = false;
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.monitor) { if (d.moved) this.changed('monitor'); return; }
      if (!d.moved) this.runtime.click(d.target);
      else { this.renderInfo(); this.changed('move'); }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  bindKeys() {
    const editable = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    window.addEventListener('keydown', (e) => {
      if (editable(e.target) || document.querySelector('.modal-back')) return;
      if (e.key === 'Escape' && this.player) { this.setPlayer(false); return; }
      const name = keyName(e.key);
      if (!name) return;
      if (name === 'space' || name.endsWith('arrow')) e.preventDefault();
      this.runtime.keyDown(name);
    });
    window.addEventListener('keyup', (e) => this.runtime.keyUp(keyName(e.key)));
    window.addEventListener('blur', () => this.runtime.keys.clear());
  }

  // --- targets: the sprite list and the stage card ---------------------------------------------

  select(target) {
    if (!target) return;
    this.selected = target;
    if (this.view === 'text' && this.tab === 'code') this.showText();
    this.editor.setTarget(target);
    this.renderTargets();
    this.renderInfo();
    const costumesTab = this.root.querySelector('[data-tab="costumes"]');
    costumesTab.textContent = target.isStage ? 'Backdrops' : 'Costumes';
    if (this.tab === 'costumes') this.costumes.show(target);
    if (this.tab === 'sounds') this.sounds.show(target);
  }

  renderTargets() {
    if (!this.project) return;
    this.spriteList.innerHTML = '';
    const sprites = spritesOf(this.project);
    for (const s of sprites) {
      const card = el('div', { class: `sprite-card${s === this.selected ? ' on' : ''}`, role: 'button', tabindex: '0', 'aria-label': `Sprite ${s.name}` });
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 56;
      drawThumb(c, s.costumes[s.currentCostume]);
      card.append(c, el('span', { class: 'sprite-name', text: s.name }));
      const menu = el('button', { type: 'button', class: 'sprite-more', 'aria-label': `More for ${s.name}`, text: '⋯' });
      card.appendChild(menu);
      card.addEventListener('click', (e) => { if (e.target !== menu) this.select(s); });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.select(s); });
      menu.addEventListener('click', (e) => { e.stopPropagation(); this.spriteMenu(s, menu); });
      this.spriteList.appendChild(card);
    }
    const add = el('div', { class: 'sprite-add' });
    add.append(
      el('button', { type: 'button', class: 'btn btn-primary btn-small', text: '🔍 Choose a Sprite', onclick: () => this.addSpriteFromLibrary() }),
      el('button', { type: 'button', class: 'btn btn-small', text: '🖌️ Paint', title: 'Paint a new sprite', onclick: () => this.paintSprite() }),
      el('button', { type: 'button', class: 'btn btn-small', text: '⬆ Upload', title: 'Upload a picture as a new sprite', onclick: () => this.uploadSprite() }),
    );
    this.spriteList.appendChild(add);

    const stage = stageOf(this.project);
    this.stageCard.innerHTML = '';
    const card = el('div', { class: `stage-target${stage === this.selected ? ' on' : ''}`, role: 'button', tabindex: '0', 'aria-label': 'The stage' });
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    drawThumb(c, stage.costumes[stage.currentCostume]);
    card.append(el('span', { class: 'stage-label', text: 'Stage' }), c, el('span', { class: 'stage-count', text: `${stage.costumes.length} backdrop${stage.costumes.length === 1 ? '' : 's'}` }));
    card.addEventListener('click', () => this.select(stage));
    this.stageCard.append(card, el('button', { type: 'button', class: 'btn btn-small', text: '🔍 Backdrop', title: 'Choose a backdrop', onclick: () => this.addBackdropFromLibrary() }));
  }

  spriteMenu(sprite, anchor) {
    document.querySelector('.be-popup')?.remove();
    const pop = el('div', { class: 'be-popup' });
    const item = (label, fn) => pop.appendChild(el('button', { type: 'button', class: 'be-opt', text: label, onclick: () => { pop.remove(); fn(); } }));
    item('Duplicate', () => this.duplicateSprite(sprite));
    item('Delete', () => this.deleteSprite(sprite));
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.min(window.innerWidth - 160, r.left)}px`;
    pop.style.top = `${r.bottom + 4}px`;
    setTimeout(() => document.addEventListener('pointerdown', function off(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); }
    }, true), 0);
  }

  addSprite(sprite) {
    sprite.x = Math.round((Math.random() - 0.5) * 240);
    sprite.y = Math.round((Math.random() - 0.5) * 160);
    this.project.targets.push(sprite);
    this.runtime.prepare(sprite);
    this.runtime.sprites = spritesOf(this.project);
    this.runtime.drawOrder.push(sprite);
    this.select(sprite);
    this.changed('sprite');
  }

  duplicateSprite(sprite) {
    const copy = JSON.parse(JSON.stringify(sprite, (k, v) => (k.startsWith('_') ? undefined : v)));
    const fresh = makeSprite(uniqueName(sprite.name, this.project.targets.map((t) => t.name)));
    Object.assign(copy, { id: fresh.id, name: fresh.name });
    copy.scripts = sprite.scripts.map((s) => JSON.parse(JSON.stringify(s)));
    for (const s of copy.scripts) for (const b of walkBlocks(s.blocks)) b.id = `${b.id}d${Math.random().toString(36).slice(2, 6)}`;
    this.addSprite(copy);
    copy.x = sprite.x + 20;
    copy.y = sprite.y - 20;
  }

  async deleteSprite(sprite) {
    const answer = await ask('Delete this sprite?', `"${sprite.name}" and all its scripts will be deleted.`, [['yes', 'Delete', true], [null, 'Keep it']]);
    if (answer !== 'yes') return;
    this.runtime.stopAll();
    this.project.targets = this.project.targets.filter((t) => t !== sprite);
    this.project.monitors = this.project.monitors.filter((m) => m.target !== sprite.id);
    this.runtime.sprites = spritesOf(this.project);
    this.runtime.drawOrder = this.runtime.drawOrder.filter((t) => t !== sprite && t.original !== sprite);
    this.pruneSoon();
    this.select(spritesOf(this.project)[0] || stageOf(this.project));
    this.changed('sprite');
  }

  async addSpriteFromLibrary() {
    const choice = await chooseSprite();
    if (!choice) return;
    const busy = toastBusy(choice.kind === 'model' ? `Photographing "${choice.entry.title}" from 12 sides…` : `Adding ${choice.entry.name}…`);
    try {
      const sprite = choice.kind === 'model' ? await spriteFromModel(this.project, choice.entry) : await spriteFromCartoon(this.project, choice.entry);
      this.addSprite(sprite);
      if (choice.kind === 'model') toast(`${sprite.name} has 12 costumes, one for each side. Try "next costume" in a forever loop to turn it round.`, { ms: 6000 });
    } catch (err) {
      console.error(err);
      toast(`That sprite could not be added: ${err.message}`, { kind: 'error' });
    } finally {
      busy();
    }
  }

  async addCostumeFromLibrary() {
    const choice = await chooseSprite();
    if (!choice) return;
    const busy = toastBusy('Adding costumes…');
    try {
      const temp = choice.kind === 'model' ? await spriteFromModel(this.project, choice.entry) : await spriteFromCartoon(this.project, choice.entry);
      const t = this.selected;
      for (const c of temp.costumes) {
        c.name = uniqueName(c.name, t.costumes.map((x) => x.name));
        t.costumes.push(c);
      }
      t.currentCostume = t.costumes.length - temp.costumes.length;
      this.changed('costume');
      this.costumes.show(t);
    } finally {
      busy();
    }
  }

  async addBackdropFromLibrary() {
    const entry = await chooseBackdrop();
    if (!entry) return;
    const stage = stageOf(this.project);
    const costume = await backdropFromLibrary(this.project, entry);
    costume.name = uniqueName(entry.name, stage.costumes.map((c) => c.name));
    stage.costumes.push(costume);
    this.runtime.switchBackdrop(costume.name);
    this.select(stage);
    this.changed('costume');
    if (this.tab === 'costumes') this.costumes.show(stage);
  }

  async addSoundFromLibrary() {
    const entry = await chooseSound(this.audio);
    if (!entry) return;
    const t = this.selected;
    const sound = await soundFromLibrary(this.project, entry);
    sound.name = uniqueName(entry.name, t.sounds.map((s) => s.name));
    t.sounds.push(sound);
    this.changed('sound');
    this.sounds.show(t);
    this.sounds.select(sound);
  }

  pickFile(selector) {
    return new Promise((resolve) => {
      const input = this.root.querySelector(selector);
      input.value = '';
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  async uploadSprite() {
    const file = await this.pickFile('.pic-in');
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Sprite';
    const sprite = makeSprite(uniqueName(name, this.project.targets.map((t) => t.name)));
    sprite.costumes.push(await costumeFromBlob(this.project, file, name));
    this.addSprite(sprite);
  }

  async uploadCostume(target) {
    const file = await this.pickFile('.pic-in');
    if (!file) return;
    const name = uniqueName(file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'costume', target.costumes.map((c) => c.name));
    const costume = await costumeFromBlob(this.project, file, name, target.isStage ? { resolution: 1 } : {});
    target.costumes.push(costume);
    target.currentCostume = target.costumes.length - 1;
    this.changed('costume');
    this.costumes.show(target);
  }

  async uploadSound(target) {
    const file = await this.pickFile('.snd-in');
    if (!file) return;
    try {
      const sound = await soundFromBlob(this.project, file, uniqueName(file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'sound', target.sounds.map((s) => s.name)));
      target.sounds.push(sound);
      this.changed('sound');
      this.sounds.show(target);
      this.sounds.select(sound);
    } catch {
      toast('That file is not a sound this browser can play.', { kind: 'error' });
    }
  }

  async paintSprite() {
    const sprite = makeSprite(uniqueName('Sprite', this.project.targets.map((t) => t.name)));
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const g = canvas.getContext('2d');
    g.fillStyle = '#4c97ff';
    g.beginPath();
    g.arc(120, 120, 50, 0, Math.PI * 2);
    g.fill();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    sprite.costumes.push(await costumeFromBlob(this.project, blob, 'costume1', { resolution: 2 }));
    this.addSprite(sprite);
    this.setTab('costumes');
  }

  // --- the info row ----------------------------------------------------------------------------

  renderInfo() {
    const t = this.selected;
    if (!t) return;
    if (t.isStage) {
      this.info.innerHTML = '<p class="info-stage">The <strong>Stage</strong> is selected. It holds the backdrops and scripts that belong to the whole project.</p>';
      return;
    }
    this.info.innerHTML = `
      <label class="info-name">Sprite <input type="text" data-f="name" maxlength="30"></label>
      <label>x <input type="number" data-f="x" step="1"></label>
      <label>y <input type="number" data-f="y" step="1"></label>
      <label>Size <input type="number" data-f="size" step="5" min="1"></label>
      <label>Direction <input type="number" data-f="direction" step="15"></label>
      <label class="info-check"><input type="checkbox" data-f="visible"> Show</label>
      <label>Turn <select data-f="rotationStyle"><option value="all around">all around</option><option value="left-right">left-right</option><option value="don't rotate">don't rotate</option></select></label>`;
    for (const input of this.info.querySelectorAll('[data-f]')) {
      input.addEventListener('keydown', (e) => e.stopPropagation());
      input.addEventListener('change', () => this.infoChanged(input));
    }
    this.updateInfoValues(true);
  }

  updateInfoValues(force = false) {
    const t = this.selected;
    if (!t || t.isStage) return;
    for (const input of this.info.querySelectorAll('[data-f]')) {
      if (!force && document.activeElement === input) continue;
      const f = input.dataset.f;
      if (input.type === 'checkbox') input.checked = !!t[f];
      else if (f === 'x' || f === 'y' || f === 'size' || f === 'direction') input.value = String(Math.round(t[f]));
      else input.value = t[f];
    }
  }

  infoChanged(input) {
    const t = this.selected;
    const f = input.dataset.f;
    if (f === 'name') {
      const old = t.name;
      const name = uniqueName(input.value.trim() || old, this.project.targets.filter((x) => x !== t).map((x) => x.name));
      this.renameSpriteInScripts(old, name);
      t.name = name;
      this.renderTargets();
      this.editor.refresh();
    } else if (f === 'visible') t.visible = input.checked;
    else if (f === 'rotationStyle') t.rotationStyle = input.value;
    else if (f === 'size') this.runtime.setSize(t, Number(input.value) || 100);
    else if (f === 'direction') this.runtime.setDirection(t, Number(input.value) || 0);
    else t[f] = Math.max(f === 'x' ? -240 : -180, Math.min(f === 'x' ? 240 : 180, Number(input.value) || 0));
    this.updateInfoValues(true);
    this.changed('info');
  }

  // --- renames that have to reach into scripts ---------------------------------------------------

  eachBlock(fn, targets = this.project.targets) {
    for (const t of targets) for (const s of t.scripts) for (const b of walkBlocks(s.blocks)) fn(b, t);
  }

  renameSpriteInScripts(old, name) {
    const fields = ['TO', 'TOWARDS', 'TOUCHINGOBJECTMENU', 'DISTANCETOMENU', 'CLONE_OPTION', 'OBJECT'];
    this.eachBlock((b) => { for (const f of fields) if (b.inputs[f]?.value === old) b.inputs[f].value = name; });
  }

  renameCostumeInScripts(target, old, name) {
    if (target.isStage) this.eachBlock((b) => { if (b.inputs.BACKDROP?.value === old) b.inputs.BACKDROP.value = name; });
    else this.eachBlock((b) => { if (b.inputs.COSTUME?.value === old) b.inputs.COSTUME.value = name; }, [target]);
  }

  renameSoundInScripts(target, old, name) {
    this.eachBlock((b) => { if (b.inputs.SOUND?.value === old) b.inputs.SOUND.value = name; }, [target]);
  }

  // --- what the block editor asks of the app -------------------------------------------------------

  editorHost() {
    const app = this;
    return {
      defaultBlock: (type, target, values) => app.defaultBlock(type, target, values),
      menuOptions: (kind, block, target) => app.menuOptions(kind, block, target),
      variableNames: (target) => app.variableNames(target),
      makeVariable: () => app.makeVariable(),
      renameVariable: (n) => app.renameVariable(n),
      deleteVariable: (n) => app.deleteVariable(n),
      newMessage: () => app.newMessage(),
      monitorShown: (block, target) => app.monitorShown(block, target),
      setMonitor: (block, target, on) => app.setMonitor(block, target, on),
      onChange: (reason) => app.changed(reason),
      isRunning: (script) => app.runtime.scriptRunning(app.selected, script),
      onRunScript: (script, el) => {
        app.audio.unlock();
        const r = app.runtime.toggleScript(app.selected, script);
        if (r && typeof r === 'object') app.valueBubble(el, r.value);
      },
      onRunBlock: (block, el) => {
        app.audio.unlock();
        const def = blockDef(block.type);
        if (def.shape === 'reporter' || def.shape === 'boolean') {
          app.valueBubble(el, app.runtime.evalBlock(block, { target: app.selected }));
          return;
        }
        if (def.shape === 'hat') return;
        app.runtime.startThread(app.selected, { id: 'palette', blocks: [block] }, true);
      },
    };
  }

  valueBubble(anchor, value) {
    const r = anchor.getBoundingClientRect();
    const b = el('div', { class: 'value-bubble', text: String(value) });
    document.body.appendChild(b);
    b.style.left = `${r.left}px`;
    b.style.top = `${r.bottom + 6}px`;
    setTimeout(() => b.remove(), 2200);
  }

  defaultBlock(type, target, values = {}) {
    const block = createBlock(type, values);
    const def = BLOCKS.get(type);
    for (const [name, spec] of Object.entries(def.inputs)) {
      if (name in values) continue;
      const input = block.inputs[name];
      if (spec.kind === 'variable') input.value = this.variableNames(target)[0] || '';
      if (spec.kind !== 'menu' || typeof spec.options !== 'string') continue;
      const opts = this.menuOptions(spec.options, block, target);
      if (spec.options === 'cloneTargets' && target && !target.isStage) input.value = '_myself_';
      else if (spec.options === 'ofTargets') {
        const other = spritesOf(this.project).find((s) => s !== target);
        input.value = other ? other.name : '_stage_';
        block.inputs.PROPERTY.value = other ? 'x position' : 'backdrop #';
      } else if (!opts.some(([v]) => v === input.value)) input.value = opts.find(([v]) => !String(v).startsWith('__'))?.[0] ?? '';
    }
    return block;
  }

  menuOptions(kind, block, target) {
    const sprites = spritesOf(this.project);
    const others = sprites.filter((s) => s !== target).map((s) => [s.name, s.name]);
    const stage = stageOf(this.project);
    switch (kind) {
      case 'gotoTargets': return [['_random_', 'random position'], ['_mouse_', 'mouse-pointer'], ...others];
      case 'pointTargets': return [['_mouse_', 'mouse-pointer'], ...others];
      case 'touchTargets': return [['_mouse_', 'mouse-pointer'], ['_edge_', 'edge'], ...others];
      case 'cloneTargets': return [...(target && !target.isStage ? [['_myself_', 'myself']] : []), ...sprites.map((s) => [s.name, s.name])];
      case 'costumes': return (target?.costumes || []).map((c) => [c.name, c.name]);
      case 'backdrops': return stage.costumes.map((c) => [c.name, c.name]);
      case 'backdropsAndNext': return [...stage.costumes.map((c) => [c.name, c.name]), ['next backdrop', 'next backdrop'], ['previous backdrop', 'previous backdrop'], ['random backdrop', 'random backdrop']];
      case 'sounds': return (target?.sounds || []).map((s) => [s.name, s.name]);
      case 'messages': return [...messagesIn(this.project).map((m) => [m, m]), ['__newmessage__', 'New message…']];
      case 'ofTargets': return [['_stage_', 'Stage'], ...others];
      case 'propertiesOf': {
        const obj = block?.inputs?.OBJECT?.value;
        if (obj === '_stage_' || !obj) return ['backdrop #', 'backdrop name', 'volume', ...Object.keys(stage.variables)].map((p) => [p, p]);
        const s = sprites.find((x) => x.name === obj);
        return ['x position', 'y position', 'direction', 'costume #', 'costume name', 'size', 'volume', ...Object.keys(s?.variables || {})].map((p) => [p, p]);
      }
      default: return [];
    }
  }

  variableNames(target) {
    const global = Object.keys(stageOf(this.project).variables);
    const local = target && !target.isStage ? Object.keys(target.variables) : [];
    return [...new Set([...global, ...local])].sort((a, b) => a.localeCompare(b));
  }

  async makeVariable() {
    const target = this.selected;
    let scope = 'all';
    const result = await promptText('New Variable', {
      label: 'New variable name:',
      ok: 'OK',
      extra: target.isStage ? null : (box) => {
        box.innerHTML = '<label class="radio"><input type="radio" name="vscope" value="all" checked> For all sprites</label><label class="radio"><input type="radio" name="vscope" value="this"> For this sprite only</label>';
        box.addEventListener('change', (e) => { scope = e.target.value; });
        return () => scope;
      },
      check: (v) => {
        if (!v) return 'Give the variable a name.';
        if (this.variableNames(target).includes(v) || spritesOf(this.project).some((s) => Object.prototype.hasOwnProperty.call(s.variables, v))) return 'A variable with that name already exists.';
        return null;
      },
    });
    if (!result) return;
    const name = typeof result === 'string' ? result : result.value;
    const where = typeof result === 'string' ? 'all' : result.extra;
    if (where === 'this' && !target.isStage) target.variables[name] = 0;
    else stageOf(this.project).variables[name] = 0;
    this.editor.refresh();
    this.changed('variable');
  }

  holderOf(name) {
    const stage = stageOf(this.project);
    if (Object.prototype.hasOwnProperty.call(stage.variables, name)) return [stage.variables, null];
    const s = spritesOf(this.project).find((x) => Object.prototype.hasOwnProperty.call(x.variables, name));
    return s ? [s.variables, s] : [null, null];
  }

  async renameVariable(old) {
    const [holder, owner] = this.holderOf(old);
    if (!holder) return;
    const name = await promptText('Rename Variable', { label: `New name for "${old}":`, value: old, check: (v) => (!v ? 'Give it a name.' : (v !== old && this.variableNames(this.selected).includes(v) ? 'That name is taken.' : null)) });
    if (!name || name === old) return;
    holder[name] = holder[old];
    delete holder[old];
    this.eachBlock((b) => { if (b.inputs.VARIABLE?.value === old) b.inputs.VARIABLE.value = name; }, owner ? [owner] : this.project.targets);
    for (const m of this.project.monitors) if (m.kind === 'variable' && m.name === old && (m.target || null) === (owner?.id || null)) { m.name = name; m.id = `var:${owner?.id || ''}:${name}`; }
    this.editor.refresh();
    this.changed('variable');
  }

  async deleteVariable(name) {
    const [holder, owner] = this.holderOf(name);
    if (!holder) return;
    delete holder[name];
    this.project.monitors = this.project.monitors.filter((m) => !(m.kind === 'variable' && m.name === name && (m.target || null) === (owner?.id || null)));
    this.editor.refresh();
    this.changed('variable');
    toast(`Deleted the "${name}" variable. Blocks that used it will say so when they run.`);
  }

  async newMessage() {
    const name = await promptText('New Message', { label: 'New message name:', check: (v) => (!v ? 'Give the message a name.' : null) });
    if (!name) return null;
    if (!this.project.messages.includes(name)) this.project.messages.push(name);
    this.changed('message');
    return name;
  }

  // --- monitors ---------------------------------------------------------------------------------

  monitorId(block, target) {
    if (block.type === 'data_variable') {
      const name = block.inputs.VARIABLE.value;
      const [, owner] = this.holderOf(name);
      return { id: `var:${owner?.id || ''}:${name}`, kind: 'variable', target: owner?.id || null, name };
    }
    const def = BLOCKS.get(block.type);
    const params = Object.fromEntries(Object.entries(block.inputs).map(([k, v]) => [k, v.value]));
    const owner = def.where === 'sprite' || (!target?.isStage && ['sound_volume'].includes(block.type)) ? target?.id : null;
    return { id: `rep:${owner || ''}:${block.type}:${JSON.stringify(params)}`, kind: 'reporter', target: owner || null, opcode: block.type, params };
  }

  monitorShown(block, target) {
    const { id } = this.monitorId(block, target);
    return !!this.project.monitors.find((m) => m.id === id && m.visible);
  }

  setMonitor(block, target, on) {
    const info = this.monitorId(block, target);
    let m = this.project.monitors.find((x) => x.id === info.id);
    if (!m) {
      const n = this.project.monitors.filter((x) => x.visible).length;
      m = { ...info, x: 6, y: 6 + n * 27, visible: on, mode: 'normal' };
      this.project.monitors.push(m);
    }
    m.visible = on;
    this.changed('monitor');
  }

  monitorLabel(m) {
    const owner = m.target ? this.project.targets.find((t) => t.id === m.target) : null;
    let label;
    if (m.kind === 'variable') label = m.name;
    else {
      const def = BLOCKS.get(m.opcode);
      label = def ? labelParts(def).map((p) => (p.text ?? menuLabel(m.params?.[p.input] ?? ''))).join('').replace(/\s+/g, ' ').trim() : m.opcode;
    }
    return owner ? `${owner.name}: ${label}` : label;
  }
}

function toastBusy(text) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.innerHTML = `<span class="spinner" aria-hidden="true"></span>${escapeHtml(text)}`;
  el.setAttribute('role', 'status');
  document.body.appendChild(el);
  return () => el.remove();
}

export { FILE_SUFFIX, modal };
