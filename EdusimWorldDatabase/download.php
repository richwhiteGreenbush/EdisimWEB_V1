<?php
declare(strict_types=1);

/*
 * Serve a world's .json.
 *
 * Every download goes through PHP rather than a direct link into data/, for three
 * reasons: it is what counts the download, it is what enforces the published/pending
 * check, and it is what gives the file a name a student can recognise in their Downloads
 * folder rather than the random one it is stored under.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';
require_once __DIR__ . '/lib/admin.php';

$id = (int)($_GET['id'] ?? 0);
$world = $id > 0 ? ewd_find_world($id) : null;

// A pending or hidden world is downloadable only by an admin -- the sharer's own key is
// deliberately not accepted here. They already have the file: it is the one they uploaded.
if (!$world || ($world['status'] !== 'published' && !ewd_is_admin())) {
    http_response_code(404);
    ewd_header(['title' => 'World not found']);
    echo '<main class="section"><div class="wrap"><div class="empty">'
       . '<span class="icon" aria-hidden="true">🧭</span>'
       . '<h3>That world is not here</h3>'
       . '<p>The link may be wrong, or the world may have been taken down.</p>'
       . '<a class="btn btn-primary" href="index.php">Back to the gallery</a>'
       . '</div></div></main>';
    ewd_footer();
    exit;
}

// basename() is what stops a stored path ever escaping the worlds directory. The column
// only ever holds a name this app generated, so this is a second lock on a door that is
// already shut -- but it costs nothing and the failure it prevents is arbitrary file read.
$path = EWD_WORLD_DIR . '/' . basename((string)$world['world_path']);

if (!is_file($path)) {
    http_response_code(404);
    ewd_header(['title' => 'File missing']);
    echo '<main class="section"><div class="wrap"><div class="empty">'
       . '<span class="icon" aria-hidden="true">📂</span>'
       . '<h3>That world file has gone missing</h3>'
       . '<p>The world is listed but its file is not on the server any more. '
       . 'Please tell whoever looks after this site.</p>'
       . '<a class="btn btn-primary" href="index.php">Back to the gallery</a>'
       . '</div></div></main>';
    ewd_footer();
    exit;
}

ewd_bump((int)$world['id'], 'downloads');

// The filename a student sees. Built from the slug -- which this app generated and is
// already [a-z0-9-] -- so there is nothing in it that could break out of the header.
$filename = 'edusim-' . basename((string)$world['slug']) . '.json';

// Any output before this point (a stray warning, a BOM in an include) would corrupt the
// download, which is why nothing above echoes on the success path.
if (ob_get_level() > 0) {
    ob_end_clean();
}

header('Content-Type: application/json; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
header('Content-Length: ' . (string)filesize($path));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=0, must-revalidate');

readfile($path);
exit;
