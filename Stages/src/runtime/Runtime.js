// The Edusim Stages runtime: runs a project's scripts, frame by frame.
//
// IT IS PURE JAVASCRIPT AND KNOWS NOTHING ABOUT THE SCREEN. Pictures, sound and the pen are reached
// through a `host` handed in at construction, so the check tools run every program in node with a
// stub host and a virtual clock, and the video exporter runs it on the same virtual clock as the
// picture (plan, sections 4 and 6).
//
// TIMING IS SCRATCH'S (decision A). Each frame every running script runs until it YIELDS, and only
// loops, waits, glides and "...and wait" blocks yield: motion, looks and maths take no frame. So
// `forever { change x by 5 }` moves 5 steps a frame whatever else is in the loop. Scratch runs at
// 30 frames a second, and so does this (`FRAME_RATE`): it is what makes a speed in a Scratch tutorial
// the same speed here. A frame keeps running passes until something has changed on screen, as
// Scratch's does, so a loop that only counts does not crawl one step a frame; a pass cap (rather than
// a wall-clock budget) bounds that, which keeps an export and a check run exactly repeatable.
//
// THE MAIN APP'S PROGRAM RUNNER IS NOT USED, deliberately: its blocks move objects in feet along
// their own facing and take a frame each, and saved Edusim worlds depend on both (plan, section 3).
import { BLOCKS, isHat } from '../blocks/defs.js';
import { compare, pickRandom, toBoolean, toNumber, toText, wrapDirection } from './cast.js';
import {
  HALF_H, HALF_W, boundsOf, containsPoint, costumeOf, fence, spritesTouch, touchesEdge,
} from './geometry.js';

export const FRAME_RATE = 30;
export const CLONE_LIMIT = 100; // decision F
const MAX_PASSES = 400;

const KEY_CODES = {
  ' ': 'space', ArrowUp: 'up arrow', ArrowDown: 'down arrow', ArrowLeft: 'left arrow', ArrowRight: 'right arrow',
};
export function keyName(eventKey) {
  if (KEY_CODES[eventKey]) return KEY_CODES[eventKey];
  if (eventKey?.length === 1) return eventKey.toLowerCase();
  return null;
}

// Hats that restart a script already running when they fire again, as Scratch's do.
const RESTARTS = new Set(['event_whenflagclicked', 'event_whenbroadcastreceived', 'event_whenthisspriteclicked',
  'event_whenstageclicked', 'control_start_as_clone']);

const defaultPen = () => ({ down: false, h: 66, s: 100, v: 100, a: 0, size: 1 });
const defaultEffects = () => ({ color: 0, ghost: 0, brightness: 0, pixelate: 0 });

export class Runtime {
  // host: {
  //   now(): seconds                         the clock every wait and glide reads
  //   random(): 0..1
  //   maskFor(costume): mask | null          for touching (geometry.js)
  //   audio: { play(target, sound) -> seconds, stopAll(), note(target, midi, seconds, instrument), volumeChanged(target) }
  //   pen:   { line(x0, y0, x1, y1, rgba, size), dot(x, y, rgba, size), stamp(target), clear() }
  //   onBackdrop(name), onAsk(question | null), onChange()      optional
  // }
  constructor(project, host) {
    this.host = host;
    this.threads = [];
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.answer = '';
    this.asks = [];
    this.caption = null;
    this.timerStart = host.now();
    this.redraw = false;
    this.warnings = [];
    this.cloneCount = 0;
    this.setProject(project);
  }

  setProject(project) {
    this.stopAll();
    this.project = project;
    this.stage = project.targets.find((t) => t.isStage);
    this.sprites = project.targets.filter((t) => !t.isStage);
    for (const t of project.targets) this.prepare(t);
    this.drawOrder = [...this.sprites];
  }

  // Runtime-only state lives under `_rt`, which the saver leaves out.
  prepare(t) {
    t._rt = t._rt || {};
    t._rt.effects = t._rt.effects || defaultEffects();
    t._rt.pen = t._rt.pen || defaultPen();
    t._rt.bubble = t._rt.bubble || null;
    t._rt.instrument = t._rt.instrument || 'piano';
    if (t.volume == null) t.volume = 100;
  }

  now() { return this.host.now(); }
  get timer() { return this.now() - this.timerStart; }

  // --- the frame ---------------------------------------------------------------------------

