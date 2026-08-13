import * as THREE from 'three';

// Photo-sourced maps for the app's few genuinely large FLAT surfaces: the terrain, the
// museum and library hall floors, the Mars dome deck.
//
// Everything else in this project is generated in code, and stays that way. A photograph
// only wins where the surface is big, flat, and seen close up -- there, real material has
// colour variation at a range of scales that no amount of summed sine waves invents, and
// "it has no silhouette" costs nothing because the surface genuinely is flat. On anything
// a student walks around, generated geometry plus PropKit.relief() is still the right
// answer: a photo cannot give a T. rex a profile.
//
// Files live in `public/textures/` and are fetched by URL at runtime, the same as the
// startup assets -- never bundled, never stored in IndexedDB, never in a world file.

const BASE = 'textures/';

// A 1x1 white pixel, used as the stand-in image until (or instead of) the real one.
//
// This is what makes the whole module OPTIONAL. A map multiplies the material's colour,
// so a white map is a no-op: with no texture files present at all, every surface here
// falls back to exactly the flat colour or canvas texture it had before, with no errors
// and no black patches. Missing files degrade, they do not break -- which matters because
// these are fetched over HTTP at runtime and a 404 must not take the world down with it.
let whitePixel = null;
function getWhitePixel() {
  if (!whitePixel) {
    whitePixel = document.createElement('canvas');
    whitePixel.width = 1;
    whitePixel.height = 1;
    const ctx = whitePixel.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
  }
  return whitePixel;
}

// Decoded images are cached and shared; THREE.Textures built from them are NOT.
//
// PlacedRegistry.disposeObject3D() disposes a removed object's map outright, so handing
// one cached Texture to two props means the first removal destroys the survivor's map --
// the same trap that governs materials everywhere in src/props/. Caching one step lower,
// at the decoded HTMLImageElement, keeps the expensive part shared (one decode, one
// network request) while every caller still gets a Texture of its own to own and dispose.
const decoded = new Map(); // url -> Promise<HTMLImageElement | null>

function loadImage(url) {
  if (!decoded.has(url)) {
    decoded.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => {
          console.warn(`Surface texture "${url}" is missing — falling back to the flat material.`);
          resolve(null);
        };
        img.src = url;
      })
    );
  }
  return decoded.get(url);
}

// Rebalances a photograph so its AVERAGE is white while its variation survives.
//
// This is what lets a real photo sit on the terrain without fighting the theme system.
// The ground mesh is vertex-coloured -- SceneSetup writes a per-vertex height ramp from
// each theme's groundLow/groundHigh -- and a material with both `map` and `vertexColors`
// MULTIPLIES the two. Dropping a grass photo straight on would therefore stain every
// world green, Mars and the Moon included, and would square the colour where the two
// happened to agree.
//
// Normalising per channel to a mean of white makes the multiply a no-op ON AVERAGE: the
// theme still decides the hue, and the photo contributes the thing it is actually good at
// -- blades, grit, pebbles, wear, at several scales at once. `strength` damps how far the
// variation swings; 1.0 keeps the photo's full relative range, 0 returns flat white.
//
// Per channel rather than by luminance on purpose. A single luminance divisor would leave
// the photo's overall colour CAST intact, which is exactly the green-Mars problem.
function neutralized(image, strength) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  const totals = [0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    totals[0] += px[i];
    totals[1] += px[i + 1];
    totals[2] += px[i + 2];
  }
  const count = px.length / 4;
  const means = totals.map((t) => Math.max(1, t / count));

  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const relative = px[i + c] / means[c]; // 1.0 at the image's own average
      px[i + c] = Math.max(0, Math.min(255, Math.round(255 * (1 - strength * (1 - relative)))));
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// Multiplies an existing canvas tile over the photo, stretched to the photo's size.
//
// This exists because the canvases these floors already have are NOT decoration -- the
// museum's is a two-tone checker, and the Mars deck's carries a yellow hazard ring and a
// painted MUSTER marking. The obvious move is to promote the photo to `map` and demote
// the canvas to `bumpMap`, and it is wrong: a checkerboard is a checkerboard because of
// its COLOUR, and an embossed safety marking is not a safety marking. Compositing keeps
// both -- the photo supplies the material, the canvas keeps supplying the pattern, and
// the canvas can still be handed to bumpMap separately for the joints.
//
// It also makes the fallback exact rather than merely acceptable: with no photo present
// the composite is the canvas over plain white, which is precisely what the floor
// rendered before any of this existed.
function composited(image, overlay, neutralize) {
  const base = neutralize > 0 ? neutralized(image, neutralize) : image;
  const canvas = document.createElement('canvas');
  canvas.width = overlay.width;
  canvas.height = overlay.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(overlay, 0, 0);
  return canvas;
}

// A tiling photo map. Returns a Texture immediately (white until the image lands), so
// callers stay synchronous and a builder never has to become async to get one.
//
// `neutralize` > 0 runs the rebalancing above -- use it on any surface whose material
// also carries vertexColors, a strong flat `color`, or an overlay, and leave it at 0
// where the photo is meant to supply the colour outright.
//
// `overlay` is a canvas (typically `someCanvasTexture.image`) multiplied over the photo.
// When one is given, the returned texture starts out showing the OVERLAY ALONE rather
// than white, so the surface looks correct from the first frame and simply gains
// photographic depth a moment later when the image lands.
export function photoMap(file, { repeat = 1, repeatY = null, neutralize = 0, anisotropy = 8, overlay = null } = {}) {
  const texture = new THREE.Texture(overlay || getWhitePixel());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeatY ?? repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;

  loadImage(BASE + file).then((image) => {
    if (!image) return; // stays as the overlay alone -- i.e. exactly as it looked before
    texture.image = overlay ? composited(image, overlay, neutralize) : neutralize > 0 ? neutralized(image, neutralize) : image;
    texture.needsUpdate = true;
  });

  return texture;
}

// True once `file` has been fetched and decoded at least once. Only used by tests and
// the debug console -- nothing in the render path should wait on a texture.
export function isLoaded(file) {
  return decoded.has(BASE + file);
}
