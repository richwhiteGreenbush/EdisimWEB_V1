// The HiFi corner panel: the controls that only exist in this edition. Everything a student
// already knows -- Get More Worlds, Save, Create Model, Look Around, Settings -- is the main
// app's own menu, running unchanged. This adds the renderer's settings beside it, plus a list
// of every built-in world, since this edition has no reason to ration them.

export class HiFiPanel {
  constructor({ quality, qualities, worlds, actions }) {
    const root = document.createElement('div');
    root.id = 'hifi-panel';
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'hf-chip'; chip.textContent = '✦ HiFi';
    chip.title = 'High-fidelity settings and the built-in worlds';
    const body = document.createElement('div');
    body.className = 'hf-body'; body.hidden = true;
    chip.addEventListener('click', () => { body.hidden = !body.hidden; });
    root.append(body, chip);
    document.body.appendChild(root);

    const section = (t) => { const h = document.createElement('div'); h.className = 'hf-section'; h.textContent = t; body.appendChild(h); };

    section('Quality');
    const seg = document.createElement('div'); seg.className = 'hf-seg';
    for (const q of qualities) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = q[0].toUpperCase() + q.slice(1);
      if (q === quality) b.classList.add('on');
      b.addEventListener('click', () => actions.setQuality(q));
      seg.appendChild(b);
    }
    body.appendChild(seg);

    section('Wind');
    const wind = document.createElement('input');
    Object.assign(wind, { type: 'range', min: 0, max: 2.5, step: 0.05, value: 1 });
    wind.setAttribute('aria-label', 'Wind strength');
    wind.addEventListener('input', () => actions.setWind(Number(wind.value)));
    body.appendChild(wind);

    section('Built-in worlds');
    const list = document.createElement('div'); list.className = 'hf-worlds';
    for (const [key, w] of Object.entries(worlds)) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = w.label; b.title = w.hint ?? '';
      b.addEventListener('click', () => { body.hidden = true; actions.loadPreset(key); });
      list.appendChild(b);
    }
    body.appendChild(list);

    this.hud = document.createElement('div'); this.hud.className = 'hf-hud';
    body.appendChild(this.hud);
  }

  setStats(text) { this.hud.textContent = text; }
}
