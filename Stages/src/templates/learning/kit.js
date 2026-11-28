// THE LEARNING PROJECTS' KIT. A learning project is DATA: a backdrop, some sprites, and each target's
// scripts written as Stages text (the Text view's own language, compiled by src/text/text.js), so a
// project reads as a page and every script in it is one a student can open, read and change.
//
//   {
//     id: 'water-cycle',                 // PERSISTED in links (?project=water-cycle): add-only
//     title, kind,                       // kind: Simulation | Story | Quiz | Game | Animation | Art
//     grades: [3, 5],                    // the youngest and oldest grade it is written for
//     subject: 'Earth & Space',          // one of SUBJECTS below
//     blurb: 'One line for the card.',
//     learn: 'What a student learns, in one or two sentences.',
//     backdrops: ['world-volcano', { name: 'Diagram', paint: (ctx, w, h) => {} }],
//     variables: { temperature: 20 },    // the Stage's (for all sprites)
//     monitors: [['temperature', 'large', 8, 8]],   // [name, 'normal' | 'large', x, y]
//     sounds: ['tune-wonder'],           // the Stage's sounds, by library id; a script plays "tune-wonder"
//     sprites: [
//       { name: 'Sun', emoji: '☀️', x: -170, y: 120, size: 90 },
//       { name: 'Drop', costumes: [['drop', emoji('💧')], ['cloud', emoji('☁️')]] },
//       { name: 'Riley', lib: 'toon-riley', use: ['idle', 'talk'] },
//       { name: 'Cell', model: 'animal-cell', size: 120 },
//       { name: 'Label', costumes: [['sign', label('EVAPORATION', '#4c97ff')]] },
//     ],
//     scripts: { Stage: `when flag clicked:\n    ...`, Sun: `...` },
//     picture: [[150]],                  // frames (and keys) to run before the card's picture
//     check: [{ frames: 300, keys: ['space'] }, { press: 'q' }, { click: 'Sun' }, { answer: '42' },
//             { expect: { score: 4 } }],   // how tools/check-learning.mjs drives it
//   }
//
// Sounds are named by their library id in scripts. Sprite props are any of makeSprite's: x, y, size,
// direction, visible, rotationStyle, draggable, variables (the sprite's own).
import { newProject, backdrop as libBackdrop, sprite as libSprite, sound as libSound, monitor } from '../kit.js';
import { stageOf, makeSprite, uniqueName } from '../../project/Project.js';
import { costumeFromCanvas } from '../../project/assets.js';
import { newId } from '../../blocks/make.js';

export const SUBJECTS = [
  ['Earth & Space', '🌍'], ['Life Science', '🦋'], ['Physics & Chemistry', '⚛️'], ['Math', '📐'],
  ['History & Geography', '🏛️'], ['Art & Music', '🎨'], ['Language Arts', '📖'], ['Coding', '💻'],
];

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

// --- painters: each returns [w, h, draw(ctx, w, h)] -------------------------------------------------

// An emoji as a picture. Colour emoji are drawn by the browser's own emoji font, so the picture is
// made when the project is opened and looks a little different on each computer.
export function emoji(ch, px = 120) {
  return [px + 16, px + 16, (ctx, w, h) => {
    ctx.font = `${px}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, h / 2 + px * 0.06);
  }];
}

// A rounded label: big readable text on a coloured pill with a dark outline.
export function label(text, fill = '#ffc93c', ink = '#1e2a3a', px = 34) {
  // Measured when the picture is made, not when the project list is read (which may be in node).
  return () => {
    const lines = String(text).split('\n');
    const font = `700 ${px}px "Fredoka", "Nunito", system-ui, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const tw = Math.max(...lines.map((l) => measure.measureText(l).width));
    const w = Math.ceil(tw + px * 1.4);
    const h = Math.ceil(lines.length * px * 1.25 + px * 0.9);
    return [w + 8, h + 8, (ctx) => {
      ctx.beginPath();
      ctx.roundRect(4, 4, w, h, Math.min(h / 2, px));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = ink;
      ctx.stroke();
      ctx.fillStyle = ink;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, 4 + w / 2, 4 + px * 0.45 + px * 1.25 * (i + 0.5) + px * 0.05));
    }];
  };
}

// A filled circle with an outline (a planet, a particle, an organelle).
export function circle(r, fill, stroke = '#1e2a3a', lw = 4) {
  return [r * 2 + lw * 2, r * 2 + lw * 2, (ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }];
}

