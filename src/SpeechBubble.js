import * as THREE from 'three';

// Speech bubbles for the `say` block.
//
// Same billboard-sprite pattern as PlayIcon and the web browser panel's edit icon: a
// THREE.Sprite always faces the camera, so a bubble floating over an object needs no
// custom facing code and can never be seen edge-on. Unlike those two this one is never
// clicked, so it needs none of their pointer arbitration -- it is display only.
//
// Two decisions worth keeping:
//
//  * **The texture is sized to the text, not the text to the texture.** A fixed canvas
//    with wrapped text inside it makes a one-word bubble mostly empty and a long one
//    unreadable. Measuring first and building a canvas to fit means "hi" and "follow me
//    to the pyramid" are both legible and both look deliberate.
//  * **Bubbles expire on a timer rather than persisting.** A `say` inside a `forever`
//    loop would otherwise stack identical bubbles forever, and one left behind by a
//    program that has finished is a label the student cannot get rid of.

const SPEECH_SECONDS = 3.5;   // how long a bubble stays up
const MARGIN = 1.2;           // feet above the object's bounding box
const PIXELS_PER_FOOT = 108;  // canvas resolution against world size, so text stays crisp
const MAX_CHARS = 60;
// A bubble is a label, and a label has to stay readable from where you would stand to look at
// the thing talking. At world size a 44px line is under half a foot tall, which is fine for a
// robot beside you and unreadable on a 40ft sprout you have to stand back from. Past this
// distance the bubble grows with distance, holding the size it had here on screen -- but only
// up to a cap, past which it falls away again: a whole world's worth of programs talking at
// once must not paper over the view from the far side of it.
const READABLE_DISTANCE = 16; // feet
const MAX_DISTANCE_SCALE = 3.2;
// Inside this a bubble draws over everything, as a bubble half-buried in its own speaker is
// worse than one floating in front of it. Beyond it, nearer objects hide it like anything else:
// otherwise a program on the far side of a world talks straight across the sign in front of you.
const OVERLAY_DISTANCE = 24; // feet

function buildBubbleTexture(text) {
  const measure = document.createElement('canvas').getContext('2d');
  const font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
  measure.font = font;

  const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
  const textWidth = Math.max(60, measure.measureText(clipped).width);

  const padX = 34;
  const padY = 24;
  const tail = 26;
  const width = Math.ceil(textWidth + padX * 2);
  const height = Math.ceil(64 + padY * 2 + tail);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const bodyH = height - tail;
  const r = 22;

  // Bubble body.
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(width, 0, width, bodyH, r);
  ctx.arcTo(width, bodyH, 0, bodyH, r);
  ctx.arcTo(0, bodyH, 0, 0, r);
  ctx.arcTo(0, 0, width, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#2a2622';
  ctx.stroke();

  // Tail, drawn as a filled triangle with its own outline, then the join is painted back
  // in white -- otherwise the body's stroke runs straight across the top of the tail and
  // the bubble reads as a box with a separate arrow under it.
  const tx = width * 0.28;
  ctx.beginPath();
  ctx.moveTo(tx, bodyH - 2);
  ctx.lineTo(tx + 30, bodyH - 2);
  ctx.lineTo(tx + 6, height - 2);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tx + 3, bodyH - 6, 24, 7);

  ctx.fillStyle = '#2a2622';
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(clipped, width / 2, bodyH / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, width, height };
}

export class SpeechBubbleManager {
  constructor({ scene, registry, camera = null }) {
    this.scene = scene;
    this.registry = registry;
    this.camera = camera;
    this.bubbles = new Map(); // placedId -> { sprite, expiresAt, box }
    this.box = new THREE.Box3();
  }

  // One bubble per object: a second `say` replaces the first rather than stacking, which
  // is what makes `say` inside a loop behave like a character talking instead of like a
  // pile of labels.
  show(id, object3D, text) {
    if (!object3D || !String(text).trim()) return;
    this.remove(id);

    const { texture, width, height } = buildBubbleTexture(String(text).trim());
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    const baseScale = [width / PIXELS_PER_FOOT, height / PIXELS_PER_FOOT];
    sprite.scale.set(baseScale[0], baseScale[1], 1);
    // Drawn over everything, like the play icon -- a bubble half-buried in the object that
    // is speaking is worse than one that floats in front of it.
    sprite.renderOrder = 999;
    this.scene.add(sprite);

    this.bubbles.set(id, { sprite, object3D, baseScale, expiresAt: performance.now() + SPEECH_SECONDS * 1000 });
    this.position(this.bubbles.get(id));
  }

  position(entry) {
    this.box.setFromObject(entry.object3D);
    if (!isFinite(this.box.min.x)) return;
    const centre = this.box.getCenter(new THREE.Vector3());
    if (this.camera) {
      const distance = this.camera.position.distanceTo(centre);
      const k = THREE.MathUtils.clamp(distance / READABLE_DISTANCE, 1, MAX_DISTANCE_SCALE);
      entry.sprite.scale.set(entry.baseScale[0] * k, entry.baseScale[1] * k, 1);
      entry.sprite.material.depthTest = distance > OVERLAY_DISTANCE;
    }
    entry.sprite.position.set(
      centre.x,
      this.box.max.y + MARGIN + entry.sprite.scale.y / 2,
      centre.z,
    );
  }

  remove(id) {
    const entry = this.bubbles.get(id);
    if (!entry) return;
    this.scene.remove(entry.sprite);
    entry.sprite.material.map?.dispose();
    entry.sprite.material.dispose();
    this.bubbles.delete(id);
  }

  // Called every frame from main.js's animate loop. Repositions from a fresh bounding box
  // each frame for the same reason the play icon does: a running program may be moving,
  // turning or resizing the object the bubble belongs to.
  tick() {
    if (!this.bubbles.size) return;
    const now = performance.now();
    for (const [id, entry] of [...this.bubbles]) {
      if (entry.expiresAt <= now) {
        this.remove(id);
        continue;
      }
      this.position(entry);
    }
  }

  // Must be called anywhere registry.clear() is -- Clear World and
  // WorldStore.loadFromRecords -- or a bubble outlives the object that said it.
  clear() {
    for (const id of [...this.bubbles.keys()]) this.remove(id);
  }
}
