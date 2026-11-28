// THE OFFICIAL PROJECTS (decision G). Every one is built here, in code, from the block table and the
// library, so the gallery needs no server, every script in it is a real Stages script a student can
// open and change, and `tools/check-templates.mjs` can run each one and check it does what its card
// says.
//
// They are original games and stories in common genres. None is a copy of an existing game.
//
// Ids are PERSISTED in links (/stages/?project=<id>), so they are only ever added.
import {
  B, C, C2, R, V, backdrop, monitor, newProject, painted, rounded, script, sound, sprite,
} from './kit.js';
import { stageOf } from '../project/Project.js';
import { cloneBlock } from '../blocks/make.js';

const flag = () => B('event_whenflagclicked');
const key = (k) => R('sensing_keypressed', { KEY_OPTION: k });
const touching = (what) => R('sensing_touchingobject', { TOUCHINGOBJECTMENU: what });
const join = (...parts) => parts.reduceRight((acc, p) => R('operator_join', { STRING1: p, STRING2: acc }));
const rand = (a, b) => R('operator_random', { FROM: a, TO: b });
const lt = (a, b) => R('operator_lt', { OPERAND1: a, OPERAND2: b });
const gt = (a, b) => R('operator_gt', { OPERAND1: a, OPERAND2: b });
const eq = (a, b) => R('operator_equals', { OPERAND1: a, OPERAND2: b });
const say = (m, s) => (s ? B('looks_sayforsecs', { MESSAGE: m, SECS: s }) : B('looks_say', { MESSAGE: m }));
const wait = (s) => B('control_wait', { DURATION: s });
const forever = (...body) => C('control_forever', {}, body);
const repeat = (n, ...body) => C('control_repeat', { TIMES: n }, body);
const iff = (cond, ...body) => C('control_if', { CONDITION: cond }, body);
const goTo = (x, y) => B('motion_gotoxy', { X: x, Y: y });
const receive = (m) => B('event_whenbroadcastreceived', { BROADCAST: m });
const broadcast = (m, andWait = false) => B(andWait ? 'event_broadcastandwait' : 'event_broadcast', { BROADCAST: m });
const setVar = (n, v) => B('data_setvariableto', { VARIABLE: n, VALUE: v });
const changeVar = (n, v) => B('data_changevariableby', { VARIABLE: n, VALUE: v });
const costume = (c) => B('looks_switchcostumeto', { COSTUME: c });
const caption = (t) => B('looks_showcaption', { TEXT: t });

// --- 1. Catch the Coins ------------------------------------------------------------------------

async function buildCatch({ scripts = true } = {}) {
  const p = newProject('Catch the Coins');
  const stage = stageOf(p);
  await backdrop(p, 'scene-hills', 'Hills');
  stage.variables = { score: 0 };
  monitor(p, 'score', null, 8, 8, 'large');
  const hero = await sprite(p, 'hero-green', { name: 'Catcher', x: 0, y: -125, size: 65, rotationStyle: 'left-right', costumes: ['walk a', 'walk b'] });
  const coin = await sprite(p, 'item-coin', { name: 'Coin', x: 0, y: 160, size: 55, visible: false, costumes: ['coin gold'] });
  await sound(p, coin, 'coin');
  await sound(p, hero, 'win');
  if (!scripts) return p;
  stage.scripts = [
    script(20, 20, [flag(), setVar('score', 0), B('sensing_resettimer'),
      B('control_wait_until', { CONDITION: gt(R('sensing_timer'), 30) }), broadcast('game over')]),
  ];
  hero.scripts = [
    script(20, 20, [flag(), goTo(0, -125), B('motion_pointindirection', { DIRECTION: 90 }), say('Catch the coins! Use the arrow keys.', 2),
      forever(
        iff(key('right arrow'), B('motion_pointindirection', { DIRECTION: 90 }), B('motion_changexby', { DX: 9 })),
        iff(key('left arrow'), B('motion_pointindirection', { DIRECTION: -90 }), B('motion_changexby', { DX: -9 })),
      )]),
    script(20, 330, [flag(), forever(iff(R('operator_or', { OPERAND1: key('left arrow'), OPERAND2: key('right arrow') }), B('looks_nextcostume'), wait(0.1)))]),
    script(380, 20, [receive('game over'), B('control_stop', { STOP_OPTION: 'other scripts in sprite' }),
      B('sound_play', { SOUND: 'You Win' }), say(join("Time's up! I caught ", V('score'), ' coins.'))]),
  ];
  coin.scripts = [
    script(20, 20, [flag(), B('looks_hide'), forever(B('control_create_clone_of', { CLONE_OPTION: '_myself_' }), wait(rand(0.4, 1.1)))]),
    script(20, 220, [B('control_start_as_clone'), goTo(rand(-220, 220), 170), B('looks_show'),
      C('control_repeat_until', { CONDITION: lt(R('motion_yposition'), -165) }, [
        B('motion_changeyby', { DY: -5 }),
        iff(touching('Catcher'), changeVar('score', 1), B('sound_play', { SOUND: 'Coin' }), B('control_delete_this_clone')),
      ]),
      B('control_delete_this_clone')]),
    script(380, 20, [receive('game over'), B('control_stop', { STOP_OPTION: 'other scripts in sprite' }), B('control_delete_this_clone')]),
  ];
  return p;
}

