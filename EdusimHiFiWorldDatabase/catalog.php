<?php
declare(strict_types=1);

/*
 * The list behind the app's World Database panel (src/WorldDatabase.js), as JSON.
 *
 * The app already fetches a world's file from download.php, same-origin, so this needs no
 * CORS and no new hosting. It is a separate file because index.php is a page and this is
 * data, and because three things about it have to be true on purpose:
 *
 * EVERY FIELD IS NAMED. ewd_list_worlds() selects w.*, which includes manage_key_hash and
 * submitter_ip_hash. Passing a row straight through would publish both, so the row is
 * rebuilt field by field below and nothing is carried by default.
 *
 * OFFICIAL WORLDS ONLY, for now, and the filter is here rather than in the app so it cannot
 * be switched off from a browser. The gallery checks that an upload is shaped like a world
 * and does not look at what it does, and a shared world can carry JavaScript that runs inside
 * the app. A gallery page is somewhere a student chose to go; this list sits inside the app
 * in front of a class. Worlds shared by other people stay in the gallery, which the panel
 * links to. Lift this once uploads go through approval.
 *
 * IT COUNTS NOTHING. Looking at the list is not a view of any world. Opening one goes through
 * download.php, which counts it as it always has.
 *
 * This file is identical in EdusimWorldDatabase/ and EdusimHiFiWorldDatabase/.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/helpers.php';
require_once __DIR__ . '/lib/teaching.php';

// Far above what the gallery holds. It exists so a runaway table cannot become a runaway
// response; the panel says so if it is ever reached.
const EWD_CATALOG_LIMIT = 500;

// The two worlds whose only door is a billboard inside another world. `hidden: true` in
// WorldPresets.js records the same fact. Browsing the panel does not show them, because a
// list of everything is the one thing that spoils a secret door; typing the name does.
function ewd_catalog_secret(string $slug): bool
{
    return in_array($slug, ['1940-s-new-york', 'under-the-sea'], true);
}

// "Grades 3–8" as the panel's four grade bands, which are the Model Database's.
function ewd_catalog_grades(string $band): array
{
    if (!preg_match('/(K|\d+)\s*[–-]\s*(\d+)/u', $band, $m)) {
        return [];
    }
    $low = $m[1] === 'K' ? 0 : (int)$m[1];
    $high = (int)$m[2];
    $grades = [];
    foreach (['K-2' => [0, 2], '3-5' => [3, 5], '6-8' => [6, 8], '9-12' => [9, 12]] as $label => [$from, $to]) {
        if ($low <= $to && $high >= $from) {
            $grades[] = $label;
        }
    }
    return $grades;
}

// Links are relative to the gallery's own directory, which is how this site writes all of
// them. The panel resolves them against the gallery's address.
function ewd_catalog_lessons(int $id, ?array $teach): array
{
    if (!$teach) {
        return [];
    }
    $lessons = [];
    if (!empty($teach['lesson_card'])) {
        $lessons[] = ['label' => 'Student guide and teacher lesson card', 'url' => 'world.php?id=' . $id . '#lesson-card'];
    }
    if (!empty($teach['lesson_page'])) {
        $lessons[] = ['label' => 'Student guide and teacher lesson card', 'url' => (string)$teach['lesson_page']];
    }
    if (!empty($teach['lesson'])) {
        $lessons[] = ['label' => 'The lesson plan', 'url' => EWD_GUIDE_URL_DIR . $teach['lesson']];
    }
    if (!empty($teach['card'])) {
        $lessons[] = ['label' => 'Printable student card', 'url' => EWD_GUIDE_URL_DIR . $teach['card']];
    }
    return $lessons;
}

function ewd_catalog_world(array $w): array
{
    $id = (int)$w['id'];
    $slug = (string)$w['slug'];
    $teach = ewd_teaching($slug);
    $thumb = $w['shot_thumb_path'] !== '' ? $w['shot_thumb_path'] : $w['shot_path'];
    return [
        'id'          => $id,
        'title'       => (string)$w['title'],
        'creator'     => (string)$w['creator'],
        'group'       => (string)$w['group_name'],
        'description' => (string)$w['description'],
        'place'       => ewd_theme_label((string)$w['theme']),
        'objects'     => (int)$w['record_count'],
        'tags'        => array_values(array_diff($w['tags'], ['official', 'hifi'])),
        'thumb'       => EWD_SHOT_URL . '/' . rawurlencode((string)$thumb),
        'shot'        => EWD_SHOT_URL . '/' . rawurlencode((string)$w['shot_path']),
        'page'        => 'world.php?id=' . $id,
        'band'        => $teach['band'] ?? '',
        'grades'      => ewd_catalog_grades((string)($teach['band'] ?? '')),
        'objective'   => $teach['objective'] ?? '',
        'standards'   => $teach['standards'] ?? '',
        'lessons'     => ewd_catalog_lessons($id, $teach),
        'secret'      => ewd_catalog_secret($slug),
    ];
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

try {
    // Most opened first: it puts the worlds people actually come back to at the top, and
    // download.php is what counts an opening.
    $result = ewd_list_worlds([
        'status'  => 'published',
        'tag'     => 'official',
        'sort'    => 'downloads',
        'perPage' => EWD_CATALOG_LIMIT,
    ]);
    $body = json_encode([
        'total'  => $result['total'],
        'worlds' => array_map('ewd_catalog_world', $result['rows']),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
    // A world shared or retitled shows up within a minute, and a class of thirty opening the
    // panel together is one query.
    header('Cache-Control: public, max-age=60');
    echo $body;
} catch (Throwable $e) {
    error_log('catalog.php: ' . $e->getMessage());
    http_response_code(500);
    header('Cache-Control: no-store');
    echo '{"error":"The world list is not available."}';
}
