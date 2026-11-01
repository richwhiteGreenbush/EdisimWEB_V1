import { GRADE_BANDS } from './models/catalog.js';
import { WORLD_TOPICS, fetchWorldCatalog, searchWorlds } from './WorldCatalog.js';

// How long a fetched list is trusted before the panel quietly asks for it again.
const STALE_MS = 5 * 60 * 1000;

// The panel that browses, searches and opens the worlds in the gallery, from inside the app. It
// wears the Model Database's styles and has its layout, and it differs in the two ways that
// matter:
//
//  - The list is fetched (WorldCatalog.js), so it can be slow or fail, and the panel says so.
//  - PLACING A MODEL ADDS TO A WORLD AND OPENING A WORLD REPLACES IT, with no undo. So Open asks
//    first whenever the student has changed something, and offers to save. A student who has
//    only walked around goes straight through.
//
// Everything specific to an edition is passed in, which is what lets HiFi run this unchanged
// against its own gallery. It never touches a renderer.
export class WorldDatabase {
  constructor({ menu, worldStore, galleryUrl, openWorld, saveWorld, loadWorldFile }) {
    Object.assign(this, { menu, worldStore, galleryUrl, openWorld, saveWorld, loadWorldFile });
    this.worlds = null;
    this.loadError = null;
    this.loadedAt = 0;
    this.loading = null;
    // Kept across openings, as the Model Database's are.
    this.topic = 'all';
    this.grade = 'all';
    this.query = '';
    this.detailId = null;
    this.opening = false;
    this.confirmBox = null;

    this.overlay = document.createElement('div');
    this.overlay.id = 'worlddb-overlay';
    this.overlay.hidden = true;
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay && !this.opening) this.close();
    });
    // PlayerController listens on window, and would walk the student around behind the panel.
    this.overlay.addEventListener('keydown', (e) => e.stopPropagation());

    this.panel = document.createElement('div');
    this.panel.id = 'worlddb-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-label', 'World Database');
    this.panel.tabIndex = -1;
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);

    this.buildShell();

    // Capture, so Esc closes this rather than reaching VRView's own Esc or the cinema's. It
    // steps back one level at a time: the question, then the details, then the panel.
    window.addEventListener('keydown', (e) => {
      if (this.overlay.hidden || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.opening) return;
      if (this.confirmBox) this.closeConfirm();
      else if (this.detailId !== null) this.showList();
      else this.close();
    }, true);
  }

  get isOpen() {
    return !this.overlay.hidden;
  }

  open() {
    this.overlay.hidden = false;
    this.render();
    this.searchInput.focus();
    this.searchInput.select();
    if (!this.worlds || Date.now() - this.loadedAt > STALE_MS) this.loadCatalog();
  }

  close() {
    this.closeConfirm();
    this.overlay.hidden = true;
  }

  el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A link out of the app. noopener: a page opened without it can reach back through
  // window.opener and navigate the app out from under the student.
  link(text, href, className) {
    const a = this.el('a', className, text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  // The catalogue's paths are relative to the gallery's own directory.
  url(path) {
    return new URL(path, new URL(this.galleryUrl, window.location.href)).href;
  }

  async loadCatalog() {
    if (this.loading) return this.loading;
    this.loadError = null;
    if (!this.worlds) this.render();
    this.loading = fetchWorldCatalog(this.url('catalog.php'))
      .then((data) => {
        this.worlds = data.worlds;
        this.loadedAt = Date.now();
      })
      .catch((err) => {
        console.error('Could not load the world list:', err);
        // A background refresh that fails keeps the list the student is already reading.
        if (!this.worlds) this.loadError = err.message;
      })
      .finally(() => {
        this.loading = null;
        // Not while they are reading a world or answering the question, which would tear the
        // screen out from under them for a list that has probably not changed.
        if (this.isOpen && this.detailId === null && !this.confirmBox) this.render();
      });
    return this.loading;
  }

  buildShell() {
    const head = this.el('div', 'mdb-head');
    head.appendChild(this.el('h2', 'mdb-title', 'World Database'));

    this.searchInput = this.el('input', 'mdb-search');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search: dinosaurs, the Moon, coding, Egypt…';
    this.searchInput.setAttribute('aria-label', 'Search the worlds');
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value;
      this.detailId = null;
      this.closeConfirm();
      this.render();
    });

    const gradeWrap = this.el('label', 'mdb-grade');
    gradeWrap.appendChild(this.el('span', null, 'Grade'));
    this.gradeSelect = this.el('select');
    this.gradeSelect.appendChild(new Option('All', 'all'));
    for (const band of GRADE_BANDS) this.gradeSelect.appendChild(new Option(band, band));
    this.gradeSelect.addEventListener('change', () => {
      this.grade = this.gradeSelect.value;
      this.detailId = null;
      this.closeConfirm();
      this.render();
    });
    gradeWrap.appendChild(this.gradeSelect);

    const closeBtn = this.el('button', 'menu-btn mdb-close', '✕');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close the World Database');
    closeBtn.addEventListener('click', () => { if (!this.opening) this.close(); });
    head.append(this.searchInput, gradeWrap, closeBtn);

    const body = this.el('div', 'mdb-body');
    this.rail = this.el('nav', 'mdb-rail');
    this.rail.setAttribute('aria-label', 'World topics');
    this.content = this.el('div', 'mdb-content');
    body.append(this.rail, this.content);

    const foot = this.el('div', 'mdb-foot');
    this.status = this.el('div', 'mdb-status');
    this.status.setAttribute('role', 'status');
    const actions = this.el('div', 'wdb-foot-actions');
    this.saveBtn = this.el('button', 'wdb-foot-btn', 'Save this world');
    this.saveBtn.type = 'button';
    this.saveBtn.title = 'Download the world you are in as a file, to keep it or send it to someone';
    this.saveBtn.addEventListener('click', () => this.saveWorld?.());
    actions.append(
      this.saveBtn,
      this.link('Worlds shared by others ↗', this.url(''), 'wdb-foot-link'),
      this.link('Share a world ↗', this.url('share.php'), 'wdb-foot-link'),
    );
    foot.append(this.status, actions);

    this.panel.append(head, body, foot);
  }

  render() {
    if (this.detailId !== null) this.renderDetail();
    else this.renderList();
  }

  // A search looks through everything whichever tab is open, as the Model Database's does, and
  // the counts beside the tabs say where its results are.
  currentWorlds() {
    const matches = searchWorlds(this.query, this.worlds ?? [])
      .filter((world) => this.grade === 'all' || world.grades.includes(this.grade));
    const counts = { all: matches.length };
    for (const world of matches) {
      for (const tag of world.tags) counts[tag] = (counts[tag] ?? 0) + 1;
    }
    const searching = this.query.trim().length > 0;
    const visible = !searching && this.topic !== 'all'
      ? matches.filter((world) => world.tags.includes(this.topic))
      : matches;
    return { visible, counts, searching };
  }

  renderRail(counts) {
    this.rail.innerHTML = '';
    for (const topic of [{ key: 'all', label: 'All worlds', icon: '✦' }, ...WORLD_TOPICS]) {
      const btn = this.el('button', 'mdb-rail-btn');
      btn.type = 'button';
      btn.append(this.el('span', 'mdb-rail-icon', topic.icon), this.el('span', 'mdb-rail-label', topic.label),
        this.el('span', 'mdb-rail-count', this.worlds ? String(counts[topic.key] ?? 0) : ''));
      if (topic.key === this.topic) {
        btn.classList.add('is-on');
        btn.setAttribute('aria-current', 'true');
      }
      btn.addEventListener('click', () => {
        this.topic = topic.key;
        this.detailId = null;
        this.closeConfirm();
        this.renderList();
        this.content.scrollTop = 0;
      });
      this.rail.appendChild(btn);
    }
  }

  // Every word on a card or a page is the database's, so it only ever goes in as text.
  renderMessage(title, line, buttons = []) {
    const box = this.el('div', 'mdb-empty');
    box.append(this.el('p', 'mdb-empty-title', title));
    if (line) box.appendChild(this.el('p', null, line));
    if (buttons.length) {
      const row = this.el('div', 'wdb-message-actions');
      row.append(...buttons);
      box.appendChild(row);
    }
    this.content.appendChild(box);
  }

  renderList() {
    this.saveBtn.hidden = false;
    this.content.innerHTML = '';

    if (!this.worlds) {
      this.renderRail({});
      if (this.loadError) {
        const retry = this.el('button', 'mdb-card-place wdb-message-btn', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => this.loadCatalog());
        const file = this.el('button', 'wdb-foot-btn wdb-message-btn', 'Load a World File instead');
        file.type = 'button';
        file.addEventListener('click', () => { this.close(); this.loadWorldFile?.(); });
        this.renderMessage(this.loadError, 'Your world is still here, and nothing has changed.', [retry, file]);
        this.status.textContent = 'The world list did not load';
      } else {
        this.renderMessage('Getting the list of worlds…');
        this.status.textContent = 'Loading…';
      }
      return;
    }

    const { visible, counts, searching } = this.currentWorlds();
    if (searching) this.topic = 'all';
    this.renderRail(counts);

    if (!visible.length) {
      this.renderMessage(
        searching ? `No worlds match “${this.query.trim()}”.` : 'No worlds for this grade here.',
        'Try a shorter word or another grade, or look through the worlds shared by others.',
      );
      this.status.textContent = 'No worlds found';
      return;
    }

    const grid = this.el('div', 'mdb-grid');
    for (const world of visible) grid.appendChild(this.card(world));
    this.content.appendChild(grid);
    this.status.textContent = `${visible.length} world${visible.length === 1 ? '' : 's'}`;
  }

  picture(world, path, className, alt = '') {
    const wrap = this.el('div', className);
    const img = this.el('img');
    img.alt = alt;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = this.url(path);
    img.addEventListener('error', () => {
      img.remove();
      wrap.classList.add('mdb-no-picture');
      wrap.textContent = '🌍';
    });
    wrap.appendChild(img);
    return wrap;
  }

  card(world) {
    const card = this.el('article', 'mdb-card');
    // Two buttons rather than one clickable card with a button inside it, because nested
    // controls are not reachable by keyboard.
    const details = this.el('button', 'mdb-card-open');
    details.type = 'button';
    details.setAttribute('aria-label', `${world.title}: details`);
    details.append(this.picture(world, world.thumb, 'mdb-thumb'), this.el('span', 'mdb-card-title', world.title),
      this.el('span', 'mdb-card-type', world.band || `by ${world.creator}`));
    details.addEventListener('click', () => {
      this.detailId = world.id;
      this.renderDetail();
    });

    const open = this.el('button', 'mdb-card-place', 'Open');
    open.type = 'button';
    open.setAttribute('aria-label', `Open ${world.title}`);
    open.addEventListener('click', () => this.requestOpen(world));

    card.append(details, open);
    return card;
  }

  showList() {
    this.detailId = null;
    this.closeConfirm();
    this.renderList();
    this.searchInput.focus();
  }

  renderDetail() {
    const world = this.worlds?.find((candidate) => candidate.id === this.detailId);
    if (!world) { this.showList(); return; }
    this.content.innerHTML = '';
    this.status.textContent = world.title;

    const detail = this.el('div', 'mdb-detail');
    const back = this.el('button', 'menu-btn mdb-back', '← All worlds');
    back.type = 'button';
    back.addEventListener('click', () => this.showList());

    const shot = this.picture(world, world.shot, 'wdb-shot', `A view of ${world.title}`);

    const info = this.el('div', 'mdb-info');
    // "Built in" is the seeder's group for every world that ships with the app, and says
    // nothing beside a name.
    const by = world.group && world.group !== 'Built in' ? `${world.creator} · ${world.group}` : world.creator;
    info.append(
      this.el('div', 'mdb-eyebrow', `🌍 ${world.place}`),
      this.el('h3', 'mdb-detail-title', world.title),
      this.el('p', 'wdb-by', `Built by ${by}`),
    );

    const open = this.el('button', 'mdb-place-big', 'Open this world');
    open.type = 'button';
    open.addEventListener('click', () => this.requestOpen(world));
    info.appendChild(open);
    info.appendChild(this.el('p', 'mdb-note', this.worldStore.hasChanges
      ? 'This replaces the world you are in, so you will be asked about your changes first.'
      : 'This replaces the world you are in.'));

    info.appendChild(this.el('p', 'mdb-blurb wdb-description', world.description));

    const sizes = this.el('dl', 'mdb-sizes');
    sizes.append(this.el('dt', null, 'Objects'), this.el('dd', null, String(world.objects)));
    if (world.band) sizes.append(this.el('dt', null, 'Grades'), this.el('dd', null, world.band.replace(/^Grades\s*/, '')));
    if (world.tags.length) sizes.append(this.el('dt', null, 'Tags'), this.el('dd', null, world.tags.join(', ')));
    if (world.standards) sizes.append(this.el('dt', null, 'Aligns to'), this.el('dd', null, world.standards));
    info.appendChild(sizes);

    if (world.objective) {
      const objective = this.el('p', 'mdb-try');
      objective.append(this.el('strong', null, 'Students will: '), document.createTextNode(world.objective));
      info.appendChild(objective);
    }

    const links = this.el('div', 'wdb-links');
    for (const lesson of world.lessons) links.appendChild(this.link(`${lesson.label} ↗`, this.url(lesson.url), 'wdb-link'));
    links.appendChild(this.link('This world’s page in the gallery ↗', this.url(world.page), 'wdb-link'));
    info.appendChild(links);

    detail.append(back, shot, info);
    this.content.appendChild(detail);
    this.content.scrollTop = 0;
    open.focus({ preventScroll: true });
  }

  // --- opening ------------------------------------------------------------------------

  requestOpen(world) {
    if (this.opening) return;
    if (this.worldStore.hasChanges) this.showConfirm(world);
    else this.openNow(world);
  }

  // Inside the panel rather than window.confirm(), which stops the animate loop and has nowhere
  // to put a Save button. Focus starts on Keep, so an Enter pressed by accident loses nothing.
  showConfirm(world, saved = false) {
    this.closeConfirm();
    const box = this.el('div', 'wdb-confirm');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', `Open ${world.title}?`);
    const card = this.el('div', 'wdb-confirm-card');
    card.appendChild(this.el('h3', 'wdb-confirm-title', `Open ${world.title}?`));
    card.appendChild(this.el('p', null, saved
      ? 'Your world is saved to a file in your downloads. Opening this one replaces what is here now.'
      : 'This replaces the world you are in, including your changes, and there is no undo. Save a copy first if you want to keep it.'));

    const buttons = this.el('div', 'wdb-confirm-actions');
    const keep = this.el('button', 'wdb-foot-btn', 'Keep this world');
    keep.type = 'button';
    keep.addEventListener('click', () => this.closeConfirm());
    buttons.appendChild(keep);
    if (!saved) {
      const save = this.el('button', 'wdb-confirm-save', 'Save this world first');
      save.type = 'button';
      save.addEventListener('click', async () => {
        save.disabled = true;
        const ok = await this.saveWorld?.();
        if (ok) this.showConfirm(world, true);
        else save.disabled = false;
      });
      buttons.appendChild(save);
    }
    const go = this.el('button', saved ? 'wdb-confirm-save' : 'wdb-confirm-go', saved ? `Open ${world.title}` : 'Open it anyway');
    go.type = 'button';
    go.addEventListener('click', () => this.openNow(world));
    buttons.appendChild(go);
    card.appendChild(buttons);
    box.appendChild(card);
    this.panel.appendChild(box);
    this.confirmBox = box;
    keep.focus();
  }

  closeConfirm() {
    if (!this.confirmBox) return;
    this.confirmBox.remove();
    this.confirmBox = null;
  }

  async openNow(world) {
    if (this.opening) return;
    this.closeConfirm();
    this.opening = true;
    this.panel.classList.add('is-opening');
    this.status.textContent = `Opening ${world.title}…`;
    try {
      // Building a world holds the main thread, so let that line paint first.
      await new Promise((resolve) => { setTimeout(resolve, 30); });
      // It fetches and checks the file BEFORE it wipes anything, so a failure here leaves the
      // student's world exactly as it was and the panel still open on the world they chose.
      await this.openWorld(world.id);
      this.close();
      this.menu?.toast(`${world.title} is ready. Walk in and take a look.`, { tone: 'success' });
    } catch (err) {
      console.error(`Could not open world ${world.id}:`, err);
      this.status.textContent = 'That world did not open.';
      this.menu?.toast(err?.message || `Could not open ${world.title}.`, { tone: 'error' });
    } finally {
      this.opening = false;
      this.panel.classList.remove('is-opening');
    }
  }
}
