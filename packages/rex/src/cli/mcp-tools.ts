/**
 * Rex MCP tool handler implementations.
 *
 * Each function implements a single MCP tool's logic, receiving the store
 * and tool arguments, returning the MCP response format. This keeps the
 * MCP server module (mcp.ts) focused on tool registration and transport.
 */

import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "../schema/index.js";
import { findItem, resolveItem } from "../core/tree.js";
import { computeStats } from "../core/stats.js";
import { deleteItem, cleanBlockedByRefs } from "../core/delete.js";
import { findNextTask, collectCompletedIds, explainSelection } from "../core/next-task.js";
import { validateTransition } from "../core/transitions.js";
import { computeTimestampUpdates } from "../core/timestamps.js";
import { findAutoCompletions } from "../core/parent-completion.js";
import { validateDAG } from "../core/dag.js";
import { cascadeParentReset } from "../core/parent-reset.js";
import { validateMove, moveItem } from "../core/move.js";
import { validateMerge, previewMerge, mergeItems } from "../core/merge.js";
import { verify } from "../core/verify.js";
import { detectReorganizations } from "../core/reorganize.js";
import { applyProposals } from "../core/reorganize-executor.js";
import { computeHealthScore } from "../core/health.js";
import { computeFacetDistribution, suggestFacets, getItemFacets } from "../core/facets.js";
import { parseIntList } from "./parse-utils.js";
import {
  aggregateItemTokenUsage,
  readRunTokensFromHench,
  type ItemTokenTotals,
} from "../core/item-token-rollup.js";
import {
  aggregateItemDurations,
  type ItemDurationTotals,
} from "../core/item-duration-rollup.js";
import { join } from "node:path";
import { TOOL_VERSION, REX_DIR } from "./commands/constants.js";
import { FileStore, resolvePRDFile } from "../store/index.js";
import { syncFolderTree } from "./commands/folder-tree-sync.js";
import { holdCompletionForRun, describeHeldCompletion } from "./completion-hold.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../schema/index.js";
import type { PRDStore, ClaimsStore, TaskClaim } from "../store/index.js";

/** Standard MCP text response. */
type McpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  warning?: string; // One-time warning (e.g., for migration notifications)
};

function textResult(text: string, isError = false, warning?: string): McpResult {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
    ...(warning ? { warning } : {}),
  };
}

// ── Tool handlers ────────────────────────────────────────────────────────────

export async function handleGetPrdStatus(store: PRDStore): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const overall = computeStats(doc.items);
    const epics = doc.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      branch: item.branch ?? null,
      sourceFile: item.sourceFile ?? null,
      stats: item.children ? computeStats(item.children) : null,
    }));
    return textResult(JSON.stringify({ title: doc.title, overall, epics }, null, 2));
  } catch (err) {
    return textResult(`Error loading PRD: ${(err as Error).message}. Run "rex init" first.`, true);
  }
}

/**
 * Where the caller's claims live and which worktree it is: selection passes
 * over tasks another worktree holds a live claim on. Omit outside a
 * repository (or in tests) to select without looking at claims.
 */
export interface ClaimsContext {
  store: ClaimsStore;
  worktreeRoot: string;
}

/** Wire shape for a claim that made selection skip a task. */
export interface SkippedClaim {
  taskId: string;
  worktreeRoot: string;
  pid: number;
  expiresAt: string;
}

/** Live claims held by other worktrees, as the set `findNextTask` excludes and the list callers report. */
export async function collectForeignClaims(
  claims: ClaimsContext | undefined,
): Promise<{ excludeIds: Set<string>; skipped: SkippedClaim[] }> {
  if (!claims) return { excludeIds: new Set(), skipped: [] };
  const elsewhere = await claims.store.claimedElsewhere(claims.worktreeRoot);
  const skipped = [...elsewhere.values()].map((c: TaskClaim) => ({
    taskId: c.taskId,
    worktreeRoot: c.worktreeRoot,
    pid: c.pid,
    expiresAt: c.expiresAt,
  }));
  return { excludeIds: new Set(elsewhere.keys()), skipped };
}

