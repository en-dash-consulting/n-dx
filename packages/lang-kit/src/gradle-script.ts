/**
 * A conservative structural scanner for Gradle build scripts (Groovy and
 * Kotlin DSL). It does not parse either language: it masks comments and string
 * contents so brackets and newlines can be trusted, then splits a script into
 * statements and `name { … }` blocks. Callers read literals from the original
 * text at the same offsets. Anything the scanner cannot place is left alone.
 *
 * Gradle is never run, and no Groovy or Kotlin grammar is used: those grammars would need their own pinned source archives and
 * checksums, and a build script is read for a handful of literal shapes.
 *
 * @module lang-kit/gradle-script
 */

/** Half-open range into the script text. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Placeholder for the characters inside a string, so only literal structure remains. */
const FILL = "_";

/** `src` with comments blanked (newlines kept) and string contents replaced by `_`; same length. */
function mask(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(" ");
        i++;
      }
    } else if (c === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close < 0 ? src.length : close + 2;
      for (; i < end; i++) out.push(src[i] === "\n" ? "\n" : " ");
    } else if (c === '"' || c === "'") {
      i = maskString(src, i, out);
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join("");
}

/** Mask the string starting at `from` into `out`; returns the index after it. */
function maskString(src: string, from: number, out: string[]): number {
  const quote = src[from];
  const triple = src.startsWith(quote.repeat(3), from);
  const delim = triple ? quote.repeat(3) : quote;
  out.push(delim);
  let i = from + delim.length;
  while (i < src.length) {
    if (src.startsWith(delim, i)) {
      out.push(delim);
      return i + delim.length;
    }
    if (src[i] === "\\" && !triple && i + 1 < src.length) {
      out.push(FILL, FILL);
      i += 2;
      continue;
    }
    if (src[i] === "\n" && !triple) break; // an unterminated string ends at the line
    out.push(FILL);
    i++;
  }
  return i;
}

const OPEN = "([{";
const CLOSE = ")]}";
/**
 * A line ending in one of these continues on the next: a comma or a binary
 * operator. Not `*` (`import a.b.*` ends a line) or `/` and `%`, which build
 * scripts do not break lines on; `&` and `|` count only doubled.
 */
const CONTINUING = ",+-=?";
const CONTINUING_DOUBLED = "&|";

export class GradleScript {
  /** Structure-only view: comments blanked, string contents filled. */
  readonly masked: string;
  /** The script with comments blanked and strings intact; literals are read from here. */
  private readonly code: string;

  constructor(src: string) {
    this.masked = mask(src);
    // Only comments are blanked to a space in `masked` where `src` has something else.
    this.code = src
      .split("")
      .map((c, i) => (this.masked[i] === " " && c !== " " ? " " : c))
      .join("");
  }

  /** Whole-script span. */
  get all(): Span {
    return { start: 0, end: this.code.length };
  }

  /** Text of a span without comments, trimmed. */
  text(span: Span): string {
    return this.code.slice(span.start, span.end).trim();
  }

