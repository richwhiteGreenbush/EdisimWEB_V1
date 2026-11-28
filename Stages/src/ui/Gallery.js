// THE STAGES PROJECT DATABASE: the official projects (decision G), searchable, and filtered by grade
// and subject, like the main app's World and Model Databases. Every project here is made by Edusim and
// built in code from the block table and the library, so it needs no server and students' own work
// never appears in it. A student shares their own project as a file.
//
// Each has a link, /stages/?project=<id>. The link carries an ID, never an address, so it can only
// ever open one of these: the main app's ?world= rule.
import { GALLERY, SUBJECTS } from '../templates/index.js';
import { el, escapeHtml, modal, toast } from './dialogs.js';

const BANDS = [['all', 'All grades', 3, 12], ['3-5', 'Grades 3–5', 3, 5], ['6-8', 'Grades 6–8', 6, 8], ['9-12', 'Grades 9–12', 9, 12]];
const SUBJECT_ICON = Object.fromEntries(SUBJECTS);
// Learning projects first (per Rich: focus on learning), then the original coding games and stories.
const LIST = [...GALLERY.filter((g) => g.learning), ...GALLERY.filter((g) => !g.learning)];

export const gradeText = (g) => (g ? (g[0] === g[1] ? `Grade ${g[0]}` : `Grades ${g[0]}–${g[1]}`) : '');

// Remembered for the session, so closing and reopening keeps the student's place.
const state = { band: 'all', subject: 'all', text: '' };

export function openGallery(app) {
  modal('Edusim Stages Project Database', (body, close) => {
    body.innerHTML = `
      <p class="gal-intro">Projects to play, read and remix, for grades 3 to 12. Open one, press the green flag, then look inside: every script is there to read and change. Opening one replaces the project you have open, so save yours first if you want to keep it.</p>
      <div class="pdb-bar">
        <input type="search" class="pdb-search" placeholder="Search: volcano, fractions, cells…" aria-label="Search the projects" />
        <div class="pdb-chips pdb-bands" role="group" aria-label="Grade"></div>
      </div>
      <div class="pdb-chips pdb-subjects" role="group" aria-label="Subject"></div>
      <p class="pdb-count" aria-live="polite"></p>
      <div class="gal-grid"></div>`;
    const grid = body.querySelector('.gal-grid');
    const count = body.querySelector('.pdb-count');
    const search = body.querySelector('.pdb-search');
    search.value = state.text;

    const chip = (wrap, key, value, text) => {
      const b = el('button', { type: 'button', class: 'pdb-chip', text });
      b.dataset.value = value;
      b.addEventListener('click', () => { state[key] = value; render(); });
      wrap.appendChild(b);
    };
    const bands = body.querySelector('.pdb-bands');
    for (const [v, t] of BANDS) chip(bands, 'band', v, t);
    const subjects = body.querySelector('.pdb-subjects');
    chip(subjects, 'subject', 'all', 'Every subject');
    for (const [s, icon] of SUBJECTS) if (LIST.some((g) => g.subject === s)) chip(subjects, 'subject', s, `${icon} ${s}`);

    const cards = LIST.map((entry) => {
      const card = el('div', { class: 'gal-card' });
      card.innerHTML = `<div class="gal-pic" style="background-image:url('gallery/${entry.id}.jpg')"></div>
        <div class="gal-text"><span class="gal-kind">${escapeHtml(entry.kind)} · ${escapeHtml(gradeText(entry.grades))}</span><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.blurb)}</span>
        ${entry.learn ? `<span class="gal-learn"><b>You'll learn:</b> ${escapeHtml(entry.learn)}</span>` : ''}
        <span class="gal-subject">${SUBJECT_ICON[entry.subject] || ''} ${escapeHtml(entry.subject || '')}</span></div>
        <div class="modal-buttons" style="padding:0 12px 12px;justify-content:flex-start"></div>`;
      card.querySelector('.modal-buttons').append(
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
      const words = `${entry.title} ${entry.blurb} ${entry.learn || ''} ${entry.subject || ''} ${entry.kind}`.toLowerCase();
      return { entry, card, words };
    });

    function render() {
      const [, , lo, hi] = BANDS.find((b) => b[0] === state.band);
      const terms = state.text.toLowerCase().split(/\s+/).filter(Boolean);
      let shown = 0;
      for (const { entry, card, words } of cards) {
        const g = entry.grades || [3, 12];
        const ok = g[0] <= hi && g[1] >= lo
          && (state.subject === 'all' || entry.subject === state.subject)
          && terms.every((t) => words.includes(t));
        card.hidden = !ok;
        if (ok) shown++;
      }
      for (const b of bands.children) b.classList.toggle('is-on', b.dataset.value === state.band);
      for (const b of subjects.children) b.classList.toggle('is-on', b.dataset.value === state.subject);
      count.textContent = shown ? `${shown} project${shown === 1 ? '' : 's'}` : 'No projects match. Try another word or grade.';
    }
    search.addEventListener('input', () => { state.text = search.value; render(); });
    render();
    search.focus();
  }, { wide: true, className: 'pdb-modal' });
}