/** Statuses that mean the caller is done with the task and the claim must go. */
const CLAIM_RELEASING_STATUSES = new Set(["completed", "cancelled", "deferred", "blocked", "failing", "deleted", "pending"]);

/**
 * Take the cross-worktree claim on a task, or report who holds it.
 *
 * `get_next_task` has always *read* claims — it skips tasks another worktree
 * is working on — but nothing on the MCP path ever *wrote* one, so two
 * assistants in two worktrees both saw the same task as free and both picked
 * it. The claim is written where the caller commits to the work: moving a task
 * to `in_progress`, or an explicit `claim_task`.
 *
 * Returns null when the claim is held (or when there is no claims store,
 * outside a repository), so callers can treat it as "nothing in the way".
 */
export async function acquireClaim(
  claims: ClaimsContext | undefined,
  taskId: string,
): Promise<{ ok: true; claim: TaskClaim | null } | { ok: false; heldBy: TaskClaim }> {
  if (!claims) return { ok: true, claim: null };
  const result = await claims.store.claim(taskId, { worktreeRoot: claims.worktreeRoot });
  return result.ok ? { ok: true, claim: result.claim } : { ok: false, heldBy: result.heldBy };
}

/** How a held claim reads to the caller that could not take it. */
export function describeHeldClaim(taskId: string, heldBy: TaskClaim): string {
  return `Task "${taskId}" is claimed by another worktree: ${heldBy.worktreeRoot} (PID ${heldBy.pid}, expires ${heldBy.expiresAt}). `
    + `Pick another task, or pass force: true if that run is finished.`;
}

