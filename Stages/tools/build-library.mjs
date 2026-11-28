// Builds Edusim Stages' cartoon library from Kenney's CC0 packs (https://kenney.nl).
//
//   node Stages/tools/build-library.mjs <folder holding the unzipped packs>
//
// The folder must hold one sub-folder per pack, each with the pack's own files unzipped into
// `x/` (that is how they were fetched for the first build):
//
//   toon-characters-1/x  animal-pack-redux/x  new-platformer-pack/x
//   space-shooter-redux/x  background-elements-redux/x
//
// It copies a hand-picked set of PNGs into Stages/public/library/kenney/, copies each pack's own
// License.txt beside them (so the licence travels with the pictures, decision D), and writes
// Stages/src/library/cartoons.js, the list the sprite library reads.
//
// Every id in that list is PERSISTED in projects (a sprite remembers which library entry it came
// from), so ids are only ever added, never renamed. Re-running the tool with the same packs gives
// the same output.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGES = resolve(HERE, '..');
const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error('Usage: node Stages/tools/build-library.mjs <folder of unzipped Kenney packs>');
  process.exit(1);
}
const OUT = join(STAGES, 'public/library/kenney');
mkdirSync(OUT, { recursive: true });

const PACKS = {
  toon: { dir: 'toon-characters-1/x', name: 'Toon Characters 1' },
  animals: { dir: 'animal-pack-redux/x', name: 'Animal Pack Redux' },
  platformer: { dir: 'new-platformer-pack/x', name: 'New Platformer Pack' },
  space: { dir: 'space-shooter-redux/x', name: 'Space Shooter Redux' },
  scenery: { dir: 'background-elements-redux/x', name: 'Background Elements Redux' },
};

// Licences first: a pack whose licence file is missing is not used at all.
const licences = [];
for (const [key, pack] of Object.entries(PACKS)) {
  const root = join(SRC, pack.dir);
  const file = readdirSync(root).find((f) => /^licen[cs]e\.txt$/i.test(f));
  if (!file) throw new Error(`No licence file in ${pack.dir}; refusing to use it.`);
  mkdirSync(join(OUT, key), { recursive: true });
  copyFileSync(join(root, file), join(OUT, key, 'License.txt'));
  licences.push({ key, name: pack.name });
}

const copied = new Set();
function take(pack, rel) {
  const from = join(SRC, PACKS[pack].dir, rel);
  if (!existsSync(from)) throw new Error(`Missing ${pack}: ${rel}`);
  const name = basename(rel).replace(/\s+/g, '_');
  const to = join(OUT, pack, name);
  if (!copied.has(to)) { copyFileSync(from, to); copied.add(to); }
  return `library/kenney/${pack}/${name}`;
}

const sprites = [];
const backdropTiles = {};
function sprite(id, name, tags, costumes, { size = 100 } = {}) {
  sprites.push({ id, name, tags, size, costumes });
}

// --- people and robots (side-on, many poses: a walk cycle is a costume cycle) ---
const TOON_POSES = ['idle', 'walk0', 'walk1', 'walk2', 'walk3', 'walk4', 'walk5', 'walk6', 'walk7', 'run0', 'run1', 'run2',
  'jump', 'fall', 'duck', 'cheer0', 'cheer1', 'talk', 'think', 'hurt', 'kick', 'climb0', 'climb1', 'back', 'side'];
const TOON = [
  ['riley', 'Riley', 'Female adventurer', 'femaleAdventurer'],
  ['maya', 'Maya', 'Female person', 'femalePerson'],
  ['leo', 'Leo', 'Male adventurer', 'maleAdventurer'],
  ['sam', 'Sam', 'Male person', 'malePerson'],
  ['robo', 'Robo', 'Robot', 'robot'],
  ['zed', 'Zed the Zombie', 'Zombie', 'zombie'],
];
for (const [id, name, folder, stem] of TOON) {
  sprite(`toon-${id}`, name, ['people', 'characters', id === 'robo' ? 'robots' : 'people', 'walk'],
    TOON_POSES.map((p) => ({ name: p, file: take('toon', `${folder}/PNG/Poses/character_${stem}_${p}.png`) })), { size: 80 });
}

