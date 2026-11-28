// Learning projects: humanities. Written with ./kit.js; see featured.js for worked examples.
// Ids are PERSISTED in links (?project=<id>), so they are only ever added.
//
//   History & Geography: Write Like an Egyptian Scribe (3-5), The Silk Roads (6-8), Longitude by the Clock (9-12)
//   Art & Music:         Melody Maker (3-5), The Colour Wheel (6-8), Seurat's Dots (9-12)
//   Language Arts:       The Sentence Machine (3-5), Haiku Garden (6-8), Ethos, Pathos, Logos (9-12)
import { emoji, label, circle, rect, paint } from './kit.js';

const INK = '#1e2a3a';
const FONT = '"Fredoka", "Nunito", system-ui, sans-serif';

// --- shared painting ------------------------------------------------------------------------------

function gradient(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function shape(ctx, pts, fill, stroke = INK, lw = 4) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
}

// A thick line with a dark outline: draw(ctx) makes the path, it is stroked twice.
function rope(ctx, draw, colour, w = 10) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(); ctx.strokeStyle = INK; ctx.lineWidth = w + 6; ctx.stroke();
  draw(); ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.stroke();
}

function text(ctx, s, x, y, px, colour = INK, weight = 700, align = 'center', font = FONT) {
  ctx.font = `${weight} ${px}px ${font}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function seeded(seed) {
  return () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
}

// A round badge with an emoji and a word under it (cities, choices).
function badge(ch, word, fill, px = 56, w = 150) {
  return paint(w, px + 70, (ctx) => {
    ctx.beginPath();
    ctx.arc(w / 2, px / 2 + 14, px / 2 + 10, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.font = `${px * 0.8}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, px / 2 + 16);
    ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff';
    ctx.font = `700 28px ${FONT}`;
    ctx.strokeText(word, w / 2, px + 50);
    text(ctx, word, w / 2, px + 50, 28);
  });
}

// =================================================================================================
// 1. WRITE LIKE AN EGYPTIAN SCRIBE (History & Geography, 3-5)
// =================================================================================================

const OCHRE = '#d9a23a';
const NILE = '#2f6db5';
const LEAF = '#3a9a4a';
const CLAY = '#c8402a';

// Each sign is drawn in a 150 x 140 box, flat colours with a dark outline, the way painted
// hieroglyphs look on a tomb wall.
const SIGN = {
  vulture(ctx) {
    ctx.lineWidth = 4; ctx.strokeStyle = INK;
    shape(ctx, [[118, 82], [140, 118], [112, 104]], NILE);
    ctx.beginPath(); ctx.ellipse(82, 78, 42, 25, 0.35, 0, Math.PI * 2); ctx.fillStyle = OCHRE; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(90, 72, 30, 14, 0.35, 0, Math.PI * 2); ctx.fillStyle = NILE; ctx.fill(); ctx.stroke();
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(52, 66); ctx.lineTo(40, 44); }, OCHRE, 9);
    ctx.beginPath(); ctx.arc(38, 38, 13, 0, Math.PI * 2); ctx.fillStyle = OCHRE; ctx.fill(); ctx.stroke();
    shape(ctx, [[27, 34], [12, 40], [18, 50], [27, 44]], CLAY, INK, 3);
    ctx.beginPath(); ctx.arc(36, 35, 3, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(74, 98); ctx.lineTo(70, 132); ctx.moveTo(92, 98); ctx.lineTo(94, 132); }, OCHRE, 5);
  },
  foot(ctx) { shape(ctx, [[58, 12], [86, 12], [90, 96], [132, 104], [134, 128], [52, 128]], OCHRE); },
  basket(ctx) {
    ctx.beginPath(); ctx.moveTo(16, 58); ctx.lineTo(120, 58); ctx.bezierCurveTo(120, 124, 16, 124, 16, 58); ctx.closePath();
    ctx.fillStyle = LEAF; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.strokeStyle = '#1f6a2c'; ctx.lineWidth = 3;
    for (const y of [72, 86]) { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(112, y); ctx.stroke(); }
    rope(ctx, () => { ctx.beginPath(); ctx.arc(122, 80, 16, -Math.PI / 2, Math.PI / 2); }, LEAF, 6);
  },
  reed(ctx) {
    ctx.beginPath(); ctx.moveTo(70, 132); ctx.bezierCurveTo(50, 90, 56, 42, 80, 18); ctx.bezierCurveTo(94, 44, 92, 96, 84, 132); ctx.closePath();
    ctx.fillStyle = LEAF; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    shape(ctx, [[80, 18], [104, 10], [96, 28]], LEAF);
    ctx.strokeStyle = '#1f6a2c'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(77, 126); ctx.quadraticCurveTo(68, 70, 80, 28); ctx.stroke();
  },
  viper(ctx) {
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(24, 98); ctx.bezierCurveTo(44, 56, 72, 56, 82, 98); ctx.bezierCurveTo(92, 126, 122, 112, 138, 98); }, OCHRE, 14);
    ctx.beginPath(); ctx.ellipse(20, 98, 15, 11, 0, 0, Math.PI * 2); ctx.fillStyle = OCHRE; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(14, 88); ctx.lineTo(8, 72); ctx.moveTo(24, 88); ctx.lineTo(28, 72); }, OCHRE, 4);
    ctx.beginPath(); ctx.arc(15, 96, 2.5, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
  },
  jarStand(ctx) { shape(ctx, [[42, 22], [108, 22], [92, 78], [110, 132], [40, 132], [58, 78]], CLAY); },
  flax(ctx) {
    for (let i = 0; i < 3; i++) rope(ctx, () => { ctx.beginPath(); ctx.ellipse(75, 32 + i * 37, 26, 17, 0, 0, Math.PI * 2); }, OCHRE, 7);
  },
  cobra(ctx) {
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(22, 124); ctx.lineTo(108, 124); ctx.bezierCurveTo(134, 124, 126, 86, 102, 74); }, LEAF, 12);
    ctx.beginPath(); ctx.ellipse(96, 50, 15, 26, -0.15, 0, Math.PI * 2); ctx.fillStyle = LEAF; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.arc(90, 36, 2.5, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
  },
  water(ctx) {
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(12, 72); for (let i = 1; i <= 10; i++) ctx.lineTo(12 + i * 12.6, i % 2 ? 56 : 88); }, NILE, 7);
  },
  lasso(ctx) {
    rope(ctx, () => { ctx.beginPath(); ctx.ellipse(75, 50, 34, 30, 0, 0, Math.PI * 2); ctx.moveTo(58, 76); ctx.lineTo(86, 130); ctx.moveTo(92, 76); ctx.lineTo(64, 130); }, OCHRE, 8);
  },
  stool(ctx) {
    shape(ctx, [[30, 50], [120, 50], [120, 118], [30, 118]], NILE);
    ctx.strokeStyle = '#a8c8f0'; ctx.lineWidth = 4;
    for (const y of [66, 84, 102]) { ctx.beginPath(); ctx.moveTo(36, y); ctx.lineTo(114, y); ctx.stroke(); }
  },
  hill(ctx) {
    ctx.beginPath(); ctx.moveTo(14, 120); ctx.bezierCurveTo(28, 38, 122, 38, 136, 120); ctx.closePath();
    ctx.fillStyle = OCHRE; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = '#a06e1f';
    for (const [x, y] of [[50, 90], [75, 75], [100, 92], [64, 106], [88, 108], [75, 96]]) { ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); }
  },
  mouth(ctx) {
    ctx.beginPath(); ctx.ellipse(75, 72, 60, 22, 0, 0, Math.PI * 2); ctx.fillStyle = CLAY; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  },
  cloth(ctx) {
    shape(ctx, [[60, 38], [90, 38], [94, 132], [56, 132]], CLAY);
    shape(ctx, [[60, 38], [38, 14], [74, 18], [90, 38]], '#e8704f');
  },
  bread(ctx) {
    ctx.beginPath(); ctx.moveTo(18, 108); ctx.arc(75, 108, 57, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = OCHRE; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
  },
  bolt(ctx) {
    shape(ctx, [[38, 40], [54, 40], [54, 108], [38, 108]], OCHRE);
    shape(ctx, [[96, 40], [112, 40], [112, 108], [96, 108]], OCHRE);
    shape(ctx, [[12, 64], [138, 64], [138, 84], [12, 84]], NILE);
  },
};
SIGN.twoReeds = (ctx) => {
  for (const dx of [-26, 22]) { ctx.save(); ctx.translate(75 + dx, 140); ctx.scale(0.85, 0.95); ctx.translate(-77, -140); SIGN.reed(ctx); ctx.restore(); }
};
SIGN.basketCloth = (ctx) => {
  ctx.save(); ctx.translate(4, 34); ctx.scale(0.55, 0.6); SIGN.basket(ctx); ctx.restore();
  ctx.save(); ctx.translate(66, 18); ctx.scale(0.6, 0.85); SIGN.cloth(ctx); ctx.restore();
};

// The "alphabet" museums print for writing a name, a modern simplification of how the signs worked.
const GLYPHS = [
  ['a', 'vulture', SIGN.vulture], ['b', 'foot', SIGN.foot], ['c', 'basket', SIGN.basket], ['d', 'hand', '✋'],
  ['e', 'reed', SIGN.reed], ['f', 'horned viper', SIGN.viper], ['g', 'jar stand', SIGN.jarStand], ['h', 'twisted flax', SIGN.flax],
  ['i', 'reed', SIGN.reed], ['j', 'cobra', SIGN.cobra], ['k', 'basket', SIGN.basket], ['l', 'lion', '🦁'],
  ['m', 'owl', '🦉'], ['n', 'water', SIGN.water], ['o', 'lasso', SIGN.lasso], ['p', 'stool', SIGN.stool],
  ['q', 'hill', SIGN.hill], ['r', 'mouth', SIGN.mouth], ['s', 'folded cloth', SIGN.cloth], ['t', 'bread loaf', SIGN.bread],
  ['u', 'quail chick', '🐤'], ['v', 'horned viper', SIGN.viper], ['w', 'quail chick', '🐤'], ['x', 'basket + cloth', SIGN.basketCloth],
  ['y', 'two reeds', SIGN.twoReeds], ['z', 'door bolt', SIGN.bolt],
];

// Which sign a letter is: one plain "if" per letter, so the whole lookup runs in a single frame.
const FIND = (pad) => GLYPHS.map(([l], i) => `${pad}if ((letter (i) of (name)) = "${l}") then:\n${pad}    set "found" to ${i + 1}`).join('\n');

function glyphCostume(letter, word, sign) {
  return paint(150, 204, (ctx) => {
    if (typeof sign === 'string') {
      ctx.font = '92px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sign, 75, 74);
    } else sign(ctx);
    text(ctx, letter.toUpperCase(), 75, 166, 32);
    text(ctx, word, 75, 192, 17, '#6b3f12', 600);
  });
}

function egyptBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, 250, ['#ffb35c', '#ffe3a8']);
  ctx.fillRect(0, 0, w, 250);
  ctx.fillStyle = '#fff4c4'; ctx.beginPath(); ctx.arc(120, 90, 46, 0, Math.PI * 2); ctx.fill();
  // Pyramids and the Nile behind the papyrus.
  shape(ctx, [[540, 250], [660, 110], [780, 250]], '#e0b060', '#a07030', 4);
  shape(ctx, [[660, 110], [780, 250], [700, 250]], '#c89448', null);
  shape(ctx, [[720, 250], [820, 140], [920, 250]], '#e8c070', '#a07030', 4);
  shape(ctx, [[820, 140], [920, 250], [860, 250]], '#cf9e50', null);
  ctx.fillStyle = '#f2d38a'; ctx.fillRect(0, 236, w, 30);
  ctx.fillStyle = '#4fa3e0'; ctx.fillRect(0, 248, w, 12);
  for (const x of [330, 400, 460]) {
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, 250); ctx.quadraticCurveTo(x + 6, 200, x - 2, 160); ctx.stroke();
    ctx.fillStyle = '#3f9a4a';
    for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.ellipse(x - 2 + Math.cos(a) * 22, 160 + Math.sin(a) * 6, 26, 8, a, 0, Math.PI * 2); ctx.fill(); }
  }
  // The papyrus sheet, with its fibres and rolled ends.
  ctx.fillStyle = '#f3e2b3';
  ctx.fillRect(50, 262, 860, 340);
  const rnd = seeded(11);
  ctx.strokeStyle = 'rgba(160, 120, 60, 0.18)'; ctx.lineWidth = 2;
  for (let i = 0; i < 70; i++) { const y = 268 + rnd() * 330; ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(904, y + rnd() * 4 - 2); ctx.stroke(); }
  for (let i = 0; i < 40; i++) { const x = 56 + rnd() * 848; ctx.beginPath(); ctx.moveTo(x, 266); ctx.lineTo(x + rnd() * 4 - 2, 598); ctx.stroke(); }
  for (const x of [32, 928]) {
    ctx.fillStyle = gradient(ctx, x - 22, 0, x + 22, 0, ['#c8a060', '#f3e2b3', '#b08848']);
    ctx.beginPath(); ctx.roundRect(x - 22, 250, 44, 364, 20); ctx.fill();
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 4; ctx.stroke();
  }
  text(ctx, 'WRITE LIKE AN EGYPTIAN SCRIBE', 480, 300, 30, '#7a3f12');
  // A border of little coloured squares, the way painted walls were framed.
  const band = [CLAY, OCHRE, NILE, LEAF];
  for (let x = 60; x < 900; x += 24) {
    ctx.fillStyle = band[(x / 24) % 4 | 0]; ctx.fillRect(x, 568, 20, 16);
  }
}

const hieroglyphs = {
  id: 'hieroglyph-names', title: 'Write Like an Egyptian Scribe', kind: 'Art', grades: [3, 5], subject: 'History & Geography',
  blurb: 'Type your name and a scribe writes it in hieroglyphs, inside a royal cartouche.',
  learn: 'Ancient Egyptians wrote with picture signs called hieroglyphs, many of which stood for sounds, and royal names were written inside an oval rope called a cartouche.',
  backdrops: [{ name: 'Papyrus', paint: egyptBackdrop }],
  variables: { name: 'Cleopatra', count: 0, gap: 60, cy: -40 },
  sprites: [
    { name: 'Glyph', costumes: GLYPHS.map(([l, word, sign]) => [l, glyphCostume(l, word, sign)]), x: 0, y: -40, visible: false, variables: { i: 0, found: 0, n: 0 }, sounds: ['pop'] },
    { name: 'Rope', costumes: [['dot', circle(3, '#7a4a12', null)]], x: 0, y: 0, visible: false, variables: { half: 0, r: 0, a: 0 } },
    { name: 'Scribe', lib: 'toon-riley', use: ['idle', 'talk', 'cheer0', 'think'], x: -175, y: 100, size: 42, sounds: ['chime'] },
    { name: 'Write button', costumes: [['button', label('✍️ Write my name', '#ffc93c', INK, 24)]], x: 120, y: 145, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "name" to "Cleopatra"
    set "count" to 0
    show caption "Hieroglyphs are picture signs. Many of them stand for a SOUND, a bit like our letters."
`,
    Scribe: `
when flag clicked:
    switch costume to "talk"
    say "I'm a scribe. In ancient Egypt, scribes wrote with pictures called HIEROGLYPHS." for 4 seconds
    switch costume to "think"
    say "Watch me write a royal name: CLEOPATRA." for 2 seconds
    broadcast "write" and wait
    switch costume to "talk"
    show caption "Royal names were written inside an oval rope called a CARTOUCHE. In 1822 Champollion used names like Cleopatra's to help crack the code."
    say "See the oval rope? That's a CARTOUCHE. It shows this is a royal name." for 5 seconds
    broadcast "ask"

when I receive "ask":
    switch costume to "talk"
    show caption "Real hieroglyphs often left out vowels, and some signs meant whole words. This chart is a simple, fun version."
    ask "What is your name? I'll write it in hieroglyphs." and wait
    if ((length of (answer)) > 0) then:
        set "name" to (answer)
    broadcast "write" and wait
    switch costume to "cheer0"
    start sound "chime"
    say (join (join "Your name took " (count)) " signs! Click the yellow button to write another.") for 4 seconds
    switch costume to "idle"
`,
    'Write button': `
when this sprite clicked:
    start sound "click"
    broadcast "ask"
`,
    Glyph: `
when I receive "write":
    hide
    erase all
    set "count" to 0
    set "i" to 0
    repeat (length of (name)):
        change "i" by 1
        set "found" to 0
${FIND('        ')}
        if (((found) > 0) and ((count) < 10)) then:
            change "count" by 1
    if ((count) > 0) then:
        set "gap" to (440 / ((count) + 1.6))
        if ((gap) > 72) then:
            set "gap" to 72
        set size to ((gap) * 1.25) %
        broadcast "rope" and wait
        set "i" to 0
        set "n" to 0
        repeat (length of (name)):
            change "i" by 1
            set "found" to 0
${FIND('            ')}
            if (((found) > 0) and ((n) < (count))) then:
                change "n" by 1
                switch costume to "a"
                repeat ((found) - 1):
                    next costume
                go to x: ((0 - (((count) * (gap)) / 2)) + ((gap) * ((n) - 0.5))) y: (cy)
                show
                stamp
                hide
                start sound "pop"
                wait 0.3 seconds
`,
    Rope: `
when I receive "rope":
    set "half" to (((count) * (gap)) / 2)
    set "r" to ((gap) * 0.78)
    set pen size to 11
    set pen color to "#6b3f12"
    broadcast "trace" and wait
    set pen size to 4
    set pen color to "#f0b83a"
    broadcast "trace" and wait

when I receive "trace":
    pen up
    go to x: (0 - (half)) y: ((cy) + (r))
    pen down
    go to x: (half) y: ((cy) + (r))
    set "a" to 90
    repeat 18:
        change "a" by -10
        go to x: ((half) + ((r) * ("cos" of (a)))) y: ((cy) + ((r) * ("sin" of (a))))
    go to x: (0 - (half)) y: ((cy) - (r))
    repeat 18:
        change "a" by -10
        go to x: ((0 - (half)) + ((r) * ("cos" of (a)))) y: ((cy) + ((r) * ("sin" of (a))))
    pen up
    go to x: (((half) + (r)) + 10) y: ((cy) + ((r) * 0.8))
    pen down
    go to x: (((half) + (r)) + 10) y: ((cy) - ((r) * 0.8))
    pen up
`,
  },
  picture: [[400]],
  check: [{ frames: 700 }, { answer: 'Amira' }, { frames: 220 }, { expect: { count: 5 } }],
};

// =================================================================================================
// 2. THE SILK ROADS (History & Geography, 6-8)
// =================================================================================================

function silkBackdrop(ctx, w, h) {
  ctx.fillStyle = '#ead29a';
  ctx.fillRect(0, 0, w, h);
  // Seas.
  const sea = '#5aa8e8';
  ctx.fillStyle = sea;
  ctx.beginPath(); ctx.ellipse(120, 175, 80, 42, -0.1, 0, Math.PI * 2); ctx.fill();               // Black Sea
  shape(ctx, [[0, 290], [50, 282], [96, 320], [150, 352], [200, 392], [196, 446], [120, 470], [0, 476]], sea, null); // Mediterranean
  ctx.beginPath(); ctx.ellipse(345, 225, 26, 74, 0.1, 0, Math.PI * 2); ctx.fill();               // Caspian
  shape(ctx, [[268, 448], [334, 474], [366, 530], [330, 536], [282, 486]], sea, null);            // Persian Gulf
  shape(ctx, [[0, 610], [300, 560], [420, 600], [560, 600], [640, 720], [0, 720]], sea, null);    // Indian Ocean
  shape(ctx, [[900, 420], [960, 400], [960, 720], [860, 720], [880, 560]], sea, null);            // the China seas
  // Deserts.
  const dune = (x, y, rx, ry, fill) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(160, 110, 40, 0.45)'; ctx.lineWidth = 3;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(x + i * rx * 0.35, y + 10, rx * 0.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
  };
  dune(400, 300, 62, 34, '#f5d77a');
  dune(690, 262, 84, 34, '#f8da6e');
  dune(810, 120, 110, 40, '#f2d68a');
  dune(240, 540, 70, 36, '#f5d77a');
  text(ctx, 'Taklamakan Desert', 690, 300, 18, '#8a5a1a', 600);
  text(ctx, 'Gobi Desert', 810, 166, 18, '#8a5a1a', 600);
  // China, greener and wetter, with the Yellow River.
  shape(ctx, [[830, 0], [960, 0], [960, 400], [900, 420], [860, 560], [820, 470], [800, 330], [840, 230]], '#a8d77a', null);
  rope(ctx, () => { ctx.beginPath(); ctx.moveTo(820, 330); ctx.bezierCurveTo(850, 230, 920, 230, 900, 300); ctx.bezierCurveTo(880, 360, 940, 360, 960, 340); }, '#d8b040', 6);
  // Mountains: the Pamirs, the Tian Shan, the Himalaya.
  const peak = (x, y, s) => {
    shape(ctx, [[x - s, y], [x, y - s * 1.3], [x + s, y]], '#9a7a55', '#6b5030', 3);
    shape(ctx, [[x - s * 0.32, y - s * 0.88], [x, y - s * 1.3], [x + s * 0.32, y - s * 0.88]], '#ffffff', null);
  };
  for (const [x, y] of [[540, 230], [565, 270], [530, 300], [590, 220]]) peak(x, y, 26);
  for (let x = 620; x <= 780; x += 40) peak(x, 175, 22);
  for (let x = 600; x <= 820; x += 44) peak(x, 410 + (x % 3) * 4, 30);
  text(ctx, 'Himalaya', 710, 440, 18, '#5a3f20', 600);
  text(ctx, 'Pamir Mountains', 560, 322, 16, '#5a3f20', 600);
  // Rivers by Baghdad.
  rope(ctx, () => { ctx.beginPath(); ctx.moveTo(190, 290); ctx.quadraticCurveTo(220, 380, 300, 452); ctx.moveTo(225, 280); ctx.quadraticCurveTo(250, 370, 300, 452); }, '#5aa8e8', 4);
  // The trade route.
  const route = [[80, 250], [230, 390], [440, 240], [610, 210], [770, 190], [890, 300]];
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = '#8a3f1f'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); route.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  ctx.setLineDash([]);
  // Title and compass.
  ctx.fillStyle = 'rgba(255, 248, 225, 0.85)';
  ctx.beginPath(); ctx.roundRect(300, 18, 360, 64, 18); ctx.fill();
  ctx.strokeStyle = '#8a3f1f'; ctx.lineWidth = 4; ctx.stroke();
  text(ctx, 'THE SILK ROADS', 480, 50, 38, '#8a3f1f');
  text(ctx, 'N', 900, 36, 26, INK);
  shape(ctx, [[900, 54], [890, 96], [900, 88], [910, 96]], '#c0392b');
  text(ctx, 'EUROPE', 220, 120, 20, '#5a3f20', 600);
  text(ctx, 'CHINA', 900, 200, 22, '#2f6a2c', 700);
}

// West to east is the story backwards, so the caravan starts in the east, at Chang'an.
const CITIES = [
  { name: "Chang'an", ch: '🏮', fill: '#ff7a6a', x: 205, y: 30, cargo: 'silk',
    fact: "Chang'an (today's Xi'an) in China. Chinese silk was so prized that the way to make it was kept secret for centuries." },
  { name: 'Dunhuang', ch: '🏜️', fill: '#ffd36a', x: 145, y: 85, cargo: 'silk, water',
    fact: 'Dunhuang, an oasis at the edge of the desert. Its Mogao Caves are full of Buddhist paintings: Buddhism travelled into China along these roads.' },
  { name: 'Kashgar', ch: '🐎', fill: '#9fd7ff', x: 65, y: 75, cargo: 'silk, jade, horses',
    fact: 'Kashgar, an oasis between the Taklamakan Desert and the Pamir Mountains. Traders swapped horses, jade and cotton in its markets.' },
  { name: 'Samarkand', ch: '📜', fill: '#b8f0a0', x: -20, y: 60, cargo: 'silk, paper',
    fact: 'Samarkand, home of the Sogdian merchants. By about the 700s paper was being made here, and the skill spread west.' },
  { name: 'Baghdad', ch: '📚', fill: '#ffb0e0', x: -125, y: -15, cargo: 'silk, paper, spices',
    fact: 'Baghdad, founded in 762, became a great centre of learning. Scholars there copied and wrote books on paper.' },
  { name: 'Constantinople', ch: '⛵', fill: '#c8b8ff', x: -186, y: 55, cargo: 'silk, paper, spices',
    fact: "Constantinople (today's Istanbul), the bridge to Europe. Around 550 CE, monks are said to have smuggled silkworm eggs here." },
];

function cityScript(c, num) {
  return `
when flag clicked:
    set size to 78 %
    show
    forever:
        if (((cities) = ${num - 1}) and (touching "Caravan" ?)) then:
            set "cities" to ${num}
            set "cargo" to "${c.cargo}"
            start sound "coin"
            show caption "${c.fact}"
            repeat 3:
                change size by 12
                wait 0.1 seconds
                change size by -12
                wait 0.1 seconds
            if ((cities) = 6) then:
                broadcast "journey over"

when this sprite clicked:
    if ((cities) = ${num - 1}) then:
        set "tx" to (x position)
        set "ty" to ((y position) - 20)
        broadcast "travel"
    else:
        if ((cities) < ${num}) then:
            say "Travel the road in order: east to west!" for 2 seconds
        else:
            say "${c.name}: you have been here." for 2 seconds
`;
}

function mirroredEmoji(ch, px) {
  return paint(px + 16, px + 16, (ctx, w, h) => {
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.font = `${px}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, w / 2, h / 2 + px * 0.06);
  });
}

