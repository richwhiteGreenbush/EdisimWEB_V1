// Learning projects: earth. Written with ./kit.js; see featured.js for worked examples.
// Ids are PERSISTED in links (?project=<id>), so they are only ever added.
//
// Earth & Space, nine projects: Phases of the Moon, Planet Parade, The Rock Cycle (grades 3-5);
// Why We Have Seasons, Plates on the Move, Layers of the Atmosphere (6-8); Kepler's Orbits,
// The Life of a Star, The Greenhouse Effect (9-12).
import { emoji, label, circle, rect, paint } from './kit.js';

// --- shared painting ------------------------------------------------------------------------------

// Stage steps to backdrop pixels (a backdrop is painted at twice stage scale, 960 x 720).
const cx = (x) => (x + 240) * 2;
const cy = (y) => (180 - y) * 2;

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function spaceSky(ctx, w, h, top = '#070b24', bottom = '#1b2257', n = 160, seed = 3) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const rnd = seeded(seed);
  for (let i = 0; i < n; i++) {
    const r = rnd() < 0.85 ? 1.2 : 2.4;
    ctx.globalAlpha = 0.4 + rnd() * 0.6;
    ctx.fillStyle = rnd() < 0.15 ? '#ffe9a8' : '#ffffff';
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function glowBall(ctx, x, y, r, inner, mid, outer = 'rgba(0,0,0,0)') {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function text(ctx, s, x, y, { px = 24, fill = '#ffffff', align = 'center', weight = 700, stroke = null } = {}) {
  ctx.font = `${weight} ${px}px "Fredoka", "Nunito", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (stroke) { ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.strokeStyle = stroke; ctx.strokeText(s, x, y); }
  ctx.fillStyle = fill;
  ctx.fillText(s, x, y);
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

function arrow(ctx, x1, y1, x2, y2, colour, lw = 6, head = 16) {
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2 + Math.cos(a) * head * 0.6, y2 + Math.sin(a) * head * 0.6);
  ctx.lineTo(x2 - Math.cos(a - 0.5) * head, y2 - Math.sin(a - 0.5) * head);
  ctx.lineTo(x2 - Math.cos(a + 0.5) * head, y2 - Math.sin(a + 0.5) * head);
  ctx.closePath();
  ctx.fill();
}

// A little Earth: ocean, a few green continents, an outline.
function earthDisc(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#2f86e0';
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = '#5cc25a';
  for (const [dx, dy, rx, ry, rot] of [[-0.35, -0.3, 0.32, 0.22, 0.5], [0.3, 0.1, 0.28, 0.4, -0.3], [-0.2, 0.45, 0.25, 0.15, 0.2], [0.45, -0.5, 0.18, 0.12, 0]]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * r, y + dy * r, rx * r, ry * r, rot, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(x, y - r * 0.95, r * 0.5, r * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// =================================================================================================
// 1. Phases of the Moon (grades 3-5)
// =================================================================================================

const PHASES = [
  ['new', 'New Moon', 'NEW MOON: the Moon is between Earth and the Sun. Its lit half faces away from us, so we can hardly see it.'],
  ['waxing crescent', 'Waxing Crescent', 'WAXING CRESCENT: a thin sliver of the lit half shows. WAXING means growing.'],
  ['first quarter', 'First Quarter', 'FIRST QUARTER: the Moon is a quarter of the way round, and we see half of its face lit.'],
  ['waxing gibbous', 'Waxing Gibbous', 'WAXING GIBBOUS: more than half of the face is lit, and it is still growing.'],
  ['full', 'Full Moon', 'FULL MOON: Earth is between the Sun and the Moon, so we see the whole lit half.'],
  ['waning gibbous', 'Waning Gibbous', 'WANING GIBBOUS: the lit part starts to shrink. WANING means shrinking.'],
  ['third quarter', 'Third Quarter', 'THIRD QUARTER: three quarters of the way round. Half the face is lit again, the other half this time.'],
  ['waning crescent', 'Waning Crescent', 'WANING CRESCENT: one last sliver before the next new moon. A whole cycle takes about 29.5 days.'],
];

function moonPhasesBackdrop(ctx, w, h) {
  spaceSky(ctx, w, h, '#060a22', '#14194a', 170, 11);
  // The Sun's glow at the left edge, and its light streaming right.
  glowBall(ctx, -60, 330, 260, 'rgba(255,236,150,0.95)', 'rgba(255,190,60,0.45)');
  for (const y of [120, 220, 320, 420, 520]) arrow(ctx, 70, y, 150, y, 'rgba(255,215,90,0.9)', 6, 18);
  ctx.save();
  ctx.translate(36, 330);
  ctx.rotate(-Math.PI / 2);
  text(ctx, 'SUNLIGHT', 0, 0, { px: 30, fill: '#3a2400' });
  ctx.restore();
  // The Moon's orbit around Earth.
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = 'rgba(190,210,255,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx(-60), cy(20), 190, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  text(ctx, 'Looking down on Earth from above the North Pole', cx(-60), cy(-97), { px: 17, fill: '#b9c8ff', weight: 600 });
  // The "what we see" panel.
  ctx.fillStyle = 'rgba(16,28,70,0.92)';
  ctx.strokeStyle = '#8fb4ff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(cx(102), cy(152), 272, 496, 22);
  ctx.fill();
  ctx.stroke();
  text(ctx, 'WHAT WE SEE', cx(169), cy(138), { px: 26, fill: '#ffd34a' });
  text(ctx, 'from Earth (northern half)', cx(169), cy(122), { px: 16, fill: '#b9c8ff', weight: 600 });
}

// The Moon as the diagram shows it: the half facing the Sun (left) is always lit.
function halfLitMoon(r) {
  return paint(r * 2 + 10, r * 2 + 10, (ctx, w, h) => {
    const x = w / 2;
    const y = h / 2;
    ctx.fillStyle = '#2b2f45';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f3efe0';
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c9cfe8'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  });
}

function halfLitEarth(r) {
  return paint(r * 2 + 10, r * 2 + 10, (ctx, w, h) => {
    earthDisc(ctx, w / 2, h / 2, r);
    ctx.fillStyle = 'rgba(4,8,30,0.62)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d9e6ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke();
  });
}

// The Moon as seen from Earth at step 0..7 (northern hemisphere: waxing is lit on the right).
function phaseView(step) {
  const r = 88;
  return paint(196, 196, (ctx, w, h) => {
    const x = w / 2;
    const y = h / 2;
    const lit = '#f4f0de';
    const dark = '#272b42';
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, w, h);
    const phi = (step * 45 * Math.PI) / 180;
    const c = Math.cos(phi);
    const waxing = step < 4;
    if (step === 4) {
      ctx.fillStyle = lit; ctx.fillRect(0, 0, w, h);
    } else if (step !== 0) {
      ctx.fillStyle = lit;
      ctx.beginPath();
      if (waxing) ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
      else ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
      if (Math.abs(c) > 0.01) {
        ctx.fillStyle = c > 0 ? dark : lit;
        ctx.beginPath(); ctx.ellipse(x, y, r * Math.abs(c), r, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Craters: faint "seas" that show on the lit part.
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = '#7d7890';
    for (const [dx, dy, rr] of [[-0.3, -0.25, 0.22], [0.25, -0.35, 0.14], [0.1, 0.25, 0.26], [-0.4, 0.35, 0.12], [0.5, 0.1, 0.1]]) {
      ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#8fa2d8'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  });
}

const moonPhases = {
  id: 'moon-phases', title: 'Phases of the Moon', kind: 'Simulation', grades: [3, 5], subject: 'Earth & Space',
  blurb: 'Move the Moon around Earth and watch it change from new to full and back again.',
  learn: 'Why the Moon has phases: the Sun always lights half of it, and as it orbits Earth we see more or less of that lit half. The eight phase names, and that a full cycle takes about 29.5 days.',
  backdrops: [{ name: 'Moon and Earth', paint: moonPhasesBackdrop }],
  variables: { step: 0, angle: 180, busy: 0, 'days since new moon': 0, trips: 0 },
  monitors: [['days since new moon', 'normal', 8, 8]],
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'Earth', costumes: [['earth', halfLitEarth(42)]], x: -60, y: 20, sounds: ['chime'] },
    { name: 'Moon', costumes: [['moon', halfLitMoon(20)]], x: -155, y: 20, rotationStyle: "don't rotate", sounds: ['whoosh'] },
    { name: 'Phase', costumes: PHASES.map(([n], i) => [n, phaseView(i)]), x: 169, y: 58 },
    { name: 'Phase name', costumes: PHASES.map(([n, title]) => [n, label(title, '#ffd34a', '#1e2a3a', 22)]), x: 169, y: -18 },
    { name: 'Next', costumes: [['button', label('▶  Next', '#7ee08a', '#1e2a3a', 26)]], x: 169, y: -68, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "step" to 0
    set "angle" to 180
    set "busy" to 0
    set "trips" to 0
    set "days since new moon" to 0
    show caption "The Sun always lights the half of the Moon that faces it. Click NEXT (or the Moon) to move it around Earth."
    play sound "tune-wonder" until done

when I receive "next":
    # Ignore clicks while the Moon is still moving.
    if ((busy) = 0) then:
        set "busy" to 1
        broadcast "move" and wait
        change "step" by 1
        if ((step) = 8) then:
            set "step" to 0
            change "trips" by 1
        # A whole cycle is about 29.5 days, so each of the 8 steps is about 3.7 days.
        set "days since new moon" to (round (((step) * 29.5) / 8))
        broadcast "phase"
        set "busy" to 0

when I receive "phase":
${PHASES.map(([, , cap], i) => `    if ((step) = ${i}) then:\n        show caption "${cap}"`).join('\n')}
`,
    Moon: `
when flag clicked:
    go to x: (-60 + (95 * ("cos" of (angle)))) y: (20 + (95 * ("sin" of (angle))))

when this sprite clicked:
    broadcast "next"

when I receive "move":
    start sound "whoosh"
    # 45 degrees of orbit, 3 degrees at a time.
    repeat 15:
        change "angle" by 3
        go to x: (-60 + (95 * ("cos" of (angle)))) y: (20 + (95 * ("sin" of (angle))))
`,
    Earth: `
when this sprite clicked:
    start sound "chime"
    say "Earth spins once a day, so we see the Moon rise and set. The phase changes much more slowly." for 4 seconds
`,
    Phase: `
when flag clicked:
    switch costume to "new"

when I receive "phase":
    next costume
    repeat 4:
        change size by 3
    repeat 4:
        change size by -3
`,
    'Phase name': `
when flag clicked:
    switch costume to "new"

when I receive "phase":
    next costume
`,
    Next: `
when this sprite clicked:
    start sound "click"
    broadcast "next"
`,
  },
  picture: [[60]],
  check: [{ frames: 40 }, ...Array.from({ length: 8 }, () => [{ click: 'Next' }, { frames: 25 }]).flat(), { expect: { trips: 1, step: 0 } },
    { click: 'Moon' }, { frames: 25 }, { click: 'Next' }, { frames: 25 }, { click: 'Next' }, { frames: 25 }, { click: 'Next' }, { frames: 25 }, { expect: { step: 4 } }],
};

// =================================================================================================
// 2. Planet Parade (grades 3-5)
// =================================================================================================

const SUN_X = -290;
const PLANETS = [
  // name, slot x, pile x, pile y, fact
  ['Mercury', -195, 5, -66, 'MERCURY is the smallest planet and the closest to the Sun. A year there lasts only 88 Earth days.'],
  ['Venus', -162, 162, -15, 'VENUS is the hottest planet, about 465 °C, because its thick clouds and air trap the heat.'],
  ['Earth', -125, 55, -15, 'EARTH is the only planet we know of with life, and the only one with oceans of liquid water.'],
  ['Mars', -92, -112, -62, 'MARS looks red because its dust has iron oxide in it: rust! It has the tallest volcano in the solar system.'],
  ['Jupiter', -42, -52, -15, 'JUPITER is the biggest planet: more than 1,300 Earths would fit inside. Its Great Red Spot is a storm bigger than Earth.'],
  ['Saturn', 32, 190, -60, 'SATURN has bright rings made of chunks of ice and rock. It is so light for its size that it is less dense than water.'],
  ['Uranus', 112, 108, -62, 'URANUS is tipped right over on its side, so it rolls around the Sun like a ball.'],
  ['Neptune', 186, -186, -15, 'NEPTUNE is the farthest planet and has the fastest winds in the solar system. One trip around the Sun takes about 165 years.'],
];

function paradeBackdrop(ctx, w, h) {
  spaceSky(ctx, w, h, '#05081d', '#171c46', 190, 21);
  const sx = cx(SUN_X);
  const sy = cy(40);
  // Orbits as arcs around the Sun.
  ctx.strokeStyle = 'rgba(170,190,255,0.35)';
  ctx.lineWidth = 2;
  for (const [, slot] of PLANETS) {
    const r = (slot - SUN_X) * 2;
    ctx.beginPath(); ctx.arc(sx, sy, r, -0.42, 0.42); ctx.stroke();
  }
  glowBall(ctx, sx, sy, 230, '#fff7c8', 'rgba(255,170,40,0.9)', 'rgba(255,120,0,0)');
  ctx.fillStyle = '#ffcf3a';
  ctx.beginPath(); ctx.arc(sx, sy, 140, 0, Math.PI * 2); ctx.fill();
  text(ctx, 'SUN', cx(-229), cy(40), { px: 17, fill: '#7a3b00' });
  // Numbered places 1-8.
  PLANETS.forEach(([, slot], i) => {
    ctx.fillStyle = 'rgba(255,211,74,0.18)';
    ctx.strokeStyle = 'rgba(255,211,74,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx(slot), cy(84), 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    text(ctx, String(i + 1), cx(slot), cy(84), { px: 18, fill: '#ffd34a' });
  });
  text(ctx, 'PLANET PARADE', cx(20), cy(150), { px: 34, fill: '#ffd34a', stroke: '#2a1f55' });
  text(ctx, 'Sizes and distances are not to scale', cx(20), cy(124), { px: 15, fill: '#a8b4e8', weight: 600 });
  // The pile of planets waiting to be put in order.
  ctx.fillStyle = 'rgba(120,140,255,0.10)';
  ctx.strokeStyle = 'rgba(160,180,255,0.35)';
  ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.roundRect(cx(-232), cy(16), 928, 200, 26); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
}

function planetPainter(name) {
  const S = { Mercury: 14, Venus: 22, Earth: 24, Mars: 18, Jupiter: 50, Saturn: 40, Uranus: 32, Neptune: 31 };
  const r = S[name];
  const W = name === 'Saturn' ? 172 : r * 2 + 10;
  const H = name === 'Saturn' ? 100 : r * 2 + 10;
  return paint(W, H, (ctx, w, h) => {
    const x = w / 2;
    const y = h / 2;
    const ring = (front) => {
      ctx.save();
      ctx.beginPath();
      if (front) ctx.rect(0, y, w, h); else ctx.rect(0, 0, w, y);
      ctx.clip();
      ctx.lineWidth = 9; ctx.strokeStyle = '#e8d6a6';
      ctx.beginPath(); ctx.ellipse(x, y, 80, 22, -0.12, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = '#b89a62';
      ctx.beginPath(); ctx.ellipse(x, y, 66, 17, -0.12, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    };
    if (name === 'Saturn') ring(false);
    if (name === 'Earth') { earthDisc(ctx, x, y, r); } else {
      const base = { Mercury: '#a8a29a', Venus: '#f1cf86', Mars: '#d8613a', Jupiter: '#d9b38c', Saturn: '#e6c98a', Uranus: '#8fe3e8', Neptune: '#3d6fe0' }[name];
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, base);
      g.addColorStop(1, base);
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.clip();
      if (name === 'Jupiter' || name === 'Saturn') {
        const bands = name === 'Jupiter' ? ['#b07a52', '#f0dcc0', '#a8693f', '#e9cfa9', '#b98559'] : ['#cfae6e', '#f2deb0', '#c9a467'];
        bands.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(x - r, y - r + (i + 0.6) * (2 * r) / (bands.length + 0.6), 2 * r, r * 0.16);
        });
        ctx.globalAlpha = 1;
        if (name === 'Jupiter') { ctx.fillStyle = '#c4452c'; ctx.beginPath(); ctx.ellipse(x + r * 0.3, y + r * 0.3, r * 0.2, r * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      if (name === 'Mercury' || name === 'Mars') {
        ctx.fillStyle = name === 'Mars' ? '#9e3a1f' : '#7d776f';
        for (const [dx, dy, rr] of [[-0.3, -0.2, 0.2], [0.3, 0.3, 0.16], [0.2, -0.4, 0.1]]) { ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); ctx.fill(); }
        if (name === 'Mars') { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x, y - r * 0.92, r * 0.4, r * 0.15, 0, 0, Math.PI * 2); ctx.fill(); }
      }
      if (name === 'Neptune') { ctx.fillStyle = '#1e3ea0'; ctx.beginPath(); ctx.ellipse(x - r * 0.2, y + r * 0.2, r * 0.25, r * 0.12, 0, 0, Math.PI * 2); ctx.fill(); }
      if (name === 'Venus') { ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3; for (const k of [-0.4, 0, 0.4]) { ctx.beginPath(); ctx.ellipse(x, y + k * r, r, r * 0.12, 0.2, 0, Math.PI); ctx.stroke(); } }
      ctx.restore();
    }
    ctx.strokeStyle = '#e9eeff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    if (name === 'Saturn') ring(true);
  });
}

const planetParade = {
  id: 'planet-parade', title: 'Planet Parade', kind: 'Game', grades: [3, 5], subject: 'Earth & Space',
  blurb: 'The planets are all mixed up! Click them in order from the Sun outwards to line them up.',
  learn: 'The order of the eight planets from the Sun (Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune), a memory trick for it, and one big fact about each planet.',
  backdrops: [{ name: 'Solar System', paint: paradeBackdrop }],
  variables: { placed: 0 },
  monitors: [['placed', 'normal', 8, 8]],
  sounds: ['tune-playful', 'tada'],
  sprites: PLANETS.map(([name, , px, py]) => ({ name, costumes: [[name.toLowerCase(), planetPainter(name)]], x: px, y: py, variables: { done: 0 }, sounds: ['chime', 'hit'] })),
  scripts: {
    Stage: `
when flag clicked:
    set "placed" to 0
    show caption "Click the planets in order, starting with the one CLOSEST to the Sun."
    play sound "tune-playful" until done

when I receive "parade done":
    start sound "tada"
    show caption "All eight in order! To remember them: My Very Excellent Mother Just Served Us Nachos. (Pluto is a dwarf planet.)"
`,
    ...Object.fromEntries(PLANETS.map(([name, slot, px, py, fact], i) => [name, `
when flag clicked:
    set "done" to 0
    go to x: ${px} y: ${py}
    set size to 100 %

when this sprite clicked:
    if ((done) = 1) then:
        show caption "${i + 1}. ${fact}"
    else:
        # Planet number ${i + 1}: is it this planet's turn?
        if ((placed) = ${i}) then:
            set "done" to 1
            change "placed" by 1
            start sound "chime"
            show caption "${i + 1}. ${fact}"
            glide 0.6 secs to x: ${slot} y: 40
            repeat 3:
                change size by 6
            repeat 3:
                change size by -6
            if ((placed) = 8) then:
                broadcast "parade done"
        else:
            start sound "hit"
            say "Not yet! Which planet comes next?" for 1.5 seconds
`])),
  },
  picture: [[40]],
  check: [{ frames: 20 }, { click: 'Earth' }, { frames: 15 }, { expect: { placed: 0 } },
    ...PLANETS.map(([name]) => [{ click: name }, { frames: 15 }]).flat(), { frames: 30 }, { expect: { placed: 8 } }],
};

// =================================================================================================
// 3. The Rock Cycle (grades 3-5)
// =================================================================================================

function rockCycleBackdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, 330);
  g.addColorStop(0, '#7cc8ff');
  g.addColorStop(1, '#d8f0ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, 330);
  // Mountains, a volcano, the sea.
  blob(ctx, [[560, 330], [700, 150], [790, 250], [880, 120], [960, 220], [960, 330]], '#8a8f9e', null);
  blob(ctx, [[835, 172], [880, 120], [918, 168], [895, 160], [880, 150], [860, 164]], '#ffffff', null);
  blob(ctx, [[0, 330], [90, 200], [130, 200], [240, 330]], '#6b4a3a', null);
  glowBall(ctx, 110, 196, 40, '#ffe14a', 'rgba(255,120,30,0.7)');
  ctx.fillStyle = '#3d8fe0';
  ctx.fillRect(240, 300, 320, 34);
  // Ground layers: soil, sandstone, shale, metamorphic, and magma at the bottom.
  const layers = [['#5c9a3c', 330, 24], ['#d8b47a', 354, 70], ['#b78b5a', 424, 60], ['#8d7a6a', 484, 70], ['#6e5a55', 554, 60]];
  for (const [c, y, hh] of layers) { ctx.fillStyle = c; ctx.fillRect(0, y, w, hh); }
  ctx.strokeStyle = 'rgba(60,40,20,0.35)';
  ctx.lineWidth = 3;
  for (let y = 370; y < 420; y += 14) { ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= w; x += 40) ctx.lineTo(x, y + Math.sin(x / 70) * 4); ctx.stroke(); }
  const m = ctx.createLinearGradient(0, 610, 0, 720);
  m.addColorStop(0, '#ff7a1a');
  m.addColorStop(1, '#c4240f');
  ctx.fillStyle = m;
  ctx.fillRect(0, 614, w, 106);
  // A soft panel behind the rock so it reads as the thing being studied.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = 'rgba(30,42,58,0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(cx(-80), cy(104), 320, 290, 30); ctx.fill(); ctx.stroke();
}

