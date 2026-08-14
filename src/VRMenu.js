import * as THREE from 'three';
import { PRESET_WORLDS } from './WorldPresets.js';
import { EYE_HEIGHT } from './config.js';

// The menu, rebuilt as a real object in the 3D scene, for use while VR is running.
//
// **This exists because the DOM menu cannot be shown in VR at all.** Two separate
// reasons, one per path:
//
//   * In an immersive-vr session the headset displays only what the WebGL renderer
//     draws into the XR framebuffer. HTML is never composited into it. (WebXR's
//     `dom-overlay` feature does exist, but it is specified for immersive-AR on
//     handheld devices, not for VR headsets.) So `#menu` could be left visible and the
//     student in the headset would still see nothing.
//   * In the side-by-side stereo path the DOM *is* visible over the canvas -- but it is
//     drawn ONCE, flat, spanning both eye halves at once. In a Cardboard holder that
//     reads as doubled, unfocusable garbage.
//
// One panel in the scene solves both: it is drawn by the same renderer as everything
// else, so the headset projects it per-eye and StereoEffect draws it twice with the
// correct parallax, for free.
//
// The panel is BODY-locked, not head-locked: it sits at a fixed offset from the player's
// position and yaw, and the student turns their head to look at it. A panel welded to
// the head pose cannot be looked away from, and in a headset that is both inescapable
// and a well-known way to make someone queasy.

const CANVAS_W = 512;
const HEADER_H = 96;
const ROW_H = 54;
const PAD = 18;

const PANEL_WIDTH = 2.2; // feet
const PANEL_DISTANCE = 4.6; // feet in front of the player

// The panel follows the player's yaw only once they have turned FURTHER than this, and
// then eases across rather than snapping. Welded rigidly to the yaw it is unreachable by
// gaze on any device without head tracking: the view direction IS the yaw there, so a
// panel held at a fixed offset from it sits permanently beside the crosshair and can
// never be brought under it. The dead angle is what lets a student turn to look at the
// panel while it stays still, and still have it follow them around the world.
const FOLLOW_DEAD_ANGLE = 0.55; // radians (~31deg)
const FOLLOW_RATE = 3.2; // catch-up per second once outside the dead angle

// Offsets are kept SMALL because a VR field of view is nothing like a monitor's. Split
// side-by-side, each eye gets roughly 32 degrees either side of centre, so the flat
// menu's "up in the corner" placement -- about 24 degrees left and 18 up -- put the
// panel off the edge of the frame entirely and it could not be found at all.
const PANEL_YAW_OFFSET = 0.26; // radians (~15deg) to the player's left

// The HEADER's centre is pinned essentially ON the horizon and the rows grow downwards
// below it. Two separate versions of this were unreachable by a level gaze: pinning the
// panel's TOP edge left the collapsed tab about 10 degrees up, and even a 0.25ft lift
// missed, because a 0.32ft-tall tab at 4.6ft only spans +/-2 degrees while that lift is
// 3.1 degrees. The offset here has to stay smaller than half the header's own height,
// which is also why the header is deliberately chunky -- it is the one target a student
// has to find before they can reach anything else.
const HEADER_ANCHOR_Y = EYE_HEIGHT + 0.05; // feet

// Long enough not to fire on a glance across the panel, short enough not to feel stuck.
const DWELL_MS = 1100;

const INK = '#e8eef5';
const MUTED = 'rgba(232,238,245,0.5)';
const ACCENT = '#5fc9dd';
const EXIT_ACCENT = '#c4a5ff';