const silkRoad = {
  id: 'silk-road', title: 'The Silk Roads', kind: 'Game', grades: [6, 8], subject: 'History & Geography',
  blurb: "Lead a camel caravan from Chang'an in China to Constantinople, trading goods and ideas at every oasis city.",
  learn: 'The Silk Roads were a web of trade routes linking China with western Asia and Europe for about 1,500 years, carrying goods like silk and paper, and ideas and religions too.',
  backdrops: [{ name: 'Silk Roads map', paint: silkBackdrop }],
  variables: { cities: 1, cargo: 'silk', tx: 0, ty: 0 },
  monitors: [['cities', 'normal', 8, 8], ['cargo', 'normal', 8, 34]],
  sounds: ['tune-wonder'],
  sprites: [
    ...CITIES.map((c) => ({ name: c.name, costumes: [['city', badge(c.ch, c.name, c.fill, 54, 230)]], x: c.x, y: c.y, size: 78, sounds: ['coin'] })),
    { name: 'Caravan', costumes: [['camel', mirroredEmoji('🐫', 96)]], x: 196, y: 0, size: 70, rotationStyle: 'left-right', direction: -90, sounds: ['footsteps'] },
    { name: 'Merchant', lib: 'toon-leo', use: ['idle', 'talk', 'cheer0'], x: 205, y: -58, size: 40 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "cities" to 1
    set "cargo" to "silk"
    show caption "The Silk Roads linked China and the Mediterranean for about 1,500 years, from about 130 BCE. Click the next city, or drive with the arrow keys."
    play sound "tune-wonder" until done

when I receive "journey over":
    wait 5 seconds
    show caption "Most traders only travelled one part of the way. Goods passed from hand to hand, and so did ideas, religions and inventions like paper."
`,
    ...Object.fromEntries(CITIES.map((c, i) => [c.name, i === 0 ? `
when flag clicked:
    set size to 78 %
    show

when this sprite clicked:
    say "Chang'an: you start here, with a load of silk." for 2 seconds
` : cityScript(c, i + 1)])),
    Caravan: `
when flag clicked:
    go to x: 196 y: 0
    point in direction -90
    go to "front" layer
    erase all
    set pen color to "#c0392b"
    set pen size to 4
    pen down
    forever:
        if (key "left arrow" pressed?) then:
            point in direction -90
            change x by -3
        if (key "right arrow" pressed?) then:
            point in direction 90
            change x by 3
        if (key "up arrow" pressed?) then:
            change y by 3
        if (key "down arrow" pressed?) then:
            change y by -3

when I receive "travel":
    start sound "footsteps"
    if ((tx) < (x position)) then:
        point in direction -90
    else:
        point in direction 90
    go to "front" layer
    glide 2 secs to x: (tx) y: (ty)
`,
    Merchant: `
when flag clicked:
    switch costume to "talk"
    say "Let's carry silk west! The road crosses deserts and mountains." for 4 seconds
    say "It wasn't one road: it was many routes, and the name 'Silk Road' was only made up in the 1870s." for 5 seconds
    switch costume to "idle"

when I receive "journey over":
    switch costume to "cheer0"
    say "We made it to Constantinople! But few traders ever went the whole way." for 5 seconds
    switch costume to "idle"
`,
  },
  picture: [[60], [10, ['left arrow']]],
  check: [{ frames: 30 }, { click: 'Dunhuang' }, { frames: 90 }, { click: 'Kashgar' }, { frames: 90 }, { click: 'Samarkand' }, { frames: 90 },
    { click: 'Baghdad' }, { frames: 90 }, { click: 'Constantinople' }, { frames: 120 }, { expect: { cities: 6 } }],
};

// =================================================================================================
// 3. LONGITUDE BY THE CLOCK (History & Geography, 9-12)
// =================================================================================================

// Rough outlines, [longitude, latitude], good enough to recognise the continents at this size.
const LAND = [
  [[-168, 66], [-160, 71], [-140, 70], [-125, 72], [-95, 72], [-80, 73], [-62, 66], [-55, 52], [-66, 45], [-70, 42], [-76, 35], [-81, 31], [-80, 25], [-83, 29], [-90, 29], [-97, 26], [-97, 20], [-92, 18], [-87, 21], [-88, 15], [-83, 9], [-77, 8], [-80, 7], [-85, 11], [-92, 14], [-105, 20], [-110, 23], [-112, 30], [-117, 32], [-124, 40], [-124, 48], [-133, 56], [-150, 60], [-165, 60]],
  [[-55, 60], [-45, 60], [-20, 70], [-20, 80], [-60, 80], [-72, 78], [-55, 70]],
  [[-77, 8], [-72, 12], [-62, 10], [-50, 0], [-35, -6], [-39, -15], [-48, -26], [-58, -35], [-65, -42], [-68, -52], [-72, -50], [-74, -40], [-71, -30], [-70, -18], [-76, -13], [-81, -5], [-80, 0]],
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [2, 51], [5, 53], [8, 57], [5, 62], [12, 66], [20, 70], [30, 71], [40, 68], [60, 68], [70, 73], [100, 78], [140, 73], [180, 68], [180, 64], [160, 58], [155, 50], [140, 47], [135, 35], [122, 30], [120, 22], [109, 20], [105, 10], [100, 13], [100, 3], [104, 1], [98, 8], [92, 22], [80, 15], [78, 8], [73, 20], [67, 24], [57, 25], [56, 22], [52, 17], [43, 12], [34, 28], [35, 35], [28, 41], [26, 38], [22, 37], [20, 40], [15, 38], [12, 44], [8, 44], [3, 43], [-1, 37], [-6, 36]],
  [[-6, 50], [2, 51], [0, 53], [-2, 57], [-5, 59], [-6, 56], [-5, 54]],
  [[-17, 21], [-10, 30], [-6, 36], [10, 37], [20, 32], [32, 31], [34, 28], [43, 12], [51, 12], [40, -2], [40, -15], [35, -24], [32, -29], [20, -35], [18, -30], [12, -17], [13, -6], [9, 4], [-8, 4], [-17, 14]],
  [[44, -25], [50, -15], [49, -12], [44, -17]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -25], [150, -37], [140, -38], [135, -35], [129, -32], [115, -34]],
  [[130, 31], [136, 34], [141, 36], [142, 43], [140, 41], [135, 35]],
  [[95, 5], [105, -6], [115, -8], [110, -2], [100, 0]],
  [[110, 1], [118, 7], [119, 0], [115, -4], [110, -2]],
  [[131, -1], [141, -3], [150, -10], [141, -9], [133, -4]],
  [[167, -46], [174, -41], [178, -38], [173, -35], [172, -41], [167, -46]],
];
const EQUATOR_PX = 232;   // stage y 64; 1 degree = 4/3 steps = 8/3 px
const lonPx = (lon) => (lon + 180) * 960 / 360;
const latPx = (lat) => EQUATOR_PX - lat * 960 / 360;

function longitudeBackdrop(ctx, w, h) {
  const top = latPx(78);
  const bottom = latPx(-56);
  ctx.fillStyle = '#4c88c8';
  ctx.fillRect(0, top, w, bottom - top);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, top, w, bottom - top); ctx.clip();
  for (const poly of LAND) shape(ctx, poly.map(([lo, la]) => [lonPx(lo), latPx(la)]), '#8cc66a', '#3f6a2a', 2.5);
  // The grid: every 30 degrees.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'; ctx.lineWidth = 1.5;
  for (let lo = -150; lo <= 150; lo += 30) { ctx.beginPath(); ctx.moveTo(lonPx(lo), top); ctx.lineTo(lonPx(lo), bottom); ctx.stroke(); }
  for (let la = -30; la <= 60; la += 30) { ctx.beginPath(); ctx.moveTo(0, latPx(la)); ctx.lineTo(w, latPx(la)); ctx.stroke(); }
  ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, latPx(0)); ctx.lineTo(w, latPx(0)); ctx.stroke();
  ctx.strokeStyle = '#ff7a6a';
  ctx.beginPath(); ctx.moveTo(lonPx(0), top); ctx.lineTo(lonPx(0), bottom); ctx.stroke();
  for (let lo = -150; lo <= 150; lo += 30) text(ctx, lo === 0 ? '0°' : `${Math.abs(lo)}°${lo < 0 ? 'W' : 'E'}`, lonPx(lo) + 4, bottom - 12, 15, '#ffffff', 700, 'left');
  for (const la of [-30, 30, 60]) text(ctx, `${Math.abs(la)}°${la < 0 ? 'S' : 'N'}`, w - 6, latPx(la) - 10, 15, '#ffffff', 700, 'right');
  text(ctx, 'EQUATOR 0°', 150, latPx(0) - 12, 16, '#ffe14a', 700, 'left');
  text(ctx, 'PRIME MERIDIAN (Greenwich)', lonPx(0) + 6, latPx(70) + 8, 15, '#ffd0c8', 700, 'left');
  ctx.restore();
  // The navigator's desk under the map.
  ctx.fillStyle = gradient(ctx, 0, bottom, 0, h, ['#7a4a26', '#4a2a14']);
  ctx.fillRect(0, bottom, w, h - bottom);
  const panel = (x, w2, title) => {
    ctx.fillStyle = '#10223f'; ctx.beginPath(); ctx.roundRect(x, bottom + 8, w2, 146, 14); ctx.fill();
    ctx.strokeStyle = '#e0b050'; ctx.lineWidth = 4; ctx.stroke();
    text(ctx, title, x + w2 / 2, bottom + 24, 16, '#ffd36a');
  };
  panel(14, 290, 'STAR SIGHT: LATITUDE');
  panel(318, 324, 'THE RULE');
  panel(656, 290, 'NOON SIGHT: LONGITUDE');
  // Star sight: horizon and a quarter-circle protractor round (60, 520).
  ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(30, 520); ctx.lineTo(290, 520); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(60, 520, 120, -Math.PI / 2, 0); ctx.stroke();
  for (const d of [0, 30, 60]) {
    const a = -d * Math.PI / 180;
    text(ctx, `${d}°`, 60 + Math.cos(a) * 140, 520 + Math.sin(a) * 132, 14, '#ffffff', 600);
  }
  text(ctx, 'horizon', 250, 532, 13, '#7fd0ff', 600);
  // The rule.
  const rule = ['Earth turns 360° in 24 hours,', 'so 15° every hour.', 'Hours from Greenwich noon × 15°', '= your longitude.', 'Noon LATER than Greenwich: WEST', 'Noon EARLIER: EAST'];
  rule.forEach((s, i) => text(ctx, s, 480, bottom + 46 + i * 19, 15, i > 3 ? '#ffd36a' : '#ffffff', i > 3 ? 700 : 600));
  // Noon sight: a horizon and the Sun's arc.
  ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(670, 525); ctx.lineTo(932, 525); ctx.stroke();
  ctx.setLineDash([6, 8]); ctx.strokeStyle = 'rgba(255, 220, 120, 0.6)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(790, 525, 96, Math.PI, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
}

const longitude = {
  id: 'longitude-clock', title: 'Longitude by the Clock', kind: 'Simulation', grades: [9, 12], subject: 'History & Geography',
  blurb: 'Find two lost ships the way 18th-century navigators did: latitude from the North Star, longitude from a clock.',
  learn: 'Latitude and longitude as angles; how the height of Polaris gives latitude; and how Earth turning 15° an hour lets a clock set to Greenwich time give longitude, the problem John Harrison\'s sea clocks solved.',
  backdrops: [{ name: 'Chart and desk', paint: longitudeBackdrop }],
  variables: { score: 0, latitude: '0°', longitude: '0°', star: 0, clock: '12:00', mode: 'quiz', tx: 0, ty: 0 },
  monitors: [['latitude', 'normal', 8, 8], ['longitude', 'normal', 110, 8], ['score', 'normal', 220, 8]],
  sounds: ['tune-chill', 'chime', 'hit'],
  sprites: [
    { name: 'Ship', costumes: [['ship', emoji('🚢', 80)]], x: 0, y: 64, size: 75, rotationStyle: "don't rotate", visible: false, variables: { lat: 0, lon: 0 }, sounds: ['splash'] },
    { name: 'Polaris', costumes: [['star', emoji('⭐', 50)]], x: -150, y: -80, size: 60, variables: { a: 0 } },
    { name: 'Sun', costumes: [['sun', emoji('☀️', 60)]], x: 110, y: -82, size: 50, visible: false, variables: { a: 170 } },
    { name: 'Clock', costumes: [['clock', emoji('🕰️', 70)]], x: 214, y: -42, size: 55 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "mode" to "quiz"
    show caption "LATITUDE says how far north or south of the Equator you are. LONGITUDE says how far east or west of Greenwich. Two ships are lost!"
    start sound "tune-chill"
    wait 5 seconds
    broadcast "mystery 1" and wait
    broadcast "mystery 2" and wait
    show caption (join (join "You found both ships: " (score)) " out of 4. In 1714 Britain offered a prize for this. John Harrison's sea clocks solved it. Now steer with the arrow keys!")
    set "mode" to "explore"

when I receive "mystery 1":
    set "star" to 40
    broadcast "sight" and wait
    show caption "Ship 1: Polaris, the North Star, is 40° above the horizon. Polaris sits almost straight above the North Pole."
    ask "What is ship 1's LATITUDE, in degrees north?" and wait
    if ((answer) contains "40" ?) then:
        change "score" by 1
        start sound "chime"
        show caption "Yes! The height of Polaris is about the same as your latitude: 40°N."
    else:
        start sound "hit"
        show caption "The height of Polaris is about the same as your latitude, so ship 1 is at 40°N."
    wait 4 seconds
    set "clock" to "16:00"
    broadcast "noon" and wait
    show caption "At LOCAL NOON the Sun is highest. The ship's clock, still on Greenwich time, says 16:00: 4 hours after noon in Greenwich."
    ask "What is ship 1's LONGITUDE? (degrees, and E or W)" and wait
    if (((answer) contains "60" ?) and ((answer) contains "w" ?)) then:
        change "score" by 1
        start sound "chime"
        show caption "Right! 4 hours × 15° = 60°, and noon came LATER than Greenwich, so the ship is WEST."
    else:
        start sound "hit"
        show caption "4 hours × 15° = 60°. Noon came LATER than in Greenwich, so the ship is 60° WEST."
    set "tx" to -80
    set "ty" to 117
    broadcast "reveal" and wait

when I receive "mystery 2":
    set "star" to 20
    broadcast "sight" and wait
    show caption "Ship 2: Polaris is only 20° above the horizon. The ship must be further south."
    ask "What is ship 2's LATITUDE, in degrees north?" and wait
    if ((answer) contains "20" ?) then:
        change "score" by 1
        start sound "chime"
        show caption "Yes: 20°N."
    else:
        start sound "hit"
        show caption "Polaris is 20° up, so the ship is at about 20°N."
    wait 3 seconds
    set "clock" to "08:00"
    broadcast "noon" and wait
    show caption "Local noon! But the Greenwich clock says only 08:00. Noon came 4 hours EARLIER than in Greenwich."
    ask "What is ship 2's LONGITUDE? (degrees, and E or W)" and wait
    if ((((answer) contains "60" ?) and ((answer) contains "e" ?)) and (not ((answer) contains "w" ?))) then:
        change "score" by 1
        start sound "chime"
        show caption "Right! 4 hours × 15° = 60°, and noon came EARLIER, so the ship is EAST."
    else:
        start sound "hit"
        show caption "4 hours × 15° = 60°. Noon came EARLIER, so the ship is 60° EAST."
    set "tx" to 80
    set "ty" to 91
    broadcast "reveal" and wait
`,
    Ship: `
when flag clicked:
    hide
    go to x: 0 y: 64

when I receive "reveal":
    go to x: 0 y: 64
    show
    start sound "splash"
    glide 2 secs to x: (tx) y: (ty)
    if ((tx) < 0) then:
        say "40°N 60°W: the open Atlantic Ocean!" for 3 seconds
    else:
        say "20°N 60°E: the Arabian Sea, off Oman!" for 3 seconds

when I receive "noon":
    hide

when flag clicked:
    forever:
        if ((mode) = "explore") then:
            show
            if (key "left arrow" pressed?) then:
                change x by -2
            if (key "right arrow" pressed?) then:
                change x by 2
            if (key "up arrow" pressed?) then:
                change y by 2
            if (key "down arrow" pressed?) then:
                change y by -2
            if ((y position) > 168) then:
                set y to 168
            if ((y position) < -8) then:
                set y to -8
        set "lat" to (round (((y position) - 64) * 0.75))
        set "lon" to (round ((x position) * 0.75))
        if ((lat) < 0) then:
            set "latitude" to (join (0 - (lat)) "°S")
        else:
            set "latitude" to (join (lat) "°N")
        if ((lon) < 0) then:
            set "longitude" to (join (0 - (lon)) "°W")
        else:
            set "longitude" to (join (lon) "°E")
`,
    Polaris: `
when flag clicked:
    go to x: -150 y: -80

when I receive "sight":
    go to x: -150 y: -80
    say "Polaris" for 1 seconds
    glide 1.5 secs to x: (-210 + (60 * ("cos" of (star)))) y: (-80 + (60 * ("sin" of (star))))
    say (join (star) "° up")

when I receive "noon":
    say ""
`,
    Sun: `
when flag clicked:
    hide

when I receive "noon":
    set "a" to 175
    go to x: (155 + (48 * ("cos" of (a)))) y: (-82.5 + (48 * ("sin" of (a))))
    show
    repeat 17:
        change "a" by -5
        go to x: (155 + (48 * ("cos" of (a)))) y: (-82.5 + (48 * ("sin" of (a))))
        wait 0.06 seconds
    say "Local noon!" for 1.5 seconds
`,
    Clock: `
when flag clicked:
    say "Greenwich time" for 3 seconds

when I receive "noon":
    wait 1 seconds
    say (join "Greenwich: " (clock))
`,
  },
  picture: [[260]],
  check: [{ frames: 260 }, { answer: '40' }, { frames: 260 }, { answer: '60 W' }, { frames: 320 }, { answer: '20' }, { frames: 240 },
    { answer: '60 E' }, { frames: 200 }, { expect: { score: 4 } }, { frames: 30, keys: ['up arrow'] }],
};

// =================================================================================================
// 4. MELODY MAKER (Art & Music, 3-5)
// =================================================================================================

// Note, name, the computer key that plays it, and a colour (the rainbow order many classroom bells use).
const KEYS = [
  [60, 'C', 'a', '#ff4d4d'], [62, 'D', 's', '#ff9a3d'], [64, 'E', 'd', '#ffd93d'], [65, 'F', 'f', '#5ccf5c'],
  [67, 'G', 'g', '#3dc7c7'], [69, 'A', 'h', '#4d8dff'], [71, 'B', 'j', '#a35cff'], [72, 'C', 'k', '#ff4da6'],
];
const keyX = (i) => -196 + i * 56;
const INSTRUMENTS = ['piano', 'marimba', 'flute', 'bell'];

function concertBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, h, ['#2a1a5e', '#5a2a8a', '#8a3a8a']);
  ctx.fillRect(0, 0, w, h);
  // Curtains.
  for (const side of [0, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side ? w - 20 - i * 22 : 20 + i * 22;
      ctx.fillStyle = i % 2 ? '#b0213a' : '#d42e4a';
      ctx.beginPath(); ctx.moveTo(x - 14, 0); ctx.lineTo(x + 14, 0); ctx.lineTo(x + 18, h); ctx.lineTo(x - 18, h); ctx.fill();
    }
  }
  // Spotlight on the keyboard.
  const spot = ctx.createRadialGradient(480, 420, 40, 480, 420, 460);
  spot.addColorStop(0, 'rgba(255, 240, 200, 0.35)');
  spot.addColorStop(1, 'rgba(255, 240, 200, 0)');
  ctx.fillStyle = spot; ctx.fillRect(0, 0, w, h);
  // The staff: five lines, and each key's note sitting on it, so you can see pitch go UP.
  const staff = [186, 171, 156, 141, 126];
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath(); ctx.roundRect(46, 106, 868, 116, 16); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
  for (const y of staff) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(900, y); ctx.stroke(); }
  text(ctx, 'THE STAFF', 100, 115, 13, '#5a2a8a');
  KEYS.forEach(([note, name], i) => {
    const x = (keyX(i) + 240) * 2;
    const y = 201 - i * 7.5;
    if (i === 0) { ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x + 20, y); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(x, y, 11, 8, -0.35, 0, Math.PI * 2);
    ctx.fillStyle = KEYS[i][3]; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 10, y - 2); ctx.lineTo(x + 10, y - 44); ctx.stroke();
  });
  // Floor.
  ctx.fillStyle = '#3a2210'; ctx.fillRect(0, 610, w, 110);
}

