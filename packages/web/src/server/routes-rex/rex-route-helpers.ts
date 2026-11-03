/**
 * Shared helpers for Rex route handlers.
 *
 * Thin wrappers over canonical rex functions that adapt the rex API
 * to the patterns used throughout the route modules.
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "../types.js";
import { loadPRDSync } from "../prd-io.js";

import {
  type PRDItem,
  type PRDDocument,
  type ItemStatus,
  type TreeEntry,
  VALID_STATUSES,
  findItem,
  insertChild as rexInsertChild,
  updateInTree as rexUpdateInTree,
  findNextTask as rexFindNextTask,
  collectCompletedIds,
  computeTimestampUpdates,
  indexTree,
  loadPrdModel,
  branchGuardRefusal,
} from "../rex-gateway.js";

/**
 * API-settable statuses — excludes "deleted" from the canonical set.
 * Deleted items shouldn't be settable via the API.
 */
export const API_SETTABLE_STATUSES = new Set<string>(
  [...VALID_STATUSES].filter((s) => s !== "deleted"),
);

/** Find an item by ID, returning just the item (or null). */
export function findItemById(items: PRDItem[], id: string): PRDItem | null {
  const entry = findItem(items, id);
  return entry ? entry.item : null;
}


/**
 * Update an item in the tree, automatically applying timestamp transitions
 * (startedAt / completedAt) via the canonical `computeTimestampUpdates`.
 */
export function updateInTree(
  items: PRDItem[],
  id: string,
  updates: Partial<PRDItem>,
): boolean {
  // Auto-apply timestamps when status changes
  if (updates.status) {
    const existing = findItemById(items, id);
    if (existing && existing.status !== updates.status) {
      const tsUpdates = computeTimestampUpdates(
        existing.status,
        updates.status as ItemStatus,
        existing,
      );
      Object.assign(updates, tsUpdates);
    }
  }
  return rexUpdateInTree(items, id, updates);
}

/**
 * Find the next actionable task, returning just the item (or null).
 *
 * `options` passes straight through to rex — the callers in reads.ts use
 * `excludeIds` to skip tasks other worktrees hold, the same seam hench's
 * selection uses. Typed via Parameters<> rather than re-exporting rex's
 * PrioritizationOptions through the gateway, which would spend gateway
 * export budget on a type only this wrapper needs.
 */
export function findNextTask(
  items: PRDItem[],
  completedIds: Set<string>,
  options?: Parameters<typeof rexFindNextTask>[2],
): PRDItem | null {
  const entry = rexFindNextTask(items, completedIds, options);
  return entry ? entry.item : null;
}


/** Extract the parent ID from a TreeEntry's parent chain. */
export function parentIdOf(entry: TreeEntry): string | null {
  return entry.parents.length > 0 ? entry.parents[entry.parents.length - 1].id : null;
}

/** Append to execution log (sync, best-effort). */
export function appendLog(ctx: ServerContext, entry: Record<string, unknown>): void {
  try {
    const logPath = join(ctx.rexDir, "execution-log.jsonl");
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch {
    // Best-effort logging
  }
}

/** Who decided a placement a Sidecar card carried out, and why. */
export interface SidecarDecision {
  sessionId: string;
  /** The agent's reasons, when the card carried them. */
  reasons?: readonly string[];
}

/**
 * The optional decision fields a Sidecar placement's log entry carries:
 * `decidedBy` the session, `approvedBy` the operator and `reasons` the agent's.
 * The operator is read as the PRD stamped it (the change's `lastModifiedBy`,
 * which the write just set), so the log names the same identity as the node.
 *
 * `stampedAt` is the timestamp the write stamped with. rex stamps only a node
 * whose content changed, so a write that changed nothing leaves an earlier
 * editor's stamp, and another writer may have landed since: `approvedBy` is
 * kept only when the change's `lastModified` is exactly `stampedAt`.
 * An unreadable PRD drops `approvedBy`; the decision is still worth logging.
 */
export async function sidecarDecisionFields(
  rexDir: string,
  changeId: string,
  decision: SidecarDecision,
  stampedAt?: Date,
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = { decidedBy: `sidecar:${decision.sessionId}` };
  const approvedBy = await loadPrdModel(rexDir)
    .then(({ tree }) => {
      const node = indexTree(tree).resolve(changeId);
      return stampedAt && node?.lastModified !== stampedAt.toISOString() ? undefined : node?.lastModifiedBy;
    })
    .catch(() => undefined);
  if (approvedBy) fields.approvedBy = approvedBy;
  if (decision.reasons?.length) fields.reasons = [...decision.reasons];
  return fields;
}

// Re-export collectCompletedIds for use in reads.ts
export { collectCompletedIds };

/**
 * The 409 text for a whole-tree rewrite the branch guard refused from the
 * dashboard. rex's refusal names the branch; the rest says what the dashboard
 * cannot do, because it has no opt-in: the CLI's `--allow-on-branch` (and MCP's
 * `allowOnBranch`) are deliberate per-run choices, and a dashboard on a
 * worktree, a detached HEAD or a renamed default stays refused.
 */
export function dashboardBranchRefusal(command: "reorganize" | "prune", branch: string, terminalCommand: string): string {
  return `${branchGuardRefusal(command, branch).message} The dashboard cannot override this: switch this checkout to the default branch, or run \`${terminalCommand}\` from a terminal.`;
}
