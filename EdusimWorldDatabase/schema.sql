-- ===========================================================================
-- Edusim World Database -- SQLite schema.
--
-- This file is the readable copy of the schema. It is NOT what creates the
-- database at runtime: lib/db.php runs the same statements itself so a fresh
-- checkout works on the first request with no setup step. Keep the two in step
-- if either changes -- db.php is authoritative.
--
-- Three things a shared world always carries, per the brief: a screenshot, a
-- description, and the world JSON itself. The first and third are FILES on disk
-- (uploads/screenshots and data/worlds); the table stores their paths, sizes and
-- a checksum. A world file is base64-heavy and routinely megabytes, and pulling
-- one through SQLite on every gallery page -- where nothing needs its bytes --
-- would make the cheapest query in the app the most expensive.
-- ===========================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS worlds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Human-readable, unique, and what world.php looks up by. Derived from the
    -- title, suffixed on collision.
    slug            TEXT    NOT NULL UNIQUE,

    title           TEXT    NOT NULL,
    creator         TEXT    NOT NULL,   -- first name / nickname, never an email
    group_name      TEXT    NOT NULL DEFAULT '',  -- optional class, club or school
    description     TEXT    NOT NULL,

    -- Read out of the world JSON at submit time rather than typed by the sharer,
    -- so the gallery can say "42 objects, on the Moon" without opening the file.
    theme           TEXT    NOT NULL DEFAULT '',
    record_count    INTEGER NOT NULL DEFAULT 0,
    kinds_json      TEXT    NOT NULL DEFAULT '{}',  -- {"preset-prop": 118, ...}

    world_path      TEXT    NOT NULL,   -- basename under data/worlds
    world_bytes     INTEGER NOT NULL,
    world_sha256    TEXT    NOT NULL,   -- duplicate detection + integrity

    shot_path       TEXT    NOT NULL,   -- basename under uploads/screenshots
    shot_thumb_path TEXT    NOT NULL DEFAULT '',
    shot_width      INTEGER NOT NULL DEFAULT 0,
    shot_height     INTEGER NOT NULL DEFAULT 0,

    -- pending | published | hidden. Which one a new row starts in is decided by
    -- EWD_REQUIRE_APPROVAL in lib/config.php.
    status          TEXT    NOT NULL DEFAULT 'published',

    downloads       INTEGER NOT NULL DEFAULT 0,
    views           INTEGER NOT NULL DEFAULT 0,

    -- Given to the sharer once, on the confirmation screen, and stored only as a
    -- hash: it lets them delete their own world later without an account, and a
    -- leaked database still cannot be used to delete anything.
    manage_key_hash TEXT    NOT NULL,

    -- Hashed with EWD_IP_SALT, never stored in the clear. Enough to rate-limit
    -- and to find everything one abuser posted; not enough to identify a child.
    submitter_ip_hash TEXT  NOT NULL DEFAULT '',

    created_at      TEXT    NOT NULL,   -- ISO-8601 UTC
    updated_at      TEXT    NOT NULL
);

-- The gallery's default view is "published, newest first"; the admin queue is
-- "pending, oldest first". Both are this index.
CREATE INDEX IF NOT EXISTS idx_worlds_status_created ON worlds (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worlds_sha            ON worlds (world_sha256);
CREATE INDEX IF NOT EXISTS idx_worlds_theme          ON worlds (theme);

-- Tags are a real table rather than a comma-separated column so the filter chips
-- on the gallery are an indexed join instead of a LIKE over every row.
CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL UNIQUE          -- already normalised: lowercase, hyphenated
);

CREATE TABLE IF NOT EXISTS world_tags (
    world_id INTEGER NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags (id)   ON DELETE CASCADE,
    PRIMARY KEY (world_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_world_tags_tag ON world_tags (tag_id);

-- One row per accepted submission, used only for the per-IP hourly rate limit.
-- Rows older than the window are deleted on each check, so this never grows.
CREATE TABLE IF NOT EXISTS submission_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submission_log ON submission_log (ip_hash, created_at);
