// THE ONE TABLE OF BLOCKS for Edusim Stages: what each block is called, what it looks like and what
// it takes. The editor draws from it, the runtime dispatches on its `type`, the templates are written
// against it and the check tools hold every entry to having an implementation.
//
// EVERY `type`, EVERY INPUT NAME AND EVERY MENU VALUE IS PERSISTED inside saved projects. They are
// only ever ADDED, never renamed: a renamed type turns somebody's program into a block the runtime
// does not know. That is the same rule CLAUDE.md gives for the main app's BlockDefs.
//
// The types follow Scratch 3's opcode names (motion_movesteps and so on). That is not decoration:
// it is what makes a later import of a Scratch project's sprites (plan, section 9) a lookup rather
// than a translation, and it means every Scratch tutorial's block is the block of the same name here.
//
// This is deliberately NOT the main app's src/BlockDefs.js. Stages blocks have different meanings
// (x and y in steps on a flat stage, not feet along an object's facing), reporters nest inside other
// blocks, and loops run a whole body per frame. Keeping the table separate is what guarantees the
// main app and HiFi cannot change by accident (plan, section 3).
//
// Shapes:
//   hat       starts a script: nothing can go above it
//   stack     an ordinary block
//   cap       nothing can go below it (stop all, delete this clone)
//   c         one mouth (repeat, if); `cap: true` for forever
//   c2        two mouths (if ... else)
//   reporter  a round value block that fits a round slot
//   boolean   a pointed true/false block that fits a pointed slot
//
// Input kinds:
//   number, text   a white round slot that also takes a reporter
//   boolean        a pointed slot (empty means false)
//   color          a colour swatch that also takes a reporter
//   menu           a dropdown field; `options` is an array or the name of a dynamic list
//   variable       a dropdown of variable names (a field)

export const CATEGORIES = {
  motion: { name: 'Motion', fill: '#4c97ff', dark: '#3373cc' },
  looks: { name: 'Looks', fill: '#9966ff', dark: '#774dcc' },
  sound: { name: 'Sound', fill: '#cf63cf', dark: '#bd42bd' },
  events: { name: 'Events', fill: '#ffbf00', dark: '#cc9900' },
  control: { name: 'Control', fill: '#ffab19', dark: '#cf8b17' },
  sensing: { name: 'Sensing', fill: '#5cb1d6', dark: '#2e8eb8' },
  operators: { name: 'Operators', fill: '#3fae5a', dark: '#2f8a46' },
  variables: { name: 'Variables', fill: '#ff8c1a', dark: '#db6e00' },
  pen: { name: 'Pen', fill: '#0fbd8c', dark: '#0b8e69' },
};
export const CATEGORY_ORDER = ['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators', 'variables', 'pen'];

const num = (value = 0) => ({ kind: 'number', value });
const txt = (value = '') => ({ kind: 'text', value });
const bool = () => ({ kind: 'boolean' });
const menu = (options, value) => ({ kind: 'menu', options, value });
const colour = (value = '#e6194b') => ({ kind: 'color', value });
const variable = () => ({ kind: 'variable', value: '' });

const KEY_OPTIONS = ['space', 'up arrow', 'down arrow', 'left arrow', 'right arrow', 'any',
  ...'abcdefghijklmnopqrstuvwxyz'.split(''), ...'0123456789'.split('')];
const EFFECTS = ['color', 'ghost', 'brightness', 'pixelate'];

