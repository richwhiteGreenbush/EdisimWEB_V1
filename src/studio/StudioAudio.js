// The Social Media Studio's soundtrack: music, ambience and sound effects, all synthesised
// in the browser and rendered OFFLINE into one AudioBuffer before a single frame is drawn.
//
// Offline, rather than played live and recorded, for three reasons that each cost a day if
// learned the other way round:
//
//   * THE VIDEO IS RENDERED FRAME BY FRAME, NOT IN REAL TIME. A live audio graph runs on the
//     wall clock, the export does not, and the two drift apart the moment a world takes a
//     second to build. A buffer is just samples; the export encodes it beside the frames
//     and they cannot disagree.
//   * A LIVE AudioContext DOES NOT SURVIVE suspend()/resume() INTO A RECORDER. Measured in
//     Chrome 156: the MediaStreamDestination track stopped producing samples 0.4s after the
//     resume, which is how a soundtrack would vanish at the first world change.
//   * IT IS DETERMINISTIC. Every random choice goes through a seeded generator, so the same
//     plan gives the same soundtrack, and the three formats of one video share one mix.
//
// NOTHING HERE IS A RECORDING. Every note is an oscillator and every bird is a swept sine,
// which is the whole licensing story: there is no music in this file that anybody else owns.
// A teacher's or a marketer's own track can be dropped in instead (`upload`), and is mixed
// by exactly the same envelope.

export const SAMPLE_RATE = 48000;

export const MUSIC_STYLES = [
  { id: 'upbeat', label: 'Bright Pop', bpm: 118, hint: 'Four-on-the-floor, plucky and positive' },
  { id: 'playful', label: 'Playful Marimba', bpm: 124, hint: 'Light, bouncy, made for kids' },
  { id: 'wonder', label: 'Cinematic Wonder', bpm: 92, hint: 'Slow pads and bells — awe, not hype' },
  { id: 'chill', label: 'Lo-fi Study', bpm: 84, hint: 'Laid-back keys and soft drums' },
  { id: 'none', label: 'No music', bpm: 120, hint: 'Ambience and sound effects only' },
];

export const AMBIENCES = [
  { id: 'auto', label: 'Match each world' },
  { id: 'meadow', label: 'Meadow — wind and birdsong' },
  { id: 'forest', label: 'Jungle — dense birds and insects' },
  { id: 'night', label: 'Night — crickets' },
  { id: 'space', label: 'Space — low drone and radio beeps' },
  { id: 'underwater', label: 'Underwater — hum and bubbles' },
  { id: 'city', label: 'City — traffic and distant horns' },
  { id: 'wind', label: 'Wind — open and gusty' },
  { id: 'indoor', label: 'Indoors — quiet room tone' },
  { id: 'body', label: 'Heartbeat' },
  { id: 'none', label: 'No ambience' },
];

// World theme -> what it should sound like. Themes not named here fall back on their own
// sky: a theme with stars on is a night world, everything else is outdoors in daylight.
const THEME_AMBIENCE = {
  default: 'meadow', park: 'meadow', museum: 'meadow', library: 'indoor', moon: 'space',
  mars: 'wind', voyage: 'body', newyork: 'city', sea: 'underwater', dinosaur: 'forest',
  egypt: 'wind', solar: 'space', watercycle: 'meadow', pompeii: 'wind', davinci: 'indoor',
  ellis: 'city', capitol: 'city', reef: 'underwater', delta: 'meadow', colosseum: 'wind',
  machupicchu: 'wind', tajmahal: 'meadow', whimsy: 'meadow', station: 'space', london: 'city',
  warren: 'meadow', cologne: 'city', cell: 'body', twister: 'wind', bugs: 'forest',
  redsquare: 'wind', constellations: 'night', observatory: 'night', seattle: 'city',
  robots: 'meadow', greenbush: 'meadow', jsbasics: 'meadow', volcano: 'wind', chalk: 'meadow',
  wonderland: 'forest', neighborhood: 'meadow', turkle: 'meadow', butterfly: 'meadow',
  sunflower: 'meadow',
};

export function ambienceForTheme(theme, themeDef) {
  if (THEME_AMBIENCE[theme]) return THEME_AMBIENCE[theme];
  return themeDef?.stars ? 'night' : 'meadow';
}

export function styleById(id) {
  return MUSIC_STYLES.find((s) => s.id === id) || MUSIC_STYLES[0];
}

// --- small pieces -----------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

