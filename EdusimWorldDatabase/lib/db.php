<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

/*
 * SQLite connection + schema bootstrap.
 *
 * The schema lives here as well as in schema.sql, and this copy is the authoritative
 * one: a fresh checkout has to work on the first request without anyone remembering to
 * run a setup command, and "the database file is missing" is not an error a student
 * sharing a world should ever see. Every statement is IF NOT EXISTS, so calling this on
 * every request costs one cheap no-op transaction and can never destroy data.
 */

function ewd_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    ewd_ensure_dirs();

    $pdo = new PDO('sqlite:' . EWD_DB_FILE, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ]);

    // WAL lets the gallery keep reading while someone is mid-upload; without it a
    // submission's write transaction blocks every reader for its duration. The busy
    // timeout is what turns a simultaneous-write collision into a short wait instead of
    // an immediate "database is locked" exception -- a real risk here, since a class
    // shares thirty worlds inside one minute.
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA synchronous = NORMAL');

    ewd_migrate($pdo);

    return $pdo;
}

function ewd_ensure_dirs(): void
{
    foreach ([EWD_DATA_DIR, EWD_WORLD_DIR, EWD_UPLOAD_DIR, EWD_SHOT_DIR] as $dir) {
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Cannot create directory: ' . $dir);
        }
    }

    // Belt and braces for an Apache deployment where the app sits inside the document
    // root: data/ holds the database and every world payload, and neither should be
    // fetchable by URL. download.php is the only intended way to a world file, because
    // it is what counts downloads and sets the filename. Nginx ignores .htaccess -- see
    // README.md for the equivalent location block.
    ewd_write_once(EWD_DATA_DIR . '/.htaccess', "Require all denied\nDeny from all\n");

    // uploads/ IS meant to be readable -- screenshots are served straight off disk -- so
    // this one only stops the directory being used to execute anything. Screenshots are
    // re-encoded through GD before they land here, so nothing with a payload in it
    // survives, but a directory that both accepts uploads and runs PHP is the classic
    // hole and is worth closing twice.
    ewd_write_once(EWD_UPLOAD_DIR . '/.htaccess', implode("\n", [
        'php_flag engine off',
        '<IfModule mod_php.c>',
        '  php_admin_flag engine off',
        '</IfModule>',
        'RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar',
        'RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar',
        '',
    ]));
}

function ewd_write_once(string $path, string $contents): void
{
    if (!is_file($path)) {
        @file_put_contents($path, $contents);
    }
}

/**
 * Create anything missing. Mirrors schema.sql -- keep the two in step.
 */
function ewd_migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS worlds (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            slug              TEXT    NOT NULL UNIQUE,
            title             TEXT    NOT NULL,
            creator           TEXT    NOT NULL,
            group_name        TEXT    NOT NULL DEFAULT '',
            description       TEXT    NOT NULL,
            theme             TEXT    NOT NULL DEFAULT '',
            record_count      INTEGER NOT NULL DEFAULT 0,
            kinds_json        TEXT    NOT NULL DEFAULT '{}',
            world_path        TEXT    NOT NULL,
            world_bytes       INTEGER NOT NULL,
            world_sha256      TEXT    NOT NULL,
            shot_path         TEXT    NOT NULL,
            shot_thumb_path   TEXT    NOT NULL DEFAULT '',
            shot_width        INTEGER NOT NULL DEFAULT 0,
            shot_height       INTEGER NOT NULL DEFAULT 0,
            status            TEXT    NOT NULL DEFAULT 'published',
            downloads         INTEGER NOT NULL DEFAULT 0,
            views             INTEGER NOT NULL DEFAULT 0,
            manage_key_hash   TEXT    NOT NULL,
            submitter_ip_hash TEXT    NOT NULL DEFAULT '',
            created_at        TEXT    NOT NULL,
            updated_at        TEXT    NOT NULL
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_worlds_status_created ON worlds (status, created_at DESC)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_worlds_sha ON worlds (world_sha256)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_worlds_theme ON worlds (theme)');

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    SQL);

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS world_tags (
            world_id INTEGER NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
            tag_id   INTEGER NOT NULL REFERENCES tags (id)   ON DELETE CASCADE,
            PRIMARY KEY (world_id, tag_id)
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_world_tags_tag ON world_tags (tag_id)');

    $pdo->exec(<<<'SQL'
        CREATE TABLE IF NOT EXISTS submission_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_hash    TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    SQL);

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_submission_log ON submission_log (ip_hash, created_at)');
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * One page of the gallery.
 *
 * Every filter is optional and they compose: $opts = [status, search, tag, theme,
 * sort, page, perPage]. Returns ['rows' => [...], 'total' => int, 'pages' => int,
 * 'page' => int].
 */
function ewd_list_worlds(array $opts = []): array
{
    $status  = $opts['status']  ?? 'published';
    $search  = trim((string)($opts['search'] ?? ''));
    $tag     = trim((string)($opts['tag'] ?? ''));
    $theme   = trim((string)($opts['theme'] ?? ''));
    $sort    = (string)($opts['sort'] ?? 'new');
    $page    = max(1, (int)($opts['page'] ?? 1));
    $perPage = max(1, (int)($opts['perPage'] ?? EWD_PER_PAGE));

    $where  = [];
    $params = [];

    if ($status !== 'any') {
        $where[] = 'w.status = :status';
        $params[':status'] = $status;
    }

    if ($search !== '') {
        // LIKE rather than FTS5: the extension is not compiled into every PHP build a
        // school might have, and a gallery of a few thousand classroom worlds is far
        // inside the range where a scan is instant. ESCAPE is what stops a literal % or
        // _ typed in the search box from matching everything.
        $where[] = '(w.title LIKE :q ESCAPE \'\\\' OR w.creator LIKE :q ESCAPE \'\\\' '
                 . 'OR w.description LIKE :q ESCAPE \'\\\' OR w.group_name LIKE :q ESCAPE \'\\\')';
        $params[':q'] = '%' . ewd_like_escape($search) . '%';
    }

    if ($theme !== '') {
        $where[] = 'w.theme = :theme';
        $params[':theme'] = $theme;
    }

    if ($tag !== '') {
        $where[] = 'EXISTS (SELECT 1 FROM world_tags wt JOIN tags t ON t.id = wt.tag_id '
                 . 'WHERE wt.world_id = w.id AND t.name = :tag)';
        $params[':tag'] = $tag;
    }

    $sql = $where ? ' WHERE ' . implode(' AND ', $where) : '';

    $orderBy = match ($sort) {
        'downloads' => 'w.downloads DESC, w.created_at DESC',
        'title'     => 'w.title COLLATE NOCASE ASC',
        'oldest'    => 'w.created_at ASC',
        default     => 'w.created_at DESC',
    };

    $db = ewd_db();

    $countStmt = $db->prepare('SELECT COUNT(*) FROM worlds w' . $sql);
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    $pages = max(1, (int)ceil($total / $perPage));
    $page  = min($page, $pages);
    $offset = ($page - 1) * $perPage;

    // LIMIT/OFFSET are integers built from validated ints, not user text -- but they are
    // still bound rather than interpolated, so there is no string concatenation into SQL
    // anywhere in this file.
    $stmt = $db->prepare(
        'SELECT w.* FROM worlds w' . $sql . ' ORDER BY ' . $orderBy . ' LIMIT :limit OFFSET :offset'
    );
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v);
    }
    $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    ewd_attach_tags($rows);

    return ['rows' => $rows, 'total' => $total, 'pages' => $pages, 'page' => $page];
}