// A filled rectangle (a bar in a chart, a block, a wall).
export function rect(w, h, fill, stroke = '#1e2a3a', lw = 4, r = 8) {
  return [w + lw * 2, h + lw * 2, (ctx) => {
    ctx.beginPath();
    ctx.roundRect(lw, lw, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }];
}

// Anything else: draw(ctx, w, h) on a w x h canvas.
export function paint(w, h, draw) {
  return [w, h, draw];
}

// --- building ------------------------------------------------------------------------------------

// Every picture is painted at TWICE the stage's scale (resolution 2), so it stays sharp when the
// stage is shown large: a 120 px emoji is 60 steps across at size 100, the stage is 480 x 360 steps,
// and a backdrop is painted on 960 x 720.
async function paintedCostume(p, name, painter) {
  const [w, h, draw] = typeof painter === 'function' ? painter() : painter;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w);
  canvas.height = Math.ceil(h);
  draw(canvas.getContext('2d'), canvas.width, canvas.height);
  return costumeFromCanvas(p, canvas, name, { resolution: 2 });
}

const W = 960;
const H = 720;

async function addBackdrop(p, b) {
  if (typeof b === 'string') return libBackdrop(p, b);
  const stage = stageOf(p);
  const c = await paintedCostume(p, uniqueName(b.name || 'Backdrop', stage.costumes.map((x) => x.name)), [W, H, b.paint]);
  stage.costumes.push(c);
  return c;
}

async function addSprite(p, s) {
  const { name, lib, use, model, emoji: em, costumes, sounds = [], ...props } = s;
  let t;
  if (lib) {
    t = await libSprite(p, lib, { name, ...(use ? { costumes: use } : {}) });
  } else if (model) {
    const { spriteFromModel, modelCatalog } = await import('../../library/libraryAdd.js');
    const { MODEL_BY_ID } = await modelCatalog();
    const m = MODEL_BY_ID.get(model);
    if (!m) throw new Error(`No Model Database model "${model}"`);
    t = await spriteFromModel(p, m);
    t.name = name || m.title;
    p.targets.push(t);
  } else {
    t = makeSprite(name);
    const list = costumes || (em ? [[name, emoji(em)]] : null);
    if (!list) throw new Error(`Sprite "${name}" needs lib, model, emoji or costumes`);
    for (const [cname, painter] of list) t.costumes.push(await paintedCostume(p, cname, painter));
    p.targets.push(t);
  }
  Object.assign(t, props);
  if (name) t.name = name;
  for (const id of sounds) await libSound(p, t, id, id);
  return t;
}

export async function buildLearning(spec, { scripts = true } = {}) {
  const { parseScripts } = await import('../../text/text.js');
  const p = newProject(spec.title);
  const stage = stageOf(p);
  for (const b of spec.backdrops || ['blank']) await addBackdrop(p, b);
  stage.variables = { ...(spec.variables || {}) };
  for (const id of spec.sounds || []) await libSound(p, stage, id, id);
  for (const s of spec.sprites || []) await addSprite(p, s);
  for (const [name, mode = 'normal', x = 8, y = 8] of spec.monitors || []) monitor(p, name, null, x, y, mode);
  if (!scripts) return p;
  const stageVars = Object.keys(stage.variables);
  for (const [who, text] of Object.entries(spec.scripts || {})) {
    const t = who === 'Stage' ? stage : p.targets.find((x) => !x.isStage && x.name === who);
    if (!t) throw new Error(`${spec.id}: scripts for "${who}", but there is no sprite called that`);
    let parsed;
    try {
      parsed = parseScripts(text, { variables: [...stageVars, ...Object.keys(t.variables || {})] });
    } catch (e) {
      throw new Error(`${spec.id}, ${who}, line ${e.line || '?'}: ${e.message}`);
    }
    let y = 20;
    t.scripts = parsed.map((blocks) => {
      const s = { id: newId('s'), x: 20, y, blocks };
      y += 60 + 40 * JSON.stringify(blocks).split('"type"').length;
      return s;
    });
  }
  return p;
}

// A spec as a GALLERY entry.
export function galleryEntry(spec) {
  return {
    id: spec.id, kind: spec.kind, title: spec.title, blurb: spec.blurb, learn: spec.learn,
    grades: spec.grades, subject: spec.subject, learning: true,
    build: () => buildLearning(spec), spec,
  };
}
