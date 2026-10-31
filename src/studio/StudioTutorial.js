import * as THREE from 'three';
import { MODELS, MODEL_BY_ID, MODEL_CATEGORIES, modelCategory, searchModels } from '../models/catalog.js';
import { buildCatalogModel } from '../models/index.js';
import { buildProp } from '../props/index.js';
import { uuid } from '../Uuid.js';
import { drawHeadline, clamp01, smooth, outBack, outCubic, life, BRAND, FONT } from './StudioOverlay.js';

// THE TUTORIAL KIT: what a how-to video draws that a showcase does not -- a pointer that clicks
// things, the app's own panels, numbered steps and a little confetti -- and, at the bottom, the
// one tutorial written with it so far: a museum made from the Model Database.
//
// THE PANELS ARE DRAWN BECAUSE THEY HAVE TO BE. The app's real ones are DOM, and DOM is never in
// the frame (see Studio.js). So every label here is the app's own wording, every search result
// comes from the real searchModels(), every picture is the panel's own thumbnail and every model
// is the real builder's, which is what keeps a tutorial from promising something the app cannot do.
// Change a menu label in the app and it has to change here too; nothing will fail if it drifts.

// One colour per step, so a viewer can tell at a glance that the video has moved on.
const STEP_COLOURS = ['#e0455f', '#ef8524', '#2f9e6e', '#3d8bf2', '#8a5cf5'];
const CONFETTI = ['#e0455f', '#ef8524', '#ffc93c', '#3fb37f', '#3d8bf2', '#8a5cf5', '#ffffff'];

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function font(ctx, weight, size, family = FONT.body) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
}

// Text cut to a width with an ellipsis, since a model's title is not ours to shorten by hand.
function fitted(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

// Eases through a list of { t, x, y } points and pulses a ring on any with `click`.
export function drawPointer(ctx, L, path, t) {
  if (!path.length || t < path[0].t) return;
  let x = path[path.length - 1].x;
  let y = path[path.length - 1].y;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = smooth((t - a.t) / Math.max(0.001, b.t - a.t));
      x = a.x + (b.x - a.x) * k;
      y = a.y + (b.y - a.y) * k;
      break;
    }
  }
  const { u } = L;
  ctx.save();
  let press = 1;
  for (const p of path) {
    if (!p.click) continue;
    const k = (t - p.t) / 0.45;
    if (k < 0 || k > 1) continue;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = BRAND.sun;
    ctx.lineWidth = 9 * u * (1 - k) + 2 * u;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (14 + 62 * outCubic(k)) * u, 0, Math.PI * 2);
    ctx.stroke();
    press = Math.min(press, 0.82 + 0.18 * clamp01(k * 3));
  }
  ctx.globalAlpha = 1;
  ctx.translate(x, y);
  ctx.scale(u * 2.5 * press, u * 2.5 * press);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  for (const [i, [px, py]] of [[0, 0], [0, 22], [5.5, 17], [9.5, 26], [13.5, 24.2], [9.5, 15.5], [16.5, 15.5]].entries()) {
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = BRAND.ink;
  ctx.stroke();
  ctx.restore();
}

// The step's number and instruction, in that step's colour, with a row of dots saying how far
// through the video it is. A how-to has to say what to do while it is being done.
export function drawTutorialStep(ctx, L, { n, of, text, t, start = 0, end }) {
  const { visible, kin, kout } = life(t, start, end, 0.32, 0.22);
  if (!visible) return;
  const { u, safe } = L;
  const colour = STEP_COLOURS[(n - 1) % STEP_COLOURS.length];
  const fs = (L.portrait ? 50 : 46) * u;
  const d = fs * 1.5;
  ctx.save();
  font(ctx, 700, fs, FONT.display);
  const maxText = safe.x1 - safe.x0 - d - 70 * u;
  const tw = Math.min(ctx.measureText(text).width, maxText);
  const w = d + tw + 62 * u;
  const h = d + 18 * u;
  const cx = (safe.x0 + safe.x1) / 2;
  const x = cx - w / 2;
  const y = L.top - 8 * u + (1 - outBack(kin)) * -40 * u;
  ctx.globalAlpha = Math.min(clamp01(kin * 1.6), kout);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 20 * u;
  ctx.fillStyle = colour;
  rrect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x + 9 * u + d / 2, y + h / 2, d / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.fillText(String(n), x + 9 * u + d / 2, y + h / 2 + fs * 0.35);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x + d + 30 * u, y + h / 2 + fs * 0.35, tw);
  for (let i = 0; i < of; i++) {
    ctx.fillStyle = i < n ? STEP_COLOURS[i % STEP_COLOURS.length] : 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(cx + (i - (of - 1) / 2) * 30 * u, y + h + 20 * u, (i === n - 1 ? 10 : 7) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The app's success toast: bottom centre, its own words.
export function drawToast(ctx, L, { text, t, start, end }) {
  const { visible, kin, kout } = life(t, start, end, 0.22, 0.22);
  if (!visible) return;
  const { u, safe } = L;
  const fs = 31 * u;
  ctx.save();
  font(ctx, 800, fs);
  const maxW = safe.x1 - safe.x0 - 50 * u;
  const tw = Math.min(ctx.measureText(text).width, maxW);
  const h = fs * 2.1;
  const cx = (safe.x0 + safe.x1) / 2;
  const y = safe.y1 - h + (1 - outBack(kin)) * 30 * u;
  ctx.globalAlpha = Math.min(kin, kout);
  ctx.fillStyle = BRAND.green;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 16 * u;
  rrect(ctx, cx - tw / 2 - 26 * u, y, tw + 52 * u, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y + h * 0.66, maxW);
  ctx.restore();
}

// Falls for `dur` seconds from the top of the frame. Every value is a function of the piece's
// index and the time, so a frame is the same however many times it is rendered.
export function drawConfetti(ctx, L, t, dur = 3.4, count = 110) {
  if (t < 0 || t > dur) return;
  const { W, H, u } = L;
  const frac = (v) => v - Math.floor(v);
  ctx.save();
  ctx.globalAlpha = clamp01((dur - t) / 0.5);
  for (let i = 0; i < count; i++) {
    const a = frac(i * 0.61803);
    const b = frac(i * 0.37139);
    const c = frac(i * 0.75488);
    const age = t - c * 0.9;
    if (age < 0) continue;
    const x = a * W + Math.sin(age * (2 + b * 3) + i) * 44 * u;
    const y = -30 * u + age * (240 + b * 300) * u + age * age * 60 * u;
    if (y > H + 30 * u) continue;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(age * (3 + c * 5) + i);
    ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.cos(age * 6 + i)));
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    ctx.fillRect(-9 * u, -6 * u, 18 * u, 12 * u);
    ctx.restore();
  }
  ctx.restore();
}

