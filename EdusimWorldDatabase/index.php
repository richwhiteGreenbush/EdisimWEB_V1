<?php
declare(strict_types=1);

/*
 * The gallery: every shared world, newest first, with search, theme and tag filters.
 *
 * Every filter is a plain GET link built by ewd_url_with(), which rewrites the CURRENT
 * query string rather than a fresh one -- so filters compose (a tag AND a theme AND a
 * search), the browser back button works, and any view a teacher is looking at can be
 * copied out of the address bar and sent to a class.
 */

require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/layout.php';

$search = trim((string)($_GET['q'] ?? ''));
$tag    = trim((string)($_GET['tag'] ?? ''));
$theme  = trim((string)($_GET['theme'] ?? ''));
$sort   = (string)($_GET['sort'] ?? 'new');
$page   = max(1, (int)($_GET['page'] ?? 1));

if (!in_array($sort, ['new', 'oldest', 'downloads', 'title'], true)) {
    $sort = 'new';
}

$result = ewd_list_worlds([
    'status' => 'published',
    'search' => $search,
    'tag'    => $tag,
    'theme'  => $theme,
    'sort'   => $sort,
    'page'   => $page,
]);

$counts     = ewd_count_by_status();
// Top 10 only. ewd_popular_tags() already orders by use, so this is the ten a
// visitor is most likely to want; the long tail was noise on a filter bar.
$tags       = ewd_popular_tags(10);
$filtering  = $search !== '' || $tag !== '' || $theme !== '';

ewd_header([
    'title'  => 'Browse worlds',
    'active' => 'browse',
    'description' => 'A gallery of worlds built in Edusim: Web Edition — download one, open it in the app, and make it your own.',
]);

ewd_hero(
    '🌍 Shared worlds',
    'Worlds other people built',
    'Every world here was made in Edusim and shared by whoever built it. Look round the '
    . 'screenshots, read what they were going for, then <strong>download the world file '
    . 'and open it in Edusim</strong> — it lands in your copy exactly as they left it, and '
    . 'everything in it can be moved, resized, programmed and rebuilt.',
    '<a class="btn btn-primary" href="share.php">Share a world of your own</a>'
    . '<a class="btn btn-ghost" href="' . e(EWD_APP_URL) . '" target="_blank" rel="noopener noreferrer">Open Edusim</a>'
);
?>