function rockShape(ctx, w, h) {
  const pts = [[0.12, 0.62], [0.2, 0.3], [0.42, 0.14], [0.68, 0.18], [0.88, 0.36], [0.92, 0.66], [0.74, 0.86], [0.38, 0.88], [0.18, 0.8]];
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
  ctx.closePath();
}

function rockPainter(kind) {
  return paint(230, 190, (ctx, w, h) => {
    const rnd = seeded(kind.length * 17 + 3);
    if (kind === 'sediment') {
      // A heap of sand grains and pebbles.
      const cols = ['#d9b37a', '#c49461', '#e8cf9e', '#a87d52', '#8f8a80', '#f0e0bc'];
      for (let i = 0; i < 260; i++) {
        const t = rnd();
        const x = 20 + rnd() * (w - 40);
        const top = h - 20 - Math.sin(((x - 20) / (w - 40)) * Math.PI) * 120;
        const y = top + rnd() * (h - 20 - top);
        ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
        ctx.beginPath(); ctx.arc(x, y, t < 0.85 ? 4 + rnd() * 3 : 9 + rnd() * 5, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }
    ctx.save();
    rockShape(ctx, w, h);
    if (kind === 'magma') {
      const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 120);
      g.addColorStop(0, '#fff6a0'); g.addColorStop(0.4, '#ff9a1f'); g.addColorStop(1, '#c42a0f');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = { igneous: '#d6c4bf', sedimentary: '#d9b47c', metamorphic: '#7d8590' }[kind];
    }
    ctx.fill();
    ctx.clip();
    if (kind === 'magma') {
      ctx.fillStyle = 'rgba(255,250,200,0.8)';
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(30 + rnd() * 170, 30 + rnd() * 130, 4 + rnd() * 8, 0, Math.PI * 2); ctx.fill(); }
    }
    if (kind === 'igneous') {
      // Granite: big interlocking crystals of black, white and pink.
      for (let i = 0; i < 170; i++) {
        ctx.fillStyle = ['#2a2a30', '#ffffff', '#e89a9a', '#9a8f8a'][Math.floor(rnd() * 4)];
        const x = rnd() * w;
        const y = rnd() * h;
        const s = 4 + rnd() * 7;
        ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.3, y + s); ctx.lineTo(x - s, y + s * 0.2); ctx.closePath(); ctx.fill();
      }
    }
    if (kind === 'sedimentary') {
      // Sandstone: flat layers laid down one on top of another.
      const bands = ['#e8cf9e', '#c49461', '#f0dcb0', '#b98a5a', '#dcbb84', '#a87d52', '#efd8a8'];
      for (let i = 0; i < bands.length; i++) { ctx.fillStyle = bands[i]; ctx.fillRect(0, 22 + i * 22, w, 22); }
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(150, 88, 9, Math.PI, 0); ctx.fill();
    }
    if (kind === 'metamorphic') {
      // Gneiss: squeezed into wavy light and dark bands.
      for (let i = 0; i < 12; i++) {
        ctx.strokeStyle = i % 2 ? '#e9e6e0' : '#3a3f48';
        ctx.lineWidth = i % 2 ? 8 : 10;
        ctx.beginPath();
        for (let x = -10; x <= w + 10; x += 8) ctx.lineTo(x, 10 + i * 16 + Math.sin(x / 26 + i * 0.4) * 9);
        ctx.stroke();
      }
    }
    ctx.restore();
    rockShape(ctx, w, h);
    ctx.lineWidth = 5;
    ctx.strokeStyle = kind === 'magma' ? '#7a1a08' : '#1e2a3a';
    ctx.stroke();
  });
}