// Twinkles round a model that just arrived: the same idea as a rendered model's burst, in colour.
export function drawPopStars(ctx, L, S, object3D, lt) {
  if (lt < 0 || lt > 0.9) return;
  const box = new THREE.Box3().setFromObject(object3D);
  const p = S.project(box.getCenter(new THREE.Vector3()));
  if (!p) return;
  const { u } = L;
  ctx.save();
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2 + i * 0.37;
    const dist = (80 + (i % 4) * 58) * u * outCubic(lt * 1.5);
    const r = (11 + (i % 3) * 7) * u * (1 - lt * 0.6);
    ctx.globalAlpha = clamp01(1 - lt / 0.9);
    ctx.fillStyle = CONFETTI[i % CONFETTI.length];
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const aa = (j * Math.PI) / 4;
      const rr = j % 2 === 0 ? r : r * 0.32;
      ctx.lineTo(p.x + Math.cos(ang) * dist + Math.cos(aa) * rr, p.y + Math.sin(ang) * dist + Math.sin(aa) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// --- the app's panels, drawn -----------------------------------------------------------------

const thumbs = new Map();
function loadThumb(id) {
  if (thumbs.has(id)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { thumbs.set(id, img); resolve(); };
    img.onerror = () => resolve();
    img.src = `models/thumbs/${id}.webp`;
  });
}

// Every picture a set of searches will show, loaded before the first frame that needs one. A
// partly typed query shows different cards from the finished one, so each prefix counts.
async function preloadThumbs(queries) {
  const ids = new Set();
  for (const q of queries) {
    for (let n = 0; n <= q.length; n++) {
      for (const m of searchModels(q.slice(0, n), MODELS).slice(0, 6)) ids.add(m.id);
    }
  }
  await Promise.all([...ids].map(loadThumb));
}

// Where everything in the Model Database panel lands for a query, so the pointer can be aimed at
// the actual button rather than at a coordinate that goes stale when the results change.
export function databaseLayout(L, query) {
  const { u, safe } = L;
  const x = safe.x0;
  const y = L.top + 118 * u;
  const w = safe.x1 - safe.x0;
  const h = Math.min(safe.y1 - y, w * 0.82);
  const head = 86 * u;
  const rail = 214 * u;
  const pad = 14 * u;
  const results = searchModels(query, MODELS);
  const cols = 3;
  const cardW = (w - rail - pad * (cols + 1)) / cols;
  const cardH = (h - head - pad * 3 - 38 * u) / 2;
  const cards = results.slice(0, 6).map((model, i) => {
    const cx = x + rail + pad + (i % cols) * (cardW + pad);
    const cy = y + head + pad + Math.floor(i / cols) * (cardH + pad);
    const bh = 46 * u;
    return { model, x: cx, y: cy, w: cardW, h: cardH, place: { x: cx + 10 * u, y: cy + cardH - bh - 10 * u, w: cardW - 20 * u, h: bh } };
  });
  return { x, y, w, h, head, rail, results, cards, search: { x: x + 300 * u, y: y + 18 * u, w: w - 330 * u, h: 52 * u } };
}

export function drawDatabase(ctx, L, { query, typed = query.length, pressed = null, scale = 1, alpha = 1 }) {
  if (alpha <= 0.001) return;
  const { u } = L;
  const shown = query.slice(0, Math.floor(typed));
  const P = databaseLayout(L, shown);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(P.x + P.w / 2, P.y + P.h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-(P.x + P.w / 2), -(P.y + P.h / 2));
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 36 * u;
  ctx.fillStyle = 'rgba(24, 28, 33, 0.985)';
  rrect(ctx, P.x, P.y, P.w, P.h, 22 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  font(ctx, 700, 36 * u, FONT.display);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Model Database', P.x + 22 * u, P.y + 56 * u, 268 * u);
  const s = P.search;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  rrect(ctx, s.x, s.y, s.w, s.h, 12 * u);
  ctx.fill();
  ctx.strokeStyle = '#5cd3e2';
  ctx.lineWidth = 3 * u;
  ctx.stroke();
  font(ctx, 700, 28 * u);
  ctx.fillStyle = shown ? '#ffffff' : 'rgba(232,237,242,0.55)';
  ctx.fillText(shown || 'Search: heart, dinosaur, Egypt, music…', s.x + 16 * u, s.y + 36 * u, s.w - 30 * u);

  // The rail: the nine real types with the real number of matches beside each.
  const counts = {};
  for (const m of P.results) counts[m.category] = (counts[m.category] || 0) + 1;
  const rows = [{ key: 'all', label: 'All models', accent: '#5cd3e2' }, ...MODEL_CATEGORIES];
  const rowH = (P.h - P.head - 50 * u) / rows.length;
  rows.forEach((c, i) => {
    const ry = P.y + P.head + 6 * u + i * rowH;
    if (c.key === 'all') {
      ctx.fillStyle = 'rgba(92,211,226,0.2)';
      rrect(ctx, P.x + 10 * u, ry, P.rail - 16 * u, rowH - 4 * u, 10 * u);
      ctx.fill();
    }
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(P.x + 28 * u, ry + rowH / 2 - 2 * u, 9 * u, 0, Math.PI * 2);
    ctx.fill();
    font(ctx, 700, 19 * u);
    ctx.fillStyle = '#e8edf2';
    ctx.fillText(c.label, P.x + 46 * u, ry + rowH / 2 + 5 * u, P.rail - 92 * u);
    ctx.fillStyle = 'rgba(232,237,242,0.65)';
    ctx.textAlign = 'right';
    ctx.fillText(String(c.key === 'all' ? P.results.length : counts[c.key] || 0), P.x + P.rail - 16 * u, ry + rowH / 2 + 5 * u);
    ctx.textAlign = 'left';
  });

  for (const card of P.cards) {
    const cat = modelCategory(card.model.category);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    rrect(ctx, card.x, card.y, card.w, card.h, 14 * u);
    ctx.fill();
    ctx.strokeStyle = cat.accent;
    ctx.lineWidth = 3 * u;
    ctx.stroke();
    const titleH = 74 * u;
    const pic = { x: card.x + 8 * u, y: card.y + 8 * u, w: card.w - 16 * u, h: card.h - titleH - 72 * u };
    ctx.fillStyle = '#f2f4f7';
    rrect(ctx, pic.x, pic.y, pic.w, pic.h, 10 * u);
    ctx.fill();
    const img = thumbs.get(card.model.id);
    if (img) {
      // Cover, not contain: the thumbnails have a grey ground that must reach the card's edges.
      const k = Math.max(pic.w / img.naturalWidth, pic.h / img.naturalHeight);
      const iw = img.naturalWidth * k;
      const ih = img.naturalHeight * k;
      ctx.save();
      rrect(ctx, pic.x, pic.y, pic.w, pic.h, 10 * u);
      ctx.clip();
      ctx.drawImage(img, pic.x + (pic.w - iw) / 2, pic.y + (pic.h - ih) / 2, iw, ih);
      ctx.restore();
    }
    font(ctx, 800, 22 * u);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitted(ctx, card.model.title, card.w - 20 * u), card.x + 11 * u, pic.y + pic.h + 28 * u);
    font(ctx, 700, 17 * u);
    ctx.fillStyle = cat.accent;
    ctx.fillText(fitted(ctx, cat.label, card.w - 20 * u), card.x + 11 * u, pic.y + pic.h + 52 * u);
    const b = card.place;
    ctx.fillStyle = pressed === card.model.id ? BRAND.sun : '#5cd3e2';
    rrect(ctx, b.x, b.y, b.w, b.h, 10 * u);
    ctx.fill();
    font(ctx, 800, 24 * u);
    ctx.fillStyle = '#0e2a2e';
    ctx.textAlign = 'center';
    ctx.fillText('Place', b.x + b.w / 2, b.y + b.h * 0.68);
    ctx.textAlign = 'left';
  }
  font(ctx, 800, 22 * u);
  ctx.fillStyle = 'rgba(232,237,242,0.8)';
  ctx.fillText(`${P.results.length} model${P.results.length === 1 ? '' : 's'}`, P.x + P.rail + 16 * u, P.y + P.h - 14 * u);
  ctx.restore();
}

// A floating list of buttons, the shape every menu in the app takes, with each row's rect worked
// out first so the pointer can aim at one.
export function menuLayout(L, { x, y, w = 400, rowH = 62, rows }) {
  const { u } = L;
  const top = y + 66 * u;
  return {
    x, y, w: w * u, h: 74 * u + rows.length * rowH * u,
    rows: rows.map((text, i) => ({ text, x: x + 12 * u, y: top + i * rowH * u, w: (w - 24) * u, h: (rowH - 8) * u })),
  };
}

export function drawMenu(ctx, L, layout, { title, hot = null, colours = {}, alpha = 1, pop = 1 }) {
  if (alpha <= 0.001) return;
  const { u } = L;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(layout.x, layout.y);
  ctx.scale(pop, pop);
  ctx.translate(-layout.x, -layout.y);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 26 * u;
  ctx.fillStyle = 'rgba(24, 28, 33, 0.97)';
  rrect(ctx, layout.x, layout.y, layout.w, layout.h, 18 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  font(ctx, 700, 28 * u, FONT.display);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, layout.x + 18 * u, layout.y + 44 * u, layout.w - 36 * u);
  for (const r of layout.rows) {
    const on = r.text === hot;
    ctx.fillStyle = on ? BRAND.sun : colours[r.text] || 'rgba(255,255,255,0.1)';
    rrect(ctx, r.x, r.y, r.w, r.h, 10 * u);
    ctx.fill();
    font(ctx, 800, 25 * u);
    ctx.fillStyle = on ? BRAND.ink : '#ffffff';
    ctx.fillText(r.text, r.x + 16 * u, r.y + r.h * 0.65, r.w - 28 * u);
  }
  ctx.restore();
}

// The amber hammer badge that floats over a build piece. The real sprite is hidden from the video
// with the rest of the app's world UI, and drawing it here is what lets it bounce.
export function drawHammer(ctx, L, x, y, bounce = 0) {
  const { u } = L;
  const r = 38 * u * (1 + bounce * 0.2);
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 14 * u;
  ctx.fillStyle = '#f2a541';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 5 * u;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.scale(r / (38 * u), r / (38 * u));
  ctx.rotate(-0.72);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-4 * u, -8 * u, 8 * u, 32 * u);
  ctx.fillStyle = BRAND.ink;
  ctx.fillRect(-16 * u, -22 * u, 32 * u, 15 * u);
  ctx.restore();
}

