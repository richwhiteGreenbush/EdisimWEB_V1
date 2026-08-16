#!/usr/bin/env bash
#
# Smoke test everything this project deploys, against the local Apache + PHP-FPM stack
# that serve-local.sh runs (start it first).
#
# It checks the things a browser actually does -- fetch a page, fetch the images on it,
# download a world -- and, just as importantly, the things a browser must NOT be able to
# do. The access rules live in .htaccess, so they only exist under Apache; none of this
# is testable under `php -S`, which is how a broken uploads/.htaccess reached production
# and made every gallery screenshot a 500.
#
#   ./smoke-test.sh
#
set -uo pipefail

# `--prod` points at the two real deployments. They are different hosts -- the site is on
# pair Networks and the app is on Railway -- so aiming both at one origin silently tests
# the wrong thing (the marketing page answers `/` with a 200 that means nothing about the
# app being there).
if [ "${1:-}" = "--prod" ]; then
  SITE="http://edusim3d.me"
  APP="https://edisimwebv1-production.up.railway.app"
  TIMEOUT="${TIMEOUT:-30}"
fi

SITE="${SITE:-http://localhost:8080}"
APP="${APP:-http://localhost:8081}"
# Generous by default: local is instant, but pair over the open internet is not, and a
# timeout reads as a failing check rather than a slow one.
TIMEOUT="${TIMEOUT:-30}"

printf 'site %s\napp  %s\n' "$SITE" "$APP"

pass=0; fail=0
code() { curl -s -o /dev/null -w '%{http_code}' --max-time "$TIMEOUT" "$1"; }

# check <description> <url> <expected...>   -- any one of the expected codes passes
check() {
  local desc="$1" url="$2"; shift 2
  local got; got="$(code "$url")"
  for want in "$@"; do
    if [ "$got" = "$want" ]; then
      printf '  \033[32mok\033[0m   %-46s %s\n' "$desc" "$got"; pass=$((pass+1)); return
    fi
  done
  printf '  \033[31mFAIL\033[0m %-46s got %s, wanted %s\n' "$desc" "$got" "$*"; fail=$((fail+1))
}

section() { printf '\n\033[1;36m%s\033[0m\n' "$1"; }

section "Marketing site"
check "home page"            "$SITE/"                    200
check "stylesheet"           "$SITE/styles.css"          200
check "hands-on guide"       "$SITE/guide/"              200
check "logo wordmark"        "$SITE/assets/edusim-wordmark.jpg" 200
# The hero's third button. It is a RELATIVE href, so this also proves the gallery is
# mounted where the marketing page thinks it is -- the one thing a broken deploy layout
# would silently get wrong.
# Fetch first, then grep. `curl | grep -q` is wrong under `set -o pipefail`: grep exits on
# the first match, SIGPIPEs curl, and the pipeline reports curl's 141 -- so the check fails
# precisely BECAUSE the string was found.
home_html="$(curl -s --max-time "$TIMEOUT" "$SITE/")"
if printf '%s' "$home_html" | grep -q 'href="worlds/"'; then
  printf '  \033[32mok\033[0m   %-46s links to worlds/\n' "hero gallery button"; pass=$((pass+1))
else
  printf '  \033[31mFAIL\033[0m %-46s no href="worlds/" in the page\n' "hero gallery button"; fail=$((fail+1))
fi

section "World gallery"
check "gallery"              "$SITE/worlds/"             200
# The gallery must not send visitors off to the old GitHub Pages copy. Everything on this
# host is relative; the only absolute link left is the app, which really is on Railway.
gal_html="$(curl -s --max-time "$TIMEOUT" "$SITE/worlds/")"
stray="$(printf '%s' "$gal_html" | grep -oE 'href="https?://[^"]+"' | grep -v 'railway\.app' | grep -v 'fonts\.g' | sort -u || true)"
if [ -z "$stray" ]; then
  printf '  \033[32mok\033[0m   %-46s none\n' "off-site links in the gallery"; pass=$((pass+1))
