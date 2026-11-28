// The Costumes tab (Backdrops when the stage is selected): the list of costumes, and a paint editor.
//
// Painting happens on a canvas the size of the costume's own picture. Each finished stroke is saved
// back as a NEW asset (an asset never changes once made, which is what lets every cache key on its
// id), keeping the costume's id, name and rotation centre.
import { costumeFromBlob, imageNow, loadImage } from '../project/assets.js';
import { newId } from '../blocks/make.js';
import { assetById, uniqueName } from '../project/Project.js';
import { el, escapeHtml, promptText, toast } from './dialogs.js';

const SWATCHES = ['#000000', '#575e75', '#ffffff', '#e6194b', '#ff8c1a', '#ffd400', '#3cb44b', '#0fbd8c', '#4c97ff', '#4363d8',
  '#9966ff', '#f032e6', '#8b5a2b', '#ffc0cb', '#a0e7ff'];
const TOOLS = [['brush', '🖌️', 'Brush'], ['eraser', '🧽', 'Eraser'], ['line', '╱', 'Line'], ['rect', '▭', 'Rectangle'],
  ['ellipse', '◯', 'Circle'], ['fill', '🪣', 'Fill'], ['text', 'T', 'Text'], ['centre', '✛', 'Set the centre']];

export class CostumeEditor {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.tool = 'brush';
    this.colour = '#4c97ff';
    this.size = 8;
    this.filled = true;
    this.undo = [];
    this.target = null;
    this.costume = null;
    root.classList.add('ce');
    root.innerHTML = `
      <div class="ce-list" aria-label="Costumes"></div>
      <div class="ce-main">
        <div class="ce-top">
          <label class="ce-name">Name <input type="text" maxlength="40"></label>
          <div class="ce-actions">
            <button type="button" class="btn btn-small" data-act="undo" title="Undo">↶ Undo</button>
            <button type="button" class="btn btn-small" data-act="flip" title="Flip left to right">⇋ Flip</button>
            <button type="button" class="btn btn-small" data-act="clear" title="Clear">Clear</button>
          </div>
        </div>
        <div class="ce-tools" role="toolbar" aria-label="Paint tools"></div>
        <div class="ce-paint"><div class="ce-stagebox"><canvas class="ce-canvas"></canvas><div class="ce-centre" aria-hidden="true"></div></div></div>
        <div class="ce-colours">
          <div class="ce-swatches"></div>
          <label class="ce-pick">Colour <input type="color"></label>
          <label class="ce-size">Size <input type="range" min="1" max="60"></label>
          <label class="ce-fill"><input type="checkbox" checked> Filled shapes</label>
        </div>
      </div>`;
    this.list = root.querySelector('.ce-list');
    this.canvas = root.querySelector('.ce-canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.nameInput = root.querySelector('.ce-name input');
    this.centreMark = root.querySelector('.ce-centre');
    const tools = root.querySelector('.ce-tools');
    for (const [key, icon, label] of TOOLS) {
      const b = el('button', { type: 'button', class: `ce-tool${key === this.tool ? ' on' : ''}`, title: label, 'aria-label': label, html: `<span>${icon}</span><small>${label}</small>` });
      b.dataset.tool = key;
      b.addEventListener('click', () => this.setTool(key));
      tools.appendChild(b);
    }
    const sw = root.querySelector('.ce-swatches');
    for (const c of SWATCHES) {
      const b = el('button', { type: 'button', class: 'ce-swatch', title: c, 'aria-label': `Colour ${c}` });
      b.style.background = c;
      b.addEventListener('click', () => this.setColour(c));
      sw.appendChild(b);
    }
    this.pick = root.querySelector('.ce-pick input');
    this.pick.addEventListener('input', () => this.setColour(this.pick.value));
    const sizeInput = root.querySelector('.ce-size input');
    sizeInput.value = this.size;
    sizeInput.addEventListener('input', () => { this.size = Number(sizeInput.value); });
    root.querySelector('.ce-fill input').addEventListener('change', (e) => { this.filled = e.target.checked; });
    root.querySelector('.ce-actions').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'undo') this.doUndo();
      if (act === 'flip') this.flip();
      if (act === 'clear') this.clear();
    });
    this.nameInput.addEventListener('change', () => this.rename());
    this.nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    this.setColour(this.colour);
  }

  setTool(key) {
    this.tool = key;
    this.root.querySelectorAll('.ce-tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === key));
    this.canvas.style.cursor = key === 'centre' ? 'crosshair' : 'crosshair';
  }

  setColour(c) {
    this.colour = c;
    this.pick.value = c;
    this.root.querySelectorAll('.ce-swatch').forEach((b) => b.classList.toggle('on', b.title === c));
  }

  show(target) {
    this.target = target;
    const i = Math.min(target.currentCostume, target.costumes.length - 1);
    this.renderList();
    this.select(target.costumes[Math.max(0, i)] || null);
  }

  renderList() {
    const t = this.target;
    this.list.innerHTML = '';
    t.costumes.forEach((c, i) => {
      const item = el('div', { class: `ce-item${c === this.costume ? ' on' : ''}`, role: 'button', tabindex: '0' });
      item.innerHTML = `<span class="ce-num">${i + 1}</span><canvas width="72" height="56"></canvas><span class="ce-item-name">${escapeHtml(c.name)}</span>`;
      const del = el('button', { type: 'button', class: 'ce-del', 'aria-label': `Delete ${c.name}`, title: 'Delete', text: '×' });
      const dup = el('button', { type: 'button', class: 'ce-dup', 'aria-label': `Duplicate ${c.name}`, title: 'Duplicate', text: '⧉' });
      item.append(dup, del);
      drawThumb(item.querySelector('canvas'), c);
      item.addEventListener('click', (e) => {
        if (e.target === del || e.target === dup) return;
        t.currentCostume = i;
        this.select(c);
        this.app.changed('costume');
      });
      del.addEventListener('click', () => this.remove(c));
      dup.addEventListener('click', () => this.duplicate(c));
      this.list.appendChild(item);
    });
    const add = el('div', { class: 'ce-add' });
    const label = t.isStage ? 'Backdrop' : 'Costume';
    add.append(
      el('button', { type: 'button', class: 'btn btn-small', text: `🖌️ Paint`, title: `Paint a new ${label.toLowerCase()}`, onclick: () => this.paintNew() }),
      el('button', { type: 'button', class: 'btn btn-small', text: `🔍 Choose`, title: `Choose a ${label.toLowerCase()} from the library`, onclick: () => (t.isStage ? this.app.addBackdropFromLibrary() : this.app.addCostumeFromLibrary()) }),
      el('button', { type: 'button', class: 'btn btn-small', text: `⬆ Upload`, title: `Upload a picture`, onclick: () => this.app.uploadCostume(t) }),
    );
    this.list.appendChild(add);
  }

  async select(costume) {
    this.costume = costume;
    this.undo = [];
    this.renderList();
    this.nameInput.value = costume?.name || '';
    if (!costume) {
      this.canvas.width = 1;
      this.canvas.height = 1;
      return;
    }
    const asset = assetById(this.app.project, costume.assetId);
    const img = imageNow(costume.assetId) || (asset ? await loadImage(asset).catch(() => null) : null);
    if (this.costume !== costume) return;
    this.canvas.width = costume.width;
    this.canvas.height = costume.height;
    this.ctx.clearRect(0, 0, costume.width, costume.height);
    if (img) this.ctx.drawImage(img, 0, 0);
    this.fit();
    this.placeCentre();
  }

  // The painting is shown as large as fits, keeping its shape.
  fit() {
    const box = this.root.querySelector('.ce-paint');
    const bw = Math.max(120, box.clientWidth - 24);
    const bh = Math.max(120, box.clientHeight - 24);
    const k = Math.min(bw / this.canvas.width, bh / this.canvas.height, 4);
    this.canvas.style.width = `${Math.round(this.canvas.width * k)}px`;
    this.canvas.style.height = `${Math.round(this.canvas.height * k)}px`;
    this.k = k;
  }

  placeCentre() {
    const c = this.costume;
    if (!c || this.target.isStage) { this.centreMark.hidden = true; return; }
    this.centreMark.hidden = false;
    this.centreMark.style.left = `${c.cx * this.k}px`;
    this.centreMark.style.top = `${c.cy * this.k}px`;
  }

  xy(e) {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.canvas.width, ((e.clientY - r.top) / r.height) * this.canvas.height];
  }

  snapshot() {
    this.undo.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    if (this.undo.length > 25) this.undo.shift();
  }

  down(e) {
    if (!this.costume) return;
    e.preventDefault();
    this.canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = this.xy(e);
    if (this.tool === 'centre') {
      this.costume.cx = Math.round(x);
      this.costume.cy = Math.round(y);
      this.placeCentre();
      this.app.changed('costume');
      return;
    }
    this.snapshot();
    if (this.tool === 'fill') { floodFill(this.ctx, Math.floor(x), Math.floor(y), this.colour); this.commit(); return; }
    if (this.tool === 'text') { this.placeText(x, y); return; }
    this.stroke = { x0: x, y0: y, x, y, base: this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height) };
    if (this.tool === 'brush' || this.tool === 'eraser') this.dab(x, y, x, y);
  }

  move(e) {
    if (!this.stroke) return;
    const [x, y] = this.xy(e);
    const s = this.stroke;
    if (this.tool === 'brush' || this.tool === 'eraser') {
      this.dab(s.x, s.y, x, y);
      s.x = x;
      s.y = y;
      return;
    }
    this.ctx.putImageData(s.base, 0, 0);
    this.shape(s.x0, s.y0, x, y);
  }

  up() {
    if (!this.stroke) return;
    this.stroke = null;
    this.commit();
  }

  dab(x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = this.colour;
    ctx.lineWidth = this.size * (this.canvas.width / 240);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 + 0.01, y1);
    ctx.stroke();
    ctx.restore();
  }

  shape(x0, y0, x1, y1) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.colour;
    ctx.fillStyle = this.colour;
    ctx.lineWidth = this.size * (this.canvas.width / 240);
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (this.tool === 'line') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (this.tool === 'rect') {
      ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      if (this.filled) ctx.fill(); else ctx.stroke();
    } else if (this.tool === 'ellipse') {
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2 || 0.5, Math.abs(y1 - y0) / 2 || 0.5, 0, 0, Math.PI * 2);
      if (this.filled) ctx.fill(); else ctx.stroke();
    }
    ctx.restore();
  }

  async placeText(x, y) {
    const text = await promptText('Add words', { label: 'What should it say?', ok: 'Add' });
    if (!text) { this.undo.pop(); return; }
    this.ctx.fillStyle = this.colour;
    this.ctx.font = `700 ${Math.round(this.size * 4 * (this.canvas.width / 240))}px system-ui, sans-serif`;
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, x, y);
    this.commit();
  }

  doUndo() {
    const prev = this.undo.pop();
    if (!prev) return;
    this.ctx.putImageData(prev, 0, 0);
    this.commit();
  }

  flip() {
    if (!this.costume) return;
    this.snapshot();
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext('2d').drawImage(this.canvas, 0, 0);
    this.ctx.clearRect(0, 0, copy.width, copy.height);
    this.ctx.save();
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(copy, -copy.width, 0);
    this.ctx.restore();
    this.costume.cx = this.canvas.width - this.costume.cx;
    this.placeCentre();
    this.commit();
  }

  clear() {
    if (!this.costume) return;
    this.snapshot();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.target.isStage) { this.ctx.fillStyle = '#ffffff'; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    this.commit();
  }

  // Saves the painting back into the costume, a moment after the last stroke.
  commit() {
    clearTimeout(this.commitTimer);
    const costume = this.costume;
    const target = this.target;
    this.commitTimer = setTimeout(async () => {
      const blob = await new Promise((r) => this.canvas.toBlob(r, 'image/png'));
      const made = await costumeFromBlob(this.app.project, blob, costume.name, { resolution: costume.resolution, cx: costume.cx, cy: costume.cy });
      costume.assetId = made.assetId;
      costume.width = made.width;
      costume.height = made.height;
      this.app.pruneSoon();
      this.app.changed('costume');
      if (this.target === target) this.renderList();
    }, 250);
  }

  rename() {
    const c = this.costume;
    if (!c) return;
    const name = this.nameInput.value.trim() || c.name;
    const taken = this.target.costumes.filter((x) => x !== c).map((x) => x.name);
    const final = uniqueName(name, taken);
    // Blocks that switch to this costume by name follow the rename.
    this.app.renameCostumeInScripts(this.target, c.name, final);
    c.name = final;
    this.nameInput.value = final;
    this.renderList();
    this.app.changed('costume');
  }

  async paintNew() {
    const t = this.target;
    const canvas = document.createElement('canvas');
    canvas.width = t.isStage ? 960 : 240;
    canvas.height = t.isStage ? 720 : 240;
    if (t.isStage) { const g = canvas.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 960, 720); }
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const name = uniqueName(t.isStage ? 'backdrop1' : 'costume1', t.costumes.map((c) => c.name));
    const costume = await costumeFromBlob(this.app.project, blob, name, { resolution: 2 });
    t.costumes.push(costume);
    t.currentCostume = t.costumes.length - 1;
    this.app.changed('costume');
    this.show(t);
  }

  duplicate(c) {
    const t = this.target;
    const copy = { ...c, id: newId('c'), name: uniqueName(c.name, t.costumes.map((x) => x.name)) };
    t.costumes.splice(t.costumes.indexOf(c) + 1, 0, copy);
    this.app.changed('costume');
    this.renderList();
  }

  remove(c) {
    const t = this.target;
    if (t.costumes.length <= 1) { toast(`A ${t.isStage ? 'stage needs at least one backdrop' : 'sprite needs at least one costume'}.`); return; }
    const i = t.costumes.indexOf(c);
    t.costumes.splice(i, 1);
    if (t.currentCostume >= t.costumes.length) t.currentCostume = t.costumes.length - 1;
    this.app.pruneSoon();
    this.app.changed('costume');
    this.show(t);
  }
}