// Shortest signed angle between two headings. Without this, drifting across the +/-PI
// seam reads as most of a full turn the other way and the panel whips round the player.
function wrapPi(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class VRMenu {
  // `onSelect(row)` is handed the chosen row and is responsible for actually running it
  // -- including dropping out of VR first for the rows that need the flat screen.
  constructor({ onSelect }) {
    this.onSelect = onSelect;
    this.openGroup = null; // null | 'object' | 'world'
    this.collapsed = true;
    this.rows = [];
    this.hovered = -1;
    this.dwellMs = 0;
    this.dwellRow = -1;
    this.anchorYaw = null; // seeded from the player's yaw the first time the panel is placed

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = this.makeTexture();

    // depthTest off + a high renderOrder so the panel is reachable even when the player
    // is standing inside a prop. A menu you cannot get to because a wall is between you
    // and it is worse than no menu.
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });

    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = 9000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'vr-menu';

    this.object3D = new THREE.Group();
    this.object3D.name = 'vr-menu-root';
    this.object3D.add(this.mesh);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.near = 0;
    this.raycaster.far = 60;

    this.rebuild();
  }

  // Mipmaps off: the panel's height changes every time a group opens, and a mipmap chain
  // built for one size is invalid at the next. LinearFilter alone is also sharper for
  // text viewed head-on, which is the only way this panel is ever seen.
  makeTexture() {
    const texture = new THREE.CanvasTexture(this.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    return texture;
  }

  // ---------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------

  buildRows() {
    if (this.collapsed) return [];
    const rows = [];

    rows.push({ id: 'group:object', label: 'Load Object', group: 'object' });
    if (this.openGroup === 'object') {
      rows.push({ id: 'lightOrb', label: 'Light Orb', indent: true });
      // These three all need the flat screen: a file picker, a 2D paint modal and a
      // CSS3D panel respectively, none of which a headset can display. Rather than
      // showing dead buttons, choosing one leaves VR and opens it.
      rows.push({ id: 'import', label: 'Import', indent: true, leavesVR: true });
      rows.push({ id: 'draw', label: 'Draw', indent: true, leavesVR: true });
      rows.push({ id: 'webBrowser', label: 'Web Browser', indent: true, leavesVR: true });
    }

    // Create Model is deliberately absent. Placing a shape would work in here, but every
    // way of then editing it -- the hammer icon's panel, the file picker, the stretch
    // gizmo's Done chip -- is flat-screen DOM, so a student would be left with pieces
    // they could not build with. Adding it means either rows marked leavesVR (a Load
    // Object-style compromise) or in-scene versions of those three, which is a feature
    // of its own.
    rows.push({ id: 'group:world', label: 'Load World', group: 'world' });
    if (this.openGroup === 'world') {
      for (const [name, preset] of Object.entries(PRESET_WORLDS)) {
        rows.push({ id: `preset:${name}`, label: preset.label, indent: true });
      }
      rows.push({ id: 'saveWorld', label: 'Save World', indent: true, leavesVR: true });
      rows.push({ id: 'loadWorldFile', label: 'Load World File', indent: true, leavesVR: true });
    }

    rows.push({ id: 'clear', label: 'Clear World' });
    rows.push({ id: 'exit', label: 'Exit VR View', exit: true });
    return rows;
  }

  // Redraws the canvas AND resizes both the canvas and the plane to fit the current row
  // count, so the panel is exactly as tall as its contents. Only runs when the layout or
  // the highlight actually changes, never per frame.
  rebuild() {
    this.rows = this.buildRows();
    const height = HEADER_H + this.rows.length * ROW_H;

    if (this.canvas.height !== height) {
      this.canvas.width = CANVAS_W;
      this.canvas.height = height;
      this.mesh.geometry.dispose();
      this.mesh.geometry = new THREE.PlaneGeometry(PANEL_WIDTH, (PANEL_WIDTH * height) / CANVAS_W);
      // A RESIZED canvas needs a brand new texture, not `needsUpdate` on the old one.
      // three allocates immutable GPU storage for a texture at its first upload, so a
      // later re-upload at a different size is silently dropped and the panel keeps
      // showing the previous drawing stretched over the new quad -- which looks exactly
      // like the menu having failed to open at all.
      this.texture.dispose();
      this.texture = this.makeTexture();
      this.material.map = this.texture;
      this.material.needsUpdate = true;
    }

    this.draw();
    this.texture.needsUpdate = true;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(10,17,28,0.94)';
    roundRect(ctx, 2, 2, w - 4, h - 4, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(95,201,221,0.55)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Header, which is also the collapse/expand control.
    const headerHot = this.hovered === -1;
    if (headerHot) {
      ctx.fillStyle = 'rgba(95,201,221,0.18)';
      roundRect(ctx, 4, 4, w - 8, HEADER_H - 6, 16);
      ctx.fill();
    }
    ctx.fillStyle = ACCENT;
    ctx.font = 'bold 38px "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.collapsed ? '☰  MENU' : '✕  CLOSE', PAD + 6, HEADER_H / 2);

    if (this.collapsed) {
      ctx.fillStyle = MUTED;
      ctx.font = '20px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('look here', w - PAD - 6, HEADER_H / 2);
      ctx.textAlign = 'left';
      return;
    }

    ctx.strokeStyle = 'rgba(95,201,221,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, HEADER_H - 2);
    ctx.lineTo(w - PAD, HEADER_H - 2);
    ctx.stroke();

    this.rows.forEach((row, index) => {
      const y = HEADER_H + index * ROW_H;
      const hot = this.hovered === index;

      if (hot) {
        ctx.fillStyle = 'rgba(95,201,221,0.16)';
        roundRect(ctx, 6, y + 3, w - 12, ROW_H - 6, 10);
        ctx.fill();

        // Dwell progress, drawn as the highlight filling from the left. This is the only
        // feedback a gaze user gets that the look is being counted, so it has to be on
        // the row itself rather than off in a corner.
        if (this.dwellRow === index && this.dwellMs > 0) {
          const progress = Math.min(1, this.dwellMs / DWELL_MS);
          ctx.fillStyle = 'rgba(95,201,221,0.34)';
          roundRect(ctx, 6, y + 3, (w - 12) * progress, ROW_H - 6, 10);
          ctx.fill();
        }

        ctx.fillStyle = row.exit ? EXIT_ACCENT : ACCENT;
        roundRect(ctx, 6, y + 8, 5, ROW_H - 16, 3);
        ctx.fill();
      }

      ctx.fillStyle = row.exit ? EXIT_ACCENT : INK;
      ctx.font = `${row.group ? 'bold ' : ''}27px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(row.label, PAD + (row.indent ? 26 : 4), y + ROW_H / 2);

      if (row.group) {
        ctx.fillStyle = ACCENT;
        ctx.textAlign = 'right';
        ctx.fillText(this.openGroup === row.group ? '▾' : '▸', w - PAD, y + ROW_H / 2);
        ctx.textAlign = 'left';
      } else if (row.leavesVR) {
        ctx.fillStyle = MUTED;
        ctx.font = '19px "Helvetica Neue", Arial, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('leaves VR', w - PAD, y + ROW_H / 2);
        ctx.textAlign = 'left';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------

  // Anchored to the player's position and yaw, hanging DOWN from a fixed top edge so
  // that opening a submenu grows the panel downwards instead of shifting every row that
  // was already under the pointer.
  place(position, yaw, dt) {
    if (this.anchorYaw === null) this.anchorYaw = yaw;
    let drift = wrapPi(yaw - this.anchorYaw);
    if (Math.abs(drift) > FOLLOW_DEAD_ANGLE) {
      const target = yaw - Math.sign(drift) * FOLLOW_DEAD_ANGLE;
      this.anchorYaw += wrapPi(target - this.anchorYaw) * Math.min(1, FOLLOW_RATE * dt);
    }

    const angle = this.anchorYaw + PANEL_YAW_OFFSET;
    const height = this.mesh.geometry.parameters.height;
    const headerWorld = (PANEL_WIDTH * HEADER_H) / CANVAS_W;

    this.object3D.position.set(
      position.x - Math.sin(angle) * PANEL_DISTANCE,
      position.y - EYE_HEIGHT + HEADER_ANCHOR_Y - height / 2 + headerWorld / 2,
      position.z - Math.cos(angle) * PANEL_DISTANCE
    );
    // The panel's +Z must point back AT the player, and `angle` is already the bearing
    // from the player to the panel -- so rotation.y is exactly `angle`, with no half
    // turn. Adding PI here (the instinctive "turn it round to face me") aims the face
    // directly away instead, and since the material is FrontSide the panel then renders
    // as nothing at all: present, correctly placed, and completely invisible.
    this.object3D.rotation.set(0, angle, 0);
  }

  // ---------------------------------------------------------------------------
  // Pointing
  // ---------------------------------------------------------------------------

  // Returns the row index under a ray, or null for a miss. -1 means the header.
  //
  // Hit testing goes through the plane's UV rather than one mesh per row: the panel is a
  // single quad, so the intersection already carries exactly the coordinate needed and
  // there is nothing to keep in sync when the rows change.
  pick(origin, direction) {
    this.raycaster.set(origin, direction);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;

    const y = (1 - hit.uv.y) * this.canvas.height;
    if (y < HEADER_H) return -1;
    const index = Math.floor((y - HEADER_H) / ROW_H);
    return index >= 0 && index < this.rows.length ? index : null;
  }

  setHovered(index) {
    if (this.hovered === index) return;
    this.hovered = index;
    if (this.dwellRow !== index) {
      this.dwellRow = index;
      this.dwellMs = 0;
    }
    this.rebuild();
  }

  // `pointers` are controller rays; `gaze` is the head/view ray used when no controller
  // is pointing at the panel. A controller always wins: on a headset with controllers in
  // hand, having the panel also respond to where you happen to be looking would fire
  // things the student never chose.
  update({ position, yaw, pointers = [], gaze = null, dt = 0 }) {
    this.place(position, yaw, dt);
    this.object3D.updateMatrixWorld(true);

    let index = null;
    let viaController = false;
    for (const pointer of pointers) {
      const found = this.pick(pointer.origin, pointer.direction);
      if (found !== null) {
        index = found;
        viaController = true;
        break;
      }
    }
    if (index === null && gaze) index = this.pick(gaze.origin, gaze.direction);

    if (index === null) {
      if (this.hovered !== -2) {
        this.hovered = -2; // nothing hovered; -1 is the header
        this.dwellRow = -2;
        this.dwellMs = 0;
        this.rebuild();
      }
      return;
    }

    const wasHovered = this.hovered;
    this.setHovered(index);

    // Dwell only applies to gaze. A controller has a trigger, and making it ALSO fire on
    // a timer would select whatever the student was resting the ray on.
    if (viaController) {
      if (this.dwellMs !== 0) {
        this.dwellMs = 0;
        this.rebuild();
      }
      return;
    }

    this.dwellMs += dt * 1000;
    if (this.dwellMs >= DWELL_MS) {
      this.dwellMs = 0;
      this.activate(index);
      return;
    }
    // Repaint while the bar is filling, but only while it is actually visible.
    if (wasHovered === index) this.rebuild();
  }

  // Called by VRView when a controller trigger goes down. Returns true if the press was
  // consumed by the menu, which is what stops the same press ALSO starting a look-drag.
  trySelect(origin, direction) {
    const index = this.pick(origin, direction);
    if (index === null) return false;
    this.activate(index);
    return true;
  }

  activate(index) {
    if (index === -1) {
      this.collapsed = !this.collapsed;
      if (this.collapsed) this.openGroup = null;
      this.dwellMs = 0;
      this.rebuild();
      return;
    }

    const row = this.rows[index];
    if (!row) return;

    if (row.group) {
      this.openGroup = this.openGroup === row.group ? null : row.group;
      this.hovered = -2;
      this.dwellRow = -2;
      this.dwellMs = 0;
      this.rebuild();
      return;
    }

    // Collapse on the way out, so coming back to VR later starts from the tab rather
    // than from a panel left standing open across the view.
    this.collapsed = true;
    this.openGroup = null;
    this.hovered = -2;
    this.dwellRow = -2;
    this.dwellMs = 0;
    this.rebuild();

    this.onSelect?.(row);
  }

  reset() {
    this.anchorYaw = null;
    this.collapsed = true;
    this.openGroup = null;
    this.hovered = -2;
    this.dwellRow = -2;
    this.dwellMs = 0;
    this.rebuild();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
