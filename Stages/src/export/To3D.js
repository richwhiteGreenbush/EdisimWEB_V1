// CONVERT TO 3D WORLD (plan: edusim-stages-to-3d-plan.md).
//
// The whole project goes into a 3D world as ONE object, which Edusim runs with this same runtime, so
// a converted game still plays (decision A). This file is the Stages half: the dialog, its preview
// picture, and the handoff. Converting never changes the Stages project; it makes a copy.
//
// Three ways out:
//   Open in Edusim         /app/?from-stages=<token>, a new tab; the world is built round the stage
//   Open in Edusim HiFi    the same, at /hifi/
//   Download a world file  the stage on its own in a plain world, for Load World File anywhere
import { putHandoff } from '../project/handoff.js';
import { toFileText, safeFileName, stageOf } from '../project/Project.js';
import { BACKDROPS } from '../library/backdrops.js';
import { STAGE_H, STAGE_W } from '../runtime/geometry.js';
import { el, escapeHtml, modal, toast } from '../ui/dialogs.js';

// Edusim's own worlds, by the backdrop id they came in as (backdrops.js), and the name each goes by.
const WORLD_NAMES = {
  park: 'The Park', moon: 'The Moon', mars: 'On Mars', dinosaur: 'Dinosaur Island', sea: 'Under the Sea',
  egypt: 'Ancient Egypt', volcano: 'Volcanoes & Rocks', wonderland: 'Alice in Wonderland', chalk: 'Chalk Drawings',
  butterfly: 'The Butterfly Garden', neighborhood: 'The Neighborhood', museum: 'The Museum', library: 'The Library',
  solar: 'Solar System Walk', voyage: 'Fantastic Voyage', robots: 'Robot Challenge World', midway: "Newton's Midway",
  atomhall: 'Atom Hall', smallchange: 'Small Change', standonearth: 'Stand on the Earth',
};

const worldOf = (costume) => {
  const m = /^world-([a-z]+)$/.exec(costume?.library || '');
  return m && WORLD_NAMES[m[1]] ? m[1] : null;
};

// Every Edusim world any of the project's backdrops came from, the current one first.
export function worldsInProject(project) {
  const stage = stageOf(project);
  const list = [];
  const current = worldOf(stage.costumes[stage.currentCostume]);
  if (current) list.push(current);
  for (const c of stage.costumes) {
    const w = worldOf(c);
    if (w && !list.includes(w)) list.push(w);
  }
  return list;
}

// A plain, a grid or a maze backdrop reads best as a board on the ground; anything with a scene in
// it reads best standing up as a set.
export function defaultLayout(project) {
  const stage = stageOf(project);
  const lib = stage.costumes[stage.currentCostume]?.library;
  const entry = BACKDROPS.find((b) => b.id === lib);
  return entry && entry.tags.some((t) => t === 'plain' || t === 'maths') ? 'board' : 'set';
}

export function openTo3DDialog(app) {
  const project = app.project;
  const worlds = worldsInProject(project);
  const state = { layout: defaultLayout(project), size: 'life', where: worlds[0] || 'empty' };
  const snapshot = document.createElement('canvas');
  snapshot.width = STAGE_W;
  snapshot.height = STAGE_H;
  app.draw();
  app.renderer.compositeTo(snapshot.getContext('2d'), 0, 0, STAGE_W, STAGE_H);

  modal('Convert to 3D World', (body, close) => {
    const whereOptions = [...worlds.map((w) => [w, `${WORLD_NAMES[w]} (your backdrop's world)`]), ['empty', 'My World (an empty field)']];
    body.innerHTML = `
      <div class="t3-grid">
        <div class="t3-preview"><canvas width="480" height="300" aria-label="A picture of how it will look"></canvas>
          <p class="ex-note">Your Stages project stays exactly as it is. This makes a copy you can walk into, and it still runs: press <b>▶ Play</b> on it in the 3D world.</p></div>
        <div class="t3-form">
          <fieldset><legend>How should the stage stand?</legend>
            <label class="radio"><input type="radio" name="t3-layout" value="set"> As a stage set, standing up like a theatre</label>
            <label class="radio"><input type="radio" name="t3-layout" value="board"> As a board on the ground, like a giant game board</label>
          </fieldset>
          <fieldset><legend>How big?</legend>
            <label class="radio"><input type="radio" name="t3-size" value="small"> Small, like a model on a table</label>
            <label class="radio"><input type="radio" name="t3-size" value="life"> Life size: characters about as tall as you</label>
            <label class="radio"><input type="radio" name="t3-size" value="huge"> Huge</label>
          </fieldset>
          <label class="t3-where">Where? <select>${whereOptions.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="modal-buttons">
        <button type="button" class="btn" data-go="file">⬇ Download a world file</button>
        <button type="button" class="btn" data-go="hifi">✦ Open in Edusim HiFi</button>
        <button type="button" class="btn btn-primary" data-go="app" autofocus>🌍 Open in Edusim</button>
      </div>`;
    const canvas = body.querySelector('canvas');
    const draw = () => drawPreview(canvas, snapshot, state);
    for (const r of body.querySelectorAll('input[name="t3-layout"]')) {
      r.checked = r.value === state.layout;
      r.addEventListener('change', () => { state.layout = r.value; draw(); });
    }
    for (const r of body.querySelectorAll('input[name="t3-size"]')) {
      r.checked = r.value === state.size;
      r.addEventListener('change', () => { state.size = r.value; draw(); });
    }
    const where = body.querySelector('select');
    where.value = state.where;
    where.addEventListener('change', () => { state.where = where.value; draw(); });
    draw();
    for (const b of body.querySelectorAll('[data-go]')) {
      b.addEventListener('click', async () => {
        try {
          if (b.dataset.go === 'file') await downloadWorld(app, state);
          else await handOff(app, state, b.dataset.go);
          close(true);
        } catch (err) {
          console.error(err);
          toast(`That did not work: ${err.message}`, { kind: 'error', ms: 6000 });
        }
      });
    }
  }, { wide: true, className: 't3-modal' });
}

