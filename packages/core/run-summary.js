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

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {Object} RunSummary
 * @property {string[]} filesWritten - Declared write targets whose mtime moved during the run.
 * @property {number} calls - LLM calls made.
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number|null} costUsd - `null` when no tool recorded a cost.
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
 */
function sourcevisionUsage(dir) {
  const manifest = readJSON(join(dir, ".sourcevision", "manifest.json"));
  const run = manifest?.lastAnalysis;
  if (!run?.llm?.byTaskClass) return null;

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

function readDetail(detail) {
  try {
    return JSON.parse(detail);
  } catch {
    return null;
  }
}

/**
 * Collect what the run produced.
 *
 * A declared write target counts as written when it exists and its mtime is at
 * or after `startedAt`. That is a claim about the filesystem, not about the
 * command's intent: a path the command chose not to touch (an `--accept` the
 * user did not pass, a cached analysis reused verbatim) is correctly absent.
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
    const full = join(dir, write.path);
    try {
      if (statSync(full).mtimeMs >= threshold) filesWritten.push(write.path);
    } catch {
      // Never written, or removed again — either way, not a result of this run.
    }
  }

  // Both are consulted because `ndx plan` drives sourcevision and rex in turn
  // and its summary owes the user the sum, not whichever half it looked at
  // first. A command that never ran one of them simply finds nothing there.
  const usages = [sourcevisionUsage(dir), rexUsage(dir, threshold)].filter(Boolean);

  let calls = 0, inputTokens = 0, outputTokens = 0, costUsd = null;
  for (const usage of usages) {
    calls += usage.calls;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    if (usage.costUsd !== null) costUsd = (costUsd ?? 0) + usage.costUsd;
  }

  return { filesWritten, calls, inputTokens, outputTokens, costUsd, next: effects.next };
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

  lines.push(`  ${bold("next")}     ${green(summary.next)}`);
  lines.push("");
  return lines;
}
