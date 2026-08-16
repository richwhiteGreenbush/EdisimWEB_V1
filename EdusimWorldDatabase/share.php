<?php
declare(strict_types=1);

/*
 * The share form: screenshot + description + world JSON, which is the whole of what a
 * shared world is.
 *
 * Everything is validated server-side and nothing is written until ALL of it passes. The
 * two files are the expensive half, so they are checked last and, once written, are
 * cleaned up by hand if the database insert then fails -- otherwise a failed submission
 * leaves a screenshot and a 6MB world file on disk with no row pointing at them.
 *
 * On success the page does NOT render a result: it redirects to the world's own page
 * (Post/Redirect/Get). Rendering here would leave the browser holding a POST, and a
 * refresh or a back-then-forward would re-submit the whole thing and share the world
 * twice -- which is exactly what a student does when a big upload seems slow.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';
require_once __DIR__ . '/lib/worldfile.php';
require_once __DIR__ . '/lib/screenshot.php';

$errors = [];
$values = [
    'title'       => '',
    'creator'     => '',
    'group_name'  => '',
    'description' => '',
    'tags'        => '',
];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' || ewd_post_exceeded_limit()) {
    // A POST bigger than post_max_size arrives with $_POST and $_FILES both empty and no
    // error flag anywhere, so this has to be checked before anything reads a field --
    // otherwise the page answers "you didn't choose a world file", which sends the
    // student off to fix something that was never wrong.
    if (ewd_post_exceeded_limit()) {
        $errors['form'] = 'That upload was larger than this server accepts in one go ('
            . ewd_bytes(ewd_php_upload_limit()) . ' including the screenshot). '
            . 'Try a smaller screenshot, or ask whoever set this up to raise post_max_size.';
    } elseif (!ewd_csrf_ok()) {
        // Almost always a session that expired while a long form sat open, not an attack.
        $errors['form'] = 'That form had been sitting open too long and the security check '
            . 'expired. Nothing was lost — press Share again.';
        // Typed text is put back so nobody has to write their description twice. The two
        // FILE inputs cannot be repopulated -- no browser allows it -- which is the other
        // half of why this message says what happened rather than just failing.
        foreach (array_keys($values) as $key) {
            $values[$key] = trim((string)($_POST[$key] ?? ''));
        }
    } else {
        foreach (array_keys($values) as $key) {
            $values[$key] = trim((string)($_POST[$key] ?? ''));
        }

        // The honeypot: a field no human can see and no human therefore fills in. Bots
        // fill every input they find. Real submissions leave it empty.
        if (trim((string)($_POST['website'] ?? '')) !== '') {
            $errors['form'] = 'That submission looked automated and was not saved.';
        }

        if (!isset($errors['form']) && !ewd_rate_limit_ok(ewd_ip_hash())) {
            $errors['form'] = 'A lot of worlds have been shared from this connection in the '
                . 'last hour. Wait a little while and try again.';
        }

        // ---- text fields -------------------------------------------------
        if ($values['title'] === '') {
            $errors['title'] = 'Give your world a name.';
        } elseif (mb_strlen($values['title']) > EWD_MAX_TITLE) {
            $errors['title'] = 'That name is too long — keep it under ' . EWD_MAX_TITLE . ' characters.';
        }

        if ($values['creator'] === '') {
            $errors['creator'] = 'Put the name you want shown as the builder.';
        } elseif (mb_strlen($values['creator']) > EWD_MAX_CREATOR) {
            $errors['creator'] = 'That is too long for a name — under ' . EWD_MAX_CREATOR . ' characters, please.';
        }

        if (mb_strlen($values['group_name']) > EWD_MAX_GROUP) {
            $errors['group_name'] = 'Keep the class or school under ' . EWD_MAX_GROUP . ' characters.';
        }

        $descLength = mb_strlen($values['description']);
        if ($descLength === 0) {
            $errors['description'] = 'Say something about your world — it is the part people read first.';
        } elseif ($descLength < EWD_MIN_DESCRIPTION) {
            $errors['description'] = 'Tell us a bit more — at least ' . EWD_MIN_DESCRIPTION . ' characters.';
        } elseif ($descLength > EWD_MAX_DESCRIPTION) {
            $errors['description'] = 'That description is ' . number_format($descLength)
                . ' characters. The limit is ' . number_format(EWD_MAX_DESCRIPTION) . '.';
        }

        $tags = ewd_parse_tags($values['tags']);

        // ---- the world file ----------------------------------------------
        $worldRaw = null;
        $worldInfo = null;
        $worldUpload = $_FILES['world'] ?? null;

        if (!is_array($worldUpload) || ($worldUpload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            $errors['world'] = 'Choose the world file you saved out of Edusim.';
        } elseif (($worldUpload['error'] ?? 0) !== UPLOAD_ERR_OK) {
            $errors['world'] = ewd_upload_error_message((int)$worldUpload['error']);
        } elseif (!is_uploaded_file((string)$worldUpload['tmp_name'])) {
            $errors['world'] = 'That upload did not arrive properly. Try again.';
        } elseif ((int)$worldUpload['size'] > EWD_MAX_WORLD_BYTES) {
            $errors['world'] = 'That world file is ' . ewd_bytes((int)$worldUpload['size'])
                . ' — the limit here is ' . ewd_bytes(EWD_MAX_WORLD_BYTES) . '.';
        } else {
            $worldRaw = file_get_contents((string)$worldUpload['tmp_name']);
            if ($worldRaw === false) {
                $errors['world'] = 'That world file could not be read. Try uploading it again.';
            } else {
                $worldInfo = ewd_inspect_world_json($worldRaw);
                if (!$worldInfo['ok']) {
                    $errors['world'] = $worldInfo['error'];
                } else {
                    $existing = ewd_find_world_by_hash(hash('sha256', $worldRaw));
                    if ($existing) {
                        // Byte-identical to something already here. Almost always a double
                        // submit, and the useful answer is a link to the one that exists.
                        $errors['world'] = 'That exact world has already been shared, as “'
                            . $existing['title'] . '”. If you have changed it since, save it '
                            . 'out of Edusim again and upload the new file.';
                    }
                }
            }
        }

        // ---- the screenshot ----------------------------------------------
        $shotUpload = $_FILES['screenshot'] ?? null;
        if (!is_array($shotUpload) || ($shotUpload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            $errors['screenshot'] = 'Add a screenshot so people can see what they are downloading.';
        }

        // ---- write, only once everything above passed ---------------------
        if (!$errors) {
            $slug = ewd_unique_slug(ewd_slugify($values['title']));

            $shot = ewd_store_screenshot($shotUpload, $slug);
            if (!$shot['ok']) {
                $errors['screenshot'] = $shot['error'];
            } else {
                $stored = null;
                try {
                    $stored = ewd_store_world_file((string)$worldRaw, $slug);

                    // Shown once, on the next page, and stored only as a hash: it is what
                    // lets the sharer delete their own world later without an account.
                    $manageKey = strtoupper(bin2hex(random_bytes(5)));
                    $now = ewd_now();

                    $id = ewd_insert_world([
                        'slug'              => $slug,
                        'title'             => $values['title'],
                        'creator'           => $values['creator'],
                        'group_name'        => $values['group_name'],
                        'description'       => $values['description'],
                        'theme'             => $worldInfo['theme'],
                        'record_count'      => $worldInfo['objects'],
                        'kinds_json'        => json_encode($worldInfo['kinds'], JSON_THROW_ON_ERROR),
                        'world_path'        => $stored['path'],
                        'world_bytes'       => $stored['bytes'],
                        'world_sha256'      => $stored['sha256'],
                        'shot_path'         => $shot['path'],
                        'shot_thumb_path'   => $shot['thumb'],
                        'shot_width'        => $shot['width'],
                        'shot_height'       => $shot['height'],
                        'status'            => EWD_REQUIRE_APPROVAL ? 'pending' : 'published',
                        'manage_key_hash'   => password_hash($manageKey, PASSWORD_DEFAULT),
                        'submitter_ip_hash' => ewd_ip_hash(),
                        'created_at'        => $now,
                        'updated_at'        => $now,
                    ], $tags);

                    ewd_log_submission(ewd_ip_hash());

                    ewd_flash('success', EWD_REQUIRE_APPROVAL
                        ? 'Thank you — your world has been sent to your teacher to be checked.'
                        : 'Your world is shared. Anyone can download it now.');

                    // The key rides in the URL because this redirect is the ONE moment it
                    // can be shown: it exists nowhere else, by design.
                    ewd_redirect('world.php?id=' . $id . '&key=' . eu($manageKey) . '&shared=1');
                } catch (Throwable $e) {
                    // Both files are already on disk at this point. Nothing points at them
                    // any more, so they are removed here rather than left as litter.
                    foreach ([
                        $stored ? EWD_WORLD_DIR . '/' . $stored['path'] : null,
                        EWD_SHOT_DIR . '/' . $shot['path'],
                        $shot['thumb'] !== '' ? EWD_SHOT_DIR . '/' . $shot['thumb'] : null,
                    ] as $orphan) {
                        if ($orphan !== null && is_file($orphan)) {
                            @unlink($orphan);
                        }
                    }
                    error_log('[EdusimWorldDatabase] share failed: ' . $e->getMessage());
                    $errors['form'] = 'Something went wrong saving your world. Nothing was kept — please try again.';
                }
            }
        }
    }
}

$uploadLimit = ewd_php_upload_limit();

ewd_header([
    'title'  => 'Share your world',
    'active' => 'share',
    'description' => 'Upload a world you built in Edusim: Web Edition — a screenshot, a description and the world file.',
]);

ewd_hero(
    '📤 Share it',
    'Put your world in the database',
    'Three things go with every world: a <strong>screenshot</strong> so people can see it, '
    . 'a <strong>description</strong> of what you built and why, and the '
    . '<strong>world file</strong> itself — the <span class="inline-code">.json</span> that '
    . 'Edusim saves when you choose Load World ▸ Save World.'
);
?>

<main class="section">
  <div class="wrap">

    <div class="panel" style="margin-bottom:28px;">
      <h2 style="margin-bottom:18px;">Getting your world out of Edusim</h2>
      <ol class="steps">
        <li>
          <h4>Take a screenshot</h4>
          <p>Stand somewhere that shows off your world, then press <span class="inline-code">PrtScn</span>
             (Windows), <span class="inline-code">⌘ ⇧ 4</span> (Mac) or the screenshot button on a tablet.</p>
        </li>
        <li>
          <h4>Save the world file</h4>
          <p>In Edusim, open <strong>Menu ▸ Load World ▸ Save World</strong>. A file called
             <span class="inline-code">edusim-world-….json</span> lands in your Downloads folder.</p>
        </li>
        <li>
          <h4>Fill this in and share</h4>
          <p>Add both files below with a name and a description. Your world appears in the
             gallery for anyone to download and open.</p>
        </li>
      </ol>
    </div>

    <?php if (isset($errors['form'])): ?>
      <div class="flash flash-error" style="margin-bottom:22px;"><?= e($errors['form']) ?></div>
    <?php endif; ?>

    <form class="panel" method="post" action="share.php" enctype="multipart/form-data" novalidate>
      <?= ewd_csrf_field() ?>

      <?php /* The honeypot. Real people never see it; bots fill everything. */ ?>
      <div class="hp-field" aria-hidden="true">
        <label for="website">Leave this empty</label>
        <input type="text" id="website" name="website" tabindex="-1" autocomplete="off" />
      </div>

      <div class="form-grid two">
        <div class="field<?= isset($errors['title']) ? ' has-error' : '' ?>">
          <label for="title">World name <span class="req" aria-hidden="true">*</span></label>
          <input type="text" id="title" name="title" required maxlength="<?= EWD_MAX_TITLE ?>"
                 value="<?= e($values['title']) ?>" placeholder="The City in the Clouds" />
          <p class="hint">What you would call it if you were showing someone round.</p>
          <?php if (isset($errors['title'])): ?><p class="field-error"><?= e($errors['title']) ?></p><?php endif; ?>
        </div>

        <div class="field<?= isset($errors['creator']) ? ' has-error' : '' ?>">
          <label for="creator">Built by <span class="req" aria-hidden="true">*</span></label>
          <input type="text" id="creator" name="creator" required maxlength="<?= EWD_MAX_CREATOR ?>"
                 value="<?= e($values['creator']) ?>" placeholder="Maya" />
          <p class="hint">
            A first name or a nickname. <strong>Do not put your full name, your email or
            anything else private</strong> — this page is public.
          </p>
          <?php if (isset($errors['creator'])): ?><p class="field-error"><?= e($errors['creator']) ?></p><?php endif; ?>
        </div>
      </div>

      <div class="form-grid two" style="margin-top:22px;">
        <div class="field<?= isset($errors['group_name']) ? ' has-error' : '' ?>">
          <label for="group_name">Class, club or school <span class="hint" style="display:inline;">(optional)</span></label>
          <input type="text" id="group_name" name="group_name" maxlength="<?= EWD_MAX_GROUP ?>"
                 value="<?= e($values['group_name']) ?>" placeholder="Room 12" />
          <p class="hint">Handy when a whole class shares at once — it groups your worlds together.</p>
          <?php if (isset($errors['group_name'])): ?><p class="field-error"><?= e($errors['group_name']) ?></p><?php endif; ?>
        </div>

        <div class="field">
          <label for="tags">Tags <span class="hint" style="display:inline;">(optional)</span></label>
          <input type="text" id="tags" name="tags" value="<?= e($values['tags']) ?>"
                 placeholder="space, robots, maze" />
          <p class="hint">Up to <?= EWD_MAX_TAGS ?>, separated by commas. They become the filter buttons on the gallery.</p>
        </div>
      </div>

      <div class="field<?= isset($errors['description']) ? ' has-error' : '' ?>" style="margin-top:22px;">
        <label for="description">What did you build? <span class="req" aria-hidden="true">*</span></label>
        <textarea id="description" name="description" required
                  maxlength="<?= EWD_MAX_DESCRIPTION ?>"
                  placeholder="I built a space station over the Moon. The big dish turns all the way round — I programmed it with a forever loop and a rotate block. Walk behind the launch pad to find the rover."><?= e($values['description']) ?></textarea>
        <p class="hint">
          The part people actually read. Say what is in it, what to go and look at, and
          anything you programmed. A few sentences is plenty.
        </p>
        <?php if (isset($errors['description'])): ?><p class="field-error"><?= e($errors['description']) ?></p><?php endif; ?>
      </div>

      <div class="form-grid two" style="margin-top:26px;">
        <div class="field<?= isset($errors['screenshot']) ? ' has-error' : '' ?>">
          <span class="field-label">Screenshot <span class="req" aria-hidden="true">*</span></span>
          <div class="file-drop">
            <span class="file-icon" aria-hidden="true">🖼️</span>
            <input type="file" id="screenshot" name="screenshot" required
                   accept="image/png,image/jpeg,image/webp,image/gif" />
            <p class="file-meta">
              JPEG, PNG, WebP or GIF · up to <?= e(ewd_bytes(EWD_MAX_SHOT_BYTES)) ?> ·
              at least 200×150. It is resized and re-saved automatically.
            </p>
          </div>
          <?php if (isset($errors['screenshot'])): ?><p class="field-error"><?= e($errors['screenshot']) ?></p><?php endif; ?>
        </div>

        <div class="field<?= isset($errors['world']) ? ' has-error' : '' ?>">
          <span class="field-label">World file <span class="req" aria-hidden="true">*</span></span>
          <div class="file-drop">
            <span class="file-icon" aria-hidden="true">🌍</span>
            <input type="file" id="world" name="world" required accept=".json,application/json" />
            <p class="file-meta">
              The <span class="inline-code">.json</span> from Load World ▸ Save World ·
              up to <?= e(ewd_bytes($uploadLimit)) ?>.
            </p>
          </div>
          <?php if (isset($errors['world'])): ?><p class="field-error"><?= e($errors['world']) ?></p><?php endif; ?>
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">📤 Share my world</button>
        <a class="btn btn-ghost" href="index.php">Cancel</a>
        <p class="hint" style="flex:1 1 260px;min-width:0;margin:0;">
          <?php if (EWD_REQUIRE_APPROVAL): ?>
            Your world goes to your teacher to be checked before it appears in the gallery.
          <?php else: ?>
            Your world appears in the gallery straight away. You will get a key on the next
            page that lets you delete it again.
          <?php endif; ?>
        </p>
      </div>
    </form>

  </div>
</main>

<?php ewd_footer(); ?>