// --- platform-game heroes ---
for (const colour of ['green', 'pink', 'purple', 'yellow', 'beige']) {
  const poses = ['idle', 'walk_a', 'walk_b', 'jump', 'duck', 'hit', 'climb_a', 'climb_b', 'front'];
  sprite(`hero-${colour}`, `Hero (${colour})`, ['characters', 'games', 'walk'],
    poses.map((p) => ({ name: p.replace('_', ' '), file: take('platformer', `Sprites/Characters/Default/character_${colour}_${p}.png`) })), { size: 70 });
}

// --- creatures and enemies ---
const CREATURES = [
  ['bee', 'Bee', ['bee_a', 'bee_b', 'bee_rest']],
  ['fly', 'Fly', ['fly_a', 'fly_b', 'fly_rest']],
  ['frog', 'Frog', ['frog_idle', 'frog_jump', 'frog_rest']],
  ['ladybug', 'Ladybug', ['ladybug_walk_a', 'ladybug_walk_b', 'ladybug_fly', 'ladybug_rest']],
  ['mouse', 'Mouse', ['mouse_walk_a', 'mouse_walk_b', 'mouse_rest']],
  ['slime', 'Slime', ['slime_normal_walk_a', 'slime_normal_walk_b', 'slime_normal_flat', 'slime_normal_rest']],
  ['slime-spike', 'Spiky Slime', ['slime_spike_walk_a', 'slime_spike_walk_b', 'slime_spike_flat', 'slime_spike_rest']],
  ['slime-fire', 'Fire Slime', ['slime_fire_walk_a', 'slime_fire_walk_b', 'slime_fire_flat', 'slime_fire_rest']],
  ['slime-block', 'Block Slime', ['slime_block_walk_a', 'slime_block_walk_b', 'slime_block_jump', 'slime_block_rest']],
  ['snail', 'Snail', ['snail_walk_a', 'snail_walk_b', 'snail_shell', 'snail_rest']],
  ['worm', 'Worm', ['worm_normal_move_a', 'worm_normal_move_b', 'worm_normal_rest']],
  ['fish-blue', 'Blue Fish', ['fish_blue_swim_a', 'fish_blue_swim_b', 'fish_blue_rest']],
  ['fish-yellow', 'Yellow Fish', ['fish_yellow_swim_a', 'fish_yellow_swim_b', 'fish_yellow_rest']],
  ['fish-purple', 'Purple Fish', ['fish_purple_up', 'fish_purple_down', 'fish_purple_rest']],
  ['saw', 'Saw Blade', ['saw_a', 'saw_b', 'saw_rest']],
  ['barnacle', 'Barnacle', ['barnacle_attack_a', 'barnacle_attack_b', 'barnacle_attack_rest']],
];
for (const [id, name, frames] of CREATURES) {
  sprite(`creature-${id}`, name, ['animals', 'creatures', 'games'],
    frames.map((f) => ({ name: f.replace(/^(slime_[a-z]+|fish_[a-z]+|worm_normal|[a-z]+)_/, '').replace(/_/g, ' '), file: take('platformer', `Sprites/Enemies/Default/${f}.png`) })), { size: 80 });
}

// --- round animals (one costume each, the classic "pick an animal" set) ---
const ANIMALS = readdirSync(join(SRC, PACKS.animals.dir, 'PNG/Round (outline)')).filter((f) => f.endsWith('.png')).sort();
for (const f of ANIMALS) {
  const stem = f.replace('.png', '');
  sprite(`animal-${stem}`, stem[0].toUpperCase() + stem.slice(1), ['animals'], [
    { name: stem, file: take('animals', `PNG/Round (outline)/${f}`) },
    { name: `${stem} square`, file: take('animals', `PNG/Square (outline)/${f}`) },
  ], { size: 60 });
}

