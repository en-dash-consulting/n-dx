import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PRDStore, PRDItem, ItemStatus, ResolutionType, CommandExecutor } from "../prd/rex-gateway.js";
import { PROJECT_DIRS, repoCommandEnv } from "../prd/llm-gateway.js";
import { execShellCmd } from "../process/exec.js";
import { completeV2Work, computeTimestampUpdates, isChangeLayerStore, reconcileAutoCompletions,validateAutomatedRequirements, formatRequirementsValidation, loadAcknowledged, saveAcknowledged, acknowledgeFinding, openClaimsStore, resolveClaimHolder } from "../prd/rex-gateway.js";
import { validateCompletion, formatValidationResult } from "../validation/completion.js";
import { isFinalizeReadyParent } from "../validation/finalize-ready.js";
import type {
  RexToolHandlers,
  ToolContext,
  RexUpdateStatusParams,
  RexAppendLogParams,
  RexAddSubtaskParams,
} from "./contracts.js";

export interface UpdateStatusOptions {
  /** Project directory for git-based completion validation. */
  projectDir?: string;
  /** Test command to run during completion validation. */
  testCommand?: string;
  /** Commit hash captured before the agent started, for diffing against. */
  startingHead?: string;
  /** When true, reject doc-only completions. */
  selfHeal?: boolean;
  /**
   * Set on the agent's own tool call, never on hench's internal writes: a
   * completion that passes validation is recorded on the run's claim for the
   * lifecycle to apply after the test gate, instead of being written. The same
   * hold rex applies to the agent's MCP and CLI calls — see
   * `TaskClaims.pendingCompletion`.
   */
  holdCompletionForRun?: boolean;
}

