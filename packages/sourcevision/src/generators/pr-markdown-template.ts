/**
 * Rex-based PR markdown template generator.
 *
 * Transforms a {@link BranchWorkRecord} into a PR-ready markdown document
 * structured around completed epics, features, and significant changes
 * rather than raw git diffs.
 *
 * Content is prioritized by significance: breaking changes appear first
 * (high-visibility), followed by major changes, then the full completed
 * work listing sorted by significance within each feature group.
 *
 * All functions are pure — no I/O, no side effects.
 *
 * @module sourcevision/generators/pr-markdown-template
 */

import type {
  BranchWorkRecord,
  BranchWorkRecordItem,
  ChangeSignificance,
} from "../schema/v1.js";

// ── Significance ordering ───────────────────────────────────────────────────

const SIGNIFICANCE_ORDER: Record<ChangeSignificance, number> = {
  major: 0,
  minor: 1,
  patch: 2,
};

/** Default significance for items without explicit classification. */
const DEFAULT_SIGNIFICANCE: ChangeSignificance = "patch";

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Groups items by their root epic ancestor title.
 * Items without an epic in their parentChain land under `"(Ungrouped)"`.
 */
export function groupItemsByEpic(
  items: readonly BranchWorkRecordItem[],
): Map<string, BranchWorkRecordItem[]> {
  const grouped = new Map<string, BranchWorkRecordItem[]>();

  for (const item of items) {
    const epicRef = item.parentChain.find((ref) => ref.level === "epic");
    const key = epicRef?.title ?? "(Ungrouped)";
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }

  return grouped;
}

/** Returns items flagged as breaking changes. */
export function extractBreakingChanges(
  items: readonly BranchWorkRecordItem[],
): BranchWorkRecordItem[] {
  return items.filter((item) => item.breakingChange === true);
}

/** Returns items with `changeSignificance === "major"`. */
export function extractMajorChanges(
  items: readonly BranchWorkRecordItem[],
): BranchWorkRecordItem[] {
  return items.filter((item) => item.changeSignificance === "major");
}

/** Returns items with `changeSignificance === "minor"`. */
export function extractMinorChanges(
  items: readonly BranchWorkRecordItem[],
): BranchWorkRecordItem[] {
  return items.filter((item) => item.changeSignificance === "minor");
}

/**
 * Sort items by change significance (major → minor → patch).
 * Items without explicit significance default to "patch".
 * Preserves relative order within the same significance level (stable sort).
 */
export function sortItemsBySignificance(
  items: readonly BranchWorkRecordItem[],
): BranchWorkRecordItem[] {
  return [...items].sort((a, b) => {
    const aOrder =
      SIGNIFICANCE_ORDER[a.changeSignificance ?? DEFAULT_SIGNIFICANCE];
    const bOrder =
      SIGNIFICANCE_ORDER[b.changeSignificance ?? DEFAULT_SIGNIFICANCE];
    return aOrder - bOrder;
  });
}

// ── Feature grouping within an epic ─────────────────────────────────────────

function getFeatureTitle(item: BranchWorkRecordItem): string {
  const featureRef = item.parentChain.find((ref) => ref.level === "feature");
  return featureRef?.title ?? "(Other)";
}

function groupItemsByFeature(
  items: readonly BranchWorkRecordItem[],
): Map<string, BranchWorkRecordItem[]> {
  const grouped = new Map<string, BranchWorkRecordItem[]>();

  for (const item of items) {
    const key = getFeatureTitle(item);
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }

  return grouped;
}

// ── Item rendering ──────────────────────────────────────────────────────────

/**
 * Whether an item's significance warrants inline context
 * (description + acceptance criteria) in the completed work section.
 */
function isSignificant(item: BranchWorkRecordItem): boolean {
  return (
    item.changeSignificance === "major" ||
    item.changeSignificance === "minor"
  );
}

/**
 * Render a single item line with optional significance indicator and context.
 *
 * - Breaking items get ⚠️ prefix and bold title
 * - Major items get 🔶 prefix and bold title
 * - Significant items (major/minor) include description and acceptance criteria
 * - Patch/unclassified items render as plain list items
 */
function renderItemLines(item: BranchWorkRecordItem): string[] {
  const lines: string[] = [];
  const levelTag = item.level !== "task" ? ` *(${item.level})*` : "";

  // Title line with significance indicator
  if (item.breakingChange) {
    lines.push(`- ⚠️ **${item.title}**${levelTag}`);
  } else if (item.changeSignificance === "major") {
    lines.push(`- 🔶 **${item.title}**${levelTag}`);
  } else {
    lines.push(`- ${item.title}${levelTag}`);
  }

  // Inline context for significant items (minor+)
  if (isSignificant(item) && item.description) {
    lines.push(`  ${item.description}`);
  }

  if (
    isSignificant(item) &&
    item.acceptanceCriteria &&
    item.acceptanceCriteria.length > 0
  ) {
    for (const criterion of item.acceptanceCriteria) {
      lines.push(`  - ${criterion}`);
    }
  }

  return lines;
}

