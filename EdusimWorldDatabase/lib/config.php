<?php
declare(strict_types=1);

/*
 * Edusim World Database -- configuration.
 *
 * Nothing here is secret except the admin password hash, and that is deliberately NOT
 * set in this file: drop a `config.local.php` beside it, define any of the same
 * constants there, and they win. That file is gitignored, so a real deployment's
 * password and IP salt never land in the repository. See README.md.
 *
 * The override mechanism is why every setting below goes through ewd_define() rather
 * than a bare define(): PHP keeps the FIRST definition of a constant and ignores every
 * later one, so the local file is included at the top and each default here only
 * applies if the local file did not already set it.
 */

function ewd_define(string $name, mixed $value): void
{
    if (!defined($name)) {
        define($name, $value);
    }
}

if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

// ---------------------------------------------------------------------------
// Paths. Everything is derived from this file's own location, so the app works
// wherever it is dropped -- a subdirectory of a school web server, a vhost root,
// a `php -S` sandbox -- with no base-URL setting to get wrong. Every link the
// pages emit is relative for the same reason.
// ---------------------------------------------------------------------------

ewd_define('EWD_ROOT', dirname(__DIR__));
ewd_define('EWD_DATA_DIR', EWD_ROOT . '/data');          // sqlite file + world .json payloads
ewd_define('EWD_WORLD_DIR', EWD_DATA_DIR . '/worlds');   // one .json per shared world
ewd_define('EWD_UPLOAD_DIR', EWD_ROOT . '/uploads');     // screenshots, served statically
ewd_define('EWD_SHOT_DIR', EWD_UPLOAD_DIR . '/screenshots');
ewd_define('EWD_DB_FILE', EWD_DATA_DIR . '/worlds.sqlite');

// Screenshots are the one thing served straight off disk rather than through PHP, so
// pages need a URL for them as well as a path. Relative, like everything else.
ewd_define('EWD_SHOT_URL', 'uploads/screenshots');

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

// A world file is JSON, but an Edusim world file carries base64-encoded model and image
// bytes inline (see src/WorldFile.js), so a world with a few imported models in it is
// genuinely megabytes. 24MB is roomy for classroom work without letting one submission
// fill a shared disk.
//
// PHP's own `upload_max_filesize` and `post_max_size` cap this independently and are
// usually 2M/8M out of the box -- raise BOTH or large worlds fail before this code ever
// runs. `ewd_php_upload_limit()` in helpers.php reports what the server actually allows,
// and the share form prints it.
ewd_define('EWD_MAX_WORLD_BYTES', 24 * 1024 * 1024);
ewd_define('EWD_MAX_SHOT_BYTES', 8 * 1024 * 1024);

// Screenshots are re-encoded (never stored as uploaded), so these are the sizes that
// actually get written. 1600px wide is more than any card or detail page shows.
ewd_define('EWD_SHOT_MAX_W', 1600);
ewd_define('EWD_SHOT_MAX_H', 1200);
ewd_define('EWD_THUMB_MAX_W', 640);
ewd_define('EWD_THUMB_MAX_H', 400);
ewd_define('EWD_JPEG_QUALITY', 82);

ewd_define('EWD_PER_PAGE', 12);

// Field lengths, enforced server-side and mirrored as `maxlength` on the form.
ewd_define('EWD_MAX_TITLE', 80);
ewd_define('EWD_MAX_CREATOR', 60);
ewd_define('EWD_MAX_GROUP', 60);
ewd_define('EWD_MAX_DESCRIPTION', 2000);
ewd_define('EWD_MIN_DESCRIPTION', 20);
ewd_define('EWD_MAX_TAGS', 6);

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

// false: a shared world appears in the gallery immediately.
// true : it waits in the admin queue until a teacher approves it.
//
// The default is `false` because the common case is a classroom the teacher is standing
// in, and a student who shares a world and cannot find it assumes it failed. Flip this to
// `true` in config.local.php for anything open to the public -- the whole admin queue is
// already built and needs no other change.
ewd_define('EWD_REQUIRE_APPROVAL', false);

// Submissions allowed per hour from one IP. A class of thirty sharing at once comes from
// one school IP, so this is generous by design; it exists to stop a script, not a lesson.
ewd_define('EWD_RATE_LIMIT_PER_HOUR', 40);

// Salt for the one-way hash of submitter IPs. An IP is stored ONLY as a hash, so rate
// limiting and abuse tracing still work while the table holds no personal data in the
// clear. Override this in config.local.php with your own random string.
ewd_define('EWD_IP_SALT', 'edusim-world-database');

// The admin password, as a password_hash() string -- NOT the password itself.
// Left empty here on purpose: with no hash set, admin.php walks you through choosing one
// and prints the line to paste into config.local.php.
ewd_define('EWD_ADMIN_PASSWORD_HASH', '');

// ---------------------------------------------------------------------------
// Links back to the rest of Edusim
// ---------------------------------------------------------------------------

// The marketing site and the Hands-On Guide are deployed on THIS host, one level up: the
// gallery is a directory inside the site (edusim3d.me/worlds/), so these are relative and
// a visitor stays on the domain they arrived on. They used to be absolute github.io URLs,
// which quietly bounced anyone clicking "Main site" onto the old GitHub Pages copy.
//
// Relative also means the links stay correct on any host the site is copied to, and in
// the local Apache mirror -- the same reasoning as every other path in this file.
ewd_define('EWD_SITE_URL', '../');
ewd_define('EWD_GUIDE_URL', '../guide/index.html');

// The app is the ONE link that has to stay absolute: it is deployed to Railway, a
// different host entirely, and there is no copy of it on this server to point at. If it
// ever moves onto this domain, this becomes relative like the two above.
ewd_define('EWD_APP_URL', 'https://edisimwebv1-production.up.railway.app');

// The origin used to build ABSOLUTE urls: the share links and the Open Graph tags, both
// of which are read by someone else's server and cannot be relative.
//
// It is a constant and NOT derived from $_SERVER['HTTP_HOST'], deliberately. The Host
// header is supplied by the client, so a request carrying a forged one would produce a
// page whose og:url and every share button pointed at somebody else's domain -- and
// because that page is what a social network fetches and caches, the bad link outlives
// the request that caused it. A fixed origin cannot be poisoned.
//
// The cost is that shares from the local Apache mirror point at production, which is the
// right answer anyway: nobody wants to share a localhost link. Override it in
// lib/config.local.php if this is ever hosted somewhere else.
ewd_define('EWD_CANONICAL_ORIGIN', 'http://edusim3dweb.com');
ewd_define('EWD_CANONICAL_BASE', EWD_CANONICAL_ORIGIN . '/worlds/');

// The copy of the app that "Open this world in Edusim" points at, and it is deliberately
// NOT EWD_APP_URL.
//
// That button hands the app a world id and the app fetches the file back out of this
// gallery, which means the two have to share an origin: this host has no TLS, and a page
// served from Railway over https may not fetch an http url -- browsers block it as mixed
// content and there is no client-side way round it. So deploy.sh publishes a second copy
// of the built app one directory up, at /app/, and that is the one that can open a world
// from a link.
//
// Relative, like every other same-host link in this file, so it stays correct on the local
// Apache mirror. EWD_APP_URL is untouched: "Play Now" and every other plain link to the
// app still goes to Railway.
ewd_define('EWD_APP_OPEN_URL', '../app/');
