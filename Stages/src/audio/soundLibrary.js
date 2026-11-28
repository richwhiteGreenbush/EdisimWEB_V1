// The sound library. EVERY SOUND IS GENERATED: none is a recording, so there is nothing to license
// and nothing to credit (plan, section 4). Each is rendered once, on demand, into an AudioBuffer and
// stored in the project as a small WAV, so a project file plays the same sound on any computer.
//
// The four music tunes are the Social Media Studio's own generative styles (src/studio/StudioAudio.js),
// rendered short.
//
// Ids are PERSISTED (a sound remembers which library entry it came from), so only ever add.

const RATE = 44100;

function noise(ctx, seconds, seed = 1) {
  const buf = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed * 9301 + 49297;
  for (let i = 0; i < d.length; i++) {
    s = (s * 9301 + 49297) % 233280;
    d[i] = (s / 233280) * 2 - 1;
  }
  return buf;
}

// A few building blocks, so each sound is a short recipe.
function tone(ctx, out, t, f, { type = 'sine', to = null, glide = 0.1, a = 0.005, d = 0.3, level = 0.3, cutoff = null } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + glide);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  let n = o;
  if (cutoff) {
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    o.connect(filt);
    n = filt;
  }
  n.connect(g).connect(out);
  o.start(t);
  o.stop(t + a + d + 0.05);
}

