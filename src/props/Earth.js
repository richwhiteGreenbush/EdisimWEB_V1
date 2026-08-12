import { canvasTexture, seededRandom, randomIn } from '../PropKit.js';

// One shared, hand-plotted equirectangular Earth map, drawn to a canvas at runtime.
// Used by the library's floor globe and by the Earth hanging in the moon world's sky.
// Exported as a FUNCTION, never as a texture instance: PlacedRegistry disposes a
// removed object's maps, so two registry roots must never share one THREE.Texture.

// Coarse continent outlines as [longitude, latitude] rings. Deliberately low-detail --
// at globe scale (and at 22ft across in the lunar sky) this reads as Earth, and the
// whole map stays a few hundred numbers instead of a shipped image file.
const CONTINENTS = [
  // North America
  [[-168, 66], [-160, 71], [-140, 70], [-125, 70], [-110, 68], [-95, 73], [-85, 70], [-75, 68],
   [-60, 60], [-55, 52], [-65, 45], [-70, 42], [-75, 35], [-81, 25], [-97, 25], [-105, 20],
   [-115, 30], [-125, 40], [-130, 50], [-140, 60], [-150, 60], [-165, 55]],
  // Greenland
  [[-45, 60], [-20, 70], [-20, 82], [-45, 83], [-60, 80], [-55, 68]],
  // South America
  [[-81, 10], [-70, 12], [-60, 10], [-50, 0], [-35, -5], [-38, -15], [-48, -25], [-58, -35],
   [-65, -45], [-70, -55], [-75, -50], [-73, -40], [-71, -30], [-70, -18], [-78, -5]],
  // Africa
  [[-17, 15], [-5, 25], [10, 32], [20, 32], [32, 31], [35, 22], [43, 12], [51, 12], [42, -2],
   [40, -15], [35, -24], [25, -34], [18, -34], [12, -18], [9, -1], [3, 5], [-8, 5]],
  // Europe
  [[-10, 36], [0, 44], [3, 52], [8, 58], [15, 55], [25, 60], [30, 65], [40, 68], [45, 55],
   [40, 45], [28, 41], [20, 42], [10, 38], [0, 36]],
  // Asia
  [[40, 45], [50, 45], [60, 40], [70, 30], [75, 20], [80, 10], [92, 20], [98, 10], [105, 15],
   [110, 20], [120, 30], [125, 40], [130, 45], [140, 50], [145, 60], [160, 62], [170, 68],
   [179, 68], [179, 75], [140, 75], [100, 78], [75, 73], [60, 70], [45, 68], [40, 60]],
  // Australia
  [[113, -22], [123, -16], [130, -12], [142, -11], [147, -19], [153, -27], [150, -37],
   [140, -38], [130, -32], [118, -35]],
  // Madagascar
  [[43, -12], [50, -15], [50, -25], [45, -25], [43, -20]],
];

export function earthTexture(width = 1024) {
  const height = width / 2;

  return canvasTexture(width, height, (ctx, w, h) => {
    const px = (lon) => ((lon + 180) / 360) * w;
    const py = (lat) => ((90 - lat) / 180) * h;

    // Ocean, deepening toward the poles.
    const ocean = ctx.createLinearGradient(0, 0, 0, h);
    ocean.addColorStop(0, '#0e3f6e');
    ocean.addColorStop(0.5, '#1567a8');
    ocean.addColorStop(1, '#0e3f6e');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, w, h);

    // Land, then the desert/tundra climate bands painted THROUGH A CLIP PATH of the
    // same continent outlines.
    //
    // The tempting shortcut -- 'source-atop' over the whole canvas -- does not work
    // here: the ocean was already painted, so it counts as existing content and the
    // bands wash straight over it, turning the planet green and yellow from pole to
    // pole. Clipping is the only thing that confines them to land.
    const tracePath = () => {
      ctx.beginPath();
      for (const ring of CONTINENTS) {
        ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(px(lon), py(lat)) : ctx.moveTo(px(lon), py(lat))));
        ctx.closePath();
      }
    };

    tracePath();
    ctx.fillStyle = '#3f7a3d';
    ctx.fill();

    ctx.save();
    tracePath();
    ctx.clip();
    const bands = ctx.createLinearGradient(0, 0, 0, h);
    bands.addColorStop(0.0, '#e6eef2');
    bands.addColorStop(0.16, '#5e7f56');
    bands.addColorStop(0.3, '#2f6b33');
    bands.addColorStop(0.38, '#c6a765');
    bands.addColorStop(0.5, '#3f7a3d');
    bands.addColorStop(0.62, '#c6a765');
    bands.addColorStop(0.76, '#4e7f45');
    bands.addColorStop(1.0, '#e6eef2');
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = bands;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Polar ice.
    ctx.fillStyle = '#f2f7fa';
    ctx.fillRect(0, 0, w, py(72));
    ctx.fillRect(0, py(-63), w, h - py(-63));

    // Cloud swirls, so the planet does not read as a flat printed map. Kept sparse and
    // low-alpha: dense opaque ellipses cover the continents and the globe stops being
    // recognisable as Earth, which is the one thing it has to be.
    const rng = seededRandom(31415);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 90; i++) {
      const cx = randomIn(rng, 0, w);
      const cy = randomIn(rng, 0, h);
      const r = randomIn(rng, w * 0.008, w * 0.026);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * randomIn(rng, 1.8, 4.0), r * 0.4, randomIn(rng, -0.4, 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