function noiseBuffer(ctx, seconds, kind, rand) {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = buffer.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else if (kind === 'pink') {
      // Paul Kellet's economy filter: three poles, close enough to -3dB/octave for wind.
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    } else {
      d[i] = white;
    }
  }
  return buffer;
}

function impulse(ctx, seconds, decay, rand) {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) d[i] = (rand() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

// One audio graph per render. Holds the buses and the shared noise so each instrument is a
// few lines rather than a page.
class Graph {
  constructor(ctx, seed) {
    this.ctx = ctx;
    this.rand = rng(seed);
    this.white = noiseBuffer(ctx, 2, 'white', this.rand);
    this.pink = noiseBuffer(ctx, 4, 'pink', this.rand);
    this.brown = noiseBuffer(ctx, 4, 'brown', this.rand);

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 2.6, 3, this.rand);
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
  }

  bus(level, send = 0) {
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(this.master);
    if (send > 0) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    return g;
  }

  // A one-shot noise burst through a filter, with an attack/decay envelope.
  noise(out, t, { type = 'bandpass', freq = 1000, q = 1, attack = 0.002, decay = 0.1, level = 0.3, buffer, pan = 0, freqTo = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.white;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (freqTo) filter.frequency.exponentialRampToValueAtTime(freqTo, t + attack + decay);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let node = src.connect(filter).connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(out);
    src.start(t, this.rand() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  // A pitched tone: oscillator(s) through an optional lowpass, exponential decay.
  tone(out, t, freq, { type = 'sine', attack = 0.005, decay = 0.4, level = 0.2, detune = 0, cutoff = null, cutoffTo = null, freqTo = null, glide = 0.05, pan = 0, partials = null } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    let head = g;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(cutoff, t);
      if (cutoffTo) f.frequency.exponentialRampToValueAtTime(cutoffTo, t + attack + decay * 0.6);
      f.Q.value = 0.7;
      f.connect(g);
      head = f;
    }
    let tail = g;
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      tail = p;
    }
    tail.connect(out);
    const end = t + attack + decay + 0.05;
    const voices = partials || [[1, 1]];
    for (const [ratio, amp] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq * ratio, t);
      if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo * ratio, t + glide);
      o.detune.value = detune;
      if (amp === 1) {
        o.connect(head);
      } else {
        const pg = ctx.createGain();
        pg.gain.value = amp;
        o.connect(pg).connect(head);
      }
      o.start(t);
      o.stop(end);
    }
  }
}

// --- instruments ------------------------------------------------------------------------

