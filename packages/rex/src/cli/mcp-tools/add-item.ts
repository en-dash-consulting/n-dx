/**
 * `add_item`, dispatched on the PRD layout.
 *
 * - **v1** (`.rex/prd_tree/`): takes `level` as it always has. A `type` with a
 *   v1 level (`task`, `subtask`) stands in for it; `change`, and the v2-only
 *   `amends`, `touches` and `discoveredFrom`, are refused naming the layout.
 * - **v2** (`product/` and `changes/`): takes `type` (`change` when absent)
 *   and refuses `level`. An untargeted change lands in the Inbox with
 *   `needsPlacement`; a task under a closed change is refused
 *   (`core/change-add.ts`).
 */

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAllLevels } from "../../schema/index.js";
import { validateDAG } from "../../core/dag.js";
import { cascadeParentReset } from "../../core/parent-reset.js";
import { addChangeNode } from "../../core/change-add.js";
import { FileStore, resolvePRDFile } from "../../store/index.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import { withPrdModelTransaction } from "../../store/prd-model-transaction.js";
import { validateRunSettings, RunSettingsSchema } from "../../schema/validate.js";
import { AmendmentSchema, DiscoveredFromSchema, type Amendment, type ChangeNodeType, type DiscoveredFrom } from "../../schema/v2.js";
import type { PRDItem, ItemLevel, Priority, RunSettings } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import { textResult, type McpResult } from "./result.js";
import { defineTool } from "./tool.js";
import { systemClock, type Clock } from "./clock.js";

const ADD_TYPES = ["change", "task", "subtask"] as const satisfies readonly ChangeNodeType[];

export interface AddItemArgs {
  title: string;
  /** v1 only. */
  level?: string;
  /** v2; on v1 only a type with a v1 level. */
  type?: string;
  parentId?: string;
  description?: string;
  priority?: string;
  acceptanceCriteria?: string[];
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  run?: unknown;
  /** v2 only. */
  amends?: Amendment[];
  /** v2 only. */
  touches?: string[];
  /** v2 only. */
  discoveredFrom?: DiscoveredFrom;
}

export async function handleAddItem(
  store: PRDStore,
  projectDir: string,
  rexDir: string,
  args: AddItemArgs,
  clock: Clock = systemClock,
): Promise<McpResult> {
  try {
    const runCheck = validateRunSettings(args.run);
    if (!runCheck.ok) return textResult(`Invalid run settings: ${runCheck.error}`, true);
    if ((await prdLayout(rexDir)) === "v2") return await addV2(store, rexDir, args, runCheck.value, clock);
    const level = v1Level(args);
    if ("error" in level) return textResult(level.error, true);
    return await addV1(store, projectDir, rexDir, { ...args, level: level.level }, runCheck.value);
  } catch (err) {
    return textResult(`Error: ${(err as Error).message}`, true);
  }
}

const V1_REFUSAL = "This PRD uses the v1 layout (.rex/prd_tree/)";
const V2_ONLY_FIELDS = ["amends", "touches", "discoveredFrom"] as const;

/** The v1 level `args` asks for, or why it cannot be added to a v1 tree. */
function v1Level(args: AddItemArgs): { level: ItemLevel } | { error: string } {
  const v2Only = V2_ONLY_FIELDS.filter((f) => args[f] !== undefined);
  if (v2Only.length) return { error: `${V1_REFUSAL}, which has no ${v2Only.join(", ")}. Leave them out.` };
  const { type, level } = args;
  if (type !== undefined) {
    if (!getAllLevels().includes(type as ItemLevel)) {
      return { error: `${V1_REFUSAL}, which has no level for type "${type}". Pass level (${getAllLevels().join(", ")}) instead.` };
    }
    if (level !== undefined && level !== type) return { error: `type "${type}" and level "${level}" disagree. Pass level alone on this v1 PRD.` };
    return { level: type as ItemLevel };
  }
  if (level === undefined) return { error: `${V1_REFUSAL}: pass level (${getAllLevels().join(", ")}).` };
  return { level: level as ItemLevel };
}

