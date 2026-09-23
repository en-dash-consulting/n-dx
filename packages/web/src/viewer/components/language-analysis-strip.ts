/**
 * Files-page language analysis strip — "which languages did SourceVision
 * actually look at, and what did it skip".
 *
 * An outside first-use review of the Files page could not tell that a
 * project's Zig files were never inventoried at all — the table just showed
 * JavaScript, silently. This strip states three things above the table, each
 * with file counts:
 *
 * - **Analysed** — languages whose files take part in import-graph and zone
 *   analysis (sourcevision's `summary.analysedLanguages`).
 * - **Inventoried only** — languages present in `summary.byLanguage` but not
 *   in `analysedLanguages`: counted, but not import/zone analysed.
 * - **Skipped** — file extensions the walker saw but did not inventory at
 *   all (`summary.skippedExtensions`), e.g. an unsupported language.
 *
 * Both `skippedExtensions` and `analysedLanguages` are additive fields on the
 * inventory summary (see `@n-dx/sourcevision`'s `analyzeInventory`) — absent
 * on inventories written before this strip existed. When `analysedLanguages`
 * is missing, every language in `byLanguage` renders under a single neutral
 * "Inventoried" group instead of splitting into Analysed/Inventoried only,
 * since there's no data to tell them apart. When `skippedExtensions` is
 * missing, the Skipped group is simply omitted. The strip renders nothing at
 * all when there is nothing to report.
 */

import { h } from "preact";

export interface LanguageAnalysisSummary {
  byLanguage: Record<string, number>;
  /** Extension -> file count for files the walker saw but did not inventory. */
  skippedExtensions?: Record<string, number>;
  /** Subset of `byLanguage` keys that take part in import-graph/zone analysis. */
  analysedLanguages?: string[];
}

export interface LanguageStripEntry {
  label: string;
  count: number;
}

export interface LanguageStripGroup {
  heading: string;
  entries: LanguageStripEntry[];
}

function toSortedEntries(counts: Record<string, number>): LanguageStripEntry[] {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => ({ label, count }));
}

/**
 * Pure computation of the strip's groups from an inventory summary, exported
 * for direct unit testing independent of rendering.
 */
export function buildLanguageStripGroups(summary: LanguageAnalysisSummary): LanguageStripGroup[] {
  const byLanguage = summary.byLanguage ?? {};
  const groups: LanguageStripGroup[] = [];

  if (summary.analysedLanguages) {
    const analysedSet = new Set(summary.analysedLanguages);
    const analysed: Record<string, number> = {};
    const inventoriedOnly: Record<string, number> = {};
    for (const [lang, count] of Object.entries(byLanguage)) {
      if (analysedSet.has(lang)) analysed[lang] = count;
      else inventoriedOnly[lang] = count;
    }
    if (Object.keys(analysed).length > 0) {
      groups.push({ heading: "Analysed", entries: toSortedEntries(analysed) });
    }
    if (Object.keys(inventoriedOnly).length > 0) {
      groups.push({ heading: "Inventoried only", entries: toSortedEntries(inventoriedOnly) });
    }
  } else if (Object.keys(byLanguage).length > 0) {
    // Degraded: no analysed/inventoried-only distinction available, so name
    // the single group neutrally rather than claiming either status.
    groups.push({ heading: "Inventoried", entries: toSortedEntries(byLanguage) });
  }

  if (summary.skippedExtensions && Object.keys(summary.skippedExtensions).length > 0) {
    groups.push({ heading: "Skipped", entries: toSortedEntries(summary.skippedExtensions) });
  }

  return groups;
}

/** Renders one group as "Heading: label (count), label (count)". */
function formatGroup(group: LanguageStripGroup): string {
  const parts = group.entries.map((e) => `${e.label} (${e.count})`).join(", ");
  return `${group.heading}: ${parts}`;
}

export interface LanguageAnalysisStripProps {
  summary: LanguageAnalysisSummary | null | undefined;
}

export function LanguageAnalysisStrip({ summary }: LanguageAnalysisStripProps) {
  if (!summary) return null;
  const groups = buildLanguageStripGroups(summary);
  if (groups.length === 0) return null;

  return h("p", { class: "language-analysis-strip", role: "status" },
    groups.map(formatGroup).join(" · ")
  );
}
