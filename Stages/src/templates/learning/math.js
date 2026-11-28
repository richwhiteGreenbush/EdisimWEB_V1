// Learning projects: math. Written with ./kit.js; see featured.js for worked examples.
// Ids are PERSISTED in links (?project=<id>), so they are only ever added.
//
// Every number a student reads here is worked out by the scripts (a fraction's simplest form, a
// polygon's turning angle, a die's percentage, a line's equation), never painted in, so changing a
// value in the scripts changes what the project says.
import { emoji, label, circle, rect, paint } from './kit.js';

// --- shared painting ------------------------------------------------------------------------------

// Stage (x, y) in steps to backdrop canvas pixels (a backdrop is 960 x 720, twice stage scale).
const PX = (x) => 480 + x * 2;
const PY = (y) => 360 - y * 2;

function gradient(ctx, w, h, top, bottom, from = 0, to = h) {
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, from, w, to - from);
}

function text(ctx, s, x, y, { font = '700 26px "Fredoka", "Nunito", system-ui, sans-serif', fill = '#1e2a3a', align = 'center', base = 'middle', stroke = null, lw = 6 } = {}) {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y); }
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
}

// A coordinate plane, one unit = 20 steps, origin in the middle of the stage. x runs -xMax..xMax,
// y runs yMin..yMax (it stops above the caption band).
function coordinatePlane(ctx, { xMax = 11, yMin = -5, yMax = 8, minor = '#cfd8e6', axis = '#1e2a3a', ink = '#24324a', every = 1, halo = null }) {
  const U = 40;
  ctx.lineWidth = 2;
  ctx.strokeStyle = minor;
  for (let u = -xMax; u <= xMax; u++) { ctx.beginPath(); ctx.moveTo(480 + u * U, 360 - yMax * U); ctx.lineTo(480 + u * U, 360 - yMin * U); ctx.stroke(); }
  for (let v = yMin; v <= yMax; v++) { ctx.beginPath(); ctx.moveTo(480 - xMax * U, 360 - v * U); ctx.lineTo(480 + xMax * U, 360 - v * U); ctx.stroke(); }
  ctx.strokeStyle = axis;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(480 - xMax * U - 10, 360); ctx.lineTo(480 + xMax * U + 10, 360);
  ctx.moveTo(480, 360 - yMin * U + 10); ctx.lineTo(480, 360 - yMax * U - 10);
  ctx.stroke();
  // Arrow heads and axis names.
  ctx.fillStyle = axis;
  const tri = (pts) => { ctx.beginPath(); ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.closePath(); ctx.fill(); };
  tri([[480 + xMax * U + 24, 360], [480 + xMax * U + 6, 350], [480 + xMax * U + 6, 370]]);
  tri([[480, 360 - yMax * U - 24], [470, 360 - yMax * U - 6], [490, 360 - yMax * U - 6]]);
  const f = '700 20px "Fredoka", "Nunito", system-ui, sans-serif';
  for (let u = -xMax; u <= xMax; u++) {
    if (!u || u % every) continue;
    text(ctx, String(u), 480 + u * U, 384, { font: f, fill: ink, stroke: halo, lw: 5 });
  }
  for (let v = yMin; v <= yMax; v++) {
    if (!v || v % every) continue;
    text(ctx, String(v), 466, 360 - v * U, { font: f, fill: ink, align: 'right', stroke: halo, lw: 5 });
  }
  text(ctx, '0', 466, 384, { font: f, fill: ink, align: 'right', stroke: halo, lw: 5 });
  text(ctx, 'x', 480 + xMax * U + 14, 334, { font: 'italic 700 28px Georgia, serif', fill: axis });
  text(ctx, 'y', 506, 360 - yMax * U - 12, { font: 'italic 700 28px Georgia, serif', fill: axis });
}

// An emoji drawn facing the other way (most fonts draw a turtle facing left).
function emojiFlipped(ch, px) {
  const [w, h, draw] = emoji(ch, px);
  return [w, h, (ctx, cw, ch2) => { ctx.translate(cw, 0); ctx.scale(-1, 1); draw(ctx, cw, ch2); }];
}

// --- 1. Pizza Fractions (grades 3-4) -------------------------------------------------------------

const PIZZA = { x: -70, y: 30 };

