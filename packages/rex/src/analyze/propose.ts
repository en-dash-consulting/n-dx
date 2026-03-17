import type { Priority, ItemLevel, ItemStatus } from "../schema/index.js";
import { PRIORITY_ORDER } from "../schema/index.js";
import type { ScanResult } from "./scanners.js";
import { deduplicateScanResults } from "./dedupe.js";

export type DuplicateReasonType =
  | "exact_title_match"
  | "semantic_match"
  | "content_overlap_match"
  | "completed_item_match";

export interface DuplicateReasonReference {
  id: string;
  title: string;
  level: ItemLevel;
  status: ItemStatus;
}

export interface DuplicateReasonMetadata {
  type: DuplicateReasonType;
  matchedItem: DuplicateReasonReference;
  explanation: string;
}

export interface ProposalTask {
  title: string;
  source: string;
  sourceFile: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  /** Status override — used in baseline mode to mark existing work as completed. */
  status?: ItemStatus;
  /** Level of effort estimate in engineer-weeks. */
  loe?: number;
  /** Rationale behind the LoE estimate. */
  loeRationale?: string;
  /** Confidence in the LoE estimate. */
  loeConfidence?: "low" | "medium" | "high";
  /**
   * When present, this task was auto-decomposed because its LoE exceeded
   * the configured threshold. Contains the child tasks and the threshold
   * that triggered decomposition. The review step lets users choose between
   * accepting children, keeping the original, or skipping entirely.
   */
  decomposition?: TaskDecomposition;
  duplicateReason?: DuplicateReasonMetadata;
}

/** Decomposition metadata attached to a task that exceeded the LoE threshold. */
export interface TaskDecomposition {
  /** Child tasks produced by decomposition. */
  children: ProposalTask[];
  /** The LoE threshold (in engineer-weeks) that was exceeded. */
  thresholdWeeks: number;
}

export interface ProposalFeature {
  title: string;
  source: string;
  description?: string;
  /** Status override — used in baseline mode to mark existing work as completed. */
  status?: ItemStatus;
  tasks: ProposalTask[];
  duplicateReason?: DuplicateReasonMetadata;
  /** When set, references an existing PRD item to place children under instead of creating a new feature. */
  existingId?: string;
}

export interface ProposalEpic {
  title: string;
  source: string;
  description?: string;
  /** Status override — used in baseline mode to mark existing work as completed. */
  status?: ItemStatus;
  duplicateReason?: DuplicateReasonMetadata;
  /** When set, references an existing PRD item to place children under instead of creating a new epic. */
  existingId?: string;
}

export interface Proposal {
  epic: ProposalEpic;
  features: ProposalFeature[];
}

/** Look up priority rank from an untyped string, defaulting to medium (2). */
function priorityRank(p: string | undefined): number {
  return PRIORITY_ORDER[(p ?? "medium") as Priority] ?? 2;
}

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

function inferEpic(result: ScanResult): string {
  // Explicit epic field takes precedence (set by scanners or LLM)
  if (result.epic) {
    return result.epic;
  }
  // Use first tag as epic grouping (scanners set this to directory-inferred epic)
  if (result.tags && result.tags.length > 0) {
    return result.tags[0];
  }
  // Fall back to source type
  return result.source === "sourcevision"
    ? "SourceVision"
    : result.source === "test"
      ? "Tests"
      : result.source === "package"
        ? "Package"
        : "Documentation";
}

/**
 * Derive a descriptive title from a file path by taking the basename,
 * stripping extensions, and converting to title case.
 */
function titleFromPath(filePath: string): string {
  // Extract the file name: strip directories
  const parts = filePath.split("/");
  const base = parts[parts.length - 1] || filePath;
  // Strip extensions (including .test.ts, .spec.tsx, etc.)
  const name = base
    .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.(ts|tsx|js|jsx|json|md|txt|yaml|yml)$/, "");
  // Convert kebab-case, snake_case, dots to spaces and title-case
  return name
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Compute tag overlap between two tag arrays. Returns the number of shared
 * tags (case-insensitive), excluding the first tag of each (which is used
 * for epic grouping) to avoid false matches on the epic tag alone.
 */
function tagOverlap(tagsA?: string[], tagsB?: string[]): number {
  if (!tagsA || !tagsB || tagsA.length < 2 || tagsB.length < 2) return 0;
  // Skip the first tag (epic tag) from both sets to avoid inflated matches
  const setB = new Set(tagsB.slice(1).map(normalize));
  let count = 0;
  for (const tag of tagsA.slice(1)) {
    if (setB.has(normalize(tag))) count++;
  }
  return count;
}

interface EpicEntry {
  source: string;
  description?: string;
  features: Map<string, { result: ScanResult; tasks: ScanResult[] }>;
}

/**
 * Compute effective priority for a feature by considering both its tasks'
 * priorities and the feature's own priority from the scan result.
 * Returns the numeric priority rank (lower = higher priority).
 */
function featurePriority(
  feat: ProposalFeature,
  scanPriority?: string,
): number {
  const taskPris = feat.tasks.map((t) => priorityRank(t.priority));
  // Include the feature-level priority from the scan result if available
  if (scanPriority) {
    taskPris.push(priorityRank(scanPriority));
  }
  return Math.min(...taskPris, 2);
}

