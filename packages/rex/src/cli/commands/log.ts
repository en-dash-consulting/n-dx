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
import { CLIError, requireRexDir } from "../errors.js";
import { result } from "../output.js";
import { REX_DIR } from "./constants.js";

/**
 * The `--item` value, or undefined when the flag was absent.
 *
 * A valueless `--item` is an error rather than a no-op. `item` is not a
 * VALUE_KEY (adding it swallows the trailing `[dir]` of `rex export --item
 * <dir>`, which that command's own test pins), so the parser turns a bare
 * flag into the string `"true"` and `rex log task_done --item abc123 .`
 * arrives here as `"true"` with `abc123` dropped. Logging that silently
 * writes an audit entry against an item id that does not exist, prints
 * "Logged: task_done (item true)", and exits 0 — the caller is told the
 * attribution succeeded when their id was discarded.
 *
 * `rex export` refuses the same shape for the same reason; see
 * `commands/export.ts#readScope`.
 */
function readItemId(flags: Record<string, string>): string | undefined {
  const raw = flags.item;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "true") {
    throw new CLIError(
      "--item needs a value.",
      "Write it as --item=<id>; the space-separated form is not supported.",
    );
  }
  return trimmed;
}

export async function cmdLog(
  dir: string,
  event: string,
  flags: Record<string, string>,
): Promise<void> {
  requireRexDir(dir);

  const itemId = readItemId(flags);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  const entry = await appendExecutionLogEntry(store, {
    event,
    itemId,
    detail: flags.detail || undefined,
  });

  if (flags.format === "json") {
    // Deliberately does not echo `detail`. What the store wrote is the
    // stamped, truncated entry (2,000 characters), not the one built here,
    // so echoing the caller's own text would report a value the log does not
    // contain. Every field below is the one that was persisted, and the
    // shape now matches what the `append_log` MCP tool returns.
    result(JSON.stringify({ logged: true, event: entry.event, itemId: entry.itemId, timestamp: entry.timestamp }, null, 2));
  } else {
    result(`Logged: ${event}${entry.itemId ? ` (item ${entry.itemId})` : ""}`);
  }
}
