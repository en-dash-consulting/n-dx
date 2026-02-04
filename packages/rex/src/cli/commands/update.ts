import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import type { PRDItem, ItemStatus, Priority } from "../../schema/index.js";

const VALID_STATUSES = new Set([
  "pending",
  "in_progress",
  "completed",
  "deferred",
]);
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);

export async function cmdUpdate(
  dir: string,
  id: string,
  flags: Record<string, string>,
): Promise<void> {
  if (!id) {
    throw new CLIError(
      "Missing item ID.",
      "Usage: rex update <id> --status=<s> --priority=<p> --title=<t>",
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  const existing = await store.getItem(id);
  if (!existing) {
    throw new CLIError(
      `Item "${id}" not found.`,
      "Check the ID with 'rex status' and try again.",
    );
  }

  const updates: Partial<PRDItem> = {};

  if (flags.status) {
    if (!VALID_STATUSES.has(flags.status)) {
      throw new CLIError(
        `Invalid status "${flags.status}".`,
        `Must be one of: ${[...VALID_STATUSES].join(", ")}`,
      );
    }
    updates.status = flags.status as ItemStatus;
  }

  if (flags.priority) {
    if (!VALID_PRIORITIES.has(flags.priority)) {
      throw new CLIError(
        `Invalid priority "${flags.priority}".`,
        `Must be one of: ${[...VALID_PRIORITIES].join(", ")}`,
      );
    }
    updates.priority = flags.priority as Priority;
  }

  if (flags.title) updates.title = flags.title;
  if (flags.description) updates.description = flags.description;

  if (Object.keys(updates).length === 0) {
    throw new CLIError(
      "No updates specified.",
      "Use --status, --priority, --title, or --description.",
    );
  }

  await store.updateItem(id, updates);

  // Log the update
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_updated",
    itemId: id,
    detail: `Updated: ${Object.keys(updates).join(", ")}`,
  });

  if (flags.format === "json") {
    const updated = await store.getItem(id);
    result(JSON.stringify(updated, null, 2));
  } else {
    result(`Updated ${existing.level}: ${existing.title}`);
    info(`  ${Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
  }
}
