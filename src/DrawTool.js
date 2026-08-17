import { inflateFromCanvas } from './BalloonInflator.js';
import { nextPlacementXZ, faceCamera } from './Placement.js';
import { PALETTE_SWATCHES } from './config.js';

import { uuid } from './Uuid.js';
const SWATCHES = PALETTE_SWATCHES;
const MIN_BRUSH_SIZE = 2;
const MAX_BRUSH_SIZE = 28;
const DEFAULT_BRUSH_SIZE = 8;

export class DrawTool {
  constructor({ scene, camera, groundHeightAt, registry, menu, onPlaced }) {
    this.scene = scene;
    this.camera = camera;
    this.groundHeightAt = groundHeightAt;
    this.registry = registry;
    this.menu = menu;
    this.onPlaced = onPlaced;

    this.drawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.color = SWATCHES[0];
    this.brushSize = DEFAULT_BRUSH_SIZE;

    this.buildDom();
  }

  buildDom() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'draw-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.id = 'draw-panel';

    const title = document.createElement('div');
    title.id = 'draw-title';
    title.textContent = 'Paint a shape — it inflates into a puffy 3D balloon in your colors.';

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'draw-canvas';
    this.canvas.width = 560;
    this.canvas.height = 380;
    this.ctx = this.canvas.getContext('2d');

    const swatchRow = document.createElement('div');
    swatchRow.id = 'draw-swatches';
    this.swatchEls = SWATCHES.map((hex) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'swatch';
      el.style.background = hex;
      el.title = hex;
      el.addEventListener('click', () => this.setColor(hex));
      swatchRow.appendChild(el);
      return { hex, el };
    });

    const brushRow = document.createElement('label');
    brushRow.id = 'draw-brush-row';
    const brushLabel = document.createElement('span');
    brushLabel.id = 'draw-brush-label';
    this.brushInput = document.createElement('input');
    this.brushInput.type = 'range';
    this.brushInput.min = String(MIN_BRUSH_SIZE);
    this.brushInput.max = String(MAX_BRUSH_SIZE);
    this.brushInput.value = String(DEFAULT_BRUSH_SIZE);
    const updateBrushLabel = () => {
      brushLabel.textContent = `Brush size: ${this.brushInput.value}px`;
    };
    this.brushInput.addEventListener('input', () => {
      this.brushSize = Number(this.brushInput.value);
      updateBrushLabel();
    });
    updateBrushLabel();
    brushRow.append(brushLabel, this.brushInput);

    const actions = document.createElement('div');
    actions.id = 'draw-actions';

    const clearBtn = this.actionButton('Clear', () => this.clearCanvas());
    const cancelBtn = this.actionButton('Cancel', () => this.close());
    const doneBtn = this.actionButton('Done — Inflate', () => this.finish());
    doneBtn.classList.add('menu-link');

    actions.append(clearBtn, cancelBtn, doneBtn);
    panel.append(title, this.canvas, swatchRow, brushRow, actions);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.setColor(SWATCHES[0]);

    this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.onPointerUp());
  }

  actionButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  setColor(hex) {
    this.color = hex;
    for (const s of this.swatchEls) s.el.classList.toggle('swatch-selected', s.hex === hex);
  }

  open() {
    this.resizeCanvasToFit();
    this.clearCanvas();
    this.overlay.hidden = false;
  }

  // The canvas's width/height attributes are its drawing coordinate space, and
  // localPoint() maps clientX/Y straight into that space -- so on narrow viewports we
  // must shrink the actual buffer (not just stretch it via CSS), or drawn points would
  // land in the wrong place relative to the cursor.
  resizeCanvasToFit() {
    const width = Math.max(240, Math.min(560, window.innerWidth - 64));
    const height = Math.max(180, Math.min(380, window.innerHeight - 220));
    this.canvas.width = width;
    this.canvas.height = height;
  }

  close() {
    this.overlay.hidden = true;
  }

  clearCanvas() {
    this.drawing = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  localPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  onPointerDown(e) {
    this.drawing = true;
    const p = this.localPoint(e);
    this.lastX = p.x;
    this.lastY = p.y;
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineJoin = 'round';
    this.ctx.lineCap = 'round';
    // A single dot on a plain click/tap (no drag) still leaves a mark.
    this.ctx.beginPath();
    this.ctx.arc(p.x, p.y, this.brushSize / 2, 0, Math.PI * 2);
    this.ctx.fillStyle = this.color;
    this.ctx.fill();
  }

  onPointerMove(e) {
    if (!this.drawing) return;
    const p = this.localPoint(e);
    this.ctx.beginPath();
    this.ctx.moveTo(this.lastX, this.lastY);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
    this.lastX = p.x;
    this.lastY = p.y;
  }

  onPointerUp() {
    this.drawing = false;
  }

  async finish() {
    const mesh = inflateFromCanvas(this.canvas);
    if (!mesh) {
      this.menu?.toast('Paint a bigger shape first.', { tone: 'error' });
      return;
    }

    const liftY = -mesh.geometry.boundingBox.min.y;
    const { x, z } = nextPlacementXZ(this.camera, this.registry.count);
    const groundY = this.groundHeightAt(x, z);
    mesh.position.set(x, groundY + liftY, z);
    faceCamera(mesh, this.camera);
    this.scene.add(mesh);

    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    const id = uuid();
    const record = {
      id,
      kind: 'balloon',
      createdAt: Date.now(),
      transform: {
        position: mesh.position.toArray(),
        rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
        scale: mesh.scale.toArray(),
      },
      files: [{ name: 'balloon.png', type: 'image/png', data: blob }],
    };

    this.registry.add(id, mesh, { record });
    this.onPlaced?.(record);
    this.menu?.toast('Balloon placed!', { tone: 'success' });
    this.close();
  }
}
