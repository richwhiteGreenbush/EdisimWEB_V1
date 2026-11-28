<?php
declare(strict_types=1);

/*
 * The website's "Help us share and improve Edusim" feedback, per Rich: docs/assets/edusim-feedback.js
 * posts here (through feedback.php), and every message is emailed to Inventorium Lab.
 *
 * WEBSITE ONLY. The popup runs on the marketing and guide pages and never in the app or a gallery,
 * because the app's promise to schools is that it asks a child for nothing. docs/privacy.html says
 * exactly what this stores; change the two together.
 *
 * EVERY MESSAGE IS ALSO KEPT HERE, in its own SQLite file, because mail() reports success when the
 * local mail system ACCEPTS a message, not when Gmail delivers it, and a message from a web server
 * can land in spam with nothing to show it was ever sent. admin.php lists what is kept.
 *
 * WHAT IT HOLDS: the message, the topics ticked, the page it was sent from, a UTC time, whether the
 * sender said they were 18 or older, an email address ONLY when they did, and the same one-way IP hash
 * the world gallery uses for rate limiting. Never an IP in the clear, never a name field.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/helpers.php';

ewd_define('EWD_FEEDBACK_DB_FILE', EWD_DATA_DIR . '/feedback.sqlite');
ewd_define('EWD_FEEDBACK_TO', 'inventoriumlab@gmail.com');
// A sender on the site's own domain, so the message is not rejected as a forgery of the visitor's
// address. The visitor's address, when there is one, goes in Reply-To.
ewd_define('EWD_FEEDBACK_FROM', 'feedback@edusim3dweb.com');
// A whole school shares one IP, so these stop a script, not a class.
ewd_define('EWD_FEEDBACK_PER_HOUR', 12);
ewd_define('EWD_FEEDBACK_PER_DAY', 60);
ewd_define('EWD_FEEDBACK_MAX_MESSAGE', 2000);

const EWD_FEEDBACK_TOPICS = ['features' => 'New features', 'worlds' => 'New worlds', 'models' => 'New models', 'other' => 'Something else'];

function ewd_feedback_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    if (!is_dir(EWD_DATA_DIR) && !@mkdir(EWD_DATA_DIR, 0775, true) && !is_dir(EWD_DATA_DIR)) {
        throw new RuntimeException('Cannot create directory: ' . EWD_DATA_DIR);
    }
    $pdo = new PDO('sqlite:' . EWD_FEEDBACK_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 3000');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS feedback (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT    NOT NULL,              -- UTC, ISO 8601
            topics     TEXT    NOT NULL DEFAULT "",   -- comma-separated keys of EWD_FEEDBACK_TOPICS
            message    TEXT    NOT NULL,
            adult      INTEGER NOT NULL DEFAULT 0,
            email      TEXT    NOT NULL DEFAULT "",   -- only ever set when adult = 1
            page       TEXT    NOT NULL DEFAULT "",
            mailed     INTEGER NOT NULL DEFAULT 0,
            ip_hash    TEXT    NOT NULL DEFAULT ""
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS feedback_ip_time ON feedback (ip_hash, created_at)');
    return $pdo;
}

function ewd_feedback_rate_ok(string $ipHash): bool
{
    $db = ewd_feedback_db();
    $count = static function (string $since) use ($db, $ipHash): int {
        $q = $db->prepare('SELECT COUNT(*) FROM feedback WHERE ip_hash = ? AND created_at >= ?');
        $q->execute([$ipHash, $since]);
        return (int)$q->fetchColumn();
    };
    return $count(gmdate('c', time() - 3600)) < EWD_FEEDBACK_PER_HOUR
        && $count(gmdate('c', time() - 86400)) < EWD_FEEDBACK_PER_DAY;
}

/** One line of plain text: no control characters at all, so nothing can become a mail header. */
function ewd_feedback_line(string $s, int $max): string
{
    $s = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $s) ?? '';
    return mb_substr(trim($s), 0, $max);
}

/** A message keeps its line breaks and loses every other control character. */
function ewd_feedback_text(string $s): string
{
    $s = str_replace(["\r\n", "\r"], "\n", $s);
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $s) ?? '';
    return mb_substr(trim($s), 0, EWD_FEEDBACK_MAX_MESSAGE);
}

/**
 * Validates and stores one message, then emails it. Returns ['ok' => true] or
 * ['ok' => false, 'error' => code, 'status' => http status].
 */