// --- the museum --------------------------------------------------------------------------------

// Everything in it comes out of the Model Database. `height` is feet tall, which is what a student
// gets by stretching, and `query` is what gets typed to find it: museumFor() throws if the real
// search does not show that model among the six cards on screen.
const ENTRANCE = { id: 'parthenon', query: 'parthenon', height: 25 };
const EXHIBITS = [
  { id: 'monarch-butterfly', query: 'monarch', height: 5, side: -1, row: 0 },
  { id: 'earth-layers', query: 'earth', height: 8, side: 1, row: 0 },
  { id: 'amethyst-geode', query: 'amethyst', height: 7.5, side: -1, row: 1 },
  { id: 'ming-vase', query: 'ming', height: 7, side: 1, row: 1 },
  { id: 'stegosaurus', query: 'stegosaurus', height: 9.5, side: -1, row: 2 },
  { id: 'saturn-v', query: 'saturn v', height: 21, side: 1, row: 2 },
];
// The one model the student is shown moving and stretching. It lands out of line and small.
const WORKED = 'amethyst-geode';

// The avenue runs toward -Z with the visitor walking down it, because the default theme's sun is
// at +Z: built the other way, the front of every exhibit and the whole Parthenon facade stood in
// their own shade. Every layout number below is distance along the avenue, and fz() turns one into
// a world z. It is its own inverse, so it also turns a world z back.
const FLIP = 110;
const fz = (z) => FLIP - z;
const ORIGIN_Z = 22;
const ROW_GAP = 21;
const AISLE = 15;

