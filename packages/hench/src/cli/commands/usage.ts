/**
 * `hench usage mark` — write the start-of-task usage mark.
 *
 * Run by the skills at the moment a task begins (the step that used to say
 * "note the current time"). It snapshots the session transcript's cumulative
 * token usage and its current position, and stores that under the task id in
 * `.hench/usage-cursors/<session>.json`. `hench record --task=<id>` later
 * reports the difference between that snapshot and the transcript at record
 * time — a subtraction done in code, not a window typed by the model.
 *
 * `hench usage marks` lists the marks a session still holds.
 *
 * @module hench/cli/commands/usage
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadUsageCursor,
  resolveTranscriptPath,
  saveUsageMark,
  takeUsageMark,
} from "../../store/session-usage.js";
import { HENCH_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";

const USAGE_TEXT =
  "Usage: hench usage mark --task=<id> [--session=<id>] [--transcript=<path>] [dir]\n" +
  "       hench usage marks [--session=<id>] [dir]";

export async function cmdUsage(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const sub = positional[0];
  if (sub === "mark") return cmdUsageMark(dir, flags);
  if (sub === "marks") return cmdUsageMarks(dir, flags);
  throw new CLIError(
    sub ? `Unknown usage subcommand: ${sub}` : "Missing usage subcommand.",
    USAGE_TEXT,
  );
}

async function cmdUsageMark(dir: string, flags: Record<string, string>): Promise<void> {
  const task = flags.task;
  if (!task) throw new CLIError("Missing --task.", USAGE_TEXT);

  const henchDir = join(dir, HENCH_DIR);
  const sessionId = flags.session || process.env.CLAUDE_CODE_SESSION_ID || "";
  if (!sessionId) {
    // Nothing to mark against, and nothing to fail: `hench record` will say the
    // same thing and fall back. A skill's first step must not abort over it.
    warn(
      "No Claude Code session detected (CLAUDE_CODE_SESSION_ID unset) — nothing marked. " +
        "The record for this task will fall back to the session watermark.",
    );
    return;
  }

  const transcriptPath = flags.transcript || (await resolveTranscriptPath(sessionId));
  if (!transcriptPath) {
    warn(
      `No transcript found for session ${sessionId} — nothing marked. ` +
        "The record for this task will fall back to the session watermark.",
    );
    return;
  }

  let text: string;
  try {
    text = await readFile(transcriptPath, "utf-8");
  } catch {
    if (flags.transcript) {
      throw new CLIError(`Could not read transcript: ${flags.transcript}`, USAGE_TEXT);
    }
    warn(`Transcript ${transcriptPath} could not be read — nothing marked.`);
    return;
  }

  const mark = takeUsageMark(text, task);
  await saveUsageMark(henchDir, sessionId, mark);

  if (flags.format === "json") {
    result(JSON.stringify({ session: sessionId, mark }, null, 2));
    return;
  }
  const total =
    mark.totals.input + mark.totals.output + mark.totals.cacheCreationInput + mark.totals.cacheReadInput;
  result(
    `Marked usage for "${task}" at message ${mark.consumed}` +
      `${mark.lastUuid ? ` (${mark.lastUuid.slice(0, 8)})` : ""} of session ${sessionId}.`,
  );
  info(
    `Session total so far: ${total.toLocaleString()} tokens. ` +
      `'hench record --task=${task}' will claim only what accumulates after this point.`,
  );
}

async function cmdUsageMarks(dir: string, flags: Record<string, string>): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const sessionId = flags.session || process.env.CLAUDE_CODE_SESSION_ID || "";
  if (!sessionId) throw new CLIError("No session: pass --session=<id> or run inside Claude Code.", USAGE_TEXT);

  const cursor = await loadUsageCursor(henchDir, sessionId);
  const marks = Object.values(cursor.marks ?? {});
  if (flags.format === "json") {
    result(JSON.stringify({ session: sessionId, watermark: { lastUuid: cursor.lastUuid, consumed: cursor.consumed }, marks }, null, 2));
    return;
  }
  if (marks.length === 0) {
    result(`No pending usage marks for session ${sessionId}.`);
    return;
  }
  for (const m of marks) {
    result(`${m.task}  at ${m.at || "?"}  message ${m.consumed}${m.lastUuid ? ` (${m.lastUuid.slice(0, 8)})` : ""}`);
  }
}
