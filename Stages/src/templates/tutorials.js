// The tutorials: step-by-step cards that float over the editor (src/ui/Tutorials.js). Each starts
// from a STARTER (the official project with its scripts left out) so the student builds the scripts
// themselves, and the finished version is in the Projects gallery to compare with.
//
// Block names in the steps are drawn as chips in their category's colour, the colour the student
// then looks for in the palette.
import { CATEGORIES } from '../blocks/defs.js';
import { STARTERS } from './index.js';

const chip = (cat, text) => `<span class="chip" style="background:${CATEGORIES[cat].fill}">${text}</span>`;
const ev = (t) => chip('events', t);
const ctl = (t) => chip('control', t);
const mo = (t) => chip('motion', t);
const lk = (t) => chip('looks', t);
const sn = (t) => chip('sound', t);
const se = (t) => chip('sensing', t);
const op = (t) => chip('operators', t);
const va = (t) => chip('variables', t);
const pn = (t) => chip('pen', t);
const p = (...lines) => lines.map((l) => `<p>${l}</p>`).join('');

export const TUTORIALS = [
  {
    id: 'dance', title: 'Robot Dance Party', level: 'Beginner', picture: 'dance', start: STARTERS.dance,
    blurb: 'Make Robo dance to a drum beat. Your first script.',
    steps: [
      { title: 'Meet Robo', html: p('Robo is on the stage, ready to dance. Press the green flag ⚑ above the stage. Nothing happens yet, because Robo has no scripts.', 'Scripts are made by dragging blocks from the palette on the left into the big script area.') },
      { title: 'Start with the flag', html: p(`Click ${chip('events', 'Events')} in the list of colours. Drag ${ev('when ⚑ clicked')} into the script area.`, 'Every script that should run when the green flag is pressed starts with this block.') },
      { title: 'Keep going', html: p(`From Control, drag ${ctl('forever')} so it snaps under ${ev('when ⚑ clicked')}. A grey line shows where it will join.`) },
      { title: 'Dance moves', html: p(`From Looks, drag ${lk('next costume')} into the mouth of ${ctl('forever')}. Then put ${ctl('wait 1 seconds')} under it, and change the 1 to 0.25.`, 'Press the green flag. Robo dances!') },
      { title: 'Disco lights', html: p(`Make a second script: another ${ev('when ⚑ clicked')} and ${ctl('forever')}, with ${lk('change color effect by 25')} inside. Change 25 to 5.`, 'Two scripts can run at the same time. Press the flag again.') },
      { title: 'Music', html: p('Click the Stage on the right, under the sprites. The stage can have scripts too.', `Give it ${ev('when ⚑ clicked')}, ${ctl('forever')}, and ${sn('play sound Drum Beat until done')} inside.`) },
      { title: 'A spin', html: p(`Click Robo again. Add ${ev('when space key pressed')} with ${ctl('repeat 10')} and ${mo('turn ↻ 36 degrees')} inside.`, 'Run it and press the space bar. 10 turns of 36 degrees is a whole turn, because 10 × 36 = 360.') },
      { title: 'Keep it', html: p('Use File, then Save to your computer, to keep your project. You can open it again with File, then Load from your computer.', 'The finished version is in Projects as Robot Dance Party, if you want to compare.') },
    ],
  },
  {
    id: 'story', title: 'Tell a Story', level: 'Beginner', picture: 'moon-trip', start: STARTERS.story,
    blurb: 'Two characters, two places, captions and conversation.',
    steps: [
      { title: 'The cast', html: p('Riley and Robo are on the stage, and the stage has two backdrops: the Park and the Moon, both from Edusim\'s own 3D worlds. You will tell their story.') },
      { title: 'Set the scene', html: p(`Click the Stage. Give it ${ev('when ⚑ clicked')}, then ${lk('switch backdrop to Park')}, then ${lk('show caption')} with your first line, like "One day in the park..."`, `Add ${ctl('wait 3 seconds')} and ${lk('hide caption')}.`) },
      { title: 'Riley speaks', html: p(`Click Riley. Use ${ev('when I receive')} and make a New message called "chat". Under it, add ${lk('say Hello! for 2 seconds')}.`) },
      { title: 'Robo answers', html: p(`Click Robo. Add ${ev('when I receive chat')}, then ${ctl('wait 2 seconds')} so Robo waits for Riley to finish, then ${lk('say')} something back.`) },
      { title: 'Start the conversation', html: p(`Back on the Stage, add ${ev('broadcast chat and wait')} to the end of its script. "and wait" means the stage waits until everyone has finished talking.`) },
      { title: 'Off to the Moon', html: p(`After that, add ${lk('switch backdrop to Moon')} and a new caption. On Riley and Robo, use ${ev('when backdrop switches to Moon')} to say something about being on the Moon.`) },
      { title: 'Make a video', html: p('Press the green flag to watch your story. When you like it, use File, then Export a video, to make an MP4 you can play anywhere. The finished version is in Projects as A Trip to the Moon.') },
    ],
  },
  {
    id: 'catch', title: 'Catch the Coins', level: 'Intermediate', picture: 'catch', start: STARTERS.catch,
    blurb: 'A game with arrow keys, falling clones, a score and a timer.',
    steps: [
      { title: 'The game', html: p('Coins fall from the sky and the Catcher catches them. You have the sprites and the score. The scripts are yours to build.') },
      { title: 'Move with the arrows', html: p(`Click the Catcher. Build: ${ev('when ⚑ clicked')}, ${ctl('forever')}, and inside it ${ctl('if')} ${se('key right arrow pressed?')} ${ctl('then')} ${mo('change x by 9')}.`, 'Add another if for the left arrow, with change x by -9. Try it.') },
      { title: 'Face the way you walk', html: p(`Inside each if, add ${mo('point in direction 90')} for right and ${mo('point in direction -90')} for left. The Catcher's rotation style is left-right, so it flips instead of turning upside down.`) },
      { title: 'Rain coins', html: p(`Click the Coin. Build: ${ev('when ⚑ clicked')}, ${lk('hide')}, ${ctl('forever')} with ${ctl('create clone of myself')} and ${ctl('wait')} ${op('pick random 0.4 to 1.1')} inside.`) },
      { title: 'Each clone falls', html: p(`Add ${ctl('when I start as a clone')}, then ${mo('go to x:')} ${op('pick random -220 to 220')} ${mo('y: 170')}, then ${lk('show')}.`, `Then ${ctl('repeat until')} ${op('y position < -165')} with ${mo('change y by -5')} inside. After the loop, ${ctl('delete this clone')}.`) },
      { title: 'Catch it', html: p(`Inside the repeat, add ${ctl('if')} ${se('touching Catcher?')} ${ctl('then')} ${va('change score by 1')}, ${sn('start sound Coin')} and ${ctl('delete this clone')}.`) },
      { title: 'Reset the score', html: p(`Click the Stage. Build ${ev('when ⚑ clicked')}, ${va('set score to 0')}, ${se('reset timer')}, ${ctl('wait until')} ${op('timer > 30')}, ${ev('broadcast game over')}.`) },
      { title: 'Game over', html: p(`On the Catcher: ${ev('when I receive game over')}, ${ctl('stop other scripts in sprite')}, then ${lk('say')} ${op('join')} with the score. On the Coin: ${ev('when I receive game over')}, ${ctl('stop other scripts in sprite')}, ${ctl('delete this clone')}.`, 'Play! A project can have 100 clones at once, which is why each one deletes itself.') },
    ],
  },
  {
    id: 'maze', title: 'Mouse Maze', level: 'Intermediate', picture: 'maze', start: STARTERS.maze,
    blurb: 'Walls you cannot walk through, and a timer for how long it took.',
    steps: [
      { title: 'The maze', html: p('The walls are one sprite, so "touching Walls?" is true whenever the mouse is touching any wall. The star is the goal.') },
      { title: 'Step and step back', html: p(`On the Mouse: ${ev('when ⚑ clicked')}, ${mo('go to x: -200 y: -120')}, then ${ctl('forever')} with ${ctl('if')} ${se('key right arrow pressed?')} ${ctl('then')} ${mo('change x by 4')}.`, `Inside that if, add ${ctl('if')} ${se('touching Walls?')} ${ctl('then')} ${mo('change x by -4')}. If a step goes into a wall, step straight back.`) },
      { title: 'All four ways', html: p('Do the same for left (-4), up (change y by 4) and down (change y by -4). Each one steps back if it hits a wall.') },
      { title: 'Win', html: p(`Make a second script: ${ev('when ⚑ clicked')}, ${se('reset timer')}, ${ctl('wait until')} ${se('touching Star?')}, ${ctl('stop other scripts in sprite')}, then ${lk('say')} ${op('join')} "I did it in " ${op('round')} ${se('timer')}.`, 'Why not stop all? Stopping everything also clears every speech bubble, so the message would vanish at once.') },
      { title: 'Make it yours', html: p('Click the Walls sprite, then Costumes, and paint your own maze. Keep the corridors wider than the mouse.') },
    ],
  },
  {
    id: 'jump', title: 'Jump Up', level: 'Advanced', picture: 'jump', start: STARTERS.jump,
    blurb: 'A platform game. Gravity is a variable that changes every frame.',
    steps: [
      { title: 'How falling works', html: p('Real gravity makes you fall faster and faster. In a game that is one variable, vy (speed up and down): take 1 off it every frame, then move by it.', 'The Hero already has a variable called vy, for this sprite only.') },
      { title: 'Fall', html: p(`On the Hero: ${ev('when ⚑ clicked')}, ${mo('go to x: -200 y: -100')}, ${va('set vy to 0')}, ${ctl('forever')} with ${va('change vy by -1')} and ${mo('change y by')} ${va('vy')} inside.`, 'Run it: the Hero falls straight through everything.') },
      { title: 'Land', html: p(`Inside forever, add ${ctl('if')} ${op('and')} with ${se('touching Platforms?')} and ${op('vy < 1')}. Inside: ${mo('change y by')} ${op('0 - vy')} (undo the last move) and ${va('set vy to 0')}.`, 'Only falling counts, which is why it checks vy < 1: you can jump up through a platform from below.') },
      { title: 'Jump', html: p(`Inside the landing if, add ${ctl('if')} ${se('key up arrow pressed?')} ${ctl('then')} ${va('set vy to 15')}. You can only jump while you are standing on something.`) },
      { title: 'Run', html: p(`Add ${ctl('if')} ${se('key right arrow pressed?')} with ${mo('point in direction 90')} and ${mo('change x by 5')}, and the same for left.`) },
      { title: 'Reach the flag', html: p(`Second script: ${ev('when ⚑ clicked')}, ${ctl('wait until')} ${se('touching Flag?')}, ${ctl('stop other scripts in sprite')}, ${lk('say I made it!')}. Try changing 15 and -1: a bigger jump, or Moon gravity.`) },
    ],
  },
  {
    id: 'model', title: 'Spin an Edusim Model', level: 'Beginner', picture: 'heart', start: null,
    blurb: 'Bring a 3D model from the Model Database onto the stage and make it turn.',
    steps: [
      { title: 'Choose a model', html: p('Under the stage, press Choose a Sprite, then the Edusim Models tab. Pick any model: a heart, a rocket, a volcano, a violin.', 'Edusim photographs it from twelve sides. Those twelve pictures become its costumes.') },
      { title: 'Turn it', html: p(`Give it ${ev('when ⚑ clicked')}, ${ctl('forever')}, with ${lk('next costume')} and ${ctl('wait 0.1 seconds')} inside. Each costume is the model seen from 30 degrees further round.`) },
      { title: 'Make it beat or bounce', html: p(`Add a second script with ${ctl('forever')}: ${lk('change size by 8')}, ${ctl('wait 0.15')}, ${lk('change size by -8')}, ${ctl('wait 0.5')}.`) },
      { title: 'Tell people about it', html: p(`Click the Stage and use ${lk('show caption')} to add facts about your model. The Beating Heart in Projects is a finished example.`) },
    ],
  },
  {
    id: 'patterns', title: 'Draw with the Pen', level: 'Beginner', picture: 'patterns', start: STARTERS.patterns,
    blurb: 'Make a sprite draw shapes, then a pattern from a shape.',
    steps: [
      { title: 'A square', html: p(`Click the Pen sprite. Build: ${ev('when ⚑ clicked')}, ${pn('erase all')}, ${pn('pen down')}, ${ctl('repeat 4')} with ${mo('move 100 steps')} and ${mo('turn ↻ 90 degrees')} inside.`) },
      { title: 'A star', html: p('Change repeat 4 to 5, and turn 90 to 144. Why 144? A star turns twice round in five points: 2 × 360 ÷ 5 = 144.') },
      { title: 'A pattern', html: p(`Put the whole repeat inside another ${ctl('repeat 36')}, and add ${mo('turn ↻ 10 degrees')} after the star. 36 × 10 = 360.`) },
      { title: 'Colour', html: p(`Inside the big repeat, add ${pn('change pen color by 3')}. Try other numbers, other shapes, and ${pn('set pen size')}.`) },
    ],
  },
];
