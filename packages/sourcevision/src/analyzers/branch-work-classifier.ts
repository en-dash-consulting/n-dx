/**
 * Branch work significance classifier — classifies completed PRD items
 * by change significance and breaking change status.
 *
 * ## Classification Strategy
 *
 * Pure heuristic-based classification using rex metadata (tags, descriptions,
 * acceptance criteria, priority, hierarchy level) — no LLM calls.
 *
 * ### Breaking change detection
 *
 * An item is flagged as a breaking change when any of these signals fire:
 *
 * 1. **Tags** contain "breaking", "breaking-change", or "breaking_change"
 * 2. **Title/description** match breaking-change keyword patterns
 *    (e.g., "breaking change", "remove API", "deprecate", "backward incompatible")
 * 3. **Acceptance criteria** mention migration or breaking concerns
 *
 * ### Significance classification
 *
 * Three levels: `"major"`, `"minor"`, `"patch"`.
 *
 * - **major**: epic-level items, breaking changes, critical priority
 * - **minor**: feature-level items, high priority tasks, API/schema/interface
 *   changes (from acceptance criteria), tasks under large epics (≥5 completions)
 * - **patch**: default for individual tasks and subtasks
 *
 * All functions are pure — no I/O, no side effects.
 *
 * @module sourcevision/analyzers/branch-work-classifier
 */

import type {
  BranchWorkRecordItem,
  BranchWorkEpicSummary,
  ChangeSignificance,
} from "../schema/v1.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum number of completed tasks under an epic to consider the epic
 * "large scope" (elevates child task significance from patch → minor).
 */
const LARGE_EPIC_THRESHOLD = 5;

/** Tag patterns that signal a breaking change (matched case-insensitively). */
const BREAKING_TAG_PATTERNS = [
  /^breaking$/i,
  /^breaking[-_]change$/i,
];

/**
 * Text patterns that signal a breaking change when found in title,
 * description, or acceptance criteria.
 */
const BREAKING_TEXT_PATTERNS: RegExp[] = [
  /\bbreaking\s+change/i,
  /\bbreaking\b/i,
  /\bremoves?\b.*?\b(api|endpoint|interface|support|feature)\b/i,
  /\bdeprecate[sd]?\b/i,
  /\bbackwards?\s*incompatib/i,
  /\bmigrat/i,
];

/**
 * Acceptance criteria patterns that signal API/schema/interface relevance
 * (elevates task significance to minor).
 */
const IMPORTANT_AC_PATTERNS: RegExp[] = [
  /\bpublic\s+api\b/i,
  /\bapi\s+(endpoint|contract|surface)/i,
  /\b(database|db)\s+schema\b/i,
  /\bschema\s+(updat|chang|migrat)/i,
  /\bpublic\s+interface\b/i,
  /\bapi\s+contract\b/i,
];

// ---------------------------------------------------------------------------
// Breaking change detection
// ---------------------------------------------------------------------------

/**
 * Determine whether a work item represents a breaking change.
 *
 * Checks tags, title, description, and acceptance criteria against
 * known breaking-change patterns.
 */
export function isBreakingChange(item: BranchWorkRecordItem): boolean {
  // 1. Tag-based detection
  if (item.tags && item.tags.length > 0) {
    for (const tag of item.tags) {
      for (const pattern of BREAKING_TAG_PATTERNS) {
        if (pattern.test(tag)) return true;
      }
    }
  }

  // 2. Title and description keyword detection
  const textFields = [item.title, item.description].filter(
    (t): t is string => t !== undefined && t.length > 0,
  );

  for (const text of textFields) {
    for (const pattern of BREAKING_TEXT_PATTERNS) {
      if (pattern.test(text)) return true;
    }
  }

  // 3. Acceptance criteria keyword detection
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    for (const criterion of item.acceptanceCriteria) {
      for (const pattern of BREAKING_TEXT_PATTERNS) {
        if (pattern.test(criterion)) return true;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Significance inference
// ---------------------------------------------------------------------------

/**
 * Infer the change significance for a work item based on its level,
 * priority, acceptance criteria, and epic scope.
 *
 * This function does NOT consider breaking change status — the caller
 * is responsible for elevating breaking items to "major" if needed.
 *
 * @param item           - The work item to classify
 * @param epicSummaries  - Per-epic completion summaries (for scope analysis)
 */
export function inferSignificance(
  item: BranchWorkRecordItem,
  epicSummaries: readonly BranchWorkEpicSummary[],
): ChangeSignificance {
  // Track the highest significance seen so far
  let significance: ChangeSignificance = "patch";

  // ── Level-based baseline ────────────────────────────────────────
  if (item.level === "epic") return "major";
  if (item.level === "feature") significance = elevate(significance, "minor");

  // ── Priority-based elevation ────────────────────────────────────
  if (item.priority === "critical") return "major";
  if (item.priority === "high") significance = elevate(significance, "minor");

  // ── Acceptance criteria analysis ────────────────────────────────
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    const hasImportantAC = item.acceptanceCriteria.some((criterion) =>
      IMPORTANT_AC_PATTERNS.some((pattern) => pattern.test(criterion)),
    );
    if (hasImportantAC) significance = elevate(significance, "minor");
  }

  // ── Epic scope analysis ─────────────────────────────────────────
  if (epicSummaries.length > 0 && item.parentChain.length > 0) {
    const epicRef = item.parentChain.find((ref) => ref.level === "epic");
    if (epicRef) {
      const epicSummary = epicSummaries.find((s) => s.id === epicRef.id);
      if (epicSummary && epicSummary.completedCount >= LARGE_EPIC_THRESHOLD) {
        significance = elevate(significance, "minor");
      }
    }
  }

  return significance;
}

// ---------------------------------------------------------------------------
// Combined classification
// ---------------------------------------------------------------------------

/**
 * Classify a single work item, populating both `changeSignificance`
 * and `breakingChange` fields.
 *
 * Breaking items are always elevated to at least "major" significance.
 * Returns a new item object — the original is not mutated.
 */
export function classifyItem(
  item: BranchWorkRecordItem,
  epicSummaries: readonly BranchWorkEpicSummary[],
): BranchWorkRecordItem {
  const breaking = isBreakingChange(item);
  let significance = inferSignificance(item, epicSummaries);

  // Breaking changes are always at least major
  if (breaking) {
    significance = elevate(significance, "major");
  }

  return {
    ...item,
    changeSignificance: significance,
    breakingChange: breaking,
  };
}

/**
 * Classify all items in a branch work record.
 *
 * Returns a new array of classified items — originals are not mutated.
 *
 * @param items          - Work items to classify
 * @param epicSummaries  - Per-epic completion summaries
 */
export function classifyItems(
  items: readonly BranchWorkRecordItem[],
  epicSummaries: readonly BranchWorkEpicSummary[],
): BranchWorkRecordItem[] {
  return items.map((item) => classifyItem(item, epicSummaries));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const SIGNIFICANCE_ORDER: Record<ChangeSignificance, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

/**
 * Return the higher of two significance levels.
 * Never downgrades — if current is already higher, returns current.
 */
function elevate(
  current: ChangeSignificance,
  candidate: ChangeSignificance,
): ChangeSignificance {
  return SIGNIFICANCE_ORDER[candidate] > SIGNIFICANCE_ORDER[current]
    ? candidate
    : current;
}
