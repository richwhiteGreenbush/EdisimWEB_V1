<?php
declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/*
 * The page chrome, shared by every page.
 *
 * This is the marketing site's own furniture rebuilt in PHP: the same sticky cream nav
 * with the logo-crop chip, the same Fredoka/Nunito pairing, the same sky-over-field hero
 * gradient, the same near-black footer. assets/database.css imports docs/styles.css's
 * token block verbatim -- see the note at the top of that file for what is fixed and what
 * is free to change.
 *
 * The nav is a CSS-only checkbox panel, exactly as on the marketing site, so this app
 * ships no framework and no navigation JavaScript.
 */

function ewd_header(array $opts = []): void
{
    $title    = (string)($opts['title'] ?? 'World Database');
    $desc     = (string)($opts['description'] ?? 'Worlds built in Edusim: Web Edition, shared by the people who made them.');
    $active   = (string)($opts['active'] ?? '');
    $bodyClass = (string)($opts['bodyClass'] ?? '');

    // Open Graph / Twitter Card. `canonical` and `image` are absolute urls built from
    // EWD_CANONICAL_ORIGIN -- a relative one is useless here, because the machine reading
    // these tags is Facebook's or Slack's crawler and it has no idea what page it came
    // from. Without them a shared link unfurls as a bare url with no picture and no words,
    // which is most of the reason a link never gets clicked.
    $canonical = (string)($opts['canonical'] ?? '');
    $image     = (string)($opts['image'] ?? '');
    $imageAlt  = (string)($opts['imageAlt'] ?? '');
    $ogType    = (string)($opts['ogType'] ?? 'website');

    // Every page lives in the same directory, so `assets/…` works everywhere and there is
    // no base-path setting that can be wrong.
    header('Content-Type: text/html; charset=utf-8');

    // A shared world's screenshot and description are user content rendered on this page.
    // These three headers are the cheap half of defence in depth behind the escaping:
    // nosniff stops a stored file being re-interpreted as script, and the frame/referrer
    // rules keep the app out of someone else's page.
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    header('Referrer-Policy: strict-origin-when-cross-origin');

    $flashes = ewd_take_flashes();
    ?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title><?= e($title) ?> — Edusim World Database</title>
<meta name="description" content="<?= e($desc) ?>" />
<?php if ($canonical !== ''): ?>
<link rel="canonical" href="<?= e($canonical) ?>" />
<?php endif; ?>
<meta property="og:site_name" content="Edusim World Database" />
<meta property="og:type" content="<?= e($ogType) ?>" />
<meta property="og:title" content="<?= e($title) ?>" />
<meta property="og:description" content="<?= e($desc) ?>" />
<?php if ($canonical !== ''): ?>
<meta property="og:url" content="<?= e($canonical) ?>" />
<?php endif; ?>
<?php if ($image !== ''): ?>
<meta property="og:image" content="<?= e($image) ?>" />
<meta property="og:image:alt" content="<?= e($imageAlt !== '' ? $imageAlt : $title) ?>" />
<meta name="twitter:card" content="summary_large_image" />
<?php else: ?>
<meta name="twitter:card" content="summary" />
<?php endif; ?>
<meta name="twitter:title" content="<?= e($title) ?>" />
<meta name="twitter:description" content="<?= e($desc) ?>" />
<?php if ($image !== ''): ?>
<meta name="twitter:image" content="<?= e($image) ?>" />
<?php endif; ?>
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="assets/edusim-mark.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="assets/database.css" />
</head>
<body<?= $bodyClass !== '' ? ' class="' . e($bodyClass) . '"' : '' ?>>

<nav class="site-nav">
  <div class="wrap">
    <!-- The mark is a square crop of the logo's own E, same as the marketing site: at
         40px the whole wordmark is an unreadable blue smudge. alt="" because the word
         Edusim is written right beside it. -->
    <a class="brand" href="index.php">
      <img class="brand-mark" src="assets/edusim-mark.png" alt="" width="40" height="40" />
      <span>Edusim
        <small>World Database</small>
      </span>
    </a>

    <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-label="Show or hide the menu" />
    <ul class="nav-links">
      <li><a<?= $active === 'browse' ? ' class="is-active"' : '' ?> href="index.php">Browse worlds</a></li>
      <li><a<?= $active === 'share' ? ' class="is-active"' : '' ?> href="share.php">Share your world</a></li>
      <li><a href="<?= e(EWD_GUIDE_URL) ?>" target="_blank" rel="noopener noreferrer">Hands-On Guide</a></li>
      <li><a href="<?= e(EWD_SITE_URL) ?>" target="_blank" rel="noopener noreferrer">Main site</a></li>
    </ul>
    <?php /* Same button and same label as the marketing site's nav -- one bar, one name
             for the thing it opens. "Edusim" is a span so the narrow-band rule in
             database.css can drop it; this nav carries four links to the marketing
             page's six, so it has more room, but the two stay in step deliberately. */ ?>
    <a class="btn btn-primary nav-cta" href="<?= e(EWD_APP_URL) ?>" target="_blank" rel="noopener noreferrer"><span class="nav-cta-label">▶ Launch<span class="nav-cta-word"> Edusim</span></span></a>
    <label class="nav-burger" for="nav-toggle"><span class="burger-box" aria-hidden="true"></span>Menu</label>
  </div>
</nav>

<?php if ($flashes): ?>
<div class="flash-host" role="status">
  <div class="wrap">
    <?php foreach ($flashes as $flash): ?>
      <div class="flash flash-<?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
    <?php endforeach; ?>
  </div>
</div>
<?php endif; ?>
<?php
}

