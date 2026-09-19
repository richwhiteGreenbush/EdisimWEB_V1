<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/*
 * Small shared utilities: escaping, CSRF, flash messages, formatting, and the label
 * tables that turn Edusim's internal names (`world-theme`, `preset-prop`, `voyage`) into
 * something a student reads.
 */

// ---------------------------------------------------------------------------
// Output escaping
// ---------------------------------------------------------------------------

/**
 * The only way user text reaches a page. Short name because it is used on every line
 * that prints anything, and a long one makes forgetting it easier to miss in review.
 */
function e(?string $s): string
{
    return htmlspecialchars($s ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** For text going into an href/src query string. */
function eu(string $s): string
{
    return rawurlencode($s);
}

/**
 * A description is stored as plain text and displayed as paragraphs. It is escaped
 * FIRST and only then have its newlines turned into markup -- the other order would let
 * a submitted `<script>` through, since escaping would run over the tags this adds.
 */
function ewd_paragraphs(string $text): string
{
    $blocks = preg_split("/\n\s*\n/", trim($text)) ?: [];
    $out = '';
    foreach ($blocks as $block) {
        $block = trim($block);
        if ($block === '') {
            continue;
        }
        $out .= '<p>' . nl2br(e($block)) . "</p>\n";
    }
    return $out;
}

// ---------------------------------------------------------------------------
// Sessions, CSRF, flash
// ---------------------------------------------------------------------------

function ewd_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        // Only ask for a Secure cookie when the request actually arrived over TLS --
        // set unconditionally, the session silently fails on a plain-HTTP classroom
        // server and every login and flash message vanishes.
        'secure'   => ewd_is_https(),
    ]);
    session_start();
}

