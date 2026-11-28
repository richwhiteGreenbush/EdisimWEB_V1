/* ===========================================================================
 * Edusim — "Help us share and improve Edusim", the website's feedback popup.
 *
 * WEBSITE ONLY, NEVER THE APP, per Rich. The app's promise to schools is that it
 * asks a child for nothing (docs/privacy.html, docs/schools/it-brief.html), so
 * this file is loaded by edusim-analytics.js on the marketing and guide pages,
 * whose readers are mostly teachers and parents, and nothing under /app/ or
 * /hifi/ ever loads it.
 *
 * What it does: after a visitor has been on a page for a little while, it
 * offers one-click sharing to Facebook and LinkedIn and a short feedback form,
 * which POSTs to /worlds/feedback.php. That endpoint stores the message and
 * emails it to Inventorium Lab.
 *
 * THINGS THAT ARE LOAD-BEARING:
 *
 * - ONLY THE "NOT NOW" BUTTON MEANS A MONTH, per Rich. The snooze is a localStorage
 *   date and nothing else: no id, no cookie, and it never leaves the browser.
 *   Closing it any other way (the x, Esc, a click outside) keeps it away only for
 *   the rest of that browser session, a sessionStorage flag, so it does not jump
 *   back on every page; the next visit offers it again. Sending feedback snoozes it
 *   for six months, since asking again straight away would be rude. If storage is
 *   blocked the popup NEVER appears on its own, because a popup that cannot
 *   remember being dismissed would come back on every page.
 * - IT APPEARS WITHIN TWO SECONDS OF THE PAGE BEING READY, per Rich (it was twelve).
 * - THE EMAIL FIELD EXISTS ONLY FOR ADULTS. It is hidden and disabled until the
 *   visitor ticks "I am 18 or older", and the server ignores an address sent
 *   without that tick. Students are told to leave it blank.
 * - THE SHARE BUTTONS LOAD NOTHING. They are plain links to each network's own
 *   share page, opened only when clicked. No Facebook or LinkedIn script, pixel
 *   or iframe is ever on this site.
 * - ONLY ON THE REAL SITE (and localhost, for testing). docs/ is mirrored to
 *   GitHub Pages, where /worlds/feedback.php does not exist.
 * - IT CANNOT BREAK THE PAGE. Everything is inside try/catch, and it never
 *   appears over a print.
 *
 * window.EdusimFeedback.open() opens it on demand (the home page footer has a
 * link), ignoring the snooze.
 * ======================================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/worlds/feedback.php';
  var SHARE_URL = 'https://edusim3dweb.com/';
  // Renamed from 'edusim.feedback.until' when only Not now became a month: the first version also
  // snoozed on the x and a click outside, and those snoozes must not outlive that mistake.
  var SNOOZE_KEY = 'edusim.feedback.notnow';
  var DAY = 24 * 60 * 60 * 1000;
  var NOT_NOW_DAYS = 30;
  var AFTER_SEND_DAYS = 182;
  var DELAY_MS = 1500; // plus loading this file: it shows about 1.8s after the page is ready
  var SESSION_KEY = 'edusim.feedback.closed';

  var host = location.hostname;
  var onSite = host === 'edusim3dweb.com' || host === 'www.edusim3dweb.com' || host === 'localhost' || host === '127.0.0.1';
  // THE APP AND THE GALLERIES LOAD edusim-analytics.js TOO (the app's index.html takes it from the
  // domain root, and both galleries' layout.php include it), so the loader alone does not keep this
  // off them. The marketing and guide pages are the only place it may appear: never /app/ or /hifi/,
  // where a class of students would each get it, and never a gallery, which students reach from
  // inside the app. The 3D canvas test covers the app wherever it is served from, including dev.
  var path = location.pathname;
  var notHere = /^\/(app|hifi|worlds|hifiworlds|stages)(\/|$)/.test(path) || !!document.getElementById('scene');
  if (!onSite || notHere || window.EdusimFeedback) return;

  function storageOk() {
    try {
      localStorage.setItem('edusim.feedback.test', '1');
      localStorage.removeItem('edusim.feedback.test');
      return true;
    } catch (err) {
      return false;
    }
  }
  function snoozedUntil() {
    try { return Number(localStorage.getItem(SNOOZE_KEY)) || 0; } catch (err) { return Infinity; }
  }
  function closedThisSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch (err) { return false; }
  }
  function snooze(days) {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * DAY)); } catch (err) { /* nothing to remember with */ }
  }

  var CSS = [
    '.efb-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(16,40,63,.55);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .25s ease;font-family:"Nunito","Segoe UI",system-ui,sans-serif;}',
    '.efb-backdrop.efb-in{opacity:1;}',
    '.efb-card{position:relative;width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fffdf7;border:3px solid #1e2a3a;border-radius:24px;box-shadow:0 10px 0 #1e2a3a,0 24px 60px rgba(0,0,0,.35);transform:translateY(24px) scale(.96);transition:transform .35s cubic-bezier(.2,1.4,.4,1);color:#1e2a3a;}',
    '.efb-in .efb-card{transform:none;}',
    '.efb-head{position:relative;overflow:hidden;padding:26px 26px 22px;color:#fff;background:linear-gradient(120deg,#3d8bf2 0%,#8a5cf5 45%,#e0455f 80%,#f2a541 100%);border-bottom:3px solid #1e2a3a;border-radius:21px 21px 0 0;}',
    '.efb-head h2,.efb-head p{position:relative;z-index:1;}',
    '.efb-head h2{margin:0 0 6px;padding-right:34px;font-family:"Fredoka","Nunito",system-ui,sans-serif;font-weight:700;font-size:clamp(22px,4.6vw,30px);line-height:1.1;text-shadow:0 2px 0 rgba(0,0,0,.25);position:relative;}',
    '.efb-head p{margin:0;font-size:15.5px;line-height:1.45;max-width:30em;position:relative;}',
    // Decoration tucked into the bottom edge, under the text and clear of the close button.
    '.efb-shape{position:absolute;z-index:0;opacity:.5;border:3px solid rgba(255,255,255,.6);border-radius:10px;animation:efb-float 6s ease-in-out infinite;}',
    '.efb-shape.s1{width:54px;height:54px;right:-14px;bottom:-18px;background:#ffc93c;transform:rotate(18deg);}',
    '.efb-shape.s2{width:34px;height:34px;right:58px;bottom:-14px;background:#3fb37f;border-radius:50%;animation-delay:-2s;}',
    '.efb-shape.s3{width:0;height:0;right:112px;bottom:-6px;border:none;border-left:20px solid transparent;border-right:20px solid transparent;border-bottom:34px solid rgba(255,255,255,.9);border-radius:0;animation-delay:-4s;}',
    '@keyframes efb-float{0%,100%{translate:0 0}50%{translate:0 -8px}}',
    '.efb-x{position:absolute;top:10px;right:10px;z-index:2;width:36px;height:36px;border-radius:50%;border:3px solid #1e2a3a;background:#fff;color:#1e2a3a;font:700 20px/1 "Fredoka",system-ui,sans-serif;cursor:pointer;}',
    '.efb-x:hover{background:#ffc93c;}',
    '.efb-body{padding:18px 26px 24px;}',
    '.efb-step{display:flex;align-items:center;gap:10px;margin:14px 0 10px;font-family:"Fredoka","Nunito",system-ui,sans-serif;font-weight:600;font-size:18px;}',
    '.efb-step b{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;border:3px solid #1e2a3a;color:#fff;font-size:15px;flex:none;}',
    '.efb-share{display:grid;grid-template-columns:1fr 1fr;gap:10px;}',
    '.efb-sbtn{display:flex;align-items:center;justify-content:center;gap:10px;padding:12px 14px;border-radius:14px;border:3px solid #1e2a3a;color:#fff;font:700 16px/1.1 "Fredoka","Nunito",system-ui,sans-serif;text-decoration:none;cursor:pointer;box-shadow:0 4px 0 #1e2a3a;transition:transform .12s ease,box-shadow .12s ease;}',
    '.efb-sbtn:hover{transform:translateY(-2px);box-shadow:0 6px 0 #1e2a3a;}',
    '.efb-sbtn:active{transform:translateY(3px);box-shadow:0 1px 0 #1e2a3a;}',
    '.efb-sbtn svg{width:24px;height:24px;flex:none;}',
    '.efb-fb{background:#1877f2;}',
    '.efb-li{background:#0a66c2;}',
    '.efb-copy{margin-top:8px;background:none;border:none;padding:4px 0;color:#445067;font:700 14px "Nunito",system-ui,sans-serif;text-decoration:underline;cursor:pointer;}',
    '.efb-chips{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;}',
    '.efb-chip{padding:7px 12px;border-radius:999px;border:3px solid #1e2a3a;background:#fff;color:#1e2a3a;font:700 14.5px "Nunito",system-ui,sans-serif;cursor:pointer;}',
    '.efb-chip[aria-pressed="true"]{background:var(--c);color:#fff;}',
    '.efb-label{display:block;font-weight:700;font-size:14px;margin:0 0 6px;}',
    '.efb-text,.efb-email{width:100%;box-sizing:border-box;border:3px solid #1e2a3a;border-radius:14px;padding:10px 12px;font:16px/1.4 "Nunito",system-ui,sans-serif;background:#fff;color:#1e2a3a;}',
    '.efb-text{min-height:96px;resize:vertical;}',
    '.efb-text:focus,.efb-email:focus,.efb-chip:focus-visible,.efb-sbtn:focus-visible,.efb-send:focus-visible,.efb-later:focus-visible,.efb-x:focus-visible{outline:4px solid #ffc93c;outline-offset:2px;}',
    '.efb-adult{display:flex;align-items:flex-start;gap:10px;margin:14px 0 8px;font-size:15px;line-height:1.35;cursor:pointer;}',
    '.efb-adult input{width:20px;height:20px;margin-top:1px;accent-color:#8a5cf5;flex:none;}',
    '.efb-emailwrap{display:none;margin-top:6px;}',
    '.efb-emailwrap.efb-on{display:block;}',
    '.efb-note{margin:6px 0 0;font-size:13px;color:#445067;line-height:1.4;}',
    '.efb-trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden;}',
    '.efb-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;flex-wrap:wrap;}',
    '.efb-send{padding:13px 22px;border-radius:14px;border:3px solid #1e2a3a;background:#3fb37f;color:#fff;font:700 18px/1 "Fredoka","Nunito",system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 0 #1e2a3a;}',
    '.efb-send:hover{background:#34a070;}',
    '.efb-send[disabled]{opacity:.6;cursor:progress;}',
    '.efb-later{background:none;border:none;color:#445067;font:700 15px "Nunito",system-ui,sans-serif;text-decoration:underline;cursor:pointer;padding:8px 4px;}',
    '.efb-msg{margin:10px 0 0;font-weight:700;font-size:14.5px;}',
    '.efb-msg.efb-err{color:#c0293f;}',
    '.efb-thanks{text-align:center;padding:10px 0 4px;}',
    '.efb-thanks h3{font-family:"Fredoka","Nunito",system-ui,sans-serif;font-size:26px;margin:6px 0;}',
    '.efb-thanks p{margin:0 0 14px;font-size:16px;line-height:1.45;}',
    '.efb-confetti{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:21px;}',
    '.efb-confetti i{position:absolute;top:-12px;width:10px;height:14px;border-radius:3px;animation:efb-fall 1.8s ease-in forwards;}',
    '@keyframes efb-fall{to{transform:translateY(560px) rotate(540deg);opacity:0;}}',
    '@media (max-width:480px){.efb-shape{display:none;}.efb-share{grid-template-columns:1fr;}.efb-body{padding:14px 18px 20px;}.efb-head{padding:22px 18px 18px;}}',
    '@media (prefers-reduced-motion:reduce){.efb-backdrop,.efb-card,.efb-sbtn{transition:none;}.efb-shape,.efb-confetti i{animation:none;}.efb-confetti{display:none;}}',
    '@media print{.efb-backdrop{display:none!important;}}'
  ].join('\n');

  var FB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>';
  var LI_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>';

  var TOPICS = [
    ['features', 'New features', '#3d8bf2', '✨'],
    ['worlds', 'New worlds', '#3fb37f', '🌍'],
    ['models', 'New models', '#f2a541', '🧩'],
    ['other', 'Something else', '#8a5cf5', '💡']
  ];

  var open = false;
  var openedAt = 0;
  var lastFocus = null;
  var root = null;

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    if (html != null) node.innerHTML = html;
    return node;
  }

  function shareWindow(url) {
    var w = 600;
    var h = 640;
    var left = Math.max(0, (screen.width - w) / 2);
    var top = Math.max(0, (screen.height - h) / 2);
    // Not the `noopener` FEATURE: with it window.open always returns null, so a successful popup
    // looks blocked and the link opens a second tab as well. The opener is cut by hand instead.
    var win = window.open(url, 'edusim-share', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
    if (win) { try { win.opener = null; } catch (err) { /* already cross-origin */ } }
    // A blocked popup falls back to an ordinary new tab, which the link already is.
    return !!win;
  }

  function build() {
    if (!document.getElementById('efb-style')) {
      var style = el('style', { id: 'efb-style' });
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    var fbUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(SHARE_URL);
    var liUrl = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(SHARE_URL);
    var chips = TOPICS.map(function (t) {
      return '<button type="button" class="efb-chip" aria-pressed="false" data-topic="' + t[0] + '" style="--c:' + t[2] + '"><span aria-hidden="true">' + t[3] + '</span> ' + t[1] + '</button>';
    }).join('');

    var backdrop = el('div', { 'class': 'efb-backdrop' });
    backdrop.innerHTML =
      '<div class="efb-card" role="dialog" aria-modal="true" aria-labelledby="efb-title" aria-describedby="efb-lede">' +
        '<button type="button" class="efb-x" aria-label="Close">×</button>' +
        '<div class="efb-head">' +
          '<span class="efb-shape s1"></span><span class="efb-shape s2"></span><span class="efb-shape s3"></span>' +
          '<h2 id="efb-title">Help us share and improve Edusim!</h2>' +
          '<p id="efb-lede">Edusim is free for every classroom, and it grows when people tell each other about it. A minute from you makes a real difference.</p>' +
        '</div>' +
        '<div class="efb-body">' +
          '<div class="efb-form">' +
            '<div class="efb-step"><b style="background:#3d8bf2">1</b> Share Edusim with your network</div>' +
            '<div class="efb-share">' +
              '<a class="efb-sbtn efb-fb" href="' + fbUrl + '" target="_blank" rel="noopener noreferrer" data-net="facebook">' + FB_ICON + 'Share on Facebook</a>' +
              '<a class="efb-sbtn efb-li" href="' + liUrl + '" target="_blank" rel="noopener noreferrer" data-net="linkedin">' + LI_ICON + 'Share on LinkedIn</a>' +
            '</div>' +
            '<button type="button" class="efb-copy">Or copy the link: edusim3dweb.com</button>' +

            '<div class="efb-step"><b style="background:#3fb37f">2</b> What should we build next?</div>' +
            '<div class="efb-chips" role="group" aria-label="What is your idea about?">' + chips + '</div>' +
            '<label class="efb-label" for="efb-text">Are there features, worlds or models you would love to see?</label>' +
            '<textarea id="efb-text" class="efb-text" maxlength="2000" placeholder="A world about the ocean floor, a volcano you can program, a way to build with friends…"></textarea>' +
            '<div class="efb-trap" aria-hidden="true"><label>Leave this empty <input type="text" class="efb-hp" tabindex="-1" autocomplete="off" /></label></div>' +

            '<div class="efb-step"><b style="background:#f2a541">3</b> Want a reply? <span style="font-weight:500;font-size:15px">(optional)</span></div>' +
            '<label class="efb-adult"><input type="checkbox" class="efb-isadult" /> <span>I am 18 or older, and I would like Inventorium Lab to be able to reply to me.</span></label>' +
            '<div class="efb-emailwrap">' +
              '<label class="efb-label" for="efb-email">Your email address</label>' +
              '<input id="efb-email" class="efb-email" type="email" inputmode="email" autocomplete="email" maxlength="254" disabled placeholder="you@school.org" />' +
              '<p class="efb-note">Used only to reply to this message. Never shared, never added to a mailing list.</p>' +
            '</div>' +
            '<p class="efb-note">Students: please do not type your name or email anywhere in this form.</p>' +
            '<p class="efb-msg" role="status" aria-live="polite"></p>' +
            '<div class="efb-actions">' +
              '<button type="button" class="efb-send">Send feedback 🚀</button>' +
              '<button type="button" class="efb-later">Not now</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    return backdrop;
  }

  function confetti(card) {
    var box = el('div', { 'class': 'efb-confetti', 'aria-hidden': 'true' });
    var colours = ['#e0455f', '#f2a541', '#ffc93c', '#3fb37f', '#3d8bf2', '#8a5cf5'];
    for (var i = 0; i < 46; i++) {
      var bit = document.createElement('i');
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.background = colours[i % colours.length];
      bit.style.animationDelay = (Math.random() * 0.5) + 's';
      bit.style.transform = 'rotate(' + (Math.random() * 180) + 'deg)';
      box.appendChild(bit);
    }
    card.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 2600);
  }

  // `days` is only ever given by the Not now button (a month) and by sending (six months). Every
  // close also keeps it away for the rest of this browser session.
  function close(days) {
    if (!open || !root) return;
    open = false;
    if (days) snooze(days);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (err) { /* nothing to remember with */ }
    document.removeEventListener('keydown', onKey, true);
    root.classList.remove('efb-in');
    var gone = root;
    setTimeout(function () { if (gone.parentNode) gone.parentNode.removeChild(gone); }, 260);
    root = null;
    try { if (lastFocus && lastFocus.focus) lastFocus.focus(); } catch (err) { /* the element went away */ }
  }

  // Esc is "not now", and Tab stays inside the dialog while it is open.
  function onKey(e) {
    if (!root) return;
    if (e.key === 'Escape') { e.preventDefault(); close(0); return; }
    if (e.key !== 'Tab') return;
    var focusable = Array.prototype.filter.call(
      root.querySelectorAll('button, a[href], input, textarea'),
      function (n) { return !n.disabled && n.offsetParent !== null && n.tabIndex !== -1; }
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function wire(backdrop) {
    var card = backdrop.querySelector('.efb-card');
    var msg = backdrop.querySelector('.efb-msg');
    var text = backdrop.querySelector('.efb-text');
    var adult = backdrop.querySelector('.efb-isadult');
    var emailWrap = backdrop.querySelector('.efb-emailwrap');
    var email = backdrop.querySelector('.efb-email');
    var send = backdrop.querySelector('.efb-send');

    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) close(0); });
    backdrop.querySelector('.efb-x').addEventListener('click', function () { close(0); });
    backdrop.querySelector('.efb-later').addEventListener('click', function () { close(NOT_NOW_DAYS); });

    Array.prototype.forEach.call(backdrop.querySelectorAll('.efb-sbtn'), function (a) {
      a.addEventListener('click', function (e) {
        if (shareWindow(a.href)) e.preventDefault();
        msg.className = 'efb-msg';
        msg.textContent = 'Thank you for sharing! 💙';
      });
    });
    backdrop.querySelector('.efb-copy').addEventListener('click', function () {
      var done = function () { msg.className = 'efb-msg'; msg.textContent = 'Link copied. Paste it anywhere!'; };
      try {
        navigator.clipboard.writeText(SHARE_URL).then(done, function () { msg.textContent = SHARE_URL; });
      } catch (err) { msg.textContent = SHARE_URL; }
    });
    Array.prototype.forEach.call(backdrop.querySelectorAll('.efb-chip'), function (chip) {
      chip.addEventListener('click', function () {
        chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      });
    });
    adult.addEventListener('change', function () {
      emailWrap.classList.toggle('efb-on', adult.checked);
      email.disabled = !adult.checked;
      if (!adult.checked) email.value = '';
      else email.focus();
    });

    send.addEventListener('click', function () {
      var message = text.value.trim();
      var topics = Array.prototype.filter.call(backdrop.querySelectorAll('.efb-chip'), function (c) {
        return c.getAttribute('aria-pressed') === 'true';
      }).map(function (c) { return c.getAttribute('data-topic'); });
      var address = adult.checked ? email.value.trim() : '';
      msg.className = 'efb-msg efb-err';
      if (message.length < 3) { msg.textContent = 'Tell us your idea first, even one sentence helps!'; text.focus(); return; }
      if (address && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { msg.textContent = 'That email address does not look quite right.'; email.focus(); return; }
      msg.className = 'efb-msg';
      msg.textContent = 'Sending…';
      send.disabled = true;
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message,
          topics: topics,
          adult: adult.checked,
          email: address,
          page: location.pathname.slice(0, 200),
          elapsed: Date.now() - openedAt,
          website: backdrop.querySelector('.efb-hp').value
        })
      }).then(function (res) {
        return res.json().catch(function () { return { ok: false }; }).then(function (data) { return { res: res, data: data }; });
      }).then(function (r) {
        if (!r.res.ok || !r.data || !r.data.ok) throw new Error((r.data && r.data.error) || 'failed');
        snooze(AFTER_SEND_DAYS);
        var form = backdrop.querySelector('.efb-form');
        form.innerHTML =
          '<div class="efb-thanks" role="status">' +
            '<div style="font-size:46px" aria-hidden="true">🎉</div>' +
            '<h3>Thank you!</h3>' +
            '<p>Your idea is on its way to the Edusim team. Ideas like yours are how new worlds and models get made.</p>' +
            '<button type="button" class="efb-send efb-done">Back to Edusim</button>' +
          '</div>';
        form.querySelector('.efb-done').addEventListener('click', function () { close(0); });
        form.querySelector('.efb-done').focus();
        confetti(card);
      }).catch(function (err) {
        send.disabled = false;
        msg.className = 'efb-msg efb-err';
        msg.textContent = String(err && err.message) === 'too_many'
          ? 'Thank you! We have had a lot from this network today. Please try again tomorrow.'
          : 'Sorry, that did not send. Please try again in a moment.';
      });
    });
  }

  function show() {
    if (open || !document.body || document.getElementById('scene')) return;
    try {
      open = true;
      openedAt = Date.now();
      lastFocus = document.activeElement;
      root = build();
      wire(root);
      document.body.appendChild(root);
      document.addEventListener('keydown', onKey, true);
      // Two frames, so the transition runs from the hidden state.
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (root) root.classList.add('efb-in'); }); });
      var first = root.querySelector('.efb-fb');
      if (first) first.focus({ preventScroll: true });
    } catch (err) {
      open = false;
    }
  }

  window.EdusimFeedback = { open: show };
  // Any link marked data-edusim-feedback opens it on purpose, snooze or not (the home page footer).
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-edusim-feedback]') : null;
    if (!a) return;
    e.preventDefault();
    show();
  });

  try {
    if (!storageOk()) return;
    if (snoozedUntil() > Date.now() || closedThisSession()) return;
    if (/[?&]nofeedback\b/.test(location.search)) return;
    setTimeout(function () {
      // A visitor who has wandered off to another tab gets it when they come back, not unseen.
      if (document.visibilityState === 'hidden') {
        var onVisible = function () {
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', onVisible);
          if (snoozedUntil() <= Date.now()) show();
        };
        document.addEventListener('visibilitychange', onVisible);
      } else if (snoozedUntil() <= Date.now()) {
        show();
      }
    }, DELAY_MS);
  } catch (err) { /* never a reason to break the page */ }
})();