// --- things to collect, push and dodge ---
const ITEMS = [
  ['coin', 'Gold Coin', ['coin_gold', 'coin_gold_side'], 60],
  ['coin-silver', 'Silver Coin', ['coin_silver', 'coin_silver_side'], 60],
  ['gem', 'Gem', ['gem_blue', 'gem_green', 'gem_red', 'gem_yellow'], 60],
  ['heart', 'Heart', ['heart', 'hud_heart', 'hud_heart_half', 'hud_heart_empty'], 60],
  ['star', 'Star', ['star'], 60],
  ['key', 'Key', ['key_yellow', 'key_blue', 'key_green', 'key_red'], 60],
  ['lock', 'Lock', ['lock_yellow', 'lock_blue', 'lock_green', 'lock_red'], 60],
  ['flag', 'Flag', ['flag_red_a', 'flag_red_b', 'flag_green_a', 'flag_green_b', 'flag_off'], 80],
  ['door', 'Door', ['door_closed', 'door_open'], 100],
  ['spring', 'Spring', ['spring', 'spring_out'], 70],
  ['spikes', 'Spikes', ['spikes'], 70],
  ['bomb', 'Bomb', ['bomb', 'bomb_active'], 70],
  ['fireball', 'Fireball', ['fireball'], 60],
  ['mushroom', 'Mushroom', ['mushroom_red', 'mushroom_brown'], 70],
  ['sign', 'Sign', ['sign', 'sign_exit', 'sign_left', 'sign_right'], 80],
  ['lever', 'Lever', ['lever_left', 'lever', 'lever_right'], 70],
  ['switch', 'Switch', ['switch_red', 'switch_red_pressed', 'switch_blue', 'switch_blue_pressed'], 70],
  ['block', 'Block', ['block_blue', 'block_green', 'block_red', 'block_yellow', 'block_planks', 'block_empty'], 70],
  ['question-block', 'Surprise Block', ['block_exclamation', 'block_exclamation_active', 'block_coin', 'block_coin_active'], 70],
  ['crate', 'Crate', ['block_plank', 'bricks_brown', 'bricks_grey', 'brick_brown'], 70],
  ['ground', 'Ground', ['terrain_grass_block_top', 'terrain_grass_block_center', 'terrain_dirt_block_top', 'terrain_grass_cloud'], 100],
  ['platform', 'Platform', ['terrain_grass_horizontal_middle', 'terrain_dirt_horizontal_middle', 'bridge', 'bridge_logs'], 100],
  ['ladder', 'Ladder', ['ladder_middle', 'ladder_top', 'ladder_bottom'], 70],
  ['lava', 'Lava', ['lava_top', 'lava'], 100],
  ['rock', 'Rock', ['rock'], 70],
  ['bush', 'Bush', ['bush', 'cactus', 'grass'], 70],
  ['digit', 'Digit', ['hud_character_0', 'hud_character_1', 'hud_character_2', 'hud_character_3', 'hud_character_4',
    'hud_character_5', 'hud_character_6', 'hud_character_7', 'hud_character_8', 'hud_character_9'], 60],
];
for (const [id, name, files, size] of ITEMS) {
  sprite(`item-${id}`, name, ['things', 'games'],
    files.map((f) => ({ name: f.replace(/^(hud_character_|terrain_|block_)/, '').replace(/_/g, ' '), file: take('platformer', `Sprites/Tiles/Default/${f}.png`) })), { size });
}

