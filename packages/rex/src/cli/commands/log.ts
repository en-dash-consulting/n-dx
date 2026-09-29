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
import { resolveStore, resolveRexPaths } from "../../store/index.js";
import { appendExecutionLogEntry } from "../../core/execution-log.js";
import { CLIError, requireRexDir } from "../errors.js";
import { result } from "../output.js";


/**
 * The `--item` value, or undefined when the flag was absent.
 *
 * A valueless `--item` is an error rather than a no-op: logging one silently
 * writes an audit entry against an item id that does not exist, prints
 * "Logged: task_done (item …)", and exits 0 — the caller is told the
 * attribution succeeded when their id was never read.
 *
 * **This guard is narrower than it used to be.** `item` was deliberately not
 * a VALUE_KEY, so the parser turned *every* bare `--item` into the string
 * `"true"` and this check caught the whole space-separated family. `item` is
 * now a VALUE_KEY (so `rex ready --item <id>` parses), which means
 * `--item <token>` consumes the next token as its value and only reaches here
 * as `"true"` when `--item` is last or is followed by another flag. The
 * uncaught case is `rex log <event> --item <dir>` — the trailing directory is
 * swallowed as the id and an entry naming a filesystem path is persisted.
 * Closing that needs a decision about where validation belongs, since the
 * `append_log` MCP tool shares `appendExecutionLogEntry` and does not
 * validate either; see the note on that divergence in this module's header.
 *
 * `rex export` carries the same narrowed guard; see
 * `commands/export.ts#readScope`.
 */
function readItemId(flags: Record<string, string>): string | undefined {
  const raw = flags.item;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "true") {
    throw new CLIError(
      "--item needs a value.",
      "Write it as --item=<id>.",
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

  const rexDir = resolveRexPaths(dir).rexDir;
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
