// Pictures and sounds: turning files into costumes and sounds, decoding them, and the masks that
// touching is tested against.
//
// Decoded pictures, masks and sounds are cached by ASSET id. An asset never changes once made (an
// edited costume is a new asset), so a cache entry can never go stale.
import { newId } from '../blocks/make.js';

const images = new Map(); // assetId -> Promise<ImageBitmap | HTMLImageElement>
const decoded = new Map(); // assetId -> the decoded picture, once ready
const masks = new Map(); // assetId -> mask
const sounds = new Map(); // assetId -> Promise<AudioBuffer>

const MASK_ALPHA = 24; // out of 255: a faint anti-aliased edge does not count as touching

async function digest(blob) {
  try {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  } catch {
    return null; // no crypto.subtle (a plain-http page); assets are then just not deduplicated
  }
}

// Adds a file to the project's assets, or returns the one already there with the same bytes, so
// ten copies of one costume cost one picture.
export async function addAsset(project, blob, name) {
  const hash = await digest(blob);
  if (hash) {
    const same = project.assets.find((a) => a.hash === hash);
    if (same) return same;
  }
  const asset = { id: newId('a'), name: name || 'file', type: blob.type || 'application/octet-stream', data: blob, hash };
  project.assets.push(asset);
  return asset;
}

export function loadImage(asset) {
  if (!asset) return Promise.reject(new Error('Missing picture'));
  let p = images.get(asset.id);
  if (!p) {
    p = (async () => {
      const img = await decodeBlob(asset.data);
      decoded.set(asset.id, img);
      masks.set(asset.id, buildMask(img));
      return img;
    })();
    images.set(asset.id, p);
  }
  return p;
}

export const imageNow = (assetId) => decoded.get(assetId) || null;

async function decodeBlob(blob) {
  if (typeof createImageBitmap === 'function' && blob.type !== 'image/svg+xml') {
    try { return await createImageBitmap(blob); } catch { /* fall through to an <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// A mask is the costume's alpha, one cell per pixel up to 256 across (bigger pictures are sampled
// down), plus the box of its opaque pixels, which bounds-based blocks (edges, fencing) read.
function buildMask(img) {
  const w0 = img.width || 1;
  const h0 = img.height || 1;
  const scale = Math.min(1, 256 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h);
  let left = w;
  let right = -1;
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > MASK_ALPHA) {
        data[y * w + x] = 1;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  const box = right < 0
    ? { left: 0, top: 0, right: w0, bottom: h0 }
    : { left: left / scale, top: top / scale, right: (right + 1) / scale, bottom: (bottom + 1) / scale };
  return { w, h, scale, data, box };
}

export const maskFor = (costume) => (costume ? masks.get(costume.assetId) || null : null);

// A costume from a picture file. SVGs are drawn at twice their size into a PNG, so they stay sharp
// on the stage at resolution 2.
export async function costumeFromBlob(project, blob, name, { resolution = 1, cx = null, cy = null } = {}) {
  let file = blob;
  let res = resolution;
  if (blob.type === 'image/svg+xml') {
    const img = await decodeBlob(blob);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.width || 100) * 2));
    canvas.height = Math.max(1, Math.round((img.height || 100) * 2));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    file = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    res = 2;
  }
  // A photograph straight off a phone is enormous; anything wider than the stage at resolution 2 is
  // scaled down first, which keeps project files a sensible size.
  const img0 = await decodeBlob(file);
  const limit = 960;
  if (Math.max(img0.width, img0.height) > limit) {
    const k = limit / Math.max(img0.width, img0.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img0.width * k);
    canvas.height = Math.round(img0.height * k);
    canvas.getContext('2d').drawImage(img0, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    file = await new Promise((r) => canvas.toBlob(r, type, 0.9));
    res = Math.max(1, res);
  }
  const asset = await addAsset(project, file, name);
  const img = await loadImage(asset);
  return {
    id: newId('c'), name, assetId: asset.id, resolution: res,
    width: img.width, height: img.height,
    cx: cx ?? img.width / 2, cy: cy ?? img.height / 2,
  };
}

export async function costumeFromCanvas(project, canvas, name, opts = {}) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return costumeFromBlob(project, blob, name, opts);
}

export async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.blob();
}

// --- sounds ------------------------------------------------------------------------------------

let audioCtx = null;
export function audioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function loadSound(asset) {
  if (!asset) return Promise.reject(new Error('Missing sound'));
  let p = sounds.get(asset.id);
  if (!p) {
    p = asset.data.arrayBuffer().then((buf) => audioContext().decodeAudioData(buf));
    sounds.set(asset.id, p);
  }
  return p;
}

const decodedSounds = new Map();
export async function soundReady(asset) {
  const buf = await loadSound(asset);
  decodedSounds.set(asset.id, buf);
  return buf;
}
export const soundNow = (assetId) => decodedSounds.get(assetId) || null;

export async function soundFromBlob(project, blob, name) {
  const asset = await addAsset(project, blob, name);
  const buf = await soundReady(asset);
  return { id: newId('n'), name, assetId: asset.id, duration: buf.duration };
}

// An AudioBuffer as a WAV file, which is how a generated sound is stored in a project.
export function wavBlob(buffer) {
  const ch = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const rate = buffer.sampleRate;
  const bytes = 44 + len * ch * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * ch * 2, true); view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

// Decodes every picture and sound a project uses, so the first frame has them all.
export async function preloadProject(project) {
  const jobs = [];
  for (const t of project.targets) {
    for (const c of t.costumes) {
      const a = project.assets.find((x) => x.id === c.assetId);
      if (a) jobs.push(loadImage(a).catch(() => null));
    }
    for (const s of t.sounds) {
      const a = project.assets.find((x) => x.id === s.assetId);
      if (a) jobs.push(soundReady(a).catch(() => null));
    }
  }
  await Promise.all(jobs);
}
