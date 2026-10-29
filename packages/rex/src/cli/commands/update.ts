import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated, resolveRexPaths, isChangeLayerStore, resolveItemRef } from "../../store/index.js";

import { parseCsvList } from "../parse-utils.js";
import { CLIError, requireRexDir } from "../errors.js";
import { runBlockRefusalInsideAgentRun } from "../run-block-guard.js";
import { info, result, warn } from "../output.js";
import { completeV2Work, type V2Completion } from "../v2-completion.js";
import { emitMigrationNotification } from "../migration-notification.js";
import { validateTransition } from "../../core/transitions.js";
import { computeTimestampUpdates } from "../../core/timestamps.js";
import { cascadeParentCompletion } from "../../core/parent-completion.js";
import { validateDAG } from "../../core/dag.js";
import { findItem, resolveItem } from "../../core/tree.js";
import { deleteItem, cleanBlockedByRefs } from "../../core/delete.js";
import { openClaimsStore, resolveClaimHolder } from "../../store/index.js";
import { holdCompletionForRun, describeHeldCompletion } from "../completion-hold.js";
import { VALID_STATUSES, VALID_PRIORITIES, RUN_SETTING_KEYS, isItemStatus, isPriority } from "../../schema/index.js";
import { validateRunSettings } from "../../schema/validate.js";
import type {PRDItem, ItemStatus} from "../../schema/index.js";
/** Fields a v2 completion writes itself; the rest of the update is written after it. */
const V2_COMPLETION_FIELDS = ["status", "startedAt", "completedAt", "endedAt", "activeIntervals"] as const;

/** Summary rendering of one updated field; criteria show a count, not the array. */
function describeUpdate(key: string, value: unknown): string {
  if (key === "acceptanceCriteria" && Array.isArray(value)) {
    return value.length === 0 ? "cleared" : `${value.length} ${value.length === 1 ? "criterion" : "criteria"}`;
  }
  return value === undefined ? "cleared" : String(value);
}

