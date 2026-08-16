<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/*
 * Validating and reading an Edusim world file.
 *
 * The format is whatever `exportWorldToFile()` in src/WorldFile.js writes:
 *
 *   { format: 'edusim-world', version: 1, exportedAt: <ms>, records: [ ... ] }
 *
 * and each record is one placed object, dispatched by `record.kind` in
 * WorldStore.rehydrateOne(). Any record MAY carry `files: [{name, type, dataBase64}]` --
 * that is where an imported model's bytes or a balloon's painted canvas live, and it is
 * why these files are megabytes rather than kilobytes.
 *
 * Nothing here rewrites the file. It is stored byte for byte as uploaded, so what a
 * classmate downloads is exactly what the sharer exported and `readWorldFile()` can be
 * trusted to accept it. This code only reads it well enough to (a) refuse something that
 * is not a world at all, and (b) pull out the count, the kinds and the theme so the
 * gallery can describe a world without opening its file.
 */

/** record.kind values WorldStore.rehydrateOne() knows how to rebuild. */
function ewd_known_kinds(): array
{
    return [
        'gltf', 'obj', 'image', 'gif', 'balloon', 'light-orb', 'web-browser',
        'preset-prop', 'primitive', 'built-model', 'world-theme',
        'startup-library', 'startup-tree', 'startup-billboard',
    ];
}

/**
 * @return array{ok: bool, error: string, records: int, kinds: array<string,int>,
 *                theme: string, objects: int}
 */
function ewd_inspect_world_json(string $raw): array
{
    $fail = static fn (string $msg): array => [
        'ok' => false, 'error' => $msg, 'records' => 0, 'kinds' => [], 'theme' => '', 'objects' => 0,
    ];

    if (trim($raw) === '') {
        return $fail('That world file is empty.');
    }

    // A UTF-8 BOM makes json_decode fail with a syntax error that tells the student
    // nothing. Some editors and cloud drives add one on a round trip, so strip it rather
    // than reject a file that is otherwise perfectly good.
    if (str_starts_with($raw, "\xEF\xBB\xBF")) {
        $raw = substr($raw, 3);
    }

    try {
        $data = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        return $fail('That file is not valid JSON — it may not be a world file, or the download was cut short.');
    }

    if (!is_array($data)) {
        return $fail('That file is not an Edusim world save.');
    }

    // `format` is checked only when present. Worlds exported before the field existed are
    // still perfectly loadable by the app -- readWorldFile() itself only requires
    // `records` to be an array -- so requiring it here would reject files the app accepts.
    if (isset($data['format']) && $data['format'] !== 'edusim-world') {
        return $fail('That is a JSON file, but not an Edusim world save.');
    }

    if (!isset($data['records']) || !is_array($data['records'])) {
        return $fail('That file has no world records in it. Use Load World ▸ Save World in Edusim to make one.');
    }

    $records = $data['records'];
    if ($records === []) {
        return $fail('That world is empty — there is nothing in it to share yet.');
    }

    $kinds = [];
    $theme = '';
    $recognised = 0;

    foreach ($records as $record) {
        if (!is_array($record)) {
            continue;
        }
        $kind = isset($record['kind']) && is_string($record['kind']) ? $record['kind'] : '(unknown)';
        $kinds[$kind] = ($kinds[$kind] ?? 0) + 1;

        if (in_array($kind, ewd_known_kinds(), true)) {
            $recognised++;
        }
        if ($kind === 'world-theme' && isset($record['theme']) && is_string($record['theme'])) {
            $theme = $record['theme'];
        }
    }

    if ($recognised === 0) {
        return $fail('That file is shaped like a world save but has nothing in it Edusim recognises.');
    }

    // A world with no world-theme record loads on the `default` theme -- that is exactly
    // what WorldStore.loadFromRecords() does with one, so recording it here means the
    // gallery shows what the file will actually look like, not a blank.
    if ($theme === '') {
        $theme = 'default';
    }

    ksort($kinds);

    return [
        'ok'      => true,
        'error'   => '',
        'records' => count($records),
        'kinds'   => $kinds,
        'theme'   => $theme,
        // What a person would call "things in this world": every record except the one
        // bookkeeping row that carries the sky colour.
        'objects' => count($records) - ($kinds['world-theme'] ?? 0),
    ];
}

/**
 * Store the uploaded world file under data/worlds and return its details.
 *
 * @return array{path: string, bytes: int, sha256: string}
 */
function ewd_store_world_file(string $raw, string $slug): array
{
    ewd_ensure_dirs();

    // The name on disk is never the uploaded one: a filename is attacker-controlled text
    // and this one is built entirely from a slug we generated plus random hex. The slug
    // is only in it to make the directory browsable by a human.
    $name = $slug . '-' . bin2hex(random_bytes(6)) . '.json';
    $path = EWD_WORLD_DIR . '/' . $name;

    if (file_put_contents($path, $raw, LOCK_EX) === false) {
        throw new RuntimeException('Could not save the world file.');
    }
    @chmod($path, 0644);

    return ['path' => $name, 'bytes' => strlen($raw), 'sha256' => hash('sha256', $raw)];
}
