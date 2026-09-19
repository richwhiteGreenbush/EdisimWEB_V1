<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/*
 * Edusim — first-party page counting, stored as AGGREGATES ONLY.
 *
 * The counterpart to docs/assets/edusim-analytics.js. See the long note at the top of
 * that file for why this site counts its own traffic instead of loading somebody else's
 * script; this file is the half that has to be true for the claim to hold.
 *
 * THE TABLE IS THE PRIVACY GUARANTEE, and that is the whole design. There is no event
 * row, no session row, no visitor row and no IP column anywhere below — the only thing
 * a request can do is add 1 to a counter keyed by (day, kind, path, referrer host).
 * That shape cannot be de-anonymised later by anyone, including us: given the finished
 * table there is no query that reconstructs who read what in which order, because the
 * ordering was never written down. A schema that stores events and promises not to look
 * at them is a promise; a schema with nowhere to put an event is a fact.
 *
 * IT IS A SEPARATE SQLITE FILE FROM THE WORLD GALLERY, deliberately. This is the only
 * endpoint in the app that any visitor can write to without a form, a CSRF token or a
 * rate limit, so it is the one an abusive script would reach for. Pointed at
 * worlds.sqlite, a flood would contend for write locks with — and could bloat the file
 * holding — every world a student has ever shared. Pointed at its own file, the worst
 * available outcome is a fat stats table and a `rm`.
 */

ewd_define('EWD_STATS_DB_FILE', EWD_DATA_DIR . '/stats.sqlite');

// Distinct referrer hosts accepted per day before everything else is bucketed as
// 'other'. Referrer is the one dimension a client controls freely, so it is the one
// that can grow the table without bound: (day, kind, path) are all small closed sets,
// but a script can invent a new hostname on every request. Past this many the counts
// stay correct and only the attribution blurs, which is the right thing to lose.
ewd_define('EWD_STATS_MAX_REFERRERS_PER_DAY', 400);

function ewd_stats_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    if (!is_dir(EWD_DATA_DIR) && !@mkdir(EWD_DATA_DIR, 0775, true) && !is_dir(EWD_DATA_DIR)) {
        throw new RuntimeException('Cannot create directory: ' . EWD_DATA_DIR);
    }

    $pdo = new PDO('sqlite:' . EWD_STATS_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 3000');
    // NORMAL rather than FULL: a counter is allowed to lose the last few increments to a
    // power cut. Paying a full fsync per page view for data of this consequence would be
    // the most expensive thing on the server.
    $pdo->exec('PRAGMA synchronous = NORMAL');

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS page_hits (
            day      TEXT    NOT NULL,   -- UTC date, YYYY-MM-DD
            kind     TEXT    NOT NULL,   -- visit | page | app | built
            path     TEXT    NOT NULL,
            referrer TEXT    NOT NULL DEFAULT "",
            hits     INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, kind, path, referrer)
         ) WITHOUT ROWID'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_page_hits_day ON page_hits (day)');

    return $pdo;
}

/**
 * The four things worth counting, and nothing else.
 *
 * `visit`  — one per browser session, whatever it then reads. The denominator.
 * `page`   — one per page view. Which pages are pulling their weight.
 * `app`    — a session that got as far as opening the app. The activation event the
 *            marketing plan's first metric is defined against.
 * `built`  — a session that placed something in the world. The one that separates
 *            somebody who looked from somebody who used it.
 *
 * A closed list rather than a free string: an open `kind` is an open column, and an
 * open column is a place a future feature quietly starts storing something personal.
 */
function ewd_stats_kinds(): array
{
    return ['visit', 'page', 'app', 'built'];
}

/**
 * Normalise a client-supplied path to something safe to key a row on.
 *
 * A query string is dropped entirely and never stored. That is not tidiness: the app is
 * opened as `/app/?world=24`, and a world id is the least of what a URL on this site can
 * carry — the gallery's own manage-key links put a delete key in the query string. A
 * counter has no business holding either.
 */
function ewd_stats_path(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return '/';
    }
    $cut = strcspn($raw, '?#');
    $raw = substr($raw, 0, $cut);
    if ($raw === '' || $raw[0] !== '/') {
        $raw = '/' . $raw;
    }
    // Anything outside this set is not a path this site serves, so it is either a bug or
    // somebody probing. Collapsing rather than rejecting keeps one bad request from
    // discarding a legitimate count that arrived in the same body.
    $raw = preg_replace('#[^A-Za-z0-9/._~-]#', '', $raw) ?? '/';
    $raw = preg_replace('#/{2,}#', '/', $raw) ?? '/';
    return substr($raw, 0, 120);
}

