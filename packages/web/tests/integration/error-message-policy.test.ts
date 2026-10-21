/**
 * Error-message policy — a caught value reaches a response only through
 * `errorMessage()`.
 *
 * `jsonResponse` in `src/server/response-utils.ts` is the one sink every
 * dashboard route answers through, so CodeQL's js/stack-trace-exposure query
 * reports every route's `catch (err) { errorResponse(res, 500, String(err)) }`
 * as a single alert on that line (alert 36 in the October 2026 triage).
 * `String(err)` on an Error is "Error: <message>", never the stack, so no
 * route ever leaked a frame — but the query cannot tell a stringified
 * exception from an interpolated one, and a later edit that writes
 * `${err}` or reads `.stack` would look identical at the sink. Reading
 * `.message` by name is the one access the query treats as safe, and
 * `errorMessage()` is where that read lives.
 *
 * Two rules, both over the source text of every file under `src/server/`:
 *
 *  1. No `errorResponse(`/`jsonResponse(` argument stringifies the caught
 *     value (`String(err)`, `String(e)`, `String(error)`) or hand-rolls the
 *     `x instanceof Error ? x.message : String(x)` ternary.
 *  2. That ternary appears nowhere in the directory, because it also feeds
 *     the status objects (self-heal, init, refresh, task execution) that a
 *     later GET serves verbatim, where rule 1 cannot see it.
 *
 * A ternary with a literal fallback (`err instanceof Error ? err.message :
 * "Invalid request body"`) is left alone: it already reads `.message` by
 * name and never stringifies the value.
 *
 * @see packages/web/tests/integration/boundary-check.test.ts — the same
 *   walk over `src/`, for import boundaries
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SERVER_SRC = join(import.meta.dirname!, "..", "..", "src", "server");

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/** `String(err)` and its common spellings. */
const STRINGIFIED_CATCH = /\bString\((?:err|e|error)\)/;

/** The hand-rolled ternary `errorMessage()` replaces. */
const MESSAGE_TERNARY = /instanceof Error\s*\?\s*\w+\.message\s*:\s*String\(/;

/**
 * The argument text of every `errorResponse(` / `jsonResponse(` call in
 * `source`, with the 1-based line the call starts on.
 *
 * Parentheses are balanced by hand so a call split over several lines is
 * read whole; a paren inside a string literal would widen the slice, which
 * can only make the check stricter.
 */
export function responseCallArguments(source: string): Array<{ line: number; args: string }> {
  const calls: Array<{ line: number; args: string }> = [];
  const re = /\b(?:errorResponse|jsonResponse)\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    calls.push({
      line: source.slice(0, match.index).split("\n").length,
      args: source.slice(start, depth === 0 ? i - 1 : i),
    });
  }
  return calls;
}

/** `file:line` for every response call in `source` whose argument fails rule 1. */
export function offendingResponseCalls(file: string, source: string): string[] {
  return responseCallArguments(source)
    .filter(({ args }) => STRINGIFIED_CATCH.test(args) || MESSAGE_TERNARY.test(args))
    .map(({ line }) => `${file}:${line}`);
}

/** `file:line` for every line of `source` that carries the ternary (rule 2). */
export function offendingTernaries(file: string, source: string): string[] {
  return source
    .split("\n")
    .map((text, index) => (MESSAGE_TERNARY.test(text) ? `${file}:${index + 1}` : null))
    .filter((hit): hit is string => hit !== null);
}

describe("error-message policy (src/server)", () => {
  const files = collectTsFiles(SERVER_SRC).map((full) => ({
    rel: relative(SERVER_SRC, full).split(sep).join("/"),
    source: readFileSync(full, "utf-8"),
  }));

  it("scans the route files", () => {
    const names = files.map((f) => f.rel);
    expect(names).toContain("response-utils.ts");
    expect(names).toContain("routes-commands.ts");
    expect(names).toContain("routes-rex/items.ts");
  });

  it("no errorResponse/jsonResponse argument stringifies the caught value", () => {
    const offenders = files.flatMap(({ rel, source }) => offendingResponseCalls(rel, source));
    expect(
      offenders,
      "pass the caught value through errorMessage() from response-utils.ts",
    ).toEqual([]);
  });

  it("no file hand-rolls the `instanceof Error ? .message : String()` ternary", () => {
    const offenders = files.flatMap(({ rel, source }) => offendingTernaries(rel, source));
    expect(
      offenders,
      "errorMessage() from response-utils.ts is that ternary; use it so a served status field reads the same",
    ).toEqual([]);
  });
});

describe("error-message policy detector", () => {
  it("flags the stringified value and the ternary, on one line or several", () => {
    const source = [
      'errorResponse(res, 500, String(err));',
      'errorResponse(res, 500, `Failed: ${err instanceof Error ? err.message : String(err)}`);',
      "errorResponse(",
      "  res,",
      "  500,",
      "  `Failed to build: ${e instanceof Error ? e.message : String(e)}`,",
      ");",
      "jsonResponse(res, 200, { error: String(error) });",
    ].join("\n");
    expect(offendingResponseCalls("x.ts", source)).toEqual(["x.ts:1", "x.ts:2", "x.ts:3", "x.ts:8"]);
  });

  it("accepts errorMessage(), a literal, and a ternary with a literal fallback", () => {
    const source = [
      "errorResponse(res, 500, errorMessage(err));",
      'errorResponse(res, 500, `Failed to save: ${errorMessage(err)}`);',
      'errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");',
      'jsonResponse(res, 200, { error: "Self-heal is already running" });',
    ].join("\n");
    expect(offendingResponseCalls("x.ts", source)).toEqual([]);
    expect(offendingTernaries("x.ts", source)).toEqual([]);
  });

  it("finds the ternary on a status field no response call wraps", () => {
    const source = [
      "slot.state.status = 'failed';",
      "slot.state.error = err instanceof Error ? err.message : String(err);",
    ].join("\n");
    expect(offendingTernaries("x.ts", source)).toEqual(["x.ts:2"]);
  });
});
