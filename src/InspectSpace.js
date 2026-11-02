import * as THREE from 'three';
import { WORLD_THEMES, MODEL_GUIDE_URL } from './config.js';
import { applyWorldTheme } from './SceneSetup.js';
import { mergedMesh, seededRandom } from './PropKit.js';
import { buildProp } from './props/index.js';
import { arrivalRig, orbitRig } from './Cinema.js';
import { MODEL_BY_ID, modelCategory } from './models/catalog.js';
import { catalogModelRecord, framingDistance } from './models/index.js';

// `?inspect=animal-cell`: one model from the Model Database, alone, in a space of its own that
// takes its colours from the model and its theme from the model's subject. The "Inspect Model"
// button on docs/guide/models.html opens it.
//
// A LOOK, NOT A WORLD, and three things follow from that:
//
//   * NOTHING IS SAVED. main.js sets worldStore.persistent = false before this runs and never
//     rehydrates, so the student's own world is untouched in IndexedDB, and so is its "has
//     changes" flag. That is why this link, unlike ?world=, stays in the address bar: a refresh
//     cannot destroy anything, it just starts over, which is what the Start Over button does.
//   * THE MENU IS HIDDEN. Everything in it either replaces the world or saves it, and both of
//     those would be lying here. The hammer, Program and About this model all still work on the
//     model itself, because trying things on it is the point, and the HUD says it will not last.
//   * THE STAGE IS SCENE FURNITURE, not records. It is added to the scene and never registered,
//     the way the starfield is, so clicking the floor opens nothing, nothing can be stretched by
//     accident, and no PROP_BUILDERS key or record field is added that would then be persisted
//     forever. The one entry in WORLD_THEMES is written at runtime and no record that names it
//     can ever leave this page, because Save World is in the hidden menu.
//
// THE COLOUR IS MEASURED, NOT LOOKED UP. The model is rendered once, small, against nothing, and
// the pixels say what colour it is. Reading vertex colours or materials instead would miss
// everything painted into a canvas map, and a table of 262 palettes is one more thing to keep up
// with: this way a model added tomorrow has its space already.

const STAGE_MIN_RADIUS = 7;

// A card's first subject names the theme, so an Animal Cell gets Biology. `hue` is only used when
// the model has too little colour of its own to go on, such as a marble temple or a black engine.
const THEMES = {
  biology: { label: 'Biology', motif: 'cells', hue: 135 },
  paleontology: { label: 'Paleontology', motif: 'strata', hue: 32 },
  'earth science': { label: 'Earth Science', motif: 'strata', hue: 26 },
  astronomy: { label: 'Astronomy', motif: 'stars', hue: 228, night: true },
  'space exploration': { label: 'Space Exploration', motif: 'stars', hue: 216, night: true },
  chemistry: { label: 'Chemistry', motif: 'hexes', hue: 275 },
  physics: { label: 'Physics', motif: 'waves', hue: 250 },
  science: { label: 'Science', motif: 'waves', hue: 190 },
  mathematics: { label: 'Mathematics', motif: 'grid', hue: 170 },
  math: { label: 'Mathematics', motif: 'grid', hue: 170 },
  'computer science': { label: 'Computer Science', motif: 'circuit', hue: 160 },
  robotics: { label: 'Robotics', motif: 'circuit', hue: 195 },
  engineering: { label: 'Engineering', motif: 'gears', hue: 34 },
  history: { label: 'History', motif: 'meander', hue: 40 },
  'history of science': { label: 'History of Science', motif: 'meander', hue: 30 },
  civics: { label: 'Civics', motif: 'meander', hue: 212 },
  geography: { label: 'Geography', motif: 'contours', hue: 186 },
  music: { label: 'Music', motif: 'staves', hue: 320 },
  art: { label: 'Art', motif: 'brush', hue: 340 },
  drama: { label: 'Drama', motif: 'brush', hue: 350 },
  'language arts': { label: 'Language Arts', motif: 'letters', hue: 205 },
  economics: { label: 'Economics', motif: 'grid', hue: 145 },
  agriculture: { label: 'Agriculture', motif: 'furrows', hue: 88 },
};
const FALLBACK_THEME = { label: 'Science', motif: 'waves', hue: 190 };

export function inspectTheme(entry) {
  return THEMES[entry.subjects?.[0]] ?? FALLBACK_THEME;
}

