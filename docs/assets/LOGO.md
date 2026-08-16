# The Edusim logo

`edusim-logo-master.png` (1038 × 1050) is the untouched artwork. Everything else in this
folder is cut from it with `sips`, and can be regenerated from the master alone — nothing
here was retouched by hand.

| File | Size | Cut from the master | Used by |
| --- | --- | --- | --- |
| `edusim-logo-master.png` | 1038 × 1050 | — | Nothing directly. Keep it: it is what every crop below comes from |
| `edusim-logo.jpg` | 900 × 911 | whole thing, resampled | `README.md` |
| `edusim-wordmark.jpg` | 958 × 530 | `-c 530 958 --cropOffset 315 40` | The site hero. Wordmark, vignettes and tagline, cropped inside the master's border so no frame line shows |
| `edusim-social.jpg` | 1200 × 630 | `-c 509 970 --cropOffset 318 34`, then `-z 630 1200` | `og:image` / `twitter:image`. 1.91:1 is the ratio Facebook, LinkedIn and Slack unfurl at |
| `edusim-mark.png` | 160 × 160 | `-c 275 275 --cropOffset 352 38` | The nav and footer chips, and `apple-touch-icon`. Displayed at 40px and 26px |

Two things worth knowing before recutting any of these:

- **The mark is one letter, not the lockup.** At 40px the whole wordmark is an unreadable
  green smudge; the E still reads as the logo, and it is why the crop is where it is.
- **The crops carry no transparency**, because they are photographs of a field. That is
  fine everywhere they are used — each one sits on a rounded tile or card with its own
  rim — but it does mean the mark cannot be dropped onto an arbitrary colour.

The site's sky and grass colors are sampled from this artwork; see the palette note at the
top of `../styles.css`.
