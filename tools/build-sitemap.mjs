#!/usr/bin/env node
// Regenerate docs/sitemap.xml from what is actually on the site.
//
//   node tools/build-sitemap.mjs
//
// Three sources, in the order they appear in the file:
//
//   - every *.html under docs/ (minus _preview-check.html, which deploy.sh excludes),
//     with index.html files folded into their directory URL
//   - the app, as ONE entry -- the ?world=N variants are all the same client-rendered
//     page, so listing each id would hand crawlers 33 copies of identical HTML
//   - the gallery: its front page, plus one world.php?id=N page per world card on
//     docs/index.html. The card list is the maintained source of published ids
//     (unpublished worlds have no card), and the worlds that deliberately have no
//     card -- My World, 1940's New York -- stay out of the sitemap for the same
//     reason they have no card.
//
// lastmod is the page's last git commit date, falling back to filesystem mtime for
// files with uncommitted changes. Gallery pages and the app get no lastmod at all:
// their change dates are not knowable from this repo, and an invented date is worse
// than none.
//
// Run this after editing docs/ or after re-seeding the gallery, then deploy.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const docsDir = join(root, 'docs');
const SITE = 'https://edusim3dweb.com';
const EXCLUDE = new Set(['_preview-check.html']);

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith('.html') && !EXCLUDE.has(entry.name)) out.push(path);
  }
  return out;
}

function lastmod(path) {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', path], { cwd: root })
    .toString().trim();
  if (!dirty) {
    const committed = execFileSync('git', ['log', '-1', '--format=%cs', '--', path], { cwd: root })
      .toString().trim();
    if (committed) return committed;
  }
  return statSync(path).mtime.toISOString().slice(0, 10);
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- Static pages, root first, then by path ---------------------------------------
const pages = htmlFiles(docsDir)
  .map((path) => {
    const rel = relative(docsDir, path).split('\\').join('/');
    const url = rel === 'index.html' ? `${SITE}/`
      : rel.endsWith('/index.html') ? `${SITE}/${rel.slice(0, -'index.html'.length)}`
      : `${SITE}/${rel}`;
    return { url, lastmod: lastmod(path) };
  })
  .sort((a, b) => (a.url === `${SITE}/` ? -1 : b.url === `${SITE}/` ? 1 : a.url.localeCompare(b.url)));

// --- The app ----------------------------------------------------------------------
pages.push({ url: `${SITE}/app/` });

// --- The gallery ------------------------------------------------------------------
pages.push({ url: `${SITE}/worlds/` });

const indexHtml = readFileSync(join(docsDir, 'index.html'), 'utf8');
const ids = [...new Set(
  [...indexHtml.matchAll(/class="world-open"[^>]*[?&]world=(\d+)/g)].map((m) => Number(m[1])),
)].sort((a, b) => a - b);
if (ids.length === 0) throw new Error('No .world-open card links found in docs/index.html');
for (const id of ids) pages.push({ url: `${SITE}/worlds/world.php?id=${id}` });

// --- Write ------------------------------------------------------------------------
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map(({ url, lastmod }) => lastmod
    ? `  <url><loc>${escapeXml(url)}</loc><lastmod>${lastmod}</lastmod></url>`
    : `  <url><loc>${escapeXml(url)}</loc></url>`),
  '</urlset>',
  '',
].join('\n');

writeFileSync(join(docsDir, 'sitemap.xml'), xml);
console.log(`docs/sitemap.xml: ${pages.length} URLs (${ids.length} gallery worlds)`);