function ewd_feedback_submit(array $in): array
{
    // A bot fills every field it can find, and nobody types an idea in under two seconds.
    if (trim((string)($in['website'] ?? '')) !== '' || (int)($in['elapsed'] ?? 0) < 2000) {
        return ['ok' => true];   // claimed, quietly, so a bot learns nothing
    }
    $message = ewd_feedback_text((string)($in['message'] ?? ''));
    if (mb_strlen($message) < 3) {
        return ['ok' => false, 'error' => 'empty', 'status' => 422];
    }
    $topics = [];
    foreach ((array)($in['topics'] ?? []) as $t) {
        if (is_string($t) && isset(EWD_FEEDBACK_TOPICS[$t]) && !in_array($t, $topics, true)) {
            $topics[] = $t;
        }
    }
    $adult = ($in['adult'] ?? false) === true;
    $email = '';
    if ($adult) {
        $candidate = ewd_feedback_line((string)($in['email'] ?? ''), 254);
        if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_EMAIL)) {
            $email = $candidate;
        }
    }
    $page = ewd_feedback_line((string)($in['page'] ?? ''), 200);
    if ($page !== '' && $page[0] !== '/') {
        $page = '';
    }

    $ipHash = ewd_ip_hash();
    if (!ewd_feedback_rate_ok($ipHash)) {
        return ['ok' => false, 'error' => 'too_many', 'status' => 429];
    }

    $now = gmdate('c');
    $db = ewd_feedback_db();
    $db->prepare('INSERT INTO feedback (created_at, topics, message, adult, email, page, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
       ->execute([$now, implode(',', $topics), $message, $adult ? 1 : 0, $email, $page, $ipHash]);
    $id = (int)$db->lastInsertId();

    $mailed = ewd_feedback_mail($id, $now, $topics, $message, $adult, $email, $page);
    if ($mailed) {
        $db->prepare('UPDATE feedback SET mailed = 1 WHERE id = ?')->execute([$id]);
    }
    // Kept either way, so a mail failure is not the visitor's problem: it is in admin.php.
    return ['ok' => true];
}

function ewd_feedback_mail(int $id, string $when, array $topics, string $message, bool $adult, string $email, string $page): bool
{
    if (!function_exists('mail')) {
        return false;
    }
    $labels = array_map(static fn(string $t): string => EWD_FEEDBACK_TOPICS[$t], $topics);
    $subject = 'Edusim feedback #' . $id . ($labels ? ': ' . implode(', ', $labels) : '');
    $body = "New feedback from the Edusim website.\n\n"
        . 'About:   ' . ($labels ? implode(', ', $labels) : '(no topic ticked)') . "\n"
        . 'Page:    https://edusim3dweb.com' . ($page !== '' ? $page : '/') . "\n"
        . 'Sent:    ' . $when . " (UTC)\n"
        . 'Reply:   ' . ($email !== '' ? $email . ' (said they are 18 or older)' : ($adult ? 'said they are 18 or older, gave no email' : 'no email (not marked 18 or older)')) . "\n\n"
        . "----------------------------------------\n"
        . $message . "\n"
        . "----------------------------------------\n\n"
        . "Every message is also kept in the World Database admin page (/worlds/admin.php).\n";
    $headers = [
        'From: Edusim Website <' . EWD_FEEDBACK_FROM . '>',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: Edusim feedback',
    ];
    if ($email !== '') {
        $headers[] = 'Reply-To: ' . $email;
    }
    $encodedSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    // -f sets sendmail's ENVELOPE sender (the Return-Path) to the same address as From. Without it
    // the envelope is the hosting account's own default address, which does not match From, and
    // Gmail rejects or junks mail whose sender it cannot authenticate. The domain also needs an SPF
    // record naming pair's mail servers; see the note in CLAUDE.md's feedback paragraph.
    try {
        return @mail(EWD_FEEDBACK_TO, $encodedSubject, $body, implode("\r\n", $headers), '-f' . EWD_FEEDBACK_FROM);
    } catch (Throwable $e) {
        return false;
    }
}

/** Newest first, within the last $days days, for stats.php's range buttons. */
function ewd_feedback_since(int $days, int $limit = 100): array
{
    try {
        $q = ewd_feedback_db()->prepare('SELECT * FROM feedback WHERE created_at >= ? ORDER BY id DESC LIMIT ?');
        $q->execute([gmdate('c', time() - $days * 86400), $limit]);
        return $q->fetchAll();
    } catch (Throwable $e) {
        return [];
    }
}

/** "New worlds, New models" from the stored comma-separated keys. */
function ewd_feedback_topic_labels(string $topics): string
{
    if ($topics === '') {
        return '';
    }
    return implode(', ', array_map(static fn($t) => EWD_FEEDBACK_TOPICS[$t] ?? $t, explode(',', $topics)));
}

/** Newest first, for admin.php. */
function ewd_feedback_recent(int $limit = 200): array
{
    try {
        $q = ewd_feedback_db()->prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT ?');
        $q->execute([$limit]);
        return $q->fetchAll();
    } catch (Throwable $e) {
        return [];
    }
}
