# Edusim World Database

A place for worlds built in **Edusim: Web Edition** to be shared, browsed and downloaded
again. Every shared world carries the three things the brief asked for — a **screenshot**,
a **description**, and the **world JSON** itself — and anyone can take that JSON back into
Edusim through *Menu ▸ Load World ▸ Load World File* and carry on building.

PHP + SQLite, no framework, no build step, no Composer. It wears the marketing site's
theme and logos so it reads as part of the same project.

```
EdusimWorldDatabase/
├── index.php          Gallery: search, theme + tag filters, sorting, pagination
├── share.php          The share form (screenshot + description + world file)
├── world.php          One world: full screenshot, description, contents, download
├── download.php       Serves the .json, counts the download, names the file
├── admin.php          Teacher tools: approve / hide / delete
├── schema.sql         Readable copy of the schema (lib/db.php is authoritative)
├── assets/            database.css + the logo crops taken from docs/assets/
├── lib/               config, db, helpers, layout, admin, worldfile, screenshot
├── data/              worlds.sqlite + one .json per shared world  (never web-served)
└── uploads/           screenshots, re-encoded  (web-served, PHP execution off)
```

## Running it

Requirements: **PHP 8.1+** with `pdo_sqlite`, `gd` and `fileinfo`. All three are standard.

```bash
cd EdusimWorldDatabase
php -S localhost:8000        # then open http://localhost:8000
```

There is no install step. The database, its tables and the `data/` and `uploads/`
directories are created on the first request — a fresh checkout works immediately, because
"the database is missing" is not an error a student sharing a world should ever meet.

On a real server, point a vhost (or a subdirectory) at this folder and make `data/` and
`uploads/` writable by the web user:

```bash
chown -R www-data:www-data data uploads
chmod -R 775 data uploads
```

## Setting the teacher password

Nothing ships with a default password. Open `admin.php`, choose one, and it prints the
line to paste into `lib/config.local.php` — a gitignored file whose settings override
anything in `lib/config.php`:

```php
<?php
define('EWD_ADMIN_PASSWORD_HASH', '$2y$12$…');  // printed by admin.php
define('EWD_IP_SALT', 'some long random string of your own');
define('EWD_REQUIRE_APPROVAL', true);           // optional, see below
```

Only the bcrypt hash is ever stored, and the session records which hash it was granted
against — so changing the password immediately signs out every existing session rather
than leaving old cookies valid.

## Moderation

`EWD_REQUIRE_APPROVAL` decides where a new world lands:

| Setting | What happens |
| --- | --- |
| `false` *(default)* | The world appears in the gallery straight away. |
| `true` | It waits in the admin queue until a teacher approves it. |

The default is `false` because the common case is a classroom the teacher is standing in,
and a student who shares a world and cannot find it assumes it failed. **Turn it on for
anything reachable from the open internet.** Nothing else needs changing — the queue is
already built.

Teachers get three actions. *Hide* is the one worth knowing about: it takes a world out of
the gallery without deleting it, because "not appropriate" and "should not exist" are
different judgements and the first one shouldn't have to be made irreversibly at speed.
*Delete* removes the row, the screenshot, the thumbnail and the world file.

Students get a **management key** on the confirmation screen after sharing — shown once,
stored only as a hash — which lets them take their own world down without an account.

## What gets validated

**The world file** must parse as JSON and hold a `records` array with at least one record
whose `kind` Edusim recognises. It is stored **byte for byte as uploaded**, so what a
classmate downloads is exactly what the sharer exported and `readWorldFile()` can be
trusted to accept it. The record count, the kind breakdown and the world theme are read
out at submit time so the gallery can describe a world without opening its file.

A `format` field is checked only when it is present: worlds exported before that field
existed are still loadable by the app, and rejecting them here would refuse files Edusim
itself accepts.

**The screenshot** is decoded with GD and re-encoded to a fresh JPEG, in two sizes. The
uploaded bytes are never what gets stored, and that is the point — a file can be a valid
PNG *and* a valid PHP script at once, and a check on the extension, the browser-supplied
MIME type, or even `getimagesize()` will happily pass it. Re-encoding from a decoded pixel
buffer discards everything that was not pixels. (Verified: a PNG with `<?php … ?>` appended
comes out the other side with the payload gone.)

Everything else — CSRF tokens on every POST, a honeypot field, a per-IP hourly rate limit,
prepared statements everywhere, `htmlspecialchars` on every piece of user text, submitter
IPs stored only as salted hashes — is ordinary and is noted in the code where it matters.

## Serving it safely

`data/` must never be reachable by URL: it holds the SQLite file and every world payload.
Two `.htaccess` files are written automatically for Apache — one denying `data/` outright,
one turning PHP execution off inside `uploads/`. **Nginx ignores `.htaccess` entirely**, so
add the equivalent:

```nginx
location ~ ^/EdusimWorldDatabase/(data|lib)/ {
    deny all;
    return 404;
}

# Uploads are served as static files, and nothing in there may ever be executed.
location ~ ^/EdusimWorldDatabase/uploads/.*\.(php|phtml|phar)$ {
    deny all;
    return 404;
}
```

## Limits

Defaults live in `lib/config.php`; override any of them in `config.local.php`.

| Setting | Default | Note |
| --- | --- | --- |
| `EWD_MAX_WORLD_BYTES` | 24 MB | World files carry base64 model and image bytes inline, so they are genuinely megabytes |
| `EWD_MAX_SHOT_BYTES` | 8 MB | Re-encoded down to 1600×1200 and a 640×400 thumbnail |
| `EWD_PER_PAGE` | 12 | Gallery cards per page |
| `EWD_RATE_LIMIT_PER_HOUR` | 40 | Per IP. A class shares from one school address, so this is deliberately generous |

**PHP's own `upload_max_filesize` and `post_max_size` cap uploads independently**, and are
commonly 2M/8M out of the box — raise *both* or large worlds fail before any of this code
runs. The share form prints whatever the server actually allows, and a POST that exceeds
`post_max_size` (which arrives with `$_POST` and `$_FILES` both empty and no error flag
anywhere) is detected and reported as a size problem rather than as a missing file.

## Notes for whoever edits this next

- **`lib/db.php` is the authoritative schema**, not `schema.sql`. The latter is the
  readable copy; keep them in step.
- **Tags are normalised through `ewd_slugify()`** before they are stored, so `ROBOTS!!`,
  `robots` and `Robots` are one tag rather than three.
- **The theme labels in `lib/helpers.php` mirror `WORLD_THEMES` in `src/config.js`,** and
  include `newyork` and `sea` even though neither appears in Edusim's own Load World menu
  (each is reached only through a billboard portal). A student can still save a world while
  standing in one, and a shared world labelled "unknown" would look like a bug.
- **The five accent colours and the sky/grass gradient in `assets/database.css` are not
  free to restyle** — the accents are the app's own in-world palette
  (`PALETTE_SWATCHES`), and the environment colours are sampled from the logo artwork. The
  note at the top of that file says which is which, and `docs/styles.css` says why.
- **The logo crops in `assets/` are copies of `docs/assets/`**, not links, because this app
  is deployed on a PHP host while the marketing page is static GitHub Pages. If the logo is
  ever recut (`docs/assets/cut.py`), copy the three files across again.