const hsl = (h, s, l) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l, THREE.SRGBColorSpace);
const css = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${a})`;

// ---------------------------------------------------------------- measuring the model

// A small render against nothing. A render target is linear and untonemapped, which is why it is
// no good for a photograph and exactly right here: alpha is the silhouette, and hue survives.
function samplePixels(renderer, object3D) {
  const size = 72;
  const target = new THREE.WebGLRenderTarget(size, size);
  const stage = new THREE.Scene();
  const parent = object3D.parent;
  stage.add(object3D);
  object3D.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object3D);
  const centre = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);

  stage.add(new THREE.HemisphereLight(0xffffff, 0xb0b0b0, 1.4));
  const light = new THREE.DirectionalLight(0xffffff, 1.5);
  light.position.set(centre.x + radius, centre.y + radius * 2, centre.z + radius * 2);
  stage.add(light);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, radius * 10);
  camera.position.set(centre.x + radius * 1.6, centre.y + radius * 1.2, centre.z + radius * 3.2);
  camera.lookAt(centre);

  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  const shadows = renderer.shadowMap.enabled;
  const pixels = new Uint8Array(size * size * 4);
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(stage, camera);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, clearAlpha);
  renderer.shadowMap.enabled = shadows;
  target.dispose();
  if (parent) parent.add(object3D);
  object3D.updateMatrixWorld(true);
  return pixels;
}

// The hue the model mostly is, a second one if it has one, how much colour it has at all and how
// light it is. A pixel's vote is weighted by how colourful it is, or the grey shaded side of a red
// heart outvotes the red.
export function readColors(pixels) {
  const bins = new Array(36).fill(0);
  const c = new THREE.Color();
  const out = { h: 0, s: 0, l: 0 };
  let total = 0;
  let coloured = 0;
  let lightness = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    c.setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, THREE.LinearSRGBColorSpace);
    c.getHSL(out, THREE.SRGBColorSpace);
    total += 1;
    lightness += out.l;
    if (out.s < 0.16 || out.l < 0.08 || out.l > 0.94) continue;
    coloured += 1;
    bins[Math.floor(out.h * 36) % 36] += out.s;
  }
  if (!total) return { hue: null, second: null, colourful: 0, lightness: 0.5 };
  // Smoothed round the circle, so a colour split across a bin edge still counts as one colour.
  const smooth = bins.map((v, i) => v + 0.6 * (bins[(i + 35) % 36] + bins[(i + 1) % 36]));
  const peak = smooth.indexOf(Math.max(...smooth));
  const apart = (a, b) => Math.min((a - b + 36) % 36, (b - a + 36) % 36);
  let second = null;
  let best = smooth[peak] * 0.14;
  smooth.forEach((v, i) => {
    if (apart(i, peak) >= 5 && v > best) {
      best = v;
      second = i;
    }
  });
  return {
    hue: peak * 10 + 5,
    second: second === null ? null : second * 10 + 5,
    colourful: coloured / total,
    lightness: lightness / total,
  };
}

// Colours that MATCH the model and still let it stand out. Sharing a hue is what Rich asked for,
// and it is also how a warm organ disappears into a warm room (Fantastic Voyage's first sky), so
// what separates them is VALUE: a pale model gets a deep room and everything else a light one.
// Night subjects are always dark, with stars.
export function inspectPalette(entry, colors) {
  const theme = inspectTheme(entry);
  const hasColour = colors.hue !== null && colors.colourful >= 0.12;
  let hue = hasColour ? colors.hue : theme.hue;
  // Pale stone with hardly any colour, the Parthenon's case, needs the deep room as much as white
  // marble does. Sandstone with real colour in it reads well enough against a light one.
  const deep = Boolean(theme.night) || colors.lightness > 0.6 || (colors.colourful < 0.25 && colors.lightness > 0.42);
  // Yellow turns to olive as it darkens, so a deep room pulls it round toward amber.
  if (deep && !theme.night && hue >= 38 && hue <= 75) hue = 32;
  // The accent writes the theme's name on the wall. With no second colour of its own, a warm room
  // takes the cool far side of the wheel and a cool room a deeper neighbour: teal on tan is handsome
  // and red on teal is a warning sign. Yellows go olive as soon as they are dark enough to read on a
  // light wall, so they give way to the same choice.
  const warm = hue <= 100 || hue >= 330;
  const fallback = warm ? hue + 165 : hue + 30;
  let accentHue = hasColour && colors.second !== null ? colors.second : fallback;
  const wrapped = ((accentHue % 360) + 360) % 360;
  if (!deep && wrapped >= 40 && wrapped <= 95) accentHue = fallback;
  return { hue, accentHue, deep, night: Boolean(theme.night) };
}

function roomTheme({ hue, deep, night }, reach) {
  // The fog has to stay clear of the model and still hide the end of the 400ft ground plane.
  const fogNear = Math.max(70, reach * 1.6);
  const base = {
    amplitude: 0, flatRadius: 300, blendRadius: 310,
    fogNear,
    fogFar: Math.max(190, fogNear + 110),
    sunPosition: [60, 90, 40],
  };
  if (night) {
    return {
      ...base,
      sky: hsl(hue, 0.5, 0.07).getHex(),
      groundLow: hsl(hue, 0.28, 0.14).getHex(),
      groundHigh: hsl(hue, 0.28, 0.14).getHex(),
      hemiSky: 0xcfd8f0, hemiGround: hsl(hue, 0.2, 0.4).getHex(), hemiIntensity: 1.5,
      sunColor: 0xfff6e8, sunIntensity: 2.6,
      stars: true,
    };
  }
  if (deep) {
    return {
      ...base,
      sky: hsl(hue, 0.42, 0.3).getHex(),
      groundLow: hsl(hue, 0.3, 0.24).getHex(),
      groundHigh: hsl(hue, 0.3, 0.24).getHex(),
      hemiSky: 0xffffff, hemiGround: hsl(hue, 0.18, 0.45).getHex(), hemiIntensity: 1.35,
      sunColor: 0xfff4e4, sunIntensity: 2.3,
      stars: false,
    };
  }
  return {
    ...base,
    sky: hsl(hue, 0.5, 0.82).getHex(),
    groundLow: hsl(hue, 0.3, 0.55).getHex(),
    groundHigh: hsl(hue, 0.3, 0.55).getHex(),
    hemiSky: 0xffffff, hemiGround: hsl(hue, 0.18, 0.6).getHex(), hemiIntensity: 1.5,
    sunColor: 0xfff6e8, sunIntensity: 2.0,
    stars: false,
  };
}

// ---------------------------------------------------------------- the subject's pattern

// Each draws its subject's pattern over a whole rectangle in the current stroke and fill. One ink,
// so the same painter serves the wall and the floor in whatever colours this model asked for.
const MOTIFS = {
  cells(c, w, h, r) {
    const n = Math.round((w * h) / 26000);
    for (let i = 0; i < n; i += 1) {
      const x = r() * w;
      const y = r() * h;
      const R = 22 + r() * 46;
      c.beginPath();
      for (let a = 0; a <= 24; a += 1) {
        const t = (a / 24) * Math.PI * 2;
        const k = 1 + 0.09 * Math.sin(t * 3 + i) + 0.05 * Math.sin(t * 5 + i * 2);
        c.lineTo(x + Math.cos(t) * R * k, y + Math.sin(t) * R * k * 0.86);
      }
      c.closePath();
      c.stroke();
      c.beginPath();
      c.arc(x + R * 0.15, y - R * 0.1, R * 0.28, 0, Math.PI * 2);
      c.fill();
    }
  },
  hexes(c, w, h) {
    const R = 54;
    const dx = R * Math.sqrt(3);
    const dy = R * 1.5;
    for (let row = -1; row * dy < h + R; row += 1) {
      for (let col = -1; col * dx < w + R; col += 1) {
        const x = col * dx + (row % 2 ? dx / 2 : 0);
        const y = row * dy;
        c.beginPath();
        for (let a = 0; a < 6; a += 1) {
          const t = Math.PI / 6 + (a * Math.PI) / 3;
          c.lineTo(x + Math.cos(t) * R, y + Math.sin(t) * R);
        }
        c.closePath();
        c.stroke();
        if ((row + col * 3) % 5 === 0) {
          c.beginPath();
          c.arc(x, y, 9, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  },
  stars(c, w, h, r) {
    const n = Math.round((w * h) / 2400);
    for (let i = 0; i < n; i += 1) {
      c.beginPath();
      c.arc(r() * w, r() * h, 0.8 + r() * r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 7; i += 1) {
      c.beginPath();
      c.ellipse(r() * w, r() * h, 110 + r() * 260, 30 + r() * 80, r() * 3, 0, Math.PI * 2);
      c.stroke();
    }
  },
  waves(c, w, h, r) {
    for (let y = 40; y < h + 60; y += 62) {
      const f = 0.012 + r() * 0.012;
      const p = r() * 6;
      const A = 12 + r() * 16;
      c.beginPath();
      for (let x = 0; x <= w; x += 8) c.lineTo(x, y + Math.sin(x * f + p) * A);
      c.stroke();
    }
  },
  grid(c, w, h) {
    const step = 46;
    c.save();
    c.globalAlpha *= 0.55;
    for (let x = 0; x <= w; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y <= h; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.restore();
    for (let k = 0; k < 3; k += 1) {
      c.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const u = x / w;
        c.lineTo(x, h * (0.75 - 0.55 * Math.pow(u, 1 + k) - 0.08 * Math.sin(u * (8 + k * 5))));
      }
      c.stroke();
    }
  },
  circuit(c, w, h, r) {
    for (let i = 0; i < Math.round((w * h) / 22000); i += 1) {
      let x = Math.round(r() * w / 26) * 26;
      let y = Math.round(r() * h / 26) * 26;
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.moveTo(x, y);
      for (let s = 0; s < 3; s += 1) {
        const run = 26 * (2 + Math.floor(r() * 5));
        if (s % 2) y += r() > 0.5 ? run : -run;
        else x += r() > 0.5 ? run : -run;
        c.lineTo(x, y);
      }
      c.stroke();
      c.beginPath();
      c.arc(x, y, 7, 0, Math.PI * 2);
      c.fill();
    }
  },
  gears(c, w, h, r) {
    for (let i = 0; i < Math.round((w * h) / 42000); i += 1) {
      const x = r() * w;
      const y = r() * h;
      const R = 34 + r() * 56;
      const teeth = Math.round(R / 7);
      c.beginPath();
      for (let t = 0; t < teeth * 4; t += 1) {
        const a = (t / (teeth * 4)) * Math.PI * 2;
        const out = t % 4 < 2 ? R : R * 0.84;
        c.lineTo(x + Math.cos(a) * out, y + Math.sin(a) * out);
      }
      c.closePath();
      c.stroke();
      c.beginPath();
      c.arc(x, y, R * 0.28, 0, Math.PI * 2);
      c.stroke();
    }
  },
  // The Greek key, in bands.
  meander(c, w, h) {
    const u = 16;
    for (let y = 30; y < h; y += u * 11) {
      for (let x = 0; x < w; x += u * 7) {
        c.beginPath();
        c.moveTo(x, y + u * 6);
        c.lineTo(x, y);
        c.lineTo(x + u * 5, y);
        c.lineTo(x + u * 5, y + u * 4);
        c.lineTo(x + u * 2, y + u * 4);
        c.lineTo(x + u * 2, y + u * 2);
        c.lineTo(x + u * 3, y + u * 2);
        c.moveTo(x, y + u * 6);
        c.lineTo(x + u * 7, y + u * 6);
        c.stroke();
      }
    }
  },
  contours(c, w, h, r) {
    for (let i = 0; i < Math.round((w * h) / 90000) + 2; i += 1) {
      const x = r() * w;
      const y = r() * h;
      const p = r() * 6;
      for (let k = 1; k <= 6; k += 1) {
        const R = k * 30;
        c.beginPath();
        for (let a = 0; a <= 40; a += 1) {
          const t = (a / 40) * Math.PI * 2;
          const q = R * (1 + 0.16 * Math.sin(t * 2 + p) + 0.08 * Math.sin(t * 3 + p * 2));
          c.lineTo(x + Math.cos(t) * q, y + Math.sin(t) * q * 0.8);
        }
        c.closePath();
        c.stroke();
      }
    }
  },
  strata(c, w, h, r) {
    let y = 10;
    while (y < h + 40) {
      const p = r() * 6;
      c.beginPath();
      for (let x = 0; x <= w; x += 12) c.lineTo(x, y + Math.sin(x * 0.006 + p) * 12 + Math.sin(x * 0.019 + p) * 4);
      c.stroke();
      y += 12 + r() * r() * 70;
    }
    for (let i = 0; i < Math.round((w * h) / 9000); i += 1) {
      c.beginPath();
      c.ellipse(r() * w, r() * h, 3 + r() * 7, 2 + r() * 4, r() * 3, 0, Math.PI * 2);
      c.fill();
    }
  },
  staves(c, w, h, r) {
    for (let y = 40; y < h; y += 150) {
      const p = r() * 6;
      const at = (x, line) => y + line * 13 + Math.sin(x * 0.006 + p) * 14;
      for (let line = 0; line < 5; line += 1) {
        c.beginPath();
        for (let x = 0; x <= w; x += 10) c.lineTo(x, at(x, line));
        c.stroke();
      }
      for (let x = 40 + r() * 50; x < w; x += 54 + r() * 90) {
        const line = Math.floor(r() * 5);
        const ny = at(x, line);
        c.beginPath();
        c.ellipse(x, ny, 9, 6.5, -0.35, 0, Math.PI * 2);
        c.fill();
        c.beginPath();
        c.moveTo(x + 8, ny);
        c.lineTo(x + 8, ny - 42);
        c.stroke();
      }
    }
  },
  brush(c, w, h, r) {
    for (let i = 0; i < Math.round((w * h) / 30000); i += 1) {
      const x = r() * w;
      const y = r() * h;
      const L = 90 + r() * 180;
      c.save();
      c.lineCap = 'round';
      c.lineWidth = 7 + r() * 16;
      c.beginPath();
      c.moveTo(x, y);
      c.bezierCurveTo(x + L * 0.3, y - 60 * r(), x + L * 0.7, y + 60 * r(), x + L, y - 20);
      c.stroke();
      c.restore();
    }
  },
  letters(c, w, h, r) {
    const glyphs = 'AaBbGgQqRrSsEeTt&?!';
    for (let i = 0; i < Math.round((w * h) / 9000); i += 1) {
      c.font = `${28 + Math.round(r() * 44)}px Georgia, serif`;
      c.fillText(glyphs[Math.floor(r() * glyphs.length)], r() * w, r() * h);
    }
  },
  furrows(c, w, h, r) {
    for (let y = 24; y < h; y += 46) {
      const p = r() * 6;
      c.beginPath();
      for (let x = 0; x <= w; x += 12) c.lineTo(x, y + Math.sin(x * 0.004 + p) * 9);
      c.stroke();
      for (let x = r() * 30; x < w; x += 34) {
        const sy = y + Math.sin(x * 0.004 + p) * 9;
        c.beginPath();
        c.moveTo(x, sy);
        c.quadraticCurveTo(x - 9, sy - 15, x - 13, sy - 11);
        c.moveTo(x, sy);
        c.quadraticCurveTo(x + 9, sy - 17, x + 13, sy - 13);
        c.stroke();
      }
    }
  },
};

// Measured and shrunk, the rule every sign in this project learned the hard way.
function fitFont(ctx, text, maxWidth, size, build) {
  let px = size;
  ctx.font = build(px);
  while (ctx.measureText(text).width > maxWidth && px > 14) {
    px -= 2;
    ctx.font = build(px);
  }
  return px;
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function textureOf(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// ---------------------------------------------------------------- the stage

// The round floor the model stands on. It is painted at ground level rather than raised, because
// PlayerController walks on the terrain and never on props, so a raised stage puts a student's
// eyes below the deck, and because Reset Shape seats a model on the ground and would bury it in
// one. It fades out at its edge so it never ends in a hard circle.
function stageFloor(palette, theme, stageRadius) {
  const { hue, accentHue, deep, night } = palette;
  const dark = deep || night;
  const size = 2048;
  const canvas = canvasOf(size, size);
  const c = canvas.getContext('2d');
  const mid = size / 2;
  const floorRadius = stageRadius * 2.5;
  const stagePx = mid * (stageRadius / floorRadius);

  c.fillStyle = dark ? css(hue, 0.3, night ? 0.16 : 0.3) : css(hue, 0.34, 0.68);
  c.fillRect(0, 0, size, size);
  c.save();
  c.strokeStyle = dark ? css(hue, 0.5, 0.62, 0.34) : css(hue, 0.55, 0.3, 0.3);
  c.fillStyle = c.strokeStyle;
  c.lineWidth = 3;
  MOTIFS[theme.motif](c, size, size, seededRandom(11));
  c.restore();

  // The plate itself, so the eye has a clear disc to read the model against.
  c.fillStyle = dark ? css(hue, 0.3, night ? 0.22 : 0.4) : css(hue, 0.42, 0.78);
  c.beginPath();
  c.arc(mid, mid, stagePx, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 18;
  c.strokeStyle = css(accentHue, 0.7, dark ? 0.62 : 0.42);
  c.stroke();
  c.lineWidth = 4;
  c.beginPath();
  c.arc(mid, mid, stagePx * 1.1, 0, Math.PI * 2);
  c.stroke();

  // Fade to nothing at the rim, so the painted floor melts into the ground.
  c.globalCompositeOperation = 'destination-in';
  const fade = c.createRadialGradient(mid, mid, stagePx * 1.15, mid, mid, mid);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = fade;
  c.fillRect(0, 0, size, size);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(floorRadius, 96),
    new THREE.MeshStandardMaterial({ map: textureOf(canvas), transparent: true, depthWrite: false, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  floor.receiveShadow = true;
  return floor;
}

// A strip of an arc, wound to face the axis or to face away from it.
function arcStrip(radius, height, halfAngle, { inward, base = 0 }) {
  const steps = 64;
  const positions = [];
  const uvs = [];
  const index = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const a = -halfAngle + u * 2 * halfAngle;
    const x = Math.sin(a) * radius;
    const z = -Math.cos(a) * radius;
    positions.push(x, base, z, x, base + height, z);
    uvs.push(u, 0, u, 1);
  }
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    if (inward) index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

// A curved backdrop behind the model, carrying the subject's name and pattern, and fading into the
// sky along its top and both ends. The word appears twice, either side of the middle, because the
// middle is where the model stands. Unlit and fog-free, because a backdrop that takes the sun goes
// black the moment it faces away from it.
function backdrop(palette, theme, radius, height) {
  const { hue, accentHue, deep, night } = palette;
  const dark = deep || night;
  const halfAngle = THREE.MathUtils.degToRad(100);
  // The canvas takes the wall's own proportions, or every letter on it comes out squeezed.
  const W = 3072;
  const H = THREE.MathUtils.clamp(Math.round((W * height) / (radius * 2 * halfAngle)), 512, 1536);
  const canvas = canvasOf(W, H);
  const c = canvas.getContext('2d');

  const band = c.createLinearGradient(0, H, 0, 0);
  if (night) {
    band.addColorStop(0, css(hue, 0.55, 0.2));
    band.addColorStop(1, css(hue, 0.55, 0.1));
  } else if (dark) {
    band.addColorStop(0, css(hue, 0.5, 0.22));
    band.addColorStop(1, css(hue, 0.46, 0.27));
  } else {
    band.addColorStop(0, css(hue, 0.56, 0.62));
    band.addColorStop(1, css(hue, 0.52, 0.76));
  }
  c.fillStyle = band;
  c.fillRect(0, 0, W, H);

  c.save();
  c.strokeStyle = dark ? css(hue, 0.5, 0.74, 0.3) : css(hue, 0.6, 0.97, 0.5);
  c.fillStyle = c.strokeStyle;
  c.lineWidth = 3;
  MOTIFS[theme.motif](c, W, H, seededRandom(23));
  c.restore();

  // The theme's name, in the two places the model is not.
  const word = theme.label.toUpperCase();
  const build = (px) => `800 ${px}px Fredoka, Nunito, "Helvetica Neue", Arial, sans-serif`;
  const px = fitFont(c, word, W * 0.2, Math.round(H * 0.22), build);
  c.font = build(px);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = dark ? css(accentHue, 0.85, 0.82) : css(accentHue, 0.8, 0.26);
  // Up in the wall's top third, because anything wide on the stage covers its middle.
  for (const x of [W * 0.25, W * 0.75]) c.fillText(word, x, H * 0.28);

  // Fading out the top and both ends, so it reads as a band of light and not a billboard.
  c.globalCompositeOperation = 'destination-in';
  const up = c.createLinearGradient(0, H, 0, 0);
  up.addColorStop(0, 'rgba(0,0,0,1)');
  up.addColorStop(0.84, 'rgba(0,0,0,1)');
  up.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = up;
  c.fillRect(0, 0, W, H);
  const across = c.createLinearGradient(0, 0, W, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.06, 'rgba(0,0,0,1)');
  across.addColorStop(0.94, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = across;
  c.fillRect(0, 0, W, H);

  const front = new THREE.Mesh(
    arcStrip(radius, height, halfAngle, { inward: true }),
    new THREE.MeshBasicMaterial({ map: textureOf(canvas), transparent: true, depthWrite: false, fog: false, toneMapped: false }),
  );

  // Its far side, plain, so walking behind it shows no mirror writing.
  const backCanvas = canvasOf(64, 64);
  const b = backCanvas.getContext('2d');
  b.drawImage(canvas, 0, 0, W, H, 0, 0, 64, 64);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = dark ? css(hue, 0.4, 0.2) : css(hue, 0.44, 0.7);
  b.fillRect(0, 0, 64, 64);
  const back = new THREE.Mesh(
    arcStrip(radius + 0.05, height, halfAngle, { inward: false }),
    new THREE.MeshBasicMaterial({ map: textureOf(backCanvas), transparent: true, depthWrite: false, fog: false, toneMapped: false }),
  );

  const g = new THREE.Group();
  g.add(front, back);
  return g;
}

// What drifts overhead, one simple solid per subject. They are what stops a stage reading as a flat
// picture, one merged mesh turning as a whole, so the lot costs one draw call.
const FLOATER = {
  cells: () => new THREE.IcosahedronGeometry(1, 3),
  hexes: () => new THREE.CylinderGeometry(1, 1, 0.45, 6),
  stars: () => new THREE.OctahedronGeometry(1, 0),
  waves: () => new THREE.TorusGeometry(0.85, 0.2, 10, 28),
  grid: () => new THREE.TetrahedronGeometry(1.2, 0),
  circuit: () => new THREE.BoxGeometry(1.5, 0.3, 1.5),
  gears: () => new THREE.TorusGeometry(0.85, 0.3, 6, 12),
  meander: () => new THREE.CylinderGeometry(0.72, 0.8, 1.3, 16),
  contours: () => new THREE.ConeGeometry(1.05, 1.25, 8),
  strata: () => new THREE.DodecahedronGeometry(1, 0),
  staves: () => new THREE.SphereGeometry(0.85, 16, 10),
  brush: () => new THREE.IcosahedronGeometry(0.95, 1),
  letters: () => new THREE.BoxGeometry(1.2, 1.5, 0.3),
  furrows: () => new THREE.SphereGeometry(0.72, 12, 10),
};

function floaters(palette, theme, innerRadius, minY) {
  const { hue, accentHue, deep, night } = palette;
  const dark = deep || night;
  const r = seededRandom(37);
  const parts = [];
  const count = 22;
  const base = FLOATER[theme.motif]();
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + r() * 0.2;
    const radius = innerRadius * (1 + r() * 0.75);
    const size = (0.55 + r() * 1.1) * Math.max(1, innerRadius / 26);
    const geometry = base.clone().scale(size, size, size);
    const accent = i % 3 === 0;
    parts.push({
      geometry,
      color: hsl(accent ? accentHue : hue, 0.62, dark ? (accent ? 0.66 : 0.55) : (accent ? 0.48 : 0.62)).getHex(),
      rotation: [r() * 3, r() * 3, r() * 3],
      position: [Math.sin(a) * radius, minY + r() * r() * minY * 1.2 + 2, Math.cos(a) * radius],
    });
  }
  const mesh = mergedMesh(parts, { roughness: 0.55, metalness: 0.05, flatShading: theme.motif === 'stars' });
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// Two placards, one either side of the arrival, read at arm's length. Their own cards fit their
// text to the panel. They stand close to the student and wide, where they can never cover the model.
function placards(entry, palette, theme, spawnZ, aspect) {
  const accent = css(palette.accentHue, 0.7, 0.42);
  // fov 70 is VERTICAL, so how far out a sign can stand and still be on screen depends on the
  // screen. On a tall one there is no room beside the model at all, so they stand out of the
  // arrival frame and are found by looking round.
  const halfView = THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) * aspect));
  const bearing = THREE.MathUtils.degToRad(aspect < 1.2 ? 62 : halfView - 8);
  const reach = Math.min(13, spawnZ * 0.7 + 3);
  const signs = [
    [-1, { title: entry.title, eyebrow: theme.label, body: `${entry.blurb} ${entry.facts[0]}` }],
    [1, { title: 'Real size', eyebrow: entry.shownAt, body: `${entry.realSize}. ${entry.facts[1] ?? ''}`.trim() }],
  ];
  return signs.map(([side, text]) => {
    const prop = buildProp('info-placard', { ...text, accent, width: 3.3, height: 2.7 });
    const x = side * Math.sin(bearing) * reach;
    const z = spawnZ - Math.cos(bearing) * reach;
    prop.position.set(x, 0, z);
    prop.rotation.y = Math.atan2(-x, spawnZ - z);
    return prop;
  });
}

// A dome instead of the plain background colour, for one reason: scene.background is not tone mapped
// and fog is, so the far ground fogs to a darker colour than the sky above it and the room ends in
// a hard line all the way round. Through the same tone mapping the two meet exactly. Night keeps
// the plain background, because a dome would shut out the starfield and dark hides the line anyway.
function skyDome(palette) {
  const { hue, deep } = palette;
  const geometry = new THREE.SphereGeometry(320, 32, 16);
  const horizon = hsl(hue, deep ? 0.42 : 0.5, deep ? 0.3 : 0.82);
  const zenith = hsl(hue + 12, deep ? 0.5 : 0.58, deep ? 0.17 : 0.66);
  const colors = [];
  const c = new THREE.Color();
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const up = Math.max(0, position.getY(i) / 320);
    c.copy(horizon).lerp(zenith, Math.min(1, up * 1.6));
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
}

function buildStage({ entry, palette, theme, stageRadius, height, spawnZ, aspect }) {
  const group = new THREE.Group();
  group.userData.isInspectStage = true;
  if (!palette.night) group.add(skyDome(palette));
  const wallRadius = Math.max(stageRadius * 2.1, stageRadius + 14);
  const wallHeight = Math.max(height * 1.25, 18);
  group.add(stageFloor(palette, theme, stageRadius));
  group.add(backdrop(palette, theme, wallRadius, wallHeight));
  const drift = floaters(palette, theme, wallRadius * 1.1, wallHeight + 4);
  group.add(drift);
  for (const sign of placards(entry, palette, theme, spawnZ, aspect)) group.add(sign);
  return { group, drift };
}

// The sun's shadow camera is fitted to the whole 400ft ground, which is 2.3 inches a texel. Over
// one model that is what makes a 2ft heart's shadow a blur, and here there is only the one model.
function tightenShadows(scene, reach) {
  scene.traverse((node) => {
    if (!node.isDirectionalLight) return;
    const extent = Math.max(reach * 1.5, 18);
    const shadow = node.shadow;
    shadow.camera.left = -extent;
    shadow.camera.right = extent;
    shadow.camera.top = extent;
    shadow.camera.bottom = -extent;
    shadow.camera.updateProjectionMatrix();
    shadow.normalBias = 0.02;
  });
}

// ---------------------------------------------------------------- the HUD

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// A veil over the build. The heaviest models take a second or two on the main thread, and without
// it the student would watch an empty field change colour.
function showVeil(entry, theme) {
  const veil = element('div', 'inspect-veil');
  veil.setAttribute('role', 'status');
  veil.append(element('b', '', entry.title), element('small', '', `Setting up the ${theme.label} space…`));
  document.body.appendChild(veil);
  return veil;
}

function showHud({ entry, theme, palette, category, cinema, modelId }) {
  const hud = element('aside', 'inspect-hud');
  hud.setAttribute('aria-label', `Inspecting ${entry.title}`);
  hud.style.setProperty('--inspect-accent', css(palette.accentHue, 0.75, 0.62));

  const name = element('div', 'inspect-name');
  name.append(element('span', 'inspect-eyebrow', `${category?.icon ?? ''} ${theme.label}`.trim()));
  name.append(element('h1', 'inspect-title', entry.title));
  hud.append(name);
  hud.append(element('p', 'inspect-note', 'Arrow keys to walk round it, drag to look. Click the model for its facts, or the hammer to change it. Nothing here is saved.'));

  const row = element('div', 'inspect-actions');
  const fly = element('button', 'inspect-btn inspect-btn-go', '🎥 Fly round it');
  fly.type = 'button';
  fly.addEventListener('click', () => {
    const rig = orbitRig(cinema, modelId, { seconds: 14 });
    if (rig) cinema.take('Orbit', rig);
  });
  const over = element('button', 'inspect-btn', '↺ Start over');
  over.type = 'button';
  over.addEventListener('click', () => window.location.reload());
  const back = element('a', 'inspect-btn', '← All models');
  back.href = `${MODEL_GUIDE_URL}#model-${entry.id}`;
  const own = element('a', 'inspect-btn', 'Open my world');
  // The app's own address with no parameter, which rehydrates what the student has saved.
  own.href = window.location.pathname;
  row.append(fly, over, back, own);
  hud.append(row);
  document.body.appendChild(hud);
  return hud;
}