// --- 2. Mouse Maze -------------------------------------------------------------------------------

// A maze grown by a seeded depth-first walk, so every build gives the same maze and every cell can
// be reached from every other: there is always a way through.
function mazeWalls(cols, rows, seed = 11) {
  let s = seed;
  const random = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const right = [...Array(rows)].map(() => Array(cols).fill(true));
  const down = [...Array(rows)].map(() => Array(cols).fill(true));
  const seen = [...Array(rows)].map(() => Array(cols).fill(false));
  const stack = [[0, rows - 1]];
  seen[rows - 1][0] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]].filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && !seen[y][x]);
    if (!next.length) { stack.pop(); continue; }
    const [nc, nr] = next[Math.floor(random() * next.length)];
    if (nc > c) right[r][c] = false;
    if (nc < c) right[r][nc] = false;
    if (nr > r) down[r][c] = false;
    if (nr < r) down[nr][c] = false;
    seen[nr][nc] = true;
    stack.push([nc, nr]);
  }
  return { right, down };
}

async function buildMaze({ scripts = true } = {}) {
  const p = newProject('Mouse Maze');
  await backdrop(p, 'colour-cream', 'Floor');
  const COLS = 6;
  const ROWS = 4;
  const CELL = 80; // stage steps
  const { right, down } = mazeWalls(COLS, ROWS);
  const walls = await painted(p, 'Walls', [['maze', 960, 720, (ctx) => {
    const k = 2; // pixels per step
    const x0 = 0;
    const y0 = 20 * k;
    ctx.strokeStyle = '#2f8a46';
    ctx.lineWidth = 10 * k;
    ctx.lineCap = 'round';
    const line = (ax, ay, bx, by) => { ctx.beginPath(); ctx.moveTo(x0 + ax * k, y0 + ay * k); ctx.lineTo(x0 + bx * k, y0 + by * k); ctx.stroke(); };
    line(5, 0, 475, 0); line(5, ROWS * CELL, 475, ROWS * CELL); line(5, 0, 5, ROWS * CELL); line(475, 0, 475, ROWS * CELL);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (right[r][c] && c < COLS - 1) line((c + 1) * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL);
        if (down[r][c] && r < ROWS - 1) line(c * CELL, (r + 1) * CELL, (c + 1) * CELL, (r + 1) * CELL);
      }
    }
  }, { resolution: 2 }]], { x: 0, y: 0 });
  const mouse = await sprite(p, 'creature-mouse', { name: 'Mouse', x: -200, y: -120, size: 45, rotationStyle: 'left-right', costumes: ['walk a', 'walk b'] });
  const star = await sprite(p, 'item-star', { name: 'Star', x: 200, y: 120, size: 50 });
  await sound(p, mouse, 'win');
  await sound(p, mouse, 'hit', 'Bump');
  if (!scripts) return p;
  const stepIn = (k, dx, dy, dir) => iff(key(k),
    ...(dir != null ? [B('motion_pointindirection', { DIRECTION: dir })] : []),
    dx ? B('motion_changexby', { DX: dx }) : B('motion_changeyby', { DY: dy }),
    iff(touching('Walls'), dx ? B('motion_changexby', { DX: -dx }) : B('motion_changeyby', { DY: -dy })),
  );
  mouse.scripts = [
    script(20, 20, [flag(), goTo(-200, -120), B('motion_pointindirection', { DIRECTION: 90 }), B('sensing_resettimer'),
      say('Help me find the star!', 1.5),
      forever(stepIn('right arrow', 4, 0, 90), stepIn('left arrow', -4, 0, -90), stepIn('up arrow', 0, 4), stepIn('down arrow', 0, -4))]),
    script(20, 420, [flag(), B('control_wait_until', { CONDITION: touching('Star') }),
      // Not "stop all": that clears every speech bubble, this one included, exactly as Scratch's does.
      B('control_stop', { STOP_OPTION: 'other scripts in sprite' }),
      B('sound_play', { SOUND: 'You Win' }), say(join('I did it in ', R('operator_round', { NUM: R('sensing_timer') }), ' seconds!'))]),
    script(420, 20, [flag(), forever(iff(R('operator_or', { OPERAND1: key('left arrow'), OPERAND2: R('operator_or', { OPERAND1: key('right arrow'), OPERAND2: R('operator_or', { OPERAND1: key('up arrow'), OPERAND2: key('down arrow') }) }) }), B('looks_nextcostume'), wait(0.12)))]),
  ];
  star.scripts = [script(20, 20, [flag(), forever(B('motion_turnright', { DEGREES: 3 }))])];
  walls.scripts = [];
  return p;
}

