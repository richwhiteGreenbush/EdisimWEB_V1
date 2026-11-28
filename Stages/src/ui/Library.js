// The three libraries: Choose a Sprite, Choose a Backdrop and Choose a Sound.
//
// Sprites come from two places (decision D): the free cartoon characters, and Edusim's own Model
// Database, whose models are photographed into costumes when one is chosen.
import { CARTOON_SPRITES } from '../library/cartoons.js';
import { BACKDROPS, BACKDROP_TAGS } from '../library/backdrops.js';
import { ALL_LIBRARY_SOUNDS, renderLibrarySound } from '../audio/soundLibrary.js';
import { modelCatalog, modelThumb } from '../library/libraryAdd.js';
import { el, escapeHtml, modal } from './dialogs.js';

const SPRITE_TAGS = [['all', 'All'], ['people', 'People'], ['animals', 'Animals'], ['games', 'Games'], ['space', 'Space'],
  ['things', 'Things'], ['scenery', 'Scenery'], ['models', 'Edusim Models']];

function grid(body, { tags, initialTag = 'all', items, render, search }) {
  body.innerHTML = '';
  const bar = el('div', { class: 'lib-bar' });
  const box = el('input', { type: 'search', class: 'lib-search', placeholder: 'Search', 'aria-label': 'Search the library' });
  const tabs = el('div', { class: 'lib-tags', role: 'tablist' });
  bar.append(box, tabs);
  const list = el('div', { class: 'lib-grid' });
  body.append(bar, list);
  let tag = initialTag;
  const draw = async () => {
    list.innerHTML = '';
    const q = box.value.trim().toLowerCase();
    const shown = await items(tag, q);
    if (!shown.length) list.innerHTML = '<p class="lib-none">Nothing matches that.</p>';
    for (const item of shown) list.appendChild(render(item));
  };
  for (const [key, label] of tags) {
    const b = el('button', { type: 'button', class: `lib-tag${key === tag ? ' on' : ''}`, text: label, role: 'tab' });
    b.addEventListener('click', () => {
      tag = key;
      tabs.querySelectorAll('.lib-tag').forEach((t) => t.classList.toggle('on', t === b));
      draw();
    });
    tabs.appendChild(b);
  }
  box.addEventListener('input', () => draw());
  box.addEventListener('keydown', (e) => e.stopPropagation());
  if (search) box.value = search;
  draw();
  setTimeout(() => box.focus(), 0);
}

const matches = (q, ...texts) => !q || texts.some((t) => String(t || '').toLowerCase().includes(q));

// Resolves with { kind: 'cartoon', entry } or { kind: 'model', entry }, or null.
export function chooseSprite() {
  return modal('Choose a Sprite', (body, close) => {
    grid(body, {
      tags: SPRITE_TAGS,
      async items(tag, q) {
        if (tag === 'models' || (tag === 'all' && q)) {
          const { MODELS } = await modelCatalog();
          const models = MODELS.filter((m) => matches(q, m.title, ...(m.aliases || []), ...(m.subjects || [])))
            .map((m) => ({ kind: 'model', entry: m }));
          if (tag === 'models') return models;
          const cartoons = CARTOON_SPRITES.filter((s) => matches(q, s.name, ...s.tags)).map((s) => ({ kind: 'cartoon', entry: s }));
          return [...cartoons, ...models.slice(0, 60)];
        }
        return CARTOON_SPRITES.filter((s) => (tag === 'all' || s.tags.includes(tag)) && matches(q, s.name, ...s.tags))
          .map((s) => ({ kind: 'cartoon', entry: s }));
      },
      render(item) {
        const card = el('button', { type: 'button', class: 'lib-card' });
        if (item.kind === 'model') {
          card.innerHTML = `<span class="lib-pic"><img loading="lazy" alt="" src="${modelThumb(item.entry.id)}"></span><span class="lib-name">${escapeHtml(item.entry.title)}</span><span class="lib-badge">3D model</span>`;
        } else {
          const first = item.entry.costumes[0].file;
          card.innerHTML = `<span class="lib-pic"><img loading="lazy" alt="" src="${first}"></span><span class="lib-name">${escapeHtml(item.entry.name)}</span>`;
          // Hovering plays through the costumes, so a walk cycle shows itself.
          let timer = null;
          let i = 0;
          const img = card.querySelector('img');
          card.addEventListener('pointerenter', () => {
            if (item.entry.costumes.length < 2) return;
            timer = setInterval(() => { i = (i + 1) % Math.min(9, item.entry.costumes.length); img.src = item.entry.costumes[i].file; }, 160);
          });
          card.addEventListener('pointerleave', () => { clearInterval(timer); img.src = first; i = 0; });
        }
        card.addEventListener('click', () => close(item));
        return card;
      },
    });
  }, { wide: true, className: 'lib-modal' });
}

export function chooseBackdrop() {
  return modal('Choose a Backdrop', (body, close) => {
    grid(body, {
      tags: BACKDROP_TAGS,
      async items(tag, q) {
        return BACKDROPS.filter((b) => (tag === 'all' || b.tags.includes(tag)) && matches(q, b.name, ...b.tags));
      },
      render(entry) {
        const card = el('button', { type: 'button', class: 'lib-card lib-card-wide' });
        const pic = el('span', { class: 'lib-pic lib-pic-wide' });
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 120;
        pic.appendChild(c);
        card.append(pic, el('span', { class: 'lib-name', text: entry.name }));
        // Drawn small, once, for the card.
        (async () => {
          const ctx = c.getContext('2d');
          const full = document.createElement('canvas');
          full.width = 960;
          full.height = 720;
          try {
            await entry.draw(full.getContext('2d'));
            ctx.drawImage(full, 0, 0, 160, 120);
          } catch { /* picture missing */ }
        })();
        card.addEventListener('click', () => close(entry));
        return card;
      },
    });
  }, { wide: true, className: 'lib-modal' });
}

export function chooseSound(audio) {
  return modal('Choose a Sound', (body, close) => {
    const tags = [['all', 'All'], ['game', 'Games'], ['effects', 'Effects'], ['music', 'Music'], ['drums', 'Drums'], ['nature', 'Nature'], ['animals', 'Animals'], ['water', 'Water'], ['space', 'Space']];
    grid(body, {
      tags,
      async items(tag, q) {
        return ALL_LIBRARY_SOUNDS.filter((s) => (tag === 'all' || s.tags.includes(tag)) && matches(q, s.name, ...s.tags));
      },
      render(entry) {
        const card = el('div', { class: 'lib-card lib-sound' });
        const play = el('button', { type: 'button', class: 'lib-play', 'aria-label': `Play ${entry.name}`, text: '▶' });
        const pick = el('button', { type: 'button', class: 'lib-pick', text: entry.name });
        play.addEventListener('click', async () => {
          play.textContent = '…';
          try { audio.preview(await renderLibrarySound(entry.id)); } finally { play.textContent = '▶'; }
        });
        pick.addEventListener('click', () => close(entry));
        card.append(play, pick);
        return card;
      },
    });
    const note = el('p', { class: 'lib-note', text: 'Every sound here is made by the computer, so you can use it in anything you share.' });
    body.appendChild(note);
  }, { wide: true, className: 'lib-modal' });
}
