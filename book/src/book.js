// Turns the book's shorthand tags into print markup, numbers the pages and sets each
// one recto or verso. Runs in the browser, so the same book.html previews in any
// browser and prints to the KDP PDF identically. Sets window.__bookReady when done.
(() => {
  const PARTS = {
    p0: '', p1: 'Part 1 · Meet Edusim', p2: 'Part 2 · First projects',
    p3: 'Part 3 · Build it', p4: 'Part 4 · Code it', pb: 'More to explore',
  };

  // --- shape icons (parts lists) --------------------------------------------------
  const ICON = {
    cube: '<svg viewBox="0 0 40 40"><path d="M20 4 35 12 20 20 5 12Z" fill="currentColor"/><path d="M20 4 35 12 20 20 5 12Z" fill="#fff" fill-opacity=".35"/><path d="M5 12 20 20 20 37 5 29Z" fill="currentColor"/><path d="M35 12 20 20 20 37 35 29Z" fill="currentColor"/><path d="M35 12 20 20 20 37 35 29Z" fill="#000" fill-opacity=".18"/><path d="M20 4 35 12 35 29 20 37 5 29 5 12Z" fill="none" stroke="#1e2a3a" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 12 20 20 35 12M20 20V37" fill="none" stroke="#1e2a3a" stroke-width="1.2"/></svg>',
    sphere: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="currentColor" stroke="#1e2a3a" stroke-width="1.6"/><ellipse cx="14" cy="13" rx="5.5" ry="4" fill="#fff" fill-opacity=".55"/><path d="M8 26a16 16 0 0 0 24 0" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="5"/></svg>',
    cylinder: '<svg viewBox="0 0 40 40"><path d="M7 10v20c0 3.3 5.8 6 13 6s13-2.7 13-6V10" fill="currentColor"/><path d="M26 11v23c4-1 7-2.5 7-4V10Z" fill="#000" fill-opacity=".16"/><ellipse cx="20" cy="10" rx="13" ry="6" fill="currentColor"/><ellipse cx="20" cy="10" rx="13" ry="6" fill="#fff" fill-opacity=".35"/><path d="M7 10v20c0 3.3 5.8 6 13 6s13-2.7 13-6V10" fill="none" stroke="#1e2a3a" stroke-width="1.6"/><ellipse cx="20" cy="10" rx="13" ry="6" fill="none" stroke="#1e2a3a" stroke-width="1.6"/></svg>',
    tetrahedron: '<svg viewBox="0 0 40 40"><path d="M20 4 4 32 24 36Z" fill="currentColor"/><path d="M20 4 4 32 24 36Z" fill="#fff" fill-opacity=".3"/><path d="M20 4 24 36 36 28Z" fill="currentColor"/><path d="M20 4 24 36 36 28Z" fill="#000" fill-opacity=".18"/><path d="M20 4 4 32 24 36 36 28Z M20 4 24 36" fill="none" stroke="#1e2a3a" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  };

  // --- spatial-skill badges ------------------------------------------------------
  const SKILL = {
    rotation: ['Mental rotation', '<svg viewBox="0 0 40 40"><rect x="13" y="13" width="14" height="14" rx="2" fill="#3d8bf2" stroke="#1e2a3a" stroke-width="1.6" transform="rotate(20 20 20)"/><path d="M8 20a12 12 0 0 1 20-9" fill="none" stroke="#1e2a3a" stroke-width="2.2" stroke-linecap="round"/><path d="M25 7l4 4-5 2" fill="none" stroke="#1e2a3a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M32 20a12 12 0 0 1-20 9" fill="none" stroke="#1e2a3a" stroke-width="2.2" stroke-linecap="round"/><path d="M15 33l-4-4 5-2" fill="none" stroke="#1e2a3a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
    visualisation: ['Spatial visualisation', '<svg viewBox="0 0 40 40"><g stroke="#1e2a3a" stroke-width="1.5"><rect x="15" y="4" width="10" height="10" fill="#f2a541"/><rect x="5" y="14" width="10" height="10" fill="#f2a541"/><rect x="15" y="14" width="10" height="10" fill="#ffc96b"/><rect x="25" y="14" width="10" height="10" fill="#f2a541"/><rect x="15" y="24" width="10" height="10" fill="#f2a541"/></g><path d="M30 30l5 5" stroke="#1e2a3a" stroke-width="2" stroke-linecap="round"/></svg>'],
    orientation: ['Spatial orientation', '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="#fff" stroke="#1e2a3a" stroke-width="1.8"/><path d="M20 7l5 13h-10Z" fill="#e0455f" stroke="#1e2a3a" stroke-width="1.3" stroke-linejoin="round"/><path d="M20 33l-5-13h10Z" fill="#3fb37f" stroke="#1e2a3a" stroke-width="1.3" stroke-linejoin="round"/><circle cx="20" cy="20" r="2" fill="#1e2a3a"/></svg>'],
    relations: ['Spatial relations', '<svg viewBox="0 0 40 40"><path d="M6 8h10v4a3 3 0 1 0 6 0V8h0v10h-4a3 3 0 1 0 0 6h4v8H6Z" fill="#8a5cf5" stroke="#1e2a3a" stroke-width="1.5" stroke-linejoin="round"/><path d="M24 8h10v24H22v-8h-4a3 3 0 1 1 0-6h4V8Z" fill="#3fb37f" stroke="#1e2a3a" stroke-width="1.5" stroke-linejoin="round" transform="translate(2 0)"/></svg>'],
  };

  // --- block chips -------------------------------------------------------------------
  // Category by the words a block starts with -- the app's own labels.
  const CATEGORY = [
    [/^(repeat|forever|wait|when |duplicate)/, 'ctrl'],
    [/^(move forward|move up by|glide|rotate|go back to start)/, 'motion'],
    [/^(say|tell|change size|set size|set opacity|change color|marker|erase all marks)/, 'look'],
  ];
  const catOf = (text) => (CATEGORY.find(([re]) => re.test(text)) || [, 'ctrl'])[1];

  function blockHTML(line) {
    const cat = catOf(line);
    const hat = /^when /.test(line);
    const body = line
      .replace(/\[(#[0-9a-fA-F]{6})\]/g, (_, hex) => `<i class="swatch" style="background:${hex}"></i>`)
      .replace(/\[([^\]]*)\]/g, (_, v) => `<i>${v}</i>`);
    return `<span class="blk ${cat}${hat ? ' hat' : ''}">${body}</span>`;
  }

  // Lines; a line ending in "{" opens a C-block whose children run to the matching "}".
  function codeHTML(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    let i = 0;
    const walk = () => {
      let out = '';
      while (i < lines.length) {
        const line = lines[i++];
        if (line === '}') return out;
        if (line.endsWith('{')) {
          const head = line.slice(0, -1).trim();
          const cat = catOf(head);
          out += `<div class="cblk ${cat}" style="--c:var(--${cat})">${blockHTML(head)}<div class="inner">${walk()}</div><div class="foot"></div></div>`;
        } else out += blockHTML(line);
      }
      return out;
    };
    return walk();
  }

  // --- typed code (Basic Beginner / Basic Pro) -------------------------------------------
  // The same program as text, coloured the way the app's text editor colours it: a line's
  // command words take its BLOCK CATEGORY's colour (so `rotate` is the same blue as the
  // rotate block), numbers are orange, the student's own words gold, names green. Set in
  // Fredoka, not a monospace face: the book embeds only its own three typefaces, and a
  // system monospace font would be embedded in a PDF being sold. So indentation is drawn as
  // a step, not typed as spaces.
  const TYPE_WORDS = new Set(('repeat times time forever wait second seconds when an object says i hear the sun comes '
    + 'up goes down it is middle of day gets dark this world opens duplicate ft feet away if more less than at most least '
    + 'until move forward and by glide over smoothly straight bouncy rotate degrees set tilt to go back start say tell '
    + 'change size opacity color colour marker erase all marks share with every random plus minus divided square root').split(' '));
  const TYPE_CAT = [...CATEGORY, [/^(tell|set size|set opacity|set tilt)/, 'look'], [/^(set|change|share)\b/, 'math']];
  const typeCat = (line) => (TYPE_CAT.find(([re]) => re.test(line)) || [, 'ctrl'])[1];

  function typedLine(line) {
    const cat = typeCat(line);
    // Where the student's own words start: everything after `say`, `tell <name>` and
    // `when an object says` is their text, even a word that is also a command word.
    const textFrom = /^say\s/.test(line) ? 1 : /^tell\s/.test(line) ? 2 : /^when an object says\s/.test(line) ? 4 : Infinity;
    let word = 0;
    return line.split(/(\s+|"[^"]*"|-?\d+(?:\.\d+)?%?)/).filter((t) => t !== '').map((t) => {
      const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      if (/^\s+$/.test(t)) return esc;
      const index = word++;
      if (/^"/.test(t)) return `<span class="ty-s">${esc}</span>`;
      if (index >= textFrom) return `<span class="ty-s">${esc}</span>`;
      if (/^-?\d/.test(t)) return `<span class="ty-n">${esc}</span>`;
      if (/^[=<>+*\/^-]+$/.test(t)) return `<span class="ty-o">${esc}</span>`;
      if (TYPE_WORDS.has(t.toLowerCase())) return `<span class="ty-k" style="color:var(--${cat}-ty)">${esc}</span>`;
      return `<span class="ty-v">${esc}</span>`;
    }).join('');
  }

  function typedHTML(text) {
    const raw = text.split('\n').filter((l) => l.trim());
    const margin = Math.min(...raw.map((l) => l.match(/^ */)[0].length));
    return raw.map((l) => {
      const depth = Math.round((l.match(/^ */)[0].length - margin) / 4);
      return `<div class="ty-line" style="--d:${depth}">${typedLine(l.trim())}</div>`;
    }).join('');
  }

  const GLYPH = {
    '\u25B8': '<svg class="g" viewBox="0 0 10 10"><path d="M3 1.6 8.2 5 3 8.4Z" fill="currentColor"/></svg>',
    '\u2630': '<svg class="g" viewBox="0 0 10 10"><path d="M1.5 2.5h7M1.5 5h7M1.5 7.5h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    '\u2605': '<svg class="g" viewBox="0 0 10 10"><path d="M5 .9 6.2 3.6 9.1 3.9 6.9 5.8 7.5 8.7 5 7.2 2.5 8.7 3.1 5.8.9 3.9 3.8 3.6Z" fill="currentColor"/></svg>',
    '\u2713': '<svg class="g" viewBox="0 0 10 10"><path d="M1.8 5.3 4 7.5 8.4 2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '\u2190': '<svg class="g" viewBox="0 0 10 10"><path d="M8.5 5H1.8M4.6 2.2 1.8 5l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '\u2191': '<svg class="g" viewBox="0 0 10 10"><path d="M5 8.5V1.8M2.2 4.6 5 1.8l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '\u2192': '<svg class="g" viewBox="0 0 10 10"><path d="M1.5 5h6.7M5.4 2.2 8.2 5 5.4 7.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    '\u2193': '<svg class="g" viewBox="0 0 10 10"><path d="M5 1.5v6.7M2.2 5.4 5 8.2l2.8-2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  const BOX = { try: ['Try it!', '!'], watch: ['Watch out', '!'], yourturn: ['Your turn', '★'], teacher: ['For teachers', 'i'], unstuck: ['Get unstuck', '?'], fact: ['Did you know?', '★'] };

  function render() {
    for (const el of document.querySelectorAll('x-shot')) {
      const ratio = el.getAttribute('ratio') || '16x10';
      const fig = document.createElement('figure');
      fig.className = `shot a${ratio} ${el.className}`;
      const pos = el.getAttribute('pos') ? ` style="object-position:${el.getAttribute('pos')}"` : '';
      const marks = [...el.querySelectorAll('x-mark')].map((m) => `<span class="callout" style="left:${m.getAttribute('x')}%;top:${m.getAttribute('y')}%">${m.textContent}</span>`).join('');
      el.querySelectorAll('x-mark').forEach((m) => m.remove());
      const cap = el.innerHTML.trim();
      fig.innerHTML = `<div class="frame"><img src="${el.getAttribute('src').includes('/') ? el.getAttribute('src') : `../assets/print/${el.getAttribute('src')}.jpg`}"${pos} alt="">${marks}</div>${cap ? `<figcaption>${cap}</figcaption>` : ''}`;
      el.replaceWith(fig);
    }
    for (const el of document.querySelectorAll('x-code')) {
      const div = document.createElement('div');
      div.className = `code ${el.className}`;
      div.innerHTML = codeHTML(el.textContent);
      el.replaceWith(div);
    }
    for (const el of document.querySelectorAll('x-type')) {
      const div = document.createElement('div');
      const level = el.getAttribute('level') === '2' ? 'Basic Pro' : 'Basic Beginner';
      div.className = `typed ${el.className}`;
      div.innerHTML = `<div class="ty-bar"><i></i><i></i><i></i><span>${level}</span></div><div class="ty-body">${typedHTML(el.textContent)}</div>`;
      el.replaceWith(div);
    }
    for (const el of document.querySelectorAll('x-blk')) {
      el.outerHTML = blockHTML(el.textContent.trim());
    }
    for (const el of document.querySelectorAll('x-part')) {
      const shape = el.getAttribute('shape');
      el.outerHTML = `<div class="part"><span style="color:${el.getAttribute('color')}">${ICON[shape]}</span><span><span class="n">${el.getAttribute('n') || 1} ×</span> ${el.innerHTML}</span></div>`;
    }
    for (const el of document.querySelectorAll('x-icon')) {
      el.outerHTML = `<span class="icon" style="display:inline-block;width:${el.getAttribute('size') || '0.3in'};color:${el.getAttribute('color')}">${ICON[el.getAttribute('shape')]}</span>`;
    }
    for (const el of document.querySelectorAll('x-skill')) {
      const [label, svg] = SKILL[el.getAttribute('kind')];
      el.outerHTML = `<span class="skill">${svg}<span>${el.textContent.trim() || label}</span></span>`;
    }
    for (const el of document.querySelectorAll('x-box')) {
      const kind = el.getAttribute('kind');
      const [title, icon] = BOX[kind];
      const div = document.createElement('div');
      div.className = `box ${kind} ${el.className}`;
      div.innerHTML = `<div class="box-title"><span class="box-icon">${icon}</span>${el.getAttribute('title') || title}</div>${el.innerHTML}`;
      el.replaceWith(div);
    }

    // The main picture on a page takes up whatever room the page leaves over, so a
    // short page reads as a big picture rather than as a gap above the folio. Only
    // the first landscape picture sitting directly in the safe area grows; flex-grow
    // can only take spare room, so this never pushes anything off a page. A picture
    // carrying numbered callouts keeps its shape: cropping it would move them off target.
    for (const safe of document.querySelectorAll('.safe')) {
      const shot = [...safe.children].find((c) => c.classList.contains('shot') && /\ba(16x10|4x3|3x2)\b/.test(c.className) && !c.classList.contains('title-shot') && !c.classList.contains('nofill') && !c.querySelector('.callout'));
      if (shot) shot.classList.add('fill');
    }

    // Symbols the book's three typefaces don't carry are drawn, not typed. Left as text
    // they fall back to whatever the machine has (Lucida Grande, Apple Symbols, PingFang),
    // and that system font then gets embedded in a PDF that is being sold.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[\u25B8\u2630\u2605\u2713\u2190-\u2193]/.test(n.nodeValue)) hits.push(n);
    for (const n of hits) {
      const span = document.createElement('span');
      span.innerHTML = n.nodeValue.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/[\u25B8\u2630\u2605\u2713\u2190-\u2193]/g, (c) => GLYPH[c]);
      n.replaceWith(...span.childNodes);
    }

    // Number the pages, set recto / verso, and add folios and part tabs.
    const pages = [...document.querySelectorAll('section.page')];
    pages.forEach((page, i) => {
      const n = i + 1;
      page.dataset.n = n;
      page.classList.add(n % 2 ? 'recto' : 'verso');
      const part = [...page.classList].find((c) => /^p[0-4b]$/.test(c)) || 'p0';
      if (!page.classList.contains('no-tab') && /^p[1-4]$/.test(part)) {
        page.insertAdjacentHTML('beforeend', '<div class="tab"></div>');
      }
      if (!page.classList.contains('no-folio')) {
        page.insertAdjacentHTML('beforeend', `<div class="folio"><span class="num">${n}</span><span>${page.dataset.folio || PARTS[part] || ''}</span></div>`);
      }
    });
    decorate(pages);
    document.querySelectorAll('[data-page-of]').forEach((el) => {
      const target = document.getElementById(el.dataset.pageOf);
      el.textContent = target ? target.closest('section.page').dataset.n : '?';
    });
  }

  // --- the colour layer (see the end of book.css) ---------------------------------------
  // Seeded per page, never Math.random: the book must come out the same on every build.
  function seeded(seed) {
    let x = (seed * 2654435761) >>> 0;
    return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const SHAPES = ['cube', 'sphere', 'cylinder', 'tetrahedron'];
  const CONFETTI = ['#ffc93c', '#e0455f', '#3d8bf2', '#3fb37f', '#f2a541', '#8a5cf5', '#ffffff'];

  // A row of tiny flat shapes across the strip: circles, squares and triangles in white.
  function stripSVG(rand) {
    let out = '';
    for (let x = 0.2; x < 6.1; x += 0.34 + rand() * 0.18) {
      const y = 0.2 + rand() * 0.1;
      const r = 0.035 + rand() * 0.025;
      const kind = Math.floor(rand() * 3);
      const op = (0.22 + rand() * 0.2).toFixed(2);
      if (kind === 0) out += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="${op}"/>`;
      else if (kind === 1) out += `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" rx="0.01" fill="#fff" fill-opacity="${op}" transform="rotate(${Math.round(rand() * 40 - 20)} ${x} ${y})"/>`;
      else out += `<path d="M${x} ${y - r * 1.1} L${x + r * 1.1} ${y + r * 0.9} L${x - r * 1.1} ${y + r * 0.9}Z" fill="#fff" fill-opacity="${op}"/>`;
    }
    return `<svg viewBox="0 0 6.125 0.36" preserveAspectRatio="none">${out}</svg>`;
  }

  const shapeSpan = (shape, color, left, top, size, turn, extra = '') =>
    `<span style="left:${left}in;top:${top}in;width:${size}in;color:${color};transform:rotate(${turn}deg);${extra}">${ICON[shape]}</span>`;

  function decorate(pages) {
    let section = 0;
    pages.forEach((page, i) => {
      const n = i + 1;
      const rand = seeded(n * 97 + 13);
      const recto = n % 2 === 1;
      // The RIGHT-hand side of the page, measured in from the trim's right edge. On a recto
      // that is the outside margin; on a verso it is the gutter, so it keeps 0.18 in clear of
      // the spine. Never the left: a verso's left margin is where the chapter number sits.
      const fromRight = (inset, size) => (recto ? 6.0 - inset - size : 6.125 - 0.18 - inset - size);

      if (!page.classList.contains('no-folio') && !page.classList.contains('no-strip')) {
        page.insertAdjacentHTML('afterbegin', `<div class="strip">${stripSVG(rand)}</div>`);
      }

      const band = page.querySelector('.chapter-band');
      if (band) {
        let html = '<div class="band-top"><div class="band-shapes">';
        // One big faint watermark shape running off the outside edge, behind everything.
        html += shapeSpan(SHAPES[n % 4], '#ffffff', recto ? 6.0 - 1.15 : 6.125 - 1.3, 0.15, 1.5, -12, 'opacity:0.16');
        // Three small bright shapes in the outside margin and the top corner.
        const picks = [0, 1, 2].map((k) => SHAPES[(n + k) % 4]);
        html += shapeSpan(picks[0], '#ffc93c', fromRight(0.12, 0.42), 0.48, 0.42, Math.round(rand() * 30 - 15));
        html += shapeSpan(picks[1], '#ffffff', fromRight(0.55, 0.3), 0.98, 0.3, Math.round(rand() * 40 - 20));
        html += shapeSpan(picks[2], CONFETTI[(n + 1) % 6], fromRight(0.1, 0.28), 1.12, 0.28, Math.round(rand() * 40 - 20));
        html += '</div></div>';
        band.insertAdjacentHTML('beforeend', html);
      }

      for (const title of page.querySelectorAll('.section-title')) {
        title.insertAdjacentHTML('afterbegin', `<span class="sec-shape">${ICON[SHAPES[section++ % 4]]}</span>`);
      }

      if (page.classList.contains('opener')) {
        let html = '<div class="confetti">';
        // Above the title and beside the short PART pill, never over the title itself, which
        // can run the full width of the page.
        const spots = [[2.45, 0.84, 0.3], [3.05, 0.4, 0.42], [3.85, 0.72, 0.32], [4.55, 0.3, 0.5], [5.3, 0.78, 0.36]];
        spots.forEach(([x, y, size], k) => {
          const left = recto ? x : x + 0.125;
          html += shapeSpan(SHAPES[(n + k) % 4], CONFETTI[(k + n) % 6], left, y, size, Math.round(rand() * 50 - 25));
        });
        html += '</div>';
        page.querySelector('.title-block')?.insertAdjacentHTML('beforebegin', html);
      }
    });
  }

  // The saturated top of each chapter band reaches just past the chapter head, measured
  // once the fonts are in, so a title that wraps to two lines still sits on colour.
  function sizeBands() {
    for (const page of document.querySelectorAll('section.page')) {
      const top = page.querySelector('.chapter-band .band-top');
      const head = page.querySelector('.chapter-head');
      if (!top || !head) continue;
      const pageTop = page.getBoundingClientRect().top;
      const bottom = Math.max(...[...head.querySelectorAll('*')].map((el) => el.getBoundingClientRect().bottom), head.getBoundingClientRect().bottom);
      top.style.height = `${(bottom - pageTop) / 96 + 0.12}in`;
    }
  }

  async function ready() {
    render();
    await document.fonts.ready;
    sizeBands();
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    window.__bookReady = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