function hiss(ctx, out, t, { type = 'bandpass', f = 1000, to = null, q = 1, a = 0.002, d = 0.2, level = 0.3, seed = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, a + d + 0.1, seed);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f, t);
  if (to) filt.frequency.exponentialRampToValueAtTime(to, t + a + d);
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  src.connect(filt).connect(g).connect(out);
  src.start(t);
}

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export const SOUNDS = [
  // --- game ---
  { id: 'pop', name: 'Pop', tags: ['effects'], seconds: 0.25, make: (c, o) => { tone(c, o, 0, 520, { to: 1180, glide: 0.07, d: 0.12, level: 0.4 }); hiss(c, o, 0, { type: 'highpass', f: 3000, d: 0.03, level: 0.12 }); } },
  { id: 'coin', name: 'Coin', tags: ['game'], seconds: 0.5, make: (c, o) => { tone(c, o, 0, 988, { type: 'square', d: 0.08, level: 0.15, cutoff: 4000 }); tone(c, o, 0.08, 1319, { type: 'square', d: 0.32, level: 0.15, cutoff: 4000 }); } },
  { id: 'jump', name: 'Jump', tags: ['game'], seconds: 0.35, make: (c, o) => tone(c, o, 0, 260, { type: 'square', to: 760, glide: 0.18, d: 0.25, level: 0.14, cutoff: 2500 }) },
  { id: 'boing', name: 'Boing', tags: ['effects', 'game'], seconds: 0.7, make: (c, o) => { tone(c, o, 0, 140, { type: 'triangle', to: 520, glide: 0.12, d: 0.5, level: 0.4 }); tone(c, o, 0.12, 520, { type: 'sine', to: 300, glide: 0.4, d: 0.45, level: 0.2 }); } },
  { id: 'laser', name: 'Laser', tags: ['game', 'space'], seconds: 0.35, make: (c, o) => tone(c, o, 0, 1800, { type: 'sawtooth', to: 220, glide: 0.25, d: 0.28, level: 0.15, cutoff: 5000 }) },
  { id: 'zap', name: 'Zap', tags: ['game', 'space'], seconds: 0.3, make: (c, o) => { tone(c, o, 0, 880, { type: 'square', to: 3000, glide: 0.05, d: 0.08, level: 0.12 }); tone(c, o, 0.06, 3000, { type: 'square', to: 600, glide: 0.18, d: 0.2, level: 0.1 }); } },
  { id: 'explosion', name: 'Explosion', tags: ['game', 'space'], seconds: 1.4, make: (c, o) => { hiss(c, o, 0, { type: 'lowpass', f: 1800, to: 120, q: 0.7, a: 0.01, d: 1.2, level: 0.7, seed: 3 }); tone(c, o, 0, 90, { to: 40, glide: 0.4, d: 0.6, level: 0.5 }); } },
  { id: 'hit', name: 'Hit', tags: ['game'], seconds: 0.3, make: (c, o) => { tone(c, o, 0, 180, { to: 60, glide: 0.1, d: 0.15, level: 0.5 }); hiss(c, o, 0, { f: 1500, q: 1.5, d: 0.08, level: 0.35, seed: 5 }); } },
  { id: 'power-up', name: 'Power Up', tags: ['game'], seconds: 0.9, make: (c, o) => { [60, 64, 67, 72, 76, 79, 84].forEach((m, i) => tone(c, o, i * 0.07, mtof(m), { type: 'square', d: 0.12, level: 0.09, cutoff: 4000 })); } },
  { id: 'power-down', name: 'Power Down', tags: ['game'], seconds: 0.9, make: (c, o) => { [84, 79, 76, 72, 67, 64, 60].forEach((m, i) => tone(c, o, i * 0.08, mtof(m), { type: 'square', d: 0.13, level: 0.09, cutoff: 3000 })); } },
  { id: 'win', name: 'You Win', tags: ['game', 'music'], seconds: 1.6, make: (c, o) => { [[72, 0], [76, 0.15], [79, 0.3], [84, 0.45]].forEach(([m, t]) => tone(c, o, t, mtof(m), { type: 'triangle', d: 0.6, level: 0.22 })); [60, 64, 67].forEach((m) => tone(c, o, 0.45, mtof(m), { type: 'triangle', d: 1.1, level: 0.14 })); } },
  { id: 'game-over', name: 'Game Over', tags: ['game', 'music'], seconds: 1.8, make: (c, o) => { [[67, 0], [66, 0.3], [65, 0.6], [64, 0.9]].forEach(([m, t]) => tone(c, o, t, mtof(m), { type: 'square', d: t > 0.8 ? 0.8 : 0.28, level: 0.11, cutoff: 1800 })); } },
  { id: 'click', name: 'Click', tags: ['effects'], seconds: 0.1, make: (c, o) => hiss(c, o, 0, { f: 3200, q: 3, d: 0.02, level: 0.5 }) },
  { id: 'beep', name: 'Beep', tags: ['effects'], seconds: 0.3, make: (c, o) => tone(c, o, 0, 988, { type: 'square', d: 0.2, level: 0.1, cutoff: 3000 }) },
  { id: 'alarm', name: 'Alarm', tags: ['effects'], seconds: 1.2, make: (c, o) => { for (let i = 0; i < 4; i++) tone(c, o, i * 0.3, i % 2 ? 660 : 880, { type: 'square', d: 0.25, level: 0.08, cutoff: 3000 }); } },
  // --- effects ---
  { id: 'whoosh', name: 'Whoosh', tags: ['effects'], seconds: 0.7, make: (c, o) => hiss(c, o, 0, { f: 300, to: 3500, q: 0.9, a: 0.25, d: 0.35, level: 0.4, seed: 7 }) },
  { id: 'magic', name: 'Magic', tags: ['effects'], seconds: 1.2, make: (c, o) => { for (let i = 0; i < 10; i++) tone(c, o, i * 0.05, 1500 + ((i * 733) % 2500), { d: 0.4, level: 0.08 }); } },
  { id: 'bubble', name: 'Bubbles', tags: ['effects', 'water'], seconds: 1, make: (c, o) => { for (let i = 0; i < 6; i++) tone(c, o, i * 0.13, 300 + i * 70, { to: 900 + i * 90, glide: 0.06, d: 0.08, level: 0.2 }); } },
  { id: 'splash', name: 'Splash', tags: ['effects', 'water'], seconds: 0.9, make: (c, o) => hiss(c, o, 0, { type: 'highpass', f: 900, q: 0.5, a: 0.01, d: 0.75, level: 0.45, seed: 11 }) },
  { id: 'tada', name: 'Ta-da!', tags: ['music', 'effects'], seconds: 1.5, make: (c, o) => { tone(c, o, 0, mtof(67), { type: 'sawtooth', d: 0.15, level: 0.12, cutoff: 3000 }); [60, 64, 67, 72].forEach((m) => tone(c, o, 0.18, mtof(m), { type: 'sawtooth', d: 1.2, level: 0.08, cutoff: 3000 })); } },
  { id: 'chime', name: 'Chime', tags: ['music', 'effects'], seconds: 1.6, make: (c, o) => { [72, 76, 79, 84].forEach((m, i) => tone(c, o, i * 0.09, mtof(m), { d: 1.1, level: 0.16 })); } },
  { id: 'knock', name: 'Knock Knock', tags: ['effects'], seconds: 0.8, make: (c, o) => { for (const t of [0, 0.22]) { tone(c, o, t, 160, { to: 90, glide: 0.05, d: 0.09, level: 0.5 }); hiss(c, o, t, { f: 900, q: 2, d: 0.04, level: 0.3 }); } } },
  { id: 'footsteps', name: 'Footsteps', tags: ['effects'], seconds: 1.6, make: (c, o) => { for (let i = 0; i < 4; i++) hiss(c, o, i * 0.4, { type: 'lowpass', f: 600, q: 1, d: 0.1, level: 0.5, seed: 13 + i }); } },
  { id: 'rain', name: 'Rain', tags: ['nature'], seconds: 3, make: (c, o) => hiss(c, o, 0, { type: 'highpass', f: 2500, q: 0.3, a: 0.5, d: 2.4, level: 0.25, seed: 17 }) },
  { id: 'wind', name: 'Wind', tags: ['nature'], seconds: 3, make: (c, o) => hiss(c, o, 0, { f: 400, to: 900, q: 2, a: 1, d: 1.9, level: 0.35, seed: 19 }) },
  { id: 'waves', name: 'Ocean Waves', tags: ['nature', 'water'], seconds: 4, make: (c, o) => { hiss(c, o, 0, { type: 'lowpass', f: 400, to: 1600, q: 0.5, a: 1.6, d: 2.2, level: 0.4, seed: 23 }); } },
  { id: 'birds', name: 'Birds', tags: ['nature', 'animals'], seconds: 2, make: (c, o) => { [[0, 2400], [0.3, 2900], [0.45, 2600], [1.1, 3100], [1.3, 2500]].forEach(([t, f]) => tone(c, o, t, f, { to: f * 1.35, glide: 0.08, d: 0.12, level: 0.12 })); } },
  { id: 'frog', name: 'Croak', tags: ['animals'], seconds: 0.6, make: (c, o) => { for (let i = 0; i < 3; i++) tone(c, o, i * 0.12, 120, { type: 'sawtooth', d: 0.09, level: 0.25, cutoff: 700 }); } },
  { id: 'chirp', name: 'Chirp', tags: ['animals'], seconds: 0.5, make: (c, o) => { tone(c, o, 0, 3000, { to: 4200, glide: 0.05, d: 0.07, level: 0.15 }); tone(c, o, 0.15, 3200, { to: 4400, glide: 0.05, d: 0.07, level: 0.15 }); } },
  // --- drums ---
  { id: 'kick', name: 'Kick Drum', tags: ['drums', 'music'], seconds: 0.5, make: (c, o) => tone(c, o, 0, 150, { to: 45, glide: 0.12, d: 0.35, level: 0.8 }) },
  { id: 'snare', name: 'Snare Drum', tags: ['drums', 'music'], seconds: 0.35, make: (c, o) => { hiss(c, o, 0, { type: 'highpass', f: 1500, q: 0.7, d: 0.18, level: 0.5 }); tone(c, o, 0, 220, { to: 160, glide: 0.05, d: 0.1, level: 0.3 }); } },
  { id: 'hihat', name: 'Hi-hat', tags: ['drums', 'music'], seconds: 0.15, make: (c, o) => hiss(c, o, 0, { type: 'highpass', f: 7000, q: 0.5, d: 0.05, level: 0.35 }) },
  { id: 'clap', name: 'Clap', tags: ['drums', 'music'], seconds: 0.3, make: (c, o) => { for (const t of [0, 0.012, 0.024]) hiss(c, o, t, { f: 1400, q: 1.2, d: 0.06, level: 0.4, seed: 29 }); } },
  { id: 'cymbal', name: 'Cymbal', tags: ['drums', 'music'], seconds: 1.8, make: (c, o) => hiss(c, o, 0, { type: 'highpass', f: 5000, q: 0.4, a: 0.003, d: 1.6, level: 0.3, seed: 31 }) },
  { id: 'drum-beat', name: 'Drum Beat', tags: ['drums', 'music'], seconds: 2, make: (c, o) => { for (let b = 0; b < 8; b++) { const t = b * 0.25; hiss(c, o, t, { type: 'highpass', f: 7000, q: 0.5, d: 0.04, level: 0.2 }); if (b % 4 === 0) tone(c, o, t, 150, { to: 45, glide: 0.12, d: 0.3, level: 0.8 }); if (b % 4 === 2) hiss(c, o, t, { type: 'highpass', f: 1500, q: 0.7, d: 0.16, level: 0.45 }); } } },
];