export async function handleGetNextTask(
  store: PRDStore,
  args?: { tags?: string[] },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const completedIds = collectCompletedIds(doc.items);
    const { excludeIds, skipped } = await collectForeignClaims(claims);
    const options = {
      ...(args?.tags?.length ? { tags: args.tags } : {}),
      ...(excludeIds.size > 0 ? { excludeIds } : {}),
    };
    const result = findNextTask(doc.items, completedIds, options);
    // Only claims on tasks that would otherwise have been candidates matter to
    // the caller; a claim on a completed task is noise.
    const skippedClaimed = skipped.filter((c) => !completedIds.has(c.taskId));
    if (!result) {
      return textResult(JSON.stringify({
        next: null,
        message: skippedClaimed.length > 0
          ? `No actionable tasks remaining that are not claimed by another worktree (${skippedClaimed.length} claimed elsewhere)`
          : "No actionable tasks remaining",
        ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
      }));
    }
    const explanation = explainSelection(doc.items, result, completedIds);
    return textResult(
      JSON.stringify(
        {
          item: result.item,
          parentChain: result.parents.map((p) => ({
            id: p.id,
            title: p.title,
            level: p.level,
          })),
          explanation,
          ...(skippedClaimed.length > 0 ? { skippedClaimed } : {}),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleUpdateTaskStatus(
  store: PRDStore,
  projectDir: string,
  args: { id: string; status: string; force?: boolean; reason?: string; resolutionType?: string; resolutionDetail?: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    const { id, status, force, reason, resolutionType, resolutionDetail } = args;
    const existing = await store.getItem(id);
    if (!existing) {
      return textResult(`Item "${id}" not found. Use get_prd_status to see available items.`, true);
    }

    if (!force) {
      const transition = validateTransition(existing.status, status as ItemStatus);
      if (!transition.allowed) {
        return textResult(`${transition.message} Pass force: true to override.`, true);
      }
    }

    // A hench run in this worktree applies the completion itself, after its
    // test gate — see cli/completion-hold.ts. Recorded, not written: no PRD
    // save, no claim release, and nothing in the tree for `git add -A`.
    if (status === "completed") {
      const held = await holdCompletionForRun(claims, id, { resolutionType, resolutionDetail });
      if (held) {
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "completion_held",
          itemId: id,
          detail: `Completion held for hench run (pid ${held.pid}) until its test gate passes`,
        });
        return textResult(JSON.stringify({
          id,
          title: existing.title,
          previousStatus: existing.status,
          newStatus: existing.status,
          completionHeld: true,
          message: describeHeldCompletion(id, held),
        }));
      }
    }

    // Starting work is where the claim is taken: it is the point the caller
    // commits to the task, and it is a step the ndx-work flow already
    // performs. Refuse rather than write a status that contradicts a live
    // claim held by another worktree — that is the double-pick this prevents.
    let claimed: TaskClaim | null = null;
    if (status === "in_progress") {
      const attempt = await acquireClaim(claims, id);
      if (!attempt.ok) {
        if (!force) return textResult(describeHeldClaim(id, attempt.heldBy), true);
      } else {
        claimed = attempt.claim;
      }
    }

    // Handle deletion: remove item and children from tree. The transaction
    // holds the PRD lock across the whole read-modify-write so a concurrent
    // writer's item cannot be clobbered by this full-document save.
    if (status === "deleted") {
      if (claims) await claims.store.release(id, { worktreeRoot: claims.worktreeRoot });
      const deletedIds = await store.withTransaction(async (doc) => {
        const ids = deleteItem(doc.items, id);
        cleanBlockedByRefs(doc.items, new Set(ids));
        return ids;
      });

      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "item_deleted",
        itemId: id,
        detail: `Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`,
      });

      await syncFolderTree(join(projectDir, REX_DIR), store);

      return textResult(
        JSON.stringify({
          id,
          title: existing.title,
          deleted: true,
          removedCount: deletedIds.length,
          removedIds: deletedIds,
        }),
      );
    }

    const tsUpdates = computeTimestampUpdates(existing.status, status as ItemStatus, existing);
    const statusUpdates: Partial<PRDItem> = { status: status as ItemStatus, ...tsUpdates };
    if (status === "failing" && reason) {
      statusUpdates.failureReason = reason;
    }
    if (status === "completed" && resolutionType) {
      statusUpdates.resolutionType = resolutionType as PRDItem["resolutionType"];
    }
    if (status === "completed" && resolutionDetail) {
      statusUpdates.resolutionDetail = resolutionDetail;
    }
    await store.updateItem(id, statusUpdates, { applyAttribution: true, projectDir });
    // The task is no longer being worked here, so the claim must not outlive
    // the run — otherwise the next worktree to ask is told it is taken for the
    // rest of the TTL.
    if (claims && CLAIM_RELEASING_STATUSES.has(status)) await claims.store.release(id, { worktreeRoot: claims.worktreeRoot });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "status_changed",
      itemId: id,
      detail: `${existing.status} → ${status}${force ? " (forced)" : ""}`,
    });

    // Re-check parent auto-completion after this status change. A deferred
    // status can never itself make a parent auto-completable (only a fully
    // `completed` child set can — see parent-completion.ts), but re-checking
    // here is harmless and keeps this in sync with mcp-tools' other trigger.
    const autoCompleted: Array<{ id: string; title: string; level: string }> = [];
    if (status === "completed" || status === "deferred") {
      const doc = await store.loadDocument();
      const { completedItems } = findAutoCompletions(doc.items, id);

      for (const item of completedItems) {
        const parentItem = await store.getItem(item.id);
        if (!parentItem) continue;

        const parentTsUpdates = computeTimestampUpdates(
          parentItem.status,
          "completed",
          parentItem,
        );
        await store.updateItem(item.id, {
          status: "completed" as ItemStatus,
          ...parentTsUpdates,
          // Cascaded close, not a deliberate edit of this ancestor — leave its
          // authorship with whoever last touched it on purpose (#368).
        }, { applyAttribution: true, preserveModifiedBy: true, projectDir });
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "auto_completed",
          itemId: item.id,
          detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
        });
        autoCompleted.push(item);
      }
    }

    await syncFolderTree(join(projectDir, REX_DIR), store);

    return textResult(
      JSON.stringify({
        id,
        title: existing.title,
        previousStatus: existing.status,
        newStatus: status,
        ...(claimed ? { claim: { worktreeRoot: claimed.worktreeRoot, pid: claimed.pid, expiresAt: claimed.expiresAt } } : {}),
        ...(autoCompleted.length > 0 ? { autoCompleted } : {}),
      }),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

/**
 * `claim_task` — hold a task for this worktree before the work starts.
 *
 * `update_task_status` claims on `in_progress`, but a session selects a task,
 * plans it and only then starts: without this, that window is exactly when the
 * other worktree picks the same task. Claiming at selection closes it.
 */
export async function handleClaimTask(
  store: PRDStore,
  args: { id: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    const existing = await store.getItem(args.id);
    if (!existing) {
      return textResult(`Item "${args.id}" not found. Use get_prd_status to see available items.`, true);
    }
    if (!claims) {
      return textResult(JSON.stringify({ id: args.id, claimed: false, reason: "not a git repository — claims are a no-op here" }));
    }
    const attempt = await acquireClaim(claims, args.id);
    if (!attempt.ok) return textResult(describeHeldClaim(args.id, attempt.heldBy), true);
    return textResult(JSON.stringify({
      id: args.id,
      title: existing.title,
      claimed: true,
      worktreeRoot: attempt.claim?.worktreeRoot ?? claims.worktreeRoot,
      expiresAt: attempt.claim?.expiresAt ?? null,
    }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

/** `release_task` — give a claim back without moving the task's status. */
export async function handleReleaseTask(
  args: { id: string },
  claims?: ClaimsContext,
): Promise<McpResult> {
  try {
    const released = claims ? await claims.store.release(args.id, { worktreeRoot: claims.worktreeRoot }) : false;
    if (!released && claims) {
      const runClaim = (await claims.store.readClaims()).find(
        (c) => c.taskId === args.id && c.holdsCompletion && c.worktreeRoot === claims.worktreeRoot,
      );
      if (runClaim) {
        return textResult(JSON.stringify({
          id: args.id,
          released: false,
          reason: `held by the hench run working this task (pid ${runClaim.pid}); it releases the claim when the run ends`,
        }));
      }
    }
    return textResult(JSON.stringify({ id: args.id, released }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleAddItem(
  store: PRDStore,
  projectDir: string,
  rexDir: string,
  args: {
    title: string;
    level: string;
    parentId?: string;
    description?: string;
    priority?: string;
    acceptanceCriteria?: string[];
    tags?: string[];
    source?: string;
    blockedBy?: string[];
  },
): Promise<McpResult> {
  try {
    if (!args.parentId && store instanceof FileStore) {
      const resolution = await resolvePRDFile(rexDir, projectDir);
      store.setCurrentBranchFile(resolution.filename);
    }

    const id = randomUUID();
    const item: PRDItem = {
      id,
      title: args.title,
      level: args.level as ItemLevel,
      status: "pending",
    };
    if (args.description) item.description = args.description;
    if (args.priority) item.priority = args.priority as Priority;
    if (args.acceptanceCriteria) item.acceptanceCriteria = args.acceptanceCriteria;
    if (args.tags) item.tags = args.tags;
    if (args.source) item.source = args.source;
    if (args.blockedBy) item.blockedBy = args.blockedBy;

    // Validate dependencies before persisting
    if (item.blockedBy && item.blockedBy.length > 0) {
      const doc = await store.loadDocument();
      const simItems = [...doc.items, item];
      const dagResult = validateDAG(simItems);
      if (!dagResult.valid) {
        return textResult(
          `Invalid dependencies: ${dagResult.errors.join("; ")}. Check IDs with get_prd_status.`,
          true,
        );
      }
    }

    await store.addItem(item, args.parentId, { applyAttribution: true, projectDir });

    // Reset completed ancestors when adding under a completed parent
    const { resetItems } = await cascadeParentReset(store, args.parentId, {
      applyAttribution: true,
      projectDir,
    });

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: id,
      detail: `Added ${args.level}: ${args.title}`,
    });

    await syncFolderTree(rexDir, store);

    return textResult(JSON.stringify({ id, level: args.level, title: args.title, resetItems }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleMoveItem(
  store: PRDStore,
  rexDir: string,
  args: { id: string; parentId?: string },
): Promise<McpResult> {
  try {
    const { id, parentId } = args;

    // Validate and move inside one transaction so the lock covers the whole
    // read-modify-write — a concurrent writer's item survives this save.
    const outcome = await store.withTransaction(async (doc) => {
      const validation = validateMove(doc.items, id, parentId);
      if (!validation.valid) {
        return {
          ok: false as const,
          message: `${validation.error}${validation.suggestion ? ` ${validation.suggestion}` : ""}`,
        };
      }
      return { ok: true as const, result: moveItem(doc.items, id, parentId) };
    });
    if (!outcome.ok) {
      return textResult(outcome.message, true);
    }
    const result = outcome.result;

    const fromLabel = result.previousParentId ?? "root";
    const toLabel = result.newParentId ?? "root";
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_moved",
      itemId: id,
      detail: `Moved ${result.item.level} "${result.item.title}" from ${fromLabel} to ${toLabel}`,
    });

    await syncFolderTree(rexDir, store);

    return textResult(
      JSON.stringify({
        id,
        title: result.item.title,
        level: result.item.level,
        previousParentId: result.previousParentId,
        newParentId: result.newParentId,
      }),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleMergeItems(
  store: PRDStore,
  rexDir: string,
  args: {
    sourceIds: string[];
    targetId: string;
    preview?: boolean;
    title?: string;
    description?: string;
  },
): Promise<McpResult> {
  try {
    const { sourceIds, targetId, preview, title, description } = args;

    const options = {
      ...(title ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    };

    if (preview) {
      const doc = await store.loadDocument();
      const validation = validateMerge(doc.items, sourceIds, targetId);
      if (!validation.valid) {
        return textResult(`${validation.error}`, true);
      }
      const previewResult = previewMerge(doc.items, sourceIds, targetId, options);
      return textResult(JSON.stringify(previewResult, null, 2));
    }

    // Validate and merge inside one transaction so the lock covers the whole
    // read-modify-write — a concurrent writer's item survives this save.
    const outcome = await store.withTransaction(async (doc) => {
      const validation = validateMerge(doc.items, sourceIds, targetId);
      if (!validation.valid) {
        return { ok: false as const, message: `${validation.error}` };
      }
      return { ok: true as const, result: mergeItems(doc.items, sourceIds, targetId, options) };
    });
    if (!outcome.ok) {
      return textResult(outcome.message, true);
    }
    const result = outcome.result;

    const absorbedTitles = result.absorbedIds
      .map((id) => `"${id}"`)
      .join(", ");
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "items_merged",
      itemId: targetId,
      detail: `Merged ${sourceIds.length} items into "${targetId}". Absorbed: ${absorbedTitles}. ${result.reparentedChildIds.length} children reparented, ${result.rewrittenDependencyCount} dependency references rewritten.`,
    });

    await syncFolderTree(rexDir, store);

    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleGetItem(
  store: PRDStore,
  args: { id: string },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const entry = resolveItem(doc.items, args.id);
    if (!entry) {
      return textResult(`Item "${args.id}" not found. Use get_prd_status to see available items.`, true);
    }
    return textResult(
      JSON.stringify(
        {
          item: entry.item,
          parentChain: entry.parents.map((p) => ({
            id: p.id,
            title: p.title,
            level: p.level,
          })),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleAppendLog(
  store: PRDStore,
  args: { event: string; itemId?: string; detail?: string },
): Promise<McpResult> {
  try {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: args.event,
      itemId: args.itemId,
      detail: args.detail,
    });
    return textResult(JSON.stringify({ logged: true, event: args.event }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleSyncWithRemote(
  store: PRDStore,
  rexDir: string,
  args: { direction?: string; adapter?: string },
  resolveRemoteStore: (dir: string, adapter: string) => Promise<any>,
  SyncEngine: new (store: PRDStore, remote: any) => any,
): Promise<McpResult> {
  try {
    const syncDirection = args.direction ?? "sync";
    const adapterName = args.adapter ?? "notion";

    let remote;
    try {
      remote = await resolveRemoteStore(rexDir, adapterName);
    } catch {
      return textResult(
        `Adapter "${adapterName}" is not configured. Run 'rex adapter add ${adapterName}' to configure it.`,
        true,
      );
    }

    const engine = new SyncEngine(store, remote);

    let report;
    switch (syncDirection) {
      case "push":
        report = await engine.push();
        break;
      case "pull":
        report = await engine.pull();
        break;
      default:
        report = await engine.sync();
        break;
    }

    await store.appendLog({
      timestamp: report.timestamp,
      event: "sync_completed",
      detail: `${syncDirection} sync with ${adapterName}: ${report.pushed.length} pushed, ${report.pulled.length} pulled, ${report.conflicts.length} conflicts`,
    });

    return textResult(JSON.stringify(report, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleGetRecommendations(): Promise<McpResult> {
  return textResult(
    JSON.stringify({
      available: false,
      message: "SourceVision integration not yet configured. Use 'rex recommend' CLI command.",
    }),
  );
}

export async function handleVerifyCriteria(
  store: PRDStore,
  dir: string,
  args: { taskId?: string; runTests?: boolean },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const config = await store.loadConfig();
    const result = await verify({
      projectDir: dir,
      items: doc.items,
      taskId: args.taskId,
      testCommand: config.test,
      runTests: args.runTests ?? true,
    });
    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleReorganize(
  store: PRDStore,
  dir: string,
  args: { accept?: string; includeCompleted?: boolean; mode?: string },
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    if (doc.items.length === 0) {
      return textResult(JSON.stringify({ structural: { proposals: [], stats: {} }, llm: [] }, null, 2));
    }

    const plan = detectReorganizations(doc.items, {
      includeCompleted: args.includeCompleted ?? false,
    });

    // LLM proposals (unless mode=fast)
    let llmProposals: Array<{ id: string; action: string; reason: string }> = [];
    if (args.mode !== "fast") {
      try {
        const { reasonForReshape } = await import("../analyze/reshape-reason.js");
        const { setLLMConfig, setClaudeConfig, setProjectDir } = await import("../analyze/reason.js");
        const { loadLLMConfig, loadClaudeConfig } = await import("../store/project-config.js");
        const { REX_DIR } = await import("./commands/constants.js");
        const { join } = await import("node:path");

        const rexDir = join(dir, REX_DIR);
        const llmConfig = await loadLLMConfig(rexDir);
        setLLMConfig(llmConfig);
        const claudeConfig = await loadClaudeConfig(rexDir);
        setClaudeConfig(claudeConfig);
        setProjectDir(dir);

        const { proposals } = await reasonForReshape(doc.items, { dir });
        llmProposals = proposals.map((p) => ({
          id: p.id,
          action: p.action.action,
          reason: p.action.reason,
        }));
      } catch {
        // LLM unavailable — continue with structural only
      }
    }

    if (!args.accept) {
      // Detection only
      return textResult(JSON.stringify({
        structural: {
          proposals: plan.proposals.map((p) => ({
            id: p.id,
            type: p.type,
            description: p.description,
            risk: p.risk,
            confidence: p.confidence,
            items: p.items,
          })),
          stats: plan.stats,
        },
        llm: llmProposals,
      }, null, 2));
    }

    // Apply proposals
    let toApply = plan.proposals;
    if (args.accept === "low-risk") {
      toApply = plan.proposals.filter((p) => p.risk === "low");
    } else if (args.accept !== "all") {
      // Parse comma-separated IDs
      const ids = new Set(parseIntList(args.accept));
      toApply = plan.proposals.filter((p) => ids.has(p.id));
    }

    let applied = 0;
    let failed = 0;

    if (toApply.length > 0) {
      // Proposals were computed on a snapshot (the LLM call above may take
      // minutes); re-apply them against a freshly loaded document under the
      // lock so a concurrent writer's item is not clobbered by the save.
      const result = await store.withTransaction(async (freshDoc) =>
        applyProposals(freshDoc.items, toApply),
      );
      applied = result.applied;
      failed = result.failed;
    }

    if (applied > 0) {
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "reorganize_applied",
        detail: `Applied ${applied} reorganization proposals via MCP`,
      });
    }

    return textResult(JSON.stringify({ applied, failed, llm: llmProposals }, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleHealth(store: PRDStore): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const health = computeHealthScore(doc.items);
    return textResult(JSON.stringify(health, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleFacets(
  store: PRDStore,
  args: { itemId?: string },
): Promise<McpResult> {
  try {
    const config = await store.loadConfig();
    const facetConfig = config.facets ?? {};
    const doc = await store.loadDocument();

    if (args.itemId) {
      // Suggest facets for a specific item
      const entry = findItem(doc.items, args.itemId);
      if (!entry) {
        return textResult(`Item "${args.itemId}" not found.`, true);
      }
      const parent = entry.parents.length > 0 ? entry.parents[entry.parents.length - 1] : undefined;
      const currentFacets = getItemFacets(entry.item);
      const suggestions = Object.keys(facetConfig).length > 0
        ? suggestFacets(entry.item, facetConfig, parent)
        : [];
      return textResult(JSON.stringify({ itemId: args.itemId, currentFacets, suggestions }, null, 2));
    }

    // List configured facets + distribution
    const distribution = Object.keys(facetConfig).length > 0
      ? computeFacetDistribution(doc.items, facetConfig)
      : {};
    return textResult(JSON.stringify({ facets: facetConfig, distribution }, null, 2));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleEditItem(
  store: PRDStore,
  projectDir: string,
  args: {
    id: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority?: string;
    level?: string;
    tags?: string[];
    source?: string;
    blockedBy?: string[];
  },
): Promise<McpResult> {
  try {
    const existing = await store.getItem(args.id);
    if (!existing) {
      return textResult(
        `Item "${args.id}" not found. Use get_prd_status to see available items.`,
        true,
      );
    }

    const VALID_LEVELS = ["epic", "feature", "task", "subtask"];
    const updates: Partial<PRDItem> = {};
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.acceptanceCriteria !== undefined) updates.acceptanceCriteria = args.acceptanceCriteria;
    if (args.priority !== undefined) updates.priority = args.priority as Priority;
    if (args.level !== undefined) {
      if (!VALID_LEVELS.includes(args.level)) {
        return textResult(`Invalid level "${args.level}". Must be one of: ${VALID_LEVELS.join(", ")}`, true);
      }
      updates.level = args.level as PRDItem["level"];
    }
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.source !== undefined) updates.source = args.source;
    if (args.blockedBy !== undefined) {
      // Validate dependencies before persisting
      const doc = await store.loadDocument();
      const simItem = { ...existing, blockedBy: args.blockedBy };
      const entry = findItem(doc.items, args.id);
      if (entry) {
        // Replace in-tree temporarily for DAG validation
        Object.assign(entry.item, { blockedBy: args.blockedBy });
        const dagResult = validateDAG(doc.items);
        // Restore original
        Object.assign(entry.item, { blockedBy: existing.blockedBy });
        if (!dagResult.valid) {
          return textResult(
            `Invalid dependencies: ${dagResult.errors.join("; ")}. Check IDs with get_prd_status.`,
            true,
          );
        }
      }
      updates.blockedBy = args.blockedBy;
    }

    if (Object.keys(updates).length === 0) {
      return textResult(
        "No fields to update. Provide at least one field (title, description, acceptanceCriteria, priority, tags, source, blockedBy).",
        true,
      );
    }

    await store.updateItem(args.id, updates, { applyAttribution: true, projectDir });

    const changedFields = Object.keys(updates);
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_edited",
      itemId: args.id,
      detail: `Edited ${existing.level} "${existing.title}": ${changedFields.join(", ")}`,
    });

    await syncFolderTree(join(projectDir, REX_DIR), store);

    const updated = await store.getItem(args.id);
    return textResult(
      JSON.stringify({
        id: args.id,
        updatedFields: changedFields,
        item: updated,
      }, null, 2),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

/**
 * Roll up hench run token totals and work durations across every PRD item.
 *
 * Returns a combined `{ tokens, duration }` record for every item in the
 * tree, where `tokens` is the token-rollup triple (self/descendants/total
 * plus runCount) and `duration` is `{ totalMs, runningMs, isRunning }`.
 * Runs whose `itemId` is no longer in the PRD (archived, pruned, deleted)
 * are reported as `orphans`.
 *
 * Duration fields update on each call based on the wall clock; completed
 * subtrees return stable `totalMs` values.
 *
 * If `id` is provided, the response is narrowed to that single item.
 */
export async function handleGetTokenUsage(
  store: PRDStore,
  projectDir: string,
  args: { id?: string } = {},
): Promise<McpResult> {
  try {
    const doc = await store.loadDocument();
    const runs = await readRunTokensFromHench(projectDir);
    const { totals, orphans } = aggregateItemTokenUsage(doc.items, runs);
    const { durations } = aggregateItemDurations(doc.items);

    const emptyDuration: ItemDurationTotals = {
      totalMs: 0,
      runningMs: 0,
      isRunning: false,
    };

    if (args.id) {
      const t = totals.get(args.id);
      if (!t) {
        return textResult(
          `Item "${args.id}" not found. Use get_prd_status to see available items.`,
          true,
        );
      }
      const d = durations.get(args.id) ?? emptyDuration;
      return textResult(
        JSON.stringify(
          { id: args.id, tokens: t, duration: d },
          null,
          2,
        ),
      );
    }

    const items: Array<{
      id: string;
      tokens: ItemTokenTotals;
      duration: ItemDurationTotals;
    }> = [];
    for (const [id, t] of totals) {
      items.push({ id, tokens: t, duration: durations.get(id) ?? emptyDuration });
    }

    const orphanTotal = orphans.reduce(
      (acc, o) => ({
        input: acc.input + o.tokens.input,
        output: acc.output + o.tokens.output,
        cacheCreation: acc.cacheCreation + o.tokens.cacheCreation,
        cacheRead: acc.cacheRead + o.tokens.cacheRead,
        total: acc.total + o.tokens.total,
      }),
      { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, total: 0 },
    );

    return textResult(
      JSON.stringify(
        {
          items,
          orphans: {
            count: orphans.length,
            totals: orphanTotal,
            runs: orphans,
          },
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export async function handleGetCapabilities(store: PRDStore): Promise<McpResult> {
  try {
    const config = await store.loadConfig();
    const caps = store.capabilities();
    return textResult(
      JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          toolVersion: TOOL_VERSION,
          adapter: caps.adapter,
          supportsTransactions: caps.supportsTransactions,
          supportsWatch: caps.supportsWatch,
          sourcevision: config.sourcevision ?? "disabled",
          future: config.future ?? {},
        },
        null,
        2,
      ),
    );
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}
