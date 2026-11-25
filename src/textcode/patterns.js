// FORKED FROM VisualHedy (src/lang/patterns.ts, commit 457a9cb), converted to plain JavaScript.
//
// The command pattern DSL, unchanged from VisualHedy:
//   {name}        a slot; how it matches is decided by the command's slot type
//   {name...}     rest-of-line text, shortest extent first
//   [ ... ]       optional group; `[a | b]` optional alternatives
//   ( a | b )     required alternatives
//   word(s)       literal with an optional plural `s`
//   , . = + - * / ^ % < > <= >= ==   punctuation literals
//
// Matching backtracks. A text slot tries its SHORTEST extent first and an optional group tries
// "present" first. When nothing matches, the DEEPEST failure (furthest token reached) is
// reported with what was expected there, which is what lets the compiler say "this needs a
// number here" instead of "I don't understand this line".
//
// Edusim difference: VisualHedy asks a hook for a slot MODE (word / atom / expr / range) and
// parses expressions itself. Edusim's slots are all one-token-or-so shapes (a number, a name,
// a colour, a quoted text), so the hook simply matches the slot and returns where it ended.

const DSL_TOKEN = /\{[A-Za-z_]+(?:\.\.\.)?\}|[A-Za-z_]+\(s\)|[A-Za-z_]+|==|<=|>=|[[\]()|,.=+\-*/^%<>]/g;

const cache = new Map();

export function compilePattern(dsl) {
  const hit = cache.get(dsl);
  if (hit) return hit;
  const toks = dsl.match(DSL_TOKEN) ?? [];
  let i = 0;
  const parseAlts = (close) => {
    const alts = [[]];
    while (i < toks.length) {
      const t = toks[i];
      if (t === close) {
        i++;
        return alts;
      }
      i++;
      const cur = alts[alts.length - 1];
      if (t === '|') alts.push([]);
      else if (t === '[') cur.push(simplify({ k: 'opt', alts: parseAlts(']') }));
      else if (t === '(') cur.push(simplify({ k: 'group', alts: parseAlts(')') }));
      else if (t.startsWith('{')) {
        const rest = t.endsWith('...}');
        cur.push({ k: 'slot', name: t.slice(1, rest ? -4 : -1), rest });
      } else if (t.endsWith('(s)')) {
        const w = t.slice(0, -3).toLowerCase();
        cur.push({ k: 'lit', words: [w, w + 's'], plural: true });
      } else if (/^[A-Za-z_]/.test(t)) cur.push({ k: 'lit', words: [t.toLowerCase()] });
      else cur.push({ k: 'punct', text: t });
    }
    return alts;
  };
  const alts = parseAlts(null);
  const out = alts.length === 1 ? alts[0] : [simplify({ k: 'group', alts })];
  cache.set(dsl, out);
  return out;
}

// `(says | say)` -> one literal with two spellings.
function simplify(el) {
  if (el.k !== 'opt' && el.k !== 'group') return el;
  if (el.alts.length > 1 && el.alts.every((a) => a.length === 1 && a[0].k === 'lit')) {
    const lit = { k: 'lit', words: el.alts.flatMap((a) => a[0].words) };
    return el.k === 'group' ? lit : { k: 'opt', alts: [[lit]] };
  }
  if (el.k === 'group' && el.alts.length === 1 && el.alts[0].length === 1) return el.alts[0][0];
  return el;
}

// hooks: { tokens, matchSlot(name, pos) -> end index or null }
// Returns { ok: true, caps: { name: { from, to } } } or { ok: false, fail: { pos, expected } }.
export function matchPattern(pattern, hooks) {
  const toks = hooks.tokens;
  const n = toks.length;
  let fail = { pos: -1, expected: 'end' };
  let found = null;
  let budget = 20000; // a hard stop against pathological backtracking

  const record = (pos, expected) => {
    if (pos > fail.pos) fail = { pos, expected };
  };

  const run = (seq, i, pos, caps) => {
    if (--budget < 0) return false;
    if (i === seq.length) {
      if (pos === n) {
        found = caps;
        return true;
      }
      record(pos, 'end');
      return false;
    }
    const el = seq[i];
    const tok = toks[pos];
    switch (el.k) {
      case 'lit':
        if (tok && tok.type === 'word' && el.words.includes(tok.text.toLowerCase())) return run(seq, i + 1, pos + 1, caps);
        record(pos, el);
        return false;
      case 'punct':
        if (tok && tok.type === 'op' && tok.text === el.text) return run(seq, i + 1, pos + 1, caps);
        record(pos, el);
        return false;
      case 'group':
      case 'opt': {
        const rest = seq.slice(i + 1);
        for (const alt of el.alts) if (run([...alt, ...rest], 0, pos, caps)) return true;
        if (el.k === 'opt') return run(seq, i + 1, pos, caps);
        return false;
      }
      case 'slot': {
        if (el.rest) {
          if (pos >= n) {
            record(pos, el);
            return false;
          }
          for (let end = pos + 1; end <= n; end++) {
            if (run(seq, i + 1, end, { ...caps, [el.name]: { from: pos, to: end } })) return true;
          }
          return false;
        }
        const end = pos < n ? hooks.matchSlot(el.name, pos) : null;
        if (end == null || end <= pos) {
          record(pos, el);
          return false;
        }
        return run(seq, i + 1, end, { ...caps, [el.name]: { from: pos, to: end } });
      }
      default:
        return false;
    }
  };

  run(pattern, 0, 0, {});
  if (found) return { ok: true, caps: found };
  return { ok: false, fail };
}

// The first literal word of a pattern, which is how a line is routed to its commands.
export function firstWords(els) {
  const first = els[0];
  if (!first) return [];
  if (first.k === 'lit') return first.words;
  if (first.k === 'group') return first.alts.flatMap((alt) => firstWords(alt));
  return [];
}
