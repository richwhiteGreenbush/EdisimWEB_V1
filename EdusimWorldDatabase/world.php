<?php
declare(strict_types=1);

/*
 * One world: the screenshot full size, the description, what is in it, and the download.
 *
 * Also the only place a world can be deleted by the person who shared it -- with the
 * manage key they were given on the confirmation screen, which is checked against a hash
 * with password_verify(). No accounts, no email, nothing to lose but the key itself.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';
require_once __DIR__ . '/lib/admin.php';

$id  = (int)($_GET['id'] ?? 0);
$key = (string)($_GET['key'] ?? '');
$justShared = isset($_GET['shared']);

$world = $id > 0 ? ewd_find_world($id) : null;

// A slug is accepted as well as an id, so a link can be readable.
if (!$world && isset($_GET['slug'])) {
    $world = ewd_find_world_by_slug((string)$_GET['slug']);
}

$isAdmin = ewd_is_admin();

// password_verify() is the check, so a key in the URL is never compared to a stored key
// in the clear. The empty-string guard matters: without it every visitor with no key at
// all would be running a verify against the hash, and a blank key must never be the
// thing that opens the delete button.
$hasKey = $key !== '' && password_verify($key, (string)($world['manage_key_hash'] ?? ''));

if (!$world || ($world['status'] !== 'published' && !$isAdmin && !$hasKey)) {
    http_response_code(404);
    ewd_header(['title' => 'World not found']);
    ?>
    <main class="section">
      <div class="wrap">
        <div class="empty">
          <span class="icon" aria-hidden="true">🧭</span>
          <h3>That world is not here</h3>
          <p>
            It may have been taken down by whoever shared it, or the link may be wrong.
            Everything else is still in the gallery.
          </p>
          <a class="btn btn-primary" href="index.php">Back to the gallery</a>
        </div>
      </div>
    </main>
    <?php
    ewd_footer();
    exit;
}

// ---------------------------------------------------------------------------
// Delete, by the sharer's own key. POST only, and CSRF-checked: a GET that deletes
// something can be fired by any image tag on any page in the world.
// ---------------------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST' && ($_POST['action'] ?? '') === 'delete') {
    if (!ewd_csrf_ok()) {
        ewd_flash('error', 'That request expired. Try again.');
        ewd_redirect('world.php?id=' . (int)$world['id'] . '&key=' . eu($key));
    }
    if (!$hasKey && !$isAdmin) {
        ewd_flash('error', 'That management key does not match this world.');
        ewd_redirect('world.php?id=' . (int)$world['id']);
    }
    ewd_delete_world((int)$world['id']);
    ewd_flash('success', 'Your world has been removed, along with its screenshot and world file.');
    ewd_redirect('index.php');
}

ewd_bump((int)$world['id'], 'views');

$kinds = ewd_summarise_kinds(json_decode((string)$world['kinds_json'], true) ?: []);
$theme = (string)$world['theme'];
$shot  = (string)$world['shot_path'];

ewd_header([
    'title'       => $world['title'],
    'description' => ewd_truncate((string)$world['description'], 160),
]);
?>

<main class="section">
  <div class="wrap">

    <?php if ($justShared && $key !== ''): ?>
      <div class="panel" style="margin-bottom:28px;border-color:#2c8a60;background:#eafaf1;">
        <h2 style="margin-bottom:6px;">🎉 Your world is shared</h2>
        <p style="margin-bottom:4px;">
          Here is the key that lets you take it down again. It is shown
          <strong>once, right now</strong> — nobody can look it up for you later, not even
          your teacher, because only a scrambled copy of it is stored.
        </p>
        <div class="keybox"><?= e($key) ?></div>
        <p class="hint" style="margin-bottom:14px;">
          Copy it somewhere safe, or bookmark
          <strong>this page as it is now</strong> — the key is part of the address.
        </p>
        <p style="margin:0;">
          <a class="btn btn-green btn-sm" href="index.php">See it in the gallery →</a>
        </p>
      </div>
    <?php endif; ?>

    <?php if ($world['status'] !== 'published'): ?>
      <div class="flash flash-info" style="margin-bottom:24px;">
        <?php if ($world['status'] === 'pending'): ?>
          This world is waiting to be checked by a teacher. Only you and they can see this page.
        <?php else: ?>
          This world is hidden from the gallery.
        <?php endif; ?>
      </div>
    <?php endif; ?>

    <div class="detail-grid">

      <div>
        <figure class="detail-shot">
          <img src="<?= e(EWD_SHOT_URL . '/' . $shot) ?>"
               <?php if ((int)$world['shot_width'] > 0): ?>
               width="<?= (int)$world['shot_width'] ?>" height="<?= (int)$world['shot_height'] ?>"
               <?php endif; ?>
               alt="A screenshot of “<?= e($world['title']) ?>”, a world built in Edusim by <?= e($world['creator']) ?>." />
          <figcaption><?= e($world['title']) ?> — <?= e(ewd_theme_label($theme)) ?></figcaption>
        </figure>

        <div class="detail-body">
          <span class="world-kicker"><?= ewd_theme_emoji($theme) ?> <?= e(ewd_theme_label($theme)) ?></span>
          <h1 style="font-size:clamp(1.7rem,3.6vw,2.5rem);margin:8px 0 6px;"><?= e($world['title']) ?></h1>
          <p class="world-by" style="font-size:0.98rem;">
            Built by <strong><?= e($world['creator']) ?></strong><?php
              if ($world['group_name'] !== '') { echo ' · ' . e($world['group_name']); }
            ?> · shared <?= e(ewd_when((string)$world['created_at'])) ?>
          </p>

          <h2>About this world</h2>
          <?= ewd_paragraphs((string)$world['description']) ?>

          <?php if ($world['tags']): ?>
            <div class="tag-row">
              <?php foreach ($world['tags'] as $t): ?>
                <a class="chip" href="<?= e('index.php?tag=' . eu($t)) ?>">#<?= e($t) ?></a>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>
      </div>

      <aside>
        <div class="side-card">
          <h3>Get this world</h3>
          <div class="detail-actions">
            <a class="btn btn-primary" href="<?= e('download.php?id=' . (int)$world['id']) ?>">
              ⬇ Download the world file
            </a>
            <a class="btn btn-ghost" href="<?= e(EWD_APP_URL) ?>" target="_blank" rel="noopener noreferrer">
              Open Edusim
            </a>
          </div>
          <ol class="load-steps" style="margin-top:18px;">
            <li>Download the file above.</li>
            <li>Open Edusim and choose <strong>Menu ▸ Load World ▸ Load World File</strong>.</li>
            <li>Pick the file you just downloaded.</li>
          </ol>
          <p class="hint" style="margin-top:12px;">
            Loading a world <strong>replaces</strong> what is currently in your copy of
            Edusim. Save your own world first if you want to keep it.
          </p>
        </div>

        <div class="side-card">
          <h3>What is in it</h3>
          <ul class="meta-list">
            <li><span class="k">Where</span><span class="v"><?= e(ewd_theme_label($theme)) ?></span></li>
            <li><span class="k">Things in the world</span><span class="v"><?= number_format((int)$world['record_count']) ?></span></li>
            <?php foreach ($kinds as $label => $count): ?>
              <li><span class="k"><?= e((string)$label) ?></span><span class="v"><?= number_format((int)$count) ?></span></li>
            <?php endforeach; ?>
            <li><span class="k">File size</span><span class="v"><?= e(ewd_bytes((int)$world['world_bytes'])) ?></span></li>
            <li><span class="k">Downloads</span><span class="v"><?= number_format((int)$world['downloads']) ?></span></li>
          </ul>
        </div>

        <?php if ($hasKey || $isAdmin): ?>
        <div class="side-card" style="border-color:#a82f44;">
          <h3>Take this world down</h3>
          <p class="hint">
            This removes the world, its screenshot and its file for good. It cannot be undone.
          </p>
          <?php /* The title is deliberately NOT interpolated into this confirm(): it is
                   user text crossing into a JavaScript string literal inside an HTML
                   attribute, which is two layers of escaping to get right for no gain --
                   the reader is looking at the world's own page while they press it. */ ?>
          <form method="post" action="<?= e('world.php?id=' . (int)$world['id'] . '&key=' . eu($key)) ?>"
                onsubmit="return confirm('Delete this world for good? This cannot be undone.');">
            <?= ewd_csrf_field() ?>
            <input type="hidden" name="action" value="delete" />
            <button class="btn btn-danger btn-sm" type="submit">Delete this world</button>
          </form>
        </div>
        <?php else: ?>
        <div class="side-card">
          <h3>Is this yours?</h3>
          <p class="hint" style="margin:0;">
            If you shared this world, open it with the management key you were given and a
            delete button appears here.
          </p>
        </div>
        <?php endif; ?>
      </aside>

    </div>

    <p style="margin-top:36px;"><a class="chip" href="index.php">← Back to all worlds</a></p>

  </div>
</main>

<?php ewd_footer(); ?>