  step() {
    this.redraw = false;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      if (!this.threads.length) break;
      let progressed = false;
      for (const thread of [...this.threads]) {
        if (thread.done) continue;
        thread.waiting = false;
        const r = thread.gen.next();
        if (r.done) thread.done = true;
        if (!thread.waiting) progressed = true;
      }
      this.threads = this.threads.filter((t) => !t.done);
      if (this.redraw || !progressed) break;
    }
  }

  isRunning() { return this.threads.length > 0; }

  // --- starting and stopping ------------------------------------------------------------------

  greenFlag() {
    this.stopAll();
    this.timerStart = this.now();
    return this.startHats('event_whenflagclicked');
  }

  stopAll() {
    for (const t of this.threads || []) t.done = true;
    this.threads = [];
    if (this.drawOrder) {
      this.drawOrder = this.drawOrder.filter((t) => !t.isClone);
      for (const t of [this.stage, ...this.drawOrder]) {
        if (!t) continue;
        t._rt.effects = defaultEffects();
        t._rt.bubble = null;
        t._rt.pen.down = false;
      }
    }
    this.cloneCount = 0;
    this.asks = [];
    this.caption = null;
    this.host?.audio?.stopAll();
    this.host?.onAsk?.(null);
    this.redraw = true;
  }

  // Every target that runs scripts, front sprite first, the stage last: Scratch's order.
  executable() {
    return [...this.drawOrder].reverse().concat(this.stage ? [this.stage] : []);
  }

  startHats(type, match = null, only = null) {
    const started = [];
    const targets = only ? [only] : this.executable();
    for (const target of targets) {
      for (const script of this.scriptsOf(target)) {
        const top = script.blocks[0];
        if (!top || top.type !== type) continue;
        if (match && !match(top, target)) continue;
        started.push(this.startThread(target, script, RESTARTS.has(type)));
      }
    }
    return started.filter(Boolean);
  }

  scriptsOf(target) {
    return (target.isClone ? target.original.scripts : target.scripts) || [];
  }

  startThread(target, script, restart = true) {
    const existing = this.threads.find((t) => t.target === target && t.script === script && !t.done);
    if (existing) {
      if (!restart) return null;
      existing.done = true;
    }
    const thread = { target, script, done: false, waiting: false };
    const blocks = isHat(script.blocks[0]?.type) ? script.blocks.slice(1) : script.blocks;
    thread.gen = this.runStack(blocks, thread);
    const at = existing ? this.threads.indexOf(existing) : -1;
    if (at >= 0) this.threads[at] = thread;
    else this.threads.push(thread);
    return thread;
  }

  // Clicking a script in the editor runs it, or stops it if it is already running, as in Scratch.
  toggleScript(target, script) {
    const running = this.threads.find((t) => t.target === target && t.script === script && !t.done);
    if (running) { running.done = true; return false; }
    const top = script.blocks[0];
    const def = BLOCKS.get(top?.type);
    if (def && (def.shape === 'reporter' || def.shape === 'boolean')) {
      return { value: this.evalBlock(top, { target }) };
    }
    this.startThread(target, script, true);
    return true;
  }

  scriptRunning(target, script) {
    return this.threads.some((t) => t.target === target && t.script === script && !t.done);
  }

  // --- input ----------------------------------------------------------------------------------

  keyDown(name) {
    if (!name) return;
    this.keys.add(name);
    this.startHats('event_whenkeypressed', (b) => b.inputs.KEY.value === name || b.inputs.KEY.value === 'any');
  }

  keyUp(name) { this.keys.delete(name); }

  // The top visible sprite under a stage point, or the stage.
  targetAt(x, y) {
    for (let i = this.drawOrder.length - 1; i >= 0; i--) {
      const t = this.drawOrder[i];
      if (t.visible && containsPoint(t, x, y, this.host.maskFor)) return t;
    }
    return this.stage;
  }

  click(target) {
    if (!target) return;
    if (target.isStage) this.startHats('event_whenstageclicked', null, target);
    else this.startHats('event_whenthisspriteclicked', null, target);
  }

  answerQuestion(text) {
    const ask = this.asks[0];
    if (!ask) return;
    this.answer = String(text ?? '');
    ask.answered = true;
    if (ask.target && !ask.target.isStage) ask.target._rt.bubble = null;
    this.asks.shift();
    this.redraw = true;
    this.showNextAsk();
  }

  showNextAsk() {
    const ask = this.asks[0];
    if (!ask) { this.host.onAsk?.(null); return; }
    if (ask.target && !ask.target.isStage && ask.target.visible) {
      ask.target._rt.bubble = { text: ask.question, kind: 'say' };
      this.host.onAsk?.({ question: '', target: ask.target });
    } else {
      this.host.onAsk?.({ question: ask.question, target: ask.target });
    }
  }

  // --- names ----------------------------------------------------------------------------------

  spriteNamed(name) {
    return this.sprites.find((s) => s.name === name) || null;
  }

  // A variable, looked up the way Scratch does: the sprite's own first, then the stage's.
  varHolder(target, name) {
    const own = target.isClone ? target.variables : target.variables;
    if (own && Object.prototype.hasOwnProperty.call(own, name)) return own;
    if (this.stage?.variables && Object.prototype.hasOwnProperty.call(this.stage.variables, name)) return this.stage.variables;
    return null;
  }

  getVar(target, name) {
    const holder = this.varHolder(target, name);
    if (!holder) { this.warn(`There is no variable called "${name}".`); return 0; }
    return holder[name];
  }

  setVar(target, name, value) {
    const holder = this.varHolder(target, name);
    if (!holder) { this.warn(`There is no variable called "${name}".`); return; }
    holder[name] = value;
  }

  warn(message) {
    if (!this.warnings.includes(message)) this.warnings.push(message);
  }

  // --- the blocks ---------------------------------------------------------------------------

  *runStack(blocks, thread) {
    for (const block of blocks || []) {
      if (thread.done) return;
      yield* this.runBlock(block, thread);
    }
  }

  // A yield that hands the frame back without counting as progress: a script waiting for time
  // to pass or for something to come true.
  *idle(thread) {
    thread.waiting = true;
    yield;
  }

  input(block, name, thread) {
    const input = block.inputs?.[name];
    if (!input) return '';
    if (input.block) return this.evalBlock(input.block, thread);
    return input.value ?? '';
  }

  num(block, name, thread) { return toNumber(this.input(block, name, thread)); }
  bool(block, name, thread) {
    const input = block.inputs?.[name];
    if (!input?.block) return false;
    return toBoolean(this.evalBlock(input.block, thread));
  }

  *wait(thread, seconds) {
    const end = this.now() + Math.max(0, seconds);
    yield* this.idle(thread);
    while (this.now() < end && !thread.done) yield* this.idle(thread);
  }

  *runBlock(block, thread) {
    const t = thread.target;
    const rt = t._rt;
    switch (block.type) {
      // --- motion ---
      case 'motion_movesteps': {
        const steps = this.num(block, 'STEPS', thread);
        const rad = (t.direction * Math.PI) / 180;
        this.moveTo(t, t.x + steps * Math.sin(rad), t.y + steps * Math.cos(rad));
        return;
      }
      case 'motion_turnright': this.setDirection(t, t.direction + this.num(block, 'DEGREES', thread)); return;
      case 'motion_turnleft': this.setDirection(t, t.direction - this.num(block, 'DEGREES', thread)); return;
      case 'motion_goto': {
        const p = this.pointFor(block.inputs.TO.value, t);
        if (p) this.moveTo(t, p[0], p[1]);
        return;
      }
      case 'motion_gotoxy': this.moveTo(t, this.num(block, 'X', thread), this.num(block, 'Y', thread)); return;
      case 'motion_glideto': {
        const p = this.pointFor(block.inputs.TO.value, t);
        if (p) yield* this.glide(thread, this.num(block, 'SECS', thread), p[0], p[1]);
        return;
      }
      case 'motion_glidesecstoxy':
        yield* this.glide(thread, this.num(block, 'SECS', thread), this.num(block, 'X', thread), this.num(block, 'Y', thread));
        return;
      case 'motion_pointindirection': this.setDirection(t, this.num(block, 'DIRECTION', thread)); return;
      case 'motion_pointtowards': {
        const p = this.pointFor(block.inputs.TOWARDS.value, t, true);
        if (p) {
          const dx = p[0] - t.x;
          const dy = p[1] - t.y;
          if (dx || dy) this.setDirection(t, (Math.atan2(dx, dy) * 180) / Math.PI);
        }
        return;
      }
      case 'motion_changexby': this.moveTo(t, t.x + this.num(block, 'DX', thread), t.y); return;
      case 'motion_setx': this.moveTo(t, this.num(block, 'X', thread), t.y); return;
      case 'motion_changeyby': this.moveTo(t, t.x, t.y + this.num(block, 'DY', thread)); return;
      case 'motion_sety': this.moveTo(t, t.x, this.num(block, 'Y', thread)); return;
      case 'motion_ifonedgebounce': this.bounce(t); return;
      case 'motion_setrotationstyle': t.rotationStyle = block.inputs.STYLE.value; this.redraw = true; return;

      // --- looks ---
      case 'looks_say': this.say(t, this.input(block, 'MESSAGE', thread), 'say'); return;
      case 'looks_think': this.say(t, this.input(block, 'MESSAGE', thread), 'think'); return;
      case 'looks_sayforsecs':
      case 'looks_thinkforsecs': {
        const bubble = this.say(t, this.input(block, 'MESSAGE', thread), block.type === 'looks_sayforsecs' ? 'say' : 'think');
        yield* this.wait(thread, this.num(block, 'SECS', thread));
        if (rt.bubble === bubble) { rt.bubble = null; this.redraw = true; }
        return;
      }
      case 'looks_switchcostumeto': this.switchCostume(t, block.inputs.COSTUME.value); return;
      case 'looks_nextcostume': this.setCostume(t, (t.currentCostume + 1) % Math.max(1, this.costumes(t).length)); return;
      case 'looks_switchbackdropto': this.switchBackdrop(block.inputs.BACKDROP.value); return;
      case 'looks_nextbackdrop': this.switchBackdrop('next backdrop'); return;
      case 'looks_changesizeby': this.setSize(t, t.size + this.num(block, 'CHANGE', thread)); return;
      case 'looks_setsizeto': this.setSize(t, this.num(block, 'SIZE', thread)); return;
      case 'looks_changeeffectby': {
        const e = block.inputs.EFFECT.value;
        this.setEffect(t, e, (rt.effects[e] || 0) + this.num(block, 'CHANGE', thread));
        return;
      }
      case 'looks_seteffectto': this.setEffect(t, block.inputs.EFFECT.value, this.num(block, 'VALUE', thread)); return;
      case 'looks_cleargraphiceffects': rt.effects = defaultEffects(); this.redraw = true; return;
      case 'looks_show': t.visible = true; this.redraw = true; return;
      case 'looks_hide': t.visible = false; this.redraw = true; return;
      case 'looks_gotofrontback': this.layer(t, block.inputs.FRONT_BACK.value === 'front' ? Infinity : -Infinity); return;
      case 'looks_goforwardbackwardlayers': {
        const n = Math.round(this.num(block, 'NUM', thread));
        this.layer(t, block.inputs.FORWARD_BACKWARD.value === 'forward' ? n : -n, true);
        return;
      }
      case 'looks_showcaption': this.caption = toText(this.input(block, 'TEXT', thread)); this.redraw = true; return;
      case 'looks_hidecaption': this.caption = null; this.redraw = true; return;

      // --- sound ---
      case 'sound_play': this.playSound(t, block.inputs.SOUND.value); return;
      case 'sound_playuntildone': {
        const seconds = this.playSound(t, block.inputs.SOUND.value);
        yield* this.wait(thread, seconds);
        return;
      }
      case 'sound_stopallsounds': this.host.audio?.stopAll(); return;
      case 'sound_playnote': {
        const midi = Math.max(0, Math.min(130, this.num(block, 'NOTE', thread)));
        const seconds = Math.max(0, Math.min(100, this.num(block, 'BEATS', thread)));
        this.host.audio?.note(t, midi, seconds, rt.instrument);
        yield* this.wait(thread, seconds);
        return;
      }
      case 'sound_setinstrument': rt.instrument = block.inputs.INSTRUMENT.value; return;
      case 'sound_changevolumeby': t.volume = Math.max(0, Math.min(100, t.volume + this.num(block, 'VOLUME', thread))); this.host.audio?.volumeChanged?.(t); return;
      case 'sound_setvolumeto': t.volume = Math.max(0, Math.min(100, this.num(block, 'VOLUME', thread))); this.host.audio?.volumeChanged?.(t); return;

      // --- events ---
      case 'event_broadcast': this.broadcast(block.inputs.BROADCAST.value); return;
      case 'event_broadcastandwait': {
        const started = this.broadcast(block.inputs.BROADCAST.value);
        yield* this.idle(thread);
        while (started.some((s) => !s.done) && !thread.done) yield* this.idle(thread);
        return;
      }

      // --- control ---
      case 'control_wait': yield* this.wait(thread, this.num(block, 'DURATION', thread)); return;
      case 'control_repeat': {
        const times = Math.round(this.num(block, 'TIMES', thread));
        for (let i = 0; i < times && !thread.done; i++) {
          yield* this.runStack(block.substack, thread);
          yield;
        }
        return;
      }
      case 'control_forever':
        while (!thread.done) {
          yield* this.runStack(block.substack, thread);
          yield;
        }
        return;
      case 'control_if':
        if (this.bool(block, 'CONDITION', thread)) yield* this.runStack(block.substack, thread);
        return;
      case 'control_if_else':
        if (this.bool(block, 'CONDITION', thread)) yield* this.runStack(block.substack, thread);
        else yield* this.runStack(block.substack2, thread);
        return;
      case 'control_wait_until':
        while (!this.bool(block, 'CONDITION', thread) && !thread.done) yield* this.idle(thread);
        return;
      case 'control_repeat_until':
        while (!this.bool(block, 'CONDITION', thread) && !thread.done) {
          yield* this.runStack(block.substack, thread);
          yield;
        }
        return;
      case 'control_stop': {
        const what = block.inputs.STOP_OPTION.value;
        if (what === 'all') this.stopAll();
        else if (what === 'this script') thread.done = true;
        else for (const other of this.threads) if (other.target === t && other !== thread) other.done = true;
        return;
      }
      case 'control_create_clone_of': {
        const which = block.inputs.CLONE_OPTION.value;
        const source = which === '_myself_' ? t : this.spriteNamed(which);
        if (source && !source.isStage) this.makeClone(source);
        return;
      }
      case 'control_delete_this_clone':
        if (t.isClone) { this.deleteClone(t); thread.done = true; }
        return;

      // --- sensing ---
      case 'sensing_askandwait': {
        const ask = { question: toText(this.input(block, 'QUESTION', thread)), target: t, answered: false };
        this.asks.push(ask);
        if (this.asks.length === 1) this.showNextAsk();
        yield* this.idle(thread);
        while (!ask.answered && !thread.done) yield* this.idle(thread);
        return;
      }
      case 'sensing_setdragmode': t.draggable = block.inputs.DRAG_MODE.value === 'draggable'; return;
      case 'sensing_resettimer': this.timerStart = this.now(); return;

      // --- variables ---
      case 'data_setvariableto': this.setVar(t, block.inputs.VARIABLE.value, this.input(block, 'VALUE', thread)); this.redraw = true; return;
      case 'data_changevariableby': {
        const name = block.inputs.VARIABLE.value;
        this.setVar(t, name, toNumber(this.getVar(t, name)) + this.num(block, 'VALUE', thread));
        this.redraw = true;
        return;
      }
      case 'data_showvariable':
      case 'data_hidevariable':
        this.showMonitor(t, block.inputs.VARIABLE.value, block.type === 'data_showvariable');
        return;

      // --- pen ---
      case 'pen_clear': this.host.pen?.clear(); this.redraw = true; return;
      case 'pen_stamp': this.host.pen?.stamp(t); this.redraw = true; return;
      case 'pen_penDown':
        rt.pen.down = true;
        this.host.pen?.dot(t.x, t.y, this.penColour(t), rt.pen.size);
        this.redraw = true;
        return;
      case 'pen_penUp': rt.pen.down = false; return;
      case 'pen_setPenColorToColor': this.setPenHex(t, toText(this.input(block, 'COLOR', thread))); return;
      case 'pen_changePenColorParamBy':
      case 'pen_setPenColorParamTo': {
        const which = { color: 'h', saturation: 's', brightness: 'v', transparency: 'a' }[block.inputs.COLOR_PARAM.value];
        if (!which) return;
        const n = this.num(block, 'VALUE', thread);
        const next = block.type === 'pen_changePenColorParamBy' ? rt.pen[which] + n : n;
        rt.pen[which] = which === 'h' ? ((next % 100) + 100) % 100 : Math.max(0, Math.min(100, next));
        return;
      }
      case 'pen_changePenSizeBy': rt.pen.size = Math.max(1, Math.min(1200, rt.pen.size + this.num(block, 'SIZE', thread))); return;
      case 'pen_setPenSizeTo': rt.pen.size = Math.max(1, Math.min(1200, this.num(block, 'SIZE', thread))); return;

      default: {
        // A reporter sitting loose in a stack does nothing, as in Scratch. A type nobody knows is
        // skipped with one warning per run rather than stopping the whole project.
        const def = BLOCKS.get(block.type);
        if (!def) this.warn(`Skipped an unknown block "${block.type}".`);
      }
    }
  }

  evalBlock(block, thread) {
    const t = thread.target;
    switch (block.type) {
      case 'motion_xposition': return round(t.x);
      case 'motion_yposition': return round(t.y);
      case 'motion_direction': return t.direction;
      case 'looks_costumenumbername': {
        const c = costumeOf(t);
        return block.inputs.NUMBER_NAME.value === 'name' ? (c?.name ?? '') : t.currentCostume + 1;
      }
      case 'looks_backdropnumbername': {
        const c = costumeOf(this.stage);
        return block.inputs.NUMBER_NAME.value === 'name' ? (c?.name ?? '') : this.stage.currentCostume + 1;
      }
      case 'looks_size': return Math.round(t.size);
      case 'sound_volume': return t.volume;
      case 'sensing_touchingobject': return this.touching(t, block.inputs.TOUCHINGOBJECTMENU.value);
      case 'sensing_distanceto': {
        const p = this.pointFor(block.inputs.DISTANCETOMENU.value, t, true);
        if (!p) return 10000;
        return Math.hypot(p[0] - t.x, p[1] - t.y);
      }
      case 'sensing_answer': return this.answer;
      case 'sensing_keypressed': {
        const k = block.inputs.KEY_OPTION.value;
        return k === 'any' ? this.keys.size > 0 : this.keys.has(k);
      }
      case 'sensing_mousedown': return this.mouse.down;
      case 'sensing_mousex': return Math.round(this.mouse.x);
      case 'sensing_mousey': return Math.round(this.mouse.y);
      case 'sensing_timer': return Math.round(this.timer * 1000) / 1000;
      case 'sensing_of': return this.propertyOf(block.inputs.PROPERTY.value, block.inputs.OBJECT.value);
      case 'sensing_current': {
        const d = new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1, date: d.getDate(), 'day of week': d.getDay() + 1,
          hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() }[block.inputs.CURRENTMENU.value] ?? 0;
      }
      case 'operator_add': return this.num(block, 'NUM1', thread) + this.num(block, 'NUM2', thread);
      case 'operator_subtract': return this.num(block, 'NUM1', thread) - this.num(block, 'NUM2', thread);
      case 'operator_multiply': return this.num(block, 'NUM1', thread) * this.num(block, 'NUM2', thread);
      case 'operator_divide': return this.num(block, 'NUM1', thread) / this.num(block, 'NUM2', thread);
      case 'operator_random': return pickRandom(this.input(block, 'FROM', thread), this.input(block, 'TO', thread), this.host.random);
      case 'operator_gt': return compare(this.input(block, 'OPERAND1', thread), this.input(block, 'OPERAND2', thread)) > 0;
      case 'operator_lt': return compare(this.input(block, 'OPERAND1', thread), this.input(block, 'OPERAND2', thread)) < 0;
      case 'operator_equals': return compare(this.input(block, 'OPERAND1', thread), this.input(block, 'OPERAND2', thread)) === 0;
      case 'operator_and': return this.bool(block, 'OPERAND1', thread) && this.bool(block, 'OPERAND2', thread);
      case 'operator_or': return this.bool(block, 'OPERAND1', thread) || this.bool(block, 'OPERAND2', thread);
      case 'operator_not': return !this.bool(block, 'OPERAND', thread);
      case 'operator_join': return toText(this.input(block, 'STRING1', thread)) + toText(this.input(block, 'STRING2', thread));
      case 'operator_letter_of': {
        const s = toText(this.input(block, 'STRING', thread));
        const i = Math.floor(this.num(block, 'LETTER', thread)) - 1;
        return i >= 0 && i < s.length ? s[i] : '';
      }
      case 'operator_length': return toText(this.input(block, 'STRING', thread)).length;
      case 'operator_contains':
        return toText(this.input(block, 'STRING1', thread)).toLowerCase().includes(toText(this.input(block, 'STRING2', thread)).toLowerCase());
      case 'operator_mod': {
        const n = this.num(block, 'NUM1', thread);
        const m = this.num(block, 'NUM2', thread);
        const r = n % m;
        return r / m < 0 ? r + m : r;
      }
      case 'operator_round': return Math.round(this.num(block, 'NUM', thread));
      case 'operator_mathop': return mathop(block.inputs.OPERATOR.value, this.num(block, 'NUM', thread));
      case 'data_variable': return this.getVar(t, block.inputs.VARIABLE.value);
      default: return '';
    }
  }

  // --- what the blocks do ---------------------------------------------------------------------

  moveTo(t, x, y) {
    if (t.isStage) return;
    const ox = t.x;
    const oy = t.y;
    t.x = x;
    t.y = y;
    fence(t, this.host.maskFor);
    if (t._rt.pen.down && (t.x !== ox || t.y !== oy)) this.host.pen?.line(ox, oy, t.x, t.y, this.penColour(t), t._rt.pen.size);
    this.redraw = true;
  }

  setDirection(t, d) {
    if (t.isStage) return;
    t.direction = wrapDirection(toNumber(d));
    this.redraw = true;
  }

  setSize(t, size) {
    if (t.isStage) return;
    const c = costumeOf(t);
    const w = (c?.width || 100) / (c?.resolution || 1);
    const h = (c?.height || 100) / (c?.resolution || 1);
    const min = Math.min(1, Math.max(5 / w, 5 / h)) * 100;
    const max = Math.min((1.5 * 480) / w, (1.5 * 360) / h) * 100;
    t.size = Math.max(min, Math.min(max, toNumber(size)));
    this.redraw = true;
  }

  setEffect(t, effect, value) {
    if (!(effect in t._rt.effects)) return;
    let v = toNumber(value);
    if (effect === 'ghost') v = Math.max(0, Math.min(100, v));
    if (effect === 'brightness') v = Math.max(-100, Math.min(100, v));
    if (effect === 'pixelate') v = Math.max(0, v);
    t._rt.effects[effect] = v;
    this.redraw = true;
  }

  *glide(thread, seconds, x, y) {
    const t = thread.target;
    const start = this.now();
    const ox = t.x;
    const oy = t.y;
    if (seconds <= 0) { this.moveTo(t, x, y); return; }
    yield* this.idle(thread);
    for (;;) {
      if (thread.done) return;
      const k = (this.now() - start) / seconds;
      if (k >= 1) { this.moveTo(t, x, y); return; }
      this.moveTo(t, ox + (x - ox) * k, oy + (y - oy) * k);
      yield;
    }
  }

  // A menu target as a point: a sprite's position, the mouse, or a random point on the stage.
  pointFor(value, from, towards = false) {
    if (value === '_mouse_') return [this.mouse.x, this.mouse.y];
    if (value === '_random_') {
      if (towards) return null;
      return [Math.round((this.host.random() - 0.5) * 480), Math.round((this.host.random() - 0.5) * 360)];
    }
    const s = this.spriteNamed(value);
    if (!s || s === from) return null;
    return [s.x, s.y];
  }

  bounce(t) {
    const b = boundsOf(t, this.host.maskFor);
    const dl = Math.max(0, HALF_W + b.left);
    const dt = Math.max(0, HALF_H - b.top);
    const dr = Math.max(0, HALF_W - b.right);
    const db = Math.max(0, HALF_H + b.bottom);
    let nearest = null;
    let min = Infinity;
    for (const [edge, d] of [['left', dl], ['top', dt], ['right', dr], ['bottom', db]]) {
      if (d < min) { min = d; nearest = edge; }
    }
    if (min > 0) return;
    const rad = ((90 - t.direction) * Math.PI) / 180;
    let dx = Math.cos(rad);
    let dy = -Math.sin(rad);
    if (nearest === 'left') dx = Math.max(0.2, Math.abs(dx));
    else if (nearest === 'top') dy = Math.max(0.2, Math.abs(dy));
    else if (nearest === 'right') dx = 0 - Math.max(0.2, Math.abs(dx));
    else dy = 0 - Math.max(0.2, Math.abs(dy));
    this.setDirection(t, (Math.atan2(dy, dx) * 180) / Math.PI + 90);
    // Move back fully onto the stage.
    const nb = boundsOf(t, this.host.maskFor);
    let mx = 0;
    let my = 0;
    if (nb.left < -HALF_W) mx = -HALF_W - nb.left;
    if (nb.right > HALF_W) mx = HALF_W - nb.right;
    if (nb.bottom < -HALF_H) my = -HALF_H - nb.bottom;
    if (nb.top > HALF_H) my = HALF_H - nb.top;
    this.moveTo(t, t.x + mx, t.y + my);
  }

  say(t, message, kind) {
    const text = toText(message);
    t._rt.bubble = text === '' ? null : { text, kind };
    this.redraw = true;
    return t._rt.bubble;
  }

  costumes(t) {
    return (t.isClone ? t.original.costumes : t.costumes) || [];
  }

  setCostume(t, i) {
    const n = this.costumes(t).length;
    if (!n) return;
    t.currentCostume = ((Math.round(i) % n) + n) % n;
    this.redraw = true;
  }

  switchCostume(t, value) {
    const list = this.costumes(t);
    const byName = list.findIndex((c) => c.name === value);
    if (byName >= 0) { this.setCostume(t, byName); return; }
    if (value === 'next costume') { this.setCostume(t, t.currentCostume + 1); return; }
    if (value === 'previous costume') { this.setCostume(t, t.currentCostume - 1); return; }
    const n = Number(value);
    if (value !== '' && Number.isFinite(n)) this.setCostume(t, n - 1);
  }

  switchBackdrop(value) {
    const s = this.stage;
    const list = s.costumes || [];
    if (!list.length) return;
    let i = list.findIndex((c) => c.name === value);
    if (i < 0) {
      if (value === 'next backdrop') i = (s.currentCostume + 1) % list.length;
      else if (value === 'previous backdrop') i = (s.currentCostume - 1 + list.length) % list.length;
      else if (value === 'random backdrop') i = Math.floor(this.host.random() * list.length);
      else if (Number.isFinite(Number(value)) && value !== '') i = ((Math.round(Number(value)) - 1) % list.length + list.length) % list.length;
      else return;
    }
    s.currentCostume = i;
    this.redraw = true;
    const name = list[i].name;
    this.host.onBackdrop?.(name);
    this.startHats('event_whenbackdropswitchesto', (b) => b.inputs.BACKDROP.value === name);
  }

  layer(t, n, relative = false) {
    if (t.isStage) return;
    const order = this.drawOrder;
    const at = order.indexOf(t);
    if (at < 0) return;
    order.splice(at, 1);
    let to = relative ? at + n : (n > 0 ? order.length : 0);
    to = Math.max(0, Math.min(order.length, to));
    order.splice(to, 0, t);
    this.redraw = true;
  }

  playSound(t, value) {
    const list = (t.isClone ? t.original.sounds : t.sounds) || [];
    let sound = list.find((s) => s.name === value);
    if (!sound && value !== '' && Number.isFinite(Number(value))) sound = list[((Math.round(Number(value)) - 1) % list.length + list.length) % list.length];
    if (!sound) return 0;
    return this.host.audio?.play(t, sound) ?? 0;
  }

  broadcast(message) {
    return this.startHats('event_whenbroadcastreceived', (b) => b.inputs.BROADCAST.value === message);
  }

  touching(t, what) {
    if (t.isStage || !t.visible) return false;
    if (what === '_mouse_') return containsPoint(t, this.mouse.x, this.mouse.y, this.host.maskFor);
    if (what === '_edge_') return touchesEdge(t, this.host.maskFor);
    // Touching a sprite means touching the original or any of its clones.
    for (const other of this.drawOrder) {
      if (other === t || !other.visible) continue;
      const name = other.isClone ? other.original.name : other.name;
      if (name !== what) continue;
      if (spritesTouch(t, other, this.host.maskFor)) return true;
    }
    return false;
  }

  propertyOf(property, object) {
    if (object === '_stage_') {
      const s = this.stage;
      if (property === 'backdrop #') return s.currentCostume + 1;
      if (property === 'backdrop name') return costumeOf(s)?.name ?? '';
      if (property === 'volume') return s.volume;
      return s.variables?.[property] ?? 0;
    }
    const sp = this.spriteNamed(object);
    if (!sp) return 0;
    switch (property) {
      case 'x position': return round(sp.x);
      case 'y position': return round(sp.y);
      case 'direction': return sp.direction;
      case 'costume #': return sp.currentCostume + 1;
      case 'costume name': return costumeOf(sp)?.name ?? '';
      case 'size': return Math.round(sp.size);
      case 'volume': return sp.volume;
      default: return sp.variables?.[property] ?? 0;
    }
  }

  // --- clones ---------------------------------------------------------------------------------

  makeClone(source) {
    if (this.cloneCount >= CLONE_LIMIT) {
      this.warn(`A project can have ${CLONE_LIMIT} clones at once, so "create clone" did nothing. Delete clones you no longer need.`);
      return null;
    }
    const original = source.isClone ? source.original : source;
    const clone = {
      id: `${original.id}:clone${Math.random().toString(36).slice(2, 8)}`,
      isClone: true,
      original,
      name: original.name,
      x: source.x, y: source.y, direction: source.direction, size: source.size,
      visible: source.visible, rotationStyle: source.rotationStyle, draggable: source.draggable,
      currentCostume: source.currentCostume, volume: source.volume,
      costumes: original.costumes, sounds: original.sounds,
      variables: { ...(source.variables || {}) },
      _rt: {
        effects: { ...source._rt.effects }, pen: { ...source._rt.pen }, bubble: null, instrument: source._rt.instrument,
      },
    };
    // A clone starts just behind the sprite it was cloned from.
    const at = this.drawOrder.indexOf(source);
    this.drawOrder.splice(Math.max(0, at), 0, clone);
    this.cloneCount++;
    this.redraw = true;
    this.startHats('control_start_as_clone', null, clone);
    return clone;
  }

  deleteClone(clone) {
    if (!clone.isClone) return;
    const at = this.drawOrder.indexOf(clone);
    if (at >= 0) this.drawOrder.splice(at, 1);
    for (const th of this.threads) if (th.target === clone) th.done = true;
    this.cloneCount = Math.max(0, this.cloneCount - 1);
    this.redraw = true;
  }

  // --- monitors and pen colour ----------------------------------------------------------------

  showMonitor(t, name, visible) {
    const holder = this.varHolder(t, name);
    if (!holder) return;
    const owner = holder === this.stage.variables ? this.stage : (t.isClone ? t.original : t);
    const id = `var:${owner.isStage ? '' : owner.id}:${name}`;
    const list = this.project.monitors;
    let m = list.find((x) => x.id === id);
    if (!m) {
      m = { id, kind: 'variable', target: owner.isStage ? null : owner.id, name, x: 5, y: 5 + list.length * 28, visible };
      list.push(m);
    }
    m.visible = visible;
    this.redraw = true;
    this.host.onChange?.('monitors');
  }

  monitorValue(m) {
    if (m.kind === 'variable') {
      const owner = m.target ? this.sprites.find((s) => s.id === m.target) : this.stage;
      return owner?.variables?.[m.name] ?? '';
    }
    const owner = m.target ? this.sprites.find((s) => s.id === m.target) : this.stage;
    if (!owner) return '';
    const block = { type: m.opcode, inputs: Object.fromEntries(Object.entries(m.params || {}).map(([k, v]) => [k, { value: v }])) };
    return this.evalBlock(block, { target: owner });
  }

  penColour(t) {
    const p = t._rt.pen;
    const [r, g, b] = hsvToRgb(p.h / 100, p.s / 100, p.v / 100);
    return `rgba(${r},${g},${b},${1 - p.a / 100})`;
  }

  setPenHex(t, hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return;
    const n = parseInt(m[1], 16);
    const [h, s, v] = rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
    Object.assign(t._rt.pen, { h: h * 100, s: s * 100, v: v * 100 });
  }
}

