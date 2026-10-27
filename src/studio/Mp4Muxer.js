// A small, plain MP4 writer for the Social Media Studio: one H.264 track, one AAC track,
// written as an ordinary PROGRESSIVE file with the index at the front ("faststart").
//
// It exists because the obvious tool is the wrong one. Chrome's MediaRecorder will record
// MP4 now, but what it writes is FRAGMENTED -- an empty index followed by moof/mdat pairs,
// with a movie header that says the duration is zero -- and two things follow from that:
//
//   * Phone photo libraries and some upload screens read that zero literally. A clip that
//     shows as 0:00 in the picker is a clip nobody posts.
//   * Its AAC sample durations are derived from capture timestamps, and after a
//     pause()/resume() they come out compressed (measured: 81 frames of 1024 samples
//     written as 442 units each), so the audio plays back squeezed against the video.
//
// The studio does not record in real time at all, as it happens -- it renders frame by
// frame and encodes with WebCodecs -- so all this file has to do is lay the encoded
// samples out. Every sample is its own chunk and the two tracks are interleaved by time,
// which keeps the sample tables trivially simple (one stsc entry) at the cost of an stco
// entry per sample: about 18KB of index for a minute of video, which nobody will notice.

const MOVIE_TIMESCALE = 1000;
const VIDEO_TIMESCALE = 90000;

