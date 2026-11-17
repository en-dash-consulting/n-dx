/**
 * Legacy syntax the grammar cannot parse, rewritten in place before a second
 * parse, so a valid PHP 5 file keeps its import, call and symbol facts.
 *
 * tree-sitter-php 0.25.1 follows PHP 8, which removed the curly-brace string
 * offset (`$s{0}`, deprecated in 7.4). The grammar turns each use into error
 * nodes, and the file used to be reported as a syntax error with its facts
 * read from a broken tree. The rewrite turns `{`…`}` into `[`…`]`: the same
 * offset in PHP 7.4's own syntax, the same length, so every byte offset, line
 * and column in the second parse is the original source's.
 *
 * Short open tags (`<?`) and `each()` are not here: the grammar parses both,
 * and php-legacy.ts counts them from the tree.
 *
 * What counts as a brace offset: in PHP code (never inline HTML, a string,
 * heredoc, nowdoc or comment), a `{` straight after a variable name, a `]`
 * or a `->name` property, with no space between. In PHP code that `{` cannot
 * open a block: a block follows `)`, `else`, `try`, a class header or a
 * statement end. The matching `}` is found by brace depth.
 *
 * @module lang-php/php-legacy-syntax
 */

import type { SourcePosition } from "@n-dx/lang-kit";

/** One construct rewritten before parsing. */
export interface LegacySyntaxRewrite {
  /** The construct, as `summary.parseIssues.legacySyntax` counts it. */
  readonly construct: "brace-offset";
  /** Where the opening `{` is in the original source. */
  readonly position: SourcePosition;
}

/** A same-length rewrite of a file and what it rewrote. */
export interface LegacySyntaxResult {
  readonly source: string;
  readonly rewrites: readonly LegacySyntaxRewrite[];
}

const OFFSET_BASE_END = /(?:\$[A-Za-z_\x80-￿][\w\x80-￿]*|\]|->[A-Za-z_\x80-￿][\w\x80-￿]*)$/;
const IDENT = /[A-Za-z_\x80-￿][\w\x80-￿]*/y;
const HEREDOC = /<<<[ \t]*(["']?)([A-Za-z_\x80-￿][\w\x80-￿]*)\1\r?\n/y;

/**
 * Rewrite every brace offset in `source`, or `undefined` when it has none.
 * The result has exactly `source.length` code units.
 */
export function rewriteLegacySyntax(source: string): LegacySyntaxResult | undefined {
  const out = source.split("");
  const rewrites: LegacySyntaxRewrite[] = [];
  /** Open `{` in code: the index of a brace offset's `{`, or -1 for any other brace. */
  const stack: number[] = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let inPhp = false;

  const advanceTo = (end: number) => {
    for (; i < end && i < n; i++) {
      if (source[i] === "\n") {
        line++;
        lineStart = i + 1;
      }
    }
  };

  while (i < n) {
    if (!inPhp) {
      const open = source.indexOf("<?", i);
      if (open === -1) break;
      // `<?xml` is markup, not PHP; `<?php`, `<?=` and a bare `<?` open code.
      const after = source.slice(open + 2, open + 5).toLowerCase();
      advanceTo(open + 2);
      if (after.startsWith("xml")) continue;
      if (after === "php") advanceTo(i + 3);
      else if (source[i] === "=") advanceTo(i + 1);
      inPhp = true;
      continue;
    }
    const c = source[i];
    const next = source[i + 1];
    if (c === "?" && next === ">") {
      inPhp = false;
      advanceTo(i + 2);
    } else if (c === "#" || (c === "/" && next === "/")) {
      // A line comment ends at the line end or at `?>`.
      let end = i;
      while (end < n && source[end] !== "\n" && !(source[end] === "?" && source[end + 1] === ">")) end++;
      advanceTo(end);
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      advanceTo(end === -1 ? n : end + 2);
    } else if (c === "'" || c === '"' || c === "`") {
      let end = i + 1;
      while (end < n && source[end] !== c) end += source[end] === "\\" ? 2 : 1;
      advanceTo(end + 1);
    } else if (c === "<" && source.startsWith("<<<", i)) {
      HEREDOC.lastIndex = i;
      const m = HEREDOC.exec(source);
      if (m === null) {
        advanceTo(i + 3);
        continue;
      }
      // The closing identifier starts a line (indented from PHP 7.3) and is not followed by a name character.
      const close = new RegExp(`^[ \\t]*${m[2]}(?![\\w\\x80-\\uffff])`, "m");
      const rest = source.slice(i + m[0].length);
      const found = close.exec(rest);
      advanceTo(found === null ? n : i + m[0].length + found.index + found[0].length);
    } else if (c === "{") {
      const before = source.slice(Math.max(0, i - 256), i);
      if (OFFSET_BASE_END.test(before) && !before.endsWith("$")) {
        stack.push(i);
        rewrites.push({ construct: "brace-offset", position: { line, column: i - lineStart } });
      } else stack.push(-1);
      advanceTo(i + 1);
    } else if (c === "}") {
      const open = stack.pop();
      if (open !== undefined && open >= 0) {
        out[open] = "[";
        out[i] = "]";
      }
      advanceTo(i + 1);
    } else if (c === "$" || /[A-Za-z_]/.test(c)) {
      IDENT.lastIndex = c === "$" ? i + 1 : i;
      const m = IDENT.exec(source);
      advanceTo(m === null ? i + 1 : IDENT.lastIndex);
    } else advanceTo(i + 1);
  }

  // An offset whose `}` never came is left as written: the parse reports it.
  const closed = rewrites.filter((r) => out[lineOffset(source, r.position)] === "[");
  if (closed.length === 0) return undefined;
  return { source: out.join(""), rewrites: closed };
}

/** The index of a position in `source`. */
function lineOffset(source: string, position: SourcePosition): number {
  let index = 0;
  for (let l = 1; l < position.line; l++) index = source.indexOf("\n", index) + 1;
  return index + position.column;
}
