/* ===========================================================================
 * Edusim — first-party, cookieless page counting.
 *
 * WHY THIS IS NOT GOOGLE ANALYTICS, PLAUSIBLE OR ANY OTHER HOSTED PRODUCT.
 * The whole marketing position of this site — the privacy page, the IT brief,
 * the "no student data collected at all" line on the homepage — is a claim
 * about ARCHITECTURE, not about a policy document. A third-party analytics
 * script is a request to somebody else's server carrying the visitor's IP and
 * the page they are on, made from a page a nine-year-old opened, and no
 * wording on a privacy page makes that untrue. Google Analytics was on every
 * page of this site while the site said it collected nothing; that was the
 * contradiction this file exists to remove.
 *
 * What it does instead: POSTs a path to `/worlds/hit.php` on this same origin,
 * which adds 1 to a counter. There is no id in the request, no cookie, no
 * localStorage key, nothing stored that could be joined back to a person, and
 * the server never writes an IP. What comes out the other end is
 * "/guide/teachers.html was opened 41 times on 2026-09-06" and nothing else.
 *
 * FOUR THINGS THAT ARE LOAD-BEARING:
 *
 * - It is FIRE-AND-FORGET AND CANNOT BREAK THE PAGE. Every path is inside a
 *   try/catch, the fetch has `keepalive` and a swallowed rejection, and no
 *   caller ever awaits it. An analytics endpoint that is down, blocked by an
 *   extension, or 404 on a copy of the site served from GitHub Pages must be
 *   indistinguishable from one that is working. `docs/` IS published to GitHub
 *   Pages as well, where `/worlds/hit.php` does not exist at all — so the
 *   no-endpoint case is not hypothetical, it is half the deployments.
 *
 * - IT HONOURS Do Not Track AND Global Privacy Control. Losing the visitors
 *   who asked not to be counted is the cost of being able to say, in the IT
 *   brief, that the site honours both. On this site that sentence is worth
 *   more than the data.
 *
 * - THE ONLY PER-VISITOR STATE IS A sessionStorage FLAG, AND IT NEVER LEAVES
 *   THE BROWSER. It exists so one visitor reading six pages is one `visit`,
 *   not six. The server is told "a visit happened", never which visit — so
 *   there is no identifier to leak, subpoena or lose. sessionStorage rather
 *   than localStorage because a session should end when the tab does, and it
 *   is read through a try/catch because a browser configured to block site
 *   data THROWS on access rather than returning null.
 *
 * - THE REFERRER IS REDUCED TO A BARE HOSTNAME before it is sent. A full
 *   referring URL can carry a search query, and a search query typed by a
 *   teacher is exactly the kind of thing this site promises not to hold.
 * ======================================================================== */
(function () {
  'use strict';

  // Same-origin, and root-relative rather than absolute: the site answers to
  // https://edusim3dweb.com and to the GitHub Pages mirror, and a hard-coded
  // origin would make the mirror post its traffic into production's counters.
  var ENDPOINT = '/worlds/hit.php';

  function optedOut() {
    try {
      if (navigator.globalPrivacyControl === true) return true;
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      return dnt === '1' || dnt === 'yes';
    } catch (err) {
      return false;
    }
  }

  // sessionStorage throws outright in a browser set to block site data, so both
  // the read and the write are guarded and a failure simply means the visit is
  // counted again. Over-counting a visit is a much cheaper bug than a script
  // that stops the page.
  function firstThisSession(key) {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (err) {
      return true;
    }
  }

  function referrerHost() {
    try {
      if (!document.referrer) return '';
      var host = new URL(document.referrer).hostname;
      // Arriving from another page of this site is navigation, not a referral,
      // and recording it would bury the handful of real referrers under it.
      if (host === location.hostname) return '';
      return host.slice(0, 80);
    } catch (err) {
      return '';
    }
  }

  function send(kind, path) {
    if (optedOut()) return;
    var body = JSON.stringify({
      kind: kind,
      path: (path || location.pathname).slice(0, 120),
      ref: referrerHost()
    });
    try {
      // `keepalive` is what lets the request outlive a page the visitor is
      // already navigating away from. sendBeacon would do the same, but it
      // cannot set a Content-Type the endpoint can check, and that check is
      // the cheapest CSRF-shaped guard the endpoint has.
      fetch(ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).catch(function () { /* an endpoint that is not there is not an error */ });
    } catch (err) { /* nor is a browser that refuses the request */ }
  }

  // Exposed so the app (a different bundle, on the same origin) can report the
  // one event that actually matters — a session that got as far as building
  // something — through the same opt-out checks and the same endpoint.
  window.edusimCount = send;

  if (firstThisSession('edusim.visit')) send('visit');
  send('page');
})();
