#!/usr/bin/env bash
#
# Deploy Edusim to production (richwhite.pairserver.com).
#
# Two payloads, both plain files -- there is no build step for either:
#
#   docs/                 -> the marketing site + the Hands-On Guide  (static HTML)
#   EdusimWorldDatabase/  -> the world-sharing gallery                (PHP + SQLite)
#
# Usage:
#   ./deploy.sh            # deploy both
#   ./deploy.sh -n         # dry run: print every change, transfer nothing
#   ./deploy.sh site       # marketing site only
#   ./deploy.sh db         # world database only
#
# Authentication is an SSH key (~/.ssh/edusim_pairserver). No password is stored in this
# file, passed on a command line, or read from the environment -- see README/deploy notes.
# If the key is not yet installed on the server, this script says so and stops.

set -euo pipefail

# --- Where it goes ---------------------------------------------------------------
# pair Networks gives each domain its own directory under the account's web root, so the
# site lives at the domain's folder rather than at public_html itself. Absolute paths,
# because a cron job or a different login shell does not necessarily start in $HOME.
# Override any of these without editing the file:  REMOTE_SITE=... ./deploy.sh
REMOTE_USER="${REMOTE_USER:-richwhite}"
REMOTE_HOST="${REMOTE_HOST:-richwhite.pairserver.com}"
REMOTE_SITE="${REMOTE_SITE:-/usr/home/richwhite/public_html/edusim3d.me}"
REMOTE_DB="${REMOTE_DB:-/usr/home/richwhite/public_html/edusim3d.me/worlds}"
REMOTE_APP="${REMOTE_APP:-/usr/home/richwhite/public_html/edusim3d.me/app}"
# Edusim HiFi (the Babylon.js edition) and ITS gallery. They deploy as SIBLINGS in the same
# docroot for the reason /app/ sits beside /worlds/: the HiFi app's Get More Worlds button is
# the relative link ../hifiworlds/, and "Open this world in Edusim HiFi" hands the app an id
# that it fetches back from /hifiworlds/download.php -- which has to be same-origin.
REMOTE_HIFI="${REMOTE_HIFI:-/usr/home/richwhite/public_html/edusim3d.me/hifi}"
REMOTE_HIFIDB="${REMOTE_HIFIDB:-/usr/home/richwhite/public_html/edusim3d.me/hifiworlds}"

SSH_KEY="${SSH_KEY:-$HOME/.ssh/edusim_pairserver}"
SSH_OPTS="-i $SSH_KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY=""
WHAT="all"

for arg in "$@"; do
  case "$arg" in
    -n|--dry-run) DRY="--dry-run" ;;
    site) WHAT="site" ;;
    db)   WHAT="db" ;;
    app)  WHAT="app" ;;
    hifi)   WHAT="hifi" ;;
    hifidb) WHAT="hifidb" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# --- Preflight -------------------------------------------------------------------
