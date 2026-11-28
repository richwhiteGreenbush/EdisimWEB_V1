// Export a video: runs the project from the green flag on a VIRTUAL clock, one frame at a time, and
// encodes every frame into an MP4, the Social Media Studio's method (plan, section 4).
//
// Because the clock is virtual, a slow computer makes a slower export, never a juddery video, and the
// same project gives the same video every time. The runtime already ticks at 30 frames a second, so
// one runtime step is one video frame.
//
// SOUND IS MIXED AFTERWARDS. The audio engine is switched to recording, so every sound and note the
// program starts is written down with its virtual time; once the picture is done that log is mixed
// offline and encoded as the second track. The main app's Mp4Muxer takes audio after video, which
// the Studio's exporter already relies on.
//
// THE STUDENT'S PROJECT IS PUT BACK AFTERWARDS. Running a project moves its sprites, as running it on
// screen does; exporting must not, so every sprite's place, look and variables are saved first and
// restored at the end.
import { Mp4Muxer } from '../../../src/studio/Mp4Muxer.js';
import { mixLog } from '../audio/AudioEngine.js';
import { FRAME_RATE } from '../runtime/Runtime.js';
import { STAGE_H, STAGE_W } from '../runtime/geometry.js';
import { el, modal, toast } from '../ui/dialogs.js';
import { safeFileName, spritesOf, stageOf } from '../project/Project.js';

const SAMPLE_RATE = 48000;
const SHAPES = {
  stage: { label: 'Stage shape (4:3)', w: 960, h: 720 },
  wide: { label: 'Wide (16:9), for YouTube and slides', w: 1280, h: 720 },
  tall: { label: 'Tall (9:16), for phones', w: 720, h: 1280 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function openExportDialog(app) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    toast('This browser cannot make videos. Try the latest Chrome or Edge.', { kind: 'error', ms: 6000 });
    return;
  }
  modal('Export a video', (body, close) => {
    body.innerHTML = `
      <div class="ex-form">
        <p class="ex-note">Your project runs from the green flag, and everything on the stage, including speech bubbles, captions and sounds, goes into the video.</p>
        <label>Length <select data-k="seconds">${[5, 10, 15, 20, 30, 45, 60].map((s) => `<option value="${s}"${s === 15 ? ' selected' : ''}>${s} seconds</option>`).join('')}</select></label>
        <label>Shape <select data-k="shape">${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <p class="ex-note ex-ask" hidden>This project asks questions. Nobody can type an answer while a video is made, so each question is answered with nothing after three seconds.</p>
        <div class="ex-progress" hidden><div></div></div>
        <div class="modal-buttons"><button type="button" class="btn">Cancel</button><button type="button" class="btn btn-primary">Make the video</button></div>
      </div>`;
    const [cancel, go] = body.querySelectorAll('.modal-buttons button');
    const bar = body.querySelector('.ex-progress');
    const asks = app.project.targets.some((t) => JSON.stringify(t.scripts).includes('sensing_askandwait'));
    body.querySelector('.ex-ask').hidden = !asks;
    let running = false;
    cancel.addEventListener('click', () => { if (running) app.cancelExport = true; else close(null); });
    go.addEventListener('click', async () => {
      running = true;
      go.disabled = true;
      bar.hidden = false;
      const seconds = Number(body.querySelector('[data-k="seconds"]').value);
      const shape = SHAPES[body.querySelector('[data-k="shape"]').value];
      try {
        const result = await exportVideo(app, { seconds, shape, onProgress: (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; } });
        if (!result) { close(null); return; }
        const a = el('a', { href: result.url, download: safeFileName(app.project.title).replace(/\.edusim-stages\.json$/, '.mp4') });
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast(`Your video is ready: ${(result.size / 1e6).toFixed(1)} MB.`);
        close(true);
      } catch (err) {
        console.error(err);
        toast(`The video could not be made: ${err.message}`, { kind: 'error', ms: 6000 });
        close(null);
      }
    });
  });
}

function snapshot(app) {
  const targets = app.project.targets.map((t) => ({
    t, x: t.x, y: t.y, direction: t.direction, size: t.size, visible: t.visible, currentCostume: t.currentCostume,
    volume: t.volume, rotationStyle: t.rotationStyle, draggable: t.draggable, variables: JSON.stringify(t.variables),
  }));
  const order = [...app.runtime.drawOrder].filter((t) => !t.isClone);
  const monitors = JSON.stringify(app.project.monitors);
  return () => {
    for (const s of targets) {
      Object.assign(s.t, { x: s.x, y: s.y, direction: s.direction, size: s.size, visible: s.visible, currentCostume: s.currentCostume, volume: s.volume, rotationStyle: s.rotationStyle, draggable: s.draggable });
      s.t.variables = JSON.parse(s.variables);
    }
    app.runtime.drawOrder = order;
    app.project.monitors = JSON.parse(monitors);
  };
}

