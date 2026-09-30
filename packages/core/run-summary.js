/**
 * What a command actually did, read back off disk after it exits.
 *
 * The preflight banner in `command-effects.js` says what a command *will* do;
 * this module says what it *did* — which files it touched, how many LLM calls
 * that took, and what they cost. The two are deliberately separate: one is a
 * declaration, the other is evidence.
 *
 * ## Why this reads files instead of parsing output
 *
 * The orchestrator spawns each tool with `stdio: "inherit"`, so it never sees
 * a byte of the child's output — and it should not, because scraping a human
 * progress display for numbers is the kind of coupling that breaks silently
 * the next time a spinner changes. Every figure reported here is one the
 * spending tool already persisted for its own reasons.
 *
 * ## Why cost is read, never computed
 *
 * The token price table lives in `@n-dx/llm-client`, and this file sits at the
 * orchestration tier, which may not import packages (CLAUDE.md, "Tier boundary
 * crossing"). A second copy of the rates here would drift from the first the
 * day either changes, and a wrong cost is worse than no cost — so the tool
 * that spends the money records the figure (`manifest.lastAnalysis.llm.costUsd`
 * for sourcevision, `costUsd` on rex's `analyze_token_usage` log entry) and
 * this module only reads it. When it is absent the summary says so rather than
 * estimating.
 *
 * @module core/run-summary
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {Object} RunSummary
 * @property {string[]} filesWritten - Declared write targets whose mtime moved during the run.
 * @property {number} calls - LLM calls made.
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number|null} costUsd - `null` when no tool recorded a cost.
 * @property {boolean} narrationPending - This run queued a detached narrator that has not finished; its spend is not in the numbers above.
 * @property {string} next - The command to run next.
 */

/** Read and parse a JSON file, or `null` if it is missing or malformed. */
function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * LLM totals from `.sourcevision/manifest.json`, if the last analysis recorded
 * any. Read from `lastAnalysis` rather than the aggregate `tokenUsage` bucket
 * because only `lastAnalysis` is per-task-class, and only it carries the cost.
 *
 * `sinceMs` scopes it to this invocation, for the same reason {@link rexUsage}
 * takes one. `lastAnalysis` is the last analysis *the project* ran, not the
 * last one this command ran — and most commands never run sourcevision at
 * all. Without the cutoff, an `ndx recommend .` after an `ndx analyze .`
 * reported the analysis’s calls, tokens and dollars as if `recommend` had
 * spent them, and `plan --file` read the same stale figures.
 */
function sourcevisionUsage(manifest, sinceMs) {
  const run = manifest?.lastAnalysis;
  if (!run?.llm?.byTaskClass) return null;

  // `at` is when the analysis started, which is after the orchestrator noted
  // `startedAt` and before it reads this back. An unparseable stamp is treated
  // as not ours: a summary that under-reports is recoverable, one that bills a
  // command for someone else’s spend is not.
  const at = Date.parse(run.at);
  if (!Number.isFinite(at) || at < sinceMs) return null;

  let calls = 0, inputTokens = 0, outputTokens = 0;
  for (const bucket of Object.values(run.llm.byTaskClass)) {
    calls += bucket.calls ?? 0;
    inputTokens += bucket.inputTokens ?? 0;
    outputTokens += bucket.outputTokens ?? 0;
  }
  if (calls === 0) return null;
  return {
    calls,
    inputTokens,
    outputTokens,
    costUsd: typeof run.llm.costUsd === "number" ? run.llm.costUsd : null,
  };
}

/**
 * LLM totals from the most recent `analyze_token_usage` entry in rex's
 * execution log, when that entry was written during this run.
 *
 * `sinceMs` is what makes this safe to call unconditionally: without it a
 * `plan` that made no model calls would report last week's numbers as its own.
 */
function rexUsage(dir, sinceMs) {
  const path = join(dir, ".rex", "execution-log.jsonl");
  if (!existsSync(path)) return null;

  let latest = null;
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.includes("analyze_token_usage")) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // A torn final line during an append — skip it, keep the rest.
      }
      if (entry?.event !== "analyze_token_usage") continue;
      if (Date.parse(entry.timestamp) < sinceMs) continue;
      latest = entry;
    }
  } catch {
    return null;
  }
  if (!latest) return null;

  const detail = typeof latest.detail === "string" ? readDetail(latest.detail) : latest.detail;
  if (!detail || !detail.calls) return null;
  return {
    calls: detail.calls,
    inputTokens: detail.inputTokens ?? 0,
    outputTokens: detail.outputTokens ?? 0,
    costUsd: typeof detail.costUsd === "number" ? detail.costUsd : null,
  };
}

/**
 * Whether this run queued a narrator that is still going.
 *
 * `analyze` spawns `sv narrate` detached and returns without waiting, so the
 * summary prints before that child records a single token. The numbers are
 * therefore right about what has been recorded and wrong about what the
 * command will end up costing, and only the summary can say which.
 *
 * The `startedAt` check is what makes it *this* run’s narrator rather than one
 * left pending by an earlier analyze.
 */