else
  printf '  \033[31mFAIL\033[0m %-46s %s\n' "off-site links in the gallery" "$(printf '%s' "$stray" | tr '\n' ' ')"; fail=$((fail+1))
fi
check "share form"           "$SITE/worlds/share.php"    200
check "admin"                "$SITE/worlds/admin.php"    200

# Every screenshot and every download the gallery actually links to.
shots=$(curl -s "$SITE/worlds/" | grep -oE 'uploads/screenshots/[A-Za-z0-9.-]+\.jpg' | sort -u)
if [ -z "$shots" ]; then
  printf '  \033[31mFAIL\033[0m %-46s no screenshots linked -- is it seeded?\n' "screenshots present"; fail=$((fail+1))
else
  n=0
  for t in $shots; do
    got="$(code "$SITE/worlds/$t")"
    [ "$got" = "200" ] || { printf '  \033[31mFAIL\033[0m screenshot %s -> %s\n' "$(basename "$t")" "$got"; fail=$((fail+1)); }
    n=$((n+1))
  done
  printf '  \033[32mok\033[0m   %-46s %d files\n' "every linked screenshot loads" "$n"; pass=$((pass+1))
fi

ids=$(curl -s "$SITE/worlds/" | grep -oE 'world\.php\?id=[0-9]+' | grep -oE '[0-9]+' | sort -un)
for id in $ids; do
  check "world page #$id"    "$SITE/worlds/world.php?id=$id" 200
done
for id in $ids; do
  got="$(code "$SITE/worlds/download.php?id=$id")"
  [ "$got" = "200" ] || { printf '  \033[31mFAIL\033[0m download #%s -> %s\n' "$id" "$got"; fail=$((fail+1)); }
done
[ -n "$ids" ] && { printf '  \033[32mok\033[0m   %-46s %d worlds\n' "every world downloads" "$(echo "$ids" | wc -w | tr -d ' ')"; pass=$((pass+1)); }

# A download has to be a real world file, not an error page with a 200 on it.
# Must end in .json: node's require() picks its parser from the extension and refuses to
# read an extensionless file as JSON, which fails the check on a download that is fine.
tmp="$(mktemp -t edusim-smoke).json"
first=$(echo "$ids" | head -1)
if [ -n "$first" ]; then
  curl -s -o "$tmp" "$SITE/worlds/download.php?id=$first"
  if node -e "const d=require('$tmp'); process.exit(d.format==='edusim-world' && Array.isArray(d.records) && d.records.length>0 ? 0 : 1)" 2>/dev/null; then
    printf '  \033[32mok\033[0m   %-46s %s records\n' "downloaded world parses" \
      "$(node -e "console.log(require('$tmp').records.length)")"; pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m %-46s not a valid world file\n' "downloaded world parses"; fail=$((fail+1))
  fi
fi
rm -f "$tmp"

section "Things that must NOT be reachable"
# These are the .htaccess rules. A 200 here is a security bug, not a cosmetic one.
check "lib/ config"          "$SITE/worlds/lib/config.php"        403 404
check "lib/ db"              "$SITE/worlds/lib/db.php"            403 404
check "the sqlite database"  "$SITE/worlds/data/worlds.sqlite"    403 404
check "a stored world file"  "$SITE/worlds/data/worlds/x.json"    403 404
check "the seed payloads"    "$SITE/worlds/seed/worlds/park.json" 403 404
check "the seeding script"   "$SITE/worlds/tools/seed-presets.php" 403 404
check "directory listing"    "$SITE/worlds/uploads/screenshots/"  403 404

section "Edusim app (as Railway serves it)"
check "app index"            "$APP/"                     200
# Vite builds with base "/", so the bundle is referenced from the origin root. A 404 here
# is the failure that mounting it on a subpath would cause.
asset=$(curl -s "$APP/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
[ -n "$asset" ] && check "main bundle"  "$APP$asset"     200
check "maple tree model"     "$APP/tree/MapleTree.obj"   200

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
exit $((fail > 0 ? 1 : 0))
