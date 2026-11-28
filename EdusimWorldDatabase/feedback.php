<?php
declare(strict_types=1);

/*
 * Receives the website's feedback popup (docs/assets/edusim-feedback.js). lib/feedback.php does the
 * work and says what is kept; this file only checks the request's shape and answers JSON.
 *
 * Same-origin JSON only: a cross-origin form cannot send application/json without a preflight, and
 * this endpoint answers none, the same cheap guard hit.php uses.
 */

require_once __DIR__ . '/lib/feedback.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function ewd_feedback_answer(int $status, array $body): never
{
    http_response_code($status);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    ewd_feedback_answer(405, ['ok' => false, 'error' => 'method']);
}
$type = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? ''));
if (strpos($type, 'application/json') !== 0) {
    ewd_feedback_answer(415, ['ok' => false, 'error' => 'type']);
}

// A real message is at most a few kilobytes of JSON.
$raw = (string)file_get_contents('php://input', false, null, 0, 16384);
$in = json_decode($raw, true);
if (!is_array($in)) {
    ewd_feedback_answer(400, ['ok' => false, 'error' => 'json']);
}

try {
    $result = ewd_feedback_submit($in);
} catch (Throwable $e) {
    ewd_feedback_answer(500, ['ok' => false, 'error' => 'server']);
}
if (!$result['ok']) {
    ewd_feedback_answer($result['status'] ?? 400, ['ok' => false, 'error' => $result['error'] ?? 'invalid']);
}
ewd_feedback_answer(200, ['ok' => true]);
