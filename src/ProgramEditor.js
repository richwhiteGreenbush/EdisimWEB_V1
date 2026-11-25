import {
  CATEGORIES, BLOCK_DEFS, PALETTE_ORDER, createBlockInstance, cloneBlockTree,
  cleanVariableName, isVariableRef, variablesIn, sharedVariablesIn,
} from './BlockDefs.js';
import { highlightJs } from './JsProgram.js';
import { recordHasProgram } from './ProgramManager.js';
import { countProgram } from './BuildStats.js';
import { compile, printBlocks, convert, LEVELS } from './textcode/index.js';
import { highlight } from './textcode/highlight.js';
import { completions } from './textcode/complete.js';

const DROP_ZONE_MAX_DY = 260; // px -- beyond this, dropping means "delete", not "insert far away"
const DROP_ZONE_X_SLOP = 24; // px of leftward slop so a slightly-off pointer still hits a zone
const ANALYZE_DELAY = 250; // ms after the last keystroke before the text is checked again
const MAX_CARDS = 3; // VisualHedy's rule: the first problem prominent, never a wall of them
const INDENT = '    ';

// What sits under the editor at each level: the level's whole idea in one line.
const LEVEL_HINTS = {
  1: 'Basic Beginner: one command per line, like `move forward 10 feet`. Push lines in by 4 spaces to put them inside `repeat`, `if` or `when`.',
  2: 'Basic Pro: text goes in "quotes", `=` sets a number (`side = 10`), and checks use `>`, `<` and `==`.',
};

// A block tree as the runner sees it: types and params, no ids. Two programs that compare
// equal here run identically, which is how the editor knows a student's text still matches
// the blocks (and so its # notes can be kept).
function shape(blocks) {
  return JSON.stringify((function walk(list) {
    return (list || []).map((b) => [b.type, b.params, b.children ? walk(b.children) : null]);
  })(blocks));
}

// The view the editor is showing: 'blocks', or a text level (1 or 2). 'js' is the read-only
// view of a program written in JavaScript before text coding replaced it: it still RUNS (the
// runner is kept for every world that has one), but nothing new is written in it.
export class ProgramEditor {
  constructor({ registry, worldStore, programManager, menu, playIconManager }) {
    this.registry = registry;
    this.worldStore = worldStore;
    this.programManager = programManager;
    this.menu = menu;
    this.playIconManager = playIconManager;

    this.activeId = null;
    this.tree = [];
    this.drag = null; // { block, ghostEl, pointerId, dropZone }

    // The blocks and the text live side by side and SWITCHING VIEWS NEVER DESTROYS EITHER.
    // `tree` is the blocks; `text` is what the student typed at `textLevel`. Text is checked
    // as it is typed and always compiles to blocks before it can be saved, so the blocks are
    // what runs and the text is what the student wrote, # notes and all.
    this.view = 'blocks';
    this.text = '';
    this.textLevel = 1;
    this.legacyJs = '';
    this.analysis = null;
    this.analyzeTimer = 0;
    this.complete = null; // { from, to, items, index }

    this.onDragMove = this.onDragMove.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);