  /**
   * The statements directly inside `within`: split at newlines and `;` outside
   * any bracket. As in Groovy, a line continues the previous statement when it
   * begins with `.` or the previous line ends in `,` or a binary operator.
   */
  statements(within: Span = this.all): Span[] {
    const out: Span[] = [];
    let depth = 0;
    let start = within.start;
    const flush = (end: number): void => {
      const span = this.trim({ start, end });
      if (span.end > span.start) out.push(span);
    };
    for (let i = within.start; i < within.end; i++) {
      const c = this.masked[i];
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) depth = Math.max(0, depth - 1);
      else if (depth === 0 && (c === ";" || (c === "\n" && !this.endsOpen(start, i) && !this.continues(i + 1, within.end)))) {
        flush(i);
        start = i + 1;
      }
    }
    flush(within.end);
    return out;
  }

  /**
   * Does the statement text in [`start`, `end`) end in `,` or a binary operator
   * (not `++` or `--`), so the next line continues it? Comments are already
   * blank, so a trailing comment does not hide the comma.
   */
  private endsOpen(start: number, end: number): boolean {
    let i = end - 1;
    while (i >= start && /\s/.test(this.masked[i])) i--;
    if (i < start) return false;
    const c = this.masked[i];
    const doubled = i > start && this.masked[i - 1] === c;
    if (CONTINUING_DOUBLED.includes(c)) return doubled;
    return CONTINUING.includes(c) && !((c === "+" || c === "-") && doubled);
  }

  /** Does the line starting at `from` open with `.`, continuing the statement before it? */
  private continues(from: number, end: number): boolean {
    let i = from;
    while (i < end && /\s/.test(this.masked[i])) i++;
    return this.masked[i] === ".";
  }

  /** The identifier a statement starts with, or "". */
  head(span: Span): string {
    return /^[A-Za-z_]\w*/.exec(this.masked.slice(span.start, span.end))?.[0] ?? "";
  }

  /** Statements inside `name { … }` when `span` is such a block statement (`name`, optional `(args)`, then `{`). */
  block(span: Span, name: string): Span | undefined {
    if (this.head(span) !== name) return undefined;
    let i = span.start + name.length;
    while (i < span.end && /\s/.test(this.masked[i])) i++;
    if (this.masked[i] === "(") {
      const close = this.matching(i);
      if (close < 0) return undefined;
      i = close + 1;
      while (i < span.end && /\s/.test(this.masked[i])) i++;
    }
    if (this.masked[i] !== "{") return undefined;
    const close = this.matching(i);
    return close < 0 || close >= span.end ? undefined : { start: i + 1, end: close };
  }

  /** Bodies of every `name { … }` statement directly inside `within`, in order. */
  blocks(name: string, within: Span = this.all): Span[] {
    const out: Span[] = [];
    for (const s of this.statements(within)) {
      const body = this.block(s, name);
      if (body) out.push(body);
    }
    return out;
  }

  /** Top-level call arguments of the parenthesised group opening at `open`, as spans. */
  arguments(open: number): Span[] | undefined {
    const close = this.matching(open);
    return close < 0 ? undefined : this.split({ start: open + 1, end: close });
  }

  /** `span` split at commas outside any bracket; empty parts are dropped. */
  split(span: Span): Span[] {
    const out: Span[] = [];
    let depth = 0;
    let start = span.start;
    for (let i = span.start; i < span.end; i++) {
      const c = this.masked[i];
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c)) depth--;
      else if (c === "," && depth === 0) {
        out.push(this.trim({ start, end: i }));
        start = i + 1;
      }
    }
    out.push(this.trim({ start, end: span.end }));
    return out.filter((s) => s.end > s.start);
  }

  /** Index of the bracket closing the one at `open`, or -1. */
  matching(open: number): number {
    let depth = 0;
    for (let i = open; i < this.masked.length; i++) {
      const c = this.masked[i];
      if (OPEN.includes(c)) depth++;
      else if (CLOSE.includes(c) && --depth === 0) return i;
    }
    return -1;
  }

  private trim(span: Span): Span {
    let { start, end } = span;
    while (start < end && /\s/.test(this.masked[start])) start++;
    while (end > start && /\s/.test(this.masked[end - 1])) end--;
    return { start, end };
  }
}

/**
 * A string literal expression: its text, and whether it interpolates (`$name`
 * or `${…}` in a double-quoted string, which is computed at build time).
 * Undefined when `expr` is not exactly one string literal.
 */
export function stringLiteral(expr: string): { value: string; interpolated: boolean } | undefined {
  const m = /^(?:"""([\s\S]*)"""|'''([\s\S]*)'''|"([^"\n]*)"|'([^'\n]*)')$/.exec(expr.trim());
  if (!m) return undefined;
  const double = m[1] ?? m[3];
  if (double !== undefined) return { value: double, interpolated: double.includes("$") };
  return { value: m[2] ?? m[4], interpolated: false };
}

/** The string literal an expression starts with, ignoring what follows (a trailing closure, say). */
export function leadingStringLiteral(expr: string): string | undefined {
  return /^(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*')/.exec(expr.trim())?.[0];
}
