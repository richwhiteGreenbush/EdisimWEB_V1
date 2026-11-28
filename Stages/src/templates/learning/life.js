// Learning projects: life. Written with ./kit.js; see featured.js for worked examples.
// Ids are PERSISTED in links (?project=<id>), so they are only ever added.
import { emoji, label, circle, rect, paint } from './kit.js';

// --- shared painting ------------------------------------------------------------------------------

function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function blob(ctx, pts, fill, stroke = '#1e2a3a', lw = 5) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

function rng(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function text(ctx, s, x, y, px, fill = '#1e2a3a', align = 'center', weight = 700) {
  ctx.font = `${weight} ${px}px "Fredoka", "Nunito", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

function cloud(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const [dx, dy, r] of [[0, 0, 30], [32, -12, 34], [66, 0, 28], [34, 12, 30]]) {
    ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); ctx.fill();
  }
}

// =====================================================================================================
// 1. What Does Each Plant Part Do? (grades 3-5, Quiz)
// =====================================================================================================

function gardenBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, 400, ['#7cc8ff', '#d6f0ff']);
  ctx.fillRect(0, 0, w, 400);
  // The Sun, with rays.
  ctx.strokeStyle = '#ffcf3a'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(110 + Math.cos(a) * 62, 100 + Math.sin(a) * 62); ctx.lineTo(110 + Math.cos(a) * 88, 100 + Math.sin(a) * 88); ctx.stroke();
  }
  ctx.fillStyle = '#ffd94a'; ctx.beginPath(); ctx.arc(110, 100, 50, 0, Math.PI * 2); ctx.fill();
  cloud(ctx, 640, 80, 1.2); cloud(ctx, 300, 150, 0.8);
  // Soil, cut open so the roots show.
  ctx.fillStyle = grad(ctx, 0, 400, 0, 720, ['#9a6a3c', '#6e4524']);
  ctx.fillRect(0, 400, w, 320);
  const r = rng(11);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(60,35,15,0.35)' : 'rgba(200,160,110,0.35)';
    ctx.beginPath(); ctx.ellipse(r() * w, 430 + r() * 280, 4 + r() * 10, 3 + r() * 6, 0, 0, Math.PI * 2); ctx.fill();
  }
  // A worm, for fun.
  ctx.strokeStyle = '#e88a9a'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(740, 560); ctx.bezierCurveTo(770, 530, 800, 590, 830, 555); ctx.stroke();
  // Grass along the top of the soil.
  ctx.fillStyle = '#4fb24f'; ctx.fillRect(0, 392, w, 18);
  ctx.strokeStyle = '#3d9a3d'; ctx.lineWidth = 4;
  for (let x = 6; x < w; x += 14) { ctx.beginPath(); ctx.moveTo(x, 396); ctx.lineTo(x + 5, 380 - (x % 3) * 4); ctx.stroke(); }
  // A garden fence far off.
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#c9d6e0'; ctx.lineWidth = 2;
  for (let x = 600; x < w; x += 40) { ctx.fillRect(x, 300, 22, 92); ctx.strokeRect(x, 300, 22, 92); }
  ctx.fillRect(600, 320, 360, 12); ctx.fillRect(600, 360, 360, 12);
}

function rootsPainter() {
  return paint(300, 170, (ctx) => {
    ctx.strokeStyle = '#f0d9a8'; ctx.lineCap = 'round';
    const roots = [[150, 0, 150, 160, 13], [150, 10, 60, 130, 9], [150, 10, 240, 135, 9], [150, 30, 25, 70, 6], [150, 30, 275, 75, 6],
      [110, 70, 95, 150, 5], [190, 70, 210, 155, 5], [150, 90, 120, 165, 4], [150, 90, 180, 165, 4]];
    for (const [x0, y0, x1, y1, lw] of roots) {
      ctx.lineWidth = lw + 4; ctx.strokeStyle = '#7a5a2e';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + 12, (y0 + y1) / 2, x1, y1); ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = '#f0d9a8';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + 12, (y0 + y1) / 2, x1, y1); ctx.stroke();
    }
  });
}

function stemPainter() {
  return paint(40, 270, (ctx) => {
    ctx.fillStyle = grad(ctx, 0, 0, 40, 0, ['#3c9a3c', '#6fd46f', '#3c9a3c']);
    ctx.strokeStyle = '#1f5a1f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(8, 2, 24, 266, 10); ctx.fill(); ctx.stroke();
  });
}

function leavesPainter() {
  return paint(320, 150, (ctx) => {
    const leaf = (cx, cy, dir, rot) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot);
      ctx.fillStyle = grad(ctx, 0, -30, 0, 30, ['#5fd35f', '#2f9a3a']);
      ctx.strokeStyle = '#1f5a1f'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(dir * 60, -48, dir * 135, 0); ctx.quadraticCurveTo(dir * 60, 48, 0, 0);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#bff2a8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(4 * dir, 0); ctx.lineTo(dir * 125, 0); ctx.stroke();
      for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(dir * i * 26, 0); ctx.lineTo(dir * (i * 26 + 16), -16); ctx.moveTo(dir * i * 26, 0); ctx.lineTo(dir * (i * 26 + 16), 16); ctx.stroke();
      }
      ctx.restore();
    };
    leaf(150, 95, -1, 0.25);
    leaf(170, 50, 1, -0.25);
  });
}

function flowerPainter() {
  return paint(170, 170, (ctx) => {
    ctx.save(); ctx.translate(85, 85);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(Math.PI / 3);
      ctx.fillStyle = '#ff6fa8'; ctx.strokeStyle = '#a3245a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, -44, 24, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#b07a00';
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e09a00';
    for (let i = 0; i < 10; i++) { const a = i * 0.63; ctx.beginPath(); ctx.arc(Math.cos(a) * 13, Math.sin(a) * 13, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  });
}

function seedsPainter() {
  return paint(150, 120, (ctx) => {
    // One seed has sprouted: a root down, a shoot up with two seed leaves.
    ctx.strokeStyle = '#f0d9a8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(100, 78); ctx.quadraticCurveTo(108, 98, 98, 116); ctx.stroke();
    ctx.strokeStyle = '#3c9a3c'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(100, 72); ctx.quadraticCurveTo(96, 40, 104, 22); ctx.stroke();
    ctx.fillStyle = '#5fd35f'; ctx.strokeStyle = '#1f5a1f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(88, 18, 16, 8, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(120, 18, 16, 8, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const seed = (x, y, rot) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = '#4a3a2a'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(-4, 12); ctx.moveTo(4, -12); ctx.lineTo(4, 12); ctx.stroke();
      ctx.restore();
    };
    seed(30, 82, 0.6); seed(58, 92, -0.3); seed(100, 76, 1.4);
  });
}

const PLANT_PARTS = [
  ['Roots', 'ROOTS hold the plant in the ground and soak up water and minerals from the soil.'],
  ['Stem', 'The STEM holds the plant up. Tiny tubes inside it carry water up to the leaves, and food from the leaves to the rest of the plant.'],
  ['Leaves', 'LEAVES make the plant\'s food. They use sunlight, water and carbon dioxide from the air to make sugar, and give off oxygen. This is PHOTOSYNTHESIS.'],
  ['Flower', 'The FLOWER makes the seeds. Its bright colour and scent bring bees, which carry pollen from flower to flower.'],
  ['Seeds', 'SEEDS hold a tiny baby plant and a store of food. With water and warmth, a seed sprouts and grows into a new plant.'],
];

const PLANT_QUIZ = [
  ['Leaves', 'Click the part that makes food using sunlight.'],
  ['Roots', 'Click the part that soaks up water from the soil.'],
  ['Flower', 'Click the part that bees visit, which makes the seeds.'],
  ['Stem', 'Click the part that carries water up to the leaves.'],
  ['Seeds', 'Click the part that can grow into a whole new plant.'],
];

function plantPartScript(name, job) {
  return `
when flag clicked:
    set "seen" to 0
    clear graphic effects

when this sprite clicked:
    start sound "pop"
    repeat 2:
        change "brightness" effect by 25
        wait 0.08 seconds
    clear graphic effects
    if ((quiz) = 0) then:
        broadcast "label ${name}"
        if ((seen) = 0) then:
            set "seen" to 1
            change "found" by 1
        show caption "${job}"
    else:
        if ((answered) = 0) then:
            if ((want) = "${name}") then:
                change "score" by 1
                broadcast "right" and wait
            else:
                broadcast "wrong" and wait
            set "answered" to 1
`;
}

function plantLabelScript(name) {
  return `
when flag clicked:
    hide

when I receive "label ${name}":
    show
    set size to 60 %
    repeat 4:
        change size by 10
`;
}

const plantParts = {
  id: 'plant-parts', title: 'What Does Each Plant Part Do?', kind: 'Quiz', grades: [3, 5], subject: 'Life Science',
  blurb: 'Click the roots, stem, leaves, flower and seeds to learn each one\'s job, then help the bee with a quiz.',
  learn: 'The five main parts of a flowering plant and the job of each: roots take in water, the stem carries it, leaves make food by photosynthesis, flowers make seeds, and seeds grow into new plants.',
  backdrops: [{ name: 'Garden', paint: gardenBackdrop }],
  variables: { found: 0, score: 0, quiz: 0, answered: 0, want: '' },
  monitors: [['found', 'normal', 330, 8], ['score', 'normal', 400, 8]],
  sounds: ['tune-playful'],
  sprites: [
    { name: 'Roots', costumes: [['roots', rootsPainter()]], x: 0, y: -62, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Stem', costumes: [['stem', stemPainter()]], x: 0, y: 47, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Leaves', costumes: [['leaves', leavesPainter()]], x: 2, y: 30, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Flower', costumes: [['flower', flowerPainter()]], x: 0, y: 128, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Seeds', costumes: [['seeds', seedsPainter()]], x: 120, y: -24, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Drop', costumes: [['drop', emoji('💧', 26)]], x: 0, y: -90, visible: false, variables: { side: 1 } },
    { name: 'Roots label', costumes: [['tag', label('ROOTS', '#f0d9a8', '#1e2a3a', 24)]], x: -130, y: -70, visible: false },
    { name: 'Stem label', costumes: [['tag', label('STEM', '#8fe08a', '#1e2a3a', 24)]], x: 70, y: 98, visible: false },
    { name: 'Leaves label', costumes: [['tag', label('LEAVES', '#5fd35f', '#1e2a3a', 24)]], x: -150, y: 50, visible: false },
    { name: 'Flower label', costumes: [['tag', label('FLOWER', '#ff9cc6', '#1e2a3a', 24)]], x: -100, y: 140, visible: false },
    { name: 'Seeds label', costumes: [['tag', label('SEEDS', '#ffd23f', '#1e2a3a', 24)]], x: 175, y: 20, visible: false },
    { name: 'Bee', lib: 'creature-bee', use: ['a', 'b'], x: 190, y: 62, size: 70, rotationStyle: 'left-right', sounds: ['chime', 'hit', 'win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "found" to 0
    set "score" to 0
    set "quiz" to 0
    set "answered" to 0
    set "want" to ""
    show caption "Every part of a plant has a job. Click each part to find out what it does!"
    play sound "tune-playful" until done
`,
    ...Object.fromEntries(PLANT_PARTS.map(([name, job]) => [name, plantPartScript(name, job)])),
    ...Object.fromEntries(PLANT_PARTS.map(([name]) => [`${name} label`, plantLabelScript(name)])),
    Drop: `
when flag clicked:
    hide
    forever:
        create clone of "myself"
        wait 0.8 seconds

when I start as a clone:
    go to x: (pick random -55 to 55) y: -95
    set "side" to (pick random 0 to 1)
    show
    glide 1 secs to x: 0 y: -25
    glide 1.2 secs to x: 0 y: 35
    if ((side) = 1) then:
        glide 0.6 secs to x: 55 y: 50
    else:
        glide 0.6 secs to x: -55 y: 18
    repeat 8:
        change "ghost" effect by 12
    delete this clone
`,
    Bee: `
when flag clicked:
    go to x: 190 y: 62
    point in direction -90
    forever:
        next costume
        change y by 2
        wait 0.1 seconds
        next costume
        change y by -2
        wait 0.1 seconds

when flag clicked:
    say "Hi! I'm a bee. Click each part of the plant to learn its job!" for 5 seconds
    wait until ((found) = 5)
    say "You found all five parts! Now a quiz." for 3 seconds
    set "quiz" to 1
${PLANT_QUIZ.map(([part, q], i) => `    set "answered" to 0
    set "want" to "${part}"
    show caption "QUIZ ${i + 1} of 5: ${q}"
    wait until ((answered) = 1)`).join('\n')}
    show caption (join (join "Quiz done! You scored " (score)) " out of 5.")
    if ((score) = 5) then:
        start sound "win"
        say "Perfect! You are a plant expert!"
    else:
        say "Good try! Click the parts again to read their jobs."
        set "quiz" to 0

when I receive "right":
    start sound "chime"
    say "Yes! That's right." for 1 seconds

when I receive "wrong":
    start sound "hit"
    say (join "Not quite. The answer was the " (want)) for 2 seconds
`,
  },
  picture: [[110]],
  check: [{ frames: 160 }, { click: 'Roots' }, { click: 'Stem' }, { click: 'Leaves' }, { click: 'Flower' }, { click: 'Seeds' }, { frames: 110 },
    { click: 'Leaves' }, { frames: 45 }, { click: 'Roots' }, { frames: 45 }, { click: 'Flower' }, { frames: 45 }, { click: 'Stem' }, { frames: 45 }, { click: 'Seeds' }, { frames: 60 },
    { expect: { score: 5 } }],
};

