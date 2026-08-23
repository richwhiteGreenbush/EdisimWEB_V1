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

# `--prod` points at the real deployment. The app used to live on a different host
# (Railway) and now sits at /app/ on this one, so APP is a SUBPATH of SITE in production
# and an origin ROOT locally -- deliberately, since those are the two layouts the bundle
# has to work under and `base: './'` in vite.config.js is what makes both resolve.
#
# It still has to be spelled out rather than defaulted to "$SITE", because the marketing
# page answers `/` with a 200 that means nothing about the app being there.
#
# The canonical origin is edusim3dweb.com. edusim3d.me is an alias that 301s to it, and
# pointing SITE there fails EVERY check for a reason that has nothing to do with the
# deploy: `code()` deliberately does not follow redirects, because a check that follows
# them cannot tell "the file is served" from "something answered after a hop". The alias
# gets its own redirect check below instead.
# HTTPS, since the domain now has a certificate. `code()` deliberately does not follow
# redirects, so an http base makes every single check fail with a 301 that says nothing
# about the deploy -- which is exactly what it did the first run after the cert appeared.
if [ "${1:-}" = "--prod" ]; then
  SITE="https://edusim3dweb.com"
  ALIAS="http://edusim3d.me"
  APP="https://edusim3dweb.com/app"
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
# Fetch to a FILE, then grep the file. Two traps have already been hit here:
#   * `curl | grep -q` is wrong under `set -o pipefail` -- grep exits on the first match,
#     SIGPIPEs curl, and the pipeline reports curl's 141, so the check fails precisely
#     BECAUSE the string was found.
#   * `printf '%s' "$var" | grep` then broke once the page grew past a few hundred KB.
# A temp file has neither failure mode and costs nothing.
home_html="$(mktemp)"
curl -s --max-time "$TIMEOUT" "$SITE/" -o "$home_html"
# The gallery links went ABSOLUTE in the 2026 redesign, for the same reason the app
# links always were: the page is mirrored on GitHub Pages, where a relative worlds/
# is a dead end. Match on the path so this passes against the local mirror too.
if grep -q 'href="https://edusim3dweb.com/worlds/"' "$home_html"; then
  printf '  \033[32mok\033[0m   %-46s links to the World Database\n' "gallery links"; pass=$((pass+1))
else
  printf '  \033[31mFAIL\033[0m %-46s no World Database link in the page\n' "gallery links"; fail=$((fail+1))
fi
rm -f "$home_html"

section "World gallery"
check "gallery"              "$SITE/worlds/"             200
# The gallery must not send visitors off to the old GitHub Pages copy. Every link it emits
# is now relative -- including the app, which used to be the one absolute exception and is
# now a directory on this same host. Google Fonts is the only off-site host left.
gal_html="$(curl -s --max-time "$TIMEOUT" "$SITE/worlds/")"
stray="$(printf '%s' "$gal_html" | grep -oE 'href="https?://[^"]+"' | grep -v 'fonts\.g' | sort -u || true)"
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

section "Open-a-world-from-a-link"
# The one-click flow: the world page links to a copy of the app on THIS origin, and that
# copy fetches the world file back out of the gallery. Both halves are checked, because
# the whole thing only works while they share an origin -- the gallery has no TLS, and an
# https page may not fetch an http url.
check "app on the site's own origin"  "$SITE/app/"                 200
app_html="$(mktemp)"
curl -s --max-time "$TIMEOUT" "$SITE/app/" -o "$app_html"
# base is './' so the bundle is referenced relative to /app/, not from the origin root.
# With Vite's default base this 404s, which is exactly how mounting on a subpath fails.
app_asset=$(grep -oE '\./assets/[A-Za-z0-9._-]+\.js' "$app_html" | head -1 | sed 's|^\./||')
if [ -n "$app_asset" ]; then
  check "its bundle (relative base)"  "$SITE/app/$app_asset"       200
else
  printf '  \033[31mFAIL\033[0m %-46s no ./assets/*.js in the page\n' "its bundle (relative base)"; fail=$((fail+1))
