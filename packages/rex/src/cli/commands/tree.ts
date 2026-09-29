/**
 * The `rex tree` command: render the full PRD hierarchy as a color-coded tree.
 *
 * Features:
 * - Completed items: magenta (purple) color
 * - In-progress items: yellow with ** surrounding title
 * - Pending items: no color
 * - Respects NO_COLOR and non-TTY detection via ANSI helpers
 */

import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { loadItemsPreferFolderTree } from "./folder-tree-sync.js";
import { computeStats } from "../../core/stats.js";
import { isRootLevel } from "../../schema/index.js";
import { REX_DIR } from "./constants.js";
import { result } from "../output.js";
import { emitMigrationNotification } from "../migration-notification.js";
import type { PRDItem } from "../../schema/index.js";
import {
  magenta,
  yellow,
  red,
  dim,
} from "@n-dx/llm-client";
import {
  STATUS_ICONS,
  renderProgressBar,
  timestampSuffix,
  blockedBySuffix,
  coverageSuffix,
  overrideSuffix,
  filterDeleted,
  type CoverageMap,
} from "./status-shared.js";

/**
 * Render tree with the tree command's custom color scheme.
 *
 * Color scheme:
 * - completed → magenta
 * - in_progress → yellow with ** surrounding title
 * - pending → no color
 * - failing → red
 * - blocked → yellow
 * - deferred/deleted → dim
 */
function renderTreeWithColorScheme(
  items: PRDItem[],
  indent: number = 0,
  coverage?: CoverageMap,
): string[] {
  const lines: string[] = [];

  for (const item of items) {
    const icon = STATUS_ICONS[item.status] ?? "?";
    const prefix = "  ".repeat(indent);
    const override = overrideSuffix(item);
    const priority = item.priority ? ` [${item.priority}]` : "";
    const ts = timestampSuffix(item);
    const cov = coverageSuffix(item.id, coverage);
    const blocked = blockedBySuffix(item);

    // Construct title with status-specific formatting
    let titlePart: string;
    if (item.status === "in_progress") {
      // Yellow with ** surrounding the title
      titlePart = yellow(`**${item.title}**`);
    } else {
      // Just the title without extra markers
      titlePart = item.title;
    }

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      const count = `[${stats.completed}/${stats.total}]`;

      if (isRootLevel(item.level)) {
        // Root level: include progress bar
        const ratio = stats.total > 0 ? stats.completed / stats.total : 0;
        const pct = Math.round(ratio * 100);
        const bar = renderProgressBar(ratio);
        const line = `${prefix}${icon} ${titlePart}${override}${priority} ${bar} ${pct}% ${count}${blocked}`;
        lines.push(colorLine(line, item.status));
      } else {
        // Non-root level: simpler format
        const line = `${prefix}${icon} ${titlePart}${override}${priority} ${count}${ts}${blocked}`;
        lines.push(colorLine(line, item.status));
      }

      // Recursively render children
      lines.push(...renderTreeWithColorScheme(item.children, indent + 1, coverage));
    } else {
      // Leaf item: no children
      const line = `${prefix}${icon} ${titlePart}${override}${priority}${cov}${ts}${blocked}`;
      lines.push(colorLine(line, item.status));
    }
  }

  return lines;
}

/**
 * Apply semantic color to a tree line based on item status.
 *
 * Tree command scheme:
 * - completed → magenta
 * - failing → red
 * - in_progress → already colored in titlePart
 * - blocked → yellow
 * - pending / deferred → no color
 */
function colorLine(line: string, status: string): string {
  switch (status) {
    case "completed":
      return magenta(line);
    case "failing":
      return red(line);
    case "blocked":
      return yellow(line);
    case "in_progress":
    case "pending":
    case "deferred":
    case "deleted":
    default:
      return line;
  }
}

export async function cmdTree(dir: string, flags: Record<string, string>): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading PRD
  const migrationResult = await ensureLegacyPrdMigrated(dir);

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));

  const items = await loadItemsPreferFolderTree(rexDir, store);

  // Filter deleted items
  const visibleItems = filterDeleted(items);

  // The machine-readable rendering of the same hierarchy. It exists so a
  // consumer outside rex can read the PRD without a second parser — the
  // folder-tree replacement for the `rex parse-md --stdin` seam that answered
  // this for `.rex/prd.md`. sourcevision's PR markdown is the first caller.
  //
  // Deleted items are filtered here exactly as they are for the rendered
  // tree: two renderings of one command that disagreed about which items
  // exist would be a trap, and a reader reconciling a JSON dump against the
  // tree they just looked at is entitled to see the same items.
  if (flags.format === "json") {
    result(JSON.stringify({ items: visibleItems }, null, 2));
    return;
  }

  // Render tree
  const lines = renderTreeWithColorScheme(visibleItems);

  // Output
  for (const line of lines) {
    result(line);
  }
}