// =====================================================================================================
// 2. From Frogspawn to Frog (grades 3-5, Story)
// =====================================================================================================

function pondBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, 260, ['#8fd3ff', '#e3f6ff']);
  ctx.fillRect(0, 0, w, 260);
  cloud(ctx, 120, 70, 1); cloud(ctx, 520, 50, 0.8);
  // Far bank with trees.
  ctx.fillStyle = '#6cbf5a';
  ctx.beginPath(); ctx.moveTo(0, 262); ctx.quadraticCurveTo(250, 200, 520, 240); ctx.quadraticCurveTo(760, 205, 960, 250); ctx.lineTo(960, 262); ctx.fill();
  for (const [x, r] of [[60, 40], [140, 30], [690, 46], [780, 34], [880, 42]]) {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 6, 210, 12, 40);
    ctx.fillStyle = '#3f9a4a'; ctx.beginPath(); ctx.arc(x, 200, r, 0, Math.PI * 2); ctx.fill();
  }
  // The pond: water in cross-section.
  ctx.fillStyle = grad(ctx, 0, 260, 0, 720, ['#4cb3d9', '#2a7fb0', '#1b5a85']);
  ctx.fillRect(0, 260, w, 460);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(0, 258, w, 6);
  // Light ripples.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
  const r = rng(5);
  for (let i = 0; i < 26; i++) { const x = r() * w; const y = 290 + r() * 300; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 20, y - 8, x + 40, y); ctx.stroke(); }
  // The pond floor, pebbles and weed.
  ctx.fillStyle = '#8a7a52';
  ctx.beginPath(); ctx.moveTo(0, 640); ctx.quadraticCurveTo(480, 600, 960, 650); ctx.lineTo(960, 720); ctx.lineTo(0, 720); ctx.fill();
  for (let i = 0; i < 30; i++) { ctx.fillStyle = r() < 0.5 ? '#a8987a' : '#6e6248'; ctx.beginPath(); ctx.ellipse(r() * w, 650 + r() * 60, 8 + r() * 10, 5 + r() * 5, 0, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#3c9a4a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  for (const x of [60, 90, 300, 830, 870, 910]) {
    ctx.beginPath(); ctx.moveTo(x, 660); ctx.bezierCurveTo(x - 25, 560, x + 25, 500, x - 5, 400 + (x % 70)); ctx.stroke();
  }
  // Reeds and cattails at the left edge, above the water.
  for (const x of [20, 44, 70]) {
    ctx.strokeStyle = '#4c8a2e'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x + 4, 120 + (x % 3) * 10); ctx.stroke();
    ctx.fillStyle = '#7a4a24'; ctx.beginPath(); ctx.roundRect(x - 4, 130 + (x % 3) * 10, 16, 46, 8); ctx.fill();
  }
  // Lily pads on the surface, on the right.
  for (const [x, rr] of [[700, 56], [820, 44], [600, 36]]) {
    ctx.fillStyle = '#4caf50'; ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(x, 262, rr, rr * 0.28, 0, 0.25, Math.PI * 2 - 0.25); ctx.lineTo(x, 262); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = '#ff9cc6'; ctx.beginPath(); ctx.arc(820, 252, 10, 0, Math.PI * 2); ctx.fill();
}