function narrationIsPending(manifest, sinceMs) {
  const narration = manifest?.narration;
  if (narration?.status !== "pending") return false;
  const startedAt = Date.parse(narration.startedAt);
  return Number.isFinite(startedAt) && startedAt >= sinceMs;
}

function readDetail(detail) {
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

/**
 * Newest mtime at or under `path`, or `-Infinity` when it does not exist.
 *
 * A directory's own mtime is not enough. Most filesystems bump it when an
 * entry is added or removed, but *not* when an existing file is overwritten —
 * and overwriting is exactly what `sv analyze` does to a `.sourcevision/` that
 * already has an inventory.json. Reading only the directory would report
 * "wrote nothing" for the commonest case there is.
 *
 * Recursion is bounded by the shallow, tool-owned trees this is pointed at
 * (`.sourcevision/`, `.rex/prd_tree/`), and it stops at the first entry it
 * cannot stat rather than failing the summary.
 */
function newestMtimeMs(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return -Infinity; // Never written, or removed again.
  }
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  try {
    for (const entry of readdirSync(path)) {
      newest = Math.max(newest, newestMtimeMs(join(path, entry)));
    }
  } catch {
    // Unreadable directory — the mtime we already have is the best answer.
  }
  return newest;
}

/**
 * Collect what the run produced.
 *
 * A declared write target counts as written when it exists and the newest
 * mtime at or under it is at or after `startedAt`. That is a claim about the
 * filesystem, not about the command's intent: a path the command chose not to
 * touch (an `--accept` the user did not pass, a cached analysis reused
 * verbatim) is correctly absent.
 *
 * Second-resolution filesystems exist, so `startedAt` is floored to the second
 * before comparison — otherwise a file written in the same second the command
 * began looks older than the run that wrote it.
 *
 * @param {string} dir - Project root.
 * @param {import("./command-effects.js").CommandEffects} effects
 * @param {number} startedAt - `Date.now()` from immediately before the spawn.
 * @returns {RunSummary}
 */
export function collectRunSummary(dir, effects, startedAt) {
  const threshold = Math.floor(startedAt / 1000) * 1000;

  const filesWritten = [];
  for (const write of effects.writes) {
    if (newestMtimeMs(join(dir, write.path)) >= threshold) filesWritten.push(write.path);
  }

  // Both are consulted because `ndx plan` drives sourcevision and rex in turn
  // and its summary owes the user the sum, not whichever half it looked at
  // first. Both are scoped to `threshold`, so a command that never ran one of
  // them finds nothing there rather than the last run’s numbers.
  const manifest = readJSON(join(dir, ".sourcevision", "manifest.json"));
  const usages = [sourcevisionUsage(manifest, threshold), rexUsage(dir, threshold)].filter(Boolean);

  let calls = 0, inputTokens = 0, outputTokens = 0, costUsd = null;
  for (const usage of usages) {
    calls += usage.calls;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    if (usage.costUsd !== null) costUsd = (costUsd ?? 0) + usage.costUsd;
  }

  return {
    filesWritten,
    calls,
    inputTokens,
    outputTokens,
    costUsd,
    narrationPending: narrationIsPending(manifest, threshold),
    next: effects.next,
  };
}

/** `$0.0123` above a tenth of a cent, `<$0.001` below it, so a real spend never prints as `$0.00`. */
export function formatCost(costUsd) {
  if (costUsd === null) return "not recorded";
  if (costUsd === 0) return "$0.00";
  if (costUsd < 0.001) return "<$0.001";
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}

/** Identity styling — used when the caller passes no colour functions. */
const PLAIN_STYLE = { bold: (t) => t, dim: (t) => t, cyan: (t) => t, green: (t) => t };

/**
 * Render the closing summary as lines. Mirrors {@link formatPreflightBanner}'s
 * contract: lines out, caller picks the stream.
 *
 * @param {RunSummary} summary
 * @param {{bold?: Function, dim?: Function, cyan?: Function, green?: Function}} [style]
 * @returns {string[]}
 */
export function formatRunSummary(summary, style = {}) {
  const { bold, dim, cyan, green } = { ...PLAIN_STYLE, ...style };
  const lines = [""];

  if (summary.filesWritten.length === 0) {
    lines.push(`  ${bold("wrote")}    nothing`);
  } else {
    lines.push(`  ${bold("wrote")}    ${summary.filesWritten.map((p) => cyan(p)).join(", ")}`);
  }

  if (summary.calls === 0) {
    lines.push(`  ${bold("llm")}      no model calls${dim(" — nothing spent")}`);
  } else {
    const tokens = (summary.inputTokens + summary.outputTokens).toLocaleString();
    lines.push(
      `  ${bold("llm")}      ${summary.calls} call${summary.calls === 1 ? "" : "s"}, ` +
      `${tokens} tokens, ${formatCost(summary.costUsd)}`,
    );
  }

  if (summary.narrationPending) {
    // Aligned under the llm line: it qualifies that line, whichever branch above
    // produced it — "no model calls" is as incomplete as a total, when a
    // narrator this run started is still spending.
    lines.push(`           ${dim("background narration is still running — its calls are not counted here")}`);
  }

  lines.push(`  ${bold("next")}     ${green(summary.next)}`);
  lines.push("");
  return lines;
}