export async function cmdUpdate(
  dir: string,
  id: string,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  if (!id) {
    throw new CLIError(
      "Missing item ID.",
      "Usage: rex update <id> --status=<s> --priority=<p> --title=<t>",
    );
  }

  // Ensure legacy .rex/prd.json is migrated to folder-tree format before writing PRD
  const migrationResult = await ensureLegacyPrdMigrated(dir);

  requireRexDir(dir);
  const rexDir = resolveRexPaths(dir).rexDir;
  const store = await resolveStore(rexDir);

  // Emit migration notification to CLI and execution log
  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));

  const initDoc = await store.loadDocument();
  const resolvedEntry = resolveItem(initDoc.items, await resolveItemRef(store, id));
  if (!resolvedEntry) {
    throw new CLIError(
      `Item "${id}" not found.`,
      "Check the ID with 'rex status' and try again.",
    );
  }
  const existing = resolvedEntry.item;
  const resolvedId = resolvedEntry.item.id;

  const updates: Partial<PRDItem> = {};
  /** Set when a hench run holds the completion; the status is then not written. */
  let heldCompletion: string | undefined;

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

    // Run from a hench run's agent shell, a completion is recorded for the
    // run to apply after its test gate, not written — see
    // cli/completion-hold.ts. Other fields in the same call still apply.
    if (flags.status === "completed") {
      const claims = { store: openClaimsStore(dir), worktreeRoot: resolveClaimHolder(dir).worktreeRoot };
      const held = await holdCompletionForRun(claims, resolvedId, {});
      if (held) {
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "completion_held",
          itemId: resolvedId,
          detail: `Completion held for hench run (pid ${held.pid}) until its test gate passes`,
        });
        heldCompletion = describeHeldCompletion(resolvedId, held);
      }
    }

    // Handle deletion: remove item and children from tree
    if (flags.status === "deleted") {
      const doc = await store.loadDocument();
      const deletedIds = deleteItem(doc.items, resolvedId);
      cleanBlockedByRefs(doc.items, new Set(deletedIds));
      await store.saveDocument(doc);

      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "item_deleted",
        itemId: resolvedId,
        detail: `Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`,
      });

      if (flags.format === "json") {
        result(JSON.stringify({ deleted: deletedIds }, null, 2));
      } else {
        result(`Deleted ${existing.level}: ${existing.title} (${deletedIds.length} item(s) removed)`);
      }
      return;
    }

    if (!heldCompletion) {
      updates.status = flags.status as ItemStatus;

      // Set failureReason when transitioning to failing
      if (flags.status === "failing" && flags.reason) {
        updates.failureReason = flags.reason;
      }

      // Compute automatic timestamp updates for the status change
      const tsUpdates = computeTimestampUpdates(existing.status, updates.status, existing);
      Object.assign(updates, tsUpdates);
    }
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
      updates.blockedBy = parseCsvList(raw);
    }
  }

  if (multiFlags.criterion?.length) {
    // Replaces the whole list; all-empty values clear it. `[]` is what an item
    // with no criteria already round-trips as (see folder-tree-parser).
    updates.acceptanceCriteria = multiFlags.criterion.map((c) => c.trim()).filter(Boolean);
  }

  if (flags.source !== undefined) {
    // Empty removes it (undefined is not serialized).
    updates.source = flags.source.trim() || undefined;
  }

  if (flags.assignee !== undefined) {
    // Empty removes it (undefined is not serialized). Selection matches on an
    // exact string and inherits down the parent chain, so the value is stored
    // verbatim rather than normalized — see core/next-task.ts matchesAssignee.
    updates.assignee = flags.assignee.trim() || undefined;
  }

  if (flags.run !== undefined) {
    // Replaces the whole block; empty or `null` removes it (undefined is not serialized).
    const raw = flags.run.trim();
    let parsed: unknown = null;
    if (raw !== "" && raw !== "null") {
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new CLIError(
          `--run is not valid JSON: ${(err as Error).message}`,
          `Pass an object, e.g. --run='{"tier":"heavy"}'. Valid keys: ${RUN_SETTING_KEYS.join(", ")}.`,
        );
      }
    }
    // The same rule the MCP tools apply: the agent session `ndx work` spawns
    // does not write the settings its own next run executes under.
    const refusal = runBlockRefusalInsideAgentRun(parsed);
    if (refusal) throw new CLIError(refusal, "Run 'rex update --run' from your own shell.");
    const check = validateRunSettings(parsed);
    if (!check.ok) {
      throw new CLIError(
        `Invalid --run: ${check.error}`,
        `Valid keys: ${RUN_SETTING_KEYS.join(", ")}.`,
      );
    }
    updates.run = check.value;
  }

  if (heldCompletion && Object.keys(updates).length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({ id: resolvedId, status: existing.status, completionHeld: true, message: heldCompletion }, null, 2));
    } else {
      result(heldCompletion);
    }
    return;
  }

  if (Object.keys(updates).length === 0) {
    throw new CLIError(
      "No updates specified.",
      "Use --status, --priority, --title, --description, --blockedBy, --criterion, --source, --assignee, --run, or --reason (with --status=failing).",
    );
  }

  // Validate dependencies before persisting
  if (updates.blockedBy && updates.blockedBy.length > 0) {
    const doc = await store.loadDocument();
    // Simulate the update to validate the resulting DAG
    const simItems = JSON.parse(JSON.stringify(doc.items)) as PRDItem[];
    const simEntry = findItem(simItems, resolvedId);
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

  // On a v2 tree completion follows the change layer's rules, applying a
  // completed change per rex.applyOn, as update_task_status does
  // (cli/v2-completion.ts). It writes the status and its timestamps; any
  // other field is written after it. The order is the rule: complete first,
  // write the other fields only if the completion succeeded, so a refused
  // completion writes nothing. Every refusal the field write could raise
  // (dependencies, --run) is checked above, before the completion.
  let v2: V2Completion | undefined;
  let fieldUpdates = updates;
  if (updates.status === "completed" && isChangeLayerStore(store)) {
    v2 = await completeV2Work(store, resolvedId);
    for (const w of v2.warnings) warn(w);
    fieldUpdates = { ...updates };
    for (const key of V2_COMPLETION_FIELDS) delete fieldUpdates[key];
  }
  if (Object.keys(fieldUpdates).length > 0) {
    await store.updateItem(resolvedId, fieldUpdates, { applyAttribution: true, projectDir: dir });
  }

  // Log the update
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_updated",
    itemId: resolvedId,
    detail: `Updated: ${Object.keys(updates).join(", ")}`,
  });

  // Re-check parent auto-completion after this status change. A deferred
  // status can never itself make a parent auto-completable (only a fully
  // `completed` child set can — see parent-completion.ts), but re-checking
  // here is harmless.
  const autoCompleted: Array<{ id: string; title: string; level: string }> = v2?.autoCompleted ?? [];
  if (
    !v2 &&
    updates.status &&
    (updates.status === "completed" || updates.status === "deferred")
  ) {
    autoCompleted.push(...await cascadeParentCompletion(store, resolvedId, { applyAttribution: true, projectDir: dir }));
  }

  if (flags.format === "json") {
    const updated = await store.getItem(resolvedId);
    const v2Fields = v2 ? { changeId: v2.changeId, changeCompleted: v2.changeCompleted, applied: v2.applied, reason: v2.reason } : {};
    result(JSON.stringify({ ...updated, autoCompleted, ...v2Fields }, null, 2));
  } else {
    if (heldCompletion) info(heldCompletion);
    result(`Updated ${existing.level}: ${existing.title}`);
    info(`  ${Object.entries(updates).map(([k, v]) => `${k}: ${describeUpdate(k, v)}`).join(", ")}`);
    for (const item of autoCompleted) {
      info(`  ✓ Auto-completed ${item.level}: ${item.title}`);
    }
    if (v2?.applied) info(`  ✓ Applied change ${v2.changeId} to the product layer`);
    else if (v2?.reason) info(`  Change ${v2.changeId} not applied: ${v2.reason}`);
  }
}
