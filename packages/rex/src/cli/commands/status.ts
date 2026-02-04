import { join } from "node:path";
import { createStore } from "../../store/index.js";
import { computeStats } from "../../core/tree.js";
import { CLIError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import type { PRDItem } from "../../schema/index.js";
import type { TreeStats } from "../../core/tree.js";

const VALID_FORMATS = ["json", "tree"] as const;

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  deferred: "◌",
};

/** Render a PRD tree to lines with status icons and indentation. */
export function renderTree(items: PRDItem[], indent: number = 0): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const icon = STATUS_ICONS[item.status] ?? "?";
    const prefix = "  ".repeat(indent);
    const priority = item.priority ? ` [${item.priority}]` : "";

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      lines.push(
        `${prefix}${icon} ${item.title}${priority} [${stats.completed}/${stats.total}]`,
      );
      lines.push(...renderTree(item.children, indent + 1));
    } else {
      lines.push(`${prefix}${icon} ${item.title}${priority}`);
    }
  }
  return lines;
}

export function formatStats(stats: TreeStats): string {
  const parts = [];
  if (stats.completed > 0) parts.push(`${stats.completed} completed`);
  if (stats.inProgress > 0) parts.push(`${stats.inProgress} in progress`);
  if (stats.pending > 0) parts.push(`${stats.pending} pending`);
  if (stats.deferred > 0) parts.push(`${stats.deferred} deferred`);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  return `${parts.join(", ")} — ${pct}% complete (${stats.completed}/${stats.total})`;
}

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const format = flags.format;

  if (format && !VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Unknown format: "${format}"`,
      `Valid formats: ${VALID_FORMATS.join(", ")}`,
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = createStore("file", rexDir);
  const doc = await store.loadDocument();

  if (format === "json") {
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  // Default and --format=tree both render the tree view
  console.log(`PRD: ${doc.title}`);
  console.log("");

  if (doc.items.length === 0) {
    console.log("  No items yet. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  for (const line of renderTree(doc.items)) {
    console.log(line);
  }

  const stats = computeStats(doc.items);
  console.log("");
  console.log(formatStats(stats));
}
