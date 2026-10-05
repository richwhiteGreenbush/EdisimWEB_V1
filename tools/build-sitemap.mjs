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
//   - the gallery: its front page, plus one world.php?id=N page per PUBLISHED world,
//     read off the LIVE gallery's own paged index (https://edusim3dweb.com/worlds/).
//
//     This used to read the ids off the world cards on docs/index.html, which carried
//     one card per published world. Since the 2026-10 landing-page redesign that page
//     shows only a handful of featured worlds, so the cards are no longer a list of
//     anything -- and the gallery itself is the one place that actually knows what is
//     published. Two published worlds stay out deliberately, by TITLE (ids change on a
//     re-seed from scratch): My World, an empty sandbox with nothing to index, and
//     1940's New York, whose only door is a billboard behind the Library.
//
//     It needs the network. If the gallery cannot be read the script stops rather than
//     writing a sitemap with every world silently missing from it.
//
// lastmod is the page's last git commit date, falling back to filesystem mtime for
// files with uncommitted changes. Gallery pages and the app get no lastmod at all:
// their change dates are not knowable from this repo, and an invented date is worse
// than none.
//
// Run this after editing docs/ or after re-seeding the gallery, then deploy.

import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
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
// Edusim HiFi and its gallery: not part of docs/, siblings of /app/ in the same docroot.
pages.push({ url: `${SITE}/hifi/` });
pages.push({ url: `${SITE}/hifiworlds/` });

// --- The gallery ------------------------------------------------------------------
pages.push({ url: `${SITE}/worlds/` });

const NOT_IN_SITEMAP = new Set(['My World', "1940's New York"]);

const decodeEntities = (s) => s
  .replace(/&#0*39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The gallery pages twelve to a page and answers a page past the end with the last page
// again, so stop at the first page that adds nothing new.
const worlds = new Map();   // id -> title
for (let page = 1; page <= 50; page++) {
  const url = `${SITE}/worlds/index.php?page=${page}`;
  let html;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    throw new Error(`Could not read the live gallery (${url}): ${err.message}. Nothing was written.`);
  }
  const before = worlds.size;
  for (const m of html.matchAll(/<h3><a href="world\.php\?id=(\d+)">([^<]+)<\/a><\/h3>/g)) {
    worlds.set(Number(m[1]), decodeEntities(m[2]).trim());
  }
  if (worlds.size === before) break;
}
const ids = [...worlds.entries()]
  .filter(([, title]) => !NOT_IN_SITEMAP.has(title))
  .map(([id]) => id)
  .sort((a, b) => a - b);
if (ids.length === 0) throw new Error('The live gallery listed no worlds. Nothing was written.');
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