function pianoKey(name, kb, fill) {
  return paint(104, 224, (ctx) => {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.roundRect(4, 4, 96, 216, [6, 6, 20, 20]); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.fillRect(14, 60, 18, 110);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(52, 172, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, name, 52, 174, 38);
    text(ctx, `key ${kb.toUpperCase()}`, 52, 40, 18, INK, 700);
  });
}

function keyScript([note, name, kb], i) {
  const play = (beats) => `
    change "played" by 1
    set "nx" to (x position)
    set "ny" to ${note}
    broadcast "sparkle"
    set "brightness" effect to 45
    set y to -30
    play note ${note} for ${beats} beats
    set y to -25
    clear graphic effects`;
  return `
when flag clicked:
    set instrument to "piano"
    set y to -25
    clear graphic effects

when this sprite clicked:${play(0.4)}

when "${kb}" key pressed:${play(0.4)}

when I receive "play":
    if ((now) = ${note}) then:${play('(dur)').split('\n').join('\n    ')}
${INSTRUMENTS.map((ins) => `
when I receive "${ins}":
    set instrument to "${ins}"`).join('\n')}
`;
}

const melody = {
  id: 'melody-maker', title: 'Melody Maker', kind: 'Game', grades: [3, 5], subject: 'Art & Music',
  blurb: 'Play a rainbow keyboard with the mouse or the A to K keys, hear famous tunes, then write your own song in letters.',
  learn: 'Notes have letter names, C D E F G A B C is a scale that climbs in pitch, an octave is eight notes up, and rhythm is how long each note lasts.',
  backdrops: [{ name: 'Concert hall', paint: concertBackdrop }],
  variables: { song: 'CCGGAAGFFEEDDC', beats: '22222242222224', now: 60, dur: 0.5, nx: 0, ny: 60, played: 0, instrument: 'piano', inst: 1, i: 0 },
  monitors: [['song', 'normal', 8, 8], ['beats', 'normal', 8, 32], ['instrument', 'normal', 330, 8]],
  sprites: [
    ...KEYS.map(([note, name, kb, fill], i) => ({ name: i === 7 ? 'High C' : name, costumes: [['key', pianoKey(name, kb, fill)]], x: keyX(i), y: -25, size: 100 })),
    { name: 'Note', costumes: [['note', emoji('🎵', 60)], ['notes', emoji('🎶', 60)]], x: 0, y: 50, visible: false },
    { name: 'Twinkle', costumes: [['button', label('▶ Twinkle Twinkle', '#ffc93c', INK, 22)]], x: -150, y: 50, sounds: ['click'] },
    { name: 'Ode to Joy', costumes: [['button', label('▶ Ode to Joy', '#8fd0ff', INK, 22)]], x: 10, y: 50, sounds: ['click'] },
    { name: 'Instrument', costumes: [['button', label('🎹 Change sound', '#ff9ad5', INK, 22)]], x: 160, y: 50, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "played" to 0
    set "instrument" to "piano"
    set "inst" to 1
    set "song" to "CCGGAAGFFEEDDC"
    set "beats" to "22222242222224"
    show caption "Click the keys or press A to K. Keys to the right are HIGHER. C up to C is a SCALE of 8 notes: one OCTAVE."
    wait 6 seconds
    show caption "Press SPACE to play the song variable. Change its letters, and its beats (2 short, 4 long), to write a tune!"

when "space" key pressed:
    broadcast "song"

when I receive "song":
    set "i" to 0
    repeat (length of (song)):
        change "i" by 1
        set "now" to 0
${KEYS.slice(0, 7).map(([note, name]) => `        if ((letter (i) of (song)) = "${name}") then:
            set "now" to ${note}`).join('\n')}
        set "dur" to ((letter (i) of (beats)) * 0.25)
        if ((dur) = 0) then:
            set "dur" to 0.5
        if ((now) > 0) then:
            broadcast "play" and wait
        else:
            wait (dur) seconds
`,
    ...Object.fromEntries(KEYS.map((k, i) => [i === 7 ? 'High C' : k[1], keyScript(k, i)])),
    Note: `
when flag clicked:
    hide

when I receive "sparkle":
    create clone of "myself"

when I start as a clone:
    go to x: (nx) y: 35
    set size to 55 %
    set "color" effect to (((ny) - 60) * 16)
    if ((pick random 1 to 2) = 2) then:
        next costume
    show
    repeat 22:
        change y by 3
        change x by (pick random -2 to 2)
        change "ghost" effect by 4.5
    delete this clone
`,
    Twinkle: `
when this sprite clicked:
    start sound "click"
    set "song" to "CCGGAAGFFEEDDC"
    set "beats" to "22222242222224"
    show caption "Twinkle, Twinkle, Little Star: an old tune. It leaps from C up to G, climbs to A, then steps back down."
    broadcast "song"
`,
    'Ode to Joy': `
when this sprite clicked:
    start sound "click"
    set "song" to "EEFGGFEDCCDEEDD"
    set "beats" to "222222222222314"
    show caption "Ode to Joy, by Beethoven (1824). It moves mostly in STEPS, to the very next key: easy to sing!"
    broadcast "song"
`,
    Instrument: `
when this sprite clicked:
    start sound "click"
    change "inst" by 1
    if ((inst) > 4) then:
        set "inst" to 1
${INSTRUMENTS.map((ins, i) => `    if ((inst) = ${i + 1}) then:
        set "instrument" to "${ins}"
        broadcast "${ins}"`).join('\n')}
    show caption "Same notes, new instrument! The PITCH stays the same; the TIMBRE (the sound's colour) changes."
`,
  },
  picture: [[40], [1], [80]],
  check: [{ frames: 20 }, { press: 'a' }, { frames: 20 }, { press: 'g' }, { frames: 20 }, { expect: { played: 2 } }, { click: 'Instrument' }, { click: 'Twinkle' }, { frames: 330 },
    { expect: { played: 16 } }, { click: 'Ode to Joy' }, { frames: 60 }],
};

// =================================================================================================
// 5. THE COLOUR WHEEL (Art & Music, 6-8)
// =================================================================================================

// The painter's (red-yellow-blue) wheel, clockwise from yellow at the top, one step every 30 degrees.
const WHEEL = [
  ['yellow', '#ffe11a', 'primary'], ['yellow-orange', '#ffb81a', 'tertiary'], ['orange', '#ff8c1a', 'secondary'],
  ['red-orange', '#ff5a1f', 'tertiary'], ['red', '#e8262a', 'primary'], ['red-violet', '#c2247a', 'tertiary'],
  ['violet', '#7b2fa8', 'secondary'], ['blue-violet', '#4a3fb5', 'tertiary'], ['blue', '#1f5fd1', 'primary'],
  ['blue-green', '#16a39a', 'tertiary'], ['green', '#2fae3e', 'secondary'], ['yellow-green', '#a6d02a', 'tertiary'],
];
const WHEEL_X = -80;
const WHEEL_Y = 15;

function wheelBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, w, h, ['#fff7ea', '#ffe9f2', '#eaf4ff']);
  ctx.fillRect(0, 0, w, h);
  // Paint splats.
  const rnd = seeded(5);
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `${WHEEL[i % 12][1]}33`;
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 20 + rnd() * 40, 0, Math.PI * 2); ctx.fill();
  }
  const cx = (WHEEL_X + 240) * 2;
  const cy = (180 - WHEEL_Y) * 2;
  WHEEL.forEach(([name, col, type], i) => {
    const a0 = (i * 30 - 15 - 90) * Math.PI / 180;
    const a1 = (i * 30 + 15 - 90) * Math.PI / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 248, a0, a1); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    const am = (i * 30 - 90) * Math.PI / 180;
    const tag = type[0].toUpperCase();
    ctx.beginPath(); ctx.arc(cx + Math.cos(am) * 205, cy + Math.sin(am) * 205, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
    text(ctx, tag, cx + Math.cos(am) * 205, cy + Math.sin(am) * 206, 19);
  });
  ctx.beginPath(); ctx.arc(cx, cy, 248, 0, Math.PI * 2); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 64, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 5; ctx.stroke();
  // The key, and titles over the swatches.
  text(ctx, 'P = primary   S = secondary   T = tertiary', 320, 652 - 50, 20, INK, 600);
  text(ctx, 'YOUR COLOUR', 680, 116, 20, INK);
  text(ctx, 'ITS COMPLEMENT', 860, 116, 20, INK);
}

function swatch(col) {
  return paint(154, 174, (ctx) => {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.roundRect(2, 2, 150, 170, 10); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
  });
}

function pointer() {
  return paint(60, 500, (ctx) => {
    // Solid end: your colour. Ring end: the colour opposite it, the complement.
    rope(ctx, () => { ctx.beginPath(); ctx.moveTo(30, 60); ctx.lineTo(30, 440); }, '#ffffff', 8);
    shape(ctx, [[30, 8], [52, 58], [8, 58]], '#ffffff', INK, 4);
    ctx.beginPath(); ctx.arc(30, 462, 22, 0, Math.PI * 2); ctx.lineWidth = 12; ctx.strokeStyle = INK; ctx.stroke();
    ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(30, 250, 14, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
  });
}

const colourWheel = {
  id: 'colour-wheel', title: 'The Colour Wheel', kind: 'Simulation', grades: [6, 8], subject: 'Art & Music',
  blurb: 'Spin the pointer round the painter\'s colour wheel and see every colour beside its complement, then take the quiz.',
  learn: 'Primary, secondary and tertiary colours on the painter\'s wheel, and complementary colours: opposites that make each other look brighter side by side and turn brown or grey when mixed.',
  backdrops: [{ name: 'Colour wheel', paint: wheelBackdrop }],
  variables: { seg: -1, comp: 6, score: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sounds: ['tune-playful'],
  sprites: [
    { name: 'Pointer', costumes: [['pointer', pointer()]], x: WHEEL_X, y: WHEEL_Y, size: 100, rotationStyle: 'all around', variables: { s: 0 }, sounds: ['pop'] },
    { name: 'Your colour', costumes: WHEEL.map(([, col], i) => [`c${i}`, swatch(col)]), x: 100, y: 75 },
    { name: 'Complement', costumes: WHEEL.map(([, col], i) => [`c${i}`, swatch(col)]), x: 180, y: 75 },
    { name: 'Your name', costumes: WHEEL.map(([n, , t], i) => [`c${i}`, label(`${n} (${t})`, '#ffffff', INK, 21)]), x: 140, y: 18 },
    { name: 'Its name', costumes: WHEEL.map(([n, , t], i) => [`c${i}`, label(`opposite: ${n}`, '#fff3c4', INK, 21)]), x: 140, y: -14 },
    { name: 'Artist', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'think'], x: -212, y: 105, size: 36 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    show caption "This is the PAINTER'S colour wheel. RED, YELLOW and BLUE are the PRIMARY colours: you can't mix them from other paints."
    start sound "tune-playful"
    wait 6 seconds
    show caption "Mix two primaries for a SECONDARY (orange, green, violet). Mix a primary with a secondary beside it for a TERTIARY."
    wait 6 seconds
    show caption "Opposite colours are COMPLEMENTS. Drag the pointer round the wheel, or press the arrow keys. Press Q for the quiz."
`,
    Pointer: `
when flag clicked:
    go to x: ${WHEEL_X} y: ${WHEEL_Y}
    point in direction 0
    set "seg" to -1
    repeat 12:
        wait 0.8 seconds
        turn right 30 degrees
    forever:
        if (((mouse down?) and ((mouse x) < 50)) and ((distance to "mouse-pointer") > 12)) then:
            point towards "mouse-pointer"

when flag clicked:
    forever:
        set "s" to ((round ((direction) / 30)) mod 12)
        if (not ((s) = (seg))) then:
            set "seg" to (s)
            set "comp" to (((s) + 6) mod 12)
            start sound "pop"
            broadcast "update"

when "right arrow" key pressed:
    point in direction (((seg) + 1) * 30)

when "left arrow" key pressed:
    point in direction (((seg) - 1) * 30)
`,
    'Your colour': `
when I receive "update":
    switch costume to "c0"
    repeat (seg):
        next costume
`,
    Complement: `
when I receive "update":
    switch costume to "c0"
    repeat (comp):
        next costume
`,
    'Your name': `
when I receive "update":
    switch costume to "c0"
    repeat (seg):
        next costume
`,
    'Its name': `
when I receive "update":
    switch costume to "c0"
    repeat (comp):
        next costume
`,
    Artist: `
when flag clicked:
    switch costume to "talk"
    say "Look at the two big squares. Complements make each other look BRIGHTER." for 5 seconds
    say "Mix them as paint, though, and they cancel out into a brown or grey." for 5 seconds
    say "Van Gogh used clashing reds and greens in The Night Café (1888) to show strong feelings." for 5 seconds
    say "This wheel is for paint. Light mixes differently: screens use red, green and blue." for 5 seconds
    switch costume to "idle"

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "What is the complement of BLUE?" and wait
    if ((answer) contains "orange" ?) then:
        change "score" by 1
        say "Yes! Blue and orange." for 1.5 seconds
    else:
        say "It's orange, opposite blue." for 2 seconds
    ask "What is the complement of RED?" and wait
    if ((answer) contains "green" ?) then:
        change "score" by 1
        say "Right! Red and green." for 1.5 seconds
    else:
        say "It's green." for 2 seconds
    ask "What is the complement of YELLOW?" and wait
    if (((answer) contains "violet" ?) or ((answer) contains "purple" ?)) then:
        change "score" by 1
        say "Yes! Yellow and violet (purple)." for 1.5 seconds
    else:
        say "It's violet, also called purple." for 2 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 3!")
`,
  },
  picture: [[150]],
  check: [{ frames: 330 }, { press: 'right arrow' }, { frames: 10 }, { press: 'q' }, { frames: 10 }, { answer: 'orange' }, { frames: 60 },
    { answer: 'green' }, { frames: 60 }, { answer: 'purple' }, { frames: 60 }, { expect: { score: 3, seg: 1 } }],
};

// =================================================================================================
// 6. SEURAT'S DOTS (Art & Music, 9-12)
// =================================================================================================

function galleryBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, h, ['#1f4a52', '#2c6068', '#1a3a40']);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'; ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  // The gold frame round the canvas (stage x -145..145, y -50..145).
  ctx.fillStyle = gradient(ctx, 0, 40, 0, 500, ['#f7d774', '#b8862a', '#f0c860', '#9a6a1a']);
  ctx.fillRect(170, 18, 620, 476);
  ctx.strokeStyle = '#6b4410'; ctx.lineWidth = 5; ctx.strokeRect(170, 18, 620, 476);
  ctx.strokeRect(186, 34, 588, 444);
  ctx.fillStyle = '#fbf6e8'; ctx.fillRect(190, 70 - 40, 580, 430);
  // A floor bench line and a plaque.
  ctx.fillStyle = '#3a2412'; ctx.fillRect(0, 640, w, 80);
  ctx.fillStyle = '#f3e7c8'; ctx.beginPath(); ctx.roundRect(318, 474, 324, 28, 6); ctx.fill();
  ctx.strokeStyle = '#6b4410'; ctx.lineWidth = 2; ctx.stroke();
  text(ctx, 'In the style of Georges Seurat (1859-1891)', 480, 488, 15, '#5a3a14', 700, 'center', 'Georgia, serif');
}

