// How values turn into numbers, true/false and text. These are Scratch's rules, because every
// Scratch worksheet assumes them: an empty slot is 0 in a sum, "10" > "9" compares as numbers, and
// "Apple" = "apple" is true.

export function toNumber(v) {
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v ?? '').trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

export function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  const s = String(v ?? '').toLowerCase();
  return !(s === '' || s === '0' || s === 'false');
}

export function toText(v) {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    // Floating-point noise like 0.30000000000000004 is the one thing a child should not have to
    // read on a scoreboard; anything else is shown exactly.
    const r = Math.round(v * 1e9) / 1e9;
    return String(Math.abs(r - v) < 1e-12 ? r : v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v ?? '');
}

const isWhite = (v) => typeof v === 'string' && v.trim() === '';

export function compare(a, b) {
  let n1 = Number(a);
  let n2 = Number(b);
  if (isWhite(a) || isWhite(b) || Number.isNaN(n1) || Number.isNaN(n2)) {
    const s1 = String(a).toLowerCase();
    const s2 = String(b).toLowerCase();
    return s1 < s2 ? -1 : s1 > s2 ? 1 : 0;
  }
  if (typeof a === 'boolean') n1 = a ? 1 : 0;
  if (typeof b === 'boolean') n2 = b ? 1 : 0;
  return n1 - n2;
}

// Whole numbers stay whole: "pick random 1 to 10" gives 1..10, and "pick random 1 to 10.0" or any
// decimal end gives a decimal, which is Scratch's rule too.
export function pickRandom(rawFrom, rawTo, random = Math.random) {
  const from = toNumber(rawFrom);
  const to = toNumber(rawTo);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const whole = Number.isInteger(lo) && Number.isInteger(hi) && !String(rawFrom).includes('.') && !String(rawTo).includes('.');
  if (whole) return lo + Math.floor(random() * (hi - lo + 1));
  return lo + random() * (hi - lo);
}

export function wrapDirection(d) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}