    this.buildDom();
  }

  buildDom() {
    this.overlay = document.createElement('div');
    this.overlay.id = 'program-overlay';
    this.overlay.hidden = true;

    const panel = document.createElement('div');
    panel.id = 'program-panel';
    this.panelEl = panel;

    const titleRow = document.createElement('div');
    titleRow.id = 'program-title-row';

    this.titleEl = document.createElement('div');
    this.titleEl.id = 'program-title';
    this.titleEl.textContent = 'Program this object';

    // Blocks, then the two text levels, as one row of labelled buttons: every option stays
    // visible, and the active one wears its colour. VisualHedy calls this the Level menu.
    const toggle = document.createElement('div');
    toggle.id = 'program-mode-toggle';
    toggle.setAttribute('role', 'group');
    toggle.setAttribute('aria-label', 'How to write this program');
    this.modeButtons = {};
    for (const [view, label, title] of [
      ['blocks', 'Blocks', 'Drag blocks to build a program'],
      [1, LEVELS[1].name, 'Type the program, in words that match the blocks'],
      [2, LEVELS[2].name, 'Type the program with quotes, = and symbols'],
    ]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pe-mode-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', () => this.setView(view));
      this.modeButtons[view] = btn;
      toggle.appendChild(btn);
    }
    titleRow.append(this.titleEl, toggle);

    const body = document.createElement('div');
    body.id = 'program-body';

    this.paletteEl = document.createElement('div');
    this.paletteEl.id = 'program-palette';
    this.buildPalette();

    this.workspaceEl = document.createElement('div');
    this.workspaceEl.id = 'program-workspace';

    this.buildTextPane();

    body.append(this.paletteEl, this.workspaceEl, this.textPane);

    const actions = document.createElement('div');
    actions.id = 'program-actions';
    const clearBtn = this.actionButton('Clear', () => this.clearAll());
    const cancelBtn = this.actionButton('Cancel', () => this.close());
    this.saveBtn = this.actionButton('Save', () => this.save());
    this.saveBtn.classList.add('menu-link');
    actions.append(clearBtn, cancelBtn, this.saveBtn);

    // The question asked before a level switch rewrites the program. Inside the panel, never
    // window.confirm(), which stops the whole world while it waits.
    this.confirmEl = document.createElement('div');
    this.confirmEl.id = 'program-confirm';
    this.confirmEl.hidden = true;

    // Names of the world's objects, offered by the `tell` block's object field.
    this.objectList = document.createElement('datalist');
    this.objectList.id = 'pe-object-names';

    panel.append(titleRow, body, actions, this.confirmEl, this.objectList);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.dropIndicator = document.createElement('div');
    this.dropIndicator.id = 'program-drop-indicator';
    this.dropIndicator.hidden = true;
    this.overlay.appendChild(this.dropIndicator);
  }

  // The text editor: line numbers, then a transparent textarea stacked exactly over a
  // highlighted <pre>. The textarea owns the text, the caret and the scrollbars; the <pre>
  // under it owns the colours and the underlines. Every metric -- font, size, line height,
  // padding, tab size, and `white-space: pre` -- is identical on both, or the caret sits beside
  // the wrong character. Lines do not wrap, which is what lets the gutter and the autocomplete
  // popup work out where a line is by arithmetic.
  buildTextPane() {
    this.textPane = document.createElement('div');
    this.textPane.id = 'program-text-pane';
    this.textPane.hidden = true;

    this.legacyNote = document.createElement('div');
    this.legacyNote.className = 'pe-legacy-note';
    this.legacyNote.hidden = true;
    this.legacyNote.textContent = 'This object runs a program written in JavaScript, and it keeps running. '
      + 'Edusim programs are now written in Blocks or typed at Basic Beginner or Basic Pro. '
      + 'Pick one above to write a new program. Saving it replaces this one.';

    const editor = document.createElement('div');
    editor.className = 'pe-text-editor';

    this.gutter = document.createElement('pre');
    this.gutter.className = 'pe-gutter';
    this.gutter.setAttribute('aria-hidden', 'true');

    const stack = document.createElement('div');
    stack.className = 'pe-text-stack';
    this.textStack = stack;

    this.textHighlight = document.createElement('pre');
    this.textHighlight.id = 'program-text-highlight';
    this.textHighlightCode = document.createElement('code');
    this.textHighlight.appendChild(this.textHighlightCode);

    this.textInput = document.createElement('textarea');
    this.textInput.id = 'program-text-input';
    this.textInput.spellcheck = false;
    this.textInput.autocapitalize = 'off';
    this.textInput.wrap = 'off';
    this.textInput.setAttribute('autocomplete', 'off');
    this.textInput.setAttribute('aria-label', 'Program text');
    this.textInput.addEventListener('input', () => this.onTextInput());
    this.textInput.addEventListener('scroll', () => this.syncScroll());
    this.textInput.addEventListener('keydown', (e) => this.onTextKey(e));
    this.textInput.addEventListener('blur', () => setTimeout(() => this.hideComplete(), 120));
    this.textInput.addEventListener('click', () => this.hideComplete());

    this.completeEl = document.createElement('ul');
    this.completeEl.className = 'pe-complete';
    this.completeEl.hidden = true;
    this.completeEl.setAttribute('role', 'listbox');

    // One character of the editor's font, measured once it is on screen, for placing the popup.
    this.measureEl = document.createElement('span');
    this.measureEl.className = 'pe-measure';
    this.measureEl.textContent = 'MMMMMMMMMM';

    stack.append(this.textHighlight, this.textInput, this.completeEl, this.measureEl);
    editor.append(this.gutter, stack);

    this.problemsEl = document.createElement('div');
    this.problemsEl.id = 'program-problems';
    this.problemsEl.setAttribute('aria-live', 'polite');

    this.levelHint = document.createElement('div');
    this.levelHint.className = 'pe-text-hint';

    this.textPane.append(this.legacyNote, editor, this.problemsEl, this.levelHint);
  }

  actionButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  buildPalette() {
    for (const categoryKey of ['control', 'motion', 'look', 'math']) {
      const category = CATEGORIES[categoryKey];
      const section = document.createElement('div');
      section.className = 'pe-palette-section';

      const heading = document.createElement('div');
      heading.className = 'pe-palette-heading';
      heading.textContent = category.name;
      section.appendChild(heading);

      for (const type of PALETTE_ORDER) {
        const def = BLOCK_DEFS[type];
        if (def.category !== categoryKey) continue;
        const el = this.renderBlockChrome(type, createBlockInstance(type).params, { paletteOnly: true });
        el.classList.add('pe-palette-block');
        el.addEventListener('pointerdown', (e) => this.onPaletteDragStart(e, type));
        section.appendChild(el);
      }

      this.paletteEl.appendChild(section);
    }
  }

  // --- opening / closing -----------------------------------------------------

  open(id) {
    const item = this.registry.get(id);
    if (!item) return;
    this.activeId = id;
    const record = item.record || {};
    this.tree = cloneBlockTree(record.program || []);
    this.text = typeof record.programText === 'string' ? record.programText : '';
    this.textLevel = record.programLevel === 2 ? 2 : 1;
    this.legacyJs = record.programMode === 'js' && record.programJs?.trim() ? record.programJs : '';
    if (this.legacyJs) this.view = 'js';
    else if (record.programMode === 'text') this.view = this.textLevel;
    else this.view = 'blocks';

    this.titleEl.textContent = record.objectName ? `Program: ${record.objectName}` : 'Program this object';
    this.objectList.textContent = '';
    for (const name of this.objectNames()) {
      const opt = document.createElement('option');
      opt.value = name;
      this.objectList.appendChild(opt);
    }
    this.hideConfirm();
    this.overlay.hidden = false;
    this.renderWorkspace();
    this.renderView();
  }

  close() {
    this.cancelDrag();
    this.hideComplete();
    this.hideConfirm();
    clearTimeout(this.analyzeTimer);
    this.overlay.hidden = true;
    this.activeId = null;
    this.tree = [];
  }

  clearAll() {
    // Clears the view being LOOKED AT, never both: emptying the text must not silently delete
    // the block program, and vice versa.
    if (this.view === 'js') return;
    if (this.view === 'blocks') {
      this.tree = [];
      this.renderWorkspace();
      return;
    }
    this.text = '';
    this.textInput.value = '';
    this.analyzeNow();
  }

  // Every object in this world that has a name (`record.objectName`).
  objectNames() {
    const names = [];
    for (const item of this.registry?.items?.values?.() || []) if (item.record?.objectName) names.push(item.record.objectName);
    return names;
  }

  // Names other objects share, which a program may read without setting.
  sharedNames() {
    const names = new Set();
    for (const [id, item] of this.registry?.items || []) {
      if (id === this.activeId) continue;
      sharedVariablesIn(item.record?.program, names);
    }
    return names;
  }

  compileOpts() {
    return { objectNames: this.objectNames(), knownNames: this.sharedNames() };
  }

  // Is the text still a faithful copy of the blocks? Then its # notes can be kept.
  textMatchesTree() {
    if (!this.text.trim()) return false;
    const r = compile(this.text, this.textLevel, this.compileOpts());
    return r.ok && shape(r.blocks) === shape(this.tree);
  }

  // --- switching views ---------------------------------------------------------

  async setView(view) {
    if (view === this.view) return;
    this.hideComplete();
    const from = this.view;

    if (from === 'js') {
      const ok = await this.askConfirm(
        'Start a new program for this object? Its JavaScript keeps running until you Save the new one.',
        'Start a new one',
      );
      if (!ok) return;
      this.legacyJs = '';
    }

    if (from === 1 || from === 2) {
      this.text = this.textInput.value;
      const r = compile(this.text, from, this.compileOpts());
      if (!r.ok) {
        this.analyzeNow();
        this.menu?.toast('Fix the problems marked in red first, then switch.', { tone: 'error' });
        return;
      }
      if (view === 'blocks') {
        this.tree = r.blocks;
        this.textLevel = from;
        this.view = 'blocks';
        this.renderWorkspace();
        this.renderView();
        return;
      }
      // Up or down a level: a rewrite of what the student typed, so ask first (VisualHedy's rule).
      if (this.text.trim()) {
        const up = view === 2;
        const ok = await this.askConfirm(
          up
            ? 'Rewrite this program in Basic Pro? Text gets "quotes", numbers get `=`, and unit words go. Your # notes stay.'
            : 'Rewrite this program in Basic Beginner? It goes back to words, like `set x to 5`. Your # notes stay.',
          up ? 'Rewrite in Basic Pro' : 'Rewrite in Basic Beginner',
        );
        if (!ok) return;
        const result = convert(this.text, from, view, this.compileOpts());
        if (!result.ok) return;
        this.text = result.text;
        for (const note of result.notes) this.menu?.toast(note.detail);
      }
      this.tree = r.blocks;
      this.textLevel = view;
      this.view = view;
      this.renderView();
      return;
    }

    // From blocks (or a fresh start from JavaScript) to text: printed from the blocks, which
    // can always be done, and needs no question because nothing typed is replaced. If the
    // text the student typed last time still matches these blocks, THAT text comes back,
    // # notes and all, converted if they now want the other level.
    if (view === 1 || view === 2) {
      let text = null;
      if (this.textMatchesTree()) {
        text = this.textLevel === view ? this.text : convert(this.text, this.textLevel, view, this.compileOpts()).text;
      }
      if (text == null) {
        const printed = printBlocks(this.tree, view);
        text = printed.text;
        for (const note of printed.notes) this.menu?.toast(note.detail);
      }
      this.text = text;
      this.textLevel = view;
    }
    this.view = view;
    this.renderWorkspace();
    this.renderView();
  }

  renderView() {
    const view = this.view;
    const typed = view === 1 || view === 2;
    const js = view === 'js';
    this.paletteEl.hidden = typed || js;
    this.workspaceEl.hidden = typed || js;
    this.textPane.hidden = !(typed || js);
    this.legacyNote.hidden = !js;
    this.levelHint.hidden = !typed;
    this.problemsEl.hidden = !typed;
    for (const [key, btn] of Object.entries(this.modeButtons)) {
      const on = String(key) === String(view);
      btn.classList.toggle('active-blocks', on && key === 'blocks');
      btn.classList.toggle(`active-level${key}`, on && key !== 'blocks');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    this.textInput.readOnly = js;
    if (js) {
      this.textInput.value = this.legacyJs;
      this.textHighlightCode.innerHTML = `${highlightJs(this.legacyJs)}\n`;
      this.paintGutter(this.legacyJs);
      this.syncScroll();
    } else if (typed) {
      this.textInput.value = this.text;
      this.levelHint.innerHTML = this.inlineCode(LEVEL_HINTS[view]);
      this.analyzeNow();
      requestAnimationFrame(() => this.textInput.focus());
    } else {
      this.cancelDrag();
    }
  }

  // --- the text editor -----------------------------------------------------------

  onTextInput() {
    this.text = this.textInput.value;
    // Colour at once (it is cheap); check after a pause, so a half-typed word is not marked.
    this.paint(this.analysis?.diagnostics ?? []);
    clearTimeout(this.analyzeTimer);
    this.analyzeTimer = setTimeout(() => this.analyzeNow(), ANALYZE_DELAY);
    this.updateComplete();
  }

  analyzeNow() {
    clearTimeout(this.analyzeTimer);
    if (this.view !== 1 && this.view !== 2) return;
    this.analysis = compile(this.textInput.value, this.view, this.compileOpts());
    this.paint(this.analysis.diagnostics);
    this.renderProblems(this.analysis.diagnostics);
  }

  paint(diagnostics) {
    const value = this.textInput.value;
    // A diagnostic from an older version of the text could point past the end of it.
    const fresh = diagnostics.filter((d) => d.to <= value.length);
    this.textHighlightCode.innerHTML = `${highlight(value, fresh)}\n`;
    this.paintGutter(value);
    this.syncScroll();
  }

  paintGutter(value) {
    const lines = value.split('\n').length;
    const bad = new Map();
    for (const d of this.view === 'js' ? [] : this.analysis?.diagnostics ?? []) {
      if (bad.get(d.line) !== 'error') bad.set(d.line, d.severity);
    }
    let html = '';
    for (let i = 1; i <= lines; i++) {
      const s = bad.get(i);
      html += s ? `<span class="pe-gutter-${s === 'error' ? 'err' : 'warn'}">${i}</span>\n` : `${i}\n`;
    }
    this.gutter.innerHTML = html;
  }

  syncScroll() {
    this.textHighlight.scrollTop = this.textInput.scrollTop;
    this.textHighlight.scrollLeft = this.textInput.scrollLeft;
    this.gutter.scrollTop = this.textInput.scrollTop;
    if (this.complete) this.placeComplete();
  }

  // `code` in a message, shown as code.
  inlineCode(text) {
    const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc.replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  renderProblems(diagnostics) {
    this.problemsEl.textContent = '';
    if (!diagnostics.length) {
      const ok = document.createElement('div');
      ok.className = 'pe-problems-ok';
      ok.textContent = this.textInput.value.trim() ? 'No problems. Save to run it.' : 'Type a command, like `rotate 15 degrees`.';
      ok.innerHTML = this.inlineCode(ok.textContent);
      this.problemsEl.appendChild(ok);
      return;
    }
    for (const d of diagnostics.slice(0, MAX_CARDS)) {
      const card = document.createElement('div');
      card.className = `pe-card pe-card-${d.severity === 'error' ? 'err' : 'warn'}`;
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'pe-card-head';
      head.innerHTML = `<span class="pe-card-line">Line ${d.line}</span> ${this.inlineCode(d.title)}`;
      head.title = 'Show me this line';
      head.addEventListener('click', () => this.selectRange(d.from, d.to));
      card.appendChild(head);
      if (d.explain) {
        const explain = document.createElement('div');
        explain.className = 'pe-card-explain';
        explain.innerHTML = this.inlineCode(d.explain);
        card.appendChild(explain);
      }
      if (d.fix) {
        const fix = document.createElement('button');
        fix.type = 'button';
        fix.className = 'pe-card-fix';
        fix.textContent = 'Fix it';
        fix.title = d.fix.label.replace(/`/g, '');
        fix.addEventListener('click', () => this.applyFix(d.fix));
        card.appendChild(fix);
      }
      this.problemsEl.appendChild(card);
    }
    if (diagnostics.length > MAX_CARDS) {
      const more = document.createElement('div');
      more.className = 'pe-problems-more';
      more.textContent = `${diagnostics.length - MAX_CARDS} more after these.`;
      this.problemsEl.appendChild(more);
    }
  }

  selectRange(from, to) {
    this.textInput.focus();
    this.textInput.setSelectionRange(from, to);
    // Bring the line into view: the textarea scrolls to its selection on focus in most
    // browsers, but not reliably to one set programmatically.
    const line = this.textInput.value.slice(0, from).split('\n').length - 1;
    const lineH = parseFloat(getComputedStyle(this.textInput).lineHeight) || 20;
    const top = line * lineH;
    if (top < this.textInput.scrollTop || top > this.textInput.scrollTop + this.textInput.clientHeight - lineH * 2) {
      this.textInput.scrollTop = Math.max(0, top - lineH * 2);
    }
  }

  // One edit transaction through execCommand, so Ctrl+Z undoes a Fix it or an autocomplete in
  // one step. Falls back to setRangeText where execCommand is gone.
  replaceRange(from, to, insert) {
    this.textInput.focus();
    this.textInput.setSelectionRange(from, to);
    const done = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert);
    if (!done) {
      this.textInput.setRangeText(insert, from, to, 'end');
      this.textInput.dispatchEvent(new Event('input'));
    }
  }

  applyFix(fix) {
    // Applied from the end backwards, so earlier offsets stay true. A multi-edit fix (moving a
    // `when` and everything under it) is applied to the whole text at once, as one undo step.
    const edits = [...fix.edits].sort((a, b) => b.from - a.from);
    if (edits.length === 1) {
      this.replaceRange(edits[0].from, edits[0].to, edits[0].insert);
    } else {
      let value = this.textInput.value;
      for (const e of edits) value = value.slice(0, e.from) + e.insert + value.slice(e.to);
      const lo = Math.min(...edits.map((e) => e.from));
      const hi = Math.max(...edits.map((e) => e.to));
      const tail = this.textInput.value.length - hi;
      this.replaceRange(lo, hi, value.slice(lo, value.length - tail));
    }
    this.analyzeNow();
  }

  onTextKey(e) {
    if (this.view === 'js') return;
    const c = this.complete;
    if (c) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        c.index = (c.index + (e.key === 'ArrowDown' ? 1 : c.items.length - 1)) % c.items.length;
        this.renderComplete();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        this.acceptComplete(c.index);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hideComplete();
        return;
      }
    }
    const input = this.textInput;
    const { selectionStart: s, selectionEnd: end, value } = input;
    if (e.key === 'Tab') {
      // Tab pushes a line in by one step and Shift+Tab pulls it back, instead of leaving the field.
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      if (e.shiftKey) {
        const lead = /^ {1,4}/.exec(value.slice(lineStart))?.[0] ?? '';
        if (lead) this.replaceRange(lineStart, lineStart + lead.length, '');
      } else if (s === end) {
        this.replaceRange(s, end, INDENT);
      } else {
        this.replaceRange(lineStart, lineStart, INDENT);
      }
      return;
    }
    if (e.key === 'Enter' && s === end) {
      // A new line starts where this one did, and one step further in after a line that holds
      // lines (`repeat`, `forever`, `if`, `when`).
      e.preventDefault();
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      const lead = /^[ \t]*/.exec(line)[0];
      const opens = /^\s*(repeat|forever|if|when)\b/i.test(line);
      this.replaceRange(s, end, `\n${lead}${opens ? INDENT : ''}`);
    }
  }

  // --- autocomplete ----------------------------------------------------------------

  updateComplete() {
    const input = this.textInput;
    if (input.selectionStart !== input.selectionEnd) return this.hideComplete();
    const names = new Set([...variablesIn(this.analysis?.blocks ?? []), ...this.sharedNames()]);
    const result = completions(input.value, input.selectionStart, this.view, {
      objectNames: this.objectNames(),
      variableNames: [...names],
    });
    if (!result) return this.hideComplete();
    this.complete = { ...result, index: 0 };
    this.renderComplete();
  }

  renderComplete() {
    const c = this.complete;
    this.completeEl.textContent = '';
    c.items.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.className = i === c.index ? 'is-active' : '';
      if (item.category) li.style.setProperty('--pe-cat-color', CATEGORIES[item.category].fill);
      const label = document.createElement('span');
      label.className = 'pe-complete-label';
      label.textContent = item.label;
      const detail = document.createElement('span');
      detail.className = 'pe-complete-detail';
      detail.textContent = item.detail;
      li.append(label, detail);
      // pointerdown, not click: a click would blur the textarea first and close the popup.
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.acceptComplete(i);
      });
      this.completeEl.appendChild(li);
    });
    this.completeEl.hidden = false;
    this.placeComplete();
  }

  placeComplete() {
    const input = this.textInput;
    const before = input.value.slice(0, this.complete.from);
    const line = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n') - 1;
    const style = getComputedStyle(input);
    const charW = this.measureEl.getBoundingClientRect().width / 10 || 7.5;
    const lineH = parseFloat(style.lineHeight) || 20;
    const x = parseFloat(style.paddingLeft) + col * charW - input.scrollLeft;
    const y = parseFloat(style.paddingTop) + line * lineH - input.scrollTop;
    const maxX = Math.max(0, this.textStack.clientWidth - 280);
    this.completeEl.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
    this.completeEl.style.top = `${y + 2}px`;
  }

  acceptComplete(index) {
    const c = this.complete;
    const item = c?.items[index];
    this.hideComplete();
    if (!item) return;
    this.replaceRange(c.from, c.to, item.insert);
  }

  hideComplete() {
    this.complete = null;
    this.completeEl.hidden = true;
  }

  // --- the confirm box -----------------------------------------------------------------

  askConfirm(message, okLabel) {
    return new Promise((resolve) => {
      this.confirmEl.textContent = '';
      const text = document.createElement('div');
      text.className = 'pe-confirm-text';
      text.innerHTML = this.inlineCode(message);
      const row = document.createElement('div');
      row.className = 'pe-confirm-row';
      // The answer is taken BEFORE the box is hidden: hideConfirm() answers "no" to whatever
      // question is still pending, which would otherwise be this one.
      const finish = (answer) => {
        this.confirmResolve = null;
        this.hideConfirm();
        resolve(answer);
      };
      const cancel = this.actionButton('Keep it as it is', () => finish(false));
      const ok = this.actionButton(okLabel, () => finish(true));
      ok.classList.add('menu-link');
      row.append(cancel, ok);
      this.confirmEl.append(text, row);
      this.confirmEl.hidden = false;
      this.confirmResolve = finish;
      cancel.focus();
    });
  }

  hideConfirm() {
    this.confirmEl.hidden = true;
    const resolve = this.confirmResolve;
    this.confirmResolve = null;
    resolve?.(false);
  }

  // --- saving --------------------------------------------------------------------------

  save() {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();
    const record = item.record;

    // A JavaScript program is only ever looked at here, never rewritten.
    if (this.view === 'js') return this.close();

    if (this.view === 1 || this.view === 2) {
      this.text = this.textInput.value;
      const result = compile(this.text, this.view, this.compileOpts());
      if (!result.ok) {
        this.analysis = result;
        this.paint(result.diagnostics);
        this.renderProblems(result.diagnostics);
        this.menu?.toast('Fix the problems marked in red, then Save.', { tone: 'error' });
        return;
      }
      this.tree = result.blocks;
      this.textLevel = this.view;
    } else {
      // A warning, not a refusal: the program still runs, and the name reads as 0.
      const missing = this.unknownVariables();
      if (missing.length) {
        this.menu?.toast(`Nothing sets ${missing.map((n) => `"${n}"`).join(', ')} in this program yet.`, { tone: 'error' });
      }
    }

    // The BLOCKS are what runs, whichever view saved them, so nothing that runs a program
    // (ProgramManager, HiFi, duplicate, the play icon, an older copy of the app) needs to know
    // a program was typed. The text rides beside them -- kept from the blocks view as well, as
    // long as it still matches, so the # notes in it survive a look at the blocks.
    record.program = cloneBlockTree(this.tree);
    if (!record.program.length) delete record.program;
    const typed = this.view === 1 || this.view === 2;
    if (this.text.trim() && (typed || this.textMatchesTree())) {
      record.programText = this.text;
      record.programLevel = this.textLevel;
    } else {
      delete record.programText;
      delete record.programLevel;
    }
    // `text` opens the editor on the text; no mode means blocks. A JavaScript program saved
    // over here stops running, because `js` is gone; its text is left on the record untouched.
    if (typed && record.programText) record.programMode = 'text';
    else delete record.programMode;
    delete record.programJsAuto;

    this.worldStore?.saveObject(record);
    countProgram(record);
    this.programManager?.startFromRecord(this.activeId, record, item.object3D);
    this.playIconManager?.refresh(this.activeId, record, item.object3D);
    this.menu?.toast(recordHasProgram(record) ? 'Program saved and running.' : 'Program cleared.', { tone: 'success' });
    this.close();
  }

  // --- rendering ---------------------------------------------------------------

  // Every name a variable slot can offer: what this program sets, plus what any object in the
  // world shares. Read from the live tree each time, so it cannot go stale.
  variableNames() {
    const names = variablesIn(this.tree);
    for (const item of this.registry?.items?.values?.() || []) {
      sharedVariablesIn(item.record?.program, names);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  // Brings every variable picker in the workspace up to date. Done in place rather than by
  // re-rendering, because a re-render on every keystroke in a name field would take the
  // student's caret away from them.
  refreshVariablePickers() {
    const names = this.variableNames();
    for (const picker of this.workspaceEl.querySelectorAll('.pe-var-picker')) picker.refreshNames(names);
  }

  // Names this program reads that nothing sets: a name changed in one place and not another.
  unknownVariables() {
    const known = new Set(this.variableNames());
    const missing = new Set();
    const walk = (blocks) => {
      for (const block of blocks || []) {
        const def = BLOCK_DEFS[block.type];
        for (const [key, schema] of Object.entries(def?.params || {})) {
          if (schema.variable && isVariableRef(block.params[key]) && !known.has(block.params[key])) {
            missing.add(block.params[key]);
          }
        }
        walk(block.children);
      }
    };
    walk(this.tree);
    return [...missing];
  }

  renderWorkspace() {
    this.workspaceEl.innerHTML = '';
    if (!this.tree.length) {
      const empty = document.createElement('div');
      empty.className = 'pe-empty-hint';
      empty.textContent = 'Drag blocks here to build a program.';
      this.workspaceEl.appendChild(empty);
    }
    this.renderBlockList(this.tree, this.workspaceEl);
    this.refreshVariablePickers();
  }

  renderBlockList(blocks, container) {
    for (const block of blocks) {
      const wrap = document.createElement('div');
      wrap.className = 'pe-block-wrap';
      wrap.dataset.blockId = block.id;

      const chrome = this.renderBlockChrome(block.type, block.params, {
        onFieldChange: (key, value) => {
          block.params[key] = value;
        },
        onDelete: () => this.deleteBlockById(block.id),
      });
      chrome.addEventListener('pointerdown', (e) => this.onWorkspaceDragStart(e, block.id));
      wrap.appendChild(chrome);

      const def = BLOCK_DEFS[block.type];
      if (def.hasChildren) {
        const body = document.createElement('div');
        body.className = 'pe-body';
        body.style.setProperty('--pe-cat-color', CATEGORIES[def.category].dark);
        if (!block.children.length) {
          const hint = document.createElement('div');
          hint.className = 'pe-body-empty';
          hint.textContent = 'drop blocks here';
          body.appendChild(hint);
        }
        this.renderBlockList(block.children, body);
        wrap.appendChild(body);

        // The darker shade, matching the left arm above it rather than the header --
        // arm and footer then read as one continuous bracket around the children.
        const footer = document.createElement('div');
        footer.className = 'pe-footer';
        footer.style.background = CATEGORIES[def.category].dark;
        wrap.appendChild(footer);
      }

      container.appendChild(wrap);
    }
  }

  // Builds the visual block element (used for both palette templates and live
  // workspace blocks) from its type + current params.
  renderBlockChrome(type, params, { paletteOnly = false, onFieldChange, onDelete } = {}) {
    const def = BLOCK_DEFS[type];
    const category = CATEGORIES[def.category];

    // No jigsaw nub on top: Scratch draws one because its blocks are a single bitmap
    // per block with no gap between them, so the tab is what shows they interlock. Here
    // every block is a rounded DOM pill with real spacing around it, and a 5px stub
    // poking out of the top edge just read as a rendering artifact.
    const el = document.createElement('div');
    el.className = `pe-block pe-cat-${def.category}`;
    el.style.background = `linear-gradient(180deg, ${category.fill} 0%, ${category.dark} 148%)`;
    el.dataset.type = type;

    for (const token of def.label) {
      if (token.text) {
        const span = document.createElement('span');
        span.className = 'pe-label';
        span.textContent = token.text;
        el.appendChild(span);
        continue;
      }

      const schema = def.params[token.field];

      // A dropdown, for a param whose values are a short fixed list of NAMES rather than
      // a number. `glide`'s ease is the first: "smoothly" is a word a nine-year-old picks
      // out of a list and would never think to type. Built as a real <select> so it comes
      // with keyboard support and a touch-friendly native picker for free.
      if (schema.type === 'select') {
        const select = document.createElement('select');
        select.className = `pe-field pe-field-select${schema.compact ? ' pe-field-compact' : ''}`;
        for (const option of schema.options || []) {
          const opt = document.createElement('option');
          opt.value = option.value;
          opt.textContent = option.label;
          select.appendChild(opt);
        }
        select.value = params[token.field] ?? schema.default;
        select.disabled = paletteOnly;
        select.addEventListener('pointerdown', (e) => e.stopPropagation());
        select.addEventListener('click', (e) => e.stopPropagation());
        select.addEventListener('change', () => onFieldChange?.(token.field, select.value));
        el.appendChild(select);
        continue;
      }

      // A variable's own name. Cleaned as it is typed, and every picker in the program hears
      // about it straight away.
      if (schema.type === 'name') {
        const nameInput = document.createElement('input');
        nameInput.className = 'pe-field pe-field-name';
        nameInput.type = 'text';
        nameInput.maxLength = 16;
        nameInput.spellcheck = false;
        nameInput.autocapitalize = 'off';
        nameInput.value = params[token.field] ?? schema.default;
        nameInput.disabled = paletteOnly;
        nameInput.addEventListener('pointerdown', (e) => e.stopPropagation());
        nameInput.addEventListener('click', (e) => e.stopPropagation());
        nameInput.addEventListener('input', () => {
          const clean = cleanVariableName(nameInput.value);
          if (clean !== nameInput.value) nameInput.value = clean;
          onFieldChange?.(token.field, clean);
          this.refreshVariablePickers();
        });
        el.appendChild(nameInput);
        continue;
      }

      const named = schema.variable && isVariableRef(params[token.field]);
      const input = document.createElement('input');
      input.className = schema.type === 'text'
        ? `pe-field pe-field-text${schema.short ? ' pe-field-short' : ''}`
        : 'pe-field';
      input.type = schema.type === 'color' ? 'color' : schema.type === 'text' ? 'text' : 'number';
      if (schema.type === 'number') {
        if (schema.min !== undefined) input.min = String(schema.min);
        if (schema.max !== undefined) input.max = String(schema.max);
        if (schema.step !== undefined) input.step = String(schema.step);
      }
      if (schema.type === 'text') input.maxLength = 60;
      // `tell`'s object: any text, with the names of this world's objects offered as you type.
      if (type === 'tell' && token.field === 'object') {
        input.setAttribute('list', 'pe-object-names');
        input.placeholder = 'name';
      }
      input.value = named ? '' : params[token.field];
      input.disabled = paletteOnly;
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
      input.addEventListener('click', (e) => e.stopPropagation());
      // Text fields commit on every keystroke as well as on change. `change` alone means
      // typing a message and dragging the block without leaving the field loses what was
      // typed -- which for `say` is the entire content of the block.
      const commit = () => {
        const value = schema.type === 'number' ? Number(input.value) : input.value;
        onFieldChange?.(token.field, value);
      };
      input.addEventListener('change', commit);
      if (schema.type === 'text') input.addEventListener('input', commit);
      el.appendChild(input);
      if (schema.variable) {
        if (paletteOnly) {
          // The drag ghost shows a dragged block's variable as text; it has nothing to pick.
          if (named) {
            input.type = 'text';
            input.value = params[token.field];
          }
        } else {
          el.appendChild(this.renderVariablePicker(input, schema, params[token.field], (value) => onFieldChange?.(token.field, value)));
        }
      }
    }

    if (!paletteOnly) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pe-delete';
      del.textContent = '×';
      del.title = 'Remove this block';
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete?.();
      });
      el.appendChild(del);
    }

    return el;
  }

  // The small arrow beside a number field. Only there once the program has a variable to offer,
  // so a program with no Math blocks in it looks exactly as it always has. A picker rather than
  // typing a name into the field: a touch screen's number pad has no letters, and a list cannot
  // produce a typo. Picking a name hides the number field and the picker becomes the pill.
  renderVariablePicker(input, schema, initial, commit) {
    const picker = document.createElement('select');
    picker.className = 'pe-field pe-var-picker';
    picker.title = 'Use a variable here';
    let current = isVariableRef(initial) ? initial : '';

    const paint = (names) => {
      picker.textContent = '';
      const number = document.createElement('option');
      number.value = '';
      number.textContent = 'a number';
      picker.appendChild(number);
      const all = current && !names.includes(current) ? [current, ...names] : names;
      for (const name of all) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        picker.appendChild(opt);
      }
      picker.value = current;
      picker.hidden = !all.length;
      input.hidden = !!current;
      picker.classList.toggle('pe-var-active', !!current);
      picker.classList.toggle('pe-var-unknown', !!current && !names.includes(current));
    };

    picker.refreshNames = paint;
    picker.addEventListener('pointerdown', (e) => e.stopPropagation());
    picker.addEventListener('click', (e) => e.stopPropagation());
    picker.addEventListener('change', () => {
      current = picker.value;
      if (current) {
        commit(current);
      } else {
        input.value = schema.default;
        commit(schema.default);
      }
      this.refreshVariablePickers();
    });
    return picker;
  }

  // --- tree helpers --------------------------------------------------------------

  findParentArray(blocks, id, parent = null) {
    parent = parent || blocks;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].id === id) return { array: blocks, index: i };
      const def = BLOCK_DEFS[blocks[i].type];
      if (def.hasChildren) {
        const found = this.findParentArray(blocks[i].children, id);
        if (found) return found;
      }
    }
    return null;
  }

  deleteBlockById(id) {
    const found = this.findParentArray(this.tree, id);
    if (!found) return;
    found.array.splice(found.index, 1);
    this.renderWorkspace();
  }

  // --- dragging --------------------------------------------------------------

  onPaletteDragStart(e, type) {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault();
    this.beginDrag(e, createBlockInstance(type));
  }

  onWorkspaceDragStart(e, blockId) {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault();
    const found = this.findParentArray(this.tree, blockId);
    if (!found) return;
    const [block] = found.array.splice(found.index, 1);
    this.renderWorkspace();
    this.beginDrag(e, block);
  }

  beginDrag(e, block) {
    const ghost = this.renderBlockChrome(block.type, block.params, { paletteOnly: true });
    ghost.classList.add('pe-ghost');
    document.body.appendChild(ghost);

    this.drag = {
      block,
      ghostEl: ghost,
      pointerId: e.pointerId,
      dropZone: null,
    };

    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);

    this.positionGhost(e.clientX, e.clientY);
    this.updateDropZone(e.clientX, e.clientY);
  }

  positionGhost(clientX, clientY) {
    if (!this.drag) return;
    this.drag.ghostEl.style.left = `${clientX + 12}px`;
    this.drag.ghostEl.style.top = `${clientY + 12}px`;
  }

  onDragMove(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.positionGhost(e.clientX, e.clientY);
    this.updateDropZone(e.clientX, e.clientY);
  }

  computeDropZones() {
    const zones = [];
    const walk = (blocks, container) => {
      const containerRect = container.getBoundingClientRect();
      if (!blocks.length) {
        zones.push({ array: blocks, index: 0, x: containerRect.left, y: containerRect.top + 6, width: containerRect.width });
        return;
      }
      blocks.forEach((block, i) => {
        const wrapEl = container.querySelector(`:scope > .pe-block-wrap[data-block-id="${block.id}"]`);
        if (!wrapEl) return;
        const headerEl = wrapEl.querySelector(':scope > .pe-block');
        const headerRect = headerEl.getBoundingClientRect();
        zones.push({ array: blocks, index: i, x: headerRect.left, y: headerRect.top, width: headerRect.width });
        if (i === blocks.length - 1) {
          zones.push({ array: blocks, index: i + 1, x: headerRect.left, y: headerRect.bottom, width: headerRect.width });
        }
        const def = BLOCK_DEFS[block.type];
        if (def.hasChildren) {
          const bodyEl = wrapEl.querySelector(':scope > .pe-body');
          if (bodyEl) walk(block.children, bodyEl);
        }
      });
    };
    walk(this.tree, this.workspaceEl);
    return zones;
  }

  updateDropZone(clientX, clientY) {
    const zones = this.computeDropZones();
    let best = null;
    let bestDist = Infinity;
    for (const zone of zones) {
      if (clientX < zone.x - DROP_ZONE_X_SLOP) continue;
      const dy = Math.abs(clientY - zone.y);
      if (dy > DROP_ZONE_MAX_DY) continue;
      if (dy < bestDist) {
        bestDist = dy;
        best = zone;
      }
    }

    this.drag.dropZone = best;
    if (best) {
      this.dropIndicator.hidden = false;
      this.dropIndicator.style.left = `${best.x}px`;
      this.dropIndicator.style.top = `${best.y - 3}px`;
      this.dropIndicator.style.width = `${best.width}px`;
      this.drag.ghostEl.classList.remove('pe-ghost-delete');
    } else {
      this.dropIndicator.hidden = true;
      this.drag.ghostEl.classList.add('pe-ghost-delete');
    }
  }

  onDragEnd(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const { block, dropZone } = this.drag;
    if (dropZone) {
      dropZone.array.splice(dropZone.index, 0, block);
    }
    this.cancelDrag();
    this.renderWorkspace();
  }

  cancelDrag() {
    if (!this.drag) return;
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    this.drag.ghostEl.remove();
    this.dropIndicator.hidden = true;
    this.drag = null;
  }
}