const ROCKS = [
  ['magma', 'MAGMA\nmelted rock', '#ffb01f'],
  ['igneous', 'IGNEOUS ROCK\nlike granite', '#ffd0c8'],
  ['sediment', 'SEDIMENT\ntiny bits of rock', '#f0dcb0'],
  ['sedimentary', 'SEDIMENTARY ROCK\nlike sandstone', '#e8c58a'],
  ['metamorphic', 'METAMORPHIC ROCK\nlike gneiss', '#c8d0dc'],
];

const rockCycle = {
  id: 'rock-cycle', title: 'The Rock Cycle', kind: 'Game', grades: [3, 6], subject: 'Earth & Space',
  blurb: 'Melt it, cool it, wear it away, squeeze it, heat it. Can you turn one rock into all three kinds?',
  learn: 'The three kinds of rock (igneous, sedimentary and metamorphic), the processes that turn one into another (melting, cooling, weathering and erosion, compaction and cementing, heat and pressure), and that the cycle never stops.',
  backdrops: [{ name: 'Underground', paint: rockCycleBackdrop }],
  variables: { rock: 'magma', kinds: 0, hint: '' },
  monitors: [],
  sounds: ['tada'],
  sprites: [
    { name: 'Rock', costumes: ROCKS.map(([k]) => [k, rockPainter(k)]), x: 0, y: 30, sounds: ['magic', 'splash', 'whoosh', 'knock', 'power-up'] },
    { name: 'Rock name', costumes: ROCKS.map(([k, t, c]) => [k, label(t, c, '#1e2a3a', 20)]), x: 0, y: -55 },
    ...[['Melt', 'Melt it', '#ff8a5a', -172, 92], ['Cool', 'Cool it', '#9ad8ff', -172, 37], ['Erode', 'Wear it away', '#b8e4a0', -172, -18],
      ['Squeeze', 'Squeeze it', '#f5d28a', 175, 70], ['Heat', 'Heat + press', '#ffb3c8', 175, 15]]
      .map(([name, t, c, x, y]) => ({ name, costumes: [['button', label(t, c, '#1e2a3a', 21)]], x, y, sounds: ['click'] })),
    ...[['Igneous', 'IGNEOUS', '#ff9a8a', -150], ['Sedimentary', 'SEDIMENTARY', '#f5c26b', 0], ['Metamorphic', 'METAMORPHIC', '#9ab8e8', 150]]
      .map(([name, t, c, x]) => ({ name: `${name} badge`, costumes: [['not yet', label(`${t}  ?`, '#d9dde6', '#5a6472', 20)], ['made', label(`${t}  ✓`, c, '#1e2a3a', 20)]], x, y: 150, variables: { made: 0 } })),
    { name: 'Riley', lib: 'toon-riley', use: ['idle', 'talk', 'cheer0', 'think'], x: 200, y: -62, size: 58 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "rock" to "magma"
    set "kinds" to 0
    show caption "Deep underground, rock gets so hot it melts into MAGMA. Click the buttons to change it. Make all three kinds of rock!"

when I receive "all three":
    start sound "tada"
    show caption "You made all three kinds! On Earth rock keeps changing from one kind to another over millions of years: the ROCK CYCLE."
`,
    Rock: `
when flag clicked:
    switch costume to "magma"
    forever:
        change size by 2
        wait 0.6 seconds
        change size by -2
        wait 0.6 seconds

when I receive "melt":
    if ((rock) = "magma") then:
        set "hint" to "It is already melted!"
        broadcast "hint"
    else:
        set "rock" to "magma"
        start sound "power-up"
        switch costume to "magma"
        show caption "Deep underground it is hot enough to MELT rock. Melted rock is called MAGMA."
        broadcast "changed"

when I receive "cool":
    if ((rock) = "magma") then:
        set "rock" to "igneous"
        start sound "splash"
        switch costume to "igneous"
        show caption "Magma cools into IGNEOUS rock. Slow cooling underground makes big crystals (granite); fast cooling lava makes tiny ones (basalt)."
        broadcast "changed"
    else:
        set "hint" to "Only melted rock (magma) can cool into igneous rock."
        broadcast "hint"

when I receive "erode":
    if ((rock) = "magma") then:
        set "hint" to "Magma is deep underground. Cool it into rock first!"
        broadcast "hint"
    else:
        if ((rock) = "sediment") then:
            set "hint" to "It is already sediment: tiny bits of rock."
            broadcast "hint"
        else:
            set "rock" to "sediment"
            start sound "whoosh"
            switch costume to "sediment"
            show caption "Rain, wind, ice and rivers break rock into tiny bits called SEDIMENT and carry them away. That is WEATHERING and EROSION."
            broadcast "changed"

when I receive "squeeze":
    if ((rock) = "sediment") then:
        set "rock" to "sedimentary"
        start sound "knock"
        switch costume to "sedimentary"
        show caption "Layers of sediment pile up. Their weight presses them together and minerals CEMENT them into SEDIMENTARY rock, like sandstone."
        broadcast "changed"
    else:
        set "hint" to "You need sediment first. Try wearing a rock away."
        broadcast "hint"

when I receive "heat":
    if (((rock) = "igneous") or ((rock) = "sedimentary")) then:
        set "rock" to "metamorphic"
        start sound "magic"
        switch costume to "metamorphic"
        show caption "Deep down, great heat and pressure change rock WITHOUT melting it. It becomes METAMORPHIC rock, like gneiss or marble."
        broadcast "changed"
    else:
        if ((rock) = "metamorphic") then:
            set "hint" to "It is already metamorphic. Even more heat would melt it!"
        if ((rock) = "magma") then:
            set "hint" to "It is melted. Cool it into rock first."
        if ((rock) = "sediment") then:
            set "hint" to "Squeeze the sediment into rock first."
        broadcast "hint"

when I receive "changed":
    repeat 4:
        turn right 6 degrees
        wait 0.05 seconds
        turn left 6 degrees
        wait 0.05 seconds
`,
    'Rock name': `
when flag clicked:
    switch costume to "magma"

when I receive "changed":
${ROCKS.map(([k]) => `    if ((rock) = "${k}") then:\n        switch costume to "${k}"`).join('\n')}
`,
    ...Object.fromEntries([['Melt', 'melt'], ['Cool', 'cool'], ['Erode', 'erode'], ['Squeeze', 'squeeze'], ['Heat', 'heat']].map(([n, m]) => [n, `
when this sprite clicked:
    start sound "click"
    change size by -8
    broadcast "${m}"
    wait 0.1 seconds
    change size by 8
`])),
    ...Object.fromEntries(['Igneous', 'Sedimentary', 'Metamorphic'].map((n) => [`${n} badge`, `
when flag clicked:
    set "made" to 0
    switch costume to "not yet"

when I receive "changed":
    if (((rock) = "${n.toLowerCase()}") and ((made) = 0)) then:
        set "made" to 1
        switch costume to "made"
        change "kinds" by 1
        repeat 3:
            change size by 10
        repeat 3:
            change size by -10
        if ((kinds) = 3) then:
            broadcast "all three"
`])),
    Riley: `
when flag clicked:
    switch costume to "talk"
    say "I study rocks!" for 2 seconds
    switch costume to "idle"

when I receive "hint":
    show caption (join "Hmm... " (hint))
    switch costume to "think"
    say "Try another!" for 2 seconds
    switch costume to "idle"

when I receive "all three":
    switch costume to "cheer0"
    say "Rock on!" for 3 seconds
    switch costume to "idle"
`,
  },
  picture: [[60]],
  check: [{ frames: 30 }, { click: 'Squeeze' }, { frames: 20 }, { expect: { rock: 'magma' } },
    { click: 'Cool' }, { frames: 40 }, { click: 'Erode' }, { frames: 40 }, { click: 'Squeeze' }, { frames: 40 }, { click: 'Heat' }, { frames: 40 },
    { expect: { kinds: 3, rock: 'metamorphic' } }, { click: 'Melt' }, { frames: 40 }, { expect: { rock: 'magma' } }],
};

// =================================================================================================
// 4. Why We Have Seasons (grades 5-8)
// =================================================================================================

const SEASONS = [
  // costume, direction to the Sun (canvas radians), info lines, caption, noon-Sun position in the panel
  ['june', 0, 'JUNE\nNorth leans to Sun\nSummer starts\nLongest day',
    'JUNE: the North Pole leans TOWARD the Sun. Sunlight is more direct and days are long: summer in the north, winter in Australia.', [150, 119]],
  ['september', -Math.PI / 2, 'SEPTEMBER\nNeither pole leans\nAutumn starts\nDay ≈ night',
    'SEPTEMBER: a quarter of the way round. The axis still points the same way in space, but now neither pole leans toward the Sun.', [172, 107]],
  ['december', Math.PI, 'DECEMBER\nNorth leans away\nWinter starts\nShortest day',
    'DECEMBER: the North Pole leans AWAY. Sunlight comes in low and spread out, days are short: winter in the north, summer in Australia.', [190, 85]],
  ['march', Math.PI / 2, 'MARCH\nNeither pole leans\nSpring starts\nDay ≈ night',
    'MARCH: neither pole leans toward the Sun: spring in the north, autumn in the south. One trip around the Sun takes a year.', [172, 107]],
];

function seasonsBackdrop(ctx, w, h) {
  spaceSky(ctx, w, h, '#050920', '#141a44', 180, 31);
  // The orbit, seen from a little above.
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = 'rgba(190,210,255,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(cx(-68), cy(35), 272, 120, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  for (const [t, x, y] of [['JUNE', -204, -2], ['SEPTEMBER', -68, -60], ['DECEMBER', 68, -2], ['MARCH', -68, 130]]) text(ctx, t, cx(x), cy(y), { px: 17, fill: '#b9c8ff' });
  // The noon-Sun panel.
  ctx.fillStyle = 'rgba(16,28,70,0.94)';
  ctx.strokeStyle = '#8fb4ff';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(cx(103), cy(162), 268, 520, 22); ctx.fill(); ctx.stroke();
  const sky = ctx.createLinearGradient(0, cy(140), 0, cy(48));
  sky.addColorStop(0, '#5fb4f0'); sky.addColorStop(1, '#cdeeff');
  ctx.fillStyle = sky;
  ctx.fillRect(cx(110), cy(140), 252, (140 - 48) * 2);
  ctx.fillStyle = '#5c9a3c';
  ctx.fillRect(cx(110), cy(48), 252, 28);
  // A house to stand by.
  ctx.fillStyle = '#e0533d';
  blob(ctx, [[cx(120), cy(60)], [cx(130), cy(70)], [cx(140), cy(60)]], '#c43d2b', '#1e2a3a', 3);
  ctx.fillStyle = '#ffe9b8'; ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.rect(cx(122), cy(60), 36, 22); ctx.fill(); ctx.stroke();
  text(ctx, 'NOON SUN', cx(169), cy(152), { px: 20, fill: '#ffd34a' });
  text(ctx, 'at about 40° north', cx(169), cy(143) + 4, { px: 14, fill: '#b9c8ff', weight: 600 });
}

function tiltedEarth(toSun) {
  const r = 44;
  const tilt = (23.5 * Math.PI) / 180;
  return paint(136, 136, (ctx, w, h) => {
    const x = w / 2;
    const y = h / 2;
    earthDisc(ctx, x, y, r);
    // Night: the half facing away from the Sun.
    ctx.fillStyle = 'rgba(4,8,30,0.66)';
    ctx.beginPath(); ctx.arc(x, y, r, toSun + Math.PI / 2, toSun + Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d9e6ff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    // The equator and the tilted axis (top leaning right, always the same way).
    const ax = Math.sin(tilt);
    const ay = -Math.cos(tilt);
    ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x + ay * r, y - ax * r); ctx.lineTo(x - ay * r, y + ax * r); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x - ax * r * 1.3, y - ay * r * 1.3); ctx.lineTo(x + ax * r * 1.3, y + ay * r * 1.3); ctx.stroke();
    text(ctx, 'N', x + ax * r * 1.3 + 9, y + ay * r * 1.3 + 2, { px: 16, fill: '#ffffff' });
  });
}

const seasons = {
  id: 'seasons', title: 'Why We Have Seasons', kind: 'Simulation', grades: [5, 8], subject: 'Earth & Space',
  blurb: "Take Earth round the Sun and watch the tilted axis. Then see how high the noon Sun climbs in each season.",
  learn: "Seasons come from Earth's tilt of about 23.5°, not from its distance to the Sun: the hemisphere leaning toward the Sun gets more direct sunlight and longer days. Solstices, equinoxes, and why Australia's seasons are the other way round.",
  backdrops: [{ name: 'Orbit', paint: seasonsBackdrop }],
  variables: { step: 0, angle: 180, busy: 0, trips: 0, score: 0 },
  monitors: [['score', 'normal', 8, 8]],
  sounds: ['tune-chill', 'win'],
  sprites: [
    { name: 'Sun', costumes: [['sun', paint(150, 150, (ctx, w, h) => { glowBall(ctx, w / 2, h / 2, 74, '#fffbe0', 'rgba(255,190,40,0.95)', 'rgba(255,140,0,0)'); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 40, 0, Math.PI * 2); ctx.fill(); })]], x: -68, y: 35 },
    { name: 'Earth', costumes: SEASONS.map(([n, d]) => [n, tiltedEarth(d)]), x: -204, y: 35, rotationStyle: "don't rotate", sounds: ['whoosh'] },
    { name: 'Noon Sun', costumes: [['sun', emoji('☀️', 70)]], x: 150, y: 119, size: 55, rotationStyle: "don't rotate", variables: { sx: 0, sy: 0 } },
    { name: 'Season info', costumes: SEASONS.map(([n, , info]) => [n, label(info, '#ffffff', '#1e2a3a', 17)]), x: 169, y: -22 },
    { name: 'Next', costumes: [['button', label('▶  Next', '#7ee08a', '#1e2a3a', 22)]], x: 169, y: -68, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "step" to 0
    set "angle" to 180
    set "busy" to 0
    set "trips" to 0
    set "score" to 0
    show caption "Earth's axis is tilted about 23.5°, and it always points the same way in space. Click NEXT to move Earth around the Sun."
    play sound "tune-chill" until done

when I receive "next":
    if ((busy) = 0) then:
        set "busy" to 1
        broadcast "move" and wait
        change "step" by 1
        if ((step) = 4) then:
            set "step" to 0
            change "trips" by 1
        broadcast "season" and wait
        set "busy" to 0
        if (((step) = 0) and ((trips) = 1)) then:
            broadcast "surprise"

when I receive "surprise":
    wait 6 seconds
    show caption "Surprise: Earth is CLOSEST to the Sun in early January! Seasons come from the tilt, not the distance. Press Q for a quiz."

when I receive "season":
${SEASONS.map(([, , , cap], i) => `    if ((step) = ${i}) then:\n        show caption "${cap}"`).join('\n')}

when "q" key pressed:
    set "score" to 0
    ask "What causes the seasons: Earth's TILT or its DISTANCE from the Sun?" and wait
    if ((answer) contains "tilt" ?) then:
        change "score" by 1
        show caption "Yes! The tilt changes how directly sunlight hits, and how long the days are."
    else:
        show caption "It's the tilt. Earth's distance from the Sun hardly changes."
    ask "When it is summer in the USA (June), what season is it in Australia?" and wait
    if ((answer) contains "winter" ?) then:
        change "score" by 1
        show caption "Right! The southern half leans away from the Sun in June."
    else:
        show caption "Winter! The two halves of Earth have opposite seasons."
    ask "In which month do places in the north get their LONGEST day?" and wait
    if ((answer) contains "june" ?) then:
        change "score" by 1
        show caption "Correct: the June solstice, about June 21."
    else:
        show caption "June: the June solstice, about June 21."
    if ((score) = 3) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 3. Click NEXT to keep going round.")
`,
    Earth: `
when flag clicked:
    switch costume to "june"
    go to x: (-68 + (136 * ("cos" of (angle)))) y: (35 + (60 * ("sin" of (angle))))

when this sprite clicked:
    broadcast "next"

when I receive "move":
    start sound "whoosh"
    # A quarter of an orbit, 3 degrees at a time, along the ellipse.
    repeat 30:
        change "angle" by 3
        go to x: (-68 + (136 * ("cos" of (angle)))) y: (35 + (60 * ("sin" of (angle))))
    next costume
`,
    'Noon Sun': `
when flag clicked:
    go to x: 150 y: 119
    broadcast "ray"

when I receive "season":
${SEASONS.map(([, , , , [x, y]], i) => `    if ((step) = ${i}) then:\n        glide 0.8 secs to x: ${x} y: ${y}`).join('\n')}
    broadcast "ray"

when I receive "ray":
    # Draw the sunlight coming in to the house: steep in summer, shallow in winter.
    erase all
    set pen color to "#ffd34a"
    set pen size to 4
    set "sx" to (x position)
    set "sy" to (y position)
    pen down
    go to x: 132 y: 60
    pen up
    go to x: (sx) y: (sy)
`,
    'Season info': `
when flag clicked:
    switch costume to "june"

when I receive "season":
    next costume
`,
    Next: `
when this sprite clicked:
    start sound "click"
    broadcast "next"
`,
  },
  picture: [[40]],
  check: [{ frames: 40 }, ...Array.from({ length: 4 }, () => [{ click: 'Next' }, { frames: 60 }]).flat(), { expect: { trips: 1, step: 0 } }, { frames: 200 },
    { press: 'q' }, { frames: 10 }, { answer: 'the tilt' }, { frames: 10 }, { answer: 'Winter' }, { frames: 10 }, { answer: 'June' }, { frames: 10 }, { expect: { score: 3 } }],
};

// =================================================================================================
// 5. Plates on the Move (grades 6-8)
// =================================================================================================

function plateSideBackdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, cy(20));
  g.addColorStop(0, '#6ec6ff');
  g.addColorStop(1, '#dff4ff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, cy(20));
  // The mantle: hot rock that flows very slowly, round in loops (convection).
  const m = ctx.createLinearGradient(0, cy(20), 0, h);
  m.addColorStop(0, '#ffb347');
  m.addColorStop(0.5, '#ff7a1a');
  m.addColorStop(1, '#c4240f');
  ctx.fillStyle = m;
  ctx.fillRect(0, cy(20), w, h - cy(20));
  ctx.strokeStyle = 'rgba(255,240,190,0.85)';
  ctx.lineWidth = 6;
  for (const [x0, dir] of [[cx(-120), -1], [cx(120), 1]]) {
    ctx.beginPath();
    ctx.ellipse(x0, cy(-62), 150, 40, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Arrowheads: up at the middle, out along the top.
    arrow(ctx, x0 - dir * 20, cy(-62) - 40, x0 - dir * 60, cy(-62) - 38, 'rgba(255,240,190,0.95)', 6, 18);
  }
  text(ctx, 'MANTLE', cx(-120), cy(-67), { px: 24, fill: '#ffffff', stroke: '#7a1a08' });
  text(ctx, 'flows very slowly', cx(120), cy(-67), { px: 20, fill: '#ffffff', stroke: '#7a1a08' });
  // Clouds.
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (const [x, y] of [[150, 160], [760, 120]]) { for (const [dx, dy, r] of [[0, 0, 28], [30, -10, 34], [62, 0, 26]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill(); } }
}

function plateTopBackdrop(ctx, w, h) {
  ctx.fillStyle = '#3a2a1f';
  ctx.fillRect(0, 0, w, h);
  text(ctx, 'Looking down from above', cx(0), cy(-100), { px: 22, fill: '#ffffff' });
}

function platePainter(kind, side) {
  // 'long' is a wider ocean plate, so it can slide under the continent without leaving a gap behind it.
  return paint(side === 'long' ? 630 : 470, 150, (ctx, w, h) => {
    const body = kind === 'ocean' ? [8, 58, w - 16, 88] : [8, 28, w - 16, 118];
    // The rock of the plate, with layers.
    const g = ctx.createLinearGradient(0, body[1], 0, h);
    if (kind === 'ocean') { g.addColorStop(0, '#5b6270'); g.addColorStop(1, '#353a45'); } else { g.addColorStop(0, '#b0865a'); g.addColorStop(1, '#6e4f33'); }
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(body[0], body[1], body[2], body[3], 10); ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#1e2a3a'; ctx.stroke();
    if (kind === 'ocean') {
      ctx.fillStyle = '#2f86e0';
      ctx.beginPath(); ctx.roundRect(8, 36, w - 16, 26, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
      for (let x = 30; x < w - 20; x += 60) { ctx.beginPath(); ctx.arc(x, 44, 9, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
      text(ctx, 'OCEAN PLATE (heavy)', side === 'long' ? w - 235 : w / 2, 104, { px: 22, fill: '#ffffff' });
    } else {
      ctx.fillStyle = '#5c9a3c';
      ctx.fillRect(10, 28, 450, 12);
      ctx.fillStyle = '#6fae4a';
      for (const [x, r] of [[300, 34], [360, 26], [420, 30]]) { ctx.beginPath(); ctx.ellipse(x, 30, r * 1.4, r * 0.8, 0, Math.PI, 0); ctx.fill(); }
      text(ctx, 'CONTINENT (lighter)', w / 2, 92, { px: 22, fill: '#ffffff' });
    }
  });
}

function landBlock(side) {
  return paint(480, 760, (ctx, w, h) => {
    ctx.fillStyle = side === 'west' ? '#7fbf5a' : '#8ac766';
    ctx.fillRect(0, 0, w, h);
    // Fields.
    const cols = ['#a8d46f', '#6fae4a', '#c9d96a', '#94c25a'];
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = cols[i % 4];
      ctx.fillRect(side === 'west' ? 30 + (i % 2) * 200 : 40 + (i % 2) * 200, 20 + Math.floor(i / 2) * 200, 180, 150);
    }
    // A road across the fault, a fence and a stream: lines that will be broken and shifted.
    ctx.fillStyle = '#5a5a62'; ctx.fillRect(0, 270, w, 56);
    ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 5; ctx.setLineDash([24, 18]);
    ctx.beginPath(); ctx.moveTo(0, 298); ctx.lineTo(w, 298); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#2f86e0'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(0, 470); ctx.bezierCurveTo(w * 0.3, 440, w * 0.6, 500, w, 470); ctx.stroke();
    ctx.strokeStyle = '#8a5a33'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 150); ctx.lineTo(w, 150); ctx.stroke();
    for (let x = 10; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, 140); ctx.lineTo(x, 162); ctx.stroke(); }
    // The broken edge along the fault.
    ctx.strokeStyle = '#3a2a1f'; ctx.lineWidth = 6;
    const ex = side === 'west' ? w - 3 : 3;
    ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, h); ctx.stroke();
  });
}

const PLATE_DEMOS = [
  ['Apart', '↔  Pull apart', '#8fd0ff', -155],
  ['Together', '→←  Push together', '#ffb38a', 0],
  ['Past', '⇅  Slide past', '#c8a8ff', 158],
];

const plates = {
  id: 'plate-tectonics', title: 'Plates on the Move', kind: 'Animation', grades: [6, 8], subject: 'Earth & Space',
  blurb: "Earth's crust is cracked into plates. Pull them apart, push them together, or slide them past each other and see what happens.",
  learn: 'Plate tectonics: the three kinds of plate boundary (divergent, convergent, transform), what each one builds (new ocean floor, volcanoes and mountains, earthquake faults), and that the mantle moves the plates a few centimetres a year.',
  backdrops: [{ name: 'Side view', paint: plateSideBackdrop }, { name: 'From above', paint: plateTopBackdrop }],
  variables: { busy: 0, seen: 0 },
  monitors: [],
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'West plate', costumes: [['ocean', platePainter('ocean', 'west')], ['ocean long', platePainter('ocean', 'long')]], x: -117, y: 15, sounds: ['knock'] },
    { name: 'East plate', costumes: [['ocean', platePainter('ocean', 'east')], ['continent', platePainter('continent', 'east')]], x: 117, y: 15 },
    { name: 'Magma', costumes: [['hot', circle(7, '#ffb01f', '#ff5a1f', 2)], ['cooled', circle(7, '#4a4f5c', '#2a2e38', 2)]], x: 0, y: -60, visible: false, variables: { isclone: 0 } },
    { name: 'Volcano', costumes: [['volcano', emoji('🌋', 110)]], x: 60, y: 80, visible: false },
    { name: 'West land', costumes: [['land', landBlock('west')]], x: -120, y: 20, visible: false },
    { name: 'East land', costumes: [['land', landBlock('east')]], x: 120, y: 20, visible: false },
    { name: 'Quake', costumes: [['quake', label('EARTHQUAKE!', '#ff4a4a', '#ffffff', 34)]], x: 0, y: 95, visible: false, sounds: ['hit', 'explosion'] },
    ...PLATE_DEMOS.map(([name, t, c, x]) => ({ name, costumes: [['button', label(t, c, '#1e2a3a', 22)]], x, y: 150, sounds: ['click'] })),
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "busy" to 0
    set "seen" to 0
    switch backdrop to "Side view"
    show caption "Earth's outer shell is cracked into PLATES: about seven big ones and many small ones. They ride on the slowly flowing mantle."
    start sound "tune-wonder"
    wait 3 seconds
    broadcast "try together"
    wait until ((seen) = 1)
    wait 1 seconds
    show caption "Now you try a button! Real plates move only a few centimetres a year, about as fast as your fingernails grow."

when I receive "reset":
    switch backdrop to "Side view"
`,
    Apart: `
when this sprite clicked:
    if ((busy) = 0) then:
        set "busy" to 1
        start sound "click"
        broadcast "reset" and wait
        show caption "DIVERGENT boundary: the plates pull apart. Magma rises into the gap and cools into NEW ocean floor, like at the Mid-Atlantic Ridge."
        broadcast "apart" and wait
        wait 3 seconds
        change "seen" by 1
        set "busy" to 0
`,
    Together: `
when this sprite clicked:
    broadcast "try together"

when I receive "try together":
    if ((busy) = 0) then:
        set "busy" to 1
        start sound "click"
        broadcast "reset" and wait
        show caption "CONVERGENT boundary: the plates push together. The heavy ocean plate dives under the lighter continent. This is called SUBDUCTION."
        broadcast "together" and wait
        show caption "The sinking plate helps rock melt deep down. Magma rises to make VOLCANOES, like the Andes in South America."
        broadcast "quake" and wait
        wait 3 seconds
        change "seen" by 1
        set "busy" to 0
`,
    Past: `
when this sprite clicked:
    if ((busy) = 0) then:
        set "busy" to 1
        start sound "click"
        broadcast "reset" and wait
        switch backdrop to "From above"
        show caption "TRANSFORM boundary, seen from above: the plates grind SIDEWAYS past each other. They stick, then slip with a jolt..."
        broadcast "past" and wait
        broadcast "quake" and wait
        show caption "...an EARTHQUAKE! See how the road, the fence and the stream are broken and shifted. California's San Andreas Fault is like this."
        wait 3 seconds
        change "seen" by 1
        set "busy" to 0
`,
    'West plate': `
when flag clicked:
    broadcast "reset"

when I receive "reset":
    show
    switch costume to "ocean"
    point in direction 90
    go to x: -117 y: 15

when I receive "apart":
    glide 3 secs to x: -150 y: 15

when I receive "together":
    # The same plate, longer, so nothing opens up behind it as it moves.
    switch costume to "ocean long"
    set x to -157
    go to "back" layer
    start sound "knock"
    # Slide under the continent, tipping down into the mantle as it goes.
    repeat 30:
        change x by 2.6
        change y by -0.6
        turn right 0.2 degrees
        wait 0.05 seconds

when I receive "past":
    hide

when I receive "shake":
    repeat 6:
        change x by 3
        wait 0.03 seconds
        change x by -3
        wait 0.03 seconds
`,
    'East plate': `
when I receive "reset":
    show
    switch costume to "ocean"
    go to x: 117 y: 15
    go to "front" layer

when I receive "apart":
    glide 3 secs to x: 150 y: 15

when I receive "together":
    switch costume to "continent"
    go to "front" layer
    glide 1.5 secs to x: 105 y: 15

when I receive "past":
    hide

when I receive "shake":
    repeat 6:
        change x by -3
        wait 0.03 seconds
        change x by 3
        wait 0.03 seconds
`,
    Magma: `
when flag clicked:
    hide
    set "isclone" to 0

when I receive "reset":
    if ((isclone) = 1) then:
        delete this clone

when I receive "apart":
    repeat 40:
        create clone of "myself"
        wait 0.07 seconds

when I start as a clone:
    set "isclone" to 1
    switch costume to "hot"
    go to x: (pick random -12 to 12) y: -70
    go to "back" layer
    show
    # Rise into the gap, then cool into dark new rock (basalt).
    glide 1 secs to x: (pick random -30 to 30) y: (pick random -16 to 26)
    wait 0.8 seconds
    switch costume to "cooled"
`,
    Volcano: `
when I receive "reset":
    hide

when I receive "together":
    wait 1.2 seconds
    go to x: 62 y: 66
    set size to 20 %
    go to "front" layer
    show
    repeat 10:
        change size by 8
`,
    'West land': `
when I receive "reset":
    hide
    go to x: -120 y: 20

when I receive "past":
    show
    glide 2.5 secs to x: -120 y: 50
`,
    'East land': `
when I receive "reset":
    hide
    go to x: 120 y: 20

when I receive "past":
    show
    glide 2.5 secs to x: 120 y: -10
`,
    Quake: `
when flag clicked:
    hide

when I receive "reset":
    hide

when I receive "quake":
    go to "front" layer
    show
    start sound "explosion"
    broadcast "shake"
    repeat 8:
        turn right 4 degrees
        wait 0.04 seconds
        turn left 8 degrees
        wait 0.04 seconds
        turn right 4 degrees
    point in direction 90
    wait 1 seconds
    hide
`,
  },
  picture: [[200]],
  check: [{ frames: 400 }, { expect: { seen: 1 } }, { frames: 40 }, { click: 'Apart' }, { frames: 300 }, { click: 'Together' }, { frames: 330 }, { click: 'Past' }, { frames: 300 }, { expect: { seen: 4, busy: 0 } }],
};

// =================================================================================================
// 6. Layers of the Atmosphere (grades 6-8)
// =================================================================================================

const LAYERS = [
  // name, bottom y, top y, colour, km text, caption
  ['TROPOSPHERE', -110, -55, '#9ad8ff', '0 to about 12 km', 'TROPOSPHERE (0 to about 12 km): we live here, and almost all WEATHER happens here. It gets colder as you go up.'],
  ['STRATOSPHERE', -55, 0, '#5ea8ea', 'to about 50 km', 'STRATOSPHERE (to about 50 km): the OZONE LAYER soaks up harmful ultraviolet light from the Sun, so it gets WARMER as you go up.'],
  ['MESOSPHERE', 0, 50, '#336fc4', 'to about 85 km', 'MESOSPHERE (to about 85 km): the coldest layer, down to about -90 °C. Most METEORS burn up here: those are shooting stars.'],
  ['THERMOSPHERE', 50, 130, '#1d3381', 'to about 600 km', 'THERMOSPHERE (to about 600 km): very thin air that can top 1,000 °C. AURORAS glow here; the Space Station orbits at about 400 km.'],
  ['EXOSPHERE', 130, 180, '#080c26', 'fades into space', 'EXOSPHERE: the last wisps of air fade into space, thousands of kilometres up. You made it! Press Q for a quiz.'],
];

function atmosphereBackdrop(ctx, w, h) {
  // Each layer a band, darker as the air thins.
  LAYERS.forEach(([, b, t, c], i) => {
    const next = i ? LAYERS[i - 1][3] : '#c8ecff';
    const g = ctx.createLinearGradient(0, cy(b), 0, cy(t));
    g.addColorStop(0, next);
    g.addColorStop(0.35, c);
    g.addColorStop(1, c);
    ctx.fillStyle = g;
    ctx.fillRect(0, cy(t), w, (t - b) * 2);
  });
  const rnd = seeded(41);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = rnd() * 0.8; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * 130, 1.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  // Ground.
  ctx.fillStyle = '#4caf50';
  ctx.beginPath(); ctx.moveTo(0, cy(-110)); ctx.bezierCurveTo(300, cy(-100), 600, cy(-118), w, cy(-108)); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  // Ozone: little O3 marks in the stratosphere.
  for (let i = 0; i < 9; i++) text(ctx, 'O₃', 300 + i * 52, cy(-30) + (i % 2) * 22, { px: 15, fill: 'rgba(255,255,255,0.55)', weight: 600 });
  // Aurora curtains in the thermosphere.
  for (let i = 0; i < 3; i++) {
    const g = ctx.createLinearGradient(0, cy(120), 0, cy(70));
    g.addColorStop(0, 'rgba(120,255,170,0)');
    g.addColorStop(0.5, 'rgba(120,255,170,0.45)');
    g.addColorStop(1, 'rgba(120,255,170,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 34;
    ctx.beginPath();
    for (let x = 300; x <= 700; x += 10) ctx.lineTo(x, cy(95) + Math.sin(x / 50 + i) * 18 + i * 10);
    ctx.stroke();
  }
  // Layer names down the left.
  LAYERS.forEach(([name, b, t, , km]) => {
    const mid = cy(t) + 30;
    text(ctx, name, 18, mid - 11, { px: 22, fill: '#ffffff', align: 'left', stroke: 'rgba(10,20,50,0.7)' });
    text(ctx, km, 18, mid + 14, { px: 15, fill: '#e6f0ff', align: 'left', weight: 600, stroke: 'rgba(10,20,50,0.7)' });
  });
  // Boundary lines.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  for (const y of [-55, 0, 50, 130]) { ctx.beginPath(); ctx.moveTo(0, cy(y)); ctx.lineTo(w, cy(y)); ctx.stroke(); }
  ctx.setLineDash([]);
  // Temperature graph on the right: down, up, down, then way up.
  const tx = (T) => 790 + (T + 90) * 1.15;
  ctx.fillStyle = 'rgba(10,20,50,0.35)';
  ctx.beginPath(); ctx.roundRect(762, cy(150), 186, cy(-112) - cy(150), 14); ctx.fill();
  text(ctx, 'TEMPERATURE', 855, cy(160), { px: 16, fill: '#ffd34a' });
  text(ctx, 'colder ← → warmer', 855, cy(140), { px: 13, fill: '#ffffff', weight: 600 });
  ctx.strokeStyle = '#ff5a5a';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tx(15), cy(-108)); ctx.lineTo(tx(-56), cy(-55)); ctx.lineTo(tx(-56), cy(-45)); ctx.lineTo(tx(-2), cy(0)); ctx.lineTo(tx(-90), cy(50)); ctx.lineTo(tx(-60), cy(80));
  ctx.stroke();
  arrow(ctx, tx(-60), cy(80), 944, cy(122), '#ff5a5a', 5, 16);
  text(ctx, 'hot!', 905, cy(100), { px: 15, fill: '#ffb3b3' });
  text(ctx, 'Heights are not to scale', cx(92), cy(168), { px: 14, fill: '#b9c8ff', weight: 600 });
}

function rocketPainter(flame) {
  return paint(70, 150, (ctx) => {
    if (flame) {
      const g = ctx.createLinearGradient(0, 112, 0, 150);
      g.addColorStop(0, '#fff07a'); g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(22, 110); ctx.quadraticCurveTo(35, 160, 48, 110); ctx.fill();
    }
    ctx.lineWidth = 4; ctx.strokeStyle = '#1e2a3a';
    blob(ctx, [[14, 112], [4, 128], [24, 116]], '#e53935', '#1e2a3a', 3);
    blob(ctx, [[56, 112], [66, 128], [46, 116]], '#e53935', '#1e2a3a', 3);
    ctx.fillStyle = '#f2f4f8';
    ctx.beginPath(); ctx.moveTo(35, 6); ctx.quadraticCurveTo(62, 40, 54, 116); ctx.lineTo(16, 116); ctx.quadraticCurveTo(8, 40, 35, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e53935';
    ctx.beginPath(); ctx.moveTo(35, 6); ctx.quadraticCurveTo(48, 20, 51, 32); ctx.lineTo(19, 32); ctx.quadraticCurveTo(22, 20, 35, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath(); ctx.arc(35, 60, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
}

const atmosphere = {
  id: 'atmosphere-layers', title: 'Layers of the Atmosphere', kind: 'Quiz', grades: [6, 8], subject: 'Earth & Space',
  blurb: 'Fly a rocket up through the five layers of the air, from the clouds to the edge of space. Then take the quiz.',
  learn: 'The five layers of the atmosphere in order (troposphere, stratosphere, mesosphere, thermosphere, exosphere), roughly how high each reaches, what happens in each (weather, the ozone layer, meteors, auroras), and how the temperature goes down, up, down and up again.',
  backdrops: [{ name: 'Atmosphere', paint: atmosphereBackdrop }],
  variables: { km: 0, layer: 1, highest: 0, score: 0 },
  monitors: [['km', 'normal', 200, 8]],
  sounds: ['chime', 'win'],
  sprites: [
    { name: 'Cloud', costumes: [['cloud', emoji('☁️', 110)]], x: -40, y: -86 },
    { name: 'Plane', costumes: [['plane', emoji('✈️', 60)]], x: -40, y: -64, rotationStyle: 'left-right' },
    { name: 'Meteor', costumes: [['meteor', emoji('☄️', 60)]], x: 120, y: 40 },
    { name: 'Satellite', costumes: [['iss', emoji('🛰️', 60)]], x: 90, y: 100 },
    { name: 'Rocket', costumes: [['off', rocketPainter(false)], ['on', rocketPainter(true)]], x: 10, y: -92, size: 70, rotationStyle: "don't rotate", sounds: ['whoosh'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "km" to 0
    set "layer" to 1
    set "highest" to 0
    set "score" to 0
    show caption "Hold SPACE (or the up arrow) to fly the rocket up through the atmosphere. Let go to drift back down."

when "q" key pressed:
    set "score" to 0
    ask "In which layer does almost all of our weather happen?" and wait
    if ((answer) contains "tropo" ?) then:
        change "score" by 1
        show caption "Yes, the troposphere: the layer we live in."
    else:
        show caption "It's the troposphere, the lowest layer."
    ask "Which layer holds the ozone layer?" and wait
    if ((answer) contains "strato" ?) then:
        change "score" by 1
        show caption "Right! The stratosphere."
    else:
        show caption "The stratosphere."
    ask "In which layer do most meteors burn up?" and wait
    if ((answer) contains "meso" ?) then:
        change "score" by 1
        show caption "Correct, the mesosphere."
    else:
        show caption "The mesosphere."
    ask "Which layer has the auroras and the Space Station?" and wait
    if ((answer) contains "thermo" ?) then:
        change "score" by 1
        show caption "Yes, the thermosphere."
    else:
        show caption "The thermosphere."
    if ((score) = 4) then:
        start sound "win"
    show caption (join (join "You scored " (score)) " out of 4!")
`,
    Rocket: `
when flag clicked:
    go to x: 10 y: -92
    switch costume to "off"
    forever:
        if (((key "space" pressed?) or (key "up arrow" pressed?)) and ((y position) < 160)) then:
            switch costume to "on"
            change y by 2.5
        else:
            switch costume to "off"
            if ((y position) > -92) then:
                change y by -1
        # Turn the height on the stage into kilometres. Each layer is squeezed to fit, so it is not to scale.
        if ((y position) < -55) then:
            set "layer" to 1
            set "km" to (round ((((y position) + 92) * 12) / 37))
        else:
            if ((y position) < 0) then:
                set "layer" to 2
                set "km" to (round (12 + ((((y position) + 55) * 38) / 55)))
            else:
                if ((y position) < 50) then:
                    set "layer" to 3
                    set "km" to (round (50 + (((y position) * 35) / 50)))
                else:
                    if ((y position) < 130) then:
                        set "layer" to 4
                        set "km" to (round (85 + ((((y position) - 50) * 515) / 80)))
                    else:
                        set "layer" to 5
                        set "km" to (round (600 + (((y position) - 130) * 200)))
        # A new, higher layer? (Not while still sitting on the launch pad.)
        if (((layer) > (highest)) and ((y position) > -80)) then:
            set "highest" to (layer)
            start sound "whoosh"
            broadcast "new layer"

when I receive "new layer":
${LAYERS.map(([, , , , , cap], i) => `    if ((layer) = ${i + 1}) then:\n        show caption "${cap}"`).join('\n')}
`,
    Plane: `
when flag clicked:
    set x to -40
    point in direction 90
    forever:
        change x by 1.5
        if ((x position) > 230) then:
            set x to -60
`,
    Meteor: `
when flag clicked:
    hide
    forever:
        go to x: (pick random 60 to 200) y: 50
        set "ghost" effect to 0
        show
        # A shooting star burns up as it falls through the mesosphere.
        repeat 20:
            change x by -4
            change y by -2
            change "ghost" effect by 5
        hide
        wait (pick random 1 to 3) seconds
`,
    Satellite: `
when flag clicked:
    forever:
        change x by 0.6
        if ((x position) > 230) then:
            set x to 40
`,
  },
  picture: [[80, ['space']]],
  check: [{ frames: 40 }, { frames: 150, keys: ['space'] }, { expect: { highest: 5 } }, { frames: 20 },
    { press: 'q' }, { frames: 10 }, { answer: 'troposphere' }, { frames: 10 }, { answer: 'the stratosphere' }, { frames: 10 },
    { answer: 'Mesosphere' }, { frames: 10 }, { answer: 'thermosphere' }, { frames: 10 }, { expect: { score: 4 } }],
};

