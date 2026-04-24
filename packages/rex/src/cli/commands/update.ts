import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError, requireRexDir } from "../errors.js";
import { info, result } from "../output.js";
import { validateTransition } from "../../core/transitions.js";
import { computeTimestampUpdates } from "../../core/timestamps.js";
import { findAutoCompletions } from "../../core/parent-completion.js";
import { validateDAG } from "../../core/dag.js";
import { findItem } from "../../core/tree.js";
import { deleteItem, cleanBlockedByRefs } from "../../core/delete.js";
import { VALID_STATUSES, VALID_PRIORITIES, isItemStatus, isPriority } from "../../schema/index.js";
import type { PRDItem, ItemStatus, Priority } from "../../schema/index.js";

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

  requireRexDir(dir);
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
    if (!isItemStatus(flags.status)) {
      throw new CLIError(
        `Invalid status "${flags.status}".`,
        `Must be one of: ${[...VALID_STATUSES].join(", ")}`,
      );
    }

    // Validate transition unless --force is set
    if (flags.force !== "true") {
      const transition = validateTransition(
        existing.status,
        flags.status as ItemStatus,
      );
      if (!transition.allowed) {
        throw new CLIError(
          transition.message!,
          "Use --force to override this check.",
        );
      }
    }

    // Handle deletion: remove item and children from tree
    if (flags.status === "deleted") {
      const doc = await store.loadDocument();
      const deletedIds = deleteItem(doc.items, id);
      cleanBlockedByRefs(doc.items, new Set(deletedIds));
      await store.saveDocument(doc);

      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "item_deleted",
        itemId: id,
        detail: `Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`,
      });

      if (flags.format === "json") {
        result(JSON.stringify({ deleted: deletedIds }, null, 2));
      } else {
        result(`Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`);
      }
      return;
    }

    updates.status = flags.status as ItemStatus;

    // Set failureReason when transitioning to failing
    if (flags.status === "failing" && flags.reason) {
      updates.failureReason = flags.reason;
    }

    // Compute automatic timestamp updates for the status change
    const tsUpdates = computeTimestampUpdates(existing.status, updates.status, existing);
    Object.assign(updates, tsUpdates);
  }

  if (flags.priority) {
    if (!isPriority(flags.priority)) {
      throw new CLIError(
        `Invalid priority "${flags.priority}".`,
        `Must be one of: ${[...VALID_PRIORITIES].join(", ")}`,
      );
    }
    updates.priority = flags.priority;
  }

  if (flags.title) updates.title = flags.title;
  if (flags.description) updates.description = flags.description;

  if (flags.blockedBy !== undefined) {
    const raw = flags.blockedBy.trim();
    if (raw === "") {
      // Clear dependencies
      updates.blockedBy = undefined;
    } else {
      updates.blockedBy = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new CLIError(
      "No updates specified.",
      "Use --status, --priority, --title, --description, --blockedBy, or --reason (with --status=failing).",
    );
  }

  // Validate dependencies before persisting
  if (updates.blockedBy && updates.blockedBy.length > 0) {
    const doc = await store.loadDocument();
    // Simulate the update to validate the resulting DAG
    const simItems = JSON.parse(JSON.stringify(doc.items)) as PRDItem[];
    const simEntry = findItem(simItems, id);
    if (simEntry) {
      simEntry.item.blockedBy = updates.blockedBy;
    }
    const dagResult = validateDAG(simItems);
    if (!dagResult.valid) {
      throw new CLIError(
        `Invalid dependencies: ${dagResult.errors.join("; ")}`,
        "Check the IDs with 'rex status' and ensure no cycles exist.",
      );
    }
  }

  await store.updateItem(id, updates, { applyAttribution: true, projectDir: dir });

  // Log the update
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_updated",
    itemId: id,
    detail: `Updated: ${Object.keys(updates).join(", ")}`,
  });

  // Auto-complete parent items when a child is completed or deferred
  const autoCompleted: Array<{ id: string; title: string; level: string }> = [];
  if (
    updates.status &&
    (updates.status === "completed" || updates.status === "deferred")
  ) {
    const doc = await store.loadDocument();
    const { completedItems } = findAutoCompletions(doc.items, id);

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
      }, { applyAttribution: true, projectDir: dir });
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "auto_completed",
        itemId: item.id,
        detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
      });
      autoCompleted.push(item);
    }
  }

  if (flags.format === "json") {
    const updated = await store.getItem(id);
    result(JSON.stringify({ ...updated, autoCompleted }, null, 2));
  } else {
    result(`Updated ${existing.level}: ${existing.title}`);
    info(`  ${Object.entries(updates).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    for (const item of autoCompleted) {
      info(`  ✓ Auto-completed ${item.level}: ${item.title}`);
    }
  }
}