function placeOf(row, side) {
  return { x: side * AISLE, z: fz(ORIGIN_Z + 24 + row * ROW_GAP) };
}

function register(S, object3D, record) {
  const bulk = S.registry.bulkLoading;
  S.registry.bulkLoading = true;
  S.registry.add(record.id, object3D, { record, tick: object3D.userData.tick });
  S.registry.bulkLoading = bulk;
}

async function placeModel(S, id, { x, z, height = null, face }) {
  const entry = MODEL_BY_ID.get(id);
  const object3D = await buildCatalogModel(id);
  let scale = entry.scale ?? 1;
  object3D.scale.setScalar(scale);
  if (height) {
    const size = new THREE.Box3().setFromObject(object3D).getSize(new THREE.Vector3());
    scale *= height / size.y;
    object3D.scale.setScalar(scale);
  }
  object3D.position.set(x, S.groundAt(x, z) + (entry.hover ?? 0), z);
  object3D.rotation.y = face + (entry.yaw ?? 0);
  S.scene.add(object3D);
  const record = {
    id: uuid(),
    kind: 'catalog-model',
    createdAt: Date.now(),
    studio: true,
    model: id,
    connections: [],
    transform: { position: object3D.position.toArray(), rotation: [0, object3D.rotation.y, 0], scale: object3D.scale.toArray() },
  };
  register(S, object3D, record);
  object3D.visible = false;
  return { id, entry, object3D, scale, position: object3D.position.clone(), yaw: object3D.rotation.y };
}

// The same record Place an Info Sign writes, from the same fields of the same card.
function placeSign(S, item, side) {
  const { entry } = item;
  const category = modelCategory(entry.category);
  const box = new THREE.Box3().setFromObject(item.object3D);
  const x = item.position.x - side * (Math.max(box.max.x - box.min.x, 4) / 2 + 1.5);
  const z = box.max.z + 2.5;
  const options = {
    title: entry.title,
    eyebrow: category.label,
    accent: category.accent,
    body: `${entry.facts[0]} Real size: ${entry.realSize}.`,
  };
  const object3D = buildProp('info-placard', options);
  const face = Math.atan2(-side * 6, 24);
  object3D.position.set(x, S.groundAt(x, z), z);
  object3D.rotation.y = face;
  S.scene.add(object3D);
  register(S, object3D, {
    id: uuid(),
    kind: 'preset-prop',
    createdAt: Date.now(),
    studio: true,
    prop: 'info-placard',
    options,
    transform: { position: object3D.position.toArray(), rotation: [0, face, 0], scale: [1, 1, 1] },
  });
  object3D.visible = false;
  return object3D;
}

