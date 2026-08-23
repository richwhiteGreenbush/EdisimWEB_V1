# The Edusim logo

`edusim-logo-master.png` (890 × 643) is the untouched artwork. Everything else in this
folder is cut from it by `cut.py`, and can be regenerated from the master alone — nothing
here was retouched by hand:

```bash
python3 docs/assets/cut.py      # run from the repo root
```

| File | Size | Cut from the master | Used by |
| --- | --- | --- | --- |
| `edusim-logo-master.png` | 890 × 643 | — | Nothing directly. Keep it: it is what every crop below comes from |
| `edusim-logo.jpg` | 890 × 643 | the whole thing, unresampled | `README.md` |
| `edusim-wordmark.jpg` | 890 × 492 | `(0, 105) 890 × 492` | **Nothing, since 2026-08-23.** It was the site hero until the hero became live text (see below). Kept as the source of the wordmark's colours and for rollback |
| `edusim-social.jpg` | 1200 × 630 | `(0, 130) 890 × 467`, then scaled to 1200 × 630 | `og:image` / `twitter:image`. 1.91:1 is the ratio Facebook, LinkedIn and Slack unfurl at |
| `edusim-mark.png` | 160 × 160 | `(5, 170) 250 × 250`, then down to 160 | `apple-touch-icon`, and the nav chips on the **guide** and **research** pages. No longer in the marketing page's nav bar. Displayed at 40px, 32px and 26px |

Five things worth knowing before recutting any of these:

- **The mark is one letter, not the lockup.** At 40px the whole wordmark is an unreadable
  blue smudge; the E still reads as the logo, and it is why the crop is where it is. The
  crop deliberately bleeds a little off the top and bottom of the E and catches a sliver
  of the `d`: sized to *contain* the letter it reads as a photo with a letter in it rather
  than as a chip.
- **The crops carry no transparency**, because they are photographs of a meadow. That is
  fine everywhere they are used — each one sits on a rounded tile or card with its own
  rim — but it does mean the mark cannot be dropped onto an arbitrary colour.
- **`edusim-social.jpg` is the one crop that scales UP** (890 → 1200 wide). The master is
  narrower than the 1200px the unfurlers want, and every one of them will resample the
  file anyway; doing it here with Lanczos, once, beats shipping an undersized card and
  letting each scraper do it with whatever filter it has.
- **The master is landscape and already tight** — no border rule, no compass footer, and
  no square framing — where the previous artwork was a 1038 × 1050 bordered square. So the
  crops are now vertical trims of the full width rather than windows cut out of the
  middle, and `edusim-logo.jpg` is the master itself rather than a resample of it.
- **THE HERO IS NO LONGER AN IMAGE** (2026-08-23). `docs/index.html`'s `h1.hero-logo` is
  live text set in **Gluten 800** with an amber gradient, a cream outline and a warm glow;
  the marketing page's nav brand is the same face in solid amber. So the note that used to
  live here — about declaring the hero image's intrinsic `width`/`height` so the header did
  not jump as the file loaded — no longer applies to anything.

  Two things that follow, and both are easy to trip over:

  - **The amber is this artwork's own colour, hue-rotated.** The ramp in `styles.css`
    (`--wm-1`..`--wm-5`) was sampled from 152k of this file's letter pixels and rotated
    **-175°** from its blue to amber. So this JPEG is still the source of truth for the
    brand colour even though no page displays it any more — which is why it is kept.
  - **`edusim-social.jpg` is still the BLUE artwork**, so a link shared to Slack or email
    unfurls blue while the page itself is now orange. Recutting the social card is the
    obvious follow-up and has deliberately not been done yet.

The site's sky and field colors are sampled from this artwork; see the palette note at the
top of `../styles.css`.