function spawnPainter() {
  return paint(150, 110, (ctx) => {
    const r = rng(3);
    for (let i = 0; i < 26; i++) {
      const x = 30 + r() * 90; const y = 25 + r() * 60;
      ctx.fillStyle = 'rgba(220,240,255,0.75)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1e2a3a'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function tadpolePainter(legs) {
  return paint(150, 90, (ctx) => {
    // The tail fin, then the body (facing right).
    ctx.fillStyle = 'rgba(90,70,40,0.55)'; ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(70, 45); ctx.bezierCurveTo(40, 20, 20, 30, 4, 40); ctx.bezierCurveTo(20, 55, 40, 66, 70, 50); ctx.fill(); ctx.stroke();
    if (legs >= 1) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const [lw, c] of [[12, '#2a1e0a'], [7, '#b8a050']]) {
        ctx.strokeStyle = c; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(82, 62); ctx.lineTo(66, 78); ctx.lineTo(52, 82); ctx.stroke();
      }
    }
    if (legs >= 2) {
      for (const [lw, c] of [[10, '#2a1e0a'], [5, '#b8a050']]) {
        ctx.strokeStyle = c; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(115, 64); ctx.lineTo(122, 80); ctx.lineTo(132, 82); ctx.stroke();
      }
    }
    ctx.fillStyle = grad(ctx, 0, 20, 0, 70, ['#6a5a32', '#3a2e16']); ctx.strokeStyle = '#1e1a0a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(100, 46, 42, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(118, 36, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1e2a3a'; ctx.beginPath(); ctx.arc(120, 36, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1e1a0a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(128, 50, 7, 0.2, 1.4); ctx.stroke();
  });
}

function frogletPainter() {
  return paint(150, 100, (ctx) => {
    // A small frog that still has a stub of a tail.
    ctx.fillStyle = '#5f8a3a'; ctx.strokeStyle = '#2a4a14'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(52, 52); ctx.quadraticCurveTo(26, 50, 12, 56); ctx.quadraticCurveTo(28, 64, 52, 62); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.strokeStyle = '#4f7a2e';
    ctx.beginPath(); ctx.moveTo(64, 66); ctx.lineTo(44, 84); ctx.lineTo(30, 88); ctx.moveTo(110, 68); ctx.lineTo(122, 88); ctx.lineTo(134, 90); ctx.stroke();
    ctx.fillStyle = grad(ctx, 0, 25, 0, 80, ['#86c24a', '#4f7a2e']); ctx.strokeStyle = '#2a4a14'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(88, 56, 42, 24, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(108, 34, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1e2a3a'; ctx.beginPath(); ctx.arc(111, 34, 5, 0, Math.PI * 2); ctx.fill();
  });
}

const FROG_STEPS = [
  'A female frog lays her eggs in the water. A clump of eggs is called FROGSPAWN. Clear jelly around each egg keeps it safe.',
  'A TADPOLE hatches! It lives under water, breathes with GILLS and swims with its long tail. Many tadpoles eat algae.',
  'The tadpole grows bigger, and its BACK LEGS grow first.',
  'Then its FRONT LEGS grow and its tail shrinks. Lungs replace its gills, so it swims up to breathe air. Now it is a FROGLET.',
  'An ADULT FROG! It lives on land and in water, breathes with lungs and through its skin, and eats insects. Click the frog to catch a fly!',
];

const frogCycle = {
  id: 'frog-life-cycle', title: 'From Frogspawn to Frog', kind: 'Story', grades: [3, 5], subject: 'Life Science',
  blurb: 'Watch an egg in a pond turn into a tadpole, a froglet and a frog, then help the frog catch flies.',
  learn: 'The life cycle of a frog (frogspawn, tadpole, tadpole with legs, froglet, adult) and what "amphibian" means: an animal that starts life in water and lives on land as an adult.',
  backdrops: [{ name: 'Pond', paint: pondBackdrop }],
  variables: { phase: 1, flies: 0, again: 0 },
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'Young frog', costumes: [['spawn', spawnPainter()], ['tadpole', tadpolePainter(0)], ['legs', tadpolePainter(1)], ['froglet', tadpolePainter(2)], ['froglet2', frogletPainter()]], x: -40, y: -50, rotationStyle: 'left-right', sounds: ['bubble', 'magic'] },
    { name: 'Frog', lib: 'creature-frog', use: ['idle', 'jump'], x: 110, y: 70, size: 80, visible: false, sounds: ['frog', 'boing'] },
    { name: 'Fly', lib: 'creature-fly', use: ['a', 'b'], x: -40, y: 125, size: 55, visible: false },
    { name: 'Stage label', costumes: [['1', label('1  FROGSPAWN', '#e3f6ff', '#1e2a3a', 26)], ['2', label('2  TADPOLE', '#c8f2a0', '#1e2a3a', 26)], ['3', label('3  BACK LEGS', '#ffe08a', '#1e2a3a', 26)], ['4', label('4  FROGLET', '#ffc08a', '#1e2a3a', 26)], ['5', label('5  ADULT FROG', '#8fe08a', '#1e2a3a', 26)]], x: -120, y: 152 },
    { name: 'Next', costumes: [['button', label('Next ▶', '#ffffff', '#1e2a3a', 26)]], x: 180, y: 152, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "phase" to 1
    set "flies" to 0
    set "again" to 0
    broadcast "phase"
    forever:
        if (((timer) > 9) and ((phase) < 5)) then:
            change "phase" by 1
            broadcast "phase"
        wait 0.2 seconds

when flag clicked:
    play sound "tune-wonder" until done

when I receive "phase":
    reset timer
    if ((phase) = 1) then:
        if ((again) = 1) then:
            show caption "The adult frog lays eggs in the pond, and the LIFE CYCLE begins again!"
        else:
            show caption "${FROG_STEPS[0]}"
${FROG_STEPS.slice(1).map((s, i) => `    if ((phase) = ${i + 2}) then:\n        show caption "${s}"`).join('\n')}
`,
    'Young frog': `
when flag clicked:
    forever:
        if ((phase) = 1) then:
            set y to (-50 + (4 * ("sin" of ((timer) * 120))))
        if (((phase) > 1) and ((phase) < 5)) then:
            move 2 steps
            if ((x position) > 170) then:
                point in direction -90
            if ((x position) < -180) then:
                point in direction 90
            if ((phase) = 4) then:
                if ((y position) < 20) then:
                    change y by 0.5
            else:
                set y to (-55 + (10 * ("sin" of ((x position) * 3))))

when I receive "phase":
    if ((phase) = 1) then:
        switch costume to "spawn"
        go to x: -40 y: -50
        point in direction 90
        set size to 100 %
        show
    if ((phase) = 2) then:
        start sound "bubble"
        switch costume to "tadpole"
        set size to 70 %
    if ((phase) = 3) then:
        start sound "magic"
        switch costume to "legs"
        set size to 85 %
    if ((phase) = 4) then:
        start sound "magic"
        switch costume to "froglet2"
        set size to 90 %
    if ((phase) = 5) then:
        hide
`,
    Frog: `
when flag clicked:
    hide

when I receive "phase":
    if ((phase) = 5) then:
        go to x: 110 y: 70
        switch costume to "idle"
        show
        start sound "frog"
        say "Ribbit! An AMPHIBIAN has a double life: first in water, then on land." for 4 seconds
    else:
        hide

when this sprite clicked:
    if ((phase) = 5) then:
        switch costume to "jump"
        start sound "boing"
        glide 0.4 secs to "Fly"
        broadcast "caught"
        change "flies" by 1
        glide 0.5 secs to x: 110 y: 70
        switch costume to "idle"
        say (join "Flies caught: " (flies)) for 1.5 seconds
`,
    Fly: `
when flag clicked:
    hide

when I receive "phase":
    if ((phase) = 5) then:
        go to x: -40 y: 125
        show
        forever:
            next costume
            glide 0.6 secs to x: (pick random -160 to 60) y: (pick random 90 to 140)
    else:
        hide

when I receive "caught":
    hide
    wait 1 seconds
    go to x: (pick random -160 to 60) y: (pick random 90 to 140)
    show
`,
    'Stage label': `
when I receive "phase":
    if ((phase) = 1) then:
        switch costume to "1"
    if ((phase) = 2) then:
        switch costume to "2"
    if ((phase) = 3) then:
        switch costume to "3"
    if ((phase) = 4) then:
        switch costume to "4"
    if ((phase) = 5) then:
        switch costume to "5"
    set size to 70 %
    repeat 3:
        change size by 10
`,
    Next: `
when flag clicked:
    forever:
        change size by 3
        wait 0.4 seconds
        change size by -3
        wait 0.4 seconds

when this sprite clicked:
    start sound "click"
    change "phase" by 1
    if ((phase) > 5) then:
        set "phase" to 1
        set "again" to 1
    broadcast "phase"
`,
  },
  picture: [[600]],
  check: [{ frames: 60 }, { click: 'Next' }, { frames: 60 }, { click: 'Next' }, { frames: 60 }, { click: 'Next' }, { frames: 60 }, { click: 'Next' }, { frames: 150 },
    { click: 'Frog' }, { frames: 60 }, { expect: { phase: 5, flies: 1 } }, { click: 'Next' }, { frames: 30 }, { expect: { phase: 1 } }],
};

// =====================================================================================================
// 3. Sort the Animals (grades 3-5, Game)
// =====================================================================================================

function parkBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, 470, ['#7fd0ff', '#e6f7ff']);
  ctx.fillRect(0, 0, w, 470);
  cloud(ctx, 90, 60, 0.9); cloud(ctx, 760, 90, 1.1);
  ctx.fillStyle = '#8fd46a';
  ctx.beginPath(); ctx.moveTo(0, 420); ctx.quadraticCurveTo(250, 330, 520, 410); ctx.quadraticCurveTo(760, 350, 960, 400); ctx.lineTo(960, 720); ctx.lineTo(0, 720); ctx.fill();
  ctx.fillStyle = '#6cc04a';
  ctx.beginPath(); ctx.moveTo(0, 480); ctx.quadraticCurveTo(480, 430, 960, 480); ctx.lineTo(960, 720); ctx.lineTo(0, 720); ctx.fill();
  // The spotlight the next animal stands in.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath(); ctx.ellipse(480, 230, 110, 104, 0, 0, Math.PI * 2); ctx.fill();
  ctx.setLineDash([14, 10]); ctx.lineWidth = 5; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.setLineDash([]);
  text(ctx, 'WHICH GROUP?', 480, 352, 30, '#1e2a3a');
}

const ANIMAL_GROUPS = [
  ['Mammal', 'M', 'MAMMAL', '#ffb36b', 'hair or fur', 'babies drink milk', -192],
  ['Bird', 'B', 'BIRD', '#8fd0ff', 'feathers, beak', 'hard-shelled eggs', -96],
  ['Reptile', 'R', 'REPTILE', '#b7e36b', 'dry scales', 'breathes air', 0],
  ['Amphibian', 'A', 'AMPHIBIAN', '#c7a6ff', 'moist skin', 'young live in water', 96],
  ['Fish', 'F', 'FISH', '#6fe0d0', 'gills and fins', 'lives in water', 192],
];

function binPainter(title, fill, a, b) {
  return paint(176, 152, (ctx) => {
    ctx.fillStyle = fill; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(4, 4, 168, 144, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath(); ctx.roundRect(14, 64, 148, 72, 12); ctx.fill();
    text(ctx, title, 88, 36, title.length > 7 ? 25 : 30);
    text(ctx, a, 88, 84, 19, '#1e2a3a', 'center', 600);
    text(ctx, b, 88, 114, 19, '#1e2a3a', 'center', 600);
  });
}

const ANIMALS = [
  ['elephant', '🐘', 'M', 'An elephant is a MAMMAL: it has hair and feeds its babies milk.'],
  ['eagle', '🦅', 'B', 'An eagle is a BIRD: it has feathers and a beak, and lays eggs with hard shells.'],
  ['turtle', '🐢', 'R', 'A turtle is a REPTILE: it has dry, scaly skin, breathes air and lays its eggs on land.'],
  ['frog', '🐸', 'A', 'A frog is an AMPHIBIAN: it has moist skin and starts life as a tadpole in water.'],
  ['shark', '🦈', 'F', 'A shark is a FISH: it breathes with gills and swims with fins.'],
  ['whale', '🐋', 'M', 'A whale is a MAMMAL, not a fish! It breathes air through a blowhole and feeds its calf milk.'],
  ['penguin', '🐧', 'B', 'A penguin is a BIRD, even though it cannot fly. It has feathers and lays eggs.'],
  ['snake', '🐍', 'R', 'A snake is a REPTILE. It has no legs, but it has dry scales and breathes air with lungs.'],
  ['bat', '🦇', 'M', 'A bat is a MAMMAL with fur, and the only mammal that can really fly.'],
  ['fish', '🐠', 'F', 'This is a FISH: its gills take oxygen from the water as it swims.'],
];

const groupX = Object.fromEntries(ANIMAL_GROUPS.map((g) => [g[1], g[6]]));

const sortAnimals = {
  id: 'sort-the-animals', title: 'Sort the Animals', kind: 'Game', grades: [3, 5], subject: 'Life Science',
  blurb: 'Is a whale a fish? Is a bat a bird? Click the right group for each animal and learn the clues.',
  learn: 'The five groups of vertebrates (mammals, birds, reptiles, amphibians and fish), the features that put an animal in each group, and that every one of them has a backbone.',
  backdrops: [{ name: 'Animal Park', paint: parkBackdrop }],
  variables: { score: 0, animal: 1, pick: '', busy: 0 },
  monitors: [['score', 'large', 8, 8]],
  sprites: [
    { name: 'Animal', costumes: ANIMALS.map(([n, e]) => [n, emoji(e, 140)]), x: 0, y: 70, variables: { tx: 0 }, sounds: ['coin', 'hit', 'whoosh'] },
    ...ANIMAL_GROUPS.map(([name, , title, fill, a, b, x]) => ({ name, costumes: [['bin', binPainter(title, fill, a, b)]], x, y: -72, sounds: ['pop'] })),
    { name: 'Ranger', lib: 'toon-sam', use: ['idle', 'talk', 'cheer0', 'think'], x: 185, y: 72, size: 55, sounds: ['win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "animal" to 1
    set "pick" to ""
    set "busy" to 0
    show caption "Which group does this animal belong to? Read the clues on the boxes, then click one!"
`,
    Animal: `
when flag clicked:
    switch costume to "elephant"
    go to x: 0 y: 70
    set size to 100 %
    clear graphic effects
    show
    forever:
        if ((busy) = 0) then:
            set y to (70 + (5 * ("sin" of ((timer) * 200))))

when I receive "pick":
    set "busy" to 1
    if ((pick) = (letter (animal) of "${ANIMALS.map((a) => a[2]).join('')}")) then:
        change "score" by 1
        start sound "coin"
        say "Correct!"
    else:
        start sound "hit"
        say "Not that one..."
${ANIMALS.map(([, , g, fact], i) => `    if ((animal) = ${i + 1}) then:\n        show caption "${fact}"\n        set "tx" to ${groupX[g]}`).join('\n')}
    wait 0.8 seconds
    say ""
    start sound "whoosh"
    glide 0.7 secs to x: (tx) y: -62
    repeat 10:
        change size by -8
        change "ghost" effect by 10
    hide
    wait 2 seconds
    clear graphic effects
    set size to 100 %
    change "animal" by 1
    if ((animal) > ${ANIMALS.length}) then:
        broadcast "finish"
        stop "this script"
    next costume
    go to x: 0 y: 70
    show
    set "busy" to 0
`,
    ...Object.fromEntries(ANIMAL_GROUPS.map(([name, letter]) => [name, `
when this sprite clicked:
    if ((busy) = 0) then:
        set "pick" to "${letter}"
        broadcast "pick"
        start sound "pop"
        change size by 8
        wait 0.1 seconds
        change size by -8
`])),
    Ranger: `
when flag clicked:
    switch costume to "talk"
    say "Hi! I'm a park ranger. Help me sort these animals into groups." for 4 seconds
    switch costume to "idle"

when I receive "finish":
    switch costume to "cheer0"
    start sound "win"
    say (join (join "You sorted " (score)) " out of 10!") for 3 seconds
    switch costume to "talk"
    show caption "All ten animals have a BACKBONE, so they are VERTEBRATES. Animals with no backbone, like insects, worms and snails, are INVERTEBRATES."
    say "Click the green flag to play again."
`,
  },
  picture: [[45]],
  check: [{ frames: 30 },
    ...ANIMALS.flatMap(([, , g]) => [{ click: ANIMAL_GROUPS.find((x) => x[1] === g)[0] }, { frames: 125 }]),
    { frames: 60 }, { expect: { score: 10 } }],
};

// =====================================================================================================
// 4. Energy in a Food Chain (grades 6-8, Simulation)
// =====================================================================================================

const LEVELS = [
  // [y, bar width, colour, organism, role, energy, caption]
  [-70, 280, '#3fae4a', 'GRASS', 'producer', '10,000 units', 'GRASS is a PRODUCER: it traps the Sun\'s energy by photosynthesis and stores it in sugar. Say the grass stores 10,000 units of energy.'],
  [-14, 224, '#9ad14b', 'CRICKET', 'primary consumer', '1,000 units', 'Crickets eat the grass. Only about 10% of the energy, 1,000 units, ends up stored in their bodies. The rest is used for living and lost as HEAT.'],
  [42, 168, '#ffd23f', 'FROG', 'secondary consumer', '100 units', 'Frogs eat the crickets. Again only about 10% passes on: 100 units. Each step up the chain loses about 90%.'],
  [98, 112, '#ff9f43', 'SNAKE', 'tertiary consumer', '10 units', 'Snakes eat the frogs. Now just 10 units of the grass\'s energy are left.'],
  [154, 56, '#ff5e57', 'EAGLE', 'top predator', '1 unit', 'The eagle eats the snake and gets just 1 unit. That is why there are far fewer eagles than crickets: there is not enough energy at the top to feed many.'],
];

function energyBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, h, ['#dff3ff', '#f4fbe8', '#d6efc0']);
  ctx.fillRect(0, 0, w, h);
  // Faint places where the pyramid's bars will go.
  LEVELS.forEach(([y, bw]) => {
    const cy = (180 - y) * 2; const cx = (70 + 240) * 2;
    ctx.setLineDash([10, 8]); ctx.strokeStyle = 'rgba(30,42,58,0.25)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(cx - bw, cy - 46, bw * 2, 92, 46); ctx.stroke(); ctx.setLineDash([]);
  });
  // Names beside the chain.
  LEVELS.forEach(([y, , , org, role]) => {
    const cy = (180 - y) * 2;
    text(ctx, org, 150, cy - 12, 24, '#1e2a3a', 'left');
    text(ctx, role, 150, cy + 16, 17, '#4a5a6a', 'left', 600);
  });
  text(ctx, 'ENERGY PYRAMID', 330, 22, 20, '#4a5a6a');
}

function barScript([y, bw, colour]) {
  const step = (bw - 46) / 20;
  return `    set pen size to 46
    set pen color to "${colour}"
    go to x: ${70 - (bw / 2 - 23)} y: ${y}
    pen down
    repeat 20:
        change x by ${step}
    pen up`;
}

function arrowScript(y0, y1) {
  return `    set pen size to 5
    set pen color to "#1e2a3a"
    go to x: -224 y: ${y0}
    pen down
    repeat 10:
        change y by ${(y1 - y0) / 10}
    go to x: -230 y: ${y1 - 8}
    go to x: -224 y: ${y1}
    go to x: -218 y: ${y1 - 8}
    pen up`;
}

const energyPyramid = {
  id: 'energy-pyramid', title: 'Energy in a Food Chain', kind: 'Simulation', grades: [6, 8], subject: 'Life Science',
  blurb: 'Send the Sun\'s energy up a food chain and watch the energy pyramid build, step by step. Then answer three questions.',
  learn: 'How energy flows from the Sun through producers and consumers, why only about 10% passes to each next level (the rest is used or lost as heat), and what decomposers do.',
  backdrops: [{ name: 'Meadow', paint: energyBackdrop }],
  variables: { level: 0, flowing: 0, hy: 0, score: 0 },
  sprites: [
    { name: 'Sun', costumes: [['sun', emoji('☀️', 120)]], x: 195, y: 138, sounds: ['power-up'] },
    ...LEVELS.map(([y, , , org]) => ({ name: org[0] + org.slice(1).toLowerCase(), costumes: [['me', emoji({ GRASS: '🌾', CRICKET: '🦗', FROG: '🐸', SNAKE: '🐍', EAGLE: '🦅' }[org], 74)]], x: -185, y })),
    ...LEVELS.map(([y, bw, , , , energy], i) => ({ name: `Energy ${i + 1}`, costumes: [['tag', label(energy, '#ffffff', '#1e2a3a', i === 4 ? 16 : 20)]], x: 70, y, visible: false })),
    { name: 'Spark', costumes: [['spark', emoji('✨', 40)]], x: 195, y: 138, visible: false },
    { name: 'Heat', costumes: [['heat', emoji('🔥', 34)]], x: 0, y: 0, visible: false },
    { name: 'Mushroom', costumes: [['fungus', emoji('🍄', 70)]], x: 212, y: -60, visible: false, sounds: ['magic'] },
    { name: 'Decomposer tag', costumes: [['tag', label('decomposer', '#e7d3ff', '#1e2a3a', 16)]], x: 205, y: -5, visible: false },
    { name: 'Pyramid', costumes: [['pen', circle(4, '#1e2a3a', null)]], x: 0, y: 0, visible: false, sounds: ['chime', 'hit', 'win', 'pop'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "level" to 0
    set "flowing" to 0
    set "score" to 0
    show caption "All the energy in a food chain starts with the Sun. Click the Sun to send energy into the chain!"
    wait 6 seconds
    if ((flowing) = 0) then:
        set "flowing" to 1
        broadcast "flow"
`,
    Sun: `
when flag clicked:
    forever:
        turn right 2 degrees
        wait 0.05 seconds

when this sprite clicked:
    if ((flowing) = 0) then:
        set "flowing" to 1
        start sound "power-up"
        broadcast "flow"
`,
    Spark: `
when flag clicked:
    hide

when I receive "sunbeam":
    repeat 8:
        create clone of "myself"
        wait 0.12 seconds
    wait 1.2 seconds

when I start as a clone:
    go to x: 195 y: 138
    show
    glide 1.1 secs to x: (pick random -200 to -170) y: -70
    delete this clone
`,
    Heat: `
when flag clicked:
    hide

when I receive "heat":
    repeat 6:
        create clone of "myself"
        wait 0.12 seconds
    wait 0.8 seconds

when I start as a clone:
    go to x: (-185 + (pick random -18 to 18)) y: (hy)
    set size to 100 %
    show
    repeat 20:
        change y by 2
        change x by (pick random -1 to 1)
        change "ghost" effect by 5
    delete this clone
`,
    ...Object.fromEntries(LEVELS.map((_, i) => [`Energy ${i + 1}`, `
when flag clicked:
    hide

when I receive "level ${i + 1}":
    show
    set size to 50 %
    repeat 5:
        change size by 10
`])),
    Mushroom: `
when flag clicked:
    hide

when I receive "decompose":
    start sound "magic"
    show
    set size to 40 %
    repeat 6:
        change size by 10
`,
    'Decomposer tag': `
when flag clicked:
    hide

when I receive "decompose":
    wait 0.3 seconds
    show
`,
    Pyramid: `
when flag clicked:
    hide
    erase all

when I receive "flow":
    set "level" to 1
    broadcast "sunbeam" and wait
    show caption "${LEVELS[0][6]}"
${barScript(LEVELS[0])}
    broadcast "level 1"
    wait 4.5 seconds
${LEVELS.slice(1).map((lv, i) => `    set "level" to ${i + 2}
    set "hy" to ${LEVELS[i][0]}
    broadcast "heat"
${arrowScript(LEVELS[i][0] + 10, lv[0] - 10)}
    show caption "${lv[6].replace(/"/g, "'")}"
${barScript(lv)}
    broadcast "level ${i + 2}"
    wait 5 seconds`).join('\n')}
    broadcast "decompose"
    show caption "When plants and animals die, DECOMPOSERS such as fungi and bacteria break them down and return NUTRIENTS to the soil. Nutrients are recycled; energy is not, it leaves as heat."
    wait 6 seconds
    set "score" to 0
    show caption "Quiz time! Three questions."
    ask "Grass stores 50,000 units of energy. About how many units reach the SNAKE? (type a number)" and wait
    if ((answer) = 50) then:
        change "score" by 1
        start sound "chime"
        show caption "Yes! 50,000, then 5,000, then 500, then 50. Each step keeps about 10%."
    else:
        start sound "hit"
        show caption "It is about 50: 50,000, then 5,000, then 500, then 50. Each step keeps about 10%."
    wait 1 seconds
    ask "In a food chain, do the arrows point toward the EATER or the EATEN?" and wait
    if ((answer) contains "eater" ?) then:
        change "score" by 1
        start sound "chime"
        show caption "Right! An arrow shows which way the ENERGY goes: from the food to the eater."
    else:
        start sound "hit"
        show caption "They point toward the EATER, because they show which way the energy goes."
    wait 1 seconds
    ask "Why are there fewer eagles than crickets? Type A, B or C.  A: eagles are lazy  B: less energy reaches the top  C: crickets are bigger" and wait
    if ((answer) = "b") then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    if ((score) = 3) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 3! Most of the energy is used up or lost as heat at each step, so less is left for animals higher up.")
`,
  },
  picture: [[760]],
  check: [{ frames: 30 }, { click: 'Sun' }, { frames: 1150 }, { answer: '50' }, { frames: 40 }, { answer: 'the eater' }, { frames: 40 }, { answer: 'B' }, { frames: 40 },
    { expect: { score: 3 } }],
};

// =====================================================================================================
// 5. The Journey of Your Lunch (grades 6-8, Animation)
// =====================================================================================================

function bodyBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, w, h, ['#d4f4f0', '#e9e0ff']);
  ctx.fillRect(0, 0, w, h);
  // Torso and head.
  ctx.fillStyle = '#ffd9bf'; ctx.strokeStyle = '#c98a64'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(330, 180, 300, 600, 90); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(448, 140, 64, 60, 10); ctx.fill();
  ctx.beginPath(); ctx.arc(480, 92, 64, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Hair, eyes, smile.
  ctx.fillStyle = '#6b4226';
  ctx.beginPath(); ctx.arc(480, 80, 64, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.fillStyle = '#1e2a3a';
  ctx.beginPath(); ctx.arc(458, 86, 6, 0, Math.PI * 2); ctx.arc(502, 86, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c2455a';
  ctx.beginPath(); ctx.ellipse(480, 122, 18, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Oesophagus.
  ctx.strokeStyle = '#e88a8a'; ctx.lineWidth = 20; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(480, 132); ctx.lineTo(480, 270); ctx.quadraticCurveTo(482, 292, 512, 300); ctx.stroke();
  // Liver (viewer's left) and gall bladder.
  blob(ctx, [[360, 270], [470, 250], [520, 270], [490, 320], [420, 350], [365, 330]], '#a8443a', '#6e2420', 4);
  ctx.fillStyle = '#5aa04a'; ctx.beginPath(); ctx.ellipse(455, 345, 12, 9, 0, 0, Math.PI * 2); ctx.fill();
  // Stomach (viewer's right).
  ctx.fillStyle = '#f08aa0'; ctx.strokeStyle = '#a3445a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(505, 290); ctx.bezierCurveTo(600, 270, 625, 340, 590, 375); ctx.bezierCurveTo(560, 400, 520, 390, 500, 380);
  ctx.bezierCurveTo(520, 360, 540, 340, 505, 300); ctx.closePath(); ctx.fill(); ctx.stroke();
  // Pancreas.
  ctx.fillStyle = '#f7d27a'; ctx.strokeStyle = '#b08a2a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(540, 395, 48, 11, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // Large intestine: a frame round the small intestine.
  ctx.strokeStyle = '#c98a5a'; ctx.lineWidth = 30; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(395, 548); ctx.lineTo(395, 420); ctx.lineTo(565, 420); ctx.lineTo(565, 550); ctx.quadraticCurveTo(560, 580, 480, 585); ctx.lineTo(480, 610); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,70,30,0.35)'; ctx.lineWidth = 3;
  for (let y = 440; y < 545; y += 18) { ctx.beginPath(); ctx.moveTo(381, y); ctx.lineTo(409, y); ctx.moveTo(551, y); ctx.lineTo(579, y); ctx.stroke(); }
  // Small intestine: a winding tube inside the frame.
  ctx.strokeStyle = '#f2a0a0'; ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(520, 385); ctx.lineTo(530, 445);
  for (let i = 0; i < 5; i++) { const y = 450 + i * 20; ctx.lineTo(i % 2 ? 530 : 430, y); ctx.lineTo(i % 2 ? 530 : 430, y + 10); }
  ctx.lineTo(400, 545); ctx.stroke();
  ctx.strokeStyle = '#d97a7a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(520, 385); ctx.lineTo(530, 445);
  for (let i = 0; i < 5; i++) { const y = 450 + i * 20; ctx.lineTo(i % 2 ? 530 : 430, y); ctx.lineTo(i % 2 ? 530 : 430, y + 10); }
  ctx.lineTo(400, 545); ctx.stroke();
  text(ctx, 'THE DIGESTIVE SYSTEM', 160, 24, 22, '#4a5a6a');
}

const ORGANS = [
  // [sprite name, label text, colour, label x, label y, organ point x, y]
  ['Mouth', 'MOUTH', '#ffd23f', -130, 125, -14, 119],
  ['Esophagus', 'ESOPHAGUS', '#ff9cc6', 135, 85, 8, 75],
  ['Stomach', 'STOMACH', '#ff8aa0', 160, 30, 65, 22],
  ['Liver', 'LIVER', '#e0897f', -160, 40, -60, 30],
  ['Pancreas', 'PANCREAS', '#f7d27a', 165, -10, 52, -18],
  ['Small intestine', 'SMALL\nINTESTINE', '#f2a0a0', 165, -60, 25, -55],
  ['Large intestine', 'LARGE\nINTESTINE', '#e0b07a', -160, -55, -42, -50],
  ['Rectum', 'RECTUM', '#c98a5a', -135, -105, -2, -110],
];

const DIGESTION_CAPTIONS = {
  mouth: 'MOUTH: your teeth chew the food into small pieces. SALIVA wets it and starts to break down starch.',
  esophagus: 'ESOPHAGUS (the food pipe): rings of muscle squeeze in waves to push the food down. This is called PERISTALSIS.',
  stomach: 'STOMACH: strong muscles churn the food with ACID and ENZYMES for a few hours, until it is a thick soup.',
  small: 'SMALL INTESTINE: juices from the LIVER and PANCREAS finish breaking the food down. NUTRIENTS pass through its walls into the blood.',
  small2: 'The small intestine is the longest part of the system, several metres of tube folded up to fit. Its walls are covered in tiny finger-like VILLI.',
  large: 'LARGE INTESTINE: water is soaked back into the body, and helpful bacteria live here. What is left becomes solid waste.',
  rectum: 'The waste waits in the RECTUM until you go to the toilet. The whole journey takes a day or more, often a few days.',
};

const digestion = {
  id: 'digestion-journey', title: 'The Journey of Your Lunch', kind: 'Animation', grades: [6, 8], subject: 'Life Science',
  blurb: 'Take a bite of a sandwich and follow it through the mouth, stomach and intestines, then answer three questions.',
  learn: 'The organs of the digestive system in order (mouth, esophagus, stomach, small intestine, large intestine, rectum), what happens in each, and how the liver and pancreas help.',
  backdrops: [{ name: 'Body', paint: bodyBackdrop }],
  variables: { score: 0, started: 0 },
  sprites: [
    ...ORGANS.map(([name, txt, fill, x, y]) => ({ name, costumes: [['tag', label(txt, fill, '#1e2a3a', 18)]], x, y, visible: false, variables: { ox: 0, oy: 0 } })),
    { name: 'Nutrient', costumes: [['sugar', circle(5, '#ffd23f', '#a07a00', 2)], ['protein', circle(5, '#ff6fa8', '#a3245a', 2)], ['fat', circle(5, '#7ee0ff', '#1f7fa0', 2)]], x: 0, y: 0, visible: false },
    { name: 'Water', costumes: [['drop', emoji('💧', 22)]], x: 0, y: 0, visible: false },
    { name: 'Food', costumes: [['sandwich', emoji('🥪', 80)], ['bolus', circle(11, '#c98a4a', '#6e4524', 3)], ['chyme', circle(10, '#d8d06a', '#8a8020', 3)], ['waste', circle(8, '#7a4a24', '#3a2210', 3)]], x: -160, y: 120, sounds: ['pop', 'whoosh', 'bubble', 'chime', 'hit', 'win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "started" to 0
    reset timer
    show caption "You are hungry! Click the sandwich to take a bite, then follow it on its journey."
`,
    ...Object.fromEntries(ORGANS.map(([name, , , x, y, ox, oy]) => [name, `
when flag clicked:
    hide
    erase all

when I receive "show ${name}":
    go to x: ${x} y: ${y}
    set pen color to "#4a5a6a"
    set pen size to 2
    pen down
    go to x: ${ox} y: ${oy}
    pen up
    go to x: ${x} y: ${y}
    go to "front" layer
    show
    set size to 60 %
    repeat 4:
        change size by 10
`])),
    Nutrient: `
when flag clicked:
    hide

when I receive "absorb":
    repeat 14:
        go to "Food"
        next costume
        create clone of "myself"
        wait 0.25 seconds

when I start as a clone:
    show
    point in direction (pick random -120 to 120)
    repeat 25:
        move 3 steps
        change "ghost" effect by 4
    delete this clone
`,
    Water: `
when flag clicked:
    hide

when I receive "dry":
    repeat 8:
        go to "Food"
        create clone of "myself"
        wait 0.3 seconds

when I start as a clone:
    show
    if ((x position) < 0) then:
        point in direction -90
    else:
        point in direction 90
    repeat 20:
        move 3 steps
        change "ghost" effect by 5
    delete this clone
`,
    Food: `
when flag clicked:
    switch costume to "sandwich"
    go to x: -160 y: 120
    set size to 100 %
    clear graphic effects
    show
    forever:
        if ((started) = 0) then:
            set y to (120 + (4 * ("sin" of ((timer) * 200))))
            if ((timer) > 6) then:
                set "started" to 1
                broadcast "journey"

when this sprite clicked:
    if ((started) = 0) then:
        set "started" to 1
        broadcast "journey"

when I receive "journey":
    start sound "pop"
    glide 1 secs to x: 0 y: 120
    broadcast "show Mouth"
    show caption "${DIGESTION_CAPTIONS.mouth}"
    repeat 6:
        change size by -10
        wait 0.15 seconds
        change size by 6
        wait 0.15 seconds
    switch costume to "bolus"
    set size to 100 %
    wait 1.5 seconds
    broadcast "show Esophagus"
    show caption "${DIGESTION_CAPTIONS.esophagus}"
    repeat 8:
        change y by -5
        set size to 80 %
        wait 0.12 seconds
        change y by -5
        set size to 110 %
        wait 0.12 seconds
    set size to 100 %
    glide 0.6 secs to x: 30 y: 22
    broadcast "show Stomach"
    start sound "bubble"
    show caption "${DIGESTION_CAPTIONS.stomach}"
    repeat 36:
        go to x: (30 + (14 * ("cos" of ((timer) * 360)))) y: (22 + (8 * ("sin" of ((timer) * 360))))
        change "color" effect by 2
        wait 0.08 seconds
    switch costume to "chyme"
    clear graphic effects
    glide 0.6 secs to x: 20 y: -15
    broadcast "show Small intestine"
    broadcast "show Liver"
    broadcast "show Pancreas"
    show caption "${DIGESTION_CAPTIONS.small}"
    broadcast "absorb"
    glide 0.8 secs to x: 25 y: -45
    glide 1 secs to x: -25 y: -45
    glide 0.4 secs to x: -25 y: -50
    glide 1 secs to x: 25 y: -55
    show caption "${DIGESTION_CAPTIONS.small2}"
    glide 0.4 secs to x: 25 y: -60
    glide 1 secs to x: -25 y: -60
    glide 0.4 secs to x: -25 y: -70
    glide 1 secs to x: 25 y: -70
    glide 1 secs to x: -38 y: -92
    switch costume to "waste"
    broadcast "show Large intestine"
    show caption "${DIGESTION_CAPTIONS.large}"
    broadcast "dry"
    glide 1.6 secs to x: -42 y: -30
    glide 1.8 secs to x: 42 y: -30
    glide 1.6 secs to x: 42 y: -95
    glide 0.8 secs to x: 0 y: -112
    broadcast "show Rectum"
    show caption "${DIGESTION_CAPTIONS.rectum}"
    wait 3 seconds
    start sound "whoosh"
    hide
    wait 2 seconds
    broadcast "quiz"

when I receive "quiz":
    set "score" to 0
    ask "Where do most NUTRIENTS pass into the blood?" and wait
    if ((answer) contains "small" ?) then:
        change "score" by 1
        start sound "chime"
        show caption "Yes, the SMALL INTESTINE."
    else:
        start sound "hit"
        show caption "It's the SMALL INTESTINE, through its villi."
    wait 1 seconds
    ask "Which organ soaks water back out of the waste and makes it solid?" and wait
    if ((answer) contains "large" ?) then:
        change "score" by 1
        start sound "chime"
        show caption "Right, the LARGE INTESTINE."
    else:
        start sound "hit"
        show caption "It's the LARGE INTESTINE."
    wait 1 seconds
    ask "Which organ churns food with acid?" and wait
    if ((answer) contains "stomach" ?) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    if ((score) = 3) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 3! Click the green flag to eat another sandwich.")
`,
  },
  picture: [[640]],
  check: [{ frames: 30 }, { click: 'Food' }, { frames: 1150 }, { answer: 'small intestine' }, { frames: 40 }, { answer: 'the large intestine' }, { frames: 40 }, { answer: 'Stomach' }, { frames: 30 },
    { expect: { score: 3 } }],
};

// =====================================================================================================
// 6. Germ Defenders (grades 6-8, Game)
// =====================================================================================================

function tissueBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, h, ['#ffc4c4', '#ff9a9a', '#f07a8a']);
  ctx.fillRect(0, 0, w, h);
  // Body cells in the background.
  const r = rng(21);
  for (let i = 0; i < 40; i++) {
    const x = r() * w; const y = 110 + r() * 610;
    ctx.fillStyle = 'rgba(255,230,230,0.35)'; ctx.strokeStyle = 'rgba(200,90,110,0.35)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 46, 34, r() * 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(170,80,140,0.3)'; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
  }
  // Red blood cells drifting about.
  for (let i = 0; i < 22; i++) {
    const x = r() * w; const y = 140 + r() * 560; const s = 0.8 + r() * 0.5;
    ctx.fillStyle = '#d62b3a'; ctx.beginPath(); ctx.ellipse(x, y, 22 * s, 14 * s, r() * 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b01e2c'; ctx.beginPath(); ctx.ellipse(x, y, 10 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The skin, cut open in the middle.
  ctx.fillStyle = '#f2c79a'; ctx.fillRect(0, 0, w, 70);
  ctx.fillStyle = '#d9a274'; ctx.fillRect(0, 70, w, 26);
  ctx.fillStyle = grad(ctx, 0, 0, 0, 100, ['#a8242f', '#ff9a9a']);
  ctx.beginPath(); ctx.moveTo(430, 0); ctx.lineTo(530, 0); ctx.lineTo(500, 98); ctx.lineTo(460, 98); ctx.closePath(); ctx.fill();
  text(ctx, 'SKIN', 90, 36, 28, '#7a4a24');
  text(ctx, 'a cut!', 600, 36, 26, '#a8242f');
}

function defenderPainter(phase) {
  return paint(110, 110, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.strokeStyle = '#7a6ac8'; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const rr = 44 + 7 * Math.sin(a * 5 + phase) + 3 * Math.sin(a * 3 - phase);
      const x = 55 + Math.cos(a) * rr; const y = 55 + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // A lobed nucleus, the mark of a neutrophil.
    ctx.fillStyle = '#8a5ad0';
    for (const [x, y] of [[42, 48], [56, 40], [68, 52], [56, 64]]) { ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#1e2a3a';
    ctx.beginPath(); ctx.arc(44, 78, 4, 0, Math.PI * 2); ctx.arc(66, 78, 4, 0, Math.PI * 2); ctx.fill();
  });
}

function germPainter(tagged) {
  return paint(80, 50, (ctx) => {
    ctx.strokeStyle = tagged ? '#c99a00' : '#2a6a1a'; ctx.lineWidth = 2;
    for (const y of [12, 25, 38]) { ctx.beginPath(); ctx.moveTo(14, y); ctx.quadraticCurveTo(6, y - 6, 1, y + 2); ctx.stroke(); }
    ctx.fillStyle = tagged ? '#ffe14a' : '#5fcf3a'; ctx.strokeStyle = tagged ? '#a07a00' : '#2a6a1a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(12, 10, 62, 30, 15); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tagged ? '#c99a00' : '#2a8a2a';
    for (const x of [28, 42, 56]) { ctx.beginPath(); ctx.arc(x, 25, 4, 0, Math.PI * 2); ctx.fill(); }
    if (tagged) {
      ctx.strokeStyle = '#ff7f11'; ctx.lineWidth = 3;
      for (const [x, y] of [[30, 8], [50, 42]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (y < 20 ? -6 : 6)); ctx.stroke(); }
    }
  });
}

function antibodyPainter() {
  return paint(36, 40, (ctx) => {
    ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(18, 36); ctx.lineTo(18, 20); ctx.lineTo(6, 6); ctx.moveTo(18, 20); ctx.lineTo(30, 6); ctx.stroke();
  });
}

const germDefenders = {
  id: 'germ-defenders', title: 'Germ Defenders', kind: 'Game', grades: [6, 8], subject: 'Life Science',
  blurb: 'Germs got in through a cut! Steer a white blood cell to swallow them before they multiply, then unlock antibodies.',
  learn: 'The body\'s defences against germs: skin as a barrier, white blood cells that swallow germs (phagocytes), antibodies that tag germs, and memory cells, which are how vaccines work.',
  backdrops: [{ name: 'Under the skin', paint: tissueBackdrop }],
  variables: { eaten: 0, germs: 0, playing: 0, antibodies: 0 },
  monitors: [['eaten', 'normal', 8, 56], ['germs', 'normal', 8, 84]],
  sprites: [
    { name: 'Germ', costumes: [['germ', germPainter(false)], ['tagged', germPainter(true)]], x: 0, y: 130, visible: false, variables: { tagged: 0, life: 0, clone: 0 }, sounds: ['pop'] },
    { name: 'Antibody', costumes: [['y', antibodyPainter()]], x: 0, y: 0, visible: false, variables: { ready: 1 }, sounds: ['zap'] },
    { name: 'Defender', costumes: [['a', defenderPainter(0)], ['b', defenderPainter(1.6)]], x: 0, y: -40, rotationStyle: "don't rotate", sounds: ['win', 'game-over', 'power-up', 'tada'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "eaten" to 0
    set "germs" to 0
    set "antibodies" to 0
    set "playing" to 1
    show caption "Your SKIN keeps most germs out, but a cut has let bacteria in! You are a WHITE BLOOD CELL. Use the arrow keys (or hold the mouse down) to swallow them."
`,
    Germ: `
when flag clicked:
    hide
    set "clone" to 0
    go to x: 0 y: 130
    wait 1 seconds
    repeat 8:
        go to x: (pick random -25 to 25) y: 130
        create clone of "myself"
        wait 1.2 seconds

when I start as a clone:
    set "clone" to 1
    change "germs" by 1
    set "tagged" to 0
    set "life" to (pick random 0 to 60)
    switch costume to "germ"
    point in direction (pick random 120 to 240)
    show
    forever:
        if ((tagged) = 0) then:
            move 1.6 steps
            change "life" by 1
        else:
            move 0.5 steps
        turn right (pick random -12 to 12) degrees
        if on edge, bounce
        if ((y position) > 125) then:
            point in direction (pick random 150 to 210)
        if (touching "Defender" ?) then:
            change "germs" by -1
            change "eaten" by 1
            start sound "pop"
            delete this clone
        if (((tagged) = 0) and (touching "Antibody" ?)) then:
            set "tagged" to 1
            switch costume to "tagged"
        if ((life) > 200) then:
            set "life" to (pick random 0 to 40)
            if (((germs) < 20) and ((playing) = 1)) then:
                create clone of "myself"

when I receive "won":
    if ((clone) = 1) then:
        repeat 10:
            change "ghost" effect by 10
        change "germs" by -1
        delete this clone
`,
    Antibody: `
when flag clicked:
    hide
    set "ready" to 1

when "space" key pressed:
    if (((antibodies) = 1) and ((ready) = 1)) then:
        set "ready" to 0
        start sound "zap"
        go to "Defender"
        point in direction 0
        repeat 6:
            create clone of "myself"
            turn right 60 degrees
        wait 1 seconds
        set "ready" to 1

when I start as a clone:
    show
    repeat 28:
        move 6 steps
    delete this clone
`,
    Defender: `
when flag clicked:
    go to x: 0 y: -40
    show
    forever:
        if (key "right arrow" pressed?) then:
            change x by 5
        if (key "left arrow" pressed?) then:
            change x by -5
        if (key "up arrow" pressed?) then:
            change y by 5
        if (key "down arrow" pressed?) then:
            change y by -5
        if (mouse down?) then:
            if ((distance to "mouse-pointer") > 6) then:
                point towards "mouse-pointer"
                move 5 steps
        if ((y position) > 60) then:
            set y to 60
        if ((y position) < -95) then:
            set y to -95

when flag clicked:
    forever:
        next costume
        wait 0.25 seconds

when flag clicked:
    wait until ((eaten) > 0)
    show caption "Gulp! White blood cells called PHAGOCYTES swallow germs whole and break them down."
    wait until ((eaten) > 7)
    set "antibodies" to 1
    start sound "power-up"
    show caption "Other white blood cells have made ANTIBODIES that fit this germ. Press SPACE to release them: they stick to germs, clump them together and mark them to be eaten."
    wait until ((eaten) > 19)
    set "playing" to 0
    broadcast "won"
    start sound "tada"
    say "Infection beaten!" for 2 seconds
    show caption "You won! MEMORY CELLS now remember this germ, so next time your body fights back faster. VACCINES work by training memory cells safely."
    stop "this script"

when flag clicked:
    wait until (((germs) > 19) and ((eaten) < 20))
    set "playing" to 0
    start sound "game-over"
    say "Too many germs!" for 2 seconds
    show caption "The germs multiplied faster than you could eat them. A real body would make a FEVER and send many more white blood cells. Click the green flag to try again."
`,
  },
  picture: [[330]],
  check: [{ frames: 200, keys: ['up arrow'] }, { frames: 150, keys: ['left arrow'] }, { frames: 150, keys: ['right arrow'] }, { press: 'space' }, { frames: 150, keys: ['down arrow'] }],
};

// =====================================================================================================
// 7. Rabbits and Foxes (grades 9-12, Simulation)
// =====================================================================================================

const PP = { a: 0.8, b: 0.04, c: 0.01, d: 0.6, dt: 0.05, k: 1.4, zero: -80, top: 116 };

function graphBackdrop(ctx, w, h) {
  ctx.fillStyle = grad(ctx, 0, 0, 0, h, ['#e7f6e0', '#cfe9c2']);
  ctx.fillRect(0, 0, w, h);
  // The graph panel: its axis is at y = PP.zero steps, and every animal is PP.k steps tall.
  const cyOf = (n) => (180 - (PP.zero + n * PP.k)) * 2;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#7a8a9a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(14, cyOf(140) - 14, 934, 720 - cyOf(140) + 30, 14); ctx.fill(); ctx.stroke();
  ctx.font = '600 16px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let n = 0; n <= 140; n += 20) {
    ctx.strokeStyle = n ? '#e4e9ef' : '#4a5a6a'; ctx.lineWidth = n ? 2 : 4;
    ctx.beginPath(); ctx.moveTo(60, cyOf(n)); ctx.lineTo(920, cyOf(n)); ctx.stroke();
    ctx.fillStyle = '#4a5a6a'; ctx.fillText(String(n), 52, cyOf(n));
  }
  ctx.strokeStyle = '#4a5a6a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(60, cyOf(140)); ctx.lineTo(60, cyOf(0)); ctx.stroke();
  text(ctx, 'number of animals', 72, cyOf(140) + 2, 17, '#4a5a6a', 'left', 600);
  text(ctx, 'time  →', 910, cyOf(0) - 16, 17, '#4a5a6a', 'right', 600);
  // The legend.
  ctx.strokeStyle = '#2e86de'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(660, 34); ctx.lineTo(706, 34); ctx.stroke();
  text(ctx, 'rabbits (prey)', 716, 34, 20, '#1e2a3a', 'left');
  ctx.strokeStyle = '#ff7f11'; ctx.beginPath(); ctx.moveTo(660, 70); ctx.lineTo(706, 70); ctx.stroke();
  text(ctx, 'foxes (predator)', 716, 70, 20, '#1e2a3a', 'left');
}

const PP_CAPTIONS = [
  'Rabbits (the PREY) eat grass and have lots of babies, so their numbers grow.',
  'More rabbits means more food for foxes (the PREDATORS), so the number of foxes rises next.',
  'Lots of foxes eat lots of rabbits, so the rabbit numbers fall.',
  'With fewer rabbits to eat, foxes go hungry and their numbers fall too. Then the rabbits recover, and it all starts again.',
  'See the pattern? Each fox peak comes just AFTER a rabbit peak. Click the rabbit or fox buttons to add animals, or press Q for a quiz.',
  'This is a simple model (the Lotka-Volterra equations). Real populations also depend on weather, disease and the plants they eat.',
  'Real example: in Canada, numbers of snowshoe hares and the lynx that hunt them rise and fall in a cycle of about ten years.',
];

const rabbitsFoxes = {
  id: 'rabbits-and-foxes', title: 'Rabbits and Foxes', kind: 'Simulation', grades: [9, 12], subject: 'Life Science',
  blurb: 'A predator-prey model drawn live as a graph. Add rabbits or foxes and watch both populations rise and fall in waves.',
  learn: 'How predator and prey populations depend on each other, why their numbers cycle with the predator peak lagging the prey peak, and how a simple mathematical model (Lotka-Volterra) can show it.',
  backdrops: [{ name: 'Graph', paint: graphBackdrop }],
  variables: { rabbits: 40, foxes: 10, t: 0, score: 0, quizzing: 0 },
  monitors: [['rabbits', 'normal', 8, 8], ['foxes', 'normal', 8, 34]],
  sprites: [
    { name: 'Add rabbits', costumes: [['button', label('🐇 +30', '#cfe4ff', '#1e2a3a', 24)]], x: -70, y: 152, sounds: ['pop'] },
    { name: 'Add foxes', costumes: [['button', label('🦊 +10', '#ffd9b8', '#1e2a3a', 24)]], x: 20, y: 152, sounds: ['pop'] },
    { name: 'Model', costumes: [['pen', circle(3, '#1e2a3a', null)]], x: -210, y: 0, visible: false, variables: { r: 40, f: 10, pr: 0, pf: 0, ny: 0 }, sounds: ['chime', 'hit', 'win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "quizzing" to 0
    forever:
${PP_CAPTIONS.map((c) => `        wait until ((quizzing) = 0)\n        show caption "${c}"\n        wait 7 seconds`).join('\n')}
`,
    'Add rabbits': `
when this sprite clicked:
    start sound "pop"
    broadcast "add rabbits"
    change size by 10
    wait 0.1 seconds
    change size by -10
`,
    'Add foxes': `
when this sprite clicked:
    start sound "pop"
    broadcast "add foxes"
    change size by 10
    wait 0.1 seconds
    change size by -10
`,
    Model: `
when flag clicked:
    hide
    erase all
    set "r" to 40
    set "f" to 10
    set "t" to 0
    set pen size to 3
    forever:
        set "pr" to (${PP.zero} + ((r) * ${PP.k}))
        set "pf" to (${PP.zero} + ((f) * ${PP.k}))
        change "r" by (((${PP.a} * (r)) - ((${PP.b} * (r)) * (f))) * ${PP.dt})
        change "f" by ((((${PP.c} * (r)) * (f)) - (${PP.d} * (f))) * ${PP.dt})
        set "rabbits" to (round (r))
        set "foxes" to (round (f))
        set "ny" to (${PP.zero} + ((r) * ${PP.k}))
        if ((ny) > ${PP.top}) then:
            set "ny" to ${PP.top}
        if ((pr) > ${PP.top}) then:
            set "pr" to ${PP.top}
        pen up
        go to x: (-210 + (t)) y: (pr)
        set pen color to "#2e86de"
        pen down
        go to x: (-209 + (t)) y: (ny)
        pen up
        set "ny" to (${PP.zero} + ((f) * ${PP.k}))
        if ((ny) > ${PP.top}) then:
            set "ny" to ${PP.top}
        if ((pf) > ${PP.top}) then:
            set "pf" to ${PP.top}
        go to x: (-210 + (t)) y: (pf)
        set pen color to "#ff7f11"
        pen down
        go to x: (-209 + (t)) y: (ny)
        pen up
        change "t" by 1
        if ((t) > 428) then:
            set "t" to 0
            erase all

when I receive "add rabbits":
    change "r" by 30

when I receive "add foxes":
    change "f" by 10

when "q" key pressed:
    set "quizzing" to 1
    set "score" to 0
    ask "On the graph, which peaks first: the rabbits or the foxes?" and wait
    if ((answer) contains "rabbit" ?) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    ask "In this model, what happens to the rabbits if all the foxes disappear?" and wait
    if (((answer) contains "grow" ?) or ((((answer) contains "increas" ?) or ((answer) contains "more" ?)) or (((answer) contains "up" ?) or ((answer) contains "rise" ?)))) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    ask "The fox is the predator. What do we call the rabbit?" and wait
    if ((answer) contains "prey" ?) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    if ((score) = 3) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 3! With no foxes, the rabbits keep growing in this model. In real life they would run out of grass.")
    wait 8 seconds
    set "quizzing" to 0
`,
  },
  picture: [[330]],
  check: [{ frames: 240 }, { click: 'Add rabbits' }, { frames: 150 }, { click: 'Add foxes' }, { frames: 150 }, { press: 'q' }, { frames: 5 },
    { answer: 'rabbits' }, { frames: 5 }, { answer: 'they increase' }, { frames: 5 }, { answer: 'prey' }, { frames: 20 }, { expect: { score: 3 } }],
};

// =====================================================================================================
// 8. From DNA to Protein (grades 9-12, Quiz)
// =====================================================================================================

// The standard genetic code (NCBI table 1), codons in U, C, A, G order: index = 16*b1 + 4*b2 + b3.
const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const AMINO = [
  ['A', 'Ala'], ['R', 'Arg'], ['N', 'Asn'], ['D', 'Asp'], ['C', 'Cys'], ['Q', 'Gln'], ['E', 'Glu'], ['G', 'Gly'], ['H', 'His'], ['I', 'Ile'],
  ['L', 'Leu'], ['K', 'Lys'], ['M', 'Met'], ['F', 'Phe'], ['P', 'Pro'], ['S', 'Ser'], ['T', 'Thr'], ['W', 'Trp'], ['Y', 'Tyr'], ['V', 'Val'],
];
const DNA_START = 'TACGGACTTAAAATT';
const DNA_MUTANT = 'TACGGACATAAAATT';
const BASE_COLOURS = { A: '#ff6b6b', T: '#ffd23f', U: '#7ee08a', C: '#4c97ff', G: '#c77dff' };

function nucleusBackdrop(ctx, w, h) {
  // Cytoplasm below, the nucleus above.
  ctx.fillStyle = grad(ctx, 0, 240, 0, h, ['#ffe6d1', '#ffd0b0']);
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = grad(ctx, 0, 0, 0, 240, ['#d9c8ff', '#ebe0ff']);
  ctx.fillRect(0, 0, w, 236);
  // The nuclear envelope, with pores.
  ctx.fillStyle = '#8a6ad0';
  for (let x = 0; x < w; x += 120) ctx.fillRect(x, 230, 96, 12);
  text(ctx, 'NUCLEUS', 880, 30, 24, '#5a3aa0');
  text(ctx, 'CYTOPLASM', 108, 392, 20, '#a0582a');
  text(ctx, 'DNA', 26, 90, 18, '#5a3aa0', 'left');
  text(ctx, 'RNA', 26, 160, 18, '#5a3aa0', 'left');
  text(ctx, 'mRNA', 16, 320, 18, '#a0582a', 'left');
  text(ctx, 'protein', 8, 470, 18, '#a0582a', 'left');
  // A faint DNA double helix in the nucleus corner, for flavour.
  ctx.lineWidth = 4;
  for (let i = 0; i < 2; i++) {
    ctx.strokeStyle = i ? 'rgba(90,58,160,0.35)' : 'rgba(76,151,255,0.35)';
    ctx.beginPath();
    for (let x = 520; x <= 780; x += 4) { const y = 30 + 14 * Math.sin((x - 520) / 20 + i * Math.PI); if (x === 520) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function basePainter(b) {
  return paint(52, 52, (ctx) => {
    ctx.fillStyle = BASE_COLOURS[b]; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(3, 3, 46, 46, 10); ctx.fill(); ctx.stroke();
    text(ctx, b, 26, 28, 32);
  });
}

function aminoPainter(name, i) {
  return paint(104, 104, (ctx) => {
    ctx.fillStyle = `hsl(${(i * 47) % 360}, 75%, 70%)`; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(52, 52, 46, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, name, 52, 54, 30);
  });
}

function ribosomePainter() {
  return paint(190, 140, (ctx) => {
    ctx.fillStyle = 'rgba(130,90,200,0.85)'; ctx.strokeStyle = '#3a2a70'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(95, 26, 92, 26, 0, Math.PI, Math.PI * 2); ctx.lineTo(187, 40); ctx.lineTo(3, 40); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(170,130,230,0.85)';
    ctx.beginPath(); ctx.moveTo(15, 100); ctx.lineTo(175, 100); ctx.ellipse(95, 108, 80, 28, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
    text(ctx, 'ribosome', 95, 120, 20, '#ffffff');
  });
}

function baseCostumeChain(v, pad) {
  return ['A', 'T', 'C', 'G', 'U'].map((b) => `${pad}if ((${v}) = "${b}") then:\n${pad}    switch costume to "${b}"`).join('\n');
}

const dnaProtein = {
  id: 'dna-to-protein', title: 'From DNA to Protein', kind: 'Quiz', grades: [9, 12], subject: 'Life Science',
  blurb: 'Watch a gene copied into mRNA, then a ribosome read it three letters at a time to build a protein. Press M for a mutation.',
  learn: 'How a gene becomes a protein: transcription (DNA to mRNA, with A-U, T-A, C-G, G-C pairing), translation at a ribosome (codons of three bases, each coding for an amino acid, with start and stop codons), and how one changed base can change a protein.',
  backdrops: [{ name: 'Cell', paint: nucleusBackdrop }],
  variables: { dna: DNA_START, mrna: '', protein: '', codon: '', aa: '', aname: '', k: 0, busy: 0, score: 0 },
  monitors: [['protein', 'normal', 8, 8]],
  sprites: [
    { name: 'Base', costumes: ['A', 'T', 'C', 'G', 'U'].map((b) => [b, basePainter(b)]), x: 0, y: 135, visible: false, variables: { i: 1, b: '', c: '', clone: 0 }, sounds: ['pop'] },
    { name: 'Amino acid', costumes: AMINO.map(([, n], i) => [n, aminoPainter(n, i)]), x: 0, y: 50, visible: false, size: 100, variables: { clone: 0 }, sounds: ['coin'] },
    { name: 'Ribosome', costumes: [['ribosome', ribosomePainter()]], x: -156, y: 20, visible: false, variables: { done: 0, n: 0, j: 1, q: 1, v: 0 }, sounds: ['whoosh', 'tada', 'chime', 'hit', 'win'] },
  ],
  scripts: {
    Base: `
when flag clicked:
    hide
    set "clone" to 0
    set "dna" to "${DNA_START}"
    broadcast "build"

when "m" key pressed:
    if (((clone) = 0) and ((busy) = 0)) then:
        if ((dna) = "${DNA_START}") then:
            set "dna" to "${DNA_MUTANT}"
            show caption "MUTATION! One DNA base has changed: in the third group, CTT became CAT. Watch what happens to the protein..."
        else:
            set "dna" to "${DNA_START}"
            show caption "Back to the original DNA."
        wait 3 seconds
        broadcast "build"

when I receive "build":
    if ((clone) = 0) then:
        set "busy" to 1
        broadcast "clear" and wait
        erase all
        set "mrna" to ""
        set "protein" to ""
        show caption "In the NUCLEUS, part of the DNA unzips. RNA bases pair up with one DNA strand, the TEMPLATE, one by one. This is TRANSCRIPTION."
        set "i" to 1
        show
        repeat (length of (dna)):
            set "b" to (letter (i) of (dna))
            go to x: (-182 + (((i) - 1) * 26)) y: 135
${baseCostumeChain('b', '            ')}
            stamp
            if ((b) = "A") then:
                set "c" to "U"
            if ((b) = "T") then:
                set "c" to "A"
            if ((b) = "C") then:
                set "c" to "G"
            if ((b) = "G") then:
                set "c" to "C"
            set "mrna" to (join (mrna) (c))
            create clone of "myself"
            start sound "pop"
            wait 0.3 seconds
            change "i" by 1
        hide
        show caption "A pairs with U, T with A, C with G and G with C. RNA uses U (uracil) where DNA uses T. This copy is called messenger RNA: mRNA."
        wait 4.5 seconds
        show caption "The mRNA leaves the nucleus through a pore and travels out into the cytoplasm, to a RIBOSOME."
        broadcast "leave"
        wait 1.5 seconds
        broadcast "translate" and wait
        set "busy" to 0

when I start as a clone:
    set "clone" to 1
${baseCostumeChain('c', '    ')}
    go to x: (-182 + (((i) - 1) * 26)) y: 106
    show

when I receive "leave":
    if ((clone) = 1) then:
        glide 1.2 secs to x: (x position) y: 20

when I receive "clear":
    if ((clone) = 1) then:
        delete this clone
`,
    'Amino acid': `
when flag clicked:
    hide
    set "clone" to 0

when I receive "add amino":
    if ((clone) = 0) then:
${AMINO.map(([l, n]) => `        if ((aa) = "${l}") then:\n            switch costume to "${n}"\n            set "aname" to "${n}"`).join('\n')}
        go to x: (-156 + ((k) * 78)) y: 50
        create clone of "myself"
        start sound "coin"
        wait 1 seconds
        if ((protein) = "") then:
            set "protein" to (aname)
        else:
            set "protein" to (join (protein) (join "-" (aname)))

when I start as a clone:
    set "clone" to 1
    set size to 40 %
    show
    repeat 6:
        change size by 10
    glide 0.6 secs to x: (x position) y: -55
    if ((k) > 0) then:
        set pen color to "#6a5a8a"
        set pen size to 8
        change x by -78
        pen down
        change x by 78
        pen up

when I receive "clear":
    if ((clone) = 1) then:
        delete this clone
`,
    Ribosome: `
when flag clicked:
    hide

when I receive "clear":
    hide

when I receive "translate":
    go to x: -156 y: 20
    set "ghost" effect to 10
    go to "front" layer
    show
    start sound "whoosh"
    show caption "TRANSLATION: the ribosome reads the mRNA three bases at a time. Each group of three is called a CODON."
    wait 3 seconds
    set "k" to 0
    set "done" to 0
    repeat until (((done) = 1) or ((((k) * 3) + 3) > (length of (mrna)))):
        glide 0.6 secs to x: (-156 + ((k) * 78)) y: 20
        set "codon" to (join (letter (((k) * 3) + 1) of (mrna)) (join (letter (((k) * 3) + 2) of (mrna)) (letter (((k) * 3) + 3) of (mrna))))
        set "n" to 0
        set "j" to 1
        repeat 3:
            set "v" to 0
            set "q" to 1
            repeat 4:
                if ((letter (q) of "UCAG") = (letter (j) of (codon))) then:
                    set "v" to ((q) - 1)
                change "q" by 1
            set "n" to (((n) * 4) + (v))
            change "j" by 1
        set "aa" to (letter ((n) + 1) of "${CODE}")
        if ((aa) = "*") then:
            set "done" to 1
            start sound "tada"
            show caption (join (join "Codon " (codon)) " is a STOP codon. The protein chain is finished, and it folds up into its working shape.")
        else:
            broadcast "add amino" and wait
            if ((codon) = "AUG") then:
                show caption "Codon AUG means Met (methionine). AUG is the START codon: building a protein begins here."
            else:
                show caption (join (join (join "Codon " (codon)) " means ") (join (aname) ". A transfer RNA brings that amino acid, and it joins the chain."))
            wait 2 seconds
        change "k" by 1
    wait 3 seconds
    if ((dna) = "${DNA_MUTANT}") then:
        show caption "One changed base swapped Glu for Val! A single change just like this, in the gene for hemoglobin, causes sickle cell disease. Press M to undo it."
    else:
        show caption "Protein built: Met-Pro-Glu-Phe. Real proteins are hundreds of amino acids long. Press M to make a MUTATION, or Q for a quiz."

when "q" key pressed:
    if ((busy) = 1) then:
        show caption "Wait for the protein to be finished, then press Q."
        stop "this script"
    set "score" to 0
    ask "Which RNA base pairs with A on the DNA?" and wait
    if (((answer) = "u") or ((answer) contains "uracil" ?)) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    ask "The DNA template reads TAC. What is the mRNA codon? (three letters)" and wait
    if ((answer) = "AUG") then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    ask "How many bases make up one codon?" and wait
    if (((answer) = 3) or ((answer) = "three")) then:
        change "score" by 1
        start sound "chime"
    else:
        start sound "hit"
    if ((score) = 3) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 3! (The answers: U, AUG, and 3.)")
`,
  },
  picture: [[700]],
  check: [{ frames: 1150 }, { expect: { protein: 'Met-Pro-Glu-Phe' } }, { press: 'q' }, { frames: 5 }, { answer: 'U' }, { frames: 5 }, { answer: 'aug' }, { frames: 5 }, { answer: '3' }, { frames: 10 },
    { expect: { score: 3 } }, { press: 'm' }, { frames: 1300 }, { expect: { protein: 'Met-Pro-Val-Phe' } }],
};

// =====================================================================================================
// 9. Peppered Moths: Natural Selection (grades 8-12, Simulation)
// =====================================================================================================

function barkPainter(sooty) {
  return (ctx, w, h) => {
    ctx.fillStyle = sooty ? '#36322e' : '#b9bfae';
    ctx.fillRect(0, 0, w, h);
    const r = rng(sooty ? 17 : 9);
    // Long vertical cracks in the bark.
    for (let i = 0; i < 70; i++) {
      const x = r() * w;
      ctx.strokeStyle = sooty ? 'rgba(10,10,10,0.55)' : 'rgba(80,85,70,0.45)'; ctx.lineWidth = 3 + r() * 6;
      ctx.beginPath(); ctx.moveTo(x, r() * h); ctx.quadraticCurveTo(x + (r() - 0.5) * 30, r() * h, x + (r() - 0.5) * 20, r() * h); ctx.stroke();
    }
    // Lichen blotches (pale) or soot patches.
    for (let i = 0; i < 260; i++) {
      const x = r() * w; const y = r() * h; const s = 6 + r() * 26;
      ctx.fillStyle = sooty
        ? (r() < 0.5 ? 'rgba(20,18,16,0.6)' : 'rgba(80,74,66,0.5)')
        : (r() < 0.5 ? 'rgba(230,232,214,0.7)' : (r() < 0.5 ? 'rgba(160,176,140,0.6)' : 'rgba(90,96,84,0.45)'));
      ctx.beginPath(); ctx.ellipse(x, y, s, s * (0.5 + r() * 0.6), r() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // The graph panel, top right.
    ctx.fillStyle = 'rgba(255,255,255,0.93)'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(540, 8, 412, 160, 12); ctx.fill(); ctx.stroke();
    text(ctx, '% of moths that are dark', 746, 26, 18, '#1e2a3a');
    ctx.strokeStyle = '#4a5a6a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(578, 40); ctx.lineTo(578, 148); ctx.lineTo(940, 148); ctx.stroke();
    ctx.setLineDash([6, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#9aa6b2';
    ctx.beginPath(); ctx.moveTo(578, 88); ctx.lineTo(940, 88); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 14px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#4a5a6a';
    ctx.fillText('100', 574, 46); ctx.fillText('50', 574, 88); ctx.fillText('0', 574, 146);
    text(ctx, 'generation  →', 870, 160, 14, '#4a5a6a', 'center', 600);
  };
}

function mothPainter(dark) {
  return paint(74, 54, (ctx) => {
    ctx.fillStyle = dark ? '#262321' : '#e9e5d8'; ctx.strokeStyle = dark ? '#121010' : '#8a8676'; ctx.lineWidth = 2;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(37, 18); ctx.lineTo(37 + s * 34, 10); ctx.lineTo(37 + s * 26, 42); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const r = rng(dark ? 4 : 8);
    ctx.fillStyle = dark ? 'rgba(90,84,76,0.8)' : 'rgba(30,28,24,0.85)';
    for (let i = 0; i < 30; i++) {
      const s = r() < 0.5 ? -1 : 1; const t = r(); const u = r();
      const x = 37 + s * (6 + t * 24); const y = 14 + u * 24 - t * 4;
      ctx.beginPath(); ctx.arc(x, y, 1.2 + r() * 1.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = dark ? '#1a1816' : '#c9c3b0';
    ctx.beginPath(); ctx.ellipse(37, 28, 5, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = dark ? '#1a1816' : '#8a8676'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(35, 13); ctx.lineTo(29, 3); ctx.moveTo(39, 13); ctx.lineTo(45, 3); ctx.stroke();
  });
}

const pepperedMoths = {
  id: 'peppered-moths', title: 'Peppered Moths: Natural Selection', kind: 'Simulation', grades: [8, 12], subject: 'Life Science',
  blurb: 'Be a hungry bird and eat the moths you can see. Then soot blackens the trees, and watch the moths change over the generations.',
  learn: 'How natural selection works: variation in a population, inheritance from parents, and predators removing the less well hidden, using the real story of peppered moths in industrial England.',
  backdrops: [{ name: 'Lichen bark', paint: barkPainter(false) }, { name: 'Sooty bark', paint: barkPainter(true) }],
  variables: { generation: 0, dark: 2, hunting: 0, alive: 0, darkAlive: 0, eaten: 0 },
  monitors: [['generation', 'normal', 8, 8], ['dark', 'normal', 8, 34]],
  sprites: [
    { name: 'Moth', costumes: [['light', mothPainter(false)], ['dark', mothPainter(true)]], x: 0, y: 0, visible: false, variables: { i: 1, isdark: 0, clone: 0, risk: 0 }, sounds: ['pop'] },
    { name: 'Bird', costumes: [['bird', emoji('🐦', 70)]], x: -230, y: 60, visible: false, rotationStyle: 'left-right', sounds: ['chirp'] },
    { name: 'Graph', costumes: [['pen', circle(3, '#1e2a3a', null)]], x: 0, y: 0, visible: false, variables: { col: 0 }, sounds: ['magic'] },
  ],
  scripts: {
    Stage: `
when "p" key pressed:
    next backdrop
    if ((backdrop "number") = 1) then:
        show caption "Clean air: lichen grows back and the bark is pale again. Which moths will be hidden now?"
    else:
        show caption "Soot again: the bark is black. Which moths will be hidden now?"
`,
    Moth: `
when flag clicked:
    hide
    set "clone" to 0

when I receive "spawn":
    if ((clone) = 0) then:
        set "i" to 1
        repeat 20:
            if ((i) > (dark)) then:
                set "isdark" to 0
            else:
                set "isdark" to 1
            go to x: (pick random -220 to 220) y: (pick random -100 to 85)
            create clone of "myself"
            change "i" by 1

when I start as a clone:
    set "clone" to 1
    if ((isdark) = 1) then:
        switch costume to "dark"
    else:
        switch costume to "light"
    point in direction (pick random -25 to 25)
    show

when this sprite clicked:
    if (((clone) = 1) and ((hunting) = 1)) then:
        start sound "pop"
        change "eaten" by 1
        delete this clone

when I receive "other birds":
    if ((clone) = 1) then:
        if ((((isdark) = 1) and ((backdrop "number") = 2)) or (((isdark) = 0) and ((backdrop "number") = 1))) then:
            set "risk" to 10
        else:
            set "risk" to 60
        if ((pick random 1 to 100) < ((risk) + 1)) then:
            repeat 5:
                change "ghost" effect by 20
            delete this clone
        change "alive" by 1
        if ((isdark) = 1) then:
            change "darkAlive" by 1

when I receive "clear moths":
    if ((clone) = 1) then:
        delete this clone
`,
    Bird: `
when flag clicked:
    hide
    go to "front" layer
    forever:
        if ((hunting) = 1) then:
            show
            go to x: ((mouse x) + 26) y: ((mouse y) + 22)

when I receive "other birds":
    start sound "chirp"
    point in direction 90
    go to x: -230 y: 70
    show
    glide 1.4 secs to x: 230 y: 10
    hide
    point in direction -90
`,
    Graph: `
when flag clicked:
    hide
    erase all
    switch backdrop to "Lichen bark"
    set "generation" to 0
    set "dark" to 2
    set "hunting" to 0
    set "eaten" to 0
    show caption "Peppered moths rest on tree bark by day. Some are pale and speckled, a few are dark. Birds eat the moths they can SEE."
    wait 4 seconds
    forever:
        change "generation" by 1
        if ((generation) = 5) then:
            switch backdrop to "Sooty bark"
            start sound "magic"
            show caption "1800s, England: factory smoke covers the trees in soot, and the bark turns black..."
            wait 4 seconds
        broadcast "spawn" and wait
        show caption (join (join "Generation " (generation)) ": you are a hungry bird! Click the moths you can see before time runs out.")
        set "hunting" to 1
        wait 4 seconds
        set "hunting" to 0
        set "alive" to 0
        set "darkAlive" to 0
        show caption "Other birds hunt too. They mostly catch the moths that stand out."
        broadcast "other birds" and wait
        if ((alive) > 0) then:
            set "dark" to (round ((20 * (darkAlive)) / (alive)))
        if (((dark) = 0) and ((pick random 1 to 2) = 1)) then:
            set "dark" to 1
        if (((dark) = 20) and ((pick random 1 to 3) = 1)) then:
            set "dark" to 19
        show caption (join (join "The survivors lay eggs, and the young look like their parents. In the next generation, " (dark)) " of 20 moths are dark.")
        set "col" to (((generation) - 1) mod 12)
        if (((col) = 0) and ((generation) > 1)) then:
            erase all
        set pen size to 11
        if ((backdrop "number") = 2) then:
            set pen color to "#3a3632"
        else:
            set pen color to "#a8b48e"
        go to x: (55 + ((col) * 15)) y: 107
        pen down
        go to x: (55 + ((col) * 15)) y: (107 + (2.7 * (dark)))
        pen up
        wait 3 seconds
        broadcast "clear moths" and wait
        if ((generation) = 12) then:
            show caption "The better-hidden moths survived and had more young, so over the generations the population changed. That is NATURAL SELECTION."
            wait 5 seconds
            show caption "This really happened near Manchester, England: dark moths were rare in the 1840s and most were dark by 1900. After clean-air laws, pale moths came back. Press P to clean the air."
            wait 6 seconds
`,
  },
  picture: [[2800]],
  check: [{ frames: 2900 }, { press: 'p' }, { frames: 300 }],
};

export default [plantParts, frogCycle, sortAnimals, energyPyramid, digestion, germDefenders, rabbitsFoxes, dnaProtein, pepperedMoths];
