// Projects: the official projects gallery (decision G). Every project here is made by Edusim and
// built in code from the block table and the library, so the gallery needs no server and students'
// own work never appears in it. A student shares their own project as a file.
//
// Each has a link, /stages/?project=<id>. The link carries an ID, never an address, so it can only
// ever open one of these: the main app's ?world= rule.
import { GALLERY } from '../templates/index.js';
import { el, escapeHtml, modal, toast } from './dialogs.js';

export function openGallery(app) {
  modal('Projects to play, read and remix', (body, close) => {
    body.innerHTML = `<p class="gal-intro">Open one, press the green flag, then look inside: every project's scripts are there to read and change. Opening one replaces the project you have open, so save yours first if you want to keep it.</p><div class="gal-grid"></div>`;
    const grid = body.querySelector('.gal-grid');
    for (const entry of GALLERY) {
      const card = el('div', { class: 'gal-card' });
      card.innerHTML = `<div class="gal-pic" style="background-image:url('gallery/${entry.id}.jpg')"></div>
        <div class="gal-text"><span class="gal-kind">${escapeHtml(entry.kind)}</span><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.blurb)}</span></div>
        <div class="modal-buttons" style="padding:0 12px 12px;justify-content:flex-start"></div>`;
      const row = card.querySelector('.modal-buttons');
      row.append(
        el('button', { type: 'button', class: 'btn btn-primary btn-small', text: 'Open', onclick: async () => {
          close(true);
          const ok = await app.openProject(entry.build, entry.title);
          if (ok) toast(`Opened "${entry.title}". Press the green flag to start.`);
        } }),
        el('button', { type: 'button', class: 'btn btn-small', text: 'Copy link', onclick: async () => {
          const url = new URL(`?project=${entry.id}`, location.href).href;
          try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url, { ms: 8000 }); }
        } }),
      );
      grid.appendChild(card);
    }
  }, { wide: true });
}
