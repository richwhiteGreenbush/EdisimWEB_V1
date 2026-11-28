// The backdrop library: Edusim's own worlds, scenes put together from the CC0 cartoon tiles, and
// plain painted ones. Each is drawn into a 960 x 720 canvas when chosen (twice the stage, so it stays
// sharp) and stored in the project as a JPEG, since a backdrop has no transparent parts.
//
// The world pictures are screenshots of Edusim's own preset worlds, cropped to the stage's 4:3. They
// are the mashup in one picture: a game made in Stages can be set on the Moon or on Dinosaur Island.
//
// Ids are PERSISTED, so only ever add.
import { BACKDROP_TILES, CARTOON_SPRITES } from './cartoons.js';

const W = 960;
const H = 720;

const WORLDS = [
  ['park', 'The Park'], ['moon', 'The Moon'], ['mars', 'On Mars'], ['dinosaur', 'Dinosaur Island'],
  ['sea', 'Under the Sea'], ['egypt', 'Ancient Egypt'], ['volcano', 'Volcanoes'], ['wonderland', 'Wonderland'],
  ['chalk', 'Chalk Drawings'], ['butterfly', 'Butterfly Garden'], ['neighborhood', 'The Neighborhood'],
  ['museum', 'The Museum'], ['library', 'The Library'], ['solar', 'Solar System'], ['voyage', 'Inside the Body'],
  ['robots', 'Robot Challenge'], ['midway', "Newton's Midway"], ['atomhall', 'Atom Hall'],
  ['smallchange', 'Small Change'], ['standonearth', 'Stand on the Earth'],
];

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function canvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return [c, c.getContext('2d')];
}

function sky(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// A tile repeated along the bottom of the backdrop. Kenney's scenery tiles are opaque, with plain
// white sky across their top 40%; `crop` cuts that off so the painted sky shows above the hills,
// rather than a white band across the middle of every backdrop.
async function strip(ctx, url, height, bottom = 0, crop = 0) {
  const img = await loadImg(url);
  const sy = crop ? firstInkRow(img) : 0;
  const sh = img.height - sy;
  const k = height / sh;
  const w = img.width * k;
  for (let x = 0; x < W; x += w) ctx.drawImage(img, 0, sy, img.width, sh, x, H - bottom - height, w + 1, height);
}

// The first row of a tile that is not plain white: where its own sky ends. Measured rather than
// guessed, because the trees tile's treetops start higher than the hills tile's hills.
function firstInkRow(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (d[i] < 240 || d[i + 1] < 240 || d[i + 2] < 240) return Math.max(0, y - 2);
    }
  }
  return 0;
}

async function clouds(ctx, seed = 1) {
  const files = [0, 1, 2, 3].map((i) => CARTOON_SPRITES.find((s) => s.id === 'scenery-cloud')?.costumes[i]?.file).filter(Boolean);
  let s = seed;
  for (let i = 0; i < 5; i++) {
    s = (s * 9301 + 49297) % 233280;
    const x = (i / 5) * W + (s / 233280) * 120 - 40;
    s = (s * 9301 + 49297) % 233280;
    const y = 40 + (s / 233280) * 150;
    const img = await loadImg(files[i % files.length]);
    const k = 0.9 + (i % 3) * 0.25;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(img, x, y, img.width * k, img.height * k);
    ctx.globalAlpha = 1;
  }
}

const sceneryFile = (id, i = 0) => CARTOON_SPRITES.find((s) => s.id === id)?.costumes[i]?.file;

async function place(ctx, file, x, baseY, scale = 1) {
  if (!file) return;
  const img = await loadImg(file);
  ctx.drawImage(img, x, baseY - img.height * scale, img.width * scale, img.height * scale);
}

const TILE_SCENES = [
  { id: 'hills', name: 'Green Hills', tile: 'color_hills', sky: ['#4fb6ef', '#a8dcf5'] },
  { id: 'trees', name: 'Forest', tile: 'color_trees', sky: ['#55b9ec', '#ade0f5'] },
  { id: 'desert', name: 'Desert', tile: 'color_desert', sky: ['#ffbe55', '#ffe3a8'] },
  { id: 'mushrooms', name: 'Mushroom Land', tile: 'color_mushrooms', sky: ['#9a84f5', '#d8cdfd'] },
  { id: 'hills-soft', name: 'Misty Hills', tile: 'fade_hills', sky: ['#79c4e8', '#c9ebf7'] },
  { id: 'trees-soft', name: 'Misty Forest', tile: 'fade_trees', sky: ['#7bc3d8', '#cbe9f1'] },
  { id: 'desert-soft', name: 'Hazy Desert', tile: 'fade_desert', sky: ['#f2be6a', '#fde4b4'] },
];