const PALETTE = [['red', '#e8262a'], ['orange', '#ff8c1a'], ['yellow', '#ffe11a'], ['green', '#2fae3e'], ['blue', '#1f5fd1'], ['violet', '#8a3fd0'], ['white', '#ffffff']];

// Zones of the painting, and the PURE colours each is made of: never a mixed paint.
const ZONES = [
  ['grass', ['#36a845', '#b5d930', '#ffe14a']],
  ['shadow', ['#1f7a4a', '#3d5be0', '#8a5ad0']],
  ['water', ['#2a62d1', '#ffffff', '#2fb3a8']],
  ['sky', ['#3f7fe0', '#9cc8ff', '#c9b6ff']],
  ['trunk', ['#d8402a', '#ff8a1f', '#1f8a3a']],
  ['tree', ['#1f8a3a', '#5cc24a', '#2b55c8']],
  ['sun', ['#ffd21f', '#ff9a1f', '#fff6c2']],
];

function dotPot(col, name) {
  return paint(84, 90, (ctx) => {
    ctx.fillStyle = '#e8e0d0'; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(10, 30, 64, 52, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(42, 32, 32, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, name, 42, 62, 13);
  });
}

const seurat = {
  id: 'seurat-dots', title: "Seurat's Dots", kind: 'Art', grades: [9, 12], subject: 'Art & Music',
  blurb: 'Watch a park scene appear from thousands of dots of pure colour, then dab your own and see the colours mix in your eye.',
  learn: 'Pointillism, the Neo-Impressionist method Georges Seurat developed in the 1880s: small dots of unmixed colour placed side by side, so the colours blend in the viewer\'s eye rather than on the palette.',
  backdrops: [{ name: 'Gallery', paint: galleryBackdrop }],
  variables: { paint: '#1f5fd1', dot: 6, score: 0, done: 0 },
  monitors: [['dot', 'normal', 8, 8], ['score', 'normal', 8, 34]],
  sounds: ['tune-chill'],
  sprites: [
    { name: 'Painter', costumes: [['dot', circle(3, '#1e2a3a', null)]], x: 0, y: 0, visible: false, variables: { r: 1, zone: '' } },
    { name: 'Brush', costumes: [['brush', emoji('🖌️', 60)]], x: 200, y: 40, size: 80, variables: { } },
    ...PALETTE.map(([n, col], i) => ({ name: n[0].toUpperCase() + n.slice(1), costumes: [['pot', dotPot(col, n)]], x: -195 + i * 65, y: -90, size: 80, sounds: ['pop'] })),
    { name: 'Curator', lib: 'toon-sam', use: ['idle', 'talk', 'cheer0', 'think'], x: -205, y: 40, size: 40 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "dot" to 6
    set "done" to 0
    set "score" to 0
    show caption "Pointillism: in the 1880s Georges Seurat painted with tiny dots of PURE colour, side by side, instead of mixing paint on a palette."
    play sound "tune-chill" until done

when "d" key pressed:
    if ((dot) > 4) then:
        set "dot" to 3
        show caption "Tiny dots! From a distance they blend more smoothly in your eye."
    else:
        set "dot" to 10
        show caption "Big dots: now you can see every colour on its own."

when "c" key pressed:
    erase all
    show caption "A fresh canvas. Click a paint pot, then hold the mouse down on the canvas to dab dots."
`,
    Painter: `
when flag clicked:
    erase all
    hide
    repeat 24:
        create clone of "myself"
    wait 5 seconds
    set "done" to 1
    show caption "Lean back from the screen. The grass looks yellow-green, and the trunk's red and green dots read as brown. The mixing happens in YOUR EYE."

when I start as a clone:
    set pen size to 6
    repeat 120:
        go to x: (pick random -144 to 144) y: (pick random -48 to 144)
        set "zone" to "grass"
        if ((((x position) > -125) and ((x position) < -30)) and ((y position) < 0)) then:
            set "zone" to "shadow"
        if ((y position) > 25) then:
            set "zone" to "water"
        if ((y position) > 60) then:
            set "zone" to "sky"
        if ((((x position) > -87) and ((x position) < -73)) and ((y position) < 25)) then:
            set "zone" to "trunk"
        if (((((x position) + 80) * ((x position) + 80)) + (((y position) - 45) * ((y position) - 45))) < 1100) then:
            set "zone" to "tree"
        if (((((x position) - 85) * ((x position) - 85)) + (((y position) - 112) * ((y position) - 112))) < 420) then:
            set "zone" to "sun"
        set "r" to (pick random 1 to 3)
${ZONES.map(([z, cols]) => cols.map((c, i) => `        if (((zone) = "${z}") and ((r) = ${i + 1})) then:
            set pen color to "${c}"`).join('\n')).join('\n')}
        pen down
        pen up
    delete this clone
`,
    Brush: `
when flag clicked:
    set pen color to (paint)
    go to "front" layer
    forever:
        go to x: ((mouse x) + 12) y: ((mouse y) + 12)
        if ((((done) = 1) and (mouse down?)) and (((mouse y) > -48) and ((mouse y) < 144))) then:
            if (((mouse x) > -144) and ((mouse x) < 144)) then:
                set pen size to (dot)
                set pen color to (paint)
                go to x: ((mouse x) + (pick random -8 to 8)) y: ((mouse y) + (pick random -8 to 8))
                pen down
                pen up
`,
    ...Object.fromEntries(PALETTE.map(([n, col]) => [n[0].toUpperCase() + n.slice(1), `
when this sprite clicked:
    start sound "pop"
    set "paint" to "${col}"
    repeat 2:
        change size by 10
        wait 0.08 seconds
        change size by -10
`])),
    Curator: `
when flag clicked:
    switch costume to "talk"
    say "Seurat's most famous painting, A Sunday on La Grande Jatte, took him about two years." for 5 seconds
    say "He read the colour science of his day, like the chemist Michel-Eugène Chevreul." for 5 seconds
    say "Try it: put RED dots right next to BLUE dots, then lean back. Press D for dot size, C to clear, Q for a quiz." for 6 seconds
    switch costume to "idle"

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "In pointillism, where do the colours mix: on the palette, or in the viewer's eye?" and wait
    if ((answer) contains "eye" ?) then:
        change "score" by 1
        say "Yes, in the eye!" for 1.5 seconds
    else:
        say "In the viewer's eye." for 2 seconds
    ask "Lots of red and blue dots side by side look like what colour from far away?" and wait
    if (((answer) contains "purple" ?) or ((answer) contains "violet" ?)) then:
        change "score" by 1
        say "Right, purple!" for 1.5 seconds
    else:
        say "They read as purple." for 2 seconds
    ask "Which French painter developed this style in the 1880s?" and wait
    if ((answer) contains "seurat" ?) then:
        change "score" by 1
        say "Georges Seurat, yes!" for 1.5 seconds
    else:
        say "Georges Seurat." for 2 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 3!")
`,
  },
  picture: [[170]],
  check: [{ frames: 200 }, { click: 'Red' }, { press: 'd' }, { frames: 10 }, { press: 'q' }, { frames: 10 }, { answer: 'in the eye' }, { frames: 60 },
    { answer: 'purple' }, { frames: 60 }, { answer: 'Seurat' }, { frames: 60 }, { expect: { score: 3, dot: 3, done: 1 } }],
};

// =================================================================================================
// 7. THE SENTENCE MACHINE (Language Arts, 3-5)
// =================================================================================================

const PARTS = {
  Adjective: { colour: '#7ee08a', x: -110, words: ['tiny', 'giant', 'glowing', 'ghostly'],
    tip: 'ADJECTIVES describe a noun: what kind, how big, what it looks like.' },
  Noun: { colour: '#8fc8ff', x: -15, words: ['dragon', 'robot', 'penguin', 'cat'],
    tip: 'NOUNS name a person, place, animal or thing.' },
  Verb: { colour: '#ff8f8f', x: 80, words: ['jumps', 'spins', 'dances', 'sings'],
    tip: 'VERBS are action words. They tell what the noun DOES.' },
  Adverb: { colour: '#ffc06a', x: 180, words: ['slowly', 'quickly', 'happily', 'sadly'],
    tip: 'ADVERBS describe a verb: HOW it happens. Lots of them end in -ly.' },
};
const ACTORS = [['dragon', '🐉'], ['robot', '🤖'], ['penguin', '🐧'], ['cat', '🐈']];

function sentenceBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, h, ['#fff3c4', '#ffe0ec', '#d8ecff']);
  ctx.fillRect(0, 0, w, h);
  // Bunting.
  const flags = ['#ff6b6b', '#ffc93c', '#5ccf5c', '#4d8dff', '#a35cff'];
  ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 14); ctx.quadraticCurveTo(480, 50, 960, 14); ctx.stroke();
  for (let i = 0; i < 20; i++) {
    const x = 24 + i * 48;
    const y = 14 + 36 * (1 - Math.pow((x - 480) / 480, 2)) * 0.9;
    shape(ctx, [[x - 14, y], [x + 14, y], [x, y + 26]], flags[i % 5], null);
  }
  // The word track the cards sit on, and a tag under each card.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath(); ctx.roundRect(20, 46, 920, 136, 22); ctx.fill();
  ctx.strokeStyle = '#c8a0d8'; ctx.lineWidth = 4; ctx.stroke();
  const tags = [['ARTICLE', '', '#bbbbbb', -195], ['ADJECTIVE', 'describes a noun', PARTS.Adjective.colour, PARTS.Adjective.x], ['NOUN', 'person, place, thing', PARTS.Noun.colour, PARTS.Noun.x], ['VERB', 'an action', PARTS.Verb.colour, PARTS.Verb.x], ['ADVERB', 'how it is done', PARTS.Adverb.colour, PARTS.Adverb.x]];
  for (const [t, sub, col, x] of tags) {
    const px = (x + 240) * 2;
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(px - 78, 128, 156, 26, 13); ctx.fill();
    text(ctx, t, px, 142, 17);
    if (sub) text(ctx, sub, px, 168, 14, '#5a3a6a', 600);
  }
  // The little theatre where the sentence is acted out.
  ctx.fillStyle = '#9a5a2a'; ctx.beginPath(); ctx.ellipse(480, 520, 260, 46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c47a3a'; ctx.beginPath(); ctx.ellipse(480, 508, 250, 40, 0, 0, Math.PI * 2); ctx.fill();
  const spot = ctx.createRadialGradient(480, 420, 20, 480, 420, 240);
  spot.addColorStop(0, 'rgba(255, 255, 210, 0.75)'); spot.addColorStop(1, 'rgba(255, 255, 210, 0)');
  ctx.fillStyle = spot; ctx.fillRect(200, 220, 560, 330);
}

function partScript(part, varName) {
  const p = PARTS[part];
  return `
when flag clicked:
    switch costume to "${p.words[0]}"
    set "${varName}" to 1

when this sprite clicked:
    start sound "pop"
    next costume
    set "${varName}" to (costume "number")
    show caption "${p.tip}"
    repeat 2:
        change size by 8
        wait 0.06 seconds
        change size by -8
`;
}

const sentence = {
  id: 'sentence-machine', title: 'The Sentence Machine', kind: 'Animation', grades: [3, 5], subject: 'Language Arts',
  blurb: 'Click the word cards to build a silly sentence, then watch it acted out: tiny dragons, giant penguins, robots that sing.',
  learn: 'The parts of speech in a sentence: nouns name things, verbs are actions, adjectives describe nouns and adverbs describe how the action happens.',
  backdrops: [{ name: 'Word theatre', paint: sentenceBackdrop }],
  variables: { adj: 1, noun: 1, verb: 1, adv: 1, score: 0 },
  monitors: [['score', 'normal', 8, 100]],
  sounds: ['tune-playful'],
  sprites: [
    { name: 'The', costumes: [['the', label('The', '#eeeeee', INK, 30)]], x: -195, y: 140 },
    ...Object.entries(PARTS).map(([part, p]) => ({ name: part, costumes: p.words.map((wd) => [wd, label(part === 'Adverb' ? `${wd}.` : wd, p.colour, INK, 30)]), x: p.x, y: 140, sounds: ['pop'] })),
    { name: 'Actor', costumes: ACTORS.map(([n, ch]) => [n, emoji(ch, 150)]), x: 0, y: -30, size: 100, rotationStyle: 'all around', variables: { spd: 1 }, sounds: ['boing', 'whoosh'] },
    { name: 'Go', costumes: [['button', label('▶ Act it out!', '#ffc93c', INK, 26)]], x: 172, y: -70, sounds: ['click'] },
    { name: 'Teacher', lib: 'toon-sam', use: ['idle', 'talk', 'cheer0', 'think'], x: -192, y: -55, size: 45 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    show caption "Click a coloured word card to change it. Then click 'Act it out!' to see your sentence come alive."
    play sound "tune-playful" until done
`,
    Adjective: partScript('Adjective', 'adj'),
    Noun: partScript('Noun', 'noun'),
    Verb: partScript('Verb', 'verb'),
    Adverb: partScript('Adverb', 'adv'),
    Go: `
when this sprite clicked:
    start sound "click"
    broadcast "act"
`,
    Actor: `
when flag clicked:
    go to x: 0 y: -30
    switch costume to "dragon"
    point in direction 90
    set size to 100 %
    clear graphic effects

when this sprite clicked:
    broadcast "act"

when I receive "act":
    stop "other scripts in sprite"
    show caption (join (join (join (join "The " ("costume name" of "Adjective")) (join " " ("costume name" of "Noun"))) (join " " ("costume name" of "Verb"))) (join (join " " ("costume name" of "Adverb")) "."))
    go to x: 0 y: -30
    point in direction 90
    clear graphic effects
    set size to 100 %
    say ""
    switch costume to "dragon"
    repeat ((noun) - 1):
        next costume
    if ((adj) = 1) then:
        set size to 55 %
    if ((adj) = 2) then:
        set size to 165 %
    if ((adj) = 3) then:
        set "brightness" effect to 45
    if ((adj) = 4) then:
        set "ghost" effect to 65
    set "spd" to 1
    if ((adv) = 2) then:
        set "spd" to 4
    if ((adv) = 3) then:
        set "spd" to 2
        say "Wheee!"
    if ((adv) = 4) then:
        say "Boo hoo..."
    if ((verb) = 1) then:
        start sound "boing"
        repeat 3:
            repeat (24 / (spd)):
                change y by (2.5 * (spd))
            repeat (24 / (spd)):
                change y by (-2.5 * (spd))
    if ((verb) = 2) then:
        start sound "whoosh"
        repeat (72 / (spd)):
            turn right (10 * (spd)) degrees
    if ((verb) = 3) then:
        repeat 3:
            repeat (8 / (spd)):
                change x by (3 * (spd))
            repeat (16 / (spd)):
                change x by (-3 * (spd))
            repeat (8 / (spd)):
                change x by (3 * (spd))
    if ((verb) = 4) then:
        set instrument to "flute"
        say "♪ La la la! ♪"
        play note 60 for (0.6 / (spd)) beats
        play note 64 for (0.6 / (spd)) beats
        play note 67 for (0.6 / (spd)) beats
        play note 72 for (1.2 / (spd)) beats
    point in direction 90
    go to x: 0 y: -30
    say ""
`,
    Teacher: `
when flag clicked:
    switch costume to "talk"
    say "Every sentence needs a NOUN (who) and a VERB (what they do)." for 4 seconds
    say "Adjectives and adverbs add the fun details! Press Q for a quiz." for 4 seconds
    switch costume to "idle"

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    show caption "Quiz sentence: The tiny dragon dances happily."
    ask "In 'The tiny dragon dances happily', which word is the VERB?" and wait
    if ((answer) contains "danc" ?) then:
        change "score" by 1
        say "Yes, dances is the action!" for 1.5 seconds
    else:
        say "The verb is dances: it is the action." for 2 seconds
    ask "Which word is the NOUN?" and wait
    if ((answer) contains "dragon" ?) then:
        change "score" by 1
        say "Right, dragon names a thing!" for 1.5 seconds
    else:
        say "The noun is dragon." for 2 seconds
    ask "Which word is the ADJECTIVE?" and wait
    if ((answer) contains "tiny" ?) then:
        change "score" by 1
        say "Yes, tiny describes the dragon!" for 1.5 seconds
    else:
        say "The adjective is tiny." for 2 seconds
    ask "Which word is the ADVERB?" and wait
    if ((answer) contains "happily" ?) then:
        change "score" by 1
        say "Yes, happily tells HOW it dances!" for 1.5 seconds
    else:
        say "The adverb is happily." for 2 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 4!")
`,
  },
  picture: [[20], [1]],
  check: [{ frames: 20 }, { click: 'Adjective' }, { click: 'Noun' }, { click: 'Verb' }, { click: 'Go' }, { frames: 40 },
    { press: 'q' }, { frames: 10 }, { answer: 'dances' }, { frames: 60 }, { answer: 'dragon' }, { frames: 60 }, { answer: 'tiny' }, { frames: 60 },
    { answer: 'happily' }, { frames: 60 }, { expect: { score: 4, noun: 2, adj: 2 } }, { click: 'Go' }, { frames: 25 }],
};

// =================================================================================================
// 8. HAIKU GARDEN (Language Arts, 6-8)
// =================================================================================================

// Each line's choices, written with a dot between syllables, and how many syllables each has.
const LINES = [
  { name: 'Line 1', y: 104, choices: [['Red leaves', 'Red leaves', 2], ['Cherry blossoms fall', 'Cher·ry blos·soms fall', 5], ['Rain taps on the window pane', 'Rain taps on the win·dow pane', 7], ['A sleepy green frog', 'A sleep·y green frog', 5]] },
  { name: 'Line 2', y: 66, choices: [['Splash!', 'Splash!', 1], ['Pink petals drift on the wind', 'Pink pet·als drift on the wind', 7], ['Quiet snow', 'Qui·et snow', 3], ['Leaps into the cool still pond', 'Leaps in·to the cool still pond', 7]] },
  { name: 'Line 3', y: 28, choices: [['The moon', 'The moon', 2], ['Spring has come at last', 'Spring has come at last', 5], ['Birds sing in the tall green trees', 'Birds sing in the tall green trees', 7], ['Ripples spreading out', 'Rip·ples spread·ing out', 5]] },
];

function gardenBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, 470, ['#ffd1dc', '#ffe8d0', '#d8f0ff']);
  ctx.fillRect(0, 0, w, 470);
  // A far mountain with snow.
  shape(ctx, [[520, 470], [720, 230], [920, 470]], '#a8b8d8', null);
  shape(ctx, [[672, 287], [720, 230], [768, 287], [745, 280], [720, 296], [695, 280]], '#ffffff', null);
  // Ground and pond.
  ctx.fillStyle = '#9fd38a'; ctx.fillRect(0, 440, w, 280);
  ctx.fillStyle = '#5aa8e8'; ctx.beginPath(); ctx.ellipse(760, 560, 170, 46, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; ctx.lineWidth = 3;
  for (const r of [30, 60]) { ctx.beginPath(); ctx.ellipse(790, 560, r, r * 0.27, 0, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#3f9a4a'; ctx.beginPath(); ctx.ellipse(700, 566, 26, 9, 0, 0, Math.PI * 2); ctx.fill();
  // A cherry tree on the left.
  ctx.strokeStyle = '#6a3f2a'; ctx.lineCap = 'round';
  ctx.lineWidth = 26; ctx.beginPath(); ctx.moveTo(110, 600); ctx.quadraticCurveTo(130, 420, 90, 300); ctx.stroke();
  ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(115, 420); ctx.quadraticCurveTo(170, 360, 230, 330); ctx.stroke();
  const rnd = seeded(3);
  for (let i = 0; i < 120; i++) {
    const a = rnd() * Math.PI * 2; const r = Math.sqrt(rnd());
    ctx.fillStyle = ['#ff9ac0', '#ffc2d8', '#ff7aa8', '#ffffff'][i % 4];
    ctx.beginPath(); ctx.arc(130 + Math.cos(a) * 120 * r, 300 + Math.sin(a) * 80 * r, 10 + rnd() * 8, 0, Math.PI * 2); ctx.fill();
  }
  // The poem paper.
  ctx.fillStyle = 'rgba(255, 252, 244, 0.93)';
  ctx.beginPath(); ctx.roundRect(170, 126, 620, 250, 18); ctx.fill();
  ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.roundRect(740, 140, 34, 34, 4); ctx.fill();
  text(ctx, '俳', 757, 158, 22, '#ffffff');
  text(ctx, 'HAIKU GARDEN', 480, 50, 40, '#b0213a');
  text(ctx, '5 syllables  ·  7 syllables  ·  5 syllables', 480, 96, 22, '#6a3f5a', 600);
}

function lineScript(l, n) {
  return `
when flag clicked:
    switch costume to "${l.choices[0][0]}"
    set "count" to ${l.choices[0][2]}

when this sprite clicked:
    start sound "pop"
    next costume
    set "count" to (letter (costume "number") of "${l.choices.map((c) => c[2]).join('')}")
    set "line${n}" to 0
`;
}

const haiku = {
  id: 'haiku-garden', title: 'Haiku Garden', kind: 'Story', grades: [6, 8], subject: 'Language Arts',
  blurb: 'Click each line of a poem to change it, then clap out the syllables. Get 5-7-5 and the cherry blossoms fall.',
  learn: 'What a syllable is and how to count one by clapping, and the form of a haiku: three lines of 5, 7 and 5 syllables in English, often with a word for a season.',
  backdrops: [{ name: 'Japanese garden', paint: gardenBackdrop }],
  variables: { line1: 0, line2: 0, line3: 0, haiku: 0, score: 0 },
  monitors: [['line1', 'large', 8, 62], ['line2', 'large', 8, 100], ['line3', 'large', 8, 138]],
  sounds: ['tune-wonder', 'chime'],
  sprites: [
    ...LINES.map((l, i) => ({ name: l.name, costumes: l.choices.map(([nm, shown]) => [nm, label(shown, ['#ffe4ee', '#e4ffe6', '#e4f2ff'][i], INK, 31)]), x: 0, y: l.y, variables: { count: 0 }, sounds: ['pop'] })),
    { name: 'Clapper', costumes: [['clap', emoji('👏', 70)]], x: 185, y: 104, size: 70, visible: false, sounds: ['clap'] },
    { name: 'Clap button', costumes: [['button', label('👏 Clap the syllables', '#ffc93c', INK, 24)]], x: 140, y: -62, sounds: ['click'] },
    { name: 'Blossom', costumes: [['b', emoji('🌸', 40)]], x: 0, y: 190, visible: false },
    { name: 'Poet', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'think'], x: -195, y: -55, size: 42, sounds: ['chime'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "line1" to 0
    set "line2" to 0
    set "line3" to 0
    set "haiku" to 0
    show caption "A HAIKU is a short poem from Japan. In English it has 3 lines of 5, 7 and 5 SYLLABLES (beats). Click a line to change it."
`,
    ...Object.fromEntries(LINES.map((l, i) => [l.name, lineScript(l, i + 1)])),
    'Clap button': `
when this sprite clicked:
    start sound "click"
    broadcast "clap" and wait
    if ((((line1) = 5) and ((line2) = 7)) and ((line3) = 5)) then:
        set "haiku" to 1
        broadcast "haiku"
    else:
        set "haiku" to 0
        show caption "Not 5-7-5 yet. Change the line with the wrong number of claps, then clap again."
`,
    Clapper: `
when I receive "clap":
    show caption "Clap once for each syllable. The dots split each word into its syllables."
${[1, 2, 3].map((n) => `    set "line${n}" to 0
    go to x: 190 y: ${LINES[n - 1].y}
    show
    repeat ("count" of "Line ${n}"):
        start sound "clap"
        change "line${n}" by 1
        set size to 85 %
        wait 0.18 seconds
        set size to 70 %
        wait 0.18 seconds
    wait 0.3 seconds`).join('\n')}
    hide
`,
    Blossom: `
when flag clicked:
    hide

when I receive "haiku":
    repeat 25:
        create clone of "myself"
        wait 0.12 seconds

when I start as a clone:
    go to x: (pick random -230 to 230) y: 185
    set size to (pick random 50 to 110) %
    show
    repeat until ((y position) < -120):
        change y by -3
        change x by (pick random -2 to 2)
        turn right 4 degrees
    delete this clone
`,
    Poet: `
when flag clicked:
    switch costume to "talk"
    say "Haiku come from Japan. Matsuo Bashō, who lived in the 1600s, is the most famous haiku poet." for 5 seconds
    say "Japanese haiku count sound units, not quite syllables. In English we count syllables." for 5 seconds
    switch costume to "idle"

when I receive "haiku":
    switch costume to "cheer0"
    start sound "chime"
    show caption (join (join (join ("costume name" of "Line 1") " / ") (join ("costume name" of "Line 2") " / ")) ("costume name" of "Line 3"))
    say "5-7-5: a haiku! Most haiku also have a season word, a KIGO. Can you spot yours? Press Q for a quiz." for 6 seconds
    switch costume to "idle"

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "Clap it: how many syllables are in BUTTERFLY?" and wait
    if ((answer) = 3) then:
        change "score" by 1
        say "Yes! but-ter-fly." for 1.5 seconds
    else:
        say "Three: but-ter-fly." for 2 seconds
    ask "How many syllables are in HAIKU?" and wait
    if ((answer) = 2) then:
        change "score" by 1
        say "Right! hai-ku." for 1.5 seconds
    else:
        say "Two: hai-ku." for 2 seconds
    ask "How many syllables are in the middle line of a haiku?" and wait
    if ((answer) = 7) then:
        change "score" by 1
        say "Yes, seven!" for 1.5 seconds
    else:
        say "Seven: 5, 7, then 5." for 2 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 3!")
`,
  },
  picture: [[60]],
  check: [{ frames: 30 }, { click: 'Line 1' }, { click: 'Line 1' }, { click: 'Line 1' }, { click: 'Line 2' }, { click: 'Line 2' }, { click: 'Line 2' },
    { click: 'Line 3' }, { click: 'Line 3' }, { click: 'Line 3' }, { click: 'Clap button' }, { frames: 300 }, { expect: { haiku: 1, line2: 7 } },
    { press: 'q' }, { frames: 10 }, { answer: '3' }, { frames: 60 }, { answer: '2' }, { frames: 60 }, { answer: '7' }, { frames: 40 }, { expect: { score: 3 } }],
};

// =================================================================================================
// 9. ETHOS, PATHOS, LOGOS (Language Arts, 9-12)
// =================================================================================================

const CLAIMS = [
  ['ethos', 'As a dentist for twenty years, I tell all\nmy patients the same thing: brush twice a day.'],
  ['pathos', 'Imagine a puppy shivering alone in the\ncold tonight. Please, give a pet a home.'],
  ['logos', 'Bikes give off no exhaust, so more bike\nlanes would mean cleaner air for our town.'],
  ['pathos', "Don't let your little sister down.\nBuckle up, every single trip."],
  ['ethos', 'Trusted by nurses and firefighters\nacross the country.'],
  ['logos', 'Our class survey found most students skip\nbreakfast, so a breakfast club would be used.'],
];
const APPEALS = [
  ['Ethos', '🎓', 'who is speaking', '#8fc8ff', -150, 'ETHOS: trust in the SPEAKER, their character and expertise.'],
  ['Pathos', '❤️', 'feelings', '#ff9a9a', 0, 'PATHOS: an appeal to the audience\'s EMOTIONS.'],
  ['Logos', '📊', 'facts and reasons', '#9ae0a0', 150, 'LOGOS: an appeal to LOGIC, evidence and reasons.'],
];

function templeBackdrop(ctx, w, h) {
  ctx.fillStyle = gradient(ctx, 0, 0, 0, h, ['#7ec8ff', '#d8f0ff', '#fff4dc']);
  ctx.fillRect(0, 0, w, h);
  // Pediment and columns of a Greek temple.
  shape(ctx, [[60, 70], [480, 8], [900, 70]], '#f4efe4', '#a89a80', 4);
  ctx.fillStyle = '#e8e0cc'; ctx.fillRect(60, 70, 840, 24);
  for (let i = 0; i < 8; i++) {
    const x = 96 + i * 110;
    ctx.fillStyle = gradient(ctx, x - 26, 0, x + 26, 0, ['#d8d0bc', '#ffffff', '#cfc6b0']);
    ctx.fillRect(x - 24, 94, 48, 460);
    ctx.strokeStyle = 'rgba(150, 140, 120, 0.5)'; ctx.lineWidth = 2;
    for (const dx of [-12, 0, 12]) { ctx.beginPath(); ctx.moveTo(x + dx, 100); ctx.lineTo(x + dx, 550); ctx.stroke(); }
    ctx.fillStyle = '#e8e0cc'; ctx.fillRect(x - 32, 94, 64, 14); ctx.fillRect(x - 32, 546, 64, 14);
  }
  // Steps.
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#e0d8c4' : '#ece4d0'; ctx.fillRect(20 - i * 10, 560 + i * 40, 920 + i * 20, 40); }
  text(ctx, 'THE ART OF PERSUASION', 480, 50, 24, '#6a5a3a');
}

function appealBadge(word, ch, sub, fill) {
  return paint(220, 200, (ctx) => {
    ctx.beginPath(); ctx.arc(110, 100, 94, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
    ctx.font = '62px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, 110, 64);
    text(ctx, word.toUpperCase(), 110, 124, 32);
    text(ctx, sub, 110, 158, 18, '#2a3a4a', 600);
  });
}

function appealScript([word, , , , , def], key) {
  const pick = `
    if ((round) < 7) then:
        if ((mode) = "${word.toLowerCase()}") then:
            if ((missed) = 0) then:
                change "score" by 1
            start sound "coin"
            show caption "${def}"
            repeat 3:
                change size by 10
                wait 0.06 seconds
                change size by -10
            broadcast "next"
        else:
            set "missed" to 1
            start sound "hit"
            say "Not this one. Is it about WHO is speaking, FEELINGS, or REASONS?" for 2.5 seconds`;
  return `
when this sprite clicked:${pick}

when "${key}" key pressed:${pick}
`;
}

const persuasion = {
  id: 'ethos-pathos-logos', title: 'Ethos, Pathos, Logos', kind: 'Quiz', grades: [9, 12], subject: 'Language Arts',
  blurb: 'Six persuasive messages, three ways to persuade. Sort each one: does it lean on trust, feelings, or reasons?',
  learn: 'Aristotle\'s three modes of persuasion: ethos (the speaker\'s credibility), pathos (the audience\'s emotions) and logos (logic and evidence), and how to spot which one an argument is using.',
  backdrops: [{ name: 'Temple', paint: templeBackdrop }],
  variables: { round: 0, mode: '', missed: 0, score: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sounds: ['tune-chill', 'win'],
  sprites: [
    { name: 'Claim', costumes: [['start', label('Click a badge, or press 1, 2 or 3.\nIs it ETHOS, PATHOS or LOGOS?', '#fffaf0', INK, 24)], ...CLAIMS.map(([, t], i) => [`c${i + 1}`, label(t, '#fffaf0', INK, 24)]), ['done', label('All six sorted!\nReal arguments often use all three.', '#fff3c4', INK, 24)]], x: 0, y: 92, sounds: ['whoosh'] },
    ...APPEALS.map(([word, ch, sub, fill, x]) => ({ name: word, costumes: [['badge', appealBadge(word, ch, sub, fill)]], x, y: -52, size: 100, sounds: ['coin', 'hit'] })),
    { name: 'Coach', lib: 'toon-leo', use: ['idle', 'talk', 'cheer0', 'think'], x: 205, y: 120, size: 36 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "score" to 0
    set "round" to 0
    set "missed" to 0
    set "mode" to ""
    show caption "Over 2,300 years ago the Greek thinker Aristotle described three ways to persuade: ETHOS, PATHOS and LOGOS."
    start sound "tune-chill"
    wait 5 seconds
    broadcast "next"

when I receive "next":
    change "round" by 1
    set "missed" to 0
${CLAIMS.map(([m], i) => `    if ((round) = ${i + 1}) then:
        set "mode" to "${m}"`).join('\n')}
    if ((round) = 7) then:
        set "mode" to ""
        start sound "win"
        show caption (join (join "You scored " (score)) " out of 6 on the first try. Good readers notice which appeal is being used on them!")
`,
    Claim: `
when flag clicked:
    switch costume to "start"

when I receive "next":
    wait 1 seconds
    start sound "whoosh"
    switch costume to "start"
    repeat (round):
        next costume
    set "ghost" effect to 100
    repeat 10:
        change "ghost" effect by -10
`,
    ...Object.fromEntries(APPEALS.map((a, i) => [a[0], appealScript(a, String(i + 1))])),
    Coach: `
when flag clicked:
    switch costume to "talk"
    say "Ask: is this message about WHO is talking, how I FEEL, or the REASONS?" for 5 seconds
    switch costume to "idle"

when I receive "next":
    if ((round) = 7) then:
        switch costume to "cheer0"
        say "Now try writing one message that uses all three!" for 5 seconds
        switch costume to "idle"
`,
  },
  picture: [[200]],
  check: [{ frames: 200 }, { click: 'Ethos' }, { frames: 40 }, { click: 'Logos' }, { frames: 20 }, { click: 'Pathos' }, { frames: 40 }, { press: '3' }, { frames: 40 },
    { click: 'Pathos' }, { frames: 40 }, { click: 'Ethos' }, { frames: 40 }, { click: 'Logos' }, { frames: 60 }, { expect: { score: 5, round: 7 } }],
};

export default [hieroglyphs, silkRoad, longitude, melody, colourWheel, seurat, sentence, haiku, persuasion];
