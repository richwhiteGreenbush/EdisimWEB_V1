// On-screen D-pad for touch/tablet navigation. Deliberately doesn't touch
// PlayerController at all -- it dispatches the same synthetic keydown/keyup events
// PlayerController already listens for on window, so keyboard, mouse-drag-look, and
// this D-pad all drive the exact same movement code path.

const DIRECTIONS = [
  { key: 'up', code: 'ArrowUp', label: 'Move forward' },
  { key: 'down', code: 'ArrowDown', label: 'Move backward' },
  { key: 'left', code: 'ArrowLeft', label: 'Turn left' },
  { key: 'right', code: 'ArrowRight', label: 'Turn right' },
];

export class TouchNav {
  constructor() {
    this.activePointers = new Map(); // pointerId -> code

    this.root = document.createElement('div');
    this.root.id = 'touch-nav';

    const pad = document.createElement('div');
    pad.id = 'touch-nav-pad';

    for (const dir of DIRECTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `touch-nav-btn touch-nav-${dir.key}`;
      btn.setAttribute('aria-label', dir.label);

      const shape = document.createElement('span');
      shape.className = 'touch-nav-shape';
      btn.appendChild(shape);

      btn.addEventListener('pointerdown', (e) => this.onPointerDown(e, dir.code, btn));
      btn.addEventListener('pointerup', (e) => this.onPointerRelease(e, btn));
      btn.addEventListener('pointercancel', (e) => this.onPointerRelease(e, btn));
      btn.addEventListener('pointerleave', (e) => this.onPointerRelease(e, btn));

      pad.appendChild(btn);
    }

    const hub = document.createElement('div');
    hub.className = 'touch-nav-hub';
    pad.appendChild(hub);

    this.root.appendChild(pad);
    document.body.appendChild(this.root);
  }

  onPointerDown(e, code, btn) {
    e.preventDefault();
    // Capture is a nice-to-have (guarantees the release fires even if the finger
    // slides off the button) -- it can throw for pointer ids the browser doesn't
    // consider active, which must never block registering the press itself.
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      // ignored -- pointerleave is the fallback release path when capture isn't available
    }
    this.activePointers.set(e.pointerId, code);
    btn.classList.add('touch-nav-active');
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  }

  onPointerRelease(e, btn) {
    const code = this.activePointers.get(e.pointerId);
    if (!code) return;
    this.activePointers.delete(e.pointerId);
    btn.classList.remove('touch-nav-active');
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }
}
