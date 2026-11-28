// Plays a project's sounds and notes.
//
// THERE IS NO MICROPHONE ANYWHERE IN EDUSIM STAGES (decision E): nothing here or elsewhere asks for
// one, so the app never asks a child for anything and privacy.html needs no new sentence. Sounds
// come from the generated library or from an uploaded file.
//
// It has two modes. LIVE plays through the speakers. RECORD (the video exporter) plays nothing and
// writes down every sound and note with the time it started, so the soundtrack can be mixed
// afterwards on the same virtual clock as the picture (plan, section 4).
import { audioContext, soundNow } from '../project/assets.js';

// Each instrument is a few oscillator partials and an envelope: enough to tell a flute from a bass,
// and nothing that needs a recording.
export const INSTRUMENTS = {
  piano: { partials: [[1, 1], [2, 0.4], [3, 0.15]], type: 'triangle', attack: 0.005, decay: 1.2, sustain: 0.0 },
  organ: { partials: [[1, 1], [2, 0.6], [4, 0.3]], type: 'sine', attack: 0.02, decay: 0.1, sustain: 0.8 },
  guitar: { partials: [[1, 1], [2, 0.5], [3, 0.3]], type: 'sawtooth', attack: 0.003, decay: 0.9, sustain: 0.0, cutoff: 2200 },
  flute: { partials: [[1, 1], [2, 0.12]], type: 'sine', attack: 0.06, decay: 0.2, sustain: 0.7 },
  marimba: { partials: [[1, 1], [4, 0.3]], type: 'sine', attack: 0.002, decay: 0.5, sustain: 0.0 },
  synth: { partials: [[1, 1]], type: 'square', attack: 0.01, decay: 0.3, sustain: 0.5, cutoff: 3000 },
  bass: { partials: [[0.5, 1], [1, 0.5]], type: 'sawtooth', attack: 0.01, decay: 0.4, sustain: 0.5, cutoff: 900 },
  bell: { partials: [[1, 1], [2.76, 0.4], [5.4, 0.2]], type: 'sine', attack: 0.002, decay: 2.2, sustain: 0.0 },
};

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// Schedules one note into any audio context (live or offline).
export function scheduleNote(ctx, out, when, midi, seconds, instrument, gain = 1) {
  const spec = INSTRUMENTS[instrument] || INSTRUMENTS.piano;
  const env = ctx.createGain();
  const level = 0.22 * gain;
  const end = when + Math.max(0.05, seconds);
  env.gain.setValueAtTime(0.0001, when);
  env.gain.exponentialRampToValueAtTime(level, when + spec.attack);
  const sustain = Math.max(0.0001, level * spec.sustain);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), when + spec.attack + spec.decay);
  env.gain.setValueAtTime(Math.max(0.0001, spec.sustain ? sustain : 0.0001), end);
  env.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
  let node = env;
  if (spec.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = spec.cutoff;
    env.connect(f);
    node = f;
  }
  node.connect(out);
  for (const [ratio, amp] of spec.partials) {
    const o = ctx.createOscillator();
    o.type = spec.type;
    o.frequency.value = mtof(midi) * ratio;
    const g = ctx.createGain();
    g.gain.value = amp / spec.partials.length;
    o.connect(g).connect(env);
    o.start(when);
    o.stop(end + 0.2);
  }
}

export class AudioEngine {
  constructor() {
    this.mode = 'live';
    this.log = [];
    this.playing = new Set();
    this.clock = () => 0;
    this.muted = false;
  }

  ctx() { return audioContext(); }

  // Browsers start an audio context suspended until somebody clicks; every click resumes it.
  unlock() {
    try { const c = this.ctx(); if (c.state === 'suspended') c.resume(); } catch { /* no audio */ }
  }

  startRecording(clock) {
    this.mode = 'record';
    this.clock = clock;
    this.log = [];
  }

  stopRecording() {
    const log = this.log;
    this.mode = 'live';
    this.log = [];
    return log;
  }

  // Plays a sound and returns its length in seconds, which "play sound until done" waits for.
  play(target, sound) {
    const buffer = soundNow(sound.assetId);
    const seconds = buffer?.duration ?? sound.duration ?? 0;
    const volume = (target.volume ?? 100) / 100;
    if (this.mode === 'record') {
      this.log.push({ t: this.clock(), kind: 'sound', assetId: sound.assetId, volume });
      return seconds;
    }
    if (!buffer || this.muted) return seconds;
    try {
      const ctx = this.ctx();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(ctx.destination);
      src.start();
      const entry = { src, target };
      this.playing.add(entry);
      src.onended = () => this.playing.delete(entry);
    } catch { /* audio unavailable: the program carries on silently */ }
    return seconds;
  }

  note(target, midi, seconds, instrument) {
    const volume = (target.volume ?? 100) / 100;
    if (this.mode === 'record') {
      this.log.push({ t: this.clock(), kind: 'note', midi, seconds, instrument, volume });
      return;
    }
    if (this.muted) return;
    try {
      const ctx = this.ctx();
      scheduleNote(ctx, ctx.destination, ctx.currentTime + 0.01, midi, seconds, instrument, volume);
    } catch { /* no audio */ }
  }

  stopAll() {
    if (this.mode === 'record') {
      this.log.push({ t: this.clock(), kind: 'stop' });
      return;
    }
    for (const { src } of this.playing) { try { src.stop(); } catch { /* already stopped */ } }
    this.playing.clear();
  }

  // Previewing a sound in the Sounds tab.
  preview(buffer) {
    this.unlock();
    this.stopAll();
    try {
      const ctx = this.ctx();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start();
      const entry = { src, target: null };
      this.playing.add(entry);
      src.onended = () => this.playing.delete(entry);
    } catch { /* no audio */ }
  }
}

// Mixes a recorded log into one buffer for the exported video, on the same clock as the frames.
export async function mixLog(log, duration, sampleRate = 48000) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, Math.ceil(duration * sampleRate)), sampleRate });
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const live = [];
  for (const e of log) {
    if (e.t >= duration) continue;
    if (e.kind === 'stop') {
      for (const src of live) { try { src.stop(e.t); } catch { /* fine */ } }
      live.length = 0;
    } else if (e.kind === 'sound') {
      const buffer = soundNow(e.assetId);
      if (!buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = e.volume;
      src.connect(g).connect(master);
      src.start(e.t);
      live.push(src);
    } else if (e.kind === 'note') {
      scheduleNote(ctx, master, e.t, e.midi, e.seconds, e.instrument, e.volume);
    }
  }
  return ctx.startRendering();
}
