import { CATEGORIES, BLOCK_DEFS, PALETTE_ORDER, createBlockInstance, cloneBlockTree } from './BlockDefs.js';
import { blocksToJs, highlightJs, compileJs, JS_STARTER, JS_API_HINT } from './JsProgram.js';
import { recordHasProgram } from './ProgramManager.js';

const DROP_ZONE_MAX_DY = 260; // px -- beyond this, dropping means "delete", not "insert far away"
const DROP_ZONE_X_SLOP = 24; // px of leftward slop so a slightly-off pointer still hits a zone

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

    // The two representations live side by side and TOGGLING NEVER DESTROYS EITHER:
    // `tree` holds the blocks, `jsCode` holds the JavaScript, and `mode` says which one
    // runs when saved. `jsAuto` records that jsCode was generated from the blocks and
    // never hand-edited -- while it is true, switching to the JavaScript view regenerates
    // from the CURRENT blocks (so the JS tracks what the student just built); the moment
    // they type in the code pane it goes false and their text is left alone.
    this.mode = 'blocks';
    this.jsCode = '';
    this.jsAuto = true;

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

    const titleRow = document.createElement('div');
    titleRow.id = 'program-title-row';

    const title = document.createElement('div');
    title.id = 'program-title';
    title.textContent = 'Program this object';

    // The mode toggle. Two labelled buttons rather than a checkbox or a dropdown: both
    // options stay visible, and the active one is coloured -- block blue for blocks,
    // the JavaScript yellow for JavaScript.
    const toggle = document.createElement('div');
    toggle.id = 'program-mode-toggle';
    this.modeButtons = {};
    for (const [mode, label] of [['blocks', 'Block Code'], ['js', 'JavaScript']]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pe-mode-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => this.setMode(mode));
      this.modeButtons[mode] = btn;
      toggle.appendChild(btn);
    }
    titleRow.append(title, toggle);

    const body = document.createElement('div');
    body.id = 'program-body';

    this.paletteEl = document.createElement('div');
    this.paletteEl.id = 'program-palette';
    this.buildPalette();

    this.workspaceEl = document.createElement('div');
    this.workspaceEl.id = 'program-workspace';

    // The JavaScript pane: a transparent textarea stacked exactly over a highlighted
    // <pre>. The textarea owns the text, the caret and the scrollbar; the <pre> under it
    // owns the colours. They share one font, size, padding and wrapping rule, which is
    // the entire trick -- any metric that differs puts the caret beside the wrong
    // character.
    this.jsPane = document.createElement('div');
    this.jsPane.id = 'program-js-pane';
    this.jsPane.hidden = true;

    const editorWrap = document.createElement('div');
    editorWrap.className = 'pe-js-editor';

    this.jsHighlight = document.createElement('pre');
    this.jsHighlight.id = 'program-js-highlight';
    this.jsHighlightCode = document.createElement('code');
    this.jsHighlight.appendChild(this.jsHighlightCode);

    this.jsInput = document.createElement('textarea');
    this.jsInput.id = 'program-js-input';
    this.jsInput.spellcheck = false;
    this.jsInput.autocapitalize = 'off';
    this.jsInput.setAttribute('autocomplete', 'off');
    this.jsInput.addEventListener('input', () => {
      this.jsCode = this.jsInput.value;
      this.jsAuto = false;
      this.refreshHighlight();
    });
    // The highlight layer has no scrollbar of its own; it is dragged along with the
    // textarea's. (scrollTop is settable on an overflow:hidden element.)
    this.jsInput.addEventListener('scroll', () => {
      this.jsHighlight.scrollTop = this.jsInput.scrollTop;
      this.jsHighlight.scrollLeft = this.jsInput.scrollLeft;
    });
    // Tab indents instead of leaving the field -- in a code editor, focus-next is the
    // wrong meaning for the key.
    this.jsInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const { selectionStart, selectionEnd, value } = this.jsInput;
      this.jsInput.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      this.jsInput.selectionStart = this.jsInput.selectionEnd = selectionStart + 2;
      this.jsInput.dispatchEvent(new Event('input'));
    });

    editorWrap.append(this.jsHighlight, this.jsInput);

    const hint = document.createElement('div');
    hint.className = 'pe-js-hint';
    hint.textContent = JS_API_HINT;

    this.jsPane.append(editorWrap, hint);

    body.append(this.paletteEl, this.workspaceEl, this.jsPane);

    const actions = document.createElement('div');
    actions.id = 'program-actions';
    const clearBtn = this.actionButton('Clear', () => this.clearAll());
    const cancelBtn = this.actionButton('Cancel', () => this.close());
    const saveBtn = this.actionButton('Save', () => this.save());
    saveBtn.classList.add('menu-link');
    actions.append(clearBtn, cancelBtn, saveBtn);

    panel.append(titleRow, body, actions);
    this.overlay.appendChild(panel);
    document.body.appendChild(this.overlay);

    this.dropIndicator = document.createElement('div');
    this.dropIndicator.id = 'program-drop-indicator';
    this.dropIndicator.hidden = true;
    this.overlay.appendChild(this.dropIndicator);
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
    for (const categoryKey of ['control', 'motion', 'look']) {
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
    this.jsCode = record.programJs || '';
    // A record with no saved JavaScript opens with jsAuto true, so the first visit to the
    // JavaScript view shows the blocks translated rather than an empty page.
    this.jsAuto = record.programJs ? record.programJsAuto === true : true;
    this.mode = record.programMode === 'js' ? 'js' : 'blocks';
    if (this.mode === 'js' && (this.jsAuto || !this.jsCode.trim())) {
      this.jsCode = this.tree.length ? blocksToJs(this.tree) : (this.jsCode || JS_STARTER);
    }
    this.overlay.hidden = false;
    this.renderWorkspace();
    this.renderMode();
  }

  close() {
    this.cancelDrag();
    this.overlay.hidden = true;
    this.activeId = null;
    this.tree = [];
  }

  clearAll() {
    // Clears the representation being LOOKED AT, not both: emptying the code pane must
    // not silently delete the block program behind it, and vice versa. A cleared
    // JavaScript pane also re-arms jsAuto, so toggling away and back regenerates from
    // whatever blocks still exist.
    if (this.mode === 'js') {
      this.jsCode = '';
      this.jsAuto = true;
      this.jsInput.value = '';
      this.refreshHighlight();
    } else {
      this.tree = [];
      this.renderWorkspace();
    }
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'js') this.jsCode = this.jsInput.value;
    this.mode = mode;
    if (mode === 'js' && (this.jsAuto || !this.jsCode.trim())) {
      this.jsCode = this.tree.length ? blocksToJs(this.tree) : JS_STARTER;
      this.jsAuto = true;
    }
    this.renderMode();
  }

  renderMode() {
    const js = this.mode === 'js';
    this.paletteEl.hidden = js;
    this.workspaceEl.hidden = js;
    this.jsPane.hidden = !js;
    this.modeButtons.blocks.classList.toggle('active-blocks', !js);
    this.modeButtons.js.classList.toggle('active-js', js);
    if (js) {
      this.jsInput.value = this.jsCode;
      this.refreshHighlight();
    } else {
      this.cancelDrag();
    }
  }

  refreshHighlight() {
    // The trailing newline keeps the layers the same height when the text ends in one --
    // a <pre> collapses a final blank line where a textarea does not.
    this.jsHighlightCode.innerHTML = `${highlightJs(this.jsInput.value)}\n`;
    this.jsHighlight.scrollTop = this.jsInput.scrollTop;
    this.jsHighlight.scrollLeft = this.jsInput.scrollLeft;
  }

  save() {
    const item = this.registry.get(this.activeId);
    if (!item) return this.close();

    if (this.mode === 'js') this.jsCode = this.jsInput.value;
    const js = this.jsCode.trim();

    // A syntax error is caught HERE, with the editor still open and the code still in
    // the pane, rather than at run time where the only symptom is an object standing
    // still. Nothing is saved and nothing is lost; fix it or switch to blocks.
    if (this.mode === 'js' && js) {
      const { error } = compileJs(this.jsCode);
      if (error) {
        this.menu?.toast(`JavaScript error: ${error.message}`, { tone: 'error' });
        return;
      }
    }

    const record = item.record;
    // BOTH representations are saved, which is what makes the toggle non-destructive
    // across sessions too: reopening the editor tomorrow finds the same blocks and the
    // same JavaScript this student left. `programMode` decides which one runs.
    record.program = cloneBlockTree(this.tree);
    if (js) {
      record.programJs = this.jsCode;
      if (this.jsAuto) record.programJsAuto = true;
      else delete record.programJsAuto;
    } else {
      delete record.programJs;
      delete record.programJsAuto;
    }
    if (this.mode === 'js' && js) record.programMode = 'js';
    else delete record.programMode;

    this.worldStore?.saveObject(record);
    this.programManager?.startFromRecord(this.activeId, record, item.object3D);
    this.playIconManager?.refresh(this.activeId, record, item.object3D);
    const running = recordHasProgram(record);
    this.menu?.toast(
      running
        ? (record.programMode === 'js' ? 'JavaScript saved and running.' : 'Program saved and running.')
        : 'Program cleared.',
      { tone: 'success' },
    );
    this.close();
  }

  // --- rendering ---------------------------------------------------------------

  renderWorkspace() {
    this.workspaceEl.innerHTML = '';
    if (!this.tree.length) {
      const empty = document.createElement('div');
      empty.className = 'pe-empty-hint';
      empty.textContent = 'Drag blocks here to build a program.';
      this.workspaceEl.appendChild(empty);
    }
    this.renderBlockList(this.tree, this.workspaceEl);
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
      const input = document.createElement('input');
      input.className = schema.type === 'text' ? 'pe-field pe-field-text' : 'pe-field';
      input.type = schema.type === 'color' ? 'color' : schema.type === 'text' ? 'text' : 'number';
      if (schema.type === 'number') {
        if (schema.min !== undefined) input.min = String(schema.min);
        if (schema.max !== undefined) input.max = String(schema.max);
        if (schema.step !== undefined) input.step = String(schema.step);
      }
      if (schema.type === 'text') input.maxLength = 60;
      input.value = params[token.field];
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
