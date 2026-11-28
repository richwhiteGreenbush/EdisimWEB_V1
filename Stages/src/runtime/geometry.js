// Where a sprite is on the stage, and whether two of them touch.
//
// A costume is a picture with a rotation centre (cx, cy) in its own pixels, y running down, and a
// `resolution` (2 means the picture holds two pixels per stage step, for a sharper sprite). A sprite
// draws it at `size` per cent, turned by its direction according to its rotation style. The stage
// runs x -240..240 and y -180..180 with y up, as in Scratch.
//
// TOUCHING IS TESTED ON THE PICTURE, NOT ON ITS BOX. Two round coins whose boxes overlap at a corner
// are not touching, and a game where they are feels unfair at once. The boxes are compared first
// because that is cheap and nearly always says no; only where they overlap are the two pictures'
// masks sampled. A mask is a costume's own alpha, made once per costume (see project/assets.js).
// Without one (the check tools run with no images) a costume counts as solid.

export const STAGE_W = 480;
export const STAGE_H = 360;
export const HALF_W = STAGE_W / 2;
export const HALF_H = STAGE_H / 2;

export function costumeOf(target) {
  const list = target.costumes;
  if (!list?.length) return null;
  const i = Math.max(0, Math.min(list.length - 1, target.currentCostume | 0));
  return list[i];
}

// The pieces of a sprite's transform: scale in stage steps per costume pixel, the turn, and the
// left-right flip.
export function poseOf(target) {
  const costume = costumeOf(target);
  const s = (target.size / 100) / (costume?.resolution || 1);
  let theta = 0;
  let flip = 1;
  if (target.rotationStyle === 'all around') theta = ((90 - target.direction) * Math.PI) / 180;
  else if (target.rotationStyle === 'left-right' && target.direction < 0) flip = -1;
  return { costume, s, theta, flip, cos: Math.cos(theta), sin: Math.sin(theta) };
}

// A costume pixel to a stage point.
export function toStage(target, pose, u, v) {
  const c = pose.costume;
  const lx = (u - c.cx) * pose.s * pose.flip;
  const ly = -(v - c.cy) * pose.s;
  return [target.x + lx * pose.cos - ly * pose.sin, target.y + lx * pose.sin + ly * pose.cos];
}

// A stage point to a costume pixel.
export function toCostume(target, pose, px, py) {
  const c = pose.costume;
  const dx = px - target.x;
  const dy = py - target.y;
  const lx = dx * pose.cos + dy * pose.sin;
  const ly = -dx * pose.sin + dy * pose.cos;
  return [(lx * pose.flip) / pose.s + c.cx, -ly / pose.s + c.cy];
}

// The opaque part of a costume, in its pixels: the mask's trimmed box when there is a mask, the whole
// picture otherwise.
function opaqueBox(costume, mask) {
  if (mask?.box) return mask.box;
  return { left: 0, top: 0, right: costume.width || 1, bottom: costume.height || 1 };
}

// The sprite's bounding box on the stage, from its opaque pixels, so a costume with empty margins
// does not bounce off an edge it has not reached.
export function boundsOf(target, maskFor) {
  const pose = poseOf(target);
  if (!pose.costume) return { left: target.x, right: target.x, bottom: target.y, top: target.y };
  const box = opaqueBox(pose.costume, maskFor?.(pose.costume));
  const pts = [
    toStage(target, pose, box.left, box.top), toStage(target, pose, box.right, box.top),
    toStage(target, pose, box.left, box.bottom), toStage(target, pose, box.right, box.bottom),
  ];
  return {
    left: Math.min(...pts.map((p) => p[0])), right: Math.max(...pts.map((p) => p[0])),
    bottom: Math.min(...pts.map((p) => p[1])), top: Math.max(...pts.map((p) => p[1])),
  };
}

function solidAt(costume, mask, u, v) {
  if (u < 0 || v < 0 || u >= (costume.width || 1) || v >= (costume.height || 1)) return false;
  if (!mask) return true;
  const x = Math.floor(u * mask.scale);
  const y = Math.floor(v * mask.scale);
  if (x < 0 || y < 0 || x >= mask.w || y >= mask.h) return false;
  return mask.data[y * mask.w + x] === 1;
}

export function containsPoint(target, px, py, maskFor) {
  const pose = poseOf(target);
  if (!pose.costume) return false;
  const [u, v] = toCostume(target, pose, px, py);
  return solidAt(pose.costume, maskFor?.(pose.costume), u, v);
}

export function boxesOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
}

// Whether two sprites' pictures overlap anywhere. The overlap of their boxes is sampled on a grid of
// one stage step, coarsened only when the overlap is large, so the cost stays near a few thousand
// samples however big the sprites are.
export function spritesTouch(a, b, maskFor) {
  const ba = boundsOf(a, maskFor);
  const bb = boundsOf(b, maskFor);
  if (!boxesOverlap(ba, bb)) return false;
  const left = Math.max(ba.left, bb.left);
  const right = Math.min(ba.right, bb.right);
  const bottom = Math.max(ba.bottom, bb.bottom);
  const top = Math.min(ba.top, bb.top);
  const area = (right - left) * (top - bottom);
  const step = Math.max(1, Math.sqrt(area / 3000));
  const pa = poseOf(a);
  const pb = poseOf(b);
  const ma = maskFor?.(pa.costume);
  const mb = maskFor?.(pb.costume);
  for (let y = bottom + step / 2; y < top; y += step) {
    for (let x = left + step / 2; x < right; x += step) {
      const [ua, va] = toCostume(a, pa, x, y);
      if (!solidAt(pa.costume, ma, ua, va)) continue;
      const [ub, vb] = toCostume(b, pb, x, y);
      if (solidAt(pb.costume, mb, ub, vb)) return true;
    }
  }
  return false;
}

export function touchesEdge(target, maskFor) {
  const b = boundsOf(target, maskFor);
  return b.left < -HALF_W || b.right > HALF_W || b.bottom < -HALF_H || b.top > HALF_H;
}

// Scratch keeps a sprite partly on the stage: at least a sliver of it (up to 15 steps) must stay
// inside, so a sprite moved far off the edge can always be found again.
export function fence(target, maskFor) {
  const b = boundsOf(target, maskFor);
  const insetX = Math.floor(Math.min(15, (b.right - b.left) / 2));
  const insetY = Math.floor(Math.min(15, (b.top - b.bottom) / 2));
  let dx = 0;
  let dy = 0;
  if (b.right < -HALF_W + insetX) dx = -HALF_W + insetX - b.right;
  else if (b.left > HALF_W - insetX) dx = HALF_W - insetX - b.left;
  if (b.top < -HALF_H + insetY) dy = -HALF_H + insetY - b.top;
  else if (b.bottom > HALF_H - insetY) dy = HALF_H - insetY - b.bottom;
  target.x += dx;
  target.y += dy;
}