export async function toolRexUpdateStatus(
  store: PRDStore,
  taskId: string,
  params: { status: string; reason?: string; resolutionType?: string; resolutionDetail?: string },
  options?: UpdateStatusOptions,
): Promise<string> {
  const validStatuses = ["pending", "in_progress", "completed", "failing", "deferred", "blocked"];
  if (!validStatuses.includes(params.status)) {
    throw new Error(
      `Invalid status "${params.status}". Valid: ${validStatuses.join(", ")}`,
    );
  }

  // Validate completion: require meaningful changes before marking complete
  if (params.status === "completed" && options?.projectDir) {
    const validation = await validateCompletion(options.projectDir, {
      testCommand: options.testCommand,
      startingHead: options.startingHead,
      selfHeal: options.selfHeal,
      finalizeReadyParent: await isFinalizeReadyParent(store, taskId),
    });

    if (!validation.valid) {
      const detail = formatValidationResult(validation);
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "completion_rejected",
        itemId: taskId,
        detail,
      });
      return `[COMPLETION_REJECTED] Cannot mark task as completed: ${validation.reason}\n` +
        `The task must produce meaningful changes (non-empty git diff) to be marked complete. ` +
        `If you believe the task is done, review your changes and ensure they are committed or staged.`;
    }

    // Validate automated/metric requirements (manual requirements are logged but don't block)
    const doc = await store.loadDocument();
    const reqSummary = await validateAutomatedRequirements(
      doc.items,
      taskId,
      createCommandExecutor(options.projectDir),
    );

    if (reqSummary.total > 0 && !reqSummary.allPassed) {
      const detail = formatRequirementsValidation(reqSummary);
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "requirements_validation_failed",
        itemId: taskId,
        detail,
      });
      const failedReqs = reqSummary.results
        .filter((r) => !r.passed)
        .map((r) => `  - ${r.requirementTitle}: ${r.reason}`)
        .join("\n");
      return `[REQUIREMENTS_FAILED] Cannot mark task as completed. ` +
        `${reqSummary.failed} of ${reqSummary.total} automated requirements failed:\n` +
        `${failedReqs}\n` +
        `Fix the failing requirements and try again.`;
    }

    // Log successful requirements validation (if any requirements existed)
    if (reqSummary.total > 0) {
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "requirements_validated",
        itemId: taskId,
        detail: `All ${reqSummary.total} automated requirements passed`,
      });
    }
  }

  if (params.status === "completed" && options?.holdCompletionForRun && options.projectDir) {
    const held = await openClaimsStore(options.projectDir).recordPendingCompletion(
      taskId,
      { worktreeRoot: resolveClaimHolder(options.projectDir).worktreeRoot },
      {
        ...(params.resolutionType ? { resolutionType: params.resolutionType } : {}),
        ...(params.resolutionDetail ? { resolutionDetail: params.resolutionDetail } : {}),
        requestedAt: new Date().toISOString(),
      },
    );
    if (held) {
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "completion_held",
        itemId: taskId,
        detail: "Completion held until the test gate passes",
      });
      return `[COMPLETION_HELD] Completion of ${taskId} recorded, not yet applied: hench marks the task ` +
        `completed itself once its full test gate passes. Nothing more to do.`;
    }
  }

  const v2 = isChangeLayerStore(store);
  if (params.status === "completed" && v2) return completeOnV2(store, taskId, params);

  const existing = await store.getItem(taskId);
  const tsUpdates = computeTimestampUpdates(
    existing?.status ?? "pending",
    params.status as ItemStatus,
    existing ?? undefined,
  );
  const statusUpdates: Partial<PRDItem> = { status: params.status as ItemStatus, ...tsUpdates };
  if (params.status === "failing" && params.reason) {
    statusUpdates.failureReason = params.reason;
  }
  if (params.status === "completed" && params.resolutionType) {
    statusUpdates.resolutionType = params.resolutionType as ResolutionType;
  }
  if (params.status === "completed" && params.resolutionDetail) {
    statusUpdates.resolutionDetail = params.resolutionDetail;
  }
  await store.updateItem(taskId, statusUpdates, {
    applyAttribution: true,
    ...(options?.projectDir ? { projectDir: options.projectDir } : {}),
  });

  await logStatusUpdated(store, taskId, params.status);

  // Auto-acknowledge sourcevision findings when a task is deferred
  if (params.status === "deferred" && existing?.tags && options?.projectDir) {
    const findingTags = existing.tags.filter((t: string) => t.startsWith("finding:"));
    if (findingTags.length > 0) {
      try {
        const rexDir = join(options.projectDir, PROJECT_DIRS.REX);
        let ackStore = await loadAcknowledged(rexDir);
        for (const tag of findingTags) {
          const hash = tag.slice("finding:".length);
          ackStore = acknowledgeFinding(ackStore, hash, existing.title, "deferred", "hench");
        }
        await saveAcknowledged(rexDir, ackStore);
      } catch {
        // Non-fatal: finding acknowledgment is best-effort
      }
    }
  }

  // Auto-complete parent items using a reconciliation sweep contained to this
  // task's own ancestors. reconcileAutoCompletions (not findAutoCompletions)
  // still heals ancestors left stuck pending by a previously-missed cascade,
  // but `ancestorsOf` bounds it to the chain above `taskId`.
  //
  // The sweep used to be whole-tree, on the theory that healing every stuck
  // parent in the PRD was a free bonus. It was not (GitHub #368): a run that
  // hit the session limit on turn 1 — zero tool calls, no agent work at all —
  // deferred its own task here, and the sweep went on to complete an
  // in_progress task and its epic in an unrelated part of the tree, rewriting
  // their authorship on the way out. Containment is what bounds the blast
  // radius of this call to the subtree the run is actually operating on,
  // whatever the completion predicate decides.
  //
  // Not on a v2 tree: a change completes only through completeOnV2, which
  // applies it. This cascade would complete one over the projection unapplied.
  const autoCompleted: string[] = [];
  if (!v2 && (params.status === "completed" || params.status === "deferred")) {
    const doc = await store.loadDocument();
    const { completedItems } = reconcileAutoCompletions(doc.items, { ancestorsOf: taskId });

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
      }, {
        applyAttribution: true,
        // The user asked to update `taskId`, not this ancestor. Closing it is
        // a consequence, so it must not also reassign its authorship (#368).
        preserveModifiedBy: true,
        ...(options?.projectDir ? { projectDir: options.projectDir } : {}),
      });
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "auto_completed",
        itemId: item.id,
        detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
      });
      autoCompleted.push(`${item.level}: ${item.title}`);
    }
  }

  const msg = `Updated task ${taskId} status to ${params.status}`;
  if (autoCompleted.length > 0) {
    return `${msg}\nAuto-completed: ${autoCompleted.join(", ")}`;
  }
  return msg;
}

/** status_updated is best-effort: a failure must not cancel the cascade or the apply report. */
async function logStatusUpdated(store: PRDStore, taskId: string, status: string): Promise<void> {
  try {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "status_updated",
      itemId: taskId,
      detail: `Status changed to ${status} by hench agent`,
    });
  } catch (err) {
    // Surface a trace so a dropped status_updated entry isn't completely
    // silent (the tool has no run handle for diagnostics).
    console.warn(
      `[rex] status_updated log append failed for ${taskId} (non-fatal): ${(err as Error).message}`,
    );
  }
}

