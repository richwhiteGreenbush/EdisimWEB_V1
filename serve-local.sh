#!/usr/bin/env bash
#
# Run everything this project deploys, on this machine, the way it is actually served.
#
# All three deployed things now live on one host, in one docroot, so port 8080 is the
# whole production layout. Port 8081 is not a deployment -- see note 3 below:
#
#   port 8080   the pair Networks site -- docs/ at the root, EdusimWorldDatabase/ at
#               /worlds, and the dist/ bundle at /app, Apache
#               + PHP 8.2 over FastCGI                          (edusim3dweb.com)
#   port 8081   the same bundle again, at an ORIGIN ROOT. Not a
#               deployment any more -- it is the check that
#               `base: './'` still resolves from a root as well
#               as from a subdirectory, which is the difference
#               between the two mounts and easy to break.
#
# WHY THIS EXISTS RATHER THAN `php -S` AND `npm run preview`:
#
#   1. `php -S` IGNORES .htaccess COMPLETELY. Every access rule the gallery depends on --
#      the deny on data/, the PHP-off switch on uploads/, the 404 on lib/ -- is invisible
#      to it. A smoke test there can pass while the real site is broken, which is exactly
#      what happened: the gallery tested clean and served no screenshots in production.
#   2. PHP here is FastCGI, NOT mod_php. That distinction is the bug class above: the
#      mod_php-only directives (php_flag, php_value) are a fatal 500 under FastCGI and
#      silently fine under mod_php, and pair runs FastCGI (its fcgi-bin/php8_wrapper.sh).
#   3. The app is served from a SUBDIRECTORY (/app) as well as from an origin root, and
#      only one of those two 404s every asset when `base` in vite.config.js is wrong.
#      `npm run preview` shows the root case alone, which is the one that stays working.
#
# Nothing is installed and nothing system-wide is touched. Both ports are above 1024, so
# no sudo.
#
# WHY IT SERVES A COPY RATHER THAN THE REPO ITSELF: this project lives on the Desktop, and
# macOS TCC refuses system binaries like httpd any access to ~/Desktop and ~/Documents --
# not just to the files, but to traversing the directory at all, so Apache 403s every
# request before it reaches the docroot and cannot even read a config placed there. The
# fix is to serve from /private/tmp, which is outside TCC, and rsync the repo into it on
# every start. That is a real cost -- EDITS NEED A RESTART TO SHOW UP -- so it is one
# command, and it uses the SAME excludes deploy.sh does, which means the local mirror is
# literally a local deployment and exercises that logic too.
#
#   ./serve-local.sh           sync, start (rebuilds the app if dist/ is missing)
#   ./serve-local.sh --build   force `npm run build` first
#   ./serve-local.sh sync      re-sync without restarting -- after editing a file
#   ./serve-local.sh stop | status | logs
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN="/private/tmp/edusim-local-server"
SITE="$RUN/site"          # docs/ + EdusimWorldDatabase/ -- the pair Networks layout
APP="$RUN/app"            # dist/ again, at an origin root -- see the note above
SITE_PORT="${SITE_PORT:-8080}"
APP_PORT="${APP_PORT:-8081}"
FPM_PORT="${FPM_PORT:-9082}"

HTTPD=/usr/sbin/httpd
MODS=/usr/libexec/apache2
PHP_FPM="$HOME/Library/Application Support/Herd/bin/php82-fpm"

say() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }

# Stop by PORT, not by pid file or command line. A run that died before writing its pid
# file, or an older one started from a different config path, still holds the port -- and
# that is the only thing that actually blocks a restart. Matching on the config path
# missed exactly that case.
stop_all() {
  for port in "$SITE_PORT" "$APP_PORT" "$FPM_PORT"; do
    local pids
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  sleep 1
  # Anything that ignored SIGTERM.
  for port in "$SITE_PORT" "$APP_PORT" "$FPM_PORT"; do
    local pids
    pids="$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
  done
}

# Mirror the repo into /private/tmp. The excludes are deploy.sh's, for the same reason:
# data/ and uploads/ are the running instance's own contents, and --delete would wipe
# every world seeded into the local gallery on the next sync.
sync_all() {
  mkdir -p "$SITE" "$APP"
  # `worlds/` and `app/` are excluded because they are not part of docs/ -- they are the
  # other two payloads, rsynced in below. Without the excludes, --delete wipes each of
  # them on every sync (they survived only by being written afterwards, which is exactly
  # the kind of order dependency that breaks the first time these lines are reordered).
  rsync -a --delete --exclude '.DS_Store' --exclude '_preview-check.html' \
    --exclude 'worlds/' --exclude 'app/' "$HERE/docs/" "$SITE/"
  rsync -a --delete --exclude '.DS_Store' \
    --exclude 'data/worlds.sqlite*' --exclude 'data/worlds/*.json' \
    --exclude 'uploads/screenshots/*' --exclude 'lib/config.local.php' \
    "$HERE/EdusimWorldDatabase/" "$SITE/worlds/"
  mkdir -p "$SITE/worlds/data/worlds" "$SITE/worlds/uploads/screenshots"
  # The bundle goes to BOTH places deploy.sh puts it: an origin root, and /app/ on the
  # site. The second is not a nicety -- "Open this world in Edusim" hands the app a world
  # id and the app fetches the file back out of the gallery, which only works while the
  # two share an origin. Without a local /app/ that whole flow is untestable here and the
  # smoke test's link checks can only ever run against production.
  if [ -d "$HERE/dist" ]; then
    rsync -a --delete "$HERE/dist/" "$APP/"
    rsync -a --delete "$HERE/dist/" "$SITE/app/"
  fi
}

