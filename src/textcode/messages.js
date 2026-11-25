// Every student-facing word the text compiler says, in one place so it can be linted and one
// day translated. VisualHedy's rules, which tools/check-textcode.mjs enforces:
//   - a title is 15 words or fewer; an explain is a sentence or two;
//   - never "invalid", "illegal", "wrong", "error", "bad", "stupid" or "fail";
//   - at Basic Beginner, none of the jargon below outside `code`;
//   - code goes in `backticks`, the student's own words in "quotes";
//   - say what to do, never who is to blame ("This line needs…", "I don't know…").
//
// Codes keep VisualHedy's numbers where the meaning is the same. Codes only Edusim has start at
// E150 / W310, so they can never collide with a future VisualHedy code.

export const L1_JARGON = ['syntax', 'variable', 'string', 'indent', 'block', 'value', 'compare',
  'defined', 'parameter', 'argument', 'expression'];

const pro = (p) => p.level === 2;
const OBJECT_WORDS = new Set(['size', 'tilt', 'opacity']);

export const MESSAGES = {
  E102: (p) => ({
    title: p.suggestion
      ? `I don't know "${p.name}". Did you mean \`${p.suggestion}\`?`
      : `I don't know the command "${p.name}".`,
    explain: 'Every line starts with a command word, like `move`, `rotate`, `say` or `repeat`.',
  }),
  E105: () => ({
    title: 'This line is pushed in, but nothing above it holds lines.',
    explain: 'Only `repeat`, `forever`, `if`, `repeat until` and `when` lines hold the lines pushed in under them.',
  }),
  E106: () => ({
    title: "This line doesn't line up with the lines around it.",
    explain: 'Lines inside the same `repeat` or `if` start at the same spot. Four spaces is the usual step.',
  }),
  E107: (p) => ({
    title: `\`${p.cmd}\` needs a number here.`,
    explain: p.example ? `Like this: \`${p.example}\`` : undefined,
  }),
  E110: () => ({
    title: 'Text needs "quotes" around it at Basic Pro.',
    explain: 'Quotes show where your words start and stop, like `say "Good morning"`.',
  }),
  E111: () => ({
    title: 'This text starts with a quote mark but never ends with one.',
    explain: 'Put a `"` at the end of the words too.',
  }),
  E112: () => ({
    title: 'To check if two things match, use `==`.',
    explain: 'One `=` sets a name to a number. Two, `==`, asks if they match.',
  }),
  E119: (p) => ({
    title: pro(p) ? `That is the Basic Beginner way. Change to \`${p.example}\`.` : `That is the Basic Pro way. Change to \`${p.example}\`.`,
    explain: 'Both mean the same thing. The Level menu can rewrite the whole program for you.',
  }),
  E121: (p) => ({
    title: p.suggestion
      ? `"${p.name}" is a word Edusim already uses. Try \`${p.suggestion}\`.`
      : `"${p.name}" is a word Edusim already uses. Pick another name.`,
    explain: OBJECT_WORDS.has(String(p.name).toLowerCase())
      ? 'That word means the object itself, so `set size to` changes how big it is.'
      : 'Names like `speed`, `score` or `height` work well.',
  }),
  E122: (p) => ({
    title: `A name can't have spaces. Try \`${p.suggestion}\`.`,
    explain: 'Join the words with `_`, like `my_score`.',
  }),
  E128: (p) => ({
    title: `This \`${p.cmd}\` line doesn't fit. Here is one that works.`,
    explain: p.example ? `\`${p.example}\`` : undefined,
  }),
  E150: (p) => {
    const say = {
      else: ['Edusim has no `else` yet. Use a second `if`.', 'For example `if x is at most 5` under `if x is more than 5`.'],
      andor: ['Edusim checks one thing per `if`. Put one `if` inside another.', 'An `if` inside an `if` means both must be true.'],
      not: ['Edusim has no `not` yet. Turn the check around instead.', '`is not more than 5` means the same as `is at most 5`.'],
      while: ['Edusim has no `while`. Use `repeat until` instead.', '`repeat until done is 1` keeps going until the check comes true.'],
      define: ['Edusim has no way to make your own commands yet.', 'Each object runs one program. Use `when an object says` to start part of it.'],
      list: ['Edusim has no lists yet.', 'Give each number its own name instead.'],
      for: ['Edusim has no `for` yet. Use `repeat` with a counter.', '`set i to 0`, then `change i by 1` inside the `repeat`.'],
    }[p.variant] ?? ["Edusim can't do this yet.", undefined];
    return { title: say[0], explain: say[1] };
  },
  E151: () => ({
    title: 'One sum per line, please. Split this into two lines.',
    explain: 'Work out one part, give it a name, then use that name on the next line.',
  }),
  E152: () => ({
    title: 'A `when` line has to start at the left edge.',
    explain: 'It starts its own part of the program, so it is never inside a `repeat` or an `if`.',
  }),
  E154: (p) => ({
    title: p.suggestion ? `I don't know the color "${p.name}". Did you mean "${p.suggestion}"?` : `I don't know the color "${p.name}".`,
    explain: 'Try red, orange, yellow, green, blue, purple, pink, white, gray, brown or black. A code like `#e0455f` works too.',
  }),
  W301: (p) => ({
    title: `Nothing in this program sets "${p.name}", so it starts at 0.`,
    explain: 'That is fine if another object shares it. Otherwise set it first, like `set speed to 5`.',
  }),
  W310: (p) => ({
    title: `\`${p.cmd}\` is an old command. It still works.`,
    explain: '`move forward` and `move up by` follow the way the object faces, which is usually what you want.',
  }),
  W311: (p) => ({
    title: `Nothing is pushed in under \`${p.cmd}\` yet.`,
    explain: 'Lines pushed in under it, by four spaces, are the ones it runs.',
  }),
  W312: (p) => ({
    title: p.suggestion
      ? `No object here is named "${p.name}". Did you mean "${p.suggestion}"?`
      : `No object here is named "${p.name}" yet.`,
    explain: 'Name an object from its menu. Until then, nobody hears this.',
  }),
};

export function message(code, params) {
  const make = MESSAGES[code];
  return make ? make(params) : { title: 'Something on this line needs a fix.' };
}
