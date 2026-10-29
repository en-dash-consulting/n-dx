/**
 * PR checks: which failed, the tail of each failure's log, and why it failed.
 *
 * Pure functions over `gh pr view --json statusCheckRollup` output and
 * `gh run view --log-failed` text. Every class comes from a fixed rule, so the
 * same inputs always give the same class and no model is asked.
 *
 * @module web/server/branch-health/checks
 */

import type { CheckFailureClass, StackLayer } from "./types.js";

/** The tail kept from a failed log: whichever cap bites first. */
export const LOG_TAIL_MAX_LINES = 80;
export const LOG_TAIL_MAX_CHARS = 8_000;

/** One `statusCheckRollup` entry, normalised across CheckRun and StatusContext. */
export interface RollupCheck {
  name: string;
  /** `SUCCESS`, `FAILURE`, `PENDING`, … — the conclusion, else the status or state. */
  outcome: string;
  url: string | null;
  /** The Actions run and job ids, when the check is a GitHub Actions job. */
  runId: string | null;
  jobId: string | null;
}

const FAILING = new Set(["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PENDING = new Set(["PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"]);

export function isFailing(check: RollupCheck): boolean {
  return FAILING.has(check.outcome);
}

export function isPending(check: RollupCheck): boolean {
  return PENDING.has(check.outcome);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Normalise the rollup array; entries that are not objects are dropped. */
export function parseRollup(rollup: unknown): RollupCheck[] {
  if (!Array.isArray(rollup)) return [];
  const checks: RollupCheck[] = [];
  for (const entry of rollup) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    // CheckRun: name, status, conclusion, detailsUrl. StatusContext: context, state, targetUrl.
    const name = str(e.name) ?? str(e.context) ?? "unnamed check";
    const outcome = (str(e.conclusion) ?? str(e.state) ?? str(e.status) ?? "PENDING").toUpperCase();
    const url = str(e.detailsUrl) ?? str(e.targetUrl);
    const ids = url ? /\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/.exec(url) : null;
    checks.push({ name, outcome, url, runId: ids?.[1] ?? null, jobId: ids?.[2] ?? null });
  }
  return checks;
}

// CSI sequences (colours, cursor moves). Test runners colour their output on
// GitHub Actions because `CI` is set, and a colour code between `FAIL` and the
// path would hide the failing file from the classifier.
const ESC = String.fromCharCode(0x1b);
const ANSI_CSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
// `gh run view --log-failed` starts every line with "<job>\t<step>\t<timestamp> ".
const GH_LINE_PREFIX = /^[^\t\n]*\t[^\t\n]*\t\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/gm;

/** A failed log without colour codes or gh's per-line job, step and timestamp prefix. */
export function cleanLog(log: string): string {
  return log.replace(ANSI_CSI, "").replace(GH_LINE_PREFIX, "");
}

/**
 * The last {@link LOG_TAIL_MAX_LINES} lines of the cleaned log, then the last
 * {@link LOG_TAIL_MAX_CHARS} characters of those. Only what is stored and
 * shown is capped; the classifier reads the whole log.
 */
export function capLogTail(log: string): string {
  const lines = cleanLog(log).replace(/\n+$/, "").split("\n");
  const tail = lines.slice(-LOG_TAIL_MAX_LINES).join("\n");
  return tail.length > LOG_TAIL_MAX_CHARS ? tail.slice(-LOG_TAIL_MAX_CHARS) : tail;
}

/** What the classifier knows about one failing check. */
export interface CheckClassInput {
  name: string;
  outcome: string;
  /** The whole failed log, not the capped tail; null when the check has no Actions log. */
  log: string | null;
  isCrossRepository: boolean;
  /** Repo-relative paths this branch changed against its base. */
  changedFiles: readonly string[];
  /** The PR's `mergeStateStatus`; `BEHIND` means its base has commits the branch lacks. */
  mergeStateStatus?: string | null;
  /** The layers below this branch; one not contained has commits the branch lacks. */
  stack?: readonly StackLayer[];
}

const BEHIND_BASE = /\b(?:out of date with|is behind|not up to date with|behind (?:the )?base|must be rebased|needs? (?:a )?rebase)\b/i;
const POLICY_TEST = /\b((?:architecture-policy|domain-isolation|instruction-alignment|boundary-check|agents-md-size-budget|[\w-]+-policy)\.test\.[cm]?[jt]s)\b/;
const CODEQL = /\bcodeql\b|\bcode scanning\b/i;
// Vitest's `FAIL  path > suite > case`, and the ×/✗/❯ markers of its failed-file lines.
const FAILED_TEST_FILE = /(?:\bFAIL\b|[×✗❯])\s+(\S+?\.(?:test|spec)\.[cm]?[jt]sx?)\b/g;
// `pnpm -r run` prefixes each package's output with its directory: "packages/p test: ".
const PNPM_PACKAGE_PREFIX = /^\s*([\w@.-]+(?:\/[\w@.-]+)*) [\w:-]+: /;

/** One failing test file, and the package directory whose runner reported it when the log says. */
export interface FailedTestFile {
  file: string;
  packageDir: string | null;
}

/** Failing test files with their reporting package, in order of first mention. */
export function failedTestFileRefs(log: string): FailedTestFile[] {
  const found = new Map<string, FailedTestFile>();
  for (const line of cleanLog(log).split("\n")) {
    const packageDir = PNPM_PACKAGE_PREFIX.exec(line)?.[1] ?? null;
    for (const match of line.matchAll(FAILED_TEST_FILE)) {
      // Windows runners print backslashes.
      const file = match[1].replace(/\\/g, "/").replace(/^\.\//, "");
      found.set(`${packageDir ?? ""}\0${file}`, { file, packageDir });
    }
  }
  return [...found.values()];
}

/** Test files a log reports as failing, in order of first mention. */
export function failedTestFiles(log: string): string[] {
  return [...new Set(failedTestFileRefs(log).map((ref) => ref.file))];
}

/**
 * The changed path a failing test file names. A package-level runner prints
 * paths relative to its package, so inside `packages/p` the file
 * `tests/x.test.ts` is `packages/p/tests/x.test.ts`. When the log names the
 * package, only that package's copy matches; otherwise any path ending in it.
 */
function touchedPath(ref: FailedTestFile, changed: readonly string[]): string | undefined {
  if (ref.packageDir) {
    const inPackage = `${ref.packageDir}/${ref.file}`;
    return changed.find((path) => path === inPackage || path === ref.file);
  }
  return changed.find((path) => path === ref.file || path.endsWith(`/${ref.file}`));
}

/** The PR's merge state or the stack saying the branch lacks its base's commits, or null. */
function behindFact(input: CheckClassInput): string | null {
  if (input.mergeStateStatus === "BEHIND") {
    return "The PR's merge state is BEHIND: its base has commits this branch lacks.";
  }
  const missing = (input.stack ?? []).filter((layer) => !layer.contained).map((layer) => layer.branch);
  if (missing.length === 1) return `Stack layer ${missing[0]} is not contained: it has commits this branch lacks.`;
  if (missing.length > 1) return `Stack layers ${missing.join(", ")} are not contained: they have commits this branch lacks.`;
  return null;
}

/**
 * Classify a failing check. The first matching rule wins:
 *
 * 1. **fork-no-ci** — the PR is from a fork and the check left no Actions log,
 *    or GitHub is waiting for a maintainer to approve the workflows.
 * 2. **codeql** — a CodeQL or code-scanning check.
 * 3. **behind-base** — the log or name says the branch is out of date with its base.
 * 4. **policy-test** — the log names one of the repository's policy suites.
 * 5. **touched-test** — the log names a failing test file this branch changed.
 * 6. **behind-base** — the PR's merge state is `BEHIND`, or a stack layer is
 *    not contained. Ranked below the log's own evidence: being behind is
 *    circumstance, and a branch that broke its own test is told so.
 * 7. **unclassified** — none of the above.
 */
export function classifyFailingCheck(input: CheckClassInput): { class: CheckFailureClass; evidence: string } {
  const log = cleanLog(input.log ?? "");
  if (input.isCrossRepository && (input.log === null || input.outcome === "ACTION_REQUIRED")) {
    return {
      class: "fork-no-ci",
      evidence: input.outcome === "ACTION_REQUIRED"
        ? "The PR comes from a fork and its workflows wait for a maintainer's approval."
        : "The PR comes from a fork and the check left no Actions log.",
    };
  }
  if (CODEQL.test(input.name)) {
    return { class: "codeql", evidence: `"${input.name}" is a code-scanning check.` };
  }
  const behind = BEHIND_BASE.exec(log) ?? BEHIND_BASE.exec(input.name) ?? /up[- ]to[- ]date/i.exec(input.name);
  if (behind) {
    return { class: "behind-base", evidence: `The check reports "${behind[0]}".` };
  }
  const policy = POLICY_TEST.exec(log);
  if (policy) {
    return { class: "policy-test", evidence: `The policy suite ${policy[1]} failed.` };
  }
  const changed = input.changedFiles;
  for (const ref of failedTestFileRefs(log)) {
    const touched = touchedPath(ref, changed);
    if (touched) {
      return { class: "touched-test", evidence: `${touched} failed, and this branch changed it.` };
    }
  }
  // Circumstantial: the branch lacks commits its base has. It explains a
  // failure only when the log points nowhere more specific.
  const lacking = behindFact(input);
  if (lacking) return { class: "behind-base", evidence: lacking };
  return { class: "unclassified", evidence: "No rule matched the check's name or log." };
}