// ── Section renderers ───────────────────────────────────────────────────────

/** Renders the top-level summary section. */
export function renderSummarySection(record: BranchWorkRecord): string {
  const lines: string[] = [];
  lines.push("## Summary");
  lines.push("");
  lines.push(`**Branch:** \`${record.branch}\``);
  lines.push(`**Base:** \`${record.baseBranch}\``);
  lines.push(`**Completed items:** ${record.items.length}`);

  if (record.epicSummaries.length > 0) {
    lines.push("");
    lines.push("| Epic | Completed |");
    lines.push("|------|-----------|");
    for (const summary of record.epicSummaries) {
      lines.push(`| ${summary.title} | ${summary.completedCount} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders a single epic section with items grouped by feature.
 * Items within each feature group are sorted by significance (major first).
 */
export function renderEpicSection(
  epicTitle: string,
  items: readonly BranchWorkRecordItem[],
): string {
  const lines: string[] = [];
  lines.push(`### ${epicTitle}`);
  lines.push("");

  const byFeature = groupItemsByFeature(items);
  const featureKeys = [...byFeature.keys()].sort((a, b) => {
    // "(Other)" always goes last
    if (a === "(Other)") return 1;
    if (b === "(Other)") return -1;
    return a.localeCompare(b);
  });

  for (const featureTitle of featureKeys) {
    const featureItems = byFeature.get(featureTitle) ?? [];
    const sorted = sortItemsBySignificance(featureItems);

    if (featureTitle !== "(Other)") {
      lines.push(`**${featureTitle}**`);
    }

    for (const item of sorted) {
      lines.push(...renderItemLines(item));
    }

    lines.push("");
  }

  return lines.join("\n");
}

/** Renders the breaking changes section. Returns empty string if no items. */
export function renderBreakingChangesSection(
  items: readonly BranchWorkRecordItem[],
): string {
  if (items.length === 0) return "";

  const lines: string[] = [];
  lines.push("## ⚠️ Breaking Changes");
  lines.push("");

  for (const item of items) {
    lines.push(`- **${item.title}**`);

    if (item.description) {
      lines.push(`  ${item.description}`);
    }

    if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
      for (const criterion of item.acceptanceCriteria) {
        lines.push(`  - ${criterion}`);
      }
    }
  }

  return lines.join("\n");
}

/** Renders the major changes section. Returns empty string if no items. */
export function renderMajorChangesSection(
  items: readonly BranchWorkRecordItem[],
): string {
  if (items.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Major Changes");
  lines.push("");

  for (const item of items) {
    const priorityTag = item.priority ? ` [${item.priority}]` : "";
    lines.push(`- **${item.title}**${priorityTag}`);

    if (item.description) {
      lines.push(`  ${item.description}`);
    }
  }

  return lines.join("\n");
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Generates a complete PR markdown document from a branch work record.
 *
 * Content is organized in reviewer-friendly priority order:
 *
 * 1. **Summary** — branch, base, item counts, epic table
 * 2. **Breaking Changes** — ⚠️ high-visibility section (only when present)
 * 3. **Major Changes** — non-breaking major items (only when present)
 * 4. **Completed Work** — all items grouped by epic → feature,
 *    sorted by significance within each group
 */
export function renderPRMarkdownFromRecord(record: BranchWorkRecord): string {
  const sections: string[] = [];

  // 1. Summary
  sections.push(renderSummarySection(record));

  // 2. Breaking changes — high-visibility, immediately after summary
  const breakingItems = extractBreakingChanges(record.items);
  const breakingSection = renderBreakingChangesSection(breakingItems);
  if (breakingSection) {
    sections.push(breakingSection);
  }

  // 3. Major changes — non-breaking major items (breaking ones already shown above)
  const majorNonBreaking = extractMajorChanges(record.items).filter(
    (item) => !item.breakingChange,
  );
  const majorSection = renderMajorChangesSection(majorNonBreaking);
  if (majorSection) {
    sections.push(majorSection);
  }

  // 4. Completed work grouped by epic, sorted by significance within groups
  if (record.items.length === 0) {
    sections.push("## Completed Work\n\nNo completed work items on this branch.");
  } else {
    sections.push(renderCompletedWorkSection(record.items));
  }

  return sections.join("\n\n") + "\n";
}

// ── Internal ────────────────────────────────────────────────────────────────

function renderCompletedWorkSection(items: readonly BranchWorkRecordItem[]): string {
  const lines: string[] = [];
  lines.push("## Completed Work");
  lines.push("");

  const byEpic = groupItemsByEpic(items);
  const epicKeys = [...byEpic.keys()].sort((a, b) => {
    // "(Ungrouped)" always goes last
    if (a === "(Ungrouped)") return 1;
    if (b === "(Ungrouped)") return -1;
    return a.localeCompare(b);
  });

  for (const epicTitle of epicKeys) {
    const epicItems = byEpic.get(epicTitle) ?? [];
    lines.push(renderEpicSection(epicTitle, epicItems));
  }

  return lines.join("\n");
}