export function buildProposals(results: ScanResult[]): Proposal[] {
  // Deduplicate within proposal set: merge near-duplicates by kind
  const deduped = deduplicateScanResults(results);

  // Separate by kind
  const epics = deduped.filter((r) => r.kind === "epic");
  const features = deduped.filter((r) => r.kind === "feature");
  const tasks = deduped.filter((r) => r.kind === "task");

  // Group features and tasks by epic
  const epicMap = new Map<string, EpicEntry>();

  // Seed from explicit epics (preserve description)
  for (const e of epics) {
    const key = normalize(e.name);
    if (!epicMap.has(key)) {
      epicMap.set(key, {
        source: e.source,
        description: e.description,
        features: new Map(),
      });
    }
  }

  // Build a map of feature-level priorities from scan results so we can
  // use them during sorting (features may have their own priority distinct
  // from their child tasks).
  const featPriorities = new Map<string, string>();

  // Place features under epics
  for (const f of features) {
    const epicName = normalize(inferEpic(f));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: f.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;
    const fKey = normalize(f.name);
    if (!epic.features.has(fKey)) {
      epic.features.set(fKey, { result: f, tasks: [] });
    }
    if (f.priority) {
      featPriorities.set(fKey, f.priority);
    }
  }

  // Place tasks under features using multi-strategy matching:
  // 1. Exact sourceFile match within same epic (strongest signal)
  // 2. Tag overlap match within same epic (semantic grouping)
  // 3. Cross-epic sourceFile match (file cohesion across epics)
  // 4. Create implicit feature (fallback)
  for (const t of tasks) {
    const epicName = normalize(inferEpic(t));
    if (!epicMap.has(epicName)) {
      epicMap.set(epicName, { source: t.source, features: new Map() });
    }
    const epic = epicMap.get(epicName)!;

    // Strategy 1: exact sourceFile match within same epic
    let placed = false;
    for (const [, feat] of epic.features) {
      if (feat.result.sourceFile === t.sourceFile) {
        feat.tasks.push(t);
        placed = true;
        break;
      }
    }

    // Strategy 2: tag overlap — find the feature with the most shared tags
    if (!placed && t.tags && t.tags.length > 0) {
      let bestFeat: { result: ScanResult; tasks: ScanResult[] } | null = null;
      let bestOverlap = 0;

      for (const [, feat] of epic.features) {
        const overlap = tagOverlap(t.tags, feat.result.tags);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestFeat = feat;
        }
      }

      if (bestFeat && bestOverlap >= 1) {
        bestFeat.tasks.push(t);
        placed = true;
      }
    }

    // Strategy 3: cross-epic sourceFile match — if a feature in another epic
    // shares the same sourceFile, place the task there for file cohesion
    if (!placed && t.sourceFile) {
      for (const [, otherEpic] of epicMap) {
        if (otherEpic === epic) continue;
        for (const [, feat] of otherEpic.features) {
          if (feat.result.sourceFile === t.sourceFile) {
            feat.tasks.push(t);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }

    if (!placed) {
      // Create an implicit feature with a descriptive title from the file path
      const implicitKey = normalize(t.sourceFile || t.name);
      if (!epic.features.has(implicitKey)) {
        const implicitTitle = t.sourceFile
          ? titleFromPath(t.sourceFile)
          : t.name;
        epic.features.set(implicitKey, {
          result: {
            name: implicitTitle,
            source: t.source,
            sourceFile: t.sourceFile,
            kind: "feature",
          },
          tasks: [],
        });
      }
      epic.features.get(implicitKey)!.tasks.push(t);
    }
  }

  // Build final proposals
  const proposals: Proposal[] = [];
  for (const [epicKey, epicData] of epicMap) {
    // Skip empty epics that have no features
    if (epicData.features.size === 0) continue;

    const featureList: ProposalFeature[] = [];
    for (const [, feat] of epicData.features) {
      // Sort tasks by priority
      const sortedTasks = feat.tasks.sort(
        (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
      );

      featureList.push({
        title: feat.result.name,
        source: feat.result.source,
        description: feat.result.description,
        tasks: sortedTasks.map((t) => ({
          title: t.name,
          source: t.source,
          sourceFile: t.sourceFile,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority,
          tags: t.tags,
        })),
      });
    }

    // Sort features: those with higher-priority content first.
    // Consider both task priorities and feature-level priority from the
    // scan result (features with no tasks use the feature's own priority).
    featureList.sort((a, b) => {
      const aPri = featurePriority(a, featPriorities.get(normalize(a.title)));
      const bPri = featurePriority(b, featPriorities.get(normalize(b.title)));
      return aPri - bPri;
    });

    // Use original casing for epic title from the first entry.
    // Check explicit epic fields, then explicit epic results, then tag inference.
    const epicTitle =
      epics.find((e) => normalize(e.name) === epicKey)?.name ??
      features.find((f) => f.epic && normalize(f.epic) === epicKey)?.epic ??
      tasks.find((t) => t.epic && normalize(t.epic) === epicKey)?.epic ??
      features.find((f) => normalize(inferEpic(f)) === epicKey)?.tags?.[0] ??
      tasks.find((t) => normalize(inferEpic(t)) === epicKey)?.tags?.[0] ??
      epicKey;

    proposals.push({
      epic: {
        title: epicTitle,
        source: epicData.source,
        description: epicData.description,
      },
      features: featureList,
    });
  }

  // Sort proposals: those with higher-priority content first
  proposals.sort((a, b) => {
    const aPri = Math.min(
      ...a.features.map((f) => featurePriority(f, featPriorities.get(normalize(f.title)))),
    );
    const bPri = Math.min(
      ...b.features.map((f) => featurePriority(f, featPriorities.get(normalize(f.title)))),
    );
    return aPri - bPri;
  });

  return proposals;
}
