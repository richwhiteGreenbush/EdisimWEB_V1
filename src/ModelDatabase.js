import { MODELS, MODEL_BY_ID, MODEL_CATEGORIES, GRADE_BANDS, modelCategory, searchModels } from './models/catalog.js';
import { placeCatalogModel, placeInfoSign, worldTriangles } from './models/index.js';
import { reducedMotion } from './Settings.js';

// Pictures are relative because the app is served from /app/ and /hifi/; a leading slash would
// resolve against the marketing site. Both editions have the files, in their own public/ folders.
const thumbUrl = (id) => `models/thumbs/${id}.webp`;
const spinUrl = (id) => `models/spin/${id}.webp`;
const SPIN_FRAMES = 12;
const SPIN_MS = 170;

// Half of the 1.5M triangles a frame the i5/i7 Chromebook target allows, since every mesh is
// also drawn into the shadow map. HiFi targets discrete graphics and passes its own, larger one.
const DEFAULT_TRIANGLE_LIMIT = 750000;

// The panel that browses, searches and places the catalogue. It is DOM over the world like the
// Program panel, and it never draws 3D: a second WebGLRenderer would not exist in HiFi, so the
// turntable in the detail view is a strip of twelve pictures made by
// tools/build-model-pictures.mjs. A missing picture degrades to the category's icon.
export class ModelDatabase {
  constructor({ scene, camera, registry, worldStore, menu, groundHeightAt, triangleLimit = DEFAULT_TRIANGLE_LIMIT }) {
    Object.assign(this, { scene, camera, registry, worldStore, menu, groundHeightAt, triangleLimit });
    // Kept across openings, so a student placing several models from one topic comes back to
    // where they were instead of starting over.
    this.category = 'all';
    this.grade = 'all';
    this.query = '';
    this.detailId = null;
    this.placing = false;
    this.spinTimer = null;

    this.overlay = document.createElement('div');
    this.overlay.id = 'modeldb-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) this.close();
    });
    // The window-level PlayerController would otherwise walk the student around behind the
    // panel whenever an arrow key was pressed outside the search box.
    this.overlay.addEventListener('keydown', (e) => e.stopPropagation());

    this.panel = document.createElement('div');
    this.panel.id = 'modeldb-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', 'Model Database');
    this.panel.tabIndex = -1;
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);

    this.buildShell();

    // Capture, so Esc closes this rather than reaching VRView's own Esc or the cinema's.
    window.addEventListener('keydown', (e) => {
      if (this.overlay.hidden || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.detailId) this.showList();
      else this.close();
    }, true);
  }

  get isOpen() {
    return !this.overlay.hidden;
  }

  open() {
    this.overlay.hidden = false;
    this.renderMeter();
    if (this.detailId) this.renderDetail();
    else this.renderList();
    this.searchInput.focus();
    this.searchInput.select();
  }

  close() {
    this.stopSpin();
    this.overlay.hidden = true;
  }

  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  buildShell() {
    const head = this.el('div', 'mdb-head');
    head.appendChild(this.el('h2', 'mdb-title', 'Model Database'));

    this.searchInput = this.el('input', 'mdb-search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search: heart, dinosaur, Egypt, music…';
    this.searchInput.setAttribute('aria-label', 'Search the models');
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.detailId = null;
      this.renderList();
    });

    const gradeWrap = this.el('label', 'mdb-grade');
    gradeWrap.appendChild(this.el('span', null, 'Grade'));
    this.gradeSelect = this.el('select');
    this.gradeSelect.appendChild(new Option('All', 'all'));
    for (const band of GRADE_BANDS) this.gradeSelect.appendChild(new Option(band, band));
    this.gradeSelect.addEventListener('change', () => {
      this.grade = this.gradeSelect.value;
      this.detailId = null;
      this.renderList();
    });
    gradeWrap.appendChild(this.gradeSelect);

    const closeBtn = this.el('button', 'menu-btn mdb-close', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close the Model Database');
    closeBtn.addEventListener('click', () => this.close());
    head.append(this.searchInput, gradeWrap, closeBtn);

    const body = this.el('div', 'mdb-body');
    this.rail = this.el('nav', 'mdb-rail');
    this.rail.setAttribute('aria-label', 'Model types');
    this.content = this.el('div', 'mdb-content');
    body.append(this.rail, this.content);

    const foot = this.el('div', 'mdb-foot');
    this.status = this.el('div', 'mdb-status');
    this.status.setAttribute('role', 'status');
    this.meter = this.el('div', 'mdb-meter');
    foot.append(this.status, this.meter);

    this.panel.append(head, body, foot);
  }

  renderRail(counts) {
    this.rail.innerHTML = '';
    const entries = [{ key: 'all', label: 'All models', icon: '✦' }, ...MODEL_CATEGORIES];
    for (const category of entries) {
      const btn = this.el('button', 'mdb-rail-btn');
      btn.type = 'button';
      btn.append(this.el('span', 'mdb-rail-icon', category.icon), this.el('span', 'mdb-rail-label', category.label),
        this.el('span', 'mdb-rail-count', String(counts[category.key] ?? 0)));
      if (category.key === this.category) {
        btn.classList.add('is-on');
        btn.setAttribute('aria-current', 'true');
      }
      btn.addEventListener('click', () => {
        this.category = category.key;
        this.detailId = null;
        this.renderList();
        this.content.scrollTop = 0;
      });
      this.rail.appendChild(btn);
    }
  }

  // A search looks through everything whichever tab is open, and the counts beside the tabs say
  // where its results are. Scoping it to the open tab would answer "no models found" for a
  // heart while a student happened to be looking at Landmarks.
  currentModels() {
    const gradeFiltered = this.grade === 'all' ? MODELS : MODELS.filter((m) => m.grades.includes(this.grade));
    const matches = searchModels(this.query, gradeFiltered);
    const counts = { all: matches.length };
    for (const model of matches) counts[model.category] = (counts[model.category] ?? 0) + 1;
    const searching = this.query.trim().length > 0;
    const visible = !searching && this.category !== 'all'
      ? matches.filter((m) => m.category === this.category)
      : matches;
    return { visible, counts, searching };
  }

  picture(model, url, className) {
    const wrap = this.el('div', className);
    const category = modelCategory(model.category);
    const img = this.el('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = url;
    img.addEventListener('error', () => {
      img.remove();
      wrap.classList.add('mdb-no-picture');
      wrap.textContent = category.icon;
    });
    wrap.appendChild(img);
    return wrap;
  }

  showList() {
    this.detailId = null;
    this.stopSpin();
    this.renderList();
    this.searchInput.focus();
  }

  renderList() {
    this.stopSpin();
    const { visible, counts, searching } = this.currentModels();
    if (searching) this.category = 'all';
    this.renderRail(counts);
    this.content.innerHTML = '';

    if (!visible.length) {
      const empty = this.el('div', 'mdb-empty');
      empty.append(
        this.el('p', 'mdb-empty-title', searching ? `No models match “${this.query.trim()}”.` : 'No models for this grade here.'),
        this.el('p', null, 'Try a shorter word, or build your own with Create Model.'),
      );
      this.content.appendChild(empty);
      this.status.textContent = 'No models found';
      return;
    }

    const grid = this.el('div', 'mdb-grid');
    for (const model of visible) grid.appendChild(this.card(model));
    this.content.appendChild(grid);
    this.status.textContent = `${visible.length} model${visible.length === 1 ? '' : 's'}`;
  }

  card(model) {
    const category = modelCategory(model.category);
    const card = this.el('article', 'mdb-card');
    card.style.setProperty('--mdb-accent', category.accent);

    // The card's main button opens its details; "Place" is a separate button so a student who
    // knows what they want is one click from it. Two buttons rather than one clickable card
    // with a button inside it, because nested controls are not reachable by keyboard.
    const open = this.el('button', 'mdb-card-open');
    open.type = 'button';
    open.setAttribute('aria-label', `${model.title}: details`);
    open.append(this.picture(model, thumbUrl(model.id), 'mdb-thumb'), this.el('span', 'mdb-card-title', model.title),
      this.el('span', 'mdb-card-type', category.label));
    open.addEventListener('click', () => {
      this.detailId = model.id;
      this.renderDetail();
    });

    const place = this.el('button', 'mdb-card-place', 'Place');
    place.type = 'button';
    place.setAttribute('aria-label', `Place ${model.title} in my world`);
    place.addEventListener('click', () => this.place(model.id));

    card.append(open, place);
    return card;
  }

  renderDetail() {
    const model = MODEL_BY_ID.get(this.detailId);
    if (!model) { this.showList(); return; }
    this.stopSpin();
    const category = modelCategory(model.category);
    this.content.innerHTML = '';
    this.status.textContent = model.title;

    const detail = this.el('div', 'mdb-detail');
    detail.style.setProperty('--mdb-accent', category.accent);

    const back = this.el('button', 'menu-btn mdb-back', '← All models');
    back.type = 'button';
    back.addEventListener('click', () => this.showList());

    const info = this.el('div', 'mdb-info');
    info.append(
      this.el('div', 'mdb-eyebrow', `${category.icon} ${category.label}`),
      this.el('h3', 'mdb-detail-title', model.title),
      this.el('p', 'mdb-blurb', model.blurb),
    );

    const facts = this.el('ul', 'mdb-facts');
    for (const fact of model.facts) facts.appendChild(this.el('li', null, fact));
    info.appendChild(facts);

    const sizes = this.el('dl', 'mdb-sizes');
    sizes.append(this.el('dt', null, 'Real size'), this.el('dd', null, model.realSize),
      this.el('dt', null, 'This model'), this.el('dd', null, model.shownAt),
      this.el('dt', null, 'Grades'), this.el('dd', null, model.grades.join(', ')),
      this.el('dt', null, 'Subjects'), this.el('dd', null, model.subjects.join(', ')));
    info.appendChild(sizes);

    if (model.tryThis) {
      const tryIt = this.el('p', 'mdb-try');
      tryIt.append(this.el('strong', null, 'Try this: '), document.createTextNode(model.tryThis));
      info.appendChild(tryIt);
    }

    const place = this.el('button', 'mdb-place-big', 'Place in my world');
    place.type = 'button';
    place.addEventListener('click', () => this.place(model.id));
    info.appendChild(place);
    info.appendChild(this.el('p', 'mdb-note', 'Once it is placed, click the hammer above it to stretch, turn, move or connect it.'));

    detail.append(back, this.turntable(model), info);
    this.content.appendChild(detail);
    this.content.scrollTop = 0;
    // preventScroll: on a phone the button is below the picture, and focusing it scrolled the
    // model itself out of sight.
    place.focus({ preventScroll: true });
  }

  // Twelve views in one image, shown one at a time. It turns by itself unless the student has
  // asked for no motion, stops the moment they take hold of it, and answers the arrow keys.
  turntable(model) {
    const box = this.el('div', 'mdb-spin');
    box.tabIndex = 0;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${model.title}, turn with the left and right arrow keys`);

    const view = this.el('div', 'mdb-spin-view');
    box.appendChild(view);
    let frame = 0;
    const show = (n) => {
      frame = ((n % SPIN_FRAMES) + SPIN_FRAMES) % SPIN_FRAMES;
      view.style.backgroundPosition = `${(frame / (SPIN_FRAMES - 1)) * 100}% 0`;
    };

    const probe = new Image();
    probe.onload = () => {
      view.style.backgroundImage = `url("${spinUrl(model.id)}")`;
      view.style.backgroundSize = `${SPIN_FRAMES * 100}% 100%`;
      show(0);
      if (!reducedMotion() && this.detailId === model.id) {
        this.spinTimer = setInterval(() => show(frame + 1), SPIN_MS);
      }
    };
    probe.onerror = () => {
      box.classList.add('mdb-no-picture');
      box.textContent = modelCategory(model.category).icon;
    };
    probe.src = spinUrl(model.id);

    let dragX = null;
    let dragFrame = 0;
    box.addEventListener('pointerdown', (e) => {
      this.stopSpin();
      dragX = e.clientX;
      dragFrame = frame;
      try { box.setPointerCapture(e.pointerId); } catch { /* the drag still works inside the box */ }
    });
    box.addEventListener('pointermove', (e) => {
      if (dragX === null) return;
      const pxPerFrame = Math.max(14, box.clientWidth / SPIN_FRAMES);
      show(dragFrame - Math.round((e.clientX - dragX) / pxPerFrame));
    });
    const release = () => { dragX = null; };
    box.addEventListener('pointerup', release);
    box.addEventListener('pointercancel', release);
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      this.stopSpin();
      show(frame + (e.key === 'ArrowRight' ? 1 : -1));
    });
    return box;
  }

  stopSpin() {
    clearInterval(this.spinTimer);
    this.spinTimer = null;
  }

  renderMeter() {
    const total = worldTriangles(this.registry);
    const share = total / this.triangleLimit;
    this.meter.innerHTML = '';
    this.meter.classList.toggle('is-full', share >= 1);
    const label = this.el('span', 'mdb-meter-label', share >= 1
      ? 'This world is very full. Slower computers may stutter, though you can still add more.'
      : 'How full this world is');
    const bar = this.el('span', 'mdb-meter-bar');
    const fill = this.el('span', 'mdb-meter-fill');
    fill.style.width = `${Math.min(100, Math.round(share * 100))}%`;
    bar.appendChild(fill);
    this.meter.append(label, bar);
  }

  async place(id) {
    if (this.placing) return;
    this.placing = true;
    const entry = MODEL_BY_ID.get(id);
    const before = worldTriangles(this.registry);
    this.status.textContent = `Building ${entry.title}…`;
    try {
      // A builder can take a second on the main thread, so let that line paint first.
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      const { object3D, record, tick } = await placeCatalogModel({
        id,
        scene: this.scene,
        camera: this.camera,
        registry: this.registry,
        groundHeightAt: this.groundHeightAt,
      });
      this.worldStore.addAndRun(record, object3D, { tick });
      this.worldStore.saveObject(record);
      this.close();
      const crossed = before < this.triangleLimit && worldTriangles(this.registry) >= this.triangleLimit;
      this.menu?.toast(crossed
        ? `${entry.title} placed. This world is getting very full, and slower computers may stutter.`
        : `${entry.title} placed! Click the hammer above it to stretch, turn or move it.`, { tone: 'success' });
    } catch (err) {
      console.error(`Failed to place model "${id}":`, err);
      this.status.textContent = 'Something went wrong.';
      this.menu?.toast(`Could not place ${entry.title}.`, { tone: 'error' });
    } finally {
      this.placing = false;
    }
  }

  // The About screen shared by the two floating object panels: the same facts as the database
  // card, the Reset the hammer menu adds, and the sign that takes those facts into the world.
  renderAbout(container, record, { onBack }) {
    const entry = MODEL_BY_ID.get(record?.model);
    if (!entry) return;
    const category = modelCategory(entry.category);
    const box = this.el('div', 'mdb-about');
    box.append(this.el('div', 'om-title', entry.title), this.el('p', 'mdb-about-line', entry.blurb));
    const facts = this.el('ul', 'mdb-about-facts');
    for (const fact of entry.facts) facts.appendChild(this.el('li', null, fact));
    box.appendChild(facts);
    box.appendChild(this.el('p', 'mdb-about-line', `Real size: ${entry.realSize}. This model: ${entry.shownAt}.`));
    box.style.setProperty('--mdb-accent', category.accent);
    container.appendChild(box);

    const sign = this.el('button', 'menu-btn', 'Place an Info Sign');
    sign.type = 'button';
    sign.addEventListener('click', async () => {
      const item = this.registry.get(record.id);
      if (!item) return;
      try {
        await placeInfoSign({ item, camera: this.camera, groundHeightAt: this.groundHeightAt, worldStore: this.worldStore });
        this.menu?.toast('Info sign placed beside it.', { tone: 'success' });
      } catch (err) {
        console.error('Failed to place an info sign:', err);
        this.menu?.toast('Could not place the sign.', { tone: 'error' });
      }
    });
    const back = this.el('button', 'menu-btn om-back', 'Back');
    back.type = 'button';
    back.addEventListener('click', onBack);
    container.append(sign, back);
  }
}
