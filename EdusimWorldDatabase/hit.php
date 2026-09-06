<?php
declare(strict_types=1);

/*
 * The counting endpoint. One job: add 1 to a row in stats.sqlite.
 *
 * Read lib/stats.php's header first -- it explains why this site counts its own traffic
 * and why the table cannot hold anything personal. This file is deliberately the least
 * interesting half: it validates, it increments, it answers 204.
 *
 * IT ALWAYS ANSWERS 204, INCLUDING WHEN IT FAILS, and that is not laziness. A visitor
 * has no stake in whether a counter incremented, so there is nothing useful to tell them
 * and a 500 here would print a PHP error into a page's console on a site whose whole
 * pitch to a technology director is that nothing goes wrong quietly in a classroom. The
 * client (docs/assets/edusim-analytics.js) swallows the response either way.
 */

require_once __DIR__ . '/lib/config.php';
require_once __DIR__ . '/lib/stats.php';

// 204 with no body: nothing to parse, nothing to render, and it is the smallest answer
// there is. `no-store` because a cached counting endpoint counts once.
function ewd_hit_done(): never
{
    http_response_code(204);
    header('Cache-Control: no-store');
    header('Content-Length: 0');
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    ewd_hit_done();
}

// The Content-Type check is the cheap CSRF-shaped guard the client's fetch() exists to
// satisfy: a cross-origin form post cannot set application/json without a preflight,
// and this endpoint answers no preflight. It is not a security boundary -- there is
// nothing here worth attacking -- it just keeps a stray form off the counters.
$type = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($type, 'application/json') !== 0) {
    ewd_hit_done();
}

// Bounded read. A counting request is under 300 bytes; anything larger is not one.
$raw = (string)file_get_contents('php://input', false, null, 0, 2048);
$in  = json_decode($raw, true);
if (!is_array($in)) {
    ewd_hit_done();
}

try {
    ewd_stats_record(
        (string)($in['kind'] ?? ''),
        (string)($in['path'] ?? '/'),
        (string)($in['ref'] ?? '')
    );
} catch (Throwable $e) {
    // A locked or missing stats database must never be visible from a page. The world
    // gallery is a different file entirely (see lib/stats.php), so nothing that goes
    // wrong here can touch a shared world.
}

ewd_hit_done();
