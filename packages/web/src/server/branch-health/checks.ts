/**
 * PR checks: which failed, the tail of each failure's log, and why it failed.
 *
 * Pure functions over `gh pr view --json statusCheckRollup` output and
 * `gh run view --log-failed` text. Every class comes from a fixed rule, so the
 * same inputs always give the same class and no model is asked.
 *
 * @module web/server/branch-health/checks
 */

import type { CheckFailureClass } from "./types.js";

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

/**
 * The last {@link LOG_TAIL_MAX_LINES} lines, then the last
 * {@link LOG_TAIL_MAX_CHARS} characters of those, with colour codes removed.
 */
export function capLogTail(log: string): string {
  const lines = log.replace(ANSI_CSI, "").replace(/\n+$/, "").split("\n");
  const tail = lines.slice(-LOG_TAIL_MAX_LINES).join("\n");
  return tail.length > LOG_TAIL_MAX_CHARS ? tail.slice(-LOG_TAIL_MAX_CHARS) : tail;
}

/** What the classifier knows about one failing check. */
export interface CheckClassInput {
  name: string;
  outcome: string;
  /** The capped log tail, or null when the check has no Actions log. */
  log: string | null;
  isCrossRepository: boolean;
  /** Repo-relative paths this branch changed against its base. */
  changedFiles: readonly string[];
}

const BEHIND_BASE = /\b(?:out of date with|is behind|not up to date with|behind (?:the )?base|must be rebased|needs? (?:a )?rebase)\b/i;
const POLICY_TEST = /\b((?:architecture-policy|domain-isolation|instruction-alignment|boundary-check|agents-md-size-budget|[\w-]+-policy)\.test\.[cm]?[jt]s)\b/;
const CODEQL = /\bcodeql\b|\bcode scanning\b/i;
// Vitest's `FAIL  path > suite > case`, and the ×/✗ markers of its failed-file lines.
const FAILED_TEST_FILE = /(?:\bFAIL\b|[×✗])\s+(\S+?\.(?:test|spec)\.[cm]?[jt]sx?)\b/g;

/** Test files a log reports as failing, in order of first mention. */
export function failedTestFiles(log: string): string[] {
  const found = new Set<string>();
  for (const match of log.matchAll(FAILED_TEST_FILE)) found.add(match[1].replace(/^\.\//, ""));
  return [...found];
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
 * 6. **unclassified** — none of the above.
 */
export function classifyFailingCheck(input: CheckClassInput): { class: CheckFailureClass; evidence: string } {
  const log = input.log ?? "";
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
  for (const file of failedTestFiles(log)) {
    // A package-level runner prints paths relative to its package.
    const touched = changed.find((path) => path === file || path.endsWith(`/${file}`));
    if (touched) {
      return { class: "touched-test", evidence: `${touched} failed, and this branch changed it.` };
    }
  }
  return { class: "unclassified", evidence: "No rule matched the check's name or log." };
}