class ByteWriter {
  constructor() {
    this.parts = [];
    this.length = 0;
  }
  bytes(u8) {
    this.parts.push(u8);
    this.length += u8.length;
    return this;
  }
  u8(v) { return this.bytes(Uint8Array.of(v & 0xff)); }
  u16(v) { return this.bytes(Uint8Array.of((v >>> 8) & 0xff, v & 0xff)); }
  u24(v) { return this.bytes(Uint8Array.of((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)); }
  u32(v) {
    return this.bytes(Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));
  }
  i16(v) { return this.u16(v < 0 ? v + 0x10000 : v); }
  str(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return this.bytes(out);
  }
  zeros(n) { return this.bytes(new Uint8Array(n)); }
  concat() {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

function box(type, ...payloads) {
  const w = new ByteWriter();
  let size = 8;
  for (const p of payloads) size += p.length;
  w.u32(size).str(type);
  for (const p of payloads) w.bytes(p);
  return w.concat();
}

function fullBox(type, version, flags, ...payloads) {
  const head = new ByteWriter().u8(version).u24(flags).concat();
  return box(type, head, ...payloads);
}

function build(fn) {
  const w = new ByteWriter();
  fn(w);
  return w.concat();
}

// The identity matrix, as every tkhd/mvhd carries it.
function matrix(w) {
  for (const v of [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]) w.u32(v);
}

// stts: run-length of sample durations.
function stts(deltas) {
  const runs = [];
  for (const d of deltas) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++;
    else runs.push([1, d]);
  }
  return fullBox('stts', 0, 0, build((w) => {
    w.u32(runs.length);
    for (const [count, delta] of runs) w.u32(count).u32(delta);
  }));
}

// An MPEG-4 descriptor with its tag and a one-byte size. Every descriptor written here is
// well under 128 bytes, which is the only case the one-byte form covers.
function descriptor(tag, payload) {
  if (payload.length > 127) throw new Error('descriptor too large for the short form');
  return build((w) => w.u8(tag).u8(payload.length).bytes(payload));
}

// AAC-LC, 48 kHz, stereo, for when the encoder hands back no AudioSpecificConfig of its own:
// object type 2, frequency index 3, channel configuration 2.
function defaultAsc(sampleRate, channels) {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
  const idx = Math.max(0, rates.indexOf(sampleRate));
  const v = (2 << 11) | (idx << 7) | (channels << 3);
  return Uint8Array.of((v >>> 8) & 0xff, v & 0xff);
}

function esds(asc, bitrate) {
  const decoderSpecific = descriptor(0x05, asc);
  const decoderConfig = descriptor(0x04, build((w) => {
    w.u8(0x40);   // Audio ISO/IEC 14496-3
    w.u8(0x15);   // streamType 5 (audio) << 2 | reserved 1
    w.u24(0);     // bufferSizeDB
    w.u32(bitrate);
    w.u32(bitrate);
    w.bytes(decoderSpecific);
  }));
  const sl = descriptor(0x06, Uint8Array.of(0x02));
  const es = descriptor(0x03, build((w) => {
    w.u16(2);     // ES_ID
    w.u8(0);      // no stream dependence, no URL, no OCR
    w.bytes(decoderConfig);
    w.bytes(sl);
  }));
  return fullBox('esds', 0, 0, es);
}

function avc1Entry(width, height, avcC) {
  return box('avc1', build((w) => {
    w.zeros(6).u16(1);             // reserved, data_reference_index
    w.u16(0).u16(0).zeros(12);     // pre_defined, reserved, pre_defined[3]
    w.u16(width).u16(height);
    w.u32(0x00480000).u32(0x00480000); // 72 dpi
    w.u32(0).u16(1);               // reserved, frame_count
    const name = 'Edusim Studio';
    w.u8(name.length).str(name).zeros(31 - name.length);
    w.u16(0x0018).i16(-1);         // depth, pre_defined
  }), box('avcC', avcC), box('pasp', build((w) => w.u32(1).u32(1))));
}

function mp4aEntry(sampleRate, channels, asc, bitrate) {
  return box('mp4a', build((w) => {
    w.zeros(6).u16(1);
    w.zeros(8);                    // reserved[2]
    w.u16(channels).u16(16);       // channelcount, samplesize
    w.u16(0).u16(0);               // pre_defined, reserved
    w.u32(sampleRate * 65536);     // 16.16 -- 48000 << 16 overflows a signed shift, hence *
  }), esds(asc, bitrate));
}

function trak({ id, handler, timescale, durationMedia, durationMovie, width = 0, height = 0, entry, samples, offsets }) {
  const isVideo = handler === 'vide';
  const tkhd = fullBox('tkhd', 0, 3, build((w) => {
    w.u32(0).u32(0).u32(id).u32(0).u32(durationMovie);
    w.zeros(8);
    w.i16(0).i16(isVideo ? 0 : 1);  // layer, alternate_group
    w.u16(isVideo ? 0 : 0x0100).u16(0);
    matrix(w);
    w.u32(width * 65536).u32(height * 65536);
  }));
  const mdhd = fullBox('mdhd', 0, 0, build((w) => {
    w.u32(0).u32(0).u32(timescale).u32(durationMedia);
    w.u16(0x55c4).u16(0);          // language 'und'
  }));
  const hdlr = fullBox('hdlr', 0, 0, build((w) => {
    const name = isVideo ? 'VideoHandler' : 'SoundHandler';
    w.u32(0).str(handler).zeros(12).str(name).u8(0);
  }));
  const mediaHeader = isVideo
    ? fullBox('vmhd', 0, 1, build((w) => w.u16(0).u16(0).u16(0).u16(0)))
    : fullBox('smhd', 0, 0, build((w) => w.i16(0).u16(0)));
  const dinf = box('dinf', fullBox('dref', 0, 0, build((w) => w.u32(1)), fullBox('url ', 0, 1)));

  const stsd = fullBox('stsd', 0, 0, build((w) => w.u32(1)), entry);
  const sttsBox = stts(samples.map((s) => s.delta));
  const stsc = fullBox('stsc', 0, 0, build((w) => w.u32(1).u32(1).u32(1).u32(1)));
  const stsz = fullBox('stsz', 0, 0, build((w) => {
    w.u32(0).u32(samples.length);
    for (const s of samples) w.u32(s.data.length);
  }));
  const stco = fullBox('stco', 0, 0, build((w) => {
    w.u32(offsets.length);
    for (const o of offsets) w.u32(o);
  }));
  const tables = [stsd, sttsBox];
  if (isVideo) {
    const sync = [];
    samples.forEach((s, i) => { if (s.key) sync.push(i + 1); });
    // Every sample a keyframe is legal and needs no stss; only write it when it says something.
    if (sync.length !== samples.length) {
      tables.push(fullBox('stss', 0, 0, build((w) => {
        w.u32(sync.length);
        for (const n of sync) w.u32(n);
      })));
    }
  }
  tables.push(stsc, stsz, stco);
  const stbl = box('stbl', ...tables);
  const minf = box('minf', mediaHeader, dinf, stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  return box('trak', tkhd, mdia);
}

export class Mp4Muxer {
  // video: { width, height }   audio: { sampleRate, channels, bitrate } | null
  constructor({ video, audio = null }) {
    this.video = { ...video, samples: [], avcC: null };
    this.audio = audio ? { ...audio, samples: [], asc: null } : null;
  }

  // Straight from a VideoEncoder's output callback.
  addVideoChunk(chunk, meta) {
    const description = meta?.decoderConfig?.description;
    if (description && !this.video.avcC) this.video.avcC = toBytes(description);
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.video.samples.push({ data, ts: chunk.timestamp, dur: chunk.duration ?? 0, key: chunk.type === 'key' });
  }

  addAudioChunk(chunk, meta) {
    if (!this.audio) return;
    const description = meta?.decoderConfig?.description;
    if (description && !this.audio.asc) this.audio.asc = toBytes(description);
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.audio.samples.push({ data, ts: chunk.timestamp });
  }

  finalize() {
    const v = this.video;
    if (!v.samples.length) throw new Error('No video was encoded.');
    if (!v.avcC) throw new Error('The video encoder gave no avcC description -- was it configured with avc.format = "avc"?');

    // Video durations come from the gap to the next frame's timestamp, which is exact for
    // a frame-by-frame render; the last frame repeats its predecessor's duration.
    v.samples.sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < v.samples.length; i++) {
      const s = v.samples[i];
      const nextTs = v.samples[i + 1]?.ts;
      const us = nextTs != null ? nextTs - s.ts : (s.dur || (v.samples[i - 1] ? s.ts - v.samples[i - 1].ts : 33333));
      s.delta = Math.max(1, Math.round((us * VIDEO_TIMESCALE) / 1e6));
      s.time = s.ts / 1e6;
    }
    const videoMedia = v.samples.reduce((n, s) => n + s.delta, 0);

    const a = this.audio && this.audio.samples.length ? this.audio : null;
    let audioMedia = 0;
    if (a) {
      // An AAC-LC frame is 1024 samples by definition, so the duration is written as that
      // rather than derived from timestamps -- which is exactly what MediaRecorder gets
      // wrong after a pause, and costs nothing to get right here.
      a.samples.sort((x, y) => x.ts - y.ts);
      for (const s of a.samples) {
        s.delta = 1024;
        s.time = s.ts / 1e6;
      }
      audioMedia = a.samples.length * 1024;
      if (!a.asc) a.asc = defaultAsc(a.sampleRate, a.channels);
    }

    const videoMovie = Math.round((videoMedia / VIDEO_TIMESCALE) * MOVIE_TIMESCALE);
    const audioMovie = a ? Math.round((audioMedia / a.sampleRate) * MOVIE_TIMESCALE) : 0;
    const movieDuration = Math.max(videoMovie, audioMovie);

    // Interleave by presentation time. Each sample is its own chunk.
    const order = [
      ...v.samples.map((s) => ({ s, track: 'v' })),
      ...(a ? a.samples.map((s) => ({ s, track: 'a' })) : []),
    ].sort((x, y) => x.s.time - y.s.time || (x.track === 'v' ? -1 : 1));

    const ftyp = box('ftyp', build((w) => {
      w.str('isom').u32(0x200);
      for (const brand of ['isom', 'iso2', 'avc1', 'mp41']) w.str(brand);
    }));

    const moovFor = (vOffsets, aOffsets) => {
      const mvhd = fullBox('mvhd', 0, 0, build((w) => {
        w.u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(movieDuration);
        w.u32(0x00010000).u16(0x0100).zeros(10);
        matrix(w);
        w.zeros(24);
        w.u32(a ? 3 : 2);
      }));
      const traks = [trak({
        id: 1,
        handler: 'vide',
        timescale: VIDEO_TIMESCALE,
        durationMedia: videoMedia,
        durationMovie: videoMovie,
        width: v.width,
        height: v.height,
        entry: avc1Entry(v.width, v.height, v.avcC),
        samples: v.samples,
        offsets: vOffsets,
      })];
      if (a) {
        traks.push(trak({
          id: 2,
          handler: 'soun',
          timescale: a.sampleRate,
          durationMedia: audioMedia,
          durationMovie: audioMovie,
          entry: mp4aEntry(a.sampleRate, a.channels, a.asc, a.bitrate || 160000),
          samples: a.samples,
          offsets: aOffsets,
        }));
      }
      return box('moov', mvhd, ...traks);
    };

    // Build once with placeholder offsets to learn the index's size -- which does not
    // depend on the offset VALUES, only on how many there are -- then again for real.
    const zerosV = new Array(v.samples.length).fill(0);
    const zerosA = a ? new Array(a.samples.length).fill(0) : [];
    const moovSize = moovFor(zerosV, zerosA).length;
    const dataStart = ftyp.length + moovSize + 8;

    const vOffsets = [];
    const aOffsets = [];
    let at = dataStart;
    let mdatBytes = 0;
    for (const { s, track } of order) {
      (track === 'v' ? vOffsets : aOffsets).push(at);
      at += s.data.length;
      mdatBytes += s.data.length;
    }
    if (dataStart + mdatBytes > 0xffffffff) throw new Error('Video is too large for a 32-bit MP4 index.');
    const moov = moovFor(vOffsets, aOffsets);

    const parts = [ftyp, moov, build((w) => w.u32(mdatBytes + 8).str('mdat'))];
    for (const { s } of order) parts.push(s.data);
    return {
      blob: new Blob(parts, { type: 'video/mp4' }),
      duration: movieDuration / MOVIE_TIMESCALE,
    };
  }
}

function toBytes(source) {
  if (source instanceof Uint8Array) return source.slice();
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
  return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
}