const inst = {
  kick(G, out, t, v = 1) {
    G.tone(out, t, 150, { freqTo: 46, glide: 0.11, decay: 0.32, level: 0.85 * v });
    G.noise(out, t, { type: 'highpass', freq: 2500, decay: 0.012, level: 0.12 * v });
  },
  clap(G, out, t, v = 1) {
    for (let i = 0; i < 3; i++) G.noise(out, t + i * 0.011, { freq: 1500, q: 1.1, decay: i === 2 ? 0.16 : 0.02, level: 0.42 * v });
  },
  snare(G, out, t, v = 1) {
    G.noise(out, t, { freq: 1900, q: 0.8, decay: 0.15, level: 0.32 * v });
    G.tone(out, t, 210, { freqTo: 160, glide: 0.05, decay: 0.09, level: 0.18 * v });
  },
  hat(G, out, t, v = 1, open = false) {
    G.noise(out, t, { type: 'highpass', freq: 7600, decay: open ? 0.2 : 0.035, level: 0.13 * v, pan: 0.18 });
  },
  shaker(G, out, t, v = 1) {
    G.noise(out, t, { freq: 6200, q: 1.8, attack: 0.012, decay: 0.05, level: 0.11 * v, pan: -0.2 });
  },
  snap(G, out, t, v = 1) {
    G.noise(out, t, { freq: 2600, q: 3, decay: 0.05, level: 0.32 * v, pan: 0.1 });
  },
  crash(G, out, t, v = 1) {
    G.noise(out, t, { type: 'highpass', freq: 5000, decay: 1.8, level: 0.16 * v });
  },
  crackle(G, out, t) {
    G.noise(out, t, { type: 'highpass', freq: 3000, decay: 0.004, level: 0.05 + G.rand() * 0.06, pan: G.rand() - 0.5 });
  },
  bass(G, out, t, midi, dur, v = 1) {
    const f = mtof(midi);
    G.tone(out, t, f, { type: 'triangle', decay: Math.max(0.12, dur), level: 0.34 * v, cutoff: 700 });
    G.tone(out, t, f, { type: 'sine', decay: Math.max(0.12, dur), level: 0.26 * v });
  },
  pizz(G, out, t, midi, v = 1) {
    G.tone(out, t, mtof(midi), { type: 'triangle', decay: 0.28, level: 0.36 * v, cutoff: 900, cutoffTo: 300 });
  },
  pluck(G, out, t, midi, v = 1, pan = 0) {
    G.tone(out, t, mtof(midi), { type: 'sawtooth', decay: 0.3, level: 0.07 * v, cutoff: 3400, cutoffTo: 500, pan });
    G.tone(out, t, mtof(midi), { type: 'square', decay: 0.22, level: 0.035 * v, detune: 7, cutoff: 2400, cutoffTo: 400, pan });
  },
  marimba(G, out, t, midi, v = 1, pan = 0) {
    G.tone(out, t, mtof(midi), { decay: 0.55, level: 0.2 * v, pan, partials: [[1, 1], [3.93, 0.18], [9.2, 0.05]] });
  },
  bell(G, out, t, midi, v = 1, pan = 0) {
    G.tone(out, t, mtof(midi), { decay: 1.6, level: 0.09 * v, pan, partials: [[1, 1], [2.76, 0.35], [5.4, 0.12]] });
  },
  keys(G, out, t, midi, dur, v = 1, pan = 0) {
    // An electric piano: fundamental plus a soft octave, slow-ish decay.
    G.tone(out, t, mtof(midi), { decay: Math.max(0.6, dur), level: 0.09 * v, pan, partials: [[1, 1], [2, 0.22], [3, 0.05]], attack: 0.008 });
  },
  pad(G, out, t, midis, dur, v = 1) {
    const ctx = G.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1100;
    const g = ctx.createGain();
    const attack = Math.min(0.6, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 * v, t + attack);
    g.gain.setValueAtTime(0.05 * v, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.8);
    f.connect(g).connect(out);
    for (const m of midis) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.9);
      }
    }
  },
  boom(G, out, t, v = 1) {
    G.tone(out, t, 70, { freqTo: 38, glide: 0.5, decay: 1.4, level: 0.45 * v });
  },
  riser(G, out, t, dur, v = 1) {
    G.noise(out, t, { type: 'bandpass', freq: 400, freqTo: 6000, q: 1.2, attack: dur * 0.95, decay: 0.08, level: 0.16 * v });
  },
};

// --- music ------------------------------------------------------------------------------

// Chords as MIDI note lists plus a bass root, one per bar, looped. Written out rather than
// derived from a key and a Roman numeral: these are four short songs, not a theory engine,
// and the voicings are the part that makes each one sound like what its name says.
const SONGS = {
  upbeat: {
    chords: [[60, 64, 67, 72], [59, 62, 67, 71], [57, 60, 64, 69], [57, 60, 65, 69]],
    bass: [36, 43, 45, 41],
  },
  playful: {
    chords: [[55, 59, 62], [55, 59, 64], [55, 60, 64], [54, 57, 62]],
    bass: [43, 40, 36, 38],
    scale: [67, 69, 71, 74, 76, 79, 81, 83, 86],
  },
  wonder: {
    chords: [[50, 57, 62, 64, 66], [47, 54, 59, 61, 62], [43, 50, 55, 59, 61], [45, 52, 57, 59, 64]],
    bass: [38, 35, 31, 33],
  },
  chill: {
    chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]],
    bass: [41, 40, 38, 36],
    scale: [72, 74, 76, 79, 81, 84],
  },
};

