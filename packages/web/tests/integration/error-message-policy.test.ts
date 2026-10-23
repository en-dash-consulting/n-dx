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
 *     value — `String(err)`, `String(e as Error)`, a template `${err}`,
 *     `err.toString()`, with or without a `?? "fallback"`, `|| ""` or
 *     `as Error` tail and a parenthesised `(err as Error)` subject —
 *     reads its `.stack` (`${err.stack}`, `err.stack ?? ""`), or
 *     hand-rolls the `x instanceof Error ? x.message : String(x)`
 *     ternary. "The caught value" is any identifier spelled like one
 *     (`e`, `err`, `error`, `cause`, `exc`, anything ending in
 *     `err`/`Error` such as `parseErr` — but not `stderr`, `isError`,
 *     `hasError` or `lastError`, which name something else) plus every
 *     name the file's own `catch (name)` clauses bind, so `String(count)`
 *     or `${stderr}` in a response body stays ordinary formatting.
 *  2. That ternary appears nowhere in the directory, on one line or wrapped
 *     over several, because it also feeds the status objects (self-heal,
 *     init, refresh, task execution) that a later GET serves verbatim,
 *     where rule 1 cannot see it.
 *
 * A ternary with a literal fallback (`err instanceof Error ? err.message :
 * "Invalid request body"`) is left alone: it already reads `.message` by
 * name and never stringifies the value.
 *
 * The detector self-tests plant each forbidden spelling in a probe file
 * under a temporary directory, assert the same scan the real tree gets
 * names it, and remove the directory again — so a spelling the policy
 * forbids is one the detector is known to see (stack #855's reviews found
 * `String(e as Error)`, `${err}` and the wrapped ternary slipping past).
 *
 * @see packages/web/tests/integration/boundary-check.test.ts — the same
 *   walk over `src/`, for import boundaries
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

/** An identifier, as `String(`, `${` or `.toString()` would receive it. */
const IDENT = String.raw`[A-Za-z_$][\w$]*`;

/**
 * What may follow the identifier before the closer: nothing, or a
 * `?? "unknown"`, `|| ""` or `as Error` tail that wraps the value without
 * changing what reaches the response. The tail stops at any bracket, so a
 * nested call or template is not read through.
 */
const TAIL = String.raw`(?:\s*(?:\?\?|\|\||as\b)[^(){}]*)?`;

/**
 * The value a spelling receives: a bare identifier with an optional tail
 * (`err`, `err ?? "x"`, `e as Error`) or the same in parentheses
 * (`(err as Error)`). The identifier is group 1 (parenthesised) or group 2
 * (bare); `stringifiedNames` takes whichever matched.
 */
const SUBJECT = String.raw`(?:\(\s*(${IDENT})${TAIL}\s*\)|(${IDENT})${TAIL})`;

/** `String(x)`, `String(x as Error)`, `String(x ?? "")`, `String((x as Error))`. */
const STRINGIFIED = new RegExp(String.raw`(?<![\w$.])String\(\s*${SUBJECT}\s*\)`, "g");

/** A template literal's `${x}`, `${x as Error}`, `${x ?? "unknown"}`, `${(x as Error)}`. */
const INTERPOLATED = new RegExp(String.raw`\$\{\s*${SUBJECT}\s*\}`, "g");

/** `x.toString()` and `(x as Error).toString()`. `a.x.toString()` reads a field, not the caught value. */
const TO_STRING = new RegExp(String.raw`(?<![\w$.])${SUBJECT}\.toString\(\)`, "g");

/**
 * `x.stack` and `(x as Error).stack` — the one read that is the exposure
 * itself, not a stand-in for it. `a.x.stack` reads a field, not the caught
 * value.
 */
const STACK_READ = new RegExp(String.raw`(?<![\w$.])${SUBJECT}\.stack\b`, "g");

