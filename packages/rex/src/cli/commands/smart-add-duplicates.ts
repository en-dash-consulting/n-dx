import { similarity } from "../../analyze/dedupe.js";
import { walkTree } from "../../core/tree.js";
import { parsePRDFileDate } from "../../store/index.js";
import type {
  PRDItem,
  ItemLevel,
  ItemStatus,
  DuplicateOverrideMarker,
} from "../../schema/index.js";
import type { Proposal, DuplicateReasonMetadata, DuplicateReasonType } from "../../analyze/index.js";

const DUPLICATE_THRESHOLD = 0.7;

export type ProposalNodeKind = "epic" | "feature" | "task";
export type DuplicateReason = "exact_title" | "semantic_title" | "content_overlap" | "none";

/**
 * Item-to-file ownership map.
 *
 * Maps item IDs to the PRD filename that owns them (e.g. `"prd_main_2024-01-15.json"`).
 * Used by cross-file duplicate detection to prefer matches from older files.
 */
export type ItemFileMap = ReadonlyMap<string, string>;

export interface ProposalNode {
  key: string;
  kind: ProposalNodeKind;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}

export interface MatchedPRDItemRef {
  id: string;
  title: string;
  level: ItemLevel;
  status: ItemStatus;
  /** PRD filename that owns this item. Present when cross-file matching is active. */
  sourceFile?: string;
}

export interface ProposalDuplicateMatch {
  node: ProposalNode;
  duplicate: boolean;
  reason: DuplicateReason;
  score: number;
  matchedItem?: MatchedPRDItemRef;
}

function duplicateReasonTypeForMatch(match: ProposalDuplicateMatch): DuplicateReasonType | undefined {
  if (!match.duplicate || !match.matchedItem) return undefined;
  if (match.matchedItem.status === "completed") return "completed_item_match";
  if (match.reason === "exact_title") return "exact_title_match";
  if (match.reason === "semantic_title") return "semantic_match";
  if (match.reason === "content_overlap") return "content_overlap_match";
  return undefined;
}

function buildDuplicateReasonExplanation(match: ProposalDuplicateMatch): string {
  if (!match.matchedItem) return "";
  const level = match.matchedItem.level;
  const title = match.matchedItem.title;
  const status = match.matchedItem.status;

  if (status === "completed") {
    return `Matches completed ${level} "${title}".`;
  }
  if (match.reason === "exact_title") {
    return `Exact title match with existing ${level} "${title}".`;
  }
  if (match.reason === "content_overlap") {
    return `Overlapping content with existing ${level} "${title}".`;
  }
  return `Semantic title match with existing ${level} "${title}".`;
}

/**
 * Build proposal-facing duplicate metadata. Returns undefined for non-duplicates.
 */
export function buildDuplicateReasonMetadata(
  match: ProposalDuplicateMatch,
): DuplicateReasonMetadata | undefined {
  if (!match.duplicate || !match.matchedItem || match.reason === "none") {
    return undefined;
  }

  const type = duplicateReasonTypeForMatch(match);
  if (!type) return undefined;

  return {
    type,
    matchedItem: {
      id: match.matchedItem.id,
      title: match.matchedItem.title,
      level: match.matchedItem.level,
      status: match.matchedItem.status,
    },
    explanation: buildDuplicateReasonExplanation(match),
  };
}

/**
 * Build persisted audit metadata for an explicit duplicate override.
 * Returns undefined for non-duplicate matches.
 */
export function buildDuplicateOverrideMarker(
  match: ProposalDuplicateMatch,
  createdAt: string,
): DuplicateOverrideMarker | undefined {
  if (!match.duplicate || !match.matchedItem || match.reason === "none") {
    return undefined;
  }

  return {
    type: "duplicate_guard_override",
    reason: match.reason,
    reasonRef: `${match.reason}:${match.matchedItem.id}`,
    matchedItemId: match.matchedItem.id,
    matchedItemTitle: match.matchedItem.title,
    matchedItemLevel: match.matchedItem.level,
    matchedItemStatus: match.matchedItem.status,
    createdAt,
  };
}

