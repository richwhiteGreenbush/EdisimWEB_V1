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
| `edusim-wordmark.jpg` | 890 × 492 | `(0, 105) 890 × 492` | The site hero. Wordmark, vignettes and tagline |
| `edusim-social.jpg` | 1200 × 630 | `(0, 130) 890 × 467`, then scaled to 1200 × 630 | `og:image` / `twitter:image`. 1.91:1 is the ratio Facebook, LinkedIn and Slack unfurl at |
| `edusim-mark.png` | 160 × 160 | `(5, 170) 250 × 250`, then down to 160 | The nav and footer chips, and `apple-touch-icon`. Displayed at 40px, 32px and 26px |

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
- **`docs/index.html` declares the hero image's intrinsic `width`/`height`**, and those
  attributes are what reserve its space before the file arrives. They have to match
  `edusim-wordmark.jpg`'s real size or the hero jumps as it loads.

The site's sky and field colors are sampled from this artwork; see the palette note at the
top of `../styles.css`.
