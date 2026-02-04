import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../../store/index.js";
import { LEVEL_HIERARCHY } from "../../schema/index.js";
import { findItem } from "../../core/tree.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../../schema/index.js";

const VALID_LEVELS = new Set(Object.keys(LEVEL_HIERARCHY));

/** Map parent level → child level for inference. */
const CHILD_LEVEL: Record<string, ItemLevel> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
};

export async function cmdAdd(
  dir: string,
  level: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  const title = flags.title;
  if (!title) {
    throw new CLIError(
      "Missing required flag: --title",
      'Usage: rex add <level> --title="..." or rex add --title="..." --level=<level>',
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const parentId = flags.parent;

  // Infer level when not explicitly provided
  let resolvedLevel: string;
  if (level) {
    resolvedLevel = level;
  } else if (parentId) {
    // Infer from parent: epic→feature, feature→task, task→subtask
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    const inferred = CHILD_LEVEL[parentEntry.item.level];
    if (!inferred) {
      throw new CLIError(
        `Cannot infer child level for parent type "${parentEntry.item.level}".`,
        'Specify the level explicitly with --level=<level> or as a positional argument.',
      );
    }
    resolvedLevel = inferred;
  } else {
    // No parent, no level → default to epic
    resolvedLevel = "epic";
  }

  if (!VALID_LEVELS.has(resolvedLevel)) {
    throw new CLIError(
      `Invalid level "${resolvedLevel}".`,
      `Must be one of: ${[...VALID_LEVELS].join(", ")}`,
    );
  }

  // Validate parent-child level relationship
  const requiredParentLevel = LEVEL_HIERARCHY[resolvedLevel as ItemLevel];
  if (requiredParentLevel && !parentId) {
    throw new CLIError(
      `A ${resolvedLevel} requires a parent.`,
      `Use --parent=<id> to specify a ${requiredParentLevel}.`,
    );
  }

  if (parentId) {
    // Re-fetch parent (may already have it from inference, but need it for validation too)
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    if (requiredParentLevel && parentEntry.item.level !== requiredParentLevel) {
      throw new CLIError(
        `A ${resolvedLevel} must be a child of a ${requiredParentLevel}, but "${parentId}" is a ${parentEntry.item.level}.`,
        `Use --parent=<id> to specify a ${requiredParentLevel} instead.`,
      );
    }
  }

  if (!requiredParentLevel && parentId) {
    // epics can optionally have parents but it's unusual
  }

  const id = randomUUID();
  const item: PRDItem = {
    id,
    title,
    status: (flags.status as ItemStatus) ?? "pending",
    level: resolvedLevel as ItemLevel,
  };

  if (flags.description) item.description = flags.description;
  if (flags.priority) item.priority = flags.priority as Priority;

  await store.addItem(item, parentId);

  // Log the addition
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_added",
    itemId: id,
    detail: `Added ${resolvedLevel}: ${title}`,
  });

  if (flags.format === "json") {
    result(JSON.stringify({ id, level: resolvedLevel, title }, null, 2));
  } else {
    result(`Created ${resolvedLevel}: ${title}`);
    result(`  ID: ${id}`);
  }
}
