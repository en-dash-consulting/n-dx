/**
 * `rex log` — append a structured entry to `.rex/execution-log.jsonl` without
 * a rex MCP server connected.
 *
 * `append_log` was, until this command existed, reachable only as an MCP
 * tool. A hench run whose session has no MCP server attached — the ordinary
 * case for a `claude`/`codex` CLI-provider spawn — had no way to perform the
 * workflow's log step, and rex owns the execution log under the write-access
 * protocol, so writing the file by hand is not a substitute. This command
 * and the MCP tool now build their entry through the same
 * {@link appendExecutionLogEntry} and both persist it via
 * {@link PRDStore.appendLog}, so the two routes cannot diverge on shape.
 *
 * @module rex/cli/commands/log
 */

import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { appendExecutionLogEntry } from "../../core/execution-log.js";
import { requireRexDir } from "../errors.js";
import { result } from "../output.js";
import { REX_DIR } from "./constants.js";

export async function cmdLog(
  dir: string,
  event: string,
  flags: Record<string, string>,
): Promise<void> {
  requireRexDir(dir);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  const entry = await appendExecutionLogEntry(store, {
    event,
    itemId: flags.item || undefined,
    detail: flags.detail || undefined,
  });

  if (flags.format === "json") {
    result(JSON.stringify({ logged: true, ...entry }, null, 2));
  } else {
    result(`Logged: ${event}${entry.itemId ? ` (item ${entry.itemId})` : ""}`);
  }
}
