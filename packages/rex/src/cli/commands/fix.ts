import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { detectIssues, applyFixes } from "../../fix/index.js";
import type { FixAction, FixKind } from "../../fix/index.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";

/**
 * Auto-fix common PRD validation issues.
 *
 * Supports:
 * - `--dry-run` — preview fixes without applying them
 * - `--format=json` — structured JSON output
 */
export async function cmdFix(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const dryRun = flags["dry-run"] === "true";

  if (dryRun) {
    const actions = detectIssues(doc.items);
    outputResult(actions, 0, true, flags);
    return;
  }

  // Apply fixes (mutates doc.items)
  const { actions, mutatedCount } = applyFixes(doc.items);

  if (mutatedCount > 0) {
    await store.saveDocument(doc);

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "auto_fix",
      detail: `Fixed ${mutatedCount} issue${mutatedCount === 1 ? "" : "s"}: ${summarizeActions(actions)}`,
    });
  }

  outputResult(actions, mutatedCount, false, flags);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function outputResult(
  actions: FixAction[],
  mutatedCount: number,
  dryRun: boolean,
  flags: Record<string, string>,
): void {
  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          dryRun,
          actions,
          summary: buildSummary(actions, mutatedCount, dryRun),
        },
        null,
        2,
      ),
    );
    return;
  }

  // Text mode
  if (actions.length === 0) {
    result("No issues found.");
    return;
  }

  if (dryRun) {
    result("Would fix:");
  } else {
    result(`Fixed ${mutatedCount} issue${mutatedCount === 1 ? "" : "s"}:`);
  }

  for (const action of actions) {
    result(`  ${kindIcon(action.kind)} ${action.description}`);
  }

  if (dryRun) {
    info("\nRun without --dry-run to apply fixes.");
  }
}

function buildSummary(
  actions: FixAction[],
  mutatedCount: number,
  dryRun: boolean,
): {
  total: number;
  byKind: Record<string, number>;
  mutated: number;
} {
  const byKind: Record<string, number> = {};
  for (const action of actions) {
    byKind[action.kind] = (byKind[action.kind] ?? 0) + 1;
  }
  return {
    total: actions.length,
    byKind,
    mutated: dryRun ? 0 : mutatedCount,
  };
}

function summarizeActions(actions: FixAction[]): string {
  const byKind = new Map<FixKind, number>();
  for (const a of actions) {
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  }
  return Array.from(byKind.entries())
    .map(([kind, count]) => `${count} ${kindLabel(kind)}`)
    .join(", ");
}

function kindIcon(kind: FixKind): string {
  switch (kind) {
    case "missing_timestamp": return "🕐";
    case "orphan_blocked_by": return "🔗";
    case "parent_child_alignment": return "🔄";
    default: return "•";
  }
}

function kindLabel(kind: FixKind): string {
  switch (kind) {
    case "missing_timestamp": return "timestamp fix(es)";
    case "orphan_blocked_by": return "orphan ref(s)";
    case "parent_child_alignment": return "parent alignment(s)";
    default: return kind;
  }
}
