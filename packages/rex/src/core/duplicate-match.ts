/**
 * Whether a proposed item duplicates an existing one: the rule smart add
 * flags duplicates by, shared with every other proposer (the dashboard's
 * Sidecar change-set card).
 *
 * The caller chooses the candidates — smart add compares an item only with
 * items at its own level — so this module holds the scoring and nothing about
 * which items may match.
 */

import { similarity } from "../analyze/dedupe.js";
import type { PRDItem } from "../schema/index.js";

/** Blended score at or above which a proposal is a duplicate. */
const DUPLICATE_THRESHOLD = 0.7;

export type DuplicateMatchReason = "exact_title" | "semantic_title" | "content_overlap";

/** What a proposal is compared on. */
export interface DuplicateCandidateText {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
}

export interface DuplicateItemMatch<T extends DuplicateCandidateText = PRDItem> {
  item: T;
  score: number;
  reason: DuplicateMatchReason;
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function titleContains(a: string, b: string): boolean {
  if (a.length < 5 || b.length < 5) return false;
  return a.includes(b) || b.includes(a);
}

function content(text: DuplicateCandidateText): string {
  const parts: string[] = [];
  if (text.description) parts.push(text.description);
  if (text.acceptanceCriteria?.length) parts.push(text.acceptanceCriteria.join(" "));
  return parts.join(" ").trim();
}

/** How `proposal` matches `item`, or null when it is not a duplicate of it. */
export function scoreDuplicate<T extends DuplicateCandidateText>(
  proposal: DuplicateCandidateText,
  item: T,
): DuplicateItemMatch<T> | null {
  const proposalTitle = normalize(proposal.title);
  const itemTitle = normalize(item.title);
  if (proposalTitle === itemTitle) return { item, score: 1, reason: "exact_title" };
  if (titleContains(proposalTitle, itemTitle)) return { item, score: 0.95, reason: "semantic_title" };

  const titleScore = similarity(proposal.title, item.title);
  const proposalContent = content(proposal);
  const itemContent = content(item);
  const contentScore = proposalContent.length > 0 && itemContent.length > 0 ? similarity(proposalContent, itemContent) : 0;
  const blended = Math.max(titleScore, (titleScore * 0.75) + (contentScore * 0.25), contentScore * 0.7);
  const duplicate = blended >= DUPLICATE_THRESHOLD || (titleScore >= 0.62 && contentScore >= 0.55);
  if (!duplicate) return null;
  return { item, score: blended, reason: contentScore > titleScore ? "content_overlap" : "semantic_title" };
}

/** The best-scoring duplicate of `proposal` among `candidates`, or null when none is one. */
export function findDuplicateItem<T extends DuplicateCandidateText>(
  proposal: DuplicateCandidateText,
  candidates: Iterable<T>,
): DuplicateItemMatch<T> | null {
  let best: DuplicateItemMatch<T> | null = null;
  for (const item of candidates) {
    const match = scoreDuplicate(proposal, item);
    if (match && (!best || match.score > best.score)) best = match;
  }
  return best;
}