async function handOff(app, state, edition) {
  const projectText = await toFileText(app.project, app.runtime.drawOrder);
  const token = await putHandoff({
    type: 'convert', title: app.project.title, layout: state.layout, size: state.size,
    preset: state.where, projectText,
  });
  const url = `${edition === 'hifi' ? '../hifi/' : '../app/'}?from-stages=${token}`;
  const tab = window.open(url, '_blank');
  if (!tab) {
    // A blocked pop-up: go in this tab instead. The project is autosaved, so nothing is lost.
    location.href = url;
    return;
  }
  toast(edition === 'hifi' ? 'Opening Edusim HiFi in a new tab…' : 'Opening Edusim in a new tab…');
}

// A world file: a plain world with the stage standing in front of where Edusim puts a student
// (x 0, z 6, looking toward -Z). The record format is the main app's (WorldFile.js).
async function downloadWorld(app, state) {
  const projectText = await toFileText(app.project, app.runtime.drawOrder);
  const b64 = btoa(unescape(encodeURIComponent(projectText)));
  const dist = state.size === 'huge' ? 110 : state.size === 'small' ? 12 : 30;
  const record = {
    id: `stages-${Date.now().toString(36)}`,
    kind: 'stages-project',
    createdAt: Date.now(),
    title: app.project.title,
    layout: state.layout,
    size: state.size,
    files: [{ name: 'project.edusim-stages.json', type: 'application/json', dataBase64: b64 }],
    transform: { position: [0, 0, 6 - dist], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };
  const theme = { id: `theme-${Date.now().toString(36)}`, kind: 'world-theme', theme: 'default', createdAt: Date.now(), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
  const payload = { format: 'edusim-world', version: 1, exportedAt: Date.now(), records: [theme, record] };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: safeFileName(app.project.title).replace(/\.edusim-stages\.json$/, '.edusim-world.json') });
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('Saved. Open it in Edusim with Load World File.');
}

// A small picture of the result: the stage standing on grass as a set, or lying on it as a board,
// with a person beside it for size.
function drawPreview(canvas, snapshot, state) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sky = g.createLinearGradient(0, 0, 0, H);
  const space = ['moon', 'mars', 'solar'].includes(state.where);
  sky.addColorStop(0, space ? '#0b0f22' : '#6cc0f2');
  sky.addColorStop(0.62, space ? '#1f2440' : '#cfeaf8');
  sky.addColorStop(0.62, space ? '#8a8a8a' : '#7fc35a');
  sky.addColorStop(1, space ? '#5e5e5e' : '#5aa340');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const horizon = H * 0.62;
  const scale = { small: 0.45, life: 1, huge: 1.7 }[state.size];
  // A 5 ft person, the same height in every picture, so the size choice shows.
  const personH = 46;
  const px = W * 0.86;
  const py = H * 0.9;
  if (state.layout === 'set') {
    const w = Math.min(W * 0.9, 240 * scale * (personH / 50) * 0.95);
    const h = w * 0.75;
    const base = py;
    const lift = state.size === 'small' ? personH * 0.5 : state.size === 'life' ? 6 : 0;
    const x = W * 0.45 - w / 2;
    const y = base - lift - h;
    g.fillStyle = '#2b3350';
    g.fillRect(x - 6, base - lift, w + 12, lift + 4);
    g.fillStyle = '#c42d4a';
    g.fillRect(x - 5, y - 5, w + 10, h + 10);
    g.drawImage(snapshot, x, Math.max(-h, y), w, h);
  } else {
    const w = Math.min(W * 1.2, 240 * scale * (personH / 50) * 1.1);
    const depth = w * 0.75 * 0.35;
    const xc = W * 0.45;
    const front = H * 0.94;
    const back = Math.max(horizon + 4, front - depth);
    const rows = 60;
    for (let i = 0; i < rows; i++) {
      const t0 = i / rows;
      const yy = back + (front - back) * t0;
      const ww = w * (0.55 + 0.45 * t0);
      g.drawImage(snapshot, 0, (i / rows) * STAGE_H, STAGE_W, STAGE_H / rows + 1, xc - ww / 2, yy, ww, (front - back) / rows + 1);
    }
  }
  g.fillStyle = '#3b4256';
  g.beginPath();
  g.arc(px, py - personH + 6, 6, 0, Math.PI * 2);
  g.fill();
  g.fillRect(px - 5, py - personH + 12, 10, personH - 22);
  g.fillRect(px - 5, py - 12, 4, 12);
  g.fillRect(px + 1, py - 12, 4, 12);
  g.fillStyle = '#fff';
  g.font = '600 11px system-ui, sans-serif';
  g.fillText('you', px - 9, py + 12 > H ? py - personH - 6 : py + 12);
}
