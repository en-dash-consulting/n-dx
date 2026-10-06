import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAllLevels } from "../../schema/index.js";
import { validateDAG } from "../../core/dag.js";
import { cascadeParentReset } from "../../core/parent-reset.js";
import { FileStore, resolvePRDFile } from "../../store/index.js";
import { validateRunSettings, RunSettingsSchema } from "../../schema/validate.js";
import type { PRDItem, ItemLevel, Priority } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";

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
    run?: unknown;
  },
): Promise<McpResult> {
  try {
    const runCheck = validateRunSettings(args.run);
    if (!runCheck.ok) return textResult(`Invalid run settings: ${runCheck.error}`, true);

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
    if (runCheck.value) item.run = runCheck.value;

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

    return textResult(JSON.stringify({ id, level: args.level, title: args.title, resetItems }));
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

export const addItemTool = defineTool({
  name: "add_item",
  description: "Add a new item to the PRD. Use when the user discusses a new feature, requirement, or work item that should be tracked.",
  schema: {
    title: z.string().describe("Item title"),
    level: z.enum(getAllLevels() as [string, ...string[]]).describe("Item level"),
    parentId: z.string().optional().describe("Parent item ID"),
    description: z.string().optional().describe("Item description"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority"),
    acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria"),
    tags: z.array(z.string()).optional().describe("Tags"),
    source: z.string().optional().describe("Source of this item"),
    blockedBy: z.array(z.string()).optional().describe("IDs of blocking items"),
    run: RunSettingsSchema.optional().describe("Saved run settings for this item. Vendor-agnostic. Keys (all optional, unknown keys rejected): tier (light|standard|heavy), models ({claude?,codex?,google?,local?: model id} exact per-vendor pins), provider, permissionMode, review, reviewTier, reviewModels (same shape as models), reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes."),
  },
  access: "write",
  run: (ws, args) => handleAddItem(ws.store, ws.projectDir, ws.rexDir, args),
});