function pizzaBackdrop(ctx, w, h) {
  // A red and white checked tablecloth.
  ctx.fillStyle = '#fff4ec';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8504a';
  for (let y = 0; y < h; y += 60) for (let x = (y / 60) % 2 ? 60 : 0; x < w; x += 120) ctx.fillRect(x, y, 60, 60);
  ctx.fillStyle = 'rgba(232, 80, 74, 0.35)';
  for (let y = 0; y < h; y += 60) for (let x = (y / 60) % 2 ? 0 : 60; x < w; x += 120) ctx.fillRect(x, y, 60, 60);
  // The plate.
  const px = PX(PIZZA.x);
  const py = PY(PIZZA.y);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.arc(px + 10, py + 14, 258, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(px, py, 258, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c9d6e8'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(px, py, 236, 0, Math.PI * 2); ctx.stroke();
  // A little chalkboard: what the two numbers in a fraction mean.
  ctx.fillStyle = '#7a4a22';
  ctx.beginPath(); ctx.roundRect(650, 30, 290, 250, 16); ctx.fill();
  ctx.fillStyle = '#2f4a3a';
  ctx.beginPath(); ctx.roundRect(664, 44, 262, 222, 10); ctx.fill();
  const chalk = '#f4f1e8';
  text(ctx, 'A FRACTION', 795, 76, { font: '700 28px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#ffd34d' });
  text(ctx, '3', 720, 132, { font: '700 52px "Fredoka", "Nunito", system-ui, sans-serif', fill: chalk });
  ctx.strokeStyle = chalk; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(696, 168); ctx.lineTo(744, 168); ctx.stroke();
  text(ctx, '8', 720, 206, { font: '700 52px "Fredoka", "Nunito", system-ui, sans-serif', fill: chalk });
  const small = '600 20px "Fredoka", "Nunito", system-ui, sans-serif';
  text(ctx, '← slices eaten', 760, 124, { font: small, fill: chalk, align: 'left' });
  text(ctx, '(numerator)', 760, 148, { font: small, fill: '#b8e0c8', align: 'left' });
  text(ctx, '← equal slices', 760, 198, { font: small, fill: chalk, align: 'left' });
  text(ctx, '(denominator)', 760, 222, { font: small, fill: '#b8e0c8', align: 'left' });
}

// One slice of a pizza cut into d equal slices, painted on a canvas whose middle is the pizza's
// middle, so turning the sprite turns the slice round the centre of the pizza.
function sliceCostume(d) {
  return paint(460, 460, (ctx) => {
    const c = 230;
    const R = 216;
    const a = Math.PI / d;
    const mid = -Math.PI / 2;
    const wedge = (r) => { ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, r, mid - a, mid + a); ctx.closePath(); };
    wedge(R); ctx.fillStyle = '#d98a3a'; ctx.fill();
    wedge(R - 20); ctx.fillStyle = '#d8412f'; ctx.fill();
    wedge(R - 28); ctx.fillStyle = '#ffd34d'; ctx.fill();
    const at = (r, ang) => [c + r * Math.cos(mid + ang), c + r * Math.sin(mid + ang)];
    const pep = (r, ang, s) => {
      const [x, y] = at(r, ang);
      ctx.fillStyle = '#b8322a';
      ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a1f1a';
      for (const [dx, dy] of [[-0.35, -0.2], [0.3, 0.1], [-0.05, 0.4]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, s * 0.14, 0, Math.PI * 2); ctx.fill(); }
    };
    const basil = (r, ang) => {
      const [x, y] = at(r, ang);
      ctx.fillStyle = '#3f9e3a';
      ctx.beginPath(); ctx.ellipse(x, y, 9, 4, ang + 0.6, 0, Math.PI * 2); ctx.fill();
    };
    pep(R * 0.62, 0, d > 8 ? 15 : 19);
    if (d <= 8) {
      pep(R * 0.33, a * 0.4, 12);
      pep(R * 0.8, -a * 0.5, 15);
      basil(R * 0.82, a * 0.55);
      basil(R * 0.42, -a * 0.45);
    } else {
      basil(R * 0.36, 0);
    }
    wedge(R); ctx.lineWidth = 5; ctx.strokeStyle = '#5a3418'; ctx.lineJoin = 'round'; ctx.stroke();
  });
}

const pizzaFractions = {
  id: 'pizza-fractions', title: 'Pizza Fractions', kind: 'Game', grades: [3, 4], subject: 'Math',
  blurb: 'Cut a pizza into equal slices, click slices to eat them, and see the fraction you ate. Press Q for a pizza quiz.',
  learn: 'A fraction is part of a whole: the bottom number (denominator) is how many equal parts, the top number (numerator) is how many you have. Different fractions like 4/8 and 1/2 can be the same amount.',
  backdrops: [{ name: 'Pizza Table', paint: pizzaBackdrop }],
  variables: { slices: 8, eaten: 0, g: 1, score: 0 },
  monitors: [['slices', 'normal', 8, 8], ['eaten', 'normal', 8, 38]],
  sprites: [
    { name: 'Slice', costumes: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((d) => [`d${d}`, sliceCostume(d)]), x: PIZZA.x, y: PIZZA.y, size: 100, rotationStyle: 'all around', variables: { k: 0, isClone: 0, gone: 0 }, sounds: ['pop', 'bubble'] },
    { name: 'Chef', lib: 'toon-sam', use: ['idle', 'talk', 'cheer0', 'think'], x: 178, y: -50, size: 58, sounds: ['tada', 'hit', 'win'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "slices" to 8
    set "eaten" to 0
    set "score" to 0
    show caption "Press UP or DOWN to cut the pizza into more or fewer EQUAL slices. Click a slice to eat it!"
    broadcast "cut"

when "up arrow" key pressed:
    if ((slices) < 12) then:
        change "slices" by 1
        set "eaten" to 0
        broadcast "cut"

when "down arrow" key pressed:
    if ((slices) > 2) then:
        change "slices" by -1
        set "eaten" to 0
        broadcast "cut"
`,
    Slice: `
when I receive "cut":
    if ((isClone) = 1) then:
        delete this clone
    set "gone" to 0
    clear graphic effects
    switch costume to "d2"
    repeat ((slices) - 2):
        next costume
    set "k" to 0
    point in direction 90
    show
    repeat ((slices) - 1):
        change "k" by 1
        create clone of "myself"

when I start as a clone:
    set "isClone" to 1
    point in direction (90 + ((k) * (360 / (slices))))

when this sprite clicked:
    if ((gone) = 0) then:
        set "gone" to 1
        set "ghost" effect to 75
        change "eaten" by 1
        start sound "pop"
    else:
        set "gone" to 0
        set "ghost" effect to 0
        change "eaten" by -1
        start sound "bubble"
    broadcast "count"
`,
    Chef: `
when I receive "cut":
    switch costume to "talk"
    say (join (join (join (join "I cut it into " (slices)) " equal slices. Each slice is 1/") (slices)) " of the pizza.")

when I receive "count":
    if ((eaten) = 0) then:
        switch costume to "talk"
        say "Nothing eaten yet: 0 slices. Click a slice!"
    else:
        show caption "The bottom number is how many EQUAL slices. The top number is how many you ate."
        set "g" to (eaten)
        repeat until ((((slices) mod (g)) = 0) and (((eaten) mod (g)) = 0)):
            change "g" by -1
        if ((eaten) = (slices)) then:
            switch costume to "cheer0"
            start sound "tada"
            say (join (join (join (join "You ate " (eaten)) "/") (slices)) ". That is 1 WHOLE pizza!")
        else:
            if ((g) > 1) then:
                switch costume to "cheer0"
                say (join (join (join (join (join (join (join "You ate " (eaten)) "/") (slices)) ". That is the SAME amount as ") ((eaten) / (g))) "/") ((slices) / (g)))
            else:
                switch costume to "talk"
                say (join (join (join (join "You ate " (eaten)) "/") (slices)) " of the pizza.")

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "A pizza has 8 equal slices. You eat 3. What fraction did you eat? (like 1/2)" and wait
    if ((answer) = "3/8") then:
        change "score" by 1
        start sound "win"
        say "Yes! 3 out of 8 slices is 3/8." for 2 seconds
    else:
        start sound "hit"
        say "It's 3/8: 3 slices eaten out of 8 equal slices." for 3 seconds
    ask "Which is MORE pizza: 1/2 or 1/4?" and wait
    if ((answer) = "1/2") then:
        change "score" by 1
        start sound "win"
        say "Right! Cut into 2, each slice is much bigger than when it's cut into 4." for 3 seconds
    else:
        start sound "hit"
        say "It's 1/2. Fewer slices means BIGGER slices." for 3 seconds
    ask "4/8 is the same as 1 over what? Type the bottom number." and wait
    if ((answer) = 2) then:
        change "score" by 1
        start sound "win"
        say "Yes! 4/8 = 1/2. Try it: cut 8 slices and eat 4." for 3 seconds
    else:
        start sound "hit"
        say "It's 2: 4/8 = 1/2, half the pizza." for 3 seconds
    ask "You eat all 6 slices of a 6-slice pizza. What fraction is that?" and wait
    if (((answer) = "6/6") or ((answer) = 1)) then:
        change "score" by 1
        start sound "win"
        say "Yes! 6/6 is one whole pizza." for 2 seconds
    else:
        start sound "hit"
        say "It's 6/6, which is 1 whole." for 3 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 4!")
`,
  },
  picture: [[60]],
  check: [{ frames: 40 }, { press: 'down arrow' }, { frames: 20 }, { press: 'down arrow' }, { frames: 20 }, { press: 'up arrow' }, { frames: 30 },
    { expect: { slices: 7 } }, { press: 'up arrow' }, { frames: 30 }, { click: 'Slice' }, { frames: 10 }, { expect: { slices: 8, eaten: 1, g: 1 } },
    { press: 'q' }, { frames: 10 }, { answer: '3/8' }, { frames: 70 }, { answer: '1/2' }, { frames: 100 }, { answer: '2' }, { frames: 100 }, { answer: '6/6' }, { frames: 80 },
    { expect: { score: 4 } }],
};

// --- 2. The Array Garden (grades 3-4) ------------------------------------------------------------

function gardenBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#8fd3ff', '#d8f2ff', 0, 200);
  ctx.fillStyle = '#7cc95a';
  ctx.fillRect(0, 160, w, h - 160);
  ctx.fillStyle = '#6ab84b';
  for (let i = 0; i < 70; i++) { const x = (i * 137) % w; const y = 180 + ((i * 89) % 540); ctx.beginPath(); ctx.ellipse(x, y, 14, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  // Hills behind.
  ctx.fillStyle = '#5fb04a';
  ctx.beginPath(); ctx.moveTo(0, 170); ctx.quadraticCurveTo(250, 90, 520, 170); ctx.quadraticCurveTo(760, 100, 960, 170); ctx.lineTo(960, 200); ctx.lineTo(0, 200); ctx.fill();
  // The soil bed the flowers are planted in.
  ctx.fillStyle = '#7a4f2a';
  ctx.beginPath(); ctx.roundRect(28, 44, 616, 552, 18); ctx.fill();
  ctx.fillStyle = '#8f5e33';
  ctx.beginPath(); ctx.roundRect(40, 56, 592, 528, 12); ctx.fill();
  // A furrow under every possible row.
  ctx.strokeStyle = '#6b4322'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (let r = 0; r < 9; r++) { const y = PY(140 - r * 30) + 16; ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(616, y); ctx.stroke(); }
  // A wooden fence round the bed.
  ctx.fillStyle = '#f3e2c0'; ctx.strokeStyle = '#8a6a3f'; ctx.lineWidth = 3;
  for (let x = 20; x <= 650; x += 42) { ctx.beginPath(); ctx.roundRect(x, 600, 18, 46, 4); ctx.fill(); ctx.stroke(); }
  ctx.fillRect(16, 614, 640, 10);
  // Little signs: which way are rows and columns?
  text(ctx, 'COLUMNS →', 336, 26, { font: '700 24px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#1e2a3a', stroke: '#ffffff' });
  ctx.save(); ctx.translate(14, 320); ctx.rotate(Math.PI / 2);
  text(ctx, 'ROWS →', 0, 0, { font: '700 22px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#1e2a3a', stroke: '#ffffff' });
  ctx.restore();
}

const arrayGarden = {
  id: 'array-garden', title: 'The Array Garden', kind: 'Simulation', grades: [3, 4], subject: 'Math',
  blurb: 'Plant flowers in rows and columns. Change the rows and columns with the arrow keys and count by rows to multiply.',
  learn: 'Multiplication as an array: rows × columns = total. Skip counting by rows gives the same answer, turning the array round (3 × 5 and 5 × 3) does not change the product, and an array can show division too.',
  backdrops: [{ name: 'Garden', paint: gardenBackdrop }],
  variables: { rows: 3, columns: 5, planted: 0, counting: '', temp: 0, turned: 0, score: 0 },
  monitors: [['rows', 'normal', 340, 8], ['columns', 'normal', 340, 38]],
  sprites: [
    { name: 'Flower', costumes: [['tulip', emoji('🌷', 60)], ['sunflower', emoji('🌻', 60)], ['blossom', emoji('🌸', 60)], ['daisy', emoji('🌼', 60)]], x: -200, y: 140, size: 80, variables: { r: 0, c: 0 }, sounds: ['pop'] },
    { name: 'Gardener', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'think'], x: 175, y: -45, size: 50, sounds: ['win', 'hit', 'chime'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "rows" to 3
    set "columns" to 5
    set "turned" to 0
    set "score" to 0
    show caption "UP and DOWN change the ROWS. LEFT and RIGHT change the COLUMNS. Press T to turn the garden, Q for a quiz."
    broadcast "plant"

when "up arrow" key pressed:
    if ((rows) < 9) then:
        change "rows" by 1
        set "turned" to 0
        broadcast "plant"

when "down arrow" key pressed:
    if ((rows) > 1) then:
        change "rows" by -1
        set "turned" to 0
        broadcast "plant"

when "right arrow" key pressed:
    if ((columns) < 9) then:
        change "columns" by 1
        set "turned" to 0
        broadcast "plant"

when "left arrow" key pressed:
    if ((columns) > 1) then:
        change "columns" by -1
        set "turned" to 0
        broadcast "plant"

when "t" key pressed:
    set "temp" to (rows)
    set "rows" to (columns)
    set "columns" to (temp)
    set "turned" to 1
    broadcast "plant"
`,
    Flower: `
when I receive "plant":
    erase all
    show
    set "planted" to 0
    set "counting" to ""
    set "r" to 0
    repeat (rows):
        switch costume to "tulip"
        repeat ((r) mod 4):
            next costume
        set "c" to 0
        repeat (columns):
            go to x: (-200 + ((c) * 34)) y: (140 - ((r) * 30))
            stamp
            change "planted" by 1
            change "c" by 1
        start sound "pop"
        change "r" by 1
        if ((r) = 1) then:
            set "counting" to (planted)
        else:
            set "counting" to (join (join (counting) ", ") (planted))
        broadcast "row done"
    hide
    broadcast "planted"
`,
    Gardener: `
when I receive "row done":
    switch costume to "talk"
    say (join "Count by rows: " (counting))

when I receive "planted":
    switch costume to "cheer0"
    start sound "chime"
    say (join (join (join (join (join (join (rows) " rows of ") (columns)) " = ") (planted)) " flowers. ") (join (join (join (join (rows) " × ") (columns)) " = ") ((rows) * (columns))))
    if ((turned) = 1) then:
        show caption (join (join (join (join "Turned round, it is " (rows)) " × ") (columns)) ", and still the same number of flowers. Order doesn't change the product!")
    else:
        show caption (join (join (join (join (join "Count the ARRAY by rows: " (counting)) ". So ") (rows)) " × ") (join (join (columns) " = ") (planted)))

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "A garden has 4 rows with 6 flowers in each row. How many flowers?" and wait
    set "rows" to 4
    set "columns" to 6
    set "turned" to 0
    if ((answer) = ((rows) * (columns))) then:
        change "score" by 1
        start sound "win"
    else:
        start sound "hit"
    broadcast "plant" and wait
    say "4 rows of 6: 6, 12, 18, 24. That's 24!" for 3 seconds
    switch costume to "think"
    ask "Another garden has 6 rows of 4. How many flowers is that?" and wait
    set "rows" to 6
    set "columns" to 4
    set "turned" to 1
    if ((answer) = ((rows) * (columns))) then:
        change "score" by 1
        start sound "win"
    else:
        start sound "hit"
    broadcast "plant" and wait
    say "6 × 4 = 24 too. It's the same array, turned round!" for 3 seconds
    switch costume to "think"
    ask "I plant 12 flowers in 3 equal rows. How many go in each row?" and wait
    set "rows" to 3
    set "columns" to (12 / (rows))
    set "turned" to 0
    if ((answer) = (columns)) then:
        change "score" by 1
        start sound "win"
    else:
        start sound "hit"
    broadcast "plant" and wait
    say "12 ÷ 3 = 4, because 3 × 4 = 12. Arrays show dividing too!" for 3 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 3!")
`,
  },
  picture: [[90]],
  check: [{ frames: 60 }, { expect: { planted: 15 } }, { press: 'up arrow' }, { frames: 60 }, { expect: { planted: 20, counting: '5, 10, 15, 20' } },
    { press: 't' }, { frames: 60 }, { expect: { rows: 5, columns: 4, planted: 20 } },
    { press: 'q' }, { frames: 10 }, { answer: '24' }, { frames: 180 }, { answer: '24' }, { frames: 180 }, { answer: '4' }, { frames: 180 },
    { expect: { score: 3, planted: 12 } }],
};

// --- 3. Frog Hops on the Number Line (grades 3-5) ------------------------------------------------

const LINE_Y = -40;
const NX = (n) => -200 + n * 20;

function pondBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#bfe9ff', '#e9f8ff', 0, 230);
  // Far bank with reeds.
  ctx.fillStyle = '#6cbf5a';
  ctx.beginPath(); ctx.moveTo(0, 230); ctx.quadraticCurveTo(300, 170, 600, 220); ctx.quadraticCurveTo(800, 190, 960, 220); ctx.lineTo(960, 260); ctx.lineTo(0, 260); ctx.fill();
  const water = ctx.createLinearGradient(0, 250, 0, 720);
  water.addColorStop(0, '#4fb3e8');
  water.addColorStop(1, '#2477c4');
  ctx.fillStyle = water;
  ctx.fillRect(0, 250, w, h - 250);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 3;
  for (let i = 0; i < 26; i++) { const x = (i * 211) % w; const y = 280 + ((i * 97) % 380); ctx.beginPath(); ctx.ellipse(x, y, 30, 5, 0, 0, Math.PI * 2); ctx.stroke(); }
  for (const x of [30, 70, 900, 935]) {
    ctx.strokeStyle = '#3f8a3a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x, 270); ctx.lineTo(x - 6, 150); ctx.stroke();
    ctx.fillStyle = '#7a4a22'; ctx.beginPath(); ctx.ellipse(x - 6, 150, 7, 20, 0, 0, Math.PI * 2); ctx.fill();
  }
  // The number line: a log across the pond, one lily pad on every whole number.
  const y = PY(LINE_Y);
  ctx.fillStyle = '#9a6a3c';
  ctx.beginPath(); ctx.roundRect(PX(NX(0)) - 30, y - 7, PX(NX(20)) - PX(NX(0)) + 60, 14, 7); ctx.fill();
  for (let n = 0; n <= 20; n++) {
    const x = PX(NX(n));
    ctx.fillStyle = n % 5 ? '#5cc16b' : '#3fa553';
    ctx.beginPath(); ctx.ellipse(x, y, 17, 9, 0, 0.25, Math.PI * 2 - 0.25); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#1e5a2a'; ctx.lineWidth = 2; ctx.stroke();
    text(ctx, String(n), x, y + 32, { font: `700 ${n % 5 ? 22 : 28}px "Fredoka", "Nunito", system-ui, sans-serif`, fill: '#ffffff', stroke: '#14406e', lw: 6 });
  }
}

const numberLine = {
  id: 'number-line-hops', title: 'Frog Hops the Number Line', kind: 'Game', grades: [3, 5], subject: 'Math',
  blurb: 'Help a hungry frog catch flies by typing how far to hop. Plus hops right, minus hops left.',
  learn: 'Adding moves right on a number line and subtracting moves left. The distance between two numbers is the bigger one minus the smaller one, so to get from 4 to 11 you add 11 − 4 = 7.',
  backdrops: [{ name: 'Pond', paint: pondBackdrop }],
  variables: { frogAt: 4, target: 11, level: 0, score: 0, hop: 0, from: 0, dir: 1, vy: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sprites: [
    { name: 'Fly', lib: 'creature-fly', use: ['a', 'b'], x: 120, y: 110, size: 60 },
    { name: 'Frog', lib: 'creature-frog', use: ['idle', 'jump'], x: NX(4), y: LINE_Y + 18, size: 60, rotationStyle: 'left-right', sounds: ['jump', 'coin', 'hit', 'win'] },
  ],
  scripts: {
    Fly: `
when flag clicked:
    hide
    go to x: 120 y: 110
    forever:
        next costume
        wait 0.08 seconds

when I receive "fly moves":
    show
    glide 0.8 secs to x: (-200 + ((target) * 20)) y: 18

when I receive "gulp":
    hide
`,
    Frog: `
when flag clicked:
    set "score" to 0
    set "level" to 0
    set "frogAt" to 4
    switch costume to "idle"
    point in direction 90
    erase all
    set pen size to 4
    go to x: (-200 + ((frogAt) * 20)) y: -22
    show caption "Type how far to hop. A plus number hops RIGHT (adding). A minus number like -5 hops LEFT (subtracting)."
    repeat 4:
        change "level" by 1
        if ((level) = 1) then:
            set "target" to 11
        if ((level) = 2) then:
            set "target" to 6
        if ((level) = 3) then:
            set "target" to 15
        if ((level) = 4) then:
            set "target" to 2
        broadcast "fly moves" and wait
        ask (join (join (join (join "I'm on " (frogAt)) ". The fly is on ") (target)) ". How far should I hop?") and wait
        set "hop" to (round (answer))
        set "from" to (frogAt)
        if ((((frogAt) + (hop)) < 0) or (((frogAt) + (hop)) > 20)) then:
            start sound "hit"
            say "That would hop right off the number line!" for 2 seconds
        else:
            erase all
            set "dir" to 1
            set pen color to "#2bd94e"
            if ((hop) < 0) then:
                set "dir" to -1
                set pen color to "#ff8a1f"
            point in direction ((dir) * 90)
            switch costume to "jump"
            repeat ("abs" of (hop)):
                pen down
                set "vy" to 7
                repeat 8:
                    change x by ((dir) * 2.5)
                    change y by (vy)
                    change "vy" by -2
                pen up
                change "frogAt" by (dir)
                start sound "jump"
                say (frogAt)
            switch costume to "idle"
            if ((hop) < 0) then:
                say (join (join (join (join (from) " − ") ("abs" of (hop))) " = ") (frogAt)) for 2 seconds
            else:
                say (join (join (join (join (from) " + ") (hop)) " = ") (frogAt)) for 2 seconds
        if ((frogAt) = (target)) then:
            change "score" by 1
            broadcast "gulp"
            start sound "coin"
            say "Gulp! Got it!" for 1.5 seconds
        else:
            say (join (join (join (join (join "To get from " (from)) " to ") (target)) ", hop ") ((target) - (from))) for 3 seconds
    point in direction 90
    start sound "win"
    say (join (join "I caught " (score)) " out of 4 flies. Yum!")
    show caption "Adding hops RIGHT, subtracting hops LEFT. How far apart? Take the smaller number from the bigger."
`,
  },
  picture: [[40]],
  check: [{ frames: 60 }, { answer: '7' }, { frames: 260 }, { expect: { frogAt: 11, score: 1 } }, { answer: '-5' }, { frames: 220 },
    { answer: '9' }, { frames: 280 }, { answer: '-13' }, { frames: 330 }, { expect: { frogAt: 2, score: 4 } }],
};

// --- 4. Pirate Coordinates (grades 5-7) ----------------------------------------------------------

function mapBackdrop(ctx, w, h) {
  // A treasure map: parchment over the sea, with the coordinate plane drawn on it.
  ctx.fillStyle = '#3f8fd4';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(480, 330, 120, 480, 330, 560);
  g.addColorStop(0, '#fbeed0');
  g.addColorStop(1, '#e8cf9a');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(12, 12, 936, 600, 24); ctx.fill();
  ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 6; ctx.stroke();
  // Islands in each corner of the map, faint, under the grid.
  ctx.globalAlpha = 0.55;
  for (const [x, y, r, c] of [[730, 150, 70, '#9bd17a'], [210, 170, 60, '#9bd17a'], [200, 480, 55, '#d9c27a'], [740, 470, 50, '#d9c27a']]) {
    ctx.fillStyle = '#8fd3ff'; ctx.beginPath(); ctx.arc(x, y, r + 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  coordinatePlane(ctx, { xMax: 10, yMin: -5, yMax: 7, minor: 'rgba(122, 86, 44, 0.35)', axis: '#5a3418', ink: '#5a3418' });
  const q = '700 30px "Fredoka", "Nunito", system-ui, sans-serif';
  text(ctx, 'II  (−, +)', 280, 80, { font: q, fill: 'rgba(90,52,24,0.55)' });
  text(ctx, 'I  (+, +)', 690, 80, { font: q, fill: 'rgba(90,52,24,0.55)' });
  text(ctx, 'III  (−, −)', 280, 530, { font: q, fill: 'rgba(90,52,24,0.55)' });
  text(ctx, 'IV  (+, −)', 660, 530, { font: q, fill: 'rgba(90,52,24,0.55)' });
}

const treasure = {
  id: 'coordinate-treasure', title: 'Pirate Coordinates', kind: 'Quiz', grades: [5, 7], subject: 'Math',
  blurb: 'Read the coordinates of four hidden gems on a treasure map. Type x, then y, and the X walks there to dig.',
  learn: 'Every point on the coordinate plane is an ordered pair (x, y): x first, left or right of the origin, then y, up or down. Negative numbers go left and down, and the signs tell you which of the four quadrants a point is in.',
  backdrops: [{ name: 'Treasure Map', paint: mapBackdrop }],
  variables: { score: 0, level: 0, gx: 0, gy: 0, guessX: 0, guessY: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sprites: [
    { name: 'Gem', costumes: [['gem', emoji('💎', 60)]], x: 80, y: 60, size: 75, visible: false, sounds: ['coin', 'magic'] },
    { name: 'Marker', costumes: [['x', emoji('❌', 44)]], x: 0, y: 0, size: 70, visible: false, sounds: ['footsteps'] },
    { name: 'Captain', lib: 'toon-riley', use: ['idle', 'talk', 'cheer0', 'think'], x: 207, y: -52, size: 40, sounds: ['win', 'hit'] },
  ],
  scripts: {
    Captain: `
when flag clicked:
    set "score" to 0
    set "level" to 0
    switch costume to "talk"
    show caption "A point is a pair (x, y). x: how far right (minus: left). y: how far up (minus: down). Both from (0, 0)."
    say "Ahoy! Tell me where each gem is, and my X will walk there to dig." for 3 seconds
    repeat 4:
        change "level" by 1
        if ((level) = 1) then:
            set "gx" to 4
            set "gy" to 3
        if ((level) = 2) then:
            set "gx" to -6
            set "gy" to 2
        if ((level) = 3) then:
            set "gx" to -3
            set "gy" to -4
        if ((level) = 4) then:
            set "gx" to 7
            set "gy" to -2
        broadcast "new gem" and wait
        switch costume to "think"
        ask (join (join "Gem " (level)) ": what is its x? (right is +, left is −)") and wait
        set "guessX" to (round (answer))
        ask "And its y? (up is +, down is −)" and wait
        set "guessY" to (round (answer))
        broadcast "walk" and wait
        if (((guessX) = (gx)) and ((guessY) = (gy))) then:
            change "score" by 1
            switch costume to "cheer0"
            start sound "win"
            broadcast "found"
            say (join (join (join (join "Treasure! The gem was at (" (gx)) ", ") (gy)) ")") for 2 seconds
        else:
            switch costume to "talk"
            start sound "hit"
            say (join (join (join (join "Arr, not there! The gem is at (" (gx)) ", ") (gy)) "). Go across first, then up or down.") for 3 seconds
    switch costume to "cheer0"
    say (join (join "You found " (score)) " out of 4 gems!")
    show caption "The signs give the quadrant: I (+, +), II (−, +), III (−, −), IV (+, −). Click the map to see any point."
`,
    Gem: `
when flag clicked:
    hide
    erase all

when I receive "new gem":
    hide
    go to x: ((gx) * 20) y: ((gy) * 20)
    set size to 40 %
    clear graphic effects
    show
    start sound "magic"
    repeat 7:
        change size by 5

when I receive "found":
    start sound "coin"
    repeat 12:
        turn right 30 degrees
        change "brightness" effect by 5
    point in direction 90
    clear graphic effects
    stamp
`,
    Marker: `
when flag clicked:
    hide

when I receive "walk":
    go to x: 0 y: 0
    show
    set pen color to "#e8590c"
    set pen size to 4
    pen down
    start sound "footsteps"
    glide 1 secs to x: ((guessX) * 20) y: 0
    glide 1 secs to x: ((guessX) * 20) y: ((guessY) * 20)
    pen up
    say (join (join (join (join "(" (guessX)) ", ") (guessY)) ")") for 1 seconds

when stage clicked:
    go to x: ((round ((mouse x) / 20)) * 20) y: ((round ((mouse y) / 20)) * 20)
    show
    say (join (join (join (join "(" ((x position) / 20)) ", ") ((y position) / 20)) ")") for 2 seconds
`,
  },
  picture: [[110]],
  check: [{ frames: 120 }, { answer: '4' }, { frames: 5 }, { answer: '3' }, { frames: 200 }, { expect: { score: 1 } },
    { answer: '-6' }, { frames: 5 }, { answer: '2' }, { frames: 200 },
    { answer: '-3' }, { frames: 5 }, { answer: '-4' }, { frames: 200 },
    { answer: '7' }, { frames: 5 }, { answer: '-2' }, { frames: 200 }, { expect: { score: 4 } }],
};

// --- 5. The Polygon Turtle (grades 5-8) ----------------------------------------------------------

function paperBackdrop(ctx, w, h) {
  gradient(ctx, w, h, '#fffaf0', '#fff1d6');
  ctx.fillStyle = '#e8d9b8';
  for (let y = 20; y < h; y += 40) for (let x = 20; x < w; x += 40) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  // A protractor in the corner: a full turn is 360 degrees.
  const cx = 870;
  const cy = 450;
  ctx.fillStyle = 'rgba(120, 190, 255, 0.35)';
  ctx.strokeStyle = '#3a7bd5';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  for (let a = 0; a < 360; a += 30) {
    const r = a % 90 ? 58 : 50;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a * Math.PI / 180) * r, cy - Math.sin(a * Math.PI / 180) * r);
    ctx.lineTo(cx + Math.cos(a * Math.PI / 180) * 70, cy - Math.sin(a * Math.PI / 180) * 70); ctx.stroke();
  }
  text(ctx, '360°', cx, cy, { font: '700 30px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#1d4f9a' });
  text(ctx, 'one full turn', cx, cy - 92, { font: '600 20px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#1d4f9a' });
}

const POLY = { x: 30, y: 30, R: 100 };

const polygons = {
  id: 'polygon-turtle', title: 'The Polygon Turtle', kind: 'Art', grades: [5, 8], subject: 'Math',
  blurb: 'A turtle draws any regular polygon, or a star, by walking and turning. Find out why the turns always add up to 360°.',
  learn: 'To draw a regular polygon you turn 360 ÷ (number of sides) at every corner (the exterior angle). The interior angle is 180° minus that, and the interior angles add up to (sides − 2) × 180°. A star turns twice as far, 720° in all.',
  backdrops: [{ name: 'Dotted Paper', paint: paperBackdrop }],
  variables: { sides: 5, turn: 72, inside: 108, sum: 540, star: 0 },
  monitors: [['sides', 'normal', 8, 8], ['turn', 'normal', 8, 36], ['inside', 'normal', 8, 64], ['sum', 'normal', 8, 92]],
  sprites: [
    { name: 'Turtle', costumes: [['turtle', emojiFlipped('🐢', 70)]], x: POLY.x, y: POLY.y, size: 70, rotationStyle: 'all around', variables: { side: 0, i: 0, exact: 72 }, sounds: ['pop', 'chime', 'magic'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "sides" to 5
    set "star" to 0
    broadcast "draw"

when "up arrow" key pressed:
    if ((sides) < 12) then:
        change "sides" by 1
        set "star" to 0
        broadcast "draw"

when "down arrow" key pressed:
    if ((sides) > 3) then:
        change "sides" by -1
        set "star" to 0
        broadcast "draw"

when "space" key pressed:
    set "star" to 0
    broadcast "draw"

when "s" key pressed:
    if ((((sides) mod 2) = 1) and ((sides) > 4)) then:
        set "star" to 1
        broadcast "draw"
    else:
        show caption "A star like this needs an ODD number of points, 5 or more. Press UP, then S."
`,
    Turtle: `
when I receive "draw":
    erase all
    if ((star) = 0) then:
        set "exact" to (360 / (sides))
        set "side" to (${POLY.R * 2} * ("sin" of (180 / (sides))))
        go to x: (${POLY.x} - ((side) / 2)) y: (${POLY.y} - (${POLY.R} * ("cos" of (180 / (sides)))))
        point in direction 90
        set "sum" to (((sides) - 2) * 180)
    else:
        set "exact" to (720 / (sides))
        set "side" to (${POLY.R * 2} * ("sin" of (360 / (sides))))
        go to x: (${POLY.x} - (${POLY.R} * ("sin" of (180 / (sides))))) y: (${POLY.y} - (${POLY.R} * ("cos" of (180 / (sides)))))
        point in direction (90 - (180 / (sides)))
        set "sum" to (((sides) - 4) * 180)
    set "turn" to ((round ((exact) * 10)) / 10)
    set "inside" to ((round ((180 - (exact)) * 10)) / 10)
    if ((star) = 0) then:
        show caption (join (join (join (join "At each corner the turtle turns 360 ÷ " (sides)) " = ") (turn)) "°. Inside angle = 180 − turn. UP/DOWN: sides. S: star.")
    else:
        show caption (join (join (join (join (join (join "A star turns 720 ÷ " (sides)) " = ") (turn)) "° at each point: TWO full turns. Its points add up to ") (sum)) "°.")
    say ""
    set pen size to 6
    set "i" to 0
    repeat (sides):
        set pen "color" to ((i) * (100 / (sides)))
        pen down
        repeat 10:
            move ((side) / 10) steps
        pen up
        start sound "pop"
        repeat 6:
            turn left ((exact) / 6) degrees
        change "i" by 1
    start sound "chime"
    say (join (join (join (join (join (sides) " turns of ") (turn)) "° = ") (round ((sides) * (exact)))) "°: back where I started!")
`,
  },
  picture: [[140]],
  check: [{ frames: 120 }, { expect: { turn: 72, inside: 108, sum: 540 } }, { press: 'up arrow' }, { frames: 140 }, { expect: { sides: 6, turn: 60, inside: 120, sum: 720 } },
    { press: 's' }, { frames: 20 }, { expect: { star: 0 } }, { press: 'up arrow' }, { frames: 20 }, { press: 's' }, { frames: 140 },
    { expect: { sides: 7, star: 1, turn: 102.9, inside: 77.1, sum: 540 } }, { press: 'down arrow' }, { frames: 20 }, { press: 'down arrow' }, { frames: 20 }, { press: 's' }, { frames: 130 },
    { expect: { sides: 5, turn: 144, inside: 36, sum: 180 } }],
};

// --- 6. Smoothie Ratios (grades 6-7) -------------------------------------------------------------

const ROW0 = 100;
const ROW_H = 38;

function smoothieBackdrop(ctx, w, h) {
  // A juice bar: striped awning, a counter, and a ratio table to fill in.
  gradient(ctx, w, h, '#fff1f6', '#ffe0ec');
  for (let x = 0; x < w; x += 80) { ctx.fillStyle = (x / 80) % 2 ? '#ffffff' : '#ff7eb3'; ctx.fillRect(x, 0, 80, 36); }
  ctx.fillStyle = '#ff7eb3';
  for (let x = 0; x < w; x += 80) { ctx.beginPath(); ctx.arc(x + 40, 36, 40, 0, Math.PI); ctx.fill(); }
  // The table: header and five rows, one row for every smoothie.
  const L = PX(-228);
  const R = PX(64);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d14d8a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(L, PY(ROW0 + 44), R - L, PY(ROW0 - 4.5 * ROW_H) - PY(ROW0 + 44), 14); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.roundRect(L, PY(ROW0 + 44), R - L, 50, [14, 14, 0, 0]); ctx.fill(); ctx.stroke();
  const hf = '700 20px "Fredoka", "Nunito", system-ui, sans-serif';
  text(ctx, 'BANANAS', PX(-178), PY(ROW0 + 31), { font: hf });
  text(ctx, 'STRAWBERRIES', PX(-97), PY(ROW0 + 31), { font: hf });
  text(ctx, 'MAKES', PX(7), PY(ROW0 + 31), { font: hf });
  ctx.strokeStyle = '#f3b6d1';
  ctx.lineWidth = 3;
  for (let r = 1; r < 5; r++) { const y = PY(ROW0 - r * ROW_H + ROW_H / 2); ctx.beginPath(); ctx.moveTo(L + 8, y); ctx.lineTo(R - 8, y); ctx.stroke(); }
  for (const x of [-144, -50]) { ctx.beginPath(); ctx.moveTo(PX(x), PY(ROW0 + 44) + 50); ctx.lineTo(PX(x), PY(ROW0 - 4.5 * ROW_H)); ctx.stroke(); }
  // The recipe card.
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(PX(84), PY(166), PX(232) - PX(84), 126, 14); ctx.fill(); ctx.stroke();
  text(ctx, 'SECRET RECIPE', PX(158), PY(150), { font: '700 22px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#d14d8a' });
  text(ctx, '2 bananas', PX(158), PY(127), { font: '700 24px "Fredoka", "Nunito", system-ui, sans-serif' });
  text(ctx, 'to 3 strawberries', PX(158), PY(110), { font: '600 22px "Fredoka", "Nunito", system-ui, sans-serif' });
  // The counter.
  ctx.fillStyle = '#c97a4a';
  ctx.fillRect(0, PY(-100), w, h - PY(-100));
  ctx.fillStyle = '#a65f34';
  ctx.fillRect(0, PY(-100), w, 12);
}

const smoothie = {
  id: 'smoothie-ratios', title: 'Smoothie Ratios', kind: 'Story', grades: [6, 7], subject: 'Math',
  blurb: "Leo's smoothie stand uses 2 bananas for every 3 strawberries. Scale the recipe up to serve hungry animal customers.",
  learn: 'A ratio compares two amounts, like 2 bananas : 3 strawberries. Multiplying both parts by the same number makes an equivalent ratio (4 : 6, 6 : 9), which is how you scale a recipe up and still get the same taste.',
  backdrops: [{ name: 'Smoothie Stand', paint: smoothieBackdrop }],
  variables: { smoothies: 1, bananas: 2, strawberries: 3, score: 0, row: 0 },
  monitors: [['smoothies', 'normal', 340, 92]],
  sprites: [
    { name: 'Fruit', costumes: [['banana', emoji('🍌', 60)], ['strawberry', emoji('🍓', 60)], ['smoothie', emoji('🥤', 60)]], x: -194, y: ROW0, size: 78, visible: false, sounds: ['pop'] },
    { name: 'Customer', costumes: [['panda', emoji('🐼', 110)], ['monkey', emoji('🐵', 110)], ['penguin', emoji('🐧', 110)], ['rabbit', emoji('🐰', 110)]], x: 300, y: -60, size: 85, visible: false, sounds: ['chime'] },
    { name: 'Leo', lib: 'toon-leo', use: ['idle', 'talk', 'cheer0', 'think'], x: 190, y: -62, size: 46, sounds: ['win', 'hit', 'whoosh'] },
  ],
  scripts: {
    Stage: `
when "up arrow" key pressed:
    if ((smoothies) < 5) then:
        change "smoothies" by 1
        broadcast "blend"

when "down arrow" key pressed:
    if ((smoothies) > 1) then:
        change "smoothies" by -1
        broadcast "blend"
`,
    Fruit: `
when I receive "blend":
    erase all
    set "bananas" to ((smoothies) * 2)
    set "strawberries" to ((smoothies) * 3)
    show
    set "row" to 0
    repeat (smoothies):
        switch costume to "banana"
        go to x: -203 y: (${ROW0} - ((row) * ${ROW_H}))
        repeat 2:
            stamp
            change x by 34
        switch costume to "strawberry"
        go to x: -121 y: (${ROW0} - ((row) * ${ROW_H}))
        repeat 3:
            stamp
            change x by 24
        switch costume to "smoothie"
        go to x: 7 y: (${ROW0} - ((row) * ${ROW_H}))
        stamp
        start sound "pop"
        change "row" by 1
    hide
    broadcast "blended"
`,
    Leo: `
when flag clicked:
    set "score" to 0
    set "smoothies" to 1
    switch costume to "talk"
    show caption "A RATIO compares two amounts. Leo's recipe: 2 bananas for every 3 strawberries, or 2 : 3."
    broadcast "blend"
    say "Welcome to my smoothie stand! One smoothie takes 2 bananas and 3 strawberries." for 4 seconds
    say "For more smoothies I add the WHOLE recipe again, one row each." for 3 seconds
    repeat 2:
        change "smoothies" by 1
        broadcast "blend" and wait
        wait 0.8 seconds
    say "3 smoothies: 6 bananas and 9 strawberries. 6 : 9 is still 2 : 3!" for 4 seconds
    switch costume to "idle"
    broadcast "customers"

when I receive "blended":
    show caption (join (join (join (join (join (join (smoothies) " smoothies need ") (bananas)) " bananas : ") (strawberries)) " strawberries. ") (join (join (join "Divide both by " (smoothies)) ": 2 : 3. ") "Same ratio, same taste!"))

when I receive "customers":
    start sound "whoosh"
    switch costume to "think"
    broadcast "next customer" and wait
    ask "Panda wants 4 smoothies. How many strawberries do I need?" and wait
    set "smoothies" to 4
    if ((answer) = ((smoothies) * 3)) then:
        change "score" by 1
        start sound "win"
        say "Yes! 4 × 3 = 12 strawberries." for 3 seconds
    else:
        start sound "hit"
        say "4 smoothies × 3 strawberries = 12." for 3 seconds
    broadcast "blend" and wait
    broadcast "next customer" and wait
    ask "Monkey brought 10 bananas. How many smoothies can I make?" and wait
    set "smoothies" to (10 / 2)
    if ((answer) = (smoothies)) then:
        change "score" by 1
        start sound "win"
        say "Right! 10 ÷ 2 = 5 smoothies." for 3 seconds
    else:
        start sound "hit"
        say "Each smoothie takes 2 bananas: 10 ÷ 2 = 5." for 3 seconds
    broadcast "blend" and wait
    broadcast "next customer" and wait
    ask "Penguin has 6 bananas. How many strawberries go with them?" and wait
    set "smoothies" to (6 / 2)
    if ((answer) = ((smoothies) * 3)) then:
        change "score" by 1
        start sound "win"
        say "Yes! 6 bananas is 3 smoothies, so 3 × 3 = 9 strawberries." for 4 seconds
    else:
        start sound "hit"
        say "6 bananas is 3 lots of 2, so 3 lots of 3: 9 strawberries." for 4 seconds
    broadcast "blend" and wait
    broadcast "next customer" and wait
    ask "Rabbit's recipe is 4 bananas to 5 strawberries. Does it taste the same as mine? (yes or no)" and wait
    if ((answer) contains "n" ?) then:
        change "score" by 1
        start sound "win"
        say "Right! 4 bananas would need 6 strawberries. 4 : 5 has too few." for 4 seconds
    else:
        start sound "hit"
        say "No: 2 : 3 doubled is 4 : 6, not 4 : 5." for 4 seconds
    switch costume to "cheer0"
    say (join (join "You served " (score)) " out of 4 customers just right! UP/DOWN makes more or fewer smoothies.")
`,
    Customer: `
when flag clicked:
    hide
    switch costume to "rabbit"

when I receive "next customer":
    next costume
    go to x: 300 y: -58
    show
    start sound "chime"
    glide 0.8 secs to x: 112 y: -58
`,
  },
  picture: [[460]],
  check: [{ frames: 530 }, { expect: { smoothies: 3, bananas: 6, strawberries: 9 } }, { answer: '12' }, { frames: 200 }, { expect: { smoothies: 4, strawberries: 12 } },
    { answer: '5' }, { frames: 200 }, { answer: '9' }, { frames: 220 }, { answer: 'no' }, { frames: 160 },
    { expect: { score: 4 } }, { press: 'down arrow' }, { frames: 40 }, { expect: { smoothies: 2, bananas: 4, strawberries: 6 } }],
};

// --- 7. Roll Two Dice (grades 7-10) --------------------------------------------------------------

const SX = (s) => -200 + (s - 2) * 34;

function diceBackdrop(ctx, w, h) {
  // Green felt, a white chart board, and the totals 2 to 12 along the bottom.
  const g = ctx.createRadialGradient(480, 360, 100, 480, 360, 700);
  g.addColorStop(0, '#2fa36b');
  g.addColorStop(1, '#156b44');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const L = PX(-232);
  const R = PX(176);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.roundRect(L, PY(170), R - L, PY(-128) - PY(170), 16); ctx.fill();
  ctx.strokeStyle = '#e3e9f2';
  ctx.lineWidth = 2;
  const f = '600 16px "Fredoka", "Nunito", system-ui, sans-serif';
  for (let c = 20; c <= 120; c += 20) {
    const y = PY(-78 + c * 2);
    ctx.beginPath(); ctx.moveTo(L + 34, y); ctx.lineTo(R - 10, y); ctx.stroke();
    text(ctx, String(c), L + 18, y, { font: f, fill: '#8a97ab' });
  }
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(L + 34, PY(-78)); ctx.lineTo(R - 10, PY(-78)); ctx.stroke();
  for (let s = 2; s <= 12; s++) text(ctx, String(s), PX(SX(s)), PY(-91), { font: '700 22px "Fredoka", "Nunito", system-ui, sans-serif' });
  text(ctx, 'how many times each total came up', PX(40), PY(158), { font: '600 16px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#5a6a80' });
}

function dieFace(n) {
  return paint(96, 96, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#1e2a3a';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(6, 6, 84, 84, 16); ctx.fill(); ctx.stroke();
    const P = { a: [28, 28], b: [68, 28], c: [28, 48], d: [48, 48], e: [68, 48], f: [28, 68], g: [68, 68] };
    const dots = ['d', 'ag', 'adg', 'abfg', 'abdfg', 'abcefg'][n - 1];
    ctx.fillStyle = n === 1 ? '#e53935' : '#1e2a3a';
    for (const k of dots) { const [x, y] = P[k]; ctx.beginPath(); ctx.arc(x, y, n === 1 ? 11 : 8, 0, Math.PI * 2); ctx.fill(); }
  });
}

const DIE_COSTUMES = ['one', 'two', 'three', 'four', 'five', 'six'];
const dieScript = (v) => `
when I receive "${v === 'd1' ? 'roll' : 'rolled'}":
${v === 'd1' ? `    set "d1" to (pick random 1 to 6)
    set "d2" to (pick random 1 to 6)
    set "sum" to ((d1) + (d2))
    change "rolls" by 1
    if ((sum) = 7) then:
        change "sevens" by 1
    set "pct" to ((round (((sevens) / (rolls)) * 1000)) / 10)
` : ''}${DIE_COSTUMES.map((c, i) => `    if ((${v}) = ${i + 1}) then:\n        switch costume to "${c}"`).join('\n')}
    point in direction (90 + (pick random -15 to 15))
${v === 'd1' ? '    broadcast "rolled"\n' : ''}`;

const dice = {
  id: 'two-dice-probability', title: 'Roll Two Dice', kind: 'Simulation', grades: [7, 10], subject: 'Math',
  blurb: 'Roll two dice hundreds of times and watch a bar chart grow. Why does 7 come up so much more than 2 or 12?',
  learn: 'Experimental and theoretical probability. Two dice can land 36 equally likely ways; 6 of them total 7 but only 1 totals 2, so P(7) = 6/36 ≈ 16.7%. The more you roll, the closer the results come to the theory (the law of large numbers).',
  backdrops: [{ name: 'Dice Table', paint: diceBackdrop }],
  variables: { rolls: 0, d1: 1, d2: 1, sum: 2, sevens: 0, pct: 0, full: 0, theory: 0 },
  monitors: [['rolls', 'normal', 8, 8]],
  sprites: [
    { name: 'Bar', costumes: [['slab', rect(52, 4, '#ff3d6e', null, 0, 0)]], x: 0, y: -79, visible: false, variables: { mysum: 0, count: 0 } },
    { name: 'Expected', costumes: [['dash', rect(40, 5, '#1e2a3a', '#ffffff', 2, 2)]], x: 0, y: -78, visible: false, variables: { mysum: 0, ways: 0 } },
    { name: 'Die1', costumes: DIE_COSTUMES.map((c, i) => [c, dieFace(i + 1)]), x: 208, y: 132, size: 90 },
    { name: 'Die2', costumes: DIE_COSTUMES.map((c, i) => [c, dieFace(i + 1)]), x: 208, y: 78, size: 90, sounds: ['knock'] },
    { name: 'Scientist', lib: 'toon-robo', use: ['idle', 'talk', 'cheer0', 'think'], x: 207, y: -45, size: 40 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "rolls" to 0
    set "sevens" to 0
    set "pct" to 0
    set "full" to 0
    set "theory" to 0
    show caption "Hold SPACE to roll two dice, or press R for 100 rolls. Which total comes up most? T shows the theory."
    forever:
        if ((key "space" pressed?) and ((full) = 0)) then:
            broadcast "roll" and wait

when "r" key pressed:
    repeat 100:
        if ((full) = 0) then:
            broadcast "roll" and wait

when "t" key pressed:
    if ((theory) = 0) then:
        set "theory" to 1
        show caption "Two dice land 36 ways. 6 make 7 (1+6, 2+5, 3+4...) but just 1 makes 2. Dashes: what theory predicts."
    else:
        set "theory" to 0
        hide caption
`,
    Bar: `
when flag clicked:
    hide
    erase all
    set "mysum" to 1
    repeat 11:
        change "mysum" by 1
        create clone of "myself"
    set "mysum" to 0

when I start as a clone:
    set "count" to 0
    go to x: (-200 + (((mysum) - 2) * 34)) y: -79
    set "color" effect to (((mysum) - 2) * 16)

when I receive "rolled":
    if ((mysum) = (sum)) then:
        change "count" by 1
        set y to (-79 + (2 * (count)))
        show
        stamp
        if ((count) > 119) then:
            set "full" to 1
`,
    Expected: `
when flag clicked:
    hide
    set "mysum" to 1
    repeat 11:
        change "mysum" by 1
        create clone of "myself"
    set "mysum" to 0

when I start as a clone:
    set "ways" to (6 - ("abs" of ((mysum) - 7)))
    go to x: (-200 + (((mysum) - 2) * 34)) y: -78
    go to "front" layer
    forever:
        set y to (-78 + (2 * (((rolls) * (ways)) / 36)))
        if ((theory) = 1) then:
            show
        else:
            hide
`,
    Die1: dieScript('d1'),
    Die2: dieScript('d2') + `
when I receive "roll":
    start sound "knock"
`,
    Scientist: `
when flag clicked:
    switch costume to "talk"
    say "Two dice. Which total do you think will win?" for 3 seconds
    switch costume to "idle"
    wait until ((full) = 1)
    switch costume to "cheer0"
    say (join (join (join "Chart full after " (rolls)) " rolls! 7 came up ") (join (pct) "%. Theory: 6/36 = 16.7%"))

when I receive "rolled":
    if (((rolls) mod 50) = 0) then:
        switch costume to "think"
        say (join (join (join (join "After " (rolls)) " rolls, 7 came up ") (pct)) "% of the time. Theory says 16.7%.")
`,
  },
  picture: [[20], [330, ['space']], [10]],
  check: [{ frames: 30 }, { press: 'r' }, { frames: 320 }, { expect: { rolls: 100 } }, { press: 't' }, { frames: 10 }, { expect: { theory: 1 } }, { frames: 120, keys: ['space'] }],
};

// --- 8. Line Up: y = mx + b (grades 8-10) --------------------------------------------------------

function graphBackdrop(ctx, w, h) {
  // A night-time blueprint: the plane drawn in light lines on deep blue.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#13234a');
  g.addColorStop(1, '#1e3a73');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  coordinatePlane(ctx, { xMax: 11, yMin: -5, yMax: 8, minor: 'rgba(140, 180, 255, 0.22)', axis: '#cfe0ff', ink: '#9fc0ff' });
}

const MISSIONS = [[0, 1, 2, 5], [-4, 5, 4, 1], [-3, -4, 3, 2], [-6, 4, 5, 4]];

const slope = {
  id: 'graph-y-mx-b', title: 'Line Up: y = mx + b', kind: 'Game', grades: [8, 10], subject: 'Math',
  blurb: 'Steer a line through two stars by changing its slope m and its y-intercept b. Four missions, from steep to flat.',
  learn: 'In y = mx + b, b is where the line crosses the y-axis and m is the slope: how far the line rises for every 1 step to the right (rise ÷ run). A negative slope falls, and a slope of 0 is a flat line.',
  backdrops: [{ name: 'Blueprint', paint: graphBackdrop }],
  variables: { m: 1, b: 0, mission: 0, solved: 0, done: 0, sx1: 0, sy1: 0, sx2: 0, sy2: 0, x1: 0, x2: 0, t: 0, eq: '' },
  monitors: [['m', 'normal', 8, 8], ['b', 'normal', 8, 38]],
  sprites: [
    { name: 'Line', costumes: [['dot', circle(2, '#ffffff', null)]], x: 0, y: 0, visible: false },
    { name: 'Intercept', costumes: [['dot', circle(9, '#ffd43b', '#1e2a3a', 4)]], x: 0, y: 0 },
    { name: 'Star1', costumes: [['star', emoji('⭐', 50)]], x: 0, y: 20, size: 70, sounds: ['magic'] },
    { name: 'Star2', costumes: [['star', emoji('⭐', 50)]], x: 40, y: 100, size: 70 },
    { name: 'Grapher', lib: 'toon-zed', use: ['idle', 'talk', 'cheer0', 'think'], x: 205, y: -80, size: 40, sounds: ['win', 'tada'] },
  ],
  scripts: {
    Stage: `
when "up arrow" key pressed:
    if ((m) < 4) then:
        change "m" by 0.5
        broadcast "draw"

when "down arrow" key pressed:
    if ((m) > -4) then:
        change "m" by -0.5
        broadcast "draw"

when "right arrow" key pressed:
    if ((b) < 8) then:
        change "b" by 1
        broadcast "draw"

when "left arrow" key pressed:
    if ((b) > -5) then:
        change "b" by -1
        broadcast "draw"
`,
    Grapher: `
when flag clicked:
    set "m" to 1
    set "b" to 0
    set "solved" to 0
    set "done" to 0
    set "mission" to 0
    show caption "UP/DOWN change the slope m (rise for every 1 step right). LEFT/RIGHT move b, where the line crosses the y-axis."
    broadcast "next mission"

when I receive "next mission":
    change "mission" by 1
${MISSIONS.map(([a, b2, c, d], i) => `    if ((mission) = ${i + 1}) then:
        set "sx1" to ${a}
        set "sy1" to ${b2}
        set "sx2" to ${c}
        set "sy2" to ${d}`).join('\n')}
    if ((mission) > ${MISSIONS.length}) then:
        switch costume to "cheer0"
        start sound "tada"
        say "All four lines found! You can read y = mx + b like a map."
        show caption "Steep up: big m. Falling: negative m. Flat: m = 0. And b is always where the line meets the y-axis."
        stop "this script"
    broadcast "stars"
    broadcast "draw"
    switch costume to "talk"
    show caption (join (join (join (join (join "Mission " (mission)) ": make the line pass through both stars, (") (sx1)) ", ") (join (join (join (sy1) ") and (") (sx2)) (join ", " (join (sy2) ")."))))

when I receive "eq":
    say (eq)

when I receive "solved":
    if ((done) < (mission)) then:
        set "done" to (mission)
        change "solved" by 1
        switch costume to "cheer0"
        start sound "win"
        say (join (eq) " goes through both stars!") for 2 seconds
        switch costume to "talk"
        broadcast "next mission"
`,
    Line: `
when I receive "draw":
    erase all
    if ((m) = 0) then:
        set "x1" to -11
        set "x2" to 11
    else:
        set "x1" to ((-5 - (b)) / (m))
        set "x2" to ((8 - (b)) / (m))
        if ((x1) > (x2)) then:
            set "t" to (x1)
            set "x1" to (x2)
            set "x2" to (t)
        if ((x1) < -11) then:
            set "x1" to -11
        if ((x2) > 11) then:
            set "x2" to 11
    set pen color to "#ff5fb0"
    set pen size to 5
    if ((x1) < (x2)) then:
        go to x: ((x1) * 20) y: ((((m) * (x1)) + (b)) * 20)
        pen down
        go to x: ((x2) * 20) y: ((((m) * (x2)) + (b)) * 20)
        pen up
    if ((((b) + (m)) < 9) and (((b) + (m)) > -6)) then:
        set pen color to "#ffb84d"
        set pen size to 3
        go to x: 0 y: ((b) * 20)
        pen down
        go to x: 20 y: ((b) * 20)
        go to x: 20 y: (((b) + (m)) * 20)
        pen up
    if ((m) = 0) then:
        set "eq" to (join "y = " (b))
    else:
        if ((m) = 1) then:
            set "eq" to "y = x"
        else:
            if ((m) = -1) then:
                set "eq" to "y = −x"
            else:
                set "eq" to (join (join "y = " (m)) "x")
        if ((b) > 0) then:
            set "eq" to (join (join (eq) " + ") (b))
        if ((b) < 0) then:
            set "eq" to (join (join (eq) " − ") ("abs" of (b)))
    broadcast "eq"
    if (((((m) * (sx1)) + (b)) = (sy1)) and ((((m) * (sx2)) + (b)) = (sy2))) then:
        broadcast "solved"
`,
    Intercept: `
when I receive "draw":
    go to x: 0 y: ((b) * 20)
    go to "front" layer
`,
    Star1: `
when I receive "stars":
    go to x: ((sx1) * 20) y: ((sy1) * 20)
    start sound "magic"
    repeat 2:
        change size by 20
        wait 0.1 seconds
        change size by -20
        wait 0.1 seconds

when I receive "solved":
    repeat 12:
        turn right 30 degrees
`,
    Star2: `
when I receive "stars":
    go to x: ((sx2) * 20) y: ((sy2) * 20)
    repeat 2:
        change size by 20
        wait 0.1 seconds
        change size by -20
        wait 0.1 seconds

when I receive "solved":
    repeat 12:
        turn left 30 degrees
`,
  },
  picture: [[30]],
  check: [{ frames: 30 }, { press: 'up arrow' }, { frames: 5 }, { press: 'up arrow' }, { frames: 5 }, { press: 'right arrow' }, { frames: 90 },
    { expect: { solved: 1, mission: 2 } },
    ...Array(5).fill(0).flatMap(() => [{ press: 'down arrow' }, { frames: 5 }]), { press: 'right arrow' }, { frames: 5 }, { press: 'right arrow' }, { frames: 90 },
    { expect: { solved: 2, mission: 3 } },
    ...Array(3).fill(0).flatMap(() => [{ press: 'up arrow' }, { frames: 5 }]), ...Array(4).fill(0).flatMap(() => [{ press: 'left arrow' }, { frames: 5 }]), { frames: 90 },
    { expect: { solved: 3, mission: 4 } },
    ...Array(2).fill(0).flatMap(() => [{ press: 'down arrow' }, { frames: 5 }]), ...Array(5).fill(0).flatMap(() => [{ press: 'right arrow' }, { frames: 5 }]), { frames: 90 },
    { expect: { solved: 4, mission: 5, eq: 'y = 4' } }],
};

// --- 9. The Sine Wave Machine (grades 10-12) -----------------------------------------------------

const CIRCLE = { x: -150, y: 30 };
const WAVE_X0 = -60;
const WAVE_K = 0.6;

function sineBackdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#120a2e');
  g.addColorStop(1, '#2a1550');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Stars.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 90; i++) { ctx.beginPath(); ctx.arc((i * 233) % w, (i * 137) % 600, (i % 3) + 1, 0, Math.PI * 2); ctx.fill(); }
  // The circle's axes.
  const cx = PX(CIRCLE.x);
  const cy = PY(CIRCLE.y);
  ctx.strokeStyle = 'rgba(180, 200, 255, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 180, cy); ctx.lineTo(cx + 180, cy); ctx.moveTo(cx, cy - 180); ctx.lineTo(cx, cy + 180); ctx.stroke();
  // The wave's axis, with a tick every 90 degrees.
  const x0 = PX(WAVE_X0);
  const x1 = PX(WAVE_X0 + 480 * WAVE_K);
  ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x1 + 10, cy); ctx.stroke();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = 'rgba(180, 200, 255, 0.25)';
  for (let a = 90; a <= 450; a += 90) { const x = PX(WAVE_X0 + a * WAVE_K); ctx.beginPath(); ctx.moveTo(x, cy - 170); ctx.lineTo(x, cy + 170); ctx.stroke(); }
  ctx.setLineDash([]);
  const f = '700 20px "Fredoka", "Nunito", system-ui, sans-serif';
  for (let a = 0; a <= 450; a += 90) text(ctx, `${a}°`, PX(WAVE_X0 + a * WAVE_K), cy + 192, { font: f, fill: '#c9d6ff' });
  text(ctx, 'θ →', x1 + 4, cy - 22, { font: 'italic 700 24px Georgia, serif', fill: '#c9d6ff' });
  text(ctx, '+1', PX(WAVE_X0) - 26, PY(CIRCLE.y + 60), { font: '600 18px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#8fa3d9' });
  text(ctx, '−1', PX(WAVE_X0) - 26, PY(CIRCLE.y - 60), { font: '600 18px "Fredoka", "Nunito", system-ui, sans-serif', fill: '#8fa3d9' });
}

function ring() {
  return paint(412, 412, (ctx) => {
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(206, 206, 200, 0, Math.PI * 2); ctx.stroke();
  });
}

function radiusArm() {
  // A line from the middle of the canvas to its right edge: the costume turns about the circle's centre.
  return paint(412, 20, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(206, 10); ctx.lineTo(404, 10); ctx.stroke();
  });
}

function guide() {
  return paint(780, 6, (ctx) => {
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(780, 3); ctx.stroke();
  });
}

const sine = {
  id: 'unit-circle-sine', title: 'The Sine Wave Machine', kind: 'Animation', grades: [10, 12], subject: 'Math',
  blurb: 'A dot goes round a circle while a pen plots its height. Out comes a sine wave. Press C for cosine, UP/DOWN to change the size.',
  learn: 'On the unit circle the point at angle θ is (cos θ, sin θ), so sin θ is its height and cos θ is how far across it is. Plotting the height against θ draws a sine wave that repeats every 360°; a bigger circle gives a bigger amplitude.',
  backdrops: [{ name: 'Night Lab', paint: sineBackdrop }],
  variables: { theta: 0, A: 60, mode: 0, paused: 0, h: 0, s: 0, c: 0, score: 0 },
  monitors: [['A', 'normal', 8, 8]],
  sprites: [
    { name: 'Guide', costumes: [['line', guide()]], x: 40, y: CIRCLE.y, size: 100 },
    { name: 'Ring', costumes: [['ring', ring()]], x: CIRCLE.x, y: CIRCLE.y, size: 60 },
    { name: 'Arm', costumes: [['arm', radiusArm()]], x: CIRCLE.x, y: CIRCLE.y, size: 60, rotationStyle: 'all around' },
    { name: 'Tracer', costumes: [['dot', circle(3, '#ff4fa3', null)]], x: WAVE_X0, y: CIRCLE.y, visible: false },
    { name: 'Dot', costumes: [['dot', circle(10, '#ff4fa3', '#ffffff', 4)], ['blue', circle(10, '#3fd8ff', '#ffffff', 4)]], x: CIRCLE.x + 60, y: CIRCLE.y },
    { name: 'Professor', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'think'], x: -205, y: -82, size: 38, sounds: ['win', 'hit'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "theta" to 0
    set "A" to 60
    set "mode" to 0
    set "paused" to 0
    set "score" to 0
    show caption "On the unit circle the dot is at (cos θ, sin θ). Plot its HEIGHT, sin θ, as θ grows: a sine wave!"

when "space" key pressed:
    set "paused" to (1 - (paused))

when "c" key pressed:
    set "mode" to (1 - (mode))
    set "theta" to 0
    broadcast "restart"
    if ((mode) = 1) then:
        show caption "Now the pen plots cos θ: how far ACROSS the dot is (left or right). Same wave, shifted 90°."
    else:
        show caption "Back to sin θ: the dot's HEIGHT. Press C for cosine again."

when "up arrow" key pressed:
    if ((A) < 80) then:
        change "A" by 10
        set "theta" to 0
        broadcast "restart"
        show caption "A bigger circle makes a taller wave. The height is A × sin θ, and A is the AMPLITUDE."

when "down arrow" key pressed:
    if ((A) > 30) then:
        change "A" by -10
        set "theta" to 0
        broadcast "restart"
        show caption "A smaller circle makes a smaller wave: A × sin θ, with a smaller amplitude A."
`,
    Tracer: `
when flag clicked:
    erase all
    pen up
    set pen size to 4
    forever:
        if ((paused) = 0) then:
            if ((mode) = 0) then:
                set "h" to ((A) * ("sin" of (theta)))
                set pen color to "#ff4fa3"
            else:
                set "h" to ((A) * ("cos" of (theta)))
                set pen color to "#3fd8ff"
            go to x: (${WAVE_X0} + ((theta) * ${WAVE_K})) y: (${CIRCLE.y} + (h))
            pen down
            if ((theta) > 477) then:
                pen up
                wait 0.6 seconds
                erase all
                set "theta" to 0
            else:
                change "theta" by 3

when I receive "restart":
    pen up
    erase all
`,
    Ring: `
when flag clicked:
    forever:
        set size to (A) %
`,
    Arm: `
when flag clicked:
    forever:
        set size to (A) %
        point in direction (90 - (theta))
`,
    Guide: `
when flag clicked:
    set "ghost" effect to 20
    go to "back" layer
    forever:
        set y to (${CIRCLE.y} + ((A) * ("sin" of (theta))))
        if ((mode) = 0) then:
            show
        else:
            hide
`,
    Dot: `
when flag clicked:
    go to "front" layer
    forever:
        go to x: (${CIRCLE.x} + ((A) * ("cos" of (theta)))) y: (${CIRCLE.y} + ((A) * ("sin" of (theta))))
        if ((mode) = 0) then:
            switch costume to "dot"
        else:
            switch costume to "blue"
        set "s" to ((round (("sin" of (theta)) * 100)) / 100)
        set "c" to ((round (("cos" of (theta)) * 100)) / 100)
        say (join (join (join (join (join "θ = " ((theta) mod 360)) "°  (") (c)) ", ") (join (s) ")"))
`,
    Professor: `
when flag clicked:
    switch costume to "talk"
    say "Watch the dot's height!" for 3 seconds
    switch costume to "idle"
    say "Press Q for a quiz." for 3 seconds

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "What is sin 90°? (Where is the dot at 90°?)" and wait
    if ((answer) = ("sin" of 90)) then:
        change "score" by 1
        start sound "win"
        say "Yes: at 90° the dot is at the very top, height 1." for 3 seconds
    else:
        start sound "hit"
        say "It's 1: at 90° the dot is at the top of the circle." for 3 seconds
    ask "What is sin 180°?" and wait
    if ((answer) = ("sin" of 180)) then:
        change "score" by 1
        start sound "win"
        say "Right: at 180° the dot is back on the axis, height 0." for 3 seconds
    else:
        start sound "hit"
        say "It's 0: at 180° the dot is level with the centre." for 3 seconds
    ask "What is cos 180°?" and wait
    if ((answer) = ("cos" of 180)) then:
        change "score" by 1
        start sound "win"
        say "Yes: at 180° the dot is all the way LEFT, at −1." for 3 seconds
    else:
        start sound "hit"
        say "It's −1 (type -1): at 180° the dot is at the far left." for 3 seconds
    ask "What is sin 270°?" and wait
    if ((answer) = ("sin" of 270)) then:
        change "score" by 1
        start sound "win"
        say "Right: at 270° the dot is at the bottom, −1." for 3 seconds
    else:
        start sound "hit"
        say "It's −1: at 270° the dot is at the bottom." for 3 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 4!")
`,
  },
  picture: [[150]],
  check: [{ frames: 100 }, { press: 'up arrow' }, { frames: 60 }, { expect: { A: 70 } }, { press: 'c' }, { frames: 60 }, { expect: { mode: 1 } }, { press: 'c' }, { frames: 30 },
    { press: 'q' }, { frames: 10 }, { answer: '1' }, { frames: 100 }, { answer: '0' }, { frames: 100 }, { answer: '-1' }, { frames: 100 }, { answer: '-1' }, { frames: 100 },
    { expect: { score: 4, mode: 0 } }, { frames: 60 }],
};

export default [pizzaFractions, arrayGarden, numberLine, treasure, polygons, smoothie, dice, slope, sine];
