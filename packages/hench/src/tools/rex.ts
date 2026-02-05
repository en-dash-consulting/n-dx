import { randomUUID } from "node:crypto";
import type { PRDStore } from "rex/dist/store/types.js";
import type { ItemStatus } from "rex/dist/schema/v1.js";
import { computeTimestampUpdates } from "rex/dist/core/timestamps.js";
import { findAutoCompletions } from "rex/dist/core/parent-completion.js";
import { validateCompletion, formatValidationResult } from "../validation/completion.js";

export interface UpdateStatusOptions {
  /** Project directory for git-based completion validation. */
  projectDir?: string;
  /** Test command to run during completion validation. */
  testCommand?: string;
  /** Commit hash captured before the agent started, for diffing against. */
  startingHead?: string;
}

export async function toolRexUpdateStatus(
  store: PRDStore,
  taskId: string,
  params: { status: string },
  options?: UpdateStatusOptions,
): Promise<string> {
  const validStatuses = ["pending", "in_progress", "completed", "deferred", "blocked"];
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
  }

  const existing = await store.getItem(taskId);
  const tsUpdates = computeTimestampUpdates(
    existing?.status ?? "pending",
    params.status as ItemStatus,
    existing ?? undefined,
  );
  await store.updateItem(taskId, { status: params.status as ItemStatus, ...tsUpdates });
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "status_updated",
    itemId: taskId,
    detail: `Status changed to ${params.status} by hench agent`,
  });

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