export function drawThumb(canvas, costume) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const img = costume && imageNow(costume.assetId);
  if (!img) return;
  const k = Math.min(canvas.width / img.width, canvas.height / img.height);
  const w = img.width * k;
  const h = img.height * k;
  ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function floodFill(ctx, x, y, hex) {
  const { width: w, height: h } = ctx.canvas;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = parseInt(hex.slice(1), 16);
  const fill = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  const at = (y * w + x) * 4;
  const target = [d[at], d[at + 1], d[at + 2], d[at + 3]];
  const close = (i) => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) < 60;
  if (fill.every((v, i) => v === target[i])) return;
  const stack = [[x, y]];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const [px, py] = stack.pop();
    let lx = px;
    while (lx >= 0 && !seen[py * w + lx] && close((py * w + lx) * 4)) lx--;
    lx++;
    let rx = px;
    while (rx < w && !seen[py * w + rx] && close((py * w + rx) * 4)) rx++;
    for (let i = lx; i < rx; i++) {
      const k = (py * w + i) * 4;
      d[k] = fill[0]; d[k + 1] = fill[1]; d[k + 2] = fill[2]; d[k + 3] = fill[3];
      seen[py * w + i] = 1;
      if (py > 0 && !seen[(py - 1) * w + i] && close(((py - 1) * w + i) * 4)) stack.push([i, py - 1]);
      if (py < h - 1 && !seen[(py + 1) * w + i] && close(((py + 1) * w + i) * 4)) stack.push([i, py + 1]);
    }
  }
  ctx.putImageData(img, 0, 0);
}
