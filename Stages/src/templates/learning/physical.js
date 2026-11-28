// Learning projects: physical. Written with ./kit.js; see featured.js for worked examples.
// Ids are PERSISTED in links (?project=<id>), so they are only ever added.
//
// Physics & Chemistry, nine projects:
//   sink-or-float (3-5)   magnet-pickup (3-5)   light-up-circuit (3-6)
//   archimedes-lever (5-8)   heat-it-up (6-8)   make-a-wave (6-8)
//   cannon-arc (9-12)   pendulum-lab (9-12)   build-an-atom (8-11)
//
// Every simulation uses the real relationship, stepped once a frame (30 a second): constant
// acceleration for the cannonball, the pendulum's equation of motion, real specific and latent heats
// for water, turning effect = weight x distance for the lever, frequency x wavelength = 343 m/s.
// Where a model simplifies, a caption says so.
import { emoji, label, circle, rect, paint } from './kit.js';

// --- shared painting ------------------------------------------------------------------------------

// Stage steps to backdrop pixels (a backdrop is painted at twice the stage's scale).
const PX = (x) => (x + 240) * 2;
const PY = (y) => (180 - y) * 2;

function gradient(ctx, w, h, top, bottom, from = 0, to = h) {
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, from, w, to - from);
}

function text(ctx, s, x, y, { px = 22, fill = '#1e2a3a', align = 'center', weight = 700, font = '"Fredoka", "Nunito", system-ui, sans-serif' } = {}) {
  ctx.font = `${weight} ${px}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

// A button: a label with a slightly smaller font, for clicking.
const button = (t, fill, ink = '#1e2a3a', px = 22) => label(t, fill, ink, px);

// ==================================================================================================
// 1. Sink or Float? (grades 3-5)
// ==================================================================================================

function tankBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#ffeccc', '#ffd59e');
  // A window with sky, and a shelf of beakers, for a classroom feel.
  ctx.fillStyle = '#9fd8ff';
  ctx.fillRect(40, 60, 170, 150);
  ctx.strokeStyle = '#b07a3e'; ctx.lineWidth = 10; ctx.strokeRect(40, 60, 170, 150);
  ctx.beginPath(); ctx.moveTo(125, 60); ctx.lineTo(125, 210); ctx.moveTo(40, 135); ctx.lineTo(210, 135); ctx.stroke();
  // The table.
  ctx.fillStyle = '#b07a3e';
  ctx.fillRect(0, PY(-100), w, 34);
  ctx.fillStyle = '#8a5a2b';
  ctx.fillRect(0, PY(-100) + 34, w, h);
  // The tank: glass x -120..160, from y 40 down to y -100. Water from y -10.
  const x0 = PX(-120), x1 = PX(160), yt = PY(40), yb = PY(-100), yw = PY(-10);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(x0, yt, x1 - x0, yw - yt);
  const water = ctx.createLinearGradient(0, yw, 0, yb);
  water.addColorStop(0, '#8fd3ff');
  water.addColorStop(1, '#3f9be6');
  ctx.fillStyle = water;
  ctx.fillRect(x0, yw, x1 - x0, yb - yw);
  // Sand and pebbles on the bottom.
  ctx.fillStyle = '#f2d59a';
  ctx.fillRect(x0, yb - 14, x1 - x0, 14);
  const rnd = seeded(3);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = ['#d9b56b', '#c79b55', '#e8c98a'][i % 3];
    ctx.beginPath(); ctx.arc(x0 + 10 + rnd() * (x1 - x0 - 20), yb - 6 - rnd() * 6, 3 + rnd() * 4, 0, Math.PI * 2); ctx.fill();
  }
  // Water weed.
  ctx.strokeStyle = '#3aa35a'; ctx.lineWidth = 8; ctx.lineCap = 'round';
  for (const bx of [x0 + 30, x1 - 26]) {
    ctx.beginPath(); ctx.moveTo(bx, yb - 10);
    ctx.bezierCurveTo(bx + 20, yb - 60, bx - 20, yb - 100, bx + 6, yb - 140); ctx.stroke();
  }
  // The glass walls and rim.
  ctx.strokeStyle = '#2a4a66'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(x0, yt); ctx.lineTo(x0, yb); ctx.lineTo(x1, yb); ctx.lineTo(x1, yt); ctx.stroke();
  ctx.fillStyle = '#2a4a66';
  ctx.fillRect(x0 - 10, yt - 8, 20, 12);
  ctx.fillRect(x1 - 10, yt - 8, 20, 12);
  // Shine on the glass.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x0 + 18, yt + 20); ctx.lineTo(x0 + 18, yt + 120); ctx.stroke();
  text(ctx, 'SINK or FLOAT?', PX(20), 44, { px: 40, fill: '#c2410c' });
}

function waterOverlay() {
  // Inside the glass, in front of the objects, so whatever is under the surface looks under water.
  return paint(552, 180, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(30, 110, 210, 0.30)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) ctx.lineTo(x, 3 + Math.sin(x / 18) * 3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const [x, y, r] of [[60, 120, 5], [72, 96, 3], [300, 140, 4], [470, 90, 5], [482, 66, 3]]) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  });
}

const SINK_FACTS = [
  'A ROCK sinks. Rock is DENSER than water: a lot of matter is packed into a small space.',
  'A toy DUCK floats. It is hollow and full of air, so overall it is LESS DENSE than water.',
  'An APPLE floats! Apples have lots of air inside them, so they are less dense than water.',
  'A metal KEY sinks. Metal is much denser than water, even when the key is small and light.',
  'A fresh EGG sinks in tap water. Stir in lots of salt and it can float, because salty water is denser.',
  'ICE floats, with most of it under the water. Water gets LESS dense when it freezes, which is unusual!',
];

const sinkOrFloat = {
  id: 'sink-or-float', title: 'Sink or Float?', kind: 'Game', grades: [3, 5], subject: 'Physics & Chemistry',
  blurb: 'Predict whether each thing will sink or float, then drop it in the tank and see if you were right.',
  learn: 'Whether something floats depends on its density compared with water, not just on its size or weight: air inside makes things less dense, metal and rock are denser.',
  backdrops: [{ name: 'Water Tank', paint: tankBackdrop }],
  variables: { score: 0, round: 0, waiting: 0, guess: 0, floats: 0, depth: 0, right: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sounds: ['tune-playful'],
  sprites: [
    { name: 'Thing', costumes: [['rock', emoji('🪨')], ['duck', emoji('🦆')], ['apple', emoji('🍎')], ['key', emoji('🔑')], ['egg', emoji('🥚')], ['ice', emoji('🧊')]], x: -80, y: 125, size: 80, visible: false, sounds: ['splash'] },
    { name: 'Water', costumes: [['water', waterOverlay()]], x: 20, y: -55 },
    { name: 'Float', costumes: [['button', button('FLOAT', '#7fd4ff', '#1e2a3a', 30)]], x: 200, y: 75, sounds: ['click'] },
    { name: 'Sink', costumes: [['button', button('SINK', '#d9a066', '#1e2a3a', 30)]], x: 200, y: 20, sounds: ['click'] },
    { name: 'Scientist', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'think'], x: -190, y: -40, size: 55, sounds: ['chime', 'boing', 'win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "round" to 0
    set "waiting" to 0
    show caption "Some things sink and some things float. Can you predict which?"
    play sound "tune-playful" until done
`,
    Water: `
when flag clicked:
    go to "front" layer
`,
    Thing: `
when flag clicked:
    hide
    erase all
    switch costume to "rock"
    set size to 80 %
    wait 5 seconds
    broadcast "next"

when I receive "next":
    change "round" by 1
    if ((round) > 6) then:
        broadcast "finish"
    else:
        if ((round) > 1) then:
            next costume
        set "floats" to 0
        set "depth" to -76
        if ((costume "number") = 2) then:
            set "floats" to 1
            set "depth" to -4
        if ((costume "number") = 3) then:
            set "floats" to 1
            set "depth" to -14
        if ((costume "number") = 6) then:
            set "floats" to 1
            set "depth" to -28
        go to x: (-80 + (43 * ((round) - 1))) y: 120
        show
        set "waiting" to 1
        show caption (join (join "Thing " (round)) " of 6. Will it FLOAT or SINK? Click a button (or press F or S).")
        repeat until ((waiting) = 0):
            change y by 3
            wait 0.25 seconds
            change y by -3
            wait 0.25 seconds
        set y to 120
        repeat until ((y position) < -8):
            change y by -7
        start sound "splash"
        if ((floats) = 1) then:
            repeat until ((y position) < ((depth) - 12)):
                change y by -2
            repeat until ((y position) > (depth)):
                change y by 1
        else:
            repeat until ((y position) < (depth)):
                change y by -1.5
        set y to (depth)
        set "right" to 0
        if ((guess) = (floats)) then:
            set "right" to 1
            change "score" by 1
        stamp
        hide
        broadcast "explain" and wait
        broadcast "next"
`,
    Float: `
when this sprite clicked:
    broadcast "guess float"

when "f" key pressed:
    broadcast "guess float"

when I receive "guess float":
    if ((waiting) = 1) then:
        set "guess" to 1
        set "waiting" to 0
        start sound "click"
        change size by 15
        wait 0.15 seconds
        change size by -15
`,
    Sink: `
when this sprite clicked:
    broadcast "guess sink"

when "s" key pressed:
    broadcast "guess sink"

when I receive "guess sink":
    if ((waiting) = 1) then:
        set "guess" to 0
        set "waiting" to 0
        start sound "click"
        change size by 15
        wait 0.15 seconds
        change size by -15
`,
    Scientist: `
when flag clicked:
    switch costume to "talk"
    say "Hi! I'm a scientist. Let's test six things in this water tank." for 2.5 seconds
    say "Before each one drops in, PREDICT: will it sink or float?" for 2.5 seconds
    switch costume to "idle"

when I receive "explain":
    if ((right) = 1) then:
        switch costume to "cheer0"
        start sound "chime"
        say "Yes! Good prediction!" for 1.5 seconds
    else:
        switch costume to "think"
        start sound "boing"
        say "Not this time. Let's find out why." for 1.5 seconds
    switch costume to "talk"
${SINK_FACTS.map((f, i) => `    if ((round) = ${i + 1}) then:\n        show caption "${f}"`).join('\n')}
    wait 4 seconds
    switch costume to "idle"

when I receive "finish":
    switch costume to "cheer0"
    start sound "win"
    say (join (join "You got " (score)) " out of 6!")
    show caption "Floating is about DENSITY, not size. A huge steel ship floats because it holds lots of air, while a tiny pebble sinks."
`,
  },
  picture: [[1500]],
  check: [{ frames: 170 }, { click: 'Sink' }, { frames: 280 }, { click: 'Float' }, { frames: 280 }, { click: 'Float' }, { frames: 280 },
    { press: 's' }, { frames: 280 }, { click: 'Sink' }, { frames: 280 }, { click: 'Float' }, { frames: 300 }, { expect: { score: 6, round: 7 } }],
};

