// FORKED FROM VisualHedy (src/lang/didYouMean.ts, commit 457a9cb), converted to plain
// JavaScript. The distance, the threshold and the Fix-it rule are VisualHedy's unchanged; the
// confusion table is Edusim's own, because the commands are different.

// Optimal-string-alignment Damerau-Levenshtein distance (case-insensitive).
export function damerauLevenshtein(a, b) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Array(m + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[n][m];
}

// Largest edit distance still called "close" for a word of this length.
export function maxDistanceFor(word) {
  const n = word.length;
  if (n <= 2) return 0;
  if (n <= 4) return 1;
  if (n <= 7) return 2;
  return 3;
}

// The closest candidates to `word`, or null. Fix it only with ONE best candidate and either a
// name of 4+ letters or a distance of 1 (VisualHedy PLAN §6.1).
export function suggest(word, candidates) {
  const w = word.toLowerCase();
  const limit = maxDistanceFor(w);
  let bestD = Infinity;
  let best = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (c === w) continue;
    const dist = damerauLevenshtein(w, c);
    if (dist > limit || (dist > 0 && dist >= Math.max(w.length, c.length))) continue;
    if (dist < bestD) {
      bestD = dist;
      best = [c];
    } else if (dist === bestD) best.push(c);
  }
  if (!best.length) return null;
  return { best, distance: bestD, fixIt: best.length === 1 && (w.length >= 4 || bestD <= 1) };
}

// Words students type that mean one of Edusim's commands: the first word of a line, mapped to
// the command word that replaces it.
export const COMMAND_CONFUSIONS = new Map([
  ['turn', 'rotate'],
  ['spin', 'rotate'],
  ['mov', 'move'],
  ['walk', 'move'],
  ['go', 'move'],
  ['print', 'say'],
  ['echo', 'say'],
  ['says', 'say'],
  ['speak', 'say'],
  ['sleep', 'wait'],
  ['pause', 'wait'],
  ['delay', 'wait'],
  ['loop', 'repeat'],
  ['slide', 'glide'],
  ['copy', 'duplicate'],
  ['clone', 'duplicate'],
  ['pen', 'marker'],
]);
