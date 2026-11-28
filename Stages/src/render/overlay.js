// The stage's overlay: speech and thought bubbles, variable monitors, captions and the ask box,
// drawn on a 2D canvas in STAGE coordinates (480 x 360, y down from the top-left corner).
//
// Shared by the 2D stage (StageRenderer) and the 3D one in the main app (src/stages3d/), which hangs
// the same canvas in front of a stage set. One drawing, so a bubble looks the same in both.
import { maskFor } from '../project/assets.js';
import { HALF_H, HALF_W, STAGE_H, STAGE_W, boundsOf } from '../runtime/geometry.js';
import { toText } from '../runtime/cast.js';

// Draws everything into `ctx` at `k` canvas pixels per stage step. `state` is
// { drawOrder, monitors, monitorValue, monitorLabel, caption, askQuestion, bubbles = true }.
// Returns the monitors' rectangles in stage coordinates, for dragging them.
export function drawOverlay(ctx, k, state) {
  const rects = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  for (const m of state.monitors || []) {
    if (!m.visible) continue;
    rects.push(drawMonitor(ctx, m, state.monitorLabel?.(m) ?? m.name, state.monitorValue?.(m)));
  }
  if (state.bubbles !== false) {
    for (const target of state.drawOrder || []) {
      const b = target._rt?.bubble;
      if (b && target.visible) drawBubble(ctx, target, b);
    }
  }
  if (state.caption) drawCaption(ctx, state.caption);
  if (state.askQuestion != null) drawAsk(ctx, state.askQuestion);
  return rects;
}


export function drawMonitor(ctx, m, label, value) {
  const text = toText(value ?? '');
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  if (m.mode === 'large') {
    const w = Math.max(40, ctx.measureText(text).width + 16);
    roundRect(ctx, m.x, m.y, w, 24, 5, '#ff8c1a', '#db6e00');
    ctx.fillStyle = '#fff';
    ctx.font = '700 14px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, m.x + w / 2, m.y + 12.5);
    return { id: m.id, x: m.x, y: m.y, w, h: 24 };
  }
  const lw = ctx.measureText(label).width;
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  const vw = Math.max(36, ctx.measureText(text).width + 12);
  const w = lw + vw + 18;
  roundRect(ctx, m.x, m.y, w, 22, 4, '#e6f0ff', '#c4ccda');
  ctx.fillStyle = '#575e75';
  ctx.font = '600 11px system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(label, m.x + 6, m.y + 11.5);
  roundRect(ctx, m.x + lw + 12, m.y + 3, vw, 16, 4, m.kind === 'variable' ? '#ff8c1a' : '#4c97ff', null);
  ctx.fillStyle = '#fff';
  ctx.font = '700 11px system-ui, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, m.x + lw + 12 + vw / 2, m.y + 11.5);
  return { id: m.id, x: m.x, y: m.y, w, h: 22 };
}

// A bubble sits above the sprite's top right corner, and flips to the left when that would run off
// the stage, as Scratch's does.
export function drawBubble(ctx, target, bubble) {
  const b = boundsOf(target, maskFor);
  ctx.font = '600 13px system-ui, "Segoe UI", sans-serif';
  const lines = wrap(ctx, bubble.text, 150);
  const lh = 16;
  const w = Math.max(48, Math.min(170, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20));
  const h = lines.length * lh + 14;
  const sx = HALF_W + b.right;
  const sy = HALF_H - b.top;
  let left = sx - 8;
  let flipped = false;
  if (left + w > STAGE_W - 4) { left = HALF_W + b.left - w + 8; flipped = true; }
  left = Math.max(4, Math.min(STAGE_W - w - 4, left));
  let top = sy - h - 14;
  top = Math.max(4, Math.min(STAGE_H - h - 4, top));
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#c4ccda';
  ctx.fillStyle = '#ffffff';
  const tx = flipped ? left + w - 26 : left + 18;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, 12);
  ctx.fill();
  ctx.stroke();
  if (bubble.kind === 'think') {
    for (const [dx, dy, r] of [[0, 8, 4], [flipped ? 6 : -6, 16, 2.5]]) {
      ctx.beginPath();
      ctx.arc(tx + dx, top + h + dy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(tx, top + h - 1);
    ctx.lineTo(tx + (flipped ? 10 : -6), top + h + 11);
    ctx.lineTo(tx + (flipped ? -2 : 12), top + h - 1);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tx, top + h);
    ctx.lineTo(tx + (flipped ? 10 : -6), top + h + 11);
    ctx.lineTo(tx + (flipped ? -2 : 12), top + h);
    ctx.stroke();
  }
  ctx.fillStyle = '#575e75';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, left + 10, top + 7 + i * lh));
  ctx.restore();
}

export function drawCaption(ctx, text) {
  ctx.save();
  ctx.font = '700 17px system-ui, "Segoe UI", sans-serif';
  const lines = wrap(ctx, text, 420).slice(0, 4);
  const lh = 22;
  const h = lines.length * lh + 18;
  const top = STAGE_H - h - 10;
  ctx.fillStyle = 'rgba(20, 24, 40, 0.78)';
  ctx.beginPath();
  ctx.roundRect(20, top, STAGE_W - 40, h, 10);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, HALF_W, top + 9 + i * lh));
  ctx.restore();
}

// The ask box. A real text field is laid over it while the project runs; the drawing is what an
// exported video shows.
export function drawAsk(ctx, question) {
  ctx.save();
  const top = STAGE_H - (question ? 66 : 44);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#c4ccda';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(10, top, STAGE_W - 20, STAGE_H - top - 10, 8);
  ctx.fill();
  ctx.stroke();
  if (question) {
    ctx.fillStyle = '#575e75';
    ctx.font = '700 13px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(question, 20, top + 8, STAGE_W - 40);
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function wrap(ctx, text, max) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > max && line) {
        out.push(line);
        line = word;
      } else line = next;
      while (ctx.measureText(line).width > max && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > max) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}
