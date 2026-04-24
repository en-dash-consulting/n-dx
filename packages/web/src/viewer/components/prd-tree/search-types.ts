/**
 * Search-local PRD tree types.
 *
 * These stay close to the search/facet modules so the search zone does not
 * depend on the broader PRD tree type surface for a small structural subset.
 */

export type SearchItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failing"
  | "blocked"
  | "deferred"
  | "deleted";

export interface SearchablePRDItem {
  id: string;
  title: string;
  status: SearchItemStatus;
  description?: string;
  tags?: string[];
  /** @see packages/rex/src/schema/v1.ts — PRDItem.branch */
  branch?: string | null;
  children?: SearchablePRDItem[];
}

export interface SearchFacets {
  /** Active tag facets — item must have ALL of these tags (AND logic). */
  tags?: Set<string>;
  /** Active status facets — item must match ONE of these statuses (OR within group). */
  statuses?: Set<SearchItemStatus>;
}
