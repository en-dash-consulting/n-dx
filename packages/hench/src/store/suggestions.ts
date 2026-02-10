/**
 * Suggestion tracking persistence — records which workflow optimization
 * suggestions have been accepted, rejected, or deferred.
 *
 * State is stored in `.hench/suggestions.json`.
 */

import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export type SuggestionDecision = "accepted" | "rejected" | "deferred";

export interface SuggestionRecord {
  /** The suggestion ID (matches WorkflowSuggestion.id). */
  suggestionId: string;
  /** Short title for human reference. */
  title: string;
  /** Category of the suggestion. */
  category: string;
  /** What the user decided. */
  decision: SuggestionDecision;
  /** ISO timestamp of the decision. */
  decidedAt: string;
  /** Config changes that were applied (only if accepted). */
  appliedChanges?: Record<string, unknown>;
}

export interface SuggestionHistory {
  records: SuggestionRecord[];
}

const SUGGESTIONS_FILE = "suggestions.json";

function filePath(henchDir: string): string {
  return join(henchDir, SUGGESTIONS_FILE);
}

/** Load suggestion history from disk. Returns empty history if file missing. */
export function loadSuggestionHistory(henchDir: string): SuggestionHistory {
  const path = filePath(henchDir);
  try {
    if (!existsSync(path)) return { records: [] };
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.records)) {
      return parsed as SuggestionHistory;
    }
    return { records: [] };
  } catch {
    return { records: [] };
  }
}

/** Load suggestion history asynchronously. */
export async function loadSuggestionHistoryAsync(henchDir: string): Promise<SuggestionHistory> {
  const path = filePath(henchDir);
  try {
    if (!existsSync(path)) return { records: [] };
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.records)) {
      return parsed as SuggestionHistory;
    }
    return { records: [] };
  } catch {
    return { records: [] };
  }
}

/** Save suggestion history to disk (sync). */
export function saveSuggestionHistory(henchDir: string, history: SuggestionHistory): void {
  writeFileSync(filePath(henchDir), JSON.stringify(history, null, 2) + "\n", "utf-8");
}

/** Save suggestion history to disk (async). */
export async function saveSuggestionHistoryAsync(
  henchDir: string,
  history: SuggestionHistory,
): Promise<void> {
  await writeFile(filePath(henchDir), JSON.stringify(history, null, 2) + "\n", "utf-8");
}

/** Record a user's decision on a suggestion. */
export function recordDecision(
  henchDir: string,
  record: SuggestionRecord,
): void {
  const history = loadSuggestionHistory(henchDir);
  history.records.push(record);
  saveSuggestionHistory(henchDir, history);
}

/** Get decision statistics for learning. */
export function getDecisionStats(history: SuggestionHistory): {
  total: number;
  accepted: number;
  rejected: number;
  deferred: number;
  acceptanceRate: number;
  byCategory: Record<string, { accepted: number; rejected: number; deferred: number }>;
} {
  const total = history.records.length;
  const accepted = history.records.filter((r) => r.decision === "accepted").length;
  const rejected = history.records.filter((r) => r.decision === "rejected").length;
  const deferred = history.records.filter((r) => r.decision === "deferred").length;

  const byCategory: Record<string, { accepted: number; rejected: number; deferred: number }> = {};
  for (const record of history.records) {
    const cat = byCategory[record.category] ?? { accepted: 0, rejected: 0, deferred: 0 };
    cat[record.decision]++;
    byCategory[record.category] = cat;
  }

  return {
    total,
    accepted,
    rejected,
    deferred,
    acceptanceRate: total > 0 ? accepted / total : 0,
    byCategory,
  };
}
