<?php
declare(strict_types=1);

/*
 * The numbers, for whoever runs the site. Behind the same password as the teacher tools.
 *
 * It is behind a password not because the data is sensitive -- it could not be, by
 * construction: see lib/stats.php -- but because an open dashboard is an invitation to
 * anyone who finds the URL, and traffic figures for a small project are nobody else's
 * business. The login is the existing admin one, reused rather than reinvented, so there
 * is one password on this deployment and not two.
 *
 * The six figures across the top are the six the marketing plan asks to be measured, in
 * the order it asks for them. Anything not on that list is deliberately absent -- a
 * dashboard that shows everything is one nobody reads.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';
require_once __DIR__ . '/lib/admin.php';
require_once __DIR__ . '/lib/stats.php';

$action = (string)($_POST['action'] ?? '');

if ($action === 'login') {
    if (!ewd_csrf_ok()) {
        ewd_flash('error', 'That form expired. Try again.');
    } elseif (ewd_admin_login((string)($_POST['password'] ?? ''))) {
        ewd_redirect('stats.php');
    } else {
        ewd_login_delay();
        ewd_flash('error', 'That password is not right.');
    }
    ewd_redirect('stats.php');
}

if (!ewd_is_admin()) {
    ewd_header(['title' => 'Traffic']);
    ?>
    <main class="section">
      <div class="wrap">
        <div class="panel login-panel">
          <h1 style="font-size:1.5rem;">Traffic</h1>
          <p class="hint">
            How many people opened the site, and which pages they opened. Same password as
            the teacher tools.
          </p>
          <form method="post" action="stats.php" style="margin-top:18px;">
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

// 7 / 30 / 90 rather than a free-text range: three buttons answer "is this week worse
// than last" and "is the 90-day plan working", which are the only two questions this
// page exists for.
$days = (int)($_GET['days'] ?? 30);
if (!in_array($days, [7, 30, 90], true)) {
    $days = 30;
}

$totals = ewd_stats_totals($days);
$daily  = ewd_stats_daily($days);
$pages  = ewd_stats_top_paths($days, 'page', 30);
$refs   = ewd_stats_referrers($days, 25);

// The activation rate the plan's second metric is defined as: of the sessions that
// reached the app, how many actually built something. Guarded against a zero
// denominator, which is what every fresh install has.
$built = $totals['app'] > 0 ? round($totals['built'] / $totals['app'] * 100) : 0;

// Referring DOMAINS, not referred visits -- the plan's target is "15 referring domains,
// including 2 .edu", so the count of distinct hosts is the number, not their traffic.
$eduRefs = 0;
foreach ($refs as $r) {
    if (str_ends_with((string)$r['referrer'], '.edu')) {
        $eduRefs++;
    }
}

ewd_header(['title' => 'Traffic']);
?>

<main class="section">
  <div class="wrap">

    <h1 style="font-size:clamp(1.7rem,3.6vw,2.4rem);margin-bottom:6px;">Traffic</h1>
    <p class="hint" style="max-width:70ch;">
      Counted on this server, with no cookies, no identifiers and no IP addresses — see
      <a href="<?= e(EWD_SITE_URL) ?>privacy.html">the privacy page</a> for exactly what is
      and is not stored. Visitors who send Do&nbsp;Not&nbsp;Track or Global Privacy Control
      are not counted at all, so every figure here is a floor rather than a total.
    </p>

    <p style="margin:18px 0 26px;">
      <?php foreach ([7, 30, 90] as $d): ?>
        <a class="chip<?= $d === $days ? ' is-on' : '' ?>" href="stats.php?days=<?= $d ?>">Last <?= $d ?> days</a>
      <?php endforeach; ?>
    </p>

    <div class="stat-row">
      <div class="stat-box"><span class="v"><?= number_format($totals['visit']) ?></span><span class="k">Visits</span></div>
      <div class="stat-box"><span class="v"><?= number_format($totals['page']) ?></span><span class="k">Page views</span></div>
      <div class="stat-box"><span class="v"><?= number_format($totals['app']) ?></span><span class="k">Sessions that reached the app</span></div>
      <div class="stat-box"><span class="v"><?= number_format($totals['built']) ?></span><span class="k">Sessions that built something</span></div>
      <div class="stat-box"><span class="v"><?= $built ?>%</span><span class="k">Of app sessions that built</span></div>
      <div class="stat-box"><span class="v"><?= count($refs) ?><?= $eduRefs ? ' <small>· ' . $eduRefs . ' .edu</small>' : '' ?></span><span class="k">Referring domains</span></div>
    </div>

    <div class="detail-grid" style="margin-top:34px;">
      <div>
        <h2>Pages</h2>
        <?php if (!$pages): ?>
          <p class="hint">Nothing counted yet. The counter starts the first time somebody opens a page after this went live.</p>
        <?php else: ?>
          <table class="stat-table">
            <thead><tr><th>Page</th><th>Views</th></tr></thead>
            <tbody>
              <?php foreach ($pages as $p): ?>
                <tr><td><?= e($p['path']) ?></td><td class="n"><?= number_format((int)$p['hits']) ?></td></tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        <?php endif; ?>

        <h2 style="margin-top:32px;">By day</h2>
        <?php if (!$daily): ?>
          <p class="hint">No days recorded yet.</p>
        <?php else: ?>
          <table class="stat-table">
            <thead><tr><th>Day</th><th>Visits</th><th>Pages</th><th>App</th><th>Built</th></tr></thead>
            <tbody>
              <?php foreach ($daily as $day => $k): ?>
                <tr>
                  <td><?= e($day) ?></td>
                  <td class="n"><?= number_format((int)($k['visit'] ?? 0)) ?></td>
                  <td class="n"><?= number_format((int)($k['page'] ?? 0)) ?></td>
                  <td class="n"><?= number_format((int)($k['app'] ?? 0)) ?></td>
                  <td class="n"><?= number_format((int)($k['built'] ?? 0)) ?></td>
                </tr>
              <?php endforeach; ?>
            </tbody>
          </table>
        <?php endif; ?>
      </div>

      <aside>
        <div class="side-card">
          <h3>Where they came from</h3>
          <?php if (!$refs): ?>
            <p class="hint" style="margin:0;">
              No referrals yet. Everything so far arrived directly — typed, bookmarked, or
              from a link in an app that strips the referrer, which most chat and email
              clients do.
            </p>
          <?php else: ?>
            <ul class="meta-list">
              <?php foreach ($refs as $r): ?>
                <li><span class="k"><?= e($r['referrer']) ?></span><span class="v"><?= number_format((int)$r['hits']) ?></span></li>
              <?php endforeach; ?>
            </ul>
          <?php endif; ?>
        </div>

        <div class="side-card">
          <h3>What these mean</h3>
          <ul class="meta-list">
            <li><span class="k">Visit</span><span class="v">One browser session</span></li>
            <li><span class="k">Page view</span><span class="v">One page opened</span></li>
            <li><span class="k">App</span><span class="v">Reached Edusim itself</span></li>
            <li><span class="k">Built</span><span class="v">Placed something in a world</span></li>
          </ul>
          <p class="hint" style="margin:12px 0 0;">
            A visit is counted once per browser session and never linked to another one.
            There is no way to tell from this data whether two visits were the same person,
            and that is deliberate.
          </p>
        </div>

        <div class="side-card">
          <h3>Teacher tools</h3>
          <p class="hint" style="margin:0;">
            <a href="admin.php">Approve, hide and remove shared worlds →</a>
          </p>
        </div>
      </aside>
    </div>

  </div>
</main>

<?php ewd_footer(); ?>
