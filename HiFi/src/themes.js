// HiFi world themes, DERIVED from the main app's.
//
// The main app describes a world's environment with a sky colour, linear fog, a two-colour
// ground ramp and two lights. HiFi needs rather more -- a zenith/horizon pair, cloud cover,
// a PBR ground stack, grass, a ring of hills -- and there are forty-three themes. Writing
// forty-three HiFi themes by hand would mean forty-three chances to drift from the world they
// belong to, so every one is CONVERTED from the main app's own numbers, and only the things a
// conversion cannot know (is this underwater? is this indoors? is it overcast?) are stated,
// per theme, in OVERRIDES below. A theme added to the main app tomorrow works here unedited.

import { WORLD_THEMES as CLASSIC } from '../../src/config.js';

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const toHex = ([r, g, b]) => (Math.round(Math.min(1, Math.max(0, r)) * 255) << 16) | (Math.round(Math.min(1, Math.max(0, g)) * 255) << 8) | Math.round(Math.min(1, Math.max(0, b)) * 255);
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Mean LINEAR luminance of each ground set, so a tint can be solved for: tint = wanted / mean.
const SET_LUMA = { Grass004: 0.085, Ground037: 0.12, Ground054: 0.42, Ground068: 0.075, Rock030: 0.1, Rock035: 0.035, Gravel022: 0.2, Concrete034: 0.55, PavingStones070: 0.22 };

function layer(set, hex, scale, { keepHue = 0, gain = 1 } = {}) {
  const want = lin(rgb(hex));
  const k = gain / SET_LUMA[set];
  return { set, scale, desaturate: 1 - keepHue, tint: want.map((v) => Math.min(6, v * k)) };
}

const OVERRIDES = {
  // Earth, daylight, open sky: the defaults. Listed only where something differs.
  park: { clouds: 0.42 },
  // The Moon and Mars: stones scattered over the regolith at every scale, in the ground's colour.
  moon: { airless: true, hills: 1100, craters: true, scatter: 'rocks', scatterTint: 0x77756f },
  mars: { clouds: 0.1, cloudTint: 0xf0d2b8, sunsetTint: 0x6f9bd8, hills: 800, craters: true, zenithMix: 0.35, scatter: 'rocks', scatterTint: 0x7a4a36, scatterGain: 1.15 },
  solar: { space: true },
  station: { space: true },
  sea: { submerged: true },
  reef: { submerged: true },
  voyage: { enclosed: true },
  cell: { enclosed: true },
  twister: { clouds: 0.97, overcast: true },
  london: { clouds: 0.85, overcast: true },
  ellis: { clouds: 0.6 },
  redsquare: { clouds: 0.8, overcast: true, snow: true },
  egypt: { clouds: 0.06, zenithMix: 0.45 },
  pompeii: { clouds: 0.5, zenithMix: 0.4 },
  volcano: { clouds: 0.45, zenithMix: 0.35 },
  tajmahal: { clouds: 0.25, zenithMix: 0.5 },
  delta: { clouds: 0.3, zenithMix: 0.5 },
  // WORLDS WHERE REALISM IS THE POINT get a landscape to match: what grows between the props is
  // chosen per world, the same way the props are.
  machupicchu: { clouds: 0.55, hills: 1500, snowLine: 900, grassHeight: 0.4, meadow: 0.6, undergrowth: 'tussocks' },
  dinosaur: { clouds: 0.5, grassHeight: 0.62, meadow: 1.5, undergrowth: 'ferns' },
  warren: { clouds: 0.4, grassHeight: 0.7, meadow: 1.7, undergrowth: 'flowers' },
  // A mown town: short lawns, no meadow, nothing growing wild between the houses.
  neighborhood: { clouds: 0.4, grassHeight: 0.26, meadow: 0, undergrowth: null },
  chalk: { clouds: 0.25, zenithMix: 0.3 },
  constellations: { night: true },
  observatory: { night: true },
};