<main class="section">
  <div class="wrap">

    <form class="filter-bar" method="get" action="index.php">
      <div class="filter-row">
        <div class="search-field">
          <label class="hp-field" for="q">Search worlds</label>
          <input type="search" id="q" name="q" value="<?= e($search) ?>"
                 placeholder="Search by name, builder, class or description…" />
        </div>

        <?php /* The sort control keeps the other filters alive across a submit, which a
                 GET form does not do on its own -- an unlisted field is simply dropped. */ ?>
        <?php if ($tag !== ''): ?><input type="hidden" name="tag" value="<?= e($tag) ?>" /><?php endif; ?>
        <?php if ($theme !== ''): ?><input type="hidden" name="theme" value="<?= e($theme) ?>" /><?php endif; ?>

        <label class="hp-field" for="sort">Sort by</label>
        <select id="sort" name="sort" style="width:auto;">
          <option value="new"       <?= $sort === 'new' ? 'selected' : '' ?>>Newest first</option>
          <option value="downloads" <?= $sort === 'downloads' ? 'selected' : '' ?>>Most downloaded</option>
          <option value="title"     <?= $sort === 'title' ? 'selected' : '' ?>>By name (A–Z)</option>
          <option value="oldest"    <?= $sort === 'oldest' ? 'selected' : '' ?>>Oldest first</option>
        </select>

        <button class="btn btn-primary btn-sm" type="submit">Search</button>
        <?php if ($filtering): ?>
          <a class="chip" href="index.php">✕ Clear filters</a>
        <?php endif; ?>
      </div>

      <?php /* The "Where" (theme) pill row is deliberately gone. With seventeen worlds in
               the app there is a theme for nearly every one of them, so the row had grown
               to a wall of chips that pushed the actual results below the fold and read as
               a second, competing navigation. Tags do the same job better, because a
               world can carry several of them and they are chosen for what a person would
               search for.

               ?theme=... IS STILL HONOURED by the query above -- only the pills are gone.
               Existing links and bookmarks carrying a theme keep working, and the filter
               still composes with a tag and a search. */ ?>

      <?php if ($tags): ?>
      <div class="chip-row">
        <span class="chip is-on" style="background:none;border-color:transparent;color:var(--ink-soft);">Tags:</span>
        <?php foreach ($tags as $t): ?>
          <?php $on = $tag === $t['name']; ?>
          <a class="chip<?= $on ? ' is-on' : '' ?>"
             href="<?= e(ewd_url_with(['tag' => $on ? null : $t['name'], 'page' => null])) ?>">
            #<?= e($t['name']) ?> <b><?= (int)$t['c'] ?></b>
          </a>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
    </form>

    <p class="filter-count">
      <?php if ($result['total'] === 0): ?>
        No worlds match that.
      <?php else: ?>
        Showing <?= e(ewd_plural($result['total'], 'world', 'worlds')) ?><?php
          if ($filtering) { echo $result['total'] === 1 ? ' that matches' : ' that match'; }
          if ($result['pages'] > 1) { echo ' — page ' . $result['page'] . ' of ' . $result['pages']; }
        ?>.
      <?php endif; ?>
    </p>

    <?php if ($result['rows']): ?>
      <div class="world-grid">
        <?php foreach ($result['rows'] as $world): ?>
          <?php ewd_world_card($world); ?>
        <?php endforeach; ?>
      </div>

      <?php if ($result['pages'] > 1): ?>
        <nav class="pager" aria-label="Pages of worlds">
          <?php
          $current = $result['page'];
          $last = $result['pages'];
          if ($current > 1) {
              echo '<a href="' . e(ewd_url_with(['page' => $current - 1])) . '">← Back</a>';
          }
          // A window around the current page plus the two ends, so a gallery of a hundred
          // pages is still one row of links rather than a hundred.
          $shown = [];
          foreach (range(1, $last) as $n) {
              if ($n === 1 || $n === $last || abs($n - $current) <= 2) {
                  $shown[] = $n;
              }
          }
          $prev = 0;
          foreach ($shown as $n) {
              if ($prev && $n - $prev > 1) {
                  echo '<span class="gap">…</span>';
              }
              if ($n === $current) {
                  echo '<span class="is-current">' . $n . '</span>';
              } else {
                  echo '<a href="' . e(ewd_url_with(['page' => $n])) . '">' . $n . '</a>';
              }
              $prev = $n;
          }
          if ($current < $last) {
              echo '<a href="' . e(ewd_url_with(['page' => $current + 1])) . '">Next →</a>';
          }
          ?>
        </nav>
      <?php endif; ?>

    <?php else: ?>
      <div class="empty">
        <span class="icon" aria-hidden="true"><?= $filtering ? '🔍' : '🌱' ?></span>
        <?php if ($filtering): ?>
          <h3>Nothing matches that yet</h3>
          <p>Try a different word, or clear the filters to see everything that has been shared.</p>
          <a class="btn btn-primary" href="index.php">Show every world</a>
        <?php else: ?>
          <h3>No worlds have been shared yet</h3>
          <p>
            This is where worlds built in Edusim end up. Build something, save it with
            <strong>Load World ▸ Save World</strong>, and be the first one here.
          </p>
          <div class="hero-cta-row on-paper">
            <a class="btn btn-primary" href="share.php">Share the first world</a>
            <a class="btn btn-ghost" href="<?= e(EWD_APP_URL) ?>" target="_blank" rel="noopener noreferrer">Open Edusim</a>
          </div>
        <?php endif; ?>
      </div>
    <?php endif; ?>

    <?php if ($counts['pending'] > 0 && EWD_REQUIRE_APPROVAL): ?>
      <p class="filter-count" style="margin-top:26px;">
        <?= e(ewd_plural($counts['pending'], 'world is', 'worlds are')) ?> waiting to be checked by a teacher.
      </p>
    <?php endif; ?>

  </div>
</main>

<?php ewd_footer(); ?>
