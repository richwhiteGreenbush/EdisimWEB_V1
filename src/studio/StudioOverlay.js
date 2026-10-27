import { BLOCK_DEFS, CATEGORIES } from '../BlockDefs.js';
import { highlightJs } from '../JsProgram.js';

// Everything the Social Media Studio draws OVER the 3D frame, drawn straight into the 2D
// canvas that becomes the video.
//
// It cannot be DOM. The video is encoded from a canvas, and nothing composited over a
// canvas by the page -- an HTML caption, the app's own program editor, a CSS3D browser
// panel -- is in that canvas. So every caption, every program card and the end card are
// drawn here, with the same block colours (CATEGORIES) and the same JavaScript highlighter
// (highlightJs) the app itself uses, which is what makes a block on screen in a video the
// block a viewer then finds in the palette.
//
// Units: every size is in `u`, which is 1px on a 1080px-wide portrait frame and scales
// with the frame, so one set of numbers serves all four formats.

export const FONT = {
  display: '"Fredoka", "Nunito", system-ui, sans-serif',
  body: '"Nunito", system-ui, sans-serif',
  brand: '"Gluten", "Fredoka", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

// The marketing site's own palette (docs/styles.css) -- the amber ramp is the wordmark's.
export const BRAND = {
  amber: ['#ffe0ad', '#f7ac47', '#ef8524', '#d9691a', '#b04f12'],
  cream: '#fdf0d8',
  blue: '#3d8bf2',
  night: '#10283f',
  denim: '#246c9d',
  green: '#3fb37f',
  red: '#e0455f',
  purple: '#8a5cf5',
  sun: '#ffc93c',
  ink: '#1e2a3a',
};

const CODE_COLOURS = {
  'js-k': '#c792ea', 'js-s': '#c3e88d', 'js-n': '#f78c6c', 'js-c': '#6b7d8c', 'js-f': '#82aaff', plain: '#e8eef4',
};

// --- easing --------------------------------------------------------------------------------

export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
export const outCubic = (x) => 1 - (1 - clamp01(x)) ** 3;
export const outBack = (x) => {
  const t = clamp01(x);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

// How far into its entrance and its exit an element is, for something shown from `start`
// to `end` seconds of a beat.
export function life(t, start, end, inDur = 0.35, outDur = 0.3) {
  const kin = clamp01((t - start) / inDur);
  const kout = clamp01((end - t) / outDur);
  return { kin, kout, visible: t >= start && t <= end, alpha: Math.min(kin, kout) };
}

// --- layout -------------------------------------------------------------------------------

// Where things may go in each format. The SAFE box is what the platforms' own interface
// leaves alone: on a Reel the top ~11% carries the "Reels" title and camera icon, the
// bottom ~22% the caption, username and audio line, and the right edge the like/comment/
// share column. Anything a viewer has to read stays inside it.
export function layoutFor(format, W, H) {
  const portrait = H > W;
  const u = Math.min(W, H) / 1080;
  const L = { W, H, u, portrait, id: format.id };
  // `card` is where the program card may go (its top is a minimum: on the portrait formats
  // it sits on the bottom of the safe box and grows upward). `subject` is where on screen
  // the thing being programmed is held while the card is up, and `span` how much of the
  // frame it has to itself there -- a camera that framed it for the whole frame would put
  // half of it behind the card.
  if (format.id === 'reel') {
    L.safe = { x0: 70 * u, y0: 230 * u, x1: W - 150 * u, y1: H - 430 * u };
    L.headlineSize = 104 * u;
    L.card = { x: 70 * u, y: H * 0.42, w: W - 220 * u, maxH: H - 430 * u - H * 0.42 };
    L.subject = { x: 0.5, y: 0.29 };
    L.span = { w: 0.9, h: 0.31 };
  } else if (format.id === 'portrait') {
    L.safe = { x0: 64 * u, y0: 70 * u, x1: W - 64 * u, y1: H - 90 * u };
    L.headlineSize = 92 * u;
    L.card = { x: 64 * u, y: H * 0.46, w: W - 128 * u, maxH: H * 0.54 - 90 * u };
    L.subject = { x: 0.5, y: 0.27 };
    L.span = { w: 0.9, h: 0.36 };
  } else if (format.id === 'square') {
    L.safe = { x0: 64 * u, y0: 64 * u, x1: W - 64 * u, y1: H - 64 * u };
    L.headlineSize = 86 * u;
    L.card = { x: 64 * u, y: H * 0.24, w: W * 0.56, maxH: H * 0.76 - 64 * u };
    L.subject = { x: 0.76, y: 0.55 };
    L.span = { w: 0.42, h: 0.75 };
  } else {
    L.safe = { x0: 90 * u, y0: 64 * u, x1: W - 90 * u, y1: H - 74 * u };
    L.headlineSize = 88 * u;
    L.card = { x: 90 * u, y: H * 0.24, w: W * 0.45, maxH: H * 0.76 - 74 * u };
    L.subject = { x: 0.71, y: 0.55 };
    L.span = { w: 0.5, h: 0.75 };
  }
  // The corner wordmark sits at the top of the safe box, and everything else that lives at
  // the top of the frame -- headline, banner, step chip -- starts underneath it. On a Reel it
  // must be INSIDE the safe box too: above it is where Instagram prints "Reels".
  L.top = L.safe.y0 + (L.portrait ? 88 : 80) * u;
  return L;
}

// --- primitives ---------------------------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function setFont(ctx, weight, size, family) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
}

function amberGradient(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  BRAND.amber.forEach((c, i) => g.addColorStop(i / (BRAND.amber.length - 1), c));
  return g;
}

// Words of `text`, with *starred* words marked for the highlight colour.
// A starred phrase "*like this*" may span several words, so it is tracked across them.
function parseWords(text) {
  const rawWords = String(text || '').split(/\s+/).filter(Boolean);
  let open = false;
  return rawWords.map((raw) => {
    const starts = raw.startsWith('*');
    const ends = /\*[.,!?:;'"]*$/.test(raw) && raw.replace(/\*/g, '').length > 0;
    if (starts) open = true;
    const word = { text: raw.replace(/\*/g, ''), hi: open };
    if (ends) open = false;
    return word;
  });
}

// Lay words into lines no wider than maxW at the given font. Returns rows of {words, width}.
function wrapWords(ctx, words, maxW, space) {
  const lines = [];
  let line = [];
  let width = 0;
  for (const w of words) {
    const ww = ctx.measureText(w.text).width;
    const add = line.length ? space + ww : ww;
    if (line.length && width + add > maxW) {
      lines.push({ words: line, width });
      line = [];
      width = 0;
    }
    w.width = ww;
    width += line.length ? space + ww : ww;
    line.push(w);
  }
  if (line.length) lines.push({ words: line, width });
  return lines;
}

// --- the overlay elements ------------------------------------------------------------------

// The big line that stops the scroll. Words pop in one after another, *starred* words in
// the wordmark's amber, and the whole block lifts away at the end.
export function drawHeadline(ctx, L, { text, sub = '', t, start = 0, end, anchorY = null, size = null, maxLines = 3 }) {
  if (!text || t < start || t > end) return;
  const { u, safe } = L;
  const maxW = safe.x1 - safe.x0;
  let fs = size || L.headlineSize;
  const words = parseWords(text);
  let lines;
  for (;;) {
    setFont(ctx, 700, fs, FONT.display);
    lines = wrapWords(ctx, words, maxW, fs * 0.26);
    if (lines.length <= maxLines || fs < 40 * u) break;
    fs *= 0.92;
  }
  const lineH = fs * 1.08;
  const blockH = lines.length * lineH;
  const top = anchorY ?? L.top;
  const outK = clamp01((end - t) / 0.35);
  const lift = (1 - outK) * -40 * u;
  const cx = (safe.x0 + safe.x1) / 2;

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  let wi = 0;
  lines.forEach((line, li) => {
    let x = cx - line.width / 2;
    const baseY = top + (li + 0.82) * lineH + lift;
    for (const w of line.words) {
      const k = clamp01((t - start - wi * 0.07) / 0.42);
      const s = 0.55 + 0.45 * outBack(k);
      const a = Math.min(clamp01(k * 2.2), outK);
      if (a > 0.001) {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.translate(x + w.width / 2, baseY - fs * 0.35);
        ctx.scale(s, s);
        ctx.translate(-(x + w.width / 2), -(baseY - fs * 0.35));
        setFont(ctx, 700, fs, FONT.display);
        ctx.shadowColor = 'rgba(8, 20, 34, 0.55)';
        ctx.shadowBlur = 22 * u;
        ctx.shadowOffsetY = 6 * u;
        ctx.strokeStyle = 'rgba(12, 30, 48, 0.88)';
        ctx.lineWidth = fs * 0.14;
        ctx.strokeText(w.text, x, baseY);
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = w.hi ? amberGradient(ctx, baseY - fs * 0.8, baseY + fs * 0.1) : '#ffffff';
        ctx.fillText(w.text, x, baseY);
        ctx.restore();
      }
      x += w.width + fs * 0.26;
      wi++;
    }
  });

  if (sub) {
    const k = clamp01((t - start - 0.25 - wi * 0.07) / 0.4);
    const a = Math.min(k, outK);
    if (a > 0.001) {
      const ss = Math.max(30 * u, fs * 0.38);
      setFont(ctx, 800, ss, FONT.body);
      const tw = Math.min(ctx.measureText(sub).width, maxW - 40 * u);
      const padX = 26 * u;
      const h = ss * 1.7;
      const y = top + blockH + 22 * u + lift + (1 - outCubic(k)) * 18 * u;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(12, 30, 48, 0.62)';
      roundRect(ctx, cx - tw / 2 - padX, y, tw + padX * 2, h, h / 2);
      ctx.fill();
      ctx.fillStyle = BRAND.cream;
      ctx.textAlign = 'center';
      ctx.fillText(sub, cx, y + h * 0.68, maxW - 40 * u);
      ctx.textAlign = 'left';
    }
  }
  ctx.restore();
}

// The name of the place, bottom left, like a documentary's lower third.
export function drawLowerThird(ctx, L, { title, sub = '', t, start = 0, end, accent = BRAND.sun }) {
  if (!title) return;
  const { visible, kin, kout } = life(t, start, end, 0.45, 0.3);
  if (!visible) return;
  const { u, safe } = L;
  const ts = L.portrait ? 60 * u : 54 * u;
  const ss = ts * 0.58;
  ctx.save();
  setFont(ctx, 700, ts, FONT.display);
  const maxW = safe.x1 - safe.x0 - 60 * u;
  const tw = Math.min(ctx.measureText(title).width, maxW);
  setFont(ctx, 700, ss, FONT.body);
  const sw = sub ? Math.min(ctx.measureText(sub).width, maxW) : 0;
  const w = Math.max(tw, sw) + 64 * u;
  const h = sub ? ts * 1.0 + ss * 1.55 + 34 * u : ts * 1.0 + 34 * u;
  const x = safe.x0 - (1 - outCubic(kin)) * (w + 80 * u);
  const y = safe.y1 - h;
  ctx.globalAlpha = kout;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24 * u;
  ctx.fillStyle = 'rgba(14, 34, 54, 0.82)';
  roundRect(ctx, x, y, w, h, 22 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = accent;
  roundRect(ctx, x, y, 12 * u, h, 6 * u);
  ctx.fill();
  setFont(ctx, 700, ts, FONT.display);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(title, x + 36 * u, y + 18 * u + ts * 0.82, maxW);
  if (sub) {
    setFont(ctx, 700, ss, FONT.body);
    ctx.fillStyle = BRAND.cream;
    ctx.globalAlpha = kout * clamp01((t - start - 0.15) / 0.3);
    ctx.fillText(sub, x + 36 * u, y + 18 * u + ts + ss * 1.15, maxW);
  }
  ctx.restore();
}

// A chip across the top: "Explore ready-made worlds". Carries a theme across several shots.
export function drawBand(ctx, L, { text, alpha = 1, colour = BRAND.blue }) {
  if (!text || alpha <= 0.001) return;
  const { u, safe } = L;
  const fs = L.portrait ? 46 * u : 40 * u;
  ctx.save();
  setFont(ctx, 700, fs, FONT.display);
  const tw = Math.min(ctx.measureText(text).width, safe.x1 - safe.x0 - 80 * u);
  const h = fs * 1.75;
  const w = tw + 70 * u;
  const cx = (safe.x0 + safe.x1) / 2;
  const y = L.top + (1 - outCubic(alpha)) * -30 * u;
  ctx.globalAlpha = alpha;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 18 * u;
  ctx.fillStyle = colour;
  roundRect(ctx, cx - w / 2, y, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y + h * 0.66, safe.x1 - safe.x0 - 80 * u);
  ctx.restore();
}

// "1  Drop a shape" -- a numbered step, top of frame.
export function drawStep(ctx, L, { n, text, t, start, end }) {
  const { visible, kin, kout } = life(t, start, end, 0.3, 0.25);
  if (!visible || !text) return;
  const { u, safe } = L;
  const fs = L.portrait ? 52 * u : 46 * u;
  const d = fs * 1.5;
  ctx.save();
  setFont(ctx, 700, fs, FONT.display);
  const tw = Math.min(ctx.measureText(text).width, safe.x1 - safe.x0 - d - 80 * u);
  const w = d + tw + 58 * u;
  const h = d + 20 * u;
  const cx = (safe.x0 + safe.x1) / 2;
  const x = cx - w / 2;
  const y = L.top + (1 - outBack(kin)) * -24 * u;
  ctx.globalAlpha = Math.min(clamp01(kin * 1.5), kout);
  ctx.shadowColor = 'rgba(0,0,0,0.32)';
  ctx.shadowBlur = 20 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (n != null) {
    ctx.fillStyle = BRAND.amber[2];
    ctx.beginPath();
    ctx.arc(x + 10 * u + d / 2, y + h / 2, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(String(n), x + 10 * u + d / 2, y + h / 2 + fs * 0.36);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = BRAND.ink;
  ctx.fillText(text, x + (n != null ? d + 30 * u : 30 * u), y + h / 2 + fs * 0.36, tw);
  ctx.restore();
}

// The small wordmark in the corner of every shot but the last.
export function drawWatermark(ctx, L, alpha = 1) {
  if (alpha <= 0.001) return;
  const { u, safe } = L;
  const fs = (L.portrait ? 54 : 50) * u;
  ctx.save();
  ctx.globalAlpha = 0.92 * alpha;
  setFont(ctx, 800, fs, FONT.brand);
  const x = safe.x0;
  const finalY = safe.y0 + fs * 0.85;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10 * u;
  ctx.strokeStyle = BRAND.cream;
  ctx.lineWidth = 7 * u;
  ctx.strokeText('Edusim', x, finalY);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = amberGradient(ctx, finalY - fs * 0.85, finalY + fs * 0.1);
  ctx.fillText('Edusim', x, finalY);
  ctx.restore();
}

// --- the program card ---------------------------------------------------------------------

function flatten(blocks, depth = 0, out = []) {
  for (const b of blocks || []) {
    const def = BLOCK_DEFS[b.type];
    if (def?.hasChildren) {
      out.push({ block: b, depth, kind: 'top' });
      flatten(b.children, depth + 1, out);
      out.push({ block: b, depth, kind: 'bottom' });
    } else {
      out.push({ block: b, depth, kind: 'stack' });
    }
  }
  return out;
}

function fieldText(schema, value) {
  if (schema?.type === 'select') {
    return schema.options?.find((o) => o.value === value)?.label || String(value);
  }
  return String(value);
}

function measureBlock(ctx, block, fs, u) {
  const def = BLOCK_DEFS[block.type];
  let w = 22 * u;
  for (const tok of def.label) {
    if (tok.text) {
      setFont(ctx, 800, fs, FONT.body);
      w += ctx.measureText(tok.text).width + 12 * u;
    } else {
      const schema = def.params[tok.field];
      if (schema?.type === 'color') { w += fs * 1.25 + 12 * u; continue; }
      setFont(ctx, 800, fs * 0.92, FONT.body);
      w += ctx.measureText(fieldText(schema, block.params[tok.field])).width + 30 * u + 12 * u;
    }
  }
  return w + 10 * u;
}

function drawBlockLabel(ctx, block, x, y, h, fs, u) {
  const def = BLOCK_DEFS[block.type];
  let cx = x + 22 * u;
  const mid = y + h / 2;
  for (const tok of def.label) {
    if (tok.text) {
      setFont(ctx, 800, fs, FONT.body);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tok.text, cx, mid + fs * 0.36);
      cx += ctx.measureText(tok.text).width + 12 * u;
      continue;
    }
    const schema = def.params[tok.field];
    const value = block.params[tok.field];
    if (schema?.type === 'color') {
      const r = fs * 0.62;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + r, mid, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = value;
      ctx.beginPath();
      ctx.arc(cx + r, mid, r - 4 * u, 0, Math.PI * 2);
      ctx.fill();
      cx += r * 2 + 12 * u;
      continue;
    }
    const label = fieldText(schema, value);
    setFont(ctx, 800, fs * 0.92, FONT.body);
    const tw = ctx.measureText(label).width;
    const pw = tw + 30 * u;
    const ph = h * 0.68;
    const select = schema?.type === 'select';
    ctx.fillStyle = select ? 'rgba(0,0,0,0.18)' : '#ffffff';
    roundRect(ctx, cx, mid - ph / 2, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = select ? '#ffffff' : '#30394a';
    ctx.fillText(label, cx + 15 * u, mid + fs * 0.33);
    cx += pw + 12 * u;
  }
}

// Builds the block program a row at a time, in the same colours as the palette. `reveal`
// is how many blocks are showing, fractional for the one arriving.
function drawBlocks(ctx, L, { blocks, reveal, x, y, w, running, t, slide = 1 }) {
  const { u } = L;
  const rows = flatten(blocks);
  // Bigger on the phone formats: a Reel is watched on a screen five inches wide.
  let fs = ({ reel: 40, portrait: 36 }[L.id] || 34) * u;
  let rowH = fs * 1.75;
  const indent = 26 * u;

  // Shrink to fit the width, measured against the widest block.
  let widest = 0;
  for (const r of rows) {
    if (r.kind === 'bottom') continue;
    widest = Math.max(widest, measureBlock(ctx, r.block, fs, u) + r.depth * indent);
  }
  if (widest > w) {
    const k = w / widest;
    fs *= k;
    rowH *= k;
    widest = w;
  }

  // Which rows are visible: blocks appear in program order; a C-block's foot appears with it.
  let shown = 0;
  const order = new Map();
  for (const r of rows) {
    if (r.kind === 'bottom') continue;
    order.set(r.block, shown++);
  }
  const visibleRows = rows.filter((r) => order.get(r.block) < reveal);
  const footH = rowH * 0.42;

  let cy = y;
  const placed = [];
  for (const r of visibleRows) {
    const idx = order.get(r.block);
    const k = clamp01((reveal - idx) * slide);
    const h = r.kind === 'bottom' ? footH : rowH;
    placed.push({ ...r, y: cy, h, k });
    cy += h + 4 * u;
  }

  // Draw C-block arms first (they span from the head row to the foot row).
  for (const p of placed) {
    if (p.kind !== 'top') continue;
    const foot = placed.find((q) => q.kind === 'bottom' && q.block === p.block);
    if (!foot) continue;
    const cat = CATEGORIES[BLOCK_DEFS[p.block.type].category];
    const bx = x + p.depth * indent;
    ctx.fillStyle = cat.fill;
    ctx.fillRect(bx, p.y + p.h - 4 * u, 22 * u, foot.y - (p.y + p.h) + 8 * u);
  }

  for (const p of placed) {
    const def = BLOCK_DEFS[p.block.type];
    const cat = CATEGORIES[def.category];
    const bx = x + p.depth * indent;
    const slideX = (1 - outBack(p.k)) * 60 * u;
    ctx.save();
    ctx.globalAlpha = clamp01(p.k * 2);
    if (p.kind === 'bottom') {
      ctx.fillStyle = cat.fill;
      roundRect(ctx, bx, p.y, 150 * u * (fs / (34 * u)), p.h, 8 * u);
      ctx.fill();
      ctx.restore();
      continue;
    }
    const bw = measureBlock(ctx, p.block, fs, u);
    ctx.translate(slideX, 0);
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 6 * u;
    ctx.shadowOffsetY = 3 * u;
    ctx.fillStyle = cat.fill;
    roundRect(ctx, bx, p.y, bw, p.h, 10 * u);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = cat.dark;
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    if (def.hat) {
      ctx.fillStyle = cat.fill;
      ctx.beginPath();
      ctx.ellipse(bx + 50 * u, p.y + 2 * u, 46 * u, 14 * u, 0, Math.PI, 0);
      ctx.fill();
    }
    drawBlockLabel(ctx, p.block, bx, p.y, p.h, fs, u);
    ctx.restore();
  }

  // Running: the whole stack glows, the way the editor shows a live program.
  if (running && placed.length) {
    const pulse = 0.55 + 0.45 * Math.sin(t * 7);
    const top = placed[0].y;
    const bottom = placed[placed.length - 1].y + placed[placed.length - 1].h;
    const right = Math.max(...placed.filter((p) => p.kind !== 'bottom').map((p) => x + p.depth * indent + measureBlock(ctx, p.block, fs, u)));
    ctx.save();
    ctx.strokeStyle = `rgba(255, 213, 74, ${0.5 + 0.5 * pulse})`;
    ctx.lineWidth = 5 * u;
    ctx.shadowColor = 'rgba(255, 213, 74, 0.9)';
    ctx.shadowBlur = 22 * u * pulse;
    roundRect(ctx, x - 8 * u, top - 8 * u, right - x + 16 * u, bottom - top + 16 * u, 16 * u);
    ctx.stroke();
    ctx.restore();
  }
  return { height: cy - y, width: widest };
}

// Tokens of `code` as [{ text, colour, italic }], using the app's own highlighter so the
// card cannot disagree with the editor pane about what a keyword is.
function codeTokens(code) {
  const tpl = document.createElement('template');
  tpl.innerHTML = highlightJs(code);
  const out = [];
  for (const node of tpl.content.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out.push({ text: node.textContent, colour: CODE_COLOURS.plain });
    else out.push({ text: node.textContent, colour: CODE_COLOURS[node.className] || CODE_COLOURS.plain, italic: node.className === 'js-c' });
  }
  return out;
}

function drawCode(ctx, L, { code, typed, x, y, w, t }) {
  const { u } = L;
  const lines = code.replace(/\n$/, '').split('\n');
  const longest = Math.max(...lines.map((l) => l.length), 20);
  let fs = Math.min((L.portrait ? 30 : 29) * u, w / (longest * 0.62));
  const lineH = fs * 1.5;
  const tokens = codeTokens(code.replace(/\n$/, ''));
  let shown = Math.floor(typed);
  let cx = x;
  let cy = y + fs;
  let caret = null;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  for (const tok of tokens) {
    const parts = tok.text.split('\n');
    for (let p = 0; p < parts.length; p++) {
      if (p > 0) {
        cx = x;
        cy += lineH;
        if (shown <= 0) break;
        shown -= 1; // the newline itself
      }
      const piece = parts[p];
      if (!piece) continue;
      const visible = piece.slice(0, Math.max(0, shown));
      shown -= piece.length;
      setFont(ctx, tok.italic ? 'italic 500' : 600, fs, FONT.mono);
      ctx.fillStyle = tok.colour;
      ctx.fillText(visible, cx, cy);
      cx += ctx.measureText(visible).width;
      if (shown <= 0) {
        caret = { x: cx, y: cy };
        break;
      }
    }
    if (shown <= 0 && caret) break;
  }
  const blink = Math.floor(t * 2.4) % 2 === 0;
  if (caret && blink) {
    ctx.fillStyle = '#ffd54a';
    ctx.fillRect(caret.x + 2 * u, caret.y - fs * 0.85, 3 * u, fs * 1.05);
  }
  ctx.restore();
  return { height: lines.length * lineH + fs * 0.4, width: w };
}

// The Program panel, as a card. mode 'blocks' or 'js'; `flip` 0..1 turns it over from one
// to the other, the way the panel's own Block Code / JavaScript toggle swaps its body.
export function drawProgramCard(ctx, L, {
  t, start, end, title = 'Program', blocks = [], reveal = 0, slide = 1, code = '', typed = 0,
  flip = 0, running = false, runPressed = -1,
}) {
  const { visible, kin, kout } = life(t, start, end, 0.45, 0.4);
  if (!visible) return;
  const { u } = L;
  const mode = flip < 0.5 ? 'blocks' : 'js';
  const squash = Math.abs(Math.cos(flip * Math.PI));
  const pad = 30 * u;
  const headH = (L.portrait ? 74 : 66) * u;

  // Measure both bodies first, offscreen, so the card is sized to its content -- and to the
  // SAME size on both faces, or turning it over from blocks to JavaScript would also resize it.
  const maxBodyW = L.card.w - pad * 2;
  ctx.save();
  ctx.globalAlpha = 0;
  const bm = drawBlocks(ctx, L, { blocks, reveal: 1e9, x: -1e5, y: 0, w: maxBodyW, running: false, t });
  const cm = code ? drawCode(ctx, L, { code, typed: 0, x: -1e5, y: 0, w: maxBodyW, t }) : { height: 0, width: 0 };
  ctx.restore();
  // The blocks face is as wide as its widest block; the code face takes the full width. The
  // flip grows one into the other while the card is edge-on, so the cut from a blocks beat
  // into the JavaScript beat that turns it over never jumps.
  const minW = (L.portrait ? 640 : 560) * u;
  const blocksW = Math.min(L.card.w, Math.max(minW, bm.width + pad * 2 + 24 * u));
  const k = clamp01(flip);
  const cardW = blocksW + (L.card.w - blocksW) * k;
  const bodyH = bm.height + (cm.height - bm.height) * k;
  const h = Math.min(L.card.maxH, headH + pad + bodyH + pad);
  // Centred on the portrait formats, where the card sits under the subject; on the left
  // where it sits beside it.
  const cardX = L.portrait ? (L.safe.x0 + L.safe.x1) / 2 - cardW / 2 : L.card.x;
  const card = { x: cardX, w: cardW };
  const bodyW = cardW - pad * 2;
  const cardY = L.id === 'reel' ? Math.max(L.card.y, L.safe.y1 - h) : L.card.y;

  ctx.save();
  const slideY = (1 - outCubic(kin)) * 120 * u;
  ctx.globalAlpha = Math.min(clamp01(kin * 1.6), kout);
  const cx = card.x + card.w / 2;
  ctx.translate(cx, cardY + slideY);
  ctx.scale(Math.max(0.02, squash), 1);
  ctx.translate(-cx, -cardY);

  const dark = mode === 'js';
  ctx.shadowColor = 'rgba(0,0,0,0.38)';
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 12 * u;
  ctx.fillStyle = dark ? 'rgba(20, 30, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)';
  roundRect(ctx, card.x, cardY, card.w, h, 28 * u);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // Header: title, the Block Code | JavaScript toggle, and Run.
  ctx.save();
  roundRect(ctx, card.x, cardY, card.w, h, 28 * u);
  ctx.clip();
  ctx.fillStyle = dark ? '#0f1822' : '#eef3fa';
  ctx.fillRect(card.x, cardY, card.w, headH);
  ctx.restore();
  const hs = headH * 0.36;
  setFont(ctx, 700, hs * 1.15, FONT.display);
  ctx.fillStyle = dark ? '#e8eef4' : BRAND.ink;
  ctx.fillText(title, card.x + pad, cardY + headH * 0.64);
  const titleW = ctx.measureText(title).width;

  setFont(ctx, 800, hs * 0.82, FONT.body);
  const tabs = ['Block Code', 'JavaScript'];
  const tabW = tabs.map((s) => ctx.measureText(s).width + 30 * u);
  const runW = 112 * u;
  let tx = card.x + pad + titleW + 24 * u;
  const space = card.x + card.w - pad - runW - 16 * u - tx;
  const tabsW = tabW[0] + tabW[1] + 6 * u;
  if (space > tabsW) {
    const th = headH * 0.56;
    const ty = cardY + (headH - th) / 2;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(30,42,58,0.08)';
    roundRect(ctx, tx, ty, tabsW + 6 * u, th, th / 2);
    ctx.fill();
    tabs.forEach((label, i) => {
      const on = (i === 0) === (mode === 'blocks');
      if (on) {
        ctx.fillStyle = i === 0 ? CATEGORIES.motion.fill : '#f7df1e';
        roundRect(ctx, tx + 3 * u, ty + 3 * u, tabW[i], th - 6 * u, (th - 6 * u) / 2);
        ctx.fill();
      }
      ctx.fillStyle = on ? (i === 0 ? '#ffffff' : '#1b1b1b') : (dark ? 'rgba(232,238,244,0.7)' : 'rgba(30,42,58,0.65)');
      ctx.fillText(label, tx + 3 * u + 15 * u, ty + th * 0.66);
      tx += tabW[i] + 3 * u;
    });
  }
  // Run button. Pressed = it dips and flashes for a quarter second.
  const press = runPressed >= 0 ? clamp01((t - runPressed) / 0.25) : 1;
  const dip = runPressed >= 0 && t >= runPressed ? Math.sin(press * Math.PI) : 0;
  const rh = headH * 0.6;
  const rx = card.x + card.w - pad - runW;
  const ry = cardY + (headH - rh) / 2 + dip * 4 * u;
  ctx.fillStyle = running ? '#2f9a6a' : BRAND.green;
  if (dip > 0) { ctx.shadowColor = 'rgba(63,179,127,0.9)'; ctx.shadowBlur = 24 * u * dip; }
  roundRect(ctx, rx, ry, runW, rh, rh / 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  setFont(ctx, 800, hs * 0.86, FONT.body);
  ctx.textAlign = 'center';
  ctx.fillText(running ? '▶ Running' : '▶ Run', rx + runW / 2, ry + rh * 0.66);
  ctx.textAlign = 'left';

  // Body.
  ctx.save();
  ctx.beginPath();
  ctx.rect(card.x, cardY + headH, card.w, h - headH);
  ctx.clip();
  if (mode === 'blocks') {
    drawBlocks(ctx, L, { blocks, reveal, slide, x: card.x + pad, y: cardY + headH + pad, w: bodyW, running, t });
  } else {
    drawCode(ctx, L, { code, typed, x: card.x + pad, y: cardY + headH + pad, w: bodyW, t });
  }
  ctx.restore();
  ctx.restore();
}

// Characters in `code`, for a typing animation's end point.
export function codeLength(code) {
  return code.replace(/\n$/, '').length;
}

// --- the end card ---------------------------------------------------------------------

// A soft blur of the last frame, made by shrinking it and scaling it back up -- one cheap
// drawImage pair instead of a per-pixel filter over two million pixels a frame.
export function blurInto(target, source, scale = 1 / 10) {
  const small = document.createElement('canvas');
  small.width = Math.max(8, Math.round(source.width * scale));
  small.height = Math.max(8, Math.round(source.height * scale));
  const s = small.getContext('2d');
  s.imageSmoothingQuality = 'high';
  s.drawImage(source, 0, 0, small.width, small.height);
  const tctx = target.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(small, 0, 0, target.width, target.height);
}

function sparkle(ctx, x, y, r, a) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#fff6dc';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.28;
    ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawEndCard(ctx, L, { t, start, end, words, background }) {
  if (t < start) return;
  const lt = t - start;
  const { W, H, u, safe } = L;
  const k = clamp01(lt / 0.5);

  ctx.save();
  if (background) {
    ctx.globalAlpha = k;
    const zoom = 1.04 + lt * 0.012;
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom, zoom);
    ctx.drawImage(background, -W / 2, -H / 2, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(16, 40, 63, 0.78)');
  g.addColorStop(0.55, 'rgba(22, 64, 104, 0.70)');
  g.addColorStop(1, 'rgba(16, 40, 63, 0.88)');
  ctx.globalAlpha = k;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cx = (safe.x0 + safe.x1) / 2;
  const avail = safe.y1 - safe.y0;
  const logoSize = Math.min((L.portrait ? 230 : 190) * u, (safe.x1 - safe.x0) / 3.3);
  const lines = [
    { kind: 'logo', h: logoSize * 1.05 },
    { kind: 'tagline', h: (L.portrait ? 58 : 50) * u * 2.6 },
    { kind: 'url', h: (L.portrait ? 96 : 84) * u },
    { kind: 'cta', h: (L.portrait ? 44 : 38) * u * 1.9 },
    { kind: 'small', h: (L.portrait ? 30 : 27) * u * 2.2 },
  ];
  const total = lines.reduce((n, l) => n + l.h, 0) + 40 * u;
  let y = safe.y0 + Math.max(0, (avail - total) / 2);

  for (const [i, line] of lines.entries()) {
    const kk = clamp01((lt - 0.15 - i * 0.16) / 0.45);
    if (kk <= 0) { y += line.h; continue; }
    ctx.save();
    ctx.globalAlpha = clamp01(kk * 1.6);
    const rise = (1 - outCubic(kk)) * 30 * u;
    if (line.kind === 'logo') {
      const s = 0.6 + 0.4 * outBack(kk);
      const base = y + logoSize * 0.82;
      ctx.translate(cx, base - logoSize * 0.35);
      ctx.scale(s, s);
      ctx.translate(-cx, -(base - logoSize * 0.35));
      setFont(ctx, 800, logoSize, FONT.brand);
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(240, 150, 60, 0.6)';
      ctx.shadowBlur = 50 * u;
      ctx.strokeStyle = BRAND.cream;
      ctx.lineWidth = logoSize * 0.07;
      ctx.strokeText('Edusim', cx, base);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = amberGradient(ctx, base - logoSize * 0.82, base + logoSize * 0.12);
      ctx.fillText('Edusim', cx, base);
      ctx.restore();
      // Twinkles round the wordmark.
      setFont(ctx, 800, logoSize, FONT.brand);
      const lw = ctx.measureText('Edusim').width;
      for (let s2 = 0; s2 < 6; s2++) {
        const ph = lt * 2.2 + s2 * 1.7;
        const a = Math.max(0, Math.sin(ph)) * kk;
        const sx = cx + Math.cos(s2 * 2.1) * lw * 0.62;
        const sy = y + logoSize * 0.45 + Math.sin(s2 * 1.3) * logoSize * 0.55;
        sparkle(ctx, sx, sy, (10 + (s2 % 3) * 6) * u, a);
      }
      y += line.h;
      continue;
    }
    ctx.textAlign = 'center';
    if (line.kind === 'tagline') {
      const fs = (L.portrait ? 58 : 50) * u;
      setFont(ctx, 600, fs, FONT.display);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 12 * u;
      const tlines = wrapWords(ctx, parseWords(words.tagline), safe.x1 - safe.x0 - 40 * u, fs * 0.26);
      tlines.slice(0, 2).forEach((tl, li) => {
        ctx.fillText(tl.words.map((w) => w.text).join(' '), cx, y + rise + fs * (1.05 + li * 1.18));
      });
    } else if (line.kind === 'url') {
      const fs = (L.portrait ? 50 : 44) * u;
      setFont(ctx, 900, fs, FONT.body);
      const tw = ctx.measureText(words.url).width;
      const h = fs * 1.7;
      const w = tw + 64 * u;
      ctx.fillStyle = BRAND.cream;
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 20 * u;
      roundRect(ctx, cx - w / 2, y + rise + 6 * u, w, h, h / 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = BRAND.ink;
      ctx.fillText(words.url, cx, y + rise + 6 * u + h * 0.68);
    } else if (line.kind === 'cta') {
      const fs = (L.portrait ? 44 : 38) * u;
      setFont(ctx, 800, fs, FONT.body);
      ctx.fillStyle = BRAND.sun;
      ctx.fillText(words.cta, cx, y + rise + fs * 1.3, safe.x1 - safe.x0);
    } else if (line.kind === 'small') {
      const fs = (L.portrait ? 30 : 27) * u;
      setFont(ctx, 700, fs, FONT.body);
      ctx.fillStyle = 'rgba(253, 240, 216, 0.82)';
      ctx.fillText(words.small, cx, y + rise + fs * 1.4, safe.x1 - safe.x0);
    }
    ctx.restore();
    y += line.h;
  }
  ctx.restore();
  void end;
}