export const BACKDROPS = [
  { id: 'blank', name: 'Blank', tags: ['plain'], async draw(ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); } },
  ...WORLDS.map(([id, name]) => ({
    id: `world-${id}`, name, tags: ['edusim'], url: `library/worlds/${id}.jpg`,
    async draw(ctx) {
      const img = await loadImg(this.url);
      ctx.drawImage(img, 0, 0, W, H);
    },
  })),
  ...TILE_SCENES.map((s) => ({
    id: `scene-${s.id}`, name: s.name, tags: ['outdoors'],
    async draw(ctx) {
      sky(ctx, s.sky[0], s.sky[1]);
      await clouds(ctx, s.id.length);
      await strip(ctx, BACKDROP_TILES[s.tile], 400, 0, 0.38);
    },
  })),
  {
    id: 'scene-town', name: 'Town', tags: ['outdoors'],
    async draw(ctx) {
      sky(ctx, '#55b9ef', '#acdef6');
      await clouds(ctx, 3);
      await strip(ctx, BACKDROP_TILES.fade_hills, 330, 0, 0.38);
      const ground = H - 70;
      await place(ctx, sceneryFile('scenery-house', 0), 40, ground, 1.3);
      await place(ctx, sceneryFile('scenery-tree', 0), 330, ground, 1.3);
      await place(ctx, sceneryFile('scenery-house', 3), 470, ground, 1.25);
      await place(ctx, sceneryFile('scenery-tree', 2), 760, ground, 1.3);
      ctx.fillStyle = '#8fce5a';
      ctx.fillRect(0, ground, W, H - ground);
      ctx.fillStyle = '#7fbd4c';
      ctx.fillRect(0, ground, W, 8);
    },
  },
  {
    id: 'scene-castle', name: 'Castle', tags: ['outdoors'],
    async draw(ctx) {
      sky(ctx, '#7aaefc', '#cfe1fd');
      await clouds(ctx, 5);
      await strip(ctx, BACKDROP_TILES.fade_trees, 330, 0, 0.38);
      const ground = H - 60;
      await place(ctx, sceneryFile('scenery-castle', 2), 210, ground, 1.5);
      await place(ctx, sceneryFile('scenery-castle', 0), 360, ground, 1.5);
      await place(ctx, sceneryFile('scenery-castle', 2), 640, ground, 1.5);
      ctx.fillStyle = '#7fc35a';
      ctx.fillRect(0, ground, W, H - ground);
    },
  },
  {
    id: 'scene-pyramids', name: 'Pyramids', tags: ['outdoors'],
    async draw(ctx) {
      sky(ctx, '#ffcf7a', '#fff1d2');
      await place(ctx, sceneryFile('scenery-sun-moon', 0), 760, 230, 1.2);
      await strip(ctx, BACKDROP_TILES.fade_desert, 320, 0, 0.38);
      const ground = H - 90;
      await place(ctx, sceneryFile('scenery-pyramid', 0), 120, ground, 1.8);
      await place(ctx, sceneryFile('scenery-pyramid', 0), 480, ground, 1.3);
      ctx.fillStyle = '#e9c27a';
      ctx.fillRect(0, ground, W, H - ground);
    },
  },
  ...[['space_black', 'Deep Space'], ['space_blue', 'Blue Space'], ['space_darkPurple', 'Purple Space'], ['space_purple', 'Nebula']].map(([key, name]) => ({
    id: `space-${key.replace('space_', '')}`, name, tags: ['space'],
    async draw(ctx) {
      const img = await loadImg(BACKDROP_TILES[key]);
      const s = 2;
      for (let y = 0; y < H; y += img.height * s) for (let x = 0; x < W; x += img.width * s) ctx.drawImage(img, x, y, img.width * s, img.height * s);
    },
  })),
  {
    id: 'night', name: 'Starry Night', tags: ['space', 'plain'],
    async draw(ctx) {
      sky(ctx, '#0b1033', '#2a3170');
      let s = 7;
      for (let i = 0; i < 260; i++) {
        s = (s * 9301 + 49297) % 233280;
        const x = (s / 233280) * W;
        s = (s * 9301 + 49297) % 233280;
        const y = (s / 233280) * H * 0.85;
        s = (s * 9301 + 49297) % 233280;
        const r = 0.6 + (s / 233280) * 1.8;
        ctx.fillStyle = `rgba(255,255,255,${0.5 + r / 4})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#10142a';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H - 60 - 30 * Math.sin(x / 90) - 18 * Math.sin(x / 37));
      ctx.lineTo(W, H);
      ctx.fill();
    },
  },
  { id: 'sunset', name: 'Sunset', tags: ['plain', 'outdoors'], async draw(ctx) { sky(ctx, '#ff7a59', '#ffd36e'); ctx.fillStyle = '#3c2a4d'; ctx.fillRect(0, H - 120, W, 120); } },
  { id: 'underwater', name: 'Underwater', tags: ['water', 'plain'], async draw(ctx) {
    sky(ctx, '#1d8fd6', '#0a3a6b');
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(120 + i * 150, 0); ctx.lineTo(60 + i * 150, H); ctx.lineTo(110 + i * 150, H); ctx.lineTo(160 + i * 150, 0); ctx.fill(); }
    ctx.fillStyle = '#d9c38d';
    ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 30) ctx.lineTo(x, H - 50 - 12 * Math.sin(x / 70)); ctx.lineTo(W, H); ctx.fill();
  } },
  { id: 'grid', name: 'Graph Paper', tags: ['plain', 'maths'], async draw(ctx) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    for (let x = 0; x <= W; x += 40) { ctx.fillStyle = x === W / 2 ? '#7a8599' : (x % 200 === 80 ? '#c9d2e3' : '#e6ebf3'); ctx.fillRect(x - (x === W / 2 ? 1.5 : 0.5), 0, x === W / 2 ? 3 : 1, H); }
    for (let y = 0; y <= H; y += 40) { ctx.fillStyle = y === H / 2 ? '#7a8599' : '#e6ebf3'; ctx.fillRect(0, y - (y === H / 2 ? 1.5 : 0.5), W, y === H / 2 ? 3 : 1); }
    ctx.fillStyle = '#7a8599'; ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText('x: 240', W - 90, H / 2 - 10); ctx.fillText('x: -240', 8, H / 2 - 10); ctx.fillText('y: 180', W / 2 + 8, 26); ctx.fillText('y: -180', W / 2 + 8, H - 10);
  } },
  { id: 'xy-grid', name: 'XY Grid', tags: ['plain', 'maths'], async draw(ctx) {
    ctx.fillStyle = '#fbfdff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#dfe7f2'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 20) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = '#4c97ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.fillStyle = '#3373cc'; ctx.font = '600 18px system-ui, sans-serif';
    for (let v = -200; v <= 200; v += 100) { if (v) ctx.fillText(String(v), W / 2 + v * 2 - 14, H / 2 + 24); }
    for (let v = -100; v <= 100; v += 100) { if (v) ctx.fillText(String(v), W / 2 + 8, H / 2 - v * 2 + 6); }
  } },
  ...[['#ffffff', 'White'], ['#fff7d6', 'Cream'], ['#dff3ff', 'Sky Blue'], ['#e5f8df', 'Mint'], ['#ffe3ec', 'Pink'], ['#1e2233', 'Dark']].map(([c, name]) => ({
    id: `colour-${name.toLowerCase().replace(/\s+/g, '-')}`, name, tags: ['plain'], async draw(ctx) { ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); },
  })),
];

export const BACKDROP_TAGS = [['all', 'All'], ['edusim', 'Edusim Worlds'], ['outdoors', 'Outdoors'], ['space', 'Space'], ['water', 'Water'], ['plain', 'Plain'], ['maths', 'Maths']];

export async function drawBackdrop(entry) {
  const [c, ctx] = canvas();
  await entry.draw(ctx);
  return c;
}