// ---------------------------------------------------------------- opening

export async function openInspectSpace({ id, scene, renderer, camera, player, cinema, worldStore, registry }) {
  const entry = MODEL_BY_ID.get(id);
  const theme = inspectTheme(entry);
  const veil = showVeil(entry, theme);
  document.body.classList.add('inspect-mode');
  document.title = `${entry.title} — Inspect in Edusim`;
  // Let the veil paint before the build takes the main thread.
  await new Promise((resolve) => setTimeout(resolve, 30));

  try {
    const record = catalogModelRecord(entry, {
      position: [0, entry.hover ?? 0, 0],
      rotation: [0, entry.yaw ?? 0, 0],
      scale: new Array(3).fill(entry.scale ?? 1),
    });
    await worldStore.loadFromRecords([record]);
    const item = registry.get(record.id);
    if (!item?.object3D) throw new Error('The model did not build.');

    const object3D = item.object3D;
    const colors = readColors(samplePixels(renderer, object3D));
    const palette = inspectPalette(entry, colors);

    const box = new THREE.Box3().setFromObject(object3D);
    const size = box.getSize(new THREE.Vector3());
    const footprint = Math.hypot(Math.max(Math.abs(box.min.x), box.max.x), Math.max(Math.abs(box.min.z), box.max.z));
    // Width counts for a quarter more than it is, which leaves the sides of the frame for the signs.
    const distance = framingDistance({
      width: size.x * 1.25, height: size.y, depth: size.z, eye: 5, aspect: camera.aspect,
    });
    // A tall model puts the student a long way back, and the painted floor has to reach them.
    const stageRadius = Math.max(footprint * 1.12 + 1.2, STAGE_MIN_RADIUS, distance * 0.42);
    const spawnZ = Math.max(distance + 2, stageRadius + 3);

    WORLD_THEMES.inspect = roomTheme(palette, spawnZ + stageRadius);
    applyWorldTheme('inspect');
    tightenShadows(scene, Math.max(stageRadius * 1.5, spawnZ));

    const { group, drift } = buildStage({ entry, palette, theme, stageRadius, height: size.y, spawnZ, aspect: camera.aspect });
    scene.add(group);

    // A little downward look at a small model, which would otherwise sit at the bottom of the frame.
    const lookAtY = Math.min(box.max.y * 0.55, 5);
    const pitch = Math.atan2(lookAtY - 5, spawnZ) * 0.8;
    const spawn = { x: 0, z: spawnZ, yaw: 0, pitch };
    player.resetTo(spawn);
    const swoop = arrivalRig(cinema, spawn);
    if (swoop) cinema.take('Arrival', swoop);

    const category = modelCategory(entry.category);
    showHud({ entry, theme, palette, category, cinema, modelId: record.id });
    veil.remove();

    return {
      colors,
      palette,
      theme,
      stageRadius,
      spawnZ,
      tick(dt, reduced) {
        if (!reduced) drift.rotation.y += dt * 0.025;
      },
    };
  } catch (err) {
    console.error('Could not open the inspect space:', err);
    veil.replaceChildren(
      element('b', '', `Could not open ${entry.title}`),
      Object.assign(element('a', '', 'Open Edusim instead'), { href: window.location.pathname }),
    );
    throw err;
  }
}