/**
 * Build marker map keyed by proposal node key for use during item creation.
 */
export function buildDuplicateOverrideMarkerIndex(
  matches: ProposalDuplicateMatch[],
  createdAt: string,
): Record<string, DuplicateOverrideMarker> {
  const markers: Record<string, DuplicateOverrideMarker> = {};
  for (const match of matches) {
    const marker = buildDuplicateOverrideMarker(match, createdAt);
    if (marker) markers[match.node.key] = marker;
  }
  return markers;
}

/**
 * Attach structured duplicate reason metadata to matched proposal nodes.
 * Non-duplicate nodes are returned without duplicate metadata.
 */
export function attachDuplicateReasonsToProposals(
  proposals: Proposal[],
  matches: ProposalDuplicateMatch[],
): Proposal[] {
  const reasonByNodeKey = new Map<string, DuplicateReasonMetadata>();
  for (const match of matches) {
    const reason = buildDuplicateReasonMetadata(match);
    if (reason) reasonByNodeKey.set(match.node.key, reason);
  }

  return proposals.map((proposal, pIdx) => {
    const epicKey = `p${pIdx}:epic`;
    const epicReason = reasonByNodeKey.get(epicKey);

    return {
      epic: {
        title: proposal.epic.title,
        source: proposal.epic.source,
        description: proposal.epic.description,
        ...(epicReason ? { duplicateReason: epicReason } : {}),
      },
      features: proposal.features.map((feature, fIdx) => {
        const featureKey = `p${pIdx}:feature:${fIdx}`;
        const featureReason = reasonByNodeKey.get(featureKey);

        return {
          title: feature.title,
          source: feature.source,
          description: feature.description,
          ...(featureReason ? { duplicateReason: featureReason } : {}),
          tasks: feature.tasks.map((task, tIdx) => {
            const taskKey = `p${pIdx}:task:${fIdx}:${tIdx}`;
            const taskReason = reasonByNodeKey.get(taskKey);
            return {
              title: task.title,
              source: task.source,
              sourceFile: task.sourceFile,
              description: task.description,
              acceptanceCriteria: task.acceptanceCriteria,
              priority: task.priority,
              tags: task.tags,
              ...(taskReason ? { duplicateReason: taskReason } : {}),
            };
          }),
        };
      }),
    };
  });
}