/**
 * The hand-rolled ternary `errorMessage()` replaces, with `\s*` at every
 * seam so a copy wrapped over several lines reads the same as one line.
 * The fallback may be `String(x)` or `x.toString()`; the subject may be
 * cast, `(e as Error).message`.
 */
const MESSAGE_TERNARY = new RegExp(
  String.raw`\binstanceof\s+Error\s*\?\s*(?:${IDENT}|\(\s*${IDENT}\s+as\s+Error\s*\))\.message\s*:\s*(?:String\(|${IDENT}\.toString\()`,
  "g",
);

/**
 * Whether `name` is spelled like a caught value: the three conventional
 * names, `cause` and `exc`, or anything ending in `err`/`Err`/`error`/`Error`
 * (`parseErr`, `fetchError`). `count`, `taskId` or `value` is not, so a
 * response body that formats one of those is left alone — nor are the
 * names that end that way but hold something else: a process's `stderr`,
 * an `isError`/`hasError` flag, a `lastError` slot.
 */
export function isCaughtValueName(name: string): boolean {
  return /^(?!(?:stderr|stdErr|isError|hasError|lastError)$)(?:e|err|error|cause|exc|\w*[Ee]rr(?:or)?)$/.test(name);
}

/** Every name the file's `catch (name)` clauses bind, however it is spelled. */
export function catchBoundNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(new RegExp(String.raw`\bcatch\s*\(\s*(${IDENT})`, "g"))) names.add(match[1]);
  return names;
}

/** The identifiers `text` stringifies, by any of the three spellings, or whose `.stack` it reads. */
export function stringifiedNames(text: string): string[] {
  return [STRINGIFIED, INTERPOLATED, TO_STRING, STACK_READ].flatMap((re) =>
    [...text.matchAll(re)].map((match) => match[1] ?? match[2]),
  );
}

/** The 1-based line of `source` that offset `index` falls on. */
const lineAt = (source: string, index: number): number => source.slice(0, index).split("\n").length;

/**
 * The argument text of every `errorResponse(` / `jsonResponse(` call in
 * `source`, with the 1-based line the call starts on.
 *
 * Parentheses are balanced by hand so a call split over several lines is
 * read whole. String literals are not understood: a `)` inside one closes
 * the slice early and hides whatever follows it in the call, and an
 * unbalanced `(` runs the slice on past the call. Neither occurs in the
 * tree today; the probe rows plant the spellings this must see, so a
 * message that grows a bracket would show up there before it hid anything.
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
      line: lineAt(source, match.index),
      args: source.slice(start, depth === 0 ? i - 1 : i),
    });
  }
  return calls;
}

/** `file:line` for every response call in `source` whose argument fails rule 1. */
export function offendingResponseCalls(file: string, source: string): string[] {
  const bound = catchBoundNames(source);
  const isCaught = (name: string): boolean => isCaughtValueName(name) || bound.has(name);
  return responseCallArguments(source)
    .filter(({ args }) => stringifiedNames(args).some(isCaught) || [...args.matchAll(MESSAGE_TERNARY)].length > 0)
    .map(({ line }) => `${file}:${line}`);
}

/** `file:line` for every ternary in `source` (rule 2), on the line it starts. */
export function offendingTernaries(file: string, source: string): string[] {
  return [...source.matchAll(MESSAGE_TERNARY)].map((match) => `${file}:${lineAt(source, match.index)}`);
}

/** Both rules over every `.ts` file under `dir`, paths relative to it. */
export function scanTree(dir: string): { files: string[]; responseCalls: string[]; ternaries: string[] } {
  const files = collectTsFiles(dir).map((full) => ({
    rel: relative(dir, full).split(sep).join("/"),
    source: readFileSync(full, "utf-8"),
  }));
  return {
    files: files.map((f) => f.rel),
    responseCalls: files.flatMap(({ rel, source }) => offendingResponseCalls(rel, source)),
    ternaries: files.flatMap(({ rel, source }) => offendingTernaries(rel, source)),
  };
}

