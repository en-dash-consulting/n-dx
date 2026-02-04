import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { computeStats } from "../../core/tree.js";
import { verify } from "../../core/verify.js";
import {
  aggregateTokenUsage,
  formatAggregateTokenUsage,
} from "../../core/token-usage.js";
import { CLIError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import { info, result, isQuiet } from "../output.js";
import type { PRDItem } from "../../schema/index.js";
import type { TreeStats } from "../../core/tree.js";
import type { VerifyResult } from "../../core/verify.js";
import type { TokenUsageFilter } from "../../core/token-usage.js";

const VALID_FORMATS = ["json", "tree"] as const;

const STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  deferred: "◌",
  blocked: "⊘",
};

const FILLED = "█";
const EMPTY = "░";
const DEFAULT_BAR_WIDTH = 20;

/** Per-task coverage stats, keyed by item ID. */
export type CoverageMap = Map<string, { covered: number; total: number }>;

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
  return "";
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
    const priority = item.priority ? ` [${item.priority}]` : "";
    const ts = timestampSuffix(item);
    const cov = coverageSuffix(item.id, coverage);

    if (item.children && item.children.length > 0) {
      const stats = computeStats(item.children);
      const count = `[${stats.completed}/${stats.total}]`;

      if (item.level === "epic") {
        const ratio = stats.total > 0 ? stats.completed / stats.total : 0;
        const pct = Math.round(ratio * 100);
        const bar = renderProgressBar(ratio);
        lines.push(
          `${prefix}${icon} ${item.title}${priority} ${bar} ${pct}% ${count}`,
        );
      } else {
        lines.push(
          `${prefix}${icon} ${item.title}${priority} ${count}${ts}`,
        );
      }
      lines.push(...renderTree(item.children, indent + 1, coverage));
    } else {
      lines.push(`${prefix}${icon} ${item.title}${priority}${cov}${ts}`);
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
  if (stats.blocked > 0) parts.push(`${stats.blocked} blocked`);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  return `${parts.join(", ")} — ${pct}% complete (${stats.completed}/${stats.total})`;
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

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const format = flags.format;
  const showCoverage = flags.coverage === "true";
  const showTokens = flags.tokens === "true";

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

  // Default and --format=tree both render the tree view
  result(`PRD: ${doc.title}`);
  result("");

  if (doc.items.length === 0) {
    result("  No items yet. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  const coverageMap = verifyResult ? buildCoverageMap(verifyResult) : undefined;
  for (const line of renderTree(doc.items, 0, coverageMap)) {
    result(line);
  }

  const stats = computeStats(doc.items);
  info("");
  info(formatStats(stats));

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
  }
}