// --- space ---
for (const n of [1, 2, 3]) {
  sprite(`ship-${n}`, `Spaceship ${n}`, ['space', 'games', 'vehicles'],
    ['blue', 'green', 'orange', 'red'].map((c) => ({ name: c, file: take('space', `PNG/playerShip${n}_${c}.png`) })), { size: 70 });
}
sprite('ufo', 'UFO', ['space', 'games'], ['Blue', 'Green', 'Red', 'Yellow'].map((c) => ({ name: c.toLowerCase(), file: take('space', `PNG/ufo${c}.png`) })), { size: 70 });
for (const c of ['Black', 'Blue', 'Green', 'Red']) {
  sprite(`alien-ship-${c.toLowerCase()}`, `Alien Ship (${c.toLowerCase()})`, ['space', 'games'],
    [1, 2, 3, 4, 5].map((n) => ({ name: `ship ${n}`, file: take('space', `PNG/Enemies/enemy${c}${n}.png`) })), { size: 70 });
}
sprite('meteor', 'Meteor', ['space', 'games'], [
  ...[1, 2, 3, 4].map((n) => ({ name: `big ${n}`, file: take('space', `PNG/Meteors/meteorBrown_big${n}.png`) })),
  { name: 'medium', file: take('space', 'PNG/Meteors/meteorBrown_med1.png') },
  { name: 'small', file: take('space', 'PNG/Meteors/meteorBrown_small1.png') },
  ...[1, 2, 3, 4].map((n) => ({ name: `grey ${n}`, file: take('space', `PNG/Meteors/meteorGrey_big${n}.png`) })),
], { size: 70 });
sprite('laser', 'Laser', ['space', 'games'], [
  { name: 'blue', file: take('space', 'PNG/Lasers/laserBlue01.png') },
  { name: 'green', file: take('space', 'PNG/Lasers/laserGreen11.png') },
  { name: 'red', file: take('space', 'PNG/Lasers/laserRed01.png') },
  { name: 'blue burst', file: take('space', 'PNG/Lasers/laserBlue08.png') },
  { name: 'red burst', file: take('space', 'PNG/Lasers/laserRed08.png') },
], { size: 100 });
sprite('power-up', 'Power-up', ['space', 'games', 'things'], [
  'powerupBlue_bolt', 'powerupGreen_shield', 'powerupRed_star', 'powerupYellow', 'pill_blue', 'pill_red', 'star_gold', 'shield_gold',
].map((f) => ({ name: f.replace(/^powerup|^pill_|_/g, ' ').trim().toLowerCase(), file: take('space', `PNG/Power-ups/${f}.png`) })), { size: 80 });

// --- scenery (also what the composed backdrops are built from) ---
const SCENERY = [
  ['house', 'House', ['house1', 'house2', 'houseAlt1', 'houseAlt2', 'houseSmall1', 'houseSmall2']],
  ['castle', 'Castle', ['castleSmall', 'castleSmallAlt', 'tower', 'towerAlt']],
  ['tree', 'Tree', ['tree', 'treeLong', 'treePine', 'treePalm', 'treeOrange', 'treeSnow', 'treeDead']],
  ['cloud', 'Cloud', ['cloud1', 'cloud2', 'cloud3', 'cloud4', 'cloud5', 'cloud6']],
  ['sun-moon', 'Sun and Moon', ['sun', 'moon', 'moonFull']],
  ['pyramid', 'Pyramid', ['pyramid', 'pyramidMayan']],
  ['fence', 'Fence', ['fence', 'fenceIron']],
  ['shrub', 'Shrub', ['bush1', 'bush2', 'bushAlt1', 'bushOrange1', 'cactus1', 'cactus2']],
];
for (const [id, name, files] of SCENERY) {
  sprite(`scenery-${id}`, name, ['scenery'], files.map((f) => ({ name: f.replace(/([A-Z])/g, ' $1').toLowerCase(), file: take('scenery', `PNG/Default/${f}.png`) })), { size: 100 });
}

// Backdrop tiles, composed into backdrops at run time (see src/library/backdrops.js).
for (const f of ['background_color_hills', 'background_color_trees', 'background_color_desert', 'background_color_mushrooms',
  'background_fade_hills', 'background_fade_trees', 'background_fade_desert', 'background_fade_mushrooms', 'background_clouds']) {
  backdropTiles[f.replace('background_', '')] = take('platformer', `Sprites/Backgrounds/Double/${f}.png`);
}
for (const f of ['black', 'blue', 'darkPurple', 'purple']) backdropTiles[`space_${f}`] = take('space', `Backgrounds/${f}.png`);

const body = `// GENERATED by Stages/tools/build-library.mjs -- do not edit by hand.
//
// The free cartoon library: pictures from Kenney's packs, every one released as CC0 (public
// domain). Each pack's own licence file is kept beside its pictures in public/library/kenney/.
// Sprite ids are PERSISTED in projects, so they are only ever added.
export const LICENCES = ${JSON.stringify(licences, null, 2)};

export const CARTOON_SPRITES = ${JSON.stringify(sprites, null, 1)};

export const BACKDROP_TILES = ${JSON.stringify(backdropTiles, null, 1)};
`;
writeFileSync(join(STAGES, 'src/library/cartoons.js'), body);
console.log(`${sprites.length} sprites, ${sprites.reduce((n, s) => n + s.costumes.length, 0)} costumes, ${copied.size} files, ${Object.keys(backdropTiles).length} backdrop tiles.`);