/** A referrer is reduced to a bare hostname; the client already did this, and the
 *  server does not trust it to have. */
function ewd_stats_referrer(string $raw): string
{
    $raw = strtolower(trim($raw));
    if ($raw === '') {
        return '';
    }
    if (!preg_match('/^[a-z0-9.-]{1,80}$/', $raw)) {
        return 'other';
    }
    return $raw;
}

function ewd_stats_record(string $kind, string $path, string $referrer): void
{
    if (!in_array($kind, ewd_stats_kinds(), true)) {
        return;
    }

    $db  = ewd_stats_db();
    $day = gmdate('Y-m-d');
    $ref = ewd_stats_referrer($referrer);

    // The referrer cap. Checked only when there IS a referrer, so the ordinary case —
    // direct traffic, which is most of it — costs no extra query at all.
    if ($ref !== '' && $ref !== 'other') {
        $seen = $db->prepare('SELECT 1 FROM page_hits WHERE day = ? AND referrer = ? LIMIT 1');
        $seen->execute([$day, $ref]);
        if (!$seen->fetchColumn()) {
            $count = $db->prepare('SELECT COUNT(DISTINCT referrer) FROM page_hits WHERE day = ? AND referrer != ""');
            $count->execute([$day]);
            if ((int)$count->fetchColumn() >= EWD_STATS_MAX_REFERRERS_PER_DAY) {
                $ref = 'other';
            }
        }
    }

    $sql = 'INSERT INTO page_hits (day, kind, path, referrer, hits) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT (day, kind, path, referrer) DO UPDATE SET hits = hits + 1';
    $db->prepare($sql)->execute([$day, $kind, ewd_stats_path($path), $ref]);
}

/** Totals per kind for the last $days days, newest day first. */
function ewd_stats_daily(int $days = 30): array
{
    $db = ewd_stats_db();
    $from = gmdate('Y-m-d', time() - max(1, $days) * 86400);
    $rows = $db->prepare(
        'SELECT day, kind, SUM(hits) AS hits FROM page_hits WHERE day >= ? GROUP BY day, kind ORDER BY day DESC'
    );
    $rows->execute([$from]);

    $out = [];
    foreach ($rows->fetchAll() as $r) {
        $out[$r['day']][$r['kind']] = (int)$r['hits'];
    }
    return $out;
}

/** The busiest paths over the last $days days, for one kind. */
function ewd_stats_top_paths(int $days = 30, string $kind = 'page', int $limit = 40): array
{
    $db = ewd_stats_db();
    $from = gmdate('Y-m-d', time() - max(1, $days) * 86400);
    $rows = $db->prepare(
        'SELECT path, SUM(hits) AS hits FROM page_hits
          WHERE day >= ? AND kind = ? GROUP BY path ORDER BY hits DESC LIMIT ?'
    );
    $rows->execute([$from, $kind, max(1, $limit)]);
    return $rows->fetchAll();
}

/** Referring hosts over the last $days days. Direct traffic (no referrer) is excluded
 *  rather than shown as a blank row -- it is the majority and would swamp the list. */
function ewd_stats_referrers(int $days = 30, int $limit = 30): array
{
    $db = ewd_stats_db();
    $from = gmdate('Y-m-d', time() - max(1, $days) * 86400);
    $rows = $db->prepare(
        'SELECT referrer, SUM(hits) AS hits FROM page_hits
          WHERE day >= ? AND referrer != "" GROUP BY referrer ORDER BY hits DESC LIMIT ?'
    );
    $rows->execute([$from, max(1, $limit)]);
    return $rows->fetchAll();
}

/** Totals per kind over the window, which is what the six headline numbers are built
 *  from. */
function ewd_stats_totals(int $days = 30): array
{
    $db = ewd_stats_db();
    $from = gmdate('Y-m-d', time() - max(1, $days) * 86400);
    $rows = $db->prepare('SELECT kind, SUM(hits) AS hits FROM page_hits WHERE day >= ? GROUP BY kind');
    $rows->execute([$from]);

    $out = array_fill_keys(ewd_stats_kinds(), 0);
    foreach ($rows->fetchAll() as $r) {
        $out[$r['kind']] = (int)$r['hits'];
    }
    return $out;
}
