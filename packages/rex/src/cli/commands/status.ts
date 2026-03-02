import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { computeStats } from "../../core/stats.js";
import { verify } from "../../core/verify.js";
import {
  aggregateTokenUsage,
  formatAggregateTokenUsage,
  checkBudget,
  formatBudgetWarnings,
} from "../../core/token-usage.js";
import { isFullyCompleted } from "../../core/prune.js";
import { CLIError, BudgetExceededError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import { info, warn, result, isQuiet } from "../output.js";
import type { PRDItem, ItemStatus } from "../../schema/index.js";
import { isRootLevel } from "../../schema/index.js";
import type { TreeStats } from "../../core/stats.js";
import type { VerifyResult } from "../../core/verify.js";
import type { TokenUsageFilter } from "../../core/token-usage.js";
import { validateStructure } from "../../core/structural.js";
import { groupByFacet, getFacetValue } from "../../core/facets.js";
import { walkTree } from "../../core/tree.js";

const VALID_FORMATS = ["json", "tree"] as const;

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failing: "✗",
  deferred: "◌",
  blocked: "⊘",
  deleted: "✕",
};

const FILLED = "█";
const EMPTY = "░";
const DEFAULT_BAR_WIDTH = 20;

/** Per-task coverage stats, keyed by item ID. */
export type CoverageMap = Map<string, { covered: number; total: number }>;
interface OverrideMarkerSummaryItem {
  id: string;
  title: string;
  level: PRDItem["level"];
  status: PRDItem["status"];
  reason: string;
  reasonRef: string;
  matchedItemId: string;
  matchedItemStatus: PRDItem["status"];
  createdAt: string;
}

interface OverrideMarkerSummary {
  totalItems: number;
  overrideCreated: number;
  normalOrMerged: number;
  items: OverrideMarkerSummaryItem[];
}

/** Render a progress bar string from a completion ratio. */
export function renderProgressBar(
  ratio: number,
  width: number = DEFAULT_BAR_WIDTH,
): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return FILLED.repeat(filled) + EMPTY.repeat(width - filled);
}

/** Format an ISO timestamp as a compact date string for tree display. */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
}

/** Build a timestamp suffix for tree display. */
function timestampSuffix(item: PRDItem): string {
  if (item.status === "completed" && typeof item.completedAt === "string") {
    const ts = formatTimestamp(item.completedAt);
    return ts ? ` (done ${ts})` : "";
  }
  if (item.status === "in_progress" && typeof item.startedAt === "string") {
    const ts = formatTimestamp(item.startedAt);
    return ts ? ` (started ${ts})` : "";
  }
  if (item.status === "failing" && typeof item.failureReason === "string") {
    return ` (reason: ${item.failureReason})`;
  }
  return "";
}

/** Build a suffix showing blockedBy dependency IDs for blocked items. */
function blockedBySuffix(item: PRDItem): string {
  if (item.status !== "blocked" || !item.blockedBy || item.blockedBy.length === 0) {
    return "";
  }
  return ` (blocked by: ${item.blockedBy.join(", ")})`;
}

/** Format a coverage suffix for a task with acceptance criteria. */
function coverageSuffix(itemId: string, coverage?: CoverageMap): string {
  if (!coverage) return "";
  const entry = coverage.get(itemId);
  if (!entry) return "";

  const { covered, total } = entry;
  if (covered === total) {
    return ` [✓ ${covered}/${total} covered]`;
  }
  if (covered === 0) {
    return ` [✗ ${covered}/${total} covered]`;
  }
  return ` [${covered}/${total} covered]`;
}

function overrideSuffix(item: PRDItem): string {
  if (!item.overrideMarker) return "";
  return ` [override: ${item.overrideMarker.reason}]`;
}

function summarizeOverrideMarkers(items: PRDItem[]): OverrideMarkerSummary {
  const summary: OverrideMarkerSummary = {
    totalItems: 0,
    overrideCreated: 0,
    normalOrMerged: 0,
    items: [],
  };

  const visit = (nodes: PRDItem[]): void => {
    for (const item of nodes) {
      summary.totalItems++;
      if (item.overrideMarker) {
        summary.overrideCreated++;
        summary.items.push({
          id: item.id,
          title: item.title,
          level: item.level,
          status: item.status,
          reason: item.overrideMarker.reason,
          reasonRef: item.overrideMarker.reasonRef,
          matchedItemId: item.overrideMarker.matchedItemId,
          matchedItemStatus: item.overrideMarker.matchedItemStatus,
          createdAt: item.overrideMarker.createdAt,
        });
      }
      if (item.children && item.children.length > 0) {
        visit(item.children);
      }
    }
  };

  visit(items);
  summary.normalOrMerged = summary.totalItems - summary.overrideCreated;
  return summary;
}

/**
 * Filter out fully-completed subtrees from items for display.
 *
 * An item is removed when it and all its descendants are completed.
 * Items that are completed but have non-completed children are kept,
 * with their children recursively filtered.
 *
 * Returns a new array — does not mutate the input.
 */