async function museumFor(S) {
  if (S.shared.museum) return S.shared.museum;
  // Clear the ground: My World's trees land at random, and a take has to come out the same twice.
  // Its boards go too, since the far end of the avenue reaches them.
  const doomed = [];
  for (const [id, item] of S.registry.items) {
    const k = item.record?.kind;
    if (k === 'world-theme' || k === 'world-spawn') continue;
    const p = item.object3D.position;
    if (Math.abs(p.x) < 70 && p.z > -70 && p.z < FLIP + 34) doomed.push(id);
  }
  for (const id of doomed) S.registry.remove(id);
  await preloadThumbs(['', ENTRANCE.query, ...EXHIBITS.map((e) => e.query)]);

  for (const { id, query } of [ENTRANCE, ...EXHIBITS]) {
    if (!searchModels(query, MODELS).slice(0, 6).some((m) => m.id === id)) throw new Error(`"${query}" does not show ${id}`);
  }
  const exhibits = [];
  for (const e of EXHIBITS) {
    const { x, z } = placeOf(e.row, e.side);
    // Turned toward the aisle and a little toward the door, the way a gallery hangs its pieces.
    const face = Math.atan2(-e.side * 12, 14);
    const item = await placeModel(S, e.id, { x, z, height: e.height, face });
    item.sign = placeSign(S, item, e.side);
    item.spec = e;
    exhibits.push(item);
  }
  const hall = await placeModel(S, ENTRANCE.id, { x: 0, z: 0, height: ENTRANCE.height, face: 0 });
  const box = new THREE.Box3().setFromObject(hall.object3D);
  const back = fz(placeOf(2, 1).z) + 18 + (box.max.z - box.min.z) / 2;
  hall.object3D.position.z = fz(back);
  hall.object3D.position.y = S.groundAt(0, fz(back));
  hall.position.copy(hall.object3D.position);
  S.shared.museum = { exhibits, hall, midZ: (ORIGIN_Z + back) / 2, backZ: back };
  return S.shared.museum;
}

function worked(M) {
  return M.exhibits.find((m) => m.id === WORKED);
}

// Before the hammer beat the worked model is off its mark, turned away, and at half size.
function posedWorked(M, k, g) {
  const m = worked(M);
  const off = 1 - k;
  m.object3D.position.set(m.position.x + 9 * off, m.position.y, m.position.z + 7 * off);
  m.object3D.rotation.y = m.yaw + 1.3 * off;
  m.object3D.scale.setScalar(m.scale * (0.5 + 0.5 * g));
}

function resetAll(M, { hall = false, exhibits = 0, signs = 0 }) {
  M.hall.object3D.visible = hall;
  M.hall.object3D.scale.setScalar(M.hall.scale);
  M.exhibits.forEach((m, i) => {
    m.object3D.visible = i < exhibits;
    m.object3D.scale.setScalar(m.scale);
    m.object3D.position.copy(m.position);
    m.object3D.rotation.y = m.yaw;
    m.sign.visible = i < signs;
    m.sign.scale.setScalar(1);
  });
}

const cam = (x, y, z) => new THREE.Vector3(x, y, fz(z));
function move(from, to, lookFrom, lookTo, p) {
  const k = p <= 1 ? p * 0.82 + 0.18 * smooth(p) : 1 + (p - 1) * 0.82;
  return { pos: from.clone().lerp(to, k), look: lookFrom.clone().lerp(lookTo, Math.min(k, 1.15)) };
}

const STEPS = 5;

function hookBeat(dur, words) {
  return {
    kind: 'hook',
    label: 'Hook',
    world: 'empty',
    dur,
    transition: 'cut',
    cues: [{ t: 0.1, sfx: 'whoosh', v: 0.8 }, { t: 0.55, sfx: 'sparkle', v: 0.7 }],
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, { hall: true, exhibits: 6, signs: 6 }); },
    pose(S, t) {
      const { midZ, backZ } = this.M;
      return move(cam(30, 18, ORIGIN_Z - 18), cam(-24, 14, ORIGIN_Z - 10), cam(0, 8, midZ + 8), cam(0, 9, backZ - 12), t / this.dur);
    },
    draw(ctx, L, S, t) {
      drawConfetti(ctx, L, t - 0.2, this.dur);
      drawHeadline(ctx, L, { text: words.hook, sub: words.sub, t, start: 0.12, end: this.dur - 0.08 });
    },
  };
}

function openBeat(dur) {
  const click = dur * 0.5;
  return {
    kind: 'build',
    label: 'Open the Database',
    world: 'empty',
    dur,
    transition: 'dissolve',
    cues: [{ t: 0, sfx: 'whoosh', v: 0.5 }, { t: click, sfx: 'tap' }, { t: click + 0.05, sfx: 'pop', v: 0.8 }],
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, {}); },
    pose(S, t) {
      return move(cam(0, 6, ORIGIN_Z - 12), cam(0, 5.5, ORIGIN_Z - 8), cam(0, 5, ORIGIN_Z + 40), cam(0, 5, ORIGIN_Z + 40), t / this.dur);
    },
    draw(ctx, L, S, t) {
      const { u, safe } = L;
      drawTutorialStep(ctx, L, { n: 1, of: STEPS, text: 'Open the Model Database', t, start: 0.12, end: this.dur - 0.05 });
      const menu = menuLayout(L, {
        x: safe.x0,
        y: L.top + 118 * u,
        rows: ['Get More Worlds', 'Save World', 'Load World File', 'Model Database', 'Create Model', 'Look Around'],
      });
      const row = menu.rows[3];
      const near = { x: row.x + row.w * 0.7, y: row.y + row.h * 0.55 };
      if (t < click + 0.22) {
        drawMenu(ctx, L, menu, {
          title: 'Menu',
          hot: t > click - 0.2 ? 'Model Database' : null,
          colours: { 'Get More Worlds': '#2f8f62', 'Save World': '#c9822a', 'Load World File': '#c9822a', 'Model Database': BRAND.blue },
          pop: outBack(clamp01((t - 0.2) / 0.3)),
          alpha: clamp01((click + 0.22 - t) / 0.12),
        });
      }
      const k = clamp01((t - click - 0.1) / 0.3);
      if (k > 0) drawDatabase(ctx, L, { query: '', scale: 0.86 + 0.14 * outBack(k), alpha: clamp01(k * 2) });
      drawPointer(ctx, L, [
        { t: 0.2, x: (safe.x0 + safe.x1) * 0.62, y: safe.y1 - 120 * u },
        { t: click, x: near.x, y: near.y, click: true },
        { t: this.dur, x: near.x + 60 * u, y: near.y + 30 * u },
      ], t);
    },
  };
}