function convert(name, c) {
  const o = OVERRIDES[name] ?? {};
  const sky = rgb(c.sky);
  const low = rgb(c.groundLow); const high = rgb(c.groundHigh);
  const dark = o.airless || o.space || o.night || c.stars;
  const closed = o.submerged || o.enclosed;

  // The main app's one sky colour is the HORIZON: it is also the fog colour, and fog is what
  // you see at the horizon. The zenith is the same hue, deeper -- unless the air is full of
  // dust or water, where the whole dome is nearly one colour.
  const zenithMix = o.zenithMix ?? (closed ? 0.25 : o.overcast ? 0.2 : 1);
  const deep = [sky[0] * 0.3, sky[1] * 0.46, sky[2] * 0.82];
  const zenith = dark ? sky.map((v) => v * 0.5) : sky.map((v, i) => v + (deep[i] - v) * zenithMix);

  const greenish = high[1] > high[0] * 1.04 && high[1] > high[2] * 1.12;
  const regolith = c.groundDetail === 'ground-regolith.jpg';
  const mid = low.map((v, i) => (v + high[i]) / 2);
  const ground = greenish
    ? { base: layer('Grass004', toHex(mid), 9, { keepHue: 0.6, gain: 0.78 }), alt: layer('Ground037', toHex(low), 14, { keepHue: 0.45, gain: 0.8 }), path: layer('Gravel022', 0xb8ad98, 3.6, { keepHue: 0.6 }), rock: layer('Rock030', 0x8a8478, 40, { keepHue: 0.5 }) }
    : regolith || !c.groundDetail
      ? { base: layer('Ground054', toHex(high), 16), alt: layer('Ground068', toHex(low), 12), path: layer('Gravel022', toHex(mid), 5), rock: layer('Rock030', toHex(low), 40) }
      : { base: layer('Ground068', toHex(high), 12, { keepHue: 0.15 }), alt: layer('Ground037', toHex(low), 14, { keepHue: 0.1 }), path: layer('Gravel022', toHex(mid), 4), rock: layer('Rock030', toHex(low), 40) };

  // Linear fog (near/far) -> exponential-squared density. In open air HiFi has a real horizon
  // to show, so the haze is pushed well back; in water or a body it stays as close as it was.
  const reach = closed ? 1 : o.overcast ? 2.2 : 3.4;
  const fogDensity = o.space ? 0 : 1.6 / (c.fogFar * reach);

  const sp = c.sunPosition; const len = Math.hypot(sp[0], sp[1], sp[2]);
  const flat = c.amplitude === 0;
  return {
    name,
    amplitude: c.amplitude, flatRadius: c.flatRadius, blendRadius: c.blendRadius, pockAmplitude: c.pockAmplitude ?? 0,
    sunDir: [sp[0] / len, sp[1] / len, sp[2] / len],
    sky: {
      zenith: toHex(zenith), horizon: c.sky, haze: closed || o.overcast ? 0.95 : 0.55,
      cloudCover: dark || closed ? 0 : (o.clouds ?? 0.34), cloudScale: 1, stars: dark ? 1 : 0,
      cloudTint: o.cloudTint, sunsetTint: o.sunsetTint, sunDisc: !(closed || o.overcast),
    },
    dark, closed,
    sunColor: c.sunColor, sunIntensity: c.sunIntensity * 2.15,
    ambientIntensity: c.hemiIntensity * (dark ? 0.5 : 0.42),
    hemiGround: c.hemiGround, hemiSky: c.hemiSky,
    envIntensity: dark ? Math.min(0.5, c.hemiIntensity * 0.4) : 1,
    fogDensity, exposure: 1, saturation: o.airless ? 0 : dark ? 10 : 16, contrast: 1.1,
    ground,
    grass: o.scatter ? { blades: false, undergrowth: o.scatter, tint: lin(rgb(o.scatterTint ?? c.groundHigh)).map((v) => v * (o.scatterGain ?? 2.2)), color: [0, 0, 0], tip: [0, 0, 0], height: 1 } : greenish && !dark && !closed ? { color: lin(low).map((v) => v * 0.85), tip: lin(high).map((v) => v * 1.05), height: o.grassHeight ?? 0.42, meadow: o.meadow ?? 1, undergrowth: o.undergrowth, flowers: true } : null,
    hills: o.space || flat ? null : { height: o.hills ?? 480 + c.amplitude * 60, tint: toHex(mid.map((v) => v * 0.9)), snow: o.snowLine ?? (o.snow ? 1 : 0) },
    outerAmplitude: o.space || flat ? 0 : 8 + c.amplitude * 2.2,
    craters: !!o.craters,
    water: 0x1f4f52,
  };
}

const cache = new Map();
export function hifiTheme(name) {
  const key = CLASSIC[name] ? name : 'default';
  if (!cache.has(key)) cache.set(key, convert(key, CLASSIC[key]));
  return cache.get(key);
}