function renderMusic(G, out, style, { duration, endAt }) {
  if (style.id === 'none') return;
  const song = SONGS[style.id];
  const beat = 60 / style.bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const bars = Math.ceil(endAt / bar);
  const R = G.rand;

  // A two-bar melodic motif, generated once and repeated with a little variation every
  // pass -- a hook a listener can recognise the second time round, which is what makes a
  // generated tune sound written rather than random.
  const motif = [];
  if (song.scale) {
    let idx = 3;
    for (let s = 0; s < 32; s++) {
      const onBeat = s % 4 === 0;
      if (R() < (onBeat ? 0.72 : 0.28)) {
        idx = Math.max(0, Math.min(song.scale.length - 1, idx + Math.round((R() - 0.5) * 3.2)));
        motif.push([s, song.scale[idx]]);
      }
    }
  }

  for (let b = 0; b < bars; b++) {
    const t0 = b * bar;
    if (t0 >= endAt - 0.01) break;
    const chord = song.chords[b % song.chords.length];
    const root = song.bass[b % song.bass.length];
    const intro = b === 0 && bars > 4;
    const barEnd = Math.min(t0 + bar, endAt);
    const inBar = (s) => t0 + s * step < barEnd - 0.005;
    const fill = b % 4 === 3;

    if (style.id === 'upbeat') {
      inst.pad(G, out, t0, chord, Math.min(bar, endAt - t0), 0.85);
      for (let s = 0; s < 16; s++) {
        if (!inBar(s)) break;
        const t = t0 + s * step;
        const arp = chord[[0, 2, 1, 3, 2, 1, 3, 2][s % 8] % chord.length] + (s >= 8 ? 12 : 0);
        inst.pluck(G, out, t, arp, s % 4 === 0 ? 1 : 0.7, s % 2 ? 0.25 : -0.25);
        if (intro) continue;
        if (s % 4 === 0) inst.kick(G, out, t);
        if (s === 4 || s === 12) inst.clap(G, out, t);
        if (fill && s >= 13) inst.clap(G, out, t, 0.55);
        if (s % 2 === 0) inst.hat(G, out, t + (s % 4 === 2 ? 0 : 0.004), s % 4 === 2 ? 1 : 0.55, s % 4 === 2 && s === 14);
        if ([0, 3, 6, 8, 11, 14].includes(s)) inst.bass(G, out, t, root + (s === 6 || s === 14 ? 12 : 0), step * 1.6);
      }
      if (b % 4 === 0 && !intro) inst.crash(G, out, t0, 0.6);
    } else if (style.id === 'playful') {
      for (let s = 0; s < 16; s++) {
        if (!inBar(s)) break;
        const t = t0 + s * step;
        if (s % 2 === 0) inst.shaker(G, out, t, s % 4 === 0 ? 1 : 0.6);
        if (intro) continue;
        if (s === 0 || s === 8) inst.kick(G, out, t, 0.6);
        if (s === 4 || s === 12) inst.snap(G, out, t);
        if (s === 0) inst.pizz(G, out, t, root);
        if (s === 6) inst.pizz(G, out, t, root + 7, 0.8);
        if (s === 8) inst.pizz(G, out, t, root + 12, 0.9);
        if (s === 12) inst.pizz(G, out, t, root + 7, 0.8);
      }
      if (!intro) {
        const half = (b % 2) * 16;
        for (const [s, m] of motif) {
          if (s < half || s >= half + 16) continue;
          const t = t0 + (s - half) * step;
          if (t >= barEnd - 0.005) continue;
          const vary = b % 4 >= 2 && R() < 0.25 ? 2 : 0;
          inst.marimba(G, out, t, m + vary, 0.95, (R() - 0.5) * 0.5);
        }
      }
      for (const [i, m] of chord.entries()) inst.marimba(G, out, t0 + i * 0.02, m, 0.5);
    } else if (style.id === 'wonder') {
      inst.pad(G, out, t0, chord, Math.min(bar, endAt - t0), 1.2);
      inst.bass(G, out, t0, root, bar * 0.9, 0.7);
      if (b % 2 === 0) inst.boom(G, out, t0, 0.55);
      const top = chord.map((m) => m + 12);
      for (let s = 0; s < 8; s++) {
        const t = t0 + s * beat / 2;
        if (t >= barEnd - 0.005) break;
        if (intro && s < 4) continue;
        inst.bell(G, out, t, top[[0, 1, 2, 3, 4, 3, 2, 1][s] % top.length], s === 0 ? 1 : 0.7, s % 2 ? 0.35 : -0.35);
      }
    } else if (style.id === 'chill') {
      const swing = beat * 0.11;
      inst.keys(G, out, t0, chord[0], bar * 0.8, 1);
      for (const m of chord.slice(1)) inst.keys(G, out, t0 + 0.012, m, bar * 0.8, 0.8);
      if (inBar(7)) for (const m of chord) inst.keys(G, out, t0 + 7 * step, m, beat, 0.5);
      if (!intro) {
        inst.bass(G, out, t0, root, beat * 1.6, 0.9);
        if (inBar(10)) inst.bass(G, out, t0 + 10 * step, root + 7, beat, 0.7);
        inst.kick(G, out, t0, 0.7);
        if (inBar(10)) inst.kick(G, out, t0 + 10 * step, 0.55);
        if (inBar(4)) inst.snare(G, out, t0 + 4 * step, 0.7);
        if (inBar(12)) inst.snare(G, out, t0 + 12 * step, 0.7);
        for (let s = 0; s < 16; s += 2) {
          if (!inBar(s)) break;
          inst.hat(G, out, t0 + s * step + (s % 4 === 2 ? swing : 0), s % 4 === 2 ? 0.8 : 0.5);
        }
        for (let s = 2; s < 16; s += 4) {
          if (inBar(s) && R() < 0.3) inst.keys(G, out, t0 + s * step + swing, song.scale[Math.floor(R() * song.scale.length)], beat, 0.55, 0.3);
        }
      }
      // Vinyl crackle: the one sound that says "lo-fi" before a note has been played.
      for (let i = 0; i < 9; i++) inst.crackle(G, out, t0 + R() * bar);
    }
  }

  // THE BUTTON. A track that just stops when the video does reads as cut off; one that
  // lands on its home chord as the logo arrives reads as an ending. The final hit sits on
  // the end card's first frame and rings out to the last.
  const tail = Math.max(1.2, duration - endAt);
  const home = song.chords[0];
  const homeBass = song.bass[0];
  if (style.id === 'upbeat') {
    inst.riser(G, out, Math.max(0, endAt - bar / 2), bar / 2, 0.8);
    inst.kick(G, out, endAt, 1.1);
    inst.crash(G, out, endAt, 1.2);
    inst.pad(G, out, endAt, home, tail * 0.6, 1.2);
    for (const [i, m] of home.entries()) inst.pluck(G, out, endAt + i * 0.03, m + 12, 1);
    inst.bass(G, out, endAt, homeBass, tail * 0.7, 1);
  } else if (style.id === 'playful') {
    inst.kick(G, out, endAt, 0.8);
    for (const [i, m] of [...home, home[0] + 12].entries()) inst.marimba(G, out, endAt + i * 0.07, m + 12, 1);
    inst.pizz(G, out, endAt, homeBass);
    inst.crash(G, out, endAt, 0.5);
  } else if (style.id === 'wonder') {
    inst.riser(G, out, Math.max(0, endAt - bar), bar, 0.7);
    inst.boom(G, out, endAt, 1);
    inst.pad(G, out, endAt, home, tail * 0.7, 1.5);
    for (const [i, m] of home.entries()) inst.bell(G, out, endAt + i * 0.09, m + 12, 1);
  } else if (style.id === 'chill') {
    for (const m of home) inst.keys(G, out, endAt, m, tail, 1);
    inst.bass(G, out, endAt, homeBass, tail * 0.6, 0.9);
  }
}

