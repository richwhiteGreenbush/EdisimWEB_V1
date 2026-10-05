# The Official Edusim Tutorial & Projects Book, Vol. 1

The source for the 112-page, full-colour print book sold through Amazon KDP, and the
tools that capture its screenshots from the running app and build the print PDFs.

## Build it

```bash
cd book
npm install                 # playwright-core; drives the system Google Chrome
npm run build               # -> dist/*-interior.pdf, dist/*-cover.pdf, dist/preview/
node tools/build.mjs --no-pdf   # previews and checks only, much faster
```

`build.mjs` fails (exit 1) on any of: a page count other than 112, text running out of
its safe area, a missing picture, a picture printed below 250 ppi, or an unrendered tag.
`dist/preview/spreads-N.jpg` shows the book as facing pages; `dist/preview/cover.png`
is the wrap.

## Recapture the screenshots

```bash
cd .. && npx vite --port 5199 &   # the app itself, in dev mode (window.__debug)
cd book && npm run capture        # every scene, or: node tools/capture.mjs train-drive
```

Every picture is built through the app's own records and menus. The models in
`tools/models.mjs` are the same pieces the chapters tell students to build, so a picture
can never show something the steps can't make.

## Print specification (KDP, premium colour)

- **Interior:** 6 x 9 in trim with bleed = 6.125 x 9.25 in pages, single pages, 112 pages
  (seven 16-page signatures). Margins: gutter 0.75, outside 0.5, top 0.6, bottom 0.7.
- **Cover:** one sheet, 0.125 + 6 + spine + 6 + 0.125 = 12.5129 x 9.25 in. The spine is
  pages x 0.002347 in (0.2629 in at 112 pages); `build.mjs` recomputes it if the count
  changes. The back cover's bottom-right 2 x 1.2 in is left clear for KDP's barcode.

## Things that will bite

- **Fonts must be STATIC TrueType** (`assets/fonts/ttf/`). Chrome embeds a *variable*
  font in a PDF as Type 3 outlines, which print preflight flags; Google Fonts' woff2 files
  are all variable.
- **No symbol characters as text.** The book's typefaces lack ★ ☰ ▸ ✓ ← ↑ → ↓, and a
  fallback would embed a system font (Lucida Grande, Apple Symbols, PingFang) in a book
  being sold. `book.js`'s `GLYPH` table draws them as inline SVG. No emoji either: they
  embed as bitmaps.
- **No blurred text-shadow and no CSS-gradient decorations.** Apple's PDF renderer draws a
  blurred shadow as a grey box and a hard-stop gradient as stripes; print RIPs are the
  least forgiving of all. Decorations are flat SVG.
- **A page's main picture grows into spare room** (`.shot.fill`, see `book.js`). Pictures
  of the app's own panels carry `class="nofill"`, and anything with numbered callouts is
  skipped automatically, because cropping moves the callouts off their targets.

Typefaces: Gluten, Fredoka and Nunito, all SIL Open Font License.