interface CandidateScore {
  item: PRDItem;
  score: number;
  reason: Exclude<DuplicateReason, "none">;
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function titleContains(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  return a.includes(b) || b.includes(a);
}

function buildNodeContent(node: ProposalNode): string {
  const parts: string[] = [];
  if (node.description) parts.push(node.description);
  if (node.acceptanceCriteria?.length) parts.push(node.acceptanceCriteria.join(" "));
  return parts.join(" ").trim();
}

function buildItemContent(item: PRDItem): string {
  const parts: string[] = [];
  if (item.description) parts.push(item.description);
  if (item.acceptanceCriteria?.length) parts.push(item.acceptanceCriteria.join(" "));
  return parts.join(" ").trim();
}

function scoreNodeAgainstItem(node: ProposalNode, item: PRDItem): CandidateScore | null {
  // Only match items at the same level (epic↔epic, feature↔feature, task↔task)
  if (node.kind !== item.level) return null;

  const nodeTitle = normalize(node.title);
  const itemTitle = normalize(item.title);

  if (nodeTitle === itemTitle) {
    return { item, score: 1, reason: "exact_title" };
  }

  if (titleContains(nodeTitle, itemTitle)) {
    return { item, score: 0.95, reason: "semantic_title" };
  }

  const titleScore = similarity(node.title, item.title);
  const nodeContent = buildNodeContent(node);
  const itemContent = buildItemContent(item);
  const contentScore =
    nodeContent.length > 0 && itemContent.length > 0
      ? similarity(nodeContent, itemContent)
      : 0;

  const blended = Math.max(
    titleScore,
    (titleScore * 0.75) + (contentScore * 0.25),
    contentScore * 0.7,
  );

  const isDuplicate =
    blended >= DUPLICATE_THRESHOLD ||
    (titleScore >= 0.62 && contentScore >= 0.55);

  if (!isDuplicate) return null;

  return {
    item,
    score: blended,
    reason: contentScore > titleScore ? "content_overlap" : "semantic_title",
  };
}

export function flattenProposalNodes(proposals: Proposal[]): ProposalNode[] {
  const nodes: ProposalNode[] = [];

  for (let pIdx = 0; pIdx < proposals.length; pIdx++) {
    const proposal = proposals[pIdx];
    nodes.push({
      key: `p${pIdx}:epic`,
      kind: "epic",
      title: proposal.epic.title,
    });

    for (let fIdx = 0; fIdx < proposal.features.length; fIdx++) {
      const feature = proposal.features[fIdx];
      nodes.push({
        key: `p${pIdx}:feature:${fIdx}`,
        kind: "feature",
        title: feature.title,
        description: feature.description,
      });

      for (let tIdx = 0; tIdx < feature.tasks.length; tIdx++) {
        const task = feature.tasks[tIdx];
        nodes.push({
          key: `p${pIdx}:task:${fIdx}:${tIdx}`,
          kind: "task",
          title: task.title,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria,
        });
      }
    }
  }

  return nodes;
}

/**
 * Compare two PRD filenames by creation date, returning negative when `a` is older.
 *
 * Legacy `prd.json` (no date in filename) is treated as the oldest possible file.
 * Files with identical or unparseable dates compare equal.
 */
export function comparePRDFileAge(a: string, b: string): number {
  const dateA = parsePRDFileDate(a);
  const dateB = parsePRDFileDate(b);

  // Legacy prd.json (null date) is oldest
  if (dateA === null && dateB === null) return 0;
  if (dateA === null) return -1;
  if (dateB === null) return 1;

  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return 0;
}

/**
 * Pick the best candidate from a list of duplicates, preferring older files.
 *
 * When an {@link ItemFileMap} is provided and multiple candidates exist,
 * the candidate from the oldest PRD file wins. Within the same file,
 * the highest score wins.
 */
function pickBestCandidate(
  candidates: CandidateScore[],
  itemFileMap?: ItemFileMap,
): CandidateScore {
  if (candidates.length === 1 || !itemFileMap) {
    // No cross-file context or single candidate: highest score wins
    return candidates.reduce((a, b) => (b.score > a.score ? b : a));
  }

  // Sort by file age (oldest first), then by score (highest first)
  const sorted = [...candidates].sort((a, b) => {
    const fileA = itemFileMap.get(a.item.id) ?? "prd.json";
    const fileB = itemFileMap.get(b.item.id) ?? "prd.json";
    const ageCmp = comparePRDFileAge(fileA, fileB);
    if (ageCmp !== 0) return ageCmp;
    return b.score - a.score;
  });

  return sorted[0];
}

export function matchProposalNodeToPRD(
  node: ProposalNode,
  existingItems: PRDItem[],
  itemFileMap?: ItemFileMap,
): ProposalDuplicateMatch {
  const candidates: CandidateScore[] = [];

  for (const { item } of walkTree(existingItems)) {
    const candidate = scoreNodeAgainstItem(node, item);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      node,
      duplicate: false,
      reason: "none",
      score: 0,
    };
  }

  const best = pickBestCandidate(candidates, itemFileMap);
  const sourceFile = itemFileMap?.get(best.item.id);

  return {
    node,
    duplicate: true,
    reason: best.reason,
    score: best.score,
    matchedItem: {
      id: best.item.id,
      title: best.item.title,
      level: best.item.level,
      status: best.item.status,
      ...(sourceFile ? { sourceFile } : {}),
    },
  };
}

export function matchProposalNodesToPRD(
  proposals: Proposal[],
  existingItems: PRDItem[],
  itemFileMap?: ItemFileMap,
): ProposalDuplicateMatch[] {
  return flattenProposalNodes(proposals).map((node) =>
    matchProposalNodeToPRD(node, existingItems, itemFileMap),
  );
}
