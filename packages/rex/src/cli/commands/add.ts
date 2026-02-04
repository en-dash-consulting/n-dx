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

export async function cmdAdd(
  dir: string,
  level: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!VALID_LEVELS.has(level)) {
    throw new CLIError(
      `Invalid level "${level}".`,
      `Must be one of: ${[...VALID_LEVELS].join(", ")}`,
    );
  }

  const title = flags.title;
  if (!title) {
    throw new CLIError(
      "Missing required flag: --title",
      'Usage: rex add <level> --title="..."',
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const parentId = flags.parent;

  // Validate parent-child level relationship
  const requiredParentLevel = LEVEL_HIERARCHY[level as ItemLevel];
  if (requiredParentLevel && !parentId) {
    throw new CLIError(
      `A ${level} requires a parent.`,
      `Use --parent=<id> to specify a ${requiredParentLevel}.`,
    );
  }

  if (parentId) {
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    if (requiredParentLevel && parentEntry.item.level !== requiredParentLevel) {
      throw new CLIError(
        `A ${level} must be a child of a ${requiredParentLevel}, but "${parentId}" is a ${parentEntry.item.level}.`,
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
    level: level as ItemLevel,
  };

  if (flags.description) item.description = flags.description;
  if (flags.priority) item.priority = flags.priority as Priority;

  await store.addItem(item, parentId);

  // Log the addition
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_added",
    itemId: id,
    detail: `Added ${level}: ${title}`,
  });

  if (flags.format === "json") {
    result(JSON.stringify({ id, level, title }, null, 2));
  } else {
    result(`Created ${level}: ${title}`);
    result(`  ID: ${id}`);
  }
}
