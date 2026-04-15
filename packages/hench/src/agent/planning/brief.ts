import {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  findItem,
  walkTree,
  collectRequirements,
  isWorkItem,
} from "../../prd/rex-gateway.js";
import type { PRDStore, PRDItem, TreeEntry } from "../../prd/rex-gateway.js";
import type {
  TaskBrief,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
  TaskBriefRequirement,
} from "../../schema/index.js";
import { CLIError } from "../../prd/llm-gateway.js";
import type { PromptSection } from "../../prd/llm-gateway.js";

export interface AssembleBriefOptions {
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
  /** Restrict task selection to this epic (ID). */
  epicId?: string;
}

// ---------------------------------------------------------------------------
// Epic task collection
// ---------------------------------------------------------------------------

/**
 * Collect all task/subtask IDs that belong to a specific epic.
 * Includes all descendants of the epic at task or subtask level.
 */
export function collectEpicTaskIds(items: PRDItem[], epicId: string): Set<string> {
  const ids = new Set<string>();

  for (const { item, parents } of walkTree(items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === epicId ||
      parents.some((p) => p.id === epicId);

    if (isInEpic && isWorkItem(item.level)) {
      ids.add(item.id);
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Task status validation
// ---------------------------------------------------------------------------

/** Statuses that cannot be worked on. */
const NON_ACTIONABLE_STATUSES = new Set(["completed", "deferred", "blocked"]);

/**
 * Thrown when an explicitly-selected task cannot be worked on.
 *
 * Extends the foundation {@link CLIError} (which extends ClaudeClientError),
 * bringing it into the unified error hierarchy. The `suggestion` field from
 * CLIError is used directly, and additional task-specific metadata (`taskId`,
 * `status`) is available for programmatic handling.
 */
export class TaskNotActionableError extends CLIError {
  readonly taskId: string;
  readonly status: string;

  constructor(taskId: string, status: string, suggestion: string, title?: string) {
    const label = title ? `"${title}" (${taskId})` : taskId;
    super(`Task ${label} is ${status} and cannot be worked on.`, suggestion);
    this.name = "TaskNotActionableError";
    this.taskId = taskId;
    this.status = status;
  }
}

function buildSuggestion(status: string, taskId: string): string {
  if (status === "completed") {
    return (
      "This task is already complete. Run 'n-dx status' to see remaining work,\n" +
      "or pick a different task with 'n-dx work --task=<ID>'."
    );
  }
  if (status === "blocked") {
    return (
      `This task is blocked and cannot proceed until its dependencies are resolved.\n` +
      `To unblock it, run:\n` +
      `  rex update ${taskId} --status=pending\n` +
      "Then run 'n-dx work' again."
    );
  }
  // deferred
  return (
    `This task has been deferred. To reactivate it, run:\n` +
    `  rex update ${taskId} --status=pending\n` +
    "Then run 'n-dx work' again."
  );
}

function itemToTaskBrief(item: PRDItem): TaskBriefTask {
  return {
    id: item.id,
    title: item.title,
    level: item.level,
    status: item.status,
    description: item.description,
    acceptanceCriteria: item.acceptanceCriteria,
    priority: item.priority,
    tags: item.tags,
    blockedBy: item.blockedBy,
    failureReason: item.failureReason,
  };
}

function itemToParent(item: PRDItem): TaskBriefParent {
  return {
    id: item.id,
    title: item.title,
    level: item.level,
    description: item.description,
  };
}

function getSiblings(entry: TreeEntry, doc: { items: PRDItem[] }): TaskBriefSibling[] {
  // Get the parent's children (or root items if no parent)
  const parent = entry.parents[entry.parents.length - 1];
  const siblingList = parent?.children ?? doc.items;

  return siblingList
    .filter((s: PRDItem) => s.id !== entry.item.id)
    .map((s: PRDItem) => ({
      id: s.id,
      title: s.title,
      status: s.status,
    }));
}

export async function assembleTaskBrief(
  store: PRDStore,
  taskId?: string,
  options?: AssembleBriefOptions,
): Promise<{ brief: TaskBrief; taskId: string }> {
  const doc = await store.loadDocument();
  const config = await store.loadConfig();
  const excludeIds = options?.excludeTaskIds;

  let entry: TreeEntry | null;

  if (taskId) {
    entry = findItem(doc.items, taskId);
    if (!entry) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (NON_ACTIONABLE_STATUSES.has(entry.item.status)) {
      throw new TaskNotActionableError(
        taskId,
        entry.item.status,
        buildSuggestion(entry.item.status, taskId),
        entry.item.title,
      );
    }
  } else {
    const completedIds = collectCompletedIds(doc.items);
    // When excluding stuck tasks, treat them as completed so findNextTask skips them
    const skipIds = excludeIds
      ? new Set([...completedIds, ...excludeIds])
      : completedIds;

    const epicId = options?.epicId;

    if (epicId) {
      // Epic filter active: get all actionable tasks and filter to epic
      const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
      const allActionable = findActionableTasks(doc.items, skipIds, Infinity);

      // Filter to tasks within the epic and not in excludeIds
      const epicActionable = allActionable.filter(
        (e) => epicTaskIds.has(e.item.id) && !excludeIds?.has(e.item.id),
      );

      if (epicActionable.length === 0) {
        throw new Error("No actionable tasks found in epic");
      }

      // findActionableTasks already sorts by priority, so first is best
      entry = epicActionable[0];
    } else {
      // No epic filter: use standard findNextTask
      entry = findNextTask(doc.items, skipIds);
      if (!entry) {
        throw new Error("No actionable tasks found in PRD");
      }
    }
  }

  let workflow = "";
  try {
    workflow = await store.loadWorkflow();
  } catch {
    // No workflow file
  }

  const recentLog = await store.readLog(20);

  const project: TaskBriefProject = {
    name: config.project,
    validateCommand: config.validate,
    testCommand: config.test,
  };

  // Collect requirements (own + inherited from parent chain)
  const tracedReqs = collectRequirements(doc.items, entry.item.id);
  const requirements: TaskBriefRequirement[] = tracedReqs.map((tr) => ({
    id: tr.requirement.id,
    title: tr.requirement.title,
    category: tr.requirement.category,
    validationType: tr.requirement.validationType,
    acceptanceCriteria: tr.requirement.acceptanceCriteria,
    source: tr.sourceItemTitle,
  }));

  const brief: TaskBrief = {
    task: itemToTaskBrief(entry.item),
    parentChain: entry.parents.map(itemToParent),
    siblings: getSiblings(entry, doc),
    requirements,
    project,
    workflow,
    recentLog: recentLog.map((e) => ({
      timestamp: e.timestamp,
      event: e.event,
      detail: e.detail,
    })),
  };

  return { brief, taskId: entry.item.id };
}

export interface ActionableTask {
  id: string;
  title: string;
  level: string;
  priority: string;
  parentChain: string;
}

export async function getActionableTasks(
  store: PRDStore,
  limit = 20,
): Promise<ActionableTask[]> {
  const doc = await store.loadDocument();
  const completedIds = collectCompletedIds(doc.items);
  const entries = findActionableTasks(doc.items, completedIds, limit);

  return entries.map((e) => ({
    id: e.item.id,
    title: e.item.title,
    level: e.item.level,
    priority: e.item.priority ?? "medium",
    parentChain: e.parents.map((p) => p.title).join(" > "),
  }));
}

// ---------------------------------------------------------------------------
// Prompt section contribution
// ---------------------------------------------------------------------------

/**
 * Build {@link PromptSection}s from a {@link TaskBrief}.
 *
 * Contributes sections to the prompt envelope. Currently produces a single
 * "brief" section whose content is identical to {@link formatTaskBrief}.
 * Future work may split the brief into finer-grained sections (e.g.
 * separating workflow or file context).
 *
 * @see buildPromptEnvelope in prompt.ts — composes these sections with the
 *      system section into a complete PromptEnvelope.
 */
export function buildBriefSections(brief: TaskBrief): PromptSection[] {
  return [
    { name: "brief", content: formatTaskBrief(brief) },
  ];
}

// ---------------------------------------------------------------------------
// Brief text formatting (backward-compatible flat string)
// ---------------------------------------------------------------------------

export function formatTaskBrief(brief: TaskBrief): string {
  const sections: string[] = [];

  // Task
  sections.push("## Current Task");
  sections.push(`**${brief.task.title}** (${brief.task.level})`);
  sections.push(`ID: ${brief.task.id}`);
  sections.push(`Status: ${brief.task.status}`);
  if (brief.task.priority) sections.push(`Priority: ${brief.task.priority}`);
  if (brief.task.blockedBy?.length) {
    sections.push(`Blocked by: ${brief.task.blockedBy.join(", ")}`);
  }
  if (brief.task.description) sections.push(`\nDescription:\n${brief.task.description}`);
  if (brief.task.acceptanceCriteria?.length) {
    sections.push("\nAcceptance Criteria:");
    for (const c of brief.task.acceptanceCriteria) {
      sections.push(`- ${c}`);
    }
  }
  if (brief.task.tags?.length) {
    sections.push(`Tags: ${brief.task.tags.join(", ")}`);
  }
  if (brief.task.failureReason) {
    sections.push("\n## PREVIOUS FAILURE");
    sections.push(brief.task.failureReason);
  }

  // Parent chain
  if (brief.parentChain.length > 0) {
    sections.push("\n## Context (Parent Chain)");
    for (const p of brief.parentChain) {
      sections.push(`- **${p.title}** (${p.level})`);
      if (p.description) sections.push(`  ${p.description}`);
    }
  }

  // Requirements
  if (brief.requirements.length > 0) {
    sections.push("\n## Requirements");
    for (const req of brief.requirements) {
      sections.push(`- **${req.title}** [${req.category}/${req.validationType}] (from: ${req.source})`);
      for (const ac of req.acceptanceCriteria) {
        sections.push(`  - ${ac}`);
      }
    }
  }

  // Siblings
  if (brief.siblings.length > 0) {
    sections.push("\n## Sibling Tasks");
    for (const s of brief.siblings) {
      const marker = s.status === "completed" ? "[x]" : "[ ]";
      sections.push(`- ${marker} ${s.title} (${s.status})`);
    }
  }

  // Project
  sections.push("\n## Project");
  sections.push(`Name: ${brief.project.name}`);
  if (brief.project.validateCommand) {
    sections.push(`Validate: \`${brief.project.validateCommand}\``);
  }
  if (brief.project.testCommand) {
    sections.push(`Test: \`${brief.project.testCommand}\``);
  }

  // Workflow
  if (brief.workflow) {
    sections.push("\n## Workflow");
    sections.push(brief.workflow);
  }

  // Recent log
  if (brief.recentLog.length > 0) {
    sections.push("\n## Recent Activity");
    for (const entry of brief.recentLog.slice(-10)) {
      const line = entry.detail
        ? `- [${entry.timestamp}] ${entry.event}: ${entry.detail}`
        : `- [${entry.timestamp}] ${entry.event}`;
      sections.push(line);
    }
  }

  return sections.join("\n");
}