// --- ambience -------------------------------------------------------------------------

// A bed that lives from t0 to t1 with crossfades at both ends.
function bed(G, out, t0, t1, maxFade = 0.6) {
  // Never more than a third of the segment, or a short shot's fade-out is scheduled before
  // its own fade-in has finished.
  const fade = Math.min(maxFade, (t1 - t0) / 3);
  const g = G.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(1, t0 + fade);
  g.gain.setValueAtTime(1, Math.max(t0 + fade, t1 - fade));
  g.gain.exponentialRampToValueAtTime(0.0001, t1);
  g.connect(out);
  return g;
}

function loopNoise(G, out, t0, t1, buffer, { type = 'lowpass', freq = 500, q = 0.7, level = 0.2, gusts = 0, gustRate = 1.4 } = {}) {
  const ctx = G.ctx;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = level;
  // Gusts: a slow random walk on level and filter, scheduled up front.
  if (gusts > 0) {
    for (let t = t0; t < t1; t += gustRate * (0.6 + G.rand() * 0.8)) {
      const k = 1 - gusts + G.rand() * gusts * 2;
      g.gain.setTargetAtTime(level * Math.max(0.15, k), t, gustRate * 0.4);
      f.frequency.setTargetAtTime(freq * (0.7 + G.rand() * 0.7), t, gustRate * 0.5);
    }
  }
  src.connect(f).connect(g).connect(out);
  src.start(t0, G.rand() * 3);
  src.stop(t1 + 0.1);
}

