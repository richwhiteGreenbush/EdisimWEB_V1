// The block editor: the category list, the palette and the script area, laid out the way anyone who
// has used Scratch expects (plan, section 4).
//
// Scripts float freely in the script area. Dragging a block takes it AND EVERYTHING BELOW IT in its
// stack, as Scratch does; a reporter drags alone. Reporters drop into round slots, true/false blocks
// into pointed ones (and into round ones too, as in Scratch). Dropping anything on the palette
// deletes it. Clicking a script runs it, or stops it if it is running.
//
// It draws plain DOM from the project's block trees and redraws after every change. The tree is the
// truth: drop targets are measured off the drawn blocks (getBoundingClientRect), the way the main
// app's editor finds them, so what you see is exactly where a block will land.
//
// Uses Pointer Events throughout, so it works with a mouse, a finger or a stylus.
import {
  BLOCKS, CATEGORIES, CATEGORY_ORDER, blockDef, isCap, isValueShape, labelParts, paletteFor,
} from '../blocks/defs.js';
import { cloneBlock, createBlock, newId } from '../blocks/make.js';

const SNAP = 26; // pixels, before zoom
const MENU_LABELS = { _mouse_: 'mouse-pointer', _edge_: 'edge', _random_: 'random position', _myself_: 'myself', _stage_: 'Stage' };
export const menuLabel = (v) => MENU_LABELS[v] ?? v;

