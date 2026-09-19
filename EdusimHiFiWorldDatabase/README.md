# Edusim HiFi Worlds Database

The world gallery for **Edusim HiFi**, the Babylon.js edition (`../HiFi/`). It is the same
PHP + SQLite application as `../EdusimWorldDatabase/` — no framework, no build step, no
Composer — with its own database, its own world files and its own screenshots. Nothing is
shared between the two galleries at runtime.

```bash
cd EdusimHiFiWorldDatabase
php tools/seed-presets.php     # insert the built-in HiFi worlds (idempotent: dedupes on sha256)
php -S localhost:8001          # then open http://localhost:8001
```

## How it differs from the main gallery

| | World Database | HiFi Worlds Database |
|---|---|---|
| Served from | `/worlds/` | `/hifiworlds/` |
| Opens worlds in | `../app/` | `../hifi/` |
| Link parameter | `?world=<id>` | `?hifiworld=<id>` |
| Screenshots | three.js renders | HiFi renders only (`seed/shots/`) |

The link parameter is deliberately different. Both editions can be open on one origin, and a
shared name would let a link meant for one be pasted onto the other, where the id resolves
against the wrong gallery and quietly opens some other world.

`EWD_APP_OPEN_URL` has to stay on this host for the main gallery's reason: "Open this world in
Edusim HiFi" hands the app an id, the app fetches `download.php?id=…` back out of here, and a
page may not fetch across a scheme or origin boundary.

## The worlds

`seed/worlds/` holds one HiFi world file per built-in world — 43 of them. A HiFi world file is
the main app's record format, stamped `"edition": "edusim-hifi"`; the app reads `records` and
ignores the rest, so **a world saved in either edition opens in the other**. What makes a world
HiFi is what draws it: the HiFi app derives a full environment for each world's theme (sky,
image-based light, PBR terrain, grass, hills), relights every model with PBR, and substitutes
native high-definition models for the props that have one.

`seed/shots/<key>.jpg` are 1600×1000 captures of each world's arrival frame, taken from the
HiFi app with `?ui=0&still=1&preset=<key>`. The seeder looks ONLY there — a HiFi gallery card
showing the other edition's render would be advertising the wrong product.

Everything else — sharing, moderation, the teacher password, rate limits — is documented in
`../EdusimWorldDatabase/README.md` and works identically here.
