/**
 * `hench cache` — inspect and clear the session cache.
 *
 * The cache decides whether a task re-pays cold start or resumes something.
 * When it stops paying, the question is always "what is in there, and why was
 * it declined?" — and until now the only way to answer it was to open
 * `.hench/session-cache.json` and date the ISO timestamps by hand. Worse, the
 * fix for a suspect entry was to delete a file holding *both* scopes, so
 * clearing a stale batch chain also threw away a perfectly good orientation
 * parent.
 *
 * This command answers the question and does the scoped delete.
 *
 * @module hench/cli/commands/cache
 */

import { join } from "node:path";
import {
  CACHE_SCOPES,
  clearCacheScopes,
  evictDeadCacheEntries,
  listCacheEntries,
  DEFAULT_TASKS_PER_SESSION,
  type CacheDefect,
  type CacheScope,
} from "../../agent/lifecycle/session-cache.js";
import { configExists, loadConfig } from "../../store/config.js";
import { HENCH_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";

const USAGE_TEXT =
  "Usage: hench cache list [--scope=parent|batch|all] [--format=json] [dir]\n" +
  "       hench cache clear [--scope=parent|batch|all] [--dead] [dir]";

/** Why an entry is dead, in words an operator can act on. */
const DEFECT_DETAIL: Record<CacheDefect, string> = {
  unversioned: "written before this version scheme",
  "version-changed": "written by a different version of hench",
  malformed: "unreadable timestamps",
  expired: "past its maximum age",
  idle: "unused for longer than the idle window",
};

/**
 * Resolve `--scope`, defaulting to every scope.
 *
 * `all` is the default for both subcommands. For `list` it is plainly right,
 * and for `clear` it is safe: a cleared cache costs one orientation spawn and
 * nothing else, and the command names what it removed.
 */
function parseScopes(raw: string | undefined): CacheScope[] {
  if (!raw || raw === "all" || raw === "true") return [...CACHE_SCOPES];
  if ((CACHE_SCOPES as readonly string[]).includes(raw)) return [raw as CacheScope];
  throw new CLIError(
    `Unknown --scope value: "${raw}"`,
    `Expected one of: ${[...CACHE_SCOPES, "all"].join(", ")}`,
  );
}

/**
 * The bounds an entry's freshness is judged against, from config.
 *
 * A missing `config.json` yields defaults rather than an error: every bound
 * here has one, and refusing to *report* what is cached because the settings
 * file is absent would fail the command at exactly the moment someone is
 * trying to work out what state the project is in. An unreadable config still
 * throws — that is a real problem with a real fix.
 */
async function freshnessBounds(henchDir: string): Promise<{
  parentMaxAgeHours?: number;
  batchMaxAgeHours?: number;
  batchMaxIdleHours?: number;
  tasksPerSession?: number;
}> {
  if (!(await configExists(henchDir))) return {};
  const config = await loadConfig(henchDir, { onInvalid: "use-defaults" });
  return {
    parentMaxAgeHours: config.parentMaxAgeHours,
    batchMaxAgeHours: config.batchMaxAgeHours,
    batchMaxIdleHours: config.batchMaxIdleHours,
    tasksPerSession: config.tasksPerSession,
  };
}

export async function cmdCache(
  dir: string,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const sub = positional[0];
  const scopes = parseScopes(flags.scope);
  if (sub === "list") return cmdCacheList(dir, scopes, flags);
  if (sub === "clear") return cmdCacheClear(dir, scopes, flags.dead === "true");
  throw new CLIError(
    sub ? `Unknown cache subcommand: ${sub}` : "Missing cache subcommand.",
    USAGE_TEXT,
  );
}

async function cmdCacheList(
  dir: string,
  scopes: CacheScope[],
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const { tasksPerSession, ...bounds } = await freshnessBounds(henchDir);

  const inventory = await listCacheEntries(henchDir, bounds);
  const cap = tasksPerSession ?? DEFAULT_TASKS_PER_SESSION;

  if (flags.format === "json") {
    // The inventory verbatim, filtered to the requested scopes. It is already
    // free of prompt content — see the CacheInventory docs.
    result(
      JSON.stringify(
        {
          parent: scopes.includes("parent") ? inventory.parent ?? null : undefined,
          batch: scopes.includes("batch") ? inventory.batch ?? null : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Only offer the clear hint when there is something to clear — advice to
  // delete an empty cache is noise, and noise is how a footer stops being read.
  let anyEntry = false;

  if (scopes.includes("parent")) {
    const parent = inventory.parent;
    anyEntry ||= parent !== undefined;
    if (!parent) {
      result("parent  (none)");
    } else {
      result(`parent  ${parent.parentId.slice(0, 8)}${defectSuffix(parent.defect)}`);
      info(`  created ${formatAge(parent.createdAt)} | ${parent.vendor}/${parent.model}`);
      info(`  analysis ${parent.svFingerprint || "unknown"}`);
    }
  }

  if (scopes.includes("batch")) {
    const batch = inventory.batch;
    anyEntry ||= batch !== undefined;
    if (!batch) {
      result("batch   (none)");
    } else {
      result(`batch   ${batch.sessionId.slice(0, 8)}${defectSuffix(batch.defect)}`);
      info(`  ${batch.tasksUsed} of up to ${cap} tasks | ${batch.vendor}/${batch.model}`);
      info(`  opened ${formatAge(batch.createdAt)} | last used ${formatAge(batch.lastUsedAt)}`);
      info(`  ref ${batch.ref || "(none)"} in ${batch.worktreeRoot || "(unknown worktree)"}`);
      info(`  analysis ${batch.svFingerprint || "unknown"} | policy ${batch.policyHash || "unknown"}`);
      if (batch.lastTaskTitle) info(`  last task "${batch.lastTaskTitle}"`);
    }
  }

  if (anyEntry) {
    info("\nRun 'hench cache clear' to drop these, or --scope to pick one.");
  }
}

/**
 * `--dead` removes only the entries that are dead for everyone, leaving live
 * ones in place. That is the same sweep a run performs on the scopes its
 * strategy does not read, offered on demand for the scope it does — an
 * operator who wants the stale chain gone without also paying for a fresh
 * orientation should not have to choose between the two.
 */
async function cmdCacheClear(
  dir: string,
  scopes: CacheScope[],
  deadOnly: boolean,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  if (deadOnly) {
    const { tasksPerSession: _cap, ...bounds } = await freshnessBounds(henchDir);
    const evicted = await evictDeadCacheEntries(henchDir, { scopes, ...bounds });
    if (evicted.length === 0) {
      result(`Nothing dead in: ${scopes.join(", ")}.`);
      return;
    }
    for (const { scope, defect } of evicted) {
      result(`Evicted ${scope} — ${DEFECT_DETAIL[defect]}.`);
    }
    return;
  }

  const cleared = await clearCacheScopes(henchDir, scopes);
  if (cleared.length === 0) {
    result(`Nothing cached for: ${scopes.join(", ")}.`);
    return;
  }
  result(`Cleared: ${cleared.join(", ")}.`);
  info("The next run re-orients (or opens a new session) rather than resuming.");
}

function defectSuffix(defect: CacheDefect | undefined): string {
  return defect ? `  [dead — ${DEFECT_DETAIL[defect]}]` : "";
}

/** "3h 12m ago", or the raw value when it cannot be parsed. */
function formatAge(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return `"${iso}" (unparseable)`;

  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}
