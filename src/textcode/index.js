// Edusim text coding: Basic Beginner (1) and Basic Pro (2), compiled to blocks.
// The one entry point for the editor and the tools. DOM-free and Node-safe.

import { compile } from './compile.js';
import { printBlocks, printLine } from './print.js';

export const LEVELS = {
  1: { id: 1, name: 'Basic Beginner' },
  2: { id: 2, name: 'Basic Pro' },
};

export { compile, printBlocks, printLine };

// Rewrite a program from one level to the other, keeping its comments. Refuses (returns the
// diagnostics) rather than guess when the source has an error, so a conversion never loses a
// line silently.
export function convert(source, from, to, opts = {}) {
  const result = compile(source, from, opts);
  if (!result.ok) return { ok: false, diagnostics: result.diagnostics };
  const { text, notes } = printBlocks(result.blocks, to, { comments: result.comments });
  return { ok: true, text, notes };
}