function birdCall(G, out, t, { base = 2800, notes = 3, level = 0.05 } = {}) {
  const pan = (G.rand() - 0.5) * 1.6;
  let at = t;
  const shape = G.rand();
  for (let i = 0; i < notes; i++) {
    const f0 = base * (0.85 + G.rand() * 0.4);
    const f1 = shape < 0.5 ? f0 * 1.45 : f0 * 0.7;
    const d = 0.05 + G.rand() * 0.07;
    G.tone(out, at, f0, { freqTo: f1, glide: d, decay: d, attack: 0.006, level, pan });
    at += d + 0.03 + G.rand() * 0.05;
  }
}

function renderAmbience(G, out, kind, t0, t1) {
  if (kind === 'none' || t1 - t0 < 0.2) return;
  const b = bed(G, out, t0, t1);
  const R = G.rand;
  switch (kind) {
    case 'meadow':
      loopNoise(G, b, t0, t1, G.pink, { type: 'bandpass', freq: 650, q: 0.5, level: 0.22, gusts: 0.5 });
      for (let t = t0 + R(); t < t1 - 0.5; t += 0.9 + R() * 2) birdCall(G, b, t, { notes: 2 + Math.floor(R() * 4) });
      break;
    case 'forest':
      loopNoise(G, b, t0, t1, G.pink, { type: 'bandpass', freq: 500, q: 0.5, level: 0.14, gusts: 0.4 });
      // A cicada: a high buzz, amplitude-modulated, swelling and fading.
      for (let t = t0 + R() * 2; t < t1 - 2; t += 4 + R() * 4) {
        const len = 1.5 + R() * 2;
        G.noise(b, t, { freq: 5200, q: 6, attack: len * 0.4, decay: len * 0.6, level: 0.05, pan: (R() - 0.5) });
      }
      for (let t = t0 + R() * 0.5; t < t1 - 0.4; t += 0.35 + R() * 1.1) {
        birdCall(G, b, t, { base: 1800 + R() * 2400, notes: 1 + Math.floor(R() * 4), level: 0.04 });
      }
      break;
    case 'night':
      loopNoise(G, b, t0, t1, G.pink, { type: 'lowpass', freq: 380, level: 0.12, gusts: 0.4, gustRate: 2.2 });
      for (const [pitch, pan, rate] of [[4400, -0.5, 0.72], [4720, 0.55, 0.9]]) {
        for (let t = t0 + R() * rate; t < t1 - 0.3; t += rate * (0.9 + R() * 0.2)) {
          for (let p = 0; p < 3; p++) G.tone(b, t + p * 0.05, pitch, { decay: 0.03, attack: 0.004, level: 0.035, pan });
        }
      }
      break;
    case 'space': {
      const ctx = G.ctx;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = ctx.createGain();
      g.gain.value = 0.07;
      f.connect(g).connect(b);
      for (const [hz, type] of [[55, 'sine'], [82.6, 'sine'], [110.3, 'sawtooth']]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz;
        o.connect(f);
        o.start(t0);
        o.stop(t1 + 0.1);
      }
      for (let t = t0; t < t1; t += 2) f.frequency.setTargetAtTime(260 + R() * 260, t, 1.2);
      loopNoise(G, b, t0, t1, G.white, { type: 'bandpass', freq: 5200, q: 3, level: 0.018, gusts: 0.6, gustRate: 2 });
      // The Quindar tone: the 2525Hz beep that ended every Apollo transmission. Once or
      // twice a shot, never more -- it is a seasoning, not a melody.
      for (let t = t0 + 1 + R() * 2; t < t1 - 0.5; t += 4 + R() * 4) {
        G.tone(b, t, 2525, { decay: 0.22, attack: 0.005, level: 0.025 });
      }
      break;
    }
    case 'underwater':
      loopNoise(G, b, t0, t1, G.brown, { type: 'lowpass', freq: 320, level: 0.55, gusts: 0.3, gustRate: 2.4 });
      for (let t = t0 + R(); t < t1 - 0.4; t += 0.6 + R() * 1.8) {
        const n = 2 + Math.floor(R() * 6);
        const pan = (R() - 0.5) * 1.4;
        for (let i = 0; i < n; i++) {
          const f0 = 380 + R() * 500;
          G.tone(b, t + i * (0.04 + R() * 0.07), f0, { freqTo: f0 * 2.6, glide: 0.06, decay: 0.07, attack: 0.004, level: 0.035, pan });
        }
      }
      break;
    case 'city':
      loopNoise(G, b, t0, t1, G.brown, { type: 'lowpass', freq: 650, level: 0.4, gusts: 0.35, gustRate: 2.5 });
      for (let t = t0 + R() * 2; t < t1 - 2; t += 3 + R() * 4) {
        G.noise(b, t, { freq: 300, freqTo: 900, q: 0.8, attack: 1.2, decay: 1.4, level: 0.12, buffer: G.pink, pan: R() > 0.5 ? 0.6 : -0.6 });
      }
      for (let t = t0 + 3 + R() * 4; t < t1 - 1; t += 7 + R() * 6) {
        G.tone(b, t, 349, { type: 'square', decay: 0.35, level: 0.018, cutoff: 900, partials: [[1, 1], [1.26, 0.8]] });
      }
      for (let t = t0 + R() * 2; t < t1 - 0.5; t += 2.2 + R() * 3) birdCall(G, b, t, { base: 3600, notes: 2, level: 0.02 });
      break;
    case 'wind':
      loopNoise(G, b, t0, t1, G.pink, { type: 'bandpass', freq: 520, q: 0.6, level: 0.42, gusts: 0.75, gustRate: 1.1 });
      loopNoise(G, b, t0, t1, G.brown, { type: 'lowpass', freq: 200, level: 0.2 });
      break;
    case 'indoor':
      loopNoise(G, b, t0, t1, G.brown, { type: 'lowpass', freq: 220, level: 0.16 });
      break;
    case 'body':
      loopNoise(G, b, t0, t1, G.brown, { type: 'lowpass', freq: 240, level: 0.3, gusts: 0.3, gustRate: 0.9 });
      for (let t = t0 + 0.2; t < t1 - 0.3; t += 0.92) {
        G.tone(b, t, 52, { freqTo: 40, glide: 0.08, decay: 0.16, level: 0.42 });
        G.tone(b, t + 0.26, 46, { freqTo: 36, glide: 0.08, decay: 0.14, level: 0.3 });
      }
      break;
    default:
      break;
  }
}

