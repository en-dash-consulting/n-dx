/**
 * Types for batch acceptance records used by the analyze → chunked-review pipeline.
 *
 * These types live in the core analyze module (rex-prd-engine zone) so that
 * both analyze.ts and the chunked-review satellite can import them without
 * creating a core → satellite inversion.
 */

/**
 * Record of a single granularity adjustment performed during a review session.
 * Captures what was changed and how, providing an audit trail of adjustments.
 */
export interface GranularityAdjustmentRecord {
  /** The direction of adjustment. */
  direction: "break_down" | "consolidate";
  /** Titles of the original proposals that were adjusted. */
  originalTitles: string[];
  /** Titles of the resulting proposals after adjustment. */
  resultTitles: string[];
  /** ISO 8601 timestamp of the adjustment. */
  timestamp: string;
}

/**
 * Record of a single batch acceptance/rejection decision.
 * Written alongside the PRD after accept to provide an audit trail of what
 * was proposed, what was accepted, how the decision was made (interactive
 * review vs auto-accept), and any granularity adjustments performed during
 * the review session.
 */
export interface BatchAcceptanceRecord {
  /** ISO 8601 timestamp of the decision. */
  timestamp: string;
  /** Total proposals offered in this batch. */
  totalProposals: number;
  /** Number of proposals accepted. */
  acceptedCount: number;
  /** Number of proposals rejected (not accepted). */
  rejectedCount: number;
  /** Total PRD items (epics + features + tasks) added from accepted proposals. */
  acceptedItemCount: number;
  /** Titles of accepted proposals (epic titles). */
  accepted: string[];
  /** Titles of rejected proposals (epic titles). */
  rejected: string[];
  /** How the decision was made. */
  mode: "interactive" | "auto" | "cached";
  /** Granularity adjustments made during this batch review session. */
  granularityAdjustments?: GranularityAdjustmentRecord[];
}