/**
 * Load each world's tags in ONE query rather than one per row -- the same N+1 that makes
 * a twelve-card gallery do thirteen round trips.
 */
function ewd_attach_tags(array &$rows): void
{
    if (!$rows) {
        return;
    }
    $ids = array_column($rows, 'id');
    $in  = implode(',', array_fill(0, count($ids), '?'));
    $stmt = ewd_db()->prepare(
        "SELECT wt.world_id, t.name FROM world_tags wt JOIN tags t ON t.id = wt.tag_id
         WHERE wt.world_id IN ($in) ORDER BY t.name"
    );
    $stmt->execute($ids);

    $byWorld = [];
    foreach ($stmt->fetchAll() as $r) {
        $byWorld[(int)$r['world_id']][] = $r['name'];
    }
    foreach ($rows as &$row) {
        $row['tags'] = $byWorld[(int)$row['id']] ?? [];
    }
    unset($row);
}

function ewd_find_world(int $id): ?array
{
    $stmt = ewd_db()->prepare('SELECT * FROM worlds WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $rows = [$row];
    ewd_attach_tags($rows);
    return $rows[0];
}

function ewd_find_world_by_slug(string $slug): ?array
{
    $stmt = ewd_db()->prepare('SELECT * FROM worlds WHERE slug = ?');
    $stmt->execute([$slug]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    $rows = [$row];
    ewd_attach_tags($rows);
    return $rows[0];
}

/** A world already shared, byte for byte. Lets the form say so instead of storing it twice. */
function ewd_find_world_by_hash(string $sha256): ?array
{
    $stmt = ewd_db()->prepare('SELECT * FROM worlds WHERE world_sha256 = ? LIMIT 1');
    $stmt->execute([$sha256]);
    return $stmt->fetch() ?: null;
}

function ewd_count_by_status(): array
{
    $out = ['published' => 0, 'pending' => 0, 'hidden' => 0];
    foreach (ewd_db()->query('SELECT status, COUNT(*) c FROM worlds GROUP BY status') as $r) {
        $out[$r['status']] = (int)$r['c'];
    }
    return $out;
}

/** Tags that are actually on a visible world, with counts -- for the filter chips. */
function ewd_popular_tags(int $limit = 18, string $status = 'published'): array
{
    $stmt = ewd_db()->prepare(
        'SELECT t.name, COUNT(*) AS c
           FROM tags t
           JOIN world_tags wt ON wt.tag_id = t.id
           JOIN worlds w ON w.id = wt.world_id
          WHERE w.status = :status
          GROUP BY t.name
          ORDER BY c DESC, t.name ASC
          LIMIT :limit'
    );
    $stmt->bindValue(':status', $status);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();
    return $stmt->fetchAll();
}

function ewd_themes_in_use(string $status = 'published'): array
{
    $stmt = ewd_db()->prepare(
        "SELECT theme, COUNT(*) c FROM worlds WHERE status = ? AND theme <> ''
         GROUP BY theme ORDER BY c DESC"
    );
    $stmt->execute([$status]);
    return $stmt->fetchAll();
}

/**
 * Insert a world and its tags in one transaction, so a failure half way cannot leave a
 * world with no tags or a tag pointing at nothing.
 *
 * @return int new world id
 */
function ewd_insert_world(array $data, array $tags): int
{
    $db = ewd_db();
    $db->beginTransaction();
    try {
        $cols = [
            'slug', 'title', 'creator', 'group_name', 'description', 'theme',
            'record_count', 'kinds_json', 'world_path', 'world_bytes', 'world_sha256',
            'shot_path', 'shot_thumb_path', 'shot_width', 'shot_height', 'status',
            'manage_key_hash', 'submitter_ip_hash', 'created_at', 'updated_at',
        ];
        $placeholders = array_map(static fn ($c) => ':' . $c, $cols);
        $stmt = $db->prepare(
            'INSERT INTO worlds (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $placeholders) . ')'
        );
        foreach ($cols as $c) {
            $stmt->bindValue(':' . $c, $data[$c]);
        }
        $stmt->execute();
        $id = (int)$db->lastInsertId();

        ewd_set_world_tags($id, $tags, $db);

        $db->commit();
        return $id;
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

function ewd_set_world_tags(int $worldId, array $tags, ?PDO $db = null): void
{
    $db ??= ewd_db();
    $db->prepare('DELETE FROM world_tags WHERE world_id = ?')->execute([$worldId]);

    $findTag = $db->prepare('SELECT id FROM tags WHERE name = ?');
    $addTag  = $db->prepare('INSERT INTO tags (name) VALUES (?)');
    $link    = $db->prepare('INSERT OR IGNORE INTO world_tags (world_id, tag_id) VALUES (?, ?)');

    foreach ($tags as $name) {
        $findTag->execute([$name]);
        $tagId = $findTag->fetchColumn();
        if ($tagId === false) {
            $addTag->execute([$name]);
            $tagId = $db->lastInsertId();
        }
        $link->execute([$worldId, (int)$tagId]);
    }
}

function ewd_set_status(int $id, string $status): void
{
    $stmt = ewd_db()->prepare('UPDATE worlds SET status = ?, updated_at = ? WHERE id = ?');
    $stmt->execute([$status, ewd_now(), $id]);
}

function ewd_bump(int $id, string $column): void
{
    // Whitelisted, because a column name cannot be a bound parameter.
    if (!in_array($column, ['downloads', 'views'], true)) {
        return;
    }
    ewd_db()->prepare("UPDATE worlds SET $column = $column + 1 WHERE id = ?")->execute([$id]);
}

/**
 * Delete a world and both of its files. The row goes first and the files after: an
 * orphaned file wastes a few megabytes, while a row pointing at a file that is gone is a
 * broken page in the gallery.
 */
function ewd_delete_world(int $id): bool
{
    $world = ewd_find_world($id);
    if (!$world) {
        return false;
    }

    // ON DELETE CASCADE clears world_tags, but only because PRAGMA foreign_keys is ON --
    // SQLite defaults it OFF per connection, which is why ewd_db() sets it every time.
    ewd_db()->prepare('DELETE FROM worlds WHERE id = ?')->execute([$id]);

    foreach ([
        EWD_WORLD_DIR . '/' . $world['world_path'],
        EWD_SHOT_DIR . '/' . $world['shot_path'],
        $world['shot_thumb_path'] !== '' ? EWD_SHOT_DIR . '/' . $world['shot_thumb_path'] : null,
    ] as $file) {
        if ($file !== null && is_file($file)) {
            @unlink($file);
        }
    }

    // Tags that no longer belong to anything would otherwise pile up in the filter chips.
    ewd_db()->exec('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM world_tags)');

    return true;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function ewd_rate_limit_ok(string $ipHash): bool
{
    $db = ewd_db();
    $cutoff = gmdate('Y-m-d\TH:i:s\Z', time() - 3600);

    // Prune first, so the table stays the size of one hour's traffic forever.
    $db->prepare('DELETE FROM submission_log WHERE created_at < ?')->execute([$cutoff]);

    $stmt = $db->prepare('SELECT COUNT(*) FROM submission_log WHERE ip_hash = ? AND created_at >= ?');
    $stmt->execute([$ipHash, $cutoff]);

    return (int)$stmt->fetchColumn() < EWD_RATE_LIMIT_PER_HOUR;
}

function ewd_log_submission(string $ipHash): void
{
    ewd_db()->prepare('INSERT INTO submission_log (ip_hash, created_at) VALUES (?, ?)')
            ->execute([$ipHash, ewd_now()]);
}

function ewd_now(): string
{
    return gmdate('Y-m-d\TH:i:s\Z');
}

function ewd_like_escape(string $s): string
{
    return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $s);
}
