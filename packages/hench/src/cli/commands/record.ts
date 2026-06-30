import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { saveRun } from "../../store/runs.js";
import { loadConfig } from "../../store/config.js";
import { HENCH_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info } from "../output.js";
import type { RunRecord, RunStatus } from "../../schema/index.js";

const VALID_STATUSES: readonly RunStatus[] = [
  "running",
  "completed",
  "failed",
  "timeout",
  "budget_exceeded",
  "error_transient",
  "cancelled",
];

/**
 * Write a lightweight, assisted run record to `.hench/runs/`.
 *
 * Used by the `/ndx-work` skill so task execution driven through Claude Code
 * is visible in run history and auditable after the fact — closing the gap
 * where slash-command work left no `.hench/runs/` entry (issue #271). The
 * record is marked `assisted: true` and carries empty token usage: Claude Code
 * does not expose its own token consumption to the running skill, so unlike
 * `ndx work` (which parses the spawned `claude` CLI's token output) there is no
 * usage to attribute. The empty totals join to the PRD item at 0 tokens, so
 * the record never inflates `ndx usage` analytics.
 */
export async function cmdRecord(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  const taskId = flags.task;
  if (!taskId) {
    throw new CLIError(
      "Missing --task.",
      "Usage: hench record --task=<id> [--title=<title>] [--status=completed] [--summary=<text>] [--turns=N] [dir]",
    );
  }

  const status = (flags.status ?? "completed") as RunStatus;
  if (!VALID_STATUSES.includes(status)) {
    throw new CLIError(
      `Invalid --status: "${status}"`,
      `Must be one of: ${VALID_STATUSES.join(", ")}`,
    );
  }

  let turns = 0;
  if (flags.turns !== undefined) {
    const parsed = parseInt(flags.turns, 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      throw new CLIError(
        `Invalid --turns value: "${flags.turns}"`,
        "Must be a non-negative integer.",
      );
    }
    turns = parsed;
  }

  const config = await loadConfig(henchDir);
  const now = new Date().toISOString();

  const run: RunRecord = {
    id: randomUUID(),
    taskId,
    taskTitle: flags.title || taskId,
    startedAt: flags.startedAt || now,
    finishedAt: now,
    status,
    turns,
    summary:
      flags.summary ||
      "Assisted /ndx-work run (Claude Code) — token usage not captured.",
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model: config.model,
    invocationContext: "api",
    assisted: true,
  };

  await saveRun(henchDir, run);

  if (flags.format === "json") {
    result(
      JSON.stringify(
        { id: run.id, taskId: run.taskId, status: run.status, assisted: true },
        null,
        2,
      ),
    );
    return;
  }

  result(`Recorded assisted run ${run.id} for task ${taskId} (${status}).`);
  info("Assisted /ndx-work run — token usage is not captured for this path.");
}