[ -f "$SSH_KEY" ] || { echo "No deploy key at $SSH_KEY. Generate one with:
  ssh-keygen -t ed25519 -f $SSH_KEY -N '' -C edusim-deploy" >&2; exit 1; }

say "Checking the server answers to the deploy key"
if ! ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" true 2>/dev/null; then
  cat >&2 <<EOF

Cannot log in to $REMOTE_HOST with $SSH_KEY.

If the key has not been installed yet, run this ONCE and enter the account
password at its prompt (this script never handles the password itself):

  ssh-copy-id -i $SSH_KEY.pub $REMOTE_USER@$REMOTE_HOST

Then run ./deploy.sh again.
EOF
  exit 1
fi

# --- The marketing site ----------------------------------------------------------
# Static files with no server-side state, so --delete is safe: anything on the server
# that is not in docs/ is a leftover from an older deploy and should go.
#
# EXCEPT the other two payloads, which are subdirectories of this same docroot and are
# NOT in docs/. Both must be excluded or --delete removes them: `worlds/` is every world
# a student has shared, and `app/` is the app itself. `./deploy.sh all` happens to upload
# them again afterwards, which is what hid this -- but `./deploy.sh site` on its own does
# not, and would leave the site standing with the gallery and the app deleted.
if [ "$WHAT" = "all" ] || [ "$WHAT" = "site" ]; then
  say "Marketing site  ->  $REMOTE_HOST:$REMOTE_SITE"
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_SITE'"
  rsync -az --human-readable --itemize-changes $DRY \
    --delete \
    --exclude '.DS_Store' \
    --exclude '_preview-check.html' \
    --exclude 'worlds/' \
    --exclude 'app/' \
    --exclude 'hifi/' \
    --exclude 'hifiworlds/' \
    -e "ssh $SSH_OPTS" \
    "$HERE/docs/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_SITE/"
fi

# --- The app, on the site's own origin --------------------------------------------
# A SECOND copy of the built app, beside the gallery rather than instead of Railway.
#
# This is what makes "Open this world in Edusim" possible at all. That button hands the
# app a world id and the app fetches the file from the gallery -- and a fetch has to be
# same-origin here, because edusim3dweb.com has no TLS and a page served over https may
# not fetch an http url. Browsers block it as mixed content and nothing client-side can
# get round it. Served from the gallery's own host, both ends are plain http and the
# fetch is same-origin, so it simply works.
#
# The Railway copy stays exactly as it is: it is still where "Play Now" and every other
# link points, and it is the one that gets a certificate for free. When the domain here
# gets one too, the two become interchangeable and this can go back to being a mirror.
if [ "$WHAT" = "all" ] || [ "$WHAT" = "app" ]; then
  if [ ! -d "$HERE/dist" ]; then
    echo "No dist/ to deploy. Run: npm run build" >&2
    exit 1
  fi
  say "Edusim app      ->  $REMOTE_HOST:$REMOTE_APP"
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_APP'"
  # `dev/` MUST NOT SHIP. public/dev/audit.js is a console helper for world-building, and
  # it lives under public/ only so it survives a Vite HMR reload -- which means Vite copies
  # it verbatim into dist/ like every other public asset. .gitignore already says it must
  # never ship; this is what actually stops it, since the app payload is the one rsync that
  # had no exclude but .DS_Store. Caught by reading a dry run: `cd+++++++ dev/`.
  rsync -az --human-readable --itemize-changes $DRY \
    --delete \
    --exclude '.DS_Store' \
    --exclude 'dev/' \
    -e "ssh $SSH_OPTS" \
    "$HERE/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_APP/"
fi

# --- The world database ----------------------------------------------------------
# This one HOLDS LIVE DATA. The excludes below are not tidiness -- they are what stops
# a deploy from wiping every world a student has shared. rsync protects excluded paths
# from --delete (that is its default; --delete-excluded would override it and must
# never be added here).
#
#   data/worlds.sqlite*   the database itself
#   data/stats.sqlite*    the page counters (a SECOND database, see lib/stats.php)
#   data/worlds/*.json    one shared world file each
#   uploads/screenshots/* the pictures that go with them
#   lib/config.local.php  this deployment's admin password hash and IP salt
if [ "$WHAT" = "all" ] || [ "$WHAT" = "db" ]; then
  say "World database  ->  $REMOTE_HOST:$REMOTE_DB"
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_DB'"
  rsync -az --human-readable --itemize-changes $DRY \
    --delete \
    --exclude '.DS_Store' \
    --exclude 'data/worlds.sqlite*' \
    --exclude 'data/stats.sqlite*' \
    --exclude 'data/worlds/*.json' \
    --exclude 'uploads/screenshots/*' \
    --exclude 'lib/config.local.php' \
    -e "ssh $SSH_OPTS" \
    "$HERE/EdusimWorldDatabase/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DB/"

  if [ -z "$DRY" ]; then
    say "Making data/ and uploads/ writable by the web server"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" \
      "cd '$REMOTE_DB' && mkdir -p data/worlds uploads/screenshots && chmod -R 775 data uploads"
  fi
fi

# ---- Edusim HiFi -----------------------------------------------------------------------------
# NOTE FOR WHOEVER ADDS THE NEXT PAYLOAD: the site rsync above runs with --delete into the
# docroot these all live in, so EVERY sibling directory must be in its exclude list or
# `./deploy.sh site` deletes it. hifi/ and hifiworlds/ were added there with these two blocks.
if [ "$WHAT" = "all" ] || [ "$WHAT" = "hifi" ]; then
  if [ ! -d "$HERE/HiFi/dist" ]; then
    echo "No HiFi/dist/ to deploy. Run: (cd HiFi && npm run build)" >&2
    exit 1
  fi
  say "Edusim HiFi     ->  $REMOTE_HOST:$REMOTE_HIFI"
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_HIFI'"
  rsync -az --human-readable --itemize-changes $DRY \
    --delete \
    --exclude '.DS_Store' \
    -e "ssh $SSH_OPTS" \
    "$HERE/HiFi/dist/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_HIFI/"
fi

if [ "$WHAT" = "all" ] || [ "$WHAT" = "hifidb" ]; then
  say "HiFi gallery    ->  $REMOTE_HOST:$REMOTE_HIFIDB"
  ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" "mkdir -p '$REMOTE_HIFIDB'"
  # The same never-touch list as the main gallery: a deployment's database, its world files,
  # its screenshots and its local config belong to that deployment, not to the repo.
  rsync -az --human-readable --itemize-changes $DRY \
    --delete \
    --exclude '.DS_Store' \
    --exclude 'data/worlds.sqlite*' \
    --exclude 'data/stats.sqlite*' \
    --exclude 'data/worlds/*.json' \
    --exclude 'uploads/screenshots/*' \
    --exclude 'lib/config.local.php' \
    -e "ssh $SSH_OPTS" \
    "$HERE/EdusimHiFiWorldDatabase/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_HIFIDB/"
  if [ -z "$DRY" ]; then
    say "Making the HiFi gallery's data/ and uploads/ writable by the web server"
    ssh $SSH_OPTS "$REMOTE_USER@$REMOTE_HOST" \
      "cd '$REMOTE_HIFIDB' && mkdir -p data/worlds uploads/screenshots && chmod -R 775 data uploads"
  fi
fi

say "Done${DRY:+ (dry run -- nothing was transferred)}"
