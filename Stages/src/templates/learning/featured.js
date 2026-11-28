// The five learning projects Rich named, written first as the worked examples for the rest:
// The Water Cycle, A Volcano with Lava, Da Vinci's Paint Shop, A Butterfly Garden, Inside an Animal Cell.
import { emoji, label, circle, rect, paint } from './kit.js';

// --- shared painting ------------------------------------------------------------------------------

function skyGradient(ctx, w, h, top, bottom, to = h) {
  const g = ctx.createLinearGradient(0, 0, 0, to);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, to);
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

// --- 1. The Water Cycle ---------------------------------------------------------------------------

function waterCycleBackdrop(ctx, w, h) {
  skyGradient(ctx, w, h, '#6ec6ff', '#d8f1ff', h * 0.7);
  // Mountains on the right, a snow cap on the tallest.
  blob(ctx, [[420, 560], [640, 250], [760, 400], [860, 210], [960, 330], [960, 560]], '#7b8fa6');
  blob(ctx, [[805, 290], [860, 210], [905, 285], [880, 300], [860, 280], [835, 302]], '#ffffff', null);
  // Green land, the sea on the left.
  blob(ctx, [[0, 520], [300, 500], [520, 470], [960, 500], [960, 720], [0, 720]], '#58b85c');
  const sea = ctx.createLinearGradient(0, 560, 0, 720);
  sea.addColorStop(0, '#2f8fe0');
  sea.addColorStop(1, '#1a5fae');
  ctx.fillStyle = sea;
  ctx.beginPath();
  ctx.moveTo(0, 560);
  ctx.bezierCurveTo(160, 540, 330, 575, 470, 600);
  ctx.lineTo(470, 720);
  ctx.lineTo(0, 720);
  ctx.closePath();
  ctx.fill();
  // A river from the mountains to the sea.
  ctx.strokeStyle = '#2f8fe0';
  ctx.lineWidth = 18;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(760, 470);
  ctx.bezierCurveTo(700, 560, 560, 520, 440, 610);
  ctx.stroke();
  // Little waves.
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 4;
  for (const [x, y] of [[60, 610], [190, 650], [320, 625], [110, 690], [260, 700]]) {
    ctx.beginPath();
    ctx.arc(x, y, 14, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

const waterCycle = {
  id: 'water-cycle', title: 'The Water Cycle', kind: 'Simulation', grades: [3, 5], subject: 'Earth & Space',
  blurb: 'Heat the sea, build a cloud, make it rain. Click the Sun to turn up the heat.',
  learn: 'The four stages of the water cycle: evaporation, condensation, precipitation and collection, and why the Sun drives all of them.',
  backdrops: [{ name: 'Land and Sea', paint: waterCycleBackdrop }],
  variables: { heat: 1, cloud: 0 },
  monitors: [['heat', 'normal', 8, 8], ['cloud', 'normal', 8, 40]],
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'Sun', costumes: [['sun', emoji('☀️', 150)]], x: -170, y: 120, size: 100, sounds: ['power-up'] },
    { name: 'Vapour', costumes: [['vapour', circle(10, '#bfe6ff', '#ffffff', 3)]], x: -120, y: -130, visible: false },
    { name: 'Cloud', costumes: [['white', emoji('☁️', 160)], ['rain', emoji('🌧️', 160)]], x: 90, y: 125, size: 50, sounds: ['rain'] },
    { name: 'Rain', costumes: [['drop', emoji('💧', 40)]], x: 90, y: 100, visible: false },
    { name: 'Evaporation', costumes: [['sign', label('EVAPORATION', '#ffc93c')]], x: -150, y: -60, visible: false },
    { name: 'Condensation', costumes: [['sign', label('CONDENSATION', '#ffffff')]], x: 90, y: 50, visible: false },
    { name: 'Precipitation', costumes: [['sign', label('PRECIPITATION', '#8fd0ff')]], x: 170, y: -10, visible: false },
    { name: 'Collection', costumes: [['sign', label('COLLECTION', '#7ee08a')]], x: -40, y: -150, visible: false },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "heat" to 1
    set "cloud" to 0
    show caption "The Sun heats the sea. Click the Sun to make it hotter!"
    play sound "tune-wonder" until done
`,
    Sun: `
when flag clicked:
    forever:
        change size by 4
        wait 0.4 seconds
        change size by -4
        wait 0.4 seconds

when this sprite clicked:
    change "heat" by 1
    if ((heat) > 3) then:
        set "heat" to 1
    start sound "power-up"
    set "color" effect to ((heat) * 10)
    say (join "Heat: " (heat)) for 1 seconds
`,
    Vapour: `
when flag clicked:
    hide
    forever:
        create clone of "myself"
        wait (1.2 / (heat)) seconds

when I start as a clone:
    go to x: (pick random -230 to -40) y: -140
    set "ghost" effect to 20
    show
    repeat until ((y position) > 100):
        change y by 2
        change x by (pick random -1 to 2)
        change "ghost" effect by 0.5
    change "cloud" by 1
    delete this clone
`,
    Evaporation: `
when flag clicked:
    hide
    wait 1.5 seconds
    show
    repeat 3:
        change size by 10
        wait 0.15 seconds
        change size by -10
        wait 0.15 seconds
`,
    Cloud: `
when flag clicked:
    switch costume to "white"
    set size to 50 %
    forever:
        set size to (50 + ((cloud) * 4)) %
        if ((cloud) > 14) then:
            broadcast "rain" and wait
            set "cloud" to 0
            switch costume to "white"

when I receive "rain":
    switch costume to "rain"
    start sound "rain"
    wait 3.5 seconds
`,
    Condensation: `
when flag clicked:
    hide
    wait until ((cloud) > 5)
    show
    show caption "High up it is cold. Vapour CONDENSES into tiny droplets, and they make a cloud."
`,
    Rain: `
when flag clicked:
    hide

when I receive "rain":
    show caption "The droplets join and get too heavy to float. They fall as PRECIPITATION."
    repeat 25:
        create clone of "myself"
        wait 0.1 seconds

when I start as a clone:
    go to x: (pick random 20 to 170) y: 100
    show
    repeat until ((y position) < -40):
        change y by -7
    glide 1.5 secs to x: -120 y: -150
    delete this clone
`,
    Precipitation: `
when flag clicked:
    hide

when I receive "rain":
    show
    wait 2 seconds
    broadcast "collect"
`,
    Collection: `
when flag clicked:
    hide

when I receive "collect":
    show
    show caption "Rain runs downhill in rivers and COLLECTS in lakes and the sea. Then the Sun starts it all again."
`,
  },
  picture: [[420]],
  check: [{ frames: 120 }, { click: 'Sun' }, { frames: 600 }],
};

// --- 2. A Volcano with Lava -------------------------------------------------------------------------

function volcanoBackdrop(ctx, w, h) {
  skyGradient(ctx, w, h, '#ff9a5a', '#ffe0b8', 330);
  // Rock layers (strata) under the ground, cut open like a model.
  const layers = ['#a0703f', '#8a5a33', '#c4955c', '#6e4a2b', '#9c7a53'];
  layers.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, 430 + i * 58, w, 58); });
  // The magma chamber deep down.
  const mg = ctx.createRadialGradient(480, 660, 20, 480, 660, 170);
  mg.addColorStop(0, '#fff07a');
  mg.addColorStop(0.35, '#ff8a1f');
  mg.addColorStop(1, '#b3200f');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.ellipse(480, 670, 190, 70, 0, 0, Math.PI * 2);
  ctx.fill();
  // The cone, cut down the middle so the vent shows.
  blob(ctx, [[150, 430], [400, 120], [560, 120], [810, 430]], '#5a4637');
  ctx.fillStyle = '#3a2a20';
  ctx.beginPath();
  ctx.moveTo(400, 120);
  ctx.lineTo(560, 120);
  ctx.lineTo(520, 160);
  ctx.lineTo(440, 160);
  ctx.closePath();
  ctx.fill();
  // The vent (conduit) from the chamber to the crater.
  const vent = ctx.createLinearGradient(0, 140, 0, 620);
  vent.addColorStop(0, '#ff5a1f');
  vent.addColorStop(1, '#ffb01f');
  ctx.fillStyle = vent;
  ctx.beginPath();
  ctx.moveTo(458, 140); ctx.lineTo(502, 140); ctx.lineTo(515, 610); ctx.lineTo(445, 610);
  ctx.closePath();
  ctx.fill();
  // Ground line and a few trees for scale.
  ctx.fillStyle = '#5c8a3a';
  ctx.fillRect(0, 418, 150, 14);
  ctx.fillRect(810, 418, 150, 14);
  for (const x of [50, 100, 860, 910]) {
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 4, 380, 8, 40);
    ctx.fillStyle = '#2f8a3e'; ctx.beginPath(); ctx.arc(x, 372, 22, 0, Math.PI * 2); ctx.fill();
  }
}

const volcano = {
  id: 'volcano', title: 'A Volcano with Lava', kind: 'Simulation', grades: [4, 8], subject: 'Earth & Space',
  blurb: 'Press space to heat the magma. When the pressure gets too high, it erupts, and the lava cools into rock.',
  learn: 'How gas pressure in magma drives an eruption, the difference between magma and lava, and how cooling lava becomes igneous rock.',
  backdrops: [{ name: 'Inside the Volcano', paint: volcanoBackdrop }],
  variables: { pressure: 0, rock: 0 },
  monitors: [['pressure', 'large', 8, 8], ['rock', 'normal', 8, 52]],
  sprites: [
    { name: 'Bubble', costumes: [['gas', circle(9, '#fff7c2', '#ffb01f', 3)]], x: 0, y: -150, visible: false },
    { name: 'Lava', costumes: [['hot', circle(11, '#ff7a1a', '#ffe14a', 4)], ['cooling', circle(11, '#c43d17', '#7a2410', 4)], ['basalt', circle(11, '#3c3c44', '#1e1e24', 4)]], x: 0, y: 130, visible: false, variables: { vx: 0, vy: 0 }, sounds: ['splash'] },
    { name: 'Ash', costumes: [['ash', emoji('☁️', 150)]], x: 0, y: 150, visible: false },
    { name: 'Geologist', lib: 'toon-maya', use: ['idle', 'talk', 'cheer0', 'hurt'], x: -185, y: -45, size: 55, sounds: ['explosion', 'alarm'] },
    { name: 'Magma', costumes: [['sign', label('MAGMA\n(under the ground)', '#ffb01f', '#1e2a3a', 26)]], x: 150, y: -140 },
    { name: 'Lava sign', costumes: [['sign', label('LAVA\n(above the ground)', '#ff6a3d', '#1e2a3a', 26)]], x: 175, y: 140, visible: false },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "pressure" to 0
    set "rock" to 0
    show caption "Hold SPACE to heat the magma. Gas bubbles build up PRESSURE."
`,
    Geologist: `
when flag clicked:
    switch costume to "talk"
    say "Melted rock underground is called MAGMA." for 3 seconds
    switch costume to "idle"
    forever:
        if ((pressure) > 70) then:
            switch costume to "hurt"
            say "The pressure is very high!"
        else:
            switch costume to "idle"
            say ""
        wait 0.2 seconds

when I receive "erupt":
    start sound "explosion"
    switch costume to "cheer0"
    say "ERUPTION! Now it's called LAVA." for 3 seconds
    say "Lava cools fast in the air and turns into rock called BASALT." for 4 seconds
`,
    Bubble: `
when flag clicked:
    hide
    forever:
        if (key "space" pressed?) then:
            change "pressure" by 1
            create clone of "myself"
        wait 0.08 seconds
        if ((pressure) > 99) then:
            set "pressure" to 0
            broadcast "erupt"
            wait 6 seconds

when I start as a clone:
    go to x: (pick random -30 to 30) y: -160
    show
    repeat until ((y position) > 140):
        change y by 6
        change x by (pick random -2 to 2)
    delete this clone
`,
    Lava: `
when flag clicked:
    hide

when I receive "erupt":
    show caption "Gas pressure pushes the magma up the vent and out of the crater."
    repeat 40:
        create clone of "myself"
        wait 0.05 seconds

when I start as a clone:
    switch costume to "hot"
    go to x: (pick random -15 to 15) y: 145
    set "vx" to (pick random -5 to 5)
    set "vy" to (pick random 6 to 11)
    show
    repeat until ((y position) < -40):
        change x by (vx)
        change y by (vy)
        change "vy" by -0.4
    switch costume to "cooling"
    wait 1 seconds
    switch costume to "basalt"
    change "rock" by 1
    wait 4 seconds
    delete this clone
`,
    Ash: `
when flag clicked:
    hide

when I receive "erupt":
    go to x: 0 y: 150
    set size to 40 %
    set "ghost" effect to 0
    show
    repeat 60:
        change size by 3
        change y by 0.6
        change "ghost" effect by 1.5
    hide
`,
    'Lava sign': `
when flag clicked:
    hide

when I receive "erupt":
    show
    wait 6 seconds
    hide
`,
  },
  picture: [[30], [140, ['space']], [12]],
  check: [{ frames: 30 }, { frames: 160, keys: ['space'] }, { frames: 200 }],
};

// --- 3. Da Vinci's Paint Shop -----------------------------------------------------------------------

function studioBackdrop(ctx, w, h) {
  // Warm plaster walls, a wooden floor, and a big canvas on an easel to paint on.
  skyGradient(ctx, w, h, '#f6e2b8', '#e9c98f', h);
  ctx.fillStyle = '#9c6a3c';
  ctx.fillRect(0, 610, w, 110);
  ctx.strokeStyle = '#7d5330';
  ctx.lineWidth = 3;
  for (let x = 0; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 610); ctx.lineTo(x - 40, 720); ctx.stroke(); }
  // The easel legs and the canvas.
  ctx.strokeStyle = '#6b4626';
  ctx.lineWidth = 16;
  ctx.beginPath(); ctx.moveTo(330, 640); ctx.lineTo(420, 60); ctx.moveTo(630, 640); ctx.lineTo(540, 60); ctx.stroke();
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#3d2a17';
  ctx.lineWidth = 8;
  ctx.beginPath(); ctx.roundRect(200, 70, 560, 420, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#6b4626';
  ctx.fillRect(190, 490, 580, 22);
  // A window with Florentine hills.
  ctx.fillStyle = '#9fd3f2';
  ctx.fillRect(810, 60, 120, 160);
  ctx.fillStyle = '#6aa457';
  ctx.beginPath(); ctx.moveTo(810, 220); ctx.quadraticCurveTo(870, 150, 930, 200); ctx.lineTo(930, 220); ctx.fill();
  ctx.strokeStyle = '#6b4626'; ctx.lineWidth = 8; ctx.strokeRect(810, 60, 120, 160);
  ctx.beginPath(); ctx.moveTo(870, 60); ctx.lineTo(870, 220); ctx.stroke();
  // The shop's name, in Leonardo's mirror writing above the window, and the right way round below.
  ctx.fillStyle = '#7a4a1f';
  ctx.font = 'italic 700 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.save(); ctx.translate(870, 270); ctx.scale(-1, 1); ctx.fillText('Bottega', 0, 0); ctx.restore();
  ctx.font = '600 16px Georgia, serif';
  ctx.fillText('(mirror writing!)', 870, 296);
}

function potPainter(fill, name) {
  return paint(118, 118, (ctx) => {
    ctx.fillStyle = '#d9d2c3';
    ctx.strokeStyle = '#1e2a3a';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(14, 40, 90, 70, 14); ctx.fill(); ctx.stroke();
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.ellipse(59, 42, 46, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1e2a3a';
    ctx.font = '700 17px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, 59, 86);
  });
}

const davinci = {
  id: 'davinci-paint-shop', title: "Da Vinci's Paint Shop", kind: 'Art', grades: [3, 8], subject: 'Art & Music',
  blurb: "Paint on Leonardo's easel. Dip in two primary colours to mix a new one, and ask Leonardo about his work.",
  learn: 'Primary and secondary colours (red + yellow = orange, yellow + blue = green, blue + red = purple), and who Leonardo da Vinci was: painter, inventor and notebook-keeper.',
  backdrops: [{ name: 'Studio', paint: studioBackdrop }],
  variables: { first: '', mixed: 'black' },
  sprites: [
    { name: 'Brush', costumes: [['brush', emoji('🖌️', 70)]], x: 0, y: 0, size: 100, rotationStyle: "don't rotate", variables: { band: 0, angle: 180 } },
    { name: 'Red', costumes: [['pot', potPainter('#e53935', 'RED')]], x: -205, y: -150, sounds: ['pop'] },
    { name: 'Yellow', costumes: [['pot', potPainter('#fdd835', 'YELLOW')]], x: -140, y: -150, sounds: ['pop'] },
    { name: 'Blue', costumes: [['pot', potPainter('#1e88e5', 'BLUE')]], x: -75, y: -150, sounds: ['pop'] },
    { name: 'New canvas', costumes: [['button', label('🧽 New canvas', '#ffffff', '#1e2a3a', 26)]], x: 130, y: -155, sounds: ['whoosh'] },
    { name: 'Leonardo', lib: 'toon-leo', use: ['idle', 'talk', 'cheer0', 'think'], x: 195, y: -55, size: 55, variables: { fact: 1 } },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "first" to ""
    set "mixed" to "black"
`,
    Brush: `
when flag clicked:
    erase all
    go to "front" layer
    set pen size to 14
    broadcast "demo" and wait
    set pen size to 8
    set pen color to "#1e2a3a"
    forever:
        go to x: ((mouse x) + 14) y: ((mouse y) + 14)
        if (((mouse down?) and ((mouse y) > -100)) and (((mouse x) > -140) and ((mouse x) < 140))) then:
            go to x: (mouse x) y: (mouse y)
            pen down
        else:
            pen up

when I receive "demo":
    show caption "Leonardo paints a rainbow first: red, orange, yellow, green, blue, purple."
    set "band" to 0
    repeat 6:
        pen up
        set "angle" to 180
        go to x: ((110 - ((band) * 14)) * ("cos" of (angle))) y: (-30 + ((110 - ((band) * 14)) * ("sin" of (angle))))
        if ((band) = 0) then:
            set pen color to "#e53935"
        if ((band) = 1) then:
            set pen color to "#fb8c00"
        if ((band) = 2) then:
            set pen color to "#fdd835"
        if ((band) = 3) then:
            set pen color to "#43a047"
        if ((band) = 4) then:
            set pen color to "#1e88e5"
        if ((band) = 5) then:
            set pen color to "#8e24aa"
        pen down
        repeat 18:
            change "angle" by -10
            go to x: ((110 - ((band) * 14)) * ("cos" of (angle))) y: (-30 + ((110 - ((band) * 14)) * ("sin" of (angle))))
        change "band" by 1
    pen up
    show caption "Your turn! Click a paint pot, then hold the mouse down on the canvas to paint."

when I receive "red":
    set pen color to "#e53935"
when I receive "yellow":
    set pen color to "#fdd835"
when I receive "blue":
    set pen color to "#1e88e5"
when I receive "orange":
    set pen color to "#fb8c00"
when I receive "green":
    set pen color to "#43a047"
when I receive "purple":
    set pen color to "#8e24aa"
`,
    Red: `
when this sprite clicked:
    start sound "pop"
    broadcast "pick red"
`,
    Yellow: `
when this sprite clicked:
    start sound "pop"
    broadcast "pick yellow"
`,
    Blue: `
when this sprite clicked:
    start sound "pop"
    broadcast "pick blue"
`,
    'New canvas': `
when this sprite clicked:
    start sound "whoosh"
    erase all
`,
    Leonardo: `
when flag clicked:
    switch costume to "talk"
    say "Ciao! I am Leonardo da Vinci, a painter and inventor from Italy, born in 1452." for 4 seconds
    say "Red, yellow and blue are PRIMARY colours. Mix two of them to make a new one!" for 4 seconds
    switch costume to "idle"

when I receive "pick red":
    if ((first) = "yellow") then:
        broadcast "mix orange"
    else:
        if ((first) = "blue") then:
            broadcast "mix purple"
        else:
            set "first" to "red"
            broadcast "red"
            say "Red! Now dip in another colour to mix." for 2 seconds

when I receive "pick yellow":
    if ((first) = "red") then:
        broadcast "mix orange"
    else:
        if ((first) = "blue") then:
            broadcast "mix green"
        else:
            set "first" to "yellow"
            broadcast "yellow"
            say "Yellow! Now dip in another colour to mix." for 2 seconds

when I receive "pick blue":
    if ((first) = "yellow") then:
        broadcast "mix green"
    else:
        if ((first) = "red") then:
            broadcast "mix purple"
        else:
            set "first" to "blue"
            broadcast "blue"
            say "Blue! Now dip in another colour to mix." for 2 seconds

when I receive "mix orange":
    set "first" to ""
    broadcast "orange"
    switch costume to "cheer0"
    say "Red + yellow = ORANGE, a SECONDARY colour!" for 3 seconds
    switch costume to "idle"
when I receive "mix green":
    set "first" to ""
    broadcast "green"
    switch costume to "cheer0"
    say "Yellow + blue = GREEN, a SECONDARY colour!" for 3 seconds
    switch costume to "idle"
when I receive "mix purple":
    set "first" to ""
    broadcast "purple"
    switch costume to "cheer0"
    say "Blue + red = PURPLE, a SECONDARY colour!" for 3 seconds
    switch costume to "idle"

when this sprite clicked:
    switch costume to "think"
    set "fact" to (pick random 1 to 4)
    if ((fact) = 1) then:
        say "I painted the Mona Lisa. People still talk about her smile, 500 years later." for 4 seconds
    if ((fact) = 2) then:
        say "I filled thousands of notebook pages with drawings of birds, water and machines." for 4 seconds
    if ((fact) = 3) then:
        say "I often wrote backwards, in MIRROR WRITING. Look at the sign by my window!" for 4 seconds
    if ((fact) = 4) then:
        say "I drew flying machines about 400 years before the first aeroplane flew." for 4 seconds
    switch costume to "idle"
`,
  },
  picture: [[200]],
  check: [{ frames: 60 }, { click: 'Red' }, { frames: 30 }, { click: 'Yellow' }, { frames: 120 }, { click: 'Leonardo' }, { frames: 150 }],
};

// --- 4. A Butterfly Garden -------------------------------------------------------------------------

function chrysalis() {
  return paint(70, 110, (ctx) => {
    ctx.strokeStyle = '#3a5a1f'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(35, 0); ctx.lineTo(35, 16); ctx.stroke();
    const g = ctx.createLinearGradient(0, 16, 0, 104);
    g.addColorStop(0, '#8fe08a'); g.addColorStop(1, '#3fae5a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(35, 60, 24, 42, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#ffd34a';
    for (const [x, y] of [[22, 36], [35, 33], [48, 36]]) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); }
  });
}

const butterflies = {
  id: 'butterfly-garden', title: 'A Butterfly Garden', kind: 'Game', grades: [3, 5], subject: 'Life Science',
  blurb: 'Watch an egg become a butterfly, then fly it with the mouse from flower to flower to spread pollen.',
  learn: 'The four stages of complete metamorphosis (egg, larva, pupa, adult), and how butterflies pollinate flowers while drinking nectar.',
  backdrops: ['world-butterfly'],
  variables: { flowers: 0 },
  monitors: [['flowers', 'large', 8, 8]],
  sounds: ['tune-playful'],
  sprites: [
    { name: 'Butterfly', costumes: [['egg', emoji('🥚', 50)], ['larva', emoji('🐛', 110)], ['pupa', chrysalis()], ['adult', emoji('🦋', 110)]], x: 0, y: 20, size: 80, rotationStyle: 'left-right', sounds: ['magic', 'chime'] },
    { name: 'Leaf', costumes: [['milkweed', emoji('🌿', 150)]], x: 0, y: 0, size: 100 },
    { name: 'Stage label', costumes: [['egg', label('1  EGG', '#fff5c2')], ['larva', label('2  LARVA (caterpillar)', '#c8f2a0')], ['pupa', label('3  PUPA (chrysalis)', '#a0e6b4')], ['adult', label('4  ADULT (butterfly)', '#ffc08a')]], x: 0, y: 140, visible: false },
    { name: 'Flower', costumes: [['bloom', emoji('🌸', 90)], ['sunflower', emoji('🌻', 90)], ['hibiscus', emoji('🌺', 90)], ['daisy', emoji('🌼', 90)]], x: 0, y: -120, visible: false, variables: { visited: 0 }, sounds: ['pop'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "flowers" to 0
    show caption "A butterfly lays a tiny egg on a leaf..."
    play sound "tune-playful" until done
`,
    Leaf: `
when flag clicked:
    show
    go to x: 0 y: 0
when I receive "fly":
    hide
`,
    'Stage label': `
when flag clicked:
    switch costume to "egg"
    show
when I receive "larva":
    switch costume to "larva"
when I receive "pupa":
    switch costume to "pupa"
when I receive "adult":
    switch costume to "adult"
when I receive "fly":
    hide
`,
    Butterfly: `
when flag clicked:
    switch costume to "egg"
    go to x: 10 y: 5
    set size to 80 %
    show
    wait 3 seconds
    broadcast "larva"
    switch costume to "larva"
    start sound "magic"
    show caption "The egg hatches into a LARVA, a caterpillar. It eats and eats, and grows and grows."
    set size to 40 %
    repeat 30:
        change size by 2
        change x by 1
        wait 0.08 seconds
    broadcast "pupa"
    switch costume to "pupa"
    start sound "magic"
    show caption "It hangs upside down and becomes a PUPA. Inside the chrysalis, its whole body changes."
    set size to 90 %
    repeat 6:
        turn right 5 degrees
        wait 0.2 seconds
        turn left 5 degrees
        wait 0.2 seconds
    broadcast "adult"
    switch costume to "adult"
    start sound "chime"
    show caption "Out comes an ADULT butterfly! Move the mouse to fly it to the flowers."
    point in direction 90
    wait 1.5 seconds
    broadcast "fly"
    set size to 60 %
    forever:
        if ((distance to "mouse-pointer") > 8) then:
            point towards "mouse-pointer"
            move 5 steps
        change y by 3
        wait 0.03 seconds
        change y by -3
`,
    Flower: `
when flag clicked:
    hide

when I receive "fly":
    show caption "Drink nectar from each flower. Pollen sticks to you and you carry it to the next one!"
    repeat 6:
        create clone of "myself"
        wait 0.2 seconds

when I start as a clone:
    repeat (pick random 0 to 3):
        next costume
    go to x: (pick random -200 to 200) y: (pick random -140 to 60)
    set "visited" to 0
    set size to 70 %
    show
    forever:
        if (((visited) = 0) and (touching "Butterfly" ?)) then:
            set "visited" to 1
            change "flowers" by 1
            start sound "pop"
            repeat 4:
                change size by 8
            if ((flowers) = 6) then:
                show caption "All six flowers pollinated! Now they can make seeds, and new flowers will grow."
`,
  },
  picture: [[300]],
  check: [{ frames: 600 }],
};

// --- 5. Inside an Animal Cell ----------------------------------------------------------------------

function cellBackdrop(ctx, w, h) {
  // A deep blue microscope view with one huge cell filling it.
  const bg = ctx.createRadialGradient(480, 360, 100, 480, 360, 620);
  bg.addColorStop(0, '#1c4f7a');
  bg.addColorStop(1, '#0b1d33');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Cytoplasm with a soft membrane edge.
  const cy = ctx.createRadialGradient(480, 360, 60, 480, 360, 420);
  cy.addColorStop(0, '#ffe9f0');
  cy.addColorStop(1, '#ffc4d8');
  ctx.fillStyle = cy;
  ctx.beginPath();
  ctx.ellipse(480, 360, 430, 320, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ff8fb5';
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#c2457a';
  ctx.stroke();
  // Tiny ribosomes speckled through the cytoplasm.
  ctx.fillStyle = '#7a3fa0';
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 220; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd());
    ctx.beginPath();
    ctx.arc(480 + Math.cos(a) * 400 * r, 360 + Math.sin(a) * 290 * r, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function nucleus() {
  return paint(230, 230, (ctx) => {
    ctx.fillStyle = '#b48cff'; ctx.strokeStyle = '#4b2a8a'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(115, 115, 105, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6a3fc8';
    ctx.beginPath(); ctx.arc(130, 105, 34, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4b2a8a'; ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(70 + i * 16, 160 - (i % 2) * 18, 14, 0, Math.PI); ctx.stroke(); }
  });
}

function mitochondrion() {
  return paint(170, 90, (ctx) => {
    ctx.fillStyle = '#ff8a3d'; ctx.strokeStyle = '#9a3d0f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.ellipse(85, 45, 78, 38, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#ffd3a8'; ctx.lineWidth = 6; ctx.beginPath();
    ctx.moveTo(18, 45);
    for (let x = 18; x <= 152; x += 19) ctx.lineTo(x, (x / 19) % 2 < 1 ? 20 : 70);
    ctx.stroke();
  });
}

function golgi() {
  return paint(170, 120, (ctx) => {
    ctx.strokeStyle = '#1f9e8f'; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) { ctx.lineWidth = 14; ctx.beginPath(); ctx.arc(85, 150 - i * 4, 60 + i * 16, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); }
    ctx.fillStyle = '#5fe0cf';
    for (const [x, y] of [[20, 50], [150, 46], [160, 80]]) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); }
  });
}

function er() {
  return paint(200, 130, (ctx) => {
    ctx.strokeStyle = '#3d7bd9'; ctx.lineWidth = 12; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(10, 20 + i * 30);
      for (let x = 10; x <= 190; x += 30) ctx.quadraticCurveTo(x + 15, 5 + i * 30 + (x % 60 ? 30 : 0), x + 30, 20 + i * 30);
      ctx.stroke();
    }
    ctx.fillStyle = '#7a3fa0';
    for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.arc(15 + (i * 37) % 180, 12 + (i % 4) * 30, 4, 0, Math.PI * 2); ctx.fill(); }
  });
}

const PARTS = [
  ['Nucleus', 'the NUCLEUS, the control centre. It holds the cell\'s DNA, the instructions for everything the cell does.'],
  ['Mitochondrion', 'a MITOCHONDRION, the power plant. It turns sugar and oxygen into energy the cell can use.'],
  ['Golgi', 'the GOLGI APPARATUS, the post office. It packs proteins into little bubbles and sends them where they are needed.'],
  ['ER', 'the ENDOPLASMIC RETICULUM, a folded highway. The dots on it are RIBOSOMES, which build proteins.'],
  ['Membrane', 'the CELL MEMBRANE, the security gate. It decides what can come in and what goes out.'],
  ['Lysosome', 'a LYSOSOME, the recycling crew. It breaks down worn-out parts and waste.'],
];

const cell = {
  id: 'animal-cell', title: 'Inside an Animal Cell', kind: 'Quiz', grades: [6, 8], subject: 'Life Science',
  blurb: 'Click each part of the cell to find out its job, then press Q to test yourself.',
  learn: 'The main organelles of an animal cell and what each one does: nucleus, mitochondria, ribosomes, endoplasmic reticulum, Golgi apparatus, lysosomes and the cell membrane.',
  backdrops: [{ name: 'Microscope', paint: cellBackdrop }],
  variables: { found: 0, score: 0 },
  monitors: [['found', 'normal', 8, 8], ['score', 'normal', 8, 40]],
  sounds: ['chime', 'win', 'hit'],
  sprites: [
    { name: 'Nucleus', costumes: [['nucleus', nucleus()]], x: 10, y: 10, size: 100, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Mitochondrion', costumes: [['mito', mitochondrion()]], x: -150, y: 80, size: 90, direction: 75, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Golgi', costumes: [['golgi', golgi()]], x: 150, y: 70, size: 85, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'ER', costumes: [['er', er()]], x: -120, y: -80, size: 80, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Lysosome', costumes: [['lyso', circle(22, '#ffe14a', '#a07a00', 5)]], x: 150, y: -85, size: 100, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Membrane', costumes: [['tag', label('MEMBRANE', '#ff8fb5', '#1e2a3a', 24)]], x: 0, y: -160, variables: { seen: 0 }, sounds: ['pop'] },
    { name: 'Guide', lib: 'toon-robo', use: ['idle', 'talk', 'cheer0', 'think'], x: 195, y: 125, size: 40 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "found" to 0
    set "score" to 0
    show caption "Click the parts of the cell. Find all six, then press Q for the quiz."
`,
    ...Object.fromEntries(PARTS.map(([name, job]) => [name, `
when flag clicked:
    set "seen" to 0
    forever:
        change size by 2
        wait 0.5 seconds
        change size by -2
        wait 0.5 seconds

when this sprite clicked:
    start sound "pop"
    if ((seen) = 0) then:
        set "seen" to 1
        change "found" by 1
    show caption "This is ${job.replace(/"/g, "'")}"
    repeat 3:
        change "brightness" effect by 15
        wait 0.1 seconds
    clear graphic effects
`])),
    Guide: `
when flag clicked:
    switch costume to "talk"
    say "I shrank to fit inside a cell! Click its parts to learn their jobs." for 4 seconds
    switch costume to "idle"
    wait until ((found) = 6)
    switch costume to "cheer0"
    say "You found all six! Press Q for the quiz." for 3 seconds

when "q" key pressed:
    set "score" to 0
    switch costume to "think"
    ask "Which part is the cell's power plant?" and wait
    if ((answer) contains "mito" ?) then:
        change "score" by 1
        say "Yes!" for 1 seconds
    else:
        say "It's the mitochondrion." for 2 seconds
    ask "Which part holds the DNA?" and wait
    if ((answer) contains "nucle" ?) then:
        change "score" by 1
        say "Right!" for 1 seconds
    else:
        say "It's the nucleus." for 2 seconds
    ask "Which part decides what comes in and out?" and wait
    if ((answer) contains "membrane" ?) then:
        change "score" by 1
        say "Correct!" for 1 seconds
    else:
        say "It's the cell membrane." for 2 seconds
    ask "Which part packs and ships proteins?" and wait
    if ((answer) contains "golgi" ?) then:
        change "score" by 1
        say "Yes!" for 1 seconds
    else:
        say "It's the Golgi apparatus." for 2 seconds
    switch costume to "cheer0"
    say (join (join "You scored " (score)) " out of 4!")
`,
  },
  picture: [[90]],
  check: [{ frames: 40 }, { click: 'Nucleus' }, { click: 'Mitochondrion' }, { click: 'Golgi' }, { click: 'ER' }, { click: 'Lysosome' }, { click: 'Membrane' }, { frames: 150 },
    { press: 'q' }, { frames: 20 }, { answer: 'mitochondria' }, { frames: 50 }, { answer: 'nucleus' }, { frames: 50 }, { answer: 'cell membrane' }, { frames: 50 }, { answer: 'golgi' }, { frames: 60 },
    { expect: { score: 4 } }],
};

export default [waterCycle, volcano, davinci, butterflies, cell];
