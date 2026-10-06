import { z } from "zod";
import { findItem } from "../../core/tree.js";
import { validateDAG } from "../../core/dag.js";
import { resolveRexPaths } from "../../store/index.js";
import { syncFolderTree } from "../commands/folder-tree-sync.js";
import type { PRDItem, Priority } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

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

    await syncFolderTree(resolveRexPaths(projectDir).rexDir, store);

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

export const editItemTool = defineTool({
  name: "edit_item",
  description: "Edit content fields of a PRD item (title, description, acceptance criteria, priority, level, tags). Use for content changes — use update_task_status for status/lifecycle transitions.",
  schema: {
    id: z.string().describe("Item ID"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    acceptanceCriteria: z.array(z.string()).optional().describe("New acceptance criteria"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("New priority"),
    level: z.enum(["epic", "feature", "task", "subtask"]).optional().describe("New level (epic, feature, task, subtask)"),
    tags: z.array(z.string()).optional().describe("New tags"),
    source: z.string().optional().describe("New source"),
    blockedBy: z.array(z.string()).optional().describe("New blocked-by IDs"),
  },
  access: "write",
  run: (ws, args) => handleEditItem(ws.store, ws.projectDir, args),
});
