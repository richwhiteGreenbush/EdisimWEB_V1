import * as THREE from 'three';
import { standard, mesh, group, canvasTexture } from '../PropKit.js';
import { extrudeOutline, roundedOutline, mergeParts, put } from './LoftKit.js';
import { CATEGORIES } from '../BlockDefs.js';

// A board that shows part of the program running on the exhibit beside it, as the blocks a
// student sees when they open that exhibit. `steps` comes from programSteps(), so the rows are
// the real program's own wording, and the chips take their colours from CATEGORIES, so the green
// on the board is the green in the palette.
//
// Same frame as JsBasicsProps' codeBoard, and the same three rules: posts outside the panel
// because the rows are left-aligned, a solid backing so the board is not a black hole from
// behind, and the map doubling as emissiveMap so the face stays legible at any sun angle.
const W = 8.6;
const H = 6.2;
const LIFT = 2.5;

export function blockBoard({
  number = 1, title = 'The program', steps = [], caption = '', accent = '#3fae5a',
} = {}) {
  const parts = [];
  for (const sx of [-1, 1]) {
    put(parts, new THREE.CylinderGeometry(0.16, 0.2, LIFT + H * 0.72, 12), 0x363b47,
      [sx * (W / 2 + 0.42), (LIFT + H * 0.72) / 2, -0.1]);
  }
  put(parts, extrudeOutline(roundedOutline(W / 2 + 0.22, H / 2 + 0.22, 0.35, 3), 0.34),
    0x232b38, [0, LIFT + H / 2, -0.2]);

  const texture = canvasTexture(1024, Math.round(1024 * H / W), (ctx, w, h) => {
    ctx.fillStyle = '#20262f';
    ctx.fillRect(0, 0, w, h);

    // Title bar: the station's number and what this part of the program does.
    const barH = h * 0.135;
    ctx.fillStyle = '#2a323e';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillStyle = accent;
    ctx.fillRect(0, barH, w, 5);
    ctx.beginPath();
    ctx.arc(52, barH / 2, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#10151b';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(number), 52, barH / 2 + 13);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2f5f7';
    let titleSize = 44;
    ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
    const titleRoom = w - 120;
    const titleWidth = ctx.measureText(title).width;
    if (titleWidth > titleRoom) {
      titleSize = Math.floor(titleSize * titleRoom / titleWidth);
      ctx.font = `700 ${titleSize}px system-ui, sans-serif`;
    }
    ctx.fillText(title, 96, barH / 2 + titleSize * 0.35);

    // The stack. Measured first: a row running off the board is worse than one a size smaller.
    const captionRoom = caption ? 74 : 20;
    const top = barH + 22;
    const room = h - top - captionRoom;
    const indent = 34;
    const left = 34;
    const fontOf = (size) => `700 ${size}px system-ui, sans-serif`;
    let size = 40;
    ctx.font = fontOf(size);
    const widest = Math.max(1, ...steps.map((s) => ctx.measureText(s.text).width + (s.depth || 0) * indent + 44));
    size = Math.min(size, Math.floor(size * (w - left * 2) / widest));
    const rowOf = (s) => s * 1.62;
    if (steps.length * rowOf(size) > room) size = Math.floor(room / steps.length / 1.62);
    ctx.font = fontOf(size);
    const rowH = rowOf(size);
    const chipH = rowH - 7;

    steps.forEach((step, i) => {
      const x = left + (step.depth || 0) * indent;
      const y = top + i * rowH;
      const cat = CATEGORIES[step.cat];
      const chipW = ctx.measureText(step.text).width + 40;
      ctx.fillStyle = cat?.fill || '#8d8d8d';
      ctx.beginPath();
      ctx.roundRect(x, y, chipW, chipH, chipH * 0.3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(step.text, x + 20, y + chipH / 2 + size * 0.35);
    });

    if (caption) {
      ctx.fillStyle = '#b8c4cf';
      let captionSize = 32;
      ctx.font = `italic 400 ${captionSize}px Georgia, serif`;
      const captionWidth = ctx.measureText(caption).width;
      if (captionWidth > w - 80) {
        captionSize = Math.floor(captionSize * (w - 80) / captionWidth);
        ctx.font = `italic 400 ${captionSize}px Georgia, serif`;
      }
      ctx.fillText(caption, 40, h - 26);
    }
  });

  const face = mesh(
    new THREE.PlaneGeometry(W, H),
    standard({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.32, roughness: 0.85 }),
  );
  face.position.set(0, LIFT + H / 2, 0.0);

  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.7, metalness: 0.25 })),
    face,
  );
}