async function addV2(store: PRDStore, rexDir: string, args: AddItemArgs, run: RunSettings | undefined, clock: Clock): Promise<McpResult> {
  if (args.level !== undefined) {
    return textResult(
      `This PRD uses the v2 layout, where items have a type, not a level: pass type (${ADD_TYPES.join(", ")}) instead of level "${args.level}". ` +
        "With neither, the item is a change in the Inbox.",
      true,
    );
  }
  const type = (args.type ?? "change") as ChangeNodeType;
  // Read after the tree is loaded under the lock: a writer that held it first may have opened an interval later than a clock read made before waiting.
  let now!: Date;
  const { result } = await withPrdModelTransaction(rexDir, (model) => {
    now = clock();
    const added = addChangeNode(
      model.tree,
      {
        type,
        title: args.title,
        parentId: args.parentId,
        description: args.description,
        acceptanceCriteria: args.acceptanceCriteria,
        tags: args.tags,
        source: args.source,
        blockedBy: args.blockedBy,
        priority: args.priority as Priority | undefined,
        run,
        amends: args.amends,
        touches: args.touches,
        discoveredFrom: args.discoveredFrom,
      },
      { now },
    );
    return { tree: added.tree, result: added };
  });
  const { node, split, warnings } = result;
  await store.appendLog({ timestamp: now.toISOString(), event: "item_added", itemId: node.id, detail: `Added ${type}: ${args.title}` });
  return textResult(JSON.stringify({
    id: node.id,
    type,
    title: node.title,
    ...(node.needsPlacement ? { needsPlacement: true } : {}),
    ...(split ? { split } : {}),
    ...(warnings.length ? { warnings } : {}),
  }));
}

async function addV1(
  store: PRDStore,
  projectDir: string,
  rexDir: string,
  args: AddItemArgs & { level: ItemLevel },
  run: RunSettings | undefined,
): Promise<McpResult> {
  if (!args.parentId && store instanceof FileStore) {
    const resolution = await resolvePRDFile(rexDir, projectDir);
    store.setCurrentBranchFile(resolution.filename);
  }

  const id = randomUUID();
  const item: PRDItem = {
    id,
    title: args.title,
    level: args.level,
    status: "pending",
  };
  if (args.description) item.description = args.description;
  if (args.priority) item.priority = args.priority as Priority;
  if (args.acceptanceCriteria) item.acceptanceCriteria = args.acceptanceCriteria;
  if (args.tags) item.tags = args.tags;
  if (args.source) item.source = args.source;
  if (args.blockedBy) item.blockedBy = args.blockedBy;
  if (run) item.run = run;

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
}

export const addItemTool = defineTool({
  name: "add_item",
  description:
    "Add a new item to the PRD. Use when the user discusses a new feature, requirement, or work item that should be tracked. " +
    "On a v2 PRD pass type (default change; a change that neither amends nor touches lands in the Inbox needing placement); on a v1 PRD pass level.",
  schema: {
    title: z.string().describe("Item title"),
    type: z.enum(ADD_TYPES).optional().describe("v2: node type, default change. A task's parent is a change, a subtask's a task. On v1, task and subtask stand in for level"),
    level: z.enum(getAllLevels() as [string, ...string[]]).optional().describe("v1 only: item level. Refused on a v2 PRD, which takes type"),
    parentId: z.string().optional().describe("Parent item ID"),
    description: z.string().optional().describe("Item description (a v2 change's intent)"),
    priority: z.enum(["critical", "high", "medium", "low"]).optional().describe("Priority"),
    acceptanceCriteria: z.array(z.string()).optional().describe("Acceptance criteria (done when) for this item's own work, changes included. Distinct from a capability's capability criteria"),
    tags: z.array(z.string()).optional().describe("Tags"),
    source: z.string().optional().describe("Source of this item"),
    blockedBy: z.array(z.string()).optional().describe("IDs of blocking items"),
    run: RunSettingsSchema.optional().describe("Saved run settings for this item. Vendor-agnostic. Keys (all optional, unknown keys rejected): tier (light|standard|heavy), models ({claude?,codex?,google?,local?: model id} exact per-vendor pins), provider, permissionMode, review, reviewTier, reviewModels (same shape as models), reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes."),
    amends: z.array(AmendmentSchema).optional().describe("v2 change only: product-layer edits the change carries ({target, delta: added|modified|removed, summary, criteria?, proposed?, under?, title?, type?})"),
    touches: z.array(z.string()).optional().describe("v2 change only: product node IDs the change works on without amending them"),
    discoveredFrom: DiscoveredFromSchema.optional().describe("v2 change only: {item?, run?}, the change or task (and hench run) whose work surfaced this one. Use it for a follow-up to a closed change"),
  },
  access: "write",
  run: (ws, args) => handleAddItem(ws.store, ws.projectDir, ws.rexDir, args),
});