// The Studio's tunes, rendered short.
export const TUNES = [
  { id: 'tune-upbeat', name: 'Upbeat Tune', style: 'upbeat' },
  { id: 'tune-playful', name: 'Playful Tune', style: 'playful' },
  { id: 'tune-wonder', name: 'Wonder Tune', style: 'wonder' },
  { id: 'tune-chill', name: 'Chill Tune', style: 'chill' },
];

const cache = new Map();

export async function renderLibrarySound(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const tune = TUNES.find((t) => t.id === id);
    if (tune) {
      const { renderSoundtrack } = await import('../../../src/studio/StudioAudio.js');
      return renderSoundtrack({ duration: 9, endAt: 9, music: tune.style, ambience: [], cues: [], levels: { music: 1, ambience: 0, sfx: 0 }, seed: 7 });
    }
    const spec = SOUNDS.find((s) => s.id === id);
    if (!spec) throw new Error(`No library sound "${id}"`);
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: Math.ceil(spec.seconds * RATE), sampleRate: RATE });
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(ctx.destination);
    spec.make(ctx, out);
    return ctx.startRendering();
  })();
  cache.set(id, p);
  return p;
}

export const ALL_LIBRARY_SOUNDS = [...SOUNDS.map((s) => ({ id: s.id, name: s.name, tags: s.tags })), ...TUNES.map((t) => ({ id: t.id, name: t.name, tags: ['music'] }))];