describe("error-message policy (src/server)", () => {
  const tree = scanTree(SERVER_SRC);

  it("scans the route files", () => {
    expect(tree.files).toContain("response-utils.ts");
    expect(tree.files).toContain("routes-commands.ts");
    expect(tree.files).toContain("routes-rex/items.ts");
  });

  it("no errorResponse/jsonResponse argument stringifies the caught value", () => {
    expect(
      tree.responseCalls,
      "pass the caught value through errorMessage() from response-utils.ts",
    ).toEqual([]);
  });

  it("no file hand-rolls the `instanceof Error ? .message : String()` ternary", () => {
    expect(
      tree.ternaries,
      "errorMessage() from response-utils.ts is that ternary; use it so a served status field reads the same",
    ).toEqual([]);
  });
});

describe("error-message policy detector", () => {
  it("flags the stringified value and the ternary, on one line or several", () => {
    const source = [
      "errorResponse(res, 500, String(err));",
      "errorResponse(res, 500, `Failed: ${err instanceof Error ? err.message : String(err)}`);",
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
      "errorResponse(res, 500, `Failed to save: ${errorMessage(err)}`);",
      'errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");',
      'jsonResponse(res, 200, { error: "Self-heal is already running" });',
      "errorResponse(res, 500, err.message);",
    ].join("\n");
    expect(offendingResponseCalls("x.ts", source)).toEqual([]);
    expect(offendingTernaries("x.ts", source)).toEqual([]);
  });

  it("leaves a response that formats a value other than the caught one alone", () => {
    const source = [
      "jsonResponse(res, 200, { total: String(count), label: `${items.length} items`, id: taskId.toString() });",
      "errorResponse(res, 404, `No task ${id}`);",
      "jsonResponse(res, 200, { ok: true, port: String(port), elapsed: `${elapsedMs}ms`, mode: value.toString() });",
      "errorResponse(res, 400, `Unknown field ${String(field)}`);",
      'jsonResponse(res, 200, { ok: false, stderr: `${stderr}`, retries: `${count ?? 0}`, note: String(label ?? "") });',
      "jsonResponse(res, 200, { frames: trace.stack, failed: `${hasError}` });",
    ].join("\n");
    expect(offendingResponseCalls("x.ts", source)).toEqual([]);
  });

  it("sees the caught value through a fallback, a cast in parentheses, and a .stack read", () => {
    const source = [
      'errorResponse(res, 500, `${err ?? "unknown"}`);',
      'errorResponse(res, 500, String(err ?? ""));',
      "errorResponse(res, 500, `${(err as Error)}`);",
      "errorResponse(res, 500, `${err.stack}`);",
      'errorResponse(res, 500, err.stack ?? "");',
      "jsonResponse(res, 500, { error: (e as Error).toString() });",
    ].join("\n");
    expect(offendingResponseCalls("x.ts", source)).toEqual(["x.ts:1", "x.ts:2", "x.ts:3", "x.ts:4", "x.ts:5", "x.ts:6"]);
  });

  it("names the stringified value whichever way the spelling wraps it", () => {
    expect(stringifiedNames('`${err ?? "unknown"}` String(e || "") ${(cause as Error)} err.stack (exc as Error).toString()'))
      .toEqual(["e", "err", "cause", "exc", "err"]);
  });

  it("finds the ternary on a status field no response call wraps", () => {
    const source = [
      "slot.state.status = 'failed';",
      "slot.state.error = err instanceof Error ? err.message : String(err);",
    ].join("\n");
    expect(offendingTernaries("x.ts", source)).toEqual(["x.ts:2"]);
  });

  it("knows a caught value by its name", () => {
    for (const name of ["e", "err", "error", "cause", "exc", "parseErr", "fetchError", "Err", "innerError"]) {
      expect(isCaughtValueName(name), name).toBe(true);
    }
    for (const name of [
      "count", "taskId", "value", "errorCount", "errors", "field", "elapsedMs", "port",
      "stderr", "stdErr", "isError", "hasError", "lastError",
    ]) {
      expect(isCaughtValueName(name), name).toBe(false);
    }
    // The same name rule decides a response argument: `${stderr}` is a
    // process's output, `${err}` is the caught value.
    expect(offendingResponseCalls("x.ts", "jsonResponse(res, 500, { output: `${stderr}` });")).toEqual([]);
    expect(offendingResponseCalls("x.ts", "jsonResponse(res, 500, { output: `${err}` });")).toEqual(["x.ts:1"]);
  });
});

