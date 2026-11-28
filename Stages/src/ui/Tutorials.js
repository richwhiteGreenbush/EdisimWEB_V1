// Tutorials: step-by-step cards that float over the editor while a student builds. Each one can start
// from an empty project or from a starter, and the card stays put while the student works.
import { TUTORIALS } from '../templates/tutorials.js';
import { el, escapeHtml, modal, toast } from './dialogs.js';

let open = null;

export function openTutorials(app) {
  modal('Tutorials', (body, close) => {
    body.innerHTML = '<p class="gal-intro">Pick one and follow the card. It stays on screen while you build, and you can move it out of the way.</p><div class="gal-grid"></div>';
    const grid = body.querySelector('.gal-grid');
    for (const t of TUTORIALS) {
      const card = el('button', { type: 'button', class: 'gal-card' });
      card.innerHTML = `<div class="gal-pic" style="background-image:url('gallery/${t.picture}.jpg')"></div><div class="gal-text"><span class="gal-kind">${escapeHtml(t.level)} · ${t.steps.length} steps</span><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.blurb)}</span></div>`;
      card.addEventListener('click', async () => {
        close(true);
        if (t.start) {
          const ok = await app.openProject(t.start, t.title);
          if (!ok) return;
        }
        showCard(app, t);
      });
      grid.appendChild(card);
    }
  }, { wide: true });
}

export function showCard(app, tut, at = 0) {
  open?.remove();
  let i = at;
  const card = el('div', { class: 'tut-card', role: 'dialog', 'aria-label': tut.title });
  card.innerHTML = `<div class="tut-head"><strong></strong><button type="button" aria-label="Close the tutorial">×</button></div><div class="tut-body"></div><div class="tut-foot"><span></span><button type="button" class="btn btn-small">Back</button><button type="button" class="btn btn-primary btn-small">Next</button></div>`;
  const [back, next] = card.querySelectorAll('.tut-foot button');
  const draw = () => {
    const step = tut.steps[i];
    card.querySelector('.tut-head strong').textContent = `${tut.title}: ${step.title}`;
    card.querySelector('.tut-body').innerHTML = step.html;
    card.querySelector('.tut-foot span').textContent = `Step ${i + 1} of ${tut.steps.length}`;
    back.disabled = i === 0;
    next.textContent = i === tut.steps.length - 1 ? 'Finish' : 'Next';
  };
  back.addEventListener('click', () => { if (i > 0) { i--; draw(); } });
  next.addEventListener('click', () => {
    if (i < tut.steps.length - 1) { i++; draw(); return; }
    card.remove();
    open = null;
    toast(`You finished "${tut.title}". Save your project to keep it.`);
  });
  card.querySelector('.tut-head button').addEventListener('click', () => { card.remove(); open = null; });
  // Drag the card by its header.
  const head = card.querySelector('.tut-head');
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = card.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      card.style.left = `${Math.max(0, Math.min(window.innerWidth - r.width, ev.clientX - dx))}px`;
      card.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dy))}px`;
      card.style.right = 'auto';
      card.style.bottom = 'auto';
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  document.body.appendChild(card);
  open = card;
  draw();
}