export function filterCompleted(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  for (const item of items) {
    if (isFullyCompleted(item)) continue;
    if (item.children && item.children.length > 0) {
      result.push({ ...item, children: filterCompleted(item.children) });
    } else {
      result.push(item);
    }
  }
  return result;
}

/** Render a PRD tree to lines with status icons and indentation. */
export function renderTree(
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

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      const count = `[${stats.completed}/${stats.total}]`;

      if (isRootLevel(item.level)) {
        const ratio = stats.total > 0 ? stats.completed / stats.total : 0;
        const pct = Math.round(ratio * 100);
        const bar = renderProgressBar(ratio);
        lines.push(
          `${prefix}${icon} ${item.title}${override}${priority} ${bar} ${pct}% ${count}${blocked}`,
        );
      } else {
        lines.push(
          `${prefix}${icon} ${item.title}${override}${priority} ${count}${ts}${blocked}`,
        );
      }
      lines.push(...renderTree(item.children, indent + 1, coverage));
    } else {
      lines.push(`${prefix}${icon} ${item.title}${override}${priority}${cov}${ts}${blocked}`);
    }
  }
  return lines;
}

export function formatStats(
  stats: TreeStats,
  options?: { hidingCompleted?: boolean },
): string {
  const parts = [];
  if (stats.completed > 0) parts.push(`${stats.completed} completed`);
  if (stats.inProgress > 0) parts.push(`${stats.inProgress} in progress`);
  if (stats.pending > 0) parts.push(`${stats.pending} pending`);
  if (stats.failing > 0) parts.push(`${stats.failing} failing`);
  if (stats.deferred > 0) parts.push(`${stats.deferred} deferred`);
  if (stats.blocked > 0) parts.push(`${stats.blocked} blocked`);
  if (stats.deleted > 0) parts.push(`${stats.deleted} deleted`);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const suffix =
    options?.hidingCompleted
      ? " (showing active items, use --all for full tree)"
      : "";
  return `${parts.join(", ")} — ${pct}% complete (${stats.completed}/${stats.total})${suffix}`;
}

/** Build a CoverageMap from verify results. */
function buildCoverageMap(verifyResult: VerifyResult): CoverageMap {
  const map: CoverageMap = new Map();
  for (const task of verifyResult.tasks) {
    map.set(task.id, {
      covered: task.coveredCriteria,
      total: task.totalCriteria,
    });
  }
  return map;
}

/** Format a coverage summary line. */
function formatCoverageSummary(verifyResult: VerifyResult): string {
  const { coveredCriteria, totalCriteria, totalTasks } = verifyResult.summary;
  return `${coveredCriteria}/${totalCriteria} criteria covered across ${totalTasks} task(s)`;
}

/** Render items grouped by a facet key. */
function renderGroupedByFacet(items: PRDItem[], facetKey: string): string[] {
  const groups = groupByFacet(items, facetKey);
  const lines: string[] = [];

  // Items without the facet
  const ungrouped: PRDItem[] = [];
  for (const { item } of walkTree(items)) {
    if (!getFacetValue(item, facetKey)) {
      ungrouped.push(item);
    }
  }

  for (const [value, groupItems] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stats = computeStats(groupItems);
    lines.push(`${facetKey}:${value} (${stats.completed}/${stats.total} complete)`);
    for (const item of groupItems) {
      const icon = STATUS_ICONS[item.status] ?? "?";
      const priority = item.priority ? ` [${item.priority}]` : "";
      lines.push(`  ${icon} ${item.title}${priority}`);
    }
    lines.push("");
  }

  if (ungrouped.length > 0) {
    lines.push(`(untagged) (${ungrouped.length} items)`);
    for (const item of ungrouped) {
      const icon = STATUS_ICONS[item.status] ?? "?";
      lines.push(`  ${icon} ${item.title}`);
    }
  }

  return lines;
}