// ---------------------------------------------------------------------------
// Probe files: each forbidden spelling, planted on disk and scanned the way
// the real tree is, then removed. The expected line is where the response
// call or the ternary starts.
// ---------------------------------------------------------------------------

/** [label, probe lines, 1-based line the offender is reported on]. */
type Planted = [label: string, lines: string[], line: number];

const RULE_1_SPELLINGS: Planted[] = [
  ["String(err)", ["errorResponse(res, 500, String(err));"], 1],
  ["String(e as Error)", ["errorResponse(res, 500, String(e as Error));"], 1],
  ["String(error as unknown as string)", ["errorResponse(res, 500, String(error as unknown as string));"], 1],
  ["a template `${err}`", ["errorResponse(res, 500, `Failed: ${err}`);"], 1],
  ["a template `${e}`", ["errorResponse(res, 500, `Build failed: ${e}`);"], 1],
  ["a template `${error}`", ["jsonResponse(res, 200, { ok: false, error: `${error}` });"], 1],
  ["a template `${e as Error}`", ["errorResponse(res, 500, `${e as Error}`);"], 1],
  ["err.toString()", ["errorResponse(res, 500, err.toString());"], 1],
  ["e.toString() inside a body object", ["jsonResponse(res, 200, { error: e.toString() });"], 1],
  ["String(cause)", ["errorResponse(res, 500, String(cause));"], 1],
  ["String(exc)", ["errorResponse(res, 500, String(exc));"], 1],
  ["a template `${cause}`", ["errorResponse(res, 500, `Refused: ${cause}`);"], 1],
  ["exc.toString()", ["errorResponse(res, 500, exc.toString());"], 1],
  ["String(parseErr) — a name ending in Err", ["errorResponse(res, 400, String(parseErr));"], 1],
  ["String(fetchError) — a name ending in Error", ["errorResponse(res, 502, String(fetchError));"], 1],
  ["a template `${innerError}`", ["errorResponse(res, 500, `Inner: ${innerError}`);"], 1],
  ["a template `${err.stack}`", ["errorResponse(res, 500, `${err.stack}`);"], 1],
  ['err.stack ?? ""', ['errorResponse(res, 500, err.stack ?? "");'], 1],
  ["(e as Error).stack inside a body object", ["jsonResponse(res, 500, { error: (e as Error).stack });"], 1],
  ['a template `${err ?? "unknown"}`', ['errorResponse(res, 500, `${err ?? "unknown"}`);'], 1],
  ['String(err ?? "")', ['errorResponse(res, 500, String(err ?? ""));'], 1],
  ['String(e || "failed")', ['errorResponse(res, 500, String(e || "failed"));'], 1],
  ["a template `${(err as Error)}`", ["errorResponse(res, 500, `${(err as Error)}`);"], 1],
  ["(err as Error).toString()", ["errorResponse(res, 500, (err as Error).toString());"], 1],
  [
    "a fallback inside a wrapped body object",
    ["jsonResponse(res, 500, {", "  ok: false,", '  error: `${error ?? "unknown"}`,', "});"],
    1,
  ],
  [
    "a catch variable of any spelling the file binds",
    ["try {", "  run();", "} catch (oops) {", "  errorResponse(res, 500, String(oops));", "}"],
    4,
  ],
  [
    "a bound catch variable interpolated in a body object",
    ["try {", "  run();", "} catch (problem) {", "  jsonResponse(res, 500, { error: `${problem}` });", "}"],
    4,
  ],
  [
    "the ternary wrapped across lines inside the call",
    [
      "errorResponse(",
      "  res,",
      "  500,",
      "  err instanceof Error",
      "    ? err.message",
      "    : String(err),",
      ");",
    ],
    1,
  ],
  [
    "the ternary with a .toString() fallback",
    ["errorResponse(res, 500, err instanceof Error ? err.message : err.toString());"],
    1,
  ],
];