function round(n) { return Math.round(n * 1e6) / 1e6; }

function mathop(op, n) {
  const rad = (n * Math.PI) / 180;
  switch (op) {
    case 'abs': return Math.abs(n);
    case 'floor': return Math.floor(n);
    case 'ceiling': return Math.ceil(n);
    case 'sqrt': return Math.sqrt(n);
    // Trig is in degrees, and sin 180 is 0 rather than 1.2e-16.
    case 'sin': return Math.round(Math.sin(rad) * 1e10) / 1e10;
    case 'cos': return Math.round(Math.cos(rad) * 1e10) / 1e10;
    case 'tan': {
      const m = ((n % 360) + 360) % 360;
      if (m === 90) return Infinity;
      if (m === 270) return -Infinity;
      return Math.round(Math.tan(rad) * 1e10) / 1e10;
    }
    case 'asin': return (Math.asin(n) * 180) / Math.PI;
    case 'acos': return (Math.acos(n) * 180) / Math.PI;
    case 'atan': return (Math.atan(n) * 180) / Math.PI;
    case 'ln': return Math.log(n);
    case 'log': return Math.log10(n);
    case 'e ^': return Math.exp(n);
    case '10 ^': return 10 ** n;
    default: return 0;
  }
}

export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max ? d / max : 0, max];
}
