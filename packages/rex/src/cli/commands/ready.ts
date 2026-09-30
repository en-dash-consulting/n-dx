/**
 * `rex ready` — mark items ready to work and explain why others don't
 * qualify. See `core/ready.ts` for the qualification rule.
 *
 * @module rex/cli/commands/ready
 */

import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated, resolveRexPaths } from "../../store/index.js";
import { evaluateReady, applyReadyMarking } from "../../core/ready.js";
import type { ReadyEvaluation, ReadyMarkOutcome } from "../../core/ready.js";
import { findItem } from "../../core/tree.js";
import { info, result } from "../output.js";
import { CLIError, requireRexDir } from "../errors.js";
import { emitMigrationNotification } from "../migration-notification.js";

function printEvaluation(e: ReadyEvaluation): void {
  const icon = e.qualifies ? "✓" : "✗";
  result(`  ${icon} [${e.level}] ${e.title} (${e.itemId}) — ${e.reason}`);
}

export async function cmdReady(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const itemId = flags.item;
  // `item` is deliberately not a VALUE_KEY (see commands/log.ts#readItemId),
  // so a bare `--item`, including the space-separated `--item <id>`, arrives
  // as "true". Refuse it rather than look up an item named "true" or fall
  // through to the whole tree.
  if (itemId === "" || itemId === "true") {
    throw new CLIError(
      "--item needs a value.",
      "Write it as --item=<id>, or omit --item to evaluate the whole tree; the space-separated form is not supported.",
    );
  }
  const migrationResult = await ensureLegacyPrdMigrated(dir);
  requireRexDir(dir);
  const rexDir = resolveRexPaths(dir).rexDir;
  const store = await resolveStore(rexDir);

  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));

  const initDoc = await store.loadDocument();
  if (initDoc.items.length === 0) {
    result("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  // ── Single item ───────────────────────────────────────────────────────
  if (itemId) {
    const before = evaluateReady(initDoc.items, itemId);
    if (!before) {
      throw new CLIError(
        `Item "${itemId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }

    let changed = false;
    await store.withTransaction(async (doc) => {
      const evaluation = evaluateReady(doc.items, itemId);
      if (!evaluation) return;
      const entry = findItem(doc.items, itemId);
      if (!entry) return;
      const wasReady = entry.item.ready === true;
      if (evaluation.qualifies && !wasReady) {
        entry.item.ready = true;
        changed = true;
      } else if (!evaluation.qualifies && wasReady) {
        delete entry.item.ready;
        changed = true;
      }
    });

    if (changed) {
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "ready_evaluated",
        itemId,
        detail: before.qualifies
          ? "Marked ready"
          : "Unmarked ready (no longer qualifies)",
      });
    }

    if (flags.format === "json") {
      result(JSON.stringify({ ...before, changed }, null, 2));
      return;
    }

    printEvaluation(before);
    if (changed) {
      info(before.qualifies ? "  → marked ready" : "  → unmarked (no longer qualifies)");
    }
    return;
  }

  // ── Whole tree ────────────────────────────────────────────────────────
  let outcome!: ReadyMarkOutcome;
  await store.withTransaction(async (doc) => {
    outcome = applyReadyMarking(doc.items);
  });

  if (outcome.markedReadyCount > 0 || outcome.unmarkedCount > 0) {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "ready_evaluated",
      detail: `${outcome.markedReadyCount} marked ready, ${outcome.unmarkedCount} unmarked`,
    });
  }

  if (flags.format === "json") {
    result(JSON.stringify(outcome, null, 2));
    return;
  }

  if (outcome.evaluations.length === 0) {
    result(
      `No items qualify. ${outcome.skippedNoRequirementCount} item(s) have no automated or metric requirement.`,
    );
    return;
  }

  for (const evaluation of outcome.evaluations) {
    printEvaluation(evaluation);
  }

  info("");
  const parts: string[] = [`${outcome.markedReadyCount} marked ready`];
  if (outcome.unmarkedCount > 0) parts.push(`${outcome.unmarkedCount} unmarked`);
  if (outcome.skippedNoRequirementCount > 0) {
    parts.push(`${outcome.skippedNoRequirementCount} skipped (no automated/metric requirement)`);
  }
  result(parts.join(", "));
}
