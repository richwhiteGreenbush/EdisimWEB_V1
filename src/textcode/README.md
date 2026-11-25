# src/textcode: Edusim's text coding

Students can write a program as text instead of blocks, at two levels taken from VisualHedy:
**Basic Beginner** (1) and **Basic Pro** (2). Python Beginner and Python Pro stay in VisualHedy only.

**Text compiles to blocks.** `compile(source, level)` returns an ordinary block tree, built with
`createBlockInstance()`. That tree is what gets saved as `record.program` and what the existing
`ProgramRunner` runs. Nothing downstream knows the program was typed: ProgramManager, HiFi,
`duplicate`, the play icon, the stats signature and old copies of the app all see blocks.
`printBlocks(blocks, level)` goes the other way.

| File | What it is |
|---|---|
| `commands.js` | The one table: every block, its forms at both levels, and its printer |
| `compile.js` | Text → blocks, plus the Problems cards and their Fix it edits |
| `print.js` | Blocks → text |
| `messages.js` | Every word the compiler says to a student |
| `lexer.js`, `patterns.js`, `didYouMean.js` | Forked from VisualHedy (below) |
| `index.js` | The entry point: `compile`, `printBlocks`, `printLine`, `convert` |

`node tools/check-textcode.mjs` is the regression check. It covers every block at both levels,
every shipped program in both galleries, every Problems card and its fix, and the message
wording rules.

## The language

The approved design is `edusim-text-coding-phase1-language.md`, kept with Rich's plan documents.
The rules, in short:

1. **One line is one block.** A block's contents are the lines pushed in under it.
2. **Basic Beginner reads like the block, word for word**: `move forward 10 feet`, `say Good morning`.
3. **Basic Pro is Basic Beginner with "quotes" on text, `=` for numbers, symbols in checks and no
   unit words**: `side = 10`, `if x > 5`, `move forward side`. Beginner forms still work at Pro.
4. **The object is never named in the line**, because a program belongs to one object. This is the
   deliberate break from VisualHedy, which always names a sprite (`move cat right 10`).
5. **Text can only say what blocks can say.** `else`, `and`/`or`, `not`, `while`, lists, `define`
   and two sums on one line each get a card saying what to do instead (E150, E151).

Three round trips change a block without changing what it does, and the check tool allows for them:

- `say a value` prints as `say` with `{x}`, so a whole number shows `3`, not `3.00`.
- A sum written `x = x + b` reads back as `change x by b`.
- `change x by -3` prints at Pro as `x = x - 3`.

## The fork

`lexer.js`, `patterns.js` and `didYouMean.js` were forked from VisualHedy
(`../VisualHedy/src/lang/`, commit 457a9cb) and converted from TypeScript to plain JavaScript.
The rest of VisualHedy's language core could not be shared. Its syntax tree is ~60 hard-coded 2D
statements, and every one of its patterns names a sprite. See Phase 0's findings.

**A fix made to these files in VisualHedy has to be copied here by hand**, and the other way round.
That drift is accepted, the same trade CLAUDE.md records for `CityProps` and `LoftKit`. The
differences, each noted in the file's header:

- **lexer**: a `#rrggbb` colour is a token anywhere. `^` and `%` are operators, and the block
  palette's own `× ÷ − ≤ ≥` lex as the keyboard operators. `lineTree()` replaces `lineStream()`.
- **patterns**: a slot is matched by a hook (`matchSlot`) rather than by a parse mode, because every
  Edusim slot is one token or so.
- **didYouMean**: the same distance and Fix it rule, with an Edusim confusion table.

Error codes keep VisualHedy's numbers where the meaning is the same. Codes only Edusim has start at
E150 / W310, so they can never collide with a future VisualHedy code.