// --- sound effects ----------------------------------------------------------------------

const SFX = {
  pop(G, out, t, v = 1) {
    G.tone(out, t, 520, { freqTo: 1180, glide: 0.07, decay: 0.12, level: 0.32 * v });
    G.noise(out, t, { type: 'highpass', freq: 3000, decay: 0.02, level: 0.1 * v });
  },
  snap(G, out, t, v = 1) {
    G.noise(out, t, { freq: 3200, q: 2.5, decay: 0.03, level: 0.4 * v });
    G.tone(out, t, 880, { decay: 0.05, level: 0.08 * v });
  },
  tap(G, out, t, v = 1) {
    G.tone(out, t, 660, { decay: 0.08, level: 0.2 * v, partials: [[1, 1], [2, 0.4]] });
    G.noise(out, t, { freq: 2000, q: 2, decay: 0.02, level: 0.2 * v });
  },
  whoosh(G, out, t, v = 1) {
    G.noise(out, t, { freq: 350, freqTo: 3200, q: 0.9, attack: 0.22, decay: 0.32, level: 0.3 * v, buffer: G.pink });
  },
  stretch(G, out, t, v = 1) {
    G.tone(out, t, 260, { type: 'triangle', freqTo: 620, glide: 0.38, attack: 0.06, decay: 0.36, level: 0.14 * v, cutoff: 1800 });
  },
  place(G, out, t, v = 1) {
    G.tone(out, t, 150, { freqTo: 70, glide: 0.08, decay: 0.16, level: 0.45 * v });
    G.noise(out, t, { freq: 1800, q: 1.5, decay: 0.03, level: 0.16 * v });
  },
  sparkle(G, out, t, v = 1) {
    for (let i = 0; i < 9; i++) {
      G.tone(out, t + i * 0.045 + G.rand() * 0.02, 1800 + G.rand() * 2600, { decay: 0.35, level: 0.07 * v, pan: (G.rand() - 0.5) * 1.4, partials: [[1, 1], [2.76, 0.3]] });
    }
  },
  chime(G, out, t, v = 1) {
    for (const [i, m] of [72, 76, 79, 84].entries()) {
      G.tone(out, t + i * 0.08, mtof(m), { decay: 1.1, level: 0.12 * v, partials: [[1, 1], [2.76, 0.25]] });
    }
  },
  launch(G, out, t, v = 1) {
    G.noise(out, t, { type: 'lowpass', freq: 200, freqTo: 1400, q: 0.6, attack: 0.5, decay: 2.6, level: 0.5 * v, buffer: G.brown });
    G.noise(out, t + 0.1, { freq: 500, freqTo: 4000, q: 0.8, attack: 0.9, decay: 1.2, level: 0.16 * v, buffer: G.pink });
  },
  beep(G, out, t, v = 1) {
    G.tone(out, t, 988, { type: 'square', decay: 0.08, level: 0.05 * v, cutoff: 2600 });
    G.tone(out, t + 0.1, 1319, { type: 'square', decay: 0.1, level: 0.05 * v, cutoff: 2600 });
  },
  type(G, out, t, v = 1) {
    G.noise(out, t, { freq: 2600 + G.rand() * 1200, q: 3, decay: 0.012, level: 0.12 * v, pan: (G.rand() - 0.5) * 0.4 });
  },
  rise(G, out, t, v = 1) {
    inst.riser(G, out, t, 0.6, v);
  },
};