// The seconds a search-and-place takes inside `span`: type, press Place, the panel gets out of
// the way, the model arrives. Fixed at plan time, because the sound is mixed before any frame.
function placingTimes(start, span, query) {
  const typeEnd = start + Math.min(span * 0.34, 0.1 + query.length * 0.075);
  const press = start + span * 0.62;
  const shut = press + span * 0.1;
  return { start, typeStart: start + 0.08, typeEnd, press, shut, pop: shut, end: start + span };
}

function placingCues(p, query) {
  const cues = [];
  for (let i = 0; i < query.length; i++) cues.push({ t: p.typeStart + (i * (p.typeEnd - p.typeStart)) / query.length, sfx: 'type', v: 0.7 });
  cues.push({ t: p.press, sfx: 'tap' }, { t: p.pop, sfx: 'pop' }, { t: p.pop + 0.3, sfx: 'place', v: 0.8 });
  return cues;
}

function drawPlacing(ctx, L, t, p, model, query) {
  if (t < p.start || t > p.shut + 0.14) return;
  const typed = query.length * clamp01((t - p.typeStart) / (p.typeEnd - p.typeStart));
  const inK = clamp01((t - p.start) / 0.14);
  const outK = clamp01((p.shut + 0.14 - t) / 0.14);
  drawDatabase(ctx, L, { query, typed, pressed: t >= p.press ? model : null, alpha: Math.min(inK, outK), scale: 0.96 + 0.04 * inK });
  const card = databaseLayout(L, query).cards.find((c) => c.model.id === model);
  const b = card.place;
  const s = databaseLayout(L, '').search;
  drawPointer(ctx, L, [
    { t: p.start, x: s.x + s.w * 0.4, y: s.y + s.h * 0.7 },
    { t: p.typeEnd, x: s.x + s.w * 0.4, y: s.y + s.h * 0.7 },
    { t: p.press, x: b.x + b.w * 0.6, y: b.y + b.h * 0.6, click: true },
    { t: p.shut + 0.14, x: b.x + b.w * 0.6, y: b.y + b.h * 0.6 },
  ], t);
}

function entranceBeat(dur) {
  const p = placingTimes(0.1, dur * 0.72, ENTRANCE.query);
  return {
    kind: 'build',
    label: 'Place the entrance',
    world: 'empty',
    dur,
    transition: 'cut',
    cues: [...placingCues(p, ENTRANCE.query), { t: p.pop, sfx: 'sparkle' }],
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, {}); },
    update(S, t) {
      const { hall } = this.M;
      hall.object3D.visible = t >= p.pop;
      if (t >= p.pop) hall.object3D.scale.setScalar(hall.scale * Math.max(0.001, outBack((t - p.pop) / 0.55)));
    },
    pose(S, t) {
      const { backZ } = this.M;
      return move(cam(32, 10, backZ - 135), cam(22, 13, backZ - 112), cam(0, 10, backZ), cam(0, 11, backZ), t / this.dur);
    },
    draw(ctx, L, S, t) {
      drawTutorialStep(ctx, L, { n: 2, of: STEPS, text: 'Search, then click Place', t, start: 0.08, end: this.dur - 0.05 });
      drawPlacing(ctx, L, t, p, ENTRANCE.id, ENTRANCE.query);
      if (t >= p.pop) drawPopStars(ctx, L, S, this.M.hall.object3D, t - p.pop);
      drawToast(ctx, L, { text: 'The Parthenon placed!', t, start: p.pop + 0.2, end: this.dur - 0.05 });
    },
  };
}

function exhibitsBeat(dur) {
  const span = dur / EXHIBITS.length;
  const times = EXHIBITS.map((e, i) => placingTimes(i * span + 0.05, span * 0.92, e.query));
  return {
    kind: 'build',
    label: 'Add exhibits',
    world: 'empty',
    dur,
    transition: 'dissolve',
    cues: times.flatMap((p, i) => placingCues(p, EXHIBITS[i].query)),
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, { hall: true }); },
    update(S, t) {
      posedWorked(this.M, 0, 0);
      this.M.exhibits.forEach((m, i) => {
        const p = times[i];
        m.object3D.visible = t >= p.pop;
        if (t >= p.pop) {
          const base = m.id === WORKED ? m.scale * 0.5 : m.scale;
          m.object3D.scale.setScalar(base * Math.max(0.001, outBack((t - p.pop) / 0.5)));
        }
      });
    },
    pose(S, t) {
      const { midZ } = this.M;
      return move(cam(-10, 19, ORIGIN_Z - 12), cam(10, 19, ORIGIN_Z - 12), cam(0, 5, midZ), cam(0, 5, midZ + 4), t / this.dur);
    },
    draw(ctx, L, S, t) {
      drawTutorialStep(ctx, L, { n: 3, of: STEPS, text: 'Keep adding exhibits', t, start: 0.08, end: this.dur - 0.05 });
      this.M.exhibits.forEach((m, i) => {
        const p = times[i];
        drawPlacing(ctx, L, t, p, m.id, m.spec.query);
        if (t >= p.pop) drawPopStars(ctx, L, S, m.object3D, t - p.pop);
        drawToast(ctx, L, { text: `${m.entry.title} placed!`, t, start: p.pop + 0.08, end: p.end - 0.02 });
      });
    },
  };
}

