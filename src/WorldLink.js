import { parseWorldPayload } from './WorldFile.js';
import { WORLD_LINK_PARAM, WORLD_LINK_BASE } from './config.js';

// Opening a shared world straight from a link: edusim.../?world=24 loads world #24 out of
// the gallery and drops the student into it, with no download and no file picker.
//
// ---------------------------------------------------------------------------
// The link carries an ID, never a URL
// ---------------------------------------------------------------------------
//
// `?world=24` and not `?world=http://…/some.json`, and that is the whole security design
// of this file rather than a shortcut. A parameter naming an arbitrary address turns every
// copy of Edusim into something that will fetch and display whatever a link tells it to,
// from a url that still starts with the real app's address -- which is exactly the shape a
// convincing phishing link wants. An integer resolved against a fixed base cannot point
// anywhere but the gallery, so there is no allowlist to keep up to date and no way to aim
// it somewhere else.
//
// ---------------------------------------------------------------------------
// Why WORLD_LINK_BASE is root-relative, and what that means for the Railway copy
// ---------------------------------------------------------------------------
//
// The fetch has to be SAME-ORIGIN, and not for tidiness: the gallery is served over plain
// http (edusim3dweb.com has no TLS), and a page served over https may not fetch an http
// url at all. Browsers block it outright as mixed content -- the same wall the in-world
// browser panel runs into, and there is no client-side way round either of them.
//
// So this only works where the app and the gallery share an origin, which is why deploy.sh
// now also publishes the app to the gallery's own host. On the Railway copy the fetch
// resolves to a path that is not there, 404s, and reports that plainly. It does not fail
// silently and it does not try the absolute address, because trying it would produce a
// mixed-content console error that looks like a bug in this file rather than the hosting
// fact that it is. When the gallery gets a certificate, both copies work.

const ID_PATTERN = /^[0-9]{1,9}$/;

/**
 * The world id this page was opened with, or null.
 *
 * It also STRIPS the parameter from the address bar before returning, and that matters
 * more than it looks: loading a world replaces everything in the app, so a link left in
 * the url would wipe the student's work again on every refresh -- including the refresh
 * they do to get back what they just lost.
 */
export function takeLinkedWorldId() {
  let params;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
  const raw = params.get(WORLD_LINK_PARAM);
  if (!raw || !ID_PATTERN.test(raw)) return null;

  params.delete(WORLD_LINK_PARAM);
  const query = params.toString();
  const clean = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  try {
    window.history.replaceState(null, '', clean);
  } catch {
    // A sandboxed or file:// context can refuse replaceState. Losing the tidy-up is
    // survivable; refusing to open the world over it would not be.
  }
  return raw;
}

/**
 * Fetches that world from the gallery and hands its records back.
 * Throws with a message worth showing a student.
 */
export async function fetchLinkedWorld(id) {
  const url = `${WORLD_LINK_BASE}${encodeURIComponent(id)}`;
  let response;
  try {
    response = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  } catch (err) {
    // Offline, DNS, or -- on a copy of the app served from somewhere the gallery is not --
    // a blocked cross-origin request.
    throw new Error('Could not reach the world gallery.');
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'That world is not in the gallery any more.'
      : 'The gallery could not send that world.');
  }
  // download.php answers a missing world with an HTML page and a 404, so a 200 that is not
  // JSON means something else entirely is on that address -- a captive portal, a proxy
  // error page, or the app being served from a host with no gallery under it.
  return parseWorldPayload(await response.text());
}
