/**
 * Self-heal pre-execution confirmation gate.
 *
 * `ndx self-heal` can spin up long-running, multi-iteration agent loops that
 * write to the PRD and modify source code. The functions in this module print
 * the queued candidate task list and require explicit user approval before
 * any PRD-mutating step (`rex recommend --accept`) or hench invocation runs.
 *
 * The gate is bypassed when the user opts into unattended execution via
 * `--auto`, `--yes`, or the `selfHeal.autoConfirm` config setting. Non-TTY
 * invocations without an opt-in flag/setting fail fast with a clear error so
 * scheduled or CI-driven runs surface a misconfiguration instead of silently
 * blocking on stdin.
 *
 * All helpers are intentionally pure (no spawning, no console writes) except
 * `runConfirmationPrompt`, which takes its own readline factory so unit tests
 * can drive it without a real TTY.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

/**
 * Parse `rex recommend --actionable-only --format=json` output into a
 * summary of the queued task list. Tolerates empty / non-JSON input by
 * returning an empty summary — the caller decides whether that should
 * abort the run.
 *
 * @param {string} stdout
 * @returns {{ tasks: Array<{ title: string, findingCount: number }>, totalFindings: number }}
 */
export function parseRecommendationsJson(stdout) {
  const trimmed = (stdout ?? "").trim();
  if (!trimmed) return { tasks: [], totalFindings: 0 };
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { tasks: [], totalFindings: 0 };
  }
  if (!Array.isArray(parsed)) return { tasks: [], totalFindings: 0 };

  const tasks = [];
  let totalFindings = 0;
  for (const item of parsed) {
    if (!item || item.level !== "task") continue;
    const title = typeof item.title === "string" && item.title.length > 0
      ? item.title
      : "(untitled task)";
    const findingCount = Number.isFinite(item?.meta?.findingCount)
      ? item.meta.findingCount
      : 0;
    tasks.push({ title, findingCount });
    totalFindings += findingCount;
  }
  return { tasks, totalFindings };
}

/**
 * Build the human-readable summary printed before the y/N prompt.
 *
 * @param {object} args
 * @param {{ tasks: Array<{ title: string, findingCount: number }>, totalFindings: number }} args.summary
 * @param {number} args.currentIteration  1-based iteration index.
 * @param {number} args.totalIterations   N requested by the user (defaults to 1).
 * @returns {string}
 */
export function formatQueuedTaskSummary({ summary, currentIteration, totalIterations }) {
  const lines = [];
  const iter = `iteration ${currentIteration}/${totalIterations}`;
  const taskCount = summary.tasks.length;
  const findingsSuffix = summary.totalFindings > 0
    ? ` (covering ${summary.totalFindings} finding${summary.totalFindings === 1 ? "" : "s"})`
    : "";
  lines.push(`Queued for ${iter}: ${taskCount} task${taskCount === 1 ? "" : "s"}${findingsSuffix}`);

  if (taskCount === 0) {
    lines.push("  (no candidate tasks — nothing to execute)");
  } else {
    const MAX_LIST = 20;
    const shown = summary.tasks.slice(0, MAX_LIST);
    shown.forEach((task, idx) => {
      const findings = task.findingCount > 0
        ? `  [${task.findingCount} finding${task.findingCount === 1 ? "" : "s"}]`
        : "";
      lines.push(`  ${idx + 1}. ${truncate(task.title, 100)}${findings}`);
    });
    if (summary.tasks.length > MAX_LIST) {
      lines.push(`  …and ${summary.tasks.length - MAX_LIST} more`);
    }
  }

  if (totalIterations > 1) {
    lines.push(
      `Self-heal will run up to ${totalIterations} iterations; each iteration re-analyses the codebase and queues additional tasks.`,
    );
  }

  return lines.join("\n");
}

/**
 * Read `selfHeal.autoConfirm` from `.n-dx.json`. Missing file or invalid JSON
 * yields `false` (prompt-on by default).
 *
 * @param {string} dir Project root.
 * @returns {boolean}
 */
export function readSelfHealAutoConfirm(dir) {
  const configPath = join(dir, ".n-dx.json");
  if (!existsSync(configPath)) return false;
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    return data?.selfHeal?.autoConfirm === true;
  } catch {
    return false;
  }
}

/**
 * Resolve whether the prompt should be bypassed. CLI flags win over config.
 *
 * @param {object} args
 * @param {string[]} args.argv  Raw CLI arg list (after `self-heal`).
 * @param {boolean} args.configAutoConfirm  Value from `.n-dx.json`.
 * @returns {{ autoConfirm: boolean, source: "flag" | "config" | "none" }}
 */
export function resolveAutoConfirm({ argv, configAutoConfirm }) {
  const hasAuto = argv.includes("--auto");
  const hasYes = argv.includes("--yes");
  if (hasAuto || hasYes) return { autoConfirm: true, source: "flag" };
  if (configAutoConfirm) return { autoConfirm: true, source: "config" };
  return { autoConfirm: false, source: "none" };
}

/**
 * Drive the y/N prompt (or fail fast on non-TTY without an opt-in).
 *
 * Returns:
 *   { decision: "accept" }   — caller proceeds.
 *   { decision: "decline" }  — caller must exit non-zero with no further work.
 *   { decision: "no-tty",
 *     message: string }      — non-TTY without opt-in; caller should print
 *                              `message` to stderr and exit non-zero.
 *
 * @param {object} args
 * @param {string} args.summaryText  Output of formatQueuedTaskSummary().
 * @param {boolean} args.autoConfirm
 * @param {boolean} args.isTTY
 * @param {{ stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream }} [args.streams]
 * @param {(opts: { input: NodeJS.ReadableStream, output: NodeJS.WritableStream }) => { question: (q: string) => Promise<string>, close: () => void }} [args.readlineFactory]
 * @returns {Promise<{ decision: "accept" | "decline" | "no-tty" | "auto", message?: string }>}
 */
export async function runConfirmationPrompt({
  summaryText,
  autoConfirm,
  isTTY,
  streams,
  readlineFactory,
}) {
  const out = streams?.stdout ?? process.stdout;
  const err = streams?.stderr ?? process.stderr;
  const stdin = streams?.stdin ?? process.stdin;

  if (autoConfirm) {
    out.write(summaryText + "\n");
    out.write("Auto-confirm enabled — skipping interactive prompt.\n");
    return { decision: "auto" };
  }

  if (!isTTY) {
    const message =
      "ndx self-heal requires interactive confirmation before running, but stdin is not a TTY.\n" +
      "To run unattended, pass --auto (or --yes) on the command line, or set `selfHeal.autoConfirm` to true via\n" +
      "    ndx config selfHeal.autoConfirm true\n";
    err.write(message);
    return { decision: "no-tty", message };
  }

  out.write(summaryText + "\n");

  const factory = readlineFactory ?? createInterface;
  const rl = factory({ input: stdin, output: out });
  let answer = "";
  try {
    answer = await rl.question("Proceed with self-heal? [y/N] ");
  } catch {
    answer = "";
  } finally {
    rl.close();
  }

  const accepted = /^y(es)?$/i.test(answer.trim());
  return { decision: accepted ? "accept" : "decline" };
}

function truncate(s, max) {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}