/** Find stale items (in_progress > 48h). */
function findStaleItems(items: PRDItem[], now: Date = new Date()): PRDItem[] {
  const stale: PRDItem[] = [];
  const threshold = 48 * 60 * 60 * 1000; // 48h in ms
  for (const { item } of walkTree(items)) {
    if (item.status === "in_progress" && item.startedAt) {
      const started = new Date(item.startedAt).getTime();
      if (!isNaN(started) && now.getTime() - started > threshold) {
        stale.push(item);
      }
    }
  }
  return stale;
}

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const format = flags.format;
  const showCoverage = flags.coverage === "true";
  const showTokens = flags.tokens !== "false";
  const showAll = flags.all === "true";
  const groupBy = flags["group-by"];
  const showStaleOnly = flags.stale === "true";

  if (format && !VALID_FORMATS.includes(format as (typeof VALID_FORMATS)[number])) {
    throw new CLIError(
      `Unknown format: "${format}"`,
      `Valid formats: ${VALID_FORMATS.join(", ")}`,
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  // Compute coverage if requested
  let verifyResult: VerifyResult | undefined;
  if (showCoverage) {
    verifyResult = await verify({
      projectDir: dir,
      items: doc.items,
      runTests: false,
    });
  }

  // Build time filter for token usage
  const tokenFilter: TokenUsageFilter = {};
  if (flags.since) tokenFilter.since = flags.since;
  if (flags.until) tokenFilter.until = flags.until;

  if (format === "json") {
    const output: Record<string, unknown> = { ...doc };
    output.overrideMarkers = summarizeOverrideMarkers(doc.items);
    if (verifyResult) {
      output.coverage = {
        tasks: verifyResult.tasks,
        summary: verifyResult.summary,
      };
    }
    if (showTokens) {
      const logEntries = await store.readLog();
      const tokenUsage = await aggregateTokenUsage(logEntries, dir, tokenFilter);
      output.tokenUsage = tokenUsage;
    }
    result(JSON.stringify(output, null, 2));
    return;
  }

  // Quiet mode with non-JSON format: emit a one-line summary
  if (isQuiet()) {
    const stats = computeStats(doc.items);
    const pct =
      stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    result(`${pct}% complete (${stats.completed}/${stats.total})`);
    return;
  }

  // --stale: show only stale items
  if (showStaleOnly) {
    const staleItems = findStaleItems(doc.items);
    if (staleItems.length === 0) {
      result("No stale items (in_progress > 48h).");
      return;
    }
    result(`Stale items (in_progress > 48h): ${staleItems.length}`);
    result("");
    for (const item of staleItems) {
      const icon = STATUS_ICONS[item.status] ?? "?";
      const ts = item.startedAt ? ` (started ${formatTimestamp(item.startedAt)})` : "";
      result(`  ${icon} ${item.title}${ts}`);
    }
    return;
  }

  // Default and --format=tree both render the tree view
  result(`PRD: ${doc.title}`);
  result("");

  if (doc.items.length === 0) {
    result("  No items yet. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  // --group-by: render grouped by facet instead of hierarchy
  if (groupBy) {
    for (const line of renderGroupedByFacet(doc.items, groupBy)) {
      result(line);
    }
    return;
  }

  const displayItems = showAll ? doc.items : filterCompleted(doc.items);
  const stats = computeStats(doc.items);
  const hidingCompleted = !showAll && stats.completed > 0;

  const coverageMap = verifyResult ? buildCoverageMap(verifyResult) : undefined;
  for (const line of renderTree(displayItems, 0, coverageMap)) {
    result(line);
  }

  info("");
  info(formatStats(stats, { hidingCompleted }));

  // Coverage summary
  if (verifyResult && verifyResult.summary.totalCriteria > 0) {
    info("");
    info(`Test coverage: ${formatCoverageSummary(verifyResult)}`);
  }

  // Token usage summary
  if (showTokens) {
    const logEntries = await store.readLog();
    const tokenUsage = await aggregateTokenUsage(logEntries, dir, tokenFilter);
    info("");
    for (const line of formatAggregateTokenUsage(tokenUsage)) {
      info(line);
    }
    if (tokenFilter.since || tokenFilter.until) {
      const parts: string[] = [];
      if (tokenFilter.since) parts.push(`since ${tokenFilter.since}`);
      if (tokenFilter.until) parts.push(`until ${tokenFilter.until}`);
      info(`  (filtered: ${parts.join(", ")})`);
    }

    // Budget warnings (gracefully skip if config is unavailable)
    try {
      const config = await store.loadConfig();
      if (config.budget) {
        const budgetResult = checkBudget(tokenUsage, config.budget);
        const budgetLines = formatBudgetWarnings(budgetResult);
        if (budgetLines.length > 0) {
          warn("");
          for (const line of budgetLines) {
            warn(line);
          }
        }
      }
    } catch {
      // Config unavailable — skip budget check
    }
  }

  // Auto-completion hints: parents whose children are ALL completed/deferred
  const autoCompletable: Array<{ id: string; title: string }> = [];
  const TERMINAL: Set<ItemStatus> = new Set(["completed", "deferred"]);
  for (const { item } of walkTree(doc.items)) {
    if (
      item.children && item.children.length > 0 &&
      (item.status === "pending" || item.status === "in_progress") &&
      item.children.every((c) => TERMINAL.has(c.status))
    ) {
      autoCompletable.push({ id: item.id, title: item.title });
    }
  }
  if (autoCompletable.length > 0) {
    info("");
    info("Auto-completable:");
    for (const ac of autoCompletable) {
      info(`  ● ${ac.title} — all children done, can be marked completed`);
    }
  }

  // Stale item warnings
  const staleItems = findStaleItems(doc.items);
  if (staleItems.length > 0) {
    warn("");
    warn(`Stale items (in_progress > 48h): ${staleItems.length}`);
    for (const item of staleItems.slice(0, 5)) {
      const ts = item.startedAt ? ` (started ${formatTimestamp(item.startedAt)})` : "";
      warn(`  ⚠ ${item.title}${ts}`);
    }
    if (staleItems.length > 5) {
      warn(`  ... and ${staleItems.length - 5} more (use --stale to see all)`);
    }
  }
}