/**
 * The hero band. Its gradient is the logo's own sky over the logo's own field, which is
 * why the marketing site's hero and this one look like the same place.
 */
function ewd_hero(string $eyebrow, string $heading, string $lead, string $ctaHtml = ''): void
{
    ?>
<header class="hero">
  <div class="wrap">
    <span class="eyebrow hero-eyebrow"><?= e($eyebrow) ?></span>
    <h1><?= e($heading) ?></h1>
    <?php if ($lead !== ''): ?><p class="hero-sub"><?= $lead ?></p><?php endif; ?>
    <?php if ($ctaHtml !== ''): ?><div class="hero-cta-row"><?= $ctaHtml ?></div><?php endif; ?>
  </div>
</header>
<?php
}

function ewd_footer(): void
{
    ?>
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-row">
      <div class="footer-brand">
        <img class="brand-mark" src="assets/edusim-mark.png" alt="" width="32" height="32"
             style="width:32px;height:32px;" loading="lazy" />
        Edusim: Web Edition
      </div>
      <ul class="footer-links">
        <li><a href="index.php">Browse worlds</a></li>
        <li><a href="share.php">Share your world</a></li>
        <li><a href="<?= e(EWD_APP_URL) ?>" target="_blank" rel="noopener noreferrer">Open Edusim</a></li>
        <li><a href="<?= e(EWD_GUIDE_URL) ?>" target="_blank" rel="noopener noreferrer">Hands-On Guide</a></li>
        <li><a href="<?= e(EWD_SITE_URL) ?>" target="_blank" rel="noopener noreferrer">Main site</a></li>
        <li><a href="admin.php">Teacher tools</a></li>
      </ul>
    </div>
    <p class="footer-fine">
      Worlds here were built by the people who shared them. Download one, open it with
      <strong>Load World ▸ Load World File</strong>, and it is yours to change.
    </p>
  </div>
</footer>

<script>
  /* Polish only, exactly as on the marketing site: the menu itself is a CSS checkbox and
     opens and closes with no JavaScript at all. This closes it again after a link is
     chosen, and on Escape. */
  (function () {
    var toggle = document.getElementById('nav-toggle');
    if (!toggle) return;
    document.querySelectorAll('.nav-links a').forEach(function (link) {
      link.addEventListener('click', function () { toggle.checked = false; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') toggle.checked = false;
    });
  })();
</script>
</body>
</html>
<?php
}

/**
 * One gallery card. Shared by the gallery and the admin queue so the two can never drift
 * into showing different things about the same world.
 */
function ewd_world_card(array $w, bool $admin = false): void
{
    $shot = $w['shot_thumb_path'] !== '' ? $w['shot_thumb_path'] : $w['shot_path'];
    $href = 'world.php?id=' . (int)$w['id'];
    $theme = (string)$w['theme'];
    ?>
<article class="world-card">
  <a class="world-shot" href="<?= e($href) ?>">
    <img src="<?= e(EWD_SHOT_URL . '/' . $shot) ?>" loading="lazy"
         alt="A screenshot of the world “<?= e($w['title']) ?>”, built by <?= e($w['creator']) ?>." />
    <span class="world-pin" title="<?= e(ewd_theme_label($theme)) ?>"><?= ewd_theme_emoji($theme) ?></span>
    <?php if ($admin && $w['status'] !== 'published'): ?>
      <span class="status-flag status-<?= e($w['status']) ?>"><?= e($w['status']) ?></span>
    <?php endif; ?>
  </a>
  <div class="world-body">
    <span class="world-kicker"><?= e(ewd_theme_label($theme)) ?></span>
    <h3><a href="<?= e($href) ?>"><?= e($w['title']) ?></a></h3>
    <p class="world-by">
      by <strong><?= e($w['creator']) ?></strong><?php
        if ($w['group_name'] !== '') { echo ' · ' . e($w['group_name']); }
      ?> · <?= e(ewd_when($w['created_at'])) ?>
    </p>
    <p class="world-desc"><?= e(ewd_truncate($w['description'], 130)) ?></p>
    <ul class="world-chips">
      <li><?= e(ewd_plural((int)$w['record_count'], 'object', 'objects')) ?></li>
      <li><?= e(ewd_bytes((int)$w['world_bytes'])) ?></li>
      <li>⬇ <?= (int)$w['downloads'] ?></li>
    </ul>
  </div>
</article>
<?php
}