FORCE_BUILD=""
case "${1:-start}" in
  stop)   stop_all; say "stopped"; exit 0 ;;
  sync)   sync_all; say "synced (no restart needed for static files)"; exit 0 ;;
  status)
    printf 'apache   %s\n' "$(pgrep -qf "httpd -f $RUN/httpd.conf" && echo running || echo stopped)"
    printf 'php-fpm  %s\n' "$(pgrep -qf "php-fpm.*$RUN/php-fpm.conf" && echo running || echo stopped)"
    exit 0 ;;
  logs)   tail -n 60 -f "$RUN/error.log"; exit 0 ;;
  --build) FORCE_BUILD=1 ;;
  start)  ;;
  *) echo "usage: $0 [start|--build|stop|status|logs]" >&2; exit 2 ;;
esac

[ -x "$HTTPD" ]   || { echo "No Apache at $HTTPD" >&2; exit 1; }
[ -x "$PHP_FPM" ] || { echo "No PHP 8.2 FPM at $PHP_FPM (add PHP 8.2 in Herd)" >&2; exit 1; }

# --- The app bundle --------------------------------------------------------------
if [ -n "$FORCE_BUILD" ] || [ ! -f "$HERE/dist/index.html" ]; then
  say "Building the app (npm run build)"
  (cd "$HERE" && npm run build)
fi

stop_all
mkdir -p "$RUN"

say "Syncing the repo into $RUN (Apache cannot read ~/Desktop)"
sync_all

# --- PHP-FPM ---------------------------------------------------------------------
# One static pool is plenty for one person clicking around. catch_workers_output is what
# puts a PHP warning into our error log instead of dropping it on the floor.
cat > "$RUN/php-fpm.conf" <<EOF
[global]
pid = $RUN/php-fpm.pid
error_log = $RUN/php-fpm.log
daemonize = yes

[www]
listen = 127.0.0.1:$FPM_PORT
pm = static
pm.max_children = 4
catch_workers_output = yes
php_admin_value[error_reporting] = E_ALL
php_admin_flag[display_errors] = on
; The same limits pair reports, so a large world file behaves identically here.
php_admin_value[upload_max_filesize] = 50M
php_admin_value[post_max_size] = 50M
php_admin_value[memory_limit] = 256M
EOF

# --- Apache ----------------------------------------------------------------------
# AllowOverride All is the entire point: without it .htaccess is read and every directive
# in it silently ignored, which is the same blind spot as `php -S`.
#
# mod_access_compat is loaded deliberately -- it is what keeps Apache 2.2's "Deny from
# all" working under 2.4, and the app's data/.htaccess uses it.
cat > "$RUN/httpd.conf" <<EOF
ServerRoot /usr
ServerName localhost
Listen $SITE_PORT
Listen $APP_PORT
PidFile $RUN/httpd.pid
ErrorLog $RUN/error.log
CustomLog $RUN/access.log combined
LogLevel warn
DefaultRuntimeDir $RUN

LoadModule mpm_prefork_module $MODS/mod_mpm_prefork.so
LoadModule unixd_module $MODS/mod_unixd.so
LoadModule authz_core_module $MODS/mod_authz_core.so
LoadModule authz_host_module $MODS/mod_authz_host.so
LoadModule access_compat_module $MODS/mod_access_compat.so
LoadModule log_config_module $MODS/mod_log_config.so
LoadModule mime_module $MODS/mod_mime.so
LoadModule dir_module $MODS/mod_dir.so
LoadModule alias_module $MODS/mod_alias.so
LoadModule headers_module $MODS/mod_headers.so
LoadModule env_module $MODS/mod_env.so
LoadModule proxy_module $MODS/mod_proxy.so
LoadModule proxy_fcgi_module $MODS/mod_proxy_fcgi.so

TypesConfig /private/etc/apache2/mime.types
DirectoryIndex index.html index.php

# The app fetches these at runtime and macOS's mime.types predates all of them; served as
# application/octet-stream the loaders still work, but the browser cannot cache or
# compress them sensibly and the network panel is unreadable.
AddType model/gltf-binary   .glb
AddType model/gltf+json     .gltf
AddType text/plain          .obj .mtl
AddType application/wasm    .wasm

# PHP over FastCGI. SetHandler rather than ProxyPassMatch, which is what keeps PATH_INFO
# and the query string intact.
<FilesMatch \\.php\$>
    SetHandler "proxy:fcgi://127.0.0.1:$FPM_PORT"
</FilesMatch>

# --- The pair Networks site --------------------------------------------------
# docs/ IS the site root and the gallery is a directory inside it. Serving them on
# separate ports would not exercise the relative URLs the app emits.
<VirtualHost *:$SITE_PORT>
    DocumentRoot "$SITE"
    <Directory "$SITE">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    # /worlds is a real subdirectory of the mirror, exactly as on the server -- no Alias.
    <Directory "$SITE/worlds">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>

# --- The same bundle at an origin root, so both mounts are exercised ---------
<VirtualHost *:$APP_PORT>
    DocumentRoot "$APP"
    <Directory "$APP">
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
EOF

say "Starting PHP 8.2 FPM on 127.0.0.1:$FPM_PORT"
"$PHP_FPM" --fpm-config "$RUN/php-fpm.conf" 2>>"$RUN/php-fpm.log"

say "Checking the Apache config"
$HTTPD -f "$RUN/httpd.conf" -t

say "Starting Apache"
$HTTPD -f "$RUN/httpd.conf" -k start
sleep 1

printf '\n  marketing site   http://localhost:%s/\n' "$SITE_PORT"
printf '  world gallery    http://localhost:%s/worlds/\n' "$SITE_PORT"
printf '  Edusim app       http://localhost:%s/app/\n' "$SITE_PORT"
printf '  …at an origin root http://localhost:%s/\n' "$APP_PORT"
printf '  logs             ./serve-local.sh logs\n\n'
