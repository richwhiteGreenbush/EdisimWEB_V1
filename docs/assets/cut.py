#!/usr/bin/env python3
"""Cut every derived logo asset from edusim-logo-master.png.

Run from the repo root:  python3 docs/assets/cut.py

Needs Pillow, and nothing else. The crop boxes and the reasoning behind each one are
documented in LOGO.md next to this file -- change them there too if you change them here.
This replaced a row of macOS `sips` one-liners, which could only be re-run on a Mac.
"""
from PIL import Image

HERE = 'docs/assets/'
master = Image.open(HERE + 'edusim-logo-master.png').convert('RGB')
assert master.size == (890, 643), f'unexpected master size {master.size}'


def crop(x, y, w, h):
    return master.crop((x, y, x + w, y + h))


def jpg(im, name):
    # subsampling=0 keeps the chroma full-resolution: the letters are outlined in a thin
    # cream stroke against blue, which is exactly the edge 4:2:0 smears.
    im.save(HERE + name, quality=92, subsampling=0)
    print(f'{name:24s} {im.size}')


# README -- the whole artwork, untouched.
jpg(crop(0, 0, 890, 643), 'edusim-logo.jpg')

# Site hero: sky, wordmark, vignettes and tagline. The margins it keeps (71px of sky
# above the letters, 29px of meadow below the tagline) are close to the master's own
# ratio, so the crop reads as the artwork rather than as a tighter version of it.
jpg(crop(0, 105, 890, 492), 'edusim-wordmark.jpg')

# og:image / twitter:image. 1.91:1, and the one crop that scales up -- see LOGO.md.
jpg(crop(0, 130, 890, 467).resize((1200, 630), Image.LANCZOS), 'edusim-social.jpg')

# Nav / footer chip and apple-touch-icon: the E alone, bleeding slightly off the top and
# bottom so it fills the tile.
mark = crop(5, 170, 250, 250).resize((160, 160), Image.LANCZOS)
mark.save(HERE + 'edusim-mark.png')
print(f'{"edusim-mark.png":24s} {mark.size}')
