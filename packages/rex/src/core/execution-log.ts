/**
 * Single writer behind every route to the execution log.
 *
 * `append_log` (rex MCP tool, see `cli/mcp-tools.ts#handleAppendLog`) and
 * `rex log` / `ndx log` (CLI, see `cli/commands/log.ts#cmdLog`) both build
 * their entry here and feed it to `PRDStore#appendLog`, which is the layer
 * that stamps the actor, truncates `detail` to 2,000 characters, and rotates
 * `execution-log.jsonl` to `execution-log.1.jsonl` past 1 MB (see
 * `store/file-adapter.ts#appendLog`). Keeping the entry construction in one
 * place means the two routes can never drift on which fields they log —
 * only the timestamp (captured per call) and the actor (resolved by the
 * store per process) differ between them.
 *
 * The CLI route exists because `append_log` is otherwise reachable only
 * through the rex MCP server: a hench run whose session has no MCP server
 * connected — the common case for a `claude`/`codex` CLI-provider spawn —
 * could not write to the execution log at all, and rex owns
 * `execution-log.jsonl` under the write-access protocol, so hand-editing it
 * is not an option either.
 *
 * @module core/execution-log
 */

import type { PRDStore } from "../store/contracts.js";
import type { LogEntry } from "../schema/index.js";

/** Arguments accepted by both the `append_log` MCP tool and `rex log`. */
export interface AppendLogArgs {
  event: string;
  itemId?: string;
  detail?: string;
}

/**
 * Build a log entry from `args` and persist it via `store.appendLog`.
 *
 * The returned entry is the one built *here* — before the store stamps the
 * actor and truncates `detail`. It is therefore safe to read for `event`,
 * `itemId` and `timestamp`, which the store writes through unchanged, but
 * **not** for `detail`: past 2,000 characters the persisted value differs
 * from the one returned, so echoing it back to a caller reports text the log
 * does not contain. Read the log if you need what was stored.
 */
export async function appendExecutionLogEntry(
  store: PRDStore,
  args: AppendLogArgs,
): Promise<LogEntry> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    event: args.event,
    itemId: args.itemId,
    detail: args.detail,
  };
  await store.appendLog(entry);
  return entry;
}