export async function exportVideo(app, { seconds, shape, onProgress = () => {} }) {
  const { w, h } = shape;
  const mux = new Mp4Muxer({ video: { width: w, height: h }, audio: { sampleRate: SAMPLE_RATE, channels: 2, bitrate: 160000 } });
  let encodeError = null;
  const venc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => { encodeError = e; } });
  venc.configure({
    codec: 'avc1.640028', width: w, height: h, bitrate: Math.round(w * h * 6), bitrateMode: 'variable',
    framerate: FRAME_RATE, latencyMode: 'quality', avc: { format: 'avc' },
  });

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  // The stage is fitted inside the frame; the rest is a soft band with the project's title.
  const k = Math.min(w / STAGE_W, h / STAGE_H);
  const sw = Math.round(STAGE_W * k);
  const sh = Math.round(STAGE_H * k);
  const sx = Math.round((w - sw) / 2);
  const sy = Math.round((h - sh) / 2);
  const restore = snapshot(app);
  const rt = app.runtime;
  app.exporting = true;
  app.cancelExport = false;
  app.virtualTime = 0;
  app.renderer.setSize(sw, sh, 1);
  app.renderer.penClear();
  app.audio.startRecording(() => app.virtualTime);
  const askStarted = new Map();
  try {
    rt.greenFlag();
    const frames = Math.ceil(seconds * FRAME_RATE);
    for (let f = 0; f < frames; f++) {
      if (app.cancelExport) return null;
      rt.step();
      // Questions nobody can answer get an empty answer after three seconds.
      const asking = rt.asks[0];
      if (asking) {
        if (!askStarted.has(asking)) askStarted.set(asking, app.virtualTime);
        if (app.virtualTime - askStarted.get(asking) > 3) rt.answerQuestion('');
      }
      app.draw();
      ctx.fillStyle = '#e9f1fc';
      ctx.fillRect(0, 0, w, h);
      app.renderer.compositeTo(ctx, sx, sy, sw, sh);
      if (sy > 60) {
        ctx.fillStyle = '#3b4256';
        ctx.font = `700 ${Math.round(w / 22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(app.project.title, w / 2, sy / 2 + w / 60, w - 40);
        ctx.font = `600 ${Math.round(w / 40)}px system-ui, sans-serif`;
        ctx.fillStyle = '#6c7590';
        ctx.fillText('Made with Edusim Stages', w / 2, sy + sh + (h - sy - sh) / 2, w - 40);
      }
      const frame = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / FRAME_RATE), duration: Math.round(1e6 / FRAME_RATE) });
      venc.encode(frame, { keyFrame: f % (FRAME_RATE * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await sleep(1);
      if (encodeError) throw encodeError;
      app.virtualTime += 1 / FRAME_RATE;
      if (f % 10 === 0) { onProgress((f / frames) * 0.9); await sleep(0); }
    }
    await venc.flush();
    if (encodeError) throw encodeError;
    const log = app.audio.stopRecording();
    if (log.some((e) => e.kind !== 'stop')) {
      const mix = await mixLog(log, seconds, SAMPLE_RATE);
      await encodeAudio(mix, seconds, mux);
    }
    onProgress(1);
    const { blob } = mux.finalize();
    return { blob, url: URL.createObjectURL(blob), size: blob.size };
  } finally {
    app.audio.stopRecording();
    rt.stopAll();
    restore();
    app.exporting = false;
    app.last = performance.now();
    app.renderer.penClear();
    app.resize();
    try { venc.close(); } catch { /* already closed */ }
  }
}

async function encodeAudio(buffer, seconds, mux) {
  if (typeof AudioEncoder === 'undefined') return;
  const support = await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000 }).catch(() => null);
  if (!support?.supported) return;
  let error = null;
  const enc = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: (e) => { error = e; } });
  enc.configure({ codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 160000, aac: { format: 'aac' } });
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const total = Math.min(buffer.length, Math.round(seconds * SAMPLE_RATE));
  for (let at = 0; at < total; at += 4800) {
    const n = Math.min(4800, total - at);
    const data = new Float32Array(n * 2);
    data.set(left.subarray(at, at + n), 0);
    data.set(right.subarray(at, at + n), n);
    enc.encode(new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((at * 1e6) / SAMPLE_RATE), data }));
    if (enc.encodeQueueSize > 20) await sleep(1);
  }
  await enc.flush();
  enc.close();
  if (error) throw error;
}

export { spritesOf, stageOf };
