/**
 * Globs over POSIX directory paths, as uv workspace `members` / `exclude`
 * write them: `*` and `?` within a segment, `**` as a whole segment for any
 * number of segments (zero included), `[…]` / `[!…]` classes with ranges.
 *
 * Matching uses no RegExp. Segments and the characters inside a segment are
 * each matched by the iterative wildcard algorithm, which keeps only the last
 * star as a backtrack point, so a match costs at most pattern × path steps
 * however the stars are arranged. An invalid class is a compile error, not a
 * throw.
 *
 * @module lang-kit/dir-glob
 */

type Token =
  | { readonly kind: "char"; readonly ch: string }
  | { readonly kind: "one" }
  | { readonly kind: "star" }
  | { readonly kind: "class"; readonly negate: boolean; readonly ranges: readonly (readonly [string, string])[] };

type Segment = "**" | readonly Token[];

export type DirGlob = { readonly match: (dir: string) => boolean } | { readonly error: string };

export function compileDirGlob(pattern: string): DirGlob {
  const segments: Segment[] = [];
  for (const part of splitPath(pattern)) {
    if (part === "**") {
      if (segments.at(-1) !== "**") segments.push("**");
      continue;
    }
    const tokens = segmentTokens(part);
    if (typeof tokens === "string") return { error: tokens };
    segments.push(tokens);
  }
  return { match: (dir) => wildcardMatch(segments, splitPath(dir), (s) => s === "**", (s, part) => s !== "**" && segmentMatch(s, part)) };
}

function splitPath(path: string): string[] {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  return trimmed === "" ? [] : trimmed.split("/");
}

/** A segment's tokens, or the reason it is invalid. */
function segmentTokens(part: string): Token[] | string {
  const tokens: Token[] = [];
  const chars = [...part];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "*") {
      if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" });
    } else if (ch === "?") tokens.push({ kind: "one" });
    else if (ch === "[") {
      const parsed = classAt(chars, i + 1);
      if (parsed === undefined) tokens.push({ kind: "char", ch });
      else if (typeof parsed === "string") return parsed;
      else {
        tokens.push(parsed.token);
        i = parsed.end;
      }
    } else tokens.push({ kind: "char", ch });
  }
  return tokens;
}

/**
 * The class opening before `start`: its token and the index of its `]`,
 * undefined when it never closes (the `[` is then literal), or the reason it
 * is invalid. The first member may be `]`.
 */
function classAt(chars: readonly string[], start: number): { token: Token; end: number } | string | undefined {
  let i = start;
  const negate = chars[i] === "!";
  if (negate) i++;
  const ranges: [string, string][] = [];
  for (let first = true; i < chars.length; first = false) {
    const ch = chars[i];
    if (ch === "]" && !first) return { token: { kind: "class", negate, ranges }, end: i };
    if (chars[i + 1] === "-" && i + 2 < chars.length && chars[i + 2] !== "]") {
      const to = chars[i + 2];
      if (to < ch) return `range ${ch}-${to} is out of order`;
      ranges.push([ch, to]);
      i += 3;
    } else {
      ranges.push([ch, ch]);
      i++;
    }
  }
  return undefined;
}

function segmentMatch(tokens: readonly Token[], part: string): boolean {
  return wildcardMatch(tokens, [...part], (t) => t.kind === "star", tokenMatch);
}

function tokenMatch(t: Token, ch: string): boolean {
  switch (t.kind) {
    case "char":
      return t.ch === ch;
    case "one":
      return true;
    case "star":
      return false;
    case "class":
      return t.ranges.some(([lo, hi]) => lo <= ch && ch <= hi) !== t.negate;
  }
}

/**
 * Whether `pattern` matches all of `input`, where a star element matches any
 * run of input elements. On a mismatch only the most recent star widens; an
 * earlier star never needs to, because whatever it could absorb the later
 * star can absorb too. O(pattern × input) element matches.
 */
function wildcardMatch<P, I>(pattern: readonly P[], input: readonly I[], isStar: (p: P) => boolean, matches: (p: P, i: I) => boolean): boolean {
  let p = 0;
  let i = 0;
  let starP = -1;
  let starI = 0;
  while (i < input.length) {
    if (p < pattern.length && isStar(pattern[p])) {
      starP = p++;
      starI = i;
    } else if (p < pattern.length && matches(pattern[p], input[i])) {
      p++;
      i++;
    } else if (starP >= 0) {
      p = starP + 1;
      i = ++starI;
    } else return false;
  }
  while (p < pattern.length && isStar(pattern[p])) p++;
  return p === pattern.length;
}
