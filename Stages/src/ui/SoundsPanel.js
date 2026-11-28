// The Sounds tab: the selected sprite's (or the stage's) sounds, a picture of each one's waveform,
// and a few simple effects. Each effect makes a NEW sound file from the old one, so an asset never
// changes once made.
//
// There is no record button (decision E). Sounds come from the generated library or an upload.
import { assetById, uniqueName } from '../project/Project.js';
import { loadSound, soundNow, soundReady } from '../project/assets.js';
import { soundFromBuffer } from '../library/libraryAdd.js';
import { el, escapeHtml, toast } from './dialogs.js';

const EFFECTS = [
  ['louder', 'Louder'], ['softer', 'Softer'], ['faster', 'Faster'], ['slower', 'Slower'],
  ['reverse', 'Reverse'], ['fadein', 'Fade in'], ['fadeout', 'Fade out'], ['echo', 'Echo'],
];

export class SoundsPanel {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.target = null;
    this.sound = null;
    root.classList.add('sp');
    root.innerHTML = `
      <div class="sp-list" aria-label="Sounds"></div>
      <div class="sp-main">
        <div class="sp-top"><label class="ce-name">Sound <input type="text" maxlength="40"></label>
          <button type="button" class="btn btn-primary sp-play">▶ Play</button></div>
        <canvas class="sp-wave" width="640" height="180"></canvas>
        <div class="sp-effects"></div>
        <p class="sp-note">Use <strong>start sound</strong> or <strong>play sound until done</strong> in the Sound blocks to play it from a script.</p>
      </div>`;
    this.list = root.querySelector('.sp-list');
    this.wave = root.querySelector('.sp-wave');
    this.nameInput = root.querySelector('.sp-top input');
    this.nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    this.nameInput.addEventListener('change', () => this.rename());
    root.querySelector('.sp-play').addEventListener('click', () => this.play());
    const fx = root.querySelector('.sp-effects');
    for (const [key, label] of EFFECTS) {
      fx.appendChild(el('button', { type: 'button', class: 'btn btn-small', text: label, onclick: () => this.effect(key) }));
    }
  }

  show(target) {
    this.target = target;
    this.select(target.sounds[0] || null);
  }

  renderList() {
    const t = this.target;
    this.list.innerHTML = '';
    t.sounds.forEach((s, i) => {
      const item = el('div', { class: `ce-item${s === this.sound ? ' on' : ''}`, role: 'button', tabindex: '0' });
      item.innerHTML = `<span class="ce-num">${i + 1}</span><span class="sp-icon">🔊</span><span class="ce-item-name">${escapeHtml(s.name)}</span><span class="sp-len">${(s.duration || 0).toFixed(2)}s</span>`;
      const del = el('button', { type: 'button', class: 'ce-del', 'aria-label': `Delete ${s.name}`, title: 'Delete', text: '×' });
      item.appendChild(del);
      item.addEventListener('click', (e) => { if (e.target !== del) this.select(s); });
      del.addEventListener('click', () => {
        t.sounds.splice(t.sounds.indexOf(s), 1);
        this.app.pruneSoon();
        this.app.changed('sound');
        this.select(t.sounds[0] || null);
      });
      this.list.appendChild(item);
    });
    const add = el('div', { class: 'ce-add' });
    add.append(
      el('button', { type: 'button', class: 'btn btn-small', text: '🔍 Choose', title: 'Choose a sound from the library', onclick: () => this.app.addSoundFromLibrary() }),
      el('button', { type: 'button', class: 'btn btn-small', text: '⬆ Upload', title: 'Upload a sound file', onclick: () => this.app.uploadSound(this.target) }),
    );
    this.list.appendChild(add);
  }

  async select(sound) {
    this.sound = sound;
    this.renderList();
    this.nameInput.value = sound?.name || '';
    this.root.querySelector('.sp-main').classList.toggle('sp-empty', !sound);
    const ctx = this.wave.getContext('2d');
    ctx.clearRect(0, 0, this.wave.width, this.wave.height);
    if (!sound) return;
    const asset = assetById(this.app.project, sound.assetId);
    const buf = soundNow(sound.assetId) || (asset ? await soundReady(asset).catch(() => null) : null);
    if (!buf || this.sound !== sound) return;
    drawWave(ctx, buf, this.wave.width, this.wave.height);
  }

  async play() {
    if (!this.sound) return;
    const asset = assetById(this.app.project, this.sound.assetId);
    const buf = soundNow(this.sound.assetId) || (asset ? await loadSound(asset) : null);
    if (buf) this.app.audio.preview(buf);
  }

  rename() {
    const s = this.sound;
    if (!s) return;
    const final = uniqueName(this.nameInput.value.trim() || s.name, this.target.sounds.filter((x) => x !== s).map((x) => x.name));
    this.app.renameSoundInScripts(this.target, s.name, final);
    s.name = final;
    this.nameInput.value = final;
    this.renderList();
    this.app.changed('sound');
  }

  async effect(kind) {
    const s = this.sound;
    if (!s) return;
    const asset = assetById(this.app.project, s.assetId);
    const src = soundNow(s.assetId) || (asset ? await soundReady(asset) : null);
    if (!src) { toast('That sound could not be read.'); return; }
    const out = await applyEffect(src, kind);
    const made = await soundFromBuffer(this.app.project, out, s.name);
    s.assetId = made.assetId;
    s.duration = made.duration;
    this.app.pruneSoon();
    this.app.changed('sound');
    this.select(s);
  }
}

function drawWave(ctx, buf, w, h) {
  const d = buf.getChannelData(0);
  ctx.fillStyle = '#f4f0ff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#cf63cf';
  const step = Math.max(1, Math.floor(d.length / w));
  for (let x = 0; x < w; x++) {
    let max = 0;
    for (let i = x * step; i < (x + 1) * step && i < d.length; i++) max = Math.max(max, Math.abs(d[i]));
    const bar = Math.max(1, max * (h - 10));
    ctx.fillRect(x, (h - bar) / 2, 1, bar);
  }
}

async function applyEffect(src, kind) {
  const rate = src.sampleRate;
  const speed = kind === 'faster' ? 1.25 : kind === 'slower' ? 0.8 : 1;
  const extra = kind === 'echo' ? 0.6 : 0;
  const length = Math.ceil((src.duration / speed + extra) * rate);
  const ctx = new OfflineAudioContext({ numberOfChannels: src.numberOfChannels, length: Math.max(1, length), sampleRate: rate });
  let buffer = src;
  if (kind === 'reverse') {
    buffer = ctx.createBuffer(src.numberOfChannels, src.length, rate);
    for (let c = 0; c < src.numberOfChannels; c++) buffer.getChannelData(c).set(Float32Array.from(src.getChannelData(c)).reverse());
  }
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.playbackRate.value = speed;
  const g = ctx.createGain();
  const dur = src.duration / speed;
  if (kind === 'louder') g.gain.value = 1.6;
  else if (kind === 'softer') g.gain.value = 0.6;
  else if (kind === 'fadein') { g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(1, Math.max(0.05, dur)); }
  else if (kind === 'fadeout') { g.gain.setValueAtTime(1, 0); g.gain.exponentialRampToValueAtTime(0.0001, Math.max(0.05, dur)); }
  node.connect(g).connect(ctx.destination);
  if (kind === 'echo') {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.22;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    g.connect(delay).connect(fb).connect(ctx.destination);
    fb.connect(delay);
  }
  node.start();
  return ctx.startRendering();
}