const RULE_2_SPELLINGS: Planted[] = [
  ["the ternary on one line", ["slot.state.error = err instanceof Error ? err.message : String(err);"], 1],
  [
    "the ternary wrapped across lines",
    ["const status = {", "  error: err instanceof Error", "    ? err.message", "    : String(err),", "};"],
    2,
  ],
  [
    "the ternary wrapped before the colon",
    ["state.error = e instanceof Error ? e.message", "  : String(e);"],
    1,
  ],
  ["the ternary with a .toString() fallback", ["state.error = cause instanceof Error ? cause.message : cause.toString();"], 1],
  ["the ternary over a cast subject", ["state.error = e instanceof Error ? (e as Error).message : String(e);"], 1],
  ["the ternary with `instanceof` and `Error` split by a line break", ["state.error = err instanceof", "  Error ? err.message : String(err);"], 1],
];

describe("error-message policy detector — planted probe files", () => {
  let probeDir: string;

  beforeEach(async () => {
    probeDir = await mkdtemp(join(tmpdir(), "ndx-error-message-policy-"));
  });

  afterEach(async () => {
    await rm(probeDir, { recursive: true, force: true });
  });

  async function plant(name: string, lines: string[]): Promise<void> {
    await writeFile(join(probeDir, name), `${lines.join("\n")}\n`, "utf-8");
  }

  it.each(RULE_1_SPELLINGS)("rule 1 fails a probe file carrying %s", async (_label, lines, line) => {
    await plant("probe.ts", lines);
    expect(scanTree(probeDir).responseCalls).toEqual([`probe.ts:${line}`]);
  });

  it.each(RULE_2_SPELLINGS)("rule 2 fails a probe file carrying %s", async (_label, lines, line) => {
    await plant("probe.ts", lines);
    expect(scanTree(probeDir).ternaries).toEqual([`probe.ts:${line}`]);
  });

  it("reports a probe in a nested directory by its relative path, like the real tree", async () => {
    await mkdir(join(probeDir, "routes-rex"));
    await plant(join("routes-rex", "items.ts"), ["errorResponse(res, 500, `${err}`);"]);
    expect(scanTree(probeDir).responseCalls).toEqual(["routes-rex/items.ts:1"]);
  });

  it("passes a probe file that answers through errorMessage() and formats its own values", async () => {
    await plant("clean.ts", [
      "try {",
      "  run();",
      "} catch (err) {",
      "  errorResponse(res, 500, `Failed to run: ${errorMessage(err)}`);",
      "}",
      "jsonResponse(res, 200, { total: String(count), label: `${items.length} items`, id: taskId.toString() });",
      'errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");',
    ]);
    expect(scanTree(probeDir)).toMatchObject({ files: ["clean.ts"], responseCalls: [], ternaries: [] });
  });

  it("passes a probe file whose fallbacks and err-ish names are not the caught value", async () => {
    await plant("clean.ts", [
      "const { stdout, stderr } = await run();",
      "jsonResponse(res, 200, { ok: true, stdout: `${stdout}`, stderr: `${stderr}`, retries: `${count ?? 0}` });",
      'jsonResponse(res, 200, { label: String(name ?? ""), failed: `${hasError}`, last: `${lastError ?? "none"}` });',
      "jsonResponse(res, 200, { frames: trace.stack });",
    ]);
    expect(scanTree(probeDir)).toMatchObject({ files: ["clean.ts"], responseCalls: [], ternaries: [] });
  });
});