fi
rm -f "$app_html"
# Fetched by url at runtime, so it has to resolve relative to /app/ too.
check "a runtime asset under /app/"   "$SITE/app/tree/MapleTree.obj" 200

# The button itself, on a real world page, and the file it will fetch.
first_world=$(echo "$ids" | head -1)
if [ -n "$first_world" ]; then
  wp="$(mktemp)"
  curl -s --max-time "$TIMEOUT" "$SITE/worlds/world.php?id=$first_world" -o "$wp"
  if grep -q "\.\./app/?world=$first_world" "$wp"; then
    printf '  \033[32mok\033[0m   %-46s ../app/?world=%s\n' "world page links into the app" "$first_world"; pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m %-46s no ../app/?world= link on the page\n' "world page links into the app"; fail=$((fail+1))
  fi
  # og:image is what makes a shared link unfurl with a picture.
  if grep -q 'property="og:image"' "$wp"; then
    printf '  \033[32mok\033[0m   %-46s present\n' "world page carries og:image"; pass=$((pass+1))
  else
    printf '  \033[31mFAIL\033[0m %-46s missing\n' "world page carries og:image"; fail=$((fail+1))
  fi
  rm -f "$wp"
fi

section "Things that must NOT be reachable"
# These are the .htaccess rules. A 200 here is a security bug, not a cosmetic one.
check "lib/ config"          "$SITE/worlds/lib/config.php"        403 404
check "lib/ db"              "$SITE/worlds/lib/db.php"            403 404
check "the sqlite database"  "$SITE/worlds/data/worlds.sqlite"    403 404
check "a stored world file"  "$SITE/worlds/data/worlds/x.json"    403 404
check "the seed payloads"    "$SITE/worlds/seed/worlds/park.json" 403 404
check "the seeding script"   "$SITE/worlds/tools/seed-presets.php" 403 404
check "directory listing"    "$SITE/worlds/uploads/screenshots/"  403 404

# The alias domain, when there is one. It must land on the canonical origin rather than
# 404 or loop -- a broken alias is invisible from the canonical host itself.
#
# Matched on the HOST and not on the full origin, deliberately. The alias 301s to
# http://edusim3dweb.com/, which the server then 301s again to https -- an extra hop, and a
# host-side redirect rule this repo does not own and cannot deploy. What this check is for is
# "the alias points at the canonical site rather than 404ing or looping", and that is still
# exactly what it asserts; pinning the scheme instead turned it into a check on somebody
# else's DNS panel that no change here could ever make pass.
if [ -n "${ALIAS:-}" ]; then
  section "Alias domain"
  loc="$(curl -s -o /dev/null -w '%{redirect_url}' --max-time "$TIMEOUT" "$ALIAS/")"
  acode="$(code "$ALIAS/")"
  site_host="${SITE#*://}"
  case "$loc" in
    http://"$site_host"*|https://"$site_host"*) printf '  \033[32mok\033[0m   %-46s %s -> %s\n' "alias redirects to the canonical site" "$acode" "$loc"; pass=$((pass+1)) ;;
    *)        printf '  \033[31mFAIL\033[0m %-46s %s -> %s\n' "alias redirects to the canonical site" "$acode" "${loc:-nowhere}"; fail=$((fail+1)) ;;
  esac
fi

section "Edusim app"
check "app index"            "$APP/"                     200
# The bundle is referenced as `./assets/...` (vite.config.js sets base: './'), so this
# resolves against whatever directory the app is mounted in -- an origin root locally, a
# subpath in production. The regex drops the leading dot and re-roots it on $APP, which is
# what makes one check cover both layouts.
asset=$(curl -s "$APP/" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | head -1)
[ -n "$asset" ] && check "main bundle"  "$APP$asset"     200
check "maple tree model"     "$APP/tree/MapleTree.obj"   200

printf '\n\033[1m%d passed, %d failed\033[0m\n' "$pass" "$fail"
exit $((fail > 0 ? 1 : 0))