// `where`: 'sprite' (sprites only), 'stage' (the stage only), or absent (both).
const DEFS = [
  // --- Motion (sprites only: the stage does not move) ---
  { type: 'motion_movesteps', cat: 'motion', shape: 'stack', where: 'sprite', label: 'move %STEPS steps', inputs: { STEPS: num(10) } },
  { type: 'motion_turnright', cat: 'motion', shape: 'stack', where: 'sprite', label: 'turn ↻ %DEGREES degrees', inputs: { DEGREES: num(15) } },
  { type: 'motion_turnleft', cat: 'motion', shape: 'stack', where: 'sprite', label: 'turn ↺ %DEGREES degrees', inputs: { DEGREES: num(15) } },
  { type: 'motion_goto', cat: 'motion', shape: 'stack', where: 'sprite', label: 'go to %TO', inputs: { TO: menu('gotoTargets', '_random_') } },
  { type: 'motion_gotoxy', cat: 'motion', shape: 'stack', where: 'sprite', label: 'go to x: %X y: %Y', inputs: { X: num(0), Y: num(0) } },
  { type: 'motion_glideto', cat: 'motion', shape: 'stack', where: 'sprite', label: 'glide %SECS secs to %TO', inputs: { SECS: num(1), TO: menu('gotoTargets', '_random_') } },
  { type: 'motion_glidesecstoxy', cat: 'motion', shape: 'stack', where: 'sprite', label: 'glide %SECS secs to x: %X y: %Y', inputs: { SECS: num(1), X: num(0), Y: num(0) } },
  { type: 'motion_pointindirection', cat: 'motion', shape: 'stack', where: 'sprite', label: 'point in direction %DIRECTION', inputs: { DIRECTION: num(90) } },
  { type: 'motion_pointtowards', cat: 'motion', shape: 'stack', where: 'sprite', label: 'point towards %TOWARDS', inputs: { TOWARDS: menu('pointTargets', '_mouse_') } },
  { type: 'motion_changexby', cat: 'motion', shape: 'stack', where: 'sprite', label: 'change x by %DX', inputs: { DX: num(10) } },
  { type: 'motion_setx', cat: 'motion', shape: 'stack', where: 'sprite', label: 'set x to %X', inputs: { X: num(0) } },
  { type: 'motion_changeyby', cat: 'motion', shape: 'stack', where: 'sprite', label: 'change y by %DY', inputs: { DY: num(10) } },
  { type: 'motion_sety', cat: 'motion', shape: 'stack', where: 'sprite', label: 'set y to %Y', inputs: { Y: num(0) } },
  { type: 'motion_ifonedgebounce', cat: 'motion', shape: 'stack', where: 'sprite', label: 'if on edge, bounce', inputs: {} },
  { type: 'motion_setrotationstyle', cat: 'motion', shape: 'stack', where: 'sprite', label: 'set rotation style %STYLE', inputs: { STYLE: menu(['left-right', "don't rotate", 'all around'], 'left-right') } },
  { type: 'motion_xposition', cat: 'motion', shape: 'reporter', where: 'sprite', label: 'x position', inputs: {}, monitor: true },
  { type: 'motion_yposition', cat: 'motion', shape: 'reporter', where: 'sprite', label: 'y position', inputs: {}, monitor: true },
  { type: 'motion_direction', cat: 'motion', shape: 'reporter', where: 'sprite', label: 'direction', inputs: {}, monitor: true },

  // --- Looks ---
  { type: 'looks_sayforsecs', cat: 'looks', shape: 'stack', where: 'sprite', label: 'say %MESSAGE for %SECS seconds', inputs: { MESSAGE: txt('Hello!'), SECS: num(2) } },
  { type: 'looks_say', cat: 'looks', shape: 'stack', where: 'sprite', label: 'say %MESSAGE', inputs: { MESSAGE: txt('Hello!') } },
  { type: 'looks_thinkforsecs', cat: 'looks', shape: 'stack', where: 'sprite', label: 'think %MESSAGE for %SECS seconds', inputs: { MESSAGE: txt('Hmm...'), SECS: num(2) } },
  { type: 'looks_think', cat: 'looks', shape: 'stack', where: 'sprite', label: 'think %MESSAGE', inputs: { MESSAGE: txt('Hmm...') } },
  { type: 'looks_switchcostumeto', cat: 'looks', shape: 'stack', where: 'sprite', label: 'switch costume to %COSTUME', inputs: { COSTUME: menu('costumes', '') } },
  { type: 'looks_nextcostume', cat: 'looks', shape: 'stack', where: 'sprite', label: 'next costume', inputs: {} },
  { type: 'looks_switchbackdropto', cat: 'looks', shape: 'stack', label: 'switch backdrop to %BACKDROP', inputs: { BACKDROP: menu('backdropsAndNext', '') } },
  { type: 'looks_nextbackdrop', cat: 'looks', shape: 'stack', label: 'next backdrop', inputs: {} },
  { type: 'looks_changesizeby', cat: 'looks', shape: 'stack', where: 'sprite', label: 'change size by %CHANGE', inputs: { CHANGE: num(10) } },
  { type: 'looks_setsizeto', cat: 'looks', shape: 'stack', where: 'sprite', label: 'set size to %SIZE %', inputs: { SIZE: num(100) } },
  { type: 'looks_changeeffectby', cat: 'looks', shape: 'stack', label: 'change %EFFECT effect by %CHANGE', inputs: { EFFECT: menu(EFFECTS, 'color'), CHANGE: num(25) } },
  { type: 'looks_seteffectto', cat: 'looks', shape: 'stack', label: 'set %EFFECT effect to %VALUE', inputs: { EFFECT: menu(EFFECTS, 'color'), VALUE: num(0) } },
  { type: 'looks_cleargraphiceffects', cat: 'looks', shape: 'stack', label: 'clear graphic effects', inputs: {} },
  { type: 'looks_show', cat: 'looks', shape: 'stack', where: 'sprite', label: 'show', inputs: {} },
  { type: 'looks_hide', cat: 'looks', shape: 'stack', where: 'sprite', label: 'hide', inputs: {} },
  { type: 'looks_gotofrontback', cat: 'looks', shape: 'stack', where: 'sprite', label: 'go to %FRONT_BACK layer', inputs: { FRONT_BACK: menu(['front', 'back'], 'front') } },
  { type: 'looks_goforwardbackwardlayers', cat: 'looks', shape: 'stack', where: 'sprite', label: 'go %FORWARD_BACKWARD %NUM layers', inputs: { FORWARD_BACKWARD: menu(['forward', 'backward'], 'forward'), NUM: num(1) } },
  // Stories: a caption card across the bottom of the stage, the narrator's line. It is drawn into
  // the picture, so it is in an exported video too.
  { type: 'looks_showcaption', cat: 'looks', shape: 'stack', label: 'show caption %TEXT', inputs: { TEXT: txt('Once upon a time...') } },
  { type: 'looks_hidecaption', cat: 'looks', shape: 'stack', label: 'hide caption', inputs: {} },
  { type: 'looks_costumenumbername', cat: 'looks', shape: 'reporter', where: 'sprite', label: 'costume %NUMBER_NAME', inputs: { NUMBER_NAME: menu(['number', 'name'], 'number') }, monitor: true },
  { type: 'looks_backdropnumbername', cat: 'looks', shape: 'reporter', label: 'backdrop %NUMBER_NAME', inputs: { NUMBER_NAME: menu(['number', 'name'], 'number') }, monitor: true },
  { type: 'looks_size', cat: 'looks', shape: 'reporter', where: 'sprite', label: 'size', inputs: {}, monitor: true },

  // --- Sound ---
  { type: 'sound_playuntildone', cat: 'sound', shape: 'stack', label: 'play sound %SOUND until done', inputs: { SOUND: menu('sounds', '') } },
  { type: 'sound_play', cat: 'sound', shape: 'stack', label: 'start sound %SOUND', inputs: { SOUND: menu('sounds', '') } },
  { type: 'sound_stopallsounds', cat: 'sound', shape: 'stack', label: 'stop all sounds', inputs: {} },
  { type: 'sound_playnote', cat: 'sound', shape: 'stack', label: 'play note %NOTE for %BEATS beats', inputs: { NOTE: num(60), BEATS: num(0.5) } },
  { type: 'sound_setinstrument', cat: 'sound', shape: 'stack', label: 'set instrument to %INSTRUMENT', inputs: { INSTRUMENT: menu(['piano', 'organ', 'guitar', 'flute', 'marimba', 'synth', 'bass', 'bell'], 'piano') } },
  { type: 'sound_changevolumeby', cat: 'sound', shape: 'stack', label: 'change volume by %VOLUME', inputs: { VOLUME: num(-10) } },
  { type: 'sound_setvolumeto', cat: 'sound', shape: 'stack', label: 'set volume to %VOLUME %', inputs: { VOLUME: num(100) } },
  { type: 'sound_volume', cat: 'sound', shape: 'reporter', label: 'volume', inputs: {}, monitor: true },

  // --- Events ---
  { type: 'event_whenflagclicked', cat: 'events', shape: 'hat', label: 'when %FLAG clicked', inputs: {}, icon: 'flag' },
  { type: 'event_whenkeypressed', cat: 'events', shape: 'hat', label: 'when %KEY key pressed', inputs: { KEY: menu(KEY_OPTIONS, 'space') } },
  { type: 'event_whenthisspriteclicked', cat: 'events', shape: 'hat', where: 'sprite', label: 'when this sprite clicked', inputs: {} },
  { type: 'event_whenstageclicked', cat: 'events', shape: 'hat', where: 'stage', label: 'when stage clicked', inputs: {} },
  { type: 'event_whenbackdropswitchesto', cat: 'events', shape: 'hat', label: 'when backdrop switches to %BACKDROP', inputs: { BACKDROP: menu('backdrops', '') } },
  { type: 'event_whenbroadcastreceived', cat: 'events', shape: 'hat', label: 'when I receive %BROADCAST', inputs: { BROADCAST: menu('messages', 'message1') } },
  { type: 'event_broadcast', cat: 'events', shape: 'stack', label: 'broadcast %BROADCAST', inputs: { BROADCAST: menu('messages', 'message1') } },
  { type: 'event_broadcastandwait', cat: 'events', shape: 'stack', label: 'broadcast %BROADCAST and wait', inputs: { BROADCAST: menu('messages', 'message1') } },

  // --- Control ---
  { type: 'control_wait', cat: 'control', shape: 'stack', label: 'wait %DURATION seconds', inputs: { DURATION: num(1) } },
  { type: 'control_repeat', cat: 'control', shape: 'c', label: 'repeat %TIMES', inputs: { TIMES: num(10) } },
  { type: 'control_forever', cat: 'control', shape: 'c', cap: true, label: 'forever', inputs: {} },
  { type: 'control_if', cat: 'control', shape: 'c', label: 'if %CONDITION then', inputs: { CONDITION: bool() } },
  { type: 'control_if_else', cat: 'control', shape: 'c2', label: 'if %CONDITION then', label2: 'else', inputs: { CONDITION: bool() } },
  { type: 'control_wait_until', cat: 'control', shape: 'stack', label: 'wait until %CONDITION', inputs: { CONDITION: bool() } },
  { type: 'control_repeat_until', cat: 'control', shape: 'c', label: 'repeat until %CONDITION', inputs: { CONDITION: bool() } },
  // A cap while it stops all or this script; an ordinary block when it stops the OTHER scripts,
  // since this one then carries on. The editor asks `isCap()` rather than reading `shape`.
  { type: 'control_stop', cat: 'control', shape: 'stack', capWhen: (b) => b.inputs.STOP_OPTION?.value !== 'other scripts in sprite', label: 'stop %STOP_OPTION', inputs: { STOP_OPTION: menu(['all', 'this script', 'other scripts in sprite'], 'all') } },
  { type: 'control_start_as_clone', cat: 'control', shape: 'hat', where: 'sprite', label: 'when I start as a clone', inputs: {} },
  { type: 'control_create_clone_of', cat: 'control', shape: 'stack', label: 'create clone of %CLONE_OPTION', inputs: { CLONE_OPTION: menu('cloneTargets', '_myself_') } },
  { type: 'control_delete_this_clone', cat: 'control', shape: 'cap', where: 'sprite', label: 'delete this clone', inputs: {} },

  // --- Sensing ---
  { type: 'sensing_touchingobject', cat: 'sensing', shape: 'boolean', where: 'sprite', label: 'touching %TOUCHINGOBJECTMENU ?', inputs: { TOUCHINGOBJECTMENU: menu('touchTargets', '_mouse_') } },
  { type: 'sensing_distanceto', cat: 'sensing', shape: 'reporter', where: 'sprite', label: 'distance to %DISTANCETOMENU', inputs: { DISTANCETOMENU: menu('pointTargets', '_mouse_') } },
  { type: 'sensing_askandwait', cat: 'sensing', shape: 'stack', label: 'ask %QUESTION and wait', inputs: { QUESTION: txt("What's your name?") } },
  { type: 'sensing_answer', cat: 'sensing', shape: 'reporter', label: 'answer', inputs: {}, monitor: true },
  { type: 'sensing_keypressed', cat: 'sensing', shape: 'boolean', label: 'key %KEY_OPTION pressed?', inputs: { KEY_OPTION: menu(KEY_OPTIONS, 'space') } },
  { type: 'sensing_mousedown', cat: 'sensing', shape: 'boolean', label: 'mouse down?', inputs: {} },
  { type: 'sensing_mousex', cat: 'sensing', shape: 'reporter', label: 'mouse x', inputs: {} },
  { type: 'sensing_mousey', cat: 'sensing', shape: 'reporter', label: 'mouse y', inputs: {} },
  { type: 'sensing_setdragmode', cat: 'sensing', shape: 'stack', where: 'sprite', label: 'set drag mode %DRAG_MODE', inputs: { DRAG_MODE: menu(['draggable', 'not draggable'], 'draggable') } },
  { type: 'sensing_timer', cat: 'sensing', shape: 'reporter', label: 'timer', inputs: {}, monitor: true },
  { type: 'sensing_resettimer', cat: 'sensing', shape: 'stack', label: 'reset timer', inputs: {} },
  { type: 'sensing_of', cat: 'sensing', shape: 'reporter', label: '%PROPERTY of %OBJECT', inputs: { PROPERTY: menu('propertiesOf', 'x position'), OBJECT: menu('ofTargets', '_stage_') } },
  { type: 'sensing_current', cat: 'sensing', shape: 'reporter', label: 'current %CURRENTMENU', inputs: { CURRENTMENU: menu(['year', 'month', 'date', 'day of week', 'hour', 'minute', 'second'], 'minute') } },

  // --- Operators ---
  { type: 'operator_add', cat: 'operators', shape: 'reporter', label: '%NUM1 + %NUM2', inputs: { NUM1: num(''), NUM2: num('') } },
  { type: 'operator_subtract', cat: 'operators', shape: 'reporter', label: '%NUM1 - %NUM2', inputs: { NUM1: num(''), NUM2: num('') } },
  { type: 'operator_multiply', cat: 'operators', shape: 'reporter', label: '%NUM1 * %NUM2', inputs: { NUM1: num(''), NUM2: num('') } },
  { type: 'operator_divide', cat: 'operators', shape: 'reporter', label: '%NUM1 / %NUM2', inputs: { NUM1: num(''), NUM2: num('') } },
  { type: 'operator_random', cat: 'operators', shape: 'reporter', label: 'pick random %FROM to %TO', inputs: { FROM: num(1), TO: num(10) } },
  { type: 'operator_gt', cat: 'operators', shape: 'boolean', label: '%OPERAND1 > %OPERAND2', inputs: { OPERAND1: txt(''), OPERAND2: txt('50') } },
  { type: 'operator_lt', cat: 'operators', shape: 'boolean', label: '%OPERAND1 < %OPERAND2', inputs: { OPERAND1: txt(''), OPERAND2: txt('50') } },
  { type: 'operator_equals', cat: 'operators', shape: 'boolean', label: '%OPERAND1 = %OPERAND2', inputs: { OPERAND1: txt(''), OPERAND2: txt('50') } },
  { type: 'operator_and', cat: 'operators', shape: 'boolean', label: '%OPERAND1 and %OPERAND2', inputs: { OPERAND1: bool(), OPERAND2: bool() } },
  { type: 'operator_or', cat: 'operators', shape: 'boolean', label: '%OPERAND1 or %OPERAND2', inputs: { OPERAND1: bool(), OPERAND2: bool() } },
  { type: 'operator_not', cat: 'operators', shape: 'boolean', label: 'not %OPERAND', inputs: { OPERAND: bool() } },
  { type: 'operator_join', cat: 'operators', shape: 'reporter', label: 'join %STRING1 %STRING2', inputs: { STRING1: txt('apple '), STRING2: txt('banana') } },
  { type: 'operator_letter_of', cat: 'operators', shape: 'reporter', label: 'letter %LETTER of %STRING', inputs: { LETTER: num(1), STRING: txt('apple') } },
  { type: 'operator_length', cat: 'operators', shape: 'reporter', label: 'length of %STRING', inputs: { STRING: txt('apple') } },
  { type: 'operator_contains', cat: 'operators', shape: 'boolean', label: '%STRING1 contains %STRING2 ?', inputs: { STRING1: txt('apple'), STRING2: txt('a') } },
  { type: 'operator_mod', cat: 'operators', shape: 'reporter', label: '%NUM1 mod %NUM2', inputs: { NUM1: num(''), NUM2: num('') } },
  { type: 'operator_round', cat: 'operators', shape: 'reporter', label: 'round %NUM', inputs: { NUM: num('') } },
  { type: 'operator_mathop', cat: 'operators', shape: 'reporter', label: '%OPERATOR of %NUM', inputs: { OPERATOR: menu(['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^'], 'abs'), NUM: num('') } },

  // --- Variables ---
  { type: 'data_variable', cat: 'variables', shape: 'reporter', label: '%VARIABLE', inputs: { VARIABLE: variable() }, palette: false },
  { type: 'data_setvariableto', cat: 'variables', shape: 'stack', label: 'set %VARIABLE to %VALUE', inputs: { VARIABLE: variable(), VALUE: txt('0') } },
  { type: 'data_changevariableby', cat: 'variables', shape: 'stack', label: 'change %VARIABLE by %VALUE', inputs: { VARIABLE: variable(), VALUE: num(1) } },
  { type: 'data_showvariable', cat: 'variables', shape: 'stack', label: 'show variable %VARIABLE', inputs: { VARIABLE: variable() } },
  { type: 'data_hidevariable', cat: 'variables', shape: 'stack', label: 'hide variable %VARIABLE', inputs: { VARIABLE: variable() } },

  // --- Pen ---
  { type: 'pen_clear', cat: 'pen', shape: 'stack', label: 'erase all', inputs: {} },
  { type: 'pen_stamp', cat: 'pen', shape: 'stack', where: 'sprite', label: 'stamp', inputs: {} },
  { type: 'pen_penDown', cat: 'pen', shape: 'stack', where: 'sprite', label: 'pen down', inputs: {} },
  { type: 'pen_penUp', cat: 'pen', shape: 'stack', where: 'sprite', label: 'pen up', inputs: {} },
  { type: 'pen_setPenColorToColor', cat: 'pen', shape: 'stack', where: 'sprite', label: 'set pen color to %COLOR', inputs: { COLOR: colour('#2563eb') } },
  { type: 'pen_changePenColorParamBy', cat: 'pen', shape: 'stack', where: 'sprite', label: 'change pen %COLOR_PARAM by %VALUE', inputs: { COLOR_PARAM: menu(['color', 'saturation', 'brightness', 'transparency'], 'color'), VALUE: num(10) } },
  { type: 'pen_setPenColorParamTo', cat: 'pen', shape: 'stack', where: 'sprite', label: 'set pen %COLOR_PARAM to %VALUE', inputs: { COLOR_PARAM: menu(['color', 'saturation', 'brightness', 'transparency'], 'color'), VALUE: num(50) } },
  { type: 'pen_changePenSizeBy', cat: 'pen', shape: 'stack', where: 'sprite', label: 'change pen size by %SIZE', inputs: { SIZE: num(1) } },
  { type: 'pen_setPenSizeTo', cat: 'pen', shape: 'stack', where: 'sprite', label: 'set pen size to %SIZE', inputs: { SIZE: num(1) } },
];