// ==================================================================================================
// 2. Magnet Pick-Up (grades 3-5)
// ==================================================================================================

function playroomBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#cdeaff', '#eaf6ff', 0, 230);
  // Bunting.
  const flags = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c77dff'];
  ctx.strokeStyle = '#7a5a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, 30); ctx.quadraticCurveTo(480, 90, 960, 30); ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const x = 30 + i * 60, y = 30 + Math.sin((x / 960) * Math.PI) * 30;
    ctx.fillStyle = flags[i % flags.length];
    ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.lineTo(x + 18, y); ctx.lineTo(x, y + 34); ctx.closePath(); ctx.fill();
  }
  // A big green desk mat on a wooden table.
  ctx.fillStyle = '#c98b4f';
  ctx.fillRect(0, 220, w, h - 220);
  ctx.fillStyle = '#a86e38';
  for (let y = 250; y < h; y += 46) ctx.fillRect(0, y, w, 4);
  ctx.fillStyle = '#5fbf87';
  ctx.beginPath(); ctx.roundRect(40, 160, 880, 450, 30); ctx.fill();
  ctx.strokeStyle = '#2f8a5a'; ctx.lineWidth = 6; ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  for (let x = 80; x < 920; x += 40) { ctx.beginPath(); ctx.moveTo(x, 165); ctx.lineTo(x, 605); ctx.stroke(); }
  for (let y = 200; y < 610; y += 40) { ctx.beginPath(); ctx.moveTo(45, y); ctx.lineTo(915, y); ctx.stroke(); }
  text(ctx, 'MAGNET PICK-UP', 480, 120, { px: 40, fill: '#d6336c' });
}

