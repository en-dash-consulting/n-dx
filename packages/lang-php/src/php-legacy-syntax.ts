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
  /**
   * Open `{` in code: a brace offset's index, or {@link BLOCK}, {@link INTERP}
   * (a string's `{$…}`) or {@link ACCESS} (`${…}`, `->{…}`, whose result can
   * itself be offset: `$a->{$b}{0}`).
   */
  const stack: number[] = [];
  /** Where each `}` that closed an offset or a dynamic access is: an offset may follow it directly. */
  const indexable = new Set<number>();
  /** Strings being read, innermost last; code is read when this is empty or the top is `interp`. */
  const ctx: Context[] = [];
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
    const top = ctx.at(-1);
    if (top !== undefined && top.type !== "interp") {
      // A string or heredoc body: only its `{$…}` segments are code.
      const c = source[i];
      if (top.type === "heredoc" && (i === top.bodyStart || source[i - 1] === "\n")) {
        const close = new RegExp(`[ \\t]*${top.id}(?![\\w\\x80-\\uffff])`, "y");
        close.lastIndex = i;
        if (close.test(source)) {
          ctx.pop();
          advanceTo(close.lastIndex);
          continue;
        }
      }
      if (c === "\\") advanceTo(i + 2);
      else if (top.type === "quoted" && c === top.quote) {
        ctx.pop();
        advanceTo(i + 1);
      } else if (c === "{" && source[i + 1] === "$") {
        stack.push(INTERP);
        ctx.push({ type: "interp" });
        advanceTo(i + 1);
      } else advanceTo(i + 1);
      continue;
    }
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
    if (c === "?" && next === ">" && top === undefined) {
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
    } else if (c === "'") {
      let end = i + 1;
      while (end < n && source[end] !== c) end += source[end] === "\\" ? 2 : 1;
      advanceTo(end + 1);
    } else if (c === '"' || c === "`") {
      ctx.push({ type: "quoted", quote: c });
      advanceTo(i + 1);
    } else if (c === "<" && source.startsWith("<<<", i)) {
      HEREDOC.lastIndex = i;
      const m = HEREDOC.exec(source);
      if (m === null) {
        advanceTo(i + 3);
        continue;
      }
      if (m[1] === "'") {
        // A nowdoc is text throughout.
        const close = new RegExp(`^[ \\t]*${m[2]}(?![\\w\\x80-\\uffff])`, "m");
        const rest = source.slice(i + m[0].length);
        const found = close.exec(rest);
        advanceTo(found === null ? n : i + m[0].length + found.index + found[0].length);
      } else {
        advanceTo(i + m[0].length);
        ctx.push({ type: "heredoc", id: m[2]!, bodyStart: i });
      }
    } else if (c === "{") {
      const before = source.slice(Math.max(0, i - 256), i);
      const prev = source[i - 1];
      if (prev === "$" || before.endsWith("->") || before.endsWith("::")) stack.push(ACCESS);
      else if ((prev === "}" && indexable.has(i - 1)) || isOffsetBase(before)) {
        stack.push(i);
        rewrites.push({ construct: "brace-offset", position: { line, column: i - lineStart } });
      } else stack.push(BLOCK);
      advanceTo(i + 1);
    } else if (c === "}") {
      const open = stack.pop();
      if (open !== undefined && open >= 0) {
        out[open] = "[";
        out[i] = "]";
        indexable.add(i);
      } else if (open === ACCESS) indexable.add(i);
      else if (open === INTERP && top?.type === "interp") ctx.pop();
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

/** A string being read: quoted (`"`, `` ` ``), a heredoc body, or a `{$…}` segment of one, which is code. */
type Context = { type: "quoted"; quote: string } | { type: "heredoc"; id: string; bodyStart: number } | { type: "interp" };

const BLOCK = -1;
const INTERP = -2;
const ACCESS = -3;

/** A property declaration ending in its name (`public $name {`, a PHP 8.4 hook), never an offset. */
const PROPERTY_DECLARATION = /\b(?:public|protected|private|var|readonly|static)\b[^;{}()=]*\$[\w\x80-\uffff]+\s*$/;

/** Whether the code before a `{` ends in what an offset applies to: a variable, `]` or a property, with or without spaces between. */
function isOffsetBase(before: string): boolean {
  if (OFFSET_BASE_END.test(before)) return !before.endsWith("$");
  const trimmed = before.trimEnd();
  if (trimmed.length === before.length || !/[ \t]$/.test(before)) return false;
  return OFFSET_BASE_END.test(trimmed) && !PROPERTY_DECLARATION.test(before);
}

/** The index of a position in `source`. */
function lineOffset(source: string, position: SourcePosition): number {
  let index = 0;
  for (let l = 1; l < position.line; l++) index = source.indexOf("\n", index) + 1;
  return index + position.column;
}