// =================================================================================================
// 7. Kepler's Orbits (grades 9-12)
// =================================================================================================

const SUN = [50, 25];

function keplerBackdrop(ctx, w, h) {
  spaceSky(ctx, w, h, '#03051a', '#0d1240', 220, 51);
  text(ctx, "KEPLER'S LAWS", cx(234), cy(166), { px: 22, fill: '#ffd34a', align: 'right' });
  text(ctx, 'dots: equal times apart', cx(234), cy(151), { px: 14, fill: '#b9c8ff', align: 'right', weight: 600 });
  text(ctx, '↑ ↓ launch speed', cx(234), cy(139), { px: 14, fill: '#b9c8ff', align: 'right', weight: 600 });
  text(ctx, 'SPACE clears', cx(234), cy(127), { px: 14, fill: '#b9c8ff', align: 'right', weight: 600 });
}

const kepler = {
  id: 'kepler-orbits', title: "Kepler's Orbits", kind: 'Simulation', grades: [9, 12], subject: 'Earth & Space',
  blurb: 'Launch a planet around the Sun with real gravity. Change its speed and watch the ellipse, the speed and the orbit time.',
  learn: "Newton's inverse-square gravity, stepped one frame at a time, produces Kepler's three laws: orbits are ellipses with the Sun at a focus, a planet moves fastest when closest to the Sun (equal areas in equal times), and bigger orbits take longer (T² is proportional to a³).",
  backdrops: [{ name: 'Space', paint: keplerBackdrop }],
  variables: { launch: 80, speed: 0, 'orbit time': 0 },
  monitors: [['launch', 'normal', 8, 8], ['speed', 'normal', 8, 36], ['orbit time', 'normal', 8, 64]],
  sounds: [],
  sprites: [
    { name: 'Sun', costumes: [['sun', paint(110, 110, (ctx, w, h) => { glowBall(ctx, w / 2, h / 2, 54, '#fffbe0', 'rgba(255,190,40,0.95)', 'rgba(255,140,0,0)'); ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 22, 0, Math.PI * 2); ctx.fill(); })]], x: SUN[0], y: SUN[1] },
    { name: 'Planet', costumes: [['planet', paint(26, 26, (ctx) => { earthDisc(ctx, 13, 13, 10); })]], x: -90, y: SUN[1],
      variables: { px: 0, py: 0, vx: 0, vy: 0, dx: 0, dy: 0, r: 0, pull: 0, prevdy: 0, frames: 0 }, sounds: ['chime'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    show caption "A planet launched sideways falls toward the Sun but keeps missing it: an ORBIT. The up and down arrows change the launch speed."
    wait 9 seconds
    show caption "KEPLER'S 1st LAW: an orbit is an ELLIPSE (a stretched circle) with the Sun at one FOCUS, not the middle. Try a slower launch."
    wait 9 seconds
    show caption "2nd LAW: it speeds up near the Sun and slows down far away. Dots are dropped at equal times, so they spread out where it is fast."
    wait 9 seconds
    show caption "3rd LAW: bigger orbits take longer (time squared goes with size cubed). Simplified: one planet, and the Sun stays still."
`,
    Planet: `
when flag clicked:
    set "launch" to 80
    set "orbit time" to 0
    erase all
    set pen color to "#5ad1ff"
    broadcast "launch"

when "up arrow" key pressed:
    if ((launch) < 100) then:
        change "launch" by 10
    change pen "color" by 25
    broadcast "launch"

when "down arrow" key pressed:
    if ((launch) > 70) then:
        change "launch" by -10
    change pen "color" by 25
    broadcast "launch"

when "space" key pressed:
    erase all

when I receive "launch":
    pen up
    set "orbit time" to 0
    # Start 140 steps to the left of the Sun, moving straight down.
    # At 100% launch speed gravity bends the path into a perfect circle.
    set "px" to ${SUN[0] - 140}
    set "py" to ${SUN[1]}
    set "vx" to 0
    set "vy" to (0 - (((launch) / 100) * ("sqrt" of (20000 / 140))))
    set "frames" to 0
    set "prevdy" to 0
    go to x: (px) y: (py)
    set pen size to 2
    pen down
    forever:
        set "dx" to ((px) - ${SUN[0]})
        set "dy" to ((py) - ${SUN[1]})
        set "r" to ("sqrt" of (((dx) * (dx)) + ((dy) * (dy))))
        # Gravity: twice as far away, a quarter of the pull (1 over r squared).
        set "pull" to (20000 / ((r) * (r)))
        # Speed changes first, then position: one small step of time (0.35).
        change "vx" by ((0 - (((pull) * (dx)) / (r))) * 0.35)
        change "vy" by ((0 - (((pull) * (dy)) / (r))) * 0.35)
        change "px" by ((vx) * 0.35)
        change "py" by ((vy) * 0.35)
        go to x: (px) y: (py)
        set "speed" to (round ("sqrt" of (((vx) * (vx)) + ((vy) * (vy)))))
        change "frames" by 1
        # Every 8 frames, a fat dot.
        if (((frames) mod 8) = 0) then:
            pen up
            set pen size to 7
            pen down
            set pen size to 2
        # Crossing back past the start, left of the Sun: one orbit done.
        if ((((prevdy) > 0) and ((dy) < 0)) and ((dx) < 0)) then:
            set "orbit time" to ((round ((frames) / 3)) / 10)
            set "frames" to 0
            start sound "chime"
        set "prevdy" to (dy)
`,
  },
  picture: [[400]],
  check: [{ frames: 230 }, { expect: { launch: 80 } }, { press: 'down arrow' }, { frames: 2 }, { press: 'down arrow' }, { frames: 2 }, { press: 'down arrow' }, { frames: 150 },
    { expect: { launch: 70 } }, { press: 'up arrow' }, { frames: 200 }],
};

// =================================================================================================
// 8. The Life of a Star (grades 9-12)
// =================================================================================================

function nebulaBackdrop(ctx, w, h) {
  spaceSky(ctx, w, h, '#04031a', '#120a2e', 230, 61);
  for (const [x, y, r, c] of [[200, 200, 260, 'rgba(180,70,200,0.22)'], [760, 520, 300, 'rgba(40,160,200,0.2)'], [700, 150, 200, 'rgba(255,90,140,0.14)'], [150, 600, 220, 'rgba(90,80,230,0.18)']]) {
    glowBall(ctx, x, y, r, c, c);
  }
}

function starPainter(kind) {
  const P = {
    nebula: 270, protostar: 210, sun: 170, 'red giant': 300, 'planetary nebula': 280, 'white dwarf': 110,
    'blue giant': 210, 'red supergiant': 330, supernova: 340, 'neutron star': 220, 'black hole': 280,
  };
  const s = P[kind];
  return paint(s, s, (ctx, w, h) => {
    const x = w / 2;
    const y = h / 2;
    const rnd = seeded(s);
    if (kind === 'nebula') {
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 80;
        const c = ['rgba(255,120,200,0.35)', 'rgba(140,110,255,0.35)', 'rgba(90,200,255,0.3)', 'rgba(255,180,120,0.3)'][i % 4];
        glowBall(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, 40 + rnd() * 40, c, c);
      }
      for (let i = 0; i < 6; i++) glowBall(ctx, x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 90, 8, '#ffffff', 'rgba(255,255,255,0.4)');
      return;
    }
    if (kind === 'protostar') {
      glowBall(ctx, x, y, 100, 'rgba(255,200,120,0.9)', 'rgba(255,100,40,0.5)');
      ctx.strokeStyle = 'rgba(200,130,90,0.85)'; ctx.lineWidth = 16;
      ctx.beginPath(); ctx.ellipse(x, y, 100, 22, -0.2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffb066'; ctx.beginPath(); ctx.arc(x, y, 34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(150,90,60,0.9)'; ctx.lineWidth = 12;
      ctx.beginPath(); ctx.ellipse(x, y, 100, 22, -0.2, 0.15, Math.PI - 0.15); ctx.stroke();
      return;
    }
    if (kind === 'planetary nebula') {
      glowBall(ctx, x, y, 135, 'rgba(60,220,220,0.05)', 'rgba(60,200,230,0.35)', 'rgba(0,0,0,0)');
      ctx.lineWidth = 34; ctx.strokeStyle = 'rgba(80,230,210,0.7)';
      ctx.beginPath(); ctx.ellipse(x, y, 92, 78, 0.3, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(255,110,160,0.8)';
      ctx.beginPath(); ctx.ellipse(x, y, 112, 96, 0.3, 0, Math.PI * 2); ctx.stroke();
      glowBall(ctx, x, y, 22, '#ffffff', 'rgba(200,230,255,0.8)');
      return;
    }
    if (kind === 'supernova') {
      glowBall(ctx, x, y, 170, 'rgba(255,255,255,1)', 'rgba(255,200,80,0.8)', 'rgba(255,60,40,0)');
      ctx.strokeStyle = 'rgba(255,240,180,0.9)';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2 + rnd() * 0.1;
        const l = 110 + rnd() * 55;
        ctx.lineWidth = 3 + rnd() * 5;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
      return;
    }
    if (kind === 'neutron star') {
      // A pulsar: a tiny spinning star with two beams.
      const g = ctx.createLinearGradient(x, 0, x, h);
      g.addColorStop(0, 'rgba(150,220,255,0)'); g.addColorStop(0.5, 'rgba(180,230,255,0.7)'); g.addColorStop(1, 'rgba(150,220,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x - 30, 0); ctx.lineTo(x + 30, 0); ctx.lineTo(x + 6, y); ctx.lineTo(x + 30, h); ctx.lineTo(x - 30, h); ctx.closePath(); ctx.fill();
      glowBall(ctx, x, y, 40, '#ffffff', 'rgba(140,200,255,0.8)');
      return;
    }
    if (kind === 'black hole') {
      glowBall(ctx, x, y, 140, 'rgba(255,170,60,0.0)', 'rgba(255,140,40,0.35)', 'rgba(0,0,0,0)');
      ctx.lineWidth = 26; ctx.strokeStyle = '#ff9a2f';
      ctx.beginPath(); ctx.ellipse(x, y, 125, 34, -0.15, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 10; ctx.strokeStyle = '#ffe08a';
      ctx.beginPath(); ctx.ellipse(x, y, 112, 28, -0.15, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffcf6a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y, 54, 0, Math.PI * 2); ctx.stroke();
      // The front of the disc passes in front of the hole.
      ctx.lineWidth = 22; ctx.strokeStyle = '#ffa53a';
      ctx.beginPath(); ctx.ellipse(x, y, 125, 34, -0.15, 0.2, Math.PI - 0.2); ctx.stroke();
      return;
    }
    // A glowing ball: the main kinds of star.
    const [r, core, mid] = {
      sun: [56, '#fffbe0', '#ffc928'], 'red giant': [118, '#ffd9a0', '#ff6a2a'], 'white dwarf': [16, '#ffffff', '#cfe6ff'],
      'blue giant': [72, '#ffffff', '#7fb8ff'], 'red supergiant': [150, '#ffc08a', '#e2421f'],
    }[kind];
    glowBall(ctx, x, y, w / 2, core, hexA(mid, 0.5), 'rgba(0,0,0,0)');
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, core);
    g.addColorStop(1, mid);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (kind === 'red giant' || kind === 'red supergiant' || kind === 'sun') {
      ctx.fillStyle = 'rgba(255,255,220,0.10)';
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * r * 1.2, y + (rnd() - 0.5) * r * 1.2, r * (0.08 + rnd() * 0.12), 0, Math.PI * 2); ctx.fill(); }
    }
  });
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const STAR_STAGES = [
  ['nebula', 'NEBULA', 'Every star begins in a NEBULA, a huge cloud of gas (mostly hydrogen) and dust. Gravity slowly pulls part of it together.'],
  ['protostar', 'PROTOSTAR', 'The clump shrinks, spins and heats up into a PROTOSTAR, wrapped in a disc of gas and dust. Planets can form in a disc like this.'],
  ['sun', 'MAIN SEQUENCE STAR', 'At about 10 million °C in its core, hydrogen FUSES into helium and the star shines. Our Sun has shone for about 4.6 billion years.'],
  ['red giant', 'RED GIANT', 'When its core runs out of hydrogen it swells into a RED GIANT. In about 5 billion years our Sun will, swallowing Mercury and Venus.'],
  ['planetary nebula', 'PLANETARY NEBULA', 'It gently puffs its outer layers into space: a glowing PLANETARY NEBULA. The name is old: it has nothing to do with planets!'],
  ['white dwarf', 'WHITE DWARF', 'Left behind is the hot core, a WHITE DWARF about the size of Earth. It slowly cools for billions of years. Now try the heavier star!'],
  ['blue giant', 'BLUE GIANT', 'A star over about 8 times as massive as the Sun burns hot and BLUE. It uses its fuel so fast it lives only millions of years.'],
  ['red supergiant', 'RED SUPERGIANT', 'It swells into a RED SUPERGIANT, hundreds of times wider than the Sun. Betelgeuse, the red star in Orion, is one.'],
  ['supernova', 'SUPERNOVA', 'Its core collapses in under a second and it explodes: a SUPERNOVA, briefly as bright as a whole galaxy!'],
  ['neutron star', 'NEUTRON STAR', 'Left behind may be a NEUTRON STAR, only about 20 km across. A teaspoonful would weigh billions of tonnes!'],
  ['black hole', 'BLACK HOLE', 'The heaviest stars leave a BLACK HOLE instead: gravity so strong that not even light can get out. Click Next to choose another star.'],
];
const SUN_PATH = [0, 1, 2, 3, 4, 5];
const BIG_PATH = [0, 1, 6, 7, 8, 9, 10];

const starLife = {
  id: 'star-life-cycle', title: 'The Life of a Star', kind: 'Story', grades: [8, 12], subject: 'Earth & Space',
  blurb: 'Follow a star from a cloud of dust to its end. A star like our Sun fades gently; a giant star explodes.',
  learn: "The life cycle of stars: nebula, protostar and main sequence for every star; then red giant, planetary nebula and white dwarf for a Sun-like star, or red supergiant, supernova and a neutron star or black hole for a star more than about 8 times the Sun's mass. Why mass decides how a star lives and dies.",
  backdrops: [{ name: 'Deep space', paint: nebulaBackdrop }],
  variables: { path: '', step: 0, lives: 0 },
  monitors: [],
  sounds: ['tune-wonder'],
  sprites: [
    { name: 'Star', costumes: STAR_STAGES.map(([k]) => [k, starPainter(k)]), x: 0, y: 45, visible: false, sounds: ['magic', 'explosion', 'chime', 'power-down'] },
    { name: 'Debris', costumes: [['bit', circle(5, '#ffe08a', '#ff7a2a', 2)]], x: 0, y: 35, visible: false },
    { name: 'Stage name', costumes: STAR_STAGES.map(([k, t]) => [k, label(t, '#ffd34a', '#1e2a3a', 26)]), x: 0, y: -58, visible: false },
    { name: 'Like the Sun', costumes: [['button', label('☀️  A star like our Sun', '#ffe08a', '#1e2a3a', 24)]], x: 0, y: 40, sounds: ['click'] },
    { name: 'Heavy star', costumes: [['button', label('💥  A star 20 times heavier', '#9ad0ff', '#1e2a3a', 24)]], x: 0, y: -20, sounds: ['click'] },
    { name: 'Next', costumes: [['button', label('Next  ▶', '#7ee08a', '#1e2a3a', 24)]], x: 190, y: -58, visible: false, sounds: ['click'] },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "path" to ""
    set "step" to 0
    set "lives" to 0
    broadcast "choose"
    play sound "tune-wonder" until done

when I receive "choose":
    show caption "Stars are born, shine for millions or billions of years, and die. How a star ends depends on its MASS. Pick a star!"

when I receive "next":
    change "step" by 1
    # Each path is a list of stages, one per click.
    if ((path) = "sun") then:
${SUN_PATH.map((s, i) => `        if ((step) = ${i + 1}) then:\n            broadcast "${STAR_STAGES[s][0]}"`).join('\n')}
        if ((step) = ${SUN_PATH.length + 1}) then:
            change "lives" by 1
            broadcast "choose"
    else:
${BIG_PATH.map((s, i) => `        if ((step) = ${i + 1}) then:\n            broadcast "${STAR_STAGES[s][0]}"`).join('\n')}
        if ((step) = ${BIG_PATH.length + 1}) then:
            change "lives" by 1
            broadcast "choose"
`,
    'Like the Sun': `
when I receive "choose":
    show

when this sprite clicked:
    start sound "click"
    set "path" to "sun"
    set "step" to 0
    broadcast "begin"
    broadcast "next"

when I receive "begin":
    hide
`,
    'Heavy star': `
when I receive "choose":
    show

when this sprite clicked:
    start sound "click"
    set "path" to "big"
    set "step" to 0
    broadcast "begin"
    broadcast "next"

when I receive "begin":
    hide
`,
    Next: `
when I receive "choose":
    hide

when I receive "begin":
    show

when this sprite clicked:
    start sound "click"
    broadcast "next"
`,
    'Stage name': `
when I receive "choose":
    hide

when I receive "begin":
    show
${STAR_STAGES.map(([k]) => `
when I receive "${k}":
    switch costume to "${k}"`).join('\n')}
`,
    Star: `
when I receive "choose":
    if ((path) = "") then:
        # The first time: a row of every stage, as a preview.
        erase all
        clear graphic effects
        switch costume to "nebula"
        set size to 16 %
        go to x: -210 y: 148
        show
        repeat 11:
            stamp
            next costume
            change x by 42
    # Behind the buttons: a star like our Sun, glowing.
    switch costume to "sun"
    go to x: 0 y: 20
    set size to 130 %
    set "ghost" effect to 10
    go to "back" layer
    show

when I receive "begin":
    # A fresh row of little pictures along the top: the star's whole life so far.
    erase all
    clear graphic effects
    show
${STAR_STAGES.map(([k, , cap]) => `
when I receive "${k}":
    switch costume to "${k}"
    show caption "${cap}"
    broadcast "stamp" and wait
    ${k === 'supernova' ? `start sound "explosion"
    broadcast "boom"
    set "brightness" effect to 80
    set size to 40 %
    repeat 12:
        change size by 6
        change "brightness" effect by -6
    wait 3 seconds
    show caption "Elements made inside stars, like the iron in your blood and the calcium in your bones, are blasted out into space."` : k === 'white dwarf' || k === 'neutron star' || k === 'black hole' ? `start sound "power-down"
    set size to 220 %
    repeat 12:
        change size by -10` : `start sound "magic"
    set size to 60 %
    repeat 10:
        change size by 4`}`).join('\n')}

when I receive "stamp":
    go to x: (-205 + ((step) * 68)) y: 148
    set size to 18 %
    clear graphic effects
    stamp
    go to x: 0 y: 45
    set size to 100 %
`,
    Debris: `
when I receive "boom":
    repeat 30:
        create clone of "myself"

when I start as a clone:
    go to x: 0 y: 45
    point in direction (pick random 0 to 359)
    show
    repeat 25:
        move 8 steps
        change "ghost" effect by 4
    delete this clone
`,
  },
  picture: [[40]],
  check: [{ frames: 30 }, { click: 'Like the Sun' }, { frames: 30 }, ...Array.from({ length: SUN_PATH.length }, () => [{ click: 'Next' }, { frames: 30 }]).flat(),
    { expect: { lives: 1 } }, { click: 'Heavy star' }, { frames: 30 }, ...Array.from({ length: BIG_PATH.length }, () => [{ click: 'Next' }, { frames: 30 }]).flat(), { expect: { lives: 2 } }],
};

// =================================================================================================
// 9. The Greenhouse Effect (grades 9-12)
// =================================================================================================

function greenhouseBackdrop(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, cy(-65));
  g.addColorStop(0, '#050820');
  g.addColorStop(0.18, '#0d1745');
  g.addColorStop(0.35, '#2b5fb0');
  g.addColorStop(1, '#a9dcff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, cy(-65));
  const rnd = seeded(71);
  for (let i = 0; i < 50; i++) { ctx.fillStyle = '#ffffff'; ctx.globalAlpha = rnd() * 0.8; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * 110, 1.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  // Ground.
  const gr = ctx.createLinearGradient(0, cy(-65), 0, h);
  gr.addColorStop(0, '#5c9a3c');
  gr.addColorStop(0.2, '#8a6a3f');
  gr.addColorStop(1, '#5a4129');
  ctx.fillStyle = gr;
  ctx.fillRect(0, cy(-65), w, h - cy(-65));
  ctx.fillStyle = '#4a8a32';
  for (let x = 20; x < w; x += 90) { ctx.beginPath(); ctx.arc(x, cy(-65), 24, Math.PI, 0); ctx.fill(); }
  // Where things are.
  text(ctx, 'SPACE', cx(-30), cy(160), { px: 18, fill: '#b9c8ff' });
  text(ctx, 'ATMOSPHERE', cx(-150), cy(110), { px: 18, fill: 'rgba(255,255,255,0.75)' });
  text(ctx, 'GROUND', cx(-150), cy(-80), { px: 18, fill: '#ffffff', stroke: '#3a2a1a' });
  // The thermometer tube (the red column is drawn with the pen).
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeStyle = '#1e2a3a';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(cx(215) - 13, cy(118), 26, cy(-46) - cy(118), 13); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#e53935';
  ctx.beginPath(); ctx.arc(cx(215), cy(-50), 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  text(ctx, 'warmer', cx(190), cy(110), { px: 14, fill: '#ffffff', align: 'right', weight: 600 });
  text(ctx, 'colder', cx(190), cy(-36), { px: 14, fill: '#1e2a3a', align: 'right', weight: 600 });
}

function co2() {
  // Carbon dioxide: one carbon (dark) between two oxygens (red), drawn big enough to catch light.
  return paint(104, 46, (ctx) => {
    ctx.strokeStyle = '#1e2a3a'; ctx.lineWidth = 4;
    for (const [x, c, r] of [[20, '#e53935', 16], [84, '#e53935', 16], [52, '#3a3f48', 18]]) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, 23, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(x - r * 0.35, 23 - r * 0.35, r * 0.3, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function infrared() {
  return paint(44, 22, (ctx) => {
    ctx.strokeStyle = '#ff3a2a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 2; x <= 32; x += 2) ctx.lineTo(x, 11 + Math.sin(x / 3) * 6);
    ctx.stroke();
    ctx.fillStyle = '#ff3a2a';
    ctx.beginPath(); ctx.moveTo(42, 11); ctx.lineTo(32, 4); ctx.lineTo(32, 18); ctx.closePath(); ctx.fill();
  });
}

const greenhouse = {
  id: 'greenhouse-effect', title: 'The Greenhouse Effect', kind: 'Simulation', grades: [9, 12], subject: 'Earth & Space',
  blurb: 'Sunlight warms the ground; the ground glows infrared; greenhouse gases send some of it back. Add or remove gas and watch the warmth.',
  learn: 'How the greenhouse effect works: visible sunlight passes through the air, the warm ground gives off infrared, and gases like carbon dioxide absorb it and send some back down, so the surface settles at a warmer balance. Why some greenhouse effect is essential, and how adding carbon dioxide has warmed Earth.',
  backdrops: [{ name: 'Sky and ground', paint: greenhouseBackdrop }],
  variables: { gas: 4, warmth: 25, told: 0 },
  monitors: [['gas', 'normal', 150, 8], ['warmth', 'normal', 250, 8]],
  sounds: ['tune-chill'],
  sprites: [
    { name: 'Sun', costumes: [['sun', emoji('☀️', 110)]], x: -200, y: 145 },
    { name: 'Gas', costumes: [['co2', co2()]], x: 0, y: 40, visible: false, rotationStyle: "don't rotate", variables: { isclone: 0 } },
    { name: 'Sunlight', costumes: [['light', paint(30, 30, (ctx) => glowBall(ctx, 15, 15, 15, '#ffffff', '#ffe14a', 'rgba(255,200,0,0)'))]], x: 0, y: 175, visible: false },
    { name: 'Infrared', costumes: [['ir', infrared()]], x: 0, y: -60, visible: false, variables: { cool: 0 } },
    { name: 'Thermometer', costumes: [['dot', circle(2, 'rgba(0,0,0,0)', null)]], x: 215, y: -46 },
  ],
  scripts: {
    Stage: `
when flag clicked:
    set "gas" to 4
    set "warmth" to 25
    set "told" to 0
    broadcast "regas"
    show caption "Sunlight (yellow) is mostly visible light. It passes straight through the air and warms the ground."
    wait 7 seconds
    show caption "The warm ground gives off INFRARED (red). Greenhouse gases like carbon dioxide absorb it and send it off in any direction."
    wait 9 seconds
    show caption "Press UP to add greenhouse gas, DOWN to remove it. Watch the thermometer settle. (Simplified: real molecules are far too small to see.)"

when "up arrow" key pressed:
    if ((gas) < 12) then:
        change "gas" by 1
        broadcast "regas"
    if ((gas) > 9) then:
        show caption "Since the 1800s, burning fossil fuels has raised carbon dioxide from about 280 to over 420 parts per million. Earth has warmed over 1 °C."

when "down arrow" key pressed:
    if ((gas) > 0) then:
        change "gas" by -1
        broadcast "regas"
    if ((gas) = 0) then:
        show caption "With NO greenhouse gases, Earth would average about -18 °C instead of about 15 °C. Some greenhouse effect keeps us alive!"
`,
    Gas: `
when flag clicked:
    hide
    set "isclone" to 0

when I receive "regas":
    # Start again with exactly (gas) molecules.
    if ((isclone) = 1) then:
        delete this clone
    else:
        repeat (gas):
            create clone of "myself"

when I start as a clone:
    set "isclone" to 1
    go to x: (pick random -200 to 180) y: (pick random -30 to 100)
    point in direction (pick random 0 to 359)
    show
    forever:
        move 0.7 steps
        turn right (pick random -8 to 8) degrees
        if ((y position) > 105) then:
            point in direction 180
        if ((y position) < -35) then:
            point in direction 0
        if on edge, bounce
`,
    Sunlight: `
when flag clicked:
    hide
    forever:
        create clone of "myself"
        wait 0.2 seconds

when I start as a clone:
    go to x: (pick random -230 to 130) y: 175
    point in direction 160
    show
    # Visible light goes straight through the gas.
    repeat until ((y position) < -62):
        move 7 steps
    change "warmth" by 1
    delete this clone
`,
    Infrared: `
when flag clicked:
    hide
    forever:
        # The warmer the ground, the more infrared it gives off.
        if ((pick random 1 to 75) < (warmth)) then:
            change "warmth" by -1
            create clone of "myself"
        wait 0.03 seconds

when I start as a clone:
    go to x: (pick random -220 to 200) y: -60
    point in direction (pick random -45 to 45)
    set "cool" to 0
    show
    repeat until ((y position) > 172):
        move 5 steps
        change "cool" by -1
        if (((cool) < 0) and (touching "Gas" ?)) then:
            # Absorbed by a gas molecule, then given off again in a random direction.
            point in direction (pick random 0 to 359)
            set "cool" to 6
        if ((x position) > 236) then:
            set x to -236
        if ((x position) < -236) then:
            set x to 236
        if ((y position) < -64) then:
            # Back down: it warms the ground again.
            change "warmth" by 1
            delete this clone
    delete this clone
`,
    Thermometer: `
when flag clicked:
    forever:
        erase all
        set pen color to "#e53935"
        set pen size to 14
        go to x: 215 y: -46
        pen down
        go to x: 215 y: (-46 + ((warmth) * 3))
        if ((y position) > 112) then:
            set y to 112
        pen up
        wait 0.2 seconds
`,
  },
  picture: [[450]],
  check: [{ frames: 300 }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' }, { press: 'down arrow' }, { frames: 300 }, { expect: { gas: 0 } },
    ...Array.from({ length: 10 }, () => ({ press: 'up arrow' })), { frames: 450 }, { expect: { gas: 10 } }],
};

export default [moonPhases, planetParade, rockCycle, seasons, plates, atmosphere, kepler, starLife, greenhouse];