function barMagnet(northLeft) {
  return paint(244, 74, (ctx) => {
    const [l, r] = northLeft ? ['#e53935', '#1e63d6'] : ['#1e63d6', '#e53935'];
    const [lt, rt] = northLeft ? ['N', 'S'] : ['S', 'N'];
    ctx.lineWidth = 5; ctx.strokeStyle = '#1e2a3a';
    ctx.fillStyle = l; ctx.beginPath(); ctx.roundRect(4, 4, 118, 66, [14, 0, 0, 14]); ctx.fill();
    ctx.fillStyle = r; ctx.beginPath(); ctx.roundRect(122, 4, 118, 66, [0, 14, 14, 0]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(4, 4, 236, 66, 14); ctx.stroke();
    text(ctx, lt, 63, 38, { px: 40, fill: '#ffffff' });
    text(ctx, rt, 181, 38, { px: 40, fill: '#ffffff' });
  });
}

// [name, emoji, x, y, magnetic, what it is made of, how it hangs off the magnet (dx, dy)]
const MAGNET_ITEMS = [
  ['Paper clip', '📎', -80, 35, 1, 'steel', -16, -38],
  ['Bolt', '🔩', 70, 50, 1, 'steel', 16, -40],
  ['Safety pin', '🧷', 90, -65, 1, 'steel', -4, -52],
  ['Wrench', '🔧', -110, -60, 1, 'steel', 20, -58],
  ['Pencil', '✏️', -5, -10, 0, 'wood', 0, 0],
  ['Teddy', '🧸', 175, -15, 0, 'cloth and stuffing', 0, 0],
  ['Cup', '🥤', -180, -62, 0, 'plastic', 0, 0],
];

const magnetPickup = {
  id: 'magnet-pickup', title: 'Magnet Pick-Up', kind: 'Game', grades: [3, 5], subject: 'Physics & Chemistry',
  blurb: 'Drive a magnet with the arrow keys and find out what it picks up. Then see two magnets attract and repel.',
  learn: 'Magnets pull on things made of iron and steel but not on wood, plastic or cloth; the pull gets stronger as they get closer; and opposite poles attract while like poles repel.',
  backdrops: [{ name: 'Playroom', paint: playroomBackdrop }],
  variables: { collected: 0 },
  monitors: [['collected', 'normal', 8, 8]],
  sounds: ['tune-upbeat'],
  sprites: [
    ...MAGNET_ITEMS.map(([name, em, x, y]) => ({ name, costumes: [[name, emoji(em, 80)]], x, y, size: 90, rotationStyle: "don't rotate", variables: { stuck: 0, told: 0 }, sounds: ['click'] })),
    { name: 'Magnet', costumes: [['magnet', emoji('🧲', 100)]], x: -200, y: 40, size: 100, sounds: ['win'] },
    { name: 'Bar A', costumes: [['N S', barMagnet(true)]], x: -110, y: 30, visible: false },
    { name: 'Bar B', costumes: [['N S', barMagnet(true)], ['S N', barMagnet(false)]], x: 130, y: 30, visible: false, variables: { v: 0, ready: 0 }, sounds: ['knock', 'boing', 'click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "collected" to 0
    show caption "Use the ARROW KEYS to move the magnet. Which things does it pick up?"
    wait until ((collected) = 4)
    show caption "You found all four! Magnets pull on IRON and STEEL. Not on wood, plastic or cloth, and not even on most other metals."
    wait 5 seconds
    broadcast "poles"
    play sound "tune-upbeat" until done
`,
    Magnet: `
when flag clicked:
    go to x: -200 y: 40
    show
    go to "front" layer
    forever:
        if (key "right arrow" pressed?) then:
            change x by 5
        if (key "left arrow" pressed?) then:
            change x by -5
        if (key "up arrow" pressed?) then:
            change y by 5
        if (key "down arrow" pressed?) then:
            change y by -5
        if ((x position) > 205) then:
            set x to 205
        if ((x position) < -205) then:
            set x to -205
        if ((y position) > 110) then:
            set y to 110
        if ((y position) < -85) then:
            set y to -85

when I receive "poles":
    start sound "win"
    hide
`,
    ...Object.fromEntries(MAGNET_ITEMS.map(([name, , x, y, magnetic, stuff, dx, dy]) => [name, `
when flag clicked:
    set "stuck" to 0
    set "told" to 0
    go to x: ${x} y: ${y}
    show
    forever:
        if ((stuck) = 1) then:
            go to x: (("x position" of "Magnet") + ${dx}) y: (("y position" of "Magnet") + ${dy})
        else:
${magnetic ? `            if ((distance to "Magnet") < 90) then:
                point towards "Magnet"
                move ((95 - (distance to "Magnet")) / 8) steps
                if ((distance to "Magnet") < 32) then:
                    set "stuck" to 1
                    change "collected" by 1
                    start sound "click"
                    say "Click! I'm ${stuff}." for 1.5 seconds` : `            if (((distance to "Magnet") < 80) and ((told) = 0)) then:
                set "told" to 1
                say "Not me! I'm made of ${stuff}." for 2 seconds
            if ((distance to "Magnet") > 130) then:
                set "told" to 0`}

when I receive "poles":
    hide
`])),
    'Bar A': `
when flag clicked:
    hide

when I receive "poles":
    go to x: -110 y: 30
    show
`,
    'Bar B': `
when flag clicked:
    hide
    set "ready" to 0

when I receive "poles":
    switch costume to "N S"
    go to x: 130 y: 30
    show
    show caption "These are BAR MAGNETS. Every magnet has a NORTH pole (N) and a SOUTH pole (S)."
    wait 3 seconds
    broadcast "test"

when this sprite clicked:
    if ((ready) = 1) then:
        set "ready" to 0
        start sound "click"
        next costume
        broadcast "test"

when I receive "test":
    set "ready" to 0
    if ((costume "number") = 1) then:
        show caption "Now NORTH faces SOUTH. Opposite poles ATTRACT: they pull together, faster as they get closer!"
        set "v" to 1
        repeat until ((x position) < 12):
            change "v" by 0.35
            change x by (0 - (v))
        set x to 10
        start sound "knock"
        say "Clack! Stuck together." for 2 seconds
    else:
        show caption "Now SOUTH faces SOUTH. Like poles REPEL: push them together and they push apart!"
        glide 1 secs to x: 14 y: 30
        set "v" to 12
        start sound "boing"
        repeat until ((v) < 0.3):
            change x by (v)
            set "v" to ((v) * 0.9)
        say "Whoosh! Pushed away." for 2 seconds
    show caption "Click the right-hand magnet to turn it round and try again. Opposites attract, likes repel."
    set "ready" to 1
`,
  },
  picture: [[90], [80, ['right arrow']], [22, ['down arrow']], [40, ['left arrow']]],
  check: [{ frames: 60 }, { frames: 80, keys: ['right arrow'] }, { frames: 22, keys: ['down arrow'] }, { frames: 84, keys: ['left arrow'] }, { frames: 40 },
    { expect: { collected: 4 } }, { frames: 400 }, { click: 'Bar B' }, { frames: 140 }],
};

// ==================================================================================================
// 3. Light Up the Bulb (grades 3-6)
// ==================================================================================================

// The loop: left x -170 (the battery), right x 90 (the switch), top y 110 (the bulb), bottom y -90 (the gap).
function circuitBackdrop(ctx, w, h) {
  const bg = ctx.createRadialGradient(400, 330, 60, 400, 330, 700);
  bg.addColorStop(0, '#1f4f7a');
  bg.addColorStop(1, '#0d2340');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.12)'; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Copper wires, with gaps where the bulb, the switch and the test gap go.
  ctx.strokeStyle = '#e8873a'; ctx.lineWidth = 12; ctx.lineCap = 'round';
  const L = PX(-170), R = PX(90), T = PY(120), B = PY(-55);
  const seg = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); };
  seg(L, PY(70), L, T); seg(L, T, PX(-62), T); seg(PX(-18), T, R, T);
  seg(R, T, R, PY(57)); seg(R, PY(3), R, B);
  seg(R, B, PX(-4), B); seg(PX(-76), B, L, B); seg(L, B, L, PY(-25));
  // The battery, standing on the left wire, + at the top.
  const bx = L, by0 = PY(70), by1 = PY(-25);
  ctx.fillStyle = '#ffd34a'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(bx - 34, by0, 68, (by1 - by0) * 0.45, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath(); ctx.roundRect(bx - 34, by0 + (by1 - by0) * 0.45, 68, (by1 - by0) * 0.55, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9ccd4'; ctx.fillRect(bx - 12, by0 - 12, 24, 12);
  text(ctx, '+', bx, by0 + 30, { px: 40 });
  text(ctx, '−', bx, by1 - 28, { px: 40, fill: '#ffffff' });
  // The gap's two clips.
  ctx.fillStyle = '#c9ccd4'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
  for (const x of [PX(-76), PX(-4)]) { ctx.beginPath(); ctx.roundRect(x - 10, B - 14, 20, 28, 5); ctx.fill(); ctx.stroke(); }
  // Labels.
  text(ctx, 'BATTERY', L + 80, PY(22), { px: 20, fill: '#ffd34a' });
  text(ctx, 'SWITCH', R - 50, PY(30), { px: 20, fill: '#9fe0ff', align: 'right' });
  text(ctx, 'TEST GAP', PX(-40), B - 36, { px: 20, fill: '#9fe0ff' });
  text(ctx, 'Test me!', PX(190), PY(125), { px: 26, fill: '#ffd34a' });
  ctx.strokeStyle = 'rgba(255,211,74,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.roundRect(PX(132), PY(108), PX(248) - PX(132), PY(-58) - PY(108), 18); ctx.stroke();
  ctx.setLineDash([]);
}

function bulb(on) {
  return paint(120, 150, (ctx) => {
    if (on) {
      const g = ctx.createRadialGradient(60, 56, 10, 60, 56, 60);
      g.addColorStop(0, 'rgba(255,240,150,0.95)');
      g.addColorStop(1, 'rgba(255,220,80,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 120, 120);
    }
    ctx.fillStyle = on ? '#fff176' : '#e3e7ee';
    ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(60, 56, 36, Math.PI * 0.8, Math.PI * 2.2); ctx.lineTo(76, 100); ctx.lineTo(44, 100); ctx.closePath(); ctx.fill(); ctx.stroke();
    // The filament.
    ctx.strokeStyle = on ? '#ff8f00' : '#7a7f8a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(50, 98); ctx.lineTo(50, 66); ctx.lineTo(56, 56); ctx.lineTo(62, 66); ctx.lineTo(68, 56); ctx.lineTo(70, 66); ctx.lineTo(70, 98); ctx.stroke();
    // The metal cap.
    ctx.fillStyle = '#b0b6c0'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(42, 100, 36, 30, 6); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(42, 110); ctx.lineTo(78, 110); ctx.moveTo(42, 120); ctx.lineTo(78, 120); ctx.stroke();
  });
}

function switchPicture(closed) {
  return paint(90, 120, (ctx) => {
    ctx.fillStyle = '#5a3a20'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(10, 8, 70, 104, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9ccd4';
    for (const y of [20, 100]) { ctx.beginPath(); ctx.arc(45, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.strokeStyle = '#e8873a'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(45, 100);
    if (closed) ctx.lineTo(45, 22); else ctx.lineTo(80, 36);
    ctx.stroke();
  });
}

// [name, emoji, x, y, conductor, made of]
const CIRCUIT_ITEMS = [
  ['Balloon', '🎈', 165, 80, 0, 'rubber'],
  ['Key', '🔑', 215, 80, 1, 'metal'],
  ['Coin', '🪙', 165, 25, 1, 'metal'],
  ['Cup', '🥤', 215, 25, 0, 'plastic'],
  ['Sock', '🧦', 165, -30, 0, 'wool'],
  ['Paper clip', '📎', 215, -30, 1, 'steel, a metal'],
];

const circuit = {
  id: 'light-up-circuit', title: 'Light Up the Bulb', kind: 'Simulation', grades: [3, 6], subject: 'Physics & Chemistry',
  blurb: 'Close the switch and test things in the gap. Which ones let electricity through to light the bulb?',
  learn: 'Electricity only flows around a complete loop called a circuit; a switch opens and closes the loop; metals are conductors and rubber, plastic and wool are insulators.',
  backdrops: [{ name: 'Circuit Board', paint: circuitBackdrop }],
  variables: { switch: 0, conductor: 0, lit: 0, tested: 0 },
  monitors: [['tested', 'normal', 8, 8]],
  sprites: [
    { name: 'Spark', costumes: [['spark', circle(7, '#ffe14a', '#fff8c2', 3)]], x: -170, y: 70, visible: false },
    { name: 'Bulb', costumes: [['off', bulb(false)], ['on', bulb(true)]], x: -40, y: 146, size: 80, sounds: ['power-up', 'power-down'] },
    { name: 'Switch', costumes: [['open', switchPicture(false)], ['closed', switchPicture(true)]], x: 90, y: 30, size: 90, sounds: ['click'] },
    ...CIRCUIT_ITEMS.map(([name, em, x, y, c]) => ({ name, costumes: [[name, emoji(em, 64)]], x, y, size: 100, variables: { inGap: 0, done: 0 }, sounds: ['pop'] })),
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "switch" to 0
    set "conductor" to 0
    set "lit" to 0
    set "tested" to 0
    show caption "A bulb lights only when electricity can flow all the way round a loop: a CIRCUIT. Click the switch to close it!"
`,
    Bulb: `
when flag clicked:
    switch costume to "off"
    forever:
        if (((switch) = 1) and ((conductor) = 1)) then:
            if ((lit) = 0) then:
                set "lit" to 1
                switch costume to "on"
                start sound "power-up"
                broadcast "flow"
                say "I'm lit! The circuit is complete." for 2 seconds
        else:
            if ((lit) = 1) then:
                set "lit" to 0
                switch costume to "off"
                start sound "power-down"
        wait 0.05 seconds
`,
    Spark: `
when flag clicked:
    hide

when I receive "flow":
    repeat until ((lit) = 0):
        create clone of "myself"
        wait 0.25 seconds

when I start as a clone:
    go to x: -170 y: 70
    go to "back" layer
    show
    point in direction 0
    repeat 10:
        move 5 steps
        if ((lit) = 0) then:
            delete this clone
    point in direction 90
    repeat 52:
        move 5 steps
        if ((lit) = 0) then:
            delete this clone
    point in direction 180
    repeat 35:
        move 5 steps
        if ((lit) = 0) then:
            delete this clone
    point in direction -90
    repeat 52:
        move 5 steps
        if ((lit) = 0) then:
            delete this clone
    point in direction 0
    repeat 6:
        move 5 steps
    delete this clone
`,
    Switch: `
when flag clicked:
    switch costume to "open"

when this sprite clicked:
    start sound "click"
    if ((switch) = 0) then:
        set "switch" to 1
        switch costume to "closed"
        show caption "Switch CLOSED. Now put something in the TEST GAP: click a thing on the right."
    else:
        set "switch" to 0
        switch costume to "open"
        show caption "Switch OPEN. There is a gap in the loop, so no electricity can flow."
`,
    ...Object.fromEntries(CIRCUIT_ITEMS.map(([name, , x, y, c, stuff]) => [name, `
when flag clicked:
    set "inGap" to 0
    set "done" to 0
    go to x: ${x} y: ${y}

when this sprite clicked:
    broadcast "clear gap" and wait
    set "inGap" to 1
    start sound "pop"
    glide 0.4 secs to x: -40 y: -55
    set "conductor" to ${c}
    if ((done) = 0) then:
        set "done" to 1
        change "tested" by 1
${c ? `    if ((switch) = 1) then:
        show caption "The ${name.toLowerCase()} is ${stuff}. Metals are CONDUCTORS: electricity flows through them, so the bulb lights."
    else:
        show caption "The ${name.toLowerCase()} is ${stuff}, a CONDUCTOR. But the switch is open! Close it to complete the circuit."` : `    show caption "The ${name.toLowerCase()} is ${stuff}: an INSULATOR. Electricity can't flow through it, so the bulb stays off."`}
    if ((tested) = 6) then:
        wait 4 seconds
        show caption "You tested all six! Metals conduct, while rubber, plastic and wool insulate. That's why wires are wrapped in plastic."

when I receive "clear gap":
    if ((inGap) = 1) then:
        set "inGap" to 0
        set "conductor" to 0
        glide 0.3 secs to x: ${x} y: ${y}
`])),
  },
  picture: [[20], [60]],
  check: [{ frames: 60 }, { click: 'Switch' }, { frames: 30 }, { click: 'Balloon' }, { frames: 60 }, { click: 'Sock' }, { frames: 60 }, { click: 'Cup' }, { frames: 60 },
    { click: 'Coin' }, { frames: 90 }, { click: 'Key' }, { frames: 90 }, { click: 'Paper clip' }, { frames: 200 }, { expect: { tested: 6, lit: 1 } }],
};

// ==================================================================================================
// 4. Archimedes' Lever (grades 5-8)
// ==================================================================================================

function syracuseBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#5ab4f0', '#d6f0ff', 0, 420);
  // The sea.
  gradient(ctx, w, h, '#2f8fe0', '#7cc6f5', 380, 470);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
  for (let i = 0; i < 12; i++) { const x = 40 + i * 80, y = 400 + (i % 3) * 20; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30, y); ctx.stroke(); }
  // A hill with a temple on it.
  ctx.fillStyle = '#c9b27c';
  ctx.beginPath(); ctx.moveTo(560, 470); ctx.quadraticCurveTo(760, 300, 960, 380); ctx.lineTo(960, 470); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(700, 300); ctx.lineTo(800, 262); ctx.lineTo(900, 300); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillRect(705, 300, 190, 10); ctx.strokeRect(705, 300, 190, 10);
  for (let i = 0; i < 6; i++) { ctx.fillRect(712 + i * 34, 312, 12, 58); ctx.strokeRect(712 + i * 34, 312, 12, 58); }
  ctx.fillRect(700, 370, 200, 10); ctx.strokeRect(700, 370, 200, 10);
  // Stone ground: y -85 is the top of the ground.
  ctx.fillStyle = '#e6cf98';
  ctx.fillRect(0, PY(-85), w, h);
  ctx.fillStyle = '#d6bb7c';
  for (let x = 0; x < w; x += 120) ctx.fillRect(x, PY(-85), 4, h);
  ctx.fillRect(0, PY(-85), w, 6);
  // Olive trees.
  for (const x of [60, 150]) {
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(x - 6, 400, 12, 70);
    ctx.fillStyle = '#7a9a4a'; ctx.beginPath(); ctx.ellipse(x, 390, 44, 30, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function fulcrumPicture() {
  return paint(144, 124, (ctx) => {
    ctx.fillStyle = '#8c8c96'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(72, 4); ctx.lineTo(140, 120); ctx.lineTo(4, 120); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b4b4be';
    ctx.beginPath(); ctx.moveTo(72, 20); ctx.lineTo(98, 66); ctx.lineTo(46, 66); ctx.closePath(); ctx.fill();
  });
}

const lever = {
  id: 'archimedes-lever', title: "Archimedes' Lever", kind: 'Story', grades: [5, 8], subject: 'Physics & Chemistry',
  blurb: 'Archimedes shows Maya how a plank and a pivot can lift a rock five times heavier than she is. Slide the fulcrum to do it.',
  learn: 'A lever turns about a fulcrum, and its turning effect is weight times distance from the fulcrum. Move the fulcrum close to a heavy load and a small effort far away can lift it.',
  backdrops: [{ name: 'Syracuse', paint: syracuseBackdrop }],
  variables: { f: 0, dL: 150, dR: 150, angle: 11, target: 11, 'rock turning': 225, 'Maya turning': 45, lifted: 0, balanced: 0 },
  monitors: [['rock turning', 'normal', 8, 8], ['Maya turning', 'normal', 8, 40]],
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'Plank', costumes: [['dot', circle(3, '#8a5a2b', null)]], x: 0, y: 0, visible: false },
    { name: 'Fulcrum', costumes: [['fulcrum', fulcrumPicture()]], x: 0, y: -55, sounds: ['click'] },
    { name: 'Rock', costumes: [['rock', emoji('🪨', 150)]], x: -150, y: 20, size: 85 },
    { name: 'Maya', lib: 'toon-maya', use: ['idle', 'cheer0', 'think', 'jump'], x: 150, y: 20, size: 45, sounds: ['tada'] },
    { name: 'Archimedes', lib: 'toon-leo', use: ['idle', 'talk', 'cheer0', 'think'], x: 205, y: -50, size: 50 },
    { name: 'Load', costumes: [['sign', label('LOAD 150 kg', '#ffc93c', '#1e2a3a', 20)]], x: -150, y: 100 },
    { name: 'Effort', costumes: [['sign', label('EFFORT 30 kg', '#8fd0ff', '#1e2a3a', 20)]], x: 150, y: 100 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "f" to 0
    set "lifted" to 0
    set "balanced" to 0
    show caption "Syracuse, on the island of Sicily, more than 2,200 years ago..."
    play sound "tune-wonder" until done

when flag clicked:
    wait 1 seconds
    forever:
        if (((target) = -11) and ((lifted) = 0)) then:
            set "lifted" to 1
            broadcast "lifted"
        if ((target) = 0) then:
            if ((balanced) = 0) then:
                set "balanced" to 1
                broadcast "balanced"
        else:
            set "balanced" to 0
        wait 0.1 seconds
`,
    Plank: `
when flag clicked:
    hide
    set "angle" to 11
    forever:
        set "dL" to ((f) + 150)
        set "dR" to (150 - (f))
        set "rock turning" to ((150 * (dL)) / 100)
        set "Maya turning" to ((30 * (dR)) / 100)
        if ((rock turning) > (Maya turning)) then:
            set "target" to 11
        else:
            if ((rock turning) < (Maya turning)) then:
                set "target" to -11
            else:
                set "target" to 0
        change "angle" by (((target) - (angle)) / 6)
        erase all
        set pen color to "#7a4a1f"
        set pen size to 14
        go to x: ((f) - ((dL) * ("cos" of (angle)))) y: (-19 - ((dL) * ("sin" of (angle))))
        pen down
        go to x: ((f) + ((dR) * ("cos" of (angle)))) y: (-19 + ((dR) * ("sin" of (angle))))
        pen up
        set pen color to "#c48a4a"
        set pen size to 5
        go to x: ((f) - ((dL) * ("cos" of (angle)))) y: (-16 - ((dL) * ("sin" of (angle))))
        pen down
        go to x: ((f) + ((dR) * ("cos" of (angle)))) y: (-16 + ((dR) * ("sin" of (angle))))
        pen up
`,
    Fulcrum: `
when flag clicked:
    forever:
        set x to (f)

when "left arrow" key pressed:
    if ((f) > -140) then:
        change "f" by -10
        start sound "click"

when "right arrow" key pressed:
    if ((f) < 140) then:
        change "f" by 10
        start sound "click"
`,
    Rock: `
when flag clicked:
    forever:
        go to x: (((f) - ((dL) * ("cos" of (angle)))) + 20) y: ((-19 - ((dL) * ("sin" of (angle)))) + 36)
`,
    Load: `
when flag clicked:
    forever:
        go to x: (("x position" of "Rock") - 10) y: (("y position" of "Rock") + 56)
`,
    Effort: `
when flag clicked:
    forever:
        go to x: (("x position" of "Maya") - 6) y: (("y position" of "Maya") + 72)
`,
    Maya: `
when flag clicked:
    switch costume to "think"
    forever:
        go to x: (((f) + ((dR) * ("cos" of (angle)))) - 14) y: ((-19 + ((dR) * ("sin" of (angle)))) + 32)

when I receive "balanced":
    switch costume to "idle"
    say "It's balanced! Our turning effects are equal." for 2.5 seconds

when I receive "lifted":
    start sound "tada"
    switch costume to "cheer0"
    say "I lifted it!" for 2 seconds
`,
    Archimedes: `
when flag clicked:
    switch costume to "talk"
    say "I am Archimedes, a thinker and inventor of Syracuse." for 3 seconds
    say "Maya weighs 30 kg. This rock is 150 kg: five times heavier!" for 3.5 seconds
    say "A plank on a pivot is a LEVER. The pivot is the FULCRUM." for 3.5 seconds
    show caption "Press the LEFT and RIGHT arrow keys to slide the fulcrum. Can you help Maya lift the rock?"
    say "Slide the fulcrum and watch the turning effects!" for 3 seconds
    switch costume to "think"

when I receive "balanced":
    show caption "BALANCED: 150 kg x 0.5 m = 30 kg x 2.5 m = 75. Turning effect = weight x distance from the fulcrum."

when I receive "lifted":
    switch costume to "cheer0"
    show caption "Lifted! Close to the fulcrum the heavy rock turns the plank less than light Maya does far away. Levers trade distance for force."
    wait 3 seconds
    say "Seesaws, crowbars and bottle openers are all levers." for 3.5 seconds
    say "I'm said to have boasted: give me a place to stand, and I will move the Earth!" for 4 seconds
    switch costume to "idle"
`,
  },
  picture: [[60], [120, ['left arrow']]],
  check: [{ frames: 200 }, { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' },
    { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' }, { press: 'left arrow' }, { frames: 90 },
    { expect: { balanced: 1, lifted: 0 } }, { press: 'left arrow' }, { frames: 200 }, { expect: { lifted: 1 } }],
};

// ==================================================================================================
// 5. Heat It Up: Ice, Water, Steam (grades 6-8)
// ==================================================================================================

// Real heats for 1 gram of water: ice warms at about 2.1 J per degree, melting takes about 334 J,
// water warms at about 4.18 J per degree, boiling takes about 2260 J, steam warms at about 2.0 J.
// From ice at -40 C: 84 J to reach 0 C, then 334 to melt (418), 418 to reach 100 C (836),
// 2260 to boil (3096), and 80 more for steam to reach 140 C (3176).
function labBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#e9f2ff', '#cfe0f5');
  // Tiles.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 520); ctx.stroke(); }
  for (let y = 0; y < 520; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // The bench.
  ctx.fillStyle = '#3a4a5c'; ctx.fillRect(0, PY(-112), w, h);
  ctx.fillStyle = '#56687e'; ctx.fillRect(0, PY(-112), w, 12);
  // The burner stand under the jar.
  ctx.strokeStyle = '#2a2f38'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(PX(-90), PY(-78)); ctx.lineTo(PX(-110), PY(-112)); ctx.moveTo(PX(90), PY(-78)); ctx.lineTo(PX(110), PY(-112));
  ctx.moveTo(PX(-100), PY(-78)); ctx.lineTo(PX(100), PY(-78)); ctx.stroke();
  // The sealed jar: x -100..100, y -75..140.
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.strokeStyle = '#3d6f99'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.roundRect(PX(-100), PY(140), PX(100) - PX(-100), PY(-75) - PY(140), 26); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3d6f99'; ctx.beginPath(); ctx.roundRect(PX(-108), PY(150), PX(108) - PX(-108), 26, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(PX(-82), PY(110)); ctx.lineTo(PX(-82), PY(20)); ctx.stroke();
  // The thermometer: x 175, from -40 C at y -78 to 140 C at y 129 (1.15 steps a degree).
  const tx = PX(175), ty = (t) => PY(-78 + (t + 40) * 1.15);
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(tx - 14, ty(150), 28, ty(-46) - ty(150), 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(tx, ty(-48), 20, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  for (let t = -40; t <= 140; t += 20) {
    ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(tx - 26, ty(t)); ctx.lineTo(tx - 16, ty(t)); ctx.stroke();
    const special = t === 0 || t === 100;
    text(ctx, `${t}°C`, tx - 32, ty(t), { px: special ? 22 : 17, fill: special ? '#c62828' : '#3a4a5c', align: 'right' });
  }
  text(ctx, 'melts', tx + 22, ty(0), { px: 17, fill: '#c62828', align: 'left' });
  text(ctx, 'boils', tx + 22, ty(100), { px: 17, fill: '#c62828', align: 'left' });
}

const STATE_CAPTIONS = [
  ['solid (ice)', 'solid', 'SOLID ice. The particles are locked in a pattern and can only vibrate. Hold the UP arrow to heat it (DOWN cools it).'],
  ['melting', 'melting', 'MELTING. The heat breaks particles free of the pattern, so the temperature STAYS at 0 °C until all the ice has melted!'],
  ['liquid (water)', 'liquid', 'LIQUID water. The particles slide past each other but stay close together. Now the heat warms the water up.'],
  ['boiling', 'boiling', 'BOILING. It takes more than 5 times as much heat to boil water away as to warm it from 0 to 100 °C, so this takes a while!'],
  ['gas (steam)', 'gas', 'GAS. The particles fly apart and fill the whole jar, moving fastest of all. (Real steam is invisible, and spreads out far more.)'],
];

const heatItUp = {
  id: 'heat-it-up', title: 'Heat It Up: Ice, Water, Steam', kind: 'Simulation', grades: [6, 8], subject: 'Physics & Chemistry',
  blurb: 'Heat a jar of ice and watch its particles. Why does the thermometer stop at 0 °C and at 100 °C?',
  learn: 'Solids, liquids and gases are the same particles moving in different ways; heating makes particles move faster; and while ice melts or water boils, the heat breaks particles apart instead of raising the temperature.',
  backdrops: [{ name: 'Lab', paint: labBackdrop }],
  variables: { temperature: -40, 'heat added': 0, state: '', melted: 0, steamed: 0, shown: '' },
  monitors: [['temperature', 'normal', 8, 8], ['heat added', 'normal', 8, 40], ['state', 'normal', 8, 72]],
  sprites: [
    { name: 'Particle', costumes: [['water', circle(17, '#4fb3ff', '#1a5fae', 4)]], x: 0, y: 0, visible: false, rotationStyle: "don't rotate", variables: { id: 0, lx: 0, ly: 0, mode: 0, speed: 0 } },
    { name: 'Mercury', costumes: [['dot', circle(3, '#e53935', null)]], x: 175, y: -86, visible: false },
    { name: 'Flame', costumes: [['flame', emoji('🔥', 80)]], x: 0, y: -93, visible: false },
    { name: 'Frost', costumes: [['frost', emoji('❄️', 70)]], x: 0, y: -93, visible: false },
    { name: 'State label', costumes: STATE_CAPTIONS.map(([, name], i) => [name, label(['SOLID', 'MELTING', 'LIQUID', 'BOILING', 'GAS'][i], ['#bfe6ff', '#d7f0ff', '#7fc8ff', '#ffd08a', '#ffb3c1'][i], '#1e2a3a', 26)]), x: -175, y: 10 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "shown" to ""
    forever:
        if (not ((state) = (shown))) then:
            set "shown" to (state)
            broadcast "state changed"
        wait 0.1 seconds
`,
    Mercury: `
when flag clicked:
    hide
    set "heat added" to 0
    set pen color to "#e53935"
    set pen size to 10
    forever:
        if (key "up arrow" pressed?) then:
            change "heat added" by 12
        if (key "down arrow" pressed?) then:
            change "heat added" by -12
        if ((heat added) < 0) then:
            set "heat added" to 0
        if ((heat added) > 3176) then:
            set "heat added" to 3176
        set "melted" to 1
        set "steamed" to 0
        if ((heat added) < 84) then:
            set "temperature" to ((round ((-40 + ((heat added) / 2.1)) * 10)) / 10)
            set "melted" to 0
            set "state" to "solid (ice)"
        else:
            if ((heat added) < 418) then:
                set "temperature" to 0
                set "melted" to (((heat added) - 84) / 334)
                set "state" to "melting"
            else:
                if ((heat added) < 836) then:
                    set "temperature" to ((round ((((heat added) - 418) / 4.18) * 10)) / 10)
                    set "state" to "liquid (water)"
                else:
                    if ((heat added) < 3096) then:
                        set "temperature" to 100
                        set "steamed" to (((heat added) - 836) / 2260)
                        set "state" to "boiling"
                    else:
                        set "temperature" to (100 + (((heat added) - 3096) / 2))
                        set "steamed" to 1
                        set "state" to "gas (steam)"
        erase all
        go to x: 175 y: -88
        pen down
        go to x: 175 y: (-78 + (((temperature) + 40) * 1.15))
        pen up
`,
    Particle: `
when flag clicked:
    hide
    set "id" to 0
    repeat 24:
        change "id" by 1
        create clone of "myself"

when I start as a clone:
    set "lx" to (-60 + (24 * (((id) - 1) mod 6)))
    set "ly" to (-55 + (24 * ("floor" of (((id) - 1) / 6))))
    go to x: (lx) y: (ly)
    show
    forever:
        set "speed" to (0.32 * ("sqrt" of ((temperature) + 273)))
        if (not (((id) / 24) > (steamed))) then:
            if (not ((mode) = 3)) then:
                set "mode" to 3
                point in direction (pick random -180 to 180)
            move (speed) steps
            if ((x position) > 82) then:
                set x to 82
                point in direction (0 - (direction))
            if ((x position) < -82) then:
                set x to -82
                point in direction (0 - (direction))
            if ((y position) > 122) then:
                set y to 122
                point in direction (180 - (direction))
            if ((y position) < -58) then:
                set y to -58
                point in direction (180 - (direction))
        else:
            if (not (((id) / 24) > (melted))) then:
                set "mode" to 2
                change x by ((pick random -10 to 10) * ((speed) / 20))
                change y by ((pick random -10 to 10) * ((speed) / 20))
                if ((x position) > 82) then:
                    set x to 82
                if ((x position) < -82) then:
                    set x to -82
                if ((y position) > 16) then:
                    change y by -6
                if ((y position) < -58) then:
                    set y to -58
            else:
                set "mode" to 1
                go to x: ((lx) + ((pick random -10 to 10) * ((speed) / 25))) y: ((ly) + ((pick random -10 to 10) * ((speed) / 25)))
`,
    Flame: `
when flag clicked:
    forever:
        if (key "up arrow" pressed?) then:
            show
            change size by (pick random -6 to 6)
            if ((size) > 110) then:
                set size to 100 %
            if ((size) < 85) then:
                set size to 100 %
        else:
            hide
`,
    Frost: `
when flag clicked:
    forever:
        if (key "down arrow" pressed?) then:
            show
            turn right 3 degrees
        else:
            hide
`,
    'State label': `
when I receive "state changed":
${STATE_CAPTIONS.map(([state, costume, cap]) => `    if ((state) = "${state}") then:\n        switch costume to "${costume}"\n        show caption "${cap}"`).join('\n')}
    repeat 2:
        change size by 12
        wait 0.1 seconds
        change size by -12
        wait 0.1 seconds
`,
  },
  picture: [[20], [200, ['up arrow']]],
  check: [{ frames: 30 }, { frames: 300, keys: ['up arrow'] }, { expect: { state: 'gas (steam)', temperature: 140 } }, { frames: 150, keys: ['down arrow'] }, { frames: 60 },
    { expect: { state: 'boiling', temperature: 100 } }],
};

// ==================================================================================================
// 6. Make a Wave: See Your Sound (grades 6-8)
// ==================================================================================================

function waveBackdrop(ctx, w, h) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a1458');
  bg.addColorStop(1, '#0c2a55');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // An oscilloscope grid behind the wave.
  ctx.strokeStyle = 'rgba(140, 220, 255, 0.14)'; ctx.lineWidth = 2;
  for (let x = PX(-170); x < w; x += 50) { ctx.beginPath(); ctx.moveTo(x, PY(105)); ctx.lineTo(x, PY(-35)); ctx.stroke(); }
  for (let y = PY(105); y <= PY(-35); y += 35) { ctx.beginPath(); ctx.moveTo(PX(-170), y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(140, 220, 255, 0.35)';
  ctx.beginPath(); ctx.moveTo(PX(-170), PY(35)); ctx.lineTo(w, PY(35)); ctx.stroke();
  // Music notes floating about.
  const rnd = seeded(11);
  for (let i = 0; i < 14; i++) text(ctx, ['♪', '♫', '♩'][i % 3], rnd() * w, 30 + rnd() * 560, { px: 26 + rnd() * 20, fill: `rgba(255,255,255,${0.08 + rnd() * 0.1})` });
}

const wave = {
  id: 'make-a-wave', title: 'Make a Wave: See Your Sound', kind: 'Art', grades: [6, 8], subject: 'Physics & Chemistry',
  blurb: 'Play notes and watch their sound waves. Higher notes squeeze the waves closer together; louder notes make them taller.',
  learn: 'A sound has a frequency (how many waves pass each second, heard as pitch) and an amplitude (heard as loudness); because sound travels at about 343 m/s, a higher frequency means a shorter wavelength.',
  backdrops: [{ name: 'Oscilloscope', paint: waveBackdrop }],
  variables: { note: 60, 'note name': 'C4', frequency: 262, wavelength: 1.31, amplitude: 50, wl: 131, shift: 0, exact: 261.6 },
  monitors: [['note name', 'normal', 8, 8], ['frequency', 'normal', 118, 8], ['wavelength', 'normal', 240, 8], ['amplitude', 'normal', 372, 8]],
  sprites: [
    { name: 'Speaker', costumes: [['speaker', emoji('🔊', 90)]], x: -205, y: 35, size: 80 },
    { name: 'Dot', costumes: [['dot', circle(8, '#ff5fa2', '#ffffff', 3)]], x: 0, y: 25, visible: false, variables: { i: 0 } },
    { name: 'Ruler', costumes: [['ruler', label('one wavelength', '#ffd34a', '#1e2a3a', 18)]], x: -100, y: 132 },
    { name: 'Lower', costumes: [['button', button('▼ lower', '#8fd0ff')]], x: -170, y: -66, sounds: ['click'] },
    { name: 'Higher', costumes: [['button', button('▲ higher', '#8fd0ff')]], x: -80, y: -66, sounds: ['click'] },
    { name: 'Quieter', costumes: [['button', button('quieter', '#b9f6ca')]], x: 15, y: -66, sounds: ['click'] },
    { name: 'Louder', costumes: [['button', button('LOUDER', '#b9f6ca')]], x: 110, y: -66, sounds: ['click'] },
    { name: 'Play', costumes: [['button', button('♪ play', '#ffd34a')]], x: 200, y: -66 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "note" to 60
    set "amplitude" to 50
    set "shift" to 0
    broadcast "retune"
    show caption "UP and DOWN arrows change the PITCH. LEFT and RIGHT change the LOUDNESS. SPACE plays the note."
    forever:
        change "shift" by 4

when I receive "retune":
    set "exact" to (440 * ("10 ^" of ((((note) - 69) / 12) * 0.30103)))
    set "frequency" to (round (exact))
    set "wavelength" to ((round ((343 / (exact)) * 100)) / 100)
    set "wl" to (100 * (343 / (exact)))
    set "note name" to (letter ((((note) mod 12) * 2) + 1) of "C-C#D-D#E-F-F#G-G#A-A#B-")
    if ((letter ((((note) mod 12) * 2) + 2) of "C-C#D-D#E-F-F#G-G#A-A#B-") = "#") then:
        set "note name" to (join (note name) "#")
    set "note name" to (join (note name) (("floor" of ((note) / 12)) - 1))

when "up arrow" key pressed:
    broadcast "higher"
when "down arrow" key pressed:
    broadcast "lower"
when "right arrow" key pressed:
    broadcast "louder"
when "left arrow" key pressed:
    broadcast "quieter"
when "space" key pressed:
    broadcast "play"

when I receive "higher":
    if ((note) < 79) then:
        change "note" by 1
        broadcast "retune" and wait
        broadcast "play"
        broadcast "explain"
when I receive "lower":
    if ((note) > 48) then:
        change "note" by -1
        broadcast "retune" and wait
        broadcast "play"
        broadcast "explain"
when I receive "louder":
    if ((amplitude) < 70) then:
        change "amplitude" by 10
        broadcast "play"
        show caption "LOUDER: the AMPLITUDE (the height of the wave) goes up, but the wavelength and the pitch stay the same."
when I receive "quieter":
    if ((amplitude) > 10) then:
        change "amplitude" by -10
        broadcast "play"
        show caption "QUIETER: a smaller AMPLITUDE. The air is squeezed less, so the sound carries less energy."

when I receive "explain":
    show caption (join (join (join (join (join (note name) " is about ") (frequency)) " waves a second (hertz), each ") (wavelength)) " m long. Frequency x wavelength = about 343 m/s, the speed of sound in air.")

when I receive "play":
    set volume to ((amplitude) + 20) %
    set instrument to "flute"
    play note (note) for 0.6 beats
`,
    Speaker: `
when I receive "play":
    repeat 2:
        change size by 10
        wait 0.08 seconds
        change size by -10
        wait 0.08 seconds
`,
    Dot: `
when flag clicked:
    hide
    set "i" to 0
    repeat 53:
        create clone of "myself"
        change "i" by 1

when I start as a clone:
    set x to (-170 + ((i) * 7.5))
    set "color" effect to ((i) * 3.5)
    show
    forever:
        set y to (35 + ((amplitude) * ("sin" of ((((x position) + 170) - (shift)) * (360 / (wl))))))
`,
    Ruler: `
when I receive "retune":
    erase all
    set pen color to "#ffd34a"
    set pen size to 4
    go to x: -170 y: 106
    pen down
    go to x: -170 y: 122
    go to x: -170 y: 114
    go to x: (-170 + (wl)) y: 114
    go to x: (-170 + (wl)) y: 122
    go to x: (-170 + (wl)) y: 106
    pen up
    go to x: (-170 + ((wl) / 2)) y: 133
`,
    ...Object.fromEntries(['Lower', 'Higher', 'Quieter', 'Louder', 'Play'].map((n) => [n, `
when this sprite clicked:
${n === 'Play' ? '' : '    start sound "click"\n'}    broadcast "${n.toLowerCase()}"
    change size by 10
    wait 0.1 seconds
    change size by -10
`])),
  },
  picture: [[20], [60]],
  check: [{ frames: 60 }, { press: 'up arrow' }, { press: 'up arrow' }, { press: 'up arrow' }, { press: 'up arrow' }, { press: 'up arrow' }, { frames: 40 },
    { click: 'Louder' }, { frames: 20 }, { press: 'space' }, { frames: 60 }, { click: 'Lower' }, { frames: 60 }, { expect: { note: 64, 'note name': 'E4', frequency: 330 } }],
};

// ==================================================================================================
// 7. Cannonball Arc (grades 9-12)
// ==================================================================================================

// 1 step = 1 metre. The cannon's pivot is at (-210, -60); the ground is y = -60.
function fieldBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#ffb36b', '#ffe8c2', 0, PY(-60));
  // Sun and far hills.
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(780, 120, 60, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d99a6c';
  ctx.beginPath(); ctx.moveTo(0, PY(-22)); ctx.quadraticCurveTo(250, PY(48), 500, PY(-12)); ctx.quadraticCurveTo(760, PY(-62), 960, PY(8)); ctx.lineTo(960, PY(-60)); ctx.lineTo(0, PY(-60)); ctx.fill();
  ctx.fillStyle = '#b07a52';
  ctx.beginPath(); ctx.moveTo(0, PY(-42)); ctx.quadraticCurveTo(400, PY(-12), 960, PY(-47)); ctx.lineTo(960, PY(-60)); ctx.lineTo(0, PY(-60)); ctx.fill();
  // Grass and soil.
  ctx.fillStyle = '#6cbf4a'; ctx.fillRect(0, PY(-60), w, 14);
  ctx.fillStyle = '#8a5a35'; ctx.fillRect(0, PY(-60) + 14, w, h);
  // Distance posts every 50 m.
  for (let m = 0; m <= 400; m += 50) {
    const x = PX(-210 + m);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, PY(-60) - 14, 4, 14);
    text(ctx, m === 0 ? '0 m' : `${m}`, x, PY(-60) + 30, { px: 17, fill: '#ffe8c2' });
  }
  // The wheel.
  ctx.fillStyle = '#5a3a20'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(PX(-210), PY(-52), 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 3;
  for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(PX(-210), PY(-52)); ctx.lineTo(PX(-210) + Math.cos(a) * 20, PY(-52) + Math.sin(a) * 20); ctx.stroke(); }
}

function barrel() {
  // Drawn from the canvas centre to the right, so it turns about its back end.
  return paint(200, 50, (ctx) => {
    const g = ctx.createLinearGradient(0, 8, 0, 42);
    g.addColorStop(0, '#6a7080'); g.addColorStop(0.5, '#2c3038'); g.addColorStop(1, '#4a4f5c');
    ctx.fillStyle = g; ctx.strokeStyle = '#11141a'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(92, 8); ctx.lineTo(190, 13); ctx.lineTo(190, 37); ctx.lineTo(92, 42); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(100, 25, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9a227'; ctx.fillRect(150, 11, 8, 28);
  });
}

const cannon = {
  id: 'cannon-arc', title: 'Cannonball Arc', kind: 'Game', grades: [9, 12], subject: 'Physics & Chemistry',
  blurb: 'Set the angle and speed, fire, and land the cannonball on the target. Every shot leaves its arc behind to compare.',
  learn: 'A projectile moves at a steady speed sideways while gravity changes its upward speed by 9.8 m/s every second, which makes a parabola; on flat ground with no air resistance the range is v² sin(2θ) / g, longest at 45°.',
  backdrops: [{ name: 'Firing Range', paint: fieldBackdrop }],
  variables: { angle: 45, speed: 40, range: 0, formula: 0, shots: 0, hits: 0, flying: 0, tx: 0 },
  monitors: [['angle', 'normal', 8, 8], ['speed', 'normal', 8, 40], ['range', 'normal', 8, 72], ['hits', 'normal', 395, 8]],
  sounds: ['explosion', 'win'],
  sprites: [
    { name: 'Ball', costumes: [['ball', circle(9, '#2c3038', '#11141a', 3)]], x: -210, y: -60, visible: false, variables: { vx: 0, vy: 0, px: 0, py: 0, land: 0 }, sounds: ['hit'] },
    { name: 'Cannon', costumes: [['barrel', barrel()]], x: -210, y: -52, direction: 45, sounds: ['explosion'] },
    { name: 'Target', costumes: [['target', emoji('🎯', 60)]], x: 0, y: -50, size: 100, sounds: ['tada'] },
    { name: 'Fire', costumes: [['button', button('FIRE!', '#ff6b4a', '#ffffff', 24)]], x: -195, y: 20 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "angle" to 45
    set "speed" to 40
    set "shots" to 0
    set "hits" to 0
    set "flying" to 0
    show caption "Land on the target! UP/DOWN: angle. LEFT/RIGHT: speed (m/s). SPACE or FIRE! to shoot. C clears the arcs."

when "up arrow" key pressed:
    if ((angle) < 85) then:
        change "angle" by 5
when "down arrow" key pressed:
    if ((angle) > 5) then:
        change "angle" by -5
when "right arrow" key pressed:
    if ((speed) < 60) then:
        change "speed" by 5
when "left arrow" key pressed:
    if ((speed) > 20) then:
        change "speed" by -5
when "space" key pressed:
    if ((flying) = 0) then:
        broadcast "fire"
`,
    Cannon: `
when flag clicked:
    forever:
        point in direction (90 - (angle))

when this sprite clicked:
    if ((flying) = 0) then:
        broadcast "fire"

when I receive "fire":
    start sound "explosion"
    repeat 2:
        move -4 steps
        wait 0.04 seconds
        move 4 steps
`,
    Fire: `
when this sprite clicked:
    if ((flying) = 0) then:
        broadcast "fire"
`,
    Ball: `
when flag clicked:
    hide
    erase all
    set pen color to "#7a2cff"

when "c" key pressed:
    erase all

when I receive "fire":
    set "flying" to 1
    change "shots" by 1
    go to x: -210 y: -60
    go to "back" layer
    set "vx" to ((speed) * ("cos" of (angle)))
    set "vy" to ((speed) * ("sin" of (angle)))
    change pen "color" by 23
    set pen size to 3
    show
    pen down
    repeat until ((y position) < -60):
        set "px" to (x position)
        set "py" to (y position)
        change x by ((vx) / 30)
        change y by (((vy) - (9.8 / 60)) / 30)
        change "vy" by (-9.8 / 30)
    set "land" to ((px) + (((x position) - (px)) * (((py) + 60) / ((py) - (y position)))))
    go to x: (land) y: -60
    pen up
    start sound "hit"
    stamp
    set "range" to (round ((land) + 210))
    set "formula" to (round ((((speed) * (speed)) * ("sin" of (2 * (angle)))) / 9.8))
    if (("abs" of ((land) - (tx))) < 12) then:
        change "hits" by 1
        broadcast "hit target"
    else:
        show caption (join (join (join (join "Landed " (range)) " m away. The formula v² × sin(2 × angle) ÷ 9.8 predicts ") (formula)) " m. Try 45°, then 30° and 60°!")
    hide
    set "flying" to 0
`,
    Target: `
when flag clicked:
    set "tx" to (pick random -60 to 150)
    go to x: (tx) y: -50
    show

when I receive "hit target":
    start sound "tada"
    show caption (join (join "BULLSEYE at " (range)) " m! Sideways the ball keeps a steady speed; upward, gravity takes 9.8 m/s off its speed every second.")
    repeat 3:
        change size by 25
        wait 0.1 seconds
        change size by -25
        wait 0.1 seconds
    wait 1 seconds
    set "tx" to (pick random -60 to 150)
    glide 0.5 secs to x: (tx) y: -50
`,
  },
  picture: [[30], [1, ['space']], [200], [1, ['up arrow']], [1, ['space']], [120]],
  check: [{ frames: 30 }, { press: 'space' }, { frames: 200 }, { expect: { shots: 1, range: 163, formula: 163 } }, { press: 'up arrow' }, { press: 'up arrow' }, { press: 'up arrow' },
    { press: 'space' }, { frames: 220 }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' },
    { click: 'Fire' }, { frames: 200 }, { expect: { shots: 3, angle: 30, formula: 141 } }],
};

// ==================================================================================================
// 8. The Pendulum Lab (grades 9-12)
// ==================================================================================================

// The pivot is at (0, 150) and 1 m of string is 150 steps.
function pendulumBackdrop(sky, skyLow, ground, groundLine, extra) {
  return (ctx, w, h) => {
    gradient(ctx, w, h, sky, skyLow, 0, PY(-95));
    if (extra) extra(ctx, w, h);
    ctx.fillStyle = ground; ctx.fillRect(0, PY(-95), w, h);
    ctx.fillStyle = groundLine; ctx.fillRect(0, PY(-95), w, 8);
    // The wooden stand.
    ctx.fillStyle = '#8a5a2b'; ctx.strokeStyle = '#4a2f16'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(PX(-130), PY(166), PX(130) - PX(-130), 24, 6); ctx.fill(); ctx.stroke();
    for (const x of [-130, 112]) { ctx.beginPath(); ctx.roundRect(PX(x), PY(166), 36, PY(-95) - PY(166), 6); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#c9ccd4'; ctx.beginPath(); ctx.arc(PX(0), PY(150), 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // A scale down the right post: metres below the pivot.
    for (let m = 0.25; m <= 1.5; m += 0.25) {
      const y = PY(150 - m * 150);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(PX(112) - 12, y - 2, 12, 4);
      text(ctx, `${m} m`, PX(112) - 18, y, { px: 16, fill: '#ffffff', align: 'right' });
    }
  };
}

const stars = (ctx, w) => {
  const rnd = seeded(5);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 120; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * 520, rnd() * 2 + 0.5, 0, Math.PI * 2); ctx.fill(); }
  // Earth in the Moon's sky.
  ctx.fillStyle = '#3d8be0'; ctx.beginPath(); ctx.arc(600, 170, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5fbf6a'; ctx.beginPath(); ctx.ellipse(591, 162, 12, 17, 0.5, 0, Math.PI * 2); ctx.fill();
};
const hills = (ctx) => {
  ctx.fillStyle = '#8fd17a';
  ctx.beginPath(); ctx.moveTo(0, PY(-60)); ctx.quadraticCurveTo(300, PY(10), 600, PY(-70)); ctx.quadraticCurveTo(800, PY(-30), 960, PY(-60)); ctx.lineTo(960, PY(-95)); ctx.lineTo(0, PY(-95)); ctx.fill();
};
const dunes = (ctx) => {
  ctx.fillStyle = '#b5542a';
  ctx.beginPath(); ctx.moveTo(0, PY(-55)); ctx.quadraticCurveTo(250, PY(-10), 520, PY(-65)); ctx.quadraticCurveTo(760, PY(-20), 960, PY(-70)); ctx.lineTo(960, PY(-95)); ctx.lineTo(0, PY(-95)); ctx.fill();
};

function planetPicture(kind) {
  return paint(110, 110, (ctx) => {
    const fill = { earth: '#3d8be0', moon: '#c9ccd4', mars: '#c1440e' }[kind];
    ctx.fillStyle = fill; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(55, 55, 48, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(55, 55, 46, 0, Math.PI * 2); ctx.clip();
    if (kind === 'earth') {
      ctx.fillStyle = '#5fbf6a';
      ctx.beginPath(); ctx.ellipse(40, 45, 18, 26, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(78, 72, 14, 18, -0.3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = kind === 'moon' ? '#9a9ea8' : '#8a2f0a';
      for (const [x, y, r] of [[38, 40, 10], [72, 62, 13], [48, 78, 7], [76, 32, 6]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  });
}

const pendulum = {
  id: 'pendulum-lab', title: 'The Pendulum Lab', kind: 'Simulation', grades: [9, 12], subject: 'Physics & Chemistry',
  blurb: 'Change the string, the weight of the bob and even the planet. What changes how long one swing takes?',
  learn: "A pendulum's period depends on its length and on gravity, T = 2π√(L/g), but not on its mass: four times the length doubles the period, and weaker gravity on the Moon or Mars slows it down.",
  backdrops: [
    { name: 'Earth', paint: pendulumBackdrop('#69b9f2', '#d9f1ff', '#5aa646', '#3e8a30', hills) },
    { name: 'Moon', paint: pendulumBackdrop('#05060d', '#1a1d2e', '#9a9ea8', '#7a7e88', stars) },
    { name: 'Mars', paint: pendulumBackdrop('#d99a6a', '#f2c9a0', '#a8441f', '#8a3014', dunes) },
  ],
  variables: { 'string length': 1, gravity: 9.8, 'formula period': 2.01, 'measured period': 0, theta: 20, omega: 0, frames: 0, last: 0, prev: 0, cross: 0 },
  monitors: [['string length', 'normal', 8, 8], ['gravity', 'normal', 8, 40], ['formula period', 'normal', 8, 72], ['measured period', 'normal', 8, 104]],
  sprites: [
    { name: 'Bob', costumes: [['light', circle(16, '#ffc93c', '#7a5a00', 5)], ['heavy', circle(28, '#8a8f9c', '#2c3038', 6)]], x: 0, y: 0, sounds: ['pop'] },
    { name: 'Planet', costumes: [['earth', planetPicture('earth')], ['moon', planetPicture('moon')], ['mars', planetPicture('mars')]], x: 195, y: 125, size: 90, sounds: ['whoosh'] },
    { name: 'Longer', costumes: [['button', button('▼ longer', '#ffd34a', '#1e2a3a', 20)]], x: 195, y: 40, sounds: ['click'] },
    { name: 'Shorter', costumes: [['button', button('▲ shorter', '#ffd34a', '#1e2a3a', 20)]], x: 195, y: 0, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    switch backdrop to "Earth"
    set "string length" to 1
    set "gravity" to 9.8
    broadcast "release"
    show caption "How long does one swing take? UP/DOWN keys (or the buttons): string length. Click the planet to change gravity, or the bob to change its mass."

when I receive "release":
    set "theta" to 20
    set "omega" to 0
    set "frames" to 0
    set "last" to 0
    set "measured period" to 0
    set "formula period" to ((round ((2 * (3.14159 * ("sqrt" of ((string length) / (gravity))))) * 100)) / 100)

when "down arrow" key pressed:
    broadcast "longer"
when "up arrow" key pressed:
    broadcast "shorter"

when I receive "longer":
    if ((string length) < 1.5) then:
        change "string length" by 0.25
        broadcast "release"
        show caption "A LONGER string swings more slowly. Make it 4 times longer and one swing takes 2 times as long: T = 2π√(L/g)."
when I receive "shorter":
    if ((string length) > 0.25) then:
        change "string length" by -0.25
        broadcast "release"
        show caption "A SHORTER string swings faster. The period goes with the square root of the length."
`,
    Bob: `
when flag clicked:
    switch costume to "light"
    set pen color to "#ffffff"
    set pen size to 3
    forever:
        change "omega" by (((0 - ((gravity) / (string length))) * ("sin" of (theta))) * (57.29578 / 30))
        set "prev" to (theta)
        change "theta" by ((omega) / 30)
        change "frames" by 1
        if (((prev) < 0) and (not ((theta) < 0))) then:
            set "cross" to (((frames) - 1) + ((0 - (prev)) / ((theta) - (prev))))
            if ((last) > 0) then:
                set "measured period" to ((round ((((cross) - (last)) / 30) * 100)) / 100)
            set "last" to (cross)
        erase all
        pen up
        go to x: 0 y: 150
        pen down
        go to x: ((150 * (string length)) * ("sin" of (theta))) y: (150 - ((150 * (string length)) * ("cos" of (theta))))
        pen up

when this sprite clicked:
    start sound "pop"
    next costume
    broadcast "release"
    if ((costume "number") = 2) then:
        show caption "A HEAVY bob, about 6 times the mass. Watch: the period stays the same! Mass cancels out (as long as air resistance is small)."
    else:
        show caption "A LIGHT bob again. Same string, same gravity, same period."
`,
    Planet: `
when flag clicked:
    switch costume to "earth"

when this sprite clicked:
    start sound "whoosh"
    next costume
    if ((costume "number") = 1) then:
        set "gravity" to 9.8
        switch backdrop to "Earth"
        show caption "EARTH: gravity is about 9.8 m/s². A 1 m pendulum takes about 2 seconds to swing there and back."
    if ((costume "number") = 2) then:
        set "gravity" to 1.62
        switch backdrop to "Moon"
        show caption "The MOON: gravity is about 1/6 of Earth's, so every pendulum swings about 2.5 times more slowly."
    if ((costume "number") = 3) then:
        set "gravity" to 3.71
        switch backdrop to "Mars"
        show caption "MARS: gravity is about 3.7 m/s². In 1656 Christiaan Huygens built the first pendulum clock. On Mars it would run slow!"
    broadcast "release"
`,
    Longer: `
when this sprite clicked:
    start sound "click"
    broadcast "longer"
`,
    Shorter: `
when this sprite clicked:
    start sound "click"
    broadcast "shorter"
`,
  },
  picture: [[140]],
  check: [{ frames: 160 }, { expect: { 'formula period': 2.01, 'measured period': 2.02 } }, { press: 'up arrow' }, { frames: 120 }, { click: 'Planet' }, { frames: 300 },
    { expect: { gravity: 1.62 } }, { click: 'Bob' }, { frames: 60 }],
};

// ==================================================================================================
// 9. Build an Atom (grades 8-11)
// ==================================================================================================

// The atom's centre is (-20, 10); the two shells have radii 60 and 100.
function atomBackdrop(ctx, w, h) {
  const bg = ctx.createRadialGradient(PX(-20), PY(10), 40, PX(-20), PY(10), 700);
  bg.addColorStop(0, '#3b1d6e');
  bg.addColorStop(1, '#0d0a24');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(17);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 90; i++) { ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, rnd() * 1.6 + 0.4, 0, Math.PI * 2); ctx.fill(); }
  ctx.setLineDash([12, 10]);
  ctx.lineWidth = 3;
  for (const [r, c] of [[120, 'rgba(120, 220, 255, 0.55)'], [200, 'rgba(120, 220, 255, 0.4)']]) {
    ctx.strokeStyle = c;
    ctx.beginPath(); ctx.arc(PX(-20), PY(10), r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  text(ctx, 'shell 1: up to 2', PX(-20), PY(10) - 132, { px: 15, fill: 'rgba(160,230,255,0.8)' });
  text(ctx, 'shell 2: up to 8', PX(-20), PY(10) - 212, { px: 15, fill: 'rgba(160,230,255,0.8)' });
}

function particle(fill, stroke, sign, r = 11) {
  return paint(r * 2 + 8, r * 2 + 8, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2 - r / 3, h / 2 - r / 3, 1, w / 2, h / 2, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, fill);
    g.addColorStop(1, stroke);
    ctx.fillStyle = g; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (sign) text(ctx, sign, w / 2, h / 2 + 1, { px: r * 1.5, fill: '#ffffff' });
  });
}

const ELEMENTS = [
  [1, 'H', 'Hydrogen', '#8fe08a'], [2, 'He', 'Helium', '#c8a8ff'], [3, 'Li', 'Lithium', '#ff9a8a'], [4, 'Be', 'Beryllium', '#ffc77a'],
  [5, 'B', 'Boron', '#7fe0d0'], [6, 'C', 'Carbon', '#8fe08a'], [7, 'N', 'Nitrogen', '#8fe08a'], [8, 'O', 'Oxygen', '#8fe08a'],
  [9, 'F', 'Fluorine', '#fff07a'], [10, 'Ne', 'Neon', '#c8a8ff'],
];

function elementTile([z, sym, name, fill]) {
  return paint(156, 176, (ctx) => {
    ctx.fillStyle = fill || '#3a3a52'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(5, 5, 146, 166, 14); ctx.fill(); ctx.stroke();
    if (!z) {
      text(ctx, '?', 78, 72, { px: 70, fill: '#ffffff' });
      text(ctx, 'no protons', 78, 138, { px: 19, fill: '#ffffff' });
      return;
    }
    text(ctx, String(z), 20, 26, { px: 24, align: 'left' });
    text(ctx, sym, 78, 82, { px: 68 });
    text(ctx, name, 78, 142, { px: name.length > 8 ? 19 : 22 });
  });
}

const ATOM_TASKS = [
  ['task1', 'Task 1: build a neutral HELIUM-4 atom', '((protons) = 2) and (((neutrons) = 2) and ((electrons) = 2))',
    'Not yet. Helium has 2 protons. "Helium-4" means protons + neutrons = 4. A neutral atom has as many electrons as protons.',
    'Helium! Its 2 protons are what make it helium. Mass number 2 + 2 = 4. It is the gas in party balloons.'],
  ['task2', 'Task 2: build a neutral CARBON-12 atom', '((protons) = 6) and (((neutrons) = 6) and ((electrons) = 6))',
    'Not yet. Carbon has 6 protons. Carbon-12: protons + neutrons = 12. A neutral atom needs 6 electrons too.',
    'Carbon-12! See how the 6 electrons fill shell 1 (2) and then shell 2 (4)? Carbon is in every living thing.'],
  ['task3', 'Task 3: turn it into CARBON-14, an isotope', '((protons) = 6) and (((neutrons) = 8) and ((electrons) = 6))',
    'Not yet. Carbon-14 is still carbon (6 protons), but its mass number is 14, so it has 14 - 6 = 8 neutrons.',
    'Carbon-14 is an ISOTOPE: the same element with more neutrons. Scientists use it to find the age of old wood and bones.'],
  ['task4', 'Task 4: make a lithium-7 ION, Li⁺', '((protons) = 3) and (((neutrons) = 4) and ((electrons) = 2))',
    'Not yet. Lithium has 3 protons and lithium-7 has 4 neutrons. For a +1 charge, have one electron fewer than protons.',
    'Li⁺ is an ION: it has lost an electron, so it has a charge of +1. Lithium ions carry the charge in phone batteries.'],
];

const ATOM_BUTTONS = [
  ['+ proton', 'add proton', '#ff8a8a', 125, 40], ['− proton', 'remove proton', '#ff8a8a', 200, 40],
  ['+ neutron', 'add neutron', '#c9ccd4', 125, 0], ['− neutron', 'remove neutron', '#c9ccd4', 200, 0],
  ['+ electron', 'add electron', '#8fd0ff', 125, -40], ['− electron', 'remove electron', '#8fd0ff', 200, -40],
];

// A nucleon's spot: a sunflower spiral, so the nucleus packs into a round ball as it grows.
const SLOT_X = '(-20 + ((6.5 * ("sqrt" of (slot))) * ("cos" of ((slot) * 137.5))))';
const SLOT_Y = '(10 + ((6.5 * ("sqrt" of (slot))) * ("sin" of ((slot) * 137.5))))';

function nucleonScript(kind, count, slot, max) {
  return `
when flag clicked:
    hide
    set "isClone" to 0
    set "rank" to 0

when I receive "add ${kind}":
    if ((isClone) = 0) then:
        set "rank" to (${count})
        create clone of "myself"

when I start as a clone:
    set "isClone" to 1
    set "slot" to (${slot})
    go to x: ${SLOT_X} y: ${SLOT_Y}
    set size to 30 %
    show
    repeat 7:
        change size by 10

when I receive "remove ${kind}":
    if (((isClone) = 1) and ((rank) = (${count}))) then:
        delete this clone
`;
}

const atom = {
  id: 'build-an-atom', title: 'Build an Atom', kind: 'Quiz', grades: [8, 11], subject: 'Physics & Chemistry',
  blurb: 'Add protons, neutrons and electrons to build real atoms, isotopes and ions, then check your work.',
  learn: 'The number of protons decides the element; protons + neutrons give the mass number; isotopes have different numbers of neutrons; and an ion has a charge because its electrons and protons do not balance.',
  backdrops: [{ name: 'Atom', paint: atomBackdrop }],
  variables: { protons: 0, neutrons: 0, electrons: 0, 'mass number': 0, charge: 0, task: 1, score: 0, spin: 0, element: '' },
  monitors: [['protons', 'normal', 8, 8], ['neutrons', 'normal', 8, 40], ['electrons', 'normal', 8, 72], ['mass number', 'normal', 8, 104], ['charge', 'normal', 8, 136], ['score', 'normal', 8, 168]],
  sounds: ['chime', 'win', 'hit'],
  sprites: [
    { name: 'Proton', costumes: [['proton', particle('#ff4d4d', '#a3121e', '+')]], x: -20, y: 10, visible: false, variables: { isClone: 0, rank: 0, slot: 0 } },
    { name: 'Neutron', costumes: [['neutron', particle('#c9ccd4', '#5a606c', '')]], x: -20, y: 10, visible: false, variables: { isClone: 0, rank: 0, slot: 0 } },
    { name: 'Electron', costumes: [['electron', particle('#4fc3ff', '#0b5fa8', '−', 8)]], x: -20, y: 70, visible: false, variables: { isClone: 0, rank: 0, r: 0, n: 0, a: 0 } },
    { name: 'Tile', costumes: [['none', elementTile([0])], ...ELEMENTS.map((e) => [e[2], elementTile(e)])], x: 162, y: 118, size: 85 },
    { name: 'Task', costumes: [...ATOM_TASKS.map(([c, t]) => [c, label(t, '#ffd34a', '#1e2a3a', 18)]), ['quiz', label('Last question!', '#ffd34a', '#1e2a3a', 18)], ['done', label('All done!', '#7ee08a', '#1e2a3a', 18)]], x: -20, y: 160 },
    ...ATOM_BUTTONS.map(([t, msg, fill, x, y]) => ({ name: t, costumes: [['button', button(t, fill, '#1e2a3a', 18)]], x, y, sounds: ['pop'] })),
    { name: 'Check', costumes: [['button', button('✔ Check my atom', '#7ee08a', '#1e2a3a', 20)]], x: 162, y: -88 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "protons" to 0
    set "neutrons" to 0
    set "electrons" to 0
    set "mass number" to 0
    set "charge" to 0
    set "task" to 1
    set "score" to 0
    show caption "Atoms are made of PROTONS (+), NEUTRONS (no charge) and ELECTRONS (−). Use the buttons to build the atom on the card."
    forever:
        change "spin" by 1
        wait 0.03 seconds

when I receive "update":
    set "mass number" to ((protons) + (neutrons))
    set "charge" to ((protons) - (electrons))

when I receive "check":
${ATOM_TASKS.map(([, , cond, hint, yes], i) => `    if ((task) = ${i + 1}) then:
        if (${cond}) then:
            start sound "chime"
            change "score" by 1
            show caption "${yes.replace(/"/g, "'")}"
            change "task" by 1
            broadcast "next task"
        else:
            start sound "hit"
            show caption "${hint.replace(/"/g, "'")}"
        stop "this script"`).join('\n')}

when I receive "next task":
    if ((task) = 5) then:
        wait 4 seconds
        ask "Last question: which particle decides which ELEMENT an atom is?" and wait
        if ((answer) contains "proton" ?) then:
            change "score" by 1
            start sound "win"
            show caption (join (join "Yes, PROTONS! Change the number of protons and you have a new element. You scored " (score)) " out of 5.")
        else:
            show caption (join (join "It's the PROTONS: their number is the atomic number. Neutrons make isotopes, electrons make ions. You scored " (score)) " out of 5.")
        change "task" by 1
`,
    Proton: nucleonScript('proton', 'protons', '((rank) * 2) - 1', 10),
    Neutron: nucleonScript('neutron', 'neutrons', '(rank) * 2', 12),
    Electron: `
when flag clicked:
    hide
    set "isClone" to 0
    set "rank" to 0

when I receive "add electron":
    if ((isClone) = 0) then:
        set "rank" to (electrons)
        create clone of "myself"

when I start as a clone:
    set "isClone" to 1
    show
    forever:
        if ((rank) < 3) then:
            set "r" to 60
            set "n" to (electrons)
            if ((n) > 2) then:
                set "n" to 2
            set "a" to ((((rank) - 1) * (360 / (n))) + ((spin) * 2))
        else:
            set "r" to 100
            set "n" to ((electrons) - 2)
            set "a" to ((((rank) - 3) * (360 / (n))) - (spin))
        go to x: (-20 + ((r) * ("cos" of (a)))) y: (10 + ((r) * ("sin" of (a))))

when I receive "remove electron":
    if (((isClone) = 1) and ((rank) = (electrons))) then:
        delete this clone
`,
    Tile: `
when flag clicked:
    switch costume to "none"
    set "element" to "none"

when I receive "update":
    switch costume to "none"
    repeat (protons):
        next costume
    if ((protons) > 0) then:
        set "element" to (costume "name")
    else:
        set "element" to "none"
`,
    Task: `
when flag clicked:
    switch costume to "task1"

when I receive "next task":
    repeat 3:
        change size by 10
        wait 0.08 seconds
        change size by -10
        wait 0.08 seconds
    wait 3 seconds
    next costume
`,
    ...Object.fromEntries(ATOM_BUTTONS.map(([t, msg]) => {
      const [verb, kind] = msg.split(' ');
      const count = `${kind}s`;
      const max = { proton: 10, neutron: 12, electron: 10 }[kind];
      return [t, `
when this sprite clicked:
    start sound "pop"
${verb === 'add' ? `    if ((${count}) < ${max}) then:
        change "${count}" by 1
        broadcast "add ${kind}"` : `    if ((${count}) > 0) then:
        broadcast "remove ${kind}" and wait
        change "${count}" by -1`}
    broadcast "update"
    change size by 8
    wait 0.08 seconds
    change size by -8
`];
    })),
    Check: `
when this sprite clicked:
    broadcast "check"
    change size by 8
    wait 0.1 seconds
    change size by -8
`,
  },
  picture: [[10]],
  check: [
    { frames: 30 },
    ...[['+ proton', 2], ['+ neutron', 2], ['+ electron', 2]].flatMap(([b, n]) => Array(n).fill({ click: b })), { click: 'Check' }, { frames: 120 },
    { expect: { score: 1, 'mass number': 4, charge: 0 } },
    ...[['+ proton', 4], ['+ neutron', 4], ['+ electron', 4]].flatMap(([b, n]) => Array(n).fill({ click: b })), { click: 'Check' }, { frames: 120 },
    { click: '+ neutron' }, { click: 'Check' }, { frames: 60 },
    { click: '+ neutron' }, { click: 'Check' }, { frames: 120 },
    ...[['− proton', 3], ['− neutron', 4], ['− electron', 4]].flatMap(([b, n]) => Array(n).fill({ click: b })),
    { expect: { charge: 1, 'mass number': 7, element: 'Lithium' } }, { click: 'Check' }, { frames: 150 },
    { answer: 'protons' }, { frames: 30 }, { expect: { score: 5 } },
  ],
};

export default [sinkOrFloat, magnetPickup, circuit, lever, heatItUp, wave, cannon, pendulum, atom];
