/**
 * The failure reason a failed test gate leaves on its task, so the next
 * attempt starts from what failed instead of starting blind.
 *
 * WHY. The brief's "Previous attempt failed — do not repeat it" section is
 * filled from the task's `failureReason`, but a gate failure only printed the
 * gate output to the run log. A local model on `ndx work --loop` wrote a new
 * test that read a repository missing from the test's own config, so a value
 * was undefined and the gate failed; every retry was briefed with nothing and
 * went on changing the code under test. The reason built here names the
 * failing tests and their first error line, and says when a failing test is
 * one the task itself added or changed.
 *
 * Pure: the caller supplies the gate output and the files the run changed.
 */

/** One failing test, as far as the output names it. */
export interface GateFailure {
  /** Test file, as the runner printed it (often relative to a package). */
  file?: string;
  /** Test name: `suite > case` (vitest), `Suite › case` (jest), the node:test name. */
  name?: string;
  /** The first assertion or error line printed for it. */
  detail?: string;
}

/** SGR colour codes; vitest colours output even when piped under some CI settings. */
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

/** ` FAIL  tests/a.test.ts > suite > case`, jest's `FAIL src/a.test.js`, vitest's `|project|` prefix. */
const FAIL_HEADER = /^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S.*?)\s*$/;
/** Vitest's per-file line in the default reporter: `❯ tests/a.test.ts (3 tests | 1 failed) 12ms`. */
const VITEST_FILE_LINE = /^\s*❯\s+(\S+\.\w+)\s+\(/;
/** A failed-test marker: vitest's `×`, mocha/node spec's `✗`/`✖`, followed by the name. */
const FAILED_MARKER = /^\s*[×✗✖]\s+(.+?)\s*$/;
/** Jest's failure heading: `● Suite › case`. */
const JEST_BULLET = /^\s*●\s+(.+?)\s*$/;
/** TAP, which node:test prints by default when piped: `not ok 3 - name`. */
const TAP_NOT_OK = /^\s*not ok \d+\s*-?\s*(.+?)\s*$/;
/** node:test's `location: '/abs/file.test.js:10:3'` line under a failure. */
const NODE_LOCATION = /^\s*location:\s*'(.+?):\d+:\d+'\s*$/;
/** The line an assertion or a thrown error announces itself with. */
const ERROR_LINE = /\b[A-Z]?\w*Error\b(?:\s*\[\w+\])?:|^\s*error:\s|\bexpected\b|\bExpected\b/;
/** Lines that only end a failure block, never describe one. */
const RULE_LINE = /^\s*(⎯{3,}|-{3,}|={3,})/;
/** Timing suffixes the reporters append: `12ms`, `(1.2ms)`. */
const TIMING_SUFFIX = /\s+\(?\d+(?:\.\d+)?\s*m?s\)?$/;
/** A test file path, as opposed to a package label like `@n-dx/web`. */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|[\\/])(tests?|__tests__)[\\/].+\.[cm]?[jt]sx?$/;

/** How far below a failure heading its error line is looked for. */
const DETAIL_LOOKAHEAD = 15;

/** Bounds of the reason, so a gate that fails a hundred tests does not swamp the brief. */
export const MAX_REASON_FAILURES = 8;
export const MAX_REASON_LINE_CHARS = 240;
export const MAX_REASON_CHARS = 2400;
export const FALLBACK_TAIL_LINES = 20;

/** The hint a failing test the task added or changed carries. */
export const NEW_TEST_HINT =
  "This test is new or changed in this task. If it fails while setting up (undefined values, missing files, " +
  "fixtures or config), the test may be wrong: fix the test rather than the code.";

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/** The first error line in `lines[from..]`, stopping at the next failure heading. */
function firstErrorLine(lines: string[], from: number): string | undefined {
  for (let j = from; j < lines.length && j < from + DETAIL_LOOKAHEAD; j++) {
    const line = lines[j];
    if (RULE_LINE.test(line)) {
      // A rule right under the heading opens the block; one further down closes it.
      if (j > from) break;
      continue;
    }
    if (j > from && (FAIL_HEADER.test(line) || JEST_BULLET.test(line) || TAP_NOT_OK.test(line))) break;
    if (ERROR_LINE.test(line)) return line.trim();
  }
  return undefined;
}

/**
 * Split vitest's `file > suite > case` heading. Anything without ` > ` is a
 * bare file (jest prints the file alone) or a package label from a run-all
 * summary, which names no test and is dropped.
 */
function parseFailHeader(rest: string): GateFailure | undefined {
  const cleaned = rest.replace(TIMING_SUFFIX, "").trim();
  const sep = cleaned.indexOf(" > ");
  if (sep > 0) {
    return { file: cleaned.slice(0, sep).trim(), name: cleaned.slice(sep + 3).trim() };
  }
  const token = cleaned.split(/\s+/)[0];
  return TEST_FILE.test(token) ? { file: token } : undefined;
}

/**
 * The failing tests a gate's output names, with each one's first assertion or
 * error line. Recognises vitest (`FAIL file > name`, `❯ file` + `× name`),
 * jest (`FAIL file` + `● Suite › name`) and node:test (TAP `not ok` and the
 * spec reporter's `✖ name`, with `location:` for the file). Deduplicated by
 * file and name, in the order first seen; empty when nothing is recognisable.
 */