// --- 3. Paddle Ball ----------------------------------------------------------------------------

async function buildPaddle() {
  const p = newProject('Paddle Ball');
  const stage = stageOf(p);
  await backdrop(p, 'space-blue', 'Space');
  stage.variables = { score: 0, lives: 3 };
  monitor(p, 'score', null, 8, 8);
  monitor(p, 'lives', null, 8, 36);
  const paddle = await painted(p, 'Paddle', [['paddle', 220, 36, (ctx, w, h) => rounded(ctx, 3, 3, w - 6, h - 6, 15, '#4c97ff', '#ffffff', 4), { resolution: 2 }]], { x: 0, y: -150, rotationStyle: "don't rotate" });
  const ball = await painted(p, 'Ball', [['ball', 48, 48, (ctx) => {
    const g = ctx.createRadialGradient(18, 16, 4, 24, 24, 22);
    g.addColorStop(0, '#fff6b0');
    g.addColorStop(1, '#ffbf00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(24, 24, 21, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#cc9900'; ctx.stroke();
  }, { resolution: 2 }]], { x: 0, y: 60, rotationStyle: "don't rotate" });
  await sound(p, ball, 'boing');
  await sound(p, ball, 'hit');
  await sound(p, ball, 'game-over');
  paddle.scripts = [script(20, 20, [flag(), goTo(0, -150), forever(B('motion_setx', { X: R('sensing_mousex') }),
    iff(key('left arrow'), B('motion_changexby', { DX: -10 })), iff(key('right arrow'), B('motion_changexby', { DX: 10 })))])];
  const serve = [goTo(0, 60), B('motion_pointindirection', { DIRECTION: rand(150, 210) }), wait(1)];
  ball.scripts = [
    script(20, 20, [flag(), setVar('score', 0), setVar('lives', 3), ...serve,
      forever(
        B('motion_movesteps', { STEPS: 8 }),
        C2('control_if_else', { CONDITION: lt(R('motion_yposition'), -160) }, [
          changeVar('lives', -1),
          B('sound_play', { SOUND: 'Hit' }),
          C2('control_if_else', { CONDITION: lt(V('lives'), 1) }, [
            B('sound_play', { SOUND: 'Game Over' }), say(join('Game over! You scored ', V('score'))), B('control_stop', { STOP_OPTION: 'this script' }),
          ], serve.map(cloneBlock)),
        ], [B('motion_ifonedgebounce')]),
        // Only a ball coming DOWN bounces off the paddle, or it would bounce again on the way out.
        iff(touching('Paddle'),
          C('control_if', { CONDITION: R('operator_or', { OPERAND1: gt(R('motion_direction'), 90), OPERAND2: lt(R('motion_direction'), -90) }) }, [
            B('motion_pointindirection', { DIRECTION: R('operator_add', { NUM1: R('operator_subtract', { NUM1: 180, NUM2: R('motion_direction') }), NUM2: rand(-15, 15) }) }),
            changeVar('score', 1),
            B('sound_play', { SOUND: 'Boing' }),
          ])),
      )]),
  ];
  return p;
}

// --- 4. Jump Up ------------------------------------------------------------------------------------

const PLATFORMS = [[-240, 240, -150], [-200, -70, -70], [-40, 100, 10], [130, 240, 90]];

async function buildJump({ scripts = true } = {}) {
  const p = newProject('Jump Up');
  await backdrop(p, 'scene-trees', 'Forest');
  const plats = await painted(p, 'Platforms', [['platforms', 960, 720, (ctx) => {
    const k = 2;
    for (const [x0, x1, top] of PLATFORMS) {
      const px = (x0 + 240) * k;
      const pw = (x1 - x0) * k;
      const py = (180 - top) * k;
      const ph = top === -150 ? 30 * k : 18 * k;
      ctx.fillStyle = '#8b5a2b';
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.fill();
      ctx.fillStyle = '#5fbf3f';
      ctx.beginPath(); ctx.roundRect(px, py, pw, 8 * k, 8); ctx.fill();
    }
  }, { resolution: 2 }]], { x: 0, y: 0 });
  const hero = await sprite(p, 'hero-pink', { name: 'Hero', x: -200, y: -100, size: 55, rotationStyle: 'left-right', costumes: ['walk a', 'walk b'], variables: { vy: 0 } });
  const goal = await sprite(p, 'item-flag', { name: 'Flag', x: 205, y: 111, size: 60, costumes: ['flag red a', 'flag red b'] });
  await sound(p, hero, 'jump');
  await sound(p, hero, 'win');
  if (!scripts) return p;
  hero.scripts = [
    script(20, 20, [flag(), goTo(-200, -100), setVar('vy', 0), B('motion_pointindirection', { DIRECTION: 90 }),
      say('Get to the flag! Arrows to move, up to jump.', 2),
      forever(
        iff(key('right arrow'), B('motion_pointindirection', { DIRECTION: 90 }), B('motion_changexby', { DX: 5 })),
        iff(key('left arrow'), B('motion_pointindirection', { DIRECTION: -90 }), B('motion_changexby', { DX: -5 })),
        changeVar('vy', -1),
        B('motion_changeyby', { DY: V('vy') }),
        iff(R('operator_and', { OPERAND1: touching('Platforms'), OPERAND2: lt(V('vy'), 1) }),
          B('motion_changeyby', { DY: R('operator_subtract', { NUM1: 0, NUM2: V('vy') }) }),
          setVar('vy', 0),
          iff(key('up arrow'), setVar('vy', 15), B('sound_play', { SOUND: 'Jump' }))),
      )]),
    script(20, 520, [flag(), forever(iff(R('operator_or', { OPERAND1: key('left arrow'), OPERAND2: key('right arrow') }), B('looks_nextcostume'), wait(0.12)))]),
    script(460, 20, [flag(), B('control_wait_until', { CONDITION: touching('Flag') }), B('sound_play', { SOUND: 'You Win' }),
      B('control_stop', { STOP_OPTION: 'other scripts in sprite' }), say('I made it!')]),
  ];
  goal.scripts = [script(20, 20, [flag(), forever(B('looks_nextcostume'), wait(0.3))])];
  plats.scripts = [];
  return p;
}

// --- 5. Space Dodge ---------------------------------------------------------------------------------

async function buildSpace() {
  const p = newProject('Space Dodge');
  const stage = stageOf(p);
  await backdrop(p, 'space-darkPurple', 'Space');
  stage.variables = { lives: 3, seconds: 0, speed: 4 };
  monitor(p, 'lives', null, 8, 8);
  monitor(p, 'seconds', null, 8, 36);
  const ship = await sprite(p, 'ship-1', { name: 'Ship', x: 0, y: -140, size: 55, rotationStyle: "don't rotate", costumes: ['red'] });
  const rock = await sprite(p, 'meteor', { name: 'Meteor', x: 0, y: 170, size: 45, visible: false, costumes: ['big 1', 'big 2', 'big 3', 'big 4', 'grey 1', 'grey 2'] });
  await sound(p, rock, 'explosion');
  await sound(p, ship, 'game-over');
  stage.scripts = [
    script(20, 20, [flag(), setVar('lives', 3), setVar('speed', 4), B('sensing_resettimer'),
      C('control_repeat_until', { CONDITION: lt(V('lives'), 1) }, [setVar('seconds', R('operator_round', { NUM: R('sensing_timer') })), changeVar('speed', 0.01)]),
      broadcast('game over')]),
  ];
  ship.scripts = [
    script(20, 20, [flag(), goTo(0, -140), B('looks_cleargraphiceffects'), say('Dodge the meteors!', 1.5),
      forever(iff(key('left arrow'), B('motion_changexby', { DX: -8 })), iff(key('right arrow'), B('motion_changexby', { DX: 8 })))]),
    script(20, 330, [receive('hit'), repeat(4, B('looks_seteffectto', { EFFECT: 'ghost', VALUE: 70 }), wait(0.08), B('looks_seteffectto', { EFFECT: 'ghost', VALUE: 0 }), wait(0.08))]),
    script(400, 20, [receive('game over'), B('control_stop', { STOP_OPTION: 'other scripts in sprite' }), B('sound_play', { SOUND: 'Game Over' }), say(join('Game over! I lasted ', V('seconds'), ' seconds.'))]),
  ];
  rock.scripts = [
    script(20, 20, [flag(), B('looks_hide'), wait(1), forever(B('control_create_clone_of', { CLONE_OPTION: '_myself_' }), wait(rand(0.4, 1)))]),
    script(20, 200, [B('control_start_as_clone'), B('looks_switchcostumeto', { COSTUME: rand(1, 6) }), goTo(rand(-220, 220), 175), B('looks_show'),
      C('control_repeat_until', { CONDITION: lt(R('motion_yposition'), -170) }, [
        B('motion_changeyby', { DY: R('operator_subtract', { NUM1: 0, NUM2: V('speed') }) }),
        B('motion_turnright', { DEGREES: 4 }),
        iff(touching('Ship'), changeVar('lives', -1), B('sound_play', { SOUND: 'Explosion' }), broadcast('hit'), B('control_delete_this_clone')),
      ]),
      B('control_delete_this_clone')]),
    script(400, 20, [receive('game over'), B('control_stop', { STOP_OPTION: 'other scripts in sprite' }), B('control_delete_this_clone')]),
  ];
  return p;
}

// --- 6. Times Tables Quiz ------------------------------------------------------------------------------

async function buildQuiz() {
  const p = newProject('Times Tables Quiz');
  const stage = stageOf(p);
  await backdrop(p, 'world-library', 'Library');
  stage.variables = { score: 0 };
  monitor(p, 'score', null, 8, 8, 'large');
  const host = await sprite(p, 'toon-maya', { name: 'Maya', x: -130, y: -45, size: 110, costumes: ['talk', 'idle', 'cheer0', 'cheer1', 'think'], variables: { a: 2, b: 2 } });
  await sound(p, host, 'chime', 'Correct');
  await sound(p, host, 'power-down', 'Wrong');
  await sound(p, host, 'tada');
  host.scripts = [
    script(20, 20, [flag(), setVar('score', 0), costume('talk'), say('Welcome to the Times Tables Quiz!', 2), say('Type your answer and press Enter.', 2),
      repeat(5,
        setVar('a', rand(2, 12)),
        setVar('b', rand(2, 12)),
        costume('think'),
        B('sensing_askandwait', { QUESTION: join('What is ', V('a'), ' × ', V('b'), '?') }),
        C2('control_if_else', { CONDITION: eq(R('sensing_answer'), R('operator_multiply', { NUM1: V('a'), NUM2: V('b') })) }, [
          changeVar('score', 1), costume('cheer0'), B('sound_play', { SOUND: 'Correct' }), say('Correct!', 1.2),
        ], [
          costume('idle'), B('sound_play', { SOUND: 'Wrong' }), say(join('Not quite. It is ', R('operator_multiply', { NUM1: V('a'), NUM2: V('b') }), '.'), 2),
        ])),
      costume('cheer1'), B('sound_play', { SOUND: 'Ta-da!' }), say(join('You got ', V('score'), ' out of 5!'))]),
  ];
  return p;
}

// --- 7. A Trip to the Moon -------------------------------------------------------------------------------

async function buildMoonTrip({ scripts = true } = {}) {
  const p = newProject('A Trip to the Moon');
  const stage = stageOf(p);
  await backdrop(p, 'world-park', 'Park');
  await backdrop(p, 'world-moon', 'Moon');
  const riley = await sprite(p, 'toon-riley', { name: 'Riley', x: -120, y: -80, size: 90, rotationStyle: 'left-right', costumes: ['idle', 'talk', 'cheer0', 'cheer1', 'think'] });
  const robo = await sprite(p, 'toon-robo', { name: 'Robo', x: 120, y: -80, size: 90, direction: -90, rotationStyle: 'left-right', costumes: ['idle', 'talk', 'cheer0', 'cheer1'] });
  const ship = await sprite(p, 'ship-2', { name: 'Spaceship', x: 0, y: -60, size: 90, visible: false, rotationStyle: "don't rotate", costumes: ['blue'] });
  await sound(p, ship, 'whoosh', 'Whoosh');
  await sound(p, stage, 'tune-wonder', 'Wonder');
  if (!scripts) return p;
  stage.scripts = [
    script(20, 20, [flag(), B('looks_switchbackdropto', { BACKDROP: 'Park' }), B('sound_play', { SOUND: 'Wonder' }),
      caption('One sunny day in the park, Riley met a robot called Robo.'), wait(3), B('looks_hidecaption'),
      broadcast('chat', true),
      caption("So they climbed into Robo's spaceship..."), broadcast('launch', true),
      B('looks_switchbackdropto', { BACKDROP: 'Moon' }), caption('...and landed on the Moon!'),
      broadcast('moon', true), caption('The End'), wait(3), B('looks_hidecaption')]),
  ];
  riley.scripts = [
    script(20, 20, [flag(), goTo(-120, -80), B('motion_pointindirection', { DIRECTION: 90 }), costume('idle'), B('looks_show')]),
    script(20, 200, [receive('chat'), costume('talk'), say('Hello! Who are you?', 2), costume('idle'), wait(2.2), costume('talk'),
      say('Can you take me somewhere amazing?', 2.5), costume('cheer0'), wait(2.2)]),
    script(420, 20, [receive('launch'), B('looks_hide')]),
    script(420, 140, [receive('moon'), wait(1.6), goTo(-80, -80), costume('cheer1'), B('looks_show'), say('Wow! We are on the Moon!', 2.5),
      costume('think'), B('looks_thinkforsecs', { MESSAGE: 'Everything is grey and quiet up here.', SECS: 3 })]),
  ];
  robo.scripts = [
    script(20, 20, [flag(), goTo(120, -80), B('motion_pointindirection', { DIRECTION: -90 }), costume('idle'), B('looks_show')]),
    script(20, 200, [receive('chat'), wait(2), costume('talk'), say('I am Robo. Beep boop!', 2), costume('idle'), wait(2.5),
      costume('talk'), say('Hold on tight!', 2), costume('idle')]),
    script(420, 20, [receive('launch'), B('looks_hide')]),
    script(420, 140, [receive('moon'), wait(1.6), goTo(80, -80), costume('cheer0'), B('looks_show'), wait(2.6),
      costume('talk'), say('Look up there: that blue ball is home.', 3)]),
  ];
  ship.scripts = [
    script(20, 20, [flag(), B('looks_hide'), goTo(0, -60)]),
    script(20, 140, [receive('launch'), goTo(0, -60), B('looks_show'), wait(0.6), B('sound_play', { SOUND: 'Whoosh' }),
      B('motion_glidesecstoxy', { SECS: 1.2, X: 0, Y: 200 }), B('looks_hide')]),
    script(420, 20, [receive('moon'), goTo(0, 200), B('looks_show'), B('motion_glidesecstoxy', { SECS: 1.4, X: 0, Y: 40 }), wait(5)]),
  ];
  return p;
}

// --- 8. A Walk Through Town --------------------------------------------------------------------------------

async function buildWalk() {
  const p = newProject('A Walk Through Town');
  const stage = stageOf(p);
  await backdrop(p, 'scene-town', 'Town');
  const sam = await sprite(p, 'toon-sam', { name: 'Sam', x: -215, y: -95, size: 85, costumes: ['walk0', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'walk7', 'idle', 'cheer0'], variables: { frame: 0 } });
  const bee = await sprite(p, 'creature-bee', { name: 'Bee', x: -230, y: 80, size: 45, rotationStyle: 'left-right', costumes: ['a', 'b'] });
  await sound(p, stage, 'birds');
  stage.scripts = [script(20, 20, [flag(), B('sound_play', { SOUND: 'Birds' }), caption('A walk through town'), wait(2.5), B('looks_hidecaption')])];
  sam.scripts = [
    script(20, 20, [flag(), goTo(-215, -95), setVar('frame', 0),
      repeat(52,
        changeVar('frame', 1),
        costume(join('walk', R('operator_mod', { NUM1: V('frame'), NUM2: 8 }))),
        B('motion_changexby', { DX: 8 }),
        wait(0.07)),
      costume('cheer0'), say('What a lovely day!', 3), costume('idle')]),
  ];
  bee.scripts = [
    script(20, 20, [flag(), goTo(-230, 80), B('motion_pointindirection', { DIRECTION: 90 }),
      forever(B('looks_nextcostume'), B('motion_changexby', { DX: 3 }),
        B('motion_sety', { Y: R('operator_add', { NUM1: 80, NUM2: R('operator_multiply', { NUM1: 25, NUM2: R('operator_mathop', { OPERATOR: 'sin', NUM: R('operator_multiply', { NUM1: R('motion_xposition'), NUM2: 3 }) }) }) }) }),
        iff(gt(R('motion_xposition'), 225), B('motion_setx', { X: -225 })))]),
  ];
  return p;
}

// --- 9. The Beating Heart: an Edusim model as a sprite ---------------------------------------------

async function buildHeart() {
  const p = newProject('The Beating Heart');
  const stage = stageOf(p);
  await backdrop(p, 'night', 'Night');
  const { spriteFromModel, modelCatalog } = await import('../library/libraryAdd.js');
  const { MODEL_BY_ID } = await modelCatalog();
  const model = MODEL_BY_ID.get('human-heart');
  const heart = await spriteFromModel(p, model);
  Object.assign(heart, { name: 'Heart', x: 0, y: 25, size: 165 });
  p.targets.push(heart);
  await sound(p, heart, 'kick', 'Beat');
  const facts = model.facts || [];
  stage.scripts = [script(20, 20, [flag(), forever(...facts.flatMap((f) => [caption(f), wait(4.5)]))])];
  heart.scripts = [
    script(20, 20, [flag(), B('looks_setsizeto', { SIZE: 165 }), forever(
      B('sound_play', { SOUND: 'Beat' }), B('looks_changesizeby', { CHANGE: 8 }), wait(0.12), B('looks_changesizeby', { CHANGE: -8 }), wait(0.12),
      B('looks_changesizeby', { CHANGE: 5 }), wait(0.1), B('looks_changesizeby', { CHANGE: -5 }), wait(0.5),
    )]),
    script(20, 330, [flag(), forever(B('looks_nextcostume'), wait(0.25))]),
  ];
  return p;
}

// --- 10. Robot Dance Party: the first tutorial's finished project ------------------------------------

async function buildDance({ scripts = true } = {}) {
  const p = newProject('Robot Dance Party');
  const stage = stageOf(p);
  await backdrop(p, 'world-robots', 'Robot Challenge');
  const robo = await sprite(p, 'toon-robo', { name: 'Robo', x: 0, y: -60, size: 110, costumes: ['cheer0', 'cheer1', 'idle', 'kick'] });
  await sound(p, stage, 'drum-beat', 'Drum Beat');
  if (!scripts) return p;
  stage.scripts = [script(20, 20, [flag(), forever(B('sound_playuntildone', { SOUND: 'Drum Beat' }))])];
  robo.scripts = [
    script(20, 20, [flag(), forever(B('looks_nextcostume'), wait(0.25))]),
    script(20, 200, [flag(), forever(B('looks_changeeffectby', { EFFECT: 'color', CHANGE: 5 }), wait(0.05))]),
    script(380, 20, [B('event_whenkeypressed', { KEY: 'space' }), repeat(10, B('motion_turnright', { DEGREES: 36 })), say('Ta-da!', 1)]),
  ];
  return p;
}

// --- 11. Star Patterns: the pen ----------------------------------------------------------------------

async function buildPatterns({ scripts = true } = {}) {
  const p = newProject('Star Patterns');
  await backdrop(p, 'colour-dark', 'Dark');
  const pen = await sprite(p, 'item-star', { name: 'Pen', x: 0, y: 0, size: 30 });
  if (!scripts) return p;
  pen.scripts = [
    script(20, 20, [flag(), B('pen_clear'), B('pen_penUp'), goTo(0, 0), B('motion_pointindirection', { DIRECTION: 90 }),
      B('pen_setPenSizeTo', { SIZE: 2 }), B('pen_setPenColorToColor', { COLOR: '#4c97ff' }), B('pen_penDown'),
      repeat(36,
        repeat(5, B('motion_movesteps', { STEPS: 130 }), B('motion_turnright', { DEGREES: 144 })),
        B('motion_turnright', { DEGREES: 10 }),
        B('pen_changePenColorParamBy', { COLOR_PARAM: 'color', VALUE: 3 })),
      B('pen_penUp'), B('looks_hide')]),
  ];
  return p;
}

// The gallery, in the order the Projects panel shows it.
export const GALLERY = [
  { id: 'catch', kind: 'Game', title: 'Catch the Coins', blurb: 'Arrow keys to catch falling coins for 30 seconds. Clones, a score and a timer.', build: () => buildCatch() },
  { id: 'jump', kind: 'Game', title: 'Jump Up', blurb: 'A platform game: run, jump and reach the flag. Gravity is one variable.', build: () => buildJump() },
  { id: 'space', kind: 'Game', title: 'Space Dodge', blurb: 'Dodge the meteors as they fall faster and faster. Three lives.', build: () => buildSpace() },
  { id: 'maze', kind: 'Game', title: 'Mouse Maze', blurb: 'Guide the mouse to the star without walking through the walls.', build: () => buildMaze() },
  { id: 'paddle', kind: 'Game', title: 'Paddle Ball', blurb: 'Keep the ball in play with the paddle. Mouse or arrow keys.', build: () => buildPaddle() },
  { id: 'quiz', kind: 'Quiz', title: 'Times Tables Quiz', blurb: 'Maya asks five questions and keeps score. Ask, answer, if and else.', build: () => buildQuiz() },
  { id: 'moon-trip', kind: 'Story', title: 'A Trip to the Moon', blurb: 'Riley and Robo fly from the Park to the Moon, two of Edusim\'s own worlds.', build: () => buildMoonTrip() },
  { id: 'walk', kind: 'Animation', title: 'A Walk Through Town', blurb: 'A walk cycle from eight costumes, and a bee that flies a sine wave.', build: () => buildWalk() },
  { id: 'heart', kind: 'Animation', title: 'The Beating Heart', blurb: 'The Model Database\'s heart as a sprite: it turns, it beats, and the facts come with it.', build: () => buildHeart() },
  { id: 'dance', kind: 'Animation', title: 'Robot Dance Party', blurb: 'Costumes, a colour effect and a drum beat. The first tutorial, finished.', build: () => buildDance() },
  { id: 'patterns', kind: 'Art', title: 'Star Patterns', blurb: 'A star drawn 36 times with the pen, turning a little and changing colour each time.', build: () => buildPatterns() },
];

// Starting points for the tutorials: the same projects with their scripts left for the student.
export const STARTERS = {
  catch: () => buildCatch({ scripts: false }),
  maze: () => buildMaze({ scripts: false }),
  jump: () => buildJump({ scripts: false }),
  story: () => buildMoonTrip({ scripts: false }),
  dance: () => buildDance({ scripts: false }),
  patterns: () => buildPatterns({ scripts: false }),
};