export const SFX_NAMES = Object.keys(SFX);

// --- the render ------------------------------------------------------------------------

// plan: {
//   duration, endAt,                         seconds; endAt is where the end card starts
//   music: 'upbeat' | ... | 'none' | 'upload', upload: AudioBuffer | null,
//   ambience: [{ t0, t1, kind }],
//   cues: [{ t, sfx, v? }],
//   levels: { music, ambience, sfx },        0..1
//   seed,
// }
export async function renderSoundtrack(plan) {
  const duration = Math.max(1, plan.duration);
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil((duration + 0.05) * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const G = new Graph(ctx, plan.seed ?? 1);
  const levels = { music: 0.7, ambience: 0.5, sfx: 0.8, ...plan.levels };
  const musicBus = G.bus(levels.music, 0.22);
  const ambBus = G.bus(levels.ambience * 0.9, 0.1);
  const sfxBus = G.bus(levels.sfx, 0.18);

  if (plan.music === 'upload' && plan.upload) {
    const src = ctx.createBufferSource();
    src.buffer = plan.upload;
    src.loop = plan.upload.duration < duration;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(1, 0.25);
    g.gain.setValueAtTime(1, Math.max(0.3, duration - 1.8));
    g.gain.exponentialRampToValueAtTime(0.0001, duration);
    src.connect(g).connect(musicBus);
    src.start(0, plan.uploadOffset || 0);
  } else if (plan.music && plan.music !== 'none') {
    const style = styleById(plan.music);
    // The groove fades out under the end card's tail rather than being chopped at the
    // last sample.
    const fade = ctx.createGain();
    fade.gain.setValueAtTime(1, Math.max(0, duration - 1.4));
    fade.gain.linearRampToValueAtTime(0.0001, duration);
    fade.connect(musicBus);
    renderMusic(G, fade, style, { duration, endAt: Math.min(duration, plan.endAt ?? duration) });
  }

  for (const seg of plan.ambience || []) {
    renderAmbience(G, ambBus, seg.kind, Math.max(0, seg.t0), Math.min(duration, seg.t1));
  }

  for (const cue of plan.cues || []) {
    const fn = SFX[cue.sfx];
    if (fn && cue.t >= 0 && cue.t < duration) fn(G, sfxBus, cue.t, cue.v ?? 1);
  }

  const buffer = await ctx.startRendering();

  // Peak-normalise to -1 dBFS. Every platform normalises loudness on its own, but a mix
  // that peaks at -12 because the ambience was quiet comes out thin before they do.
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const d = buffer.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak > 0.001) {
    const k = 0.89 / peak;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const d = buffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return buffer;
}

// Plays a rendered soundtrack live for the preview. The preview's clock IS this player's
// position while it is playing, so the picture and the sound cannot drift -- and when a
// world is being built the source is stopped and later restarted at the same offset,
// rather than the context being suspended (see the note at the top of this file).
export class SoundtrackPlayer {
  constructor() {
    this.ctx = null;
    this.source = null;
    this.startedAt = 0;
    this.offset = 0;
    this.playing = false;
    this.volume = 1;
  }

  ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

  play(buffer, offset = 0) {
    this.stop();
    if (!buffer) return;
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    src.start(0, Math.max(0, Math.min(offset, buffer.duration)));
    this.source = src;
    this.startedAt = ctx.currentTime - offset;
    this.offset = offset;
    this.playing = true;
  }

  // Seconds into the buffer, or null when the context is not actually running -- in which
  // case the caller keeps its own frame clock instead of freezing on a dead one.
  position() {
    if (!this.playing || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx.currentTime - this.startedAt;
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
    }
    this.source = null;
    this.playing = false;
  }

  async decode(arrayBuffer) {
    return this.ensureContext().decodeAudioData(arrayBuffer);
  }
}
