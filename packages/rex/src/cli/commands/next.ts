import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { findNextTask, collectCompletedIds } from "../../core/next-task.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";

export async function cmdNext(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    result("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  const completedIds = collectCompletedIds(doc.items);
  const nextResult = findNextTask(doc.items, completedIds);

  if (!nextResult) {
    result("COMPLETE — no actionable tasks remaining");
    return;
  }

  const { item, parents } = nextResult;

  if (flags.format === "json") {
    result(JSON.stringify({ item, parents }, null, 2));
    return;
  }

  if (parents.length > 0) {
    const breadcrumb = parents.map((p) => p.title).join(" → ");
    info(`${breadcrumb} →`);
  }

  result(`\n[${item.level}] ${item.title}`);
  result(`  ID:     ${item.id}`);
  info(`  Status: ${item.status}`);
  if (item.priority) info(`  Priority: ${item.priority}`);
  if (item.description) info(`\n  ${item.description}`);
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    info("\n  Acceptance Criteria:");
    for (const ac of item.acceptanceCriteria) {
      info(`    - ${ac}`);
    }
  }
}
