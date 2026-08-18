// URL handling shared by the browser panel's own address bar and by the menu's
// "YouTube Video" action, so a link behaves identically whichever way it arrives.
//
// WHY THIS EXISTS AT ALL: there is no way to put a YouTube video on a 3D mesh. A
// THREE.VideoTexture needs a <video> element it can read pixels out of, and YouTube
// serves no direct file and forbids cross-origin capture -- a canvas that has drawn a
// cross-origin frame is tainted and readback throws. The panels in WebBrowserPanel.js
// are the answer already in the app: a real <iframe> positioned by CSS3DRenderer, which
// is genuinely interactive because it is genuinely still DOM.
//
// The catch is that youtube.com/watch sends X-Frame-Options and will not frame at all,
// and a blocked frame is undetectable from the parent page -- accessing contentDocument
// throws for ANY cross-origin frame, blocked or not. So a student who pastes the link
// from their address bar gets a blank rectangle and no explanation. Only the /embed/
// form frames, and rewriting to it is something that can be done with certainty here
// rather than guessed at afterwards.

// Both YouTube's own hosts and the shortener. youtube-nocookie is the same content on a
// domain that holds off on tracking cookies until playback actually starts, which is the
// right default for a classroom and costs nothing.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);

const EMBED_HOST = 'https://www.youtube-nocookie.com';

// A video id is 11 url-safe base64 characters. Checking it is what keeps this from
// cheerfully building an embed url out of any youtube.com link that happens to have a
// path -- a channel page or a search result would otherwise come out as a dead embed.
const VIDEO_ID = /^[\w-]{11}$/;
const LIST_ID = /^[\w-]{2,}$/;

// A YouTube start time is either plain seconds ("90") or the h/m/s form the share
// dialog produces ("1h2m3s", "2m30s"). Anything else is ignored rather than guessed at.
function startSeconds(raw) {
  if (!raw) return 0;
  const value = String(raw).trim();
  if (/^\d+$/.test(value)) return Number(value);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function parsed(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;
  try {
    // A bare "youtu.be/xxxx" has no scheme, and URL() requires one.
    return new URL(/^[a-z][\w+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * Rewrites any form of YouTube link into the one form that is allowed to be framed.
 * Returns null for anything that is not recognisably a YouTube video or playlist —
 * callers treat that as "this is not a video link", never as a failure to be papered
 * over with a guess.
 */
export function youtubeEmbedUrl(input) {
  const url = parsed(input);
  if (!url) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let id = null;
  let list = url.searchParams.get('list');

  if (YOUTUBE_SHORT_HOSTS.has(host)) {
    id = segments[0] || null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = segments;
    if (first === 'watch') id = url.searchParams.get('v');
    // /shorts/, /live/ and the old /v/ all carry the id where /embed/ does, and an
    // already-correct /embed/ link passes through this same branch unchanged.
    else if (first === 'embed' || first === 'shorts' || first === 'live' || first === 'v') id = second || null;
    else if (first === 'playlist') id = null;
    else if (!first) id = url.searchParams.get('v');
    else return null; // a channel, a search, the home page -- not a video
  } else {
    return null;
  }

  const query = new URLSearchParams();
  const start = startSeconds(url.searchParams.get('t') || url.searchParams.get('start'));
  if (start > 0) query.set('start', String(start));
  if (list && !LIST_ID.test(list)) list = null;

  if (id && VIDEO_ID.test(id)) {
    if (list) query.set('list', list);
    const tail = query.toString();
    return `${EMBED_HOST}/embed/${id}${tail ? `?${tail}` : ''}`;
  }

  // A playlist with no particular video in it has its own embed form.
  if (list) {
    query.set('list', list);
    return `${EMBED_HOST}/embed/videoseries?${query.toString()}`;
  }
  return null;
}

/**
 * What the address bar and every placement path put into `record.url`: a trimmed,
 * scheme-carrying address, with YouTube links rewritten to their embeddable form.
 * Returns null for an empty box or a scheme that has no business in an iframe.
 */
export function normalizeBrowserUrl(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Only http and https. This used to be implicit -- anything without a recognised
  // scheme got "https://" glued on the front, which turned javascript:alert(1) into a
  // harmlessly broken hostname. That is the right outcome by accident; refusing it
  // outright is the same outcome on purpose, and a javascript: url assigned to an
  // iframe.src really does execute in a document the parent page can reach.
  const scheme = /^([a-z][\w+.-]*):/i.exec(trimmed);
  if (scheme && !/^https?$/i.test(scheme[1])) return null;

  const withScheme = scheme ? trimmed : `https://${trimmed}`;
  return youtubeEmbedUrl(withScheme) || withScheme;
}

/**
 * Upgrades an `http:` address to `https:` when the page itself is secure.
 *
 * THE DOMAIN GOT A CERTIFICATE, and this is the change CLAUDE.md said would have to come
 * with it. `edusim3dweb.com` served plain http for the whole life of this project, which is
 * why `WEB_BROWSER_DEFAULT_URL` was an http url and why every preset world's spawn panel
 * has an http url baked into its `web-browser` record. The moment the app is served over
 * https those records become MIXED CONTENT: measured on the live site, the console says
 * "requested an insecure frame 'http://edusim3dweb.com/'. This request has been blocked",
 * and every panel in every world goes blank -- the exact failure the app already had once
 * before, with the roles reversed.
 *
 * Changing the constant alone does not fix it, because the URL is PERSISTED. It sits inside
 * twenty-odd already-published gallery worlds, inside every world file a student has
 * downloaded, and inside every copy anybody has sent a classmate. None of those can be
 * edited from here. Upgrading at the point the iframe's src is set fixes all of them at
 * once and needs no re-seeding.
 *
 * It rewrites EVERY http url, not only this host's, and that is deliberate: an http frame
 * inside an https page is blocked outright, so there is no case where leaving it as http
 * works. A host that has no https answers with a connection error, which is a better
 * outcome than a silent blank rectangle. On an http page it is a no-op, so a local dev
 * server and any future http deployment behave exactly as they did.
 */
export function secureFrameUrl(input) {
  const url = (input || '').trim();
  if (!url) return url;
  const secure = typeof window !== 'undefined' && window.isSecureContext
    && window.location?.protocol === 'https:';
  if (!secure) return url;
  return url.replace(/^http:\/\//i, 'https://');
}