export class BlockEditor {
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.target = null;
    this.zoom = 0.85;
    this.drag = null;
    root.classList.add('be');
    root.innerHTML = `
      <div class="be-cats" role="tablist" aria-label="Block categories"></div>
      <div class="be-palette" aria-label="Blocks"></div>
      <div class="be-workspace" aria-label="Scripts">
        <div class="be-canvas"></div>
        <div class="be-empty"></div>
        <div class="be-zoom">
          <button type="button" data-z="in" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" data-z="reset" title="Normal size" aria-label="Normal size">=</button>
          <button type="button" data-z="out" title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" data-z="tidy" title="Clean up blocks" aria-label="Clean up blocks">⇅</button>
        </div>
      </div>`;
    this.cats = root.querySelector('.be-cats');
    this.palette = root.querySelector('.be-palette');
    this.workspace = root.querySelector('.be-workspace');
    this.canvas = root.querySelector('.be-canvas');
    this.empty = root.querySelector('.be-empty');
    root.querySelector('.be-zoom').addEventListener('click', (e) => {
      const z = e.target.closest('button')?.dataset.z;
      if (z === 'in') this.setZoom(this.zoom * 1.15);
      if (z === 'out') this.setZoom(this.zoom / 1.15);
      if (z === 'reset') this.setZoom(0.85);
      if (z === 'tidy') this.tidy();
    });
    this.palette.addEventListener('pointerdown', (e) => this.onPalettePointer(e));
    this.canvas.addEventListener('pointerdown', (e) => this.onCanvasPointer(e));
    this.workspace.addEventListener('contextmenu', (e) => this.onContext(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    document.addEventListener('pointerdown', (e) => {
      if (this.popup && !this.popup.contains(e.target)) this.closePopup();
    }, true);
    this.setZoom(this.zoom);
  }

  setZoom(z) {
    this.zoom = Math.max(0.4, Math.min(2, z));
    this.canvas.style.transform = `scale(${this.zoom})`;
  }

  setTarget(target) {
    this.target = target;
    this.renderPalette();
    this.renderWorkspace();
    this.workspace.scrollTo(0, 0);
  }

  refresh() {
    this.renderPalette(true);
    this.renderWorkspace();
  }

  // --- the palette -------------------------------------------------------------------------

  renderPalette(keepScroll = false) {
    const top = this.palette.scrollTop;
    const groups = paletteFor(!!this.target?.isStage);
    this.cats.innerHTML = '';
    this.palette.innerHTML = '';
    for (const cat of CATEGORY_ORDER) {
      const info = CATEGORIES[cat];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'be-cat';
      btn.innerHTML = `<span class="be-cat-dot" style="background:${info.fill};border-color:${info.dark}"></span><span>${info.name}</span>`;
      btn.addEventListener('click', () => {
        const h = this.palette.querySelector(`[data-cat="${cat}"]`);
        if (h) {
          const top = this.palette.scrollTop + h.getBoundingClientRect().top - this.palette.getBoundingClientRect().top - 6;
          this.palette.scrollTo({ top, behavior: 'smooth' });
        }
      });
      this.cats.appendChild(btn);

      const section = document.createElement('section');
      section.className = 'be-section';
      section.dataset.cat = cat;
      section.innerHTML = `<h3>${info.name}</h3>`;
      if (cat === 'variables') this.renderVariablesSection(section);
      if (cat === 'motion' && this.target?.isStage) {
        section.insertAdjacentHTML('beforeend', '<p class="be-note">The stage does not move. Pick a sprite to use motion blocks.</p>');
      }
      for (const type of groups[cat]) {
        if (cat === 'variables') continue; // drawn by renderVariablesSection
        section.appendChild(this.paletteEntry(type));
      }
      this.palette.appendChild(section);
    }
    if (keepScroll) this.palette.scrollTop = top;
  }

  paletteEntry(type, values = {}) {
    const def = BLOCKS.get(type);
    const block = this.host.defaultBlock(type, this.target, values);
    const row = document.createElement('div');
    row.className = 'be-entry';
    if (def.monitor || type === 'data_variable') {
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'be-monitor';
      box.title = 'Show on the stage';
      box.setAttribute('aria-label', `Show ${def.label.replace(/%[A-Z_]+/g, '').trim() || values.VARIABLE} on the stage`);
      box.checked = this.host.monitorShown(block, this.target);
      box.addEventListener('change', () => this.host.setMonitor(block, this.target, box.checked));
      box.addEventListener('pointerdown', (e) => e.stopPropagation());
      row.appendChild(box);
    }
    const el = this.renderBlock(block, { palette: true });
    el.dataset.palette = '1';
    el._block = block;
    row.appendChild(el);
    return row;
  }

  renderVariablesSection(section) {
    const make = document.createElement('button');
    make.type = 'button';
    make.className = 'be-make';
    make.textContent = 'Make a Variable';
    make.addEventListener('click', () => this.host.makeVariable());
    section.appendChild(make);
    const names = this.host.variableNames(this.target);
    for (const name of names) section.appendChild(this.paletteEntry('data_variable', { VARIABLE: name }));
    if (!names.length) return;
    const first = names[0];
    for (const type of ['data_setvariableto', 'data_changevariableby', 'data_showvariable', 'data_hidevariable']) {
      section.appendChild(this.paletteEntry(type, { VARIABLE: first }));
    }
  }

  // --- drawing blocks ----------------------------------------------------------------------

  renderBlock(block, opts = {}) {
    const def = blockDef(block.type);
    const el = document.createElement('div');
    el._block = block;
    if (!def) {
      el.className = 'blk blk-stack blk-unknown';
      el.textContent = `unknown block "${block.type}"`;
      return el;
    }
    const cat = CATEGORIES[def.cat];
    el.className = `blk blk-${def.shape}${isCap(block) ? ' is-cap' : ''}`;
    el.style.setProperty('--fill', cat.fill);
    el.style.setProperty('--dark', cat.dark);
    el.dataset.id = block.id;
    const row = document.createElement('div');
    row.className = 'blk-row';
    this.fillRow(row, block, def, 'label', opts);
    el.appendChild(row);
    if (def.shape === 'c' || def.shape === 'c2') {
      el.appendChild(this.renderMouth(block, 'substack', opts));
      if (def.shape === 'c2') {
        const mid = document.createElement('div');
        mid.className = 'blk-row blk-mid';
        this.fillRow(mid, block, def, 'label2', opts);
        el.appendChild(mid);
        el.appendChild(this.renderMouth(block, 'substack2', opts));
      }
      const foot = document.createElement('div');
      foot.className = 'blk-foot';
      if (def.cap) foot.innerHTML = '<span class="blk-loop" aria-hidden="true">↻</span>';
      el.appendChild(foot);
    }
    return el;
  }

  renderMouth(block, slot, opts) {
    const mouth = document.createElement('div');
    mouth.className = 'blk-mouth';
    mouth._owner = block;
    mouth._slot = slot;
    const list = document.createElement('div');
    list.className = 'blk-list';
    list._list = block[slot];
    for (const child of block[slot] || []) list.appendChild(this.renderBlock(child, opts));
    mouth.appendChild(list);
    return mouth;
  }

  fillRow(row, block, def, which, opts) {
    for (const part of labelParts(def, which)) {
      if (part.text) {
        const span = document.createElement('span');
        span.className = 'blk-text';
        span.textContent = part.text.trim() ? part.text : ' ';
        if (part.text.trim()) row.appendChild(span);
        continue;
      }
      const name = part.input;
      if (name === 'FLAG' && def.icon === 'flag') {
        row.insertAdjacentHTML('beforeend', '<span class="blk-flag" aria-label="green flag">⚑</span>');
        continue;
      }
      const spec = def.inputs[name];
      if (!spec) continue;
      row.appendChild(this.renderInput(block, name, spec, opts));
    }
  }

  renderInput(block, name, spec, opts) {
    const input = block.inputs[name] || (block.inputs[name] = { value: spec.value ?? '' });
    if (input.block) {
      const child = this.renderBlock(input.block, opts);
      child.classList.add('blk-nested');
      child._parentInput = { block, name };
      return child;
    }
    const slot = document.createElement('span');
    slot._slot = { block, name, kind: spec.kind };
    if (spec.kind === 'boolean') {
      slot.className = 'in in-bool';
      return slot;
    }
    if (spec.kind === 'menu' || spec.kind === 'variable') {
      slot.className = `in in-menu${spec.kind === 'variable' ? ' in-var' : ''}`;
      slot.textContent = `${menuLabel(input.value) || ' '} ▾`;
      slot.setAttribute('role', 'button');
      slot.tabIndex = opts.palette ? -1 : 0;
      slot.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.openMenu(slot, block, name, spec);
      });
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openMenu(slot, block, name, spec); }
      });
      return slot;
    }
    if (spec.kind === 'color') {
      slot.className = 'in in-color';
      slot.style.background = String(input.value || '#000000');
      slot.title = 'Pick a colour';
      if (!opts.palette) {
        slot.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          const pick = document.createElement('input');
          pick.type = 'color';
          pick.value = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value : '#000000';
          pick.style.position = 'fixed';
          pick.style.opacity = '0';
          pick.style.left = `${e.clientX}px`;
          pick.style.top = `${e.clientY}px`;
          document.body.appendChild(pick);
          pick.addEventListener('input', () => { input.value = pick.value; slot.style.background = pick.value; });
          pick.addEventListener('change', () => { input.value = pick.value; this.changed('edit'); pick.remove(); });
          pick.addEventListener('blur', () => pick.remove());
          pick.click();
        });
      }
      return slot;
    }
    const field = document.createElement('input');
    field.type = 'text';
    field.className = `in in-${spec.kind === 'number' ? 'num' : 'text'}`;
    field.value = String(input.value ?? '');
    field.spellcheck = false;
    field.setAttribute('aria-label', name.toLowerCase());
    if (spec.kind === 'number') field.inputMode = 'decimal';
    size(field);
    field._slot = slot._slot;
    if (opts.palette) {
      // In the palette a slot shows its default; dragging the block out is how to use it.
      field.tabIndex = -1;
      field.readOnly = true;
      return field;
    }
    field.addEventListener('pointerdown', (e) => e.stopPropagation());
    field.addEventListener('input', () => {
      input.value = spec.kind === 'number' ? field.value.replace(/[^0-9eE.+-]/g, '') : field.value;
      if (spec.kind === 'number' && field.value !== input.value) field.value = input.value;
      size(field);
    });
    field.addEventListener('change', () => this.changed('edit'));
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') field.blur(); e.stopPropagation(); });
    return field;
  }

  // --- the script area ---------------------------------------------------------------------

  renderWorkspace() {
    this.canvas.innerHTML = '';
    const scripts = this.target?.scripts || [];
    let w = 1400;
    let h = 1000;
    for (const script of scripts) {
      const el = document.createElement('div');
      el.className = 'be-script';
      el.dataset.script = script.id;
      el.style.left = `${script.x}px`;
      el.style.top = `${script.y}px`;
      el._script = script;
      const list = document.createElement('div');
      list.className = 'blk-list blk-top';
      list._list = script.blocks;
      for (const block of script.blocks) list.appendChild(this.renderBlock(block));
      el.appendChild(list);
      this.canvas.appendChild(el);
      w = Math.max(w, script.x + 900);
      h = Math.max(h, script.y + 700);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.empty.hidden = scripts.length > 0;
    this.empty.innerHTML = this.target
      ? `<strong>Drag blocks here</strong> to make a script for <em>${escapeHtml(this.target.name)}</em>.<br>Start with <span class="be-hint-hat">when ⚑ clicked</span> from Events.`
      : '';
    this.markRunning();
  }

  markRunning() {
    for (const el of this.canvas.querySelectorAll('.be-script')) {
      el.classList.toggle('running', !!this.host.isRunning?.(el._script));
    }
  }

  // Lines every script up down the left, the way Scratch's "Clean up blocks" does.
  tidy() {
    let y = 20;
    for (const script of this.target?.scripts || []) {
      script.x = 20;
      script.y = y;
      const el = this.canvas.querySelector(`[data-script="${script.id}"]`);
      y += (el ? el.offsetHeight : 60) + 26;
    }
    this.renderWorkspace();
    this.changed('tidy');
  }

  changed(reason) {
    this.host.onChange?.(reason);
  }

  // --- menus -----------------------------------------------------------------------------------

  openMenu(anchor, block, name, spec) {
    this.closePopup();
    const options = spec.kind === 'variable'
      ? [...this.host.variableNames(this.target).map((v) => [v, v]), ['__rename__', 'Rename variable…'], ['__delete__', `Delete the "${block.inputs[name].value}" variable`]]
      : (Array.isArray(spec.options) ? spec.options.map((o) => [o, menuLabel(o)]) : this.host.menuOptions(spec.options, block, this.target));
    const pop = document.createElement('div');
    pop.className = 'be-popup';
    pop.setAttribute('role', 'listbox');
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `be-opt${value === block.inputs[name].value ? ' on' : ''}${String(value).startsWith('__') ? ' be-opt-action' : ''}`;
      b.textContent = label;
      b.addEventListener('click', async () => {
        this.closePopup();
        if (value === '__rename__') { await this.host.renameVariable(block.inputs[name].value); return; }
        if (value === '__delete__') { await this.host.deleteVariable(block.inputs[name].value); return; }
        if (value === '__newmessage__') {
          const made = await this.host.newMessage();
          if (!made) return;
          block.inputs[name].value = made;
        } else {
          block.inputs[name].value = value;
        }
        if (anchor.closest('[data-palette]')) this.renderPalette(true);
        else this.renderWorkspace();
        this.changed('edit');
      });
      pop.appendChild(b);
    }
    if (!options.length) pop.innerHTML = '<div class="be-opt-empty">Nothing to pick yet</div>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const ph = Math.min(320, pop.offsetHeight);
    const top = r.bottom + 4 + ph > window.innerHeight ? Math.max(4, r.top - ph - 4) : r.bottom + 4;
    pop.style.left = `${Math.min(window.innerWidth - pop.offsetWidth - 6, r.left)}px`;
    pop.style.top = `${top}px`;
    this.popup = pop;
    pop.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  closePopup() {
    this.popup?.remove();
    this.popup = null;
    this.ctxMenu?.remove();
    this.ctxMenu = null;
  }

  onContext(e) {
    e.preventDefault();
    this.closePopup();
    const blockEl = e.target.closest('.blk');
    const items = [];
    if (blockEl && !blockEl.closest('[data-palette]')) {
      const found = this.locate(blockEl);
      if (found) {
        items.push(['Duplicate', () => this.duplicateFrom(found, e)]);
        items.push(['Delete Block', () => { this.removeAt(found, true); this.renderWorkspace(); this.changed('delete'); }]);
      }
    }
    items.push(['Clean up Blocks', () => this.tidy()]);
    const menu = document.createElement('div');
    menu.className = 'be-popup be-context';
    for (const [label, fn] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'be-opt';
      b.textContent = label;
      b.addEventListener('click', () => { this.closePopup(); fn(); });
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    this.ctxMenu = menu;
    this.popup = menu;
  }

  duplicateFrom(found, e) {
    const blocks = found.kind === 'value' ? [cloneBlock(found.block)] : found.list.slice(found.index).map(cloneBlock);
    const [x, y] = this.toCanvas(e.clientX + 20, e.clientY + 20);
    this.target.scripts.push({ id: newId('s'), x, y, blocks });
    this.renderWorkspace();
    this.changed('duplicate');
  }

  // --- finding where a drawn block lives in the tree --------------------------------------------

  locate(el) {
    const block = el._block;
    if (!block) return null;
    if (el._parentInput) return { kind: 'value', block, parentInput: el._parentInput, script: this.scriptOf(el) };
    const listEl = el.parentElement;
    if (!listEl?._list) return null;
    const list = listEl._list;
    const index = list.indexOf(block);
    if (index < 0) return null;
    const def = blockDef(block.type);
    return { kind: isValueShape(def?.shape) ? 'loose-value' : 'stack', block, list, index, script: this.scriptOf(el) };
  }

  scriptOf(el) {
    return el.closest('.be-script')?._script || null;
  }

  // Takes a block out of the tree. A drag takes it and everything below it; "Delete Block" takes
  // just the one, and the blocks under it close up.
  removeAt(found, single = false) {
    if (found.kind === 'value') {
      const { block, name } = found.parentInput;
      const removed = block.inputs[name].block;
      delete block.inputs[name].block;
      return [removed];
    }
    const removed = single ? found.list.splice(found.index, 1) : found.list.splice(found.index);
    if (found.script && found.script.blocks.length === 0) {
      this.target.scripts = this.target.scripts.filter((s) => s !== found.script);
    }
    return removed;
  }

  // --- dragging --------------------------------------------------------------------------------

  onPalettePointer(e) {
    if (e.button > 0) return;
    const el = e.target.closest('[data-palette]');
    if (!el || e.target.closest('.be-monitor, .in-menu')) return;
    e.preventDefault();
    this.drag = { phase: 'pending', from: 'palette', el, block: el._block, x0: e.clientX, y0: e.clientY, id: e.pointerId };
  }

  onCanvasPointer(e) {
    if (e.button > 0) return;
    if (e.target.closest('input, .in-menu, .in-color')) return;
    const el = e.target.closest('.blk');
    if (!el) return;
    e.preventDefault();
    this.drag = { phase: 'pending', from: 'workspace', el, x0: e.clientX, y0: e.clientY, id: e.pointerId };
  }

  onMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (d.phase === 'pending') {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      this.beginDrag(e);
    }
    if (d.phase !== 'dragging') return;
    d.ghost.style.left = `${e.clientX - d.dx}px`;
    d.ghost.style.top = `${e.clientY - d.dy}px`;
    this.showDrop(this.findDrop(e));
  }

  beginDrag(e) {
    const d = this.drag;
    let blocks;
    let kind;
    if (d.from === 'palette') {
      const block = cloneBlock(d.block);
      blocks = [block];
      kind = isValueShape(blockDef(block.type).shape) ? 'value' : 'stack';
    } else {
      const found = this.locate(d.el);
      if (!found) { this.drag = null; return; }
      // Dragging the top block of a script moves the whole script, which keeps its identity (and so
      // its glow while it runs).
      if (found.script && found.list === found.script.blocks && found.index === 0) d.movingScript = found.script;
      blocks = this.removeAt(found);
      kind = found.kind === 'stack' ? 'stack' : 'value';
      d.origin = found;
    }
    const r = d.el.getBoundingClientRect();
    d.dx = (e.clientX - r.left);
    d.dy = (e.clientY - r.top);
    d.blocks = blocks;
    d.kind = kind;
    d.phase = 'dragging';
    const ghost = document.createElement('div');
    ghost.className = 'be-ghost';
    ghost.style.transform = `scale(${this.zoom})`;
    const list = document.createElement('div');
    list.className = 'blk-list';
    for (const b of blocks) list.appendChild(this.renderBlock(b));
    ghost.appendChild(list);
    document.body.appendChild(ghost);
    d.ghost = ghost;
    if (d.from === 'workspace') this.renderWorkspace();
    this.root.classList.add('be-dragging');
  }

  onUp(e, cancelled = false) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (d.phase === 'pending') {
      // A click, not a drag: run it.
      if (cancelled) return;
      if (d.from === 'palette') this.host.onRunBlock?.(d.block, d.el);
      else {
        const script = this.scriptOf(d.el);
        if (script) this.host.onRunScript?.(script, d.el);
      }
      return;
    }
    d.ghost.remove();
    this.root.classList.remove('be-dragging');
    this.showDrop(null);
    const overPalette = this.isOver(this.palette, e) || this.isOver(this.cats, e);
    if (cancelled) {
      if (d.from === 'workspace') this.putBack(d);
      this.renderWorkspace();
      return;
    }
    if (overPalette || !this.isOver(this.workspace, e)) {
      // Dropped on the palette (or off the editor): gone, as in Scratch.
      this.renderWorkspace();
      if (d.from === 'workspace') this.changed('delete');
      return;
    }
    const drop = this.findDrop(e, d);
    if (drop) this.applyDrop(drop, d);
    else {
      const [x, y] = this.toCanvas(e.clientX - d.dx, e.clientY - d.dy);
      const script = d.movingScript || { id: newId('s') };
      Object.assign(script, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), blocks: d.blocks });
      this.target.scripts.push(script);
    }
    this.renderWorkspace();
    this.changed(d.from === 'palette' ? 'add' : 'move');
  }

  putBack(d) {
    const o = d.origin;
    if (!o) return;
    if (o.kind === 'value') o.parentInput.block.inputs[o.parentInput.name].block = d.blocks[0];
    else {
      o.list.splice(o.index, 0, ...d.blocks);
      if (o.script && !this.target.scripts.includes(o.script)) this.target.scripts.push(o.script);
    }
  }

  isOver(el, e) {
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  toCanvas(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [(clientX - r.left) / this.zoom, (clientY - r.top) / this.zoom];
  }

  // Every place the dragged blocks could join, measured off the drawn blocks, and the nearest one.
  findDrop(e, given = null) {
    const d = given || this.drag;
    if (!d || !d.blocks) return null;
    const gx = e.clientX - d.dx;
    const gy = e.clientY - d.dy;
    const snap = SNAP * this.zoom;
    if (d.kind === 'value') {
      const shape = blockDef(d.blocks[0].type).shape;
      let best = null;
      for (const el of this.canvas.querySelectorAll('.in')) {
        const slot = el._slot;
        if (!slot || slot.kind === 'menu' || slot.kind === 'variable') continue;
        if (slot.kind === 'boolean' && shape !== 'boolean') continue;
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(gx - r.left, gy + (d.ghost?.offsetHeight || 20) * this.zoom / 2 - (r.top + r.height / 2));
        if (dist < snap * 1.3 && (!best || dist < best.dist)) best = { kind: 'slot', slot, el, dist };
      }
      return best;
    }
    const first = d.blocks[0];
    const last = d.blocks[d.blocks.length - 1];
    const draggingHat = blockDef(first.type)?.shape === 'hat';
    const draggingCap = isCap(last);
    let best = null;
    const consider = (cand) => { if (cand.dist < snap && (!best || cand.dist < best.dist)) best = cand; };
    if (!draggingHat) {
      for (const el of this.canvas.querySelectorAll('.blk')) {
        if (el.classList.contains('blk-nested')) continue;
        const def = blockDef(el._block?.type);
        if (!def || isValueShape(def.shape)) continue;
        const listEl = el.parentElement;
        if (!listEl?._list) continue;
        const r = el.getBoundingClientRect();
        // After this block.
        if (!isCap(el._block)) {
          const isLast = listEl._list[listEl._list.length - 1] === el._block;
          if (!draggingCap || isLast) {
            const top = def.shape === 'c' || def.shape === 'c2' ? r.bottom : r.bottom;
            consider({ kind: 'after', list: listEl._list, block: el._block, x: r.left, y: top, dist: Math.hypot(gx - r.left, gy - top), el });
          }
        }
        // Into a mouth.
        for (const mouth of el.querySelectorAll(':scope > .blk-mouth')) {
          const mr = mouth.getBoundingClientRect();
          const list = mouth._owner[mouth._slot];
          if (draggingCap && list.length) continue;
          consider({ kind: 'mouth', owner: mouth._owner, slot: mouth._slot, x: mr.left, y: mr.top, dist: Math.hypot(gx - mr.left, gy - mr.top), el: mouth });
        }
      }
    }
    // On top of a script.
    if (!draggingCap) {
      for (const el of this.canvas.querySelectorAll('.be-script')) {
        const script = el._script;
        const top = script.blocks[0];
        if (!top || blockDef(top.type)?.shape === 'hat' || isValueShape(blockDef(top.type)?.shape)) continue;
        const r = el.getBoundingClientRect();
        const h = (d.ghost?.offsetHeight || 30) * this.zoom;
        consider({ kind: 'above', script, x: r.left, y: r.top - h, dist: Math.hypot(gx - r.left, gy + h - r.top), el });
      }
    }
    return best;
  }

  showDrop(drop) {
    this.marker?.remove();
    this.marker = null;
    this.canvas.querySelectorAll('.in.drop-here').forEach((el) => el.classList.remove('drop-here'));
    if (!drop) return;
    if (drop.kind === 'slot') { drop.el.classList.add('drop-here'); return; }
    const m = document.createElement('div');
    m.className = 'be-drop-line';
    const r = this.workspace.getBoundingClientRect();
    m.style.left = `${drop.x - r.left + this.workspace.scrollLeft}px`;
    m.style.top = `${drop.y - r.top + this.workspace.scrollTop - 2}px`;
    this.workspace.appendChild(m);
    this.marker = m;
  }

  applyDrop(drop, d) {
    if (drop.kind === 'slot') {
      drop.slot.block.inputs[drop.slot.name].block = d.blocks[0];
      return;
    }
    if (drop.kind === 'after') {
      const at = drop.list.indexOf(drop.block);
      drop.list.splice(at + 1, 0, ...d.blocks);
      return;
    }
    if (drop.kind === 'mouth') {
      drop.owner[drop.slot].unshift(...d.blocks);
      return;
    }
    if (drop.kind === 'above') {
      const h = (d.ghost?.offsetHeight || 30);
      drop.script.blocks.unshift(...d.blocks);
      drop.script.y = Math.max(0, drop.script.y - h);
    }
  }
}

function size(field) {
  field.style.width = `calc(${Math.max(1, String(field.value).length)}ch + 18px)`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { createBlock };