/**
 * Complete `taskId` on a v2 tree through rex's v2 runtime, the entry point
 * `update_task_status` uses there: the task's change completes with its last
 * task and applies per `rex.applyOn`, in one transaction. Logs what completed
 * and applied (`auto_completed`, `change_applied`) as rex does.
 */
async function completeOnV2(
  store: Parameters<typeof completeV2Work>[0],
  taskId: string,
  params: { status: string; resolutionType?: string; resolutionDetail?: string },
): Promise<string> {
  const done = await completeV2Work(store, taskId, {
    ...(params.resolutionType ? { resolutionType: params.resolutionType as ResolutionType } : {}),
    ...(params.resolutionDetail ? { resolutionDetail: params.resolutionDetail } : {}),
  });
  await logStatusUpdated(store, taskId, params.status);

  const lines = [`Updated task ${taskId} status to ${params.status}`];
  if (done.autoCompleted.length > 0) {
    // Titles only: `level` is the v1 projection's, which names a change an epic or feature.
    lines.push(`Auto-completed: ${done.autoCompleted.map((i) => `"${i.title}" (${i.id})`).join(", ")}`);
  }
  if (done.changeId && done.changeCompleted) {
    lines.push(done.applied
      ? `Change ${done.changeId} applied to the product layer`
      : `Change ${done.changeId} completed, not applied${done.reason ? `: ${done.reason}` : ""}`);
  } else if (done.changeId && done.reason) {
    lines.push(`Change ${done.changeId} held open: ${done.reason}`);
  }
  for (const warning of done.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}

export async function toolRexAppendLog(
  store: PRDStore,
  taskId: string,
  params: { event: string; detail?: string },
): Promise<string> {
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: params.event,
    itemId: taskId,
    detail: params.detail,
  });

  return `Logged event: ${params.event}`;
}

export async function toolRexAddSubtask(
  store: PRDStore,
  taskId: string,
  params: { title: string; description?: string; priority?: string },
): Promise<string> {
  const validPriorities = ["critical", "high", "medium", "low"];
  if (params.priority && !validPriorities.includes(params.priority)) {
    throw new Error(
      `Invalid priority "${params.priority}". Valid: ${validPriorities.join(", ")}`,
    );
  }

  const id = randomUUID();
  const subtask = {
    id,
    title: params.title,
    status: "pending" as ItemStatus,
    level: "subtask" as const,
    description: params.description,
    priority: params.priority as "critical" | "high" | "medium" | "low" | undefined,
  };

  await store.addItem(subtask, taskId, { applyAttribution: true });
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "subtask_added",
    itemId: id,
    detail: `Added subtask "${params.title}" under ${taskId}`,
  });

  return `Created subtask ${id}: ${params.title}`;
}

export const rexToolHandlers: RexToolHandlers = {
  updateStatus: (ctx: ToolContext, params: RexUpdateStatusParams) =>
    toolRexUpdateStatus(
      ctx.store,
      ctx.taskId,
      params,
      {
        projectDir: ctx.projectDir,
        testCommand: ctx.testCommand,
        startingHead: ctx.startingHead,
        selfHeal: ctx.selfHeal,
        holdCompletionForRun: true,
      },
    ),
  appendLog: (ctx: ToolContext, params: RexAppendLogParams) =>
    toolRexAppendLog(ctx.store, ctx.taskId, params),
  addSubtask: (ctx: ToolContext, params: RexAddSubtaskParams) =>
    toolRexAddSubtask(ctx.store, ctx.taskId, params),
};

// ── Requirements command executor ─────────────────────────────────

const REQ_CMD_TIMEOUT = 30_000;

/**
 * Create a CommandExecutor that runs shell commands in the project directory.
 * Used by requirements validation to execute validation commands.
 */
export function createCommandExecutor(projectDir: string): CommandExecutor {
  return async (command: string) => {
    const result = await execShellCmd(command, {
      cwd: projectDir,
      timeout: REQ_CMD_TIMEOUT,
      env: repoCommandEnv(projectDir),
    });
    // A command that never launched returns exitCode 1 with empty output, and
    // the CommandExecutor contract has no field to say "could not run" — so the
    // spawn error is folded into stderr rather than dropped. Without it the
    // validation records a failed command with no reason attached. Reporting it
    // properly would mean widening CommandExecutor in rex; the exit code stays 1
    // either way, so the validation outcome is unchanged.
    const stderr = result.launched
      ? result.stderr
      : `${result.stderr}${result.error?.message ?? "command could not be spawned"}`;
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr,
    };
  };
}