export function parseGateFailures(output: string): GateFailure[] {
  const lines = output.replace(ANSI_SGR, "").split(/\r?\n/);
  const failures: GateFailure[] = [];
  const index = new Map<string, GateFailure>();
  let currentFile: string | undefined;
  let lastNodeFailure: GateFailure | undefined;

  const add = (failure: GateFailure, at: number): GateFailure => {
    const key = `${failure.file ?? ""}\u0000${failure.name ?? ""}`;
    const existing = index.get(key);
    const detail = firstErrorLine(lines, at + 1);
    if (existing) {
      existing.detail ??= detail;
      return existing;
    }
    // A named failure for a file replaces the bare-file entry jest printed first.
    if (failure.name && failure.file) {
      const bare = index.get(`${failure.file}\u0000`);
      if (bare) {
        failures.splice(failures.indexOf(bare), 1);
        index.delete(`${failure.file}\u0000`);
      }
    }
    const entry: GateFailure = { ...failure, ...(detail ? { detail } : {}) };
    index.set(key, entry);
    failures.push(entry);
    return entry;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fileLine = VITEST_FILE_LINE.exec(line);
    if (fileLine) {
      currentFile = fileLine[1];
      continue;
    }

    const header = FAIL_HEADER.exec(line);
    if (header) {
      const parsed = parseFailHeader(header[1]);
      if (parsed) {
        if (!parsed.name) currentFile = parsed.file;
        // A bare file already covered by a named entry adds nothing.
        if (!parsed.name && failures.some((f) => f.file === parsed.file && f.name)) continue;
        add(parsed, i);
      }
      continue;
    }

    const bullet = JEST_BULLET.exec(line);
    if (bullet) {
      add({ ...(currentFile ? { file: currentFile } : {}), name: bullet[1] }, i);
      continue;
    }

    const tap = TAP_NOT_OK.exec(line);
    if (tap) {
      lastNodeFailure = add({ name: tap[1].replace(TIMING_SUFFIX, "") }, i);
      continue;
    }

    const marker = FAILED_MARKER.exec(line);
    if (marker) {
      const name = marker[1].replace(TIMING_SUFFIX, "").trim();
      // Node's spec reporter ends with "✖ failing tests:", a heading, not a test.
      if (/^failing tests:?$/i.test(name)) continue;
      // Vitest's `×` names a case inside the file its `❯` line announced.
      lastNodeFailure = add({ ...(currentFile && line.includes("×") ? { file: currentFile } : {}), name }, i);
      continue;
    }

    const location = NODE_LOCATION.exec(line);
    if (location && lastNodeFailure && !lastNodeFailure.file) {
      lastNodeFailure.file = location[1];
    }
  }

  return failures;
}

/**
 * Whether `testFile` (as a runner printed it) is one of `changedFiles` (repo
 * relative, from git). Runners print paths relative to the package they ran
 * in, or absolute, so either side may be a suffix of the other.
 */
export function isChangedTestFile(testFile: string, changedFiles: readonly string[]): boolean {
  const test = normalizePath(testFile);
  return changedFiles.some((changed) => {
    const c = normalizePath(changed);
    return c === test || c.endsWith(`/${test}`) || test.endsWith(`/${c}`);
  });
}

export interface GateFailureReasonInput {
  /** The gate's output: its failure digest and output tail, joined. */
  output: string;
  /** Files the run changed (`run.structuredSummary.filesChanged`). */
  filesChanged?: readonly string[];
  /** The run's own one-line error (`Test gate failed [command: …]: …`). */
  headline?: string;
  /** Applied to the finished reason; the caller passes llm-client's secret redaction. */
  redact?: (text: string) => string;
}

/**
 * The failure reason for a gate-failed run: the headline, then each failing
 * test with its first error line and, for a test in a file the run changed,
 * {@link NEW_TEST_HINT}. With no recognisable failure lines, the last
 * {@link FALLBACK_TAIL_LINES} lines of the output. Capped at
 * {@link MAX_REASON_CHARS} and redacted last.
 */
export function buildGateFailureReason(input: GateFailureReasonInput): string {
  const changed = input.filesChanged ?? [];
  // Redacted before anything is clipped, so a cut can never leave half a
  // secret the pattern no longer recognises; and again at the end.
  const redact = input.redact ?? ((text: string) => text);
  const output = redact(input.output);
  const failures = parseGateFailures(output);
  const parts: string[] = [];
  if (input.headline) parts.push(clip(redact(input.headline).trim(), MAX_REASON_LINE_CHARS));

  if (failures.length > 0) {
    const shown = failures.slice(0, MAX_REASON_FAILURES);
    parts.push(`Failing tests (${failures.length}):`);
    for (const f of shown) {
      const label = [f.file, f.name].filter(Boolean).join(" > ");
      parts.push(`- ${clip(label, MAX_REASON_LINE_CHARS)}`);
      if (f.detail) parts.push(`  ${clip(f.detail, MAX_REASON_LINE_CHARS)}`);
      if (f.file && isChangedTestFile(f.file, changed)) parts.push(`  ${NEW_TEST_HINT}`);
    }
    if (failures.length > shown.length) parts.push(`… and ${failures.length - shown.length} more`);
  } else {
    const tail = output
      .replace(ANSI_SGR, "")
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .slice(-FALLBACK_TAIL_LINES)
      .map((l) => clip(l, MAX_REASON_LINE_CHARS));
    if (tail.length > 0) parts.push(`Last ${tail.length} lines of the test gate output:`, ...tail);
  }

  let reason = parts.join("\n");
  if (reason.length > MAX_REASON_CHARS) reason = `${reason.slice(0, MAX_REASON_CHARS - 1)}…`;
  return redact(reason);
}
