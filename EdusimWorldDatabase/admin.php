<?php
declare(strict_types=1);

/*
 * Teacher tools: approve, hide and delete shared worlds.
 *
 * Three states, and the middle one is the point of the page:
 *
 *   pending   -- waiting to be checked (only when EWD_REQUIRE_APPROVAL is on)
 *   published -- in the gallery
 *   hidden    -- taken out of the gallery but NOT deleted
 *
 * Hiding exists because "this one is not appropriate" and "this one should not exist"
 * are different judgements, and a teacher making the first one at speed should not have
 * to make the second irreversibly. Delete is still there, and it removes both files.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';
require_once __DIR__ . '/lib/admin.php';

$action = (string)($_POST['action'] ?? '');

// ---------------------------------------------------------------------------
// First-run setup: no password has been chosen yet.
// ---------------------------------------------------------------------------

if (!ewd_admin_configured()) {
    $generated = null;
    if ($action === 'setup' && ewd_csrf_ok()) {
        $password = (string)($_POST['password'] ?? '');
        if (strlen($password) < 8) {
            ewd_flash('error', 'Choose a password of at least 8 characters.');
        } else {
            $generated = password_hash($password, PASSWORD_DEFAULT);
        }
    }

    ewd_header(['title' => 'Set up teacher tools']);
    ?>
    <main class="section">
      <div class="wrap">
        <div class="panel login-panel" style="max-width:640px;">
          <h1 style="font-size:1.6rem;">Set up the teacher tools</h1>
          <p class="hint">
            No password has been set yet, so nobody can reach the moderation queue. Choose
            one below and this page will print the line to add to your configuration —
            the password itself is never written anywhere, only a scrambled copy of it.
          </p>

          <?php if ($generated !== null): ?>
            <div class="flash flash-success" style="margin:18px 0;">Password accepted. Two steps left:</div>
            <ol class="load-steps" style="font-size:1rem;">
              <li>
                Create the file
                <span class="inline-code">lib/config.local.php</span> with exactly this in it:
              </li>
            </ol>
            <div class="keybox" style="white-space:pre;font-size:0.86rem;">&lt;?php
define('EWD_ADMIN_PASSWORD_HASH', '<?= e($generated) ?>');</div>
            <ol class="load-steps" style="font-size:1rem;" start="2">
              <li>Reload this page and log in.</li>
            </ol>
            <p class="hint" style="margin-top:14px;">
              While you are in that file, it is worth overriding
              <span class="inline-code">EWD_IP_SALT</span> with a random string of your
              own, and setting <span class="inline-code">EWD_REQUIRE_APPROVAL</span> to
              <span class="inline-code">true</span> if worlds should be checked before
              they appear.
            </p>
          <?php else: ?>
            <form method="post" action="admin.php" style="margin-top:20px;">
              <?= ewd_csrf_field() ?>
              <input type="hidden" name="action" value="setup" />
              <div class="field">
                <label for="password">Choose a teacher password</label>
                <input type="password" id="password" name="password" required minlength="8"
                       autocomplete="new-password" />
                <p class="hint">At least 8 characters. Everyone with the tools shares this one.</p>
              </div>
              <div class="form-actions">
                <button class="btn btn-primary" type="submit">Make the hash</button>
                <a class="btn btn-ghost" href="index.php">Back to the gallery</a>
              </div>
            </form>
          <?php endif; ?>
        </div>
      </div>
    </main>
    <?php
    ewd_footer();
    exit;
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

if ($action === 'login') {
    if (!ewd_csrf_ok()) {
        ewd_flash('error', 'That form expired. Try again.');
    } elseif (ewd_admin_login((string)($_POST['password'] ?? ''))) {
        ewd_flash('success', 'Signed in.');
        ewd_redirect('admin.php');
    } else {
        ewd_login_delay();
        ewd_flash('error', 'That password is not right.');
    }
    ewd_redirect('admin.php');
}

if ($action === 'logout' && ewd_csrf_ok()) {
    ewd_admin_logout();
    ewd_flash('success', 'Signed out.');
    ewd_redirect('index.php');
}

if (!ewd_is_admin()) {
    ewd_header(['title' => 'Teacher tools']);
    ?>
    <main class="section">
      <div class="wrap">
        <div class="panel login-panel">
          <h1 style="font-size:1.5rem;">Teacher tools</h1>
          <p class="hint">
            Approving, hiding and removing shared worlds. Students do not need this — they
            get a key of their own for the world they shared.
          </p>
          <form method="post" action="admin.php" style="margin-top:18px;">
            <?= ewd_csrf_field() ?>
            <input type="hidden" name="action" value="login" />
            <div class="field">
              <label for="password">Password</label>
              <input type="password" id="password" name="password" required autocomplete="current-password" />
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">Sign in</button>
              <a class="btn btn-ghost" href="index.php">Back to the gallery</a>
            </div>
          </form>
        </div>
      </div>
    </main>
    <?php
    ewd_footer();
    exit;
}

// ---------------------------------------------------------------------------
// Moderation actions -- every one is a POST with a CSRF token
// ---------------------------------------------------------------------------

if (in_array($action, ['approve', 'hide', 'publish', 'delete'], true)) {
    if (!ewd_csrf_ok()) {
        ewd_flash('error', 'That request expired. Try again.');
        ewd_redirect('admin.php');
    }
    $targetId = (int)($_POST['id'] ?? 0);
    $world = ewd_find_world($targetId);
    if (!$world) {
        ewd_flash('error', 'That world is not there any more.');
        ewd_redirect('admin.php');
    }

    switch ($action) {
        case 'approve':
        case 'publish':
            ewd_set_status($targetId, 'published');
            ewd_flash('success', '“' . $world['title'] . '” is now in the gallery.');
            break;
        case 'hide':
            ewd_set_status($targetId, 'hidden');
            ewd_flash('success', '“' . $world['title'] . '” has been hidden. Nothing was deleted.');
            break;
        case 'delete':
            ewd_delete_world($targetId);
            ewd_flash('success', '“' . $world['title'] . '” has been deleted, with its screenshot and world file.');
            break;
    }
    // Redirect back to the same filter the teacher was looking at, so working through a
    // queue does not throw them back to the top of the list after every click.
    ewd_redirect('admin.php?status=' . eu((string)($_POST['return_status'] ?? 'any')));
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

$status = (string)($_GET['status'] ?? (EWD_REQUIRE_APPROVAL ? 'pending' : 'any'));
if (!in_array($status, ['any', 'pending', 'published', 'hidden'], true)) {
    $status = 'any';
}

$page = max(1, (int)($_GET['page'] ?? 1));
$result = ewd_list_worlds([
    'status'  => $status,
    'search'  => trim((string)($_GET['q'] ?? '')),
    'sort'    => $status === 'pending' ? 'oldest' : 'new',
    'page'    => $page,
    'perPage' => 24,
]);
$counts = ewd_count_by_status();

ewd_header(['title' => 'Teacher tools']);
?>

<main class="section">
  <div class="wrap">

    <div class="admin-bar">
      <h1 style="margin:0;font-size:1.6rem;">Teacher tools</h1>
      <?php foreach ([
          'any'       => 'Everything (' . array_sum($counts) . ')',
          'pending'   => 'Waiting (' . $counts['pending'] . ')',
          'published' => 'In the gallery (' . $counts['published'] . ')',
          'hidden'    => 'Hidden (' . $counts['hidden'] . ')',
      ] as $key => $label): ?>
        <a class="chip<?= $status === $key ? ' is-on' : '' ?>" href="<?= e('admin.php?status=' . eu($key)) ?>"><?= e($label) ?></a>
      <?php endforeach; ?>

      <form class="spacer" method="post" action="admin.php">
        <?= ewd_csrf_field() ?>
        <input type="hidden" name="action" value="logout" />
        <button class="btn btn-ghost btn-sm" type="submit">Sign out</button>
      </form>
    </div>

    <form class="filter-bar" method="get" action="admin.php">
      <input type="hidden" name="status" value="<?= e($status) ?>" />
      <div class="filter-row">
        <div class="search-field">
          <label class="hp-field" for="q">Search</label>
          <input type="search" id="q" name="q" value="<?= e((string)($_GET['q'] ?? '')) ?>"
                 placeholder="Search names, builders, classes…" />
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Search</button>
      </div>
      <?php if (!EWD_REQUIRE_APPROVAL): ?>
        <p class="hint" style="margin:14px 0 0;">
          Worlds appear in the gallery as soon as they are shared. To check them first, set
          <span class="inline-code">EWD_REQUIRE_APPROVAL</span> to
          <span class="inline-code">true</span> in <span class="inline-code">lib/config.local.php</span>.
        </p>
      <?php endif; ?>
    </form>

    <?php if (!$result['rows']): ?>
      <div class="empty">
        <span class="icon" aria-hidden="true">✅</span>
        <h3>Nothing here</h3>
        <p><?= $status === 'pending' ? 'No worlds are waiting to be checked.' : 'No worlds match.' ?></p>
      </div>
    <?php else: ?>
      <div class="world-grid">
        <?php foreach ($result['rows'] as $world): ?>
          <?php /* A plain cell, NOT another .world-card -- ewd_world_card() emits the
                   bordered card itself, and wrapping it in a second one draws a box
                   round a box. The actions sit under the card as their own strip. */ ?>
          <div class="admin-cell">
            <?php ewd_world_card($world, true); ?>
            <div class="admin-actions">
              <?php if ($world['status'] !== 'published'): ?>
                <form method="post" action="admin.php">
                  <?= ewd_csrf_field() ?>
                  <input type="hidden" name="action" value="publish" />
                  <input type="hidden" name="id" value="<?= (int)$world['id'] ?>" />
                  <input type="hidden" name="return_status" value="<?= e($status) ?>" />
                  <button class="btn btn-green btn-sm" type="submit">✓ Put in gallery</button>
                </form>
              <?php else: ?>
                <form method="post" action="admin.php">
                  <?= ewd_csrf_field() ?>
                  <input type="hidden" name="action" value="hide" />
                  <input type="hidden" name="id" value="<?= (int)$world['id'] ?>" />
                  <input type="hidden" name="return_status" value="<?= e($status) ?>" />
                  <button class="btn btn-ghost btn-sm" type="submit">Hide</button>
                </form>
              <?php endif; ?>

              <a class="btn btn-ghost btn-sm" href="<?= e('world.php?id=' . (int)$world['id']) ?>">Open</a>

              <form method="post" action="admin.php"
                    onsubmit="return confirm('Delete this world for good? The screenshot and world file go too.');">
                <?= ewd_csrf_field() ?>
                <input type="hidden" name="action" value="delete" />
                <input type="hidden" name="id" value="<?= (int)$world['id'] ?>" />
                <input type="hidden" name="return_status" value="<?= e($status) ?>" />
                <button class="btn btn-danger btn-sm" type="submit">Delete</button>
              </form>
            </div>
          </div>
        <?php endforeach; ?>
      </div>

      <?php if ($result['pages'] > 1): ?>
        <nav class="pager">
          <?php for ($n = 1; $n <= $result['pages']; $n++): ?>
            <?php if ($n === $result['page']): ?>
              <span class="is-current"><?= $n ?></span>
            <?php else: ?>
              <a href="<?= e(ewd_url_with(['page' => $n], 'admin.php')) ?>"><?= $n ?></a>
            <?php endif; ?>
          <?php endfor; ?>
        </nav>
      <?php endif; ?>
    <?php endif; ?>

  </div>
</main>

<?php ewd_footer(); ?>
