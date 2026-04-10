import { join } from "node:path";
import { loadRun } from "../../store/index.js";
import { HENCH_DIR } from "./constants.js";
import { info, result } from "../output.js";
import { colorStatus } from "../../prd/llm-gateway.js";
import { lookupTaskInRex, formatTaskLine } from "./task-lookup.js";

export async function cmdShow(
  dir: string,
  runId: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const run = await loadRun(henchDir, runId);

  if (flags.format === "json") {
    result(JSON.stringify(run, null, 2));
    return;
  }

  // Check if the task still exists in rex
  const taskLookup = await lookupTaskInRex(dir, run.taskId);
  const taskLine = formatTaskLine(run.taskTitle, run.taskId, taskLookup.exists);

  result(`Run: ${run.id}`);
  result(`Task: ${taskLine}`);
  info(`Model: ${run.model}`);
  result(`Status: ${colorStatus(run.status)}`);
  info(`Started: ${run.startedAt}`);
  if (run.finishedAt) info(`Finished: ${run.finishedAt}`);
  info(`Turns: ${run.turns}`);
  const totalTokens = run.tokenUsage.input + run.tokenUsage.output;
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out (${totalTokens} total)`);
  if (run.tokenUsage.cacheCreationInput || run.tokenUsage.cacheReadInput) {
    info(`  Cache: ${run.tokenUsage.cacheCreationInput ?? 0} created / ${run.tokenUsage.cacheReadInput ?? 0} read`);
  }

  if (run.summary) {
    info(`\nSummary:\n${run.summary}`);
  }

  if (run.error) {
    result(`\nError:\n${run.error}`);
  }

  // Structured summary
  const ss = run.structuredSummary;
  if (ss) {
    info(`\nStructured Summary:`);
    info(`  Files changed (${ss.counts.filesChanged}): ${ss.filesChanged.join(", ") || "none"}`);
    info(`  Files read (${ss.counts.filesRead}): ${ss.filesRead.join(", ") || "none"}`);
    info(`  Commands executed: ${ss.counts.commandsExecuted}`);
    info(`  Tests run: ${ss.counts.testsRun}`);
    info(`  Tool calls total: ${ss.counts.toolCallsTotal}`);

    if (ss.testsRun.length > 0) {
      info(`\n  Tests:`);
      for (const t of ss.testsRun) {
        const icon = t.passed ? "✓" : "✗";
        info(`    ${icon} ${t.command} (${t.durationMs}ms)`);
      }
    }

    if (ss.commandsExecuted.length > 0) {
      info(`\n  Commands:`);
      for (const c of ss.commandsExecuted) {
        const icon = c.exitStatus === "ok" ? "✓" : c.exitStatus === "blocked" ? "⊘" : "✗";
        info(`    ${icon} ${c.command} [${c.exitStatus}] (${c.durationMs}ms)`);
      }
    }

    if (ss.postRunTests) {
      const pt = ss.postRunTests;
      info(`\n  Post-Task Tests:`);
      if (pt.ran) {
        const icon = pt.passed ? "✓" : "✗";
        const scope = pt.targetedFiles.length > 0
          ? `${pt.targetedFiles.length} targeted file(s)`
          : "full suite";
        info(`    ${icon} ${pt.command ?? "unknown"} [${scope}] (${pt.durationMs ?? 0}ms)`);
        if (pt.targetedFiles.length > 0) {
          for (const f of pt.targetedFiles) {
            info(`      → ${f}`);
          }
        }
      } else {
        info(`    ⊘ Not run: ${pt.error ?? "unknown reason"}`);
      }
    }
  }

  if (run.toolCalls.length > 0) {
    info(`\nTool Calls (${run.toolCalls.length}):`);
    for (const call of run.toolCalls) {
      const inputStr = JSON.stringify(call.input).slice(0, 80);
      info(`  [${call.turn}] ${call.tool}(${inputStr}) — ${call.durationMs}ms`);
      if (call.output.startsWith("[GUARD]") || call.output.startsWith("[ERROR]")) {
        info(`       ${call.output.slice(0, 120)}`);
      }
    }
  }

  // Per-turn token breakdown
  if (run.turnTokenUsage && run.turnTokenUsage.length > 0) {
    info(`\nToken Usage Per Turn (${run.turnTokenUsage.length}):`);
    for (const t of run.turnTokenUsage) {
      const turnTotal = t.input + t.output;
      let line = `  [${t.turn}] ${t.input} in / ${t.output} out (${turnTotal})`;
      if (t.cacheCreationInput || t.cacheReadInput) {
        line += ` cache: ${t.cacheCreationInput ?? 0}c/${t.cacheReadInput ?? 0}r`;
      }
      info(line);
    }
  }
}