function ewd_is_https(): bool
{
    if (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    return ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
}

function ewd_csrf_token(): string
{
    ewd_session();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function ewd_csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(ewd_csrf_token()) . '" />';
}

function ewd_csrf_ok(): bool
{
    ewd_session();
    $sent = (string)($_POST['csrf'] ?? '');
    return $sent !== '' && !empty($_SESSION['csrf']) && hash_equals((string)$_SESSION['csrf'], $sent);
}

function ewd_flash(string $type, string $message): void
{
    ewd_session();
    $_SESSION['flash'][] = ['type' => $type, 'message' => $message];
}

function ewd_take_flashes(): array
{
    ewd_session();
    $flashes = $_SESSION['flash'] ?? [];
    unset($_SESSION['flash']);
    return $flashes;
}

function ewd_redirect(string $to): never
{
    header('Location: ' . $to, true, 303);
    exit;
}

// ---------------------------------------------------------------------------
// Identity of a submitter -- hashed, never stored in the clear
// ---------------------------------------------------------------------------

function ewd_client_ip(): string
{
    // X-Forwarded-For is trivially forged, so it is used only for rate limiting and
    // never for anything that grants access. The left-most entry is the client as seen
    // by the first proxy.
    $fwd = (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    if ($fwd !== '') {
        $first = trim(explode(',', $fwd)[0]);
        if ($first !== '') {
            return $first;
        }
    }
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

function ewd_ip_hash(): string
{
    return hash_hmac('sha256', ewd_client_ip(), EWD_IP_SALT);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * $fallback is what comes back when the text reduces to nothing usable -- a title of
 * pure emoji, say. The `slug` column is UNIQUE NOT NULL so a title needs a non-empty
 * fallback, but a TAG that reduced to nothing must be dropped rather than silently
 * becoming a tag named "world", so tag parsing passes '' and checks for it.
 */
function ewd_slugify(string $text, int $maxLength = 60, string $fallback = 'world'): string
{
    $slug = $text;
    if (function_exists('iconv')) {
        // Fold accents so "Sofía's Château" becomes sofias-chateau rather than losing
        // both words entirely to the strip below. //TRANSLIT can emit ?' for characters
        // with no ASCII equivalent, which the strip then removes.
        $converted = @iconv('UTF-8', 'ASCII//TRANSLIT', $slug);
        if ($converted !== false) {
            $slug = $converted;
        }
    }
    $slug = strtolower($slug);
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
    $slug = trim($slug, '-');
    if (strlen($slug) > $maxLength) {
        $slug = rtrim(substr($slug, 0, $maxLength), '-');
    }
    return $slug !== '' ? $slug : $fallback;
}

function ewd_unique_slug(string $base): string
{
    $db = ewd_db();
    $stmt = $db->prepare('SELECT 1 FROM worlds WHERE slug = ?');

    $slug = $base;
    $n = 2;
    while (true) {
        $stmt->execute([$slug]);
        if ($stmt->fetchColumn() === false) {
            return $slug;
        }
        $slug = $base . '-' . $n;
        $n++;
        if ($n > 500) {
            return $base . '-' . bin2hex(random_bytes(4));
        }
    }
}

/**
 * "space rockets, MY CLASS!!, space-rockets" -> ['space-rockets', 'my-class']
 * Normalised, de-duplicated, capped, and each one slugified so the tag table never holds
 * two spellings of the same idea.
 */
function ewd_parse_tags(string $raw): array
{
    $parts = preg_split('/[,\n]+/', $raw) ?: [];
    $out = [];
    foreach ($parts as $part) {
        $tag = ewd_slugify(trim($part), 28, '');
        if ($tag === '') {
            continue;
        }
        if (!in_array($tag, $out, true)) {
            $out[] = $tag;
        }
        if (count($out) >= EWD_MAX_TAGS) {
            break;
        }
    }
    return $out;
}

function ewd_truncate(string $text, int $length): string
{
    $text = trim(preg_replace('/\s+/', ' ', $text) ?? '');
    if (mb_strlen($text) <= $length) {
        return $text;
    }
    return rtrim(mb_substr($text, 0, $length - 1)) . '…';
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function ewd_bytes(int $bytes): string
{
    if ($bytes < 1024) {
        return $bytes . ' B';
    }
    $units = ['KB', 'MB', 'GB'];
    $value = $bytes / 1024;
    foreach ($units as $i => $unit) {
        if ($value < 1024 || $i === count($units) - 1) {
            return round($value, $value < 10 ? 1 : 0) . ' ' . $unit;
        }
        $value /= 1024;
    }
    return $bytes . ' B';
}

function ewd_when(string $iso): string
{
    $ts = strtotime($iso);
    if ($ts === false) {
        return '';
    }
    $diff = time() - $ts;
    if ($diff < 60) {
        return 'just now';
    }
    if ($diff < 3600) {
        $m = (int)floor($diff / 60);
        return $m . ' minute' . ($m === 1 ? '' : 's') . ' ago';
    }
    if ($diff < 86400) {
        $h = (int)floor($diff / 3600);
        return $h . ' hour' . ($h === 1 ? '' : 's') . ' ago';
    }
    if ($diff < 86400 * 30) {
        $d = (int)floor($diff / 86400);
        return $d . ' day' . ($d === 1 ? '' : 's') . ' ago';
    }
    return date('j M Y', $ts);
}

function ewd_plural(int $n, string $one, string $many): string
{
    return number_format($n) . ' ' . ($n === 1 ? $one : $many);
}

/**
 * Rebuild the current query string with some keys changed -- what every filter chip,
 * sort control and pagination link is built from. A null value drops the key, so
 * "clear this filter" is the same call as "set this filter".
 */
function ewd_url_with(array $changes, string $base = 'index.php'): string
{
    $query = $_GET;
    foreach ($changes as $k => $v) {
        if ($v === null || $v === '') {
            unset($query[$k]);
        } else {
            $query[$k] = $v;
        }
    }
    unset($query['page_reset']);
    $qs = http_build_query($query);
    return $qs === '' ? $base : $base . '?' . $qs;
}

// ---------------------------------------------------------------------------
// Edusim vocabulary -- the internal names, in English
// ---------------------------------------------------------------------------

/**
 * The keys are WORLD_THEMES in src/config.js. `newyork` and `sea` are in the list even
 * though neither is in the app's own Load World menu (each is reached only through a
 * billboard portal) -- a student can still save a world while standing in one, and a
 * shared world that came back labelled "unknown" would be the app's own secret leaking
 * out as a bug.
 */
function ewd_theme_labels(): array
{
    return [
        'default'  => 'My World',
        'park'     => 'The Park',
        'museum'   => 'The Museum',
        'library'  => 'The Library',
        'moon'     => 'The Moon',
        'mars'     => 'On Mars',
        'dinosaur' => 'Dinosaur Island',
        'voyage'   => 'Fantastic Voyage',
        'newyork'  => "1940's New York",
        'sea'      => 'Under the Sea',
    ];
}

function ewd_theme_label(string $theme): string
{
    return ewd_theme_labels()[$theme] ?? ($theme !== '' ? ucfirst($theme) : 'Unknown');
}

function ewd_theme_emoji(string $theme): string
{
    return [
        'default'  => '🌱',
        'park'     => '🌳',
        'museum'   => '🖼️',
        'library'  => '📚',
        'moon'     => '🌙',
        'mars'     => '🚀',
        'dinosaur' => '🦖',
        'voyage'   => '🫀',
        'newyork'  => '🏙️',
        'sea'      => '🐠',
    ][$theme] ?? '🌍';
}

/**
 * record.kind, as dispatched in WorldStore.rehydrateOne(). Anything not listed still
 * counts and still displays -- it just shows its raw name, which is the right behaviour
 * when this database is running against a newer build of the app than it was written for.
 */
function ewd_kind_labels(): array
{
    return [
        'gltf'              => 'Imported models',
        'obj'               => 'Imported models',
        'image'             => 'Images',
        'gif'               => 'Animated GIFs',
        'balloon'           => 'Drawn balloons',
        'light-orb'         => 'Light orbs',
        'web-browser'       => 'Web panels',
        'preset-prop'       => 'World scenery',
        'primitive'         => 'Building shapes',
        'built-model'       => 'Built models',
        'world-theme'       => 'World theme',
        'startup-library'   => 'Buildings',
        'startup-tree'      => 'Trees',
        'startup-billboard' => 'Banners',
    ];
}

function ewd_kind_label(string $kind): string
{
    return ewd_kind_labels()[$kind] ?? $kind;
}

/**
 * Roll a raw kind => count map up into the labels above, so "gltf 2 / obj 1" reads as
 * "Imported models 3" and the world-theme bookkeeping record is dropped rather than
 * being listed as if it were an object a student placed.
 */
function ewd_summarise_kinds(array $kinds): array
{
    $out = [];
    foreach ($kinds as $kind => $count) {
        if ($kind === 'world-theme') {
            continue;
        }
        $label = ewd_kind_label((string)$kind);
        $out[$label] = ($out[$label] ?? 0) + (int)$count;
    }
    arsort($out);
    return $out;
}

// ---------------------------------------------------------------------------
// Server limits
// ---------------------------------------------------------------------------

function ewd_ini_bytes(string $key): int
{
    $raw = trim((string)ini_get($key));
    if ($raw === '') {
        return 0;
    }
    $unit = strtolower(substr($raw, -1));
    $value = (int)$raw;
    return match ($unit) {
        'g' => $value * 1024 * 1024 * 1024,
        'm' => $value * 1024 * 1024,
        'k' => $value * 1024,
        default => (int)$raw,
    };
}

/**
 * The real ceiling on an upload, which is the SMALLEST of what this app allows, what a
 * single file may be, and what the whole POST body may be. The share form prints it, so
 * a student meeting a server limit gets a number rather than a blank page.
 */
function ewd_php_upload_limit(): int
{
    $limits = array_filter([
        EWD_MAX_WORLD_BYTES,
        ewd_ini_bytes('upload_max_filesize'),
        ewd_ini_bytes('post_max_size'),
    ]);
    return $limits ? (int)min($limits) : EWD_MAX_WORLD_BYTES;
}

/**
 * A POST larger than post_max_size arrives with $_POST and $_FILES both EMPTY and no
 * error flag anywhere -- the request simply looks like nothing was submitted. Without
 * this check the share page would answer a too-big upload with "choose a world file",
 * which sends the student off to fix something that was never wrong.
 */
function ewd_post_exceeded_limit(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        && empty($_POST)
        && empty($_FILES)
        && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0;
}

function ewd_upload_error_message(int $code): string
{
    return match ($code) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE =>
            'That file is bigger than this server accepts (' . ewd_bytes(ewd_php_upload_limit()) . ').',
        UPLOAD_ERR_PARTIAL   => 'The upload was interrupted. Try again.',
        UPLOAD_ERR_NO_FILE   => 'No file was chosen.',
        UPLOAD_ERR_NO_TMP_DIR, UPLOAD_ERR_CANT_WRITE =>
            'The server could not save the file. Ask whoever set this up to check the upload directory.',
        UPLOAD_ERR_EXTENSION => 'The server blocked that upload.',
        default              => 'Something went wrong with the upload.',
    };
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

/**
 * An absolute url on the canonical origin, for a path relative to the gallery directory.
 * Used for Open Graph tags and share links, both of which are read by someone else's
 * server and cannot be relative. See EWD_CANONICAL_ORIGIN for why the origin is a fixed
 * constant rather than $_SERVER['HTTP_HOST'].
 */
function ewd_abs_url(string $relative): string
{
    return EWD_CANONICAL_BASE . ltrim($relative, '/');
}

/**
 * The share destinations offered on a world page, as [label, emoji, href, className].
 *
 * Every one of these is a PLAIN LINK to a documented share endpoint. There is no
 * Facebook SDK, no twitter widgets.js, no analytics pixel and no third-party script of
 * any kind on this page -- which matters more here than on most sites, because the people
 * loading it are children in classrooms. A share button that phones home before anyone
 * clicks it is a tracker with an icon on it.
 *
 * Google Classroom is first among the networks on purpose: this is a teaching tool, and
 * "post it to my class" is the share a teacher actually wants. It is also the only one of
 * these that lands the link somewhere durable rather than in a feed.
 */
function ewd_share_targets(string $url, string $title, string $summary = ''): array
{
    $u = rawurlencode($url);
    $t = rawurlencode($title);
    // What gets typed into the post for the networks that take a message as well as a
    // link. Kept short: every one of these truncates, and the url must survive.
    $blurb = rawurlencode($title . ' — a world you can open in Edusim and take apart.');
    $mailBody = rawurlencode(
        $title . "\n\n" . ($summary !== '' ? $summary . "\n\n" : '')
        . "Open it here:\n" . $url . "\n\n"
        . "Download the file, then in Edusim choose Menu > Load World > Load World File."
    );

    return [
        ['Classroom', '🎓', 'https://classroom.google.com/share?url=' . $u, 'sh-classroom'],
        ['X',                '𝕏', 'https://twitter.com/intent/tweet?url=' . $u . '&text=' . $blurb, 'sh-x'],
        ['Facebook',         'f', 'https://www.facebook.com/sharer/sharer.php?u=' . $u, 'sh-fb'],
        ['WhatsApp',         '💬', 'https://api.whatsapp.com/send?text=' . $blurb . '%20' . $u, 'sh-wa'],
        ['Email',            '✉️', 'mailto:?subject=' . $t . '&body=' . $mailBody, 'sh-mail'],
    ];
}
