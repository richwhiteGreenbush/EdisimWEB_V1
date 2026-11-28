// The small kit the official projects are written with: sprites from the library, backdrops,
// sounds and painted shapes, so a project reads as a list of things on a stage and their scripts.
import { emptyProject, stageOf, uniqueName } from '../project/Project.js';
import { costumeFromCanvas } from '../project/assets.js';
import { CARTOON_SPRITES } from '../library/cartoons.js';
import { BACKDROPS } from '../library/backdrops.js';
import { ALL_LIBRARY_SOUNDS } from '../audio/soundLibrary.js';
import { backdropFromLibrary, soundFromLibrary, spriteFromCartoon } from '../library/libraryAdd.js';

export { B, C, C2, R, V, script } from '../blocks/make.js';

export function newProject(title) {
  return emptyProject(title);
}

export async function backdrop(p, id, name) {
  const entry = BACKDROPS.find((b) => b.id === id);
  if (!entry) throw new Error(`No backdrop "${id}"`);
  const stage = stageOf(p);
  const c = await backdropFromLibrary(p, entry);
  c.name = uniqueName(name || entry.name, stage.costumes.map((x) => x.name));
  stage.costumes.push(c);
  return c;
}

export async function sprite(p, id, props = {}) {
  const entry = CARTOON_SPRITES.find((s) => s.id === id);
  if (!entry) throw new Error(`No library sprite "${id}"`);
  const s = await spriteFromCartoon(p, entry, { name: props.name });
  const { costumes, ...rest } = props;
  if (costumes) s.costumes = costumes.map((n) => s.costumes.find((c) => c.name === n)).filter(Boolean);
  Object.assign(s, rest);
  if (props.name) s.name = props.name;
  p.targets.push(s);
  return s;
}

// A sprite whose costumes are painted in code: each painter draws on a w x h canvas.
export async function painted(p, name, painters, props = {}) {
  const s = (await import('../project/Project.js')).makeSprite(name);
  for (const [cname, w, h, draw, opts] of painters) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    draw(canvas.getContext('2d'), w, h);
    s.costumes.push(await costumeFromCanvas(p, canvas, cname, opts || {}));
  }
  Object.assign(s, props);
  p.targets.push(s);
  return s;
}

export async function sound(p, target, id, name) {
  const entry = ALL_LIBRARY_SOUNDS.find((x) => x.id === id);
  if (!entry) throw new Error(`No library sound "${id}"`);
  const s = await soundFromLibrary(p, entry);
  s.name = name || entry.name;
  target.sounds.push(s);
  return s;
}

export function monitor(p, name, target = null, x = 6, y = 6, mode = 'normal') {
  p.monitors.push({ id: `var:${target?.id || ''}:${name}`, kind: 'variable', target: target?.id || null, name, x, y, visible: true, mode });
}

export function rounded(ctx, x, y, w, h, r, fill, stroke = null, lw = 4) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}
