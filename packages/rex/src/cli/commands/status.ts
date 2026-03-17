import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { computeStats } from "../../core/stats.js";
import { verify } from "../../core/verify.js";
import { CLIError } from "../errors.js";
import { REX_DIR } from "./constants.js";
import { result, isQuiet } from "../output.js";
import type { PRDItem } from "../../schema/index.js";
import type { VerifyResult } from "../../core/verify.js";
import type { TokenUsageFilter } from "../../core/token-usage.js";
import { groupByFacet, getFacetValue } from "../../core/facets.js";
import { walkTree } from "../../core/tree.js";
import {
  buildCoverageMap,
  renderJsonOutput,
  renderStaleReport,
  renderTreeView,
  renderCoverageSummary,
  renderTokenUsageSection,
  renderAutoCompletableHints,
  renderStaleWarnings,
} from "./status-sections.js";

// Re-export shared utilities so existing consumers (tests, etc.) keep working.
export {
  STATUS_ICONS,
  renderProgressBar,
  formatTimestamp,
  filterCompleted,
  filterDeleted,
  renderTree,
  formatStats,
} from "./status-shared.js";
export type { CoverageMap } from "./status-shared.js";

const VALID_FORMATS = ["json", "tree"] as const;

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
      const icon = ({ pending: "○", in_progress: "◐", completed: "●", failing: "✗", deferred: "◌", blocked: "⊘", deleted: "✕" } as Record<string, string>)[item.status] ?? "?";
      const priority = item.priority ? ` [${item.priority}]` : "";
      lines.push(`  ${icon} ${item.title}${priority}`);
    }
    lines.push("");
  }

  if (ungrouped.length > 0) {
    lines.push(`(untagged) (${ungrouped.length} items)`);
    for (const item of ungrouped) {
      const icon = ({ pending: "○", in_progress: "◐", completed: "●", failing: "✗", deferred: "◌", blocked: "⊘", deleted: "✕" } as Record<string, string>)[item.status] ?? "?";
      lines.push(`  ${icon} ${item.title}`);
    }
  }

  return lines;
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
    await renderJsonOutput(doc, {
      showAll,
      showTokens,
      verifyResult,
      store,
      dir,
      tokenFilter,
    });
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
    renderStaleReport(doc.items);
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

  const coverageMap = verifyResult ? buildCoverageMap(verifyResult) : undefined;
  renderTreeView(doc.items, { showAll, coverageMap });

  renderCoverageSummary(verifyResult);

  if (showTokens) {
    await renderTokenUsageSection(store, dir, tokenFilter);
  }

  renderAutoCompletableHints(doc.items);
  renderStaleWarnings(doc.items);
}
