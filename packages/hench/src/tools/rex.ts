import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PRDStore, PRDItem, ItemStatus, ResolutionType, CommandExecutor } from "../prd/rex-gateway.js";
import { PROJECT_DIRS } from "../prd/llm-gateway.js";
import { execShellCmd } from "../process/index.js";
import { computeTimestampUpdates, findAutoCompletions, validateAutomatedRequirements, formatRequirementsValidation, loadAcknowledged, saveAcknowledged, acknowledgeFinding } from "../prd/rex-gateway.js";
import { validateCompletion, formatValidationResult } from "../validation/completion.js";
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
}

export async function toolRexUpdateStatus(
  store: PRDStore,
  taskId: string,
  params: { status: string; reason?: string; resolutionType?: string },
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
  await store.updateItem(taskId, statusUpdates);
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "status_updated",
    itemId: taskId,
    detail: `Status changed to ${params.status} by hench agent`,
  });

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

  // Auto-complete parent items when a child is completed or deferred
  const autoCompleted: string[] = [];
  if (params.status === "completed" || params.status === "deferred") {
    const doc = await store.loadDocument();
    const { completedItems } = findAutoCompletions(doc.items, taskId);

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

  await store.addItem(subtask, taskId);
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
    });
    return {
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}