const HAMMER_ROWS = ['Stretch to Shape', 'Rotate/Move Shape', 'Reset Shape', 'About this Model'];

// The hammer: move it into line, then stretch it. Both are the real controls' real names.
function hammerBeat(dur, makeGizmo) {
  const K = dur / 11;
  const T = { click: 1.3 * K, pick: 2.4 * K, moved: 5.2 * K, click2: 5.9 * K, pick2: 6.9 * K, stretched: 9.6 * K };
  return {
    kind: 'build',
    label: 'Move and stretch',
    world: 'empty',
    dur,
    transition: 'dissolve',
    cues: [
      { t: T.click, sfx: 'tap' }, { t: T.pick, sfx: 'tap' }, { t: T.pick + 0.25, sfx: 'stretch', v: 0.7 }, { t: T.moved, sfx: 'place' },
      { t: T.click2, sfx: 'tap' }, { t: T.pick2, sfx: 'tap' }, { t: T.pick2 + 0.25, sfx: 'stretch' }, { t: T.stretched, sfx: 'sparkle' },
    ],
    async setup(S) {
      this.M = await museumFor(S);
      resetAll(this.M, { hall: true, exhibits: 6 });
      posedWorked(this.M, 0, 0);
      this.gizmo = makeGizmo(S.scene);
    },
    update(S, t) {
      posedWorked(this.M, smooth((t - T.pick - 0.2) / (T.moved - T.pick - 0.4)), smooth((t - T.pick2 - 0.2) / (T.stretched - T.pick2 - 0.4)));
      const on = (t > T.pick && t < T.moved + 0.2) || (t > T.pick2 && t < T.stretched + 0.2);
      if (on) this.gizmo.fit([worked(this.M).object3D], { showLift: t < T.moved + 0.2, alpha: 1 });
      else this.gizmo.hide();
    },
    pose(S, t) {
      const m = worked(this.M);
      const along = fz(m.position.z);
      const c = cam(m.position.x + 3.5, m.position.y + 3.8, along - 3);
      return move(cam(m.position.x + 11, 9.5, along - 28), cam(m.position.x + 7, 9, along - 25), c, c, t / this.dur);
    },
    draw(ctx, L, S, t) {
      const { u, safe } = L;
      const first = t < T.moved + 0.3;
      drawTutorialStep(ctx, L, { n: 4, of: STEPS, text: first ? 'Click the hammer to move it' : 'Stretch it to any size', t, start: 0.08, end: this.dur - 0.05 });
      const m = worked(this.M);
      const box = new THREE.Box3().setFromObject(m.object3D);
      const top = S.project(new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 1.6, (box.min.z + box.max.z) / 2));
      if (!top) return;
      if (t < T.click + 0.2 || (t > T.moved && t < T.click2 + 0.2)) drawHammer(ctx, L, top.x, top.y, Math.max(0, Math.sin(t * 7)) * 0.6);
      const menu = menuLayout(L, { x: safe.x0 + 8 * u, y: L.top + 120 * u, rows: HAMMER_ROWS });
      const moveRow = menu.rows[1];
      const stretchRow = menu.rows[0];
      const aim = (r) => ({ x: r.x + r.w * 0.7, y: r.y + r.h * 0.6 });
      const inMenu = (t > T.click && t < T.pick + 0.18) || (t > T.click2 && t < T.pick2 + 0.18);
      if (inMenu) {
        const second = t > T.click2;
        drawMenu(ctx, L, menu, {
          title: `Build Piece · ${m.entry.title}`,
          hot: t > (second ? T.pick2 : T.pick) - 0.18 ? (second ? stretchRow : moveRow).text : null,
          pop: outBack(clamp01((t - (second ? T.click2 : T.click)) / 0.25)),
        });
      }
      // The pointer follows things that move, so each leg is built from where they are now.
      const centre = S.project(box.getCenter(new THREE.Vector3())) || top;
      const corner = S.project(new THREE.Vector3(box.max.x, box.max.y, box.max.z)) || top;
      const path = t < T.moved
        ? [{ t: 0.2, x: safe.x0 + 200 * u, y: safe.y1 - 120 * u }, { t: T.click, ...top, click: true }, { t: T.pick, ...aim(moveRow), click: true }, { t: T.pick + 0.5, ...centre }]
        : [{ t: T.moved, ...centre }, { t: T.click2, ...top, click: true }, { t: T.pick2, ...aim(stretchRow), click: true }, { t: T.pick2 + 0.5, ...corner }];
      drawPointer(ctx, L, path, t);
      if (t >= T.stretched) drawPopStars(ctx, L, S, m.object3D, t - T.stretched);
    },
    teardown() { this.gizmo?.dispose(); },
  };
}

