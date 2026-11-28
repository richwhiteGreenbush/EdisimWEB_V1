// The pen layer: a canvas the pen draws into, in stage coordinates, at PEN_SCALE pixels per step.
// Shared by the 2D stage (StageRenderer) and the 3D one (src/stages3d/ in the main app), which
// lays the same canvas over a stage set or a board.
import { imageNow } from '../project/assets.js';
import { HALF_H, HALF_W, STAGE_H, STAGE_W, costumeOf } from '../runtime/geometry.js';

export const PEN_SCALE = 2;

export class PenLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STAGE_W * PEN_SCALE;
    this.canvas.height = STAGE_H * PEN_SCALE;
    this.ctx = this.canvas.getContext('2d');
    this.dirty = false;
  }


  xy(x, y) { return [(x + HALF_W) * PEN_SCALE, (HALF_H - y) * PEN_SCALE]; }

  line(x0, y0, x1, y1, colour, size) {
    const ctx = this.ctx;
    const [a, b] = this.xy(x0, y0);
    const [c, d] = this.xy(x1, y1);
    ctx.strokeStyle = colour;
    ctx.lineWidth = size * PEN_SCALE;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
    ctx.stroke();
    this.dirty = true;
  }

  dot(x, y, colour, size) {
    const ctx = this.ctx;
    const [a, b] = this.xy(x, y);
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(a, b, Math.max(0.5, (size * PEN_SCALE) / 2), 0, Math.PI * 2);
    ctx.fill();
    this.dirty = true;
  }

  // Stamping draws the sprite's current look into the pen layer, effects included.
  stamp(target) {
    const costume = costumeOf(target);
    const img = costume && imageNow(costume.assetId);
    if (!img || !target.visible) return;
    const ctx = this.ctx;
    const s = (target.size / 100) / (costume.resolution || 1);
    const e = target._rt?.effects || {};
    ctx.save();
    const [px, py] = this.xy(target.x, target.y);
    ctx.translate(px, py);
    if (target.rotationStyle === 'all around') ctx.rotate(((target.direction - 90) * Math.PI) / 180);
    if (target.rotationStyle === 'left-right' && target.direction < 0) ctx.scale(-1, 1);
    ctx.scale(s * PEN_SCALE, s * PEN_SCALE);
    ctx.globalAlpha = 1 - Math.max(0, Math.min(100, e.ghost || 0)) / 100;
    const filters = [];
    if (e.color) filters.push(`hue-rotate(${((e.color % 200) / 200) * 360}deg)`);
    if (e.brightness) filters.push(`brightness(${1 + e.brightness / 100})`);
    if (filters.length) ctx.filter = filters.join(' ');
    ctx.drawImage(img, -costume.cx, -costume.cy);
    ctx.restore();
    this.dirty = true;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = true;
  }
}
