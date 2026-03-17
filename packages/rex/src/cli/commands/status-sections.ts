/**
 * Focused rendering sections for the `rex status` command.
 *
 * Each function handles one discrete output section, keeping cmdStatus
 * a thin orchestrator that delegates to these helpers.
 */

import { computeStats } from "../../core/stats.js";
import {
  aggregateTokenUsage,
  checkBudget,
} from "../../core/token-usage.js";
import { formatAggregateTokenUsage, formatBudgetWarnings } from "./token-format.js";
import { walkTree } from "../../core/tree.js";
import { info, warn, result } from "../output.js";
import type { PRDItem, ItemStatus } from "../../schema/index.js";
import type { PRDStore } from "../../store/index.js";
import type { VerifyResult } from "../../core/verify.js";
import type { TokenUsageFilter } from "../../core/token-usage.js";
import type { CoverageMap } from "./status-shared.js";
import {
  STATUS_ICONS,
  renderTree,
  filterCompleted,
  filterDeleted,
  formatStats,
  formatTimestamp,
} from "./status-shared.js";

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

/** Summarize override markers across the tree. */
export function summarizeOverrideMarkers(items: PRDItem[]): OverrideMarkerSummary {
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

/** Build a CoverageMap from verify results. */
export function buildCoverageMap(verifyResult: VerifyResult): CoverageMap {
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
export function formatCoverageSummary(verifyResult: VerifyResult): string {
  const { coveredCriteria, totalCriteria, totalTasks } = verifyResult.summary;
  return `${coveredCriteria}/${totalCriteria} criteria covered across ${totalTasks} task(s)`;
}

/** Find items that are in_progress for more than 48 hours. */
export function findStaleItems(items: PRDItem[], now: Date = new Date()): PRDItem[] {
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

/** Find parent items whose children are all completed or deferred. */
export function findAutoCompletable(items: PRDItem[]): Array<{ id: string; title: string }> {
  const results: Array<{ id: string; title: string }> = [];
  const TERMINAL: Set<ItemStatus> = new Set(["completed", "deferred"]);
  for (const { item } of walkTree(items)) {
    if (
      item.children && item.children.length > 0 &&
      (item.status === "pending" || item.status === "in_progress") &&
      item.children.every((c) => TERMINAL.has(c.status))
    ) {
      results.push({ id: item.id, title: item.title });
    }
  }
  return results;
}

/** Render JSON output for --format=json. */
export async function renderJsonOutput(
  doc: { title: string; items: PRDItem[]; [key: string]: unknown },
  opts: {
    showAll: boolean;
    showTokens: boolean;
    verifyResult?: VerifyResult;
    store: PRDStore;
    dir: string;
    tokenFilter: TokenUsageFilter;
  },
): Promise<void> {
  const jsonItems = opts.showAll ? doc.items : filterDeleted(doc.items);
  const output: Record<string, unknown> = { ...doc, items: jsonItems };
  output.overrideMarkers = summarizeOverrideMarkers(jsonItems);
  if (opts.verifyResult) {
    output.coverage = {
      tasks: opts.verifyResult.tasks,
      summary: opts.verifyResult.summary,
    };
  }
  if (opts.showTokens) {
    const logEntries = await opts.store.readLog();
    const tokenUsage = await aggregateTokenUsage(logEntries, opts.dir, opts.tokenFilter);
    output.tokenUsage = tokenUsage;
  }
  result(JSON.stringify(output, null, 2));
}

/** Render the --stale report (stale items only). */
export function renderStaleReport(items: PRDItem[]): void {
  const staleItems = findStaleItems(items);
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
}

/** Render the tree view with stats summary. */
export function renderTreeView(
  items: PRDItem[],
  opts: {
    showAll: boolean;
    coverageMap?: CoverageMap;
  },
): void {
  const displayItems = opts.showAll ? items : filterDeleted(filterCompleted(items));
  const stats = computeStats(items);
  const hidingCompleted = !opts.showAll && (stats.completed > 0 || stats.deleted > 0);

  for (const line of renderTree(displayItems, 0, opts.coverageMap)) {
    result(line);
  }

  info("");
  info(formatStats(stats, { hidingCompleted }));
}

/** Render the coverage summary section. */
export function renderCoverageSummary(verifyResult?: VerifyResult): void {
  if (!verifyResult || verifyResult.summary.totalCriteria === 0) return;
  info("");
  info(`Test coverage: ${formatCoverageSummary(verifyResult)}`);
}

/** Render token usage summary and budget warnings. */
export async function renderTokenUsageSection(
  store: PRDStore,
  dir: string,
  tokenFilter: TokenUsageFilter,
): Promise<void> {
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

/** Render auto-completable item hints. */
export function renderAutoCompletableHints(items: PRDItem[]): void {
  const autoCompletable = findAutoCompletable(items);
  if (autoCompletable.length === 0) return;
  info("");
  info("Auto-completable:");
  for (const ac of autoCompletable) {
    info(`  ● ${ac.title} — all children done, can be marked completed`);
  }
}

/** Render stale item warnings (truncated to 5). */
export function renderStaleWarnings(items: PRDItem[]): void {
  const staleItems = findStaleItems(items);
  if (staleItems.length === 0) return;
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