export const BLOCKS = new Map(DEFS.map((d) => [d.type, d]));

export function blockDef(type) {
  return BLOCKS.get(type) || null;
}

export function isHat(type) {
  return BLOCKS.get(type)?.shape === 'hat';
}

export function isValueShape(shape) {
  return shape === 'reporter' || shape === 'boolean';
}

// Whether nothing may be attached below this block.
export function isCap(block) {
  const def = BLOCKS.get(block.type);
  if (!def) return false;
  if (def.shape === 'cap') return true;
  if (def.cap) return true;
  if (def.capWhen) return def.capWhen(block);
  return false;
}

// What the palette shows for a target, in category order. The stage has no motion and no pen
// sprite blocks, and a sprite has no "when stage clicked", exactly as in Scratch.
export function paletteFor(isStage) {
  const out = {};
  for (const cat of CATEGORY_ORDER) out[cat] = [];
  for (const def of DEFS) {
    if (def.palette === false) continue;
    if (def.where === 'sprite' && isStage) continue;
    if (def.where === 'stage' && !isStage) continue;
    out[def.cat].push(def.type);
  }
  return out;
}

// The label split into words and input names, so the editor and the check tools read one parse.
export function labelParts(def, which = 'label') {
  const text = def[which] || '';
  return text.split(/(%[A-Z_0-9]+)/).filter((s) => s.length).map((s) => (s.startsWith('%') ? { input: s.slice(1) } : { text: s }));
}

export const KEYS = KEY_OPTIONS;
