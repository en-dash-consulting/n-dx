import { findNextTask, findActionableTasks, collectCompletedIds } from "rex/dist/core/next-task.js";
import { findItem } from "rex/dist/core/tree.js";
import type { PRDStore } from "rex/dist/store/types.js";
import type { PRDItem } from "rex/dist/schema/v1.js";
import type { TreeEntry } from "rex/dist/core/tree.js";
import type {
  TaskBrief,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
} from "../schema/index.js";

export interface AssembleBriefOptions {
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
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
  } else {
    const completedIds = collectCompletedIds(doc.items);
    // When excluding stuck tasks, treat them as completed so findNextTask skips them
    const skipIds = excludeIds
      ? new Set([...completedIds, ...excludeIds])
      : completedIds;
    entry = findNextTask(doc.items, skipIds);
    if (!entry) {
      throw new Error("No actionable tasks found in PRD");
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

  const brief: TaskBrief = {
    task: itemToTaskBrief(entry.item),
    parentChain: entry.parents.map(itemToParent),
    siblings: getSiblings(entry, doc),
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

export function formatTaskBrief(brief: TaskBrief): string {
  const sections: string[] = [];

  // Task
  sections.push("## Current Task");
  sections.push(`**${brief.task.title}** (${brief.task.level})`);
  sections.push(`ID: ${brief.task.id}`);
  sections.push(`Status: ${brief.task.status}`);
  if (brief.task.priority) sections.push(`Priority: ${brief.task.priority}`);
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

  // Parent chain
  if (brief.parentChain.length > 0) {
    sections.push("\n## Context (Parent Chain)");
    for (const p of brief.parentChain) {
      sections.push(`- **${p.title}** (${p.level})`);
      if (p.description) sections.push(`  ${p.description}`);
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