function signBeat(dur) {
  const K = dur / 8;
  const T = { about: 0.9 * K, place: 3.2 * K, rest: 3.9 * K };
  const others = EXHIBITS.length - 1;
  const stagger = (dur - T.rest - 0.5) / others;
  const cues = [{ t: T.about, sfx: 'tap' }, { t: T.place, sfx: 'tap' }, { t: T.place + 0.08, sfx: 'pop' }];
  for (let i = 0; i < others; i++) cues.push({ t: T.rest + i * stagger, sfx: 'pop', v: 0.7 });
  return {
    kind: 'build',
    label: 'Info signs',
    world: 'empty',
    dur,
    transition: 'dissolve',
    cues,
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, { hall: true, exhibits: 6 }); },
    update(S, t) {
      [worked(this.M), ...this.M.exhibits.filter((m) => m.id !== WORKED)].forEach((m, i) => {
        const at = i === 0 ? T.place + 0.08 : T.rest + (i - 1) * stagger;
        m.sign.visible = t >= at;
        if (t >= at) m.sign.scale.setScalar(Math.max(0.001, outBack((t - at) / 0.4)));
      });
    },
    pose(S, t) {
      const m = worked(this.M);
      const along = fz(m.position.z);
      const k = smooth((t - T.rest) / (this.dur - T.rest));
      return {
        pos: cam(m.position.x + 9, 7, along - 18).lerp(cam(0, 17, ORIGIN_Z - 12), k),
        look: cam(m.position.x + 2, 4.5, along - 2).lerp(cam(0, 7, this.M.midZ), k),
      };
    },
    draw(ctx, L, S, t) {
      const { u, safe } = L;
      drawTutorialStep(ctx, L, { n: 5, of: STEPS, text: 'Add an Info Sign', t, start: 0.08, end: this.dur - 0.05 });
      const m = worked(this.M);
      if (t < T.place + 0.15) {
        const x = safe.x0 + 15 * u;
        const y = L.top + 120 * u;
        if (t <= T.about) {
          const menu = menuLayout(L, { x, y, rows: HAMMER_ROWS });
          drawMenu(ctx, L, menu, { title: `Build Piece · ${m.entry.title}`, hot: t > T.about - 0.2 ? 'About this Model' : null, pop: outBack(clamp01(t / 0.25)) });
          const r = menu.rows[3];
          drawPointer(ctx, L, [{ t: 0.1, x: x + 520 * u, y: y + 340 * u }, { t: T.about, x: r.x + r.w * 0.7, y: r.y + r.h * 0.6, click: true }], t);
        } else {
          const w = safe.x1 - safe.x0 - 30 * u;
          const h = 310 * u;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.5)';
          ctx.shadowBlur = 26 * u;
          ctx.fillStyle = 'rgba(24, 28, 33, 0.97)';
          rrect(ctx, x, y, w, h, 18 * u);
          ctx.fill();
          ctx.shadowColor = 'transparent';
          font(ctx, 700, 38 * u, FONT.display);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(m.entry.title, x + 24 * u, y + 58 * u);
          font(ctx, 700, 29 * u);
          ctx.fillStyle = '#d7dee6';
          let ly = y + 108 * u;
          let line = '';
          for (const word of m.entry.facts[0].split(' ')) {
            if (line && ctx.measureText(`${line} ${word}`).width > w - 48 * u) {
              ctx.fillText(line, x + 24 * u, ly);
              ly += 38 * u;
              line = word;
            } else line = line ? `${line} ${word}` : word;
          }
          ctx.fillText(line, x + 24 * u, ly);
          const b = { x: x + 24 * u, y: y + h - 94 * u, w: w - 48 * u, h: 68 * u };
          const hot = t > T.place - 0.15;
          ctx.fillStyle = hot ? BRAND.sun : BRAND.purple;
          rrect(ctx, b.x, b.y, b.w, b.h, 12 * u);
          ctx.fill();
          font(ctx, 800, 30 * u);
          ctx.fillStyle = hot ? BRAND.ink : '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText('Place an Info Sign', b.x + b.w / 2, b.y + b.h * 0.65);
          ctx.restore();
          drawPointer(ctx, L, [{ t: T.about, x: b.x + b.w * 0.8, y: b.y - 90 * u }, { t: T.place, x: b.x + b.w * 0.6, y: b.y + b.h * 0.6, click: true }], t);
        }
      }
      drawToast(ctx, L, { text: 'Info sign placed beside it.', t, start: T.place + 0.15, end: T.rest + 1 });
    },
  };
}

function tourBeat(dur) {
  return {
    kind: 'world',
    label: 'Walk through it',
    world: 'empty',
    dur,
    transition: 'dissolve',
    cues: [{ t: 0, sfx: 'whoosh', v: 0.6 }, { t: 0.25, sfx: 'sparkle' }, { t: dur - 1.2, sfx: 'sparkle', v: 0.6 }],
    async setup(S) { this.M = await museumFor(S); resetAll(this.M, { hall: true, exhibits: 6, signs: 6 }); },
    pose(S, t) {
      const p = t / this.dur;
      const z = ORIGIN_Z + 2 + 52 * (p <= 1 ? p : 1 + (p - 1) * 0.5);
      const x = Math.sin(p * Math.PI * 2) * 3;
      return { pos: cam(x, S.groundAt(x, z) + 5.5, z), look: cam(x * 0.2 + Math.sin(p * Math.PI * 2 + 0.8) * 7, 7, z + 26) };
    },
    draw(ctx, L, S, t) {
      drawConfetti(ctx, L, t, this.dur);
      drawHeadline(ctx, L, { text: 'Your museum is *open!*', sub: 'Press Save World to share it', t, start: 0.15, end: this.dur - 0.05, maxLines: 2 });
    },
  };
}

// Nominal seconds for each beat; buildPlan scales them to the length asked for and snaps the cuts
// to the music, which is why every beat above works its timings out from the `dur` it is given.
export function museumSpec({ words, makeGizmo, endBeat }) {
  return [
    [4, (d) => hookBeat(d, words)],
    [5, (d) => openBeat(d)],
    [7, (d) => entranceBeat(d)],
    [15, (d) => exhibitsBeat(d)],
    [11, (d) => hammerBeat(d, makeGizmo)],
    [8, (d) => signBeat(d)],
    [6, (d) => tourBeat(d)],
    [4, (d, prev) => endBeat({ dur: d, words, world: prev })],
  ];
}
